# src/renderer/src/pages/VideoPreviewPage/（页面）

> 视频预览：进入页面即载入当前项目的成品 MP4 内嵌播放，并可定位到文件；「转视频」与渲染档位在「HTML生成」页。

- **覆盖文件**：`VideoPreviewPage/index.vue`（本目录唯一文件，88 行）
- **所在目录**：`src/renderer/src/pages/VideoPreviewPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：88 行
- **对外导出**：默认导出组件（`defineProps` 未使用，无 props；模板内渲染子组件 `StepBar`）

## 1. 作用与职责

本页是流水线第五环「视频预览」（页面键 `PageKey = 'video-preview'`）的界面，职责**只有预览与定位**：**「转视频」动作与渲染档位（质量 / 帧率）整体在「HTML生成」页**（那里才拿得到 HTML 生成流程的上下文），本页没有「选择 HTML 文件」「HyperFrames 转视频」「渲染档位」任何一块 UI，也不回写产物路径、不发起渲染。

页面只有一条路径：读 `appState.project`（由 `refreshProject()` 写入）→ 按 `videoExists && videoPath` 决定显示播放器还是引导文案。

| 职责 | 实现位置 |
|------|----------|
| 进入页面即载入视频成品 | `onMounted` → `syncProjectVideo()`（读 `appState.project.videoExists` / `videoPath`） |
| 重新读取产物（`refreshProject()` 后再同步） | `onReload()` |
| 渲染中/完成/失败的状态文案 | `statusText = computed(() => renderProgress.text \|\| localStatus.value)` |
| 内嵌播放产物 | `videoSrc` + `videoVisible` + `<video class="hf-video" controls>` |
| 在文件夹中显示产物 | `onShowFolder()` → `window.hfTools.showInFolder` |
| 无成品时的引导 | `syncProjectVideo()` 按 `htmlExists` 写两条文案之一 |
| 状态复位 | `onMounted` 调 `resetRenderProgress()` |
| 顶部流程条 | `<StepBar :page="'video-preview'" />` |

**渲染入口不在这里**：`hfTools.renderVideo()` 全程只由「HTML生成」页的 `onRenderVideo()` 发起（见 [`HtmlGenPage.md`](./HtmlGenPage.md)）；本页只消费它的结果。

## 2. 模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'video-preview'" />` | 顶部步骤条，`page` 传字面量 `'video-preview'`，与菜单 `data-page` 键一致 |
| `.card.hgen-panel` | 整页卡片容器，`margin-top:16px`；页面根元素为 `div` |
| `.panel-title` | 标题恒为字面量「视频预览」，前导 `<span class="dot">` 发光小圆点 |
| `.hf-toolbar` | `.hf-file` 单行省略显示 `{{ videoPath ? videoPath : '尚无视频产物' }}` + 「重新加载」按钮（`:disabled="!videoPath"`，`title`「重新读取当前项目的视频产物」，`@click="onReload"`） |
| `.hf-status` | 状态条，`:class="statusClass"`，文本为 `statusText` |
| `.hf-video-wrap` | 播放器区，`v-show="videoVisible"`；内含 `<video :src="videoSrc" class="hf-video" controls>` 与 `.hf-video-actions` 里的「在文件夹中显示」按钮（`@click="onShowFolder"`） |
| `.hf-tip` | 页脚说明 `{{ tipText }}`：视频由「HTML生成」页的「转视频」按钮渲染，完成后回本页预览 |

路径直接用 `{{ }}` 插值显示（Vue 自动转义），本页不再引入转义工具。

## 3. 脚本逻辑

### 3.1 状态（ref / computed）

| 名称 | 类型 | 说明 |
|------|------|------|
| `videoPath` | `ref<string \| null>` | 成品 MP4 绝对路径（来自 `appState.project.videoPath`），兼作 `showInFolder` 入参与按钮禁用条件 |
| `videoSrc` | `ref('')` | 产物视频的 `file:///` URL |
| `videoVisible` | `ref(false)` | 是否显示播放器区（有成品为真；无成品时为假，只留引导文案） |
| `localStatus` | `ref('')` | 本页本地状态文案（已加载 / 两条引导） |
| `statusClass` | `ref('')` | 状态条样式类，取值 `''` / `'hf-ok'` / `'hf-error'` |
| `statusText` | `computed<string>` | `renderProgress.text \|\| localStatus.value`：渲染期间全局 trace 文案优先接管 |
| `tipText` | `computed<string>` | 固定文案：「视频由「HTML生成」页的「转视频」按钮（及那里的质量 / 帧率档位）渲染；渲染完成后回到本页即可预览最新成品。」 |

### 3.2 函数

| 名称 | 说明 |
|------|------|
| `fileUrl(p)` | `'file:///' + encodeURI(String(p).replace(/\\/g, '/'))`，本页唯一的路径 → URL 转换 |
| `syncProjectVideo()` | 载入入口（见 4.1）：有成品则装载播放器，否则按 `htmlExists` 写两条引导文案之一 |
| `onReload()` | 「重新加载」：`await refreshProject()` → **先把 `videoSrc` 置空卸下旧源** → `await nextTick()` → `syncProjectVideo()` → `toast(videoVisible ? '已重新加载视频成品' : '该项目暂无视频成品')`（先卸源是为了让同一个路径下重新渲染出来的新产物也能被 `<video>` 重新读盘） |
| `onShowFolder()` | 有 `videoPath` 时调 `window.hfTools.showInFolder(videoPath.value)`；无则不动作 |
| `onMounted(cb)` | 挂载初始化（见 4.2）：`resetRenderProgress()` → `syncProjectVideo()` |

## 4. 关键流程

### 4.1 进入页面即加载成品（`syncProjectVideo`）

1. 取 `p = appState.project`；`p.videoExists && p.videoPath` 同时成立 → 写入 `videoPath`、拼 `videoSrc`、`videoVisible = true`、`localStatus='已加载当前项目视频成品'`、`statusClass='hf-ok'`，然后 `return`。
2. 否则清空 `videoPath`（置 `null`）/ `videoSrc` / `videoVisible`，并按 `p.htmlExists` 给引导：有 HTML → 「该项目还没有视频成品：请到「HTML生成」页点「转视频」渲染。」；无 HTML → 「该项目还没有 HTML：请先到「HTML生成」页生成 HTML，再点「转视频」。」，`statusClass=''`。
3. **不发起任何 IPC**：成品存在性来自 `refreshProject()` 写入的列表项 `hasVideo`（主进程文件系统检查），本页只做展示。

### 4.2 挂载初始化（`onMounted`）

1. 先调 `resetRenderProgress()`：清空全局 `renderProgress.text` 及 `useRenderProgress.ts` 内的跨 chunk 半行缓冲 `hfLogBuf`，避免上一次渲染的 trace 残留到本页。
2. 再调 `syncProjectVideo()` 载入成品或写引导文案。
3. 两步都是同步调用，页面挂载即完成首屏渲染；后续任何刷新都经「重新加载」按钮显式触发。

### 4.3 重新加载（`onReload`）

1. `await refreshProject()`：重新拉项目列表并 `projectTools.load()` 当前项目，使 `appState.project.videoExists` / `videoPath` 反映最新磁盘状态。
2. **先卸源**：`videoSrc = ''` 并 `await nextTick()`，让浏览器先卸载旧媒体；否则同一个 `videoPath` 下重新渲染出的新 MP4 可能因 URL 未变而不被重新读取。
3. `syncProjectVideo()` 重新判定并装载。
4. `toast` 反馈：装载成功 → 「已重新加载视频成品」；仍无成品 → 「该项目暂无视频成品」。

### 4.4 状态文案的合并显示

- 渲染期间：全局 `renderProgress.text` 由 `useRenderProgress.ts` 里 `App.vue` 挂载时注册的 `hfTools.onProgress` 回调持续写入（如「渲染中 · 逐帧捕获（已用 45s · 帧 320/900）」），`statusText` 因此优先显示它。只有 CLI 长阶段的 trace 才会写入；普通日志行与内部微阶段（`worker_resolution` 等）不写，此时状态条保持上一条文案。渲染由「HTML生成」页发起，本页只是同屏复用同一份全局进度文案。
- 非渲染期间 / trace 已被清空时：`renderProgress.text === ''`，回退显示 `localStatus`（如「已加载当前项目视频成品」或两条引导文案）。
- 本页用 `statusClass` 这个 ref（而非再派生一个 computed）：状态类始终跟着本页分支走，与 trace 文案是否接管无关。
- 挂载时调的是 `resetRenderProgress()`（清文案 + 清半行缓冲），而不是只把 `renderProgress.text` 置空。

## 5. 依赖与协作

### 5.1 import

| 来源 | 名称 | 用途 |
|------|------|------|
| `vue` | `computed`、`nextTick`、`onMounted`、`ref` | 响应式、`onReload` 的卸源时序与生命周期 |
| `@renderer/composables/useAppStore` | `appState`、`refreshProject` | 读当前项目（`project.videoExists` / `videoPath` / `htmlExists`）与刷新项目 |
| `@renderer/composables/useToast` | `toast` | 重新加载结果的轻提示 |
| `@renderer/composables/useRenderProgress` | `renderProgress`、`resetRenderProgress` | 全局渲染进度文案的读与复位 |
| `@renderer/components/StepBar.vue` | `StepBar` | 顶部步骤条 |

> 本页**不**引入 `@shared/types`、`@renderer/utils/render`、`@renderer/utils/escape`、`@renderer/composables/useRenderOptions`：没有档位下拉、没有转义需求、也不参与渲染档位的读写。

### 5.2 调用的 preload API 与 IPC 频道

| preload 调用 | IPC 频道 | 方向 |
|--------------|----------|------|
| `window.hfTools.showInFolder(filePath)` | `video:show-in-folder` | renderer → main（invoke） |
| `window.projectTools.list()`、`window.projectTools.load(name)` | `project:list`、`project:load` | 经 `refreshProject()` 间接调用 |
| `window.hfTools.onProgress(cb)` | `video:progress` | main → renderer（进度推送，由 `useRenderProgress.ts` 在 `App.vue` 中挂载一次） |

**本页不调用** `window.hfTools.renderVideo()`（`video:render`，唯一入口在「HTML生成」页）与 `window.projectTools.saveVideo()`（`project:save-video`，同样只在「HTML生成」页的 `onRenderVideo` 里调）。

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import VideoPreviewPage from './VideoPreviewPage/index.vue'`，注册为 `pages['video-preview']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行 `onMounted`。

## 6. 注意事项与实现要点

1. **`file:///` 拼接**：路径先 `replace(/\\/g, '/')` 再 `encodeURI`，最后前置 `file:///`；中文目录与空格依赖 `encodeURI` 处理，不要改成 `encodeURIComponent`。
2. **「重新加载」先卸源再赋值**：`onReload` 把 `videoSrc` 置空并 `await nextTick()`，让浏览器先卸载旧媒体再挂新 URL。本页不持有 `<video>` 的元素引用，播放控制完全交给原生 `controls`。
3. **状态类名三态**：`''`（初始 / 无成品引导）、`'hf-ok'`（已载入）、`'hf-error'`（保留取值，本页当前分支不写入），模板只做 `:class="statusClass"` 绑定。
4. **`statusText` 的优先级顺序**：全局 trace 优先于本地文案；挂载时调 `resetRenderProgress()` 是为了不让上一轮渲染的残留 trace 抢占首屏文案。
5. **无成品不等于报错**：`videoExists` 为假时只写引导文案、不写 `hf-error`，状态条保持中性；按钮 `:disabled="!videoPath"` 同步禁用「重新加载」与「在文件夹中显示」的实际动作（后者在 `onShowFolder` 内还有一次 `videoPath` 判空）。
6. **上游动作在「HTML生成」页**：正式渲染与档位选择见 [`HtmlGenPage.md`](./HtmlGenPage.md)；本页只消费其结果（`project.json` 里的 `videoPath` 经 `refreshProject()` 进入 `appState.project`）。
