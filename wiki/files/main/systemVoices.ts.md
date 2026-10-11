# src/main/systemVoices.ts

> Qwen-TTS 内置系统音色表与系统音色判定

- **所在目录**：src/main/
- **类型**：静态数据表模块
- **规模**：63 行
- **对外导出**：`SYSTEM_VOICES`、`isSystemVoice`

## 1. 作用与职责

本模块是一张**内置只读数据表**，描述 Qwen-TTS 非实时语音合成接口支持的系统预设音色，来源为官方 `voice` 参数清单。它本身不做任何 IO，也不注册 IPC，只提供：

1. `SYSTEM_VOICES`：48 条系统音色定义，渲染层据此把音色下拉分为「系统音色」与「自定义音色」两类；
2. `isSystemVoice(voice)`：按 `voice` 参数快速校验某个音色是否为内置系统音色。

表中的 `voice` 字段直接作为合成接口的 `voice` 参数值，因此**必须与官方清单逐字一致**。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SYSTEM_VOICES` | `SystemVoice[]` | 内置系统音色常量数组，共 48 条；数组顺序即音色下拉的展示顺序 |
| `isSystemVoice` | `(voice: string) => boolean` | 用 `SYSTEM_VOICES.some((v) => v.voice === voice)` 做精确全等匹配 |

条目类型 `SystemVoice` 来自 `../shared/types`，四个字段均为必填：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `voice` | `string` | 音色标识，作为合成接口的 `voice` 参数，如 `Cherry` |
| `desc` | `string` | 中文描述，含性别与性格说明，如 `阳光积极、亲切自然小姐姐（女性）` |
| `langs` | `string` | 特色语种，如 `普通话`、`粤语` |
| `series` | `string[]` | 支持该音色的模型系列列表 |

`isSystemVoice` 的实现只有一行：

```ts
function isSystemVoice(voice: string): boolean {
  return SYSTEM_VOICES.some((v) => v.voice === voice);
}
```

## 3. 数据分布

### 3.1 覆盖的模型系列

`series` 中出现过的系列共三个：`instruct-flash`、`flash`、`tts`。按系列组合统计如下：

| `series` 组合 | 条数 | 代表音色 |
| --- | --- | --- |
| `['instruct-flash', 'flash', 'tts']` | 4 | `Cherry`、`Serena`、`Ethan`、`Chelsie` |
| `['instruct-flash', 'flash']` | 20 | `Momo`、`Moon`、`Eldric Sage`、`Neil`、`Stella` |
| `['flash', 'tts']` | 3 | `Jada`、`Dylan`、`Sunny` |
| `['flash']` | 21 | `Jennifer`、`Ryan`、`Bodega`、`Sohee`、`Rocky` |

要点：

- **`flash` 覆盖全部 48 条**，是唯一全量系列；
- `instruct-flash` 覆盖 24 条，`tts` 覆盖 7 条。

### 3.2 覆盖的语种

`langs` 共出现 9 种取值，以普通话为主：

| `langs` | 条数 | 代表音色 |
| --- | --- | --- |
| `普通话` | 38 | `Cherry`、`Ethan`、`Momo`…… |
| `上海话` | 1 | `Jada` |
| `北京话` | 1 | `Dylan` |
| `南京话` | 1 | `Li` |
| `陕西话` | 1 | `Marcus` |
| `闽南语` | 1 | `Roy` |
| `天津话` | 1 | `Peter` |
| `四川话` | 2 | `Sunny`、`Eric` |
| `粤语` | 2 | `Rocky`、`Kiki` |

其中方言音色集中在表尾 10 条，且 `Jada`、`Dylan`、`Sunny` 同时属于 `tts` 系列。

## 4. 依赖与协作

依赖：仅 `import type { SystemVoice } from '../shared/types'`，为纯类型依赖，运行时无外部依赖。

### 4.1 与 `src/main/voice.ts` 的配合

`voice.ts` 通过 `import { SYSTEM_VOICES, isSystemVoice } from './systemVoices'` 使用本表，共有四处关键配合：

| 位置 | 用法 |
| --- | --- |
| `resolveVoiceModel` | 先查本地音色映射 `voiceProfiles`；未命中时用 `isSystemVoice(bare)` 判断是否为系统音色，命中则调 `systemVoiceDefaultModel` 取该音色系列的默认合成模型 |
| `systemVoiceDefaultModel` | 读取 `v.series`，按优先级 **`instruct-flash` > `flash` > `tts`** 返回系列默认模型，全部未命中时兜底 `'qwen3-tts-flash'` |
| `IPC.Voice.ListSystemVoices`（`voice:list-system-voices`） | `SYSTEM_VOICES.map` 输出 `{ voice, desc, langs, series, model }`，其中 `model` 取 `voiceProfiles['system:' + voice].targetModel`，没有映射时取 `systemVoiceDefaultModel(v)`；无需 API Key |
| `IPC.Voice.ListAll`（`voice:list-all`） | 把系统音色转成统一条目 `{ key: 'system:' + voice, type: 'system', name: profile.name 或 v.desc, voiceId: v.voice, model: resolveVoiceModel(key) }`，与克隆音色条目合并成「音色即模型」的下拉数据源 |

### 4.2 与「音色管理」页面的配合

- 渲染层通过 preload 暴露的 `window.voiceTools.listSystemVoices()`（对应 `voice:list-system-voices`）与 `window.voiceTools.listAll()`（对应 `voice:list-all`）取到本表数据。
- 「音色管理」卡组 `src/renderer/src/pages/TextTtsPage/VoiceSection.vue`（配音页第三个 Tab；原独立页 `SoundCopyPage/index.vue` 已并入）在加载时并行调用 `listSystemVoices()`、`list()`、`getProfiles()`，把系统音色与克隆音色合并成同一列表展示；用户可为某个系统音色保存映射（key 为 `system:<voice>`），保存后 `name` / `targetModel` 覆盖默认值。
- 文字转语音页的音色下拉（`src/renderer/src/pages/TextTtsPage/helpers.ts`）优先用 `listAll()`；若 `voice:list-all` 不可用，则回退为 `listSystemVoices()` + `list()` + `getProfiles()` 组装，因此本表的 `voice` / `desc` / `langs` / `series` 字段即回退路径的展示依据。

## 5. 注意事项与实现要点

- **`voice` 是接口参数，禁止改写**：该值直接下发给 Qwen-TTS 合成接口，任何拼写或大小写改动都会导致合成失败。
- **匹配是精确全等且大小写敏感**：`isSystemVoice('cherry')` 返回 `false`；含空格的音色（`Eldric Sage`、`Ono Anna`、`Radio Gol`）必须原样传递，不能做 trim 之外的规范化。
- **`series` 决定默认模型**：新增或调整音色时若漏填 `series`，`systemVoiceDefaultModel` 会退化为全局兜底模型 `qwen3-tts-flash`，音色与模型可能不匹配。
- **数组顺序即 UI 顺序**：下拉列表按 `SYSTEM_VOICES` 的定义顺序渲染，插入新音色会影响展示位置。
- **`langs` 是单个字符串而非数组**：每条音色只标注一个特色语种，不表达多语种能力。
- **表格规模影响 UI 与计数**：本表条数直接决定 `voice:list-system-voices` 的 `total` 与 `voice:list-all` 中的系统音色条目数，增删音色需同步核对。
- **纯数据模块，无副作用**：模块导入时不读写文件、不注册 IPC，可安全被主进程任意模块引用。
