# src/renderer/src/assets/（设计系统）

> ShadowMill（影坊）全局设计系统样式表，「Cyber UI / 深空科技」主题的唯一实现载体。

- **覆盖文件**：`assets/main.css`（本目录唯一文件，全局设计系统样式表）
- **所在目录**：src/renderer/src/assets/
- **类型**：全局样式表（设计系统）
- **规模**：1890 行（单文件设计系统随迭代持续增长；当前体量见 `[IO.File]::ReadAllLines` 实测）

## 1. 作用与职责

| 职责 | 说明 |
| --- | --- |
| 主题变量源 | 在 `:root` 中集中定义背景、品牌色、文字色、辉光、圆角、间距刻度等 CSS 变量（清单见 §2），是全应用配色的唯一出口 |
| 全局重置与骨架 | `*` 归零、`html, body` 的字体族 + **全局字号基准 `font-size: 14px`** + 背景、`#app` 与 `.layout` 的 flex 列布局，决定「标题栏 + 侧栏 + 内容区」三段式结构 |
| 通用组件样式 | 卡片、按钮（`.hf-btn`）、文本域、弹窗（`.hf-modal-*`）、进度条、空态提示等跨页面复用类（**下拉不在本文件**：自绘下拉 `HfSelect.vue` 自带 `.hf-sel*` 组件级样式） |
| 页面专有样式 | 首页 Hero 与流水线、HTML 生成工作台（含**项目素材库卡片墙**）、字幕/配音、设置页模型卡片等按注释分节组织 |
| 视觉特效库 | 毛玻璃（`backdrop-filter: blur(12px)`）、霓虹辉光（`text-shadow` / `box-shadow`）、渐变文字、扫描线动画 |

页面与样式节的对应关系（据各 `.vue` 模板实际使用的类名）：

| 页面 / 组件 | 主要依赖本文件的节 |
| --- | --- |
| `App.vue` | 全局骨架 `#app` / `.layout`、`.titlebar*`、`.win-btn`、`.sidebar` / `.menu*`、`.content`；自身另有 `<style scoped>` 定义 `.toast-*` |
| `pages/HomePage/index.vue` | `.hero*`、`.flow-pipeline` / `.flow-node*`、`.metric-*`、`.proj-grid` / `.proj-card*`、`.panel-title` / `.dot` |
| `components/StepBar.vue` | `.project-bar`、`.step-chain`、`.step-node`、`.step-arrow` |
| `pages/HtmlGenPage/index.vue` | `.hgen-*`、`.panel-title` / `.panel-title-sm`、`.proj-*`、`.hg-help*`（两个动作按钮**内部**各自的行内帮助 `?`）、`.hf-*`（动作行按钮、「转视频」弹窗里的档位控件与状态条）；「转视频」弹窗的外壳复用通用弹窗类 `.hf-modal*`；**本页只剩「字幕」1 处 + 「质量 / 帧率」2 处下拉**（样式随 `components/HfSelect.vue`） |
| **`pages/HtmlGenPage/MaterialsSection.vue`（本项目素材库，本轮新增）** | **新增节「HTML生成页：项目素材库（图片 / 视频卡片墙）」**：`.mat-grid` / `.mat-card`(+`.off`) / `.mat-thumb`(+`.mat-play`) / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`(+`.on`) / `.mat-del` / `.mat-add` / `.mat-count` / `.panel-title .dot.dot-img`；另复用 `.hgen-block`、`.panel-head` / `.panel-head-actions`、`.panel-title` / `.panel-title-sm`、`.hgen-tip`、`.hf-btn` / `.hf-btn-danger` |
| **`pages/HtmlGenPage/PreviewSection.vue`（预览卡片）** | `.card.hgen-panel` 外壳、`.panel-title`、`.hgen-row`、`.sel-label`、`.hf-file`、`.hgen-input`（语速输入框）、`.hf-status`（+`.hf-ok` / `.hf-error`）、`.empty-hint`、`.hgen-frame-wrap` / `.hgen-frame`、`.hg-prev-*`（播放控制条三件套）、`.rate-spinner`（包裹，本文件无对应规则、样式由内联 `style` 提供）；背景音频下拉走 `components/HfSelect.vue`；AI 思考过程块用的是**行内 `style`**（无专有类） |
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
| 自绘标题栏（深空科技风格） | `.titlebar*`、`.win-btn`、`.win-close` | 40px 高；`-webkit-app-region: drag`；`.win-close:hover` 变警报红 |
| 左侧菜单（文字菜单） | `.sidebar`、`.logo`、`.menu*` | 220px 宽墨蓝渐变；选中态 3px 电子蓝左边框 + 90° 渐隐高亮 |
| 右侧内容区 | `.content*`、`.content h1`、`.content p` | `padding:32px`；隐藏滚动条；`h1` 24px 带辉光 |
| （无注释）卡片 / 面板（毛玻璃） | `.card` | `--bg-secondary` 底 + 半透明描边 + `--radius-card` + `backdrop-filter: blur(12px)` |
| 首页 Hero 横幅 | `.hero*`、`@keyframes heroScan` / `heroFlow` | 双色渐变 + 扫描光带 + 渐变流光标题 |
| 流水线节点卡片 | `.flow-pipeline`、`.flow-node*`、`.flow-arrow` | hover 上浮 4px 并叠加双层辉光 |
| 数据指标卡 | `.metric-grid`、`.metric-card`、`.metric-value`、`.metric-label` | 4 列 grid；指标卡描边/辉光用数据绿 |
| 首页 · 我的项目卡片（只选择 / 打开，新建入口在顶部工作项目栏） | `.proj-grid`、`.proj-card*` | `repeat(auto-fill, minmax(220px, 1fr))` 卡片网格 |
| 预览 / HyperFrames 转视频 | `.hf-toolbar`、`.hf-btn*`、`.hf-file`、`.hf-status`(+`.hf-ok` / `.hf-error`)、`.hf-detail`、`.hf-video*`、`.hf-tip` | 全应用主按钮体系与状态行：`.hf-btn-primary` hover **必须重写 `background`**（特异性 0,3,0 的基础 hover 会顶掉渐变）；`.hf-btn-danger` 紧随 `.hf-btn-primary:hover` 之后（靠「写在后面」取胜）；`.hf-detail` 紧跟 `.hf-status.hf-error` 定义。现由 `pages/VideoPreviewPage/index.vue`（工具栏 / 播放器 / 定位按钮 / 状态条）、**`pages/HtmlGenPage/PreviewSection.vue`（背景音频行 `.hf-file`、状态条 `.hf-status`）**、`pages/HtmlGenPage/index.vue`（动作按钮与弹窗档位控件）与 `pages/SettingsPage/components/UpdateSection.vue`（状态行与 `.hf-detail`）共同使用 |
| 项目链路状态条（贯通各页，两行：上流程链 / 下工作项目切换） | `.project-bar*`、`.step-chain`、`.step-node*`、`.step-arrow` | 胶囊节点 + 圆点状态机（灰 / 绿 / 蓝脉冲） |
| 配音页 Tab 切换 | `.hf-tabs`、`.hf-tab` | 999px 胶囊 Tab |
| HTML 生成页（与紧随其后的「行内帮助」小节交错） | `.hgen-grid`、`.panel-title`、`.panel-title .dot`、`.hgen-subtitle`、`.hgen-input`、`.hgen-row`、`.hgen-actions`、`.hgen-tip` | 面板标题带发光小圆点（`.panel-title` / `.dot` 已全局化）；`.hgen-subtitle` 为 260px 高文本域。**注意**：本节规则被下面「行内帮助」小节从中间分开 |
| 行内帮助：`?` 图标 + 悬浮说明（放在按钮内部：每个动作各带一个 `?`） | `.hg-help*` | 16px 圆形 `?` + 320px 悬浮气泡；默认 `opacity:0` + `visibility:hidden` + `pointer-events:none`；气泡位于 `<button>` 内故重置排版 |
| HTML 工作台：分区小标题 + 源码编辑器 | `.panel-title-sm`、`.hgen-source*` | 通用小标题（主色 13px 600）；源码编辑器 `min-height:320px`、Consolas、`resize: vertical` |
| 项目详情小卡 | `.proj-meta`、`.proj-stat`(+`.on`) | `auto-fit, minmax(130px, 1fr)` 自适应栅格；`.on` 切数据绿（HTML生成页的「素材」格就落在这里） |
| 预览画布 | `.hgen-frame-wrap`、`.hgen-frame` | **这里只是「默认值（横屏）」的占位**：容器 `padding-bottom:56.25%`（16:9）与 iframe 的 `1920px × 1080px` 都保持原值不变，但**挂载后一律被 `pages/HtmlGenPage/PreviewSection.vue` 的内联样式覆盖**——容器的 `padding-bottom` 绑定 `framePadPct`（画布高/宽×100）、iframe 的宽高绑定 `canvasBox`（项目画布的像素，横屏 1920×1080 / 竖屏 1080×1920 / 方形 1080×1080，见 `shared/constants.ts` 的 `CANVAS_SIZES`）。`transform-origin: 0 0` 不变、`scale` 仍由 JS 设，但缩放比改为「容器宽 ÷ **当前画布宽**」。源码注释已把这层语义写明：**预览 iframe 内部视口 = 项目选定的画布尺寸（= 转视频的成片尺寸）**，本文件里的 16:9 / 1920×1080 只在组件挂载前占位 |
| 预览播放控制条（进度条 + 暂停/播放 + 重新播放） | `.hg-prev-ctl`、`.hg-prev-bar`(+`.seeking`)、`.hg-prev-track`、`.hg-prev-bar-fill`、`.hg-prev-time`、`.hg-prev-hint`、`.empty-hint` | `.hg-prev-bar` 是**可点可拖的跳转热区**（`padding:5px 0`，视觉厚度仍是 8px）；`.hg-prev-track` 用 `box-shadow: inset 0 0 0 1px …` 当描边；`.seeking` 时关掉填充的 0.25s 补间；`.hg-prev-hint` 是「已暂停在第 0 帧…」的说明文字。**使用方现为 `pages/HtmlGenPage/PreviewSection.vue`**（整块随预览卡片搬出 `index.vue`） |
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

## 4. 命名与约定

| 前缀 / 命名族 | 出现节 | 含义 |
| --- | --- | --- |
| `hf-*` | 预览转视频、配音 Tab、弹窗 | 与 HyperFrames / 配音通用控件相关：`hf-btn`（含 `.hf-btn-primary` / `.hf-btn-danger`）、`hf-file`、`hf-status`、`hf-detail`、`hf-video*`、`hf-tabs`/`hf-tab`、`hf-modal-*`（下拉的 `hf-sel*` 前缀属 `components/HfSelect.vue`） |
| `hgen-*` | HTML 生成页与工作台 | `hgen-grid`、`hgen-panel`、`hgen-subtitle`、`hgen-input`、`hgen-row`、`hgen-actions`、`hgen-tip`、`hgen-source`、`hgen-block`、`hgen-check`、`hgen-frame-wrap`、`hgen-frame` |
| **`mat-*`** | **HTML生成页素材库（本轮新增）** | **素材卡片墙**：`mat-grid`、`mat-card`（状态类 `.off`）、`mat-thumb`、`mat-play`、`mat-meta`、`mat-name`、`mat-path`、`mat-check`（状态类 `.on`）、`mat-del`、`mat-add`、`mat-count`；图片组的点靠 `.dot.dot-img` 而非新前缀 |
| **`cl-*`** | **设置页更新日志弹窗** | **随包 `CHANGELOG.md` 的展示**：`cl-ver`（版本 + 时间抬头）、`cl-list`、`cl-item`、`cl-item-title`、`cl-date`、`cl-count`、`cl-tag`（配色档 `.cl-tag-ok` / `.cl-tag-err` / `.cl-tag-warn`）、`cl-more`、`cl-hist`、`cl-hist-head`、`cl-hist-body`、`cl-hist-block`、`cl-hist-ver`、`cl-hist-name`、`cl-caret` |
| `hg-prev-*` | 预览播放控制条 | `hg-prev-ctl`、`hg-prev-bar`（状态类 `.seeking`）、`hg-prev-track`、`hg-prev-bar-fill`、`hg-prev-time`、`hg-prev-hint` |
| `hg-help*` | HTML 生成页动作按钮**内部** | 行内帮助 `?`：`hg-help`、`hg-help-icon`、`hg-help-pop`；显隐靠 `.hg-help:hover` 后代选择器 |
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
- **列宽用 `minmax` 而非纯 `fr`**：素材网格用 `repeat(auto-fill, minmax(158px, 1fr))`，与 `.model-grid` / `.proj-meta` / `.voice-list-*` 同一取舍。

## 5. 依赖与协作

- **唯一全局入口**：`src/renderer/src/main.ts` 的 `import './assets/main.css'`，在 `createApp(App).mount('#app')` 之前引入。
- **组件样式现状**：绝大多数页面与子组件**没有 `<style>` 块**，视觉完全依赖本文件的类名与变量；少数自带局部 `<style>` 的组件（`App.vue` 的 `.toast-*`、`HfSelect.vue` 的 `.hf-sel*`）在本文件之外补充私有类。
- **与 scoped 样式的配合**：本文件是全局样式，不受 `data-v-*` 影响；反过来也命中不了 scoped 组件内部结构。
- **变量是组件行内样式的桥梁**：多个组件直接在模板 `style` 属性中引用本文件变量（素材卡片、预览卡片都有大量行内 `style`，如 `.hgen-row` 里的 `style="flex:none;width:auto"`）。
- **类名复用是主要协作方式**：`MaterialsSection.vue` 就是典型——除新增的 `.mat-*` 外，其余（`.hgen-block`、`.panel-head*`、`.panel-title*`、`.hgen-tip`、`.hf-btn*`）全部复用既有类；更新日志弹窗同理——`.hf-modal*` / `.hf-btn` / `.hf-status` / `.hf-error` / `.hf-detail` 全部复用，只自带 `.cl-*` 一组（宽度靠模板内联 `style="width:min(720px,92vw)"`，不新增类）。
- **JS 与 CSS 的契约**：`.hgen-frame` 的缩放依赖 JS 写 `transform: scale(...)`，**它的宽高与容器的 `padding-bottom` 也依赖组件内联样式**（`.hgen-frame-wrap` 与 `.hgen-frame` 上的 16:9 / 1920×1080 是默认值，`PreviewSection.vue` 挂载后按项目画布覆盖）；`.hg-prev-bar-fill` / `.whisper-bar-fill` 的宽度依赖 JS 写 `style.width`；`.mat-check` 的 `✓` 与 `.mat-card.off` 由 Vue 按 `selected` 渲染；`.mat-add` 的 `:disabled` 由 `busy` 控制。
- **与设计规范一致**：变量名与取值同 `src/renderer/agents.md` 逐条对应；字号刻度见该文件 §3.1 / §3.2，列表面板（`.panel-head*`）的结构约定见 §5.6。

## 6. 注意事项与实现要点

- **`!important` 共两处**：`.hero-sub`（压过 `.hero p` 的 14px）与 `.whisper-bar.indeterminate .whisper-bar-fill`（压过 JS 写的行内宽度）；素材节与更新日志节**都没有**用 `!important`。
- **滚动条策略分两级**：`.content` 彻底隐藏；`.sub-list` / `.voice-list-body` 保留自绘滚动条。
- **毛玻璃写法固定为双写**：`backdrop-filter: blur(12px)` 后紧跟 `-webkit-backdrop-filter`（`.card`、`.flow-node`、`.metric-card`）。**素材卡片没有用毛玻璃**——它整卡 `overflow: hidden` 且深底不透明感更强。
- **`.card` 的 `backdrop-filter` 会捕获后代的 `position: fixed`**：带 `backdrop-filter` 的元素会成为 `fixed` 后代的包含块 ⇒ 挂在卡片里的弹窗（`.hf-modal-mask` 是 `position: fixed`）会被卡片框住、顶部跑到窗口外。**解法是弹窗组件自己 `Teleport` 到 `<body>`**，落地见 `pages/SettingsPage/components/{UpdateSection,ChangelogDialog}.vue`（设置页的「自定义更新源」与「更新日志」弹窗）与配音页 `VoiceSection.vue` 的两个弹窗（各处都留了同样的注释）。渲染层现有 **5 处** `<Teleport to="body">` 里只有 `components/HfSelect.vue` 的弹层是为避开祖先 `overflow: hidden` 而挂，其余 4 处都是这个坑。本文件不改 `.card` 的双写写法。
- **辉光三种实现**：文字 `text-shadow: var(--glow-primary)`；组件外发光 `box-shadow`；图标 `filter: drop-shadow(...)`。素材节用前两种（`.mat-play` / `.mat-add i` 用文字辉光，`.dot.dot-img` 用同色 `box-shadow`）。
- **动画共 4 个 keyframes**：`heroScan`、`heroFlow`、`stepPulse`、`whisper-slide`；素材节**不引入新动画**，只有 `0.2s ease` 的描边 / 透明度过渡（与设计规范「运动统一 0.2s ease」一致）。
- **性能敏感属性**：被动画的属性为 `transform` / `background-position` / `box-shadow` / `margin-left`。
- **过渡时长成体系但不统一**：`0.15s` / `0.18s` / `0.2s` / `0.25s`；素材节的过渡都是 `0.2s ease`。
- **响应式**：本文件**不含任何 `@media` 查询**；自适应靠 flex（`flex-wrap`）、grid（`auto-fit/auto-fill + minmax`）与 `min()` 宽度。
- **固定视口的特例**：`.hgen-frame` 写着 `1920px × 1080px`（横屏默认值），实际尺寸由 `PreviewSection.vue` 按项目画布内联覆盖，缩放仍交给 JS——**不要把它当成「恒为 1920×1080」**：项目选了竖屏 / 方形时预览 iframe 就是 1080×1920 / 1080×1080（与成片尺寸一致）。
- **深色专属假设**：所有颜色按深底亮字设计；`--color-secondary` 现被素材节的 `.dot.dot-img` 真正引用（不再是「已定义但未使用」）。
- **素材节的三个取舍**（源码注释原文已写进 §3.2）：① 未勾选只压暗不禁用（`.off` 而非 `disabled`）；② 视频不抽帧、用 `▶` 占位；③ 勾选框与移除键直接写在按钮上并显式抬 `z-index`，不额外包一层容器。
- **类名缺口**：`.sel-label` 在多处页面模板中使用（包括素材库上方的「字幕」行与预览卡片的「背景音频」/「语速」），但本文件未定义其样式——排查「标签样式不生效」时需注意。
- **`.rate-spinner`** 仍无对应规则（预览卡片里的语速控件包裹层，样式由内联 `style` 提供）。

修改本文件的推荐步骤：

1. 新增颜色/间距前，先在 `:root` 设计令牌区确认是否已有可用变量。
2. 按归属节就近插入样式，并补上 `/* ===== ... ===== */` 分节注释。
3. 状态变化一律新增修饰类，不要改基类默认值。
4. 需要响应式时优先加 `flex-wrap` / `minmax` / `min()`，保持「零 media query」的现状。
