# src/renderer/index.html

> 渲染层 HTML 宿主：承载 CSP、#app 挂载点、启动画面（品牌文案走构建期占位符注入）与 Vue 模块入口

- **所在目录**：`src/renderer/`
- **类型**：HTML 宿主（Vite 的 renderer 入口页）
- **规模**：103 行（其中启动画面的内联样式与标记约 76 行）
- **对外导出**：无模块导出；对外提供三个契约——DOM 挂载点 `#app`、启动画面 `#boot-splash` 与模块脚本 `/src/main.ts`

## 1. 作用与职责

本文件是整个渲染进程的**唯一 HTML 宿主**，由 electron-vite 交给 Vite 作为 renderer 端的 `index.html` 处理。它承担六件事：

1. 声明文档为中文页面（`<html lang="zh-CN">`）并固定 UTF-8 编码。
2. 用一条 `<meta http-equiv="Content-Security-Policy">` 在**页面级**声明内容安全策略，约束 Electron 渲染进程能加载哪些资源。
3. 提供 Vue 应用的挂载容器 `<div id="app"></div>`。
4. 提供**启动画面** `<div id="boot-splash">`（见 2.3）：它由 HTML 直接渲染、不依赖任何脚本，用来填掉「窗口已出现、Vue 还没挂载」那段空背景。
5. 用 `<script type="module" src="/src/main.ts">` 拉起 Vue 应用入口。
6. 用 **`%APP_*%` 占位符**声明全部品牌文案（窗口标题 + 启动画面），由构建期注入（见 2.2）——本文件**不写任何品牌字面量**。

除启动画面外没有其它界面结构：所有标题栏、菜单、Toast 都由 `App.vue` 及页面组件在运行时生成。

## 2. 结构说明

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `<html lang="zh-CN">` | 属性 | 声明内容语言为简体中文 |
| `<meta charset="UTF-8" />` | meta | 字符集声明，须位于 `<head>` 顶部 |
| `<meta http-equiv="Content-Security-Policy" ... />` | meta | 全站 CSP，指令见 2.1 |
| `<title>%APP_NAME% %APP_NAME_EN%</title>` | 元素 | 窗口/任务栏标题文本（中文名 + 英文名并列），占位符构建期替换为 `影坊 ShadowMill` |
| `<style>`（head 内） | 元素 | 启动画面的自包含样式；不引用 `main.css` 的 CSS 变量（那份样式由 JS 侧注入，启动画面必须自包含） |
| `<div id="app"></div>` | 挂载点 | `main.ts` 中 `createApp(App).mount('#app')` 的目标容器 |
| `<div id="boot-splash">` | 启动画面 | 见 2.3；置于 `#app` **之外**，Vue 挂载清空 `#app` 内容时不受影响 |
| `<script type="module" src="/src/main.ts">` | 模块脚本 | ESM 入口，构建后由 Vite 改写为带 hash 的相对路径资源 |

### 2.1 CSP 指令逐条对照

原始策略为（`hgpreview:` 已在 `img-src` / `frame-src` / `media-src` 三处放行）：

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: hgpreview: data:;
frame-src file: hgpreview:; media-src 'self' file: hgpreview:; script-src 'self' 'unsafe-inline';
connect-src 'self' ws://localhost:5173
```

| 指令 | 取值 | 含义与配置原因 |
| --- | --- | --- |
| `default-src` | `'self'` | 兜底策略：未显式列出的资源类型只允许同源。因此字体（`font-src`）与后续可能新增的类型都被限制为打包进产物的本地资源，不允许外链 CDN |
| `style-src` | `'self' 'unsafe-inline'` | 允许同源样式表与**内联样式**。Vue SFC 的 `<style scoped>` 在运行时会以 `<style>` 标签注入，组件上也大量使用行内 `style`（如 StepBar 的 `width:210px`），故必须放开 `'unsafe-inline'`；启动画面的内联 `<style>` 同样依赖它 |
| `img-src` | `'self' file: hgpreview: data:` | 图片允许同源、本地 `file:`、**`hgpreview:` 应用内协议**与 `data:`（占位图/内联图）。`file:` 是必需的：本地素材与试听图直接来自磁盘路径；**`hgpreview:` 是本轮为「HTML生成页」的素材缩略图新放行的**——`MaterialsSection.vue` 的 `thumbUrl()` 把图片素材拼成 `hgpreview://p/<项目名>/<相对路径>` 交给 `<img :src>`，dev 态 http 页面下 `file://` 会被 Chromium 拦截，因此缩略图与预览 iframe 走同一条自定义协议（见 2.4） |
| `frame-src` | `file: hgpreview:` | 限定 iframe 可加载的源。`file:` 用于生产环境（`loadFile` 后同属 file 源）直接内嵌本地 HTML；`hgpreview:` 是主进程注册的预览专用协议，用于 dev 下绕过 Chromium 对 `http://localhost` 页面加载 `file://` iframe 的拦截 |
| `media-src` | `'self' file: hgpreview:` | 音视频只允许同源、本地 `file:` 与**应用内协议 `hgpreview:`**，禁止网络流媒体。**`hgpreview:` 是成品视频与音频试听必需的**：`<video>` 走 `hgpreview://p/…`（视频预览页），`<audio>` 走 `hgpreview://p/…`（项目内背景音频试听）与 `hgpreview://tts/…?tts=1`（项目外语音产物试听），均见 2.4；缺它的表现是**媒体被静默拦掉**（视频全黑且连原生控件都不画、音频无声）。**素材库不涉及媒体请求**：视频卡片刻意不抽帧，只用 `▶` 字符标记（见 2.4） |
| `script-src` | `'self' 'unsafe-inline'` | 允许同源脚本与内联脚本。dev 下 Vite 会注入内联模块脚本/HMR 引导代码；生产构建产物为 `'self'` 的本地 JS |
| `connect-src` | `'self' ws://localhost:5173` | XHR/fetch/WebSocket 目标。`ws://localhost:5173` 专为开发期 HMR 的 WebSocket 通道预留 |

> CSP 是静态 meta，而 dev server 端口由 Vite 决定，因此 `electron.vite.config.ts` 中的 `cspDevWsPlugin` 在 **dev（`apply: 'serve'`）** 的 `transformIndexHtml` 阶段读取 `server.resolvedUrls`，把实际的 `ws://` 源补进 `connect-src`（已包含则不重复追加）。构建产物保持本文件的字面值不变。

### 2.2 品牌文案占位符（构建期注入）

HTML 是**静态标记、无法 `import` TS 常量**，而启动画面必须在「Vue 还没挂载」时就能显示，不能等 JS 把文案填进去。因此本文件的品牌文案一律写成占位符，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()` 在 dev/build 期替换成 `src/shared/constants.ts` 的值：

| 占位符 | 出现位置 | 注入后的值（当前品牌） | 常量来源 |
| --- | --- | --- | --- |
| `%APP_NAME%` | `<title>`；启动画面 `.boot-title` | `影坊` | `APP_NAME` |
| `%APP_NAME_EN%` | `<title>`；启动画面 `.boot-sub`（前缀） | `ShadowMill` | `APP_NAME_EN` |
| `%APP_SLOGAN_SHORT%` | 启动画面 `.boot-sub`（`%APP_NAME_EN% · %APP_SLOGAN_SHORT%`） | `音视频创作流水线` | `APP_SLOGAN_SHORT`（用短位文案，避免窄位换行） |

三个要点：

1. **`order: 'pre'`**：`brandHtmlPlugin` 的 `transformIndexHtml` 声明为 `pre`，早于 Vite 自带的 `%VITE_*%` 替换处理器，保证占位符一定先被吃掉、不会残留到产物里。
2. **改品牌名不需要动本文件**：改 `src/shared/constants.ts` 的常量即可，`<title>` 与启动画面会自动跟随；本文件里**不存在**「影坊 / ShadowMill」字面量（改品牌名的完整清单见 [shared/constants.ts.md](../shared/constants.ts.md) §4）。
3. **占位符只在构建期生效**：直接双击打开本文件（不经 Vite）会看到 `%APP_NAME%` 原文，这是预期行为——它只作为 electron-vite 的入口页被处理。

### 2.3 启动画面（`#boot-splash`）

**解决的问题**：窗口一旦创建就会立刻显示（`BrowserWindow` 默认 `show: true`），而页面从「HTML/CSS 上屏」到「Vue 挂载出内容」之间有一段空档；首屏慢时（冷启动、杀软扫描首次运行的 exe）表现为「只有一片背景，十几秒后才出现内容」。

**做法**：把这段画面写进 HTML 本身，浏览器解析到就能画出来，**不依赖 JS、不依赖 `main.css`**：

- 颜色硬编码为设计系统的值（`#0B1220` 底 + 两处青/紫径向渐变、主色 `#00D4FF`、次文字 `#8A9BB5`），因为 `main.css` 由 JS 侧注入，启动画面必须自包含。
- 主进程 `BrowserWindow.backgroundColor` 取同一个 `#0B1220`，于是「窗口出现 → 启动画面上屏」两段颜色一致，不会闪白。
- 元素固定定位 `inset: 0` + `z-index: 9999`，并带 `-webkit-app-region: drag`（此时自绘标题栏还没上屏，拖动窗口不至于无处可拖）。
- 内容：六边形 logo（呼吸动画）+ 标题 + 副标题 + 扫描条（`bootScan` 1.2s 循环）+「正在启动…」；品牌文案为 `.boot-title` = `%APP_NAME%`、`.boot-sub` = `%APP_NAME_EN% · %APP_SLOGAN_SHORT%`（构建后即「影坊」与「ShadowMill · 音视频创作流水线」）。
- 元素放在 `#app` **之外**：Vue 的 `mount('#app')` 会清空 `#app` 的子节点，若放进去会被连带删掉，失去「可控地淡出」的机会。

**收尾**：`src/renderer/src/main.ts` 在 `mount()` 之后加 `.boot-done`（`opacity: 0` + `pointer-events: none`，0.28s 过渡），300ms 后 `remove()` 掉节点。

### 2.4 `hgpreview:` 的四个用途（都与 CSP 里的一条指令对应）

| 用途 | 消费方 | 形态 | 对应 CSP 指令 |
| --- | --- | --- | --- |
| 预览 iframe | `HtmlGenPage/PreviewSection.vue` 的 `loadFrame()` | `previewUrl(项目名, relFile, true)` → `hgpreview://p/<encodeURIComponent(项目名)>/<逐段编码的 relFile>?v=<时间戳>`（`relFile` 取 `previewPath` 的文件名，兜底 `index.preview.html`） | `frame-src hgpreview:` |
| 素材缩略图 | `HtmlGenPage/MaterialsSection.vue` 的 `thumbUrl(file)` | `previewUrl(项目名, file)`（`file` 是 `project.json` 里的项目内相对引用 `images/xxx.png`），交给 `<img :src>` | `img-src hgpreview:` |
| 成品视频 | `VideoPreviewPage/index.vue` 的 `toHgPreviewUrl()` | `previewUrl(项目名, 'video/output.mp4', true)`（从 `project:load` 给的绝对路径反推最后两段），交给 `<video :src>` | `media-src hgpreview:` |
| 音频试听 | `HtmlGenPage/PreviewSection.vue` 的 `setAudioPreview()`（**项目内**背景音频）；`TextTtsPage/SynthSection.vue` / `AlignSection.vue` 的 `ttsUrl()`（**项目外**语音产物） | 前者 `previewUrl(项目名, res.audioFile, true)` → `hgpreview://p/…`；后者 `hgpreview://tts/<逐段编码的相对路径>?tts=1`（**`?tts=1` 是路由标记**：host 位的 `tts` 不进 `pathname`，主进程改按查询标记路由；只放行 `tts-output` / `voice` 白名单，认不出时 `ttsUrl()` 返回空串 ⇒ 不给试听入口），交给 `<audio :src>` | `media-src hgpreview:` |

其余三点：

- **URL 拼装只有一处**：`src/renderer/src/utils/url.ts` 的 `previewUrl()` / `ttsUrl()`（**逐段 `encodeURIComponent`、斜杠保持原样**，项目名整串编码，与主进程处理器「按段 `decodeURIComponent`」严格对应）。此前散在各页面里的 `'hgpreview://p/' + encodeURIComponent(...)` 内联拼装已全部收口——**不要照着旧写法手拼 URL**。
- **视频素材不抽帧**：卡片用 `<span class="mat-play">▶</span>` 占位（源码注释：抽帧要额外依赖，收益不抵成本），因此**素材库不产生任何媒体请求**。
- **协议本体在主进程**：`hgpreview` 由 `src/main/index.ts` 注册，**两条路由**——`p/<项目名>/<相对路径>`（`projects.projectDir(name)` 定位根目录 + 越权校验）与 `tts/<相对路径>?tts=1`（userData 下 `TTS_PREVIEW_DIRS = ['tts-output','voice']` 白名单，非白名单 403）；路径解析由 `resolveHgPreviewPath(rawUrl)` 承担，判定按「段 + 查询标记」、不看 host（见 [main/index.ts.md](../main/index.ts.md) §3.3）。本文件只负责「允许页面用它」。

## 3. 关键流程

1. **开发模式**：主进程 `createWindow()` 检测到 `ELECTRON_RENDERER_URL`，调用 `loadURL(...)` 指向 `127.0.0.1:5173`；Vite 读取本文件，两个 `transformIndexHtml` 插件按 `order: 'pre'` 依次生效——`brandHtmlPlugin` 注入品牌文案、`cspDevWsPlugin` 修正 `connect-src`，随后再注入 HMR 客户端。
2. **生产模式**：主进程调用 `loadFile('../renderer/index.html')` 加载构建产物；因 `electron.vite.config.ts` 设置了 `renderer.base = './'`，构建后的 script src 为相对路径，可在 `file://` 下正确解析。品牌占位符此时已是最终文案。
3. **解析阶段**：浏览器按 meta 建立 CSP，允许同源的 CSS/JS 加载；**此时启动画面已可绘制**（样式内联在本文件里）。
4. **执行阶段**：`/src/main.ts` 作为 ES module 执行，`createApp(App).mount('#app')` 把根组件渲染进 `<div id="app">`，页面骨架（标题栏、侧边栏、内容区、Toast 宿主）全部由 `App.vue` 生成；随后 `main.ts` 淡出并移除启动画面。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 被使用 | `src/main/index.ts` | dev 经 `ELECTRON_RENDERER_URL`、prod 经 `loadFile` 加载本页 |
| 被使用 | `electron.vite.config.ts` | renderer 端入口页；`base: './'`、`cspDevWsPlugin` 与 **`brandHtmlPlugin`（品牌占位符注入）** 都作用于本文件 |
| 依赖 | `/src/main.ts` | 唯一的模块脚本入口 |
| 协作 | `src/renderer/src/main.ts` | 挂载后加 `.boot-done` 并在 300ms 后移除 `#boot-splash`（本条是启动画面的收尾契约） |
| 协作 | `src/main/index.ts` | 该文件的 `backgroundColor: '#0B1220'` 与启动画面同色，保证「窗口 → 画面」之间不闪白 |
| 协作 | `src/shared/constants.ts` | 三个占位符的值来源（`APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN_SHORT`），经 `brandHtmlPlugin()` 注入 |
| 契约 | `hgpreview:` 协议 | `frame-src`（预览 iframe）、`img-src`（素材缩略图）与 **`media-src`（成品视频 + 音频试听）** 中的自定义协议由 `src/main/index.ts` 注册并在应用 ready 后 `protocol.handle`（**两条路由**：`p/<项目名>/…` 与 `tts/<相对路径>` 白名单）；四个消费方见 2.4 |
| 无依赖 | 无第三方 CDN | CSP 未放开任何外部源，所有依赖必须打进产物 |

## 5. 注意事项与实现要点

- **品牌文案不要在 `<title>` 或启动画面里写死**：一律用 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`。写死会让「界面里的名字」与 `src/shared/constants.ts` 各改各的，而这类漂移没有编译期提示。
- **启动画面的注释块必须保持单块闭合**：head 内 `<style>` 的注释 `/* … */` 一旦被提前闭合，后面那几行说明文字就会变成**无效 CSS 文本**；CSS 错误恢复会把它连同紧随其后的规则一起丢掉，表现是 `#boot-splash` 整条规则失效（启动画面裸奔、闪白）。改这段注释时确认只有一处 `*/`，且位于全部说明文字之后。
- **CSP 是安全边界，不是装饰**：窗口使用 `contextIsolation: true` + `nodeIntegration: false`，渲染层只能通过 preload 暴露的命名空间访问主进程能力；CSP 进一步限制资源来源。新增外链资源（CDN 字体、在线图床）必须先改这里，否则会被静默拦截。
- **`'unsafe-inline'` 的必要性**：Vue 运行时注入的 `<style>`、组件行内 style 与启动画面的内联样式都依赖它。移除会导致整个界面丢样式。
- **`img-src` / `frame-src` / `media-src` 都要含 `hgpreview:`**：`img-src` 服务素材缩略图（`MaterialsSection.vue` 的 `<img :src="thumbUrl(m.file)">`），`frame-src` 服务预览 iframe，**`media-src` 服务成品视频（`VideoPreviewPage` 的 `<video>`）与音频试听（`PreviewSection` 的背景音频、`SynthSection` / `AlignSection` 的语音产物）**；缺 `hgpreview:` 的表现都是**该元素静默不工作**——缩略图位置空白、视频全黑且连原生控件都不画、音频静默不出声（控制台只有一条 CSP 拦截、页面不报错）。
- **`file:` 只是老数据兜底，渲染层已不再拼 `file://`**：源码 CSP 注释（第 5-8 行）已改成「渲染层已不再拼 file://（见 CHANGELOG #27），`file:` 只是留给『项目里存着旧绝对路径』的老数据兜底」——即 5 处音频试听改走 `hgpreview://`（项目内背景音频 → `hgpreview://p/…`、项目外语音产物 → `hgpreview://tts/…?tts=1`）之后，`file:` 不再服务任何**现役**代码路径，只防老项目里残留的绝对路径打不开。唯一保留的 `file:///` 拼接在主进程 `src/main/video.ts:77`（不属页面资源）。
- **端口写死的风险与兜底**：`ws://localhost:5173` 与 `electron.vite.config.ts` 中固定的 `127.0.0.1:5173`/`strictPort: true` 相配套——端口被占用时 Vite 直接报错而不是静默换端口，避免 Electron 仍指向 5173 导致白屏。
- **挂载点不可改名**：`#app` 必须与 `main.ts` 的 `mount('#app')` 逐字一致。
- **启动画面不要挪进 `#app`**：`mount('#app')` 会清空 `#app` 的子节点，放进去就等于「靠 Vue 来删除自己」，无法做淡出收尾（现在由 `main.ts` 主动加 `.boot-done` 再 `remove()`）。它的样式也必须自包含——`main.css` 在 Vue 挂载时才随 JS 注入，指望 CSS 变量会先渲染出一片无色背景。
- **启动画面与 CSP 的关系**：它只用内联 `<style>` 与内联 SVG，因此依赖 `style-src 'unsafe-inline'`（已放开）；不要为了它引入外部字体或图标库，否则会被 `default-src 'self'` 拦掉。
- **本文件不含业务逻辑**：除启动画面外，所有标题栏、菜单、Toast 结构都由 `App.vue` 在客户端生成，此处只保留最小外壳。
