# src/main/cast/

> **角色**（侧栏「角色」页 = 全局角色库；「HTML生成」页 ·「角色」区 = 本片用哪几个）的**目录模块**：一页覆盖 `src/main/cast/` 下 **9 个文件**——角色表与 `cast/<id>.js` 的解析 / 校验 / **只读**、改稿用的**只读**角色块、单文件页面的角色注入、**全局角色库**（`<userData>/cast-library/`，角色唯一真源）、角色静态预览页、**内置动作数据**、**动作库**（公共动作 + 每角色专属）、**会动的动作示范页**，外加一个只做再导出的 `index.ts`。
>
> **角色只有全局一份**：项目里只记「本片用了哪几个角色」（`project.json` 的 `cast = [{ id, selected }]`），生成前由主进程把勾中的从库**复制**成 `<项目>/cast/` 副本。所以本模块**不再写项目里的角色代码**——副本的增删统一走 `library.ts` 的 `syncProjectCast()`。本模块**不调模型、不注册 IPC、不 import `projects/`**（模型调用在 `projects/ipc/castActions.ts`）。

- **所在目录**：`src/main/cast/`（**同名目录 + `index.ts` 出口**，与 `agent/`、`updater/`、`projects/` 同一套约定；拆法见根 `AGENTS.md` 关键约定 9）
- **类型**：纯逻辑 + 库/项目文件读写（`table.ts` / `library.ts` / `actions.ts` 碰盘；`edit.ts` / `inject.ts` / `preview.ts` / `demo.ts` 只做字符串；`presets.ts` 只有数据）+ 一个只再导出的出口
- **规模**：**9 个文件、合计 1408 行、最长 263 行**（`table.ts` 158 / `edit.ts` 47 / `inject.ts` 54 / `library.ts` **241** / `preview.ts` 151 / `index.ts` **66** / **`presets.ts` 172** / **`actions.ts` 256** / **`demo.ts` 263**；实测 `[IO.File]::ReadAllLines`。上一版是 6 个文件、691 行）
- **对外导出**：**37 个具名导出**（`index.ts` 把八份文件的具名导出**扁平合并**，无重名），外部一律 `import * as cast from '../cast'`
- **目录级一篇**：本篇即 `src/main/cast/` 的唯一说明文档——**内部怎么分文件对外不可见**，调用方不要 `import '../cast/table'` 这种子文件路径

## 1. 作用与界面位置

先把界面上的位置认清楚，再看代码——本目录的每份文件都只服务其中之一或几处：

| 界面上的位置 | 背后是本目录的哪份文件 |
|---|---|
| 侧栏**「角色」页** · 卡片墙（新建 / 改画法… / 改信息… / 复制 id / 删除） | `library.ts`（`upsertMember` / `writeMemberCode` / `updateMemberMeta` / `removeFromLibrary` / `nextAutoId`）；页面本体见 [CastPage.md](../renderer/src/pages/CastPage.md) |
| 「角色」页 / 「HTML生成」页 · 角色区 / 「内容脚本」页 · 选角色弹窗里的**卡片预览**（`<userData>/cast-preview/<id>.html` 在 iframe 里把角色代码**真跑一遍**） | `preview.ts`（拼那一页）+ `library.ts` 的 `readMemberCode` |
| 「角色」页 · **卡片双击**（或右上「…」菜单 ·「动作示范…」）→ 弹窗左边那张**会动的图** | `demo.ts`（拼示范页）+ `actions.ts` 的 `listActionsFor` + `library.ts` 的 `readMemberCode`；落盘在 `projects/ipc/castActions.ts` 的 `cast:demo` |
| 同一个弹窗右边的**公共动作列表**（内置 14 条 + 用户自建） | `presets.ts`（`PRESET_ACTIONS`，只读）+ `actions.ts`（`actions.json` 的 `shared`） |
| 同一个弹窗右边的**本角色专属**列表 +「AI 生成…」面板 | `actions.ts`（`actions.json` 的 `byCast[<角色id>]`、`parseCastActionReply` / `validateActionCode` / `upsertAction`）；模型调用与提示词在 `projects/ipc/castActions.ts` 与 `agent/castAction.ts` |
| 弹窗里的「新建动作…」/「改」→ **关键帧表编辑器** | `actions.ts` 的 `normalizeActionDef`（点「保存」时经 `cast:action-save` → `upsertAction` 落盘） |
| **「HTML生成」页 ·「角色」区**（只勾选：本片用哪几个） | `table.ts` 的 `selectedMembers` + `library.ts` 的 `syncProjectCast`（`project:save-cast` 里调） |
| 「HTML生成」页 ·「按需求修改」时**只发角色表**（不发源码、不收角色文件块） | `edit.ts`（`buildCastTableBlock` / `stripCastFileBlocks`） |
| 点「生成 HTML」之后**单文件页面里的角色注入**（模型写的 `index.html` 里补上 `core.js` + 角色脚本） | `inject.ts` |
| 章节模式下**章节骨架里的角色脚本**（骨架按传入的角色清单写 `<script src="./cast/<id>.js">`） | 不在本目录：`chapters/buildSkeleton({ …, cast })`；本目录只提供「谁参与」的过滤（`selectedMembers`）与路径（`castRelPath`） |
| 「HTML生成」页 · **下载 HTML** 时把角色内联进导出单文件 | `table.ts` 的 `readCastCode`（只读） |

### 1.1 角色是什么：一份绘制代码，不是一个素材文件

角色不是图片，而是 `<id>.js` 里登记的绘制函数：

```js
window.__cast = window.__cast || {};
window.__cast["hero"] = function (x, y, u, o) { /* 在 o.ctx 上画 */ };
```

- **为什么角色要单独一份代码**：章节是互相隔离的 IIFE，作用域不共享；不共享角色代码，同一个人会在各章被各画一遍，长相对不上。所以角色脚本必须**先于**用到它的代码加载（与参考项目把 `clawd.js` / `cast.js` 放在 `ch/*.js` 之前同理）。
- **它不再是「项目素材」**：角色是**全局资产**（可备份、可迁移、跨项目复用），项目里那份只是产物副本。所以新建 / 改画法 / 删除都只在「角色」页做，**都不经过「生成 HTML」**。
- **坐标约定写死在提示词里**：`(x, y)` 是**脚底中点**，`u` 是**1 个单位的像素高度**；角色表的 `units` 声明「高几个 u」（主角 8u、配角 6u），多角色的身高比例靠它对齐。
- **它是纯绘制函数、自己不含时间轴**：调用方按时间把 `o.walk / aL / aR / eyes / mouth / blink / dy / dx / rot / sq` 传进去，它才动（契约见 `agent/html.ts` 的 `HTML_CAST_SYSTEM`）。方向按角色端实际实现：`dy` 正 = 下移、`dx` 正 = 右移、`aL`/`aR` 正 = 向外抬起、`sq` 正 = 拉长变窄、`rot` 正 = 顺时针、`walk` 是摆腿相位。
- **id 是可读 slug**（`^[a-z][a-z0-9_]{0,23}$`，如 `hero` / `researcher` / `cat`），不是序号——角色是命名实体，「改画法」要能叫出名字；章节才是序号（`c01`）。

### 1.2 三层关系（别混）

| 层 | 位置 | 性质 |
|---|---|---|
| **全局角色库** | `<userData>/cast-library/`（`index.json` + `<id>.js` + **`actions.json`**） | 角色的**唯一真源**，是**用户资产**（落 userData 而不是 `vendor/`，升级不冲掉该目录）。`actions.json` 是动作库（公共动作 + 每角色专属），与角色同目录、同属用户资产 |
| **项目副本** | `<项目>/cast/<id>.js` | **产物副本**：`hgpreview://` 协议与 HyperFrames 的静态服务器都只放行项目目录内的文件，所以用到谁就把库里那份复制进来。由 `syncProjectCast()` 统一维护，界面上**不出现**「导入 / 存为全局」这类动作 |
| **共享绘制助手** | `<项目>/core.js` | 应用内置（`coreLib.ts`），与角色无关，按版本同步 |

**元数据只有库一份**：`project.json` 只落 `[{ id, selected }]`，读项目时由 `projects/store.ts` 的 `resolveProjectCast` 按 id 从库补全——所以在库里改名 / 改身高，所有项目立刻跟着变（旧实现是每个项目各存一份快照，改不动也同步不了）。

### 1.3 「谁参与本次生成」只有一个判据

`selectedMembers()` 与写盘时裁 `cast` 的逻辑都认 **`m.selected !== false`**（`undefined` 当参与，老数据零迁移）。注入页面 / 写进骨架 / 进提示词 / 内联导出四处同一条。

## 2. 目录结构（9 个文件）

| 文件 | 行数 | 职责 | 依赖（目录内 / 目录外） |
|---|---|---|---|
| `index.ts` | **66** | **统一出口**：把八份文件的具名导出扁平合并成 37 个，**只再导出、不写逻辑** | `./table` `./edit` `./inject` `./library` `./preview` `./presets` `./actions` `./demo` |
| `table.ts` | 158 | **角色表与角色文件**：解析 / 规范化 / 校验 / **读**项目副本 / 提示词大纲 | `../chapters`（`parseFileBlocksWith`）、`node:fs` / `node:path`、共享类型——**目录内最上游（与 `presets.ts` 并列）** |
| `edit.ts` | 47 | **改稿用的只读角色块**：剥掉回复里的角色文件块 + 拼【项目角色】表（【角色调用方式】要求**驱动 `o` 的动画参数** `walk` / `aL`、`aR` / `eyes`、`blink` / `dy`…，且「页面里已有的调用保留并沿用原来的动画参数」） | `./table`（`castRelPath`）、共享类型；**不读盘、不调模型** |
| `inject.ts` | 54 | **单文件模式注入**：`core.js` + 角色脚本整组插在模型第一个 `<script>` 之前（纯字符串） | **无**（不 import 任何模块） |
| `library.ts` | **241** | **全局角色库** `<userData>/cast-library/`：读库 / 新建与改画法落盘 / 改元数据 / 删除（**连带清掉这个角色的专属动作**）/ **同步项目副本** | `node:path` / `node:fs`、共享类型、**`./actions` 的 `removeActionsOfCast`**（删角色时清 `actions.json` 的 `byCast[<id>]`）；**刻意不 import `electron`**，库根由调用方给，可离线测 |
| `preview.ts` | 151 | **角色静态预览页拼装**：内联 `core.js` + 角色代码 → 一页自包含 HTML（落盘在 `projects/ipc/cast.ts`） | **无**（纯字符串，不读写文件、不 import `electron`） |
| **`presets.ts`** | **172** | **内置动作数据**（14 条公共动作，**只读**）：只有数据、没有逻辑 | `../../shared/types`（`CastActionDef`）；**目录内最上游之一** |
| **`actions.ts`** | **256** | **动作库**：规范化 / 静态校验 / 生成回复解析 / 读写 `<userData>/cast-library/actions.json` / 列某角色的动作 / 起 id / 增删 / 删角色时清专属动作 | `./presets`（`PRESET_ACTIONS`）、`../../shared/{types,constants}`、`node:path` / `node:fs`；**不 import `electron`、不 import `library.ts`** |
| **`demo.ts`** | **263** | **动作示范页拼装**：内联 `core.js` + 角色代码 + 动作表 + 动作脚本 + 帧循环 → 一页自包含 HTML（落盘在 `projects/ipc/castActions.ts` 的 `cast:demo`） | **只依赖 `../../shared/types` 的类型**（纯字符串，不读写文件、不 import `electron`） |

**依赖方向单向（无环）**：`presets` 与 `table` 在最上游；`actions` 依赖 `presets`；`library` 依赖 `actions`（删角色时清它的专属动作）；`demo` 只依赖 `shared` 的类型；`edit → table`；`inject` / `preview` 互不依赖。

## 3. 统一出口：`index.ts`

### 3.1 扁平再导出的 37 个具名导出（按来源文件分组）

| 来源 | 个数 | 导出 |
|---|---|---|
| `table.ts` | 9 | `castRelPath` / `isCastPath` / `selectedMembers` / `normalizeCastList` / `parseCastTable` / `parseCastFiles` / `validateCastCode` / `readCastCode` / `castOutlineText` |
| `edit.ts` | 2 | `stripCastFileBlocks` / `buildCastTableBlock` |
| `inject.ts` | 3 | `stripInjectedCast` / `injectCastTags` / `referencesCore` |
| `library.ts` | 9 | `readLibrary` / `libraryFileExists` / `readMemberCode` / `writeMemberCode` / `upsertMember` / `updateMemberMeta` / `syncProjectCast` / `removeFromLibrary` / `nextAutoId` |
| `preview.ts` | 2 | `previewRelPath` / `buildCastPreviewHtml` |
| **`presets.ts`** | **1** | **`PRESET_ACTIONS`** |
| **`actions.ts`** | **9** | **`normalizeActionDef` / `validateActionCode` / `parseCastActionReply` / `readActions` / `listActionsFor` / `nextActionId` / `upsertAction` / `removeAction` / `removeActionsOfCast`** |
| **`demo.ts`** | **2** | **`demoRelPath` / `buildCastDemoHtml`** |

**上一版删掉的导出**（记录在此，避免有人再去找）：

| 删掉的 | 原在 | 为什么删 |
|---|---|---|
| `writeCastFiles` / `removeCastFiles` | `table.ts` | 项目 `cast/` 只由 `syncProjectCast` 维护，角色代码不再由改稿写 |
| `readCastSources` / `buildCastEditBlock` | `edit.ts` | 改稿不再发角色源码（只发只读角色表） |
| `importToProject` | `library.ts` | 不再有「手动导入项目」——勾选即同步 |
| `promoteFromProject` | `library.ts` | 只服务旧数据迁移；本版本未发布、没有旧用户数据，迁移代码已整段删除 |

### 3.2 这条出口的三条规矩

1. **只再导出**：`index.ts` 不写任何逻辑、不做汇总计算。
2. **导出名就是跨模块契约**：`projects/` 的四个域与 `main/index.ts` 都只按名字取，**改内部拆分不该改导出名**。
3. **不 import `projects/`**：本目录是下游可复用的纯逻辑层；需要路径时由调用方传进来（`syncProjectCast(root, projectDir, ids)` 的两个路径都是参数，`readActions(root)` / `listActionsFor(root, castId)` 的 `root` 同理）。

## 4. 分文件说明

### 4.1 `table.ts` —— 角色表与角色文件（158 行）

只做：解析角色表 / 解析角色文件块 / 校验 / **读**项目里的角色副本 / 提示词大纲。**不写**角色代码（真源在 `library.ts`）。

#### 4.1.1 导出清单与契约（9 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `castRelPath(id)` | `(id) => 'cast/' + id + '.js'` | 项目内相对路径（骨架 / 注入 / 提示词都用它） |
| `isCastPath(rel)` | `(rel) => boolean` | 是否形如 `cast/<id>.js`（`FILE_RE`） |
| `selectedMembers(list)` | `(ProjectCastMember[] \| undefined) => ProjectCastMember[]` | 参与本次生成的角色：**只有 `selected === false` 才算不参与**，`undefined` 当参与（老数据） |
| `normalizeCastList(raw)` | `(raw) => { cast; error? }` | 整份角色表规范化：≤12 个、id slug 不重复、`units` 1–30 缺省 8、`uses` 只认 `p5` / `p5.brush`（声明 `p5.brush` 自动补 `p5`）、`selected` 缺省参与 |
| `parseCastTable(reply)` | `(reply) => { cast \| null; error? }` | 从回复里读角色表（认 `<<<CAST>>>` 块 / `<<<PLAN>>>` 块 / ```` ```json ```` 围栏 / 裸 JSON）。**生成流程已不再使用**，留作历史回复解析与人工排查的退路 |
| `parseCastFiles(reply, fallbackId?)` | `(reply, fallbackId?) => { files; badPaths }` | 解析 `<<<FILE cast/<id>.js>>>` 块（复用 `chapters.parseFileBlocksWith`）；`fallbackId` 用于块里没写路径时兜底（新建 / 改画法都传当前 id） |
| `validateCastCode(code)` | `(code) => string \| null` | 写盘前硬校验：非空、必须含 `__cast`、必须含函数、不许 HTML 标签、不许 `repeat: -1`、≤1200 行 |
| `readCastCode(dir, cast)` | `(dir, list) => { id; name; code }[]` | **只读** `<项目>/cast/<id>.js`（读不到给空串），供「下载 HTML」内联用 |
| `castOutlineText(cast)` | `(list) => string` | 提示词用的角色表（`- id（名字，高 Nu）：描述`）；空表给一行「本片没有共享角色…」 |

#### 4.1.2 关键常量与校验规则

| 常量 / 判据 | 值 | 为什么 |
|---|---|---|
| `CAST_DIR` | `'cast'` | 项目内副本目录 |
| `ID_RE` / `FILE_RE` | `/^[a-z][a-z0-9_]{0,23}$/`、`/^cast\/([a-z][a-z0-9_]{0,23})\.js$/` | id 是**可读 slug**、直接当文件名用，不许出现路径分隔符（与 `library.ts`、`projects/store.ts` 同一口径） |
| `MAX_CAST_LINES` | `1200` | 按行数粗校验：角色是「一个人」，画到两三千行就不是它能承担的粒度 |
| `USES_WHITELIST` | `['p5', 'p5.brush']` | 与 `library.ts` 同口径 |
| `units` 规范化 | 1–30，非法落回 8 | 主角 8 的量级，与参考项目一致 |
| `HTML_TAG_RE` | `</xxx>` / `<!doctype` / 一组常见标签名 | 只拒**真的 HTML 形状**；曾经用 `/<` 把 `side < 0` 这种比较误判成 HTML（线上踩过），现在不会 |
| `desc` 上限 | 200 字符 | 提示词里的角色表要短 |

> ⚠️ **`table.ts` 的 `normalizeMember` 不解析 `style`**（源码事实：`parseCastTable` / `normalizeCastList` 产出的成员没有 `style` 字段）。`style` 只在 `library.ts` 的 `normalizeMember` 与 `updateMemberMeta` 里被规范化，也就是**只有库里那份带画风**。

#### 4.1.3 `parseCastTable()` 还能读四种写法（但生成流程不再用它）

依次尝试：`<<<CAST>>>…<<<END CAST>>>` → `<<<PLAN>>>…<<<END PLAN>>>` → ```` ```json ```` 围栏 → 整段回复本身；取第一个「能 `JSON.parse` 且是带 `cast` 字段的对象」，再交给 `normalizeCastList` 校验。保留它为了两条退路：① 将来允许模型在改稿里「顺手交一份角色表」；② 离线断言与人工排查要能解析历史回复。

#### 4.1.4 只有「读」，没有「写」

项目里的 `<项目>/cast/<id>.js` 是**产物副本**（由 `library.syncProjectCast` 从全局库同步），所以本文件**没有写盘函数**：

- 旧版 `writeCastFiles(dir, cast, files)` / `removeCastFiles(dir, cast)` **已删除**——改稿不再写角色代码，副本的增删统一走 `syncProjectCast`（它的删除规则更保守：只删库里认得的 id，见 §4.4.5）。
- `readCastCode()` 的唯一调用点是 `projects/ipc/html.ts` 的「下载 HTML」（把 `cast/<id>.js` 内联进导出的单文件）。

#### 4.1.5 边界与依赖

- 全部函数都是**纯函数或只读盘**，不调模型、不写盘、不注册 IPC。
- 唯一的外部依赖是 `chapters.parseFileBlocksWith`（章节与角色共用同一套 `<<<FILE …>>>` 标记）：方向 `cast → chapters`。

### 4.2 `edit.ts` —— 改稿用的只读角色块（47 行）

改稿链路上与角色有关的**只剩「只读」这一层**：告诉模型页面里已经有哪些角色可以调用、不许重画，**不发角色源码、也不收角色文件块**。为什么：角色只有全局一份，改画法走「角色」页的 `cast:recreate`；用户明确要求「HTML 那边不允许新增和修改角色」。

#### 4.2.1 导出清单与契约（2 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `stripCastFileBlocks(reply)` | `(reply) => string` | 两条正则、按顺序：① 整个 `<<<FILE cast/<id>.js>>>…<<<END FILE>>>` 段 → `''`；② 残留的 `<<<FILE …>>>` / `<<<END FILE>>>` 标记 → `''`。为什么还要剥：提示词已说明不许交角色块，但模型仍可能顺手裹一个进来，不剥的话标记会跟着 HTML 落进 `index.html`（页面上看得见） |
| `buildCastTableBlock(list)` | `(ProjectCastMember[]) => string` | 【项目角色】整段：角色表（`cast/<id>.js`（名字，高 Nu）：描述，未勾选的加「〔本次未勾选：不注入页面〕」）→【角色调用方式】→【硬要求】两条（**沿用不许重画** / **角色文件不归你改，要换样子请去「角色」页**）；【角色调用方式】列出 `o` 里的动画参数（`o.walk` 摆腿相位 / `o.aL`、`o.aR` 摆臂角度 / `o.eyes`、`o.mouth` 表情 / `o.blink` 眨眼 / `o.dy`、`o.dx` 位移 / `o.rot` 旋转 / `o.sq` 挤压）、写明「**光传 `ctx`，角色就是一张不会动的立绘**」、**「页面里已有的调用保留并沿用原来的动画参数」**（新写 / 改写的调用要按 `t` 算出呼吸、眨眼与摆臂，参数必须由 `t` 直接算，**确实要静止才只传 `ctx`**）。空表只回一行「本项目还没有角色（不要写 `window.__cast` 的调用，也不要新建角色文件）」 |

#### 4.2.2 与旧版（已删）的差别

| | 旧版 | 现在 |
|---|---|---|
| 发不发源码 | 发：`readCastSources(dir, list, budget?)` 读 `<项目>/cast/<id>.js` 包成 `<<<CURRENT …>>>` 块（`CAST_SOURCE_BUDGET = 100000` 字符预算、按角色表顺序截断） | **不发**：只发角色表（元数据）；源码只在「改画法」时由 `projects/prompts.ts` 的 `buildCastEditPrompt` 发那一**份** |
| 收不收代码 | 收：回复里的 `cast/*.js` 块先校验后写盘（`writeCastFiles`） | **不收**：`projects/ipc/html.ts` 只 `stripCastFileBlocks` + 判有没有 HTML；没有 HTML 直接报错 |
| 硬要求 | 三条（沿用 / 只能改不能新增 / 只改画法就交整份） | 两条（沿用不许重画 / 角色文件不归你改） |

#### 4.2.3 边界

- **纯字符串处理**：不读盘、不调模型、不 import `projects/`（与 `table.ts` 的分工一致）。
- `buildCastTableBlock` 与章节模式的 `buildChapterPrompt` 里那段【项目角色】口径一致：**必须沿用、不许重画**；差别只在单文件模式要额外说清「角色文件不归你改」。**两条路径都要求**驱动 `o` 里的动画参数（`walk` / `aL`、`aR` / `eyes`、`mouth` / `blink` / `dy`、`dx` / `rot` / `sq`；光传 `ctx` 就是一张不会动的立绘）；`buildCastTableBlock` 还多一句「页面里已有的调用保留并沿用原来的动画参数」。

### 4.3 `inject.ts` —— 单文件模式的角色注入（54 行）

#### 4.3.1 导出清单与契约（3 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `stripInjectedCast(html)` | `(html) => string` | 剥掉上一次注入的整组标签（`data-myv-*` 标记） |
| `injectCastTags(html, rels, opts)` | `(html, string[], { withCore }) => string` | 先剥旧标签，再把 `<script src="./cast/<id>.js">` 与（`withCore` 时）`<script src="./core.js">` 整组插在模型第一个 `<script>` 之前 |
| `referencesCore(html)` | `(html) => boolean` | 页面里是否已经引了 `core.js`（避免重复注入） |

#### 4.3.2 三条规则

1. **幂等**：注入前先 `stripInjectedCast`，重复调用不会叠标签。
2. **整组插在模型第一个 `<script>` 之前**：角色脚本必须早于页面自己的脚本，否则 `window.__cast` 还没登记就被调用。
3. **空列表时不硬塞 `core.js`**：`projects/htmlWrite.ts` 的 `applyCastToHtml` 在没有勾选角色时只做「剥掉上次注入」（`withCore: false`）——模型写的单文件页面本来就不认识 `MC.*`，塞一份只是无谓体积。

#### 4.3.3 边界

纯字符串、无依赖；**只服务单文件模式**——章节模式的骨架由 `projects/htmlWrite.ts` 的 `writeChapterSkeleton` 生成，脚本清单里直接写 `cast/<id>.js`。

### 4.4 `library.ts` —— 全局角色库（241 行）

#### 4.4.1 库的形状

```
<userData>/cast-library/
├── index.json          # { members: [{ id, name, desc?, style?, units, uses? }] }
├── <id>.js             # window.__cast["<id>"] = function (x, y, u, o) {…}
└── actions.json        # { shared: CastActionDef[], byCast: { [角色id]: CastActionDef[] } }
                        #   ↑ 动作库，读写在 actions.ts；本文件只在删角色时清 byCast[<id>]
```

- 路径拼装全在本文件：`indexPath(root)` / `memberFile(root, id)`；`root` 由调用方给（`projects/paths.ts` 的 `castLibraryRoot()`）。
- **`ID_RE = /^[a-z][a-z0-9_]{0,23}$/`**：id 是直接当文件名用的 slug。
- `normalizeUses`：只认 `p5` / `p5.brush`，声明 `p5.brush` 自动补 `p5`；`normalizeUnits`：1–30，非法落回 8；`normalizeMember`：`name` ≤40、`desc` ≤400、**`style` ≤600**，id 不合法的条目直接丢掉。
- 索引可容忍两种形状：数组本身，或 `{ members: [...] }`。

#### 4.4.2 导出清单与契约（9 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `readLibrary(root)` | `(root) => { members; error? }` | 读索引并逐条规范化；文件缺失 / 损坏都当空库并回 `error`（不抛）。**索引里有、文件不在的条目照样列出来**（界面据此显示「文件缺失」，而不是静默消失）。也解析并规范化 `style` |
| `libraryFileExists(root, id)` | `(root, id) => boolean` | 某个角色文件是否真的在库里（`projects/ipc/cast.ts` 用它给条目补 `missing`） |
| `readMemberCode(root, id)` | `(root, id) => string` | 读一个角色的绘制代码（预览 / 改画法 / **动作示范**用）；id 不合法 / 不存在 / 读失败一律空串，调用方自己判空 |
| `writeMemberCode(root, id, code)` | `(root, id, code) => { ok; message }` | **覆盖写** `<id>.js`（`trim() + '\n'`），**不建索引**（索引由 `upsertMember` 维护） |
| `upsertMember(root, member, code?)` | `(root, member, code?) => { ok; message }` | 新建 / 覆盖一条库成员：写索引（同 id 就地替换、新成员追加在末尾——列表顺序对用户稳定）＋ 可选写代码文件；**`code` 省略时要求库里已有 `<id>.js`**，否则报「库里找不到这个角色的代码」 |
| `updateMemberMeta(root, id, patch)` | `(root, id, patch: {name?, desc?, style?, units?, watercolor?}) => { ok; message; member? }` | **只改元数据**、不碰代码文件。`watercolor: true` → `uses = ['p5','p5.brush']`、`false` → 删掉 `uses`；`style` 为空则删字段 |
| `syncProjectCast(root, projectDirPath, ids)` | `(root, projectDir, string[]) => { copied; removed; missing }` | **把「本片用哪几个」同步成项目副本**，见 §4.4.5 |
| `removeFromLibrary(root, id)` | `(root, id) => { ok; message }` | 从库删掉：删 `<id>.js`（有就删）+ 过滤索引 + **调 `removeActionsOfCast(root, id)` 清掉它在 `actions.json` 里的专属动作**（清理在 `try` 内，清理失败不阻断删角色）。**不动任何项目里已同步的副本**（下一次 `syncProjectCast` 会收走）。成功文案「已从角色库移除：<id>」 |
| `nextAutoId(root, taken = [])` | `(root, taken?) => string` | 下一个可用 id：`cast1` / `cast2` …（标题里取不到英文 slug 时兜底） |

#### 4.4.3 谁在调它

| 调用方 | 用了哪些 |
|---|---|
| `projects/ipc/cast.ts`（`registerCastIpc`） | `readLibrary` / `libraryFileExists` / `readMemberCode` / `writeMemberCode` / `upsertMember` / `updateMemberMeta` / `removeFromLibrary` / `nextAutoId` / `parseCastFiles` / `validateCastCode` / `isCastPath` / `castRelPath` / `selectedMembers` / `buildCastPreviewHtml` / `previewRelPath` / `syncProjectCast` |
| `projects/ipc/castActions.ts`（`registerCastActionIpc`） | `readLibrary` / `readMemberCode` / `readActions` / `listActionsFor` / `nextActionId` / `upsertAction` / `removeAction` / `buildCastDemoHtml` / `demoRelPath` / `parseCastActionReply` / `validateActionCode` / `isCastPath` |
| `projects/store.ts` | `readLibrary`（`resolveProjectCast` 按 id 补全） |
| `projects/htmlWrite.ts` | `selectedMembers` / `injectCastTags` / `syncProjectCast`（两处同步点） |
| `projects/prompts.ts` | `castOutlineText` / `castRelPath`（`buildCastPrompt` / `buildCastEditPrompt` / `buildCastActionPrompt`） |
| `projects/ipc/html.ts` | `selectedMembers` / `castOutlineText` / `readCastCode` / `castRelPath` / `stripCastFileBlocks` / `buildCastTableBlock` |
| `projects/chaptersFlow.ts` | `castOutlineText` / `selectedMembers`（角色表只作上下文） |

#### 4.4.4 没有旧数据迁移（本版本刻意不做）

- 角色库是**本版本新引入**的结构，还没对外发布、也没有旧用户数据，所以 `projects/store.ts` 里**没有迁移函数、没有标记文件**，`readLibrary` 也没有「一次性全局化」的旁路。
- `cast:list` 因此是**纯读**（`readLibrary` + 按文件在不在补 `missing`），不写任何东西。
- 开发机上若已经攒了角色文件，由**一次性脚本**手工搬进库（搬前先备份成 `cast-library.bak-<时间戳>`）；这条流程不在应用里，也没有对应 IPC。

#### 4.4.5 `syncProjectCast()` 的三条规则（副本的唯一维护者）

```
syncProjectCast(root, projectDirPath, ids):
  lib      = readLibrary(root)              # 只认库里认得的 id
  want     = ids ∩ libIds（且 id 合法）
  castDir  = <项目>/cast/                   # 建不出来就直接返回 missing = want
  want 里每个 id：库里缺文件 → missing；否则 copy 覆盖 → copied
  盘上每个 <slug>.js：
      在 want 里        → 跳过
      库里没有这个 id   → **跳过**（库里没有它，先不动项目里的文件）
      否则              → 删掉 → removed
  return { copied, removed, missing }
```

1. **勾选的从库复制（覆盖）**：保证生成 / 预览 / 渲染都读得到。
2. **取消勾选的删掉副本**，但**只删库里认得的 id**——项目里若还留着库里没有的旧文件，先不动它们（源码注释原话：「免得『库还没收进来就先删了副本』」）。
3. **幂等**：`mkdir -p` 后逐份 `copyFileSync`，重复调用没有副作用。

**调用点三处都在 `projects/htmlWrite.ts`**：`applyCastToHtml()`（单文件注入前）、`writeChapterSkeleton()`（写骨架前）、经 `refreshCastInPage()` 间接覆盖（勾选变了之后重刷页面）。`projects/ipc/cast.ts` 的 `project:save-cast` 同样**先**同步副本、再重刷页面。

#### 4.4.6 删角色连带清专属动作

- **界面上**：「角色」页 · 卡片右上「…」菜单 ·「删除」→ 二次确认 → `cast:remove` → `removeFromLibrary`。
- 库里的 `<id>.js` 与 `index.json` 的那一条删掉之后，**同一个 `try` 里**再调 `removeActionsOfCast(root, id)`：把 `actions.json` 的 `byCast[<id>]` 整块删掉（动作是跟着角色走的，角色没了就没人能演它，留着只会在 `actions.json` 里堆垃圾）。
- **清理失败不阻断删角色**（`removeActionsOfCast` 内部自己吞掉写盘异常）：删角色是用户明确动作，不能因为动作文件写不进去就整个失败。
- 公共动作（`shared`）**不动**——它们本来就不属于某个角色。

#### 4.4.7 边界与依赖

- **刻意不 import `electron`**：库根由调用方给，本文件可以离线读、离线测。
- 只碰库目录与调用方给的项目目录，**不碰 `project.json`**（那是 `projects/store.ts` 的事）。
- 对 `./actions` 的依赖是**单向**的（`library → actions`），`actions.ts` 不认识 `library.ts`，所以不会成环。

### 4.5 `preview.ts` —— 角色静态预览页（151 行）

#### 4.5.1 为什么需要它

角色不是图片，而是 `<id>.js` 里登记的绘制函数——不真的跑一遍，界面上就只有一个文件名可看（建完也判断不出 AI 到底画成了什么样）。所以预览 = **主进程把 `core.js` + 这份角色代码拼成一页自包含 HTML 落盘，渲染层用 iframe 载入、由浏览器真画一次**。

为什么是「一页自包含 HTML」而不是让页面 `<script src>` 引那份角色代码：角色库在 `<userData>/cast-library/`，与任何项目无关；而 `hgpreview://` 默认只放行**项目目录**。所以预览页单独落在 `<userData>/cast-preview/`，由那条路由的白名单放行（`?user=1`，与 tts 产物同一套，见 [main/index.ts.md](./index.ts.md) §4）。

#### 4.5.2 导出清单（2 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `previewRelPath(id)` | `(id) => 'cast-preview/<id>.html'` | **只收一个参数**，返回相对 **userData** 的路径（渲染层用 `utils/url.ts` 的 `userFileUrl` 拼成 `hgpreview://user/…?user=1`）。旧版是「相对项目、带来源前缀」（`<项目>/.cast-preview/<project\|lib>-<id>.html`，两个参数），那个形态已废弃 |
| `buildCastPreviewHtml(opts)` | `(opts: { id, code, core?, units?, title?, watercolor? }) => string` | 拼整页：`canvas#cv` + `#note` 提示条 + 三段内联脚本（`core.js` → 角色代码 → 调用一次）。`units` 1–30 非法落回 8，`title` 截 40 字符，内联脚本里的 `</script` 会被转义 |

模块内常量 `PREVIEW_DIR = 'cast-preview'`；落盘目录由 `projects/paths.ts` 的 `castPreviewDir()` 给（`<userData>/cast-preview`），**写文件在 `projects/ipc/cast.ts` 的 `cast:preview`**——本文件不读盘、不写盘。

#### 4.5.3 页内脚本行为

1. 按 `devicePixelRatio`（夹在 1–2）设画布像素尺寸，`ctx.setTransform(dpr,0,0,dpr,0,0)`。
2. `fn = window.__cast[ID]`；不是函数 → 提示「角色代码没有把绘制函数挂到 `window.__cast["<id>"]` 上」。
3. `u = H * 0.84 / UNITS`，调用 `fn(W/2, H - H*0.08, u, { ctx })`（上下各留 8%，让整身高进画面）。
4. 画完读像素判「空画」：空 → 提示（水彩角色给「这里画不出它的水彩笔触，生成后的页面里才看得到」，否则「可能依赖 p5 画布，或需要章节传参」）；有水彩且画出了东西 → 提示「水彩角色（p5）：这里只显示它的 Canvas 2D 部分」。
5. `boot(tries)`：iframe 刚插进 DOM 时可能还没布局（`clientWidth === 0`），等下一帧再试，最多 12 帧。

#### 4.5.4 已知边界

- **静态一帧**：角色本身是纯绘制函数，动画由章节的时间轴驱动；要看它动起来用同一目录下的 `demo.ts`（§4.8）。
- **水彩角色（p5 / p5.brush）只画得出传给 `o.ctx` 的 Canvas 2D 部分**（p5 的 WEBGL 画布这条路径没有），页内会明确提示。
- 一角色一文件（同 id 覆盖），并发预览多个角色互不覆盖。

### 4.6 `presets.ts` —— 内置动作（14 条，172 行）

#### 4.6.1 它是什么

**只有数据、没有逻辑**：一个 `PRESET_ACTIONS: CastActionDef[]`，14 条公共动作。存取 / 校验 / 拼页分别在 `actions.ts` 与 `demo.ts`。

一条动作 = 「时间 → 角色动画参数」的曲线：`keys` 里每个元素是 `{ t, o }`，`t` 是时间点（秒），`o` 是这个时刻的参数。**每条只写用得上的参数**——没写的由角色端取它自己的默认值（尤其 `mouth`：显式给 `normal` 会把「笑眼配平嘴」）。

#### 4.6.2 14 条动作

| id | 名字 | 时长 | 循环 | 在做什么 |
|---|---|---|---|---|
| `breathe` | 站立呼吸 | 4s | ✓ | 轻微上下 + 手臂微摆（最常用的「活着」） |
| `blink` | 眨眼 | 3.8s | ✓ | 只动 `blink`，其他参数一概不碰——用来验「这个角色听不听得懂 blink」 |
| `wave` | 挥手 | 1.8s | ✓ | 右臂抬到侧上方来回摆三次再放下（`aL` 不动） |
| `bothup` | 双手举起 | 1.6s | ✓ | 两只手一起抬 + 笑眼（`mouth` 不写，让角色自己按 `eyes` 定嘴型） |
| `walk` | 走路 | 2s | ✓ | `walk` 0→2（两整步）+ 前后摆臂 + 轻微起伏，回到 0 时相位接得上 |
| `run` | 跑步 | 0.9s | ✓ | 同样的相位但更快、摆臂更大 + 前倾（`rot`）+ 起伏更深 + 轻微拉长 |
| `jump` | 跳一下 | 1.2s | ✗ | 蹲下蓄力 → 腾空 → 落地缓冲 → 站直，**演一遍停住** |
| `sway` | 左右摇摆 | 2s | ✓ | 整身绕脚底转（`rot`）+ 平移（`dx`） |
| `crouch` | 蹲下 | 2s | ✓ | 压矮（`sq` 负）+ 下移 + 手臂外撑 |
| `happy` | 开心 | 1.6s | ✓ | 笑眼 + 轻轻弹跳 + 双手微抬 |
| `angry` | 生气 | 1.2s | ✓ | 怒眼 + 原地小幅左右抖 + 手臂内收 |
| `surprise` | 惊讶 | 1.4s | ✓ | 瞪眼（`surprise`）+ 上身一挺（`sq` 正、上移）+ 双手抬起 |
| `talk` | 说话 | 1.6s | ✓ | 只动嘴型（`happy` / `normal` 交替），身体不动 |
| `slump` | 垂头丧气 | 2.6s | ✓ | 难过脸 + 压矮 + 微微下移 + 手臂内收 |

#### 4.6.3 只读

内置动作**只读**：界面上改它 / 删它的入口不存在（列表里没有「改」「删」，只有「内置」徽标）。想改就「另存为副本」——编辑器会把 id 清空、名字加「副本」，落盘成一条用户动作（改预设会影响所有角色）。

### 4.7 `actions.ts` —— 动作库与两种动作（256 行）

#### 4.7.1 动作数据模型（`CastActionDef`，见 [shared/types.ts.md](../shared/types.ts.md)）

| 字段 | 含义 |
|---|---|
| `id` | 动作 id，可读 slug：`^[a-z][a-z0-9_]{0,31}$`（**它会写进示范页的动作表**，不允许出现路径分隔符 / 引号） |
| `name` | 动作名，≤12 字符（`CAST_ACTION_NAME_MAX`），空则回落成 id |
| `duration` | 时长（秒），夹到 **0.3–30** 并留两位小数（`CAST_ACTION_DURATION`）；循环动作是「一轮」的长度 |
| `loop` | 是否循环（`false` = 演一遍停在最后一帧） |
| `keys` | 关键帧表（`[{ t, o }]`），**至少 2 帧**才叫曲线（一个点只会得到一张静止的画）；落盘前按 `t` 升序排 |
| `code` | 代码动作：一段 `function (t) { return { … } }`（与 `keys` 二选一） |
| `from` | 来源：`preset` 内置 / `user` 用户自建 / `ai` 模型生成（只用于界面分组与文案） |

#### 4.7.2 两种动作

| | 关键帧动作 | 代码动作 |
|---|---|---|
| 数据 | `keys`（时间点 + 参数值） | `code`（纯函数） |
| 谁能用 | **所有角色通用**（只用通用参数） | **只有这个角色**（存在 `byCast[<角色id>]`，能用到角色自己的参数，如猫的尾巴 / 四只脚） |
| 谁写 | 「角色」页 · 动作示范弹窗 ·「新建动作…」→ 关键帧编辑器（不调模型） | 只有「AI 生成…」（弹窗右侧「本角色专属」那一组的「AI 生成…」面板） |
| 校验 | `normalizeActionDef`：id / 时长 / ≥2 帧 / 参数白名单 | `validateActionCode` 的静态白名单 |

**为什么动作不用改角色代码**：角色是纯绘制函数，动作只是「按时间算出那组参数」，所以让角色动起来不需要碰 `<id>.js`。**这一版动作只做示范、不进正片**——生成 HTML 时角色动画仍由章节按 `t` 自己算（用户已确认）。

#### 4.7.3 导出清单（9 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `normalizeActionDef(raw)` | `(raw) => CastActionDef \| null` | 把一条动作（来自界面 / 磁盘 / 模型）收敛成合法形状：id 过 slug 正则、时长夹到 0.3–30（非法 / 0 直接 null）、`name` 截 12、`loop` 缺省 true、`from` 只认 `preset` / `ai` / 其余算 `user`；有 `code` 时走 `validateActionCode` 且 `from` 不许留在 `preset`；否则 `keys` 逐个过 `normalizeKey`（`t` 截到 `[0, duration]`、数字夹到范围、枚举查白名单、`'auto'` 丢弃），**少于 2 帧返回 null** |
| `validateActionCode(code)` | `(code) => string \| null` | 静态白名单（返回字符串就是给用户看的人话原因）：非空、必须有 `function` 或箭头、必须有 `return`、禁 `window / document / globalThis / self / top / parent / require / process / eval / Function / fetch / XMLHttpRequest / localStorage / sessionStorage / importScripts / alert / __cast / setTimeout / setInterval / requestAnimationFrame`、禁 `for` / `while`、禁 `Math.random`、禁 HTML 标签、**≤60 行** |
| `parseCastActionReply(reply)` | `(reply) => string \| null` | 从模型回复里取动作脚本：先认 `<<<ACTION>>>…<<<END ACTION>>>`，再认 ```` ```js ```` 围栏，最后认以 `function` / `(` / `x =>` 开头的裸函数；都没有回 `null` |
| `readActions(root)` | `(root) => { shared; byCast }` | 读 `actions.json`；文件缺失 / 损坏都当空库（不抛），脏条目逐个丢掉；`shared` 里 `from === 'preset'` 的条目会被丢掉（内置动作不落盘） |
| `listActionsFor(root, castId)` | `(root, castId) => CastActionListResult` | 某个角色能演的全部动作：`shared = [...PRESET_ACTIONS, ...用户公共]`、`own = byCast[<角色id>]`（大小写 / 空白先规范化） |
| `nextActionId(taken)` | `(taken: string[]) => string` | 下一个可用 id：`act1` / `act2` …；**内置动作的 id 也要避开**（否则列表里会出现两条同 id） |
| `upsertAction(root, scope, castId, action)` | `(…) => { ok; message; action? }` | 新建 / 覆盖：`scope = 'shared'` 写公共库、`'own'` 写 `byCast[castId]`（缺 / 非法 castId 直接拒绝）；**同 id 就地替换**（保持列表顺序），不存在则追加；**同一作用范围超 40 条拒绝**（`CAST_ACTION_MAX_PER_SCOPE`）；写盘失败回 `{ ok: false, message }` |
| `removeAction(root, scope, castId, actionId)` | `(…) => { ok; message }` | 删一条动作（`scope = 'own'` 时要 castId）；删空 `byCast[<id>]` 时把那个键一起删掉 |
| `removeActionsOfCast(root, castId)` | `(root, castId) => void` | 删角色时清掉它的专属动作；本文件**在 `library.ts` 的 `removeFromLibrary` 里被调**，写盘异常自己吞掉（不阻断删角色） |

#### 4.7.4 存储

```
<userData>/cast-library/actions.json
{
  "shared": [ CastActionDef, … ],              # 用户自建的公共动作（内置 14 条不在这里）
  "byCast": { "<角色id>": [ CastActionDef, … ] }  # 每个角色的专属动作（AI 生成 / 勾了「只给这个角色」）
}
```

- 与角色库**同目录、同属用户资产**（可备份、可迁移）；内置动作在代码里只读，永远不写盘。
- `readActions` 对脏数据一律「丢掉那一条」，不整份失败；`writeActions` 先 `mkdirSync(root, { recursive: true })` 再整份写（2 空格缩进）。
- **删角色时它的专属动作一起清**（见 §4.4.6），公共动作不受影响。
- 本文件**刻意不 import `electron`、不 import `library.ts`**：库根由调用方给（`projects/ipc/castActions.ts` 传 `castLibraryRoot()`），可离线测。

#### 4.7.5 边界

- 只做数据层：**不调模型、不拼页面、不注册 IPC**。模型调用在 `projects/ipc/castActions.ts`（`cast:action-generate`），提示词在 `agent/castAction.ts` + `projects/prompts.ts`。
- 代码动作的真正执行发生在**示范页的 sandbox iframe** 里（`demo.ts` 拼的那一页），本文件的 `validateActionCode` 只是「先把明显越界的东西挡在外面、给用户一句人话」，不是隔离层。

### 4.8 `demo.ts` —— 动作示范页（263 行）

#### 4.8.1 为什么需要它

静态预览（§4.5）只会画一帧。示范页做的事**就是章节在正片里做的事**：按一条动作把参数算出来，逐帧调用角色函数重画——所以用户能在这里先看「这个角色动起来什么样」。

落在 `<userData>/cast-preview/<id>.demo.html`：与静态预览页**同目录、文件名不同**（`<id>.html` ↔ `<id>.demo.html`），互不覆盖；目录仍在 `hgpreview://` 的白名单里（`?user=1`，见 `main/index.ts` 的 `USER_PREVIEW_DIRS`），角色库在 userData 下、与任何项目无关，所以示范页不能放进项目目录。

#### 4.8.2 导出清单（2 个）

| 导出 | 签名 | 说明 |
|---|---|---|
| `demoRelPath(id)` | `(id) => 'cast-preview/<id>.demo.html'` | 相对 **userData** 的路径（渲染层 `CastDemoShot.vue` 用 `userFileUrl(rel)` 拼 URL） |
| `buildCastDemoHtml(opts)` | `(opts: { id, code, core?, units?, title?, watercolor?, actions }) => string` | 拼整页自包含 HTML：`canvas#cv` + 顶部工具条（动作名 / 时间 / 暂停 / 重播）+ `#note` + **三段内联脚本** |

`units` 1–30 非法落回 8，`title` 截 40 字符，`watercolor` 只决定页内提示文案。

#### 4.8.3 三段内联脚本（顺序不能反）

1. **`core.js` 原文**：角色里的 `MC.paint` / `MC.ellPts` 之类都靠它。
2. **角色代码原文**（`cast/<id>.js`）：它自己把绘制函数挂到 `window.__cast` 上。
3. **动作脚本 + 动作表 + 帧循环**：先 `var FNS = {};` 再对每条**代码动作**拼一行 `FNS["<id>"] = <那段源码>;`（源码不进 JSON）；然后 `var ACTS = [...]`（数据动作只留 `keys`，代码动作只留 `code: true` 标记），最后接帧循环脚本。

`</script` 在写入时一律转义成 `<\/script`——角色代码与动作脚本在落盘时已有硬校验，这里再保一道（内联脚本里出现 `</script` 会提前截断整段）。

#### 4.8.4 帧循环与参数插值

- **`requestAnimationFrame` 循环**：`dt` 上限 0.1 秒（切回后台再回来不会一下跳完）；`loop` 时 `elapsed %= duration`，否则演到 `duration` 停下并把按钮改成「继续」；只在「在播 / 尺寸变了 / 脏」时才重画，时间条每 100ms 刷一次。
- **按 URL 的 `#hash` 选动作**：页面监听 `hashchange` → `pick(actionId)`（换动作只改 hash，不重新加载文档）；首帧也按当前 hash 选。
- **参数插值**（`paramsAt`）：对**每个参数**各找「前后两个写了它的关键帧」——数字用 smoothstep（`f*f*(3-2f)`）在两点之间平滑，枚举到点才换。这样一条关键帧只写它关心的参数（比如只写 `aR` 不会把别的参数打回 0）。
- **代码动作**：`var got = FNS[<id>](elapsed)`，返回对象就用它（脚本报错在页内 `#note` 里显示原因）。
- **画布与基线**：`u = H * 0.72 / UNITS`、基线 `H - H * 0.11`（比静态预览留更多上方空间——跳跃动作的 `dy` 是负的、要往上走）；`o.ctx` 由页面塞进去。
- **工具条**：动作名 + `时间 / 时长 秒`（循环的加「· 循环」）+「暂停 / 继续」+「重播」；换动作的列表在应用那一侧（`CastActionModal.vue`），页内不重复。
- **提示**：没有动作时提示「先在「角色」页新建一个，或让 AI 给它生成一个专属动作」；水彩角色提示「只显示它的 Canvas 2D 部分」（与静态预览同一条限制）。

#### 4.8.5 边界

- **不改任何角色文件**：本文件只读角色代码原文。
- 纯字符串拼装：不读盘、不写盘（落盘在 `projects/ipc/castActions.ts` 的 `cast:demo`）。
- 真正跑代码的是 iframe 里的浏览器（`sandbox="allow-scripts allow-same-origin"`，与静态预览同一套），不是主进程。

## 5. 依赖方向与调用点

### 5.1 目录内

```
chapters ← table ← edit
presets ← actions ← library
presets ← actions ← （listActionsFor 被 demo 页的数据源用）
demo（只依赖 shared 的类型）
inject / preview（互不依赖）
index.ts = 37 个导出的扁平出口（只再导出）
```

### 5.2 外部

| 调用方 | 职责 |
|---|---|
| `main/index.ts` | `hgpreview` 的 `?user=1` 白名单里加 `cast-preview`（`USER_PREVIEW_DIRS = ['tts-output','voice','cast-preview']`），否则预览 / 示范 iframe 拿不到文件 |
| `projects/paths.ts` | `castLibraryRoot()` / `castPreviewDir()` 两个路径 |
| `projects/ipc/cast.ts` | 角色本身的 6 条 `cast:*` + `project:save-cast`；模型调用与落盘编排 |
| `projects/ipc/castActions.ts` | **动作示范的 5 条 `cast:*`**（`action-list` / `action-save` / `action-remove` / `action-generate` / `demo`）：装配、唯一那次模型调用、示范页落盘 |
| `projects/store.ts` | `project.json` 里裁成 `[{ id, selected }]`、读项目时按 id 从库补全（无迁移） |
| `projects/prompts.ts` | `buildCastPrompt`（新建）/ `buildCastEditPrompt`（改画法，带【当前角色源码】+【本次改动】）/ **`buildCastActionPrompt`**（动作脚本，带【角色源码】+【输出格式】） |
| `projects/htmlWrite.ts` | 两处 `syncProjectCast` + 单文件注入 + 勾选变化后重刷页面 |
| `projects/ipc/html.ts` | 生成时挑角色、改稿时发只读角色表、导出时内联角色 |
| `projects/chaptersFlow.ts` | 角色表只作上下文（`castOutlineText`），不解析、不收角色文件块 |
| `agent/castAction.ts` | 动作脚本的系统提示词与 `chatWithCastAction`（只被 `projects/ipc/castActions.ts` 调） |

## 6. 合并后的注意事项

1. **真源只有一个**：要角色改名字 / 改身高 / 改画法，去「角色」页（`updateMemberMeta` / `writeMemberCode`）；**不要**在任何项目目录里直接改 `cast/<id>.js`——下一次同步就被覆盖，界面也读不到你的改动。
2. **副本是产物**：清空项目 `cast/` 是安全的（`syncProjectCast` 会补回来），但别手工往里面塞库里没有的文件——它们不会被删（`syncProjectCast` 只删库里认得的 id），却也不会进提示词与界面。
3. **`withCore` 的分工**：单文件模式「没有勾选角色」时不注入 `core.js`；章节模式的骨架一律引 `./core.js`（章节可能用到 `MC.*`）。
4. **`parseCastTable` 是遗留退路**：生成流程一次都不调它；改它时注意别把校验规则（`normalizeCastList`）写松。
5. **改画法与改信息分家**：`cast:recreate` 只换代码、**不改元数据**；`cast:save-meta` 只改元数据、**不调模型**。想让「改画法」顺带改画风，是渲染层在成功后另发一次 `save-meta`（见 [CastPage.md](../renderer/src/pages/CastPage.md)）。
6. **`syncProjectCast` 的「不删库里没有的 id」不是疏漏**：它保证手工塞进项目的文件不会被应用悄悄删掉；要让某个角色进页面，仍然只能「库里先有它 + 本片勾上它」。
7. **动作与角色分开存**：别把动作数据塞进 `<id>.js`，也别指望动作会自动进正片——这一版动作只服务「动作示范」弹窗，生成 HTML 时的角色动画仍由章节按 `t` 自己算。
8. **内置动作只读**：`PRESET_ACTIONS` 是代码里的数据，改它等于改所有角色的公共动作列表；用户想定制请走「另存为副本」。
