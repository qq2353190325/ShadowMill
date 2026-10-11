# src/renderer/src/env.d.ts

> 渲染层类型补丁：引入 vite 客户端类型并声明 *.vue 模块

- **所在目录**：`src/renderer/src/`
- **类型**：类型声明（ambient declaration，仅参与类型检查，不产出运行时代码）
- **规模**：8 行
- **对外导出**：无运行时导出；对类型系统贡献两类全局声明——`vite/client` 的类型引用、`declare module '*.vue'` 的模块形状

## 1. 作用与职责

本文件是渲染层的 **TypeScript 环境补丁**，解决"TS 不认识非 TS 资源"的问题。它做两件事：

1. `/// <reference types="vite/client" />`：引入 Vite 客户端类型，使 `import.meta.env`、`*.css`/静态资源导入、HMR API 等在类型层面成立。
2. `declare module '*.vue'`：告诉 `tsc` 任何 `.vue` 导入都返回一个 Vue 组件对象，从而让 `main.ts` 的 `import App from './App.vue'` 与 `App.vue` 中的组件导入可以通过类型检查。

项目**不使用 `vue-tsc`**（源码注释明确说明）：SFC 的模板/脚本语法由 `@vitejs/plugin-vue` 在**构建期**校验，本文件只负责让 `tsc --noEmit` 不因 `.vue` 后缀报错。

## 2. 结构说明

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `/// <reference types="vite/client" />` | 三斜线指令 | 引入 `vite/client` 类型包，与 `tsconfig.web.json` 的 `"types": ["vite/client"]` 相互呼应 |
| `declare module '*.vue'` | 环境模块声明 | 通配所有 `.vue` 路径的导入形状 |
| `import type { DefineComponent } from 'vue'` | 类型导入 | 位于模块声明**内部**，仅在类型位置使用，不产生运行时依赖 |
| `const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>` | 局部常量声明 | 声明默认导出的组件对象类型 |
| `export default component` | 默认导出声明 | 使 `import App from './App.vue'` 合法 |

### 2.1 `DefineComponent` 三个类型参数的含义

| 位置 | 实参 | 含义 |
| --- | --- | --- |
| 第 1 个 | `Record<string, never>` | props 类型：无 props（空对象形状） |
| 第 2 个 | `Record<string, never>` | emits/事件类型：无事件 |
| 第 3 个 | `unknown` | setup 返回类型：不约束 |

`Record<string, never>` 表示"不接受任何键"，是比 `{}` 更严格的空对象写法。因此该声明**不提供任何组件的真实 props 类型**：`StepBar.vue` 的 `page` prop 在 `tsc` 视角下是未知的，只能在运行时与构建期由插件保证。这是项目当前"不做 SFC 类型检查"取舍的直接结果。

## 3. 关键流程

1. 执行 `tsc --noEmit -p tsconfig.web.json`（或 IDE 的 TS 服务）时，TS 按 `include` 收集文件。
2. 编译器读到本文件的三斜线指令，加载 `vite/client` 的类型定义（`import.meta.env`、资源模块等）。
3. 编译器读到 `*.vue` 的模块声明并将其登记为**通配环境模块**。
4. 遇到 `import App from './App.vue'` 时，找不到真实 `.vue` 文件类型，于是回退到通配声明，得到 `DefineComponent` 类型，类型检查通过。
5. `declare module` 位于 `.d.ts` 中且文件顶层已含 `import type` / `export default`，构成模块作用域下的**模块扩充**：`'*.vue'` 的声明仍然全局生效，而不会污染全局变量空间。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | `vite`（`vite/client` 类型） | 三斜线引用目标 |
| 依赖 | `vue`（`DefineComponent` 类型） | 仅类型导入 |
| 被使用 | `tsconfig.web.json` | `include` 明确收录 `src/renderer/src/**/*.ts`（含本文件） |
| 被使用 | `main.ts` | `import App from './App.vue'` 依赖本声明的存在 |
| 被使用 | `App.vue`、`StepBar.vue`、各页面组件 | 所有 `.vue` 导入同样依赖该通配声明 |
| 互补 | `src/preload/index.d.ts` | 那个文件声明 `window.windowControls` / `window.projectTools` 等全局；两者共同由 `tsconfig.web.json` 收录，缺一不可 |

## 5. 注意事项与实现要点

- **不声明运行时代码**：`.d.ts` 只在类型层生效，不要在此文件写任何实际逻辑。
- **不做真实组件类型推导**：由于没有 `vue-tsc`，`defineProps`、`defineEmits` 无法在此被自动推导；给 `StepBar` 之类组件传错 prop 名，`tsc` 不会报错，需要靠 `grep`/人工审查或引入 `vue-tsc` 才能拦截。
- **`vite/client` 的引入位置**：`tsconfig.web.json` 的 `"types"` 已含 `vite/client`，本文件的三斜线指令是冗余但无害的双保险；删除任一来源都仍能通过检查，但两者都删会导致 `import.meta.env` 报错。
- **只影响 renderer 的 web tsconfig**：`tsconfig.node.json`、`tsconfig.agent.json` 不包含本文件，因此主进程/preload 中的 `.vue` 导入不会被"合法化"。
- **新增资源类型时在此扩展**：若将来引入 `.svg?raw`、`.md` 之类的新导入形式且 `vite/client` 未覆盖，应在本文件追加 `declare module` 声明，而不是在业务代码里用 `@ts-ignore`。
- **修改本文件不影响打包产物**：类型声明参与构建前的检查（若执行了类型检查脚本），不进入 bundle。
