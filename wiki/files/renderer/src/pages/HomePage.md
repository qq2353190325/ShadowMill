# src/renderer/src/pages/HomePage/（页面）

> 首页：hero 区 + 五节点动态流水线 + 「我的项目」卡片（只选择 / 打开）。

- **覆盖文件**：`HomePage/index.vue`（本目录唯一文件，86 行）
- **所在目录**：`src/renderer/src/pages/HomePage/`
- **类型**：页面组件（SFC）
- **规模**：86 行
- **对外导出**：默认导出组件（无 props、无 emits）

## 1. 作用与职责

首页是整个「内容脚本 → 配音 → 字幕 → HTML → 视频」创作流水线的入口页，承担三件事：

1. **品牌与定位展示**：hero 区展示**品牌角标**（`{{ brandTag }}` = `APP_NAME + ' · ' + APP_NAME_EN.toUpperCase()`，当前渲染为「影坊 · SHADOWMILL」）、主标题（`{{ APP_SLOGAN }}`，当前为「一站式音视频创作流水线」）与一句话流程说明，底部另有一行参数小字（视觉主题「CYBER UI · 深空科技」+「语音识别与视频渲染均在本机完成」）。品牌文案全部来自 `@shared/constants`，本页不写品牌字面量。
2. **链路可视化 + 导航**：`flow-pipeline` 用 `v-for` 渲染五个节点，节点点亮态由 `useAppStore` 的 `has*` computed 决定，点击任意节点调用 `goPage(n.page)` 直接跳到对应页。
3. **项目选择入口**：展示 `appState.myProjects`（我的项目）卡片，标注 HTML ✓/— 、视频 ✓/— 、字幕 ✓/— 与更新时间，点击进入该项目。

**本页不允许新建项目**：「我的项目」区块只做**选择 / 打开**，新建入口统一收在顶部「工作项目」栏的 `NewProjectDialog` 弹窗（见 [`components.md`](../components.md)）。

原 `pages/home/{template,index}.js` 的 `init` DOM 注入已改为响应式 `v-for`。

## 2. 模板结构

| 区块 | 说明 |
| --- | --- |
| `section.hero` | 品牌角标 `{{ brandTag }}`（`APP_NAME · APP_NAME_EN.toUpperCase()`，当前为「影坊 · SHADOWMILL」）、`<h1>{{ APP_SLOGAN }}</h1>`（当前为「一站式音视频创作流水线」）、副标题说明五节点流程、参数行 `.hero-sub`「CYBER UI · 深空科技 视觉主题 · 语音识别与视频渲染均在本机完成」 |
| `div.flow-pipeline#home-flow` | 动态流水线容器，`v-for="(n, i) in flowDefs"` 渲染节点，节点间以 `→`（`i < flowDefs.length - 1`）连接 |
| `div.flow-node` | 单节点：序号 `{{ n.idx }}`、标题 `{{ n.t }}`、描述 `{{ n.d }}`；`done` 为真时加 `flow-done` 类并显示「已完成」角标；`@click="goPage(n.page)"`，带 `:data-page="n.page"` |
| `div.metric-grid` | 四个静态指标卡：`5+` 支持音频格式、`1080P` 导出分辨率、`5` 项目链路节点、`MP4` 视频输出格式 |
| `div.card.hgen-panel`（我的项目） | `.panel-title` + `.dot` 标题「我的项目」；`v-if="appState.myProjects.length"` 渲染 `.proj-grid` 卡片网格，否则显示 `.empty-hint` 空态文案 |
| `div.proj-card` | 单张项目卡片（`v-for="p in appState.myProjects"`，`:key="p.name"`、`:title="'打开项目 ' + p.name"`、`@click="openMy(p.name)"`） |
| `b.proj-card-name` | 卡片主标题 = **项目名** `p.name`（**不再**使用 `project.json` 的 `title`——其缺省值 `'字幕动画'` 会误导用户） |
| `div.proj-card-meta` | 三个状态标记：`HTML{{ p.hasHtml ? '✓' : '—' }}` / `视频{{ p.hasVideo ? '✓' : '—' }}` / `字幕{{ p.hasSubtitle ? '✓' : '—' }}`，各自 `:class="{ on: p.has* }"` 高亮 |
| `div.proj-card-time` | `{{ p.updatedAt ? '更新于 ' + fmtTime(p.updatedAt) : '' }}`，格式 `YYYY-MM-DD HH:mm` |

### 关键样式类

| 类名 | 作用 | 定义位置 |
| --- | --- | --- |
| `hero` / `hero-tag` / `hero-sub` | hero 区容器、**品牌角标**胶囊（文案 `{{ brandTag }}`，来自 `@shared/constants`）、底部参数小字行（12px、`letter-spacing:1px`、`opacity:.75`） | `assets/main.css` |
| `flow-pipeline` / `flow-node` / `flow-arrow` | 流水线容器、单个节点、节点之间的箭头 | 同上 |
| `flow-done` / `flow-node-index` / `flow-badge` | 节点「已完成」态、左上角序号、「已完成」角标 | 同上 |
| `metric-grid` / `metric-card` / `metric-value` / `metric-label` | 指标卡网格、卡片、数值、说明文字 | 同上 |
| `card` / `hgen-panel` / `panel-title` / `dot` | 我的项目区块的卡片外壳与标题（`.panel-title` 现已全局化） | 同上 |
| `proj-grid` | 项目卡片网格：`repeat(auto-fill, minmax(220px, 1fr))` | `assets/main.css`（本页新增节） |
| `proj-card` | 项目卡片：主色描边 + 蓝紫渐变底 + hover 上移 2px 与卡片辉光 | 同上 |
| `proj-card-name` / `proj-card-meta` / `proj-card-meta .on` / `proj-card-time` | 项目名（主色、`word-break: break-all`）/ 状态行 / 已产出态（数据绿）/ 更新时间（更淡的雾蓝） | 同上 |
| `empty-hint` | 空态提示文本：「暂无项目。点顶部「工作项目」栏的「新建项目」创建一个。」 | 同上 |

## 3. 脚本逻辑

### 状态

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `flowDefs` | `computed` 数组 | 五个节点定义，字段为 `idx` / `t` / `d` / `page` / `done`，随 `has*` 变化自动重算 |
| `brandTag` | 模块级常量 `string` | `APP_NAME + ' · ' + APP_NAME_EN.toUpperCase()`（当前渲染为「影坊 · SHADOWMILL」），供 `.hero-tag` 使用；两个来源常量都取自 `@shared/constants` |
| `APP_SLOGAN` | 导入的常量 | 直接用于 `<h1>{{ APP_SLOGAN }}</h1>`（当前为「一站式音视频创作流水线」） |

`flowDefs` 的具体内容与点亮条件：

| idx | t | page | done 来源 |
| --- | --- | --- | --- |
| `01` | 内容脚本 | `content` | `hasContent` |
| `02` | 配音 | `text-tts` | `hasAudio` |
| `03` | 字幕 | `subtitle` | `hasSubtitle` |
| `04` | HTML生成 | `html-gen` | `hasHtml` |
| `05` | 视频预览 | `video-preview` | `hasVideo` |

该表的 `t` 是节点标题，节点的描述文本 `d` 为：`01` 编写旁白与画面分镜，定义全局风格；`02` 由脚本旁白合成为自然语音；`03` 由旁白派生对齐的同步字幕；`04` 由脚本整体生成精美的 HTML 动画；`05` 查看 / 定位导出的视频成品（转视频在 HTML生成页）。

本页**没有 `ref` 状态**：原 `newName`（新建输入框绑定值）已随新建入口删除。

### 函数

| 名称 | 说明 |
| --- | --- |
| `fmtTime(iso)` | `Date` 解析 + 补零，返回 `YYYY-MM-DD HH:mm`（只截到分钟，避免卡片换行）；解析失败（`isNaN(d.getTime())`）返回 `''`。**本页本地实现**，不引 `utils/time.ts`（那里的 `fmtTime` 是字幕用的 `[分:秒]` 格式，语义不同） |
| `openMy(name)` | `await switchProject(name)` → `await goPage('html-gen')`。参数是**项目名**（不再是数组下标），`switchProject` 也是**单参数** |

> `openMy` 为 `async`，返回值标注为 `Promise<void>`。

## 4. 关键流程

1. **页面挂载**：HomePage 自身无 `onMounted`，它依赖全局 `appState`。数据由 `goPage`（页面注册表）或 `App.vue` 初始化时触发的 `refreshProject()` 填充：`window.projectTools.list()` 写入 `appState.myProjects`（`refreshProject` 只发这一路列表请求）。
2. **用户交互（导航）**：点击 `flow-node` → `goPage(n.page)` → 设置 `activeMenu`、`refreshProject()`、切换 `currentPage` 并递增 `pageNavKey`（强制目标页重挂载）。
3. **用户交互（打开项目）**：点击 `proj-card` → `openMy(p.name)` → `switchProject(name)`（写 `currentName` + `saveProjectCtx()` 落盘 `localStorage['myapp.projectCtx']` + `refreshProject()`）→ `goPage('html-gen')`。
4. **落盘持久化**：本页不直接调任何写盘接口；新建项目在主进程 `project:create` 中完成（由 `NewProjectDialog` 触发）。
5. **状态刷新**：`switchProject` / `goPage` 内部的 `refreshProject()` 更新 `appState.project` 与 `myProjects`，`flowDefs` 与卡片列表随之自动重算。

### 跳转目标一览

| 交互 | 是否切换项目 | 目标页 key |
| --- | --- | --- |
| 点击流水线 `flow-node` | 否 | `n.page`，即 `content` / `text-tts` / `subtitle` / `html-gen` / `video-preview` |
| 点击 `proj-card`（我的项目） | `switchProject(p.name)` | `html-gen` |

其中 `goPage` 内部顺序为：`activeMenu = key` → `await refreshProject()` → 替换 `currentPage` → `pageNavKey++`（强制目标页重挂载，使各页 `onMounted` 重新加载当前项目数据）。

## 5. 依赖与协作

**导入（`script setup`）**

| 来源 | 引入内容 |
| --- | --- |
| `vue` | `computed` |
| `@shared/constants` | `APP_NAME`、`APP_NAME_EN`、`APP_SLOGAN`（品牌文案唯一来源：前两个拼出 `brandTag`，第三个作主标题） |
| `@renderer/composables/useAppStore` | `appState`、`hasAudio`、`hasContent`、`hasHtml`、`hasSubtitle`、`hasVideo`、`switchProject`、类型 `PageKey` |
| `@renderer/pages` | `goPage` |

**不再引入**：`ref`（无本地状态）、`refreshProject`（改由 `switchProject` / `goPage` 内部触发）、`toast`（本页已无任何提示点）、`escTxt`（见下）、`window.projectTools`（本页不再直接调 IPC）。

**调用的 IPC / preload 方法**

| 方法 | 用途 |
| --- | --- |
| `window.projectTools.list()`（经 `refreshProject`） | 拉取我的项目列表（含 `hasHtml` / `hasVideo` / `hasSubtitle` / `updatedAt`） |
| `window.projectTools.load(...)`（经 `refreshProject`） | 拉取当前项目详情，供 `has*` computed 判定 |

**注册关系**：在 `src/renderer/src/pages/index.ts` 中作为 `pages.home` 注册，且 `currentPage` 的初始值即 `pages.home`。

## 6. 注意事项与实现要点

- **流水线为纯响应式**：节点不通过 DOM 查询注入，而是 `computed` 派生；`has*` 变化即自动重算，无需手动刷新。
- **链路状态的判定只看当前项目**：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo` 一律只看当前项目自身的产物字段（`hasHtml` 额外要求 `htmlExists && htmlPath`）。
- **主标题用项目名而不是 `title`**：`project.json` 的 `title` 缺省值是 `'字幕动画'`（`refreshProject` 的回填值），直接拿它当标题会让所有未改标题的项目卡片看起来一样，因此卡片主标题改为 `p.name`。
- **全页不再手工转义**：项目名、状态标记与时间全部走 `{{ }}` 插值，由 Vue 自动转义；`:title` 也由 Vue 处理。原实现用 `escTxt` 拼字符串，会在数据含 `&` 时**二次转义**出 `&amp;`（例如项目名 `A&B` 显示成 `A&amp;B`）——改用插值后该缺陷消失。这也是本页不再 `import` `@renderer/utils/escape` 的原因。
- **点击跳转统一走 `goPage`**：它内部先 `refreshProject()` 再切换组件，因此进入目标页时数据已是当前项目最新状态。
- **空态处理**：我的项目为空时提示「暂无项目。点顶部「工作项目」栏的「新建项目」创建一个。」——引导指向 StepBar 的弹窗（首页自己无新建能力）。
- **进度标注的数据来源**：卡片状态行依次取自 `appState.myProjects` 中 `ProjectMeta` 的 `hasHtml` / `hasVideo` / `hasSubtitle` 字段；为假时显示 `—`，并通过 `.proj-card-meta .on` 把已产出项染成数据绿。
- **`openMy` 的参数是名字不是下标**：模板直接绑 `@click="openMy(p.name)"`，函数内不再需要 `Number(i)` 转换与越界判断（原实现的下标用法已删除）。
- **`flowDefs` 使用类型断言**：每个节点的 `page` 标注为 `PageKey`（如 `'content' as PageKey`），保证 `goPage(n.page)` 的类型安全。
- **首页无 `onMounted`**：页面不自行拉取数据，完全依赖全局状态；这也是 `goPage` 每次导航都调用 `refreshProject()` 的原因。
- **`fmtTime` 是本页私有实现**：只有本页用这种「到分钟」的展示格式，因此没有下放到 `utils/time.ts`，避免与字幕时间轴格式化（`[分:秒]`）混淆。
- **品牌文案一律走常量、不写字面量**：角标由 `brandTag`（`APP_NAME + ' · ' + APP_NAME_EN.toUpperCase()`）拼出、主标题直接用 `APP_SLOGAN`，三个源常量都来自 `@shared/constants`。这样改品牌只改那一个文件（`index.html` 的标题与启动画面走构建期占位符注入，见 [index.html.md](../../index.html.md) §2.2），本页不需要动。注意 `brandTag` 是**模块级常量**而非 `computed`——两个操作数都是编译期常量，无需响应式。
