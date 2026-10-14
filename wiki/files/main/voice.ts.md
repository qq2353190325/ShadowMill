# src/main/voice.ts

> 语音服务（**按厂家**）：voice:* 全部 IPC 与合成落盘。

- **所在目录**：src/main/
- **类型**：主进程业务模块（千问语音：音色管理 + 文字生音频）
- **规模**：745 行
- **对外导出**：`synthOne`、`register`、`isAudioTtsModel`、`getVoiceApiError`、`parseJsonLike`、`voiceFriendlyError`、`nowStamp`、`guessAudioExt`、`resolveTtsDir`、`resolveVoiceModel`、`fetchClonedVoices`

## 1. 作用与职责

本模块把阿里云百炼（DashScope）的语音 HTTP 方案收在一个门面里：**克隆（复刻）音色**只走 Qwen-Audio-TTS 系列（`qwen-audio-*-tts`，如 `qwen-audio-3.0-tts-flash`），**文字合成**仍分两支（Qwen-Audio-TTS 走 `SpeechSynthesizer`，系统音色模型 `qwen3-tts-flash` 等走 `multimodal-generation`）。**这些数据是按「厂家」组织的**：模型表 / 端点（`apiBase`）/ Key 提示 / 克隆模型名 / 出厂默认模型全部来自 [`voiceCatalog.ts`](./voiceCatalog.ts.md) 的 `VoiceProviderDef`（当前只有「千问（阿里云百炼）」一家），本文件不写死任何单一端点——请求一律按「模型或音色所属的厂家」取 `apiBase` 与 `apiKey`。

> **本轮变化（vc 系列彻底移除）**：`qwen3-tts-vc-*` 那条线（`qwen-voice-enrollment` 克隆模型、`action:'create'` + `audio.data`、`action:'list'`、"action:'delete'"）已从本文件删净；`voiceCatalog` 侧同时删掉 `enrollModelAudio` 字段与两条 clone 模型，`role: 'clone'` 只剩 `qwen-audio-3.0-tts-flash` 一条。

职责范围：

| 职责 | 关键实现 |
|------|----------|
| **按厂家**读写语音配置（每家只有一份 API Key；保存目录仍是全局一份） | `IPC.Voice.GetConfig` / `SaveConfig`，底层走 `settings.getVoiceSettings` / `saveVoiceProviderConfig` |
| **克隆参考音频的本地准备**（本地文件 → 前 15 秒 / 24 kHz / 单声道 wav） | `runProc` / `probeDuration` / `makeCloneSample`（走 `hfEnv.BUILTIN_RESOURCES` 的内置 ffmpeg / ffprobe） |
| 克隆音色创建：本地文件、公网 URL / `oss://`、`data:audio/...` URI 三种输入（**只支持 Qwen-Audio-TTS 模型**） | `IPC.Voice.Create` |
| 云端克隆音色列表查询（**单一接口**：厂家克隆模型 + `action:'list_voice'`） | `fetchClonedVoices` |
| 云端克隆音色删除（**单一写法**：`action:'delete_voice'`） | `IPC.Voice.DeleteCloud` |
| 系统音色 / 候选模型 / 合并音色列表下发 | `ListSystemVoices` / `ListModels` / `ListAll` |
| 本地音色映射（音色→合成模型）增删查 | `GetProfiles` / `SaveProfile` / `DeleteProfile` |
| 文字合成并落盘到三选一目录，必要时回写 `project.json` | `synthOne` + `IPC.Voice.Synth` |
| 已生成音频枚举（供渲染层复用为背景音频） | `IPC.Voice.ListGenerated` |
| 文件/目录选择对话框 | `PickAudio` / `PickDir` |

本文件**不做**字幕逐句对齐与时间对齐（属 `ttsAlign.ts`），也不直接操作 HyperFrames 项目结构（仅写 `project.json` 的 `ttsAudio` 字段）。

文件头依赖注释：`settings(getVoiceSettings / getVoiceProviderConfig / saveVoiceProviderConfig / readSettings / writeSettings) / voiceCatalog(...) / projects(projectsRoot / scanProjects) / hfEnv(BUILTIN_RESOURCES.ffmpeg / ffprobe，裁参考音频用) / dialog`——注意头注释列了 `writeSettings`，但代码里实际**未使用**它（只经上面几个封装落盘）。

常量表：

| 常量 | 值 / 来源 | 说明 |
|------|-----|------|
| `CLONE_SR` | `24000` | 参考音频重采样目标采样率——**与 Qwen-Audio-TTS 原生采样率一致** |
| `CLONE_SECONDS` | `15` | 本地参考音频截取时长（源码注释：官方推荐 10~20 秒清晰人声）；同时作为 `input.max_prompt_audio_length` 的值 |
| `CLONE_PREFIX_MAX` | `10` | `input.prefix` 仅允许数字 / 英文字母且不超过 10 字符——**现在是唯一上限**（不再有 vc 系列的 16） |

> **`VOICE_MIME` 已删除**：`.wav`→`audio/wav` 等 MIME 映射只服务于 vc 系列的 `audio.data` 载荷，随该系列一起移除；现在音频只有一条路径——`input.url`（远程地址原样透传，本地文件裁成 15 秒 wav 后转 `data:audio/wav;base64,…`）。

> 源码注释说明了「为什么先在本地裁」：`create_voice` 只用参考音频的前 `max_prompt_audio_length` 秒（3~30，默认 10），整段上传毫无意义，还会把 base64 请求体撑大（15 秒 24k 单声道 wav ≈ 700KB，比原文件直传小一个量级）。

> **`VOICE_TTS_MODELS` 已删除**（更早一轮）：它原是「跨厂家全量 id 白名单」，`voice:save-profile` 用它兜底时会把**别家的模型 id 静默回落成千问默认模型**；现在改按「音色所属厂家的模型表」逐条校验（见 §4.3）。

> 原先在本文件顶部的 `VOICE_API_BASE` / `VOICE_ENROLL_MODEL` / `VOICE_ENROLL_MODEL_AUDIO` / 本地 `VOICE_MODELS` / `SYSTEM_SERIES_MODEL` **均已删除**，全部改为从 `voiceCatalog` 引入（`VOICE_MODELS` / `VOICE_PROVIDERS` / `providerByKey` / `providerOfModel` / `providerOfSystemVoice` / `seriesDefaultModel`）；厂家记录里现在只带 `apiBase`（`https://dashscope.aliyuncs.com/api/v1`）、`enrollModel`（`voice-enrollment`）与出厂 `defaultModel`。

候选模型表**在** [`voiceCatalog.ts`](./voiceCatalog.ts.md) **的 `QWEN_MODELS` 里**（现 **2 条**；`VoiceModel` 及其 `VoiceModelRole` / `VoiceModelInput` 定义在 `src/shared/types.ts` ④ 节）。当前 2 条：

| id | label | role | input | isDefault |
|----|-------|------|-------|-----------|
| `qwen3-tts-flash` | `千问3-TTS-Flash` | `system` | — | `true` |
| `qwen-audio-3.0-tts-flash` | `qwen-audio-3.0-tts-flash（语音复刻，本地文件 / 公网 URL 均可）` | `clone` | `url` | — |

> **本轮删除的两条**（源码注释：用户确认「vc 这条线彻底清掉」，2026-10-14）：`qwen3-tts-vc-2026-01-22`（Qwen-TTS / vc 系列，官方已下线该复刻模型，合成报「Model not exist」，留着只会让人选到一个必然失败的目标模型）与**同 id 的 `qwen3-tts-flash` clone 条目**（当年为验证「平台按登记时的 `target_model` 授权」这条猜测而加，本地文件既然已能在 `qwen-audio` 上跑通，此路径失去意义）。因此**不再有「同 id 两条、标签不同」的形态**，`role: 'clone'` 只剩 audio 一条。
> 更早已移除的旧条目：`qwen3-tts-vc-realtime-2026-01-15` / `qwen3-tts-vc-realtime-2025-11-27`（该账号合成 404）、`qwen3-tts-instruct-flash` / `qwen-tts`（实测 404「Model not exist」）。

## 2. 内部实现函数

| 名称 | 说明 |
|------|------|
| `isAudioTtsModel(model)` | 判定是否 Qwen-Audio-TTS 系列；正则 `/^qwen-audio-.*-tts/i` 作用于 `String(model \|\| '')`。源码注释：它**也是「能不能作复刻目标模型」的唯一判据**（vc 系列已移除）——`voice:create` 用它兜底拒绝非 audio 模型 |
| `runProc(exe, args)` | `spawn(exe, args, { windowsHide: true })` 的 Promise 封装（样板同 `whisper.ts` / `ttsAlign.ts`，不引第三方依赖）。累积 stdout / stderr；`error` 事件 → `'无法启动 ' + path.basename(exe) + '：' + err.message`；`close` 且 `code === 0` → `resolve(stdout)`，否则 reject `'<exe 文件名> 退出码 N'`（stderr 非空时追加 `'：' + stderr 末 300 字符`） |
| `probeDuration(file)` | `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>` 取时长（秒，float）；`!isFinite(d) \|\| d < 0` → throw `'无法读取音频时长：' + file` |
| `makeCloneSample(src)` | 本地音频 → 参考样本 wav（见 §4.1.1），返回临时文件路径（调用方 `finally` 里删除） |
| `errMsg(e)` | 错误对象 → 消息串（`e.message` 存在则用它，否则 `String(e)`），供 `voice:create` 的各处 `catch` 共用 |
| `activeProviderDef()` | 当前选中的厂家：`providerByKey(settings.getVoiceSettings().active)`——「克隆音色列表 / 删除云端音色」这类**没有模型信息的调用**用它 |
| `providerFor(voice?, model?)` | 解析出 `{ def, apiKey, defaultModel }`：**模型 → 厂家最准**（`providerOfModel`），其次「系统音色所属厂家」（`providerOfSystemVoice`，克隆音色为 `null`），最后退回 active 厂家；`apiKey` 取该厂家已保存的配置，**`defaultModel` 一律取厂家目录里的出厂默认**（`def.defaultModel`） |
| `modelKnownFor(provider, model?)` | 判断某个模型 id 是否在**该厂家的模型表**里；用于「本地映射绑着已下线/不存在的模型时忽略它」（否则合成必然 404 `Model not exist`） |
| `vendorMismatch(voice?, model?)` | **跨厂家校验**：音色名是厂家私有的（千问是 `Cherry` / `Serena` 这类 `voice` 参数，别家另一套 id），系统音色按 `providerOfSystemVoice` 定厂家、模型按 `providerOfModel` 定厂家；**两家不同则返回一句含两个厂家 label 的明确提示**（并提示可到「音色管理 → 音色映射管理」改绑该音色的模型）。**不做静默改名、也不静默换厂家**；克隆音色（`providerOfSystemVoice` 返回 `null`，厂家信息在云端）与任一侧为空时**一律放行返回 `null`** |
| `getVoiceApiError(provider, apiKey)` | `apiKey` 为空时按厂家提示「未配置「<厂家 label>」的 API Key，请先到「设置」-「语音服务」填写并保存」，否则 `null` |
| `parseJsonLike(text)` | `JSON.parse` 的容错包装，解析失败静默返回 `null` |
| `voiceFriendlyError(err, label)` | 取 `err.message`（无则 `String(err)`）；`InvalidApiKey/unauthorized/Unauthorized/401/403` → 「API Key 无效或无权限，请检查后重试」；`quota/ExceededQuota/Insufficient` → 前缀「额度不足或已被限流：」；**`Model not exist` → 「这个模型在当前账号里不存在…请到「设置 → 语音服务」核对厂家，或到「音色管理 → 音色映射管理」把该音色改绑到可用的模型」**；**`does not exist or is not licensed` → 「音色未获授权或不存在…克隆音色只能用创建时对应的复刻模型合成，该模型在当前账号不可用时请改用系统音色」**；最终返回 `label + '：' + msg` |
| `nowStamp()` | 本地时间戳 `YYYYMMDD_HHmmss`（各段 `padStart(2,'0')`） |
| `guessAudioExt(url)` | 去 query → 取末段并 `decodeURIComponent` → 匹配 `wav/mp3/m4a/mp4/aac/ogg/flac`，命中返回小写扩展名，否则 `'wav'` |
| `resolveTtsDir(projectName, saveDir)` | 落盘目录解析，优先级：`saveDir` → `projects.projectsRoot()/<projectName>/audio` → `scanProjects()[0].name` 的 `audio/` → `app.getPath('userData')/tts-output` |
| `systemVoiceDefaultModel(provider, v)` | **两个参数**，实现就一行——转调 `voiceCatalog.seriesDefaultModel(provider, (v as SystemVoice).series)`：按该音色 `series` 数组的**顺序**，在该厂家模型表里找第一个「`role === 'system'` 且 `series` 与之相同」的模型 id；都没有才回落 `provider.defaultModel`（千问 = `qwen3-tts-flash`） |
| `resolveVoiceModel(voiceKey, _ctx)` | 「音色→模型」三级统一解析（见 §4.3） |
| `fetchClonedVoices(providerKey?)` | 查询云端克隆音色列表（**单一接口 + 字段归一化**，见 §4.2），返回 `{ ok, voices?, total?, message? }` |
| `synthOne(text, voice, useModel)` | 单次合成**不落盘**，返回 `{ buf, ext }`（见 §4.4）；被 `voice:synth` 与 `ttsAlign.ts` 复用 |
| `register(ctx?)` | 注册全部 `voice:*` IPC handler；`getWindow` 取自 `ctx.getWindow`，缺省 `() => null` |

## 3. IPC 频道一览

`register()` 共注册 16 个频道（下表全量覆盖）。`voice:synth-aligned` / `voice:align-cancel` / `voice:align-progress` 定义在 `IPC.Voice` 中，但由 `ttsAlign.ts` 注册，**不在本文件**。

handler 的载荷类型全部取自 `src/shared/types.ts` ④ 节（本文件**不自行声明任何 payload / result 接口**）：`get-save-dir` → `VoiceSaveDirPayload`，`save-config` → `VoiceSaveConfigPayload`（`{ provider?, config?: { apiKey? }, saveDir? }`；**仍兼容**历史形态 `{ voiceTTS: { apiKey, targetModel } }` 与裸 `{ apiKey, targetModel }`），`create` → `VoiceCreatePayload`，`save-profile` → `VoiceProfilePayload`，`delete-profile` → `VoiceProfileKeyPayload`，**`delete-cloud` → 内联的 `{ voice?: string }`**，`synth` → `VoiceSynthPayload`。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
|--------|----------|----------|----------|
| `voice:get-config` | 无 | `{ ok:true, active, providers, saveDir }` | **按厂家**回带配置：`active` 为当前厂家键、`providers` 为各家已保存的 `VoiceProviderConfig`（**只有 `{ apiKey }`**）、`saveDir` 统一 `String(vs.saveDir \|\| '')` |
| `voice:get-save-dir` | `VoiceSaveDirPayload`（`{ saveDir?, defaultOut?, projectName? }`） | `{ ok:true, mode, saveDir }` | 解析并 `mkdirSync(recursive)` 目标目录（失败静默）；`mode` 为 `output` / `custom` / `project` / `default` |
| `voice:save-config` | `VoiceSaveConfigPayload`（`{ provider?, config?: { apiKey? }, saveDir? }`；兼容历史 `{ voiceTTS }` 与裸 `{ apiKey, targetModel }`，**其中的 `targetModel` 一律忽略**） | `{ ok:true, settings, voice }` | **两种用途**（源码注释分 ① ②）：① `{ provider?, config: { apiKey } }` → `settings.saveVoiceProviderConfig(p.provider, { apiKey }, dir)`，保存即把 `active` 切到该厂家；② **`{ saveDir }`（只有目录）→ `settings.saveVoiceSaveDir(dir)`**，不动 Key、不切厂家。**空载荷 `{}` 什么都不写**；只有真给了 Key 或明确点了厂家时才动厂家配置 |
| `voice:pick-audio` | 无 | 文件绝对路径 或 `null` | 标题「选择用于克隆音色的音频（推荐 10~20 秒清晰人声，主进程会自动截取前 15 秒）」；filters 为 `['mp3','wav','m4a','aac','flac','ogg','wma','mp4','mov','mkv']`（名称「音频 / 视频文件」，源码注释：任何 ffmpeg 能解码的格式都行——本地文件会先转成 24k 单声道 wav 再提交）；无窗口或取消返回 `null` |
| `voice:create` | `VoiceCreatePayload`（`{ audioPath?, targetModel?, preferredName? }`） | `{ ok:true, voice, targetModel }` 或 `{ ok:false, message }` | 创建克隆音色，**只服务 Qwen-Audio-TTS 模型**（非 audio 模型直接拒绝，见 §4.1） |
| `voice:list-system-voices` | 无 | `{ ok:true, voices, total }` | **按厂家遍历**内置系统音色（`VOICE_PROVIDERS.forEach`），每项附 `voice/desc/langs/series/model` 并带 `provider` / `providerLabel`；`model` 优先取本地映射，**但仅当该绑定仍在厂家模型表里**（`modelKnownFor`），否则按固定绑定回落到 `systemVoiceDefaultModel(厂家, 音色)` |
| `voice:list-models` | 无 | `{ ok:true, models, providers }` | 下发跨厂家平铺的 `VOICE_MODELS`（现 2 条）**与厂家目录** `providers`（`VoiceProviderView[]`：`key` / `label` / `apiKeyHint` / `defaultModel` / `models` / `voices`），渲染层据此把模型与音色按厂家分组展示 |
| `voice:get-profiles` | 无 | `{ ok:true, profiles }` | 读 `settings.voiceProfiles` |
| `voice:save-profile` | `VoiceProfilePayload`（`{ profile: Partial<VoiceProfile> & { type?: string } }`） | `{ ok:true, profiles }` 或 `{ ok:false, message }` | `key`/`voice`/`targetModel` 必填（缺 →「映射信息不完整」）；**模型必须属于该音色所属厂家**（系统音色按它所属厂家、克隆音色按当前 active 厂家）：跨厂家 →「模型「x」属于「A」，而音色「y」属于「B」：两者必须同属一个厂家」；模型不在该厂家模型表里 →「「B」的模型表里没有「x」」；`type` 非 `system` 一律存为 `custom` |
| `voice:delete-profile` | `VoiceProfileKeyPayload`（`{ key }`） | `{ ok:true, profiles }` 或 `{ ok:false, message:'缺少映射 key' }` | 删除**本地**音色映射 |
| `voice:delete-cloud` | `{ voice?: string }`（内联载荷） | `{ ok:true, voice, profiles }` 或 `{ ok:false, message }` | **删除云端克隆音色**（DashScope customization，**不可撤销**；成功后一并 `deleteVoiceProfile('custom:' + voice)` 回带最新映射）——见 §4.6 |
| `voice:list` | 无 | `{ ok, voices?, total?, message? }` | 等价于 `fetchClonedVoices()`——**单一查询**（handler 行内注释「model=厂家的克隆模型 + action=list_voice」），成功即回带归一化后的整个列表 |
| `voice:list-all` | 无 | `{ ok:true, voices, total, cloudMessage }` | 系统音色（**跨厂家平铺**）+ 克隆音色合并，统一 `{ key, type, name, voiceId, model }`；云端失败时 `cloudMessage` 携带原因 |
| `voice:pick-dir` | 无 | `{ ok:true, dir }` 或 `{ ok:false, canceled:true }` | 目录选择框（`openDirectory` + `createDirectory`） |
| `voice:list-generated` | 无 | `{ ok:true, items, total }` | 扫描三类目录下的音频文件，`items` 元素为 `{ path, name, group, size, mtime }` |
| `voice:synth` | `VoiceSynthPayload`（`{ text?, voice?, targetModel?, projectName?, saveDir?, defaultOut?, audioName? }`） | `{ ok:true, savePath, projectName, savedTo, size }` 或 `{ ok:false, message }` | 合成并落盘（见 §4.4） |

> `voice:synth` 的 handler 行内注释与实现一致：「文字合成语音并保存（**两个系列都是「接口 → `output.audio.url` → 二次下载」**，见 `synthOne`）」。

## 4. 关键流程

### 4.1 克隆音色（`voice:create`）

**本轮重写：只服务 Qwen-Audio-TTS 系列**（vc 分支整段删除——`audio.data`、`action:'create'`、`preferred_name`、`VOICE_MIME` 表、10 MB 守卫、`!isAudio && isRemoteUrl` 拒绝分支全部不再存在）。

1. **按目标模型定厂家**：`active = providerFor()` 先给出当前厂家的默认模型，`useModel = String(payload.targetModel || '').trim() || active.defaultModel`；再 `prov = providerFor(undefined, useModel)`（**模型属于哪家就用哪家的 Key 与端点**），`getVoiceApiError(prov.def, prov.apiKey)` 命中则直接返回 `{ ok:false, message }`（提示带厂家名）。
2. **只认 audio 系列**：`if (!isAudioTtsModel(useModel))` → `{ ok:false, message: '模型「<useModel>」不支持音色复刻：请把「目标模型」选成 qwen-audio-* 系列（如 qwen-audio-3.0-tts-flash）' }`。源码注释：界面只列 `role: 'clone'` 的模型，这里再兜一道（系统音色模型如 `qwen3-tts-flash` 走不到这里）。
3. `audioPath` 为空 → `{ ok:false, message:'请先选择本地音频文件，或粘贴可公开访问的音频 URL' }`。
4. **三种输入形态**：本地绝对路径、`http(s)://` / `oss://` 远程地址、`data:audio/...;base64` URI。判定用两条正则：`isRemoteUrl = /^(https?|oss):\/\//i`、`isDataUri = /^data:audio\//i`；**远程地址与 data URI 都不落本地，直接使用**。
5. **名称校验（统一 10 位）**：`preferredName` 先 `.replace(/[^a-zA-Z0-9_]/g, '')`；为空或长度 > `CLONE_PREFIX_MAX` → `{ ok:false, message: '音色名称需 1~' + CLONE_PREFIX_MAX + ' 个字符，仅限数字、字母、下划线' }`（实际文案即「音色名称需 1~10 个字符，仅限数字、字母、下划线」）。
6. **准备 `input.url`**：
   - 远程地址 / data URI → 原样作为 `url`；
   - 本地路径 → 先 `fs.existsSync`（缺 → `'音频文件不存在：' + audioPath`），再 `makeCloneSample(audioPath)` 裁出前 15 秒 24k 单声道 wav → `fs.readFileSync(...).toString('base64')` 拼成 `'data:audio/wav;base64,' + …`；准备失败 → `'准备参考音频失败：' + errMsg(e)`。
7. **组装 `input` 并 POST** `prov.def.apiBase + '/services/audio/tts/customization'`，header `Content-Type: application/json` + `Authorization: Bearer <prov.apiKey>`，body `{ model: prov.def.enrollModel /* voice-enrollment */, input }`，`input` 固定六项：

| 字段 | 值 |
|------|-----|
| `action` | `'create_voice'` |
| `target_model` | `useModel` |
| `prefix` | `preferredName`（1~10 位 ASCII） |
| `url` | 远程地址 / `data:audio/wav;base64,…` |
| `language_hints` | `['zh']` |
| `max_prompt_audio_length` | `CLONE_SECONDS`（15，与本地裁剪时长一致；文档区间 3~30、默认 10） |

8. **失败文案**：非 2xx 时取 `json.code`；`code + ' ' + message` 命中 `/audio/i` → 返回
   `'创建音色失败（服务端不接受这段参考音频）：HTTP <status>：<message>。请换一段 3~30 秒、清晰无噪音的人声（本地文件会自动截取前 15 秒）。'`；
   其它非 2xx 抛 `HTTP <status>：<message>`，与其它异常一起由 `voiceFriendlyError(e, '创建音色失败')` 包装。
9. **成功分支（本轮收缩为严格按文档口径解析）**：只读 **`out.voice_id`**（源码注释：严格按文档口径，创建返回体只有 `output.voice_id`（+ `usage.count` / `request_id`，不用）），缺失则抛 **「接口未返回音色 ID（output.voice_id）」**；**不再读 `output.target_model` / `fallback_mode` / `fallback_reason`**（源码注释：这三个字段文档没有、实测也从未返回过），返回 `{ ok: true, voice, targetModel: useModel }`——回执里的模型取「**本次请求发的目标模型**」，因为创建返回体不带 `target_model`。渲染层因此也删掉了「（降级模式：…）」提示。
10. **`finally` 清理临时文件**：`localSample` 非空时 `fs.unlinkSync(localSample)`，**删不掉不影响主流程**（`catch` 吞掉）——别在用户临时目录里留 15 秒 wav 垃圾。

#### 4.1.1 参考音频的本地准备（`runProc` → `probeDuration` → `makeCloneSample`）

| 步骤 | 实现 |
|------|------|
| 工具存在性 | `fs.existsSync(BUILTIN_RESOURCES.ffmpeg)` 与 `ffprobe` 任一缺失 → throw `'未找到内置 ffmpeg/ffprobe（运行环境包可能还没解包完成），无法裁取参考音频'` |
| 量时长 | `probeDuration(src)`：ffprobe `-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <src>` → `parseFloat` |
| 时长下限 | `dur < 3` → throw `'参考音频太短（' + dur.toFixed(1) + ' 秒）：声音复刻要求 3~30 秒的清晰人声'`（**服务端要求 3~30 秒**） |
| 输出路径 | `path.join(app.getPath('temp'), 'shadowmill-clone-' + Date.now() + '.wav')` |
| ffmpeg 参数 | `-hide_banner -loglevel error -y -i <src> -vn -t 15 -ac 1 -ar 24000 -c:a pcm_s16le <out>`（去视频流、截前 15 秒、单声道、24 kHz、PCM 16-bit LE） |

#### 4.1.2 实测结论（2026-10-14，对本机 Key 真实调用 `https://dashscope.aliyuncs.com/api/v1`）

- **`input.url` 直接接受 data URI**：15 秒 24k 单声道 wav（720,078 字节 → data URI 960,126 字符）→ HTTP 200，返回 `output.voice_id`。官方文档只写「要求公网可访问的 URL」，实测并非硬校验——所以本地文件不必先传到公网。
- **该克隆音色可以合成**：`POST /services/audio/tts/SpeechSynthesizer`（body `{ model:'qwen-audio-3.0-tts-flash', input:{ text, voice, format:'mp3', sample_rate:24000 } }`）→ HTTP 200，响应是 `{"output":{"audio":{"url":"http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/.../*.mp3?Expires=…","expires_at":…}}}`；二次下载该 URL 得到真 mp3（44,251 字节 / 2.208 秒 / 160 kbps）。
- **该端点不会直接回音频流**：给 `SpeechSynthesizer` 加 `Accept: audio/mpeg` 反而 HTTP 400；`/services/aigc/multimodal-generation/generation` 对该模型同样 HTTP 400。因此实现必须是「读文本 → 解析 JSON → 取 `output.audio.url` → 再下载」（见 §4.4）。
- **官方临时存储路径同样可行但没有实现**：`GET /api/v1/uploads?action=getPolicy&model=qwen-audio-3.0-tts-flash` → multipart 上传 → 拿 `oss://…` → `create_voice` 时带请求头 `X-DashScope-OssResourceResolve: enable` → HTTP 200。**源码里没有这条路径**（`voice:create` 的 header 只有 `Content-Type` + `Authorization`），它只是「另一种可行做法」的实测记录。
- 实测创建的测试音色用 `action:'delete_voice'` 清理——正是 `voice:delete-cloud` 现在**唯一**的写法（见 §4.6）。

### 4.2 查询云端音色列表（`fetchClonedVoices(providerKey?)`）

> 克隆音色属于某个账号 ⇒ **必须用「该厂家」的 Key 与该厂家的端点**；`providerKey` 缺省 = 当前 active 厂家（`providerByKey(providerKey) : activeProviderDef()`）。

**本轮重写回单一查询**（上一版曾同时查两个系列的接口，随 vc 系列移除而作废）：

1. 无该厂家的 API Key 直接返回 `{ ok:false, message }`。
2. POST `provider.apiBase + '/services/audio/tts/customization'`，header `Content-Type: application/json` + `Authorization: Bearer <该厂家的 apiKey>`，body **`{ model: provider.enrollModel /* voice-enrollment */, input: { action: 'list_voice', page_size: 100, page_index: 0 } }`**。
3. HTTP 非 2xx 抛 `HTTP <status>：<message>`；成功取 `json.output.voice_list`（非数组则为 `[]`）。
4. **字段归一化（保留）**：按 `v.voice || v.voice_id` 去重（`seen` 记录已收 id），并 `Object.assign({}, v, { voice: id, voice_id: id, target_model: model, targetModel: model })`，其中 `id = String(v.voice || v.voice_id).trim()`、`model = String(v.target_model || v.targetModel || '').trim()`——**接口给 `voice_id`、历史数据给 `voice`**，统一成两者都填同一个 id，渲染层不必再按系列分支。
5. **失败即失败**：`catch` 里直接 `return { ok:false, message: voiceFriendlyError(e, '查询音色失败') }`（不再有「部分失败容忍」的逻辑，因为只有一个查询）。
6. **源码注释记下的历史坑（2026-10-14 实测）**：这里曾只查 `qwen-voice-enrollment` 的 `action:'list'`（vc 系列），而创建走的是 `voice-enrollment` 的 `create_voice`——于是新建的音色云端 `status=OK`、本地映射也有中文名，「我的音色」里却看不见。vc 那条线彻底移除后只有一套接口，不再存在两边错配。
7. 影响面：`voice:list`（handler 注释同步为「model=厂家的克隆模型 + action=list_voice」）与 `voice:list-all`（后者只消费结果，其克隆条目「本地映射 → 云端 `target_model` → 厂家默认模型」三级回退与 `voiceId = v.voice || v.voice_id` 逻辑**未改**）。

**实测证据与账号侧数据处置（2026-10-14，属账号数据、不是仓库改动）**：

- `voice-enrollment` + `action:'list_voice'` → HTTP 200，`total_count: 1`，条目形如 `{ gmt_create: "2026-10-14 12:54:41", status: "OK", target_model: "qwen-audio-3.0-tts-flash", voice_id: "qwen-audio-3.0-tts-flash-myvoice536-…" }`（**字段是 `voice_id`**）——归一化后渲染层读到的是「测试 / `qwen-audio-3.0-tts-flash` / 2026-10-14 12:54:41」。
- 账号里那条旧 vc 音色 `qwen-tts-vc-31-voice-20261014003611393-fbd4` 已用 `{ model:'qwen-voice-enrollment', input:{ action:'delete', voice } }` 删除：删除前该接口 `total_count:1`，删除后 `total_count:0`（HTTP 200）。
- 其本地映射 `custom:qwen-tts-vc-31-…` 已从 `%APPDATA%\shadowmill\settings.json` 的 `voiceProfiles` 移除；现存映射只有 `custom:qwen-audio-3.0-tts-flash-myvoice536-…`（name「测试」）。

### 4.3 本地音色映射与「音色→模型」解析

- 映射键 `voiceProfiles` 形如 `system:X`（如 `system:Cherry`）或 `custom:X`（如 `custom:<voice_id>`），值为 `{ key, name, voice, targetModel, type }`。
- `resolveVoiceModel(voiceKey)` 三级解析：
  1. `profiles[key] || profiles[bare]`（`bare` 去掉 `system:` / `custom:` 前缀）命中且含 `targetModel`，**并且 `modelKnownFor(provider, prof.targetModel)` 为真**（该厂家模型表里现存）→ 直接使用；绑着已下线/不存在的模型时**忽略它**，否则合成必然 404「Model not exist」；
  2. `providerOfSystemVoice(bare)` 命中 → 取该音色、调 `systemVoiceDefaultModel(provider, v)`（内部即 `seriesDefaultModel`：按 `series` 在**该厂家**模型表里找 `role: 'system'` 的模型）；
  3. 兜底 `provider.defaultModel` ——**厂家目录里的出厂默认模型**（不再读设置：已无用户可改的「厂家默认模型」）。
- `voice:list-all` 中克隆音色另有三级回退：本地映射 `targetModel` → 云端 `v.target_model || v.targetModel` → `resolveVoiceModel(key, ctx)`；`voiceId` 取 `v.voice || v.voice_id`，为空则跳过该条。
- `voice:list-system-voices` 的 `model` 字段同样优先读 `profiles['system:' + v.voice].targetModel`。
- **保存映射时按厂家校验**（`voice:save-profile`）：`modelVendor = providerOfModel(wanted)`、`voiceVendor = providerOfSystemVoice(voice) || activeProviderDef()`；两者不同 → `{ ok:false, message:'模型「x」属于「A」，而音色「y」属于「B」：两者必须同属一个厂家' }`；模型不在 `voiceVendor.models` 里 → `{ ok:false, message:'「B」的模型表里没有「x」' }`。

### 4.4 TTS 合成落盘（`synthOne` → 目录 → 文件名 → 回执）

`synthOne` 上方注释：**两个系列都是「接口 → `output.audio.url` → 二次下载」**（Qwen-Audio-TTS 走 `SpeechSynthesizer`、Qwen-TTS 走 `multimodal-generation`，响应体都是 JSON）。**注意这里的两支与克隆无关**：vc 的**克隆**通道已移除，但系统音色模型（`qwen3-tts-flash`）仍走 Qwen-TTS 的合成端点。

1. 校验：无 API Key、`text` 为空（「合成文本为空」）、`voice` 为空（「请先选择（或创建）音色」）分别提前返回。
2. `useModel = payload.targetModel.trim() || prov.defaultModel`（`prov = providerFor(voice, useModel)`，按**合成模型所属厂家**取 `apiBase` 与该厂家已保存的 Key），保证与克隆创建时的 `target_model` 一致。
3. **跨厂家校验**：`synthOne` 开头调 `vendorMismatch(voice, useModel)`，不一致直接 `throw new Error(提示)`——`voice:synth` 与「逐句对齐」两条路径都会被拦下。
4. `synthOne` 按系列分流：

| 分支 | 端点与 body | 取回音频的方式 |
|------|-------------|----------------|
| Qwen-Audio-TTS | POST `/services/audio/tts/SpeechSynthesizer`，body `{ model, input: { text, voice, format:'mp3', sample_rate: 24000 } }` | `await resp.text()` → `parseJsonLike`；非 2xx 时拼 `'HTTP <status>' + （`[<code>] ` + message）` 抛出；取 `json.output.audio.url`，**缺失抛「接口未返回音频地址（output.audio.url）」**；把 `http://` 前缀替换成 `https://`（源码注释：明文 http 在部分网络环境会被拦）后 `fetch` 二次下载，非 2xx 抛「下载音频失败：HTTP <status>」，`ext = guessAudioExt(<原始 audioUrl>)` |
| Qwen-TTS | POST `/services/aigc/multimodal-generation/generation`，body `{ model, input: { text, voice } }` | 同样 `text()` → JSON → 取 `json.output.audio.url` 二次下载；无 URL 抛「接口未返回音频地址（output.audio.url）」，下载非 2xx 抛「下载音频失败：HTTP <status>」，`ext = guessAudioExt(audioUrl)` |

> **audio 分支的修正在更早一轮完成**：上一版把 `SpeechSynthesizer` 的响应体当成音频流直写（`arrayBuffer()` + `ext = 'mp3'`），实测会把 467 字节的 JSON 当 mp3 存下来；现在必须先解析 JSON 再二次下载（依据见 §4.1.2）。

5. **保存位置三选一**（渲染层显式传入，不再回落持久化 `saveDir`，避免「保存到项目」被静默忽略）：

| 优先级 | 条件 | 落盘目录 | `savedTo` |
|--------|------|----------|-----------|
| 1 | `saveDir` 非空 | `resolveTtsDir('', saveDir)` → 即该自定义目录 | `'custom'` |
| 2 | `defaultOut` 为真 | `app.getPath('userData')/tts-output` | `'output'` |
| 3 | 其余 | `resolveTtsDir(projectName, '')` → 项目 `audio/`（无项目则最近项目 `audio/`，均无则 `tts-output`） | `'default'` / `'project'` |

6. `fs.mkdirSync(destDir, { recursive: true })`；文件名基底优先用 `audioName`（过滤 `[\\/:*?"<>|]` 并折叠连续空白），否则 `nowStamp() + '_' + Array.from(text).slice(0,5).join('') + '_' + voice尾12位`（`voice` 净化后取 `.slice(-12)`，为空则为 `voice`；前五字净化后为空则为 `tts`）；最终 `base + '.' + ext`。
7. `fs.writeFileSync(savePath, buf)`。
8. 落盘回执：仅当**既无 `saveDir` 也无 `defaultOut` 且有 `projectName`** 时才判定为项目保存——读项目 `project.json`，写 `proj.ttsAudio = path.join('audio', path.basename(savePath))` 并以 `JSON.stringify(proj, null, 2)` / `utf8` 回写（异常不阻断主流程），`savedTo = 'project'`，返回 `projectName`。既无 `saveDir`/`defaultOut` 又无 `projectName` 时 `scanProjects()` 取首个项目名，否则 `savedTo = 'output'`。
9. 返回 `{ ok:true, savePath, projectName, savedTo, size: buf.length }`；异常统一 `voiceFriendlyError(e, '合成语音失败')`。

### 4.5 已生成音频列表（`voice:list-generated`）

1. 正则 `AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg|flac|mp4)$/i`，`seen: Set<string>` 按绝对路径去重。
2. 依次扫描三处并打分组名：

| 顺序 | 目录 | group |
|------|------|-------|
| 1 | `userData/tts-output` | `音频输出目录` |
| 2 | `cfg.saveDir`（非空时） | `自定义目录` |
| 3 | `projects.projectsRoot()/<每个顶层目录>/audio` | `项目 · <项目名>` |

  > 第 3 处的根目录在 handler 开头一次性取得（`const projectsRoot = projects.projectsRoot()`），后续只用这个局部变量——**不是**模块级快照。

3. `pushDir` 内部：目录不存在或 `readdirSync` 抛错则跳过；仅收正则命中的名字，`statSync` 失败或非普通文件跳过；条目为 `{ path, name, group, size, mtime }`。
4. 结果按 `mtime` 降序，返回 `{ ok:true, items, total }`。

### 4.6 删除云端克隆音色（`voice:delete-cloud`）

源码注释明确它与 `voice:delete-profile` 的分工：**`delete-profile` 只清本地映射，本频道删的是云端音色本身**（不可撤销）。**本轮收敛为单一写法**（`vc 系列的 action='delete' 写法随该系列一同移除`）。

1. 取当前 **active 厂家**的 Key（缺失返回 `getVoiceApiError()` 的提示）；音色 id 从 `payload.voice` 取，缺失回「缺少音色 id」。
2. POST `provider.apiBase + '/services/audio/tts/customization'`，body 只有一种：**`{ model: provider.enrollModel /* voice-enrollment */, input: { action: 'delete_voice', voice_id } }`**。源码注释记的成功响应形如 `{ output: {}, usage: { count: 1 } }`。
3. 成功（HTTP 200）⇒ `settings.deleteVoiceProfile('custom:' + voice)`，返回 `{ ok: true, voice, profiles }`。
4. 失败分支（全部在同一个 `try/catch` 内）：
   - `code` 命中 `VoiceNotFound` ⇒ `{ ok:false, message: '云端没有这个音色（可能已被删除）：<id>' }`；
   - `code + ' ' + message` 命中 `/not\s*(exist|found)|invalid/i` ⇒ **也**清掉本地映射并返回 `{ ok:false, message: '云端删除被拒绝（<code 或 message>），已清除该音色的本地映射' }`（源码注释：音色不存在时也把本地映射清掉，免得留一条指向幽灵音色的条目）；
   - 其它 ⇒ `throw new Error('HTTP ' + resp.status + '：' + code + ' ' + message)`，由 `voiceFriendlyError(e, '删除云端音色失败')` 包装返回。

### 4.7 错误友好化

`voiceFriendlyError` 是统一的出口包装：识别鉴权类（`InvalidApiKey` / `unauthorized` / `Unauthorized` / `401` / `403`）替换为固定文案，识别额度类（`quota` / `ExceededQuota` / `Insufficient`）加「额度不足或已被限流：」前缀，另有两条账号/模型相关的友好映射——`Model not exist`（模型在当前账号不存在 → 去设置页核对厂家，或到「音色映射管理」改绑可用模型）与 `does not exist or is not licensed`（音色未获授权/不存在 → 克隆音色只能用创建时的复刻模型，不可用时改用系统音色）；其余保留原始 message，最终统一加 `<label>：` 前缀（label 取值：`创建音色失败` / `合成语音失败` / `查询音色失败` / `删除云端音色失败`）。

## 5. 依赖与协作

| 依赖 | 用途 |
|------|------|
| `electron` 的 `app` / `ipcMain` / `dialog` | 注册 handler、取 `userData` / `temp` 路径、文件与目录选择框（`voice:pick-audio` 用 `getWindow()` 判空返回 `null`） |
| `node:path` / `node:fs` | 路径拼接、目录与文件读写、`existsSync` / `statSync` / `readdirSync` / `readFileSync` / `unlinkSync` |
| `node:child_process` 的 `spawn` | `runProc` 调内置 ffmpeg / ffprobe（`windowsHide: true`，参数数组传递，不经 shell） |
| `./settings` | `getVoiceSettings` / `getVoiceProviderConfig` / `saveVoiceProviderConfig`（第三参可带 `saveDir`）/ **`saveVoiceSaveDir`**（只存目录）/ `getVoiceProfiles` / `saveVoiceProfile` / `deleteVoiceProfile` / `readSettings`（**无 `writeSettings`**：头注释列了它，代码里实际只经上面这些封装落盘） |
| `./voiceCatalog` | `VOICE_MODELS` / `VOICE_PROVIDERS` / `providerByKey` / `providerOfModel` / `providerOfSystemVoice` / `seriesDefaultModel`（含类型 `VoiceProviderDef`）：模型表 / 端点 / Key 提示 / 克隆模型名 / 出厂默认模型 / 系统音色表，全部**按厂家**组织；**`systemVoices.ts` 由它引用，本文件不直接 import** |
| `./hfEnv` | `BUILTIN_RESOURCES.ffmpeg` / `BUILTIN_RESOURCES.ffprobe`，用于裁剪克隆参考音频（见 §4.1.1）；依赖图据此有一条 `voice → hfEnv` |
| `./projects` | `projects.projectsRoot()`（**函数，惰性求值**）与 `scanProjects()`，用于项目 `audio/` 定位与列表扫描 |
| ~~`./systemVoices`~~ | **已无此 import**：`voice.ts` 改用 `./voiceCatalog` 的 `providerOfSystemVoice` / `seriesDefaultModel` 间接使用音色表；`systemVoices.ts` 现在只导出 `SYSTEM_VOICES` |
| `../shared/ipc` | `IPC.Voice.*` 频道常量 |
| `../shared/types` | `import type { RegisterCtx, SystemVoice, VoiceCreatePayload, VoiceProfileKeyPayload, VoiceProfilePayload, VoiceProfile, VoiceProviderView, VoiceSaveConfigPayload, VoiceSaveDirPayload, VoiceSynthPayload }`——**只此 10 个**（`VoiceModel` / `VoiceTTSConfig` 都不在本文件的 import 里；`voice:delete-cloud` 的 `{ voice?: string }` 是内联标注） |

**`projects.projectsRoot()` 的三个调用点**（函数调用，写法与 `whisper.modelsDir()` / `runtime.runtimeRoot()` 一致）：

| 位置 | 用法 |
|------|------|
| `resolveTtsDir(projectName, saveDir)` 内（当前第 172 行） | `const projectsRoot = projects.projectsRoot()`，随后拼 `<root>/<projectName>/audio` 与 `<root>/<首个项目名>/audio` |
| `IPC.Voice.ListGenerated` handler 开头（当前第 625 行） | 取一次，用于 `existsSync` / `readdirSync` / 拼各项目 `audio/` |
| `IPC.Voice.Synth` 落盘回执段（当前第 708 行） | 需要写项目 `project.json` 时取一次，拼 `path.join(projectsRoot, projectName)` |

> 三处都是**局部的 `const projectsRoot = projects.projectsRoot()`**，不是模块级常量：ESM 的 import 提升会让模块级快照早于 `index.ts` 的模块体求值；函数化是零代价纯保险（见 [index.ts.md](./index.ts.md) §3.1① 与 [projects.ts.md](./projects.ts.md) §3）。

被调用方：

- `src/main/index.ts:442` 执行 `voice.register(ctx)`（主进程装配，依赖图 `settings ← htmlAgent ← projects ← voice ← ttsAlign`）。
- `src/main/ttsAlign.ts` 导入 `synthOne` / `resolveVoiceModel` / `voiceFriendlyError`，用于 `voice:synth-aligned` 逐句合成。
- `src/preload/index.ts` 暴露 `window.voiceTools`（`getConfig` / `getSaveDir` / `saveConfig` / `pickAudio` / `pickDir` / `listGenerated` / `create` / `list` / `listSystemVoices` / `listAll` / `listModels` / `getProfiles` / `saveProfile` / `deleteProfile` / `deleteCloudVoice` / `synth` 等）。
- 渲染层：`src/renderer/src/pages/TextTtsPage/VoiceSection.vue`（克隆音色、映射管理）、`src/renderer/src/pages/TextTtsPage/SynthSection.vue`（保存位置、`synth`、`listGenerated`）、`src/renderer/src/pages/TextTtsPage/helpers.ts`（`list-all` 失败时的回退组装）。

## 6. 注意事项与实现要点

- **API Key 缺失提示（按厂家）**：所有需要网络的 handler 先对「本次请求所属厂家」跑 `getVoiceApiError(provider, apiKey)`，返回统一文案「未配置「<厂家 label>」的 API Key，请先到「设置」-「语音服务」填写并保存」；`voice:list-system-voices` / `list-models` / 映射类频道**不需要** Key，离线可用。
- **网络请求与超时**：全部使用全局 `fetch`，源码中**没有** `AbortController`、超时或重试逻辑；合成是「接口 → `output.audio.url` → 二次下载」两步，任一环节失败都会走到 `voiceFriendlyError`。
- **请求头与编码**：请求统一 `Content-Type: application/json` + `Authorization: Bearer <apiKey>`；克隆音频以 **data URI 内联进 `input.url`**（本地文件先裁成 15 秒 24k 单声道 wav ≈ 700 KB，再转 data URI ≈ 960 K 字符）。**不再有 10 MB Base64 守卫、也不再有 `VOICE_MIME` / `audio.data` 载荷**（那是 vc 系列独有的，随该系列移除）。
- **三种输入形态的取舍**：本地路径 / `http(s)` / `oss://` / `data:` 四类字符串由 `voice:create` 自行分流；渲染层只负责把选中的「本地文件」或「URL」字符串传下来（见 [TextTtsPage.md](../renderer/src/pages/TextTtsPage.md) §5）。
- **临时文件**：`makeCloneSample` 的输出落在 `app.getPath('temp')/shadowmill-clone-<时间戳>.wav`，只在 `voice:create` 的 `finally` 里删除；删除失败被吞掉。
- **删除云端音色只有一种写法**：`voice-enrollment` + `action:'delete_voice'`；`VoiceNotFound` 单独提示，`not exist / not found / invalid` 会在报错的同时清掉本地映射（见 §4.6）。**没有「两种写法依序回退」的循环了。**
- **文件名与时间戳**：默认名由 `nowStamp()`（本地时间 `YYYYMMDD_HHmmss`）+ 文本前 5 字 + 音色 id 尾 12 位组成；自定义名与文本片段都会过滤 Windows 非法字符 `[\\/:*?"<>|]`。
- **字段兼容**：克隆响应音色 ID 取 **`output.voice_id || output.voice`**（先 `voice_id`，后 `voice` 只为兼容老数据）；列表项兼容 `voice` / `voice_id` 与 `target_model` / `targetModel`，并在 `fetchClonedVoices` 内统一补齐。
- **配置合并语义**：`voice:save-config` 只覆盖显式传入的字段——只存 `saveDir` 不会清空 API Key，设置页保存也不会覆盖 `saveDir`；历史载荷里的 `targetModel` **一律忽略**（模型不再是可配置项）。
- **落盘回执不撒谎**：存到自定义目录 / 音频输出目录时不再回写 `project.json`，`savedTo` 如实返回 `custom` / `output`；只有真正写入项目 `audio/` 才置 `project`。
- **容错风格**：`parseJsonLike` 解析失败返回 `null`；目录创建、`project.json` 回写、`readdirSync` 失败、临时文件删除均被吞掉，不阻断主流程；`ipcMain.handle` 内部一律 `try/catch` 转成 `{ ok:false, message }`。
- **项目根路径保持惰性求值（纯保险）**：`projectsRoot` 是函数，三处调用点都写成局部的 `const projectsRoot = projects.projectsRoot()`；**不要**把它提升成模块级常量、也不要在模块顶层调用它。
- **潜在注意点**：`voice:pick-dir` 在窗口为空时使用 `win as Electron.BrowserWindow` 断言（与 `PickAudio` 的显式 `null` 判断不一致）；`voice:synth` 的文件名未做重名检测，同一秒内同名可能覆盖。
- **类型集中在共享层**：全部 `voice:*` 载荷类型（`VoiceSaveDirPayload` / `VoiceSaveConfigPayload` / `VoiceCreatePayload` / `VoiceProfilePayload` / `VoiceProfileKeyPayload` / `VoiceSynthPayload` 等）都定义在 `src/shared/types.ts` ④ 节，本文件只 import。`voice:save-config` 的形参是联合类型 `VoiceSaveConfigPayload | { voiceTTS?: { apiKey?; targetModel? }; apiKey?; targetModel?; saveDir? }`，因为线上存在「带 `voiceTTS` 包装」与「裸配置对象」两种历史形态；**新写入一律走 `{ provider?, config }`**。
- **端点与 Key 一律按厂家取**：本文件已无任何写死的 `apiBase` / 克隆模型名 / 出厂默认模型常量；`providerFor()` 的优先级是「模型 → 系统音色 → active 厂家」。
- **不再有「厂家默认模型」设置**：用户在设置页只能填该厂家的 API Key；默认模型一律取 `voiceCatalog` 里的**出厂默认**（千问现在是 `qwen3-tts-flash`）。系统音色与模型是**固定绑定**，克隆音色用它创建/映射时绑定的模型；本地映射若绑着已不在目录里的模型，`resolveVoiceModel` / `ListSystemVoices` 都会忽略该绑定并按固定绑定回落。
- **跨厂家绑定一律显式报错、不静默兜底**：合成侧由 `synthOne` 开头的 `vendorMismatch()` 拦（`throw`）；保存侧由 `voice:save-profile` 拦（`{ ok:false, message }`）。**克隆音色不参与该校验**（`providerOfSystemVoice` 返回 `null`，其厂家信息在云端，按模型所属厂家处理）。
