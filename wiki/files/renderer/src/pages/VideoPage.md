# src/renderer/src/pages/VideoPage/（页面）

> HTML 预览 + HyperFrames 一键转视频，并内嵌播放产物。

- **覆盖文件**：`VideoPage/index.vue`（本目录唯一文件，122 行）
- **所在目录**：`src/renderer/src/pages/VideoPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：122 行
- **对外导出**：默认导出组件（`defineProps` 未使用，无 props；模板内渲染子组件 `StepBar`）

## 1. 作用与职责

本页是「视频生成」环节的界面：选择或自动载入项目 HTML → iframe 预览 → 调用 HyperFrames 转视频 → 内嵌播放渲染结果 → 在系统文件管理器中定位产物，并把产物路径回写到当前项目。

| 职责 | 实现位置 |
|------|----------|
| 选择 HTML 文件并预览 | `onOpen` → `window.hfTools.openHtml` → `setHtml` |
| 进入页面时自动载入当前项目 HTML | `onMounted` + `appState.project.htmlPath` |
| 经「预览外壳」加载（带播放条、等比缩放） | `setHtml` → `window.hfTools.previewShell` |
| 一键转视频 | `onRender` → `window.hfTools.renderVideo` |
| 渲染进度文案（全局 trace ∪ 本页状态） | `statusText`（`renderProgress.text || localStatus`） |
| 渲染完成后内嵌播放 | `videoSrc` + `videoVisible` + `<video controls>` |
| 在文件夹中显示产物 | `onShowFolder` → `window.hfTools.showInFolder` |
| 产物路径回写项目 | `window.projectTools.saveVideo` + `refreshProject()` |
| 顶部流程条 | `<StepBar :page="'video-gen'" />` |

## 2. 模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'video-gen'" />` | 顶部步骤条，`page` 传字面量 `'video-gen'`，与菜单 `data-page` 键一致 |
| `.card.hf-page` | 整页卡片容器，`margin-top:16px`；页面根元素为 `div` |
| `.hf-toolbar` | 工具条：`选择 HTML 文件` 按钮、文件名 `span.hf-file`（有路径时显示 `escTxt(hfHtmlPath)`，否则显示「未选择文件」）、`HyperFrames 转视频` 主按钮（`:disabled="!hfHtmlPath \|\| rendering"`） |
| `.hf-status` | 状态条，`:class="statusClass"`，文本为 `statusText` |
| `iframe.hf-frame` | 预览容器，`:src="frameSrc"`，`sandbox="allow-scripts allow-same-origin"` |
| `.hf-video-wrap` | 渲染产物区，`v-show="videoVisible"`；内含 `<video ref="videoEl" :src="videoSrc" class="hf-video" controls>` 与「在文件夹中显示」按钮 |

## 3. 脚本逻辑

### 3.1 状态（ref / computed）

| 名称 | 类型 | 说明 |
|------|------|------|
| `hfHtmlPath` | `ref<string \| null>` | 当前预览的 HTML 路径，兼作转视频入参；为空时禁用转视频按钮 |
| `lastVideoPath` | `ref<string \| null>` | 最近一次渲染出的视频路径，供 `showInFolder` 使用 |
| `frameSrc` | `ref<string>` | iframe 的 `file:///` URL（优先预览外壳，回退原 HTML） |
| `videoSrc` | `ref<string>` | 产物视频的 `file:///` URL |
| `videoVisible` | `ref(false)` | 是否显示内嵌播放器区域 |
| `videoEl` | `ref<HTMLVideoElement \| null>` | 视频元素引用（本页仅声明，未在逻辑中进一步操作） |
| `rendering` | `ref(false)` | 渲染进行中标志，控制按钮禁用 |
| `localStatus` | `ref('')` | 本页本地状态文案（引导、渲染中、完成、失败） |
| `statusClass` | `ref('')` | 状态条样式类，取值 `''` / `'hf-ok'` / `'hf-error'` |
| `statusText` | `computed<string>` | `renderProgress.text \|\| localStatus.value`：渲染中被全局 trace 文案优先接管 |

### 3.2 函数

| 名称 | 说明 |
|------|------|
| `setHtml(p)` | 记录 `hfHtmlPath`；尝试 `window.hfTools.previewShell(p)`，`ok && shellPath` 时用外壳路径拼 `file:///` URL，否则回退 `file:///` + 原路径；随后置 `localStatus='已加载预览'`、`statusClass='hf-ok'` |
| `onOpen()` | `await window.hfTools.openHtml()`，返回非空则调 `setHtml(p)` |
| `onShowFolder()` | 有 `lastVideoPath` 时调 `window.hfTools.showInFolder(lastVideoPath.value)` |
| `onRender()` | 核心流程：置「渲染中，请稍候（约 30 秒）...」→ `rendering=true` → 调 `hfTools.renderVideo(p)` → 按 `res.ok` 分支处理 → `rendering=false` |
| `onMounted(cb)` | 页面挂载初始化：清空全部本页状态 + `resetRenderProgress()`；按 `appState.project` 给引导文案或自动加载预览 |

两个可选链的 IPC 结果字段：`res.outputVideo`（成功产物路径）、`res.message`（失败原因，经 `(res as { message?: string }).message` 读取）。

## 4. 关键流程

### 4.1 页面挂载（`onMounted`）

1. 依次复位 `hfHtmlPath`、`lastVideoPath`、`localStatus`、`statusClass`、`frameSrc`、`videoSrc`、`videoVisible`。
2. 调 `resetRenderProgress()`：清空全局 `renderProgress.text` 及 composable 内的 `hfLogBuf` / `hfLastLine`，避免上一次渲染的 trace 文案残留到本页。
3. 若 `!appState.project?.htmlExists`：`localStatus` 置为「该项目尚未生成 HTML，请先在「HTML 生成」页生成；也可以点击"选择 HTML 文件"手动预览。」（保留手动预览能力）。
4. 若 `appState.project?.htmlExists && appState.project.htmlPath`：调 `setHtml(appState.project.htmlPath)` 自动加载预览。

### 4.2 预览加载（`setHtml`）

1. 写入 `hfHtmlPath.value = p`。
2. `try` 中判断 `window.hfTools && typeof window.hfTools.previewShell === 'function'`，调用 `previewShell(p)`；`res.ok && res.shellPath` 时把反斜杠替换为正斜杠并 `encodeURI`，前置 `file:///`。
3. 任一步异常则 `src = null`（catch 吞掉异常，不弹错）。
4. `frameSrc = src || ('file:///' + encodeURI(p.replace(/\\/g, '/')))`；状态置「已加载预览」+ `hf-ok`。

### 4.3 一键转视频（`onRender`）

1. 取 `hfHtmlPath`，为空直接 `return`。
2. `localStatus='渲染中，请稍候（约 30 秒）...'`、`statusClass=''`、`rendering=true`（按钮禁用）。
3. `await window.hfTools.renderVideo(p)`，返回后 `rendering=false`。
4. **成功分支**（`res.ok`）：`lastVideoPath=res.outputVideo`；`renderProgress.text=''`（用本地完成文案覆盖全局 trace 残留）；`localStatus='渲染完成：' + res.outputVideo`、`statusClass='hf-ok'`；若 `!appState.isBuiltin` 则 `await window.projectTools.saveVideo(appState.currentName, res.outputVideo)` 再 `await refreshProject()`；最后拼 `videoSrc` 并 `videoVisible=true`。
5. **失败分支**：同样先清 `renderProgress.text`，`localStatus = res.message || '渲染失败'`、`statusClass='hf-error'`。

### 4.4 状态文案的合并显示

- 渲染期间：全局 `renderProgress.text` 由 `useRenderProgress.ts` 里 `App.vue` 挂载时注册的 `hfTools.onProgress` 回调持续写入（如「渲染中 · 逐帧捕获（12s）：...」），`statusText` 因此优先显示它。
- 非渲染期间 / trace 已被清空时：`renderProgress.text === ''`，回退显示 `localStatus`（引导语、已加载预览、渲染完成、失败原因）。
- 渲染结束的两条分支都显式把 `renderProgress.text` 置空，保证完成/失败文案不被旧 trace 抢占。

## 5. 依赖与协作

### 5.1 import

| 来源 | 名称 | 用途 |
|------|------|------|
| `vue` | `computed`、`onMounted`、`ref` | 响应式与生命周期 |
| `@renderer/composables/useAppStore` | `appState`、`refreshProject` | 读当前项目（`isBuiltin`、`currentName`、`project.htmlExists`、`project.htmlPath`）与刷新项目列表/详情 |
| `@renderer/composables/useToast` | `toast` | 已 import，但本文件未调用（页面状态统一走 `localStatus` 状态条） |
| `@renderer/utils/escape` | `escTxt` | 模板中显示文件名时做 HTML 转义 |
| `@renderer/composables/useRenderProgress` | `renderProgress`、`resetRenderProgress` | 全局渲染进度文案的读与复位 |
| `@renderer/components/StepBar.vue` | `StepBar` | 顶部步骤条 |

### 5.2 调用的 preload API 与 IPC 频道

| preload 调用 | IPC 频道 | 方向 |
|--------------|----------|------|
| `window.hfTools.openHtml()` | `dialog:open-html` | renderer → main（invoke） |
| `window.hfTools.previewShell(htmlPath)` | `video:preview-shell` | invoke |
| `window.hfTools.renderVideo(htmlPath)` | `video:render` | invoke |
| `window.hfTools.showInFolder(filePath)` | `video:show-in-folder` | invoke |
| `window.projectTools.saveVideo(name, videoPath)` | `project:save-video` | invoke |
| `window.projectTools.list()`、`window.projectTools.load(name)` | `project:list`、`project:load` | 经 `refreshProject()` 间接调用 |
| `window.hfTools.listProjects()` | `video:list-projects` | 经 `refreshProject()` 间接调用 |
| `window.hfTools.onProgress(cb)` | `video:progress` | main → renderer（进度推送，由 `useRenderProgress.ts` 在 `App.vue` 中挂载一次） |

## 6. 注意事项与实现要点

1. **iframe 的 `file:///` 拼接**：路径先 `replace(/\\/g, '/')` 再 `encodeURI`，最后前置 `file:///`；中文目录与空格依赖 `encodeURI` 处理，不要改成 `encodeURIComponent`。
2. **预览外壳优先、直连兜底**：`previewShell` 失败或返回 `ok=false` 时静默回退到直接加载目标 HTML（此时可能无播放条、内容被裁剪）。`previewShell` 内部异常被 `catch` 吞掉，不会中断加载。
3. **`resetRenderProgress()` 的复位时机**：只在 `onMounted` 调用一次，对应原 `initHfPage` 的清空语义；渲染结束时则是直接赋值 `renderProgress.text = ''`（不调用复位函数，避免连带清缓冲意义不明）。
4. **只在非内置项目回写产物**：`appState.isBuiltin` 为 `true`（内置示例项目）时跳过 `saveVideo` 与 `refreshProject`，内置示例不产生用户产物记录。
5. **状态类名固定三态**：`''`（进行中/初始）、`'hf-ok'`、`'hf-error'`，模板只做 `:class` 绑定。
6. **`videoEl` 目前未被逻辑使用**：仅保留元素引用，播放控制完全交给原生 `controls`，没有自动播放或定位逻辑。
7. **`toast` 导入未使用**：属于遗留导入，删除前需确认无其它引用需求；本页错误提示一律走状态条。
8. **失败分支读 `message`**：成功结果类型上没有 `message`，故用 `(res as { message?: string }).message` 断言读取，`||` 兜底为「渲染失败」。
9. **`statusText` 的优先级顺序**：全局 trace 优先于本地文案，因此渲染中想显示自定义提示时必须先清空 `renderProgress.text`。
