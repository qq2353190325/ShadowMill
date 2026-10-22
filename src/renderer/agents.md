---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_52811566ac7911f18039525400461939
    ReservedCode1: ARZsSCx1JqRgd8zwDJvTxlLjg4YQWdGbHp2ftxxdXZCNWqWCMTHxq6VSJV7GKArzjd/BjKa0OqrFf2HZs41Y2dTB9yB+XiedGLV4OwXyUgDM6O2NsCPcfUJ3KIaX0t+fvzz8NZi93WiduvxA6S4hjvj5KxWsYN6qKZPnQwdMbDpJcSw44a6swD/6sUE=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_52811566ac7911f18039525400461939
    ReservedCode2: ARZsSCx1JqRgd8zwDJvTxlLjg4YQWdGbHp2ftxxdXZCNWqWCMTHxq6VSJV7GKArzjd/BjKa0OqrFf2HZs41Y2dTB9yB+XiedGLV4OwXyUgDM6O2NsCPcfUJ3KIaX0t+fvzz8NZi93WiduvxA6S4hjvj5KxWsYN6qKZPnQwdMbDpJcSw44a6swD/6sUE=
---

# 科技主题设计规范（Tech Theme）

本文件定义 Electron 项目「影坊（ShadowMill）」的科技主题设计方案，包含主题定位、配色体系、字体与间距、组件风格，以及可直接落地的 CSS 变量。

## 1. 主题定位

- 主题名：**Cyber UI / 深空科技**
- 风格关键词：深色为主、冷色调、玻璃拟态（Glassmorphism）、霓虹辉光（Neon Glow）、数据感、未来感
- 适用场景：数据看板、管理后台、开发工具类桌面应用

## 2. 配色体系

### 2.1 主色板

| 用途 | 颜色 | 色值 | 说明 |
|------|------|------|------|
| 主背景 | 深邃黑蓝 | `#0B1220` | 全局底色，接近夜空 |
| 次背景 | 深灰蓝 | `#111A2C` | 卡片 / 面板底色 |
| 侧栏背景 | 墨蓝渐变 | `#0F172A → #1E293B` | 左侧菜单栏 |
| 主色调 | 电子蓝 | `#00D4FF` | 品牌色，用于高亮、选中态 |
| 辅色调 | 量子紫 | `#8B5CF6` | 次级强调、渐变辅助 |
| 成功 | 数据绿 | `#00E5A0` | 在线状态、成功反馈 |
| 警告 | 信号橙 | `#FFB020` | 提醒、待处理 |
| 危险 | 警报红 | `#FF4D6D` | 错误、删除 |
| 主文字 | 冰白 | `#E6F1FF` | 正文/标题 |
| 次文字 | 雾蓝 | `#8A9BB5` | 说明、次要信息 |

### 2.2 渐变

- 主按钮渐变：`linear-gradient(135deg, #00D4FF 0%, #8B5CF6 100%)`
- 侧栏渐变：`linear-gradient(180deg, #0F172A 0%, #1E293B 100%)`
- 选中项高亮：`linear-gradient(90deg, rgba(0,212,255,0.25) 0%, rgba(0,212,255,0) 100%)`

### 2.3 辉光（Glow）效果

- 主色调辉光：`0 0 8px rgba(0,212,255,0.6)`
- 卡片边框辉光：`0 0 20px rgba(0,212,255,0.15)`

## 3. 字体与排版

- 中文字体：`"Microsoft YaHei UI", "PingFang SC", sans-serif`
- 等宽数字/代码：`"JetBrains Mono", "Consolas", monospace`
- 标题字重 600，颜色冰白 `#E6F1FF`；说明文字颜色雾蓝 `#8A9BB5`
- 行高：正文段落 1.7~1.8；控件 / 表格行 1.4

### 3.1 字号刻度（新增文字只能从这些档位里选）

| 档位 | 字号 | 落地示例 |
|------|------|----------|
| 展示 | 28px | 首页 Hero 标题 `.hero h1` |
| 页面标题 | 24px | 内容区 `h1`（`.content h1`） |
| 区块标题 | 18px / 15px | 侧栏 Logo（18px）、节点卡片标题（`.flow-node h3` 15px） |
| **正文（基准）** | **14px** | 段落 `.content p` / `.hero p`、列表主信息（`.model-name` / `.proj-card-name`）、弹窗标题、源码与多行文本区 |
| 控件 / 表格行 | 13px | 表单控件（`.hgen-input` / `.sub-textarea`）、按钮 `.hf-btn`、标签 `.sel-label`、Tab `.hf-tab`、数据表行（`.sub-text`）、下拉 `.hf-sel` 触发器与弹层 |
| 说明 | 12px | 面板标题 `.panel-title`、表头、提示 `.hgen-tip` / `.hf-status`、次要列（`.model-meta` / `.sub-time` / `.proj-stat`）、指标单位 |
| 最小 | 11px（个别 10px） | 徽标 `.model-badge` / `.flow-badge`、`?` 图标 `.hg-help-icon`、版本号 |

- 字号**没有** CSS 变量（与配色 / 间距不同），按上表直接写 px。
- 不要写刻度外的值（存量例外：`.model-url` 的 10.5px），也不要为了「看起来大一点」临时放大某一处。

### 3.2 基准字号与「不许依赖浏览器默认」（必须遵守）

- **全局基准写在 `src/renderer/src/assets/main.css` 的 `html, body { font-size: 14px }`**，即刻度里的「正文」档；任何没显式声明字号的文字最差也是 14px。
- **承载文字的元素必须显式落在某一档，不允许依赖浏览器默认字号**：Chromium 默认 16px，只要某个容器（卡片、列表行、弹层）没写字号、又没接上基准，里面的文字就会比相邻的 12px 表头 / 13px 按钮大一圈——「我的音色」列表行的音色名（16px）就是这么冒出来的，`.sel-label` 当年也是同一类问题。
- 兜底不等于免写：基准只保证「最差 14px」，局部要更小（表格行 13px、次要列 12px）必须自己显式声明。
- 弹层 / Teleport 到 `<body>` 的内容继承不到组件根上的字号，必须在弹层根节点显式写（见 `components/HfSelect.vue` 的 `.hf-sel-menu` 注释）。

## 4. 间距与圆角

- 侧栏宽度：220px
- 内容区内边距：32px
- 卡片圆角：12px
- 按钮圆角：8px
- 元素间距基准：8px / 12px / 16px / 24px / 32px

## 5. 组件风格

### 5.1 菜单项

- 默认：文字雾蓝，hover 背景 `rgba(255,255,255,0.06)`
- 选中：文字冰白 + 左侧 3px 电子蓝指示条 + 渐变高亮背景

### 5.2 卡片

- 背景深灰蓝 `#111A2C`，1px 半透明描边，12px 圆角，带 4px 数据绿辉光边框（数据卡片）
- 建议采用毛玻璃效果：`backdrop-filter: blur(12px)`

### 5.3 按钮

- 主要按钮：电子蓝→量子紫渐变底，深色文字 `#03131a`；hover 换成更亮的同色渐变（`#33ddff → #a078ff`）并提升外发光
- 次要按钮：透明底 + 1px 雾蓝描边；hover 半透明主色填充 + 主色辉光
- **主按钮 hover 必须重写 `background`**：基础 `.hf-btn:hover:not(:disabled)`（特异性 0,3,0）高于 `.hf-btn-primary`（0,1,0），不重写渐变就会被那层半透明青色填充顶掉（整块变暗青绿）；也不要改用 `filter: brightness()` 代替

### 5.4 数据指标

- 数值用等宽字体 + 电子蓝辉光，单位用雾蓝小字

### 5.5 行内帮助（`?` 图标 + 悬浮说明）

落地见 `src/renderer/src/assets/main.css` 的 `.hg-help*`（实例见 `pages/HtmlGenPage/index.vue`）。

- 包裹层：`display: inline-flex` + `align-items: center` + `flex: none` + `margin-left: 6px` + `vertical-align: middle`
- 图标：16px 圆形 `?`，字号 11px、字重 700，`color: currentColor` + `1px solid currentColor`（跟随按钮文字色：主按钮渐变底/深色字、次要按钮透明底/主色字都能看清），默认 `opacity: .75`
- hover：`opacity: 1` + 底色 `rgba(255,255,255,.22)`
- 说明气泡：320px 宽、`--radius-btn` 圆角、深色底 `rgba(11,18,32,.98)`、1px 半透明主色描边 `rgba(0,212,255,.35)` + `var(--glow-card)` 辉光、正文 12px / 行高 1.8
- 定位：相对 `?` 绝对定位，**锚 `left: 0` 向右展开**（`bottom: calc(100% + 8px)`），`z-index: 30`
- 因气泡位于 `<button>` 内，需重置按钮继承下来的排版：`font-weight: 400`、`text-align: left`、`white-space: normal`
- 交互：默认 `opacity: 0` + `visibility: hidden` + `pointer-events: none`（不可聚焦、不挡点击），hover 时 `opacity: 1` + `visibility: visible`；`?` 上要 `@click.stop`（点它不触发按钮动作）
- 过渡：图标 `opacity 0.2s ease, background 0.2s ease`、气泡 `opacity 0.2s ease`；正文里的关键词用主色加粗（`b { color: var(--color-primary); font-weight: 600 }`）

### 5.6 列表面板（标题行 + 动作 + 数据列表）

落地见 `assets/main.css` 的 `.panel-head*` / `.voice-list*`，以及 `pages/TextTtsPage/VoiceSection.vue` 的「我的音色」卡片。

- **头行 `.panel-head`**：`flex` + `space-between` + gap 12px + `margin-bottom: 10px`；标题用 `.panel-title` 并把它的 `margin-bottom` 归零（下边距由头行统一给，否则头行被撑高一倍）；动作放右侧 `.panel-head-actions`（gap 8px、`flex: none`）。
- **动作按钮放列表上方**：列表内部会滚动，按钮放底部等于逼用户先滚到底才能刷新。
- **列表 `.voice-list`**：1px 半透明主色描边 + 10px 圆角 + `overflow: hidden`。表头 `.voice-list-head`（12px 雾蓝、字距 1px、深底、下描边）放在**滚动区之外**，行区 `.voice-list-body` 自己滚（`max-height: 360px`）——表头因此天然常驻，**不要用 `sticky`**。
- **列宽必须写 `minmax(0, Nfr)`**：`1fr` 的隐含下限是 `min-content`，超长文本（URL、机器 ID）会把列撑爆、`text-overflow: ellipsis` 直接失效。
- **行 `.voice-list-row`**：主文字 13px / 次要列 12px（§3.1 档位）；行分隔线 `rgba(0,212,255,.08)`（末行去掉）；hover 半透明主色底；**整行可点**（`cursor: pointer` + `title` 说明点了会发生什么），当前正在别处编辑的那条加 `.on`（左 3px 主色指示条 + 90deg 渐变高亮，与侧栏菜单选中态同一套语言）。
- 名称列 `.voice-name`（主色 + 字重 600）+ 类型徽标 `.voice-tag`（11px、`border-radius: 999px`、雾蓝描边，`.clone` 用数据绿）。
- **列表里不显示音色 ID 这类机器标识**（如 `qwen-tts-vc-myvoice42743683-voice-…`）：那是给接口用的内部串，摆在界面上既长又没意义，会挤掉真正有用的列。没有中文名的克隆音色用「未命名克隆音色」兜底，靠「创建时间」列区分是哪一条；确需唯一标识时（如删除确认弹窗）也只显示创建时间。音色 ID 只在本机配置文件与代码里流转。
- 行尾可以有动作列 `.voice-actions`（`flex` + 靠右 + gap 6px，宽度 `auto`）：危险动作（删除类）用 `.hf-btn-danger`，并 `@click.stop` 免得连带触发整行点击。
- 任何可能被截断的格子都要带 `title` 给全文——省略号不能是唯一的出口。

### 5.7 项目属性行（标签 + 控件 + `?`）

落地见 `pages/HtmlGenPage/PreviewSection.vue` 的「背景音频」「视角比例」两行。

- **一行只回答一个问题**：`标签（40~56px 定宽）+ 控件 + ?`。标签定宽是为了让相邻几行的左边缘对齐；解释性文案一律进 `?` 气泡，不常驻。
- **值由控件自己承载**：下拉显示当前项、输入框显示当前值。**不要给值单独再造一块**——裸的 `.hf-file` 路径会把这行读成「文件名行」，而加个带底 / 描边的胶囊块又会被读成可点的按钮（`.prop-chip` 试过，已按用户意见连同样式一起删掉）。确实要露出值时，退到控件的 `title` 悬浮提示（如「更换背景音频（当前：audio/bgm.mp3）」）。
- **`?` 的锚点不在按钮里**（§5.5 已不再限定锚点位置）：这类行的 `?` 贴在控件后面，气泡一律**向下**展开（内联 `top: calc(100% + 8px); bottom: auto`）——这些行常在视口顶端，向上会被 `.content` 的 `overflow-y: auto` 裁掉。
- 状态性提示（如「这是模拟视角」）可以留一行 12px `.hgen-tip`，但**默认态必须是空的**：没有提示就代表一切正常。
- **当前值优先落在「列表里选中」**：从列表里挑出来的值（如背景音频），当前项就在**同一份列表**里显示为选中（下拉自己的勾选 + 触发器上的名字），**不要为它单造一条「当前：…」**；只有对不上列表的值（本地文件 / 外部产物）才退一个同名项把值显示出来。清空之类的动作也放同一份列表里，别再配一个「移除」按钮。

### 5.8 滚动条（全局唯一一套）

落地见 `assets/main.css` 基础段的 `*::-webkit-scrollbar*`（唯一真源，写在 `html, body` 规则之后）。

- **所有滚动容器共用一套**：宽高 8px、轨道与角落透明、`border-radius: 999px` 滑块 `rgba(0, 212, 255, 0.25)`、悬停 `rgba(0, 212, 255, 0.45)`。**不要再给某个容器单独写 `::-webkit-scrollbar`**——`*` 通配一处覆盖全部（含 Teleport 到 `<body>` 的弹层），要调只改这一处；`.content`（右侧整页内容区）、`.sub-list`（字幕条目列表）、`.voice-list-body`（我的音色列表）都靠继承。
- **不要写 `scrollbar-width` / `scrollbar-color`**：Chromium（Electron 31 = 126）里这两个标准属性会顶掉 `::-webkit-*` 的自定义效果，写了反而退回默认灰白条。全局一个都不写。
- 确需「隐藏滚动条但仍可滚动」时，才在**那一个容器上**写 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`，并注明原因。
- 预览 iframe（`hgpreview://`）是独立文档，不受这条规则影响。

## 6. CSS 变量（可直接粘贴使用）

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
  --color-warning:   #FFB020;
  --color-danger:    #FF4D6D;

  /* 文字 */
  --text-primary:    #E6F1FF;
  --text-secondary:  #8A9BB5;

  /* 辉光 */
  --glow-primary:    0 0 8px rgba(0,212,255,0.6);
  --glow-card:       0 0 20px rgba(0,212,255,0.15);

  /* 布局 */
  --sidebar-width: 220px;
  --radius-card: 12px;
  --radius-btn: 8px;
  --spacing-base: 8px;
}
```

## 7. 主题通配建议

- 深色背景下信息层级靠「辉光强度 + 文字色阶」区分，而非纯靠亮度反差
- 运动与过渡统一使用 `0.2s ease`，保持轻盈的科技感
- 渐变与辉光适度克制，避免大面积高饱和导致视觉疲劳
- 后续若要「亮色模式」，可在 `:root[data-theme="light"]` 下覆盖变量即可，无需改动组件代码
*（内容由AI生成，仅供参考）*
