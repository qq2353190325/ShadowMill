# src/main/voice.ts

> 千问音色管理 + 文字生音频：voice:* 全部 IPC 与合成落盘。

- **所在目录**：src/main/
- **类型**：主进程业务模块（Qwen-TTS：音色管理 + 文字生音频）
- **规模**：533 行
- **对外导出**：`synthOne`、`register`、`isAudioTtsModel`、`getVoiceApiError`、`parseJsonLike`、`voiceFriendlyError`、`nowStamp`、`guessAudioExt`、`resolveTtsDir`、`resolveVoiceModel`、`fetchClonedVoices`

## 1. 作用与职责

本模块把阿里云百炼（DashScope）的**两套**语音 HTTP 方案统一在一个门面里：Qwen-TTS 系列（`qwen3-tts-vc-*`、`qwen3-tts-*`、`qwen-tts`）与 Qwen-Audio-TTS 系列（`qwen-audio-*-tts`，如 `qwen-audio-3.0-tts-flash`）。

职责范围：

| 职责 | 关键实现 |
|------|----------|
| 语音配置读写（API Key / 默认模型 / 保存目录） | `IPC.Voice.GetConfig` / `SaveConfig`，底层走 `settings` |
| 克隆音色创建，按模型系列路由到 URL 或文件两种输入 | `IPC.Voice.Create` |
| 云端克隆音色列表查询（`action=list`） | `fetchClonedVoices` |
| 系统音色 / 候选模型 / 合并音色列表下发 | `ListSystemVoices` / `ListModels` / `ListAll` |
| 本地音色映射（音色→合成模型）增删查 | `GetProfiles` / `SaveProfile` / `DeleteProfile` |
| 文字合成并落盘到三选一目录，必要时回写 `project.json` | `synthOne` + `IPC.Voice.Synth` |
| 已生成音频枚举（供渲染层复用为背景音频） | `IPC.Voice.ListGenerated` |
| 文件/目录选择对话框 | `PickAudio` / `PickDir` |

本文件**不做**字幕逐句对齐与时间对齐（属 `ttsAlign.ts`），也不直接操作 HyperFrames 项目结构（仅写 `project.json` 的 `ttsAudio` 字段）。

常量表：

| 常量 | 值 | 说明 |
|------|-----|------|
| `VOICE_API_BASE` | `https://dashscope.aliyuncs.com/api/v1` | 所有请求的基础地址 |
| `VOICE_ENROLL_MODEL` | `qwen-voice-enrollment` | Qwen-TTS 系列克隆模型（源码注明「请勿修改」） |
| `VOICE_ENROLL_MODEL_AUDIO` | `voice-enrollment` | Qwen-Audio-TTS 系列克隆模型 |
| `VOICE_MODELS` | 7 条 `VoiceModel` | 候选模型表，角色 `clone` / `system`，含 `input`（`url` / `file`）与 `group`；`VoiceModel` 及其 `VoiceModelRole` / `VoiceModelInput` 定义在 `src/shared/types.ts` ④ 节（本文件不再自行声明） |
| `SYSTEM_SERIES_MODEL` | `instruct-flash` / `flash` / `tts` → 三个模型 id | 系统音色按系列取默认合成模型 |
| `VOICE_TTS_MODELS` | `VOICE_MODELS.map(m => m.id)` | 模型白名单，用于配置校验 |
| `VOICE_MIME` | `.wav`→`audio/wav`、`.mp3`→`audio/mpeg`、`.m4a`→`audio/mp4`、`.mp4`→`audio/mp4` | Base64 data URI 的 MIME 映射 |

候选模型表（`VOICE_MODELS`）逐条：

| id | label | role | input | isDefault |
|----|-------|------|-------|-----------|
| `qwen-audio-3.0-tts-flash` | `qwen-audio-3.0-tts-flash` | `clone` | `url` | `true` |
| `qwen3-tts-vc-2026-01-22` | `qwen3-tts-vc-2026-01-22（非实时）` | `clone` | `file` | — |
| `qwen3-tts-vc-realtime-2026-01-15` | `qwen3-tts-vc-realtime-2026-01-15（实时）` | `clone` | `file` | — |
| `qwen3-tts-vc-realtime-2025-11-27` | `qwen3-tts-vc-realtime-2025-11-27（实时）` | `clone` | `file` | — |
| `qwen3-tts-instruct-flash` | `千问3-TTS-Instruct-Flash` | `system` | — | — |
| `qwen3-tts-flash` | `千问3-TTS-Flash` | `system` | — | — |
| `qwen-tts` | `千问-TTS` | `system` | — | — |

## 2. 内部实现函数

| 名称 | 说明 |
|------|------|
| `isAudioTtsModel(model)` | 判定是否 Qwen-Audio-TTS 系列；正则 `/^qwen-audio-.*-tts/i` 作用于 `String(model \|\| '')` |
| `getVoiceConfig()` | 转发 `settings.getVoiceConfig()`，返回 `VoiceTTSConfig`（`apiKey` / `targetModel` / `saveDir`） |
| `getVoiceApiError(cfg)` | `cfg.apiKey` 为空时返回提示「未配置千问语音 API Key，请先到「设置」-「千问语音」填写」，否则 `null` |
| `parseJsonLike(text)` | `JSON.parse` 的容错包装，解析失败静默返回 `null` |
| `voiceFriendlyError(err, label)` | 取 `err.message`（无则 `String(err)`）；`InvalidApiKey/unauthorized/Unauthorized/401/403` → 「API Key 无效或无权限，请检查后重试」；`quota/ExceededQuota/Insufficient` → 前缀「额度不足或已被限流：」；最终返回 `label + '：' + msg` |
| `nowStamp()` | 本地时间戳 `YYYYMMDD_HHmmss`（各段 `padStart(2,'0')`） |
| `guessAudioExt(url)` | 去 query → 取末段并 `decodeURIComponent` → 匹配 `wav/mp3/m4a/mp4/aac/ogg/flac`，命中返回小写扩展名，否则 `'wav'` |
| `resolveTtsDir(projectName, saveDir)` | 落盘目录解析，优先级：`saveDir` → `projects.projectsRoot/<projectName>/audio` → `scanProjects()[0].name` 的 `audio/` → `app.getPath('userData')/tts-output` |
| `systemVoiceDefaultModel(v)` | 按 `series` 数组优先级取默认模型：`instruct-flash` > `flash` > `tts`；不命中回落字面量 `'qwen3-tts-flash'` |
| `resolveVoiceModel(voiceKey, _ctx)` | 「音色→模型」三级统一解析（见 4.3） |
| `fetchClonedVoices()` | 查询云端克隆音色列表（见 4.2），返回 `{ ok, voices?, total?, message? }` |
| `synthOne(text, voice, useModel)` | 单次合成**不落盘**，返回 `{ buf, ext }`（见 4.4）；被 `voice:synth` 与 `ttsAlign.ts` 复用 |
| `register(ctx?)` | 注册全部 `voice:*` IPC handler；`getWindow` 取自 `ctx.getWindow`，缺省 `() => null` |

## 3. IPC 频道一览

`register()` 共注册 15 个频道（下表全量覆盖）。`voice:synth-aligned` / `voice:align-cancel` / `voice:align-progress` 定义在 `IPC.Voice` 中，但由 `ttsAlign.ts` 注册，**不在本文件**。

handler 的载荷类型全部取自 `src/shared/types.ts` ④ 节（本文件**不再自行声明任何 payload / result 接口**，`VoiceModel` 也已上移共享层）：`get-save-dir` → `VoiceSaveDirPayload`，`save-config` → `VoiceSaveConfigPayload | Partial<VoiceTTSConfig>`（兼容两种线上形态），`create` → `VoiceCreatePayload`，`save-profile` → `VoiceProfilePayload`，`delete-profile` → `VoiceProfileKeyPayload`，`synth` → `VoiceSynthPayload`。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
|--------|----------|----------|----------|
| `voice:get-config` | 无 | `{ ok:true, apiKey, targetModel, saveDir }` | 读取当前语音配置，`saveDir` 统一 `String(... \|\| '')` |
| `voice:get-save-dir` | `VoiceSaveDirPayload`（`{ saveDir?, defaultOut?, projectName? }`） | `{ ok:true, mode, saveDir }` | 解析并 `mkdirSync(recursive)` 目标目录（失败静默）；`mode` 为 `output` / `custom` / `project` / `default`（类型 `VoiceSaveDirMode`） |
| `voice:save-config` | `VoiceSaveConfigPayload \| Partial<VoiceTTSConfig>`（`{ voiceTTS?: Partial<VoiceTTSConfig> }` 或直接 `Partial<VoiceTTSConfig>`） | `{ ok:true, settings }` | 与既有配置逐字段合并后写盘；`targetModel` 不在白名单则回落 `qwen-audio-3.0-tts-flash`；`apiKey`/`saveDir` 走 `trim()` |
| `voice:pick-audio` | 无 | 文件绝对路径 或 `null` | 打开音频文件选择框（`mp3/wav/m4a/mp4`，title 提示推荐 10~20 秒清晰人声）；无窗口或取消返回 `null` |
| `voice:create` | `VoiceCreatePayload`（`{ audioPath?, targetModel?, preferredName? }`） | `{ ok:true, voice, targetModel, fallbackMode, fallbackReason }` 或 `{ ok:false, message }` | 创建克隆音色，按模型系列三路分支（见 4.1） |
| `voice:list-system-voices` | 无 | `{ ok:true, voices, total }` | 内置系统音色列表，每项附 `voice/desc/langs/series/model`，`model` 优先取本地映射 |
| `voice:list-models` | 无 | `{ ok:true, models }` | 直接下发 `VOICE_MODELS` |
| `voice:get-profiles` | 无 | `{ ok:true, profiles }` | 读 `settings.voiceProfiles` |
| `voice:save-profile` | `VoiceProfilePayload`（`{ profile: Partial<VoiceProfile> & { type?: string } }`） | `{ ok:true, profiles }` 或 `{ ok:false, message:'映射信息不完整' }` | `key`/`voice`/`targetModel` 必填；模型走白名单；`type` 非 `system` 一律存为 `custom` |
| `voice:delete-profile` | `VoiceProfileKeyPayload`（`{ key }`） | `{ ok:true, profiles }` 或 `{ ok:false, message:'缺少映射 key' }` | 删除本地音色映射 |
| `voice:list` | 无 | `{ ok, voices?, total?, message? }` | 等价于 `fetchClonedVoices()` |
| `voice:list-all` | 无 | `{ ok:true, voices, total, cloudMessage }` | 系统音色 + 克隆音色合并，统一 `{ key, type, name, voiceId, model }`；云端失败时 `cloudMessage` 携带原因 |
| `voice:pick-dir` | 无 | `{ ok:true, dir }` 或 `{ ok:false, canceled:true }` | 目录选择框（`openDirectory` + `createDirectory`） |
| `voice:list-generated` | 无 | `{ ok:true, items, total }` | 扫描三类目录下的音频文件，`items` 元素为 `{ path, name, group, size, mtime }` |
| `voice:synth` | `VoiceSynthPayload`（`{ text?, voice?, targetModel?, projectName?, saveDir?, defaultOut?, audioName? }`） | `{ ok:true, savePath, projectName, savedTo, size }` 或 `{ ok:false, message }` | 合成并落盘（见 4.4 / 4.5） |

## 4. 关键流程

### 4.1 克隆音色（`voice:create`）

1. 取 `cfg = getVoiceConfig()`，`getVoiceApiError` 命中则直接返回 `{ ok:false, message }`。
2. `useModel = payload.targetModel.trim() || cfg.targetModel`；`isAudio = isAudioTtsModel(useModel)`。
3. **输入方式按目标模型切换**：`isAudioUrl = isAudio && /^https?:\/\//i.test(audioPath)`。
   - Qwen-Audio-TTS（`input: 'url'`，如 `qwen-audio-3.0-tts-flash`）：音频位置填**可公开访问的音频 URL**，跳过本地文件校验。
   - 其余（`input: 'file'`，如 `qwen3-tts-vc-*`）：必须 `fs.existsSync(audioPath)`，否则返回「音频文件不存在：…」。
4. `preferredName` 先净化 `[^a-zA-Z0-9_]`；为空或长度 > 16 时返回「音色名称需 1~16 个字符，仅限数字、字母、下划线」。
5. 非 URL 模式：按扩展名查 `VOICE_MIME`，未命中返回「不支持的音频格式，请使用 wav / mp3 / m4a」；读文件转 Base64，`Buffer.byteLength(b64,'utf8') > 10 * 1024 * 1024` 时返回「音频过大：Base64 编码后需小于 10 MB（约对应原文件 7.5 MB）…」，否则拼成 `data:<mime>;base64,<b64>`。
6. 按系列组装 `input` 并 POST `/services/audio/tts/customization`：

| 分支 | 外层 `model` | `input` 关键字段 |
|------|--------------|------------------|
| Qwen-Audio-TTS + URL | `voice-enrollment` | `action:'create_voice'`、`target_model`、`prefix`、`audio.url` |
| Qwen-Audio-TTS + 本地文件 | `voice-enrollment` | `action:'create_voice'`、`target_model`、`prefix`、`audio.data`（base64 可能不被接受） |
| Qwen-TTS（`qwen3-tts-vc-*`） | `qwen-voice-enrollment` | `action:'create'`、`target_model`、`preferred_name`、`audio.data` |

7. **失败回退 fallbackMode / fallbackReason**：HTTP 非 2xx 时，若 `isAudio` 且 `code + message` 命中 `/audio/i` **并且** 原始响应体命中 `/url|address|link|preprocess|data/i`，返回专用提示——创建失败附「请改用可公开访问的音频 URL 提交（本接口对 Qwen-Audio-TTS 使用 audio.data 直传可能不被支持）」；其它错误抛错后由 `voiceFriendlyError(e, '创建音色失败')` 包装。
8. 成功分支：音色 ID 取 `out.voice || out.voice_id`（两系列字段名不同），缺失则抛「接口未返回音色 ID（voice / voice_id）」；返回 `targetModel = out.target_model || cfg.targetModel`、`fallbackMode = !!out.fallback_mode`、`fallbackReason = out.fallback_reason || ''`，渲染层以「（降级模式：…）」提示。

### 4.2 查询云端音色列表（`fetchClonedVoices`）

1. 无 API Key 直接返回 `{ ok:false, message }`。
2. POST `VOICE_API_BASE + '/services/audio/tts/customization'`，header 带 `Content-Type: application/json` 与 `Authorization: Bearer <apiKey>`。
3. body：`{ model: 'qwen-voice-enrollment', input: { action: 'list', page_size: 100, page_index: 0 } }`。
4. HTTP 非 2xx 抛 `HTTP <status>：<message>`；成功取 `json.output.voice_list`（非数组则为 `[]`）与 `output.total || list.length`。
5. 异常统一 `voiceFriendlyError(e, '查询音色失败')` 包装，不向渲染层抛异常。

### 4.3 本地音色映射与「音色→模型」解析

- 映射键 `voiceProfiles` 形如 `system:X`（如 `system:Cherry`）或 `custom:X`（如 `custom:<voice_id>`），值为 `{ key, name, voice, targetModel, type }`。
- `resolveVoiceModel(voiceKey)` 三级解析：
  1. `profiles[key] || profiles[bare]`（`bare` 去掉 `system:` / `custom:` 前缀）命中且含 `targetModel` → 直接使用；
  2. `isSystemVoice(bare)` → `SYSTEM_VOICES.find(v => v.voice === bare)` 后取 `systemVoiceDefaultModel(v)`（`instruct-flash` > `flash` > `tts`）；
  3. 兜底 `getVoiceConfig().targetModel`。
- `voice:list-all` 中克隆音色另有三级回退：本地映射 `targetModel` → 云端 `v.target_model || v.targetModel` → `resolveVoiceModel(key, ctx)`；`voiceId` 取 `v.voice || v.voice_id`，为空则跳过该条。
- `voice:list-system-voices` 的 `model` 字段同样优先读 `profiles['system:' + v.voice].targetModel`。

### 4.4 TTS 合成落盘（`synthOne` → 目录 → 文件名 → 回执）

1. 校验：无 API Key、`text` 为空（「合成文本为空」）、`voice` 为空（「请先选择（或创建）音色」）分别提前返回。
2. `useModel = payload.targetModel.trim() || cfg.targetModel`，保证与克隆创建时的 `target_model` 一致。
3. `synthOne` 按系列分流：
   - Qwen-Audio-TTS：POST `/services/audio/tts/SpeechSynthesizer`，body `{ model, input: { text, voice, format:'mp3', sample_rate: 24000 } }`，响应体**直接是音频流**，`Buffer.from(await resp.arrayBuffer())`，`ext = 'mp3'`；非 2xx 时拼 `[code] message` 抛出。
   - Qwen-TTS：POST `/services/aigc/multimodal-generation/generation`，body `{ model, input: { text, voice } }`，取 `json.output.audio.url` 二次下载；无 URL 抛「接口未返回音频地址（output.audio.url）」，下载非 2xx 抛「下载音频失败：HTTP <status>」，扩展名用 `guessAudioExt(audioUrl)`。
4. **保存位置三选一**（渲染层显式传入，不再回落持久化 `saveDir`，避免「保存到项目」被静默忽略）：

| 优先级 | 条件 | 落盘目录 | `savedTo` |
|--------|------|----------|-----------|
| 1 | `saveDir` 非空 | `resolveTtsDir('', saveDir)` → 即该自定义目录 | `'custom'` |
| 2 | `defaultOut` 为真 | `app.getPath('userData')/tts-output` | `'output'` |
| 3 | 其余 | `resolveTtsDir(projectName, '')` → 项目 `audio/`（无项目则最近项目 `audio/`，均无则 `tts-output`） | `'default'` / `'project'` |

5. `fs.mkdirSync(destDir, { recursive: true })`；文件名基底优先用 `audioName`（过滤 `[\\/:*?"<>|]` 并折叠连续空白），否则 `nowStamp() + '_' + Array.from(text).slice(0,5).join('') + '_' + voice尾12位`（`voice` 净化后取 `.slice(-12)`，为空则为 `voice`；前五字净化后为空则为 `tts`）；最终 `base + '.' + ext`。
6. `fs.writeFileSync(savePath, buf)`。
7. 落盘回执：仅当**既无 `saveDir` 也无 `defaultOut` 且有 `projectName`** 时才判定为项目保存——读项目 `project.json`，写 `proj.ttsAudio = path.join('audio', path.basename(savePath))` 并以 `JSON.stringify(proj, null, 2)` / `utf8` 回写（异常不阻断主流程），`savedTo = 'project'`，返回 `projectName`。既无 `saveDir`/`defaultOut` 又无 `projectName` 时 `scanProjects()` 取首个项目名，否则 `savedTo = 'output'`。
8. 返回 `{ ok:true, savePath, projectName, savedTo, size: buf.length }`；异常统一 `voiceFriendlyError(e, '合成语音失败')`。

### 4.5 已生成音频列表（`voice:list-generated`）

1. 正则 `AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg|flac|mp4)$/i`，`seen: Set<string>` 按绝对路径去重。
2. 依次扫描三处并打分组名：

| 顺序 | 目录 | group |
|------|------|-------|
| 1 | `userData/tts-output` | `音频输出目录` |
| 2 | `cfg.saveDir`（非空时） | `自定义目录` |
| 3 | `projectsRoot/<每个顶层目录>/audio` | `项目 · <项目名>` |

3. `pushDir` 内部：目录不存在或 `readdirSync` 抛错则跳过；仅收正则命中的名字，`statSync` 失败或非普通文件跳过；条目为 `{ path, name, group, size, mtime }`。
4. 结果按 `mtime` 降序，返回 `{ ok:true, items, total }`。

### 4.6 错误友好化

`voiceFriendlyError` 是统一的出口包装：识别鉴权类（`InvalidApiKey` / `unauthorized` / `Unauthorized` / `401` / `403`）替换为固定文案，识别额度类（`quota` / `ExceededQuota` / `Insufficient`）加「额度不足或已被限流：」前缀，其余保留原始 message，最终统一加 `<label>：` 前缀（label 取值：`创建音色失败` / `合成语音失败` / `查询音色失败`）。

## 5. 依赖与协作

| 依赖 | 用途 |
|------|------|
| `electron` 的 `app` / `ipcMain` / `dialog` | 注册 handler、取 `userData` 路径、文件与目录选择框 |
| `node:path` / `node:fs` | 路径拼接、目录与文件读写、`existsSync` / `statSync` / `readdirSync` |
| `./settings` | `getVoiceConfig` / `getVoiceProfiles` / `saveVoiceProfile` / `deleteVoiceProfile` / `readSettings` / `writeSettings` |
| `./projects` | `projectsRoot` 与 `scanProjects()`，用于项目 `audio/` 定位与列表扫描 |
| `./systemVoices` | `SYSTEM_VOICES`（内置系统音色）与 `isSystemVoice` |
| `../shared/ipc` | `IPC.Voice.*` 频道常量 |
| `../shared/types` | 类型 `RegisterCtx` / `SystemVoice` / `VoiceModel` / `VoiceProfile` / `VoiceTTSConfig`，以及载荷类型 `VoiceCreatePayload` / `VoiceProfileKeyPayload` / `VoiceProfilePayload` / `VoiceSaveConfigPayload` / `VoiceSaveDirPayload` / `VoiceSynthPayload`；`VoiceModel` 与全部载荷类型先前在本文件本地声明，现已上移共享层（同时供各 handler 的 `payload` 标注） |

被调用方：

- `src/main/index.ts:150` 执行 `voice.register(ctx)`（主进程装配，依赖图 `settings ← htmlAgent ← projects ← voice ← ttsAlign`）。
- `src/main/ttsAlign.ts` 导入 `synthOne` / `resolveVoiceModel` / `voiceFriendlyError`，用于 `voice:synth-aligned` 逐句合成。
- `src/preload/index.ts` 暴露 `window.voiceTools`（`getConfig` / `getSaveDir` / `saveConfig` / `pickAudio` / `pickDir` / `listGenerated` / `create` / `list` / `listSystemVoices` / `listAll` / `listModels` / `getProfiles` / `saveProfile` / `deleteProfile` / `synth`）。
- 渲染层：`src/renderer/src/pages/TextTtsPage/VoiceSection.vue`（克隆音色、映射管理；原独立页 `SoundCopyPage/index.vue` 已并入配音页第三个 Tab）、`src/renderer/src/pages/TextTtsPage/SynthSection.vue`（保存位置、`synth`、`listGenerated`）、`src/renderer/src/pages/TextTtsPage/helpers.ts`（`list-all` 失败时的回退组装）。

## 6. 注意事项与实现要点

- **API Key 缺失提示**：所有需要网络的 handler 先跑 `getVoiceApiError`，返回统一文案「未配置千问语音 API Key，请先到「设置」-「千问语音」填写」；`voice:list-system-voices` / `list-models` / 映射类频道**不需要** Key，离线可用。
- **网络请求与超时**：全部使用全局 `fetch`，源码中**没有** `AbortController`、超时或重试逻辑；Qwen-TTS 合成是「接口 → 音频 URL → 二次下载」两步，任一环节失败都会走到 `voiceFriendlyError`。
- **请求头与编码**：请求统一 `Content-Type: application/json` + `Authorization: Bearer <apiKey>`；音频以 Base64 data URI 内联，克隆音色对 Base64 体积有 10 MB 上限（约原文件 7.5 MB）。
- **文件名与时间戳**：默认名由 `nowStamp()`（本地时间 `YYYYMMDD_HHmmss`）+ 文本前 5 字 + 音色 id 尾 12 位组成；自定义名与文本片段都会过滤 Windows 非法字符 `[\\/:*?"<>|]`，避免落盘失败。
- **字段兼容**：克隆响应音色 ID 兼容 `output.voice`（Qwen-TTS）与 `output.voice_id`（Qwen-Audio-TTS）；列表项兼容 `voice` / `voice_id` 与 `target_model` / `targetModel`。
- **配置合并语义**：`voice:save-config` 只覆盖显式传入的字段——只存 `saveDir` 不会清空 API Key，设置页保存也不会覆盖 `saveDir`；`targetModel` 非法时静默回落 `qwen-audio-3.0-tts-flash`。
- **落盘回执不撒谎**：存到自定义目录 / 音频输出目录时不再回写 `project.json`，`savedTo` 如实返回 `custom` / `output`；只有真正写入项目 `audio/` 才置 `project`。
- **容错风格**：`parseJsonLike` 解析失败返回 `null`；目录创建、`project.json` 回写、`readdirSync` 失败均被吞掉，不阻断主流程；`ipcMain.handle` 内部一律 `try/catch` 转成 `{ ok:false, message }`。
- **潜在注意点**：`voice:pick-dir` 在窗口为空时使用 `win as Electron.BrowserWindow` 断言（与 `PickAudio` 的显式 `null` 判断不一致）；`voice:synth` 的文件名未做重名检测，同一秒内同名可能覆盖。
- **类型集中在共享层**：`VoiceModel` 与全部 `voice:*` 载荷类型（`VoiceSaveDirPayload` / `VoiceSaveConfigPayload` / `VoiceCreatePayload` / `VoiceProfilePayload` / `VoiceProfileKeyPayload` / `VoiceSynthPayload`）都定义在 `src/shared/types.ts` ④ 节，本文件只 import；`VOICE_MODELS` 用 `VoiceModel[]` 标注，字段写错会直接编译失败。`voice:save-config` 的形参是联合类型 `VoiceSaveConfigPayload | Partial<VoiceTTSConfig>`，因为线上存在「带 `voiceTTS` 包装」与「裸配置对象」两种历史形态（注释已标明）。
