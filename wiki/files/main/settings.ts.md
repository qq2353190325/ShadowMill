# src/main/settings.ts

> settings.json 的读写、默认值合并与连通性测试；渲染档位白名单的唯一实现，以及「出厂状态」判定 `isPristineSettings`

- **所在目录**：src/main/
- **类型**：设置存储模块（settings.json）
- **规模**：311 行
- **对外导出**：`register`、`readSettings`、`writeSettings`、`loadOpenAI`、`isPristineSettings`、`DEFAULT_RENDER`、`normalizeRenderOptions`、`pickRenderOverride`、`getCustomModel`、`getVoiceConfig`、`getUpdaterSettings`、`saveUpdaterSettings`、`getWhisperModel`、`saveWhisperModel`、`getWhisperCustomModels`、`saveWhisperCustomModels`、`getVoiceProfiles`、`saveVoiceProfile`、`deleteVoiceProfile`、`DEFAULT_SETTINGS`

## 1. 作用与职责

本模块是主进程唯一的「全局设置」落盘入口，统一管理 `userData/settings.json` 的读取、合并与写入，并对外提供七类能力：

1. **设置读写**：`readSettings` / `writeSettings`，以及按分区拆分的 getter / setter。
2. **OpenAI 兼容客户端配置**：`customModel` 分区，供 HtmlAgent 等模块调用大模型。
3. **OpenAI SDK 懒加载**：`loadOpenAI()` 是**全工程唯一的 openai SDK 加载入口**（`settings:test` 与 `htmlAgent` 共用），见 §2 与 §5。
4. **视频渲染档位白名单**：`DEFAULT_RENDER` / `normalizeRenderOptions` / `pickRenderOverride`——**白名单只此一处**，`projects.ts`（项目级覆盖落盘）与 `video.ts`（渲染 CLI 参数）都复用，避免校验逻辑三处漂移。
5. **应用自更新设置**：`updater` 分区（`feedUrl` / `autoCheck` / `skippedVersion`）由 `getUpdaterSettings` / `saveUpdaterSettings` 管理，`updater.ts` 读它决定更新源与启动检查。
6. **「出厂状态」判定**：`isPristineSettings(file)` 回答「用户在这个位置配过东西吗」，供 `index.ts` 的 `migrateFrom()` 迁移老数据时决定能否用老 `settings.json` 覆盖新文件（见 §3.5）。
7. **IPC 注册**：`register(ctx)` 注册 `settings:get` / `settings:save` / `settings:save-render` / `settings:save-updater` / `settings:test` 五个频道。

配置文件路径由 `settingsFile()` 计算：

```ts
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')
```

**刻意写成函数而不是模块级常量**：ESM 的 import 提升会让模块级快照**早于** `index.ts` 的模块体求值。当前 userData 位置只跟随 `package.json` 的 `name`（`index.ts` **不做** `app.setPath`），模块级快照本来也正确；但只要将来有人重新引入「在模块体里改 userData 位置」的代码，快照就会静默钉在**当时**的目录上（症状是「项目全没了」且极难查）。因此全主进程统一写成函数 / getter，属**零代价的纯保险**（详见 [index.ts.md](./index.ts.md) §3.1① 与 §5）。API Key 只留在本机用户目录内。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `DEFAULT_SETTINGS` | `() => AppSettings` | 默认设置工厂函数（非共享常量），每次调用返回全新对象；含 `render: Object.assign({}, DEFAULT_RENDER)` |
| `DEFAULT_RENDER` | `RenderOptions` | 内置默认渲染档位常量 `{ quality: 'standard', fps: 30 }`；导出供其它模块对齐默认值（`projects.ts` / `video.ts` 经 `pickRenderOverride` 使用） |
| `normalizeRenderOptions` | `(raw: unknown, fallback?: RenderOptions) => RenderOptions` | **完整档位**规范化：非法/缺省字段回退 `fallback`（默认 `DEFAULT_RENDER`），返回 `{ quality, fps }` 两项齐全的对象 |
| `pickRenderOverride` | `(raw: unknown) => RenderOverride` | **覆盖**规范化：只保留显式给出的合法字段（`quality` ∈ `draft/standard/high`、`fps` ∈ `24/30`），没给 ≠ 要默认值 |
| `readSettings` | `() => AppSettings` | 读取并解析 settings.json，与默认值做浅合并；任何异常都回退默认值 |
| `loadOpenAI` | `() => any \| null` | **openai SDK 懒加载入口**：首次调用才 `require('openai')` 并取 `mod.default \|\| mod`；成功返回可 `new` 的构造函数，失败/形态不对返回 `null`（调用方落到 fetch 兜底分支）。带 `openaiLoadTried` 一次性标志，失败不重试 |
| `writeSettings` | `(s: AppSettings) => void` | 先 `mkdirSync(userData, { recursive: true })`，再以 `JSON.stringify(s, null, 2)` 写盘 |
| `isPristineSettings` | `(file: string) => boolean` | 判定**指定**的 settings.json 是否还是「出厂状态」（用户在这个位置什么都没配过）：`true` = 可以安全被老配置覆盖。文件不存在 / JSON 损坏 / 顶层不是对象一律 `true`。判定字段与取舍见 §3.5 |
| `getCustomModel` | `() => CustomModelConfig` | 返回 `settings.customModel`，缺失时退回默认值 |
| `getVoiceConfig` | `() => VoiceTTSConfig` | 返回与默认 `voiceTTS` 合并后的配置 |
| `getUpdaterSettings` | `() => UpdaterSettings` | 返回规范化后的 `updater` 分区（`feedUrl` / `autoCheck` / `skippedVersion`） |
| `saveUpdaterSettings` | `(patch?: Partial<UpdaterSettings>) => UpdaterSettings` | **按字段合并**写入（`{ skippedVersion: '1.0.2' }` 不会清掉 `feedUrl`），写盘并返回新值 |
| `getWhisperModel` | `() => string` | 返回 `settings.whisper.modelId`，缺失返回 `''` |
| `saveWhisperModel` | `(id: string) => string` | 写入 `whisper.modelId` 后回读返回 |
| `getWhisperCustomModels` | `() => WhisperCustomModel[]` | 读取并**规范化**自定义 whisper 模型列表 |
| `saveWhisperCustomModels` | `(list: WhisperCustomModel[]) => WhisperCustomModel[]` | 写盘后回读返回规范化结果 |
| `getVoiceProfiles` | `() => Record<string, VoiceProfile>` | 返回本地音色映射表副本 |
| `saveVoiceProfile` | `(key, profile) => Record<string, VoiceProfile>` | 按 key 覆盖写入一条音色映射 |
| `deleteVoiceProfile` | `(key) => Record<string, VoiceProfile>` | 按 key 删除一条音色映射 |
| `register` | `(ctx?: RegisterCtx) => void` | 注册五个设置类 IPC；`ctx` 未被使用（源码中 `void ctx`） |

## 3. 关键流程

### 3.1 settings.json 的分区结构与默认值

`DEFAULT_SETTINGS()` 定义了五个分区的完整默认值：

| 分区 | 字段 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `customModel` | `baseUrl` | `''` | OpenAI 兼容接口地址 |
| | `modelId` | `''` | 模型 ID |
| | `apiKey` | `''` | 接口密钥（明文落盘） |
| | `enabled` | `false` | 是否启用自定义模型 |
| `voiceTTS` | `apiKey` | `''` | 千问语音 API Key |
| | `targetModel` | `'qwen-audio-3.0-tts-flash'` | 默认语音合成模型 |
| | `saveDir` | `''` | 默认音频保存目录 |
| `voiceProfiles` | — | `{}` | 本地音色映射；key 形如 `system:Cherry` / `custom:<voice_id>`，值含 `{ key, name, voice, targetModel, type }` |
| `whisper` | `modelId` | `''` | whisper.cpp 当前模型档位 |
| | `customModels` | `[]` | 用户自定义 whisper 模型条目数组 |
| `render` | `quality` | `'standard'` | 视频渲染全局默认质量（`draft` / `standard` / `high`） |
| | `fps` | `30` | 视频渲染全局默认帧率（`24` / `30`） |
| `updater` | `feedUrl` | `''` | 更新源地址覆盖；**留空即用打包时写入 `resources/app-update.yml` 的地址** |
| | `autoCheck` | `true` | 启动后是否静默检查一次更新 |
| | `skippedVersion` | `''` | 用户选择「跳过」的版本号；该版本不再提示 |

### 3.2 读取与默认值合并

`readSettings()` 的合并策略是**逐分区浅合并（Object.assign）**：

- `customModel`、`voiceTTS`、`whisper`：以默认值为底、以文件内容覆盖，因此新增字段能自动带上默认值。
- `voiceProfiles`：**不做默认值合并**，只取文件中的值，缺失即 `{}`。
- `render`：**不在 `Object.assign` 之列**，而是走 `normalizeRenderOptions(raw && raw.render)`——旧 settings.json（无 `render` 字段）落回 `standard` / `30`，已写入的脏值经白名单规范化，保证返回值恒为合法的 `{ quality, fps }`。
- `updater`：同样走专用规范化函数 `normalizeUpdaterSettings(raw && raw.updater)`——旧 settings.json（无 `updater` 字段）落回 `{ feedUrl: '', autoCheck: true, skippedVersion: '' }`；`feedUrl` 只接受空串或 `http(s)://` 开头的地址，非法值**回退到 `fallback` 而不是清空**（避免用户手填的地址被一次误读抹掉），`autoCheck` 非布尔则回退，`skippedVersion` 非字符串则回退。
- 整个 `try` 块包裹 `JSON.parse(fs.readFileSync(..., 'utf8'))`，文件不存在或 JSON 损坏时静默返回 `DEFAULT_SETTINGS()`。

### 3.3 whisper 自定义模型条目的规范化

`getWhisperCustomModels()` 不是原样返回，而是逐条清洗：

- 非数组整体返回 `[]`；
- `filter`：条目必须是对象且 `file` 为非空字符串；
- `map`：`id` 缺省时由文件名派生 —— 去掉前缀 `ggml-`（`/^ggml-/i`）与后缀 `.bin`（`/\.bin$/i`），例如 `ggml-base-q5_1.bin → base-q5_1`；
- 其余字段做类型兜底：`name`/`url`/`desc` 非字符串则为 `''`，`sizeMB` 用 `Number(...) || 0`。

### 3.4 五个 IPC 的行为

| 频道 | 处理函数要点 | 返回 |
| --- | --- | --- |
| `settings:get` | 直接 `readSettings()` | 完整 `AppSettings` |
| `settings:save` | 先 `readSettings()`，**只覆盖 `customModel`**；四个字段逐个做类型校验（`baseUrl`/`modelId`/`apiKey` 非字符串则置 `''`，`enabled` 用 `!!` 强转）；其余分区原样保留 | `{ ok: true, settings: raw }` |
| `settings:save-render` | 先 `readSettings()`，**只覆盖 `render`**：`cur.render = normalizeRenderOptions(Object.assign({}, cur.render, payload.render))`——在现有值上合并本次传入的字段后再整体规范化，因此只改质量不会把帧率顶掉 | `{ ok: true, settings: cur }` |
| `settings:save-updater` | **只覆盖 `updater`**：调 `saveUpdaterSettings(payload.updater)`（内部对现有值做字段级合并 + 规范化 + 写盘），再 `readSettings()` 回读整份设置返回。因此「保存更新源」不会影响 `autoCheck`，反之亦然 | `{ ok: true, settings: readSettings() }` |
| `settings:test` | 见下 | `{ ok: boolean, message: string }` |

**`settings:test` 的成功判定**：先用 `getCustomModel()` 与 payload 中的 `customModel` 合并成待测配置 `m`，再依次判断：

1. `baseUrl`、`modelId`、`apiKey` 任一为空 → `ok: false`，提示「配置不完整：Base URL / Model ID / API Key 均需填写」。
2. 先 `const OpenAI = loadOpenAI()`：拿到构造函数就用 `new OpenAI({ apiKey, baseURL })` 调 `client.chat.completions.create({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 64 })`；返回 `null`（SDK 未随包 / 形态不对）则走 `fetch` 兜底，POST 到 `baseUrl` 去尾斜杠后拼 `/chat/completions`，带 `Content-Type: application/json` 与 `Authorization: Bearer <apiKey>`，非 2xx 时抛 `HTTP <status>：<body>`。
3. **仅当拿到模型返回的文本内容才算成功**：取 `choices[0].message.content`，`String(text).trim()` 为空则返回 `ok: false`，提示「连接已通但模型未返回文本内容（可能为推理模型/网关异常），请检查 Model ID 或更换模型」。
4. 成功时返回 `{ ok: true, message: '连接成功：模型已响应（' + text.slice(0, 40) + '）' }`；抛错时返回 `{ ok: false, message: '连接失败：' + 错误消息 }`。

### 3.5 `isPristineSettings(file)`：出厂状态判定

```ts
function isPristineSettings(file: string): boolean
```

**用途**：用户点「迁移过来」后，`index.ts` 的 `migrateFrom()` 迁移老数据时，`settings.json` 是唯一允许覆盖的条目——因为新位置的文件基本必然已存在（应用启动时按默认值写过），而「目标已存在就跳过」会把用户的 API Key / 自定义音色 / 各档设置全部留在老目录。判定条件因此是「**新文件还是出厂状态**」：

| 判定顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | `JSON.parse(fs.readFileSync(file, 'utf8'))` 抛错（不存在 / 损坏） | `true`（视为出厂） |
| 2 | 解析结果不是对象（`null` / 基本类型） | `true` |
| 3 | 命中下面任一「用户投入过的字段」 | `false`（已被配置过） |
| 4 | 都没命中 | `true`（可被老配置覆盖） |

**只看「用户投入过的字段」**（字符串一律先 `trim()`，空串 = 没填）：

| 分区.字段 | 判定 |
| --- | --- |
| `customModel.apiKey` / `customModel.baseUrl` / `customModel.modelId` | 任一非空 |
| `customModel.enabled` | **严格 `=== true`**（`enabled` 为 `false`/缺失不算动过） |
| `voiceTTS.apiKey` / `voiceTTS.saveDir` | 任一非空 |
| `whisper.modelId` | 非空 |
| `whisper.customModels` | 是数组且 `length > 0` |
| `updater.feedUrl` | 非空 |
| `voiceProfiles` | `Object.keys(...).length > 0`（非空对象） |

**刻意不参与判定的字段**：`updater.autoCheck` / `updater.skippedVersion`（含「跳过某个版本」）、`render.quality` / `render.fps`、`voiceTTS.targetModel`（出厂即非空，判它会让所有文件都「不干净」）。源码注释写明取舍理由：**丢一个开关是两次点击能补回来的，而丢 API Key 要用户去控制台重新翻出来**——所以宁可在迁移覆盖时丢掉开关，也不能因为一个开关而保留旧文件、丢用户凭据。

**副作用**：本函数是只读的，不写盘、不迁移；真正的备份发生在调用方（覆盖前先 `copyFileSync(dst, dst + '.before-migrate.bak')`），详见 [index.ts.md](./index.ts.md) §3.1⑤。

## 4. 依赖与协作

依赖：`electron`（`app` / `ipcMain`）、`node:path`、`node:fs`、`../shared/ipc`（`IPC.Settings` 频道常量）、`../shared/types`（`AppSettings`、`RenderOptions` / `RenderOverride` / `RenderQuality` / `RenderFps` / `SettingsSaveRenderPayload` / `SettingsSaveUpdaterPayload` / `UpdaterSettings` 等类型）；**`openai` 是懒加载依赖**（`loadOpenAI()` 内 `require`，不在模块顶层）。

被谁使用：

| 使用方 | 使用内容 |
| --- | --- |
| `src/main/index.ts` | `import * as settings`；`migrateFrom()` 用 `settings.isPristineSettings(dst)` 判定新 `settings.json` 是否还是出厂状态（决定能否被老配置覆盖），并在装配阶段最早调用 `settings.register(ctx)` |
| `src/main/whisper.ts` | `getWhisperModel` / `saveWhisperModel` / `getWhisperCustomModels` / `saveWhisperCustomModels`（模型档位与自定义模型增删） |
| `src/main/voice.ts` | `getVoiceConfig` / `readSettings` / `writeSettings` / `DEFAULT_SETTINGS` / `getVoiceProfiles` / `saveVoiceProfile` / `deleteVoiceProfile` |
| `src/main/htmlAgent.ts` | `getCustomModel`（取自定义模型配置发起对话）与 `loadOpenAI`（懒加载 SDK 构造函数） |
| `src/main/projects.ts` | `pickRenderOverride`——`project:set-render` 写 / 清除项目级渲染档位覆盖时做白名单过滤 |
| `src/main/video.ts` | `pickRenderOverride`——把 `video:render` 载荷里显式给出的档位拼成 `--quality` / `--fps` 参数 |
| `src/preload/index.ts` | 暴露 `window.settingsTools = { get, save, saveRender, saveUpdater, test }`，分别 invoke `settings:get` / `settings:save` / `settings:save-render` / `settings:save-updater` / `settings:test` |
| `src/main/updater.ts` | `import { getUpdaterSettings, saveUpdaterSettings }`——读 `feedUrl`（非空即覆盖打包内置更新源）、`autoCheck`（启动静默检查开关）、`skippedVersion`（跳过版本）；用户对已跳过版本点「下载更新」时清掉该标记 |
| 渲染层设置页 `SettingsPage/index.vue` | 自定义模型分区通过 `window.settingsTools.get()` / `save()` / `test()` 读写；渲染默认档位经 `saveRenderDefaults()` 走 `saveRender()`；更新设置走 `saveUpdater()`（千问语音分区走 `window.voiceTools.saveConfig`） |
| 渲染层 `composables/useRenderOptions.ts` | `settingsTools.get()` 读全局默认档位（`loadRenderDefaults()`）、`settingsTools.saveRender()` 保存（`saveRenderDefaults()`） |

协作要点：

- `voice.ts` 的 `voice:save-config` 复用本模块的 `readSettings` / `writeSettings`，自行做 `voiceTTS` 合并后整文件回写；因此 `voiceTTS` 与 `voiceProfiles` 的持久化入口在 `voice.ts`，而通用读写工具在本模块。
- **`settings:save` 只碰 `customModel`、`settings:save-render` 只碰 `render`、`settings:save-updater` 只碰 `updater`、`voice:save-config` 只碰 `voiceTTS`，四者各管一个分区，互不覆盖。**
- 渲染档位的白名单与合并策略**只在 `normalizeRenderOptions` / `pickRenderOverride` 里定义一次**：`projects.ts` 用它过滤项目覆盖、`video.ts` 用它过滤渲染参数、渲染层 `utils/render.ts` 有一份同语义的纯函数实现（取值必须同步）。
- `isPristineSettings` 是**跨模块的唯一调用点**：`index.ts` 的 `migrateFrom()`（**用户点「迁移过来」之后**才执行，不在启动早期）。它依赖本模块的惰性路径约定——`settingsFile()` 是函数，因此 `index.ts` 顶部 `import * as settings` 的求值不会提前读写 userData。

## 5. 注意事项与实现要点

- **API Key 明文落盘**：`customModel.apiKey` 与 `voiceTTS.apiKey` 以明文写入 `userData/settings.json`，未做加密；安全约定是「仅存本机、只在主进程读取、不落日志、不外发」，渲染层仅在设置页回显。
- **`DEFAULT_SETTINGS` 是函数**：每次调用返回新对象，避免默认对象被 `Object.assign` 目标或调用方就地修改而污染「默认值」。
- **容错策略**：`readSettings` 吞掉所有异常并回退默认值，好处是文件损坏不会崩溃，代价是「设置看似被重置」而不报错；排查时应先检查 settings.json 是否为合法 JSON。
- **写入无兜底**：`writeSettings` 没有 `try/catch`，`fs.mkdirSync` / `fs.writeFileSync` 失败会向上抛异常，由调用方决定如何处理。
- **合并是浅合并**：若某分区将来嵌套更深的子对象，`Object.assign` 不会递归合并。
- **`settings:save` 不做完整性校验**：即使三项为空也会写入，只有 `settings:test` 才校验配置完整性。
- **渲染档位的两种规范化不可混用**：`normalizeRenderOptions`（补默认，得到完整档位）用于**读取**（`readSettings`）与保存默认档位（`settings:save-render`）；`pickRenderOverride`（只留显式合法值）用于**覆盖类**场景（项目覆盖、渲染参数）。用错会导致「没传档位」被静默升级成「显式默认档位」，覆盖掉上一级配置。
- **`settings:test` 依赖 SDK 形态**：成功路径取决于 `loadOpenAI()` 是否返回可构造函数（内部按 `mod.default || mod` 取），SDK 的导出形态变化会静默切到 `fetch` 分支。
- **openai SDK 必须保持懒加载**（2026-10）：它的模块图较大（`require` 实测 ~110ms，冷启动 / 杀软扫描时更久），而 `settings.ts` 是主进程**启动路径上的模块**（`index.ts` → `settings` → …）。顶层 `import OpenAI from 'openai'` 会让这段成本压在建窗 / 首屏之前，因此改成 `loadOpenAI()` 按需 `require`；`htmlAgent.ts` 也不再自行 `import`，统一经此入口。改回顶层 `import` 会直接拖慢首屏。
- **whisper 条目按 `file` 存活**：`file` 缺失的条目在下次读取时被丢弃；`id` 由文件名派生，因此同一文件名等价于同一 `id`。
- **`isPristineSettings` 的判定是「白名单式」的**：只有源码里逐字列出的字段能把它判成 `false`。**将来新增「用户会投入成本」的字段（新的 API Key、新的外部地址、新的下载清单）时必须同步加进这个白名单**，否则迁移覆盖时会把用户刚配好的新字段连整份文件一起覆盖掉——这是本函数唯一需要维护的地方。
- **`isPristineSettings` 只读不写**：文件不存在 / 损坏返回 `true` 的语义是「当它没有内容可丢」，因此覆盖前是否备份由调用方决定（`index.ts` 一律先写 `.before-migrate.bak`）。
