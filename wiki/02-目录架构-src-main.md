# 02 · 目录架构：`src/main/`（主进程）

> 主进程是整个应用的能力中心：窗口与生命周期、运行环境（**分包**：ffmpeg / hyperframes 各自一个 7z、首次用到时下载，whisper 随安装包）的准备与解包、userData 历史数据目录的扫描与**用户确认式处置**（`legacy:*` 两个频道 + 渲染层应用内弹窗）、文件系统、外部程序调用（whisper / ffmpeg / HyperFrames）、全部网络请求（Qwen-TTS / 自定义模型 / 模型下载 / 运行环境包）以及 **94** 个 IPC 频道的实现，全部集中在这个目录。

---

## 1. 文件清单

| 文件 | 行数 | 角色 | 注册的 IPC 域 |
|---|---|---|---|
| [index.ts](./files/main/index.ts.md) | 546 | **入口装配器**：历史数据目录的归属证明（`isOurs` / `hasOurIdentity`，`.shadowmill-data` 按内容认）与**用户确认式处置**（`legacyInfo()` 扫一次即缓存 → `legacy:status` 交给渲染层；`resolveLegacy()` 执行 `migrate` / `delete` / `later`）、生命周期、窗口（含主题底色 `backgroundColor`）、`hgpreview://` 协议（**两条路由**：`p/<项目名>/…` 项目内文件、`tts/<相对路径>?tts=1` 项目外语音产物且只读白名单 `TTS_PREVIEW_DIRS = ['tts-output','voice']`；路径解析抽成 `resolveHgPreviewPath(rawUrl)`；`rangeResponse()` 支持 `Range` 字节范围取 → `206` / `416`，响应体走文件流）、窗口控制与剪贴板 IPC、各域 `register()` 顺序（**含 `agent.registerScript(projects.projectDir)`**——把项目目录解析函数注入给 agent）、启动时序打点 `startup.log` | `window:*`、`app:copy-text`、`legacy:*` |
| [hfEnv.ts](./files/main/hfEnv.ts.md) | 343 | 环境探测与**按包解析**的内置资源定位（`resolvePackRoot()` / `refreshPack()` / `packReady()`，`root` 只作旧布局与 dev 的兜底）+ GSAP 本地化 / 导出外部化辅助（不注册 IPC）；`findChromeShell()` **只缓存「找到的」结果**（找不到返回 `null` 但不写缓存，避免「解包完成前被问过一次」把 `chrome=无` 永久钉住） | — |
| [settings.ts](./files/main/settings.ts.md) | 452 | 设置存储（`userData/settings.json`，含 `voice` 按厂家配置（**只有 apiKey**）与视频渲染默认档位）+ OpenAI SDK 懒加载入口 `loadOpenAI` + 「出厂状态」判定 `isPristineSettings`（供 index.ts 的 `migrateFrom()` 迁移老数据时决定能否覆盖 settings.json）+ 运行环境「从本地文件安装…」`settings:pick-runtime-pack`（选 `ffmpeg.7z` / `hyperframes.7z` 导入 `userData/runtime/local-import/`） | `settings:*`（6） |
| [systemVoices.ts](./files/main/systemVoices.ts.md) | 62 | Qwen-TTS 内置系统音色静态表（**只有 `SYSTEM_VOICES` 一个导出**，判定函数已删除） | — |
| [agent/](./files/main/agent.md)（**目录级一篇，5 个文件**：`chat.ts` 261 / `chatLog.ts` 155 / `html.ts` 89 / `script.ts` 329 / `index.ts` 15） | 261 / 155 / 89 / 329 / 15 | **Agent 层**（同名目录 + `index.ts` 统一出口，依赖单向 `chat ← html / script`、`script → chatLog`）：`chat.ts` 是**通用对话层**——多轮 `messages` + 流式（`openai` SDK / `fetch` 手写 SSE 两条等价路径）+ `max_tokens` 升档重试（`MAX_TOKEN_TRIES = [32768, 65536]`，`finish_reason === 'length'` 时用调用方的 `isComplete` 判完整性）+ 全过程记录追加 `userData/<logFile>` 的 jsonl + 人话错误 + 300ms 节流进度，**不认识任何业务、不读写项目文件**；`chatLog.ts` 是**对话记录的磁盘读写**（`MAX_CHAT_ROUNDS = 100` / `chatDirOf` + `chatIndexPathOf`（`chat/index.json` + `versions/<id>.json`）/ `isValidVersionId` / `newVersionId` / `normalizeScenes` / `readChatIndex` / `writeChatIndex`（写后清理不再被引用的副本）/ `writeVersion` / `readVersion` / `clearChat`，只依赖 `node:fs` / `node:path` / 类型，**不由 `index.ts` 再导出**）；`html.ts` 是 HTML 薄封装（`HTML_AGENT_SYSTEM` + `extractHtmlFromReply` + `chatWithCustomModel` + `AgentProgress` / `AgentOpts`）；`script.ts` 是内容脚本 Agent（`SCRIPT_AGENT_SYSTEM` + `buildScriptPrompt` + `parseScriptReply` + **`registerScript(getProjectDir)`**，不 import `node:fs` / `node:path`、不反向 import projects）；`index.ts` **只做再导出、不写逻辑**。`projects.ts` 只 `from './agent'` 取三个名字 | `script:generate` / `script:load-chat` / `script:append-round` / `script:read-version` / `script:set-active-version` / `script:clear-chat`（6 handle）+ `script:progress`（推送） |
| [projects.ts](./files/main/projects.ts.md) | 1224 | 项目化流水线：`project.json`（**只存索引 `ProjectIndex`**）+ `subtitle.txt` / `content.json`（**两个正文文件**，老项目读时兼容、写时自动迁移）、**项目素材库（多图片 / 多视频：选文件 / 复制入库 / 整份列表回写）**、HTML、背景音轨注入（`<audio id="myv-bgm">`）、GSAP 本地化 / 导出外部化（含复制失败退回 CDN 的兜底）、**成片画布（项目属性：写进生成提示词的【画布】块；由 `project:set-canvas` 落进 `project.json` 的 `canvas`，值一变旧 `videoPath` 置空；**修改路径的【画布】块多带一条「旧页面版式与新画布不一致就必须重排」的硬要求**）**、**生成 / 修改共用的【禁止无限循环】提示词块**（`tl.to` / `tl.fromTo` / `gsap.to` 一律不许 `repeat: -1`、不许 `repeat: Infinity`；呼吸 / 闪烁 / 流光 / 数字雨 / 扫描线一律用有限次数并按目标秒数算好）、音视频产物（项目结构再导出 `shared/types`；项目根 `projectsRoot()` 为**函数**、惰性求值；预览副本注入脚本默认静止、支持 `seek` 播放头定位与播完自动停住，**并对「超长总时长」判为不可信**——超过页面声明时长 10 倍或 24 小时就回 `{ dur: 0, unknown: true }`、不猜假时长；**`project:preview-html` 还会从原 HTML 解析页面自己声明的画布，作为 `pageCanvas` 一并回给渲染层**） | `project:*`（25 handle + 1 推送） |
| [voiceCatalog.ts](./files/main/voiceCatalog.ts.md) | 104 | **语音服务目录（按厂家组织）**：厂家定义 `VoiceProviderDef`（Key 提示 / apiBase / 克隆模型 `enrollModel` / 出厂默认模型 / 模型表 / 系统音色表）+ 查询函数（`providerByKey` / `providerOfModel` / `providerOfSystemVoice` / `seriesDefaultModel`）；千问模型表 **2 条**（`qwen3-tts-flash` 系统 / `qwen-audio-3.0-tts-flash` 复刻——本地文件 + 公网 URL）；**`enrollModelAudio` 字段与 vc 系列的两条 clone 模型已删除** | — |
| [voice.ts](./files/main/voice.ts.md) | 753 | 语音服务（按厂家取端点与 Key）：音色管理 + 文字生音频；**跨厂家「音色 ↔ 模型」绑定会被显式拒绝**，映射绑着已下线模型时忽略并按固定绑定回落；**克隆只服务 Qwen-Audio-TTS**（非 `qwen-audio-*` 目标模型直接拒绝），参考音频用内置 ffmpeg 裁前 15 秒并转 data URI 提交（`input.url` 也收公网 URL，`prefix` 统一 10 位）；**合成一律「接口 → `output.audio.url` → 二次下载」**；**云端克隆音色列表单一接口 `list_voice`**；`voice:delete-cloud`（删云端克隆音色，**单一写法 `action:'delete_voice'`**）；`voice:save-config` 分「存某厂家 Key」与「只存全局保存目录」两条路径 | `voice:*`（16） |
| [ttsAlign.ts](./files/main/ttsAlign.ts.md) | 338 | 字幕配音逐句合成与时间对齐（模式 A/B）；`voice:synth-aligned` 先 `runtime.missingPacks(['ffmpeg'])` 校验，缺包即返回 `needPacks` | `voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| [video.ts](./files/main/video.ts.md) | 457 | HyperFrames 转视频，**就地渲染**：渲染根 = HTML 所在的项目目录（不再有 `hf-projects` 临时工作目录），成品直写 `<项目目录>/video/output.mp4`；**渲染前先过一道无限循环静态守卫**——页面原文命中 GSAP 的 `repeat: -1` / `repeat: Infinity` 就当场拒绝（GSAP 把这种 tween 当 1e10 秒，不拦会按 1e10 秒排帧、永远渲不完），**不进 CLI、不建 `.render-tmp`**，CSS 的 `animation-iteration-count: infinite` 不拦；随后**裁定成片时长**（① `<html data-composition-duration>` 声明 → ② 无头 Chromium 现场量 GSAP 时间轴 → ③ 交给 CLI 按最长媒体），**并把裁定出的时长写进舞台元素的 `data-duration`（`applyStageDuration`，CLI 编译阶段只读这里；`<html data-composition-duration>` 只做页面自描述，仅在页面原本没声明时才补）**，再按裁定值用 `ffmpeg -c copy` 把超长媒体**裁成副本**（`<项目目录>/.render-tmp/media/`，只裁副本、原件不动），入口写在 `.render-tmp/entry.html`（GSAP 引用改写为 `../gsap.min.js`；**并按项目画布往渲染入口的舞台元素注入 `data-width`/`data-height`——成片宽高的真正来源，不注入 CLI 就兜底 1080×1920 竖屏；同时往 `<html>` 注入 `data-resolution` 作页面自描述**）、渲完即删；音轨来自页面内的 `<audio id="myv-bgm">`（由 projects.ts 注入）；`video:render` 先按 `RENDER_PACKS = ['ffmpeg','hyperframes']` 校验，缺包即返回 `needPacks` | `dialog:open-html`、`video:*`（3 handle + 1 推送） |
| [whisper.ts](./files/main/whisper.ts.md) | 729 | whisper.cpp 转录 + 识别模型下载/管理；`resolveCliPath()` **优先** `process.resourcesPath/whisper/`（whisper 随安装包），只在「非 wav/flac/mp3/ogg 要转码」且缺 ffmpeg 时以 `FfmpegNeededError` 回 `needPacks:['ffmpeg']` | `whisper:*`（11 handle + 1 推送） |
| [updater/index.ts](./files/main/updater.md) | 108 | 应用自更新（electron-updater generic provider，**懒加载**）与 3 秒启动静默检查的**统一出口**：`register(ctx)` 装配 8 个 `update:*` 频道（含**状态补齐 `update:status`**、**打开日志**与**取随包更新日志原文 `update:changelog`**），各子文件的具名导出原样挂在 index 上（调用方零改动） | `update:*`（7 handle + 1 `on`/`sendSync` + 1 推送） |
| [updater/base.ts](./files/main/updater.md)（同篇） | 285 | 底座（依赖最上游，不 import 同目录任何模块）：`updater` / `flags` / `state` 运行态单例、日志与小工具、**随包 `CHANGELOG.md` 的定位与读取**（`changelogPath()` / `readBundledChangelog()`）、`humanError()` 文案分层（`message` / `detail`）、进度 `payload()` / `send()`、6 个事件绑定 `bindEvents()`、懒加载 `ensureUpdater()` | — |
| [updater/actions.ts](./files/main/updater.md)（同篇） | 139 | 对外动作：检查 / 下载 / 取消、更新源覆盖 `applyFeedUrl()`（私有）、两条「无事件不许报成功」的守卫 | — |
| [updater/install.ts](./files/main/updater.md)（同篇） | 134 | 退出并安装（`quitAndInstall`）、下载缓存清理（`finalizePendingUpdate()`）、忙碌态判定（`bindBusyTracking()`） | — |
| [runtime.ts](./files/main/runtime.ts.md) | 959 | 运行环境（**分包**）：`PACK_DEFS` 包注册表（`ffmpeg` 180 MB / `hyperframes` 440 MB 各成一个 7z，whisper 不进包）→ 从更新源或本地包取 `<包名>.json` + `<包名>.7z` → sha512 校验（`Range` 断点续传）→ `7za` 解到 `userData/runtime/<包名>/`，维护 `packs.json` 记录 + 每包自己的 `ok.json` 完整性标记，就绪后按包调 `hfEnv.refreshPack()`；`packsStatus()` 纯探测、`ensurePacks()` 才下载解包（可取消），`register()` 里**启动只探测不下载**（排最后只保证 handler 先挂上）；取远端清单有 **20 秒硬超时**（`MANIFEST_TIMEOUT`，超时不算取消、残片保留） | `runtime:*`（3 handle + 1 推送） |
| [vad.ts](./files/main/vad.ts.md) | 122 | WAV 采样读取与静音裁剪（零依赖纯函数） | — |

> 行数取自工作区源码实测（`[IO.File]::ReadAllLines` 与编辑器行号一致）。目录下共 **21** 个 `.ts` 文件 = **12 个顶层文件 + `agent/` 目录 5 个文件 + `updater/` 目录 4 个文件**（`Get-ChildItem src\main -Recurse -File -Filter *.ts` 实测）；上表**已全部收录**（含 `runtime.ts`，其逐文件说明见 [files/main/runtime.ts.md](./files/main/runtime.ts.md)；`agent/` 与 `updater/` 各合成**目录级一篇**：[files/main/agent.md](./files/main/agent.md)、[files/main/updater.md](./files/main/updater.md)，旧名 [files/main/updater.ts.md](./files/main/updater.ts.md) 只留过渡指针）。
>
> 目录 / 文件组织约定见根 `AGENTS.md` 关键约定 9：**300 行考虑拆、500 行是硬上限**；模块拆分的形态固定为「**同名目录 + `index.ts` 统一出口**、具名导出原样挂在 `index.ts` 上、依赖方向单向、跨文件共享的 `let` 收进 `state` / `flags` 对象或改取值函数（不许按值导出）」，另有 4 类可不拆的例外。`updater/` 与 `agent/` 就是这条约定的两个样板。

---

## 2. 装配模式：`register(ctx)`

所有业务域模块都导出统一的 `register(ctx?: RegisterCtx)` 函数，由入口在窗口创建后依次调用：

```ts
// src/main/index.ts
const ctx: RegisterCtx = { getWindow }        // getWindow: () => BrowserWindow | null
settings.register(ctx)
projects.register(ctx)

agent.registerScript(projects.projectDir)      // 只传「项目名 → 项目目录」，不传 ctx
voice.register(ctx)
ttsAlign.register(ctx)
video.register(ctx)
whisper.register(ctx)
updater.register(ctx)

runtime.register(ctx)                          // 运行环境包，最后一步
```

> `agent.registerScript(projects.projectDir)` 是**唯一不接收 `ctx` 的 register**：它既不弹对话框（不需要父窗口）、也不读主窗口引用，推送走 `event.sender`（发起调用的那个窗口）。它唯一的一个参数是**「项目名 → 项目目录」的解析函数**（`projects.projectDir`，`src/main/projects.ts` 导出），用于拼 `projects/<项目名>/chat/index.json` 与 `chat/versions/<id>.json` 的路径；**传函数而不是让 agent 去 import projects**——否则会与 `projects → agent`（`projects.ts` 调 `chatWithCustomModel`）成环。函数名是 `registerScript` 而不是 `register`（收进 `src/main/agent/` 目录时改的），避免与 HTML 侧入口混淆。

> `updater.register(ctx)` 除注册 `update:*` 频道，还会在 3 秒后做一次「启动静默检查」（受 `settings.json` 的 `updater.autoCheck` 控制；dev 环境未提供 `dev-app-update.yml` 时跳过）；主进程更新状态 `state` 常驻，渲染层可随时用 `update:status` 取一次（设置页据此补出这次静默检查的失败）。`runtime.register(ctx)` 排在最后：它在 `register()` 里**只做一次探测**（`prepareInBackground()` **不下载**），排最后只保证自己的 handler 先挂上——需要同步做的只有几个 `existsSync` / `statSync` 探测（微秒级）；真正的下载 / 解包要等用户在界面上确认后 `ensurePacks()` 才发生（可取消）。
>
> `index.ts` 自身的 `legacy:*` 两个 handler 也在这个位置注册（`createWindow()` 之后、`ctx` 之前），但它们不属于 `register(ctx)` 模式——它们直接写在入口里，见 §4.1。

- `RegisterCtx`（`src/shared/types.ts`）只提供一个能力：拿到主窗口引用，使各域的 `dialog.showOpenDialog` / `showSaveDialog` 以主窗口为父，弹出模态对话框而非游离窗口。
- `register` 是各域**唯一**的 IPC 注册入口：域内的 `ipcMain.handle` / `ipcMain.on` 全部集中在这一个函数体内，便于审阅整个域对外的接口面。
- `index.ts` 自身不属于该模式，它直接注册窗口控制与剪贴板频道。

---

## 3. 模块依赖图（无环）

```
settings ──→ agent(chat ← html / script；script → chatLog) ──→ projects ──→ voice ──→ ttsAlign
                     │
                     └─ script 只造 JSON、不碰文件工具；对话记录读写下沉到 chatLog；index.ts 只再导出（对外仍是 './agent'）
                                      ↗
hfEnv ──→ projects / voice / whisper / ttsAlign / video / runtime
vad   ──→ whisper
systemVoices ──→ voice
settings ──→ updater（读 updater.feedUrl / autoCheck / skippedVersion）
index.ts ──→ settings（处置老数据时用 isPristineSettings 判定出厂状态）
runtime ──→ hfEnv / settings（按包交接资源根 hfEnv.refreshPack()、下载源取 updater.feedUrl）
projects / video / ttsAlign / whisper ──→ runtime（动手前 runtime.missingPacks() 纯校验：缺包即返回 needPacks，不阻塞）
shared/{ipc,types,errors,constants} ──→ 全部模块（常量、跨进程类型与纯函数映射）
```

| 依赖边 | 具体协作点 |
|---|---|
| `voice → projects` | 用 `projects.projectsRoot()`（**函数，惰性求值**）定位项目 `audio/` 与枚举项目（`scanProjects()`）；三处调用点见 [voice.ts.md](./files/main/voice.ts.md) §5 |
| `ttsAlign → voice` | 复用 `synthOne()`（单句合成）、`resolveVoiceModel()`（音色→模型解析）、`voiceFriendlyError()`（错误友好化） |
| `whisper → vad` | 转录前用 `vadTrimSegments()` 裁掉起止静音；用 `toVadSamples()`（走 `hfEnv` 的 ffmpeg）统一采样率 |
| `whisper / ttsAlign / video / projects / voice → hfEnv` | 定位 CLI、Node 运行方式（`findNode()` 返回 `{ cmd, env }`，**两级**优先：Electron 内嵌 Node → 系统 Node ≥ 22）、按包解析的 FFmpeg bin（`ffmpeg` 包）与 chrome-headless-shell（`hyperframes` 包），以及 `isHyperframesComposition()` 合规校验；`projects` / `video` 另用 GSAP 本地化的 `localizeGsapHtml()` / `referencesLocalGsap()` / `copyGsapIntoProject()`；`voice.ts` 用 `BUILTIN_RESOURCES.ffmpeg` / `ffprobe`（来自 ffmpeg 运行环境包，未安装时为空串）裁剪克隆参考音频 |
| `projects → agent（html.ts）` | `project:generate-html` / `project:modify-html` 调用 `chatWithCustomModel()`，并把 `onProgress` 映射为阶段文案推送给渲染层（`html.ts` 本身是薄封装，真正的传输在 `agent/chat.ts`） |
| `agent/chat.ts ← agent/html.ts / agent/script.ts / agent/chatLog.ts` | `html.ts` 的 `chatWithCustomModel()` 与 `script.ts` 的 `script:generate` 都调 `chatWithModel()`——传输层（多轮 / 流式 / 升档 / 日志 / 错误翻译）只有一份；`chat.ts → settings`（`getCustomModel` / `loadOpenAI`）与 `chat.ts → shared/errors`（`friendlyError`）是这两条 Agent 链路唯一的配置与报错出口。**方向单向：`chat` 在最上游，`html` / `script` 只依赖它；`chatLog` 只被 `script` 依赖、自己只依赖 `node:fs` / `node:path` / 类型** |
| `agent → index.ts` | `index.ts` 里 `import * as agent from './agent'` 并在 `projects.register(ctx)` 之后调 **`agent.registerScript(projects.projectDir)`**；`agent/script.ts` 只依赖 `./chat` / `./chatLog` / `shared/{errors,ipc,types}`，**不 import projects / settings / hfEnv**（项目目录是构造参数，见 §2）；`agent/index.ts` 只做再导出（**不含 chatLog**） |
| `projects → shared/constants` | **本轮新增**：`IMAGE_MATERIAL_EXTS` / `MAX_MATERIALS` / `VIDEO_MATERIAL_EXTS` —— 素材类型判定（`materialKindOf()`）、文件框过滤（`project:pick-media`）、上限校验（`project:add-materials`）与列表截断（`normalizeMaterials()`）共用同一份白名单与上限，渲染层用同一份常量显示 `n / 20` 与支持格式 |
| `voice / whisper / agent（经 chat.ts） → settings` | 读取 API Key、目标模型、当前识别模型与自定义模型列表；写回配置 |
| `index → settings` | 用户选「迁移过来」后，`migrateFrom()` 调 `settings.isPristineSettings(dst)` 判断新 `settings.json` 是否仍是「出厂状态」（是才允许被老配置覆盖，覆盖前先备份成 `.before-migrate.bak`） |
| `projects → runtime` | `project:extract-video-audio` 先 `runtime.missingPacks(['ffmpeg'])` 纯校验，缺包直接返回 `{ ok:false, needPacks, message }`（不下载、不阻塞）；`video.ts`（`['ffmpeg','hyperframes']`）/ `ttsAlign.ts`（`['ffmpeg']`）/ `whisper.ts`（转码时才要 `ffmpeg`）同构 |
| `runtime → hfEnv` | 探测到某包就绪（`syncStatus()`）与解包完成时调 `hfEnv.refreshPack(name, root)`，把该包目录交给 `hfEnv` 重算它的包缓存（并按需失效 `cachedChrome` / `cachedNode`）；`refreshBuiltinResources(root?)` 仅作兼容保留 |
| `runtime → settings` | `getUpdaterSettings().feedUrl` 作为运行环境包的下载源（与 `updater/actions.ts` 的 `applyFeedUrl()` 同优先级，其次才回落 `app-update.yml`） |
| `updater → settings` | 读 `updater.feedUrl`（非空即 `autoUpdater.setFeedURL` 覆盖打包内置地址）、`autoCheck`（启动静默检查开关）、`skippedVersion`（用户跳过的版本）；下载「跳过版本」的更新时清掉该标记 |

`src/main/index.ts` 顶部的注释即为这份依赖图的权威描述（`settings ← agent(chat ← html/script) ← projects ← voice ← ttsAlign`；`hfEnv ← projects, voice, whisper, ttsAlign, video, runtime`；`updater ← settings`；无环）。

---

## 4. 各模块职责

### 4.1 `index.ts` —— 入口装配器

- **userData 位置保持 Electron 默认**：`const USER_DATA_DIR = app.getPath('userData')`，即 `%APPDATA%\<package.json 的 name>`（现 `%APPDATA%\shadowmill`）。**刻意不做 `app.setPath('userData', …)`**——目录名继续跟随 `name`，保持 Electron 的默认语义。
- **归属证明（`isOurs`）**：`my-app` 这种名字太通用，`%APPDATA%` 下可能有别的应用也叫这个；只按名字就弹「要不要迁移」有把别人数据搬进来的风险。所以扫到同名目录后先证明「它是我们的」：① `hasOurIdentity(dir)`——遍历目录里**点开头**的条目（标记文件必是点开头），跳过 >64KB 的，`JSON.parse` 后 `appId === APP_ID`（`'com.shadowmill.app'`，与 `build.appId` 一致）即通过；**只看内容、不猜文件名**；② 否则看结构特征 `<dir>\projects\<项目名>\project.json` 是否存在（**专为标记机制上线之前的历史目录准备**，如 `my-app`）；③ 都不满足 ⇒ 不提示、不迁移。标记由 `writeIdentity(USER_DATA_DIR)` 在**模块体里立刻写一次**（固定名 `.shadowmill-data`；`appId` / `dirName` 未变则跳过，幂等；失败静默）。
- **历史数据目录：扫描 + 用户确认式迁移**：品牌更名（`my-app` → `shadowmill`）后目录名随之改变，老用户看到「项目全没了」（数据其实还在 `%APPDATA%\my-app`）。`findLegacyData()` 扫 `LEGACY_DIR_NAMES = ['my-app']`，四道闸依次：排除自身（`toLowerCase` 比较）→ 目录存在 → **归属证明通过** → 白名单条目**确有数据**（空壳——只剩 Chromium 缓存或空目录——不打扰用户）；返回 `{ dir, entries, projects }`（`projects` 是 `projects/` 里的条目数，用来在文案里说「N 个项目」）。
- **用户决定，不静默处置**：入口在 `createWindow()` 之后注册两个 handler——`ipcMain.handle(IPC.Legacy.Status, () => legacyInfo())`、`ipcMain.handle(IPC.Legacy.Resolve, (_e, action) => resolveLegacy(action))`。`legacyInfo()` **扫一次即缓存**（模块级 `legacyScanned` / `legacyFound`；`MIGRATE_USER_DATA=0` 时恒返回 `null`），只回答「有没有 / 是什么」；渲染层外壳挂载时问一次 `legacy:status`，有结果就弹**应用内**弹窗（`src/renderer/src/components/LegacyDataDialog.vue`，复用 `.hf-modal` 体系），用户选完把 `migrate` / `delete` / `later` 经 `legacy:resolve` 回传，由 `resolveLegacy()` 执行（**非法或缺省的 action 一律当 `'later'`**）。**三个取舍**：① 不用原生 `dialog.showMessageBox`——它与 Cyber UI 设计系统不一致；② **删掉了原先建窗后 1.5s 的 `setTimeout`**——显示时机交给渲染层；③ 主进程不做任何界面展示，提示（toast）也在渲染层。「稍后再说」什么都不动、**下次启动再问**；`MIGRATE_USER_DATA=0` 可关闭整段功能。
- **迁移语义（`migrateFrom`：移动、逐项、不覆盖）**：只搬 `OWN_DATA_ENTRIES = ['projects','whisper','voice','tts-output','html-agent','settings.json']`；**目标不存在时整个条目直接 `renameSync`**，失败才落到 `mergeTree()` **递归合并**，两边都有的**文件**一律跳过、绝不覆盖；`settings.json` 是唯一特例——只有新文件**还是出厂状态**（`settings.isPristineSettings()`）才用老配置覆盖，覆盖前先备份成 `settings.json.before-migrate.bak`。收尾是 `pruneEmptyDirs()` + 一行 `startup.log`，返回 `{ ok, action, moved, skipped, failed, message }`：**只有 `failed === 0` 才清缓存**。
- **删除要二次校验（也不弹错误框）**：`resolveLegacy('delete')` 先确认目标确实等于 `%APPDATA%\<LEGACY_DIR_NAMES 里的名字>`（大小写不敏感比较），不通过返回 `{ ok: false, action, message: '该目录不在允许删除的名单内' }`。
- **⚠ 代价：`LEGACY_DIR_NAMES` 是手工清单**：它**是唯一的发现机制**，以后再改 `package.json` 的 `name`，**必须**把旧名字加进这份清单。
- **`.shadowmill-data` 的职责已变**：不再承担旧方案的「启动时按标记自动认领」，现在只有两个用途——(a) 扫描历史目录时的**归属证明**、(b) 将来改名后「这个目录是我的」的依据。
- **刻意不碰 Chromium profile**：白名单之外的一切（`Cache` / `Code Cache` / `GPUCache` / `Local State` / `Network` / `IndexedDB` …）都不搬；**曾经的渲染临时目录 `hf-projects` 同样不在白名单**——它已随「就地渲染」下线（不再产生，旧目录已删），渲染的中间产物现在只在项目内的 `.render-tmp/`（渲完即删）。
- **业务模块的惰性路径写法是「纯保险」**：`projectsRoot()` 等一律写成函数 / getter。落地样板：`projects.projectsRoot()`、`whisper.modelsDir()`、`runtime.runtimeDir()`、`settings.settingsFile()`。
- **启动时序打点**：`bootLog(stage)` 往 `userData/startup.log` 追加 `ISO 时间 + '+<距进程启动毫秒>ms ' + 阶段`；文件超 64KB 自动清空，写失败静默。
- **协议特权与白名单**：`app` ready **之前**调用 `protocol.registerSchemesAsPrivileged([{ scheme: 'hgpreview', privileges: { standard, secure, supportFetchAPI, stream } }])`（`standard` 保证相对路径解析、`secure` 对齐 `file://` 的安全上下文行为）；紧随其后声明 **`const TTS_PREVIEW_DIRS = ['tts-output', 'voice']`** —— 语音产物路由（`?tts=1`）允许读的 userData 子目录白名单，注释写明两者各自是什么：`tts-output` = 语音合成结果与「生成记录」列表里的历史音频，`voice` = 逐句对齐的产物（`voice/align-<时间戳>/xxx_aligned_*.wav` 与 `raw/*.wav`）。ready 之后 `protocol.handle('hgpreview', …)` 把 URL 映射回磁盘，**两条路由**：
  - `hgpreview://p/<encodeURIComponent(项目名)>/<相对路径>`（项目文件）⇒ `projects.projectDir(name)` 内的文件；
  - `hgpreview://tts/<相对路径>?tts=1`（**本轮新增**，语音产物）⇒ `app.getPath('userData')` 下的文件，但**只允许**顶层目录落在 `TTS_PREVIEW_DIRS` 里；不在白名单 ⇒ **403** 并写 `preview-protocol.log`。**为什么要单开一条**：这些语音产物不在任何项目目录里，而 `<audio src="file://…">` 在 dev 下会被 Chromium 拒（渲染页跑在 `http://localhost`，见 [01-架构总览](./01-架构总览.md) 与 CHANGELOG #25）；白名单绝不放行任意路径，对齐产物含 `align-*/raw/*.wav` 多级子目录，所以按目录前缀解析。
  - **路由解析抽成独立函数 `resolveHgPreviewPath(rawUrl)`**（定义在 `protocol.handle` **之前**，把「路径段 → 允许读的绝对路径」整段从处理器里抽出来）：返回 `{ full, why }`（`full` 为空串 = 不允许读，`why` 进 403 日志）或 `null`（URL 无法解析 / 段为空 ⇒ 404）。**判定按「段 + 查询标记」、不看 host**：`isTts = u.searchParams.get('tts') === '1' || segs[0] === 'tts'` —— `?tts=1` 是渲染层现用写法，把 `tts` 放在 `pathname` 首段的旧设想写法也一并识别（免得手写 URL 掉进项目分支）；`tts` 分支的 `why` 取 `not-in-whitelist:<top>` / `traversal`，项目分支取 `traversal:<name>`，项目分支 **不再剥 `p/`**（`hgpreview://p/<项目名>/…` 里 `p` 在 host 位、`pathname` 首段就是项目名，剥了会把真项目名当路由标记吃掉）。
  - **路径解码口径**：`new URL(request.url).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s))` —— **按段解码**；渲染层因此统一走 [common.md](./files/renderer/src/common.md) §7.3 的 `src/renderer/src/utils/url.ts`：**逐段 `encodeURIComponent`、斜杠保持原样**，两端口径严格对应（段与段一一对应，不依赖解码后的再拆分）。
  - ✅ **已实测命中（历史注记保留）**：`ttsUrl()` 早期版本产出的是 `hgpreview://tts/<相对路径>`（没有 `?tts=1`），而 `tts` 落在 **host 位**、`new URL(url).pathname` 里根本没有它（Node 实测 `new URL('hgpreview://tts/voice/align-1/raw/0000.wav').pathname === '/voice/align-1/raw/0000.wav'`）——处理器若按 `pathname` 首段判路由，就会把 `voice` 当项目名去 `projects.projectDir()` 找 ⇒ 404。**修法**：渲染层 URL 追加 `?tts=1` 查询标记、处理器改按查询标记路由（host 位那个 `tts` 只留作可读性，不参与判定）。主进程侧已用**真实文件**对照验证：`?tts=1`（`tts-output/…wav`、`voice/align-*/raw/0000.wav`）与旧写法 `/tts/…` 都命中，白名单外（`runtime/…`）拒绝 `not-in-whitelist`，`..%2F` 拒绝 `traversal`，`hgpreview://p/<中文项目名>/video/output.mp4` 命中、项目穿越拒绝；再按 `utils/url.ts` 的口径生成 URL 喂回解析函数，4/4 命中（合成结果 / 对齐片段 / 成品视频 / 预览副本），含 `#` 的文件名被正确编码成 `%23`。
  - **处理器本体只剩四步**：`resolveHgPreviewPath(request.url)` → `null` 记 `404` / `!full` 记 `403 <url>（<why>）` / 文件不存在或非文件记 `404` / 否则 `rangeResponse(hit.full, request)`；异常落 `catch` 记 `500` 并回 400。
  - **用途**：预览 iframe（`HtmlGenPage/PreviewSection.vue` 的 `loadFrame()`）与**素材缩略图**（`HtmlGenPage/MaterialsSection.vue` 的 `thumbUrl(file)`）走 `p/` 路由；`p/` 路由还服务成品视频（`VideoPreviewPage/index.vue` 的 `toHgPreviewUrl()`）与项目内背景音频试听（`PreviewSection.vue` 的 `setAudioPreview()`）；`?tts=1` 路由服务**项目外**语音产物的试听（`TextTtsPage/SynthSection.vue` 与 `AlignSection.vue` 的 `ttsUrl()`）。素材缩略图是本轮 `src/renderer/index.html` 的 CSP 在 `img-src` 里放行 `hgpreview:` 的原因，`frame-src` / `media-src` 同样放行它（预览 iframe、成品视频与音频试听都靠这条）。
  - 响应统一由 `rangeResponse(full, request)` 构造；MIME 由 `previewMime()` 的扩展名表显式给出（音频 / 视频扩展名在其中），基础响应头为 `Content-Type` + `Accept-Ranges: bytes` + `Cache-Control: no-store`。
    - **支持 `Range` 字节范围**：`bytes=N-` / `bytes=N-M` / 后缀 `bytes=-N`；命中 ⇒ `206` + `Content-Range`；非法或不可满足 ⇒ `416`；无 `Range` ⇒ `200`；`HEAD` 只回响应头。
    - **为什么**：Chromium 只在响应支持字节范围时才把 `<audio>` / `<video>` 判成可跳转，否则预览页媒体 `seekable` 恒为 `[0, 0]`（音频试听同样吃这条特性）。
    - **响应体是流**：`fs.createReadStream(full, { start, end })`（范围）或整文件，经 `Readable.toWeb()` 转成 `BodyInit`。
  - 失败路径与 403 都写入 `userData/preview-protocol.log`（`log()` 逐行追加 ISO 时间 + 状态码 + URL；`404` / `500` 走同一条通道）便于排查。
- **窗口**：单窗口 `1200×800`（最小 `800×600`）、`titleBarStyle: 'hidden'`、**`backgroundColor: '#0B1220'`**、`Menu.setApplicationMenu(null)`、`contextIsolation: true` / `nodeIntegration: false`、preload 指向 `../preload/index.js`；dev 走 `process.env.ELECTRON_RENDERER_URL`，prod 走 `loadFile('../renderer/index.html')`。
- **IPC**：`window:minimize` / `window:toggle-maximize` / `window:close`（`on`），`app:copy-text`（`handle`），最大化状态经 `window:maximized-change` 回推；旧数据处置为 `legacy:status` / `legacy:resolve`（都是 `handle`，**没有主 → 渲染的推送**）。

### 4.2 `hfEnv.ts` —— 环境探测与资源定位（+ GSAP 本地化 / 导出外部化）

- 汇总 `BUILTIN_RESOURCES`：各字段都是 **getter**，路径在首次访问时求值并**按包缓存**。分包后**不再有「一个包含所有资源的根」**——`resolvePackRoot('ffmpeg'|'hyperframes')` 的候选依次是：① 该包已解到 `<userData>/runtime/<包名>/`（目录内有 `ok.json` 才算完整）② 旧版整体包目录（`current.json` + `ok.json`，且两包资源齐备）③ `process.resourcesPath`（打包）或 `path.join(app.getAppPath(), 'resources')`（开发态）。`refreshPack(name, root?)` 按包失效缓存，`refreshBuiltinResources(root?)`（兼容旧调用）与 `packReady(name)` 一并保留。
- `chrome-headless-shell` 的缓存语义是**特例**：`findChromeShell()` 开头只判「缓存里有值就返回」（`if (cachedChrome) return cachedChrome;`），**找不到时返回 `null` 而不写缓存**；先前的 `if (cachedChrome !== undefined)` 会把「没有」也钉住——只要在运行环境包**解包完成之前**被问过一次（启动探测 / 渲染前的准备阶段都可能），此后即使包已落盘也永远拿不到路径（症状：渲染前量不到时间轴、`userData/video-duration.log` 里写 `chrome=无`）。修正后该解析结果被 `video.ts` 的**渲染本身与渲染前的时间轴量测共用**（同一个值写进 `env.PRODUCER_HEADLESS_SHELL_PATH`，量测再用它跑 `--headless --dump-dom`）。
- 定位函数均为**多候选回退**：
  - Node：`findNode()` **两级优先**——① Electron 内嵌 Node（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`，要求主版本 >= 22）→ ② 系统 Node（候选顺序 `NVM_SYMLINK` → `LOCALAPPDATA\nvm\nodejs` → `C:\Program Files\nodejs` → `where.exe` 兜底）。返回 `{ cmd, env }`，**`env` 必须合并进子进程环境再 spawn**；探针结果缓存于 `cachedNode`。
  - FFmpeg：遍历 WinGet 安装目录下的 `Gyan.FFmpeg*` → `*full_build*` → `bin\ffmpeg.exe`。
  - HyperFrames CLI：内置路径优先，其次环境变量 `HYPERFRAMES_CLI`。
- `isHyperframesComposition(raw)`：转视频前的合规校验。
- GSAP 本地化 / 导出外部化一组（`findLocalGsap()` / `hasGsapCdnRef()` / `referencesLocalGsap()` / `localizeGsapHtml()` / `externalizeGsapHtml()` / `copyGsapIntoProject()`）：定位随包 `vendor/gsap/gsap.min.js`，把 HTML 里的 GSAP CDN 引用改写为 `./gsap.min.js`，并按需幂等复制进项目目录；导出单文件时反向把 `./gsap.min.js` 换回固定版本 CDN（`GSAP_CDN_PINNED`）。`copyGsapIntoProject` 的返回值被 `projects.ts` 的作者态三处用作「复制失败即退回 CDN」的判据。

### 4.3 `settings.ts` —— 设置存储

- `userData/settings.json`，五分区：`customModel`、`voiceTTS`（旧）、`voiceProfiles`、`whisper`、`updater`，另有视频渲染默认档位 `render`（`quality` / `fps`）。
- 三个 `normalize*` 白名单函数各管一段：`normalizeRenderOptions()` / `pickRenderOverride()` / `normalizeUpdaterSettings()`。
- `isPristineSettings(file)`：判定指定 settings.json 是否还是「出厂状态」；唯一调用方是 `index.ts` 的 `migrateFrom()`。
- `readSettings()` 做**逐分区浅合并**并静默容错；写盘为整体覆盖。
- `settings:test` 的成功判定刻意严格：必须拿到模型返回的文本内容才算连接成功。
- **失败文案统一走 `shared/errors`**：`settings:test` 的失败分支调 `friendlyError(...)`；设置页刻意不弹配置类弹窗。
- **openai SDK 懒加载**：`loadOpenAI()` 首次真正发请求时才 `require`。
- API Key 明文保存在本机 `userData/settings.json`，不经 IPC 外传。

### 4.4 `systemVoices.ts` —— 系统音色表

- `SYSTEM_VOICES` 共 48 条，字段 `{ voice, desc, langs, series }`；`series` 取值组合覆盖 `instruct-flash` / `flash` / `tts`。
- 「是不是内置音色」的判定**不在本模块**：改由 `voiceCatalog.providerOfSystemVoice()` 精确全等匹配。
- 与 `voice.ts` 四处配合：默认模型由 `voiceCatalog.seriesDefaultModel` 按 series 推导、`voice:list-system-voices` 输出附带 `model` 与 `provider`、`voice:list-all` 生成 `key = 'system:' + voice` 条目，以及渲染层音色管理的回退组装。

### 4.5 `agent/` —— Agent 层（目录，5 文件）

一个模块、五个文件：**一个传输层 + 两个业务薄封装 + 一份对话记录读写 + 一个统一出口**，形态是「同名目录 + `index.ts`」（与 `updater/` 同一套约定）。**`chat.ts` 不认识任何业务**；`chatLog.ts` 不认识业务、也不认项目名（只收一个文件路径）；`html.ts` 与 `script.ts` 各自只保留「业务专属」的东西（提示词、完成判定、结果提取 / 解析、日志路径与错误文案）；`index.ts` 只做再导出（**不含 `chatLog`**）。目录级说明见 [files/main/agent.md](./files/main/agent.md)。

| 文件 | 行数 | 一句话 |
|------|------|--------|
| `chat.ts` | 261 | 通用对话层：多轮 `messages` + 流式（SDK / fetch SSE）+ `max_tokens` 升档重试 + jsonl 过程记录 + 人话错误 |
| `chatLog.ts` | 155 | 对话记录读写：`<项目目录>/chat/index.json`（索引，不含 scenes）+ `versions/<id>.json`（每版副本），`MAX_CHAT_ROUNDS = 100`、写索引后清理孤儿副本、清空删整个 `chat/`（**内部模块，不挂 `index.ts`**） |
| `html.ts` | 89 | HTML 薄封装：`HTML_AGENT_SYSTEM` + `extractHtmlFromReply` + `chatWithCustomModel`（重构前 275 行，导出名与签名未变） |
| `script.ts` | 329 | 内容脚本：`SCRIPT_AGENT_SYSTEM` + `buildScriptPrompt` + `parseScriptReply` + **`registerScript(getProjectDir)`**（域 `script:*` 七条） |
| `index.ts` | 15 | 统一出口：只再导出（9 个值 + 4 个类型），不写逻辑 |

依赖单向：`chat` 在最上游（不 import 同目录任何模块），`html` / `script` 只从 `./chat` 取 `chatWithModel`，`script` 另从 `./chatLog` 取 8 个读写 / 清理函数，`index.ts` 聚合三者。

#### 4.5.1 `chat.ts` —— 传输层

- 导出 `chatWithModel(messages, opts)`、`ChatMessage`、`AgentChatOptions`、`MAX_TOKEN_TRIES = [32768, 65536]`。
- `AgentChatOptions` 的 8 个字段各有唯一职责：`label`（错误前缀）/ `noun`（失败文案名词）/ `logFile`（相对 `userData` 的记录路径）/ `isComplete?`（**只在 `finish_reason === 'length'` 时**判「其实是否完整」）/ `truncatedHint?`（截断建议）/ `meta?`（只进记录）/ `maxTokenTries?` / `onProgress?`。
- 两条等价路径：`loadOpenAI()` 可用时走 SDK（`stream: true` + `stream_options: { include_usage: true }`），否则 `fetch ${baseUrl}/chat/completions` 手写 SSE 解析；两条路径的 chunk 处理完全同构。
- 升档判定只三种情形：本档抛错 → **直接抛**（不换档）；`finish_reason === 'length'` 且内容不完整（或内容为空）→ `retry` 换档；内容非空且完整 → `done` 返回。
- 最终失败文案三种模板（截断 / `length` 但无正文 / 空响应），都带 `（usage: …）` 诊断；日志写 `userData/<logFile>`，一行一次调用，`attempts` 里存每档的思考全文、输出、`finish_reason`、`usage`、`detail`、`needConfig` 与四个耗时。
- **不注册 IPC、不碰项目文件、不拼提示词、不决定日志路径**——这四条边界就是它的规格（详见 [files/main/agent.md](./files/main/agent.md) §5.1）。

#### 4.5.2 `html.ts` —— HTML 薄封装

- 只剩三样东西：`HTML_AGENT_SYSTEM`（**5 条**硬性要求：完整 HTML 文档 / HyperFrames 规范（`data-composition-id`、`./gsap.min.js`、`gsap.timeline({ paused: true })`、以 composition id 为键的 `__timelines`、按【画布】写死 `data-resolution` 与固定 px 舞台 + **「渲染技术」三条子项（本轮新增，仍挂在第 2 条下、总条数仍是 5）**：画面默认 DOM/CSS + GSAP、确需逐帧才 2D 用 Canvas 2D / 3D 用 three.js（唯一允许走 CDN 的依赖，r170 + importmap，GSAP 仍必须本地 `./gsap.min.js`）、逐帧绘制必须挂 GSAP 时间轴 `onUpdate` 且 `draw(t)` 只由 `t` 决定、canvas 与 three.js 的渲染尺寸按【画布】写死像素）/ 字幕逐条依次入场 / 字幕严格按起止时间 / 只输出 HTML 源码。**刻意不含视觉风格**——原第 3 条「深空科技 / Cyber UI」属硬性要求、会把用户填的「全局视觉风格」压掉，已删除；风格改由 `projects.ts` 的 `buildStyleBlock()` 从用户消息里的【全局视觉风格】块注入）、`extractHtmlFromReply()`、`chatWithCustomModel()`；另有私有 `isCompleteHtml()`（`/<\/(body|html)\s*>\s*$/i`）。
- 包装时写死业务参数：`label: '生成 HTML'` / `noun: 'HTML'` / `logFile: 'html-agent/chat.jsonl'` / `truncatedHint: '请精简字幕/素材或更换模型'`；`meta` / `maxTokenTries` / `onProgress` 由 `AgentOpts` 原样透传。
- 导出名与签名**完全不变**：`HTML_AGENT_SYSTEM` / `extractHtmlFromReply` / `chatWithCustomModel` / `type AgentProgress` / `interface AgentOpts`；因此 `src/main/projects.ts` 只改了 import 的来源（`import { chatWithCustomModel, extractHtmlFromReply, type AgentProgress } from './agent'`），三个名字与调用点一字未动。
- 行为等价点（重构验收线）：完成判定正则未改、日志文件仍是 `userData/html-agent/chat.jsonl`、错误文案逐字未改；系统提示词在「收进目录」那轮**逐字未改**，**later 的删风格条款、【禁止无限循环】提示词块与「渲染技术」三条子项都是之后各自独立的一次修改**（第二项不在本文件，在 `projects.ts` 的 `buildMaterialPrompt()` 里）。

#### 4.5.3 `script.ts` —— 内容脚本 Agent（域 `script:*`）

- 频道：`script:generate` / `script:load-chat` / `script:append-round` / `script:read-version` / `script:set-active-version` / `script:clear-chat`（**六条 `ipcMain.handle`**）+ 推送 `script:progress`；入口函数 **`registerScript(getProjectDir: (name: string) => string)`**（原名 `register`，收进目录时改名并加参）。
- **项目目录靠注入**：`registerScript(getProjectDir)` 把参数存进模块级 `projectDirOf`（默认 `() => ''` 兜底），私有 `projectDir(name)` = `projectDirOf(name)`，路径规则全在 `chatLog.ts`。`src/main/index.ts` 传的是 `projects.projectDir`——**agent 不反向 import `projects`**，否则与 `projects → agent` 成环。
- 生成流程：校验 `request` 非空 → 整理上下文场景（只收对象、`slice(0, MAX_SCENES=30)`、四字段归一化）→ `buildScriptPrompt()`（【要求】/【当前脚本】/【参数】三段；`targetSeconds × 4.5` 折成字数预算）→ `chatWithModel()`（`label '生成脚本'` / `noun '脚本'` / `logFile 'script-agent/chat.jsonl'` / `isComplete` 按结尾 `}` 粗判 / `meta.action = scenes.length ? 'modify' : 'generate'` / `onProgress` 经 `event.sender.send` 推 `script:progress`）→ `parseScriptReply()` → `{ ok: true, scenes, totalChars }`。
- 三个生成侧返回分支：成功；`Agent 调用失败：…`（`...configTargetOf(msg)` 补 `needConfig` / `title`）；`脚本解析失败：…` + `raw`（模型原文截 2 万字符）。
- **五个对话记录 handler**（`chat/index.json` 索引 + `chat/versions/<id>.json` 每版副本）：
  - `script:load-chat`（载荷 `{ name? }`，缺名回 `缺少项目名`）→ `readChatIndex(dir)` → `{ ok: true, rounds, activeVersionId }`（**不含 scenes**；索引不存在 / 损坏 / 副本已丢的条目都被剔除）。
  - `script:append-round`（载荷 `ScriptAppendRoundPayload`）→ `normalizeScenes(payload.scenes)`，无场景回「这一轮没有场景，未写入对话记录」；否则 **`writeVersion()` 先写副本 → `readChatIndex()` → `writeChatIndex({ rounds: [...旧, 本轮元数据], activeVersionId: 新版本 })`**（顺序不能反：写索引会顺带清理不再被引用的旧副本）→ `{ ok: true, versionId }`。
  - `script:read-version`（载荷 `{ name?, versionId? }`，`isValidVersionId` 不过回 `非法的版本 id`）→ `readVersion()`，读不到回「这一版脚本读不到了（副本可能已被删除）」；**只读、无副作用**。
  - `script:set-active-version`：要求该 `versionId` 在 `index.rounds` 里（否则「这一版不在对话记录里」），再 `writeChatIndex({ rounds, activeVersionId })`；**不写 `content.json`**。
  - `script:clear-chat`：`clearChat(dir)` 删整个 `chat/` 目录。
- `parseScriptReply` 的容错：去 ` ```json ` 围栏 → 依次试「首个 `{` 到末个 `}`」「首个 `[` 到末个 `]`」「原文」三种切法，取第一个能 `JSON.parse` 且形状可用的（带 `scenes` 数组或本身是数组）；**旁白允许为空**（静音段），只丢旁白与画面分镜**都空**的场景、`durHint` 有就保留、场景截到 30、一条有效场景都没有则抛错（文案「模型返回的脚本里没有有效场景（旁白与画面分镜都为空）」）。
- **定位：不碰文件系统**——**连 `node:fs` / `node:path` 都不 import**、没有文件工具与 shell；上下文来自载荷（渲染层编辑器当前 `scenes`），场景落盘走 `project:save-content`（由渲染层的自动保存触发），对话记录的文件操作全在 `chatLog.ts`。

#### 4.5.4 `chatLog.ts` —— 对话记录读写（内部模块）

- **磁盘布局**：`projects/<项目名>/chat/index.json`（索引：每轮元数据 + `activeVersionId`，**不含 scenes**）+ `projects/<项目名>/chat/versions/<id>.json`（该轮脚本的完整副本，展开 / 应用时才读）。
- **十一个导出**：`MAX_CHAT_ROUNDS = 100`、`chatDirOf(projectDir)`（`<项目目录>/chat`；**收项目目录而不是项目名**，目录规则只由 `projects.projectDir` 一处给）、`chatIndexPathOf(projectDir)`、`isValidVersionId(versionId)`（白名单 `^[A-Za-z0-9_-]{1,64}$`，挡路径穿越）、`newVersionId()`、`normalizeScenes(raw)`、`readChatIndex(projectDir)`、`writeChatIndex(projectDir, index)`、`writeVersion(projectDir, versionId, scenes)`、`readVersion(projectDir, versionId)`、`clearChat(projectDir)`；私有 `MAX_SCENES = 30` / `VERSION_ID_RE` / `versionsDirOf` / `versionPathOf` / `normalizeRoundMeta` / `pruneVersions`。
- **规范化口径**：索引只存 `{ id, request, versionId, totalChars, sceneCount, ts }`；`versionId` 非法 ⇒ 整条丢弃；`totalChars` / `sceneCount` 为负数 / 非数时归 0、`ts` 非法则补当前时间。场景只留四字段、补 `id`、截到 30。
- **读索引**：文件不存在 / `JSON.parse` 失败 ⇒ 空索引；**丢掉「版本副本已不存在」的条目**；`activeVersionId` 不在活着的轮次里则清成 `''`；最后 `slice(-MAX_CHAT_ROUNDS)`。
- **写索引**：`mkdirSync` 后写 `{ version: 1, updatedAt, activeVersionId, rounds }`，随后 `pruneVersions()` **删掉 `versions/` 下不再被索引引用（含超出 100 轮被裁掉）的文件**——磁盘因此不会无限增长。
- **单版副本**：`writeVersion` 写 `{ versionId, createdAt, scenes }` 并返回规范化后的场景（非法 id / 无场景直接抛错）；`readVersion` 不存在 / 损坏 / id 非法 ⇒ `null`；`clearChat` 用 `fs.rmSync(chatDirOf(dir), { recursive: true, force: true })` 删整个目录。
- 依赖只有 `node:fs` / `node:path` / `../../shared/types` 的 `Scene`、`ScriptChatIndex`、`ScriptChatRoundMeta`；**不注册 IPC、不 import 同目录任何模块、不由 `index.ts` 再导出**。

#### 4.5.5 `index.ts` —— 统一出口

- 15 行、**只有 `export … from` 语句**：`chatWithModel` / `MAX_TOKEN_TRIES` / `HTML_AGENT_SYSTEM` / `extractHtmlFromReply` / `chatWithCustomModel` / `SCRIPT_AGENT_SYSTEM` / `buildScriptPrompt` / `parseScriptReply` / `registerScript`（9 个值）+ `ChatMessage` / `AgentChatOptions` / `AgentOpts` / `AgentProgress`（4 个类型）。
- 文件头注释记录四个子文件的一句话分工与依赖方向（`chat` 在最上游，`html` / `script` 只依赖它）；**不写任何逻辑、不注册 IPC、不 import 目录外模块**。`chatLog.ts` **不在**这份清单里——它是 `script.ts` 的内部依赖，不是 Agent 层的对外能力。

### 4.6 `projects.ts` —— 项目化流水线（最大模块）

- 项目实体：`userData/projects/<项目名>/`。**索引与正文分文件（数据层重构后）**：`project.json` **只有索引**（`ProjectIndex`：`name` / `title` / `subtitleCount` / `htmlPath` / **`videoPath`（本项目内相对路径 `video/output.mp4`）** / `audioFile` / **`materials`** / `render` / **`canvas`** / `createdAt` / `updatedAt`，**不含 `subtitle` / `content` 正文**）；字幕正文在 `subtitle.txt`（唯一正文）、内容脚本正文在 `content.json`（`{ style, scenes }`，唯一正文）。同目录旁挂 `index.html`、`index.preview.html`、`gsap.min.js`（按需从随包文件复制）、`audio/`、**`images/`**、**`video/`**（`video/output.mp4` 是转视频的产出成品，`video/xxx.mp4` 是素材库里的输入素材——同目录、不同语义）。
  - **读写分层**：`readProject()` 只读索引并返回 `ProjectIndex`；`ensureProject()` 把索引 + `subtitle.txt`（内联旧字段优先、文件兜底）+ `content.json`（文件优先、内联兜底）拼成完整 `Project`，因此 `project:load` 的对外结构不变（渲染层 0 行改动）；`writeProject()` **先把正文落盘（`subtitle.txt` 内容不同才写、`content.json` 文件不存在才写）再只写索引**并把 `subtitle` / `content` 两个字段剥掉；`project:save-content` 改为写 `content.json`；`scanProjects()` 的 `hasSubtitle` 改由「`subtitleCount > 0` 或 内联旧 `subtitle` 非空 或 `subtitle.txt` 存在」三路判定。老项目**免批量迁移**：读时兼容，下一次任意 `writeProject` 自动把正文落到文件（见 [projects.ts.md](./files/main/projects.ts.md) §2.7 / §3.9）。
  - **`materials` 是项目素材库**（图片 + 视频，多素材）：每条 `ProjectMaterial` = `{ id, kind, file, label, selected, addedAt }`，`file` 是**项目内相对引用**（`images/xxx` / `video/xxx`），`kind` 决定落在哪个目录；`project.json` 只登记相对引用，因此项目目录可以整体搬走 / 复制。
  - **`videoMaterial` 是历史字段**（单视频素材时代的相对引用）：本轮起**不再写入**、素材列表也不读它；保留声明只为不改动已隐藏入口的 `project:extract-video-audio` handler（它仍按此字段定位视频）。`ensureProject()` 的初始对象里加的是 `materials: []`。
  - **`audioFile` 同样是项目内相对引用**（`copyAudioIntoProject()` 复制进 `audio/` 后返回 `'audio/' + saveName`），`set-audio` / `clear-audio` / 回执里的 `audioFile` 都是这个相对值——渲染层据此拼 `hgpreview://p/…` 试听。
- **项目根路径是函数**：`projectsRoot()` 返回 `path.join(app.getPath('userData'), 'projects')`，**每次调用重新求值**。内部三个调用点：`projectDir()`、`scanProjects()`、`project:delete` 的 `dir.startsWith(projectsRoot())` 校验。
- 对外能力（25 个 `handle` + 1 个推送；素材库那次 **3 换 3**、总数不变，本次再净增 `project:set-canvas`）：项目 list / create / load / delete、字幕保存、内容脚本保存、HTML 生成 / 修改 / 读取 / 保存 / 预览 / 下载、SRT 导出、项目目录与指定路径所在目录打开、**项目素材库三件套**（`project:pick-media` 选文件 / `project:add-materials` 复制入库 + 登记 / `project:save-materials` 整份列表回写，其中后两者分别是「复制入库 + 登记」与「移除 + 勾选共用」）、音频的挑选 / 设置 / 清除、从视频提取音轨（**handler 保留、界面入口本轮临时下线**）、视频产物回写、渲染档位覆盖、**成片画布覆盖（`project:set-canvas`：值变化时把 `videoPath` 置空——尺寸变了旧成片不再代表当前产物）**。其中 `set-audio` / `clear-audio` / `extract-video-audio` 会同步改写 HTML 里的注入音轨并回带 `htmlUpdated`。
  - **本轮下线的三个频道**：`project:pick-video` / `project:set-video` / `project:clear-video`（连同 `shared/ipc.ts` 的常量与 preload 的方法一起三处齐删；旧的单视频素材下拉行被 `MaterialsSection.vue` 的卡片墙取代）。
- 关键内部设施：`projectDir()`（路径派生的唯一入口，也被 `hgpreview` 协议使用）、`parseSubtitle()`、`normalizeContent()`、**`resolveVideoAbs(name, videoPath)`（成品路径「落盘相对 / 交出绝对」的唯一解析入口，见 [projects.ts.md](./files/main/projects.ts.md) §3.8）**、`scanProjects()`（列表与 `has*` 标记；`hasVideo = !!resolveVideoAbs(p.name, p.videoPath)`，取代原先依赖路径形态的 `fs.existsSync`）、`buildContentBlock()`（内容脚本块，**有效场景 = 画面分镜非空**，无有效场景返回 `''`，**不含风格**）/ **`buildStyleBlock()`**（【全局视觉风格】块，判断 `content.style` 后**无条件注入**：风格原先只是内容脚本块里的一行，那块没有有效场景就 `return ''`，用户填的风格因此进不了提示词）/ `buildMaterialPrompt()` / **`buildCanvasBlock(proj, forModify = false)`**（生成/修改的【画布】块：**插在【音轨】与【成片时长】之间**，写明画布尺寸并要求模型写死 `data-resolution`、主舞台固定 px、不要 vw / vh / 百分比 / `transform: scale`、内容排满整块画布；**`forModify === true`（只由 `project:modify-html` 传）时追加第 ⑤ 条**——旧页面的 `data-resolution` / 主舞台尺寸与新画布不一致时必须按新画布重排，禁止用 scale / 居中留白 / 黑边硬套旧版式）/ **`buildMaterialPrompt()` 里紧跟在【成片时长】之后的【禁止无限循环】块**（`tl.to` / `tl.fromTo` / `gsap.to` 一律不许 `repeat: -1`、不许 `repeat: Infinity`；呼吸 / 闪烁 / 流光 / 数字雨 / 扫描线一律用**有限次数**并按目标秒数算好，示例 `duration 1.1 + repeat 12 + repeatDelay 0.4`；生成与「按需求修改」共用这一份提示词）/ **`buildMaterialBlock()`**（拼装 Agent 提示词；素材块分「【图片素材】/【视频素材】」两段，给模型的是项目内相对路径）、**素材库助手**（`MATERIAL_DIR` = `{ image: 'images', video: 'video' }`、`newMaterialId()`、`materialKindOf()`、`copyMaterialIntoProject()`（取代原 `copyVideoIntoProject`）、`normalizeMaterials()`（读盘与写盘共用：校验 kind、`file` 必须在本项目素材目录下且不含 `..`、补 id、`selected` 缺省 true、条数截到 `MAX_MATERIALS`）、`materialExtsText()`）、**`resolveMaterials()`**（返回 `{ subtitleText, materials }`：字幕来源 + 按 `payload.materialIds` 过滤出的本次素材，顺序 = 渲染层列表顺序）、背景音轨注入一组（`BGM_TAG_ID` / `insertHtmlSnippet()` / `stripInjectedBgm()` / `stripAudioOfFile()` / `applyBgmToHtml()`，共 6 处调用点）、预览副本注入脚本 `HG_PREVIEW_CTRL`（**其 `clock()` 有两道时长可信度闸门**：超过页面自己声明的 `<html data-composition-duration>` 10 倍、或绝对超过 24 小时，就回 `{ time, dur: 0, unknown: true }`——不把 1e10 秒原样上屏，也不猜假时长；`report()` 的 `postMessage` 载荷因此多一个 `unknown` 字段）、`progressText()`。
- GSAP 本地化：生成 / 修改 / 保存（`project:save-html`）/ 预览副本四个写盘环节先 `hfEnv.localizeGsapHtml()` 改写 CDN 引用，再按需 `hfEnv.copyGsapIntoProject()`；**作者态三处会用复制返回值做兜底**——复制失败就把引用换回 CDN。反向地，`project:download-html` 用 `externalizeGsapHtml()` 把 `./gsap.min.js` 换回固定版本 CDN 后再文本写出。
- `project:extract-video-audio` 先按 `FFMPEG_PACKS = ['ffmpeg']` 调 `runtime.missingPacks()` **纯校验**：缺包立刻返回 `{ ok: false, needPacks, message }`（**不再** `await` 等待下载），校验通过后才用内置 ffmpeg 从**历史字段 `proj.videoMaterial`** 提取音轨。**该 handler 本轮一行未改**，但上方新增了注释说明「界面入口已临时注释下线、恢复前要按素材 id 重做」。
- `project:open-folder` 在项目目录不存在时返回「项目目录不存在（项目尚未保存）」。
- 写 HTML 成功后会把**失效的旧视频产物置空**，并做 HyperFrames 合规校验，返回 `compatible` 供 UI 提示。
- **Agent 调用失败的分类**：两处 `catch` 先拼 `'Agent 调用失败：' + message`，再用 `...configTargetOf(msg)` 展开补 `needConfig` / `title`。
- **预览副本不改渲染链路**：`unknown` 只是 `postMessage` 里的一个布尔字段（渲染层据此显示 `--:--`），**不新增 IPC 频道、不改 `previewHtml` 的回执结构**；渲染入口那侧的同类判据是 `video.ts` 的无限循环守卫（见 §4.9）。

### 4.7 `voice.ts` —— 语音服务（按厂家）

- 导出 `register()`，并向 `ttsAlign.ts` 暴露可复用的单句合成与解析能力。
- 音色克隆**只服务 Qwen-Audio-TTS 系列**：目标模型不匹配 `isAudioTtsModel` 时直接拒绝。音频分三类来源：本地绝对路径、公网 URL / `oss://`、`data:audio/...;base64` URI；本地文件先用内置 ffmpeg 裁成**前 15 秒 / 24 kHz / 单声道 `pcm_s16le` wav** 再转 data URI 放进 `input.url`。请求固定 `action=create_voice` + `model=voice-enrollment` + `target_model` / `prefix` / `url` / `language_hints` / `max_prompt_audio_length`，`input.prefix` 上限统一 **10** 字符；**成功回执只读 `output.voice_id`**（`VoiceCreateResult` 已收缩为 `{ voice, targetModel }`）。
- **云端克隆音色列表只有一个接口**（`action:'list_voice'`）；**删除云端音色同样只有一种写法**（`action:'delete_voice'`）。
- 音色解析三级优先：本地映射 `voiceProfiles` → 系统音色默认模型 → 内置默认模型。
- **项目根走 `projects.projectsRoot()` 函数**：三处调用点都在函数 / handler 内取一次局部 `const projectsRoot = projects.projectsRoot()`。
- 文字生音频 `voice:synth` 支持三种落盘位置（项目 `audio/`、自定义目录、音频输出目录）；`voice:list-generated` 按来源分组列出历史音频。
- **错误文案统一走 `shared/errors`**：`voiceFriendlyError(err, label)` 是 `friendlyError(...)` 的薄包装；未配置 Key 的四处失败改走新函数 `voiceNoKeyFail(msg)`（**未导出**），产出 `{ ok:false, message, needConfig:'voice' }`。

### 4.8 `ttsAlign.ts` —— 字幕配音与时间对齐

- 两种模式：
  - **模式 A（音频驱动）**：以每句实测时长重建时间线（音频不变速），停顿按「字幕原间隔 − 前句时长」推算，放不下才回落到 `gapSec`（默认 0.5，夹在 `[0,10]`）。
  - **模式 B（时间轴驱动）**：以字幕时间戳为槽位，先做单调化（相邻至少 `MIN_SLOT = 0.1s`），溢出时 `atempo` 加速（上限 `MAX_RATE = 1.15`）并重测时长，顶格仍放不下则顺延后续句子。
- 共同设施：逐句 TTS → 24 kHz 单声道 `pcm_s16le` WAV → `ffprobe` 量时长；`buildTrack()` 用静音补齐 + `concat -c copy` 零重编码装配整轨，末尾做 ±0.3s 时长终验。
- 进度经 `voice:align-progress` 回推，`voice:align-cancel` 可中断；旧任务目录按策略清理。
- **产物落在 `userData/voice/align-<时间戳>/`**（不是项目目录），回执里的 `audioPath` 是**绝对路径**；渲染层用 `ttsUrl()` 把它换算成 `hgpreview://tts/…?tts=1` 才可试听（见 §4.1 的语音产物路由）。

### 4.9 `video.ts` —— 转视频

- 频道：`dialog:open-html`（选 HTML 文件，**保留但渲染层当前无调用方**）、`video:show-in-folder`、`video:render`，以及推送 `video:progress`。模块规模 **457 行**，唯一导出 `register`。
- **渲染分两段，分界线是那个 `new Promise`**（Promise 的执行器是同步函数、不能 `await`，所以「准备阶段」刻意放在它外面）：
  - **准备阶段（`await` 代码）**：缺包纯校验 `runtime.missingPacks(RENDER_PACKS)`（`RENDER_PACKS = ['ffmpeg','hyperframes']`，缺包即回 `{ ok:false, needPacks, message }`，**不下载不阻塞**）→ 入口存在性 → `isHyperframesComposition()` 合规校验 → **无限循环静态守卫**（页面原文命中 `repeat: -1` / `repeat: Infinity` 即回 `{ ok: false, message }`，**此时还没建 `.render-tmp`、也没定位 CLI / Node**）→ `findHyperframesCli()` / `findNode()`（返回 `{ cmd, env }`）→ **就地确定渲染根 `projDir = path.dirname(htmlPath)`** 与 `tmpDir = <projDir>/.render-tmp`、`outMp4 = <projDir>/video/output.mp4`（先清残留再建目录）→ `hfEnv.localizeGsapHtml()` + 按需 `copyGsapIntoProject(projDir)` → 注入环境（`ffmpeg` bin 进 `PATH`，另设 `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` / `PRODUCER_HEADLESS_SHELL_PATH`）→ **取画布**（`payload.canvas` 白名单校验，非法 / 缺省落 `DEFAULT_CANVAS`，源码注释强调**绝不能「不传」**）→ **`prepareEntry()` 先写两处画布（舞台 `data-width`/`data-height` + `<html data-resolution>`）、再裁定成片时长并把时长写两处（`<html data-composition-duration>` 自描述 + 舞台 `data-duration` 生效）+ 裁超长媒体副本、最后写渲染入口** → `fs.writeFileSync(entryHtml, entry)`。
  - **渲染阶段（`new Promise` 内，同步代码）**：拼 `[hfCli, 'render', '-c', '.render-tmp/entry.html', '-o', outMp4]`（档位按白名单追加 `--quality` / `--fps`；**没有 `--resolution`**——那个参数只做 DPR 上采样，要求宽高比一致 + 整数倍，不能用来改画布比例）→ `spawn(nodeRt.cmd, renderArgs, { cwd: projDir, env })` → stdout/stderr 经 `video:progress` 实时回推 → `close` 时**先删掉整个 `.render-tmp/`**（无论成败），再按 `code === 0 && fs.existsSync(outMp4)` 判定成功并返回输出路径。
- **无限循环守卫（本轮新增，判据就一行正则）**：`if (/repeat\s*:\s*(?:-1|Infinity)\b/i.test(raw))` 命中即返回 `{ ok: false, message: '页面里有无限循环动画（GSAP 的 repeat: -1），成片时长没法确定，转视频会永远渲不完。请到「HTML生成」页让这些循环改成有限次数（例如 repeat: 12, repeatDelay: 0.4，次数按目标秒数算好）后再转视频。' }`。**为什么必须拦**：GSAP 把 `repeat:-1` 的 tween 时长当成 **1e10 秒**（不是 `Infinity`），父时间轴 `duration()` 就是「1e10 + 起点」，而成片时长取 `max(页面声明, 时间轴实测)`、应用写进舞台的 `data-duration` 压不过它 ⇒ CLI 会按 1e10 秒排帧、永远渲不完（实测预览总时长 `166666668:12`）。**边界**：只认 GSAP 的两种写法，**CSS 的 `animation-iteration-count: infinite` 不拦**（HF 的 CSS 适配器只收 `endTime` 有限的动画）；命中时不进 CLI、不写 `.render-tmp`、不改项目文件。详见 [video.ts.md](./files/main/video.ts.md) §1.3。
- **`prepareEntry()` 的时长裁定与写两处**（详见 [video.ts.md](./files/main/video.ts.md) §1.1 / §4）：裁定顺序 = ① 模型在 `<html data-composition-duration="…">` 里声明的（零成本，**应用就是从这一处读**）→ ② 现场用无头 Chromium 量 GSAP 时间轴（口径与预览脚本 `clock()` 一致，**不依赖字幕**）→ ③ 都拿不到就交给 CLI 按最长媒体裁定（旧行为，日志记一条）。**拿到 `target` 后写两处，但只有一处生效**：① `<html data-composition-duration>` —— 只为页面自描述（预览、`hyperframes info`、下次生成读它；**CLI 渲染不读**，且仅在页面原本没声明时才补）；② **舞台元素（第一个带 `data-composition-id` 的元素）的 `data-duration`** —— `applyStageDuration()` 写入（先剥掉该元素上已有的 `data-duration` / `data-composition-duration`，避免同名两个），**这是 CLI 编译阶段唯一读的地方**：0.8.33 的 `compileForRender`（cli.js 第 **126320** 行）取 `rootEl.getAttribute("data-duration") ?? rootEl.getAttribute("data-composition-duration") ?? 0`，该值为 0 时才向浏览器探时间轴（第 **127154–127166** 行）——所以「把时长写进 `<html>`」以前等于没写，成片长度实际由页面 GSAP 时间轴决定（历史现象：声明 120s、时间轴也恰好 120s，才看着像生效）。**口径变化（用户可见）**：声明现在真的生效——比时间轴长会把片子拉长到声明值、比时间轴短会按时长截断。另外 **`max(声明, 页面里最长媒体)` 仍成立**，所以拿到目标时长后还要用 `ffmpeg -hide_banner -loglevel error -y -i <原文件> -t <时长> -c copy <副本>` 把超长媒体**裁成副本**（落在 `.render-tmp/media/`，入口里 `src` 改写成 `./media/<文件名>`；**只裁副本、原件不动**）。裁定结果、裁剪明细、跳过原因，以及两条时长日志（`成片时长声明已写到舞台 data-duration = 120.00s（CLI 编译阶段只读这一处）` / `成片时长：页面里找不到带 data-composition-id 的舞台，只写了 <html data-composition-duration>（CLI 渲染不读它）`）都写进 `userData/video-duration.log`。
- **成片画布由应用注入，而且必须写在「舞台元素」上**：成片宽高由 HyperFrames CLI 0.8.33 的 producer 编译阶段决定——`compileForRender`（`resources/hyperframes/node_modules/hyperframes/dist/cli.js` 第 **126316–126319** 行）取文档里**第一个带 `data-composition-id` 的元素**（最外层舞台）的 `data-width` / `data-height`，读不到就分别兜底 **1080 / 1920**（竖屏）；而 `<html data-resolution>` 在渲染链路里**一次都不读**（`parseResolutionFromHtml()` 的唯一调用点是 `info` 命令）。因此 `video.ts` 写**两处**：① `applyCanvasSize()` 找第一个带 `data-composition-id` 的元素（与 CLI 的 `document.querySelector('[data-composition-id]')` 同口径；找舞台与改写开标签本轮抽成共用助手 `rewriteStageTag()`，时长的 `applyStageDuration()` 也走它），剥掉它已有的 `data-width` / `data-height` 后写入 `CANVAS_SIZES[canvas]` 的宽高，**找不到返回 `null`**（调用方就不替换）——这是成片宽高的真正来源；② `applyCanvasDeclaration()` 往 `<html>` 写 `data-resolution="landscape|portrait|square"`，只做页面自描述（预览 iframe 与 `hyperframes info` 读得到）。两处共用同一个通用助手 `stripAttrs(attrs, names)`（旧导出名 `stripDataResolution(attrs)` 本轮**改名并通用化为它**，`<html>` 与舞台共用），**逐属性扫描**剥掉同名旧值再写——只匹配「带值写法」会漏掉 HTML 合法的无值写法（如 `<html data-resolution>`），那会造成同名两个属性、而 **HTML 解析取第一个**（空值）⇒ 注入失效；把 `=` 与值写成可选又会误伤别的属性值里的同名文本。`applyCanvasDeclaration()` 另在整篇连 `<html>` 都没有时前置一个。白名单校验在 `video:render` 里做（`RENDER_CANVASES`，非法 / 缺省落 `DEFAULT_CANVAS` = `landscape`），`prepareEntry()` 拿到它后**第一步**就写这两处（量时间轴的副本与最终入口都带上它们），并往 `userData/video-duration.log` 留一行「成片画布 = …：已写入舞台 data-width/data-height 与 <html data-resolution>」；页面里找不到舞台时那一行明说「只写了 <html data-resolution>（CLI 将兜底 1080x1920 竖屏）」。详见 [video.ts.md](./files/main/video.ts.md) §1.2 / §4。
- **量时间轴用的 `'file:///'` 是唯一的例外，保留**：第 152 行 `const url = 'file:///' + probePath.replace(/\\/g, '/').replace(/ /g, '%20')` —— 它喂给 Chromium `--headless --dump-dom` 量 GSAP 时间轴，**不在渲染页面里、不受同源策略约束**，因此不属于「渲染层路径 → URL」那套收口（渲染层已全部改走 `hgpreview://`，见 §4.1）。
- **路径解析的坑（源码注释记录）**：入口在 `.render-tmp/` 里，但 HTML 里的 `video/x.mp4` 是**相对项目根**写的（CLI 也按项目根解析），所以裁媒体时必须 `path.resolve(projDir, src)`，按 `tmpDir` 解析会指向不存在的目录、把裁剪全跳过（声明就白写了）。
- 产物回写由渲染层经 `project:save-video` 完成（主进程 `video.ts` 不写 `project.json`）；该频道把项目目录内的绝对路径换算成**项目内相对路径** `video/output.mp4` 落盘（见 [projects.ts.md](./files/main/projects.ts.md) §3.8）。
- **`hf-projects/` 已下线**：就地渲染后 `userData/hf-projects/` 这条渲染临时工作目录**不再产生**（磁盘上残留的 244 MB 旧目录已删除），`index.ts` 迁移老数据的白名单 `OWN_DATA_ENTRIES` 里本来也没有它（注释里只作历史遗留提及）；现在渲染的中间产物只有项目内的 `.render-tmp/`，且渲完即删。

### 4.10 `whisper.ts` —— 本地转录与模型管理

- **内置模型档位 4 个**：`tiny-q8_0` / `ggml-tiny-q8_0.bin`、`base` / `ggml-base.bin`、`base-q5_1` / `ggml-base-q5_1.bin`、`small-q8_0` / `ggml-small-q8_0.bin`；下载走国内镜像 `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/`。
- 模型目录 `userData/whisper/models/`；CLI 路径由 `resolveCliPath()` 定位，**顺序**：`process.resourcesPath/whisper/whisper-cli.exe` → `BUILTIN_RESOURCES.root/whisper/…` → `app.getAppPath()/resources/whisper/…`。
- **`id ↔ 文件名` 严格对应**：只认登记名，不做前缀或模糊归属；枚举外的文件列为「未知模型」。
- 下载策略：边下边写 `.part`、进度节流回推 `whisper:progress`、完成后原子 `rename`、失败清理残片。
- 转录链路：`prepareAudio()` → VAD 起止静音裁剪 → `spawn whisper-cli.exe` → 解析 JSON 的 `transcription.segments` → `opencc-js` 繁转简 → 转成 `[分:秒] 文本`。**不直接写项目文件**，由渲染层弹窗后经 `project:save-subtitle` 落盘。
- 进度两阶段：先「正在加载模型」（不确定态进度条），解析到 `progress = N%` 后进入「转录中 N%」。

### 4.11 `updater/` —— 应用自更新（目录，4 文件）

- **文件分工**（依赖单向：`index.ts → install.ts → actions.ts → base.ts`）：`index.ts`（108 行）装配 `register(ctx)`、8 个 `update:*` 频道与两个定时器；`base.ts`（285 行）运行态单例、日志与小工具、**随包 `CHANGELOG.md` 的定位与读取**（`changelogPath()` / `readBundledChangelog()`）、`humanError()` / `setError()`、`payload()` / `send()`、`bindEvents()`、`ensureUpdater()`；`actions.ts`（139 行）动作；`install.ts`（134 行）安装与忙碌态。目录级一篇说明见 [files/main/updater.md](./files/main/updater.md)。
- **更新源三级优先**：`settings.json` 的 `updater.feedUrl` → 打包写入 `resources/app-update.yml` 的 `publish` 地址。
- **依赖加载是防御式的、并且是懒加载的**：`electron-updater` 用 `require()` 取 `autoUpdater`，整段包在 `try` 里并存下 `updaterLoadError`；缺依赖时所有 `update:*` 调用都返回 `{ ok: false, message, detail }`，**不会让主进程启动崩掉**。
- **下载 / 安装策略**：`autoDownload = false`、`autoInstallOnAppQuit = false`。
- **检查 / 下载「有事件才算成功」**：`checkNow()` 在报成功前判一次 `state.stage` 是否仍是 `checking`；`downloadUpdate()` 同类守卫。
- **安装前拒绝长任务**：`installNow()` 在 `busy` 时返回「当前有任务正在进行（转录 / 渲染 / 配音）」并拒绝重启。`busy` 由 `bindBusyTracking()` 监听 4 路进度通道（`whisper:progress` / `video:progress` / `voice:align-progress` / `project:html-progress`）自动推导。
- **与 `window-all-closed` 的配合**：`installNow()` 先置 `quitFlag`，入口据此直接 `return`（`updater.quitForUpdate()`）。
- **`stage` 刻意放宽为 `string`**，交出前由 `toStage()` 白名单收口成 `UpdateStage`。
- **错误文案分两层（`message` / `detail`）**：`humanError()` 返回 `{ message, detail }`；**判断顺序不可变**。
- **打开日志目录**：`update:open-log` 用 `shell.showItemInFolder()` 定位 `userData/updater.log`（没有日志则 `shell.openPath(userData)`），**刻意不进 `ensureUpdater()`**。
- **状态补齐（`update:status`）**：`ipcMain.handle(IPC.Update.Status, () => payload())`，紧跟 `update:version` 的 `ipcMain.on` 之后注册。
- **dev 环境**：未打包时需根目录提供 `dev-app-update.yml` 才会检查——`forceDevUpdateConfig` 由 `ensureUpdater()` 统一代为打开。

### 4.12 `runtime.ts` —— 运行环境包

- **动机**：NSIS 更新是「整体卸载旧版 → 解压复制新包」，分包后安装包只带**代码 + whisper（12.5 MB / 15 文件）**——安装包实测 **257.6 MB → 105.08 MB**；`ffmpeg`（179.9 MB / 9 文件）与 `hyperframes`（439.9 MB / 4892 文件）各成一个 7z（**实测 42.6 MB + 103.1 MB = 145.7 MB**），**首次用到时由用户确认后下载**（提示体积、可取消）。包与清单由 `scripts/pack-runtime.mjs` 产出为 `build/runtime-pack/<包名>.7z` + `<包名>.json`。
- **频道**：`runtime:status`、`runtime:prepare`（载荷 `packs?: RuntimePackName[]`，**必须是可结构化克隆的普通数组**）、`runtime:cancel`、推送 `runtime:progress`。
- **三个 API 的分工**：`packsStatus()` / `missingPacks(needs?)` / `packSizeText(names)` **纯探测不下载**，`ensurePacks(packs?)` 才下载 + 解包，`prepareInBackground()` **启动只探测**。
- **主流程 `runOnce(packs)`**：探测缺包 → 定位 `7za` → 逐包 `installOne()`（清单本地优先，否则从更新源取并 `Range` 续传 + sha512 复核）→ 解包 → **先写 `<包名>/ok.json` 再写 `packs.json`** → `hfEnv.refreshPack()` → `gc()`。
- **持久状态**：`userData/runtime/packs.json`；就绪判定要「有记录 + 目录内有 `ok.json` + 该包关键文件都在」三者齐备。
- **幂等与并发**：`ensurePacks()` 忙碌期重复调用返回 `{ ok:false, message:'正在准备另一个运行环境包，请稍候再试' }`。
- **取消语义**：`cancelPrepare()` → flag + `abort()` + `kill()` ⇒ `cleanupHalfDone()` ⇒ phase 落 `cancelled`（**不是失败**）。**超时不算取消**：取清单 20 秒无响应走 `MANIFEST_TIMEOUT` 分支，`.part` 保留续传。
- **失败不阻断应用**：任何一步失败都走 `fail()`——只更新状态、推一次进度、写 `userData/runtime.log`，并返回 `{ ok: false, … }`。

### 4.13 `vad.ts` —— 纯函数 VAD

- `readWavSamples()`：解析 16 bit PCM WAV，无法识别时返回 `null`。
- `vadTrimSegments(samples, rate, segs)`：基于 20 ms 窗口的噪声底分位与阈值（`thr = max(noiseFloor*3, 200)`）做前后静音裁剪。
- 之所以拆成独立文件：**零依赖、纯函数、只用类型标注**。

---

## 5. 目录内的通用实现约定

1. **spawn 样板统一**：`child_process.spawn` + `windowsHide: true` + Promise 包装，参数以数组传递、不经 shell。
2. **外部依赖只从「安装包资源 + 运行环境包」取**：`whisper-cli.exe` 与 `7za.exe` 来自安装包，ffmpeg / hyperframes 来自运行环境包解出的 `<userData>/runtime/<包名>/`。
3. **返回约定**：业务接口统一 `{ ok: true, ... }` / `{ ok: false, message, canceled? }`；查询类可返回数组或 `null`（`project:pick-media` 返回裸字符串数组，取消时为空数组）。
4. **进度回推节流**：下载与转录的高频进度按时间/百分比节流后再 `webContents.send`。
5. **路径安全**：所有项目内路径由 `projectDir()` 派生并做前缀校验；**素材的 `file` 另由 `normalizeMaterials()` 校验必须落在本项目素材目录下且不含 `..`**；临时产物用后清理。**`hgpreview` 的语音产物路由（`?tts=1`）同理**：顶层目录必须落在 `TTS_PREVIEW_DIRS` 白名单内，否则 403。
6. **userData 位置保持 Electron 默认**：`USER_DATA_DIR = app.getPath('userData')` = `%APPDATA%\<package.json 的 name>`，**没有 `setPath`、没有位置钉死**；老数据靠 `index.ts` 的「归属证明 + 用户确认式处置」处理。
7. **userData 路径一律惰性求值（纯保险）**：`projects.projectsRoot()` / `whisper.modelsDir()` / `runtime.runtimeDir()` / `settings.settingsFile()` 都写成函数 / getter——不要退化成常量，也不要在模块顶层 `const root = …()`。
8. **改 `package.json` 的 `name` 必须手动登记旧目录名**：`index.ts` 的 `LEGACY_DIR_NAMES`（现为 `['my-app']`）是**唯一**的发现机制。`TTS_PREVIEW_DIRS` 又是另一张手工清单——它与渲染层 `utils/url.ts` 的 `TTS_DIRS` 必须同步改（加一类可预览产物时两处齐改）。
9. **持久化边界**：只有 `settings.ts` 与 `projects.ts` 直接写项目 / 用户配置；其余模块通过它们落盘；`runtime.ts` 是例外——它只写自己的 `userData/runtime/**`；**`agent/chatLog.ts` 也只写自己那份 `projects/<项目名>/chat/`**（对话记录的索引 + 每版副本，不进 `project.json`、不参与 `scanProjects`）。
10. **载荷 / 结果类型全部来自 `src/shared/types.ts`**：`src/main/` 下已无本地声明的 payload / result / progress 接口，各 handler 的 `payload` 参数统一标注共享层的 `*Payload`（本轮新增 `ProjectPickMediaPayload` / `ProjectAddMaterialsPayload` / `ProjectSaveMaterialsPayload`）；项目结构类型（`Scene` / `ContentScript` / `Project` / `SubtitleLine`）由 `projects.ts` 再导出，**素材结构 `ProjectMaterial` / `ProjectMaterialKind` 也定义在共享层**。
11. **运行时依赖由 electron-builder 自动收集，不要手写 `node_modules` 白名单**：新增 `dependencies` 后仍要复核 `npm run pack && npx asar list …`。
12. **「无限循环」有两道各自独立的闸，别混为一谈**：渲染入口那道在 `video.ts`（命中 `repeat: -1` 直接拒绝渲染，返回人话 `message`）；预览那道在 `projects.ts` 的 `HG_PREVIEW_CTRL.clock()`（时长超过页面声明 10 倍或 24 小时就回 `unknown: true`，界面显示 `--:--`）。**两者互不依赖**：不渲染也能预览、预览能看也不代表能转视频。提示词侧（`buildMaterialPrompt()` 的【禁止无限循环】）是上游预防，三道加起来才是完整闭环。

---

## 6. 相关文档

- 逐文件说明：[files/main/](./files/main/)
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- IPC 契约全貌：[01-架构总览.md](./01-架构总览.md) 第 3 节
