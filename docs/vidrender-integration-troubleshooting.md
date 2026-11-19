# Rust 小内核接入：问题与解决记录

> 记录时间：2026-11-19。范围：把 hyperframes-rs 的 `vidrender` 小内核作为可选渲染后端接入 ShadowMill 产品（「HTML生成」页 · 转视频）过程中遇到的全部问题、根因与修复。
> 对应的代码改动见 CHANGELOG #124–#142、提交 `1bcdb27` / `4df29bc`；Rust 侧三内核平级重构见 hyperframes-rs 提交 `28e223a`。

## 0. 背景

- 原产品只有 HyperFrames（下称 HY）一个渲染后端；小内核 `vidrender` 先在 `scripts/demo-vidrender.cjs` 里以独立 demo 验证，再接进产品（设置页「渲染档位 · 渲染引擎」可切换，默认仍是 HY）。
- 小内核链路：Electron 离屏窗口加载入口 HTML → 逐帧 `capturePage()` 抓帧 → `crop`/`resize` 归一化 → 写 `vidrender-encode.exe` 的 stdin → MP4；BGM 走 `--audio` 离线 mux。
- 测试素材固定为项目「任意文件女生」：45 秒 / 30fps / 1350 帧 / 1920×1080 / standard。

## 1. 问题总览

| # | 现象 | 根因 | 修复 | 状态 |
|---|---|---|---|---|
| 1 | IPC 报 `reply was never sent`，渲染永久挂起 | 编码器二进制是旧版，不支持 `--audio`；第 0 帧写 stdin 永久等 `drain` | 重编 release 编码器（944128 B，含 `--audio`）替换；`writeAll()` 加 10s 超时 + `close` 兜底 | 已解决，实跑出片 |
| 2 | dev 模式转视频弹「需要下载运行环境（1.0 MB）」 | 缺包守卫只认 `userData` 安装记录，不认仓库内 `resources/bin/` | `runtime.ts` 的 `packsStatus()` 加 dev 兜底，标 `dev-bin` 为 ready | 已解决 |
| 3 | 抓帧尺寸 1923×1063，与画布不符 | Windows 窗口外框/标题栏吃掉内容视口 | 不再依赖窗口参数，抓帧处 `crop` + `resize` 归一化到 1920×1080 | 已解决，实跑出片 |
| 4 | 抽帧拖垮主进程，IPC 无回复 | 225 秒视频按 fps 全量抽成十几 GB PNG，成片只要 45 秒 | 按成片时长 `-t` 限幅 + ffmpeg 超时；PNG 改 JPG；按视频显示尺寸抽帧 | 已解决，帧数据 1.7GB → 58MB |
| 5 | 界面看不到实时进度/时间 | 小内核无时间显示；界面只解析 HY 的 `[Render:trace]`；小内核进度文本无换行卡在按行缓冲 | 小内核补时间/fps；新增 `parseVidrender()`；无换行文本直通道解析 | 已解决（进度可上屏） |
| 6 | dev 关窗后 node 不退，终端不回提示符 | electron-vite 是父进程，长驻 HTTP 服务 | `window-all-closed` 里仅 dev + win32，校验父进程命令行含 `electron-vite ... dev` 才 kill | 已实现，未实机验证 |
| 7 | 完成文案不显示耗时 | `VideoRenderResult` 没有耗时字段 | 主进程记 `renderStartedAt`，两个后端成功返回都带 `elapsedMs`；界面文案带耗时 | 已实现，未实机验证 |
| 8 | 两后端速度无法对比 | 小内核日志不落盘、HY 输出无汇总 | 临时探针写 `debug-render.log` 对比后删除（CHANGELOG #142） | 已完成对比 |

## 2. 逐条详情

### 2.1 `reply was never sent`（渲染永久挂起）

- **定位**：诊断日志把卡点钉在 `frame 0 before write len=8294400` 之后再无打点；独立 Electron 复现发现编码器收到 `--audio` 立即报 `error: unexpected argument '--audio' found`（exit 2）。
- **根因**：产品代码继续往已经退出的编码器 stdin 写 8MB，`write()` 返回 false 后等 `drain`，而 `drain` 永远不会到来 → `await` 永久挂起 → IPC handler 不返回。旧二进制在 `resources/bin/` 与 `target/release/` 都有（929280 B，M2 音频功能之前），只有 `target/debug/` 是新版。
- **修复**：
  1. `cargo build --release -p vidrender-core --bin vidrender-encode` 重编（944128 B，`--help` 确认含 `--audio`），替换 `resources/bin/vidrender-encode.exe`。
  2. `vidrender.ts` 的 `writeAll()` 加 10 秒超时、`close` 兜底与 `settled` 收口；编码器提前退出时明确报错，不再挂死。
- **验证**：独立复现确认旧版 `--audio` 报 `unexpected argument`、新版支持；产品实跑 1350 帧出片。

### 2.2 dev 弹下载 1MB

- **现象**：dev 模式切小内核点「转视频」，弹出下载运行环境（1.0 MB）提示。但该包在更新源上根本不存在（实测 HTTP 404），点了必失败。
- **根因**：两套判断口径不一致——`video.ts` 的缺包守卫走 `runtime.missingPacks()`，只认 `userData` 里的安装记录（dev 下没有）；而实际执行时 `hfEnv.vidrenderEncode` 还认仓库 `resources/bin/vidrender-encode.exe`（已在仓库里）。
- **修复**：`runtime.ts` 的 `packsStatus()` 给 `vidrender` 加 dev 兜底——未打包且 `hfEnv.BUILTIN_RESOURCES.vidrenderEncode` 非空时标 `ready`（id `dev-bin`，root 空串，不写 packs.json、不触发刷新）。打包版和其它包行为不变。

### 2.3 抓帧尺寸 1923×1063

- **过程**：先是 `useContentSize: true` 无效（实跑仍 1923×1063），再改 `frame: false` 也无效；继续调窗口参数只会让用户反复重跑。
- **最终修复**：在抓帧处兜底——`capturePage()` 后先 `crop` 掉多余边框、尺寸不足再 `resize` 到目标画布，保证每帧字节数恒等于 `frameSize`；仅在首帧推一次「截图 WxH，已归一化到 WxH」进度。任何窗口外框/DPI 抖动都不再影响出片。

### 2.4 抽帧拖垮主进程

同一条链上先后有三个问题，逐个解决：

1. **全量抽帧**：`extractVideoFrames` 原样按 fps 抽完整个 225 秒视频（≈6763 张 PNG，十几 GB），而成片只要 45 秒。→ 新增 `maxDuration` 参数，ffmpeg 加 `-t <成片秒数>`；`runFfmpeg` 加 5 分钟超时 + kill 子进程，stderr 尾巴带进报错。
2. **PNG 太大**：1350 张 1920×1080 PNG ≈ 1.7GB，逐帧 decode 仍拖垮主进程。查 HY 上游确认其抽帧默认 `auto`（带 alpha 才 PNG，其余 JPG）。→ 改 `-q:v 3` 输出 JPG，帧 URL 后缀 `.png` → `.jpg`。实测 259.6MB（−85%）。
3. **仍太大**：照 HY 的 `videoShownBoxes` 做法，按视频在页面里的实际显示盒子抽帧（本项目 490×600，只占画布约 1/4）。→ `vidrenderFrames.ts` 新增 `measureVideoBoxes()`（量 `getBoundingClientRect` + `objectFit`）与 `boxes` 参数；cover 用 `scale=...:increase,crop=...` 精确模拟裁剪。实测 **58.2MB**（相较 PNG −96.6%），输出尺寸 490×600，画面与浏览器一致。

### 2.5 进度/时间上不了屏

- **小内核没有时间**：只有 `[小内核] seek N/1350 帧`。→ `vidrender.ts` 记 `renderStart`，抽帧报用时、逐帧每 15 帧报「N/total 帧 · 已用 Xs · 剩余约 Ys · Z fps」、结束报「渲染完成：N 帧 / Xs（平均 Z fps）」。
- **界面不认小内核文本**：`useRenderProgress.ts` 只解析 `[Render:trace]` JSON 与 worker 进度条。→ 新增 `parseVidrender()` 识别 `[小内核]`，帧号行解析出 done/total 与已用秒，复用同一套 `phaseLabel` / `frames` / `startAtMs` / ticker 机制。
- **无换行卡缓冲**：`onProgress` 把文本追加到 `hfLogBuf`，只在遇到 `\n` 时处理；HY 输出天然带换行，小内核每条 send 独立且无换行，永远等不到那一行。→ 收到含 `[小内核]` 的文本直接 `parseVidrender(text)` 并 return，不进按行缓冲；同时删掉 while 循环里冗余的小内核分支。

### 2.6 dev 关窗 node 不退

- electron-vite dev 的进程链是 `node(electron-vite dev)` → spawn `electron.exe`；关窗只让 Electron 退出，父 node 的 HTTP 服务长驻，终端不回提示符。
- `index.ts` 的 `window-all-closed` 里，仅 `!app.isPackaged && process.platform === 'win32'` 时用 PowerShell `Get-CimInstance` 查 `process.ppid` 命令行，**确认含 `electron-vite ... dev` 才 `process.kill(ppid, 'SIGTERM')`**，避免误杀 IDE 终端；全程 try/catch。打包版不受影响。

### 2.7 完成文案带耗时

- `VideoRenderResult` 成功分支加可选 `elapsedMs`；`video.ts` 的 `video:render` handler 入口记 `renderStartedAt`，两个后端成功返回都带 `Date.now() - renderStartedAt`。
- 「HTML生成」页提交文案改为「正在准备渲染...」，完成文案改为「视频已生成（耗时 Xs · 标准 · 30fps）：路径」。

### 2.8 临时探针与清理

- 为对比耗时，临时恢复 `debugLog.ts`（`debugLog(tag,msg)` 写 `%APPDATA%/shadowmill/debug-render.log`），在 `video.ts` 的小内核 onProgress 与 HY stdout/stderr 转发处打点 `video:progress` / `hy:progress`。
- 对比完成后按约定删除探针（CHANGELOG #142）：删 `debugLog.ts` 与 3 处调用，正式 `video:progress` IPC 推送保留。

## 3. 速度对比结果（本机实测）

同一素材「任意文件女生」，45 秒 / 1350 帧 / 1920×1080 / 30fps / standard：

| 项 | HyperFrames | Rust 小内核 |
|---|---|---|
| 总耗时 | **123.0s**（`rendered in 2m 3.0s`，trace `totalElapsedMs=122951`） | **99.4s**（进度末行 `1350 帧 / 99.4s`） |
| 平均帧率 | ≈11.0 fps（捕获阶段 116.05s / 1350 帧 ≈ 11.6 fps） | **13.6 fps** |
| 捕获/渲染阶段 | `capture_streaming` 116.05s（单 worker、drawElement streaming） | 99.4s（含抽帧、抓帧、编码全流程） |
| 成片 | 24.2 MB / 45.0s | 同项目同参数 |

- 小内核快约 **23.6s（≈19%）**。
- HY 日志里没有 `time=` / `speed=` 字段；耗时在 CLI 最终汇总行 `rendered in 2m 3.0s` 里。
- 两轮跑在 13:05–13:24 之间，早于 13:20 的完成文案改动（未重启 dev），因此**新完成文案的耗时显示尚未经实跑验证**。

## 4. 遗留与待验证

- 重启 dev 后各跑一次 HY / 小内核，确认「视频已生成（耗时 Xs · 标准 · 30fps）：路径」确实显示耗时。
- dev 关窗时父 node 是否随 Electron 一起退出（未在实机确认）。
- 画质层面：按显示尺寸抽帧的 cover 裁剪与浏览器画面的一致性，仅做了尺寸/数据核对，未做逐帧像素比对。
- 打包产物、macOS 平台未验证。

## 5. 关键文件索引

| 文件 | 涉及问题 |
|---|---|
| `src/main/vidrender.ts` | #1 超时兜底、#3 归一化、#4 抽帧接入、#5 时间显示 |
| `src/main/vidrenderFrames.ts` | #4 抽帧限幅 / JPG / 按显示尺寸 |
| `src/main/video.ts` | #2 守卫口径、#7 elapsedMs、#8 探针（已删） |
| `src/main/runtime.ts` | #2 dev 兜底 |
| `src/main/index.ts` | #6 关窗清理父进程 |
| `src/renderer/src/composables/useRenderProgress.ts` | #5 小内核解析与直通道 |
| `src/renderer/src/pages/HtmlGenPage/index.vue` | #7 提交/完成文案 |
| `resources/bin/vidrender-encode.exe` | #1 重编新版编码器 |
