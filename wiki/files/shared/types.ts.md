# src/shared/types.ts

> 跨进程共享的 IPC 载荷与设置类型定义，三端（main / preload / 渲染层）唯一类型真源

- **所在目录**：`src/shared/`
- **类型**：共享类型（纯 `interface` / `type` 别名，无运行时代码）
- **规模**：**1333 行**（实测 `[IO.File]::ReadAllLines`；上一版实测 1244 行，本轮 **+89 行**：⑥ 节新增十个动作相关类型、⑨ 节 `castTools` 补 5 个方法签名。更早一轮 +15 行是：⑥ 节新增 **`ScriptCastRef`**（含 3 行注释，说明它**不是** `ProjectCastMember`：不落盘、不导入项目、不参与 HTML 生成的角色注入，只用于写稿）与 **`ScriptGeneratePayload.cast?: ScriptCastRef[]`**（空 / 缺省 = 提示词里没有【角色】块）。**而本轮动作示范改了 `src/shared/ipc.ts`**：`Cast` 组 6 → 11 条（新增动作 5 条），全库频道 101 → 106，分组数不变）
- **对外导出**：按 12 个小节组织（源码编号 ①～⑨，其中穿插 ③.5 / ③.6 / ⑧b 三个补充小节）—— ① 通用 IPC 结果 3 个（`IpcFail`、`IpcResult`、**`ConfigTarget`**）② 主进程装配上下文 1 个（`RegisterCtx`）③ 设置（含**思考强度 `ReasoningEffort`**、`UpdaterSettings`、`SettingsSaveUpdaterPayload`、渲染档位 `RenderQuality` / `RenderFps` / `RenderOptions` / `RenderOverride` 与**成片画布 `RenderCanvas`**）③.5 应用自更新 4 个（`UpdateCheckState`、`UpdateCheckResult`、`UpdateStage`、`UpdateProgressPayload`）③.6 运行环境（**分包**）4 个（`RuntimePackName`、`RuntimePackState`、`RuntimePhase`、`RuntimeProgressPayload`）⑧b 历史数据目录 3 个（`LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`）④ 音色与配音 ⑤ 语音识别 ⑥ 项目与字幕（含素材库 `ProjectMaterial*` 一族、**章节 `ProjectChapter` 与角色 `ProjectCastMember`（含 `selected?`）**、**全局角色库 `CastLibraryMember` / `CastLibraryResult` / `ProjectCastResult`**、**项目角色的三件套 `ProjectNewCastPayload` / `ProjectNewCastResult` / `ProjectSaveCastPayload`**、**角色预览 `ProjectCastPreviewPayload` / `ProjectCastPreviewResult`**、**`ScriptCastRef`（内容脚本写稿用的角色引用——不是项目角色）**、`ScriptGeneratePayload` / `ScriptGenerateReply` 与**对话记录的 `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`**）⑦ 预览 / 转视频 2 个（`VideoRenderPayload`——含 `canvas?`、`VideoRenderResult`）⑧ 进度推送（**通用：`AgentStage` / `AgentProgressPayload` + 旧名别名 `HtmlAgentStage` / `HtmlAgentProgress` + `HtmlProgressPayload`（**本轮加必填 `taskId`**）/ `ScriptProgressPayload` 两个 `extends` 变体**）⑨ `PreloadApi` 1 个（**12 个命名空间**）；另有 ① 节 `IpcFail.needPacks`（缺哪个运行环境包）与 `IpcFail.needConfig` / `title`（配置类错误）、⑨ 节 `settingsTools.pickRuntimePack`、**`projectTools` 的 4 个角色库成员**与 **`scriptTools` 的 7 个成员**、**动作示范的十个类型**（`CastActionKey` / `CastActionDef` / `CastActionListResult` / `CastActionScope` / `CastActionSavePayload` / `CastActionRemovePayload` / `CastActionGeneratePayload` / `CastActionResult` / `CastDemoPayload` / `CastDemoResult`）与 **`castTools` 的 5 个动作方法**（`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`）等

## 1. 作用与职责

本文件定义主进程、preload、渲染层三端共同使用的数据形状，并集中收敛原先散落在各处的类型声明：

1. **统一载荷格式**：IPC 两端对同一份数据（设置文件、音色条目、模型条目、项目结构、**项目素材**、**全局角色库条目**）使用完全相同的字段名与类型，避免「主进程叫 `voiceId`、渲染层叫 `voice_id`」这类漂移。
2. **统一 IPC 结果形状**：`IpcFail` / `IpcResult<T>` 是全部 `{ ok, ... }` 结果类型的唯一来源 —— 它们原先只在 `src/preload/index.d.ts` 内部以 `OkResult` / `FailResult` / `IpcResult` 三个未导出类型存在，现在上移到共享层并被主进程、preload、渲染层共同引用。
3. **描述持久化结构**：`CustomModelConfig` / `VoiceSettings`（含按厂家的 `VoiceProviderConfig`）/ `VoiceProfile` / `WhisperCustomModel` / `WhisperSettings` / `AppSettings` 共同构成 `userData/settings.json` 的完整 schema；旧的 `VoiceTTSConfig` 保留但**只作迁移来源**。
4. **定义 `window.*` 契约**：⑨ 节的 `PreloadApi` 用 **12** 个命名空间的完整方法签名描述「preload 实现 ↔ 渲染层消费」的唯一真源 —— `src/preload/index.ts` 用它标注各 `contextBridge` 对象，`src/preload/index.d.ts` 用它给 `Window` 补类型，因此两端不会再各自漂移。
5. **收敛主进程的本地类型**：`whisper.ts` / `voice/ttsAlign.ts` / `video.ts` / `agent/html.ts` / `voice/api.ts` / `projects.ts` / **`agent/chat.ts` / `agent/script.ts`** 原先各自声明过 `WhisperProgressPayload`、`AlignProgressInfo`、`RenderPayload` / `RenderResult`、`AgentProgress`、`VoiceModel`、`Scene` / `ContentScript` / `Project` / `SubtitleLine`，现在全部改为从本文件导入（`agent/html.ts` 保留 `AgentProgress` 这一导出名，但它已是 `AgentProgressPayload` 的类型别名；`projects.ts` 用 `export type { … } from '../shared/types'` 再导出，保持 `projects.Project` / `from './projects'` 的既有引用面）。**`src/main/` 下已不存在任何本地声明的 payload / result / progress 接口**，各 IPC handler 的 `payload` 参数也一律用本文件的 `*Payload` 类型标注（`agent/script.ts` 的 `payload?: ScriptGeneratePayload` 同样如此）。**`cast/library.ts` 也遵循这条**：它只有 `import type { ProjectCastMember }` 一个类型 import，不另立角色结构。
6. **区分「磁盘形状」与「完整视图」**：⑥ 节的 `Project` 是渲染层与主进程内部使用的**完整视图**（含字幕与内容脚本正文），而 `ProjectIndex` 是**磁盘上 `project.json` 的实际形状**（只有索引）——正文分别在 `subtitle.txt` 与 `content.json` 里，由 `projects.ts` 的 `ensureProject()` 把三者拼成 `Project`。`project:load` 交给渲染层的仍是 `Project`，因此契约不变。
7. **约束主进程装配模式**：`RegisterCtx` 把 `src/main/*.ts` 各模块 `register(ctx)` 所依赖的能力（拿主窗口）显式化。
8. **统一「配置类错误」的分类词表**：① 节的 `ConfigTarget`（`'model' | 'voice'`）与 `IpcFail` 的两个可选字段 `needConfig` / `title` 一起，把「这个失败是不是用户去设置页改配置就能解决」从各页面的正则猜测收敛成主进程单点产出的分类（判定实现见 `src/shared/errors.ts`，界面消费见 `src/renderer/src/composables/useConfigPrompt.ts`）。**余额 / 欠费刻意不在此列**：去设置改不了余额，它走内嵌状态行（`needConfig` 里也没有 `'billing'`）。

文件按 12 个小节组织（源码小节横幅依次为 ① ② ③ ③.5 ③.6 **⑧b** ④ ⑤ ⑥ ⑦ ⑧ ⑨——`⑧b 历史数据目录` 在这一版里被写在 ③.6 与 ④ 之间，是「旧数据处置」契约的补充小节），首行注释给出两条硬约束：**载荷格式必须与现行实现逐字段一致，禁止改结构**；**新增/修改 IPC 接口须三处齐改 —— 主进程 `register()` 回调、本文件类型、preload 桥接方法**（例外：只往 `IpcFail` 加**可选字段**时 preload 无需改动，见 §5）。文件为纯类型模块，编译后不产生任何运行时代码，仅 1 个 `import type`（引自 `electron`，用于 `BrowserWindow`）。

| 小节 | 覆盖内容 | 主要消费方 |
| --- | --- | --- |
| ① 通用 IPC 结果 | `ConfigTarget`、`IpcFail`、`IpcResult<T>` | `PreloadApi` 全体成员、各主进程模块的返回结构、`src/renderer/src/composables/useConfigPrompt.ts` |
| ② 主进程装配上下文 | `RegisterCtx` | `src/main/*.ts` 的 `register(ctx)` |
| ③ 设置 | `settings.json` 的 schema（含渲染档位 `render` 与更新设置 `updater`）与 `settings:*` / `voice:save-config` 载荷 | `src/main/settings.ts`、设置页、配音页 |
| ③.5 应用自更新 | `update:*` 的检查结果（`message` + `detail` 分层）与进度载荷 | `src/main/updater/`（目录，出口 `updater/index.ts`）、设置页 |
| ③.6 运行环境（分包） | `RuntimePackName`、`RuntimePackState`、`RuntimePhase`、`RuntimeProgressPayload`（包名、每包状态、阶段与下载 / 解包进度） | `src/main/runtime.ts`、设置页、`src/renderer/src/composables/useRuntime.ts`、`src/renderer/src/composables/useEnvGate.ts` |
| ⑧b 历史数据目录 | `LegacyDataInfo`（扫描结论）、`LegacyResolveAction`（三选一）、`LegacyResolveResult`（执行结果与迁移计数） | `src/main/index.ts`、`src/renderer/src/composables/useLegacyData.ts`、`src/renderer/src/components/LegacyDataDialog.vue` |
| ④ 音色与配音 | 系统音色、克隆音色、音色映射、合成/对齐载荷与结果 | `src/main/voice/api.ts`、`src/main/voice/ipc/*`、`src/main/voice/ttsAlign.ts` |
| ⑤ 语音识别 | whisper 模型状态、转录载荷与结果 | `src/main/whisper.ts` |
| ⑥ 项目与字幕 | **`project.json` 的磁盘形状 `ProjectIndex`（只有索引）**、**完整视图 `Project`（含正文，正文不在 `project.json` 里）**、渲染档位覆盖 `render`、素材库 `materials`、**素材条目与素材三件套载荷**、字幕行、项目列表项、HTML 生成载荷、**`ScriptCastRef`（AI 创作里选中的角色，只作提示词上下文）与内容脚本 Agent 载荷 `ScriptGeneratePayload` / `ScriptGenerateReply`**、**对话记录 `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`**、**全局角色库 `CastLibraryMember` / `CastLibraryResult` / `ProjectCastResult`（本轮新增）** | `src/main/projects.ts`、**`src/main/cast/library.ts`**、**`src/main/agent/script.ts`**、**`src/main/agent/chatLog.ts`**、`src/renderer/src/pages/HtmlGenPage/`（素材墙与**角色区 `CastSection.vue`**）、**`src/renderer/src/pages/ContentPage/`（AI 创作与对话记录）**、`src/renderer/src/composables/useAppStore.ts` |
| ⑦ 预览 / 转视频 | 渲染载荷与渲染结果 | `src/main/video.ts` |
| ⑧ 进度推送 | 进度载荷：**通用 `AgentStage` / `AgentProgressPayload`**（html / script 两个 Agent 共用）+ 旧名别名 + `HtmlProgressPayload` / `ScriptProgressPayload` / `WhisperProgressPayload` / `AlignProgressPayload` / `VideoProgressPayload` | `src/main/*.ts` 推送方 + `src/preload/index.ts` 订阅方 |
| ⑨ `window.*` API 契约 | `PreloadApi`（**13 个命名空间**） | `src/preload/index.ts`、`src/preload/index.d.ts`、渲染层全部 `window.*` 调用 |

## 2. 导出与关键实现

### 2.1 ① 通用 IPC 结果

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `ConfigTarget` | `type` | `'model' \| 'voice'`——**「配置类」错误的目标设置分类**，**定义在文件最前**（紧挨 `RuntimePackName` 之后，因为 `IpcFail` 的名称要用它）。源码注释：这类错误用户去设置页改一下配置就能解决，界面据此把它从内嵌状态行升级成弹窗（`[去设置]` / `[取消]`）；取值与 `SettingsPage` 的分类、`useNavIntent.SettingsSectionKey` 对齐；判定由主进程的 `friendlyError()` **单点产出**（见 `src/shared/errors.ts` 与 `docs/error-mapping.md` §11.1）。**没有 `'billing'`**：余额 / 欠费类去设置也修不好，走内嵌状态行（文案说明去厂家充值），不弹窗 |
| `IpcFail` | `interface` | 失败分支：`ok: false` + 可选 `message?: string` + 可选 `detail?: string` + 可选 `canceled?: boolean` + 可选 **`needPacks?: RuntimePackName[]`**（缺哪个运行环境包；见 ③.6 节）+ 可选 **`needConfig?: ConfigTarget`** / **`title?: string`**（配置类错误，见下） |
| `IpcResult<T = unknown>` | `type` | `({ ok: true; message?: string } & T) \| IpcFail`，成功分支是 `{ ok: true }` 与业务字段 `T` 的**交叉类型**（业务字段平铺在结果对象上，没有 `data` 包装）；成功分支的 `message` 可选，供「取消」「幂等复用」「部分成功（如素材添加跳过了几个文件）」等场景给一句话回执 |

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | `false`（`IpcFail`）/ `true`（成功分支） | 判别联合的判别式，`if (!res.ok)` 后 TS 自动收窄到 `IpcFail` |
| `message` | 可选 `string` | 失败说明（人话）。**可选**的原因：`voice:pick-dir` 的「用户取消」分支只回 `{ ok: false, canceled: true }`，没有 `message` |
| `detail` | 可选 `string` | **可选的技术详情**（原始报错 / HTTP 状态 / 请求 URL）：供 UI 的「查看详情」折叠展示，与面向用户的 `message` 分离——`message` 说人话，`detail` 给排障。见 `UpdateCheckResult.detail` |
| `canceled` | 可选 `boolean` | 区分「用户取消」与「真实失败」，渲染层通常静默忽略取消 |
| `needPacks` | 可选 `RuntimePackName[]` | **运行环境缺包**时回给界面的包名数组（`'ffmpeg'` / `'hyperframes'`）：消费点（`video:render` / `project:extract-video-audio` / `voice:synth-aligned` / 转码时的 `whisper:transcribe`）先纯校验，缺包就带上它返回，渲染层据此弹「下载运行环境」确认框（`useEnvGate`），用户点「继续」才用原参数重发。`VideoRenderResult` 的失败分支另有同名字段 |
| `needConfig` | 可选 `ConfigTarget` | **本次失败属于「配置类」**（缺 Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用）：界面据此弹「去设置 / 取消」弹窗而不是只显示一行红字。源码注释强调：**它不驱动流程**（不像 `needPacks` 要续做），只是一个分类标记；**不显示原始报文**（排障详情仍落日志）；**余额 / 欠费不属于此处**。写入方是主进程（`agent/html.ts` / `settings.ts` / `voice/api.ts`、`voice/ipc/*` 直接产出，`projects.ts` 用 `configTargetOf()` 补分类） |
| `title` | 可选 `string` | 配置类弹窗的**标题**（主进程用 `errors.configTitle()` 单点产出：`需要设置自定义模型` / `需要设置语音服务`，兜底 `需要先完成设置`）；界面只显示、不判断 |

`T` 缺省为 `unknown`，表示调用方只关心 `ok`（如 `clearAudio` / `delete` 等无载荷的写操作，以及本轮角色库的 `promoteCast` / `removeCastFromLibrary`）。

### 2.2 ② RegisterCtx（主进程装配上下文）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `getWindow` | `() => BrowserWindow \| null` | 惰性获取当前主窗口；返回 `null` 表示窗口尚未创建或已销毁。用函数而非直接持有 `BrowserWindow`，可避免模块加载顺序造成的空引用 |

### 2.3 ③ 设置（`userData/settings.json`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `ReasoningEffort` | `type` | `'none' \| 'low' \| 'high' \| 'max'`——**思考强度**（设置页 ·「模型配置」·「思考强度」下拉），原样作为请求体的 `reasoning_effort` 下发给 OpenAI 兼容端点。源码注释：取值口径同 DeepSeek——`none` = 不产生思考，`low` / `high` / `max` 依次加大思考量，`high` 是它的接口默认。**定义在 `CustomModelConfig` 之前**（同属 ③ 小节） |
| `CustomModelConfig` | `interface` | OpenAI 兼容自定义模型配置：`baseUrl` / `modelId` / `apiKey` / `enabled` / **`reasoningEffort`（思考强度，见上）** |
| `VoiceProviderConfig` | `interface` | **单个厂家**的语音配置：**只有 `apiKey`**（源码注释：不再有「厂家默认模型」这种全局设置——系统音色与模型是固定对应关系（写在 `voice/catalog.ts` 目录里），克隆音色按其映射 / 云端 `target_model` 走，都没有时才落到目录里的出厂默认模型） |
| `VoiceSettings` | `interface` | `voice` 段（按厂家组织）：`active`（当前厂家键）/ `providers: Record<string, VoiceProviderConfig>` / `saveDir` |
| `VoiceTTSConfig` | `interface` | **旧结构（单厂家、无厂家字段）**：`apiKey` / `targetModel` / `saveDir`；注释标明**仅作为迁移来源读取**，新写入一律走 `VoiceSettings` |
| `VoiceProfileType` | `type` | `'system' \| 'custom'`（音色类型字面量联合） |
| `VoiceProfile` | `interface` | 本地音色映射条目：`key` / `name` / `voice` / `targetModel` / `type` |
| `VoiceProfileInput` | `interface` | 保存映射的入参：`key` / `voice` / `targetModel` + 可选 `name` / `type`（主进程按 `voice` 回填 `name`，按 `'system'` 之外一律归 `'custom'`） |
| `WhisperCustomModel` | `interface` | whisper 自定义模型条目：`id` / `name` / `file` / `url` / `sizeMB` / `desc`（`id` 由文件名派生） |
| `WhisperSettings` | `interface` | whisper 分区：`modelId` / `customModels: WhisperCustomModel[]` |
| `AppSettings` | `interface` | 设置文件根结构：`customModel` / **`voice`** / `voiceProfiles` / `whisper` / `render` / `updater`，另有**可选的旧字段 `voiceTTS`**（只读兼容） |
| `SettingsSavePayload` | `interface` | `settings:save` 线上载荷：`{ customModel: CustomModelConfig }` |
| `SettingsTestPayload` | `interface` | `settings:test` 线上载荷：形状与 `SettingsSavePayload` 相同 |
| `SettingsSaveResult` | `interface` | `settings:save` 成功分支：`{ settings: AppSettings }`（`voice:save-config` 复用同一结果形状） |
| `RenderQuality` | `type` | 渲染质量字面量联合：`'draft' \| 'standard' \| 'high'` |
| `RenderFps` | `type` | 渲染帧率字面量联合：`24 \| 30` |
| `RenderOptions` | `interface` | **完整**渲染档位 `{ quality: RenderQuality; fps: RenderFps }`（`settings.json` 的 `render` 段与生效档位都用它） |
| `RenderOverride` | `type` | `Partial<RenderOptions>`——**项目级覆盖**：字段可缺省，缺省项跟随全局默认 |
| `RenderCanvas` | `type` | **成片画布方向**：`'landscape' \| 'portrait' \| 'square'`。源码注释明确它是**项目属性、不是渲染档位**——不走「项目覆盖 > 全局默认」那套层级，只在一处选（「HTML生成」页生成侧的「画布」下拉，生成 / 修改前定），落进 `project.json` 的 `canvas`，且同一个值同时决定三件事：① 生成提示词里给模型的版式尺寸（`projects.ts` 的 `【画布】` 块）② 预览 iframe 的画布（`pages/HtmlGenPage/PreviewSection.vue`）③ 渲染入口注入**舞台 `data-width`/`data-height`（成片宽高来源）+ `<html data-resolution>`**（`main/video.ts`）；因此「预览看到的画布」与「成片画布」必然是同一个尺寸。取值与尺寸的真源是 `shared/constants.ts`（`RENDER_CANVASES` / `CANVAS_SIZES` / `CANVAS_LABELS` / `DEFAULT_CANVAS`），与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 对齐（本项目只暴露 1080 三档） |
| `SettingsSaveRenderPayload` | `interface` | `settings:save-render` 线上载荷：`{ render?: RenderOverride }`（只更新 `render` 段，不动 `customModel`） |

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `CustomModelConfig` | `baseUrl` | `string` | OpenAI 兼容端点根地址 |
| `CustomModelConfig` | `modelId` | `string` | 模型标识（如 `gpt-4o-mini`） |
| `CustomModelConfig` | `apiKey` | `string` | 接口密钥 |
| `CustomModelConfig` | `enabled` | `boolean` | 是否启用自定义模型（关闭则走内置/默认通道） |
| `CustomModelConfig` | `reasoningEffort` | `ReasoningEffort` | 思考强度（`none` / `low` / `high` / `max`）：设置页「模型配置」·「思考强度」下拉选，默认 `high`；`settings.json` 里缺这个字段、或手改文件写进不认识的值，都落回 `high`（主进程 `normalizeCustomModel` 白名单，见 [settings.ts.md](../main/settings.ts.md)） |
| `VoiceProviderConfig` | `apiKey` | `string` | 该厂家的 API Key（明文存本机）；**这是该结构唯一的字段** |
| `VoiceSettings` | `active` | `string` | 当前厂家键（对应 `voice/catalog.ts` 的 `VoiceProviderDef.key`） |
| `VoiceSettings` | `providers` | `Record<string, VoiceProviderConfig>` | 按厂家的配置表 |
| `VoiceSettings` | `saveDir` | `string` | 生成音频保存目录（**全局一份**，不按厂家分；空串表示使用默认/项目目录） |
| `VoiceTTSConfig`（旧） | `apiKey` / `targetModel` / `saveDir` | `string` | **迁移来源**：`normalizeVoiceSettings` 把 `apiKey` / `targetModel` 搬进 `providers.qwen`（只填空缺），`saveDir` 新旧都认 |
| `VoiceProfile` | `key` | `string` | 映射键，形如 `"system:Cherry"` 或 `"custom:<voice_id>"` |
| `VoiceProfile` | `name` | `string` | 显示名 |
| `VoiceProfile` | `voice` | `string` | 音色标识（系统音色名或克隆得到的 voice_id） |
| `VoiceProfile` | `targetModel` | `string` | 该音色绑定的模型 |
| `VoiceProfile` | `type` | `VoiceProfileType` | `'system'` / `'custom'`；渲染层保存自定义音色时显式传 `'custom'` |
| `VoiceProfileInput` | `name` / `type` | 可选 | 均可缺省，由主进程回填/归一 |
| `WhisperCustomModel` | `id` | `string` | 由文件名派生（注释明确：「id 由文件名派生」） |
| `WhisperCustomModel` | `file` | `string` | 磁盘上的模型文件名（须匹配 `ggml-*.bin`） |
| `WhisperCustomModel` | `url` | `string` | 下载地址（空则回落内置镜像） |
| `WhisperSettings` | `modelId` | `string` | 当前使用的模型档位 id |
| `WhisperSettings` | `customModels` | `WhisperCustomModel[]` | 用户自定义模型条目数组 |
| `AppSettings` | `customModel` | `CustomModelConfig` | 自定义模型配置 |
| `AppSettings` | `voice` | `VoiceSettings`（**必填**） | 语音服务配置（按厂家：`active` + `providers` + `saveDir`） |
| `AppSettings` | `voiceTTS` | `VoiceTTSConfig?`（**可选，旧结构**） | 只读兼容：读取时迁进 `voice.providers.qwen`，写盘前被解构丢弃 |
| `AppSettings` | `voiceProfiles` | `Record<string, VoiceProfile>` | 音色映射表，键即 `VoiceProfile.key` |
| `AppSettings` | `whisper` | `WhisperSettings` | whisper 分区 |
| `AppSettings` | `render` | `RenderOptions` | 视频渲染**全局默认档位**（项目未覆盖时生效；读取时经 `normalizeRenderOptions` 规范化） |
| `SettingsSaveResult` | `settings` | `AppSettings` | 保存后的完整设置（主进程回带） |

### 2.3.1 ③.5 应用自更新（`src/main/updater/`，出口 `updater/index.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `UpdateCheckState` | `type` | `'none' \| 'available' \| 'skipped'`——`update:check` 的三种非失败分支 |
| `UpdateCheckResult` | `interface` | `update:check` 成功分支：`state` / `version` / `currentVersion` + **必填** `message` + 可选 `detail` |
| `UpdateStage` | `type` | `'idle' \| 'checking' \| 'available' \| 'skipped' \| 'downloading' \| 'downloaded' \| 'none' \| 'error'` |
| `UpdateProgressPayload` | `interface` | `update:progress` 推送载荷（清单见 §2.8） |

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `UpdateCheckResult` | `state` | `UpdateCheckState` | 检查结果三态；`none` / `skipped` 时也回带 `version`，便于 UI 显示「已是最新 1.0.0」 |
| `UpdateCheckResult` | `version` / `currentVersion` | `string` | 目标版本与当前版本 |
| `UpdateCheckResult` | `message` | `string`（**必填**） | 用户可见文案，由主进程**单点产出**（含 `available` / `skipped` / `none` 三种状态文案），UI 直接渲染即可——早前渲染层也自己拼一套「发现新版本…」，与事件推送的文案互相覆盖 |
| `UpdateCheckResult` | `detail` | 可选 `string` | 排障详情（HTTP 状态、AccessDenied 原文、请求 URL 等）：只在 UI「查看详情」里展开；与 `message` 分离，是因为 403 / 404 / 缺 `app-update.yml` 的处置动作都在发布者那一侧 |
| `UpdateProgressPayload` | `detail` | 可选 `string` | 同上；仅 `error` 阶段非空，UI 默认折叠 |

### 2.3.2 ③.6 运行环境（分包）（`src/main/runtime.ts`）

> 分包模型：`ffmpeg`（解包 179.9 MB）与 `hyperframes`（解包 439.9 MB）不随安装包，各自一个 7z（**实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14）、首次用到时下载并解到 `<userData>/runtime/<包名>/`；`whisper`（12.5 MB）随安装包（`extraResources`），装完即可离线转录。方案见 `docs/runtime-pack-split.md`。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `RuntimePackName` | `type` | `'ffmpeg' \| 'hyperframes'`。**定义在本文件最前**（`IpcFail.needPacks` 与 ⑧ 节的进度载荷都要用），详细说明在本节；① 节的 `ConfigTarget` 紧随它之后定义 |
| `RuntimePackState` | `type` | 单个包在本机的状态：`'ready'`（已就绪）/ `'missing'`（本机没有，需要下载）/ `'unknown'`（还没探测过） |
| `RuntimePhase` | `type` | `'idle'`（未开始）/ `'checking'`（探测 / 取清单）/ `'downloading'`（下载中）/ `'extracting'`（解包中）/ `'ready'`（需要的包都就绪）/ `'cancelled'`（用户取消，**不是失败**）/ `'error'`（失败，有 `detail` 可排障） |
| `RuntimeProgressPayload` | `interface` | `runtime:progress` 推送与 `runtime:status` 返回共用的载荷；字段见下。**旧的 `stage` / `id` 字段已删除**（阶段改叫 `phase`，包名改叫 `pack`，就绪与否看 `status` / `missing`） |

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `phase` | `RuntimePhase` | 当前阶段 |
| `pack` | `RuntimePackName \| null` | 正在处理的包；空闲 / 就绪时为 `null` |
| `percent` | `number` | 当前包的百分比（downloading / extracting 阶段有效，`checking` 阶段没有百分比；`ready` 为 100） |
| `packs` | `RuntimePackName[]` | 本次操作需要的全部包（供界面说明「要下什么」） |
| `missing` | `RuntimePackName[]` | 当前仍缺的包（就绪后为空数组） |
| `status` | `Record<RuntimePackName, RuntimePackState>` | 各包在本机的状态（设置页据此分项显示） |
| `message` | `string` | 用户可见文案（人话：正在做什么 / 已经就绪 / 失败了怎么办） |
| `detail` | 可选 `string` | 排障详情（7za 退出码、HTTP 状态、路径等），仅失败或降级时有值 |
| `source` | `string` | `remote` = 从更新源下载；`local` = 用户指定的本地 7z（`SHADOWMILL_RUNTIME_PACK` / 设置页「从本地文件安装…」）；`legacy` = 沿用旧版整体包已解开的目录；`dev` = 开发态项目根 `resources`；`cache` = 复用已解包目录 |
| `bytes` | `number` | 当前包的下载体积（下载进度用） |
| `unpackedBytes` / `files` | `number` | 解包后体积与文件数（解包进度的分母）；分包前 `resources/` 合计实测 632.3 MB / 4916 文件，可作口径参考 |
| `cancellable` | `boolean` | 是否可取消（**checking / downloading / extracting** 期间为 true，界面此时显示「取消」——`cancelPrepare()` 本来就支持取消取清单阶段；取清单 20 秒无响应的**超时不算取消**） |

> 同一个接口也在 §2.8 的进度载荷表里列了一行（⑧ 进度推送视角），两处引用的是同一份定义。

### 2.3.3 ⑧b 历史数据目录（`src/main/index.ts`）

> 背景：`userData` 目录名跟随 `package.json` 的 `name`，2026-10-12 品牌更名（`my-app` → `shadowmill`）后老用户的数据仍留在 `%APPDATA%\my-app`，打开应用会看到「项目全没了」。**主进程只回答「有没有 / 是什么」并执行选择，界面完全在渲染层**：弹窗是应用内弹窗（沿用 `.hf-modal` 体系），**不再使用原生 `dialog.showMessageBox`**，主进程侧因此也没有任何「等首屏画完」的延迟。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `LegacyDataInfo` | `interface` | 扫描结论：`dir`（老目录绝对路径，例如 `C:\Users\x\AppData\Roaming\my-app`）/ `entries`（其中**确有数据**的条目名：projects / whisper / voice / tts-output / html-agent / settings.json）/ `projects`（`projects/` 下的项目数，没数出来为 0）。`legacy:status` 返回 `LegacyDataInfo \| null`，`null` 表示没有待处理的旧数据 |
| `LegacyResolveAction` | `type` | `'migrate' \| 'delete' \| 'later'`——用户在弹窗里的三选一；主进程侧**非法或缺省的 action 一律当 `'later'`**（绝不会因调用方写错就搬走或删除数据） |
| `LegacyResolveResult` | `interface` | `legacy:resolve` 的返回：`ok` / `action` + 可选 `moved` / `skipped` / `failed`（迁移统计，`action === 'migrate'` 时有值）+ 可选 `message`（失败或部分失败的说明） |

字段语义要点：

- `entries` 只列白名单里**确有数据**的条目（空目录 / 0 字节文件不算），因此渲染层可以直接把它拼成「其中包含：项目、识别模型…」的文案；`projects > 0` 时再追加「（N 个项目）」。
- `LegacyResolveResult.ok` 表达的是**这一动作是否成功**，不是「用户是否做了选择」：`'later'` 属成功的选择，回 `{ ok: true, action: 'later' }`；迁移有失败项时回 `ok: false`，但**仍带上三个计数**并提示可稍后重试。
- 没有待处理数据时（已处理过、或 `MIGRATE_USER_DATA=0`）回 `{ ok: false, action, message: '没有待处理的旧数据' }`。

### 2.4 ④ 音色与配音（`voice/api.ts` / `voice/ipc/*` / `voice/ttsAlign.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SystemVoice` | `interface` | Qwen-TTS 系统音色条目（`voice/systemVoices.ts` 的内置表结构）：`voice` / `desc` / `langs` / `series` |
| `SystemVoiceItem` | `interface` | `extends SystemVoice`，额外带 `model: string`（该音色绑定/默认的合成模型）；`voice:list-system-voices` 的结果元素 |
| `VoiceModelRole` | `type` | `'clone' \| 'system'`（候选合成模型的角色） |
| `VoiceModelInput` | `type` | `'url' \| 'file'`（音色克隆的音频输入方式）——**`url` = 除本地文件外还接受公网音频 URL（`qwen-audio-*`），`file` = 只接受本地音频文件**；源码注释另注明「vc 系列移除后千问只剩 url 一档；`file` 留给将来『只收本地文件』的厂家」 |
| `VoiceModel` | `interface` | 候选合成模型：`id` / `label` / `role` + 可选 `input` / `group` / `isDefault` / `series` |
| `ClonedVoice` | `interface` | 云端克隆音色项：`voice?`（Qwen-TTS 系列）/ `voice_id?`（Qwen-Audio-TTS 系列）/ `target_model?` / `targetModel?` |
| `VoiceListItem` | `interface` | `voice:list-all` 结果项（系统 + 克隆合并，统一「音色即模型」形态）：`key` / `type` / `name` / `voiceId` / `model` |
| `GeneratedAudioItem` | `interface` | `voice:list-generated` 结果项：`path` / `name` / `group` / `size` / `mtime` |
| `VoiceConfigResult` | `interface` | `voice:get-config` 结果：`{ active, providers, saveDir }`——`active` 为当前厂家键、`providers` 为各家 `VoiceProviderConfig` |
| `VoiceSaveDirPayload` | `interface` | `voice:get-save-dir` 载荷：`saveDir?` / `defaultOut?` / `projectName?` |
| `VoiceSaveDirMode` | `type` | `'custom' \| 'output' \| 'project' \| 'default'`（保存目录解析模式） |
| `VoiceSaveDirResult` | `interface` | `{ mode: VoiceSaveDirMode; saveDir: string }` |
| `VoiceSaveConfigPayload` | `interface` | `voice:save-config` 线上载荷：`{ provider?: string, config?: Partial<VoiceProviderConfig>, saveDir?: string }`——`config` 是**可选**的（只改保存目录时不给），且只可能是 `{ apiKey? }`；`saveDir` 是**全局「自定义保存目录」**（给了就一并更新：**不动 Key、不切厂家**），`provider` 缺省 = active 厂家 |
| `VoiceProviderView` | `interface` | `voice:list-models` / `voice:get-config` 回带的**厂家目录**（`VoiceProviderDef` 的渲染层视图）：`key` / `label` / `apiKeyHint` / `defaultModel` / `models` / `voices`。**`defaultModel` 保留**——它是目录里的**出厂默认**，仅供界面说明展示（不再对应任何可保存的设置项） |
| `VoiceProfilesResult` | `interface` | `{ profiles: Record<string, VoiceProfile> }`（`getProfiles` / `saveProfile` / `deleteProfile` 共用） |
| `VoiceProfilePayload` | `interface` | `voice:save-profile` 线上载荷：`{ profile: Partial<VoiceProfile> & { type?: string } }` |
| `VoiceProfileKeyPayload` | `interface` | `voice:delete-profile` 线上载荷：`{ key }` |
| `VoiceCreatePayload` | `interface` | `voice:create` 载荷：`audioPath?` / `targetModel?` / `preferredName?`。源码注释：**`audioPath` 为本地音频绝对路径、公网 URL / `oss://` 地址，或 `data:audio/...;base64` URI**；本地文件由主进程用 ffmpeg 裁成前 15 秒 24k 单声道 wav 再转 data URI，**放进复刻接口的 `input.url`** |
| `VoiceCreateResult` | `interface` | **`{ voice: string; targetModel: string }`**（由 4 字段收缩为 2 字段）。源码注释：`voice` 取自返回体的 `output.voice_id`；`targetModel` 是**本次请求发的目标模型**；**`fallbackMode` / `fallbackReason` 已删除** |
| `VoiceSynthPayload` | `interface` | `voice:synth` 载荷（由 preload 按位置参数组装）：`text?` / `voice?` / `targetModel?` / `projectName?` / `saveDir?` / `defaultOut?` / `audioName?` |
| `VoiceSynthResult` | `interface` | `{ savePath, projectName, savedTo, size }` |
| `VoiceSavedTo` | `type` | `'custom' \| 'output' \| 'project' \| 'default'`（`voice:synth` 的落盘位置） |
| `VoiceAlignMode` | `type` | `'audio-driven' \| 'timeline-driven'`（字幕配音对齐模式） |
| `VoiceAlignPayload` | `interface` | `voice:synth-aligned` 载荷：`subtitleText` / `voice` + 可选 `mode` / `gapSec` / `voiceModel` / `projectName` |
| `AlignSegStatus` | `type` | `'ok' \| 'accelerated' \| 'pushed'` |
| `VoiceAlignDetail` | `interface` | 逐句明细：`index` / `text` / `subtitleStart` / `audioStart` / `audioDur` / `status` / `rate` / `delta` / `segPath` |
| `VoiceAlignResult` | `interface` | `voice:synth-aligned` 成功分支：`mode` / `subtitleText` / `audioPath` / `totalDur` / `details` |

`VoiceModel` 的字段语义：`role` 决定用途（`clone` 用于克隆音色、`system` 用于系统音色）；`input` 仅在 `role: 'clone'` 时有意义（`url` = 除本地文件外**还**接受公网音频 URL，`file` = 只接受本地音频文件）；`group` 用于界面分组，`isDefault` 标记默认项，`series` 用于系统音色按系列取默认模型。

`VoiceAlignMode` 的两种语义（源码注释）：

- `audio-driven`：以实测每句时长重建字幕时间线（音频不变速）；
- `timeline-driven`：保持字幕时间，每句配音摆放到其字幕时间点（超时先 atempo 加速，仍超则顺延）。

`AlignSegStatus` 的三种取值：`ok` = 正常；`accelerated` = 已 atempo 加速；`pushed` = 槽位不足顺延且平移后续字幕时间。

### 2.5 ⑤ 语音识别（`whisper.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `WhisperLangId` | `type` | `'auto' \| 'zh' \| 'zh-hant' \| 'en'`（whisper-cli 的 `-l` 取值；`zh-hant` 也按 `zh` 识别，仅区别是否做繁→简转换） |
| `WhisperLang` | `interface` | 语言选项：`id: WhisperLangId` / `label` |
| `WhisperModelItem` | `interface` | `whisper:status` 的模型项（内置档位与自定义模型统一结构） |
| `WhisperStatusResult` | `interface` | `whisper:status` 结果 |
| `WhisperIdPayload` | `interface` | `{ id }`（`download` / `delete` / `setCurrent` / `removeModel` 的线上载荷） |
| `WhisperAddModelPayload` | `interface` | `whisper:add-model` 载荷：`name?` / `file?` / `url?` / `desc?` / `sizeMB?: number \| string` |
| `WhisperUpdateModelPayload` | `interface` | `whisper:update-model` 载荷：`id?` / `name?` / `url?` / `desc?` / `sizeMB?: number \| string`（`file` / `id` 固定不变，空值保留原值） |
| `WhisperOpenDirPayload` | `interface` | `{ which?: 'models' \| 'cli' }` |
| `WhisperProjectAudioPayload` | `interface` | `{ name? }`（取项目音频） |
| `WhisperTranscribePayload` | `interface` | `whisper:transcribe` 载荷：`id?` / `audioPath?` / `language?: WhisperLangId` |
| `WhisperSegment` | `interface` | 转录段：`start` / `end`（秒）/ `text` |
| `WhisperTranscribeResult` | `interface` | `{ id, text, subtitleText, segments: WhisperSegment[], model }` |
| `WhisperProjectAudioResult` | `interface` | `{ path, name }` |

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `WhisperModelItem` | `id` / `label` / `sizeMB` / `speed` / `desc` | `string` / `string` / `number` / `string` / `string` | 档位标识、显示名、体积（MB）、速度说明、描述 |
| `WhisperModelItem` | `file` / `localFile` / `url` | `string` | 登记文件名、本地绝对路径、下载地址 |
| `WhisperModelItem` | `custom` / `downloaded` / `isCurrent` | `boolean` | 是否自定义档位、本地是否已下载、是否当前使用档位 |
| `WhisperModelItem` | `localBytes` | `number` | 本地文件字节数（未下载为 0） |
| `WhisperStatusResult` | `cli` | `{ exists: boolean; path: string }` | `whisper-cli.exe` 探测结果 |
| `WhisperStatusResult` | `modelsDir` | `string` | 模型目录（`userData/whisper/models`） |
| `WhisperStatusResult` | `langs` | `WhisperLang[]` | 语言选项表 |
| `WhisperStatusResult` | `models` | `WhisperModelItem[]` | 内置 + 自定义统一清单 |
| `WhisperStatusResult` | `unknownFiles` | `string[]` | 目录中未被任何档位登记的 `.bin` 文件名 |
| `WhisperStatusResult` | `usedBytes` / `currentModelId` | `number` / `string` | 已占用总字节数、当前档位 id |

### 2.6 ⑥ 项目与字幕（`projects.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `Scene` | `interface` | 内容脚本场景：`id` / `narration` / `visual` / `durHint` |
| `ContentScript` | `interface` | 内容脚本：`style` + `scenes: Scene[]`（正文落在项目目录的 **`content.json`**，不在 `project.json` 里） |
| `Project` | `interface` | 项目的**完整视图**（渲染层侧与主进程内部使用的形状）：索引字段 + **字幕正文 `subtitle`** + **内容脚本正文 `content`**。源码注释逐字：「注意：正文（subtitle / content）**不在 project.json 里**——它们分别是项目目录下的 subtitle.txt 与 content.json；project:load 由主进程把三者拼成这个结构，渲染层契约因此不变。」 |
| `ProjectIndex` | `type` | 磁盘上 `project.json` 的实际形状 —— `Omit<Project, 'subtitle' \| 'content'> & { subtitle?: string; content?: ContentScript }`，即**只有索引**，`subtitle` / `content` 两个可选字段只作为**老项目的内联旧格式**存在（读取时当回退来源，`writeProject()` 写回时一律剥掉） |
| `ProjectChapter` | `interface` | **章节模式的一章**：`id` / `title` / `duration` / `sceneFrom` / `sceneTo` / `summary`，另有可选 `uses?: string[]`（本章要用哪些随包库：只认 `'p5'` 与 `'p5.brush'`，`p5.brush` 隐含 `p5`，`three` 被静默丢掉——章节模式暂不支持 three.js）与可选 `cast?: string[]`（**本章出场角色**的 `ProjectCastMember.id`：骨架按它把 `cast/<id>.js` 按需引入，章节里直接 `window.__cast["hero"](x, y, u, {…})` 调用；空 = 本章不出现角色）。`Project.chapters?: ProjectChapter[]`：**空 / 缺省 = 单文件模式**，老项目零迁移；有值时才是章节模式（每章 `pages/cNN.js`） |
| `ProjectCastMember` | `interface` | **一个项目角色**（「HTML生成」页 ·「项目素材」区 · 角色的行结构）—— `id` / `name` / `desc` / `units` / 可选 `uses?: string[]` / **可选 `selected?: boolean`**。`id` 是**可读 slug**（`^[a-z][a-z0-9_]{0,23}$`，如 `hero` / `researcher` / `cat`），同时是文件名词干 `cast/<id>.js`；`units` = 「高几个 u」（主角 8u、配角 6u，多角色身高比例靠它）；`uses` 是角色自己画的时候要用哪些随包库（水彩角色要 `p5` + `p5.brush`，骨架取「章节 `uses` ∪ 角色 `uses`」）；**`selected` = 是否参与本次生成**（与 `ProjectMaterial.selected` 同语义，**缺省 = 参与**，只有勾选的角色才会被注入页面）。源码注释写明角色 = 一份**共享的绘制函数**而不是图片：`window.__cast["hero"] = function (x, y, u, o) { … }`，**它是项目资产、与「单文件 / 章节化」两种产物形态无关**（生成前在素材区勾选，生成时应用把 `core.js` + 被勾选角色的脚本注入页面：单文件模式注 `index.html`、章节模式写进骨架）。`Project.cast?: ProjectCastMember[]`：**空 = 本片没有角色** |
| **`CastLibraryMember`** | **`interface`，`extends ProjectCastMember`（本轮新增）** | **全局角色库里的一条**：在 `ProjectCastMember` 的五个字段之外只多一个可选 **`missing?: boolean`** —— 库里「索引有、文件不在」时为 `true`（界面据此把该行压暗、不可勾选，而不是让它静默消失）。源码注释把两层关系写死：全局库是**用户资产**（可备份、可迁移、跨项目复用），项目里的 `cast/<id>.js` 是**这部片子的角色**（生成物）；两者是两层，不是同一份东西 |
| **`CastLibraryResult`** | **`interface`（本轮新增）** | `project:cast-library` 成功分支的载荷：`{ members: CastLibraryMember[] }`。走标准 `IpcResult<CastLibraryResult>`，失败分支只用 `IpcFail` 的 `message`（库索引读不出来时给「全局角色库索引读取失败：…」） |
| **`ProjectCastResult`** | **`interface`（本轮新增）** | `project:import-cast` 成功分支的载荷：`{ cast: ProjectCastMember[] }` —— **导入后的完整项目角色表**（已与原有角色合并）。源码注释：应用据此**原地刷新 `appState.project`**，不必整份重载项目；注意它是 `ProjectCastMember[]` 而不是 `CastLibraryMember[]`（项目里没有「缺文件」这回事，导不进来的已经在主进程跳过了） |
| **`ProjectNewCastPayload`** | **`interface`** | **`project:new-cast` 载荷**（「新建角色」弹窗）：`name?`（项目名）/ **`taskId: string`（必填，本次模型调用的任务 id）** / `title?`（角色名，界面上显示、也当 prompt 里的称呼）/ `desc?`（外形 / 配色 / 关键特征描述）/ `units?`（高几个 u，缺省 8）/ `watercolor?`（`true` = 声明 `p5` + `p5.brush`）。**除了 `taskId` 没有任何与「生成 HTML」相关的字段**——`taskId` 不是生成参数，只用来把进度回传给订阅了同一个 id 的回调（见 ⑨ 节 `onTaskProgress`）；这条路径不经过生成流程 |
| **`ProjectNewCastResult`** | **`interface`（本轮新增）** | `project:new-cast` 成功分支：`{ member: ProjectCastMember; cast: ProjectCastMember[] }`——`member` 是新角色（已加入 `project.cast`，`selected = true`），`cast` 是加入后的完整角色表 |
| **`ProjectSaveCastPayload`** | **`interface`（本轮新增）** | **`project:save-cast` 载荷**（整份角色表回写，勾选 / 删除 / 改名共用，与 `ProjectSaveMaterialsPayload` 同语义）：`{ name?: string; cast?: ProjectCastMember[] }` |
| **`ProjectCastPreviewPayload`** | **`interface`（本轮新增）** | **`project:cast-preview` 载荷**（角色静态预览）：`name?`（项目名）/ `id?`（角色 id，slug、同时是文件名词干）/ `units?`（高几 u，只影响预览里画多大）/ `title?`（角色名，只用于预览页标题 / 无障碍文案）/ `from?: 'project' \| 'lib'`（代码从哪读：`project` = `<项目>/cast/<id>.js`（默认）、`lib` = 全局角色库里那份）/ `uses?: string[]`（角色声明的随包库，**只用来在预览页提示「水彩角色只画得出 Canvas 2D 部分」**）。字段全部可选：`name` / `id` 由 preload 的方法参数合并进来，`PreloadApi` 里第三参是 `Omit<…, 'name' \| 'id'>` |
| **`ProjectCastPreviewResult`** | **`interface`（本轮新增）** | `project:cast-preview` 成功分支：`{ rel: string }`——预览页**相对项目根**的路径（`cast-preview/<project\|lib>-<id>.html`），渲染层拿它拼 `hgpreview://p/…` |
| `ProjectMaterialKind` | `type` | **`'image' \| 'video'`**——决定素材落在哪个目录，也决定提示词里给模型的嵌入方式（`<img>` / `<video>`） |
| `ProjectMaterial` | `interface` | **一条素材**：`id` / `kind` / `file` / `label` / `selected` / `addedAt` |
| `SubtitleLine` | `interface` | 字幕行（`parseSubtitle` 输出）：`n` / `text` / `time` / `end`（秒，可带小数；`end` 可为 `null`） |
| `ProjectMeta` | `interface` | `project:list` 结果项（首页/步骤条的项目卡片与下拉） |
| `ProjectNamePayload` | `interface` | 仅以项目名定位的载荷 `{ name }`（`delete` / `open-folder` / `extract-video-audio` 等） |
| `ProjectSaveSubtitlePayload` | `interface` | `{ name?, subtitle?, title? }` |
| `ProjectSaveContentPayload` | `interface` | `{ name?, content? }`（`content` 为 `unknown`；主进程用 `normalizeContent` 归一后写 `content.json`） |
| `ProjectSaveResult` | `interface` | `{ project: Project }`（`create` / `saveSubtitle` / `saveContent` / `saveVideo` 共用）——注意回带的仍是**完整视图** `Project`（含正文），不是 `ProjectIndex` |
| `ProjectExportSrtPayload` | `interface` | `{ name?, srt? }` |
| `ProjectDownloadResult` | `interface` | `{ savedPath }`（下载 HTML / 导出 SRT 共用） |
| `ProjectSetAudioPayload` / `ProjectSetVideoPayload` | `interface` | `{ name?, audioPath? }` / `{ name?, videoPath? }`——**`ProjectSetVideoPayload` 的注释已改为「只服务 `project:save-video` 的产物回写」**：它与「项目视频素材」无关（素材走 `project:add-materials` / `project:save-materials`） |
| `ProjectSetAudioResult` | `interface` | `{ audioFile, htmlUpdated? }`（`setAudio` / `extractVideoAudio` 共用）；`htmlUpdated` 为「设置 / 移除背景音频时 `index.html` 的注入音轨是否被同步改写」，可选 |
| `ProjectPickMediaPayload` | `interface` | **`project:pick-media` 载荷**：`{ kind?: ProjectMaterialKind }`——`kind` 决定文件框的扩展名过滤；图片允许一次多选（一屏素材），视频单选（单个文件常很大） |
| `ProjectAddMaterialsPayload` | `interface` | **`project:add-materials` 载荷**：`{ name?, paths?: string[] }`——把用户选中的**外部绝对路径**复制进项目素材目录并登记为素材 |
| `ProjectSaveMaterialsPayload` | `interface` | **`project:save-materials` 载荷**：`{ name?, materials?: unknown }`——整份素材列表回写（**移除与勾选都走这条**）；`materials` 刻意是 `unknown`，因为渲染层提交的是完整列表、主进程只做规范化（id/kind/file 校验 + 上限）后落盘 |
| `ProjectMaterialsResult` | `interface` | **素材接口回执**：`{ materials: ProjectMaterial[]; message?: string }`——`materials` 恒为落盘/读取后的完整列表，渲染层直接用它替换本地状态；`message` 非空表示「部分成功」之类需要告知用户的补充说明（如跳过了几个不支持的文件） |
| `ProjectReadHtmlResult` | `interface` | `{ html }` |
| `ProjectSaveHtmlPayload` | `interface` | `{ name?, html? }` |
| `ProjectPreviewHtmlResult` | `interface` | `{ previewPath; pageCanvas?: RenderCanvas \| '' }`——**可选 `pageCanvas`**：页面自己声明的画布（取自 `<html data-resolution>`，只认白名单取值），预览据此把 iframe 设成**页面原生尺寸**；缺失 / 非法为空串 ⇒ 渲染层回落成「按项目当前画布显示」（老页面没有这个声明）。**不新增频道、preload 未改**，只是多带一个字段 |
| `ProjectOpenFolderOfResult` | `interface` | `{ dir }` |
| `ProjectHtmlMaterials` | `interface` | HTML 生成/修改的素材选择：`subtitleProject?` / **`materialIds?: string[]`**（**`audioPath?` 已删除**：背景音频不是生成素材，由应用按 `project.audioFile` 注入 HTML 的 `<audio id="myv-bgm">`。`materialIds` = 本次参与生成的素材 id 列表，顺序即提示词里的顺序，空/缺省 = 不带素材） |
| `ProjectAgentPayload` | `interface` | `extends ProjectHtmlMaterials` + `name` / `prompt` + **`taskId: string`（必填）**（`generateHtml` / `modifyHtml` 线上载荷）。源码注释：`taskId` 是「本次模型调用的任务 id（渲染层生成，见 utils/taskId.ts）：进度按它路由」，且**一次生成 / 修改可能包含「规划 + 逐章 + 改稿」多次模型调用，全部共用同一个 id**（界面看到的是「这一次操作」的进度） |
| `ProjectHtmlResult` | `interface` | `{ htmlPath, compatible, message? }` |
| `ProjectSetRenderPayload` | `interface` | `project:set-render` 线上载荷：`{ name?: string; render?: RenderOverride \| null }`——`render` 传 `null`（或字段全非法）表示清除项目覆盖、回到跟随全局默认 |
| `ProjectSetCanvasPayload` | `interface` | **`project:set-canvas` 线上载荷**：`{ name?: string; canvas?: RenderCanvas }`——成片画布方向（项目属性）。源码注释口径是「**非法 / 缺省一律忽略，不写进项目**」；handler 侧缺项目名回 `缺少项目名`、白名单（`RENDER_CANVASES`）外回 `画布取值非法` |
| **`ScriptCastRef`** | **`interface`（本轮新增）** | **内容脚本写稿用的角色引用**：`id` / `name` / `desc`（一句话外观描述：配色 / 特征）/ `units`（高几个 u，让模型写得出「谁高谁矮、差多少」）。**它不是 `ProjectCastMember`**——源码注释逐字：用户从全局角色库挑了角色之后，「选中项**只作提示词上下文**，让模型按这些角色的名字与外观写旁白 / 画面分镜。它**不是**项目角色（`ProjectCastMember`）：不落盘、不导入项目、也不参与「HTML生成」页的角色注入；这里只取写稿需要的三样——名字、外观描述、身高（u）。」位置在 ⑥ 节 `// ===== 内容脚本 Agent（script:generate）=====` 小标题之后、`ScriptGeneratePayload` 之前 |
| `ScriptGeneratePayload` | `interface` | **`script:generate` 载荷**：`name` / `request` / `scenes: Scene[]` / `sceneCount?` / `targetSeconds?` / **`cast?: ScriptCastRef[]`（本轮新增）**。注释把语义写死：`request` **空脚本时是主题、非空时是修改指令**；`scenes` 是**当前编辑器里的场景（空数组 = 从零写）**——上下文由渲染层给，**主进程不读项目文件**；两个参数都可空，空则由模型决定；`cast` 的注释是「本片可用的角色（空/缺省 = 没选角色，提示词里不会出现【角色】块，行为与加这个字段之前完全一致）」 |
| `ScriptGenerateReply` | `type` | **`script:generate` 返回联合**：成功 `{ ok: true; scenes: Scene[]; totalChars: number; message?: string }` / 失败 `{ ok: false; message: string; raw?: string; needConfig?: ConfigTarget; title?: string }`。注释：失败分支带上模型原文（`raw`）——**解析失败时界面要把原文摆给用户，不能静默吞掉** |
| `ScriptChatRoundMeta` | `interface` | **对话记录的一轮（只有元数据）**：`id` / `request` / **`versionId`** / `totalChars` / `sceneCount` / `ts`。源码注释：**索引里不存 scenes**——该轮脚本的完整副本在 `projects/<项目名>/chat/versions/<versionId>.json`，展开 / 应用时才读；与 `project.json` / `content.json` 都无关 |
| `ScriptChatIndex` | `interface` | **`script:load-chat` 的返回主体**：`{ rounds: ScriptChatRoundMeta[]; activeVersionId: string }`——`activeVersionId` 是**当前已应用到编辑器的那一版**（没有则为空串）；索引不存在 / 损坏回空列表（老项目无需迁移） |
| `ScriptVersionResult` | `interface` | **`script:read-version` 的返回**：`{ scenes: Scene[] }`——某一版的完整场景（只读、无副作用） |
| `ScriptAppendRoundPayload` | `interface` | **`script:append-round` 的载荷**：`{ name: string; round: { id; request; totalChars; ts }; scenes: Scene[] }`——主进程负责写副本并更新索引（`versionId` / `sceneCount` 由主进程定，所以 `round` 里没有这两项） |

> **已删除**（素材库那一轮）：`ProjectSetVideoResult`（原 `{ videoFile, abs }`）——它描述的「导入视频素材并回带项目内绝对路径」语义随单视频素材一起下线，素材三件套改由 `ProjectMaterialsResult` 描述回执。

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `Project` | `name` / `title` | `string` | 项目名、标题 |
| `Project` | `subtitle` | `string` | **字幕正文**（完整视图才有）：`project:load` 时由主进程 `readSubtitle()` 取（老项目内联旧字段优先、其次 `subtitle.txt`）；**磁盘上它在 `subtitle.txt`，不在 `project.json`** |
| `Project` | `subtitleCount` | 可选 `number` | 字幕条数（索引字段之一） |
| `Project` | `htmlPath` / `videoPath` | `string` | 产物路径。`htmlPath` 是**绝对路径**；`videoPath` 是**项目内相对路径**（形如 `video/output.mp4`——成品就地渲染在项目里，落盘用相对引用以便项目整体搬走，见 [projects.md](../main/projects.md) §1.1；主进程 `project:load` 交给渲染层前会用 `resolveVideoAbs()` 换算成绝对路径，兼容读老记录里的绝对路径）。空串表示未生成或已失效，HTML 变更后 `videoPath` 会被置空 |
| `Project` | `materials` | 可选 `ProjectMaterial[]` | **项目素材库**（图片 + 视频，多素材）：由 `project:add-materials` / `project:save-materials` 维护 |
| `Project` | `videoMaterial` | 可选 `string` | **历史字段**（源码注释逐字）：「历史字段（素材多视频化之前的那「一个视频素材」）：本轮起**不再写入**、素材列表也不读它。保留声明只为不改动被暂时隐藏入口的 project:extract-video-audio handler（它仍按此字段定位视频）。」 |
| `Project` | `audioFile` | `string` | 背景音频 / 生成语音相对引用（`audio/xxx`，空串表示无）；也是主进程注入 HTML 音轨（`<audio id="myv-bgm">`）的唯一来源 |
| `Project` | `content` | `ContentScript` | **内容脚本正文**（完整视图才有）：`project:load` 时由主进程 `readContent()` 取（`content.json` 优先、老项目内联旧字段兜底）；**磁盘上它在 `content.json`，不在 `project.json`** |
| `Project` | `render` | 可选 `RenderOverride` | 视频渲染档位的**项目级覆盖**（字段缺省即跟随全局默认；`render` 为空覆盖时该字段被删除） |
| `Project` | `canvas` | 可选 `RenderCanvas` | **成片画布方向（项目属性）**：缺省 = `DEFAULT_CANVAS`（`landscape` 1920×1080）；由 `project:set-canvas` 写入，生成提示词 / 预览画布 / 渲染入口三处都读它（与 `render` 那套档位层级无关） |
| `Project` | `chapters` | 可选 `ProjectChapter[]` | **章节清单**：空 / 缺省 = 单文件模式；有值时每章一份 `pages/cNN.js`、`index.html` 由骨架生成 |
| `Project` | `cast` | 可选 `ProjectCastMember[]` | **项目角色表**：空 = 本片没有角色；非空时每个角色一份 `cast/<id>.js`，**只有 `selected !== false` 的那些**会被注入页面（章节模式写进骨架、单文件模式由 `cast/inject.ts` 注入）。**注意**：源码里 `Project.cast` 上方那行注释仍写着「骨架按各章 ProjectChapter.cast 的并集引入」，那是**上一版的旧说法**——按当前实现（`cast.selectedMembers` + `buildSkeleton` 的 `cast` 参数）它已经不作数了，别按注释去理解行为 |
| `ProjectChapter` | `cast` | 可选 `string[]` | **本章出场角色**（`ProjectCastMember.id` 列表）。**保留字段、当前不参与脚本引入**：骨架「传谁引谁」（只看 `cast.selectedMembers(Project.cast)`），`ProjectChapter.cast` 仍进大纲文案（`chapterOutlineText` 显示「［角色：…］」），但不再决定哪些 `cast/<id>.js` 被 `<script>` 引入 |
| `ProjectCastMember` | `id` / `name` / `desc` | `string` | 角色 id（小写 slug、同时是文件名词干）、显示名、外观描述（进提示词；空写「（未描述）」） |
| `ProjectCastMember` | `units` | `number` | 「高几个 u」：主角 8u、配角 6u，缺省 8、限 1–30——多角色的身高比例靠它对齐 |
| `ProjectCastMember` | `uses` | 可选 `string[]` | 这个角色自己画的时候要用哪些随包库（只认 `p5` / `p5.brush`，`p5.brush` 自动补 `p5`）；骨架取「章节 `uses` ∪ 角色 `uses`」 |
| **`ProjectCastMember`** | **`selected`** | **可选 `boolean`（本轮新增）** | **是否参与本次生成**（与 `ProjectMaterial.selected` 同一语义）：**只有勾选的角色才会被注入页面**，没勾的就只是躺在项目里。不填按「参与」处理（老数据 / 新建都算参与）。源码注释还把整条链路写死：「生成前在素材区勾选「参与本次生成」；生成时应用把 `core.js` + 被勾选角色的 `cast/<id>.js` 注入页面（单文件模式注入 `index.html`，章节模式写进骨架）；模型只负责「调用」角色（`window.__cast["hero"](x, y, u, { ctx })`），不再各自重画」 |
| `CastLibraryMember` | `missing` | 可选 `boolean` | **本轮新增**：库里索引有这条、但 `<userData>/cast-library/<id>.js` 不在了 ⇒ `true`。渲染层（「HTML生成」页 · 「角色」区 · 「从全局库添加」弹窗）据此把整行压暗、复选框禁用并显示「文件缺失」——**不静默消失**：用户得看见库里有这么一条坏记录，才知道该重新「存为全局」一次 |
| `CastLibraryResult` | `members` | `CastLibraryMember[]` | 库里的全部条目（含 `missing` 的）；库不存在 / 索引损坏时主进程回 `{ ok:false, message }`，不会回空数组冒充「库是空的」 |
| `ProjectCastResult` | `cast` | `ProjectCastMember[]` | 导入后的完整项目角色表（原有 + 新导入，同 id 以库里那份为准） |
| `Project` | `createdAt` / `updatedAt` | `string` / 可选 `string` | 创建与更新时间（ISO 字符串） |
| `ProjectIndex` | `subtitle` / `content` | 可选 `string` / `ContentScript` | **只服务老项目的内联旧格式**。源码注释逐字：「`subtitle` / `content` 两个可选字段只作为**老项目的内联旧格式**存在：读取时当回退来源，`writeProject()` 写回时一律剥掉，所以它们不会在新数据里再出现。」 |
| `ProjectIndex` | 其余字段 | — | 与 `Project` 同名同义（`Omit<Project, 'subtitle' \| 'content'>`），即索引字段全部保留：`name` / `title` / `subtitleCount?` / `htmlPath` / `videoPath` / `audioFile` / `materials?` / `render?` / `canvas?` / `videoMaterial?` / `createdAt` / `updatedAt?` / `chapters?` / `cast?` |
| `ProjectMaterial` | `id` | `string` | 素材 id（主进程 `newMaterialId()` 生成）：勾选、移除都按它定位，**与文件名解耦**（同名文件重复导入也不会串） |
| `ProjectMaterial` | `kind` | `ProjectMaterialKind` | `'image'` / `'video'`——决定落盘目录（`images/` / `video/`）与提示词分块 |
| `ProjectMaterial` | `file` | `string` | **项目内相对引用**（源码注释：`images/xxx.png` \| `video/xxx.mp4`），与场景/字幕同级的跨进程契约；主进程 `normalizeMaterials` 强制它落在本项目素材目录下且不含 `..` |
| `ProjectMaterial` | `label` | `string` | **原始文件名**（源码注释：界面显示 + 提示词里给模型读） |
| `ProjectMaterial` | `selected` | `boolean` | 本次生成是否带上（`normalizeMaterials` 里 `o.selected !== false`，即缺省视为 true） |
| `ProjectMaterial` | `addedAt` | `string` | 加入时间（ISO 字符串） |
| `SubtitleLine` | `n` / `time` / `end` | `number` / `number` / `number \| null` | 序号、起始秒、结束秒（`null` 表示无结束时间） |
| `ProjectMeta` | `name` / `title` / `updatedAt` | `string` | 项目名、标题、更新时间 |
| `ProjectMeta` | `hasSubtitle` / `hasHtml` / `hasVideo` | `boolean` | 三类产物的存在性（主进程 `scanProjects()` 判定；`hasSubtitle` = `subtitleCount > 0` **或**索引里有内联旧 `subtitle` **或** `subtitle.txt` 存在，因为字幕正文已不在 `project.json` 里）；`hasVideo` 也是「视频预览」页下拉的筛选依据 |
| `ProjectMeta` | `subtitleCount` | `number` | 字幕条数 |
| `ProjectHtmlMaterials` | `subtitleProject` | 可选 `string` | `''` = 不使用；`'__current__'` = 当前项目字幕；其他 = 指定带字幕的项目名 |
| `ProjectHtmlMaterials` | `materialIds` | 可选 `string[]` | 本次参与生成的素材 id 列表：主进程 `resolveMaterials()` 按 id 从 `normalizeMaterials(proj.materials)` 里取，**顺序即提示词里的列举顺序**，取不到的 id 静默忽略；空 / 缺省 = 不带素材 |
| **`ProjectAgentPayload`** | **`taskId`** | **`string`（必填）** | 本次操作的任务 id：渲染层用 `newTaskId('html')` 生成并随 `materials` 一起传下。主进程每条 `project:html-progress` 推送都原样带回它，preload 按它分发给订阅了同一个 id 的那一份（见 ⑧ 节 `HtmlProgressPayload`、⑨ 节 `onTaskProgress`）。**缺它时 `project:generate-html` / `project:modify-html` 直接回** `内部错误：缺少任务 id（进度无法回传），请刷新页面后重试`——不静默丢进度 |
| **`ProjectNewCastPayload`** | **`taskId`** | **`string`（必填）** | 同上，画角色那一路用 `newTaskId('cast')`；`project:new-cast` 缺它同样回 `内部错误：缺少任务 id（进度无法回传），请刷新页面后重试` |
| **`ScriptGeneratePayload`** | **`cast`** | **`ScriptCastRef[]`（可选，本轮新增）** | 本次写稿要带进提示词的角色清单。**空数组与缺省等价**：主进程 `buildScriptPrompt()` 在 `Array.isArray(payload.cast) && cast.length` 为假时**整块省略**【角色】+【角色使用约定】（源码注释：「没选角色时提示词必须与加这个字段之前逐字一致」）。主进程 `script:generate` 的 handler 会先清洗：丢名字为空的、`slice(0, MAX_CAST = 20)`、`desc` 截 300 字、`units` 非正数回落 8——**它只认载荷**（不读项目 `cast/`、不读全局角色库）。**它不进 `scenes`、不进 `content.json` / `project.json`**，也不影响「HTML生成」页的 `ProjectCastMember.selected` 注入语义 |
| `ProjectHtmlResult` | `compatible` | `boolean` | HTML 是否通过 HyperFrames 合规校验 |
| `ProjectHtmlResult` | `message` | 可选 `string` | **成功分支也可能带提示**：合规校验未过 / 修改后旧视频已置空等 |

键名与主进程严格对应（`resolveMaterials` 读 `subtitleProject` / `materialIds`；`normalizeMaterials` 读 `id` / `kind` / `file` / `label` / `selected` / `addedAt`），`ProjectAgentPayload` 由 preload 用 `{ name, prompt, ...materials }` 展开合并而成——**因此 `materials` 里必须有 `taskId`**；`PreloadApi` 把 `materials` 的形参类型写成 `Omit<ProjectAgentPayload, 'name' | 'prompt'>`（必填），漏传 `taskId` 在 `typecheck` 阶段就报错。**背景音频不在素材里**：它由应用按 `project.audioFile` 直接注入 HTML 的 `<audio id="myv-bgm">`，提示词只声明「不要写音轨标签」。

> **`Script*` 七个类型的位置（本轮由六个变七个）**：`// ===== 内容脚本 Agent（script:generate）=====` 小标题之后依次是 **`ScriptCastRef`（本轮新增，带 3 行注释说明它不是项目角色）→ `ScriptGeneratePayload`（本轮多一个可选 `cast?`）→ `ScriptGenerateReply`**，随后是 `// ===== 内容脚本对话记录（按项目持久化）=====` 小标题下的 `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`（都在 ⑥ 小节内），再接 ⑦ 预览 / 转视频。`ScriptGenerateReply` **不扩展** `IpcResult`——它自己就是判别联合，失败分支额外带 `raw`；对话记录的四个类型则是普通数据载荷（`load-chat` 走 `IpcResult<ScriptChatIndex>`、`read-version` 走 `IpcResult<ScriptVersionResult>`、`append-round` 走 `IpcResult<{ versionId: string }>`）。

> **角色库三个类型的位置**：`CastLibraryMember` / `CastLibraryResult` / `ProjectCastResult` 排在 `ProjectOpenFolderOfResult` 之后、`// ===== 项目素材（图片 / 视频素材库）=====` 之前，也就是**夹在「预览」类结果与素材库之间**，前面还带一段 `// ===== 全局角色库（<userData>/cast-library/）=====` 的小标题与注释（写清「全局库是用户资产」「导入 = 复制，之后全局库再改也不会自动动它」）。它们**不扩展 `Project`**：全局库不是项目的一部分，`Project` 里只有 `cast?: ProjectCastMember[]` 这一个字段。
>
> **角色预览两个类型的位置（本轮新增）**：`ProjectCastPreviewPayload` / `ProjectCastPreviewResult` 紧跟 `ProjectSaveCastPayload` 之后、`// ===== 项目素材（图片 / 视频素材库）=====` 之前，带一段「角色预览（「这个角色长什么样」）」的注释，把「角色不是图片、而是 `window.__cast[id](x, y, u, o)` 绘制函数」「主进程内联 core.js + 角色代码拼一页自包含 HTML 落到 `<userData>/cast-preview/<id>.html`」「为什么内联而不是引用 `./cast/<id>.js`：全局角色库在 userData 下、hgpreview 只放行项目目录」三条写死。它们同样**不扩展 `Project`**——预览页是派生产物，不进 `project.json`。

### 2.6.1 ⑥ 角色动作示范（`cast:action-*` / `cast:demo`，本轮新增十个类型）

> **界面上在哪**：「角色」页 · 卡片双击（或右上「…」菜单 ·「动作示范…」）→ 动作示范弹窗：左边是会动的大图（`cast:demo`），右边是公共动作 + 本角色专属两组列表、AI 生成面板（`cast:action-*`），底下「新建动作…」打开关键帧编辑器。
>
> **为什么动作不是项目数据**：角色是**纯绘制函数** `window.__cast[id](x, y, u, o)`、自己不含时间轴；一条动作 = 「时间 → `o` 里的动画参数」的曲线。它存 `<userData>/cast-library/actions.json`，与角色库同目录、同属用户资产，**不进 `project.json`**。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `CastActionKey` | `interface` | 一个关键帧：`t`（时间点，秒，从 0 开始、落在 `[0, duration]` 内）+ `o`（这一刻的动画参数，`Record<string, number \| string>`）。键只允许 `shared/constants.ts` 的 `CAST_ACTION_PARAMS` + 角色自定义键（只有 AI 生成的动作才有） |
| `CastActionDef` | `interface` | 一条动作：`id`（slug，公共动作跨角色唯一 / 专属动作在角色内唯一）/ `name` / `duration`（秒，循环动作是「一轮」的长度）/ `loop`（`false` = 演一遍停在最后一帧）/ `keys?`（关键帧表，按 `t` 升序；与 `code` 二选一）/ `code?`（AI 生成的动作脚本 `function (t) { return { … } }`）/ `from?`（`'preset'` 内置 / `'user'` 用户自建 / `'ai'` 模型生成，只用于界面分组与文案） |
| `CastActionListResult` | `interface` | 动作列表（按角色问，一次给全）：`shared`（公共动作：内置 + 用户自建，所有角色都能演）+ `own`（这个角色的专属动作：AI 生成，或用户建的时候勾了「只给这个角色」） |
| `CastActionScope` | `type` | `'shared' \| 'own'`——动作的作用范围：公共动作库（跨角色）/ 某个角色专属 |
| `CastActionSavePayload` | `interface` | `cast:action-save` 载荷：`castId?`（从哪个角色进来的；专属动作要它）/ `scope?` / `action`（整条回写；**同 id 覆盖；`id` 为空表示新建，由主进程起一个**） |
| `CastActionRemovePayload` | `interface` | `cast:action-remove` 载荷：`castId?` / `scope?` / `actionId` |
| `CastActionGeneratePayload` | `interface` | **`cast:action-generate` 载荷（让 AI 读角色源码后生成一条专属动作）**：`castId`（角色 id，也是文件名词干）/ `taskId`（本次模型调用的任务 id，渲染层用 `utils/taskId.ts` 生成）/ `request`（要什么动作，一句话）/ `duration?`（动作时长秒：`t` 的取值范围就是 `[0, duration)`）/ `loop?`（缺省 = 循环）/ `name?`（留空 = 拿 `request` 的前几个字当名字） |
| `CastActionResult` | `interface` | 保存 / 生成一条动作的回执：`action` 恒为落盘后的那一条（渲染层直接用它替换本地状态） |
| `CastDemoPayload` | `type` | `= CastPreviewPayload`——示范页的载荷与静态预览完全一致（同一个角色、同样的尺寸信息），只是产物换成了会动的那一页 |
| `CastDemoResult` | `interface` | `cast:demo` 成功分支：`rel`（示范页相对 userData 的路径，`cast-preview/<id>.demo.html`）；渲染层用 `hgpreview://…?user=1&e=<epoch>#<动作id>` 载进 iframe，**换动作只换 hash** |

**两种动作（`keys` 与 `code` 二选一）**：

| | 关键帧动作（`keys`） | 代码动作（`code`） |
| --- | --- | --- |
| 是什么 | 时间点 + 参数值的表 | 一段纯函数 `function (t) { return { … } }` |
| 谁能用 | **所有角色通用**（只用 `CAST_ACTION_PARAMS` 里的十个参数） | **只有这个角色**（存在 `byCast[<角色id>]`，能用到角色自己的参数，如猫的尾巴） |
| 谁写 | 「新建动作…」的关键帧编辑器（不调模型） | 只有「AI 生成…」（**唯一会调模型的动作路径**） |
| 落盘校验 | `normalizeActionDef`：id 正则、时长 0.3–30、至少 2 帧、参数白名单 | 另加 `validateActionCode` 的静态白名单（禁 `window` / `document` / 定时器 / 循环 / `Math.random`，≤60 行） |

> **位置**：这十个类型在 ⑥ 节紧接 `ScriptAppendRoundPayload` 之后、`// ===== 角色动作示范（cast:action-* / cast:demo）=====` 小标题之下；`CastDemoPayload` 是 `CastPreviewPayload` 的**类型别名**（不是新结构），`CastDemoResult` 与 `CastPreviewResult` 同形（都只有一个 `rel`）。

### 2.7 ⑦ 预览 / HyperFrames 转视频（`video.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VideoRenderPayload` | `interface` | `extends RenderOverride`，即 `{ htmlPath?: string; quality?: RenderQuality; fps?: RenderFps; canvas?: RenderCanvas }`——档位字段缺省/非法时主进程不拼对应 CLI 参数；**`canvas` 不是档位而是项目属性**：渲染层把当前项目的画布值一并传下来，`video.ts` 据此往渲染入口注入**舞台 `data-width`/`data-height`（成片宽高来源）+ `<html data-resolution>`**，缺省 / 非法则落 `DEFAULT_CANVAS`（必须有个确定值，否则 CLI 读不到舞台宽高时兜底 1080×1920） |
| `VideoRenderResult` | `type` | 渲染结果联合：成功 `{ ok: true; outputVideo: string; projectDir: string }`，失败 `{ ok: false; message: string; compatible?: boolean; needPacks?: RuntimePackName[] }` |

> ⑦ 节只有上面两个类型：渲染载荷与渲染结果。渲染进度载荷 `VideoProgressPayload` 归 ⑧ 节（进度推送）。

`VideoRenderResult` **不是** `IpcResult<T>` 的实例：它的失败分支 `message` 必填，且成功分支不复用 `IpcFail` 联合；失败分支的 `compatible: false` 表示 HTML 未通过 HyperFrames 合规校验（渲染层据此区分「环境错误」与「HTML 不合规」），`needPacks` 非空表示本机缺运行环境包（渲染层据此弹下载确认框，见 `docs/runtime-pack-split.md` §5.2）。

### 2.8 ⑧ 进度推送（源码小标题逐字：「⑧ 进度推送（5 路 main → renderer；其中 `project:html-progress` 是「一条频道 + 按任务 id 分发」，所以「生成 HTML」与「画角色」可以并行、各拿各的回调，其余 4 路仍是单订阅语义）」）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `AgentStage` | `type` | **通用五阶段**：`'connecting' \| 'thinking' \| 'writing' \| 'retry' \| 'done'`——两个 Agent（HTML / 内容脚本）共用同一套阶段 |
| `AgentProgressPayload` | `interface` | **通用载荷**：`stage: AgentStage` / `thinkChars: number` / `contentChars: number` / `thinkText: string`；由 `src/main/agent/chat.ts` 的 `emit` 统一产出。**章节模式另带两个可选字段** `chapterIndex?` / `chapterTotal?`（推送「第 k/N 章」用）；**角色生成再带 `castIndex?` / `castTotal?`**（推送「角色 k/M」用，1 起）——进度都复用 `project:html-progress`，**没有新增 IPC 频道** |
| `HtmlAgentStage` | `type` | **旧名别名**：`export type HtmlAgentStage = AgentStage`——保留是为了不动既有引用 |
| `HtmlAgentProgress` | `type` | **旧名别名**：`export type HtmlAgentProgress = AgentProgressPayload` |
| `HtmlProgressPayload` | `interface` | `extends AgentProgressPayload`，额外带 `text`（`projects.ts` 的 `progressText` 生成的文案）与 **`taskId: string`（必填）**——「本次任务的 id：与发起时传入的 taskId 相同（`html-…` / `cast-…`）」，`text` 与人话文案同层；频道 `project:html-progress`（**一条频道 + 按任务 id 分发**）。**`AgentProgressPayload` 本身未改**（仍是五阶段 + `thinkChars` / `contentChars` / `thinkText` + 章节 / 角色四个可选计数） |
| `ScriptProgressPayload` | `interface` | `extends AgentProgressPayload`，额外带 `text`（`src/main/agent/script.ts` 的 `progressText` 生成的文案）；频道 `script:progress` |
| `WhisperProgressStage` | `type` | `'downloading' \| 'loading' \| 'transcribing' \| 'done' \| 'error'` |
| `WhisperProgressPayload` | `interface` | `{ id?, stage, percent?, receivedBytes?, totalBytes?, message }`；频道 `whisper:progress`（下载与转录共用，`loading` / `transcribing` 为转录两阶段） |
| `AlignProgressStage` | `type` | `'synth' \| 'assemble' \| 'done' \| 'error'` |
| `AlignProgressPayload` | `interface` | `{ stage, index?, total?, percent?, message }`；频道 `voice:align-progress` |
| `VideoProgressPayload` | `interface` | `{ text }`（HyperFrames 渲染日志行，渲染层按 `[Render:trace]` 前缀自行解析）；频道 `video:progress` |
| `UpdateStage` | `type` | `'idle' \| 'checking' \| 'available' \| 'skipped' \| 'downloading' \| 'downloaded' \| 'none' \| 'error'`（应用更新的阶段；`idle` 表示本进程尚未检查过） |
| `UpdateProgressPayload` | `interface` | `{ stage, version, currentVersion, percent, transferred, total, bytesPerSecond, message, detail? }`；频道 `update:progress`（检查结果与下载进度共用一路）。`message` 是人话文案、`detail` 是排障详情（仅 `error` 阶段非空），与 `UpdateCheckResult` 同一分层约定（见 §2.3.1） |
| `RuntimeProgressPayload` | `interface` | `{ phase, pack, percent, packs, missing, status, message, detail?, source, bytes, unpackedBytes, files, cancellable }`；频道 `runtime:progress`（运行环境分包的探测 / 下载 / 解包进度，类型定义在本文件 ③.6 节） |

**「5 路」与「7 路」两个数字的口径**（不要混用）：

- 源码 ⑧ 节小标题的「**5 路**」= **本节里定义的 5 个进度载荷类型**：`HtmlProgressPayload` / `ScriptProgressPayload` / `WhisperProgressPayload` / `AlignProgressPayload` / `VideoProgressPayload`。`UpdateProgressPayload`（③.5 节）与 `RuntimeProgressPayload`（③.6 节）定义在别的小节，因此不在这 5 个里。
- **整层实际是 7 路进度通道**：`project:html-progress` / `script:progress` / `whisper:progress` / `voice:align-progress` / `video:progress` / `update:progress` / `runtime:progress`。
- `src/preload/index.ts` 头注释写的「**6** 个进度推送通道」指其中**有模块级「只绑一次」标志**的 6 路（html / script / whisper / align / update / runtime）；`video:progress` 是**第 7 路**，直接 `ipcRenderer.on`，没有任何模块级标志。
- **html 那一路的「标志」现在只保证监听器绑一次**：回调不再是一个槽位，而是 `taskId → 回调` 的 `Map`（`_progressCbs` + `_htmlProgressBound`），订阅函数 `onTaskProgress(taskId, cb)` 返回退订函数。**其余 5 路仍是「单槽回调、后注册覆盖前注册」**。⑧ 节 `HtmlProgressPayload` 上方的源码注释把这条写死：「**一条频道 + 按任务 id 分发**：一次操作（生成 / 修改 / 画角色）一个 taskId，渲染层各自订阅各自的 id，所以多个任务可以并行、谁的进度回谁那里（不要再退回"单订阅、后注册覆盖前一个"的语义）」。
- **进度分发那一轮没有新增 / 改名任何频道**：变的只有 `project:html-progress` 一条频道内的分发方式，所以「生成 HTML」（`HtmlGenPage/index.vue`，`newTaskId('html')`）、「画角色」（`CastPage/CastEditModal.vue`，`newTaskId('cast')`）与「编动作」（`CastPage/CastActionModal.vue`，`newTaskId('act')`）可以并行。**本轮（动作示范）才改了频道**：`Cast` 组 6 → 11 条，全库 101 → 106（分组数不变）。
- **角色库的 4 个频道没有新增进度通道**：四个动作都是「点一下、等结果」，进度仍只用既有的 7 路。

`AgentProgressPayload` 与两个 `*ProgressPayload` 的分工：前者是 **Agent 调用层**的形状（`src/main/agent/chat.ts` 的 `emit` 产出、`src/main/agent/html.ts` 的 `AgentProgress` 就是它），后者是**线上载荷**（各自模块补上 `text` 文案字段后推送）。之所以把 `HtmlAgentStage` / `HtmlAgentProgress` 留成别名而不是删掉：`projects.ts`、`agent/html.ts` 里的旧引用一行都不用改。

### 2.9 ⑨ `PreloadApi`（`window.*` API 契约）

`PreloadApi` 用一个 `interface` 描述 **13** 个命名空间的完整方法签名，是「preload 实现 ↔ 渲染层消费」的唯一真源：

```ts
// 用法（源码注释）
// preload/index.ts     → const hfTools: PreloadApi['hfTools'] = { ... }   // 实现被契约校验
// preload/index.d.ts   → interface Window extends PreloadApi {}           // 消费方拿到同一签名
```

| 命名空间 | 成员数 | 成员 | 返回类型要点 |
| --- | --- | --- | --- |
| `electronAPI` | 2 | `platform`、`versions` | 非方法属性：`string` 与 `{ node; chrome; electron }` |
| `appTools` | 1 | `copyText` | `Promise<boolean>`（不走 `IpcResult`）；**`openExternal` 曾与它并列，已按用户要求整条摘除**（连同 `app:open-external` 频道与主进程 `shell.openExternal` handler），详见 `src/shared/errors.ts` §6 |
| `windowControls` | 4 | `minimize`、`toggleMaximize`、`close`、`onMaximizedChange` | 前三者 `void`（`send` 单向）；`onMaximizedChange(cb: (isMaximized: boolean) => void)` |
| `hfTools` | 4 | `openHtml`、`renderVideo`、`showInFolder`、`onProgress` | `openHtml` → `Promise<string \| null>`（**保留但渲染层当前无调用方**）；`renderVideo(htmlPath, options?: Omit<VideoRenderPayload, 'htmlPath'>)` → `Promise<VideoRenderResult>`（第二参由 `RenderOverride` 改为 `Omit<VideoRenderPayload, 'htmlPath'>`，这样 `canvas?` 能与 `quality?` / `fps?` 一起下发；`htmlPath` 已由第一参数给，故用 `Omit` 排除）；`showInFolder` → `Promise<void>`；`onProgress(cb: (data: VideoProgressPayload) => void)` |
| `settingsTools` | 6 | `get`、`save`、`saveRender`、`saveUpdater`、`test`、**`pickRuntimePack`** | `get` → `Promise<AppSettings>`（**不经 `ok` 包裹**）；`save(customModel)` / `saveRender(render)` / `saveUpdater(updater)` → `Promise<IpcResult<SettingsSaveResult>>`（preload 分别包装为 `{ customModel }` / `{ render }` / `{ updater }`）；`test(customModel)` → `Promise<IpcResult>`（失败分支可能带 `detail` / `needConfig`，见 §2.1）；`pickRuntimePack()` → `Promise<IpcResult<{ pack?: RuntimePackName }>>`（弹文件框选 `ffmpeg.7z` / `hyperframes.7z`，导入 `userData/runtime/local-import/`；取消时 `{ ok:false, canceled:true }`，导入成功后由调用方接着 `runtimeTools.prepare()`） |
| `voiceTools` | 19 | `getConfig`、`getSaveDir`、`saveConfig`、`pickAudio`、`pickDir`、`listGenerated`、`create`、`list`、`listSystemVoices`、`listAll`、`listModels`、`getProfiles`、`saveProfile`、`deleteProfile`、**`deleteCloudVoice`**、`synth`、`synthAligned`、`cancelAlign`、`onAlignProgress` | 见下 |
| `whisperTools` | 12 | `status`、`download`、`delete`、`setCurrent`、`addModel`、`updateModel`、`removeModel`、`openDir`、`pickAudio`、`projectAudio`、`transcribe`、`onProgress` | 见下 |
| `projectTools` | **27** | `list`、`create`、`load`、`saveSubtitle`、`saveContent`、`generateHtml`、`modifyHtml`、`downloadHtml`、`exportSrt`、`readHtml`、`saveHtml`、`previewHtml`、`pickAudio`、`setAudio`、`clearAudio`、**`pickMedia`、`addMaterials`、`saveMaterials`**、`extractVideoAudio`、`openFolder`、`openFolderOf`、`delete`、`saveVideo`、`setRender`、**`setCanvas`**、**`saveCast`**、**`onTaskProgress`** | 见下（素材库那次是 **3 换 3**；之后 `setCanvas` +1、角色库 +4、项目角色 +2、角色预览 +1 ⇒ 33；**本轮角色频道整体搬进 `Cast` 组、方法搬进 `castTools`**：下线 `listCastLibrary` / `promoteCast` / `importCast` / `removeCastFromLibrary` / `newCast` / `castPreview` 六个，只剩 `saveCast` ⇒ **33 → 27**） |
| **`scriptTools`** | **7** | **`generate`、`loadChat`、`appendRound`、`readVersion`、`setActiveVersion`、`clearChat`、`onProgress`** | `generate(payload: ScriptGeneratePayload)` → `Promise<ScriptGenerateReply>`（不经 `IpcResult`，成功 / 失败形状见 ⑥ 节）；`loadChat(name: string)` → `Promise<IpcResult<ScriptChatIndex>>`；`appendRound(payload: ScriptAppendRoundPayload)` → `Promise<IpcResult<{ versionId: string }>>`；`readVersion(name: string, versionId: string)` → `Promise<IpcResult<ScriptVersionResult>>`；`setActiveVersion(name: string, versionId: string)` / `clearChat(name: string)` → `Promise<IpcResult>`；`onProgress(cb: (data: ScriptProgressPayload) => void)` → `void`（单订阅）。注释：**生成只做「模型调用 + 解析」，不写项目文件**（场景落盘走 `projectTools.saveContent`，由渲染层自动保存触发）；5 个 chat 方法管的是**对话记录**（`projects/<名>/chat/`：`index.json` + `versions/<id>.json`），与 `content.json` 无关 |
| **`castTools`** | **12** | **`list`、`create`、`recreate`、`saveMeta`、`remove`、`preview`、`listActions`、`saveAction`、`removeAction`、`generateAction`、`demo`、`onTaskProgress`** | 见下。前 6 个是角色本身（`cast:list` / `create` / `recreate` / `save-meta` / `remove` / `preview`），后 5 个是**动作示范（本轮新增）**，`onTaskProgress` 与 `projectTools` 共用同一条 `project:html-progress` 与同一张 `taskId → 回调` 订阅表 |
| `updateTools` | 9 | `version`、`check`、`download`、`cancel`、`install`、**`status`**、`openLog`、**`changelog`**、`onProgress` | 见下 |
| `runtimeTools` | 4 | `status`、`prepare`、**`cancel`**、`onProgress` | `status()` → `Promise<RuntimeProgressPayload>`；`prepare(packs?: RuntimePackName[])` → `Promise<IpcResult>`（省略 `packs` = 全部缺的包；忙碌期重复调用返回 `{ ok:false, message }`）；`cancel()` → `Promise<IpcResult>`（中断下载 / 解包并清半成品，成功后 `message` 为「已取消下载」）；`onProgress(cb: (data: RuntimeProgressPayload) => void)`（单订阅） |
| `legacyTools` | 2 | `status`、`resolve` | `status()` → `Promise<LegacyDataInfo \| null>`；`resolve(action: LegacyResolveAction)` → `Promise<LegacyResolveResult>`（preload 只把 `action` 字符串透传，见 §2.3.3） |

`voiceTools` 逐个签名（含未单独命名的内联载荷）：

| 方法 | 签名要点 |
| --- | --- |
| `getConfig()` | `Promise<IpcResult<VoiceConfigResult>>` |
| `getSaveDir(payload: VoiceSaveDirPayload)` | `Promise<IpcResult<VoiceSaveDirResult>>` |
| `saveConfig(payload: VoiceSaveConfigPayload)` | `Promise<IpcResult<SettingsSaveResult>>`（**按厂家**保存：`{ provider?, config }`） |
| `pickAudio()` | `Promise<string \| null>` |
| `pickDir()` | `Promise<IpcResult<{ dir: string }>>`（取消时为 `{ ok: false, canceled: true }`） |
| `listGenerated()` | `Promise<IpcResult<{ items: GeneratedAudioItem[]; total: number }>>` |
| `create(audioPath: string, preferredName: string, targetModel: string)` | `Promise<IpcResult<VoiceCreateResult>>`（3 个位置参数，preload 组装成 `{ audioPath, preferredName, targetModel }`；未配置 Key 时失败分支带 `needConfig: 'voice'`） |
| `list()` | `Promise<IpcResult<{ voices: ClonedVoice[]; total: number }>>` |
| `listSystemVoices()` | `Promise<IpcResult<{ voices: SystemVoiceItem[]; total: number }>>` |
| `listAll()` | `Promise<IpcResult<{ voices: VoiceListItem[]; total: number; cloudMessage: string }>>` |
| `listModels()` | `Promise<IpcResult<{ models: VoiceModel[]; providers: VoiceProviderView[] }>>` |
| `getProfiles()` | `Promise<IpcResult<VoiceProfilesResult>>` |
| `saveProfile(profile: VoiceProfileInput)` | `Promise<IpcResult<VoiceProfilesResult>>`（线上载荷为 `{ profile }`） |
| `deleteProfile(key: string)` | `Promise<IpcResult<VoiceProfilesResult>>`（线上载荷为 `{ key }`） |
| `deleteCloudVoice(voice: string)` | `Promise<IpcResult<VoiceProfilesResult & { voice: string }>>`（线上载荷 `{ voice }`）——**删除云端克隆音色，不可撤销**；成功后主进程会一并清掉该音色的本地映射并回带最新映射表 |
| `synth(text, voice, projectName, saveDir, targetModel, audioName, defaultOut)` | 7 个位置参数 → `Promise<IpcResult<VoiceSynthResult>>` |
| `synthAligned(payload: VoiceAlignPayload)` | `Promise<IpcResult<VoiceAlignResult>>`（payload 原样透传） |
| `cancelAlign()` | `void`（`send` 单向） |
| `onAlignProgress(cb: (data: AlignProgressPayload) => void)` | `void`（单订阅） |

`updateTools` 逐个签名（应用自更新）：

| 方法 | 签名要点 |
| --- | --- |
| `version()` | `string`（**同步**，`sendSync('update:version')`，首屏显示版本号用） |
| `check()` | `Promise<IpcResult<UpdateCheckResult>>`（成功分支平铺 `state` / `version` / `currentVersion` / `message` / `detail?`） |
| `download()` | `Promise<IpcResult<{ version: string }>>`（未处于 `available` / `skipped` 时失败分支带 `message`） |
| `cancel()` | `Promise<IpcResult>`（异常分支带 `message` + `detail`） |
| `install()` | `Promise<IpcResult>`（未下载完成或本机有长任务时失败分支带 `message`） |
| `status()` | `Promise<UpdateProgressPayload>`（取一次主进程当前更新状态；主进程 `state` 常驻、跨设置页挂载持续存在，用于补齐「启动静默检查」那次失败——它发生在页面订阅 `update:progress` 之前） |
| `openLog()` | `Promise<IpcResult<{ path: string }>>`（在文件管理器里定位 `userData/updater.log`，没有日志则打开 `userData` 目录；**不依赖 electron-updater 是否加载成功**） |
| `changelog()` | `Promise<IpcResult<{ text: string }>>`（取随包 `CHANGELOG.md` 的**原文**：主进程只负责定位与读取 `app.getAppPath()/CHANGELOG.md`，**分块与行内排版全在渲染层** `@renderer/utils/changelog.ts`；提供方是设置页「应用更新」的「查看更新日志」按钮与 `ChangelogDialog.vue`） |
| `onProgress(cb: (data: UpdateProgressPayload) => void)` | `void`（单订阅） |

`scriptTools` 逐个签名（内容脚本 Agent + 对话记录）：

| 方法 | 签名要点 |
| --- | --- |
| `generate(payload: ScriptGeneratePayload)` | `Promise<ScriptGenerateReply>`——**不走 `IpcResult`**：成功分支 `{ ok: true, scenes, totalChars, message? }`、失败分支 `{ ok: false, message, raw?, needConfig?, title? }`。`needConfig` / `title` 是「配置类」分类（主进程用 `configTargetOf(msg)` 补），`raw` 是解析失败时的模型原文（截 2 万字符），界面折叠展示。**载荷里可选 `cast`（本轮新增）**：preload 写成 `generate: (payload) => ipcRenderer.invoke(IPC.Script.Generate, payload)`，**整对象透传**，所以加这个字段既没改 preload、也没改频道 |
| `loadChat(name: string)` | `Promise<IpcResult<ScriptChatIndex>>`——读 `projects/<项目名>/chat/index.json`，成功分支 `{ ok: true, rounds, activeVersionId }`（**不含 scenes**）；**缺项目名回 `缺少项目名`**，索引不存在 / 损坏、副本已丢的条目都被主进程剔除 |
| `appendRound(payload: ScriptAppendRoundPayload)` | `Promise<IpcResult<{ versionId: string }>>`——**先写副本** `chat/versions/<新 id>.json`、**再更新索引**并把 `activeVersionId` 指向新版本（顺序不能反：写索引会顺带清理孤儿副本）；没有可用场景回 `这一轮没有场景，未写入对话记录`，写失败回 `保存对话记录失败：…` |
| `readVersion(name: string, versionId: string)` | `Promise<IpcResult<ScriptVersionResult>>`——读某一版副本；`versionId` 不在 `^[A-Za-z0-9_-]{1,64}$` 白名单内回 `非法的版本 id`，副本不在回 `这一版脚本读不到了（副本可能已被删除）`；**只读、无副作用** |
| `setActiveVersion(name: string, versionId: string)` | `Promise<IpcResult>`——把某一版记为「当前应用」（只改索引的 `activeVersionId`，**不写 `content.json`**）；该版不在索引里回 `这一版不在对话记录里` |
| `clearChat(name: string)` | `Promise<IpcResult>`——删掉整个 `chat/` 目录（索引 + 全部版本副本）；**不动 `content.json` / 编辑器里的场景** |
| `onProgress(cb: (data: ScriptProgressPayload) => void)` | `void`（单订阅；载荷 = `AgentProgressPayload` + 中文 `text` 文案） |

**`castTools` 的角色 6 个成员（逐个签名）**：

> 上一版挂在 `projectTools` 下的角色方法（`listCastLibrary` / `promoteCast` / `importCast` / `removeCastFromLibrary` / `newCast` / `castPreview`）**已整组下线**：角色只有全局一份，频道搬进 `Cast` 组、方法也搬进 `castTools`；`projectTools` 只保留 `saveCast`（本片用哪几个）。

| 方法 | 签名要点 |
| --- | --- |
| `list()` | `Promise<IpcResult<CastLibraryResult>>`——无载荷（库是应用级资产，不需要项目名）；成功分支 `{ ok: true, members: CastLibraryMember[] }`，条目带 `missing`；索引读不出来回 `{ ok:false, message: '全局角色库索引读取失败：…' }` |
| `create(brief: CastCreatePayload)` | `Promise<IpcResult<CastResult>>`——调一次模型画一个新角色并写进库（`brief.taskId` 必填，进度按它路由） |
| `recreate(id: string, request: string, taskId: string)` | `Promise<IpcResult<CastResult>>`——调一次模型按 `request` **重画库里这个角色**（覆盖库里的那份代码；id / 身高不变） |
| `saveMeta(patch: CastSaveMetaPayload)` | `Promise<IpcResult<CastResult>>`——只改元数据（名字 / 描述 / 画风 / 身高 / 是否水彩），**不调模型** |
| `remove(id: string)` | `Promise<IpcResult>`——从库里删掉（不动项目里已同步的副本；主进程**连带清掉它的专属动作**） |
| `preview(id: string, options?: Omit<CastPreviewPayload, 'id'>)` | `Promise<IpcResult<CastPreviewResult>>`——**静态预览（一帧）**：读库里那份代码 + 内置 `core.js`，拼一页自包含 HTML 写到 `<userData>/cast-preview/<id>.html`，成功分支 `{ ok: true, rel }`；只读角色代码、不改任何文件；`options` 由 preload 展开平铺进载荷（`{ id, ...(options \|\| {}) }`） |

**`castTools` 的动作 5 个成员（本轮新增，界面上是「角色」页 · 卡片双击 /「…」菜单 · 动作示范…）**：

| 方法 | 签名要点 |
| --- | --- |
| `listActions(castId: string)` | `Promise<IpcResult<CastActionListResult>>`——**列动作**：`{ ok, shared, own }`；`shared` = 内置 14 条 + 用户自建公共动作，`own` = 这个角色的专属动作 |
| `saveAction(payload: CastActionSavePayload)` | `Promise<IpcResult<CastActionResult>>`——保存一条**关键帧**动作（同 id 覆盖；`action.id` 为空 = 新建，由主进程起 id），成功分支 `{ ok, action }` |
| `removeAction(payload: CastActionRemovePayload)` | `Promise<IpcResult>`——删一条动作（专属动作要带 `castId`；内置动作删不掉） |
| `generateAction(payload: CastActionGeneratePayload)` | `Promise<IpcResult<CastActionResult>>`——**让 AI 读这个角色的源码后生成一条专属动作**（**唯一会调模型的动作路径**：一次模型调用，进度按 `taskId` 路由，日志 `html-agent/cast-action.jsonl`），成功分支 `{ ok, action }` |
| `demo(id: string, options?: Omit<CastDemoPayload, 'id'>)` | `Promise<IpcResult<CastDemoResult>>`——**会动的示范页**：返回相对路径 `rel`（`cast-preview/<id>.demo.html`），渲染层自行拼 `hgpreview://…?user=1&e=<epoch>#<动作id>`；换动作只改 hash、不重新加载文档 |
| `onTaskProgress(taskId, callback)` | `() => void` 退订函数——**与 `projectTools.onTaskProgress` 是同一条频道、同一张订阅表**（画角色 / 编动作 / 生成 HTML 可以并行，互不顶掉） |

> **`saveCast` 仍在 `projectTools`**：`saveCast(name, cast: ProjectCastSelection[])` → `Promise<IpcResult<ProjectCastResult>>`，只回 `{ ok, cast }`；它管的是「本片用哪几个角色」，与角色库 / 动作库都无关。

`whisperTools` / `projectTools` 的返回类型要点：

| 命名空间 | 方法 | 返回类型要点 |
| --- | --- | --- |
| `whisperTools` | `status()` | `Promise<IpcResult<WhisperStatusResult>>` |
| `whisperTools` | `download(id)` / `delete(id)` / `setCurrent(id)` | `IpcResult<{ id; sizeBytes; message? }>` / `IpcResult<{ id; removed }>` / `IpcResult<{ id }>` |
| `whisperTools` | `addModel(payload)` / `updateModel(payload)` / `removeModel(payload)` | 传 `WhisperAddModelPayload` / `WhisperUpdateModelPayload` / `{ id: string }`，返回 `IpcResult<{ id; message? }>`（写操作成功分支也可能回带 `message`，如「本地已有模型文件，无需重复下载」） |
| `whisperTools` | `openDir(which: 'models' \| 'cli')` | `IpcResult<{ path: string }>` |
| `whisperTools` | `pickAudio()` | `Promise<string \| null>` |
| `whisperTools` | `projectAudio(name)` | `Promise<IpcResult<WhisperProjectAudioResult>>` |
| `whisperTools` | `transcribe(payload: WhisperTranscribePayload)` | `Promise<IpcResult<WhisperTranscribeResult>>` |
| `whisperTools` | `onProgress(cb)` | `void`，回调 `(data: WhisperProgressPayload) => void`（单订阅） |
| `projectTools` | `list()` | `Promise<ProjectMeta[]>`（**不走 `IpcResult`**） |
| `projectTools` | `create` / `saveSubtitle` / `saveContent` / `saveVideo` / `setRender` / **`setCanvas`** | `Promise<IpcResult<ProjectSaveResult>>`（`setRender(name, render \| null)` 传 `null` 即清除项目级渲染档位覆盖；**`setCanvas(name, canvas)`** 写成片画布方向——白名单校验在主进程，值变化时主进程会把已有的 `videoPath` 置空） |
| `projectTools` | `load(name)` | `Promise<Project \| null>`（**不走 `IpcResult`**；项目名为空时主进程返回 `null`，见 §5；非空时返回的 `materials` 已由主进程规范化。**返回的是完整 `Project`（含 `subtitle` / `content`），不是 `ProjectIndex`**——主进程用 `ensureProject()` 把索引与两个正文文件拼好了） |
| `projectTools` | `generateHtml` / `modifyHtml(name, prompt, materials: Omit<ProjectAgentPayload, 'name' \| 'prompt'>)` | `Promise<IpcResult<ProjectHtmlResult>>`（**`materials` 必填、且其中的 `taskId: string` 必填**；缺 `taskId` 时主进程直接回 `内部错误：缺少任务 id（进度无法回传），请刷新页面后重试`，不静默丢进度。失败分支可能带 `needConfig` / `title`：配置类错误由主进程 `projects.ts` 用 `configTargetOf()` 补分类；`materials` 里带的是 `materialIds` 与 `taskId`，不是路径） |
| `projectTools` | `downloadHtml` / `exportSrt` | `Promise<IpcResult<ProjectDownloadResult>>`（`downloadHtml` 在章节模式下额外内联 `pages/` / `cast/` / `core.js`，导出物是单个自包含 HTML） |
| `projectTools` | `readHtml` / `saveHtml` / `previewHtml` | `IpcResult<ProjectReadHtmlResult>` / `IpcResult<ProjectHtmlResult>` / `IpcResult<ProjectPreviewHtmlResult>` |
| `projectTools` | `pickAudio()` | `Promise<string \| null>` |
| `projectTools` | `pickMedia(kind: ProjectMaterialKind)` | `Promise<string[]>`（**不走 `IpcResult`**：取消 / 无窗口返回空数组；图片可多选、视频单选） |
| `projectTools` | `addMaterials(name, paths: string[])` | `Promise<IpcResult<ProjectMaterialsResult>>`（复制入库 + 登记；「部分成功」时 `ok: true` 且 `message` 说明跳过了几个） |
| `projectTools` | `saveMaterials(name, materials: ProjectMaterial[])` | `Promise<IpcResult<ProjectMaterialsResult>>`（整份列表回写：**移除与勾选共用**） |
| `castTools` | **`list` / `preview`** | 见上面那张「角色 6 个成员」表：`Promise<IpcResult<CastLibraryResult>>` / `Promise<IpcResult<CastPreviewResult>>`（成功分支 `{ rel }`，`options` 用 `Omit<CastPreviewPayload, 'id'>`） |
| `castTools` | **`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`** | 见上面那张「动作 5 个成员」表：`CastActionListResult` / `CastActionResult` / `IpcResult` / `CastActionResult` / `CastDemoResult`（`demo` 的 `options` 用 `Omit<CastDemoPayload, 'id'>`） |
| `projectTools` | `saveCast(name, cast: ProjectCastSelection[])` | `Promise<IpcResult<ProjectCastResult>>`——**本片用哪几个角色**（勾选 / 取消都走它），主进程复制选中的角色进 `<项目>/cast/` 并重刷页面 |
| `projectTools` | `setAudio` / `extractVideoAudio` | `IpcResult<ProjectSetAudioResult>`（含可选 `htmlUpdated`，表示注入音轨改写了 `index.html`） / `IpcResult<ProjectSetAudioResult>`（后者**界面入口暂未开放**，签名保留） |
| `projectTools` | `clearAudio` / `openFolder` / `delete` | `Promise<IpcResult>`（无载荷）；主进程 `project:clear-audio` 实际上还返回 `htmlUpdated`（是否摘掉了 HTML 里的注入音轨），但**未纳入本契约**，渲染层不使用该字段 |
| `projectTools` | `openFolderOf(dirOrFile)` | `Promise<IpcResult<ProjectOpenFolderOfResult>>` |
| `projectTools` | `onTaskProgress(taskId, cb)` | `onTaskProgress(taskId: string, callback: (data: HtmlProgressPayload) => void): () => void`——**一条频道 + 按任务 id 分发（不是单订阅）**：`taskId` 为空或 `callback` 不是函数时直接返回空退订函数；同一 `taskId` 重复订阅以最后一次为准（不影响别的 `taskId`）；**返回退订函数**（只在 Map 里仍指向同一个回调时才删除）。调用方必须自己先生成 `taskId`（`@renderer/utils/taskId` 的 `newTaskId`）并**先订阅再调用**。源码注释：「同一个 taskId 重复订阅以最后一次为准（与原有的单订阅语义一致，但不影响别的 taskId）」 |

## 3. 关键流程或结构

### 3.1 三端共享路径

```
                        src/shared/types.ts
      ┌──────────────────────┬────────────────────────┬─────────────────────┐
      ▼                      ▼                        ▼                     ▼
  src/main/*             src/preload/index.ts    src/preload/index.d.ts   渲染层
  (14 个模块 import 类型)  (导入 PreloadApi + 10 个类型)  (导入 PreloadApi)   （经 Window 间接获得）
```

`tsconfig.web.json` 的 `include` 含 `"src/shared/**/*.ts"` 与 `"src/preload/index.d.ts"`；`tsconfig.node.json` 覆盖主进程与 `src/preload/index.ts`；`npm run typecheck` 依次跑 `tsconfig.node.json`、`tsconfig.web.json`、`tsconfig.agent.json`，因此本文件的任何字段改动会同时触发三端编译报错定位。

### 3.2 设置数据的读写闭环

1. `AppSettings` 是 `userData/settings.json` 的完整镜像；主进程 `settings.ts` 负责读写与合并，`whisper` 分区由 `WhisperSettings` 描述。
2. 渲染层通过 `window.settingsTools.get()` 取到 `AppSettings`，通过 `window.settingsTools.save(customModel)` 提交 `CustomModelConfig`（**`reasoningEffort` 随整个对象一起提交；`SettingsSavePayload.customModel` 仍是整个 `CustomModelConfig`，所以新字段走 preload 时 preload 与 IPC 频道都没改**），通过 `window.voiceTools.saveConfig({ provider, config })` 提交**某个厂家**的部分语音配置（`VoiceSaveConfigPayload`）；两者的成功分支都是 `IpcResult<SettingsSaveResult>`，由 `voice:save-config` / `settings:save` 回带 `settings`。
3. 音色映射以 `Record<string, VoiceProfile>` 存储，`voiceTools.saveProfile(profile)` / `deleteProfile(key)` 按 key 增删，入参用 `VoiceProfileInput`（`name` / `type` 可缺省），线上载荷分别是 `VoiceProfilePayload` / `VoiceProfileKeyPayload`。
4. whisper 分区即以 `WhisperSettings` 落盘，`whisperTools.addModel/updateModel/removeModel` 对应 `customModels` 数组的增删改，载荷为 `WhisperAddModelPayload` / `WhisperUpdateModelPayload` / `WhisperIdPayload`。

### 3.3 项目素材的读写闭环

1. **选文件**：`projectTools.pickMedia(kind)` → `project:pick-media`，主进程按 `kind` 给扩展名过滤（白名单来自 `src/shared/constants.ts`），返回**外部绝对路径数组**（不落盘、不登记）。
2. **入库**：`projectTools.addMaterials(name, paths)` → `project:add-materials`，主进程 `copyMaterialIntoProject()` 把文件复制进项目 `images/` / `video/`，再以 `newMaterialId()` 生成 id 登记进 `proj.materials`（新素材 `selected: true`），返回 `ProjectMaterialsResult`（`materials` = 落盘后的完整列表，部分成功时另有 `message`）。
3. **勾选 / 移除**：渲染层持完整列表，改动后整体回写 `projectTools.saveMaterials(name, materials)` → `project:save-materials`，主进程 `normalizeMaterials()` 规范化后覆盖落盘（**移除只摘登记、不删文件**）。
4. **读回**：`project:load` 返回 `{ ...proj, materials: normalizeMaterials(proj.materials) }`，因此渲染层拿到的永远是通过校验的列表；`HtmlGenPage/MaterialsSection.vue` 每次写操作成功后调 `refreshProject()`，把最新列表放进 `appState.project.materials`。
5. **进提示词**：生成 / 修改时提交 `ProjectHtmlMaterials.materialIds`（勾选项的 id），主进程 `resolveMaterials()` 按 id 过滤、`buildMaterialBlock()` 拼「【图片素材】/【视频素材】」两段。

### 3.4 项目正文的读写闭环（`ProjectIndex` ↔ `Project`）

1. **磁盘形状**：`project.json` 是 `ProjectIndex`（只有索引）；字幕正文在 `subtitle.txt`、内容脚本正文在 `content.json`。
2. **读出**：`project:load` → 主进程 `ensureProject(name)` = `readProject()`（索引）+ `readSubtitle(name, legacySub)` + `readContent(name, legacyContent)`，得到完整 `Project` 后只做两件事：`videoPath` 换成绝对路径、`materials` 规范化。**对外返回结构不变**，因此 `projectTools.load(name)` 的签名与渲染层消费方式都不用改。
3. **写入**：`project:save-content` 先 `normalizeContent` 再 `writeContent(name, content)`（写 `content.json`），随后 `writeProject(proj)` 只写索引；`project:save-subtitle` 仍然直接写 `subtitle.txt` + 更新 `subtitleCount`，随后 `writeProject(proj)`。
4. **兼容**：老项目的内联 `subtitle` / `content` 只作回退来源（字幕**内联优先**、脚本**文件优先**），下一次任意 `writeProject` 会把正文落成文件并把这两个字段从索引里剥掉——不需要一次性批量迁移。
5. **读侧的 `ProjectIndex` 只在主进程出现**：`readProject` 的返回类型；渲染层通过 `PreloadApi` 拿到的永远是完整 `Project`，所以 `ProjectIndex` 不会被误当成渲染层契约的一部分。

### 3.5 主进程 register 模式

```ts
// src/main/*.ts 的统一签名（示意）
export function register(ctx: RegisterCtx): void { /* 用 ctx.getWindow() 拿窗口发消息 */ }
```

`RegisterCtx` 用 `getWindow: () => BrowserWindow | null` 而非 `window: BrowserWindow`，使各功能模块在窗口尚未创建时也能安全加载；每个推送型频道（`whisper:progress` 等）发送前都需对 `null` 做判空。

### 3.6 `PreloadApi` 契约如何生效

1. `src/preload/index.ts` 的 **13** 个 `contextBridge` 对象分别标注为 `PreloadApi['electronAPI']`、`PreloadApi['hfTools']` … —— 方法名、参数顺序、返回类型写错会在 `tsconfig.node.json` 阶段直接编译失败（实现被契约校验）。
2. `src/preload/index.d.ts` 只有 `import type { PreloadApi } from '../shared/types'` + `declare global { interface Window extends PreloadApi {} }`，不再自己定义任何类型；渲染层看到的 `window.*` 与 preload 实现同源。
3. 因此「改契约」变成**只改本文件 ⑨ 节**这一件事：两端同时生效。⑨ 节注释同时指明命名空间与 IPC 频道的对应关系见 `src/shared/ipc.ts`——该行注释已同步为「**13 个命名空间 ↔ 12 组频道常量**」，与 `PreloadApi` 的定义和 `src/shared/ipc.ts` 的实际分组一致。

### 3.7 `IpcResult` 的判别联合与收窄

1. 调用方先 `const taskId = newTaskId('html')`、`const off = window.projectTools.onTaskProgress(taskId, cb)`，再 `const res = await window.projectTools.generateHtml(name, prompt, { ...materials, taskId })`（`taskId` 随 `materials` 一起下发，必须在调用前就订阅好）。
2. 判 `if (res.ok)` → TS 收窄到 `{ ok: true } & ProjectHtmlResult`，可平铺访问 `res.htmlPath` / `res.compatible` / `res.message`（业务字段直接平铺，没有 `data` 包装）。
3. 判 `else` → 收窄到 `IpcFail`，可安全读取 `res.message`（以及排障用的 `res.detail`），并按 `res.canceled` 区分「用户取消」与「真实失败」；若 `res.needConfig` 为真，则说明这是**配置类**失败（渲染层据此弹 `useConfigPrompt` 的「去设置 / 取消」框，`res.title` 由主进程一并给出）。

### 3.8 全局角色库与动作库的读写闭环（`<userData>/cast-library/`）

1. **磁盘形状**：`<userData>/cast-library/index.json`（`{ members: ProjectCastMember[] }`）+ `<id>.js`（角色绘制代码）+ **`actions.json`**（`{ shared: CastActionDef[], byCast: { [角色id]: CastActionDef[] } }`）。它**不在项目目录里**，也不进 `project.json`：库是**用户资产**（可备份、可迁移、跨项目复用），`vendor/` 是应用资源（升级会覆盖），两者刻意分开。
2. **列库**：`castTools.list()` → `cast:list`，主进程读索引、逐条 `libraryFileExists()` 判文件在不在，映射成 `CastLibraryMember`（多一个 `missing`）回 `IpcResult<CastLibraryResult>`。**纯读**，不写任何东西。
3. **新建 / 改画法 / 改信息 / 删除**：`castTools.create` / `recreate` / `saveMeta` / `remove`；删除时主进程连带清掉这个角色在 `actions.json` 里的专属动作。
4. **静态预览**：`castTools.preview(id, { units, title, uses })` → `cast:preview`，读库里那份代码 + 内置 `core.js`，拼一页自包含 HTML 写到 `<userData>/cast-preview/<id>.html`，回 `{ rel }`（**一帧**）。
5. **动作列表 / 保存 / 删除**：`castTools.listActions(castId)` / `saveAction(payload)` / `removeAction(payload)` → `cast:action-list` / `save-action` / `remove-action`；关键帧动作由界面「新建动作…」写，**不调模型**。
6. **AI 生成专属动作（唯一会调模型的动作路径）**：`castTools.generateAction(payload)` → `cast:action-generate`，读角色源码 → 提示词 → 模型回一段 `function (t) { … }` → 静态校验 → 存进 `byCast[<角色id>]`，回 `{ action }`；进度按 `taskId` 路由，日志 `html-agent/cast-action.jsonl`。
7. **会动的示范页**：`castTools.demo(id, { units, title, uses })` → `cast:demo`，把 `core.js` + 角色代码 + 全部动作拼成 `<userData>/cast-preview/<id>.demo.html`，回 `{ rel }`；渲染层用 `hgpreview://…?user=1&e=<epoch>#<动作id>` 载进 iframe，**换动作只改 hash**。
8. **为什么是「复制」不是「引用」**：预览 / 示范走 `hgpreview://` 自定义协议、只放行项目目录（`?user=1` 那组白名单目录除外）；渲染走 HyperFrames CLI 的静态服务器、root 只有「编译产物目录 + 项目目录」两级。所以生成前必须把选中的角色**复制**进 `<项目>/cast/`，而预览页只能由主进程内联成一页落在放行目录里。
7. **看长相（本轮新增，本轮不复制任何文件）**：`castTools.preview(name, id, { units, title, from: 'project' | 'lib', uses })` → `project:cast-preview`，主进程按 `from` 读**项目或库里**那份 `cast/<id>.js`（库里那份只读，**不复制**），`syncCoreLib()` 后取项目里的 `core.js`（没有就退回 `hfEnv.coreSource()`），用 `main/cast/preview.ts` 把「core.js + 角色代码 + 一次调用」拼成一页自包含 HTML，写到 `<userData>/cast-preview/<id>.html`，回 `IpcResult<ProjectCastPreviewResult>`（`{ rel }`）。渲染层用 `rel` 拼 `hgpreview://p/…` 载进 `iframe`，由浏览器把代码真跑一遍（**静态一帧**）。为什么不用 `<script src="./cast/<id>.js">` 直接引：库里那份在 `<userData>/cast-library/` 下，`hgpreview://` 只放行项目目录，页面根本读不到——内联才让同一个模板同时服务「项目角色」与「库里的角色」。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖（仅类型） | `electron` | 仅引入 `BrowserWindow` 类型（`ConfigTarget` 定义在本文件内，不需要额外 import） |
| 被 import | `src/main/settings.ts` | `AppSettings`、`CustomModelConfig`、`RegisterCtx`、`VoiceProfile`、`VoiceProviderConfig`、`VoiceSettings`、`VoiceTTSConfig`（旧结构，迁移来源）、`WhisperCustomModel` |
| 被 import（+ 再导出） | `src/main/projects.ts` | `RegisterCtx`、`ProjectAgentPayload`、`ProjectExportSrtPayload`、`ProjectNamePayload`、`ProjectSaveContentPayload`、`ProjectSaveHtmlPayload`、`ProjectSaveSubtitlePayload`、`ProjectSetAudioPayload`、`ProjectSetVideoPayload`、**`ProjectMaterial`、`ProjectMaterialKind`、`ProjectAddMaterialsPayload`、`ProjectPickMediaPayload`、`ProjectSaveMaterialsPayload`**、**`ProjectSetCanvasPayload`、`RenderCanvas`**、**`ProjectIndex`**、**`CastLibraryResult`、`ProjectCastResult`**、**`ProjectCastMember`、`ProjectNewCastPayload`、`ProjectNewCastResult`、`ProjectSaveCastPayload`**、**`ProjectCastPreviewPayload`、`ProjectCastPreviewResult`（本轮新增的角色预览载荷 / 结果）**；并 `export type { ContentScript, Project, Scene, SubtitleLine }` 再导出四个项目结构（**`ProjectIndex` 只 import、不再导出**） |
| 被 import（仅类型） | **`src/main/cast/library.ts`（本轮新增）** | **`ProjectCastMember`** —— 全局库条目的读写与合并都只用这一个类型（`CastLibraryMember` 的 `missing` 由 `projects.ts` 在 handler 里加，库模块本身不认识界面那层） |
| 被 import（仅类型） | `src/renderer/src/pages/HtmlGenPage/CastSection.vue` | **`ProjectCastMember`**（项目角色条目，含 `selected` 的勾选态；「HTML生成」页里它渲染成一张素材卡） |
| 被 import（仅类型） | `src/renderer/src/pages/HtmlGenPage/CastLibraryModal.vue` | **`CastLibraryMember`**（库弹窗的格子类型，`m.missing` 的判据；选中态是组件内的 `picked: string[]`，不写回类型） |
| 被 import（仅类型） | `src/renderer/src/pages/HtmlGenPage/CastCreateModal.vue` | **`ProjectCastMember`**（「画成功」那一步的结果类型：`created: Ref<ProjectCastMember \| null>`，取 `id` / `units` / `name` / `uses` 喂给大图 `CastShot`） |
| 被 import（仅类型） | `src/main/cast/table.ts` / `src/main/cast/inject.ts` | `cast/table.ts` 只 `import type { ProjectCastMember }`（角色表结构）；`cast/inject.ts` **不 import 任何类型**（纯字符串变换） |
| 被 import（仅类型） | `src/renderer/src/composables/useAppStore.ts` | `ProjectMaterial`（`ProjectState.materials` 的元素类型）、**`RenderCanvas`**（`ProjectState.canvas` 的类型）、`ProjectMeta`（并 `export type { ProjectMeta }` 再导出） |
| 被 import | `src/main/index.ts` | `RegisterCtx`、`LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`（后三者服务于 `legacy:status` / `legacy:resolve`） |
| 被 import | `src/main/whisper.ts` | `RegisterCtx`、`WhisperCustomModel` 与全部 `Whisper*Payload`（含 `WhisperProgressPayload`） |
| 被 import | `src/main/voice/api.ts` | `RegisterCtx`、**`ConfigTarget`**（`voiceNoKeyFail()` 的返回类型）、`SystemVoice`、`VoiceModel`、`VoiceProviderView`、`VoiceSettings`、`VoiceProfile`、`VoiceCreatePayload`、`VoiceProfileKeyPayload`、`VoiceProfilePayload`、`VoiceSaveConfigPayload`、`VoiceSaveDirPayload`、`VoiceSynthPayload` |
| 被 import | `src/main/voice/ttsAlign.ts` | `RegisterCtx`、`AlignProgressPayload`（取代原本地 `AlignProgressInfo`）、`VoiceAlignPayload` |
| 被 import | `src/main/video.ts` | `RegisterCtx`、**`RenderCanvas`**（`applyCanvasSize()` / `applyCanvasDeclaration()` / `prepareEntry()` 的画布入参）、`VideoRenderPayload`、`VideoRenderResult`（取代原本地声明的 `RenderPayload` / `RenderResult`） |
| 被 import | `src/main/runtime.ts` | `RegisterCtx`、`IpcResult`、`RuntimePackName`、`RuntimePackState`、`RuntimeProgressPayload`（③.6 节） |
| 被 import | `src/main/agent/html.ts` | `AgentProgressPayload`（以 `export type AgentProgress = AgentProgressPayload` 对外保留 `AgentProgress` 名） |
| 被 import | `src/main/agent/chat.ts` | `AgentProgressPayload`（`onProgress` 载荷）、`ConfigTarget`（每档 `attemptCfg` 的类型） |
| 被 import | `src/main/agent/script.ts` | `AgentProgressPayload`、`IpcResult`、`Scene`、`ScriptAppendRoundPayload`、**`ScriptCastRef`（本轮新增：handler 里 `cast` 清洗后的元素类型）**、`ScriptChatIndex`、`ScriptChatRoundMeta`、`ScriptGeneratePayload`、`ScriptGenerateReply`、`ScriptProgressPayload`、`ScriptVersionResult` |
| 被 import | `src/main/agent/chatLog.ts` | `Scene`、`ScriptChatIndex`、`ScriptChatRoundMeta`（对话记录的索引 / 副本读写与元数据规范化只用这三个类型） |
| 被 import | `src/main/voice/catalog.ts` | `SystemVoice`、`VoiceModel`（厂家目录里的音色表 / 模型表类型） |
| 被 import | `src/main/voice/systemVoices.ts` | `SystemVoice` |
| 被 import（仅类型） | `src/preload/index.ts` | `PreloadApi`、`AlignProgressPayload`、`HtmlProgressPayload`、**`RenderCanvas`**、`RenderOverride`、`RuntimePackName`、`RuntimeProgressPayload`、**`ScriptProgressPayload`**、`UpdateProgressPayload`、**`VideoRenderPayload`**、`WhisperProgressPayload`（后两个：`hfTools.renderVideo` 的第二参写成 `Omit<VideoRenderPayload, 'htmlPath'>`、`setCanvas` 的形参用 `RenderCanvas`）。**角色库三类型不进这份 import 清单**：它们的形状已经写在 `PreloadApi['projectTools']` 的方法签名里 |
| 被 import（仅类型） | `src/preload/index.d.ts` | `PreloadApi`，供 `declare global Window` 使用 |
| 被 import（仅类型） | `src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue` | `ProjectMaterial`、`ProjectMaterialKind`（素材卡片与 `onAdd(kind)` 的类型） |
| 被 import（仅类型） | `src/renderer/src/pages/ContentPage/` | `Scene` / `ScriptChatRoundMeta`（`helpers.ts` 的轮次元数据类型；`AiChatPanel.vue` 与 `ScriptRoundCard.vue` 的 `rounds` / `round` prop 类型）、**`ScriptCastRef`（本轮新增：`AiChatPanel.vue` 的 `onCastConfirm(list: ScriptCastRef[])`、`castPick.ts` 的 `ref<ScriptCastRef[]>`、`CastPickerModal.vue` 的 `confirm` emit 载荷与 `CastLibraryMember` 并列使用）** |
| 被 import（仅类型） | `src/renderer/src/composables/useConfigPrompt.ts` | **`ConfigTarget`**（`useConfigPrompt()` 的 `target` ref 与 `open()` / `fromResult()` 的形参类型） |

## 5. 注意事项与实现要点

- **字段名禁止改动**：注释写明「载荷格式必须与现行实现逐字段一致，禁止改动结构」。设置文件已在用户 `userData` 中落盘，改字段名等于丢失既有配置；项目结构改动还会打断 `project.json` 的向后兼容。
- **新增 / 修改 IPC 须三处齐改**：主进程 `register()` 回调、本文件类型、preload 桥接方法；若签名发生变化，`PreloadApi`（⑨ 节）必须同步，否则 preload 侧直接编译不过。**角色库那一轮就是这条的实例**：⑥ 节三个类型 → `projects.ts` 四个 handler → preload 四个方法（`projectTools` 26 → 30）。**本轮项目角色同理**：⑥ 节三个类型 + `ProjectCastMember.selected?` → `projects.ts` 两个 handler → preload 两个方法（`projectTools` 30 → 32）。**本轮「进度按任务 id 分发」也走这条**：⑥ 节 `ProjectAgentPayload` / `ProjectNewCastPayload` 与 ⑧ 节 `HtmlProgressPayload` 各加必填 `taskId` + ⑨ 节 `projectTools.onTaskProgress` → `projects.ts` 三个 handler 先从载荷取 `taskId`（缺则回 `内部错误：缺少任务 id（进度无法回传），请刷新页面后重试`）→ preload 把单槽换成 `Map` 分发。**但这一轮 `ipc.ts` 一行没改**：没有新增 / 改名频道，频道总数仍是 101。
- **只往 `IpcFail` 加可选字段时不必改 preload**：`needConfig` / `title` 是主进程写、渲染层读的**纯分类字段**，preload 只是 `ipcRenderer.invoke` 原样转发 —— 把「新增失败字段」也算进三处齐改会白改一处。**同理，往既有载荷里加可选字段也不动 preload / 频道**：本轮 `ScriptGeneratePayload.cast?: ScriptCastRef[]` 就是这种——preload 的 `generate: (payload) => ipcRenderer.invoke(IPC.Script.Generate, payload)` 是整对象透传，`ipc.ts` 一行未改；真正要改的只有「共享类型」+ 主进程 handler 里读取并清洗 `cast` + 渲染层组装载荷这三处业务代码。
- **`Project` 是完整视图、`ProjectIndex` 是磁盘形状**：只有主进程知道 `ProjectIndex`，渲染层经 `projectTools.load()` 拿到的永远是含 `subtitle` / `content` 的 `Project`。因此**不要**把 `ProjectIndex` 写进 preload 契约或 `ProjectState`；反过来也不要以为 `Project` 就等于 `project.json` 的内容——它的两个正文字段来自同目录的 `subtitle.txt` / `content.json`。
- **两个正文字段在 `ProjectIndex` 里是「只读兼容」**：`ProjectIndex.subtitle?` / `content?` 只为老项目的数据能读出来而存在（字幕内联优先、脚本文件优先），`writeProject()` 写回时一律剥掉；新增代码不要往这两个字段写。
- **素材接口的契约形状（`ProjectMaterial` 一族）**：`Project` 只新增**可选**字段 `materials`（老项目读回来 `undefined`，由主进程 `normalizeMaterials` 归为 `[]`），因此**不构成破坏性变更**；`ProjectHtmlMaterials.videoPath` 被 `materialIds?: string[]` 取代——它只被 `project:generate-html` / `project:modify-html` 两个频道消费，且渲染层与主进程同步改完，所以可以直接替换字段名。
- **`ProjectMaterial.file` 是相对引用、`label` 是原始文件名**：前者必须落在本项目 `images/` / `video/` 下（跨进程契约 + 越权防护），后者只作展示与给模型读的说明；两者不要互相替代。
- **`ProjectSaveMaterialsPayload.materials` 刻意是 `unknown`**：渲染层提交的是完整列表，主进程必须自己规范化后才能信任它（防脏数据与越权路径），写成 `ProjectMaterial[]` 会给人「已经校验过」的错觉。
- **`CastLibraryMember` 只多一个 `missing`，不多别的**：库里条目的元数据与项目角色完全同构（`extends ProjectCastMember`），这样「存为全局」与「导入」两侧都不需要字段映射；`missing` 是**界面用的派生标记**，由 `projects.ts` 在 handler 里用 `libraryFileExists()` 现算，**不写进 `index.json`**（写进去就成了会过期的事实）。
- **`ProjectCastResult.cast` 是 `ProjectCastMember[]` 而不是 `CastLibraryMember[]`**：导入完成后它已经是「项目的角色」，项目里不存在「索引有、文件不在」这种状态——导不进来的 id 由主进程在 `message` 里点名跳过，不会混进返回的角色表。
- **`ProjectCastMember.selected` 与 `ProjectMaterial.selected` 是同一条语义**（本轮定稿）：**缺省 = 参与**，`false` 才是「本次不注入」。主进程的两处实现必须一致——`normalizeMember()` 写 `it.selected === false ? false : true`（回写时把缺省补成 `true`）、`cast.selectedMembers()` 写 `m.selected !== false`（读的时候缺省当参与）。三处判断（注入页面 / 写进骨架 / 进提示词）都只认 `selectedMembers()`。
- **角色是项目素材，与「单文件 / 章节化」无关**：`ProjectCastMember` 的注释把这条写死了——生成前在素材区勾选，生成时应用注入（单文件模式注 `index.html`、章节模式写进骨架），模型只负责调用。因此**不要把它想成「章节模式的角色库」**（那是旧说法），也不要再让规划调用去产出角色表。
- **`ProjectNewCastPayload` 除了 `taskId` 没有「生成」相关字段**：角色设定只有 `title` / `desc` / `units` / `watercolor`，另加一个**必填 `taskId`（纯进度路由，不是生成参数）**；「新建角色」是不经过生成流程的一次独立模型调用（`project:new-cast`），`watercolor` 只是决定 `uses` 是 `['p5','p5.brush']` 还是空。
- **全局角色库不是项目数据**：`CastLibraryResult` / `ProjectCastResult` 都不进 `Project` / `ProjectIndex`；`Project` 里只有 `cast?: ProjectCastMember[]`（本片的角色）。库在 `<userData>/cast-library/`，是**用户资产**（可备份、可迁移、不进安装包），与 `vendor/` 的应用资源刻意分开。
- **角色预览的两个类型同样是「动作的载荷 / 结果」，不是项目结构**：`ProjectCastPreviewPayload` / `ProjectCastPreviewResult` 只出现在 ⑨ 节 `castTools.preview` 的签名与 `project:cast-preview` 的 handler 上；`cast-preview/` 目录不进 `project.json`、不参与 `scanProjects()` 的 `has*` 标记。
- **`castPreview` 的 `options` 为什么用 `Omit<…, 'name' | 'id'>`**：`name` / `id` 已经是方法的前两个位置参数，preload 会把它们与 `options` 展开合并成一份载荷（`{ name, id, ...(options || {}) }`）。写成 `Omit` 是为了让「同一个键传两遍」在类型层面就不可能发生（与 `hfTools.renderVideo` 的 `Omit<VideoRenderPayload, 'htmlPath'>` 同一手法）。
- **预览只有静态一帧、库里那份只读**：`castPreview` 不改 `cast/` 下任何文件、不写 `project.json`，只覆盖写 `<userData>/cast-preview/<id>.html`（同 id 覆盖）；水彩（`p5` / `p5.brush`）角色只画得出它传给 `o.ctx` 的 Canvas 2D 部分。`uses` 字段唯一的用途就是让主进程在 `uses.indexOf('p5') >= 0` 时给预览页一句「只显示 Canvas 2D 部分」的提示。
- **成片画布 `RenderCanvas` 是「项目属性」而不是「渲染档位」**：它**不参与** `RenderOverride` 的「项目级覆盖 > 全局默认」合并，也没有全局默认那一层，读写走独立的 `Project.canvas?` 与 `project:set-canvas`。这么做的理由：HyperFrames CLI 的 producer 编译阶段只读文档里**第一个带 `data-composition-id` 的元素**的 `data-width`/`data-height`，**读不到就兜底 1080×1920（竖屏）**（宽屏版式被裁掉两侧、上下留大片黑边——本项目实测故障），而 `<html data-resolution>` 在渲染链路里一次都不读，所以画布必须由项目给出一个**确定值**，并同时喂给生成提示词、预览 iframe 与渲染入口注入的**舞台 `data-width`/`data-height`（成片宽高来源）+ `<html data-resolution>`**。`VideoRenderPayload.canvas?` 与 `quality?` / `fps?` 同路下发但语义不同：前者决定画布 / 成片尺寸，后者决定编码质量与帧率。
- **`Project.videoMaterial` 是历史字段**：不再新写、素材列表也不读它；仅被暂时隐藏入口的 `project:extract-video-audio` handler 使用。**不要在新代码里读它**。
- **`IpcFail.message` 是可选字段**：`voice:pick-dir` 的用户取消分支只回 `{ ok: false, canceled: true }`，因此读取 `message` 的代码要容忍 `undefined`（渲染层约定式写法 `(res as { message?: string })?.message || '默认文案'`）。
- **`IpcFail.detail` 是「可选的技术详情」**：与 `message` 分工明确 —— `message` 说人话（用户能做什么）、`detail` 给排障（原始报错 / HTTP 状态 / 请求 URL），UI 用「查看详情」折叠展示。它同样是可选的，取消分支与部分简单失败分支不带它。
- **`IpcFail.needConfig` / `title` 是「配置类」两件套**：它们**不驱动流程**（对比 `needPacks` 需要用户下载完环境再「继续」重发操作），只把「这个错误该去哪修」从渲染层的正则猜测改成主进程单点分类；界面据此弹出**只有 `[去设置]` / `[取消]` 两个按钮**的弹窗。**配置类弹窗刻意不显示 `detail`**（见 `docs/error-mapping.md` §11.1）。它曾有第三个字段 `configUrl`（余额类的充值页）与对应的「去充值」按钮，**已按用户要求整条摘除**——余额 / 欠费改为走内嵌状态行。
- **`ConfigTarget` 与 `SettingsSectionKey` 取值不同名但语义对齐**：`ConfigTarget = 'model' | 'voice'`，而设置页分类键是 `SettingsSectionKey`（`'model' | 'voice' | 'update'`）；映射写在 `useConfigPrompt.ts` 的 `SECTION_OF`（`model → model`、`voice → voice`）。改任一侧都要一起看。
- **`UpdateCheckResult.message` 是必填、`IpcFail.message` 是可选的**：前者由主进程**单点产出**（`available` / `skipped` / `none` 三种状态文案都在 `updater/base.ts` 的 `bindEvents()` 里写），渲染层只渲染不再拼串；后者必须保持可选以兼容 `voice:pick-dir` 的取消分支。两者的 `detail` 都只在 UI「查看详情」里展开。
- **`VoiceSavedTo` 与 `VoiceSaveDirMode` 取值集合相同但字段名不同**：前者是 `voice:synth` 结果里的 `savedTo`，后者是 `voice:get-save-dir` 结果里的 `mode`；源码注释明确「现行实现如此，勿『统一化』」。
- **`VoiceProfile.type` 是字面量联合**：类型为 `VoiceProfileType`（`'system' | 'custom'`），不再是宽泛 `string`；但线上保存分支的 `VoiceProfilePayload.profile.type` 仍是 `type?: string`（主进程按「非 `system` 一律归 `custom`」归一），两者不要混用。
- **`AppSettings.whisper` 有独立 interface**：即 `WhisperSettings`，需要复用该分区时直接引用，不要重复内联声明。
- **`SystemVoice` 与 `SystemVoiceItem` 的分工**：`SystemVoice` 是内置音色表的 4 字段条目（由 `src/main/voice/systemVoices.ts` 提供）；`voice:list-system-voices` 下发的元素是 `SystemVoiceItem`（多一个 `model` 字段）。
- **`VideoRenderResult` 不是 `IpcResult`**：失败分支 `message` 必填、成功分支带 `outputVideo` / `projectDir`，且失败可带 `compatible?: boolean`（HTML 不合规）与 `needPacks?: RuntimePackName[]`（缺运行环境包）；文档与代码不要一律按 `IpcResult` 处理。
- **少数 API 不走 `ok` 包裹**：`settingsTools.get()` → `AppSettings`、`projectTools.list()` → 数组、`projectTools.load()` → `Project | null`、**`projectTools.pickMedia()` → `string[]`**、`hfTools.openHtml` / `pickAudio` → `string | null`、`appTools.copyText` → `boolean`、`updateTools.version()` → `string`（同步）。其中 `projectTools.load()` 在项目名为空时**确实返回 `null`**，调用方必须做空值守卫（`useAppStore.refreshProject` 已据此加守卫）。角色库 4 个方法**都走 `IpcResult`**（`promoteCast` / `removeCastFromLibrary` 只是最简的 `IpcResult`）。
- **`RegisterCtx.getWindow` 可为 `null`**：所有 `webContents.send` 前必须判空，否则窗口关闭或重载期间会抛异常。
- **结构类型靠「再导出」保引用面**：`src/main/projects.ts` 的 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'`、`src/renderer/src/composables/useAppStore.ts` 的 `export type { ProjectMeta }` 都只是转发 —— `projects.Project`、`from './projects'`、`import { ProjectMeta } from '@renderer/composables/useAppStore'` 这类既有引用不需要改动，但结构本身只在本文档定义一处。新增字段时改这里即可，不要在被再导出的文件里重建 interface。**`ProjectIndex` 虽然定义在这里，但不在 `projects.ts` 的再导出清单里**（只 import、不转发），因为它描述的是磁盘形状而非跨进程契约。
- **主进程 handler 的 `payload` 参数一律标注契约类型**：如 `ProjectSaveSubtitlePayload`、`ProjectAgentPayload`、**`ProjectPickMediaPayload` / `ProjectAddMaterialsPayload` / `ProjectSaveMaterialsPayload`**、`VoiceSaveConfigPayload`（`voice:save-config` 的形参另**联合**了历史形态）、`VoiceAlignPayload`；因此字段名改动会在主进程侧直接编译报错。**本轮角色库的 4 个 handler 载荷是就地内联的窄对象**（`{ name?: string; id?: string }` / `{ name?: string; ids?: string[] }` / `{ id?: string }`），没有另立 `*Payload` 类型——四个字段太少，立类型只会多一处要同步的声明。
- **并非所有导出名都会出现在 import 语句里**：文件内类型相互引用（如 `IpcResult` 被 `PreloadApi` 的多个成员使用、`SystemVoiceItem extends SystemVoice`、`ProjectIndex` 由 `Project` 派生、`CastLibraryMember extends ProjectCastMember`），另有一批 `*Result` / `*Payload` 类型只用于描述 handler 的返回结构与线上载荷形状；这不代表它们是死代码，删除前需确认契约文档的完整性。
- **⑧ 的进度类型改成了「通用 + 别名」**：真实定义只有 `AgentStage` / `AgentProgressPayload` 一份（由 `src/main/agent/chat.ts` 产出），`HtmlAgentStage` / `HtmlAgentProgress` 只是 `export type` 别名——**新增 Agent 时不要另造一套五阶段类型**，直接用 `AgentProgressPayload` 再 `extends` 出一个带 `text` 的线上载荷即可（`ScriptProgressPayload` 就是这么做的）。
- **`ScriptCastRef` 与 `ProjectCastMember` 是两件事，别合并**（本轮新增的类型就是为划这条界）：`ProjectCastMember` 是**项目资产**（`project.json` 的 `cast` + `cast/<id>.js`，`selected` 决定是否注入页面）；`ScriptCastRef` 只是**写稿时的提示词上下文**——只有 `id` / `name` / `desc` / `units` 四个字段，**没有** `uses` / `selected`，**不落盘、不导入项目、不参与角色注入**。两者字段碰巧相似（名字 / 描述 / 身高），但语义不同：前者「页面里画谁」，后者「这一版按谁写」。`ProjectCastMember` 里多出来的 `uses`（随包库）与 `selected`（注入开关）对写稿毫无意义，所以刻意不复用。
- **`ScriptGeneratePayload.cast` 必须是「可选且空数组等价缺省」**：主进程 `buildScriptPrompt()` 用 `Array.isArray(payload.cast) && cast.length` 判断是否出【角色】块，注释写死「没选角色时提示词必须与加这个字段之前逐字一致（老行为不变）」。因此**不要**把它改成必填、也不要在渲染层「没选角色时也传一个空数组以外的占位项（如「无角色」）」——那会凭空多出一段【角色】块。
- **`cast` 的清洗在主进程、不在共享层**：`ScriptCastRef` 只描述形状；「丢名字为空的、`slice(0, MAX_CAST = 20)`、`desc` 截 300 字、`units` 非正数回落 8」都在 `script:generate` 的 handler 里（见 [main/agent.md](../main/agent.md) §2.1）。所以渲染层可以放心传「用户挑了什么就是什么」，但别指望主进程替你校验业务语义——它只挡形状不合法与超量超长。
- **`Script*` 七个类型的分工（本轮由六个变七个）**：`ScriptGenerateReply` **不属于 `IpcResult` 家族**（它是独立判别联合，失败分支的 `raw` 是 `IpcFail` 没有的字段），所以不要把它塞进 `IpcResult<T>`——渲染层按 `res.ok` 分流后再读 `res.raw` / `res.needConfig` 即可；`needConfig` / `title` 的语义与 `IpcFail` 上的同名字段一致（配置类，界面弹「去设置」）。`ScriptCastRef` 是**纯数据形状**（只被 `ScriptGeneratePayload.cast?` 引用，自身不挂任何频道）；反之对话记录的四个类型是**普通数据载荷**：`script:load-chat` 走标准 `IpcResult<ScriptChatIndex>`、`script:read-version` 走 `IpcResult<ScriptVersionResult>`、`script:append-round` 走 `IpcResult<{ versionId }>`、`set-active-version` / `clear-chat` 只回 `IpcResult`。
- **对话记录是「辅助数据」、不是产物**：它拆成**索引 + 每版副本**——`chat/index.json` 里每条 `ScriptChatRoundMeta` 只有元数据（`id` / `request` / `versionId` / `totalChars` / `sceneCount` / `ts`），**没有 scenes**；该轮的 `scenes` 在 `chat/versions/<versionId>.json` 里，展开 / 应用时才读。记录不参与 `Project` / `ProjectIndex`，也不影响任何 `has*` 标记；删掉 `chat/` 只丢对话历史。**上限 100 轮由主进程裁剪**（`chatLog.ts` 的 `MAX_CHAT_ROUNDS`），`writeChatIndex` 写完索引后会清理不再被引用的副本，渲染层不另设上限。
- **内容脚本的上下文不进 `content.json` 契约**：`ScriptGeneratePayload.scenes` 是**渲染层当前编辑器里的值**（可能包含尚未写盘的改动），主进程只按它拼提示词、**不读盘也不落盘**；写盘由渲染层的自动保存调 `projectTools.saveContent`。这条边界让「AI 改坏了」只需在结果卡上「应用此版本」，而不必担心磁盘上的 `content.json` 被动过。
- **纯类型文件**：编译后不产出 JS；不要在此文件写常量或函数（常量请放 `src/shared/ipc.ts` / `src/shared/constants.ts`，需要纯函数映射时放 `src/shared/errors.ts`）。

## 附录 · 角色改版后的现状（与上文冲突时以本节为准）

上文里 `ProjectNewCastPayload` / `ProjectNewCastResult` / `ProjectCastPreviewPayload` / `ProjectCastPreviewResult` 四个类型**已删除**（它们随 `project:new-cast` / `project:cast-preview` 一起下线）。现在的角色类型面：

| 类型 | 形态 | 说明 |
|---|---|---|
| `ProjectCastMember` | `interface`（改） | **新增可选 `style?: string`**：这个角色自己的画风说明（角色与项目解耦后由角色自带，留空 = 让模型按描述自定）。**只在「画这个角色」的提示词里用，不进章节 / 改稿提示词**（源码注释原话）。其余字段不变：`id` / `name` / `desc` / `units` / `uses?` / `selected?` |
| `ProjectCastSelection` | `interface`（新） | `{ id: string; selected?: boolean }`——**`project.json` 里只存这一对**；`selected` 缺省 = 参与 |
| `ProjectIndex.cast` | `ProjectCastSelection[]`（改） | 磁盘索引里的 `cast` 从「完整成员快照」降级成「id + 勾选」（与 `subtitle` / `content` 被剥离同理） |
| `Project.cast` | `ProjectCastMember[]`（不变） | 读项目时由主进程按 id 从全局库补全元数据（库里改名 / 改身高，所有项目立刻跟着变） |
| `CastLibraryMember` | `interface` | `extends ProjectCastMember`，多一个 `missing?: boolean`（库里有索引、缺 `<id>.js`） |
| `CastLibraryResult` | `interface` | `{ members: CastLibraryMember[] }`——`cast:list` 成功分支 |
| `ProjectSaveCastPayload` | `interface`（改） | `{ name?: string; cast?: ProjectCastSelection[] }`——`project:save-cast` 的载荷 |
| `ProjectCastResult` | `interface` | `{ cast: ProjectCastMember[] }`——`project:save-cast` 成功后补全过的角色表 |
| `CastCreatePayload` | `interface`（新） | `{ taskId: string（必填）; title?; desc?; style?; units?; watercolor? }`——不再带 `name`（角色与项目无关） |
| `CastRecreatePayload` | `interface`（新） | `{ taskId: string（必填）; id: string; request: string（必填） }`——在库里现有代码上重画 |
| `CastSaveMetaPayload` | `interface`（新） | `{ id: string; name?; desc?; style?; units?; watercolor? }`——只改元数据、不调模型 |
| `CastResult` | `interface`（新） | `{ member: CastLibraryMember }`——`cast:create` / `cast:recreate` / `cast:save-meta` 的成功载荷 |
| `CastPreviewPayload` | `interface`（新） | `{ id?; units?; title?; uses? }`——`uses` 只用来在预览页提示「水彩角色只画得出 Canvas 2D 部分」 |
| `CastPreviewResult` | `interface`（新） | `{ rel: string }`——预览页**相对 userData** 的路径 `cast-preview/<id>.html`（渲染层用 `utils/url.ts` 的 `userFileUrl` 拼 URL） |
| **`CastActionKey` / `CastActionDef`** | **`interface`（本轮新增）** | 一条动作的两种写法：`CastActionKey = { t, o }`；`CastActionDef = { id, name, duration, loop, keys?, code?, from? }`（`keys` 与 `code` 二选一） |
| **`CastActionListResult` / `CastActionScope`** | **`interface` / `type`（本轮新增）** | 列表 `{ shared, own }`；作用范围 `'shared' \| 'own'` |
| **`CastActionSavePayload` / `CastActionRemovePayload`** | **`interface`（本轮新增）** | 保存 `{ castId?, scope?, action }`（`id` 空 = 新建）；删除 `{ castId?, scope?, actionId }` |
| **`CastActionGeneratePayload` / `CastActionResult`** | **`interface`（本轮新增）** | 生成 `{ castId, taskId, request, duration?, loop?, name? }`；回执 `{ action }` |
| **`CastDemoPayload` / `CastDemoResult`** | **`type` / `interface`（本轮新增）** | 载荷 = `CastPreviewPayload`（别名）；结果 `{ rel }`（`cast-preview/<id>.demo.html`） |

`PreloadApi` ⑨ 节同步变化：`castTools` 现在是 **12 个成员**（`list` / `create` / `recreate` / `saveMeta` / `remove` / `preview` / **`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`** / `onTaskProgress`）；`projectTools` 去掉 6 个角色方法、只剩 `saveCast(name, cast: ProjectCastSelection[])`。