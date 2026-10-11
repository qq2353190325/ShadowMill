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

本文件定义 Electron 项目「我的应用」的科技主题设计方案，包含主题定位、配色体系、字体与间距、组件风格，以及可直接落地的 CSS 变量。

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
- 标题字号：24px / 20px / 18px，暖色冰白，字重 600
- 正文字号：14px，行高 1.7，颜色 `#E6F1FF`
- 说明字号：12px，颜色 `#8A9BB5`

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

**图标放在动作按钮内部、每个动作各带一个**（落地见 `src/renderer/src/assets/main.css` 的 `.hg-help*`，以及 `pages/HtmlGenPage/index.vue` 动作行）。

- 包裹层：`display: inline-flex` + `align-items: center` + `flex: none` + `margin-left: 6px` + `vertical-align: middle`
- 图标：16px 圆形 `?`，字号 11px、字重 700，`color: currentColor` + `1px solid currentColor`（跟随按钮文字色：主按钮渐变底/深色字、次要按钮透明底/主色字都能看清），默认 `opacity: .75`
- hover：`opacity: 1` + 底色 `rgba(255,255,255,.22)`
- 说明气泡：320px 宽、`--radius-btn` 圆角、深色底 `rgba(11,18,32,.98)`、1px 半透明主色描边 `rgba(0,212,255,.35)` + `var(--glow-card)` 辉光、正文 12px / 行高 1.8
- 定位：相对 `?` 绝对定位，**锚 `left: 0` 向右展开**（`bottom: calc(100% + 8px)`），`z-index: 30`
- 因气泡位于 `<button>` 内，需重置按钮继承下来的排版：`font-weight: 400`、`text-align: left`、`white-space: normal`
- 交互：默认 `opacity: 0` + `visibility: hidden` + `pointer-events: none`（不可聚焦、不挡点击），hover 时 `opacity: 1` + `visibility: visible`；`?` 上要 `@click.stop`（点它不触发按钮动作）
- 过渡：图标 `opacity 0.2s ease, background 0.2s ease`、气泡 `opacity 0.2s ease`；正文里的关键词用主色加粗（`b { color: var(--color-primary); font-weight: 600 }`）

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
