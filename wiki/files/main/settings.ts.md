# src/main/settings.ts

> settings.json 的读写、默认值合并与连通性测试；渲染档位白名单的唯一实现

- **所在目录**：src/main/
- **类型**：设置存储模块（settings.json）
- **规模**：223 行
- **对外导出**：`register`、`readSettings`、`writeSettings`、`DEFAULT_RENDER`、`normalizeRenderOptions`、`pickRenderOverride`、`getCustomModel`、`getVoiceConfig`、`getWhisperModel`、`saveWhisperModel`、`getWhisperCustomModels`、`saveWhisperCustomModels`、`getVoiceProfiles`、`saveVoiceProfile`、`deleteVoiceProfile`、`DEFAULT_SETTINGS`

## 1. 作用与职责

本模块是主进程唯一的「全局设置」落盘入口，统一管理 `userData/settings.json` 的读取、合并与写入，并对外提供四类能力：

1. **设置读写**：`readSettings` / `writeSettings`，以及按分区拆分的 getter / setter。
2. **OpenAI 兼容客户端配置**：`customModel` 分区，供 HtmlAgent 等模块调用大模型。
3. **视频渲染档位白名单**：`DEFAULT_RENDER` / `normalizeRenderOptions` / `pickRenderOverride`——**白名单只此一处**，`projects.ts`（项目级覆盖落盘）与 `video.ts`（渲染 CLI 参数）都复用，避免校验逻辑三处漂移。
4. **IPC 注册**：`register(ctx)` 注册 `settings:get` / `settings:save` / `settings:save-render` / `settings:test` 四个频道。

配置文件路径由 `settingsFile()` 计算：

```ts
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')
```

`app.getPath('userData')` 每个平台不同，但始终是应用私有数据目录，因此 API Key 只留在本机用户目录内。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `DEFAULT_SETTINGS` | `() => AppSettings` | 默认设置工厂函数（非共享常量），每次调用返回全新对象；含 `render: Object.assign({}, DEFAULT_RENDER)` |
| `DEFAULT_RENDER` | `RenderOptions` | 内置默认渲染档位常量 `{ quality: 'standard', fps: 30 }`；导出供其它模块对齐默认值（`projects.ts` / `video.ts` 经 `pickRenderOverride` 使用） |
| `normalizeRenderOptions` | `(raw: unknown, fallback?: RenderOptions) => RenderOptions` | **完整档位**规范化：非法/缺省字段回退 `fallback`（默认 `DEFAULT_RENDER`），返回 `{ quality, fps }` 两项齐全的对象 |
| `pickRenderOverride` | `(raw: unknown) => RenderOverride` | **覆盖**规范化：只保留显式给出的合法字段（`quality` ∈ `draft/standard/high`、`fps` ∈ `24/30`），没给 ≠ 要默认值 |
| `readSettings` | `() => AppSettings` | 读取并解析 settings.json，与默认值做浅合并；任何异常都回退默认值 |
| `writeSettings` | `(s: AppSettings) => void` | 先 `mkdirSync(userData, { recursive: true })`，再以 `JSON.stringify(s, null, 2)` 写盘 |
| `getCustomModel` | `() => CustomModelConfig` | 返回 `settings.customModel`，缺失时退回默认值 |
| `getVoiceConfig` | `() => VoiceTTSConfig` | 返回与默认 `voiceTTS` 合并后的配置 |
| `getWhisperModel` | `() => string` | 返回 `settings.whisper.modelId`，缺失返回 `''` |
| `saveWhisperModel` | `(id: string) => string` | 写入 `whisper.modelId` 后回读返回 |
| `getWhisperCustomModels` | `() => WhisperCustomModel[]` | 读取并**规范化**自定义 whisper 模型列表 |
| `saveWhisperCustomModels` | `(list: WhisperCustomModel[]) => WhisperCustomModel[]` | 写盘后回读返回规范化结果 |
| `getVoiceProfiles` | `() => Record<string, VoiceProfile>` | 返回本地音色映射表副本 |
| `saveVoiceProfile` | `(key, profile) => Record<string, VoiceProfile>` | 按 key 覆盖写入一条音色映射 |
| `deleteVoiceProfile` | `(key) => Record<string, VoiceProfile>` | 按 key 删除一条音色映射 |
| `register` | `(ctx?: RegisterCtx) => void` | 注册四个设置类 IPC；`ctx` 未被使用（源码中 `void ctx`） |

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

### 3.2 读取与默认值合并

`readSettings()` 的合并策略是**逐分区浅合并（Object.assign）**：

- `customModel`、`voiceTTS`、`whisper`：以默认值为底、以文件内容覆盖，因此新增字段能自动带上默认值。
- `voiceProfiles`：**不做默认值合并**，只取文件中的值，缺失即 `{}`。
- `render`：**不在 `Object.assign` 之列**，而是走 `normalizeRenderOptions(raw && raw.render)`——旧 settings.json（无 `render` 字段）落回 `standard` / `30`，已写入的脏值经白名单规范化，保证返回值恒为合法的 `{ quality, fps }`。
- 整个 `try` 块包裹 `JSON.parse(fs.readFileSync(..., 'utf8'))`，文件不存在或 JSON 损坏时静默返回 `DEFAULT_SETTINGS()`。

### 3.3 whisper 自定义模型条目的规范化

`getWhisperCustomModels()` 不是原样返回，而是逐条清洗：

- 非数组整体返回 `[]`；
- `filter`：条目必须是对象且 `file` 为非空字符串；
- `map`：`id` 缺省时由文件名派生 —— 去掉前缀 `ggml-`（`/^ggml-/i`）与后缀 `.bin`（`/\.bin$/i`），例如 `ggml-base-q5_1.bin → base-q5_1`；
- 其余字段做类型兜底：`name`/`url`/`desc` 非字符串则为 `''`，`sizeMB` 用 `Number(...) || 0`。

### 3.4 四个 IPC 的行为

| 频道 | 处理函数要点 | 返回 |
| --- | --- | --- |
| `settings:get` | 直接 `readSettings()` | 完整 `AppSettings` |
| `settings:save` | 先 `readSettings()`，**只覆盖 `customModel`**；四个字段逐个做类型校验（`baseUrl`/`modelId`/`apiKey` 非字符串则置 `''`，`enabled` 用 `!!` 强转）；其余分区原样保留 | `{ ok: true, settings: raw }` |
| `settings:save-render` | 先 `readSettings()`，**只覆盖 `render`**：`cur.render = normalizeRenderOptions(Object.assign({}, cur.render, payload.render))`——在现有值上合并本次传入的字段后再整体规范化，因此只改质量不会把帧率顶掉 | `{ ok: true, settings: cur }` |
| `settings:test` | 见下 | `{ ok: boolean, message: string }` |

**`settings:test` 的成功判定**：先用 `getCustomModel()` 与 payload 中的 `customModel` 合并成待测配置 `m`，再依次判断：

1. `baseUrl`、`modelId`、`apiKey` 任一为空 → `ok: false`，提示「配置不完整：Base URL / Model ID / API Key 均需填写」。
2. 若 `typeof OpenAI === 'function'`，用 `new OpenAI({ apiKey, baseURL })` 调 `client.chat.completions.create({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 64 })`；否则走 `fetch` 兜底，POST 到 `baseUrl` 去尾斜杠后拼 `/chat/completions`，带 `Content-Type: application/json` 与 `Authorization: Bearer <apiKey>`，非 2xx 时抛 `HTTP <status>：<body>`。
3. **仅当拿到模型返回的文本内容才算成功**：取 `choices[0].message.content`，`String(text).trim()` 为空则返回 `ok: false`，提示「连接已通但模型未返回文本内容（可能为推理模型/网关异常），请检查 Model ID 或更换模型」。
4. 成功时返回 `{ ok: true, message: '连接成功：模型已响应（' + text.slice(0, 40) + '）' }`；抛错时返回 `{ ok: false, message: '连接失败：' + 错误消息 }`。

## 4. 依赖与协作

依赖：`electron`（`app` / `ipcMain`）、`node:path`、`node:fs`、`openai`、`../shared/ipc`（`IPC.Settings` 频道常量）、`../shared/types`（`AppSettings`、`RenderOptions` / `RenderOverride` / `RenderQuality` / `RenderFps` / `SettingsSaveRenderPayload` 等类型）。

被谁使用：

| 使用方 | 使用内容 |
| --- | --- |
| `src/main/index.ts` | `import * as settings`，并在装配阶段最早调用 `settings.register(ctx)` |
| `src/main/whisper.ts` | `getWhisperModel` / `saveWhisperModel` / `getWhisperCustomModels` / `saveWhisperCustomModels`（模型档位与自定义模型增删） |
| `src/main/voice.ts` | `getVoiceConfig` / `readSettings` / `writeSettings` / `DEFAULT_SETTINGS` / `getVoiceProfiles` / `saveVoiceProfile` / `deleteVoiceProfile` |
| `src/main/htmlAgent.ts` | `import { getCustomModel }`，取自定义模型配置发起对话 |
| `src/main/projects.ts` | `pickRenderOverride`——`project:set-render` 写 / 清除项目级渲染档位覆盖时做白名单过滤 |
| `src/main/video.ts` | `pickRenderOverride`——把 `video:render` 载荷里显式给出的档位拼成 `--quality` / `--fps` 参数 |
| `src/preload/index.ts` | 暴露 `window.settingsTools = { get, save, saveRender, test }`，分别 invoke `settings:get` / `settings:save` / `settings:save-render` / `settings:test` |
| 渲染层设置页 `SettingsPage/index.vue` | 自定义模型分区通过 `window.settingsTools.get()` / `save()` / `test()` 读写；渲染默认档位经 `saveRenderDefaults()` 走 `saveRender()`（千问语音分区走 `window.voiceTools.saveConfig`） |
| 渲染层 `composables/useRenderOptions.ts` | `settingsTools.get()` 读全局默认档位（`loadRenderDefaults()`）、`settingsTools.saveRender()` 保存（`saveRenderDefaults()`） |

协作要点：

- `voice.ts` 的 `voice:save-config` 复用本模块的 `readSettings` / `writeSettings`，自行做 `voiceTTS` 合并后整文件回写；因此 `voiceTTS` 与 `voiceProfiles` 的持久化入口在 `voice.ts`，而通用读写工具在本模块。
- `settings:save` 只碰 `customModel`、`settings:save-render` 只碰 `render`、`voice:save-config` 只碰 `voiceTTS`，三者各管一个分区，互不覆盖。
- 渲染档位的白名单与合并策略**只在 `normalizeRenderOptions` / `pickRenderOverride` 里定义一次**：`projects.ts` 用它过滤项目覆盖、`video.ts` 用它过滤渲染参数、渲染层 `utils/render.ts` 有一份同语义的纯函数实现（取值必须同步）。

## 5. 注意事项与实现要点

- **API Key 明文落盘**：`customModel.apiKey` 与 `voiceTTS.apiKey` 以明文写入 `userData/settings.json`，未做加密；安全约定是「仅存本机、只在主进程读取、不落日志、不外发」，渲染层仅在设置页回显。
- **`DEFAULT_SETTINGS` 是函数**：每次调用返回新对象，避免默认对象被 `Object.assign` 目标或调用方就地修改而污染「默认值」。
- **容错策略**：`readSettings` 吞掉所有异常并回退默认值，好处是文件损坏不会崩溃，代价是「设置看似被重置」而不报错；排查时应先检查 settings.json 是否为合法 JSON。
- **写入无兜底**：`writeSettings` 没有 `try/catch`，`fs.mkdirSync` / `fs.writeFileSync` 失败会向上抛异常，由调用方决定如何处理。
- **合并是浅合并**：若某分区将来嵌套更深的子对象，`Object.assign` 不会递归合并。
- **`settings:save` 不做完整性校验**：即使三项为空也会写入，只有 `settings:test` 才校验配置完整性。
- **渲染档位的两种规范化不可混用**：`normalizeRenderOptions`（补默认，得到完整档位）用于**读取**（`readSettings`）与保存默认档位（`settings:save-render`）；`pickRenderOverride`（只留显式合法值）用于**覆盖类**场景（项目覆盖、渲染参数）。用错会导致「没传档位」被静默升级成「显式默认档位」，覆盖掉上一级配置。
- **`settings:test` 依赖 SDK 形态**：成功路径取决于 `OpenAI` 是否为可构造函数，`import OpenAI from 'openai'` 的默认导出形态变化会静默切到 `fetch` 分支。
- **whisper 条目按 `file` 存活**：`file` 缺失的条目在下次读取时被丢弃；`id` 由文件名派生，因此同一文件名等价于同一 `id`。
