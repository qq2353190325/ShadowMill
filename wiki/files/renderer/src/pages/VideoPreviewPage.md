# src/renderer/src/pages/VideoPreviewPage/（页面）

> 视频预览：进入页面即载入**当前工作项目**的成品 MP4 内嵌播放，也可在下拉里选另一个「有视频成品」的项目来看（**只换本页播放的内容，不切换工作项目**），并可定位到文件；「转视频」与渲染档位在「HTML生成」页。

- **覆盖文件**：`VideoPreviewPage/index.vue`（本目录唯一文件，142 行）
- **所在目录**：`src/renderer/src/pages/VideoPreviewPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：142 行
- **对外导出**：默认导出组件（`defineProps` 未使用，无 props；模板内渲染子组件 `StepBar` 与 `HfSelect`）

## 1. 作用与职责

本页是流水线第五环「视频预览」（页面键 `PageKey = 'video-preview'`）的界面，职责**只有预览与定位**：**「转视频」动作与渲染档位（质量 / 帧率）整体在「HTML生成」页**（那里才拿得到 HTML 生成流程的上下文），本页没有「选择 HTML 文件」「HyperFrames 转视频」「渲染档位」任何一块 UI，也不回写产物路径、不发起渲染。

本页可选择**预览哪个项目**：默认是当前工作项目，下拉里其余项只列「有视频成品」的项目。**切换下拉不改变 `appState.currentName`**（源码注释：切项目会牵动其它页面的上下文，不该由一个预览动作顺手做掉）——本页只把播放源换成所选项目的成品。

| 职责 | 实现位置 |
|------|----------|
| 选择预览哪个项目（默认当前工作项目） | `selectedName` + `previewGroups` + `HfSelect`（`@change="onProjectChange"`） |
| 进入页面即载入所选项目的成品 | `onMounted` → `loadSelected()` |
| 载入所选项目成品（存在性判定 + 取路径） | `loadSelected()`：`project:list` 的 `ProjectMeta.hasVideo/hasHtml` + `project:load` 的 `videoPath` |
| 重新读取项目清单与所选项目产物 | `onReload()`（按钮**始终可用**） |
| 渲染中/完成/失败的状态文案 | `statusText = computed(() => renderProgress.text \|\| localStatus.value)` |
| 内嵌播放产物 | `videoSrc` + `videoVisible` + `<video class="hf-video" controls>` |
| 在文件夹中显示产物 | `onShowFolder()` → `window.hfTools.showInFolder`（**跟着所选项目走**） |
| 无成品时的引导 | `loadSelected()` 按所选项目的 `hasHtml` 写两条文案之一 |
| 状态复位 | `onMounted` 调 `resetRenderProgress()` |
| 顶部流程条 | `<StepBar :page="'video-preview'" />` |

**渲染入口不在这里**：`hfTools.renderVideo()` 全程只由「HTML生成」页的 `onRenderVideo()` 发起（见 [`HtmlGenPage.md`](./HtmlGenPage.md)）；本页只消费它的结果。

**没有新增任何 IPC 频道**：所选项目的成品存在性用 `project:list` 的 `ProjectMeta.hasVideo` / `hasHtml`（主进程已做过文件存在性判定），成品路径用 `project:load` 返回的 `videoPath`；当前工作项目直接复用 `appState.project`，不走 IPC。

## 2. 模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'video-preview'" />` | 顶部步骤条，`page` 传字面量 `'video-preview'`，与菜单 `data-page` 键一致 |
| `.card.hgen-panel` | 整页卡片容器，`margin-top:16px`；页面根元素为 `div` |
| `.panel-title` | 标题恒为字面量「视频预览」，前导 `<span class="dot">` 发光小圆点 |
| `.hf-toolbar` | 工具栏，从左到右：`span.sel-label`「预览项目」→ `HfSelect`（`v-model="selectedName"`、`:groups="previewGroups"`、行内 `style="width:300px;flex:none"`、`title="选择要预览哪个项目的视频成品（仅本页生效，不切换工作项目）"`、`@change="onProjectChange"`）→ `.hf-file`（`:title="videoPath \|\| ''"`，显示 `{{ videoPath ? videoPath : '尚无视频产物' }}`）→ 「在文件夹中显示」（`:disabled="!videoPath"`，`title="在文件夹中显示该视频成品"`，`@click="onShowFolder"`）→ 「重新加载」（**无 `:disabled`，始终可用**，`title="重新读取项目列表与所选项目的视频产物"`，`@click="onReload"`） |
| `.hf-status` | 状态条，`:class="statusClass"`，文本为 `statusText` |
| `.hf-video-wrap` | 播放器区，`v-show="videoVisible"`；内含 `<video :src="videoSrc" class="hf-video" controls>` 与 `.hf-video-actions` 里的「在文件夹中显示」按钮（`@click="onShowFolder"`） |
| `.hf-tip` | 页脚说明 `{{ tipText }}` |

路径直接用 `{{ }}` 插值显示（Vue 自动转义），本页不引入转义工具。

### 2.1 「预览项目」下拉的选项构造（`previewGroups`）

```js
const previewGroups = computed<HfSelectGroup[]>(() => {
  const current = appState.currentName;
  return [{
    label: '',
    options: [
      { value: current, label: '当前项目 · ' + titleOf(current) + (hasVideoOf(current) ? '' : '（无视频成品）') },
      ...appState.myProjects
        .filter((m) => m.name !== current && m.hasVideo)
        .map((m) => ({ value: m.name, label: (m.title || m.name) + ' · 视频✓' }))
    ]
  }];
});
```

- **首项恒为当前工作项目**（它是本页的默认视图），选项文案为 `当前项目 · <标题或名>`；当前项目没有视频成品时追加「（无视频成品）」后缀，仍可选中（选中后走引导文案而不是播放器）。
- **其余项只列 `hasVideo` 的项目**（源码注释：下拉里每一项都能直接播，不会选到空项目），文案为 `<标题或名> · 视频✓`。
- `titleOf(name)` 优先取 `appState.myProjects` 里的 `title || name`，其次取 `appState.project`（当 `project.name === name`）的 `title || name`，都找不到时回退 `name`。

## 3. 脚本逻辑

### 3.1 状态（ref / computed）

| 名称 | 类型 | 说明 |
|------|------|------|
| `selectedName` | `ref<string>` | **本页预览哪个项目**，初值 `appState.currentName`（默认 = 当前工作项目）；与 `appState.currentName` 无联动——改它不会切工作项目 |
| `videoPath` | `ref<string \| null>` | **所选项目**成品 MP4 的绝对路径（当前项目取自 `appState.project.videoPath`，其它项目取自 `project:load`），兼作 `showInFolder` 入参与按钮禁用条件 |
| `videoSrc` | `ref('')` | 产物视频的 `file:///` URL |
| `videoVisible` | `ref(false)` | 是否显示播放器区（有成品为真；无成品时为假，只留引导文案） |
| `localStatus` | `ref('')` | 本页本地状态文案（已加载 / 两条引导） |
| `statusClass` | `ref('')` | 状态条样式类，取值 `''` / `'hf-ok'` |
| `statusText` | `computed<string>` | `renderProgress.text \|\| localStatus.value`：渲染期间全局 trace 文案优先接管 |
| `tipText` | `computed<string>` | 固定文案：「视频由「HTML生成」页的「转视频」按钮（及那里的质量 / 帧率档位）渲染；渲染完成后回到本页即可预览最新成品。下拉里只列出已经有视频成品的项目，选它只换本页播放的内容，不会切换工作项目。」 |
| `previewGroups` | `computed<HfSelectGroup[]>` | 「预览项目」下拉的选项，见 2.1 |

### 3.2 函数

| 名称 | 说明 |
|------|------|
| `fileUrl(p)` | `'file:///' + encodeURI(String(p).replace(/\\/g, '/'))`，本页唯一的路径 → URL 转换 |
| `titleOf(name)` | 项目显示名：`appState.myProjects` → 当前项目 → 原样 `name`（见 2.1） |
| `hasVideoOf(name)` | 该项目在 `appState.myProjects` 里是否 `hasVideo`（用于给当前项目选项加「（无视频成品）」后缀） |
| `loadSelected()` | 载入入口（见 4.1）：先卸旧源 → 按 `hasVideo` + `videoPath` 决定装载播放器或写引导文案 |
| `onProjectChange()` | `HfSelect` 的 `@change`：`await loadSelected()`（`@change` 直接给新值，无需读事件对象） |
| `onReload()` | 「重新加载」：`await refreshProject()` → **所选项目已不在项目清单里时回落到 `appState.currentName`** → `await loadSelected()` → `toast(videoVisible ? '已重新加载视频成品' : '该项目暂无视频成品')` |
| `onShowFolder()` | 有 `videoPath` 时调 `window.hfTools.showInFolder(videoPath.value)`；无则不动作 |
| `onMounted(cb)` | 挂载初始化（见 4.2）：`resetRenderProgress()` → `void loadSelected()` |

## 4. 关键流程

### 4.1 载入所选项目的成品（`loadSelected`）

1. **先卸旧源**：`videoSrc = ''`、`videoVisible = false`、`videoPath = null`——让浏览器先卸载上一个项目（或同一路径重新渲染出的）旧媒体。
2. 取 `name = selectedName.value`；从 `appState.myProjects` 找 `entry`，得 `hasVideo = !!(entry && entry.hasVideo)`、`hasHtml = !!(entry && entry.hasHtml)`。
3. **取路径**：`name === appState.currentName` 时直接用 `appState.project`（不发起 IPC）；否则 `await window.projectTools.load(name).catch(() => null)`（`project:load`）。再 `vp = (proj && proj.videoPath) || ''`。
4. `hasVideo && vp` 同时成立 → `await nextTick()` → 写 `videoPath = vp`、`videoSrc = fileUrl(vp)`、`videoVisible = true`、`localStatus = '已加载「' + titleOf(name) + '」的视频成品'`、`statusClass = 'hf-ok'`，然后 `return`。
5. 否则清空态并按所选项目的 `hasHtml` 给引导文案（`statusClass = ''`，**不写 `hf-error`**）：
   - 有 HTML → 「项目「<标题或名>」还没有视频成品：把它切为工作项目，到「HTML生成」页点「转视频」渲染。」
   - 无 HTML → 「项目「<标题或名>」还没有 HTML：把它切为工作项目，先到「HTML生成」页生成 HTML，再点「转视频」。」
6. 两条引导都明确要求「把它切为工作项目」——因为渲染动作在当前工作项目上执行，本页不代劳切项目。

> 存在性以 `ProjectMeta.hasVideo` 为准、路径以 `videoPath` 为准：前者为假时即使 `videoPath` 有残留也不会显示播放器。

### 4.2 挂载初始化（`onMounted`）

1. 先调 `resetRenderProgress()`：清空全局 `renderProgress.text` 及其内部跨 chunk 的半行缓冲，避免上一次渲染的 trace 残留到本页。
2. 再 `void loadSelected()`：`selectedName` 初值就是 `appState.currentName`，因此首屏即「当前工作项目」的视图。
3. 页面挂载即完成首屏渲染；后续任何刷新都经「重新加载」或切换下拉显式触发。

### 4.3 切换预览项目（`onProjectChange`）

1. `HfSelect` 的 `@change` 直接给新值（已写入 `selectedName`），处理函数只做 `await loadSelected()`。
2. `loadSelected` 会按新 `selectedName` 重新判定并装载；**`appState.currentName` 全程不变**，其它页面（字幕 / 内容 / HTML 生成）的上下文不受影响。
3. 切到没有成品的项目不会报错，只在状态条给出引导文案。

### 4.4 重新加载（`onReload`）

1. `await refreshProject()`：重新拉项目列表并 `projectTools.load()` **当前工作项目**，使 `appState.myProjects` 与 `appState.project` 反映最新磁盘状态。
2. **回落保护**：若 `selectedName` 已不在 `appState.myProjects` 里（所选项目被删除或改名），把它改回 `appState.currentName`，避免停在一个不存在的项目上。
3. `await loadSelected()` 重新判定并装载。
4. `toast` 反馈：装载成功 → 「已重新加载视频成品」；仍无成品 → 「该项目暂无视频成品」。
5. **按钮始终可用**：语义由「无成品时禁用」改为「随时重读项目清单与所选项目的产物」——这正是发现「别的项目刚渲染完 / 所选项目已被删除」的入口。

### 4.5 状态文案的合并显示

- 渲染期间：全局 `renderProgress.text` 由 `useRenderProgress.ts` 里 `App.vue` 挂载时注册的 `hfTools.onProgress` 回调持续写入（如「渲染中 · 逐帧捕获（已用 45s · 帧 320/900）」），`statusText` 因此优先显示它。只有 CLI 长阶段的 trace 才会写入；普通日志行与内部微阶段不写，此时状态条保持上一条文案。渲染由「HTML生成」页发起，本页只是同屏复用同一份全局进度文案。
- 非渲染期间 / trace 已被清空时：`renderProgress.text === ''`，回退显示 `localStatus`（如「已加载「某项目」的视频成品」或两条引导文案）。
- 本页用 `statusClass` 这个 ref（而非再派生一个 computed）：状态类始终跟着本页分支走，与 trace 文案是否接管无关。
- 挂载时调的是 `resetRenderProgress()`（清文案 + 清半行缓冲），而不是只把 `renderProgress.text` 置空。

## 5. 依赖与协作

### 5.1 import

| 来源 | 名称 | 用途 |
|------|------|------|
| `vue` | `computed`、`nextTick`、`onMounted`、`ref` | 响应式、`loadSelected` 的卸源时序与生命周期 |
| `@renderer/composables/useAppStore` | `appState`、`refreshProject` | 读项目清单（`myProjects` 的 `hasVideo` / `hasHtml`）与当前项目，刷新项目 |
| `@renderer/composables/useToast` | `toast` | 重新加载结果的轻提示 |
| `@renderer/composables/useRenderProgress` | `renderProgress`、`resetRenderProgress` | 全局渲染进度文案的读与复位 |
| `@renderer/components/StepBar.vue` | `StepBar` | 顶部步骤条 |
| `@renderer/components/HfSelect.vue` | `HfSelect`（默认）、`type HfSelectGroup` | 「预览项目」下拉（全库自绘下拉的统一组件） |

> 本页**不**引入 `@shared/types`（`ProjectMaterial` 等）、`@renderer/utils/render`、`@renderer/utils/escape`、`@renderer/composables/useRenderOptions`：没有档位下拉、没有转义需求、也不参与渲染档位的读写。

### 5.2 调用的 preload API 与 IPC 频道

| preload 调用 | IPC 频道 | 方向 |
|--------------|----------|------|
| `window.projectTools.load(name)` | `project:load` | renderer → main（invoke）；**仅当所选项目不是当前工作项目时**才调用，用于取该项目的 `videoPath` |
| `window.hfTools.showInFolder(filePath)` | `video:show-in-folder` | renderer → main（invoke） |
| `window.projectTools.list()`、`window.projectTools.load(name)` | `project:list`、`project:load` | 经 `refreshProject()` 间接调用 |
| `window.hfTools.onProgress(cb)` | `video:progress` | main → renderer（进度推送，由 `useRenderProgress.ts` 在 `App.vue` 中挂载一次） |

**本页不调用** `window.hfTools.renderVideo()`（`video:render`，唯一入口在「HTML生成」页）与 `window.projectTools.saveVideo()`（`project:save-video`，同样只在「HTML生成」页的 `onRenderVideo` 里调）。**本次改动没有新增任何 IPC 频道**：项目清单与成品路径复用既有的 `project:list` / `project:load`。

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import VideoPreviewPage from './VideoPreviewPage/index.vue'`，注册为 `pages['video-preview']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行 `onMounted`（`selectedName` 也随之回到当前工作项目）。

## 6. 注意事项与实现要点

1. **`file:///` 拼接**：路径先 `replace(/\\/g, '/')` 再 `encodeURI`，最后前置 `file:///`；中文目录与空格依赖 `encodeURI` 处理，不要改成 `encodeURIComponent`。
2. **载入前先卸源**：`loadSelected` 先把 `videoSrc` 置空、必要时 `await nextTick()`，让浏览器先卸载旧媒体再挂新 URL；否则同一个 `videoPath` 下重新渲染出的新 MP4 可能因 URL 未变而不被重新读取。本页不持有 `<video>` 的元素引用，播放控制完全交给原生 `controls`。
3. **切预览 ≠ 切工作项目**：`selectedName` 只服务本页播放；`appState.currentName` 不受影响。引导文案因此都写着「把它切为工作项目」。
4. **下拉只列有成品（+ 当前项目）**：其余项目一律要求 `m.hasVideo`；当前项目即使没有成品也保留在首项，并用「（无视频成品）」后缀说明。
5. **状态类名三态**：`''`（初始 / 无成品引导）、`'hf-ok'`（已载入）、`'hf-error'`（保留取值，本页当前分支不写入），模板只做 `:class="statusClass"` 绑定。
6. **`statusText` 的优先级顺序**：全局 trace 优先于本地文案；挂载时调 `resetRenderProgress()` 是为了不让上一轮渲染的残留 trace 抢占首屏文案。
7. **无成品不等于报错**：`hasVideo` 为假时只写引导文案、不写 `hf-error`，状态条保持中性；工具栏的「在文件夹中显示」用 `:disabled="!videoPath"` 拦下，「重新加载」则**始终可用**。
8. **「重新加载」兼顾清单刷新与回落**：它先 `refreshProject()` 再判「所选项目是否还在清单里」，不在就回落到当前工作项目——所选项目被删除 / 改名后不会停在一个不存在的项目上。
9. **上游动作在「HTML生成」页**：正式渲染与档位选择见 [`HtmlGenPage.md`](./HtmlGenPage.md)；本页只消费其结果（`project.json` 里的 `videoPath` 经 `refreshProject()` 进入 `appState.project`，其它项目经 `project:load` 现取）。
