# src/renderer/src/components/（通用组件）

> 目录级一篇：链路状态条 `StepBar.vue` + 新建项目弹窗 `NewProjectDialog.vue` + 全局自定义下拉 `HfSelect.vue` + 旧数据处置弹窗 `LegacyDataDialog.vue`

- **覆盖文件**：`components/` 目录（链路状态条 `StepBar.vue` + 新建项目弹窗 `NewProjectDialog.vue` + 全局自定义下拉 `HfSelect.vue` + 旧版本数据弹窗 `LegacyDataDialog.vue`；文件行数随迭代变化，不写死）
- **所在目录**：`src/renderer/src/components/`
- **类型**：通用组件（单文件组件，`<script setup lang="ts">`）。`StepBar.vue` / `NewProjectDialog.vue` **都没有 `<style>` 块**，样式来自全局 `assets/main.css`；`HfSelect.vue` **自带两个 `<style>` 块**（触发器用 `<style scoped>`、Teleport 弹层用不带 `scoped` 的 `<style>`），下拉的全部视觉不依赖 `main.css`；`LegacyDataDialog.vue` **自带一段 `<style scoped>`**（只放它私有的 `.path-line` / `.opt-list` / `.danger-text` 与危险按钮的描边重写，其余视觉复用 `main.css` 的 `.hf-modal*`）。
- **对外导出**：
  - `StepBar`：默认导出组件；**props**：`page: PageKey`（必填）；**emits**：无（自身直接调用 `goPage` / `switchProject`）
  - `NewProjectDialog`：默认导出组件；**props**：`{ visible: boolean }`；**emits**：`update:visible(value: boolean)`、`created(name: string)`
  - `HfSelect`：默认导出组件；**props**：`modelValue: string`（必填，配 `v-model`）、`groups: HfSelectGroup[]`（必填）、`placeholder?: string`（默认 `'请选择…'`）、`emptyText?: string`（默认 `'（暂无可选项）'`）、`disabled?: boolean`（默认 `false`）、`title?: string`（默认 `''`）、`style?: string | Record<string, string>`（默认 `'flex:1'`）；**emits**：`update:modelValue(value: string)`、`change(value: string)`；**导出类型**：`HfSelectOption`（`value: string`、`label: string`、`disabled?: boolean`、`title?: string`）、`HfSelectGroup`（`label: string`、`options: HfSelectOption[]`）
  - `LegacyDataDialog`：默认导出组件；**props**：无；**emits**：无（显隐与动作全部来自 `useLegacyData()` 单例）

## 1. 作用与职责

### 1.1 `StepBar.vue` —— 项目链路状态条

原 `window.App.renderStepBar` 的组件化替代物。原实现依赖 `[data-slot]` 占位注入机制，现已废弃：各页面模板顶部直接放 `<StepBar :page="..."/>` 即等效。它提供两块能力：

1. **第一行：五节点流水线可视化**——「内容脚本 → 配音 → 字幕 → HTML → 视频预览」的链路进度，节点既是状态指示器（`done` / `active-now`）又是跳转入口（可点击）。注意第 5 个节点是**预览**环节：真正发起渲染的「转视频」按钮在「HTML生成」节点页内（源码顶部注释即写明「内容脚本 → 配音 → 字幕 → HTML → 视频预览；转视频动作在 HTML 节点页内」）。
2. **第二行：工作项目切换 / 新建 / 打开目录**——所有节点页共用的全局项目入口。下拉改用全局自定义组件 `HfSelect`（不再是原生 `<select>`），数据源是单组 `projectGroups`；**只列我的项目**（选项值就是项目名，无前缀、无分组标题）；「新建项目」按钮只把弹窗置为可见，输入与创建流程整体交给 `NewProjectDialog`。

组件的状态判定**不自己计算**，而是直接引用 `useAppStore` 的 `computed`（`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo`），因此项目切换后状态自动同步。

### 1.2 `NewProjectDialog.vue` —— 新建项目弹窗

新建项目的**唯一入口**（首页与 StepBar 都直接开它，StepBar 第二行的行内输入框已删除）。它复用全局弹窗样式 `.hf-modal-mask` / `.hf-modal` / `.hf-modal-head` / `.hf-modal-body` / `.hf-modal-foot`，把「创建 → 刷新列表 → 切换当前项目 → 通知父组件」整条流程闭在组件内部，父组件只需监听 `created` 决定跳哪一页。

### 1.3 `HfSelect.vue` —— 全局自定义下拉

替代原生 `<select>` 的通用下拉组件：`button` 触发器 + **Teleport 到 `body` 的 fixed 定位弹层**，用 `v-model` 读写值、用 `groups` 喂分组选项。之所以自绘，是因为原生 `<option>` 弹层由系统/浏览器绘制，行高、间距、圆角、配色与选中勾都无法用 CSS 控制，深色科技主题下会出现「选项挤在一起、选中态看不出」且改不动的问题（源码注释即写明这一点）。它对原生 `<select>` 的关键语义做了对齐：`v-model`、`disabled`、`title`、空值占位、`optgroup` 分组、`@change` **只在用户选择时触发**（程序化改值不触发，等价于原生 `v-model` 赋值不发 `change`）。

### 1.4 `LegacyDataDialog.vue` —— 「发现旧版本数据」弹窗（应用内）

品牌 / 目录改名后，老用户的数据可能还留在旧目录（如 `%APPDATA%\my-app`）。主进程扫到**确有应用数据**的老目录后不弹任何界面，只把结论放进 `legacy:status`；本组件在首屏渲染完之后问一次「迁移过来 / 删除旧数据 / 稍后再说」，用户的选择经 `legacy:resolve` 回传执行。

它替代了早先主进程侧的原生 `dialog.showMessageBox` 三按钮对话框：原生框的按钮排布、字体与配色都跟不上 Cyber UI 设计系统（规范见 `src/renderer/agents.md`），而项目已有 `.hf-modal` 弹窗体系可复用。**契约极简：无 props、无 emits**，显隐与文案全部来自 `useLegacyData()` 的模块级单例（见 [common.md](./common.md) §5）。

## 2. `StepBar.vue`

### 2.1 根元素与模板区块

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `div.project-bar` | 根元素 | 带非标准属性 `data-roled="1"`（源码中的标记属性，仅作标识） |
| `div.project-bar-row`（第 1 个） | 行容器 | 承载 `.step-chain` 流程链 |
| `div.step-chain` | 链容器 | 5 个 `span.step-node.clickable`，节点间以 `span.step-arrow` 的 `→` 分隔 |
| `div.project-bar-row`（第 2 个） | 行容器 | 工作项目标签 + `<HfSelect>` + 两个按钮（**已无行内新建输入框**） |
| `span.sel-label` | 标签 | 文案「工作项目」，行内样式 `font-size:12px;color:var(--text-secondary);letter-spacing:1px;flex:none` |
| `<HfSelect>` | 下拉 | `v-model="selValue"`、`:groups="projectGroups"`、行内 `style="width:210px;flex:none"`、`placeholder="暂无项目，请先「新建项目」"`、`title="切换工作项目"`、`@change="onSelect"` |
| `button.hf-btn`（新建） | 按钮 | `@click="newVisible = true"`，文案「新建项目」，`title="新建我的项目"` |
| `button.hf-btn`（打开目录） | 按钮 | `@click="openFolder"`，文案「打开目录」，`title="打开当前项目所在目录"` |
| `<NewProjectDialog>` | 子组件 | `v-model:visible="newVisible"`、`@created="onCreated"` |

### 2.2 五节点链路（第一行）

| 顺序 | 节点文字 | 点击目标 | `active-now` 条件 | `done` 条件（源码常量） |
| --- | --- | --- | --- | --- |
| 1 | 内容脚本 | `goPage('content')` | `isPage('content')` | `contentDone`（`hasContent`） |
| 2 | 配音 | `goPage('text-tts')` | `isPage('text-tts')` | `audioDone`（`hasAudio`） |
| 3 | 字幕 | `goPage('subtitle')` | `isPage('subtitle')` | `subDone`（`hasSubtitle`） |
| 4 | HTML | `goPage('html-gen')` | `isPage('html-gen')` | `htmlDone`（`hasHtml`） |
| 5 | 视频预览 | `goPage('video-preview')` | `isPage('video-preview')` | `videoDone`（`hasVideo`） |

要点：

- 每个节点内部为 `<span class="step-dot"></span>` + 文字，圆点由 CSS 绘制（`.step-node .step-dot`）。
- `:class` 绑定为数组形式 `[当前态类, 完成态类]`，即 `active-now` 与 `done` 可以**同时存在**；样式优先级由 `main.css` 中的规则顺序决定。
- 「配音」节点只有 `isPage('text-tts')` 一个条件：原独立「音色管理」页（`sound-copy`）已下线，其能力并入配音页的第三个 Tab。

### 2.3 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `props` | `defineProps<{ page: PageKey }>()` | 必填 prop，标识当前所在页面 |
| `isPage` | `(pg: string) => boolean` | `props.page === pg` |
| `contentDone` / `audioDone` / `subDone` / `htmlDone` / `videoDone` | `ComputedRef<boolean>` | 分别直接绑定 `hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo` |
| `projectGroups` | `ComputedRef<HfSelectGroup[]>` | 下拉数据：单组 `{ label: '', options }` |
| `selValue` | `computed({ get, set })` | `get`：`appState.currentName`；`set`：**空实现（no-op）** |
| `newVisible` | `ref(false)` | 新建项目弹窗可见性 |
| `onSelect(name: string)` | `async function` | 下拉切换处理（参数即新选中的项目名，**不再读 `event.target.value`**） |
| `onCreated()` | `async function` | 弹窗创建成功后的回调，只 `goPage(props.page)` |
| `openFolder()` | `function` | 打开当前项目所在目录 |

### 2.4 下拉选项结构

`projectGroups` 固定为**一个组**（组标题 `label: ''`，HfSelect 对空 label 不渲染分组标题行）：

| 条件 | 选项 `value` | 选项显示文本 |
| --- | --- | --- |
| `appState.myProjects.length === 0` | —（没有选项） | 触发器显示占位文案「暂无项目，请先「新建项目」」 |
| `v-for="mp in appState.myProjects"` | `mp.name` | `mp.name` +（`mp.hasHtml ? ' · HTML✓' : ''`）+（`mp.hasVideo ? ' · 视频✓' : ''`） |

## 3. `StepBar.vue` 关键流程

### 3.1 切换工作项目（`onSelect`）

1. 触发时机：工作项目下拉选中项变化（`@change`）——HfSelect 只在用户**选中与当前值不同的选项**时发 `change`，重复选中同项不发事件。
2. **新选中值由下拉的 `change` 事件直接给出**：不要依赖 `selValue` —— 它是 setter 为 no-op 的 `computed`，`@change` 时它的 getter 仍返回**旧项目**的值。
3. 空值保护：`if (!name) return`。
4. `await switchProject(name)`：写入 `appState.currentName`、`saveProjectCtx()` 落盘到 `localStorage['myapp.projectCtx']`，再 `refreshProject()`。
5. `await goPage(props.page)`：**重进当前页**（刷新全部状态、递增 `pageNavKey` 强制页面组件重挂载），而不是跳到首页。
6. 切换完成后下拉框显示值自动与新项目一致（getter 依赖 `appState.currentName`）。

### 3.2 新建项目（交给弹窗）

1. 点击「新建项目」→ 只执行 `newVisible = true`。
2. `NewProjectDialog` 完成「创建 + 刷新 + 切换」后 emit `created`。
3. 本组件 `onCreated()` **只做一件事**：`await goPage(props.page)`。

### 3.3 打开目录（`openFolder`）

`window.projectTools.openFolder(appState.currentName)` —— **恒以当前项目名为入参**。

## 4. `NewProjectDialog.vue`

### 4.1 模板结构

| 名称 | 说明 |
| --- | --- |
| `div.hf-modal-mask` | 遮罩，`v-show="visible"`，`@click.self="close"` |
| `div.hf-modal` | 弹窗本体，行内 `style="width:min(460px,92vw)"` |
| `.hf-modal-head` | 标题「新建项目」+ `.hf-modal-close`（`×`，`title="关闭"`，`@click="close"`） |
| `.hf-modal-body` | `.panel-title-sm`「项目名称」+ `input.hgen-input`（`ref="nameEl"`、`v-model="name"`、`placeholder="例如：产品介绍短片"`、`@keydown.enter="submit"`）+ `.hgen-tip` 说明 |
| `.hf-modal-foot` | 「取消」+「创建并切换」（`.hf-btn.hf-btn-primary`，文案 `busy ? '创建中…' : '创建并切换'`） |

### 4.2 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `props` | `defineProps<{ visible: boolean }>()` | 由父组件用 `v-model:visible` 双向绑定 |
| `emit` | `defineEmits` | `update:visible(value)`、`created(name)` |
| `name` / `busy` | `ref('')` / `ref(false)` | 输入中的项目名；创建进行中标志（`true` 时禁止关闭、禁止重复提交、两个按钮置灰） |
| `nameEl` | `ref<HTMLInputElement \| null>(null)` | 输入框模板引用（自动聚焦与校验失败后回焦） |
| `watch(() => props.visible)` | `watch` | 每次**打开**时清空 `name` 并 `await nextTick()` 后 `focus()` |
| `close()` | `function` | `if (busy.value) return`；否则 `emit('update:visible', false)` |
| `submit()` | `async function` | 见 4.3 |
| `onKeydown(e)` | `function` | `e.key === 'Escape' && props.visible` 时 `close()` |

生命周期：`onMounted` 注册 `document` 级 `keydown`，`onBeforeUnmount` 成对注销；输入框的 Enter 由模板 `@keydown.enter="submit"` 承担。

### 4.3 提交流程（`submit`）

1. `if (busy.value) return`。
2. `const nm = name.value.trim()`；空名 → `toast('请输入项目名')` + 回焦输入框 + `return`。
3. `busy.value = true`，整段包在 `try { … } finally { busy.value = false }`。
4. `const res = await window.projectTools.create(nm)`；失败 → `toast(res.message || '创建失败')` 并 `return`（**弹窗保持打开**）。
5. 成功路径：`await refreshProject()` → `await switchProject(nm)` → `emit('update:visible', false)` → `emit('created', nm)` → `toast('已创建并切换到项目「' + nm + '」')`。

> 顺序要点：**先 `refreshProject()` 再 `switchProject()`**。反过来会让 `switchProject` 内部的 `refreshProject()` 用一份还没有新项目的列表做回退判定。

## 5. `HfSelect.vue`

### 5.1 根元素与模板结构

| 名称 | 说明 |
| --- | --- |
| `div.hf-sel` | 根元素（**单根**，便于父组件用模板 ref 取 `$el`）：`ref="triggerEl"`、`:class="{ open, disabled: props.disabled }"`、`:style="props.style"`、`:title="props.title"` |
| `button.hf-sel-trigger` | 触发器：`type="button"`、`:disabled="props.disabled"`、`:aria-expanded="open"`、`aria-haspopup="listbox"`、`@click="toggle"`、`@keydown="onTriggerKeydown"` |
| `span.hf-sel-text` | 显示值：`:class="{ ph: displayText === '' }"`，文案 `displayText \|\| props.placeholder` |
| `span.hf-sel-caret` | 自绘三角箭头；`.hf-sel.open` 时旋转 180° |
| `Teleport to="body"` | 弹层出口：菜单被挂到 `body` 下（见 5.5） |
| `div.hf-sel-menu` | 弹层：`v-if="open"`、`ref="listEl"`、`:style="menuStyle"`、`role="listbox"`、`tabindex="-1"`、`@mousedown.prevent`、`@keydown="onMenuKeydown"` |
| `div.hf-sel-group` / `div.hf-sel-group-label` | 分组容器；标题行 `v-if="g.label"`（**空 label 不渲染标题行**） |
| `div.hf-sel-opt` | 选项：`:class="{ on: o.value === props.modelValue, dis: !!o.disabled }"`、`:title="o.title \|\| o.label"`、`@click="pick(o)"` |
| `span.hf-sel-opt-text` / `span.hf-sel-tick` | 选项文本 + 自绘选中勾（`.on` 时才显示） |
| `div.hf-sel-empty` | `groups` 为空时渲染，显示 `props.emptyText` |

### 5.2 props / emits / 导出类型

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `modelValue` | `string`（必填） | 当前值，配 `v-model`；无匹配选项时触发器显示 `placeholder` |
| `groups` | `HfSelectGroup[]`（必填） | 分组选项；`allOptions` 由它扁平化而来 |
| `placeholder` / `emptyText` | `string`（默认 `'请选择…'` / `'（暂无可选项）'`） | 无匹配项的触发器文案 / `groups` 为空时的弹层文案 |
| `disabled` | `boolean`（默认 `false`） | 禁用触发器，`openMenu` 也会直接返回 |
| `title` | `string`（默认 `''`） | 根元素的 `title` 提示 |
| `style` | `string \| Record<string, string>`（默认 `'flex:1'`） | 直接绑到根元素，**宽度/布局交给父组件** |
| `update:modelValue` | emit `(value: string)` | 选中新值时写出 |
| `change` | emit `(value: string)` | 与 `update:modelValue` 同时发出，**参数是新值字符串**，不是 DOM Event |
| `HfSelectOption` / `HfSelectGroup` | `interface`（`export`） | 选项与分组的结构（见文首「对外导出」） |

### 5.3 状态与 computed

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `open` | `ref(false)` | 弹层开关，同时驱动 `v-if` 与根元素 `.open` 类 |
| `triggerEl` / `listEl` | `ref<HTMLElement \| null>` | 根元素与弹层 DOM，用于定位测量与「点在内/外」判定 |
| `allOptions` | `ComputedRef<HfSelectOption[]>` | `groups.flatMap((g) => g.options)`，键盘导航与查找都基于这份**扁平**列表 |
| `current` / `displayText` | `ComputedRef<HfSelectOption \| null>` / `ComputedRef<string>` | `value === modelValue` 的项；显示文本（为空串时走 placeholder） |
| `menuStyle` | `ref<Record<string, string>>({})` | `placeMenu` 写出的 `left` / `top` / `width` / `maxHeight` |
| `activeIndex` | `ref(-1)` | 键盘高亮下标（**扁平列表下标**），`watch(open)` 播种 |

### 5.4 函数与监听

| 名称 | 说明 |
| --- | --- |
| `win()` | 安全返回 `window` |
| `placeMenu()` / `onReposition()` | 计算并写入 `menuStyle`；仅当 `open` 时重算 |
| `bindGlobal()` / `unbindGlobal()` | 注册/注销 `window` 的 `scroll`（**capture 阶段**）与 `resize` |
| `openMenu()`（async） | 已打开或 `disabled` 时返回；置 `open = true` → `document` 上注册 `mousedown`（capture）→ `bindGlobal()` → `await nextTick()` → `placeMenu()` → `listEl.focus()` |
| `closeMenu(focusTrigger = false)` | 置 `open = false` → 注销监听；`focusTrigger` 为真时把焦点还给触发器按钮 |
| `toggle()` / `onOutside(e)` | 触发器开关；点击外部（`contains` 判定）关闭 |
| `pick(o)` | 选择：`o.disabled` 直接返回；`closeMenu(true)`；**`o.value === modelValue` 时直接返回、不发任何事件**；否则依次 `emit('update:modelValue', o.value)`、`emit('change', o.value)` |
| `highlight(i)` / `move(delta)` / `commitActive()` | 高亮滚动（`scrollIntoView({ block: 'nearest' })`）；扁平列表内循环移动并跳过 `disabled`；提交高亮项 |
| `onMenuKeydown(e)` / `onTriggerKeydown(e)` | 菜单：`ArrowDown`/`ArrowUp`/`Enter`/`Escape`/`Tab`；触发器：四键一律 `preventDefault` 后 `openMenu()` |
| `watch(open)` / `watch(() => props.groups)` | 打开时播种 `activeIndex`；`groups` 引用变化且菜单开着时 `nextTick(placeMenu)` |
| `onBeforeUnmount` | 注销 `document` 的 `mousedown` 与 `window` 的 `scroll` / `resize` |

### 5.5 弹层定位算法（`placeMenu`）

弹层样式为 `position: fixed`，坐标全部由 JS 实时测量，**不依赖任何祖先的 `overflow` 或定位上下文**：

1. `r = triggerEl.getBoundingClientRect()`；`width = Math.max(r.width, 220)`。
2. 水平钳制：左右各留 8px 边距。
3. 间距 `gap = 6`；理想高度 `idealH`：首帧按 `Math.min(allOptions.length * 34 + 12, 300)` 估算，渲染后改用实测 `listEl.scrollHeight + 12`。
4. 上下空间：`below` / `above`；**只有**下方装不下且上方更大时才向上翻转。
5. 可用高度 `room = Math.max(120, …)`、`height = Math.min(idealH, room)`——菜单 `max-height` 实际落在 **120 ~ 300px**，超出靠 `overflow-y: auto` 滚动。
6. 上下界都保证不越出视口（各留 8px）。
7. 写入 `menuStyle = { left, top, width, maxHeight }`。

**为什么 Teleport 到 `body` + `fixed`**：卡片 `.card`（`main.css`）与弹窗 `.hf-modal` 都用了 `overflow: hidden`，菜单若渲染在组件自身 DOM 内会被这些祖先裁掉；挂到 `body` 下并用 `fixed` 坐标即可溢出任何祖先，且 `z-index: 9500` **高于 `.hf-modal-mask` 的 `z-index: 9000`**，弹窗内部的下拉也能盖住弹窗本体（`TextTtsPage/VoiceSection.vue` 的两个 `Teleport` 弹窗里就有下拉）。

### 5.6 交互与键盘

- **打开**：点触发器，或在触发器上按 `ArrowDown` / `ArrowUp` / `Enter` / `Space`；`openMenu` 内部 `nextTick` 后定位并 `listEl.focus()`。
- **关闭**：再点触发器、按 `Escape`、按 `Tab`、或在组件外按下鼠标（`document` 上 **capture 阶段**的 `mousedown`）。前两条会把焦点还给触发器；点外部关闭不回焦。
- **菜单上的 `@mousedown.prevent`**：阻止默认行为以**保住 listbox 自身的焦点**。
- **键盘导航**：`activeIndex` 打开时按当前值播种，`move(±1)` 循环绕行并跳过 `disabled`，`Enter` 提交高亮项。
- **滚动 / 缩放跟随**：打开期间 `window` 的 `scroll`（capture）与 `resize` 都触发 `placeMenu`。
- **选中态**：选项 `.on` 由 `o.value === modelValue` 判定，`disabled` 项加 `.dis`。

### 5.7 值语义：程序化赋值 vs 用户选择

- 用户选中**不同**的值：`pick()` 先关菜单，再依次 emit `update:modelValue` 与 `change`（参数都是新值字符串）。
- 用户选中**当前值**：`pick()` 提前返回，**不发任何事件**。
- 父组件**程序化改值**：只改 `modelValue`、**不会**触发 `change`（`SynthSection` 的「自定义目录…取消选择后回退上一项」依赖这一点避免递归）。
- `disabled` 项：`pick` 直接返回，`move` 跳过。

### 5.8 为什么取代原生 `<select>`

原生 `<option>` 弹层由操作系统/浏览器绘制，CSS 无法控制其行高、间距、圆角、配色与选中勾，深色科技主题下表现为「选项贴在一起、当前项看不出」。`HfSelect` 用 `button` + `Teleport` 弹层换成完全可控的列表，并把宽度/布局交回父组件（默认 `flex:1`）。相应地，**`.hf-select` / `.hgen-select` 已从 `src/renderer/src/assets/main.css` 中删除**，下拉的全部视觉由本组件自带的两段 `<style>` 负责，类名统一 `hf-sel` 前缀：`.hf-sel` / `.hf-sel-trigger` / `.hf-sel-text`（`.ph` 占位态）/ `.hf-sel-caret` / `.hf-sel-menu`（`position: fixed`、`z-index: 9500`、`overflow-y: auto`、**显式 `font-size: 13px`**、`@keyframes hfSelIn`）/ `.hf-sel-group` / `.hf-sel-group-label` / `.hf-sel-opt`（`.on` / `.dis`）/ `.hf-sel-opt-text` / `.hf-sel-tick` / `.hf-sel-empty`。触发器样式在 `<style scoped>` 里，弹层样式在不带 `scoped` 的 `<style>` 块里。

### 5.9 样式与「Teleport 继承」这一坑

| 选择器 | 归属 | 关键声明与理由 |
| --- | --- | --- |
| `.hf-sel` | `<style scoped>` | 触发器包装层，`font-size: 13px` 是**字号真源**（与 `.hgen-input` 等表单控件一致） |
| `.hf-sel-trigger` | `<style scoped>` | `font: inherit`、主色文字、`#0A1120` 底、主色半透明描边、`8px` 圆角；`:disabled` 降透明度；`.open` 时描边转实色 + 辉光 |
| `.hf-sel-menu` | **无 `scoped` 的全局 `<style>`** | `position: fixed`、`z-index: 9500`、`overflow-y: auto`、`padding: 6px`、深色底 + 主色描边 + 阴影、入场动画，**外加显式 `font-size: 13px`** |
| `.hf-sel-group-label` / `.hf-sel-empty` | 同上 | 11px / 12px 的次要文字色（本就显式写了字号） |
| `.hf-sel-opt` | 同上 | `min-height: 32px`、独立成行、`:hover` 主色半透明底、`.on` 渐变高亮 + 主色字、`.dis` 降透明度且不可点 |

- **`.hf-sel-menu` 的字号必须显式声明，不能指望继承**：弹层是 `<Teleport to="body">`，DOM 直接挂到 `body` 下，**继承不到** `.hf-sel` 上的 `font-size: 13px`。`assets/main.css` 的 `html, body` 现在给了全局基准 **14px**，因此漏写时弹层会按 14px 渲染，仍比触发器（13px）大一档。按规范「Teleport 到 `body` 的弹层要在弹层根节点显式写字号」，这句不能省。
- **一般规律**：**Teleport 出去的 DOM 不只是丢 scoped 属性，也丢祖先的继承样式**——字号、颜色、行高、字体族这类靠继承生效的属性，都必须在弹层自己的选择器上重新声明。
- **Teleport 使用者不止 `HfSelect`**（本轮核对更正）：`HfSelect.vue` 的弹层（`components/HfSelect.vue`）之外，`pages/TextTtsPage/VoiceSection.vue` 另有 **2 处** `<Teleport to="body">`（「创建克隆音色」与「删除云端音色确认」两个弹窗，复用 `.hf-modal` 类）。其中「创建克隆音色」弹窗里的模型下拉就依赖 `.hf-sel-menu` 的 `z-index: 9500` 盖住 `.hf-modal-mask` 的 `9000`。将来新增 Teleport 弹层时，要照上面两条（显式字号 + z-index 关系）各检查一遍。

### 5.10 调用点清单

组件未做全局注册，每个使用方都显式 `import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'`（部分还引入 `type HfSelectOption`）。全仓 `*.vue` 核对结果（**共 11 个文件、20 个实例**）：

| 文件 | 使用处（绑定模型） | 实例数 |
| --- | --- | --- |
| `components/StepBar.vue` | `selValue`（工作项目切换，带 `@change`） | 1 |
| `pages/SettingsPage/components/ModelSection.vue` | `baseUrl`（Base URL 预设）、`modelId`（模型预设） | 2 |
| `pages/SettingsPage/components/VoiceSection.vue` | `vProvider`（厂家下拉，带 `@change`） | 1 |
| `pages/SettingsPage/components/RenderSection.vue` | `rQuality`（渲染质量）、`rFps`（渲染帧率） | 2 |
| `pages/HtmlGenPage/index.vue` | `subSel`（字幕逐条设计动画）、`quality` / `fps`（转视频弹窗里的渲染档位，带 `:disabled="rendering"` 与 `@change`） | **3** |
| **`pages/HtmlGenPage/PreviewSection.vue`** | **`audioPick`（背景音频，带 `@change`）——本轮随预览卡片从 `index.vue` 搬来** | **1** |
| `pages/SubtitlePage/TranscribeSection.vue` | `lang`（识别语言） | 1 |
| `pages/TextTtsPage/SynthSection.vue` | `voiceId`、`saveTo`（带 `@change`）、`genSelIdx`（带 `empty-text`） | 3 |
| `pages/TextTtsPage/AlignSection.vue` | `subSrc`（带 `@change`）、`voiceId` | 2 |
| `pages/TextTtsPage/VoiceSection.vue` | `vcModel`（带 `@change`）、`mapVoice`（带 `ref`）、`mapModel` | 3 |
| **`pages/VideoPreviewPage/index.vue`** | **`selectedName`（「预览项目」，带 `@change`）——本轮新增** | **1** |
| **合计** | | **20** |

- **本轮的两处结构性变化**：① `HtmlGenPage/index.vue` 由 5 处减到 3 处（`videoSel` 视频素材随单视频素材一起删除、`audioPick` 移到同目录子组件 `PreviewSection.vue`）；② `VideoPreviewPage/index.vue` 新增 1 处「预览项目」。**实例总数仍是 20（文件数由 10 增到 11）**——「20 个调用点」这个数字依旧成立，但分布变了，改 `HfSelect` 时不要按旧清单核对。
- 各调用方的 `groups` 均由 `computed`（或常量）构造为 `{ label, options: [{ value, label }] }`；`TextTtsPage/SynthSection.vue` 与 `AlignSection.vue` 的 `:groups="voiceGroups"` 也一样合规——`helpers.ts` 的 `VoiceOption` 直接以 `value` 为音色键（刻意与 `HfSelectOption` 同名），因此**可以直接透传**、无需中间映射。

## 6. `LegacyDataDialog.vue`

### 6.1 模板结构

| 区块 | 关键标记 | 说明 |
| --- | --- | --- |
| 遮罩 | `.hf-modal-mask`（`v-show="visible"`、`@click.self="later"`） | 点遮罩 = 不处理；组件常驻、靠 `v-show` 显隐 |
| 弹窗 | `.hf-modal`（行内 `style="width:min(560px,92vw)"`） | 常规宽度 560px，窄屏退到 92vw |
| 头部 | `.hf-modal-head` / `.hf-modal-title`「发现旧版本数据」/ `.hf-modal-close`（`title="稍后再说"`） | `×` 与「稍后再说」等价；`:disabled="busy"` |
| 正文·路径 | `.panel-title-sm`「旧数据目录」+ `.path-line`（`info ? info.dir : ''`）+ `.hgen-tip`「其中包含：{{ entryText \|\| '—' }}」 | 路径单独成块用等宽字体展示 |
| 正文·选项说明 | `.panel-title-sm`「要怎么处理？」+ `ul.opt-list` | 三条说明：**迁移过来** / **删除旧数据**（`.danger-text` 标「不可恢复」）/ **稍后再说** |
| 底部按钮 | `.hf-modal-foot`：`.hf-btn`「稍后再说」/ `.hf-btn.danger`「删除旧数据」/ `.hf-btn.hf-btn-primary`「迁移过来」 | 三枚按钮全部 `:disabled="busy"`；主按钮文案在 `busy` 时切为「处理中…」 |

### 6.2 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `info` / `visible` / `busy` / `entryText` / `resolve` | `useLegacyData()` 解构 | 状态与动作的唯一来源，语义见 [common.md](./common.md) §5 |
| `later()` | `async` | `busy` 时直接返回；否则 `await resolve('later')`——点遮罩 / `×` / 「稍后再说」三个出口共用 |
| `doMigrate()` | `async` | `resolve('migrate')` → 主进程无响应则 toast「迁移失败：主进程无响应」；否则**成败都**先 `await refreshProject()` → 按 `r.ok` 给 toast |
| `doDelete()` | `async` | `resolve('delete')` → 失败 toast，成功 toast「旧数据目录已删除」 |

### 6.3 样式（`<style scoped>`，本组件唯一一段）

| 类 | 说明 |
| --- | --- |
| `.path-line` | 旧目录绝对路径：等宽、12px、主色文字、`word-break: break-all`、`--radius-btn` 圆角 + 半透明主色描边 |
| `.opt-list` / `.opt-list b` | 三条说明列表：13px、行高 1.9；`b` 用主色 + 字重 600 |
| `.danger-text` | 行内警示文字，取 `--color-danger` |
| `.hf-btn.danger` | **危险动作复用次要按钮骨架，只换前景与描边** |
| `.hf-btn.danger:hover:not(:disabled)` | 必须**重写** hover（基础 `.hf-btn:hover:not(:disabled)` 特异性更高） |

### 6.4 交互约定与取舍

- **点遮罩 / `×` / 「稍后再说」三者等价**：都走 `resolve('later')`，什么都不动；下次启动重新扫描后**会再问一次**。
- **迁移与删除都先收起弹窗**：`resolve()` 在成功与失败两条路径上都先 `visible = false`，结果交给 toast。
- **迁移后立刻刷新项目列表**：`doMigrate()` 无论成败都 `await refreshProject()`。
- **删除前主进程还有一道校验**：界面只回传 `'delete'`，不自己判断路径（见 [main/index.ts.md](../../main/index.ts.md) §3.1）。

## 7. 依赖与协作

### 7.1 `StepBar.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `computed`、`ref` | 完成态 `computed`、弹窗可见性 |
| 依赖 | `@renderer/composables/useAppStore` | `appState`、`hasAudio` / `hasContent` / `hasHtml` / `hasSubtitle` / `hasVideo`、`switchProject`、类型 `PageKey` |
| 依赖 | `@renderer/pages` | `goPage` |
| 依赖 | `@renderer/components/HfSelect.vue` / `NewProjectDialog.vue` | 工作项目下拉 / 新建项目弹窗 |
| 依赖（preload 桥） | `window.projectTools.openFolder` | 打开当前项目目录 |
| 依赖（样式） | `assets/main.css` | `.project-bar*` / `.step-*` / `@keyframes stepPulse`、`.hf-btn`（`.hf-select` / `.hgen-select` 已删除） |
| 被使用 | 各页面组件（内容脚本 / 配音 / 字幕 / HTML / 视频预览） | 页面模板顶部 `<StepBar :page="..."/>` |
| 间接协作 | `src/renderer/src/App.vue` | 菜单跳转改变 `currentPage`，页面重挂载后由新页面重新传入 `page` prop |

### 7.2 `NewProjectDialog.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `nextTick`、`onBeforeUnmount`、`onMounted`、`ref`、`watch` | 打开时清空并聚焦、ESC 监听成对注册 |
| 依赖 | `@renderer/composables/useAppStore` / `useToast` | `refreshProject` / `switchProject`；`toast` |
| 依赖（preload 桥） | `window.projectTools.create` | 新建项目（`project:create`） |
| 依赖（样式） | `assets/main.css` | `.hf-modal-*`、`.hgen-input` / `.hgen-tip` / `.hf-btn*`、`.panel-title-sm` |
| 被使用 | `components/StepBar.vue` | `v-model:visible` + `@created`；目前是唯一使用方 |

### 7.3 `HfSelect.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `computed`、`nextTick`、`onBeforeUnmount`、`ref`、`watch` | 扁平化选项与显示值、打开后定位、成对清理全局监听 |
| 依赖（浏览器 API） | `Teleport`、`getBoundingClientRect`、`scrollIntoView`、`document` / `window` 事件 | 弹层挂到 `body`、fixed 定位测量、键盘高亮滚动、外部点击与滚动跟随 |
| 依赖（样式） | 组件自带 `<style scoped>` + 不带 `scoped` 的 `<style>` | `.hf-sel*` 全部类；不依赖 `assets/main.css` |
| 被使用 | `components/StepBar.vue`、`pages/SettingsPage/components/{ModelSection,VoiceSection,RenderSection}.vue`、`pages/HtmlGenPage/index.vue`、**`pages/HtmlGenPage/PreviewSection.vue`**、`pages/SubtitlePage/TranscribeSection.vue`、`pages/TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue`、**`pages/VideoPreviewPage/index.vue`** | 共 **11 个文件 / 20 个下拉实例**（见 5.10）；无全局注册，逐个显式 import |
| 协作（插入层） | `assets/main.css` 的 `.hf-modal-mask`（`z-index: 9000`） | 菜单 `z-index: 9500` 必须保持高于它；`TextTtsPage/VoiceSection.vue` 的 Teleport 弹窗里的下拉依赖这一点 |

### 7.4 `LegacyDataDialog.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖 | `@renderer/composables/useLegacyData` | `info` / `visible` / `busy` / `entryText` / `resolve` |
| 依赖 | `@renderer/composables/useAppStore` / `useToast` | `refreshProject()`（成败都调）；`toast` |
| 依赖（preload 桥，间接） | `window.legacyTools.status` / `resolve` | 频道 `legacy:status` / `legacy:resolve`；本组件不直接调用 |
| 依赖（样式） | `assets/main.css` | `.hf-modal-*`、`.panel-title-sm`、`.hgen-tip`、`.hf-btn*`；`scoped` 样式只补 `.path-line` / `.opt-list` / `.danger-text` / `.hf-btn.danger` |
| 被使用 | `src/renderer/src/App.vue` | 外壳模板里挂一次 `<LegacyDataDialog />`，不传任何 prop |
| 依赖（Vue） | 无 | 组件不 import 任何 Vue API，状态全在 composable 单例里 |

## 8. 注意事项与实现要点

- **四个组件里只有 `HfSelect` 与 `LegacyDataDialog` 有 `<style>` 块**：`StepBar.vue` / `NewProjectDialog.vue` 的视觉全部通过全局 `main.css` 类 + 模板行内 `style` 实现；`HfSelect.vue` 的 `.hf-sel*` 样式全在组件内部，**且弹层那段故意不带 `scoped`**；`LegacyDataDialog.vue` 只有一段 `<style scoped>`。
- **`.hf-select` / `.hgen-select` 已从 `main.css` 移除**：下拉（触发器 + 弹层）的视觉只归 `HfSelect` 管。
- **`done` 与 `active-now` 由 store 判定，不在此组件内计算**。
- **`selValue` 的 setter 仍是 no-op，这不是疏漏**：读新值必须走 HfSelect 给出的回调参数（旧文档里的 `event.target.value` 已不适用）。
- **下拉值即项目名**：`selValue.get`、选项 `:value="mp.name"`、`onSelect(name)` 三处一致。
- **HfSelect 的 `@change` 参数是字符串**：签名 `(value: string) => void`，不是 DOM Event；且**只在用户选中不同选项时**触发。
- **菜单必须 `Teleport` + `fixed`**：`.card` 与 `.hf-modal` 都有 `overflow: hidden`；`z-index: 9500` 是为了盖住 `.hf-modal-mask`（9000）。改动这两点会同时破坏所有 **20 个调用点**（**11 个文件**）在卡片/弹窗内的表现。
- **弹层字号必须自己声明，不能指望继承**：`.hf-sel-menu` 上的 `font-size: 13px` 不能删（理由见 5.9）。改这一处字号即对全部 20 个调用点生效。**Teleport 出去的 DOM 不只是丢 scoped 属性，也丢祖先的继承样式**。渲染层用 `Teleport` 的地方共 3 处：`components/HfSelect.vue` 1 处 + `pages/TextTtsPage/VoiceSection.vue` 2 处（两个弹窗）。
- **全局监听成对注册**：`document` 的 `mousedown`（capture）与 `window` 的 `scroll`（capture）/ `resize` 打开时挂、关闭时摘，`onBeforeUnmount` 再兜底摘一次。
- **`activeIndex` 是扁平下标**：分组只影响渲染，不影响键盘顺序；分组 `:key="g.label"` 用 label，现有调用方至多一个 `label: ''` 的匿名组。
- **切换后重进当前页**：`onSelect` 与 `onCreated` 都以 `goPage(props.page)` 收尾。
- **弹窗打开即清空**：`watch(visible)` 里重新赋 `''` 是刻意的。
- **`busy` 期间三重防抖**：`close()` 提前返回、`submit()` 提前返回、两个按钮 `:disabled`。
- **ESC 监听只在弹窗可见时生效**：`onKeydown` 内部判 `props.visible`（HfSelect 的 `Escape` 只作用于它自己的 listbox）。
- **异步错误未捕获（与项目现状一致）**：`switchProject` / `goPage` / `projectTools.create` 均未包 `try/catch`。
- **跨目录导入统一走 `@renderer` 别名**（遵循根 `AGENTS.md` 约定 7）。
- **依赖分界遵循约定 8**：`useAppStore` / `useToast` 属于 `composables/`；`HfSelect` 自身不引入任何 composable / 工具函数。
- **HfSelect 的选项契约只认 `value`**：**调用方必须提供 `value`**，写成别名会让所有选项 `value === undefined`。现有 11 个调用方都满足该契约（`TextTtsPage` 的 `VoiceOption` 直接用 `value` 作音色键）。
- **HfSelect 未全局注册**：每个使用方都要显式 import（含 `HfSelectGroup` 类型）。
- **旧数据弹窗刻意不走 props / emits**：改显隐语义要改 composable，而不是在 `App.vue` 里加 `v-if`。
- **危险按钮的样式必须自己重写 hover**：与设计规范里「主按钮 hover 必须重写 `background`」是同一条规律。
- **旧数据弹窗的「不可恢复」是有主进程兜底的**：界面只回传三种动作，路径校验与缓存清理都在 `src/main/index.ts`。
- **旧数据弹窗的文案改写点有两处**：`useLegacyData.ts` 的 `ENTRY_LABEL`（主进程白名单新增条目时要同步补）与 `LegacyDataDialog.vue` 模板里的三条动作说明与按钮文字。
