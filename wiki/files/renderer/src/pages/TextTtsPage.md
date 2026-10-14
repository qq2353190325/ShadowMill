# src/renderer/src/pages/TextTtsPage/（页面）

> 「文字生音频」页外壳 + 合成卡 / 逐句对齐卡 / 音色管理卡组 + 共享助手

- **覆盖文件**：

| 文件（相对 `src/renderer/src/pages/`） | 行数 | 作用 |
| --- | --- | --- |
| `TextTtsPage/index.vue` | 37 | 页面外壳：`StepBar` + 三个 Tab，`v-show` 挂载三张卡（**共用 helpers 的 `activeTtsTab`**；切 Tab 只有本页 Tab 按钮一个入口） |
| `TextTtsPage/SynthSection.vue` | 373 | 「文字生音频（TTS 合成）」卡：音色/模型（**未配 Key 时禁用**）、保存位置三选一、合成、结果与已生成音频复用（**切回本 Tab 自动重拉音色**） |
| `TextTtsPage/AlignSection.vue` | 313 | 「字幕配音（逐句对齐）」卡：逐句 TTS + 音频/时间轴双向对齐，结果写回项目（音色行同样受 Key 门控、切回本 Tab 自动重拉音色） |
| `TextTtsPage/VoiceSection.vue` | 520 | 「音色管理」卡组：创建克隆音色（弹窗，目标模型受 Key 门控；**Qwen-Audio-TTS 系列本地文件 / 公网 URL 二选一，填了 URL 以 URL 为准**；弹窗说明只剩 `qwen-audio-3.0-tts-flash` 一条，并提醒审核期间合成会失败）/ 我的音色列表（**4 列、不显示音色 ID、行尾「删云端」动作**、切回本 Tab 自动重拉；**音色审核状态非 `OK` 时在第 3 列追加「（审核中 / 审核未通过）」**）/ 音色映射管理（**系统音色的合成模型固定不可改**；原独立页 `SoundCopyPage/index.vue` 已下线，并入本页第三个 Tab） |
| `TextTtsPage/helpers.ts` | 177 | 模块级共享助手：**三卡共用的当前 Tab `activeTtsTab`**、**配置形状的唯一读取入口**（`readActiveCfg`）、**Key 就绪状态**（`voiceKeyReady` / `activeProviderLabel` / `refreshVoiceKeyState`）、音色加载、模型解析、共享 `ref`（切 Tab 信号已删除，见 §1） |

- **类型**：页面组件（Vue 3 `<script setup lang="ts">` SFC）+ 页面子组件（3 个 SFC）+ 模块级 TS 助手（`<script setup>` 之外的原生模块，无组件）
- **对外导出**：
  - 页面组件默认导出，**无 props、无 emit、无路由参数**；`SynthSection` / `AlignSection` / `VoiceSection` 默认导出、均为无 props 无 emit（父页只用 `v-show` 控制显隐，三卡**常驻挂载**）。
  - `helpers.ts` 共 **17 个命名导出**：接口 `VoiceOption`、`VoiceOptionGroup`、`ActiveVoiceCfg`；`ref` 常量 **`activeTtsTab`**、`cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`、`voiceKeyReady`、`activeProviderLabel`；函数 `readActiveCfg`、`setCfgSaveDir`、`refreshVoiceKeyState`、`requireCfg`、`loadVoices`、`voiceModelOf`、`firstVoiceId`（另有 1 个非导出内部函数 `loadVoicesFallback`）。**原 `voiceTabRequest` / `requestVoiceTab` 已删除**（随合成卡的「管理音色」按钮一起下线）。

## 1. 结构总览

- **挂载关系**：`pages/index.ts` 页面注册表把 `TextTtsPage/index.vue` 登记为 `'text-tts'` 页（无 vue-router，`goPage` 切换 `<component :is>`）；`StepBar :page="'text-tts'"` 负责步骤高亮与「重进本页」刷新。原独立页键 `'sound-copy'`（音色管理）已从注册表与 `PageKey` 联合类型中删除。
- **Tab 关系**：**`activeTtsTab: Ref<'synth' | 'align' | 'voice'>`（初值 `'synth'`，定义在 `helpers.ts`）是父页与三张卡共用的模块级 ref**——驱动三个 `button.hf-tab`（`data-tab="synth"` / `"align"` / `"voice"`）与三张卡的 `v-show`；**用 `v-show` 而非 `v-if`，三卡在页面挂载时都会被创建且从不销毁**，切 Tab 不重置卡内状态。**正因为不重挂载，三张卡各自 `watch(activeTtsTab)`：轮到自己显示时重拉自己的列表**（用户「在音色管理里新建音色 → 切回文字生音频」就能看到新音色）。
- **切「音色管理」Tab 的唯一入口是本页 Tab 按钮**：合成卡上原来的「管理音色」按钮已删除（连同 helpers 的切 Tab 信号 `voiceTabRequest` / `requestVoiceTab`），因此外壳 `index.vue` 不再 `watch` 任何信号、`onMounted` 也不消费信号（源码注释：不再需要「watch 信号 → 落 Tab」的那套机制）。
- **UI 门控：没配 Key 就不让选音色/模型**：`refreshVoiceKeyState()` 并行取 `voice:get-config` + `voice:list-models`，按 `active` 厂家判定 Key 是否已配置，并把该厂家的 `label` 写进 `activeProviderLabel`；三张卡据此把音色/模型下拉 `:disabled` 并显示一行说明（「还没配置「<厂家>」的 API Key：先在「设置 → 语音服务」填好并保存…」），对齐卡还多一个仅在未就绪时出现的「API Key 设置」按钮。源码注释：没填对应厂家 Key 时，选了音色/模型也一定失败，所以界面直接禁用并说明原因；页面在 `goPage` 时强制重挂载，所以「去设置页存完 Key 回来」会自动重算。**例外**：「音色映射管理」卡片的模型下拉**不受 `voiceKeyReady` 门控**（它只是本地映射、不需要 Key），但**选中系统音色时该下拉禁用**并显示固定模型——系统音色与合成模型是固定绑定，只能改名。
- **helpers 复用**：

| 使用方 | 导入成员 |
| --- | --- |
| `TextTtsPage/index.vue` | 2 个：`activeTtsTab`（模板三处 `:class` / `@click` / `v-show` 都用它，setup 顶层复位为 `'synth'`）、`ttsResultShown`（`onMounted` 中复位） |
| `TextTtsPage/SynthSection.vue` | 13 个：`activeTtsTab`（`watch` 用）、`cfgSaveDir`、`firstVoiceId`、`loadVoices`、`modelTag`、`requireCfg`、`setCfgSaveDir`、`ttsResultShown`、`voiceGroups`、`voiceModelOf`、`activeProviderLabel`、`refreshVoiceKeyState`、`voiceKeyReady`（**不再导入** `requestVoiceTab`） |
| `TextTtsPage/AlignSection.vue` | 9 个：`activeTtsTab`（`watch` 用）、`firstVoiceId`、`loadVoices`、`requireCfg`、`voiceGroups`、`voiceModelOf`、`activeProviderLabel`、`refreshVoiceKeyState`、`voiceKeyReady`（不用 `cfgSaveDir` / `modelTag` / `ttsResultShown` / `setCfgSaveDir`） |
| `TextTtsPage/VoiceSection.vue` | **5 个**：`activeTtsTab`（`watch` 用）、`activeProviderLabel`、`readActiveCfg`、`refreshVoiceKeyState`、`voiceKeyReady`——门控三项用于「Key 未配置就禁用创建弹窗的模型下拉」，`readActiveCfg` 供卡内 `requireCfg` 读配置；其余（音色候选、合成模型解析）仍是卡内自带（见第 5 节） |

- **共享单例**：`helpers.ts` 的 **7 个 `ref`**（**`activeTtsTab`**、`cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`、`voiceKeyReady`、`activeProviderLabel`）定义在模块作用域，跨页面切换、跨组件共享同一份实例（不随卸载销毁）；**`activeTtsTab` 由父页写、三卡 `watch` 读**；`voiceGroups` 由合成卡与对齐卡共用，后一次加载的结果对两卡同时生效；**`voiceKeyReady` / `activeProviderLabel` 由 `refreshVoiceKeyState()` 统一刷新**，三张卡都读它做门控。`VoiceSection` 另维护自己的一套状态（`models` / `providers` / `sysVoices` / `cloudVoices` / `profiles`），与 `voiceGroups` 互不影响。

## 2. TextTtsPage/index.vue（外壳）

- **模板结构**：`div > StepBar(:page="'text-tts'")` → `div.hf-tabs`（`button.hf-tab` × 3，`:class="{ active: activeTtsTab === '…' }"`、`@click="activeTtsTab = '…'"` 直接赋值）→ `<SynthSection v-show="activeTtsTab === 'synth'" />` → `<AlignSection v-show="activeTtsTab === 'align'" />` → `<VoiceSection v-show="activeTtsTab === 'voice'" />`。Tab 文案：「文字生音频（TTS 合成）」「字幕配音（逐句对齐）」「音色管理（克隆 / 改名 / 绑模型）」。**三处 `:class`、三处 `@click`、三处 `v-show` 用的都是 helpers 的 `activeTtsTab`**（本轮起删掉了本地的 `activeTab`，因为三张卡要 `watch` 同一个 ref）。
- **状态**：**本文件不再有本地状态**——Tab 值来自 `helpers.activeTtsTab`（三值字符串字面量联合）。
- **已无跨组件切 Tab 信号**：`goVoiceTab()`、`watch(voiceTabRequest, …)` 与 `onMounted` 里的信号消费分支都已删除（源码注释：原独立「音色管理」页已并入第三个 Tab，切「音色管理」Tab 只有本页 Tab 按钮一个入口，所以不再需要「watch 信号 → 落 Tab」的那套机制）。
- **复位放在 setup 顶层**：页面被挂载时执行 `activeTtsTab.value = 'synth'`（**不放在 `onMounted` 里**，源码注释：子卡先于父组件挂载，等父 `onMounted` 再改会让已挂载的卡白触发一次刷新）。
- **生命周期**：`onMounted` 现在只做一件事——`ttsResultShown.value = false`（每次进入本页复位合成结果卡标记）；子组件各自的 `onMounted` 亦在此刻执行（`SynthSection.vue` / `AlignSection.vue` / `VoiceSection.vue` 各自文件末尾的 `onMounted(...)`），三卡都会各自拉配置与音色数据。
- **import**：`vue` 的 `onMounted`（**`ref` 与 `watch` 都不再导入**）；`./helpers` 的 `activeTtsTab`、`ttsResultShown`（**不再导入 `voiceTabRequest`**）；`@renderer/components/StepBar.vue`；`./SynthSection.vue`、`./AlignSection.vue`、`./VoiceSection.vue`。
- **本文件不直接调用任何 IPC**，`window.*` 调用全部发生在三张卡与 `helpers.ts` 中；`ttsResultShown` 的消费方只有 `SynthSection`（对齐结果走自身的 `alignResult`）。
- **流程**：页面被注册表挂载 → setup 顶层把 `activeTtsTab` 复位为 `'synth'` → 模板先渲染 `StepBar`、再渲染 Tab 按钮组、最后创建三张卡（`v-show`，三卡都会挂载）→ 父页 `onMounted` 复位 `ttsResultShown` → 三卡各自 `onMounted` 开始拉配置与音色 → **点 Tab 只改共享的 `activeTtsTab`，不改动组件实例，各卡靠 `watch(activeTtsTab)` 在轮到自己时重拉列表** → 点 `StepBar` 重进本页时 `goPage(props.page)` 重建页面组件，流程从挂载重新开始（`ttsResultShown` 再次被复位）。
- **样式**：模板只用全局设计系统类名（`.hf-tabs` / `.hf-tab` / `.hf-tab.active`），无组件级 `<style>`；卡片风格与 CSS 变量以 `src/renderer/src/assets/main.css` 为准。

## 3. TextTtsPage/SynthSection.vue（文字生音频卡）

**模板区块**（三个 `div.card.hgen-panel`）：

| 区块 | 关键绑定 / 事件 |
| --- | --- |
| 合成主卡 | 标题「文字生音频（TTS 合成）」+ `.hgen-tip`（**「音色与模型是绑定的：系统音色固定用厂家目录里的合成模型（当前 `{{ modelTag }}`），克隆音色用其创建/映射时绑定的模型。…改名或为克隆音色换模型，到「音色管理」标签页。」**）；`textarea.hgen-subtitle` `v-model="text"`（高 150px，`placeholder="输入要合成语音的文字…"`）；「载入脚本旁白」`@click="onLoadNarration"` |
| ↳ 音色行 | `HfSelect v-model="voiceId" :groups="voiceGroups" :disabled="!voiceKeyReady"`（`voiceGroups` 原样透传：`VoiceOption` 的键就是 `value`，形状与 `HfSelectOption` 对齐，无需再包一层映射）+ 条件 `:title`；未就绪时紧随其后一行 `.hgen-tip`（「还没配置「<厂家>」的 API Key：先在「设置 → 语音服务」填好并保存，才能选择音色与模型…」）+「刷新」`onRefreshVoice`。**原「管理音色」按钮已删除**（连同 `onManageVoice()` 与它的注释） |
| ↳ 保存到行 | `HfSelect v-model="saveTo" :groups="saveToGroups" :title="保存位置说明" @change="onSaveToChange"`（选项 `proj:<p.name>`「项目「标题或名」（audio/）」、`custom`「自定义目录…（已选/未选择）」、`out`「音频输出目录（不写入项目）」）+「打开目录」`onOpenFolder`；自定义目录行 `v-show="parseSaveTo().kind === 'custom'"`（展示 `cfgSaveDir` +「恢复默认」`onClearCustom`） |
| ↳ 名字与提交 | `input.hgen-input v-model="audioName"`（选填，留空自动命名「时间_前五个字_音色id」）；「合成并保存」`:disabled="synthBusy"` `@click="onSynth"`；`.hf-status :class="statusClass"`；「API Key 设置」`goSettingsVoice()`（title「跳转到「设置」-「语音服务」（未配置 Key 时合成会自动引导）」） |
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

**函数**：`setStatus(text, kind)`（同时写 `status` / `statusClass`，作为 `onStatus` / `onError` 双签名回调传入 helpers）；`onRefreshVoice`；`goSettingsVoice()`（`requestSettingsSection('voice')` + `goPage('settings')`，供「API Key 设置」按钮；**原 `onManageVoice()` 与「管理音色」按钮已删除**）；`onLoadNarration`（读 `appState.project.content.scenes`，取各 `s.narration.trim()` 过滤空串后以 `'\n\n'` 拼接，无旁白时报错引导去「内容脚本」页）；`parseSaveTo()`（解析为 `{ kind: 'custom' | 'output' | 'project' | 'none'; saveDir?; projectName? }`，`proj:` 前缀用 `v.slice(5)` 取项目名）；`fillSaveTo()`；`onSaveToChange()`；`onClearCustom()`；`onOpenFolder()`；`onSynth()`；`onResultRateInput()` / `resultRateStep(delta)`；`onOpenResultDir()`（无路径 `toast('暂无合成文件可打开')`）；`updateGenSel()`（写 `genInfo` / `genAudioSrc`，并据「选中的条目是否存在」置两个禁用态：找不到条目则清空信息、把 `genSetDisabled` / `genOpenDisabled` 置回 `true` 并返回；命中则置 `false` 并隐藏试听行）；`fillGenAudios(silent)`；`onGenPlay()`；`onGenSetBg()`；`onGenOpenDir()`；`onGenRateInput()` / `genRateStep(delta)`；`onMounted`。

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

**模板要点**：`.card.hgen-panel`（`margin-top:16px`）+ `.panel-title`；两条模式说明 `.hgen-tip` 按 `alignMode` `v-show`；字幕来源行 `HfSelect v-model="subSrc" :groups="subSrcGroups" title="选用哪份字幕逐句合成配音" @change="syncSubCount"`（选项 `__current__`「当前项目字幕（N 条）」与 `appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)` 的项目字幕）+「刷新」`syncSubCount` + `subCountTip`；音色行 `HfSelect v-model="voiceId" :groups="voiceGroups" :disabled="!voiceKeyReady"`（与合成卡共用同一份音色分组数据；条件 `:title` + 未就绪时紧跟一行 `.hgen-tip`「还没配置「<厂家>」的 API Key：先在「设置 → 语音服务」填好并保存，才能选择音色与模型…」，另有仅在未就绪时出现的「API Key 设置」按钮 → `goSettingsVoice()`）+「刷新」`onRefreshVoice`；`radio` 两项；操作行「开始对齐合成」`:disabled="alignBusy"`、「取消」`v-show="alignBusy"`、「重试」`v-show="!alignBusy && !alignResult"`（后两者均指向 `startAlign` / `onCancel`）；`.whisper-bar-wrap` `v-show="barVisible"`（`.whisper-bar` 的 `indeterminate` 类由 `barIndeterminate` 控制，`.whisper-bar-fill` 类为 `barState`、宽度 `barPercent + '%'`，文案 `barText`）；`.hf-status :class="statusClass"`；结果区 `v-show="alignResult !== null"`（`<audio ref="alignAudioEl" :src="alignAudioSrc" controls>`、「打开目录」`onOpenDir`、「写入当前项目」`writeAlign`、`summary`、`.sub-list` 明细）；明细行 `.align-row`：序号 `d.index + 1`、文本 `escTxt(d.text)`（与 title 同源）、`fmtTime(d.subtitleStart)`、`fmtTime(d.audioStart)`、`Number(d.audioDur).toFixed(1) + 's'`、状态徽标、`d.segPath` 存在时的「试听」`playSeg`；徽标 `.align-badge`：`accelerated` → `加速 x{rate.toFixed(2)}`（warn）、`pushed` → `顺延 +{delta.toFixed(1)}s`（warn）、其余「正常」（ok）；末尾隐藏 `<audio ref="segAudioEl" style="display:none">`。

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

**函数**：`setStatus(text, kind)`；`countSubtitleLines(text)`（按行分割、trim、滤空行计数）；`syncSubCount()`（`__current__` 显示「共 N 行」，行数取自 `appState.project.subtitle`，否则置空）；`getAlignSubtitleText()`（`__current__` 用 `appState.project.subtitle`，为空提示「当前项目没有字幕，请先到「字幕生成」页生成或填写」；其它来源 `window.projectTools.load(v)` 读 `res.subtitle`，为空提示「项目「v」没有字幕」）；`onRefreshVoice()`；**`goSettingsVoice()`（`requestSettingsSection('voice')` + `goPage('settings')`，供未配 Key 时那个「API Key 设置」按钮）**；`showAlignBar(info, indeterminate, percent?)`（`kind` 为 `done` / `error` 时置 `barState`，`percent` 非数字时 `done` / `error` 填 100、否则 0）；`hideAlignBar()`；`resetAlignUi()`；`startAlign()`；`onCancel()`；`playSeg(path)`；`onOpenDir()`；`writeAlign()`；`onMounted`（**首句 `void refreshVoiceKeyState()`**）。

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

**模板区块**（两张 `div.card.hgen-panel`：「我的音色」与「音色映射管理」，后者行内 `style="margin-top:16px"`；「创建克隆音色」已从页面卡片改为 `<Teleport to="body">` 弹窗，**没有新增任何 CSS**，全部复用既有 `.hf-modal*` 类）：

| 区块 | 关键绑定 / 事件 |
| --- | --- |
| 创建克隆音色弹窗（模板末尾，页面卡片之外） | `<Teleport to="body">` 包 `v-if="createOpen"` 的 `.hf-modal-mask`（`@click.self="closeCreate"`）> `.hf-modal`（行内 `style="width:min(680px,94vw)"`）→ `.hf-modal-head`（`.hf-modal-title`「创建克隆音色」+ `.hf-modal-close`「×」`title="关闭"`）→ `.hf-modal-body`（`.hgen-tip`（行内 `style="margin-top:0"`）长说明，**本轮整段重写为「只剩一条模型说明」**：创建时选定的模型会绑定到该音色，后续合成沿用同一模型（**`（创建计费 0.01 元/个）` 一句已从这条提示里删除**，源码里只剩 `createBusy` 守卫处的注释）；「· **qwen-audio-3.0-tts-flash**：**本地文件与公网 URL 都支持**——选本地文件会自动用 ffmpeg 截取前 15 秒、转 24kHz 单声道后直传（**无需先传到公网**）；也可以粘贴**可公开访问的音频 URL**，两者都填时**以 URL 为准**；注意：参考音频需 **3~30 秒清晰人声**（推荐 10~20 秒）；**音色创建后要过云端审核**（列表里非「OK」会标注「审核中 / 审核未通过」），**审核期间合成会失败**」（**vc 那条模型说明「能创建 ≠ 能合成」一句已随 vc 系列一起删除**）」→「显示名称」`input.hgen-input v-model="vcName"`（中文可）→「目标模型」`HfSelect v-model="vcModel" :groups="cloneModelGroups" :disabled="!voiceKeyReady" :title="voiceKeyReady ? '' : '先在「设置」-「语音服务」填好该厂家的 API Key，才能选择模型'" @change="applyInputMode"` → `v-if="!voiceKeyReady"` 的 `.hgen-tip`（「还没配置「{{ activeProviderLabel \|\| '当前厂家' }}」的 API Key：先在「设置 → 语音服务」填好并保存，才能创建克隆音色。」）→ **本地文件行（本轮改为常显：去掉了原来的 `v-show="!urlMode"`）**：「选择音频文件」`onPick` + `span.hf-file`（`audioPath ? escTxt(audioPath) : '未选择文件'`）→ **URL 行** `v-show="urlMode"`（label「**或音频 URL**」+ `input.hgen-input v-model="vcUrl"`，placeholder「可选：https://...（公网可访问的音频地址；填了就优先用它，留空则用上面的本地文件）」）→ `.hf-status :class="statusClass"`）→ `.hf-modal-foot`（三个按钮：「API Key 设置」`.hf-btn` 带行内 `style="margin-right:auto"` 靠左、`goSettingsVoice` / 「取消」`closeCreate` / 「创建音色」`.hf-btn.hf-btn-primary`、`:disabled="createBusy"`、文案 `createBusy ? '创建中…' : '创建音色'`、`onCreate`）。**必须 Teleport 到 body**（源码注释）：`.card` 上带 `backdrop-filter`，它会让 `fixed` 定位相对卡片而不是视口（蒙层会被卡片裁住）；HfSelect 弹层 `z-index: 9500` > 蒙层 `9000`，仍浮在弹窗之上 |
| 删除云端音色确认弹窗（模板末尾，页面卡片之外） | `<Teleport to="body">` 包 `v-if="deleteTarget"` 的 `.hf-modal-mask`（`@click.self="closeDeleteCloud"`）> `.hf-modal`（行内 `style="width:min(520px,94vw)"`）→ `.hf-modal-head`（`.hf-modal-title`「删除云端音色」+ `.hf-modal-close`）→ `.hf-modal-body`：文案「将从云端（<当前厂家>）永久删除这个克隆音色，**不可撤销**；该音色的本地显示名与映射会一并清除（已在项目里生成的音频不受影响）」+ 两行只读信息——**显示名称**与**创建时间**（**刻意不显示音色 ID**，源码注释：列表不露 ID，靠创建时间区分是哪一条）；→ `.hf-modal-foot`：「取消」`closeDeleteCloud` /「确认删除」`.hf-btn.hf-btn-danger`、`:disabled="deleteBusy"`、文案 `deleteBusy ? '删除中…' : '确认删除'`、`onDeleteCloud`。删除中 `closeDeleteCloud()` 直接返回（不让人看不到结果） |
| 我的音色卡 | 头行 `.panel-head` = `.panel-title`「我的音色」+ `.panel-head-actions` 内**两个**按钮：「创建克隆音色」（`.hf-btn.hf-btn-primary`，`@click="openCreate"`）与「刷新音色列表」（`.hf-btn`，`:disabled="listBusy"`、文案 `listBusy ? '刷新中…' : '刷新音色列表'`、`@click="loadAll(false)"`；刷新按钮原先在列表**下方**的 `.hgen-actions` 里，那段已删除）→ `.hf-status :class="listStatusClass"`；`v-if="!voiceList.length"` 时 `.hgen-tip`「暂无音色。可点右上「创建克隆音色」新建，或到「文字生音频」标签页使用内置系统音色。」；否则 `.voice-list`（`.voice-list-head` **四列表头**「显示名称 / 合成模型 / 语种 · 创建时间 / `&lt;span&gt;&lt;/span&gt;`（动作列，表头留空）」+ `.voice-list-body` 内 `v-for="it in voiceList" :key="it.key"` 的 `.voice-list-row`）。**列表已不再显示音色 ID**（原「音色 ID」表头与 `.voice-id` 单元格删除，`main.css` 的 `.voice-id` 规则也删了）；列表下方另有**一行** `.hgen-tip`（说明点任意一行会把它载入下方「音色映射管理」、显示名与绑定只存本机 `settings.json`） |
| ↳ 列表行内部（4 列） | ① `.voice-name`：`.voice-name-text`（省略号）+ `<b class="voice-tag" :class="it.type === 'system' ? 'sys' : 'clone'">` 徽标（「系统」/「克隆」）；② `.voice-model` 合成模型；③ `.voice-extra`（系统音色为 `langs`；克隆音色为 `gmt_create` 创建时间，**审核状态非 `OK` 时追加「（审核中 / 审核未通过）」，由 `voiceStatusText(status)` 翻译**）；④ **`.voice-actions` 动作列**：仅 `it.type === 'custom'` 时显示 `.hf-btn.hf-btn-danger` 小按钮「删云端」（`@click.stop="askDeleteCloud(it)"`——**必须 `@click.stop`**，否则会连带触发整行的「载入映射」）。每个格子都带 `:title` 给全文；整行 `title="点这一行 → 载入下方「音色映射管理」，可改显示名与绑定模型"` + `@click="editVoice(it.key)"`，正在编辑的那行（`it.key === mapVoice`）加 `.on`。字号全部由 `main.css` 的 `.voice-list-*` / `.voice-*` 提供（表头 12px、行 13px、次要列 12px、`.voice-tag` 11px） |
| 音色映射管理卡 | 卡片 `.hgen-tip`：「为任意音色（系统音色 / 克隆音色）设置本地中文显示名；显示名与模型只保存在本机 settings.json。**系统音色与合成模型是固定绑定**（由厂家目录决定，不可改），所以系统音色这一行只能改名；克隆音色可以另外绑一个该厂家的模型。」；「音色」`HfSelect ref="mapVoiceEl" v-model="mapVoice" :groups="mapGroups" @change="syncMapForm"`；「显示名称」`input.hgen-input v-model="mapName"`；「合成模型」`HfSelect v-model="mapModel" :groups="modelGroups" :disabled="mapIsSystem" :title="mapIsSystem ? '系统音色的合成模型由厂家目录固定，不可改（只能改显示名）' : ''"` + `v-if="mapIsSystem"` 的 `.hgen-tip`「系统音色固定使用「`{{ mapFixedModel }}`」合成，无需也无法改绑；这里保存的只是中文显示名。」（**这张卡的下拉不受 `voiceKeyReady` 门控**，但系统音色那一行因固定绑定而禁用）；动作行「保存映射」`.hf-btn.hf-btn-primary` `onSaveMap` +「解除映射」`onClearMap`；`.hf-status :class="mapStatusClass"` |

**类型**（4 个均为卡内局部 `interface`，不导出）：

| 名称 | 字段 |
| --- | --- |
| `ModelView` | `id: string`、`label: string`、`role?: string`、`input?: string`、`isDefault?: boolean` |
| `SysVoiceView` | `voice: string`、`desc: string`、`langs: string`、`series: string[]`、`model: string` |
| `CloudVoiceView` | `voice: string`、`voice_id?: string`、`target_model?: string`、`gmt_create?: string`、`status?: string` |
| `ProfileView` | `key: string`、`name: string`、`voice: string`、`targetModel: string`、`type: string` |

**状态与数据**：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `models` | `Ref<ModelView[]>` | `voiceTools.listModels()` 返回的**跨厂家平铺**全量模型（含 `role` / `input` / `isDefault` 等元数据） |
| `providers` | `Ref<ProviderView[]>` | 同一次 `listModels()` 回带的**厂家目录**；`ProviderView` 是卡内局部 interface（`key` / `label` / `apiKeyHint` / `defaultModel` / `models`，`voices?` 可选） |
| `sysVoices` / `cloudVoices` | `Ref<SysVoiceView[]>` / `Ref<CloudVoiceView[]>` | `listSystemVoices()` / `list()` 的结果（`SysVoiceView` 新增可选 `provider` / `providerLabel`） |
| `profiles` | `Ref<Record<string, ProfileView>>` | `getProfiles()` 的本地映射表（键为 `system:<voice>` / `custom:<voice>`） |
| `buildModelGroups(onlyClone)` | `(boolean) => HfSelectGroup[]` | **按厂家分组**：组名 = `厂家 label · 模型 group`（无 group 时只用 `厂家 label`）；`providers` 为空时退回平铺（按 `group` 分组）。原来的 `cloneModels`（筛 `role === 'clone'`）已删除 |
| `modelGroups` / `cloneModelGroups` | `ComputedRef<HfSelectGroup[]>` | `buildModelGroups(false)` / `buildModelGroups(true)`：全部模型 / 仅克隆模型；option 的 `value` 为模型 id、`label` 为模型名 |
| `vcName` / `vcModel` / `vcUrl` | `Ref<string>`（初值 `''`） | 创建表单：显示名称 / 目标模型 id / 音频 URL（**可选**，只在 Qwen-Audio-TTS 系列显示；填了优先于本地文件） |
| `audioPath` | `Ref<string \| null>`（初值 `null`） | 本地音频路径（`pickAudio()` 返回值）；**本地文件行常显，两类模型都能选** |
| `urlMode` | `Ref<boolean>`（初值 `false`） | **目标模型是否属于 Qwen-Audio-TTS 系列**（这类模型除本地文件外**还**接受公网音频 URL，所以多显示一个 URL 输入框）；只由 `applyInputMode()` 按模型 id 判定 |
| `status` / `statusClass` | `Ref<string>` | 创建卡状态文案与语义类（`''` / `hf-ok` / `hf-error`） |
| `listStatus` / `listStatusClass` | `Ref<string>` | 「我的音色」卡状态：成功为「系统音色 N 个 · 克隆音色 M 个」（`hf-ok`）；克隆音色 / 本地映射任一路失败时为「系统音色 N 个 · 克隆音色拉取失败（…）；本地音色映射读取失败（…）」（`hf-error`） |
| `listBusy` | `Ref<boolean>`（初值 `false`） | 列表刷新中标记：`loadAll()` 的防连点守卫 + 刷新按钮的 `disabled` 来源 |
| `createOpen` / `createBusy` | `Ref<boolean>`（初值均 `false`） | 「创建克隆音色」弹窗开关 / 创建中标记（`createBusy` 同时是创建按钮 `disabled` 与「创建中…」文案的来源，见第 36 条） |
| `mapStatus` / `mapStatusClass` | `Ref<string>` | 映射卡状态 |
| `voiceList` | `ComputedRef<{ key; name; voice; targetModel; type; extra }[]>` | 「我的音色」列表的行数据：系统音色 + 克隆音色合并，名称 / 模型 / 语种优先取本地映射（见下）；`targetModel` / `extra` 分别是行内第 2 / 3 列（**音色 id `voice` 只用于内部逻辑与删除请求，不再渲染成一列**）；克隆音色没有本地中文名时 `name` 用字面量 **`'未命名克隆音色'`**（源码注释：列表不显示音色 ID，靠右侧「创建时间」列区分是哪一条） |
| `mapVoiceEl` | `Ref<InstanceType<typeof HfSelect> \| null>` | 映射卡「音色」下拉的**组件实例**（`editVoice` 用其 `$el` 滚动定位） |
| `mapVoice` / `mapName` / `mapModel` | `Ref<string>` | 映射表单：音色键（带 `system:` / `custom:` 前缀）/ 显示名 / 合成模型 id |
| `mapIsSystem` / `mapFixedModel` | `computed<boolean>` / `computed<string>` | 当前选中的是不是**系统音色**（key 以 `system:` 开头）/ 该音色**固定使用的模型**（从 `sysVoices` 里按 key 找到的 `model`）——系统音色时禁用模型下拉并显示该固定值 |
| `mapOptions` | `ComputedRef<{ value; label; type; voice; model }[]>` | 映射候选的**扁平**列表，供查找与分组共用；**标签不再拼音色 ID**：系统音色只用 `v.desc`，克隆音色用 `本地名 \|\| '未命名克隆音色 · ' + gmt_create.slice(5,16)`（如「未命名克隆音色 · 10-08 14:59」） |
| `deleteTarget` | `Ref<{ key; name; voice; extra } \| null>` | 「删除云端音色」确认弹窗的目标行（`null` = 弹窗关闭）；`extra` 是创建时间，弹窗里显示名称 + 创建时间但**不显示音色 ID** |
| `deleteBusy` | `Ref<boolean>` | 删除请求进行中标记：按钮文案切「删除中…」且 `closeDeleteCloud()` 期间不许关闭弹窗 |
| `mapGroups` | `ComputedRef<HfSelectGroup[]>` | `mapOptions` 按类型分两组（「系统音色（内置）」/「自定义音色（我的克隆）」），**空组被过滤**（与 `voiceGroups` 同规则） |

**函数**：`toAsciiName(raw)`；`genAsciiName(raw, max = CLONE_PREFIX_MAX)`（**默认值本轮改为模块级常量**）；**`CLONE_PREFIX_MAX = 10`**（**本轮新增的模块级常量**，原 `cloneNameMax(audioSeries)` 的 10 / 16 分流已删除）；**`voiceStatusText(s)`**（**本轮新增**：`s === 'DEPLOYING' ? '审核中' : s === 'UNDEPLOYED' ? '审核未通过' : String(s || '')`，源码注释说明「音色创建后要过审核，非 OK 必须说出来，否则『看得见音色、一合成就报错』很难排查」）；`applyInputMode(m)`（`urlMode = /^qwen-audio-.*-tts/i.test(String(m || ''))`）；`buildModelGroups(onlyClone)`（按厂家分组，见上表）；`requireCfg()`（卡内私有，**但配置读取已统一走 helpers 的 `readActiveCfg()`**，见下）；`openCreate()` / `closeCreate()`（弹窗开关）；`goSettingsVoice()`（`closeCreate()` + `requestSettingsSection('voice')` + `goPage('settings')`）；`onPick()`；`onCreate()`；`loadAll(silent)`；`syncMapForm()`；`editVoice(key)`；**`askDeleteCloud(it)`**（打开删除确认弹窗，`it` 为列表行）；**`closeDeleteCloud()`**（删除中直接返回，否则关弹窗）；**`onDeleteCloud()`**（调 `voiceTools.deleteCloudVoice(t.voice)`；成功：写回 `profiles` → 若删的正是 `mapVoice` 则清空 → 关弹窗 → `toast('已删除云端音色「' + t.name + '」')` → `await loadAll(true)`；失败：关弹窗并把 `res.message` 写进列表状态行 `listStatus` / `listStatusClass`）；`onSaveMap()`；`onClearMap()`；`onMounted`。

**ASCII 名字生成规则**（复刻的 `voice` / `prefix` 必须是纯 ASCII，中文名只作为本地显示名；**上限统一 10 位**）：

| 函数 | 规则 |
| --- | --- |
| `toAsciiName(raw)` | `String(raw \|\| '').trim().replace(/[^A-Za-z0-9_]/g, '')` —— 只保留数字 / 字母 / 下划线，中文与其它符号全部剔除（**本轮未变**） |
| `genAsciiName(raw, max = CLONE_PREFIX_MAX)` | 先 `toAsciiName`；结果为空则用 `'myvoice' + Date.now().toString().slice(-8)`（时间戳后 8 位）兜底；长度超过 `max` 则截断到前 `max` 位。**默认值本轮由字面量 16 改为模块级 `CLONE_PREFIX_MAX`**，调用方现在只传一个参数（`genAsciiName(name)`） |
| `CLONE_PREFIX_MAX` | **本轮新增的模块级常量，值 `10`**：源码注释「复刻的 `input.prefix` 只允许数字 / 字母 / 下划线且不超过 10 个字符（与主进程 `voice.ts` 的 `CLONE_PREFIX_MAX` 一致）；中文名仅保存为本地『显示名称』」。**原 `cloneNameMax(audioSeries)`（audio 10 位 / 其余 16 位分流）已删除**——vc 系列移除后只剩一档 |

中文「显示名称」通过成功后的 `saveProfile({ name })` 落到本机映射，**不参与云端命名**；同一个中文名多次创建会再次生成不同的 ASCII 名（时间戳兜底）。

**创建的音频来源（`onCreate`，本轮把原来的 URL / 本地文件两条分支合并成一条）**：

`onCreate` 开头：`if (createBusy.value) return`（防连点，源码注释：创建计费 0.01 元/个，双击会建出两个音色）→ `createBusy = true`，整个函数体包在 `try { … } finally { createBusy.value = false }` 中。共同前置：`requireCfg()`（**按厂家**校验：`getConfig()` 异常或 `!c.ok` 或**当前厂家**的 `apiKey` 为空 → 状态「尚未配置「<厂家>」的语音 API Key，请先到「设置」-「语音服务」填写并保存」（`hf-error`）+ `requestSettingsSection('voice')` + `goPage('settings')` + 返回，与弹窗里的「API Key 设置」同一条路径）；显示名称 `vcName.trim()` 为空 →「请填写显示名称」；随后 `targetModel = vcModel.value`，并再调一次 `applyInputMode(targetModel)` 重算模式。

合并后的流程（源码注释：Qwen-Audio-TTS 系列「本地文件 / 公网 URL」二选一，**填了 URL 就以 URL 为准**；其余模型只认本地文件；主进程按这个字符串的形态——路径 / URL / data URI——自行分流）：

| 步骤 | 实现 |
| --- | --- |
| 1. 取 URL | `const remote = urlMode.value ? vcUrl.value.trim() : ''`（只有 Qwen-Audio-TTS 系列才读 URL 输入框） |
| 2. 定来源 | `const source = remote \|\| audioPath.value \|\| ''`（**URL 优先于本地文件**） |
| 3. 空值提示 | `source` 为空 → 按模型给提示：`urlMode` 为真时「请先选择本地音频文件，或粘贴可公开访问的音频 URL」，否则「请先选择音频文件」；`statusClass = 'hf-error'` |
| 4. 状态行 | `(remote ? '正在使用音频 URL 创建音色' : '正在处理本地音频并创建音色') + '（约几秒）…'`，类清空 |
| 5. 提交 | `window.voiceTools.create(source, genAsciiName(name), targetModel)`——**提交名固定按 `CLONE_PREFIX_MAX = 10` 截断**（原按系列 10 / 16 切换的逻辑已随 vc 系列删除） |

成功分支：`saveProfile({ key: 'custom:' + res.voice, name, voice: res.voice, targetModel, type: 'custom' })` 绑定中文名与模型 → 状态「音色创建成功，已绑定中文名「N」与模型「M」」（**本轮去掉了「（降级模式：…）」那段**——`VoiceCreateResult` 已收缩为 `{ voice, targetModel }`，主进程不再读 `fallback_mode` / `fallback_reason`）→ `loadAll(true)` 静默刷新列表 → **`closeCreate()` 收起弹窗**（注释：建完收起弹窗，新音色已经出现在下面的列表里）。失败分支：`status = res?.message || '创建失败'`、`statusClass = 'hf-error'`（主进程的「参考音频太短 / 准备参考音频失败 / 服务端不接受这段参考音频」等文案都从这里显示）。

**「我的音色」列表合并规则**（`voiceList`）：先遍历 `sysVoices`（`key = 'system:' + v.voice`，`name = prof.name || v.desc`，`targetModel = prof.targetModel || v.model || ''`，`type: 'system'`，`extra: v.langs || '系统音色'`——第 4 列改放**特色语种**，源码注释说明「系统 / 克隆已由名字旁的徽标表达」），再遍历 `cloudVoices`（`key = 'custom:' + v.voice`，`name = prof.name || '未命名克隆音色'`，`targetModel = prof.targetModel || v.target_model || ''`，`type: 'custom'`，**`extra = (v.gmt_create || '') + (v.status && v.status !== 'OK' ? '（' + voiceStatusText(v.status) + '）' : '')`**——即创建时间，并在审核状态非 `OK` 时追加「（审核中 / 审核未通过）」，源码注释：主进程已把列表接口的字段统一（`voice` / `voice_id` / `target_model` 都补齐），审核状态非 `OK` 时（`DEPLOYING` / `UNDEPLOYED`）一并显示——音色建出来了但还不能用，得让人看出区别）——即**有本地映射则显示中文名与绑定模型，否则回落云端默认**。

**`loadAll(silent)`**：开头 `if (listBusy.value) return`（防连点，并发两次会互相盖掉状态行），随后 `listBusy = true`，整个函数体包在 `try { … } finally { listBusy.value = false }` 中；`silent === false`（用户点「刷新音色列表」）先写 `listStatus = '拉取音色与映射…'`（类清空）；`Promise.all` 并发拉 `listSystemVoices()` / `list()` / `getProfiles()`（各自 `.catch(fail)` 成 `{ ok: false, message }` 安全值，`fail` 把异常消息归一为字符串），三元组结果分别写入 `sysVoices` / `cloudVoices` / `profiles`；若 `mapOptions` 非空且 `mapVoice` 为空则选中首项；随后 `syncMapForm()`。收尾按成败分两路：`cloudRes` / `profRes` 的 `ok !== true` 时把「克隆音色拉取失败（…）」「本地音色映射读取失败（…）」收进 `bad[]`，非空则 `listStatus = '系统音色 N 个 · ' + bad.join('；')` 并置 `hf-error`（源码注释：以前不分成败一律报「克隆音色 0 个」+ 绿灯，于是「云端这次没拉到」和「本地映射丢了」在界面上长得一模一样）；全部成功才写 `listStatus = '系统音色 N 个 · 克隆音色 M 个'`（`hf-ok`）。

**映射保存 / 解除流程**：

1. `syncMapForm()`：`prof = profiles[mapVoice]`、`opt = mapOptions.find((o) => o.value === mapVoice)`；`mapName = prof ? prof.name : ''`（未保存过映射则清空，靠 placeholder 提示默认值）；`mapModel = key` 以 `system:` 开头时**一律取该音色的固定模型**（`opt.model`，忽略本地残留的旧绑定），否则 `prof ? prof.targetModel : (opt ? opt.model : '')`。
2. `onSaveMap()`：`mapVoice` 为空 →「请先选择要管理的音色」；`mapOptions` 找不到对应项则**静默返回**；`name = mapName.trim()`，为空时以 `name: undefined` 提交（= 不设本地显示名、回落默认）；`voiceTools.saveProfile({ key, name, voice, targetModel, type: 'system' | 'custom' })` 成功后用 `res.profiles || {}` **整体覆盖**本地 `profiles`，状态「映射已保存」（有名字时追加「：<名字>」）；失败显示 `res.message || '保存失败'`（`hf-error`）。
3. `onClearMap()`：`mapVoice` 为空 →「请先选择要解除映射的音色」；`voiceTools.deleteProfile(key)` 成功后同样整体覆盖 `profiles`，状态「已解除该音色的本地映射（云端克隆音色本身未删除）」。
4. `editVoice(key)`（点「我的音色」列表里的任意一行，整行 `@click`）：`mapVoice.value = key` → `syncMapForm()` → 取 `(mapVoiceEl.value as { $el?: HTMLElement } | null)?.$el` 并 `scrollIntoView({ behavior: 'smooth', block: 'center' })`，把映射卡的下拉滚到视口中央（HfSelect 是**单根元素组件**，模板 ref 拿到的是组件实例、`$el` 即根 DOM）。

**`onMounted`**：**首句 `void refreshVoiceKeyState()`**（顺带把 `modelTag` 写成厂家目录里的系统合成模型，并决定弹窗里的模型下拉是否可用）；随后 `Promise.all([getConfig().catch(() => null), listModels().catch(() => ({ ok: false, models: [], providers: [] }))])` → `models = mm.models || []`、`providers = mm.providers || []`；`cc` 给的是 `{ ok, active, providers, saveDir }`——`active = cc.active || 第一个厂家的 key`，`vendor = providers` 里匹配 `active` 的那条，**`vcModel` 取该厂家的克隆模型**（模型表里 `role: 'clone'` 的第一个，无厂家目录时回落 `qwen-audio-3.0-tts-flash`）；`applyInputMode(vcModel)` 决定初始 `urlMode`；最后 `loadAll(true)` 静默拉列表与映射。

**调用的 preload**：`voiceTools.getConfig()`、`voiceTools.listModels()`、`voiceTools.pickAudio()`、`voiceTools.create(source, preferredName, targetModel)`、`voiceTools.saveProfile({ key, name, voice, targetModel, type })`、`voiceTools.deleteProfile(key)`、`voiceTools.deleteCloudVoice(voice)`、`voiceTools.listSystemVoices()`、`voiceTools.list()`、`voiceTools.getProfiles()`；另有 `goPage('settings')`（未配置 Key 时）。

**与 helpers 的分工**：本卡从 `./helpers` 取 **5 个成员**（`voiceKeyReady` / `activeProviderLabel` / `refreshVoiceKeyState` 用于 UI 门控与 `onMounted` 刷新，**`readActiveCfg` 用于卡内配置校验**，`activeTtsTab` 用于 `watch`），**不使用** `voiceGroups` / `modelTag` / `cfgSaveDir` / `ttsResultShown`；它的音色候选与合成卡、对齐卡的 `voiceGroups` 仍是两套独立数据（本卡展示系统音色的完整描述 + 本地映射并支持改名/改模型，`voiceGroups` 只服务于合成选择）。**卡内 `requireCfg` 不再是「自己解析配置形状」的拷贝**：它只调 `readActiveCfg()` 再判 `apiKey`（源码注释点名：以前那份本地拷贝读的是旧字段 `c.apiKey`，重构后恒为 undefined，导致点「选择音频文件」/「创建音色」直接跳去设置页）。

## 6. TextTtsPage/helpers.ts（共享助手）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VoiceOption` | `interface` | `value: string`（音色 id；**字段名刻意与 `HfSelectOption` 对齐**，直接绑 `:groups` 即可）、`label: string`（已拼好的展示文案）、`model: string`（绑定模型，可能 `''`） |
| `VoiceOptionGroup` | `interface` | `label: string`、`options: VoiceOption[]`（结构上即 `HfSelect` 的 `HfSelectGroup`） |
| `cfgSaveDir` | `Ref<string>`（初值 `''`） | 已持久化的自定义保存目录 |
| `voiceGroups` | `Ref<VoiceOptionGroup[]>`（初值 `[]`） | 音色下拉分组数据，合成卡与对齐卡共用；两卡把它**原样**交给 `HfSelect`（选项的 `value` / `label` 键已满足该组件契约） |
| `modelTag` | `Ref<string>`（初值 `'qwen3-tts-flash'`） | 合成卡说明里展示的「系统音色固定使用的模型」；由 `refreshVoiceKeyState()` 从厂家目录的 `providers[active].defaultModel` 写入（**不再由 `requireCfg` 写**） |
| `ttsResultShown` | `Ref<boolean>`（初值 `false`） | 合成结果卡可见标记，由 `TextTtsPage/index.vue` 复位 |
| `voiceKeyReady` | `Ref<boolean>`（初值 `false`） | **当前厂家的 API Key 是否已配置**：三张卡据此 `:disabled` 音色/模型下拉并显示说明行（见 §1 的「UI 门控」） |
| `activeProviderLabel` | `Ref<string>`（初值 `''`） | 当前厂家的展示名（取自厂家目录 `providers[].label`），用于未就绪文案与提示 |
| `ActiveVoiceCfg` | `interface` | `{ ok, provider, apiKey, saveDir }`——**当前生效厂家的配置形状**（`readActiveCfg` 的返回类型） |
| `activeTtsTab` | `Ref<'synth' \| 'align' \| 'voice'>`（初值 `'synth'`） | **父页与三张卡共用的当前 Tab**（模块级 ref）：父页写、三卡 `watch` 读；注释说明「三个 Tab 是 `v-show` 切换、组件不重新挂载，所以各卡 watch 它、轮到自己显示时重拉自己的列表」 |
| `readActiveCfg()` | `async () => Promise<ActiveVoiceCfg \| null>` | **配置形状的唯一读取入口**：内部 `voiceTools.getConfig()`，`provider = c.active \|\| 'qwen'`、`apiKey = c.providers[provider].apiKey`、`saveDir = c.saveDir`；异常 / `!ok` 返回 `null`。源码注释明确「**别再在别处自己拼这个形状**」（点名 VoiceSection 那份漏改的本地拷贝就是反例） |
| `refreshVoiceKeyState()` | `async () => Promise<void>` | 走 `readActiveCfg()` + `voice:list-models`：按 `provider` 判定 `voiceKeyReady`（该厂家 `apiKey` 非空）并写 `activeProviderLabel`（label 取自厂家目录，拿不到就用 key）；三张卡的 `onMounted` 首句都调它（`void refreshVoiceKeyState()`） |
| `setCfgSaveDir` | `(v: string) => void` | 写 `cfgSaveDir.value` |
| `requireCfg` | `async (onError) => Promise<{ ok; apiKey?; targetModel?; saveDir?; provider? } \| null>` | 配置校验 + 状态同步（**按厂家**，见下） |
| `loadVoices` | `async (onStatus) => Promise<void>` | 统一音色加载入口（主路径 + 回退） |
| `voiceModelOf` | `(voiceId: string) => string` | 双重 `for` + `options.find`，命中返回 `o.model`（可能 `''`），未命中返回 `''` |
| `firstVoiceId` | `() => string` | 取第一个 `options[0].value` 非空的分组的该 id，全空返回 `''`（与原 `sel.selectedIndex = 0` 语义一致） |
| `loadVoicesFallback` | 非导出 `async (onStatus) => Promise<void>` | `listAll` 不可用/无数据时的旧组装路径，仅模块内被 `loadVoices` 调用 |

- **`requireCfg` 细节（按厂家）**：**统一走 `readActiveCfg()`**（源码注释：配置形状只在那一个地方解析）；拿到 `null` 或 `!cfg.apiKey` 时把 `voiceKeyReady` 置假、`onError('尚未配置「' + (activeProviderLabel || provider) + '」的语音 API Key，请先到「设置」-「语音服务」填写并保存', 'hf-error')` + `configPrompt.open('尚未配置「' + (activeProviderLabel.value || c.provider) + '」的语音 API Key，请先到「设置 → 语音服务」填写并保存', 'voice', true)` + 返回 `null`（**2026-10 改：不再直接 `goPage('settings')` 把用户从配音页拽走**——先弹「去设置 / 取消」框说明原因，`jump = true` 保持「确认后就去设置」的旧效率，因此 `goPage` 的 import 已从 helpers 删除；读配置失败那一支同法，文案为「读取语音配置失败，请到「设置 → 语音服务」检查」）；正常时把 `voiceKeyReady` 置真、`cfgSaveDir.value = String(cfg.saveDir || '').trim()`，并返回 **`{ ok: true, apiKey, saveDir, provider }`**——**不再返回 `targetModel`**（模型不再是可配置项，`modelTag` 由 `refreshVoiceKeyState()` 从厂家目录写）。
- **`refreshVoiceKeyState()`（UI 门控的数据源）**：并行 `voiceTools.getConfig()` + `voiceTools.listModels()`，按 `active` 厂家从厂家目录取 `label`（拿不到就用厂家 key）写 `activeProviderLabel`，并按该厂家已保存的 `apiKey` 写 `voiceKeyReady`；任何一步失败都按「未就绪」处理。它只读配置、不改任何状态，因此可以直接 `void` 调用。
- **`loadVoices` 主路径**：先 `onStatus('加载音色列表…', '')`；`voiceTools.listAll()` 取 `all.ok && Array.isArray(all.voices)` 的 `items`，为空转 `loadVoicesFallback` 后返回；否则遍历构造 `VoiceOption`（`value: it.voiceId || ''`、`model: it.model || ''`），`it.type === 'custom'` → `label = it.name + '（' + (it.model || '') + '）'` 归自定义组，否则 → `label = it.name + ' — ' + it.voiceId + '（' + (it.model || '') + '）'` 归系统组；`voiceGroups.value = [系统音色（内置）, 自定义音色（我的克隆）].filter((g) => g.options.length)`（**空组被过滤**）；末尾 `onStatus('已加载：系统音色 N 个，自定义音色 M 个。选中音色将使用其绑定的模型合成。', 'hf-ok')`，无音色为 `'音色列表为空'`。
- **`loadVoicesFallback` 回退路径**：顺序调用 `listSystemVoices()`、`list()`、`getProfiles()`（各自 `.catch` 成 `{ ok: false, ... }` 安全值）；系统音色 key `'system:' + v.voice`，label 为 `pName(...) + ' — ' + v.voice + '（' + pModel(..., v.model || '') + '）'`；自定义音色 key `'custom:' + v.voice`，模型取 `v.target_model || ''`；**即使某组为空也保留分组**并插入占位项（`value: ''`，系统组「（系统音色加载失败）」、自定义组 `res.message || '拉取自定义音色失败'`）；状态文案与主路径一致。
- **切 Tab 信号已删除**（源码注释要点）：`voiceTabRequest` / `requestVoiceTab` 随合成卡的「管理音色」按钮一起下线——现在切「音色管理」Tab 只有本页 Tab 按钮一个入口，不需要跨组件信号，也不再需要「watch 信号 → 落 Tab」的机制。

## 7. 依赖与协作

| 文件 | import 清单 |
| --- | --- |
| `TextTtsPage/index.vue` | `vue`：`onMounted`、`ref`（**无 `watch`**）；`./helpers`：`ttsResultShown`；`@renderer/components/StepBar.vue`；`./SynthSection.vue`；`./AlignSection.vue`；`./VoiceSection.vue` |
| `TextTtsPage/SynthSection.vue` | `vue`：`computed`、`onMounted`、`ref`、**`watch`**；`@renderer/composables/useAppStore`：`appState`、`refreshProject`（**不再导入 `activeMenu`**）；`@renderer/composables/useToast`：`toast`；`@renderer/utils/rate`：`applyRate`、`stepRate`；`@renderer/pages`：`goPage`（`goSettingsVoice()` 里用）；`@renderer/composables/useNavIntent`：`requestSettingsSection`；`@renderer/components/HfSelect.vue`：默认导出 + 类型 `HfSelectGroup`、`HfSelectOption`；`./helpers`：**13 个成员**（含 `activeTtsTab`） |
| `TextTtsPage/AlignSection.vue` | `vue`：`computed`、`onMounted`、`ref`、**`watch`**；`@renderer/composables/useAppStore`：`appState`、`refreshProject`；`@renderer/composables/useToast`：`toast`；`@renderer/utils/escape`：`escTxt`；`@renderer/utils/time`：`fmtTime`、`fmtTimeMs`；`@renderer/pages`：`goPage`；`@renderer/composables/useNavIntent`：`requestSettingsSection`；`@renderer/components/HfSelect.vue`：默认导出 + 类型 `HfSelectGroup`；`./helpers`：**9 个成员**（含 `activeTtsTab`） |
| `TextTtsPage/VoiceSection.vue` | `vue`：`computed`、`onMounted`、`ref`、**`watch`**；`@renderer/pages`：`goPage`；`@renderer/utils/escape`：`escTxt`；`@renderer/composables/useToast`：`toast`（删云端成功后提示）；`@renderer/composables/useNavIntent`：`requestSettingsSection`；`@renderer/components/HfSelect.vue`：默认导出 + 类型 `HfSelectGroup`；`./helpers`：**5 个**（`activeTtsTab`、`activeProviderLabel`、`readActiveCfg`、`refreshVoiceKeyState`、`voiceKeyReady`） |
| `TextTtsPage/helpers.ts` | `vue`：`ref`；`@renderer/pages`：`goPage`（用于跳 `'settings'`） |

- **`appState` 用到的字段**：`myProjects`、`currentName`、`project.subtitle` / `project.subtitleCount` / `project.content.scenes`。`SynthSection` **不再读 `activeMenu`**（那是 `onManageVoice` 专用的判断，随按钮一起删除）；`VoiceSection` 不读 `appState`（只依赖 `goPage`、`voiceTools` 与 `./helpers` 的 Key 状态成员）。
- **上游**：`pages/index.ts` 的页面注册表（key `'text-tts'`）与 `@renderer/components/StepBar.vue`（`PageKey` 序列含该页，内部 `goPage(props.page)` 刷新当前页；原 `'sound-copy'` 键与「配音」节点的 `isPage('sound-copy')` 判定均已删除）；`StepBar` 的 props 为 `defineProps<{ page: PageKey }>()`。
- **下游（本组使用的 composables / utils / 组件 / 页面）**：`@renderer/composables/useAppStore`、`@renderer/composables/useToast`、`@renderer/utils/rate`、`@renderer/utils/escape`、`@renderer/utils/time`、`pages/index.ts` 的 `goPage`、`@renderer/components/HfSelect.vue`（合成卡 3 个、对齐卡 2 个、音色管理卡组 3 个下拉）；跨页跳转目标只剩 `'settings'`（API Key 设置）与 `'text-tts'` 自身。
- **调用的 preload 方法汇总**：

| 命名空间.方法 | 调用方 | 参数 / 用途 |
| --- | --- | --- |
| `voiceTools.getConfig()` | helpers.`requireCfg`、`VoiceSection`（卡内 `requireCfg` 与 `onMounted`） | 读 `ok` / `active` / `providers`（各家 `apiKey`）/ `saveDir` |
| `voiceTools.listAll()` | helpers.`loadVoices` | 主路径，`voices[].type / name / voiceId / model` |
| `voiceTools.listSystemVoices()` / `voiceTools.list()` / `voiceTools.getProfiles()` | helpers.`loadVoicesFallback`、`VoiceSection.loadAll` | 回退路径 / 音色管理列表与映射（`voices[].voice / desc / model / target_model`，`profiles` 以 `system:` / `custom:` 前缀为键） |
| `voiceTools.listModels()` | `VoiceSection.onMounted` | 模型下拉数据（`models[].id / label / role / input / isDefault`）**+ 厂家目录 `providers`** |
| `voiceTools.pickAudio()` | `VoiceSection.onPick` | 无参，选本地音频文件（返回路径字符串或 `null`；主进程的对话框已扩到 ffmpeg 能解码的音视频格式） |
| `voiceTools.create(source, preferredName, targetModel)` | `VoiceSection.onCreate` | 创建克隆音色：`source = remote \|\| audioPath \|\| ''`（Qwen-Audio-TTS 系列填了 URL 就用 URL，否则用本地路径；主进程也接受 `oss://` 与 `data:audio/...` URI）；`preferredName = genAsciiName(name)`（固定 10 位上限） |
| `voiceTools.saveProfile({ key, name, voice, targetModel, type })` | `VoiceSection.onCreate`（成功后自动）/ `VoiceSection.onSaveMap` | 写本机映射（中文显示名 + 合成模型） |
| `voiceTools.deleteProfile(key)` | `VoiceSection.onClearMap` | 解除本机映射（不删除云端克隆音色） |
| `voiceTools.deleteCloudVoice(voice)` | `VoiceSection.onDeleteCloud` | **删除云端克隆音色**（载荷 `{ voice }`，不可撤销）；成功后主进程一并清掉该音色的本地映射并回带最新映射表 |
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

- **路由跳转**：`goPage('settings')`（**语音服务设置**：`SynthSection.goSettingsVoice()` 与 `VoiceSection.goSettingsVoice()` 都先 `requestSettingsSection('voice')` 再跳，`AlignSection` 的卡内校验也会跳）与 `goPage('text-tts')`（仅 `SynthSection` 跨页时用）；原 `goPage('sound-copy')` 已随独立页删除全部移除。**注意 `helpers.requireCfg()` 自 2026-10 起不直接跳页**：它改为 `configPrompt.open(文案, 'voice', true)`（`jump = true`，用户在弹窗里点「去设置」才跳），因此 `goPage` 的 import 已从 helpers 删除。
- **桥接层对应关系**：以上方法都由 `src/preload/index.ts` 的 `voiceTools` / `projectTools` 命名空间暴露；渲染层 `voiceTools.saveConfig({ saveDir })` 对应 preload 的 `saveConfig(payload)`（**直接透传** `VoiceSaveConfigPayload` 到 `IPC.Voice.SaveConfig`，不再包 `{ voiceTTS }`；主进程仍兼容历史 `{ voiceTTS }` / 裸 `{ apiKey, targetModel }` 形态），`synth` 的 7 个位置参数在 preload 内转为 `{ text, voice, projectName, saveDir, targetModel, audioName, defaultOut }` 对象；`create` 在 preload 内包成 `{ audioPath, preferredName, targetModel }`——渲染层传下来的 `source` 落在 `audioPath` 字段上，**它承载的是本地路径 / 音频 URL / data URI**（主进程按字符串形态分流）；`cancelAlign` 用 `ipcRenderer.send`，其余为 `invoke`；`onAlignProgress` 在 preload 内维护单例回调（重复注册仅替换、首次注册才 `ipcRenderer.on`）。
- **HfSelect 依赖**：本页三张卡的 8 个下拉全部由 `@renderer/components/HfSelect.vue` 承担（合成卡：音色 / 保存到 / 已生成音频；对齐卡：字幕来源 / 音色；音色管理：目标模型 / 映射音色 / 合成模型）；`@change` 回调收到的是**新值字符串**而非 DOM Event，且只在用户选中不同选项时触发。
- **helpers 命名导出全清单（14 个）**：`VoiceOption`、`VoiceOptionGroup`、`cfgSaveDir`、`voiceGroups`、`modelTag`、`ttsResultShown`、`voiceKeyReady`、`activeProviderLabel`、`setCfgSaveDir`、`refreshVoiceKeyState`、`requireCfg`、`loadVoices`、`voiceModelOf`、`firstVoiceId`；`loadVoicesFallback` 不导出。（原 `voiceTabRequest` / `requestVoiceTab` 已删除。）

## 8. 注意事项与实现要点

1. **`v-show` 而非 `v-if`**：三卡始终挂载、切 Tab 不销毁重建，因此进入页面时三卡的配置/数据加载都会执行，且切 Tab 保留卡内状态（合成文本、已选音色、创建表单等）——有意为之，切回不必重新填表。
2. **共享状态是模块级单例**：`voiceGroups`、`cfgSaveDir`、`modelTag` 跨页面切换保留，直到下次 `requireCfg` / `loadVoices` 覆盖；只有 `ttsResultShown` 被 `TextTtsPage/index.vue` 在 `onMounted` 显式复位，所以「合成结果」卡仅在本次停留页面期间可见。`SynthSection` 内部置 `true` 后不会自行置回 `false`。
3. **切「音色管理」Tab 只剩 Tab 按钮一个入口**：合成卡上的「管理音色」按钮与 helpers 的切 Tab 信号（`voiceTabRequest` / `requestVoiceTab`）都已删除，外壳 `index.vue` 不再 `watch` 信号；要切 Tab 只能点本页顶部那个 Tab 按钮（三卡常驻，切 Tab 不会重挂载、不丢已填内容）。
4. **HfSelect 取代原生 `<select>`**：`@change` 直接给**新值字符串**（`(value: string) => void`，不是 DOM Event），且 `pick()` 在选中项与当前值相同时**提前返回、不发 `change`**；程序化改值（如 `onSaveToChange` 里取消选目录后 `saveTo.value = lastSaveTo.value`）只走 `update:modelValue`、不触发 `@change`——取消回退不会递归。之所以自绘：原生 `<option>` 弹层由浏览器绘制，行高/间距/选中态无法用 CSS 控制，深色主题下选项挤在一起、选中态看不出。
5. **下拉数据的形状契约**：`HfSelect` 的 `groups` 契约为 `{ label: string; options: { value: string; label: string }[] }[]`，取值/比较/回传**只认 `value`**。因此本页所有下拉数据都按该契约构造：`voiceGroups`、`saveToGroups`、`genSelectGroups`（`value` 为全局下标字符串）、`subSrcGroups`、`mapGroups` / `modelGroups` / `cloneModelGroups`（后两者由 `buildModelGroups()` **按厂家**分组生成）。**改 `VoiceOption` 字段名时必须同步 `value`**：HfSelect 不会读 `voiceId` 之类的别名，否则触发器恒显示 `placeholder`、点选回传 `undefined`。
6. **空列表不再有占位 option**：已生成音频列表为空时，`genSelectGroups` 返回空数组、由 HfSelect 的 `empty-text="（暂无已生成音频）"` 展示提示；触发器文案在无匹配项时回落 `placeholder`（默认「请选择…」）。
7. **模型跟随音色（且系统音色是固定的）**：合成模型取 `voiceModelOf(voiceId)`；系统音色在厂家目录里就是固定的 `role: 'system'` 模型（合成卡说明里的 `modelTag` 显示它），克隆音色用它创建/映射时绑定的模型；`voiceModelOf` 返回 `''` 是"该音色没有绑定模型"而非错误，由主进程按厂家目录兜底。**本地映射若绑着已不在目录里的模型会被忽略**（主进程 `modelKnownFor` 校验），因此不会因为历史绑定而必然 404。
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
21. **回退路径不抛异常**：helpers 内所有 IPC 都带 `.catch(() => ...)` 安全值，音色加载失败不中断页面，仅在下拉里出现 `voiceId === ''` 的占位项。`VoiceSection` 的三个 `Promise.all` 成员同样各自 `.catch(fail)` 成 `{ ok: false, message }`：系统音色这一路失败按空列表继续，克隆音色 / 本地映射两路失败则把状态行置为 `hf-error` 并写明是哪一路失败（见第 32 条）。
22. **分组顺序固定**：系统音色（内置）在前、自定义音色（我的克隆）在后；`firstVoiceId()` 只检查每组第一个选项，若它 `voiceId` 为空才跳到下一组。`mapGroups` 同序且过滤空组。
23. **状态文案**：合成卡 / 对齐卡共用 `'已加载：系统音色 N 个，自定义音色 M 个。选中音色将使用其绑定的模型合成。'`；音色管理卡用的是另一套 `'系统音色 N 个 · 克隆音色 M 个'`，改动需注意各自实现。
24. **`activeTtsTab` 是三值字符串字面量联合**（`'synth' | 'align' | 'voice'`，定义在 `helpers.ts`、**父页与三卡共用**），Tab 按钮的 `data-tab` 仅作样式/调试锚点；新增 Tab 必须同时处理类型联合、`v-show` 条件与**各卡的 `watch(activeTtsTab)` 分支**——**不再需要任何「外部触发切 Tab」的信号分支**。
25. **切 Tab 自动刷新各卡列表**：三卡是 `v-show` 切换、组件不重挂载，音色下拉原本只在页面挂载或点「刷新」时拉一次，于是「在音色管理里新建音色 → 切回文字生音频」看不到新音色。现在三卡都 `watch(activeTtsTab)`，轮到自己时重拉：`SynthSection` 在 `t === 'synth'` 时先 `await refreshVoiceKeyState()`（用户可能刚在设置页存完 Key）→ **`!voiceKeyReady` 直接 return** → `await loadVoices(setStatus)` → 若当前 `voiceId` 已不在新列表里则回落到 `firstVoiceId()`；`AlignSection` 同款（条件 `t === 'align'`）；`VoiceSection` 在 `t === 'voice'` 时 `void refreshVoiceKeyState()` + `void loadAll(true)`（静默重拉系统音色 + 云端克隆音色 + 本地映射）。
26. **`onLoadNarration` 空旁白**处理：报错文案为「当前项目无内容脚本（或场景无旁白），请先到「内容脚本」页编写」，成功则提示「已载入 N 段旁白（每场景一段、空行分隔），可继续手动编辑」。
27. **`onGenPlay` 空源守卫**：`genAudioEl` 或 `genAudioSrc` 为空时 toast「请先选择已生成音频」，不改变试听行显隐。
28. **云端音色名必须是 ASCII，上限统一 10 位**：创建时提交的是 `genAsciiName(vcName)`（默认 `max = CLONE_PREFIX_MAX = 10`）——只保留 `[A-Za-z0-9_]`，中文名被剔空时用 `myvoice` + 时间戳后 8 位兜底，**截断到 10 位**（与主进程 `CLONE_PREFIX_MAX = 10` 一致，超长会被主进程以「音色名称需 1~10 个字符…」拒绝）；中文名只通过 `saveProfile` 作为本地显示名；因此「显示名称」同名多次创建会得到不同的云端 `voice` id。**原 `cloneNameMax(audioSeries)`（audio 10 / 其余 16）已删除。**
29. **本地文件行常显，URL 行只在 `qwen-audio-*` 时出现**：`applyInputMode` 用 `/^qwen-audio-.*-tts/i` 判定——选 `qwen-audio-3.0-tts-flash` 时显示 URL 输入行（label「或音频 URL」），**本地文件行始终在**；目录里已经没有别的 clone 模型可选项（vc 系列与那条 clone 的 `qwen3-tts-flash` 都已删除），所以非 audio 模型只会来自「映射管理」的历史绑定。两者都填时 `onCreate` 用 `remote = urlMode ? vcUrl.trim() : ''`、`source = remote || audioPath` ——**URL 优先**。主进程 `isAudioTtsModel()` 用**同一正则**作「能不能作复刻目标模型」的唯一判据：为假时 `voice:create` 直接返回「模型「<id>」不支持音色复刻…」；为真时走 `enrollModel`（`voice-enrollment`）+ `input.url`（本地文件会被裁成 15 秒 wav 并转 data URI），**不再有 `audio.data` / 16 位名称 / 10 MB 守卫等 vc 分支**。`vcModel` 初值取**当前厂家**的克隆模型（`role: 'clone'` 的第一个，无厂家目录时回落 `qwen-audio-3.0-tts-flash`）。
30. **映射是本地概念**：`saveProfile` / `deleteProfile` 只改本机 `settings.json`（`profiles` 由主进程整体返回并**整体覆盖**本地缓存），`onClearMap` 不删除云端克隆音色（提示文案已说明）；`syncMapForm` 对未映射项清空显示名、预填默认模型。
31. **三张卡都没有组件级 `<style>`**：`VoiceSection` 的「我的音色」列表已改为消费 `main.css` 的 `.panel-head*` / `.voice-list*` / `.voice-*`，模板里不再有那张行内 grid 样式；所有下拉的视觉（含弹层）由 `HfSelect` 自己负责（`.hf-sel*` 类前缀），页面不再依赖 `main.css` 里的 `.hf-select` / `.hgen-select`（已删除）。
32. **「我的音色」列表：刷新按钮上移 + 防连点 + 失败显式说出来**：刷新按钮从列表下方的 `.hgen-actions` 移到头行 `.panel-head-actions`（`:disabled="listBusy"`、文案「刷新中…」），因为列表内部会滚动、按钮留在底部等于逼用户先滚到底；`loadAll()` 用 `listBusy` 守卫（`if (listBusy.value) return` + `try/finally` 复位）避免连点把状态行互相盖掉；收尾用 `bad[]` 把「克隆音色拉取失败」「本地音色映射读取失败」写成 `hf-error` 状态文案，不再把失败伪装成「0 个」的成功态。
33. **「删云端」与「解除映射」是两件事**：列表行尾的「删云端」（仅克隆音色可见、`.hf-btn-danger` + `@click.stop`）调 `voiceTools.deleteCloudVoice(voice)`，走 `voice:delete-cloud` 删**云端**音色（不可撤销，主进程用两种接口写法依序回退，见 [main/voice.ts.md](../../../main/voice.ts.md) §4.6），成功后一并清掉本地映射并 `toast` + `loadAll(true)`，失败把 message 写进列表状态行；而「音色映射管理」卡的「解除映射」只删本地映射、**不碰云端**。
34. **列表不再显示音色 ID**：表头与 `.voice-id` 单元格、以及 `main.css` 的 `.voice-id` 规则都已删除，网格随之从 5 列改为 4 列（`minmax(0,1.6fr) minmax(0,1.4fr) minmax(0,1fr) auto`）；没有中文名的克隆音色用「未命名克隆音色」兜底，靠「创建时间」列区分，映射下拉的标签同样不再拼 ID（改用「未命名克隆音色 · 月-日 时:分」）。
35. **「配置形状」只能有一个读取入口**：`voice:get-config` 从「单厂家 `{ apiKey, targetModel }`」改成「按厂家 `{ active, providers, saveDir }`」后，`VoiceSection.vue` 里那份**自己解析形状的 `requireCfg` 拷贝**没跟着改——它读旧字段 `c.apiKey`，于是 `!c.apiKey` 永远为真，点「选择音频文件」（`onPick`）或「创建音色」（`onCreate`）会直接写到「尚未配置语音 API Key」并跳去设置页。现在 helpers 提供**唯一入口** `readActiveCfg()`，`refreshVoiceKeyState()` / `requireCfg()` / VoiceSection 的卡内 `requireCfg` 全部走它；源码注释要求**不要在别处再拼这个形状**。
36. **「创建克隆音色」是弹窗、且必须 Teleport 到 body**：卡组只剩「我的音色」与「音色映射管理」两张卡，创建表单改为模板末尾的 `<Teleport to="body">` + `.hf-modal*` 复用（**没有新增任何 CSS**）。源码注释：`.card` 上有 `backdrop-filter`，它会让 `fixed` 定位相对卡片而不是视口（蒙层会被卡片裁住），所以必须挂到 `body`；HfSelect 弹层 `z-index: 9500` 高于蒙层 `9000`，仍浮在弹窗之上。`createBusy` 守卫（开头 `if (createBusy.value) return` + `try/finally`）防止双击建出两个音色（计费 0.01 元/个），成功路径都在 `loadAll(true)` 后 `closeCreate()`。弹窗里的「API Key 设置」与卡内 `requireCfg()` 未配 Key 时走同一条「带意图跳转」：`requestSettingsSection('voice')` + `goPage('settings')`，让设置页直接落在「语音服务」分类。**删除云端的那张确认弹窗同法**（`Teleport` + `.hf-modal*`，520px，`deleteBusy` 期间不许关）。

## 9. 运行环境缺包守卫（`useEnvGate`）

`voice:synth-aligned`（逐句对齐配音）整条链路都要 ffmpeg / ffprobe——试听分段、句间静音、`concat -c copy` 装配整轨、末尾时长终验全走它们；而 **ffmpeg 不随安装包**（ffmpeg 运行环境包，实测 **42.6 MB**，2026-10-14；首次用到时下载，见 `docs/runtime-pack-split.md`）。

- `AlignSection.vue` 的 `startAlign(skipEnvGuard)`：动手前 `const g = await envGate.guard(['ffmpeg'], '逐句对齐配音', () => { void startAlign(true) })`，`!g.ok`（缺包已弹框或用户取消）就 `return`，**不发 IPC、不产生下载**；
- **失败分支先判配置类、再判缺包（2026-10 新增）**：`AlignSection.startAlign()` 里写成 `if (configPrompt.fromResult(fail)) { /* 已弹「去设置」，不再叠 toast */ } else if (fail.needPacks && fail.needPacks.length) { envGate.guard(...) } else { toast(msg) }`；同样地 `SynthSection.onSynth()`、`VoiceSection.onCreate()` / `onDeleteCloud()` 的失败分支各加一行 `configPrompt.fromResult(res)`（返回布尔：已弹框就不再 toast，状态行照旧显示原因）。分类来自主进程 `needConfig`（渲染层不猜），**余额 / 欠费不弹窗**。
- 主进程返回 `fail.needPacks` 时再 `envGate.guard(fail.needPacks, '逐句对齐配音', …)` 一次；
- 用户在确认框点「继续」时，`onContinue` 以 `skipEnvGuard = true` 重发本次对齐（**不自动续做**）；
- 确认框由 `App.vue` 内联渲染（`useEnvGate` 是模块级单例，见 [common.md](../common.md) §4.2），本卡只调 `guard()`；**取消下载 = 取消这次对齐**，主进程不留半截状态。
