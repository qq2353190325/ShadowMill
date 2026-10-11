# src/renderer/src/pages/HtmlGenPage/（页面）

> HTML 生成 / 修改 + 实时预览 + AI 思考过程展示。

- **覆盖文件**：`HtmlGenPage/index.vue`（本目录唯一文件，477 行）
- **所在目录**：`src/renderer/src/pages/HtmlGenPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：477 行
- **对外导出**：默认导出组件（无 props；模板内渲染子组件 `StepBar`）

## 1. 作用与职责

本页是流水线的「HTML」环节（`PageKey = 'html-gen'`）：用户填写需求描述并选配项目素材，调用主进程 Agent 生成或修改项目 `index.html`；同时把 Agent 的阶段文案与思考原文实时渲染出来，并在 `hgpreview://` 协议下用 iframe 等比缩放预览产物。

| 职责 | 实现位置 |
|------|----------|
| 项目状态概览（原 `renderMeta` 的 `#hg-meta`） | `meta` computed + `.proj-meta` / `.proj-stat` |
| 需求描述（提示词）输入 | `prompt` + `textarea.hgen-subtitle` |
| 素材选配（字幕 / 背景音频 / 视频素材） | `subSel` / `audioSel` / `videoSel` + `.hgen-select` |
| 自定义素材导入（音频 / 视频 / 提取原声） | `onPickAudio` `onClearAudio` `onPickVideo` `onClearVideo` `onExtractAudio` |
| 复用「已生成音频」为背景音频（含试听 + 语速） | `genLoad` / `onGenUse` / `onRateInput` / `rateStep` |
| 生成 / 修改 HTML | `runAgent('generate')` / `onModify` → `runAgent('modify')` |
| 进度阶段文案 + AI 思考原文实时展示 | `onHtmlProgress` 订阅 + `status` / `thinkText` + `thinkPreEl` |
| 预览画布（1920×1080 等比缩放） | `loadFrame` + `fitFrame` + `iframe.hgen-frame` |
| 预览播放控制（暂停/播放/重新播放/进度条） | `onPrevToggle` `onPrevReplay` `onPrevMessage` |
| 下载 HTML 到本地 | `onDownload` |
| 顶部流程条 | `<StepBar :page="'html-gen'" />` |

## 2. 模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'html-gen'" />` | 顶部五节点流水线 + 工作项目切换条，`page` 传字面量 `'html-gen'` |
| `.card.hgen-panel`（第 1 张） | 标题「HTML · Agent 生成 / 修改」，含项目状态条、提示词、素材选配、三个操作按钮 |
| `.proj-meta` | 项目状态条（源码注释标为「原 renderMeta 的 `#hg-meta`」）。`meta.builtin` 为真时只展示一条只读提示；否则 `v-else` 渲染 4 条 `.proj-stat` |
| `.proj-stat`（HTML） | `:class="{ on: meta.hasH }"`，文案 `已生成` / `尚未生成` |
| `.proj-stat`（内容脚本） | `:class="{ on: meta.sceneN > 0 }"`，`meta.sceneN` 为场景数（按 `narration` 非空过滤），文案提示「生成时自动附带」 |
| `.proj-stat`（素材） | 字幕 `meta.subCount` 条 + 是否已配背景音频 / 视频素材；无字幕时引导去「字幕生成」页 |
| `.proj-stat`（用法） | 按 `meta.hasH` 给不同的操作引导文案 |
| `.hgen-block`（需求描述） | `textarea.hgen-subtitle`，`v-model="prompt"`、`spellcheck="false"`，占位符给出深空科技动画 / 字幕间隔 / 改配色三类示例 |
| `.hgen-block`（项目素材） | 三个 `select.hgen-select`：字幕 `v-model="subSel"`、背景音频 `v-model="audioSel"`、视频素材 `v-model="videoSel"`；每项首选项为空值（不使用），`__current__` 选项仅在 `!appState.isBuiltin` 且当前项目确有该素材时出现 |
| 字幕下拉的项目选项 | `v-for="mp in appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)"`，`:value="mp.name"`，文案带 `mp.subtitleCount` 条数 |
| `.hgen-tip`（素材块） | 说明所选素材的用途（字幕逐条设计动画 / 音频注入音轨 / 视频嵌入片段），留空 = 跳过 |
| `.hgen-actions` | `生成 HTML`（主按钮，`runAgent('generate')`）、`修改 HTML`（`onModify`）、`下载 HTML`（`onDownload`） |
| `.card.hgen-panel`（第 2 张） | 标题「自定义素材 · 导入为项目素材（可选）」 |
| 背景音频行 | `选择音频文件`（`onPickAudio`）、`.hf-file` 显示 `escTxt(appState.project.audioFile)` 或「未设置音频」、`移除音频`（`:disabled="!appState.project?.audioFile"`） |
| 已生成音频行 | `select` `v-model="genSelIdx"`（`v-for="(it, i) in genAudios"`，`:value="String(i)"`，空列表时显示「（暂无已生成音频）」）、`刷新`（`onGenRefresh`）、`试听`（`onGenPlay`）、`设为背景音频`（`:disabled="genUseDisabled"`，`onGenUse`） |
| 试听行 `v-show="genPlayRowVisible"` | `<audio ref="genAudioEl" :src="genAudioSrc" controls>` + 语速标签 + `−` / 输入框 / `+`（见第 4.8 节） |
| 视频素材行 | `选择视频文件`（`onPickVideo`）、`.hf-file` 显示 `escTxt(appState.project.videoMaterial)` 或「未设置视频」、`移除视频`（`onClearVideo`）、`{{ extractText }}`（`onExtractAudio`，`:disabled="!appState.project?.videoMaterial \|\| appState.isBuiltin"`） |
| 视频预览行 `v-show="videoPrevRowVisible"` | `<video ref="videoPrevEl" :src="videoPrevSrc" controls>` |
| `.card.hgen-panel`（第 3 张） | 标题「预览」 |
| `.hf-status` | `:class="statusClass"`，文本 `status`（阶段文案 / 结果文案 / 失败原因） |
| AI 思考过程区 `v-show="showThink"` | 蓝色描边块，标题「AI 思考过程（实时）」，内为 `<pre ref="thinkPreEl">{{ thinkText }}</pre>`（`max-height:220px;overflow-y:auto`） |
| `.empty-hint` `v-show="emptyVisible"` | 空态 / 失败态提示，文本 `emptyText` |
| `.hgen-frame-wrap` `v-show="frameVisible"` | 预览画布容器（`ref="frameWrapEl"`，CSS `padding-bottom:56.25%` 维持 16:9） |
| `iframe.hgen-frame` | `:src="frameSrc"`、`sandbox="allow-scripts allow-same-origin"`、`@load="onFrameLoad"` |
| `.hg-prev-ctl` `v-show="ctlVisible"` | `暂停`/`播放`（`prevToggleText`，`onPrevToggle`）、`重新播放`（`onPrevReplay`）、`.hg-prev-bar-fill`（宽度 `prevFillPct`）、`.hg-prev-time`（`prevTimeText`） |

## 3. 脚本逻辑

### 3.1 状态

| 名称 | 类型 | 说明 |
|------|------|------|
| `prompt` | `ref<string>` | 需求描述（提示词），生成/修改的入参 |
| `subSel` | `ref<string>` | 字幕素材选择值：`''` / `'__current__'` / 其他项目名 |
| `audioSel` | `ref<string>` | 背景音频选择值：`''` / `'__current__'` |
| `videoSel` | `ref<string>` | 视频素材选择值：`''` / `'__current__'` |
| `status` | `ref<string>` | 状态条文本 |
| `statusClass` | `ref<string>` | 状态条样式类：`''` / `'hf-ok'` / `'hf-error'` |
| `thinkText` | `ref<string>` | AI 思考原文，来自 `info.thinkText` |
| `thinkPreEl` | `ref<HTMLElement \| null>` | `<pre>` 引用，`watch(thinkText)` 中滚动到底部 |
| `showThink` | `computed<boolean>` | `thinkText.value.length > 0` |
| `meta` | `computed` | 项目状态条数据源；内置示例返回 `{ builtin: true, hasH: false, sceneN: 0, subCount: 0, audioFile: '', videoMaterial: '' }`，否则统计非空 `narration` 场景数并取 `hasHtml` / `subtitleCount` / `audioFile` / `videoMaterial` |
| `frameEl` | `ref<HTMLIFrameElement \| null>` | 预览 iframe 引用 |
| `frameWrapEl` | `ref<HTMLElement \| null>` | 预览容器引用，`fitFrame` 依据其 `clientWidth` 计算缩放 |
| `frameVisible` | `ref(false)` | 是否显示预览画布 |
| `frameSrc` | `ref('')` | iframe 地址（`hgpreview://` URL） |
| `emptyVisible` | `ref(true)` | 是否显示空态提示 |
| `emptyText` | `ref('尚未生成 HTML。')` | 空态 / 失败态文案 |
| `ctlVisible` | `computed<boolean>` | 等同 `frameVisible.value` |
| `prevPlaying` | `ref(true)` | 预览是否处于播放态，决定 `prevToggleText` |
| `prevDur` | `ref(0)` | 预览总时长（秒，来自 iframe 上报） |
| `prevTimeCur` | `ref(0)` | 预览当前时间（秒，来自 iframe 上报） |
| `prevFillPct` | `computed<string>` | 进度条宽度百分比，`prevDur > 0` 时上限 100，保留 2 位小数 |
| `prevTimeText` | `computed<string>` | `fmtPrev(cur) + ' / ' + (dur > 0 ? fmtPrev(dur) : '--:--')` |
| `prevToggleText` | `computed<string>` | `prevPlaying` 为真显示 `暂停`，否则 `播放` |
| `videoPrevSrc` | `ref('')` | 视频素材预览的 `file:///` URL |
| `videoPrevRowVisible` | `ref(false)` | 是否显示视频预览行 |
| `genAudios` | `ref<GenAudioItem[]>` | 已生成音频列表（`{ path, name, group, size, mtime }`） |
| `genSelIdx` | `ref('')` | 已生成音频下拉的索引字符串 |
| `genUseDisabled` | `ref(true)` | 「设为背景音频」禁用态（无选中或内置示例时为真） |
| `genPlayRowVisible` | `ref(false)` | 是否显示试听行（含语速控件） |
| `genAudioEl` | `ref<HTMLAudioElement \| null>` | 试听音频元素引用 |
| `genAudioSrc` | `ref('')` | 试听音频的 `file:///` URL |
| `extractText` | `ref('提取原声为背景音频')` | 提取按钮文案，提取中改为 `提取中…` |
| `rateEl` | `ref<HTMLInputElement \| null>` | 语速输入框引用 |
| `rateValue` | `ref('1')` | 语速输入框的受控值（`@input` 回写规范化结果） |
| `agentRunning` | `let agentRunning = false` | **模块级普通变量**（非 ref），生成/修改并发互斥标志 |

### 3.2 函数

| 名称 | 说明 |
|------|------|
| `watch(thinkText, …)` | 思考文本变化后把 `thinkPreEl.scrollTop` 设为 `scrollHeight`，实现自动滚到底部 |
| `fmtPrev(sec)` | 秒 → `mm:ss`（`Math.floor`、`padStart(2,'0')`） |
| `prevPost(type)` | 向 iframe 的 `contentWindow` 发送 `{ __hg: true, type }`，目标源 `'*'` |
| `onPrevMessage(ev)` | 过滤 `d.__hg && d.type === 'progress'`，写入 `prevTimeCur` / `prevDur`；播放中且到达 `prevDur - 0.25` 时置 `prevPlaying = false`（视为自然播完） |
| `fitFrame()` | `frame.style.transform = 'scale(' + (wrap.clientWidth / 1920) + ')'` |
| `onFrameLoad()` | 每次 iframe 载入（含 `restart` 引发的 reload）复位 `prevPlaying = true`、`prevDur = 0`、`prevTimeCur = 0`，并调用 `fitFrame()` |
| `onPrevToggle()` | 无 `frameSrc` → `toast('暂无预览')`；已自然播完（`!prevPlaying && time >= dur - 0.25`）→ 发 `'restart'` 并重置进度；否则切换 `prevPlaying` 并发 `'play'` / `'pause'` |
| `onPrevReplay()` | 无 `frameSrc` → `toast('暂无预览')`；否则发 `'restart'` 并置 `prevPlaying = true` |
| `loadFrame()` | 调 `window.projectTools.previewHtml(appState.currentName)`；失败则关画布、显示 `emptyText`（`res.message` 或 `'预览副本生成失败'`）；成功则拼 `hgpreview://` URL 并显示画布 |
| `syncPreview()` | 状态联动：有真实 HTML（非内置 + `htmlExists` + `htmlPath`）→ `loadFrame()`；否则关画布并显示空态文案 |
| `runAgent(mode)` | 生成/修改主流程（见第 4.3 / 4.4 节） |
| `onModify()` | 无 `htmlExists` → `toast('还没有 HTML，先「生成 HTML」')`；否则 `runAgent('modify')` |
| `onDownload()` | 内置示例走 `downloadFile`，否则走 `downloadHtml`；按 `ok` / `canceled` / `message` 分支提示 |
| `onPickAudio()` | 内置守卫 → `pickAudio()` → `setAudio(currentName, picked)` → 清 `audioSel` → `refreshProject()` |
| `onClearAudio()` | 内置守卫 → `clearAudio(currentName)` → 清 `audioSel` → `refreshProject()` |
| `syncVideoPreview(absPath)` | 有绝对路径则置 `videoPrevSrc` 为 `'file:///' + encodeURI(路径反斜杠转正斜杠)` 并显示预览行，否则清空并隐藏 |
| `onPickVideo()` | 内置守卫 → `pickVideo()` → `setVideo(currentName, picked)` → 清 `videoSel` → `refreshProject()` → `syncVideoPreview(res.abs)` |
| `onClearVideo()` | 内置守卫 → `clearVideo(currentName)` → 清 `videoSel` → `refreshProject()` → `syncVideoPreview('')` |
| `onExtractAudio()` | 内置守卫 + 无视频素材守卫 → 文案改 `提取中…` → `extractVideoAudio(currentName)` → 恢复文案并提示结果 |
| `genUpdate()` | 按 `genSelIdx` 取 `genAudios` 项；无项则禁用「设为背景音频」；有项则 `genUseDisabled = appState.isBuiltin`、生成 `genAudioSrc`、显示试听行 |
| `onGenRefresh()` | `genLoad(false)`（非静默，失败会 toast） |
| `genLoad(silent)` | `window.voiceTools.listGenerated()`；失败时非静默才 toast；列表为空则复位索引 / 禁用 / 隐藏试听行，否则 `genUpdate()` |
| `onGenPlay()` | 无元素或无 `genAudioSrc` → `toast('请先选择已生成音频')`；`paused` 则 `play()`（catch 提示文件可能被移动），否则 `pause()` |
| `onGenUse()` | 未选中 → toast；内置守卫；`setAudio(currentName, it.path)` → 清 `audioSel` → `refreshProject()` |
| `onRateInput()` | `rateValue.value = String(applyRate(rateEl.value, genAudioEl.value))` |
| `rateStep(delta)` | `rateValue.value = String(stepRate(rateEl.value, genAudioEl.value, delta))` |
| `onMounted(cb)` | 内置示例 toast 提示；清空 `status` / `statusClass` / `thinkText`；注册 `onHtmlProgress`；注册 `message`、`resize` 监听；`syncPreview()`；`genLoad(true)` |
| `onBeforeUnmount(cb)` | `removeEventListener('message', onPrevMessage)`、`removeEventListener('resize', fitFrame)` |

## 4. 关键流程

### 4.1 挂载加载（`onMounted`）

1. `appState.isBuiltin` 为真时提示「当前是内置示例项目（只读），请切换到自己的项目」。
2. 复位 `status`、`statusClass`、`thinkText`，避免复用实例时残留上一次会话的文案。
3. `window.projectTools.onHtmlProgress((info) => …)` 注册进度回调（preload 侧为**单订阅**：重复注册只替换回调，因此切页不会叠加监听）。
4. 注册 `window.addEventListener('message', onPrevMessage)` 与 `window.addEventListener('resize', fitFrame)`；卸载时在 `onBeforeUnmount` 成对移除（替代旧版模块级 once-guard）。
5. `syncPreview()` 决定预览或空态；`genLoad(true)` 静默预载已生成音频列表。

### 4.2 生成预览副本与 iframe 载入

1. `loadFrame()` 调 `window.projectTools.previewHtml(appState.currentName)`；主进程读取项目 `index.html`，注入播放控制脚本后写出同目录 `index.preview.html`（并为副本剥离 CSP），返回 `{ ok, previewPath }`。**本页不调用 `projectTools.readHtml`**，读取发生在主进程内部。
2. 失败（`!res || !res.ok`）：隐藏画布、清空 `frameSrc`、`emptyText` 取 `res.message` 或 `'预览副本生成失败'`。
3. 成功：`relFile` 由 `previewPath` 按 `[\\/]` 取文件名（兜底 `'index.preview.html'`），拼出
   `'hgpreview://p/' + encodeURIComponent(appState.currentName) + '/' + encodeURIComponent(relFile) + '?v=' + Date.now()`。
   源码注释说明两点原因：dev 的 http 页面下 `file://` iframe 会被 Chromium 拦截，故走自定义协议；`?v=` 时间戳强制重新加载。
4. `frameVisible = true`、`emptyVisible = false`；iframe `@load` 触发 `onFrameLoad()` 复位进度并按容器宽度 `fitFrame()`。

### 4.3 生成 / 修改 HTML（`runAgent`）

1. `agentRunning` 为真 → `toast('上一个请求还在处理中，请稍候')` 并返回（重复提交防护）。
2. `appState.isBuiltin` → 只读提示并返回；`prompt.trim()` 为空 → `toast('请先填写需求描述（上方提示词输入框）')` 并返回。
3. 置 `agentRunning = true`，按 `meta.sceneN` 写初始状态文案：有场景为「将附带当前项目内容脚本（N 个场景），已提交给 Agent，处理中...」，无场景为「当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...」，并清空 `statusClass`。
4. 组装 `materials = { subtitleProject: subSel.value, audioPath: audioSel.value, videoPath: videoSel.value }`；`'__current__'` 语义由主进程 `resolveMaterials` 解释，`''` = 跳过该素材。
5. 按模式调用 IPC：`mode === 'generate'` → `window.projectTools.generateHtml(appState.currentName, p, materials)`；否则 `window.projectTools.modifyHtml(appState.currentName, p, materials)`（preload 会把 `materials` 展开进 payload）。
6. 成功（`res.ok`）：`await refreshProject()` → `syncPreview()` → `status = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : '')`、`statusClass = 'hf-ok'`，并 toast「HTML 已生成」/「HTML 已修改」。
7. 失败：`status = res.message || '提交失败'`、`statusClass = 'hf-error'`，toast 同文案；若 `!appState.project?.htmlExists` 则关画布、清 `frameSrc`、`emptyVisible = true`（避免误显示为已生成）。
8. `finally` 中复位 `agentRunning = false`，保证异常路径也能再次提交。

### 4.4 进度阶段文案与思考原文

1. 主进程 Agent 的 `AgentProgress.stage` 取值为 `'connecting' | 'thinking' | 'writing' | 'retry' | 'done'`，主进程 `progressText` 把它翻成 `正在连接模型…` / `AI 正在推理中…（已思考 N 字符）` / `AI 正在生成 HTML…（已输出 N 字符）` / `本次输出为空，正在升档重试…` / `模型输出完成，正在写入文件…`，随 `IPC.Project.HtmlProgress` 推送。
2. 本页回调只用两个字段：`info.text` → `status`（同时清空 `statusClass`，让进度文案使用默认样式）；`info.thinkText` → `thinkText`（`String(info.thinkText || '')`）。
3. 主进程上报时对思考原文做**尾部截断**：`thinkText.slice(-20000)`，即最多 2 万字符的末尾片段；完整思考原文与 `thinkChars` / `contentChars` 会落到 userData 下 `html-agent/chat.jsonl` 供分析。
4. `thinkText` 非空即 `showThink` 为真显示思考区；`watch` 每次更新把 `<pre>` 滚到底部，形成「实时滚动」观感。

### 4.5 预览 postMessage 协议

父页 → iframe：`prevPost(type)` 发送 `{ __hg: true, type }`，`type` 取 `'pause'` / `'play'` / `'restart'`；副本注入脚本收到 `'restart'` 时执行 `location.reload()`。

iframe → 父页：副本每 300ms 上报 `{ __hg: true, type: 'progress', time, dur }`（时长/时间取 `<audio>/<video>` 与 `gsap.globalTimeline` 的较大值）。

父页处理：`onPrevMessage` 只接受 `d.__hg && d.type === 'progress'`，写 `prevTimeCur = Number(d.time) || 0`、`prevDur = Number(d.dur) || 0`；当处于播放态且 `prevTimeCur >= prevDur - 0.25` 时把 `prevPlaying` 置回 false（进度停满、按钮回到「播放」，再点即从头重播）。

监听在 `onMounted` 注册、`onBeforeUnmount` 移除，成对管理。

### 4.6 下载 HTML（`onDownload`）

1. 分支判定：`appState.isBuiltin && appState.project && appState.project.htmlPath` 为真时用 `window.projectTools.downloadFile(appState.project.htmlPath, appState.currentName + '.html')` 直接导出示例自带 `index.html`（只读，不落盘到 userData 项目）；否则用 `window.projectTools.downloadHtml(appState.currentName)`。
2. `res` 为空直接返回；`res.ok` → `toast('已导出：' + res.savedPath)`；`canceled`（用户取消保存对话框）不提示；其他失败 `toast(res.message || '下载失败')`。

### 4.7 状态联动（有 HTML → 自动预览；无 HTML → 空态）

`syncPreview()` 的判定条件为 `!appState.isBuiltin && !!(appState.project && appState.project.htmlExists && appState.project.htmlPath)`：

- 为真 → `loadFrame()` 生成副本并挂载 iframe。
- 为假 → `frameVisible = false`、`frameSrc = ''`、`emptyVisible = true`，`emptyText` 按 `appState.isBuiltin` 给两种文案：内置示例引导去「视频生成」页查看并切换项目；否则为「尚未生成 HTML。」（不展示空 iframe）。

调用时机：`onMounted`、生成/修改成功后、以及失败且项目无 HTML 时。

### 4.8 语速控件（`applyRate` / `stepRate`）

1. 模板中 `−` / `+` 按钮分别调用 `rateStep(-0.05)` / `rateStep(0.05)`；输入框为 `:value="rateValue"`、`@input="onRateInput"`，`inputmode="decimal"`。
2. 两者都作用于 `utils/rate.ts` 的共享实现：`applyRate(el, audio)` 解析输入值，非有限值回退 1，再 `rateClamp` 到 `0.5~2.0`，写回 `el.value` 并设置 `audio.playbackRate`；`stepRate(el, audio, delta)` 在此基础上按 `Math.round((v + delta) * 100) / 100` 步进后同样钳制。
3. **只改播放 `playbackRate`，不改磁盘音频**；本页把返回值同步回 `rateValue`，使输入框显示规范化后的值。

## 5. 依赖与协作

| 依赖 | 用途 |
|------|------|
| `vue`：`computed, onBeforeUnmount, onMounted, ref, watch` | 响应式状态与生命周期 |
| `@renderer/composables/useAppStore`：`appState, hasHtml, refreshProject` | 全局项目状态、`hasHtml` 判定、刷新项目列表与详情 |
| `@renderer/composables/useToast`：`toast` | 统一的轻提示 |
| `@renderer/utils/escape`：`escTxt` | 音频 / 视频文件名渲染前转义 `& < >` |
| `@renderer/utils/rate`：`applyRate, stepRate` | 试听语速控件共享逻辑 |
| `@renderer/components/StepBar.vue` | 顶部流水线步骤条 + 工作项目切换 |

调用的 preload / IPC（均挂在 `window.projectTools`）：

| 方法 | 用途 |
|------|------|
| `previewHtml(name)` | 生成 `index.preview.html` 预览副本，返回 `previewPath` |
| `generateHtml(name, prompt, materials)` | 生成 `index.html` |
| `modifyHtml(name, prompt, materials)` | 基于现有 HTML 改造并覆盖 |
| `downloadHtml(name)` | 另存项目 HTML |
| `downloadFile(srcPath, defaultName)` | 内置示例直接导出示例 HTML |
| `pickAudio()` / `setAudio(name, audioPath)` / `clearAudio(name)` | 背景音频选择 / 设置 / 移除 |
| `pickVideo()` / `setVideo(name, videoPath)` / `clearVideo(name)` | 视频素材选择 / 设置 / 移除 |
| `extractVideoAudio(name)` | 提取视频原声为背景音频 |
| `onHtmlProgress(callback)` | 订阅 `IPC.Project.HtmlProgress` 流式进度（单订阅） |

另有 `window.voiceTools.listGenerated()`（已生成音频列表；`window.hfTools` 的 `listProjects` 由 `refreshProject()` 内部使用，本页不直接调用）。

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import HtmlGenPage from './HtmlGenPage/index.vue'`，注册为 `pages['html-gen']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行 `onMounted`。

## 6. 注意事项与实现要点

- **内置示例只读守卫**：`runAgent`、`onPickAudio`、`onClearAudio`、`onPickVideo`、`onClearVideo`、`onExtractAudio`、`onGenUse` 均在入口处拦截 `appState.isBuiltin` 并提示切换到「我的项目」；`meta`、`hasHtml`、`syncPreview` 也把内置项目排除在「已生成」之外。下载是唯一允许的只读操作（走 `downloadFile`）。
- **失败提示**：Agent 失败时状态条用 `hf-error` 并同时 toast；仅当项目原本无 HTML 才恢复空态，避免把「已存在的旧 HTML」误标为未生成。
- **预览缩放实现**：iframe CSS 固定 `1920px × 1080px` + `transform-origin: 0 0`，容器用 `padding-bottom: 56.25%` 撑出 16:9 高度；`fitFrame()` 以容器 `clientWidth / 1920` 设置 `transform: scale(...)`，因此预览画布带缩放变换，内部坐标可继续按 1920×1080 计算。窗口 `resize` 与每次 `load` 都会重新缩放。
- **思考文本截断**：页面展示的是主进程 `thinkText.slice(-20000)` 的结果（仅末尾片段），完整原文写入 userData 下 `html-agent/chat.jsonl`；`<pre>` 自身 `max-height:220px` 且可滚动，配合 `watch` 自动滚底。
- **思考区样式与状态样式互斥**：进度回调每次设置 `status` 都会把 `statusClass` 清空，只有最终成功/失败分支才写入 `hf-ok` / `hf-error`。
- **取消 / 重复提交防护**：`agentRunning` 为模块级普通变量（非响应式），`try/finally` 保证复位；并发点击「生成 HTML」会被直接 toast 拒绝。「修改 HTML」在前置校验（`htmlExists`）后复用同一入口。
- **进度订阅的单订阅语义**：`onHtmlProgress` 在 preload 中只绑定一次 `ipcRenderer.on`，后续注册仅替换回调；本页因此只需在 `onMounted` 注册、无需（也无法）取消订阅。
- **事件监听成对**：`message` 与 `resize` 监听在 `onBeforeUnmount` 移除，避免切页后仍响应 iframe 上报或 resize。
- **播放控制边界**：`ctlVisible` 跟随 `frameVisible`；无 `frameSrc` 时点「暂停/播放」「重新播放」只 toast「暂无预览」。自然播完判定带 `0.25s` 容差，避免因上报精度抖动而卡在「暂停」。
- **预览副本与原件分离**：预览用 `index.preview.html`（剥离 CSP、注入控制脚本），下载与转视频始终使用原件 `index.html`。
- **素材选择联动**：新增 / 移除音频或视频后都会清空对应 `*Sel`（回到「不使用」），必须先 `refreshProject()` 让下拉的 `__current__` 选项重新出现再选择。
- **语速仅影响试听**：`applyRate` / `stepRate` 只改 `playbackRate`，不写磁盘、不影响最终产物。
