# src/main/agent/（Agent 层）

> Agent 层：**一个通用对话传输 + 两个业务薄封装 + 一份对话记录读写（索引 + 每版副本）+ 一个纯出口**。**一个模块、五个文件**：同名目录 + `index.ts` 统一出口，对外接口与拆分前逐字相同（`import { chatWithCustomModel, extractHtmlFromReply, type AgentProgress } from './agent'` 即全部改动）。HTML 这一侧从此有 **6 份系统提示词**（单文件 / 结构规划 / 单章 / 单章修改 / **角色文件** / **改稿路由**）与对应的调用包装。

- **覆盖文件**：`agent/chat.ts`（261 行）、`agent/chatLog.ts`（155 行）、`agent/script.ts`（331 行）、`agent/html.ts`（**485** 行）、`agent/index.ts`（16 行）——行数为工作区实测（`[IO.File]::ReadAllLines`）
- **所在目录**：src/main/agent/
- **类型**：业务域模块之一（`script.ts` 注册 `script:*` **七个**频道；`chatLog.ts` 只做磁盘读写、不注册 IPC；`chat.ts` / `html.ts` / `index.ts` 不注册任何 IPC）；形态是「同名目录 + `index.ts` 统一出口」（与 `src/main/updater/` 同一套工程约定，见根 `AGENTS.md` 关键约定 9）
- **对外导出**（经 `index.ts` 再导出，共 **19 个值 + 4 个类型**）：`chatWithModel`、`MAX_TOKEN_TRIES`、`HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、**`HTML_PLAN_SYSTEM`**、**`chatWithChapterPlan`**、**`HTML_CHAPTER_SYSTEM`**、**`chatWithChapter`**、**`HTML_CHAPTER_EDIT_SYSTEM`**、**`chatWithChapterEdit`**、**`HTML_CAST_SYSTEM`**、**`chatWithCast`**、**`HTML_ROUTE_SYSTEM`**、**`chatWithRoute`**、`SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、**`registerScript`**（原 `register`，改名）；类型 `ChatMessage`、`AgentChatOptions`、`AgentOpts`、`AgentProgress`
- **不由 `index.ts` 再导出的内部模块**：`chatLog.ts` 的 **11 个具名导出**（`MAX_CHAT_ROUNDS`、`chatDirOf`、`chatIndexPathOf`、`isValidVersionId`、`newVersionId`、`normalizeScenes`、`readChatIndex`、`writeChatIndex`、`writeVersion`、`readVersion`、`clearChat`）**只给同目录的 `script.ts` 用**——外部（`projects.ts` / `main/index.ts`）不需要、也拿不到它，`index.ts` 的导出清单与上一版逐字相同
- **IPC 域**：`script:generate` / `script:load-chat` / `script:append-round` / `script:read-version` / `script:set-active-version` / `script:clear-chat`（**六条 `ipcMain.handle`**）+ `script:progress`（`event.sender.send` 推送）。全库频道数为 **11 分组 / 100 频道**，preload 的 12 个命名空间不变（**本轮新增的 2 条角色频道 `project:new-cast` / `project:save-cast` 在 `Project` 组，不在本目录**）
- **调用方**（两处，各自只改一行 import）：`src/main/projects.ts` 的 `import { chatWithCustomModel, extractHtmlFromReply, type AgentProgress } from './agent'`（目录化重构前它指向主进程顶层的旧文件，见 §5.2）；`src/main/index.ts` 的 `import * as agent from './agent'`（同理，重构前指向旧文件）+ 注册段的 **`agent.registerScript(projects.projectDir)`**

## 1. 五个文件的分工与依赖方向

| 文件 | 行数 | 职责 | 该文件的关键名字 |
| --- | --- | --- | --- |
| `chat.ts` | 261 | **通用对话层 / 依赖最上游**：多轮 `messages` + 流式输出（`openai` SDK 与手写 `fetch` SSE 两条等价路径）+ `max_tokens` 升档重试 + 全过程 jsonl 记录 + 人话错误文案 + 300 ms 节流进度。**不 import 同目录任何模块**，只依赖 `../settings`（`getCustomModel` / `loadOpenAI`）与 `../../shared/{errors,types}` | `ChatMessage`、`AgentChatOptions`、`MAX_TOKEN_TRIES`、`chatWithModel`（私有 `logConversation`） |
| `chatLog.ts` | 155 | **对话记录的磁盘读写 / 只认文件、不认识提示词**：目录与路径拼装（`chat/` + `chat/index.json` + `chat/versions/<id>.json`）+ 读索引 + 写索引（写后清理不再被引用的版本副本）+ 读 / 写单版副本 + 规范化 + 清空（删整个 `chat/`）。只依赖 `node:fs` / `node:path` / `../../shared/types`；不注册 IPC、不碰模型 | `MAX_CHAT_ROUNDS = 100`、`chatDirOf`、`chatIndexPathOf`、`isValidVersionId`、`newVersionId`、`normalizeScenes`、`readChatIndex`、`writeChatIndex`、`writeVersion`、`readVersion`、`clearChat`（私有 `MAX_SCENES = 30` / `VERSION_ID_RE` / `versionsDirOf` / `versionPathOf` / `normalizeRoundMeta` / `pruneVersions`） |
| `html.ts` | **485** | **HTML 这一个业务的全部特殊性**：系统提示词（单文件一份 + 章节模式五份：结构规划 / 单章 JS / 单章修改 / **角色文件** / **改稿路由**）+ 回复提取 + `chatWithCustomModel()` 与章节模式三个调用包装 + **角色与路由两个新包装**（业务参数写死）。只 `import { chatWithModel } from './chat'`。**角色表那轮先 −8 行、再 +18 行、再 +16 行**：删掉 `HTML_PLAN_SYSTEM` 里整套「角色表输出规则」与带 `cast` 的示例、`HTML_CHAPTER_SYSTEM` 第 6.5 条改成「用户消息的【项目角色】是**已注入页面**的角色，调用它们、不许重画」、`HTML_CHAPTER_EDIT_SYSTEM` 改成「角色表不归你管」；随后 `HTML_CHAPTER_SYSTEM` 第 11 条补 `MC.castLayer` / `MC.clearLayer`、**新增第 12 条「分层」**，`HTML_CHAPTER_EDIT_SYSTEM` 编号 12 → **13**；最后把单文件与章节的 **p5 段都改成「实例模式」模板**。**本轮 462 → 485 行 / 38,685 字节**：单文件 p5 段模板的 `p.draw` 展开成 5 行（加 `p.translate(-W / 2, -H / 2)`）、章节 p5 段同样加 translate 并补「WEBGL 原点 + 11 种笔型」3 行、`HTML_AGENT_SYSTEM` 第 2 条补两条渲染技术子项、两处 `MC.paint(pts, opts)` 的 opts 补 `br`，最后两处再各加 6 行**水彩预设**说明（`preset` / 5 档效果 / `soak` 会糊轮廓 / **质感来自 `fill`** / 显式键优先） | `HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、`HTML_PLAN_SYSTEM`、`chatWithChapterPlan`、`HTML_CHAPTER_SYSTEM`、`chatWithChapter`、`HTML_CHAPTER_EDIT_SYSTEM`、`chatWithChapterEdit`、**`HTML_CAST_SYSTEM`**、**`chatWithCast`**、**`HTML_ROUTE_SYSTEM`**、**`chatWithRoute`**、`type AgentProgress`、`interface AgentOpts`（私有 `isCompleteHtml`） |
| `script.ts` | 331 | **内容脚本 Agent**：提示词 / 用户提示拼装 / JSON 解析 / **七个 `script:*` 频道注册**（生成 1 + 对话记录 5 + 进度 1）/ 项目目录注入。`import { chatWithModel } from './chat'` + `import { clearChat, isValidVersionId, newVersionId, normalizeScenes, readChatIndex, readVersion, writeChatIndex, writeVersion } from './chatLog'`，另依赖 `../../shared/{errors,ipc,types,constants}` 与 `electron` 的 `ipcMain`（**语速口径 `EST_CHARS_PER_SEC` 从 `../../shared/constants` 引入，本文件不再自带语速常量**）。**不 import `node:fs` / `node:path`**（落盘全在 `chatLog.ts`），**不 import `projects`**（项目目录由 `index.ts` 注入） | `SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、**`registerScript`**（私有 `MAX_SCENES = 30` / `progressText` / 模块级 `projectDirOf` / `projectDir()`） |
| `index.ts` | 16 | **统一出口**：`export … from './chat' / './html' / './script'` **只做再导出、不写任何逻辑**（**不含 `./chatLog`**）；文件头注释记着四个子文件的一句话说明与依赖方向 | `chatWithModel`、`MAX_TOKEN_TRIES`、`ChatMessage`、`AgentChatOptions`、`HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、`HTML_PLAN_SYSTEM`、`chatWithChapterPlan`、`HTML_CHAPTER_SYSTEM`、`chatWithChapter`、`HTML_CHAPTER_EDIT_SYSTEM`、`chatWithChapterEdit`、`HTML_CAST_SYSTEM`、`chatWithCast`、`HTML_ROUTE_SYSTEM`、`chatWithRoute`、`AgentOpts`、`AgentProgress`、`SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、`registerScript` |

**依赖方向单向、不成环**（设计要求）：

```
index.ts  ──→  html.ts   ──┐
（出口）                     ├──→  chat.ts
               script.ts ──┴──→  chatLog.ts        （chat.ts 最上游：只依赖 ../settings 与 ../../shared/*）
                                 （chatLog.ts：只依赖 node:fs / node:path / ../../shared/types）
```

- `chat.ts` **一行同目录 import 都没有**——它是传输层的唯一宿主，所以五个文件之间不会互相 import 成环。
- `html.ts` / `script.ts` 都只从 `./chat` 取 `chatWithModel` 这一个名字；两者之间**互不 import**。
- `script.ts → chatLog.ts` 是**单向**的：`chatLog.ts` 不 import 同目录任何模块，也不知道「谁在用它」；**11 个导出（目录 / 索引 / 版本副本 / 清理 / 清空）+ 规范化**都收在它里面，`script.ts` 只剩「项目名 → 项目目录 → 调函数」。
- `index.ts` 分别从 `./chat`、`./html`、`./script` 取具名导出并原样挂出，**自身不声明任何函数 / 常量**，**也不再导出 `chatLog.ts` 的任何东西**（它是内部实现细节）。

## 2. 对外接口（19 个值 + 4 个类型挂在 `index.ts` 上）

| 名称 | 定义在 | 类型 | 说明 |
| --- | --- | --- | --- |
| `chatWithModel(messages, opts)` | `chat.ts` | `(messages: ChatMessage[], opts: AgentChatOptions) => Promise<string>` | 调自定义模型并流式接收；成功返回**模型正文**（思考内容只进日志与进度，绝不混进返回值）；失败抛 `Error`（`message` 已是人话） |
| `ChatMessage` | `chat.ts` | `interface` | `{ role: 'system' \| 'user' \| 'assistant'; content: string }`；多轮顺序由调用方排（system 在最前） |
| `AgentChatOptions` | `chat.ts` | `interface` | 8 个字段：`label` / `noun` / `logFile` / `isComplete?` / `truncatedHint?` / `meta?` / `maxTokenTries?` / `onProgress?` |
| `MAX_TOKEN_TRIES` | `chat.ts` | `const number[]` | `[32768, 65536]`——升档序列；8192 / 16384 实测会被 thinking 阶段耗尽，故直接 32768 起步 |
| `HTML_AGENT_SYSTEM` | `html.ts` | `const string` | HTML Agent 系统提示词，**5 条编号硬性要求**（完整 HTML 文档 / HyperFrames 规范（`data-composition-id`、`./gsap.min.js`、`gsap.timeline({ paused: true })`、以 composition id 为键的 `__timelines`、按【画布】写死 `data-resolution` 与固定 px 舞台，第 2 条下**共 15 条子项、与渲染技术相关的 10 条**：① **随包库清单**——除 `./gsap.min.js` 外，应用还随项目提供 `./p5.min.js`（p5 **2.3.3**）与 `./p5.brush.js`（p5.brush **2.2.3**）：前者供程序化 / WebGL 逐帧绘制，后者供水彩、笔刷、渗色这类手绘笔触，两者同样禁止改用任何 CDN 地址，且**都是可选项**——能用 DOM/CSS + GSAP 做出画面就不要引入 p5；② **画面默认用 DOM/CSS + GSAP 完成**，只有确实需要逐帧绘制时才改用 canvas：2D 用 Canvas 2D 或 p5（要笔刷 / 水彩笔触时配 p5.brush），3D 用 three.js 并以 ESM 引入（在 `<head>` 先写 `<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.170.0/build/three.module.js"}}</script>`，再用 `<script type="module">import * as THREE from "three"</script>`；three 只允许这一个 CDN 地址，GSAP 仍必须用本地 `./gsap.min.js`、不得改成 CDN）；③ **逐帧绘制必须由 GSAP 时间轴驱动**——把绘制写在 `tl.to({v:0}, {v:1, duration:<成片时长>, ease:"none", onUpdate: function () { draw(tl.time()); }})` 的 `onUpdate` 里；`draw(t)` 必须只由 `t` 决定：禁止 `Date.now()` / `performance.now()` / 帧计数器 / 未设种子的随机数，禁止依赖上一帧留下的状态；④ **p5 必须走实例模式**（`new p5(fn, stage)` + `p.createCanvas(W, H, p.WEBGL)` + `pixelDensity(1)` + `noLoop()`，绘制写在 `p.draw()` 里）；⑤ **画布必须挂进 `data-composition-id` 舞台容器**——p5 用 `createCanvas(宽, 高).parent("<data-composition-id 那个元素的 id>")`，Canvas 2D 用 `stage.appendChild(canvas)`；**不能留在 `<body>` 上**——渲染器只截 `data-composition-id` 那个元素，画布挂在 body 上会截到空容器，成片全黑且不报错；⑥ **p5 的时序写法**——`createCanvas` 之后紧接着 `pixelDensity(1)` 与 `noLoop()`，p5 因此不再自动循环、重绘只由 `redraw()` 触发；绘制逻辑写在全局 `draw()` 里，并在 GSAP 的 `onUpdate` 里调用 `redraw()`——不要用 `requestAnimationFrame`，也不要调 `loop()`；⑦ **p5.brush 最小用法**——先 `brush.scaleBrushes(4)` 统一笔刷比例，再 `brush.noStroke()` 或 `brush.noHatch()`；填充形用 `brush.fill(颜色, 透明度)` 配 `brush.fillBleed(0~1)` / `brush.fillTexture(0~1, 0~1)`，最后 `brush.polygon([[x, y], ...])` 画出来；⑧ **WEBGL 的原点在画布中心**（Canvas 2D 与分镜坐标都按左上角写）——p5 用 WEBGL 时必须在 `p.draw()` 开头 `p.translate(-宽/2, -高/2)`，否则同一份坐标画出来整体偏半个画布（实测偏 (+W/2, +H/2)）；⑨ **p5.brush 只认这 11 种笔型**（pen / rotring / 2B / HB / 2H / cpencil / pastel / crayon / charcoal / spray / marker），**`ink` 不是笔型**（它是墨线颜色），写成笔型名会报 `Brush "ink" not found` 并让那一个形状的描边整段失效）；⑩ canvas 与 three.js 的渲染尺寸按【画布】写死像素值，不要用 CSS 自适应缩放 / 字幕逐条依次播放入场 / 字幕严格按起止时间 / 只输出 HTML 源码）。`MC.paint` 段另有 6 行「**水彩质感一律用 `preset`，不要自己拧 `bleed / tex / fillOp`**」：示例 `MC.paint(pts, { preset: "soak", wash: "#8EC3E6", fill: "#D97757" })`、5 档效果（`wash` 纯底色 / `soak` 渗色最重最像手绘水彩 / `grain` 湿纸颗粒 / `light` 淡彩远景阴影 / `inked` 带炭笔勾线）、`soak` 会把颜料糊出形状外所以角色 / 物体用 `grain` 或 `wash`、**质感来自 `fill`**（只给 `wash` 是平底色）、预设没盖住的键可显式写且**你写的键优先**（含 `ink: null`）。**这里只放硬性结构契约、刻意不含任何视觉风格**：整片要多深多亮、用什么配色，由用户在「HTML生成」页 · 全局视觉风格 输入框决定（主进程 `projects.ts` 的 `buildStyleBlock()` 把它拼成用户消息里的【全局视觉风格】块），也可写在同一页的「需求描述」里；理由是这 5 条每一条都是硬性要求，这里一旦写死某种配色，用户的选择就会被压掉（想换浅色 / 别的风格都改不动） |
| `extractHtmlFromReply(text)` | `html.ts` | `(text: string) => string` | 兼容 Markdown 代码块：先取 ```` ```html ```` 围栏内容，否则从首个 `<!DOCTYPE html` / `<html` 起截到底，都没有就原样返回 |
| `chatWithCustomModel(userPrompt, opts?)` | `html.ts` | `(userPrompt: string, opts?: AgentOpts) => Promise<string>` | 组装 `[system: HTML_AGENT_SYSTEM, user: userPrompt]` 后交给 `chatWithModel`；写死 `label: '生成 HTML'` / `noun: 'HTML'` / `logFile: 'html-agent/chat.jsonl'` / `isComplete: isCompleteHtml` / `truncatedHint: '请精简字幕/素材或更换模型'` |
| `HTML_PLAN_SYSTEM` | `html.ts` | `const string` | 结构规划提示词：**只输出 JSON**，判这支片子写一份 `index.html`（`single`）还是拆成若干章（`chapters`）；章节清单里带 `uses`（本章要用哪些随包库，见 `ProjectChapter`）。**输出只剩 `mode` + `chapters`**：整套角色表规则（顶层 `cast`、每章 `cast` 点名、一次性道具不建角色）与带 `cast` 的示例**已从提示词删除**，并明确写「不要输出角色表、也不要在章里用 `cast` 字段：角色是项目素材（用户在「项目素材」区勾选），由应用注入页面，与拆分方式无关」 |
| `chatWithChapterPlan` | `html.ts` | 调用包装 | 规划调用；回复里的 `<<<PLAN>>>` 块由 `chapters.ts` 的 `parsePlanReply` 解析（**只读 `mode` / `chapters`**，回复里若还有 `cast` 字段会被忽略） |
| `HTML_CHAPTER_SYSTEM` | `html.ts` | `const string` | 一章的 JS 契约（**1–12 条**）；**第 5 条「可用库」**写明章节脚本不许写 `<script>`，本章要用 p5 / p5.brush 只能在 `uses` 里声明，且**用 p5 必须走实例模式**（`new p5(fn, stage)` + `p.createCanvas(W, H, p.WEBGL)` + `pixelDensity(1)` + `noLoop()` + `window.__p5Active = p` + `brush.load()` + `brush.scaleBrushes(4)`；**绘制一律写在 `p.draw()` 里**（addon 在 predraw/postdraw 自动激活实例），每帧只需 `window.__brushT = t; inst.redraw()`——对外**没有** `brush.activateInstance` / `deactivateInstance`（实测报 `is not a function`），要显式激活只能用 `brush.instance(p)`；`p.draw` 模板带 `p.clear()` + `p.translate(-W / 2, -H / 2)`，同段还补了「**WEBGL 的原点在画布中心**（不 translate 就整体偏半个画布）」与「**p5.brush 只认 11 种笔型、`ink` 不是笔型**」两句（补进第 7 条 p5 那一段、**没有新增编号条目**）；**不要用全局 `createCanvas` / `background` / `requestAnimationFrame` / `loop`，画布禁止整屏填底色**；p5.brush **强制 WEBGL**、没有 Canvas 2D 退路）；**第 6.5 条「角色必须用共享角色库画、不许在本章里重画」**——**用户消息的【项目角色】列出的是「已经注入页面」的角色**（骨架已引入它们的 `cast/*.js`），调用方式 `window.__cast["hero"](x, y, u, { ctx: ctx2d, … })`（`ctx` 必须传，本章没建 canvas 就先建一张挂进 stage）；表里没列出 = 页面里没有，不要调用；也不要修改角色文件、不要重复实现它们的绘制代码；**第 11 条是「共享绘制助手」**——`./core.js` 的全局对象 `MC`：`MC.paint(pts, opts)`（传 `ctx` 走 Canvas 2D 平涂、不传走 p5.brush 水彩；opts 现在是 `{ ctx, wash, washOp, fill, fillOp, bleed, tex, ink, sw, br, hatch, alpha }`，其中 `br` 是**描边用的笔型**、默认 `pen`、不是颜色；并多了 6 行「**水彩质感一律用 `preset`，不要自己拧 `bleed / tex / fillOp`**」——5 档 `wash` / `soak` / `grain` / `light` / `inked`、`soak` 会把颜料糊出形状外所以角色 / 物体用 `grain` 或 `wash`、**质感来自 `fill`**（只给 `wash` 是平底色）、预设没盖住的键可显式写且**你写的键优先**（含 `ink: null`））、点列 `MC.ellPts / rrPts / starPts / linePts`、缓动与关键帧 `MC.clamp / lerp / ease / easeOut / easeIn / backOut / kf`，**抖动一律 `MC.jit(seed, amp)`、绝不要用 `Math.random()`**（每次不一样，seek 之后画面不可重现），并在条末引出 **`MC.castLayer(stage, 宽, 高)` / `MC.clearLayer(ctx)`**；**第 12 条「分层（角色怎么显示）」**——角色**永远画在自己那张透明画布上**、叠在背景（`<video>` / `<img>` / DOM / 背景画布）之上：`var layer = MC.castLayer(stage, 宽, 高)` 拿 `layer.ctx` 传给角色，**每帧先 `MC.clearLayer(layer.ctx)` 再画**，**禁止在角色层 fillRect 整屏底色**（会把视频 / 图片 / DOM 盖死，最常见的翻车点）；只有「整页都是代码画的、下面没有任何素材」时角色才可以进主画布（即便如此也推荐分层）；角色要被画面遮挡需自己拆前 / 中 / 背景三层 |
| `chatWithChapter` | `html.ts` | 调用包装 | 逐章生成调用（一章一个 JS） |
| `HTML_CHAPTER_EDIT_SYSTEM` | `html.ts` | `const string` | = 章节契约 + 修改规则：**只交改动过的章**（或改动过的那一个角色文件）；改结构（增删章 / 改时长）要先交一份完整新 PLAN（**只有 `chapters`**）；**「角色表不归你管」**（它在「项目素材」区由用户勾选 / 新建，模型**只可能被要求改某个已有角色的画法**，那就只改 `cast/<id>.js` 这一个文件）；**编号从 13 起**（章节契约已到 12），要求改结构时 `uses` 照实改 |
| `chatWithChapterEdit` | `html.ts` | 调用包装 | 定向编辑调用：只带被点名的那几份源码（`<<<CURRENT 路径>>>` 包起来），模型自报改了哪几份 |
| `HTML_CAST_SYSTEM` | `html.ts` | `const string` | **角色文件的契约（1–10 条）**：一份文件只画一个人（`window.__cast[id] = function (x, y, u, o) {…}`）；`(x, y)` 是**脚底中点**、`u` 是**1 个单位的像素高度**，所有尺寸按 `u` 的倍数绘制；必须支持 `o` 里的 `eyes` / `mouth` / `aL` / `aR` / `dy` / `sq` / `rot` / `flip` / `col` / `alpha`（表情、肢体、朝向、配色与透明度都靠参数传入）；**纯绘制函数**——禁 `requestAnimationFrame`、禁墙钟时间（`Date.now()` / `performance.now()`）、禁 `repeat: -1`，动画一律写在章节里；**第 10 条（本轮新增）是「共享绘制助手」**——与章节第 11 条同一套 API 清单（`MC.paint` 的两条路线、点列函数、缓动 / 关键帧、`MC.jit` 替代 `Math.random()`），理由也相同：角色是逐帧 seek 出来的，抖动不确定就不可重现 |
| `chatWithCast` | `html.ts` | 调用包装 | **「新建角色」时调用一次**（一个角色一个文件块）；`project:new-cast` 用它画 `cast/<id>.js`——**与「生成 HTML」无关**。写死 `label: '生成角色'` / `noun: '角色代码'` / `logFile: 'html-agent/cast.jsonl'`，`meta.action` 形如 `'cast-new-<id>'` |
| `HTML_ROUTE_SYSTEM` | `html.ts` | `const string` | **改稿路由规则**：只发大纲 + 角色表 + 用户的话，模型只回 `<<<ROUTE>>> {"targets":[…],"restructure":bool,"reason":"…"} <<<END ROUTE>>>`——最多 6 个目标、只认项目里真实存在的 `pages/cNN.js` / `cast/<id>.js`，不许猜；要不要改结构由 `restructure` 说明 |
| `chatWithRoute` | `html.ts` | 调用包装 | 路由调用（`label: '定位改动文件'` / `noun: '改动定位'` / `logFile: 'html-agent/route.jsonl'`）；回复由 `editRoute.ts` 的 `parseRouteReply(reply, allowed)` 解析（白名单过滤 + 去重 + ≤6 个），解析不出就回退成「发全部源码」 |
| `AgentProgress` | `html.ts` | `type AgentProgress = AgentProgressPayload` | 进度载荷类型别名（真源在 `src/shared/types.ts`；`projects.ts` 只认这个导出名） |
| `AgentOpts` | `html.ts` | `interface` | `{ meta?; maxTokenTries?; onProgress?: (p: AgentProgress) => void }`——只做透传，不含任何 HTML 判定 |
| `SCRIPT_AGENT_SYSTEM` | `script.ts` | `const string` | 内容脚本系统提示词，**11 条硬性要求**（第 1–8 条：只输出 `{"scenes":[…]}` JSON / `narration` 可直接朗读 / **`visual` 是画面分镜——一行写一个镜头、一个场景写 2–5 行、不要写成一大段，行首必须带该镜头的时长（写法「2.5s 」再接描述），各镜头时长之和要等于该场景的时长提示（没给就按旁白语速约 `EST_CHARS_PER_SEC` 字/秒估算），每个镜头仍要交代四件事：① 画面里有什么（主体、背景、版面构成、元素位置关系）② 这个镜头怎么动（哪个元素从哪出现、往哪动、怎么消失）③ 画面上要出现的关键文字或数字（直接写出原话）④ 氛围与衔接（色调 / 光线 / 镜头感，以及和上一个镜头怎么接）；禁止项保留：不写 HTML / CSS / JS / GSAP / 动画参数 / 像素坐标帧数**（源码第 50–53 行有注释说明为什么按行写：`visual` 会原样拼进 HTML 生成的【内容脚本】块，写成一大段时模型只能自己猜「该拆几个画面、每个占多久」；主进程**不解析**这些时长，只把多行文本原样交给模型）/ 时间顺序 / 场景数 / **目标时长字数预算——第 6 条「中文口语约 N 字/秒」，N 由 `EST_CHARS_PER_SEC` 拼进字符串** / **未被要求改的场景逐字保留** / 不写片名封面 BGM）；**第 9 条是输出示例**（两场景完整 JSON，两场 `visual` 各写成 3 个镜头、JSON 字符串里用 `\n` 转义换行（仍是合法 JSON）；注明「只是格式示例，不要照抄内容与场景数」）；**第 10 条允许静音场景**——需要纯画面、不放配音的场景把该场 `narration` 留空字符串（`""`），`visual` 照常写清楚、不要为了凑旁白硬写话，且**每个场景（包括静音场景）的 `visual` 都必须写、不能留空，并按第 3 条一行一个镜头写清楚（2–5 行，每行行首带时长）**；第 11 条是**错误示例**（列表包括：代码块包裹 / 前后加解释 / 多余字段 / narration 写成要点列表 / **`visual` 写成一大段而不是分行、某行只有「深色背景 + 标题浮入」这类骨架子、或行首不带时长**）。第 9 条与第 11 条都只是**格式示范，不是新增的规则类别** |
| `buildScriptPrompt(payload)` | `script.ts` | `(payload: ScriptGeneratePayload) => string` | 拼【要求】/【当前脚本】/【参数】三段；`Math.round(targetSeconds × EST_CHARS_PER_SEC)` 折算旁白字数预算（常量来自 `@shared/constants`，60 秒 → 240 字），场景数缺省写「按 5–8 个写」 |
| `parseScriptReply(text)` | `script.ts` | `(text: string) => Scene[]` | 去代码围栏 → 依次试「首个 `{` 到末个 `}`」「首个 `[` 到末个 `]`」「原文」→ 取第一个能 `JSON.parse` 且形状可用的；**旁白允许为空**（静音段），**只丢旁白与画面分镜都空**的场景、`durHint` 有就保留、场景截到 30；解析不出则抛错（由调用方决定把原文回给用户），失败文案是「模型返回的脚本里没有有效场景（旁白与画面分镜都为空）」 |
| **`registerScript(getProjectDir)`** | `script.ts` | `(getProjectDir: (name: string) => string) => void` | 注册 `script:generate` / `script:load-chat` / `script:append-round` / `script:read-version` / `script:set-active-version` / `script:clear-chat`（**六条 `handle`**）与 `script:progress`（`sender.send`）。**参数只有「项目名 → 项目目录」这一个解析函数**（`src/main/index.ts` 传 `projects.projectDir`）；**不接 `RegisterCtx`**（不弹对话框、不需要主窗口引用）。原名 `register`，收进目录时改名以避免与 HTML 侧入口混淆 |

### 2.1 `registerScript(getProjectDir)` 注册的七个频道（`script.ts`）

| 频道 | 注册方式 | 行为 |
| --- | --- | --- |
| `script:generate` | `ipcMain.handle` | 校验 `request` 非空（空则直接回 `请先写下要求（例如：60 秒讲清什么是大模型幻觉）`，**不调模型**）→ 整理上下文场景（只收对象、`slice(0, MAX_SCENES)`、四字段 `String` 归一化）→ `buildScriptPrompt()` → `chatWithModel()` → `parseScriptReply()` → `{ ok: true, scenes, totalChars }` |
| `script:load-chat` | `ipcMain.handle` | 载荷 `{ name? }`：**缺项目名回 `{ ok:false, message:'缺少项目名' }`**；否则 `readChatIndex(projectDir(name))` → `{ ok: true, rounds, activeVersionId }`（**不含 scenes**）。没有索引 / 索引损坏 / 版本副本已不存在都是**空列表**（老项目与首次进入走同一条，无需迁移） |
| `script:append-round` | `ipcMain.handle` | 载荷 `ScriptAppendRoundPayload`（`{ name, round, scenes }`）：缺项目名同上；`normalizeScenes(payload.scenes)` 后**没有任何场景就回「这一轮没有场景，未写入对话记录」**；否则**先生成 `newVersionId()` 写副本 `writeVersion()`，再 `readChatIndex()` 读回索引、拼上本轮元数据、`writeChatIndex({ rounds, activeVersionId: 新版本 })`**——顺序不能反（写索引会顺带清理不再被引用的旧副本），返回 `{ ok: true, versionId }`；写失败回 `保存对话记录失败：…` |
| `script:read-version` | `ipcMain.handle` | 载荷 `{ name?, versionId? }`：缺项目名 / `isValidVersionId` 不过（非 `^[A-Za-z0-9_-]{1,64}$`）分别回 `缺少项目名` / `非法的版本 id`；`readVersion()` 读不到回「这一版脚本读不到了（副本可能已被删除）」，成功回 `{ ok: true, scenes }`。**只读、无副作用**（展开预览用） |
| `script:set-active-version` | `ipcMain.handle` | 载荷 `{ name?, versionId? }`：同上校验；`readChatIndex()` 后要求该 `versionId` 确实在 `index.rounds` 里（否则回「这一版不在对话记录里」），再把 `activeVersionId` 指过去并 `writeChatIndex()`。**不写 `content.json`**——内容的落盘仍走 `project:save-content` |
| `script:clear-chat` | `ipcMain.handle` | 载荷 `{ name? }`：缺项目名同上；否则 `clearChat(projectDir(name))` 删掉整个 `chat/` 目录（索引 + 全部版本副本），回 `{ ok: true }`。**不动 `content.json` / 编辑器里的场景** |
| `script:progress` | `event.sender.send` | 主 → 渲染：五阶段进度 + 中文 `text`（`ScriptProgressPayload` = `AgentProgressPayload` + `text`，文案由私有 `progressText()` 产出）；**只发给发起调用的那个 `event.sender`**（不走 `ctx.getWindow()`，`sender.isDestroyed()` 时静默跳过） |

生成侧三条返回分支：成功 `{ ok: true, scenes, totalChars }`；调用失败 `{ ok: false, message: 'Agent 调用失败：…' }` 并用 `...configTargetOf(msg)` 补 `needConfig` / `title`；解析失败 `{ ok: false, message: '脚本解析失败：…', raw }`（`raw` = 模型原文，截到 2 万字符）。

传进 `chatWithModel` 的业务参数（逐字）：`label: '生成脚本'` / `noun: '脚本'` / `logFile: 'script-agent/chat.jsonl'` / `isComplete: (c) => /\}\s*$/.test(String(c || '').trim())`（脚本是一整份 JSON，截断时通常连右括号都没有）/ `truncatedHint: '请减少场景数或缩短目标时长，或更换模型'` / `meta: { project: name, action: scenes.length ? 'modify' : 'generate' }`。

### 2.2 `chatLog.ts` 的十一个导出（**内部模块，不挂 `index.ts`**）

磁盘布局（本模块只回答「怎么安全地读写这份记录」）：

```
projects/<项目名>/chat/index.json            ← 索引：每轮元数据 + activeVersionId，**不含 scenes**
projects/<项目名>/chat/versions/<id>.json    ← 该轮脚本的完整副本（展开 / 应用时才读）
```

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `MAX_CHAT_ROUNDS` | `const number` | `100`——索引最多保留 100 轮；超出时索引只留最新的 100 条，**对应版本副本由 `writeChatIndex` 的清理一并删掉** |
| `chatDirOf(projectDir)` | `(projectDir: string) => string` | `path.join(projectDir, 'chat')`。**收项目目录而不是项目名**：目录规则由调用方（`projects.projectDir`）给，本模块不重复实现 |
| `chatIndexPathOf(projectDir)` | `(projectDir: string) => string` | `path.join(chatDirOf(dir), 'index.json')`（私有 `versionsDirOf` / `versionPathOf` 承担 `versions/` 与 `versions/<id>.json`） |
| `isValidVersionId(versionId)` | `(versionId: unknown) => versionId is string` | 白名单 `^[A-Za-z0-9_-]{1,64}$`——`versionId` 会被拼进文件名，**必须挡住路径穿越**；所有读写入口先过它 |
| `newVersionId()` | `() => string` | `'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)`——排序友好、可读、足够唯一 |
| `normalizeScenes(raw)` | `(raw: unknown) => Scene[]` | 读写共用：非数组当空；场景只留四字段（`id` / `narration` / `visual` / `durHint`）、补 `id`、**截到 `MAX_SCENES = 30`**（防脏数据把副本撑大） |
| `readChatIndex(projectDir)` | `(projectDir: string) => ScriptChatIndex` | 索引不存在 / `JSON.parse` 失败 / 读失败 ⇒ `{ rounds: [], activeVersionId: '' }`；**逐个丢掉「版本副本已不存在」的条目**；`activeVersionId` 不在活着的轮次里则清成 `''`；最后 `slice(-MAX_CHAT_ROUNDS)` |
| `writeChatIndex(projectDir, index)` | `(projectDir: string, index: ScriptChatIndex) => void` | 只写元数据：`mkdirSync` 后落 `{ version: 1, updatedAt: ISO, activeVersionId, rounds }`（2 空格缩进）；随后调私有 `pruneVersions()` **删掉 `versions/` 下不再被索引引用（含超出 100 轮被裁掉）的文件** |
| `writeVersion(projectDir, versionId, scenes)` | `(projectDir: string, versionId: string, scenes: unknown) => Scene[]` | 非法 id 抛 `非法的版本 id`、规范化后无场景抛 `这一版没有可用场景`；否则写 `chat/versions/<id>.json` = `{ versionId, createdAt: ISO, scenes }`，**返回实际落盘的场景（已规范化）** |
| `readVersion(projectDir, versionId)` | `(projectDir: string, versionId: string) => Scene[] \| null` | 文件不存在 / 损坏 / id 非法 ⇒ `null`（读不出场景也算 `null`）。**只读、无副作用** |
| `clearChat(projectDir)` | `(projectDir: string) => void` | `fs.rmSync(chatDirOf(dir), { recursive: true, force: true })`——**删整个 `chat/`（索引 + 全部副本）**，不动 `content.json` |

私有实现：`MAX_SCENES = 30` / `VERSION_ID_RE` / `versionsDirOf()` / `versionPathOf()` / `normalizeRoundMeta()`（逐字段守卫，`versionId` 非法 ⇒ 整条丢弃）/ `pruneVersions(projectDir, keep)`（只删 `*.json`，删失败静默）。

> 记录目录在 `<项目目录>/chat/`（与 `content.json` 同级），**不进 `project.json`、不参与 `scanProjects()`**——它不影响项目列表的 `has*` 标记，删掉它也只是丢对话历史。工作区里本来也没有旧的 `script-chat.json`（旧单文件已废弃，代码不再读写它）。

### 2.3 `chatWithModel()` 的关键行为（`chat.ts`）

- **两条等价请求路径**：`loadOpenAI()` 可用时走 SDK（`stream: true` + `stream_options: { include_usage: true }`），否则回退 `fetch ${baseUrl}/chat/completions` 手写 SSE 解析；两条路径的 chunk 处理同构（`reasoning_content` 进 `thinkText`、`content` 进正文）。
- **升档重试只三种情形**：本档抛错 → 直接抛（不换档）；`finish_reason === 'length'` 且内容不完整（`isComplete` 返回 false 或内容为空）→ `emit('retry')` 换下一档；内容非空且完整 → `emit('done')` 返回正文。
- **进度节流**：`emit()` 只在阶段变化时强推，否则 **300 ms** 一次；`stage` 只会是 `thinking` / `writing` / `retry` / `done`（`connecting` 不由本层发出）。
- **过程记录**：每次调用向 `userData/<logFile>` 追加一行 JSON，含完整 `messages`、每档 `attempts`（完整思考原文 / 输出 / `finishReason` / `usage` / `detail` / `needConfig` / 四个耗时）；写失败静默忽略。
- **最终失败文案三种模板**（截断 / `length` 但无正文 / 空响应），都带 `（usage: …）` 诊断；配置类失败统一经 `friendlyError` 转人话。

### 2.4 三个业务 / 支撑文件各自只保留「自己那件事」

| | `html.ts` | `script.ts` | `chatLog.ts` |
| --- | --- | --- | --- |
| 提示词 | `HTML_AGENT_SYSTEM`（常量数组 `join('\n')`），**另有章节 / 角色 / 路由五份**：`HTML_PLAN_SYSTEM` / `HTML_CHAPTER_SYSTEM` / `HTML_CHAPTER_EDIT_SYSTEM` / `HTML_CAST_SYSTEM` / `HTML_ROUTE_SYSTEM` | `SCRIPT_AGENT_SYSTEM`（同上） | 无（不认识提示词） |
| 完成判定 | 私有 `isCompleteHtml()`：`/<\/(body\|html)\s*>\s*$/i` | 内联 `/\}\s*$/` | — |
| 结果处理 | `extractHtmlFromReply()`（提取 HTML） | `parseScriptReply()`（解析 JSON → `Scene[]`） | `normalizeScenes()` / `normalizeRoundMeta()`（场景与轮次元数据规范化） |
| 文件 | 不碰（`index.html` 由 `projects.ts` 写） | 不碰（只把项目目录交给 `chatLog.ts`） | 只读写 `projects/<项目名>/chat/`（`index.json` + `versions/<id>.json`） |
| 日志 / 记录文件 | `html-agent/chat.jsonl` | `script-agent/chat.jsonl` | `projects/<项目名>/chat/index.json` + `projects/<项目名>/chat/versions/<id>.json` |
| 错误文案 | `label '生成 HTML'` / `noun 'HTML'` | `label '生成脚本'` / `noun '脚本'` | 不产出用户文案（异常上抛给 `script.ts`） |
| IPC | 无 | `script:generate` + `script:load-chat` + `script:append-round` + `script:read-version` + `script:set-active-version` + `script:clear-chat` + `script:progress` | 无 |

> `html.ts` 与 `script.ts` 都**不 import `electron` 的对话框 / 文件 API**；`script.ts` 也**不 import `node:fs` / `node:path`**——HTML 的落盘、预览、随包前端库本地化（GSAP / p5 / p5.brush）与 **`core.js` 的版本同步**全在 `projects.ts`，内容脚本的落盘走 `project:save-content`（渲染层自动保存调度触发），对话记录的读写只在 `chatLog.ts`。

## 3. 关键流程

### 3.1 HTML 生成 / 修改（`projects.ts` → `agent`）

```
projects.ts  project:generate-html / project:modify-html
  ├─ 拼提示词（内容脚本 / 素材 / 画布 / 成片时长 / 音轨 / 项目已有角色）
  ├─ chatWithCustomModel(userPrompt, { meta, maxTokenTries, onProgress })   ← 来自 './agent'
  │     └─ html.ts：system = HTML_AGENT_SYSTEM，user = userPrompt
  │           └─ chat.ts：多轮 + 流式 + 升档重试 + jsonl 落盘 + 人话错误
  ├─ onProgress → project:html-progress（阶段文案由 projects.ts 映射）
  ├─ extractHtmlFromReply(正文) → 随包库本地化（GSAP / p5 / p5.brush）→ 注入背景音轨 → 合规校验 → 写 index.html
  └─ 返回 { ok, htmlPath, compatible }
```

**章节化分支（先规划再分支，再逐章）**：`project:generate-html` 先调 `chatWithChapterPlan` 做一次结构规划（`HTML_PLAN_SYSTEM`，只输出 JSON，**只有 `mode` + `chapters`**）——判 `single` 时走上面这条原路径（提示词里会多一段【项目角色】，落盘时由 `castInject` 注入脚本）；判 `chapters` 时**逐章调 `chatWithChapter`**（单章 JS 契约）。**角色不在生成链路里**：它由 `project:new-cast`（`chatWithCast` + `HTML_CAST_SYSTEM`，用户在「项目素材」区点「新建角色」时调一次）或 `project:import-cast`（复制文件、不调模型）建好。「按需求修改」在章节模式下分两段：先 `chatWithRoute`（`HTML_ROUTE_SYSTEM`）让模型报要改哪几份文件，再由 `chatWithChapterEdit` 只带那几份源码定向编辑（只交改动过的章节**或某一个已有角色**的文件，改结构先交完整新 PLAN，**角色表不归它管**）。章节清单校验、`pages/cNN.js` 落盘与 `index.html` 骨架在 `chapters.ts`，角色表规范化 / 过滤 / `cast/<id>.js` 落盘在 `cast.ts`，路由结果解析在 `editRoute.ts`——本文件只负责提示词与调用包装。

**本轮提示词改了五处口径**（`html.ts` 只改文本、不加逻辑，先 **−8 行**、再 **+18 行**、再 **+16 行**，净 **+26 行**）：① `HTML_PLAN_SYSTEM` **删掉整套角色表规则与带 `cast` 的示例**，改为明确「不要输出角色表、也不要在章里用 `cast` 字段」——规划的输出只剩 `mode` + `chapters`；② `HTML_CHAPTER_SYSTEM` 第 6.5 条改成**「用户消息的【项目角色】是已注入页面的角色，调用它们、不许重画」**（并写明 `ctx` 必传、没列出的不要调用、不要改角色文件）；③ `HTML_CHAPTER_EDIT_SYSTEM` 追加的修改规则改成**「角色表不归你管」**；④ `HTML_CHAPTER_SYSTEM` **第 11 条补上 `MC.castLayer` / `MC.clearLayer`、新增第 12 条「分层」**，`HTML_CHAPTER_EDIT_SYSTEM` 的编号 12 → **13**；⑤ **p5 从「全局模式」改成「实例模式」**（单文件提示词的 p5 段与章节提示词的 p5 段都换）。**为什么改**：前三条是因为角色已定稿为「项目素材」（生成流程不再产角色，提示词若还教模型输出角色表，就会出现「改一次稿、角色表被重命名 / 丢掉」的老问题）；第 12 条是因为**角色必须叠在背景之上**——模型最常见的翻车是「在角色层填整屏底色」，把 `<video>` / `<img>` / DOM 背景整块盖死；第 ⑤ 条是因为 `p5.brush` 2.2.3 用 `p5.registerAddon` 注册、**要求 WEBGL 画布**，而章节只是页面里的一个函数——没有全局 `setup` / `draw`，多章还会抢 `window.setup`，原来那套全局写法在章节模式下根本不成立。

**此后又补了一轮提示词**（`html.ts` 462 → **485 行 / 38,685 字节**，只改文本）：① `HTML_AGENT_SYSTEM` 第 2 条的「渲染技术」子项**新增两条**——⑧ **WEBGL 的原点在画布中心**（p5 用 WEBGL 时必须在 `p.draw()` 开头 `p.translate(-宽/2, -高/2)`，否则同一份坐标整体偏半个画布，实测偏 (+W/2, +H/2)）、⑨ **p5.brush 只认 11 种笔型**（pen / rotring / 2B / HB / 2H / cpencil / pastel / crayon / charcoal / spray / marker，`ink` 不是笔型、写成笔型名会报 `Brush "ink" not found` 并让那个形状的描边整段失效）；② 单文件 p5 段模板的 `p.draw` 由「一行 `p.clear()` + 注释」改成 5 行（`p.clear();` → `p.translate(-W / 2, -H / 2);`（带注释）→ 绘制注释 → `};`）；③ 章节 p5 段的 `p.draw` 模板同样加 `p.translate(-W / 2, -H / 2)`，并在「要显式激活就用 `brush.instance(p)`。清屏用 `p.clear()`（WEBGL），不要 `background()` 整屏填色。」之后补了 3 行（WEBGL 原点 + 11 种笔型），**没有新增编号条目**，仍是在原来第 7 条（p5 那一段）内部扩写；④ 两处 `MC.paint(pts, opts)` 的 opts 列表补 `br`，现在是 `{ ctx, wash, washOp, fill, fillOp, bleed, tex, ink, sw, br, hatch, alpha }`；⑤ 随后 core.js 升到 v6 加**水彩预设**，两处 `MC.paint` 段**各再写入 6 行**：「**水彩质感一律用 `preset`，不要自己拧 `bleed / tex / fillOp`**」+ 示例 + 5 档效果 + 「`soak` 会糊出轮廓，角色 / 物体用 `grain` 或 `wash`」+「**质感来自 `fill`**」+「显式键优先（含 `ink: null`）」。**为什么**：`p5.brush` 2.2.3 内部检查 `webgl2`、不满足直接 `throw new Error("p5.brush requires a WEBGL canvas")`（**没有 Canvas 2D 退路**），而 WEBGL 的原点在画布中心、与分镜的左上角坐标差半个画布；`ink` 在 `core.js` 里是**墨线颜色**（`o.ink`），两者撞名，把颜色当笔型写会让每个带描边的形状都少画描边；而「像不像水彩」全在 `bleed` / `tex` / `fillOp` 这几个数上，让模型自己拧就是平涂。

> **⚠ 水彩路线：已实测通过，但仍有未验项**：水彩探针 `.tmp/w3/probe-brush.mjs` **已跑通**——`exit=0`、成片 **222,168 字节**、0.9 秒处抽帧 PNG **114,730 字节**、页面报错「无」（改之前只有 28,076 / 26,123 字节，并出现 12 次 `[Browser:PAGEERROR] Brush "ink" not found`）；看帧确认 wash 铺满 1920×1080、三个椭圆落在 x≈480 / 960 / 1440、描边是带抖动的手绘线。**水彩质感也已实测通过**：单遍参数对比页 `.tmp/w3/texprobe/presets.html`（`p.draw()` 里画一次、`setup` 末尾只 `redraw()` 一次，`chrome-headless-shell --use-angle=d3d11` 截 1920×1080）——`soak` 颜料糊出椭圆外且色块深浅不均、`grain` 湿纸颗粒且轮廓干净、`light` 半透明三层叠加能透出叠色、`inked` 是炭笔颗粒环、`soak` 显式补 `ink:'rotring'` 后描边出现 ⇒ 预设生效、显式键能盖预设、**单遍就够**；真渲链路同样验过（探针改成 `preset: grain / soak / inked` 跑 HyperFrames：`exit=0`、成片 **588,535 字节**、0.9 秒抽帧 **263,970 字节**、页面报错「无」）。辅助验证：离线断言 **128/128**（`check.mjs` 50 / `check-cast.mjs` 48 / **`check-core.mjs` 30**）、`npm run typecheck` 三工程退出码 0、`node --check vendor\shadowmill\core.js` 退出码 0。**仍未验证**：① 真实模型会不会主动用 `preset`（提示词写了但**没跑过真模型**）；② `soak` 用在**角色**上会不会糊坏轮廓（提示词已把它限定给背景类色块）；③ **WEBGL 里 `p.text()` 不设 `textFont()` 不出字**（日志 `WEBGL: only Opentype (.otf) and Truetype (.ttf) fonts…`），这条还没写进提示词；④ 真实模型是否照契约用 `MC.*` / `window.__cast` / 分层（**从没跑过真模型**）。

### 3.2 内容脚本生成 / 修改（`renderer` → `agent` → 渲染层）

```
ContentPage/AiChatPanel.vue  window.scriptTools.generate({ name, request, scenes, sceneCount?, targetSeconds? })
  → script:generate（agent/script.ts 的 registerScript）
      ├─ buildScriptPrompt() → chatWithModel()（流式，onProgress → script:progress）
      ├─ parseScriptReply() → Scene[]
      └─ { ok, scenes, totalChars } | { ok:false, message, raw? }
  → 渲染层整份写回编辑器 → 由 helpers 的自动保存（防抖 600ms）写 project:save-content
```

### 3.3 对话记录（`renderer` → `agent/script.ts` → `agent/chatLog.ts` → 磁盘）

```
进页面 / 切回「AI 创作」  AiChatPanel onMounted → helpers.loadChatIndex()
  → window.scriptTools.loadChat(项目名) → script:load-chat
      → projectDirOf(name)（由 main/index.ts 注入）→ readChatIndex(dir)
      → 索引不存在 / 损坏 / 副本已丢的条目被剔除 ⇒ { ok: true, rounds, activeVersionId }
      → 面板渲染轮次元数据（标题栏「对话记录 N 轮」）；**scenes 不在这里**

展开某一轮 / 点「应用此版本」  AiChatPanel.toggle() / applyVersion()
  → window.scriptTools.readVersion(项目名, versionId) → script:read-version
      → readVersion(dir, versionId)（无副作用；读过的进 versionCache）
      → { ok: true, scenes } → 展开预览 / 应用

生成成功  → applyScenes(res.scenes)（编辑器自动保存）→ helpers.appendChatRound(meta, res.scenes)
  → window.scriptTools.appendRound({ name, round, scenes }) → script:append-round
      → writeVersion(dir, newVersionId(), scenes)                 （先写副本）
      → readChatIndex(dir) → 拼本轮元数据 → writeChatIndex(dir, { rounds, activeVersionId: 新版本 })
                                                                   （写索引时顺带清理不再被引用的副本）
      → { ok: true, versionId }

点「清空对话」 → helpers.clearChatRecords() → script:clear-chat → clearChat(dir)（删整个 chat/，编辑器里的 scenes 不动）
```

- **一个项目一份记录**：切项目就是换 `chat/` 目录，没有跨项目共享；记录**不进 `project.json`**，删项目时随项目目录一起消失。
- **索引里没有 scenes**：每条 `ScriptChatRoundMeta` 只存 `{ id, request, versionId, totalChars, sceneCount, ts }`；该轮产出的场景在 `chat/versions/<versionId>.json` 里，展开 / 应用时才按 `versionId` 读（懒加载，读过的缓存在 `versionCache`）。
- **记录的来源与编辑器的关系**：副本是该轮生成结果的**快照**，是**展开预览 / 应用此版本**的依据，**不是**编辑器状态的来源——编辑器始终以 `content.json`（经 `project:load`）为准。哪一版是「当前」看索引的 `activeVersionId`（应用旧版时经 `script:set-active-version` 改它），不再按内容比对。

## 4. 依赖与协作

**目录内 import**（单向）

| 文件 | import 自 | 引入内容 |
| --- | --- | --- |
| `index.ts` | `./chat` | `chatWithModel`、`MAX_TOKEN_TRIES`、`type ChatMessage`、`type AgentChatOptions` |
| `index.ts` | `./html` | `HTML_AGENT_SYSTEM`、`extractHtmlFromReply`、`chatWithCustomModel`、`HTML_PLAN_SYSTEM`、`chatWithChapterPlan`、`HTML_CHAPTER_SYSTEM`、`chatWithChapter`、`HTML_CHAPTER_EDIT_SYSTEM`、`chatWithChapterEdit`、`HTML_CAST_SYSTEM`、`chatWithCast`、`HTML_ROUTE_SYSTEM`、`chatWithRoute`、`type AgentOpts`、`type AgentProgress` |
| `index.ts` | `./script` | `SCRIPT_AGENT_SYSTEM`、`buildScriptPrompt`、`parseScriptReply`、`registerScript` |
| `html.ts` | `./chat` | `chatWithModel` |
| `script.ts` | `./chat` | `chatWithModel` |
| `script.ts` | `./chatLog` | `clearChat`、`isValidVersionId`、`newVersionId`、`normalizeScenes`、`readChatIndex`、`readVersion`、`writeChatIndex`、`writeVersion` |

**目录外 import**

| 来源 | 引入内容 | 所在文件 |
| --- | --- | --- |
| `electron` | `app`（jsonl 记录写 `userData`）；`ipcMain`（注册七个 `script:*` 中的六条 `handle`） | `chat.ts` / `script.ts` |
| `node:path` / `node:fs` | 日志文件路径拼装与追加写（**只写 `userData/<logFile>` 这一份记录**）；对话记录的目录 / 索引 / 副本读写与清理 | `chat.ts` / **`chatLog.ts`** |
| `../settings` | `getCustomModel`（模型配置）、`loadOpenAI`（SDK 懒加载入口） | `chat.ts` |
| `../../shared/errors` | `friendlyError`（人话文案）；`configTargetOf`（给失败体补 `needConfig`） | `chat.ts` / `script.ts` |
| `../../shared/constants` | **`EST_CHARS_PER_SEC`**（估时语速 4 字/秒）：系统提示词第 6 条与字数预算都拼它，本文件不再有本地语速常量 | `script.ts` |
| `../../shared/ipc` | `IPC`（`IPC.Script.Generate` / `LoadChat` / `AppendRound` / `ReadVersion` / `SetActiveVersion` / `ClearChat` / `Progress`） | `script.ts` |
| `../../shared/types` | `AgentProgressPayload`、`ConfigTarget`；`Scene`、`ScriptChatIndex`、`ScriptChatRoundMeta`（`chatLog.ts`）与 `AgentProgressPayload`、`IpcResult`、`Scene`、`ScriptAppendRoundPayload`、`ScriptChatIndex`、`ScriptChatRoundMeta`、`ScriptGeneratePayload`、`ScriptGenerateReply`、`ScriptProgressPayload`、`ScriptVersionResult`（`script.ts`） | `chat.ts` / `chatLog.ts` / `script.ts` |

**被谁引用 / 影响谁**

| 位置 | 关系 |
| --- | --- |
| `src/main/projects.ts` | `import { chatWithCustomModel, extractHtmlFromReply, type AgentProgress } from './agent'`；只在 `project:generate-html` / `project:modify-html` 里用，落盘仍是它自己 |
| `src/main/index.ts` | `import * as agent from './agent'`；注册段在 `projects.register(ctx)` 之后、`voice.register(ctx)` 之前调 **`agent.registerScript(projects.projectDir)`**——把「项目名 → 项目目录」注入进来，**agent 因此不反向 import projects**（否则与 `projects → agent` 成环） |
| `src/preload/index.ts` | `scriptTools` 命名空间（`generate` / `loadChat` / `appendRound` / `readVersion` / `setActiveVersion` / `clearChat` / `onProgress`——**7 个方法**） |
| `src/renderer/src/pages/ContentPage/` | 「AI 创作」Tab：`window.scriptTools.generate()` + `loadChat` / `appendRound` / `readVersion` / `setActiveVersion` / `clearChat` + `onProgress`；结果经 `applyScenes()` 整份写回编辑器并由自动保存落盘 |

## 5. 注意事项与实现要点

### 5.1 五条边界（这几条就是每个文件的规格）

| 文件 | 认识什么 | 不认识什么 | 碰文件吗 |
| --- | --- | --- | --- |
| `chat.ts` | 只有「怎么问模型」：多轮消息 / 流式 / 升档重试 / 记录 / 错误翻译 | **任何业务**：系统提示词、完成判定、日志路径、错误文案全由调用方传入 | 只写 `userData/<logFile>` 这一份 jsonl 过程记录（失败静默）；**不读写任何项目文件** |
| `chatLog.ts` | 只有「对话记录长什么样、怎么安全地读 / 写 / 清理」 | 提示词、模型、IPC、项目名的规则（**收项目目录、不收项目名**） | **只碰** `projects/<项目名>/chat/`（`index.json` + `versions/<id>.json`）：读打不开当空、写索引时清理孤儿副本、清空即删整个目录 |
| `html.ts` | 只有 HTML 这一个业务：提示词、回复提取、完成判定、日志文件名、错误文案 | 传输细节（流式 / 重试 / 日志写入）、`electron` 对话框、`node:fs` / `node:path`、IPC | **不碰**：`index.html` 由 `projects.ts` 写 |
| `script.ts` | 只有内容脚本这一个业务：提示词、用户提示拼装、JSON 解析、自己的七个 `script:*` 频道 | 传输细节、`settings` / `projects` / `hfEnv`、项目文件格式（**连 `node:fs` / `node:path` 都不 import**） | **不碰**：场景数组由渲染层经 `project:save-content` 落盘；对话记录只把项目目录交给 `chatLog.ts` |
| `index.ts` | 只有三个子文件的具名导出清单与依赖方向 | 一切实现细节与业务 | **不碰**：文件里没有任何 I/O 语句 |

1. **`chat.ts` 不认识任何业务**：`label` / `noun` / `logFile` / `isComplete` / `truncatedHint` 全部由调用方传入；它只回答「怎么问模型、怎么收流、怎么重试、怎么记日志」。
2. **`chat.ts` 不碰项目文件**：唯一的文件写入是 `userData/<logFile>` 的 jsonl 过程记录（失败静默），**没有**任何项目目录读写、没有文件工具、没有 shell。
3. **`chatLog.ts` 不认业务也不认项目名**：它只要一个**项目目录**，目录由 `script.ts` 用注入的 `projectDirOf` 算出来——这样「项目目录怎么算」全库只有 `projects.projectDir()` 一处。
4. **`html.ts` / `script.ts` 不认业务之外的事**：只拼提示词、只做结果提取 / 解析、只注册自己的频道。
5. **`index.ts` 只再导出**：不写逻辑、不注册 IPC、不 import 任何非本目录模块；加一个新 Agent 时只在本文件补一行导出，调用方仍然只 `from './agent'`。**`chatLog.ts` 刻意不进这份清单**：它是 `script.ts` 的实现细节，不是 Agent 层的对外能力。

### 5.2 目录为什么存在（形态变化的由来）

- **依据是既有的工程约定，不是新规则**：根 `AGENTS.md` 关键约定 9 规定「一个模块拆成多文件时，建**同名目录 + `index.ts` 作统一出口**，并把它具名导出原样挂在 `index.ts` 上」——`src/main/updater/` 早就是这套形态的样板，Agent 三个文件原先平铺在 `src/main/` 顶层，既不符合约定、也让「Agent 层」在目录里看不出来。
- **行为零变化**：纯搬移 + 再导出。频道名 / 载荷 / preload / 渲染层全都不动；`projects.ts` 的具名导出集合不变（只是 import 的来源目录变了）；`main/index.ts` 的注册顺序不变（`projects` 之后、`voice` 之前）。
- **唯一的改名是 `register` → `registerScript`**：同一个目录里从此有「HTML 侧入口」与「脚本侧入口」两个 register 语境，`registerScript` 把职责写死，避免与 `html.ts` 的 `chatWithCustomModel` 混淆；仓库内除 `main/index.ts` 的调用点外无其它引用。
- **`chatLog.ts` 为什么单独一个文件**：「对话记录的磁盘读写」和「内容脚本 Agent 的提示词 / 解析 / IPC」是两件事。抽出的直接动因是「对话记录要按项目落盘」，读写必须和生成链路解耦。**记录改成「索引 + 每版副本」后它从 84 行涨到 155 行**：索引只存元数据（不含 scenes）、每版脚本单独一份副本、`writeChatIndex` 写后要清理不再被引用的副本、`versionId` 需要白名单挡路径穿越。
- **行数仍在硬线内**：261 / 155 / 331 / **485** / 16 全部低于 500 行（300 行是「考虑拆」的阈值；`html.ts` 485 行、`script.ts` 331 行、`chatLog.ts` 155 行，各自仍只回答一个问题——`html.ts` 涨的是提示词份数与条数，不是职责变多）。

### 5.3 其余实现要点

- **日志文件位置未变**：仍是 `userData/html-agent/chat.jsonl` 与 `userData/script-agent/chat.jsonl`（目录不存在时由 `logConversation` 自建）。**这份 jsonl 与对话记录是两件事**：前者是排障用的完整会话（含思考与原文），只写不读；后者是界面回看用的 `chat/index.json` + `chat/versions/<id>.json`（`userData/projects/<项目名>/` 下），可读可删。
- **HTML 系统提示词刻意不含视觉风格**：`HTML_AGENT_SYSTEM` 数组上方有 **10 行**注释写明这条边界——这里只放「模型必须无条件满足」的结构契约（文档结构 / HyperFrames 规范 / **渲染技术** / 字幕时间轴 / 输出格式），**不写任何视觉风格**。整片要多深多亮、什么配色，由用户在**「HTML生成」页 · 全局视觉风格 输入框**填，主进程的 `buildStyleBlock()` 把它拼成用户消息里的【全局视觉风格】块（见 [projects.ts.md](./projects.ts.md) §3.10），也可写在同一页的「需求描述」里。注释给的理由：本列表每一条都是硬性要求，这里一旦写死某种配色，用户的选择就会被压掉（想换浅色 / 别的风格都改不动）。注释还说明「渲染技术」为什么也是结构契约而不是风格：HyperFrames 的渲染是「seek GSAP 时间轴 → 逐帧截图」，不是播一遍录下来（`resources/hyperframes/node_modules/hyperframes/dist/cli.js` 里 `hf.seek(t)` → `window.__player.renderSeek(t)`，页面由本地 http 服务加载、不是 `file://`）——逐帧绘制若不挂在时间轴上、或用了墙钟时间 / 未设种子的随机数，seek 之后画面就不会重绘、成片会是静态或错帧（三组真渲染实测均逐帧吻合：Canvas 2D 挂在 `tl.to(...).onUpdate` 上；纯 rAF 循环里读 `tl.time()`——HyperFrames 用虚拟时间接管 rAF，但强制走 screenshot 慢路径；three.js r170 ESM（importmap + unpkg））。注释另写明「**画布必须挂进 `data-composition-id` 舞台容器**」这条同理、而且更隐蔽：画布挂在 `<body>` 上时渲染器只截到空容器，成片全黑却一条错误都不报（已实测 240 帧全黑），所以必须写进提示词。随包库从 1 个变 3 个这一点也写进注释：**GSAP / p5 / p5.brush 一律用随包的 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`**（清单与改写规则见 `src/main/hfEnv.ts` 的 `VENDOR_LIBS` 表），**three.js 仍是唯一允许走 CDN 的依赖**（663 KB，不进安装包）。
- **`./core.js` 为什么也写进提示词、却不进 `VENDOR_LIBS` 式的「随包库清单」**：它由应用内置、按 `CORE_VERSION` 同步进每个项目，页面里的引用恒为 `./core.js`（不分 CDN / 本地两种形态），所以它不属于「可换回 CDN 的第三方库」。提示词里只讲 API（`MC.*`），不讲「从哪加载」——加载这件事骨架已经做完了。
- **`chatWithModel` 只被 `html.ts` / `script.ts` 调用**（仓库内无第三个调用方）；新增「对话式操作」时按同样形态再写一个薄封装（提示词 + 完成判定 + 提取函数 + 三个文案参数），传输层继续复用 `chat.ts`。
- **`MAX_TOKEN_TRIES` 可被调用方覆盖**：`AgentOpts.maxTokenTries` 原样透传到 `AgentChatOptions.maxTokenTries`；不传就走 `[32768, 65536]`。
- **`AgentProgress` 是别名而不是新类型**：真源是 `src/shared/types.ts` 的 `AgentProgressPayload`（`html.ts` 里 `export type AgentProgress = AgentProgressPayload`），`projects.ts` 沿用旧名因此一行未改。
- **`script.ts` 只剩 `MAX_SCENES` 一个上限常量、没有语速常量**：`MAX_SCENES = 30` 是本文件私有，同时用于「整理上下文」与「解析结果」两处截断；**语速口径不在这里定义**——`EST_CHARS_PER_SEC` 从 `@shared/constants` 引入，只用于把目标总时长折算成提示词里的字数预算（`Math.round(seconds * EST_CHARS_PER_SEC)`），系统提示词第 6 条同样拼接它。`chatLog.ts` 里另有一份同值的 **`MAX_SCENES = 30`**（读写共用，防脏数据把副本撑大），两者互不引用。静音场景（某场 `narration` 留空、`visual` 必填）**不影响 `MAX_SCENES` 截断**：截断按场景条目数算，静音场景同样占一条。
- **`projectDirOf` 的默认值兜底**：模块级 `let projectDirOf: (name: string) => string = () => ''`，`registerScript(getProjectDir)` 里 `typeof getProjectDir === 'function'` 才覆盖——这样「忘了传参」也不会在模块加载期崩，只是五个 chat 频道会因项目目录为空而读写到不存在的路径（读一律给空、写抛错/静默，属未定义用法，正常启动路径永远会传）。

## 6. 相关文档

- HTML 链路全貌：[01-架构总览.md](../../01-架构总览.md) §5.1；内容脚本链路（含对话记录）：同文件 §5.5
- 调用方：[main/projects.ts.md](./projects.ts.md)（`project:generate-html` / `project:modify-html`）、[main/index.ts.md](./index.ts.md)（注册顺序与 `projects.projectDir` 注入）
- 共享绘制助手的真身：[main/coreLib.ts.md](./coreLib.ts.md)（版本同步）与 `vendor/shadowmill/core.js`（`MC` 的实现，**270 行 / 13,366 字节，当前 `CORE_VERSION = '6'`**；v2 新增 `MC.castLayer` / `MC.clearLayer`，v3 让 `MC.paint` 的水彩分支从 `opts.p` / `window.__p5Active` 取 p5 实例，v4 改用对外唯一存在的 `brush.instance(p)` 激活实例（对外没有 `activateInstance` / `deactivateInstance`），v5 让描边笔型名过 `brushName()` 白名单（只有 11 种笔型、`ink` 不是笔型、传错退回 `pen`），v6 加 5 组水彩预设 `PRESETS`（`wash` / `soak` / `grain` / `light` / `inked`）与 `withPreset()`/`has()`——`MC.paint(pts, { preset })` **预设垫底、显式键优先**；**水彩质感用 `preset`，别自己拧 `bleed` / `tex`；质感来自 `fill`（只给 `wash` 是平底色），`soak` 会糊出轮廓、角色 / 物体用 `grain` / `wash`**；`window.MC` 的导出键没变，`PRESETS` / `withPreset` / `BRUSHES` 不对外）
- 共享契约：[shared/types.ts.md](../shared/types.ts.md)（`AgentProgressPayload` / `ScriptGeneratePayload` / `ScriptGenerateReply` / `ScriptProgressPayload` / `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`）、[shared/ipc.ts.md](../shared/ipc.ts.md)（`Script` 分组 7 条）、[shared/errors.ts.md](../shared/errors.ts.md)（`friendlyError` / `configTargetOf`）、[shared/constants.ts.md](../shared/constants.ts.md)（`EST_CHARS_PER_SEC`）
- 同形态的样板目录：[main/updater.md](./updater.md)
