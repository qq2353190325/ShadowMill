# src/renderer/src/pages/ContentPage/（页面）

> 内容脚本页：**「场景编辑」+「AI 创作」两个 Tab**——前者手工编辑场景分镜，后者对话式让模型生成 / 修改同一份 `scenes`；**编辑即自动保存**（没有「保存到项目」按钮），AI 的产出与手工改动走同一条写盘通道。**对话记录改成「索引 + 每版副本」**：索引只存元数据，每版脚本单独一份副本，展开 / 应用时才读。

- **覆盖文件**：`ContentPage/` 目录**共 5 个文件**——`index.vue`（35 行）、`SceneEditor.vue`（74 行）、`AiChatPanel.vue`（373 行）、`ScriptRoundCard.vue`（139 行）、`helpers.ts`（271 行）
- **所在目录**：`src/renderer/src/pages/ContentPage/`
- **类型**：页面组件（外壳 + 2 个 Tab 组件 + 1 个子组件 + 共享助手）
- **规模**：合计 **892 行**
- **对外导出**：`index.vue` 默认导出页面组件（无 props）；`helpers.ts` 导出 `scenes` / `dirty` / `saveState` / `lastSavedAt` / `saveError` / `type SaveState` / `loadScenes` / `emptyScene` / `addScene` / `removeScene` / `moveScene` / `applyScenes` / `scheduleSave` / `flushSave` / `flushPending` / **`chatError`** / `interface ChatIndexState` / **`loadChatIndex` / `appendChatRound` / `readChatVersion` / `setActiveChatVersion` / `clearChatRecords`**

## 1. 作用与职责

本页编辑当前项目的 `content`（磁盘上是 `content.json`，`{ style, scenes }`）：**场景列表的编辑与自动保存**，以及**让自定义模型基于当前场景生成 / 修改脚本**；两者共用 `helpers.ts` 的同一份模块级状态。

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.vue` | 35 | **外壳**：`StepBar` + `.hf-tabs` 两个 Tab（**默认「场景编辑」，空项目也一样**）+ 用 `v-show` 挂载 `SceneEditor` / `AiChatPanel`；`onMounted(loadScenes)`、**`onBeforeUnmount(flushPending)`** |
| `SceneEditor.vue` | 74 | **「场景编辑」Tab**：场景卡（旁白 / 画面分镜 / 时长提示 + 增删排序）+ **一行自动保存状态**（`保存中…` / `已自动保存 HH:mm:ss` / `保存失败：原因` + 「重试」）。**没有「保存到项目」按钮，也没有「● 有未保存改动」**；**画面分镜输入框随内容自动长高**（`field-sizing: content`，默认两行字高度、`max-height: 260px` 后内部滚动） |
| `AiChatPanel.vue` | 373 | **「AI 创作」Tab**：需求输入（**Ctrl+Enter 发送**）、**标题下方一行「本轮上下文提示」（`.hgen-tip` + `contextHint`，本轮新增）**、场景数 / 目标时长、流式状态行、思考过程折叠、错误 + 模型原文折叠、**顶部红字 `chatError`**、`ScriptRoundCard` 列表；**挂载时只读索引**、**生成成功后追加一版（主进程写副本 + 更新索引）**、**展开时才读副本（懒加载 + `versionCache`）**、**「应用此版本」**、标题栏旁「清空对话」 |
| `ScriptRoundCard.vue` | 139 | **单轮结果卡**：第 N 版 · 场景数 · 字数 · 估算时长 · 展开预览（`scenes` 由父组件懒加载后传入，`null` = 正在读）· **「应用此版本」**（`applying` 时显示「应用中…」）；轮次类型是共享层的 `ScriptChatRoundMeta` |
| `helpers.ts` | 271 | **模块级共享状态与两套逻辑**：`scenes` / `dirty` + **自动保存调度**（快照 / 防抖 600ms / 串行队列 / 失败可重试）+ **对话记录读写**（`loadChatIndex` / `appendChatRound` / `readChatVersion` / `setActiveChatVersion` / `clearChatRecords`，失败一律写进可见的 `chatError`）；**所有发往 IPC 的 scenes 先经 `plainScenes()` 转普通对象**；**已无 `saveScenes`**，也没有「保存到项目」的入口 |

为什么拆成 5 个文件：两个 Tab 必须看到**同一份 `scenes`**（AI 读编辑器内容、写回同一份数组），所以状态与逻辑收进 `helpers.ts` 的模块级单例，三个 `.vue` 只负责渲染与交互。这是本仓库 `TextTtsPage` / `SubtitlePage` 已有的 helpers 约定。

**行为总纲**（六条，全部由代码落实）：

1. **编辑即自动保存**：字段改动（`deep watch`）、增删排序、AI 写回，都会在 **600 ms 防抖**后写 `content.json`——界面没有手动保存入口。
2. **AI 的上下文 = 编辑器当前 `scenes`**（`AiChatPanel` 提交时 `scenes.value.map((s) => ({ ...s }))`，含还没写盘的改动）。
3. **AI 的结果自动写回编辑器**（`applyScenes(res.scenes)`），随后**走同一条自动保存**落盘。
4. **对话记录按项目持久化**：`projects/<项目名>/chat/index.json`（每轮元数据 + `activeVersionId`，**不含 scenes**）+ `projects/<项目名>/chat/versions/<id>.json`（每版脚本副本）；进页面只读索引、展开 / 应用时才读副本、可一键清空（删整个 `chat/`）。
5. **保存状态对用户可见**：`saveState`（`idle` / `saving` / `saved` / `error`）+ `lastSavedAt` + `saveError`，失败时状态行变红并给「重试」按钮；**对话记录的失败同样可见**（`chatError` 红字 + toast），不再只 `console.warn`。
6. **切页只冲刷「确有未写快照」的改动**：`flushPending()` 在没有排队快照时**什么都不做**——否则切项目时 `appState.currentName` 已是新项目、`scenes` 还是旧项目的，会写串。

## 2. 模板结构

### 2.1 `index.vue`（外壳）

| 区块 | 说明 |
|------|------|
| `StepBar :page="'content'"` | 顶部项目链路状态条，高亮「内容脚本」节点 |
| `.hf-tabs` | 两个 `button.hf-tab`：「场景编辑」（`:class="{ active: tab === 'edit' }"`）、「AI 创作」（`tab === 'chat'`） |
| 两个内容区 | `<div v-show="tab === 'edit'"><SceneEditor /></div>`、`<div v-show="tab === 'chat'"><AiChatPanel /></div>`——**用 `v-show` 而非 `v-if`**：切 Tab 不销毁组件，输入框草稿与展开状态都保留 |
| 默认 Tab | `const tab = ref<'edit' \| 'chat'>('edit')`——**空项目也停在「场景编辑」**（用户可以先自己填；AI 是并列 Tab，不是默认路径） |
| 生命周期 | `onMounted(loadScenes)`；**`onBeforeUnmount(flushPending)`**——离开页面时把还在防抖里的改动写掉（只写「确有快照」的，避免切项目写串） |

### 2.2 `SceneEditor.vue`（场景编辑 Tab）

| 区块 | 说明 |
|------|------|
| 卡片标题 | `.panel-title`「场景分镜（旁白 + 画面分镜 + 时长提示）」 |
| 空态 | `v-if="!scenes.length"` 时 `.empty-hint`：「暂无场景。点「添加场景」自己写；也可以切到「AI 创作」让 AI 写一版。」 |
| 场景块 | `v-for="(s, i) in scenes"` :key 为 `s.id`，`.hgen-block.ct-scene`（行内 style 给边框 / 圆角 / 内边距 / 背景）；标题 `场景 #{{ i + 1 }}` |
| 三个字段 | 旁白 `<textarea v-model="s.narration">`（84px）、画面分镜 `<textarea v-model="s.visual">`（**随内容自动长高**：`field-sizing: content`，默认两行字高度、`max-height: 260px` 后内部滚动，无固定高度）、时长提示 `<input v-model="s.durHint">`（110px，placeholder「可空」） |
| 行内操作 | 「上移」（`i === 0` 禁用）/「下移」（`i === scenes.length - 1` 禁用）/「删除」 |
| 底部动作 | `.hgen-actions`：「添加场景」+ **`<span class="ct-save" :class="'is-' + saveState">{{ saveText }}</span>`** + **`v-if="saveState === 'error'"` 时的「重试」按钮（`@click="flushSave"`）** |
| 底部说明 | `hgen-tip`：场景按顺序播放，`旁白` 作配音文本并派生字幕、`画面分镜` 供 HTML 生成引用、`时长提示` 可空；**「改动会自动保存到项目，无需手动保存」** |

`saveText` 是唯一的展示逻辑（computed）：

```ts
if (saveState.value === 'saving') return '保存中…';
if (saveState.value === 'error') return '保存失败：' + (saveError.value || '未知原因');
if (saveState.value === 'saved') return '已自动保存 ' + lastSavedAt.value;
return '编辑即自动保存';
```

`.ct-visual` 是画面分镜输入框的规则：`height: auto`（把 `.hgen-subtitle` 的固定 260px 压回去）+ `field-sizing: content`（跟着内容长高）+ `min-height: calc(2 * 1.7em + 30px)`（两行字，line-height 1.7）+ `max-height: 260px`（到顶后内部滚动）+ `resize: none`（手动拖拽会让自动长高失效；`field-sizing` 万一不生效则退回 HTML 默认 `rows=2`，同样两行）；`.ct-save` 是 12px 的次要色文字；`.is-saved` 用 `--color-success`、`.is-error` 用 `--color-danger`（本文件带 `<style scoped>`；本页 5 个文件里只有它、`AiChatPanel.vue`、`ScriptRoundCard.vue` 有样式块，`index.vue` 与 `helpers.ts` 没有）。

> 与早前版本相比**删掉了两样东西**：主按钮「保存到项目」（连同它的 `saving` 防重入）与 `<span v-if="dirty">● 有未保存改动</span>`。它们描述的是「草稿 vs 已保存」两态，而自动保存之后这个两态不再存在——现在只有一条状态行，成功时显示落盘时刻。

### 2.3 `AiChatPanel.vue`（AI 创作 Tab）

| 区块 | 说明 |
|------|------|
| 卡片标题 | `.panel-title`「AI 创作（对话式生成 / 修改脚本）」 |
| 说明 | `.hgen-tip`：「AI 读的是「场景编辑」里当前的内容：空就从零写，有就按你的要求改。结果写进编辑器并**自动保存**；每版脚本都会存一份副本，切页回来还能展开或重新应用。」 |
| **本轮上下文提示**（本轮新增，紧接说明行、`.ct-list` 之前） | 第二个 `.hgen-tip`：`{{ contextHint }}`——把「这次到底带了哪几场脚本」显式写出来（用户曾反馈「AI 创作好像跟我已有的脚本没关系」）。文案三态：有内容 → 「本轮将附带当前脚本 N 个场景」；`scenes` 超过 `MAX_SCENES`（30）场 → 追加「（每轮最多发送 30 个，其余不发送）」；一场都没有 → 「当前脚本为空：本轮将从零写一版」。**纯展示改动**：复用既有 `.hgen-tip` 样式，没有新增 IPC / 类型 / CSS |
| 结果列表 | `.ct-list`（`ref="listEl"`，`max-height: calc(100vh - 420px)`、`min-height: 200px`、`overflow-y: auto`） |
| 空态 | `v-if="!rounds.length"`：`.ct-empty` 标题「写一句主题，让 AI 写第一版脚本」+ 3 个示例按钮（`EXAMPLES`：`'60 秒讲清什么是大模型幻觉'`、`'3 分钟产品介绍，口吻克制'`、`'把一段技术文档讲成人话，90 秒'`，点击填入输入框） |
| **记录栏** | `v-else` 时标题栏下方 `.ct-log-bar`：「对话记录 **{{ rounds.length }}** 轮（存在项目里的 `chat/` 目录）」+ 右侧「清空对话」按钮（`.ct-mini`） |
| **可见错误** | `v-if="chatError"` 时 `.ct-log-error`（**红字**，`--color-danger`）：「对话记录出错：{{ chatError }}」+「知道了」按钮（`@click="chatError = ''"`）——记录链路任何一步失败都落到这里，不再静默 |
| 轮次卡片 | `v-for="(r, ri) in rounds"` → `<ScriptRoundCard :round="r" :index="ri" :current="r.versionId === activeVersionId" :expanded="expanded === ri" :scenes="expanded === ri ? expandedScenes : null" :applying="applyingId === r.versionId" :chars-per-second="EST_CHARS_PER_SEC" @toggle="toggle(ri)" @apply="applyVersion(ri)" />`——**「当前」= 索引里的 `activeVersionId`**（应用某一版时由主进程改它），不再按内容比对；**语速不再写死在面板里**，`EST_CHARS_PER_SEC` 直接来自 `@shared/constants` |
| 生成中 | `v-if="busy"`：`.hf-status` 状态行（`status`）+ 有思考文本时「查看 / 收起思考过程」按钮 + `<pre class="ct-think">{{ thinkText }}</pre>` |
| 错误 | `v-if="errorMsg"`：`.hf-status.hf-error` 显示 `errorMsg` + 有 `errorRaw` 时「查看 / 展开原文」按钮 + `<pre class="ct-raw">{{ errorRaw }}</pre>` |
| 输入行 | `.ct-input-row`：`<textarea v-model="request">`（84px，placeholder 给两个例子，`@keydown.ctrl.enter="send"`）+ 主按钮「发送」/「生成中…」（`:disabled="busy \|\| !request.trim()"`） |
| 参数行 | `.ct-params`：「场景数」`<input v-model="sceneCount">`（placeholder「自动」）、「目标时长(秒)」`<input v-model="targetSeconds">`（placeholder「不限」）、右侧提示「Ctrl+Enter 发送」 |

### 2.4 `ScriptRoundCard.vue`（单轮结果卡）

| 区块 | 说明 |
|------|------|
| 需求气泡 | `.ct-user`：`round.request`（右对齐、max-width 78%、`white-space: pre-wrap`） |
| 卡头 | 「第 {{ index + 1 }} 版」+ 元信息「`{{ sceneCount }} 个场景 · {{ round.totalChars }} 字 · 约 <fmtTime(...)>`」+ 当前版徽标「当前」（`v-if="current"`） |
| 场景数 | `const sceneCount = computed(() => props.round.sceneCount \|\| (props.scenes ? props.scenes.length : 0))`——索引里有 `sceneCount` 就用它，**不需要先读副本** |
| 估算时长 | `fmtTime(Math.round(round.totalChars / charsPerSecond))`（`fmtTime` 来自 `@renderer/utils/time`）——**只用于显示**；分母是父组件传入的 `charsPerSecond`，即 `@shared/constants` 的 `EST_CHARS_PER_SEC`（4 字/秒），与字幕估时、主进程提示词预算同一口径 |
| 动作 | 「展开 / 收起」（`$emit('toggle')`）+ **非当前版**才显示「应用此版本」（`$emit('apply')`；`applying` 时按钮文案「应用中…」并禁用） |
| 展开预览 | `v-if="expanded"`：`!scenes` 时显示「正在读取这一版…」；读到后逐场景「场景 N」+「旁白」行 +（有 `visual` 时）「画面」行 |
| props | **`round: ScriptChatRoundMeta`**（来自 `@shared/types`）、`index: number`、`current: boolean`、`expanded: boolean`、**`scenes: Scene[] \| null`**（`null` = 正在读 / 还没读，由父组件懒加载后传入）、`charsPerSecond: number`（父组件传入 `@shared/constants` 的 `EST_CHARS_PER_SEC`，仅用于显示）、**`applying: boolean`** |
| emits | `toggle: []`、`apply: []`——**只发事件**，读哪一版 / 写回编辑器 / 改 `activeVersionId` 都由父组件决定 |

> 本卡是**纯展示组件**：不 import 任何 IPC、不碰 `helpers` 的状态。它拿到的 `round` 只有元数据（没有 scenes），展开内容另由 `scenes` prop 传进来——这是「索引不存 scenes」在组件契约上的直接体现。

## 3. 脚本逻辑

### 3.1 共享状态与助手（`helpers.ts`）

| 名称 | 类型 | 说明 |
|------|------|------|
| `scenes` | `ref<Scene[]>` | **模块级单例**，编辑器与 AI 面板共用同一份 |
| `dirty` | `ref<boolean>` | 「还没落盘」标记：任何变更置真、写盘成功复位。**界面已不再消费它**（「● 有未保存改动」已删），保留是因为它是自动保存调度之外唯一能一眼看出「有改动在飞」的状态 |
| `saveState` | `ref<SaveState>` | 自动保存状态：`'idle'`（刚加载）/ `'saving'` / `'saved'` / `'error'` |
| `lastSavedAt` | `ref<string>` | 最近一次成功的时间，`new Date().toLocaleTimeString('zh-CN', { hour12: false })` |
| `saveError` | `ref<string>` | 最近一次失败原因（状态行的「保存失败：…」） |
| `chatError` | `ref<string>` | **对话记录链路的可见错误**：读索引 / 追加一版 / 读副本 / 改 active / 清空，任一失败都写进它（成功则清空）；`AiChatPanel` 顶部红字显示，`send()` / `clearChat()` 还另配 toast |
| `SaveState` | `type` | `'idle' \| 'saving' \| 'saved' \| 'error'` |
| `SAVE_DEBOUNCE_MS` | 模块级 `const`（未导出） | `600` |
| `SaveSnapshot` | `interface`（未导出） | `{ name: string; content: { style: string; scenes: Scene[] } }`——**写入前就定住的快照** |
| `timer` / `saving` / `queued` / `ready` | 模块级变量（未导出） | 防抖计时器 / 是否正在写 / 排队待写的快照 / 加载期静默标志 |
| `newSceneId()` | 函数（未导出） | `'scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)` |
| `snapshot()` | 函数（未导出） | 抓一份**此刻**的快照：项目名 + `{ style: 项目里已落盘的值, scenes: 四字段浅拷贝 }`——之后切项目也不会串 |
| `writeSnapshot(snap)` | 函数（未导出） | 落一份快照：`saveState='saving'` → `saveContent` → 成功置 `saved` / 记录 `lastSavedAt` / `saveError=''` / `dirty=false` / `void refreshProject()`；失败置 `error` 并留 `saveError` |
| `emptyScene()` | 函数 | 生成空场景（`narration` / `visual` / `durHint` 均为 `''`） |
| `loadScenes()` | 函数 | 见 §4.1 |
| `addScene()` / `removeScene(i)` / `moveScene(i, delta)` | 函数 | 增 / 删（删空自动补一个空场景）/ 与相邻项交换（越界直接 return） |
| `applyScenes(next)` | 函数 | 见 §4.2 |
| `scheduleSave()` | 函数 | 见 §4.3（编辑变更入口） |
| `flushSave()` | 函数 | 见 §4.3（立刻写掉排队快照；返回 `Promise<boolean>`） |
| `flushPending()` | 函数 | 见 §4.3（卸载用：**只有确有排队快照才写**） |
| `ChatIndexState` | `interface` | `{ rounds: ScriptChatRoundMeta[]; activeVersionId: string }`——`loadChatIndex()` 的返回形状（**没有 scenes**） |
| `plainScenes(list)` | 函数（未导出） | 把 `Scene[]` 逐项映射成**普通对象**（`{ id, narration, visual, durHint }`）——Vue 的响应式 `Proxy` 过不了结构化克隆，**所有发往 IPC 的 scenes 必须先过它** |
| `loadChatIndex()` | 函数 | 见 §4.4（只读索引） |
| `appendChatRound(meta, scenes)` | 函数 | 见 §4.4（追加一版；返回 `versionId`，失败返回空串） |
| `readChatVersion(versionId)` | 函数 | 见 §4.4（读某一版副本；读不到返回 `null`） |
| `setActiveChatVersion(versionId)` | 函数 | 见 §4.4（把某一版记为「当前应用」） |
| `clearChatRecords()` | 函数 | 见 §4.4（清空：删索引与全部副本） |
| `watch(scenes, …, { deep: true })` | 模块级副作用 | `ready` 之后任何变更都 `scheduleSave()`——`v-model` 直接改字段也能触发自动保存 |

> **`helpers.ts` 里已无 `saveScenes`**，也没有 `sameScenes` / `findCurrentRoundId` / `loadChatRounds` / `persistChatRounds`：落盘只剩 `writeSnapshot()` 一条路径（由 `scheduleSave` / `flushSave` 调用）；「哪一版是当前」改由索引的 `activeVersionId` 表达。

### 3.2 `AiChatPanel.vue` 的本地状态

| 名称 | 类型 | 说明 |
|------|------|------|
| `rounds` | `ref<ScriptChatRoundMeta[]>` | 本项目的轮次**元数据**列表（来自 `chat/index.json`；上限由主进程 `MAX_CHAT_ROUNDS = 100` 裁剪，界面不另设上限） |
| `activeVersionId` | `ref<string>` | 当前已应用到编辑器的那一版（来自索引；应用旧版后本地同步） |
| `request` | `ref<string>` | 需求输入框 |
| `sceneCount` / `targetSeconds` | `ref<string>` | 两个参数输入框（字符串，提交前 `numOf()` 转正整数或 `undefined`） |
| `busy` / `status` | `ref` | 是否生成中 / 状态行文案 |
| `thinkText` / `thinkOpen` | `ref` | 思考过程全文与折叠开关 |
| `errorMsg` / `errorRaw` / `rawOpen` | `ref` | 错误文案 / 模型原文 / 原文折叠开关 |
| `expanded` | `ref<number>` | 当前展开的轮次下标（`-1` = 都收起） |
| `expandedScenes` | `ref<Scene[] \| null>` | 展开那一轮的场景；`null` = 正在读 / 还没读 |
| `applyingId` | `ref<string>` | 正在「应用此版本」的 `versionId`（按钮显示「应用中…」） |
| `versionCache` | `Map<string, Scene[]>` | 已读过的版本副本，避免反复读盘 |
| `listEl` | `ref<HTMLElement \| null>` | 结果列表容器（`scrollToBottom()` 用） |
| `hasRounds` | `computed<boolean>` | `rounds.value.length > 0`（清空前判断） |
| `MAX_SCENES` | 常量 `30`（模块内 `const`，非导出） | **与 `src/main/agent/script.ts` 的 `MAX_SCENES` 对齐**；本文件只用它算提示里的「每轮最多发送 N 个」（主进程截断那一份仍是自己的常量） |
| `contextHint` | `computed<string>` | 本轮上下文提示文案（挂在上面的 `.hgen-tip` 上）：按主进程**实际发送口径**统计——`scenes` 里「旁白或画面分镜非空」即算一场，再 `Math.min(..., MAX_SCENES)`；有内容输出「本轮将附带当前脚本 N 个场景」，超过 30 场追加「（每轮最多发送 30 个，其余不发送）」，空则「当前脚本为空：本轮将从零写一版」。**口径与 `HtmlGenPage` 的 `meta.sceneN`（画面分镜非空）故意不同**：这里数「发给 AI 的上下文」，宁可多带（只有旁白的场景也是用户写的内容，不能悄悄丢）；那边数「生成 HTML 时实际附带的场景」，画面为空才算附带门槛 |
| `EST_CHARS_PER_SEC` | 常量（`import` 自 `@shared/constants`） | 「估算时长」的字/秒口径，**只用于界面估算时长**；本地语速常量已删除，模板把它直接传给 `ScriptRoundCard` 的 `charsPerSecond` |
| `EXAMPLES` | 常量 `string[]` | 3 条示例需求 |

### 3.3 生命周期

| 位置 | 钩子 | 内容 |
|------|------|------|
| `index.vue` | `onMounted` | `loadScenes`（`goPage` 会重建页面组件，因此每次进页面都重新拉一次） |
| `index.vue` | `onBeforeUnmount` | **`flushPending`**——把还在防抖里的改动写掉；没有排队快照就什么都不做（见 §4.3） |
| `AiChatPanel.vue` | `onMounted` | ① 注册进度：`window.scriptTools.onProgress((p) => { if (!busy.value) return; status.value = p.text \|\| ''; if (p.thinkText) thinkText.value = p.thinkText; })`（单订阅，且**只在 `busy` 时更新**）；② **只读索引**：`const state = await loadChatIndex()` → `rounds.value = state.rounds` / `activeVersionId.value = state.activeVersionId`，有记录就 `nextTick()` 后滚到底（失败会写进 `chatError` 并在面板上显示） |

## 4. 关键流程

### 4.1 页面挂载加载（`loadScenes`）

1. `ready = false`（避免下面的加载被 `deep watch` 当成编辑、一进页面就写盘）。
2. 取 `const content = (appState.project && appState.project.content) || { style: '', scenes: [] }`。
3. `scenes.value = (Array.isArray(content.scenes) ? content.scenes : []).map(...)`，逐字段做类型守卫：`id` 非空字符串则 `trim()` 保留、否则新生成；`narration` / `visual` 非字符串则 `''`；`durHint` 的 `undefined` / `null` 转 `''`、其余 `String(...)`。
4. 若 `!scenes.value.length` 推入一个 `emptyScene()`——即「已有项目无内容脚本时默认展示一个空场景」。
5. 复位自动保存三态：`dirty = false` → **`saveState = 'idle'`、`lastSavedAt = ''`、`saveError = ''`** → `ready = true`。

### 4.2 AI 结果写回编辑器（`applyScenes`）

1. `list = (Array.isArray(next) ? next : []).filter((s) => s && typeof s === 'object')`。
2. `scenes.value = list.length ? list.map(...归一化四字段...) : [emptyScene()]`——**整份替换**，空数组兜底成一个空场景（保持「至少一行」的既有约定）。
3. `dirty.value = true`——而真正的落盘由 `scenes` 的 `deep watch` → `scheduleSave()` 接手：**AI 的结果与手工改动走同一条自动保存**，不再需要用户回「场景编辑」点按钮。

两条触发路径：`AiChatPanel.send()` 成功后 `applyScenes(res.scenes)`；`applyVersion(i)` 把第 i 版重新写回（`applyScenes(list.map((s) => ({ ...s })))`，toast「已应用第 N 版（自动保存）」）。

### 4.3 自动保存调度（防抖 + 快照 + 串行 + 可重试）

```
编辑（v-model 改字段 / 增删排序 / applyScenes）
  → deep watch → scheduleSave()
      ├─ queued = snapshot()        ← 项目名 + 内容在这一刻定住
      ├─ dirty = true
      └─ 重置 600ms 计时器 → 到点 flushSave()

flushSave()（计时器到点、点「重试」、或 flushPending 调它）
  ├─ 先清计时器
  ├─ 若正在写（saving）⇒ 把最新快照留在 queued、立刻返回 false（由进行中的循环收尾时再写）
  ├─ 否则取出 first = queued || snapshot()，queued = null，saving = true
  ├─ await writeSnapshot(first)
  └─ while (queued)：取出、清空、再写一次        ← 串行：写盘期间的改动不会被旧内容顶掉
     finally saving = false

flushPending()（页面卸载）
  └─ if (!queued) return;          ← **没有排队快照就绝不凭空 snapshot()**
     void flushSave()
```

四条设计约束（源码注释与实现）：

1. **防抖 600 ms**：打字停下才写，避免每个按键一次 IPC。
2. **写入前抓快照**：`snapshot()` 在同一时刻取「项目名 + 内容」。**这是切项目不写串的关键**——若在写盘时再读 `appState.currentName`，切项目后就会把旧项目的内容写进新项目。
3. **串行队列**：`saving` 期间来的改动只更新 `queued`，由正在跑的循环在收尾时再写一次；因此不会出现「旧请求后到、把新内容覆盖掉」。
4. **失败不静默**：`saveState = 'error'` + `saveError` 保留原因、`dirty` 保持为真，界面显示「保存失败：原因」与「重试」按钮（`flushSave` 用的是最新快照，重试即重写）。
5. **`flushPending` 为什么不能凭空抓快照**：`onBeforeUnmount` 触发时 `appState.currentName` 可能已经是**新项目**，而 `scenes` 还是旧项目的——凭空 `snapshot()` 会把旧项目的场景写进新项目。所以它只冲刷「编辑时就已经抓好的那份 `queued`」。
6. **成功后 `refreshProject()` 不 await**：写盘已经成功，刷新只是让首页节点 / 字幕页 / HTML 生成看到最新，不能让它拖住状态行与下一次编辑。

`writeSnapshot()` 的成功分支：`saveState = 'saved'` → `lastSavedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false })` → `saveError = ''` → `dirty = false` → `void refreshProject()`；失败分支（`!res.ok` 或抛错）：`saveState = 'error'`、`saveError = res.message || 异常 message || '保存失败'`、返回 `false`。

> `project:save-content` 是**整份 `content` 覆盖**，所以 `snapshot()` 必须把项目里已落盘的 `content.style` 原样带回（风格唯一编辑入口在「HTML生成」页，这里不带就等于把它清掉）。

### 4.4 对话记录（索引 + 每版副本 / 懒加载 / 应用此版本 / 清空）

磁盘形状与上限由主进程决定（`agent/chatLog.ts`），渲染层只管「什么时候读 / 什么时候追加 / 什么时候应用」：

```
projects/<项目名>/chat/index.json
  { version: 1, updatedAt, activeVersionId, rounds: [{ id, request, versionId, totalChars, sceneCount, ts }] }
projects/<项目名>/chat/versions/<versionId>.json
  { versionId, createdAt, scenes: Scene[] }
```

| 动作 | 实现 |
|------|------|
| **读索引** | `loadChatIndex()` → `window.scriptTools.loadChat(appState.currentName)`；`res.ok && Array.isArray(res.rounds)` 才算成功（`activeVersionId` 缺省补 `''`），否则 / 抛错都把原因写进 `chatError.value` 并返回 `{ rounds: [], activeVersionId: '' }`。`AiChatPanel.onMounted` 调它——**只拿元数据，不读任何副本** |
| **追加一版** | `appendChatRound(meta, scenes)` → `window.scriptTools.appendRound({ name, round: { ...meta }, scenes: plainScenes(scenes) })`；成功返回 `versionId`（失败 / 抛错返回空串并把原因写进 `chatError`）。**副本由主进程写、索引由主进程更新**，渲染层不拼路径 |
| **读某一版** | `readChatVersion(versionId)` → `window.scriptTools.readVersion(appState.currentName, versionId)`；`res.ok` 才拿到 `scenes`，否则写 `chatError` 并返回 `null`。**只读、无副作用** |
| **展开（懒加载）** | `toggle(i)`：再点同一行 = 收起；否则 `expanded = i`、`expandedScenes = null`（显示「正在读取这一版…」）→ `ensureVersion(r.versionId)`（先查 `versionCache`，miss 才 `readChatVersion`）→ **读回来时若 `expanded` 已被改到别的行就丢弃**，不覆盖当前展开 |
| **应用此版本** | `applyVersion(i)`：`applyScenes(该版 scenes 的浅拷贝)` → `activeVersionId = 该版` → `await setActiveChatVersion(versionId)`（主进程改索引）→ toast「已应用第 N 版（自动保存）」；`applyingId` 期间拒绝重复点击；读不到时 toast「这一版读不到了」 |
| **生成后** | `send()` 成功：`applyScenes(res.scenes)`（编辑器自动保存）→ 组装 `meta = { id: 'round-' + Date.now().toString(36) + '-' + 随机 4 位, request: 本次输入, totalChars: res.totalChars, ts: Date.now() }` → `const versionId = await appendChatRound(meta, res.scenes)` → 成功则 `rounds.push({ ...meta, versionId, sceneCount: res.scenes.length })`、`activeVersionId = versionId`、`versionCache.set(versionId, 场景浅拷贝)`、toast「已生成 N 个场景（自动保存）」；失败则 toast「生成成功，但对话记录保存失败：…」（**编辑器里的内容已经落地**，只是记录没写进去） |
| **清空** | `clearChat()`：有记录才继续 → `window.confirm('清空对话记录？会删除所有版本副本，但不影响编辑器里的场景。')` → `clearChatRecords()` → 失败 toast「清空失败：…」；成功清空 `rounds` / `activeVersionId` / `expanded` / `expandedScenes` / `versionCache` → toast「对话记录已清空」 |
| **「当前」标记** | `current = r.versionId === activeVersionId`——**只认索引里的 `activeVersionId`**；手改编辑器不会改变标记（标记描述的是「这一版是当前应用的版本」，不是「内容与编辑器一致」） |

主进程侧的落盘规则（`agent/chatLog.ts`）：索引最多 **100 轮**（`MAX_CHAT_ROUNDS`，超出丢最旧的、并把对应副本一并删掉）；`writeChatIndex` 写完索引后清理 `versions/` 下不再被引用的文件；`readChatIndex` 会丢弃「副本已不存在」的条目；单版场景上限 30；`clearChat` 删整个 `chat/` 目录。

### 4.5 一次生成（`AiChatPanel.send`）的完整时序

```
点「发送」（或 textarea 上 Ctrl+Enter）
  → busy 守卫 + request 非空校验（空则 toast「请先写下要什么」）
  → busy = true；status = '正在连接模型…'；清空 thinkText / thinkOpen / errorMsg / errorRaw / rawOpen
  → window.scriptTools.generate({
       name: appState.currentName,
       request: text,
       scenes: scenes.value.map((s) => ({ ...s })),   // 上下文 = 编辑器当前内容（普通对象）
       sceneCount: numOf(sceneCount.value),            // 非正数 → undefined
       targetSeconds: numOf(targetSeconds.value)
     })
  ├─ 失败 (res 为空或 !res.ok)
  │    → errorMsg = res.message || '生成失败'；errorRaw = res.raw（若有）；status = ''
  │    → configPrompt.fromResult(res) 为假时 toast(msg)
  │      （配置类由主进程判好分类 → 弹「去设置」；其余只 toast 一次）
  └─ 成功
       → applyScenes(res.scenes)（写回编辑器 → deep watch → 600ms 后自动保存）
       → request = ''
       → 组装 meta（id / request / totalChars / ts）
       → const versionId = await appendChatRound(meta, res.scenes)
           ├─ 成功：rounds.push({ ...meta, versionId, sceneCount })；activeVersionId = versionId；
           │        versionCache.set(versionId, 场景浅拷贝)；toast('已生成 N 个场景（自动保存）')
           └─ 失败：toast('生成成功，但对话记录保存失败：' + chatError)
       → await nextTick() → scrollToBottom()
  → finally: busy = false
```

要点：

- **「生成中」的状态只存在于 `busy` 期间**：成功后状态行就消失了，所以成功提示走 `toast`（写进 `status` 等于看不见）。
- **进度只在 `busy` 时消费**：`onProgress` 回调开头 `if (!busy.value) return`——页面切走再切回也不会被旧进度污染。
- **错误与原文都留在列表里**（不是 toast 一闪而过）：`errorMsg` / `errorRaw` 折叠展示，用户能自己看出模型跑偏在哪。
- **记录失败不掩盖生成本身**：编辑器写回与自动保存先发生，`appendChatRound` 失败只多一条 toast + 顶部红字，产物仍然是 `content.json`。
- **`numOf(v)`**：`Number(trim())`，`isFinite && > 0` 才返回数字，否则 `undefined`——主进程按「未指定」处理。

## 5. 依赖与协作

### 5.1 导入

| 文件 | 来源 | 引入内容 |
|------|------|----------|
| `index.vue` | `vue` | `onBeforeUnmount`、`onMounted`、`ref` |
| | `@renderer/components/StepBar.vue` | `StepBar`（`:page="'content'"`） |
| | `./helpers` | `loadScenes`、`flushPending` |
| | `./SceneEditor.vue` / `./AiChatPanel.vue` | 两个 Tab 组件 |
| `SceneEditor.vue` | `vue` | `computed` |
| | `./helpers` | `scenes`、`saveState`、`lastSavedAt`、`saveError`、`addScene`、`removeScene`、`moveScene`、`flushSave` |
| `AiChatPanel.vue` | `vue` | `computed`、`nextTick`、`onMounted`、`ref` |
| | `@renderer/composables/useAppStore` | `appState` |
| | `@renderer/composables/useConfigPrompt` | `useConfigPrompt`（配置类错误弹窗） |
| | `@renderer/composables/useToast` | `toast` |
| | **`@shared/constants`** | **`EST_CHARS_PER_SEC`**（「估算时长」的字/秒口径，与字幕估时、主进程提示词预算同一份；本地语速常量已删除） |
| | `@shared/types` | `type Scene`、**`type ScriptChatRoundMeta`**（轮次元数据类型走共享层） |
| | `./helpers` | `scenes`、`applyScenes`、**`chatError`**、`loadChatIndex`、**`appendChatRound`**、**`readChatVersion`**、**`setActiveChatVersion`**、**`clearChatRecords`** |
| | `./ScriptRoundCard.vue` | 结果卡 |
| `ScriptRoundCard.vue` | `vue` | `computed` |
| | `@renderer/utils/time` | `fmtTime` |
| | `@shared/types` | **`type Scene`、`type ScriptChatRoundMeta`** |
| `helpers.ts` | `vue` | `ref`、`watch` |
| | `@renderer/composables/useAppStore` | `appState`、`refreshProject` |
| | `@shared/types` | `type Scene`、**`type ScriptChatRoundMeta`** |

跨目录导入统一走别名（`@renderer/...` / `@shared/...`）；同页面内部用相对路径（`./helpers`、`./Xxx.vue`）。`helpers.ts` 不 import `toast`（自动保存的成败靠状态行表达；对话记录的成败靠 `chatError` + 调用方的 toast）。

### 5.2 调用的 IPC / preload 方法

| 方法 | 用途 |
|------|------|
| `window.projectTools.saveContent(name, { style, scenes })` | 自动保存写 `content.json`（复用既有频道，**本页没有新增任何项目类 IPC**）；整份覆盖，`style` 原样带回 |
| `window.projectTools.load(...)`（经 `refreshProject`） | 保存成功后刷新当前项目详情，`loadScenes` 从中读取 `content` |
| `window.scriptTools.generate({ name, request, scenes, sceneCount, targetSeconds })` | 调主进程 `script:generate`，返回 `ScriptGenerateReply`：成功 `{ ok: true, scenes, totalChars }`；失败 `{ ok: false, message, raw?, needConfig?, title? }` |
| `window.scriptTools.loadChat(name)` | `script:load-chat`：读回索引（`IpcResult<ScriptChatIndex>` = `{ rounds, activeVersionId }`，**不含 scenes**） |
| `window.scriptTools.appendRound({ name, round, scenes })` | `script:append-round`：主进程写 `chat/versions/<id>.json` + 更新索引并把 `activeVersionId` 指向新版本，返回 `IpcResult<{ versionId }>` |
| `window.scriptTools.readVersion(name, versionId)` | `script:read-version`：读某一版副本（`IpcResult<ScriptVersionResult>`），**无副作用** |
| `window.scriptTools.setActiveVersion(name, versionId)` | `script:set-active-version`：把某一版记为「当前应用」（只改索引，不写 `content.json`） |
| `window.scriptTools.clearChat(name)` | `script:clear-chat`：删整个 `chat/`（索引 + 全部副本），不动编辑器里的场景 |
| `window.scriptTools.onProgress(cb)` | 订阅 `script:progress`（**单订阅**：重复注册只替换回调）；载荷 `ScriptProgressPayload`（五阶段 `stage` + `thinkChars` / `contentChars` / `thinkText` + 中文 `text` 文案） |

### 5.3 注册关系

在 `src/renderer/src/pages/index.ts` 中作为 `pages.content` 注册，页面 key 为 `content`（与 `StepBar`、`HomePage` 流水线的 `page: 'content'` 一致）。

## 6. 注意事项与实现要点

- **`chatError` 是本轮把「静默失败」改成「可见失败」的产物**：读索引 / 追加一版 / 读副本 / 改 active / 清空，任一失败都写进它并清空成功态；`AiChatPanel` 顶部红字显示，生成失败额外 toast。**不要再退回只 `console.warn`**。
- **Vue 响应式 `Proxy` 过不了结构化克隆（`DataCloneError`）**：上一版把 `scenes` / `rounds` 原样递给 `ipcRenderer.invoke`，主进程 handler 根本没执行，而渲染层 `try/catch` 只 `console.warn`，于是「生成正常、记录从未落盘、切页就丢」。本轮规定**所有发往 IPC 的 scenes 先经 `plainScenes()` 转普通对象**（`helpers.ts` 里集中在 `appendChatRound`），提交 `round` 也是 `{ ...meta }`；新增写记录的代码不要直接把 `ref` 里的数组传出去。
- **两个 Tab 共享的是「同一份 `scenes`」而不是副本**：`helpers.ts` 的模块级 `ref` 是唯一数据源；`AiChatPanel` 提交时做一次浅拷贝（`{ ...s }`）同样是为了不把 Proxy 递出去。
- **索引里没有 scenes**：`rounds` 只有 `ScriptChatRoundMeta`；展开 / 应用时才 `readVersion`，读过的进 `versionCache`（清空时一并 `clear()`）。因此「切页回来还能展开」不依赖任何内存状态。
- **「应用此版本」= 写回编辑器 + 改 `activeVersionId`**：`applyScenes()` 会触发自动保存，所以应用旧版后的落盘仍走 `content.json` 那条链路；主进程只在索引里记「当前是哪一版」。
- **默认 Tab 是「场景编辑」**：即使项目还没有任何场景也不自动跳到 AI——源码注释写明「AI 是并列 Tab，不是默认路径」。
- **`v-show` 而非 `v-if`**：切 Tab 不销毁组件，AI 输入框草稿、思考展开状态、错误原文展开状态都保留；副作用是 `AiChatPanel` 的 `onMounted` 只在首次挂载时执行一次（进度订阅与读索引因而都只有一次）。
- **自动保存没有撤销 / 版本**：改错也会在 600 ms 后落盘（这是去掉手动保存的代价，已在 CHANGELOG 记录）。要回到上一版靠「AI 创作」里的结果卡「应用此版本」。
- **`flushPending` 只在确有排队的快照时写**：见 §4.3 第 5 条——写成「卸载时无条件 `flushSave()`」会在切项目时把旧项目的场景写进新项目。
- **状态行的三种文案与「重试」**：`saving` / `saved`（带 HH:mm:ss）/ `error`（带原因）；只有 `error` 时出现「重试」按钮，点它调 `flushSave()`（用最新快照重写）。
- **`dirty` 还在，但界面不显示**：它现在只作为内部「有改动在飞」的标记；「● 有未保存改动」那行已随手动保存一起删除。
- **`style` 原样带回、本页不做任何加工**：`snapshot()` 直接读 `appState.project.content.style`（缺省 `''`）提交，保证「HTML生成」页保存的风格不会被本页覆盖。
- **AI 结果写回后由 `deep watch` 触发保存**：`applyScenes` 只置 `dirty`，落盘交给同一条调度——**不要**在 `applyScenes` 里再直接调 `saveContent`，否则会和防抖队列打架。
- **对话记录不是「产物」**：它不参与 `project.json`、不影响任何 `has*` 标记；删掉 `chat/` 只丢回看历史。产物始终是 `content.json` 里的 `scenes`——对话记录只是「展开预览 / 应用此版本」的依据。
- **错误优先级**：配置类（`res.needConfig`）走 `useConfigPrompt` 弹「去设置」，其余只 toast 一次；`errorRaw`（解析失败时的模型原文）始终留在列表里可展开。
- **两处「场景数」口径是故意不同的，别合成一个**：本页 `contextHint` 数「旁白**或**画面分镜非空」（= 主进程 `buildScriptPrompt` 实际发送的那批，上限 30），`HtmlGenPage` 的 `meta.sceneN` 数「画面分镜非空」（= 主进程 `buildContentBlock` 实际附带的场景）。前者是「发给 AI 的上下文」，宁可多带；后者是「HTML 提示词的附带门槛」，画面为空没什么可画。源码注释写明了这个差异，改任一处前先看清数的是哪件事。
- **`ScriptRoundCard` 是纯展示组件**：不 import 任何 IPC，也不改 `helpers` 的状态；「应用此版本」之后写回编辑器、改 `activeVersionId` 这件事完全由父组件 `applyVersion()` 完成。它的「估算时长」分母来自 props（父组件传 `EST_CHARS_PER_SEC`），所以卡片本身不写死语速。
