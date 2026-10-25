# src/renderer/src/pages/CastPage/（页面）

> 侧栏第 6 项「角色」= **全局角色库的管理页**（页面键 `cast`）。界面上就是一张**卡片墙**：每张卡上是这个角色真跑一遍绘制代码得到的样子，**双击卡片**（或右上「…」菜单·第一项「动作示范…」）打开**动作示范弹窗**——看它动起来；「…」里还管改画法 / 改信息 / 复制 id / 删除，页面顶上是「新建角色」。
>
> **与项目无关**：没有当前项目也能用；「本片用哪几个角色」不在这里勾，在「HTML生成」页 ·「角色」区勾（见 [`HtmlGenPage.md`](./HtmlGenPage.md)）。

- **覆盖文件**：`CastPage/index.vue`（**190 行**）+ `CastPage/CastEditModal.vue`（228 行）+ `CastPage/CastMetaModal.vue`（115 行）+ **`CastPage/CastActionModal.vue`（326 行）** + **`CastPage/CastActionEditor.vue`（256 行）** + **`CastPage/CastDemoShot.vue`（78 行）**，**6 个文件 / 合计 1193 行**（行数实测 `[IO.File]::ReadAllLines`）
- **所在目录**：`src/renderer/src/pages/CastPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **对外导出**：`index.vue` 默认导出页面组件（无 props）；五个弹窗 / 子组件默认导出，靠 props / emit 与页面通信
- **页面注册**：`pages/index.ts` 的 `pages` 注册表里 `cast: CastPage`（第 6 项，位于 `'html-gen'` 与 `'video-preview'` 之间）；侧栏菜单项见 `App.vue`（`{ key: 'cast', label: '角色', title: '角色（全局角色库：新建 / 改画法，与项目无关）' }`）
- **惰性**：`PageKey` 里加了 `'cast'`（见 [`common.md`](../common.md) §`useAppStore`），`goPage('cast')` 时照例 `refreshProject()` → 换组件 → `pageNavKey++`

## 1. 界面位置与职责

界面从上到下只有三块：

| 位置 | 内容 | 说明 |
|------|------|------|
| 「角色」页 · 顶行 | 标题「角色」+ 灰字「N 个 · 全局共用，与项目无关」+ 右侧**「新建角色」**按钮 | 按钮 `:disabled="busy"`；标题里的 N 是 `members.length` |
| 「角色」页 · 卡片墙 | `.cast-grid.page` 里一卡一角色：预览（`CastShot`）+ 名字 + `<units>u` + 右上「…」；**双击卡片 = 看动作示范** | 库为空时换一行 `.hgen-tip`：「还没有角色。点右上「新建角色」让 AI 画一个……」 |
| 「角色」页 · 页脚说明 | `.hgen-tip`：卡片上就是**真跑一遍绘制代码**得到的静态一帧；**双击卡片**（或「…」→「动作示范…」）可以看它动起来；一个角色 = 一份共享绘制代码（`cast/<id>.js`） | 文案与「HTML生成」页的角色区口径一致 |

职责边界：**只管库里的角色本身**（新建 / 看动作 / 改画法 / 改信息 / 复制 id / 删除），**不碰项目**——不写 `project.json`、不勾选「本片用哪些」、不触发 HTML 生成。反过来，「HTML生成」页只勾选、改不了角色的长相。

### 1.1 双击卡片：看动作示范（本轮新增）

- 卡片上是 `@dblclick.stop="openActions(m)"`，`title` 提示「双击看它的动作示范（名字：…）」；`.cast-card.static` 的 `cursor` 也从 `default` 改成了 **`pointer`**（可点的暗示）。
- **同一个入口在菜单里**：右上「…」菜单第一项就是「动作示范…」（`act(m, 'actions')`）——双击不好发现时用它。
- **「…」按钮与菜单自己屏蔽双击**（`@dblclick.stop`）：在它们上面双击只做它们自己的事，不会顺带打开动作示范。
- 打开后 `active = m`、`actionsOpen = true`，挂 `CastActionModal`。
- `m.missing` 的角色：菜单项 `:disabled`（没有代码可演），双击也不会有结果（`CastDemoShot` 会显示「无法示范」）。

### 1.2 卡片右上「…」菜单的五个动作（第一项是本轮新增）

| 菜单项 | 动作 | 实现 |
|--------|------|------|
| **动作示范…** | 打开动作示范弹窗：左边会动的大图，右边公共动作 / 专属动作两组列表 +「AI 生成…」 | `act(m,'actions')` → `CastActionModal`；`m.missing` 时禁用 |
| 改画法… | 调一次模型，在这个角色**现有代码**上按用户要求重画，覆盖库里那份 | `CastEditModal`（`mode='recreate'`）→ `castTools.recreate(id, request, taskId)`；`m.missing` 时禁用 |
| 改信息… | 改名字 / 描述 / 画风 / 身高 / 是否水彩，**不调模型** | `CastMetaModal` → `castTools.saveMeta(...)` |
| 复制 id | 把 `cast/<id>.js` 复制到剪贴板（id 就是页面里 `window.__cast` 的键） | `window.appTools.copyText('cast/' + m.id + '.js')` |
| 删除 | 从**全局角色库**删除（**连带清掉它的专属动作**；用到它的项目下次生成时会把副本收走） | `window.confirm(...)` → `castTools.remove(m.id)` → 重新 `load()` |

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

## 2. 六个组件的契约

| 组件 | props | emits | 干什么 |
|------|-------|-------|--------|
| `index.vue`（页面） | — | — | 列库、卡片墙、双击 /「…」菜单、二次确认删除、开三个弹窗、按 id 递增 `epochs` |
| `CastEditModal.vue` | `open`、`mode: 'create' \| 'recreate'`、`member?` | `close`、`changed(m)` | 新建角色（`cast:create`）与改画法（`cast:recreate`）共用一个弹窗 |
| `CastMetaModal.vue` | `open`、`member?` | `close`、`changed(m)` | 改信息（`cast:save-meta`），**不调模型** |
| **`CastActionModal.vue`** | **`open: boolean`、`member?: CastLibraryMember \| null`** | **`close`、`recreate(m)`** | **动作示范**：演动作、管两组动作列表、AI 生成、新建 / 改关键帧；底部「改画法…」emit 给父页 |
| **`CastActionEditor.vue`** | **`open`、`castId: string`、`action?: CastActionDef \| null`、`scope: CastActionScope`** | **`close`、`saved(action, scope)`** | **关键帧表编辑器**（只改数据、不调模型），保存走 `castTools.saveAction` |
| **`CastDemoShot.vue`** | **`id`、`units`、`title?`、`uses?`、`actionId?`、`epoch?`** | — | 动作示范的 iframe：取示范页地址、按 `actionId` 换 `#hash`、`epoch` 变了才重载 |

### 2.1 `CastActionModal`：动作示范弹窗（本轮新增）

> **界面上在哪**：「角色」页 · 卡片双击 / 右上「…」菜单 ·「动作示范…」。弹窗宽 `min(1000px, 96vw)`，`.hf-modal` 体系（点遮罩 / `×` 关闭）。

| 区域 | 内容 | 行为 |
|------|------|------|
| 头部 | 「动作示范：<角色名>」+ `×` | — |
| **左栏**（`.cast-act-left`，300px） | `CastDemoShot`（300×380 动画 iframe）+ 当前动作名 + 「时长 · 循环/演一遍 · AI 生成」元信息 + 一行说明 | 说明写死「动作只驱动角色代码里认得的动画参数；老角色没实现的那一项就不会动——那不是坏了」 |
| **右栏上：公共动作**（`.cast-act-right` 第一组） | 标题「公共动作 · N 条 · 所有角色都能演」+ 右侧**「新建动作…」**；列表一行一条：名字 +「内置」徽标（内置 14 条）/「改」「删」（用户自建） | 点一行 = 演这一条；「改」「删」只对自建动作出现；删前 `window.confirm` |
| **右栏中：AI 生成面板**（`.cast-act-ai`，折叠） | 一句话输入（textarea，占位「四脚交替跑起来，尾巴左右甩…」）+ 时长（number，0.3–30，step 0.1）+「循环」勾选 +「生成」按钮；进度行 / 错误行 | 调 `castTools.generateAction`，按 `taskId` 订阅 `onTaskProgress`；错误下方给出日志位置 `userData/html-agent/cast-action.jsonl` |
| **右栏下：本角色专属**（第二组） | 标题「本角色专属 · N 条 · 只有它能用」+「AI 生成…」按钮；列表带「AI」/「自建」徽标 +「删」 | 空列表时提示「公共动作调不动的部位（猫的尾巴、四只脚）用 AI 生成…」 |
| 底部 | 「改画法…」（disabled 当没有 member）+「关闭」 | 「改画法…」emit `recreate(member)`，父页 `onRecreate()` 先收起本弹窗再开原有的改画法弹窗（**不叠两层**） |

- **列表来源**：打开弹窗调 `castTools.listActions(castId)` → `cast:action-list`，返回 `{ shared, own }`；`shared` 的第一条自动选中；当前动作被删后回落到第一条可用动作。
- **「AI 生成…」一保存就重拼示范页**：`demoEpoch++`（示范页里嵌的是**当时的**动作表），并选中新动作。
- **动作只做示范、不进正片**：这一版不改角色代码、也不把动作写进项目；生成 HTML 时角色动画仍由章节按 `t` 自己算。

### 2.2 `CastActionEditor`：关键帧表编辑器（本轮新增）

> **界面上在哪**：动作示范弹窗 ·「新建动作…」（或自建动作那一行的「改」）。弹窗宽 `min(1080px, 96vw)`。

| 字段 / 控件 | 说明 |
|------|------|
| 名称 | `maxlength = CAST_ACTION_NAME_MAX`（12），占位「如：挥手」 |
| 时长 | number，`min = 0.3` / `max = 30`、step 0.1（`CAST_ACTION_DURATION`） |
| 循环播放 | checkbox（`loop`） |
| **只给这个角色** | **只在「新建」且当前 scope 不是 `own` 时出现**：勾上 = 存进 `byCast[<角色id>]`（专属），不勾 = 存成公共动作。**编辑已有动作时不显示**——改到另一个范围会留下一条重复 |
| **关键帧表**（`.cast-act-table`） | 一行一个时间点、一列一个参数，列来自 `CAST_ACTION_PARAMS`（10 项）：数字参数是 number 输入（带 `min` / `max` / `step`），`eyes` / `mouth` 是下拉；**`mouth` 有「自动」= 不传这个参数**（让角色按 `eyes` 定嘴型） |
| 行操作 | 行尾「×」删这一帧（**至少留两帧**，`disabled`）；「添加关键帧」在最后两帧之间插一个新时间点；「另存为副本」把 id 清空、名字加「副本」（**改内置动作用它**——内置只读，不能直接改） |
| 底部 | 「取消」/「保存」（名称非空、≥2 帧、时长 > 0 才可保存） |

- **打开时的灌入**：新建给两帧（`0` 与 `duration`）；编辑已有动作把 `keys` 摊到表里（内置动作打开就是「另存为新动作」：id 置空、名字加「 副本」）。数字参数新建行时预填 `def`（缺省 0），`eyes` 默认 `normal`，**`mouth` 故意不填**。
- **保存**：`castTools.saveAction({ castId, scope, action })` → `cast:action-save` → `upsertAction`（同 id 覆盖；`id` 为空由主进程起 `actN`）；成功后 `emit('saved', action, scope)`，父页重读列表、选中它并 `demoEpoch++`。
- **参数清单不在这里另写一份**：`CAST_ACTION_PARAMS` 同时供界面（本表）与主进程落盘校验用（见 [shared/constants.ts.md](../../../shared/constants.ts.md) §2.5）。

### 2.3 `CastDemoShot`：会动的 iframe（本轮新增）

```ts
const res = await window.castTools.demo(props.id, {
  units: props.units, title: props.title, uses: props.uses || []
})
base = userFileUrl(res.rel) + '&e=' + (props.epoch || 0)
src.value = base + hashOf(props.actionId)   // hashOf: '#' + encodeURIComponent(actionId)
```

- **地址协议**：示范页落在 `<userData>/cast-preview/<id>.demo.html`，用 `hgpreview://…?user=1` 载入；`userFileUrl` 已带 `?user=1`，**续接必须用 `&`**（写成 `?e=` 会 404）。
- **换动作只改 hash**：`watch(() => props.actionId, …)` 只重设 `src = base + '#' + id`——同文档导航，iframe **不重新加载**，页面自己听 `hashchange` 换动作。
- **epoch 变了才重设整段地址**：`watch(() => [props.id, props.units, props.epoch], load, { immediate: true })`；角色重画 / 动作增删后父页 `demoEpoch++`，示范页重新拼（里面嵌的是当时的动作表）。
- **并发保护**：模块内 `seq`，同一组件先后发起的两次请求只让最后一次落地；失败时显示「无法示范」。
- iframe 的 `sandbox="allow-scripts allow-same-origin"`（与静态预览 `CastShot` 同一套）。

### 2.4 `CastEditModal` / `CastMetaModal`（未变）

- **新建角色**：角色名 / 外形描述 / 身高（1–30、step 0.5）/ 水彩笔刷 / 画风（可选）→ `castTools.create({ taskId, title, desc, style, units, watercolor })`，进度按 `newTaskId('cast')` 订阅。
- **改画法**：先看当前样子，填「这次要怎么改」（必填）与可选画风（填了会用 `cast:save-meta` 顺带落盘）→ `castTools.recreate(id, request, taskId)`；成功后**留在弹窗看大图**。
- **改信息**：名字 / 描述 / 画风 / 身高 / 是否水彩 → `cast:save-meta`；改身高 / 笔刷会立刻反映到预览大小（`epoch` 不递增，`units` 变化已进 `watch`）。
- 两个弹窗都是 `.hf-modal-mask` + `.hf-modal`（点遮罩 `@click.self` 关闭、右上 `×`），宽度 `min(620px, 92vw)`（改画法 / 新建）与 `min(560px, 92vw)`（改信息）。

## 3. 数据流（谁写谁读）

```
用户动作                          渲染层                        主进程                           磁盘
新建角色      → castTools.create       → cast:create         → 调模型画代码 → cast-library/<id>.js + index.json
改画法        → castTools.recreate     → cast:recreate       → 调模型重画   → 覆盖 cast-library/<id>.js
改信息        → castTools.saveMeta     → cast:save-meta      → 不调模型     → cast-library/index.json
删除          → castTools.remove       → cast:remove         → 删库那份    → 删 <id>.js + 索引条目（+ 专属动作）
卡片预览      → CastShot               → cast:preview        → 拼自包含页  → <userData>/cast-preview/<id>.html
双击看动作    → CastDemoShot           → cast:demo           → 拼示范页    → <userData>/cast-preview/<id>.demo.html
列动作        → CastActionModal        → cast:action-list    → 读 actions.json → 内置 14 条 + 公共 + 专属
存动作        → CastActionEditor       → cast:action-save    → 规范化落盘  → cast-library/actions.json
删动作        → CastActionModal        → cast:action-remove  → 删一条      → cast-library/actions.json
AI 生成动作   → CastActionModal        → cast:action-generate→ 调一次模型  → cast-library/actions.json（专属）
```

- **角色的唯一真源是全局库**：`<userData>/cast-library/index.json`（元数据）+ `<id>.js`（`window.__cast["id"] = function (x, y, u, o) {…}`）+ **`actions.json`**（公共动作 + 每角色专属动作）。
- 本页**完全不碰项目**：`<项目>/cast/` 是产物副本，由主进程在写盘前（`syncProjectCast`）从库里复制，触发点是「HTML生成」页的勾选 / 生成 / 改稿，不是这一页。
- 预览页与示范页都落在 `<userData>/cast-preview/`（同一目录、文件名不同：`<id>.html` / `<id>.demo.html`），由 `hgpreview://…?user=1` 载入 iframe。

## 4. 与「HTML生成」页的分工

| | 「角色」页（本页） | 「HTML生成」页 ·「角色」区 |
|---|---|---|
| 管什么 | **库里的角色本身**：新建 / 看动作 / 改画法 / 改信息 / 删除 | **本片用哪几个**：只勾选 |
| 数据 | `castTools.list()`（`cast:list`） | `castTools.list()`（列库）+ `appState.project.cast`（哪些被勾上） |
| 写入 | `cast:create` / `cast:recreate` / `cast:save-meta` / `cast:remove` / **`cast:action-*` 四条** | `projectTools.saveCast(currentName, [{id}...])` → `project:save-cast` |
| 依赖当前项目 | **不依赖**（没有当前项目也能建 / 改 / 删 / 预览 / 编动作） | 依赖（写的是 `project.json` 与本片副本） |

分工的箭头只有一条：**「HTML生成」页的「管理角色」按钮 → `goPage('cast')`**。反向没有入口——「角色」页不提供「加到某个项目」这类动作。

## 5. CSS 类（动作示范那一套，都在 `assets/main.css`）

| 类 | 用在哪 |
|---|---|
| `.cast-card.static` | 卡片容器：`cursor: pointer`（本轮由 `default` 改来，双击可看动作）、`overflow: visible`（菜单能弹出） |
| `.cast-demo-shot` / `.cast-demo-frame` | 会动的大图容器（300×380、圆角 10px、底色 `#EEF2F7` 与静态预览一致）与其中的 iframe |
| `.cast-act` / `.cast-act-left` / `.cast-act-right` | 弹窗正文的两栏（左 300px 定宽、右自适应） |
| `.cast-act-now` / `.cast-act-now-name` | 大图下方「当前动作名 + 时长 / 循环」那一行 |
| `.cast-act-list` / `.cast-act-item` / `.cast-act-tag` / `.cast-act-item-meta` / `.cast-act-item-acts` / `.cast-act-link` | 两组动作列表：一行一条、选中左 3px 主色 + 渐变高亮、11px 徽标、「改 / 删」小链接 |
| `.cast-act-ai` | 「AI 生成…」面板（主色描边的小卡片） |
| `.cast-act-table` / `.cast-act-tr` / `.cast-act-th` / `.cast-act-cell` / `.cast-act-del` | 关键帧表（`grid-auto-columns` 统一列宽，参数表加减项时不用改 CSS） |

## 6. 依赖

| 依赖 | 用途 |
|------|------|
| `window.castTools`（preload） | `list` / `create` / `recreate` / `saveMeta` / `remove` / `preview` / **`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`** / `onTaskProgress` |
| `@renderer/components/CastShot.vue` | 角色**静态**预览（卡片墙与两个编辑弹窗的大图） |
| **`CastDemoShot.vue`** | 角色**会动**的预览（动作示范弹窗左栏） |
| `@renderer/composables/useToast` | 复制 / 删除 / 保存 / 生成的轻提示 |
| `@renderer/utils/taskId` 的 `newTaskId('cast')` / `newTaskId('act')` | 画角色 / 编动作各自的任务 id（进度按它分发，互不干扰） |
| `@renderer/utils/url` 的 `userFileUrl` | 把 `rel` 拼成 `hgpreview://…?user=1`（`CastDemoShot` 用） |
| `@shared/types` | `CastLibraryMember` / `CastResult` / **`CastActionDef` / `CastActionScope` / `HtmlProgressPayload`** |
| `@shared/constants` | **`CAST_ACTION_DURATION` / `CAST_ACTION_NAME_MAX` / `CAST_ACTION_PARAMS`**（编辑器） |

**注意事项**：

1. **本页没有任何「保存到项目」的动作**：看到本页的按钮就只会动全局库；想影响某部片子，去「HTML生成」页勾它。
2. **`missing` 的角色仍能「改信息」，但不能「动作示范 / 改画法」**（没有代码可演 / 可改，菜单里 `:disabled`）。
3. **进度订阅必须「先订阅、再调用」**：`onTaskProgress` 返回退订函数，`onGenerate` / `onSubmit` 在 `await` 之后第一件事就是 `off()`。
4. **删除是硬删**：`cast:remove` 删掉库里的 `<id>.js`、索引条目与它的专属动作；项目里已同步的副本由**下一次** `syncProjectCast` 收走——所以「删完立刻看某个项目」时页面里可能还留着一份旧副本，这是设计内的时序。
5. **卡片双击与「…」菜单不打架**：「…」按钮与菜单自身都 `.stop` 了 `dblclick`；卡片上的 `title` 与页脚文案都写明「双击看动作示范」。
6. **动作与角色分开存**：动作数据在 `actions.json`，不进 `<id>.js`；示范页是临时产物（`cast-preview/`），也不进项目。
