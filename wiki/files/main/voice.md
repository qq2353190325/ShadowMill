# src/main/voice/

> **语音域**（「配音」页 ·「字幕生成」页 ·「设置」页 · 语音服务）的**目录模块**：一页覆盖 `src/main/voice/` 下 10 个文件——厂家目录、内置系统音色表、语音接口层、克隆参考音频、能量 VAD、字幕逐句对齐，以及两组 `voice:*` IPC 与一个只做装配的 `register.ts`、一个只做再导出的 `index.ts`。**全部 19 条 `voice:*` 频道**（16 条配置 / 克隆 / 合成 + 3 条对齐）都在这个目录里，但**频道名与载荷一个都没变**

- **所在目录**：`src/main/voice/`（**同名目录 + `index.ts` 出口**，与 `cast/`、`projects/`、`agent/`、`updater/` 同一套约定；拆法见根 `AGENTS.md` 关键约定 9）
- **类型**：主进程业务域（HTTP 调厂家接口 + 调内置 ffmpeg/ffprobe + 落盘 + IPC）+ 数据目录 + 零依赖纯函数
- **规模**：**10 个文件、合计 1492 行、最长 338 行**（`catalog.ts` 104 / `systemVoices.ts` 62 / `api.ts` 241 / `cloneAudio.ts` 71 / `vad.ts` 122 / `ttsAlign.ts` 338 / `ipc/voices.ts` 306 / `ipc/tts.ts` 186 / `register.ts` 12 / `index.ts` 50；实测 `[IO.File]::ReadAllLines`）
- **对外导出**：`index.ts` 扁平再导出 **25 个值 + 4 个类型**（无重名），外部一律 `import * as voice from './voice'`；`ttsAlign` 的 `register` 与语音域的 `register` 重名，出口按 **`registerAlign`** 暴露
- **目录级一篇**：本篇即 `src/main/voice/` 的唯一说明文档——**内部怎么分文件对外不可见**，调用方不要 `import './voice/api'` 这种子文件路径（唯一例外见 §6：`settings.ts` 直接引 `./voice/catalog`）

## 1. 作用与界面位置

先把界面上的三块认清楚，再看代码：

| 界面上的位置 | 背后是本目录的哪份文件 |
|---|---|
| 「配音」页 · 文字生音频（音色下拉 / **我的音色**列表 / **克隆音色** / 保存位置 / 「合成」并试听） | `ipc/voices.ts`（配置 / 列表 / 映射 / 扫描）、`ipc/tts.ts`（`voice:create` / `voice:synth`）、`api.ts`（`synthOne`）、`cloneAudio.ts`（本地参考音频裁剪） |
| 「配音」页 · 音色管理（系统音色 + 克隆音色一张列表、**音色映射管理**、删云端音色） | `ipc/voices.ts`（`list-*` / `get-profiles` / `save-profile` / `delete-profile` / `delete-cloud`）、`catalog.ts`（厂家与音色表）、`systemVoices.ts`（48 条内置音色） |
| 「设置」页 · 语音服务（按厂家的 API Key + 全局保存目录） | `ipc/voices.ts`（`get-config` / `save-config` / `get-save-dir` / `pick-dir`）、`catalog.ts`（Key 提示 `apiKeyHint` 的来源） |
| 「字幕生成」页 · 字幕配音（**两种模式**：重排字幕 / 修正音频；最小停顿；「开始对齐」+ 进度条 + 取消） | `ttsAlign.ts`（`voice:synth-aligned` / `voice:align-cancel` / `voice:align-progress`） |
| 主进程启动时的注册顺序（`voice.register(ctx)` → `voice.registerAlign(ctx)`） | `register.ts`（只调两个 `registerXxxIpc`）、`ttsAlign.ts` 的 `register` |
| 「字幕生成」页的转录链路里裁掉起止静音 | `vad.ts`（被 `whisper.ts` 复用，不注册 IPC） |

### 1.1 一个音色从哪来、最后用哪个模型

音色有三条来源、模型有一条三级解析链——这三件事撑起了整个语音域：

| 来源 | 存在哪 | 合成时用哪个模型 |
|---|---|---|
| **内置系统音色**（48 条，如 `Cherry`） | `systemVoices.ts` 的常量表 → 挂到 `catalog.ts` 的千问厂家下 | 本地映射（`voiceProfiles`）绑定且模型仍在厂家模型表里 → 用它；否则按音色 `series` 推该厂家的系统合成模型 |
| **克隆音色**（`custom:xxx`，云端） | 云端账号里；本地只存映射与显示名 | 本地映射 → 云端 `target_model` → 当前厂家的出厂默认模型 |
| **模型自身的默认** | `catalog.ts` 的 `defaultModel` | 千问 = `qwen3-tts-flash`（**不是用户可改的设置项**） |

**为什么是三级解析**（源码注释口径）：本地映射最准（用户手动绑过），但它可能指向**已下线 / 不存在的模型**——那样的映射被忽略，否则合成必然 404「Model not exist」；系统音色与系统合成模型是**固定绑定**，按 `series` 推即可；最后才落到厂家出厂默认。

### 1.2 为什么按厂家组织（`catalog.ts` 的存在理由）

模型与音色**天然属于某个厂家**：千问的模型只能配千问的 Key、跑千问的端点。早先模型表在语音接口层、音色表在另一个文件，看不出这层归属，界面上也只能给一个平铺的「目标模型」下拉。现在收进 `VoiceProviderDef`——**一家 = 一条记录**（Key 提示 / 端点 / 克隆模型 / 出厂默认模型 / 模型表 / 音色表），加一家 TTS 厂家只需在 `VOICE_PROVIDERS` 里加一条，渲染层通过 `voice:list-models` 回带的 `providers` 拿到同一份目录，**加厂家不用改渲染层**。

## 2. 目录结构（10 个文件）

| 文件 | 行数 | 一句话职责 | 依赖谁 |
|---|---|---|---|
| `catalog.ts` | 104 | **厂家目录**：一家 = 一条记录（Key 提示 / 端点 / 克隆模型 / 出厂默认模型 / 模型表 + 音色表）+ 四个查询函数 | `./systemVoices`、`../../shared/types`（类型）——**数据最上游** |
| `systemVoices.ts` | 62 | **Qwen-TTS 内置系统音色表**（48 条纯数据，`catalog` 的数据源） | `../../shared/types`（仅类型） |
| `api.ts` | **241** | **接口层**：厂家解析 / 跨厂家校验 / 错误文案 / 音色→模型解析 / 克隆音色列表 / 单次合成 `synthOne` | `./catalog`、`../settings`、`../projects`、`../../shared/errors`、`electron`（`userData` 路径） |
| `cloneAudio.ts` | 71 | **克隆参考音频**：本地文件 → 前 15 秒 / 24 kHz / 单声道 `pcm_s16le` wav（临时文件） | `../hfEnv`（`BUILTIN_RESOURCES` 的 ffmpeg / ffprobe）、`electron`（temp 目录） |
| `vad.ts` | 122 | **能量 VAD**：WAV 采样读取 + 起止静音裁剪（零依赖纯函数，whisper 与测试脚本共用） | `node:fs`（**只读文件**） |
| `ttsAlign.ts` | **338** | **字幕配音逐句对齐**：逐句合成 → 量时长 → 两种模式重建时间轴 → 装配整轨 + `synth-aligned` / `align-cancel` | `./api`、`../projects`（`parseSubtitle`）、`../hfEnv`、`../runtime`、`electron` |
| `ipc/voices.ts` | 306 | **配置 / 目录 / 音色管理 14 条** `voice:*` 频道 | `../api`、`../catalog`、`../settings`、`../projects`、`electron`（`dialog`） |
| `ipc/tts.ts` | 186 | **真去调接口的 2 条**：`voice:create`（克隆音色）/ `voice:synth`（合成落盘） | `../api`、`../cloneAudio`、`../projects` |
| `register.ts` | 12 | **只做装配**：`registerVoicesIpc(ctx)` → `registerTtsIpc()` | `./ipc/voices`、`./ipc/tts` |
| `index.ts` | 50 | **统一出口**：把上面各文件的具名导出扁平再导出（25 个值 + 4 个类型），**只再导出、不写逻辑** | 上面各文件的出口名字 |

**依赖方向（无环）**：`catalog` 与 `api` 在最上游（`api → catalog`），`ipc/*` 在最下游（`ipc/* → api / catalog`）；`cloneAudio` 只依赖 `hfEnv`；`vad` 零依赖；`ttsAlign → api`。所以读的顺序是 `catalog` → `systemVoices` → `api` → 其余。

## 3. 统一出口：`index.ts`

**外部只从 `'.../voice'` 取**——`src/main/index.ts` 写 `import * as voice from './voice'`，`whisper.ts` 写 `import { readWavSamples, vadTrimSegments, type VadSegment } from './voice'`。文件头注释把约定与目录分工都写死了（含「本文件只做再导出，不写任何逻辑」）。

### 3.1 扁平再导出的 29 个名字（25 个值 + 4 个类型）

| 来源 | 导出 |
|---|---|
| `register.ts`（1） | `register` |
| `ttsAlign.ts`（4 + 1 类型） | `registerAlign`（= `ttsAlign` 的 `register`）、`fmtTime` / `planModeA` / `planModeB` / `buildTrack`，类型 `AlignSeg` |
| `api.ts`（10） | `isAudioTtsModel` / `getVoiceApiError` / `parseJsonLike` / `voiceFriendlyError` / `nowStamp` / `guessAudioExt` / `resolveTtsDir` / `resolveVoiceModel` / `fetchClonedVoices` / `synthOne` |
| `catalog.ts`（7 + 1 类型） | `VOICE_PROVIDERS` / `DEFAULT_PROVIDER_KEY` / `VOICE_MODELS` / `providerByKey` / `providerOfModel` / `providerOfSystemVoice` / `seriesDefaultModel`，类型 `VoiceProviderDef` |
| `vad.ts`（2 + 2 类型） | `readWavSamples` / `vadTrimSegments`，类型 `VadWav` / `VadSegment` |

出口代码就是这个形状（**别名与再导出两段，逐字**）：

```ts
export { register } from './register'
export { register as registerAlign } from './ttsAlign'
```

（其余是 `export { … } from './api'` / `'./catalog'` / `'./vad'` / `'./ttsAlign'` 四条，外加 `export type { … }` 三条。）

### 3.2 这条出口的三条规矩

1. **具名导出原样挂、不改名**：所以「五个单文件收成一个目录」时调用方几乎一行都不用动——`main/index.ts` 的 `import * as voice from './voice'` 原样解析到目录的 `index.ts`，`voice.register(ctx)` 一字未改。
2. **只重名的那一个用别名**：`ttsAlign.ts` 自己也有 `register(ctx?)`（注册 `voice:synth-aligned` / `align-cancel`），与语音域的 `register` 撞名，出口把前者暴露成 **`registerAlign`**——于是从 `main/index.ts` 里删掉了一行 `import * as ttsAlign from './ttsAlign'`，改成 `voice.registerAlign(ctx)`。
3. **出口不写逻辑、不注册 IPC**：`register.ts` 才是装配点；出口只搬名字。

### 3.3 特意**没有**上出口的东西

| 名字 | 为什么不上出口 |
|---|---|
| `SYSTEM_VOICES`（`systemVoices.ts`） | 只被 `catalog.ts` 引用；「是不是内置音色」一律问 `providerOfSystemVoice()`，不需要把整张表暴露出去 |
| `activeProviderDef` / `providerFor` / `modelKnownFor` / `voiceNoKeyFail` / `systemVoiceDefaultModel`（`api.ts`） | 是 `api.ts` 自己与 `ipc/*` 之间的内部契约；外部（`main/index.ts`、`whisper.ts`）不需要 |
| `CLONE_SECONDS` / `CLONE_PREFIX_MAX` / `makeCloneSample` / `errMsg`（`cloneAudio.ts`） | 只服务 `voice:create` 一条频道 |
| `AlignProgressPayload` 等类型 | 定义在 `src/shared/types.ts`，不走本目录出口 |

## 4. 分文件说明

### 4.1 `catalog.ts` —— 厂家目录

**定位**：按厂家组织的模型表与系统音色表，是「主进程 + 渲染层」共用的**唯一数据来源**；纯数据 + 查询函数，**无 IPC、无副作用、不读配置**。

#### 4.1.1 导出清单与契约（7 个值 + 1 个类型）

| 名称 | 签名 | 语义 |
|---|---|---|
| `VoiceProviderDef`（接口） | — | 一家 = 一条记录：`key` / `label` / `apiKeyHint` / `apiBase` / `enrollModel` / `defaultModel` / `models` / `voices` |
| `VOICE_PROVIDERS` | `VoiceProviderDef[]` | 厂家目录，当前只有千问一条 |
| `DEFAULT_PROVIDER_KEY` | `string` | `= QWEN.key`（`'qwen'`）：配置里 `active` 为空 / 指向未知厂家时的兜底 |
| `VOICE_MODELS` | `VoiceModel[]` | `VOICE_PROVIDERS.flatMap((p) => p.models)`：**跨厂家平铺**的全量模型（现 2 条） |
| `providerByKey(key?)` | `(string?) => VoiceProviderDef` | 按 key 找厂家；空 / 未知 → **兜底 `VOICE_PROVIDERS[0]`**（不返回 `null`） |
| `providerOfModel(modelId?)` | `(string?) => VoiceProviderDef` | 某模型属于哪家；找不到同样兜底第一个厂家 |
| `providerOfSystemVoice(voice?)` | `(string?) => VoiceProviderDef \| null` | 某内置**系统音色**属于哪家；**不是内置音色（如克隆音色）或入参为空 → `null`**，由调用方改走 active 厂家 |
| `seriesDefaultModel(provider, series?)` | `(VoiceProviderDef, string[]?) => string` | 按 `series` 顺序找第一个「同 series 且 `role === 'system'`」的模型；都没有 → 该厂家的 `defaultModel` |

#### 4.1.2 关键字段与数据

`VoiceProviderDef` 里三个「不要改」的字段：

| 字段 | 千问的取值 | 说明 |
|---|---|---|
| `apiBase` | `https://dashscope.aliyuncs.com/api/v1` | 该厂家 HTTP 基址，**所有端点都拼在它后面** |
| `enrollModel` | `voice-enrollment` | 克隆（voice enrollment）模型名，源码注释写明「Qwen-Audio-TTS/CosyVoice 系列，**请勿修改**」；创建 / 列表 / 删除三个接口共用它 |
| `defaultModel` | `qwen3-tts-flash` | 出厂默认合成模型（**不再是用户可改的设置项**） |

千问的模型表 `QWEN_MODELS` 只有 **2 条**，两类用途完全不同：

| `id` | `role` | 其它字段 | 用途 |
|---|---|---|---|
| `qwen3-tts-flash` | `system` | `label: '千问3-TTS-Flash'`、`series: 'flash'`、`isDefault: true` | 系统音色的合成模型（**系统音色与它固定绑定**） |
| `qwen-audio-3.0-tts-flash` | `clone` | `input: 'url'`、`group: '语音复刻（克隆音色合成）'` | 创建克隆音色时的「目标模型」——**唯一**的复刻通道 |

#### 4.1.3 边界与依赖

- **兜底策略分两种**：`providerByKey` / `providerOfModel` **永不返回 null**（未知一律回第一个厂家，保证调用方拿到可用的端点与 Key 槽位）；`providerOfSystemVoice` **会返回 `null`**——「克隆音色不属于任何厂家的内置表」是正常情形。
- **`seriesDefaultModel` 是「代替硬编码映射」**：新增系统音色模型时只要 `series` 对得上就自动成为该 series 的默认模型，不用再维护第二张表。
- **只依赖两处**：`./systemVoices`（`SYSTEM_VOICES`）与 `../../shared/types` 的 `SystemVoice` / `VoiceModel` 类型；不读 `settings.json`、不注册频道。

### 4.2 `systemVoices.ts` —— 内置系统音色表

**定位**：一张**内置只读数据表**，描述 Qwen-TTS 非实时语音合成接口支持的系统预设音色（来源为官方 `voice` 参数清单）。无 IO、无 IPC、无函数。

| 名称 | 类型 | 说明 |
|---|---|---|
| `SYSTEM_VOICES` | `SystemVoice[]` | **本文件唯一的导出**，共 **48 条**；数组顺序即音色下拉的展示顺序 |

条目四字段（类型 `SystemVoice` 来自 `../../shared/types`）：`voice`（合成接口的 `voice` 参数，**必须与官方清单逐字一致**）/ `desc`（中文描述，含性别性格）/ `langs`（特色语种，单个字符串）/ `series`（支持该音色的模型系列数组）。

**数据分布（仍然成立）**：`series` 出现过的值共三个——`instruct-flash` / `flash` / `tts`：

| `series` 组合 | 条数 |
|---|---|
| `['instruct-flash', 'flash', 'tts']` | 4（`Cherry` / `Serena` / `Ethan` / `Chelsie`） |
| `['instruct-flash', 'flash']` | 20 |
| `['flash', 'tts']` | 3（`Jada` / `Dylan` / `Sunny`） |
| `['flash']` | 21 |

**`flash` 覆盖全部 48 条**（唯一全量系列）；`instruct-flash` 覆盖 24 条、`tts` 覆盖 7 条。`langs` 共 9 种取值：普通话 38 条、四川话 / 粤语各 2 条、上海话 / 北京话 / 南京话 / 陕西话 / 闽南语 / 天津话各 1 条。

**边界**：它是 `catalog.ts` 的数据源（千问厂家的 `voices` 字段），**不上 `index.ts` 出口**；「是不是内置音色」的判定不在本文件，统一走 `providerOfSystemVoice()`（精确全等、大小写敏感——含空格的 `Eldric Sage` / `Ono Anna` / `Radio Gol` 必须原样传）。当前千问只有 `qwen3-tts-flash` 一个 `role: 'system'` 模型且 `series: 'flash'`，而 `flash` 覆盖全部音色 ⇒ **所有系统音色目前都解析到 `qwen3-tts-flash`**，`instruct-flash` / `tts` 两个 series 值只作历史数据保留。

### 4.3 `api.ts` —— 接口层

**定位**：厂家解析（谁家的话走谁家的端点与 Key）、跨厂家校验、错误文案、音色→模型解析、克隆音色列表、单次合成。**只做纯逻辑与 HTTP——不注册任何 IPC**（频道在 `ipc/` 下，装配在 `register.ts`）。

#### 4.3.1 导出清单与契约（15 个）

| 名称 | 签名 / 要点 |
|---|---|
| `isAudioTtsModel(model)` | 判定是否 Qwen-Audio-TTS 系列，**也是「能不能作复刻目标模型」的唯一判据** |
| `activeProviderDef()` | 当前选中的厂家（`settings.getVoiceSettings().active`）；「克隆音色列表 / 删除云端音色」这类没有模型信息的调用用它 |
| `providerFor(voice?, model?)` | 解析出 `{ def, apiKey, defaultModel }`：**模型 → 厂家**最准，其次「系统音色所属厂家」，最后退回 active 厂家 |
| `modelKnownFor(provider, model?)` | 该模型 id 是否在**这个厂家的模型表**里（识别「映射绑的是已下线 / 不存在的模型」） |
| `getVoiceApiError(provider, apiKey)` | 没 Key 时回「未配置「<label>」的 API Key，请先到「设置」-「语音服务」填写并保存」，否则 `null` |
| `voiceNoKeyFail(msg)` | 回 `{ ok: false, message, needConfig: 'voice' }`——「没配 Key」是**配置类**错误，界面据此弹「去设置 / 取消」 |
| `parseJsonLike(text)` | `JSON.parse` 的容错包装，失败静默 `null` |
| `voiceFriendlyError(err, label)` | `friendlyError(err, { label, provider, baseUrl })` 的薄包装，并把 `detail` 以「（…）」追加回文案 |
| `nowStamp()` | 本地时间戳 `YYYYMMDD_HHmmss` |
| `guessAudioExt(url)` | 取末段（去 query、`decodeURIComponent`）匹配 `wav/mp3/m4a/mp4/aac/ogg/flac`，否则 `'wav'` |
| `resolveTtsDir(projectName, saveDir)` | 落盘目录解析（优先级见 4.3.2） |
| `systemVoiceDefaultModel(provider, v)` | 一行转调 `catalog.seriesDefaultModel(provider, v.series)` |
| `resolveVoiceModel(voiceKey, _ctx?)` | 音色 → 模型的三级解析（见 4.3.2） |
| `fetchClonedVoices(providerKey?)` | 云端克隆音色列表（单一接口 + 字段归一化） |
| `synthOne(text, voice, useModel)` | 单次合成**不落盘**，回 `{ buf, ext }`；`voice:synth` 与逐句对齐共用 |

`isAudioTtsModel` 的判定口径（逐字）：

```ts
export function isAudioTtsModel(model: string): boolean {
  return /^qwen-audio-.*-tts/i.test(String(model || ''));
}
```

#### 4.3.2 三条关键规则

1. **跨厂家一律显式报错、不静默兜底**：`vendorMismatch(voice, model)`（模块内私有）在音色与模型分属不同厂家时返回一句含两个厂家 label 的提示（并指路「音色管理 → 音色映射管理」改绑），`synthOne` 开头 `throw`，`voice:synth` 与逐句对齐两条路径都被拦下；克隆音色（`providerOfSystemVoice` 为 `null`）与任一侧为空时**放行**。
2. **`resolveVoiceModel` 三级**：① 本地映射 `voiceProfiles[key]`（也认去掉 `system:` / `custom:` 前缀的 `bare`）**且** `modelKnownFor(provider, targetModel)` 为真 → 用它（绑着已下线模型时忽略）；② 是系统音色 → 按其 `series` 取该厂家的系统合成模型；③ 兜底 `provider.defaultModel`。
3. **`resolveTtsDir` 四级**：`saveDir` → `projects/<projectName>/audio` → 最近项目（`scanProjects()[0]`）的 `audio/` → `userData/tts-output`。

#### 4.3.3 `fetchClonedVoices()` 与 `synthOne()`

- **列表**：`POST <apiBase>/services/audio/tts/customization`，body `{ model: provider.enrollModel, input: { action: 'list_voice', page_size: 100, page_index: 0 } }`；取 `output.voice_list`，按 `voice || voice_id` 去重并把 `voice` / `voice_id` / `target_model` / `targetModel` 四项补齐（历史数据两种字段都有）。失败回 `{ ok: false, message: voiceFriendlyError(e, '查询音色失败') }`。
- **合成**：**两个系列都是「接口 → `output.audio.url` → 二次下载」**：Qwen-Audio-TTS 走 `/services/audio/tts/SpeechSynthesizer`（body `input: { text, voice, format: 'mp3', sample_rate: 24000 }`，回的是 JSON、**不是音频流**，所以要把 `http://` 的 OSS 地址升到 `https://` 再下载一次）；其它（系统音色模型）走 `/services/aigc/multimodal-generation/generation`。两支都要求 `output.audio.url` 存在，否则抛「接口未返回音频地址（output.audio.url）」。

#### 4.3.4 边界与依赖

- **不注册 IPC、不 import `hfEnv`**：裁剪参考音频在 `cloneAudio.ts`（`api.ts` 不碰 ffmpeg）。
- **错误翻译不写在本文件**：十档判定在 `src/shared/errors.ts` 的 `friendlyError()`，这里只是薄包装；`detail` 拼回文案是**保留旧行为**（用户能据此报障），`needConfig` 由 `friendlyError` 判（语音链路的 label 含「语音 / 音色 / 合成」）。
- **依赖**：`./catalog`（厂家与查询）、`../settings`（Key / 映射）、`../projects`（项目目录与扫描）、`../../shared/errors`、`electron` 的 `app`（只用于 `userData/tts-output`）。

### 4.4 `cloneAudio.ts` —— 克隆参考音频

**定位**：把本地音频准备成「参考样本」——前 15 秒 / 24 kHz / 单声道 `pcm_s16le` wav。

```ts
const CLONE_SR = 24000;   // 与 Qwen-Audio-TTS 原生采样率一致
const CLONE_SECONDS = 15; // 截取的参考音频时长（官方推荐 10~20 秒清晰人声）
const CLONE_PREFIX_MAX = 10; // input.prefix 仅允许数字/英文字母且不超过 10 字符
```

| 导出 | 说明 |
|---|---|
| `CLONE_SECONDS` / `CLONE_PREFIX_MAX` | 上面两个常量（`CLONE_PREFIX_MAX` 是 `voice:create` 校验 `prefix` 的**唯一上限**） |
| `makeCloneSample(src)` | 本地音频 → 参考样本 wav，返回临时文件绝对路径（调用方 `finally` 里删） |
| `errMsg(e)` | 错误对象 → 消息串（`e.message` 优先），多处 `catch` 共用 |

**为什么先在本地裁**（源码注释）：`create_voice` 只用参考音频的前 `max_prompt_audio_length` 秒（3~30，默认 10），整段上传毫无意义，还会把 base64 请求体撑大——15 秒 24k 单声道 wav ≈ 700KB，比原文件直传小一个量级；**也正因为裁过，本地文件才能以 data URI 内联提交**（官方文档只写「要求公网可访问的 URL」，实测 data URI 同样返回 200）。

`makeCloneSample` 的步骤：① ffmpeg / ffprobe 任一缺失 → 抛「未找到内置 ffmpeg/ffprobe（运行环境包可能还没解包完成），无法裁取参考音频」（这两个路径来自 **ffmpeg 运行环境包**，本文件**不返回 `needPacks`**）；② `probeDuration` 量时长；③ `dur < 3` → 抛「参考音频太短（N.N 秒）：声音复刻要求 3~30 秒的清晰人声」；④ 输出到 `app.getPath('temp')/shadowmill-clone-<时间戳>.wav`；⑤ ffmpeg 参数 `-hide_banner -loglevel error -y -i <src> -vn -t 15 -ac 1 -ar 24000 -c:a pcm_s16le <out>`。

**边界**：只被 `ipc/tts.ts` 用，**不上 `index.ts` 出口**；`runProc` / `probeDuration` 是本文件的私有样板（`spawn` + `windowsHide: true`，参数数组不经 shell）。

### 4.5 `vad.ts` —— 零依赖纯函数 VAD

**定位**：WAV 采样读取与「能量 VAD 起止静音裁剪」，**零依赖纯函数**，供 `whisper.ts` 转录与 `test/vad-test.js` 共用。只允许 **erasable-only 语法**（无 `enum` / `namespace` / 参数属性），以便 Node 22+ 原生 type-stripping 直接跑测试。

| 导出 | 签名 | 说明 |
|---|---|---|
| `VadWav`（接口） | — | `{ rate, channels, samples: Int16Array }` |
| `VadSegment`（接口） | — | `{ start, end, text? }`（秒） |
| `readWavSamples(p)` | `(p: string) => VadWav \| null` | 读 16bit PCM WAV；读失败或格式不符回 `null` |
| `vadTrimSegments(samples, rate, segs)` | `(Int16Array, number, VadSegment[]) => VadSegment[]` | 就地调整段的 `start` / `end` 并返回段数组 |

**`readWavSamples` 的支持范围**：仅 `RIFF....WAVE` 且 ≥ 44 字节；**仅 16bit PCM**（其它位深一律 `null`，不重采样）；chunk 遍历找 `data`（奇数长度按 RIFF 规则补 1 字节对齐）；`dataLen` 截到文件尾防越界；`channels` / `rate` / `bits` 直接读固定偏移 **22 / 24 / 34**（隐含「`fmt ` 是第一个 chunk」）；**多声道不去交织**。

**`vadTrimSegments` 的参数**（函数开头按 `rate` 一次算出）：

| 参数 | 取值 | 含义 |
|---|---|---|
| `winN` | `Math.max(1, Math.round(rate * 0.02))` | 20ms 分析窗口样本数 |
| `rms[i]` | 窗口内 `Math.abs` 之和 / `winN` | 平均绝对幅度（**不是 dB、也不是平方根均方**） |
| `noiseFloor` | 幅度谱 10% 分位 | 噪声底 |
| `thr` | `Math.max(noiseFloor * 3, 200)` | 判定阈值；`200` ≈ -44dBFS 均值幅度，绝对兜底 |
| `leadSilWin` / `tailSilWin` | 0.4s / 0.15s 对应的窗口数 | 前导 / 尾随静音门槛（**不对称是有意为之**） |
| `padSec` | `0.1` | 起点提前量 / 终点尾垫（秒） |
| `minDur` | `0.25` | 裁剪后允许的最短段长（秒） |

**行为要点**：双向都要求「足够长的静音」才动那一侧（段首 ≥0.4s、段尾 ≥0.15s）；新起点夹在「原起点 ~ 上一段 end + 0.05s」之间、新终点夹在「语音结束 + 0.1s ~ 下一段 start − 0.05s」且不晚于原终点——**只收敛、不放大，相邻段至少留 0.05s**；段过短 / 全段低能量 / 裁后不足 `minDur` / 无变化，四种情况都**原样返回该段、绝不抛错**，调用方可无条件采用返回值。

**边界**：**就地修改**传入的段对象（要保留原时间的调用方必须先深拷贝）；`nWin < 2` 或 `segs` 为空时返回的就是入参数组本身；有背景音乐 / 持续噪声时阈值不生效（保持原时间），是设计上的保守行为、不是 bug。

### 4.6 `ttsAlign.ts` —— 字幕配音逐句对齐

**定位**：「字幕已生成、但要让它和配音严格对上」这一环：逐句 TTS → 统一转 wav → ffprobe 量时长 → 按模式重建时间轴 → 静音补齐 + concat 装配整轨 → 时长终验。

```ts
const MAX_RATE = 1.15; // atempo 加速上限（超过则顺延后续）
const EPS = 0.05;      // 槽位判定容差（秒，吸收 atempo 帧粒度误差）
const SR = 24000;      // 统一采样率（与 Qwen-Audio-TTS 原生一致）
const MIN_SLOT = 0.1;  // 模式 B 单调化时相邻句最小名义槽位（秒）
```

模块级状态：`alignRunning`（一次只允许一个对齐任务）、`alignCancelled`（取消标志，句间检查）。

#### 4.6.1 导出清单与数据结构

| 导出 | 说明 |
|---|---|
| `AlignSeg`（接口） | 对齐段：`index` / `text` / `subtitleStart` / `audioStart` / `audioDur` / `status`（`ok` / `accelerated` / `pushed`）/ `rate` / `delta` / `wavPath` |
| `fmtTime(sec)` | 秒 → `mm:ss`（四舍五入到秒、各段补零），与字幕侧的 `fmtTime` 口径一致 |
| `planModeA(taskDir, lines, durs, gap, offset)` | 模式 A 规划（同步纯计算），回 `{ segs, times }` |
| `planModeB(taskDir, lines, durs)` | 模式 B 规划（**异步**，含 atempo），回 `{ segs, times }` |
| `buildTrack(taskDir, segs, outPath)` | 装配整轨，回整轨实测时长 |
| `register(ctx?)` | 注册 `voice:align-cancel`（`on`）与 `voice:synth-aligned`（`handle`），进度经 `voice:align-progress` 回推；出口里叫 **`registerAlign`** |

#### 4.6.2 两种模式各解决什么问题

| 模式 | 载荷值 | 基准 | 结果 |
|---|---|---|---|
| **模式 A：音频驱动（重排字幕）** | `audio-driven` | 每句**实测时长** | 字幕时间被重排、音频原样拼接：首句起点取 `offset`（= 原首句时间戳，保留锚点），其后停顿 `g = max(gap, 字幕原间隔 − 前句实测时长)`——间隔放不下（或字幕没有时间线）才回落到最小停顿 `gap` |
| **模式 B：时间轴驱动（修正音频）** | `timeline-driven` | **字幕时间戳**为槽位 | 字幕时间为准、句间补静音：先做**单调化**（相邻至少 `MIN_SLOT`），`dur > slot + EPS` 时按 `min(dur / slot, MAX_RATE)` 做 atempo 并**重测时长** → 放得下标 `accelerated`；顶格仍放不下则标 `pushed`、`delta = dur − slot` 并把后续 `times` 全部平移（后续槽位差不变，故不会产生新溢出）；**末句无槽位（`Infinity`），不加速、不自发顺延** |

`mode` 的解析是白名单式：**只有严格等于 `'timeline-driven'` 才走模式 B**，其余（含缺省 / 非法值）一律 `audio-driven`。

#### 4.6.3 主流程与边界

1. **入口校验顺序**：`alignRunning` → `runtime.missingPacks(['ffmpeg'])`（缺包回 `{ ok:false, needPacks, message: '逐句对齐需要先下载运行环境（…）' }`，**不下载、不阻塞**）→ ffmpeg / ffprobe 路径存在性 → 字幕非空 → 音色非空 → `gapSec` 非有限取 `0.5` 并夹到 `[0, 10]` → `parseSubtitle` 非空 → `useModel = payload.voiceModel || resolveVoiceModel(voiceId, ctx)`。
2. **任务目录**：`<userData>/voice/align-<Date.now()>/`，下建 `raw/`（TTS 原始输出）、`seg/`（统一格式分段，`_v` 为变速产物）、`sil/`（句间静音）；成品 `<safeName>_aligned_<时间戳>.wav` 也在其中。每次任务开始调 `cleanupOldTasks(taskDir)`：删掉 `userData/voice` 下所有 `align-*` 且不等于本次目录的历史任务 ⇒ **只保留最近一次**。
3. **装配**：逐段与游标求差得静音长度（算法保证 ≥ 0、无重叠），差值 > 0.02s 时生成静音段写进列表；`concat.txt` 里路径经 `win2posix`（正斜杠 + 单引号包裹），ffmpeg 用 `-f concat -safe 0 -i <list> -c copy` **零重编码**拼接（前提是所有段同格式：24k 单声道 `pcm_s16le`）。
4. **终验**：`|totalDur − 末段终点| > 0.3s` → 回「音轨装配时长校验失败（期望 Xs，实际 Ys）」；0.3s 是给帧粒度毫秒漂移留的量（270s 级整轨常见 0.1~0.2s 偏差，真缺失段落会差出数秒）。
5. **取消**：`voice:align-cancel` 只置 `alignCancelled = true`（软中断，不杀进程）；检查点在**主循环每轮开头**与 `synthSentence` 入口，因此**正在进行的 HTTP 合成不会被中断**，取消延迟取决于当前句耗时；取消回 `{ ok:false, canceled: true, message: '已取消（已完成 i/N 句）' }`，临时目录不立即删（下次任务才回收）。
6. **进度**：发送前校验 `event.sender && !event.sender.isDestroyed()`；主进程只发 `synth` / `assemble` / `done` / `error` 四种 `stage`，**量时长阶段刻意不推进度**（避免界面闪现「量取第 N 句…」）。
7. **返回**：成功 `{ ok, mode, subtitleText, audioPath, totalDur, details }`——`subtitleText` 是 `[mm:ss] 文本`（秒级精度），`details` 是逐句明细（`segPath` 即 `wavPath`）。

**边界**：`ttsAlign.ts` 不碰克隆音色、不改 `settings.json`、不写 `project.json`（结果由渲染层决定是否写回项目）；它只从 `../runtime` 取「包是否就绪」的纯校验，不触发下载。

### 4.7 `ipc/voices.ts` —— 配置 / 目录 / 音色管理 14 条

**定位**：`voice:*` 里「读配置 / 读列表 / 选目录 / 管映射」这一组——**都不去真正合成**（合成与克隆在 `ipc/tts.ts`）。入口 `registerVoicesIpc(ctx)`，`getWindow` 取自 `ctx.getWindow`（缺省 `() => null`）。

| # | 频道 | 载荷 | 返回 | 行为要点 |
|---|---|---|---|---|
| 1 | `voice:get-config` | 无 | `{ ok, active, providers, saveDir }` | 按厂家回带配置（`providers` 每家**只有 `{ apiKey }`**）+ 全局 `saveDir` |
| 2 | `voice:get-save-dir` | `VoiceSaveDirPayload`（`{ saveDir?, defaultOut?, projectName? }`） | `{ ok, mode, saveDir }` | 解析并 `mkdirSync(recursive)`；`mode` = `output` / `custom` / `project` / `default`（配音页「打开目录」用） |
| 3 | `voice:save-config` | `VoiceSaveConfigPayload`（`{ provider?, config?: { apiKey? }, saveDir? }`，兼容历史 `{ voiceTTS }` 与裸 `{ apiKey, targetModel }`） | `{ ok, settings, voice }` | 两种用途：① 存**某厂家**的 Key（保存即把 `active` 切到该厂家）；② 只改全局**保存目录**（不动 Key、不切厂家）。**空载荷什么都不写**；历史 `targetModel` 一律忽略 |
| 4 | `voice:pick-audio` | 无 | 文件绝对路径 或 `null` | 标题写明「推荐 10~20 秒清晰人声，主进程会自动截取前 15 秒」；filters 收 `mp3/wav/m4a/aac/flac/ogg/wma/mp4/mov/mkv`（任何 ffmpeg 能解码的格式） |
| 5 | `voice:list-system-voices` | 无 | `{ ok, voices, total }` | **按厂家遍历**内置音色，每项附 `model` / `provider` / `providerLabel`；`model` 优先取本地映射，**但仅当绑定仍在厂家模型表里**，否则按固定绑定回落 |
| 6 | `voice:list-models` | 无 | `{ ok, models, providers }` | 下发跨厂家平铺的 `VOICE_MODELS` + 厂家目录 `providers`（`VoiceProviderView[]`：`key` / `label` / `apiKeyHint` / `defaultModel` / `models` / `voices`） |
| 7 | `voice:get-profiles` | 无 | `{ ok, profiles }` | 读本地音色映射 |
| 8 | `voice:save-profile` | `VoiceProfilePayload` | `{ ok, profiles }` 或 `{ ok:false, message }` | 保存时就拦跨厂家：`key`/`voice`/`targetModel` 缺 →「映射信息不完整」；两家不同 →「模型「x」属于「A」，而音色「y」属于「B」：两者必须同属一个厂家」；模型不在该厂家模型表 →「「B」的模型表里没有「x」」 |
| 9 | `voice:delete-profile` | `VoiceProfileKeyPayload`（`{ key }`） | `{ ok, profiles }` | 只删**本地**映射 |
| 10 | `voice:delete-cloud` | 内联 `{ voice?: string }` | `{ ok, voice, profiles }` 或 `{ ok:false, message }` | 删**云端**克隆音色（不可撤销）：`action: 'delete_voice'`；成功后顺手清本地映射；`VoiceNotFound` 单独提示，`not exist / not found / invalid` 也在报错时清映射 |
| 11 | `voice:list` | 无 | `{ ok, voices?, total?, message? }` | 等价于 `fetchClonedVoices()`（单一接口） |
| 12 | `voice:list-all` | 无 | `{ ok, voices, total, cloudMessage }` | 系统音色（跨厂家平铺）+ 克隆音色合并成统一 `{ key, type, name, voiceId, model }`（「音色即模型」下拉的数据源）；云端失败时 `cloudMessage` 带原因 |
| 13 | `voice:pick-dir` | 无 | `{ ok, dir }` 或 `{ ok:false, canceled: true }` | 目录选择框（`openDirectory` + `createDirectory`） |
| 14 | `voice:list-generated` | 无 | `{ ok, items, total }` | 扫三处音频：`userData/tts-output`（`音频输出目录`）→ 自定义保存目录（`自定义目录`）→ 各项目 `audio/`（`项目 · <名>`）；条目 `{ path, name, group, size, mtime }`，按 `mtime` 降序、按绝对路径去重 |

**合并音色列表的三级回退**（第 12 条）：系统音色 `model = resolveVoiceModel(key)`；克隆音色 `model = 本地映射 targetModel || 云端 target_model || resolveVoiceModel(key)`，`voiceId` 为空则跳过该条。

### 4.8 `ipc/tts.ts` —— 真去调接口的两条

**定位**：`voice:create`（创建克隆音色）与 `voice:synth`（文字合成并落盘）。入口 `registerTtsIpc()`。

| 频道 | 载荷 | 返回 | 流程要点 |
|---|---|---|---|
| `voice:create` | `VoiceCreatePayload`（`{ audioPath?, targetModel?, preferredName? }`） | `{ ok, voice, targetModel }` 或 `{ ok:false, message }` | 按**目标模型**定厂家（`useModel = payload.targetModel \|\| 当前厂家 defaultModel`，用哪家的 Key 由模型决定）→ 只认 `qwen-audio-*`（否则「模型「x」不支持音色复刻：请把「目标模型」选成 qwen-audio-* 系列…」）→ `audioPath` 三形态（本地绝对路径 / `http(s)`、`oss://` / `data:audio/` URI）→ `preferredName` 净化为 1~10 位 ASCII（否则「音色名称需 1~10 个字符，仅限数字、字母、下划线」）→ 本地文件先 `makeCloneSample` 裁 15 秒再转 `data:audio/wav;base64,…` → `POST <apiBase>/services/audio/tts/customization`，body `{ model: enrollModel, input }`，`input` 固定六项：`action: 'create_voice'` / `target_model` / `prefix` / `url` / `language_hints: ['zh']` / `max_prompt_audio_length: CLONE_SECONDS` → 只读 `output.voice_id`（缺则「接口未返回音色 ID（output.voice_id）」）→ **`finally` 删临时样本** |
| `voice:synth` | `VoiceSynthPayload`（`{ text?, voice?, targetModel?, projectName?, saveDir?, defaultOut?, audioName? }`） | `{ ok, savePath, projectName, savedTo, size }` 或 `{ ok:false, message }` | 校验文本 / 音色 → `providerFor(voice, useModel)` 取该厂家 Key（无 Key → `needConfig:'voice'`）→ `synthOne` → 目录三选一（`saveDir` → `defaultOut` → 项目 `audio/`）→ 文件名 `audioName` 或 `nowStamp()_文本前五字_音色尾12位`（都过滤 Windows 非法字符）→ 写盘 → **只有真写进项目 `audio/`** 才回写 `project.json` 的 `ttsAudio` 并回 `savedTo: 'project'` |

**边界**：`voice:create` 的「音频类报错」单独提示（服务端不接受参考音频是最常见原因，文案会提示换 3~30 秒清晰人声）；临时样本只在 `voice:create` 的 `finally` 里删；`voice:synth` 不做重名检测（同一秒同名可能覆盖，属已知小坑）。

### 4.9 `register.ts` —— 只做装配

12 行，唯一的 `register(ctx?)`：先 `registerVoicesIpc(ctx)`、再 `registerTtsIpc()`。

- **顺序与拆分前一致**（配置 / 目录 / 音色管理 → 克隆 / 合成），每个频道只注册一次。
- **注册顺序 ≠ 执行顺序**：两条合成链路（`voice:create` / `voice:synth`）什么时候跑由界面点击决定。
- `main/index.ts` 里两个注册的先后是 `voice.register(ctx)` → `voice.registerAlign(ctx)`（后者来自 `ttsAlign.ts`）。

### 4.10 `index.ts` —— 统一出口

50 行，**只有 `export … from`**：`register` / `registerAlign` + `api.ts` 10 个 + `catalog.ts` 7 个值 + 1 个类型 + `vad.ts` 2 个值 + 2 个类型 + `ttsAlign.ts` 4 个值 + 1 个类型。文件头注释记录 9 个子文件的一句话分工与依赖方向（`catalog` 与 `api` 最上游、`ipc` 最下游），并注明「**本文件只做再导出，不写任何逻辑**」。没上出口的名字见 §3.3。

## 5. 频道清单（16 + 2，另有 1 条推送）

`IPC.Voice` 共 19 条：**16 条**由本目录的 `ipc/` 注册（配置 / 目录 / 音色管理 14 + 克隆 / 合成 2），**2 条**对齐频道由 `ttsAlign.register` 注册，另 **1 条**进度推送。

| 分组 | 频道 | 注册处 |
|---|---|---|
| 配置 / 目录 / 音色管理（14） | `voice:get-config` / `voice:get-save-dir` / `voice:save-config` / `voice:pick-audio` / `voice:list-system-voices` / `voice:list-models` / `voice:get-profiles` / `voice:save-profile` / `voice:delete-profile` / `voice:delete-cloud` / `voice:list` / `voice:list-all` / `voice:pick-dir` / `voice:list-generated` | `ipc/voices.ts` |
| 克隆 / 合成（2） | `voice:create` / `voice:synth` | `ipc/tts.ts` |
| 逐句对齐（2 + 1 推送） | `voice:synth-aligned`（handle）/ `voice:align-cancel`（on）/ `voice:align-progress`（`event.sender.send`） | `ttsAlign.ts` 的 `register` |

**频道名与载荷零变化**：`shared/ipc.ts` 的 `IPC.Voice.*`、`preload` 的 `voiceTools.*`、`shared/types.ts` 的载荷类型全部原样，拆分前后**一个字节都没改**。

## 6. 依赖方向与调用点

```
catalog.ts ← systemVoices.ts
   ↑
 api.ts ──→ settings / projects / shared/errors
   ↑
 ipc/voices.ts、ipc/tts.ts（ipc/tts.ts 另 → cloneAudio.ts → hfEnv）

ttsAlign.ts ──→ api.ts / projects（parseSubtitle）/ hfEnv / runtime
vad.ts ── 零依赖（只读文件）
register.ts ──→ ipc/voices + ipc/tts
index.ts ──→ 上面各文件的出口名字（只再导出）
```

| 外部调用点 | 用到的导出 | 说明 |
|---|---|---|
| `src/main/index.ts` | `voice.register(ctx)` / `voice.registerAlign(ctx)` | `import * as voice from './voice'` 一行未改；删掉的是 `import * as ttsAlign from './ttsAlign'` 那一行与 `ttsAlign.register(ctx)` 那次调用 |
| `src/main/whisper.ts` | `readWavSamples` / `vadTrimSegments` / `type VadSegment` | 转录前裁起止静音（失败静默跳过，不阻断转录） |
| `src/main/settings.ts` | `DEFAULT_PROVIDER_KEY` / `providerByKey` / `type VoiceProviderDef` | **唯一直接引子文件的调用方**（`./voice/catalog`）：语音配置与改名判定要厂家目录，不走整域出口 |
| `src/preload/index.ts` | — | 暴露 `window.voiceTools.*`（方法名与频道一一对应，零改动） |
| 渲染层 | — | `TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue` + `helpers.ts`、`SettingsPage/components/VoiceSection.vue` 等，只经 preload 调频道 |
| `test/vad-test.js` | 动态 import `../src/main/voice/vad.ts` | 靠 erasable-only 语法在 Node 22+ 直接运行 |

**依赖方向必须单向**：`catalog` / `api` 在上游，`ipc/*` 在下游，`ttsAlign → api`、`cloneAudio → hfEnv`、`vad` 零依赖——**无环**；`main/index.ts` 顶部注释的权威描述是 `settings ← agent(chat ← html/script) ← projects ← voice(catalog ← api ← ipc)`、`hfEnv ← projects, voice, whisper, video, runtime`、`updater ← settings`。

## 7. 合并后的注意事项（原五篇里仍然成立的条款）

- **错误文案只有一处映射表**：外部服务报错一律经 `shared/errors.friendlyError()` 的薄包装 `voiceFriendlyError()`；**余额 / 欠费刻意不给 `needConfig`**（去设置修不了余额），而「没配 Key」这种本地校验不过异常，由 `voiceNoKeyFail()` 直接给 `needConfig: 'voice'`。四个 `catch` 的 label 是「创建音色失败 / 合成语音失败 / 查询音色失败 / 删除云端音色失败」。
- **跨厂家绑定一律显式报错、不静默兜底**：合成侧 `synthOne` 开头 `vendorMismatch` 抛错；保存侧 `voice:save-profile` 返回 `{ ok:false, message }`；**克隆音色不参与该校验**（厂家信息在云端，按其模型所属厂家处理）。
- **请求头与编码**：全部 `Content-Type: application/json` + `Authorization: Bearer <apiKey>`；克隆音频以 **data URI 内联进 `input.url`**；**没有** `AbortController` / 超时 / 重试逻辑（源码如此）。
- **端点与 Key 一律按厂家取**：本目录**没有**写死的 `apiBase` / 克隆模型名 / 出厂默认模型常量（唯一写死的地方是 `catalog.ts` 的厂家记录）；`providerFor()` 的优先级是「模型 → 系统音色 → active 厂家」。
- **不再有「厂家默认模型」设置**：设置页只能填各厂家的 API Key；模型表在 `catalog.ts`，系统音色与模型是**固定绑定**；映射绑着已下线模型时 `resolveVoiceModel` / `list-system-voices` 都会忽略它并回落。
- **落盘回执不撒谎**：存到自定义目录 / 音频输出目录时**不**回写 `project.json`，`savedTo` 如实回 `custom` / `output`；只有真写进项目 `audio/` 才置 `project`。
- **`projectsRoot` 必须惰性求值**：`api.ts` 的 `resolveTtsDir`、`ipc/voices.ts` 的 `list-generated`、`ipc/tts.ts` 的 `synth` 三处都写成局部的 `const projectsRoot = projects.projectsRoot()`，**不要**提升成模块级常量。
- **ffmpeg / ffprobe 来自运行环境包**：`cloneAudio.ts` 与 `ttsAlign.ts` 都取 `hfEnv.BUILTIN_RESOURCES`；只有 `ttsAlign` 在入口做 `runtime.missingPacks(['ffmpeg'])` 并回 `needPacks`（可取消、不阻塞），`cloneAudio` 只报「未找到内置 ffmpeg/ffprobe…」。
- **统一音频格式是零重编码拼接的前提**：`ttsAlign` 的分段 / 静音 / 变速产物一律 24k 单声道 `pcm_s16le`；`atempo` 后必须重新量时长（`EPS = 0.05` 吸收帧粒度误差）。
- **`vad.ts` 的语法受限**：新增代码必须保持 erasable-only（不得引入 `enum` / `namespace` / 构造函数参数属性），否则 `test/vad-test.js` 与 `src/agent` 那套写法就跑不起来。
- **纯数据 / 纯函数不碰副作用**：`catalog.ts` / `systemVoices.ts` / `vad.ts` 不读配置、不注册 IPC、不写文件，可被主进程任意模块安全引用。
- **改本目录必须同步的两处清单**：`shared/ipc.ts` 的 `IPC.Voice`（19 条）与 `preload/index.ts` 的 `voiceTools.*`（方法名对应）；只改实现、不动频道名与载荷。
