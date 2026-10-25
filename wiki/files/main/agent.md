# src/main/agent/（Agent 层）

> Agent 层：**一个通用对话传输 + 四个业务薄封装 + 一份对话记录读写（索引 + 每版副本）+ 一个纯出口**。**一个模块、七个文件**：同名目录 + `index.ts` 统一出口，对外接口 = `index.ts` 上挂的 22 个值 + 4 个类型。
>
> 本版新增的是**动作脚本**这条业务（「角色」页 · 动作示范 · AI 生成专属动作）：`castAction.ts` 提供 `HTML_CAST_ACTION_SYSTEM` 与 `chatWithCastAction`。**注意：`html.ts` 里没有任何动作相关的导出**——`isCompleteAction` / 动作提示词 / `chatWithCastAction` 都只在 `castAction.ts`（先加进 `html.ts` 后又整段移走了，`html.ts` 与上一版逐字相同）。

- **覆盖文件**：`agent/chat.ts`（265 行）、`agent/chatLog.ts`（155 行）、`agent/html.ts`（**499 行**）、`agent/htmlEdit.ts`（52 行）、`agent/script.ts`（**367 行**）、**`agent/castAction.ts`（66 行）**、`agent/index.ts`（**21 行**）——行数为工作区实测（`[IO.File]::ReadAllLines`）；`agent/` 目录**共 7 个 `.ts` 文件**
- **所在目录**：`src/main/agent/`
- **类型**：业务域模块之一（`script.ts` 注册 `script:*` **七个**频道；`chatLog.ts` 只做磁盘读写、不注册 IPC；`chat.ts` / `html.ts` / `htmlEdit.ts` / `castAction.ts` / `index.ts` 不注册任何 IPC）；形态是「同名目录 + `index.ts` 统一出口」（与 `src/main/updater/` 同一套工程约定，见根 `AGENTS.md` 关键约定 9）
- **对外导出**（经 `index.ts` 再导出，共 **22 个值 + 4 个类型**）：`chatWithModel`、`MAX_TOKEN_TRIES`、`HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、`HTML_PLAN_SYSTEM`、`chatWithChapterPlan`、`HTML_CHAPTER_SYSTEM`、`chatWithChapter`、`HTML_CHAPTER_EDIT_SYSTEM`、`chatWithChapterEdit`、`HTML_CAST_SYSTEM`、`chatWithCast`、`HTML_ROUTE_SYSTEM`、`chatWithRoute`、**`HTML_CAST_ACTION_SYSTEM`**、**`chatWithCastAction`**、`chatWithHtmlEdit`、`SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、`registerScript`（原 `register`，改名）；类型 `ChatMessage`、`AgentChatOptions`、`AgentOpts`、`AgentProgress`
- **不由 `index.ts` 再导出的内部模块**：`chatLog.ts` 的 **11 个具名导出**（`MAX_CHAT_ROUNDS`、`chatDirOf`、`chatIndexPathOf`、`isValidVersionId`、`newVersionId`、`normalizeScenes`、`readChatIndex`、`writeChatIndex`、`writeVersion`、`readVersion`、`clearChat`）**只给同目录的 `script.ts` 用**；`htmlEdit.ts` 只再导出 `chatWithHtmlEdit` 一个名字（`HTML_AGENT_EDIT_SYSTEM` / `isCompleteHtmlEdit` 留在文件内）；**`castAction.ts` 的内部 `isCompleteAction` 也不挂出去**
- **IPC 域**：`script:generate` / `script:load-chat` / `script:append-round` / `script:read-version` / `script:set-active-version` / `script:clear-chat`（**六条 `ipcMain.handle`**）+ `script:progress`（`event.sender.send` 推送）。全库频道数为 **12 分组 / 106 频道**；preload 的 13 个命名空间不变（**本轮没有新增频道**：动作示范的 5 条频道挂在 `Cast` 组，由 `projects/ipc/castActions.ts` 注册）
- **调用方**：`src/main/projects/` 的四个域（HTML / 角色 / 动作 / 项目）按需 `import … from '../../agent'`；`src/main/index.ts` 的 `import * as agent from './agent'` + 注册段的 **`agent.registerScript(projects.projectDir)`**

## 1. 七个文件的分工与依赖方向

| 文件 | 行数 | 职责 | 该文件的关键名字 |
| --- | --- | --- | --- |
| `chat.ts` | 265 | **通用对话层 / 依赖最上游**：多轮 `messages` + 流式输出（`openai` SDK 与手写 `fetch` SSE 两条等价路径，**两条都带 `reasoning_effort: m.reasoningEffort`**）+ `max_tokens` 升档重试 + 全过程 jsonl 记录 + 人话错误文案 + 300 ms 节流进度。**不 import 同目录任何模块**，只依赖 `../settings`（`getCustomModel` / `loadOpenAI`）与 `../../shared/{errors,types}` | `ChatMessage`、`AgentChatOptions`、`MAX_TOKEN_TRIES`、`chatWithModel`（私有 `logConversation`） |
| `chatLog.ts` | 155 | **对话记录的磁盘读写 / 只认文件、不认识提示词**：目录与路径拼装（`chat/` + `chat/index.json` + `chat/versions/<id>.json`）+ 读索引 + 写索引（写后清理不再被引用的版本副本）+ 读 / 写单版副本 + 规范化 + 清空（删整个 `chat/`）。只依赖 `node:fs` / `node:path` / `../../shared/types`；不注册 IPC、不碰模型 | `MAX_CHAT_ROUNDS = 100`、`chatDirOf`、`chatIndexPathOf`、`isValidVersionId`、`newVersionId`、`normalizeScenes`、`readChatIndex`、`writeChatIndex`、`writeVersion`、`readVersion`、`clearChat`（私有 `MAX_SCENES = 30` / `VERSION_ID_RE` / `versionsDirOf` / `versionPathOf` / `normalizeRoundMeta` / `pruneVersions`） |
| `html.ts` | **499** | **HTML 这一个业务的全部特殊性**：系统提示词（单文件一份 + 章节模式五份：结构规划 / 单章 JS / 单章修改 / **角色文件** / **改稿路由**）+ 回复提取 + `chatWithCustomModel()` 与章节模式三个调用包装 + 角色与路由两个包装（业务参数写死）。只 `import { chatWithModel } from './chat'`。**本版一行未改、逐字与上一版相同**：`isCompleteAction` / 动作提示词 / `chatWithCastAction` 都不在这里（曾短暂加过、随后整段移到 `castAction.ts`） | `HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、`HTML_PLAN_SYSTEM`、`chatWithChapterPlan`、`HTML_CHAPTER_SYSTEM`、`chatWithChapter`、`HTML_CHAPTER_EDIT_SYSTEM`、`chatWithChapterEdit`、`HTML_CAST_SYSTEM`、`chatWithCast`、`HTML_ROUTE_SYSTEM`、`chatWithRoute`、`type AgentProgress`、`interface AgentOpts`（私有 `isCompleteHtml`） |
| `htmlEdit.ts` | **52** | **单文件模式「按需求修改」的系统提示词与调用封装**（导出 3 个名字）：`HTML_AGENT_EDIT_SYSTEM` = `HTML_AGENT_SYSTEM`（从 `./html` 导入）**逐字打头** + 一段第 **7–10 条**追加规则（第 7 条给**三种输出形式**：(a) 只改角色画法 → 只输出 `<<<FILE cast/<id>.js>>> … <<<END FILE>>>`、不必重发整页；(b) 只改页面 → 完整 HTML（`<!DOCTYPE html>` 起、`</html>` 止、无解释文字）；(c) 两者都改 → 先角色文件块、再完整 HTML。第 8 条角色必须沿用、不许重画；第 9 条角色只能改不能新增、路径必须与【当前角色源码】完全一致；第 10 条角色文件仍是纯绘制函数——不建画布、不写时间轴、不用 `Date.now` / 未设种子的随机数）+ `isCompleteHtmlEdit()` + `chatWithHtmlEdit()`（`chatWithModel` 包装）。只 `import { chatWithModel } from './chat'` 与 `{ HTML_AGENT_SYSTEM }` / `type AgentOpts`（来自 `./html`）。**生成（从零做一版）仍走 `html.ts` 的 `chatWithCustomModel`** | `HTML_AGENT_EDIT_SYSTEM`、`isCompleteHtmlEdit`、`chatWithHtmlEdit` |
| `script.ts` | **367** | **内容脚本 Agent**：提示词 / 用户提示拼装 / JSON 解析 / **七个 `script:*` 频道注册**（生成 1 + 对话记录 5 + 进度 1）/ 项目目录注入 / **载荷里 `cast` 的清洗**。`import { chatWithModel } from './chat'` + `import { clearChat, isValidVersionId, newVersionId, normalizeScenes, readChatIndex, readVersion, writeChatIndex, writeVersion } from './chatLog'`，另依赖 `../../shared/{errors,ipc,types,constants}` 与 `electron` 的 `ipcMain`（**语速口径 `EST_CHARS_PER_SEC` 从 `../../shared/constants` 引入**）。**不 import `node:fs` / `node:path`**（落盘全在 `chatLog.ts`），**不 import `projects`**（项目目录由 `index.ts` 注入） | `SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、`registerScript`（私有 `MAX_SCENES = 30` / `MAX_CAST = 20` / `progressText` / 模块级 `projectDirOf`） |
| **`castAction.ts`** | **66** | **动作脚本的系统提示词与调用**（「角色」页 · 动作示范 · AI 生成专属动作）：`HTML_CAST_ACTION_SYSTEM` + `chatWithCastAction()` + 私有 `isCompleteAction()`。只 `import { chatWithModel } from './chat'` 与 `type AgentOpts`（来自 `./html`）；**不注册 IPC、不碰文件**（落盘在 `projects/ipc/castActions.ts` 的 `cast:action-generate`） | `HTML_CAST_ACTION_SYSTEM`、`chatWithCastAction`（私有 `isCompleteAction`） |
| `index.ts` | **21** | **统一出口**：`export … from './chat' / './html' / './castAction' / './htmlEdit' / './script'` **只做再导出、不写任何逻辑**（**不含 `./chatLog`**）；文件头注释记着各子文件的一句话说明与依赖方向（新增那一行说明「动作脚本单独成文件：`html.ts` 已顶到 500 行、且是另一件事」） | 见上「对外导出」清单 |

**依赖方向单向、不成环**（设计要求）：

```
index.ts  ──→  html.ts       ──┐
（出口）   ──→  htmlEdit.ts   ──┤
          ──→  castAction.ts ──┼──→  chat.ts        （chat.ts 最上游：只依赖 ../settings 与 ../../shared/*）
                               │
                script.ts ─────┴──→  chatLog.ts    （chatLog.ts：只依赖 node:fs / node:path / ../../shared/types）
```

- `chat.ts` **一行同目录 import 都没有**——它是传输层的唯一宿主，所以七个文件之间不会互相 import 成环。
- `html.ts` / `script.ts` / `castAction.ts` 都只从 `./chat` 取 `chatWithModel` 这一个名字；三者之间**互不 import**。`htmlEdit.ts` 从 `./chat` 取 `chatWithModel`、从 `./html` 取 `HTML_AGENT_SYSTEM` / `type AgentOpts`（**单向**：`html.ts` 不知道 `htmlEdit.ts` 与 `castAction.ts` 存在）。`castAction.ts` 只从 `./html` 取**类型** `AgentOpts`（引不到实现，也不会成环）。
- `script.ts → chatLog.ts` 是**单向**的：`chatLog.ts` 不 import 同目录任何模块，也不知道「谁在用它」。
- `index.ts` 分别取具名导出并原样挂出，**自身不声明任何函数 / 常量**，**也不再导出 `chatLog.ts` 的任何东西**。

## 2. 对外接口（22 个值 + 4 个类型挂在 `index.ts` 上）

| 名称 | 定义在 | 类型 | 说明 |
| --- | --- | --- | --- |
| `chatWithModel(messages, opts)` | `chat.ts` | `(messages: ChatMessage[], opts: AgentChatOptions) => Promise<string>` | 调自定义模型并流式接收；成功返回**模型正文**（思考内容只进日志与进度，绝不混进返回值）；失败抛 `Error`（`message` 已是人话） |
| `ChatMessage` | `chat.ts` | `interface` | `{ role: 'system' \| 'user' \| 'assistant'; content: string }`；多轮顺序由调用方排（system 在最前） |
| `AgentChatOptions` | `chat.ts` | `interface` | 8 个字段：`label` / `noun` / `logFile` / `isComplete?` / `truncatedHint?` / `meta?` / `maxTokenTries?` / `onProgress?` |
| `MAX_TOKEN_TRIES` | `chat.ts` | `const number[]` | **`[131072, 262144]`**（128K / 256K）——升档序列（`max_tokens` 是上限不是配额；留第二档兜底被截断的情况） |
| `HTML_AGENT_SYSTEM` | `html.ts` | `const string` | 单文件 HTML 的 6 条硬性要求（完整文档 / HyperFrames 规范 / 渲染技术 / 字幕时间轴 / 节奏与字幕扫色 / 不得输出解释文字）；**不含任何视觉风格**（风格由「HTML生成」页的「全局视觉风格」经用户消息传入） |
| `extractHtmlFromReply(text)` | `html.ts` | `(text: string) => string` | 兼容 Markdown 代码块：先取 ```` ```html ```` 围栏内容，否则从首个 `<!DOCTYPE html` / `<html` 起截到底，都没有就原样返回 |
| `chatWithCustomModel(userPrompt, opts?)` | `html.ts` | `(userPrompt: string, opts?: AgentOpts) => Promise<string>` | 组装 `[system: HTML_AGENT_SYSTEM, user: userPrompt]` 后交给 `chatWithModel`；写死 `label: '生成 HTML'` / `noun: 'HTML'` / `logFile: 'html-agent/chat.jsonl'` / `isComplete: isCompleteHtml` / `truncatedHint: '请精简字幕/素材或更换模型'` |
| `HTML_PLAN_SYSTEM` | `html.ts` | `const string` | 结构规划提示词：**只输出 JSON**，判这支片子一份 `index.html`（`single`）还是拆成若干章（`chapters`）；输出只有 `mode` + `chapters`（**不输出角色表**） |
| `chatWithChapterPlan` | `html.ts` | 调用包装 | 规划调用；回复里的 `<<<PLAN>>>` 块由 `chapters.ts` 的 `parsePlanReply` 解析（只读 `mode` / `chapters`） |
| `HTML_CHAPTER_SYSTEM` | `html.ts` | `const string` | 一章的 JS 契约（1–12 条）：可用库与 p5 实例模式 / **第 6.5 条角色必须用共享角色库画、不许在本章里重画，并要驱动 `o` 里的动画参数**（`walk` / `aL`、`aR` / `eyes`、`mouth` / `blink` / `dy`、`dx` / `rot` / `sq`；光传 `ctx` 就是一张不会动的立绘；参数必须由本章 `t` 直接算）/ 第 11 条共享绘制助手 `MC.*`（含卡拍与字幕扫色）/ 第 12 条分层 |
| `chatWithChapter` | `html.ts` | 调用包装 | 逐章生成调用（一章一个 JS） |
| `HTML_CHAPTER_EDIT_SYSTEM` | `html.ts` | `const string` | = 章节契约 + 修改规则：**只交改动过的章**（或改动过的那一个角色文件）；改结构要先交一份完整新 PLAN；**角色不归它管**；编号从 13 起 |
| `chatWithChapterEdit` | `html.ts` | 调用包装 | 定向编辑调用：只带被点名的那几份源码（`<<<CURRENT 路径>>>` 包起来），模型自报改了哪几份 |
| `HTML_CAST_SYSTEM` | `html.ts` | `const string` | **角色文件的契约（顶层 1–10 条；第 3 条下带 3.5 / 3.6 两个子项）**：一份文件只画一个人（`window.__cast[id] = function (x, y, u, o) {…}`）；`(x, y)` 是**脚底中点**、`u` 是**1 个单位的像素高度**；第 3 条是坐标约定，其下 **3.5「往哪画」**（章节会传 `o.ctx`，默认就用它画；声明了 p5 的角色也必须两种都能画）与 **3.6「手臂的枢轴 = 手臂宽度中心 · 从手臂顶部往下半个手臂宽」**（手臂横跨 x=±1..±2，枢轴取中线 x=±1.5、y = 肩线 -6 往下 0.5u = -5.5；盒子局部 x 取 -0.5..0.5、y 取 -0.5..2.5——抬手到 90° 时手臂的**中线压在肩线上**、上沿只比肩线高约 0.03u（几乎贴齐），臂根也不悬空、**手臂画在躯干之前（身体优先），抬手时手臂不会盖住身体**；静止时与「手臂紧贴身体外侧」的画法**逐像素相同**。**别把枢轴放在肩线上**（肩线正是头底/下巴那条线，抬到 86°~100° 时臂根会翘到下巴上，实测踩过），也**别放到肩线下一整个手臂宽**（抬起来手臂会糊到上胸、显得太低），更**不要**用补角 / 长条形肩垫 / 给身体加肩宽来补缝（都会在别处露馅）；腿仍按髋部中心转，腿画在躯干之前、顶部越界会被躯干盖住））；必须支持 `o` 里的 `eyes` / `mouth` / `aL` / `aR` / `dy` / `sq` / `rot` / `flip` / `col` / `alpha`；**纯绘制函数**——禁 `requestAnimationFrame`、禁墙钟时间、禁 `repeat: -1`，动画一律写在章节里；第 10 条是共享绘制助手 `MC.*`。**行数为 499 行 / 42,675 字节（本轮行数没变、字节 42,324 → 42,675：手臂顺序并进枢轴那句）**；`HTML_CAST_ACTION_SYSTEM`（在 `castAction.ts`）**没有**跟着改 |
| `chatWithCast` | `html.ts` | 调用包装 | **「角色」页 · 新建角色 / 改画法**时调用（`cast:create` / `cast:recreate`）：一个角色一个文件块；写死 `label: '生成角色'` / `noun: '角色代码'` / `logFile: 'html-agent/cast.jsonl'`，`meta.action` 形如 `'cast-create-<id>'` / `'cast-edit-<id>'` |
| `HTML_ROUTE_SYSTEM` | `html.ts` | `const string` | **改稿路由规则**：只发大纲 + 角色表 + 用户的话，模型只回 `<<<ROUTE>>> {"targets":[…],"restructure":bool,"reason":"…"} <<<END ROUTE>>>`——最多 6 个目标、只认项目里真实存在的文件，不许猜 |
| `chatWithRoute` | `html.ts` | 调用包装 | 路由调用（`label: '定位改动文件'` / `noun: '改动定位'` / `logFile: 'html-agent/route.jsonl'`）；回复由 `editRoute.ts` 的 `parseRouteReply(reply, allowed)` 解析，解析不出就回退成「发全部源码」 |
| **`HTML_CAST_ACTION_SYSTEM`** | **`castAction.ts`** | **`const string`** | **动作脚本的系统提示词**（见 §2.4） |
| **`chatWithCastAction(userPrompt, opts?)`** | **`castAction.ts`** | **`(userPrompt: string, opts?: AgentOpts) => Promise<string>`** | **动作生成调用包装**（见 §2.4） |
| `chatWithHtmlEdit(userPrompt, opts?)` | `htmlEdit.ts` | `(userPrompt: string, opts?: AgentOpts) => Promise<string>` | 单文件模式「按需求修改」的调用包装：`label: '修改 HTML'` / `noun: 'HTML'` / `logFile: 'html-agent/chat.jsonl'`（与旧单文件改稿记录同一份）/ `isComplete: isCompleteHtmlEdit` / `truncatedHint: '本轮改动太大被截断：请一次只改一个角色或一小块页面'` |
| `HTML_AGENT_EDIT_SYSTEM` | `htmlEdit.ts` | `const string` | **不挂 `index.ts`**：= `HTML_AGENT_SYSTEM` 逐字打头 + 第 7–10 条（三种输出形式 / 角色必须沿用 / 只能改不能新增 / 角色文件仍是纯绘制函数） |
| `isCompleteHtmlEdit(content)` | `htmlEdit.ts` | `(content: string) => boolean` | **不挂 `index.ts`**：完整性判定，只在 `finish_reason === 'length'` 时被 `chat.ts` 调用——收尾是 `</html>` / `</body>` **或** `<<<END FILE>>>` 都算完整 |
| `AgentProgress` | `html.ts` | `type AgentProgress = AgentProgressPayload` | 进度载荷类型别名（真源在 `src/shared/types.ts`） |
| `AgentOpts` | `html.ts` | `interface` | `{ meta?; maxTokenTries?; onProgress?: (p: AgentProgress) => void }`——只做透传，不含任何 HTML 判定 |
| `SCRIPT_AGENT_SYSTEM` | `script.ts` | `const string` | 内容脚本系统提示词，**12 条硬性要求**（只输出 `{"scenes":[…]}` JSON / `narration` 可直接朗读 / `visual` 是画面分镜（一行一个镜头、行首带时长）/ 时间顺序 / 场景数 / 目标时长字数预算 / 未被要求改的场景逐字保留 / 输出示例 / 允许静音场景 / 错误示例 / **第 12 条角色约定**） |
| `buildScriptPrompt(payload)` | `script.ts` | `(payload: ScriptGeneratePayload) => string` | 拼【要求】/（可选）【角色】+【角色使用约定】/【当前脚本】/【参数】；`cast` 为空或缺省时整块省略（老行为不变） |
| `parseScriptReply(text)` | `script.ts` | `(text: string) => Scene[]` | 去代码围栏 → 依次试「首个 `{` 到末个 `}`」「首个 `[` 到末个 `]`」「原文」→ 取第一个能 `JSON.parse` 且形状可用的；只丢旁白与画面分镜都空的场景、场景截到 30；解析不出则抛错 |
| `registerScript(getProjectDir)` | `script.ts` | `(getProjectDir: (name: string) => string) => void` | 注册 `script:*` 六条 `handle` 与 `script:progress`；**参数只有「项目名 → 项目目录」这一个解析函数**（`src/main/index.ts` 传 `projects.projectDir`） |

### 2.1 `registerScript(getProjectDir)` 注册的七个频道（`script.ts`）

| 频道 | 注册方式 | 行为 |
| --- | --- | --- |
| `script:generate` | `ipcMain.handle` | 校验 `request` 非空（空则直接回一句「请先写下要求…」，**不调模型**）→ 整理上下文场景（只收对象、`slice(0, MAX_SCENES)`、四字段归一化）→ **清洗载荷里的 `cast`** → `buildScriptPrompt()` → `chatWithModel()` → `parseScriptReply()` → `{ ok: true, scenes, totalChars }` |
| `script:load-chat` | `ipcMain.handle` | 载荷 `{ name? }`：**缺项目名回 `{ ok:false, message:'缺少项目名' }`**；否则 `readChatIndex(projectDir(name))` → `{ ok: true, rounds, activeVersionId }`（**不含 scenes**）。没有索引 / 索引损坏 / 版本副本已不存在都是**空列表** |
| `script:append-round` | `ipcMain.handle` | 载荷 `ScriptAppendRoundPayload`：`normalizeScenes()` 后**没有任何场景就回「这一轮没有场景，未写入对话记录」**；否则**先生成 `newVersionId()` 写副本 `writeVersion()`，再 `readChatIndex()` 读回索引、拼上本轮元数据、`writeChatIndex()`**——顺序不能反（写索引会顺带清理不再被引用的旧副本） |
| `script:read-version` | `ipcMain.handle` | 载荷 `{ name?, versionId? }`：缺项目名 / `isValidVersionId` 不过分别回「缺少项目名」/「非法的版本 id」；读不到回「这一版脚本读不到了（副本可能已被删除）」。**只读、无副作用** |
| `script:set-active-version` | `ipcMain.handle` | 同上校验；要求该 `versionId` 确实在 `index.rounds` 里，再把 `activeVersionId` 指过去并 `writeChatIndex()`。**不写 `content.json`** |
| `script:clear-chat` | `ipcMain.handle` | `clearChat(projectDir(name))` 删掉整个 `chat/` 目录（索引 + 全部版本副本），回 `{ ok: true }`。**不动 `content.json` / 编辑器里的场景** |
| `script:progress` | `event.sender.send` | 主 → 渲染：五阶段进度 + 中文 `text`；**只发给发起调用的那个 `event.sender`**（`sender.isDestroyed()` 时静默跳过） |

**`script:generate` 的 `cast` 清洗**：非数组当空 → 丢掉名字为空的 → `slice(0, MAX_CAST = 20)` → 逐条归一（`desc` 截 300 字、`units` 非正数回落 8）→ 随 `buildScriptPrompt()` 进提示词。**主进程只认载荷**：`script.ts` 不读项目 `cast/`、不读全局角色库、不碰 `node:fs`，角色在这里只是一份随请求来的文本上下文。

### 2.2 `chatLog.ts` 的十一个导出（**内部模块，不挂 `index.ts`**）

磁盘布局（本模块只回答「怎么安全地读写这份记录」）：

```
projects/<项目名>/chat/index.json            ← 索引：每轮元数据 + activeVersionId，**不含 scenes**
projects/<项目名>/chat/versions/<id>.json    ← 该轮脚本的完整副本（展开 / 应用时才读）
```

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `MAX_CHAT_ROUNDS` | `const number` | `100`——索引最多保留 100 轮；对应版本副本由 `writeChatIndex` 的清理一并删掉 |
| `chatDirOf(projectDir)` | `(projectDir: string) => string` | `path.join(projectDir, 'chat')`。**收项目目录而不是项目名** |
| `chatIndexPathOf(projectDir)` | `(projectDir: string) => string` | `path.join(chatDirOf(dir), 'index.json')`（私有 `versionsDirOf` / `versionPathOf` 承担 `versions/` 与 `versions/<id>.json`） |
| `isValidVersionId(versionId)` | `(versionId: unknown) => versionId is string` | 白名单 `^[A-Za-z0-9_-]{1,64}$`——`versionId` 会被拼进文件名，**必须挡住路径穿越** |
| `newVersionId()` | `() => string` | `'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)`——排序友好、足够唯一 |
| `normalizeScenes(raw)` | `(raw: unknown) => Scene[]` | 读写共用：非数组当空；场景只留四字段（`id` / `narration` / `visual` / `durHint`）、补 `id`、**截到 `MAX_SCENES = 30`** |
| `readChatIndex(projectDir)` | `(projectDir: string) => ScriptChatIndex` | 索引不存在 / 损坏 / 读失败 ⇒ `{ rounds: [], activeVersionId: '' }`；**逐个丢掉「版本副本已不存在」的条目**；`activeVersionId` 不在活着的轮次里则清成 `''` |
| `writeChatIndex(projectDir, index)` | `(projectDir: string, index: ScriptChatIndex) => void` | 只写元数据：`mkdirSync` 后落 `{ version: 1, updatedAt: ISO, activeVersionId, rounds }`；随后调私有 `pruneVersions()` **删掉不再被索引引用的副本** |
| `writeVersion(projectDir, versionId, scenes)` | `(…) => Scene[]` | 非法 id 抛 `非法的版本 id`、规范化后无场景抛 `这一版没有可用场景`；否则写 `chat/versions/<id>.json` = `{ versionId, createdAt: ISO, scenes }`，**返回已规范化的场景** |
| `readVersion(projectDir, versionId)` | `(…) => Scene[] \| null` | 文件不存在 / 损坏 / id 非法 ⇒ `null`。**只读、无副作用** |
| `clearChat(projectDir)` | `(projectDir: string) => void` | 删整个 `chat/`（索引 + 全部副本），不动 `content.json` |

> 记录目录在 `<项目目录>/chat/`，**不进 `project.json`、不参与 `scanProjects()`**——删掉它只是丢对话历史。

### 2.3 `chatWithModel()` 的关键行为（`chat.ts`）

- **两条等价请求路径**：`loadOpenAI()` 可用时走 SDK（`stream: true` + `stream_options: { include_usage: true }`），否则回退 `fetch ${baseUrl}/chat/completions` 手写 SSE 解析；**两条路径的请求体都带 `reasoning_effort`**；两条路径的 chunk 处理同构（`reasoning_content` 进 `thinkText`、`content` 进正文）。
- **升档重试只三种情形**：本档抛错 → 直接抛（不换档）；`finish_reason === 'length'` 且内容不完整 → `emit('retry')` 换下一档；内容非空且完整 → `emit('done')` 返回正文。
- **进度节流**：`emit()` 只在阶段变化时强推，否则 **300 ms** 一次；`stage` 只会是 `thinking` / `writing` / `retry` / `done`。
- **过程记录**：每次调用向 `userData/<logFile>` 追加一行 JSON，含完整 `messages`、每档 `attempts`（思考原文 / 输出 / `finishReason` / `usage` / `detail` / `needConfig` / 耗时）；写失败静默忽略。
- **最终失败文案三种模板**（截断 / `length` 但无正文 / 空响应），都带 `（usage: …）` 诊断；配置类失败统一经 `friendlyError` 转人话。

### 2.4 `castAction.ts` —— 动作脚本（「角色」页 · 动作示范 · AI 生成专属动作）

**界面上在哪**：「角色」页 · 卡片双击（或右上「…」菜单 ·「动作示范…」）→ 弹窗右侧「本角色专属」那一组 ·「AI 生成…」面板 → 写一句「要什么动作」+ 时长 + 是否循环 → 点「生成」。整条链路：`cast:action-generate`（`projects/ipc/castActions.ts`）→ `buildCastActionPrompt()`（`projects/prompts.ts`）→ **`chatWithCastAction()`（本文件）** → `parseCastActionReply()` + `validateActionCode()` → `upsertAction(root, 'own', …)`。

**`HTML_CAST_ACTION_SYSTEM` 的要点**（7 条硬性要求）：

1. **只输出一个动作块**、不要任何解释文字：`<<<ACTION>>>` / `function (t) { return { aL: 0, aR: 0 }; }` / `<<<END ACTION>>>`。
2. **动作 = 纯函数**：输入 `t`（秒，`0 ≤ t < 时长`），返回这一刻要传给角色的参数对象；同一个 `t` 必须永远返回同一个值（不许 `Date.now()` / `performance.now()` / `Math.random()` / 依赖外部状态）。
3. **只返回这个角色真的会读的参数**：先读用户消息里的【角色源码】，看 `o.xxx` 实际读了哪些键；通用参数（`walk` / `aL`、`aR` / `eyes`、`mouth` / `blink` / `dy`、`dx` / `rot` / `sq`）与方向都在提示词里写明；角色自己多出来的键（如 `o.tail`、`o.ear`）可以照用，但**必须先确认源码里真的读了它**，不要发明参数名。
4. **不画任何东西**：不碰 `ctx` / `canvas` / DOM，不用 `window` / `document` / 定时器 / 循环（`for`、`while`），只用 `Math.sin` / `cos` / `abs` / `min` / `max`、三元与算术，**整段不超过 60 行**。
5. 情绪类的 `eyes` / `mouth` 只能从 `normal` / `happy` / `sad` / `angry` / `surprise` 里取；**`mouth` 尽量别写**（不写时角色会按 `eyes` 自己定嘴型）。
6. **动作要「看得出在干嘛」**：幅度够大（手臂 0.8–1.8、位移 0.3–1u、`sq` 0.1–0.4）；循环动作首尾要接得上（`t = 0` 与 `t = 时长` 时参数一致），一次性动作按用户消息给的时长收住。
7. 只写这一条动作，不顺带改角色画法，不写多个动作。

**`chatWithCastAction(userPrompt, opts?)`**：`chatWithModel` 包装，写死 `label: '生成动作'` / `noun: '动作脚本'` / `logFile: 'html-agent/cast-action.jsonl'` / `isComplete: isCompleteAction` / `truncatedHint: '这条动作太长被截断：把要求写得更简单（少几个部位、少几段）'`；`meta` / `maxTokenTries` / `onProgress` 由 `AgentOpts` 原样透传。**私有 `isCompleteAction`**：有 `<<<END ACTION>>>` 收尾、或以 `}` 收尾（动作就是一个返回对象的函数）都算完整——少了它，被 `finish_reason === 'length'` 截断的完整动作会被当成截断去升档重试，白花一次输出费。

**为什么单独一个文件、不塞回 `html.ts`**：① `html.ts` 已经在 **499 行**、贴着 500 行硬上限；② 这里回答的是**另一个问题**——「这一条动作让角色的参数怎么随时间变」，与「这个人长什么样、怎么摆姿势」不是同一件事；③ 它只需要 `chatWithModel` 一个函数 + `AgentOpts` 一个类型，独立成文件后依赖面最小。

## 3. 关键流程

### 3.1 HTML 生成 / 修改（`projects/` → `agent`）

```
projects/ipc/html.ts  project:generate-html / project:modify-html
  ├─ 拼提示词（内容脚本 / 素材 / 画布 / 成片时长 / 音轨 / 项目已有角色）
  ├─ chatWithCustomModel(userPrompt, { meta, maxTokenTries, onProgress })   ← 来自 '../../agent'
  │     └─ html.ts：system = HTML_AGENT_SYSTEM，user = userPrompt
  │           └─ chat.ts：多轮 + 流式 + 升档重试 + jsonl 落盘 + 人话错误
  ├─ onProgress → project:html-progress（按 taskId 分发）
  ├─ extractHtmlFromReply(正文) → 随包库本地化 → 注入背景音轨 → 合规校验 → 写 index.html
  └─ 返回 { ok, htmlPath, compatible }
```

**章节化分支**：先调 `chatWithChapterPlan` 做结构规划（只输出 `mode` + `chapters`）——`single` 走上面这条原路径（落盘时由 `cast/inject.ts` 注入角色脚本）；`chapters` 则逐章调 `chatWithChapter`。「按需求修改」在章节模式下分两段：先 `chatWithRoute` 报要改哪几份文件，再由 `chatWithChapterEdit` 只带那几份源码定向编辑。**角色不在生成链路里**：新建角色 / 改画法走「角色」页（`chatWithCast`），动作脚本走 §2.4——两者都与「生成 HTML」无关。

**单文件模式的「按需求修改」走另一份提示词**（`htmlEdit.ts`）：`project:modify-html` 的单文件分支用 `chatWithHtmlEdit`，system 用 `HTML_AGENT_EDIT_SYSTEM`；回复里的角色文件块由 `cast/table.ts` 的 `stripCastFileBlocks` / `parseCastFiles` 处理（角色不归改稿写，见 [main/cast.md](./cast.md) §4.2）。**生成（从零做一版）仍走 `chatWithCustomModel`**。

### 3.2 内容脚本生成 / 修改（`renderer` → `agent` → 渲染层）

```
ContentPage/AiChatPanel.vue  window.scriptTools.generate({ name, request, scenes, cast? })
  → script:generate（agent/script.ts 的 registerScript）
      ├─ 清洗载荷：scenes（形状合法 + slice(0, MAX_SCENES)）
      │             cast（名字非空 + slice(0, MAX_CAST=20) + desc 截 300 + units 非正数回落 8）
      ├─ buildScriptPrompt() = 【要求】 + （cast 非空时）【角色】+【角色使用约定】 + 【当前脚本】 + 【参数】
      ├─ chatWithModel()（流式，onProgress → script:progress）
      ├─ parseScriptReply() → Scene[]
      └─ { ok, scenes, totalChars } | { ok:false, message, raw? }
  → 渲染层整份写回编辑器 → 自动保存（防抖 600ms）写 project:save-content
```

- **提示词里【角色】块的位置**：在【要求】之后、【当前脚本】之前。
- **`cast` 为空 / 缺省 = 整块省略**：源码注释写死「没选角色时提示词必须与加这个字段之前逐字一致（老行为不变）」。
- **角色只影响文本**：`cast` 不进 `scenes`、不进 `content.json`、不进 `project.json`。

## 4. 依赖与协作

**目录内 import**（单向）

| 文件 | import 自 | 引入内容 |
| --- | --- | --- |
| `index.ts` | `./chat` | `chatWithModel`、`MAX_TOKEN_TRIES`、`type ChatMessage`、`type AgentChatOptions` |
| `index.ts` | `./html` | `HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、`HTML_PLAN_SYSTEM`、`chatWithChapterPlan`、`HTML_CHAPTER_SYSTEM`、`chatWithChapter`、`HTML_CHAPTER_EDIT_SYSTEM`、`chatWithChapterEdit`、`HTML_CAST_SYSTEM`、`chatWithCast`、`HTML_ROUTE_SYSTEM`、`chatWithRoute`、`type AgentOpts`、`type AgentProgress` |
| `index.ts` | `./castAction` | **`HTML_CAST_ACTION_SYSTEM`、`chatWithCastAction`（两行）** |
| `index.ts` | `./script` | `SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、`registerScript` |
| `index.ts` | `./htmlEdit` | `chatWithHtmlEdit`（**只这一个名字**） |
| `html.ts` | `./chat` | `chatWithModel` |
| `castAction.ts` | `./chat` | `chatWithModel` |
| `castAction.ts` | `./html` | **只有 `type AgentOpts`**（引不到实现） |
| `htmlEdit.ts` | `./chat` | `chatWithModel` |
| `htmlEdit.ts` | `./html` | `HTML_AGENT_SYSTEM`、`type AgentOpts` |
| `script.ts` | `./chat` | `chatWithModel` |
| `script.ts` | `./chatLog` | `clearChat`、`isValidVersionId`、`newVersionId`、`normalizeScenes`、`readChatIndex`、`readVersion`、`writeChatIndex`、`writeVersion` |

**目录外 import**

| 来源 | 引入内容 | 所在文件 |
| --- | --- | --- |
| `electron` | `app`（jsonl 记录写 `userData`）；`ipcMain`（注册 `script:*` 中的六条 `handle`） | `chat.ts` / `script.ts` |
| `node:path` / `node:fs` | 日志文件路径拼装与追加写；对话记录的目录 / 索引 / 副本读写与清理 | `chat.ts` / `chatLog.ts` |
| `../settings` | `getCustomModel`（模型配置）、`loadOpenAI`（SDK 懒加载入口） | `chat.ts` |
| `../../shared/errors` | `friendlyError`（人话文案）；`configTargetOf`（给失败体补 `needConfig`） | `chat.ts` / `script.ts` |
| `../../shared/constants` | `EST_CHARS_PER_SEC`（估时语速 4 字/秒） | `script.ts` |
| `../../shared/ipc` | `IPC`（`IPC.Script.*`） | `script.ts` |
| `../../shared/types` | `AgentProgressPayload`、`ConfigTarget`、`Scene`、`ScriptChatIndex`、`ScriptChatRoundMeta`、`ScriptAppendRoundPayload`、`ScriptCastRef`、`ScriptGeneratePayload`、`ScriptGenerateReply`、`ScriptProgressPayload`、`ScriptVersionResult` | `chat.ts` / `chatLog.ts` / `script.ts` |

**被谁引用 / 影响谁**

| 位置 | 关系 |
| --- | --- |
| `src/main/projects/ipc/html.ts` 等四个域 | 从 `'../../agent'` 取 `chatWithCustomModel` / 章节模式几个包装 / `chatWithHtmlEdit` / `chatWithCast` / `chatWithRoute` / `extractHtmlFromReply` / **`chatWithCastAction`**（只有 `ipc/castActions.ts` 用后两个之一） |
| `src/main/index.ts` | `import * as agent from './agent'`；注册段调 **`agent.registerScript(projects.projectDir)`**——把「项目名 → 项目目录」注入进来，**agent 因此不反向 import projects** |
| `src/preload/index.ts` | `scriptTools`（7 个方法，含 `onProgress`）；`castTools.onTaskProgress` 与 `projectTools.onTaskProgress` 共用同一条 `project:html-progress` 频道与同一张订阅表 |
| `src/renderer/src/pages/ContentPage/` | 「AI 创作」Tab：`window.scriptTools.generate()` + 对话记录五条 + `onProgress` |
| `src/renderer/src/pages/CastPage/CastActionModal.vue` | 通过 `castTools.generateAction` → `cast:action-generate` → **`chatWithCastAction`**，进度按 `taskId` 订阅 |

## 5. 注意事项与实现要点

### 5.1 七条边界（这几条就是每个文件的规格）

| 文件 | 认识什么 | 不认识什么 | 碰文件吗 |
| --- | --- | --- | --- |
| `chat.ts` | 只有「怎么问模型」：多轮消息 / 流式 / 升档重试 / 记录 / 错误翻译 | **任何业务**：系统提示词、完成判定、日志路径、错误文案全由调用方传入 | 只写 `userData/<logFile>` 这一份 jsonl（失败静默）；**不读写任何项目文件** |
| `chatLog.ts` | 只有「对话记录长什么样、怎么安全地读 / 写 / 清理」 | 提示词、模型、IPC、项目名的规则（**收项目目录、不收项目名**） | **只碰** `projects/<项目名>/chat/` |
| `html.ts` | 只有 HTML 这一个业务：提示词、回复提取、完成判定、日志文件名、错误文案 | 传输细节、`electron` 对话框、`node:fs` / `node:path`、IPC、**动作脚本（在 `castAction.ts`）** | **不碰**：`index.html` 由 `projects/` 写 |
| `htmlEdit.ts` | 只有「单文件模式的改稿」 | 传输细节、章节模式那几份提示词、`electron` / `node:fs` / `node:path`、IPC | **不碰**：`index.html` 与 `cast/<id>.js` 都由 `projects/` 写 |
| `castAction.ts` | 只有「一条动作脚本怎么问出来」：`HTML_CAST_ACTION_SYSTEM` + 完整性判定 + 三个文案参数 | 传输细节、角色文件怎么写（那是 `html.ts` 的 `HTML_CAST_SYSTEM`）、动作存哪（那是 `cast/actions.ts`）、IPC | **不碰**：动作的落盘在 `projects/ipc/castActions.ts` |
| `script.ts` | 只有内容脚本这一个业务：提示词、用户提示拼装、JSON 解析、`cast` 清洗、自己的七个 `script:*` 频道 | 传输细节、`settings` / `projects` / `hfEnv`、项目文件格式、**项目 `cast/` 目录与全局角色库** | **不碰**：场景落盘走 `project:save-content` |
| `index.ts` | 只有五个子文件的具名导出清单与依赖方向 | 一切实现细节与业务 | **不碰**：文件里没有任何 I/O 语句 |

1. **`chat.ts` 不认识任何业务**：`label` / `noun` / `logFile` / `isComplete` / `truncatedHint` 全部由调用方传入。
2. **`chat.ts` 不碰项目文件**：唯一的文件写入是 `userData/<logFile>` 的 jsonl 过程记录。
3. **`chatLog.ts` 不认业务也不认项目名**：它只要一个**项目目录**，目录由 `script.ts` 用注入的 `projectDirOf` 算出来。
4. **`html.ts` / `script.ts` / `htmlEdit.ts` / `castAction.ts` 不认业务之外的事**。
5. **`index.ts` 只再导出**：加一个新 Agent 时只在本文件补一行导出，调用方仍然只 `from '../../agent'`。`chatLog.ts` 刻意不进这份清单；`htmlEdit.ts` 只挂 `chatWithHtmlEdit`；**`castAction.ts` 的两个名字都挂**（提示词与调用都是对外契约，测试要用）。
6. **`htmlEdit.ts` 只回答「单文件模式怎么改稿」**：提示词 = 单文件生成契约 + 一段追加规则，不另起一份完整提示词。
7. **`castAction.ts` 只回答「一条动作脚本怎么问出来」**：它不判断动作合不合法（`cast/actions.ts` 的 `validateActionCode` 管）、不决定存哪（`upsertAction` 管）、不拼示范页（`cast/demo.ts` 管）。

### 5.2 目录为什么存在（形态变化的由来）

- **依据是既有的工程约定**：根 `AGENTS.md` 关键约定 9 规定「一个模块拆成多文件时，建**同名目录 + `index.ts` 作统一出口**」。`src/main/updater/` 早就是这套形态的样板；Agent 原先平铺在 `src/main/` 顶层，既不符合约定、也让「Agent 层」在目录里看不出来。
- **行为零变化**：频道名 / 载荷 / preload / 渲染层全都不动；`main/index.ts` 的注册顺序不变（`projects.register(ctx)` 之后、`voice.register(ctx)` 之前调 `agent.registerScript(projects.projectDir)`）。
- **唯一的改名是 `register` → `registerScript`**：同一个目录里从此有「HTML 侧入口」与「脚本侧入口」两个 register 语境。
- **`chatLog.ts` 为什么单独一个文件**：「对话记录的磁盘读写」和「内容脚本 Agent 的提示词 / 解析 / IPC」是两件事——记录要按项目落盘，读写必须和生成链路解耦。
- **`castAction.ts` 为什么单独一个文件**：见 §2.4（`html.ts` 已 499 行、贴着 500 行硬上限；且「动作」与「角色长相」是两件事）。
- **行数仍在硬线内**：265 / 155 / **499** / 52 / **367** / **66** / **21** 全部低于 500 行（300 行是「考虑拆」的阈值；`html.ts` 499、`script.ts` 367 各自仍只回答一个问题——`html.ts` 涨的是提示词份数与条数，`script.ts` 涨的是系统提示词第 12 条 + 角色块拼装 + `cast` 清洗）。**`html.ts` 现在只剩 1 行余量**：再加内容就必须先拆（`castAction.ts` 就是上一轮这么分出去的）。

### 5.3 其余实现要点

- **日志文件位置**：`userData/html-agent/chat.jsonl`（单文件生成 / 改稿）、`userData/html-agent/cast.jsonl`（画角色 / 改画法）、`userData/html-agent/route.jsonl`（改稿路由）、**`userData/html-agent/cast-action.jsonl`（动作脚本）**、`userData/script-agent/chat.jsonl`（内容脚本）。目录不存在时由 `logConversation` 自建。
- **HTML 系统提示词刻意不含视觉风格**：整片要多深多亮、什么配色，由用户在**「HTML生成」页 · 全局视觉风格 输入框**填，主进程把它拼成用户消息里的【全局视觉风格】块（见 [projects.md](./projects.md)）。
- **`./core.js` 写进提示词、却不进「随包库清单」**：它由应用内置、按 `CORE_VERSION` 同步进每个项目，页面里的引用恒为 `./core.js`。提示词里只讲 API（`MC.*`），不讲「从哪加载」。
- **`chatWithModel` 的调用方**：`html.ts`（`chatWithCustomModel` + 章节 / 角色 / 路由四个包装）、`htmlEdit.ts`（`chatWithHtmlEdit`）、**`castAction.ts`（`chatWithCastAction`）**、`script.ts`。新增「对话式操作」时按同样形态再写一个薄封装（提示词 + 完成判定 + 三个文案参数），传输层继续复用 `chat.ts`。
- **`MAX_TOKEN_TRIES` 可被调用方覆盖**：`AgentOpts.maxTokenTries` 原样透传；不传就走 `[131072, 262144]`。
- **`AgentProgress` 是别名而不是新类型**：真源是 `src/shared/types.ts` 的 `AgentProgressPayload`。
- **`script.ts` 有 `MAX_SCENES` 与 `MAX_CAST` 两个上限常量、没有语速常量**：`EST_CHARS_PER_SEC` 从 `@shared/constants` 引入；`chatLog.ts` 里另有一份同值的 `MAX_SCENES = 30`（读写共用），两者互不引用。

## 6. 相关文档

- HTML 链路全貌：[01-架构总览.md](../../01-架构总览.md) §5.1；内容脚本链路（含对话记录）：同文件 §5.5
- 调用方：[main/projects.md](./projects.md)（`project:generate-html` / `project:modify-html` / `ipc/castActions.ts`）、[main/index.ts.md](./index.ts.md)（注册顺序与 `projects.projectDir` 注入）
- 角色与动作：[main/cast.md](./cast.md)（`edit.ts` 拼块与剥块、`actions.ts` 动作库、`demo.ts` 示范页）
- 共享绘制助手的真身：[main/coreLib.ts.md](./coreLib.ts.md)（版本同步）与 `vendor/shadowmill/core.js`（`MC` 的实现，当前 `CORE_VERSION = '7'`）
- 共享契约：[shared/types.ts.md](../shared/types.ts.md)（`AgentProgressPayload` / `ScriptCastRef` / **`CastActionDef` / `CastActionGeneratePayload`**）、[shared/ipc.ts.md](../shared/ipc.ts.md)（`Script` 分组 7 条、**`Cast` 分组 11 条**）、[shared/errors.ts.md](../shared/errors.ts.md)、[shared/constants.ts.md](../shared/constants.ts.md)（`EST_CHARS_PER_SEC` / `CAST_ACTION_*`）
- 同形态的样板目录：[main/updater.md](./updater.md)
