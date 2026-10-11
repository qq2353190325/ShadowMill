# src/renderer/src/App.vue

> 应用外壳：自绘标题栏 + 侧边菜单 + 页面容器 + Toast 宿主 + 启动初始化

- **所在目录**：`src/renderer/src/`
- **类型**：根组件（单文件组件，`<script setup lang="ts">` + `<style scoped>`）
- **规模**：154 行（模板 59 行 / 脚本 55 行 / 样式 38 行，另含 2 行空行分隔）
- **对外导出**：默认导出组件对象（经 `env.d.ts` 的 `*.vue` 声明被 `main.ts` 导入）；**无 props、无 emits**，全部状态来自 composables 与 preload 桥

## 1. 作用与职责

`App.vue` 是原 `src/index.html` 的 titlebar/sidebar 标记与 `entry.js` 中窗口控制、进度监听、启动逻辑的**合并移植体**。它承担五类职责：

1. **自绘标题栏**：因主进程使用 `titleBarStyle: 'hidden'`，标题栏由本组件绘制，含 logo、标题「我的应用」与最小化/最大化/关闭三个按钮。
2. **左侧文字菜单**：8 个菜单项由 `menuItems` 数组 `v-for` 渲染，点击调用 `goPage(item.key)`。
3. **右侧页面容器**：用 `<component :is="currentPage" :key="pageNavKey" />` 渲染 `pages` 注册表中的当前页面组件。
4. **Toast 宿主**：`TransitionGroup` 渲染 `useToasts()` 的队列，并提供 `.toast-host` / `.toast-item` 的 scoped 样式。
5. **全局启动**：`onMounted` 中订阅窗口最大化状态、初始化渲染进度监听、恢复上次项目上下文、并行载入项目列表与渲染默认档位并进入首页。

## 2. 结构说明

### 2.1 模板区块

| 区块 | 关键标记 | 说明 |
| --- | --- | --- |
| 标题栏 | `<header class="titlebar">` | 可拖拽区域（拖拽样式由全局 `main.css` 提供）；`.titlebar-logo` 为六边形 SVG（`<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>`） |
| 标题文本 | `.titlebar-title` | 固定文案「我的应用」 |
| 窗口按钮组 | `.titlebar-controls` | 三个 `button.win-btn`：最小化（`@click="winMinimize"`）、最大化/还原（`@click="winToggleMaximize"`，`title` 随 `isMaximized` 在「还原」/「最大化」间切换）、关闭（`button.win-btn.win-close`，`@click="winClose"`） |
| 最大化图标切换 | `v-show="!isMaximized"` / `v-show="isMaximized"` | 两个互斥的 SVG 分支：还原态画单矩形，最大化态画双矩形叠放（后一个 `fill="#0B1220"` 挖空） |
| 布局容器 | `<div class="layout">` | 左右分栏骨架 |
| 侧栏 | `<aside class="sidebar"><nav class="menu" id="menu">` | 保留 `id="menu"` 与原结构一致 |
| 菜单项 | `div.menu-item` | `v-for="item in menuItems"`，`:key="item.key"`、`:class="{ active: activeMenu === item.key }"`、`:data-page="item.key"`、`:title="item.title"`、`@click="goPage(item.key)"` |
| 内容区 | `<main class="content" id="content" ref="contentEl">` | `ref="contentEl"` 供页面切换后滚动复位使用 |
| 动态页面 | `<component :is="currentPage" :key="pageNavKey" />` | `:key` 强制重挂载，见第 3 节 |
| Toast 宿主 | `<TransitionGroup tag="div" name="toast" class="toast-host">` | 内层 `v-for="t in toasts" :key="t.id"` 的 `div.toast-item`，文本为 `{{ t.msg }}` |

### 2.2 菜单项清单（`menuItems`）

| 顺序 | `key`（`PageKey`） | `label`（显示文字） | `title`（提示） |
| --- | --- | --- | --- |
| 1 | `home` | 首页 | 首页 |
| 2 | `content` | 内容脚本 | 内容脚本 |
| 3 | `text-tts` | 配音 | 配音（文字生音频） |
| 4 | `subtitle` | 字幕生成 | 字幕生成 |
| 5 | `html-gen` | HTML生成 | HTML生成 |
| 6 | `video-preview` | 视频预览 | 视频预览（转视频入口在 HTML生成页） |
| 7 | `about` | 关于 | 关于 |
| 8 | `settings` | 设置 | 设置 |

> `PageKey` 中另有 `sound-copy`（音色复刻），它**不在侧边栏菜单里**，只通过 `pages` 注册表与其他页面跳转抵达；`StepBar` 中「配音」节点同时把 `sound-copy` 视为当前态。菜单只有上表 8 项。

### 2.3 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `toasts` | `const`（`useToasts()` 返回值） | Toast 队列 ref，模板中 `v-for` 数据源 |
| `contentEl` | `ref<HTMLElement \| null>(null)` | `<main class="content">` 的模板引用 |
| `isMaximized` | `ref(false)` | 窗口最大化状态，由主进程推送更新 |
| `menuItems` | `{ key: PageKey; label: string; title: string }[]` | 菜单配置数组（见 2.2） |
| `winMinimize()` | `function(): void` | 调 `window.windowControls.minimize()` |
| `winToggleMaximize()` | `function(): void` | 调 `window.windowControls.toggleMaximize()` |
| `winClose()` | `function(): void` | 调 `window.windowControls.close()` |
| `initApp()` | `async function(): Promise<void>` | 恢复项目上下文 → `Promise.all([refreshProject(), loadRenderDefaults()])` → `goPage('home')` |
| `watch(currentPage, ...)` | 侦听器 | 页面切换后 `contentEl.value.scrollTop = 0` |
| `onMounted(...)` | 生命周期钩子 | 订阅最大化状态、`initRenderProgress()`、`void initApp()` |

## 3. 关键流程

### 3.1 启动初始化（`onMounted`）

1. **订阅窗口状态**：`window.windowControls.onMaximizedChange((v: boolean) => { isMaximized.value = v; })`——主进程在窗口 `maximize`/`unmaximize` 事件中推送布尔值，用于切换最大化按钮图标。
2. **初始化渲染进度**：`initRenderProgress()` 注册 `window.hfTools.onProgress` 回调（HyperFrames 渲染进度解析，结果写入 `renderProgress.text`，供视频页展示）。预加载层为单订阅语义，重复注册只替换回调。
3. **恢复项目上下文**：`localStorage.getItem('myapp.projectCtx')`，`JSON.parse` 后若存在且含 `name`，则写回 `appState.currentName = saved.name`、`appState.isBuiltin = !!saved.builtin`。整段包在 `try/catch` 中，解析失败（脏数据/非 JSON）静默忽略（`catch (e) { /* ignore */ }`）。
4. **刷新项目 + 载入渲染默认档位**：`await Promise.all([refreshProject(), loadRenderDefaults()])`——前者拉取「我的项目」(`projectTools.list`) 与内置示例 (`hfTools.listProjects`) 并加载当前项目详情，后者读 `settingsTools.get()` 的 `render` 段写入 `composables/useRenderOptions.ts` 的 `renderDefaults`（源码注释：项目列表与渲染默认档位并行载入，档位读取失败不影响启动，落回内置默认 `standard` / `30`）。
5. **进入首页**：`goPage('home')` 设置 `activeMenu`、再次 `refreshProject()`、切换 `currentPage`、递增 `pageNavKey`。
6. 调用处使用 `void initApp();`：显式丢弃 Promise，避免未捕获 rejection 警告，同时让 `onMounted` 保持同步返回。

### 3.2 菜单跳转与页面渲染

1. 点击菜单项 → `goPage(item.key)`（定义于 `pages/index.ts`）。
2. `goPage` 内依次：`activeMenu.value = key` → `await refreshProject()` → `currentPage.value = pages[key]` → `pageNavKey.value++`。
3. `activeMenu` 变化驱动 `:class="{ active: ... }"` 更新菜单高亮；`currentPage` 变化触发下述 `watch`。
4. `pageNavKey` 递增使 `<component :is>` 的 `:key` 改变，**强制卸载并重挂载**页面组件，恢复旧版"每次进入页面都重跑 init"的语义，避免同页切换项目后残留旧项目数据/预览。
5. 页面切换后滚动复位：`watch(currentPage, () => { if (contentEl.value) contentEl.value.scrollTop = 0; })`——对应原 `goPage` 里的 `content.scrollTop = 0`。

### 3.3 轻提示（Toast）

1. 任意模块调用 `toast(msg)`（`composables/useToast.ts`）→ 生成自增 `id` 并 push 进模块级 `toasts` 队列。
2. `toast()` 内部 `setTimeout(..., 2800)` 后按 `id` 过滤移除，无需组件额外清理。
3. `App.vue` 是唯一渲染该队列的地方；`TransitionGroup` 以 `name="toast"` 应用淡入淡出过渡类。

## 4. 依赖与协作

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `onMounted`、`ref`、`watch` | 生命周期与模板引用、侦听器 |
| 依赖 | `./composables/useAppStore` | `activeMenu`（菜单高亮）、`appState`（项目上下文）、`refreshProject`、类型 `PageKey` |
| 依赖 | `./pages` | `currentPage`、`goPage`、`pageNavKey` |
| 依赖 | `./composables/useToast` | `useToasts()` 取 Toast 队列 |
| 依赖 | `./composables/useRenderProgress` | `initRenderProgress()` |
| 依赖 | `./composables/useRenderOptions` | `loadRenderDefaults()`（启动时与 `refreshProject()` 并行载入全局渲染默认档位） |
| 依赖（preload 桥） | `window.windowControls` | `minimize` / `toggleMaximize` / `close` / `onMaximizedChange`；类型见 `src/preload/index.d.ts` |
| 依赖（preload 桥） | `window.hfTools.onProgress` | 经 `initRenderProgress()` 间接使用 |
| 被使用 | `src/renderer/src/main.ts` | `createApp(App).mount('#app')` |
| 被使用 | 全部页面组件 | 通过 `pages` 注册表被 `<component :is>` 渲染；各页面顶部放置 `<StepBar :page="..."/>` |

## 5. 注意事项与实现要点

- **CSP 相关**：本组件大量使用行内 `style` 与 scoped 样式注入，依赖 `index.html` 中 `style-src 'self' 'unsafe-inline'`；模板中不使用任何内联 `<script>`。
- **模板作用域无 `window`**：因此窗口控制包了三个包装函数（`winMinimize` / `winToggleMaximize` / `winClose`），注释中已说明；模板里直接写 `window.windowControls...` 会取不到该标识符。
- **`isMaximized` 是单向同步**：初值 `false`，只有主进程推送时才更新。若窗口以最大化状态启动，需依赖主进程在对应事件后推送（`main/index.ts` 在 `maximize`/`unmaximize` 事件中发送 `MaximizedChange`）。
- **scoped 样式与 TransitionGroup**：`<style scoped>` 中的 `.toast-enter-active` / `.toast-leave-active` / `.toast-enter-from` / `.toast-leave-to` 由 Vue 过渡机制附加在 Toast 元素上，与 scoped 属性共同匹配，故直接生效；过渡仅使用 `opacity 0.25s ease`。
- **`.toast-item` 自身 `position: fixed`**：虽然外层 `.toast-host` 也是 `fixed`，但条目用 `left:50%` + `bottom:28px` + `translateX(-50%)` 独立定位到底部居中；宿主 `pointer-events: none`、条目 `pointer-events: auto`，避免遮挡交互。
- **颜色为字面量而非变量**：`.toast-item` 中写死 `#E6F1FF`、`rgba(11, 18, 32, .95)`、`rgba(0, 212, 255, .5)`，与主题变量同值但未引用变量，改主题时需同步此处。
- **启动逻辑幂等性**：`onMounted` 只执行一次，但 `goPage('home')` 会再次 `refreshProject()`，即首次启动会有两次项目列表拉取（`initApp` 内一次 + `goPage` 内一次），属于现有实现，非缺陷但需知晓。
- **删除项目的兜底在 store 层**：若 localStorage 记的项目已不存在，由 `refreshProject()` 回退到 `myProjects[0]` 或 `'demo-project'`，本组件不做校验。
- **渲染默认档位只在这里读一次**：`loadRenderDefaults()` 把 `settings.json` 的 `render` 段写入模块级 `renderDefaults`（`useRenderOptions.ts`）；页面只读该单例与 `effectiveRenderOptions()`，不各自读设置。设置页保存后由 `saveRenderDefaults()` 就地更新，因此无需重启或刷新本组件。
