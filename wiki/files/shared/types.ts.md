# src/shared/types.ts

> 跨进程共享的 IPC 载荷与设置类型定义，三端（main / preload / 渲染层）唯一类型真源

- **所在目录**：`src/shared/`
- **类型**：共享类型（纯 `interface` / `type` 别名，无运行时代码）
- **规模**：772 行
- **对外导出**：按 12 个小节组织（源码编号 ①～⑨，其中穿插 ③.5 / ③.6 / ⑧b 三个补充小节）—— ① 通用 IPC 结果 2 个（`IpcFail`、`IpcResult`）② 主进程装配上下文 1 个（`RegisterCtx`）③ 设置（含 `UpdaterSettings`、`SettingsSaveUpdaterPayload`、渲染档位）③.5 应用自更新 4 个（`UpdateCheckState`、`UpdateCheckResult`、`UpdateStage`、`UpdateProgressPayload`）③.6 运行环境包 2 个（`RuntimeStage`、`RuntimeProgressPayload`）⑧b 历史数据目录 3 个（`LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`）④ 音色与配音 ⑤ 语音识别 ⑥ 项目与字幕 ⑦ 预览 / 转视频 2 个（`VideoRenderPayload`、`VideoRenderResult`）⑧ 进度推送 ⑨ `PreloadApi` 1 个

## 1. 作用与职责

本文件定义主进程、preload、渲染层三端共同使用的数据形状，并集中收敛原先散落在各处的类型声明：

1. **统一载荷格式**：IPC 两端对同一份数据（设置文件、音色条目、模型条目、项目结构）使用完全相同的字段名与类型，避免「主进程叫 `voiceId`、渲染层叫 `voice_id`」这类漂移。
2. **统一 IPC 结果形状**：`IpcFail` / `IpcResult<T>` 是全部 `{ ok, ... }` 结果类型的唯一来源 —— 它们原先只在 `src/preload/index.d.ts` 内部以 `OkResult` / `FailResult` / `IpcResult` 三个未导出类型存在，现在上移到共享层并被主进程、preload、渲染层共同引用。
3. **描述持久化结构**：`CustomModelConfig` / `VoiceTTSConfig` / `VoiceProfile` / `WhisperCustomModel` / `WhisperSettings` / `AppSettings` 共同构成 `userData/settings.json` 的完整 schema。
4. **定义 `window.*` 契约**：⑨ 节的 `PreloadApi` 用 11 个命名空间的完整方法签名描述「preload 实现 ↔ 渲染层消费」的唯一真源 —— `src/preload/index.ts` 用它标注各 `contextBridge` 对象，`src/preload/index.d.ts` 用它给 `Window` 补类型，因此两端不会再各自漂移。
5. **收敛主进程的本地类型**：`whisper.ts` / `ttsAlign.ts` / `video.ts` / `htmlAgent.ts` / `voice.ts` / `projects.ts` 原先各自声明过 `WhisperProgressPayload`、`AlignProgressInfo`、`RenderPayload` / `RenderResult`、`AgentProgress`、`VoiceModel`、`Scene` / `ContentScript` / `Project` / `SubtitleLine`，现在全部改为从本文件导入（`htmlAgent.ts` 保留 `AgentProgress` 这一导出名，但它已是 `HtmlAgentProgress` 的类型别名；`projects.ts` 用 `export type { … } from '../shared/types'` 再导出，保持 `projects.Project` / `from './projects'` 的既有引用面）。**`src/main/` 下已不存在任何本地声明的 payload / result / progress 接口**，各 IPC handler 的 `payload` 参数也一律用本文件的 `*Payload` 类型标注（此前多为 `Record<string, unknown>` 或内联字面量）。
6. **约束主进程装配模式**：`RegisterCtx` 把 `src/main/*.ts` 各模块 `register(ctx)` 所依赖的能力（拿主窗口）显式化。

文件按 12 个小节组织（源码小节横幅依次为 ① ② ③ ③.5 ③.6 **⑧b** ④ ⑤ ⑥ ⑦ ⑧ ⑨——`⑧b 历史数据目录` 在这一版里被写在 ③.6 与 ④ 之间，是「旧数据处置」契约的补充小节），首行注释给出两条硬约束：**载荷格式必须与现行实现逐字段一致，禁止改结构**；**新增/修改 IPC 接口须三处齐改 —— 主进程 `register()` 回调、本文件类型、preload 桥接方法**。文件为纯类型模块，编译后不产生任何运行时代码，仅 1 个 `import type`（引自 `electron`，用于 `BrowserWindow`）。

| 小节 | 覆盖内容 | 主要消费方 |
| --- | --- | --- |
| ① 通用 IPC 结果 | `IpcFail`、`IpcResult<T>` | `PreloadApi` 全体成员、各主进程模块的返回结构 |
| ② 主进程装配上下文 | `RegisterCtx` | `src/main/*.ts` 的 `register(ctx)` |
| ③ 设置 | `settings.json` 的 schema（含渲染档位 `render` 与更新设置 `updater`）与 `settings:*` / `voice:save-config` 载荷 | `src/main/settings.ts`、设置页、配音页 |
| ③.5 应用自更新 | `update:*` 的检查结果（`message` + `detail` 分层）与进度载荷 | `src/main/updater.ts`、设置页 |
| ③.6 运行环境包 | `RuntimeStage`、`RuntimeProgressPayload`（运行环境包阶段与下载 / 解包进度） | `src/main/runtime.ts`、设置页、`src/renderer/src/composables/useRuntime.ts` |
| ⑧b 历史数据目录 | `LegacyDataInfo`（扫描结论）、`LegacyResolveAction`（三选一）、`LegacyResolveResult`（执行结果与迁移计数） | `src/main/index.ts`、`src/renderer/src/composables/useLegacyData.ts`、`src/renderer/src/components/LegacyDataDialog.vue` |
| ④ 音色与配音 | 系统音色、克隆音色、音色映射、合成/对齐载荷与结果 | `src/main/voice.ts`、`src/main/ttsAlign.ts` |
| ⑤ 语音识别 | whisper 模型状态、转录载荷与结果 | `src/main/whisper.ts` |
| ⑥ 项目与字幕 | `project.json`（含渲染档位覆盖 `render`）、字幕行、项目列表项、HTML 生成载荷 | `src/main/projects.ts` |
| ⑦ 预览 / 转视频 | 渲染载荷与渲染结果 | `src/main/video.ts` |
| ⑧ 进度推送 | 6 路 main → renderer 推送的载荷 | `src/main/*.ts` 推送方 + `src/preload/index.ts` 订阅方 |
| ⑨ `window.*` API 契约 | `PreloadApi`（11 个命名空间） | `src/preload/index.ts`、`src/preload/index.d.ts`、渲染层全部 `window.*` 调用 |

## 2. 导出与关键实现

### 2.1 ① 通用 IPC 结果

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `IpcFail` | `interface` | 失败分支：`ok: false` + 可选 `message?: string` + 可选 `detail?: string` + 可选 `canceled?: boolean` |
| `IpcResult<T = unknown>` | `type` | `({ ok: true } & T) \| IpcFail`，成功分支是 `{ ok: true }` 与业务字段 `T` 的**交叉类型**（业务字段平铺在结果对象上，没有 `data` 包装） |

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | `false`（`IpcFail`）/ `true`（成功分支） | 判别联合的判别式，`if (!res.ok)` 后 TS 自动收窄到 `IpcFail` |
| `message` | 可选 `string` | 失败说明（人话）。**可选**的原因：`voice:pick-dir` 的「用户取消」分支只回 `{ ok: false, canceled: true }`，没有 `message` |
| `detail` | 可选 `string` | **可选的技术详情**（原始报错 / HTTP 状态 / 请求 URL）：供 UI 的「查看详情」折叠展示，与面向用户的 `message` 分离——`message` 说人话，`detail` 给排障。见 `UpdateCheckResult.detail` |
| `canceled` | 可选 `boolean` | 区分「用户取消」与「真实失败」，渲染层通常静默忽略取消 |

`T` 缺省为 `unknown`，表示调用方只关心 `ok`（如 `clearAudio` / `clearVideo` / `delete` 等无载荷的写操作）。

### 2.2 ② RegisterCtx（主进程装配上下文）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `getWindow` | `() => BrowserWindow \| null` | 惰性获取当前主窗口；返回 `null` 表示窗口尚未创建或已销毁。用函数而非直接持有 `BrowserWindow`，可避免模块加载顺序造成的空引用 |

### 2.3 ③ 设置（`userData/settings.json`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `CustomModelConfig` | `interface` | OpenAI 兼容自定义模型配置：`baseUrl` / `modelId` / `apiKey` / `enabled` |
| `VoiceTTSConfig` | `interface` | 千问语音配置：`apiKey` / `targetModel` / `saveDir` |
| `VoiceProfileType` | `type` | `'system' \| 'custom'`（音色类型字面量联合） |
| `VoiceProfile` | `interface` | 本地音色映射条目：`key` / `name` / `voice` / `targetModel` / `type` |
| `VoiceProfileInput` | `interface` | 保存映射的入参：`key` / `voice` / `targetModel` + 可选 `name` / `type`（主进程按 `voice` 回填 `name`，按 `'system'` 之外一律归 `'custom'`） |
| `WhisperCustomModel` | `interface` | whisper 自定义模型条目：`id` / `name` / `file` / `url` / `sizeMB` / `desc`（`id` 由文件名派生） |
| `WhisperSettings` | `interface` | whisper 分区：`modelId` / `customModels: WhisperCustomModel[]` |
| `AppSettings` | `interface` | 设置文件根结构：`customModel` / `voiceTTS` / `voiceProfiles` / `whisper` / `render` |
| `SettingsSavePayload` | `interface` | `settings:save` 线上载荷：`{ customModel: CustomModelConfig }` |
| `SettingsTestPayload` | `interface` | `settings:test` 线上载荷：形状与 `SettingsSavePayload` 相同 |
| `SettingsSaveResult` | `interface` | `settings:save` 成功分支：`{ settings: AppSettings }`（`voice:save-config` 复用同一结果形状） |
| `RenderQuality` | `type` | 渲染质量字面量联合：`'draft' \| 'standard' \| 'high'` |
| `RenderFps` | `type` | 渲染帧率字面量联合：`24 \| 30` |
| `RenderOptions` | `interface` | **完整**渲染档位 `{ quality: RenderQuality; fps: RenderFps }`（`settings.json` 的 `render` 段与生效档位都用它） |
| `RenderOverride` | `type` | `Partial<RenderOptions>`——**项目级覆盖**：字段可缺省，缺省项跟随全局默认 |
| `SettingsSaveRenderPayload` | `interface` | `settings:save-render` 线上载荷：`{ render?: RenderOverride }`（只更新 `render` 段，不动 `customModel`） |

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `CustomModelConfig` | `baseUrl` | `string` | OpenAI 兼容端点根地址 |
| `CustomModelConfig` | `modelId` | `string` | 模型标识（如 `gpt-4o-mini`） |
| `CustomModelConfig` | `apiKey` | `string` | 接口密钥 |
| `CustomModelConfig` | `enabled` | `boolean` | 是否启用自定义模型（关闭则走内置/默认通道） |
| `VoiceTTSConfig` | `apiKey` | `string` | 千问 DashScope 类接口密钥 |
| `VoiceTTSConfig` | `targetModel` | `string` | 目标 TTS 模型 |
| `VoiceTTSConfig` | `saveDir` | `string` | 生成音频保存目录（空串表示使用默认/项目目录） |
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
| `AppSettings` | `voiceTTS` | `VoiceTTSConfig` | 语音 TTS 配置 |
| `AppSettings` | `voiceProfiles` | `Record<string, VoiceProfile>` | 音色映射表，键即 `VoiceProfile.key` |
| `AppSettings` | `whisper` | `WhisperSettings` | whisper 分区 |
| `AppSettings` | `render` | `RenderOptions` | 视频渲染**全局默认档位**（项目未覆盖时生效；读取时经 `normalizeRenderOptions` 规范化） |
| `SettingsSaveResult` | `settings` | `AppSettings` | 保存后的完整设置（主进程回带） |

### 2.3.1 ③.5 应用自更新（`src/main/updater.ts`）

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

### 2.3.2 ③.6 运行环境包（`src/main/runtime.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `RuntimeStage` | `type` | `'idle' \| 'checking' \| 'downloading' \| 'extracting' \| 'ready' \| 'failed'`——`idle` 未检查；`checking` 找包 / 读清单；`downloading` 从更新源下载包；`extracting` 7za 解包；`ready` 就绪（含 dev / 旧版布局内置）；`failed` 失败（转录、渲染不可用） |
| `RuntimeProgressPayload` | `interface` | `runtime:progress` 推送与 `runtime:status` 返回共用的载荷；字段见下 |

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `stage` | `RuntimeStage` | 当前阶段 |
| `percent` | `number` | downloading / extracting 阶段有效；`ready` 为 100 |
| `id` | `string` | 运行环境包的内容 id（sha512 前 12 位，也是解包目录名），未知时为空串 |
| `message` | `string` | 用户可见文案（人话：正在做什么 / 已经就绪 / 失败了怎么办） |
| `detail` | 可选 `string` | 排障详情（7za 退出码、HTTP 状态、路径等），仅失败或降级时有值 |
| `source` | `string` | `local` = 随安装包携带；`download` = 从更新源下载；`dev` / `legacy` = 安装目录内已是展开形态；`cache` = 复用已解包目录 |
| `bytes` | `number` | 包体积（下载进度用） |
| `unpackedBytes` / `files` | `number` | 解包后体积与文件数（解包进度的分母，也用于设置页展示「运行环境 716 MB / 4917 文件」） |

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
| `VoiceModelInput` | `type` | `'url' \| 'file'`（音色克隆的音频输入方式） |
| `VoiceModel` | `interface` | 候选合成模型：`id` / `label` / `role` + 可选 `input` / `group` / `isDefault` / `series` |
| `ClonedVoice` | `interface` | 云端克隆音色项：`voice?`（Qwen-TTS 系列）/ `voice_id?`（Qwen-Audio-TTS 系列）/ `target_model?` / `targetModel?` |
| `VoiceListItem` | `interface` | `voice:list-all` 结果项（系统 + 克隆合并，统一「音色即模型」形态）：`key` / `type` / `name` / `voiceId` / `model` |
| `GeneratedAudioItem` | `interface` | `voice:list-generated` 结果项：`path` / `name` / `group` / `size` / `mtime` |
| `VoiceConfigResult` | `interface` | `voice:get-config` 结果：`apiKey` / `targetModel` / `saveDir` |
| `VoiceSaveDirPayload` | `interface` | `voice:get-save-dir` 载荷：`saveDir?` / `defaultOut?` / `projectName?` |
| `VoiceSaveDirMode` | `type` | `'custom' \| 'output' \| 'project' \| 'default'`（保存目录解析模式） |
| `VoiceSaveDirResult` | `interface` | `{ mode: VoiceSaveDirMode; saveDir: string }` |
| `VoiceSaveConfigPayload` | `interface` | `voice:save-config` 线上载荷：`{ voiceTTS: Partial<VoiceTTSConfig> }` |
| `VoiceProfilesResult` | `interface` | `{ profiles: Record<string, VoiceProfile> }`（`getProfiles` / `saveProfile` / `deleteProfile` 共用） |
| `VoiceProfilePayload` | `interface` | `voice:save-profile` 线上载荷：`{ profile: Partial<VoiceProfile> & { type?: string } }` |
| `VoiceProfileKeyPayload` | `interface` | `voice:delete-profile` 线上载荷：`{ key }` |
| `VoiceCreatePayload` | `interface` | `voice:create` 载荷：`audioPath?` / `targetModel?` / `preferredName?`（`audioPath` 在 `file` 模式为本地绝对路径，在 `url` 模式为可公开访问的音频 URL） |
| `VoiceCreateResult` | `interface` | `{ voice, targetModel, fallbackMode, fallbackReason }` |
| `VoiceSynthPayload` | `interface` | `voice:synth` 载荷（由 preload 按位置参数组装）：`text?` / `voice?` / `targetModel?` / `projectName?` / `saveDir?` / `defaultOut?` / `audioName?` |
| `VoiceSynthResult` | `interface` | `{ savePath, projectName, savedTo, size }` |
| `VoiceSavedTo` | `type` | `'custom' \| 'output' \| 'project' \| 'default'`（`voice:synth` 的落盘位置） |
| `VoiceAlignMode` | `type` | `'audio-driven' \| 'timeline-driven'`（字幕配音对齐模式） |
| `VoiceAlignPayload` | `interface` | `voice:synth-aligned` 载荷：`subtitleText` / `voice` + 可选 `mode` / `gapSec` / `voiceModel` / `projectName` |
| `AlignSegStatus` | `type` | `'ok' \| 'accelerated' \| 'pushed'` |
| `VoiceAlignDetail` | `interface` | 逐句明细：`index` / `text` / `subtitleStart` / `audioStart` / `audioDur` / `status` / `rate` / `delta` / `segPath` |
| `VoiceAlignResult` | `interface` | `voice:synth-aligned` 成功分支：`mode` / `subtitleText` / `audioPath` / `totalDur` / `details` |

`VoiceModel` 的字段语义：`role` 决定用途（`clone` 用于克隆音色、`system` 用于系统音色）；`input` 仅在 `role: 'clone'` 时有意义（`url` = 粘贴可公开访问的音频 URL，`file` = 上传本地音频文件）；`group` 用于界面分组，`isDefault` 标记默认项，`series` 用于系统音色按系列取默认模型。

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
| `Project` | `interface` | `userData/projects/<项目名>/project.json` 的完整结构 |
| `SubtitleLine` | `interface` | 字幕行（`parseSubtitle` 输出）：`n` / `text` / `time` / `end`（秒，可带小数；`end` 可为 `null`） |
| `ProjectMeta` | `interface` | `project:list` 结果项（首页/步骤条的项目卡片与下拉） |
| `ProjectNamePayload` | `interface` | 仅以项目名定位的载荷 `{ name }`（`delete` / `open-folder` / `extract-video-audio` 等） |
| `ProjectSaveSubtitlePayload` | `interface` | `{ name?, subtitle?, title? }` |
| `ProjectSaveContentPayload` | `interface` | `{ name?, content? }`（`content` 为 `unknown`） |
| `ProjectSaveResult` | `interface` | `{ project: Project }`（`create` / `saveSubtitle` / `saveContent` / `saveVideo` 共用） |
| `ProjectExportSrtPayload` | `interface` | `{ name?, srt? }` |
| `ProjectDownloadResult` | `interface` | `{ savedPath }`（下载 HTML / 导出 SRT 共用） |
| `ProjectSetAudioPayload` / `ProjectSetVideoPayload` | `interface` | `{ name?, audioPath? }` / `{ name?, videoPath? }` |
| `ProjectSetAudioResult` | `interface` | `{ audioFile, htmlUpdated? }`（`setAudio` / `extractVideoAudio` 共用）；`htmlUpdated` 为「设置 / 移除背景音频时 `index.html` 的注入音轨是否被同步改写」，可选（未改写 / 主进程未上报时为 `undefined`） |
| `ProjectSetVideoResult` | `interface` | `{ videoFile, abs }` |
| `ProjectReadHtmlResult` | `interface` | `{ html }` |
| `ProjectSaveHtmlPayload` | `interface` | `{ name?, html? }` |
| `ProjectPreviewHtmlResult` | `interface` | `{ previewPath }` |
| `ProjectOpenFolderOfResult` | `interface` | `{ dir }` |
| `ProjectHtmlMaterials` | `interface` | HTML 生成/修改的素材选择：`subtitleProject?` / `videoPath?`（**`audioPath?` 已删除**：背景音频不是生成素材，由应用按 `project.audioFile` 注入 HTML 的 `<audio id="myv-bgm">`。`videoPath` 只承载「要不要带当前项目视频素材」，自定义导入的文件路径不经此载荷，走 `project:set-video`） |
| `ProjectAgentPayload` | `interface` | `extends ProjectHtmlMaterials` + `name` / `prompt`（`generateHtml` / `modifyHtml` 线上载荷） |
| `ProjectHtmlResult` | `interface` | `{ htmlPath, compatible, message? }` |
| `ProjectSetRenderPayload` | `interface` | `project:set-render` 线上载荷：`{ name?: string; render?: RenderOverride \| null }`——`render` 传 `null`（或字段全非法）表示清除项目覆盖、回到跟随全局默认 |

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `Project` | `name` / `title` / `subtitle` | `string` | 项目名、标题、字幕文本 |
| `Project` | `subtitleCount` | 可选 `number` | 字幕条数 |
| `Project` | `htmlPath` / `videoPath` | `string` | 产物路径（**绝对路径**；空串表示未生成或已失效，HTML 变更后 `videoPath` 会被置空） |
| `Project` | `videoMaterial` | 可选 `string` | 视频**素材**相对引用（`video/xxx`，与成品 `videoPath` 严格区分） |
| `Project` | `audioFile` | `string` | 背景音频 / 生成语音相对引用（`audio/xxx`，空串表示无）；也是主进程注入 HTML 音轨（`<audio id="myv-bgm">`）的唯一来源 |
| `Project` | `content` | `ContentScript` | 内容脚本 |
| `Project` | `render` | 可选 `RenderOverride` | 视频渲染档位的**项目级覆盖**（字段缺省即跟随全局默认；`render` 为空覆盖时该字段被删除） |
| `Project` | `createdAt` / `updatedAt` | `string` / 可选 `string` | 创建与更新时间（ISO 字符串） |
| `SubtitleLine` | `n` / `time` / `end` | `number` / `number` / `number \| null` | 序号、起始秒、结束秒（`null` 表示无结束时间） |
| `ProjectMeta` | `name` / `title` / `updatedAt` | `string` | 项目名、标题、更新时间 |
| `ProjectMeta` | `hasSubtitle` / `hasHtml` / `hasVideo` | `boolean` | 三类产物的文件系统存在性（主进程 `scanProjects()` 判定） |
| `ProjectMeta` | `subtitleCount` | `number` | 字幕条数 |
| `ProjectHtmlMaterials` | `subtitleProject` | 可选 `string` | `''` = 不使用；`'__current__'` = 当前项目字幕；其他 = 指定带字幕的项目名 |
| `ProjectHtmlMaterials` | `videoPath` | 可选 `string` | `''` = 不使用；`'__current__'` = 当前项目视频素材（**自定义导入走 `project:set-video`，不由本载荷传路径**；其他值一律按「不使用」处理） |
| `ProjectHtmlResult` | `compatible` | `boolean` | HTML 是否通过 HyperFrames 合规校验 |
| `ProjectHtmlResult` | `message` | 可选 `string` | **成功分支也可能带提示**：合规校验未过 / 修改后旧视频已置空等 |

两个键名与主进程 `resolveMaterials` 严格对应（`subtitleProject` / `videoPath`），`ProjectAgentPayload` 由 preload 用 `{ name, prompt, ...materials }` 展开合并而成。**背景音频不在素材里**：它由应用按 `project.audioFile` 直接注入 HTML 的 `<audio id="myv-bgm">`，提示词只声明「不要写音轨标签」，模型不需要也无法处理音轨。

### 2.7 ⑦ 预览 / HyperFrames 转视频（`video.ts`）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VideoRenderPayload` | `interface` | `extends RenderOverride`，即 `{ htmlPath?: string; quality?: RenderQuality; fps?: RenderFps }`——档位字段缺省/非法时主进程不拼对应 CLI 参数 |
| `VideoRenderResult` | `type` | 渲染结果联合：成功 `{ ok: true; outputVideo: string; projectDir: string }`，失败 `{ ok: false; message: string; compatible?: boolean }` |

> ⑦ 节只有上面两个类型：渲染载荷与渲染结果。渲染进度载荷 `VideoProgressPayload` 归 ⑧ 节（进度推送）。

`VideoRenderResult` **不是** `IpcResult<T>` 的实例：它的失败分支 `message` 必填，且成功分支不复用 `IpcFail` 联合；失败分支的 `compatible: false` 表示 HTML 未通过 HyperFrames 合规校验（渲染层据此区分「环境错误」与「HTML 不合规」）。

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
| `RuntimeProgressPayload` | `interface` | `{ stage, percent, id, message, detail?, source, bytes, unpackedBytes, files }`；频道 `runtime:progress`（运行环境包的就绪 / 下载 / 解包进度，类型定义在本文件 ③.6 节） |

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
| `appTools` | 1 | `copyText` | `Promise<boolean>`（不走 `IpcResult`） |
| `windowControls` | 4 | `minimize`、`toggleMaximize`、`close`、`onMaximizedChange` | 前三者 `void`（`send` 单向）；`onMaximizedChange(cb: (isMaximized: boolean) => void)` |
| `hfTools` | 4 | `openHtml`、`renderVideo`、`showInFolder`、`onProgress` | `openHtml` → `Promise<string \| null>`（**保留但渲染层当前无调用方**）；`renderVideo` → `Promise<VideoRenderResult>`；`showInFolder` → `Promise<void>`；`onProgress(cb: (data: VideoProgressPayload) => void)` |
| `settingsTools` | 5 | `get`、`save`、`saveRender`、`saveUpdater`、`test` | `get` → `Promise<AppSettings>`（**不经 `ok` 包裹**）；`save(customModel)` / `saveRender(render)` / `saveUpdater(updater)` → `Promise<IpcResult<SettingsSaveResult>>`（preload 分别包装为 `{ customModel }` / `{ render }` / `{ updater }`）；`test(customModel)` → `Promise<IpcResult>` |
| `voiceTools` | 18 | `getConfig`、`getSaveDir`、`saveConfig`、`pickAudio`、`pickDir`、`listGenerated`、`create`、`list`、`listSystemVoices`、`listAll`、`listModels`、`getProfiles`、`saveProfile`、`deleteProfile`、`synth`、`synthAligned`、`cancelAlign`、`onAlignProgress` | 见下 |
| `whisperTools` | 12 | `status`、`download`、`delete`、`setCurrent`、`addModel`、`updateModel`、`removeModel`、`openDir`、`pickAudio`、`projectAudio`、`transcribe`、`onProgress` | 见下 |
| `projectTools` | 25 | `list`、`create`、`load`、`saveSubtitle`、`saveContent`、`generateHtml`、`modifyHtml`、`downloadHtml`、`exportSrt`、`readHtml`、`saveHtml`、`previewHtml`、`pickAudio`、`setAudio`、`clearAudio`、`pickVideo`、`setVideo`、`clearVideo`、`extractVideoAudio`、`openFolder`、`openFolderOf`、`delete`、`saveVideo`、`setRender`、`onHtmlProgress` | 见下 |
| `updateTools` | 7 | `version`、`check`、`download`、`cancel`、`install`、`openLog`、`onProgress` | 见下 |
| `runtimeTools` | 3 | `status`、`prepare`、`onProgress` | `status()` → `Promise<RuntimeProgressPayload>`；`prepare()` → `Promise<IpcResult>`（幂等，进度仍由 `runtime:progress` 回推）；`onProgress(cb: (data: RuntimeProgressPayload) => void)`（单订阅） |
| `legacyTools` | 2 | `status`、`resolve` | `status()` → `Promise<LegacyDataInfo \| null>`；`resolve(action: LegacyResolveAction)` → `Promise<LegacyResolveResult>`（preload 只把 `action` 字符串透传，见 §2.3.3） |

`voiceTools` 逐个签名（含未单独命名的内联载荷）：

| 方法 | 签名要点 |
| --- | --- |
| `getConfig()` | `Promise<IpcResult<VoiceConfigResult>>` |
| `getSaveDir(payload: VoiceSaveDirPayload)` | `Promise<IpcResult<VoiceSaveDirResult>>` |
| `saveConfig(voiceTTS: Partial<VoiceTTSConfig>)` | `Promise<IpcResult<SettingsSaveResult>>` |
| `pickAudio()` | `Promise<string \| null>` |
| `pickDir()` | `Promise<IpcResult<{ dir: string }>>`（取消时为 `{ ok: false, canceled: true }`） |
| `listGenerated()` | `Promise<IpcResult<{ items: GeneratedAudioItem[]; total: number }>>` |
| `create(audioPath: string, preferredName: string, targetModel: string)` | `Promise<IpcResult<VoiceCreateResult>>`（3 个位置参数，preload 组装成 `{ audioPath, preferredName, targetModel }`） |
| `list()` | `Promise<IpcResult<{ voices: ClonedVoice[]; total: number }>>` |
| `listSystemVoices()` | `Promise<IpcResult<{ voices: SystemVoiceItem[]; total: number }>>` |
| `listAll()` | `Promise<IpcResult<{ voices: VoiceListItem[]; total: number; cloudMessage: string }>>` |
| `listModels()` | `Promise<IpcResult<{ models: VoiceModel[] }>>` |
| `getProfiles()` | `Promise<IpcResult<VoiceProfilesResult>>` |
| `saveProfile(profile: VoiceProfileInput)` | `Promise<IpcResult<VoiceProfilesResult>>`（线上载荷为 `{ profile }`） |
| `deleteProfile(key: string)` | `Promise<IpcResult<VoiceProfilesResult>>`（线上载荷为 `{ key }`） |
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
| `openLog()` | `Promise<IpcResult<{ path: string }>>`（在文件管理器里定位 `userData/updater.log`，没有日志则打开 `userData` 目录；**不依赖 electron-updater 是否加载成功**） |
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
| `projectTools` | `create` / `saveSubtitle` / `saveContent` / `saveVideo` / `setRender` | `Promise<IpcResult<ProjectSaveResult>>`（`setRender(name, render \| null)` 传 `null` 即清除项目级渲染档位覆盖） |
| `projectTools` | `load(name)` | `Promise<Project \| null>`（**不走 `IpcResult`**；项目名为空时主进程返回 `null`，见 §5） |
| `projectTools` | `generateHtml` / `modifyHtml(name, prompt, materials?: ProjectHtmlMaterials)` | `Promise<IpcResult<ProjectHtmlResult>>` |
| `projectTools` | `downloadHtml` / `exportSrt` | `Promise<IpcResult<ProjectDownloadResult>>` |
| `projectTools` | `readHtml` / `saveHtml` / `previewHtml` | `IpcResult<ProjectReadHtmlResult>` / `IpcResult<ProjectHtmlResult>` / `IpcResult<ProjectPreviewHtmlResult>` |
| `projectTools` | `pickAudio()` / `pickVideo()` | `Promise<string \| null>` |
| `projectTools` | `setAudio` / `extractVideoAudio` / `setVideo` | `IpcResult<ProjectSetAudioResult>`（含可选 `htmlUpdated`，表示注入音轨改写了 `index.html`） / `IpcResult<ProjectSetAudioResult>` / `IpcResult<ProjectSetVideoResult>` |
| `projectTools` | `clearAudio` / `clearVideo` / `openFolder` / `delete` | `Promise<IpcResult>`（无载荷）；主进程 `project:clear-audio` 实际上还返回 `htmlUpdated`（是否摘掉了 HTML 里的注入音轨），但**未纳入本契约**，渲染层不使用该字段 |
| `projectTools` | `openFolderOf(dirOrFile)` | `Promise<IpcResult<ProjectOpenFolderOfResult>>` |
| `projectTools` | `onHtmlProgress(cb)` | `void`，回调 `(data: HtmlProgressPayload) => void`（单订阅） |

## 3. 关键流程或结构

### 3.1 三端共享路径

```
                        src/shared/types.ts
      ┌──────────────────────┬────────────────────────┬─────────────────────┐
      ▼                      ▼                        ▼                     ▼
  src/main/*             src/preload/index.ts    src/preload/index.d.ts   渲染层
  (10 个模块 import 类型)   (导入 PreloadApi + 3 个进度载荷)  (导入 PreloadApi)   （经 Window 间接获得）
```

`tsconfig.web.json` 的 `include` 含 `"src/shared/**/*.ts"` 与 `"src/preload/index.d.ts"`；`tsconfig.node.json` 覆盖主进程与 `src/preload/index.ts`；`npm run typecheck` 依次跑 `tsconfig.node.json`、`tsconfig.web.json`、`tsconfig.agent.json`，因此本文件的任何字段改动会同时触发三端编译报错定位。

### 3.2 设置数据的读写闭环

1. `AppSettings` 是 `userData/settings.json` 的完整镜像；主进程 `settings.ts` 负责读写与合并，`whisper` 分区由 `WhisperSettings` 描述。
2. 渲染层通过 `window.settingsTools.get()` 取到 `AppSettings`，通过 `window.settingsTools.save(customModel)` 提交 `CustomModelConfig`，通过 `window.voiceTools.saveConfig(Partial<VoiceTTSConfig>)` 提交部分语音配置；两者的成功分支都是 `IpcResult<SettingsSaveResult>`，由 `voice:save-config` / `settings:save` 回带 `settings`。
3. 音色映射以 `Record<string, VoiceProfile>` 存储，`voiceTools.saveProfile(profile)` / `deleteProfile(key)` 按 key 增删，入参用 `VoiceProfileInput`（`name` / `type` 可缺省），线上载荷分别是 `VoiceProfilePayload` / `VoiceProfileKeyPayload`。
4. whisper 分区即以 `WhisperSettings` 落盘，`whisperTools.addModel/updateModel/removeModel` 对应 `customModels` 数组的增删改，载荷为 `WhisperAddModelPayload` / `WhisperUpdateModelPayload` / `WhisperIdPayload`。

### 3.3 主进程 register 模式

```ts
// src/main/*.ts 的统一签名（示意）
export function register(ctx: RegisterCtx): void { /* 用 ctx.getWindow() 拿窗口发消息 */ }
```

`RegisterCtx` 用 `getWindow: () => BrowserWindow | null` 而非 `window: BrowserWindow`，使各功能模块在窗口尚未创建时也能安全加载；每个推送型频道（`whisper:progress` 等）发送前都需对 `null` 做判空。

### 3.4 `PreloadApi` 契约如何生效

1. `src/preload/index.ts` 的 11 个 `contextBridge` 对象分别标注为 `PreloadApi['electronAPI']`、`PreloadApi['hfTools']` … —— 方法名、参数顺序、返回类型写错会在 `tsconfig.node.json` 阶段直接编译失败（实现被契约校验）。
2. `src/preload/index.d.ts` 只有 `import type { PreloadApi } from '../shared/types'` + `declare global { interface Window extends PreloadApi {} }`，不再自己定义任何类型；渲染层看到的 `window.*` 与 preload 实现同源。
3. 因此「改契约」变成**只改本文件 ⑨ 节**这一件事：两端同时生效。⑨ 节注释同时指明命名空间与 IPC 频道的对应关系见 `src/shared/ipc.ts`（11 个命名空间 ↔ 10 组频道常量）。

### 3.5 `IpcResult` 的判别联合与收窄

1. 调用方 `const res = await window.projectTools.generateHtml(name, prompt)`。
2. 判 `if (res.ok)` → TS 收窄到 `{ ok: true } & ProjectHtmlResult`，可平铺访问 `res.htmlPath` / `res.compatible` / `res.message`（业务字段直接平铺，没有 `data` 包装）。
3. 判 `else` → 收窄到 `IpcFail`，可安全读取 `res.message`（以及排障用的 `res.detail`），并按 `res.canceled` 区分「用户取消」与「真实失败」。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖（仅类型） | `electron` | 仅引入 `BrowserWindow` 类型 |
| 被 import | `src/main/settings.ts` | `AppSettings`、`CustomModelConfig`、`RegisterCtx`、`VoiceProfile`、`VoiceTTSConfig`、`WhisperCustomModel` |
| 被 import（+ 再导出） | `src/main/projects.ts` | `RegisterCtx`、`ProjectAgentPayload`、`ProjectExportSrtPayload`、`ProjectNamePayload`、`ProjectSaveContentPayload`、`ProjectSaveHtmlPayload`、`ProjectSaveSubtitlePayload`、`ProjectSetAudioPayload`、`ProjectSetVideoPayload`；并 `export type { ContentScript, Project, Scene, SubtitleLine }` 再导出四个项目结构 |
| 被 import | `src/main/index.ts` | `RegisterCtx`、`LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`（后三者服务于 `legacy:status` / `legacy:resolve`） |
| 被 import | `src/main/whisper.ts` | `RegisterCtx`、`WhisperCustomModel` 与全部 `Whisper*Payload`（含 `WhisperProgressPayload`） |
| 被 import | `src/main/voice.ts` | `RegisterCtx`、`SystemVoice`、`VoiceModel`、`VoiceProfile`、`VoiceTTSConfig`、`VoiceCreatePayload`、`VoiceProfileKeyPayload`、`VoiceProfilePayload`、`VoiceSaveConfigPayload`、`VoiceSaveDirPayload`、`VoiceSynthPayload` |
| 被 import | `src/main/ttsAlign.ts` | `RegisterCtx`、`AlignProgressPayload`（取代原本地 `AlignProgressInfo`）、`VoiceAlignPayload` |
| 被 import | `src/main/video.ts` | `RegisterCtx`、`VideoRenderPayload`、`VideoRenderResult`（取代原本地声明的 `RenderPayload` / `RenderResult`） |
| 被 import | `src/main/runtime.ts` | `RegisterCtx`、`RuntimeProgressPayload`（③.6 节；`RuntimeStage` 由该接口的 `stage` 字段内联引用） |
| 被 import | `src/main/htmlAgent.ts` | `HtmlAgentProgress`（以 `export type AgentProgress = HtmlAgentProgress` 对外保留 `AgentProgress` 名） |
| 被 import | `src/main/systemVoices.ts` | `SystemVoice` |
| 被 import（仅类型） | `src/preload/index.ts` | `PreloadApi`、`AlignProgressPayload`、`HtmlProgressPayload`、`WhisperProgressPayload` |
| 被 import（仅类型） | `src/preload/index.d.ts` | `PreloadApi`，供 `declare global Window` 使用 |
| 被 import（仅类型） | `src/renderer/src/composables/useAppStore.ts` | `ProjectMeta`（并 `export type { ProjectMeta }` 再导出，取代原本地同名 interface） |

## 5. 注意事项与实现要点

- **字段名禁止改动**：注释写明「载荷格式必须与现行实现逐字段一致，禁止改动结构」。设置文件已在用户 `userData` 中落盘，改字段名等于丢失既有配置；项目结构改动还会打断 `project.json` 的向后兼容。
- **新增 / 修改 IPC 须三处齐改**：主进程 `register()` 回调、本文件类型、preload 桥接方法；若签名发生变化，`PreloadApi`（⑨ 节）必须同步，否则 preload 侧直接编译不过。
- **`IpcFail.message` 是可选字段**：`voice:pick-dir` 的用户取消分支只回 `{ ok: false, canceled: true }`，因此读取 `message` 的代码要容忍 `undefined`（渲染层约定式写法 `(res as { message?: string })?.message || '默认文案'`）。
- **`IpcFail.detail` 是「可选的技术详情」**（2026-10 新增）：与 `message` 分工明确 —— `message` 说人话（用户能做什么）、`detail` 给排障（原始报错 / HTTP 状态 / 请求 URL），UI 用「查看详情」折叠展示。它同样是可选的，取消分支与部分简单失败分支不带它。
- **`UpdateCheckResult.message` 是必填、`IpcFail.message` 是可选的**：前者由主进程**单点产出**（`available` / `skipped` / `none` 三种状态文案都在 `updater.ts` 的 `bindEvents()` 里写），渲染层只渲染不再拼串——早前渲染层也拼一套，与事件推送的文案互相覆盖；后者必须保持可选以兼容 `voice:pick-dir` 的取消分支。两者的 `detail` 都只在 UI「查看详情」里展开。
- **`VoiceSavedTo` 与 `VoiceSaveDirMode` 取值集合相同但字段名不同**：前者是 `voice:synth` 结果里的 `savedTo`，后者是 `voice:get-save-dir` 结果里的 `mode`；源码注释明确「现行实现如此，勿『统一化』」。
- **`VoiceProfile.type` 是字面量联合**：类型为 `VoiceProfileType`（`'system' | 'custom'`），不再是宽泛 `string`；但线上保存分支的 `VoiceProfilePayload.profile.type` 仍是 `type?: string`（主进程按「非 `system` 一律归 `custom`」归一），两者不要混用。
- **`AppSettings.whisper` 有独立 interface**：即 `WhisperSettings`，需要复用该分区时直接引用，不要重复内联声明。
- **`SystemVoice` 与 `SystemVoiceItem` 的分工**：`SystemVoice` 是内置音色表的 4 字段条目（由 `src/main/systemVoices.ts` 提供）；`voice:list-system-voices` 下发的元素是 `SystemVoiceItem`（多一个 `model` 字段）。历史上 `index.d.ts` 的元素类型与共享 `SystemVoice` 不同步的问题，已由这两个类型显式区分解决。
- **`VideoRenderResult` 不是 `IpcResult`**：失败分支 `message` 必填、成功分支带 `outputVideo` / `projectDir`，且失败可带 `compatible?: boolean`；文档与代码不要一律按 `IpcResult` 处理。
- **少数 API 不走 `ok` 包裹**：`settingsTools.get()` → `AppSettings`、`projectTools.list()` → 数组、`projectTools.load()` → `Project | null`、`hfTools.openHtml` / `pickAudio` / `pickVideo` → `string | null`、`appTools.copyText` → `boolean`、`updateTools.version()` → `string`（同步）。其中 `projectTools.load()` 在项目名为空时**确实返回 `null`**，调用方必须做空值守卫（`useAppStore.refreshProject` 已据此加守卫）。
- **`RegisterCtx.getWindow` 可为 `null`**：所有 `webContents.send` 前必须判空，否则窗口关闭或重载期间会抛异常。
- **结构类型靠「再导出」保引用面**：`src/main/projects.ts` 的 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'`、`src/renderer/src/composables/useAppStore.ts` 的 `export type { ProjectMeta }` 都只是转发 —— `projects.Project`、`from './projects'`、`import { ProjectMeta } from '@renderer/composables/useAppStore'` 这类既有引用不需要改动，但结构本身只在本文档定义一处。新增字段时改这里即可，不要在被再导出的文件里重建 interface。
- **主进程 handler 的 `payload` 参数一律标注契约类型**：如 `ProjectSaveSubtitlePayload`、`ProjectAgentPayload`、`Partial<WhisperIdPayload>`、`VoiceSaveConfigPayload | Partial<VoiceTTSConfig>`、`VoiceAlignPayload`；因此字段名改动会在主进程侧直接编译报错，而不是等运行时才发现。
- **并非所有导出名都会出现在 import 语句里**：文件内类型相互引用（如 `IpcResult` 被 `PreloadApi` 的多个成员使用、`SystemVoiceItem extends SystemVoice`），另有一批 `*Result` / `*Payload` 类型只用于描述 handler 的返回结构与线上载荷形状（其中一部分被 `PreloadApi` 的返回类型内联引用）；这不代表它们是死代码，删除前需确认契约文档的完整性。
- **纯类型文件**：编译后不产出 JS；不要在此文件写常量或函数（常量请放 `src/shared/ipc.ts`）。
