# electron.vite.config.ts

> 三端构建配置：main/preload 外部化依赖，renderer 相对基址 + dev CSP 注入

- **位置**：工程根
- **类型**：构建配置（electron-vite / Vite）
- **规模**：58 行

## 1. 作用与职责

本文件是 `electron-vite` 的**唯一构建配置**，用 `defineConfig` 同时描述三个构建目标：

- **`main`**：主进程（`src/main`）→ `out/main`。
- **`preload`**：预加载脚本（`src/preload`）→ `out/preload`。
- **`renderer`**：渲染层（`src/renderer`，Vue SFC）→ `out/renderer`。

文件顶部用 3 行注释把三端的核心决策写在代码旁（第 1–5 行）：

| 注释行 | 内容 |
| --- | --- |
| 第 2 行 | main/preload 用 `externalizeDepsPlugin` 保持 openai/opencc-js 等依赖为运行时 require（不内联进 bundle） |
| 第 3 行 | renderer 用 `base './'` 使产物资源用相对路径（`loadFile(file://)` 可加载）；`@renderer`/`@shared` 别名 |
| 第 4–5 行 | dev 专属：`strictPort` 固定 5173（冲突即报错）；`cspDevWsPlugin` 按环境注入 CSP 的 `connect-src` ws 源 |

此外文件内联了一个**自定义 Vite 插件** `cspDevWsPlugin()`，解决「静态 CSP meta」与「动态 dev server 端口」的矛盾。

## 2. 内容详解

### 2.1 导入

| 导入 | 来源 | 用途 |
| --- | --- | --- |
| `defineConfig` | `electron-vite` | 定义三端配置对象（带类型提示） |
| `externalizeDepsPlugin` | `electron-vite` | 把 `dependencies` 排除出 bundle，保留运行时 `require` |
| `vue` | `@vitejs/plugin-vue` | 编译 renderer 的 `.vue` 单文件组件 |
| `resolve` | `node:path` | 把别名目标解析为绝对路径 |
| `Plugin`（type-only） | `vite` | `cspDevWsPlugin` 的返回类型标注 |

### 2.2 main 段

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `plugins` | `[externalizeDepsPlugin()]` | 主进程代码**不内联** `dependencies`，产物中保留 `require('openai')` 等；因此打包时必须在 asar 内保留这些包 |

### 2.3 preload 段

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `plugins` | `[externalizeDepsPlugin()]` | 与 main 同理；preload 在沙箱环境中运行，外部化后由 Node 的 require 解析依赖 |

### 2.4 renderer 段

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `base` | `'./'` | 产物资源引用改为**相对路径**。生产环境用 `loadFile(...)` 以 `file://` 协议加载 `out/renderer/index.html`，绝对路径 `/assets/...` 会解析到磁盘根而 404 |
| `server.host` | `'127.0.0.1'` | dev server 仅绑定本机回环地址 |
| `server.port` | `5173` | dev server 端口固定为 5173 |
| `server.strictPort` | `true` | 端口被占用时**直接失败**，不自动顺延到 5174 |
| `resolve.alias['@renderer']` | `resolve('src/renderer/src')` | 渲染层源码根别名，与 `tsconfig.web.json` 的 `paths` 一致 |
| `resolve.alias['@shared']` | `resolve('src/shared')` | 跨端共享模块别名，与三份 tsconfig 的 `@shared/*` 一致 |
| `plugins` | `[vue(), cspDevWsPlugin()]` | 先编译 Vue SFC，再按环境改写 HTML 的 CSP |

### 2.5 cspDevWsPlugin 实现细节（第 14–32 行）

| 要素 | 值 | 说明 |
| --- | --- | --- |
| `name` | `'dsh:csp-dev-ws'` | 插件标识 |
| `apply` | `'serve'` | **只在 dev server 模式生效**；`build` 阶段该插件完全不参与，生产 HTML 原样输出 |
| `transformIndexHtml.order` | `'pre'` | 在其它 HTML 变换插件**之前**执行，保证改写的是原始 CSP 文本 |
| `handler(html, ctx)` | 函数 | 接收 HTML 与上下文，返回改写后的 HTML |
| `ctx.server?.resolvedUrls?.local?.[0]` | dev server 实际地址 | 拿 Vite 解析后的真实本地地址（含实际端口）；取不到则原样 `return html` |
| `new URL(devUrl).origin` | 源 | 用 `URL` 解析而非字符串截取，正确处理 IPv6 形式 host（如 `http://[::1]:5173/`） |
| `.replace(/^http/, 'ws')` | `http→ws` | 将协议后缀替换为 ws；`^` 锚定开头，避免误伤路径中的 `http` |
| 替换正则 | `/(connect-src[^;"]*)/` | 匹配 CSP 中 `connect-src` 指令值，直到 `;` 或引号为止 |
| 回调逻辑 | `group.includes(wsOrigin) ? group : group + ' ' + wsOrigin` | 已有该 ws 源则不重复追加，否则追加在指令末尾 |
| 注释里的取舍 | 「ws 无加密分支，故直接换协议」 | dev server 是明文 http，对应 ws；不需要 wss |

## 3. 关键流程或约定

### 3.1 开发期 CSP 注入流程

1. Vite dev server 启动，绑定 `127.0.0.1:5173`（`strictPort: true` 保证不变）。
2. Vite 解析出实际本地地址写入 `server.resolvedUrls.local[0]`。
3. `transformIndexHtml`（order: `pre`）拿到 `index.html` 原文。
4. 从实际地址取 `origin`，把 `http` 前缀换成 `ws`，得到如 `ws://127.0.0.1:5173`。
5. 在 `connect-src ...` 指令后追加该源（若已存在则跳过）。
6. 浏览器按更新后的 CSP 放行 HMR 的 WebSocket 连接。

### 3.2 dev server 地址为何必须固定 5173

- Electron 主进程在开发模式要加载一个**写死或由 electron-vite 约定**的 URL（`localhost:5173`）。
- 若允许 Vite 在端口冲突时「偷偷」换到 5174，主进程仍会去连 5173 → 表现为**白屏 + `ERR_EMPTY_RESPONSE`**，且排错成本高。
- 因此配置 `strictPort: true` + 注释里的原则：「宁可响亮报错，也不要偷偷换端口」。**冲突即启动失败**，错误立即可见。

### 3.3 别名必须双处同步

`resolve.alias` 的 `@renderer` / `@shared` 与 `tsconfig.web.json` 的 `paths`（以及 `tsconfig.node.json` 的 `@shared/*`）是**两套独立机制**：

- Vite 侧负责**运行/打包时**的解析；
- tsconfig 侧负责**类型检查时**的解析。

只改一边会导致「能跑但类型报错」或反之，必须成对维护。

## 4. 与其他文件的关系

| 关联文件 | 关系 |
| --- | --- |
| `package.json` | 提供 `dev` / `build` / `start` 三个脚本调用 electron-vite；`dependencies` 清单正是 `externalizeDepsPlugin` 的作用对象，也决定了 `build.files` 里要显式保留 `openai` / `opencc-js` |
| `tsconfig.node.json` | 本文件（`electron.vite.config.ts`）被其 `include` 明确纳入，因此配置文件本身也受 `strict` 检查 |
| `tsconfig.web.json` | `paths` 中的 `@renderer/*`、`@shared/*` 与本文件 `resolve.alias` 一一对应 |
| `src/renderer/index.html` | 内含 CSP `meta`，是 `cspDevWsPlugin` 的改写目标；其中必须有 `connect-src` 指令，否则正则不匹配、替换不会发生 |
| `src/main/index.ts` | 生产环境用 `loadFile` 加载 `out/renderer/index.html`，这正是 `base: './'` 的原因 |
| `.gitignore` | 忽略 `out/`（本配置的构建输出） |

## 5. 注意事项与实现要点

- **`externalizeDepsPlugin` 只管 `dependencies`**：`devDependencies` 里的包仍会被打进 bundle。新增运行期 `require` 的库时必须放进 `dependencies`，否则既不会内联，也不会被解析到。
- **外部化的连带责任**：一旦依赖被外部化，打包白名单（`package.json` 的 `build.files`）就必须补上对应的 `node_modules/<pkg>/**/*`，两处是联动的。
- **`cspDevWsPlugin` 是 dev-only**：`apply: 'serve'` 保证生产构建不受影响，生产 CSP 保持静态文本。
- **正则的脆弱点**：`/(connect-src[^;"]*)/` 依赖 `index.html` 中的 CSP 写法是标准 `指令 值;` 形式；若把 CSP 移出 meta（例如改为响应头注入），该插件将静默失效（取不到匹配就返回原 HTML）。
- **`order: 'pre'` 不可省**：若放到 `post`，其它插件可能已重排/注入过 HTML 内容，正则匹配结果不再可靠。
- **IPv6 场景**：`origin` 可能是 `http://[::1]:5173`，所以必须走 `new URL()` 而不是 `devUrl.split(':')` 之类的字符串截取。
- **别名必须与 tsconfig 同步**：`@renderer` → `src/renderer/src`、`@shared` → `src/shared`，改动需同时改 `tsconfig.web.json`（及 `tsconfig.node.json` 的 `@shared/*`）。
- **配置自身也参与 typecheck**：本文件在 `tsconfig.node.json` 的 `include` 中，`npm run typecheck` 会一并检查它。
