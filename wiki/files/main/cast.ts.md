# src/main/cast.ts

> 项目角色（「HTML生成」页 ·「项目素材」区 · 角色）的**纯逻辑**：解析 / 校验角色表与角色文件块、读写项目里的 `cast/<id>.js`、给提示词用的大纲文案、以及「哪些角色参与本次生成」的过滤（`selectedMembers`）；角色脚本由骨架（章节模式）或 `castInject.ts`（单文件模式）在页面里引入，同一角色因此在哪种产物形态下都是同一份画法

- **所在目录**：src/main/
- **类型**：纯逻辑 + 角色文件读写模块（**不调用模型、不注册 IPC、不 import `projects.ts`**）
- **规模**：184 行（实测 `[IO.File]::ReadAllLines`；上一版 176 行，本轮 **+8 行**：`ProjectCastMember.selected` 的解析与 `selectedMembers()` 导出及注释）
- **对外导出**：11 个函数（`castRelPath` / `isCastPath` / `selectedMembers` / `normalizeCastList` / `parseCastTable` / `parseCastFiles` / `validateCastCode` / `writeCastFiles` / `removeCastFiles` / `readCastCode` / `castOutlineText`）

## 1. 作用与界面位置

**在页面上**：「HTML生成」页 ·「项目素材」区里的**「角色」块**（与「图片」「视频」两类素材并列，**0 个角色也常显**）。块里一行一个角色：勾选框 + 名字 + 描述 + 高几 u + `cast/<id>.js` + 三个动作（存为全局 / 改这个角色 / 移除），标题右侧两个动作（从全局库添加 / 新建角色）；角色代码由「新建角色」（调一次模型）或「从全局库添加」（复制文件）产生，**两条路径都不经过「生成 HTML」**。

角色 = **一份跨形态共用的绘制代码**，不是素材图片：`cast/<id>.js` 里登记 `window.__cast["hero"] = function (x, y, u, o) { … }`，页面里的章节（或模型写的那份 index.html）都调同一个函数把同一个人画出来。

- **为什么角色要单独一份文件**：章节是互相隔离的 IIFE，作用域不共享；不共享角色代码，同一角色会在各章被各画一遍，长相就散了。所以角色脚本必须**先于**用到它的代码加载（与参考项目把 `clawd.js` / `cast.js` 放在 `ch/*.js` 之前同理）。
- **它与「单文件 / 章节化」无关**：角色是**项目资产**。章节模式下骨架写 `<script src="./cast/<id>.js">`；单文件模式下由 [castInject.ts](./castInject.ts.md) 注入同一批脚本。两种形态都只注入**被勾选**的角色。
- **坐标约定写死在提示词里**：`(x, y)` 是**脚底中点**，`u` 是**1 个单位的像素高度**；角色表里 `units` 声明「高几个 u」（主角 8u、配角 6u），多角色的身高比例靠它对齐。
- **角色 id 是可读 slug**（`^[a-z][a-z0-9_]{0,23}$`，如 `hero` / `researcher` / `cat`），不是序号——角色是命名实体，「改这个角色」要能叫出名字；章节才是序号（`c01`）。
- **解析**：从角色文件块里取 `cast/<id>.js`；另有一条「从文本恢复角色表」的入口 `parseCastTable`（见 2.1）。
- **校验**：id / 数量 / `units` / `uses` / 代码形态逐条验，任一条不成立就不许落盘（规则见 2.2）。
- **读写角色文件**：把角色写进 `<项目目录>/cast/<id>.js`，写完删掉清单里没有的孤儿文件；定向改稿前把角色代码读回来作为上下文。
- **大纲文本**：`castOutlineText()` 把角色表渲染成给人 / 模型看的一行一角色文案（逐章生成、单文件生成、修改、路由四处都带上它）。

模块本身是**纯逻辑 + 文件读写**：不 import `projects.ts`（避免循环依赖）、不调用模型（模型调用在 `agent/html.ts` 的 `chatWithCast`）、不注册 IPC。与 [chapters.ts](./chapters.ts.md) 完全同构：项目目录一律作参数传入，模块自己不知道项目名。

## 2. 导出与关键实现

| 名称 | 签名 | 说明 |
| --- | --- | --- |
| `castRelPath(id)` | `(id: string) => string` | 角色 id → 项目内相对路径：恒为 `cast/<id>.js` |
| `isCastPath(rel)` | `(rel: string) => boolean` | 路径白名单：只认 `cast/<slug>.js`（`FILE_RE`），供文件块解析过滤 |
| `selectedMembers(list)` | `(list: ProjectCastMember[] \| undefined) => ProjectCastMember[]` | **本轮新增**：参与本次生成的角色。`selected === false` 才算不参与，`undefined` 当参与（老数据）；空 / 缺省列表返回 `[]` |
| `normalizeCastList(raw)` | `(raw: unknown) => { cast: ProjectCastMember[]; error?: string }` | 角色表规范化 + 校验：逐条归一字段（含 `selected`），任一条不合法即整体失败并带中文原因 |
| `parseCastTable(reply)` | `(reply: string) => { cast: ProjectCastMember[] \| null; error?: string }` | 从文本里读角色表（见 2.1）。**生成流程已不再使用**，保留给「从文本恢复角色表」 |
| `parseCastFiles(reply, fallbackId?)` | `(reply: string, fallbackId?: string) => { files; badPaths }` | 取角色文件块（与章节共用 `parseFileBlocksWith`）；`fallbackId` 用于块里没写路径时兜底成 `cast/<id>.js` |
| `validateCastCode(code)` | `(code: string) => string \| null` | 单个角色代码的校验（见 2.2）；通过返回 `null`，否则返回人话错误 |
| `writeCastFiles(dir, cast, files)` | `(dir: string, cast, files) => { written; removed }` | 写入给定角色文件，并**删掉角色表里没有的孤儿文件**；只写清单内名字的文件 |
| `removeCastFiles(dir)` | `(dir: string) => string[]` | 删掉 `cast/` 下所有角色文件，返回被删的文件名。**当前没有调用方**：切回单文件模式不再清角色（角色是项目素材，见 §5） |
| `readCastCode(dir, cast)` | `(dir: string, cast) => { id; name; code }[]` | 按角色表把现有 `cast/<id>.js` 读回（定向改稿与导出内联的上下文）；文件不存在给空串 |
| `castOutlineText(cast)` | `(cast) => string` | 角色表大纲：一行一个角色「- id（名字，高 Nu）：描述」；空表返回「本片没有共享角色（画面里不要出现固定角色，或由各章自己画一次性的路人）」 |

### 2.1 角色表现在从哪来（生成流程不再产角色）

**本轮的核心变化**：结构规划只输出 `mode` + `chapters`（`HTML_PLAN_SYSTEM` 里那一整套角色表规则已删除），所以**生成流程里没有任何一处调用 `parseCastTable`**。角色表只由两条与「生成 HTML」无关的路径产生：

| 路径 | 入口 | 主进程怎么建表 |
| --- | --- | --- |
| 「新建角色」 | `project:new-cast` | 弹窗填的 角色名 / 外形描述 / 高几 u / 是否用水彩 直接拼出一个 `ProjectCastMember`（`selected: true`、水彩 ⇒ `uses: ['p5','p5.brush']`），调一次模型画 `cast/<id>.js`，再追加进 `Project.cast` |
| 「从全局库添加」 | `project:import-cast` | 把 `<userData>/cast-library/<id>.js` **复制**进项目 `cast/`，元数据合并进 `Project.cast`（同名以库里那份为准） |

`parseCastTable` 因此退成**「从文本恢复角色表」**的工具（源码注释口径），并**仍在离线断言里被测**。它认四种写法，依次取第一个「能 `JSON.parse` 且带 `cast` 字段」的对象：

| 候选 | 形态 | 说明 |
| --- | --- | --- |
| CAST 块 | `<<<CAST>>> {json} <<<END CAST>>>` | 单独一份角色表 |
| PLAN 块 | `<<<PLAN>>> {json} <<<END PLAN>>>` | 结构规划块（历史形态：角色表曾与章节同在一个 JSON 里） |
| JSON 围栏 | Markdown 代码块里的 JSON | 模型没用标记时的常见退化写法 |
| 裸 JSON | 整段回复就是 JSON | 同上 |

- 四种都读不到 ⇒ `{ cast: null }`（= 没有角色表）。
- 读到但字段不合法 ⇒ `{ cast: null, error }`，`error` 直接进用户可见的失败文案（如「角色 id 重复：hero」）。

### 2.2 校验规则（写盘前的验收线）

| 规则 | 判据 | 失败文案要点 |
| --- | --- | --- |
| id 形态 | 必须匹配 `^[a-z][a-z0-9_]{0,23}$`（小写字母开头的 slug，直接当文件名用，不含路径分隔符） | 「角色 id 不合法（要求小写字母开头的 slug，如 hero / researcher）」 |
| id 唯一 | 同一份角色表内不许重复 | 「角色 id 重复」 |
| 数量 | 一支片子里 ≤ **12** 个角色 | 「角色过多…请控制在 12 个以内」 |
| `units` | 缺省 **8**，合法区间 1–30，按 0.1 取整 | 非法值静默落回 8（不报错） |
| `uses` | 只认 `p5` / `p5.brush`，`p5.brush` 自动补 `p5` | 白名单外静默丢弃 |
| `selected` | `it.selected === false` 才算不参与；其余（含缺省 / 非布尔）一律 `true` | 不报错（老数据零迁移） |
| 角色代码 | 必须出现 `__cast` 且含函数（`function (` 或 `=>`） | 「没有登记到 window.__cast 上」/「没有可调用的绘制函数」 |
| 不许 HTML | 去掉 `</script` 后仍出现 `<` 即判错（角色文件只能是 JS） | 「角色代码里出现了 HTML 标签」 |
| 不许无限循环 | 代码里不许 `repeat: -1` / `repeat: Infinity`（角色本身不该带时间轴，动画写在章节里） | 「角色代码里有无限循环」 |
| 代码长度 | ≤ **1200** 行（按行数粗校验） | 「角色代码过长…请拆成更简单的画法」 |

`selectedMembers()` 与 `normalizeMember()` 用的是**同一条语义**：`m.selected !== false` 才是「参与」。所以注入页面、写进骨架、进提示词、进导出**四处都只认同一个判据**。

### 2.3 骨架 / 注入怎么引入角色（不在本文件里）

- **章节模式**：`chapters.buildSkeleton({ chapters, canvas, total, cast })` 的 `cast` 参数**就是「要引入的那几个」**——调用方只传 `cast.selectedMembers(proj.cast)`，骨架按传入顺序写 `<script src="./cast/<id>.js">`，**不再看「各章 `ProjectChapter.cast` 的并集」**（`ProjectChapter.cast` 字段保留，但不再参与脚本引入）。脚本顺序：`gsap → p5 / p5.brush（按需）→ core.js → cast/<角色>.js → pages/cNN.js（按章）`。
- **单文件模式**：`projects.ts` 的 `applyCastToHtml()` 调 `castInject.injectCastTags(html, rels, { withCore })`，把 `core.js` + 被勾选角色的脚本整组插进模型写的 `index.html`。
- **库并集同时算章节 `uses` 与角色 `uses`**：只有角色用水彩、没有任何章声明 p5 时，光看章节就会漏引 p5，角色一调用就崩。

## 3. 关键流程 / 算法

### 3.1 生成：与角色无关，逐章 N 次

```
project:generate-html
  → 规划一次（模型只交 PLAN JSON：mode + chapters）
  → mode === 'chapters'：
       castList = cast.selectedMembers(proj.cast)      # 角色是素材，规划不产角色
       → 逐章 N 次：buildChapterPrompt（带【项目角色】= castList）→ chatWithChapter → 校验
       → writeChapterFiles → writeChapterSkeleton(name, proj, list, castList)
  → mode === 'single'：
       selected = cast.selectedMembers(proj.cast)
       提示词带【项目角色】（已注入页面、必须用它们画）
       → chatWithCustomModel → writeSingleHtml → applyCastToHtml 注入 script
```

- **本文件在生成链路里只被读**：`selectedMembers`（挑谁参与）、`castOutlineText`（大纲文案）、`castRelPath`（拼路径）。
- 角色代码**不在生成链路里产生**：新建角色与从全局库导入各有自己的频道（`project:new-cast` / `project:import-cast`）。

### 3.2 新建一个角色（`project:new-cast`）

```
project:new-cast（载荷 ProjectNewCastPayload：title / desc / units / watercolor）
  → id 用 slug（取标题里的英数；取不到就 cast<N>）
  → member = { id, name, desc, units, selected: true, uses? }
  → buildCastPrompt（【角色文件】+【角色设定】+【身高】+【全片角色表】）
  → chatWithCast → cast.parseCastFiles(reply, cast/<id>.js) → cast.validateCastCode
  → cast.writeCastFiles(dir, [...旧角色, member], [{ path, code }])
  → proj.cast = nextCast → refreshCastInPage()（章节模式重写骨架 / 单文件模式重新注入）→ writeProject
```

- 任何一步校验失败都不落盘（整次新建不生效）。
- **id 必须唯一**：`existing.has(id)` 时直接回「已经有同名角色（id …），换个名字」。

### 3.3 改稿：只可能「改某个角色的画法」

- 章节模式的「按需求修改」分两段（路由 → 定向编辑），**角色表不归模型管**：`HTML_CHAPTER_EDIT_SYSTEM` 明确写了角色表在「项目素材」区由用户勾选 / 新建，模型只可能被要求改某个**已有**角色的画法——那就只交 `cast/<id>.js` 这一个文件块。
- 主进程侧：`cast.parseCastFiles(reply)` 收文件块、`cast.validateCastCode` 校验、`cast.writeCastFiles(dir, nextCast, castFiles)` 写盘（**清单里没有的 id 直接判失败**：「角色只能在「项目素材 · 角色」里新建或从全局库导入，不能靠改稿生成」）。
- 新角色不会从改稿里冒出来：`nextCast = curCast`（角色表整份不变），角色文件块必须对应表里已有的 id。

### 3.4 角色表变更立即生效（`refreshCastInPage`）

新建 / 导入 / 勾选 / 移除之后，`projects.ts` 的 `refreshCastInPage(name, proj)` 按当前产物形态让页面立刻反映：

- **章节模式**（`proj.chapters` 非空）：`writeChapterSkeleton(...)` 重写骨架——骨架里的 script 清单就是「谁参与」的真相；
- **单文件模式**：读回 `index.html`、`applyCastToHtml()` 重新注入（`castInject` 幂等，**不动模型写的内容**），有变化才写盘；
- 两种情况最后都 `writeProject(proj)`。

## 4. 依赖与协作

- **被 `projects.ts` 调用**：生成（挑角色 / 大纲）、新建角色、导入、改稿、导出五处；`projects.ts` 负责模型调用、IPC 与落盘顺序，`cast.ts` 只做「解析 → 校验 → 读写 → 大纲 → 过滤」。
- **只从 `chapters.ts` 借一个函数**：`parseFileBlocksWith(reply, accept, fallbackPath)`——章节与角色共用同一套 `<<<FILE …>>>` 标记与解析，`cast.ts` 只提供 `isCastPath` 当白名单。方向单向（`cast → chapters`），`chapters` 不知道角色。
- **不 import `projects.ts`**：否则与 `projects → cast` 成环。项目目录一律作参数传入（`writeCastFiles(dir, …)` / `readCastCode(dir, …)`）。
- **不调用模型**：模型调用在 `agent/html.ts` 的 `chatWithCast`（角色文件）里，规划 / 单章 / 单章修改 / 路由分别在 `chatWithChapterPlan` / `chatWithChapter` / `chatWithChapterEdit` / `chatWithRoute`。
- **不注册 IPC、不碰渲染层**：角色表随 `project:load` 的 `Project.cast` 回给渲染层，「HTML生成」页的 `CastSection.vue` 读写它（勾选 / 移除 / 改名都走 `project:save-cast`，新建走 `project:new-cast`，导入走 `project:import-cast`）；进度仍复用 `project:html-progress`。
- **角色表的类型真源在 `src/shared/types.ts`**（`ProjectCastMember`），本模块只读它的字段，不另立一套结构。
- **与 `castLibrary.ts` 分工**：全局库（`<userData>/cast-library/`）的读写搬移在 [castLibrary.ts](./castLibrary.ts.md)；本模块只管**项目里**的 `cast/`。

## 5. 注意事项与实现要点

- **角色是代码、不是素材图片，但它是「项目素材」**：`cast/<id>.js` 里只有「怎么把这个人画出来」，没有图片、没有时间轴；一个角色一份文件，跨形态复用同一份。它归项目所有（与 `images/` / `video/` 并列），但**不随「单文件 / 章节化」的切换被清掉**。
- **`selected` 缺省就是参与**：`normalizeMember` 写的是 `it.selected === false ? false : true`，`selectedMembers` 写的是 `m.selected !== false`——两处同一条判据，老数据（没有这个字段）与新建（`selected: true`）都算参与。
- **切回单文件不再清 `cast/`**：`writeSingleHtml()` 清的是 `pages/` 与 `Project.chapters`，`Project.cast` 与 `cast/` 原样保留（`removeCastFiles()` 因此当前没有调用方）。理由（源码注释）：角色是项目素材，与「这一版用几个文件写」无关。
- **`ProjectChapter.cast` 是保留字段**：它仍出现在章节清单里、仍进大纲文案，但**不再决定骨架引哪些角色脚本**——骨架「传谁引谁」，只看 `selectedMembers(proj.cast)`。
- **身高比例靠 `units`，不靠像素**：角色函数按 `u` 的倍数绘制（主角 8u、配角 6u），所以改 `units` 会让整片里这个人的大小一起变——这也是角色行里唯一影响「相对尺度」的字段（所以它在界面上单独占一列）。
- **孤儿清理是写盘的安全网**：`writeCastFiles()` 删角色表外的文件，保证磁盘上的角色脚本与 `Project.cast` 一致（`project:save-cast` 的「移除」也靠它：主进程先删掉清单里没有的 `cast/<id>.js` 再落盘）。
- **`units` / `uses` 的容错是静默的**：非法 `units` 落回 8、白名单外的 `uses` 直接丢——只有 id、数量、唯一性和代码形态这几条会真正判失败。角色是「画得出来就行」的东西，不值得因为一个单位数字打断整次操作。
- **1200 行是粗校验**：角色是「一个人」，画到两三千行就不是它能承担的粒度了；超线提示拆成更简单的画法。
- **`p5.brush` 隐含 `p5`**：角色表与章节表同一条规则，归一化时就会把 `p5` 补进 `uses`，骨架因此不会先加载插件后退化。
- **`parseCastTable` 还在，但请别再把它接回生成链路**：生成流程不产角色是这一轮定下的结构（角色 = 项目素材），把它接回去会让「角色表被一次生成重命名 / 丢掉」的历史问题复活。
