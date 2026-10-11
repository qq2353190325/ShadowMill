# src/renderer/src/pages/TextTtsPage/（页面）

> 「文字生音频」页外壳 + 合成卡 / 逐句对齐卡 + 共享助手

- **覆盖文件**：

| 文件（相对 `src/renderer/src/pages/`） | 行数 | 作用 |
| --- | --- | --- |
| `TextTtsPage/index.vue` | 28 | 页面外壳：`StepBar` + 两个 Tab，`v-show` 挂载两张卡 |
| `TextTtsPage/SynthSection.vue` | 357 | 「文字生音频（TTS 合成）」卡：音色/模型、保存位置三选一、合成、结果与已生成音频复用 |
| `TextTtsPage/AlignSection.vue` | 291 | 「字幕配音（逐句对齐）」卡：逐句 TTS + 音频/时间轴双向对齐，结果写回项目 |
| `TextTtsPage/helpers.ts` | 116 | 模块级共享助手：配置校验、音色加载、模型解析、共享 `ref` |

- **类型**：页面组件（Vue 3 `<script setup lang="ts">` SFC）+ 页面子组件（2 个 SFC）+ 模块级 TS 助手（`<script setup>` 之外的原生模块，无组件）
- **对外导出**：
  - 页面组件默认导出，**无 props、无 emit、无路由参数**；`SynthSection` / `AlignSection` 默认导出、均为无 props 无 emit（父页只用 `v-show` 控制显隐，两卡**常驻挂载**）。
  - `helpers.ts` 共 11 个命名导出：接口 `VoiceOption`、`VoiceOptionGroup`；`ref` 常量 `cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`；函数 `setCfgSaveDir`、`requireCfg`、`loadVoices`、`voiceModelOf`、`firstVoiceId`（另有 1 个非导出内部函数 `loadVoicesFallback`）。

## 1. 结构总览

- **挂载关系**：`pages/index.ts` 页面注册表把 `TextTtsPage/index.vue` 登记为 `'text-tts'` 页（无 vue-router，`goPage` 切换 `<component :is>`）；`StepBar :page="'text-tts'"` 负责步骤高亮与「重进本页」刷新。
- **Tab 关系**：`activeTab: Ref<'synth' | 'align'>`（初值 `'synth'`）驱动两个 `button.hf-tab`（`data-tab="synth"` / `"align"`）与两卡的 `v-show`；**用 `v-show` 而非 `v-if`，两卡在页面挂载时都会被创建且从不销毁**，切 Tab 不重置卡内状态。
- **helpers 复用**：

| 使用方 | 导入成员 |
| --- | --- |
| `TextTtsPage/index.vue` | `ttsResultShown`（`onMounted` 中复位） |
| `TextTtsPage/SynthSection.vue` | 全部 9 个：`cfgSaveDir`、`firstVoiceId`、`loadVoices`、`modelTag`、`requireCfg`、`setCfgSaveDir`、`ttsResultShown`、`voiceGroups`、`voiceModelOf` |
| `TextTtsPage/AlignSection.vue` | 5 个：`firstVoiceId`、`loadVoices`、`requireCfg`、`voiceGroups`、`voiceModelOf`（不用 `cfgSaveDir` / `modelTag` / `ttsResultShown` / `setCfgSaveDir`） |

- **共享单例**：`helpers.ts` 的 4 个 `ref` 定义在模块作用域，跨页面切换、跨组件共享同一份实例（不随卸载销毁）；`voiceGroups` 由两卡共用，后一次加载的结果对两卡同时生效。

## 2. TextTtsPage/index.vue（外壳）

- **模板结构**：`div > StepBar(:page="'text-tts'")` → `div.hf-tabs`（`button.hf-tab` × 2，`:class="{ active: activeTab === 'synth' | 'align' }"`、`@click` 直接赋值）→ `<SynthSection v-show="activeTab === 'synth'" />` → `<AlignSection v-show="activeTab === 'align'" />`。Tab 文案：「文字生音频（TTS 合成）」「字幕配音（逐句对齐）」。
- **状态**：仅 `activeTab`。
- **生命周期**：`onMounted(() => { ttsResultShown.value = false })`——每次进入本页复位合成结果卡标记；子组件各自的 `onMounted` 亦在此刻执行（`SynthSection.vue` 第 346 行、`AlignSection.vue` 第 270 行），两卡都会走 `requireCfg` → `loadVoices` → `firstVoiceId`，写入同一份模块状态。
- **import**：`vue` 的 `onMounted` / `ref`；`./helpers` 的 `ttsResultShown`；`@renderer/components/StepBar.vue`；`./SynthSection.vue`；`./AlignSection.vue`。
- **本文件不直接调用任何 IPC**，`window.*` 调用全部发生在两卡与 `helpers.ts` 中；`ttsResultShown` 的消费方只有 `SynthSection`（对齐结果走自身的 `alignResult`）。
- **流程**：页面被注册表挂载 → `activeTab` 初始化为 `'synth'` → 模板先渲染 `StepBar`、再渲染 Tab 按钮组、最后创建两卡（`v-show`，两卡都会挂载）→ 父页 `onMounted` 复位 `ttsResultShown` → 两卡各自 `onMounted` 开始拉配置与音色 → 点 Tab 只改 `activeTab`，不改动组件实例 → 点 `StepBar` 重进本页时 `goPage(props.page)` 重建页面组件，流程从挂载重新开始（`ttsResultShown` 再次被复位）。
- **样式**：模板只用全局设计系统类名（`.hf-tabs` / `.hf-tab` / `.hf-tab.active`），无组件级 `<style>`；卡片风格与 CSS 变量以 `src/renderer/src/assets/main.css` 为准。

## 3. TextTtsPage/SynthSection.vue（文字生音频卡）

**模板区块**（三个 `div.card.hgen-panel`）：

| 区块 | 关键绑定 / 事件 |
| --- | --- |
| 合成主卡 | 标题「文字生音频（TTS 合成）」+ `.hgen-tip`（说明含兜底模型 `{{ modelTag }}`）；`textarea.hgen-subtitle` `v-model="text"`（高 150px，`placeholder="输入要合成语音的文字…"`）；「载入脚本旁白」`@click="onLoadNarration"` |
| ↳ 音色行 | `select v-model="voiceId"`（`optgroup v-for="g in voiceGroups"` / `option :value="o.voiceId"`）+「刷新」`onRefreshVoice` +「管理音色」`goPage('sound-copy')` |
| ↳ 保存到行 | `select v-model="saveTo" @change="onSaveToChange"`（选项 `proj:<p.name>`「项目「标题或名」（audio/）」、`custom`「自定义目录…（已选/未选择）」、`out`「音频输出目录（不写入项目）」）+「打开目录」`onOpenFolder`；自定义目录行 `v-show="parseSaveTo().kind === 'custom'"`（展示 `cfgSaveDir` +「恢复默认」`onClearCustom`） |
| ↳ 名字与提交 | `input.hgen-input v-model="audioName"`（选填，留空自动命名「时间_前五个字_音色id」）；「合成并保存」`:disabled="synthBusy"` `@click="onSynth"`；`.hf-status :class="statusClass"`；「API Key 设置」`goPage('settings')` |
| 合成结果卡 | `v-show="ttsResultShown"`（共享状态）；`resultPath ? '保存路径：'+resultPath : ''`、「打开目录」`:disabled="!resultPath"`；`audio ref="resultAudioEl" :src="resultSrc" controls`（高 54px）；语速 `−`/`+` 按钮（`resultRateStep(∓0.05)`）+ `input ref="resultRateEl" :value="resultRateValue" @input="onResultRateInput"` |
| 已生成音频卡 | 无条件显示；`select v-model="genSelIdx" @change="updateGenSel"`（`optgroup v-for="g in genGroups"`、`option :value="String(pair.i)"`，空列表展示「（暂无已生成音频）」）+「刷新」`fillGenAudios(false)` +「试听」`onGenPlay`；`{{ genInfo }}`、「打开目录」`:disabled="genOpenDisabled"`、「设为当前项目背景音频」`:disabled="genSetDisabled"`；试听行 `v-show="genPlayRowVisible"`（`audio ref="genAudioEl"` + 语速 `genRateEl` / `genRateValue` / `onGenRateInput` / `genRateStep`） |

**状态与常量**：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `status` / `statusClass` | `Ref<string>` | 状态栏文案与样式类（`''` / `'hf-ok'` / `'hf-error'`） |
| `voiceId` | `Ref<string>` | 当前选中音色 id |
| `text` | `Ref<string>` | 合成文本 |
| `audioName` | `Ref<string>` | 自定义音频名字（选填） |
| `saveTo` / `lastSaveTo` | `Ref<string>` | 保存位置选择值（`proj:<name>` / `custom` / `out`）与上一次有效选择（取消选目录时回退用） |
| `synthBusy` | `Ref<boolean>` | 合成中标记，控制主按钮 `disabled` |
| `resultPath` / `resultSrc` | `Ref<string>` | 最近一次合成的保存路径与 `file:///` URL |
| `resultAudioEl` / `resultRateEl` | `Ref<HTMLAudioElement \| null>` / `Ref<HTMLInputElement \| null>` | 结果试听 `<audio>` 与语速输入框元素 |
| `resultRateValue` | `Ref<string>` | 结果语速显示值，初值 `'1'` |
| `genAudios` | `Ref<GenAudioItem[]>` | 已生成音频列表（`listGenerated` 的 `items`） |
| `genSelIdx` / `genInfo` | `Ref<string>` | 下拉选中项（字符串下标）与选中项完整路径 |
| `genSetDisabled` / `genOpenDisabled` | `Ref<boolean>` | 「设为背景音频」/「打开目录」禁用态，初值均 `true` |
| `genPlayRowVisible` | `Ref<boolean>` | 试听行显隐 |
| `genAudioEl` / `genAudioSrc` / `genRateEl` / `genRateValue` | `Ref` | 列表试听元素、预览 URL、语速输入框与语速值（初值 `'1'`） |
| `genGroups` | `ComputedRef<{ label: string; pairs: { it: GenAudioItem; i: number }[] }[]>` | 按 `it.group` 分组（空值归 `'其他'`），`pairs` 保留全局下标 `i` |
| `GenAudioItem`（局部 `interface`） | `{ path: string; name: string; group: string; size: number; mtime: number }` | 列表项结构 |

**函数**：`setStatus(text, kind)`（同时写 `status` / `statusClass`，作为 `onStatus` / `onError` 双签名回调传入 helpers）；`onRefreshVoice`；`onLoadNarration`（读 `appState.project.content.scenes`，取各 `s.narration.trim()` 过滤空串后以 `'\n\n'` 拼接，无旁白时报错引导去「内容脚本」页）；`parseSaveTo()`（解析为 `{ kind: 'custom' | 'output' | 'project' | 'none'; saveDir?; projectName? }`，`proj:` 前缀用 `v.slice(5)` 取项目名）；`fillSaveTo()`；`onSaveToChange()`；`onClearCustom()`；`onOpenFolder()`；`onSynth()`；`onResultRateInput()` / `resultRateStep(delta)`；`onOpenResultDir()`（无路径 `toast('暂无合成文件可打开')`）；`updateGenSel()`（写 `genInfo` / `genAudioSrc`，按 `appState.isBuiltin` 置两个禁用态，并隐藏试听行；找不到条目则清空信息并重新禁用按钮）；`fillGenAudios(silent)`；`onGenPlay()`；`onGenSetBg()`；`onGenOpenDir()`；`onGenRateInput()` / `genRateStep(delta)`；`onMounted`。

**合成结果与已生成音频细节**：

| 细节 | 实现 |
| --- | --- |
| 结果卡显隐 | 共享 `ttsResultShown`，在 `onSynth` 成功后置 `true`；隐藏依赖父页 `onMounted` 的复位 |
| 结果语速 | `applyRate` / `stepRate` 的返回值写回 `resultRateValue`；`−` / `+` 步长固定 0.05 |
| 已生成列表分组 | `genGroups` 用 `Map` 按 `it.group`（空 → `'其他'`）聚合，`option :key="pair.i"`、`:value="String(pair.i)"` |
| `fillGenAudios(silent)` | `listGenerated()` 失败时仅在 `silent === false` 报错；空列表清空 `genSelIdx` / `genInfo` / `genAudioSrc`、禁用两按钮并隐藏试听行，非空则调 `updateGenSel()` 选中首项 |
| 试听行 | `onGenPlay` 对同一个 `<audio>` 做 play/pause 切换，`play().catch` 提示「音频试听失败（可能文件已被移动）」 |

**关键流程**：

1. **初始化**：`fillSaveTo()` → 异步 `requireCfg(setStatus)`（失败即整体跳过）→ 再 `fillSaveTo()`（配置已刷新 `cfgSaveDir`）→ `loadVoices(setStatus)` → `voiceId = firstVoiceId()` → `fillGenAudios(true)` 静默拉列表。
2. **保存位置三选一**：选 `custom` 且 `cfgSaveDir` 为空才 `pickDir()`；`canceled` / 非 `ok` / 无 `dir` 一律回退 `lastSaveTo`（避免出现"选了自定义但无目录"的空档行）；成功则 `setCfgSaveDir(r.dir)` + `saveConfig({ saveDir })`（保存失败仅提示"目录已选但保存设置失败"）。`fillSaveTo` 默认优先级：已持久化自定义目录 → `custom`；否则有项目 → `proj:<当前项目>`（内置项目或无 `currentName` 时取 `appState.myProjects[0].name`）；无项目 → `out`；算出的值不在选项内也兜底 `out`。
3. **合成**：`requireCfg` → 校验 `text.trim()`（"请输入合成文本"）与 `voiceId`（"请先选择（或创建）音色"）→ `parseSaveTo()` 为 `none` 时报"请选择保存位置"→ `voiceModelOf(v)` 取绑定模型 → `synthBusy = true`，状态「正在按所选音色（模型名或'默认模型'）合成并下载语音…」→ 调 `synth` → 成功时按 `res.savedTo`（`'project'` / `'output'` / 其它）生成"已保存到…"文案，置 `ttsResultShown = true`、`resultPath = res.savePath || ''`、有路径时 `resultSrc = 'file:///' + encodeURI(path.replace(/\\/g, '/'))`，再 `fillGenAudios(true)`；失败显示 `res.message` 或"合成失败"；`finally` 复位 `synthBusy`。
4. **结果试听**：语速输入或 `−`/`+`（步长 0.05）经 `applyRate` / `stepRate` 解析失败回退 1、钳制 0.5~2.0，写回 `el.value` 与 `audio.playbackRate`，返回值同步到 `resultRateValue`——**仅改播放速率，不改磁盘音频**。
5. **已生成音频复用**：`genGroups` 分组展示 → `updateGenSel` 写路径与预览 URL → 「试听」对同一 `<audio>` 做 play/pause 切换（失败提示"可能文件已被移动"）→ 「设为背景音频」内置项目直接拒绝，否则 `setAudio(appState.currentName, it.path)` → `refreshProject()` → `toast('已设为当前项目背景音频：' + res.audioFile)`。

**调用的 preload**：`voiceTools.pickDir()`、`voiceTools.saveConfig({ saveDir })`、`voiceTools.getSaveDir({ projectName, saveDir, defaultOut })`、`voiceTools.synth(...)`、`voiceTools.listGenerated()`；`projectTools.openFolderOf(...)`、`projectTools.setAudio(...)`。

## 4. TextTtsPage/AlignSection.vue（字幕配音逐字对齐卡）

**两种模式**（`alignMode`，默认 `'audio-driven'`）：

- `audio-driven`「重排字幕（音频驱动）」：按实测每句时长重建字幕时间线，首句时间锚点保留，总时长随之变化；句间停顿**优先按字幕原有间隔推算**，放不下时才用「句间停顿（秒）」兜底（该输入行仅此模式显示，`input type="number"` `min=0` `max=10` `step=0.1`，`gap` 默认 `'0.5'`）。
- `timeline-driven`「修正音频（时间轴驱动）」：字幕时间戳不变，把每句配音摆到其字幕时间点（句间补静音）；放不下时轻微加速（≤1.15 倍）或顺延后续句子并同步改字幕。

**模板要点**：`.card.hgen-panel`（`margin-top:16px`）+ `.panel-title`；两条模式说明 `.hgen-tip` 按 `alignMode` `v-show`；字幕来源行 `select v-model="subSrc" @change="syncSubCount"`（选项 `__current__`「当前项目字幕（N 条）」与 `appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)` 的项目字幕）+「刷新」+ `subCountTip`；音色行（`optgroup v-for="g in voiceGroups"`、`option :value="o.voiceId"`）+「刷新」`onRefreshVoice`；`radio` 两项；操作行「开始对齐合成」`:disabled="alignBusy"`、「取消」`v-show="alignBusy"`、「重试」`v-show="!alignBusy && !alignResult"`（后两者均指向 `startAlign` / `onCancel`）；`.whisper-bar-wrap` `v-show="barVisible"`（`.whisper-bar` 的 `indeterminate` 类由 `barIndeterminate` 控制，`.whisper-bar-fill` 类为 `barState`、宽度 `barPercent + '%'`，文案 `barText`）；`.hf-status :class="statusClass"`；结果区 `v-show="alignResult !== null"`（`<audio ref="alignAudioEl" :src="alignAudioSrc" controls>`、「打开目录」`onOpenDir`、「写入当前项目」`writeAlign`、`summary`、`.sub-list` 明细）；明细行 `.align-row`：序号 `d.index + 1`、文本 `escTxt(d.text)`（与 title 同源）、`fmtTime(d.subtitleStart)`、`fmtTime(d.audioStart)`、`Number(d.audioDur).toFixed(1) + 's'`、状态徽标、`d.segPath` 存在时的「试听」`playSeg`；徽标 `.align-badge`：`accelerated` → `加速 x{rate.toFixed(2)}`（warn）、`pushed` → `顺延 +{delta.toFixed(1)}s`（warn）、其余「正常」（ok）；末尾隐藏 `<audio ref="segAudioEl" style="display:none">`。

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

**`startAlign` 流程**：`alignBusy` 为真 → `toast('对齐合成进行中，请稍候')` 返回；`appState.isBuiltin` → `toast('内置示例项目只读，请先切换到自己的项目')` 返回；`requireCfg` 未通过返回；`getAlignSubtitleText()` 失败则 `setStatus(message, 'hf-error')`；`voiceId` 为空提示「请先选择（或创建）音色」；然后置 `alignBusy = true`、`resetAlignUi()`、`hideAlignBar()`、状态「正在提交逐句合成任务…」，再调用 `synthAligned`。结果分支：`res.ok` → 写 `alignResult`、`alignAudioSrc = 'file:///' + encodeURI(audioPath 反斜杠转正斜杠)`、进度条「对齐完成：N 句」（`done`）、状态 `res.message || '对齐完成'`（`hf-ok`）；`res.canceled` → `hideAlignBar()` + 状态与 toast 用 `res.message || '已取消'`（**不算错误**）；其它失败 → 进度条错误文案 + 状态 `hf-error` + toast；`catch` 同样把异常消息写进进度条与状态；`finally` 复位 `alignBusy`。

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

## 5. TextTtsPage/helpers.ts（共享助手）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VoiceOption` | `interface` | `voiceId: string`、`label: string`（已拼好的展示文案）、`model: string`（绑定模型，可能 `''`） |
| `VoiceOptionGroup` | `interface` | `label: string`、`options: VoiceOption[]`（对应 `<optgroup>`） |
| `cfgSaveDir` | `Ref<string>`（初值 `''`） | 已持久化的自定义保存目录 |
| `voiceGroups` | `Ref<VoiceOptionGroup[]>`（初值 `[]`） | 音色下拉分组数据，两卡共用 |
| `modelTag` | `Ref<string>`（初值 `'qwen-audio-3.0-tts-flash'`） | 未绑定模型音色时的兜底模型名，`requireCfg` 用配置 `targetModel` 覆盖 |
| `ttsResultShown` | `Ref<boolean>`（初值 `false`） | 合成结果卡可见标记，由 `TextTtsPage/index.vue` 复位 |
| `setCfgSaveDir` | `(v: string) => void` | 写 `cfgSaveDir.value` |
| `requireCfg` | `async (onError) => Promise<{ ok; apiKey?; targetModel?; saveDir? } \| null>` | 配置校验 + 状态同步（见下） |
| `loadVoices` | `async (onStatus) => Promise<void>` | 统一音色加载入口（主路径 + 回退） |
| `voiceModelOf` | `(voiceId: string) => string` | 双重 `for` + `options.find`，命中返回 `o.model`（可能 `''`），未命中返回 `''` |
| `firstVoiceId` | `() => string` | 取第一个 `options[0].voiceId` 非空的分组的该 id，全空返回 `''`（与原 `sel.selectedIndex = 0` 语义一致） |
| `loadVoicesFallback` | 非导出 `async (onStatus) => Promise<void>` | `listAll` 不可用/无数据时的旧组装路径，仅模块内被 `loadVoices` 调用 |

- **`requireCfg` 细节**：`await voiceTools.getConfig().catch(() => null)`（调用异常按"无配置"处理）；`!c || !c.ok || !c.apiKey` 时 `onError('尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error')` + `goPage('settings')` + 返回 `null`；正常时改写 `modelTag.value = c.targetModel || 'qwen-audio-3.0-tts-flash'`、`cfgSaveDir.value = String(c.saveDir || '').trim()`，并直接返回配置对象（调用方判空即可）。
- **`loadVoices` 主路径**：先 `onStatus('加载音色列表…', '')`；`voiceTools.listAll()` 取 `all.ok && Array.isArray(all.voices)` 的 `items`，为空转 `loadVoicesFallback` 后返回；否则遍历构造 `VoiceOption`（`voiceId: it.voiceId || ''`、`model: it.model || ''`），`it.type === 'custom'` → `label = it.name + '（' + (it.model || '') + '）'` 归自定义组，否则 → `label = it.name + ' — ' + it.voiceId + '（' + (it.model || '') + '）'` 归系统组；`voiceGroups.value = [系统音色（内置）, 自定义音色（我的克隆）].filter((g) => g.options.length)`（**空组被过滤**）；末尾 `onStatus('已加载：系统音色 N 个，自定义音色 M 个。选中音色将使用其绑定的模型合成。', 'hf-ok')`，无音色为 `'音色列表为空'`。
- **`loadVoicesFallback` 回退路径**：顺序调用 `listSystemVoices()`、`list()`、`getProfiles()`（各自 `.catch` 成 `{ ok: false, ... }` 安全值）；系统音色 key `'system:' + v.voice`，label 为 `pName(...) + ' — ' + v.voice + '（' + pModel(..., v.model || '') + '）'`；自定义音色 key `'custom:' + v.voice`，模型取 `v.target_model || ''`；**即使某组为空也保留分组**并插入占位项（`voiceId: ''`，系统组「（系统音色加载失败）」、自定义组 `res.message || '拉取自定义音色失败'`）；状态文案与主路径一致。

## 6. 依赖与协作

| 文件 | import 清单 |
| --- | --- |
| `TextTtsPage/index.vue` | `vue`：`onMounted`、`ref`；`./helpers`：`ttsResultShown`；`@renderer/components/StepBar.vue`；`./SynthSection.vue`；`./AlignSection.vue` |
| `TextTtsPage/SynthSection.vue` | `vue`：`computed`、`onMounted`、`ref`；`@renderer/composables/useAppStore`：`appState`、`refreshProject`；`@renderer/composables/useToast`：`toast`；`@renderer/utils/rate`：`applyRate`、`stepRate`；`@renderer/pages`：`goPage`；`./helpers`：9 个成员 |
| `TextTtsPage/AlignSection.vue` | `vue`：`computed`、`onMounted`、`ref`；`@renderer/composables/useAppStore`：`appState`、`refreshProject`；`@renderer/composables/useToast`：`toast`；`@renderer/utils/escape`：`escTxt`；`@renderer/utils/time`：`fmtTime`、`fmtTimeMs`；`./helpers`：5 个成员 |
| `TextTtsPage/helpers.ts` | `vue`：`ref`；`@renderer/pages`：`goPage`（用于跳 `'settings'`） |

- **`appState` 用到的字段**：`myProjects`、`currentName`、`isBuiltin`、`project.subtitle` / `project.subtitleCount` / `project.content.scenes`。
- **上游**：`pages/index.ts` 的页面注册表（key `'text-tts'`）与 `@renderer/components/StepBar.vue`（`PageKey` 序列含该页，内部 `goPage(props.page)` 刷新当前页）；`StepBar` 的 props 为 `defineProps<{ page: PageKey }>()`。
- **下游（本组使用的 composables / utils / 页面）**：`@renderer/composables/useAppStore`、`@renderer/composables/useToast`、`@renderer/utils/rate`、`@renderer/utils/escape`、`@renderer/utils/time`、`pages/index.ts` 的 `goPage`；两卡的跨页跳转目标为 `'sound-copy'`（音色管理）与 `'settings'`（API Key 设置）。
- **调用的 preload 方法汇总**：

| 命名空间.方法 | 调用方 | 参数 / 用途 |
| --- | --- | --- |
| `voiceTools.getConfig()` | helpers.`requireCfg` | 读 `ok` / `apiKey` / `targetModel` / `saveDir` |
| `voiceTools.listAll()` | helpers.`loadVoices` | 主路径，`voices[].type / name / voiceId / model` |
| `voiceTools.listSystemVoices()` / `voiceTools.list()` / `voiceTools.getProfiles()` | helpers.`loadVoicesFallback` | 回退路径（`voices[].voice / desc / model / target_model`，`profiles` 以 `system:` / `custom:` 前缀为键） |
| `voiceTools.pickDir()` | `SynthSection` | 无参，选自定义保存目录 |
| `voiceTools.saveConfig({ saveDir })` | `SynthSection` | 持久化（`r.dir`）或清除（`''`）自定义目录 |
| `voiceTools.getSaveDir({ projectName, saveDir, defaultOut })` | `SynthSection` | 解析最终保存目录 |
| `voiceTools.synth(t, v, projectName, saveDir, voiceModel, audioName, isOutput)` | `SynthSection` | 7 个位置参数，合成并保存 |
| `voiceTools.listGenerated()` | `SynthSection` | 拉取已生成音频 `res.items` |
| `voiceTools.onAlignProgress(cb)` | `AlignSection` | 订阅进度（`stage` / `percent` / `message`），preload 单订阅 |
| `voiceTools.synthAligned({ projectName, subtitleText, voice, voiceModel, mode, gapSec })` | `AlignSection` | 提交逐句对齐合成 |
| `voiceTools.cancelAlign()` | `AlignSection` | 取消任务 |
| `projectTools.openFolderOf(dirOrFile)` | 两卡 | 打开保存目录 / 结果目录 / 音频所在目录 |
| `projectTools.setAudio(name, audioPath)` | 两卡 | 设为当前项目背景音频 |
| `projectTools.load(name)` | `AlignSection` | 读其它项目字幕（`res.subtitle`） |
| `projectTools.saveSubtitle(name, subtitle, title)` | `AlignSection` | 写回对齐后的字幕 |

- **路由跳转**：`goPage('sound-copy')`（音色管理）、`goPage('settings')`（API Key 设置，helpers 未配置时也会跳）。
- **桥接层对应关系**：以上方法都由 `src/preload/index.ts` 的 `voiceTools` / `projectTools` 命名空间暴露；渲染层 `voiceTools.saveConfig({ saveDir })` 对应 preload 的 `saveConfig(voiceTTS: Partial<VoiceTTSConfig>)`（内部再包成 `{ voiceTTS }` 走 `IPC.Voice.SaveConfig`），`synth` 的 7 个位置参数在 preload 内转为 `{ text, voice, projectName, saveDir, targetModel, audioName, defaultOut }` 对象；`cancelAlign` 用 `ipcRenderer.send`，其余为 `invoke`；`onAlignProgress` 在 preload 内维护单例回调（重复注册仅替换、首次注册才 `ipcRenderer.on`）。
- **helpers 命名导出全清单（11 个）**：`VoiceOption`、`VoiceOptionGroup`、`cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`、`setCfgSaveDir`、`requireCfg`、`loadVoices`、`voiceModelOf`、`firstVoiceId`；`loadVoicesFallback` 不导出。

## 7. 注意事项与实现要点

1. **`v-show` 而非 `v-if`**：两卡始终挂载、切 Tab 不销毁重建，因此进入页面时两卡的 `requireCfg` + `loadVoices` 都会执行，且切 Tab 保留卡内状态（合成文本、已选音色等）——有意为之，切回不必重新填表。
2. **共享状态是模块级单例**：`voiceGroups`、`cfgSaveDir`、`modelTag` 跨页面切换保留，直到下次 `requireCfg` / `loadVoices` 覆盖；只有 `ttsResultShown` 被 `TextTtsPage/index.vue` 在 `onMounted` 显式复位，所以「合成结果」卡仅在本次停留页面期间可见。`SynthSection` 内部置 `true` 后不会自行置回 `false`。
3. **模型跟随音色**：合成模型取 `voiceModelOf(voiceId)`，模板展示的 `modelTag` 只是未绑定模型音色时的兜底值（默认 `qwen-audio-3.0-tts-flash`），二者不要混淆；`voiceModelOf` 返回 `''` 是"该音色没有绑定模型"而非错误，由主进程回落全局默认。
4. **`synth` 是位置参数**：`(text, voiceId, projectName, saveDir, model, audioName, isOutput)`——项目模式传项目名、自定义模式传目录，二者互斥另一个传空串；`out` 模式靠布尔 `isOutput` 标识；`audioName` 传 `audioName.value.trim()`，为空时由主进程按"时间_前五个字_音色id"自动命名。`onSynth` 中 `requireCfg` 的返回值仅用于判空。
5. **`fillGenAudios(true)` 静默**：合成成功后自动刷新列表，失败不覆盖合成的成功提示；只有用户手动点「刷新」（`false`）才报错。
6. **内置项目只读**：`updateGenSel` 用 `appState.isBuiltin` 置灰两个按钮，`onGenSetBg` 内还有二次拦截（双保险）；`AlignSection` 在 `startAlign` 与 `writeAlign` 各有一道守卫。
7. **`genSelIdx` 是字符串下标**：`option :value="String(pair.i)"`，读取统一 `Number(genSelIdx.value)`；`updateGenSel` 找不到条目会清空信息并重新禁用按钮。
8. **两个 `<audio>` 元素各自独立**：结果卡与列表卡分别是 `resultAudioEl` / `genAudioEl`，各自维护语速值；语速步长固定 0.05，范围 0.5~2.0，非法或空值回退 1x，只改播放速率不改磁盘文件。
9. **`file:///` URL 拼接**：四处统一用 `'file:///' + encodeURI(String(path).replace(/\\/g, '/'))` 处理 Windows 反斜杠；路径为空时结果卡也不显示音频。
10. **`onAlignProgress` 是单订阅**：preload 只保留一个回调，重复注册等于替换，不会叠加；切页后旧页回调不再触发。
11. **对齐取消是「当前句完成后停止」**：主进程返回 `{ ok: false, canceled: true, message: '已取消（已完成 i/N 句）' }`，本卡走 `res.canceled` 分支、不显示为错误；`onCancel` 仅设状态为「正在取消（当前句完成后停止）…」。
12. **`assemble` 用不确定态**，`done` / `error` 由 `showAlignBar` 固定填满 100%。
13. **「句间停顿（秒）」是兜底值而非固定值**：仅当字幕原有间隔放不下本句音频、或字幕无时间线（估时）时生效，且输入行只在 `audio-driven` 模式显示。
14. **写入项目的结束时间来自实测音频**（该句音频起点 + 实测时长），不是字幕原结束时间、也不是下一句起始时间，以保证与成片音轨一致；写回是"先字幕后音频"的两步操作，失败即中止且不回滚。
15. **单句试听依赖临时目录**：`segPath` 指向对齐任务的 `seg` 子目录，任务目录被清理后播放失败会 toast「该句试听文件已失效（临时目录被清理），可试听整轨」。
16. **回调签名统一**：`(text: string, kind: string) => void`，两卡的 `setStatus` 恰好同签名可直接传入 `requireCfg` / `loadVoices`；`kind` 约定为 `''`（进行中）、`'hf-ok'`（成功）、`'hf-error'`（失败）。
17. **回退路径不抛异常**：helpers 内所有 IPC 都带 `.catch(() => ...)` 安全值，音色加载失败不中断页面，仅在下拉里出现 `voiceId === ''` 的占位项；`loadVoices` 主路径过滤空组、`loadVoicesFallback` 始终保留两组，因此回退时下拉可能出现占位项。
18. **分组顺序固定**：系统音色（内置）在前、自定义音色（我的克隆）在后；`firstVoiceId()` 只检查每组第一个选项，若它 `voiceId` 为空才跳到下一组。
19. **状态文案可复用**：`'已加载：系统音色 N 个，自定义音色 M 个。选中音色将使用其绑定的模型合成。'` 为两卡共用提示语，改动需注意同一实现。
20. **`activeTab` 为字符串字面量联合类型**，Tab 按钮的 `data-tab` 仅作样式/调试锚点；新增 Tab 必须同时处理类型联合与 `v-show` 条件。
21. **`onLoadNarration` 空旁白**处理：报错文案为「当前项目无内容脚本（或场景无旁白），请先到「内容脚本」页编写」，成功则提示「已载入 N 段旁白（每场景一段、空行分隔），可继续手动编辑」。
22. **`onGenPlay` 空源守卫**：`genAudioEl` 或 `genAudioSrc` 为空时 toast「请先选择已生成音频」，不改变试听行显隐。
