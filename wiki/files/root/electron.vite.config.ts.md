# electron.vite.config.ts

> 三端构建配置：main/preload 外部化依赖，renderer 相对基址 + dev CSP 注入 + 品牌占位符注入

- **位置**：工程根
- **类型**：构建配置（electron-vite / Vite）
- **规模**：98 行

## 1. 作用与职责

本文件是 `electron-vite` 的**唯一构建配置**，用 `defineConfig` 同时描述三个构建目标：

- **`main`**：主进程（`src/main`）→ `out/main`。
- **`preload`**：预加载脚本（`src/preload`）→ `out/preload`。
- **`renderer`**：渲染层（`src/renderer`，Vue SFC）→ `out/renderer`。

文件顶部用注释把三端的核心决策写在代码旁（第 1–7 行）：

| 注释行 | 内容 |
| --- | --- |
| 第 2 行 | main/preload 用 `externalizeDepsPlugin` 保持 openai/opencc-js 等依赖为运行时 require（不内联进 bundle） |
| 第 3 行 | renderer 用 `base './'` 使产物资源用相对路径（`loadFile(file://)` 可加载）；`@renderer`/`@shared` 别名 |
| 第 4–5 行 | dev 专属：`strictPort` 固定 5173（冲突即报错）；`cspDevWsPlugin` 按环境注入 CSP 的 `connect-src` ws 源 |
| 第 6–7 行 | 品牌：`brandHtmlPlugin` 把 `src/shared/constants.ts` 的应用名注入 `index.html`（静态 HTML 无法 import TS）；`checkBrandConsistency` 校验 `package.json` 的 `productName` 与该常量一致 |

此外文件内联了**两个自定义 Vite 插件**（`cspDevWsPlugin()`、`brandHtmlPlugin()`）与一个**配置加载期执行的校验函数** `checkBrandConsistency()`。

## 2. 内容详解

### 2.1 导入

| 导入 | 来源 | 用途 |
| --- | --- | --- |
| `defineConfig` | `electron-vite` | 定义三端配置对象（带类型提示） |
| `externalizeDepsPlugin` | `electron-vite` | 把 `dependencies` 排除出 bundle，保留运行时 `require` |
| `vue` | `@vitejs/plugin-vue` | 编译 renderer 的 `.vue` 单文件组件 |
| `readFileSync` | `node:fs` | `checkBrandConsistency()` 读 `package.json`（JSON 无法 import TS，只能运行时读） |
| `resolve` | `node:path` | 把别名目标解析为绝对路径；`resolve('package.json')` 定位工程根清单 |
| `Plugin`（type-only） | `vite` | 两个自定义插件的返回类型标注 |
| `APP_NAME`、`APP_NAME_EN`、`APP_SLOGAN_SHORT` | `./src/shared/constants` | 品牌文案唯一来源（构建配置是它的第四个消费端）：前两个注入 HTML，`APP_NAME_EN` 另用于 `productName` 一致性校验 |

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
| `plugins` | `[vue(), brandHtmlPlugin(), cspDevWsPlugin()]` | 先编译 Vue SFC，再注入品牌占位符，最后按环境改写 HTML 的 CSP（两个 `transformIndexHtml` 都是 `order: 'pre'`，按数组顺序执行） |

### 2.5 cspDevWsPlugin 实现细节（第 18–36 行）

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

### 2.6 brandHtmlPlugin 实现细节（第 41–54 行）—— 品牌文案注入

`index.html` 是**静态标记**（启动画面必须在「Vue 还没挂载」时就能显示），无法 `import` TS 常量，因此把品牌文案写成占位符、由本插件在 dev/build 期替换成 `src/shared/constants.ts` 的值：

| 要素 | 值 | 说明 |
| --- | --- | --- |
| `name` | `'dsh:brand-html'` | 插件标识（`dsh:` 前缀与 `cspDevWsPlugin` 同一命名习惯） |
| `apply` | 未声明 | **dev 与 build 都生效**（与 `cspDevWsPlugin` 的 `apply: 'serve'` 相反）——产物里的标题与启动画面必须已是最终文案 |
| `transformIndexHtml.order` | `'pre'` | **早于 Vite 自带的 `%VITE_*%` 替换**，保证 `%APP_*%` 占位符一定先被吃掉、不会残留到产物里 |
| `handler(html)` | 函数 | 只做三次 `replaceAll`，不解析 DOM，保持零依赖 |
| `%APP_NAME%` | → `APP_NAME` | `<title>` 前半段与启动画面 `.boot-title` |
| `%APP_NAME_EN%` | → `APP_NAME_EN` | `<title>` 后半段与启动画面 `.boot-sub` 前缀 |
| `%APP_SLOGAN_SHORT%` | → `APP_SLOGAN_SHORT` | 启动画面 `.boot-sub` 的口号段（短位文案，避免窄位换行） |

> 用 `replaceAll` 而不是正则或 `replace`：占位符在多处出现（`<title>` 与启动画面），必须全部替换；`replaceAll` 也避免了正则里 `$` 之类的转义陷阱。

### 2.7 checkBrandConsistency()（第 58–72 行）—— `productName` 一致性告警

`package.json` 的 `build.productName`（决定安装包与 `ShadowMill.exe` 的名字）是 **JSON，无法 `import` TS 常量**，所以「改了常量却忘了改它」这类漂移只能在配置加载期兜住：

| 要素 | 值 | 说明 |
| --- | --- | --- |
| 执行时机 | **配置加载时执行一次**（函数定义后立即 `checkBrandConsistency()` 调用，位于 `export default defineConfig` 之前） | 因此 `npm run dev` / `npm run build` 各校验一次 |
| 读取 | `JSON.parse(readFileSync(resolve('package.json'), 'utf8'))` | 从工程根读清单，`resolve` 相对当前工作目录解析 |
| 比较 | `pkg.build?.productName !== APP_NAME_EN` | 仅当 `productName` 存在且不一致时告警（缺字段不报） |
| 行为 | `console.warn('[dsh:brand] …')` | **只告警、不抛错**：`try/catch` 包住整段，`package.json` 不可读等异常静默忽略，「校验失败不影响构建」 |
| 告警文案 | `'[dsh:brand] package.json 的 build.productName = <productName>，与 src/shared/constants.ts 的 APP_NAME_EN = <APP_NAME_EN> 不一致，请同步。'` | 两处值都打印出来，便于直接对照修改 |

> 这里刻意**不用 `throw`**：构建期的品牌漂移不会导致功能损坏（只是安装包名与界面英文名不一致），让构建因一个文案问题失败不合适；`warn` 足以在 CI/终端日志里被发现。

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

### 3.4 品牌文案注入流程（dev 与 build 相同）

1. Vite 读取 `src/renderer/index.html` 原文（含 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`）。
2. `brandHtmlPlugin` 的 `transformIndexHtml`（`order: 'pre'`）先把三个占位符替换成 `./src/shared/constants` 的常量值——`replaceAll`，全部出现处都换。
3. 之后的 `%VITE_*%` 替换阶段再也不会看到 `%APP_*%`（已被吃掉）；**dsh 前缀的 `pre` 顺序是这条链路的保证**。
4. dev 下再由 `cspDevWsPlugin` 追加实际 `ws://` 源；build 下 CSP 保持 `index.html` 的字面值。
5. 同一份配置加载时，`checkBrandConsistency()` 已比对过 `package.json` 的 `build.productName` 与 `APP_NAME_EN`，不一致会在终端打印 `[dsh:brand] …` 告警。

> 顺序为何是 `pre` 而不是 `post`：`post` 阶段 Vite 自己的 HTML 替换可能已经处理过（或重排过）内容，占位符解析结果不再可靠；放 `pre` 等于「先把品牌文案定死，再让 Vite 做它的事」。

## 4. 与其他文件的关系

| 关联文件 | 关系 |
| --- | --- |
| `package.json` | 提供 `dev` / `build` / `start` 三个脚本调用 electron-vite；`dependencies` 清单正是 `externalizeDepsPlugin` 的作用对象，也决定了 `build.files` 里要显式保留 `openai` / `opencc-js`；其 `build.productName` 由 `checkBrandConsistency()` 与 `APP_NAME_EN` 比对，**两者必须一致** |
| `src/shared/constants.ts` | 三个品牌常量（`APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN_SHORT`）的来源；本文件是它的**第四个消费端**（构建期注入 HTML + 校验 JSON），也是改品牌名清单里的第 2、3 步之间的桥 |
| `tsconfig.node.json` | 本文件（`electron.vite.config.ts`）被其 `include` 明确纳入，因此配置文件本身也受 `strict` 检查 |
| `tsconfig.web.json` | `paths` 中的 `@renderer/*`、`@shared/*` 与本文件 `resolve.alias` 一一对应 |
| `src/renderer/index.html` | 内含 CSP `meta`，是 `cspDevWsPlugin` 的改写目标（其中必须有 `connect-src` 指令，否则正则不匹配、替换不会发生）；同时是 `brandHtmlPlugin` 的改写目标——它的 `<title>` 与启动画面写 `%APP_*%` 占位符，**不要改成品牌字面量** |
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
- **品牌占位符必须留在 `index.html` 里**：`brandHtmlPlugin` 只做字符串替换，若有人把 `<title>` 或启动画面改回「影坊 / ShadowMill」字面量，本插件不会报错、只是那处不再跟随常量（静默漂移）。改品牌时的正确做法是只改 `src/shared/constants.ts`。
- **`brandHtmlPlugin` 与 `cspDevWsPlugin` 都是 `order: 'pre'`、按数组顺序执行**：数组里 `brandHtmlPlugin()` 在前，因此品牌替换早于 CSP 改写；两者互不依赖，但调整顺序前先确认没有相互覆盖的字符串（当前没有）。
- **`checkBrandConsistency()` 只告警不阻断**：它用 `try/catch` 包住整段，`package.json` 读不到或解析失败时静默跳过（「校验失败不影响构建」）。因此**不要把 `[dsh:brand]` 当成可忽略的噪音**——它出现就意味着安装包名与界面英文名已经不一致。
- **`readFileSync(resolve('package.json'))` 依赖工作目录**：`resolve` 相对当前进程工作目录解析，因此本配置须由 `electron-vite` 从工程根加载（`npm run dev` / `build` 的默认行为）；从其它目录直接执行会读不到清单、静默跳过校验。
