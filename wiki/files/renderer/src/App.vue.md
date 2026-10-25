# src/renderer/src/App.vue
> **⚠️ 本轮角色改造对本文件的影响（以本块为准）**
>
> 侧栏菜单从 8 项变 **9 项**（顺序：首页 / 内容脚本 / 配音 / 字幕生成 / HTML生成 / **角色** / 视频预览 / 关于 / 设置）：`menuItems` 数组里新增 `{ key: 'cast', label: '角色', title: '角色（全局角色库：新建 / 改画法，与项目无关）' }`，位置在 `html-gen`（HTML生成）之后、`video-preview`（视频预览）之前；`App.vue` 现 **328 行**。菜单项仍由 `activeMenu`（`PageKey`，已含 `'cast'`）驱动高亮，`goPage('cast')` 切到 `pages/CastPage/index.vue`。

> 应用外壳：自绘标题栏 + 运行环境横幅 + 侧边菜单 + 页面容器 + 旧数据弹窗 + Toast 宿主 + 启动初始化

- **所在目录**：`src/renderer/src/`
- **类型**：根组件（单文件组件，`<script setup lang="ts">` + `<style scoped>`）
- **规模**：327 行（模板 139 行（1–139）/ 脚本 77 行（141–217）/ 样式 109 行（219–327），另含 2 行块间空行；行数口径为 `[IO.File]::ReadAllLines($f).Count`）
- **对外导出**：默认导出组件对象（经 `env.d.ts` 的 `*.vue` 声明被 `main.ts` 导入）；**无 props、无 emits**，全部状态来自 composables 与 preload 桥

## 1. 作用与职责

`App.vue` 是原 `src/index.html` 的 titlebar/sidebar 标记与 `entry.js` 中窗口控制、进度监听、启动逻辑的**合并移植体**。它承担八类职责：

1. **自绘标题栏**：因主进程使用 `titleBarStyle: 'hidden'`，标题栏由本组件绘制，含 logo、标题（`{{ APP_NAME }}`，来自 `@shared/constants`）与最小化/最大化/关闭三个按钮。
2. **运行环境横幅**：运行环境已**分包**——`ffmpeg`（解包 179.9 MB）与 `hyperframes`（解包 439.9 MB）各自一个 7z（**两包实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14）、首次用到时由用户确认后下载并解到 `<userData>/runtime/<包名>/`，`whisper` 随安装包（详见 `docs/runtime-pack-split.md`）。横幅是三态窄带：**下载中**（`.runtime-banner-bar` 进度条 + 「取消」）、**缺包**（`runtimeState.message` / `runtimeMissingText` + 「下载运行环境」）、**失败**（危险色 + 「重试」）。
3. **运行环境确认框**：模板里内联渲染 `useEnvGate()` 的单例确认框（`.hf-modal-mask` + `.hf-modal`，scoped 样式 `.env-gate-line` / `.env-gate-packs`），三态 `confirm | downloading | ready`——功能页缺包时由 `guard()` 置 `visible`，装好后按钮变「继续」调 `continueAction()`（**不自动续做**）。
3. **左侧文字菜单**：8 个菜单项由 `menuItems` 数组 `v-for` 渲染，点击调用 `goPage(item.key)`。
4. **右侧页面容器**：用 `<component :is="currentPage" :key="pageNavKey" />` 渲染 `pages` 注册表中的当前页面组件。
5. **旧数据弹窗宿主**：挂载 `<LegacyDataDialog />`——品牌/目录改名后「发现旧版本数据」的**应用内**弹窗（迁移 / 删除 / 稍后）。弹窗自身按 `useLegacyData()` 的单例状态决定是否显示，本组件只负责把它放进外壳。
6. **Toast 宿主**：`TransitionGroup` 渲染 `useToasts()` 的队列，并提供 `.toast-host` / `.toast-item` 的 scoped 样式。
7. **全局启动**：`onMounted` 中订阅窗口最大化状态、初始化渲染进度监听、初始化运行环境状态、询问一次旧数据、恢复上次项目上下文、并行载入项目列表与渲染默认档位。
8. **配置类错误弹窗宿主**（2026-10 新增）：模板里内联渲染 `useConfigPrompt()` 的单例弹窗——标题（`configPrompt.title`）+ 人话正文（`.hf-status.hf-error`）+ 提示行「点「去设置」前往修改配置；点「取消」放弃本次操作，可以稍后再来。」+ 两个按钮 `[去设置]` / `[取消]`。它由各功能页在拿到主进程失败分支的 `res.needConfig` 后触发（`configPrompt.open(...)` / `configPrompt.fromResult(res)`），本组件只负责把它放进外壳；**刻意不显示「查看详情」**（配置类错误的原始报文对用户没有可操作性），**余额 / 欠费不进这个框**（主进程不给它 `needConfig`，走内嵌状态行）。

## 2. 结构说明

### 2.1 模板区块

| 区块 | 关键标记 | 说明 |
| --- | --- | --- |
| 标题栏 | `<header class="titlebar">` | 可拖拽区域（拖拽样式由全局 `main.css` 提供）；`.titlebar-logo` 为六边形 SVG（`<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>`） |
| 标题文本 | `.titlebar-title` | 文案为 `{{ APP_NAME }}`（取自 `@shared/constants` 的 `APP_NAME`，当前值「影坊」），不再写字面量 |
| 窗口按钮组 | `.titlebar-controls` | 三个 `button.win-btn`：最小化（`@click="winMinimize"`）、最大化/还原（`@click="winToggleMaximize"`，`title` 随 `isMaximized` 在「还原」/「最大化」间切换）、关闭（`button.win-btn.win-close`，`@click="winClose"`） |
| 最大化图标切换 | `v-show="!isMaximized"` / `v-show="isMaximized"` | 两个互斥的 SVG 分支：还原态画单矩形，最大化态画双矩形叠放（后一个 `fill="#0B1220"` 挖空） |
| 运行环境横幅 | `<div v-if="runtimeVisible" class="runtime-banner" :class="{ 'is-error': runtimeFailed }">` | 标题栏之下、内容区之上的一条窄带（flex 子项，不遮挡页面）：`.runtime-banner-text` 显示 `runtimeState.message \|\| runtimeMissingText`；`.runtime-banner-bar > i`（`v-if="runtimeBusy"`，宽度绑 `runtimeState.percent + '%'`）显示下载 / 解包进度；按钮三选一——`runtimeCancellable` 时「取消」（`cancelRuntime`）、`runtimeFailed` 时「重试」（`retryRuntime`）、`runtimeHasMissing` 时「下载运行环境」（`downloadRuntime`，与重试都调 `prepareRuntime()`） |
| 运行环境确认框 | `.hf-modal-mask` + `.hf-modal`（`v-if="gate.visible.value"`） | 内联渲染的单例确认框：标题 `gate.title`、`gate.sizeText` 列出本次要下的包与体积、`gate.phase === 'downloading'` 时用 `.runtime-banner-bar` 显示 `gate.percent` 并提供「取消」（`gate.cancelDownload`）、确认态给「下载运行环境」（`gate.confirmDownload`）/「取消」（`gate.close`）、`ready` 态按钮变「继续」（`gate.continueAction`）；失败 / 取消的文案走 `gate.message` / `gate.detail` |
| 配置类错误弹窗 | `.hf-modal-mask` + `.hf-modal`（`v-if="configPrompt.visible.value"`，`style="width:min(520px,92vw)"`） | 内联渲染的单例弹窗（2026-10 新增）：`.hf-modal-title` = `configPrompt.title.value`、关闭按钮 `configPrompt.close()`、正文 `.hf-status.hf-error` = `configPrompt.message.value`、`.hgen-tip` 提示行（固定文案「点「去设置」前往修改配置；点「取消」放弃本次操作，可以稍后再来。」）、`.hgen-actions` 里主按钮 `.hf-btn.hf-btn-primary` 文案恒为 **「去设置」**（`@click="configPrompt.go()"`）+ 次按钮「取消」（`close()`）。**没有 `.hf-detail` / 「查看详情」**（源码注释：多一个折叠区会让「点哪个按钮」这个唯一决策变模糊） |
| 布局容器 | `<div class="layout">` | 左右分栏骨架 |
| 侧栏 | `<aside class="sidebar"><nav class="menu" id="menu">` | 保留 `id="menu"` 与原结构一致 |
| 菜单项 | `div.menu-item` | `v-for="item in menuItems"`，`:key="item.key"`、`:class="{ active: activeMenu === item.key }"`、`:data-page="item.key"`、`:title="item.title"`、`@click="goPage(item.key)"` |
| 内容区 | `<main class="content" id="content" ref="contentEl">` | `ref="contentEl"` 供页面切换后滚动复位使用 |
| 动态页面 | `<component :is="currentPage" :key="pageNavKey" />` | `:key` 强制重挂载，见第 3 节 |
| 旧数据弹窗 | `<LegacyDataDialog />` | 位于 `.layout` 之后、**Toast 宿主之前**；组件**无 props、无 emits**，显隐与文案全部来自 `useLegacyData()` 的模块级单例 |
| Toast 宿主 | `<TransitionGroup tag="div" name="toast" class="toast-host">` | 模板的最后一块；内层 `v-for="t in toasts" :key="t.id"` 的 `div.toast-item`，文本为 `{{ t.msg }}` |

### 2.2 菜单项清单（`menuItems`）

| 顺序 | `key`（`PageKey`） | `label`（显示文字） | `title`（提示） |
| --- | --- | --- | --- |
| 1 | `home` | 首页 | 首页 |
| 2 | `content` | 内容脚本 | 内容脚本 |
| 3 | `text-tts` | 配音 | 配音（文字生音频） |
| 4 | `subtitle` | 字幕生成 | 字幕生成 |
| 5 | `html-gen` | HTML生成 | HTML生成 |
| 6 | `video-preview` | 视频预览 | 视频预览（转视频入口在 HTML生成页） |
| 7 | `about` | 关于 | 关于 |
| 8 | `settings` | 设置 | 设置 |

> `PageKey` 现在恰好就是上表 8 项：原 `sound-copy`（音色复刻）页已并入「配音」页（`text-tts`）的第三个 Tab，页面键随之删除，不再有“菜单里没有的页面键”。

### 2.3 脚本成员

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `toasts` | `const`（`useToasts()` 返回值） | Toast 队列 ref，模板中 `v-for` 数据源 |
| `contentEl` | `ref<HTMLElement \| null>(null)` | `<main class="content">` 的模板引用 |
| `isMaximized` | `ref(false)` | 窗口最大化状态，由主进程推送更新 |
| `runtimeState` / `runtimeBusy` / `runtimeFailed` / `runtimeHasMissing` / `runtimeCancellable` / `runtimeMissingText` / `prepareRuntime` / `cancelRuntime` | `useRuntime()` 解构出的 `runtime` / `busy` / `failed` / `hasMissing` / `cancelable` / `missingText` / `prepare` / `cancel`（旧的 `retry` 已删，重试改调 `prepare`） | 运行环境（分包）状态、是否正在下载 / 解包、是否失败、是否缺包、是否可取消、缺包文案与两个动作（`initRuntime()` 在 `onMounted` 里调用一次） |
| `gate` | `useEnvGate()` 返回值 | 「需要下载运行环境」确认框的单例状态与动作（`visible` / `packs` / `title` / `phase` / `percent` / `readyNow` / `message` / `detail` / `sizeText` / `confirmDownload` / `cancelDownload` / `continueAction` / `close`）；`initEnvGate()` 在 `onMounted` 里调用一次 |
| `configPrompt` | `useConfigPrompt()` 返回值 | 配置类错误弹窗的单例状态与动作（`visible` / `title` / `message` / `target` / `open` / `fromResult` / `go` / `close`，**没有 `url`**）；**无需 init**（不订阅任何推送），模板里内联渲染弹窗；动作由各功能页触发 |
| `runtimeVisible` | `computed(() => runtimeBusy.value \|\| runtimeFailed.value \|\| runtimeHasMissing.value)` | 横幅在「正在下载 / 解包」「失败」「缺包」三种情况出现（已就绪时保持界面干净） |
| `menuItems` | `{ key: PageKey; label: string; title: string }[]` | 菜单配置数组（见 2.2） |
| `winMinimize()` | `function(): void` | 调 `window.windowControls.minimize()` |
| `winToggleMaximize()` | `function(): void` | 调 `window.windowControls.toggleMaximize()` |
| `winClose()` | `function(): void` | 调 `window.windowControls.close()` |
| `initApp()` | `async function(): Promise<void>` | 恢复项目上下文 → `Promise.all([refreshProject(), loadRenderDefaults()])`（**不再调 `goPage('home')`**，见 3.1 第 5 点） |
| `watch(currentPage, ...)` | 侦听器 | 页面切换后 `contentEl.value.scrollTop = 0` |
| `onMounted(...)` | 生命周期钩子 | 订阅最大化状态 → `initRenderProgress()` → `initRuntime()` → `initEnvGate()` → `initLegacyData()` → `void initApp()` |

## 3. 关键流程

### 3.1 启动初始化（`onMounted`）

`onMounted` 里的调用顺序是固定的：`windowControls.onMaximizedChange(...)` → `initRenderProgress()` → `initRuntime()` → `initEnvGate()` → `initLegacyData()` → `void initApp()`。

1. **订阅窗口状态**：`window.windowControls.onMaximizedChange((v: boolean) => { isMaximized.value = v; })`——主进程在窗口 `maximize`/`unmaximize` 事件中推送布尔值，用于切换最大化按钮图标。
2. **初始化渲染进度**：`initRenderProgress()` 注册 `window.hfTools.onProgress` 回调（HyperFrames 渲染进度解析，结果写入 `renderProgress.text`，供视频页展示）。预加载层为单订阅语义，重复注册只替换回调。
3. **初始化运行环境状态与确认框**：`initRuntime()`（`composables/useRuntime.ts`）注册 `window.runtimeTools.onProgress` 并查一次 `runtimeTools.status`，结果写入模块级单例；紧接着 `initEnvGate()`（`composables/useEnvGate.ts`）**不再注册第二个进度回调**（preload 是单订阅语义，后注册者会顶掉 `useRuntime` 的订阅），改为 `watch(() => useRuntime().runtime.value, applyProgress, { deep: true })` 消费同一份状态，并驱动模板里内联的确认框。两者排在这里而不是 `initApp()` 里，是因为它们与「项目数据」无关，且下载 / 解包进度要尽早开始接收。
4. **询问旧数据**：`initLegacyData()`（`composables/useLegacyData.ts`）调一次 `window.legacyTools.status()`，**有结果才**把单例的 `visible` 置真、由 `<LegacyDataDialog />` 弹应用内弹窗；函数自带幂等标志（`bound`），主进程未就绪时静默失败。它**不属于 `initApp()`**，且刻意排在 `initEnvGate()` 之后：此时首屏已经渲染完，弹窗不会糊在空界面上，**主进程侧因此不需要任何「等首屏画完」的延迟**（早先用原生对话框时靠 `setTimeout(…, 1500)` 顶着，现已删除）。
5. **恢复项目上下文**：`localStorage.getItem(STORAGE_KEY_PROJECT_CTX)`（常量定义在 `@renderer/constants`，值即 `'myapp.projectCtx'`），`JSON.parse` 后若存在且含 `name`，则只写回 `appState.currentName = saved.name`（历史值里可能残留的 `builtin` 字段被**忽略**）。整段包在 `try/catch` 中，解析失败（脏数据/非 JSON）静默忽略（`catch (e) { /* ignore */ }`）。
6. **刷新项目 + 载入渲染默认档位**：`await Promise.all([refreshProject(), loadRenderDefaults()])`——前者拉取「我的项目」(`projectTools.list`) 并加载当前项目详情，后者读 `settingsTools.get()` 的 `render` 段写入 `composables/useRenderOptions.ts` 的 `renderDefaults`（源码注释：项目列表与渲染默认档位并行载入，档位读取失败不影响启动，落回内置默认 `standard` / `30`）。
7. **不再进入首页**：`initApp()` **刻意不调 `goPage('home')`**。首页本就是初始页（`pages/index.ts` 里 `currentPage` 初值 = `pages.home`，`useAppStore` 里 `activeMenu` 初值 = `'home'`），再走一遍 `goPage` 只会：① 多跑一轮 `refreshProject()`（`project:list` + `project:load` 两次 IPC）；② 递增 `pageNavKey` 把已经挂好的首页整页重挂一次。首页内容由第 6 步的 `refreshProject()` 直接驱动渲染，因此这里删掉该调用后行为不变、启动更快。
8. 调用处使用 `void initApp();`：显式丢弃 Promise，避免未捕获 rejection 警告，同时让 `onMounted` 保持同步返回。

> **`initLegacyData()` / `initRuntime()` / `initEnvGate()` 都不是 `initApp()` 的一部分**：`initApp()` 只负责「项目上下文 + 项目数据 + 渲染档位」，副作用的登记（进度订阅、环境状态与确认框、旧数据询问）留在 `onMounted` 里，顺序即优先级。

### 3.2 菜单跳转与页面渲染

1. 点击菜单项 → `goPage(item.key)`（定义于 `pages/index.ts`）。
2. `goPage` 内依次：`activeMenu.value = key` → `await refreshProject()` → `currentPage.value = pages[key]` → `pageNavKey.value++`。
3. `activeMenu` 变化驱动 `:class="{ active: ... }"` 更新菜单高亮；`currentPage` 变化触发下述 `watch`。
4. `pageNavKey` 递增使 `<component :is>` 的 `:key` 改变，**强制卸载并重挂载**页面组件，恢复旧版"每次进入页面都重跑 init"的语义，避免同页切换项目后残留旧项目数据/预览。
5. 页面切换后滚动复位：`watch(currentPage, () => { if (contentEl.value) contentEl.value.scrollTop = 0; })`——对应原 `goPage` 里的 `content.scrollTop = 0`。

### 3.3 轻提示（Toast）

1. 任意模块调用 `toast(msg)`（`composables/useToast.ts`）→ 生成自增 `id` 并 push 进模块级 `toasts` 队列。
2. `toast()` 内部 `setTimeout(..., 2800)` 后按 `id` 过滤移除，无需组件额外清理。
3. `App.vue` 是唯一渲染该队列的地方；`TransitionGroup` 以 `name="toast"` 应用淡入淡出过渡类。
4. 旧数据弹窗的迁移 / 删除结果也走这套 toast（由 `LegacyDataDialog.vue` 调用 `toast(...)`）——这也是弹窗挂在 Toast 宿主之前、而 Toast 宿主仍留在模板最后的原因。

## 4. 依赖与协作

| 方向 | 对象 | 用途 |
| --- | --- | --- |
| 依赖（Vue） | `computed`、`onMounted`、`ref`、`watch` | 生命周期与模板引用、侦听器、横幅显隐计算 |
| 依赖 | `@renderer/composables/useAppStore` | `activeMenu`（菜单高亮）、`appState`（项目上下文）、`refreshProject`、类型 `PageKey` |
| 依赖 | `@shared/constants` | `APP_NAME`（标题栏文案；三端共用的品牌文案唯一来源） |
| 依赖 | `@renderer/constants` | `STORAGE_KEY_PROJECT_CTX`（启动时读取上次项目上下文的键名，值即 `'myapp.projectCtx'`） |
| 依赖 | `./pages` | `currentPage`、`goPage`、`pageNavKey` |
| 依赖 | `./composables/useToast` | `useToasts()` 取 Toast 队列 |
| 依赖 | `./composables/useRenderProgress` | `initRenderProgress()` |
| 依赖 | `./composables/useRenderOptions` | `loadRenderDefaults()`（启动时与 `refreshProject()` 并行载入全局渲染默认档位） |
| 依赖 | `./composables/useRuntime` | `initRuntime()` 与 `useRuntime()`（运行环境状态 / 忙 / 失败 / 缺包 / 可取消 / 缺包文案 / `prepare(packs?)` / `cancel()`） |
| 依赖 | `./composables/useEnvGate` | `initEnvGate()` 与 `useEnvGate()`（「需要下载运行环境」确认框单例；模板内联渲染） |
| 依赖 | `./composables/useConfigPrompt` | `useConfigPrompt()`（配置类错误弹窗单例；模板内联渲染，**无需 init**）；`const configPrompt = useConfigPrompt();` 紧跟 `const gate = useEnvGate();` |
| 依赖 | `./composables/useLegacyData` | `initLegacyData()`（外壳挂载时问一次「有没有旧数据」） |
| 依赖 | `./components/LegacyDataDialog.vue` | 旧数据处置弹窗（应用内 `.hf-modal` 体系；自身消费 `useLegacyData()`） |
| 依赖（preload 桥） | `window.windowControls` | `minimize` / `toggleMaximize` / `close` / `onMaximizedChange`；类型见 `src/preload/index.d.ts` |
| 依赖（preload 桥，间接） | `window.hfTools.onProgress`、`window.runtimeTools`、`window.legacyTools` | 分别经 `initRenderProgress()`、`useRuntime()` / `useEnvGate()`、`useLegacyData()` 使用，本组件不直接调用 |
| 被使用 | `src/renderer/src/main.ts` | `createApp(App).mount('#app')` |
| 被使用 | 全部页面组件 | 通过 `pages` 注册表被 `<component :is>` 渲染；各页面顶部放置 `<StepBar :page="..."/>` |

## 5. 注意事项与实现要点

- **旧数据的界面在渲染层，不在主进程**：本轮把「发现旧版本数据」的原生 `dialog.showMessageBox` 换成了应用内 `LegacyDataDialog.vue`（沿用项目既有的 `.hf-modal` 弹窗体系）。原因：原生对话框与 Cyber UI 设计系统（`src/renderer/agents.md`）不一致，且项目已有 `.hf-modal-mask` / `.hf-modal` / `.hf-btn` 一整套可复用样式，弹窗外观、文案与交互都能和「新建项目」等既有弹窗保持一致。主进程只回答「有没有 / 是什么」并执行选择，不做任何界面展示。
- **主进程侧不再有 1.5s 延迟**：原先靠 `setTimeout(() => promptLegacyData(), 1500)` 等首屏画完再弹原生框；现在显示时机由渲染层掌握——`initLegacyData()` 在外壳挂载时调用，那一刻首屏已经渲染完，所以「等首屏」的魔法数字整段删掉了。启动路径上已没有任何与旧数据相关的延时。
- **`initLegacyData()` 是幂等的**：`useLegacyData.ts` 里的 `bound` 标志保证重复调用（例如将来在别处再调一次）只会问主进程一次，不会重复弹窗。
- **CSP 相关**：本组件大量使用行内 `style` 与 scoped 样式注入，依赖 `index.html` 中 `style-src 'self' 'unsafe-inline'`；模板中不使用任何内联 `<script>`。
- **模板作用域无 `window`**：因此窗口控制包了三个包装函数（`winMinimize` / `winToggleMaximize` / `winClose`），注释中已说明；模板里直接写 `window.windowControls...` 会取不到该标识符。
- **`isMaximized` 是单向同步**：初值 `false`，只有主进程推送时才更新。若窗口以最大化状态启动，需依赖主进程在对应事件后推送（`main/index.ts` 在 `maximize`/`unmaximize` 事件中发送 `MaximizedChange`）。
- **scoped 样式与 TransitionGroup**：`<style scoped>` 中的 `.toast-enter-active` / `.toast-leave-active` / `.toast-enter-from` / `.toast-leave-to` 由 Vue 过渡机制附加在 Toast 元素上，与 scoped 属性共同匹配，故直接生效；过渡仅使用 `opacity 0.25s ease`。
- **`.toast-item` 自身 `position: fixed`**：虽然外层 `.toast-host` 也是 `fixed`，但条目用 `left:50%` + `bottom:28px` + `translateX(-50%)` 独立定位到底部居中；宿主 `pointer-events: none`、条目 `pointer-events: auto`，避免遮挡交互。
- **颜色为字面量而非变量**：`.toast-item` 中写死 `#E6F1FF`、`rgba(11, 18, 32, .95)`、`rgba(0, 212, 255, .5)`，与主题变量同值但未引用变量，改主题时需同步此处；运行环境横幅的进度条则与设计系统一致地复用了 `--glow-primary` / `--glow-card` / `--radius-btn` 等变量（失败态换成危险色系字面量）。
- **启动只拉一次项目数据**（2026-10 修正）：`initApp()` 现在只做一次 `refreshProject()`，不再紧跟 `goPage('home')`。此前每次启动都会多拉一遍项目列表与当前项目详情，并把首页整页重挂一次（`pageNavKey` 递增）——首屏慢的问题排查中发现该冗余，已删除。**改动此处的判断依据**：只要 `pages/index.ts` 的 `currentPage` 初值仍是 `pages.home`、`useAppStore` 的 `activeMenu` 初值仍是 `'home'`，就不需要显式 `goPage`。
- **删除项目的兜底在 store 层**：若 localStorage 记的项目已不存在，由 `refreshProject()` 回退到 `myProjects[0]` 或 `'demo-project'`，本组件不做校验。
- **渲染默认档位只在这里读一次**：`loadRenderDefaults()` 把 `settings.json` 的 `render` 段写入模块级 `renderDefaults`（`useRenderOptions.ts`）；页面只读该单例与 `effectiveRenderOptions()`，不各自读设置。设置页保存后由 `saveRenderDefaults()` 就地更新，因此无需重启或刷新本组件。
- **配置类弹窗是第二个内联 `.hf-modal`**（2026-10 新增）：它排在运行环境确认框之后、Toast 宿主之前，复用同一套 `.hf-modal-mask` / `.hf-modal` / `.hf-btn` 类（**没有新增 CSS**）。与运行环境框的差别是**它不驱动流程**（关掉＝本次操作作废，不像「继续」要用原参数重发），因此没有进度条、也没有「查看详情」折叠区；**只有 `[去设置]` / `[取消]`**——曾有过第三个分支「去充值」（余额类外链到厂家充值页），**已按用户要求整条摘除**（连同 `app:open-external` 频道与 `appTools.openExternal`），余额 / 欠费改为走内嵌状态行（文案说明去厂家控制台充值）。三个「谁把用户带走」的用法见 [common.md](./common.md) §5.1。
- **品牌文案与持久化键名各取一处**：标题栏文案走 `@shared/constants` 的 `APP_NAME`（改品牌只改那一份，构建期还会校验 `package.json` 的 `productName`）；`localStorage` 键走 `@renderer/constants` 的 `STORAGE_KEY_PROJECT_CTX`（**故意不跟随品牌名**——prod 下 `file://` 同源，键名就是用户数据地址，改名会让「上次项目」记忆读不到）。本组件不再出现这两类裸字面量。
