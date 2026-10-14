# 渲染层公共方法与工具（src/renderer/src/composables、utils、constants.ts、pages/index.ts）

> 渲染层 15 个公共模块：全局状态、轻提示、渲染进度、运行环境状态、**运行环境确认框**、**配置类错误弹窗**、历史数据处置、渲染档位、**跨页导航意图**、语速、转义、时间格式化、档位选项、**渲染层常量**与页面注册表。

- **覆盖文件**（行数为源文件行数）

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `src/renderer/src/composables/useAppStore.ts` | 107 | 全局项目状态（模块级 `reactive` 单例）+ 5 个链路 `computed` + 项目上下文读写（键名取 `constants.ts`） |
| `src/renderer/src/composables/useToast.ts` | 22 | 全局轻提示队列（自增 id + 2800ms 自动移除） |
| `src/renderer/src/composables/useRenderProgress.ts` | 92 | 解析 HyperFrames 渲染日志 `[Render:trace]` 行并生成中文进度文案（只上屏用户看得懂的阶段） |
| `src/renderer/src/composables/useRuntime.ts` | 90 | 运行环境（**分包** ffmpeg / hyperframes，首次用到时下载）状态单例：`runtime:progress` 订阅 + `runtime:status` 首帧补齐，派生 `busy` / `failed` / `missing` / `hasMissing` / `ready` / `cancelable` / `missingText` 与 `prepare(packs?)` / `cancel()`；**交给 IPC 的包名数组必须走 `toRaw(list).slice()`**（Vue 响应式代理过不了结构化克隆，`invoke` 会抛 `DataCloneError` 且主进程 handler 不执行），`prepare()` 的非 ok 回执 / 抛错会写进 `runtime`（不再静默） |
| `src/renderer/src/composables/useEnvGate.ts` | 159 | 全局唯一的「需要下载运行环境」确认框单例：`guard(need, actionName, cont?)` → `confirmDownload()` / `cancelDownload()` / `continueAction()` / `close()`，三态 `confirm \| downloading \| ready`（装好后按钮变「继续」、**不自动续做**）；进度**不自己订阅** `runtime:progress`，而是 `watch` 消费 `useRuntime` 的状态（全渲染层只有 `useRuntime.ts` 一处 onProgress 注册） |
| `src/renderer/src/composables/useConfigPrompt.ts` | 86 | **配置类错误弹窗单例**（2026-10 新增）：`open(msg, target, jump?, title?)` / `fromResult(res, jump?)` / `go()` / `close()`，只有 `[去设置]` / `[取消]` 两个按钮；分类由主进程 `needConfig` 单点判定，渲染层不做正则猜测；**余额 / 欠费不弹窗**（走内嵌状态行） |
| `src/renderer/src/composables/useLegacyData.ts` | 60 | 旧版本数据（品牌/目录改名留下）提示：挂载时问一次 `legacy:status`，有结果就弹应用内弹窗，并把用户选择经 `legacy:resolve` 回传 |
| `src/renderer/src/composables/useRenderOptions.ts` | 41 | 视频渲染档位：全局默认载入（`settings.json` 的 `render`）+ 生效档位 + 项目级覆盖写入 |
| `src/renderer/src/composables/useNavIntent.ts` | 30 | 跨页面「导航意图」信号（模块级 `ref` 单例）：`requestSettingsSection()` 置位、目标页 `consumeSettingsSection()` 读取并复位；设置页 5 个分类的**唯一枚举来源**（`SETTINGS_SECTIONS`） |
| `src/renderer/src/utils/render.ts` | 55 | 档位选项表与纯函数（规范化覆盖、解析生效档位、档位摘要文案） |
| `src/renderer/src/utils/rate.ts` | 21 | 语速控件共享逻辑：0.5~2.0 播放速率同步到输入框与音频元素 |
| `src/renderer/src/utils/escape.ts` | 4 | 单函数 HTML 转义（`&`、`<`、`>`） |
| `src/renderer/src/utils/time.ts` | 15 | 秒 → `分:秒` 与 `分:秒.毫秒` 两种时间轴格式化 |
| `src/renderer/src/constants.ts` | 14 | 渲染层公共常量：`localStorage` 键名前缀 `STORAGE_PREFIX` + 两个持久化键（**前缀故意不跟随品牌名**，改前缀必须补迁移） |
| `src/renderer/src/pages/index.ts` | 51 | 页面注册表 + `goPage` 导航（**刷新项目失败也照切页**并把原因 toast 出来；含强制重挂载序号），替代 `vue-router` |

- **类型**：组合式函数（全局状态 / 提示 / 进度 / 运行环境状态与确认框 / 旧数据 / 档位 / 导航意图）+ 纯工具函数（档位选项、语速 / 转义 / 时间）+ 常量模块 + 页面注册表与导航函数。这些文件共同替代了旧版挂在 `window.App` 上的 `AppState`、`toast`、HF 进度监听、`rateClamp/applyRate/stepRate`、`escTxt`、时间格式化与 `pages/goPage`。

> **`localStorage` 键名与品牌文案各归一层**：键名（`'myapp.projectCtx'` / `'myapp.settingsSection'`）定义在 `src/renderer/src/constants.ts`，各消费处只 `import` 常量、不再写字面量；**前缀 `'myapp.'` 故意不跟随品牌名**（prod 下 `file://` 同源，键名就是用户数据的地址，改名会让老用户「上次项目 / 设置页分类」读不到），要改必须补「读旧键 → 写新键」的迁移。品牌文案（应用名 / 英文名 / 口号）则是三端共用的 `src/shared/constants.ts`，与本文件无关。详见 [constants.ts.md](./constants.ts.md)。

## 1. 全局状态：composables/useAppStore.ts

渲染层唯一的「当前项目」状态源，负责四件事：持有当前项目上下文、派生流水线链路状态、把上下文持久化到 `localStorage`、通过两次 IPC 刷新列表与详情。它同时是渲染档位覆盖（`ProjectState.render`）的载体，档位规范化借助 `utils/render.ts` 的 `pickRenderOverride`。

**类型声明**

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `PageKey` | 字符串字面量联合 | 页面键，与菜单 `data-page` 一致：`'home' \| 'about' \| 'content' \| 'text-tts' \| 'subtitle' \| 'html-gen' \| 'video-preview' \| 'settings'`（视频环节的键是 `video-preview`，页名「视频预览」：转视频动作已并入「HTML生成」页，该页只做预览；原「音色管理」独立页的 `'sound-copy'` 已随页面并入配音页第三个 Tab 而下线） |
| `ProjectState` | interface（本文件定义） | 当前项目**详情**（渲染层自身的视图模型，与主进程 `project.json` 字段对应） |
| `ProjectMeta` | interface（**再导出**） | 「我的项目」**列表项**元信息；真实定义在 `src/shared/types.ts` ⑥ 节，本文件以 `import type { ProjectMeta } from '@shared/types'` + `export type { ProjectMeta }` 转发，保持 `import { ProjectMeta } from '@renderer/composables/useAppStore'` 的既有引用面 |

**结构体字段表（`ProjectState` / `ProjectMeta`）**

> `ProjectState` 是渲染层自己的视图模型（定义在本文件）；`ProjectMeta` 的结构定义在 `src/shared/types.ts` ⑥ 节，下表列出的是消费侧语义。

| 归属 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `ProjectState` | `name` | `string` | 项目名 |
| `ProjectState` | `title` | `string` | 项目标题（缺省时 `refreshProject` 回填 `'字幕动画'`） |
| `ProjectState` | `subtitle` | `string` | 字幕文本（SRT 风格多行文本） |
| `ProjectState` | `htmlPath` | `string` | 生成/修改得到的 HTML 绝对路径 |
| `ProjectState` | `videoPath` | `string` | 渲染产出的视频路径 |
| `ProjectState` | `audioFile` | `string` | 背景音频 / 生成语音路径 |
| `ProjectState` | `videoMaterial` | `string` | 视频素材路径（可从其提取原声） |
| `ProjectState` | `htmlExists` | `boolean` | HTML 是否真实存在（来自列表项 `hasHtml`，非详情字段） |
| `ProjectState` | `videoExists` | `boolean` | 视频是否真实存在（来自列表项 `hasVideo`，非详情字段） |
| `ProjectState` | `subtitleCount` | `number` | 字幕条数 |
| `ProjectState` | `content` | `{ style: string; scenes: { id: string; narration: string; visual: string; durHint: string }[] }` | 内容脚本：全局风格 `style` + 场景数组，每个场景含 `id`、旁白 `narration`、画面 `visual`、时长提示 `durHint` |
| `ProjectState` | `render` | `RenderOverride?`（可选） | 视频渲染档位的**项目级覆盖**（`{ quality?, fps? }`，字段缺省 = 跟随全局默认）；`refreshProject` 用 `pickRenderOverride(loaded.render)` 规范化后写入，脏数据/缺省归为空覆盖 |
| `ProjectMeta` | `name` | `string` | 项目名 |
| `ProjectMeta` | `title` | `string` | 项目标题 |
| `ProjectMeta` | `hasSubtitle` | `boolean` | 是否有字幕 |
| `ProjectMeta` | `hasHtml` | `boolean` | 是否有 HTML |
| `ProjectMeta` | `hasVideo` | `boolean` | 是否有视频 |
| `ProjectMeta` | `subtitleCount` | `number` | 字幕条数 |
| `ProjectMeta` | `updatedAt` | `string` | 更新时间（ISO 字符串，主进程按此倒序排序） |

**导出成员**

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `appState` | `reactive` 对象 | 字段 `currentName`（初值 `'demo-project'`）、`project`（`ProjectState \| null`，初值 `null`）、`myProjects`（`ProjectMeta[]`，初值 `[]`） |
| `activeMenu` | `ref<PageKey>` | 当前菜单高亮键，初值 `'home'` |
| `hasSubtitle` | `computed<boolean>` | `!!(p && p.subtitle)` |
| `hasHtml` | `computed<boolean>` | `!!(p && p.htmlExists && p.htmlPath)` |
| `hasVideo` | `computed<boolean>` | `!!(p && p.videoExists)` |
| `hasContent` | `computed<boolean>` | `!!(p && p.content && Array.isArray(p.content.scenes) && p.content.scenes.length)` |
| `hasAudio` | `computed<boolean>` | `!!(p && p.audioFile)` |
| `saveProjectCtx()` | `() => void` | 写 `localStorage[STORAGE_KEY_PROJECT_CTX]`（常量来自 `@renderer/constants`，值 `'myapp.projectCtx'`）= `{ name }` |
| `refreshProject()` | `() => Promise<void>` | 拉取项目列表并加载当前项目详情 |
| `switchProject(name)` | `(string) => Promise<void>` | 切换当前项目并立即刷新 |

**链路状态的判定语义**：五个 computed 一律只看**当前项目自身**的产物字段。`hasHtml` 额外要求 `p.htmlExists && p.htmlPath` 同时成立，避免只有路径、文件已被删除时误判；`hasContent` 对旧项目做**向后兼容**：详情没有 `content` 字段时按空处理（`scenes` 非数组或长度为 0 即视为未产出）；`hasAudio` 是近似判断（项目内已有背景音频即视为已产出声）。

**`saveProjectCtx()`**：读取 `appState.currentName` → 序列化为 `{ name }` 写入 `localStorage` 键 `STORAGE_KEY_PROJECT_CTX`（`@renderer/constants`，值 `'myapp.projectCtx'`）；该键在 `App.vue` 的 `initApp()` 中于启动时读取回填（只取 `saved.name`；历史值里可能残留的 `builtin` 字段被忽略），实现上下文延续。

**`refreshProject()`（列表 + 详情两次 IPC）**

1. 发起一次列表请求并兜底：`const projs = await window.projectTools.list().catch(() => [])`，写入 `appState.myProjects = projs`。列表就是全部项目来源，**没有第二次列表请求**。
2. 按 `currentName` 在 `myProjects` 中查找 `entry`；找不到则把 `currentName` 回退为 `myProjects[0].name`（无则 `'demo-project'`）并重新查找一次。
3. 发起第二次 IPC：`await window.projectTools.load(appState.currentName)`。
4. **空值守卫**：`if (!loaded) { appState.project = null; return }` —— 主进程只在项目名为空（`currentName === ''`）时返回 `null`（`project:load` 的类型即 `Promise<Project \| null>`）；历史实现在这里直接解引用 `null` 会抛运行时报错，现在显式兜底为「无当前项目」，由页面走空态。
5. 组装 `appState.project`，缺省值一律显式兜底：`title || '字幕动画'`、`subtitle / htmlPath / videoPath / audioFile / videoMaterial` 均为 `|| ''`、`htmlExists: !!(entry && entry.hasHtml)`、`videoExists: !!(entry && entry.hasVideo)`、`subtitleCount: loaded.subtitleCount || 0`、`content: loaded.content || { style: '', scenes: [] }`、`render: pickRenderOverride(loaded.render)`（渲染档位覆盖只保留合法字段，脏数据/缺省一律归为空覆盖 = 跟随全局默认）。
6. `htmlExists` / `videoExists` **不是**来自 `load` 的详情，而是来自第 2 步列表项 `entry`——产物存在性由主进程 `scanProjects()` 用文件系统检查得出。

**`switchProject(name)`**：`appState.currentName = name` → `saveProjectCtx()` 立即持久化（即使随后刷新失败，下次启动仍记得用户选择）→ `await refreshProject()` 重新拉列表并加载详情。**单参数**（项目名）。

**注意事项**：**单例而非工厂**——文件未导出 `useAppStore()` 之类的函数而是直接导出实例，任何 `import` 都拿到同一个响应式对象，因此不存在多份状态，也意味着**热更新时状态会跨模块残留**；**`'myapp.projectCtx'` 键名与结构不可漂移**（生产环境用 `file://` 同源，`localStorage` 因此可跨次启动延续，键或字段名改动会导致用户上下文丢失）；**列表项是存在性的唯一来源**——`htmlExists` / `videoExists` 取自 `myProjects` 的 `hasHtml` / `hasVideo`，而 `load()` 返回值里没有这两项，若 `load` 成功但列表为空（例如刚创建、列表未刷新），会得到 `htmlExists: false`，需重新 `refreshProject()`（`NewProjectDialog` 因此固定「先 refreshProject 再 switchProject」的顺序）；**两次 IPC 的失败语义不同**——列表请求有 `.catch(() => [])` 兜底，`projectTools.load()` **没有** catch，若主进程抛错仍会向上冒泡到调用方（如 `goPage` / `switchProject` 的 `await`）；但它的 `null` 返回值已有显式守卫（`if (!loaded) { appState.project = null; return }`），因此「项目名为空 → 主进程回 `null`」不再触发解引用异常，界面表现为无当前项目的空态。**回退链**：我的项目缺失 → `myProjects[0]`；列表为空 → `'demo-project'`，回退只改 `currentName`，不会主动创建项目。

## 2. 提示：composables/useToast.ts

替代旧版 `window.App.toast`，提供全应用统一的“轻提示”：模块级 `const toasts = ref<ToastItem[]>([])` 持有全局队列，`App.vue` 的统一宿主把它渲染成浮层小条；命令式入口 `toast(msg)` 调用即显示，2800ms 后自动移除，因此调用方不需要（也没有提供）`close` / `remove` 接口。它刻意保持极简：没有提示类型（success/error）、没有手动关闭按钮、没有去重，只有「一条文本 + 一个自增 id」。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `ToastItem` | interface | `{ id: number; msg: string }`，`id` 为内部自增序号，`msg` 为展示文本 |
| `toast` | `(msg: string) => void` | 追加一条提示并启动 2800ms 定时移除 |
| `useToasts` | `() => typeof toasts` | 返回模块级 `toasts` 这个 `ref<ToastItem[]>`，供宿主组件渲染 |

**内部状态**：`toasts`（`const toasts = ref<ToastItem[]>([])`，模块级单例，**不导出**，只能经 `useToasts()` 获取）；`seq`（`let seq = 0`，普通变量非响应式，每次 `toast()` 调用 `++seq` 生成 id）。

**`toast(msg)` 执行步骤**：① `const id = ++seq`——先自增再取用，保证 id 从 1 开始且**永不重复**（进程生命周期内单调递增，切换项目/页面都不会重置）；② `toasts.value.push({ id, msg })`——追加到队列尾部，`App.vue` 的 `TransitionGroup` 立即渲染出来（新条目触发过渡动画）；③ `setTimeout(..., 2800)`——2800ms 后执行 `toasts.value = toasts.value.filter((t) => t.id !== id)`，**整体替换数组**（而非 `splice`）以稳定触发 Vue 的响应式更新；④ 定时器不保存引用、不做 `clearTimeout`，因此没有“提前取消某条提示”的能力。

**渲染端（`App.vue`）**：`const toasts = useToasts();`，模板为 `<TransitionGroup tag="div" name="toast" class="toast-host">` 内 `v-for="t in toasts" :key="t.id"` 的 `.toast-item`，文本 `{{ t.msg }}`。`:key="t.id"` 依赖自增 id 才能正确区分多条内容相同的提示（数组索引做 key 会导致过渡与列表复用错乱）；样式 `.toast-host` / `.toast-item` 由 `App.vue` 的 `<style scoped>` 提供（自旧版 `app.js` 的内联样式移植）。

**使用方**：`App.vue`（`useToasts()` 取队列并渲染宿主）；其余均为调用 `toast()`——`components/NewProjectDialog.vue`（项目名为空、创建失败、创建成功）、`pages/ContentPage/index.vue`（保存成功/失败）、`pages/SubtitlePage/index.vue`（删除条目、复制、导出 SRT、保存、由脚本生成字幕）、`pages/HtmlGenPage/index.vue`（Agent 请求排队、生成/修改完成、导入导出、视频素材设置、背景音频选定与移除）、`pages/TextTtsPage/SynthSection.vue`（试听、设为背景音频）、`pages/TextTtsPage/AlignSection.vue`（对齐合成忙、取消、试听失效、写回结果）、`pages/SubtitlePage/TranscribeSection.vue`（转录回填结果）、`pages/VideoPreviewPage/index.vue`（重新加载结果）。约定式写法：主进程返回 `res.ok === false` 时统一 `toast((res as { message?: string })?.message || '默认文案')`，并且取消类结果（`canceled`）通常**不**提示。（`AboutPage` 与 `VoiceSection` 不使用 toast。）

**注意事项**：**模块级单例**使所有页面共享同一队列，因此同一时刻可能叠多条提示（宿主用固定定位 + `TransitionGroup` 依次排布）；**2800ms 是硬编码常量**，没有配置项，如需按类型区分时长需要先扩展 `ToastItem`；**无去重**，连续调用 `toast('保存成功')` 会得到两条独立计时、独立消失的提示；**计时器不随组件卸载取消**，定时器闭包只捕获 `id`，页面切换后仍会执行过滤，但过滤是幂等的（id 已不存在时结果不变）故不会出错；`id` 用普通变量而非响应式，因为它只作为 DOM key 使用、不需要参与响应式追踪；`useToasts()` 返回 `typeof toasts` 即 `Ref<ToastItem[]>`，调用方在模板中写 `v-for="t in toasts"` 时由 Vue 自动解包，若在脚本中使用需要 `.value`；**不适用于需要用户确认的消息**——本模块是“一闪而过”的轻提示，阻塞式确认应使用对话框类能力，而不是在此扩展。

## 3. 渲染进度：composables/useRenderProgress.ts

HyperFrames CLI 在转视频时会向主进程持续推送日志文本，主进程经 `video:progress` 频道回推到渲染层。这些日志里混着两类内容：**结构化事件行** `[Render:trace] {"phase":...,"status":...,"elapsedMs":...,"message":...}` 与**普通日志 / 进度条行**（各种人类可读输出，没有固定结构）。本文件的职责是把这条嘈杂的文本流压成一句人话，写入全局 `renderProgress.text`，由渲染档位所在的「HTML生成」页（`pages/HtmlGenPage/index.vue`，**发起渲染**）与「视频预览」页（`pages/VideoPreviewPage/index.vue`，预览侧）共同展示，例如 `渲染中 · 逐帧捕获（已用 45s · 帧 320/900）：快速捕获未通过校验，改用逐帧截图（会慢一些）`。

**设计原则：宁可不刷新，也不显示用户看不懂的内容。** 推来的日志分三类，只有第一类能上屏：

| 类别 | 例子 | 处理 |
| --- | --- | --- |
| 长阶段的 trace 事件 | `compile` / `audio_process` / `capture_streaming` | 查 `HF_PHASE_LABELS` 转中文后显示 |
| CLI 内部微阶段的 trace | `pipeline` / `file_server` / `worker_resolution` / `capture_strategy` / `hdr_detection` | **不上屏**（对用户无意义，且只会显示成英文） |
| CLI 普通输出 | `[initSession:screenshot] GSAP proxy flush complete (599ms)`、`[Browser:HTTP404] …`、进度条、lint 提示 | **不上屏**，文案保持上一条 |

未登记的新阶段同样不上屏：宁可状态条不动，也不把英文术语丢给用户（CLI 升级新增阶段时需补 `HF_PHASE_LABELS`，见注意事项）。首次渲染的空白期由页面自己的占位文案兜着（如「已提交渲染（标准 · 30fps，约 30 秒）...」）。

关键设计是**跨 chunk 半行缓冲**：主进程推送的 `data.text` 可能把一行日志从中间截断，解析必须以“完整行”为单位。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `renderProgress` | `reactive({ text: string })` | 全局进度文案单例，初值 `text: ''` |
| `resetRenderProgress` | `() => void` | 页面挂载时复位：`text` 与 `hfLogBuf` 清空 |
| `initRenderProgress` | `() => void` | 订阅 `window.hfTools.onProgress`，每次收到 chunk 就解析并更新 `renderProgress.text` |

**模块级私有状态**：`HF_PHASE_LABELS`（`Record<string, string>`，12 条：阶段英文名 → 中文名）；`HF_CAPTURE_PHASES`（`string[]`，3 条真正的逐帧捕获阶段名，只有它们才展示帧进度）；`HF_MESSAGE_LABELS`（`Record<string, string>`，2 条值得告诉用户的 trace 消息中文名）；`hfLogBuf`（`let hfLogBuf = ''`，跨 chunk 的半行缓冲，未以 `\n` 结束的残片留在这里等下一块拼上）。旧版的 `hfLastLine`（原文兜底素材）已随「不回显原始日志」一并删除。

**`HF_PHASE_LABELS` 全量映射（12 条）**

| `ev.phase` | 中文名 |
| --- | --- |
| `compile` | 编译组合 |
| `browser_launch` | 启动渲染浏览器 |
| `browser_probe` | 浏览器校准 |
| `session_init` | 初始化渲染会话 |
| `video_extract` | 提取视频素材 |
| `audio_process` | 处理音轨 |
| `capture_calibration` | 帧捕获校准 |
| `capture_hdr_layered` | 逐帧捕获 |
| `capture_streaming` | 逐帧捕获 |
| `capture_disk` | 逐帧捕获 |
| `encode` | 视频编码 |
| `assemble` | 合成输出 |

三种 `capture_*` 阶段共用同一中文名「逐帧捕获」，因为对用户而言它们都是“一帧一帧出画面”的同一环节，无需区分底层策略。

**有意不上屏的内部阶段**：`pipeline`（流水线起止标记）、`file_server`（起本地文件服务器）、`worker_resolution`（决定并行 worker 数）、`capture_strategy`（选捕获策略）、`hdr_detection`（HDR 检测）——都是 CLI 内部决策，耗时极短且只有英文名，显示出来只会让状态条闪动并冒出看不懂的词。表里查不到的新阶段同理不显示。

**`HF_MESSAGE_LABELS` 白名单（2 条）**：`drawElement self-verify failed; retrying with forceScreenshot` → 快速捕获未通过校验，改用逐帧截图（会慢一些）；`spawn failed; falling back to disk` → 并行捕获启动失败，改用磁盘模式。其余 trace 消息（心跳 `stage still running`、内部 `resolved` / `started` / `frames resolved` 等）一律不显示；唯一例外是 `status === 'error'` 的失败原因，照实显示（见下）。

**`initRenderProgress()`**

1. 调用 `window.hfTools.onProgress(callback)` 注册进度回调。preload 层对进度类频道实施**单订阅语义**（模块级保存回调、只注册一次 `ipcRenderer.on`），因此重复调用只会替换回调，不会叠加监听器；实际调用点是 `App.vue` 的 `onMounted`，全局只执行一次。
2. **拼接缓冲**：`hfLogBuf += String((data && data.text) || '')`——对 `data` 与 `data.text` 双重兜底，非字符串值先 `String()` 化。
3. **按行切分并只挑 trace**：`while ((nl = hfLogBuf.indexOf('\n')) >= 0)` 取出 `hfLogBuf.slice(0, nl)` 并 `trim()`；**只有含 `[Render:trace]` 的行**会覆盖式写入本次回调的局部变量 `trace`（因此一个 chunk 里有多行时取**最后一条 trace**），其余行（`[initSession:…]`、`[Browser:…]`、进度条）直接丢弃，空行忽略。循环结束时 `hfLogBuf` 里只剩**最后一个不完整行**，留给下一 chunk 继续拼——这就是半行缓冲的全部实现。旧版只认“最后一行”，若最后一行恰是噪音就会把前面真正的 trace 丢掉；改为“最后一条 trace 行”后不再漏更新。
4. **无 trace 直接返回**：`if (!trace) return`——普通日志一律不上屏，`renderProgress.text` 保持上一条（首次渲染时保持空串，屏幕上是页面自己的占位文案）。
5. **解析 JSON**：`JSON.parse(trace.slice(trace.lastIndexOf('[Render:trace]') + 14).trim())`——`14` 正是 `'[Render:trace]'` 的长度，即跳过标记本身；用 `lastIndexOf` 以便同一行里出现多次时取最后一段；整段放在 `try` 里，抛错就 `return`（**不再把原始日志显示给用户**）。
6. **阶段闸门**：`key = String(ev.phase || '')` → 查 `HF_PHASE_LABELS[key]`；映射不到（内部微阶段、CLI 新增的未登记阶段）直接 `return`，不上屏。
7. **消息闸门**：`msg` 先查 `HF_MESSAGE_LABELS[rawMsg]` 取中文名；`ev.status === 'error'` 是唯一例外——失败原因 `rawMsg.slice(0, 120)` 原样展示，便于定位（其余英文消息，如心跳 `stage still running`、内部 `resolved` / `started` / `frames resolved`，一律丢弃）。
8. **元信息与拼装**：`secs = isFinite(Number(ev.elapsedMs)) ? Math.round(Number(ev.elapsedMs) / 1000) : 0`（毫秒转**整秒**，非法值视为 0；`elapsedMs` 是**自渲染流水线开始的总耗时**，不是本阶段耗时）；仅当阶段属于 `HF_CAPTURE_PHASES` 且 `totalFrames > 0`、`framesCompleted >= 0` 时再追加 `帧 a/b`。最终文案 `'渲染中 · ' + phase + （已用 Xs · 帧 a/b）+ （：msg）`：括号内两段用 ` · ` 连接，两段都缺时整段括号省略，`msg` 为空时冒号段省略，本次回调结束。

**`resetRenderProgress()` 与调用时机**：`renderProgress.text = ''` 清空展示 → `hfLogBuf = ''` **丢弃未挂载期间缓冲的半行残片**。语义对应旧版 `initHfPage` 清空 `#hf-status`：不清 `hfLogBuf` 的话，上一轮渲染遗留的半行残片会被拼到新一轮第一行前面，解析出一条畸形 JSON（新实现下的表现是“首条进度丢失”，而不是“显示乱码”）。调用时机：`initRenderProgress()` 在 `App.vue` 的 `onMounted` 全局只执行一次（订阅）；`resetRenderProgress()` 在**两个视频相关页面**挂载时执行——发起渲染的 `pages/HtmlGenPage/index.vue`（`onMounted` 清残留、`onRenderVideo` 结束覆盖 trace）与预览侧的 `pages/VideoPreviewPage/index.vue`（`onMounted` 里调用一次）。

**展示侧有两处，语义不同**：

- `pages/HtmlGenPage/index.vue`：`statusDisplay = computed(() => (rendering && renderProgress.text) ? renderProgress.text : status)` + `statusDisplayClass`（trace 接管时样式类返回 `''`）——**只有本页渲染中**才让全局 trace 顶掉本页状态文案。
- `pages/VideoPreviewPage/index.vue`：`statusText = computed(() => renderProgress.text || localStatus.value)`，模板 `:class="statusClass"`——不做 `rendering` 判定，全局 trace 非空即优先显示（本页**不发起渲染**，所以只在用户从「HTML生成」页发起渲染、又切回本页时才会命中 trace）。

**注意事项**：**必须以完整行为单位解析**（`[Render:trace]` 行可能被 IPC 分块从任意位置截断，直接对每次 chunk 做 `JSON.parse` 会频繁失败）；**半行只在“收到换行”后才被消费**，若 CLI 的最后一行没有以 `\n` 结尾（进程结束时常见），它不会被本次解析计入——这是刻意取舍，避免解析半截 JSON；**“宁可不刷新”的代价**：若 CLI 一条 trace 都不发（例如人为调高日志级别）、或长时间停在未登记阶段，状态区会一直停在上一条文案（整场都无 trace 时停在本页占位文案），这是为“不显示术语”付的代价，判断为可接受；**唯一显示英文的出口是 `status === 'error'` 的失败原因**（截断 120 字），属刻意保留的诊断信息；**`slice(tIdx + 14)` 的魔法数**与 `'[Render:trace]'.length` 绑定，若日志标记改名，必须同步改 `indexOf` 判定与偏移量两处；**`elapsedMs` 是自流水线开始的总耗时**（CLI 另有 `durationMs` 表示本阶段耗时，本模块不使用），`Math.round` 四舍五入，因此 1499ms 显示 `已用 1s`、1500ms 显示 `已用 2s`；**帧进度只对三个 `capture_*` 显示**，`capture_calibration` 写的是探针帧、`framesCompleted` 恒为 0，报帧数会误导；**映射缺失既不吞也不显示**——查不到 `HF_PHASE_LABELS` 就整条不上屏，所以 HyperFrames 升级后若新增/改名阶段，界面上会“少一段进度”，需要补表（CLI 内部的 `pipeline` / `file_server` / `worker_resolution` / `capture_strategy` / `hdr_detection` 属有意不补）；**`catch (e)` 为空块**，解析异常只用于“放弃本条”，不打印错误避免刷屏，代价是排查解析问题需自行打断点；**单例与订阅次数**——`renderProgress` 是模块级 `reactive`，多个页面读同一份文本，但 `initRenderProgress()` 若被多处调用，最终生效的是**最后一次**传入的回调（preload 单订阅语义），不会重复处理同一 chunk。

## 4. 运行环境：composables/useRuntime.ts 与 composables/useEnvGate.ts

运行环境已**分包**：`ffmpeg`（解包 179.9 MB）与 `hyperframes`（解包 439.9 MB）各自一个 7z、**首次用到时**由用户确认后下载并解到 `<userData>/runtime/<包名>/`（**两包实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14；比旧单包 `runtime.7z` 147.4 MB 还小）；`whisper`（12.5 MB）随安装包，装完即可离线转录（主进程实现见 [main/runtime.ts.md](../../main/runtime.ts.md)，方案见 `docs/runtime-pack-split.md`）。渲染层因此拆成两个模块级单例：`useRuntime` 管**状态**，`useEnvGate` 管**「缺包 → 问用户 → 装好后继续」这条交互**。两者的分工里有一条硬约束：**凡是交给 `runtimeTools.prepare()` 的包名数组，都必须是 `toRaw(list).slice()` 出来的普通数组**——`ipcRenderer.invoke` 的参数要过**结构化克隆**（structured clone），而 `missing.value`（`runtime` 是 `ref`，深层响应式 ⇒ 其中的数组是 Proxy）与确认框里的 `packs`（`ref([])`）都是 **Vue 的响应式 Proxy**，**代理对象不可克隆**，`invoke` 会直接抛 `DataCloneError: [object Array] could not be cloned.`，主进程的 handler 根本不会执行（所以 `runtime.log` 一个字都没有、`userData/runtime/` 也不创建），而这个异常以前被 `prepare()` 的 catch 吞掉 ⇒ 横幅 / 设置页 / 确认框三个「下载运行环境」按钮点了都毫无反应；现在 `prepare()` 把「没能启动」的原因写进 `runtime`（`phase='error'` + `message` / `detail`），失败不再静默。

### 4.1 `useRuntime.ts`（90 行）—— 运行环境状态单例

**模块级单例**：`runtime`（`ref<RuntimeProgressPayload>`，初值 `{ phase: 'idle', pack: null, percent: 0, packs: [], missing: [], status: { ffmpeg: 'unknown', hyperframes: 'unknown' }, message: '', source: '', bytes: 0, unpackedBytes: 0, files: 0, cancellable: false }`）+ `bound` 幂等标志。

`useRuntime()` 内部另有两个**不导出**的辅助：`plainPacks(list) = toRaw(list).slice()`（把包名数组还原成普通数组再交给 IPC）与 `reportNotStarted(message, detail)`（`busy` 为真时直接返回，否则把 `runtime` 换成 `{ ...runtime.value, phase: 'error', percent: 0, message, detail: detail || undefined }`——正在跑的时候不覆盖进行中的进度）。

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `initRuntime()` | `() => void` | 外壳挂载时调用一次；`bound` 保证只生效一次：**先** `window.runtimeTools.onProgress((d) => { runtime.value = d })` 订阅进度，**再** `window.runtimeTools.status()` 补齐首帧（`d && d.phase` 才写入），`.catch` 静默（主进程未就绪时保持 `idle`，不打扰用户） |
| `useRuntime()` | `() => { runtime, busy, failed, missing, hasMissing, ready, cancelable, missingText, prepare, cancel }` | 见下表 |

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `runtime` | `Ref<RuntimeProgressPayload>` | 原始进度载荷（`phase` / `pack` / `percent` / `packs` / `missing` / `status` / `message` / `detail?` / `source` / `bytes` / `unpackedBytes` / `files` / `cancellable`） |
| `busy` | `computed<boolean>` | `phase` 为 `checking` / `downloading` / `extracting` 之一（此时横幅显示进度条与「取消」） |
| `failed` | `computed<boolean>` | `phase === 'error'` |
| `missing` / `hasMissing` | `computed<RuntimePackName[]>` / `computed<boolean>` | 当前仍缺的包 / 是否缺包（**缺包是首次安装的常态**，此时不自动下载，等用户在某处确认） |
| `ready` | `computed<boolean>` | 不忙、不失败、也不缺包；已就绪时界面保持干净（不常驻「已就绪」） |
| `cancelable` | `computed<boolean>` | `payload.cancellable`（**checking / downloading / extracting** 期间为真；`cancelPrepare()` 本来就支持取消取清单阶段，界面以前只在下载 / 解包时才给「取消」按钮） |
| `missingText` | `computed<string>` | 把缺的包按 `PACK_LABEL`（`ffmpeg` → 「音视频处理（ffmpeg）」、`hyperframes` → 「视频渲染引擎（HyperFrames）」）用「、」拼成一句话 |
| `prepare(packs?)` | `async (packs?: RuntimePackName[]) => Promise<boolean>` | 先 `const want = plainPacks(packs && packs.length ? packs : missing.value)` 再 `window.runtimeTools.prepare(want)`；拿到**非 ok 回执**（如忙碌期的「正在准备另一个运行环境包，请稍候再试」）或 `invoke` 抛异常时调 `reportNotStarted(...)` 把失败写进状态并返回 `false`（以前这里是一个空的 `catch { return false }`，什么都不显示），成功返回 `true`；只负责触发，进度由 `runtime:progress` 回填 |
| `cancel()` | `async () => Promise<void>` | 调 `window.runtimeTools.cancel()`（取消 = 不下载，且不留半截状态；成败同样由进度回填） |

> 旧的 `retry()` 与 `sizeText` 已删除：重试统一走 `prepare()`，体积文案由主进程的 `message` 与确认框的 `HINT_MB` 承担。

### 4.2 `useEnvGate.ts`（158 行，**本轮新增**）—— 「需要下载运行环境」确认框

任何用到 ffmpeg / hyperframes 的功能在动手前先校验，缺包时**不下载、不阻塞**，而是把 `needPacks` 交给这里弹确认框：

```
[下载运行环境] [取消]
  ├─ 取消 ⇒ 不产生任何下载，发起该操作的那次动作也就此作废（什么都不发生）
  └─ 下载 ⇒ 框内原地显示进度与「取消」；装好后按钮变 [继续]，点它才用原参数重发原来的操作
```

**模块级单例**（全局只有一个框）：`visible` / `packs` / `title` / `phase: 'confirm' | 'downloading' | 'ready'` / `percent` / `readyNow` / `message` / `detail` / `onContinue`；常量 `LABEL`（同 `PACK_LABEL`）与 `HINT_MB = { ffmpeg: 43, hyperframes: 105 }`（**体积提示**：两者都已按 2026-10-14 实测的 42.6 MB / 103.1 MB 回填；真实值以主进程清单为准）。

| 导出 | 说明 |
| --- | --- |
| `EnvGateResult` | `interface { ok: boolean; pending: boolean }`：`ok` = 包已就绪、可以继续；`pending` = 已弹框，调用方直接返回，等用户点「继续」后由 `onContinue` 重发 |
| `initEnvGate()` | **不订阅** `runtime:progress`，而是 `const rt = useRuntime()` 后 `watch(() => rt.runtime.value, (d) => { if (d && visible.value) applyProgress(d) }, { deep: true })` —— 同一份状态、同一个订阅者，确认框照样实时；`applyProgress(d)` 把状态映射成三态：`downloading` / `checking` / `extracting` → 进度态；`ready` 且 `missing` 非空 → 回到确认态并换上还缺的包；`ready` 且无缺 → `ready` 态（`readyNow = true`、100%）；`cancelled` → 回确认态（文案取推送或「已取消下载」）；`error` → 回确认态并写 `message` / `detail` |
| `guard(need, actionName, cont?)` | 只在 `rt.missing` 与 `need` 有交集时弹框（否则返回 `{ ok: true, pending: false }`）；弹框时记下 `onContinue = cont`，返回 `{ ok: false, pending: true }`；`need` 为空数组时按 `['ffmpeg','hyperframes']` 兜底 |
| `confirmDownload()` | 进 `downloading` 态、`message = '正在准备下载…'`，调 `rt.prepare(packs)`——真正的进度 / 终态由推送驱动 |
| `cancelDownload()` | 调 `rt.cancel()`（中断下载 / 解包，不留半截状态，框回到可再次下载的确认态） |
| `continueAction()` | **先 `close()` 再执行 `onContinue`** —— 用原参数重发那一次操作；**刻意不自动续做**，用户不会遇到「我忘了点过什么，它自己开始跑」 |
| `close()` | 隐藏并清空 `onContinue` / `readyNow` / `detail` / `message` |
| `labelText(list)` / `sizeText` | 把包名渲染成「<label>（约 N MB）」；`sizeText` 是 `packs` 的 `computed` |

**使用方**：`App.vue`（`initEnvGate()` + 模板里内联渲染确认框）、`pages/HtmlGenPage/index.vue`（`转成视频` 要 `['ffmpeg','hyperframes']`、`提取视频原声` 要 `['ffmpeg']`）、`pages/SubtitlePage/TranscribeSection.vue`（`文字转字幕`，只在要转码时缺 ffmpeg）、`pages/TextTtsPage/AlignSection.vue`（`逐句对齐配音`）。页面用法固定为：

```ts
const g = await envGate.guard(need, '动作名', () => { void doIt(true) })
if (!g.ok) return                     // 缺包（框已弹出）或用户取消，本次操作到此为止
// 主进程返回 needPacks 时再 guard 一次，用 skipEnvGuard = true 重发
```

**注意事项**：① 续做所需的动作只活在 `onContinue` 闭包与框的组件作用域内，关框即丢弃，**主进程不记「待续做」**，所以不存在成环问题；② **进度来源只有一个订阅者**：preload 的 `runtime:progress` 是单订阅语义（重复注册只替换回调），因此 `useEnvGate` **刻意不再自己调 `window.runtimeTools.onProgress(...)`**，改为 `watch` 消费 `useRuntime()` 的 `runtime` ref（见 4.2 的 `initEnvGate`）——这样外壳横幅 / 设置页 / 确认框读的是同一份状态，且后注册者不会顶掉 `useRuntime` 的订阅（旧写法会导致 `useRuntime` 的 `runtime` 停在首帧 `status()` 快照上，已修正）；③ 体积提示（2026-10-14 实测）：`ffmpeg` 42.6 MB、`hyperframes` 103.1 MB，**两包合计 145.7 MB**；主进程 `packSizeText()` 才是取清单后的口径。

## 5. 历史数据：composables/useLegacyData.ts

品牌 / 目录改名后，老用户的数据可能还留在旧目录（如 `%APPDATA%\my-app`）。主进程负责扫描、归属证明与执行（见 [main/index.ts.md](../../main/index.ts.md) §3.1），本模块只做两件事：**外壳挂载时问一次「有没有」**、**把用户在弹窗里的选择回传**。

**模块级单例**：`info`（`ref<LegacyDataInfo | null>(null)`）、`visible`（`ref(false)`）、`busy`（`ref(false)`）+ `bound` 幂等标志。

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `initLegacyData()` | `() => void` | `bound` 保证只问一次；`window.legacyTools.status()` 返回 `d && d.dir` 时写 `info` 并把 `visible` 置真（弹窗出现），否则什么都不做（**没有旧数据是常态**）；`.catch` 静默（主进程未就绪时不打扰用户） |
| `useLegacyData()` | `() => { info, visible, busy, entryText, resolve }` | 见下表 |

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `info` / `visible` / `busy` | `Ref<LegacyDataInfo \| null>` / `Ref<boolean>` / `Ref<boolean>` | 扫描结论、弹窗显隐、是否正在执行（按钮 `:disabled="busy"`、主按钮文案切换为「处理中…」） |
| `entryText` | `computed<string>` | 把主进程给的**目录/文件名翻译成人话**再拼成一句话：条目名经 `ENTRY_LABEL` 映射（`projects`→项目 / `whisper`→识别模型 / `voice`→音色数据 / `tts-output`→配音输出 / `html-agent`→生成记录 / `settings.json`→设置），映射不到的原样输出，用「、」连接；`projects > 0` 时追加 `（N 个项目）` |
| `resolve(action)` | `async (action: LegacyResolveAction): Promise<LegacyResolveResult \| null>` | 见下 |

`resolve(action)` 的执行步骤：① `busy` 为真时**直接返回 `null`**（防重复点击）；② 置 `busy = true`；③ `await window.legacyTools.resolve(action)`；④ **无论成败都先把 `visible` 置假**（收起弹窗，不让用户盯着一个卡住的框）；⑤ 返回结果对象（异常分支返回 `null`，`visible` 同样置假）；⑥ `finally` 复位 `busy`。

**`ENTRY_LABEL` 是「界面讲人话」的唯一落点**：主进程只回目录/文件名（`entries`），中文映射写在渲染层，因此主进程白名单（`OWN_DATA_ENTRIES`）新增条目时**这里也要补一行**，否则界面会直接露出英文目录名（只是退化显示，不会报错）。

**使用方**：`components/LegacyDataDialog.vue`（唯一消费方：模板读 `info.dir` / `entryText` / `visible` / `busy`，三个按钮分别 `resolve('later')` / `resolve('delete')` / `resolve('migrate')`；迁移后调 `refreshProject()` 刷新项目列表并 `toast(...)` 报告结果）、`App.vue`（`<LegacyDataDialog />` 宿主 + `onMounted` 里 `initLegacyData()`）。

**注意事项**：**主进程不弹原生对话框、不做任何界面展示**——本模块只拉取结论与回传选择，`legacyTools` 也**没有任何 `on*` 推送通道**（纯拉取）；**「稍后再说」不清主进程缓存**：本次会话内再问仍会得到同一份 `info`，真正的「下次启动再问」由下次启动重新扫描实现；**`resolve` 的返回值不是 `IpcResult`**（形状为 `{ ok, action, moved?, skipped?, failed?, message? }`，见 `@shared/types` ⑧b），调用方按 `r.ok` 分支给 toast。

## 5.1 配置类错误弹窗：composables/useConfigPrompt.ts（86 行，2026-10 新增）

缺 API Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用这几类错误，原先只躺在页面内的状态行里——用户看一眼不知道去哪修，还得自己翻到设置页找对应填框。本模块把它们升级成**一个全局弹窗**，与 `useEnvGate` 是同一套范式（模块级 `ref` 单例 + 两个按钮 + 取消即作废），差别在三点：

1. **不驱动流程**：`useEnvGate` 的「继续」要用原参数重发那一次操作（`needPacks` 语义），本框只是一个「去哪修」的分流入口——关掉它本次操作就作废。
2. **不显示「查看详情」**：配置类错误的原始报文对用户没有可操作性，多一个折叠区会让「点哪个按钮」这个唯一决策变模糊（排障详情仍由主进程落日志）。
3. **只有 `[去设置]` / `[取消]`**：曾经有过「去充值」（余额类外链到厂家充值页），**已按用户要求整条摘除**——余额 / 欠费去设置也修不好，改为走内嵌状态行（文案说明去厂家控制台充值），因此 `ConfigTarget` 里也没有 `'billing'`。

**模块级单例**：`visible` / `title` / `message` / `target`（`ref<ConfigTarget>`，初值 `'model'`），另有普通变量 `autoJump`（音频合成逐句后台进行，出错位置可能不在当前页；只对「明显在配音页发起」的动作自动跳设置，其余一律由用户点按钮决定，**不把用户从当前页拽走**）；常量 `FALLBACK_TITLE`（`model` → 「需要设置自定义模型」、`voice` → 「需要设置语音服务」；主进程给了 `title` 就用主进程的）与 `SECTION_OF: Record<ConfigTarget, SettingsSectionKey> = { model: 'model', voice: 'voice' }`。

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `useConfigPrompt()` | `() => { visible, title, message, target, open, fromResult, go, close }` | 见下表 |

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `visible` / `title` / `message` / `target` | `Ref<boolean>` / `Ref<string>` / `Ref<string>` / `Ref<ConfigTarget>` | 弹窗显隐、标题、正文人话文案、目标设置分类（模板 `App.vue` 只读它们，不做判断） |
| `open(msg, target, jump?, title?)` | `(string, ConfigTarget, boolean?, string?) => void` | 打开弹窗：写 `message` / `target`（非 `'voice'` 一律归 `'model'`）/ `title`（`title \|\| FALLBACK_TITLE[target] \|\| '需要先完成设置'`），置 `visible = true`；`jump` 为真时**立即调 `go()`**（配音页「没配 Key」用 `jump = true` 保持「先说明原因再去设置」的旧效率） |
| `fromResult(res, jump?)` | `(unknown, boolean?) => boolean` | 便捷入口：拿主进程失败分支，`res.needConfig` 为空返回 `false`；否则 `open(res.message \|\| '', res.needConfig, jump, res.title)` 并返回 `true`——**调用方据此决定要不要再 toast**（避免弹窗 + toast 重复打扰） |
| `go()` | `() => void` | 主按钮：`requestSettingsSection(SECTION_OF[target] \|\| 'model')` → `close()` → `void goPage('settings')`。**只跳设置页对应分类，不涉及任何外链** |
| `close()` | `() => void` | `visible = false` 且 `autoJump = false` |

**分类不在渲染层判定**（源码注释的核心约定）：主进程 `friendlyError()` 判出「去设置页改配置就能解决」才给 `needConfig`（见 [shared/errors.ts.md](../../shared/errors.ts.md)），渲染层不做正则猜文案；`needConfig` 为假的失败保持原样（页面状态行 / toast）。

**页面侧三种用法**（与各页面文档一致）：

```ts
// ① 直接打开（HtmlGenPage 的 runAgent 失败分支：jump 传 false，不把用户拽走）
if (res && res.needConfig) configPrompt.open(msg, res.needConfig, false, res.title); else toast(msg);
// ② 便捷入口（SynthSection / VoiceSection / AlignSection：已弹框就不再叠 toast）
if (configPrompt.fromResult(fail)) { /* 已弹「去设置」 */ } else if (fail.needPacks?.length) { … } else toast(msg);
// ③ 本地校验也能用（TextTtsPage/helpers.requireCfg：没配 Key，jump = true）
configPrompt.open('尚未配置「…」的语音 API Key，请先到「设置 → 语音服务」填写并保存', 'voice', true);
```

**使用方**：`App.vue`（唯一渲染弹窗宿主的地方，`const configPrompt = useConfigPrompt()`，紧跟 `const gate = useEnvGate()`）、`pages/HtmlGenPage/index.vue`、`pages/TextTtsPage/{helpers.ts,SynthSection.vue,AlignSection.vue,VoiceSection.vue}`。

**注意事项**：**没有 init 步骤**——与 `initEnvGate()` / `initRuntime()` 不同，它不订阅任何推送，模块级 ref 由页面按需触发即可；**设置页刻意不用它**（`SettingsPage.onTest()` 的按钮与失败状态行都在本页，弹「去设置」等于让用户原地跳）；**`jump = true` 只用于配音页的本地校验**（那里原本就是「直接 `goPage('settings')` 把用户拽走」，改为 `jump = true` 后行为等价但多了一句「为什么」）；**它不碰 preload**（只用 `./useNavIntent` 的 `requestSettingsSection` 与 `@renderer/pages` 的 `goPage`），因此摘除「去充值」时 `window.appTools.openExternal` 一并消失、本模块不受影响。

## 6. 语速：utils/rate.ts

试听**背景音频**（「预览」卡片里选定的项目背景音频：本地音频文件或「已生成音频」列表中的一份）时，用户需要临时调快/调慢播放速度（例如 1.5x 快速检查），但**磁盘上的音频文件不能被改动**。本模块据此提供三个纯函数，核心语义是「**只改播放速率，不改磁盘音频**」：这三个函数**只**触碰（a）输入框的 `value` 与（b）`audio.playbackRate` 这一个运行时属性，既不写文件、也不通知主进程、也不参与任何落盘/合成流程；因此用户调完语速后重新打开应用，音频文件仍是原始速度。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `rateClamp` | `(v: number) => number` | `Math.min(2, Math.max(0.5, v))`，取值域 `0.5 ~ 2.0` |
| `applyRate` | `(el: HTMLInputElement, audio?: HTMLMediaElement \| null) => number` | 从 `el.value` 解析速率 → 兜底 → 夹紧 → 回写 `el.value` → 同步 `audio.playbackRate` → 返回最终数值 |
| `stepRate` | `(el: HTMLInputElement, audio: HTMLMediaElement \| null, delta: number) => number` | 在当前值上 `+delta`，四舍五入到两位小数后夹紧，写回输入框并同步播放器，返回最终数值 |

**参数与返回值**：`rateClamp` 收 `v`（待夹紧的数值），返回落在 `[0.5, 2.0]` 内的数值；`applyRate` 的 `el` 为语速文本框 `HTMLInputElement`、`audio` 为 `HTMLMediaElement | null` 且默认 `null`，返回规范化后的速率数值（调用方用它更新 Vue 的显示状态）；`stepRate` 的 `audio` 此处**无默认值**、必须显式传，`delta` 为步长（如 `+0.1` / `-0.1`），返回步进并夹紧后的速率数值。

**`rateClamp(v)`**：`Math.max(0.5, v)` 抬到下限 0.5 → `Math.min(2, ...)` 压到上限 2.0。上下限都是**硬编码字面量**，与本文件顶部注释「0.5~2.0」以及输入框 `title="播放语速 0.5~2.0（非法或空值自动回退 1x）"` 一一对应。它**不做 `NaN` 防护**：`Math.max(0.5, NaN)` 得 `NaN`，再 `Math.min(2, NaN)` 仍为 `NaN`；NaN 兜底由 `applyRate` / `stepRate` 负责。

**`applyRate(el, audio = null)`**：`let v = parseFloat(el.value)` 从输入框当前文本解析浮点数（用户手输场景，如 `1.25`）→ `if (!isFinite(v)) v = 1`（空串、`"abc"`、`NaN`、`Infinity` 一律回退 `1` 即 1x 原速）→ `v = rateClamp(v)` 夹紧 → `el.value = String(v)` **把规范化结果写回输入框**，用户立刻看到被修正/夹紧后的值（输入 `5` 会变成 `2`，输入 `0.1` 会变成 `0.5`）→ `if (audio) audio.playbackRate = v`（仅在传入播放器时同步；音频元素尚未挂载/未选中时传 `null` 也不会报错）→ `return v`，调用方通常写成 `rateValue.value = String(applyRate(el, audioEl.value))`。

**`stepRate(el, audio, delta)`**：`parseFloat(el.value)` + `if (!isFinite(v)) v = 1`（与 `applyRate` 相同的兜底）→ `v = rateClamp(Math.round((v + delta) * 100) / 100)`，即**先加步长、再四舍五入到两位小数、最后夹紧**，先取整是为了消除浮点误差累积（`1.1 + 0.1` 会得到 `1.2000000000000002`，取整后是 `1.2`）→ `el.value = String(v)` 回写输入框 → `if (audio) audio.playbackRate = v` 同步播放器 → `return v`。`delta` 本身不做 `isFinite` 校验，约定由调用方传入有限的字面量（`0.1` / `-0.1`）。

**使用方**：`pages/HtmlGenPage/index.vue`（`import { applyRate, stepRate }`；输入框 `rateEl` 配 `rateValue` 初值 `'1'`，`onRateInput` 调 `applyRate(el, audioEl.value)`，加减按钮调 `stepRate(el, audioEl.value, delta)`——`audioEl` 是「预览」卡片里**背景音频**的试听元素，随 `audioPreviewVisible` 显隐）；`pages/TextTtsPage/SynthSection.vue` 两处独立使用——合成结果试听（`resultRateValue` + `resultAudioEl`）与生成音频试听（`genRateValue` + `genAudioEl`），同样走 `applyRate` / `stepRate`。两个页面的模式完全一致：`<input ref="rateEl" :value="rateValue" ... @input="onRateInput">` + 一对 `+/-` 按钮，Vue 侧只保存显示字符串，**真值由本模块返回**。

**注意事项**：**取值范围恒为 `0.5 ~ 2.0`**，修改上限/下限必须同时改 `rateClamp` 内的两个字面量与输入框 `title` 提示文案；**非法值回退 1 而不是回退到上一次有效值**，因为函数是无状态的、拿不到历史值；**`el` 是必需参数且会被就地修改**，本模块的“输入框”是唯一数据载体，Vue 里配合 `:value="rateValue"`（单向绑定）+ `@input` 回写，而不是 `v-model`，以避免双向绑定与函数内写值互相打架；**`audio` 可空是刻意的**，用户可能还没选中音频文件就先调语速，此时传 `null` 只更新输入框和返回值，等音频就绪后再调用一次即可生效；**`stepRate` 的 `audio` 没有默认值**，必须显式传 `null` 或元素，这是类型签名层面的有意区分（防止忘记传播放器）；**只影响播放，不影响产物**——`playbackRate` 是纯粹的客户端播放属性，不改变音频数据，因此语速试验可以随意做，不会污染项目产物；**浮点精度**：`stepRate` 用 `Math.round(x * 100) / 100` 固定两位小数，`applyRate` 则**保留用户输入的全部精度**（如 `1.333`），只在超界时夹紧；**不做四舍五入到 0.1 网格**，手动输入 `1.05` 是允许的，界面上并不强制对齐到步长。

## 7. 工具：utils/escape.ts 与 utils/time.ts

### 7.1 `utils/escape.ts` —— `escTxt`

全渲染层唯一的文本转义入口（替代旧版 `window.App.escTxt`，导出 `escTxt(s: unknown): string`）。它解决的问题是：项目名、文件名、音频路径、音色名、模型 URL、字幕文本等数据都来自**主进程扫描或用户输入**，属于不可信内容；一旦被拼进 `innerHTML` / `v-html` / 模板字符串渲染的富文本中，其中的 `<` 就可能被浏览器当成标签开始，造成**标记注入**（轻则排版错乱，重则执行注入的标签/属性，例如 `<img onerror=...>`）；`escTxt()` 把危险字符替换为 HTML 实体，使它们在页面上**按字面显示**而不是被解析。它还承担了「历史重复实现合并」的职责：注释明确指出字幕页的本地副本在 Phase 6 合并到此文件，全项目只需维护一份。

**实现逐步拆解**：`String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')`

| 步骤 | 代码 | 说明 |
| --- | --- | --- |
| 1 | `s == null ? '' : s` | 用宽松等于同时兜住 `null` 与 `undefined`，统一转为空串（而不是显示 `"null"` / `"undefined"`） |
| 2 | `String(...)` | 数字、布尔、对象等非字符串值先安全字符串化 |
| 3 | `.replace(/&/g, '&amp;')` | **必须第一步做**：`&` → `&amp;` |
| 4 | `.replace(/</g, '&lt;')` | `<` → `&lt;` |
| 5 | `.replace(/>/g, '&gt;')` | `>` → `&gt;` |

**转义范围**：`&` → `&amp;` ✅、`<` → `&lt;` ✅、`>` → `&gt;` ✅；`"` / `'` ❌ 不处理、`` ` `` ❌ 不处理。**顺序为何重要**：如果先替换 `<` 再替换 `&`，那么第 4 步生成的 `&lt;` 会被第 3 步的 `&` 规则二次转义成 `&amp;lt;`，页面上就会显示成字面量 `&lt;`，因此 `&` 必须排在最前。**为何不转义引号**：本函数的使用场景是把外部数据放进**元素文本内容**（`{{ }}` 之外需要手工拼接的富文本、`v-html` 内的文本节点），此时引号不构成边界；若要在 HTML **属性**中拼接该值，则需要额外的引号转义。

**典型调用形态**：页面脚本中 `import { escTxt } from '@renderer/utils/escape'`（跨目录导入统一走 `@renderer` 别名），再在拼接 HTML 字符串或绑定 `title` 时包裹外部数据，如 `'<b>' + escTxt(p.title || p.name) + '</b>'`、`:title="'打开项目 ' + escTxt(p.name)"`。执行链路：页面拿到主进程返回的原始字符串（含可能的 `<` 等字符）→ 调用 `escTxt(raw)` 得到实体化后的安全字符串 → 拼进 HTML 字符串 / 绑定到 `:title` / 用于 `v-html` → 浏览器解析时实体被还原为字面字符，标签注入失效。

**调用方（已核对 import）**：`pages/HtmlGenPage/index.vue`（背景音频文件名 `appState.project.audioFile` 的展示；视频素材名改由 `<option>` 文本插值输出、不经 `escTxt`）、`pages/VideoPreviewPage/index.vue`（**已无 `escTxt` 调用**：成品路径改由 `{{ videoPath }}` 插值输出，Vue 自动转义）、`pages/HomePage/index.vue`（**已无 `escTxt` 调用**：项目名、状态标记与时间全部走 `{{ }}` 插值，卡片标题用 `:title="'打开项目 ' + p.name"` 由 Vue 转义）、`pages/TextTtsPage/VoiceSection.vue`（音色条目名称、音色值、目标模型、附加说明、降级原因文案；原 `pages/SoundCopyPage/index.vue`）、`pages/SettingsPage/WhisperSection.vue`（模型名称、文件名、描述、下载地址等说明文本）、`pages/TextTtsPage/AlignSection.vue`（对齐结果中的每句文本 `d.text`，含 `:title` 与文本节点两处）。使用场景高度集中在「**字幕/文本类内容 + 文件路径类内容**」——正是最可能包含 `<`、`&` 的数据来源（例如 SRT 文本里的 `<i>`、路径里的 `&`）。

**注意事项**：**只转义 `& < >`**，这是“文本节点防注入”的最小充分集，不要把它当通用 HTML 过滤函数使用，它**不做**属性值转义、不剥离标签、不防 `javascript:` URL；**不做反转义**，没有对应的 `unescape`，如果拿到的是 HTML 实体文本却需要原文，需另行处理；**幂等性**——对已转义文本再次调用会二次转义（`&lt;` → `&amp;lt;`），因为 `&` 会被再处理一次，**切勿对同一值重复调用**；**入参类型是 `unknown`**，设计上允许传任何值（对象会被 `String()` 成 `[object Object]`），但不建议把结构化数据交给它，需要展示对象字段时先取字段再转义；**`null` / `undefined` 视为空串**，界面上表现为“该处无内容”而不是显示 `null`，调用方因此可以省掉前置空值判断；**它不能替代 Vue 的默认转义**——在 `{{ }}` 插值中 Vue 已自动转义，重复调用 `escTxt()` 会让用户看到 `&amp;` 之类的实体文本，本函数只用于**必须手工拼 HTML 字符串**的场合（如 `v-html`、动态 `title`、表格行拼接）；**源文件仅 4 行**，任何功能扩展（例如补引号转义）都会改变上述使用点的行为，需同时检查上表全部调用方。

### 7.2 `utils/time.ts` —— `fmtTime` / `fmtTimeMs`

字幕与配音对齐都需要把「秒」显示成人类可读的时间轴字符串，本文件是这一需求的**唯一实现**（注释说明它合并了原先分散在 `subtitle/index.js` 与 `textTts/align.js` 中的重复代码；`pages/SubtitlePage/helpers.ts` 顶部也注明「fmtTime / fmtTimeMs 已合并至 utils/time.ts」）。

| 函数 | 定位 | 输出示例 |
| --- | --- | --- |
| `fmtTime(sec: number): string` | **粗粒度**展示与合计（秒级，四舍五入） | `00:07`、`01:23`、`60:00` |
| `fmtTimeMs(sec: number): string` | **精确**时间轴（毫秒级，3 位小数，用于落盘/对齐） | `00:07.250`、`01:23.004`、`00:02.000` |

关键取舍：`fmtTime` 会**四舍五入到整秒**（适合“总时长约 …”这类概览），`fmtTimeMs` 用**截断秒 + 四舍五入毫秒 + 进位递归**（适合必须精确、不能出现 `.1000` 的时间轴）。

**`fmtTime(sec)`**：`const s = Math.max(0, Math.round(Number(sec) || 0))` → `String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')`。逐步为：① `Number(sec) || 0` 把入参转数字，`NaN`、`0`、`''`、`null` 等假值统一成 `0`；② `Math.round(...)` 四舍五入到整秒（`0.4 → 0`，`0.5 → 1`）；③ `Math.max(0, ...)` 负数归零，保证不出现 `-1:59`；④ `Math.floor(s / 60)` 取分钟部分；⑤ `s % 60` 取秒部分（`0 ~ 59`）；⑥ `padStart(2, '0')` 两段都补零，分钟**不截断**，超过 99 分钟自然显示 3 位（如 `100:00`）。

**`fmtTimeMs(sec)`**：`const t = Math.max(0, Number(sec) || 0)`；`const s = Math.floor(t)`；`let ms = Math.round((t - s) * 1000)`；`if (ms >= 1000) return fmtTimeMs(s + 1)`；最后拼接 `分 + ':' + 秒 + '.' + String(ms).padStart(3, '0')`。逐步为：① `Number(sec) || 0` + `Math.max(0, ...)` 与 `fmtTime` 相同的兜底（非法值/负数归零）；② `Math.floor(t)` **截断**取整秒（这里刻意不四舍五入，否则 1.9 会变成 2 而毫秒部分错位）；③ `Math.round((t - s) * 1000)` 把小数部分换算为毫秒并四舍五入；④ **进位规则**——小数部分 ≥ 0.9995 时毫秒会变成 1000，此时递归调用 `fmtTimeMs(s + 1)`，让下一层的毫秒自然归零为 `000`；⑤ 拼接时分钟、秒同样 `padStart(2, '0')`，毫秒 `padStart(3, '0')`（`7` → `007`）。

**进位为什么用递归**：`1.9996` → `s = 1`、`ms = 1000` → 递归 `fmtTimeMs(2)` → 输出 `00:02.000`。若改用“毫秒置 0、秒 +1 后继续拼接”，需要额外处理秒达到 60 再进位到分钟的情况；直接递归复用同一套 `Math.floor` / `%` / `padStart` 逻辑，天然覆盖 59 → 60 秒与 59 → 60 分的边界。

**格式对照表**

| 入参 `sec` | `fmtTime` 结果 | `fmtTimeMs` 结果 |
| --- | --- | --- |
| `0` | `00:00` | `00:00.000` |
| `7.25` | `00:07` | `00:07.250` |
| `59.6` | `01:00` | `00:59.600` |
| `1.9996` | `00:02` | `00:02.000` |
| `83.004` | `01:23` | `01:23.004` |
| `-5` | `00:00` | `00:00.000` |
| `NaN` / `undefined` | `00:00` | `00:00.000` |

**调用侧两条链路**：1. **概览/合计链路（`fmtTime`）**——`pages/SubtitlePage/index.vue` 汇总字幕条目 → `'共 ' + valid + ' 条 · 总时长约 ' + fmtTime(total)`；`pages/TextTtsPage/AlignSection.vue` 对齐结果汇总 → `'共 ' + ds.length + ' 句 · 总时长 ' + fmtTime(res.totalDur)`，同一文件还用 `fmtTime(d.subtitleStart)` / `fmtTime(d.audioStart)` 展示每句的字幕/音频起点。2. **精确时间轴链路（`fmtTimeMs`）**——`pages/SubtitlePage/helpers.ts` 生成 SRT 时间码：`'[' + fmtTimeMs(s) + (e > s ? '-' + fmtTimeMs(e) : '') + '] ' + txt`；`pages/TextTtsPage/AlignSection.vue` 用相同模式生成对齐后的字幕行。注释说明 `fmtTimeTrim` 解析用户输入的 `.900` 这类小数时按位数解释，与落盘的 `fmtTimeMs` 对齐。

**调用方（已核对 import）**：`pages/SubtitlePage/index.vue` 用 `fmtTime` 做字幕总时长概览（`共 N 条 · 总时长约 MM:SS`）；`pages/SubtitlePage/helpers.ts` 用 `fmtTimeMs` 生成标准 SRT 时间码 `[MM:SS.mmm-MM:SS.mmm]`；`pages/TextTtsPage/AlignSection.vue` 同时用 `fmtTime`、`fmtTimeMs`——每句起点展示（秒级）+ 对齐字幕行落盘（毫秒级）。注意 `pages/SubtitlePage/index.vue` 中每行输入框显示的是 `fmtTimeTrim(...)`（`helpers.ts` 中的函数，允许带小数），而**汇总**用 `fmtTime`——两种精度分别对应“编辑参考”与“概览”。

**注意事项**：**`fmtTime` 与 `fmtTimeMs` 对同一入参可能给出不同分钟**——例如 `59.6` → `fmtTime` 得 `01:00`（四舍五入到 60 秒），`fmtTimeMs` 得 `00:59.600`（截断秒），这是刻意行为，不要在“概览”与“时间轴”之间互相复制粘贴结果；**负数一律归零**（`Math.max(0, ...)` 使 `-1.5` 显示为 `00:00.000` / `00:00`，不出现负号）；**`Number(sec) || 0` 会把 `0` 也走兜底分支**，但结果相同（0），因此无害，真正的意义是把 `NaN`、`undefined`、`''` 变成 0；**未做 `isFinite` 兜底**——`Number(sec) || 0` 不会拦下 `Infinity`（`Infinity || 0` 仍是 `Infinity`），此时 `fmtTime` 会得到类似 `"Infinity:NaN"` 的异常字符串，约定调用方只传有限的秒数（来自主进程的时长/偏移计算）；**毫秒固定 3 位**，不显示帧号、不做 `HH:MM:SS` 的小时段，超过一小时的时长表现为分钟继续累加（如 `125:30`）；**`fmtTimeMs` 依赖递归进位**——`1.9996` → `00:02.000`，`59.9999` → `01:00.000`，递归深度为 1 级（`s + 1` 必为整数，其小数部分为 0），无栈风险；**分钟段不设上限**，`padStart(2, '0')` 只在不足两位时补零，分钟超过 99 时自然变宽（配合 `JetBrains Mono` / `Consolas` 等宽字体下更明显）；**格式统一为 `MM:SS` / `MM:SS.mmm` 且用冒号分隔**——SRT 标准要求 `,` 分隔毫秒，本模块输出的是方括号包裹的展示/中间格式，最终落盘的 SRT 文本由 `helpers.ts` 组装，改动格式前需核对下游解析（`parseSrtText` / `parseSubtitleText`）。

## 8. 页面注册表与导航：pages/index.ts

替代旧版 `window.App.pages` 与 `goPage`，用**注册表 + 单容器渲染**实现页面切换而不引入 `vue-router`：集中登记页面（把 8 个 `PageKey` 映射到对应的单文件组件，新增页面只需改这一处）、持有“当前页面组件”状态（`currentPage` 是 `<component :is>` 的绑定源）、提供导航函数 `goPage(key)`（菜单高亮 → 刷新项目上下文（**刷新失败也照切页**）→ 切换组件 → 递增 `pageNavKey` 强制重挂载）、维护重挂载序号（作为 `:key`，恢复旧版“每次导航都重建页面 DOM、重跑页面 init”的语义）。之所以不引入路由库，是因为这是单窗口固定菜单的桌面应用：没有 URL、没有前进后退、没有嵌套路由需求，注册表模式更轻且与「菜单 `data-page`」一一对应。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `pages` | `Record<PageKey, Component>` | 页面注册表：8 个 key ↔ 8 个 `.vue` 组件 |
| `currentPage` | `shallowRef<Component>` | 当前渲染的组件定义，初值 `pages.home` |
| `pageNavKey` | `ref<number>` | 导航序号，初值 `0`，每次 `goPage` 自增 1 |
| `goPage` | `(key: PageKey) => Promise<void>` | 导航入口；异步——内部 `try { await refreshProject() } catch`，**刷新失败仍继续切页**（`toast('项目信息刷新失败：' + msg)` + `console.error`） |

**`pages` 注册表全量映射（8 个 key）**

| key（`PageKey`） | 组件 | 组件文件 |
| --- | --- | --- |
| `home` | `HomePage` | `pages/HomePage/index.vue` |
| `about` | `AboutPage` | `pages/AboutPage/index.vue` |
| `content` | `ContentPage` | `pages/ContentPage/index.vue` |
| `text-tts` | `TextTtsPage` | `pages/TextTtsPage/index.vue` |
| `subtitle` | `SubtitlePage` | `pages/SubtitlePage/index.vue` |
| `html-gen` | `HtmlGenPage` | `pages/HtmlGenPage/index.vue` |
| `video-preview` | `VideoPreviewPage` | `pages/VideoPreviewPage/index.vue` |
| `settings` | `SettingsPage` | `pages/SettingsPage/index.vue` |

说明：视频环节的 key 是 `video-preview`，绑定 `VideoPreviewPage`（页名「视频预览」，只做预览与定位；**转视频动作与渲染档位在 `HtmlGenPage`**）；`text-tts` 绑定 `TextTtsPage`——这是唯一一处 key 与组件名不同形（`text-tts` 的连字符对应组件名里的 `Tts`），其余 key 都是组件名的短横线小写形式。**导入清单**：`vue` → `ref`、`shallowRef`、`type Component`；`@renderer/composables/useAppStore` → `activeMenu`、`refreshProject`、`type PageKey`；`@renderer/composables/useToast` → `toast`；`./HomePage/index.vue` … `./SettingsPage/index.vue` 共 8 个页面组件（每个页面一个文件夹，入口统一 `index.vue`；跨目录导入统一走 `@renderer/*` 别名，页面注册表内的同目录导入用相对路径）。原「音色管理」页（`sound-copy` → `SoundCopyPage/index.vue`）已并入 `TextTtsPage` 的第三个 Tab，不再单列。

**`goPage(key)` 的四步**

```ts
export async function goPage(key: PageKey): Promise<void> {
  activeMenu.value = key;              // ① 菜单高亮
  try {
    await refreshProject();            // ② 刷新项目上下文（两次 IPC）
  } catch (e) {
    const msg = (e && (e as { message?: string }).message) || String(e);
    console.error('[goPage] 刷新项目上下文失败（不影响本次切页）：', e);
    toast('项目信息刷新失败：' + msg);
  }
  currentPage.value = pages[key];      // ③ 切换组件（无论刷新成败都执行）
  pageNavKey.value++;                  // ④ 递增 key → 强制重挂载
}
```

① `activeMenu.value = key`——侧栏 `App.vue` 用它渲染 `.menu-item.active`，高亮**先于**数据刷新生效，点击反馈即时；② `try { await refreshProject() } catch`——调用 `useAppStore` 的刷新（拉 `projectTools.list` + `projectTools.load` 当前项目），**失败不再拖住导航**：源码注释写明旧写法「先 `await refreshProject()` 再切页」一旦抛错（IPC 拒绝 / 某处 TypeError）就永远停在「侧栏菜单亮了、页面没换」的半截状态，而未处理的 Promise 拒绝只进 devtools、界面上毫无提示，现在改为「失败照切页 + `toast` 说出原因 + `console.error`」；③ `currentPage.value = pages[key]`——**必须在刷新之后**，否则页面会先挂载、后刷新，出现旧数据闪烁（刷新失败时这一步同样执行）；④ `pageNavKey.value++`——见下。

**`pageNavKey` 递增强制重挂载的语义**：1. 旧版每次 `goPage` 都重建页面 DOM、重跑页面 `init`；2. 迁移到 Vue 后，`<component :is>` 在同一组件类型之间切换时，Vue 会**复用同一个组件实例**，不会重新执行 `onMounted`；3. 于是「在配音页切换到另一个项目、再点配音」这类**同页切换**会出现：`appState` 已更新，但页面内部自己缓存的列表/预览/表单仍是旧项目的数据；4. 解决方式：给 `<component :is="currentPage" :key="pageNavKey" />` 传一个每次导航都变化的 key。key 变化 → Vue 销毁旧实例、创建新实例 → 各页面 `onMounted` 重新加载当前项目数据，**恢复旧语义**；5. 每次递增（而非随机/时间戳）便于调试时观察导航次数。

**宿主 `App.vue` 中的配合**：`<component :is="currentPage" :key="pageNavKey" />` 由内容容器 `<main class="content" ref="contentEl">` 承载；滚动复位由宿主承担：`watch(currentPage, () => { contentEl.value.scrollTop = 0 })`——对应旧版 `goPage` 末尾的 `content.scrollTop = 0`，本文件注释明确指向这一点。启动流程：`App.vue` 的 `initApp()` 先读 `localStorage[STORAGE_KEY_PROJECT_CTX]`（`@renderer/constants`，值 `'myapp.projectCtx'`）回填上下文，`await Promise.all([refreshProject(), loadRenderDefaults()])`（**不再调 `goPage('home')`**：首页本就是初始页，再走一遍只会多跑一轮刷新并把已挂好的首页整页重挂）。

**与侧栏菜单的关系**：`App.vue` 的 `menuItems` 登记 **8 项**（`home`、`content`、`text-tts`、`subtitle`、`html-gen`、`video-preview`、`about`、`settings`），与本注册表的 8 个 key **一一对应、无多无少**。原先注册表里多出的 `sound-copy`（音色管理）已随页面并入配音页第三个 Tab 而删除，因此不再存在「菜单里点不到但注册表里有」的页面键。

**注意事项**：**key 必须同时覆盖 8 个页面**，`pages` 用 `Record<PageKey, Component>` 声明，新增 `PageKey` 时 TypeScript 会强制补齐映射，避免出现“菜单能点但没有组件”的空页；**`currentPage` 用 `shallowRef` 而非 `ref`**——源码注释明确：组件对象**不应**被 Vue 深度代理，用 `ref` 会把组件定义包进响应式代理，可能引发组件实例/性能问题（Vue 对组件对象也有额外校验警告），`shallowRef` 只追踪 `.value` 的替换，正好匹配“切换即整体替换”的使用方式；**`pageNavKey` 递增会销毁并重建页面**，这是刻意行为，代价是每次导航都丢失页面内部状态（表单草稿、预览滚动位置等），若某页面需要保留状态，需要评估是否改用 `keep-alive` 或把状态提升到 `appState`；**导航是异步的且无并发保护**，两次快速点击会让两个 `refreshProject()` 并行，最终以最后完成的一次为准，页面切换也可能短暂落后于菜单高亮（当前通过“菜单高亮先更新”保证点击手感，未做取消/序号校验）；**`refreshProject()` 的异常已被 `goPage` 接住**（源码注释：旧写法「先 `await refreshProject()` 再切页」一旦抛错就永远停在「侧栏菜单亮了、页面没换」的半截状态，而未处理的 Promise 拒绝只进 devtools、界面上毫无提示），现在失败照切页并把原因 `toast` + `console.error` 说出来；但 `switchProject()` 等**其它调用方仍直接 `await refreshProject()`**，异常照旧向上冒泡；**滚动复位不在本文件**，`goPage` 不再操作 DOM（旧版有 `scrollTop = 0`），改由 `App.vue` 的 `watch(currentPage)` 承担，因为 `currentPage` 是 `shallowRef`，只有真正切换组件时才会触发该 watch；**注册表 8 项 = 侧栏菜单 8 项**，原 `sound-copy`（音色管理）已并入配音页 Tab，不再有“菜单里没有的页面键”这种例外。

## 9. 视频渲染档位：composables/useRenderOptions.ts 与 utils/render.ts

视频渲染的「质量 / 帧率」只有两项（`quality: draft | standard | high`、`fps: 24 | 30`），但要有三层优先级：**项目级覆盖（`project.json` 的 `render`）> 全局默认（`settings.json` 的 `render` 段）> 内置默认（`standard` / `30`）**，且覆盖里缺省的字段要跟随上一级而不是被默认值顶掉。这一对文件共同承担该能力：`utils/render.ts` 是无状态纯函数与选项表（可在主进程/渲染层两侧同构使用），`composables/useRenderOptions.ts` 是渲染层的有状态外壳（模块级 `reactive` 默认档位、读设置、写项目覆盖）。规范：依赖 Vue 响应式与 IPC 副作用的放 `composables/`，纯函数与常量表放 `utils/`（与 `agents.md` 规则 8 一致）。

### 9.1 `utils/render.ts`（55 行）—— 选项表与纯函数

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `RENDER_QUALITY_OPTIONS` | `{ value: RenderQuality; label: string; hint: string }[]` | 质量三档：`draft`「快速预览」（hint：编码最快、画质较低；仅用于快速确认内容与节奏）、`standard`「标准」（默认档位，画质与耗时均衡）、`high`「高画质」（编码最慢，文字最清晰；适合最终交付） |
| `RENDER_FPS_OPTIONS` | `{ value: RenderFps; label: string }[]` | 帧率两档：`30`「30（标准）」、`24`「24（省资源）」；源码注释说明降帧率**不会缩短时长**，只是采样更稀（省时间的是总帧数） |
| `RENDER_QUALITY_VALUES` / `RENDER_FPS_VALUES` | `RenderQuality[]` / `RenderFps[]` | 白名单数组：`['draft','standard','high']` / `[24, 30]` |
| `FALLBACK_RENDER` | `RenderOptions` | 内置默认档位 `{ quality: 'standard', fps: 30 }` |
| `pickRenderOverride(raw)` | `(unknown) => RenderOverride` | 覆盖规范化：只保留白名单内的合法字段，未给/非法一律丢弃（缺省即继承上一级）；入参非对象时按空对象处理 |
| `resolveRenderOptions(base, override?)` | `(unknown, unknown?) => RenderOptions` | 生效档位 = 基准（全局默认）⊕ 覆盖（项目级）：`quality: o.quality \|\| b.quality`、`fps: o.fps \|\| b.fps`，两侧都先过 `pickRenderOverride`，基准再与 `FALLBACK_RENDER` 合并 |
| `isRenderOverridden(defaults, override?)` | `(RenderOptions, unknown?) => boolean` | 覆盖是否**真的**改变了生效档位（用于 UI 标注「本项目自定义档位」与显示「恢复默认档位」）；覆盖里给了值但因与默认值相同而不改变结果时返回 `false` |
| `renderQualityLabel(quality)` | `(RenderQuality) => string` | 质量值 → 中文标签（找不到时回退原值字符串） |
| `renderOptionsText(options)` | `(RenderOptions) => string` | 档位摘要文案，形如 `标准 · 30fps` |

### 9.2 `composables/useRenderOptions.ts`（41 行）—— 全局默认与项目覆盖

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `renderDefaults` | `reactive<RenderOptions>` | **模块级单例**的全局默认档位，初值 `FALLBACK_RENDER` 的浅拷贝；`App.vue` 启动时经 `loadRenderDefaults()` 写入 |
| `loadRenderDefaults()` | `async () => Promise<void>` | 读 `window.settingsTools.get()`，把 `s.render` 经 `resolveRenderOptions()` 规范化后 `Object.assign` 进 `renderDefaults`；读取失败静默沿用内置默认，不打断启动 |
| `effectiveRenderOptions()` | `() => RenderOptions` | 当前生效档位：`resolveRenderOptions(renderDefaults, appState.project && appState.project.render)`（无项目时 `override` 为 `undefined`，直接取全局默认） |
| `saveRenderDefaults(next)` | `async (RenderOptions) => Promise<{ ok; message? }>` | 设置页保存全局默认：调 `window.settingsTools.saveRender(next)`（`settings:save-render`），成功后再用返回的 `res.settings.render` 回写 `renderDefaults` |
| `saveProjectRenderOverride(render)` | `async (RenderOverride \| null) => Promise<{ ok; message? }>` | 写项目级覆盖：`currentName` 为空时**直接返回 `{ ok: true }` 不发 IPC**（无当前项目，选择只在本次会话生效）；否则调 `window.projectTools.setRender(currentName, render)`（`project:set-render`），成功后把 `res.project.render` 经 `pickRenderOverride` 规范化写回 `appState.project.render`；`render` 传 `null` 表示清除覆盖、回到跟随全局默认 |

**优先级与使用约定**：① `App.vue` 的 `initApp()` 里 `Promise.all([refreshProject(), loadRenderDefaults()])`——项目列表与渲染默认档位**并行载入**（档位读取失败落回内置默认，不影响启动）；② 读生效档位的页面调 `effectiveRenderOptions()`（「HTML生成」页挂载时 `syncFromEffective()`）；③ 判断是否需要显示「恢复默认」用 `renderDefaults` + `isRenderOverridden()`；④ 写覆盖只走 `saveProjectRenderOverride()`，页面不直接调 `projectTools.setRender`。

**注意事项**：**「丢弃非法字段」是核心语义**——`pickRenderOverride` 只做白名单过滤，不做补默认，缺省字段才能一路继承到全局默认；**`resolveRenderOptions(base, override)` 的 `base` 也要过 `pickRenderOverride`**，因此传入 `settings.json` 里的脏数据同样安全；**`isRenderOverridden` 比的是「是否改变结果」而不是「是否存在覆盖」**（覆盖值等于默认值时不显示「恢复默认档位」）；**`renderDefaults` 是模块级单例**，页面不要直接改写它，只能经 `loadRenderDefaults()` / `saveRenderDefaults()` 更新；**主进程侧另有一份同语义实现**（`src/main/settings.ts` 的 `DEFAULT_RENDER` / `normalizeRenderOptions` / `pickRenderOverride`，供 `projects.ts` / `video.ts` 复用）——`render.ts` 服务于渲染层，两者白名单取值必须保持一致；**写覆盖的唯一 no-op 分支是「无当前项目」**——`currentName` 为空时直接返回 `{ ok: true }`、不发 IPC，只要有当前项目，写档位都会落盘到 `project.json` 的 `render`。

## 10. 跨页导航意图：composables/useNavIntent.ts

有些按钮不只是「切到某页」，还要求**目标页停在某个分类**上：配音页「音色管理」的「API Key 设置」必须落到设置页的「语音服务」，否则用户到了设置页还得自己找要填的 Key 在哪。本模块用模块级 `ref` 单例传递这一个意图，用法与「同页 Tab 切换」那类信号一致：**源页置位 → 目标页消费并复位**（历史上 `pages/TextTtsPage/helpers.ts` 的 `voiceTabRequest` 就是这套路，该信号已随合成卡的「管理音色」按钮一起删除，见该文件 §1）。

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SettingsSectionKey` | 字符串字面量联合（`export type`） | 设置页分类：`'model' \| 'voice' \| 'render' \| 'update' \| 'whisper'` |
| `SETTINGS_SECTIONS` | `SettingsSectionKey[]` | 五类分类的**唯一枚举来源**（`SettingsPage` 的左侧导航与校验共用这一份，避免两处漂移） |
| `requestSettingsSection(section)` | `(SettingsSectionKey) => void` | 置位；**调用方自行 `goPage('settings')`** |
| `consumeSettingsSection()` | `() => SettingsSectionKey \| null` | 目标页消费：读取并复位；没有待处理请求时返回 `null` |
| `useSettingsSectionRequest()` | `() => Ref<SettingsSectionKey \| null>` | 返回内部 ref，供目标页 `watch` 用（watch 回调里仍需调 `consumeSettingsSection()` 复位） |

**内部状态**：`const settingsSectionRequest = ref<SettingsSectionKey | null>(null)`（模块级单例，未导出）。

**可靠性来自重挂载**：源码注释写明——`goPage` 每次都递增 `pageNavKey` 强制目标页重挂载，所以「源页置位 → 目标页 `onMounted` 消费」是**主路径**；目标页的 `watch` 只是兜底（该页已在挂载状态、不经重挂载时也能响应）。

**使用方**：`pages/TextTtsPage/VoiceSection.vue`（`goSettingsVoice()` = `closeCreate()` + `requestSettingsSection('voice')` + `goPage('settings')`；卡内 `requireCfg()` 发现没配 API Key 时走同一条路径）、`pages/SettingsPage/index.vue`（`applySectionIntent()` 里 `consumeSettingsSection()` → 命中 `SECTIONS` 且与当前不同就写 `activeSection`，`watch(useSettingsSectionRequest(), () => applySectionIntent())` 兜底，`onMounted` 的第一句（载入配置之前）调用它，注释：先落实带意图跳进来的分类，再载入配置）。

**注意事项**：**枚举只有这一处**——`SettingsPage` 用 `type SettingsSection = SettingsSectionKey`（别名保留）与 `const SECTIONS = SETTINGS_SECTIONS`，页面里不再写本地字面量数组；**消费即复位**——`consumeSettingsSection()` 读完就置 `null`，因此同一意图不会被消费两次；**意图优先于记忆**——目标页先消费意图再回落到 `localStorage` 里的上次分类（用户这次点的是「去配语音」，不是「回到上次看的那一页」）；**本模块零依赖**（只用 Vue 的 `ref`，不碰 IPC / `localStorage`），也**不自带 `goPage`**：置位与跳转由调用方两步完成。

## 11. 协作与约定

**依赖的 preload API**

| API | 频道 / 用途 | 使用模块 |
| --- | --- | --- |
| `window.projectTools.list()` | 拉「我的项目」列表（`ProjectMeta[]`） | `useAppStore.refreshProject()` |
| `window.projectTools.load(name)` | 拉当前项目详情（`project.json` 内容）；返回 `Project \| null`，`refreshProject()` 已加空值守卫 | `useAppStore.refreshProject()` |
| `window.projectTools.create(name)` | 频道 `project:create`，新建项目 | `components/NewProjectDialog.vue` |
| `window.hfTools.onProgress(callback)` | 频道 `video:progress`，渲染进度订阅，回调参数形如 `{ text: string }`（日志 chunk） | `renderProgress.initRenderProgress()` |
| `window.settingsTools.get()` | 频道 `settings:get`，读 `settings.json`（含 `render` 段） | `useRenderOptions.loadRenderDefaults()`；`SettingsPage` 另单独调用一次以回填表单 |
| `window.settingsTools.saveRender(render)` | 频道 `settings:save-render`，只更新渲染默认档位 | `useRenderOptions.saveRenderDefaults()` |
| `window.projectTools.setRender(name, render \| null)` | 频道 `project:set-render`，写 / 清除项目级档位覆盖 | `useRenderOptions.saveProjectRenderOverride()` |
| `window.runtimeTools.onProgress(callback)` | 频道 `runtime:progress`，运行环境进度推送（单订阅），回调参数为 `RuntimeProgressPayload`（`phase` / `pack` / `missing` / …） | **只有** `useRuntime.initRuntime()` 注册（全渲染层唯一订阅者）；`useEnvGate` 经 `watch(useRuntime().runtime)` 消费同一份状态，不再注册第二个回调 |
| `window.runtimeTools.status()` | 频道 `runtime:status`，查一次当前状态（补齐首帧，此后由推送驱动） | `useRuntime.initRuntime()` |
| `window.runtimeTools.prepare(packs?)` | 频道 `runtime:prepare`，主动准备指定包（省略 = 全部缺的；忙碌期重复调用返回一句提示）；**参数必须是普通数组**（`toRaw(list).slice()`）——`invoke` 要过结构化克隆，Vue 响应式代理会抛 `DataCloneError` 且主进程 handler 不执行；**只触发，成败由 `runtime:progress` 回填**，非 ok 回执 / 抛错由 `prepare()` 写进 `runtime`（不再静默） | `useRuntime.useRuntime().prepare()` → `App.vue` 横幅（下载 / 重试）/ `SettingsPage` / `useEnvGate.confirmDownload()` |
| `window.runtimeTools.cancel()` | 频道 `runtime:cancel`，取消进行中的**检查 / 下载 / 解包**（中断请求与 7za 子进程、清半成品；取清单 20 秒无响应属**超时**而不是取消，残片保留） | `useRuntime.useRuntime().cancel()` → `App.vue` 横幅「取消」/ `SettingsPage`「取消下载」/ `useEnvGate.cancelDownload()` |
| `window.settingsTools.pickRuntimePack()` | 频道 `settings:pick-runtime-pack`，选一个本地 `ffmpeg.7z` / `hyperframes.7z` 导入（离线兜底） | `pages/SettingsPage/index.vue`（`onPickLocalPack()`，成功后接着 `runtimeTools.prepare()`） |
| `window.legacyTools.status()` | 频道 `legacy:status`，问一次有没有待处理的旧数据（返回 `LegacyDataInfo \| null`） | `useLegacyData.initLegacyData()` |
| `window.legacyTools.resolve(action)` | 频道 `legacy:resolve`，回传 `'migrate' \| 'delete' \| 'later'` | `useLegacyData.useLegacyData().resolve()` → `components/LegacyDataDialog.vue` |

`renderProgress` 不调用 `hfTools.renderVideo()`——**发起渲染的是 `pages/HtmlGenPage/index.vue`**（这里的「转视频」按钮），`pages/VideoPreviewPage/index.vue` 只在渲染结束后读 `renderProgress.text` 展示；本模块只消费日志流。`pages/index.ts` **不直接**调用 preload API，而是通过 `useAppStore` 间接使用。`useToast.ts`、`useNavIntent.ts`、`rate.ts`、`escape.ts`、`time.ts`、`render.ts` 均为**零依赖**（`useToast` / `render.ts` 中前者依赖 Vue 的 `ref`、后者只依赖 `@shared/types` 的类型），不接触主进程；`useRenderOptions.ts` 则依赖 `window.settingsTools` / `window.projectTools` 与 `appState`；`useRuntime.ts` 依赖 `window.runtimeTools`（订阅进度 + 查状态 + `prepare` / `cancel`），`useEnvGate.ts` 依赖 `useRuntime`（读 `missing`）与同一个 `runtimeTools`（订阅进度 + `prepare` / `cancel`），`useLegacyData.ts` 依赖 `window.legacyTools`（问一次 + 回传选择），三者同样只经 preload 桥接触主进程。

**谁用谁（被导入情况）**

- `appState` / `activeMenu` / `refreshProject` / `PageKey` / 5 个 `has*`：`App.vue`（`activeMenu`、`appState`、`refreshProject`、`PageKey`，启动时读 `localStorage[STORAGE_KEY_PROJECT_CTX]`（`@renderer/constants`）回填）、`components/StepBar.vue`（`appState`、`hasContent`、`hasAudio`、`hasSubtitle`、`hasHtml`、`hasVideo`、`switchProject`、`PageKey`）、`components/NewProjectDialog.vue`（`refreshProject`、`switchProject`）、`pages/HomePage/index.vue`（`appState`、5 个 `has*`、`switchProject`、`PageKey`）、`pages/HtmlGenPage/index.vue`（`appState`、`hasHtml`、`refreshProject`）、`pages/VideoPreviewPage/index.vue`（`appState`、`refreshProject`）、`pages/ContentPage/index.vue` / `pages/SubtitlePage/index.vue` / `pages/TextTtsPage/SynthSection.vue` / `pages/SubtitlePage/TranscribeSection.vue`（`appState` 读写）、`pages/TextTtsPage/AlignSection.vue`（`appState`、`appState.myProjects` 跨项目取字幕源）。
- `switchProject`：`components/StepBar.vue`、`pages/HomePage/index.vue`。
- `toast` / `useToasts`：见 §2「使用方」。
- `renderProgress` / `initRenderProgress` / `resetRenderProgress`：`App.vue`（`onMounted` 中调用 `initRenderProgress()`，全局只订阅一次）、`pages/HtmlGenPage/index.vue`（**发起渲染**：`statusDisplay` 让 trace 在渲染中接管，`onMounted` 与 `onRenderVideo` 结束时 `resetRenderProgress()`）、`pages/VideoPreviewPage/index.vue`（预览侧：`statusText = renderProgress.text || localStatus`，`onMounted` 里 `resetRenderProgress()`）。
- `renderDefaults` / `loadRenderDefaults`：`App.vue`（`initApp()` 中与 `refreshProject()` 并行调用）、`pages/HtmlGenPage/index.vue`（`isRenderOverridden(renderDefaults, ...)` 判断是否显示「恢复默认档位」）。
- `effectiveRenderOptions` / `saveProjectRenderOverride`：`pages/HtmlGenPage/index.vue`（`syncFromEffective()` 读、`onOptionChange()` / `onResetOptions()` 写）。**「视频预览」页不消费渲染档位**，只读 `renderProgress.text` 展示进度。
- `saveRenderDefaults`：`pages/SettingsPage/index.vue`（「保存渲染默认档位」按钮）。
- `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` / `FALLBACK_RENDER` / `renderOptionsText` / `renderQualityLabel`：`pages/SettingsPage/index.vue`（全局默认档位下拉与保存文案）、`pages/HtmlGenPage/index.vue`（档位下拉、`optionNote`、渲染状态文案）。
- `pickRenderOverride`：`composables/useAppStore.ts`（`refreshProject` 规范化 `loaded.render`）、`composables/useRenderOptions.ts`（覆盖写入后回写 `appState.project.render`）。
- `rateClamp` / `applyRate` / `stepRate`：见 §6「使用方」；`escTxt`：见 §7.1「调用方」；`fmtTime` / `fmtTimeMs`：见 §7.2「调用方」。
- `pages` / `currentPage` / `pageNavKey` / `goPage`：`App.vue`（`currentPage`、`pageNavKey` 渲染容器；`goPage(item.key)` 绑定菜单点击；`watch(currentPage)` 做滚动复位；启动时**不**调 `goPage`（首页本就是初始页））、`components/StepBar.vue`（`goPage('content')`、`goPage('text-tts')`、`goPage('subtitle')`、`goPage('html-gen')`、`goPage('video-preview')`、`onCreated()` / `onSelect()` 里的 `goPage(props.page)` 回跳）、`pages/HomePage/index.vue`（流程图节点 `goPage(n.page)`；项目卡片 `openMy()` → `goPage('html-gen')`）、`pages/TextTtsPage/VoiceSection.vue`（`goSettingsVoice()` 先 `requestSettingsSection('voice')` 再 `goPage('settings')` 跳「API Key 设置」，卡内 `requireCfg()` 未配 Key 时同路径；原 `pages/SoundCopyPage/index.vue`）、`pages/SettingsPage/index.vue`（消费端：`applySectionIntent()` + `watch(useSettingsSectionRequest())` + `onMounted` 首句）、`pages/TextTtsPage/SynthSection.vue`（`goSettingsVoice()` = `requestSettingsSection('voice')` + `goPage('settings')`；**原「管理音色」按钮与 `goPage('text-tts')` 跨页请求已删除**）、`pages/SubtitlePage/TranscribeSection.vue`（`goPage('settings')`）、`pages/TextTtsPage/helpers.ts`（`goPage('settings')`）。

- `initRuntime` / `useRuntime`（`runtime` / `busy` / `failed` / `missing` / `hasMissing` / `ready` / `cancelable` / `missingText` / `prepare` / `cancel`）：`App.vue`（`onMounted` 调 `initRuntime()`；横幅用 `busy` / `failed` / `hasMissing` / `runtime.message` / `percent` / `prepare` / `cancel`）、`pages/SettingsPage/index.vue`（运行环境一行三态 + 「下载运行环境」/「取消下载」/「从本地文件安装…」）。
- `initEnvGate` / `useEnvGate`（`visible` / `packs` / `title` / `phase` / `percent` / `readyNow` / `message` / `detail` / `sizeText` / `guard` / `confirmDownload` / `cancelDownload` / `continueAction` / `close`）：`App.vue`（`onMounted` 调 `initEnvGate()`；模板内联渲染确认框）、`pages/HtmlGenPage/index.vue`、`pages/SubtitlePage/TranscribeSection.vue`、`pages/TextTtsPage/AlignSection.vue`（缺包时 `guard(...)`，用户点「继续」以 `skipEnvGuard = true` 重发原操作）。
- `useConfigPrompt`（`visible` / `title` / `message` / `target` / `open` / `fromResult` / `go` / `close`）：`App.vue`（渲染 `.hf-modal` 弹窗宿主）、`pages/HtmlGenPage/index.vue`（`configPrompt.open(msg, res.needConfig, false, res.title)`，配置类不叠 toast）、`pages/TextTtsPage/SynthSection.vue` / `VoiceSection.vue`（失败分支 `configPrompt.fromResult(res)`）、`pages/TextTtsPage/AlignSection.vue`（`if (configPrompt.fromResult(fail)) … else if (fail.needPacks …)` —— **配置类优先于缺包弹窗**）、`pages/TextTtsPage/helpers.ts`（`requireCfg()` 未配 Key 时 `open(…, 'voice', true)`）。**它不接触 preload**，只用 `requestSettingsSection` + `goPage`。
- `initLegacyData` / `useLegacyData`（`info` / `visible` / `busy` / `entryText` / `resolve`）：`App.vue`（`onMounted` 调 `initLegacyData()`；模板挂 `<LegacyDataDialog />`）、`components/LegacyDataDialog.vue`（唯一消费方：展示 `info.dir` / `entryText`，三个按钮分别 `resolve('later' / 'delete' / 'migrate')`，迁移后 `refreshProject()` + `toast(...)`）。

典型协作链：`components/StepBar.vue` / `pages/HomePage/index.vue` 调 `switchProject()` → 内部 `refreshProject()` 更新 `appState.project` → 5 个 computed 变化 → 流程图与步骤条完成态同步刷新。

**注意事项汇总**

- **单例状态跨模块共享**：`appState`、`activeMenu`、`toasts`、`renderProgress`、`runtime`、`renderDefaults`、旧数据的 `info` / `visible` / `busy`、`pages`、`currentPage`、`pageNavKey` 都定义在模块顶层，任何 `import` 都拿到同一份；无需 `provide/inject` 或 Pinia。代价是**热更新时状态会跨模块残留**。
- **进度单订阅**：preload 对进度类频道实施单订阅语义，`initRenderProgress()` 重复调用只会**替换回调**，不叠加监听器；因此约定只在 `App.vue` 的 `onMounted` 调用一次。
- **不要引入 `vue-router` / `pinia`**：导航用页面注册表 + `goPage()`，全局状态用模块级 `reactive` / `ref` 单例——这是本项目的既定架构。
- **导航无并发保护、但已不再被刷新失败拖住**：`goPage` 是异步的且未做取消/序号校验，快速连点会让两次 `refreshProject()` 并行；但 `refreshProject()` 的异常已在 `goPage` 内被 `try/catch` 接住（失败照切页 + `toast` + `console.error`），不会再出现「菜单亮了、页面没换」的半截状态。
- **带意图跳转要成对使用**：源页 `requestSettingsSection(section)` → 目标页 `consumeSettingsSection()`（`onMounted` 主路径 + `watch` 兜底），复用 `goPage` 的强制重挂载语义；设置页分类枚举只在 `useNavIntent.ts` 定义一份。
- **`pageNavKey` 递增的代价**：每次导航都销毁重建页面实例，页面内部状态（表单草稿、预览滚动位置等）不保留。
- **持久化键集中在 `constants.ts`，且 `'myapp.'` 前缀不可漂移**：`STORAGE_KEY_PROJECT_CTX` / `STORAGE_KEY_SETTINGS_SECTION` 都由 `STORAGE_PREFIX = 'myapp.'` 派生（**故意不跟随品牌名**：生产环境 `file://` 同源，键名就是用户数据的地址，改名会让「上次项目 / 设置页分类」读不到，要改必须补「读旧键 → 写新键」迁移）。消费处一律 `import` 常量，不再出现裸字面量；品牌文案则是另一层的 `@shared/constants`，两者不要混。
- **存在性判定必须走列表项**：`htmlExists` / `videoExists` 来自 `projectTools.list()` 的 `hasHtml` / `hasVideo`（主进程文件系统检查），`projectTools.load()` 不返回这两项。
- **`composables` 与 `utils` 的分界（与 `AGENTS.md` 规则 8 一致，当前成立）**：`composables/` 放依赖 Vue 响应式 API 或有状态、带副作用（IPC 订阅、`localStorage`）的复用逻辑，文件名以 `use` 开头（`useAppStore.ts` / `useToast.ts` / `useRenderProgress.ts` / `useRuntime.ts` / `useEnvGate.ts` / `useConfigPrompt.ts` / `useLegacyData.ts` / `useRenderOptions.ts` / `useNavIntent.ts`，九者都有模块级单例状态）；`utils/` 放无状态纯函数（`escape.ts` / `time.ts` / `rate.ts` / `render.ts`，其中 `rate.ts` 只读写传入的 DOM 元素、`render.ts` 只有常量表与纯函数，均不持有状态）。跨目录引用这些模块一律走 `@renderer/*` 别名。
- **渲染档位三层优先级只有一处实现**：`项目覆盖 > 全局默认 > 内置默认`，缺省字段逐级继承；渲染层用 `utils/render.ts` 的 `resolveRenderOptions()` / `pickRenderOverride()`，主进程用 `settings.ts` 里同名的白名单实现，两边取值必须同步修改（`draft/standard/high` 与 `24/30`）。
- **渲染动作的唯一入口是「HTML生成」页**：`hfTools.renderVideo()` 只在 `pages/HtmlGenPage/index.vue` 的 `onRenderVideo()` 里发起，因此「渲染进度由谁展示」「产物谁回写项目」都以此为准——产物回写只在该页调 `projectTools.saveVideo()`；「视频预览」页只读结果、不发起渲染。
- **`ProjectMeta` 只在共享层定义一处**：`useAppStore.ts` 用 `import type { ProjectMeta } from '@shared/types'` + `export type { ProjectMeta }` 引入并再导出（`project:list` 的条目结构因此与主进程同源）；而 `ProjectState` 仍是渲染层自己的视图模型（含 `htmlExists` / `videoExists` 这类由列表项推导出来的字段），不要与主进程结构混用。
- **转义与格式化只在必要时使用**：`escTxt()` 仅用于手工拼 HTML 字符串（`v-html`、动态 `title`），`{{ }}` 插值不要重复转义；`fmtTime`（概览）与 `fmtTimeMs`（时间轴）结果可能不同分钟，不可互换。
- **旧数据的弹窗显隐由 composable 单例决定，不由 `App.vue` 传参**：`<LegacyDataDialog />` 无 props / 无 emits，`visible` / `busy` / `info` 都是 `useLegacyData.ts` 的模块级 ref。想改显隐语义（例如加「本次不再提示」）要改 composable，而不是在 `App.vue` 里加 `v-if`。
- **`initRuntime()` / `initEnvGate()` / `initLegacyData()` 都只在 `App.vue` 的 `onMounted` 调用一次**：它们都有 `bound` 幂等标志，属于「全局副作用登记」，页面级组件不要重复调用。
- **`useRuntime()` 暴露状态与两个动作**（`runtime` / `busy` / `failed` / `missing` / `hasMissing` / `ready` / `cancelable` / `missingText` / `prepare` / `cancel`）：`retry` 与 `sizeText` 随「已就绪不再展示、重试统一走 `prepare()`」而删除；界面若要显示就绪体积 / 文件数，应从 `runtime` 载荷自己派生，不要重新引进已删字段。
- **`useEnvGate()` 不自动续做**：`continueAction()` 只是「关框 + 执行 `onContinue`」，且 `onContinue` 由调用方在 `guard()` 时传入（通常是 `() => { void doIt(true) }`，即带 `skipEnvGuard = true` 重发同一次操作）。主进程侧**不记**「待续做」，因此关框 / 取消都不会留下状态。
- **`useConfigPrompt()` 与 `useEnvGate()` 的区别要记牢**：前者**不驱动流程**（`needConfig` 只是分类标记，关框＝本次操作作废），后者**要续做**（`needPacks` + 「继续」用原参数重发）；前者**不显示「查看详情」**且只有 `[去设置]` / `[取消]` 两个按钮，后者有进度条与三态。**余额 / 欠费不走配置类弹窗**（去设置修不了余额，主进程根本不给它 `needConfig`）。
- **配置类弹窗的入口有三种、语义各不同**：`open(..., false)` 只说明原因不跳页（HtmlGenPage）、`fromResult(res)` 已弹框就不再 toast（配音页三处，`AlignSection` 里**排在 `needPacks` 之前**）、`open(..., true)` 保持「确认后就去设置」的旧效率（`helpers.requireCfg` 的本地校验）。改这三处前先确认「谁把用户从当前页带走」这一点是否仍有必要。
