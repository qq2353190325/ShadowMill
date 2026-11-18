# 02 · 目录架构：`src/main/`（主进程）

> 主进程是整个应用的能力中心：窗口与生命周期、运行环境（**分包**：ffmpeg / hyperframes 各自一个 7z、首次用到时下载，whisper 随安装包）的准备与解包、userData 历史数据目录的扫描与**用户确认式处置**（`legacy:*` 两个频道 + 渲染层应用内弹窗）、文件系统、外部程序调用（whisper / ffmpeg / HyperFrames）、全部网络请求（Qwen-TTS / 自定义模型 / 模型下载 / 运行环境包 / **账号后端**）以及 **111** 个 IPC 频道的实现，全部集中在这个目录。

---

## 0. 本次同步范围与已知漂移

本页这一次只同步**账号（可选登录）**带来的变化：新增 `src/main/account/`（3 个文件、393 行）、第 13 个频道分组 `Account`（5 条）、注册顺序与依赖图里多一条 `account ← index.ts`，并新增 §4.15。

> **⚠ 其余条目仍可能落后于当前源码**（本页只对「总数口径依赖到的」几处做了实测修正）：
> - `agent/` 已按实测改成 **8 个文件**（另有 `constants.ts` 368 行，提示词常量从 `html.ts` 拆出）：`chat.ts` 265 / `chatLog.ts` 155 / `html.ts` **229** / `constants.ts` 368 / `htmlEdit.ts` 52 / `script.ts` **342** / `castAction.ts` **44** / `index.ts` 21——§1、§4.4 与附录用的是这一组新数字。
> - `src/main/index.ts` 实测 **551** 行（含账号注册段），§1 表已按实测值写。
> - `projects/`（16 文件）、`cast/`（9 文件）、`voice/`（10 文件）与 `hfEnv.ts` / `settings.ts` / `video.ts` / `whisper.ts` / `runtime.ts` 的逐文件行数**未逐一复核**（总数与文件数已实测），需要时以 `[IO.File]::ReadAllLines($f).Count` 现测为准。
> - 计数口径不受影响：`src/main` 下 `.ts` 文件实测 **59 个** = 根目录 9 + `account/` 3 + `cast/` 9 + `voice/` 10 + `projects/` 16 + `agent/` 8 + `updater/` 4（旧记 55 = 少了 account 3 + `agent/constants.ts` 1）。

---

## 1. 文件清单

| 文件 | 行数 | 角色 | 注册的 IPC 域 |
|---|---|---|---|
| [index.ts](./files/main/index.ts.md) | 551 | **入口装配器**：历史数据目录的归属证明（`isOurs` / `hasOurIdentity`，`.shadowmill-data` 按内容认）与**用户确认式处置**（`legacyInfo()` 扫一次即缓存 → `legacy:status` 交给渲染层；`resolveLegacy()` 执行 `migrate` / `delete` / `later`）、生命周期、窗口（含主题底色 `backgroundColor`）、`hgpreview://` 协议（**两条路由**：`p/<项目名>/…` 项目内文件、`user/<相对路径>?user=1` 项目外语音产物且只读白名单 `USER_PREVIEW_DIRS = ['tts-output','voice','cast-preview']`；路径解析抽成 `resolveHgPreviewPath(rawUrl)`；`rangeResponse()` 支持 `Range` 字节范围取 → `206` / `416`，响应体走文件流）、窗口控制与剪贴板 IPC、各域 `register()` 顺序（**含 `agent.registerScript(projects.projectDir)`**——把项目目录解析函数注入给 agent；**含 `account.register(ctx)`**——5 条账号频道，排在 `settings` 之后、`projects` 之前）、启动时序打点 `startup.log` | `window:*`、`app:copy-text`、`legacy:*` |
| [hfEnv.ts](./files/main/hfEnv.ts.md) | 398 | 环境探测与**按包解析**的内置资源定位（`resolvePackRoot()` / `refreshPack()` / `packReady()`，`root` 只作旧布局与 dev 的兜底）+ 随包前端库本地化（GSAP / p5 / p5.brush，`VENDOR_LIBS` 一张表驱动）/ 导出外部化 / 渲染入口抬级（不注册 IPC）；`findChromeShell()` **只缓存「找到的」结果**（找不到返回 `null` 但不写缓存，避免「解包完成前被问过一次」把 `chrome=无` 永久钉住）；`coreSource()`：`vendor/shadowmill/core.js` 的真源定位（与 `vendorSource()` 同一套两级路径），**不进 `VENDOR_LIBS`**（自家文件、没有 CDN 形态，导出时内联） | — |
| [settings.ts](./files/main/settings.ts.md) | 469 | 设置存储（`userData/settings.json`，含 `customModel`（**含 `reasoningEffort` 思考强度，默认 `high`，`settings:save` 与 `readSettings` 共用 `normalizeCustomModel` 白名单**）、`voice` 按厂家配置（**只有 apiKey**）与视频渲染默认档位）+ OpenAI SDK 懒加载入口 `loadOpenAI` + 「出厂状态」判定 `isPristineSettings`（供 index.ts 的 `migrateFrom()` 迁移老数据时决定能否覆盖 settings.json）+ 运行环境「从本地文件安装…」`settings:pick-runtime-pack`（选 `ffmpeg.7z` / `hyperframes.7z` 导入 `userData/runtime/local-import/`） | `settings:*`（6） |
| [**account/**](./files/main/account.md)（**目录级一篇，3 个文件**：`api.ts` **221** / `store.ts` **96** / `index.ts` **76**，**合计 393 行 / 最长 221 行**） | 221 / 96 / 76 | **账号（可选登录）**（同名目录 + `index.ts` 出口，依赖单向 `index → api / store`）：`api.ts` 账号后端 HTTP 客户端（`apiBaseUrl()` 读 `SHADOWMILL_API_BASE`、缺省 `http://127.0.0.1:8080`；`fail()`；`sendCode()` / `register()` / `login()` / `me()` / `logout()`；内部 `FALLBACK_MESSAGE` 14 条错误码文案、`SERVER_CODE_MAP` 7 条业务码直通、`request()` = `fetch` + `AbortSignal.timeout(10_000)` + `X-Device-Name` 头）；`store.ts` 令牌持久化（`safeStorage.encryptString` 写 `userData/account.bin`；safeStorage 不可用时**只存内存、不降级明文**；`load()` / `save()` / `clear()`）；`index.ts` 装配 5 条 `account:*` 频道 + `currentToken()` + `devCode` 仅未打包时透出 + `remember()` 落盘 + `currentSession()`（401 才清令牌）+ `logout()`（先撤销服务端再清本地）。**不 gate 任何本机功能；令牌不出主进程** | `account:*`（**5 handle**：`account:send-code` / `register` / `login` / `me` / `logout`） |
| [agent/](./files/main/agent.md)（**目录级一篇，8 个文件**：`chat.ts` 265 / `chatLog.ts` 155 / `html.ts` **229** / **`constants.ts` 368** / `htmlEdit.ts` 52 / `script.ts` **342** / `castAction.ts` **44** / `index.ts` 21；逐文件行数见 §0） | 265 / 155 / 229 / 368 / 52 / 342 / 44 / 21 | **Agent 层**（同名目录 + `index.ts` 统一出口，依赖单向 `chat ← html / htmlEdit / castAction / script`、`html ← htmlEdit / castAction`、`script → chatLog`）：`chat.ts` 是**通用对话层**——多轮 `messages` + 流式（`openai` SDK / `fetch` 手写 SSE 两条等价路径，**两条都带 `reasoning_effort: m.reasoningEffort`**）+ `max_tokens` 升档重试（`MAX_TOKEN_TRIES = [131072, 262144]`）+ 全过程记录追加 `userData/<logFile>` 的 jsonl + 人话错误 + 300ms 节流进度，**不认识任何业务、不读写项目文件**；`chatLog.ts` 是**对话记录的磁盘读写**（`MAX_CHAT_ROUNDS = 100` / `chat/index.json` + `versions/<id>.json` / `readChatIndex` / `writeChatIndex`（写后清理不再被引用的副本）/ `writeVersion` / `readVersion` / `clearChat`，只依赖 `node:fs` / `node:path` / 类型，**不由 `index.ts` 再导出**）；`html.ts` 是 HTML 薄封装（`HTML_AGENT_SYSTEM` + `extractHtmlFromReply` + `chatWithCustomModel` + 章节 / 角色 / 路由五份提示词与五个包装；**提示词常量本体已拆到 `constants.ts`**，见 §0）；`script.ts` 是内容脚本 Agent（`SCRIPT_AGENT_SYSTEM` + `buildScriptPrompt` + `parseScriptReply` + **`registerScript(getProjectDir)`**，不 import `node:fs` / `node:path`、不反向 import projects）；`index.ts` **只做再导出、不写逻辑**；`htmlEdit.ts` 是**单文件模式「按需求修改」的薄封装**（`HTML_AGENT_EDIT_SYSTEM` + `isCompleteHtmlEdit` + `chatWithHtmlEdit`）；**`constants.ts` 是 Agent 提示词常量表**（从 `html.ts` 拆出，避免单文件越过硬上限）。`projects/` 的 `ipc/html.ts` / `ipc/cast.ts` / `chaptersFlow.ts` / `htmlWrite.ts` / `progress.ts` 各自从 `./agent` 取所需的包装与类型 | `script:*`（**7**：6 handle + 1 推送） |
| [projects/](./files/main/projects.md)（**目录级一篇，16 个文件**，逐个见 §1.1） | 38 / 57 / 239 / 87 / 369 / 65 / 159 / 45 / 127 / 192 / 19 / 121 / 249 / 218 / 224 / **162（`ipc/castActions.ts`）**（**合计 2371**） | 项目化流水线（同名目录 + `index.ts` 统一出口）：项目索引 + 正文分层、项目素材库、HTML 生成（先规划再分支：单文件 / 逐章）与按需求修改（章节两段式路由 + 单文件角色源码）、背景音轨注入、随包库本地化 / 导出外部化、成片画布、全局角色库与**动作示范**、`core.js` 版本同步；`register.ts` 只装配**五个** `registerXxxIpc(ctx)` | `project:*`（**26 handle** + 1 推送）+ `cast:*`（11） |
| [chapters.ts](./files/main/chapters.ts.md) | 394 | 章节化长片的**纯逻辑**：解析模型回复（`<<<PLAN>>>` 规划块 / `<<<FILE …>>>` 文件块；块解析抽成通用 `parseFileBlocksWith`，与角色共用）、校验（章节 id `c01` 归一 / 场景不重不漏覆盖 / 单章 ≤180 秒 / 禁 `repeat: -1` / 必须登记 `window.__chapters`）、读写 `pages/` 下的章节文件（写时清孤儿、切回单文件清空 `pages/`）、装配骨架（舞台 / 画布 / **随包库按「章节 ∪ 角色」uses 引入** / **`./core.js` 固定插在 p5 之后、角色与章节之前** / **角色脚本「传谁引谁」** / 主时间轴 / `data-duration` = Σ 章时长 / 每章一个专属容器）、导出时内联章节**与角色、`core.js`**、大纲里标「［角色：…］」；**不 import `projects/`（避免循环依赖）、不调用模型、不注册 IPC** | — |
| [cast/](./files/main/cast.md)（**目录级一篇，9 个文件**） | 66 / 158 / 48 / 54 / 241 / 151 / 172 / 256 / 263（**合计 1409，最长 263**） | **角色**（同名目录 + `index.ts` 统一出口，依赖单向 `presets` 与 `table` 最上游、`actions → presets`、`library → actions`、`demo` 只依赖 shared 类型、`edit → table`、`inject` / `preview` 互不依赖——**对外 37 个具名导出**）：`table.ts` 角色表与角色文件 + `edit.ts` 改稿用的**只读**角色块 + `inject.ts` 单文件模式注入 + `library.ts` **全局角色库**（`readLibrary` / `syncProjectCast` / `removeFromLibrary`（**删角色连带清专属动作**）/ `nextAutoId`）+ `preview.ts` 角色静态预览页 + **`presets.ts` 内置 14 条公共动作** + **`actions.ts` 动作库**（存 `<userData>/cast-library/actions.json`）+ **`demo.ts` 会动的示范页**；`index.ts` **只再导出**；**不调模型、不 import `projects/`、不注册 IPC** | — |
| [editRoute.ts](./files/main/editRoute.ts.md) | 66 | **「按需求修改」第一段（路由）的纯逻辑**：`parseRouteReply(reply, allowed)` 从 `<<<ROUTE>>>` 块解析「要改哪几个文件」，白名单过滤（只认项目里真实存在的 `pages/cNN.js` / `cast/<id>.js`）、去重、≤6 个、`restructure` 允许空 targets、无 JSON 返回 error；**不调模型、不读文件、不注册 IPC** | — |
| [coreLib.ts](./files/main/coreLib.ts.md) | 71 | **共享绘制助手 `core.js` 的版本同步**：`CORE_FILE = 'core.js'` / `CORE_VERSION_FILE = '.core-version'` + `syncCoreTo(dir, srcPath)`（**按 `CORE_VERSION` 覆盖**，版本一致 + 文件在就什么都不做） + `readProjectCore(dir)`（导出内联用）；真源路径由调用方给（`hfEnv.coreSource()`）；**不 import electron、不读写业务数据、不注册 IPC** | — |
| [voice/](./files/main/voice.md)（**目录级一篇，10 个文件**） | 104 / 62 / 241 / 71 / 122 / 338 / 306 / 186 / 12 / 50（**合计 1492，最长 338**） | **语音域**（同名目录 + `index.ts` 统一出口，依赖单向：`catalog` / `api` 在上游、`ipc/*` 在下游）：厂家目录 + 48 条内置系统音色 + 接口层（`resolveVoiceModel` 三级解析 / `fetchClonedVoices` / `synthOne`）+ 克隆参考音频裁剪 + 能量 VAD + 字幕逐句对齐（模式 A/B）+ 两组 `voice:*` IPC；`register.ts` 只装配；**不调模型、不碰渲染层** | `voice:*`（**19 条**：17 handle + 1 on + 1 推送） |
| [video.ts](./files/main/video.ts.md) | 485 | HyperFrames 转视频，**就地渲染**：渲染根 = HTML 所在的项目目录，成品直写 `<项目目录>/video/output.mp4`；**渲染前先过一道无限循环静态守卫**（命中 `repeat: -1` / `repeat: Infinity` 就当场拒绝）；**渲染前按版本同步 `./core.js`**；**裁定成片时长**（声明 → 无头 Chromium 量时间轴 → CLI 兜底）并写进舞台 `data-duration`；按裁定值 `ffmpeg -c copy` 把超长媒体**裁成副本**；入口写 `.render-tmp/entry.html`（含舞台 `data-width`/`data-height` 与 `<html data-resolution>`）、渲完即删；音轨来自页面内的 `<audio id="myv-bgm">`；`video:render` 先按 `RENDER_PACKS = ['ffmpeg','hyperframes']` 校验，缺包即返回 `needPacks` | `dialog:open-html`、`video:*`（3 handle + 1 推送） |
| [whisper.ts](./files/main/whisper.ts.md) | 729 | whisper.cpp 转录 + 识别模型下载/管理；`resolveCliPath()` **优先** `process.resourcesPath/whisper/`（whisper 随安装包），只在「非 wav/flac/mp3/ogg 要转码」且缺 ffmpeg 时以 `FfmpegNeededError` 回 `needPacks:['ffmpeg']` | `whisper:*`（11 handle + 1 推送） |
| [updater/index.ts](./files/main/updater.md) | 108 | 应用自更新（electron-updater generic provider，**懒加载**）与 3 秒启动静默检查的**统一出口**：`register(ctx)` 装配 8 个 `update:*` 频道，各子文件的具名导出原样挂在 index 上 | `update:*`（7 handle + 1 `on`/`sendSync` + 1 推送） |
| [updater/base.ts](./files/main/updater.md)（同篇） | 285 | 底座（依赖最上游，不 import 同目录任何模块）：`updater` / `flags` / `state` 运行态单例、日志与小工具、**随包 `CHANGELOG.md` 的定位与读取**、`humanError()` 文案分层、进度 `payload()` / `send()`、6 个事件绑定 `bindEvents()`、懒加载 `ensureUpdater()` | — |
| [updater/actions.ts](./files/main/updater.md)（同篇） | 139 | 对外动作：检查 / 下载 / 取消、更新源覆盖 `applyFeedUrl()`、两条「无事件不许报成功」的守卫 | — |
| [updater/install.ts](./files/main/updater.md)（同篇） | 145 | 退出并安装（`quitAndInstall`）、下载缓存清理、忙碌态判定（`bindBusyTracking()`：`project:html-progress` 按活动 `taskId` 集合判忙） | — |
| [runtime.ts](./files/main/runtime.ts.md) | 959 | 运行环境（**分包**）：`PACK_DEFS` 包注册表（`ffmpeg` / `hyperframes` 各成一个 7z，whisper 不进包）→ 取清单 + 包 → sha512 校验（`Range` 断点续传）→ `7za` 解到 `userData/runtime/<包名>/`，就绪后按包调 `hfEnv.refreshPack()`；`packsStatus()` 纯探测、`ensurePacks()` 才下载解包（可取消）；取远端清单有 **20 秒硬超时** | `runtime:*`（3 handle + 1 推送） |

> 行数取自工作区源码实测（`[IO.File]::ReadAllLines` 与编辑器行号一致）。目录下共 **59** 个 `.ts` 文件 = **9 个根目录单文件 + `account/` 目录 3 个文件 + `cast/` 目录 9 个文件 + `voice/` 目录 10 个文件 + `projects/` 目录 16 个文件 + `agent/` 目录 8 个文件 + `updater/` 目录 4 个文件**（`Get-ChildItem src\main -Recurse -File -Filter *.ts` 实测；旧记 55，差在 account 3 与 `agent/constants.ts` 1）；上表**已全部收录**（`account/` / `cast/` / `voice/` / `projects/` / `agent/` / `updater/` 各合成**目录级一篇**：[files/main/account.md](./files/main/account.md)、[files/main/cast.md](./files/main/cast.md)、[files/main/voice.md](./files/main/voice.md)、[files/main/projects.md](./files/main/projects.md)、[files/main/agent.md](./files/main/agent.md)、[files/main/updater.md](./files/main/updater.md)，旧名 [files/main/updater.ts.md](./files/main/updater.ts.md) 只留过渡指针）。
>
> 目录 / 文件组织约定见根 `AGENTS.md` 关键约定 9：**300 行考虑拆、500 行是硬上限**；模块拆分的形态固定为「**同名目录 + `index.ts` 统一出口**、具名导出原样挂在 `index.ts` 上、依赖方向单向、跨文件共享的 `let` 收进 `state` / `flags` 对象或改取值函数（不许按值导出）」，另有 4 类可不拆的例外。`cast/`、`updater/`、`agent/`、`projects/`、`account/` 就是这条约定的样板（`account/` 只有 3 个文件、每份都能单独读懂）。

### 1.1 `projects/` 的 16 个文件（合计 2371 行，最长 369 行）

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.ts` | 38 | **统一出口**：再导出 13 个值 + 4 个类型；文件头保留原 `projects.ts` 的「每个项目目录里有什么」说明 |
| `paths.ts` | 57 | **路径层（依赖最上游，只拼路径不读写）**：`projectsRoot`（函数、惰性求值）/ `projectDir` / `projectFilePath` / `contentFilePath` / `resolveVideoAbs` / `castLibraryRoot` |
| `store.ts` | 239 | **项目读写**：`project.json`（只存索引）+ `subtitle.txt` / `content.json`（两个正文）的读 / 写 / 补齐 / 扫描 / 规范化；角色的 `cast` 只存 `[{ id, selected }]`、读项目时按 id 从全局库补全（`normalizeCastSelections` / `resolveProjectCast`，**无迁移**） |
| `materials.ts` | 87 | **项目素材库（图片 / 视频）**：`MATERIAL_DIR` / `newMaterialId` / `materialKindOf` / `copyMaterialIntoProject` / `normalizeMaterials` / `materialExtsText` |
| `prompts.ts` | **369** | **提示词纯拼装**（只读项目数据、不调模型、不写盘，**15 个导出函数**）：内容脚本 / 全局视觉风格 / 素材 / 画布 / 成片时长 / 禁止无限循环块 + 规划 / 逐章 / 角色（新建、修改·重画）/ **动作脚本（`buildCastActionPrompt`）** |
| `bgm.ts` | 65 | **背景音轨确定性注入**：`BGM_TAG_ID`（`myv-bgm`）+ `insertHtmlSnippet` / `escapeRegExp` / `stripInjectedBgm` / `stripAudioOfFile` / `applyBgmToHtml` |
| `previewScript.ts` | 159 | **预览副本控制脚本**：纯字符串常量 `HG_PREVIEW_CTRL` |
| `progress.ts` | 45 | **进度文案与推送**：`progressText` / `progressSender` / `pushStatus`（`taskId` 必填、按 id 分发） |
| `htmlWrite.ts` | 127 | **Agent 产出落盘**：`syncCoreLib` / `writeSingleHtml` / `applyCastToHtml` / `refreshCastInPage` / `writeChapterSkeleton` |
| `chaptersFlow.ts` | 192 | **章节化两条流程**：`generateByChapters`（全部成功才落盘）/ `applyChapterEdit`（先路由再定向编辑） |
| `ipc/project.ts` | 121 | **项目生命周期 9 条**：`project:list` / `create` / `load` / `save-subtitle` / `save-content` / `export-srt` / `open-folder` / `open-folder-of` / `delete`；`registerProjectIpc(ctx)` |
| `ipc/html.ts` | 249 | **HTML 6 条**：`project:generate-html` / `modify-html` / `download-html` / `read-html` / `preview-html` / `save-html`；`registerHtmlIpc(ctx)` |
| `ipc/media.ts` | 218 | **素材与音视频 10 条**：`project:save-video` / `set-render` / `set-canvas` / `pick-audio` / `set-audio` / `clear-audio` / `pick-media` / `add-materials` / `save-materials` / `extract-video-audio`；另有 `FFMPEG_PACKS`、`registerMediaIpc(ctx)` |
| `ipc/cast.ts` | 224 | **角色 7 条**：`cast:list` / `cast:create` / `cast:recreate` / `cast:save-meta` / `cast:remove` / `cast:preview`（全局角色库，与项目无关）+ `project:save-cast`（本片用哪几个，载荷 `[{ id, selected }]`）；`registerCastIpc(ctx)` |
| `ipc/castActions.ts` | **162** | **动作示范 5 条**：`cast:action-list` / `cast:action-save` / `cast:action-remove` / `cast:action-generate` / `cast:demo`；`registerCastActionIpc(ctx)`。**唯一的模型调用是 `cast:action-generate`**（进度按 `taskId` 推送、日志 `html-agent/cast-action.jsonl`）；`cast:demo` 拼会动的示范页 |
| `register.ts` | **19** | **只做装配**：`const deps: RegisterCtx = { getWindow: (ctx && ctx.getWindow) || (() => null) }`，依次调**五个** `registerXxxIpc(deps)`（项目 / HTML / 素材与音视频 / 角色 / **动作示范**） |

---

## 2. 装配模式：`register(ctx)`

所有业务域模块都导出统一的 `register(ctx?: RegisterCtx)` 函数，由入口在窗口创建后依次调用：

```ts
// src/main/index.ts
const ctx: RegisterCtx = { getWindow }        // getWindow: () => BrowserWindow | null
settings.register(ctx)

account.register(ctx)                          // 账号（可选登录）：5 条 account:* 频道

projects.register(ctx)

agent.registerScript(projects.projectDir)      // 只传「项目名 → 项目目录」，不传 ctx
voice.register(ctx)
voice.registerAlign(ctx)
video.register(ctx)
whisper.register(ctx)
updater.register(ctx)

runtime.register(ctx)                          // 运行环境包，最后一步
```

> `account.register(ctx)` 排在 `settings` 之后、`projects` 之前（与 `src/main/index.ts` 顶部的 `import * as account from './account'` 顺序一致）。它**只挂 5 条 `account:*` 的 `ipcMain.handle`**，不订阅任何事件、不依赖窗口以外的上下文（`ctx` 只用来对齐统一的 `register` 形状；账号不发原生对话框，所以 `_ctx` 实际未使用）。账号域**不 gate 任何后续注册**——即使它初始化失败，本机流水线也照常可用。

> `agent.registerScript(projects.projectDir)` 是**唯一不接收 `ctx` 的 register**：它既不弹对话框（不需要父窗口）、也不读主窗口引用，推送走 `event.sender`（发起调用的那个窗口）。它唯一的一个参数是**「项目名 → 项目目录」的解析函数**（`projects.projectDir`），用于拼 `projects/<项目名>/chat/index.json` 与 `chat/versions/<id>.json` 的路径；**传函数而不是让 agent 去 import projects**——否则会与 `projects → agent` 成环。

> `updater.register(ctx)` 除注册 `update:*` 频道，还会在 3 秒后做一次「启动静默检查」（受 `settings.json` 的 `updater.autoCheck` 控制；dev 环境未提供 `dev-app-update.yml` 时跳过）；主进程更新状态 `state` 常驻，渲染层可随时用 `update:status` 取一次。`runtime.register(ctx)` 排在最后：它在 `register()` 里**只做一次探测**（`prepareInBackground()` **不下载**），排最后只保证自己的 handler 先挂上。
>
> `index.ts` 自身的 `legacy:*` 两个 handler 也在这个位置注册（`createWindow()` 之后、`ctx` 之前），但它们不属于 `register(ctx)` 模式——它们直接写在入口里，见 §4.1。

- `RegisterCtx`（`src/shared/types.ts`）只提供一个能力：拿到主窗口引用，使各域的 `dialog.showOpenDialog` / `showSaveDialog` 以主窗口为父；**账号域是唯一用不上它的域**（没有任何对话框）。
- `register` 是各域**唯一**的 IPC 注册入口：域内的 `ipcMain.handle` / `ipcMain.on` 全部集中在这一个函数体内，便于审阅整个域对外的接口面。
- `index.ts` 自身不属于该模式，它直接注册窗口控制与剪贴板频道。

---

## 3. 模块依赖图（无环）

```
settings ──→ agent(chat ← html / script；script → chatLog) ──→ projects/ ──→ voice/（内部 catalog ← api ← ipc/*）
                     │
                     └─ script 只造 JSON、不碰文件工具；对话记录读写下沉到 chatLog；index.ts 只再导出（对外仍是 './agent'）
                                      ↗
hfEnv ──→ projects/ / voice / whisper / video / runtime
voice/vad ──→ whisper
voice/catalog ← voice/systemVoices（目录内部）
settings ──→ updater（读 updater.feedUrl / autoCheck / skippedVersion）
index.ts ──→ settings（处置老数据时用 isPristineSettings 判定出厂状态）
index.ts ──→ account（只此一条边：入口注册 5 条 account:*；account 只 import shared，不被任何域依赖）
runtime ──→ hfEnv / settings（按包交接资源根 hfEnv.refreshPack()、下载源取 updater.feedUrl）
projects/ / video / voice/ttsAlign / whisper ──→ runtime（动手前 runtime.missingPacks() 纯校验：缺包即返回 needPacks，不阻塞）
chapters ──→ projects/（章节模式的解析 / 校验 / 落盘 / 骨架由 projects/ 调用；chapters 不 import projects/，避免成环）
cast/ ──→ chapters（`table.ts` 复用 `chapters.parseFileBlocksWith` 解析角色文件块；反过来 chapters 不知道角色）
cast/ / editRoute ──→ projects/（角色表与角色文件、改稿路由结果由 projects/ 解析后使用；两者都不 import projects/）
coreLib ──→ projects/（core.js 的版本同步与导出内联；纯逻辑，**不 import electron、不 import projects/**）
hfEnv / coreLib ──→ video（渲染前同步 core.js：`hfEnv.coreSource()` + `coreLib.syncCoreTo`）
shared/{ipc,types,errors,constants} ──→ 全部模块（常量、跨进程类型与纯函数映射）
```

| 依赖边 | 具体协作点 |
|---|---|
| `voice → projects/` | 用 `projects.projectsRoot()`（**函数，惰性求值**）定位项目 `audio/` 与枚举项目（`scanProjects()`）；三处调用点见 [files/main/voice.md](./files/main/voice.md) §6 |
| `voice/ttsAlign → voice/api` | 复用 `synthOne()`、`resolveVoiceModel()`、`voiceFriendlyError()` |
| `whisper → voice/vad` | 转录前用 `vadTrimSegments()` 裁掉起止静音；用 `toVadSamples()`（走 `hfEnv` 的 ffmpeg）统一采样率 |
| `voice/` 目录内部 | `systemVoices → catalog ← api ← ipc/*`；`cloneAudio → hfEnv`、`ttsAlign → api / projects / hfEnv / runtime`、`vad` 零依赖；`register.ts` 只调两个 `registerXxxIpc`，`index.ts` 只再导出（对外仍是 './voice'）。**无环** |
| `whisper / voice / video / projects/ → hfEnv` | 定位 CLI、Node 运行方式、按包解析的 FFmpeg bin 与 chrome-headless-shell，以及 `isHyperframesComposition()` 合规校验；`projects/` / `video` 另用 `localizeVendorHtml()` / `ensureVendorFiles()` / `externalizeVendorHtml()` |
| `projects/ → agent（html.ts / htmlEdit.ts）` | `project:generate-html` / `project:modify-html` 调用 `chatWithCustomModel()` 与 **`chatWithHtmlEdit()`**，并把 `onProgress` 映射为阶段文案推送给渲染层 |
| `agent/chat.ts ← agent/html.ts / htmlEdit.ts / script.ts` | 三条 Agent 链路都调 `chatWithModel()`——传输层（多轮 / 流式 / 升档 / 日志 / 错误翻译）只有一份；`chat.ts → settings`（`getCustomModel` / `loadOpenAI`）与 `chat.ts → shared/errors`（`friendlyError`）是唯一的配置与报错出口。**方向单向**；`chatLog` 只被 `script` 依赖 |
| `agent → index.ts` | `index.ts` 里 `import * as agent from './agent'` 并在 `projects.register(ctx)` 之后调 **`agent.registerScript(projects.projectDir)`**；`agent/index.ts` 只做再导出（**不含 chatLog**） |
| **`account → index.ts`**（本次新增） | `index.ts` 里 `import * as account from './account'`，在 `settings.register(ctx)` 之后调 `account.register(ctx)`，把 5 条 `account:*` handler 挂上。**方向单向、只有这一条边**：`account/api.ts` 与 `account/store.ts` 只 import `electron` / `node:fs` / `node:path` / `../../shared/{types,ipc}`，`account/index.ts` 只 import `./api` / `./store` 与共享层；**`projects/` / `voice/` / `agent/` / 渲染层都不 import account**（渲染层只经 `window.accountTools`）。将来「额度 / 项目同步」等云端能力由主进程用 `account.currentToken()` 取令牌，**不新增反向依赖** |
| `projects/ → chapters` | 章节模式下调用 `chapters.ts` 的解析 / 校验 / 读写 / 骨架 / 内联；**单向**：`chapters.ts` 不 import `projects/` |
| `projects/ → cast` | 角色表 / 角色文件 / 全局库 / 预览页 / 动作示范全部由 `projects/` 调 `cast` 的具名导出；**单向**：`cast/` 不 import `projects/` |
| `projects/ → editRoute` | `applyChapterEdit()` 拿到路由回复后调 `editRoute.parseRouteReply(reply, allowed)`；解析失败即回退成「发全部源码」。**单向** |
| `projects/ / video → coreLib` | `projects/` 的 `syncCoreLib()` 与 `video.ts` 的渲染前同步都调 `coreLib.syncCoreTo(dir, hfEnv.coreSource())`；导出时用 `coreLib.readProjectCore(dir)` 内联。**单向** |
| `cast → chapters` | 角色文件块与章节文件块共用同一套 `<<<FILE …>>>` 标记与解析（`chapters.parseFileBlocksWith`）；方向单向 |
| `projects/ → shared/constants` | 素材类型判定 / 文件框过滤 / 上限校验 / 列表截断共用同一份白名单与上限，渲染层用同一份常量显示 `n / 20` |
| `voice / whisper / agent（经 chat.ts） → settings` | 读取 API Key、目标模型、当前识别模型与自定义模型列表；写回配置 |
| `index → settings` | 用户选「迁移过来」后，`migrateFrom()` 调 `settings.isPristineSettings(dst)` 判断新 `settings.json` 是否仍是「出厂状态」 |
| `projects/ → runtime` | `project:extract-video-audio` 先 `runtime.missingPacks(['ffmpeg'])` 纯校验，缺包直接返回 `{ ok:false, needPacks, message }`；`video.ts` / `voice/ttsAlign.ts` / `whisper.ts` 同构 |
| `projects/ipc/media.ts → settings` | `pickRenderOverride` 过滤项目级渲染档位（`project:set-render`）；`settings.ts` 不 import `projects/` |
| `runtime → hfEnv` | 探测到某包就绪与解包完成时调 `hfEnv.refreshPack(name, root)`，把该包目录交给 `hfEnv` 重算包缓存 |
| `runtime → settings` | `getUpdaterSettings().feedUrl` 作为运行环境包的下载源 |
| `updater → settings` | 读 `updater.feedUrl` / `autoCheck` / `skippedVersion`；下载「跳过版本」时清掉该标记 |

`src/main/index.ts` 顶部的注释即为这份依赖图的权威描述（`settings ← agent(chat ← html/script) ← projects/ ← voice`；`hfEnv ← projects/, voice, whisper, video, runtime`；`updater ← settings`；`account ← index.ts`；无环）。

---

## 4. 各模块职责

### 4.1 `index.ts` —— 入口装配器

- **userData 位置保持 Electron 默认**：`const USER_DATA_DIR = app.getPath('userData')`，即 `%APPDATA%\<package.json 的 name>`（现 `%APPDATA%\shadowmill`）。**刻意不做 `app.setPath('userData', …)`**。
- **归属证明（`isOurs`）**：扫到同名目录后先证明「它是我们的」：① `hasOurIdentity(dir)`——遍历点开头的标记文件，`JSON.parse` 后 `appId === APP_ID`（`'com.shadowmill.app'`）即通过；② 否则看结构特征 `<dir>\projects\<项目名>\project.json`；③ 都不满足 ⇒ 不提示、不迁移。标记由 `writeIdentity(USER_DATA_DIR)` 在模块体里写一次（`.shadowmill-data`，幂等）。
- **历史数据目录：扫描 + 用户确认式迁移**：`findLegacyData()` 扫 `LEGACY_DIR_NAMES = ['my-app']`，四道闸：排除自身 → 目录存在 → 归属证明 → 白名单条目确有数据；返回 `{ dir, entries, projects }`。
- **用户决定，不静默处置**：`createWindow()` 之后注册 `legacy:status` / `legacy:resolve` 两个 handler；`legacyInfo()` 扫一次即缓存，渲染层挂载时问一次并弹应用内弹窗（`LegacyDataDialog.vue`）；`resolveLegacy()` 执行 `migrate` / `delete` / `later`（非法或缺省当 `later`）。
- **迁移语义（`migrateFrom`：移动、逐项、不覆盖）**：只搬 `OWN_DATA_ENTRIES = ['projects','whisper','voice','tts-output','html-agent','settings.json']`；目标不存在时整条目 `renameSync`，否则递归合并、文件不覆盖；`settings.json` 例外（仍出厂状态才覆盖，覆盖前备份）。**只有 `failed === 0` 才清缓存**。
- **删除要二次校验**：目标必须等于 `%APPDATA%\<LEGACY_DIR_NAMES 里的名字>`，否则回 `该目录不在允许删除的名单内`。
- **⚠ 代价：`LEGACY_DIR_NAMES` 是手工清单**——以后改 `package.json` 的 `name`，**必须**把旧名字加进去。
- **`.shadowmill-data` 的职责**：只用于扫描时的归属证明与「这个目录是我的」的依据。
- **刻意不碰 Chromium profile**：白名单之外的一切都不搬；`hf-projects` 也不在白名单（就地渲染后不再产生）。
- **业务模块的惰性路径写法是「纯保险」**：`projects.projectsRoot()` / `whisper.modelsDir()` / `runtime.runtimeDir()` / `settings.settingsFile()` 一律函数 / getter。
- **启动时序打点**：`bootLog(stage)` 往 `userData/startup.log` 追加 `ISO 时间 + '+<距进程启动毫秒>ms ' + 阶段`；文件超 64KB 自动清空。
- **协议特权与白名单**：ready 之前 `protocol.registerSchemesAsPrivileged`（`hgpreview`，standard / secure / supportFetchAPI / stream）；`USER_PREVIEW_DIRS = ['tts-output', 'voice', 'cast-preview']`。ready 之后 `protocol.handle('hgpreview', …)` 两条路由：`p/<项目名>/…` 项目内文件、`user/<相对路径>?user=1` 项目外语音产物（顶层必须在白名单内，否则 403）。
- **路由解析抽成 `resolveHgPreviewPath(rawUrl)`**：返回 `{ full, why }` 或 `null`；判定按「段 + 查询标记」、不看 host；路径**按段 decode**，与渲染层 `utils/url.ts` 的逐段 encode 对应。响应由 `rangeResponse()` 构造（`Range` → 206 / 416），MIME 由 `previewMime()` 显式给。
- **窗口**：单窗口 `1200×800`（最小 `800×600`）、`titleBarStyle: 'hidden'`、`backgroundColor: '#0B1220'`、`Menu.setApplicationMenu(null)`、`contextIsolation: true` / `nodeIntegration: false`、preload 指向 `../preload/index.js`。
- **IPC**：`window:minimize` / `window:toggle-maximize` / `window:close`（`on`），`app:copy-text`（`handle`），最大化状态经 `window:maximized-change` 回推；旧数据处置为 `legacy:status` / `legacy:resolve`（都是 `handle`，**没有主 → 渲染的推送**）。

### 4.2 `hfEnv.ts` —— 环境探测与资源定位

- `BUILTIN_RESOURCES` 各字段都是 **getter**，按包缓存；`resolvePackRoot('ffmpeg'|'hyperframes')` 候选依次是：`<userData>/runtime/<包名>/`（有 `ok.json`）→ 旧版整体包目录 → `process.resourcesPath` / 开发态 `resources`。`refreshPack()` / `packReady()` 一并保留。
- `findChromeShell()` **只缓存找到的结果**（找不到返回 `null` 但不写缓存），避免「解包完成前被问过一次」把 `chrome=无` 钉住。
- 定位函数均为**多候选回退**：`findNode()`（Electron 内嵌 Node ≥22 → 系统 Node）、FFmpeg（WinGet 的 `Gyan.FFmpeg*`）、HyperFrames CLI（内置优先，其次 `HYPERFRAMES_CLI`）。
- `isHyperframesComposition(raw)`：转视频前的合规校验。
- 随包前端库本地化一组（`localizeVendorHtml()` / `referencedVendorFiles()` / `ensureVendorFiles()` / `externalizeVendorHtml()` / `hoistVendorRefs()`，由不导出的 `VENDOR_LIBS` 表驱动）：把 CDN 与 `node_modules/p5/…` 改写为 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`，并按需幂等复制进项目；导出时反向换回固定版本 CDN。

### 4.3 `settings.ts` —— 设置存储

- `userData/settings.json`，分区：`customModel`、`voiceTTS`（旧）、`voiceProfiles`、`whisper`、`updater`，另有 `render`（`quality` / `fps`）。
- 三个 `normalize*` 白名单函数各管一段；`isPristineSettings(file)` 唯一调用方是 `index.ts` 的 `migrateFrom()`；`readSettings()` 逐分区浅合并并静默容错，写盘整体覆盖。
- `settings:test` 必须拿到模型返回的文本才算成功；失败文案统一走 `shared/errors`。
- `loadOpenAI()` 首次真正发请求时才 `require`；API Key 明文存本机 `settings.json`，不经 IPC 外传。

### 4.4 `agent/` —— Agent 层（目录，8 文件）

一个模块、八个文件：**一个传输层 + 四个业务薄封装 + 一份提示词常量 + 一份对话记录读写 + 一个统一出口**，形态是「同名目录 + `index.ts`」。**`chat.ts` 不认识任何业务**；`chatLog.ts` 不认识业务、也不认项目名；`html.ts` / `htmlEdit.ts` / `castAction.ts` 与 `script.ts` 各自只保留「业务专属」的东西；`constants.ts` 放提示词常量；`index.ts` 只做再导出（**不含 `chatLog`**）。目录级说明见 [files/main/agent.md](./files/main/agent.md)。

| 文件 | 行数 | 一句话 |
|------|------|--------|
| `chat.ts` | 265 | 通用对话层：多轮 `messages` + 流式（SDK / fetch SSE，**两条路径都带 `reasoning_effort`**）+ `max_tokens` 升档重试（`MAX_TOKEN_TRIES = [131072, 262144]`）+ jsonl 过程记录 + 人话错误 |
| `chatLog.ts` | 155 | 对话记录读写：`<项目目录>/chat/index.json`（索引，不含 scenes）+ `versions/<id>.json`（每版副本），`MAX_CHAT_ROUNDS = 100`、写索引后清理孤儿副本、清空删整个 `chat/`（**内部模块，不挂 `index.ts`**） |
| `html.ts` | **229** | HTML 薄封装：`extractHtmlFromReply` + `chatWithCustomModel` + 章节 / 角色 / 路由五份提示词与五个包装（**提示词常量本体在 `constants.ts`**） |
| **`constants.ts`** | **368** | **Agent 提示词常量表**（`HTML_AGENT_SYSTEM` / `HTML_PLAN_SYSTEM` / `HTML_CHAPTER_SYSTEM` / `HTML_CHAPTER_EDIT_SYSTEM` / `HTML_CAST_SYSTEM` / `HTML_ROUTE_SYSTEM` 等；从 `html.ts` 拆出，避免单文件越过 500 行硬上限） |
| **`htmlEdit.ts`** | **52** | 单文件模式「按需求修改」的薄封装（`HTML_AGENT_EDIT_SYSTEM` = `HTML_AGENT_SYSTEM` 打头 + 第 7–10 条追加规则；`isCompleteHtmlEdit()`；`chatWithHtmlEdit()`） |
| **`castAction.ts`** | **44** | 动作脚本薄封装（`HTML_CAST_ACTION_SYSTEM` + `chatWithCastAction()`；只被 `projects/ipc/castActions.ts` 调用） |
| `script.ts` | 342 | 内容脚本：`SCRIPT_AGENT_SYSTEM` + `buildScriptPrompt` + `parseScriptReply` + **`registerScript(getProjectDir)`**（域 `script:*` 七条） |
| `index.ts` | **21** | 统一出口：只再导出（值 + 4 个类型），不写逻辑 |

依赖单向：`chat` 在最上游（不 import 同目录任何模块），`html` / `script` / **`castAction`** 只从 `./chat` 取 `chatWithModel`，`htmlEdit` 从 `./chat` 取 `chatWithModel`、从 `./html` 取 `HTML_AGENT_SYSTEM` / `type AgentOpts`，`castAction` 只从 `./html` 取类型 `AgentOpts`，`script` 另从 `./chatLog` 取 8 个读写 / 清理函数，`index.ts` 聚合各子文件的具名导出。

> 更细的传输层 / 提示词 / 对话记录说明见 [files/main/agent.md](./files/main/agent.md)；本页 §4.4 的行数与「谁提示词在哪」按当前源码更新，**其余提示词细则仍以 agent.md 为准**（它自己也有一版旧行数，见 §0）。

### 4.5 `projects/` —— 项目化流水线（同名目录，16 个文件）

- 项目实体：`userData/projects/<项目名>/`。**索引与正文分文件**：`project.json` 只有索引（`ProjectIndex`：`name` / `title` / `subtitleCount` / `htmlPath` / `videoPath`（项目内相对路径）/ `audioFile` / `materials` / `render` / `canvas` / `createdAt` / `updatedAt`）；字幕正文在 `subtitle.txt`、内容脚本正文在 `content.json`。
- `readProject()` 只读索引；`ensureProject()` 把索引 + 正文拼成完整 `Project`；`writeProject()` 先落正文再只写索引。老项目读时兼容、写时把正文落到文件，**没有迁移脚本**。
- `materials` 是项目素材库（图片 + 视频，多素材），每条 `ProjectMaterial` 的 `file` 是项目内相对引用；`videoMaterial` 是历史字段。
- 对外能力：**26 个 `handle`** + 1 个推送，按域分在 `ipc/project.ts` 9 / `ipc/html.ts` 6 / `ipc/media.ts` 10 / `ipc/cast.ts` 7；`register.ts` 只装配五个 `registerXxxIpc(ctx)`。
- 关键内部设施：`projectDir()`、`parseSubtitle()`、`resolveVideoAbs()`、`scanProjects()`、`buildContentBlock()`、`buildStyleBlock()`、`buildCanvasBlock(proj, forModify)`、`buildMaterialPrompt()`、`buildMaterialBlock()`、素材库助手、`resolveMaterials()`、背景音轨注入一组、预览副本脚本 `HG_PREVIEW_CTRL`。
- 随包前端库本地化在生成 / 修改 / 保存 / 预览四个写盘环节先做；导出时反向外部化。
- **章节化长片 + 全局角色**：`project:generate-html` 先规划再分支；角色来自全局库，生成时只取 `cast.selectedMembers(proj.cast)`、落盘前 `syncProjectCast` 复制副本；`project:modify-html` 两种形态都改不了角色；`project:download-html` 内联角色副本与 `core.js`。

### 4.6 `voice/` —— 语音域（目录，10 文件）

- **定位**：厂家目录 + 接口层 + 克隆参考音频 + VAD + 逐句对齐 + 两组 `voice:*` IPC。形态是同名目录 + `index.ts` 统一出口，依赖单向 `catalog ← api ← ipc/*`；对外只有两个入口：`register(ctx)` 与 `registerAlign(ctx)`。
- **厂家目录（`catalog.ts`）**：一家 = 一条记录（`VoiceProviderDef`），当前只有千问；查询四个：`providerByKey` / `providerOfModel` / `providerOfSystemVoice` / `seriesDefaultModel`。
- **内置系统音色（`systemVoices.ts`）**：`SYSTEM_VOICES` 48 条；不上出口，只被 `catalog.ts` 引用。
- **接口层（`api.ts`）**：`isAudioTtsModel` / `providerFor` / 跨厂家校验（不静默改名、也不静默换厂家）/ `voiceFriendlyError` / `resolveTtsDir` / `resolveVoiceModel` 三级 / `fetchClonedVoices` / `synthOne`。
- **克隆参考音频（`cloneAudio.ts`）**：内置 ffmpeg 裁「前 15 秒 / 24k / 单声道」；**VAD（`vad.ts`）**：零依赖纯函数，被 whisper 与测试共用。
- **逐句对齐（`ttsAlign.ts`）**：模式 A（音频驱动）/ 模式 B（时间轴驱动，`atempo` 上限 1.15），静音补齐 + `concat` 零重编码装配整轨；入口先 `runtime.missingPacks(['ffmpeg'])` 纯校验。
- **频道（19 条）**：`ipc/voices.ts` 14 + `ipc/tts.ts` 2 + `ttsAlign.ts` 2 + 1 条推送。**频道名、载荷与 preload 方法名拆分前后一个字节未变**。

### 4.7 `video.ts` —— 转视频

- 频道：`dialog:open-html`、`video:show-in-folder`、`video:render`，以及推送 `video:progress`。唯一导出 `register`。
- **准备阶段**：缺包纯校验 → 入口存在性 → `isHyperframesComposition()` → **无限循环静态守卫**（命中 `repeat: -1` 即拒绝，不进 CLI、不建 `.render-tmp`）→ 定位 CLI / Node → 就地确定渲染根 → **按版本同步 `./core.js`** → 建 `.render-tmp` → 本地化随包库 → 注入环境 → 取画布 → `prepareEntry()`（写两处画布、裁定时长并写两处、裁超长媒体副本、写渲染入口）。
- **渲染阶段**：`spawn(node, [hfCli, 'render', '-c', '.render-tmp/entry.html', '-o', output.mp4])`，stdout/stderr 经 `video:progress` 回推，`close` 时先删 `.render-tmp/`（无论成败）再判成功。
- **无限循环守卫**：GSAP 把 `repeat:-1` 的 tween 时长当成 1e10 秒，成片时长没法确定；命中即返回人话 `message`。**CSS 的 `animation-iteration-count: infinite` 不拦**。
- **成片画布必须写在「舞台元素」上**：CLI 的 `compileForRender` 取第一个带 `data-composition-id` 的元素的 `data-width` / `data-height`；`<html data-resolution>` 只做页面自描述。
- **量时间轴的 `file:///` 是唯一例外**：喂给 Chromium `--dump-dom`，不在页面里、不受同源策略约束。
- 产物回写由渲染层经 `project:save-video` 完成（主进程 `video.ts` 不写 `project.json`）。
- **`hf-projects/` 已下线**：渲染中间产物只有项目内的 `.render-tmp/`，且渲完即删。

### 4.8 `whisper.ts` —— 本地转录与模型管理

- **内置模型档位 4 个**：`tiny-q8_0` / `base` / `base-q5_1` / `small-q8_0`；下载走国内镜像 `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/`。
- 模型目录 `userData/whisper/models/`；CLI 由 `resolveCliPath()` 定位（`process.resourcesPath/whisper/` 优先）。
- 下载：边下边写 `.part`、进度节流回推、完成后原子 `rename`、失败清理残片。
- 转录：`prepareAudio()` → VAD 裁剪 → `spawn whisper-cli.exe` → 解析 `transcription.segments` → `opencc-js` 繁转简 → `[分:秒] 文本`；**不直接写项目文件**。
- 进度两阶段：先「正在加载模型」，解析到 `progress = N%` 后转「转录中 N%」。

### 4.9 `updater/` —— 应用自更新（目录，4 文件）

- **文件分工**（依赖单向：`index.ts → install.ts → actions.ts → base.ts`）：`index.ts` 装配 `register(ctx)` 与 8 个 `update:*` 频道；`base.ts` 运行态单例 / 日志 / `changelogPath()` / `humanError()` / `payload()` / `send()` / `bindEvents()` / `ensureUpdater()`；`actions.ts` 动作；`install.ts` 安装与忙碌态。
- **更新源**：`settings.json` 的 `updater.feedUrl` → 打包内置地址；`electron-updater` 懒加载、缺失也不崩。
- **「有事件才算成功」**：`checkNow()` / `downloadUpdate()` 都有守卫。
- **安装前拒绝长任务**：`busy` 由 `bindBusyTracking()` 监听 4 路进度通道自动推导（`project:html-progress` 按活动 `taskId` 集合判忙）。
- **错误文案分两层**（`message` / `detail`）；`update:open-log` 刻意不进 `ensureUpdater()`。

### 4.10 `runtime.ts` —— 运行环境包

- **动机**：安装包只带代码 + whisper；ffmpeg / hyperframes 各成一个 7z，首次用到时由用户确认后下载（提示体积、可取消）。
- **频道**：`runtime:status` / `runtime:prepare` / `runtime:cancel` / 推送 `runtime:progress`。
- **三个 API 的分工**：`packsStatus()` / `missingPacks()` / `packSizeText()` 纯探测，`ensurePacks()` 才下载 + 解包，`prepareInBackground()` 启动只探测。
- **主流程**：探测缺包 → 定位 `7za` → 逐包安装（清单本地优先，否则远端 + `Range` 续传 + sha512 复核）→ 解包 → 先写 `ok.json` 再写 `packs.json` → `hfEnv.refreshPack()`。
- **取消语义**：flag + `abort()` + `kill()` ⇒ `cleanupHalfDone()` ⇒ `cancelled`（不是失败）；**超时不算取消**（`.part` 保留续传）。

### 4.11 `chapters.ts` —— 章节化长片（纯逻辑）

- **定位**：解析 / 校验 / 读写章节文件 / 装配骨架，全部纯逻辑；**不 import `projects/`、不调用模型、不注册 IPC**。
- **规则**：章节目录 `pages`；id 形如 `c01`；路径白名单只有 `pages/cNN.js`；单章 ≤180 秒；`scenes` 连续升序、不重不漏；禁 `repeat: -1`；必须登记 `window.__chapters[id]`。
- **骨架**：`index.html` 由应用生成（舞台 / 画布 / `./gsap.min.js` / `./core.js` / 角色脚本「传谁引谁」/ 章节脚本 / 末尾装配时间轴）。
- **`uses`**：按「全体章节 `uses` ∪ 传入角色列表的 `uses`」的并集引入随包库。

### 4.12 `cast/` —— 角色与动作（目录，9 文件）

- **定位**：角色与它的动作的目录模块；形态是同名目录 + `index.ts` 统一出口，**对外 37 个具名导出**、内部依赖单向；**不调模型、不 import `projects/`、不注册 IPC**。
- **角色是什么**：跨形态共用的一份绘制代码（`window.__cast["hero"] = function (x, y, u, o) { … }`），不是素材图片；全局资产，项目里只是产物副本。
- **文件分工**：`table.ts` 角色表与角色文件 + `edit.ts` 只读角色块 + `inject.ts` 单文件注入 + `library.ts` 全局库 + `preview.ts` 静态预览页 + `presets.ts` 内置 14 条动作 + `actions.ts` 动作库 + `demo.ts` 示范页 + `index.ts` 只再导出。
- **落盘**：角色代码 `<项目>/cast/<id>.js`（副本）；角色表 `Project.cast` 只存 `[{ id, selected }]`；动作 `<userData>/cast-library/actions.json`；示范页 `<userData>/cast-preview/<id>.demo.html`。
- **全局角色库**：`<userData>/cast-library/`（`index.json` + `<id>.js` + `actions.json`），用户资产、不进安装包。

### 4.13 `editRoute.ts` —— 改稿路由（纯逻辑）

- **定位**：只回答「这段回复说改哪几个文件、要不要改结构」；不调模型、不读文件、不注册 IPC。
- **导出**：`EditTargets` + `parseRouteReply(reply, allowed)`——认 `<<<ROUTE>>>` 块 / JSON 围栏 / 裸 JSON；路径只做归一，对不上已有文件就跳过（不猜）；去重、≤6 个；解析不出 JSON 返回 `error`，调用方回退成「发全部源码」。

### 4.14 `coreLib.ts` —— 共享绘制助手 core.js 的版本同步（纯逻辑）

- **定位**：真源 `vendor/shadowmill/core.js`（页面全局对象 `MC`），每个项目里有一份副本（`./core.js` + `.core-version`）；本模块只做「读版本 / 比对 / 复制」，**不 import electron**。
- **导出**：`CORE_FILE` / `CORE_VERSION_FILE` + `parseCoreVersion` / `readProjectCoreVersion` / `syncCoreTo(dir, srcPath)` / `readProjectCore`。
- **同步时机五处**：写骨架前 / 单文件注入前 / 预览前 / 导出前 / 渲染前。覆盖时记日志（`core-lib.log` / 项目的 `video-duration.log`）。
- **改 `core.js` 必须调大 `CORE_VERSION`**：它是「要不要覆盖项目里那一份」的唯一判据。

### 4.15 `account/` —— 账号 / 可选登录（目录，3 文件，本次新增）

- **定位**：账号域的目录模块——后端 HTTP 客户端 + 令牌持久化 + 5 条 `account:*` 频道的装配。形态是同名目录 + `index.ts` 出口，三条不变量写在 `api.ts` / `store.ts` / `types.ts` 的头部注释里：**未登录可用 / 令牌不出主进程 / 断网保留登录态**。目录级说明见 [files/main/account.md](./files/main/account.md)。

| 文件 | 行数 | 职责 | 导出 |
|---|---|---|---|
| `api.ts` | **221** | 账号后端 HTTP 客户端：`apiBaseUrl()`（`SHADOWMILL_API_BASE` → 缺省 `http://127.0.0.1:8080`）、`fail()`（码表兜底文案）、`sendCode()` / `register()` / `login()` / `me()` / `logout()`；内部 `FALLBACK_MESSAGE`（14 条错误码文案）、`SERVER_CODE_MAP`（7 条后端业务码直通）、`request()`（`fetch` + `AbortSignal.timeout(10_000)` + `X-Device-Name`） | 7 个函数 + 2 个类型 |
| `store.ts` | **96** | 令牌持久化：`safeStorage.encryptString` 写 `userData/account.bin`；**safeStorage 不可用时只存内存（不降级明文）**；模块级 `memory` / `loaded` 缓存；过期即清 | `load()` / `save()` / `clear()` + `StoredSession` |
| `index.ts` | **76** | 装配：`register(_ctx)` 挂 5 条频道；`currentToken()`；`handleSendCode()` 在 `app.isPackaged` 时剥掉 `devCode`；`remember()` 落盘；`currentSession()`（**401 才清令牌、网络错误保留**）；`logout()`（先撤销服务端再清本地） | `register()` / `currentToken()` |

- **为什么放主进程（三条硬理由）**：① 渲染层 CSP 是 `connect-src 'self'`，页面直连后端会被拦；② 打包后页面 Origin 是 `file://`，后端 CORS 只放行 `http://localhost:*`，预检也过不去；③ 令牌不该交给渲染层（XSS 拿不到它，也就偷不走会话）。
- **频道**：`account:send-code` / `account:register` / `account:login` / `account:me` / `account:logout`（5 个 `ipcMain.handle`，无推送）。回执是 `AccountResult` / `AccountSendCodeResult`（`code` + `message`），**不是 `IpcResult`**。
- **令牌生命周期**：注册 / 登录成功 → `api.ts` 把后端 `{ token, expiresInSeconds, user }` 换成 `IssuedSession`（token 只在本进程）→ `remember()` 调 `store.save()` 加密落盘 → 过 IPC 的只有 `{ user, expiresAt }`；退出时先 `POST /api/auth/logout` 再清本地。后端签发的是**不透明会话令牌**（30 天滑动续期，无 refresh、无 JWT 解析），后端方案与实施记录在 `docs/account-integration.md`。
- **不被其它域依赖**：只有 `src/main/index.ts` import 它；`account` 只 import `../../shared/{types,ipc}` 与 `electron` / `node:*`，**不 import `projects/` / `settings.ts` / `voice/`**。

---

## 5. 目录内的通用实现约定

1. **spawn 样板统一**：`child_process.spawn` + `windowsHide: true` + Promise 包装，参数以数组传递、不经 shell。
2. **外部依赖只从「安装包资源 + 运行环境包」取**：`whisper-cli.exe` 与 `7za.exe` 来自安装包，ffmpeg / hyperframes 来自运行环境包解出的 `<userData>/runtime/<包名>/`。
3. **返回约定**：业务接口统一 `{ ok: true, ... }` / `{ ok: false, message, canceled? }`；查询类可返回数组或 `null`（`project:pick-media` 返回裸字符串数组，取消时为空数组）。**账号域用 `{ ok, code, message }`**（见 §4.15），不套 `IpcFail`。
4. **进度回推节流**：下载与转录的高频进度按时间/百分比节流后再 `webContents.send`。
5. **路径安全**：所有项目内路径由 `projectDir()` 派生并做前缀校验；素材的 `file` 另由 `normalizeMaterials()` 校验必须落在本项目素材目录下且不含 `..`；`hgpreview` 的项目外路由顶层目录必须落在 `USER_PREVIEW_DIRS` 白名单内，否则 403。
6. **userData 位置保持 Electron 默认**：`USER_DATA_DIR = app.getPath('userData')`，**没有 `setPath`、没有位置钉死**。
7. **userData 路径一律惰性求值（纯保险）**：`projects.projectsRoot()` / `whisper.modelsDir()` / `runtime.runtimeDir()` / `settings.settingsFile()` 都写成函数 / getter。
8. **改 `package.json` 的 `name` 必须手动登记旧目录名**：`LEGACY_DIR_NAMES` 是**唯一**的发现机制；`USER_PREVIEW_DIRS` 与渲染层 `utils/url.ts` 的 `USER_DIRS` 必须同步改。
9. **持久化边界**：`settings.ts` 与 `projects/` 直接写项目 / 用户配置；`runtime.ts` 只写 `userData/runtime/**`；`agent/chatLog.ts` 只写 `projects/<项目名>/chat/`；**`account/store.ts` 是新增的一个例外——它只写自己的 `userData/account.bin`（safeStorage 加密）**。
10. **载荷 / 结果类型全部来自 `src/shared/types.ts`**：`src/main/` 下无本地声明的 payload / result / progress 接口，各 handler 的 `payload` 参数统一标注共享层的 `*Payload`（账号的 `AccountRegisterPayload` / `AccountLoginPayload` 同样如此）。
11. **运行时依赖由 electron-builder 自动收集，不要手写 `node_modules` 白名单**：新增 `dependencies` 后仍要复核 `npm run pack && npx asar list …`。
12. **「无限循环」有两道各自独立的闸**：渲染入口那道在 `video.ts`（命中 `repeat: -1` 直接拒绝渲染）；预览那道在 `projects/previewScript.ts` 的 `HG_PREVIEW_CTRL.clock()`（超长时长降级为 `unknown: true`，界面显示 `--:--`）。提示词侧是上游预防，三道加起来才是完整闭环。
13. **账号域的错误码不要并进 `errors.ts`**：`AccountErrorCode` 是后端业务码的镜像、要驱动界面分流，文案由 `account/api.ts` 的 `FALLBACK_MESSAGE` 兜底；`friendlyError()` 只服务「模型 / 语音 / 文件系统」那类原始英文报错。

---

## 6. 相关文档

- 逐文件说明：[files/main/](./files/main/)
- 账号域（目录级一篇）：[files/main/account.md](./files/main/account.md)
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- IPC 契约全貌：[01-架构总览.md](./01-架构总览.md) 第 3 节

## 附录 · 角色与账号的现状（与上文冲突时以本节为准）

- **`account/` 目录（3 个文件，合计 393 行）**：`api.ts` **221**（HTTP 客户端 + 14 条兜底文案 + 7 条业务码直通 + 10 秒超时 + `X-Device-Name`）、`store.ts` **96**（safeStorage 加密写 `userData/account.bin`，不可用只存内存）、`index.ts` **76**（`register(_ctx)` 5 条频道 + `currentToken()` + `devCode` 只在未打包时透出 + 401 才清令牌 + 退出先撤销服务端再清本地）。**频道总数 111、分组 13**（新增第 13 组 `Account` 5 条），preload **14 个命名空间**（`accountTools` 5 个方法）。
- **`cast/` 目录（9 个文件，合计 1409 行）**：`library.ts` **241**（全局角色库 + 删角色连带清专属动作）、`table.ts` 158、`preview.ts` 151、`inject.ts` 54、`edit.ts` 48、**`presets.ts` 172**（内置 14 条公共动作）、**`actions.ts` 256**（动作库）、**`demo.ts` 263**（示范页）、`index.ts` **66**（**37** 个具名导出）。
- **`projects/`（16 个文件，合计 2371 行）**：`store.ts` **239**、`prompts.ts` **369**、`ipc/cast.ts` **224**、**`ipc/castActions.ts` 162**（5 条动作频道）、`ipc/html.ts` **249**、`htmlWrite.ts` 127、`chaptersFlow.ts` 192、`paths.ts` 57、`register.ts` **19**（装配五个域）。角色频道在 `Cast` 组（11 条），`Project` 组仍是 27 条。
- **`agent/`（8 个文件）**：`chat.ts` 265 / `chatLog.ts` 155 / `html.ts` **229** / **`constants.ts` 368** / `htmlEdit.ts` 52 / `script.ts` **342** / **`castAction.ts` 44** / `index.ts` 21。
- **`main/index.ts`（实测 551 行）**：`USER_PREVIEW_DIRS = ['tts-output','voice','cast-preview']`；`hgpreview` 的 userData 路由除 `?tts=1` 外也认 **`?user=1`**；注册顺序 **settings → account → projects → agent(registerScript) → voice → video → whisper → updater → runtime**。
