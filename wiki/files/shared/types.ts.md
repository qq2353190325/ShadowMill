# src/shared/types.ts

> 跨进程共享的 IPC 载荷与设置类型定义，三端（main / preload / 渲染层）唯一类型真源

- **所在目录**：`src/shared/`
- **类型**：共享类型（纯 `interface` / `type` 别名，无运行时代码）
- **规模**：936 行
- **对外导出**：按 12 个小节组织（源码编号 ①～⑨，其中穿插 ③.5 / ③.6 / ⑧b 三个补充小节）—— ① 通用 IPC 结果 3 个（`IpcFail`、`IpcResult`、**`ConfigTarget`**）② 主进程装配上下文 1 个（`RegisterCtx`）③ 设置（含 `UpdaterSettings`、`SettingsSaveUpdaterPayload`、渲染档位 `RenderQuality` / `RenderFps` / `RenderOptions` / `RenderOverride` 与**成片画布 `RenderCanvas`**）③.5 应用自更新 4 个（`UpdateCheckState`、`UpdateCheckResult`、`UpdateStage`、`UpdateProgressPayload`）③.6 运行环境（**分包**）4 个（`RuntimePackName`、`RuntimePackState`、`RuntimePhase`、`RuntimeProgressPayload`）⑧b 历史数据目录 3 个（`LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`）④ 音色与配音 ⑤ 语音识别 ⑥ 项目与字幕 **（素材库那次新增 `ProjectMaterialKind` / `ProjectMaterial` / 三个素材载荷与 `ProjectMaterialsResult`；本次新增 `ProjectSetCanvasPayload`）** ⑦ 预览 / 转视频 2 个（`VideoRenderPayload`——**本次新增 `canvas?`**、`VideoRenderResult`）⑧ 进度推送 ⑨ `PreloadApi` 1 个；另有 ① 节 `IpcFail.needPacks`（缺哪个运行环境包）与 `IpcFail.needConfig` / `title`（配置类错误）、⑨ 节 `settingsTools.pickRuntimePack` 等成员

## 1. 作用与职责

本文件定义主进程、preload、渲染层三端共同使用的数据形状，并集中收敛原先散落在各处的类型声明：

1. **统一载荷格式**：IPC 两端对同一份数据（设置文件、音色条目、模型条目、项目结构、**项目素材**）使用完全相同的字段名与类型，避免「主进程叫 `voiceId`、渲染层叫 `voice_id`」这类漂移。
2. **统一 IPC 结果形状**：`IpcFail` / `IpcResult<T>` 是全部 `{ ok, ... }` 结果类型的唯一来源 —— 它们原先只在 `src/preload/index.d.ts` 内部以 `OkResult` / `FailResult` / `IpcResult` 三个未导出类型存在，现在上移到共享层并被主进程、preload、渲染层共同引用。
3. **描述持久化结构**：`CustomModelConfig` / `VoiceSettings`（含按厂家的 `VoiceProviderConfig`）/ `VoiceProfile` / `WhisperCustomModel` / `WhisperSettings` / `AppSettings` 共同构成 `userData/settings.json` 的完整 schema；旧的 `VoiceTTSConfig` 保留但**只作迁移来源**。
4. **定义 `window.*` 契约**：⑨ 节的 `PreloadApi` 用 11 个命名空间的完整方法签名描述「preload 实现 ↔ 渲染层消费」的唯一真源 —— `src/preload/index.ts` 用它标注各 `contextBridge` 对象，`src/preload/index.d.ts` 用它给 `Window` 补类型，因此两端不会再各自漂移。
5. **收敛主进程的本地类型**：`whisper.ts` / `ttsAlign.ts` / `video.ts` / `htmlAgent.ts` / `voice.ts` / `projects.ts` 原先各自声明过 `WhisperProgressPayload`、`AlignProgressInfo`、`RenderPayload` / `RenderResult`、`AgentProgress`、`VoiceModel`、`Scene` / `ContentScript` / `Project` / `SubtitleLine`，现在全部改为从本文件导入（`htmlAgent.ts` 保留 `AgentProgress` 这一导出名，但它已是 `HtmlAgentProgress` 的类型别名；`projects.ts` 用 `export type { … } from '../shared/types'` 再导出，保持 `projects.Project` / `from './projects'` 的既有引用面）。**`src/main/` 下已不存在任何本地声明的 payload / result / progress 接口**，各 IPC handler 的 `payload` 参数也一律用本文件的 `*Payload` 类型标注（此前多为 `Record<string, unknown>` 或内联字面量）。
6. **约束主进程装配模式**：`RegisterCtx` 把 `src/main/*.ts` 各模块 `register(ctx)` 所依赖的能力（拿主窗口）显式化。
7. **统一「配置类错误」的分类词表**：① 节的 `ConfigTarget`（`'model' | 'voice'`）与 `IpcFail` 的两个可选字段 `needConfig` / `title` 一起，把「这个失败是不是用户去设置页改配置就能解决」从各页面的正则猜测收敛成主进程单点产出的分类（判定实现见 `src/shared/errors.ts`，界面消费见 `src/renderer/src/composables/useConfigPrompt.ts`）。**余额 / 欠费刻意不在此列**：去设置改不了余额，它走内嵌状态行（`needConfig` 里也没有 `'billing'`）。

文件按 12 个小节组织（源码小节横幅依次为 ① ② ③ ③.5 ③.6 **⑧b** ④ ⑤ ⑥ ⑦ ⑧ ⑨——`⑧b 历史数据目录` 在这一版里被写在 ③.6 与 ④ 之间，是「旧数据处置」契约的补充小节），首行注释给出两条硬约束：**载荷格式必须与现行实现逐字段一致，禁止改结构**；**新增/修改 IPC 接口须三处齐改 —— 主进程 `register()` 回调、本文件类型、preload 桥接方法**（例外：只往 `IpcFail` 加**可选字段**时 preload 无需改动，见 §5）。文件为纯类型模块，编译后不产生任何运行时代码，仅 1 个 `import type`（引自 `electron`，用于 `BrowserWindow`）。

| 小节 | 覆盖内容 | 主要消费方 |
| --- | --- | --- |
| ① 通用 IPC 结果 | `ConfigTarget`、`IpcFail`、`IpcResult<T>` | `PreloadApi` 全体成员、各主进程模块的返回结构、`src/renderer/src/composables/useConfigPrompt.ts` |
| ② 主进程装配上下文 | `RegisterCtx` | `src/main/*.ts` 的 `register(ctx)` |
| ③ 设置 | `settings.json` 的 schema（含渲染档位 `render` 与更新设置 `updater`）与 `settings:*` / `voice:save-config` 载荷 | `src/main/settings.ts`、设置页、配音页 |
| ③.5 应用自更新 | `update:*` 的检查结果（`message` + `detail` 分层）与进度载荷 | `src/main/updater/`（目录，出口 `updater/index.ts`）、设置页 |
| ③.6 运行环境（分包） | `RuntimePackName`、`RuntimePackState`、`RuntimePhase`、`RuntimeProgressPayload`（包名、每包状态、阶段与下载 / 解包进度） | `src/main/runtime.ts`、设置页、`src/renderer/src/composables/useRuntime.ts`、`src/renderer/src/composables/useEnvGate.ts` |
| ⑧b 历史数据目录 | `LegacyDataInfo`（扫描结论）、`LegacyResolveAction`（三选一）、`LegacyResolveResult`（执行结果与迁移计数） | `src/main/index.ts`、`src/renderer/src/composables/useLegacyData.ts`、`src/renderer/src/components/LegacyDataDialog.vue` |
| ④ 音色与配音 | 系统音色、克隆音色、音色映射、合成/对齐载荷与结果 | `src/main/voice.ts`、`src/main/ttsAlign.ts` |
| ⑤ 语音识别 | whisper 模型状态、转录载荷与结果 | `src/main/whisper.ts` |
| ⑥ 项目与字幕 | `project.json`（含 `materials` 素材库、渲染档位覆盖 `render`）、**素材条目与素材三件套载荷**、字幕行、项目列表项、HTML 生成载荷 | `src/main/projects.ts`、`src/renderer/src/pages/HtmlGenPage/`（素材墙）、`src/renderer/src/composables/useAppStore.ts` |
| ⑦ 预览 / 转视频 | 渲染载荷与渲染结果 | `src/main/video.ts` |
| ⑧ 进度推送 | 6 路 main → renderer 推送的载荷 | `src/main/*.ts` 推送方 + `src/preload/index.ts` 订阅方 |
| ⑨ `window.*` API 契约 | `PreloadApi`（11 个命名空间） | `src/preload/index.ts`、`src/preload/index.d.ts`、渲染层全部 `window.*` 调用 |

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
| `needConfig` | 可选 `ConfigTarget` | **本次失败属于「配置类」**（缺 Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用）：界面据此弹「去设置 / 取消」弹窗而不是只显示一行红字。源码注释强调：**它不驱动流程**（不像 `needPacks` 要续做），只是一个分类标记；**不显示原始报文**（排障详情仍落日志）；**余额 / 欠费不属于此处**。写入方是主进程（`htmlAgent.ts` / `settings.ts` / `voice.ts` 直接产出，`projects.ts` 用 `configTargetOf()` 补分类） |
| `title` | 可选 `string` | 配置类弹窗的**标题**（主进程用 `errors.configTitle()` 单点产出：`需要设置自定义模型` / `需要设置语音服务`，兜底 `需要先完成设置`）；界面只显示、不判断 |

`T` 缺省为 `unknown`，表示调用方只关心 `ok`（如 `clearAudio` / `delete` 等无载荷的写操作）。

### 2.2 ② RegisterCtx（主进程装配上下文）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `getWindow` | `() => BrowserWindow \| null` | 惰性获取当前主窗口；返回 `null` 表示窗口尚未创建或已销毁。用函数而非直接持有 `BrowserWindow`，可避免模块加载顺序造成的空引用 |

### 2.3 ③ 设置（`userData/settings.json`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `CustomModelConfig` | `interface` | OpenAI 兼容自定义模型配置：`baseUrl` / `modelId` / `apiKey` / `enabled` |
| `VoiceProviderConfig` | `interface` | **单个厂家**的语音配置：**只有 `apiKey`**（源码注释：不再有「厂家默认模型」这种全局设置——系统音色与模型是固定对应关系（写在 `voiceCatalog` 目录里），克隆音色按其映射 / 云端 `target_model` 走，都没有时才落到目录里的出厂默认模型） |
| `VoiceSettings` | `interface` | `voice` 段（按厂家组织）：`active`（当前厂家键）/ `providers: Record<string, VoiceProviderConfig>` / `saveDir` |
| `VoiceTTSConfig` | `interface` | **旧结构（单厂家、无厂家字段）**：`apiKey` / `targetModel` / `saveDir`；注释标明**仅作为迁移来源读取**，新写入一律走 `VoiceSettings` |
| `VoiceProfileType` | `type` | `'system' \| 'custom'`（音色类型字面量联合） |
| `VoiceProfile` | `interface` | 本地音色映射条目：`key` / `name` / `voice` / `targetModel` / `type` |
| `VoiceProfileInput` | `interface` | 保存映射的入参：`key` / `voice` / `targetModel` + 可选 `name` / `type`（主进程按 `voice` 回填 `name`，按 `'system'` 之外一律归 `'custom'`） |
| `WhisperCustomModel` | `interface` | whisper 自定义模型条目：`id` / `name` / `file` / `url` / `sizeMB` / `desc`（`id` 由文件名派生） |
| `WhisperSettings` | `interface` | whisper 分区：`modelId` / `customModels: WhisperCustomModel[]` |
| `AppSettings` | `interface` | 设置文件根结构：`customModel` / **`voice`** / `voiceProfiles` / `whisper` / `render`，另有**可选的旧字段 `voiceTTS`**（只读兼容） |
| `SettingsSavePayload` | `interface` | `settings:save` 线上载荷：`{ customModel: CustomModelConfig }` |
| `SettingsTestPayload` | `interface` | `settings:test` 线上载荷：形状与 `SettingsSavePayload` 相同 |
| `SettingsSaveResult` | `interface` | `settings:save` 成功分支：`{ settings: AppSettings }`（`voice:save-config` 复用同一结果形状） |
| `RenderQuality` | `type` | 渲染质量字面量联合：`'draft' \| 'standard' \| 'high'` |
| `RenderFps` | `type` | 渲染帧率字面量联合：`24 \| 30` |
| `RenderOptions` | `interface` | **完整**渲染档位 `{ quality: RenderQuality; fps: RenderFps }`（`settings.json` 的 `render` 段与生效档位都用它） |
| `RenderOverride` | `type` | `Partial<RenderOptions>`——**项目级覆盖**：字段可缺省，缺省项跟随全局默认 |
| `RenderCanvas` | `type` | **成片画布方向（本次新增）**：`'landscape' \| 'portrait' \| 'square'`。源码注释明确它是**项目属性、不是渲染档位**——不走「项目覆盖 > 全局默认」那套层级，只在一处选（「HTML生成」页生成侧的「画布」下拉，生成 / 修改前定），落进 `project.json` 的 `canvas`，且同一个值同时决定三件事：① 生成提示词里给模型的版式尺寸（`projects.ts` 的 `【画布】` 块）② 预览 iframe 的画布（`pages/HtmlGenPage/PreviewSection.vue`）③ 渲染入口注入的 `<html data-resolution>`（`main/video.ts`）；因此「预览看到的画布」与「成片画布」必然是同一个尺寸。取值与尺寸的真源是 `shared/constants.ts`（`RENDER_CANVASES` / `CANVAS_SIZES` / `CANVAS_LABELS` / `DEFAULT_CANVAS`），与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 对齐（本项目只暴露 1080 三档） |
| `SettingsSaveRenderPayload` | `interface` | `settings:save-render` 线上载荷：`{ render?: RenderOverride }`（只更新 `render` 段，不动 `customModel`） |

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `CustomModelConfig` | `baseUrl` | `string` | OpenAI 兼容端点根地址 |
| `CustomModelConfig` | `modelId` | `string` | 模型标识（如 `gpt-4o-mini`） |
| `CustomModelConfig` | `apiKey` | `string` | 接口密钥 |
| `CustomModelConfig` | `enabled` | `boolean` | 是否启用自定义模型（关闭则走内置/默认通道） |
| `VoiceProviderConfig` | `apiKey` | `string` | 该厂家的 API Key（明文存本机）；**这是该结构唯一的字段** |
| `VoiceSettings` | `active` | `string` | 当前厂家键（对应 `voiceCatalog` 的 `VoiceProviderDef.key`） |
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

### 2.4 ④ 音色与配音（`voice.ts` / `ttsAlign.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SystemVoice` | `interface` | Qwen-TTS 系统音色条目（`systemVoices.ts` 的内置表结构）：`voice` / `desc` / `langs` / `series` |
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
| `ContentScript` | `interface` | 内容脚本：`style` + `scenes: Scene[]` |
| `Project` | `interface` | `userData/projects/<项目名>/project.json` 的完整结构（含 `materials` 素材库与历史字段 `videoMaterial`） |
| `ProjectMaterialKind` | `type` | **`'image' \| 'video'`**（本轮新增）——决定素材落在哪个目录，也决定提示词里给模型的嵌入方式（`<img>` / `<video>`） |
| `ProjectMaterial` | `interface` | **一条素材**（本轮新增）：`id` / `kind` / `file` / `label` / `selected` / `addedAt` |
| `SubtitleLine` | `interface` | 字幕行（`parseSubtitle` 输出）：`n` / `text` / `time` / `end`（秒，可带小数；`end` 可为 `null`） |
| `ProjectMeta` | `interface` | `project:list` 结果项（首页/步骤条的项目卡片与下拉） |
| `ProjectNamePayload` | `interface` | 仅以项目名定位的载荷 `{ name }`（`delete` / `open-folder` / `extract-video-audio` 等） |
| `ProjectSaveSubtitlePayload` | `interface` | `{ name?, subtitle?, title? }` |
| `ProjectSaveContentPayload` | `interface` | `{ name?, content? }`（`content` 为 `unknown`） |
| `ProjectSaveResult` | `interface` | `{ project: Project }`（`create` / `saveSubtitle` / `saveContent` / `saveVideo` 共用） |
| `ProjectExportSrtPayload` | `interface` | `{ name?, srt? }` |
| `ProjectDownloadResult` | `interface` | `{ savedPath }`（下载 HTML / 导出 SRT 共用） |
| `ProjectSetAudioPayload` / `ProjectSetVideoPayload` | `interface` | `{ name?, audioPath? }` / `{ name?, videoPath? }`——**`ProjectSetVideoPayload` 的注释已改为「只服务 `project:save-video` 的产物回写」**：它与「项目视频素材」无关（素材走 `project:add-materials` / `project:save-materials`） |
| `ProjectSetAudioResult` | `interface` | `{ audioFile, htmlUpdated? }`（`setAudio` / `extractVideoAudio` 共用）；`htmlUpdated` 为「设置 / 移除背景音频时 `index.html` 的注入音轨是否被同步改写」，可选 |
| `ProjectPickMediaPayload` | `interface` | **`project:pick-media` 载荷**（本轮新增）：`{ kind?: ProjectMaterialKind }`——`kind` 决定文件框的扩展名过滤；图片允许一次多选（一屏素材），视频单选（单个文件常很大） |
| `ProjectAddMaterialsPayload` | `interface` | **`project:add-materials` 载荷**（本轮新增）：`{ name?, paths?: string[] }`——把用户选中的**外部绝对路径**复制进项目素材目录并登记为素材 |
| `ProjectSaveMaterialsPayload` | `interface` | **`project:save-materials` 载荷**（本轮新增）：`{ name?, materials?: unknown }`——整份素材列表回写（**移除与勾选都走这条**）；`materials` 刻意是 `unknown`，因为渲染层提交的是完整列表、主进程只做规范化（id/kind/file 校验 + 上限）后落盘 |
| `ProjectMaterialsResult` | `interface` | **素材接口回执**（本轮新增）：`{ materials: ProjectMaterial[]; message?: string }`——`materials` 恒为落盘/读取后的完整列表，渲染层直接用它替换本地状态；`message` 非空表示「部分成功」之类需要告知用户的补充说明（如跳过了几个不支持的文件） |
| `ProjectReadHtmlResult` | `interface` | `{ html }` |
| `ProjectSaveHtmlPayload` | `interface` | `{ name?, html? }` |
| `ProjectPreviewHtmlResult` | `interface` | `{ previewPath }` |
| `ProjectOpenFolderOfResult` | `interface` | `{ dir }` |
| `ProjectHtmlMaterials` | `interface` | HTML 生成/修改的素材选择：`subtitleProject?` / **`materialIds?: string[]`**（**`audioPath?` 已删除**：背景音频不是生成素材，由应用按 `project.audioFile` 注入 HTML 的 `<audio id="myv-bgm">`。`materialIds` = 本次参与生成的素材 id 列表，顺序即提示词里的顺序，空/缺省 = 不带素材） |
| `ProjectAgentPayload` | `interface` | `extends ProjectHtmlMaterials` + `name` / `prompt`（`generateHtml` / `modifyHtml` 线上载荷） |
| `ProjectHtmlResult` | `interface` | `{ htmlPath, compatible, message? }` |
| `ProjectSetRenderPayload` | `interface` | `project:set-render` 线上载荷：`{ name?: string; render?: RenderOverride \| null }`——`render` 传 `null`（或字段全非法）表示清除项目覆盖、回到跟随全局默认 |
| `ProjectSetCanvasPayload` | `interface` | **`project:set-canvas` 线上载荷（本次新增）**：`{ name?: string; canvas?: RenderCanvas }`——成片画布方向（项目属性）。源码注释口径是「**非法 / 缺省一律忽略，不写进项目**」；handler 侧缺项目名回 `缺少项目名`、白名单（`RENDER_CANVASES`）外回 `画布取值非法` |

> **已删除**（本轮）：`ProjectSetVideoResult`（原 `{ videoFile, abs }`）——它描述的「导入视频素材并回带项目内绝对路径」语义随单视频素材一起下线，素材三件套改由 `ProjectMaterialsResult` 描述回执。

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `Project` | `name` / `title` / `subtitle` | `string` | 项目名、标题、字幕文本 |
| `Project` | `subtitleCount` | 可选 `number` | 字幕条数 |
| `Project` | `htmlPath` / `videoPath` | `string` | 产物路径。`htmlPath` 是**绝对路径**；`videoPath` 是**项目内相对路径**（形如 `video/output.mp4`——成品就地渲染在项目里，落盘用相对引用以便项目整体搬走，见 [projects.ts.md](../main/projects.ts.md) §3.8；主进程 `project:load` 交给渲染层前会用 `resolveVideoAbs()` 换算成绝对路径，兼容读老记录里的绝对路径）。空串表示未生成或已失效，HTML 变更后 `videoPath` 会被置空 |
| `Project` | `materials` | 可选 `ProjectMaterial[]` | **项目素材库**（图片 + 视频，多素材）：由 `project:add-materials` / `project:save-materials` 维护 |
| `Project` | `videoMaterial` | 可选 `string` | **历史字段**（源码注释逐字）：「历史字段（素材多视频化之前的那「一个视频素材」）：本轮起**不再写入**、素材列表也不读它。保留声明只为不改动被暂时隐藏入口的 project:extract-video-audio handler（它仍按此字段定位视频）。」 |
| `Project` | `audioFile` | `string` | 背景音频 / 生成语音相对引用（`audio/xxx`，空串表示无）；也是主进程注入 HTML 音轨（`<audio id="myv-bgm">`）的唯一来源 |
| `Project` | `content` | `ContentScript` | 内容脚本 |
| `Project` | `render` | 可选 `RenderOverride` | 视频渲染档位的**项目级覆盖**（字段缺省即跟随全局默认；`render` 为空覆盖时该字段被删除） |
| `Project` | `canvas` | 可选 `RenderCanvas` | **成片画布方向（本次新增，项目属性）**：缺省 = `DEFAULT_CANVAS`（`landscape` 1920×1080）；由 `project:set-canvas` 写入，生成提示词 / 预览画布 / 渲染入口三处都读它（与 `render` 那套档位层级无关） |
| `Project` | `createdAt` / `updatedAt` | `string` / 可选 `string` | 创建与更新时间（ISO 字符串） |
| `ProjectMaterial` | `id` | `string` | 素材 id（主进程 `newMaterialId()` 生成）：勾选、移除都按它定位，**与文件名解耦**（同名文件重复导入也不会串） |
| `ProjectMaterial` | `kind` | `ProjectMaterialKind` | `'image'` / `'video'`——决定落盘目录（`images/` / `video/`）与提示词分块 |
| `ProjectMaterial` | `file` | `string` | **项目内相对引用**（源码注释：`images/xxx.png` \| `video/xxx.mp4`），与场景/字幕同级的跨进程契约；主进程 `normalizeMaterials` 强制它落在本项目素材目录下且不含 `..` |
| `ProjectMaterial` | `label` | `string` | **原始文件名**（源码注释：界面显示 + 提示词里给模型读） |
| `ProjectMaterial` | `selected` | `boolean` | 本次生成是否带上（`normalizeMaterials` 里 `o.selected !== false`，即缺省视为 true） |
| `ProjectMaterial` | `addedAt` | `string` | 加入时间（ISO 字符串） |
| `SubtitleLine` | `n` / `time` / `end` | `number` / `number` / `number \| null` | 序号、起始秒、结束秒（`null` 表示无结束时间） |
| `ProjectMeta` | `name` / `title` / `updatedAt` | `string` | 项目名、标题、更新时间 |
| `ProjectMeta` | `hasSubtitle` / `hasHtml` / `hasVideo` | `boolean` | 三类产物的文件系统存在性（主进程 `scanProjects()` 判定）；`hasVideo` 也是「视频预览」页下拉的筛选依据 |
| `ProjectMeta` | `subtitleCount` | `number` | 字幕条数 |
| `ProjectHtmlMaterials` | `subtitleProject` | 可选 `string` | `''` = 不使用；`'__current__'` = 当前项目字幕；其他 = 指定带字幕的项目名 |
| `ProjectHtmlMaterials` | `materialIds` | 可选 `string[]` | 本次参与生成的素材 id 列表：主进程 `resolveMaterials()` 按 id 从 `normalizeMaterials(proj.materials)` 里取，**顺序即提示词里的列举顺序**，取不到的 id 静默忽略；空 / 缺省 = 不带素材 |
| `ProjectHtmlResult` | `compatible` | `boolean` | HTML 是否通过 HyperFrames 合规校验 |
| `ProjectHtmlResult` | `message` | 可选 `string` | **成功分支也可能带提示**：合规校验未过 / 修改后旧视频已置空等 |

键名与主进程严格对应（`resolveMaterials` 读 `subtitleProject` / `materialIds`；`normalizeMaterials` 读 `id` / `kind` / `file` / `label` / `selected` / `addedAt`），`ProjectAgentPayload` 由 preload 用 `{ name, prompt, ...materials }` 展开合并而成。**背景音频不在素材里**：它由应用按 `project.audioFile` 直接注入 HTML 的 `<audio id="myv-bgm">`，提示词只声明「不要写音轨标签」。

### 2.7 ⑦ 预览 / HyperFrames 转视频（`video.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VideoRenderPayload` | `interface` | `extends RenderOverride`，即 `{ htmlPath?: string; quality?: RenderQuality; fps?: RenderFps; canvas?: RenderCanvas }`——档位字段缺省/非法时主进程不拼对应 CLI 参数；**`canvas` 不是档位而是项目属性**（本次新增）：渲染层把当前项目的画布值一并传下来，`video.ts` 据此往渲染入口注入 `<html data-resolution>`，缺省 / 非法则落 `DEFAULT_CANVAS`（必须有个确定值，否则 HyperFrames 在「页面没声明画布」时兜底 `portrait`） |
| `VideoRenderResult` | `type` | 渲染结果联合：成功 `{ ok: true; outputVideo: string; projectDir: string }`，失败 `{ ok: false; message: string; compatible?: boolean; needPacks?: RuntimePackName[] }` |

> ⑦ 节只有上面两个类型：渲染载荷与渲染结果。渲染进度载荷 `VideoProgressPayload` 归 ⑧ 节（进度推送）。

`VideoRenderResult` **不是** `IpcResult<T>` 的实例：它的失败分支 `message` 必填，且成功分支不复用 `IpcFail` 联合；失败分支的 `compatible: false` 表示 HTML 未通过 HyperFrames 合规校验（渲染层据此区分「环境错误」与「HTML 不合规」），`needPacks` 非空表示本机缺运行环境包（渲染层据此弹下载确认框，见 `docs/runtime-pack-split.md` §5.2）。

### 2.8 ⑧ 进度推送（6 路 main → renderer）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `HtmlAgentStage` | `type` | `'connecting' \| 'thinking' \| 'writing' \| 'retry' \| 'done'`（HTML 生成/修改五阶段） |
| `HtmlAgentProgress` | `interface` | Agent 进度：`stage` / `thinkChars` / `contentChars` / `thinkText` |
| `HtmlProgressPayload` | `interface` | `extends HtmlAgentProgress`，额外带 `text`（`projects.ts` 的 `progressText` 生成的文案）；频道 `project:html-progress` |
| `WhisperProgressStage` | `type` | `'downloading' \| 'loading' \| 'transcribing' \| 'done' \| 'error'` |
| `WhisperProgressPayload` | `interface` | `{ id?, stage, percent?, receivedBytes?, totalBytes?, message }`；频道 `whisper:progress`（下载与转录共用，`loading` / `transcribing` 为转录两阶段） |
| `AlignProgressStage` | `type` | `'synth' \| 'assemble' \| 'done' \| 'error'` |
| `AlignProgressPayload` | `interface` | `{ stage, index?, total?, percent?, message }`；频道 `voice:align-progress` |
| `VideoProgressPayload` | `interface` | `{ text }`（HyperFrames 渲染日志行，渲染层按 `[Render:trace]` 前缀自行解析）；频道 `video:progress` |
| `UpdateStage` | `type` | `'idle' \| 'checking' \| 'available' \| 'skipped' \| 'downloading' \| 'downloaded' \| 'none' \| 'error'`（应用更新的阶段；`idle` 表示本进程尚未检查过） |
| `UpdateProgressPayload` | `interface` | `{ stage, version, currentVersion, percent, transferred, total, bytesPerSecond, message, detail? }`；频道 `update:progress`（检查结果与下载进度共用一路）。`message` 是人话文案、`detail` 是排障详情（仅 `error` 阶段非空），与 `UpdateCheckResult` 同一分层约定（见 §2.3.1） |
| `RuntimeProgressPayload` | `interface` | `{ phase, pack, percent, packs, missing, status, message, detail?, source, bytes, unpackedBytes, files, cancellable }`；频道 `runtime:progress`（运行环境分包的探测 / 下载 / 解包进度，类型定义在本文件 ③.6 节） |

`HtmlAgentProgress` 与 `HtmlProgressPayload` 的分工：前者是 Agent 调用层（`htmlAgent.ts` 的 `emit` / `AgentProgress`）的形状，后者是**线上载荷**（`projects.ts` 补上 `text` 文案字段后推送）。`video:progress` 是 6 路里唯一**没有**单订阅包装的通道（preload 直接 `ipcRenderer.on`）。

### 2.9 ⑨ `PreloadApi`（`window.*` API 契约）

`PreloadApi` 用一个 `interface` 描述 11 个命名空间的完整方法签名，是「preload 实现 ↔ 渲染层消费」的唯一真源：

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
| `hfTools` | 4 | `openHtml`、`renderVideo`、`showInFolder`、`onProgress` | `openHtml` → `Promise<string \| null>`（**保留但渲染层当前无调用方**）；`renderVideo(htmlPath, options?: Omit<VideoRenderPayload, 'htmlPath'>)` → `Promise<VideoRenderResult>`（第二参本次由 `RenderOverride` 改为 `Omit<VideoRenderPayload, 'htmlPath'>`，这样 `canvas?` 能与 `quality?` / `fps?` 一起下发；`htmlPath` 已由第一参数给，故用 `Omit` 排除）；`showInFolder` → `Promise<void>`；`onProgress(cb: (data: VideoProgressPayload) => void)` |
| `settingsTools` | 6 | `get`、`save`、`saveRender`、`saveUpdater`、`test`、**`pickRuntimePack`** | `get` → `Promise<AppSettings>`（**不经 `ok` 包裹**）；`save(customModel)` / `saveRender(render)` / `saveUpdater(updater)` → `Promise<IpcResult<SettingsSaveResult>>`（preload 分别包装为 `{ customModel }` / `{ render }` / `{ updater }`）；`test(customModel)` → `Promise<IpcResult>`（失败分支可能带 `detail` / `needConfig`，见 §2.1）；`pickRuntimePack()` → `Promise<IpcResult<{ pack?: RuntimePackName }>>`（弹文件框选 `ffmpeg.7z` / `hyperframes.7z`，导入 `userData/runtime/local-import/`；取消时 `{ ok:false, canceled:true }`，导入成功后由调用方接着 `runtimeTools.prepare()`） |
| `voiceTools` | 19 | `getConfig`、`getSaveDir`、`saveConfig`、`pickAudio`、`pickDir`、`listGenerated`、`create`、`list`、`listSystemVoices`、`listAll`、`listModels`、`getProfiles`、`saveProfile`、`deleteProfile`、**`deleteCloudVoice`**、`synth`、`synthAligned`、`cancelAlign`、`onAlignProgress` | 见下 |
| `whisperTools` | 12 | `status`、`download`、`delete`、`setCurrent`、`addModel`、`updateModel`、`removeModel`、`openDir`、`pickAudio`、`projectAudio`、`transcribe`、`onProgress` | 见下 |
| `projectTools` | 26 | `list`、`create`、`load`、`saveSubtitle`、`saveContent`、`generateHtml`、`modifyHtml`、`downloadHtml`、`exportSrt`、`readHtml`、`saveHtml`、`previewHtml`、`pickAudio`、`setAudio`、`clearAudio`、**`pickMedia`、`addMaterials`、`saveMaterials`**、`extractVideoAudio`、`openFolder`、`openFolderOf`、`delete`、`saveVideo`、`setRender`、**`setCanvas`**、`onHtmlProgress` | 见下（素材库那次是 **3 换 3**、成员数当时仍是 25；本次新增 `setCanvas` ⇒ 26） |
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
| `projectTools` | `load(name)` | `Promise<Project \| null>`（**不走 `IpcResult`**；项目名为空时主进程返回 `null`，见 §5；非空时返回的 `materials` 已由主进程规范化） |
| `projectTools` | `generateHtml` / `modifyHtml(name, prompt, materials?: ProjectHtmlMaterials)` | `Promise<IpcResult<ProjectHtmlResult>>`（失败分支可能带 `needConfig` / `title`：配置类错误由主进程 `projects.ts` 用 `configTargetOf()` 补分类；`materials` 里带的是 `materialIds` 不是路径） |
| `projectTools` | `downloadHtml` / `exportSrt` | `Promise<IpcResult<ProjectDownloadResult>>` |
| `projectTools` | `readHtml` / `saveHtml` / `previewHtml` | `IpcResult<ProjectReadHtmlResult>` / `IpcResult<ProjectHtmlResult>` / `IpcResult<ProjectPreviewHtmlResult>` |
| `projectTools` | `pickAudio()` | `Promise<string \| null>` |
| `projectTools` | `pickMedia(kind: ProjectMaterialKind)` | `Promise<string[]>`（**不走 `IpcResult`**：取消 / 无窗口返回空数组；图片可多选、视频单选） |
| `projectTools` | `addMaterials(name, paths: string[])` | `Promise<IpcResult<ProjectMaterialsResult>>`（复制入库 + 登记；「部分成功」时 `ok: true` 且 `message` 说明跳过了几个） |
| `projectTools` | `saveMaterials(name, materials: ProjectMaterial[])` | `Promise<IpcResult<ProjectMaterialsResult>>`（整份列表回写：**移除与勾选共用**） |
| `projectTools` | `setAudio` / `extractVideoAudio` | `IpcResult<ProjectSetAudioResult>`（含可选 `htmlUpdated`，表示注入音轨改写了 `index.html`） / `IpcResult<ProjectSetAudioResult>`（后者**界面入口暂未开放**，签名保留） |
| `projectTools` | `clearAudio` / `openFolder` / `delete` | `Promise<IpcResult>`（无载荷）；主进程 `project:clear-audio` 实际上还返回 `htmlUpdated`（是否摘掉了 HTML 里的注入音轨），但**未纳入本契约**，渲染层不使用该字段 |
| `projectTools` | `openFolderOf(dirOrFile)` | `Promise<IpcResult<ProjectOpenFolderOfResult>>` |
| `projectTools` | `onHtmlProgress(cb)` | `void`，回调 `(data: HtmlProgressPayload) => void`（单订阅） |

## 3. 关键流程或结构

### 3.1 三端共享路径

```
                        src/shared/types.ts
      ┌──────────────────────┬────────────────────────┬─────────────────────┐
      ▼                      ▼                        ▼                     ▼
  src/main/*             src/preload/index.ts    src/preload/index.d.ts   渲染层
  (10 个模块 import 类型)   (导入 PreloadApi + 7 个类型)  (导入 PreloadApi)   （经 Window 间接获得）
```

`tsconfig.web.json` 的 `include` 含 `"src/shared/**/*.ts"` 与 `"src/preload/index.d.ts"`；`tsconfig.node.json` 覆盖主进程与 `src/preload/index.ts`；`npm run typecheck` 依次跑 `tsconfig.node.json`、`tsconfig.web.json`、`tsconfig.agent.json`，因此本文件的任何字段改动会同时触发三端编译报错定位。

### 3.2 设置数据的读写闭环

1. `AppSettings` 是 `userData/settings.json` 的完整镜像；主进程 `settings.ts` 负责读写与合并，`whisper` 分区由 `WhisperSettings` 描述。
2. 渲染层通过 `window.settingsTools.get()` 取到 `AppSettings`，通过 `window.settingsTools.save(customModel)` 提交 `CustomModelConfig`，通过 `window.voiceTools.saveConfig({ provider, config })` 提交**某个厂家**的部分语音配置（`VoiceSaveConfigPayload`）；两者的成功分支都是 `IpcResult<SettingsSaveResult>`，由 `voice:save-config` / `settings:save` 回带 `settings`。
3. 音色映射以 `Record<string, VoiceProfile>` 存储，`voiceTools.saveProfile(profile)` / `deleteProfile(key)` 按 key 增删，入参用 `VoiceProfileInput`（`name` / `type` 可缺省），线上载荷分别是 `VoiceProfilePayload` / `VoiceProfileKeyPayload`。
4. whisper 分区即以 `WhisperSettings` 落盘，`whisperTools.addModel/updateModel/removeModel` 对应 `customModels` 数组的增删改，载荷为 `WhisperAddModelPayload` / `WhisperUpdateModelPayload` / `WhisperIdPayload`。

### 3.3 项目素材的读写闭环（本轮新增）

1. **选文件**：`projectTools.pickMedia(kind)` → `project:pick-media`，主进程按 `kind` 给扩展名过滤（白名单来自 `src/shared/constants.ts`），返回**外部绝对路径数组**（不落盘、不登记）。
2. **入库**：`projectTools.addMaterials(name, paths)` → `project:add-materials`，主进程 `copyMaterialIntoProject()` 把文件复制进项目 `images/` / `video/`，再以 `newMaterialId()` 生成 id 登记进 `proj.materials`（新素材 `selected: true`），返回 `ProjectMaterialsResult`（`materials` = 落盘后的完整列表，部分成功时另有 `message`）。
3. **勾选 / 移除**：渲染层持完整列表，改动后整体回写 `projectTools.saveMaterials(name, materials)` → `project:save-materials`，主进程 `normalizeMaterials()` 规范化后覆盖落盘（**移除只摘登记、不删文件**）。
4. **读回**：`project:load` 返回 `{ ...proj, materials: normalizeMaterials(proj.materials) }`，因此渲染层拿到的永远是通过校验的列表；`HtmlGenPage/MaterialsSection.vue` 每次写操作成功后调 `refreshProject()`，把最新列表放进 `appState.project.materials`。
5. **进提示词**：生成 / 修改时提交 `ProjectHtmlMaterials.materialIds`（勾选项的 id），主进程 `resolveMaterials()` 按 id 过滤、`buildMaterialBlock()` 拼「【图片素材】/【视频素材】」两段。

### 3.4 主进程 register 模式

```ts
// src/main/*.ts 的统一签名（示意）
export function register(ctx: RegisterCtx): void { /* 用 ctx.getWindow() 拿窗口发消息 */ }
```

`RegisterCtx` 用 `getWindow: () => BrowserWindow | null` 而非 `window: BrowserWindow`，使各功能模块在窗口尚未创建时也能安全加载；每个推送型频道（`whisper:progress` 等）发送前都需对 `null` 做判空。

### 3.5 `PreloadApi` 契约如何生效

1. `src/preload/index.ts` 的 11 个 `contextBridge` 对象分别标注为 `PreloadApi['electronAPI']`、`PreloadApi['hfTools']` … —— 方法名、参数顺序、返回类型写错会在 `tsconfig.node.json` 阶段直接编译失败（实现被契约校验）。
2. `src/preload/index.d.ts` 只有 `import type { PreloadApi } from '../shared/types'` + `declare global { interface Window extends PreloadApi {} }`，不再自己定义任何类型；渲染层看到的 `window.*` 与 preload 实现同源。
3. 因此「改契约」变成**只改本文件 ⑨ 节**这一件事：两端同时生效。⑨ 节注释同时指明命名空间与 IPC 频道的对应关系见 `src/shared/ipc.ts`（11 个命名空间 ↔ 10 组频道常量）。

### 3.6 `IpcResult` 的判别联合与收窄

1. 调用方 `const res = await window.projectTools.generateHtml(name, prompt)`。
2. 判 `if (res.ok)` → TS 收窄到 `{ ok: true } & ProjectHtmlResult`，可平铺访问 `res.htmlPath` / `res.compatible` / `res.message`（业务字段直接平铺，没有 `data` 包装）。
3. 判 `else` → 收窄到 `IpcFail`，可安全读取 `res.message`（以及排障用的 `res.detail`），并按 `res.canceled` 区分「用户取消」与「真实失败」；若 `res.needConfig` 为真，则说明这是**配置类**失败（渲染层据此弹 `useConfigPrompt` 的「去设置 / 取消」框，`res.title` 由主进程一并给出）。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖（仅类型） | `electron` | 仅引入 `BrowserWindow` 类型（`ConfigTarget` 定义在本文件内，不需要额外 import） |
| 被 import | `src/main/settings.ts` | `AppSettings`、`CustomModelConfig`、`RegisterCtx`、`VoiceProfile`、`VoiceProviderConfig`、`VoiceSettings`、`VoiceTTSConfig`（旧结构，迁移来源）、`WhisperCustomModel` |
| 被 import（+ 再导出） | `src/main/projects.ts` | `RegisterCtx`、`ProjectAgentPayload`、`ProjectExportSrtPayload`、`ProjectNamePayload`、`ProjectSaveContentPayload`、`ProjectSaveHtmlPayload`、`ProjectSaveSubtitlePayload`、`ProjectSetAudioPayload`、`ProjectSetVideoPayload`、**`ProjectMaterial`、`ProjectMaterialKind`、`ProjectAddMaterialsPayload`、`ProjectPickMediaPayload`、`ProjectSaveMaterialsPayload`**、**`ProjectSetCanvasPayload`、`RenderCanvas`**（本次新增）；并 `export type { ContentScript, Project, Scene, SubtitleLine }` 再导出四个项目结构 |
| 被 import（仅类型） | `src/renderer/src/composables/useAppStore.ts` | `ProjectMaterial`（`ProjectState.materials` 的元素类型）、**`RenderCanvas`**（本次新增：`ProjectState.canvas` 的类型）、`ProjectMeta`（并 `export type { ProjectMeta }` 再导出） |
| 被 import | `src/main/index.ts` | `RegisterCtx`、`LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`（后三者服务于 `legacy:status` / `legacy:resolve`） |
| 被 import | `src/main/whisper.ts` | `RegisterCtx`、`WhisperCustomModel` 与全部 `Whisper*Payload`（含 `WhisperProgressPayload`） |
| 被 import | `src/main/voice.ts` | `RegisterCtx`、**`ConfigTarget`**（`voiceNoKeyFail()` 的返回类型）、`SystemVoice`、`VoiceModel`、`VoiceProviderView`、`VoiceSettings`、`VoiceProfile`、`VoiceCreatePayload`、`VoiceProfileKeyPayload`、`VoiceProfilePayload`、`VoiceSaveConfigPayload`、`VoiceSaveDirPayload`、`VoiceSynthPayload` |
| 被 import | `src/main/ttsAlign.ts` | `RegisterCtx`、`AlignProgressPayload`（取代原本地 `AlignProgressInfo`）、`VoiceAlignPayload` |
| 被 import | `src/main/video.ts` | `RegisterCtx`、**`RenderCanvas`**（本次新增：`applyCanvasDeclaration()` / `prepareEntry()` 的画布入参）、`VideoRenderPayload`、`VideoRenderResult`（取代原本地声明的 `RenderPayload` / `RenderResult`） |
| 被 import | `src/main/runtime.ts` | `RegisterCtx`、`IpcResult`、`RuntimePackName`、`RuntimePackState`、`RuntimeProgressPayload`（③.6 节） |
| 被 import | `src/main/htmlAgent.ts` | `HtmlAgentProgress`（以 `export type AgentProgress = HtmlAgentProgress` 对外保留 `AgentProgress` 名）+ **`ConfigTarget`**（每次尝试的 `attemptCfg` 字段类型） |
| 被 import | `src/main/systemVoices.ts` | `SystemVoice` |
| 被 import（仅类型） | `src/preload/index.ts` | `PreloadApi`、`AlignProgressPayload`、`HtmlProgressPayload`、**`RenderCanvas`**、`RenderOverride`、`RuntimePackName`、`RuntimeProgressPayload`、`UpdateProgressPayload`、**`VideoRenderPayload`**、`WhisperProgressPayload`（后两个本次新增：`hfTools.renderVideo` 的第二参写成 `Omit<VideoRenderPayload, 'htmlPath'>`、`setCanvas` 的形参用 `RenderCanvas`） |
| 被 import（仅类型） | `src/preload/index.d.ts` | `PreloadApi`，供 `declare global Window` 使用 |
| 被 import（仅类型） | `src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue` | `ProjectMaterial`、`ProjectMaterialKind`（素材卡片与 `onAdd(kind)` 的类型） |
| 被 import（仅类型） | `src/renderer/src/composables/useConfigPrompt.ts` | **`ConfigTarget`**（`useConfigPrompt()` 的 `target` ref 与 `open()` / `fromResult()` 的形参类型） |

## 5. 注意事项与实现要点

- **字段名禁止改动**：注释写明「载荷格式必须与现行实现逐字段一致，禁止改动结构」。设置文件已在用户 `userData` 中落盘，改字段名等于丢失既有配置；项目结构改动还会打断 `project.json` 的向后兼容。
- **新增 / 修改 IPC 须三处齐改**：主进程 `register()` 回调、本文件类型、preload 桥接方法；若签名发生变化，`PreloadApi`（⑨ 节）必须同步，否则 preload 侧直接编译不过。
- **只往 `IpcFail` 加可选字段时不必改 preload**：`needConfig` / `title` 是主进程写、渲染层读的**纯分类字段**，preload 只是 `ipcRenderer.invoke` 原样转发 —— 把「新增失败字段」也算进三处齐改会白改一处。
- **本轮素材接口的契约形状（`ProjectMaterial` 一族）**：`Project` 只新增**可选**字段 `materials`（老项目读回来 `undefined`，由主进程 `normalizeMaterials` 归为 `[]`），因此**不构成破坏性变更**；`ProjectHtmlMaterials.videoPath` 被 `materialIds?: string[]` 取代——它只被 `project:generate-html` / `project:modify-html` 两个频道消费，且渲染层与主进程同步改完，所以可以直接替换字段名。
- **`ProjectMaterial.file` 是相对引用、`label` 是原始文件名**：前者必须落在本项目 `images/` / `video/` 下（跨进程契约 + 越权防护），后者只作展示与给模型读的说明；两者不要互相替代。
- **`ProjectSaveMaterialsPayload.materials` 刻意是 `unknown`**：渲染层提交的是完整列表，主进程必须自己规范化后才能信任它（防脏数据与越权路径），写成 `ProjectMaterial[]` 会给人「已经校验过」的错觉。
- **成片画布 `RenderCanvas` 是「项目属性」而不是「渲染档位」**（本次新增）：它**不参与** `RenderOverride` 的「项目级覆盖 > 全局默认」合并，也没有全局默认那一层，读写走独立的 `Project.canvas?` 与 `project:set-canvas`。这么做的理由：HyperFrames CLI 在页面没声明画布时**兜底 `portrait`**（成片变 1080×1920 竖屏，宽屏版式被裁掉两侧、上下留大片黑边——本项目实测故障），所以画布必须由项目给出一个**确定值**，并同时喂给生成提示词、预览 iframe 与渲染入口注入的 `<html data-resolution>`。`VideoRenderPayload.canvas?` 与 `quality?` / `fps?` 同路下发但语义不同：前者决定画布 / 成片尺寸，后者决定编码质量与帧率。
- **`Project.videoMaterial` 是历史字段**：本轮起不再写入、素材列表也不读它；仅被暂时隐藏入口的 `project:extract-video-audio` handler 使用。**不要在新代码里读它**。
- **`IpcFail.message` 是可选字段**：`voice:pick-dir` 的用户取消分支只回 `{ ok: false, canceled: true }`，因此读取 `message` 的代码要容忍 `undefined`（渲染层约定式写法 `(res as { message?: string })?.message || '默认文案'`）。
- **`IpcFail.detail` 是「可选的技术详情」**：与 `message` 分工明确 —— `message` 说人话（用户能做什么）、`detail` 给排障（原始报错 / HTTP 状态 / 请求 URL），UI 用「查看详情」折叠展示。它同样是可选的，取消分支与部分简单失败分支不带它。
- **`IpcFail.needConfig` / `title` 是「配置类」两件套**：它们**不驱动流程**（对比 `needPacks` 需要用户下载完环境再「继续」重发操作），只把「这个错误该去哪修」从渲染层的正则猜测改成主进程单点分类；界面据此弹出**只有 `[去设置]` / `[取消]` 两个按钮**的弹窗。**配置类弹窗刻意不显示 `detail`**（见 `docs/error-mapping.md` §11.1）。它曾有第三个字段 `configUrl`（余额类的充值页）与对应的「去充值」按钮，**已按用户要求整条摘除**——余额 / 欠费改为走内嵌状态行。
- **`ConfigTarget` 与 `SettingsSectionKey` 取值不同名但语义对齐**：`ConfigTarget = 'model' | 'voice'`，而设置页分类键是 `SettingsSectionKey`（`'model' | 'voice' | 'update'`）；映射写在 `useConfigPrompt.ts` 的 `SECTION_OF`（`model → model`、`voice → voice`）。改任一侧都要一起看。
- **`UpdateCheckResult.message` 是必填、`IpcFail.message` 是可选的**：前者由主进程**单点产出**（`available` / `skipped` / `none` 三种状态文案都在 `updater/base.ts` 的 `bindEvents()` 里写），渲染层只渲染不再拼串；后者必须保持可选以兼容 `voice:pick-dir` 的取消分支。两者的 `detail` 都只在 UI「查看详情」里展开。
- **`VoiceSavedTo` 与 `VoiceSaveDirMode` 取值集合相同但字段名不同**：前者是 `voice:synth` 结果里的 `savedTo`，后者是 `voice:get-save-dir` 结果里的 `mode`；源码注释明确「现行实现如此，勿『统一化』」。
- **`VoiceProfile.type` 是字面量联合**：类型为 `VoiceProfileType`（`'system' | 'custom'`），不再是宽泛 `string`；但线上保存分支的 `VoiceProfilePayload.profile.type` 仍是 `type?: string`（主进程按「非 `system` 一律归 `custom`」归一），两者不要混用。
- **`AppSettings.whisper` 有独立 interface**：即 `WhisperSettings`，需要复用该分区时直接引用，不要重复内联声明。
- **`SystemVoice` 与 `SystemVoiceItem` 的分工**：`SystemVoice` 是内置音色表的 4 字段条目（由 `src/main/systemVoices.ts` 提供）；`voice:list-system-voices` 下发的元素是 `SystemVoiceItem`（多一个 `model` 字段）。
- **`VideoRenderResult` 不是 `IpcResult`**：失败分支 `message` 必填、成功分支带 `outputVideo` / `projectDir`，且失败可带 `compatible?: boolean`（HTML 不合规）与 `needPacks?: RuntimePackName[]`（缺运行环境包）；文档与代码不要一律按 `IpcResult` 处理。
- **少数 API 不走 `ok` 包裹**：`settingsTools.get()` → `AppSettings`、`projectTools.list()` → 数组、`projectTools.load()` → `Project | null`、**`projectTools.pickMedia()` → `string[]`**、`hfTools.openHtml` / `pickAudio` → `string | null`、`appTools.copyText` → `boolean`、`updateTools.version()` → `string`（同步）。其中 `projectTools.load()` 在项目名为空时**确实返回 `null`**，调用方必须做空值守卫（`useAppStore.refreshProject` 已据此加守卫）。
- **`RegisterCtx.getWindow` 可为 `null`**：所有 `webContents.send` 前必须判空，否则窗口关闭或重载期间会抛异常。
- **结构类型靠「再导出」保引用面**：`src/main/projects.ts` 的 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'`、`src/renderer/src/composables/useAppStore.ts` 的 `export type { ProjectMeta }` 都只是转发 —— `projects.Project`、`from './projects'`、`import { ProjectMeta } from '@renderer/composables/useAppStore'` 这类既有引用不需要改动，但结构本身只在本文档定义一处。新增字段时改这里即可，不要在被再导出的文件里重建 interface。
- **主进程 handler 的 `payload` 参数一律标注契约类型**：如 `ProjectSaveSubtitlePayload`、`ProjectAgentPayload`、**`ProjectPickMediaPayload` / `ProjectAddMaterialsPayload` / `ProjectSaveMaterialsPayload`**、`VoiceSaveConfigPayload`（`voice:save-config` 的形参另**联合**了历史形态）、`VoiceAlignPayload`；因此字段名改动会在主进程侧直接编译报错。
- **并非所有导出名都会出现在 import 语句里**：文件内类型相互引用（如 `IpcResult` 被 `PreloadApi` 的多个成员使用、`SystemVoiceItem extends SystemVoice`），另有一批 `*Result` / `*Payload` 类型只用于描述 handler 的返回结构与线上载荷形状；这不代表它们是死代码，删除前需确认契约文档的完整性。
- **纯类型文件**：编译后不产出 JS；不要在此文件写常量或函数（常量请放 `src/shared/ipc.ts` / `src/shared/constants.ts`，需要纯函数映射时放 `src/shared/errors.ts`）。
