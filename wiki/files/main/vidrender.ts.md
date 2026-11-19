# src/main/vidrender.ts

> 产品侧「Rust 小内核」渲染后端（本版新增的**双后端**里的新路径）：从 `video.ts` 已准备好的 `<项目>/.render-tmp/entry.html` 出发，做本地资源回退与 BGM 路径解析；**渲染模式**下先用 `measureVideoBoxes()` 量出每个 `<video>` 的显示盒子，再用 FFmpeg 按输出 fps 把本地 `<video>` 抽成 **JPG** 帧（#132，默认 auto：带 alpha 才 PNG、其余 JPG，`-q:v 3` 对应上游 draft 质量），按显示尺寸抽帧（#133，cover 精确模拟），在页面里插入继承样式与 `data-*` 计时的隐藏 `<img>` 兄弟，逐帧只换 `img.src` 并等 `decode()`（**不再逐帧 seek `<video>`**），再经 `capturePage()` → `crop()` / `resize()` 尺寸归一化 → `toBitmap()` 把 BGRA 位图写进 `vidrender-encode` 的 stdin 生成 MP4；抽帧阶段（#131）按入口 HTML 读出的成片时长 `maxDuration` 限制 ffmpeg `-t`、只抽成片范围内的帧，并给 ffmpeg 加 5 分钟超时 kill 保护，避免主进程被全量抽帧拖垮、IPC handler 不返回（渲染层只会收到 `reply was never sent`）；**#135 又定位了一类同症状但不同根因的挂起——编码器二进制是旧版、不支持 `--audio`，第 0 帧 `writeAll()` 永久等 `drain`，同样导致 IPC handler 不返回（见 §3.3 / §6 / §7）**；进度经回调回推，**不注册任何 IPC 频道**。默认后端仍是 `hyperframes`，只有用户在设置页「渲染档位」·「渲染引擎」显式切到 `vidrender` 时才进入本模块。

- **所在目录**：src/main/
- **类型**：主进程渲染后端模块（无 IPC 注册、无业务数据读写；外部进程 + 离屏窗口编排）
- **规模**：`vidrender.ts` **178 行**（实测 `[IO.File]::ReadAllLines`；本版由旧的 192 行重写为渲染模式 152 行，#128 抓帧尺寸修复 +8 行到 160，#130 尺寸归一化再 +12 行到 172；#131 时长限制与超时保护只改配套的抽帧模块、本文件行数不变；#133 配套改动（import 增 `measureVideoBoxes` / `type VideoBox`、`loadFile` 后先量盒子再把 `boxes` 作第 5 参传给 `extractVideoFrames`）使本文件由 172 增至 **178**）；#134 加诊断打点（`import { debugLog }` 与 13 处 `debugLog(...)` 调用，共 +14 行）增至 192；#135 给 `writeAll()` 加 10 秒超时 + `close` 兜底 + `settled` 收口再 +14 行至实测 **206 行**（`[IO.File]::ReadAllLines`；与 CHANGELOG #135 记的 192 → 206 一致）；**#137 给进度回调补「耗时 / 剩余时间 / fps」显示**：`let child: ChildProcess | null = null` 之后加 `const renderStart = Date.now()`（+1 行），抽帧调用前加 `const extractStart = Date.now()` 并在有 tables 时推一条「抽帧 N 路，用时 X.Xs」（+4 行），逐帧原来每 15 帧一条单行 `seek` 文案扩成「已用 / 剩余 / fps」8 行块（净 +7 行），结束加 `totalSec` 与「渲染完成」文案（+2 行），共 +14 行至实测 **220 行**（`[IO.File]::ReadAllLines`；与 CHANGELOG #137 记的 206 → 220 一致）；配套的 `vidrenderFrames.ts` **277 行**（本版新增；#131 抽帧时长限制 + 5 分钟超时保护后由 211 行增至 231 行；#132 改 JPG、#133 新增 `VideoBox` / `measureVideoBoxes` / 按盒子 scale+crop/pad/disregard 滤镜后由 231 行增至 **277 行**）。两者强耦合，**合在本篇说明**，不为 `vidrenderFrames.ts` 单独开 wiki 页。
- **对外导出**：接口 `VidrenderOptions`；函数 `renderWithVidrender(opts: VidrenderOptions): Promise<string>`（成功返回 `opts.output`，即成片绝对路径）
- **新分工**：`vidrender.ts` 负责入口准备、编码进程与窗口编排、逐帧抓帧与写 stdin；抽帧 / 量盒子 / 注入 / seek 四件事全部搬到 `./vidrenderFrames.ts`（见 §5）。

## 1. 作用与职责

- **产品侧小内核渲染**：与 demo（`scripts/demo-vidrender.cjs`）同构，但吃的是产品已经写好的渲染入口 `<projDir>/.render-tmp/entry.html`，而不是 demo 的 fixture。负责本地资源回退、BGM 绝对路径解析、画布尺寸、渲染模式抽帧换图（#132 起抽 JPG、#133 起按显示尺寸抽）、逐帧抓帧（#130 起抓帧处做尺寸归一化）、进度回调与子进程 / 窗口 / 临时帧目录清理。
- **不注册 IPC**：全部由 [`video.ts`](./video.ts.md) 在 `backend === 'vidrender'` 分支直接 `await renderWithVidrender(...)` 调用；进度由回调交给 `video.ts` 再经既有 `video:progress` 频道推给渲染层。**没有新增 / 删除 IPC 频道**。
- **与 hyperframes 的关系**：后端按 `settings.getRenderBackend()` 二选一，默认 hyperframes 的原 CLI 路径完全保留；本模块只在用户显式切换后才进入。两后端共用 `video.ts` 的入口准备（合规校验、无限循环守卫、裁超长媒体、写 `.render-tmp/entry.html`），只是「渲染那一段」换掉。
- **小内核二进制定位**：`hfEnv.BUILTIN_RESOURCES.vidrenderEncode`——解析顺序为运行环境包 `vidrender` 根 → 安装包 extraResources `bin` → dev 仓库 `resources/bin`；找不到返回空串，本模块据此抛「未找到 vidrender-encode：请在设置里下载 Rust 编码内核运行环境包」（由 `video.ts` 转成「小内核渲染失败：…」回执）。**抽帧用的 FFmpeg 另由 `vidrenderFrames.ts` 从 `hfEnv.BUILTIN_RESOURCES.ffmpeg` 定位**（见 §5.4）。

## 2. 导出与关键实现

### 2.1 `VidrenderOptions`（接口）

| 字段 | 类型 | 说明 |
|---|---|---|
| `entryHtml` | `string` | 产品在 `.render-tmp/` 下写好的入口 HTML（绝对路径） |
| `output` | `string` | 成片输出路径（产品侧传 `video.ts` 的 `outMp4`） |
| `canvas` | `RenderCanvas` | 成片画布方向（`landscape` / `portrait` / `square`），尺寸取 `CANVAS_SIZES[canvas]` |
| `fps` | `number` | 帧率（产品侧传档位 `fps`，缺省 30）；**同时是抽帧 fps 与逐帧 seek 的时间步长** |
| `quality?` | `RenderQuality` | 渲染档位质量，缺省按 `standard`；映射 crf：`draft = 26` / `standard = 20` / `high = 18` |
| `audio?` | `string` | 背景音频绝对路径；**不传时**由 `resolveLocalRefs()` 从 `<audio id="myv-bgm">` 解析出的 `bgmPath` 兜底 |
| `onProgress?` | `(text: string) => void` | 进度文本回调（`[小内核] …`），`video.ts` 把它经 `event.sender.send(IPC.Video.Progress, { text })` 回推；抽帧进度与首帧归一化提示也走它；#137 起还推抽帧用时、每 15 帧的「已用 / 剩余 / fps」与结束的「渲染完成、平均 fps」文案 |

### 2.2 `renderWithVidrender(opts)` 的收尾语义

- `finally` 里**总是**清理三样：`child.exitCode === null` 时 `kill()` 子进程、`win.close()` 关窗口、`fs.rmSync(framesDir(path.dirname(htmlPath)), { recursive: true, force: true })` 删掉本次抽帧的临时目录（异常路径也不留孤儿 / 不留残帧）。
- **抽帧临时目录归本模块清理**：`framesDir()` 由 `vidrenderFrames.ts` 导出、按 `process.pid` 命名，路径固定在 `.render-tmp/` 内；`video.ts` 随后删整个 `.render-tmp/`，这里先把帧目录收干净。
- 子进程 `close` 的退出码非 0 时抛错，并附上 `stderrTail`（最近 4000 字符）便于排障；`child.on('error')` 的启动错误单独记录并优先抛出。
- 成片写完后 `child.stdin.end()`，等 `close` 回执再返回 `output`。

## 3. 关键流程

### 3.1 解析入口与音频（源码逐条）

1. `const exe = hfEnv.BUILTIN_RESOURCES.vidrenderEncode`；空串直接抛「未找到 vidrender-encode」。
2. `size = CANVAS_SIZES[opts.canvas]`，`frameSize = size.width * size.height * 4`（每帧 BGRA 位图字节数，是 #130 归一化后字节数校验的目标）。
3. 读 `entryHtml` 原文，正则 `\bdata-(?:hf-)?duration\s*=\s*["']([\d.]+)["']` 取时长（认 `data-duration` / `data-hf-duration`；本项目入口 HTML 的舞台 `<div id="main" … data-duration="45">` 实测读出 **45 秒**，`<html … data-composition-duration="45">` 只是页面自描述、该正则不读它）；取不到或非正数按 3 秒；`total = Math.max(1, Math.round(duration * opts.fps))`。**这个 `duration` 同时作为第 4 参 `maxDuration` 传给 `extractVideoFrames`（见 §3.3 / §5.4），让抽帧只覆盖成片时长。**
4. `resolveLocalRefs(entryHtml)`（**产品侧相对 demo 多出来的关键一步**）：
   - 入口在 `.render-tmp/`，而 HTML 里的 `src` / `href` 是按**项目根**写的；对每条引用，若协议 / `//` / `#` / `../` / 绝对路径则原样保留；若 `.render-tmp` 下存在则原样；**若仅项目根下存在则回退成 `../<ref>`**；其余原样。已 hoist 过的 `../gsap.min.js` 与裁剪副本 `./media/xxx` 不会被改动。
   - 从 `<audio id="myv-bgm">`（`BGM_TAG_ID`）里解析 `src`：先在 `.render-tmp` 下找，找不到再按项目根找，存在才记下 `bgmPath`（绝对路径）。
   - 改写后的 HTML 写成同目录下的 **`entry.vidrender.html`**，返回 `{ htmlPath, bgmPath }`。
5. `audio = opts.audio || bgmPath`；有音频时给编码进程追加 `--audio <绝对路径>`（小内核默认循环，与 `<audio loop>` 一致）。**音频不参与逐帧同步**——BGM 走 `--audio` 离线 mux。**编码器二进制必须支持 `--audio`**：旧版收到该参数会立即退出、写 stdin 永久挂起（#135，见 §6 / §7）。

### 3.2 进程与窗口

1. `env = { ...process.env }`，`hfEnv.BUILTIN_RESOURCES.ffmpegBin` 存在时前置进 `PATH`（编码 / 抽帧的 ffmpeg 探测用）。
2. 编码参数：`--width <w> --height <h> --fps <fps> --pix-fmt bgra --input-format raw --crf <crf> --output <output>`，可选 `--audio <path>`；`spawn(exe, args, { env, stdio: ['pipe','pipe','pipe'], windowsHide: true })`。
3. 隐藏窗口：`new BrowserWindow({ width: size.width, height: size.height, show: false, frame: false, webPreferences: { offscreen: true, autoplayPolicy: 'no-user-gesture-required', nodeIntegration: false, contextIsolation: true } })`，画布尺寸来自 `CANVAS_SIZES`。源码带 3 行注释（逐字）：**「去掉窗口外框（标题栏约 17px + 边框 3px）：无边框窗口的内容视口严格等于 `width×height`，`capturePage()` 才抓得到完整画布。实测 `useContentSize:true` 在本机 offscreen 窗口上无效（截图反而是 1923×1063），故改走 `frame:false`。」** 这是 #129 对 #128 `useContentSize: true` 的更正（时间线见 §7）。**#130 起 `frame: false` 仅作无害保留——它不再是尺寸兜底：最终兜底是 §3.3 的「抓帧归一化」。#129 的 `frame: false` 实跑截图仍是 1923×1063，与 #128 `useContentSize` 的结果完全一致，继续调窗口参数无效。**

### 3.3 抽帧、注入、逐帧 seek 与抓帧（渲染模式主链路）

调用顺序固定在 `try` 块里，`spawn` 之前先完成量盒子、抽帧与注入；`let child: ChildProcess | null = null` 之后紧接 `const renderStart = Date.now()`（#137 新增），作为本次渲染的计时起点——下面的抽帧用时、逐帧「已用 / 剩余 / fps」和结束总耗时都从它起算：

1. `await win.loadFile(htmlPath)`——先加载改写后的入口。
2. **量显示盒子（#133）**：`const boxes = await win.webContents.executeJavaScript(measureVideoBoxes()) as VideoBox[]`——页面执行一段 JS，`document.querySelectorAll('video')` 逐个取 `getBoundingClientRect()` 与 `getComputedStyle(v).objectFit`，返回 `{documentIndex,width,height,fit}`（宽高 `Math.round`，fit 只保留 cover/contain/fill、其余当 fill；见 §5.3）。
3. `const tmpDir = path.dirname(htmlPath)`；`const extractStart = Date.now()`（#137 新增，紧贴抽帧调用前）后 `const tables = await extractVideoFrames(htmlPath, tmpDir, opts.fps, duration, boxes, opts.onProgress)`——按 fps 抽出**成片时长范围内**所有本地视频的 JPG 帧表（第 4 参 `duration` 即 §3.1 从入口读出的成片时长，作为 `maxDuration`；第 5 参 `boxes` 即上一步量到的显示盒子，使抽帧按显示尺寸而非画布全尺寸；`onProgress` 后移为第 6 参；实现见 §5.4）。**抽帧用时提示（#137）**：`tables` 非空时紧接一条 `opts.onProgress?.(`[小内核] 抽帧 ${tables.length} 路，用时 ${((Date.now() - extractStart) / 1000).toFixed(1)}s`)`，即文案 `[小内核] 抽帧 N 路，用时 X.Xs`（从 `extractStart` 到抽帧返回，单位秒，保留 1 位小数）。
4. `if (tables.length) await win.webContents.executeJavaScript(injectionScript(tables))`——有帧表才注入隐藏 `<img>` 兄弟（实现见 §5.5）。**没有 `<video>` / 全部跳过时 `tables` 为空，跳过注入**。
5. `child = spawn(exe, args, …)`——此时才启动编码进程，开始接 raw BGRA 帧。
6. **逐帧**（`f` 从 0 到 `total - 1`，时刻 `f / opts.fps`）：
   - `executeJavaScript(seekScript(f / opts.fps), true)`：这里的 `seekScript` **来自 `./vidrenderFrames`**，不再是旧模块里「写 `video.currentTime` + 等 `seeked` + 2 秒兜底」的实现；它定位 GSAP 时间轴、按时间映射换 `img.src` 并等 `decode()`（见 §5.6）。片中视频靠隐藏 `<img>` 换帧显示，不再 seek 媒体管线。
   - **抓帧 + 尺寸归一化（#130，视频管线的最终兜底）**：`let warned = false` 声明在逐帧循环之外、`const exited` 之后，保证「截图已归一化」进度只在首帧推一次。四步口径 = `crop` 切掉多余边框 → 尺寸不足 `resize` 到画布 → 首帧推一次归一化进度 → 字节数校验。循环内源码（#134 起夹有 `debugLog(...)` 诊断打点，下面摘录省略了这些打点行，保留的是抓帧与校验语句）：

      ```ts
      const image = await win.webContents.capturePage()
      const shot = image.getSize()
      // Windows offscreen 窗口的 capturePage 实得尺寸会因外框 / DPI 抖动（实测 1920×1063、
      // 1923×1063），frame:false / useContentSize 在本机都不稳定。不再依赖窗口尺寸：
      // 先把截图裁到目标宽高（多余边框切掉），尺寸不足时再缩放补齐，保证每帧字节数恒定。
      let normalized = image.crop({ x: 0, y: 0, width: Math.min(shot.width, size.width), height: Math.min(shot.height, size.height) })
      if (shot.width !== size.width || shot.height !== size.height) {
        normalized = normalized.resize({ width: size.width, height: size.height, quality: 'good' })
        if (!warned) {
          warned = true
          opts.onProgress?.(`[小内核] 截图 ${shot.width}×${shot.height}，已归一化到 ${size.width}×${size.height}`)
        }
      }
      const buf = normalized.toBitmap()
      if (buf.length !== frameSize) {
        throw new Error(
          '抓帧尺寸不符：截图 ' + shot.width + '×' + shot.height +
          '，归一化后 ' + buf.length + ' 字节，期望 ' + size.width + '×' + size.height + '（' + frameSize + ' 字节）'
        )
      }
      await writeAll(child.stdin!, buf)
      ```

      ① `crop` 用 `Math.min(shot, size)` 取宽高，先把比画布多出来的边框切掉；② 只要截图宽或高与目标画布不一致就 `resize({ width: size.width, height: size.height, quality: 'good' })` 补齐尺寸；③ 首次发生尺寸不一致时推一次 `[小内核] 截图 <shot.width>×<shot.height>，已归一化到 <size.width>×<size.height>`（`warned` 保证后续帧不再重复推，也不再因尺寸抖动中断整次渲染）；④ 仍以 `buf.length !== frameSize` 作最后一道防线，报错文案改为「抓帧尺寸不符：截图 W×H，归一化后 N 字节，期望 W×H（frameSize 字节）」，带实际截图宽高与归一化后字节数便于定位。
   - **`writeAll(child.stdin, buf)`（#135 加固）**：写进编码进程 stdin；`stream.write(buf)` 返回 `true` 时直接 `onDrain()` 收口，返回 `false` 时等 `drain`。注册 `drain` / `error` / `close` 三个一次性监听，**`settled` 标志保证 resolve / reject 只发生一次**，`cleanup()` 统一 `off` 掉三个监听并 `clearTimeout(timer)`（避免累积 MaxListeners 警告）。新增 **10 秒超时**：到点若未 `settled`，报 `写入编码器 stdin 超时（10s）：编码器可能已提前退出（参数不兼容？）`；另加 `stream.once('close', onClose)`，`onClose` 转成 `编码器在写入期间退出` 走同一条 `onError` 收口。这样编码器提前退出（参数不兼容 / 崩溃）时 `drain` 永不到来也不会让 `await` 永久挂起——这是 #135 修掉的 `reply was never sent` 真正根因（见 §6 / §7）。源码逐字：
     ```ts
     function writeAll(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
       return new Promise((resolve, reject) => {
         let settled = false
         const cleanup = () => {
           stream.off('drain', onDrain); stream.off('error', onError); stream.off('close', onClose); clearTimeout(timer)
         }
         const onDrain = () => { if (settled) return; settled = true; cleanup(); resolve() }
         const onError = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(e) }
         // 编码器提前退出（参数错误 / 崩溃）时 drain 永远不来，await 会永久挂起，
         // IPC handler 不返回 → 渲染层只收到 "reply was never sent"（实测踩过）。
         // 加 10s 超时把它变成明确错误，且 close 时也兜底 reject。
         const timer = setTimeout(() => {
           if (settled) return
           settled = true
           cleanup()
           reject(new Error('写入编码器 stdin 超时（10s）：编码器可能已提前退出（参数不兼容？）'))
         }, 10000)
         const onClose = () => onError(new Error('编码器在写入期间退出'))
         stream.once('close', onClose)
         if (stream.write(buf)) { onDrain(); return }
         stream.once('drain', onDrain)
         stream.once('error', onError)
       })
     }
     ```
   - **每 15 帧的耗时 / 剩余 / fps 进度（#137）**：原「每 15 帧一条 `[小内核] seek f/total`」改为带时间口径的文案（底层仍是换图，不再 seek 媒体）。源码逐字：

      ```ts
      if (f % 15 === 0) {
        const elapsed = (Date.now() - renderStart) / 1000
        const fps = elapsed > 0.05 ? (f + 1) / elapsed : 0
        const remain = fps > 0 ? (total - f - 1) / fps : 0
        opts.onProgress?.(
          `[小内核] ${f + 1}/${total} 帧 · 已用 ${elapsed.toFixed(1)}s · 剩余约 ${remain.toFixed(0)}s · ${fps.toFixed(1)} fps`
        )
      }
      ```

     文案格式为 `[小内核] <已完成帧>/<总帧> 帧 · 已用 <X.X>s · 剩余约 <N>s · <X.X> fps`：`elapsed` 从 `renderStart` 起算（秒），`fps = (f + 1) / elapsed`（仅当 `elapsed > 0.05`，否则 0，避免起步阶段除零抖动），`remain = (total - f - 1) / fps`（仅当 `fps > 0`，否则 0）；`elapsed` 与 `fps` 用 `toFixed(1)`，`remain` 用 `toFixed(0)` 取整。触发条件仍是 `f % 15 === 0`（f 从 0 起，即第 1 / 16 / 31 … 帧），与 #137 之前的 15 帧节流间隔一致。
7. `child.stdin.end()` → 等 `close` → 检查 `spawnError` 与退出码 → **渲染完成文案（#137）**：`const totalSec = (Date.now() - renderStart) / 1000` 后 `opts.onProgress?.(`[小内核] 渲染完成：${total} 帧 / ${totalSec.toFixed(1)}s（平均 ${(total / totalSec).toFixed(1)} fps）`)`，即 `[小内核] 渲染完成：N 帧 / X.Xs（平均 X.X fps）`（总耗时从 `renderStart` 起算，平均 fps = 总帧数 / 总秒数）→ 返回 `opts.output`。
8. stderr 的 JSON 行：`{"event":"progress","frame":…}` → `[小内核] 编码 N/total 帧`；`{"event":"error","message":…}` → `[小内核] <message>`；其它（如 ffmpeg 原始行）忽略，不刷屏。

## 4. 依赖与协作

| 方向 | 对象 | 用途 |
|---|---|---|
| 依赖 | `electron` 的 `BrowserWindow` | 隐藏离屏窗口加载改写后的入口、逐帧执行 seek JS 与抓帧 |
| 依赖 | `node:child_process` 的 `spawn` / `ChildProcess` | 启动 `vidrender-encode` 并写 raw BGRA 帧 |
| 依赖 | `node:fs` / `node:path` | 读入口 HTML、写 `entry.vidrender.html`、判断本地资源与 BGM 文件是否存在、`rmSync` 清帧目录 |
| 依赖 | **`./vidrenderFrames`** | **`extractVideoFrames` / `framesDir` / `injectionScript` / `measureVideoBoxes` / `seekScript` 与 `type VideoBox`（本版新增的抽帧换图实现，见 §5）** |
| 依赖 | `../shared/constants` | `CANVAS_SIZES`（画布宽高 → 窗口尺寸、归一化目标尺寸、帧字节数） |
| 依赖（仅类型） | `../shared/types` | `RenderCanvas`、`RenderQuality` |
| 依赖 | `./projects/bgm` | `BGM_TAG_ID`（`myv-bgm`），用于从入口 HTML 解析 BGM |
| 依赖 | `./hfEnv` | `BUILTIN_RESOURCES.vidrenderEncode` 与 `BUILTIN_RESOURCES.ffmpegBin`（ffmpeg 本体由 `vidrenderFrames.ts` 取） |
| 依赖（#134 诊断） | `./debugLog` | **`debugLog(tag, msg)` 追加到 `%APPDATA%/shadowmill/debug-render.log`**；#134 加的临时诊断设施，定位后**打点保留**供后续排查（见 §6） |
| 被使用 | [`./video.ts`](./video.ts.md) | `backend === 'vidrender'` 分支调用；传 `entryHtml` / `output` / `canvas` / `fps` / `quality` / `onProgress`，并在成功 / 失败后清理 `.render-tmp/` |
| 关系 | `scripts/demo-vidrender.cjs` | **同一条抓帧路径的产品化实现**（见 §6） |

## 5. `vidrenderFrames.ts` —— 渲染模式抽帧换图（277 行，合在本篇）

本文件**本版新增，但不单开 wiki 页**：它与 `vidrender.ts` 强耦合（主流程调它的几个导出、finally 用它的 `framesDir`），合在一篇里讲更清楚。文件头写明动机：浏览器逐帧 seek `<video>` 会把媒体管线踢起来、饿死渲染循环（真实合成实测 ~5s/帧）；这里照搬 Rust 大内核已验证的方案——渲染前用 FFmpeg 按输出 fps 把本地视频抽成帧、在页面里插入继承样式与 `data-*` 计时的隐藏 `<img>` 兄弟，逐帧只换 `img.src` + 等 `decode()`；原视频隐藏（可见性仍由 GSAP 管），音频不参与渲染同步。**#131 起新增时长限制与超时保护**：`extractVideoFrames` 第 4 参 `maxDuration` 让 ffmpeg 只抽成片范围内的帧（避免 225 秒素材被全量抽成 ≈6763 张 1920×1080 帧、十几 GB，拖垮主进程导致 IPC handler 不返回），`runFfmpeg` 加 5 分钟超时 kill 与 `settled` / `finish()` 收口（见 §5.4）。**#132 把帧格式从 PNG 改为 JPG**（`-q:v 3`），**#133 新增按页面实测的显示盒子抽帧**（`VideoBox` / `measureVideoBoxes` / scale+crop/pad/disregard 滤镜）：本机实测同素材 1350 帧全画布 PNG **1733MB** → 全画布 JPG **260MB**（−85%）→ 按显示尺寸 **490×600** JPG **58.2MB**（相对原 PNG −96.6%），ffprobe 确认抽帧输出 490×600。**源码文件头注释仍写「抽成 PNG」为旧文案，实际输出已是 `.jpg`。**

### 5.1 对外契约（7 个导出：2 个接口 + 5 个函数）

| 导出 | 签名 | 被谁用 / 用途 |
|---|---|---|
| `interface FrameTable` | 见 §5.2 | `extractVideoFrames` 的返回值、`injectionScript` / `seekScript` 的输入 |
| `interface VideoBox` | 见 §5.2（#133 新增） | 页面里一个 `<video>` 的显示盒子，`extractVideoFrames` 第 5 参 `boxes` 的元素类型 |
| `measureVideoBoxes()` | `string`（#133 新增） | `vidrender.ts` 在 `loadFile` 后 `executeJavaScript` 执行，返回 `VideoBox[]` |
| `extractVideoFrames(entryHtml, root, fps, maxDuration, boxes: VideoBox[] = [], onProgress?)` | `Promise<FrameTable[]>` | `vidrender.ts` 在 `loadFile` 后、`spawn` 前调用；第 4 参 `maxDuration` 传入口 HTML 读出的 `duration`（本项目 45 秒），第 5 参 `boxes` 为上一步量到的显示盒子（缺省 `[]`），`onProgress` 后移为第 6 参 |
| `framesDir(root)` | `string` | `vidrender.ts` 的 `finally` 用来删临时帧目录 |
| `injectionScript(tables)` | `string` | 有帧表时 `executeJavaScript` 注入页面 |
| `seekScript(t)` | `string` | 每帧 `executeJavaScript(seekScript(f / opts.fps), true)` |

### 5.2 `FrameTable` 与 `VideoBox`（两个接口）

`FrameTable`（把 composition 时间 t 映射到源视频帧号）：

| 字段 | 来源 |
|---|---|
| `documentIndex` | `<video>` 在 `htmlVideos()` 扫描结果里的下标 |
| `start` | `data-start`，缺省 0 |
| `duration` | `data-duration`，缺省 `Infinity` |
| `mediaStart` | `data-media-start`，缺省回退到 `data-playback-start`，再缺省 0 |
| `rate` | `data-playback-rate`，缺省 1 |
| `looped` | 标签上是否含 `loop`（`/\bloop\b/i`） |
| `count` | 该视频目录里 `.jpg` 文件个数 |
| `base` | `./<帧目录 basename>/<documentIndex>`（相对渲染入口的 URL 前缀，正斜杠） |
| `fps` | 调用方传入的输出 fps |
| `sourceDuration` | `count / fps` |

`VideoBox`（#133 新增，页面里一个 `<video>` 的显示盒子，CSS 像素，由 `measureVideoBoxes()` 实测得到），源码逐字：

```ts
export interface VideoBox {
  documentIndex: number
  width: number
  height: number
  fit: 'cover' | 'contain' | 'fill'
}
```

| 字段 | 来源 |
|---|---|
| `documentIndex` | `querySelectorAll('video')` 的下标，与 `FrameTable.documentIndex` 对应 |
| `width` / `height` | `Math.round(getBoundingClientRect().width / .height)`，宽或高为 0 则该视频不记盒子 |
| `fit` | `getComputedStyle(v).objectFit`，只保留 `cover` / `contain` / `fill`，其余当 `fill` |

### 5.3 `measureVideoBoxes()`（#133 新增，量每个 `<video>` 的显示盒子）

- 返回一段**自执行 JS 字符串**，由 `vidrender.ts` 在 `win.loadFile()` 之后 `executeJavaScript(...)` 执行，结果 `as VideoBox[]`。
- 页面内逻辑：`document.querySelectorAll('video')` → `Array.prototype.slice.call` 成数组 → `forEach((v, i) => …)`：取 `v.getBoundingClientRect()`，宽或高为 0 则 `return`（跳过）；`fit = window.getComputedStyle(v).objectFit || 'fill'`；压入 `{ documentIndex: i, width: Math.round(r.width), height: Math.round(r.height), fit: (fit === 'cover' || fit === 'contain' || fit === 'fill') ? fit : 'fill' }`。
- 思路照上游 HY 的 `videoShownBoxes`：视频在页面里只占多大就抽多大的帧，不再一律按画布全尺寸（本项目视频 **490×600**、画布 **1920×1080**，面积只 1/4）。**画布不变**，注入的 `<img>` 继承原 `<video>` 样式、显示尺寸与原视频一致。

### 5.4 `extractVideoFrames` 与 `runFfmpeg`

- **背景（#131）**：用户实跑报「渲染失败：Error invoking remote method 'video:render': reply was never sent」——它不是普通抛错（那样会被 `video.ts` 外层 try/catch 转成「小内核渲染失败：…」），而是主进程抽帧阶段被拖垮 / 卡死、IPC handler 不返回。根因是 `extractVideoFrames` 原按 fps 把整段 225 秒视频抽成全尺寸帧（≈6763 张 1920×1080，十几 GB），而成片只要 45 秒。修法是既限时长又加超时：`extractVideoFrames` 新增第 4 参 `maxDuration`，`runFfmpeg` 加 5 分钟超时 kill。**注意这是「抽帧阶段」的 `reply was never sent`；#135 又发现「写编码器 stdin 阶段」还有第二个根因（旧二进制不支持 `--audio`），见 §6。**
- `htmlVideos(html)` 逐个切出 `<video` 开标签（到 `>` 为止）；`attr(tag, name)` 取引号包裹的属性值；`num(value, fallback)` 做 `Number` + `isFinite` 兜底。
- 帧目录固定为 `path.join(root, '.vidrender-frames-' + process.pid)`，`mkdirSync` 创建；每个视频再建一层 `<dir>/<documentIndex>/`。`framesDir(root)` 返回同一个拼接结果，供 `finally` 清理。
- 跳过策略（不让单个素材毁掉整次渲染）：无 `src` 或 `src` 是协议 / `//`（远程）跳过；`path.resolve(root, src)` 指到的文件不存在 → `[小内核] 视频 <src> 不存在，跳过抽帧`；ffmpeg 失败 → `[小内核] 视频 <src> 抽帧失败，跳过：<原因>`；抽完 `count === 0` 也跳过。
- **抽帧命令（#131 带时长上限；#132 改 JPG；#133 按显示盒子加滤镜）**：先用 `boxes.find((b) => b.documentIndex === i)` 找该视频的显示盒子，`filters = ['fps=' + fps]`；盒子存在且宽高 > 0 时按 `fit` 追加滤镜——cover → `scale=W:H:force_original_aspect_ratio=increase` + `crop=W:H`（先放大覆盖盒子再居中裁切），contain → `scale=W:H:force_original_aspect_ratio=decrease` + `pad=W:H:(ow-iw)/2:(oh-ih)/2`，fill（其余）→ `scale=W:H:force_original_aspect_ratio=disregard`；`-vf` 用 `filters.join(',')`。源码逐字（W/H 即 `box.width` / `box.height`）：

      ```ts
      const box = boxes.find((b) => b.documentIndex === i)
      const filters = [`fps=${fps}`]
      if (box && box.width > 0 && box.height > 0) {
        if (box.fit === 'cover') {
          filters.push(`scale=${box.width}:${box.height}:force_original_aspect_ratio=increase`,
            `crop=${box.width}:${box.height}`)
        } else if (box.fit === 'contain') {
          filters.push(`scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease`,
            `pad=${box.width}:${box.height}:(ow-iw)/2:(oh-ih)/2`)
        } else {
          filters.push(`scale=${box.width}:${box.height}:force_original_aspect_ratio=disregard`)
        }
      }
      const args = [
        '-v', 'error', '-i', source, '-vf', filters.join(','),
        '-q:v', '3', '-start_number', '0',
      ]
      if (Number.isFinite(maxDuration) && maxDuration > 0) args.push('-t', String(maxDuration))
      args.push(path.join(videoDir, '%05d.jpg'))
      ```

  若 `Number.isFinite(maxDuration) && maxDuration > 0` 再 `args.push('-t', String(maxDuration))`，最后 push 输出路径 `<dir>/<i>/%05d.jpg`——**#132 由 `%05d.png` 改为 `%05d.jpg` 并加 `-q:v 3`**（上游 `videoFrameFormat` 默认 auto：带 alpha 才 PNG、其余 JPG；jpeg quality draft 80 / 其余 100，见 `captureImageFormat.ts:30`；本机实测 `-q:v 3` 体积 260MB / 1350 帧）。成功后写进度 `[小内核] 视频 <文件名> 抽帧 <count> 张`（`count` 按 `.jpg` 后缀统计）。
- **`runFfmpeg(args, cwd)`（#131 加 5 分钟超时保护）**：exe 取 `hfEnv.BUILTIN_RESOURCES.ffmpeg`（没有就抛「未找到 ffmpeg：请先下载运行环境包」），`hfEnv.BUILTIN_RESOURCES.ffmpegBin` 前置进 `PATH`；`spawn(exe, args, { cwd, env, stdio: ['ignore','ignore','pipe'], windowsHide: true })`。stderr `data` 累积并 `.slice(-2000)` 留最近 2000 字符。`const TIMEOUT_MS = 5 * 60 * 1000`，`setTimeout` 到点先 `try { child.kill() } catch {}` 再 reject `'ffmpeg 抽帧超时（5 分钟），已终止；stderr 尾部：' + tail`——源码注释写明踩过的坑：ffmpeg 卡住时绝不能让 `await` 永远悬着，那样 IPC handler 不返回、渲染层只收到 `reply was never sent`。`child.on('error')` → reject 原错误，`child.on('close', code)` → `code === 0` 才 resolve，否则 reject「ffmpeg 抽帧失败：」+ 尾部。`settled` 标志 + `finish(fn)` 统一收口（`settled` 为真直接返回，否则置位、`clearTimeout(timer)`、执行 `fn()`），保证 resolve / reject 只发生一次。**#135 把同样的 `settled` + 超时 + `close` 兜底思路也用到了 `writeAll()`（§3.3）。**

### 5.5 `injectionScript(tables)`（页面侧注入）

返回一段自执行脚本：把帧表 `JSON.stringify` 进页面，建 `window.__vidrenderFrames` 数组，按 `documentIndex` 取 `document.querySelectorAll('video')` 里对应的原视频；为每个视频 `createElement('img')` 兄弟节点：

- 继承属性：`data-start` / `data-duration` / `data-media-start` / `data-playback-rate` / `class`（原视频有才拷），并设 `data-vidrender-frame` = `documentIndex`；
- 继承样式：先整段拷 `video.style.cssText`，再逐项拷 `getComputedStyle` 的 `position` / `left` / `right` / `top` / `bottom` / `width` / `height` / `objectFit` / `objectPosition` / `transform` / `transformOrigin` / `opacity` / `zIndex` / `borderRadius` / `filter` / `clipPath` / `mixBlendMode` / `maxWidth` / `maxHeight`，最后强制 `display:block`、`visibility:visible`；
- 插到原视频之后（`insertBefore(img, video.nextSibling)`）；原视频设 `data-vidrender-original-video="1"`、`visibility:hidden`，并 `pause()` + `preload='none'`；
- 把 `img` 挂回对应帧表项后压进 `window.__vidrenderFrames`，脚本返回注入数量。

### 5.6 `seekScript(t)`（每帧换图，返回 `new Promise`）

- **返回值是 `new Promise((resolve) => { … })` 的字符串**（供 `executeJavaScript(..., true)` 等待），不再写 `video.currentTime`、不等 `seeked`。
- 先 `setTimeout(finish, 5000)` 做 5 秒兜底，`finish` 用 `settled` 标志保证只 resolve 一次。
- 时间轴：遍历 `window.__timelines`，逐条 `tl.pause()`，再 `tl.time(t)`；没有 `time` 才退到 `tl.seek(t, false)`。
- 换图：遍历 `window.__vidrenderFrames`，`local = clamp(t - start, 0, duration)`、`sourceTime = mediaStart + local * rate`；`looped` 且 `sourceDuration > 0` 时取模（正模），否则钳到 `sourceDuration`；`index = clamp(floor(sourceTime * fps), 0, count - 1)`；`url = base + '/' + ('00000' + index).slice(-5) + '.jpg'`（**#132 由 `.png` 改为 `.jpg`**，与抽帧输出后缀一致）；仅当 `img.src !== url` 才赋值，并在有 `img.decode` 时把 `decode().catch(() => {})` 压进 `pending`。
- 落地：`Promise.all(pending).then(done, done)`，`done` 是**双 `requestAnimationFrame`** 后 `finish`；另有 `setTimeout(done, 500)` 兜底。

## 6. 与 demo 脚本的关系、未验证边界

- **与 demo 的关系**：`npm run demo:vidrender`（`scripts/demo-vidrender.cjs`，159 行）先在 `test/fixtures/vidrender/` 的 640×360 最小 composition 上验证了「逐帧 seek → `capturePage()` → `crop()` → `toBitmap()` → 写 `vidrender-encode` stdin」这条抓帧路径（CHANGELOG #119 / #123）。本模块复用其中的 **`capturePage() → crop() → toBitmap() → stdin` 抓帧段**（#130 在其间加了 `resize` 归一化），但视频画面来源已改为本版的**渲染模式抽帧换图**（§3.3 / §5），不再逐帧 seek `<video>`；此外还多承担三件 demo 不需要做的事：**入口 HTML 本地资源 `../` 回退**、**BGM 绝对路径解析**、**按项目画布取 `CANVAS_SIZES` 并把进度接进 `video:progress`**。demo 本身仍独立于产品流程。

- **`reply was never sent` 的真正根因与修复（#135）**：注意与 #131 的「抽帧拖垮主进程」是同症状、不同根因。#134 加的临时诊断设施（`src/main/debugLog.ts` + `index.ts` / `video.ts` / `vidrender.ts` 里的打点，**定位后打点保留**）把卡点钉死在 `frame 0 before write len=8294400` 之后再无打点——即 `writeAll(child.stdin, buf)` 永久挂起。独立 Electron 复现（带 BGM `--audio`）：编码器立即报 `error: unexpected argument '--audio' found`（exit code 2），但产品代码继续往已死的 stdin 写 8MB → `write()` 返回 false 等 `drain` → drain 永不到来 → `await` 永久挂起 → IPC handler 不返回 → 渲染层收到 `reply was never sent`。**根因**：`resources/bin/vidrender-encode.exe` 与 `hyperframes-rs/target/release/` 的都是 M2 音频功能之前的旧二进制（**929280 B，2026-11-18 00:09，`--help` 无 `--audio`**），只有 `target/debug/` 是新版（含 `--audio`）。**修法①**：`cargo build --release -p vidrender-core --bin vidrender-encode` 重编，新二进制 **944128 B（2026-11-19 00:38）**、`--help` 确认含 `--audio`，替换 `resources/bin/vidrender-encode.exe`；运行环境包目录 `%APPDATA%/shadowmill/runtime/vidrender/bin/` 不存在，**未替换**。**修法②**：`writeAll()` 加 10 秒超时 + `stream.once('close', onClose)` 兜底 + `settled` 收口（cleanup 里 `off` drain / error / close + `clearTimeout`），编码器提前退出变成明确报错「写入编码器 stdin 超时（10s）：编码器可能已提前退出（参数不兼容？）」，不再永久挂起（实现见 §3.3）。**验证**：typecheck 三工程全绿；**未验证**：dev 真实项目重跑是否出片（需用户执行）。
- **已验证**：`npm run typecheck` 三工程（node / web / agent）退出码 0；`npm run demo:vidrender` 回归 **60 帧 / 2.00 秒 / 160,588 字节、无警告**（CHANGELOG #124，该回归覆盖的是抓帧链路，不覆盖新的抽帧换图分支）。抓帧尺寸修复（#128）、窗口外框修复（#129，`frame: false`）与尺寸归一化（#130）后均再次 typecheck 三工程退出码 **0**（最新一次为 #130，见 CHANGELOG #130）。**#131 的抽帧时长限制与 5 分钟超时保护落地后，`npm run typecheck` 三工程仍全绿；#132（JPG）与 #133（按显示尺寸抽帧）落地后三工程仍全绿；#134（诊断打点）与 #135（二进制重编 + `writeAll` 加固）落地后三工程仍全绿（退出码 0）。**
- **体积实测（#132 / #133，本机同素材 45 秒 1350 帧）**：全画布 PNG **1733MB** → 全画布 JPG（`-q:v 3`）**260MB**（−85%）→ 按显示尺寸 **490×600** JPG **58.2MB**（相对原 PNG −96.6%）；ffprobe 确认抽帧输出 490×600。画布仍是 1920×1080，注入的 `<img>` 继承原 `<video>` 样式、显示尺寸与原视频一致。
- **未验证（别当成已打通）**：**真实项目 A/B 渲染**（尺寸 / 帧数 / 音轨 / `<video>` / 长片）、**打包产物**、**macOS**；渲染模式抽帧换图在真实合成上的表现、黄金帧回归与静态帧复用（M3）仍未做。#132 / #133 的 JPG 与按显示尺寸抽帧改动尚未在真实项目 A/B 重跑（dev）验证，仍待用户执行。#128 的 `useContentSize: true` 与 #129 的 `frame: false` 两次实跑截图都是 **1923×1063**（宽 +3、高仍 −17），证明窗口参数在本机 offscreen 下不稳定；#130 的**抓帧归一化**已 typecheck 三工程全绿，但**真实项目重跑（dev）仍待用户执行**——确认成片尺寸为 1920×1080、不再报「8163840 字节 vs 期望 8294400」，且归一化后画面可接受（CHANGELOG #130 标 `[待续]`）。

## 7. 注意事项与实现要点

- **编码二进制版本是硬要求（#135）**：`vidrender-encode.exe` 必须支持 `--audio`；旧版（929280 B，`--help` 无 `--audio`）收到 BGM 参数立即 exit 2，随后写 stdin 永久挂起。仓库 `resources/bin/` 已换成 944128 B 新版（`--help` 含 `--audio`）；运行环境包目录本机不存在、未替换，今后若从环境包取二进制须确认同一版本要求。
- **写 stdin 不再无限等待（#135）**：`writeAll()` 的 10 秒超时 / `close` 兜底 / `settled` 收口见 §3.3；超时文案为「写入编码器 stdin 超时（10s）：编码器可能已提前退出（参数不兼容？）」，由 `video.ts` 包成「小内核渲染失败：…」回执，不再出现无响应的 `reply was never sent`。
- **抽帧格式与尺寸（#132 / #133）**：帧文件是 `.jpg`（`-q:v 3`）不是 `.png`——`runFfmpeg` 输出 `%05d.jpg`、按 `.jpg` 计数、`injectionScript` / `seekScript` 里的帧 URL 后缀同步为 `.jpg`；抽帧尺寸按 `measureVideoBoxes()` 量到的显示盒子走 cover/contain/fill 滤镜（§5.3 / §5.4），画布与逐帧 `capturePage()` 仍是 1920×1080。**上游 HY 的「延迟 / 分段抽帧」（`deferredVideoFrames` / `windowedFrames`）本轮不做。**
- **抓帧只走 `capturePage()` 一条路径**：历史诊断表明 `beginFrameSubscription` 依赖 presentation 事件、隐藏离屏窗口会合并 / 跳过呈现，`invalidate()` 触发的是 `paint` 事件且实测 300ms 内无回调，故订阅路径不稳定；现在每帧按需抓页、无警告、无停顿。**抓到的图比 composition 视口略大 / 尺寸会抖动，#130 起统一走 §3.3 的「crop 多余边框 → 尺寸不足 resize 到画布 → 首帧一次归一化进度 → 字节数校验」**，保证 `toBitmap()` 每帧恰好 `宽 × 高 × 4 = frameSize` 字节；不再像 #128 那样因尺寸抖动直接抛错中断整次渲染。
- **窗口尺寸修复时间线（#128 → #129 → #130）**：小内核首次跑真实项目时报「抓帧尺寸不符：8163840 字节，期望 8294400」——换算成 1920×1063，比 1920×1080 少 17 行。根因是 `new BrowserWindow` 的 `width/height` 在 Windows 上默认指**外框**，标题栏（约 17px）+ 边框（3px）吃掉尺寸，`capturePage()` 只抓内容视口，已有 `.crop()` 补不回缺的行；demo 用 640×360 时截图有外框余量、crop 有余地，所以没暴露。#128 先加 `useContentSize: true`（期望修成 1920×1080），用户实跑后截图反而变成 **1923×1063**（宽 +3、高仍 −17），证明该选项在本机 offscreen 窗口上无效；#129 改用 `frame: false`（见 §3.2），但**实跑截图仍是 1923×1063，与 #128 完全一致**（疑似 dev 主进程未重载，或该 offscreen 组合下两者都无效）——继续调窗口参数只会让用户反复重跑。#130 不再依赖窗口参数，改走**抓帧尺寸归一化**（§3.3）：`crop` 掉多余边框、尺寸不足 `resize` 到画布、首帧推一次「截图 W×H，已归一化到 W×H」进度、最后仍以字节数校验兜底；这是视频管线的最终兜底，任何窗口外框 / DPI 抖动都不再影响出片。`frame: false` 保留在 `new BrowserWindow` 中（无害），但**最终兜底是抓帧归一化，不是窗口参数**。
- **临时产物有两类**：`entry.vidrender.html` 与 `entry.html` 同在 `.render-tmp/` 下，由 `video.ts` 在渲染成功 / 失败时一起删；抽帧目录 `.vidrender-frames-<pid>` 由本模块在 `finally` 里先 `rmSync` 掉。**本模块不删整个 `.render-tmp/`**。
- **本地资源回退有边界**：只处理「在 `.render-tmp` 下不存在、在项目根存在」的 `src` / `href`；已是协议 URL、`//`、`#`、`../`、绝对路径或 `.render-tmp` 下已有的引用一律不动。它不复制文件、也不改用户原件。
- **BGM 的路径来自标签解析**：`opts.audio` 优先；未传时只从 `<audio id="myv-bgm">` 解析且文件确实存在才作为 `--audio`，否则没有音轨参数；音频不进逐帧同步。
- **位图格式写死 `--pix-fmt bgra`**（与抓帧 `toBitmap()` 的本机实测格式一致）；demo 另有 `VIDRENDER_PIX_FMT` 环境变量兜底，产品模块没有这个开关。
- **进度文案统一带 `[小内核]` 前缀**：渲染层 `useRenderProgress.ts` 解析 `video:progress` 文本时看到的就是这些行；抽帧进度（每个视频一条）、**#137 抽帧用时「抽帧 N 路，用时 X.Xs」（有 tables 时一条）**、#130 首帧一次「截图 W×H，已归一化到 W×H」、**#137 逐帧每 15 帧「N/M 帧 · 已用 X.Xs · 剩余约 Ns · X.X fps」**、编码进度按 stderr 的 `progress` 事件给（`[小内核] 编码 N/total 帧`）、**#137 结束「渲染完成：N 帧 / X.Xs（平均 X.X fps）」**。**#137 的动机**：此前小内核逐帧只推「`[小内核] seek N/1350 帧`」，没有耗时 / 剩余 / fps，而 HY 后端把 CLI 输出（含 `time=` 等）原样转发，两条后端的进度无法直观对比速度；速度对比方案见 `docs/speed-compare-hy-vs-rust.md`（该文档不在 wiki 内，此处只作指引）。
- **错误要可读**：缺包、ffmpeg 抽帧失败、**ffmpeg 抽帧超时（5 分钟，`child.kill()` 并附 stderr 尾部）**、**写编码器 stdin 超时（10 秒，#135）**、抓帧尺寸不符、子进程启动失败、非 0 退出码（附 stderr 尾部）都抛出来，由 `video.ts` 统一包装成「小内核渲染失败：…」；不要在模块内吞掉。单个视频抽帧失败只写进度跳过，不中断整次渲染。经 #130 归一化后，「抓帧尺寸不符」已是**最后一道防线**（报错带实际截图宽高与归一化后字节数，见 §3.3），正常尺寸抖动只推一次归一化进度、不再抛错。
