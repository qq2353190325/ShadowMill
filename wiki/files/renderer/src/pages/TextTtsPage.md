# src/renderer/src/pages/TextTtsPage/（页面）

> 「文字生音频」页外壳 + 合成卡 / 逐句对齐卡 / 音色管理卡组 + 共享助手

- **覆盖文件**：

| 文件（相对 `src/renderer/src/pages/`） | 行数 | 作用 |
| --- | --- | --- |
| `TextTtsPage/index.vue` | 43 | 页面外壳：`StepBar` + 三个 Tab，`v-show` 挂载三张卡，并消费「管理音色」Tab 信号 |
| `TextTtsPage/SynthSection.vue` | 360 | 「文字生音频（TTS 合成）」卡：音色/模型、保存位置三选一、合成、结果与已生成音频复用 |
| `TextTtsPage/AlignSection.vue` | 293 | 「字幕配音（逐句对齐）」卡：逐句 TTS + 音频/时间轴双向对齐，结果写回项目 |
| `TextTtsPage/VoiceSection.vue` | 320 | 「音色管理」卡组：创建克隆音色 / 我的音色列表 / 音色映射管理（原独立页 `SoundCopyPage/index.vue` 已下线，并入本页第三个 Tab） |
| `TextTtsPage/helpers.ts` | 129 | 模块级共享助手：配置校验、音色加载、模型解析、共享 `ref`（含「管理音色」Tab 信号） |

- **类型**：页面组件（Vue 3 `<script setup lang="ts">` SFC）+ 页面子组件（3 个 SFC）+ 模块级 TS 助手（`<script setup>` 之外的原生模块，无组件）
- **对外导出**：
  - 页面组件默认导出，**无 props、无 emit、无路由参数**；`SynthSection` / `AlignSection` / `VoiceSection` 默认导出、均为无 props 无 emit（父页只用 `v-show` 控制显隐，三卡**常驻挂载**）。
  - `helpers.ts` 共 13 个命名导出：接口 `VoiceOption`、`VoiceOptionGroup`；`ref` 常量 `cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`、`voiceTabRequest`；函数 `setCfgSaveDir`、`requestVoiceTab`、`requireCfg`、`loadVoices`、`voiceModelOf`、`firstVoiceId`（另有 1 个非导出内部函数 `loadVoicesFallback`）。

## 1. 结构总览

- **挂载关系**：`pages/index.ts` 页面注册表把 `TextTtsPage/index.vue` 登记为 `'text-tts'` 页（无 vue-router，`goPage` 切换 `<component :is>`）；`StepBar :page="'text-tts'"` 负责步骤高亮与「重进本页」刷新。原独立页键 `'sound-copy'`（音色管理）已从注册表与 `PageKey` 联合类型中删除。
- **Tab 关系**：`activeTab: Ref<'synth' | 'align' | 'voice'>`（初值 `'synth'`）驱动三个 `button.hf-tab`（`data-tab="synth"` / `"align"` / `"voice"`）与三张卡的 `v-show`；**用 `v-show` 而非 `v-if`，三卡在页面挂载时都会被创建且从不销毁**，切 Tab 不重置卡内状态。
- **「管理音色」Tab 信号**：`helpers.ts` 的布尔 `ref` `voiceTabRequest` 是合成卡与外壳之间的切 Tab 通道。同页点击「管理音色」只置位信号、由外壳 `watch` 消费（只切 Tab、不换页，保住已填的合成文本）；跨页点击先置位再 `goPage('text-tts')`，新挂载的外壳在 `onMounted` 里消费同一信号。消费后立刻复位为 `false`。
- **helpers 复用**：

| 使用方 | 导入成员 |
| --- | --- |
| `TextTtsPage/index.vue` | 2 个：`ttsResultShown`（`onMounted` 中复位）、`voiceTabRequest`（`watch` + `onMounted` 消费） |
| `TextTtsPage/SynthSection.vue` | 10 个：`cfgSaveDir`、`firstVoiceId`、`loadVoices`、`modelTag`、`requestVoiceTab`、`requireCfg`、`setCfgSaveDir`、`ttsResultShown`、`voiceGroups`、`voiceModelOf` |
| `TextTtsPage/AlignSection.vue` | 5 个：`firstVoiceId`、`loadVoices`、`requireCfg`、`voiceGroups`、`voiceModelOf`（不用 `cfgSaveDir` / `modelTag` / `ttsResultShown` / `setCfgSaveDir` / `voiceTabRequest`） |
| `TextTtsPage/VoiceSection.vue` | **0 个**：不导入 `./helpers`，自带私有 `requireCfg`，音色候选自行拉取（见第 5 节） |

- **共享单例**：`helpers.ts` 的 5 个 `ref` 定义在模块作用域，跨页面切换、跨组件共享同一份实例（不随卸载销毁）；`voiceGroups` 由合成卡与对齐卡共用，后一次加载的结果对两卡同时生效；`voiceTabRequest` 由合成卡写、外壳消费。`VoiceSection` 维护的是自己的一套状态（`models` / `sysVoices` / `cloudVoices` / `profiles`），与 `voiceGroups` 互不影响。

## 2. TextTtsPage/index.vue（外壳）

- **模板结构**：`div > StepBar(:page="'text-tts'")` → `div.hf-tabs`（`button.hf-tab` × 3，`:class="{ active: activeTab === '…' }"`、`@click` 直接赋值）→ `<SynthSection v-show="activeTab === 'synth'" />` → `<AlignSection v-show="activeTab === 'align'" />` → `<VoiceSection v-show="activeTab === 'voice'" />`。Tab 文案：「文字生音频（TTS 合成）」「字幕配音（逐句对齐）」「音色管理（克隆 / 改名 / 绑模型）」。
- **状态**：仅 `activeTab`（三值字符串字面量联合）。
- **函数 `goVoiceTab()`**：`activeTab.value = 'voice'` → `voiceTabRequest.value = false`（消费掉信号，避免下次进本页误落在音色管理 Tab）→ `document.getElementById('content')?.scrollTo({ top: 0 })` 复位滚动位置。
- **信号监听**：`watch(voiceTabRequest, (v) => { if (v) goVoiceTab() })` —— 只响应 `false → true` 的置位；`goVoiceTab` 内部的 `true → false` 复位不会再次触发 `watch`（布尔而非计数器的原因）。
- **生命周期**：`onMounted` 中 `ttsResultShown.value = false`（每次进入本页复位合成结果卡标记），随后 `if (voiceTabRequest.value) goVoiceTab()`——覆盖「先置位再 `goPage('text-tts')`」的跨页场景；子组件各自的 `onMounted` 亦在此刻执行（`SynthSection.vue` 第 349 行、`AlignSection.vue` 第 272 行、`VoiceSection.vue` 第 308 行），三卡都会各自拉配置与音色数据。
- **import**：`vue` 的 `onMounted` / `ref` / `watch`；`./helpers` 的 `ttsResultShown`、`voiceTabRequest`；`@renderer/components/StepBar.vue`；`./SynthSection.vue`、`./AlignSection.vue`、`./VoiceSection.vue`。
- **本文件不直接调用任何 IPC**，`window.*` 调用全部发生在三张卡与 `helpers.ts` 中；`ttsResultShown` 的消费方只有 `SynthSection`（对齐结果走自身的 `alignResult`）。
- **流程**：页面被注册表挂载 → `activeTab` 初始化为 `'synth'` → 模板先渲染 `StepBar`、再渲染 Tab 按钮组、最后创建三张卡（`v-show`，三卡都会挂载）→ 父页 `onMounted` 复位 `ttsResultShown` 并消费可能已置位的 `voiceTabRequest` → 三卡各自 `onMounted` 开始拉配置与音色 → 点 Tab 只改 `activeTab`，不改动组件实例 → 点 `StepBar` 重进本页时 `goPage(props.page)` 重建页面组件，流程从挂载重新开始（`ttsResultShown` 再次被复位）。
- **样式**：模板只用全局设计系统类名（`.hf-tabs` / `.hf-tab` / `.hf-tab.active`），无组件级 `<style>`；卡片风格与 CSS 变量以 `src/renderer/src/assets/main.css` 为准。

## 3. TextTtsPage/SynthSection.vue（文字生音频卡）

**模板区块**（三个 `div.card.hgen-panel`）：

| 区块 | 关键绑定 / 事件 |
| --- | --- |
| 合成主卡 | 标题「文字生音频（TTS 合成）」+ `.hgen-tip`（说明含兜底模型 `{{ modelTag }}`，末句引导到「音色管理」页改名/改模型）；`textarea.hgen-subtitle` `v-model="text"`（高 150px，`placeholder="输入要合成语音的文字…"`）；「载入脚本旁白」`@click="onLoadNarration"` |
| ↳ 音色行 | `HfSelect v-model="voiceId" :groups="voiceGroups"`（`voiceGroups` 原样透传：`VoiceOption` 的键就是 `value`，形状与 `HfSelectOption` 对齐，无需再包一层映射）+「刷新」`onRefreshVoice` +「管理音色」`onManageVoice`（`title` 说明「切到本页「音色管理」Tab…」） |
| ↳ 保存到行 | `HfSelect v-model="saveTo" :groups="saveToGroups" :title="保存位置说明" @change="onSaveToChange"`（选项 `proj:<p.name>`「项目「标题或名」（audio/）」、`custom`「自定义目录…（已选/未选择）」、`out`「音频输出目录（不写入项目）」）+「打开目录」`onOpenFolder`；自定义目录行 `v-show="parseSaveTo().kind === 'custom'"`（展示 `cfgSaveDir` +「恢复默认」`onClearCustom`） |
| ↳ 名字与提交 | `input.hgen-input v-model="audioName"`（选填，留空自动命名「时间_前五个字_音色id」）；「合成并保存」`:disabled="synthBusy"` `@click="onSynth"`；`.hf-status :class="statusClass"`；「API Key 设置」`goPage('settings')` |
| 合成结果卡 | `v-show="ttsResultShown"`（共享状态）；`resultPath ? '保存路径：'+resultPath : ''`、「打开目录」`:disabled="!resultPath"`；`audio ref="resultAudioEl" :src="resultSrc" controls`（高 54px）；语速 `−`/`+` 按钮（`resultRateStep(∓0.05)`）+ `input ref="resultRateEl" :value="resultRateValue" @input="onResultRateInput"` |
| 已生成音频卡 | 无条件显示；`HfSelect v-model="genSelIdx" :groups="genSelectGroups" empty-text="（暂无已生成音频）" @change="updateGenSel"`（空列表时由 HfSelect 的 `empty-text` 显示提示，已无占位 option）+「刷新」`fillGenAudios(false)` +「试听」`onGenPlay`；`{{ genInfo }}`、「打开目录」`:disabled="genOpenDisabled"`、「设为当前项目背景音频」`:disabled="genSetDisabled"`；试听行 `v-show="genPlayRowVisible"`（`audio ref="genAudioEl"` + 语速 `genRateEl` / `genRateValue` / `onGenRateInput` / `genRateStep`） |

**状态与常量**：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `status` / `statusClass` | `Ref<string>` | 状态栏文案与样式类（`''` / `'hf-ok'` / `'hf-error'`） |
| `voiceId` | `Ref<string>` | 当前选中音色 id |
| `text` | `Ref<string>` | 合成文本 |
| `audioName` | `Ref<string>` | 自定义音频名字（选填） |
| `saveTo` / `lastSaveTo` | `Ref<string>` | 保存位置选择值（`proj:<name>` / `custom` / `out`）与上一次有效选择（取消选目录时回退用） |
| `saveToGroups` | `ComputedRef<HfSelectGroup[]>` | 「保存到」下拉数据：单组（`label: ''`），选项 = 各项目 `proj:<name>` + `custom` + `out`，`custom` 的 label 随 `cfgSaveDir` 显示「已选/未选择」 |
| `synthBusy` | `Ref<boolean>` | 合成中标记，控制主按钮 `disabled` |
| `resultPath` / `resultSrc` | `Ref<string>` | 最近一次合成的保存路径与 `file:///` URL |
| `resultAudioEl` / `resultRateEl` | `Ref<HTMLAudioElement \| null>` / `Ref<HTMLInputElement \| null>` | 结果试听 `<audio>` 与语速输入框元素 |
| `resultRateValue` | `Ref<string>` | 结果语速显示值，初值 `'1'` |
| `genAudios` | `Ref<GenAudioItem[]>` | 已生成音频列表（`listGenerated` 的 `items`） |
| `genSelIdx` / `genInfo` | `Ref<string>` | 下拉选中项（字符串下标）与选中项完整路径 |
| `genSetDisabled` / `genOpenDisabled` | `Ref<boolean>` | 「设为背景音频」/「打开目录」禁用态，初值均 `true` |
| `genPlayRowVisible` | `Ref<boolean>` | 试听行显隐 |
| `genAudioEl` / `genAudioSrc` / `genRateEl` / `genRateValue` | `Ref` | 列表试听元素、预览 URL、语速输入框与语速值（初值 `'1'`） |
| `genSelectGroups` | `ComputedRef<HfSelectGroup[]>` | 按 `it.group` 分组（空值归 `'其他'`）供 HfSelect 使用，`Map` 聚合后输出 `{ label, options }[]`；option 的 `value` 仍是**全局下标字符串** `String(i)`、`label` 为 `it.name` |
| `GenAudioItem`（局部 `interface`） | `{ path: string; name: string; group: string; size: number; mtime: number }` | 列表项结构 |

**函数**：`setStatus(text, kind)`（同时写 `status` / `statusClass`，作为 `onStatus` / `onError` 双签名回调传入 helpers）；`onRefreshVoice`；`onManageVoice()`（`requestVoiceTab()` 置信号，仅当 `activeMenu.value !== 'text-tts'` 时才 `void goPage('text-tts')`——同页点击不换页，保住已填内容）；`onLoadNarration`（读 `appState.project.content.scenes`，取各 `s.narration.trim()` 过滤空串后以 `'\n\n'` 拼接，无旁白时报错引导去「内容脚本」页）；`parseSaveTo()`（解析为 `{ kind: 'custom' | 'output' | 'project' | 'none'; saveDir?; projectName? }`，`proj:` 前缀用 `v.slice(5)` 取项目名）；`fillSaveTo()`；`onSaveToChange()`；`onClearCustom()`；`onOpenFolder()`；`onSynth()`；`onResultRateInput()` / `resultRateStep(delta)`；`onOpenResultDir()`（无路径 `toast('暂无合成文件可打开')`）；`updateGenSel()`（写 `genInfo` / `genAudioSrc`，并据「选中的条目是否存在」置两个禁用态：找不到条目则清空信息、把 `genSetDisabled` / `genOpenDisabled` 置回 `true` 并返回；命中则置 `false` 并隐藏试听行）；`fillGenAudios(silent)`；`onGenPlay()`；`onGenSetBg()`；`onGenOpenDir()`；`onGenRateInput()` / `genRateStep(delta)`；`onMounted`。

**合成结果与已生成音频细节**：

| 细节 | 实现 |
| --- | --- |
| 结果卡显隐 | 共享 `ttsResultShown`，在 `onSynth` 成功后置 `true`；隐藏依赖父页 `onMounted` 的复位 |
| 结果语速 | `applyRate` / `stepRate` 的返回值写回 `resultRateValue`；`−` / `+` 步长固定 0.05 |
| 已生成列表分组 | `genSelectGroups` 用 `Map` 按 `it.group`（空 → `'其他'`）聚合，`option` 的 `value` 为 `String(i)`、`label` 为 `it.name` |
| `fillGenAudios(silent)` | `listGenerated()` 失败时仅在 `silent === false` 报错；空列表清空 `genSelIdx` / `genInfo` / `genAudioSrc`、禁用两按钮并隐藏试听行（下拉由 HfSelect 的 `empty-text` 兜底），非空则调 `updateGenSel()` 选中首项 |
| 试听行 | `onGenPlay` 对同一个 `<audio>` 做 play/pause 切换，`play().catch` 提示「音频试听失败（可能文件已被移动）」 |

**关键流程**：

1. **初始化**：`fillSaveTo()` → 异步 `requireCfg(setStatus)`（失败即整体跳过）→ 再 `fillSaveTo()`（配置已刷新 `cfgSaveDir`）→ `loadVoices(setStatus)` → `voiceId = firstVoiceId()` → `fillGenAudios(true)` 静默拉列表。
2. **保存位置三选一**：HfSelect 选中 `custom` 且 `cfgSaveDir` 为空才 `pickDir()`；`canceled` / 非 `ok` / 无 `dir` 一律回退 `lastSaveTo`（避免出现"选了自定义但无目录"的空档行；这是**程序化赋值**，不会再次触发 `@change`）；成功则 `setCfgSaveDir(r.dir)` + `saveConfig({ saveDir })`（保存失败仅提示"目录已选但保存设置失败"）。`fillSaveTo` 默认优先级：已持久化自定义目录 → `custom`；否则有项目 → `proj:<当前项目>`（内置项目或无 `currentName` 时取 `appState.myProjects[0].name`）；无项目 → `out`；算出的值不在选项内也兜底 `out`。
3. **合成**：`requireCfg` → 校验 `text.trim()`（"请输入合成文本"）与 `voiceId`（"请先选择（或创建）音色"）→ `parseSaveTo()` 为 `none` 时报"请选择保存位置"→ `voiceModelOf(v)` 取绑定模型 → `synthBusy = true`，状态「正在按所选音色（模型名或'默认模型'）合成并下载语音…」→ 调 `synth` → 成功时按 `res.savedTo`（`'project'` / `'output'` / 其它）生成"已保存到…"文案，置 `ttsResultShown = true`、`resultPath = res.savePath || ''`、有路径时 `resultSrc = 'file:///' + encodeURI(path.replace(/\\/g, '/'))`，再 `fillGenAudios(true)`；失败显示 `res.message` 或"合成失败"；`finally` 复位 `synthBusy`。
4. **结果试听**：语速输入或 `−`/`+`（步长 0.05）经 `applyRate` / `stepRate` 解析失败回退 1、钳制 0.5~2.0，写回 `el.value` 与 `audio.playbackRate`，返回值同步到 `resultRateValue`——**仅改播放速率，不改磁盘音频**。
5. **已生成音频复用**：`genSelectGroups` 分组展示 → `updateGenSel` 写路径与预览 URL → 「试听」对同一 `<audio>` 做 play/pause 切换（失败提示"可能文件已被移动"）→ 「设为背景音频」内置项目直接拒绝，否则 `setAudio(appState.currentName, it.path)` → `refreshProject()` → `toast('已设为当前项目背景音频：' + res.audioFile)`。

**调用的 preload**：`voiceTools.pickDir()`、`voiceTools.saveConfig({ saveDir })`、`voiceTools.getSaveDir({ projectName, saveDir, defaultOut })`、`voiceTools.synth(...)`、`voiceTools.listGenerated()`；`projectTools.openFolderOf(...)`、`projectTools.setAudio(...)`。

## 4. TextTtsPage/AlignSection.vue（字幕配音逐字对齐卡）

**两种模式**（`alignMode`，默认 `'audio-driven'`）：

- `audio-driven`「重排字幕（音频驱动）」：按实测每句时长重建字幕时间线，首句时间锚点保留，总时长随之变化；句间停顿**优先按字幕原有间隔推算**，放不下时才用「句间停顿（秒）」兜底（该输入行仅此模式显示，`input type="number"` `min=0` `max=10` `step=0.1`，`gap` 默认 `'0.5'`）。
- `timeline-driven`「修正音频（时间轴驱动）」：字幕时间戳不变，把每句配音摆到其字幕时间点（句间补静音）；放不下时轻微加速（≤1.15 倍）或顺延后续句子并同步改字幕。

**模板要点**：`.card.hgen-panel`（`margin-top:16px`）+ `.panel-title`；两条模式说明 `.hgen-tip` 按 `alignMode` `v-show`；字幕来源行 `HfSelect v-model="subSrc" :groups="subSrcGroups" title="选用哪份字幕逐句合成配音" @change="syncSubCount"`（选项 `__current__`「当前项目字幕（N 条）」与 `appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)` 的项目字幕）+「刷新」`syncSubCount` + `subCountTip`；音色行 `HfSelect v-model="voiceId" :groups="voiceGroups"`（与合成卡共用同一份音色分组数据）+「刷新」`onRefreshVoice`；`radio` 两项；操作行「开始对齐合成」`:disabled="alignBusy"`、「取消」`v-show="alignBusy"`、「重试」`v-show="!alignBusy && !alignResult"`（后两者均指向 `startAlign` / `onCancel`）；`.whisper-bar-wrap` `v-show="barVisible"`（`.whisper-bar` 的 `indeterminate` 类由 `barIndeterminate` 控制，`.whisper-bar-fill` 类为 `barState`、宽度 `barPercent + '%'`，文案 `barText`）；`.hf-status :class="statusClass"`；结果区 `v-show="alignResult !== null"`（`<audio ref="alignAudioEl" :src="alignAudioSrc" controls>`、「打开目录」`onOpenDir`、「写入当前项目」`writeAlign`、`summary`、`.sub-list` 明细）；明细行 `.align-row`：序号 `d.index + 1`、文本 `escTxt(d.text)`（与 title 同源）、`fmtTime(d.subtitleStart)`、`fmtTime(d.audioStart)`、`Number(d.audioDur).toFixed(1) + 's'`、状态徽标、`d.segPath` 存在时的「试听」`playSeg`；徽标 `.align-badge`：`accelerated` → `加速 x{rate.toFixed(2)}`（warn）、`pushed` → `顺延 +{delta.toFixed(1)}s`（warn）、其余「正常」（ok）；末尾隐藏 `<audio ref="segAudioEl" style="display:none">`。

**类型**：

| 名称 | 字段 |
| --- | --- |
| `AlignDetail` | `index: number`、`text: string`、`subtitleStart: number`、`audioStart: number`、`audioDur: number`、`status: string`、`rate: number`、`delta: number`、`segPath?: string` |
| `AlignResult` | `audioPath: string`、`subtitleText: string`、`details: AlignDetail[]`、`totalDur: number`、`mode: string` |

**状态**：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `status` / `statusClass` | `Ref<string>` | 状态文案与语义类（`hf-ok` / `hf-error` / 空串） |
| `subSrc` | `Ref<string>` | 字幕来源，默认 `'__current__'` |
| `subSrcGroups` | `ComputedRef<HfSelectGroup[]>` | 字幕来源下拉数据：单组（`label: ''`），首项固定 `__current__`（label 带 `appState.project?.subtitleCount`），其余为「非当前项目且 `hasSubtitle`」的项目项（`value` 为裸项目名） |
| `subCountTip` | `Ref<string>` | 当前项目字幕行数提示，选其它项目时为空串 |
| `voiceId` | `Ref<string>` | 选中音色 ID |
| `alignMode` | `Ref<'audio-driven' \| 'timeline-driven'>` | 对齐方式，默认 `'audio-driven'` |
| `gap` | `Ref<string>` | 句间停顿秒数字符串，默认 `'0.5'` |
| `barVisible` / `barIndeterminate` / `barPercent` / `barText` / `barState` | `Ref` | 进度条可见性、不确定态、百分比、文案、状态类（`done` / `error` / 空） |
| `alignBusy` | `Ref<boolean>` | 任务进行中标志 |
| `alignResult` | `Ref<AlignResult \| null>` | 对齐结果 |
| `alignAudioEl` / `alignAudioSrc` | `Ref` | 整轨音频元素与 `file:///` 地址 |
| `segAudioEl` | `Ref<HTMLAudioElement \| null>` | 单句试听播放器 |
| `details` | `ComputedRef<AlignDetail[]>` | `alignResult.details` 或 `[]` |
| `summary` | `ComputedRef<string>` | `共 N 句 · 总时长 分:秒 · 加速 N 句 · 顺延 N 句 · …`，末段按 `res.mode` 区分「字幕时间已按配音重排」/「音频已按字幕时间摆放」 |

**函数**：`setStatus(text, kind)`；`countSubtitleLines(text)`（按行分割、trim、滤空行计数）；`syncSubCount()`（`__current__` 显示「共 N 行」，行数取自 `appState.project.subtitle`，否则置空）；`getAlignSubtitleText()`（`__current__` 用 `appState.project.subtitle`，为空提示「当前项目没有字幕，请先到「字幕生成」页生成或填写」；其它来源 `window.projectTools.load(v)` 读 `res.subtitle`，为空提示「项目「v」没有字幕」）；`onRefreshVoice()`；`showAlignBar(info, indeterminate, percent?)`（`kind` 为 `done` / `error` 时置 `barState`，`percent` 非数字时 `done` / `error` 填 100、否则 0）；`hideAlignBar()`；`resetAlignUi()`；`startAlign()`；`onCancel()`；`playSeg(path)`；`onOpenDir()`；`writeAlign()`；`onMounted`。

**`synthAligned` 载荷**：`{ projectName: appState.currentName, subtitleText: sub.text, voice: v, voiceModel, mode, gapSec }`，其中 `gapSec = Number(gap.value)`、`voiceModel = voiceModelOf(v)`。

**`startAlign` 流程**：`alignBusy` 为真 → `toast('对齐合成进行中，请稍候')` 返回；`requireCfg` 未通过返回；`getAlignSubtitleText()` 失败则 `setStatus(message, 'hf-error')`；`voiceId` 为空提示「请先选择（或创建）音色」；然后置 `alignBusy = true`、`resetAlignUi()`、`hideAlignBar()`、状态「正在提交逐句合成任务…」，再调用 `synthAligned`。结果分支：`res.ok` → 写 `alignResult`、`alignAudioSrc = 'file:///' + encodeURI(audioPath 反斜杠转正斜杠)`、进度条「对齐完成：N 句」（`done`）、状态 `res.message || '对齐完成'`（`hf-ok`）；`res.canceled` → `hideAlignBar()` + 状态与 toast 用 `res.message || '已取消'`（**不算错误**）；其它失败 → 进度条错误文案 + 状态 `hf-error` + toast；`catch` 同样把异常消息写进进度条与状态；`finally` 复位 `alignBusy`。

**进度阶段**（`voiceTools.onAlignProgress` 回调 `p`，字段 `stage` / `percent` / `message`）：

| `p.stage` | 进度条 | 状态 |
| --- | --- | --- |
| `synth` | 确定态，`p.percent` | `p.message \|\| '合成中…'` |
| `measure` | 确定态，`p.percent`（渲染层与 `synth` 同分支；主进程当前只推送 `synth`） | `p.message \|\| '合成中…'` |
| `assemble` | 不确定态（转圈） | `p.message \|\| '装配中…'` |
| `done` | `kind: 'done'`，填满 | `hf-ok` |
| `error` | `kind: 'error'`，填满 | `hf-error` |

主进程实际文案示例：`开始逐句合成（N 句）…`、`合成第 i/N 句…`、`对齐时间轴并装配音轨…`、`对齐完成：N 句 · 总时长 分:秒`。

**`writeAlign` 写入项目**：无 `alignResult` → `toast('暂无对齐结果')`；内置项目守卫（与 `startAlign` 各一道）；逐句生成行：`s = max(0, subtitleStart)`、`e = s + max(0, audioDur)`，文本 trim 后为空跳过，格式 `'[' + fmtTimeMs(s) + (e > s ? '-' + fmtTimeMs(e) : '') + '] ' + txt`（**结束时间取实测音频起点 + 实测时长**，与成片音轨严格一致）；全空 → `toast('对齐结果为空，无法写入')`；`projectTools.saveSubtitle(appState.currentName, lines.join('\n'), '')` 失败 → `toast('字幕写回失败')`；`projectTools.setAudio(appState.currentName, last.audioPath)` 失败 → `toast('音频写回失败')`；`refreshProject()` 后 `toast('已写入：字幕 N 条 + 对齐配音 ' + r2.audioFile)`。两步写回**任一步失败即中止、不回滚**。

**调用的 preload**：`voiceTools.onAlignProgress(cb)`、`voiceTools.cancelAlign()`、`voiceTools.synthAligned(payload)`；`projectTools.load(name)`、`projectTools.saveSubtitle(name, subtitle, title)`、`projectTools.setAudio(name, audioPath)`、`projectTools.openFolderOf(...)`。

## 5. TextTtsPage/VoiceSection.vue（音色管理卡组）

原独立「音色管理」页 `SoundCopyPage/index.vue`（页键 `sound-copy`）下线后整体并入本页第三个 Tab：模板与脚本基本沿用原页，下拉由原生 `<select>` 换成全局 `HfSelect`，并改为由本页外壳 `v-show` 常驻挂载；与 `./helpers` 无任何耦合（自带私有 `requireCfg`，音色候选自行拉取）。

**模板区块**（三个 `div.card.hgen-panel`，后两张卡行内 `style="margin-top:16px"`）：

| 区块 | 关键绑定 / 事件 |
| --- | --- |
| 创建克隆音色卡 | `.panel-title`「音色管理 · 创建克隆音色」+ `.hgen-tip`（长说明：创建计费 0.01 元/个；Qwen-Audio-TTS（`qwen-audio-3.0-tts-flash`）需粘贴**可公开访问的音频 URL**（不接受本地文件直传）；`qwen3-tts-vc-*` 系列上传本地音频（`.wav` / `.mp3` / `.m4a`，Base64 后需小于 10 MB））；「显示名称」`input.hgen-input v-model="vcName"`（中文可）；「目标模型」`HfSelect v-model="vcModel" :groups="cloneModelGroups" @change="applyInputMode"`；本地文件行 `v-show="!urlMode"`（「选择音频文件」`onPick` + `span.hf-file`（`audioPath ? escTxt(audioPath) : '未选择文件'`））；URL 行 `v-show="urlMode"`（`input.hgen-input v-model="vcUrl"`，placeholder `https://...`）；动作行「创建音色」`.hf-btn.hf-btn-primary` `onCreate` +「API Key 设置」`goPage('settings')`；`.hf-status :class="statusClass"` |
| 我的音色卡 | `.panel-title`「我的音色」+ `.hf-status :class="listStatusClass"`；`v-if="!voiceList.length"` 时 `.hgen-tip`「暂无音色。可在上方「创建克隆音色」区创建，或到「文字生音频」标签页使用内置系统音色。」；否则行内 grid 表头（显示名称 / 音色 ID（合成模型）/ 创建时间 / 参数）+ 行 `v-for="it in voiceList" :key="it.key"`：`escTxt(it.name)` + `[系统]` / `[克隆]` 徽标、按钮 `@click="editVoice(it.key)"`（文案 `escTxt(it.voice)（escTxt(it.targetModel)）`）、`escTxt(it.extra)`；动作行「刷新音色列表」`loadAll(false)` |
| 音色映射管理卡 | `.panel-title`「音色映射管理」+ `.hgen-tip`（显示名与模型仅保存在本机 `settings.json`；系统音色不传中文名时用默认描述、不选模型时用该音色默认合成模型）；「音色」`HfSelect ref="mapVoiceEl" v-model="mapVoice" :groups="mapGroups"`；「显示名称」`input.hgen-input v-model="mapName"`；「合成模型」`HfSelect v-model="mapModel" :groups="modelGroups"`；动作行「保存映射」`.hf-btn.hf-btn-primary` `onSaveMap` +「解除映射」`onClearMap`；`.hf-status :class="mapStatusClass"` |

**类型**（4 个均为卡内局部 `interface`，不导出）：

| 名称 | 字段 |
| --- | --- |
| `ModelView` | `id: string`、`label: string`、`role?: string`、`input?: string`、`isDefault?: boolean` |
| `SysVoiceView` | `voice: string`、`desc: string`、`langs: string`、`series: string[]`、`model: string` |
| `CloudVoiceView` | `voice: string`、`target_model?: string`、`gmt_create?: string` |
| `ProfileView` | `key: string`、`name: string`、`voice: string`、`targetModel: string`、`type: string` |

**状态与数据**：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `models` | `Ref<ModelView[]>` | `voiceTools.listModels()` 返回的全量模型（含 `role` / `input` / `isDefault` 等元数据） |
| `cloneModels` | `ComputedRef<ModelView[]>` | `models` 中 `role === 'clone'` 的子集，供创建区模型下拉 |
| `sysVoices` / `cloudVoices` | `Ref<SysVoiceView[]>` / `Ref<CloudVoiceView[]>` | `listSystemVoices()` / `list()` 的结果 |
| `profiles` | `Ref<Record<string, ProfileView>>` | `getProfiles()` 的本地映射表（键为 `system:<voice>` / `custom:<voice>`） |
| `modelGroups` / `cloneModelGroups` | `ComputedRef<HfSelectGroup[]>` | 均为单组（`label: ''`）下拉数据：全部模型 / 仅克隆模型；option 的 `value` 为模型 id、`label` 为模型名 |
| `vcName` / `vcModel` / `vcUrl` | `Ref<string>`（初值 `''`） | 创建表单：显示名称 / 目标模型 id / 音频 URL |
| `audioPath` | `Ref<string \| null>`（初值 `null`） | 本地音频路径（`pickAudio()` 返回值） |
| `urlMode` | `Ref<boolean>`（初值 `false`） | 是否走 URL 模式，只由 `applyInputMode()` 按模型 id 判定 |
| `status` / `statusClass` | `Ref<string>` | 创建卡状态文案与语义类（`''` / `hf-ok` / `hf-error`） |
| `listStatus` / `listStatusClass` | `Ref<string>` | 「我的音色」卡状态（成功文案「系统音色 N 个 · 克隆音色 M 个」） |
| `mapStatus` / `mapStatusClass` | `Ref<string>` | 映射卡状态 |
| `voiceList` | `ComputedRef<{ key; name; voice; targetModel; type; extra }[]>` | 「我的音色」表行：系统音色 + 克隆音色合并，名称/模型优先取本地映射（见下） |
| `mapVoiceEl` | `Ref<InstanceType<typeof HfSelect> \| null>` | 映射卡「音色」下拉的**组件实例**（`editVoice` 用其 `$el` 滚动定位） |
| `mapVoice` / `mapName` / `mapModel` | `Ref<string>` | 映射表单：音色键（带 `system:` / `custom:` 前缀）/ 显示名 / 合成模型 id |
| `mapOptions` | `ComputedRef<{ value; label; type; voice; model }[]>` | 映射候选的**扁平**列表（label 仍带 `[系统]` / `[克隆]` 前缀），供查找与分组共用 |
| `mapGroups` | `ComputedRef<HfSelectGroup[]>` | `mapOptions` 按类型分两组（「系统音色（内置）」/「自定义音色（我的克隆）」），**空组被过滤**（与 `voiceGroups` 同规则） |

**函数**：`toAsciiName(raw)`；`genAsciiName(raw)`；`applyInputMode(m)`（`urlMode = /^qwen-audio-.*-tts/i.test(String(m || ''))`）；`requireCfg()`（卡内私有，非 helpers 的同名导出）；`onPick()`；`onCreate()`；`loadAll(silent)`；`syncMapForm()`；`editVoice(key)`；`onSaveMap()`；`onClearMap()`；`onMounted`。

**ASCII 名字生成规则**（云端 `voice` 参数必须是 1~16 位 ASCII，中文名只作为本地显示名）：

| 函数 | 规则 |
| --- | --- |
| `toAsciiName(raw)` | `String(raw \|\| '').trim().replace(/[^A-Za-z0-9_]/g, '')` —— 只保留数字 / 字母 / 下划线，中文与其它符号全部剔除 |
| `genAsciiName(raw)` | 先 `toAsciiName`；结果为空则用 `'myvoice' + Date.now().toString().slice(-8)`（时间戳后 8 位）兜底；长度超过 16 位则截断到前 16 位 |

中文「显示名称」通过成功后的 `saveProfile({ name })` 落到本机映射，**不参与云端命名**；同一个中文名多次创建会再次生成不同的 ASCII 名（时间戳兜底）。

**创建音色两条路径**（`onCreate`）：

共同前置：`requireCfg()`（`getConfig()` 异常或 `!c.ok` 或 `!c.apiKey` → 状态「尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写」（`hf-error`）+ `goPage('settings')` + 返回）；显示名称 `vcName.trim()` 为空 →「请填写显示名称」；随后 `targetModel = vcModel.value`，并再调一次 `applyInputMode(targetModel)` 重算模式。

| 模式 | 判定 | 额外校验 | 状态文案 | 调用 |
| --- | --- | --- | --- | --- |
| URL 模式 | `urlMode === true`（模型 id 匹配 `/^qwen-audio-.*-tts/i`，即 Qwen-Audio-TTS 系） | `vcUrl.trim()` 为空 →「请填写可公开访问的音频文件地址（URL）」 | 「正在使用音频 URL 创建音色（约几秒）…」 | `voiceTools.create(u, genAsciiName(name), targetModel)` |
| 本地文件模式 | `urlMode === false`（`qwen3-tts-vc-*` 系） | `audioPath` 为空 →「请先选择音频文件」 | 「正在上传音频并创建音色（约几秒）…」 | `voiceTools.create(audioPath, genAsciiName(name), targetModel)` |

两条路径的**成功分支完全一致**：`saveProfile({ key: 'custom:' + res.voice, name, voice: res.voice, targetModel, type: 'custom' })` 绑定中文名与模型 → 状态「音色创建成功，已绑定中文名「N」与模型「M」」（`res.fallbackMode` 为真时追加「（降级模式：<`res.fallbackReason`>）」）→ `loadAll(true)` 静默刷新列表。失败分支：`status = res?.message || '创建失败'`、`statusClass = 'hf-error'`。

**「我的音色」列表合并规则**（`voiceList`）：先遍历 `sysVoices`（`key = 'system:' + v.voice`，`name = prof.name || v.desc`，`targetModel = prof.targetModel || v.model || ''`，`type: 'system'`，`extra: '系统音色'`），再遍历 `cloudVoices`（`key = 'custom:' + v.voice`，`name = prof.name || v.voice`，`targetModel = prof.targetModel || v.target_model || ''`，`type: 'custom'`，`extra = v.gmt_create || ''`）——即**有本地映射则显示中文名与绑定模型，否则回落云端默认**。

**`loadAll(silent)`**：`silent === false`（用户点「刷新音色列表」）先写 `listStatus = '拉取音色与映射…'`（类清空）；`Promise.all` 并发拉 `listSystemVoices()` / `list()` / `getProfiles()`（各自 `.catch` 成 `{ ok: false }` 安全值），三元组结果分别写入 `sysVoices` / `cloudVoices` / `profiles`；若 `mapOptions` 非空且 `mapVoice` 为空则选中首项；随后 `syncMapForm()`；结束统一写 `listStatus = '系统音色 N 个 · 克隆音色 M 个'`（`hf-ok`）。

**映射保存 / 解除流程**：

1. `syncMapForm()`：`prof = profiles[mapVoice]`、`opt = mapOptions.find((o) => o.value === mapVoice)`；`mapName = prof ? prof.name : ''`（未保存过映射则清空，靠 placeholder 提示默认值）；`mapModel = prof ? prof.targetModel : (opt ? opt.model : '')`（未映射时预填该音色的默认合成模型）。
2. `onSaveMap()`：`mapVoice` 为空 →「请先选择要管理的音色」；`mapOptions` 找不到对应项则**静默返回**；`name = mapName.trim()`，为空时以 `name: undefined` 提交（= 不设本地显示名、回落默认）；`voiceTools.saveProfile({ key, name, voice, targetModel, type: 'system' | 'custom' })` 成功后用 `res.profiles || {}` **整体覆盖**本地 `profiles`，状态「映射已保存」（有名字时追加「：<名字>」）；失败显示 `res.message || '保存失败'`（`hf-error`）。
3. `onClearMap()`：`mapVoice` 为空 →「请先选择要解除映射的音色」；`voiceTools.deleteProfile(key)` 成功后同样整体覆盖 `profiles`，状态「已解除该音色的本地映射（云端克隆音色本身未删除）」。
4. `editVoice(key)`（点「我的音色」列表里的音色 ID 按钮）：`mapVoice.value = key` → `syncMapForm()` → 取 `(mapVoiceEl.value as { $el?: HTMLElement } | null)?.$el` 并 `scrollIntoView({ behavior: 'smooth', block: 'center' })`，把映射卡的下拉滚到视口中央（HfSelect 是**单根元素组件**，模板 ref 拿到的是组件实例、`$el` 即根 DOM）。

**`onMounted`**：`Promise.all([getConfig().catch(() => null), listModels().catch(() => ({ ok: false, models: [] }))])` → `models = mm.models || []`；`cfg = cc && cc.ok ? cc : { targetModel: 'qwen-audio-3.0-tts-flash' }`；`vcModel = cfg.targetModel || 'qwen-audio-3.0-tts-flash'`、`mapModel = cfg.targetModel || ''`；`applyInputMode(vcModel)` 决定初始 `urlMode`；最后 `loadAll(true)` 静默拉列表与映射。

**调用的 preload**：`voiceTools.getConfig()`、`voiceTools.listModels()`、`voiceTools.pickAudio()`、`voiceTools.create(audioPathOrUrl, preferredName, targetModel)`、`voiceTools.saveProfile({ key, name, voice, targetModel, type })`、`voiceTools.deleteProfile(key)`、`voiceTools.listSystemVoices()`、`voiceTools.list()`、`voiceTools.getProfiles()`；另有 `goPage('settings')`（未配置 Key 时）。

**与 helpers 的分工**：本卡不导入 `./helpers`，因此**不使用** `voiceGroups` / `modelTag` / `cfgSaveDir` / `ttsResultShown`；它的音色候选与合成卡、对齐卡的 `voiceGroups` 是两套独立数据（本卡展示系统音色的完整描述 + 本地映射并支持改名/改模型，`voiceGroups` 只服务于合成选择）。组件的 `requireCfg` 与 helpers 的同名导出**互不相关**：本卡版本只校验 `apiKey`，不写 `modelTag` / `cfgSaveDir`。

## 6. TextTtsPage/helpers.ts（共享助手）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VoiceOption` | `interface` | `value: string`（音色 id；**字段名刻意与 `HfSelectOption` 对齐**，直接绑 `:groups` 即可）、`label: string`（已拼好的展示文案）、`model: string`（绑定模型，可能 `''`） |
| `VoiceOptionGroup` | `interface` | `label: string`、`options: VoiceOption[]`（结构上即 `HfSelect` 的 `HfSelectGroup`） |
| `cfgSaveDir` | `Ref<string>`（初值 `''`） | 已持久化的自定义保存目录 |
| `voiceGroups` | `Ref<VoiceOptionGroup[]>`（初值 `[]`） | 音色下拉分组数据，合成卡与对齐卡共用；两卡把它**原样**交给 `HfSelect`（选项的 `value` / `label` 键已满足该组件契约） |
| `modelTag` | `Ref<string>`（初值 `'qwen-audio-3.0-tts-flash'`） | 未绑定模型音色时的兜底模型名，`requireCfg` 用配置 `targetModel` 覆盖 |
| `ttsResultShown` | `Ref<boolean>`（初值 `false`） | 合成结果卡可见标记，由 `TextTtsPage/index.vue` 复位 |
| `voiceTabRequest` | `Ref<boolean>`（初值 `false`） | 「管理音色」Tab 信号：由 `SynthSection.onManageVoice()` 置位、`TextTtsPage/index.vue` 消费后立即复位；**用布尔而非计数器**（复位 `true → false` 不会再触发 `watch`，计数器复位 `1 → 0` 会二次触发） |
| `setCfgSaveDir` | `(v: string) => void` | 写 `cfgSaveDir.value` |
| `requestVoiceTab` | `() => void` | `voiceTabRequest.value = true` |
| `requireCfg` | `async (onError) => Promise<{ ok; apiKey?; targetModel?; saveDir? } \| null>` | 配置校验 + 状态同步（见下） |
| `loadVoices` | `async (onStatus) => Promise<void>` | 统一音色加载入口（主路径 + 回退） |
| `voiceModelOf` | `(voiceId: string) => string` | 双重 `for` + `options.find`，命中返回 `o.model`（可能 `''`），未命中返回 `''` |
| `firstVoiceId` | `() => string` | 取第一个 `options[0].value` 非空的分组的该 id，全空返回 `''`（与原 `sel.selectedIndex = 0` 语义一致） |
| `loadVoicesFallback` | 非导出 `async (onStatus) => Promise<void>` | `listAll` 不可用/无数据时的旧组装路径，仅模块内被 `loadVoices` 调用 |

- **`requireCfg` 细节**：`await voiceTools.getConfig().catch(() => null)`（调用异常按"无配置"处理）；`!c || !c.ok || !c.apiKey` 时 `onError('尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error')` + `goPage('settings')` + 返回 `null`；正常时改写 `modelTag.value = c.targetModel || 'qwen-audio-3.0-tts-flash'`、`cfgSaveDir.value = String(c.saveDir || '').trim()`，并直接返回配置对象（调用方判空即可）。
- **`loadVoices` 主路径**：先 `onStatus('加载音色列表…', '')`；`voiceTools.listAll()` 取 `all.ok && Array.isArray(all.voices)` 的 `items`，为空转 `loadVoicesFallback` 后返回；否则遍历构造 `VoiceOption`（`value: it.voiceId || ''`、`model: it.model || ''`），`it.type === 'custom'` → `label = it.name + '（' + (it.model || '') + '）'` 归自定义组，否则 → `label = it.name + ' — ' + it.voiceId + '（' + (it.model || '') + '）'` 归系统组；`voiceGroups.value = [系统音色（内置）, 自定义音色（我的克隆）].filter((g) => g.options.length)`（**空组被过滤**）；末尾 `onStatus('已加载：系统音色 N 个，自定义音色 M 个。选中音色将使用其绑定的模型合成。', 'hf-ok')`，无音色为 `'音色列表为空'`。
- **`loadVoicesFallback` 回退路径**：顺序调用 `listSystemVoices()`、`list()`、`getProfiles()`（各自 `.catch` 成 `{ ok: false, ... }` 安全值）；系统音色 key `'system:' + v.voice`，label 为 `pName(...) + ' — ' + v.voice + '（' + pModel(..., v.model || '') + '）'`；自定义音色 key `'custom:' + v.voice`，模型取 `v.target_model || ''`；**即使某组为空也保留分组**并插入占位项（`value: ''`，系统组「（系统音色加载失败）」、自定义组 `res.message || '拉取自定义音色失败'`）；状态文案与主路径一致。
- **`voiceTabRequest` / `requestVoiceTab` 语义**（源码注释要点）：同页点击「管理音色」走 `watch`，只切 Tab、不 `goPage` 换页（换页会重挂载整个配音页、清空合成文本等已填内容）；跨页点击先置位再 `goPage('text-tts')`，本页重挂载时在 `onMounted` 里消费一次。

## 7. 依赖与协作

| 文件 | import 清单 |
| --- | --- |
| `TextTtsPage/index.vue` | `vue`：`onMounted`、`ref`、`watch`；`./helpers`：`ttsResultShown`、`voiceTabRequest`；`@renderer/components/StepBar.vue`；`./SynthSection.vue`；`./AlignSection.vue`；`./VoiceSection.vue` |
| `TextTtsPage/SynthSection.vue` | `vue`：`computed`、`onMounted`、`ref`；`@renderer/composables/useAppStore`：`activeMenu`、`appState`、`refreshProject`；`@renderer/composables/useToast`：`toast`；`@renderer/utils/rate`：`applyRate`、`stepRate`；`@renderer/pages`：`goPage`；`@renderer/components/HfSelect.vue`：默认导出 + 类型 `HfSelectGroup`、`HfSelectOption`；`./helpers`：10 个成员 |
| `TextTtsPage/AlignSection.vue` | `vue`：`computed`、`onMounted`、`ref`；`@renderer/composables/useAppStore`：`appState`、`refreshProject`；`@renderer/composables/useToast`：`toast`；`@renderer/utils/escape`：`escTxt`；`@renderer/utils/time`：`fmtTime`、`fmtTimeMs`；`@renderer/components/HfSelect.vue`：默认导出 + 类型 `HfSelectGroup`；`./helpers`：5 个成员 |
| `TextTtsPage/VoiceSection.vue` | `vue`：`computed`、`onMounted`、`ref`；`@renderer/pages`：`goPage`；`@renderer/utils/escape`：`escTxt`；`@renderer/components/HfSelect.vue`：默认导出 + 类型 `HfSelectGroup`（**不导入 `./helpers`**） |
| `TextTtsPage/helpers.ts` | `vue`：`ref`；`@renderer/pages`：`goPage`（用于跳 `'settings'`） |

- **`appState` 用到的字段**：`myProjects`、`currentName`、`project.subtitle` / `project.subtitleCount` / `project.content.scenes`；`SynthSection` 另读 `activeMenu`（判断是否已在配音页，决定要不要 `goPage`）。`VoiceSection` 不读 `appState`（只依赖 `goPage` 与 `voiceTools`）。
- **上游**：`pages/index.ts` 的页面注册表（key `'text-tts'`）与 `@renderer/components/StepBar.vue`（`PageKey` 序列含该页，内部 `goPage(props.page)` 刷新当前页；原 `'sound-copy'` 键与「配音」节点的 `isPage('sound-copy')` 判定均已删除）；`StepBar` 的 props 为 `defineProps<{ page: PageKey }>()`。
- **下游（本组使用的 composables / utils / 组件 / 页面）**：`@renderer/composables/useAppStore`、`@renderer/composables/useToast`、`@renderer/utils/rate`、`@renderer/utils/escape`、`@renderer/utils/time`、`pages/index.ts` 的 `goPage`、`@renderer/components/HfSelect.vue`（合成卡 3 个、对齐卡 2 个、音色管理卡组 3 个下拉，见第 7 节末条）；跨页跳转目标只剩 `'settings'`（API Key 设置）与 `'text-tts'` 自身。
- **调用的 preload 方法汇总**：

| 命名空间.方法 | 调用方 | 参数 / 用途 |
| --- | --- | --- |
| `voiceTools.getConfig()` | helpers.`requireCfg`、`VoiceSection`（卡内 `requireCfg` 与 `onMounted`） | 读 `ok` / `apiKey` / `targetModel` / `saveDir` |
| `voiceTools.listAll()` | helpers.`loadVoices` | 主路径，`voices[].type / name / voiceId / model` |
| `voiceTools.listSystemVoices()` / `voiceTools.list()` / `voiceTools.getProfiles()` | helpers.`loadVoicesFallback`、`VoiceSection.loadAll` | 回退路径 / 音色管理列表与映射（`voices[].voice / desc / model / target_model`，`profiles` 以 `system:` / `custom:` 前缀为键） |
| `voiceTools.listModels()` | `VoiceSection.onMounted` | 模型下拉数据（`models[].id / label / role / input / isDefault`） |
| `voiceTools.pickAudio()` | `VoiceSection.onPick` | 无参，选本地音频文件（返回路径字符串或 `null`） |
| `voiceTools.create(audioPath, preferredName, targetModel)` | `VoiceSection.onCreate` | 创建克隆音色：URL 模式传音频 URL、本地文件模式传本地路径；`preferredName` 为 `genAsciiName` 生成的 ASCII 名 |
| `voiceTools.saveProfile({ key, name, voice, targetModel, type })` | `VoiceSection.onCreate`（成功后自动）/ `VoiceSection.onSaveMap` | 写本机映射（中文显示名 + 合成模型） |
| `voiceTools.deleteProfile(key)` | `VoiceSection.onClearMap` | 解除本机映射（不删除云端克隆音色） |
| `voiceTools.pickDir()` | `SynthSection` | 无参，选自定义保存目录 |
| `voiceTools.saveConfig({ saveDir })` | `SynthSection` | 持久化（`r.dir`）或清除（`''`）自定义目录 |
| `voiceTools.getSaveDir({ projectName, saveDir, defaultOut })` | `SynthSection` | 解析最终保存目录 |
| `voiceTools.synth(t, v, projectName, saveDir, voiceModel, audioName, isOutput)` | `SynthSection` | 7 个位置参数，合成并保存 |
| `voiceTools.listGenerated()` | `SynthSection` | 拉取已生成音频 `res.items` |
| `voiceTools.onAlignProgress(cb)` | `AlignSection` | 订阅进度（`stage` / `percent` / `message`），preload 单订阅 |
| `voiceTools.synthAligned({ projectName, subtitleText, voice, voiceModel, mode, gapSec })` | `AlignSection` | 提交逐句对齐合成 |
| `voiceTools.cancelAlign()` | `AlignSection` | 取消任务 |
| `projectTools.openFolderOf(dirOrFile)` | `SynthSection` / `AlignSection` | 打开保存目录 / 结果目录 / 音频所在目录 |
| `projectTools.setAudio(name, audioPath)` | `SynthSection` / `AlignSection` | 设为当前项目背景音频 |
| `projectTools.load(name)` | `AlignSection` | 读其它项目字幕（`res.subtitle`） |
| `projectTools.saveSubtitle(name, subtitle, title)` | `AlignSection` | 写回对齐后的字幕 |

- **路由跳转**：`goPage('settings')`（API Key 设置，helpers 未配置时、`SynthSection`/`AlignSection`/`VoiceSection` 的按钮与卡内校验都会跳）与 `goPage('text-tts')`（`SynthSection.onManageVoice` 跨页请求切到本页第三个 Tab）；原 `goPage('sound-copy')` 已随独立页删除全部移除。
- **桥接层对应关系**：以上方法都由 `src/preload/index.ts` 的 `voiceTools` / `projectTools` 命名空间暴露；渲染层 `voiceTools.saveConfig({ saveDir })` 对应 preload 的 `saveConfig(voiceTTS: Partial<VoiceTTSConfig>)`（内部再包成 `{ voiceTTS }` 走 `IPC.Voice.SaveConfig`），`synth` 的 7 个位置参数在 preload 内转为 `{ text, voice, projectName, saveDir, targetModel, audioName, defaultOut }` 对象；`create` 在 preload 内包成 `{ audioPath, preferredName, targetModel }`（渲染层 URL 模式下该字段承载的是音频 URL）；`cancelAlign` 用 `ipcRenderer.send`，其余为 `invoke`；`onAlignProgress` 在 preload 内维护单例回调（重复注册仅替换、首次注册才 `ipcRenderer.on`）。
- **HfSelect 依赖**：本页三张卡的 8 个下拉全部由 `@renderer/components/HfSelect.vue` 承担（合成卡：音色 / 保存到 / 已生成音频；对齐卡：字幕来源 / 音色；音色管理：目标模型 / 映射音色 / 合成模型）；`@change` 回调收到的是**新值字符串**而非 DOM Event，且只在用户选中不同选项时触发。
- **helpers 命名导出全清单（13 个）**：`VoiceOption`、`VoiceOptionGroup`、`cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`、`voiceTabRequest`、`setCfgSaveDir`、`requestVoiceTab`、`requireCfg`、`loadVoices`、`voiceModelOf`、`firstVoiceId`；`loadVoicesFallback` 不导出。

## 8. 注意事项与实现要点

1. **`v-show` 而非 `v-if`**：三卡始终挂载、切 Tab 不销毁重建，因此进入页面时三卡的配置/数据加载都会执行，且切 Tab 保留卡内状态（合成文本、已选音色、创建表单等）——有意为之，切回不必重新填表。
2. **共享状态是模块级单例**：`voiceGroups`、`cfgSaveDir`、`modelTag` 跨页面切换保留，直到下次 `requireCfg` / `loadVoices` 覆盖；只有 `ttsResultShown` 被 `TextTtsPage/index.vue` 在 `onMounted` 显式复位，所以「合成结果」卡仅在本次停留页面期间可见。`SynthSection` 内部置 `true` 后不会自行置回 `false`。
3. **「管理音色」不再换页**：`onManageVoice()` 先 `requestVoiceTab()` 置信号，**仅当 `activeMenu.value !== 'text-tts'`** 时才 `void goPage('text-tts')`；同页点击只切 Tab，避免重挂载清空已填的合成文本。信号是布尔而非计数器：`watch` 只认 `false → true`，`goVoiceTab()` 内部的复位不会二次触发。
4. **HfSelect 取代原生 `<select>`**：`@change` 直接给**新值字符串**（`(value: string) => void`，不是 DOM Event），且 `pick()` 在选中项与当前值相同时**提前返回、不发 `change`**；程序化改值（如 `onSaveToChange` 里取消选目录后 `saveTo.value = lastSaveTo.value`）只走 `update:modelValue`、不触发 `@change`——取消回退不会递归。之所以自绘：原生 `<option>` 弹层由浏览器绘制，行高/间距/选中态无法用 CSS 控制，深色主题下选项挤在一起、选中态看不出。
5. **下拉数据的形状契约**：`HfSelect` 的 `groups` 契约为 `{ label: string; options: { value: string; label: string }[] }[]`，取值/比较/回传**只认 `value`**（`current`、`displayText`、`pick`、`activeIndex` 播种全部按 `o.value === modelValue` 判断）。因此本页所有下拉数据都按该契约构造：`voiceGroups`（`VoiceOption` 的键即 `value` / `label` / `model`，与 `HfSelectOption` 结构兼容）、`saveToGroups`（保存位置）、`genSelectGroups`（已生成音频，`value` 为全局下标字符串）、`subSrcGroups`（字幕来源）、`mapGroups` / `modelGroups` / `cloneModelGroups`（音色管理）。**改 `VoiceOption` 字段名时必须同步 `value`**：HfSelect 不会读 `voiceId` 之类的别名，否则触发器恒显示 `placeholder`、点选回传 `undefined`。
6. **空列表不再有占位 option**：已生成音频列表为空时，`genSelectGroups` 返回空数组、由 HfSelect 的 `empty-text="（暂无已生成音频）"` 展示提示；触发器文案在无匹配项时回落 `placeholder`（默认「请选择…」）。
7. **模型跟随音色**：合成模型取 `voiceModelOf(voiceId)`，模板展示的 `modelTag` 只是未绑定模型音色时的兜底值（默认 `qwen-audio-3.0-tts-flash`），二者不要混淆；`voiceModelOf` 返回 `''` 是"该音色没有绑定模型"而非错误，由主进程回落全局默认。
8. **`synth` 是位置参数**：`(text, voiceId, projectName, saveDir, model, audioName, isOutput)`——项目模式传项目名、自定义模式传目录，二者互斥另一个传空串；`out` 模式靠布尔 `isOutput` 标识；`audioName` 传 `audioName.value.trim()`，为空时由主进程按"时间_前五个字_音色id"自动命名。`onSynth` 中 `requireCfg` 的返回值仅用于判空。
9. **`fillGenAudios(true)` 静默**：合成成功后自动刷新列表，失败不覆盖合成的成功提示；只有用户手动点「刷新」（`false`）才报错。
10. **禁用态只跟「选中的已生成音频是否存在」走**：`updateGenSel` 找不到条目就把 `genSetDisabled` / `genOpenDisabled` 置 `true`，命中则置 `false`；`onGenSetBg` 内还有一次 `if (!it)` 拦截（双保险），`AlignSection` 的 `startAlign` / `writeAlign` 同样只做配置与前置条件校验，不做项目形态判定。
11. **`genSelIdx` 是字符串下标**：HfSelect option 的 `value` 为 `String(i)`（全局数组下标），读取统一 `Number(genSelIdx.value)`；`updateGenSel` 找不到条目会清空信息并重新禁用按钮。
12. **两个 `<audio>` 元素各自独立**：结果卡与列表卡分别是 `resultAudioEl` / `genAudioEl`，各自维护语速值；语速步长固定 0.05，范围 0.5~2.0，非法或空值回退 1x，只改播放速率不改磁盘文件。
13. **`file:///` URL 拼接**：四处统一用 `'file:///' + encodeURI(String(path).replace(/\\/g, '/'))` 处理 Windows 反斜杠；路径为空时结果卡也不显示音频。
14. **`onAlignProgress` 是单订阅**：preload 只保留一个回调，重复注册等于替换，不会叠加；切页后旧页回调不再触发。
15. **对齐取消是「当前句完成后停止」**：主进程返回 `{ ok: false, canceled: true, message: '已取消（已完成 i/N 句）' }`，本卡走 `res.canceled` 分支、不显示为错误；`onCancel` 仅设状态为「正在取消（当前句完成后停止）…」。
16. **`assemble` 用不确定态**，`done` / `error` 由 `showAlignBar` 固定填满 100%。
17. **「句间停顿（秒）」是兜底值而非固定值**：仅当字幕原有间隔放不下本句音频、或字幕无时间线（估时）时生效，且输入行只在 `audio-driven` 模式显示。
18. **写入项目的结束时间来自实测音频**（该句音频起点 + 实测时长），不是字幕原结束时间、也不是下一句起始时间，以保证与成片音轨一致；写回是"先字幕后音频"的两步操作，失败即中止且不回滚。
19. **单句试听依赖临时目录**：`segPath` 指向对齐任务的 `seg` 子目录，任务目录被清理后播放失败会 toast「该句试听文件已失效（临时目录被清理），可试听整轨」。
20. **回调签名统一**：`(text: string, kind: string) => void`，两卡的 `setStatus` 恰好同签名可直接传入 `requireCfg` / `loadVoices`；`kind` 约定为 `''`（进行中）、`'hf-ok'`（成功）、`'hf-error'`（失败）。`VoiceSection` 不使用该签名（自带 `requireCfg` 与三个独立状态对）。
21. **回退路径不抛异常**：helpers 内所有 IPC 都带 `.catch(() => ...)` 安全值，音色加载失败不中断页面，仅在下拉里出现 `voiceId === ''` 的占位项；`loadVoices` 主路径过滤空组、`loadVoicesFallback` 始终保留两组，因此回退时下拉可能出现占位项。`VoiceSection` 的三个 `Promise.all` 成员同样各自 `.catch` 成 `{ ok: false }`，失败时列表为空、状态仍写成功文案（`系统音色 0 个 · 克隆音色 0 个`）。
22. **分组顺序固定**：系统音色（内置）在前、自定义音色（我的克隆）在后；`firstVoiceId()` 只检查每组第一个选项，若它 `voiceId` 为空才跳到下一组。`mapGroups` 同序且过滤空组。
23. **状态文案**：合成卡 / 对齐卡共用 `'已加载：系统音色 N 个，自定义音色 M 个。选中音色将使用其绑定的模型合成。'`；音色管理卡用的是另一套 `'系统音色 N 个 · 克隆音色 M 个'`，改动需注意各自实现。
24. **`activeTab` 为三值字符串字面量联合**（`'synth' | 'align' | 'voice'`），Tab 按钮的 `data-tab` 仅作样式/调试锚点；新增 Tab 必须同时处理类型联合、`v-show` 条件与（若需外部触发）`voiceTabRequest` 的消费分支。
25. **`onLoadNarration` 空旁白**处理：报错文案为「当前项目无内容脚本（或场景无旁白），请先到「内容脚本」页编写」，成功则提示「已载入 N 段旁白（每场景一段、空行分隔），可继续手动编辑」。
26. **`onGenPlay` 空源守卫**：`genAudioEl` 或 `genAudioSrc` 为空时 toast「请先选择已生成音频」，不改变试听行显隐。
27. **云端音色名必须是 ASCII**：创建时提交的是 `genAsciiName(vcName)`（1~16 位、仅 `[A-Za-z0-9_]`，中文名被剔空时用 `myvoice` + 时间戳后 8 位兜底），中文名只通过 `saveProfile` 作为本地显示名；因此「显示名称」同名多次创建会得到不同的云端 `voice` id。
28. **URL 模式由模型 id 决定**：`applyInputMode` 用 `/^qwen-audio-.*-tts/i` 判定，切换「目标模型」（`@change`）与点击「创建音色」（`onCreate` 内重算）都会刷新 `urlMode`，从而在「选择音频文件」与「音频 URL」两种输入形态间切换；`vcModel` 初值取 `getConfig().targetModel`（失败回落 `qwen-audio-3.0-tts-flash`）。
29. **映射是本地概念**：`saveProfile` / `deleteProfile` 只改本机 `settings.json`（`profiles` 由主进程整体返回并**整体覆盖**本地缓存），`onClearMap` 不删除云端克隆音色（提示文案已说明）；`syncMapForm` 对未映射项清空显示名、预填默认模型。
30. **三张卡都没有组件级 `<style>`**：`VoiceSection` 的「我的音色」表用行内 grid 样式（`1.5fr 1.2fr 1fr`）；所有下拉的视觉（含弹层）由 `HfSelect` 自己负责（`.hf-sel*` 类前缀），页面不再依赖 `main.css` 里的 `.hf-select` / `.hgen-select`（已删除）。
