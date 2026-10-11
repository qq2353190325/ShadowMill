# src/renderer/src/components/（通用组件）

> 项目链路状态条：五节点流水线 + 工作项目切换/新建/打开目录

- **覆盖文件**：`components/StepBar.vue`（本目录唯一文件）
- **所在目录**：`src/renderer/src/components/`
- **类型**：通用组件（单文件组件，`<script setup lang="ts">`；**无 `<style>` 块**，样式来自全局 `assets/main.css`）
- **规模**：104 行（模板 33 行 / 脚本 70 行 / 无样式块）
- **对外导出**：默认导出组件；**props**：`page: PageKey`（必填）；**emits**：无（组件自身直接调用 `goPage` 与 `toast`，不向父级抛事件）

## 1. 作用与职责

本组件是原 `window.App.renderStepBar` 的组件化替代物。原实现依赖 `[data-slot]` 占位注入机制，现已废弃：各页面模板顶部直接放 `<StepBar :page="..."/>` 即等效。它提供两块能力：

1. **第一行：五节点流水线可视化**——「内容脚本 → 配音 → 字幕 → HTML → 视频」的链路进度，节点既是状态指示器（`done` / `active-now`）又是跳转入口（可点击）。
2. **第二行：工作项目切换器**——所有节点页共用的全局项目入口：下拉切换「我的项目 / 内置示例」、新建项目、打开当前项目所在目录。

组件的状态判定**不自己计算**，而是直接引用 `useAppStore` 的 `computed`（`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo`），因此项目切换后状态自动同步。

## 2. 结构说明

### 2.1 根元素与模板区块

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `div.project-bar` | 根元素 | 带非标准属性 `data-roled="1"`（源码中的标记属性，仅作标识） |
| `div.project-bar-row`（第 1 个） | 行容器 | 承载 `.step-chain` 流程链 |
| `div.step-chain` | 链容器 | 5 个 `span.step-node.clickable`，节点间以 `span.step-arrow` 的 `→` 分隔 |
| `div.project-bar-row`（第 2 个） | 行容器 | 工作项目标签 + `<select>` + 新建输入框 + 两个按钮 |
| `span.sel-label` | 标签 | 文案「工作项目」，行内样式 `font-size:12px;color:var(--text-secondary);letter-spacing:1px;flex:none` |
| `select.hf-select` | 下拉 | `v-model="selValue"`、`@change="onSelect"`、行内 `width:210px;flex:none`、`title="切换工作项目（我的项目 / 内置示例只读）"` |
| `input.hgen-input` | 新建输入 | `v-show="showNewInput"`、`ref="newNameEl"`、`v-model="newName"`、`placeholder="新项目名"`、`@keydown.enter="createProject"`、`width:140px` |
| `button.hf-btn` | 按钮 | 两个：`@click="toggleNew"`（文案「新建项目」）、`@click="openFolder"`（文案「打开目录」） |

### 2.2 五节点链路（第一行）

| 顺序 | 节点文字 | 点击目标 | `active-now` 条件 | `done` 条件（源码常量） |
| --- | --- | --- | --- | --- |
| 1 | 内容脚本 | `goPage('content')` | `isPage('content')` | `contentDone`（`hasContent`） |
| 2 | 配音 | `goPage('text-tts')` | `isPage('text-tts') \|\| isPage('sound-copy')` | `audioDone`（`hasAudio`） |
| 3 | 字幕 | `goPage('subtitle')` | `isPage('subtitle')` | `subDone`（`hasSubtitle`） |
| 4 | HTML | `goPage('html-gen')` | `isPage('html-gen')` | `htmlDone`（`hasHtml`） |
| 5 | 视频 | `goPage('video-gen')` | `isPage('video-gen')` | `videoDone`（`hasVideo`） |

要点：

- 每个节点内部为 `<span class="step-dot"></span>` + 文字，圆点由 CSS 绘制（`.step-node .step-dot`）。
- `:class` 绑定为数组形式 `[当前态类, 完成态类]`，即 `${active-now}` 与 `${done}` 可以**同时存在**；样式优先级由 `main.css` 中的规则顺序决定（`.done .step-dot` 在 `.active-now .step-dot` 之前，故当前节点圆点取电子蓝并带 `stepPulse` 脉冲动画）。
- 「配音」节点特例：当页面是 `sound-copy`（音色复刻）时也点亮，因为两者同属配音环节；点击仍跳 `text-tts`。

### 2.3 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `props` | `defineProps<{ page: PageKey }>()` | 必填 prop，标识当前所在页面，用于高亮与"切换后重进本页" |
| `isPage` | `(pg: string) => boolean` | `props.page === pg`，模板中反复使用 |
| `contentDone` | `ComputedRef<boolean>` | 直接绑定 `hasContent` |
| `audioDone` | `ComputedRef<boolean>` | 直接绑定 `hasAudio` |
| `subDone` | `ComputedRef<boolean>` | 直接绑定 `hasSubtitle` |
| `htmlDone` | `ComputedRef<boolean>` | 直接绑定 `hasHtml` |
| `videoDone` | `ComputedRef<boolean>` | 直接绑定 `hasVideo` |
| `selValue` | `computed({ get, set })` | `get`：`(appState.isBuiltin ? 'builtin:' : 'my:') + appState.currentName`；`set`：**空实现（no-op）** |
| `showNewInput` | `ref(false)` | 控制新建输入框显隐 |
| `newName` | `ref('')` | 新建项目名输入值 |
| `newNameEl` | `ref<HTMLInputElement \| null>(null)` | 输入框模板引用，用于聚焦 |
| `onSelect(e: Event)` | `async function` | 下拉切换处理 |
| `toggleNew()` | `async function` | 切换输入框并聚焦 |
| `createProject()` | `async function` | 校验名称 → `projectTools.create` → 刷新/切换 → toast |
| `openFolder()` | `function` | 按当前项目形态分流打开目录 |

### 2.4 下拉选项结构

| `<optgroup label>` | 数据源 | 选项 `value` | 选项显示文本 |
| --- | --- | --- | --- |
| `我的项目` | `appState.myProjects` | `'my:' + mp.name` | `mp.name` + （`mp.hasHtml ? ' · HTML✓' : ''`）+（`mp.hasVideo ? ' · 视频✓' : ''`） |
| `内置示例` | `appState.builtinProjects` | `'builtin:' + b.name` | `b.name` + ` · 内置` |

两个 `optgroup` 都始终渲染（即使列表为空），保持结构稳定。

## 3. 关键流程

### 3.1 切换工作项目（`onSelect`）

1. 触发时机：`<select>` 的 `change` 事件。
2. **必须读 `event.target.value`**：`selValue` 是 setter 为 no-op 的 `computed`，因此 `@change` 触发时 `selValue` 仍返回**旧项目**的值；源码注释已明确说明。故取 `const v = (e.target as HTMLSelectElement).value`。
3. 空值保护：`if (!v) return`。
4. 前缀解析：`const isBuiltin = v.startsWith('builtin:')`。
5. 名称截取：`const name = v.slice(isBuiltin ? 8 : 3)`——`'builtin:'` 长度 8，`'my:'` 长度 3（**字面量偏移，改动前缀必须同步改这两个数字**）。
6. `await switchProject(name, isBuiltin)`：写入 `appState.currentName` / `isBuiltin`，`saveProjectCtx()` 落盘到 `localStorage['myapp.projectCtx']`，再 `refreshProject()`。
7. `await goPage(props.page)`：**重进当前页**（刷新全部状态、递增 `pageNavKey` 强制页面组件重挂载），而不是跳到首页。
8. 因为 `selValue` 的 getter 依赖 `appState.currentName` / `isBuiltin`，切换完成后下拉框显示值自动与新项目一致，无需在 setter 中处理。

### 3.2 新建项目（`toggleNew` → `createProject`）

1. 点击「新建项目」→ `toggleNew()` 取反 `showNewInput`。
2. 若变为可见：`await nextTick()` 确保 `v-show` 元素已插入 DOM，再 `newNameEl.value?.focus()` 自动聚焦。
3. 在输入框按回车（`@keydown.enter`）或再次点击按钮流程都会走到 `createProject()`。
4. `const nm = newName.value.trim()`；空名时 `toast('请输入项目名')` 并重新聚焦后 `return`。
5. `const res = await window.projectTools.create(nm)`。
6. 失败分支：`if (!res || !res.ok)` → `toast((res as { message?: string })?.message || '创建失败')` 并 `return`（保留输入内容以便改名重试）。
7. 成功分支：清空 `newName`、隐藏输入框（`showNewInput = false`）。
8. `await refreshProject()` 拉取最新项目列表（新项目此时才出现在下拉里）。
9. `await switchProject(nm, false)` 切到新项目（写入上下文并加载详情）。
10. `await goPage(props.page)` 重进当前页以刷新页面数据。
11. `toast('已创建并切换到项目「' + nm + '」')` 给出成功反馈。

### 3.3 打开目录（`openFolder`）

1. 判断 `appState.isBuiltin`：
   - **内置示例分支**：若 `appState.project && appState.project.htmlPath` 存在，调 `window.projectTools.openFolderOf(appState.project.htmlPath)` 定位到示例资源所在目录；否则（示例无 HTML 路径）`toast('内置示例项目为只读；可在「工作项目」切换到「我的项目」')` 后 `return`。
   - **我的项目分支**：`window.projectTools.openFolder(appState.currentName)`，按项目名打开项目目录。
2. 两个分支都直接返回，不产生其他副作用。

## 4. 依赖与协作

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `computed`、`nextTick`、`ref` | `selValue`、聚焦时序、输入框状态与模板引用 |
| 依赖 | `@renderer/composables/useAppStore` | `appState`（`myProjects` / `builtinProjects` / `currentName` / `isBuiltin` / `project`）、`hasAudio`、`hasContent`、`hasHtml`、`hasSubtitle`、`hasVideo`、`refreshProject`、`switchProject`、类型 `PageKey` |
| 依赖 | `@renderer/pages` | `goPage`（跳转与刷新） |
| 依赖 | `@renderer/composables/useToast` | `toast(msg)` 轻提示 |
| 依赖（preload 桥） | `window.projectTools.create` / `openFolder` / `openFolderOf` | 新建项目、打开项目目录、打开指定路径所在目录；类型由 `src/shared/types.ts` ⑨ 节的 `PreloadApi` 定义、经 `src/preload/index.d.ts` 的 `interface Window extends PreloadApi` 暴露给渲染层 |
| 依赖（样式） | `assets/main.css` | `.project-bar` / `.project-bar-row` / `.step-chain` / `.step-node` / `.step-node.clickable` / `.step-dot` / `.done` / `.active-now` / `.step-arrow` / `@keyframes stepPulse`，以及公共控件 `.hf-select` / `.hf-btn` / `.hgen-input` |
| 被使用 | 各页面组件（内容脚本 / 配音 / 字幕 / HTML / 视频 / 音色复刻等） | 页面模板顶部 `<StepBar :page="..."/>` |
| 间接协作 | `src/renderer/src/App.vue` | 菜单跳转改变 `currentPage`，页面重挂载后由新页面重新传入 `page` prop，从而更新高亮 |

## 5. 注意事项与实现要点

- **组件无 `<style>` 块**：所有视觉通过全局 `main.css` 类 + 模板行内 `style` 实现。在组件内新增 class 时必须同步在 `main.css` 里补样式，否则不生效。
- **`done` 与 `active-now` 由 store 判定，不在此组件内计算**：`hasHtml` 特别限定"非内置 + `htmlExists` + 有 `htmlPath`"，`hasSubtitle` / `hasAudio` / `hasContent` 也都带 `!appState.isBuiltin` 前置条件——内置示例永远不显示"已完成"，这是刻意设计（示例资源不是用户产物）。`hasVideo` 则没有该前置判断。
- **`selValue` 的 setter 是 no-op，这不是疏漏**：`<select v-model>` 在 change 时仍会尝试写回 setter（被忽略），真正的切换逻辑统一在 `@change="onSelect"` 中处理；任何"改 setter 就能切换"的假设都是错误的，读新值必须走 `event.target.value`。
- **前缀偏移量硬编码**：`v.slice(isBuiltin ? 8 : 3)` 与 `'builtin:'` / `'my:'` 字面量强耦合，前缀变更必须同时改三处（`selValue.get`、`option :value`、`onSelect`）。
- **切换后重进当前页**：`onSelect` 与 `createProject` 都以 `goPage(props.page)` 收尾，依赖 `pageNavKey` 的自增来强制页面重挂载，这是"切换项目后页面数据不残留"的关键。
- **异步错误未捕获**：`switchProject` / `goPage` / `projectTools.create`（后者有 `res.ok` 判断但网络/IPC 异常仍可能 reject）均未包 `try/catch`；`create` 返回 `undefined` 时已被 `!res` 兜住。
- **输入框焦点时序**：`v-show` 只切换 `display`，元素始终在 DOM 中，但仍使用 `nextTick` 后再聚焦，保证浏览器已完成样式重算。
- **模板作用域可使用 `window`**：与 `App.vue` 不同，本组件的交互逻辑都写在 `script setup` 的函数体内，函数体内 `window.projectTools` 是模块作用域访问，不需要包装函数。
- **跨目录导入统一走 `@renderer` 别名**：本组件的三处跨目录导入分别是 `@renderer/composables/useAppStore`（store 与 `PageKey`）、`@renderer/pages`（`goPage`）、`@renderer/composables/useToast`（`toast`），不使用 `../` 相对路径（遵循根目录 `agents.md` 规则 5）；同目录内部才用相对路径（本组件无同目录依赖）。
- **依赖分界遵循 `agents.md` 规则 6**：本组件依赖的 `useAppStore` / `useToast` 属于 `composables/`（有状态、含 localStorage 与 Vue 响应式），因此放在 composables 而非 utils；组件自身不引入任何纯工具函数。
