# src/renderer/src/components/（通用组件）

> 目录级一篇：链路状态条 `StepBar.vue` + 新建项目弹窗 `NewProjectDialog.vue` + 全局自定义下拉 `HfSelect.vue`

- **覆盖文件**：`components/` 目录（链路状态条 `StepBar.vue` + 新建项目弹窗 `NewProjectDialog.vue` + 全局自定义下拉 `HfSelect.vue`；文件行数随迭代变化，不写死）
- **所在目录**：`src/renderer/src/components/`
- **类型**：通用组件（单文件组件，`<script setup lang="ts">`）。`StepBar.vue` / `NewProjectDialog.vue` **都没有 `<style>` 块**，样式来自全局 `assets/main.css`；`HfSelect.vue` **自带两个 `<style>` 块**（触发器用 `<style scoped>`、Teleport 弹层用不带 `scoped` 的 `<style>`），下拉的全部视觉不依赖 `main.css`。
- **对外导出**：
  - `StepBar`：默认导出组件；**props**：`page: PageKey`（必填）；**emits**：无（自身直接调用 `goPage` / `switchProject`）
  - `NewProjectDialog`：默认导出组件；**props**：`{ visible: boolean }`；**emits**：`update:visible(value: boolean)`、`created(name: string)`
  - `HfSelect`：默认导出组件；**props**：`modelValue: string`（必填，配 `v-model`）、`groups: HfSelectGroup[]`（必填）、`placeholder?: string`（默认 `'请选择…'`）、`emptyText?: string`（默认 `'（暂无可选项）'`）、`disabled?: boolean`（默认 `false`）、`title?: string`（默认 `''`）、`style?: string | Record<string, string>`（默认 `'flex:1'`）；**emits**：`update:modelValue(value: string)`、`change(value: string)`；**导出类型**：`HfSelectOption`（`value: string`、`label: string`、`disabled?: boolean`、`title?: string`）、`HfSelectGroup`（`label: string`、`options: HfSelectOption[]`）

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
- `:class` 绑定为数组形式 `[当前态类, 完成态类]`，即 `${active-now}` 与 `${done}` 可以**同时存在**；样式优先级由 `main.css` 中的规则顺序决定（`.done .step-dot` 在 `.active-now .step-dot` 之前，故当前节点圆点取电子蓝并带 `stepPulse` 脉冲动画）。
- 「配音」节点只有 `isPage('text-tts')` 一个条件：原独立「音色管理」页（`sound-copy`）已下线，其能力并入配音页的第三个 Tab，页面键与 `isPage('sound-copy')` 判定都已删除。

### 2.3 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `props` | `defineProps<{ page: PageKey }>()` | 必填 prop，标识当前所在页面，用于高亮与「切换后重进本页」 |
| `isPage` | `(pg: string) => boolean` | `props.page === pg`，模板中反复使用 |
| `contentDone` / `audioDone` / `subDone` / `htmlDone` / `videoDone` | `ComputedRef<boolean>` | 分别直接绑定 `hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo` |
| `projectGroups` | `ComputedRef<HfSelectGroup[]>` | 下拉数据：单组 `{ label: '', options }`，选项 `value` 为裸项目名、`label` 带产物后缀（见 2.4） |
| `selValue` | `computed({ get, set })` | `get`：`appState.currentName`（**下拉值就是项目名，无前缀**）；`set`：**空实现（no-op）** |
| `newVisible` | `ref(false)` | 新建项目弹窗可见性（唯一新增的本地状态） |
| `onSelect(name: string)` | `async function` | 下拉切换处理（参数即新选中的项目名，**不再读 `event.target.value`**） |
| `onCreated()` | `async function` | 弹窗创建成功后的回调，只 `goPage(props.page)` |
| `openFolder()` | `function` | 打开当前项目所在目录 |

### 2.4 下拉选项结构

`projectGroups` 固定为**一个组**（组标题 `label: ''`，HfSelect 对空 label 不渲染分组标题行）：

| 条件 | 选项 `value` | 选项显示文本 |
| --- | --- | --- |
| `appState.myProjects.length === 0` | —（没有选项） | 下拉触发器显示占位文案「暂无项目，请先「新建项目」」 |
| `v-for="mp in appState.myProjects"` | `mp.name` | `mp.name` +（`mp.hasHtml ? ' · HTML✓' : ''`）+（`mp.hasVideo ? ' · 视频✓' : ''`） |

下拉只有「我的项目」一组选项（无分组标签），选项值就是裸项目名；项目列表为空时不生成任何选项，触发器回落 `HfSelect` 的 `placeholder`（即「暂无项目，请先「新建项目」」），弹层则由 `emptyText` 默认值「（暂无可选项）」兜底。

## 3. `StepBar.vue` 关键流程

### 3.1 切换工作项目（`onSelect`）

1. 触发时机：工作项目下拉选中项变化（`@change`）——HfSelect 只在用户**选中与当前值不同的选项**时发 `change`，重复选中同项不发事件。
2. **新选中值由下拉的 `change` 事件直接给出**：不要依赖 `selValue` —— 它是 setter 为 no-op 的 `computed`（HfSelect 的 `update:modelValue` 写回被忽略，值始终来自 `appState.currentName`），`@change` 时它的 getter 仍返回**旧项目**的值。旧写法（读原生 `<select>` 的 `event.target.value`）已不适用。
3. 空值保护：`if (!name) return`（防御性判断，正常选项值都是非空项目名）。
4. `await switchProject(name)`：写入 `appState.currentName`、`saveProjectCtx()` 落盘到 `localStorage['myapp.projectCtx']`，再 `refreshProject()`。**单参数**（项目名）。
5. `await goPage(props.page)`：**重进当前页**（刷新全部状态、递增 `pageNavKey` 强制页面组件重挂载），而不是跳到首页。
6. 因为 `selValue` 的 getter 依赖 `appState.currentName`，切换完成后下拉框显示值自动与新项目一致，无需在 setter 中处理。

### 3.2 新建项目（交给弹窗）

1. 点击「新建项目」→ 只执行 `newVisible = true`。
2. `NewProjectDialog` 完成「创建 + 刷新 + 切换」后 emit `created`。
3. 本组件 `onCreated()` **只做一件事**：`await goPage(props.page)` —— 重进当前页刷新数据；创建/切换与提示都在弹窗内（见第 4 节）。

### 3.3 打开目录（`openFolder`）

`window.projectTools.openFolder(appState.currentName)` —— **恒以当前项目名为入参**，没有其它分支。

## 4. `NewProjectDialog.vue`

### 4.1 模板结构

| 名称 | 说明 |
| --- | --- |
| `div.hf-modal-mask` | 遮罩，`v-show="visible"`，`@click.self="close"`（点遮罩关闭，点子元素不关） |
| `div.hf-modal` | 弹窗本体，行内 `style="width:min(460px,92vw)"` |
| `.hf-modal-head` | 标题「新建项目」+ `.hf-modal-close`（`×`，`title="关闭"`，`@click="close"`） |
| `.hf-modal-body` | `.panel-title-sm`「项目名称」+ `input.hgen-input`（`ref="nameEl"`、`v-model="name"`、`placeholder="例如：产品介绍短片"`、`@keydown.enter="submit"`）+ `.hgen-tip` 说明「确认后立即创建并切换到新项目；项目数据保存在本机（一个项目一个目录）。」 |
| `.hf-modal-foot` | 「取消」（`.hf-btn`，`:disabled="busy"`，`@click="close"`）+「创建并切换」（`.hf-btn.hf-btn-primary`，`:disabled="busy"`，文案 `busy ? '创建中…' : '创建并切换'`，`@click="submit"`） |

### 4.2 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `props` | `defineProps<{ visible: boolean }>()` | 由父组件用 `v-model:visible` 双向绑定 |
| `emit` | `defineEmits` | `update:visible(value)`、`created(name)` |
| `name` | `ref('')` | 输入中的项目名 |
| `busy` | `ref(false)` | 创建进行中标志；`true` 时禁止关闭、禁止重复提交、两个按钮置灰 |
| `nameEl` | `ref<HTMLInputElement \| null>(null)` | 输入框模板引用，用于自动聚焦与校验失败后回焦 |
| `watch(() => props.visible)` | `watch` | 每次**打开**时清空 `name` 并 `await nextTick()` 后 `focus()`（避免上一次残留的名字被误提交） |
| `close()` | `function` | `if (busy.value) return`；否则 `emit('update:visible', false)` |
| `submit()` | `async function` | 见 4.3 |
| `onKeydown(e)` | `function` | `e.key === 'Escape' && props.visible` 时 `close()` |

生命周期：`onMounted` 用 `document.addEventListener('keydown', onKeydown)` 注册，`onBeforeUnmount` 成对注销（沿用项目既有惯例）。输入框的 Enter 由模板 `@keydown.enter="submit"` 承担，**不**进全局监听。

### 4.3 提交流程（`submit`）

1. `if (busy.value) return`（并发守卫，按钮本身也已 `:disabled`）。
2. `const nm = name.value.trim()`；空名 → `toast('请输入项目名')` + 回焦输入框 + `return`。
3. `busy.value = true`，随后整段包在 `try { … } finally { busy.value = false }` 中。
4. `const res = await window.projectTools.create(nm)`；`!res || !res.ok` → `toast(res.message || '创建失败')` 并 `return` —— **弹窗保持打开**，用户可直接改名重试。
5. 成功路径：`await refreshProject()`（列表里出现新项目）→ `await switchProject(nm)`（写上下文 + 加载详情）→ `emit('update:visible', false)`（关闭弹窗）→ `emit('created', nm)`（父组件据此重进当前页）→ `toast('已创建并切换到项目「' + nm + '」')`。
6. `finally` 复位 `busy`。

> 顺序要点：**先 `refreshProject()` 再 `switchProject()`**。反过来会让 `switchProject` 内部的 `refreshProject()` 用一份还没有新项目的列表做回退判定，`currentName` 可能被改回旧项目。

## 5. `HfSelect.vue`

### 5.1 根元素与模板结构

| 名称 | 说明 |
| --- | --- |
| `div.hf-sel` | 根元素（**单根**，便于父组件用模板 ref 取 `$el`）：`ref="triggerEl"`、`:class="{ open, disabled: props.disabled }"`、`:style="props.style"`、`:title="props.title"` |
| `button.hf-sel-trigger` | 触发器：`type="button"`、`:disabled="props.disabled"`、`:aria-expanded="open"`、`aria-haspopup="listbox"`、`@click="toggle"`、`@keydown="onTriggerKeydown"` |
| `span.hf-sel-text` | 显示值：`:class="{ ph: displayText === '' }"`（无匹配项时加占位态类），文案 `displayText \|\| props.placeholder` |
| `span.hf-sel-caret` | 自绘三角箭头，`aria-hidden="true"`；`.hf-sel.open` 时旋转 180° |
| `Teleport to="body"` | 弹层出口：菜单被挂到 `body` 下（见 5.5） |
| `div.hf-sel-menu` | 弹层：`v-if="open"`、`ref="listEl"`、`:style="menuStyle"`、`role="listbox"`、`tabindex="-1"`、`@mousedown.prevent`、`@keydown="onMenuKeydown"` |
| `div.hf-sel-group` | 分组容器：`v-for="g in groups" :key="g.label"`（`groups` 非空时渲染） |
| `div.hf-sel-group-label` | 分组标题：`v-if="g.label"`（**空 label 不渲染标题行**，用于匿名单组） |
| `div.hf-sel-opt` | 选项：`v-for="o in g.options" :key="String(o.value)"`、`:class="{ on: o.value === props.modelValue, dis: !!o.disabled }"`、`:title="o.title \|\| o.label"`、`@click="pick(o)"` |
| `span.hf-sel-opt-text` / `span.hf-sel-tick` | 选项文本 + 自绘选中勾（`.on` 时才显示） |
| `div.hf-sel-empty` | `groups` 为空时渲染的唯一子节点，显示 `props.emptyText` |

### 5.2 props / emits / 导出类型

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `modelValue` | `string`（必填） | 当前值，配 `v-model`；无匹配选项时触发器显示 `placeholder` |
| `groups` | `HfSelectGroup[]`（必填） | 分组选项；`allOptions` 由它扁平化而来 |
| `placeholder` | `string`（默认 `'请选择…'`） | 无匹配项时触发器的文案 |
| `emptyText` | `string`（默认 `'（暂无可选项）'`） | `groups` 为空时弹层内的文案 |
| `disabled` | `boolean`（默认 `false`） | 禁用触发器（opacity 降低、`cursor:not-allowed`），`openMenu` 也会直接返回 |
| `title` | `string`（默认 `''`） | 根元素的 `title` 提示 |
| `style` | `string \| Record<string, string>`（默认 `'flex:1'`） | 直接绑到根元素，**宽度/布局交给父组件**（需固定宽度就传 `style`，如 `"width:210px;flex:none"`） |
| `update:modelValue` | emit `(value: string)` | 选中新值时写出 |
| `change` | emit `(value: string)` | 与 `update:modelValue` 同时发出，**参数是新值字符串**，不是 DOM Event |
| `HfSelectOption` | `interface`（`export`） | `value: string`、`label: string`、`disabled?: boolean`、`title?: string` |
| `HfSelectGroup` | `interface`（`export`） | `label: string`、`options: HfSelectOption[]` |

### 5.3 状态与 computed

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `open` | `ref(false)` | 弹层开关，同时驱动 `v-if` 与根元素 `.open` 类 |
| `triggerEl` / `listEl` | `ref<HTMLElement \| null>` | 根元素与弹层 DOM，用于定位测量与「点在内/外」判定 |
| `allOptions` | `ComputedRef<HfSelectOption[]>` | `groups.flatMap((g) => g.options)`，键盘导航与查找都基于这份**扁平**列表 |
| `current` | `ComputedRef<HfSelectOption \| null>` | `allOptions` 中 `value === modelValue` 的项，找不到为 `null` |
| `displayText` | `ComputedRef<string>` | `current ? current.label : ''`；为空串时触发器走 placeholder 分支 |
| `menuStyle` | `ref<Record<string, string>>({})` | `placeMenu` 写出的 `left` / `top` / `width` / `maxHeight` 四个行内样式 |
| `activeIndex` | `ref(-1)` | 键盘高亮下标，**扁平列表下标**（与分组无关），`watch(open)` 播种 |

### 5.4 函数与监听

| 名称 | 说明 |
| --- | --- |
| `win()` | 安全返回 `window`（`typeof window === 'undefined'` 时返回 `null`） |
| `placeMenu()` | 计算并写入 `menuStyle`（见 5.5） |
| `onReposition()` | 仅当 `open` 时重算，作为 `scroll` / `resize` 监听器 |
| `bindGlobal()` / `unbindGlobal()` | 在 `window` 上注册/注销 `scroll`（**capture 阶段**）与 `resize` |
| `openMenu()`（async） | 已打开或 `disabled` 时返回；置 `open = true` → 在 `document` 上注册 `mousedown`（capture）→ `bindGlobal()` → `await nextTick()` → `placeMenu()` → `listEl.focus()` |
| `closeMenu(focusTrigger = false)` | 已关闭时返回；置 `open = false` → 注销 `mousedown` 与全局监听；`focusTrigger` 为真时把焦点还给触发器按钮（`triggerEl.querySelector('button')?.focus()`） |
| `toggle()` | `open ? closeMenu() : void openMenu()` |
| `onOutside(e: MouseEvent)` | 点击目标的 `contains` 判定：命中 `triggerEl` 或 `listEl` 则忽略，否则 `closeMenu()`（不带回焦） |
| `pick(o)` | 选择：`o.disabled` 直接返回；`closeMenu(true)`；**`o.value === modelValue` 时直接返回、不发任何事件**；否则依次 `emit('update:modelValue', o.value)`、`emit('change', o.value)` |
| `highlight(i)` | 对第 i 个 `.hf-sel-opt` 调 `scrollIntoView({ block: 'nearest' })` |
| `move(delta)` | 在扁平列表内循环移动 `activeIndex`，跳过 `disabled` 项（最多绕一圈找可用项），随后 `highlight` |
| `commitActive()` | 提交当前高亮项（非 `disabled` 时走 `pick`） |
| `onMenuKeydown(e)` | 菜单键盘：`ArrowDown` / `ArrowUp`（`preventDefault` + `move(±1)`）、`Enter`（`preventDefault` + `commitActive`）、`Escape`（`preventDefault` + `closeMenu(true)`）、`Tab`（仅 `closeMenu()`，不阻止默认，让焦点正常离开） |
| `onTriggerKeydown(e)` | 触发器键盘：`ArrowDown` / `ArrowUp` / `Enter` / `Space` 一律 `preventDefault` 后 `openMenu()` |
| `watch(open)` | 打开时播种 `activeIndex`：优先取「当前值且未禁用」项的下标，否则取第一个未禁用项（都没有则保持 `-1`） |
| `watch(() => props.groups)` | 引用变化且菜单正开着时 `nextTick(placeMenu)` 重新测高（父组件异步填充下拉数据的场景） |
| `onBeforeUnmount` | 注销 `document` 的 `mousedown` 与 `window` 的 `scroll` / `resize`（打开状态下被卸载也不会残留监听） |

### 5.5 弹层定位算法（`placeMenu`）

弹层样式为 `position: fixed`（在样式类里给出），坐标全部由 JS 实时测量，**不依赖任何祖先的 `overflow` 或定位上下文**：

1. `r = triggerEl.getBoundingClientRect()`；`width = Math.max(r.width, 220)`（至少 220px）。
2. 水平钳制：`left = Math.min(Math.max(8, r.left), Math.max(8, w.innerWidth - width - 8))`——左右各留 8px 边距，窄窗口下优先贴左。
3. 间距 `gap = 6`；理想高度 `idealH`：首帧 `listEl` 还没渲染时按 `Math.min(allOptions.length * 34 + 12, 300)` 估算，渲染出来后改用实测的 `listEl.scrollHeight + 12`。
4. 上下空间：`below = innerHeight - r.bottom - gap - 8`、`above = r.top - gap - 8`；**只有**下方装不下理想高度、且上方空间更大（`flip = below < idealH && above > below`）时才向上翻转。
5. 可用高度：`room = Math.max(120, flip ? above : below)`（保留至少 120px），`height = Math.min(idealH, room)`——因此菜单 `max-height` 实际落在 **120 ~ 300px** 区间；选项多时靠 `.hf-sel-menu` 的 `overflow-y: auto` 滚动。
6. 上边界：向上翻时 `top = Math.max(8, r.top - gap - height)`；向下时 `top = Math.min(r.bottom + gap, Math.max(8, innerHeight - height - 8))`——都保证不越出视口。
7. 写入 `menuStyle = { left, top, width, maxHeight }`（`px` 字符串）。

**为什么 Teleport 到 `body` + `fixed`**：卡片 `.card`（`main.css`）与弹窗 `.hf-modal` 都用了 `overflow: hidden`，菜单若渲染在组件自身 DOM 内会被这些祖先裁掉；挂到 `body` 下并用 `fixed` 坐标即可溢出任何祖先，且 `z-index: 9500` **高于 `.hf-modal-mask` 的 `z-index: 9000`**，弹窗内部的下拉也能盖住弹窗本体。

### 5.6 交互与键盘

- **打开**：点触发器，或在触发器上按 `ArrowDown` / `ArrowUp` / `Enter` / `Space`；`openMenu` 内部 `nextTick` 后定位并 `listEl.focus()`，把键盘焦点交给 `tabindex="-1"` 的 listbox。
- **关闭**：再点触发器（`toggle`）、按 `Escape`、按 `Tab`、或在组件外按下鼠标（`document` 上 **capture 阶段**的 `mousedown` → `onOutside`）。前两条会把焦点还给触发器；点外部关闭不回焦。
- **菜单上的 `@mousedown.prevent`**：阻止默认行为以**保住 listbox 自身的焦点**——点击选项时焦点不会跑掉，随后菜单上的键盘事件（上下键 / Enter）仍然有效。
- **键盘导航**：`activeIndex` 在打开时按当前值播种，`move(±1)` 循环绕行并跳过 `disabled` 项，`highlight` 用 `scrollIntoView({ block: 'nearest' })` 保证高亮项可见；`Enter` 提交高亮项，行为与鼠标点击 `pick` 完全一致。
- **滚动 / 缩放跟随**：打开期间 `window` 的 `scroll`（capture，任意祖先容器滚动都能收到）与 `resize` 都触发 `placeMenu`；关闭或卸载时成对注销。
- **选中态**：选项 `.on` 由 `o.value === modelValue` 判定（渐变高亮 + 自带勾），`disabled` 项加 `.dis`（既不能点也不进键盘高亮）。

### 5.7 值语义：程序化赋值 vs 用户选择

- 用户选中**不同**的值：`pick()` 先关菜单，再依次 emit `update:modelValue` 与 `change`（两者参数都是新值字符串）。`@change` 因此可以安全承载「切换副作用」（如 StepBar 切换项目、写入设置、弹目录选择框）。
- 用户选中**当前值**：`pick()` 提前返回，**不发任何事件**（与原生的重复选择语义一致，避免无意义的副作用）。
- 父组件**程序化改值**（含 `v-model` 回退、异步填充后改选）：只改 `modelValue`、**不会**触发 `change`——与原生 `<select>` 上 `el.value = x` 不发 `change` 一致，`SynthSection` 的「自定义目录…取消选择后回退上一项」正是依赖这一点避免递归。
- `disabled` 项：`pick` 直接返回，`move` 跳过，不会成为 `update:modelValue` / `change` 的来源。

### 5.8 为什么取代原生 `<select>`

原生 `<option>` 弹层由操作系统/浏览器绘制，CSS 无法控制其行高、间距、圆角、配色与选中勾，深色科技主题下表现为「选项贴在一起、当前项看不出」，属于改不动的视觉问题。`HfSelect` 用 `button` + `Teleport` 弹层换成完全可控的列表（每个选项独立成行、`:hover` 主色底、`.on` 渐变高亮 + 自绘勾、入场动画），并把宽度/布局交回父组件（默认 `flex:1`，与旧控件 `.hgen-select` 的行内 `flex:1` 等价）。相应地，**`.hf-select` / `.hgen-select` 已从 `src/renderer/src/assets/main.css` 中删除**，下拉的全部视觉由本组件自带的两段 `<style>` 负责，类名统一 `hf-sel` 前缀：`.hf-sel` / `.hf-sel-trigger` / `.hf-sel-text`（`.ph` 占位态）/ `.hf-sel-caret` / `.hf-sel-menu`（`position: fixed`、`z-index: 9500`、`overflow-y: auto`、`@keyframes hfSelIn`）/ `.hf-sel-group` / `.hf-sel-group-label` / `.hf-sel-opt`（`.on` / `.dis`）/ `.hf-sel-opt-text` / `.hf-sel-tick` / `.hf-sel-empty`。其中触发器样式在 `<style scoped>` 里，弹层样式在不带 `scoped` 的 `<style>` 块里（因为 DOM 已被 Teleport 到 `body`）。

### 5.9 调用点清单

组件未做全局注册，每个使用方都显式 `import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'`（部分还引入 `type HfSelectOption`）。全仓 `*.vue` grep 结果：

| 文件 | 使用处（绑定模型） |
| --- | --- |
| `components/StepBar.vue` | `selValue`（工作项目切换），1 处 |
| `pages/SettingsPage/index.vue` | `vModel`（千问语音模型）、`rQuality`（渲染质量）、`rFps`（渲染帧率），3 处 |
| `pages/HtmlGenPage/index.vue` | `subSel`（字幕逐条设计动画）、`videoSel`（视频素材）、`audioPick`（背景音频）、`quality` / `fps`（渲染档位，带 `:disabled="rendering"`），5 处 |
| `pages/SubtitlePage/TranscribeSection.vue` | `lang`（识别语言），1 处 |
| `pages/TextTtsPage/SynthSection.vue` | `voiceId`、`saveTo`（带 `@change`）、`genSelIdx`（带 `empty-text`），3 处 |
| `pages/TextTtsPage/AlignSection.vue` | `subSrc`（带 `@change`）、`voiceId`，2 处 |
| `pages/TextTtsPage/VoiceSection.vue` | `vcModel`（带 `@change`）、`mapVoice`（带 `ref`）、`mapModel`，3 处 |

合计 18 个使用处。各调用方的 `groups` 均由 `computed`（或常量）构造为 `{ label, options: [{ value, label }] }`；`TextTtsPage/SynthSection.vue` 与 `AlignSection.vue` 的 `:groups="voiceGroups"` 也一样合规——`helpers.ts` 的 `VoiceOption` 直接以 `value` 为音色键（刻意与 `HfSelectOption` 同名），因此**可以直接透传**、无需中间映射。

## 6. 依赖与协作

### 6.1 `StepBar.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `computed`、`ref` | `projectGroups` / `selValue` / 完成态 `computed`、弹窗可见性 |
| 依赖 | `@renderer/composables/useAppStore` | `appState`（`myProjects` / `currentName`）、`hasAudio`、`hasContent`、`hasHtml`、`hasSubtitle`、`hasVideo`、`switchProject`、类型 `PageKey` |
| 依赖 | `@renderer/pages` | `goPage`（跳转与刷新） |
| 依赖 | `@renderer/components/HfSelect.vue` | 第二行的「工作项目」下拉（默认导出 + 类型 `HfSelectGroup`） |
| 依赖 | `@renderer/components/NewProjectDialog.vue` | 新建项目弹窗 |
| 依赖（preload 桥） | `window.projectTools.openFolder` | 打开当前项目目录；类型由 `src/shared/types.ts` ⑨ 节的 `PreloadApi` 定义、经 `src/preload/index.d.ts` 的 `interface Window extends PreloadApi` 暴露给渲染层 |
| 依赖（样式） | `assets/main.css` | `.project-bar` / `.project-bar-row` / `.step-chain` / `.step-node` / `.step-node.clickable` / `.step-dot` / `.done` / `.active-now` / `.step-arrow` / `@keyframes stepPulse`，以及公共控件 `.hf-btn`。**`main.css` 中的 `.hf-select` / `.hgen-select` 已被删除**：下拉外观完全由 `HfSelect` 组件自带，本组件只传行内 `style="width:210px;flex:none"` |
| 被使用 | 各页面组件（内容脚本 / 配音 / 字幕 / HTML / 视频预览） | 页面模板顶部 `<StepBar :page="..."/>` |
| 间接协作 | `src/renderer/src/App.vue` | 菜单跳转改变 `currentPage`，页面重挂载后由新页面重新传入 `page` prop，从而更新高亮 |

### 6.2 `NewProjectDialog.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `nextTick`、`onBeforeUnmount`、`onMounted`、`ref`、`watch` | 打开时清空并聚焦、ESC 监听成对注册 |
| 依赖 | `@renderer/composables/useAppStore` | `refreshProject`、`switchProject` |
| 依赖 | `@renderer/composables/useToast` | `toast(msg)` 轻提示 |
| 依赖（preload 桥） | `window.projectTools.create` | 新建项目（`project:create`） |
| 依赖（样式） | `assets/main.css` | `.hf-modal-mask` / `.hf-modal` / `.hf-modal-head` / `.hf-modal-title` / `.hf-modal-close` / `.hf-modal-body` / `.hf-modal-foot`、`.hgen-input` / `.hgen-tip` / `.hf-btn` / `.hf-btn-primary`、`.panel-title-sm` |
| 被使用 | `components/StepBar.vue` | `v-model:visible` + `@created`；目前是唯一使用方（首页不再有新建入口） |

### 6.3 `HfSelect.vue`

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `computed`、`nextTick`、`onBeforeUnmount`、`ref`、`watch` | 扁平化选项与显示值、打开后定位、成对清理全局监听 |
| 依赖（浏览器 API） | `Teleport`（Vue 内置）、`getBoundingClientRect`、`scrollIntoView`、`document` / `window` 事件 | 弹层挂到 `body`、fixed 定位测量、键盘高亮滚动、外部点击与滚动跟随 |
| 依赖（样式） | 组件自带 `<style scoped>` + 不带 `scoped` 的 `<style>` | `.hf-sel*` 全部类；不依赖 `assets/main.css`（其中的 `.hf-select` / `.hgen-select` 已删除） |
| 被使用 | `components/StepBar.vue`、`pages/SettingsPage/index.vue`、`pages/HtmlGenPage/index.vue`、`pages/SubtitlePage/TranscribeSection.vue`、`pages/TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue` | 共 18 个下拉实例（见 5.9）；无全局注册，逐个显式 import |
| 协作（插入层） | `assets/main.css` 的 `.hf-modal-mask`（`z-index: 9000`） | 菜单 `z-index: 9500` 必须保持高于它，弹窗内的下拉才不会被遮住 |

## 7. 注意事项与实现要点

- **三个组件里只有 `HfSelect` 有 `<style>` 块**：`StepBar.vue` / `NewProjectDialog.vue` 的视觉全部通过全局 `main.css` 类 + 模板行内 `style` 实现，在它们内新增 class 时必须同步在 `main.css` 里补样式；`HfSelect.vue` 则相反——它的 `.hf-sel*` 样式全在组件内部，**且弹层那段故意不带 `scoped`**（Teleport 到 `body` 的 DOM 收不到 scoped 属性），改样式时要认准这两段。
- **`.hf-select` / `.hgen-select` 已从 `main.css` 移除**：任何「给下拉改样式要动 `main.css`」的旧结论都已失效，下拉（触发器 + 弹层）的视觉只归 `HfSelect` 管；`StepBar` 也只剩 `style="width:210px;flex:none"` 这样的布局行内样式。
- **`done` 与 `active-now` 由 store 判定，不在此组件内计算**：`hasHtml` 要求 `htmlExists && htmlPath` 同时成立，其余几个也都只看当前项目自身的产物字段。
- **`selValue` 的 setter 仍是 no-op，这不是疏漏**：HfSelect 的 `v-model` 写回会被忽略，显示值始终来自 `appState.currentName`，真正的切换逻辑统一在 `@change="onSelect"` 中处理；任何「改 setter 就能切换」的假设都是错误的，读新值必须走 HfSelect 给出的回调参数（旧文档里的 `event.target.value` 已不适用）。
- **下拉值即项目名**：`selValue.get` 返回裸 `appState.currentName`，`projectGroups` 的选项 `:value="mp.name"` 也是裸项目名，`onSelect(name)` 收到的就是新选中值 —— 三处一致，不需要任何前缀或字符串偏移；空字符串只可能来自未来的占位选项，`onSelect` 保留了 `if (!name) return` 防御。
- **HfSelect 的 `@change` 参数是字符串**：签名 `(value: string) => void`，不是 DOM Event；且**只在用户选中不同选项时**触发，程序化改值不触发。`pick()` 在 `o.value === modelValue` 时提前返回、连 `update:modelValue` 都不发。
- **菜单必须 `Teleport` + `fixed`**：`.card` 与 `.hf-modal` 都有 `overflow: hidden`，菜单留在组件内会被裁掉；`z-index: 9500` 是为了盖住 `.hf-modal-mask`（9000）。改动这两点会同时破坏所有 18 个调用点在卡片/弹窗内的表现。
- **全局监听成对注册**：`document` 的 `mousedown`（capture）与 `window` 的 `scroll`（capture）/ `resize` 在打开时挂、关闭时摘，`onBeforeUnmount` 再兜底摘一次；菜单上的 `@mousedown.prevent` 是为了让 listbox 保住焦点，键盘导航才不会中断。
- **`activeIndex` 是扁平下标**：`watch(open)` 按「当前值 → 第一个可用项」播种，`move` 循环绕行跳过 `disabled`；分组只影响渲染，不影响键盘顺序。另注意分组 `:key="g.label"` 用的是 label，现有调用方至多一个 `label: ''` 的匿名组，不会撞 key。
- **切换后重进当前页**：`onSelect` 与 `onCreated` 都以 `goPage(props.page)` 收尾，依赖 `pageNavKey` 的自增来强制页面重挂载，这是「切换 / 新建项目后页面数据不残留」的关键。
- **弹窗打开即清空**：`watch(visible)` 里重新赋 `''` 是刻意的——弹窗实例常驻（`v-show`），不清空会带出上一次的输入。
- **`busy` 期间三重防抖**：`close()` 提前返回（Esc / 遮罩 / 取消 / `×` 全都走 `close()`）、`submit()` 提前返回、两个按钮 `:disabled` —— 避免「创建中反复点击 / 关掉弹窗但 IPC 仍在跑」的错乱。
- **ESC 监听只在弹窗可见时生效**：`onKeydown` 内部判 `props.visible`，所以常驻的全局监听不会吞掉其它页面的 Esc；注册/注销在 `onMounted` / `onBeforeUnmount` 成对完成（HfSelect 的 `Escape` 只作用于它自己的 listbox，不注册全局 keydown）。
- **异步错误未捕获（与项目现状一致）**：`switchProject` / `goPage` / `projectTools.create` 均未包 `try/catch`（`create` 有 `!res || !res.ok` 判断，但 IPC 异常仍可能 reject）；`finally` 只负责复位 `busy`。
- **模板作用域可使用 `window`**：三个组件的交互逻辑都写在 `script setup` 的函数体内，函数体内 `window.projectTools` 是模块作用域访问，不需要包装函数。
- **跨目录导入统一走 `@renderer` 别名**：`@renderer/composables/useAppStore`、`@renderer/composables/useToast`、`@renderer/pages`、`@renderer/components/NewProjectDialog.vue`、`@renderer/components/HfSelect.vue`（遵循根目录 `agents.md` 规则 5）；同目录内部才用相对路径（`StepBar.vue` 导入同目录两个组件时仍写 `@renderer/components/...`）。
- **依赖分界遵循 `agents.md` 规则 6**：依赖的 `useAppStore` / `useToast` 属于 `composables/`（有状态、含 localStorage 与 Vue 响应式），因此放在 composables 而非 utils；`HfSelect` 自身不引入任何 composable / 工具函数，只用 Vue 与浏览器 API。
- **HfSelect 的选项契约只认 `value`**：`current` / `displayText` / `pick` / `activeIndex` 播种全部按 `o.value === modelValue` 判定，选项对象里其它键一律不参与取值与回传。**调用方必须提供 `value`**：写成 `voiceId` 之类的别名会让所有选项 `value === undefined`（触发器恒显示 `placeholder`、无选中高亮，点选回传 `undefined`）。现有调用方都满足该契约——`TextTtsPage` 的 `VoiceOption` 就直接用 `value` 作音色键，所以 `:groups="voiceGroups"` 可以原样透传。
- **HfSelect 未全局注册**：它只是 `components/` 下的普通共享组件，每个使用方都要显式 import（含 `HfSelectGroup` 类型）；新增下拉时照抄现有调用点的 `computed<HfSelectGroup[]>` 写法即可。
