# src/renderer/src/assets/（设计系统）
> **⚠️ 本轮「角色动作示范」对 `main.css` 的影响（以本块为准；`main.css` 现 2351 行）**
>
> - **「角色」页 · 动作示范弹窗新增 20 个类**（`2200 → 2351`，+144 行之后又补了 7 行注释）：`.cast-demo-shot` / `.cast-demo-frame`（300×380 的动画 iframe）、`.cast-act` / `.cast-act-left` / `.cast-act-right`（两栏）、`.cast-act-now` / `.cast-act-now-name`（当前动作那行）、`.cast-act-list` / `.cast-act-item`（状态类 `.on`）/ `.cast-act-tag`（状态类 `.ai`）/ `.cast-act-item-meta` / `.cast-act-item-acts` / `.cast-act-link`（状态类 `.danger`）、`.cast-act-ai`（AI 生成面板）、`.cast-act-table` / `.cast-act-tr`（状态类 `.head`）/ `.cast-act-th` / `.cast-act-cell` / `.cast-act-del`（关键帧表与删帧按钮）。
> - **`.cast-card.static` 的 `cursor` 由 `default` 改为 `pointer`**：卡片现在可双击看动作示范，得给出可点的暗示。
>
> **上一轮角色改造的影响（历史，保留备查）**
>
> - **新增 / 改动的类**：`.cast-grid`（`repeat(auto-fill, minmax(132px, 1fr))`，56vh 滚动）/ `.cast-grid.page`（取消高度上限，整页滚）/ `.cast-card`（可点）/ **`.cast-card.static`**（「角色」页整卡不可点、`overflow: visible` 让「…」菜单弹出）、**`.cast-menu`** / `.cast-menu-item`（含 `.danger`）、`.cast-thumb`（13:15 预览位）/ `.cast-mat-grid`（`repeat(auto-fill, 130px)`）、`.cast-card-missing`（缺失徽标）、**`.cast-style`**、`.cast-done` / `.cast-done-info` / `.cast-done-meta`、`.cast-shot`（56×72）/ `.cast-shot.big`（200×260）。
> - 角色预览 iframe 一律 `pointer-events: none`（点击穿透到卡片）；**动作示范的 iframe 例外**（它要能暂停 / 重播，`pointer-events` 正常）。

> ShadowMill（影坊）全局设计系统样式表，「Cyber UI / 深空科技」主题的唯一实现载体。

- **覆盖文件**：`assets/main.css`（本目录唯一文件，全局设计系统样式表）
- **所在目录**：src/renderer/src/assets/
- **类型**：全局样式表（设计系统）
- **规模**：**2351 行**（单文件设计系统随迭代持续增长；当前体量见 `[IO.File]::ReadAllLines` 实测。**本轮 +144 行**：新增「角色」页动作示范的 20 个类（见 §3.5.1）；更早那次由 2164 → 2165 是 **+1 行**：**角色卡片格子从 100×150 放宽到 130×150**（用户反馈「被挤扁了，太窄了」，确认是格子形状太窄：宽 100 配 150 高显得细长）——`.cast-mat-grid` 的列宽 `100px → 130px`、`.cast-thumb` 的 `aspect-ratio` 由 `2 / 3` 改 **`13 / 15`**（**高度不变、只放宽**），并在 `.cast-mat-grid` 上方注释里写明「**不要收回到 100px**：100 宽配 150 高看着细长、下面两行字也挤成一团（用户实测反馈）」；再往前那次 2159 → 2164 是**角色卡片墙缩到 100×150**——新增 `.cast-mat-grid`（`repeat(auto-fill, 100px)`，覆盖素材 `.mat-grid` 的 `minmax(158px, 1fr)`）、`.cast-thumb` 的 `aspect-ratio` 由 `4 / 5` 改 **`2 / 3`**、「…」按钮缩到 `top/right: 5px`、动作菜单锚点上移到 `top: 28px` / `right: 5px`；更早那次由 2012 → 2159，是**角色区从「一行一个角色」的 7 列 grid 改成与「项目素材」同一套卡片墙**——新增 `.cast-mat` / `.cast-thumb` / `.cast-more` / `.cast-menu*`，**删掉** `.cast-list` / `.cast-row*` / `.cast-actions` / `.cast-units` / `.cast-file`，并清掉 `.lib-row*` / `.lib-missing` 与那条 `.lib-row input[type="checkbox"]`）

## 1. 作用与职责

| 职责 | 说明 |
| --- | --- |
| 主题变量源 | 在 `:root` 中集中定义背景、品牌色、文字色、辉光、圆角、间距刻度等 CSS 变量（清单见 §2），是全应用配色的唯一出口 |
| 全局重置与骨架 | `*` 归零、`html, body` 的字体族 + **全局字号基准 `font-size: 14px`** + 背景、`#app` 与 `.layout` 的 flex 列布局，决定「标题栏 + 侧栏 + 内容区」三段式结构；并在其后定义**全应用唯一一套滚动条**（`*::-webkit-scrollbar*`，见 §3 样式分区地图与 §6） |
| 通用组件样式 | 卡片、按钮（`.hf-btn`）、文本域、弹窗（`.hf-modal-*`）、进度条、空态提示等跨页面复用类（**下拉不在本文件**：自绘下拉 `HfSelect.vue` 自带 `.hf-sel*` 组件级样式） |
| 页面专有样式 | 首页 Hero 与流水线、HTML 生成工作台（含**项目素材卡片墙**与**角色卡片墙**——两者本来就是同一套 `.mat-*`）、字幕/配音、设置页模型卡片等按注释分节组织 |
| 视觉特效库 | 毛玻璃（`backdrop-filter: blur(12px)`）、霓虹辉光（`text-shadow` / `box-shadow`）、渐变文字、扫描线动画 |

页面与样式节的对应关系（据各 `.vue` 模板实际使用的类名）：

| 页面 / 组件 | 主要依赖本文件的节 |
| --- | --- |
| `App.vue` | 全局骨架 `#app` / `.layout`、`.titlebar*`、`.win-btn`、`.sidebar` / `.menu*`、`.content`；自身另有 `<style scoped>` 定义 `.toast-*` |
| `pages/HomePage/index.vue` | `.hero*`、`.flow-pipeline` / `.flow-node*`、`.metric-*`、`.proj-grid` / `.proj-card*`、`.panel-title` / `.dot` |
| `components/StepBar.vue` | `.project-bar`、`.step-chain`、`.step-node`、`.step-arrow` |
| `pages/HtmlGenPage/index.vue` | `.hgen-*`、`.panel-title` / `.panel-title-sm`、`.proj-*`、`.hg-help*`（行内帮助 `?` 共 4 处：两个动作按钮**内部**各 1 个 + 卡片标题「用法」+ 画布行）、`.hf-*`（动作行按钮、「转视频」弹窗里的档位控件与状态条）；「转视频」弹窗的外壳复用通用弹窗类 `.hf-modal*`；**本页下拉 4 处：字幕（260px）与画布（188px）同一行 + 弹窗里的「质量 / 帧率」2 处**（样式随 `components/HfSelect.vue`） |
| **`pages/HtmlGenPage/MaterialsSection.vue`（本项目素材库，本轮新增）** | **新增节「HTML生成页：项目素材库（图片 / 视频卡片墙）」**：`.mat-grid` / `.mat-card`(+`.off`) / `.mat-thumb`(+`.mat-play`) / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`(+`.on`) / `.mat-del` / `.mat-add` / `.mat-count` / `.panel-title .dot.dot-img`；另复用 `.hgen-block`、`.panel-head` / `.panel-head-actions`、`.panel-title` / `.panel-title-sm`、`.hgen-tip`、`.hf-btn` / `.hf-btn-danger` |
| **`pages/HtmlGenPage/PreviewSection.vue`（预览卡片）** | `.card.hgen-panel` 外壳、`.panel-title`、`.hgen-row`、`.sel-label`、`.hgen-input`（语速输入框）、`.hf-status`（+`.hf-ok` / `.hf-error`）、`.hf-btn`（语速 ± 两个小按钮；**「移除」按钮已删除**）、`.hg-help*`（**只剩「视角比例」行一处 `?`**；背景音频行的已删除）、`.hgen-tip`（`v-show="viewHint"`）、`.empty-hint`、`.hgen-frame-wrap` / `.hgen-frame`、`.hg-prev-*`（播放控制条三件套）、`.rate-spinner`（包裹，本文件无对应规则、样式由内联 `style` 提供）；**背景音频的占满整行下拉（`flex:1`）与「视角比例」下拉**都走 `components/HfSelect.vue`（前者触发器占满整行 ⇒ 弹层也随 `max(触发器宽, 220px)` 变宽）；AI 思考过程块用的是**行内 `style`**（无专有类）。**本组件不用 `.hf-file`、也没有值胶囊类**（值由下拉自己承载），也没有独立的「本地文件…」按钮（并入下拉分组） |
| **`pages/HtmlGenPage/ChapterSection.vue`（章节列表，只读）** | 「HTML生成」页的章节行样式（`.ch-*` 一节）：一行 = 序号 / 标题 / 起止 / 时长 / `pages/cNN.js` / 「改这一章」；列宽 `minmax(0, Nfr)`；另复用 `.hgen-block`、`.panel-head*`、`.panel-title-sm`、`.hgen-tip`、`.ch-sub`、`.hf-btn.ch-pick` |
| **`pages/HtmlGenPage/CastSection.vue` / `CastShot.vue` / `CastLibraryModal.vue` / `CastCreateModal.vue`（「项目素材 · 角色」区 + 预览 + 两个弹窗）** | **节「HTML生成页：角色卡片墙」+「角色预览（静态一帧）」+「全局角色库弹窗：方格网格」+「新建角色成功后」**：角色区**不再有自己的版式**——直接复用素材那一组 `.mat-grid` / `.mat-card` / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`，只加这几样东西：**`.cast-mat`**（卡片级 modifier，`overflow: visible` 让「…」菜单能弹出卡片）+ **`.cast-mat-grid`**（卡片墙容器多加的一个类，把列宽定死 `repeat(auto-fill, 130px)`，素材那张 `.mat-grid` 仍用 `minmax(158px, 1fr)`）+ **`.cast-thumb`**（`13 / 15` 竖版预览位 ⇒ 人物位正好 130×150）+ **`.cast-more`**（右上角「…」按钮）+ **`.cast-menu` / `.cast-menu-item`(+`.danger`)**；`.cast-name` / `.cast-desc` 保留（新建弹窗大图旁边在用）；另有 **`.cast-shot` / `.cast-shot-frame` / `.cast-shot-note` / `.cast-shot.big`（200×260）** + **`.cast-grid` / `.cast-card`（`.on` / `.off`）/ `.cast-card-meta` / `.cast-card-name` / `.cast-card-sub` / `.cast-card-tick` / `.cast-card-missing`** + **`.cast-done` / `.cast-done-info` / `.cast-done-meta`**；另复用 `.hgen-block`、`.panel-head` / `.panel-head-actions`、`.panel-title-sm`、`.hgen-tip`、`.ch-sub` 与 `.hf-modal*`（两个弹窗的外壳） |
| `pages/VideoPreviewPage/index.vue`（视频预览） | `.hf-toolbar`、`.hf-btn*`、`.hf-file`、`.hf-status`、`.hf-video*`、`.hf-tip`、`.card.hgen-panel` 外壳与 `.panel-title`；「预览项目」下拉走 `components/HfSelect.vue` |
| `pages/SubtitlePage/index.vue` / `TranscribeSection.vue` | `.model-*`、`.whisper-*`、`.sub-list` / `.sub-row` 等字幕编辑器类、`.hf-modal-*` |
| `pages/TextTtsPage/index.vue` / `{SynthSection,AlignSection,VoiceSection}.vue` | `.hf-tabs` / `.hf-tab`、`.align-*`、`.sub-textarea`、`.hgen-tip`、`.panel-head*` / `.voice-list*`（音色列表）；各处下拉走 `components/HfSelect.vue` |
| `pages/SettingsPage/components/{ModelSection,VoiceSection,RenderSection,UpdateSection}.vue` / `WhisperSection.vue` / `ChangelogDialog.vue` | `.panel-title`、`.hgen-check`、`.model-card.current` / `.model-badge.current`；「应用更新」区块的排障详情块 `.hf-detail`；更新日志弹窗复用 `.hf-modal-*` 并自带 `.cl-*` 一节 |

## 2. CSS 变量清单

全部定义于 `:root`（设计令牌区，即本文件第一节「深空科技主题（Cyber UI）」）。

| 变量名 | 值 | 用途 |
| --- | --- | --- |
| `--bg-primary` | `#0B1220` | 全局底色、标题栏背景、`body` 渐变的兜底层 |
| `--bg-secondary` | `#111A2C` | 卡片 / 面板 / 下拉框底色 |
| `--bg-sidebar` | `linear-gradient(180deg, #0F172A 0%, #1E293B 100%)` | 左侧菜单栏墨蓝渐变 |
| `--color-primary` | `#00D4FF` | 品牌电子蓝，高亮/选中/链接/焦点态，也是视频素材组的点与「添加」卡片的主色 |
| `--color-secondary` | `#8B5CF6` | 量子紫：**图片素材组的点 `.panel-title .dot.dot-img` 用它**（与视频组的主色点区分），其余处仍直接在渐变里写死 `#8B5CF6` |
| `--color-success` | `#00E5A0` | 数据绿：完成态、成功提示、指标数值 |
| `--color-warning` | `#FFB020` | 信号橙（`.align-badge.warn` 用 `rgba(255,176,32,…)` 直写） |
| `--color-danger` | `#FF4D6D` | 警报红：关闭按钮 hover、删除按钮文字 |
| `--text-primary` | `#E6F1FF` | 冰白正文/标题 |
| `--text-secondary` | `#8A9BB5` | 雾蓝次要文字、说明、占位（也是 `.mat-count` / `.mat-path` / `.mat-add` 的正文色） |
| `--glow-primary` | `0 0 8px rgba(0,212,255,0.6)` | 主色辉光，用于文字阴影与按钮 hover |
| `--glow-card` | `0 0 20px rgba(0,212,255,0.15)` | 卡片边框外发光 |
| `--sidebar-width` | `220px` | 侧栏固定宽度 |
| `--radius-card` | `12px` | 卡片圆角 |
| `--radius-btn` | `8px` | 按钮圆角：`.hg-help-pop` 与 `.hf-detail` 的 `border-radius` 走 `var(--radius-btn)`；素材卡片用的是自己写的 `10px`（`.mat-card` / `.mat-add`）与 `5px`（`.mat-check`） |
| `--space-1` | `4px` | 极小：图标/徽标内距 |
| `--space-2` | `8px` | XS：行内 gap、小标题与内容之间（**`.mat-grid` 的上边距也用它**） |
| `--space-3` | `12px` | SM：控件行、字段之间、反馈区上方 |
| `--space-4` | `16px` | MD：卡片之间、card 内主区块之间 |
| `--space-5` | `24px` | LG：大区块、指标区上端 |
| `--space-6` | `32px` | XL：页面级大分区 |
| `--spacing-base` | `8px` | 间距基准，兼容旧写法（定义但未通过 `var()` 引用） |

间距规范（源码注释原文）：区块/区块用 MD；控件行内用 SM；标题下用 XS；页面大分区用 LG/XL。

**字号没有 CSS 变量**：`:root` 里不存在任何字号令牌，字号一律直接写 px；全局基准 14px 写在 §3「全局骨架」的 `html, body` 规则里，档位划分与「承载文字的元素必须显式落在某一档」的约定见 `src/renderer/agents.md` §3.1 / §3.2。素材卡片里的字号同理直接写：`.mat-name` / `.mat-path` / `.mat-add` / `.mat-count` 分别落在 12px / 11px 两档。

## 3. 样式分区地图

按文件中的 `/* ===== xxx ===== */` 注释分节整理。**一律不标行号**：行号随迭代持续漂移；节标题与出现顺序才是稳定坐标。

| 节标题（注释原文） | 主要选择器 | 说明 |
| --- | --- | --- |
| （无注释）基础重置 | `*` | `margin/padding` 归零，`box-sizing: border-box` 全局盒模型 |
| 深空科技主题（Cyber UI） | `:root` | 全部设计令牌，含 4px 基准的间距刻度注释 |
| （无注释）全局骨架 | `html, body`、`body`、`#app`、`.layout` | 字体族 + **全局字号基准 `font-size: 14px`**；`body` 叠两层径向渐变；`#app` 承接 flex 列布局，`.layout` 为 `flex:1; min-height:0` 的可滚动宿主 |
| **全局滚动条（唯一真源）** | `*::-webkit-scrollbar`、`*::-webkit-scrollbar-track`、`*::-webkit-scrollbar-thumb`(+`:hover`)、`*::-webkit-scrollbar-corner` | 写在 `html, body` 之后、`body` 之前，全应用**唯一一套**：宽高 8px、轨道与角落透明、`border-radius: 999px` 的滑块 `rgba(0,212,255,.25)`、悬停 `rgba(0,212,255,.45)`。所有滚动容器一律靠 `*` 通配继承（含 Teleport 到 `<body>` 的弹层，以及 `.content` / `.sub-list` / `.voice-list-body`），**不再给任何单个容器写 `::-webkit-scrollbar`**；**全局不写 `scrollbar-width` / `scrollbar-color`**——Chromium 里这两个标准属性会顶掉伪元素效果、退回默认灰白条 |
| 自绘标题栏（深空科技风格） | `.titlebar*`、`.win-btn`、`.win-close` | 40px 高；`-webkit-app-region: drag`；`.win-close:hover` 变警报红 |
| 左侧菜单（文字菜单） | `.sidebar`、`.logo`、`.menu*` | 220px 宽墨蓝渐变；选中态 3px 电子蓝左边框 + 90° 渐隐高亮 |
| 右侧内容区 | `.content*`、`.content h1`、`.content p` | `padding:32px`；滚动条继承全局那一套（8px 主色滑块，本容器不写 `::-webkit-scrollbar`）；`h1` 24px 带辉光 |
| （无注释）卡片 / 面板（毛玻璃） | `.card` | `--bg-secondary` 底 + 半透明描边 + `--radius-card` + `backdrop-filter: blur(12px)` |
| 首页 Hero 横幅 | `.hero*`、`@keyframes heroScan` / `heroFlow` | 双色渐变 + 扫描光带 + 渐变流光标题 |
| 流水线节点卡片 | `.flow-pipeline`、`.flow-node*`、`.flow-arrow` | hover 上浮 4px 并叠加双层辉光 |
| 数据指标卡 | `.metric-grid`、`.metric-card`、`.metric-value`、`.metric-label` | 4 列 grid；指标卡描边/辉光用数据绿 |
| 首页 · 我的项目卡片（只选择 / 打开，新建入口在顶部工作项目栏） | `.proj-grid`、`.proj-card*` | `repeat(auto-fill, minmax(220px, 1fr))` 卡片网格 |
| 预览 / HyperFrames 转视频 | `.hf-toolbar`、`.hf-btn*`、`.hf-file`、`.hf-status`(+`.hf-ok` / `.hf-error`)、`.hf-detail`、`.hf-video*`、`.hf-tip` | 全应用主按钮体系与状态行：`.hf-btn-primary` hover **必须重写 `background`**（特异性 0,3,0 的基础 hover 会顶掉渐变）；`.hf-btn-danger` 紧随 `.hf-btn-primary:hover` 之后（靠「写在后面」取胜）；`.hf-detail` 紧跟 `.hf-status.hf-error` 定义。现由 `pages/VideoPreviewPage/index.vue`（工具栏 / 播放器 / 定位按钮 / 状态条）、**`pages/HtmlGenPage/PreviewSection.vue`（状态条 `.hf-status`、两个动作按钮 `.hf-btn` / `.hf-btn-danger`）**、`pages/HtmlGenPage/index.vue`（动作按钮与弹窗档位控件）与 `pages/SettingsPage/components/UpdateSection.vue`（状态行与 `.hf-detail`）共同使用 |
| 项目链路状态条（贯通各页，两行：上流程链 / 下工作项目切换） | `.project-bar*`、`.step-chain`、`.step-node*`、`.step-arrow` | 胶囊节点 + 圆点状态机（灰 / 绿 / 蓝脉冲） |
| 配音页 Tab 切换 | `.hf-tabs`、`.hf-tab` | 999px 胶囊 Tab |
| HTML 生成页（与紧随其后的「行内帮助」小节交错） | `.hgen-grid`、`.panel-title`、`.panel-title .dot`、`.hgen-subtitle`、`.hgen-input`、`.hgen-row`、`.hgen-actions`、`.hgen-tip` | 面板标题带发光小圆点（`.panel-title` / `.dot` 已全局化）；`.hgen-subtitle` 为 260px 高文本域。**注意**：本节规则被下面「行内帮助」小节从中间分开 |
| 行内帮助：`?` 图标 + 悬浮说明（**默认**放在按钮内部：每个动作各带一个 `?`；HtmlGenPage 另在卡片标题「用法」与画布行各挂一个**非按钮锚点**） | `.hg-help*` | 16px 圆形 `?` + 320px 悬浮气泡；默认 `opacity:0` + `visibility:hidden` + `pointer-events:none`；气泡位于 `<button>` 内故重置排版（标题那处的锚点落在带 `2px` 字距的 `.panel-title` 里，改用内联 `letter-spacing:0` 覆盖） |
| HTML 工作台：分区小标题 + 源码编辑器 | `.panel-title-sm`、`.hgen-source*` | 通用小标题（主色 13px 600）；源码编辑器 `min-height:320px`、Consolas、`resize: vertical` |
| 项目详情小卡 | `.proj-meta`、`.proj-stat`(+`.on`) | `auto-fit, minmax(130px, 1fr)` 自适应栅格；`.on` 切数据绿（HTML生成页的「素材」格就落在这里） |
| 预览画布 | `.hgen-frame-wrap`、`.hgen-frame` | **这里只是「默认值（横屏）」的占位**：容器 `padding-bottom:56.25%`（16:9）与 iframe 的 `1920px × 1080px` 都保持原值不变，但**挂载后一律被 `pages/HtmlGenPage/PreviewSection.vue` 的内联样式覆盖**——容器改绑 **`frameStyle`**（**高度上限 800px、宽度 = `min(100%, round(800 × 宽/高)px)`、高度由 `aspect-ratio` 撑、`paddingBottom` 内联设成 `'0'`**，即 CSS 那套 `padding-bottom` 留位技巧被彻底旁路；宽窗口下 16:9 → **1422×800**、9:16 → **450×800**、1:1 → **800×800**，窄窗口宽度退 `100%`、高度按比例降），iframe 的宽高绑定 **`pageBox`**（**页面自己声明的画布**：`pageCanvas` 经 `project:preview-html` 从原 HTML 的 `<html data-resolution>` 带回，无声明时回落项目当前画布；像素见 `shared/constants.ts` 的 `CANVAS_SIZES`；**视角比例不改 iframe 尺寸**）。`transform-origin: 0 0` 不变、`transform` 仍由 JS 设，是 **contain**：`min(容器宽/页面宽, 容器高/页面高)` + `translate` 居中。**容器本身水平居中**：本文件给 `.hgen-frame-wrap` 新加了 **`margin-inline: auto`**（宽度由内联 `frameStyle` 决定，小于可用宽度时左右均分余量；宽度吃满时 margin 为 0 等于没变），否则预览会贴左、右边空一大块（9:16 最明显）。源码注释已把这层语义写明：**预览 iframe 的视口 = 页面原生画布**，本文件里的 16:9 / 1920×1080 只在组件挂载前占位 |
| 预览播放控制条（进度条 + **一个三态键** + 时间） | `.hg-prev-ctl`、`.hf-btn`（三态键）、`.hg-prev-bar`(+`.seeking`)、`.hg-prev-track`、`.hg-prev-bar-fill`、`.hg-prev-time`、`.hg-prev-hint`、`.empty-hint` | `.hg-prev-bar` 是**可点可拖的跳转热区**（`padding:5px 0`，视觉厚度仍是 8px）；`.hg-prev-track` 用 `box-shadow: inset 0 0 0 1px …` 当描边；`.seeking` 时关掉填充的 0.25s 补间；`.hg-prev-hint` 是「已暂停在第 0 帧…」的说明文字。**按钮只剩一个**（暂停 / 播放 / 重新播放三态，由组件内的 `prevToggleText` / `prevToggleTitle` 决定文案，样式仍复用全局 `.hf-btn`；原「重新播放」独立按钮已删除）。**使用方现为 `pages/HtmlGenPage/PreviewSection.vue`**（整块随预览卡片搬出 `index.vue`） |
| 首页流水线节点状态 | `.flow-node.flow-done`、`.flow-badge` | 完成节点绿描边；绿色胶囊徽标 |
| HTML 生成/修改：需求输入区块 + 设置页复选框 | `.hgen-block`、`.hgen-check` | 区块上边距统一 `--space-4`；复选框 `accent-color: var(--color-primary)` |
| 字幕生成（whisper.cpp）：模型档位卡片 | `.model-grid`、`.model-card*`、`.model-*` | `auto-fill, minmax(210px,1fr)` 栅格；已下载态整卡转绿 |
| 字幕生成（whisper.cpp）：下载进度条 | `.whisper-bar*` | 三态配色：默认蓝、错误红、完成绿 |
| 字幕写入方式切换（逐条编辑 / 纯文本）与纯文本域 | `.sub-mode-btn.active`、`.sub-textarea` | `.active` 追加 25% 蓝底与辉光 |
| 字幕生成（whisper.cpp）：转录状态 | `.whisper-tip*` | 低透明度说明文字 |
| （注释）选中态：当前转录所用模型档位 | `.model-card.selected*` | 双层描边 + 辉光 + `::after` 生成右上角「转录使用」标签 |
| 设置页：语音识别模型 | `.model-card.current*` | 当前生效项蓝描边；徽标反色 |
| 字幕编辑器：条目列表 | `.sub-list*`、`.sub-row*`、`.sub-*` | 列表 `max-height:420px` 区内滚动；每行 = 序号 + 起止时间 + 文本域 + 删除 |
| 配音页：我的音色列表 | `.panel-head*`、`.voice-list*`、`.voice-*` | 通用「标题 + 右侧动作」头行 + 4 列 grid 列表（列宽必须 `minmax(0, Nfr)`） |
| 通用弹窗（转录弹窗） | `.hf-modal-*`、`.tw-*` | 固定遮罩 `z-index:9000`；使用方含转录 / 转视频 / 创建克隆音色 / 设置页的「自定义更新源」弹窗与**更新日志弹窗**。**凡挂在 `.card` 内的使用方都必须整块 `Teleport` 到 `<body>`**（设置页那两个就是：`UpdateSection.vue` 的「自定义更新源」与 `ChangelogDialog.vue` 的更新日志）——`.card` 的 `backdrop-filter` 会让 `.hf-modal-mask` 的 `position:fixed` 相对卡片解析，蒙层只盖住卡片、弹窗按卡片居中（见 §6）。**`.hf-modal-body` 带 `min-height: 0`**（2026-10 补）：`.hf-modal` 是 column flex + `max-height:86vh` + `overflow:hidden`，子项默认 `min-height:auto` 会拒绝收缩 ⇒ 内容一长整个弹窗被撑到上限、超出部分被裁掉；归零后 body 才会在自己内部滚动（见 §3.1） |
| 设置页：左侧分类 + 右侧内容 | `.settings-layout`、`.settings-nav*`、`.settings-content` | 页面内局部导航：150px 分类列 + 内容区 |
| **更新日志弹窗（设置 → 应用更新 →「查看更新日志」）** | **`.cl-ver`、`.cl-list`、`.cl-item`、`.cl-item-title`、`.cl-date`、`.cl-count`、`.cl-tag`(+`.cl-tag-ok` / `.cl-tag-err` / `.cl-tag-warn`)、`.cl-more`、`.cl-hist`、`.cl-hist-head`(+`:hover`)、`.cl-hist-body`、`.cl-hist-block`、`.cl-hist-ver`(+`:hover`)、`.cl-hist-name`、`.cl-caret`** | 随包 `CHANGELOG.md` 的「最新一版」：一行版本 + 时间（`.cl-ver`）+ 每条一行「`[标签]` 标题」（`.cl-item`）；「展开全部 N 条」按钮占一行（`.cl-more`）；旧版收进默认折叠的「历史版本（N）」区（`.cl-hist*`：整区一个 `button.cl-hist-head`，展开后每版一行 `button.cl-hist-ver`，再点才列该版条目）。**条目一律不截断**：`.cl-item-title` 用 `word-break: break-word` + `min-width: 0`，长了自然换行（界面不给悬浮提示，截断就等于丢字）。字号走设计规范刻度：版本行与条目标题 13px、时间与条数 12px、标签徽标 11px（走成功 / 危险 / 警告三色）。**使用方只有 `pages/SettingsPage/components/ChangelogDialog.vue`**（详见 3.3） |
| （注释）转录无百分比进度：不确定态条纹滑动 | `.whisper-bar.indeterminate .whisper-bar-fill` | 宽度锁定 38%（`!important`）+ 1.1s 往返平移 |
| 字幕配音（逐句对齐）：结果明细 | `.align-row*`、`.align-*`、`@keyframes whisper-slide` | 单行结果行 + 正常/告警徽标 |
| **HTML生成页：项目素材库（图片 / 视频卡片墙）（本轮新增，排在文件末尾）** | **`.mat-grid`、`.mat-card`(+`.off`)、`.mat-thumb`(+`.mat-play`)、`.mat-meta`、`.mat-name`、`.mat-path`、`.mat-check`(+`.on`)、`.mat-del`、`.mat-add`、`.mat-count`、`.panel-title .dot.dot-img`** | 缩略图卡片墙：勾选框与「移除」叠在卡片两角；未勾选整卡压暗（`.off`）但仍可操作；列宽 `auto-fill + minmax(158px, 1fr)`，窄窗自动减列。**使用方只有 `pages/HtmlGenPage/MaterialsSection.vue`**（详见 3.2） |
| **HTML生成页：章节列表行（`.ch-*`，本轮新增，排在文件末尾）** | **`.ch-*`（章节列表行样式）** | 「HTML生成」页的只读章节列表：一行 = 一章（序号 / 标题 / 起止 / 时长 / `pages/cNN.js` / 「改这一章」）；**列宽用 `minmax(0, Nfr)`**。使用方只有 `pages/HtmlGenPage/ChapterSection.vue`（详见 3.4） |
| **HTML生成页：角色卡片墙 + 全局角色库弹窗（`.cast-*`，排在文件末尾）** | **`.cast-mat`、`.cast-mat-grid`、`.cast-thumb`、`.cast-more`、`.cast-menu` / `.cast-menu-item`(+`.danger`)、`.cast-name`、`.cast-desc`；`.cast-shot*`、`.cast-grid`、`.cast-card*`、`.cast-done*`** | 「HTML生成」页的「项目素材 · 角色」块与它的两个弹窗：**角色区与「项目素材」同一套卡片墙**——每张卡 = 左上角**勾选框**（复用 `.mat-check`）+ 右上角**「…」菜单**（三个动作：存为全局 / 改这个角色 / 移除）+ **`13:15` 竖版预览位（130×150）** + **名字 / `高几 u · 描述`**（复用 `.mat-name` / `.mat-path`）；未勾选整卡加 `.mat-card.off`。区别只有两处：**列宽定死 130px**（容器多挂一个 `.cast-mat-grid`，素材那张 `.mat-grid` 仍是 `minmax(158px, 1fr)`）、**预览位是 `13 / 15` 而不是素材的 16:9**。**卡片上不显示文件路径 `cast/<id>.js`**。使用方只有 `pages/HtmlGenPage/CastSection.vue`（详见 3.5） |

> **toast**（`.toast-host` / `.toast-item`）定义在 `App.vue` 的 `<style scoped>` 中，不在本文件。下拉控件 `.hf-sel*` 在 `components/HfSelect.vue` 内（含一个**非 scoped** 的 `<style>` 块，因为弹层经 Teleport 挂到 `body`），本文件无下拉选择器。

### 3.1 关键实现片段

首页 Hero 的扫描光带与渐变流光标题（节：**首页 Hero 横幅**；以下两条规则与 `main.css` 逐字一致）：

```css
.hero::after {
  content: '';
  position: absolute;
  top: -60%;
  left: -10%;
  width: 60%;
  height: 220%;
  background: linear-gradient(105deg, transparent 40%, rgba(0, 212, 255, 0.18) 50%, transparent 60%);
  animation: heroScan 4s linear infinite;
  pointer-events: none;
}
.hero h1 {
  margin-bottom: 8px;
  font-size: 28px;
  letter-spacing: 1px;
  background: linear-gradient(90deg, #00D4FF, #8B5CF6, #00D4FF);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: heroFlow 6s linear infinite;
}
```

两行的用意（源码未写行内注释，此处仅作讲解）：`.hero::after` 的 `pointer-events: none` 让斜向扫描光带不遮挡内部按钮点击；`.hero h1` 的 `-webkit-background-clip: text` + `-webkit-text-fill-color: transparent` 是渐变文字必备的「双写」，缺任一条都会退回实色文字。

排障详情块（节：**预览 / HyperFrames 转视频**，紧跟在 `.hf-status.hf-error` 之后）：

```css
/* 排障详情块（当前用于「设置 → 应用更新」的「查看详情」）：
   等宽 + 可换行 + 可选中复制 —— 内容是原始报错（HTTP 状态 / AccessDenied 原文 / URL），
   默认折叠，只有出错时才出现，故用比正文更弱的色阶，避免抢状态行的视线 */
.hf-detail {
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: var(--radius-btn);
  background: rgba(11, 18, 32, 0.6);
  font-family: "JetBrains Mono", "Consolas", monospace;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
```

通用弹窗体 `.hf-modal-body` 的收缩修复（节：**通用弹窗（转录弹窗）**）：

```css
.hf-modal-body {
  padding: 18px;
  overflow: auto;
  /* 必需：.hf-modal 是 column flex，子项默认 min-height:auto（=内容高度）⇒ 内容一长，body 拒绝收缩，
     整个弹窗被撑到 max-height 且内容被 .hf-modal 的 overflow:hidden 裁掉（关闭按钮都跑到可视区外，
     用户反馈「更新日志顶到头部去了」就是这么来的）。归零后 body 才会在自己内部滚动。 */
  min-height: 0;
}
```

这是一处**共用类的真 bug 修复**（不只是为更新日志弹窗加的）：`.hf-modal` 自己写着 `max-height: 86vh` + `overflow: hidden`，配上不再收缩的 body，**任何长内容弹窗**都会「头部与底部被吃掉」。根因是 flex 子项的默认 `min-height: auto`（= 内容高度）会阻止收缩；`min-height: 0` 是标准解法，**不需要改 `.hf-modal` 自己**。

### 3.2 项目素材库卡片墙（本轮新增节）

节的注释头与网格（源码原文）：

```css
/* ===== HTML生成页：项目素材库（图片 / 视频卡片墙） =====
   素材以缩略图卡片呈现，勾选框与「移除」叠在卡片左上 / 右上角：
   勾选决定「本次生成交给 Agent 的素材」，未勾选的卡片整体压暗（.off）但仍可操作。
   列宽用 auto-fill + minmax：窄窗自动减列，不出现横向滚动。 */
.mat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 12px;
  margin-top: var(--space-2);
}
```

两角按钮的定位（源码原文）：

```css
/* 勾选框与「移除」键叠在卡片左上 / 右上角（两者都直接写在按钮上，不是包一层容器）：
   z-index 是保险——缩略图在正常流里，绝对定位的按钮本就在它之上，显式抬一层免得将来加装饰元素时被盖住。 */
.mat-check, .mat-del { position: absolute; top: 7px; z-index: 1; }
.mat-check { left: 7px; }
.mat-del { right: 7px; }
```

其余要点（逐条对应源码注释）：

| 选择器 | 要点 |
| --- | --- |
| `.mat-card` | `position: relative` + 1px 半透明主色描边 + `10px` 圆角 + `overflow: hidden` + 深底 `rgba(10,17,32,.72)`；`transition: border-color .2s ease, opacity .2s ease`；`:hover` 描边变亮 |
| `.mat-card.off` | 未勾选：`opacity: .5`——**不是禁用**，勾选框与文件名仍要看得清 |
| `.mat-thumb` | `aspect-ratio: 16 / 9` 黑底居中；内部 `img` 满铺 `object-fit: cover` |
| `.mat-thumb .mat-play` | 视频不抽帧，统一用 `▶` 字符标记（源码注释：抽帧要额外依赖，收益不抵成本），主色 + `--glow-primary` |
| `.mat-meta` / `.mat-name` / `.mat-path` | 文件名 12px 冰白单行省略；相对路径 11px 等宽雾蓝（与「我的音色」列表的次要列同一档位），均带 `text-overflow: ellipsis` |
| `.mat-check` | 18×18 圆角方块；`:hover:not(:disabled)` 描边变主色；`.on` 态换蓝紫渐变底、透明描边；`:disabled` 时 `cursor: not-allowed` + `opacity: .6` |
| `.mat-del.hf-btn` | 卡角上的「移除」键比常规 `.hf-btn` 小一号（`padding: 2px 7px; font-size: 11px; border-radius: 6px`），避免盖住缩略图 |
| `.mat-add` | 每组末尾的虚线占位卡片：`min-height: 132px`、`1px dashed rgba(0,212,255,.3)`、`10px` 圆角；`i` 是主色 `＋`；`:hover:not(:disabled)` 描边转主色、文字转冰白 |
| `.mat-count` | 标题旁的小字（「勾选的会随需求一起交给 Agent」/「n / 20」）：12px、字重 400、字距 0、雾蓝 |
| `.panel-title .dot.dot-img` | 图片组的点用辅色（量子紫）+ 同色 `box-shadow`，与视频组的主色点区分 |

> **为什么缩略图走 `hgpreview://`**：素材 `file` 是项目内相对引用，dev 态 http 页面下 `file://` 图片会被 Chromium 拦截；`MaterialsSection.vue` 的 `thumbUrl()` 调 `src/renderer/src/utils/url.ts` 的 `previewUrl(项目名, file)` 拼出 `hgpreview://p/<逐段编码的相对路径>`（**逐段 `encodeURIComponent`、斜杠保持原样**，与主进程按段 decode 对应），因此 `src/renderer/index.html` 的 CSP 必须在 `img-src` 里放行 `hgpreview:`（该节注释也指明了这一点）。视频卡片只是 `▶` 文本，不产生媒体请求。

### 3.3 更新日志弹窗（`.cl-*`）

节的注释头、最新一版抬头与条目行的完整规则（源码原文）：

```css
/* ===== 更新日志弹窗（设置 → 应用更新 →「查看更新日志」）=====
   内容来自随包的 CHANGELOG.md，界面只要三样：版本 / 时间 / 每条一行标题。
   字号走设计规范刻度：版本行与条目标题 13px、时间与条数 12px、标签徽标 11px */
.cl-ver {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid rgba(0, 212, 255, 0.18);
}
.cl-list { padding: 2px 0; }
/* 一行一条：标题长了自然换行（不截断——界面不给悬浮提示，截断就等于丢字） */
.cl-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}
.cl-item-title { min-width: 0; word-break: break-word; }
.cl-date { flex: none; font-size: 12px; font-weight: 400; color: var(--text-secondary); }
```

标签徽标与「历史版本」区（源码原文）：

```css
.cl-tag {
  flex: none;
  padding: 0 6px;
  border: 1px solid rgba(138, 155, 181, 0.5);
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.cl-tag-ok { color: var(--color-success); border-color: rgba(0, 229, 160, 0.5); }
.cl-tag-err { color: var(--color-danger); border-color: rgba(255, 77, 109, 0.5); }
.cl-tag-warn { color: var(--color-warning); border-color: rgba(255, 176, 32, 0.5); }
.cl-more { padding: 6px 0 2px; }
/* 历史版本：整区默认折叠（否则 25 + 4 + 4 条又会把弹窗顶满），展开后每版一行、点开才列条目 */
.cl-hist {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid rgba(0, 212, 255, 0.18);
}
```

其余要点：

| 选择器 | 要点 |
| --- | --- |
| `.cl-ver` | 最新一版抬头：`space-between` 把「版本：…」与 `.cl-date`「时间：…」推到两端；下描边 `rgba(0,212,255,.18)` 与「历史版本」区的上描边呼应 |
| `.cl-list` | 条目列表容器：`padding: 2px 0`；**在历史版本块里被覆盖**为 `.cl-hist-block .cl-list { padding: 0 10px var(--space-2) }`（缩进对齐） |
| `.cl-item` | 一行一条：`display: flex` + `align-items: baseline` + `gap: 8px`；13px / 行高 1.7 / 冰白 |
| `.cl-item-title` | `min-width: 0` + `word-break: break-word`——**源码注释写明不截断**（界面不给悬浮提示，截断就等于丢字），长了自然换行；**不用 `break-all`**，免得把正常单词也切断 |
| `.cl-date` / `.cl-count` | 时间与「N 条」：`flex: none` + 12px + 字重 400 + 雾蓝（`.cl-count` 只出现在历史版本的单版行里） |
| `.cl-tag` | 11px 胶囊徽标（`border-radius: 999px` + 雾蓝描边）；`.cl-tag-ok` / `.cl-tag-err` / `.cl-tag-warn` 分别取数据绿 / 警报红 / 信号橙的文字与描边，档位由解析器的 `tagKind()` 给出 |
| `.cl-more` | 「展开全部 N 条」按钮占的那一行：`padding: 6px 0 2px`（按钮本身是通用 `.hf-btn`） |
| `.cl-hist` | 「历史版本」整区：上描边 + `margin-top: var(--space-3)` + `padding-top: var(--space-2)`，与最新一版视觉分区 |
| `.cl-hist-head` | 整区折叠头，整行 `button`：13px 600 冰白、底色 `rgba(0,212,255,.06)`、`--radius-btn` 圆角；`:hover` 提到 `rgba(0,212,255,.12)` |
| `.cl-hist-body` | `padding-top: 6px`；显隐由组件的 `v-show="historyOpen"` 控制（**默认整区折叠**） |
| `.cl-hist-block` | 单个历史版本：`margin-bottom: var(--space-2)` + 1px 半透明主色描边 + `--radius-btn` 圆角 + `overflow: hidden` |
| `.cl-hist-ver` | 单版行的整行 `button`：13px 冰白、透明底；`:hover` 加 `rgba(0,212,255,.08)` 底 |
| `.cl-hist-name` | `flex: 1; min-width: 0`（版本标题可压缩，不撑破行） |
| `.cl-caret` | 展开 / 收起箭头：`flex: none; width: 12px`，主色；字符 `▾` / `▸` 由组件按展开态给（整区头与单版行共用同一个类） |

> `.cl-*` 与 `Clang` 之类无关，是「changelog」的缩写；它只服务设置页的更新日志弹窗，**一行几条、折叠与否、箭头字符全部由 `ChangelogDialog.vue` 的模板与 `utils/changelog.ts` 的解析结果驱动**（`v-show` + `historyOpen` / `histOpen` 控制展开，实例见 [SettingsPage.md](./pages/SettingsPage.md) §4.6）。本组样式**不含 `code` / 链接 / 富文本相关规则**——条目是纯文本渲染，没有 `v-html`。

### 3.4 章节列表行（`.ch-*`）

「HTML生成」页的只读章节列表（`pages/HtmlGenPage/ChapterSection.vue`）专用的一节，排在本文件末尾：

- 一行 = 一章：序号 / 标题 / 起止场景 / 时长 / `pages/cNN.js` + 一个「改这一章」按钮；
- **列宽用 `minmax(0, Nfr)`**——与素材网格 / 音色列表同一取舍（写 `minmax` 而不是纯 `fr`）；
- 只读列表：点「改这一章」只是把「只改第 N 章（pages/cNN.js）：」填进「需求描述」，列表本身不发起生成 / 修改；
- 使用方只有 `ChapterSection.vue`。

### 3.5 「角色」区、预览与两个弹窗（`.cast-*`）

「HTML生成」页的「项目素材 · 角色」区（`pages/HtmlGenPage/CastSection.vue`）、预览组件（`CastShot.vue`）与两个弹窗（`CastLibraryModal.vue` / `CastCreateModal.vue`）共用的一节，排在本文件**最末尾**（紧接章节列表 `.ch-*` 之后）。这一节分三轮变过：先是角色区从「一行一个角色的 7 列 grid」换成**与「项目素材」完全同一套卡片墙**（人物在上、名字在下、勾选框在左上、三个动作收进右上「…」菜单），本节只剩 `.cast-mat` / `.cast-thumb` / `.cast-more` / `.cast-menu*` 四个东西、其余全部复用素材那一节；随后卡片**整体缩一号**——人物格从「弹性列宽（`minmax(158px, 1fr)`）+ `4 / 5`」缩成「**定死 100px + `2 / 3`**」，人物位 **100×150**：新增 **`.cast-mat-grid`**（只覆盖列宽，把 `.mat-grid` 的 `minmax(158px, 1fr)` 换成定死 `100px`，`display: grid` 与 `gap` 仍来自 `.mat-grid`）、`.cast-thumb` 的 `aspect-ratio` 由 `4 / 5` 改 **`2 / 3`**、「…」按钮与动作菜单各缩一号且菜单锚点上移；**本轮再把格子从 100×150 放宽到 130×150**（用户反馈「被挤扁了，太窄了」——100 宽配 150 高看着细长、下面两行字也挤成一团）：`.cast-mat-grid` 列宽改 **130px**、`.cast-thumb` 的 `aspect-ratio` 改 **`13 / 15`**（**高度不变、只放宽**），并在 `.cast-mat-grid` 上方注释里写明**不要收回 100px**；`.cast-more` / `.cast-menu` / `.cast-name` / `.cast-desc` 都没动。后面「角色预览（静态一帧）」「全局角色库弹窗：方格网格」「新建角色成功后」三段**这两轮都未动**（`.cast-card` 的 100%×132 与 `.cast-shot.big` 的 200×260 都不受影响）。

节的注释头，以及卡片 / 列宽 / 预览位 / 「…」按钮 / 动作菜单（以下与 `main.css` 逐行一致；**列宽是本节唯一多出来的一条**——`.cast-mat-grid` 只覆盖列宽，`display: grid` 与 `gap` 仍来自素材卡片墙的 `.mat-grid`）：

```css
/* ===== HTML生成页：角色卡片墙（「项目素材 · 角色」）=====
   与图片 / 视频素材同一套 `.mat-grid` / `.mat-card`：**人物在上面、名字在下面**，
   勾选框在左上角、三个动作（存为全局 / 改这个角色 / 移除）收进右上角的「…」菜单。
   角色与素材本来就是同一类东西（项目资产），版式也跟着一样，扫起来不用换一套眼睛。 */

/* 卡片本身不裁剪：「…」菜单要从卡片里弹出去（`.mat-card` 默认 overflow:hidden 会把它切掉），
   圆角与裁切交给下面的 .cast-thumb 自己做 */
.cast-mat { overflow: visible; }

/* 角色卡片比素材卡**小一号**：列宽定死 130px（素材那张 `.mat-grid` 是 minmax(158px, 1fr) 的弹性列），
   一屏能并排放下更多角色；配合下面 13:15 的预览位，人物位正好 130×150。
   **不要收回到 100px**：100 宽配 150 高看着细长、下面两行字也挤成一团（用户实测反馈）。 */
.cast-mat-grid { grid-template-columns: repeat(auto-fill, 130px); }

/* 预览位：角色是竖构图（8u 高的人 vs 约 4u 宽），13:15（130×150）比素材的 16:9 更省横向空间、人也更完整。
   底色 #EEF2F7 与预览页一致（深色勾边 / 浅色皮肤在深底上会糊成一片） */
.cast-thumb {
  aspect-ratio: 13 / 15;
  overflow: hidden;
  border-radius: 10px 10px 0 0;
  background: #EEF2F7;
}
.cast-thumb .cast-shot { width: 100%; height: 100%; border: 0; border-radius: 0; }

/* 右上角「…」：与素材卡的「移除」同位置，但比它再小一号（卡片只有 130px 宽，按钮不能占太多） */
.cast-more.hf-btn {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 2;
  padding: 1px 6px;
  font-size: 12px;
  line-height: 1.3;
  border-radius: 5px;
}

/* 动作菜单：锚在「…」下方展开（z-index 抬过相邻卡片；点菜单外面收起，逻辑在 CastSection）。
   卡片 130px 宽 + 菜单 118px + right:5px ⇒ 菜单整个落在卡片内，不会探到相邻卡片上 */
.cast-menu {
  position: absolute;
  top: 28px;
  right: 5px;
  z-index: 20;
  min-width: 118px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 255, 0.35);
  background: rgba(11, 18, 32, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.cast-menu-item {
  display: block;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.cast-menu-item:hover:not(:disabled) { background: rgba(0, 212, 255, 0.12); }
.cast-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
/* 「移除」是危险动作：文字与 hover 底色都走警报红 */
.cast-menu-item.danger { color: var(--color-danger); }
.cast-menu-item.danger:hover:not(:disabled) { background: rgba(255, 77, 109, 0.14); }

/* 名字 / 描述（新建角色弹窗里的大图旁边也在用） */
.cast-name {
  color: var(--color-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cast-desc {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**角色预览（源码原文）**——卡片预览位、全局库网格与大图共用同一个组件，尺寸全由外层决定（`.cast-thumb .cast-shot` / `.cast-card .cast-shot` / `.cast-shot.big`）：

```css
/* ===== 角色预览（静态一帧） =====
   角色不是图片而是绘制代码（cast/<id>.js 里 window.__cast[id] = function (x, y, u, o) {…}），
   预览由主进程拼好的 cast-preview/<来源>-<id>.html 在 iframe 里把它**真画一遍**得到
   （见 main/cast/preview.ts）。底色用浅灰：角色多为深色勾边 / 浅色皮肤，深色底会糊成一片。
   iframe 一律 pointer-events:none：点缩略图要穿透到卡片 / 行本身，预览窗口里没有可交互的东西。 */
.cast-shot {
  position: relative;
  flex: none;
  width: 56px;
  height: 72px;
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 8px;
  overflow: hidden;
  background: #EEF2F7;
}
.cast-shot-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #EEF2F7;
  pointer-events: none;
}
.cast-shot-note {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 4px;
  font-size: 11px;
  color: #6B7A90;
  text-align: center;
}
/* 弹窗里的大图（新建角色成功后） */
.cast-shot.big { width: 200px; height: 260px; border-radius: 10px; }
```

**全局角色库弹窗的方格网格（源码原文）**：

```css
/* ===== 全局角色库弹窗：方格网格 =====
   挑角色看的是长相，所以一格一张预览；描述 / 身高退到格子的 title 悬浮提示，不占格子。
   列宽用 auto-fill + minmax：窄窗自动减列，不出现横向滚动（与素材卡片墙同一套写法）。 */
.cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
  margin-top: var(--space-2);
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 2px;
}

.cast-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 212, 255, 0.14);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(10, 17, 32, 0.72);
  cursor: pointer;
  transition: border-color 0.2s ease, opacity 0.2s ease;
}
.cast-card:hover:not(.off) { border-color: rgba(0, 212, 255, 0.45); }
/* 选中：主色描边 + 卡片辉光（与素材卡片的选中态同一套语言） */
.cast-card.on { border-color: var(--color-primary); box-shadow: var(--glow-card); }
/* 库里有索引、文件不在：整格压暗且不可点 */
.cast-card.off { opacity: 0.5; cursor: not-allowed; }
/* 格子里的预览撑满卡片宽度（高度固定，保证每格一样高） */
.cast-card .cast-shot {
  width: 100%;
  height: 132px;
  border: 0;
  border-bottom: 1px solid rgba(0, 212, 255, 0.08);
  border-radius: 0;
}
.cast-card-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 8px 8px;
}
.cast-card-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cast-card-sub {
  flex: none;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: "JetBrains Mono", "Consolas", monospace;
}
.cast-card-tick {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #03131a;
  background: var(--color-primary);
  box-shadow: var(--glow-primary);
}
.cast-card-missing {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-warning);
  background: rgba(11, 18, 32, 0.82);
}
```

**新建角色成功后的大图区（源码原文）**：

```css
/* ===== 新建角色成功后（弹窗里）：左边大图预览、右边名字与落地信息 ===== */
.cast-done { display: flex; gap: 14px; align-items: flex-start; }
.cast-done-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cast-done-meta { font-size: 12px; color: var(--text-secondary); }
.cast-done-meta code { font-family: "JetBrains Mono", "Consolas", monospace; }
```

其余要点：

| 选择器 | 要点 |
| --- | --- |
| **`.cast-mat`** | 卡片级 modifier：`overflow: visible`。`.mat-card` 默认 `overflow: hidden`（素材卡要裁预览图），但角色卡的「…」菜单得从卡片里弹出去，所以只在这一类卡上放开；圆角与裁切交给下面的 `.cast-thumb` 自己做 |
| **`.cast-mat-grid`** | 卡片墙**容器**级 modifier（用在 `CastSection.vue` 的 `<div class="mat-grid cast-mat-grid">` 上）：只写一条 `grid-template-columns: repeat(auto-fill, 130px)`——列宽定死 130px、一屏能并排放下更多角色；`display: grid` 与 `gap` 仍来自素材那张 `.mat-grid`（它是 `minmax(158px, 1fr)` 的弹性列，两者只差列宽）。**130 是下限、别再收回 100px**（100 宽配 150 高看着细长、下面两行字也挤成一团，用户实测反馈）。窄窗下 `auto-fill` 仍会自动减列，不出现横向滚动 |
| **`.cast-thumb`** | `13:15`（**130×150**）竖版预览位：`aspect-ratio: 13 / 15` + `overflow: hidden` + 上圆角 `10px 10px 0 0` + 底色 `#EEF2F7`；里面的 `.cast-shot` 撑满（`width/height: 100%`、去掉自带描边与圆角）。为什么不用素材的 16:9：角色是竖构图（8u 高的人 vs 约 4u 宽），13:15 更省横向空间、人也更完整（卡片定宽 130px ⇒ 预览位正好 130×150，**高度保持 150 不变、只把宽从 100 放到 130**） |
| **`.cast-more`** | 右上角「…」按钮（跟着卡片缩了一号）：`.hf-btn` + `position: absolute; top: 5px; right: 5px; z-index: 2`、`padding: 1px 6px`、**12px**、`line-height: 1.3`、**5px** 圆角。与素材卡的「移除」（`.mat-del` 的 `top/right: 7px` + `padding: 2px 7px` + 11px）同角，但**更贴角、内距更薄**——它只负责开菜单，真正动作都在菜单里 |
| **`.cast-menu`** | 动作菜单（锚点上移到「…」下方 `top: 28px` / `right: 5px`）：`position: absolute; z-index: 20`（抬过相邻卡片）、`min-width: 118px`、4px 内边距、8px 圆角、1px 主色半透明描边 `rgba(0,212,255,.35)`、底 `rgba(11,18,32,.98)`、`box-shadow: 0 8px 24px rgba(0,0,0,.45)`。**本轮格子放宽到 130px、菜单尺寸没动**：`min-width: 118px` + `right: 5px` ⇒ 菜单（118px）整个落在 130px 的卡片内、不会探到相邻卡片上（源码注释**已随 130px 同步**：`.cast-more` 写「卡片只有 130px 宽，按钮不能占太多」，`.cast-menu` 写「卡片 130px 宽 + 菜单 118px + right:5px ⇒ 菜单整个落在卡片内」——CSS 代码块即按这两句照录）；点菜单外面收起（逻辑在 `CastSection.vue`） |
| **`.cast-menu-item`（+ `.danger`）** | 菜单项：12px、`display: block`、`width: 100%`、左对齐、透明底；hover `rgba(0,212,255,.12)`、`:disabled` 走 `opacity: .45` + `not-allowed`；`.danger`（「移除」）文字 `var(--color-danger)`、hover `rgba(255,77,109,.14)` |
| `.cast-name` / `.cast-desc` | **保留**的两个文字类（本轮拆成独立两条，`.cast-desc` 不再与 `.cast-units` / `.cast-file` 合并）：名字主色 + 600 + 单行省略；描述 12px 雾蓝 + 单行省略。**角色卡片上不再用它们**（名字走 `.mat-name`、`高几 u · 描述` 走 `.mat-path`），唯一使用点是新建角色弹窗的大图旁边 |
| 勾选框 | 直接复用素材卡的 `.mat-check`（绝对定位在左上角 `top/left: 7px`）；**本轮不再有「行内改回正常流」的特例**，那条 `position: static` 覆盖规则已随 `.cast-row` 一起删除 |
| **`.cast-shot` / `.cast-shot-frame` / `.cast-shot-note`** | 预览容器：基线尺寸 56×72、8px 圆角、浅灰底 `#EEF2F7`、描边 `rgba(0,212,255,.18)`——**本轮起三处使用点都把这个基线覆盖掉了**（`.cast-thumb` 里 100%×100%、`.cast-card` 里 100%×132px、弹窗大图 200×260）；`iframe` 铺满且 **`pointer-events: none`**（点击穿透到卡片）；没有 `src` 时显示 `.cast-shot-note`（11px 雾蓝，「…」/「无法预览」） |
| **`.cast-shot.big`** | 新建角色成功后的 200×260 大图（圆角 10px）；尺寸只由这个修饰类改，组件本身不定尺寸 |
| **`.cast-grid`** | 全局库弹窗的方格网格：`repeat(auto-fill, minmax(132px, 1fr))` + `gap: 10px` + **`max-height: 56vh` 可滚**（弹窗高度不失控）；窄窗自动减列，不出现横向滚动 |
| **`.cast-card`（+ `.on` / `.off`）** | 每格一张预览 + 底部 `.cast-card-meta`；`.on` = 主色描边 + `--glow-card` 辉光（与素材卡片选中态同一套语言）+ 右上 `.cast-card-tick`（18px 主色圆底 ✓，深色字 `#03131a`）；`.off` = `opacity: .5` + `cursor: not-allowed` + 左上 `.cast-card-missing`「文件缺失」（11px 信号橙、深色胶囊底） |
| **`.cast-card .cast-shot`** | 格子里的预览撑满卡片宽度、高固定 132px（保证每格一样高），去掉自己的描边与圆角 |
| **`.cast-done*`** | 新建成功后的两栏：`.cast-done`（`flex` + `gap: 14px` + 顶对齐）、`.cast-done-info`（`flex:1; min-width:0`，名字 / 描述 / 身高与文件名 / 提示纵排）、`.cast-done-meta`（12px 雾蓝，`code` 用等宽字体） |
| 复用的类 | **`.mat-check`（+ `.on`）**——卡片左上角勾选框直接复用素材卡片那个 18×18 圆角方块（**不新造勾选样式、也不改它的定位**）；**`.mat-grid` / `.mat-card` / `.mat-meta` / `.mat-name` / `.mat-path`**——角色卡片的版式整张都来自「项目素材」那一节，**只有列宽例外**（容器上再挂 `.cast-mat-grid` 把列宽定死 130px）；`.ch-sub`（角色块副标题小字）；两个弹窗复用 `.hf-modal*` 一整套 |
| **已删除** | **本轮删的**：`.cast-list` / `.cast-row` / `.cast-row.off` / `.cast-row:first-child` / `.cast-row:last-child` / `.cast-row:only-child` / `.cast-row .mat-check` / `.cast-actions` / `.cast-units` / `.cast-file`——角色行版式整套撤掉，改成卡片墙时**没有新增任何版式类**（后来缩卡片时才加了容器级的 `.cast-mat-grid`）；**上一轮起就废弃、本轮一并清掉的**：`.lib-row` / `.lib-row:last-of-type` / `.lib-row.off` / `.lib-row input[type="checkbox"]` / `.lib-missing`。`grep` 在 `main.css` 里搜这些串都已无残留，**类名不要再用** |

### 3.5.1 「角色」页 · 动作示范（`.cast-demo-*` / `.cast-act-*`，本轮新增）

> 使用方只有 `pages/CastPage/` 的四个组件：`CastActionModal.vue`（两栏外壳 + 两组列表 + AI 面板）、`CastDemoShot.vue`（动画 iframe）、`CastActionEditor.vue`（关键帧表）。这一节排在文件末尾（`.cast-style` 之后），是 `main.css` 最后一段。

| 选择器 | 要点 |
| --- | --- |
| **`.cast-demo-shot`** | 会动的大图容器：`position: relative`、`flex: none`、**300×380**、1px 主色半透明描边、10px 圆角、`overflow: hidden`、底色 `#EEF2F7`（与静态预览一致：角色多为深色勾边 / 浅色皮肤） |
| **`.cast-demo-frame`** | 里面的 `iframe`：`display: block`、`width/height: 100%`、`border: 0`、同色底。**与 `.cast-shot iframe` 不同，这里不加 `pointer-events: none`**——页内工具条（暂停 / 重播）要能点 |
| **`.cast-act`** | 弹窗正文两栏：`display: flex; gap: 16px; align-items: flex-start` |
| **`.cast-act-left`** / **`.cast-act-right`** | 左栏 `flex: none` + 纵向 `gap: 8px` + **宽 300px**（与 `.cast-demo-shot` 同宽）；右栏 `flex: 1; min-width: 0`（可收缩，否则长名字会撑破弹窗） |
| **`.cast-act-now`** / **`.cast-act-now-name`** | 大图下方「当前动作名 + 时长/循环」：`baseline` 对齐 + gap 8；名字 14px / 600 / 主色 / 单行省略 |
| **`.cast-act-list`** | 动作列表容器：纵向 `gap: 4px`、`margin-bottom: 10px`、**`max-height: 200px` 可滚**（两组列表各自滚，弹窗高度不失控） |
| **`.cast-act-item`（+ `.on` / `:hover`）** | 一行一条：`width: 100%`、`padding: 6px 9px`、1px 主色半透明描边、8px 圆角、深色半透明底、13px、手型光标；hover 描边加亮 + 主色 6% 底；**`.on` = 主色描边 + `linear-gradient(90deg, rgba(0,212,255,.18), transparent)`**（与侧栏菜单选中态、音色列表同一套语言） |
| **`.cast-act-tag`（+ `.ai`）** | 来源徽标：11px、`border-radius: 999px`、雾蓝描边（「内置」/「自建」）；**`.ai` 换成数据绿**（「AI」） |
| **`.cast-act-item-meta`** | 时长那一段：12px 雾蓝 + 等宽字体（`tabular-nums` 的观感，时长数字不跳动） |
| **`.cast-act-item-acts`** / **`.cast-act-link`（+ `.danger`）** | 行尾「改 / 删」：12px 主色文字链接、hover 下划线；`.danger` 换 `--color-danger`（删专属动作 / 删公共动作都用它） |
| **`.cast-act-ai`** | 「AI 生成…」面板：`margin-bottom: 10px` + `padding: 10px` + 主色 25% 描边 + 10px 圆角 + 深色半透明底（与列表行区分开，但不抢主按钮的视觉） |
| **`.cast-act-table`** | 关键帧表外框：`margin: 10px 0` + 主色 18% 描边 + 10px 圆角 + **`overflow-x: auto`**（参数多时横向滚，不撑破弹窗） |
| **`.cast-act-tr`（+ `.head`）** | 一行：`display: grid` + `grid-template-columns: 74px`（时间列）+ `grid-auto-flow: column` + **`grid-auto-columns: 62px`**（每个参数一列，**参数表加减项时不用改 CSS**）+ gap 4 + 下分隔线；`.head` 用主色 5% 底 + 12px 雾蓝（表头） |
| **`.cast-act-th`** | 表头单元格：单行省略（列宽固定 62px，长标签靠 `title` 给全文） |
| **`.cast-act-cell`** | 表格里的输入框 / 下拉：`width: 100%`、12px、6px 圆角、深底主色 20% 描边 |
| **`.cast-act-del`（+ `:disabled`）** | 删帧「×」：26×24、透明底 + 危险色 40% 描边、危险色文字；**`:disabled` 时 `opacity: .4` + `not-allowed`**（至少留两帧） |

> **为什么用 `grid-auto-columns` 而不是给每个参数写死列宽**：列由 `CAST_ACTION_PARAMS` 渲染（10 项，且可能增减），写死 `nth-child` 会在加参数时错位；统一 62px 让「数字 / 下拉」都有可点的宽度。
>
> **`.cast-card.static` 的 `cursor` 改动**：由 `default` 改成 `pointer`——「角色」页的卡片现在**双击看动作示范**，可点的手势要跟上；选角色弹窗里的 `.cast-card` 本来就是整格可点（默认 `pointer`），两者不冲突。

> **为什么列宽写 `minmax(0, Nfr)`**：`1fr` 的隐含下限是 `min-content`，描述或文件路径一长就会把列撑爆、`text-overflow: ellipsis` 直接失效——与 `.voice-list-*` / `.ch-*` / `.mat-grid` / `.cast-grid` 是同一条取舍。

## 4. 命名与约定

| 前缀 / 命名族 | 出现节 | 含义 |
| --- | --- | --- |
| `hf-*` | 预览转视频、配音 Tab、弹窗 | 与 HyperFrames / 配音通用控件相关：`hf-btn`（含 `.hf-btn-primary` / `.hf-btn-danger`）、`hf-file`、`hf-status`、`hf-detail`、`hf-video*`、`hf-tabs`/`hf-tab`、`hf-modal-*`（下拉的 `hf-sel*` 前缀属 `components/HfSelect.vue`） |
| `hgen-*` | HTML 生成页与工作台 | `hgen-grid`、`hgen-panel`、`hgen-subtitle`、`hgen-input`、`hgen-row`、`hgen-actions`、`hgen-tip`、`hgen-source`、`hgen-block`、`hgen-check`、`hgen-frame-wrap`、`hgen-frame` |
| **`mat-*`** | **HTML生成页素材库（本轮新增）** | **素材卡片墙**：`mat-grid`、`mat-card`（状态类 `.off`）、`mat-thumb`、`mat-play`、`mat-meta`、`mat-name`、`mat-path`、`mat-check`（状态类 `.on`）、`mat-del`、`mat-add`、`mat-count`；**角色卡片墙也整套复用它**（见 §3.5，角色只多 `.cast-mat` / `.cast-mat-grid` / `.cast-thumb` / `.cast-more` / `.cast-menu*`，其中 `.cast-mat-grid` 只覆盖列宽、`.mat-grid` 仍是 `minmax(158px, 1fr)`）；图片组的点靠 `.dot.dot-img` 而非新前缀 |
| **`cl-*`** | **设置页更新日志弹窗** | **随包 `CHANGELOG.md` 的展示**：`cl-ver`（版本 + 时间抬头）、`cl-list`、`cl-item`、`cl-item-title`、`cl-date`、`cl-count`、`cl-tag`（配色档 `.cl-tag-ok` / `.cl-tag-err` / `.cl-tag-warn`）、`cl-more`、`cl-hist`、`cl-hist-head`、`cl-hist-body`、`cl-hist-block`、`cl-hist-ver`、`cl-hist-name`、`cl-caret` |
| **`ch-*`** | **HTML生成页章节列表（本轮新增）** | **只读章节列表的行样式**：一行一章（序号 / 标题 / 起止 / 时长 / `pages/cNN.js` / 「改这一章」）；列宽用 `minmax(0, Nfr)`，使用方只有 `HtmlGenPage/ChapterSection.vue` |
| **`cast-*`** | **HTML生成页「项目素材 · 角色」块 + 预览 + 两个弹窗** | **角色相关四组**：① 卡片墙：`cast-mat`（卡片级 modifier，`overflow: visible`）、**`cast-mat-grid`**（容器级列宽覆盖，定死 130px）、`cast-thumb`（`13:15` 预览位，130×150）、`cast-more`（右上「…」按钮）、**`cast-menu` / `cast-menu-item`（状态类 **`.danger`** = 移除）**、`cast-name` / `cast-desc`（只剩新建弹窗在用）；② 预览：**`cast-shot`**（状态类 `.big` = 200×260）、**`cast-shot-frame`**（`pointer-events:none`）、**`cast-shot-note`**；③ 全局库方格：**`cast-grid`**、**`cast-card`**（状态类 `.on` 选中 / `.off` 缺文件）、**`cast-card-meta` / `cast-card-name` / `cast-card-sub` / `cast-card-tick` / `cast-card-missing`**；④ 新建成功：**`cast-done` / `cast-done-info` / `cast-done-meta`**。勾选框与卡片版式复用素材那一组 `.mat-*`（`.mat-check` / `.mat-grid` / `.mat-card` / `.mat-meta` / `.mat-name` / `.mat-path`），说明小字复用 `.ch-sub`；使用方是 `HtmlGenPage/CastSection.vue` / `CastShot.vue` / `CastLibraryModal.vue` / `CastCreateModal.vue`。**⑤ 动作示范（本轮新增、「角色」页专用）**：`cast-demo-shot` / `cast-demo-frame`（300×380 动画 iframe）、`cast-act` / `cast-act-left` / `cast-act-right`、`cast-act-now` / `cast-act-now-name`、`cast-act-list` / `cast-act-item`（状态类 `.on`）/ `cast-act-tag`（状态类 `.ai`）/ `cast-act-item-meta` / `cast-act-item-acts` / `cast-act-link`（状态类 `.danger`）、`cast-act-ai`、`cast-act-table` / `cast-act-tr`（状态类 `.head`）/ `cast-act-th` / `cast-act-cell` / `cast-act-del`；使用方是 `CastPage/CastActionModal.vue` / `CastDemoShot.vue` / `CastActionEditor.vue` |
| ~~`lib-*`~~ | （已删除） | 旧的「从全局库添加」整行勾选列表：`lib-row` / `lib-row.off` / `lib-row input[type="checkbox"]` / `lib-missing`。本轮全局库改成 `.cast-grid` / `.cast-card` 方格网格后**整套删除**，与本文件其他节的 `input[type="checkbox"]` 规则一并清掉（`.mat-check` 等仍是自绘方块）。**不要再新增 `lib-*` 类** |
| `hg-prev-*` | 预览播放控制条 | `hg-prev-ctl`、`hg-prev-bar`（状态类 `.seeking`）、`hg-prev-track`、`hg-prev-bar-fill`、`hg-prev-time`、`hg-prev-hint` |
| `hg-help*` | HTML 生成页（**动作按钮内部 2 处 + 卡片标题「用法」+ 画布行**） | 行内帮助 `?`：`hg-help`、`hg-help-icon`、`hg-help-pop`；显隐靠 `.hg-help:hover` 后代选择器。设计系统本身未变：后两处是**非按钮锚点**，靠模板内联覆盖——`letter-spacing:0`（锚在带 2px 字距的 `.panel-title` 里）与 `top:calc(100% + 8px);bottom:auto`（**向下**展开，避免顶出滚动容器 `.content` 的 `overflow-y:auto` 被整块裁掉） |
| `step-*` / `project-bar*` | 项目链路状态条 | `project-bar*`、`step-chain`、`step-node`、`step-dot`、`step-arrow`；状态用修饰类 `.done` / `.active-now` / `.clickable` |
| `sub-*` | 字幕编辑器与字幕写入方式 | `sub-list`、`sub-row`、`sub-idx`、`sub-time`、`sub-arrow`、`sub-text`、`sub-del`、`sub-count`、`sub-note`、`sub-empty`、`sub-textarea`、`sub-mode-btn` |
| `model-*` / `whisper-*` / `align-*` | whisper 模型卡、下载进度与转录、逐句对齐 | 状态类为 `.downloaded` / `.selected` / `.current` / `.error` / `.done` / `.indeterminate` / `.ok` / `.warn` |
| `voice-*` / `panel-head*` | 配音页「我的音色列表」 | 列表面板：`panel-head`（通用头行）、`panel-head-actions`、`voice-list*`、`voice-name*`、`voice-tag`（`.clone`）、`voice-model` / `voice-extra`、`voice-actions`（**素材库的头行复用 `panel-head` / `panel-head-actions`**） |
| `flow-*` / `metric-*` / `titlebar-*` / `win-*` / `proj-*` / `tw-*` | 首页、标题栏、项目详情卡、转录弹窗 | 见 §3 各行 |
| 无前缀通用类 | 全局 | `layout`、`sidebar`、`logo`、`menu`、`menu-item`、`content`、`card`、`hero*`、`panel-title` / `panel-title-sm`、`empty-hint` |

约定要点：

- **状态一律用修饰类**（`.active`、`.done`、`.current`、`.selected`、`.downloaded`、`.ok`、`.warn`、`.error`、**`.off` / `.on`**），不引入新的前缀族。
- **未启用 BEM**，采用「前缀 + 短横线 + 语义词」的扁平命名；**全局通用类不再套页面前缀**（`.panel-title` / `.panel-title .dot` 可直接给任何卡片使用）。
- 颜色几乎不写死，统一走 `var(...)`；少数渐变与半透明描边直接写 `rgba(0,212,255,…)` 字面量（素材节同样如此）。
- **列宽用 `minmax` 而非纯 `fr`**：素材网格用 `repeat(auto-fill, minmax(158px, 1fr))`，与 `.model-grid` / `.proj-meta` / `.voice-list-*` / 章节列表行同一取舍。

## 5. 依赖与协作

- **唯一全局入口**：`src/renderer/src/main.ts` 的 `import './assets/main.css'`，在 `createApp(App).mount('#app')` 之前引入。
- **组件样式现状**：绝大多数页面与子组件**没有 `<style>` 块**，视觉完全依赖本文件的类名与变量；少数自带局部 `<style>` 的组件（`App.vue` 的 `.toast-*`、`HfSelect.vue` 的 `.hf-sel*`）在本文件之外补充私有类。
- **与 scoped 样式的配合**：本文件是全局样式，不受 `data-v-*` 影响；反过来也命中不了 scoped 组件内部结构。
- **变量是组件行内样式的桥梁**：多个组件直接在模板 `style` 属性中引用本文件变量（素材卡片、预览卡片都有大量行内 `style`，如 `.hgen-row` 里的 `style="flex:none;width:auto"`）。
- **类名复用是主要协作方式**：`MaterialsSection.vue` 就是典型——除新增的 `.mat-*` 外，其余（`.hgen-block`、`.panel-head*`、`.panel-title*`、`.hgen-tip`、`.hf-btn*`）全部复用既有类；更新日志弹窗同理——`.hf-modal*` / `.hf-btn` / `.hf-status` / `.hf-error` / `.hf-detail` 全部复用，只自带 `.cl-*` 一组（宽度靠模板内联 `style="width:min(720px,92vw)"`，不新增类）。
- **JS 与 CSS 的契约**：`.hgen-frame` 的缩放依赖 JS 写 `transform: translate(...) scale(...)`，**它的宽高与容器的尺寸也依赖组件内联样式**（`.hgen-frame-wrap` 与 `.hgen-frame` 上的 16:9 / 1920×1080 是默认值：挂载后容器按 **`frameStyle`**（高度上限 800、宽度按比例、`aspect-ratio` 定高、`paddingBottom:'0'`）覆盖、iframe 宽高按**页面声明的画布**（`pageBox`）覆盖）；`.hg-prev-bar-fill` / `.whisper-bar-fill` 的宽度依赖 JS 写 `style.width`；`.mat-check` 的 `✓` 与 `.mat-card.off` / `.cast-row.off` 由 Vue 按 `selected` 渲染；`.mat-add` 的 `:disabled` 由 `busy` 控制。
- **与设计规范一致**：变量名与取值同 `src/renderer/agents.md` 逐条对应；字号刻度见该文件 §3.1 / §3.2，列表面板（`.panel-head*`）的结构约定见 §5.6，滚动条约定见 §5.8。

## 6. 注意事项与实现要点

- **`!important` 共两处**：`.hero-sub`（压过 `.hero p` 的 14px）与 `.whisper-bar.indeterminate .whisper-bar-fill`（压过 JS 写的行内宽度）；素材节、更新日志节与**角色卡片墙节都没有**用 `!important`。
- **滚动条只有一套、全局继承**：`main.css` 基础段（`html, body` 之后、`body` 之前）用 `*::-webkit-scrollbar` 系列定义唯一一套——宽高 8px、轨道与角落透明、`border-radius: 999px` 的滑块 `rgba(0,212,255,.25)`、悬停 `rgba(0,212,255,.45)`；`.content`（右侧整页内容区）、`.sub-list`（字幕条目列表）、`.voice-list-body`（我的音色列表）等所有滚动容器一律继承，不在任何容器上重复定义。**全局刻意不写 `scrollbar-width` / `scrollbar-color`**：Chromium（Electron 31 = Chromium 126）里这两个标准属性会顶掉 `::-webkit-*` 伪元素的自定义效果，写了就退回默认灰白滚动条。确需「不显示滚动条但仍可滚动」时，才在该容器上单独写 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`（目前没有容器在用）；预览 iframe（`hgpreview://` 协议的 HTML 预览页）是独立文档，不受这条全局规则影响。
- **毛玻璃写法固定为双写**：`backdrop-filter: blur(12px)` 后紧跟 `-webkit-backdrop-filter`（`.card`、`.flow-node`、`.metric-card`）。**素材卡片没有用毛玻璃**——它整卡 `overflow: hidden` 且深底不透明感更强。
- **`.card` 的 `backdrop-filter` 会捕获后代的 `position: fixed`**：带 `backdrop-filter` 的元素会成为 `fixed` 后代的包含块 ⇒ 挂在卡片里的弹窗（`.hf-modal-mask` 是 `position: fixed`）会被卡片框住、顶部跑到窗口外。**解法是弹窗组件自己 `Teleport` 到 `<body>`**，落地见 `pages/SettingsPage/components/{UpdateSection,ChangelogDialog}.vue`（设置页的「自定义更新源」与「更新日志」弹窗）与配音页 `VoiceSection.vue` 的两个弹窗（各处都留了同样的注释）。渲染层现有 **5 处** `<Teleport to="body">` 里只有 `components/HfSelect.vue` 的弹层是为避开祖先 `overflow: hidden` 而挂，其余 4 处都是这个坑。本文件不改 `.card` 的双写写法。
- **辉光三种实现**：文字 `text-shadow: var(--glow-primary)`；组件外发光 `box-shadow`；图标 `filter: drop-shadow(...)`。素材节用前两种（`.mat-play` / `.mat-add i` 用文字辉光，`.dot.dot-img` 用同色 `box-shadow`）。
- **动画共 4 个 keyframes**：`heroScan`、`heroFlow`、`stepPulse`、`whisper-slide`；素材节**不引入新动画**，只有 `0.2s ease` 的描边 / 透明度过渡（与设计规范「运动统一 0.2s ease」一致）。
- **性能敏感属性**：被动画的属性为 `transform` / `background-position` / `box-shadow` / `margin-left`。
- **过渡时长成体系但不统一**：`0.15s` / `0.18s` / `0.2s` / `0.25s`；素材节的过渡都是 `0.2s ease`。
- **响应式**：本文件**不含任何 `@media` 查询**；自适应靠 flex（`flex-wrap`）、grid（`auto-fit/auto-fill + minmax`）与 `min()` 宽度。
- **固定视口的特例**：`.hgen-frame` 写着 `1920px × 1080px`（横屏默认值），实际尺寸由 `PreviewSection.vue` 按**页面自己声明的画布**（`pageBox`）内联覆盖，缩放仍交给 JS——**不要把它当成「恒为 1920×1080」**：页面声明竖屏 / 方形时预览 iframe 就是 1080×1920 / 1080×1080；**页面没声明时回落项目当前画布**。**它可能与本项目的画布不同**（那正是「预览按页面原样」的意义）；**预览「视角比例」下拉也不改这个尺寸**：它只换**外层容器**的尺寸（`frameStyle`：高度上限 800、宽度 = `min(100%, 800×比例)`、`aspect-ratio` 定高）并让 iframe 在新形状里 contain + 居中，多出来的部分是黑边。
- **深色专属假设**：所有颜色按深底亮字设计；`--color-secondary` 现被素材节的 `.dot.dot-img` 真正引用（不再是「已定义但未使用」）。
- **素材节的三个取舍**（源码注释原文已写进 §3.2）：① 未勾选只压暗不禁用（`.off` 而非 `disabled`）；② 视频不抽帧、用 `▶` 占位；③ 勾选框与移除键直接写在按钮上并显式抬 `z-index`，不额外包一层容器。
- **类名缺口**：`.sel-label` 在多处页面模板中使用（包括素材库上方的「字幕」行与预览卡片的「背景音频」/「语速」），但本文件未定义其样式——排查「标签样式不生效」时需注意。
- **`.rate-spinner`** 仍无对应规则（预览卡片里的语速控件包裹层，样式由内联 `style` 提供）。

修改本文件的推荐步骤：

1. 新增颜色/间距前，先在 `:root` 设计令牌区确认是否已有可用变量。
2. 按归属节就近插入样式，并补上 `/* ===== ... ===== */` 分节注释。
3. 状态变化一律新增修饰类，不要改基类默认值。
4. 需要响应式时优先加 `flex-wrap` / `minmax` / `min()`，保持「零 media query」的现状。
