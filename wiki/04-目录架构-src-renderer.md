# 04 · 目录架构：`src/renderer/`（渲染层）

> Vue 3 + TypeScript 的界面层，共 **65** 个文件（`index.html` 1 + 设计规范 `agents.md` 1 + `src/` 下 63：外壳 `App.vue` 1 + 入口 `main.ts` / `env.d.ts` 2 + 渲染层常量 1 + 样式 1 + 通用组件 5（`StepBar.vue` / `NewProjectDialog.vue` / `HfSelect.vue` / **`CastShot.vue`** / `LegacyDataDialog.vue`） + composables 10 + utils 7 + 页面 36（一页一目录，入口统一 `index.vue`，含注册表 `pages/index.ts`；**`HtmlGenPage/` 由 1 个文件变 7 个**——角色预览组件 `CastShot.vue` 已上提到 `components/`，两页共用、**`ContentPage/` 由 1 个文件变 7 个（两个 Tab + 选角色弹窗 + 会话内角色选择 `castPick.ts`）**；设置页那一目录 = 外壳 + 3 个页面级 `.ts` + `components/` 下 6 个组件（5 个区块 + 更新日志弹窗 `ChangelogDialog.vue`））。刻意**不引入** vue-router 与 pinia：导航是一个注册表 + `goPage()` 函数，全局状态是模块级 `reactive` 单例。所有系统能力都经 `window.*`（preload 桥）访问。

---

## 1. 文件清单

```
src/renderer/
├─ index.html                    # 103 行  HTML 宿主：#app + 启动画面（内联样式，不等 JS）+ CSP meta + 模块入口；品牌文案用 %APP_*% 占位、构建期注入
├─ agents.md                     # 184 行   科技主题（Cyber UI / 深空科技）设计规范正文（自 pages/ 上提到 renderer/ 层；§5.7 项目属性行 = 标签 + 控件 + `?`）
└─ src/
   ├─ main.ts                    #  15 行   createApp + 挂载 + 导入全局 CSS + 启动画面淡出移除
   ├─ App.vue                    # 327 行   外壳：标题栏（文案取 @shared/constants 的 APP_NAME）+ 运行环境横幅（下载中 / 缺包 / 失败三态）+ 运行环境确认框（内联 `.hf-modal`）+ **配置类错误弹窗宿主**（`useConfigPrompt`，[去设置] / [取消]）+ 侧栏菜单 + 页面容器 + 旧数据弹窗宿主 + Toast + 启动流程（initRenderProgress → initRuntime → initEnvGate → initLegacyData → initApp）
   ├─ env.d.ts                   #   8 行   .vue 等模块类型补丁
   ├─ constants.ts               #  59 行   渲染层公共常量：localStorage 键名前缀 + 两个持久化键（不跟随品牌名，改前缀必须补迁移）
   ├─ assets/
   │  └─ main.css                # 2165 行  全局设计系统（深空科技主题；末尾几节依次是「项目素材库」/「章节列表」/「**角色卡片墙**（`.cast-mat` 卡片级 modifier / **`.cast-mat-grid`** 只覆盖列宽、定死 `repeat(auto-fill, 130px)` / `.cast-thumb` **13:15** 预览位（130×150）/ `.cast-more` 右上「…」/ `.cast-menu*` 动作菜单，直接复用 `.mat-grid` / `.mat-card` / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`）」/「**角色预览**（`.cast-shot*`）」/「**全局角色库方格网格**（`.cast-grid` / `.cast-card*`）」/「**新建角色成功**（`.cast-done*`）」；曾试过「值胶囊 `.prop-chip*`」、已连同样式删除；旧的 `.lib-row*` 与 `.cast-list` / `.cast-row*` / `.cast-actions` / `.cast-units` / `.cast-file` 均已整套删除）
   ├─ components/
   │  ├─ StepBar.vue             #  90 行   五节点链路状态条 + 工作项目切换器（新建入口改为弹窗）
   │  ├─ NewProjectDialog.vue    #  83 行   新建项目弹窗（创建 + 刷新 + 切换，成功后 emit created）
   │  ├─ HfSelect.vue            # 382 行   全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 select
   │  ├─ CastShot.vue            #  67 行   **角色静态预览（公共组件，本轮从 `pages/HtmlGenPage/` 搬来）**：props `project` / `id` / `units` / `title?` / `uses?` / `from?: 'project' | 'lib'` / `epoch?` / `big?`；`watch` → `castTools.preview()` → `iframe[src] = userFileUrl(res.rel) + '&e=' + epoch`（`userFileUrl` 自带 `?user=1`，续接参数必须用 `&`，写成 `?e=` 会 404）。**两页共用**：「HTML生成」页三处（角色卡 / 全局库方格 / 新建大图）+「内容脚本」页选角色弹窗（`from="lib"`）
   │  └─ LegacyDataDialog.vue    # 102 行   「发现旧版本数据」应用内弹窗（迁移 / 删除 / 稍后；无 props / emits，状态取自 useLegacyData）
   ├─ composables/
   │  ├─ useAppStore.ts          # 112 行   全局项目状态单例（appState / has* / refreshProject；`ProjectState.materials` 取代旧的 `videoMaterial`；含项目级渲染档位覆盖与**成片画布 `canvas`**，后者由 `normalizeCanvas(loaded.canvas)` 规范化）；上下文键取 @renderer/constants
   │  ├─ useToast.ts             #  22 行   轻提示
   │  ├─ useRenderProgress.ts    #  92 行   HyperFrames 渲染进度解析（长阶段中文名 + 内部微阶段不上屏；渲染中由 `HtmlGenPage/PreviewSection.vue` 展示）
   │  ├─ useRuntime.ts           #  90 行   运行环境（分包）状态单例（runtime:progress 订阅 + runtime:status 首帧补齐；busy / failed / missing / hasMissing / ready / cancelable / missingText + prepare(packs?) / cancel()）
   │  ├─ useEnvGate.ts           # 159 行   「需要下载运行环境」确认框单例（guard → confirmDownload / cancelDownload / continueAction；三态 confirm / downloading / ready，装好后按钮变「继续」、**不自动续做**；进度经 `watch(useRuntime().runtime)` 消费，全渲染层只有 useRuntime.ts 一处 onProgress 注册）
   │  ├─ useConfigPrompt.ts      #  86 行   配置类错误弹窗单例（`open(msg, target, jump?, title?)` / `fromResult(res, jump?)` / `go()` / `close()`；只有 [去设置] / [取消]，分类来自主进程 `needConfig`；**余额 / 欠费不弹窗**）
   │  ├─ useLegacyData.ts        #  60 行   旧数据提示单例（legacy:status 问一次 → 弹窗；resolve(action) 回传 legacy:resolve，条目名转中文）
   │  ├─ useNavIntent.ts         #  31 行   跨页「导航意图」信号单例（requestSettingsSection / consumeSettingsSection；设置页 5 个分类枚举的唯一来源 SETTINGS_SECTIONS）
   │  ├─ useProjectMeta.ts       #  48 行   **「HTML生成」页项目状态条 + 标题右侧「用法」气泡的派生**：`useProjectMeta()` → `{ meta, usageHint }`（`meta` = hasH / sceneN / missVisual / subCount / matN / matText；场景数**只数画面分镜非空**的场景，口径与主进程 `buildContentBlock` 一致）；只读 `appState.project` / `hasHtml`，不碰 IPC
   │  └─ useRenderOptions.ts     #  41 行   渲染档位：全局默认载入 / 生效档位 / 项目级覆盖写入
   ├─ utils/
   │  ├─ escape.ts               #   4 行   escTxt 文本转义
   │  ├─ taskId.ts               #  13 行   **`newTaskId(prefix)`**：任务 id = `前缀-时间戳36进制-序号-4位随机`（模块级 `seq` 自增取模 `1e6`）；渲染层发起 AI 任务前先生成它，才有「先订阅、再调用」（`onTaskProgress`）
   │  ├─ rate.ts                 #  21 行   语速控件（0.5~2.0）
   │  ├─ time.ts                 #  15 行   fmtTime / fmtTimeMs
   │  ├─ render.ts               #  81 行   渲染档位选项表与纯函数（pickRenderOverride / resolveRenderOptions …）+ **成片画布四导出（RENDER_CANVAS_OPTIONS / canvasLabel / canvasSize / normalizeCanvas）**
   │  ├─ url.ts                  #  57 行   路径 → URL：previewUrl（项目内 → `hgpreview://p/…`）/ userPathUrl（项目外语音产物 → `hgpreview://user/…?user=1`，认不出白名单目录返回空串）；逐段 encodeURIComponent
   │  └─ changelog.ts            # 124 行   随包 `CHANGELOG.md` 原文的解析（**全部无状态纯函数、零依赖**）：parseChangelog（按 `## ` 切块、按表头列名映射条目、只抽版本 / 时间 / 每条一行标题）/ pickDefaultBlock（选「最新一版」）/ splitEntryTag / tagKind
   └─ pages/                     # 一个页面一个文件夹，入口统一 index.vue
      ├─ index.ts                #  51 行   页面注册表 + goPage 路由（刷新失败照切页 + toast；归属「公共方法与工具」一篇）
      ├─ HomePage/
      │  └─ index.vue            #  86 行   首页（hero 角标与主标题均取 @shared/constants + 参数行 + 流水线 + 我的项目卡片）
      ├─ AboutPage/
      │  └─ index.vue            #  18 行   关于（静态）
      ├─ ContentPage/             # 7 个文件（两个 Tab + 选角色弹窗 + 会话内角色选择）
      │  ├─ index.vue            #  35 行   外壳：StepBar + `.hf-tabs` 两个 Tab（**默认「场景编辑」**，空项目也一样；第二个是「AI 创作」），用 `v-show` 挂载 `SceneEditor` / `AiChatPanel`（切 Tab 不销毁组件）；`onMounted(loadScenes)` + **`onBeforeUnmount(flushPending)`**
      │  ├─ SceneEditor.vue      #  74 行   「场景编辑」Tab：场景卡（旁白 / 画面分镜 / 时长提示 + 增删排序）+ **一行自动保存状态**（`保存中…` / `已自动保存 HH:mm:ss` / `保存失败：原因` + 「重试」）；**已删除「保存到项目」按钮与「● 有未保存改动」**；**画面分镜输入框随内容自动长高（`field-sizing: content`、两行起步、260px 上限后内部滚动，`resize: none`）**
      │  ├─ AiChatPanel.vue      # 456 行   「AI 创作」Tab：需求输入（Ctrl+Enter 发送）、场景数 / 目标时长、**「角色」按钮 + 「本片角色」chips（本轮新增；选中项只作提示词上下文，`scriptTools.generate` 载荷里多一个 `cast`）**、流式状态行、思考过程折叠、错误 + 模型原文折叠、**顶部红字 `chatError`**、`ScriptRoundCard` 列表；调 `window.scriptTools.generate`，进度走 `window.scriptTools.onProgress`；**挂载时只读索引（`loadChatIndex`）、生成成功后追加一版（`appendChatRound`，主进程写副本 + 更新索引）、展开时才读副本（`readChatVersion` + `versionCache`）、「应用此版本」、标题栏旁「清空对话」（`clearChatRecords`）；「当前」标记 = `r.versionId === activeVersionId`（索引说了算）**
      │  ├─ ScriptRoundCard.vue  # 139 行   单轮结果卡：第 N 版 · 场景数（取 `round.sceneCount`）· 字数 · 估算时长（`totalChars / charsPerSecond` 经 `fmtTime`；`charsPerSecond` 由父组件传 `@shared/constants` 的 `EST_CHARS_PER_SEC`，4 字/秒）· 展开预览（`scenes` 由父组件懒加载后传入，`null` = 正在读）· **「应用此版本」**（`applying` 时「应用中…」）；props `round / index / current / expanded / scenes / charsPerSecond / applying`，emits `toggle` / `apply`，其中 **`round: ScriptChatRoundMeta` 来自 `@shared/types`**
      │  ├─ CastPickerModal.vue  # 127 行   **「选择角色（写稿用）」弹窗（本轮新增）**：打开即 `picked = selected.slice()` 回填勾选 + `listCastLibrary()` 重读全局库；方格网格（复用全局 `.cast-grid` / `.cast-card*`），每格用 `CastShot from="lib"` 出预览、`missing` 压暗不可点、选中态勾角标；**`MAX_CAST = 20` 与主进程对齐（选满即挡住并提示「已选满 20 个」）**；`confirm()` 只回传库里仍存在且不缺文件的成员快照 `{ id, name, desc, units }`——**不写任何文件**
      │  ├─ castPick.ts           #   9 行   **本次会话已选的角色（本轮新增）**：模块级 `pickedCast = ref<ScriptCastRef[]>([])`，**不落盘**；放模块级是为了「跨 Tab / 跨页面切换保留」（面板 setup 状态每次挂载都会重建），与 `helpers.ts` 的 `scenes` 同一套理由
      │  └─ helpers.ts           # 271 行   **模块级共享状态 `scenes` / `dirty`**（两个 Tab 看到同一份）+ **自动保存调度**（`saveState` / `lastSavedAt` / `saveError` / `scheduleSave` / `flushSave` / `flushPending`：防抖 600ms、写入前抓快照、串行队列、失败可重试；快照里把项目里已落盘的 `content.style` 原样带回）+ **对话记录读写**（**`chatError`** / `plainScenes`（IPC 前把 scenes 转普通对象）/ `loadChatIndex` / `appendChatRound` / `readChatVersion` / `setActiveChatVersion` / `clearChatRecords`）+ `loadScenes` / `emptyScene` / `addScene` / `removeScene` / `moveScene` / `applyScenes`；**已无 `saveScenes`，也没有 `sameScenes` / `findCurrentRoundId` / `loadChatRounds` / `persistChatRounds`**
      ├─ TextTtsPage/
      │  ├─ index.vue            #  37 行   配音页外壳（三个 Tab：文字生音频 / 字幕配音 / 音色管理；Tab 值用 helpers 的 `activeTtsTab`）
      │  ├─ SynthSection.vue     # 379 行   文字生音频卡（音色/模型下拉受「Key 已配置」门控；**切回本 Tab 自动重拉音色**；合成失败时 `configPrompt.fromResult(res)` 弹「去设置」）
      │  ├─ AlignSection.vue     # 339 行   字幕配音（逐句对齐）卡（音色同样门控 + 未就绪时的「API Key 设置」按钮；**缺 ffmpeg 运行环境包时经 `useEnvGate` 弹确认框**）
      │  ├─ VoiceSection.vue     # 526 行   音色管理卡组（创建克隆音色弹窗——**`Teleport` 弹窗 2 处**；我的音色列表 4 列、不显示音色 ID、行尾「删云端」动作；音色映射；模型下拉按厂家分组；**切回本 Tab 自动重拉列表**）
      │  └─ helpers.ts           # 182 行   配音助手（三卡共用的 `activeTtsTab`、配置形状唯一读取入口 `readActiveCfg`、Key 就绪状态、音色载入/分组）
      ├─ SubtitlePage/
      │  ├─ index.vue            # 256 行   字幕条目编辑（「由脚本旁白生成」下方一行提示明说时长是估时、按 `@shared/constants` 的 `EST_CHARS_PER_SEC`（4 字/秒）推算、不读配音音频；提示行 / 按钮 title / toast 都引用常量，界面不写死数字）
      │  ├─ TranscribeSection.vue# 365 行   转录弹窗（**缺 ffmpeg 运行环境包时经 `useEnvGate` 弹确认框**，`doTranscribe(skipEnvGuard)`）
      │  └─ helpers.ts           # 165 行   字幕助手（估时、条目类型等）
      ├─ HtmlGenPage/             # **一页拆成七个文件（一个文件一件事；角色预览 `CastShot.vue` 已上提到 `components/`）**
      │  ├─ index.vue            # 477 行   页面入口：StepBar + 项目状态卡（`.proj-meta`，3 个纯数据格 + 标题右侧「用法」`?` 气泡，两者都来自 `useProjectMeta()`）+ **字幕 / 画布下拉（同一个 `.hgen-row`）** + **全局视觉风格输入框（`content.style`，与画布同级的项目属性；失焦即 `saveContent` 落盘并把现有 scenes 原样带回）** + `<MaterialsSection />` → **`<CastSection v-model:prompt="prompt" />`** → `<ChapterSection />` + 需求描述 + 动作行上方统一的生成前提提示 + 四个动作按钮（生成 HTML / 按需求修改 / 下载 HTML / 转视频）+ `<PreviewSection />` + 转视频弹窗；生成流程把 `{ subtitleProject, materialIds, taskId }` 交给主进程（`taskId` 由 `newTaskId('html')` 生成，进度按它订阅），渲染载荷为 `{ quality, fps, canvas }`
      │  ├─ MaterialsSection.vue # 167 行   「项目素材」区块：图片 / 视频两堵 `.mat-grid` 卡片墙（勾选 / 移除 / 添加），**无 props、无 emits**，状态就是 `appState.project.materials`；末尾有一段被注释下线的「提取原声为背景音频」实现
      │  ├─ CastSection.vue      # 184 行   **「项目素材 · 角色」（常显，0 个也显示）**：**与「项目素材」同一套卡片墙**（复用 `.mat-grid` / `.mat-card`）——每张卡：勾选框 `.mat-check`（左上角，`selected` = 参与本次生成，未勾整卡 `.mat-card.off`）+ 右上角「…」按钮（`.hf-btn.cast-more`）+ `.cast-thumb`（**13:15 竖版预览位 = 130×150**，包着 `CastShot`，底色 `#EEF2F7`；卡片墙容器是 `.mat-grid.cast-mat-grid`，列宽定死 130px，**别再收回 100px**——100 宽配 150 高看着细长、下面两行字也挤成一团）+ `.mat-meta`（`.mat-name` 名字 / `.mat-path` 里写 `{{units}}u · {{desc}}`）+ 条件渲染的 `.cast-menu`（存为全局 / 改这个角色 / 移除）；标题右侧两个动作（从全局库添加 / **新建角色**）；**两个弹窗已拆到 `CastLibraryModal.vue` / `CastCreateModal.vue`**；空态提示带全局库条目数；**props 只有 `{ prompt?: string }`**（`status` / `thinkText` 已删，`<CastCreateModal>` 不再收 `:status`），`epoch` + `watch(() => appState.project)` 让缩略图在角色代码变化后重载；**位置在素材区之后、章节块之前**
      │  ├─ CastLibraryModal.vue # 116 行   **「从全局角色库添加」**：**方格网格**（`repeat(auto-fill, minmax(132px, 1fr))`）每格一张 `CastShot`（`from="lib"`）+ 名字 + 身高，点格子切换 `picked: string[]`，选中态主色描边 + 勾角标；`missing` 格子压暗不可点 + 「文件缺失」；底部「导入 N 个」→ `importCast` → `refreshProject()` → toast → 发 `imported` 与 `close`；每次打开都重新 `listCastLibrary()`；props `open` / `project` / `epoch?`，emits `close` / `imported`
      │  ├─ CastCreateModal.vue  # 169 行   **「新建角色」**：两态——① 填设定（角色名 / 外形描述 / 身高 units / 是否水彩）→ `newCast`；② **画成功后弹窗不关**：左侧 200×260 大图 `CastShot(big)`、右侧名字 / 描述 / 身高 / `cast/<id>.js` 与「重新生成 HTML 后才会画进页面」，按钮变「再画一个」/「完成」；**进度自己订**：`newTaskId('cast')` + `onTaskProgress(taskId, cb)`（写本地 `castStatus`），任务结束 `off()`，与「生成 HTML」那一路并行；props 只有 `open` / `project`，emits `close` / `created`
      │  ├─ PreviewSection.vue   # 470 行   「预览」卡片：**背景音频行（一行只有一个控件：`sel-label` 56px + `HfSelect` `flex:1` 占满整行；**当前音频就是「已生成音频」里的选中项**——`currentAudioIndex` 把 `audioFile` 按 basename 匹配回列表，「不使用背景音频」也在下拉里；没有独立「移除」按钮、也不挂 `?`）** + 试听与语速（`onMounted` 按项目现有 `audioFile` 初始化试听源） + 状态行 + AI 思考过程 + **「视角比例」行**（`viewMode`：16:9 / 9:16 / 1:1，默认 = 页面天然比例 `pageMode`、不落盘，行尾 `.hgen-tip` 用 `v-show="viewHint"` 做 2 态说明；**不显示画布值**） + iframe 预览副本（**iframe 视口 = 页面自己声明的画布（`pageCanvas`，无声明回落项目画布）；容器尺寸由 `frameStyle` 决定：高度上限 800px、宽度 `min(100%, 800×比例)`、`aspect-ratio` 定高（宽窗口 16:9=1422×800 / 9:16=450×800 / 1:1=800×800），并由 `main.css` 的 `margin-inline:auto` 水平居中；`fitFrame()` 用 contain：`min(宽比, 高比)` + `translate` 居中**） + 播放控制条（**一个三态键**：暂停 / 播放 / 重新播放（`prevEnded` 判定） + 拖动 seek）+ **控制条下方那行 12px 说明（`v-if="prevDurUnknown"`）**——页面里有 GSAP 的 `repeat: -1` 时总时长不可信，界面显示 `--:--`、拖动 seek 自动不可用（`seekTo` 要求 `prevDur > 0`），并用一句话说明改回有限次数就会恢复；**props `{ status, statusClass, thinkText, rendering }` + `defineExpose({ reload })`**
      │  └─ ChapterSection.vue  #  71 行   「章节列表」只读卡片（章节模式下才有内容）：序号 / 标题 / 起止 / 时长 / `pages/cNN.js` + 每行「改这一章」，点它把「只改第 N 章（pages/cNN.js）：」填进需求描述
      ├─ VideoPreviewPage/
      │  └─ index.vue            # 149 行   视频预览（纯预览：可选任意「有视频成品」的项目播放 / 定位；**切换只换本页播放内容、不改工作项目**；播放源经 `toHgPreviewUrl()` → `utils/url.ts` 的 `previewUrl()` 拼成 `hgpreview://p/…`——原 `file://` 拼接在 dev 下（渲染页是 `http://localhost`）会被 Chromium 拒绝、视频全黑，该分支已删除；「转视频」与渲染档位在 HTML生成页）
      └─ SettingsPage/            # 一页一目录：外壳 + 页面级 .ts + components/ 下的区块组件
         ├─ index.vue            #  66 行   设置页外壳（左侧 5 类平级导航 + 右侧按分类挂载；分类记忆 + 跨页意图消费）
         ├─ types.ts             #  12 行   页面类型出口（re-export `VoiceProviderView`；`UpdateCheckReply = IpcResult<UpdateCheckResult>`）
         ├─ constants.ts         #  32 行   页面级常量（CUSTOM_VALUE / SETTINGS_SECTION_KEY / SETTINGS_NAV_ITEMS 五项 / SETTINGS_SECTION_KEYS）
         ├─ helpers.ts           #  56 行   分类状态（activeSection 与 updateStage 两个模块级 ref + 分类记忆与跨页意图消费）
         └─ components/
            ├─ ModelSection.vue  # 188 行   「模型配置」区块（自定义模型：Base URL / 模型 ID 预设联动 + API Key / 思考强度 / 启用 / 保存 / 测试连接）
            ├─ VoiceSection.vue  #  85 行   「语音服务」区块（按厂家：厂家下拉 + API Key）
            ├─ RenderSection.vue #  74 行   「渲染档位」区块（视频渲染默认质量 / 帧率）
            ├─ WhisperSection.vue# 274 行   「语音识别模型」区块（whisper.cpp 模型管理；模板根节点为普通 `<div>`，卡片外壳由外壳 `index.vue` 的 `.card.hgen-panel` 分支提供）
            ├─ UpdateSection.vue # 397 行   「应用更新」区块（含跳过版本 / 恢复提示版本、运行环境一行三态、「自定义更新源」弹窗（**整块 `Teleport` 到 `<body>`**，`v-show` 留在蒙层上）、「查看更新日志」按钮）
            └─ ChangelogDialog.vue # 145 行  「更新日志」弹窗（`UpdateSection` 的子组件，无 props + 一个 `close` emit，**蒙层 `Teleport` 到 `<body>`**）：取一次随包 `CHANGELOG.md` 原文，**只显示最新一版**（版本 / 时间一行 + 每条一行「`[标签]` 标题」，最多先 10 条），旧版进「历史版本（N）」折叠区；**全模板纯文本渲染、没有 `v-html`**
```

> **行数口径**：与 [README](./README.md) §4 一致，用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）；**不要**用 `(Get-Content $f).Count`。
>
> **文件计数**：`index.html`(1) + `agents.md`(1) + `src/` 下 **63** 个（`main.ts` / `App.vue` / `env.d.ts` / `constants.ts` / `assets/main.css` / `components` **5** / `composables` **10** / `utils` **7** / `pages` **36**）= **65**。页面文件数 36：`ContentPage/` 一个目录 **7 个文件**（`index.vue` 35 / `SceneEditor.vue` 74 / `AiChatPanel.vue` **456** / `CastPickerModal.vue` **127** / `ScriptRoundCard.vue` 139 / `helpers.ts` 271 / `castPick.ts` **9**，**合计 1111 行**）——拆的依据是「一个文件一件事」：外壳、两个 Tab 各一个组件、单轮结果卡、挑角色的弹窗、共享状态与保存 / 记录逻辑、**本次会话选中的角色**（独立的 9 行模块级 `ref`，理由是「切 Tab / 切页面不丢、且它不是项目内容」）；`HtmlGenPage/` **7 个文件**（`index.vue` 477 / `CastCreateModal.vue` 169 / `CastLibraryModal.vue` 116 / `CastSection.vue` 184 / `MaterialsSection.vue` 167 / `ChapterSection.vue` 71 / `PreviewSection.vue` 470，合计 **1654** 行；`CastShot.vue` 已不在本目录，见 `components/`）、`SettingsPage/components/` 含 `ChangelogDialog.vue`。`utils` 7 = 含 `url.ts`（路径 → URL 的唯一出口）、`changelog.ts`（随包 CHANGELOG 的解析）与 `taskId.ts`（任务 id）；`composables` 10 = 九个单例 + `useProjectMeta.ts`（无模块级状态，只导出 `computed`）。

---

## 2. 启动与导航

### 2.1 启动链路

```
index.html（CSP meta + <div id="app"> + <div id="boot-splash"> 启动画面；品牌文案占位符由 electron.vite.config.ts 构建期注入）
  → 启动画面先上屏（纯 HTML/CSS，不等 JS）
  → main.ts：createApp(App).mount('#app') + import './assets/main.css'
     → mount 之后：#boot-splash 加 .boot-done 淡出，300ms 后 remove()
     → App.vue onMounted：
        ① window.windowControls.onMaximizedChange(v => isMaximized = v)
        ② initRenderProgress()                    # 全局订阅 video:progress（单订阅语义）
        ③ initApp()：
             localStorage[STORAGE_KEY_PROJECT_CTX]（值 'myapp.projectCtx'） → appState.currentName
             → Promise.all([refreshProject(), loadRenderDefaults()])
```

- 当前项目上下文用 `localStorage` 持久化：键名集中在 `src/renderer/src/constants.ts` 的 `STORAGE_KEY_PROJECT_CTX`（值即 `'myapp.projectCtx'`，只存 `{ name }`），prod 下 `loadFile(file://)` 同源，故重启自动延续。**前缀 `'myapp.'` 故意不跟随品牌名**——键名就是用户数据的地址，改名会丢「上次项目 / 设置页分类」记忆。
- **品牌文案只有一处来源**：`src/shared/constants.ts`。`App.vue` 标题栏与 `HomePage` 直接 `import`；`index.html` 写占位符，由 `brandHtmlPlugin()` 构建期替换。**素材白名单与上限（`MAX_MATERIALS` / `IMAGE_MATERIAL_EXTS` / `VIDEO_MATERIAL_EXTS`）也在这一层**，主进程校验与渲染层提示共用同一份（见 [05-目录架构-src-shared §4](./05-目录架构-src-shared.md)）。
- **启动画面是首屏体验的一部分**：窗口由主进程立即显示（`backgroundColor: '#0B1220'` 与画面同色）。详见 [index.html](./files/renderer/index.html.md) §2.3。
- 渲染进度是**全局单例**（`useRenderProgress.ts`），在 `App.vue` 只订阅一次；**展示点在本轮发生了变化**：渲染进行中由 `HtmlGenPage/PreviewSection.vue` 的 `statusDisplay` 显示 trace 文案（`rendering && renderProgress.text` 时接管状态行），而**复位调用点有三处**——`HtmlGenPage/index.vue` 的 `onMounted` 与 `onRenderVideo` 结束（含异常分支）、`VideoPreviewPage/index.vue` 的 `onMounted`。
- 渲染默认档位也是全局单例（`useRenderOptions.ts` 的 `renderDefaults`），由 `App.vue` 启动时与 `refreshProject()` 并行调用 `loadRenderDefaults()` 读入。

### 2.2 导航（无 router）

```ts
// pages/index.ts
export const pages: Record<PageKey, Component> = { home, about, content, 'text-tts': TextTtsPage, subtitle, 'html-gen': HtmlGenPage, 'video-preview': VideoPreviewPage, settings }
export const currentPage = shallowRef<Component>(pages.home)
export const pageNavKey = ref(0)

export async function goPage(key: PageKey) {
  activeMenu.value = key
  try {
    await refreshProject()          // 刷新项目上下文（两次 IPC）
  } catch (e) {                     // 刷新失败不能拖住导航
    toast('项目信息刷新失败：' + msg)
  }
  currentPage.value = pages[key]    // 无论刷新成败都换页
  pageNavKey.value++                // 递增 key 强制重挂载
}
```

三个设计要点：

1. **`goPage` 有「先刷新项目再渲染」的副作用**：刷新失败**也照切页**，只把原因 `toast` + `console.error` 说出来。
2. **`pageNavKey` 作为 `<component :is>` 的 `key`**：递增 key 强制重挂载，恢复「每次进入页面重新加载当前项目」的语义（素材库、预览 iframe 也因此每次都重建）。
3. **组件对象用 `shallowRef`**：避免 Vue 深度代理组件定义。

### 2.3 页面 key 与入口

| PageKey | 组件 | 侧栏菜单 | 说明 |
|---|---|---|---|
| `home` | `HomePage/index.vue` | ✅ 首页 | 启动默认页 |
| `content` | `ContentPage/`（入口 `index.vue` + `SceneEditor.vue` / `AiChatPanel.vue` / `CastPickerModal.vue` / `ScriptRoundCard.vue` / `helpers.ts` / `castPick.ts`） | ✅ 内容脚本 | 流水线起点（内容源）。**两个 Tab：场景编辑（默认，编辑即自动保存）/ AI 创作（对话式生成，结果写回编辑器并走同一条自动保存；对话记录 = `chat/index.json` 索引 + `chat/versions/<id>.json` 每版副本，展开 / 应用时才读）**；两个 Tab 共享 `helpers.ts` 的同一份 `scenes`。**「AI 创作」本轮多了一样东西：角色选择**——参数行里一个「角色：选择 / N 个」按钮 → `CastPickerModal.vue`（只读全局角色库 `projectTools.listCastLibrary`，缺文件成员压暗不可选）→ 参数行下方「本片角色」chips（名字 + `×` 移出，`title` 显示描述与身高）；选中项存在 `castPick.ts` 的模块级 `pickedCast`（**跨 Tab / 跨页面保留、不落盘**），发送时整份塞进 `scriptTools.generate` 载荷的 `cast`，**只作提示词上下文**（不导入项目、不进 `scenes` / `content.json` / `project.json`，也不改「HTML生成」页的角色勾选语义） |
| `text-tts` | `TextTtsPage/index.vue` | ✅ 配音 | 内含三个 Tab：文字生音频 / 字幕配音 / 音色管理（原独立页 `SoundCopyPage` 已并入） |
| `subtitle` | `SubtitlePage/index.vue` | ✅ 字幕生成 | 含转录弹窗子组件 |
| `html-gen` | `HtmlGenPage/index.vue`（+ `CastSection.vue` / `CastLibraryModal.vue` / `CastCreateModal.vue` / `MaterialsSection.vue` / `ChapterSection.vue` / `PreviewSection.vue`；**角色预览 `CastShot.vue` 不在本目录**，已在 `components/`） | ✅ HTML生成 | **一页七个文件**：入口只剩状态卡（3 个纯数据格 + 标题右侧「用法」`?` 气泡）/ **字幕与画布同一行**（原先各占一个 `.hgen-block`，两条 `panel-title-sm` 已删除、名称交给行内标签；画布仍是全应用唯一选择点，画布说明**只在 `?` 气泡里**——正文是 `canvasNote`（随画布变）+ `canvasHint`（固定常量）两段拼接，「改完要重新生成」统一由动作行上方的 `.hgen-tip` 说） / **全局视觉风格输入框（`content.style`，该字段全应用唯一编辑点；失焦即落盘、把现有 scenes 原样带回；标题保留）** / 需求描述 / 动作行上方统一的生成前提提示 / 四个动作按钮 / 转视频弹窗；**项目素材三块按顺序挂在模板里：`<MaterialsSection />`（图片 / 视频）→ `<CastSection />`（**角色**）→ `<ChapterSection />`（章节列表，只读）**。**「角色」区主体在 `CastSection.vue`（262 → 154 → 187 → **184** 行，**常显**）：**与素材同一套卡片墙**（人物在上、名字在下）——每张卡勾选框（参与本次生成）+ **13:15 竖版预览位（130×150，列宽定死 130px 靠容器上的 `.cast-mat-grid`）** + 右上角「…」菜单里的三个动作（存为全局 / 改这个角色 / 移除），标题右侧「从全局库添加」（`CastLibraryModal.vue`，方格网格）/「新建角色」（`CastCreateModal.vue`，画成功后留窗看 200×260 大图，进度按自己的 `taskId` 订阅）。**转视频入口与渲染档位仍在此页** |
| `video-preview` | `VideoPreviewPage/index.vue` | ✅ 视频预览 | 流水线终点：**可选项目预览**——默认当前工作项目，下拉另列「有视频成品」的项目；**切换只换本页播放的成品，不改 `appState.currentName`**；渲染由 HTML生成页发起并回写 `videoPath`（落盘为项目内相对路径 `video/output.mp4`，经 `project:load` 换算成绝对路径后交给本页） |
| `about` | `AboutPage/index.vue` | ✅ 关于 | 静态页 |
| `settings` | `SettingsPage/index.vue` | 设置 | 外壳只决定「显示哪一类」，正文分布在 `SettingsPage/components/` 的 5 个区块组件里 |

> 侧栏菜单项在 `App.vue` 中以 `menuItems` 数组声明（8 项），页面切换后由 `watch(currentPage)` 把 `content` 容器滚动复位。注册表 8 项与菜单 8 项**完全一致**。

---

## 3. 状态与通信约定

| 关注点 | 做法 | 位置 |
|---|---|---|
| 全局项目状态 | 模块级 `reactive` 单例 `appState`（`currentName` / `project` / `myProjects`）；`appState.project` 的 `ProjectState` 含 **`materials: ProjectMaterial[]`**（取代旧的 `videoMaterial: string`）与 **`canvas: RenderCanvas`**（成片画布方向，本次新增；缺省 = `DEFAULT_CANVAS` 横屏） | `composables/useAppStore.ts` |
| 链路状态 | 5 个 `computed`：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo`，一律只看当前项目自身的产物字段 | 同上 |
| 项目切换 | `switchProject(name)`：写 `appState.currentName` → `saveProjectCtx()` → `refreshProject()` | 同上 |
| 持久化键名 | 上次项目 `STORAGE_KEY_PROJECT_CTX`、设置页分类 `STORAGE_KEY_SETTINGS_SECTION`，都由 `STORAGE_PREFIX` 派生 | `constants.ts`（见 §4） |
| 品牌文案与素材规则 | 中文名 / 英文名 / 口号 + **素材上限与扩展名白名单**一律取共享层常量 | `@shared/constants` |
| 后端调用 | 一律 `window.<命名空间>.<方法>()`，结果按 `IpcResult`（`ok` / `message` / `canceled`）分支处理 | 各页面 |
| **内容脚本的保存与记录** | **编辑即自动保存**（`ContentPage/helpers.ts` 的 `scheduleSave` / `flushSave` / `flushPending`：防抖 600ms、写入前抓「项目名 + 内容」快照、串行队列、失败置 `saveState='error'` 并可重试；卸载时只冲刷确有快照的改动）；**对话记录 = 索引 + 每版副本**（`chat/index.json` 只存元数据、`chat/versions/<id>.json` 每版脚本，展开 / 应用时才读；`scriptTools.loadChat` / `appendRound` / `readVersion` / `setActiveVersion` / `clearChat`；失败写进可见的 `chatError`） | `ContentPage/helpers.ts`、`ContentPage/AiChatPanel.vue` |
| 进度推送 | **一条频道 + 按任务 id 分发**：`projectTools.onTaskProgress(taskId, cb)` 返回退订函数，调用方自己生成 id（`utils/taskId.ts`）并先订阅再调用；其余进度频道仍是单订阅（在 `onMounted` 调 `onXxxProgress(cb)` 注册，切页自动替换回调） | 各页面 / `App.vue`（渲染进度） |
| 提示反馈 | `toast(msg)`（2800ms 自动消失，`App.vue` 用 `TransitionGroup` 渲染） | 全局 |
| 文本输出 | 需拼接 HTML 的场景一律用 `escTxt()` 转义 | `utils/escape.ts` |
| 时间格式 / 播放语速 | `fmtTime` / `fmtTimeMs`；`applyRate` / `stepRate`（仅改 `playbackRate`） | `utils/time.ts` / `utils/rate.ts` |
| 路径 → URL | 渲染层一律不拼 `file://`：项目内资源经 `previewUrl()`（`hgpreview://p/<编码项目名>/<逐段编码的相对路径>`）、项目外语音产物经 `userPathUrl()`（`hgpreview://user/<相对路径>?user=1`，`?tts=1` 是路由标记、不是可有可无的参数；认不出白名单目录返回空串 ⇒ 不给试听入口） | `utils/url.ts` |
| 渲染档位 | 项目覆盖 > 全局默认 > 内置默认（`standard` / `30`）；缺省字段逐级继承 | `composables/useRenderOptions.ts` + `utils/render.ts` |
| **成片画布**（本次新增） | **项目属性，不是渲染档位**：三档 `landscape` / `portrait` / `square`（缺省 `DEFAULT_CANVAS` = 横屏 1920×1080），只在「HTML生成」页选一次，落 `project.json` 的 `canvas`；同一个值决定生成提示词的版式尺寸（主进程 `buildCanvasBlock()`）、预览 iframe 的画布与渲染入口写入的 **舞台 `data-width`/`data-height`（成片宽高真正来源）+ `<html data-resolution>`（页面自描述，渲染链路不读）** | `pages/HtmlGenPage/index.vue`（选择 + `projectTools.setCanvas`）+ `pages/HtmlGenPage/PreviewSection.vue`（预览）+ `utils/render.ts` / `composables/useAppStore.ts` |
| **预览总时长的可信度** | 主进程注入的 `HG_PREVIEW_CTRL` 在 `clock()` 里对「超过页面声明时长 10 倍」或「超过 24 小时」的时长判为不可信，回报 `{ dur: 0, unknown: true }`；`PreviewSection.vue` 用 `prevDurUnknown` 把总时长显示成 `--:--` 并多一行说明（拖动 seek 因 `prevDur > 0` 不成立而自动不可用）。**不猜一个假时长** | `pages/HtmlGenPage/PreviewSection.vue` + 主进程 `src/main/projects.ts` 的 `HG_PREVIEW_CTRL` |
| 运行环境状态 | 模块级 `ref` 单例 `runtime`：`initRuntime()` 先订阅 `runtime:progress` 再查一次 `runtime:status` 补齐首帧；`prepare()` 的包名数组走 `toRaw(list).slice()` | `composables/useRuntime.ts` |
| 运行环境确认框 | 模块级单例：`guard(need, actionName, cont?)` 缺包才弹框并记下续做闭包；装好后 `continueAction()` 先关框再用原参数重发（**不自动续做**） | `composables/useEnvGate.ts` + `App.vue` 内联确认框 |
| 配置类错误弹窗 | 模块级单例：`open(msg, target, jump?, title?)` / `fromResult(res, jump?)`；主按钮固定「去设置」，**不显示「查看详情」**、**余额 / 欠费不弹窗** | `composables/useConfigPrompt.ts` + `App.vue` 内联弹窗宿主 |
| 旧数据提示 | 模块级单例 `info` / `visible` / `busy`：`initLegacyData()` 问一次 `legacy:status`；`resolve(action)` 回传 `legacy:resolve` | `composables/useLegacyData.ts` + `components/LegacyDataDialog.vue` |
| 跨页导航意图 | 模块级 `ref` 单例 `settingsSectionRequest`：源页置位 → 目标页读取并复位 | `composables/useNavIntent.ts` |
| **项目素材库** | **状态真源 = `appState.project.materials`（不复制本地列表）；增删勾选都经 `projectTools.pickMedia / addMaterials / saveMaterials`，每次落盘后 `refreshProject()`**；提交 IPC 前必须把 reactive 元素铺平成普通对象（`plainList()`，否则结构化克隆抛 `DataCloneError`） | `pages/HtmlGenPage/MaterialsSection.vue` |
| **角色预览** | **只读、不落项目状态**：`CastShot.vue` 每次需要预览就 `window.castTools.preview(id, { units, title, uses })`（**没有 `project` / `from` 参数了**），主进程把内置 `core.js` + 库里这份角色代码拼成一页 HTML 写到 `<userData>/cast-preview/<id>.html` 后回 `rel`（**相对 userData**，形如 `cast-preview/hero.html`），组件用 `userFileUrl(rel) + '&e=' + epoch` 拼 `hgpreview://…?user=1` 交给 `iframe`（`userFileUrl` 自带 `?user=1`，续接参数必须用 `&`：写成 `?e=` 会让查询串变成 `user=1?e=0`，主进程认不出 `?user=1` ⇒ 404、iframe 显示 `Not Found`）。**`epoch` 由父级在角色被重画 / 改身高后 +1**（地址一变 iframe 就重载），`seq` 防并发落地顺序错乱。**本轮它从 `pages/HtmlGenPage/CastShot.vue` 搬到 `components/CastShot.vue`（67 行）**，使用点从 2 个页面 4 处变成「角色」页 3 处 + 「HTML生成」页角色区 + 「内容脚本」页选角色弹窗 | `components/CastShot.vue`（**公共组件**）+ `pages/CastPage/index.vue`（卡片墙的 `epochs`）+ `pages/HtmlGenPage/CastSection.vue`（`epochs`）+ `pages/ContentPage/CastPickerModal.vue` + 主进程 `src/main/projects/ipc/cast.ts` 的 `cast:preview` / `src/main/cast/preview.ts` |
| **内容脚本「选角色」（本轮新增）** | **只进提示词、零写入**：`ContentPage/CastPickerModal.vue` 打开时 `listCastLibrary()` 读全局库、`CastShot from="lib"` 出预览，`confirm()` 只回传「库里仍存在且不缺文件」的成员快照；选择落在 `ContentPage/castPick.ts` 的模块级 `pickedCast`（**不落盘**，理由：跨 Tab / 跨页面切换保留，面板 setup 状态每次挂载都会重建）；`AiChatPanel.send()` 把 `pickedCast.value.map((m) => ({ ...m }))` 塞进 `scriptTools.generate({ …, cast })`。主进程 `agent/script.ts` 的 `buildScriptPrompt()` 把它拼成【角色】+【角色使用约定】两块，`cast` 为空 / 缺省时**整块省略**（老行为逐字不变）。**它不导入项目、不写任何文件、不进 `scenes`，也不改「HTML生成」页的 `ProjectCastMember.selected`（勾选 = 注入页面）语义** | `pages/ContentPage/CastPickerModal.vue` + `pages/ContentPage/castPick.ts` + `pages/ContentPage/AiChatPanel.vue` + 主进程 `src/main/agent/script.ts` + 共享类型 `ScriptCastRef` |

---

## 4. 组件分层

| 层 | 成员 | 说明 |
|---|---|---|
| 外壳 | `App.vue` | 自绘标题栏、运行环境横幅（三态）、**内联的「下载运行环境」确认框**、**内联的「配置类错误」弹窗**、侧栏菜单、`<component :is>` 页面容器、旧数据弹窗宿主、Toast 宿主、启动流程 |
| 通用组件 | `components/StepBar.vue`、`NewProjectDialog.vue`、`HfSelect.vue`、**`CastShot.vue`**、`LegacyDataDialog.vue`（**5 个**） | `StepBar` props `page: PageKey`；`NewProjectDialog` 内部闭环 `create → refreshProject → switchProject`；`HfSelect` 全局自绘下拉（**调用点分布：`HtmlGenPage/index.vue` 4 处（「画布」下拉）+ `HtmlGenPage/PreviewSection.vue` 1 处 + `VideoPreviewPage/index.vue` 1 处，全库 21 个实例 / 11 个文件**，见 [components.md](./files/renderer/src/components.md) §5.10）；**`CastShot` 是角色静态预览（8 个 props、无 emits，调 `castPreview` 后载 `iframe`，不拼地址以外的任何逻辑；被「HTML生成」页三处 + 「内容脚本」页选角色弹窗共用，所以放在公共组件目录而不是某个页面目录下）**；`LegacyDataDialog` 无 props / 无 emits |
| 页面 | `pages/<PageName>/index.vue`（8 个，一个页面一个文件夹） | 一页一目录，`onMounted` 拉取当前项目数据 |
| 页面子组件 | `SettingsPage/components/{ModelSection,VoiceSection,RenderSection,WhisperSection,UpdateSection,ChangelogDialog}.vue`、`SubtitlePage/TranscribeSection.vue`、`TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue`、**`HtmlGenPage/{CastCreateModal,CastLibraryModal,CastSection,ChapterSection,MaterialsSection,PreviewSection}.vue`**（**`CastShot.vue` 已上提到 `components/`，不在此列**）、**`ContentPage/{SceneEditor,AiChatPanel,CastPickerModal,ScriptRoundCard}.vue`** | 由所属页面承载（与入口 `index.vue` 同目录，或同目录下的 `components/` 子目录）；`HtmlGenPage` 的六个子组件：`MaterialsSection` 契约是「无 props / 无 emits」（状态取自 `appState`），`PreviewSection` 契约是「5 个 props + `defineExpose({ reload })`」，`ChapterSection` 是只读章节列表（点「改这一章」只把范围写进需求描述，不发起请求），**`CastSection` 是可写的角色块（与素材同一套卡片墙，不是列表行）**（同样 `v-model:prompt` 只写不读，**只接 `prompt?` 一个 prop**——上一版的 `status?` / `thinkText?` 已删；**三个动作收进每张卡右上的「…」菜单**，其中勾选 / 移除走 `saveCast`、存为全局走 `promoteCast`、「改这个角色」只把 `只改角色 <id>（cast/<id>.js）：` 写进需求描述），**`CastLibraryModal` 是方格网格选角色**（`open` / `project` / `epoch?` + `close` / `imported`），**`CastCreateModal` 是两态新建弹窗**（**只有 `open` / `project` 两个 props** + `close` / `created`；进度自己在弹窗内按 `taskId` 订阅）；**`ContentPage` 的四个子组件**：`SceneEditor` / `AiChatPanel` 是两个并列 Tab（无 props，状态取自 `helpers.ts`），**`CastPickerModal` 是选角色弹窗（`open` / `project` / `selected` + `close` / `confirm(members)`——只读全局角色库、`confirm` 只回传不缺文件的成员快照）**，`ScriptRoundCard` 是纯展示卡（props `round / index / current / expanded / scenes / charsPerSecond / applying`，emits `toggle` / `apply`；`round` 只有元数据，展开内容由父组件懒加载后经 `scenes` 传入）；**`ChangelogDialog` 契约是「无 props + 一个 `close` emit」**（`UpdateSection` 用 `v-if="changelogVisible"` 挂载，见 [SettingsPage.md](./files/renderer/src/pages/SettingsPage.md) §4.6） |
| 页面助手 | `SubtitlePage/helpers.ts`、`TextTtsPage/helpers.ts`、**`ContentPage/helpers.ts`**、**`ContentPage/castPick.ts`（9 行，只导出 `pickedCast`）** | 模块级共享纯逻辑与类型，被同目录的多个组件复用；**`ContentPage/helpers.ts`** 持有模块级 `scenes` / `dirty`（两个 Tab 必须看到同一份场景，AI 生成结果要立刻进编辑器、下一轮又要以编辑器内容为上下文）+ **自动保存调度**（防抖 / 快照 / 串行 / 重试）与**对话记录读写**（`chatError` / `loadChatIndex` / `appendChatRound` / `readChatVersion` / `setActiveChatVersion` / `clearChatRecords`）；页面挂载时由 `loadScenes()` 复位、卸载时 `flushPending()` 只冲刷确有快照的改动。**`castPick.ts` 是「不是项目内容」的那一类模块级状态**：`pickedCast = ref<ScriptCastRef[]>([])` 只活在本次会话（不落盘、不写项目），放模块级是为了**跨 Tab / 跨页面切换保留**——所以它没有并进 `helpers.ts`（那边管的是项目内容与它的保存 / 对话记录） |
| 基础设施与常量 | `composables/*`（**10 个**）、`utils/*`（**7 个**）、`constants.ts` | 全局状态、Toast、渲染进度、运行环境状态与确认框、配置类错误弹窗、旧数据提示、渲染档位、**项目状态条派生**、语速、转义、**任务 id**、时间、路径 → URL、随包 CHANGELOG 的解析；`constants.ts` 只放渲染层自己的约定（`localStorage` 键名），品牌文案与素材规则在共享层 |

---

## 5. 页面 ↔ 主进程域对照

| 页面 | 主要交互 | 涉及的主进程域（preload 命名空间） |
|---|---|---|
| HomePage | 项目列表与进度标记、切换项目、跳转各节点 | `projectTools` |
| AboutPage | 纯静态 | — |
| ContentPage（7 个文件） | **入口**：`StepBar` + 两个 Tab（默认「场景编辑」，`v-show` 挂载两个 Tab 不销毁）；卸载时 `flushPending()` 把还在防抖里的改动写掉。**`SceneEditor`**：编辑 `scenes`（旁白 / 画面分镜 / 时长提示）与增删排序——**编辑即自动保存，没有保存按钮**，只显示一行状态（保存中… / 已自动保存 HH:mm:ss / 保存失败：原因 + 重试）；**画面分镜输入框随内容自动长高**（`field-sizing: content` + `min-height` 两行字高度、`max-height: 260px` 后内部滚动，关掉手动 resize）；**保存逻辑在 `helpers.ts`**（`scheduleSave` / `flushSave` / `flushPending`，防抖 600ms + 写入前抓快照 + 串行队列，快照里把已落盘的 `content.style` 原样带回）。**`AiChatPanel`**：调 `scriptTools.generate`（上下文 = 编辑器当前 `scenes`，本轮载荷还带 `cast`）并经 `applyScenes()` 把结果**整份写回编辑器 → 自动保存落 `content.json`**，进度走 `scriptTools.onProgress`；**对话记录 = 索引 + 每版副本**（`loadChat` 只读索引、`appendRound` 写副本并更新索引、`readVersion` 展开 / 应用时才读、`setActiveVersion` 改 `activeVersionId`、`clearChat` 删整个 `chat/`；「当前」标记读 `activeVersionId`，失败以 `chatError` 红字可见）。**`CastPickerModal` + `castPick.ts`（本轮新增）**：参数行的「角色」按钮 → 弹窗只读全局角色库（`listCastLibrary`，缺文件成员压暗不可选）→ 确定后「本片角色」chips 落在模块级 `pickedCast`（**不落盘**，跨 Tab / 跨页面保留）→ 发送时整份进 `cast`。**角色只作提示词上下文**：不导入项目、不写任何文件、不进 `scenes`，也不影响「HTML生成」页的角色注入 | `projectTools`（`saveContent` / `load` / **`listCastLibrary`** / **`castPreview`**（经 `CastShot`））、**`scriptTools`** |
| TextTtsPage | 壳：Tab 切换三个子卡 | — |
| ├ SynthSection | 音色/模型选择、文字合成、试听（`userPathUrl()` → `hgpreview://user/…?user=1`）、设为背景音频、已生成音频列表；**合成失败且为配置类时弹「去设置」** | `voiceTools`、`projectTools`、`useConfigPrompt` |
| ├ AlignSection | 逐句对齐（模式 A/B）、进度与取消、整轨与逐句试听（`userPathUrl()` → `hgpreview://user/…?user=1`）、结果写回；**失败分支先判配置类弹窗、再判缺 ffmpeg 包** | `voiceTools`、`projectTools`、`useEnvGate`、`useConfigPrompt` |
| └ VoiceSection | 创建克隆音色（`Teleport` 弹窗）、云端/系统音色列表、本地显示名与绑定模型 | `voiceTools`、`useConfigPrompt` |
| SubtitlePage | 字幕条目编辑、SRT 写入方式、复制、导出、由脚本旁白生成、保存 | `projectTools` |
| └ TranscribeSection | 选音频与语言、转录、进度、结果替换/追加 | `whisperTools` |
| **HtmlGenPage（7 个文件）** | **入口**：提示词生成/修改 HTML（两个并列按钮、各带行内 `?`；「生成 HTML」点一次即执行、无二次确认）、**字幕 / 画布下拉（同一行）**、需求描述、四个动作按钮、**转视频（先开「渲染档位」弹窗）**、**失败分支 `res.needConfig` → `configPrompt.open(...)` 且不叠 toast**；**`MaterialsSection`**：素材库增删勾选（`pickMedia` / `addMaterials` / `saveMaterials`），缩略图经 `previewUrl()` 取（`hgpreview://p/…`）；**`CastSection` / `CastLibraryModal` / `CastCreateModal`**（+ 公共组件 **`@renderer/components/CastShot.vue`**）：角色卡片墙（勾选 / 菜单里的移除 / 存为全局）+ 预览（`castPreview` → `previewUrl` → `iframe`）+ 两个弹窗（`listCastLibrary` / `importCast` / `newCast`）；**`PreviewSection`**：背景音频选定（`pickAudio` / `setAudio` / `clearAudio`，音轨由主进程注入 HTML，不经 Agent）+ 背景音频试听（源经 `previewUrl(项目名, res.audioFile, true)` 取，**项目内相对路径**）、预览副本（`previewHtml`，回执带 `pageCanvas`）、**「视角比例」行（16:9 / 9:16 / 1:1，纯观看状态不落盘；预览卡里不再显示画布值）与按页面声明画布 contain 的预览框**、**总时长不可信（页面里有 `repeat: -1`）时的 `--:--` 与那行说明**、状态行与 AI 思考过程（父页 props 传入） | `projectTools`（`generateHtml` / `modifyHtml`（两者的第三参 `materials` **必填**，含 **`taskId`**）/ `downloadHtml` / `previewHtml` / **`pickMedia` / `addMaterials` / `saveMaterials`** / `pickAudio` / `setAudio` / `clearAudio` / **`extractVideoAudio`（保留但当前无界面入口）** / `saveVideo` / `setRender` / **`setCanvas`（写成片画布方向）** / **`saveContent`（全局视觉风格失焦落盘，须把现有 `scenes` 原样带回）** / **角色 7 件套：`listCastLibrary` / `promoteCast` / `importCast` / `newCast`（`brief` 必填、含 `taskId`）/ `saveCast` / `castPreview`（`removeCastFromLibrary` 无界面调用方）** / **`onTaskProgress(taskId, cb)`（进度按任务 id 订阅、返回退订函数）**）、`hfTools`（`renderVideo`，载荷含 `canvas`）、`voiceTools`（`listGenerated`，仅填充音频下拉）、全局 `renderProgress` / `renderDefaults`、`useEnvGate`、`useConfigPrompt` |
| VideoPreviewPage | **可选项目**的成品预览：默认当前工作项目，下拉另列 `hasVideo` 的项目；播放 / 定位成品 MP4（`<video class="hf-video" controls>`，播放源由 `toHgPreviewUrl()` 内部调 `utils/url.ts` 的 `previewUrl()` 拼成 `hgpreview://p/<编码项目名>/<逐段编码的相对路径>?v=<时间戳>`）；「重新加载」始终可用（重读清单 + 所选项目被删/改名时回落当前项目）；空态按「没 HTML」/「没视频成品」分文案。**不发起渲染，也不切工作项目**；数据来自 `project:list` 的 `hasVideo` / `hasHtml` 与 `project:load` 的 `videoPath`（**无新增频道**；播放走 `src/main/index.ts` 早已注册的 `hgpreview://` 协议，不是 IPC） | `projectTools`（经 `refreshProject` 与 `load`）、`hfTools`（`showInFolder`）、全局 `renderProgress` |
| SettingsPage | 外壳 5 类导航 + 5 个区块组件（自定义模型 / 语音服务 / 渲染默认档位 / 应用更新 / 语音识别模型）；`ModelSection.vue` 的 `onTest()` 刻意不弹配置类弹窗 | `settingsTools`（含 `pickRuntimePack`）、`voiceTools`、`updateTools`、`runtimeTools`、`whisperTools` |

> 具体方法名与参数见 [files/renderer/](./files/renderer/) 下的文档（**`HtmlGenPage.md` 一篇覆盖该目录的 7 个文件**；角色预览组件 `CastShot.vue` 已上提到 `components/`，归 `components.md` 的对应一节）；频道 ↔ 命名空间总表见 [01-架构总览 §3.3](./01-架构总览.md)。

---

## 6. 样式策略

- **全局设计系统**：`assets/main.css`（**当前实测 2165 行**；素材库那一轮由 1676 → 1796，此后随更新日志弹窗、画布、章节列表与**角色区**继续增长；角色库那一轮 2128 行，之后 **+147 行**（2012 → 2159，含删减）= **角色区从「一行一个角色」改成卡片墙**：新增 `.cast-mat` / `.cast-thumb` / `.cast-more`（右上「…」）/ `.cast-menu*`（动作菜单）；随后**再 +5 行**（2159 → 2164）= **角色卡片墙缩到 100×150**：新增 `.cast-mat-grid`（只覆盖列宽，`repeat(auto-fill, 100px)`）、`.cast-thumb` 的 `aspect-ratio` 由 `4 / 5` 改 **`2 / 3`**、「…」按钮与动作菜单各缩一号（`top` / `right` 5px、菜单 `top: 28px`），**删掉** `.cast-list` / `.cast-row*` / `.cast-actions` / `.cast-units` / `.cast-file` 与上一轮起就不再使用的 `.lib-row*`、`.lib-missing`；**本轮再 +1 行**（2164 → **2165**）= **卡片格子从 100×150 放宽到 130×150**（用户反馈「被挤扁了，太窄了」，确认是格子形状太窄：宽 100 配 150 高显得细长）：`.cast-mat-grid` 列宽 `100px → 130px`、`.cast-thumb` 的 `aspect-ratio` `2 / 3 → 13 / 15`（**高度不变、只放宽**），并把「**不要收回到 100px**：100 宽配 150 高看着细长、下面两行字也挤成一团（用户实测反馈）」写进 `.cast-mat-grid` 上方的注释；`.cast-more` / `.cast-menu` / `.cast-name` / `.cast-desc` 以及全局库方格 `100%×132`、新建成功大图 `200×260` 都没动；一度试过的「值胶囊 `.prop-chip*`」已连同样式整体删除）承载根变量、标题栏、布局、菜单、卡片、按钮、表单、表格、`step-bar` 以及各页面专有样式（按源码注释可划分为约 38 个样式节，较近几轮新增「HTML生成页：项目素材库（图片 / 视频卡片墙）」一节：`.mat-grid` / `.mat-card`(+`.off`) / `.mat-thumb`(+`.mat-play`) / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`(+`.on`) / `.mat-del` / `.mat-add` / `.mat-count` / `.panel-title .dot.dot-img`，使用方只有 `HtmlGenPage/MaterialsSection.vue`；还新增「章节列表行（`.ch-*`）」一节——列宽 `minmax(0, Nfr)`，使用方只有 `HtmlGenPage/ChapterSection.vue`；**再把角色区并到素材那一套类名上**——「角色卡片墙」只用 `.cast-mat`（`overflow: visible`，不然「…」菜单被 `.mat-card` 的 `overflow:hidden` 切掉）+ `.cast-mat-grid`（唯一不沿用素材列宽的地方：容器上再加一个类把列宽定死 130px）+ `.cast-thumb`（`13:15` ⇒ 130×150）+ `.cast-more` + `.cast-menu*` 这几样，版式全部复用 `.mat-grid` / `.mat-card` / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`；「角色预览（静态一帧）」「全局角色库弹窗：方格网格」「新建角色成功后」三节（`.cast-shot*` / `.cast-grid` / `.cast-card*` / `.cast-done*`）本轮与上一轮都未动，使用方是 `HtmlGenPage` 的四个角色组件**））；由 `main.ts` 全局导入。其中 `html, body` 另设**全局基准字号 `font-size: 14px`**。视觉规范写在 `src/renderer/agents.md`（根目录 `agents.md` 只是指针；列表面板结构约定见该文件 §5.6、**项目属性行见 §5.7**）。
- **组件补充**：经核查，全部 `.vue` 中带 `<style>` 块的只有 **6 个文件、7 段**——`App.vue`（`<style scoped>`，Toast 宿主）、`components/HfSelect.vue`（`<style scoped>` 触发器 + **不带 `scoped`** 的弹层，因为弹层 Teleport 到 `body`）、`components/LegacyDataDialog.vue`（`<style scoped>`，`.path-line` / `.opt-list` / `.danger-text` / `.hf-btn.danger`）、以及 `ContentPage/` 的三个组件（`SceneEditor.vue` 的 `.ct-visual`（画面分镜输入框自动长高）+ `.ct-save` 三态着色、`AiChatPanel.vue` 的 `.ct-*` 聊天面板样式（**本轮多 `.ct-cast-btn` / `.ct-cast-row` / `.ct-cast-chip` / `.ct-cast-x` 四段**）、`ScriptRoundCard.vue` 的 `.ct-round` 等卡片样式，均 `<style scoped>`）；其余页面与组件（含 `HtmlGenPage` 的六个子组件、**`components/CastShot.vue`**、**`ContentPage/CastPickerModal.vue`**、`ContentPage/index.vue`、`ContentPage/castPick.ts`）不含样式块，完全依赖 `main.css` 的类名 + 模板行内 `style`——**选角色弹窗的方格网格 / 卡片 / 缺文件态全部复用 `main.css` 里已有的 `.cast-grid` / `.cast-card*`（「从全局角色库添加」那一套），本轮没有新增任何全局 CSS 类**。**唯一例外是启动画面**（`index.html` 的内联 `<style>`），它必须自包含。
- 主题通过 CSS 变量切换；若要加亮色模式只需在 `:root[data-theme="light"]` 覆盖变量。

---

## 7. 注意事项

1. **不要引入 vue-router / pinia**：`goPage` 的「先 refreshProject 再渲染」副作用与 `pageNavKey` 重挂载语义是刻意保留的旧行为等价物。
2. **别把进度订阅简化成「页面里注册一次」**：`project:html-progress` 已改成**一条频道 + 按 `taskId` 分发**（`onTaskProgress(taskId, cb)` 返回退订函数，调用方在 `finally` 里 `off()`），页面级任务与弹窗级任务可以并行；其余进度频道仍是单订阅语义（在 `onMounted` 注册一次即可，切页替换回调）。全局渲染进度只在 `App.vue` 注册一次。**`runtime:progress` 全渲染层只有 `useRuntime.ts` 一处注册**（`useEnvGate` 改为 `watch` 消费同一份状态）。
3. **文档级监听要成对**：`HtmlGenPage/PreviewSection.vue` 的 `message` / `resize` 监听（含 `seekAckTimer`）与 `TranscribeSection` 的 ESC 监听都改为 `onMounted` / `onBeforeUnmount` 成对注册；`HtmlGenPage/index.vue` 现在只剩 `document` 级的弹窗 ESC（`onModalKeydown`）。
4. **项目只有「我的项目」一种形态**：项目都是 `userData/projects/<项目名>/` 下的普通目录，各页面不需要只读守卫。
5. **CSP 禁止运行时模板编译**：SFC 全部预编译，不要使用 `Vue.compile` / 字符串模板。**CSP 的 `img-src` 本轮新增 `hgpreview:`**（素材缩略图经该协议取，见 [index.html.md](./files/renderer/index.html.md) §2.1）；`media-src` 同名协议覆盖音频 / 视频。
6. **唯一的同步 IPC 在设置页**：`updateTools.version()` 是 `sendSync`，调用点只在 `SettingsPage/components/UpdateSection.vue` 的 `onMounted` 里且包在 `try` 中。
7. **两类字符串归属不同，别放错层**：品牌文案与素材白名单取 `@shared/constants`；`localStorage` 键名取 `@renderer/constants`（**故意不跟随品牌改名**）。
8. **改代码前先看更新日志、改完必记一条**：与根 `AGENTS.md` 关键约定 3、4 一致。
9. **素材列表要过结构化克隆**：`appState.project.materials` 的元素是 Vue `Proxy`，直接 `invoke` 会抛 `DataCloneError`；写素材的代码必须先铺平成普通对象（`MaterialsSection.vue` 的 `plainList()` 就是为此存在，取不到任何性能收益也别省）。
10. **渲染层不再拼 `file://`（本轮收口）**：路径 → URL 只有 `utils/url.ts` 两个出口（`previewUrl()` / `userPathUrl()`），两者都**逐段 `encodeURIComponent`**，与主进程 hgpreview 处理器「按段 decode」的口径对应；`userPathUrl()` 认不出白名单目录时返回**空串**，调用方应据此隐藏试听入口而不是自己兜路径。唯一保留的 `file:///` 在**主进程** `src/main/video.ts:77`（喂 Chromium `--dump-dom` 量时间轴，不在页面里、不受同源策略约束），不属于页面资源。
11. **预览的「时长不可信」是一条只读回执，不是新状态**：主进程注入脚本把超长时长降级为 `{ dur: 0, unknown: true }`，`PreviewSection.vue` 只把 `unknown` 映射成 `prevDurUnknown`（`--:--` + 一行 12px 说明），**不新增 IPC 频道、不改 previewHtml 的回执结构**；拖动 seek 不用额外禁用——`seekTo` / `onSeekStart` 本来就要求 `prevDur > 0`。换项目 / 重载预览（`onFrameLoad`）会把这个标记复位。

---

## 8. 相关文档

- 说明文档：[files/renderer/](./files/renderer/)（每页一篇 / `assets.md`、`components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇 / 其余文件级各一篇）
- 共享层（品牌文案、素材规则与 IPC 契约）：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 桥接层与命名空间：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 状态与数据流全景：[01-架构总览.md](./01-架构总览.md) 第 4 节

## 附录 · 角色改版后的现状（与上文冲突时以本节为准）

- **页面 9 个（原 8）**：注册表 `pages/index.ts`（54 行）里 `pages` 变成 `home / about / content / text-tts / subtitle / html-gen / cast / video-preview / settings`，`cast: CastPage` 插在 `'html-gen'` 与 `'video-preview'` 之间；`PageKey`（`composables/useAppStore.ts`，121 行）加上 `'cast'`；`App.vue`（328 行）的菜单数组新增 `{ key: 'cast', label: '角色', title: '角色（全局角色库：新建 / 改画法，与项目无关）' }`。
- **页面目录** `src/renderer/src/pages/CastPage/`（**6 个文件 / 合计 1193 行**）：`index.vue` **190**（卡片墙 + **双击看动作示范** + 「…」菜单五项）/ `CastEditModal.vue` 228（新建角色与改画法共用一个弹窗）/ `CastMetaModal.vue` 115（改信息，不调模型）/ **`CastActionModal.vue` 326（动作示范弹窗：左 300×380 会动的大图、右公共动作 + 本角色专属两组列表 +「AI 生成…」面板，底部「改画法…」）** / **`CastActionEditor.vue` 256（关键帧表编辑器：名称 / 时长 / 循环 / 「只给这个角色」/ 一行一个时间点、一列一个参数 / 添加关键帧 / 另存为副本）** / **`CastDemoShot.vue` 78（动画 iframe：`castTools.demo` 拿 `rel`，`userFileUrl(rel) + '&e=' + epoch + '#' + actionId`；换动作只改 hash、epoch 变了才重载）**。
- **动作示范的入口**：卡片 `@dblclick.stop="openActions(m)"`（`.cast-card.static` 的 `cursor` 从 `default` 改成 `pointer`，`title` 写明「双击看它的动作示范」）；「…」菜单第一项也是「动作示范…」；「…」按钮与菜单自身 `@dblclick.stop`，不与双击打架。页面底部说明文案同样提到双击。
- **`components/CastShot.vue`（67 行）**：props 变成 `id / units / title? / uses? / epoch? / big?`（**去掉了 `project` 与 `from`**），内部改调 `window.castTools.preview(id, { units, title, uses })` → `userFileUrl(res.rel) + '&e=' + epoch`（`userFileUrl` 自带 `?user=1`，续接必须用 `&`，写 `?e=` 会 404）。
- **`utils/url.ts`（65 行）**：`ttsUrl` 改名为 **`userPathUrl`**，新增 **`userFileUrl(rel)`**（相对 userData 的路径 → `hgpreview://user/…?user=1`）；白名单常量改名 **`USER_DIRS = ['tts-output','voice','cast-preview']`**。
- **`pages/HtmlGenPage/`**：`CastSection.vue` 重写（118 行，只剩勾选 + 「管理角色」），`index.vue` 477 行且 `<CastSection />` 不再接 `prompt`；**删除 `CastCreateModal.vue` 与 `CastLibraryModal.vue`**。
- **`pages/ContentPage/`**：`CastPickerModal.vue` 122 行（props 只剩 `open` / `selected`，emit `confirm(members: ScriptCastRef[])`），`AiChatPanel.vue` 455 行；预览改为走 userData 下的预览页（`CastShot` 不再收 `project` / `from`）。
- **`TextTtsPage/AlignSection.vue`（339）/ `SynthSection.vue`（379）**：`ttsUrl` → `userPathUrl` 同步改名。
- **`assets/main.css`（2200 行）**：角色相关新增 / 调整见 [assets.md](./files/renderer/src/assets.md) 的角色一节（`.cast-card.static` / `.cast-style` / `.mat-card .cast-card-missing` 等）。
