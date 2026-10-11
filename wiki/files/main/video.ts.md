# src/main/video.ts

> HTML 预览与 HyperFrames 转视频：注册 5 个 IPC 频道并流式回推渲染日志。

- **所在目录**：src/main/
- **类型**：主进程业务模块（IPC 注册 + 子进程编排）
- **规模**：207 行
- **对外导出**：`register`

## 1. 作用与职责

本模块是渲染层视频环节的主进程后端，服务两个页面：**发起渲染与档位选择的「HTML生成」页**、**播放成品与内置示例试渲染的「视频预览」页**。覆盖三类能力：

| 能力 | 说明 |
|------|------|
| 选文件与内置项目发现 | 弹系统文件选择框挑 HTML；扫描 `video-projects` 下的内置视频项目 |
| 预览 | 生成（或复用）同目录的「预览外壳」页面 `_hf_preview_shell.html`，由本地 hyperframes-player 组件承载播放条与等比缩放 |
| 转视频 | 校验 HyperFrames 合规性，定位 hyperframes CLI 与 Node，搭建临时项目目录，**对渲染副本再做一次 GSAP 本地化**，按载荷里的渲染档位拼 `--quality` / `--fps`，`spawn` 子进程渲染 `output.mp4`，全程把 stdout/stderr 回推渲染进程 |

模块**不再自行声明载荷/结果类型**：原先仅本文件使用的 `RenderPayload` / `PreviewShellPayload` / `RenderResult` 已删除，统一改用 `src/shared/types.ts` ⑦ 节的 `VideoRenderPayload`（`extends RenderOverride`，即 `{ htmlPath?: string; quality?: RenderQuality; fps?: RenderFps }`）、`VideoPreviewShellPayload`（`{ htmlPath?: string }`）、`VideoRenderResult`（成功 `{ ok: true; outputVideo: string; projectDir: string }`，失败 `{ ok: false; message: string; compatible?: boolean }`），并从共享层引入 `RegisterCtx`。渲染档位的**白名单校验复用** `./settings` 的 `pickRenderOverride()`（与 `projects.ts` 同一处实现）。`video:progress` 推送仍就地构造 `{ text }`（该形状即共享层 ⑧ 节的 `VideoProgressPayload`，但本文件没有单独 import 它）。

## 2. 导出与关键实现

### 2.1 对外导出

| 名称 | 类型 | 说明 |
|------|------|------|
| `register` | 函数 | `register(ctx?: RegisterCtx): void`，注册全部 IPC handler；`getWindow` 取自 `ctx.getWindow`，缺省时回退为 `() => null` |

### 2.2 注册的 IPC 频道

| 频道常量 | 频道路由名 | 方向 | 载荷 → 返回 |
|----------|-----------|------|-------------|
| `IPC.Video.OpenHtml` | `dialog:open-html` | `ipcMain.handle` | 无参 → `string \| null`（选中文件绝对路径） |
| `IPC.Video.ListProjects` | `video:list-projects` | `ipcMain.handle` | 无参 → `{ name: string; html: string }[]` |
| `IPC.Video.PreviewShell` | `video:preview-shell` | `ipcMain.handle` | `VideoPreviewShellPayload`（`{ htmlPath?: string }`）→ `{ ok: true; shellPath }` 或 `{ ok: false; message }` |
| `IPC.Video.ShowInFolder` | `video:show-in-folder` | `ipcMain.handle` | `filePath?: string` → `void` |
| `IPC.Video.Render` | `video:render` | `ipcMain.handle` | `VideoRenderPayload`（`{ htmlPath?: string }`）→ `VideoRenderResult` |
| `IPC.Video.Progress` | `video:progress` | 主进程 → 渲染进程推送（`event.sender.send`） | `{ text: string }`（形状即共享层的 `VideoProgressPayload`） |

### 2.3 关键内部实现

| 名称 | 类型 | 说明 |
|------|------|------|
| `getWindow` | 闭包 | 取预览对话框的父窗口，无窗口时相关 handler 直接返回 `null` |
| `done` | 闭包（渲染分支内） | `finished` 标志位保证 Promise 只 settle 一次 |
| `child` | `ChildProcess` | `spawn(nodeCmd, [hfCli, 'render', '-o', outMp4], { cwd: projDir, env })` |

## 3. 关键流程

### 3.1 `dialog:open-html`

1. `getWindow()` 取窗口，为空则返回 `null`。
2. `dialog.showOpenDialog`，`title: '选择要预览的 HTML 文件'`，`filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }]`，`properties: ['openFile']`。
3. 取消或无选中文件返回 `null`，否则返回 `r.filePaths[0]`。

### 3.2 `video:list-projects`

1. `root = path.join(app.getAppPath(), 'video-projects')`；根目录不存在返回 `[]`（注释说明 dev 为项目根、打包后为 app.asar 根，两种形态都能命中）。
2. `fs.readdirSync(root, { withFileTypes: true })` 遍历，跳过非目录项。
3. 子目录内存在 `index.html` 才收录，push `{ name: d.name, html }`。

### 3.3 `video:preview-shell`

1. 校验 `payload.htmlPath` 为非空字符串且文件存在，否则返回 `{ ok: false, message: 'HTML 文件不存在' }`。
2. 目标为同目录下 `_hf_preview_shell.html`；已存在则直接复用（不覆盖）。
3. 首次生成时选择 player 脚本：`hfEnv.BUILTIN_RESOURCES.hivePlayer` 存在 → 写入 `pathToFileURL(localPlayer).href` 的本地 `<script src>`；否则回退 CDN `https://cdn.jsdelivr.net/npm/@hyperframes/player@latest`（`type="module"`）。
4. 写出最小外壳页：全屏黑底、`<hyperframes-player id="p" controls autoplay muted preload style="display:block;width:100vw;height:100vh">`，并用脚本把组件 `src` 指向 `./<目标 HTML 文件名>`。
5. 返回 `{ ok: true, shellPath }`；写文件异常时返回 `{ ok: false, message }`。

### 3.4 `video:render`（HyperFrames 转视频）

1. **入口校验**：`htmlPath` 缺失或文件不存在 → `{ ok: false, message: 'HTML 文件不存在' }`。
2. **合规校验**：读取 HTML 原文交给 `hfEnv.isHyperframesComposition(raw)`（要求同时含 `data-composition-id`、`__timelines`、`gsap`）；不合规则返回 `{ ok: false, compatible: false, message: ... }`，提示先用 HyperFrames 引导生成合规模板。
3. **定位 CLI**：`hfEnv.findHyperframesCli()`（内置 `hyperframes.mjs` 优先，回退环境变量 `HYPERFRAMES_CLI`）；找不到返回「未找到 hyperframes CLI……」。
4. **定位 Node**：`hfEnv.findNode()`（内置 Node 优先，回退系统且要求主版本 >= 22，返回绝对路径）；找不到返回「未找到系统 Node.js（HyperFrames 要求 >= 22）」。
5. **搭建临时项目目录**：`path.join(app.getPath('userData'), 'hf-projects', 'html-video-' + Date.now())` 并 `mkdirSync({ recursive: true })`。
6. **复制素材**：读取 HTML 源目录，若存在 `index.html` / `output.mp4` 之外的兄弟文件（`hasAssets`）则 `fs.cpSync(srcDir, projDir, { recursive: true })` 整体复制（保证 `audio/`、`video/` 等资源随行）；否则只 `fs.copyFileSync` 目标 HTML 为 `projDir/index.html`。复制异常返回「复制 HTML 失败：…」。
7. **渲染副本 GSAP 本地化**（在把 HTML 复制进渲染工作目录之后、启动渲染之前；**只改副本，不动用户原件**）：读取 `projDir/index.html`，交 `hfEnv.localizeGsapHtml()` 改写后写回；`hfEnv.referencesLocalGsap(localized)` 为真时 `hfEnv.copyGsapIntoProject(projDir)` 把随包 `gsap.min.js` 放进渲染目录。整段包在 `try/catch` 中，**本地化失败不阻断渲染**（在线时仍可由 CDN 加载）。
8. **确定输出路径**：`outMp4 = path.join(projDir, 'output.mp4')`。
9. **构造环境变量**：
   - `env = { ...process.env }`；
   - `hfEnv.findFfmpegBin()` 命中时把该 bin 目录前置到 `env.PATH`（`ffBin + path.delimiter + env.PATH`）；
   - `hfEnv.BUILTIN_RESOURCES.ffmpeg` 存在 → `env.HYPERFRAMES_FFMPEG_PATH`；
   - `hfEnv.BUILTIN_RESOURCES.ffprobe` 存在 → `env.HYPERFRAMES_FFPROBE_PATH`；
   - `hfEnv.BUILTIN_RESOURCES.chromeShell` 存在 → `env.PRODUCER_HEADLESS_SHELL_PATH`（避免渲染时去 `.cache` 重新下载 Chrome）。
10. **启动子进程**：先按载荷拼参数——`const renderArgs = [hfCli, 'render', '-o', outMp4]`，再 `const renderOpts = pickRenderOverride(payload)`；`renderOpts.quality` 为真时 `renderArgs.push('--quality', renderOpts.quality)`，`renderOpts.fps` 为真时 `renderArgs.push('--fps', String(renderOpts.fps))`（缺省/非法一律不传，交给 CLI 自己的默认 `standard` / `30`）。最后 `spawn(nodeCmd, renderArgs, { cwd: projDir, env })`。
11. **日志回推**：`child.stdout` 与 `child.stderr` 的 `data` 事件都 `event.sender.send(IPC.Video.Progress, { text })`，渲染进度由渲染层自行解析。
12. **失败与完成**：`child.on('error')` → 「启动渲染失败：…（node: …）」；`child.on('close', code)` → `code === 0 && fs.existsSync(outMp4)` 时返回 `{ ok: true, outputVideo: outMp4, projectDir: projDir }`，否则返回「渲染失败（exit=…）」。`done` 保证只 resolve 一次。

### 3.5 输出视频的回写与播放（渲染进程侧）

`video:render` 只负责产出并返回 `outputVideo` 绝对路径，**渲染进程侧由两个页面分工**：

- **发起方 `src/renderer/src/pages/HtmlGenPage/index.vue`**（「转视频」按钮，`onRenderVideo()`）：`res.ok` 后先写状态文案，再调用 `window.projectTools.saveVideo(appState.currentName, res.outputVideo)`（`project:save-video`）把产物回写 `project.json`，随后 `await refreshProject()` 让 `videoExists` / `videoPath` 生效，最后 toast 引导去「视频预览」页。它**不**自己播放视频。
- **播放侧 `src/renderer/src/pages/VideoPreviewPage/index.vue`**：进入页面时按 `appState.project.videoExists && videoPath` 自动把产物喂给 `<video controls>` 播放（`file:///` URL），并提供「在文件夹中显示」（`hfTools.showInFolder`）；内置示例的「试渲染」按钮也在该页，但**不回写项目**（示例只读，产物只进本页播放器）。

## 4. 依赖与协作

### 4.1 导入

| 来源 | 导入项 | 用途 |
|------|--------|------|
| `electron` | `app`、`ipcMain`、`dialog`、`shell` | 路径基准、IPC 注册、文件选择框、资源管理器定位 |
| `node:path` | `path`（默认导入） | 路径拼接、`path.delimiter`、`path.basename`/`dirname` |
| `node:fs` | `fs`（默认导入） | 存在性判断、目录扫描、复制、写外壳页 |
| `node:child_process` | `spawn` | 启动 hyperframes CLI 渲染子进程 |
| `node:url` | `pathToFileURL` | 把本地 player 脚本路径转成可用的 `src` |
| `./hfEnv` | `* as hfEnv` | `BUILTIN_RESOURCES`（`hivePlayer` / `ffmpeg` / `ffprobe` / `chromeShell`）、`findHyperframesCli`、`findNode`、`findFfmpegBin`、`isHyperframesComposition`，以及 GSAP 本地化的 `localizeGsapHtml` / `referencesLocalGsap` / `copyGsapIntoProject` |
| `./settings` | `pickRenderOverride` | 渲染档位（质量 / 帧率）白名单校验，与 `projects.ts` 复用同一实现 |
| `../shared/ipc` | `IPC` | 频道常量 |
| `../shared/types` | `type RegisterCtx`、`type VideoPreviewShellPayload`、`type VideoRenderPayload`、`type VideoRenderResult` | `register` 的上下文类型与两个 handler 的载荷/结果类型（原先在本文件本地声明为 `PreviewShellPayload` / `RenderPayload` / `RenderResult`） |

### 4.2 被谁使用

| 使用方 | 用法 |
|--------|------|
| `src/main/index.ts` | 第 152 行 `video.register(ctx)` 完成注册（依赖图注释：`hfEnv ← video`） |
| `src/preload/index.ts` | 暴露 `openHtml` / `listProjects` / `previewShell` / `renderVideo` / `showInFolder` / `onProgress`，分别转发上述频道 |
| `src/renderer/src/pages/HtmlGenPage/index.vue` | **发起渲染**（「转视频」按钮，带质量 / 帧率档位）、成功后回写产物并刷新项目 |
| `src/renderer/src/pages/VideoPreviewPage/index.vue` | 预览外壳（内置示例）、展示 / 定位成品视频、在文件夹中显示；内置示例试渲染 |
| `src/renderer/src/composables/useRenderProgress.ts` | 通过 `window.hfTools.onProgress` 解析 `video:progress` 文本 |
| `src/renderer/src/composables/useAppStore.ts` | 调 `listProjects()` 拉取内置项目列表 |

## 5. 注意事项与实现要点

- **预览外壳只生成一次**：`_hf_preview_shell.html` 若已存在就复用，不随目标 HTML 变化而刷新；外壳通过 `./<basename>` 引用目标文件。当前只有「视频预览」页的内置示例分支调 `video:preview-shell`（示例 `htmlPath` 固定），因此实际不会遇到「换文件」；若将来恢复手动选 HTML，换文件时需先删除旧外壳才能生效。
- **渲染档位只透传白名单值**：`pickRenderOverride(payload)` 过滤掉缺省与非法字段，两个参数都只在**显式给出**时才拼进 CLI 命令，因此「不传档位」与「传默认档位」在 CLI 侧等价（都走 `standard` / `30`）；白名单取值（`draft/standard/high`、`24/30`）与 `shared/types.ts` 的 `RenderQuality` / `RenderFps` 及渲染层 `utils/render.ts` 必须保持一致。
- **本地 player 优先、CDN 兜底**：优先使用 `hfEnv.BUILTIN_RESOURCES.hivePlayer` 的本地组件（离线可用），缺失时才引 jsdelivr CDN。
- **合规校验是硬门槛**：`data-composition-id`、`__timelines`、`gsap` 三者缺一不可，失败时额外回传 `compatible: false` 供界面区分「环境错误」与「HTML 不合规」。
- **Node 必须解析成绝对路径**：模块自身不拼 node 路径，全部交给 `hfEnv.findNode()`，避免 `spawn('node')` 在部分环境 ENOENT；`child.on('error')` 文案里也会带上解析结果便于排查。
- **环境变量注入而非依赖系统 PATH**：`HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` / `PRODUCER_HEADLESS_SHELL_PATH` 均为显式注入，`HYPERFRAMES_CLI` 是 CLI 缺失时的可选回退。这些变量名与 `hfEnv.ts` 的读取逻辑一一对应。
- **资源整体复制策略**：目录里只要存在 `index.html` / `output.mp4` 之外的文件就整目录复制，代价是可能复制进大体积无用文件，换来音频等素材必然随行。
- **音轨来源与混流分工**：本模块**不写 `<audio>`、也不做任何 ffmpeg 混音**。音轨是项目 `index.html` 里由主进程（`projects.ts` 的 `applyBgmToHtml`）注入的 `<audio id="myv-bgm" src="audio/…" autoplay loop>`；渲染时它随整目录复制进工作目录，**音轨提取与混入 MP4 全部发生在 HyperFrames CLI 内部**（trace 阶段 `audio_process`，渲染层只把该阶段翻成「处理音轨」）。因此「页面有音轨但成片没声音」应查注入标签是否存在，而不是查本模块。
- **产物落在 userData 而非项目目录**：视频输出在 `userData/hf-projects/html-video-<时间戳>/output.mp4`，是否回写项目由渲染层调用 `project:save-video` 决定。
- **`done` 幂等**：`finished` 标志位防止 `error` 与 `close` 双触发导致 Promise 重复 settle。
- **进度不解析、只透传**：主进程原样转发子进程 stdout/stderr 文本，`[Render:trace]` 一类的语义解析在渲染层完成。
- **渲染副本本地化「尽力而为」**：老项目 HTML 仍引 GSAP CDN 时，离线渲染会因 `gsap` 未定义而失败，故在渲染工作目录里再本地化一次；整段包在 `try/catch` 中且注释明确「本地化失败不阻断渲染」（在线时仍可由 CDN 加载）。它只改 `userData/hf-projects/html-video-<ts>/index.html` 这个副本，**用户原件与项目目录里的 `index.html` 不受影响**。
- **本地化依赖随包文件**：`vendor/gsap/gsap.min.js` 缺失时 `localizeGsapHtml` 原样返回（副本仍引 CDN），`copyGsapIntoProject` 返回 `false` **被忽略**（不会产生错误提示，也不会退回 CDN）；这与 `projects.ts` 作者态三处「复制失败即 `externalizeGsapHtml` 退回 CDN」的兜底不同——渲染路径以「不阻断渲染」优先，且副本本身只是临时工作目录。
- **内置示例并非完全离线**：`video-projects/*/index.html` 除 GSAP 外仍从 CDN 引 `@hyperframes/core` 与 `@hyperframes/shader-transitions`，本轮只本地化了 GSAP；示例的离线渲染依赖 HyperFrames CLI 自带运行时兜底（预览外壳里的 player 也另有本地 `hivePlayer` 优先逻辑）。
