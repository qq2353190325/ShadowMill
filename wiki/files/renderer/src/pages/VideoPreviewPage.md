# src/renderer/src/pages/VideoPreviewPage/（页面）

> 视频预览：我的项目自动载入成品 MP4 内嵌播放；内置示例只读，保留 HTML 预览与试渲染。

- **覆盖文件**：`VideoPreviewPage/index.vue`（本目录唯一文件，199 行）
- **所在目录**：`src/renderer/src/pages/VideoPreviewPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：199 行
- **对外导出**：默认导出组件（`defineProps` 未使用，无 props；模板内渲染子组件 `StepBar`）

## 1. 作用与职责

本页是流水线第五环「视频预览」（页面键 `PageKey = 'video-preview'`）的界面，职责已收窄为**预览与定位**：**「转视频」动作与渲染档位（质量 / 帧率）整体搬到了「HTML生成」页**（那里才拿得到 HTML 生成流程的上下文），本页不再有「选择 HTML 文件」「HyperFrames 转视频」「渲染档位」三块 UI，也不再回写产物路径。

两种项目形态分支：

| 项目形态 | 本页行为 |
|----------|----------|
| 我的项目（非内置） | 进入即自动加载 `appState.project.videoPath`（配合 `videoExists`）→ `<video controls>` 播放 + 「重新加载」+ 「在文件夹中显示」；无成品时给出「去「HTML生成」页点「转视频」」的引导 |
| 内置示例（只读） | 保留示例 HTML 预览（`hfTools.previewShell` 外壳 + iframe）+「试渲染」+ 质量 / 帧率下拉（**只读项目不落盘，档位仅本次生效**）；渲染完成后用本页 `<video>` 播放结果 |

| 职责 | 实现位置 |
|------|----------|
| 我的项目自动载入视频成品 | `onMounted` → `syncProjectVideo()`（读 `appState.project.videoExists` / `videoPath`） |
| 重新读取产物（`refreshProject()` 后再同步） | `onReload()` |
| 渲染中/完成/失败的状态文案 | `statusText = computed(() => renderProgress.text \|\| localStatus.value)` |
| 内嵌播放产物 | `videoSrc` + `videoVisible` + `<video controls>` |
| 在文件夹中显示产物 | `onShowFolder()` → `window.hfTools.showInFolder` |
| 内置示例 HTML 预览（预览外壳 + 等比缩放） | `loadBuiltinPreview()` → `window.hfTools.previewShell` |
| 内置示例试渲染 | `onRender()` → `window.hfTools.renderVideo(htmlPath, { quality, fps })` |
| 内置示例档位初始化 | `onMounted` → `effectiveRenderOptions()`（只读项目无项目级覆盖，取全局默认） |
| 状态复位 | `onMounted` / 试渲染结束调 `resetRenderProgress()` |
| 顶部流程条 | `<StepBar :page="'video-preview'" />` |

### 1.1 为什么还保留内置示例的试渲染分支

内置示例项目在「HTML生成」页**不可用**，三条限制叠加，因此示例的预览与试渲染必须留在本页：

1. **`hasHtml` 对内置恒为假**——`useAppStore.hasHtml` 的第一个条件就是 `!appState.isBuiltin`，所以内置示例在「HTML生成」页既不显示「已生成」，也看不到「转视频」按钮（该按钮带 `v-if="!appState.isBuiltin"`，即便渲染也 `:disabled="!hasHtml || rendering"` 恒为禁用），`onRenderVideo()` 入口处还有 `appState.isBuiltin` 只读守卫。
2. **打包后 `video-projects/` 在 asar 内只读**——内置示例的 `index.html` 随包位于 `app.getAppPath()/video-projects/<name>/`（dev 为项目根、打包后在 `app.asar` 内），无法像 userData 项目那样写入 `project.json` 或落盘产物。
3. **`projectTools.previewHtml` 只认 userData 项目**——该 handler 走 `projectFilePath(name, 'index.html')`（即 `userData/projects/<name>/`），对内置示例返回「该项目还没有 HTML」，所以本页的示例预览只能直接调 `hfTools.previewShell(示例 htmlPath)` 生成同目录 `_hf_preview_shell.html` 外壳。

同理，示例试渲染出的 MP4 落在 `userData/hf-projects/html-video-<ts>/output.mp4`，本页只把它喂给 `<video>` 播放，**不调 `projectTools.saveVideo`、也不刷新项目**（与「HTML生成」页的正式渲染流程区别所在）。

## 2. 模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'video-preview'" />` | 顶部步骤条，`page` 传字面量 `'video-preview'`，与菜单 `data-page` 键一致 |
| `.card.hf-page` | 整页卡片容器，`margin-top:16px`；页面根元素为 `div` |
| `.panel-title` | 标题按 `appState.isBuiltin` 二选一：`内置示例预览（只读）` / `视频预览` |
| `.hf-toolbar`（我的项目） | `v-if="!appState.isBuiltin"`：`.hf-file` 显示 `escTxt(videoPath)` 或「尚无视频产物」+ `重新加载` 按钮（`:disabled="!videoPath"`，`@click="onReload"`） |
| `.hf-toolbar`（内置示例第 1 行） | `v-else` 分支：`.hf-file` 显示 `escTxt(htmlPath)` 或「未找到示例 HTML」+ `重新加载预览`（`:disabled="!htmlPath"`）+ `试渲染` 主按钮（`:disabled="!htmlPath \|\| rendering"`，`title`「把示例 HTML 渲染成 MP4（约 30 秒）」） |
| `.hf-toolbar`（内置示例第 2 行） | 质量 / 帧率两个 `select.hf-select`（`v-model="quality"` / `v-model="fps"`，`:disabled="rendering"`，选项来自 `qualityOptions` / `fpsOptions`）+ 文案「本次档位：`renderOptionsText({ quality, fps })`（只读示例，不落盘）」 |
| `.hf-tip`（内置示例） | `{{ qualityHint }}`：当前所选质量的说明（如「快速预览」的画质代价） |
| `.hf-status` | 状态条，`:class="statusClass"`，文本为 `statusText` |
| `iframe.hf-frame` | `v-if="appState.isBuiltin && frameSrc && !videoVisible"`，`:src="frameSrc"`，`sandbox="allow-scripts allow-same-origin"` |
| `.hf-video-wrap` | 视频产物区，`v-show="videoVisible"`；内含 `<video :src="videoSrc" class="hf-video" controls>` 与「在文件夹中显示」按钮（`@click="onShowFolder"`） |
| `.hf-tip`（页脚） | `{{ tipText }}`：区分「我的项目 / 内置示例」两种说明 |

## 3. 脚本逻辑

### 3.1 状态（ref / computed）

| 名称 | 类型 | 说明 |
|------|------|------|
| `videoPath` | `ref<string \| null>` | 成品 MP4 绝对路径（我的项目来自 `appState.project.videoPath`），兼作 `showInFolder` 入参 |
| `videoSrc` | `ref('')` | 产物视频的 `file:///` URL |
| `videoVisible` | `ref(false)` | 是否显示内嵌播放器区域（内置示例试渲染完成后置真，同时隐藏 iframe） |
| `frameSrc` | `ref('')` | 内置示例 iframe 的 `file:///` URL（优先预览外壳，回退原 HTML） |
| `htmlPath` | `ref('')` | 内置示例 `index.html` 的绝对路径（来自 `appState.project.htmlPath`） |
| `rendering` | `ref(false)` | 试渲染进行中标志，控制按钮与下拉禁用 |
| `localStatus` | `ref('')` | 本页本地状态文案（引导、已加载、试渲染中/完成/失败） |
| `statusClass` | `ref('')` | 状态条样式类，取值 `''` / `'hf-ok'` / `'hf-error'` |
| `statusText` | `computed<string>` | `renderProgress.text \|\| localStatus.value`：渲染中被全局 trace 文案优先接管 |
| `qualityOptions` / `fpsOptions` | 常量 | 直接引用 `utils/render.ts` 的 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` |
| `quality` / `fps` | `ref<RenderQuality>` / `ref<RenderFps>` | 内置示例试渲染档位，初值取 `FALLBACK_RENDER`（`standard` / `30`），挂载时按 `effectiveRenderOptions()` 覆盖 |
| `qualityHint` | `computed<string>` | 当前所选质量档位的 `hint`，找不到时为空串 |
| `tipText` | `computed<string>` | 内置示例：只读说明 + 引导切换到「我的项目」；我的项目：说明视频由「HTML生成」页渲染、完成后回本页预览 |

### 3.2 函数

| 名称 | 说明 |
|------|------|
| `fileUrl(p)` | `'file:///' + encodeURI(String(p).replace(/\\/g, '/'))`，本页唯一的路径 → URL 转换 |
| `syncProjectVideo()` | 我的项目的加载入口（见 4.1）：有成品则装载播放器，否则按 `htmlExists` 写两条引导文案之一 |
| `onReload()` | 我的项目的「重新加载」：`await refreshProject()` → **先把 `videoSrc` 置空卸下旧源** → `await nextTick()` → `syncProjectVideo()` → `toast(videoVisible ? '已重新加载视频成品' : '该项目暂无视频成品')`（先卸源是为了让同一个路径下重新渲染出来的新产物也能被 `<video>` 重新读盘） |
| `onShowFolder()` | 有 `videoPath` 时调 `window.hfTools.showInFolder(videoPath.value)` |
| `loadBuiltinPreview()` | 内置示例预览加载（见 4.3）：无路径写「未找到示例 HTML」+ `hf-error`；否则调 `previewShell`，失败静默回退原 HTML；加载后把 `videoVisible` 置回 `false`（回到示例 HTML 预览） |
| `onRender()` | 内置示例试渲染（见 4.4）：`rendering` 守卫 → `try` 调 `renderVideo` → `resetRenderProgress()` → 成功/失败分支 → `catch` 转失败文案 → `finally` 复位 `rendering` |
| `onMounted(cb)` | 挂载初始化（见 4.2）：先 `resetRenderProgress()`，再按 `appState.isBuiltin` 分流 |

两个可选链的 IPC 结果字段：`res.outputVideo`（成功产物路径）、`res.message`（失败原因，经 `(res as { message?: string }).message` 读取）。

## 4. 关键流程

### 4.1 我的项目：进入页面即加载成品（`syncProjectVideo`）

1. 取 `p = appState.project`；`p.videoExists && p.videoPath` 同时成立 → 写入 `videoPath`、拼 `videoSrc`、`videoVisible = true`、`localStatus='已加载当前项目视频成品'`、`statusClass='hf-ok'`，然后 `return`。
2. 否则清空 `videoPath` / `videoSrc` / `videoVisible`，并按 `p.htmlExists` 给引导：有 HTML → 「该项目还没有视频成品：请到「HTML生成」页点「转视频」渲染。」；无 HTML → 「该项目还没有 HTML：请先到「HTML生成」页生成 HTML，再点「转视频」。」，`statusClass=''`。
3. **不发起任何 IPC**：成品存在性来自 `refreshProject()` 写入的列表项 `hasVideo`（主进程文件系统检查），本页只做展示。

### 4.2 挂载初始化（`onMounted`）

1. 先调 `resetRenderProgress()`：清空全局 `renderProgress.text` 及 `useRenderProgress.ts` 内的跨 chunk 半行缓冲 `hfLogBuf`，避免上一次渲染的 trace 残留到本页。本页只在**内置示例试渲染**（4.4）时发起渲染，我的项目形态下渲染由「HTML生成」页发起。
2. `appState.isBuiltin` 为真（内置示例）：`effectiveRenderOptions()` 取全局默认档位（只读项目没有项目级覆盖）写入 `quality` / `fps`；`htmlPath = appState.project.htmlPath || ''`，有路径则 `loadBuiltinPreview()`，否则写「未找到示例 HTML」+ `hf-error`；随后直接 `return`（不走成品加载）。
3. 否则走 `syncProjectVideo()`（我的项目分支）。

### 4.3 内置示例 HTML 预览（`loadBuiltinPreview`）

1. `htmlPath` 为空 → `localStatus='未找到示例 HTML'`、`statusClass='hf-error'` 并返回。
2. `try` 中判断 `window.hfTools && typeof window.hfTools.previewShell === 'function'`，调用 `previewShell(p)`；`res.ok && res.shellPath` 时把外壳路径转成 `file:///` URL。源码注释说明外壳的用途：外壳在目标 HTML 同目录、内部使用本地 hyperframes-player 组件，提供播放条（`controls`）与等比缩放，避免直接落地 iframe 导致无进度条、内容被裁剪。
3. 任一步异常则 `src = null`（`catch` 吞掉异常，不弹错）。
4. `frameSrc = src || fileUrl(p)`；`videoVisible = false`（重新加载预览 = 回到示例 HTML 预览，之前试渲染的结果可再点「试渲染」查看）；状态置「已加载示例预览」+ `hf-ok`。

### 4.4 内置示例试渲染（`onRender`）

1. 取 `htmlPath`，为空直接 `toast('未找到示例 HTML')` 并返回；`rendering` 为真直接返回（并发守卫，按钮本身也已 `:disabled`）。
2. `options = { quality: quality.value, fps: fps.value }`；`localStatus='试渲染中，请稍候（' + renderOptionsText(options) + '，约 30 秒）...'`、`statusClass=''`、`rendering=true`（按钮与两个下拉禁用）。
3. `try` 中 `await window.hfTools.renderVideo(p, options)`——档位作为 `RenderOverride` 与 `htmlPath` 合并进 `VideoRenderPayload`，主进程按白名单拼 `--quality` / `--fps` 参数。
4. 返回后立即 `resetRenderProgress()`：**用本页完成/失败文案覆盖全局 trace 残留**（渲染期间 `statusText` 优先显示 trace）。
5. **成功分支**（`res.ok`）：`videoPath=res.outputVideo`、`videoSrc=fileUrl(...)`、`videoVisible=true`（iframe 随之隐藏）、`localStatus='试渲染完成（档位摘要）：' + res.outputVideo`、`statusClass='hf-ok'`。**不回写项目、不刷新项目列表**（只读示例）。
6. **失败分支**：`localStatus = res.message || '渲染失败'`、`statusClass='hf-error'`。
7. **异常分支**（`catch`）：同样先 `resetRenderProgress()`，再写 `localStatus = '试渲染失败：' + message`、`statusClass='hf-error'`。
8. `finally` 中复位 `rendering = false`。

### 4.5 状态文案的合并显示

- 渲染期间：全局 `renderProgress.text` 由 `useRenderProgress.ts` 里 `App.vue` 挂载时注册的 `hfTools.onProgress` 回调持续写入（如「渲染中 · 逐帧捕获（已用 45s · 帧 320/900）」），`statusText` 因此优先显示它。只有 CLI 长阶段的 trace 才会写入；普通日志行与内部微阶段（`worker_resolution` 等）不写，此时状态条保持上一条文案。
- 非渲染期间 / trace 已被清空时：`renderProgress.text === ''`，回退显示 `localStatus`（渲染刚点下、还没有任何长阶段 trace 时也走这条，即显示「试渲染中，请稍候（…，约 30 秒）...」）。
- 本页用 `statusClass` 这个 ref（而非像「HTML生成」页那样再派生一个 `statusDisplayClass` computed）：状态类始终跟着本页分支走，与 trace 文案是否接管无关。
- 试渲染结束时调的是 `resetRenderProgress()`（清文案 + 清半行缓冲），而不是旧页那种「只把 `renderProgress.text` 置空」。

## 5. 依赖与协作

### 5.1 import

| 来源 | 名称 | 用途 |
|------|------|------|
| `vue` | `computed`、`nextTick`、`onMounted`、`ref` | 响应式、`onReload` 的卸源时序与生命周期 |
| `@shared/types` | `type RenderFps`、`type RenderQuality` | 两个下拉的档位类型 |
| `@renderer/composables/useAppStore` | `appState`、`refreshProject` | 读当前项目（`isBuiltin`、`project.videoExists` / `videoPath` / `htmlPath`）与刷新项目 |
| `@renderer/composables/useToast` | `toast` | 重新加载结果、试渲染缺 HTML 的轻提示 |
| `@renderer/utils/escape` | `escTxt` | 模板中显示视频 / HTML 路径时做 HTML 转义 |
| `@renderer/composables/useRenderProgress` | `renderProgress`、`resetRenderProgress` | 全局渲染进度文案的读与复位 |
| `@renderer/utils/render` | `FALLBACK_RENDER`、`RENDER_FPS_OPTIONS`、`RENDER_QUALITY_OPTIONS`、`renderOptionsText` | 档位选项表、默认档位与档位摘要文案 |
| `@renderer/composables/useRenderOptions` | `effectiveRenderOptions` | 内置示例试渲染的初始档位（内置项目无项目级覆盖，取全局默认） |
| `@renderer/components/StepBar.vue` | `StepBar` | 顶部步骤条 |

### 5.2 调用的 preload API 与 IPC 频道

| preload 调用 | IPC 频道 | 方向 |
|--------------|----------|------|
| `window.hfTools.previewShell(htmlPath)` | `video:preview-shell` | renderer → main（invoke） |
| `window.hfTools.renderVideo(htmlPath, { quality, fps })` | `video:render` | invoke |
| `window.hfTools.showInFolder(filePath)` | `video:show-in-folder` | invoke |
| `window.projectTools.list()`、`window.projectTools.load(name)` | `project:list`、`project:load` | 经 `refreshProject()` 间接调用 |
| `window.hfTools.listProjects()` | `video:list-projects` | 经 `refreshProject()` 间接调用 |
| `window.hfTools.onProgress(cb)` | `video:progress` | main → renderer（进度推送，由 `useRenderProgress.ts` 在 `App.vue` 中挂载一次） |

**本页不再调用** `window.hfTools.openHtml()`（`dialog:open-html`，随「选择 HTML 文件」按钮一起删除）与 `window.projectTools.saveVideo()`（`project:save-video`，已移入「HTML生成」页的 `onRenderVideo`）。

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import VideoPreviewPage from './VideoPreviewPage/index.vue'`，注册为 `pages['video-preview']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行 `onMounted`。

## 6. 注意事项与实现要点

1. **iframe 的 `file:///` 拼接**：路径先 `replace(/\\/g, '/')` 再 `encodeURI`，最后前置 `file:///`；中文目录与空格依赖 `encodeURI` 处理，不要改成 `encodeURIComponent`。
2. **预览外壳优先、直连兜底**：`previewShell` 失败或返回 `ok=false` 时静默回退到直接加载目标 HTML（此时可能无播放条、内容被裁剪）。`previewShell` 内部异常被 `catch` 吞掉，不会中断加载。
3. **两种项目形态的工具栏互斥**：模板用 `v-if="!appState.isBuiltin"` / `v-else` 分流，因此「重新加载」（我的项目）与「重新加载预览 / 试渲染 / 档位下拉」（内置示例）不会同时出现。
4. **内置示例档位不落盘**：`quality` / `fps` 只读进 `renderVideo` 载荷，既不调 `saveProjectRenderOverride`（那是「HTML生成」页的行为），也不写 `settings.json`；离开本页即回到全局默认。
5. **内置示例不回写产物**：试渲染成功后只更新本页 `videoPath` / `videoSrc` / `videoVisible`，不调 `projectTools.saveVideo`、不 `refreshProject()`，所以示例的「视频」节点永远不会点亮（`hasVideo` 依赖列表项 `hasVideo`，内置映射里恒为 `false`）。
6. **状态类名三态**：`''`（进行中/初始）、`'hf-ok'`、`'hf-error'`，模板只做 `:class="statusClass"` 绑定。
7. **「重新加载」先卸源再赋值**：`onReload` 把 `videoSrc` 置空并 `await nextTick()`，让浏览器先卸载旧媒体再挂新 URL；否则同一个 `videoPath` 下重新渲染出的新 MP4 可能因 URL 未变而不被重新读取。本页不持有 `<video>` 的元素引用，播放控制完全交给原生 `controls`。
8. **失败分支读 `message`**：成功结果类型上没有 `message`，故用 `(res as { message?: string }).message` 断言读取，`||` 兜底为「渲染失败」。
9. **`statusText` 的优先级顺序**：全局 trace 优先于本地文案；试渲染结束调 `resetRenderProgress()` 是为了让完成/失败文案不被旧 trace 抢占。
10. **上游动作在「HTML生成」页**：正式渲染与档位选择见 [`HtmlGenPage.md`](./HtmlGenPage.md)；本页只消费其结果（`project.json` 里的 `videoPath` 经 `refreshProject()` 进入 `appState.project`）。
