# tsconfig.json / tsconfig.node.json / tsconfig.web.json / tsconfig.agent.json

> TypeScript 项目分治：solution 根 + node / web / agent 三份独立子配置

- **位置**：工程根（四份同名族配置）
- **类型**：TypeScript 配置（solution 根 1 份 + 子项目 3 份）
- **规模**：tsconfig.json 8 行、tsconfig.node.json 23 行、tsconfig.web.json 24 行、tsconfig.agent.json 15 行，合计 70 行

## 1. 作用与职责

| 文件 | 角色 |
| --- | --- |
| `tsconfig.json` | **solution 根**：`files: []` + `references` 三个子项目，自身不编译任何文件，只作入口索引 |
| `tsconfig.node.json` | **主进程侧**：`src/main`、`src/preload`、`src/shared` 与构建配置 `electron.vite.config.ts` |
| `tsconfig.web.json` | **渲染层**：`src/renderer/src` 的 `.ts` / `.vue` + `src/preload/index.d.ts` + `src/shared` |
| `tsconfig.agent.json` | **独立 agent 子进程**：只含 `src/agent/**/*.ts` |

分治的动机：三块代码的**运行环境与全局类型完全不同**（Node 内置模块 / 浏览器 + Vite / Node 子进程），混在一份配置里必然出现 `types`、`lib`、别名互相污染。

## 2. 内容详解

### 2.1 solution 根 `tsconfig.json`

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `files` | `[]` | 显式**空数组**：根配置不编译任何文件，避免把整棵目录树纳入检查 |
| `references` | 3 项：`./tsconfig.node.json`、`./tsconfig.web.json`、`./tsconfig.agent.json` | 声明三个子项目，供支持 project references 的工具做拓扑索引 |

注意：根配置**没有** `compilerOptions`，也没有 `composite: true`——它只是「索引」，不是可构建的引用目标。

### 2.2 三份子项目 compilerOptions 对照

| 选项 | tsconfig.node.json | tsconfig.web.json | tsconfig.agent.json |
| --- | --- | --- | --- |
| `target` | `ES2022` | `ES2022` | `ES2022` |
| `module` | `ESNext` | `ESNext` | `ESNext` |
| `moduleResolution` | `Bundler` | `Bundler` | `Bundler` |
| `lib` | `["ES2022", "DOM"]` | `["ES2022", "DOM", "DOM.Iterable"]` | `["ES2022", "DOM"]` |
| `types` | `["node"]` | `["vite/client"]` | `["node"]` |
| `strict` | `true` | `true` | `true` |
| `noEmit` | `true` | `true` | `true` |
| `esModuleInterop` | `true` | `true` | `true` |
| `skipLibCheck` | `true` | `true` | `true` |
| `forceConsistentCasingInFileNames` | `true` | `true` | `true` |
| `paths` | `@shared/*` → `./src/shared/*` | `@renderer/*` → `./src/renderer/src/*`；`@shared/*` → `./src/shared/*` | **无** |

**唯一差异集中在 `lib`、`types`、`paths` 三项**，其余十项完全一致（同一套严格度基线）。

### 2.3 关键选项含义

| 选项 | 含义与为何这样设 |
| --- | --- |
| `target: ES2022` | 输出/校验语法级别为 ES2022；Electron 31 内置的 Chromium/Node 完全支持，无需降级 |
| `module: ESNext` | 源码按 ESM `import` / `export` 书写（与实际代码风格一致） |
| `moduleResolution: Bundler` | 按打包器语义解析模块：允许省略扩展名、读 `exports` 字段；与 Vite / electron-vite 的实际解析行为对齐 |
| `lib`（node/agent） | `["ES2022", "DOM"]`：需要 DOM 类型是因为 preload / Electron 里会碰到 DOM 相关类型；主进程本身不含 lib.dom 运行时 |
| `lib`（web） | 额外加 `"DOM.Iterable"`，使 `NodeList`、`FormData` 等可直接 `for...of` |
| `types`（node/agent） | `["node"]`：显式只要 Node 全局类型，**排除** `@types/*` 的自动全量加载 |
| `types`（web） | `["vite/client"]`：提供 `import.meta.env`、`*.vue` 模块声明等 Vite 客户端类型 |
| `strict` | 三份全开（含 `strictNullChecks`、`noImplicitAny` 等），全仓库同一严格标准 |
| `noEmit` | 三份全开：**tsc 只做类型检查不产文件**，产物一律交给 electron-vite/Vite 生成 |
| `esModuleInterop` | 允许 `import fs from 'node:fs'` 这类默认导入写法（配合 CJS 内置模块） |
| `skipLibCheck` | 跳过 `.d.ts` 内部一致性检查，加快检查速度并规避第三方声明冲突 |
| `forceConsistentCasingInFileNames` | 文件名大小写必须一致，避免 Windows 开发 / 大小写敏感环境构建结果不一致 |
| `paths` | 仅供**类型解析**使用；运行时/打包时的真实解析由 `electron.vite.config.ts` 的 `resolve.alias` 负责 |

### 2.4 include 范围对照

| 文件 | include | 覆盖的源码 |
| --- | --- | --- |
| `tsconfig.node.json` | `electron.vite.config.ts`、`src/main/**/*.ts`、`src/preload/**/*.ts`、`src/shared/**/*.ts` | 主进程、preload、共享模块，**外加构建配置本身** |
| `tsconfig.web.json` | `src/renderer/src/**/*.ts`、`src/renderer/src/**/*.vue`、`src/preload/index.d.ts`、`src/shared/**/*.ts` | 渲染层 TS + Vue SFC，preload 的**类型声明文件**，共享模块 |
| `tsconfig.agent.json` | `src/agent/**/*.ts` | 仅 agent 目录 |

重叠部分：`src/shared/**/*.ts` 同时属于 node 与 web 两个项目（有意为之——共享模块必须同时对两端类型成立）。

三份配置都**没有** `exclude` 字段。

## 3. 关键流程或约定

### 3.1 `typecheck` 脚本的实际执行路径

`package.json` 的 `typecheck` 脚本是：

```
tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.agent.json
```

即**三条独立的 `tsc -p` 顺序执行**（`&&` 短路，任一失败即停）：

1. 先查主进程 + preload + shared + 构建配置；
2. 再查 renderer（含 `.vue`）+ `index.d.ts` + shared；
3. 最后查 agent。

### 3.2 为什么不用 `tsc -b`

- `tsc -b`（build 模式）针对 project references，要求被引用项目具备 `composite: true`，且**默认需要产出 `.d.ts` / `.tsbuildinfo`**。
- 而三份子配置全都写了 `noEmit: true`，与 build 模式的产物要求冲突，直接跑 `tsc -b` 会报配置错误。
- 因此采用**三次 `-p` 显式检查**：语义等价于「逐项目全量类型检查」，但不写任何文件、不产生 `tsbuildinfo`，与 `noEmit` 的取向一致。
- 根 `tsconfig.json` 的 `references` 仍然保留，作用只是**声明项目结构与边界**（供编辑器/工具理解），不代表构建管线会走 `-b`。

### 3.3 目录职责约定

| 目录 | 归属项目 | 备注 |
| --- | --- | --- |
| `src/main/**` | node | 主进程 |
| `src/preload/**`（除 `index.d.ts`） | node | preload 实现 |
| `src/preload/index.d.ts` | **web**（同时在 node 的 glob 覆盖下） | 渲染层的全局类型来源 |
| `src/shared/**` | node **和** web | 双端共享 |
| `src/renderer/src/**` | web | 渲染层 |
| `src/agent/**` | agent（独占） | 不属于 node / web 任何一份 |

## 4. 与其他文件的关系

| 关联文件 | 关系 |
| --- | --- |
| `package.json` | `typecheck` 脚本按 `-p tsconfig.node.json` → `-p tsconfig.web.json` → `-p tsconfig.agent.json` 顺序调用 |
| `electron.vite.config.ts` | 被 `tsconfig.node.json` 的 `include` 纳入（自身也受检）；其 `resolve.alias` 的 `@renderer` / `@shared` 与 web 的 `paths` **必须成对维护** |
| `src/preload/index.d.ts` | web 项目 include 的关键一项，向 renderer 提供 `window.electronAPI` / `window.voiceTools` 等全局类型 |
| `src/shared/types.ts`、`src/shared/ipc.ts` | 被 node/web 两个项目共同 include 的共享类型层 |
| `src/agent/index.ts` + `src/agent/package.json` | agent 项目的全部输入；后者用 `{"type":"module"}` 让该目录按 ESM 解析 |
| `src/renderer/src/env.d.ts` | renderer 的补充类型声明，落在 web 的 include glob 内 |

## 5. 注意事项与实现要点

### 5.1 为什么 web 必须显式 include `src/preload/index.d.ts`

- `index.d.ts` 用的是 `declare global { interface Window extends PreloadApi {} }` 写法（`PreloadApi` 从 `src/shared/types.ts` 引入，配合文件末尾的 `export {}`），属于**全局类型增强**。
- 全局声明的生效前提是：该文件**被当前项目 `include` 到**。仅靠「在同一条相对路径被 import」是不够的。
- 而它物理上位于 `src/preload/`，**不在** web 的 `src/renderer/src/**` glob 覆盖范围内；若不单独列出，renderer 里所有 `window.electronAPI`、`window.voiceTools`、`window.projectTools` 等访问都会报「属性不存在」。
- 这也是 web 项目**不能**简单 include `src/preload/**/*.ts` 的原因：那会把 preload 的实现文件也拉进来（它面向 Node/Electron 环境），只需类型声明这一份。

### 5.2 为什么 agent 单独一份配置

- `src/agent/**` **不在** node 项目的 include（只有 main/preload/shared），也**不在** web 项目的 include 里——若没有 `tsconfig.agent.json`，这块代码将完全脱离类型检查。
- agent 的运行环境是独立 Node 子进程，只用 Node 能力、不用 Vite 别名，所以它**没有 `paths`**，`types` 为 `["node"]`。
- 单独一份还带来了边界好处：agent 目录里的类型错误不会被淹没在主进程的大量文件里，定位更快。

### 5.3 其他要点

- 三份子配置**均为 `noEmit: true`**：类型检查与产物生成彻底解耦，产物只由 electron-vite/Vite 输出。
- `paths` **只是类型承诺**：若某个别名只写进了 tsconfig 而漏在 `electron.vite.config.ts` 里，编译期通过、运行期报模块找不到。
- `src/shared/**/*.ts` 被两个项目同时检查，意味着共享代码必须**同时**满足 Node 与浏览器两套 `lib`/`types`——不要在 shared 里使用 Node 专属 API。
- 根 `tsconfig.json` 的 `files: []` 是关键：若省略，TypeScript 会退化为「包含目录下所有文件」，导致根配置意外吞掉全部源码。
- 三份配置写法上一处刻意的差异：只有 web 的 `lib` 含 `DOM.Iterable`，只有 web 的 `types` 是 `vite/client`——修改时不要「为了统一」把它们抹平。
