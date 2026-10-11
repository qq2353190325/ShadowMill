# src/renderer/index.html

> 渲染层 HTML 宿主：承载 CSP、#app 挂载点与 Vue 模块入口

- **所在目录**：`src/renderer/`
- **类型**：HTML 宿主（Vite 的 renderer 入口页）
- **规模**：12 行
- **对外导出**：无模块导出；对外提供两个契约——DOM 挂载点 `#app` 与模块脚本 `/src/main.ts`

## 1. 作用与职责

本文件是整个渲染进程的**唯一 HTML 宿主**，由 electron-vite 交给 Vite 作为 renderer 端的 `index.html` 处理。它只承担四件事：

1. 声明文档为中文页面（`<html lang="zh-CN">`）并固定 UTF-8 编码。
2. 用一条 `<meta http-equiv="Content-Security-Policy">` 在**页面级**声明内容安全策略，约束 Electron 渲染进程能加载哪些资源。
3. 提供 Vue 应用的挂载容器 `<div id="app"></div>`。
4. 用 `<script type="module" src="/src/main.ts">` 拉起 Vue 应用入口。

除此之外没有任何标签：没有内联脚本、没有内联样式、没有 favicon 链接，所有界面结构都由 `App.vue` 及页面组件在运行时生成。

## 2. 结构说明

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `<html lang="zh-CN">` | 属性 | 声明内容语言为简体中文 |
| `<meta charset="UTF-8" />` | meta | 字符集声明，须位于 `<head>` 顶部 |
| `<meta http-equiv="Content-Security-Policy" ... />` | meta | 全站 CSP，指令见 2.1 |
| `<title>我的应用</title>` | 元素 | 窗口/任务栏标题文本 |
| `<div id="app"></div>` | 挂载点 | `main.ts` 中 `createApp(App).mount('#app')` 的目标容器 |
| `<script type="module" src="/src/main.ts">` | 模块脚本 | ESM 入口，构建后由 Vite 改写为带 hash 的相对路径资源 |

### 2.1 CSP 指令逐条对照

原始策略为：

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data:;
frame-src file: hgpreview:; media-src 'self' file:; script-src 'self' 'unsafe-inline';
connect-src 'self' ws://localhost:5173
```

| 指令 | 取值 | 含义与配置原因 |
| --- | --- | --- |
| `default-src` | `'self'` | 兜底策略：未显式列出的资源类型只允许同源。因此字体（`font-src`）与后续可能新增的类型都被限制为打包进产物的本地资源，不允许外链 CDN |
| `style-src` | `'self' 'unsafe-inline'` | 允许同源样式表与**内联样式**。Vue SFC 的 `<style scoped>` 在运行时会以 `<style>` 标签注入，组件上也大量使用行内 `style`（如 StepBar 的 `width:210px`），故必须放开 `'unsafe-inline'` |
| `img-src` | `'self' file: data:` | 图片允许同源、本地 `file:` 与 `data:`（占位图/内联图）。`file:` 是必需的：项目素材与预览缩略图直接来自磁盘路径 |
| `frame-src` | `file: hgpreview:` | 限定 iframe 可加载的源。`file:` 用于生产环境（`loadFile` 后同属 file 源）直接内嵌本地 HTML；`hgpreview:` 是主进程注册的预览专用协议，用于 dev 下绕过 Chromium 对 `http://localhost` 页面加载 `file://` iframe 的拦截 |
| `media-src` | `'self' file:` | 音视频只允许同源与本地文件，禁止网络流媒体（配音试听、视频预览均为本地文件） |
| `script-src` | `'self' 'unsafe-inline'` | 允许同源脚本与内联脚本。dev 下 Vite 会注入内联模块脚本/HMR 引导代码；生产构建产物为 `'self'` 的本地 JS |
| `connect-src` | `'self' ws://localhost:5173` | XHR/fetch/WebSocket 目标。`ws://localhost:5173` 专为开发期 HMR 的 WebSocket 通道预留 |

> CSP 是静态 meta，而 dev server 端口由 Vite 决定，因此 `electron.vite.config.ts` 中的 `cspDevWsPlugin` 在 **dev（`apply: 'serve'`）** 的 `transformIndexHtml` 阶段读取 `server.resolvedUrls`，把实际的 `ws://` 源补进 `connect-src`（已包含则不重复追加）。构建产物保持本文件的字面值不变。

## 3. 关键流程

1. **开发模式**：主进程 `createWindow()` 检测到 `ELECTRON_RENDERER_URL`，调用 `loadURL(...)` 指向 `127.0.0.1:5173`；Vite 读取本文件，`cspDevWsPlugin` 先修正 `connect-src`，再注入 HMR 客户端。
2. **生产模式**：主进程调用 `loadFile('../renderer/index.html')` 加载构建产物；因 `electron.vite.config.ts` 设置了 `renderer.base = './'`，构建后的 script src 为相对路径，可在 `file://` 下正确解析。
3. **解析阶段**：浏览器按 meta 建立 CSP，允许同源的 CSS/JS 加载。
4. **执行阶段**：`/src/main.ts` 作为 ES module 执行，`createApp(App).mount('#app')` 把根组件渲染进 `<div id="app">`，页面骨架（标题栏、侧边栏、内容区、Toast 宿主）全部由 `App.vue` 生成。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 被使用 | `src/main/index.ts` | dev 经 `ELECTRON_RENDERER_URL`、prod 经 `loadFile` 加载本页 |
| 被使用 | `electron.vite.config.ts` | renderer 端入口页；`base: './'` 与 `cspDevWsPlugin` 都作用于本文件 |
| 依赖 | `/src/main.ts` | 唯一的模块脚本入口 |
| 契约 | `hgpreview:` 协议 | `frame-src` 中的自定义协议由 `src/main/index.ts` 注册并在应用 ready 后 `protocol.handle` |
| 无依赖 | 无第三方 CDN | CSP 未放开任何外部源，所有依赖必须打进产物 |

## 5. 注意事项与实现要点

- **CSP 是安全边界，不是装饰**：窗口使用 `contextIsolation: true` + `nodeIntegration: false`，渲染层只能通过 preload 暴露的命名空间访问主进程能力；CSP 进一步限制资源来源。新增外链资源（CDN 字体、在线图床）必须先改这里，否则会被静默拦截。
- **`'unsafe-inline'` 的必要性**：Vue 运行时注入的 `<style>` 与组件行内 style 都依赖它。移除会导致整个界面丢样式。
- **`img-src`/`media-src` 必须含 `file:`**：本地素材按绝对路径直接引用，缺 `file:` 时预览会出现"图片/音频不显示但无报错"的现象。
- **端口写死的风险与兜底**：`ws://localhost:5173` 与 `electron.vite.config.ts` 中固定的 `127.0.0.1:5173`/`strictPort: true` 相配套——端口被占用时 Vite 直接报错而不是静默换端口，避免 Electron 仍指向 5173 导致白屏。
- **挂载点不可改名**：`#app` 必须与 `main.ts` 的 `mount('#app')` 逐字一致。
- **本文件不含业务逻辑**：所有标题栏、菜单、Toast 结构都由 `App.vue` 在客户端生成，此处只保留最小外壳。
