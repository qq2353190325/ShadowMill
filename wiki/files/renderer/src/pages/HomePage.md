# src/renderer/src/pages/HomePage/（页面）

> 首页：hero 区 + 五节点动态流水线 + 我的项目 / 内置示例快捷入口。

- **覆盖文件**：`HomePage/index.vue`（本目录唯一文件，121 行）
- **所在目录**：`src/renderer/src/pages/HomePage/`
- **类型**：页面组件（SFC）
- **规模**：121 行
- **对外导出**：默认导出组件（无 props）

## 1. 作用与职责

首页是整个「内容脚本 → 配音 → 字幕 → HTML → 视频」创作流水线的入口页，承担四件事：

1. **品牌与定位展示**：hero 区展示主题标签、主标题与一句话流程说明。
2. **链路可视化 + 导航**：`flow-pipeline` 用 `v-for` 渲染五个节点，节点点亮态由 `useAppStore` 的 `has*` computed 决定，点击任意节点调用 `goPage(n.page)` 直接跳到对应页。
3. **项目切换入口**：展示 `appState.myProjects`（我的项目），按 HTML✓ / 视频✓ / 字幕✓ 标注产出进度，点击进入该项目。
4. **新建项目**：输入框 + 「新建项目」按钮（或回车），走 `window.projectTools.create` 创建并切换。

原 `pages/home/{template,index}.js` 的 `init` DOM 注入已改为响应式 `v-for`；原 `home/index.js` 中 `toast` / `refreshProject` 未解构的潜在缺陷随模块化导入自然修复。

## 2. 模板结构

| 区块 | 说明 |
| --- | --- |
| `section.hero` | 主题标签 `CYBER UI · 深空科技`、`<h1>一站式音视频创作流水线</h1>`、副标题说明五节点流程 |
| `div.flow-pipeline#home-flow` | 动态流水线容器，`v-for="(n, i) in flowDefs"` 渲染节点，节点间以 `→`（`i < flowDefs.length - 1`）连接 |
| `div.flow-node` | 单节点：序号 `{{ n.idx }}`、标题 `{{ n.t }}`、描述 `{{ n.d }}`；`done` 为真时加 `flow-done` 类并显示「已完成」角标；`@click="goPage(n.page)"`，带 `:data-page="n.page"` |
| `div.metric-grid` | 四个静态指标卡：`5+` 支持音频格式、`1080P` 导出分辨率、`5` 项目链路节点、`MP4` 视频输出格式 |
| 「我的项目」区 | `panel-title` + 新建输入区 + 项目卡片列表；`v-if="appState.myProjects.length"` 渲染卡片，否则显示 `builtin-empty` 空态文案 |
| 新建输入区 | `input.hgen-input`（`v-model="newName"`，`@keydown.enter="createMy"`）+ 主按钮「新建项目」（`@click="createMy"`） |
| `div.my-card` | 我的项目卡片：标题取 `p.title || p.name`（经 `escTxt`），副行拼接 `HTML✓ / 视频✓ / 字幕✓`；`@click="openMy(i)"` |
| 内置示例区 | 无内置示例时显示「暂无内置示例项目」；否则 `panel-title` 带「只读 · 可预览 / 转视频」提示 + `builtin-card` 列表（`@click="openBuiltin(i)"`） |

### 关键样式类

| 类名 | 作用 |
| --- | --- |
| `hero` / `hero-tag` | hero 区容器与主题标签胶囊 |
| `flow-pipeline` / `flow-node` / `flow-arrow` | 流水线容器、单个节点、节点之间的箭头 |
| `flow-done` | 节点「已完成」态（由 `n.done` 控制） |
| `flow-node-index` / `flow-badge` | 节点左上角序号 / 「已完成」角标 |
| `metric-grid` / `metric-card` / `metric-value` / `metric-label` | 指标卡网格、卡片、数值、说明文字 |
| `panel-title` / `dot` | 区块标题与主题辉光圆点 |
| `hgen-input` | 新建项目名称输入框 |
| `hf-btn` / `hf-btn-primary` | 次要按钮 / 主按钮（渐变底） |
| `builtin-grid` / `my-card` / `builtin-card` | 卡片网格、我的项目卡片、内置示例卡片 |
| `builtin-empty` | 空态提示文本 |

卡片的大部分外观由内联 `style` 给出：`1px` 半透明描边（`rgba(0,212,255,.35)`）、`10px` 圆角、电子蓝→量子紫渐变底色（`rgba(0,212,255,.10)` → `rgba(139,92,246,.10)`）、`cursor:pointer`。

## 3. 脚本逻辑

### 状态

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `flowDefs` | `computed` 数组 | 五个节点定义，字段为 `idx` / `t` / `d` / `page` / `done`，随 `has*` 变化自动重算 |
| `newName` | `ref<string>` | 新建项目输入框绑定值，初值 `''` |

`flowDefs` 的具体内容与点亮条件：

| idx | t | page | done 来源 |
| --- | --- | --- | --- |
| `01` | 内容脚本 | `content` | `hasContent` |
| `02` | 配音 | `text-tts` | `hasAudio` |
| `03` | 字幕 | `subtitle` | `hasSubtitle` |
| `04` | HTML生成 | `html-gen` | `hasHtml` |
| `05` | 转成视频 | `video-gen` | `hasVideo` |

### 函数

| 名称 | 说明 |
| --- | --- |
| `createMy()` | 取 `newName.value.trim()`；为空则 `toast('请输入项目名')` 返回。调用 `window.projectTools.create(nm)`，失败时 `toast(res.message || '创建失败')`。成功后清空输入、`refreshProject()` → `switchProject(nm, false)` → `goPage('home')`，并提示「已创建并切换到项目「nm」」 |
| `openMy(i)` | 从 `appState.myProjects[Number(i)]` 取项目，`switchProject(p.name, false)` 后 `goPage('html-gen')` |
| `openBuiltin(i)` | 从 `appState.builtinProjects[Number(i)]` 取内置项目，`switchProject(b.name, true)` 后 `goPage('video-gen')` |

> 三个函数均为 `async`，且返回值标注为 `Promise<void>`；`window.projectTools.create` 的结果按 `{ ok, message }` 结果对象解构判断。

## 4. 关键流程

1. **页面挂载**：HomePage 自身无 `onMounted`，它依赖全局 `appState`。数据由 `goPage`（页面注册表）或 `App.vue` 初始化时触发的 `refreshProject()` 填充：`window.projectTools.list()` 写入 `appState.myProjects`，`window.hfTools.listProjects()` 写入 `appState.builtinProjects`。
2. **用户交互（导航）**：点击 `flow-node` → `goPage(n.page)` → 设置 `activeMenu`、`refreshProject()`、切换 `currentPage` 并递增 `pageNavKey`（强制目标页重挂载）。
3. **用户交互（新建）**：输入名称后回车或点「新建项目」→ `createMy()`。
4. **落盘持久化**：`window.projectTools.create(nm)` 在主进程创建项目目录与 `project.json`。
5. **状态刷新**：`refreshProject()` 重新拉取项目列表与当前项目详情 → `switchProject(nm, false)` 更新 `currentName` / `isBuiltin` 并写入 `localStorage['myapp.projectCtx']` → `goPage('home')` 重渲染首页，`flowDefs` 与卡片列表随 `appState` 自动更新。
6. **用户交互（打开项目）**：`openMy(i)` / `openBuiltin(i)` 切换项目上下文后跳转目标页，`toast` 由 `useToast` 统一渲染（约 2800ms 后自动消失）。

### 跳转目标一览

| 交互 | 是否切换项目 | 目标页 key |
| --- | --- | --- |
| 点击流水线 `flow-node` | 否 | `n.page`，即 `content` / `text-tts` / `subtitle` / `html-gen` / `video-gen` |
| 点击 `my-card`（我的项目） | `switchProject(p.name, false)` | `html-gen` |
| 点击 `builtin-card`（内置示例） | `switchProject(b.name, true)` | `video-gen` |
| 新建项目成功 | `switchProject(nm, false)` | `home` |

其中 `goPage` 内部顺序为：`activeMenu = key` → `await refreshProject()` → 替换 `currentPage` → `pageNavKey++`（强制目标页重挂载，使各页 `onMounted` 重新加载当前项目数据）。

## 5. 依赖与协作

**导入（`script setup`）**

| 来源 | 引入内容 |
| --- | --- |
| `vue` | `computed`、`ref` |
| `@renderer/composables/useAppStore` | `appState`、`hasAudio`、`hasContent`、`hasHtml`、`hasSubtitle`、`hasVideo`、`refreshProject`、`switchProject`、类型 `PageKey` |
| `@renderer/pages` | `goPage` |
| `@renderer/composables/useToast` | `toast` |
| `@renderer/utils/escape` | `escTxt` |

**调用的 IPC / preload 方法**

| 方法 | 用途 |
| --- | --- |
| `window.projectTools.create(nm)` | 新建「我的项目」 |
| `window.projectTools.list()`（经 `refreshProject`） | 拉取我的项目列表（含 `hasHtml` / `hasVideo` / `hasSubtitle`） |
| `window.projectTools.load(...)`（经 `refreshProject`） | 拉取当前项目详情，供 `has*` computed 判定 |
| `window.hfTools.listProjects()`（经 `refreshProject`） | 拉取内置示例项目列表 |

**注册关系**：在 `src/renderer/src/pages/index.ts` 中作为 `pages.home` 注册，且 `currentPage` 的初始值即 `pages.home`。

## 6. 注意事项与实现要点

- **流水线为纯响应式**：节点不通过 DOM 查询注入，而是 `computed` 派生；`has*` 变化即自动重算，无需手动刷新。
- **内置示例的只读语义**：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` 均带 `!appState.isBuiltin` 守卫；但 `hasVideo` 只判断 `p.videoExists`，不含 `isBuiltin` 判断。
- **点击跳转统一走 `goPage`**：它内部先 `refreshProject()` 再切换组件，因此进入目标页时数据已是当前项目最新状态。
- **新建成功后回到 `home`**：`createMy` 里显式 `goPage('home')`，保证首页列表与流水线立即反映新项目。
- **空态处理**：我的项目为空时提示「暂无项目，在上方输入名称新建一个（也可先点下方内置示例体验流程）」；内置示例为空时提示「暂无内置示例项目」。
- **`escTxt` 用于标题插值**：卡片 `title` 属性拼接 `escTxt(p.name)` / `escTxt(b.name)`，文本插值处渲染 `escTxt(p.title || p.name)` 与 `escTxt(b.title)`。
- **索引做了 `Number(i)` 转换**：`openMy` / `openBuiltin` 均先 `Number(i)` 再索引，且对取不到的项目直接 `return`。
- **进度标注的数据来源**：卡片副行的 HTML✓ / 视频✓ / 字幕✓ 依次取自 `appState.myProjects` 中 `ProjectMeta` 的 `hasHtml` / `hasVideo` / `hasSubtitle` 字段；字段为假时对应片段为空字符串，因此无任何产出的项目副行会是空白。
- **`has* computed` 的守卫差异**：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` 都带 `!appState.isBuiltin` 判断（内置示例不计为「已完成」），而 `hasVideo` 只判断 `p && p.videoExists`。
- **`flowDefs` 使用类型断言**：每个节点的 `page` 标注为 `PageKey`（如 `'content' as PageKey`），保证 `goPage(n.page)` 的类型安全。
- **首页无 `onMounted`**：页面不自行拉取数据，完全依赖全局状态；这也是 `goPage` 每次导航都调用 `refreshProject()` 的原因。
