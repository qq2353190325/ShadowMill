# src/renderer/src/pages/CastPage/（页面）

> 侧栏第 6 项「角色」= **全局角色库的管理页**（页面键 `cast`）。界面上就是一张**卡片墙**：每张卡上是这个角色真跑一遍绘制代码得到的样子，**双击卡片**（或卡片右上「…」→「动作示范…」）打开**动作示范弹窗**——看它动起来、给它编 / 改专属动作；「…」里还管**修改角色**（改名 / 描述 / 身高 / 笔刷 / 画风，或让它按你的要求重画）/ 复制 id / 删除，页面顶上是「新建角色」。
>
> **与项目无关**：没有当前项目也能用；「本片用哪几个角色」不在这里勾，在「HTML生成」页 ·「角色」区勾（见 [`HtmlGenPage.md`](./HtmlGenPage.md)）。

- **覆盖文件**：`CastPage/index.vue`（**180 行**）+ `CastPage/CastEditModal.vue`（**319 行**）+ **`CastPage/CastActionModal.vue`（375 行）** + **`CastPage/CastActionEditor.vue`（262 行）** + **`CastPage/CastDemoShot.vue`（85 行）**，**5 个文件 / 合计 1221 行**（行数实测 `[IO.File]::ReadAllLines`）
- **已删除**：`CastPage/CastMetaModal.vue`（「改信息」那个独立弹窗）——已并入 `CastEditModal.vue`，由它一个弹窗承担**新建 / 修改**两种模式
- **所在目录**：`src/renderer/src/pages/CastPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **对外导出**：`index.vue` 默认导出页面组件（无 props）；四个子组件默认导出，靠 props / emit 与页面通信
- **页面注册**：`pages/index.ts` 的 `pages` 注册表里 `cast: CastPage`（第 6 项，位于 `'html-gen'` 与 `'video-preview'` 之间）；侧栏菜单项见 `App.vue`（`{ key: 'cast', label: '角色', title: '角色（全局角色库：新建 / 修改，与项目无关）' }`）
- **惰性**：`PageKey` 里加了 `'cast'`（见 [`common.md`](../common.md) §`useAppStore`），`goPage('cast')` 时照例 `refreshProject()` → 换组件 → `pageNavKey++`

## 1. 界面位置与职责

界面从上到下只有三块：

| 位置 | 内容 | 说明 |
|------|------|------|
| 「角色」页 · 顶行 | 标题「角色」+ 灰字「N 个 · 全局共用，与项目无关」+ 右侧**「新建角色」**按钮 | 按钮 `:disabled="busy"`、`title` 写「调一次模型画一个新角色，存进全局角色库」；标题里的 N 是 `members.length` |
| 「角色」页 · 卡片墙 | `.cast-grid.page` 里一卡一角色：预览（`CastShot`）+ 名字 + `<units>u` + 右上「…」；**双击卡片 = 看动作示范** | 库为空时换一行 `.hgen-tip`：「还没有角色。点右上「新建角色」让 AI 画一个……」 |
| 「角色」页 · 页脚说明 | `.hgen-tip`：卡片上就是**真跑一遍绘制代码**得到的静态一帧；**双击卡片**（或「…」→「动作示范…」）可以看它动起来；一个角色 = 一份共享绘制代码（`cast/<id>.js`） | 文案与「HTML生成」页的角色区口径一致；末句写明「在这里新建 / 修改 / 删除都只动**全局角色库**」 |

职责边界：**只管库里的角色本身**（新建 / 修改 / 看动作 / 复制 id / 删除），**不碰项目**——不写 `project.json`、不勾选「本片用哪些」、不触发 HTML 生成。反过来，「HTML生成」页只勾选、改不了角色的长相。

### 1.1 双击卡片：看动作示范

- 卡片上是 `@dblclick.stop="openActions(m)"`，`title` 提示「双击看它的动作示范（名字：…）」；`.cast-card.static` 的 `cursor` 是 **`pointer`**（可点的暗示）。
- **同一个入口在菜单里**：右上「…」菜单第一项就是「动作示范…」（`act(m, 'actions')`）——双击不好发现时用它。
- **「…」按钮与菜单自己屏蔽双击**（`@dblclick.stop`）：在它们上面双击只做它们自己的事，不会顺带打开动作示范。
- 打开后 `active = m`、`actionsOpen = true`，挂 `CastActionModal`。
- `m.missing` 的角色：双击直接 `return`、菜单项「动作示范…」也 `:disabled`（没有代码可演）。

### 1.2 卡片右上「…」菜单的四个动作

| 菜单项 | 动作 | 实现 |
|--------|------|------|
| **动作示范…** | 打开动作示范弹窗：左边会动的大图，右边公共动作 / 专属动作两组列表 +「AI 生成…」面板；底部还能转去「修改角色…」 | `act(m,'actions')` → `CastActionModal`；`m.missing` 时禁用 |
| **修改角色…** | 一个弹窗两件事：改库里的信息（名字 / 描述 / 身高 / 笔刷 / 画风，**不调模型**），或者填一句「这次要怎么改」让它**按这个要求重画**（调一次模型） | `act(m,'edit')` → `editMode='edit'` → `CastEditModal`（`mode='edit'`）；`m.missing` 时禁用（没有代码可改） |
| 复制 id | 把 `cast/<id>.js` 复制到剪贴板（id 就是页面里 `window.__cast` 的键） | `window.appTools.copyText('cast/' + m.id + '.js')` → toast |
| 删除 | 从**全局角色库**删除（**连带清掉它的专属动作**；用到它的项目下次生成时会把副本收走） | `window.confirm(...)` → `castTools.remove(m.id)` → 重新 `load()` |

> **「改画法… / 改信息…」这两项已经并成「修改角色…」一项**：改信息不再有独立弹窗，重画也不再是菜单里的单独一项——两者都在「修改角色」弹窗里（见 §2.4）。

菜单本身的行为（都在 `index.vue` 里，不引第三方库）：

- **一次只开一个**：`menuFor = ref('')`，`toggleMenu(id)` 点同一个 id 是收起、点别的 id 是切换。
- **点菜单外面收起**：`watch(menuFor)` 里挂 / 摘一个 `document` 的 `click` 监听；`onBeforeUnmount` 里再摘一次。菜单根节点 `@click.stop`。
- **删除用 `window.confirm`**：确认文案带角色名 / id，并说明「删了就没了」。
- 卡片容器是 `.cast-card.static`，`overflow: visible` 让菜单能弹到卡片外（见 [`assets.md`](../assets.md) §角色）。

### 1.3 卡片墙的数据与「重载预览」机制

```ts
const members = ref<CastLibraryMember[]>([])
const busy = ref(false)
// 每个角色各自的预览版本号：它被重画 / 改身高之后，那个 iframe 必须换地址重新载入
const epochs = reactive<Record<string, number>>({})
```

- **取数只有一条**：`window.castTools.list()` → `cast:list`（**纯读**：主进程 `readLibrary` + 按 id 检查 `<id>.js` 在不在 → 条目带 `missing`）。
- **`epochs` 是按 id 的预览版本号**：`CastShot` 把 `epoch` 拼进 iframe 地址（`&e=<epoch>`），文件被覆盖后地址一变就会重载。页面只在弹窗回报「改过了」时 +1（`onChanged()`）。
- `m.missing` 的卡片：整卡压暗（`.off`）+「文件缺失」徽标，`CastShot` 仍会尝试预览（失败时自己显示「无法预览」）。

## 2. 五个组件的契约

| 组件 | props | emits | 干什么 |
|------|-------|-------|--------|
| `index.vue`（页面） | — | — | 列库、卡片墙、双击 /「…」菜单、二次确认删除、开两个弹窗（动作示范 / 新建与修改）、按 id 递增 `epochs` |
| `CastEditModal.vue` | `open`、`mode: 'create' \| 'edit'`、`member?: CastLibraryMember \| null` | `close`、`changed(m)` | **一个弹窗两种模式**：新建（`cast:create`）/ 修改（`cast:save-meta`，要重画时先存再 `cast:recreate`） |
| **`CastActionModal.vue`** | **`open: boolean`、`member?: CastLibraryMember \| null`** | **`close`、`edit(m)`** | **动作示范**：演动作、管两组动作列表、AI 生成 / 改 AI 动作、新建 / 改关键帧动作；底部「修改角色…」emit 给父页 |
| **`CastActionEditor.vue`** | **`open`、`castId: string`、`action?: CastActionDef \| null`、`scope: CastActionScope`** | **`close`、`saved(action, scope)`** | **关键帧表编辑器**（只改数据、不调模型），保存走 `castTools.saveAction` |
| **`CastDemoShot.vue`** | **`id`、`units`、`title?`、`uses?`、`actionId?`、`epoch?`** | — | 动作示范的 iframe：取示范页地址、按 `actionId` 换 `#hash`、`epoch` 变了才重载 |

### 2.1 `CastActionModal`：动作示范弹窗

> **界面上在哪**：「角色」页 · 卡片双击 / 右上「…」菜单 ·「动作示范…」。弹窗宽 `min(1000px, 96vw)`，`.hf-modal` 体系（点遮罩 / `×` 关闭）。

| 区域 | 内容 | 行为 |
|------|------|------|
| 头部 | 「动作示范：<角色名>」+ `×` | — |
| **左栏**（`.cast-act-left`，300px） | `CastDemoShot`（300×380 动画 iframe）+ 当前动作名 + 「时长 · 循环/演一遍 · AI 生成」元信息 + 一行说明 | 说明写死「动作只驱动角色代码里认得的动画参数；老角色没实现的那一项就不会动——那不是坏了」 |
| **右栏上：公共动作**（`.cast-act-right` 第一组） | 标题「公共动作 · N 条 · 所有角色都能演」+ 右侧**「新建动作…」**；列表一行一条：名字 +「内置」徽标（内置 14 条）/「改」「删」 | 点一行 = 演这一条；「改」「删」只对自建动作出现（内置只读）；删前 `window.confirm` |
| **右栏中：AI 面板**（`.cast-act-ai`，折叠） | 一句话输入（textarea）+ 时长（number，0.3–30，step 0.1）+「循环」勾选 + 主按钮；进度行 / 错误行 | 新建时按钮是「生成」；**改一条 AI 动作时**面板顶部多一行「正在改这条动作：<名字>——带上它现在的脚本再问一次模型，改完*覆盖同一条*」，输入框占位与按钮都换成改的口径（按钮「按这个要求改」）；错误下方给出日志位置 `userData/html-agent/cast-action.jsonl` |
| **右栏下：本角色专属**（第二组） | 标题「本角色专属 · N 条 · 只有它能用」+「AI 生成…」按钮（面板开着时变「收起」）；列表带「AI」/「自建」徽标 + **「改」「删」** | **每条专属动作都有「改」**（原来只有「删」）：AI 动作回 AI 面板改、关键帧动作进关键帧表；空列表时提示「公共动作调不动的部位（猫的尾巴、四只脚）用 AI 生成…」 |
| 底部 | 「修改角色…」（没有 member 时 disabled，`title` 写「改名字 / 描述 / 画风 / 身高，或者让它按你的要求重画」）+「关闭」 | 「修改角色…」emit `edit(member)`，父页 `onEditCast()` **先收起本弹窗再开「修改角色」弹窗**（不叠两层弹窗） |

- **列表来源**：打开弹窗调 `castTools.listActions(castId)` → `cast:action-list`，返回 `{ shared, own }`；`shared` 的第一条自动选中；当前动作被删后回落到第一条可用动作。
- **专属动作的「改」分两条路**（`onEditOwn(a)`）：`a.code` 有值（AI 生成的动作，存的是脚本）→ 进 AI 面板的**编辑态**（`aiEdit = a`，时长 / 循环预填这条的现值，请求清空）；否则（关键帧动作）→ 打开关键帧表编辑器，`scope` 为 `own`（`openEditor` 按「这条在不在 `own` 里」判作用范围）。
- **AI 编辑态提交时带 `actionId`**：`generateAction({ castId, taskId, request, actionId: editing.id, name: editing.name, duration, loop })`，主进程覆盖同一条（名字 / 来源沿用，脚本与时长 / 循环按本次入参）；新建时才用 `request` 的前 8 个字当名字。
- **编辑态的清理**：收起面板（`toggleAi`）或换角色 / 重开弹窗（`watch` 里重置）都会把 `aiEdit` 清空，下次点「AI 生成…」就是新建一条；改成功后也会清空并收起面板。
- **「AI 生成…」一保存就重拼示范页**：`demoEpoch++`（示范页里嵌的是**当时的**动作表），并选中这条动作。
- **动作只做示范、不进正片**：这一版不改角色代码、也不把动作写进项目；生成 HTML 时角色动画仍由章节按 `t` 自己算。

### 2.2 `CastActionEditor`：关键帧表编辑器

> **界面上在哪**：动作示范弹窗 ·「新建动作…」（或自建公共动作 / 关键帧专属动作那一行的「改」）。弹窗宽 `min(1080px, 96vw)`。

| 字段 / 控件 | 说明 |
|------|------|
| 名称 | `maxlength = CAST_ACTION_NAME_MAX`（12），占位「如：挥手」 |
| 时长 | number，`min = 0.3` / `max = 30`、step 0.1（`CAST_ACTION_DURATION`） |
| 循环播放 | checkbox（`loop`） |
| **只给这个角色** | **只在「新建」且当前 scope 不是 `own` 时出现**：勾上 = 存进 `byCast[<角色id>]`（专属），不勾 = 存成公共动作。**编辑已有动作时不显示**——改到另一个范围会留下一条重复 |
| **关键帧表**（`.cast-act-table`） | 一行一个时间点、一列一个参数，列来自 `CAST_ACTION_PARAMS`（**13 项**）：数字参数是 number 输入（带 `min` / `max` / `step`），`eyes` / `mouth` 是下拉；**`mouth` 有「自动」= 不传这个参数**（让角色按 `eyes` 定嘴型）。比旧版多了「**朝向 face**」「**髋角 hip**」「**抱团 tuck**」三列（face 0–1、步长 0.1；hip −2~2、步长 0.05，正 = 大腿向前抬、只在侧面视图生效；tuck 0–1、步长 0.1，≥0.5 画成半径约 1.25u 的球）。**加列不用改 CSS**：表格用 `grid-auto-columns` 均分列宽 + 外层 `overflow-x: auto`。**库里只有 `cast1.js` 实现了 hip 与 tuck**，cast2 / cast3 填了不生效 |
| **转身提示**（`.hgen-tip`，表格下方一行小字） | 「转身：把 face 从 0 推到 1（0.5 处从正面切到侧面），切换那几帧把 sq 压到 0.4~0.6 遮住硬切；转完 sq 回 0、用 walk 摆腿；往左走靠 flip（侧面固定朝右）。角色代码没读 face 的话它就一直正面。」——只讲怎么写，不做校验 |
| 行操作 | 行尾「×」删这一帧（**至少留两帧**，`disabled`）；「添加关键帧」在最后两帧之间插一个新时间点；「另存为副本」把 id 清空、名字加「副本」（**改内置动作用它**——内置只读，不能直接改） |
| 底部 | 「取消」/「保存」（名称非空、≥2 帧、时长 > 0 才可保存） |

- **打开时的灌入**：新建给两帧（`0` 与 `duration`）；编辑已有动作把 `keys` 摊到表里（内置动作打开就是「另存为新动作」：id 置空、名字加「 副本」）。数字参数新建行时预填 `def`（缺省 0，`face` 同样预填 0 = 正面），`eyes` 默认 `normal`，**`mouth` 故意不填**。
- **保存**：`castTools.saveAction({ castId, scope, action })` → `cast:action-save` → `upsertAction`（同 id 覆盖；`id` 为空由主进程起 `actN`）；成功后 `emit('saved', action, scope)`，父页重读列表、选中它并 `demoEpoch++`。
- **参数清单不在这里另写一份**：`CAST_ACTION_PARAMS` 同时供界面（本表）与主进程落盘校验用（见 [shared/constants.ts.md](../../../shared/constants.ts.md) §2.5）。

### 2.3 `CastDemoShot`：会动的 iframe

```ts
let res: Awaited<ReturnType<typeof window.castTools.demo>> | null = null
try {
  res = await window.castTools.demo(props.id, {
    units: props.units, title: props.title,
    uses: Array.isArray(props.uses) ? toRaw(props.uses).slice() : []
  })
} catch (e) {
  res = null          // 同步抛（结构化克隆失败）与异步拒绝都收在这里
}
base = userFileUrl(res.rel) + '&e=' + (props.epoch || 0)
src.value = base + hashOf(props.actionId)   // hashOf: '#' + encodeURIComponent(actionId)
```

- **地址协议**：示范页落在 `<userData>/cast-preview/<id>.demo.html`，用 `hgpreview://…?user=1` 载入；`userFileUrl` 已带 `?user=1`，**续接必须用 `&`**（写成 `?e=` 会 404）。
- **交给 IPC 的 `uses` 必须是普通数组**（`Array.isArray(props.uses) ? toRaw(props.uses).slice() : []`，与静态预览 `CastShot.vue` 同一个坑）：`props.uses` 常常是库成员的**响应式数组**（Vue 的 Proxy），而 `invoke` 的参数要过结构化克隆、**代理不可克隆** ⇒ 同步抛 `DataCloneError`，`load()` 在 `await` 处中断、界面永远停在「…」。只有 `uses` 非空的水彩角色（p5 / p5.brush）会踩到；现在整段包了 `try/catch`，失败显示「无法示范」而不是静默卡住。
- **换动作只改 hash**：`watch(() => props.actionId, …)` 只重设 `src = base + '#' + id`——同文档导航，iframe **不重新加载**，页面自己听 `hashchange` 换动作。
- **epoch 变了才重设整段地址**：`watch(() => [props.id, props.units, props.epoch], load, { immediate: true })`；角色重画 / 动作增删后父页 `demoEpoch++`，示范页重新拼（里面嵌的是当时的动作表）。
- **并发保护**：模块内 `seq`，同一组件先后发起的两次请求只让最后一次落地；失败时显示「无法示范」。
- iframe 的 `sandbox="allow-scripts allow-same-origin"`（与静态预览 `CastShot` 同一套）。

### 2.4 `CastEditModal`：一个弹窗，两种模式

> **界面上在哪**：「角色」页 · 顶行「新建角色」（`mode='create'`）/ 卡片「…」·「修改角色…」（`mode='edit'`）。弹窗宽 `min(620px, 92vw)`。

**新建（`mode='create'`）**：从设定画一个新的角色。

| 区域 | 内容 |
|------|------|
| 表单 | 角色名（占位「如：主角 / 研究员 / 猫（英文名会当 id）」）/ 外形描述 / 身高（1–30、step 0.5）/ 笔刷（「用水彩笔刷（p5.brush；不勾则用 Canvas 2D 平涂）」）/ **画风（可选）**——画风随创建请求一起发给模型 |
| 底部按钮 | 「取消」/「画这个角色」（`canSubmit` = 名字或描述非空） |
| 进度 | `newTaskId('cast')` + `castTools.onTaskProgress(taskId, …)`；进度与失败原因就显示在弹窗里 |

**修改（`mode='edit'`）**：改库里的信息，想换长相时再让它重画。

| 区域 | 内容 |
|------|------|
| 顶部大图 | `CastShot`（`big`，`units` 跟表单实时联动、`uses` 跟笔刷联动）——先看现在的样子；下面一行写明「改名字 / 描述 / 身高 / 笔刷只动库里的信息、不动绘制代码；要换长相，用下面的「这次要怎么改」」 |
| 表单 | 角色名（占位「界面上显示的名字」）/ 外形描述 / 身高（「u（只影响默认画多大，不重画代码）」）/ 笔刷——这四项与新建共用同一份 `draft` |
| **重画（可选，会调一次模型）** 区 | 说明一行「想把长相换掉时填下面两项：填了「这次要怎么改」才重画」+ **画风**（标题「画风（重画时按它画，也会记进角色库）」）+ **这次要怎么改**（textarea，占位示例「补一套侧面视图（读 o.face：0 正面 / 1 侧面，正面保持不变）；或：头发改成短卷发，其余不变」） |
| 底部按钮 | 「取消」/ **「保存」**（`metaBusy`，`title` 写「只保存名字 / 描述 / 画风 / 身高 / 笔刷，不调模型」）/ **「按这个要求重画」**（`title` 写「先保存上面这些信息（含画风），再让模型按「这次要怎么改」重画一遍」） |

**两个按钮各走哪条路（这是这一版改动的重点）**：

```ts
// 保存：只调 cast:save-meta
const res = await window.castTools.saveMeta(metaPayload()).catch(() => null)
// 重画：① 先 saveMeta 把整份表单（含画风）写进库 ② 再按「这次要怎么改」调 cast:recreate
const meta = await window.castTools.saveMeta(metaPayload()).catch(() => null)
const res = await window.castTools.recreate(String(meta.member.id), draft.request.trim(), taskId).catch(() => null)
```

- **「保存」不调模型**：只走 `cast:save-meta`（名字 / 描述 / 画风 / 身高 / 是否水彩），成功后弹 toast「已保存：<名字>」、`emit('changed')` 并关弹窗。
- **「重画」先存后画**：`cast:recreate` 读的是**库里的**元数据（`buildCastEditPrompt` 用 `member.style`），所以先把整份表单落库、再调模型——这样「这次填的画风这次就生效」，也保证 **id / 身高不变**（项目里引用它的章节不会认不出人）。第一步失败就不进模型，报错写「先把角色信息写进库时失败，重画没有开始」。
- **成功了留在弹窗里看大图**（`done` 态）：显示 `CastShot` 大图 + 名字 / 描述 / 画风 / 高 `u` / id，并说明「所有用到它的项目，下次生成 / 改稿时自动用新的画法」；底部换成「完成」（新建模式还多一个「再画一个」= 回到空白表单）。
- **`canRedraw` 要求名字与「这次要怎么改」都非空**；`canSave` 只要求名字非空。
- **每次打开都重置**：`watch([open, mode, member.id])` 里把 `done` / 错误 / 进度 / `draft` 全清一遍——新建从空白开始，修改则带上这个角色当前的名字 / 描述 / 画风 / 身高 / 水彩标记。
- **失败原因常驻在弹窗里**（不只是 toast），并指向完整调用记录：`userData/html-agent/cast.jsonl`。

## 3. 数据流（谁写谁读）

```
用户动作                          渲染层                        主进程                           磁盘
新建角色      → castTools.create       → cast:create         → 调模型画代码 → cast-library/<id>.js + index.json
修改·保存信息  → castTools.saveMeta    → cast:save-meta      → 不调模型     → cast-library/index.json
修改·重画     → saveMeta → recreate    → cast:save-meta → cast:recreate → 调模型重画 → 覆盖 cast-library/<id>.js
删除          → castTools.remove       → cast:remove         → 删库那份    → 删 <id>.js + 索引条目（+ 专属动作）
卡片预览      → CastShot               → cast:preview        → 拼自包含页  → <userData>/cast-preview/<id>.html
双击看动作    → CastDemoShot           → cast:demo           → 拼示范页    → <userData>/cast-preview/<id>.demo.html
列动作        → CastActionModal        → cast:action-list    → 读 actions.json → 内置 14 条 + 公共 + 专属
存动作        → CastActionEditor       → cast:action-save    → 规范化落盘  → cast-library/actions.json
删动作        → CastActionModal        → cast:action-remove  → 删一条      → cast-library/actions.json
AI 生成/改动作 → CastActionModal        → cast:action-generate→ 调一次模型  → cast-library/actions.json（专属，带 actionId 则覆盖同一条）
```

- **角色的唯一真源是全局库**：`<userData>/cast-library/index.json`（元数据）+ `<id>.js`（`window.__cast["id"] = function (x, y, u, o) {…}`）+ **`actions.json`**（公共动作 + 每角色专属动作）。
- 本页**完全不碰项目**：`<项目>/cast/` 是产物副本，由主进程在写盘前（`syncProjectCast`）从库里复制，触发点是「HTML生成」页的勾选 / 生成 / 改稿，不是这一页。
- 预览页与示范页都落在 `<userData>/cast-preview/`（同一目录、文件名不同：`<id>.html` / `<id>.demo.html`），由 `hgpreview://…?user=1` 载入 iframe。

## 4. 与「HTML生成」页的分工

| | 「角色」页（本页） | 「HTML生成」页 ·「角色」区 |
|---|---|---|
| 管什么 | **库里的角色本身**：新建 / 修改 / 看动作 / 删除 | **本片用哪几个**：只勾选 |
| 数据 | `castTools.list()`（`cast:list`） | `castTools.list()`（列库）+ `appState.project.cast`（哪些被勾上） |
| 写入 | `cast:create` / `cast:save-meta` / `cast:recreate` / `cast:remove` / **`cast:action-*` 四条** | `projectTools.saveCast(currentName, [{id}...])` → `project:save-cast` |
| 依赖当前项目 | **不依赖**（没有当前项目也能建 / 改 / 删 / 预览 / 编动作） | 依赖（写的是 `project.json` 与本片副本） |

分工的箭头只有一条：**「HTML生成」页的「管理角色」按钮 → `goPage('cast')`**。反向没有入口——「角色」页不提供「加到某个项目」这类动作。

## 5. CSS 类（动作示范那一套，都在 `assets/main.css`）

| 类 | 用在哪 |
|---|---|
| `.cast-card.static` | 卡片容器：`cursor: pointer`（双击可看动作）、`overflow: visible`（菜单能弹出） |
| `.cast-demo-shot` / `.cast-demo-frame` | 会动的大图容器（300×380、圆角 10px、底色 `#EEF2F7` 与静态预览一致）与其中的 iframe |
| `.cast-act` / `.cast-act-left` / `.cast-act-right` | 弹窗正文的两栏（左 300px 定宽、右自适应） |
| `.cast-act-now` / `.cast-act-now-name` | 大图下方「当前动作名 + 时长 / 循环」那一行 |
| `.cast-act-list` / `.cast-act-item` / `.cast-act-tag` / `.cast-act-item-meta` / `.cast-act-item-acts` / `.cast-act-link` | 两组动作列表：一行一条、选中左 3px 主色 + 渐变高亮、11px 徽标、「改 / 删」小链接 |
| `.cast-act-ai` | AI 面板（主色描边的小卡片；新建与「改一条 AI 动作」共用） |
| `.cast-act-table` / `.cast-act-tr` / `.cast-act-th` / `.cast-act-cell` / `.cast-act-del` | 关键帧表（`grid-auto-columns` 统一列宽，参数表加减项时不用改 CSS） |
| `.cast-done` / `.cast-done-info` / `.cast-done-meta` | 弹窗里的两栏大图区：修改模式的「现在长什么样」与两个模式的「画完的结果」 |

## 6. 依赖

| 依赖 | 用途 |
|------|------|
| `window.castTools`（preload） | `list` / `create` / `recreate` / `saveMeta` / `remove` / `preview` / **`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`** / `onTaskProgress` |
| `@renderer/components/CastShot.vue` | 角色**静态**预览（卡片墙 + 「修改角色」弹窗里的大图，两种模式都用） |
| **`CastDemoShot.vue`** | 角色**会动**的预览（动作示范弹窗左栏） |
| `@renderer/composables/useToast` | 复制 / 删除 / 保存 / 生成的轻提示 |
| `@renderer/utils/taskId` 的 `newTaskId('cast')` / `newTaskId('act')` | 画角色 / 编动作各自的任务 id（进度按它分发，互不干扰） |
| `@renderer/utils/url` 的 `userFileUrl` | 把 `rel` 拼成 `hgpreview://…?user=1`（`CastDemoShot` 用） |
| `@shared/types` | `CastLibraryMember` / `CastResult` / **`CastActionDef` / `CastActionScope` / `HtmlProgressPayload`** |
| `@shared/constants` | **`CAST_ACTION_DURATION` / `CAST_ACTION_NAME_MAX` / `CAST_ACTION_PARAMS`**（编辑器） |

**注意事项**：

1. **本页没有任何「保存到项目」的动作**：看到本页的按钮就只会动全局库；想影响某部片子，去「HTML生成」页勾它。
2. **`missing` 的角色只能「复制 id / 删除」**：卡片「…」里的「动作示范…」与「修改角色…」都 `:disabled`（没有代码可演、也没代码可改），双击也不会有结果。
3. **进度订阅必须「先订阅、再调用」**：`onTaskProgress` 返回退订函数，`onCreate` / `onRedraw` / `onGenerate` 在 `await` 之后第一件事就是 `off()`。
4. **删除是硬删**：`cast:remove` 删掉库里的 `<id>.js`、索引条目与它的专属动作；项目里已同步的副本由**下一次** `syncProjectCast` 收走——所以「删完立刻看某个项目」时页面里可能还留着一份旧副本，这是设计内的时序。
5. **卡片双击与「…」菜单不打架**：「…」按钮与菜单自身都 `.stop` 了 `dblclick`；卡片上的 `title` 与页脚文案都写明「双击看动作示范」。
6. **动作与角色分开存**：动作数据在 `actions.json`，不进 `<id>.js`；示范页是临时产物（`cast-preview/`），也不进项目。
7. **「保存」与「重画」不要混着理解**：保存只写元数据（不调模型），重画才调模型；重画前那一次自动保存是为了让「这次填的画风这次生效」。主进程侧 `cast:recreate` 仍然**只换代码、不碰元数据**（见 [cast.md](../../../main/cast.md) §6）。
