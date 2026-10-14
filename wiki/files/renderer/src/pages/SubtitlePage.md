# src/renderer/src/pages/SubtitlePage/（页面）

> 字幕条目编辑器 + whisper 转录弹窗 + 纯函数助手：估时、SRT 互转与落盘

- **覆盖文件**：

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/renderer/src/pages/SubtitlePage/index.vue` | 259 | 页面组件（`PageKey = 'subtitle'` 对应页）：条目增删改、双写入方式、导出与落盘 |
| `src/renderer/src/pages/SubtitlePage/TranscribeSection.vue` | 345 | 页面子组件（弹窗，SFC）：调 whisper.cpp 本机转录并回填条目 |
| `src/renderer/src/pages/SubtitlePage/helpers.ts` | 165 | 模块级助手（无 Vue 状态、无副作用，仅依赖 `@renderer/utils/time`）：估时 / 时间解析 / 项目文本与 SRT 互转 |

- **类型**：页面 + 子组件 + 模块级助手
- **对外导出**：
  - `SubtitlePage`：默认导出 `<script setup>` 组件，无具名导出。
  - `helpers.ts`：`SubtitleItem`（interface）、`estDur`、`parseTime`、`fmtTimeTrim`、`fillEnds`、`parseSubtitleText`、`serializeItems`、`plainText`、`fmtSrt`、`itemsToSrt`、`parseSrtText`。
  - `TranscribeSection`：默认导出组件，`defineExpose({ open })`；props 仅 `pageCtx`（模板以 `:page-ctx` 传入）；无 `emits`，反馈全靠 `pageCtx` 回调 + `toast`。

## 1. 结构总览

- **页面注册与父子关系**：`src/renderer/src/pages/index.ts` 以 `'subtitle': SubtitlePage` 注册进页面映射，由 `goPage('subtitle')` 渲染（`StepBar` 步骤导航亦可跳入）；`SubtitlePage` 顶层渲染 `<TranscribeSection ref="transcribeEl" :page-ctx="pageCtx" />`，「从音频生成字幕」→ `openTranscribe()` → `transcribeEl.value?.open()` 打开弹窗。
- **`pageCtx` 契约**（父 → 子，父组件源码定义，子组件 `defineProps` 声明）：

| 字段 | 签名 | 说明 |
|------|------|------|
| `getItems` | `() => SubtitleItem[]` | 读取当前条目（「追加到末尾」的基准时间） |
| `setItems` | `(v: SubtitleItem[]) => void` | 回填条目（替换或追加后写回） |
| `isTextMode` | `() => boolean` | 是否 SRT 模式 |
| `syncTextArea` | `() => void` | SRT 模式下用 `itemsToSrt` 同步文本域 |
| `saveToProject` | `(options?: { silent?: boolean }) => Promise<boolean>` | 落盘；子组件以 `{ silent: true }` 调用 |
| `estDur` | `(t: string) => number` | 直接复用 helpers 的估时函数 |

- **helpers 复用**：`SubtitlePage/index.vue` 导入 `estDur`、`fillEnds`、`fmtTimeTrim`、`itemsToSrt`、`parseSrtText`、`parseSubtitleText`、`parseTime`、`plainText`、`serializeItems`、`type SubtitleItem`；`TranscribeSection.vue` 只导入 `estDur` 与 `type SubtitleItem`。helpers 自身不接触 `appState`、不调用任何 preload 方法，可被任意页面安全复用。

## 2. SubtitlePage/index.vue（页面）

### 2.1 模板区块

顶层为 `StepBar` + 三块卡片内容区：

| 区块 | 关键元素 | 说明 |
|------|----------|------|
| 步骤条 | `<StepBar :page="'subtitle'" />` | 项目切换 / 步骤导航，切项目后重进当前页 |
| 面板一「字幕编辑器」 | `.panel-title`、`.hgen-tip`、两个按钮 | 说明文案 + 「从音频生成字幕」「由脚本旁白生成」 |
| 面板二「字幕条目」 | `写入方式` 按钮组 | 「逐条编辑」`setMode(false)` / 「SRT」`setMode(true)`，`active` 类由 `textMode` 决定 |
| 逐条列表 | `.sub-list`（`ref="listEl"`，`v-show="!textMode"`） | 空态 `.sub-empty`；每行 `.sub-row` 含序号、起始时间、`→`、结束时间、文本域、删除按钮 |
| 每行时间输入与文本域 | `.sub-time` / `.sub-text` | 时间：`:value="fmtTimeTrim(it.start)"`、`@change="onTimeChange(i, 'start', $event)"`，结束时间非法 / 非有限值时显示空串；文本：`v-model="it.text"`、`@input="onTextInput(i)"` |
| SRT 文本域 | `.sub-textarea`（`v-model="srtText"`，`rows="14"`，`v-show="textMode"`） | placeholder 内含标准 SRT 样例（`1` / `00:00:00,400 --> 00:00:02,000` / 文本 / 空行），并说明可直接粘贴纯文本逐行估时 |
| 操作行（列表 / 底部） | 「新增条目」`addItem`、「↑ 到顶部」`scrollTop`、「↓ 到底部」`scrollBottom`、`.sub-count` 计数提示 `countTip`；「复制字幕」`copySubtitles`、「导出 SRT 文件」`exportSrtFile`、「保存到项目」`saveToProject({})` | 列表操作行管条目增删与滚动，底部为三个出口按钮 |
| 页面标题与状态说明 | `v-model="title"`（`.hgen-input`）、`.hf-status`（`:style` 受 `statusColor` 控制）、`.sub-note` | 字幕动画标题随保存一起写入项目；状态文案 + 时间格式与落盘格式说明 |
| 转录弹窗 | `<TranscribeSection ref="transcribeEl" :page-ctx="pageCtx" />` | 由 `openTranscribe()` 通过 ref 打开 |

### 2.2 状态

| 名称 | 类型 | 说明 |
|------|------|------|
| `items` | `Ref<SubtitleItem[]>` | 字幕条目数组，编辑器唯一数据源 |
| `textMode` / `srtText` | `Ref<boolean>` / `Ref<string>` | 是否处于 SRT 单文本域模式 / 文本域内容 |
| `title` | `Ref<string>` | 页面标题（保存时传给 `saveSubtitle`） |
| `status` / `statusColor` | `Ref<string>` | 状态栏文案与颜色（空串表示默认色） |
| `listEl` | `Ref<HTMLElement \| null>` | 条目列表容器，用于滚动与新增后聚焦 |
| `transcribeEl` | `Ref<InstanceType<typeof TranscribeSection> \| null>` | 转录子组件实例，用于调用 `open()` |
| `countTip` | `ComputedRef<string>` | 形如 `共 N 条 · 总时长约 分:秒`，时长取**末条 `end`**（`fmtTime` 格式化），无有效条目时为空串 |
| `pageCtx` | 普通对象 | 传给 `TranscribeSection` 的上下文（见第 1 节表格） |

### 2.3 函数

| 名称 | 说明 |
|------|------|
| `setStatus(msg, color?)` | 统一写 `status` / `statusColor` |
| `onTextInput(i)` | 仅当改的是**末条**且其 `end` 非有限值或不大于 `start` 时，用 `estDur(text)` 重算结束时间 |
| `onTimeChange(i, f, ev)` | 解析输入框时间：`parseTime` 失败则回填原值并提示「时间格式无法识别（请用 分:秒，如 00:12 或 00:12.5），已保留原值」；成功则写回 `it[f]`，若改的是 `start` 且 `end <= start`，用 `start + estDur(text)` 顺延 |
| `removeItem(i)` | 删除第 i 条 → `fillEnds` 重排 → `toast('已删除第 N 条（点「保存到项目」生效）')` |
| `itemStartAfter(last)` | 计算新条目起始：上一条 `end` 有效（有限且大于 `start`）用 `end`，否则用 `start + estDur(text)`；无上一条返回 0 |
| `addItem()` | 追加 `{ start, end: start + 2.4, text: '' }`，`nextTick` 后聚焦最后一行的 `.sub-text` |
| `scrollTop()` / `scrollBottom()` | 列表容器滚动到顶 / 到底 |
| `setMode(tm)` | 模式切换：从 SRT 切回时先 `applyTextMode()`；进入 SRT 时用 `itemsToSrt` 生成文本并给出模式说明 |
| `applyTextMode()` | `items.value = parseSrtText(srtText.value)` |
| `copySubtitles()` | 先同步 SRT 模式 → `plainText(items)` → `window.appTools.copyText(txt)`；成功 toast「已复制 N 条字幕文本（不含时间线）」，失败置红色状态 |
| `exportSrtFile()` | 先同步 SRT 模式 → `itemsToSrt(items)` → `window.projectTools.exportSrt(appState.currentName, srt)`；`res.ok` 时 toast「已导出：<savedPath>」，非 `canceled` 的失败弹 `message` |
| `saveToProject(options?)` | `options.silent` 控制是否弹 toast；SRT 模式先回写条目；`serializeItems` 为空则拒绝；调 `window.projectTools.saveSubtitle(currentName, text, title.trim())` → `refreshProject()`；成功 toast 条数取 `res.project.subtitleCount` 兜底 `items.length` |
| `fromContent()` | 读 `appState.project.content.scenes` 批量生成（见 2.4） |
| `openTranscribe()` | `transcribeEl.value?.open()`（打开转录弹窗） |

### 2.4 关键流程

**页面挂载**：`onMounted` 清空状态条 → `title` 取 `proj.title`（等于 `'字幕动画'` 时视为未自定义、置空）→ `items = parseSubtitleText(proj.subtitle || '')` → `textMode` 强制回 `false`（每次重挂载都回到「逐条编辑」默认模式）。

**时间轴自动接续**：① 新增：`itemStartAfter` 取上一条有效 `end`，否则 `start + estDur`；新条目初始时长 2.4 秒。② 删除：`fillEnds` 让下一条起始接管（已有真实结束时间的行不被覆盖）。③ 文本输入：仅末条按新文本重估结束时间。④ 起始时间被改到不小于原结束时间时，结束时间顺延为 `start + estDur(text)`。

**两种写入方式互转**：① `逐条编辑 → SRT`：`itemsToSrt(items)` 写入 `srtText`。② `SRT → 逐条编辑`：`parseSrtText(srtText)` 覆盖 `items`。③ 复制 / 导出 / 保存三个出口都会先调 `applyTextMode()`，保证 SRT 文本域里的最新编辑不丢失。

**由脚本旁白生成**（`fromContent`）：① 取 `appState.project.content.scenes`，非数组或为空则 toast 引导先去「内容脚本」页。② 逐场景取 `s.narration`（trim 后非空才用）。③ 时长优先取 `s.durHint`：要求非空串 / 非 `null` / 非 `undefined` 且 `Number` 有限且 > 0，命中则计入 `usedDur`；否则用 `estDur(narration)` 计入 `estimated`。④ 以 `time` 游标累加生成 `{ start: time, end: time + dur, text: narr }`，**覆盖**当前条目。⑤ SRT 模式下同步刷新 `srtText`。⑥ toast 汇报总数，并分别标注「按时长提示累计」与「按估时」的条数。

**保存流程**：① SRT 模式先 `applyTextMode()`，再 `serializeItems`。② 文本为空：非静默时 toast「字幕内容为空，请先添加条目或生成字幕」，返回 `false`。③ 调 `window.projectTools.saveSubtitle(name, text, title)`，失败弹 `message`。④ 成功后 `refreshProject()`，toast 条数。

## 3. SubtitlePage/TranscribeSection.vue（转录弹窗）

### 3.1 props / defineExpose / 模板

- **props**：仅 `pageCtx`（对象，字段见第 1 节）；`defineExpose({ open })` —— `open()` 只做一件事：`maskVisible.value = true`（打开弹窗后再由 `watch` 触发 `openInit()`）。无 `emits`。
- **样式**：组件内**没有 `<style>` 区块**，`hf-modal-*`、`hf-btn`、`whisper-bar*`、`whisper-tip`、`hgen-*`、`sel-label` 等类均来自全局样式表 `src/renderer/src/assets/main.css`。

| 模板区块 | 说明 |
| --- | --- |
| 遮罩弹窗 | 根节点 `div.hf-modal-mask`，`v-show="maskVisible"` 控制显隐；`@click.self="closeTw"` 点击遮罩空白处关闭。内部 `div.hf-modal`，含 `hf-modal-head`（标题「从音频生成字幕」+ 关闭按钮 `×`）与 `hf-modal-body` |
| ① 选择音频 | `panel-title-sm` 小标题；两个 `radio`（`value="project"` / `value="file"`）绑定 `srcMode`，文案「使用项目音频」「浏览本地文件」 |
| 音频路径与格式提示 | 只读 `input.hgen-input` 绑定 `audioInput`（`:title="audioInput"`，`placeholder="项目音频（可在「配音」页生成 / 选择）"`）+「选择音频」按钮（`:disabled="srcMode !== 'file'"`，点击 `onPick`）；下方 `div.whisper-tip`（`v-show="audioHint !== ''"`）由 `updateAudioHint()` 生成 |
| ② 识别模型 | 「当前识别模型」标签 + `span.tw-model`（文本 `modelText`，颜色 `modelColor`）+ `a.tw-link`「管理模型」（点击 `onManage`）；下方 `div.whisper-tip` 显示 `modelHint`（颜色 `modelHintColor`） |
| 识别语言 | `HfSelect`（`v-model="lang"`、`:groups="langGroups"`，全局自绘下拉组件），四个选项：`auto`「自动检测」、`zh`「中文（简体）」、`zh-hant`「中文（繁体）」、`en`「English」 |
| 进度条 | `div.whisper-bar-wrap`，`v-show="barVisible"`；`div.whisper-bar` 带 `:class="{ indeterminate: barIndeterminate }"`，填充条 `div.whisper-bar-fill` 带 `:class="barState"`、宽度 `barPercent + '%'`；下方 `div.whisper-bar-text` 显示 `barText` |
| 状态提示 | `div.hf-status`，`:class="statusClass"`，内容为 `status`；状态类取 `''`、`hf-error`、`hf-ok` |
| 底部按钮组 | `div.hf-modal-foot` 两套，按 `applyMode` 切换显隐：转录态（`v-show="!applyMode"`）「取消」→ `closeTw`、主按钮 `:disabled="startDisabled"` / 文案 `startText` / 点击 `doTranscribe`；回填态（`v-show="applyMode"`）「替换现有」→ `applyTranscript('replace')`、「追加到末尾」→ `applyTranscript('append')` |

### 3.2 状态与计算属性

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `maskVisible` | `ref<boolean>` | 弹窗遮罩可见性，`open()` 置 `true`；`watch` 监听它触发 `openInit()` |
| `srcMode` | `ref<'project' \| 'file'>` | 音频来源，默认 `'project'`；变更时重置状态并（重新）载入项目音频 |
| `audioInput` / `audioHint` | `ref<string>` | 待转录音频的绝对路径（空串表示未选择）/ 格式提示文案（非直接支持的格式才显示） |
| `lang` | `ref('auto')` | 识别语言，取值 `auto` / `zh` / `zh-hant` / `en` |
| `status` / `statusClass` | `ref<string>` | 状态行文本 / 样式类（`''` / `hf-error` / `hf-ok`） |
| `transcribing` | `ref<boolean>` | 转录进行中标志，用于按钮禁用与重复提交防护 |
| `applyMode` / `pendingResult` | `ref<boolean>` / `let`（非响应式） | 是否进入「结果回填」模式（底部按钮组切换）/ `{ segments: { start: number; end: number; text: string }[] } \| null` 暂存待回填结果 |
| `twModel` | `ref<{ id, label, downloaded, fallback? }>` | 当前识别模型快照，默认 `{ id: '', label: '', downloaded: false }` |
| `barVisible` / `barIndeterminate` / `barPercent` / `barText` / `barState` | `ref` | 进度条显隐 / 不确定态 / 百分比 / 文字 / 填充条样式（`''` / `done` / `error`） |
| `modelText` | `computed` | 四态文案：无 `id` → `未选择识别模型`；未下载 → `label + '（已选但未下载）'`；`fallback` → `label + '（已下载，尚未设为当前使用）'`；否则 → `label + '（已就绪）'` |
| `modelColor` | `computed` | `!id \|\| !downloaded` 时 `var(--color-warning)`，否则空串 |
| `modelHint` | `computed` | 就绪：`转录在本机 CPU 完成，不消耗 API 额度。`；无模型：`当前没有可用的识别模型：请到「设置 → 语音识别模型」下载并设为当前使用后再转录。`；未下载：`当前识别模型尚未下载完成：请到「设置 → 语音识别模型」下载「<label>」。` |
| `modelHintColor` | `computed` | 非就绪返回 `rgba(255, 176, 32, 0.9)`，就绪返回空串 |
| `startDisabled` | `computed` | `transcribing \|\| !audioInput \|\| !(twModel.id && twModel.downloaded)` |
| `startText` | `computed` | `transcribing ? '转录中…' : '开始转录'` |

### 3.3 函数与生命周期

| 名称 | 说明 |
| --- | --- |
| `setTwStatus(msg, kind)` / `hideTwBar()` | 写入 `status` / `statusClass`（`msg` 为空则清空）/ 隐藏进度条并清空 `barText` |
| `showTwBar(msg, indeterminate, percent?)` | 显示进度条：`msg` 可为字符串或 `{ text, kind }`；`indeterminate` 转布尔；`kind === 'done'`/`'error'` 时 `barState` 取同名并固定填满 100；`percent` 为有效数字时按其取值，否则 `done/error` 取 100、其余取 0 |
| `loadTwModel()` / `loadProjectAudio()` | 前者 `await window.whisperTools.status()`：失败/空则重置 `twModel`；否则依次 `models.find(m => m.isCurrent)` → `find(m => m.id === st.currentModelId)` → 兜底 `find(m => m.downloaded)`（命中兜底置 `fallback = true`）；`st.langs` 非空时仅把 `lang` 复位为 `'auto'`（语言选项为模板静态列出）。后者以 `appState.currentName` 调 `window.whisperTools.projectAudio(name)`：成功写入 `audioInput` 并刷新提示、返回 `{ ok: true, path }`；失败清空并返回 `{ ok: false, message }`（默认 `'读取项目音频失败'`） |
| `updateAudioHint()` | 取路径扩展名小写；空扩展名或属于 `TW_DIRECT_EXTS`（`wav`/`mp3`/`flac`/`ogg`）时清空提示，否则提示 `「<EXT>」格式不支持直接转录，开始后会先自动提取音频并转为 16kHz WAV 再识别（多几秒，原文件不受影响）。` |
| `openInit()` | 打开时初始化：清状态、隐藏进度条、`applyMode=false`、清 `audioInput`、`srcMode='project'`、`pendingResult=null`、刷新格式提示 → `loadTwModel()` → `loadProjectAudio()`，按结果写成功/失败状态 |
| `closeTw()` | `maskVisible=false`、隐藏进度条、清状态、`applyMode=false` |
| `doTranscribe()` / `applyTranscript(mode)` | 转录与回填主流程，见 3.4 |
| `onPick()` | `await window.whisperTools.pickAudio()`；返回空（用户取消）则不动；否则写入 `audioInput`、刷新提示、提示「已选择音频：<path>」 |
| `onManage()` / `onKeydown(e)` | `closeTw()` 后 `goPage('settings')`（`goPage` 为 async，此处未 await）；`e.key === 'Escape' && maskVisible` 时 `closeTw()` |
| `watch(maskVisible)` / `watch(srcMode)` | 前者弹窗打开（`v` 为真）时 `void openInit()`；后者切到 `project`：隐藏进度条并异步重新载入项目音频，切到 `file`：隐藏进度条、提示「请选择要转录的本地音频文件」、清空 `audioInput` 并刷新格式提示 |
| `onMounted` / `onBeforeUnmount` | 成对注册 / 注销 `document.addEventListener('keydown', onKeydown)`；`onMounted` 另注册 `window.whisperTools.onProgress(callback)`（preload 为单订阅，重复注册仅替换回调） |

`onProgress` 回调只在 `maskVisible` 为真时处理，且仅识别两个阶段：

| `payload.stage` | 处理 |
| --- | --- |
| `loading` | `showTwBar({ text: payload.message \|\| '正在加载模型…' }, true)`（不确定态）+ 同步状态行 |
| `transcribing` | `pct = (typeof payload.percent === 'number' && payload.percent >= 0) ? payload.percent : null`；`showTwBar(..., pct === null, pct === null ? 0 : pct)`（`null` 即不确定态）+ 同步状态行 |
| 其它（`done` / `error` / `downloading` 等） | 不处理，交由 `transcribe()` 的返回值 / 异常路径收尾 |

### 3.4 关键流程

1. **打开与初始化**：`SubtitlePage` 的「从音频生成字幕」→ `openTranscribe()` → `transcribeEl.value?.open()`；`open()` 只把 `maskVisible = true`，`watch` 随即触发 `openInit()`。`openInit()` 清空上一轮残留（状态、进度条、`applyMode`、`pendingResult`、`audioInput`、`srcMode`），`await loadTwModel()` 取模型状态，再 `await loadProjectAudio()`；成功提示「已载入项目音频：<path>」，失败提示「<message>（可切换为「浏览本地文件」）」并置 `hf-error`。
2. **选择音频来源与语言**：默认 `srcMode='project'`（项目音频，需先在「配音」页生成 / 选择）；切到 `file` 后「选择音频」按钮可用，`onPick()` 走 `whisperTools.pickAudio()`；语言在 `auto` / `zh` / `zh-hant` / `en` 中选，默认 `auto`。扩展名不在 `wav/mp3/flac/ogg` 内时 `audioHint` 提前告知会自动转码。
3. **调用转录**：点击「开始转录」→ `doTranscribe()`。前置校验：`transcribing` 为真直接 `return`（重复提交防护）；`!audioPath` 提示「请先选择要转录的音频」；模型非 `id && downloaded` 提示「识别模型不可用，请先到设置页下载并设为当前使用」。通过后置 `transcribing = true`、`pendingResult = null`、`applyMode = false`，状态与进度条先设为「正在加载模型（<label>）…」，再 `await window.whisperTools.transcribe({ id, audioPath, language: lang })`。
4. **进度两阶段**：主进程先 `emit({ stage: 'loading', message: '正在提取音频（ffmpeg 转换为 16kHz WAV）…' })`（需要转码时），再 `emit({ stage: 'loading', message: '正在加载模型（<label>）…' })`；转录中按 `stage: 'transcribing'`、`message: '转录中 N%'` 回推 `percent`。渲染层用不确定态进度条表现加载阶段，用百分比填充表现转录阶段。
5. **成功回填**：`transcribe()` 返回 `ok: true` 时把 `res.segments` 存入 `pendingResult`，进度条置 `done` 并显示「转录完成：N 条字幕（模型 <res.model \|\| twModel.label>）」，状态置 `hf-ok`，`applyMode = true` 切换到回填按钮组。
6. **替换 / 追加**：`applyTranscript(mode)`。先清洗 segments（`start`/`end` 归零取正、`text` trim 后过滤空文本，无有效文本则 `toast('转录结果中没有有效文本')` 返回）。`replace` 直接用清洗后的段；`append` 取 `props.pageCtx.getItems()`，以最后一条 `end` 为基准（非法或不大于 `start` 时退化为 `start + estDur(last.text)`），把新段整体平移 `base` 后 `concat`。随后统一归一化：`start = max(0, start)`、`end = max(start, end) || start + estDur(text)`。
7. **写入、保存与复位**：`props.pageCtx.setItems(next)`；若 `isTextMode()` 则 `pageCtx.syncTextArea()`；`closeTw()` 复位弹窗；`toast`「已用转录结果替换字幕：共 N 条」或「已在字幕末尾追加 N 条」；最后 `pageCtx.saveToProject({ silent: true })`，成功 / 失败都会写回状态行文案。`closeTw()` 可由关闭按钮、取消按钮、遮罩空白点击、ESC 键触发，统一清空进度条、状态与 `applyMode`。

## 4. SubtitlePage/helpers.ts（共享助手）

| 导出名 | 类型 | 说明 |
|--------|------|------|
| `SubtitleItem` | `interface` | 条目结构：`start: number`、`end: number \| null`、`text: string` |
| `estDur` | `(text: string) => number` | 按字数估算时长：`Math.max(2.4, 1.6 + t.length * 0.15)`，`t = String(text \|\| '')`，长度按 UTF-16 字符数（中英文同权）；与主进程 `parseSubtitle` 同公式 |
| `parseTime` | `(str: string) => number \| null` | 解析 `分:秒` / `分:秒.毫秒` / 纯秒数，失败返回 `null` |
| `fmtTimeTrim` | `(sec: number) => string` | 秒 → `分:秒[.去尾零毫秒]`，用于时间输入框回显 |
| `fillEnds` | `(list: SubtitleItem[]) => SubtitleItem[]` | 原位补全缺失结束时间：取下一条起始，末条取 `start + estDur` |
| `parseSubtitleText` | `(text: string) => SubtitleItem[]` | 项目字幕文本 → 条目数组（含 `[起-止]` 与纯文本混用） |
| `serializeItems` | `(list: SubtitleItem[]) => string` | 条目数组 → 项目字幕文本（`[开始-结束] 文本`，`\n` 连接） |
| `plainText` | `(list: SubtitleItem[]) => string` | 条目 → 纯文本（每行一条，不含时间线） |
| `fmtSrt` | `(sec: number) => string` | 秒 → SRT 时间戳 `时:分:秒,毫秒` |
| `itemsToSrt` | `(list: SubtitleItem[]) => string` | 条目 → SRT 文本（序号 / 时间轴 / 文本，块间空行） |
| `parseSrtText` | `(text: string) => SubtitleItem[]` | SRT 文本 → 条目（空行分块，无时间轴块逐行估时兜底） |

**逐函数要点**

- `parseTime`：先 trim，空串返回 `null`；匹配 `^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$` → `分 × 60 + 秒 + 小数`（小数按位数除以 `10^位数`，分钟 1~3 位、秒 1~2 位）；否则匹配 `^(\d+(?:\.\d+)?)$` → `parseFloat` 纯秒数；都不匹配返回 `null`（调用方据此提示格式错误并保留原值）。`fmtTimeTrim`：负数与非数字归零；取整秒 `s`、`ms = round((t - s) × 1000)`，`ms >= 1000` 进位到 `s + 1` 并返回不带小数的 `分:秒`；否则 `分:秒`，毫秒非零时追加 `'.' + String(ms).replace(/0+$/, '')`（`17.9` → `00:17.9`）。
- `fillEnds`：遍历并**原位修改**条目，返回同一数组引用；已有有效结束时间（有限且大于 `start`）直接跳过；否则取下一行 `start`，无下一行取 `start + estDur(it.text)`；推导结果不大于 `start`（如下一行起始更早）时回落 `start + estDur(it.text)`。
- `parseSubtitleText`：按 `/\r?\n/` 切行、trim 后过滤空行；正则 `^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?(?:\s*-\s*(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?)?\]\s*(.*)$` 提取起止时间与文本，结束时间须严格大于起始才记录，否则置 `null` 交给 `fillEnds`；无时间戳行 `start = autoT`，随后 `autoT += estDur(txt)`，`autoT` 初值 `0.4`；结尾统一 `fillEnds(list)`。
- `serializeItems` / `plainText`：都过滤空文本并把文本 `/\s+/g → ' '` 折叠后 trim；前者 `start` 缺失或非有限时只写纯文本行，否则 `'[' + fmtTimeMs(s) + (结束时间有限且大于 s ? '-' + fmtTimeMs(e) : '') + '] ' + txt`，`\n` 连接，**结束时间按真实值写入**（不是下一行起始时间）；后者仅输出文本、`\n` 连接。
- `itemsToSrt` / `fmtSrt`：前者过滤空文本，`index + 1` 作序号（按过滤后顺序重排，故序号连续），结束时间缺失或 `<= start` 时用 `start + estDur(text)` 兜底，单块结构 `序号 \n 起 --> 止 \n 文本`、块间 `'\n\n'` 连接；后者输出 `时:分:秒,毫秒`，各段 `padStart`（2/2/2/3 位），负值归零。
- `parseSrtText`：先把 `\r\n?` 归一为 `\n`，按 `/\n{2,}/` 分块，块内 trim 后过滤空行；首行匹配 `^\d+$` 视为序号并跳过；时间轴正则 `^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$`（支持 `,` 或 `.` 作毫秒分隔符），其后各行合并为一条文本（`join(' ')` 并折叠空白），结束时间非法或 `<= start` 时 `estDur` 兜底，并推进 `autoT = max(autoT, end)`；无时间轴块逐行估时（`start = autoT`、`end = start + estDur(txt)`，`autoT` 初值 `0.4`）；**结尾不调用 `fillEnds`**。
- 常量化规则：估时公式 `max(2.4, 1.6 + 字数 × 0.15)`；纯文本起点 `autoT = 0.4`；时间小数按位数解释（`.9` 与 `.900` 均为 0.9s，三位即毫秒，与 `fmtTimeMs` 落盘对齐）。

**被谁导入哪些成员**

| 使用方 | 用到的导出 |
|--------|------------|
| `src/renderer/src/pages/SubtitlePage/index.vue` | `estDur`、`fillEnds`、`fmtTimeTrim`、`itemsToSrt`、`parseSrtText`、`parseSubtitleText`、`parseTime`、`plainText`、`serializeItems`、`type SubtitleItem` |
| `src/renderer/src/pages/SubtitlePage/TranscribeSection.vue` | `estDur`、`type SubtitleItem`（并在 `pageCtx` props 类型中声明 `estDur: (t: string) => number`） |

## 5. 依赖与协作

| 来源 | 内容 | 使用方 |
|------|------|--------|
| `vue` | `computed`、`nextTick`、`onMounted`、`ref` / `computed`、`onBeforeUnmount`、`onMounted`、`ref`、`watch` | 页面 / 弹窗 |
| `@renderer/composables/useAppStore` | `appState`（`project` / `currentName`）、`refreshProject` | 页面；弹窗只用 `appState`（`currentName` 读项目音频与保存提示） |
| `@renderer/composables/useToast` | `toast` | 页面、弹窗 |
| `@renderer/utils/time` | `fmtTime`（`countTip` 总时长格式化为 `分:秒`）、`fmtTimeMs`（`serializeItems` 写毫秒精度，`fmtTime` / `fmtTimeMs` 已统一收敛到该文件） | 页面 / helpers |
| `@renderer/pages`（`goPage`） / `@renderer/components/StepBar.vue` | 「管理模型」跳设置页（`goPage('settings')`） / 顶部步骤条（`props.page: PageKey`） | 弹窗 / 页面 |
| `@renderer/components/HfSelect.vue` | 全局自绘下拉（默认导出 `HfSelect` + `type HfSelectGroup`）：转录弹窗的「识别语言」下拉 | 弹窗 |
| `./helpers` 与 `./TranscribeSection.vue` | helpers 见第 4 节导入清单；转录弹窗经 `:page-ctx` 与 ref `open()` 双向协作 | 页面 / 弹窗 |

**调用的 preload / IPC 方法汇总**

| 方法 | 参数 | 用途 |
|------|------|------|
| `window.appTools.copyText(text)` | 不含时间线的纯文本 | 「复制字幕」 |
| `window.projectTools.exportSrt(name, srt)` | `appState.currentName` + SRT 文本 | 导出 `.srt`（主进程弹保存框，取消返回 `{ ok: false, canceled: true }`） |
| `window.projectTools.saveSubtitle(name, subtitle, title)` | 项目名 / 序列化字幕 / 标题 | 保存字幕与标题（即 `project:save-subtitle`） |
| `window.whisperTools.status()` | 无 | 取模型清单、`currentModelId`、`langs` 等 |
| `window.whisperTools.projectAudio(name)` | `appState.currentName` | 读取当前项目音频路径 |
| `window.whisperTools.pickAudio()` | 无 | 系统对话框选择本地音频（`string \| null`） |
| `window.whisperTools.transcribe(payload)` | `{ id, audioPath, language }` | 执行转录，返回 `segments`、`model` 等 |
| `window.whisperTools.onProgress(callback)` | 回调 `payload` | 订阅 `loading` / `transcribing` 阶段进度（单订阅） |

helpers 不调用任何 preload 方法；弹窗不落盘字幕本身（主进程注释明确「不直接写项目文件」），最终保存统一走父组件 `saveToProject`。

## 6. 注意事项与实现要点

- **估时公式是跨进程契约**：`estDur = max(2.4, 1.6 + 字数 × 0.15)` 必须与主进程 `parseSubtitle` 完全一致，任一侧改动都要同步，否则页内预览与实际落盘时间轴会出现时长漂移。
- **`fillEnds` 是原位修改，且与 `parseSrtText` 不可叠加**：它直接改写传入数组元素并返回同一引用（调用方需保留原数据应先自行拷贝）；而 SRT 块内结束时间是显式信息或已估时，套用 `fillEnds` 会按下一条起始改写它，因此 `parseSrtText` 特意绕开（源码已标注）。
- **落盘格式为 `[开始-结束] 文本`**：`serializeItems` 用 `fmtTimeMs` 毫秒精度写**真实结束时间**（而非下一行起始），供 HTML / 视频阶段严格按窗口显示；无有效 `start` 时退化为纯文本行。
- **解析细节：小数按位数解释、无时间戳行从 0.4 秒起步、无时间轴块容错**：`.5` = 500ms、`.500` = 500ms，按数字位数除以 `10^位数`，避免把 `.5` 误读成 5ms，并与 `fmtTimeMs` 对齐；`parseSubtitleText` 与 `parseSrtText` 的 `autoT` 初值均为 `0.4`，为无时间戳字幕留起始缓冲；SRT 文本域中无时间轴的块不报错，按纯文本逐行估时处理，因此用户可直接粘贴整段文稿。
- **文本清洗与过滤**：`serializeItems` / `plainText` / `itemsToSrt` 均把连续空白折叠为单个空格并 trim，空文本条目一律过滤；`itemsToSrt` 序号按过滤后顺序重排，中间有空条目时导出序号仍连续。
- **保存与打开都没有形态判定**：`saveToProject` 只做「空文本拦截 → 调 `project:save-subtitle` → 刷新」，`TranscribeSection.open()` 只置 `maskVisible = true`；每个项目都可读可写。
- **`countTip` 总时长取自末条 `end`**：条目乱序或末条无结束时间时，该数字只是粗略提示。
- **模型四态与 `fallback` 语义**：`startDisabled` 在 `!(twModel.id && twModel.downloaded)` 时禁用主按钮；`modelHint`、`modelColor` 与 `modelHintColor`（`rgba(255, 176, 32, 0.9)`）同时给出引导，`onManage()` 直接跳设置页。`fallback` 仅当 `isCurrent` 与 `currentModelId` 均未命中、退而找到某个已下载模型时才为 `true`，文案「（已下载，尚未设为当前使用）」，但此时 `startDisabled` 允许开转（`id && downloaded` 成立）。
- **音频格式限制与主进程自动转码**：`TW_DIRECT_EXTS = ['wav', 'mp3', 'flac', 'ogg']` 与主进程 `whisper.ts` 注释一致；其余格式（`mp4`/`m4a`/`aac` 等）由主进程 `prepareAudio` 用内置 ffmpeg 转为 16kHz 单声道 PCM wav，渲染层只做提前告知；ffmpeg 缺失或转换失败时错误经主进程返回的 `message` 呈现。
- **进度不确定态与只处理两个阶段**：`percent` 为 `null`（或非数字 / 负数）时进度条走 `indeterminate` + 宽度 0，避免显示错误百分比，`done` / `error` 固定填满 100；主进程还会发 `downloading` / `done` / `error`，本弹窗只消费 `loading` 与 `transcribing`，`done` 结果以 `transcribe()` 返回值为准。
- **错误处理分层与重复提交防护**：`transcribe()` 返回 `ok: false` 与抛异常都会把 `message` 同时写入进度条（`kind: 'error'`）和状态行（`hf-error`）；`status()` / `projectAudio()` / `pickAudio()` 均带 `.catch(() => null)` 兜底。`doTranscribe()` 首行 `if (transcribing.value) return`，另有 `startDisabled` 与「转录中…」文案双重约束；主进程侧也会以「已有转录任务进行中，请稍候」拒绝并发。
- **ESC 监听与 `onProgress` 单订阅**：旧 `transcribe.js` 的 `escHandler` 重绑 guard 逻辑与 `escTxt` 已删除，改为 `onMounted` / `onBeforeUnmount` 成对注册与注销 `document` 的 `keydown`；preload 的 `onProgress` 只保留一个回调，重复注册会替换，回调内以 `maskVisible` 为门槛，弹窗关闭时不会误刷进度。
- **保存提示的可见性与「回填即落盘」**：`applyTranscript()` 先 `closeTw()`（会清空状态）再在 `saveToProject` 回调里写状态，此时遮罩已隐藏（`v-show`），成功 / 失败文案需重开弹窗才可见；条目本身已写入编辑器，失败时提示「已回填，但自动保存失败」。`saveToProject({ silent: true })` 静默保存是刻意设计，避免用户忘记保存，失败不丢数据。
- **语言与简繁、转码语义都在主进程**：本组件只负责传 `language`；`zh-hant` 在主进程被映射为 whisper 的 `zh` 且不做繁转简，`zh` 与 `auto`（识别为 `zh` 时）会做繁转简——这些逻辑都在主进程 `whisper.ts`，渲染层无相关代码。

## 7. 运行环境缺包守卫（`useEnvGate`）

`whisper-cli` **随安装包**（`extraResources`），所以「文字转字幕」装完即可离线用；**只有音频格式不在 `wav / mp3 / flac / ogg` 里、需要 ffmpeg 转码时**才会缺包——ffmpeg 属于**不随安装包**的 ffmpeg 运行环境包（实测 **42.6 MB**，2026-10-14；首次用到时下载，见 `docs/runtime-pack-split.md`）。

- `TranscribeSection.vue` 的 `doTranscribe(skipEnvGuard)`：动手前 `const g = await envGate.guard(['ffmpeg'], '文字转字幕', () => { void doTranscribe(true) })`，`!g.ok`（缺包已弹框或用户取消）就 `return`，**不发 IPC、不产生下载**；
- 主进程返回 `fail.needPacks`（转码时才发现缺 ffmpeg，主进程侧抛 `FfmpegNeededError` 后回传）时再 `envGate.guard(fail.needPacks, '文字转字幕', …)` 一次；
- 「继续」以 `skipEnvGuard = true` 重发本次转录；确认框由 `App.vue` 内联渲染（`useEnvGate` 是模块级单例），本组件只调 `guard()`。
