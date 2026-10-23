# 05 · 目录架构：`src/shared/`（三端共享层）

> 全应用唯一的「契约层」：IPC 频道名、跨进程载荷类型、错误文案映射表，以及品牌文案 / 成片画布尺寸 / 项目素材白名单 / 估时语速（4 字/秒，一个语速三处用）等应用级常量。它没有自己的运行时产物（构建时被内联进 main / preload / renderer 三端），但决定了三端能否对齐。

---

## 1. 文件清单

| 文件 | 行数 | 角色 |
|---|---|---|
| [ipc.ts](./files/shared/ipc.ts.md) | 160 | IPC 频道名常量（**11** 个分组、**100** 个频道）+ `IpcChannel` 类型 |
| [types.ts](./files/shared/types.ts.md) | 1113 | 跨进程载荷类型（12 小节）：通用 IPC 结果 `IpcFail` / `IpcResult<T>`（失败分支含可选的 `detail` 排障详情、`needConfig` / `title` 两个配置类字段）、`RegisterCtx`、设置（含**按厂家的 `VoiceSettings` / `VoiceProviderConfig`（只有 `apiKey`）**、渲染档位与更新设置）、应用自更新（`UpdateCheckResult.message` 必填 + `detail` 可选）、运行环境（**分包**：`RuntimePackName` / `RuntimePackState` / `RuntimePhase` / `RuntimeProgressPayload`；`IpcFail.needPacks` 与 `IpcResult` 成功分支的可选 `message`）、历史数据目录（`LegacyDataInfo` / `LegacyResolveAction` / `LegacyResolveResult`）、音色与配音（含 `VoiceProviderView`；`VoiceCreatePayload.audioPath` 可为本地路径 / 公网 URL / `data:audio/...` URI）、语音识别、项目与字幕（**项目素材库 `ProjectMaterialKind` / `ProjectMaterial` 与素材三件套载荷 / `ProjectMaterialsResult`**、**内容脚本 Agent 的 `ScriptGeneratePayload` / `ScriptGenerateReply`**、**对话记录的 `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`**）、预览/转视频、进度推送（**通用 `AgentStage` / `AgentProgressPayload` + 旧名别名 + `HtmlProgressPayload` / `ScriptProgressPayload` 都 `extends` 它**），以及 `PreloadApi`（`window.*` 契约唯一真源，**12 个命名空间**）；`ProjectHtmlMaterials` 的 `videoPath` 已换成 `materialIds?: string[]` 并删掉 `audioPath`（背景音轨由主进程注入 HTML），`Project.videoMaterial` 退化为**历史字段**，`ProjectSetVideoResult` 已删除；`ConfigTarget = 'model' \| 'voice'` 定义在 `RuntimePackName` 之后（**没有 `'billing'`**：余额类不弹窗） |
| [errors.ts](./files/shared/errors.ts.md) | 225 | **全应用「原始报错 → 人话文案」唯一映射表**：`friendlyError(err, ctx)` / `configTargetOf(message)` / `configTitle(target)` + 类型 `FriendlyError` / `ErrorContext`；纯函数、无副作用、不 import electron；十档固定顺序判定，配置类带 `needConfig`（**余额 / 欠费不弹窗**，走内嵌状态行）（详见 `docs/error-mapping.md`） |
| [constants.ts](./files/shared/constants.ts.md) | 89 | 应用级公共常量：品牌文案 `APP_NAME`（`'影坊'`）/ `APP_NAME_EN`（`'ShadowMill'`）/ `APP_SLOGAN` / `APP_SLOGAN_SHORT`、出网请求标识 `APP_USER_AGENT`（`APP_NAME_EN + '/1.0'`）、**项目素材三常量** `MAX_MATERIALS`（`20`，图片 + 视频合计上限）/ `IMAGE_MATERIAL_EXTS` / `VIDEO_MATERIAL_EXTS`、**成片画布四常量** `RENDER_CANVASES`（`['landscape', 'portrait', 'square']`）/ `CANVAS_SIZES`（横屏 `1920×1080`、竖屏 `1080×1920`、方形 `1080×1080`）/ `CANVAS_LABELS`（`'横屏 16:9'` / `'竖屏 9:16'` / `'方形 1:1'`）/ `DEFAULT_CANVAS`（`'landscape'`），以及**估时语速一常量 + 一纯函数** `EST_CHARS_PER_SEC`（`4`，字/秒；一个语速**三处消费方**）/ `estimateSubtitleDur(text)`（`max(2.4, 1.6 + 字数 ÷ 语速)`，**估时公式唯一真源**） |

> 前两个文件是**契约**（频道名与载荷格式禁止改动）；`errors.ts` 是**纯函数映射表**（不含业务状态，改它不影响任何频道名或载荷格式，但改文案会同时影响 main 与 renderer 的显示）；`constants.ts` 是**文案、请求标识、成片画布尺寸、素材规则与估时语速**，改它不影响任何频道名或载荷格式（但改素材常量 / 画布尺寸 / 估时语速等于改产品规则：素材常量同时约束主进程校验与界面提示，画布尺寸必须与 HyperFrames CLI 的画布预设对齐（对不上或被覆盖时成片会是 1080×1920，CLI 的兜底尺寸），估时语速同时改渲染层预览的字幕时长、主进程落盘 / 导出 / 逐句对齐用的时间轴、AI 面板的估算时长与脚本 Agent 提示词的字数预算）。

---

## 2. `ipc.ts` —— 频道常量

以冻结对象字面量导出（`as const`），按业务域分 **11 组**：

| 分组 | 频道数 | 频道 |
|---|---|---|
| `Window` | 4 | `window:minimize`、`window:toggle-maximize`、`window:close`、`window:maximized-change` |
| `App` | 1 | `app:copy-text`（曾有一条 `app:open-external`「去充值」外链频道，已按用户要求整条摘除，见 [shared/errors.ts.md](./files/shared/errors.ts.md) §6） |
| `Update` | 9 | `update:check`、`update:download`、`update:cancel`、`update:install`、`update:version`、`update:status`、`update:open-log`、`update:changelog`、`update:progress` |
| `Settings` | 6 | `settings:get`、`settings:save`、`settings:save-render`、`settings:save-updater`、`settings:test`、`settings:pick-runtime-pack` |
| `Voice` | 19 | `voice:get-config`、`voice:get-save-dir`、`voice:save-config`、`voice:pick-audio`、`voice:create`、`voice:list-system-voices`、`voice:list-models`、`voice:get-profiles`、`voice:save-profile`、`voice:delete-profile`、`voice:delete-cloud`、`voice:list`、`voice:list-all`、`voice:pick-dir`、`voice:list-generated`、`voice:synth`、`voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| `Whisper` | 12 | `whisper:status`、`whisper:download`、`whisper:delete`、`whisper:set-current`、`whisper:add-model`、`whisper:update-model`、`whisper:remove-model`、`whisper:open-dir`、`whisper:project-audio`、`whisper:pick-audio`、`whisper:transcribe`、`whisper:progress` |
| `Project` | **30** | `project:list`、`project:create`、`project:load`、`project:save-subtitle`、`project:save-content`、`project:generate-html`、`project:modify-html`、`project:download-html`、`project:export-srt`、`project:open-folder`、`project:open-folder-of`、`project:delete`、`project:save-video`、`project:set-render`、`project:set-canvas`、`project:pick-audio`、`project:set-audio`、`project:clear-audio`、`project:pick-media`、`project:add-materials`、`project:save-materials`、`project:extract-video-audio`、`project:read-html`、`project:preview-html`、`project:save-html`、**`project:cast-library`、`project:promote-cast`、`project:import-cast`、`project:remove-cast-from-library`（本轮新增的全局角色库四条）**、`project:html-progress` |
| **`Script`** | **7** | **`script:generate`（生成）/ `script:load-chat`（读索引）/ `script:append-round`（写副本 + 更新索引）/ `script:read-version`（读某版副本）/ `script:set-active-version`（改 active）/ `script:clear-chat`（删整个 chat/）——内容脚本 Agent 的六条 `ipcMain.handle`；外加 `script:progress`（main → renderer 进度推送）**。注释明确：**生成只产出文本、不写文件——场景落盘走 `project:save-content`**；chat 系列管的是**对话记录** `projects/<项目名>/chat/`（`index.json` 索引 + `versions/<id>.json` 每版副本） |
| `Video` | 4 | `dialog:open-html`、`video:show-in-folder`、`video:render`、`video:progress` |
| `Runtime` | 4 | `runtime:status`、`runtime:prepare`（载荷 `packs?: RuntimePackName[]`，省略 = 全部）、`runtime:cancel`、`runtime:progress` |
| `Legacy` | 2 | `legacy:status`、`legacy:resolve`（历史数据目录：问一次「有没有 / 是什么」+ 回传处置选择；**没有推送频道**，界面在渲染层） |

合计 **100** 个频道（Window 4 + App 1 + Update 9 + Settings 6 + Voice 19 + Whisper 12 + Project **32** + **Script 7** + Video 4 + Runtime 4 + Legacy 2）。

**本轮（全局角色库）是「一个功能加一批频道」的第一次**：`Project` 组 **26 → 30**、全库 **94 → 98**，**分组数仍是 11**、preload 命名空间仍是 **12**（四个方法挂在既有 `projectTools` 下）。

**Script 组是「先加一组、再扩到七条」**：先新增 `Script` 分组（`Generate` / `Progress`），分组数 **10 → 11**、频道数 **87 → 89**；随后为对话记录补 `LoadChat` / `SaveChat`（组内 **2 → 4**、全库 **89 → 91**）；本轮对话记录改成「索引 + 每版副本」后，两条 `load-chat` / `save-chat` 扩成五条 chat handler（`LoadChat` / `AppendRound` / `ReadVersion` / `SetActiveVersion` / `ClearChat`），`Script` 组 **4 → 7**、全库 **91 → 94**（**分组数仍是 11**）。`Script` 的位置在 `Project` 之后、`Video` 之前，顺序与主进程的 `register()` 段（`projects.register(ctx)` → `agent.registerScript(projects.projectDir)` → `voice.register(ctx)`）呼应。历史净增记录保留：素材库「3 换 3」→ `update:changelog` → `project:set-canvas` → `script:*` 两条 → **对话记录扩到五条 chat handler** → **本轮角色库 4 条（94 → 98）**。

五个容易踩的点：

1. **`IPC.Video.OpenHtml` 的值是 `'dialog:open-html'`**，不是 `video:` 前缀 —— 历史遗留，改它会同时打断主进程与 preload 两侧，属于「不可顺手统一」的项。
2. **`IpcChannel` 类型是分组对象的并集**（`(typeof IPC)[keyof typeof IPC]`），即「`Window` 对象 | `App` 对象 | …」，而不是频道字符串的并集。它用于约束「必须传入 IPC 分组对象」，不要误当作字符串联合类型使用。
3. **`Update.OpenLog`（`update:open-log`）排在 `Version` 与 `Progress` 之间**：它是「打开 `userData/updater.log` 所在位置」的排障出口，主进程侧**刻意不经过 `ensureUpdater()`**——更新失败时最常见的场景恰恰是 electron-updater 没加载起来，若挂在懒加载之后就打不开日志了。
4. **「去充值」外链频道曾加过、又整条删掉**：`App.OpenExternal`（`app:open-external`）只服务配置类弹窗上的「去充值」按钮，而那个按钮**从未被用户同意过**，已按用户要求整条摘除。余额 / 欠费改为走内嵌状态行（文案说明去厂家控制台充值），因此 `ConfigTarget` 里也**没有 `'billing'`**——「弹窗」与「去设置能修好」严格等价。
5. **文件头注释已同步**：`src/shared/ipc.ts` 第 2 行现在写的是「preload **12 命名空间**与渲染层调用依赖它们」，与实际情况一致（含 `scriptTools`）。核数字时仍以 `PreloadApi`（⑨ 节）与实际 `contextBridge` 调用为准；命名空间或分组再增减时，这行注释与本文都要一起改。

约束（源码注释明确写着）：频道名与现行实现逐一对应，**禁止改动**；preload 的命名空间与渲染层调用全部依赖这些字面量。

---

## 3. `types.ts` —— 跨进程载荷类型

按 12 个小节组织（源码注释的编号 ①～⑨，其中穿插 ③.5 / ③.6 / ⑧b 三个补充小节）：

| 小节 | 内容 | 代表类型 |
|---|---|---|
| ① 通用 IPC 结果 | 全部 `{ ok, ... }` 结果的形状 | `IpcFail`（`ok:false` + 可选 `message` / `detail` / `canceled` / `needPacks`——运行环境缺包时回给界面的包名数组；`needConfig`——配置类错误的目标分类、`title`——配置类弹窗标题（**余额 / 欠费不在此列**：那类不弹窗））、`IpcResult<T> = ({ ok: true; message?: string } & T) \| IpcFail`（**取代**旧版只存在于 `preload/index.d.ts` 内部的 `OkResult` / `FailResult`；成功分支的 `message` 供取消、幂等复用、素材「部分成功」等场景给一句话回执）；`ConfigTarget = 'model' \| 'voice'` 定义在文件最前 |
| ② 主进程装配上下文 | `register(ctx)` 的能力面 | `RegisterCtx`（`getWindow: () => BrowserWindow \| null`） |
| ③ 设置 | `userData/settings.json` 的完整 schema 与 `settings:*` 载荷 | `CustomModelConfig`、`VoiceSettings` + `VoiceProviderConfig`、`VoiceTTSConfig`（旧结构，仅迁移来源）、`VoiceProfile`、`VoiceProfileType`、`VoiceProfileInput`、`WhisperCustomModel`、`WhisperSettings`、`UpdaterSettings`、`AppSettings`、`SettingsSaveResult` |
| ③.5 应用自更新 | `update:*` 的检查结果与进度载荷 | `UpdateCheckState`、`UpdateCheckResult`（`message` 必填 + 可选 `detail`）、`UpdateStage`、`UpdateProgressPayload`（含可选 `detail`） |
| ③.6 运行环境（分包） | 包名、单包状态、阶段与进度载荷 | `RuntimePackName`（`'ffmpeg' \| 'hyperframes'`）、`RuntimePackState`、`RuntimePhase`、`RuntimeProgressPayload`（旧的 `stage` / `id` 字段已删） |
| ⑧b 历史数据目录 | 旧数据扫描结论与处置契约 | `LegacyDataInfo`（`dir` / `entries` / `projects`）、`LegacyResolveAction`、`LegacyResolveResult` |
| ④ 音色与配音 | 系统/克隆音色、映射、合成与逐句对齐 | `SystemVoice`、`SystemVoiceItem`、`VoiceModel`、`VoiceListItem`、`VoiceCreateResult`、`VoiceSynthResult`、`VoiceAlignPayload`、`VoiceAlignResult` |
| ⑤ 语音识别 | whisper 模型状态与转录 | `WhisperModelItem`、`WhisperStatusResult`、`WhisperTranscribePayload`、`WhisperTranscribeResult` |
| ⑥ 项目与字幕 | **`project.json` 索引（`ProjectIndex`）与完整视图 `Project`**、**项目素材库**、字幕行、HTML 生成载荷、**内容脚本 Agent 载荷**、**对话记录（索引元数据 / 索引 / 单版结果 / 追加载荷）** | `Scene`、`ContentScript`、`Project`、`ProjectIndex`、`ProjectMaterialKind` / `ProjectMaterial` / 素材三件套载荷 / `ProjectMaterialsResult`、`SubtitleLine`、`ProjectMeta`、`ProjectSetCanvasPayload`、`ProjectAgentPayload`、`ProjectHtmlMaterials`、`ProjectHtmlResult`、**`ScriptGeneratePayload`、`ScriptGenerateReply`（紧跟 `ProjectHtmlResult` 之后，带 `// ===== 内容脚本 Agent（script:generate）=====` 小标题）**、**`ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`（带 `// ===== 内容脚本对话记录（按项目持久化）=====` 小标题）** |
| ⑦ 预览 / 转视频 | 渲染载荷与结果、进度 | `VideoRenderPayload`（渲染档位 `quality?` / `fps?` + **项目属性 `canvas?`**）、`VideoRenderResult`（失败分支含可选 `needPacks?`）、`VideoProgressPayload` |
| ⑧ 进度推送 | 源码小标题为「**5 路** main → renderer，均为单订阅语义」 | **通用层**：`AgentStage`（`'connecting' \| 'thinking' \| 'writing' \| 'retry' \| 'done'`）、`AgentProgressPayload`（`stage` / `thinkChars` / `contentChars` / `thinkText`）；**旧名别名**：`HtmlAgentStage = AgentStage`、`HtmlAgentProgress = AgentProgressPayload`；**两个 extends 变体**：`HtmlProgressPayload extends AgentProgressPayload { text: string }`、`ScriptProgressPayload extends AgentProgressPayload { text: string }`；另有 `WhisperProgressPayload`、`AlignProgressPayload`、`VideoProgressPayload` |
| ⑨ `window.*` 契约 | **12** 个命名空间的完整方法签名 | `PreloadApi`（唯一真源；`projectTools` 含素材三件套 `pickMedia` / `addMaterials` / `saveMaterials` 与 `setCanvas(name, canvas)`、`onHtmlProgress`；**`scriptTools` = `generate(payload)` / `loadChat(name)` / `appendRound(payload)` / `readVersion(name, versionId)` / `setActiveVersion(name, versionId)` / `clearChat(name)` / `onProgress(cb)`（**7 个成员**）**；`updateTools` 含 `status` 与 `openLog`；`settingsTools` 含 `pickRuntimePack()`；`runtimeTools` = `status()` / `prepare(packs?)` / `cancel()` / `onProgress()`；`legacyTools` 对应旧数据处置；`appTools` = `copyText()`） |

**⑧ 的「5 路」要会读**：它指的是**⑧ 节里定义的 5 个进度载荷类型**（html / script / whisper / align / video）。`UpdateProgressPayload` 在 ③.5、`RuntimeProgressPayload` 在 ③.6，因此**整层进度通道实际是 7 路**（html / script / whisper / align / video / runtime / update）；preload 头注释的「6 个进度推送通道」指其中**有单订阅标志的 6 路**（不含直接 `ipcRenderer.on` 的 video）。三个数字口径不同，别混用。

**⑨ 节头部注释已同步**：源码现在写的是「**12 个命名空间 ↔ 11 组频道常量**」，与 `PreloadApi` 实际定义、`src/shared/ipc.ts` 的实际分组一致。

本轮 `Script*` 类型的形状（逐字）：

```ts
export interface ScriptGeneratePayload {
  name: string
  request: string
  scenes: Scene[]
  sceneCount?: number
  targetSeconds?: number
}
export type ScriptGenerateReply =
  | { ok: true; scenes: Scene[]; totalChars: number; message?: string }
  | { ok: false; message: string; raw?: string; needConfig?: ConfigTarget; title?: string }
```

对话记录的四个类型（逐字）：

```ts
export interface ScriptChatRoundMeta {
  id: string
  // 用户原话
  request: string
  // 该轮脚本副本的 id（对应 chat/versions/<versionId>.json）
  versionId: string
  totalChars: number
  sceneCount: number
  ts: number
}
export interface ScriptChatIndex {
  rounds: ScriptChatRoundMeta[]
  // 当前已应用到编辑器的那一版（没有则为空串）
  activeVersionId: string
}
// script:read-version 的返回：某一版的完整场景
export interface ScriptVersionResult {
  scenes: Scene[]
}
// script:append-round 的载荷：用户这条要求 + 本轮产出的场景（主进程负责写副本并更新索引）
export interface ScriptAppendRoundPayload {
  name: string
  round: { id: string; request: string; totalChars: number; ts: number }
  scenes: Scene[]
}
```

`ScriptAppendRoundPayload.round` 刻意只用内联对象（不含 `versionId` / `sceneCount`）：这两项由主进程在写副本时确定（`versionId` 现生成、`sceneCount` 取落盘后的场景数），渲染层给不了也不该给。

五条关键约定：

1. **载荷格式禁止改动**：线上载荷必须与现行实现逐字段一致；设置文件已落盘在用户 `userData`，改字段名等于丢配置。项目结构新增字段一律**可选**（如 `Project.materials?` / `Project.canvas?`），并由主进程读盘时规范化（`normalizeMaterials()` 把缺失 / 非法值收敛为合法列表），因此老项目不受影响。
2. **「结构类型再导出」保引用面**：`src/main/projects.ts` 用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发四个项目结构，`src/renderer/src/composables/useAppStore.ts` 用 `export type { ProjectMeta }` 转发列表项类型 —— `projects.Project` / `from './projects'` 等既有引用不需要改，但结构只定义一处（本文件）。
3. **「本地类型」已清空**：`src/main/` 下不再有任何本地声明的 payload / result / progress 接口，各 IPC handler 的 `payload` 参数一律标注共享层的 `*Payload` 类型（`src/main/agent/script.ts` 的 `payload?: ScriptGeneratePayload` 同样如此）。
4. **`message` / `detail` 分两层**：`IpcFail` 有可选 `detail`；`UpdateCheckResult` 的 `message` 是**必填**、`detail` 可选；约定是 **`message` 说人话给终端用户、`detail` 存原始报错给排障**（UI 用「查看详情」折叠展示）。
5. **配置类错误再分一层**：`needConfig` / `title` 由主进程 `src/shared/errors.ts` 的 `friendlyError()` 单点产出。与 `needPacks` 的区别是**它不驱动流程**：`needPacks` 要用户下载完环境再「继续」重发本操作，`needConfig` 只是一个「去哪修」的分流标记。**余额 / 欠费刻意不给 `needConfig`**。这两个字段是**可选**的：preload 是纯转发，因此**加这两个字段不需要改 preload**。

---

## 4. `constants.ts` —— 应用级公共常量（品牌文案 + 成片画布尺寸 + 素材白名单 + 估时语速唯一来源）

纯字面量 + 一个纯函数模块（零副作用；顶部只有一处 `import type { RenderCanvas } from './types'`——纯类型导入不产生运行时代码），导出 **13 个常量 + 1 个纯函数**（6 个字符串 + 2 个数字 + 3 个字符串数组 + 2 个 `Record` + `estimateSubtitleDur()`），**共 89 行**：

| 常量 | 值 | 用途 |
|---|---|---|
| `APP_NAME` | `'影坊'` | 中文显示名：窗口标题、`App.vue` 标题栏、启动画面 `.boot-title`、首页 hero 角标 |
| `APP_NAME_EN` | `'ShadowMill'` | 英文名：与 `package.json` 的 `build.productName` 一致，也是 `APP_USER_AGENT` 的前缀 |
| `APP_SLOGAN` | `'一站式音视频创作流水线'` | 首页主标题 `<h1>` |
| `APP_SLOGAN_SHORT` | `'音视频创作流水线'` | 启动画面副标题（窄位，去掉「一站式」） |
| `APP_USER_AGENT` | `APP_NAME_EN + '/1.0'` | 主进程出网请求的 `User-Agent`（whisper 模型下载） |
| `MAX_MATERIALS` | `20` | 项目素材合计上限（图片 + 视频一起算）：主进程 `project:add-materials` 据此跳过超限文件、`normalizeMaterials()` 据此截断；渲染层 `MaterialsSection.vue` 用它显示 `n / 20` |
| `IMAGE_MATERIAL_EXTS` | `['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']` | 图片素材白名单：`project:pick-media` 的过滤项、`materialKindOf()` 判类型 |
| `VIDEO_MATERIAL_EXTS` | `['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi']` | 视频素材白名单：同上（视频单选）；与原来的单个视频素材完全一致 |
| `RENDER_CANVASES` | `['landscape', 'portrait', 'square']` | **成片画布三档**（本项目只暴露 1080 三档，CLI 另有 4k 三档）：主进程 `video.ts` / `projects.ts` 与渲染层 `utils/render.ts` 都拿它当**白名单**和下拉选项来源 |
| `CANVAS_SIZES` | `landscape: {1920,1080}`、`portrait: {1080,1920}`、`square: {1080,1080}` | 每个画布的实际像素（= composition 尺寸 = 成片尺寸）：写进渲染入口的**舞台 `data-width`/`data-height`**（成片宽高真正来源，CLI 读不到就兜底 1080×1920）与 `<html data-resolution>` 时留痕、写进生成提示词、预览 iframe 的内联宽高与缩放比都按它算 |
| `CANVAS_LABELS` | `landscape: '横屏 16:9'`、`portrait: '竖屏 9:16'`、`square: '方形 1:1'` | 画布的界面 / 提示词文案：放这里而不是各处自己拼，否则「界面选的」与「告诉模型的」会对不上 |
| `DEFAULT_CANVAS` | `'landscape'` | 项目没设 `canvas` 时用的画布（老项目因此保持原有 16:9 观感）；主进程白名单校验失败、渲染层 `normalizeCanvas()` 遇到脏数据都落到它 |
| `EST_CHARS_PER_SEC` | `4` | **估时语速（字/秒）**，一个语速三处用：① `estimateSubtitleDur()` 的分母（渲染层字幕页经 `helpers.ts` 的 `estDur`、主进程 `parseSubtitle`）② 内容脚本页「AI 创作」结果卡的「估算时长」= `totalChars ÷ 它`（`AiChatPanel.vue` → `ScriptRoundCard.vue` 的 `charsPerSecond`）③ 脚本 Agent 提示词的字数预算（`agent/script.ts` 的「目标总时长 × 它」）。上一轮取 3、更早是 `0.15` 秒/字 ≈ 6.7 字/秒（老系数，套到整段场景旁白上快一倍） |
| `estimateSubtitleDur(text)` | `(text: string) => number` | **估时公式唯一真源**：`max(2.4, 1.6 + 字数 / EST_CHARS_PER_SEC)`；渲染层 `SubtitlePage/helpers.ts` 把它再导出为 `estDur`，主进程 `projects.ts` 的 `parseSubtitle` 直接调用 |

素材三常量的取值理由（源码注释逐字）：上限按「图片 + 视频合计」算，因为素材会逐个写进 Agent 提示词并成为页面元素，数量一多提示词过长、生成质量与渲染耗时都会明显变差，**20 是权衡后的取值**；图片白名单收 `svg` 是因为矢量图做图标 / 装饰最省体积且不涉及解码器；视频白名单**与原来的单个视频素材一致**。

成片画布四常量的取值理由（源码注释逐字）：取值与尺寸必须与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 对齐（本项目只暴露 1080 三档）；放在 shared 是因为**三个消费点必须用同一组数**——① 主进程往渲染入口注入**舞台 `data-width`/`data-height`（成片宽高真正来源；CLI 只认它，读不到就兜底 1080×1920）**与 `<html data-resolution>`（只做页面自描述，渲染链路不读；`src/main/video.ts`）② 主进程把它写进生成提示词（`src/main/projects.ts` 的【画布】块）③ 渲染层选项表与预览 iframe（`renderer/utils/render.ts`、`pages/HtmlGenPage/PreviewSection.vue`）；`DEFAULT_CANVAS = 'landscape'` 的理由是应用内预览画布历来 16:9、首页也写着「1080P 导出」。

**估时语速一常量 + 一函数的取值理由**：同一条规则原先在**两个进程里各写了一遍**（渲染层 `SubtitlePage/helpers.ts` 的 `estDur`、主进程 `parseSubtitle` 里内联的 `0.15` 系数），而内容脚本页另写了一个 4.5 的本地语速常量（已删除）、脚本 Agent 提示词再写一遍 4.5——三套口径各自漂移。放到 shared 后三处 `import` 同一份，改一处三处同时生效。语速取 **4 字/秒**（一个语速三处用：字幕估时 / 面板估算时长 / 提示词字数预算）——口径变化实测：93 字单段 **24.85s**（上一轮取 3 时 32.6s、最初 `0.15` 秒/字时 15.55s）；用户项目 8 场景（85~100 字）合计 **195.8s（3:15.8）**（上一轮 256.8s / 4:16.8、最初 122.6s / 2:02.6）；AI 面板 732 字显示 **183s（3:03）**；提示词 60 秒的字数预算 **240 字**（按 4.5 时是 270 字，约 −11%）。它只是**估时、不读音频**，要真实时长得走配音页的「字幕配音（逐句对齐）」；**渲染层界面文案也引用该常量、不写死数字**（字幕页提示行 `{{ EST_CHARS_PER_SEC }} 字/秒`、按钮 `title` 与 toast 都是拼接）。

**品牌文案的三条到达路径**（本文件只有一处来源，但消费方能否 `import` TS 不同）：

1. **直接 import**：`src/main/whisper.ts`（`APP_USER_AGENT`）、`App.vue`（`APP_NAME`）、`HomePage/index.vue`、`src/main/projects.ts`（素材三常量 + `estimateSubtitleDur`）、`src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue`、`src/renderer/src/pages/SubtitlePage/helpers.ts`（`estimateSubtitleDur`）、**`src/renderer/src/pages/SubtitlePage/index.vue`（`EST_CHARS_PER_SEC`）、`src/renderer/src/pages/ContentPage/AiChatPanel.vue`（`EST_CHARS_PER_SEC`）、`src/main/agent/script.ts`（`EST_CHARS_PER_SEC`）**。
2. **HTML 占位符 + 构建期注入**：`src/renderer/index.html` 写 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()`（`transformHtml`，`order: 'pre'`）在 dev/build 期替换。
3. **只能校验，不能注入**：`package.json` 的 `build.productName`（JSON 无法 import TS），由同一配置文件的 `checkBrandConsistency()` 与 `APP_NAME_EN` 比对，不一致时 `console.warn('[dsh:brand] …')`。

**改品牌名的完整清单**（源码头部注释）：① 本文件；② `package.json` 的 `productName` / `description` / `appId`；③ `src/renderer/index.html`（无需改，占位符自动生效）；④ 渲染层组件（无需改，直接 import）。

**两点刻意排除在清单外**：渲染层 `localStorage` 的 `'myapp.*'` 键名**故意不跟随品牌名**（prod 下 `file://` 同源，键名就是用户数据地址，改名会丢「上次项目 / 设置页分类记忆」），定义在 `src/renderer/src/constants.ts`；版本号不在本层（一律运行时取 `app.getVersion()`）。

---

## 5. 消费方与编译期归属

| 消费方 | 引入方式 | 归属 tsconfig |
|---|---|---|
| `src/main/*.ts` | `import { IPC } from '../shared/ipc'`、`import type { … } from '../shared/types'`；`whisper.ts` 另有 `APP_USER_AGENT`；`projects.ts` 另有素材 + 画布常量 + **`estimateSubtitleDur`**；`video.ts` 另有画布常量；**`agent/script.ts` 另有 `EST_CHARS_PER_SEC`（本轮新增，替代原来的本地语速常量 4.5，已删除）**；`errors.ts` 的消费方是 **`agent/chat.ts`** / `agent/html.ts`（经 `agent/chat.ts` 间接）/ `settings.ts` / `voice.ts` / `projects.ts` / **`agent/script.ts`（`configTargetOf`）** | `tsconfig.node.json` |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`（构建时内联）+ `import type { AlignProgressPayload, HtmlProgressPayload, PreloadApi, RenderCanvas, RenderOverride, RuntimePackName, RuntimeProgressPayload, **ScriptProgressPayload**, UpdateProgressPayload, VideoRenderPayload, WhisperProgressPayload } from '../shared/types'`；**不 import `errors.ts`**（错误分类只随 IPC 载荷转发） | `tsconfig.node.json` |
| `src/preload/index.d.ts` | `import type { PreloadApi } from '../shared/types'`，再 `interface Window extends PreloadApi {}`（**新增命名空间时它一行都不用改**） | `tsconfig.web.json` |
| `src/renderer/src/**` | 主要经 `window.*` 类型（由 `index.d.ts` 挂载）；如需共享类型/常量可用别名 `@shared/*`（如 `useAppStore.ts` 的 `ProjectMaterial` / `ProjectMeta`、`MaterialsSection.vue` 的素材常量、`utils/render.ts` 的画布常量、`App.vue` 的 `APP_NAME`、`useConfigPrompt.ts` 的 `ConfigTarget`、**`SubtitlePage/helpers.ts` 的 `estimateSubtitleDur`**、**`SubtitlePage/index.vue` / `ContentPage/AiChatPanel.vue` 的 `EST_CHARS_PER_SEC`**、`ContentPage/helpers.ts` 的 `type Scene` / `type ScriptChatRoundMeta` 与 `AiChatPanel.vue` / `ScriptRoundCard.vue` 的 `type Scene` / `type ScriptChatRoundMeta`） | `tsconfig.web.json` |
| `electron.vite.config.ts` | `import { APP_NAME, APP_NAME_EN, APP_SLOGAN_SHORT } from './src/shared/constants'`（构建配置是**第四个**消费端） | `tsconfig.node.json` |

构建期行为：

- main / preload 使用 `externalizeDepsPlugin()`，但**相对路径** import（即 `../shared/*`）会被打包器内联进产物，因此 `out/main/index.js`、`out/preload/index.js` 里没有对 `shared` 的运行时依赖；常量同样被内联，三端各持副本。
- `errors.ts` 是纯 TS 相对导入，会被内联进 `out/main/index.js`；渲染层**不复制这份码表**——配置类的判定在主进程做，渲染层只读 IPC 回传的 `needConfig` 分类（避免两套正则漂移）。
- 渲染层别名 `@shared` → `src/shared` 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 中**两处**声明，新增别名需同步。

---

## 6. 维护约定

1. **新增 / 删除 IPC 都必须三处齐改**：`shared/ipc.ts` 加（删）频道常量 → 主进程对应 `register()` 内 `ipcMain.handle/on` → preload 命名空间加（删）方法，并在 `shared/types.ts` ⑨ 节 `PreloadApi` 同步签名（`index.d.ts` 只做 `extends`，无需再改）。**`script:*` 走完了两遍这条流程**：先加 `Script` 分组（`Generate` / `Progress`）→ `src/main/agent/script.ts` 的 `registerScript(getProjectDir)` 挂 `script:generate` 并 `sender.send('script:progress')` → `src/preload/index.ts` 加 `scriptTools`（含单订阅 `onProgress`）→ ⑨ 节签名 + ⑥ 节两个载荷类型 + ⑧ 节 `ScriptProgressPayload`；**对话记录先加两条**（`script:load-chat` / `script:save-chat`）→ 同一个 `registerScript()` 里补两条 `ipcMain.handle`（读写下沉到 `src/main/agent/chatLog.ts`）→ preload 的 `scriptTools.loadChat` / `saveChat`；**本轮再把它扩成五条 chat handler**（`load-chat` / `append-round` / `read-version` / `set-active-version` / `clear-chat`，`save-chat` 下线）→ preload 的 `scriptTools` 变 7 个方法 → ⑥ 节换成 `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`（`ScriptChatRound` / `ScriptChatResult` 删除）。**频道总数 91 → 94、`Script` 组 4 → 7、分组数仍是 11。**
2. **往 `IpcFail` 加字段不需要 preload 参与**：preload 只做 `ipcRenderer.invoke` 转发、原样返回主进程对象，因此 `needConfig` / `title` 只在 `shared/types.ts`（声明）、主进程（写入）、渲染层（读取）三处出现。
3. **不要在本层放业务逻辑**：只放常量、类型与**纯函数**（`errors.ts` 的映射表与 `constants.ts` 的 `estimateSubtitleDur()` 是全层仅有的两处函数实现，都是纯函数、无副作用）；模型调用、脚本解析等实现放在 `src/main/`（`agent/chat.ts` / `agent/script.ts`），本层只给形状。
4. **类型与实现同源**：`PreloadApi`（⑨ 节）是唯一真源 —— `preload/index.ts` 用 `PreloadApi['<命名空间>']` 标注实现、`preload/index.d.ts` 用 `interface Window extends PreloadApi` 交给渲染层；不要再在别处复制一份方法签名。
5. **载荷类型不再宽松**：语音 / whisper / 项目的复杂入参已从 `Record<string, unknown>` 收敛为具名 `*Payload`；**素材回写载荷是刻意的例外**——`ProjectSaveMaterialsPayload.materials?: unknown`，因为渲染层提交的是完整列表、主进程必须自己规范化后才能信任它。
6. **品牌文案只有一处来源**：改应用名走 §4 的清单；不要在组件里再写字面量、也不要往 `localStorage` 键名上带品牌名。
7. **失败结果优先给两层**：新增会失败的 IPC 时，`message` 写用户能读懂的一句话，技术细节放可选 `detail`。**「部分成功」也走 `message`**：`project:add-materials` 在跳过若干文件时仍回 `ok: true`，把「已添加 N 个，跳过 M 个」放在 `message` 里。
8. **错误文案统一出口是 `errors.ts`**：新的「外部服务 / 本机文件」报错一律经 `friendlyError()` 翻译，不要在各模块里再写一套 `if / else if` 正则链；只有调用方**只剩一句已翻译的中文文案**时才用 `configTargetOf()` 补分类（`agent/script.ts` 就是这种情形）。改这里之前先看 `docs/error-mapping.md`。
9. **估时语速只有一处来源**：不要在渲染层或主进程再写 `4` / `4.5` / `0.15` 这类语速系数，也不要给「面板估算时长」「提示词字数预算」各留一份本地常数——三处都 `import` `EST_CHARS_PER_SEC`；字幕页的界面文案同样引用它，不写死数字。

---

## 7. 相关文档

- 逐文件说明：[files/shared/](./files/shared/)（`ipc.ts` / `types.ts` / `errors.ts` / `constants.ts` 各一篇）
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 频道总表（含方向与消费方）：[01-架构总览.md](./01-架构总览.md) 第 3.3 节
- 品牌注入实现：[root/electron.vite.config.ts.md](./files/root/electron.vite.config.ts.md)
- 错误映射设计文档：`docs/error-mapping.md`（仓库内，非 wiki）
