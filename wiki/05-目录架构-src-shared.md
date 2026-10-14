# 05 · 目录架构：`src/shared/`（三端共享层）

> 全应用唯一的「契约层」：IPC 频道名、跨进程载荷类型，以及品牌文案等应用级常量。它没有自己的运行时产物（构建时被内联进 main / preload / renderer 三端），但决定了三端能否对齐。

---

## 1. 文件清单

| 文件 | 行数 | 角色 |
|---|---|---|
| [ipc.ts](./files/shared/ipc.ts.md) | 132 | IPC 频道名常量（10 个分组、**85** 个频道）+ `IpcChannel` 类型 |
| [types.ts](./files/shared/types.ts.md) | 851 | 跨进程载荷类型（12 小节）：通用 IPC 结果 `IpcFail` / `IpcResult<T>`（失败分支含可选的 `detail` 排障详情）、`RegisterCtx`、设置（含**按厂家的 `VoiceSettings` / `VoiceProviderConfig`（只有 `apiKey`）**、渲染档位与更新设置）、应用自更新（`UpdateCheckResult.message` 必填 + `detail` 可选）、运行环境（**分包**：`RuntimePackName` / `RuntimePackState` / `RuntimePhase` / `RuntimeProgressPayload`；`IpcFail.needPacks` 与 `IpcResult` 成功分支的可选 `message`）、历史数据目录（`LegacyDataInfo` / `LegacyResolveAction` / `LegacyResolveResult`）、音色与配音（含 `VoiceProviderView`；`VoiceCreatePayload.audioPath` 可为本地路径 / 公网 URL / `data:audio/...` URI，本地文件裁 15 秒后走复刻接口的 `input.url`；`VoiceCreateResult` 已收缩为 `{ voice, targetModel }`）、语音识别、项目与字幕、预览/转视频、进度推送，以及 `PreloadApi`（`window.*` 契约唯一真源）；其中 `ProjectHtmlMaterials` 已删 `audioPath`（背景音轨由主进程注入 HTML），`ProjectSetAudioResult` 增加可选 `htmlUpdated` |
| [constants.ts](./files/shared/constants.ts.md) | 30 | 应用级公共常量：品牌文案 `APP_NAME`（`'影坊'`）/ `APP_NAME_EN`（`'ShadowMill'`）/ `APP_SLOGAN` / `APP_SLOGAN_SHORT` 与出网请求标识 `APP_USER_AGENT`（`APP_NAME_EN + '/1.0'`） |

> 前两个文件是**契约**（频道名与载荷格式禁止改动）；`constants.ts` 是**文案与请求标识**，改它不影响任何频道名或载荷格式。

---

## 2. `ipc.ts` —— 频道常量

以冻结对象字面量导出（`as const`），按业务域分 10 组：

| 分组 | 频道数 | 频道 |
|---|---|---|
| `Window` | 4 | `window:minimize`、`window:toggle-maximize`、`window:close`、`window:maximized-change` |
| `App` | 1 | `app:copy-text` |
| `Update` | 8 | `update:check`、`update:download`、`update:cancel`、`update:install`、`update:version`、**`update:status`**、`update:open-log`、`update:progress` |
| `Settings` | 6 | `settings:get`、`settings:save`、`settings:save-render`、`settings:save-updater`、`settings:test`、**`settings:pick-runtime-pack`** |
| `Voice` | 19 | `voice:get-config`、`voice:get-save-dir`、`voice:save-config`、`voice:pick-audio`、`voice:create`、`voice:list-system-voices`、`voice:list-models`、`voice:get-profiles`、`voice:save-profile`、`voice:delete-profile`、**`voice:delete-cloud`**、`voice:list`、`voice:list-all`、`voice:pick-dir`、`voice:list-generated`、`voice:synth`、`voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| `Whisper` | 12 | `whisper:status`、`whisper:download`、`whisper:delete`、`whisper:set-current`、`whisper:add-model`、`whisper:update-model`、`whisper:remove-model`、`whisper:open-dir`、`whisper:project-audio`、`whisper:pick-audio`、`whisper:transcribe`、`whisper:progress` |
| `Project` | 25 | `project:list`、`project:create`、`project:load`、`project:save-subtitle`、`project:save-content`、`project:generate-html`、`project:modify-html`、`project:download-html`、`project:export-srt`、`project:open-folder`、`project:open-folder-of`、`project:delete`、`project:save-video`、`project:set-render`、`project:pick-audio`、`project:set-audio`、`project:clear-audio`、`project:pick-video`、`project:set-video`、`project:clear-video`、`project:extract-video-audio`、`project:read-html`、`project:preview-html`、`project:save-html`、`project:html-progress` |
| `Video` | 4 | `dialog:open-html`、`video:show-in-folder`、`video:render`、`video:progress` |
| `Runtime` | 4 | `runtime:status`、`runtime:prepare`（载荷 `packs?: RuntimePackName[]`，省略 = 全部）、**`runtime:cancel`**、`runtime:progress` |
| `Legacy` | 2 | `legacy:status`、`legacy:resolve`（历史数据目录：问一次「有没有 / 是什么」+ 回传处置选择；**没有推送频道**，界面在渲染层） |

合计 **85** 个频道（Window 4 + App 1 + Update 8 + Settings 6 + Voice 19 + Whisper 12 + Project 25 + Video 4 + Runtime 4 + Legacy 2）。

三个容易踩的点：

1. **`IPC.Video.OpenHtml` 的值是 `'dialog:open-html'`**，不是 `video:` 前缀 —— 历史遗留，改它会同时打断主进程与 preload 两侧，属于「不可顺手统一」的项。
2. **`IpcChannel` 类型是分组对象的并集**（`(typeof IPC)[keyof typeof IPC]`），即「`Window` 对象 | `App` 对象 | …」，而不是频道字符串的并集。它用于约束「必须传入 IPC 分组对象」，不要误当作字符串联合类型使用。
3. **`Update.OpenLog`（`update:open-log`）排在 `Version` 与 `Progress` 之间**（2026-10 新增）：它是「打开 `userData/updater.log` 所在位置」的排障出口，主进程侧**刻意不经过 `ensureUpdater()`**——更新失败时最常见的场景恰恰是 electron-updater 没加载起来，若挂在懒加载之后就打不开日志了。

约束（源码注释明确写着）：频道名与现行实现逐一对应，**禁止改动**；preload 的 11 命名空间与渲染层调用全部依赖这些字面量。

---

## 3. `types.ts` —— 跨进程载荷类型

按 12 个小节组织（源码注释的编号 ①～⑨，其中穿插 ③.5 / ③.6 / ⑧b 三个补充小节）：

| 小节 | 内容 | 代表类型 |
|---|---|---|
| ① 通用 IPC 结果 | 全部 `{ ok, ... }` 结果的形状 | `IpcFail`（`ok:false` + 可选 `message` / `detail` / `canceled` / **`needPacks`**——运行环境缺包时回给界面的包名数组）、`IpcResult<T> = ({ ok: true; message?: string } & T) \| IpcFail`（**取代**旧版只存在于 `preload/index.d.ts` 内部的 `OkResult` / `FailResult`；成功分支的 `message` 供取消、幂等复用等场景给一句话回执） |
| ② 主进程装配上下文 | `register(ctx)` 的能力面 | `RegisterCtx`（`getWindow: () => BrowserWindow \| null`） |
| ③ 设置 | `userData/settings.json` 的完整 schema 与 `settings:*` 载荷 | `CustomModelConfig`、**`VoiceSettings` + `VoiceProviderConfig`**、`VoiceTTSConfig`（旧结构，仅迁移来源）、`VoiceProfile`、`VoiceProfileType`、`VoiceProfileInput`、`WhisperCustomModel`、`WhisperSettings`、`UpdaterSettings`、`AppSettings`、`SettingsSaveResult` |
| ③.5 应用自更新 | `update:*` 的检查结果与进度载荷 | `UpdateCheckState`、`UpdateCheckResult`（**`message` 必填** + 可选 `detail`）、`UpdateStage`、`UpdateProgressPayload`（含可选 `detail`） |
| ③.6 运行环境（分包） | 包名、单包状态、阶段与进度载荷 | `RuntimePackName`（`'ffmpeg' \| 'hyperframes'`，定义在文件最前）、`RuntimePackState`（`'ready' \| 'missing' \| 'unknown'`）、`RuntimePhase`（`idle \| checking \| downloading \| extracting \| ready \| cancelled \| error`）、`RuntimeProgressPayload`（`phase` / `pack` / `percent` / `packs` / `missing` / `status` / `message` / `detail?` / `source` / `bytes` / `unpackedBytes` / `files` / `cancellable`；**旧的 `stage` / `id` 字段已删**） |
| ⑧b 历史数据目录 | 旧数据扫描结论与处置契约 | `LegacyDataInfo`（`dir` / `entries` / `projects`）、`LegacyResolveAction`（`'migrate' \| 'delete' \| 'later'`）、`LegacyResolveResult`（`ok` / `action` / `moved?` / `skipped?` / `failed?` / `message?`） |
| ④ 音色与配音 | 系统/克隆音色、映射、合成与逐句对齐 | `SystemVoice`、`SystemVoiceItem`、`VoiceModel`、`VoiceListItem`、`VoiceCreateResult`、`VoiceSynthResult`、`VoiceAlignPayload`、`VoiceAlignResult` |
| ⑤ 语音识别 | whisper 模型状态与转录 | `WhisperModelItem`、`WhisperStatusResult`、`WhisperTranscribePayload`、`WhisperTranscribeResult` |
| ⑥ 项目与字幕 | `project.json`、字幕行、HTML 生成载荷 | `Scene`、`ContentScript`、`Project`、`SubtitleLine`、`ProjectMeta`、`ProjectAgentPayload`、`ProjectHtmlResult` |
| ⑦ 预览 / 转视频 | 渲染载荷与结果、进度 | `VideoRenderPayload`、`VideoRenderResult`（失败分支新增可选 **`needPacks?`**）、`VideoProgressPayload` |
| ⑧ 进度推送 | 6 路 main → renderer 推送载荷 | `HtmlProgressPayload`、`WhisperProgressPayload`、`AlignProgressPayload`、`VideoProgressPayload`、`UpdateProgressPayload`、`RuntimeProgressPayload` |
| ⑨ `window.*` 契约 | 11 个命名空间的完整方法签名 | `PreloadApi`（preload 实现与渲染层消费的唯一真源；`updateTools` 含 `status`（取一次常驻更新状态）与 `openLog`，`settingsTools` 新增 `pickRuntimePack()`（运行环境「从本地文件安装」），`runtimeTools` = `status()` / `prepare(packs?)` / `cancel()` / `onProgress()`，`legacyTools` 对应旧数据处置） |

四条关键约定：

1. **载荷格式禁止改动**：线上载荷必须与现行实现逐字段一致；设置文件已落盘在用户 `userData`，改字段名等于丢配置。
2. **「结构类型再导出」保引用面**：`src/main/projects.ts` 用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发四个项目结构，`src/renderer/src/composables/useAppStore.ts` 用 `export type { ProjectMeta }` 转发列表项类型 —— `projects.Project` / `from './projects'` 等既有引用不需要改，但结构只定义一处（本文件）。
3. **「本地类型」已清空**：`src/main/` 下不再有任何本地声明的 payload / result / progress 接口（可 `grep '^interface .*(Payload|Result|Progress|Info)' src/main` 验证为 0 命中），各 IPC handler 的 `payload` 参数一律标注共享层的 `*Payload` 类型。
4. **`message` / `detail` 分两层（2026-10 加入）**：`IpcFail` 新增可选 `detail`；`UpdateCheckResult` 的 `message` 是**必填**（主进程单点产出的用户文案）、`detail` 可选；`UpdateProgressPayload` 的 `detail` 仅 `error` 阶段非空。约定是 **`message` 说人话给终端用户、`detail` 存原始报错给排障**（UI 用「查看详情」折叠展示），因此 `message` 里不要出现 `latest.yml` / 存储桶 / `app-update.yml` 这类只有发布者才懂的词。

---

## 4. `constants.ts` —— 应用级公共常量（品牌文案唯一来源）

纯字面量模块（零 import、零副作用），导出 5 个字符串常量：

| 常量 | 值 | 用途 |
|---|---|---|
| `APP_NAME` | `'影坊'` | 中文显示名：窗口标题、`App.vue` 标题栏、启动画面 `.boot-title`、首页 hero 角标 |
| `APP_NAME_EN` | `'ShadowMill'` | 英文名：与 `package.json` 的 `build.productName` 一致（安装包与可执行文件名同此），也是 `APP_USER_AGENT` 的前缀 |
| `APP_SLOGAN` | `'一站式音视频创作流水线'` | 首页主标题 `<h1>` |
| `APP_SLOGAN_SHORT` | `'音视频创作流水线'` | 启动画面副标题（窄位，去掉「一站式」） |
| `APP_USER_AGENT` | `APP_NAME_EN + '/1.0'` | 主进程出网请求的 `User-Agent`（whisper 模型下载），便于对端统计与排查 |

**品牌文案的三条到达路径**（本文件只有一处来源，但消费方能否 `import` TS 不同）：

1. **直接 import**：`src/main/whisper.ts`（`APP_USER_AGENT`）、`App.vue`（`APP_NAME`）、`HomePage/index.vue`（`APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN`）。
2. **HTML 占位符 + 构建期注入**：`src/renderer/index.html` 是静态标记，写 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()`（`transformIndexHtml`，`order: 'pre'`）在 dev/build 期替换成常量值。
3. **只能校验，不能注入**：`package.json` 的 `build.productName`（JSON 无法 import TS），由同一配置文件的 `checkBrandConsistency()` 与 `APP_NAME_EN` 比对，不一致时 `console.warn('[dsh:brand] …')`。

**改品牌名的完整清单**（源码头部注释）：① 本文件；② `package.json` 的 `productName` / `description` / `appId`；③ `src/renderer/index.html`（无需改，占位符自动生效）；④ 渲染层组件（无需改，直接 import）。

**两点刻意排除在清单外**：

- 渲染层 `localStorage` 的 `'myapp.*'` 键名**故意不跟随品牌名**（prod 下 `file://` 同源，键名就是用户数据地址，改名会丢「上次项目 / 设置页分类记忆」），定义在 `src/renderer/src/constants.ts`，改前缀必须补迁移。
- 版本号不在本层：一律运行时取 `app.getVersion()`（设置页经 `window.updateTools.version()`）。

与 `ipc.ts` / `types.ts` 的定位差别：后两者属「IPC 契约」（禁止改动），`constants.ts` 属「文案与请求标识」，改它不影响任何频道名与载荷格式。

---

## 5. 消费方与编译期归属

| 消费方 | 引入方式 | 归属 tsconfig |
|---|---|---|
| `src/main/*.ts` | `import { IPC } from '../shared/ipc'`、`import type { … } from '../shared/types'`（10 个模块引入类型；`projects.ts` 还再导出四个项目结构）；`whisper.ts` 另有 `import { APP_USER_AGENT } from '../shared/constants'` | `tsconfig.node.json`（`include: src/shared/**/*.ts`，`paths: @shared/*`） |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`（构建时内联）+ `import type { AlignProgressPayload, HtmlProgressPayload, PreloadApi, RenderOverride, RuntimePackName, RuntimeProgressPayload, UpdateProgressPayload, WhisperProgressPayload } from '../shared/types'` | `tsconfig.node.json` |
| `src/preload/index.d.ts` | `import type { PreloadApi } from '../shared/types'`，再 `interface Window extends PreloadApi {}` | `tsconfig.web.json` |
| `src/renderer/src/**` | 主要经 `window.*` 类型（由 `index.d.ts` 挂载）；如需共享类型/常量可用别名 `@shared/*`（如 `useAppStore.ts` 的 `import type { ProjectMeta } from '@shared/types'`、`App.vue` 的 `import { APP_NAME } from '@shared/constants'`） | `tsconfig.web.json`（`include: src/shared/**/*.ts`，`paths: @shared/*`） |
| `electron.vite.config.ts` | `import { APP_NAME, APP_NAME_EN, APP_SLOGAN_SHORT } from './src/shared/constants'`（构建配置是**第四个**消费端：注入 HTML 占位符 + 校验 `productName`） | `tsconfig.node.json`（本配置文件被其 `include` 纳入） |

构建期行为：

- main / preload 使用 `externalizeDepsPlugin()`，但**相对路径** import（即 `../shared/*`）会被打包器内联进产物，因此 `out/main/index.js`、`out/preload/index.js` 里没有对 `shared` 的运行时依赖；常量同样被内联，三端各持副本。
- 渲染层别名 `@shared` → `src/shared` 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 中**两处**声明，新增别名需同步。

---

## 6. 维护约定

1. **新增 IPC 必须三处齐改**：`shared/ipc.ts` 加频道常量 → 主进程对应 `register()` 内 `ipcMain.handle/on`（载荷用本层的 `*Payload` 类型标注；`legacy:*` 是直接写在 `src/main/index.ts` 的 `createWindow()` 之后，同属这一环）→ preload 命名空间加方法，并在 `shared/types.ts` ⑨ 节 `PreloadApi` 补签名（`index.d.ts` 只做 `extends`，无需再改）。`update:open-log` 就是按这条流程加的：`ipc.ts` 加 `Update.OpenLog` → `updater.ts` 注册 handler → `preload/index.ts` 加 `openLog` → `PreloadApi.updateTools.openLog` 补签名；本轮的 `legacy:status` / `legacy:resolve` 同法（`ipc.ts` 加 `Legacy` 分组 → `main/index.ts` 注册两个 handler → preload 加 `legacyTools` → `PreloadApi.legacyTools` 补签名）；运行环境分包的 `runtime:cancel`（`runtime.ts` handler + `runtimeTools.cancel`）与 `settings:pick-runtime-pack`（`settings.ts` handler + `settingsTools.pickRuntimePack`）也是这条流程的实例，且都顺带在 `IpcFail` / 结果类型上补了 `needPacks`。
2. **不要在本层放业务逻辑**：只放常量与类型；任何函数实现都会同时进入 main 与 preload 两个 bundle，带来不必要的重复。
3. **类型与实现同源**：`PreloadApi`（⑨ 节）是唯一真源 —— `preload/index.ts` 用 `PreloadApi['<命名空间>']` 标注实现、`preload/index.d.ts` 用 `interface Window extends PreloadApi` 交给渲染层，因此「实现」与「渲染层签名」由同一份契约约束；不要再在别处复制一份方法签名（旧版 `index.d.ts` 内联签名的做法已废弃）。
4. **载荷类型不再宽松**：语音 / whisper / 项目的复杂入参已从 `Record<string, unknown>` 收敛为具名 `*Payload`（如 `VoiceSaveDirPayload`、`WhisperTranscribePayload`、`ProjectAgentPayload`），字段写错会在编译期暴露；确实需要动态字段时才用可选字段表达。
5. **品牌文案只有一处来源**：改应用名走 `constants.ts` §4 的清单（本文件 + `package.json` 三字段），不要在组件里再写字面量、也不要往 `localStorage` 键名上带品牌名。
6. **失败结果优先给两层**：新增会失败的 IPC 时，`message` 写用户能读懂的一句话，技术细节放可选 `detail`（原始报错 / HTTP 状态 / 请求地址），不要在 `message` 里塞堆栈或 URL；参考 `src/main/updater.ts` 的 `humanError()`。

---

## 7. 相关文档

- 逐文件说明：[files/shared/](./files/shared/)（`ipc.ts` / `types.ts` / `constants.ts` 各一篇）
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 频道总表（含方向与消费方）：[01-架构总览.md](./01-架构总览.md) 第 3.3 节
- 品牌注入实现：[root/electron.vite.config.ts.md](./files/root/electron.vite.config.ts.md)
