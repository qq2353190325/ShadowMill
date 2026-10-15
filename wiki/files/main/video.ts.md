# src/main/video.ts

> HyperFrames 转视频：注册 3 个 IPC 频道（含 1 路进度推送），**就地渲染**到 `<项目目录>/video/output.mp4`——先裁定成片时长（模型声明 / 实测时间轴 / 最长媒体三档）并裁掉超长媒体副本，再在项目内临时子目录写渲染入口（**并按项目选定的画布往入口的 `<html>` 注入 `data-resolution`**），全程把 CLI 子进程日志流式回推渲染层。

- **所在目录**：src/main/
- **类型**：主进程业务模块（IPC 注册 + 子进程编排）
- **规模**：380 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：`register`（唯一导出）

## 1. 作用与职责

本模块是渲染层视频环节的主进程后端，服务两个页面：**发起渲染与档位选择的「HTML生成」页**、**播放成品的「视频预览」页**。覆盖的能力：

| 能力 | 说明 |
|------|------|
| 选 HTML 文件 | 弹系统文件选择框挑 HTML（`dialog:open-html`，**保留但渲染层当前无调用方**） |
| 转视频（准备阶段） | 校验 HyperFrames 合规性 → 定位 hyperframes CLI 与 Node（`{ cmd, env }` 一对）→ **就地确定渲染根（HTML 所在的项目目录）** → GSAP 本地化（幂等）→ 注入环境变量 → **取画布（白名单校验，缺省落 `DEFAULT_CANVAS`）** → **把画布写进入口的 `<html data-resolution>`、裁定成片时长并裁掉超长媒体的副本、写渲染入口** |
| 转视频（渲染阶段） | 按载荷里的渲染档位拼 `--quality` / `--fps`（**不拼 `--resolution`**：画布已经在入口 HTML 里声明好了），`spawn` 子进程在项目内渲染出 `video/output.mp4`，全程把 stdout/stderr 回推渲染进程，收尾删除临时入口目录 |

**最大的形态变化是「就地渲染」**（取代旧的临时工作目录方案）：

| | 旧实现 | 现实现 |
|---|---|---|
| 渲染根（`cwd`） | `userData/hf-projects/html-video-<时间戳>/` | `path.dirname(htmlPath)`，即 **HTML 所在的项目目录** |
| 素材 | 整目录 `cpSync` 复制进工作目录 | **不复制**；入口 HTML 里仍按**相对项目根**写（如 `video/x.mp4`），CLI 也按项目根解析 |
| 成品 | 留在临时工作目录里（几百 MB） | 直接生成在 `<项目目录>/video/output.mp4` |
| 渲染入口 | 工作目录的 `index.html` | 项目内的临时子目录 `<项目目录>/.render-tmp/entry.html`（CLI 硬要求：`-c` 的入口必须落在项目根之内），**渲完即删**（`fs.rmSync(tmpDir)`） |
| GSAP | 对工作目录里的副本**再做一次本地化** | 本文件**不再**做「面向渲染副本」的本地化改写，只调用一次幂等的 `hfEnv.localizeGsapHtml()`（老项目 HTML 仍引 CDN 时才真正改写）；入口在子目录里，因此把 `./gsap.min.js` 引用改写为 `../gsap.min.js` |

为什么不复制也能跑（源码注释给出的三条理由）：① GSAP 本地化是幂等的、产物就是项目目录里的 `gsap.min.js`（`projects.ts` 的保存/生成流程已在做）；② BGM 注入本来只写 `index.html`（`projects.ts` 的 `applyBgmToHtml`），渲染时不需要再动；③ 入口放在项目内的临时子目录、媒体用相对项目根的引用，实测 CLI 能正常解析（2026-10 验证）。好处是**不再复制 200 MB+ 素材、不再留几百 MB 的 `hf-projects` 工作目录、成品直接长在项目里**。

模块**不再自行声明载荷/结果类型**：仅本文件使用的 `RenderPayload` / `RenderResult` 已删除，统一改用 `src/shared/types.ts` ⑦ 节的 `VideoRenderPayload`（`extends RenderOverride`，即 `{ htmlPath?: string; quality?: RenderQuality; fps?: RenderFps; canvas?: RenderCanvas }`——`canvas` 是**项目属性**（成片画布方向）、不是渲染档位）、`VideoRenderResult`（成功 `{ ok: true; outputVideo: string; projectDir: string }`，失败 `{ ok: false; message: string; compatible?: boolean; needPacks?: RuntimePackName[] }`），并从共享层引入 `RegisterCtx`、`RuntimePackName`。渲染档位的**白名单校验复用** `./settings` 的 `pickRenderOverride()`（与 `projects.ts` 同一处实现）。`video:progress` 推送仍就地构造 `{ text }`（该形状即共享层 ⑧ 节的 `VideoProgressPayload`，但本文件没有单独 import 它）。

### 1.1 成片时长：谁说了算

源码在模块顶部用一整段注释写清了这条规则（HyperFrames 的 `cli.js` 实测结论）：

> **成片时长 = max(根节点声明的时长, 页面里最长媒体的时长)**。

声明只能把片子拉长、拉不短 ⇒ **只声明没用，超长的媒体必须一起裁掉**，否则「动画 45 秒、素材 225 秒」就会渲出 225 秒、后 180 秒全是黑帧（本项目的真实故障）。时长来源按下面的顺序取（前一个拿到就不看后面的）：

| 顺序 | 来源 | 成本 / 口径 |
|---|---|---|
| ① | 模型在 `<html data-composition-duration="…">` 里声明的 | 零成本；提示词已要求模型写（见 [projects.ts.md](./projects.ts.md) 的【成片时长】条） |
| ② | 现场量 GSAP 时间轴 | 无头 Chromium 跑一次，**与预览脚本的 `clock()` 同一口径**（多个时间轴取最大）；不需要字幕，3~5 秒 |
| ③ | 页面里最长媒体的时长 | 老页面没有时间轴时的兜底，即拆分前的行为（交给 CLI 自己裁定） |

### 1.2 成片画布：谁说了算

画布由**项目属性**决定（`project.json` 的 `canvas`，三档 `landscape` / `portrait` / `square`，缺省 = `shared/constants.ts` 的 `DEFAULT_CANVAS` = `landscape`），渲染层随载荷下发；`video:render` 用同一份共享常量 `RENDER_CANVASES` 做白名单校验：

```ts
const wanted = payload && payload.canvas
const canvas: RenderCanvas = wanted && RENDER_CANVASES.indexOf(wanted) >= 0 ? wanted : DEFAULT_CANVAS
```

源码注释写明**绝不能「不传」**：HyperFrames CLI 的画布**只从 HTML 里读**，解析链是（`cli.js` 实测）——

| 顺序 | 来源 | 说明 |
|---|---|---|
| ① | `<html data-resolution="…">` | `parseResolutionFromHtml()` 优先看它，只认 `landscape` / `portrait` / `landscape-4k` / `portrait-4k` / `square` / `square-4k` |
| ② | `<html data-composition-width>` + `data-composition-height` | 同一函数里的第二条，按宽高反推档位 |
| ③ | `#stage` 的固定 px | `parseResolutionFromCss()`：先看 `#stage` 的内联 `width` / `height`，再看样式表里的 `#stage{…width:Npx…height:Npx…}` 规则 |
| ④ | **兜底 `portrait`** | `parseResolutionFromCss()` 末尾 `return "portrait"`——**一条都读不到就是 1080×1920 竖屏**，宽屏版式被裁掉两侧、上下留大片黑边（本项目实测故障） |

因此本模块新增 `applyCanvasDeclaration(html, canvas)`，在 `prepareEntry()` 的**第一步**把画布写进入口 HTML：**注入 `data-resolution` 一举解决两件事**——① 页面没声明画布时不再掉进 `portrait`；② 页面自己声明的画布 / 舞台尺寸也压不过它（解析优先级里 `data-resolution` 最高），成片必与项目所选一致。

两个实现细节：**先把页面里已有的 `data-resolution` 属性剥掉再写**（交给助手 `stripDataResolution(attrs)`）；**整篇连 `<html>` 标签都没有时**（模型输出被截断的罕见情况）直接前置一个 `<html data-resolution="…">`。

剥属性刻意**不用一条「匹配 `data-resolution=`」的正则**，而是**逐属性扫描**：助手 `stripDataResolution(attrs)` 用 `/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g` 逐个消费属性（引号包住的值整段被消费，值内部的同名文本不会再被二次匹配），只把**属性名等于 `data-resolution`（忽略大小写）**的那个匹配替换为空串、其余原样返回，最后 `.trim()`，非空则前面补一个空格——`applyCanvasDeclaration()` 里就是 `'<html' + stripDataResolution(attrs) + ' data-resolution="…">'`。源码注释记了两条动机：① 只匹配**带值**写法（`data-resolution="…"`）会漏掉 HTML 合法的**无值**写法 `<html data-resolution>`——注入后同一个标签上就有两个同名属性，而 **HTML 解析规则取第一个**（正好是空值）⇒ 项目所选被默默压过、注入等于没做（2026-10 实测复现）；② 反过来把 `=` 与值都写成可选，又会命中**别的属性值里**的同名文本（实测 `<html data-x="data-resolution">` 会连带把 `data-x` 的值清成空），所以必须按属性逐个扫描。

**传 `--resolution` 不能替代它**：CLI 对该参数的说明是「composition 尺寸不变，Chrome 用更高 DPR（`deviceScaleFactor`）渲染后落到目标尺寸」，并且**要求宽高比与 composition 一致、缩放必须是整数倍**（实现里对宽高比不符 → aspect-mismatch、目标比 composition 小 → 「Downsampling via --resolution is not supported」、比例非整数 → non-integer scale factor 三种情况分别报错），所以它无法把竖屏 composition 掰成横屏。

写盘前还会往 `userData/video-duration.log` 追加一行留痕：`成片画布 = <canvas>（<宽>x<高>），已写入 <html data-resolution>`（与成片时长裁定同一个日志文件——这类「为什么渲出来是这样」的问题必须可事后查）。

## 2. 导出与关键实现

### 2.1 对外导出

| 名称 | 类型 | 说明 |
|------|------|------|
| `register` | 函数 | `register(ctx?: RegisterCtx): void`，注册全部 IPC handler；`getWindow` 取自 `ctx.getWindow`，缺省时回退为 `() => null` |

### 2.2 注册的 IPC 频道

| 频道常量 | 频道路由名 | 方向 | 载荷 → 返回 |
|----------|-----------|------|-------------|
| `IPC.Video.OpenHtml` | `dialog:open-html` | `ipcMain.handle` | 无参 → `string \| null`（选中文件绝对路径；渲染层当前无调用方） |
| `IPC.Video.ShowInFolder` | `video:show-in-folder` | `ipcMain.handle` | `filePath?: string` → `void` |
| `IPC.Video.Render` | `video:render` | `ipcMain.handle` | `VideoRenderPayload` → `VideoRenderResult` |
| `IPC.Video.Progress` | `video:progress` | 主进程 → 渲染进程推送（`event.sender.send`） | `{ text: string }`（形状即共享层的 `VideoProgressPayload`） |

### 2.3 模块级常量

| 名称 | 类型 | 取值 / 说明 |
|------|------|-------------|
| `RENDER_PACKS` | `RuntimePackName[]` | `['ffmpeg', 'hyperframes']`——渲染要哪几包：HyperFrames CLI 与浏览器壳在 `hyperframes` 包，编码与素材探测在 `ffmpeg` 包；分包后两者都在安装包之外，**缺哪个就提示下载哪个** |

> 画布相关常量不在这里自己声明：`RENDER_CANVASES` / `CANVAS_SIZES` / `DEFAULT_CANVAS` 一律从 `../shared/constants` 取（三端同源），本文件只用它们做白名单校验与日志留痕。

### 2.4 内部函数一览

| 名称 | 签名要点 | 说明 |
|------|----------|------|
| `runCapture(cmd, args, cwd, env, timeoutMs)` | `Promise<string>` | 带超时的子进程抓输出：成功返回 stdout+stderr 合并文本，超时 / 启动失败 / 异常一律返回 `''` |
| `declaredDuration(html)` | `number` | 读 `<html … data-composition-duration="45">`，没有或非法（非有限数、<= 0）返回 `0` |
| `applyCanvasDeclaration(html, canvas)` | `string` | **把项目选定的画布写成入口的 `<html data-resolution="…">`**：先调 `stripDataResolution(attrs)` 剥掉页面里已有的同名属性再写；整篇连 `<html>` 标签都没有时前置一个带声明的 `<html>`（见 §1.2） |
| `stripDataResolution(attrs)` | `string` | **逐属性扫描，只摘掉 `data-resolution`（忽略大小写、含无值写法）**，其余属性原样保留、开头空白收成一个空格。正则原文：`/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"\|'[^']*'\|[^\s"'>]+))?/g`（定义在 `applyCanvasDeclaration()` 之后，见 §1.2） |
| `measureTimelineDuration(entryHtml, tmpDir, chrome, cwd, env)` | `Promise<number>` | 无头 Chromium 加载「页面副本 + 量测脚本」，用 `--dump-dom` 读回 GSAP 时间轴长度；拿不到返回 `0` |
| `probeDuration(file, ffprobe, cwd, env)` | `Promise<number>` | `ffprobe -show_entries format=duration` 量媒体时长（秒）；失败返回 `0` |
| `writeTrimLog(projDir, line)` | `void` | 追加一行到 `userData/video-duration.log`（带 ISO 时间与项目目录名）；日志失败不影响渲染 |
| `prepareEntry(opts)` | `Promise<string>` | **画布声明 + 时长裁定 + 裁超长媒体副本 + 写入口**：返回最终要渲染的入口 HTML 文本（见 §4） |
| `register(ctx?)` | `void` | 注册全部 handler（§3） |

## 3. 关键流程

### 3.1 `dialog:open-html`

1. `getWindow()` 取窗口，为空则返回 `null`。
2. `dialog.showOpenDialog`，`title: '选择要预览的 HTML 文件'`，`filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }]`，`properties: ['openFile']`。
3. 取消或无选中文件返回 `null`，否则返回 `r.filePaths[0]`。

### 3.2 `video:show-in-folder`

`filePath` 是字符串且 `fs.existsSync(filePath)` 时调 `shell.showItemInFolder(filePath)`；否则什么都不做。

### 3.3 `video:render` —— 两段式结构（准备阶段 + 渲染阶段）

**整体分成两段，中间的分界线是那个 `new Promise`**：准备阶段是普通 `await` 代码，渲染阶段包在 `return new Promise<VideoRenderResult>((resolve) => { … })` 里。这样切分的**唯一原因**是 Promise 的执行器是同步函数、里面不能出现 `await`（源码注释写明），而准备阶段必须 `await` 子进程（量时间轴、ffprobe、ffmpeg 裁剪）。准备阶段失败一律直接返回错误对象、不进渲染。

#### 准备阶段（第 236~332 行，`await` 代码）

1. **缺包校验（最先做）**：`const lack = runtime.missingPacks(RENDER_PACKS)`——非空立刻返回 `{ ok: false, needPacks: lack, message: '转视频需要先下载运行环境（' + runtime.packSizeText(lack) + '）' }`：**不下载、不阻塞**，渲染层据此弹「下载运行环境」确认框（`useEnvGate`），用户点「继续」才用原参数重发本操作（见 `docs/runtime-pack-split.md`）。
2. **入口校验**：`payload.htmlPath` 缺失或文件不存在 → `{ ok: false, message: 'HTML 文件不存在' }`；读取原文。
3. **合规校验**：`hfEnv.isHyperframesComposition(raw)`（要求同时含 `data-composition-id`、`__timelines`、`gsap`）；不合规则返回 `{ ok: false, compatible: false, message: … }`，提示先用 HyperFrames 引导生成合规模板。
4. **定位 CLI**：`hfEnv.findHyperframesCli()`（内置 `hyperframes.mjs` 优先，回退环境变量 `HYPERFRAMES_CLI`）；找不到返回「未找到 hyperframes CLI（hyperframes.mjs）。可设置环境变量 HYPERFRAMES_CLI 指向其路径。」
5. **定位 Node**：`hfEnv.findNode()` —— 返回 `{ cmd, env }`（**两级优先**：① Electron 内嵌 Node，即 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`；② 系统 Node，要求主版本 >= 22）；`null` 时给出「未找到可用的 Node.js（HyperFrames 要求 >= 22；Electron 内嵌 / 系统两种途径均不可用）」。`env` **必须**合进下面 `spawn` 的环境，否则 `electron.exe` 会把自己当应用来启动。
6. **就地确定渲染根与路径**（取代「建临时工作目录 + 复制素材」）：

   | 变量 | 取值 |
   |---|---|
   | `projDir` | `path.dirname(htmlPath)` —— **HTML 所在的项目目录就是渲染根** |
   | `tmpDir` | `path.join(projDir, '.render-tmp')` —— 项目内的临时子目录 |
   | `entryHtml` | `path.join(tmpDir, 'entry.html')` —— 渲染入口（相对项目根即 `.render-tmp/entry.html`） |
   | `outMp4` | `path.join(projDir, 'video', 'output.mp4')` —— 成品路径 |

   `try` 里先 `rmSync(tmpDir, { recursive: true, force: true })`（清掉上次残留）→ `mkdirSync(tmpDir)` → `mkdirSync(path.dirname(outMp4))`；异常返回「准备渲染目录失败：…」。
7. **GSAP 本地化（幂等）**：`const localized = hfEnv.localizeGsapHtml(raw)`；`hfEnv.referencesLocalGsap(localized)` 为真时 `hfEnv.copyGsapIntoProject(projDir)` 把随包 `gsap.min.js` 放进**项目目录**（入口在子目录里，所以下面 `prepareEntry()` 会把引用改写成 `../gsap.min.js`）。本文件**没有** `try/catch` 包裹、也**不判断**返回值（在线时仍可由 CDN 加载；与 `projects.ts` 作者态三处的兜底策略不同）。
8. **构造环境变量**：
   - `env = { ...process.env, ...nodeRt.env }` —— 把 `findNode()` 给的附加环境合并进来；
   - `hfEnv.findFfmpegBin()` 命中时把该 bin 目录前置到 `env.PATH`（`ffBin + path.delimiter + env.PATH`）；
   - `hfEnv.BUILTIN_RESOURCES.ffmpeg` 存在 → `env.HYPERFRAMES_FFMPEG_PATH`；
   - `hfEnv.BUILTIN_RESOURCES.ffprobe` 存在 → `env.HYPERFRAMES_FFPROBE_PATH`；
   - `hfEnv.BUILTIN_RESOURCES.chromeShell` 存在 → `env.PRODUCER_HEADLESS_SHELL_PATH`（避免渲染时去 `.cache` 重新下载 Chrome；**量时间轴那一步也用它**——`prepareEntry()` 的 `chrome` 参数就是 `env.PRODUCER_HEADLESS_SHELL_PATH || ''`，即渲染与量测共用同一份 chrome-headless-shell 解析结果）。
9. **定画布 + 时长裁定 + 裁媒体 + 写入口**（与源码逐行一致）：
   - **先定画布**：`const wanted = payload && payload.canvas`，`const canvas: RenderCanvas = wanted && RENDER_CANVASES.indexOf(wanted) >= 0 ? wanted : DEFAULT_CANVAS`——白名单校验，非法 / 缺省一律落 `DEFAULT_CANVAS`（源码注释强调**绝不能「不传」**：不传的话 CLI 会在页面没声明画布时兜底 `portrait`，见 §1.2）。

    ```ts
    let entry = ''
    try {
      entry = await prepareEntry({
        localized,
        entryHtml,
        tmpDir,
        projDir,
        env,
        chrome: env.PRODUCER_HEADLESS_SHELL_PATH || '',
        canvas
      })
      fs.writeFileSync(entryHtml, entry, 'utf8')
    } catch (e) {
      return { ok: false, message: '准备渲染入口失败：' + ((e as Error).message || String(e)) } as VideoRenderResult;
    }
    ```

#### 渲染阶段（`new Promise` 执行器内，同步代码）

1. **拼参数**：`const renderArgs = [hfCli, 'render', '-c', '.render-tmp/entry.html', '-o', outMp4]`——`-c` 用**相对项目根的路径**（CLI 硬要求入口落在项目根之内）。再 `const renderOpts = pickRenderOverride(payload)`；`renderOpts.quality` 为真时 `renderArgs.push('--quality', renderOpts.quality)`，`renderOpts.fps` 为真时 `renderArgs.push('--fps', String(renderOpts.fps))`（缺省 / 非法一律不传，交给 CLI 自己的默认 `standard` / `30`）。
2. **启动子进程**：`spawn(nodeRt.cmd, renderArgs, { cwd: projDir, env })`——**`cwd` 就是项目目录**，CLI 的素材解析据此把 `video/x.mp4` 这类相对引用还原成项目内的真实文件。
3. **日志回推**：`child.stdout` 与 `child.stderr` 的 `data` 事件都 `event.sender.send(IPC.Video.Progress, { text })`，渲染进度由渲染层自行解析（`[Render:trace]` 等）。
4. **失败与完成**：
   - `child.on('error')` → 「启动渲染失败：…（node: `<nodeRt.cmd>`）」；
   - `child.on('close', code)` → 先 `try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 被占用则留着，下次渲染前会先删 */ }`（**渲染入口是临时物，无论成败都清掉**；成品不需要「搬回来」，所以没有额外清理步骤）→ `code === 0 && fs.existsSync(outMp4)` 时返回 `{ ok: true, outputVideo: outMp4, projectDir: projDir }`，否则返回「渲染失败（exit=…）」；
   - 闭包 `done(res)` 用 `finished` 标志位保证 Promise 只 settle 一次。

## 4. `prepareEntry()` —— 画布声明、时长裁定与裁媒体

`prepareEntry(opts: { localized, entryHtml, tmpDir, projDir, env, chrome, canvas }): Promise<string>` 的返回値就是最终写盘、并交给 CLI 的入口 HTML 文本。**`canvas` 是本次新增的入参**（`RenderCanvas`）：它决定成片画布，由调用方白名单校验后传入。

下面编号从 GSAP 改写开始；**在此之前还有一步画布声明**：`entry = applyCanvasDeclaration(entry, canvas)`（源码注释：画布声明放在最前，后面量时间轴时写盘的副本、最终留给 CLI 的入口都带上它），紧跟着往 `video-duration.log` 追加一行「成片画布 = …」。步骤：

1. **GSAP 引用改写**：`let entry = localized.replace(/\.\/gsap\.min\.js/gi, '../gsap.min.js')`——入口在 `.render-tmp/` 下，`gsap.min.js` 在项目根，故回退一层。
2. **① 模型声明**：`let target = declaredDuration(localized)`，`let source = '声明'`。
3. **② 没声明就现场量一次**（量测脚本要读页面文件，所以先把入口落盘）：
   - `chrome` 非空时 `fs.writeFileSync(entryHtml, entry, 'utf8')`（写失败只影响量测，`catch` 里忽略）→ `target = await measureTimelineDuration(entryHtml, tmpDir, chrome, projDir, env)`，`source = '实测时间轴'`；
   - `chrome` 为空时 `source = ''`（不去量）。
4. **③ 都拿不到**：`target <= 0` 时写一条日志（`'成片时长：模型未声明且时间轴量不到（chrome=有/无）→ 交给 CLI 按最长媒体裁定'`）并**原样返回** `entry`——保持旧行为。
5. **裁超长媒体**：用 `/(<(?:video|audio)\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi` 扫入口 HTML 里的 `<video>` / `<audio>` 的 `src`：
   - 跳过 `http:` / `https:` / `data:` / `blob:` / `file:` 开头的、以及含 `..` 的（已指到项目外的，本应用不会生成）；
   - **路径解析必须 `path.resolve(projDir, src)`，不能 `resolve(tmpDir, src)`**——HTML 里的 `video/x.mp4` 是相对**项目根**写的（CLI 也按项目根解析），按 `tmpDir` 解析会指向不存在的 `.render-tmp\video\…`，一句「找不到就跳过」就把裁剪全跳过了（源码注释记录了这个 2026-10 实测踩到的坑）；
   - 文件不存在 → 写日志「媒体文件不存在，跳过裁剪：<src>」并跳过；
   - `probeDuration()` 量时长，`dur <= target + 0.25` 视为不用裁；
   - 需要裁时：输出到 `path.join(tmpDir, 'media', path.basename(abs))`（`mkdirSync` 建目录），用 `ffmpeg -hide_banner -loglevel error -y -i <原文件> -t <target> -c copy <副本>`——**从头裁到目标时长、`-c copy` 不重压（秒级完成）**；**只裁副本、原件不动**；
   - 副本存在且非空才算成功：把该 `src` 记进 `jobs`，入口里改写成 `'./media/' + path.basename(abs)`（入口自身就在 `.render-tmp/` 里，相对它写 `./media/xxx` 最稳妥），并写日志「裁剪 <文件>：<原时长>s → <目标>s」；失败写日志「裁剪失败（…）」并把 ffmpeg 输出的最后 160 字符附上；
   - 循环结束后统一 `entry = entry.split('"' + j.from + '"').join('"' + j.to + '"')`（按完整带引号的 src 做字面替换），有裁剪时再写一条汇总日志。
6. **把成片时长静态写进 `<html>`**：`target > 0 && !declaredDuration(entry)` 时，用 `entry.replace(/<html\b([^>]*)>/i, '<html$1 data-composition-duration="' + target + '">')` 注入；**没有 `<html …>` 标签时**直接把 `'<html data-composition-duration="' + target + '">'` 拼在文档最前。源码注释：CLI **静态解析**这个属性，运行时 JS 写的不算（已实测）。画布声明已在最前一步注入，因此这一段既有的正则**一定能命中**根节点（原页面没有 `<html>` 时命中的就是被前置的那个根节点，`data-resolution` 与 `data-composition-duration` 会写在同一个标签上）。
7. **留痕**：最后写一条「成片时长 = <target>s（来源：<source>）」，返回 `entry`。

`measureTimelineDuration()` 的量测口径（与预览脚本 `clock()` 一致）：

1. 读 `entryHtml` 原文，追加一段量测脚本后写成 `<tmpDir>/duration-probe.html`（**为什么要复制一份：用 iframe 套一层就取不到内层 GSAP**）。
2. 脚本在 `setTimeout(…, 1500)` 之后：先收 `window.__timelines` 里的所有时间轴；为空时退而遍历 `window.gsap`，收 `typeof v.duration === "function"` 的对象；对每条取 `duration()`，**取最大值**；把结果写进一个 `<pre id="hf-dur-out">`，文本形如 `<marker><d>_END`。
3. `runCapture(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--virtual-time-budget=5000', '--dump-dom', url], cwd, env, 30000)` 把 DOM dump 回来，用 `<marker>([\d.]+)_END` 正则取出数值；量到 0 / 解析失败 / 异常都返回 `0`（调用方据此退回媒体时长）。
4. `url` 由绝对路径手工拼成 `file:///` 形式（`\\` → `/`、空格 → `%20`）——本文件**不 import `node:url`**。
5. 量测用的 `duration-probe.html` 在 `finally` 里 `fs.rmSync(…, { force: true })` 删除；`entry.html` 本身（渲染入口）则由渲染阶段收尾时连同整个 `.render-tmp/` 一起删除。

## 5. 渲染产物路径的语义变化（`project:save-video` 的配合）

- **本模块只产出并返回成品绝对路径**：`{ ok: true, outputVideo: outMp4 (= <项目目录>\video\output.mp4), projectDir: projDir }`。**不写 `project.json`**。
- 回写由渲染层「HTML生成」页负责：`res.ok` 后调 `window.projectTools.saveVideo(appState.currentName, res.outputVideo)`（`project:save-video`）→ 主进程把**项目目录内的绝对路径换算成项目内相对路径** `video/output.mp4` 存进 `project.json`（见 [projects.ts.md](./projects.ts.md) 的 `resolveVideoAbs()` 与 `project:save-video`）。
- 「视频预览」页取路径时拿到的又是绝对路径（`project:load` 返回前用 `resolveVideoAbs()` 还原），再经 `hgpreview://` 协议播放（见 [VideoPreviewPage.md](../renderer/src/pages/VideoPreviewPage.md)）。
- 旧记录里指向 `hf-projects\…` 的绝对路径仍能被 `resolveVideoAbs()` 兼容读出（文件存在就用），但**新的渲染不会再产生那种目录**（磁盘上残留的 244 MB 旧目录已删）。

## 6. 依赖与协作

### 6.1 导入

| 来源 | 导入项 | 用途 |
|------|--------|------|
| `electron` | `app`、`ipcMain`、`dialog`、`shell` | `app.getPath('userData')`（仅作 `video-duration.log` 的落点）、IPC 注册、文件选择框、资源管理器定位 |
| `node:path` | `path`（默认导入） | 路径拼接、`path.dirname` / `path.resolve` / `path.basename` / `path.delimiter` |
| `node:fs` | `fs`（默认导入） | 存在性判断、目录创建与删除、读写入口 HTML、裁剪产物大小校验 |
| `node:child_process` | `spawn` | 启动 hyperframes CLI 渲染子进程；也被 `runCapture()` 用于量时间轴 / ffprobe / ffmpeg |
| `./hfEnv` | `* as hfEnv` | `BUILTIN_RESOURCES`（`ffmpeg` / `ffprobe` / `chromeShell`）、`findHyperframesCli`、`findNode`（返回 `{ cmd, env }`）、`findFfmpegBin`、`isHyperframesComposition`，以及 GSAP 本地化的 `localizeGsapHtml` / `referencesLocalGsap` / `copyGsapIntoProject` |
| `./runtime` | `* as runtime` | `missingPacks(RENDER_PACKS)` / `packSizeText(lack)` 做缺包纯校验 |
| `./settings` | `pickRenderOverride` | 渲染档位（质量 / 帧率）白名单校验，与 `projects.ts` 复用同一实现 |
| `../shared/constants` | `CANVAS_SIZES`、`DEFAULT_CANVAS`、`RENDER_CANVASES` | 成片画布（本次新增）：白名单校验、日志留痕里的宽高 |
| `../shared/ipc` | `IPC` | 频道常量 |
| `../shared/types` | `type RegisterCtx`、**`type RenderCanvas`**、`type RuntimePackName`、`type VideoRenderPayload`、`type VideoRenderResult` | `register` 的上下文类型、**画布入参 / 局部变量的类型**、`RENDER_PACKS` 的元素类型、渲染 handler 的载荷/结果类型 |

> 本文件**不 import `node:url`**（量时间轴的 `file:///` URL 是手工拼的）；`app` 的使用点只剩 `writeTrimLog()` 里的 `app.getPath('userData')`。

### 6.2 被谁使用

| 使用方 | 用法 |
|--------|------|
| `src/main/index.ts` | `video.register(ctx)` 完成注册（依赖图注释：`hfEnv ← projects, voice, whisper, ttsAlign, video, runtime`） |
| `src/preload/index.ts` | 暴露 `openHtml` / `renderVideo` / `showInFolder` / `onProgress`，分别转发上述频道 |
| `src/renderer/src/pages/HtmlGenPage/index.vue` | **发起渲染**（「转视频」按钮，带质量 / 帧率档位）、成功后回写产物并刷新项目 |
| `src/renderer/src/pages/VideoPreviewPage/index.vue` | **可选项目的**纯预览：下拉选择要看的项目（默认当前工作项目，只列 `hasVideo` 的项目）、展示 / 定位成品视频；**切换不改工作项目、也不发起渲染** |
| `src/renderer/src/composables/useRenderProgress.ts` | 通过 `window.hfTools.onProgress` 解析 `video:progress` 文本 |

## 7. 注意事项与实现要点

- **渲染根 = HTML 所在的项目目录**：`cwd = path.dirname(htmlPath)`。因此「HTML 必须放在项目目录里」从「约定」升级为「渲染能工作的前提」——`-c` 的入口必须落在项目根之内、媒体 `src` 也按项目根解析。传一个项目外的 HTML 路径进来，行为（尤其是媒体解析）不再有保证。
- **`.render-tmp/` 是项目内的临时目录**：渲染前先 `rmSync` 清残留、渲染入口写在 `<tmpDir>/entry.html`、裁剪产物写在 `<tmpDir>/media/`，渲染收尾（`close` 事件，无论成败）整体删除。若删除失败（文件被占用）会留着，下次渲染前会被先删掉。**它不在 `index.ts` 迁移老数据的白名单 `OWN_DATA_ENTRIES` 里**（那是 Chromium profile 之外的业务条目清单，与旧 `hf-projects` 的处置相同）。
- **`hf-projects` 已下线**：`userData/hf-projects/` 这条渲染临时目录**不再产生**（磁盘上残留的 244 MB 旧目录已人工删除）；`index.ts` 的 `OWN_DATA_ENTRIES` 注释里也只把它当作历史遗留提及。
- **成片时长的规则是 `max(声明, 最长媒体)`**：所以声明（或实测值）必须**同时**把超长媒体裁到同长才生效——这是本模块最容易被误解的一处。声明 5 秒而素材 225 秒，成片仍是 225.4 秒（声明被最长媒体顶掉）；声明 120 秒则精确渲成 120.000 秒（本项目实测）。
- **裁剪是「只裁副本」**：`ffmpeg -c copy -t <target>` 写进 `.render-tmp/media/`，项目里的原始素材一动不动，入口 HTML 里把 `src` 改写成 `./media/<文件名>`。**`-c copy` 不会消除 CLI 的 sparse keyframes 警告**（关键帧间隔原样保留，本项目实测 8.3 秒）——要真正解决得重编码，本轮没做。
- **`0.25` 秒容差**：`dur <= target + 0.25` 就跳过裁剪（容器时长与关键帧对齐会有小误差，差这一点不值得重裁）。
- **裁媒体失败只降级、不阻断**：单条媒体失败写日志继续，整个 `prepareEntry()` 抛错才会让 `video:render` 直接返回「准备渲染入口失败：…」。
- **量时间轴依赖 chrome-headless-shell，且共用一个解析结果**：`chrome` 参数取 `env.PRODUCER_HEADLESS_SHELL_PATH`（来自 `hfEnv.BUILTIN_RESOURCES.chromeShell`）。拿不到（`null`）时装不出这个环境变量，`prepareEntry()` 就跳过 ②、直接走 ③，日志写「chrome=无」。**历史故障正是「`chromeShell` 被缓存的 `null` 永久钉住」**（见 [hfEnv.ts.md](./hfEnv.ts.md) 的 `findChromeShell()`），修正缓存语义后此处才能量到时间轴。
- **量测入口的写法必须常量**：`measureTimelineDuration()` 把量测脚本拆成 `'…</scr' + 'ipt>'` 拼接，避免这段字符串里出现真正的 `</script>` 提前闭合外层脚本。
- **`writeTrimLog()` 的落点是 `userData/video-duration.log`**（不是项目目录、也不是 `runtime.log`）：「片子为什么这么长」这类问题必须留痕可查——裁定结果、媒体裁剪、跳过原因、失败原文都往这里写；**写日志失败被静默忽略**，不影响渲染。
- **渲染入口是临时物、成品不是**：`close` 里只清 `.render-tmp/`；成品 `video/output.mp4` 直接长在项目里，**不存在「从工作目录搬回来」这一步**（旧实现才有）。
- **画布与档位是两套东西、下发路径也不同**：`canvas`（`landscape` / `portrait` / `square`）是**项目属性**，决定 composition / 成片尺寸，经 `applyCanvasDeclaration()` 写进入口的 `<html data-resolution>`；`quality` / `fps` 是**渲染档位**，经 `pickRenderOverride()` 拼成 `--quality` / `--fps`。两者一起随载荷下发，但**画布绝不「缺省不传」**（缺省即落 `DEFAULT_CANVAS`，不传就会被 CLI 兜底成竖屏），而档位缺省就是不传、交给 CLI 默认。**也不要改用 `--resolution` 去改画布**：它只做 DPR 上采样，要求宽高比与 composition 一致且缩放为整数倍。
- **档位只透传白名单值**：`pickRenderOverride(payload)` 过滤掉缺省与非法字段，两个参数都只在**显式给出**时才拼进 CLI 命令，因此「不传档位」与「传默认档位」在 CLI 侧等价（都走 `standard` / `30`）；白名单取值（`draft/standard/high`、`24/30`）与 `shared/types.ts` 的 `RenderQuality` / `RenderFps` 及渲染层 `utils/render.ts` 必须保持一致。
- **本文件不做 GSAP 本地化的兜底判断、也不做 BGM 注入**：本地化那一步只改文本、按需复制到项目目录，**不判断 `copyGsapIntoProject()` 的返回值**（与 `projects.ts` 作者态三处「复制失败即退回 CDN」不同）；`<audio id="myv-bgm">` 完全由 `projects.ts` 的 `applyBgmToHtml()` 在生成 / 修改 / 保存 / 设置音频时写进 `index.html`，渲染时随项目内的 HTML 一起被 CLI 读到，**音轨提取与混入 MP4 全部发生在 HyperFrames CLI 内部**（trace 阶段 `audio_process`）。因此「页面有音轨但成片没声音」应查注入标签是否存在，而不是查本模块。
- **`dialog:open-html` 是保留能力、当前无调用方**：`hfTools.openHtml()` 仍暴露在 preload 上，但渲染层已不再调用；不要据此以为存在「手动选 HTML 渲染」的界面入口。
- **合规校验是硬门槛**：`data-composition-id`、`__timelines`、`gsap` 三者缺一不可，失败时额外回传 `compatible: false` 供界面区分「环境错误」与「HTML 不合规」。
- **Node 的解析与「怎么跑」都交给 `hfEnv.findNode()`**：模块自身不拼 node 路径、不假定可执行文件叫什么名字。`cmd` 在复用 Electron 内嵌 Node 时就是 `process.execPath`（绝对路径，天然规避 nvm shim / WindowsApps alias 下 `spawn('node')` 的 ENOENT），`env` 里带 `ELECTRON_RUN_AS_NODE=1` 并**必须**用 `{ ...process.env, ...nodeRt.env }` 合并；系统 Node 途径 `env` 为空对象。`child.on('error')` 文案里也会带上 `nodeRt.cmd` 便于排查。
- **环境变量注入而非依赖系统 PATH**：`HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` / `PRODUCER_HEADLESS_SHELL_PATH` 均为显式注入，`HYPERFRAMES_CLI` 是 CLI 缺失时的可选回退。这些变量名与 `hfEnv.ts` 的读取逻辑一一对应。**量时间轴（ffprobe / ffmpeg / chrome）用的就是同一份 `env`**，所以缺包时整段准备阶段根本不会开始（第 1 步就回了 `needPacks`）。
- **`done` 幂等**：`finished` 标志位防止 `error` 与 `close` 双触发导致 Promise 重复 settle。
- **进度不解析、只透传**：主进程原样转发子进程 stdout/stderr 文本，`[Render:trace]` 一类的语义解析在渲染层完成。
- **不生成预览外壳**：模块只注册三个 handler 与一路推送，项目内只临时产出 `.render-tmp/**` 与成品 `video/output.mp4`，不写任何 HTML 外壳文件，也不生成 `index.preview.html`（那是 `projects.ts` 的 `project:preview-html`）。
- **本模块需要的两个包都不随安装包**：`ffmpeg`（解包 179.9 MB）与 `hyperframes`（解包 439.9 MB）各是一个 7z（**实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14），首次用到时下载并解到 `<userData>/runtime/<包名>/`（`src/main/runtime.ts`）。因此 `BUILTIN_RESOURCES.ffmpeg` / `ffprobe` / `chromeShell` 在这些包未就绪时分别是空串 / `null`，上面的环境变量注入会整段跳过；缺包时第 1 步就把 `needPacks` 交回界面，**不会**走到「CLI / Node 定位失败」那种报错。
- **实测数据（本项目的真实项目，2026-10）**：动画内容 36.65 秒结束、GSAP 时间轴 45 秒（被一条 45 秒的进度条动画撑长）、旁白 / 字幕到 60 秒、素材视频与 BGM 都是 225.4 秒。声明有效性对照：**无声明 → 成片 225.4 秒；声明 5 → 仍 225.4 秒（被最长媒体顶掉）；声明 120 → 精确 120.000 秒**。裁剪效果：213.5 MB 素材 → 44.6 MB / 45.1 秒，`-c copy` 约 0.1 秒完成。就地渲染验证：`◇ projects\任意文件女生\video\output.mp4 1.1 MB · 5.0s · rendered in 17.4s`（子目录入口 + `../` 素材引用 + 输出直写项目 + 无事务残渣）。
