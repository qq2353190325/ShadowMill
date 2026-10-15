# src/main/htmlAgent.ts

> 自定义模型 Agent：流式生成/修改 HyperFrames 合规 HTML。

- **所在目录**：src/main/
- **类型**：主进程业务模块
- **规模**：275 行
- **对外导出**：`HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`，以及类型 `AgentProgress`、`AgentOpts`

## 1. 作用与职责

本模块是「HTML 生成」与「HTML 修改」两条链路共用的模型调用层，面向 **OpenAI 兼容协议**的自定义模型（Base URL / Model ID / API Key 由设置页维护）。

职责范围：

| 职责 | 实现位置 |
|------|----------|
| 拼装系统提示词，约束输出为可独立运行的 HyperFrames composition | `HTML_AGENT_SYSTEM` |
| 流式调用自定义模型，区分「思考内容」与「正文输出」 | `chatWithCustomModel` |
| 分阶段上报进度（连接/思考/输出/重试/完成） | `emit` + `AgentProgress` |
| 输出为空或 HTML 被截断时按 max_tokens 升档重试 | `MAX_TOKEN_TRIES` 循环 |
| 从模型回复中剥离 Markdown 代码块、提取纯 HTML | `extractHtmlFromReply` |
| 全量会话与每次尝试的过程记录落盘（jsonl） | `logConversation` |
| 把英文原始报错翻成人话（含配置类分类 `needConfig`） | `cfgErr` + `friendlyError`（`src/shared/errors.ts`） |

本文件**不做**任何 IPC 注册，也不负责把 HTML 落盘到项目目录；这两件事由调用方 `projects.ts` 完成。

## 2. 导出与关键实现

### 2.1 对外导出

| 名称 | 类型 | 说明 |
|------|------|------|
| `HTML_AGENT_SYSTEM` | 常量（`string`） | 系统提示词，6 条硬性要求拼接而成，见 2.2 |
| `extractHtmlFromReply` | 函数 | `(text: string) => string`，从模型回复中提取 HTML 源码 |
| `chatWithCustomModel` | 异步函数 | `(userPrompt: string, opts?: AgentOpts) => Promise<string>`，返回模型输出的 HTML 原文 |
| `AgentProgress` | 类型别名（仅类型） | **再导出名**：`export type AgentProgress = HtmlAgentProgress` —— 进度载荷的真实定义在 `src/shared/types.ts` ⑧ 节（`stage` / `thinkChars` / `contentChars` / `thinkText`），本文件不再自行声明 interface，但保留 `AgentProgress` 这一导出名以维持 `projects.ts` 等既有引用面 |
| `AgentOpts` | interface（仅类型） | 调用选项：`meta` / `maxTokenTries` / `onProgress` |

### 2.2 内部实现细节

| 名称 | 类型 | 说明 |
|------|------|------|
| `MAX_TOKEN_TRIES` | 常量 | `[32768, 65536]`，max_tokens 升档序列 |
| `logConversation` | 函数 | 追加一行 JSON 到 `userData/html-agent/chat.jsonl`，异常静默吞掉 |
| `logEntry` | 闭包函数 | 组装固定的记录头（`ts`/`project`/`action`/`model`/`baseUrl`/`messages`/`attempts`）再合并 `extra` |
| `noteToken` | 闭包函数 | 记录首 token / 首思考 / 首输出时间点，用于耗时统计 |
| `emit` | 闭包函数 | 300ms 节流地向 `onProgress` 上报阶段 |

### 2.3 系统提示词的 6 条硬性要求

| 序号 | 约束要点 |
|------|----------|
| 1 | 直接输出完整 HTML 文档，以 `<!DOCTYPE html>` 开头，含 `<head>` 与 `<body>` |
| 2 | 满足 HyperFrames composition 规范（与 **HyperFrames 官方文档 / 官方示例**对齐——此处「示例」指上游 HyperFrames 的样例）：① 动画根容器带 `data-composition-id`（如 `<div data-composition-id="main">`）；② 用 `<script src="./gsap.min.js"></script>` 引入 GSAP——该文件由应用随项目提供，**禁止改用任何 CDN 地址**，也不再钉版本号；③ 时间轴一律 `gsap.timeline({ paused: true })` 创建（起播由渲染器与预览控制负责，不自动播放）；④ 时间轴登记到**以 composition id 为键的对象**上：`window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;`，键必须与 `data-composition-id` 完全一致，**不要写成数组**；⑤ **画布（成片尺寸）以用户消息里【画布】给出的尺寸为准**：在 `<html>` 上写死 `data-resolution="landscape\|portrait\|square"`，并把主舞台容器做成该尺寸的**固定 px** 版式（不要用 `vw` / `vh` / 百分比自适应、不要 `transform: scale` 缩放舞台），内容排满整块画布 |
| 3 | 视觉风格：深空科技 / Cyber UI（`#0B1220` 深色背景、`#00D4FF` 电子蓝辉光、玻璃拟态、霓虹渐变） |
| 4 | 若用户提供字幕，按字幕条目逐条依次播放入场动画 |
| 5 | 字幕时间轴严格按提供的起止时间执行；秒可带小数，GSAP 直接按小数秒定位，禁止四舍五入或重排；无结束时间的行自行安排节奏 |
| 6 | 不得输出解释文字、Markdown 注释或代码块围栏，只输出 HTML 源码 |

### 2.4 onProgress 各阶段含义

| stage | 触发时机 | 附带数据 |
|-------|----------|----------|
| `connecting` | 类型（`HtmlAgentProgress['stage']`，定义在 `shared/types.ts`）中声明，本文件不主动 emit（文案映射保留在 `projects.ts` 的 `progressText`） | — |
| `thinking` | 收到 `delta.reasoning_content` 时；首次进入强制 emit，之后按 300ms 节流 | `thinkChars`、`thinkText`（末 20000 字符） |
| `writing` | 收到 `delta.content` 时；首次进入强制 emit，之后按 300ms 节流 | `contentChars` |
| `retry` | 判定输出被截断或输出为空、需要升档重试时强制 emit | 上一档的字符数 |
| `done` | 本档拿到非空 `content` 且未被判为截断时强制 emit | 最终字符数 |

## 3. 关键流程

### 3.1 `chatWithCustomModel` 主流程

1. **配置校验（经 `friendlyError` 产出人话）**：`getCustomModel()` 取配置后，内部 `cfgErr(raw, hint?)` 用 `friendlyError(new Error(raw), { label: '生成 HTML', baseUrl: m.baseUrl, hint })` 翻译并抛出——`enabled` 为假 → 抛「自定义模型未启用，请到「设置」打开开关」（必须传 `hint: 'model-not-enabled'`：原句里没有能被码表正则匹配到的关键词）；`baseUrl`/`modelId`/`apiKey` 任一缺失 → 抛「模型未配置完整，请到设置页填写 Base URL / Model ID / API Key」。两种都是配置类，`needConfig` 为 `'model'`。
2. **组装输入**：`messages = [{ role: 'system', content: HTML_AGENT_SYSTEM }, { role: 'user', content: userPrompt }]`。
3. **准备记录容器**：建立 `attempts` 数组，并用 `logEntry` 闭合函数固定 `ts` / `project` / `action` / `model` / `baseUrl` / `messages` / `attempts`。
4. **遍历 max_tokens 档位**：默认 `[32768, 65536]`，可被 `opts.maxTokenTries` 覆盖。每档重置 `content`、`thinkText`、`finishReason`、`usage`、计时点，并另建四个**本档专用**局部量：`apiUrl`（`String(baseUrl).replace(/\/+$/, '') + '/chat/completions'`，既用于实际请求、也进排障详情）、`httpDetail`（本档非 2xx 的响应体）、`attemptCfg`（`{ needConfig: ConfigTarget } | null`）、`attemptDetail`（本档排障详情）。
5. **发起流式请求（两条路径，二选一）**：
   - 路径 A（优先）：`const OpenAI = loadOpenAI()`（settings.ts 里的懒加载入口）返回可构造函数时，`new OpenAI({ apiKey, baseURL })` + `client.chat.completions.create({ model, messages, max_tokens, stream: true, stream_options: { include_usage: true } })`，`for await` 消费 chunk。
   - 路径 B（兜底）：SDK 不可用时直接 `fetch(baseUrl 去尾斜杠 + '/chat/completions')`，带 `Content-Type` 与 `Authorization: Bearer <apiKey>`，手动读取 `resp.body.getReader()`，按行解析 SSE：仅处理 `data:` 前缀行，跳过空载荷与 `[DONE]`，`JSON.parse` 失败的行直接忽略。响应非 2xx 时把响应体（`await resp.text()`，取前 300 字符）存进 `httpDetail` 并 `throw new Error(httpDetail)`（形如 `HTTP 422 {"error":…}`）；无 body 时抛「HTTP 响应无 body」。
6. **逐块解析**：`chunk.usage` 存在则覆盖 `usage`；`choices[0].finish_reason` 存在则覆盖 `finishReason`；`delta.reasoning_content` 追加到 `thinkText` 并 emit `thinking`；`delta.content` 追加到 `content` 并 emit `writing`。
7. **异常捕获（先翻译成人话）**：请求期异常交给 `friendlyError(e, { label: '生成 HTML', baseUrl: m.baseUrl, extras: [apiUrl ? '请求地址：' + apiUrl : '', httpDetail] })`——`f.message` 作 `attemptErr`、`f.needConfig` 填 `attemptCfg`（非配置类为 `null`）、`f.detail || ''` 作 `attemptDetail`。本档记录仍会 push 进 `attempts`，随后记录一次 `ok: false` 并抛出 `attemptErr`。
8. **落档记录**：`attempts.push({ maxTokens, startTs, thinkText, thinkChars, content, contentChars, finishReason, usage, error, detail: attemptDetail || undefined, needConfig: attemptCfg, timing: { totalMs, firstTokenMs, thinkMs, writeMs } })`（`detail` 与 `needConfig` 是 2026-10 新增的两项：排障详情与配置类标记）。
9. **成功判定**：`content.trim()` 非空且未判为截断 → emit `done`、写一条 `ok: true` 记录、返回 `content`。
10. **截断判定与升档**：`truncated = finishReason === 'length' && content 非空 && 结尾不匹配 /<\/(body|html)\s*>\s*$/i`，成立则 emit `retry` 后 `continue`。
11. **空输出处理**：`content` 为空且 `finishReason === 'length'` → emit `retry` 后 `continue`；否则 `break` 跳出档位循环。
12. **彻底失败**：取最后一档尝试，区分「HTML 被截断」与「模型未返回内容」两类文案，拼上 `usage` 诊断信息，记录 `ok: false` 并抛出。

### 3.2 `extractHtmlFromReply` 提取规则

1. 统一 `String(text || '').trim()`。
2. 优先匹配 Markdown 代码块：正则 `/```(?:html)?\s*([\s\S]*?)```/i`，命中且块内非空则返回块内 trim 结果（兼容 ```html 与无语言标记的围栏）。
3. 否则定位 `<!DOCTYPE html` 或 `<html` 起始位置，从该位置截取到末尾。
4. 都没有则原样返回 trim 后的文本。

### 3.3 `logConversation` 记录结构

写入路径：`path.join(app.getPath('userData'), 'html-agent', 'chat.jsonl')`，每次调用追加一行 JSON。

| 字段 | 来源 | 说明 |
|------|------|------|
| `ts` | `new Date().toISOString()` | 记录时间 |
| `project` / `action` | `opts.meta` | `action` 取值为 `generate` 或 `modify`（由 projects.ts 传入） |
| `model` / `baseUrl` | 自定义模型配置 | 便于回溯调用目标 |
| `messages` | system + user | 完整输入 |
| `attempts` | 数组 | 每档 max_tokens 的完整过程记录 |
| `ok` / `reply` / `error` / `detail` | `extra` | 成功写 `reply`，失败写 `error`（人话文案）与 `detail`（排障详情） |

`attempts` 单项字段：`maxTokens`、`startTs`、`thinkText`（reasoning_content 全文）、`thinkChars`、`content`（完整输出）、`contentChars`、`finishReason`、`usage`、`error`、**`detail`**（`attemptDetail || undefined`）、**`needConfig`**（`{ needConfig: ConfigTarget } | null`）、`timing.totalMs`、`timing.firstTokenMs`、`timing.thinkMs`、`timing.writeMs`。

## 4. 依赖与协作

### 4.1 导入

| 来源 | 导入项 | 用途 |
|------|--------|------|
| `electron` | `app` | 取 `userData` 拼接日志目录 |
| `node:path` | `path`（默认导入） | 拼接 `html-agent/chat.jsonl` |
| `node:fs` | `fs`（默认导入） | `mkdirSync` / `appendFileSync` |
| `./settings` | `getCustomModel`、`loadOpenAI` | 读取自定义模型配置；**懒加载** openai SDK 构造函数（本模块不再自行 `import 'openai'`，见 §5） |
| `../shared/errors` | `friendlyError` | 把英文原始报错翻成人话，并产出 `detail`（排障详情）与 `needConfig`（配置类分类）：两处配置校验的 `cfgErr` 与每次尝试的 `catch` 都用它 |
| `../shared/types` | `type HtmlAgentProgress`、**`type ConfigTarget`** | 进度载荷的真实定义（以 `export type AgentProgress = HtmlAgentProgress` 再导出，本地不再声明 interface）；`ConfigTarget` 用于每档 `attemptCfg` 的类型标注 |

### 4.2 被谁使用

| 使用方 | 用法 |
|--------|------|
| `src/main/projects.ts` | 导入 `chatWithCustomModel`、`extractHtmlFromReply`、类型 `AgentProgress`；`project:generate-html` 与 `project:modify-html` 两个分支调用「模型调用 → `extractHtmlFromReply` 提取 HTML」，随后由 `hfEnv.localizeGsapHtml()` 把 CDN 引用改写为 `./gsap.min.js` 并落盘 |
| `src/main/projects.ts` 进度链路 | `onProgress` 回调把 `AgentProgress` 交给 `progressText` 生成文案，再带 `text` 字段经 IPC 频道 `project:html-progress`（`IPC.Project.HtmlProgress`）推给渲染进程 |
| `src/renderer/src/pages/HtmlGenPage/index.vue` → `src/renderer/src/pages/HtmlGenPage/PreviewSection.vue` | **`index.vue` 通过 `window.projectTools.onHtmlProgress` 接收进度**（它同时写状态行 `status` / `statusClass` 与思考文本 `thinkText`），再以 props（`:status` / `:status-class` / `:think-text` / `:rendering`）传给同目录的 `PreviewSection.vue`——**展示落在 `PreviewSection.vue`**：`.hf-status` 状态行（`statusDisplay`）与「AI 思考过程（实时）」的 `<pre>{{ thinkText }}</pre>` 都在那里 |
| `src/main/settings.ts` | `IPC.Settings.Save` / `IPC.Settings.Test` 维护与验证 `customModel` 配置 |

依赖方向（见 `src/main/index.ts` 头部注释）：`settings ← htmlAgent ← projects ← voice ← ttsAlign`。

## 5. 注意事项与实现要点

- **max_tokens 起点为何是 32768**：注释明确记录 8192 / 16384 实测会被思考阶段耗尽（`reasoning_tokens=16384` 仍无输出），故直接以 32768 起步，第二档 65536。
- **两条请求路径的取舍**：SDK 路径拿到官方 SSE 解析与类型；当 `loadOpenAI()` 返回 `null`（打包裁剪、依赖缺失、导出形态变化等）时自动退到 `fetch` 手写 SSE，逻辑与 SDK 路径保持同构（同样读取 `usage`、`finish_reason`、`reasoning_content`、`content`），保证能力不降级。
- **SDK 经 `settings.loadOpenAI()` 懒加载**（2026-10）：本模块处于主进程启动路径上（`index.ts` → `projects` → `htmlAgent`），顶层 `import OpenAI from 'openai'` 会让 openai 的模块图加载（实测 ~110ms）压在建窗 / 首屏之前。现在只有真正发起对话时才 `require`，且与 `settings:test` 共用同一份懒加载状态。
- **思考与输出严格分离**：`reasoning_content` 只进 `thinkText` 与进度上报，绝不混入返回值；只有 `content` 会作为最终 HTML 返回。
- **进度节流与体积控制**：`emit` 默认 300ms 一次（`force` 用于阶段首次切换与 retry/done），`thinkText` 只回传末尾 20000 字符，避免长思考撑爆 IPC 载荷。
- **截断判定依赖结尾标签**：正则要求内容结尾为 `</body>` 或 `</html>`；因此提示词第 1 条要求完整文档结构，二者互相支撑。
- **失败也要留痕**：请求期异常先 push 本次 attempt 再记录 `ok: false`；两档全部失败后再记录一条汇总 `ok: false`，因此一次失败调用可能产生多条 jsonl 记录。
- **日志失败不影响主流程**：`logConversation` 内部 try/catch 且注释 `/* ignore */`，日志写失败不会中断生成。
- **usage 诊断**：最终错误信息在 `last.usage` 存在时附加 `（usage: {...}）`，便于判断是配额、网络还是模型策略问题。
- **`stream_options: { include_usage: true }`**：两条路径都显式开启，末块才会回传 prompt/completion/reasoning token 统计。
- **本模块不写项目文件**：返回值仍是原始 `content`，HTML 落盘、GSAP 本地化（`localizeGsapHtml` / `copyGsapIntoProject`）、HyperFrames 合规检查（`isHyperframesComposition`）与项目状态更新都在 `projects.ts` 完成。
- **提示词第 2 条是与 HyperFrames 官方文档对齐的「生成契约」**：本地引用 `./gsap.min.js`（无 CDN、无版本号）、`gsap.timeline({ paused: true })`、`window.__timelines` 为「以 composition id 为键的对象」（键 = `data-composition-id`）。但合规校验 `hfEnv.isHyperframesComposition()` 仍只做三个文本特征的正则匹配，**不校验 `__timelines` 究竟是数组还是对象**——因此历史生成物（数组形态）依旧判为合规，预览控制脚本 `HG_PREVIEW_CTRL` 对「对象 / 数组 / 缺失」三种形态都做了兼容。
- **画布要求是「提示词 + 应用兜底」两道**（本次新增）：提示词第 2 条第 ⑤ 点要求模型自己写死 `data-resolution` 与固定 px 主舞台，但**不能只靠它**——渲染入口还会由 `src/main/video.ts` 的 `applyCanvasDeclaration()` 再写一次 `data-resolution`（CLI 的画布解析链里它优先级最高，压过页面自己的声明），因为 HyperFrames CLI 在页面**没声明画布时兜底 `portrait`**（成片变 1080×1920 竖屏、宽屏版式被裁掉两侧并留大片黑边）。同理，`projects.ts` 的生成提示词里也有独立的【画布】块，两处说法都取 `shared/constants.ts` 的 `CANVAS_LABELS` / `CANVAS_SIZES`，不会各说一套。
- **提示词不保证模型照做**：模型仍可能输出 CDN 引用或数组形态。CDN 引用由 `projects.ts` 在写盘前用 `localizeGsapHtml()` 兜底改写；数组形态则靠预览控制脚本的三态枚举与渲染侧的 HyperFrames 运行时兼容，提示词本身不做校验。
- **配置类失败不升档重试**：`cfgErr` 在进入档位循环**之前**就抛出（未启用 / 配置不完整）；循环内一旦本档失败也是 `throw new Error(attemptErr)` 直接结束。`needConfig` 只是随 attempt 记录带出的分类标记，不参与「是否重试」的判定（升档只看截断 / 空输出）。
- **`needConfig` 由 `shared/errors` 单点判定**：`friendlyError()` 判出「去设置页改配置就能解决」才给 `needConfig`（本模块只会产出 `'model'`）；**余额 / 欠费刻意不给**——去设置修不了余额，文案直接说明去厂家控制台充值，因此模型链路只会为配置类弹「去设置」。
- **排障详情的两个来源**：`detail` 统一由 `friendlyError` 产出（原始报文首行截断 500 字符 + `extras`）；本模块传入的 `extras` 固定两项——`请求地址：<apiUrl>` 与 `httpDetail`（非 2xx 的响应体前 300 字符）。它们是排障信息，**不会出现在用户文案里**（`message` 只说人话）。
