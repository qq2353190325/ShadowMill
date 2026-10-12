# src/renderer/src/assets/（设计系统）

> ShadowMill（影坊）全局设计系统样式表，「Cyber UI / 深空科技」主题的唯一实现载体。

- **覆盖文件**：`assets/main.css`（本目录唯一文件，全局设计系统样式表）
- **所在目录**：src/renderer/src/assets/
- **类型**：全局样式表（设计系统）
- **规模**：约 1541 行（单文件设计系统，随迭代持续增长，不写死行数）

## 1. 作用与职责

| 职责 | 说明 |
| --- | --- |
| 主题变量源 | 在 `:root` 中集中定义背景、品牌色、文字色、辉光、圆角、间距刻度共 22 个 CSS 变量（清单见 §2），是全应用配色的唯一出口 |
| 全局重置与骨架 | `*` 归零、`html/body` 字体与背景、`#app` 与 `.layout` 的 flex 列布局，决定「标题栏 + 侧栏 + 内容区」三段式结构 |
| 通用组件样式 | 卡片、按钮（`.hf-btn`）、文本域、弹窗（`.hf-modal-*`）、进度条、空态提示等跨页面复用类（**下拉不在本文件**：自绘下拉 `HfSelect.vue` 自带 `.hf-sel*` 组件级样式，原 `.hf-select` / `.hgen-select` 已删除） |
| 页面专有样式 | 首页 Hero 与流水线、HTML 生成工作台、字幕/配音、设置页模型卡片等按注释分节组织 |
| 视觉特效库 | 毛玻璃（`backdrop-filter: blur(12px)`）、霓虹辉光（`text-shadow` / `box-shadow`）、渐变文字、扫描线动画 |

页面与样式节的对应关系（据各 `.vue` 模板实际使用的类名）：

| 页面 / 组件 | 主要依赖本文件的节 |
| --- | --- |
| `App.vue` | 全局骨架 `#app` / `.layout`、`.titlebar*`、`.win-btn`、`.sidebar` / `.menu*`、`.content`；自身另有 `<style scoped>` 定义 `.toast-*` |
| `pages/HomePage/index.vue` | `.hero*`（`.hero` / `.hero-tag` / `.hero-sub` 参数行 / `.hero::after`）、`.flow-pipeline` / `.flow-node*`、`.metric-*`、`.proj-grid` / `.proj-card*`（「我的项目」卡片）、`.panel-title` / `.dot` |
| `components/StepBar.vue` | `.project-bar`、`.step-chain`、`.step-node`、`.step-arrow` |
| `pages/HtmlGenPage/index.vue` | `.hgen-*`、`.panel-title` / `.panel-title-sm`、`.proj-*`、`.hg-prev-*`、`.hg-help*`（两个动作按钮**内部**各自的行内帮助 `?`：`.hg-help` / `.hg-help-icon` / `.hg-help-pop`）、`.empty-hint`、`.hf-*`（转视频按钮 `hf-btn` / `hf-btn-primary`、「预览」卡片里的背景音频行 `hf-file`、状态条 `hf-status`）；「转视频」弹窗的外壳复用通用弹窗类 `.hf-modal*`；字幕 / 视频素材 / 背景音频 / 渲染档位四处下拉改用 `components/HfSelect.vue`（样式随组件，不在本文件）；模板中的 `.rate-spinner`（语速控件包裹）在本文件**没有对应规则**，仅作标记、样式由内联 `style` 提供 |
| `pages/VideoPreviewPage/index.vue`（视频预览） | `.hf-toolbar`、`.hf-btn*`、`.hf-video*`、`.hf-status`、`.hf-tip`、`.card.hgen-panel` 外壳与 `.panel-title` |
| `pages/SubtitlePage/index.vue` / `pages/SubtitlePage/TranscribeSection.vue` / `pages/HtmlGenPage/index.vue`（转视频弹窗外壳） | `.model-*`、`.whisper-*`、`.sub-list` / `.sub-row` 等字幕编辑器类、`.hf-modal-*` |
| `pages/TextTtsPage/index.vue` / `pages/TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue` | `.hf-tabs` / `.hf-tab`、`.align-*`、`.sub-textarea`、`.hgen-tip`；四处下拉（音色 / 保存到 / 已生成音频 / 字幕来源 / 映射音色 / 模型）走 `components/HfSelect.vue` |
| `pages/TextTtsPage/VoiceSection.vue`（音色管理，配音页第三个 Tab） | 无专有前缀，复用 `.panel-title`、`.hgen-tip`、`.hf-btn`、`.hgen-input`、`.empty-hint`、`.hf-status`；下拉走 `components/HfSelect.vue` |
| `pages/SettingsPage/index.vue` / `pages/SettingsPage/WhisperSection.vue` | `.model-card.current`、`.model-badge.current`、`.hgen-check`、`.panel-title`；「应用更新」卡片的排障详情块 `.hf-detail`（见 §3） |

## 2. CSS 变量清单

全部定义于 `:root`（设计令牌区，即本文件第一节「深空科技主题（Cyber UI）」）。

| 变量名 | 值 | 用途 |
| --- | --- | --- |
| `--bg-primary` | `#0B1220` | 全局底色、标题栏背景、`body` 渐变的兜底层 |
| `--bg-secondary` | `#111A2C` | 卡片 / 面板 / 下拉框底色 |
| `--bg-sidebar` | `linear-gradient(180deg, #0F172A 0%, #1E293B 100%)` | 左侧菜单栏墨蓝渐变 |
| `--color-primary` | `#00D4FF` | 品牌电子蓝，使用频次最高（44 处），高亮/选中/链接/焦点态 |
| `--color-secondary` | `#8B5CF6` | 量子紫，定义但未通过 `var()` 引用（渐变中直接写死 `#8B5CF6`） |
| `--color-success` | `#00E5A0` | 数据绿：完成态、成功提示、指标数值 |
| `--color-warning` | `#FFB020` | 信号橙，定义但未通过 `var()` 引用（`.align-badge.warn` 用 `rgba(255,176,32,…)` 直写） |
| `--color-danger` | `#FF4D6D` | 警报红：关闭按钮 hover、删除按钮文字 |
| `--text-primary` | `#E6F1FF` | 冰白正文/标题 |
| `--text-secondary` | `#8A9BB5` | 雾蓝次要文字、说明、占位（也是 `.hf-detail` 的正文色） |
| `--glow-primary` | `0 0 8px rgba(0,212,255,0.6)` | 主色辉光，用于文字阴影与按钮 hover |
| `--glow-card` | `0 0 20px rgba(0,212,255,0.15)` | 卡片边框外发光 |
| `--sidebar-width` | `220px` | 侧栏固定宽度 |
| `--radius-card` | `12px` | 卡片圆角 |
| `--radius-btn` | `8px` | 按钮圆角：`.hg-help-pop` 与 `.hf-detail` 的 `border-radius` 走 `var(--radius-btn)`，其余按钮仍直接写 `8px` |
| `--space-1` | `4px` | 极小：图标/徽标内距（定义在注释刻度中，未引用） |
| `--space-2` | `8px` | XS：行内 gap、小标题与内容之间（`.hf-detail` 的内距与上边距也用它） |
| `--space-3` | `12px` | SM：控件行、字段之间、反馈区上方（引用 18 次；`.hf-detail` 左右内距） |
| `--space-4` | `16px` | MD：卡片之间、card 内主区块之间（引用 8 次） |
| `--space-5` | `24px` | LG：大区块、指标区上端 |
| `--space-6` | `32px` | XL：页面级大分区（Hero、流水线区下边距） |
| `--spacing-base` | `8px` | 间距基准，兼容旧写法，定义但未通过 `var()` 引用 |

间距规范（源码注释原文）：区块/区块用 MD；控件行内用 SM；标题下用 XS；页面大分区用 LG/XL。

变量区块原文（节选，括号内为被注释分组的顺序）：

```css
:root {
  /* 背景 */
  --bg-primary:      #0B1220;
  --bg-secondary:    #111A2C;
  --bg-sidebar:      linear-gradient(180deg, #0F172A 0%, #1E293B 100%);

  /* 品牌色 */
  --color-primary:   #00D4FF;
  --color-secondary: #8B5CF6;
  --color-success:   #00E5A0;

  /* 辉光 */
  --glow-primary:    0 0 8px rgba(0,212,255,0.6);
  --glow-card:       0 0 20px rgba(0,212,255,0.15);

  /* 布局 */
  --sidebar-width: 220px;
  --radius-card: 12px;
  --radius-btn: 8px;
}
```

## 3. 样式分区地图

按文件中的 `/* ===== xxx ===== */` 注释分节整理。**一律不标行号**：行号随迭代持续漂移、且各节长度不均匀，节标题与出现顺序才是稳定坐标；少数没有 `=====` 分节头的小块（基础重置 / 全局骨架 / 卡片面板）以及带普通注释的小块（如「选中态」「转录无百分比进度」）也一并列出，分别标为「（无注释）」与「（注释）」。

| 节标题（注释原文） | 主要选择器 | 说明 |
| --- | --- | --- |
| （无注释）基础重置 | `*` | `margin/padding` 归零，`box-sizing: border-box` 全局盒模型 |
| 深空科技主题（Cyber UI） | `:root` | 全部设计令牌，含 4px 基准的间距刻度注释 |
| （无注释）全局骨架 | `html, body`、`body`、`#app`、`.layout` | 字体族 `"Microsoft YaHei UI", "PingFang SC"`；`body` 叠两层径向渐变（右上电子蓝、左下量子紫）；`#app` 承接 flex 列布局，`.layout` 为 `flex:1; min-height:0` 的可滚动宿主 |
| 自绘标题栏（深空科技风格） | `.titlebar`、`.titlebar-left`、`.titlebar-logo`、`.titlebar-title`、`.titlebar-controls`、`.win-btn`、`.win-btn svg`、`.win-close` | 40px 高；`-webkit-app-region: drag` 拖拽，控制区改回 `no-drag`；Logo 用 `drop-shadow` 发光；`.win-close:hover` 变警报红并加红色辉光 |
| 左侧菜单（文字菜单） | `.sidebar`、`.logo`、`.menu`、`.menu-item`、`.menu-item:hover`、`.menu-item.active` | 220px 宽墨蓝渐变；选中态用 3px 电子蓝左边框 + 90° 渐隐高亮 + 文字辉光 |
| 右侧内容区 | `.content`、`.content::-webkit-scrollbar`、`.content h1`、`.content p` | `padding:32px`；隐藏滚动条（`scrollbar-width:none`）；`h1` 24px 带 12px 半径辉光；`p` 行高 1.8 |
| （无注释）卡片 / 面板（毛玻璃） | `.card` | `--bg-secondary` 底 + 半透明描边 + `--radius-card` + `backdrop-filter: blur(12px)` |
| 首页 Hero 横幅 | `.hero`、`.hero::after`、`@keyframes heroScan`、`.hero-tag`、`.hero h1`、`@keyframes heroFlow`、`.hero p`、`.hero-sub` | 16px 圆角双色渐变；`::after` 斜向扫描光带 4s 循环；`h1` 三色渐变文字 200% 背景位移动画 6s 循环。`.hero-sub` 是 hero 底部参数行（12px `!important`、`letter-spacing:1px`、`opacity:.75`、`margin-top:6px`），排在 `.hero p` 之后，用来放「CYBER UI · 深空科技 视觉主题 · 语音识别与视频渲染均在本机完成」 |
| 流水线节点卡片 | `.flow-pipeline`、`.flow-node`、`.flow-node:hover`、`.flow-node-index`、`.flow-node h3`、`.flow-node p`、`.flow-arrow` | flex 等分节点；hover 上浮 4px 并叠加双层辉光；序号块用 JetBrains Mono + 内阴影 |
| 数据指标卡 | `.metric-grid`、`.metric-card`、`.metric-value`、`.metric-label` | 4 列 grid；指标卡描边/辉光改用数据绿；数值 26px 等宽字体 |
| 首页 · 我的项目卡片（只选择 / 打开，新建入口在顶部工作项目栏） | `.proj-grid`、`.proj-card`、`.proj-card:hover`、`.proj-card-name`、`.proj-card-meta`、`.proj-card-meta .on`、`.proj-card-time` | `repeat(auto-fill, minmax(220px, 1fr))` 卡片网格；卡片主色描边 + 蓝紫渐变底，hover 上移 2px 并加卡片辉光；项目名主色 + `word-break: break-all`，状态标记（HTML / 视频 / 字幕）命中时 `.on` 转数据绿，时间行为更淡的雾蓝 |
| 预览 / HyperFrames 转视频 | `.hf-toolbar`、`.hf-btn`、`.hf-btn:hover:not(:disabled)`、`.hf-btn:disabled`、`.hf-btn-primary`、`.hf-file`、`.hf-status` / `.hf-ok` / `.hf-error`、`.hf-detail`、`.hf-video-wrap`、`.hf-video`、`.hf-video-actions`、`.hf-tip` | 全应用主按钮体系：`.hf-btn` 描边蓝，`.hf-btn-primary` 蓝紫渐变 + 深色文字（hover 换更亮的同色渐变 `#33ddff → #a078ff`，**必须重写 `background`**：基础 `.hf-btn:hover:not(:disabled)` 特异性 0,3,0 高于 `.hf-btn-primary` 的 0,1,0，不重写就会被它那层半透明青色填充顶掉、整块渐变变暗青绿；也不要改用 `filter: brightness()`）；`.hf-file` 单行省略号；状态文字按 `.hf-ok` / `.hf-error` 变色发光；**`.hf-detail` 紧跟在 `.hf-status.hf-error` 之后定义**，是排障详情的折叠块（等宽字体 + `pre-wrap` + 可选中复制，见 3.1）。（原置于本节的 `.hf-select` 已删除，下拉改由 `components/HfSelect.vue` 自带样式。）现由 `pages/VideoPreviewPage/index.vue`（工具栏 / 成品播放器 / 定位按钮 / 状态条）、`pages/HtmlGenPage/index.vue`（转视频按钮、「转视频」弹窗里的档位控件、「预览」卡片里的背景音频行、状态条）与 `pages/SettingsPage/index.vue`（「应用更新」卡片的状态行与 `.hf-detail` 详情块）共同使用 |
| 项目链路状态条（贯通各页，两行：上流程链 / 下工作项目切换） | `.project-bar`、`.project-bar-row`、`.step-chain`、`.step-node`、`.step-node.clickable`、`.step-node .step-dot`、`.step-node.done`、`.step-node.active-now`、`@keyframes stepPulse`、`.step-arrow` | 胶囊节点 + 圆点状态机：灰点（未开始）/ 绿点（完成）/ 蓝点脉冲（进行中）；`.clickable` 才可点，hover 变主色 |
| 配音页 Tab 切换 | `.hf-tabs`、`.hf-tab`、`.hf-tab:hover`、`.hf-tab.active` | 999px 胶囊 Tab；选中态蓝底 + `0 0 10px` 辉光 |
| HTML 生成页（与紧随其后的「行内帮助」小节交错，无法用单一区间表示） | `.hgen-grid`、`.panel-title`、`.panel-title .dot`、`.hgen-subtitle`、`.hgen-input`、`.hgen-row`、`.hgen-actions`、`.hgen-tip`、`.hgen-tip code` | 左右两栏 grid；面板标题带发光小圆点——**`.panel-title` 与 `.panel-title .dot` 已全局化**（不再限定在 `.hgen-panel` 之内，任何 `div.card.hgen-panel` 里的标题都直接可用；`.dot` 另加 `flex: none`，避免圆点被 flex 压缩变形）；`.hgen-subtitle` 为 260px 高可纵向拉伸文本域，`#0A1120` 深底；`:focus` 变主色描边 + 辉光。**注意**：本节规则被下面的「行内帮助」小节（`.hg-help*`）从中间分开——`.hgen-actions` 之后插入 `.hg-help*` 组，`.hgen-tip` / `.hgen-tip code` 仍属本节但排在其后。（原 `.hgen-select` 已删除：所有下拉改用 `components/HfSelect.vue`，其触发器视觉即沿用本节的深底 + 主色描边风格。） |
| 行内帮助：`?` 图标 + 悬浮说明（放在按钮内部：每个动作各带一个 `?`） | `.hg-help`、`.hg-help-icon`、`.hg-help:hover .hg-help-icon`、`.hg-help-pop`、`.hg-help:hover .hg-help-pop`、`.hg-help-pop b` | **每个动作按钮内部各一个** `?` 图标 + 悬浮说明：16px 圆形、字号 11px、字重 700、`color: currentColor` + `1px solid currentColor` 描边（跟随按钮文字色）、`opacity:.75` → hover `1` + `rgba(255,255,255,.22)` 底；包裹层 `margin-left:6px`、`vertical-align:middle`、`flex:none`；气泡 320px 宽、`--radius-btn` 圆角、`rgba(11,18,32,.98)` 底 + 半透明主色描边 + `--glow-card` 辉光、12px / 行高 1.8，锚 `left:0`（向右展开）、`bottom:calc(100% + 8px)`；默认 `opacity:0` + `visibility:hidden` + `pointer-events:none`，`.hg-help:hover` 时显示，`z-index:30`；因气泡位于 `<button>` 内，额外重置 `font-weight:400` / `text-align:left` / `white-space:normal`；正文关键词用 `b` 加粗并转主色 |
| HTML 工作台：分区小标题 + 源码编辑器 | `.panel-title-sm`、`.hgen-source`、`.hgen-source:focus`、`.hgen-source:disabled` | 通用小标题类（主色、13px、600）；源码编辑器 `min-height:320px`、`tab-size:2`、Consolas 等宽、`resize: vertical` |
| 项目详情小卡 | `.proj-meta`、`.proj-stat`、`.proj-stat b`、`.proj-stat.on` | `auto-fit, minmax(130px, 1fr)` 自适应栅格；`.on` 状态切为数据绿 |
| 预览画布 | `.hgen-frame-wrap`、`.hgen-frame` | 容器 `padding-bottom:56.25%` 撑 16:9；内部 iframe 恒为 1920×1080 原生视口，`transform-origin: 0 0` 由 JS 设 `transform: scale` 等比缩放 |
| 预览播放控制条（进度条 + 暂停/播放 + 重新播放） | `.hg-prev-ctl`、`.hg-prev-bar`、`.hg-prev-bar-fill`、`.hg-prev-time`、`.empty-hint` | 进度条渐变填充 + 辉光，`transition: width .25s linear`；时间用 `font-variant-numeric: tabular-nums` 防抖动；`.empty-hint` 为虚线空态框 |
| 首页流水线节点状态 | `.flow-node.flow-done`、`.flow-badge` | 完成节点绿描边；`.flow-badge` 绿色胶囊徽标 |
| HTML 生成/修改：需求输入区块 + 设置页复选框 | `.hgen-block`、`.hgen-block .panel-title-sm`、`.hgen-check`、`.hgen-check input[type="checkbox"]` | 区块上边距统一由 `--space-4` 控制；复选框用 `accent-color: var(--color-primary)` 换成电子蓝 |
| 字幕生成（whisper.cpp）：模型档位卡片 | `.model-grid`、`.model-card`、`.model-card:hover`、`.model-card.downloaded`、`.model-head`、`.model-name`、`.model-badge` / `.ok`、`.model-meta`、`.model-url`、`.model-desc`、`.model-actions` | `auto-fill, minmax(210px,1fr)` 栅格；已下载态整卡转绿；URL 文字 `user-select: text` 可复制 |
| 字幕生成（whisper.cpp）：下载进度条 | `.whisper-bar-wrap`、`.whisper-bar`、`.whisper-bar-fill` / `.error` / `.done` | 三态配色：默认蓝、错误红、完成绿；填充 `transition: width .15s ease` |
| 字幕写入方式切换（逐条编辑 / 纯文本）与纯文本域 | `.sub-mode-btn.active`、`.sub-textarea`、`.sub-textarea:focus` | 切换按钮复用 `.hf-btn` 基类，`.active` 追加 25% 蓝底与 `--glow-primary` |
| 字幕生成（whisper.cpp）：转录状态 | `.whisper-tip`、`.whisper-tip code` | 低透明度说明文字；`code` 为蓝色内联代码芯片 |
| （注释）选中态：当前转录所用模型档位 | `.model-card.selected`、`.model-card.selected::after` | 双层描边 + 辉光；`::after` 用 `content:'转录使用'` 生成右上角标签（`border-radius: 0 10px 0 8px` 单向圆角） |
| 设置页：语音识别模型 | `.model-card.current`、`.model-card.current .model-name`、`.model-badge.current` | 当前生效项：蓝描边；徽标反色为蓝底深字 |
| 字幕编辑器：条目列表 | `.sub-list`(`::-webkit-scrollbar-thumb/track`)、`.sub-empty`、`.sub-row`、`.sub-row:hover`、`.sub-idx`、`.sub-time`、`.sub-arrow`、`.sub-text`、`.sub-del`、`.sub-count`、`.sub-note` | 列表 `max-height:420px` 区内滚动（避免整页滚动），并单独美化滚动条；每行 = 序号 + 起止时间输入 + 箭头 + 文本域 + 删除按钮；`.sub-del` 复用危险红 |
| 通用弹窗（转录弹窗） | `.hf-modal-mask`、`.hf-modal`、`.hf-modal-head`、`.hf-modal-title`、`.hf-modal-close`、`.hf-modal-body`、`.hf-modal-foot`、`.tw-model`、`.tw-link` | 固定定位遮罩（`z-index: 9000`、`rgba(5,10,20,0.72)`）；弹窗 `width: min(640px, 92vw)`、`max-height: 86vh`、头部渐变；`.tw-link` 用 `margin-left:auto` 右推。**两个使用方**：`pages/SubtitlePage/TranscribeSection.vue`（从音频生成字幕）与 `pages/HtmlGenPage/index.vue`（转视频，仅用行内 `style` 把宽度收窄为 `min(520px, 92vw)`，未新增类）。（源码里本节注释头紧贴「设置页：左侧分类 + 右侧内容」的注释头，而 `.hf-modal-*` 规则体排在该设置页样式块之后。） |
| 设置页：左侧分类 + 右侧内容 | `.settings-layout`、`.settings-nav`、`.settings-nav-item`、`.settings-nav-item:hover`、`.settings-nav-item.active`、`.settings-nav-dot`、`.settings-content` | 页面内的局部导航：左侧 `150px` 分类列（`gap:2px`）+ 右侧内容区；刻意压低视觉重量（无卡片底色、无辉光），与全局侧栏菜单的渐变卡片感区分开，避免「两层导航」的观感；选中项 = 主色 2px 左边框 + 90° 渐隐高亮；`.settings-nav-dot` 是「应用更新」分类上的主色小点（有新版本时才点）；`.settings-content` 用 `flex:1; min-width:0` 占满剩余宽度，窄屏下卡片不被挤压 |
| （注释）转录无百分比进度：不确定态条纹滑动 | `.whisper-bar.indeterminate .whisper-bar-fill` | 宽度锁定 38%（`!important`）+ 1.1s 往返平移动画 |
| 字幕配音（逐句对齐）：结果明细 | `.align-row`、`.align-idx`、`.align-txt`、`.align-time`、`.align-dur`、`.align-badge` / `.ok` / `.warn`、`@keyframes whisper-slide` | 单行结果行：序号 / 文本（省略号截断）/ 时间 / 时长；徽标区分正常与告警（橙） |

> 说明：**toast**（`.toast-host` / `.toast-item`）与 **音色管理**卡组并无本文件专有选择器。toast 样式定义在 `src/renderer/src/App.vue` 的 `<style scoped>` 中；音色管理（`pages/TextTtsPage/VoiceSection.vue`，配音页第三个 Tab，原 `pages/SoundCopyPage/index.vue`）直接复用本文件的 `.card`、`.panel-title`、`.hgen-tip`、`.hf-btn`、`.hgen-input` 等通用类，未新增前缀。预览 / 转视频相关样式即上表的 `hf-*` 节（`main.css` 注释标题为「预览 / HyperFrames 转视频」，排在「首页 · 我的项目卡片（只选择 / 打开，新建入口在顶部工作项目栏）」节之后），该节现由 `pages/VideoPreviewPage/index.vue`（工具栏 / 成品播放器 / 定位按钮）、`pages/HtmlGenPage/index.vue`（「转视频」按钮与弹窗里的档位控件）与 `pages/SettingsPage/index.vue`（状态行与 `.hf-detail`）共同使用。下拉控件（`.hf-sel*`）的样式在 `components/HfSelect.vue` 内（含一个**非 scoped** 的 `<style>` 块，因为弹层经 Teleport 挂到 `body`），本文件已无下拉选择器。

### 3.1 关键实现片段

首页 Hero 的扫描光带与渐变流光标题（节：**首页 Hero 横幅**）：

```css
.hero::after {
  content: '';
  position: absolute;
  background: linear-gradient(105deg, transparent 40%, rgba(0, 212, 255, 0.18) 50%, transparent 60%);
  animation: heroScan 4s linear infinite;
  pointer-events: none;   /* 不遮挡内部按钮点击 */
}
.hero h1 {
  background: linear-gradient(90deg, #00D4FF, #8B5CF6, #00D4FF);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;   /* 渐变文字必备双写 */
}
/* hero 参数行：说明视觉主题与本机处理特性，比正文小一档、更淡一档 */
.hero-sub {
  margin-top: 6px;
  font-size: 12px !important;             /* 它也是 .hero 下的 <p>，要压过 .hero p 的 14px */
  letter-spacing: 1px;
  opacity: 0.75;
}
```

step-node 的三态状态机（节：**项目链路状态条（贯通各页，两行：上流程链 / 下工作项目切换）**）：

```css
.step-node .step-dot { background: #3a4a61; }                       /* 未开始：灰 */
.step-node.done .step-dot { background: var(--color-success); }      /* 已完成：绿 + 辉光 */
.step-node.active-now .step-dot {                                    /* 进行中：蓝 + 脉冲 */
  background: var(--color-primary);
  animation: stepPulse 1.4s ease-in-out infinite;
}
```

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

## 4. 命名与约定

| 前缀 / 命名族 | 出现节 | 含义 |
| --- | --- | --- |
| `hf-*` | 预览转视频、配音 Tab、弹窗 | 与 HyperFrames / 配音通用控件相关：`hf-btn`（通用按钮基类）、`hf-file`、`hf-status`、`hf-detail`（排障详情折叠块）、`hf-video`、`hf-tabs`/`hf-tab`、`hf-modal-*`（下拉的 `hf-sel*` 前缀不在本文件，属 `components/HfSelect.vue`） |
| `hgen-*` | HTML 生成页与工作台 | HTML Generation：`hgen-grid`、`hgen-panel`、`hgen-subtitle`、`hgen-input`、`hgen-row`、`hgen-actions`、`hgen-tip`、`hgen-source`、`hgen-block`、`hgen-check`、`hgen-frame-wrap`、`hgen-frame`（`hgen-select` 已删除） |
| `hg-prev-*` | 预览播放控制条 | HTML 预览专属：`hg-prev-ctl`、`hg-prev-bar`、`hg-prev-bar-fill`、`hg-prev-time` |
| `hg-help*` | HTML 生成页两个动作按钮**内部** | 行内帮助（`?` 图标 + 悬浮说明，**每个动作按钮里各一个**）：`hg-help`（相对定位包裹，`margin-left:6px` / `vertical-align:middle`）、`hg-help-icon`（16px 圆形 `?`，`currentColor` 描边与文字，默认 `opacity:.75`）、`hg-help-pop`（320px 说明气泡，锚 `left:0` 向右展开）；显示 / 隐藏靠 `.hg-help:hover` 后代选择器，不使用修饰类；因位于 `<button>` 内，气泡另重置 `font-weight:400` / `text-align:left` / `white-space:normal` |
| `step-*` / `project-bar*` | 项目链路状态条 | 流程链：`project-bar`、`project-bar-row`、`step-chain`、`step-node`、`step-dot`、`step-arrow`；状态用**修饰类**而非新前缀：`.done`、`.active-now`、`.clickable` |
| `sub-*` | 字幕编辑器与字幕写入方式 | Subtitle：`sub-list`、`sub-row`、`sub-idx`、`sub-time`、`sub-arrow`、`sub-text`、`sub-del`、`sub-count`、`sub-note`、`sub-empty`、`sub-textarea`、`sub-mode-btn` |
| `model-*` | whisper 模型档位卡片 | 模型卡片及其内部件：`model-grid`、`model-card`、`model-head`、`model-name`、`model-badge`、`model-meta`、`model-url`、`model-desc`、`model-actions`；状态类为 `.downloaded` / `.selected` / `.current` |
| `whisper-*` | 下载进度与转录提示 | `whisper-bar-wrap`、`whisper-bar`、`whisper-bar-fill`、`whisper-bar-text`、`whisper-tip`；状态类 `.error` / `.done` / `.indeterminate` |
| `align-*` | 逐句对齐结果 | `align-row`、`align-idx`、`align-txt`、`align-time`、`align-dur`、`align-badge`（`.ok` / `.warn`） |
| `flow-*` / `metric-*` | 首页 | 流水线节点：`flow-pipeline`、`flow-node`、`flow-node-index`、`flow-arrow`、`flow-badge`、`.flow-done`；指标：`metric-grid`、`metric-card`、`metric-value`、`metric-label` |
| `titlebar-*` / `win-*` | 自绘标题栏 | 窗口框架：`titlebar-left`、`titlebar-logo`、`titlebar-title`、`titlebar-controls`；`win-btn`、`win-close` |
| `proj-*` / `tw-*` | 项目详情卡 / 转录弹窗 | `proj-meta`、`proj-stat`；`tw-model`、`tw-link` |
| 无前缀通用类 | 全局 | `layout`、`sidebar`、`logo`、`menu`、`menu-item`、`content`、`card`、`hero*`、`panel-title-sm`、`empty-hint` |

约定要点：

- **状态一律用修饰类**（`.active`、`.done`、`.current`、`.selected`、`.downloaded`、`.ok`、`.warn`、`.error`），不引入新的前缀族；组合选择器写成 `.model-card.downloaded .model-name` 形式。
- **未启用 BEM**，采用「前缀 + 短横线 + 语义词」的扁平命名，层级靠后代选择器（如 `.hgen-block .panel-title-sm`）表达；但**全局通用类不再套页面前缀**（`.panel-title` / `.panel-title .dot` 已从 `.hgen-panel` 限定中解放出来，可直接给任何卡片使用）。
- 颜色几乎不写死，统一走 `var(...)`；少数渐变与半透明描边直接写 `rgba(0,212,255,…)` 字面量。
- 两种典型组合写法：

```css
/* 基类 + 状态修饰类（页面模板里 hf-btn 与 hf-btn-primary 同时挂） */
.hf-btn { border: 1px solid rgba(0, 212, 255, 0.4); }
.hf-btn-primary { background: linear-gradient(135deg, #00d4ff, #8b5cf6); }

/* 后代选择器限定作用域，避免污染同名类 */
.panel-title { font-size: 12px; letter-spacing: 2px; }   /* 全局通用，不再套 .hgen-panel 前缀 */
.hgen-block  .panel-title-sm { margin-top: 0; }
```

## 5. 依赖与协作

- **唯一全局入口**：`src/renderer/src/main.ts` 第 4 行 `import './assets/main.css'`，在 `createApp(App).mount('#app')` 之前引入，因此所有页面组件默认继承这套全局类与变量。
- **组件样式现状**：绝大多数页面与子组件**没有 `<style>` 块**，视觉完全依赖本文件的类名与变量；只有少数自带局部 `<style>` 的组件（如 `App.vue` 的 `.toast-*`、自绘下拉组件自己的 `.hf-sel*`）在本文件之外补充私有类，改动这些组件的视觉时要去组件内部找。
- **与 scoped 样式的配合**：Vue 的 scoped 只给组件自身模板元素加 `data-v-*` 属性，本文件作为全局样式**不受影响**，可继续为组件内元素提供基础样式；反过来，本文件的选择器无法命中 scoped 组件内部的深层结构，因此组件内的微调应写在组件自己的 scoped 块中。
- **变量是组件行内样式的桥梁**：多个组件直接在模板 `style` 属性中引用本文件变量（如 `style="color:var(--text-secondary)"`），因此修改变量值即可全局换肤。
- **类名复用是主要协作方式**：新页面优先复用 `.card`、`.panel-title`、`.hf-btn`、`.hf-btn-primary`、`.hgen-input`、`.hgen-tip`、`.empty-hint` 等既有类，而非新增样式块。
- **JS 与 CSS 的契约**：`.hgen-frame` 的缩放依赖 JS 写 `transform: scale(...)`（容器已固定 `transform-origin: 0 0`）；`.hg-prev-bar-fill`、`.whisper-bar-fill` 的宽度依赖 JS 写 `style.width`；动画类 `.indeterminate` 依赖 JS 切换；`.hf-detail` 的显隐由 Vue 的 `v-if` 控制（`updateDetail && showUpdateDetail`），样式本身不含任何显隐逻辑。
- **与 `AGENTS.md` 的主题规范一致**：变量名与取值同项目根目录科技主题设计规范逐条对应，本文件是那份规范的落地实现。

## 6. 注意事项与实现要点

- **`!important` 共两处**：`.hero-sub { font-size: 12px !important; }`（hero 参数行本身也是 `.hero` 下的 `<p>`，不压过 `.hero p` 的 14px 就显不出「小一档」）与 `.whisper-bar.indeterminate .whisper-bar-fill { width: 38% !important; }`（用于压过 JS 写入的行内 `width`，保证不确定态进度条纹动画宽度稳定）。
- **滚动条策略分两级**：内容区 `.content` 用 `scrollbar-width: none` + `.content::-webkit-scrollbar { display: none }` 彻底隐藏（滚动仍可用）；而 `.sub-list` 保留 8px 自绘滚动条（蓝色半透明 thumb，hover 加深），用于提示「区内还有更多条目」。
- **毛玻璃写法固定为双写**：`backdrop-filter: blur(12px)` 后紧跟 `-webkit-backdrop-filter`，出现在 `.card`、`.flow-node`、`.metric-card` 三处，缺一不可。
- **辉光三种实现**：文字辉光用 `text-shadow: var(--glow-primary)`；组件外发光用 `box-shadow: var(--glow-card)` 或 `0 0 Npx rgba(...)`；图标发光用 `filter: drop-shadow(...)`（如 `.titlebar-logo`）。
- **动画共 4 个 keyframes**：`heroScan`（Hero 扫描光带，4s linear infinite）、`heroFlow`（渐变标题背景位移，6s linear infinite）、`stepPulse`（进行中节点蓝点脉冲，1.4s ease-in-out infinite）、`whisper-slide`（不确定进度往返，1.1s）。全部为**无限循环的装饰性动画**，无 JS 驱动，需注意长时间运行下的重绘开销。
- **性能敏感属性**：被动画的属性为 `transform`、`background-position`、`box-shadow`、`margin-left`；其中 `box-shadow` 与 `margin-left` 会触发布局/重绘，属可接受的装饰性取舍。
- **过渡时长成体系但不统一**：`0.15s`（窗口按钮、下载进度）、`0.18s`（模型卡片描边）、`0.2s`（菜单项、按钮、流水线悬浮）、`0.25s`（预览进度条）。简写 `transition: all 0.2s` 出现在 `.hf-btn`、`.step-node` 等处，改动时注意它会连带过渡 width 等属性。
- **响应式**：本文件**不含任何 `@media` 查询**，也不含容器查询。自适应完全靠 flex（`.hf-toolbar`、`.project-bar-row`、`.step-chain` 的 `flex-wrap: wrap`）、grid（`.metric-grid` 固定 4 列；`.model-grid`、`.proj-meta` 用 `auto-fit/auto-fill + minmax`）与 `min()` 宽度（`.hf-modal` 的 `min(640px, 92vw)`）实现；`.sub-list` 用 `max-height` 限制高度。
- **固定视口的特例**：`.hgen-frame` 强制 `1920px × 1080px` 且 `border: none`，与转视频 1080P 输出保持一致；不要给它加响应式宽度，缩放交给 JS 的 `transform`。
- **深色专属假设**：所有颜色按深底亮字设计（如 `.hf-btn-primary` 文字为 `#03131a` 深色、`.model-card.selected::after` 文字为 `#06121F`）。若要做亮色模式，按项目 `AGENTS.md` 约定在 `:root[data-theme="light"]` 覆盖变量，但上述写死的深色字值需要一并调整。
- **已定义但未使用的变量**：`--color-secondary`、`--color-warning`、`--space-1`、`--spacing-base`（`--radius-btn` 自「行内帮助」小节起被 `.hg-help-pop` 引用、现又用于 `.hf-detail`，已不在其中）。使用它们不会报错，但当前视觉结果与写死值一致；新增样式建议优先复用已有变量以保持一致性。
- **`.hf-detail` 的取舍**（2026-10 新增）：内容是原始报错（HTTP 状态 / AccessDenied 原文 / 请求地址），故用比正文更弱一档的色阶（`--text-secondary` + `rgba(11,18,32,.6)` 底）避免抢状态行的视线；`white-space: pre-wrap` + `word-break: break-all` 让长 URL 不撑破卡片，`user-select: text` 让用户能直接复制原始报错交给发布者。它**只做样式**，显隐与内容全部由页面（`SettingsPage` 的 `v-if` + `{{ updateDetail }}`）控制。
- **类名缺口**：`.sel-label` 在多处页面模板中使用，但本文件未定义其样式（仅有 `.panel-title`、`.panel-title-sm` 等相近类），排查「标签样式不生效」时需注意。

修改本文件的推荐步骤：

1. 新增颜色/间距前，先在 `:root` 设计令牌区确认是否已有可用变量，避免重复造令牌。
2. 按归属节就近插入样式，并补上 `/* ===== ... ===== */` 分节注释，保持本文件的「分区地图」可读性。
3. 状态变化一律新增修饰类（如 `.model-card.xxx`），不要改基类默认值，避免影响其他页面。
4. 需要响应式时优先加 `flex-wrap` / `minmax` / `min()`，保持本文件「零 media query」的现状。
