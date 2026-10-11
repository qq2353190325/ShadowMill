# src/renderer/src/pages/HtmlGenPage/（页面）

> HTML 生成 / 修改 + 素材选配（字幕 / 视频）+ 背景音频选定（音轨由主进程注入 HTML）+ 实时预览 + AI 思考过程展示 + **转视频（点按钮先开「渲染档位」弹窗，确认后渲染）**。

- **覆盖文件**：`HtmlGenPage/index.vue`（本目录唯一文件，658 行）
- **所在目录**：`src/renderer/src/pages/HtmlGenPage/`
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：658 行
- **对外导出**：默认导出组件（无 props；模板内渲染子组件 `StepBar`）

## 1. 作用与职责

本页是流水线的「HTML」环节（`PageKey = 'html-gen'`）：用户填写需求描述并选配项目素材，调用主进程 Agent 生成或修改项目 `index.html`；同时把 Agent 的阶段文案与思考原文实时渲染出来，并在 `hgpreview://` 协议下用 iframe 等比缩放预览产物。

生成侧是**两个并列的按钮**：「生成 HTML」（主按钮，不参考现有页面、从零做一版）与「按需求修改」（次要按钮，在当前页面基础上改一版）。两者的区别不靠按钮文案自适应，而是由**每个动作按钮内部各带一个的行内帮助 `?`**（`.hg-help`，悬浮只显示该动作自己的说明）承载；「按需求修改」在没有 HTML 时直接禁用（仍可用「生成 HTML」从零生成）。**「生成 HTML」点一次即执行，没有二次确认**：已有 HTML 时它会直接覆盖 `index.html`（按钮文案恒为「生成 HTML」，不随状态自适应），要留底稿只能自己先点「下载 HTML」。主进程 `project:generate-html` / `project:modify-html` 两个 handler 未变、也没有合并——界面只是把它们分别挂在两个按钮后面。

**「转视频」也已并入本页**（渲染动作原在独立的视频页，现已整体搬到这里）：动作行多一个「转视频」按钮，**点它先弹出「转视频」弹窗**（`.hf-modal-mask`，内为「渲染档位」：质量 / 帧率 + 档位来源说明 + 画质说明 + 按需出现的「恢复默认档位」），在弹窗里点「开始渲染」才真正发起渲染；渲染成功后就地回写项目并 toast 引导去「视频预览」页看成片。这样做的原因是渲染需要 HTML 生成流程的上下文（`hasHtml` / `htmlPath`），放在同一页即可用同一个按钮闭环；而档位从「页面下方一行常驻控件」改成「弹窗内确认一次」，是为了让选档位 → 确认成为一次显式动作，也避免误改落盘。

| 职责 | 实现位置 |
|------|----------|
| 项目状态概览（原 `renderMeta` 的 `#hg-meta`） | `meta` computed + `.proj-meta` / `.proj-stat` |
| 需求描述（提示词）输入 | `prompt` + `textarea.hgen-subtitle`（`:placeholder="promptPlaceholder"`，占位文案随 `hasHtml` 变） |
| 生成素材选配（字幕 / 视频素材，均在「项目素材」块） | `subSel` / `videoSel` + `.hgen-select` |
| 视频素材（**唯一入口**）：选择 / 当场导入 / 移除 / 提取原声 | `videoSel` 下拉 + `onVideoSelect` `onClearVideo` `onExtractAudio`（下拉初值与复位由 `currentVideoSel` / `syncVideoSelFromProject` 维护） |
| 背景音频选定（在「预览」卡片内：已生成音频下拉 / 选文件 / 移除 / 试听 + 语速） | `genLoad` / `onAudioPick` / `onPickAudioFile` / `onRemoveAudio` / `onRateInput` / `rateStep` |
| 背景音轨注入 HTML（**不进提示词、不交给 Agent**） | 主进程 `applyBgmToHtml`；本页只负责选定后重载预览（`afterAudioChange`） |
| **生成 HTML**（主按钮，**点一次即执行，无二次确认**；已有 HTML 时直接覆盖） | `onGenerate` → `runAgent('generate')` |
| **按需求修改**（次要按钮，无 HTML 时禁用） | `onModify` → `runAgent('modify')`（函数内仍有 `htmlExists` 兜底守卫） |
| 行内帮助 `?`（**每个动作按钮内部各一个**，各自只说明自己那个动作） | 按钮内部的 `.hg-help` > `.hg-help-icon`（`?`）+ `.hg-help-pop`（说明气泡）；纯模板 + CSS、无脚本，`@click.stop` 使点 `?` 不触发按钮动作 |
| **转视频**（渲染动作原在独立的视频页；**先弹窗确认档位**） | `openRenderModal()`（守卫后打开弹窗）→ `confirmRenderVideo()` → `onRenderVideo()` → `window.hfTools.renderVideo(htmlPath, { quality, fps })` → `saveVideo` → `refreshProject()` |
| 渲染档位（**在「转视频」弹窗内**：质量 / 帧率、项目级覆盖、恢复默认） | `quality` / `fps` / `projectOverride` / `overridden` / `optionNote` + `syncFromEffective()` / `onOptionChange()` / `onResetOptions()` |
| 状态合并显示（渲染中优先显示全局 trace） | `statusDisplay` / `statusDisplayClass` computed |
| 进度阶段文案 + AI 思考原文实时展示 | `onHtmlProgress` 订阅 + `status` / `thinkText` + `thinkPreEl` |
| 预览画布（1920×1080 等比缩放） | `loadFrame` + `fitFrame` + `iframe.hgen-frame` |
| 预览播放控制（暂停/播放/重新播放/进度条） | `onPrevToggle` `onPrevReplay` `onPrevMessage` |
| 下载 HTML 到本地 | `onDownload` |
| 顶部流程条 | `<StepBar :page="'html-gen'" />` |

## 2. 模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'html-gen'" />` | 顶部五节点流水线 + 工作项目切换条，`page` 传字面量 `'html-gen'` |
| `.card.hgen-panel`（第 1 张） | 标题仍随状态自适应：`HTML · Agent {{ hasHtml ? '修改' : '生成' }}`（无 HTML 时不出现「修改」字样）；卡片内区块顺序为 **`.proj-meta` 项目状态条 → `.hgen-block`「项目素材（均可选，留空则跳过）」（块内含 `.hgen-tip` 说明）→ `.hgen-block`「需求描述（提示词）」→ `.hgen-actions` 动作行**（原来的「渲染档位行 + 档位提示行」已整块搬进页面级的「转视频」弹窗，见下方弹窗行）。动作行是「生成 HTML」（主按钮，**按钮内含 `?`**）+「按需求修改」（次要按钮，**按钮内含 `?`**）+「下载 HTML」+「转视频」（内置示例下「转视频」不渲染）；两个 `?` 各自只讲自己那个动作，**动作行末尾不再有独立的 `?`**；「转视频」按钮与「转视频」弹窗同样仅非内置示例出现（按钮带 `v-if`，弹窗虽然一直在 DOM 里但只有「我的项目」下才可能被打开） |
| `.proj-meta` | 项目状态条（源码注释标为「原 renderMeta 的 `#hg-meta`」）。`meta.builtin` 为真时只展示一条只读提示；否则 `v-else` 渲染 4 条 `.proj-stat` |
| `.proj-stat`（HTML） | `:class="{ on: meta.hasH }"`，文案 `已生成` / `尚未生成` |
| `.proj-stat`（内容脚本） | `:class="{ on: meta.sceneN > 0 }"`，`meta.sceneN` 为场景数（按 `narration` 非空过滤），文案提示「生成时自动附带」 |
| `.proj-stat`（素材） | 字幕 `meta.subCount` 条 + 是否已配背景音频 / 视频素材；无字幕时引导去「字幕生成」页 |
| `.proj-stat`（用法） | 按 `meta.hasH` 给两种操作引导文案：已有 HTML → 「填写需求后点「按需求修改」（在当前页面上改）；想整页重来点「生成 HTML」（会直接覆盖当前页面，点一次即执行），也可「下载 HTML」备份」；未生成 → 「在「项目素材」里选好素材，再填写需求描述点「生成 HTML」；背景音频在下方「预览」里选定」 |
| `.hgen-block`（项目素材，**排在「需求描述」之前**） | 标题「项目素材（均可选，留空则跳过）」；区块内为字幕行 + 视频素材行（背景音频**不在此处**，已整体搬进「预览」卡片）。字幕为 `select.hgen-select` `v-model="subSel"`；视频行整块由 `<template v-if="!appState.isBuiltin">` 包住（内置示例只读、不显示），下拉见下面「视频素材行」——**视频素材全页只有这一个入口**（选项目现有素材或当场导入）：原先独立的视频素材导入卡片（导入 / 移除 / 提取原声 / 素材预览）已删除并全部并入这一行 |
| `.hgen-block`（需求描述，**排在「项目素材」之后**） | `textarea.hgen-subtitle`，`v-model="prompt"`、`spellcheck="false"`、`:placeholder="promptPlaceholder"`（**占位文案改为绑定，textarea 不再写死**）；文案随 `hasHtml` 变：已有 HTML 讲「这次要改什么」（换紫色霓虹配色 / 字幕节奏放慢），否则讲「你想要的 HTML 效果」（深空科技风格标题动画页 / 每条字幕间隔两秒依次上浮淡入） |
| 字幕下拉的项目选项 | `v-for="mp in appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)"`，`:value="mp.name"`，文案带 `mp.subtitleCount` 条数 |
| `.hgen-tip`（素材块） | 面向用户的说明（不含实现细节）：「所选素材会用在页面里：字幕逐条依次做动画，视频作为页面片段放进画面。下拉里的「选择本地视频文件…」会导入一份新素材并自动选中；某次不想用视频，选「不使用视频素材」即可。」 |
| 视频素材行（`.hgen-row`，在「项目素材」块内，整块由 `<template v-if="!appState.isBuiltin">` 包住） | 标签「视频素材」+ **唯一入口** `select.hgen-select`（`v-model="videoSel"`、`@change="onVideoSelect"`，`title` 为「把哪个视频片段放进页面；没有现成素材时可当场导入」）三个选项：`''`「不使用视频素材」/ `'__current__'`「当前项目视频素材（`appState.project.videoMaterial`）」（仅在该字段存在时出现）/ `'__pick__'`「选择本地视频文件…（导入为项目素材）」；右侧 `移除视频`（`:disabled="!appState.project?.videoMaterial"`，`onClearVideo`）与 `{{ extractText }}`（`:disabled="!appState.project?.videoMaterial"`，`title` 为「把视频里的声音提取出来，作为背景音频」，`onExtractAudio`） |
| 视频素材预览行（`.hgen-row`，与上一行同一 `<template>` 内）`v-show="videoPrevRowVisible"` | `<video ref="videoPrevEl" :src="videoPrevSrc" controls>`；`videoMaterial` 是项目内相对引用、渲染层拿不到绝对路径，因此该行只在**本次会话导入成功后**出现（与背景音频试听同一取舍） |
| `.hgen-actions` | 动作行，顺序固定为：**「生成 HTML」**（`hf-btn hf-btn-primary`，`:disabled="rendering"`，`@click="onGenerate"`，文案恒为字面量 `生成 HTML`，**无 `:title`、无自适应文案、无二次确认**）→ **「按需求修改」**（`hf-btn`，`:disabled="!hasHtml \|\| rendering"`，`@click="onModify"`，**无 `:title`**）→ 「下载 HTML」（`onDownload`，`title`「下载当前项目 HTML 到本地」）→ **「转视频」**（主按钮，`v-if="!appState.isBuiltin"`，`:disabled="!hasHtml \|\| rendering"`，`openRenderModal`，`title` 为「把当前 HTML 渲染成 MP4（约 30 秒）」）。**行内帮助 `?` 在 `<button>` 内部、每个动作按钮里各一个**（`<span class="hg-help" @click.stop>` > `.hg-help-icon`「?」 + `.hg-help-pop`），各自只说明自己那个动作、原文照抄：「生成 HTML」按钮内 —「不参考现有页面，从零做一版新的。点一次即开始并覆盖当前页面，想留底稿可先「下载 HTML」。」；「按需求修改」按钮内 —「在当前页面的基础上，按你描述的改一版——换配色、调节奏、改文案都用它。还没生成过 HTML 时不可用。」。**动作行末尾不再有独立的 `?`，也没有「两行对照」的合并说明**；`?` 上的 `@click.stop` 保证点它不触发按钮动作 |
| 「转视频」弹窗（页面级，位于两张卡片之外） | `.hf-modal-mask`（`v-show="renderModalVisible"`，遮罩点击自身关闭 `@click.self="closeRenderModal"`）> `.hf-modal`（行内 `style="width:min(520px,92vw)"` 收窄宽度；**样式全部复用 `assets/main.css` 的通用弹窗类，未新增 CSS 类**）：`.hf-modal-head`（`.hf-modal-title`「转视频」+ `.hf-modal-close`「×」，`title`「关闭」）→ `.hf-modal-body`（`.panel-title-sm`「渲染档位」（行内 `style="margin-top:0"`）→ 质量 `.hgen-row`（`label.sel-label`「质量」+ `select.hgen-select` `v-model="quality"`、`:disabled="rendering"`、`@change="onOptionChange"`、`style="flex:1"`）→ 帧率 `.hgen-row`（同上，`v-model="fps"`）→ 档位来源 `.hgen-row`（`style="margin-bottom:0"`：`.hf-file` 显示 `optionNote` + `v-if="overridden"` 的「恢复默认档位」）→ `.hgen-tip`）→ `.hf-modal-foot`（「取消」`closeRenderModal` / 「开始渲染」（主按钮）`confirmRenderVideo`） |
| `.hgen-tip`（**在弹窗内、档位来源行下方**） | `{{ qualityHint }}` + 「转视频」说明：「把当前 HTML 渲染成 MP4（约 30 秒）；渲染完成后到「视频预览」页查看成品。」|
| `.card.hgen-panel`（第 2 张） | 标题「预览」，卡片最上方是背景音频块（`<template v-if="!appState.isBuiltin">` 包住：内置示例只读、没有项目音频，整块不渲染） |
| 背景音频行（预览卡片内） | 标签「背景音频」+ `.hf-file` 显示 `escTxt(appState.project.audioFile)` 或「未设置音频」+ `select.hgen-select` `v-model="audioPick"`（首项「从已生成音频中选择…」、`v-for="(it, i) in genAudios"`、`:value="String(i)"`、`@change="onAudioPick"`，选中即生效）+ `选择音频文件…`（`onPickAudioFile`）+ `移除音频`（`:disabled="!appState.project?.audioFile"`，`onRemoveAudio`） |
| 试听行 `v-show="audioPreviewVisible"`（预览卡片内） | `<audio ref="audioEl" :src="audioSrc" controls>` + 语速标签 + `−` / 输入框 / `+`（见第 4.9 节） |
| `.hf-status` | `:class="statusDisplayClass"`，文本 `statusDisplay`（渲染中优先显示全局 trace，其余为阶段文案 / 结果文案 / 失败原因） |
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
| `promptPlaceholder` | `computed<string>` | 提示词框的 `:placeholder` 文案，随 `hasHtml` 变：已有 HTML → 「描述这次要改什么，例如：\n· 换成紫色霓虹配色，并把标题放大\n· 字幕出现得太快，节奏放慢一些」；否则 → 「描述你想要的 HTML 效果，例如：\n· 深空科技风格的标题动画页，标题为“我的作品集”\n· 每条字幕间隔两秒，依次从下方上浮淡入」（源码注释：没 HTML 时讲「要什么样的页面」，已有 HTML 时讲「这次改什么」） |
| `subSel` | `ref<string>` | 字幕素材选择值：`''` / `'__current__'` / 其他项目名 |
| `videoSel` | `ref<string>` | 视频素材下拉的**唯一选择值**：`''` = 不使用视频素材（本次生成不带视频）、`'__current__'` = 本次生成沿用当前项目视频素材、`'__pick__'` = **动作项**（选中即弹文件框导入为项目素材，导入成功后自动置回 `'__current__'`；取消 / 失败 / 内置示例则复位为 `currentVideoSel()`）。背景音轨不是生成素材，本页不再有「背景音频」下拉状态，相关状态见下面的 `audioPick` / `audioEl` / `audioSrc` / `audioPreviewVisible` |
| `audioPick` | `ref('')` | 「从已生成音频中选择…」下拉的索引字符串（`''` = 未选）；`@change="onAudioPick"` 选中即生效，用完立即复位为 `''` |
| `audioEl` | `ref<HTMLAudioElement \| null>` | 背景音频试听元素引用（语速控件作用于它） |
| `audioSrc` | `ref('')` | 背景音频试听的 `file:///` URL |
| `audioPreviewVisible` | `ref(false)` | 是否显示试听行（含语速控件） |
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
| `genAudios` | `ref<GenAudioItem[]>` | 已生成音频列表（`{ path, name, group, size, mtime }`），**仅用于填充「预览」卡片里「从已生成音频中选择…」下拉** |
| `extractText` | `ref('提取原声为背景音频')` | 提取按钮文案，提取中改为 `提取中…` |
| `rateEl` | `ref<HTMLInputElement \| null>` | 语速输入框引用 |
| `rateValue` | `ref('1')` | 语速输入框的受控值（`@input` 回写规范化结果） |
| `agentRunning` | `let agentRunning = false` | **模块级普通变量**（非 ref），生成/修改并发互斥标志 |
| `rendering` | `ref(false)` | 转视频进行中标志：禁用「转视频」/「生成 HTML」/「按需求修改」与弹窗里的两个档位下拉 |
| `renderModalVisible` | `ref(false)` | 「转视频」弹窗开关（`v-show` 控制 `.hf-modal-mask`）；只有点「转视频」经守卫后置真，点「取消」/「×」/遮罩/ESC 置假，点「开始渲染」在发起渲染前置假 |
| `qualityOptions` / `fpsOptions` | 常量 | 直接引用 `utils/render.ts` 的 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` |
| `quality` / `fps` | `ref<RenderQuality>` / `ref<RenderFps>` | 当前所选档位，初值取 `FALLBACK_RENDER`（`standard` / `30`），挂载时按 `effectiveRenderOptions()` 同步 |
| `projectOverride` | `computed<RenderOverride \| null>` | 当前项目的覆盖值：内置示例恒为 `null`，否则 `appState.project.render \|\| null` |
| `overridden` | `computed<boolean>` | `isRenderOverridden(renderDefaults, projectOverride.value)`：覆盖是否真的改变了生效档位（决定是否显示「恢复默认档位」与「本项目自定义档位」） |
| `optionNote` | `computed<string>` | 档位说明：内置示例为「内置示例（只读）：档位仅本次生效」；否则按 `overridden` 显示「本项目自定义档位」或「跟随设置页默认：<档位摘要>」 |
| `qualityHint` | `computed<string>` | 当前所选质量档位的 `hint`（末尾带 `；`），选「快速预览」时明确提示画质代价 |
| `statusDisplay` | `computed<string>` | `(rendering && renderProgress.text) ? renderProgress.text : status`——渲染中优先显示全局 trace |
| `statusDisplayClass` | `computed<string>` | trace 接管文本时返回 `''`（中性样式），否则返回本页 `statusClass` |

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
| `runAgent(mode)` | 生成/修改主流程（见第 4.3 / 4.4 节）：守卫通过后置 `agentRunning = true`，再按 `mode` 调 `generateHtml` / `modifyHtml` |
| `onGenerate()` | 「生成 HTML」按钮的处理（见 4.3）：渲染中 → `toast('正在渲染视频，请等它结束再提交需求')` 并返回；否则直接 `void runAgent('generate')`。**没有二次确认**：已有 HTML 时也一步直达（`index.html` 被直接覆盖），因此函数内不再有 `hasHtml` 分支，也不再需要「武装态」与定时器 |
| `onModify()` | 「按需求修改」按钮的处理（按钮本身在无 HTML 时已 `:disabled`，函数内仍留兜底守卫）：`!appState.project?.htmlExists` → `toast('还没有 HTML，先点「生成 HTML」')` 并返回，否则 `void runAgent('modify')` |
| `onDownload()` | 内置示例走 `downloadFile`，否则走 `downloadHtml`；按 `ok` / `canceled` / `message` 分支提示 |
| `setAudioPreview(absPath)` | 有绝对路径则置 `audioSrc` 为 `'file:///' + encodeURI(路径反斜杠转正斜杠)` 并显示试听行，否则清空 `audioSrc` 并隐藏试听行 |
| `afterAudioChange(tip, absPath)` | 设 / 换 / 移除背景音频的统一收尾：`await refreshProject()` → `setAudioPreview(absPath)` → `await loadFrame()` 重载预览 iframe（主进程已同步改写 `index.html` 的音轨，不重载就听不到）→ `toast(tip)` |
| `onPickAudioFile()` | 内置守卫 → `pickAudio()`（取消即返回）→ `setAudio(currentName, picked)`，失败 toast `res.message` 或「设置音频失败」；成功后 `afterAudioChange('已设为背景音频：' + res.audioFile, picked)` |
| `onAudioPick()` | 先取 `audioPick` 下标并**立即复位为 `''`** → `genAudios[Number(idx)]` 无对应条目直接返回 → 内置守卫 → `setAudio(currentName, it.path)`，失败 toast「设置背景音频失败」；成功后 `afterAudioChange('已设为背景音频：' + res.audioFile, it.path)` |
| `onRemoveAudio()` | 内置守卫 → `clearAudio(currentName)` → `afterAudioChange('已移除背景音频（HTML 里的音轨也已摘掉）', '')` |
| `syncVideoPreview(absPath)` | 有绝对路径则置 `videoPrevSrc` 为 `'file:///' + encodeURI(路径反斜杠转正斜杠)` 并显示预览行，否则清空并隐藏 |
| `onVideoSelect()` | 视频下拉（**唯一入口**）的 `@change` 处理：`videoSel.value !== '__pick__'` 直接返回（`''` / `'__current__'` 只是本次生成的选择，无需额外动作）；`'__pick__'` 时——内置示例 → toast 只读提示并把下拉复位为 `currentVideoSel()`；否则 `pickVideo()`（取消 → 复位）→ `setVideo(currentName, picked)`（失败 → toast `res.message` 或「设置视频失败」并复位）→ `await refreshProject()` → `syncVideoPreview(res.abs)` → `videoSel.value = '__current__'`（**导入即选中**，不必再去别处选一次）→ toast「已导入视频素材：…（本次生成会交给 Agent 嵌入该片段）」 |
| `currentVideoSel()` | 项目当前的真实选择：`appState.project?.videoMaterial` 存在返回 `'__current__'`，否则返回 `''` |
| `syncVideoSelFromProject()` | `videoSel.value = currentVideoSel()`——进页面时按项目状态初始化（项目里已有素材就默认选中，仍可切「不使用视频素材」） |
| `onClearVideo()` | 内置守卫 → `clearVideo(currentName)` → `await refreshProject()` → `syncVideoPreview('')` → `videoSel.value = currentVideoSel()` → toast「已移除视频素材」 |
| `onExtractAudio()` | 内置守卫 + 无视频素材守卫（toast「还没有视频素材：可在上方『视频素材』里选『选择本地视频文件…』导入」）→ 文案改 `提取中…` → `extractVideoAudio(currentName)` → 恢复文案；失败 toast。成功：`refreshProject()` → `setAudioPreview('')`（项目内音频没有渲染层可用的绝对路径，试听交给预览 iframe 里的音轨）→ `loadFrame()` 重载预览 → toast「已提取原声并设为背景音频：…」 |
| `genLoad()` | `window.voiceTools.listGenerated()`（`catch` 归为 `{ ok: false }`）；**无参数、失败静默返回**（下拉留空即可，生成音频不是本页必需）；成功则 `genAudios = res.items \|\| []`——只填充列表，不含选中 / 禁用 / 试听逻辑 |
| `onRateInput()` | `rateValue.value = String(applyRate(rateEl.value, audioEl.value))` |
| `rateStep(delta)` | `rateValue.value = String(stepRate(rateEl.value, audioEl.value, delta))` |
| `syncFromEffective()` | 用「项目覆盖 > 全局默认」的有效档位刷新下拉：`const eff = effectiveRenderOptions(); quality.value = eff.quality; fps.value = eff.fps` |
| `onOptionChange()` | 下拉改动 → `await saveProjectRenderOverride({ quality, fps })`（内部走 `project:set-render`）；失败且有 `message` 时 toast |
| `onResetOptions()` | `await saveProjectRenderOverride(null)` 清除项目覆盖；成功则 `syncFromEffective()` 回到跟随全局默认，失败且有 `message` 时 toast |
| `openRenderModal()` | 「转视频」按钮的处理（见 4.10）：依次做内置守卫、`rendering` 守卫、`agentRunning` 守卫、`htmlPath` / `htmlExists` 校验（四种情况都 toast 后返回，**不开弹窗**），全部通过才 `renderModalVisible = true` |
| `closeRenderModal()` | `renderModalVisible = false`；供「取消」、「×」、遮罩点击（`@click.self`）与 ESC 共用 |
| `confirmRenderVideo()` | 弹窗「开始渲染」：**先关弹窗**再 `void onRenderVideo()`（渲染进度显示在本页状态区，成品到「视频预览」页看） |
| `onModalKeydown(e)` | `document` 级 `keydown`：`e.key === 'Escape' && renderModalVisible.value` 时 `closeRenderModal()`（与「从音频生成字幕」弹窗一致） |
| `onRenderVideo()` | 转视频主流程（见 4.10）：内置守卫 → 进行中守卫 → **Agent 忙守卫** → `htmlPath` / `htmlExists` 校验 → `hfTools.renderVideo(htmlPath, { quality, fps })` → 成功后 `saveVideo` + `refreshProject()` + toast；IPC 异常在 `catch` 中转为失败状态（这些守卫与 `openRenderModal` 重复，用于兜住「弹窗打开后状态被改」的窗口期） |
| `onMounted(cb)` | 内置示例 toast 提示；清空 `status` / `statusClass` / `thinkText`；`resetRenderProgress()`；`syncFromEffective()`；`syncVideoSelFromProject()`（视频素材下拉按项目状态初始化）；注册 `onHtmlProgress`；注册 `message`、`resize`、`keydown`（`onModalKeydown`，供弹窗 ESC 关闭）监听；`syncPreview()`；`genLoad()` |
| `onBeforeUnmount(cb)` | `removeEventListener('message', onPrevMessage)`、`removeEventListener('resize', fitFrame)`、`document.removeEventListener('keydown', onModalKeydown)` |

## 4. 关键流程

### 4.1 挂载加载（`onMounted`）

1. `appState.isBuiltin` 为真时提示「当前是内置示例项目（只读），请切换到自己的项目」。
2. 复位 `status`、`statusClass`、`thinkText`，避免复用实例时残留上一次会话的文案。
3. `resetRenderProgress()` 清掉上一次渲染的 trace 残留（源码注释：渲染中若再次进入本页，随后仍会被新 trace 覆盖）；`syncFromEffective()` 把档位下拉刷成「项目覆盖 > 设置页全局默认」的生效值；`syncVideoSelFromProject()` 把视频素材下拉设为项目真实状态（有素材 → 「当前项目视频素材」，否则 → 「不使用视频素材」）。
4. `window.projectTools.onHtmlProgress((info) => …)` 注册进度回调（preload 侧为**单订阅**：重复注册只替换回调，因此切页不会叠加监听）。
5. 注册 `window.addEventListener('message', onPrevMessage)`、`window.addEventListener('resize', fitFrame)` 与 `document.addEventListener('keydown', onModalKeydown)`（弹窗 ESC 关闭）；卸载时在 `onBeforeUnmount` 成对移除（替代旧版模块级 once-guard）。
6. `syncPreview()` 决定预览或空态；`genLoad()` 预载已生成音频列表（填充「预览」卡片的「从已生成音频中选择…」下拉，失败静默）。

### 4.2 生成预览副本与 iframe 载入

1. `loadFrame()` 调 `window.projectTools.previewHtml(appState.currentName)`；主进程读取项目 `index.html`，注入播放控制脚本后写出同目录 `index.preview.html`（并为副本剥离 CSP），返回 `{ ok, previewPath }`。**本页不调用 `projectTools.readHtml`**，读取发生在主进程内部。
2. 失败（`!res || !res.ok`）：隐藏画布、清空 `frameSrc`、`emptyText` 取 `res.message` 或 `'预览副本生成失败'`。
3. 成功：`relFile` 由 `previewPath` 按 `[\\/]` 取文件名（兜底 `'index.preview.html'`），拼出
   `'hgpreview://p/' + encodeURIComponent(appState.currentName) + '/' + encodeURIComponent(relFile) + '?v=' + Date.now()`。
   源码注释说明两点原因：dev 的 http 页面下 `file://` iframe 会被 Chromium 拦截，故走自定义协议；`?v=` 时间戳强制重新加载。
4. `frameVisible = true`、`emptyVisible = false`；iframe `@load` 触发 `onFrameLoad()` 复位进度并按容器宽度 `fitFrame()`。

### 4.3 生成 / 修改 HTML：两个按钮 + 生成一步直达（`runAgent` / `onGenerate` / `onModify`）

生成侧在界面上是**两个并列的按钮，各自对应一个明确动作**：`生成 HTML`（主按钮 → `onGenerate`）与 `按需求修改`（次要按钮 → `onModify`）。两者的区别写在**每个动作按钮内部各自的 `?`** 里（`.hg-help`，悬浮只显示该动作自己的说明），按钮文案本身不随状态变化——上一版那条「按 `hasHtml` 分流到同一个按钮」的自适应路径及其处理函数已删除。

- **`生成 HTML`**：不参考现有页面，从零做一版新的（覆盖 `index.html`）。
- **`按需求修改`**：在当前页面基础上按需求改一版（整页输出、覆盖现有 HTML）；没有 HTML 时按钮直接 `:disabled`（仍可用「生成 HTML」从零生成）。

**「生成 HTML」点一次即执行，没有二次确认**：已有 HTML 时直接覆盖 `index.html`（不拦截、不弹确认框），按钮文案恒为「生成 HTML」。

**主进程侧两个 handler 依旧各自独立、没有合并**：界面把 `generate` 挂在「生成 HTML」按钮后面、把 `modify` 挂在「按需求修改」按钮后面——`generate` 的提示词不含现有页面，`modify` 的提示词含当前 `index.html` 全文。

1. `agentRunning` 为真 → `toast('上一个请求还在处理中，请稍候')` 并返回（重复提交防护）。
2. `rendering` 为真 → `toast('正在渲染视频，请等它结束再提交需求')` 并返回；`appState.isBuiltin` → 只读提示并返回；`prompt.trim()` 为空 → `toast('请先填写需求描述（上方提示词输入框）')` 并返回。
3. 置 `agentRunning = true`，再按 `meta.sceneN` 写初始状态文案：有场景为「将附带当前项目内容脚本（N 个场景），已提交给 Agent，处理中...」，无场景为「当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...」，并清空 `statusClass`。
4. 组装 `materials = { subtitleProject: subSel.value, videoPath: videoSel.value }`（**只有字幕与视频素材**：音轨不进提示词，见 4.8）；视频侧只有两种取值：`''` = 不使用、`'__current__'` = 当前项目视频素材——**自定义导入不走本载荷**（`onVideoSelect` 已用 `project:set-video` 把它复制进项目并登记，见 4.12），因此载荷里不会有文件路径；两者的语义由主进程 `resolveMaterials(proj, payload)` 解释。
5. 按模式调用 IPC：`mode === 'generate'` → `window.projectTools.generateHtml(appState.currentName, p, materials)`；否则 `window.projectTools.modifyHtml(appState.currentName, p, materials)`（preload 会把 `materials` 展开进 payload）。
6. 成功（`res.ok`）：`await refreshProject()` → `syncPreview()` → `status = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : '')`、`statusClass = 'hf-ok'`，并 toast「HTML 已生成」/「HTML 已修改」。主进程在 `index.html` 落盘后已按 `project.audioFile` 补注入音轨（见 4.8），`syncPreview()` 重新生成的预览副本因此自带音轨。
7. 失败：`status = res.message || '提交失败'`、`statusClass = 'hf-error'`，toast 同文案；若 `!appState.project?.htmlExists` 则关画布、清 `frameSrc`、`emptyVisible = true`（避免误显示为已生成）。
8. `finally` 中复位 `agentRunning = false`，保证异常路径也能再次提交。
9. **「生成 HTML」一步直达**（`onGenerate`，模板层）：按钮为 `hf-btn hf-btn-primary`、`:disabled="rendering"`、`@click="onGenerate"`、文案是**字面量 `生成 HTML`**（不再有 `{{ … ? … : … }}` 自适应文案）、**无 `:title`**。处理逻辑只有两步：渲染中 → `toast('正在渲染视频，请等它结束再提交需求')` 直接拒绝；否则 `void runAgent('generate')`。**没有二次确认**——`hasHtml` 为真时同样一步直达并覆盖 `index.html`（源码注释：想先备份可用「下载 HTML」），因此 `regenArmed` / `regenTimer` / `disarmRegen()` 这套武装态机制已整体删除，`onBeforeUnmount` 也不再需要清理定时器。
10. **「按需求修改」按钮**（`onModify`）：模板层为 `hf-btn`、`:disabled="!hasHtml || rendering"`、`@click="onModify"`、**无 `:title`**（无 HTML 时按钮直接禁用，不再靠点击后 toast 提示）；函数内仍保留 `htmlExists` 兜底守卫——`!appState.project?.htmlExists` → `toast('还没有 HTML，先点「生成 HTML」')` 并返回，否则 `void runAgent('modify')`。行内帮助 `?` 不在动作行末尾，而是**放进两个按钮内部、每个动作按钮各一个**（`.hg-help` / `.hg-help-icon` / `.hg-help-pop`，`@click.stop`），各自只说明自己：「**生成 HTML**：不参考现有页面，从零做一版新的。点一次即开始并覆盖当前页面，想留底稿可先「下载 HTML」。」「**按需求修改**：在当前页面的基础上，按你描述的改一版——换配色、调节奏、改文案都用它。还没生成过 HTML 时不可用。」（动作行末尾不再有独立的 `?`，也没有两行对照的合并说明）
11. **两个频道的提示词差异（主进程侧，未变）**：`project:generate-html` 的提示词只含需求 + 内容脚本 + 素材（**不含现有页面**）；`project:modify-html` 会把当前 `index.html` 全文作为 `extra` 置于提示词最前，要求「在此基础上改造后输出完整新 HTML」（见 [main/projects.ts.md](../../../main/projects.ts.md) §5.2 / §5.3）。

### 4.4 进度阶段文案与思考原文

1. 主进程 Agent 的 `AgentProgress.stage` 取值为 `'connecting' | 'thinking' | 'writing' | 'retry' | 'done'`，主进程 `progressText` 把它翻成 `正在连接模型…` / `AI 正在推理中…（已思考 N 字符）` / `AI 正在生成 HTML…（已输出 N 字符）` / `本次输出为空，正在升档重试…` / `模型输出完成，正在写入文件…`，随 `IPC.Project.HtmlProgress` 推送。
2. 本页回调只用两个字段：`info.text` → `status`（同时清空 `statusClass`，让进度文案使用默认样式）；`info.thinkText` → `thinkText`（`String(info.thinkText || '')`）。
3. 主进程上报时对思考原文做**尾部截断**：`thinkText.slice(-20000)`，即最多 2 万字符的末尾片段；完整思考原文与 `thinkChars` / `contentChars` 会落到 userData 下 `html-agent/chat.jsonl` 供分析。
4. `thinkText` 非空即 `showThink` 为真显示思考区；`watch` 每次更新把 `<pre>` 滚到底部，形成「实时滚动」观感。

### 4.5 预览 postMessage 协议

父页 → iframe：`prevPost(type)` 发送 `{ __hg: true, type }`，`type` 取 `'pause'` / `'play'` / `'restart'`；副本注入脚本收到 `'restart'` 时执行 `location.reload()`。

iframe → 父页：副本每 300ms 上报 `{ __hg: true, type: 'progress', time, dur }`（时长/时间取 `<audio>/<video>` 与 `gsap.globalTimeline` 的较大值；暂停/恢复另由副本的 `timelines()` 枚举 `window.__timelines` 的「对象 / 数组」两种形态并回退 `gsap.globalTimeline`，详见 [main/projects.ts.md](../../../main/projects.ts.md) §3.2）。

父页处理：`onPrevMessage` 只接受 `d.__hg && d.type === 'progress'`，写 `prevTimeCur = Number(d.time) || 0`、`prevDur = Number(d.dur) || 0`；当处于播放态且 `prevTimeCur >= prevDur - 0.25` 时把 `prevPlaying` 置回 false（进度停满、按钮回到「播放」，再点即从头重播）。

监听在 `onMounted` 注册、`onBeforeUnmount` 移除，成对管理。

### 4.6 下载 HTML（`onDownload`）

1. 分支判定：`appState.isBuiltin && appState.project && appState.project.htmlPath` 为真时用 `window.projectTools.downloadFile(appState.project.htmlPath, appState.currentName + '.html')` 直接导出示例自带 `index.html`（只读，不落盘到 userData 项目）；否则用 `window.projectTools.downloadHtml(appState.currentName)`。
2. `res` 为空直接返回；`res.ok` → `toast('已导出：' + res.savedPath)`；`canceled`（用户取消保存对话框）不提示；其他失败 `toast(res.message || '下载失败')`。
3. 两个频道在主进程侧都会把项目内的 `./gsap.min.js` 相对引用换回固定版本 CDN 地址后再写出（`hfEnv.externalizeGsapHtml`，`project:download-file` 仅对 `.html/.htm` 生效）——导出的是单个文件，不带同目录的 `gsap.min.js`，故导出物联网即可独立打开；项目目录内的原件不变。

### 4.7 状态联动（有 HTML → 自动预览；无 HTML → 空态）

`syncPreview()` 的判定条件为 `!appState.isBuiltin && !!(appState.project && appState.project.htmlExists && appState.project.htmlPath)`：

- 为真 → `loadFrame()` 生成副本并挂载 iframe。
- 为假 → `frameVisible = false`、`frameSrc = ''`、`emptyVisible = true`，`emptyText` 按 `appState.isBuiltin` 给两种文案：内置示例引导去「视频预览」页查看效果并切换项目（原文「内置示例项目为只读：自带示例 HTML，可到「视频预览」页查看效果；生成请先在顶部「工作项目」切换到「我的项目」。」）；否则为「尚未生成 HTML。」（不展示空 iframe）。

调用时机：`onMounted`、生成/修改成功后、以及失败且项目无 HTML 时。

### 4.8 背景音频：设定 / 更换 / 移除（音轨由主进程注入 HTML）

背景音轨**不经过 Agent**：本页只负责「选定哪份音频」，写 HTML 由主进程完成——`project:set-audio` / `project:clear-audio` / `project:extract-video-audio` 在 `writeProject` 之后调用 `applyBgmToHtml()`，按 `project.audioFile` 重写 `index.html` 里的 `<audio id="myv-bgm" src="audio/…" autoplay loop>`（先摘掉本应用注入的旧标签、再摘掉引用同一音频文件的历史标签；幂等，内容无变化时不写盘，无 HTML 时静默返回 `false`）。细节见 [main/projects.ts.md](../../../main/projects.ts.md) §3.5。

1. **设定 / 更换**：三条入口最终都用同一个收尾——
   - 下拉「从已生成音频中选择…」（`onAudioPick`）：**选中即生效**，调 `setAudio(currentName, it.path)`（并立即把下拉复位为 `''`）；
   - 「选择音频文件…」（`onPickAudioFile`）：`pickAudio()` 拿本地绝对路径（取消则静默返回）后调 `setAudio(...)`；
   - 「项目素材」块「视频素材」行里的「提取原声为背景音频」（`onExtractAudio`）：主进程从 `videoMaterial` 提取 `audio/<同名>.m4a` 并设为 `project.audioFile`。
   成功路径统一走 `afterAudioChange(tip, absPath)`：`await refreshProject()` → `setAudioPreview(absPath)` → `await loadFrame()` → `toast(tip)`。**重载预览是必需的**：音轨由主进程写进 `index.html`，预览副本（`project:preview-html` 从 `index.html` 生成）必须重新生成并重新载入才听得到。
2. **试听**：项目内音频只有相对引用（`audio/xxx`），渲染层拿不到可用的绝对路径，因此只有「选本地文件 / 选已生成音频」两条路径会 `setAudioPreview(absPath)` 显示 `<audio ref="audioEl">` 试听行；提取原声则 `setAudioPreview('')` 隐藏试听行，试听交给预览 iframe 里的音轨（语速控件见 4.9）。
3. **移除**：「移除音频」（`onRemoveAudio`）调 `clearAudio(currentName)`：主进程清空 `proj.audioFile` 并把 HTML 里注入的 `<audio>` 一并摘掉（否则成片仍有声、与项目状态不符），随后同样 `afterAudioChange(...)` 重载预览。
4. **与生成 / 修改的衔接**：`project:generate-html` / `project:modify-html` / `project:save-html` 写入 `index.html` 后都会再调一次 `applyBgmToHtml()`（模型重写或手改粘贴时可能整段丢掉注入标签，故必须补回）；提示词里固定只有一行「【音轨】背景音轨由应用在渲染前自动注入（`<audio id="myv-bgm">`），请勿写入、修改或删除任何 `<audio>` 标签，也不要为音轨预留页面元素。」——**音频不占提示词、也不交给 Agent**。
5. **转视频**：`video.ts` 直接把 `index.html` 所在目录交给 HyperFrames CLI，页面里的 `<audio id="myv-bgm">` 由 CLI 在 trace 阶段 `audio_process` 提取并混入 MP4，应用侧不做任何 ffmpeg 混音。

### 4.9 语速控件（`applyRate` / `stepRate`）

1. 模板中 `−` / `+` 按钮分别调用 `rateStep(-0.05)` / `rateStep(0.05)`；输入框为 `:value="rateValue"`、`@input="onRateInput"`，`inputmode="decimal"`。
2. 两者都作用于 `utils/rate.ts` 的共享实现：`applyRate(el, audio)` 解析输入值，非有限值回退 1，再 `rateClamp` 到 `0.5~2.0`，写回 `el.value` 并设置 `audio.playbackRate`；`stepRate(el, audio, delta)` 在此基础上按 `Math.round((v + delta) * 100) / 100` 步进后同样钳制。
3. **只改播放 `playbackRate`，不改磁盘音频**；本页把返回值同步回 `rateValue`，使输入框显示规范化后的值。

### 4.10 转视频：弹窗确认档位 → 渲染（`openRenderModal` / `confirmRenderVideo` / `onRenderVideo`）

**第一步：点「转视频」只开弹窗，不渲染。** `openRenderModal()` 依次做四道守卫，任一不通过就 toast 且**不开弹窗**：

1. **只读守卫**：`appState.isBuiltin` → `toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」')` 并返回（界面上「转视频」按钮本身也带 `v-if="!appState.isBuiltin"`，示例的试渲染留在「视频预览」页）。
2. **并发守卫**：`rendering.value` 为真直接返回（按钮本身也已 `:disabled`）。
3. **Agent 忙守卫**：`agentRunning` 为真 → `toast('Agent 正在处理 HTML，请等它结束再转视频')` 并返回（避免在 HTML 正在被覆盖写时渲染半成品）。
4. **前置校验**：取 `appState.project.htmlPath`；`!htmlPath || !htmlExists` → `toast('还没有 HTML，请先「生成 HTML」')` 并返回。

守卫放在 `openRenderModal` 而不是只放在 `onRenderVideo`，是为了避免「弹窗打开了又被拒」的观感；`onRenderVideo` 内保留同一套守卫，兜住弹窗打开后状态被改的窗口期。

**第二步：在弹窗里确认档位。** 弹窗正文即「渲染档位」块——质量 / 帧率两个下拉直接绑定 `quality` / `fps`（`@change="onOptionChange"`，改动**立即**写入项目级覆盖，见 4.11），`.hf-file` 显示 `optionNote`（「跟随设置页默认：标准 · 30fps」或「本项目自定义档位」），`v-if="overridden"` 时右侧多出「恢复默认档位」，下方 `.hgen-tip` 是当前质量的画质说明 +「转视频」用途说明。关闭有四种：`取消`、`×`、点弹窗外（`@click.self`）、ESC（`onModalKeydown`）——**都只关弹窗，不发起渲染，也不回滚已改的档位**（档位在 `@change` 时就已落盘）。

**第三步：`开始渲染` → `confirmRenderVideo()` 先关弹窗，再走原有 `onRenderVideo()`：**

5. 置初始状态：`options = { quality: quality.value, fps: fps.value }`；`status = '已提交渲染（' + renderOptionsText(options) + '，约 30 秒）...'`、`statusClass = ''`、`rendering = true`。
6. `await window.hfTools.renderVideo(htmlPath, options)`（`video:render`；档位随 `RenderOverride` 合并进载荷，主进程按白名单拼 `--quality` / `--fps`）。
7. 返回后先 `resetRenderProgress()`：用本地完成/失败文案覆盖全局 trace 残留（渲染期间状态区优先显示 trace，见 4.11）。
8. **成功分支**（`res.ok`）：`status = '视频已生成（' + renderOptionsText(options) + '）：' + res.outputVideo`、`statusClass = 'hf-ok'`；随后 `await window.projectTools.saveVideo(appState.currentName, res.outputVideo)`（`project:save-video`，把产物写回 `project.json`）→ `await refreshProject()`（刷新后「视频预览」页的 `videoExists` / `videoPath` 才有效）→ `toast('视频已生成，可到「视频预览」页查看')`。
9. **失败分支**：`status = (res as { message?: string }).message || '渲染失败'`、`statusClass = 'hf-error'`，并 toast 同一文案。
10. **异常分支**（`catch`）：IPC 层异常（主进程不可用等）同样先 `resetRenderProgress()`（不让 trace 继续占着状态区），再写 `status = '渲染失败：' + message`、`statusClass = 'hf-error'` 并 toast。
11. `finally` 中复位 `rendering = false`，保证异常路径也能再次提交。

> 渲染期间弹窗不会重新出现：「转视频」按钮在 `rendering` 期间已 `:disabled`，点不动也就不会再打开弹窗；渲染进度显示在本页状态条（`.hf-status`），成品到「视频预览」页看。

### 4.11 渲染档位的同步与项目级覆盖

1. **优先级**：项目级覆盖（`project.json` 的 `render`）> 全局默认（`settings.json` 的 `render` 段）> 内置默认（`standard` / `30`）；覆盖里缺省的字段跟随上一级。该合并由 `useRenderOptions.effectiveRenderOptions()` 调 `utils/render.ts` 的 `resolveRenderOptions()` 完成。
2. **下行（读）**：`onMounted` 与「恢复默认档位」成功后都调 `syncFromEffective()`，把 `quality` / `fps` 两个 ref 刷成生效值。
3. **上行（写）**：两个下拉的 `@change` 统一走 `onOptionChange()` → `saveProjectRenderOverride({ quality, fps })`（内部 `projectTools.setRender` / `project:set-render`），成功后把返回的 `project.render` 经 `pickRenderOverride` 规范化后写回 `appState.project.render`，因此 `overridden` / `optionNote` 立即更新。两个下拉现在都在「转视频」弹窗内，但落盘时机未变——**改动即写**，取消弹窗不会回滚已改的档位（弹窗只承载「确认后开始渲染」这一步）。
4. **恢复默认**：`onResetOptions()` 传 `null`，主进程删除 `proj.render`；成功后再次 `syncFromEffective()`，`overridden` 变假，「恢复默认档位」按钮随之消失（`v-if="overridden"`）。
5. **内置示例不落盘**：`saveProjectRenderOverride` 在 `appState.isBuiltin` 或 `currentName` 为空时直接返回 `{ ok: true }`，不发起 IPC；界面上 `optionNote` 也会写明「内置示例（只读）：档位仅本次生效」。
6. **状态合并显示**：`statusDisplay = (rendering && renderProgress.text) ? renderProgress.text : status`，`statusDisplayClass` 在 trace 接管时返回 `''`——即渲染中状态条显示全局进度文案并保持中性样式，渲染结束后回到本页 `status` + `hf-ok` / `hf-error`。

### 4.12 视频素材：唯一入口（选择 / 当场导入 / 移除 / 提取原声）

视频素材全页只有「项目素材」块里的一行（整块由 `<template v-if="!appState.isBuiltin">` 包住，内置示例不显示）。下拉 `v-model="videoSel"` 的三个选项对应三种语义：`''` 不使用视频素材、`'__current__'` 沿用当前项目视频素材（仅当 `appState.project.videoMaterial` 存在时出现）、`'__pick__'` 当场导入本地文件。**原先独立的视频素材导入卡片（导入 / 移除 / 提取原声 / 素材预览）已全部并入这一行。**

1. **进页面初始化**：`onMounted` 调 `syncVideoSelFromProject()` → `videoSel = currentVideoSel()`，即项目里已有素材就默认选中「当前项目视频素材」，否则为「不使用视频素材」；用户仍可随时切回「不使用」。
2. **本次生成的选择**：选 `''` / `'__current__'` 不触发任何动作（`onVideoSelect` 首行 `videoSel.value !== '__pick__'` 直接返回），只随 `materials.videoPath` 提交给主进程（见 4.3）。
3. **当场导入**（选中 `'__pick__'`）：`pickVideo()` 打开文件框 → `setVideo(currentName, picked)`（`project:set-video`：复制进项目 `video/` 并写 `proj.videoMaterial`）→ `await refreshProject()` → `syncVideoPreview(res.abs)` 显示预览行 → `videoSel = '__current__'`（**导入即选中**）→ toast「已导入视频素材：…（本次生成会交给 Agent 嵌入该片段）」。三种复位分支统一回到 `currentVideoSel()`：① 内置示例 → toast 只读提示；② 用户在文件框里取消（`pickVideo()` 返回空）；③ `setVideo` 失败（`!res.ok`）→ toast `res.message` 或「设置视频失败」。
4. **移除**（`onClearVideo`）：`clearVideo(currentName)` 只清 `proj.videoMaterial` 引用（保留 `video/` 里的文件）→ `await refreshProject()` → `syncVideoPreview('')` 隐藏预览行 → `videoSel = currentVideoSel()`（移除后即为「不使用视频素材」）→ toast「已移除视频素材」。
5. **提取原声**（`onExtractAudio`）：无 `videoMaterial` 时提示「还没有视频素材：可在上方『视频素材』里选『选择本地视频文件…』导入」；成功后走背景音频路线（主进程 `extractVideoAudio` 提取 `audio/<同名>.m4a` 并由 `applyBgmToHtml` 注入 HTML），本页 `refreshProject()` → `setAudioPreview('')` → `loadFrame()` 重载预览（详见 4.8）。
6. **素材预览行的取舍**：`videoMaterial` 是项目内相对引用，渲染层拿不到项目绝对路径，因此 `<video>` 预览行只在**本次会话导入成功后**出现（路径来自 `setVideo` 返回的 `abs`）；这与背景音频试听行行为一致——重新进入本页不会恢复预览行，但页面里嵌入的片段仍可在预览 iframe 中看到。

## 5. 依赖与协作

| 依赖 | 用途 |
|------|------|
| `vue`：`computed, onBeforeUnmount, onMounted, ref, watch` | 响应式状态与生命周期 |
| `@renderer/composables/useAppStore`：`appState, hasHtml, refreshProject` | 全局项目状态、`hasHtml` 判定、刷新项目列表与详情 |
| `@renderer/composables/useToast`：`toast` | 统一的轻提示 |
| `@renderer/utils/escape`：`escTxt` | 「预览」卡片里背景音频文件名渲染前转义 `& < >`（视频素材名走 `<option>` 的文本插值，框架自带转义，不再用 `escTxt`） |
| `@renderer/utils/rate`：`applyRate, stepRate` | 试听语速控件共享逻辑 |
| `@renderer/composables/useRenderProgress`：`renderProgress, resetRenderProgress` | 渲染进度文案的读（合成 `statusDisplay`）与复位 |
| `@renderer/utils/render`：`FALLBACK_RENDER, RENDER_FPS_OPTIONS, RENDER_QUALITY_OPTIONS, isRenderOverridden, renderOptionsText` | 档位选项表、默认档位、覆盖判定与档位摘要文案 |
| `@renderer/composables/useRenderOptions`：`effectiveRenderOptions, renderDefaults, saveProjectRenderOverride` | 生效档位（项目覆盖 > 全局默认）、全局默认（判是否被覆盖）、写入 / 清除项目覆盖 |
| `@shared/types`：`type RenderFps`、`type RenderQuality` | 档位下拉的类型标注 |
| `@renderer/components/StepBar.vue` | 顶部流水线步骤条 + 工作项目切换 |

调用的 preload / IPC（均挂在 `window.projectTools`）：

| 方法 | 用途 |
|------|------|
| `previewHtml(name)` | 生成 `index.preview.html` 预览副本，返回 `previewPath` |
| `generateHtml(name, prompt, materials)` | 生成 `index.html`（`materials` = `{ subtitleProject, videoPath }`，**不含音频**；音轨由主进程在落盘后注入）。提示词**不含现有页面**；界面入口：**「生成 HTML」按钮**（**点一次即执行，无二次确认**；已有 HTML 时直接覆盖） |
| `modifyHtml(name, prompt, materials)` | 基于现有 HTML 改造并覆盖（同上：`materials` 只有字幕与视频素材）。提示词含当前 `index.html` 全文；界面入口：**「按需求修改」按钮**（无 HTML 时该按钮禁用）。两个频道在主进程各自独立，未合并 |
| `downloadHtml(name)` | 另存项目 HTML |
| `downloadFile(srcPath, defaultName)` | 内置示例直接导出示例 HTML |
| `pickAudio()` / `setAudio(name, audioPath)` / `clearAudio(name)` | 背景音频选择 / 设置 / 移除；`setAudio` 返回 `{ ok, audioFile, htmlUpdated }`、`clearAudio` 返回 `{ ok, htmlUpdated }`——主进程同时改写 `index.html` 里的注入音轨，`htmlUpdated` 为「是否改写了 HTML」 |
| `pickVideo()` / `setVideo(name, videoPath)` / `clearVideo(name)` | 视频素材选择 / 设置 / 移除；`setVideo` 返回 `{ ok, videoFile, abs }`——`abs` 是项目内绝对路径，供本页导入成功后立即预览（`syncVideoPreview`）；`clearVideo` 只清 `proj.videoMaterial` 引用、不删 `video/` 里的文件 |
| `extractVideoAudio(name)` | 提取视频原声为背景音频，返回 `{ ok, audioFile, htmlUpdated }`（提取出的原声同样立即注入 HTML） |
| `renderVideo(htmlPath, { quality, fps })` | 调 `video:render`，把当前项目 HTML 渲染为 MP4（档位可缺省，缺省走 CLI 默认） |
| `saveVideo(name, videoPath)` | 调 `project:save-video`，渲染成功后把产物路径回写到项目 `project.json` |
| `setRender(name, render \| null)` | 调 `project:set-render`（经 `saveProjectRenderOverride`），写 / 清除项目级渲染档位覆盖 |
| `onHtmlProgress(callback)` | 订阅 `IPC.Project.HtmlProgress` 流式进度（单订阅） |

另有 `window.voiceTools.listGenerated()`（已生成音频列表，**仅用于填充「预览」卡片里「从已生成音频中选择…」下拉**；`window.hfTools` 的 `listProjects` 由 `refreshProject()` 内部使用，本页不直接调用；`window.hfTools.renderVideo` / `showInFolder` 中只有 `renderVideo` 由本页调用）。

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import HtmlGenPage from './HtmlGenPage/index.vue'`，注册为 `pages['html-gen']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行 `onMounted`。

## 6. 注意事项与实现要点

- **内置示例只读守卫**：`runAgent`、`onPickAudioFile`、`onAudioPick`、`onRemoveAudio`、`onVideoSelect`、`onClearVideo`、`onExtractAudio`、`openRenderModal`、`onRenderVideo` 均在入口处拦截 `appState.isBuiltin` 并提示切换到「我的项目」；`meta`、`hasHtml`、`syncPreview` 也把内置项目排除在「已生成」之外。下载是唯一允许的只读操作（走 `downloadFile`）。渲染相关的两块 UI（「转视频」按钮、**「转视频」弹窗**）、「预览」卡片里的背景音频块与「项目素材」块里的**视频素材行**都带 `v-if="!appState.isBuiltin"`，对内置示例直接不渲染。
- **失败提示**：Agent 失败时状态条用 `hf-error` 并同时 toast；仅当项目原本无 HTML 才恢复空态，避免把「已存在的旧 HTML」误标为未生成。
- **预览缩放实现**：iframe CSS 固定 `1920px × 1080px` + `transform-origin: 0 0`，容器用 `padding-bottom: 56.25%` 撑出 16:9 高度；`fitFrame()` 以容器 `clientWidth / 1920` 设置 `transform: scale(...)`，因此预览画布带缩放变换，内部坐标可继续按 1920×1080 计算。窗口 `resize` 与每次 `load` 都会重新缩放。
- **思考文本截断**：页面展示的是主进程 `thinkText.slice(-20000)` 的结果（仅末尾片段），完整原文写入 userData 下 `html-agent/chat.jsonl`；`<pre>` 自身 `max-height:220px` 且可滚动，配合 `watch` 自动滚底。
- **思考区样式与状态样式互斥**：进度回调每次设置 `status` 都会把 `statusClass` 清空，只有最终成功/失败分支才写入 `hf-ok` / `hf-error`。
- **取消 / 重复提交防护**：`agentRunning` 为模块级普通变量（非响应式），`try/finally` 保证复位；并发点击「生成 HTML」/「按需求修改」会被直接 toast 拒绝。两个按钮各走各的入口（`onGenerate` / `onModify`），「按需求修改」在无 HTML 时由模板 `:disabled` 拦下、函数内再有一层 `htmlExists` 兜底。渲染与 Agent 互斥：渲染中禁用两个按钮与「转视频」，Agent 处理中调 `openRenderModal` / `onRenderVideo` 都会被 toast 拦下。
- **弹窗与页面级监听**：转视频弹窗用的是通用弹窗类（`.hf-modal-mask` / `.hf-modal*`，与「从音频生成字幕」弹窗同一套），**没有新增 CSS 类**，因此 `assets/main.css` 无需改动；弹窗节点写在模板末尾（两张卡片之外），靠 `position: fixed` 覆盖全屏。ESC 关闭走 `document` 级 `keydown`（`onModalKeydown`），必须与 `onMounted` / `onBeforeUnmount` 成对，否则切页后会留下悬挂监听。
- **弹窗不承担「取消档位改动」**：质量 / 帧率下拉的 `@change` 仍然即时落盘（项目级覆盖），点「取消」只关弹窗、不回滚档位；弹窗的语义只是「确认要开始渲染」。若要让取消回滚，需要在打开弹窗时快照 `quality` / `fps` 并在关闭时写回，当前**有意不做**。
- **生成侧是两个并列按钮，各自对应一个明确动作**：「生成 HTML」走 `project:generate-html`（提示词不含现有页面），「按需求修改」走 `project:modify-html`（提示词含当前 `index.html` 全文）；没有 HTML 时「按需求修改」禁用。两者的区别由**每个动作按钮内部各带一个的 `?`**（`.hg-help`，悬浮只显示该动作自己的说明）承载，而不是靠按钮文案随状态变化；上一版那条「按 `hasHtml` 分流到同一个按钮」的自适应路径已随该方案一并删除；**「生成 HTML」在已有 HTML 时也没有二次确认**——点一次即覆盖 `index.html`（曾经的 `regenArmed` + 5 秒自动解除那套武装态已整体删除），要留底稿得自己先点「下载 HTML」。
- **进度订阅的单订阅语义**：`onHtmlProgress` 在 preload 中只绑定一次 `ipcRenderer.on`，后续注册仅替换回调；本页因此只需在 `onMounted` 注册、无需（也无法）取消订阅。
- **事件监听成对**：`message`、`resize` 两个 window 监听与 `keydown`（document，弹窗 ESC）都在 `onBeforeUnmount` 移除，避免切页后仍响应 iframe 上报、resize 或按键。
- **播放控制边界**：`ctlVisible` 跟随 `frameVisible`；无 `frameSrc` 时点「暂停/播放」「重新播放」只 toast「暂无预览」。自然播完判定带 `0.25s` 容差，避免因上报精度抖动而卡在「暂停」。
- **预览副本与原件分离**：预览用 `index.preview.html`（剥离 CSP、注入控制脚本），下载与转视频始终使用原件 `index.html`。
- **视频素材只有一个入口**：选择 / 当场导入 / 移除 / 提取原声都在「项目素材」块的那一行下拉里（见 4.12）。新增素材后**导入即选中**（`videoSel = '__current__'`，不必再去别处选一次），移除后 `videoSel = currentVideoSel()` 回到「不使用」；两次操作都先 `await refreshProject()`，让下拉的 `__current__` 选项与两个按钮的禁用态跟着项目实际状态刷新。**背景音频没有 `*Sel`**——它不进提示词，选定即由主进程写进 HTML（见 4.8），本页只做「刷新项目 + 更新试听源 + 重载预览」。
- **音轨注入的三条不变量**：① 标签 id 固定为 `myv-bgm`，重复设置不会叠出多条音轨（注入前先 `stripInjectedBgm`）；② 引用同一项目音频文件的历史 `<audio>`（旧版由模型按提示词写入）会被 `stripAudioOfFile` 摘掉，避免双份播放；③ 没有 `index.html` 时静默返回 `false`，因此「先生成音频、后生成 HTML」的顺序不会报错。
- **`genLoad()` 失败必须静默**：已生成音频只是下拉的可选项，不是本页必需；`listGenerated()` 失败时直接返回、下拉留空，不 toast 打断（与旧版带 `silent` 形参的行为等价，只是不再有选中 / 试听逻辑）。
- **语速仅影响试听**：`applyRate` / `stepRate` 只改 `playbackRate`，不写磁盘、不影响最终产物。
- **「转视频」用原件而非预览副本**：渲染入参是 `appState.project.htmlPath`（项目 `index.html`），预览用的是 `index.preview.html`，两者不要混用。
- **渲染产物落 userData**：MP4 由主进程写在 `userData/hf-projects/html-video-<时间戳>/output.mp4`；本页调 `projectTools.saveVideo` 把它回写到 `project.json` 的 `videoPath`，因此「视频预览」页进入时才能自动加载。
- **档位读取时机**：下拉初值取 `FALLBACK_RENDER`，真正生效值在 `onMounted` 的 `syncFromEffective()` 里写入（下拉虽然藏在弹窗里，也在挂载时就同步好，因此打开弹窗看到的即是最新生效档位）；只有挂载前就发起渲染（不可能，按钮 `:disabled`）才会用到内置默认。
- **状态区文本与样式成对切换**：`statusDisplay` 与 `statusDisplayClass` 必须一起用；若只换文本不换样式，渲染中的 trace 文案会继承上一次的 `hf-ok` / `hf-error` 颜色。
- **渲染中切页的语义**：`resetRenderProgress()` 只在页面挂载与渲染结束时调用；渲染进行中切走再回来，本页会先清空 trace，随后的新 trace 会重新写入（源码注释已说明此取舍）。
