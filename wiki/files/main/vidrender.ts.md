# src/main/vidrender.ts

> 产品侧「Rust 小内核」渲染后端（本版新增的**双后端**里的新路径）：从 `video.ts` 已准备好的 `<项目>/.render-tmp/entry.html` 出发，做本地资源回退与 BGM 路径解析，隐藏 offscreen 窗口逐帧 seek / 抓帧，把 BGRA 位图写进 `vidrender-encode` 的 stdin 生成 MP4；进度经回调回推，**不注册任何 IPC 频道**。默认后端仍是 `hyperframes`，只有用户在设置页「渲染档位」·「渲染引擎」显式切到 `vidrender` 时才进入本模块。

- **所在目录**：src/main/
- **类型**：主进程渲染后端模块（无 IPC 注册、无业务数据读写；外部进程 + 离屏窗口编排）
- **规模**：**192 行**（实测 `[IO.File]::ReadAllLines`；本版新增文件）
- **对外导出**：接口 `VidrenderOptions`；函数 `renderWithVidrender(opts: VidrenderOptions): Promise<string>`（成功返回 `opts.output`，即成片绝对路径）

## 1. 作用与职责

- **产品侧小内核渲染**：与 demo（`scripts/demo-vidrender.cjs`）同构，但吃的是产品已经写好的渲染入口 `<projDir>/.render-tmp/entry.html`，而不是 demo 的 fixture。负责本地资源回退、BGM 绝对路径解析、画布尺寸、逐帧 seek / 抓帧、进度回调与子进程 / 窗口清理。
- **不注册 IPC**：全部由 [`video.ts`](./video.ts.md) 在 `backend === 'vidrender'` 分支直接 `await renderWithVidrender(...)` 调用；进度由回调交给 `video.ts` 再经既有 `video:progress` 频道推给渲染层。**没有新增 / 删除 IPC 频道**。
- **与 hyperframes 的关系**：后端按 `settings.getRenderBackend()` 二选一，默认 hyperframes 的原 CLI 路径完全保留；本模块只在用户显式切换后才进入。两后端共用 `video.ts` 的入口准备（合规校验、无限循环守卫、裁超长媒体、写 `.render-tmp/entry.html`），只是「渲染那一段」换掉。
- **小内核二进制定位**：`hfEnv.BUILTIN_RESOURCES.vidrenderEncode`——解析顺序为运行环境包 `vidrender` 根 → 安装包 extraResources `bin` → dev 仓库 `resources/bin`；找不到返回空串，本模块据此抛「未找到 vidrender-encode：请在设置里下载 Rust 编码内核运行环境包」（由 `video.ts` 转成「小内核渲染失败：…」回执）。

## 2. 导出与关键实现

### 2.1 `VidrenderOptions`（接口）

| 字段 | 类型 | 说明 |
|---|---|---|
| `entryHtml` | `string` | 产品在 `.render-tmp/` 下写好的入口 HTML（绝对路径） |
| `output` | `string` | 成片输出路径（产品侧传 `video.ts` 的 `outMp4`） |
| `canvas` | `RenderCanvas` | 成片画布方向（`landscape` / `portrait` / `square`），尺寸取 `CANVAS_SIZES[canvas]` |
| `fps` | `number` | 帧率（产品侧传档位 `fps`，缺省 30） |
| `quality?` | `RenderQuality` | 渲染档位质量，缺省按 `standard`；映射 crf：`draft = 26` / `standard = 20` / `high = 18` |
| `audio?` | `string` | 背景音频绝对路径；**不传时**由 `resolveLocalRefs()` 从 `<audio id="myv-bgm">` 解析出的 `bgmPath` 兜底 |
| `onProgress?` | `(text: string) => void` | 进度文本回调（`[小内核] …`），`video.ts` 把它经 `event.sender.send(IPC.Video.Progress, { text })` 回推 |

### 2.2 `renderWithVidrender(opts)` 的收尾语义

- `finally` 里**总是**清理：`child.exitCode === null` 时 `kill()` 子进程、`win.close()` 关窗口（异常路径也不留孤儿）。
- 子进程 `close` 的退出码非 0 时抛错，并附上 `stderrTail`（最近 4000 字符）便于排障；`child.on('error')` 的启动错误单独记录并优先抛出。
- 成片写完后 `child.stdin.end()`，等 `close` 回执再返回 `output`。

## 3. 关键流程

### 3.1 解析入口与音频（源码逐条）

1. `const exe = hfEnv.BUILTIN_RESOURCES.vidrenderEncode`；空串直接抛「未找到 vidrender-encode」。
2. `size = CANVAS_SIZES[opts.canvas]`，`frameSize = size.width * size.height * 4`（每帧 BGRA 位图字节数，用于抓帧尺寸校验）。
3. 读 `entryHtml` 原文，正则 `\bdata-(?:hf-)?duration\s*=\s*["']([\d.]+)["']` 取时长；取不到或非正数按 3 秒；`total = Math.max(1, Math.round(duration * opts.fps))`。
4. `resolveLocalRefs(entryHtml)`（**产品侧相对 demo 多出来的关键一步**）：
   - 入口在 `.render-tmp/`，而 HTML 里的 `src` / `href` 是按**项目根**写的；对每条引用，若协议 / `//` / `#` / `../` / 绝对路径则原样保留；若 `.render-tmp` 下存在则原样；**若仅项目根下存在则回退成 `../<ref>`**；其余原样。已 hoist 过的 `../gsap.min.js` 与裁剪副本 `./media/xxx` 不会被改动。
   - 从 `<audio id="myv-bgm">`（`BGM_TAG_ID`）里解析 `src`：先在 `.render-tmp` 下找，找不到再按项目根找，存在才记下 `bgmPath`（绝对路径）。
   - 改写后的 HTML 写成同目录下的 **`entry.vidrender.html`**，返回 `{ htmlPath, bgmPath }`。
5. `audio = opts.audio || bgmPath`；有音频时给编码进程追加 `--audio <绝对路径>`（小内核默认循环，与 `<audio loop>` 一致）。

### 3.2 进程与窗口

1. `env = { ...process.env }`，`hfEnv.BUILTIN_RESOURCES.ffmpegBin` 存在时前置进 `PATH`（编码 / 素材探测用）。
2. 编码参数：`--width <w> --height <h> --fps <fps> --pix-fmt bgra --input-format raw --crf <crf> --output <output>`，可选 `--audio <path>`；`spawn(exe, args, { env, stdio: ['pipe','pipe','pipe'], windowsHide: true })`。
3. 隐藏窗口：`new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true, autoplayPolicy: 'no-user-gesture-required', nodeIntegration: false, contextIsolation: true } })`，画布尺寸来自 `CANVAS_SIZES`；`loadFile(htmlPath)` 后执行 `VIDEO_READY_SCRIPT`。

### 3.3 等视频就绪、逐帧 seek 与抓帧

1. **等 `<video> loadeddata`**（产品 composition 没有 demo 的 `__videoReady` 钩子）：`VIDEO_READY_SCRIPT` 遍历所有 `<video>`，`readyState >= 2` 直接计数，否则监听 `loadeddata` / `error`，并留 5 秒兜底，全部完成才 resolve（页面没有 `<video>` 时立即 resolve）。
2. **逐帧**（`f` 从 0 到 `total - 1`，时刻 `f / opts.fps`）：
   - `executeJavaScript(seekScript(t), true)`：暂停并 `time(t)`（或 `seek(t, false)`）所有 `window.__timelines` 时间轴；对每个 `<video>` 暂停后把 `currentTime` 设为 `t`（钳到 `[0, duration - 0.001]`），用 `seeked` 事件确认、2 秒兜底；最后双 `requestAnimationFrame` 等画面落地。**片中视频不 seek 会一直停首帧**，这一步与 demo 一致。
   - `win.webContents.capturePage()` → `image.crop({ x: 0, y: 0, width: size.width, height: size.height })` → `toBitmap()`；字节数必须等于 `frameSize`，否则抛「抓帧尺寸不符」。
   - `writeAll(child.stdin, buf)` 写进编码进程 stdin：背压时等 `drain`，并注册 / 摘除 `error` 监听（避免累积 MaxListeners 警告）。
   - 每 15 帧给一次 `[小内核] seek f/total` 进度。
3. `child.stdin.end()` → 等 `close` → 检查 `spawnError` 与退出码 → 返回 `opts.output`。
4. stderr 的 JSON 行：`{"event":"progress","frame":…}` → `[小内核] 编码 N/total 帧`；`{"event":"error","message":…}` → `[小内核] <message>`；其它（如 ffmpeg 原始行）忽略，不刷屏。

## 4. 依赖与协作

| 方向 | 对象 | 用途 |
|---|---|---|
| 依赖 | `electron` 的 `BrowserWindow` | 隐藏离屏窗口加载改写后的入口、逐帧执行 seek JS 与抓帧 |
| 依赖 | `node:child_process` 的 `spawn` / `ChildProcess` | 启动 `vidrender-encode` 并写 raw BGRA 帧 |
| 依赖 | `node:fs` / `node:path` | 读入口 HTML、写 `entry.vidrender.html`、判断本地资源与 BGM 文件是否存在 |
| 依赖 | `../shared/constants` | `CANVAS_SIZES`（画布宽高 → 窗口尺寸、crop 尺寸、帧字节数） |
| 依赖（仅类型） | `../shared/types` | `RenderCanvas`、`RenderQuality` |
| 依赖 | `./projects/bgm` | `BGM_TAG_ID`（`myv-bgm`），用于从入口 HTML 解析 BGM |
| 依赖 | `./hfEnv` | `BUILTIN_RESOURCES.vidrenderEncode` 与 `BUILTIN_RESOURCES.ffmpegBin` |
| 被使用 | [`./video.ts`](./video.ts.md) | `backend === 'vidrender'` 分支调用；传 `entryHtml` / `output` / `canvas` / `fps` / `quality` / `onProgress`，并在成功 / 失败后清理 `.render-tmp/` |
| 关系 | `scripts/demo-vidrender.cjs` | **同一条抓帧路径的产品化实现**（见 §5） |

## 5. 与 demo 脚本的关系、未验证边界

- **与 demo 的关系**：`npm run demo:vidrender`（`scripts/demo-vidrender.cjs`，159 行）先在 `test/fixtures/vidrender/` 的 640×360 最小 composition 上验证了「逐帧 seek → `capturePage()` → `crop()` → `toBitmap()` → 写 `vidrender-encode` stdin」这条路径（CHANGELOG #119 / #123）；本模块把它搬到产品里，额外承担三件 demo 不需要做的事：**入口 HTML 本地资源 `../` 回退**、**BGM 绝对路径解析**、**按项目画布取 `CANVAS_SIZES` 并把进度接进 `video:progress`**。demo 本身仍独立于产品流程。
- **已验证**：`npm run typecheck` 三工程（node / web / agent）退出码 0；`npm run demo:vidrender` 回归 **60 帧 / 2.00 秒 / 160,588 字节、无警告**（CHANGELOG #124）。
- **未验证（别当成已打通）**：**真实项目 A/B 渲染**（尺寸 / 帧数 / 音轨 / `<video>` / 长片）、**打包产物**、**macOS**；黄金帧回归与静态帧复用（M3）仍未做。

## 6. 注意事项与实现要点

- **抓帧只走 `capturePage()` 一条路径**：历史诊断表明 `beginFrameSubscription` 依赖 presentation 事件、隐藏离屏窗口会合并 / 跳过呈现，`invalidate()` 触发的是 `paint` 事件且实测 300ms 内无回调，故订阅路径不稳定；现在每帧按需抓页、无警告、无停顿。抓到的图比 composition 视口略大，必须 `crop` 到画布宽高（每帧恰好 `宽 × 高 × 4` 字节）。
- **入口改写产物是临时文件**：`entry.vidrender.html` 与 `entry.html` 同在 `.render-tmp/` 下，由 `video.ts` 在渲染成功 / 失败时一起删掉；本模块不负责删临时目录，只负责清理自己的子进程与窗口。
- **本地资源回退有边界**：只处理「在 `.render-tmp` 下不存在、在项目根存在」的 `src` / `href`；已是协议 URL、`//`、`#`、`../`、绝对路径或 `.render-tmp` 下已有的引用一律不动。它不复制文件、也不改用户原件。
- **BGM 的路径来自标签解析**：`opts.audio` 优先；未传时只从 `<audio id="myv-bgm">` 解析且文件确实存在才作为 `--audio`，否则没有音轨参数。
- **位图格式写死 `--pix-fmt bgra`**（与抓帧 `toBitmap()` 的本机实测格式一致）；demo 另有 `VIDRENDER_PIX_FMT` 环境变量兜底，产品模块没有这个开关。
- **进度文案统一带 `[小内核]` 前缀**：渲染层 `useRenderProgress.ts` 解析 `video:progress` 文本时看到的就是这些行；seek 每 15 帧一次、编码进度按 stderr 的 `progress` 事件给。
- **错误要可读**：缺包、抓帧尺寸不符、子进程启动失败、非 0 退出码（附 stderr 尾部）都抛出来，由 `video.ts` 统一包装成「小内核渲染失败：…」；不要在模块内吞掉。
