# 05 · 目录架构：`src/shared/`（三端共享层）

> 全应用唯一的「契约层」：IPC 频道名、跨进程载荷类型、错误文案映射表，以及品牌文案 / 成片画布尺寸 / 项目素材白名单等应用级常量。它没有自己的运行时产物（构建时被内联进 main / preload / renderer 三端），但决定了三端能否对齐。

---

## 1. 文件清单

| 文件 | 行数 | 角色 |
|---|---|---|
| [ipc.ts](./files/shared/ipc.ts.md) | 138 | IPC 频道名常量（10 个分组、**87** 个频道）+ `IpcChannel` 类型 |
| [types.ts](./files/shared/types.ts.md) | 936 | 跨进程载荷类型（12 小节）：通用 IPC 结果 `IpcFail` / `IpcResult<T>`（失败分支含可选的 `detail` 排障详情、**`needConfig` / `title` 两个配置类字段**）、`RegisterCtx`、设置（含**按厂家的 `VoiceSettings` / `VoiceProviderConfig`（只有 `apiKey`）**、渲染档位与更新设置）、应用自更新（`UpdateCheckResult.message` 必填 + `detail` 可选）、运行环境（**分包**：`RuntimePackName` / `RuntimePackState` / `RuntimePhase` / `RuntimeProgressPayload`；`IpcFail.needPacks` 与 `IpcResult` 成功分支的可选 `message`）、历史数据目录（`LegacyDataInfo` / `LegacyResolveAction` / `LegacyResolveResult`）、音色与配音（含 `VoiceProviderView`；`VoiceCreatePayload.audioPath` 可为本地路径 / 公网 URL / `data:audio/...` URI，本地文件裁 15 秒后走复刻接口的 `input.url`；`VoiceCreateResult` 已收缩为 `{ voice, targetModel }`）、语音识别、项目与字幕（**项目素材库 `ProjectMaterialKind` / `ProjectMaterial` 与素材三件套载荷 / `ProjectMaterialsResult`**）、预览/转视频、进度推送，以及 `PreloadApi`（`window.*` 契约唯一真源）；其中 `ProjectHtmlMaterials` 的 `videoPath` 已换成 **`materialIds?: string[]`** 并删掉 `audioPath`（背景音轨由主进程注入 HTML），`Project.videoMaterial` 退化为**历史字段**（保留声明只为不改动已隐藏入口的 `extract-video-audio` handler），`ProjectSetVideoResult` 已删除；`ConfigTarget = 'model' \| 'voice'` 定义在 `RuntimePackName` 之后（**没有 `'billing'`**：余额类不弹窗） |
| [errors.ts](./files/shared/errors.ts.md) | 225 | **全应用「原始报错 → 人话文案」唯一映射表**：`friendlyError(err, ctx)` / `configTargetOf(message)` / `configTitle(target)` + 类型 `FriendlyError` / `ErrorContext`；纯函数、无副作用、不 import electron；十档固定顺序判定，配置类带 `needConfig`（**余额 / 欠费不弹窗**，走内嵌状态行）（详见 `docs/error-mapping.md`） |
| [constants.ts](./files/shared/constants.ts.md) | 70 | 应用级公共常量：品牌文案 `APP_NAME`（`'影坊'`）/ `APP_NAME_EN`（`'ShadowMill'`）/ `APP_SLOGAN` / `APP_SLOGAN_SHORT`、出网请求标识 `APP_USER_AGENT`（`APP_NAME_EN + '/1.0'`）、**项目素材三常量** `MAX_MATERIALS`（`20`，图片 + 视频合计上限）/ `IMAGE_MATERIAL_EXTS` / `VIDEO_MATERIAL_EXTS`，以及**成片画布四常量** `RENDER_CANVASES`（`['landscape', 'portrait', 'square']`）/ `CANVAS_SIZES`（横屏 `1920×1080`、竖屏 `1080×1920`、方形 `1080×1080`）/ `CANVAS_LABELS`（`'横屏 16:9'` / `'竖屏 9:16'` / `'方形 1:1'`）/ `DEFAULT_CANVAS`（`'landscape'`） |

> 前两个文件是**契约**（频道名与载荷格式禁止改动）；`errors.ts` 是**纯函数映射表**（不含业务状态，改它不影响任何频道名或载荷格式，但改文案会同时影响 main 与 renderer 的显示）；`constants.ts` 是**文案、请求标识、成片画布尺寸与素材规则**，改它不影响任何频道名或载荷格式（但改素材常量 / 画布尺寸等于改产品规则：前者同时约束主进程校验与界面提示，后者必须与 HyperFrames CLI 的画布预设对齐，对不上成片会退回 CLI 的兜底 `portrait`）。

---

## 2. `ipc.ts` —— 频道常量

以冻结对象字面量导出（`as const`），按业务域分 10 组：

| 分组 | 频道数 | 频道 |
|---|---|---|
| `Window` | 4 | `window:minimize`、`window:toggle-maximize`、`window:close`、`window:maximized-change` |
| `App` | 1 | `app:copy-text`（曾有一条 `app:open-external`「去充值」外链频道，已按用户要求整条摘除，见 [shared/errors.ts.md](./files/shared/errors.ts.md) §6） |
| `Update` | 9 | `update:check`、`update:download`、`update:cancel`、`update:install`、`update:version`、**`update:status`**、`update:open-log`、**`update:changelog`**、`update:progress` |
| `Settings` | 6 | `settings:get`、`settings:save`、`settings:save-render`、`settings:save-updater`、`settings:test`、**`settings:pick-runtime-pack`** |
| `Voice` | 19 | `voice:get-config`、`voice:get-save-dir`、`voice:save-config`、`voice:pick-audio`、`voice:create`、`voice:list-system-voices`、`voice:list-models`、`voice:get-profiles`、`voice:save-profile`、`voice:delete-profile`、**`voice:delete-cloud`**、`voice:list`、`voice:list-all`、`voice:pick-dir`、`voice:list-generated`、`voice:synth`、`voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| `Whisper` | 12 | `whisper:status`、`whisper:download`、`whisper:delete`、`whisper:set-current`、`whisper:add-model`、`whisper:update-model`、`whisper:remove-model`、`whisper:open-dir`、`whisper:project-audio`、`whisper:pick-audio`、`whisper:transcribe`、`whisper:progress` |
| `Project` | 26 | `project:list`、`project:create`、`project:load`、`project:save-subtitle`、`project:save-content`、`project:generate-html`、`project:modify-html`、`project:download-html`、`project:export-srt`、`project:open-folder`、`project:open-folder-of`、`project:delete`、`project:save-video`、`project:set-render`、**`project:set-canvas`**、`project:pick-audio`、`project:set-audio`、`project:clear-audio`、**`project:pick-media`**、**`project:add-materials`**、**`project:save-materials`**、`project:extract-video-audio`、`project:read-html`、`project:preview-html`、`project:save-html`、`project:html-progress` |
| `Video` | 4 | `dialog:open-html`、`video:show-in-folder`、`video:render`、`video:progress` |
| `Runtime` | 4 | `runtime:status`、`runtime:prepare`（载荷 `packs?: RuntimePackName[]`，省略 = 全部）、**`runtime:cancel`**、`runtime:progress` |
| `Legacy` | 2 | `legacy:status`、`legacy:resolve`（历史数据目录：问一次「有没有 / 是什么」+ 回传处置选择；**没有推送频道**，界面在渲染层） |

合计 **87** 个频道（Window 4 + App 1 + Update 9 + Settings 6 + Voice 19 + Whisper 12 + Project 26 + Video 4 + Runtime 4 + Legacy 2）。

**本轮改动是「3 换 3」**：`project:pick-video` / `project:set-video` / `project:clear-video` 下线，`project:pick-media` / `project:add-materials` / `project:save-materials` 上线（`Project` 组当时仍是 25、合计当时是 85）。三个新频道分别对应素材库的「选文件」「复制入库 + 登记」「整份列表回写（移除与勾选共用）」；`project:extract-video-audio` **保留**，但它的界面入口本轮临时下线（handler 仍读历史字段 `proj.videoMaterial`）。**此后两轮各净增 1 条**：`update:changelog`（`Update` 组 8 → 9，见本节第 3 点）与成片画布的 `project:set-canvas`（`Project` 组 25 → 26）⇒ 合计 85 → **87**。

四个容易踩的点：

1. **`IPC.Video.OpenHtml` 的值是 `'dialog:open-html'`**，不是 `video:` 前缀 —— 历史遗留，改它会同时打断主进程与 preload 两侧，属于「不可顺手统一」的项。
2. **`IpcChannel` 类型是分组对象的并集**（`(typeof IPC)[keyof typeof IPC]`），即「`Window` 对象 | `App` 对象 | …」，而不是频道字符串的并集。它用于约束「必须传入 IPC 分组对象」，不要误当作字符串联合类型使用。
3. **`Update.OpenLog`（`update:open-log`）排在 `Version` 与 `Progress` 之间**（2026-10 新增）：它是「打开 `userData/updater.log` 所在位置」的排障出口，主进程侧**刻意不经过 `ensureUpdater()`**——更新失败时最常见的场景恰恰是 electron-updater 没加载起来，若挂在懒加载之后就打不开日志了。
4. **「去充值」外链频道曾加过、又整条删掉**：`App.OpenExternal`（`app:open-external`）只服务配置类弹窗上的「去充值」按钮，而那个按钮**从未被用户同意过**，已按用户要求整条摘除。余额 / 欠费改为走内嵌状态行（文案说明去厂家控制台充值），因此 `ConfigTarget` 里也**没有 `'billing'`**——「弹窗」与「去设置能修好」严格等价。

约束（源码注释明确写着）：频道名与现行实现逐一对应，**禁止改动**；preload 的 11 命名空间与渲染层调用全部依赖这些字面量。

---

## 3. `types.ts` —— 跨进程载荷类型

按 12 个小节组织（源码注释的编号 ①～⑨，其中穿插 ③.5 / ③.6 / ⑧b 三个补充小节）：

| 小节 | 内容 | 代表类型 |
|---|---|---|
| ① 通用 IPC 结果 | 全部 `{ ok, ... }` 结果的形状 | `IpcFail`（`ok:false` + 可选 `message` / `detail` / `canceled` / **`needPacks`**——运行环境缺包时回给界面的包名数组；**`needConfig`**——配置类错误的目标分类、**`title`**——配置类弹窗标题（**余额 / 欠费不在此列**：那类不弹窗））、`IpcResult<T> = ({ ok: true; message?: string } & T) \| IpcFail`（**取代**旧版只存在于 `preload/index.d.ts` 内部的 `OkResult` / `FailResult`；成功分支的 `message` 供取消、幂等复用、**素材「部分成功」**等场景给一句话回执）；`ConfigTarget = 'model' \| 'voice'` 定义在文件最前 |
| ② 主进程装配上下文 | `register(ctx)` 的能力面 | `RegisterCtx`（`getWindow: () => BrowserWindow \| null`） |
| ③ 设置 | `userData/settings.json` 的完整 schema 与 `settings:*` 载荷 | `CustomModelConfig`、**`VoiceSettings` + `VoiceProviderConfig`**、`VoiceTTSConfig`（旧结构，仅迁移来源）、`VoiceProfile`、`VoiceProfileType`、`VoiceProfileInput`、`WhisperCustomModel`、`WhisperSettings`、`UpdaterSettings`、`AppSettings`、`SettingsSaveResult` |
| ③.5 应用自更新 | `update:*` 的检查结果与进度载荷 | `UpdateCheckState`、`UpdateCheckResult`（**`message` 必填** + 可选 `detail`）、`UpdateStage`、`UpdateProgressPayload`（含可选 `detail`） |
| ③.6 运行环境（分包） | 包名、单包状态、阶段与进度载荷 | `RuntimePackName`（`'ffmpeg' \| 'hyperframes'`，定义在文件最前）、`RuntimePackState`、`RuntimePhase`、`RuntimeProgressPayload`（**旧的 `stage` / `id` 字段已删**） |
| ⑧b 历史数据目录 | 旧数据扫描结论与处置契约 | `LegacyDataInfo`（`dir` / `entries` / `projects`）、`LegacyResolveAction`、`LegacyResolveResult` |
| ④ 音色与配音 | 系统/克隆音色、映射、合成与逐句对齐 | `SystemVoice`、`SystemVoiceItem`、`VoiceModel`、`VoiceListItem`、`VoiceCreateResult`、`VoiceSynthResult`、`VoiceAlignPayload`、`VoiceAlignResult` |
| ⑤ 语音识别 | whisper 模型状态与转录 | `WhisperModelItem`、`WhisperStatusResult`、`WhisperTranscribePayload`、`WhisperTranscribeResult` |
| ⑥ 项目与字幕 | `project.json`、**项目素材库**、字幕行、HTML 生成载荷 | `Scene`、`ContentScript`、`Project`（含 `materials?` / `canvas?` 与历史字段 `videoMaterial?`）、**`ProjectMaterialKind`、`ProjectMaterial`（`id` / `kind` / `file` / `label` / `selected` / `addedAt`）**、`SubtitleLine`、`ProjectMeta`、**`ProjectPickMediaPayload`、`ProjectAddMaterialsPayload`、`ProjectSaveMaterialsPayload`、`ProjectMaterialsResult`**、**`ProjectSetCanvasPayload`**（`name?` / `canvas?`）、`ProjectAgentPayload`、`ProjectHtmlMaterials`（`subtitleProject?` / **`materialIds?`**）、`ProjectHtmlResult`（`ProjectSetVideoResult` 已删除） |
| ⑦ 预览 / 转视频 | 渲染载荷与结果、进度 | `VideoRenderPayload`（渲染档位 `quality?` / `fps?` + **项目属性 `canvas?`**）、`VideoRenderResult`（失败分支含可选 **`needPacks?`**）、`VideoProgressPayload` |
| ⑧ 进度推送 | 6 路 main → renderer 推送载荷 | `HtmlProgressPayload`、`WhisperProgressPayload`、`AlignProgressPayload`、`VideoProgressPayload`、`UpdateProgressPayload`、`RuntimeProgressPayload` |
| ⑨ `window.*` 契约 | 11 个命名空间的完整方法签名 | `PreloadApi`（唯一真源；`projectTools` 含**素材三件套 `pickMedia` / `addMaterials` / `saveMaterials`** 与 **`setCanvas(name, canvas)`**（写成片画布方向），`updateTools` 含 `status` 与 `openLog`，`settingsTools` 含 `pickRuntimePack()`，`runtimeTools` = `status()` / `prepare(packs?)` / `cancel()` / `onProgress()`，`legacyTools` 对应旧数据处置，**`appTools` = `copyText()`**） |

五条关键约定：

1. **载荷格式禁止改动**：线上载荷必须与现行实现逐字段一致；设置文件已落盘在用户 `userData`，改字段名等于丢配置。项目结构新增字段一律**可选**（如 `Project.materials?` / `Project.canvas?`），并由主进程读盘时规范化（`normalizeMaterials()` 把缺失 / 非法值收敛为合法列表），因此老项目不受影响。
2. **「结构类型再导出」保引用面**：`src/main/projects.ts` 用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发四个项目结构，`src/renderer/src/composables/useAppStore.ts` 用 `export type { ProjectMeta }` 转发列表项类型 —— `projects.Project` / `from './projects'` 等既有引用不需要改，但结构只定义一处（本文件）。
3. **「本地类型」已清空**：`src/main/` 下不再有任何本地声明的 payload / result / progress 接口，各 IPC handler 的 `payload` 参数一律标注共享层的 `*Payload` 类型（本轮新增的 `ProjectPickMediaPayload` / `ProjectAddMaterialsPayload` / `ProjectSaveMaterialsPayload` 同样如此）。
4. **`message` / `detail` 分两层**：`IpcFail` 有可选 `detail`；`UpdateCheckResult` 的 `message` 是**必填**（主进程单点产出的用户文案）、`detail` 可选；`UpdateProgressPayload` 的 `detail` 仅 `error` 阶段非空。约定是 **`message` 说人话给终端用户、`detail` 存原始报错给排障**（UI 用「查看详情」折叠展示）。
5. **配置类错误再分一层**：`needConfig` / `title` 由主进程 `src/shared/errors.ts` 的 `friendlyError()` 单点产出。与 `needPacks` 的区别是**它不驱动流程**：`needPacks` 要用户下载完环境再「继续」重发本操作，`needConfig` 只是一个「去哪修」的分流标记，界面据此把错误从内嵌状态行升级成弹窗（`[去设置]` / `[取消]`，刻意**不显示**「查看详情」）。**余额 / 欠费刻意不给 `needConfig`**。这两个字段是**可选**的：preload 是纯转发，因此**加这两个字段不需要改 preload**。

---

## 4. `constants.ts` —— 应用级公共常量（品牌文案 + 成片画布尺寸 + 素材白名单唯一来源）

纯字面量模块（零副作用；顶部只有一处 `import type { RenderCanvas } from './types'`——纯类型导入不产生运行时代码），导出 **12 个常量**（6 个字符串 + 1 个数字 + 3 个字符串数组 + 2 个 `Record`）：

| 常量 | 值 | 用途 |
|---|---|---|
| `APP_NAME` | `'影坊'` | 中文显示名：窗口标题、`App.vue` 标题栏、启动画面 `.boot-title`、首页 hero 角标 |
| `APP_NAME_EN` | `'ShadowMill'` | 英文名：与 `package.json` 的 `build.productName` 一致，也是 `APP_USER_AGENT` 的前缀 |
| `APP_SLOGAN` | `'一站式音视频创作流水线'` | 首页主标题 `<h1>` |
| `APP_SLOGAN_SHORT` | `'音视频创作流水线'` | 启动画面副标题（窄位，去掉「一站式」） |
| `APP_USER_AGENT` | `APP_NAME_EN + '/1.0'` | 主进程出网请求的 `User-Agent`（whisper 模型下载） |
| **`MAX_MATERIALS`** | `20` | **项目素材合计上限**（图片 + 视频一起算）：主进程 `project:add-materials` 据此跳过超限文件、`normalizeMaterials()` 据此截断；渲染层 `MaterialsSection.vue` 用它显示 `n / 20` |
| **`IMAGE_MATERIAL_EXTS`** | `['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']` | 图片素材白名单：`project:pick-media` 的过滤项（图片分支同时开 `multiSelections`）、`materialKindOf()` 判类型、渲染层显示支持格式 |
| **`VIDEO_MATERIAL_EXTS`** | `['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi']` | 视频素材白名单：同上（视频单选）；与原来的单个视频素材完全一致 |
| **`RENDER_CANVASES`** | `['landscape', 'portrait', 'square']` | **成片画布三档**（本项目只暴露 1080 三档，CLI 另有 4k 三档）：主进程 `video.ts` / `projects.ts` 与渲染层 `utils/render.ts` 都拿它当**白名单**和下拉选项来源 |
| **`CANVAS_SIZES`** | `landscape: { width: 1920, height: 1080 }`、`portrait: { width: 1080, height: 1920 }`、`square: { width: 1080, height: 1080 }` | 每个画布的实际像素（= composition 尺寸 = 成片尺寸）：注入 `<html data-resolution>` 时留痕、写进生成提示词、预览 iframe 的内联宽高与缩放比都按它算 |
| **`CANVAS_LABELS`** | `landscape: '横屏 16:9'`、`portrait: '竖屏 9:16'`、`square: '方形 1:1'` | 画布的界面 / 提示词文案：放这里而不是各处自己拼，否则「界面选的」与「告诉模型的」会对不上 |
| **`DEFAULT_CANVAS`** | `'landscape'` | 项目没设 `canvas` 时用的画布（老项目因此保持原有 16:9 观感）；主进程白名单校验失败、渲染层 `normalizeCanvas()` 遇到脏数据都落到它 |

素材三常量的取值理由（源码注释逐字）：上限按「图片 + 视频合计」算，因为素材会逐个写进 Agent 提示词并成为页面元素，数量一多提示词过长、生成质量与渲染耗时都会明显变差，**20 是权衡后的取值**；图片白名单收 `svg` 是因为矢量图做图标 / 装饰最省体积且不涉及解码器；视频白名单**与原来的单个视频素材一致**（本轮没有扩大视频格式范围）。

成片画布四常量的取值理由（源码注释逐字）：取值与尺寸必须与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 对齐（本项目只暴露 1080 三档）；放在 shared 是因为**三个消费点必须用同一组数**——① 主进程往渲染入口注入 `<html data-resolution>`（`src/main/video.ts`）② 主进程把它写进生成提示词（`src/main/projects.ts` 的 `【画布】` 块）③ 渲染层选项表与预览 iframe（`renderer/utils/render.ts`、`pages/HtmlGenPage/PreviewSection.vue`）；`DEFAULT_CANVAS = 'landscape'` 的理由是应用内预览画布历来 16:9、首页也写着「1080P 导出」，老项目因此保持原有观感——此前「成片莫名变竖屏」正是因为缺这个确定值（CLI 在页面没声明画布时兜底 `portrait`）。

**品牌文案的三条到达路径**（本文件只有一处来源，但消费方能否 `import` TS 不同）：

1. **直接 import**：`src/main/whisper.ts`（`APP_USER_AGENT`）、`App.vue`（`APP_NAME`）、`HomePage/index.vue`（`APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN`）、**`src/main/projects.ts`（素材三常量）**、**`src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue`（素材三常量）**。
2. **HTML 占位符 + 构建期注入**：`src/renderer/index.html` 是静态标记，写 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()`（`transformHtml`，`order: 'pre'`）在 dev/build 期替换成常量值。
3. **只能校验，不能注入**：`package.json` 的 `build.productName`（JSON 无法 import TS），由同一配置文件的 `checkBrandConsistency()` 与 `APP_NAME_EN` 比对，不一致时 `console.warn('[dsh:brand] …')`。

**改品牌名的完整清单**（源码头部注释）：① 本文件；② `package.json` 的 `productName` / `description` / `appId`；③ `src/renderer/index.html`（无需改，占位符自动生效）；④ 渲染层组件（无需改，直接 import）。

**两点刻意排除在清单外**：

- 渲染层 `localStorage` 的 `'myapp.*'` 键名**故意不跟随品牌名**（prod 下 `file://` 同源，键名就是用户数据地址，改名会丢「上次项目 / 设置页分类记忆」），定义在 `src/renderer/src/constants.ts`，改前缀必须补迁移。
- 版本号不在本层：一律运行时取 `app.getVersion()`（设置页经 `window.updateTools.version()`）。

与 `ipc.ts` / `types.ts` 的定位差别：后两者属「IPC 契约」（禁止改动），`constants.ts` 属「文案、请求标识、成片画布尺寸与素材规则」——改它不影响任何频道名与载荷格式，但**素材常量同时约束主进程校验与界面提示**、**画布常量同时约束生成提示词 / 预览画布 / 渲染入口三处**，改动等于改产品规则。

---

## 5. 消费方与编译期归属

| 消费方 | 引入方式 | 归属 tsconfig |
|---|---|---|
| `src/main/*.ts` | `import { IPC } from '../shared/ipc'`、`import type { … } from '../shared/types'`（10 个模块引入类型；`projects.ts` 还再导出四个项目结构）；`whisper.ts` 另有 `import { APP_USER_AGENT } from '../shared/constants'`，**`projects.ts` 另有 `import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, IMAGE_MATERIAL_EXTS, MAX_MATERIALS, RENDER_CANVASES, VIDEO_MATERIAL_EXTS } from '../shared/constants'`**、**`video.ts` 另有 `import { CANVAS_SIZES, DEFAULT_CANVAS, RENDER_CANVASES } from '../shared/constants'`**；`errors.ts` 的消费方是 `htmlAgent.ts` / `settings.ts` / `voice.ts` / `projects.ts` | `tsconfig.node.json`（`include: src/shared/**/*.ts`，`paths: @shared/*`） |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`（构建时内联）+ `import type { AlignProgressPayload, HtmlProgressPayload, PreloadApi, RenderCanvas, RenderOverride, RuntimePackName, RuntimeProgressPayload, UpdateProgressPayload, VideoRenderPayload, WhisperProgressPayload } from '../shared/types'`；**不 import `errors.ts`**（错误分类只随 IPC 载荷转发） | `tsconfig.node.json` |
| `src/preload/index.d.ts` | `import type { PreloadApi } from '../shared/types'`，再 `interface Window extends PreloadApi {}`（**本轮无需改动**：素材三件套只是换掉 `PreloadApi` 里的成员） | `tsconfig.web.json` |
| `src/renderer/src/**` | 主要经 `window.*` 类型（由 `index.d.ts` 挂载）；如需共享类型/常量可用别名 `@shared/*`（如 `useAppStore.ts` 的 `import type { ProjectMaterial, ProjectMeta } from '@shared/types'`、**`MaterialsSection.vue` 的 `import { IMAGE_MATERIAL_EXTS, MAX_MATERIALS, VIDEO_MATERIAL_EXTS } from '@shared/constants'` + `import type { ProjectMaterial, ProjectMaterialKind } from '@shared/types'`**、**`utils/render.ts` 的 `import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, RENDER_CANVASES } from '@shared/constants'`**（`HtmlGenPage/index.vue` 与 `PreviewSection.vue` 经它取值）、`App.vue` 的 `import { APP_NAME } from '@shared/constants'`、`useConfigPrompt.ts` 的 `import type { ConfigTarget } from '@shared/types'`） | `tsconfig.web.json`（`include: src/shared/**/*.ts`，`paths: @shared/*`） |
| `electron.vite.config.ts` | `import { APP_NAME, APP_NAME_EN, APP_SLOGAN_SHORT } from './src/shared/constants'`（构建配置是**第四个**消费端：注入 HTML 占位符 + 校验 `productName`） | `tsconfig.node.json`（本配置文件被其 `include` 纳入） |

构建期行为：

- main / preload 使用 `externalizeDepsPlugin()`，但**相对路径** import（即 `../shared/*`）会被打包器内联进产物，因此 `out/main/index.js`、`out/preload/index.js` 里没有对 `shared` 的运行时依赖；常量同样被内联，三端各持副本。
- `errors.ts` 是纯 TS 相对导入，会被内联进 `out/main/index.js`；渲染层**不复制这份码表**——配置类的判定在主进程做，渲染层只读 IPC 回传的 `needConfig` 分类（避免两套正则漂移）。
- 渲染层别名 `@shared` → `src/shared` 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 中**两处**声明，新增别名需同步。

---

## 6. 维护约定

1. **新增 / 删除 IPC 都必须三处齐改**：`shared/ipc.ts` 加（删）频道常量 → 主进程对应 `register()` 内 `ipcMain.handle/on` → preload 命名空间加（删）方法，并在 `shared/types.ts` ⑨ 节 `PreloadApi` 同步签名（`index.d.ts` 只做 `extends`，无需再改）。**本轮素材库就是这个流程的正反两半一起走**：新增 `PickMedia` / `AddMaterials` / `SaveMaterials` 三处齐加，同时把 `PickVideo` / `SetVideo` / `ClearVideo` 三处齐删；`ProjectSetVideoResult` 这类只服务旧接口的结果类型也一并删除。参照历史：`app:open-external` 曾三处齐加、又三处齐删。**成片画布的 `project:set-canvas` 同样走完这条流程**：`shared/ipc.ts` 加常量 → `src/main/projects.ts` 加 handler → `src/preload/index.ts` 加 `setCanvas` → `shared/types.ts` ⑨ 节同步签名（`index.d.ts` 只做 `extends`，不用改）。
2. **往 `IpcFail` 加字段不需要 preload 参与**：preload 只做 `ipcRenderer.invoke` 转发、原样返回主进程对象，因此 `needConfig` / `title` 这两个字段只在 `shared/types.ts`（声明）、主进程（写入）、渲染层（读取）三处出现。
3. **不要在本层放业务逻辑**：只放常量、类型与**纯函数**映射（`errors.ts` 是唯一的函数实现）；素材的校验 / 复制 / 截断等实现放在 `src/main/projects.ts`（`normalizeMaterials()` / `copyMaterialIntoProject()` / `materialKindOf()`），本层只提供白名单与上限这些**数据**。
4. **类型与实现同源**：`PreloadApi`（⑨ 节）是唯一真源 —— `preload/index.ts` 用 `PreloadApi['<命名空间>']` 标注实现、`preload/index.d.ts` 用 `interface Window extends PreloadApi` 交给渲染层；不要再在别处复制一份方法签名。
5. **载荷类型不再宽松**：语音 / whisper / 项目的复杂入参已从 `Record<string, unknown>` 收敛为具名 `*Payload`；**素材回写载荷是刻意的例外**——`ProjectSaveMaterialsPayload.materials?: unknown`，因为渲染层提交的是完整列表、主进程必须自己规范化后才能信任它（写成 `ProjectMaterial[]` 会给人「已经校验过」的错觉）。
6. **品牌文案只有一处来源**：改应用名走 `constants.ts` §4 的清单；不要在组件里再写字面量、也不要往 `localStorage` 键名上带品牌名。
7. **失败结果优先给两层**：新增会失败的 IPC 时，`message` 写用户能读懂的一句话，技术细节放可选 `detail`。**「部分成功」也走 `message`**：`project:add-materials` 在跳过若干文件时仍回 `ok: true`，把「已添加 N 个，跳过 M 个」放在 `message` 里。
8. **错误文案统一出口是 `errors.ts`**：新的「外部服务 / 本机文件」报错一律经 `friendlyError()` 翻译，不要在各模块里再写一套 `if / else if` 正则链；只有调用方**只剩一句已翻译的中文文案**时才用 `configTargetOf()` 补分类。改这里之前先看 `docs/error-mapping.md`。

---

## 7. 相关文档

- 逐文件说明：[files/shared/](./files/shared/)（`ipc.ts` / `types.ts` / `errors.ts` / `constants.ts` 各一篇）
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 频道总表（含方向与消费方）：[01-架构总览.md](./01-架构总览.md) 第 3.3 节
- 品牌注入实现：[root/electron.vite.config.ts.md](./files/root/electron.vite.config.ts.md)
- 错误映射设计文档：`docs/error-mapping.md`（仓库内，非 wiki）
