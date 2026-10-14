# src/main/voiceCatalog.ts

> 语音服务目录：**按厂家（厂商）组织**的模型表与系统音色表，是「主进程 + 渲染层」共用的唯一数据来源。

- **所在目录**：src/main/
- **类型**：主进程数据目录模块（纯数据 + 查询函数；无 IPC、无副作用、不读配置）
- **规模**：104 行
- **对外导出**：
  - 接口：`VoiceProviderDef`
  - 常量：`VOICE_PROVIDERS`、`DEFAULT_PROVIDER_KEY`、`VOICE_MODELS`
  - 函数：`providerByKey`、`providerOfModel`、`providerOfSystemVoice`、`seriesDefaultModel`（**原 `isSystemVoiceOf` 已删除**——未被使用，`providerOfSystemVoice` 已覆盖该需求）

## 1. 作用与职责

为什么单独成文件（源码头注释）：模型与音色**天然属于某个厂家**（千问的模型只能配千问的 Key、跑千问的端点），散在 `voice.ts`（模型表）与 `systemVoices.ts`（音色表）里时看不出这层归属，界面上也就只能给一个平铺的「目标模型」下拉。这里把两者收进 `VoiceProviderDef`——**一家 = 一条记录**，含自己的 Key 提示 / 端点 / 克隆模型 / 默认合成模型 / 模型数组 / 音色数组。

加一家 TTS 厂家（如字节、MiniMax）：在 `VOICE_PROVIDERS` 里加一条即可；各请求函数都按「模型或音色所属的厂家」取 `apiBase` 与 `apiKey`（`voice.ts` 的 `providerOf*` 用法），不写死单一端点。渲染层通过 `voice:list-models` / `voice:get-config` 回带的 `providers`（`VoiceProviderView`）拿到同一份目录，因此**加厂家不需要改渲染层代码**。

> 与渲染层 LLM 侧的 `src/renderer/src/constants.ts` 的 `MODEL_PROVIDERS`（服务商预设表）同构：都是「按厂家组织 + 提供查询」。

## 2. `VoiceProviderDef` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 厂家键（配置里 `voice.active` 与 `voice.providers[<key>]` 用的就是它），当前只有 `'qwen'` |
| `label` | `string` | 展示名（`'千问（阿里云百炼）'`）；错误提示与下拉分组都直接用它 |
| `apiKeyHint` | `string` | API Key 输入框的占位提示（千问：`'sk-...（DASHSCOPE_API_KEY）'`） |
| `apiBase` | `string` | 该厂家的 HTTP 基址，**所有端点都拼在它后面**（千问：`https://dashscope.aliyuncs.com/api/v1`） |
| `enrollModel` | `string` | **该厂家的克隆（voice enrollment）模型名**（注释原文：「克隆（voice enrollment）用的模型名（如 Qwen-Audio-TTS 的 voice-enrollment）」）——千问：`'voice-enrollment'`（记录里另注明「Qwen-Audio-TTS/CosyVoice 系列，请勿修改」）。**原 `enrollModelAudio` 字段已随 vc 系列一并删除**：创建 / 列表 / 删除三个接口现在共用这一个模型名 |
| `defaultModel` | `string` | 该厂家的**出厂默认合成模型**——只在「既没有系统音色固定绑定、也没有克隆音色映射/云端 `target_model`」时兜底；**不再是用户可改的设置项**。千问：`'qwen3-tts-flash'` |
| `models` | `VoiceModel[]` | 该厂家的候选合成模型表（`role` 区分克隆 / 系统音色，见下） |
| `voices` | `SystemVoice[]` | 该厂家的内置系统音色表（千问引用 `systemVoices.ts` 的 `SYSTEM_VOICES`） |

## 3. 数据

**`QWEN_MODELS`（模块私有，本轮由 4 条收口为 2 条；注释写明「分两类，用途完全不同」）**

| `id` | `role` | 其它字段 |
| --- | --- | --- |
| `qwen3-tts-flash` | `system` | `label: '千问3-TTS-Flash'`、`series: 'flash'`、**`isDefault: true`** |
| `qwen-audio-3.0-tts-flash` | `clone` | `label: 'qwen-audio-3.0-tts-flash（语音复刻，本地文件 / 公网 URL 均可）'`、`input: 'url'`、`group: '语音复刻（克隆音色合成）'` |

**两类模型的语义（源码注释要点）**：

- **`role: 'system'` = 系统音色的合成模型**（**系统音色与它是固定绑定**）：`qwen3-tts-flash` 实测 HTTP 200 ✓（Cherry / Momo / Jennifer… 均通过）；`qwen3-tts-flash-realtime` 存在但不支持 HTTP 调用（400 `current user api does not support http call`）；`qwen3-tts-instruct-flash` / `qwen-tts` 实测 404「Model not exist」，**已移除**。
- **`role: 'clone'` = 创建克隆音色时的「目标模型」**（注释段本轮重写）：`qwen-audio-3.0-tts-flash`（Qwen-Audio-TTS / CosyVoice）是 **2026-10-14 收口后唯一**的复刻通道——
  1. 创建走 `voice-enrollment` 的 `action=create_voice`，`input.url` 收公网音频 URL，也**直接收 `data:audio/...;base64`**（实测：15 秒本地 wav 转 data URI → HTTP 200，且用该音色合成出真 mp3），所以本地文件不必先传到公网；
  2. 合成走 `SpeechSynthesizer`，**响应是 JSON + `output.audio.url`（不是音频流）**，必须二次下载——见 [`voice.ts`](./voice.ts.md) 的 `synthOne`。
- **已删除的两条（源码注释：用户确认「vc 这条线彻底清掉」，2026-10-14）**：

| 曾有的条目 | 删除原因（源码注释） |
| --- | --- |
| `qwen3-tts-vc-2026-01-22`（Qwen-TTS / vc 系列，`input: 'file'`） | 官方已下线该复刻模型（合成报「Model not exist」），留着只会让人选到一个必然失败的目标模型；它对应的 `enrollModel: 'qwen-voice-enrollment'`、创建分支（`audio.data`）与列表 / 删除接口也已一并从 `voice.ts` 移除 |
| 同 id 的 `qwen3-tts-flash`（当时只把 `role` 标成 `clone`） | 用来验证「平台按登记时的 `target_model` 授权」这条猜测；既然本地文件已能在 `qwen-audio` 上跑通，这条实验路径失去意义 |

> 因此 `role: 'clone'` 下**只剩一条**，也不再存在「同 id 两条、标签不同」的历史形态；`providerOfModel` / `modelKnownFor` / `voice:save-profile` 的按 id 查询与 `seriesDefaultModel` 的按 series 推导都只面对这两条数据。

**常量与来源**

| 名称 | 说明 |
| --- | --- |
| `VOICE_PROVIDERS` | `VoiceProviderDef[]`，当前只有 `QWEN` 一条 |
| `DEFAULT_PROVIDER_KEY` | `= QWEN.key`（`'qwen'`）——配置里 `active` 为空 / 指向未知厂家时的兜底厂家 |
| `VOICE_MODELS` | `VOICE_PROVIDERS.flatMap((p) => p.models)`：**跨厂家平铺**的全量模型（现共 2 条），供「按 id 找模型」或平铺展示使用 |
| 系统音色表 | 直接引用 `./systemVoices` 的 `SYSTEM_VOICES`（**该文件现在只有这一个导出**：原 `isSystemVoice()` 已删除，判定统一走本模块的 `providerOfSystemVoice()`） |

## 4. 查询函数

| 函数 | 签名 | 语义 |
| --- | --- | --- |
| `providerByKey(key?)` | `(string?) => VoiceProviderDef` | 按 key 找厂家；空 / 未知 → **兜底 `VOICE_PROVIDERS[0]`**（不返回 `null`） |
| `providerOfModel(modelId?)` | `(string?) => VoiceProviderDef` | 某个**合成模型**属于哪家（遍历各厂家 `models` 找 `id`）；找不到同样兜底第一个厂家 |
| `providerOfSystemVoice(voice?)` | `(string?) => VoiceProviderDef \| null` | 某个**内置系统音色**属于哪家；不是内置音色（如克隆音色）或入参为空 → **返回 `null`**，由调用方按 active 厂家处理 |
| ~~`isSystemVoiceOf(provider, voice?)`~~ | — | **已删除**（未被使用）：判断「该音色是否属于指定厂家的内置音色表」直接用 `providerOfSystemVoice(voice)?.key === provider.key` 即可 |
| `seriesDefaultModel(provider, series?)` | `(VoiceProviderDef, string[]?) => string` | 系统音色按 `series` 顺序找第一个「同 series 且 `role === 'system'`」的模型 id；都没有 → 该厂家的 `defaultModel`。**替代原先写死在 `voice.ts` 的 `SYSTEM_SERIES_MODEL` 映射** |

## 5. 注意事项与实现要点

- **数据只有这一处**：`voice.ts` 已删除本地的 `VOICE_API_BASE` / `VOICE_ENROLL_MODEL` / 本地 `VOICE_MODELS` / `SYSTEM_SERIES_MODEL`，端点、Key 提示、克隆模型名、默认模型一律从厂家记录取；`settings.ts` 的出厂默认（`defaultVoiceProviders()`）也按 `VOICE_PROVIDERS` 生成空配置。
- **兜底策略分两种**：`providerByKey` / `providerOfModel` **永不返回 null**（未知一律回第一个厂家，保证调用方拿到可用的端点与 Key 槽位）；`providerOfSystemVoice` **会返回 `null`**，因为「克隆音色不属于任何厂家的内置表」是正常情形，需要调用方改走 active 厂家。
- **`enrollModel` 只剩一个名字且标注「请勿修改」**：`voice-enrollment` 是百炼侧的固定克隆模型名，改动会让创建 / 列表 / 删除三个接口一起失败；`voice:create`、`fetchClonedVoices`、`voice:delete-cloud` 都直接取 `provider.enrollModel`（**`enrollModelAudio` 已不存在**）。
- **`seriesDefaultModel` 的推导代替硬编码**：新增系统音色模型时，只要 `series` 与音色表对得上就能自动成为该 series 的默认模型，不用再维护第二张映射表。
- **`input` 只剩 `'url'` 一档（千问）**：`file` 档留在类型里给将来「只收本地文件」的厂家用；对 `input: 'url'` 的模型，本地文件由主进程裁成 15 秒 wav 后转成 data URI 走同一个 `url` 字段（官方文档只写「公网可访问的 URL」，实测 data URI 同样可用）。
- **无 IPC、无副作用**：本文件不注册任何频道，也不读 `settings.json`；`voice:list-models` / `voice:get-config` 的 `providers` 字段由 `voice.ts` 从这里的 `VOICE_PROVIDERS` 转成 `VoiceProviderView` 后回给渲染层。
- **与 `voice.ts` 的输入方式联动**：模型的 `input` 字段是渲染层显示 URL 输入框的元数据来源之一（渲染层实际按模型 id 正则判定，见 [TextTtsPage.md](../renderer/src/pages/TextTtsPage.md) §5），主进程则以 `isAudioTtsModel()`（`/^qwen-audio-.*-tts/i`）为**「能不能作复刻目标模型」的唯一判据**——两处同一条判据。
