# src/main/chapters.ts

> 章节化长片的**纯逻辑**：解析模型回复（结构规划 / 章节文件块）、校验章节清单与每章代码、读写项目里的 `pages/cNN.js`、装配应用生成的 `index.html` 骨架（含**共享绘制助手 `./core.js` 与角色脚本**的引入位置——角色「传谁引谁」）；导出单文件时把章节、角色与 `core.js` 一起内联

- **所在目录**：src/main/
- **类型**：纯逻辑 + 章节文件读写模块（**不调用模型、不注册 IPC、不 import `projects.ts`**）
- **规模**：394 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：13 个函数（`chapterRelPath` / `parsePlanReply` / `parseFileBlocksWith` / `parseFileBlocks` / `validateChapterCode` / `writeChapterFiles` / `removeChapterFiles` / `readChapterCode` / `totalDuration` / `chapterOffsets` / `buildSkeleton` / `inlineChapters` / `chapterOutlineText`）+ 类型 `ChapterPlanReply`

## 1. 作用与职责

「HTML生成」页点「生成 HTML」时先做一次**结构规划**：模型判断这支片子写成一份 `index.html`（单文件）还是拆成若干章（章节模式）。选章节模式时，每章对应 `pages/c01.js`、`pages/c02.js`…，**`index.html` 由应用确定性生成**（舞台 / 画布 / 库与角色 / 章节脚本顺序 / 主时间轴装配 / `__timelines` 登记 / 成片时长 / 音轨），模型只写每章的 JS；章的时间一律从 0 开始，整片起点由应用累加。规则：一章 = 一个叙事段落 = 4–8 个连续场景，章边界落在场景之间，时长是结果不是配额（单章超过约 40 秒才提示再拆），每章开头 0.3–0.6 秒做入场转场。「按需求修改」在章节模式下走**两段式**（先路由再定向编辑，见 3.2）。

- **解析回复**：从模型原文里取出规划 JSON 与若干文件块，解析成 `ChapterPlanReply` 与「路径 → 代码」的映射。文件块解析是通用函数 `parseFileBlocksWith()`，**章节与角色共用同一套标记**（见 2.1）。
- **校验**：把「一次生成结果」当整体验——章节 id、场景覆盖、单章时长、无限循环、`window.__chapters` 登记，任一条不成立就不许落盘（规则见 2.2）。
- **读写章节文件**：把每章写进项目目录下的 `pages/cNN.js`，写完删掉清单里没有的孤儿章节文件；切回单文件模式时清空整个 `pages/`；定向改稿前把现有章节代码读回来作为上下文。
- **装配骨架**：`buildSkeleton()` 产出一份完整的 `index.html`——舞台、画布、按「章节 `uses` ∪ 角色 `uses`」并集排好的随包库、**共享绘制助手 `./core.js`（章节模式一律引入）**、**按传入 `cast` 列表写的角色脚本（排在章节脚本之前）**、章节脚本、主时间轴装配脚本、`data-duration` 全部由应用写死，模型不碰这个文件。
- **导出内联**：`inlineChapters()` 在导出单个 HTML 时把 `<script src="./pages/cNN.js">`、`<script src="./cast/<id>.js">` 与 `<script src="./core.js">` 一起换成内联脚本（**收「项目内相对路径 + 代码」的数组**），导出物脱离项目目录也能打开。
- **大纲文本**：`chapterOutlineText()` 把章节清单渲染成给人 / 模型看的大纲文本（含每章的随包库标注与**［角色：…］**标注）。

模块本身是**纯逻辑 + 文件读写**：不 import `projects.ts`（避免循环依赖）、不调用模型（模型调用在 `agent/html.ts` 的包装里）、不注册 IPC。

## 2. 导出与关键实现

| 名称 | 签名 | 说明 |
| --- | --- | --- |
| `chapterRelPath(id)` | `(id: string) => string` | 章节 id → 项目内相对路径：恒为 `pages/<id>.js` |
| `parsePlanReply(reply, validSceneCount)` | `(reply: string, validSceneCount: number) => { plan: ChapterPlanReply \| null; error? }` | 取 `<<<PLAN>>>` 规划块并解析成 `{ mode: 'single' }` 或 `{ mode: 'chapters', chapters }`；章节的场景覆盖按 `validSceneCount` 校验。**规划回复里只有 `mode` + `chapters`**（角色表规则已从提示词删除，本函数也不再读 `cast`） |
| `parseFileBlocksWith(reply, accept, fallbackPath?)` | `(reply: string, accept: (rel: string) => boolean, fallbackPath?: string) => { files: { path; code }[]; badPaths: string[] }` | 通用文件块解析：`accept` 决定哪些路径合法（章节传 `pages/cNN.js` 的判据、角色传 `cast/<id>.js` 的判据）；不合法的路径**不静默丢**，收进 `badPaths` 由调用方决定怎么报；`fallbackPath` 用于块里没写路径时兜底 |
| `parseFileBlocks(reply, fallbackPath?)` | `(reply: string, fallbackPath?: string) => …` | 章节文件块的薄封装：`parseFileBlocksWith(reply, (rel) => FILE_RE.test(rel), fallbackPath)` |
| `validateChapterCode(code)` | `(code: string) => string \| null` | 单章代码的校验：禁 `repeat: -1` / `repeat: Infinity`，必须登记 `window.__chapters[id] = { build(...) }` |
| `writeChapterFiles(dir, chapters, files)` | `(dir: string, chapters, files) => { written; removed }` | 写入给定章节文件，并**删掉清单里没有的孤儿章节文件** |
| `removeChapterFiles(dir)` | `(dir: string) => string[]` | 清空整个 `pages/`（从章节模式切回单文件模式时用） |
| `readChapterCode(dir, chapters)` | `(dir: string, chapters) => { id; title; code }[]` | 按章节清单把现有 `pages/cNN.js` 读回（定向改稿与导出内联的上下文） |
| `totalDuration(chapters)` | `(chapters) => number` | Σ 各章时长（秒），即骨架里 `data-duration` 的值 |
| `chapterOffsets(chapters)` | `(chapters) => number[]` | 各章在主时间轴上的累计偏移（首章 0） |
| `buildSkeleton({ chapters, canvas, total, cast? })` | `(opts: { chapters; canvas; total; cast?: ProjectCastMember[] }) => string` | 生成完整 `index.html`（见 2.3），脚本顺序里**固定带 `./core.js`**，角色脚本**只认传进来的 `cast`** |
| `inlineChapters(html, sources)` | `(html: string, sources: { path: string; code: string }[]) => string` | 把 `<script src="./<项目内相对路径>">` 换成内联脚本（并把 `</script` 转义）——章节 `pages/cNN.js`、角色 `cast/<id>.js` 与 `core.js` 一次传完 |
| `chapterOutlineText(chapters)` | `(chapters) => string` | 章节大纲文本：每章序号 / 标题 / 起止场景 / 时长 / 文件路径 / ［随包库：…］ / ［角色：…］（见 2.4） |
| `ChapterPlanReply` | 类型 | `{ mode: 'single' }` 或 `{ mode: 'chapters', chapters }` |

### 2.1 模型回复契约

| 块 | 形态 | 说明 |
| --- | --- | --- |
| 规划块 | `<<<PLAN>>> {json} <<<END PLAN>>>` | 只输出 JSON：`mode` 判单文件还是章节；章节模式给出章节清单（**只有 `mode` + `chapters`，没有角色表**） |
| 文件块 | `<<<FILE pages/c01.js>>> …js… <<<END FILE>>>` | 一章一个块，一个回复可带多个文件块；路径必须落在白名单内（角色块同形态，路径是 `cast/<id>.js`） |

`parseFileBlocksWith()` 是这套标记的**唯一实现**：章节传 `pages/cNN.js` 的 `accept`、角色传 `cast/<id>.js` 的 `accept`，两边共用同一条正则与同一条兜底逻辑（块里没写路径时整段回复当 `fallbackPath` 的内容）。

### 2.2 校验规则（一次生成结果的验收线）

- **章节 id**：纯序号且不重复；`c1` / `C1` 一律归一成 `c01`（`chapterRelPath` 与章节清单据此拼路径）。
- **场景覆盖**：`scenes` 必须连续、升序、落在有效场景数内，且**不重不漏覆盖全部有效场景**——这就是「章边界不切在场景中间」的执行点。
- **单章时长**：上限 180 秒（时长是结果不是配额；约 40 秒才提示再拆）。
- **无限循环**：代码里不许出现 `repeat: -1` / `repeat: Infinity`（与 `video.ts` 渲染前的护栏同一条规则）。
- **章节登记**：代码必须登记 `window.__chapters[id] = { build(...) }`，应用才能把这一章装进主时间轴。
- **路径白名单**：只接受 `pages/cNN.js`，没有第二种文件位置。

### 2.3 骨架（`buildSkeleton`）

应用生成的 `index.html` 由这些部件按固定顺序组成：

- `<html data-resolution>`（页面自描述）与舞台 `<div data-composition-id="main" data-width data-height data-duration>`、`<div id="stage">`；
- `<script src="./gsap.min.js">`；
- **随包库与角色脚本**：按「章节 `uses` ∪ 角色 `uses`」的并集插 `./p5.min.js` / `./p5.brush.js`（顺序固定），随后**无条件插 `<script src="./core.js">`**（共享绘制助手，章节模式一律引入，见 2.6），再是按传入 `cast` 列表写的 `<script src="./cast/<id>.js">`（**「传谁引谁」**，见 2.5）；
- 按章节清单顺序的 `<script src="./pages/cNN.js">`；
- 末尾一段装配脚本：**每章先建一个铺满画布的专属容器**（`document.createElement("div")`，不用 `#stage` 直接挂章节），用 `master.set(box, { display: "block" }, at)` / `master.set(box, { display: "none" }, at + p.d)` 按本章时间窗切显隐，再 `ch.build(box)`；随后把各章 timeline `master.add(tl, 累计偏移)` 装进主时间轴，并 `window.__timelines["main"] = master`；
- `data-duration` = Σ 各章时长（`totalDuration`）。

**为什么每章要一个专属容器**：GSAP 式章节是往 DOM 里加节点（不像 PDoom 每帧重画整幅），没有这层显隐，上一章的节点会一直留在下面、下一章入场淡入时透出残影。**对章节脚本的契约没变**：它拿到的 stage 仍是铺满画布的那块，时间仍从 0 开始。

### 2.4 `uses`：本章要用哪些随包库

章节脚本不许写 `<script>`，所以「本章要用 p5」只能在章节清单里声明——`ProjectChapter.uses?: string[]` 就是这份声明。

- 只认 `'p5'` 与 `'p5.brush'`（`p5.brush` 隐含 `p5`；`three` 被静默丢掉，章节模式暂不支持 three.js）。
- 骨架按**「全体章节 `uses` ∪ 传入角色列表的 `uses`」**引入，顺序固定为 `gsap → p5.min.js → p5.brush.js → core.js → cast/<角色>.js → pages/cNN.js`。**必须同时算角色那一份**：否则「只有角色用水彩、没有任何章声明 p5」时 p5 不会被引入，角色一调用就崩。
- 没声明的章里 `window.p5` 是 `undefined`——要用就得声明。
- `chapterOutlineText()` 在大纲里给每章标「［随包库：p5 + p5.brush］」，让模型修改时看得见。

### 2.5 角色脚本的引入位置与顺序（**传谁引谁**）

- **不看各章 `ProjectChapter.cast` 的并集**（源码注释逐字：「这里**不再依据「各章 cast 的并集」**——角色是项目素材，与怎么拆章无关」）。`ProjectChapter.cast` 字段保留（仍进大纲文案），但**不再参与脚本引入**。
- **`cast` 参数就是「要引入的那几个」**：调用方只传 `cast.selectedMembers(proj.cast)`（勾选参与本次生成的角色），骨架按这个数组的顺序写标签。
- **必须排在章节脚本之前**：章节里 `window.__cast["hero"](x, y, u, {…})` 才拿得到函数——章节是互相隔离的 IIFE，作用域不共享，这是角色能「跨形态共用一份画法」的前提。
- **`cast` 为空 / 缺省**：骨架不写任何 `cast/*.js`，`libTags` 里那一行变成空串被 `filter(Boolean)` 去掉（与没有角色时逐字一致的骨架）。
- 单文件模式不经过本函数：那份 `index.html` 由 [castInject.ts](./castInject.ts.md) 注入同样的脚本。

### 2.6 共享绘制助手 `./core.js` 的位置与原因（`libTags` 里的一行）

`buildSkeleton` 的 `libTags` 数组依次是：

```js
'<script src="./gsap.min.js"></script>',
needs.has('p5') ? '<script src="./p5.min.js"></script>' : '',
needs.has('p5.brush') ? '<script src="./p5.brush.js"></script>' : '',
'<script src="./core.js"></script>',
castTags
```

- **必须排在 p5 / p5.brush 之后**：`core.js` 的水彩路线直接用全局 `window.brush`（`brush.wash` / `brush.fill` / `brush.polygon` …），先于插件加载就会「有 `MC` 没 `brush`」，`MC.paint()` 静默画不出东西。
- **必须排在角色与章节脚本之前**：角色与章节都靠 `MC.*` 画形状，它们是 `core.js` 的下游。
- **章节模式一律引入，不做按需**：DOM/CSS 章节用不上它，但那 8 KB 换来「想画水彩就有」。按需判断要扫全部章节与角色的代码文本，得不偿失，也容易漏。
- **角色层由章节自己建**：`buildSkeleton()` 只负责把 `cast/<id>.js` 排到章节脚本之前，**不替章节建角色画布**——章节要在自己的 `build(stage)` 里用 `MC.castLayer(stage, 宽, 高)` 建一张铺满舞台的透明层（叠在背景之上、`pointer-events:none`），每帧先 `MC.clearLayer(layer.ctx)` 再画角色（见 `HTML_CHAPTER_SYSTEM` 第 12 条「分层」）。骨架不掺和这件事，因为它不知道这一章要几层（前 / 中 / 背景）。
- **文件由谁保证存在**：骨架只写 `<script src="./core.js">`，真正的复制在 `projects.ts` 的 `syncCoreLib()`（写骨架前、单文件注入前、预览前、导出前）+ `video.ts`（渲染前一次），按 `CORE_VERSION` 覆盖，见 [coreLib.ts](./coreLib.ts.md)。**本模块不认识 `coreLib`、也不读那个文件**——它只负责把引用写进骨架。

## 3. 关键流程 / 算法

### 3.1 生成：先规划，再逐章 N 次

```
project:generate-html
  → 规划一次（模型只交 PLAN JSON：mode + chapters，不产角色表）
  → mode === 'single'：走单文件路径（整份 HTML，角色由 castInject 注入）
  → mode === 'chapters'：
       castList = cast.selectedMembers(proj.cast)      # 角色是项目素材，不在这里生成
       for i in 0..N-1:
           buildChapterPrompt（本章任务 / 文件 / 随包库 / 【项目角色】/ 时间口径 / 大纲 …）
           → chatWithChapter → parseFileBlocks(reply, pages/cNN.js)
           → validateChapterCode(code)                 # 无限循环 / __chapters 登记
       writeChapterFiles(dir, chapters, files)          # 落盘并清孤儿
       writeChapterSkeleton(name, proj, list, castList) # 骨架 + proj.cast = castList
       全部成功才落盘（任何一章失败整次不生效）
```

- 章的时间从 0 开始，整片起点由应用用 `chapterOffsets()` 累计；模型不需要知道自己在整片的第几秒。
- 骨架是应用写的，模型只写每章的 JS；因此「舞台 / 画布 / 脚本顺序 / 主时间轴 / 成片时长」不会因模型输出而漂移。
- **角色不在这一步产生**（上一版的「先 M 次角色 → 再 N 次章节」已删除）：角色由「新建角色」或「从全局库添加」在「项目素材」区建好，生成时只取 `selectedMembers(proj.cast)` 交给骨架。

### 3.2 修改：路由 → 定向编辑（两段式）

- 章节模式下，主进程**先只发「大纲 + 角色表 + 用户的话」**让模型报这次要改哪几个文件（`editRoute.ts` 的 `parseRouteReply`，≤6 个、只认项目里真实存在的 `pages/cNN.js` / `cast/<id>.js`）。
- **路由失败自动回退成「发全部源码」**——改稿不会因为路由猜不准而做不了。
- 第二段只读被点名的那几份源码（用 `<<<CURRENT 路径>>>` 包起来）连同大纲发给模型改；模型只交改动过的文件块。
- **角色表不归模型管**：`HTML_CHAPTER_EDIT_SYSTEM` 明确写了它在「项目素材」区由用户勾选 / 新建，模型**只可能被要求改某个已有角色的画法**（那就只交 `cast/<id>.js` 那一个块）；改结构（增删章 / 改场景归属 / 改时长）要先交一份完整的新 PLAN（**只有 `chapters`，没有 `cast`**），再按新清单重写受影响的文件；`uses` 要照实改（会影响骨架）。
- 为什么分两段：长片源码合计几百 KB（章节 × 30–70 KB + 角色 × 10–20 KB），一次全发会撞模型上下文上限。

### 3.3 导出：内联章节、角色与 `core.js`

- `project:download-html` 调 `inlineChapters(html, sources)`，`sources` = 各章 `{ path: 'pages/cNN.js', code }` **加上**各角色 `{ path: 'cast/<id>.js', code }` **再加上共享绘制助手 `{ path: coreLib.CORE_FILE, code }`**（后者由 `projects.ts` 用 `coreLib.readProjectCore(dir)` 读项目里那份）；每个 `<script src>` 换成内联脚本、`</script` 转义后再嵌入，导出物是单个自包含 HTML。
- **两种形态都内联**：`sources` 里章节那一组只在章节模式才有，角色与 `core.js` 两组**两种形态都加**——否则导出的单文件在别处打开就没有 `window.__cast` / `MC`。
- **`inlineChapters` 本身不认识这是哪一类脚本**——它只按 `sources[].path` 拼正则，所以三类脚本走同一条路。

### 3.4 切回单文件模式

- 从章节模式切回单文件（`Project.chapters` 清空）时调 `removeChapterFiles()` 清空整个 `pages/`，**但不清 `cast/`**：角色是项目素材，与「这一版用几个文件写」无关（`writeSingleHtml` 只删章节文件、`Project.cast` 原样保留）。

## 4. 依赖与协作

- **被 `projects.ts` 调用**：生成 / 修改 / 导出 / 切回单文件模式四处都用它；`projects.ts` 负责模型调用、进度推送与 handler，`chapters.ts` 只做「解析 → 校验 → 落盘 → 装配」。
- **给 `cast.ts` 提供一个通用解析**：`parseFileBlocksWith()` 被 `cast.ts` 复用（角色文件块与章节文件块同一套标记）。方向单向：`cast → chapters`，`chapters` 不知道角色，只把 `cast` 当骨架的一个可选参数。
- **不 import `projects.ts`**：否则与 `projects → chapters` 成环。项目目录一律作参数传入（`writeChapterFiles(dir, …)` / `readChapterCode(dir, …)`），模块自己不知道项目名。
- **不调用模型**：模型调用在 `agent/html.ts` 的包装里（规划 / 单章 / 单章修改 / 角色 / 路由），本模块只消费模型回复；路由结果的解析在 `editRoute.ts`。
- **不注册 IPC、不碰渲染层**：章节清单与角色表随 `project:load` 的 `Project.chapters` / `Project.cast` 回给渲染层，「HTML生成」页的 `ChapterSection.vue` / `CastSection.vue` 读写它们；进度仍走 `project:html-progress`，没有新增频道。
- **章节与角色的类型真源都在 `src/shared/types.ts`**（`ProjectChapter` / `ProjectCastMember`），本模块只读它们的字段，不另立一套结构。

## 5. 注意事项与实现要点

- **章边界不切在场景中间**是硬约束，执行点就是 2.2 的「不重不漏覆盖全部有效场景」；缺一场、重一场、越界都判失败，而不是自动修补。
- **时间口径只有一处**：章内从 0 开始、整片偏移由 `chapterOffsets()` 累加，`totalDuration()` 同时是骨架 `data-duration` 与后续渲染时长裁定的依据。
- **骨架确定性生成**：模型不写 `index.html`，所以章节模式不会出现「舞台属性 / 脚本顺序 / `__timelines` 键名」被模型写错的问题；改骨架只需改这一个函数。
- **骨架的脚本顺序是本模块的职责**：`gsap → 随包库（章节 ∪ 角色）→ core.js → 角色脚本 → 章节脚本`。`core.js` 必须晚于 p5.brush（它用水彩路线时直接调 `window.brush`）、早于角色与章节（两者都靠 `MC.*` 画）；角色必须早于章节，否则章节里拿不到 `window.__cast`；库并集漏算角色会让「只有角色用 p5」的片子直接崩。
- **角色脚本「传谁引谁」，别把章节当过滤器**：`ProjectChapter.cast` 只是清单里的一个描述字段，**不再决定引入**。想让某个角色出场，就去「项目素材」区把它勾上。
- **孤儿清理是模式切换的安全网**：`writeChapterFiles()` 删清单外的章节文件、`removeChapterFiles()` 清空 `pages/`，保证磁盘上的章节脚本与 `Project.chapters` 一致（角色那一侧由 `cast.writeCastFiles` 负责；`cast.removeCastFiles` 当前没有调用方）。
- **`uses` 只是声明**：它决定骨架引哪些库，不会在章内注入任何东西；没声明就用不到 `window.p5`。**声明了 p5 的章必须走实例模式**（`new p5(fn, stage)` + `p.createCanvas(W,H,p.WEBGL)` + `pixelDensity(1)` + `noLoop()` + `window.__p5Active = p` + `brush.load()`）；**绘制一律写在 `p.draw()` 里**（addon 在 predraw/postdraw 自动激活实例），每帧只需 `window.__brushT = t; inst.redraw()`——`window.brush` 对外**没有** `activateInstance` / `deactivateInstance`（实测报 `is not a function`），要显式激活只能用 `brush.instance(p)`。`p5.brush` 2.2.3 **强制 WEBGL**（内部检查 `webgl2`，不满足直接 `throw new Error("p5.brush requires a WEBGL canvas")`，**没有 Canvas 2D 退路**），而章节没有全局 `setup` / `draw`，全局写法根本不成立。另两条硬约束：**WEBGL 的原点在画布中心**（`p.draw()` 里 `p.clear()` 之后必须 `p.translate(-W/2, -H/2)`，否则整体偏半个画布）、**p5.brush 只认 11 种笔型、`ink` 不是笔型**（它是墨线颜色，写错会报 `Brush "ink" not found` 并让那个形状的描边整段失效）；**水彩质感用 `MC.paint` 的 `preset`（`wash` / `soak` / `grain` / `light` / `inked`），别自己拧 `bleed` / `tex`**——**质感来自 `fill`**（只给 `wash` 是平底色），`soak` 会糊出轮廓、角色 / 物体用 `grain` 或 `wash`。
- **水彩路线与质感都已实测通过（本模块只负责按 `uses` 引库）**：`.tmp/w3/probe-brush.mjs` 已跑通——`exit=0`、成片 **222,168 字节**、0.9 秒处抽帧 PNG **114,730 字节**、页面报错「无」；质感见单遍参数对比页 `.tmp/w3/texprobe/presets.html`（`p.draw()` 里画一次、`setup` 末尾只 `redraw()` 一次，`chrome-headless-shell --use-angle=d3d11` 截 1920×1080）——`soak` 糊出椭圆外、`grain` 湿纸颗粒且轮廓干净、`light` 三层叠加能透出叠色、`inked` 是炭笔颗粒环、`soak` 显式补 `ink:'rotring'` 后描边出现；真渲链路也验过（探针改成 `preset: grain / soak / inked` 跑 HyperFrames：`exit=0`、成片 **588,535 字节**、0.9 秒抽帧 **263,970 字节**、页面报错「无」）。**仍未验证**：① 真实模型会不会主动用 `preset`（没跑过真模型）；② `soak` 用在**角色**上会不会糊坏轮廓（提示词已把它限定给背景类色块）；③ **WEBGL 里 `p.text()` 不设 `textFont()` 不出字**；④ 真实模型是否照契约用 `MC.*` / `window.__cast` / 分层。画不画得出来本来也不在本模块的验证范围内。
- **180 秒是上限、约 40 秒才是提示线**：超 180 秒直接判失败；超过约 40 秒只是提示再拆一章，不阻断。
- **`inlineChapters` 的匹配口径**：按 `sources[].path` 逐条拼正则（`.` 等元字符已转义），只替换 `src="./<该路径>"` 的标签——所以章节、角色与 `core.js` 可以一次传完，每条引用各换成一段内联脚本。
- **规划回复不再带 `cast`**：`parsePlanReply` 只读 `mode` / `chapters`；若某次回复里恰好还有 `cast` 字段会被忽略（角色表不在这里维护）。
