# src/renderer/src/main.ts

> 渲染层 Vue 应用入口：创建应用、挂载根组件、导入全局样式

- **所在目录**：`src/renderer/src/`
- **类型**：应用入口（ESM 模块，由 `index.html` 的模块脚本加载）
- **规模**：6 行
- **对外导出**：无导出。模块以副作用方式完成 `createApp(App).mount('#app')`

## 1. 作用与职责

本文件是整个 Vue 渲染层的**启动点**，职责被刻意压到最小：

1. 从 `vue` 引入 `createApp` 工厂函数。
2. 引入根组件 `App.vue`。
3. 导入全局样式 `./assets/main.css`（主题变量、基础重置、公共控件样式）。
4. 创建应用实例并挂载到 `index.html` 中的 `#app` 容器。

窗口控制、进度监听、项目上下文恢复等**启动逻辑不在这里**，而是写在 `App.vue` 的 `onMounted` 中（源码注释亦标明：Phase 1 只搭骨架，应用初始化流程在 `App.vue` 内）。这样入口文件保持无状态、可预测。

## 2. 结构说明

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `createApp` | 具名导入（`vue`） | Vue 3 应用工厂；本文件唯一使用的 Vue API |
| `App` | 默认导入（`./App.vue`） | 根组件，类型由 `env.d.ts` 的 `*.vue` 模块声明提供 |
| `./assets/main.css` | 副作用导入（CSS） | 全局样式：`*` 重置、`:root` 深空科技主题 CSS 变量、公共类（`.hf-btn`、`.hf-select`、`.hgen-input` 等） |
| `createApp(App).mount('#app')` | 表达式 | 创建实例并挂载到 `index.html` 的 `<div id="app">` |

### 2.1 import 顺序的语义

| 行 | 语句 | 为什么是这个顺序 |
| --- | --- | --- |
| 1 | 注释 | 说明历史迁移阶段（Phase 1 骨架 / Phase 5 移植启动流程） |
| 2 | `import { createApp } from 'vue'` | 依赖先于使用 |
| 3 | `import App from './App.vue'` | 根组件定义 |
| 4 | `import './assets/main.css'` | 全局样式置于组件之后导入；CSS 无导出、仅副作用，Vite 会将其抽为样式资源或注入 `<style>` |

## 3. 关键流程

1. `index.html` 中的 `<script type="module" src="/src/main.ts">` 触发本模块求值。
2. `import 'vue'` 解析 Vue 运行时；`import App from './App.vue'` 由 `@vitejs/plugin-vue` 编译 SFC 为组件对象。
3. `import './assets/main.css'` 生效，全局 CSS 变量（`--bg-primary`、`--color-primary`、`--text-secondary`、`--sidebar-width` 等）在 `:root` 上可用。
4. `createApp(App)` 创建应用实例。
5. `.mount('#app')` 找到宿主容器并完成首次渲染：`App.vue` 的模板（标题栏 / 侧边菜单 / 内容区 / Toast 宿主）被插入页面。
6. 挂载完成后 `App.vue` 的 `onMounted` 钩子执行，开始窗口状态订阅、渲染进度订阅与项目上下文恢复。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | `vue` | 仅使用 `createApp` |
| 依赖 | `./App.vue` | 根组件 |
| 依赖 | `./assets/main.css` | 全局样式与主题变量 |
| 被使用 | `src/renderer/index.html` | 唯一调用方，经 `<script type="module">` 加载 |
| 被使用 | `electron.vite.config.ts` | renderer 构建以本文件为入口模块，输出到 `out/renderer` |
| 类型协作 | `src/renderer/src/env.d.ts` | 提供 `*.vue` 与 `vite/client` 类型，使 `import App from './App.vue'` 通过 `tsc` |
| 后续协作 | `src/preload/index.d.ts` | 本文件不直接用 `window.*`，但 `App.vue` 会用到其声明的 `window.windowControls` 等 |

## 5. 注意事项与实现要点

- **不引入 vue-router**：项目采用 `pages/index.ts` 的注册表 + `goPage` 模式切换页面，`main.ts` 因此也不需要注册路由或插件。
- **不引入 Pinia 等状态库**：全局状态是 `composables/useAppStore.ts` 里的模块级 `reactive` 单例，无需在入口安装插件。
- **挂载容器必须存在**：`mount('#app')` 依赖 `index.html` 的 `<div id="app">`；改名或删标签会导致挂载失败并抛错。
- **样式导入不可删**：`main.css` 定义了 `StepBar`、各页面共用的 `.hf-btn` / `.hf-select` / `.hgen-input` 等公共类与全部主题变量，缺失会造成大面积样式塌陷。
- **启动副作用不在此处**：若需要新增全局初始化（例如新的 IPC 订阅），应加在 `App.vue` 的 `onMounted` 中，保持入口文件"只挂载"的单一职责。
- **本文件无导出**：任何模块都不应 `import` 本文件；它是应用的执行叶子节点。
