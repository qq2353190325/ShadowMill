# src/shared/constants.ts

> 应用级公共常量：品牌文案（中文名 / 英文名 / 口号）+ 出网请求 User-Agent + **项目素材的类型白名单与合计上限** + **成片画布的取值与尺寸（`RenderCanvas`）** + **估时语速（4 字/秒，一个语速三处用）与估时公式**的唯一来源

- **所在目录**：`src/shared/`
- **类型**：共享常量 + 一个纯函数（`estimateSubtitleDur`，零副作用；顶部只有一处 `import type { RenderCanvas } from './types'`，纯类型导入不产生运行时代码）
- **规模**：**88 行**（30 → 41 是新增「项目素材」一节 3 个常量；41 → 70 是新增「成片画布」一节 4 个常量；70 → 86 是新增「字幕估时」一节 1 个常量 + 1 个函数；86 → 88 是把该节**整段重写**为「估时语速」——常量改名 `EST_CHARS_PER_SEC`、值改成 4、注释写明三处消费方，多 2 行）
- **对外导出**：13 个常量 + 1 个函数（`APP_NAME`、`APP_NAME_EN`、`APP_SLOGAN`、`APP_SLOGAN_SHORT`、`APP_USER_AGENT`（5 个字符串常量）+ `MAX_MATERIALS`、`IMAGE_MATERIAL_EXTS`、`VIDEO_MATERIAL_EXTS`（3 个素材常量）+ `RENDER_CANVASES`、`CANVAS_SIZES`、`CANVAS_LABELS`、`DEFAULT_CANVAS`（4 个画布常量）+ **`EST_CHARS_PER_SEC`（估时语速 4 字/秒）** + **`estimateSubtitleDur(text)`（估时函数）**）——常量个数与上一轮相同，只是改名与改值

## 1. 作用与职责

本文件是**品牌文案的唯一定义处**：中文显示名、英文名、两句口号、以及出网请求的 User-Agent 都从这里导出。它不注册任何东西、也不调用任何接口，只提供字符串 / 数值 / 字符串数组常量。

它存在的理由（源码头部注释写明）：品牌文案原先散落在 `src/renderer/index.html` 的窗口标题与启动画面、`App.vue` 标题栏、`HomePage` 首页、`whisper.ts` 的 User-Agent 等处，「改一处漏一处」，而且散落的字符串没有任何编译期提示。现在各处一律 `import` 本文件，改品牌名只需要动清单上的少数几处。

**「成片画布」一节复用同一思路**：画布的取值与像素必须三端一致（主进程往渲染入口注入 `<html data-resolution>`、主进程写生成提示词、渲染层的下拉选项与预览 iframe），所以集中在本文件当**尺寸唯一真源**——取值与尺寸要与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 对齐（本项目只暴露 1080 三档），改尺寸时若与 CLI 对不上，成片会退回 CLI 自己的兜底 `portrait`。

**「项目素材」一节复用同一思路**：素材的类型白名单与合计上限原先只可能写死在主进程 handler 里，现在集中在本文件，**主进程用它做准入与截断，渲染层用同一份常量做展示**（`n / 20` 计数与「支持哪些格式」的提示行），两端不会各写一套而悄悄漂移。

**「估时语速」一节（上一轮新增、本轮整段重写）复用同一思路，且消费方从两处扩到三处**：同一条规则原先在**两个进程里各写了一遍**（渲染层 `SubtitlePage/helpers.ts` 的 `estDur` 与主进程 `parseSubtitle` 里内联的 `0.15` 系数），内容脚本页又另写了一个 4.5 的本地语速常量（已删除）、脚本 Agent 提示词再写一遍 4.5——三套口径各自漂移。现在**只有一个常量 `EST_CHARS_PER_SEC`（4 字/秒）**：① 字幕估时公式 `estimateSubtitleDur()`（渲染层 `estDur` 再导出 + 主进程 `parseSubtitle` 直接调用）；② 内容脚本页「AI 创作」结果卡的「估算时长」= 总字数 ÷ 它（`AiChatPanel.vue` 把它传给 `ScriptRoundCard.vue` 的 `charsPerSecond`）；③ 主进程脚本 Agent 提示词的字数预算「目标总时长 × 它 = 旁白总字数上限」（`agent/script.ts`）。

与 `ipc.ts` / `types.ts` 的定位差别：

| 文件 | 内容 | 是否属于「IPC 契约」 |
|---|---|---|
| `ipc.ts` | 87 个 IPC 频道名字符串（10 组） | 是（禁止改动） |
| `types.ts` | 跨进程载荷类型 | 是（线上字段格式禁止改动） |
| `constants.ts` | 品牌文案、请求标识、**成片画布取值与尺寸**、**素材白名单与上限**、**估时语速与公式** | **否**——改它不影响任何频道名或载荷格式；但**素材常量会同时约束主进程校验与界面提示**、**画布常量会同时约束生成提示词 / 预览画布 / 渲染入口**、**估时语速会同时改字幕时间轴、面板估算时长与提示词字数预算**，改动等于改产品规则 |

## 2. 导出常量

| 常量 | 值 | 类型 | 用途与消费方 |
|---|---|---|---|
| `APP_NAME` | `'影坊'` | `string` | 中文显示名：窗口/任务栏标题、`App.vue` 标题栏 `.titlebar-title`、启动画面 `.boot-title`、首页 hero 角标 |
| `APP_NAME_EN` | `'ShadowMill'` | `string` | 英文名：与 `package.json` 的 `build.productName` 一致（安装包与可执行文件名同此），并作为 `APP_USER_AGENT` 的前缀 |
| `APP_SLOGAN` | `'一站式音视频创作流水线'` | `string` | 首页（HomePage）主标题 `<h1>` |
| `APP_SLOGAN_SHORT` | `'音视频创作流水线'` | `string` | 短位文案：启动画面副标题 `.boot-sub`，去掉「一站式」以免窄位换行 |
| `APP_USER_AGENT` | `APP_NAME_EN + '/1.0'`（即 `'ShadowMill/1.0'`） | `string` | 主进程出网请求（whisper 模型下载）的 `User-Agent`，带应用名便于对端统计与排查 |
| `MAX_MATERIALS` | `20` | `number` | **项目素材合计上限**（图片 + 视频一起算）：主进程 `project:add-materials` 据此跳过超限文件、`normalizeMaterials()` 据此截断；渲染层 `MaterialsSection.vue` 用它显示 `n / 20` 与上限提示 |
| `IMAGE_MATERIAL_EXTS` | `['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']` | `string[]` | 图片素材白名单：`project:pick-media` 据此给文件框过滤（`kind === 'image'` 时还开 `multiSelections`）、`materialKindOf()` 据此判 `'image'`、渲染层据此显示支持格式 |
| `VIDEO_MATERIAL_EXTS` | `['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi']` | `string[]` | 视频素材白名单：同上（视频为单选），`materialKindOf()` 据此判 `'video'` |
| `RENDER_CANVASES` | `['landscape', 'portrait', 'square']` | `RenderCanvas[]` | **成片画布三档**：主进程 `video.ts` / `projects.ts` 的白名单、渲染层 `utils/render.ts` 的下拉选项来源；类型 `RenderCanvas` 定义在 `types.ts` |
| `CANVAS_SIZES` | `landscape: { width: 1920, height: 1080 }`、`portrait: { width: 1080, height: 1920 }`、`square: { width: 1080, height: 1080 }` | `Record<RenderCanvas, { width: number; height: number }>` | 每个画布的实际像素（= composition 尺寸 = 成片尺寸）：渲染入口留痕、生成提示词、预览 iframe 的内联宽高与缩放比都按它算 |
| `CANVAS_LABELS` | `landscape: '横屏 16:9'`、`portrait: '竖屏 9:16'`、`square: '方形 1:1'` | `Record<RenderCanvas, string>` | 画布的界面 / 提示词文案：放这里而不是各处自己拼，否则「界面选的」与「告诉模型的」会对不上 |
| `DEFAULT_CANVAS` | `'landscape'` | `RenderCanvas` | 项目没设 `canvas` 时用的画布：主进程白名单校验失败、渲染层 `normalizeCanvas()` 遇到脏数据都落到它 |
| `EST_CHARS_PER_SEC` | `4` | `number` | **估时语速（字/秒）**，一个语速三处用：① `estimateSubtitleDur()` 的分母（渲染层字幕页 `estDur` + 主进程 `parseSubtitle`）② 内容脚本页「AI 创作」结果卡的「估算时长」= `totalChars ÷ 它`（`AiChatPanel.vue` → `ScriptRoundCard.vue` 的 `charsPerSecond`）③ 脚本 Agent 提示词的字数预算（`agent/script.ts` 的「目标总时长 × 它」）。上一轮是 3、更早是 `0.15` 秒/字 ≈ 6.7 字/秒（老系数，套到整段场景旁白上快一倍） |
| `estimateSubtitleDur` | `(text: string) => number` | 函数 | **估时公式唯一真源**：`max(2.4, 1.6 + 字数 / EST_CHARS_PER_SEC)`。渲染层 `SubtitlePage/helpers.ts` 把它再导出为 `estDur`（页面 / 转录弹窗的既有调用点不变），主进程 `projects.ts` 的 `parseSubtitle` 用它推算下一行的起始时间 |

### 2.1 「项目素材」三个常量的取值理由（源码注释逐字）

```ts
// ===== 项目素材（HTML 生成用的图片 / 视频素材库，结构见 types.ts 的 ProjectMaterial）=====
// 上限按「图片 + 视频合计」算：素材会逐个写进 Agent 提示词并成为页面元素，数量一多提示词过长、
// HTML 生成质量与渲染耗时都会明显变差，20 是权衡后的取值。主进程校验，渲染层用它显示「n / 20」。
export const MAX_MATERIALS = 20;

// 图片素材白名单（svg 也收：矢量图做图标/装饰最省体积，且不涉及解码器）
export const IMAGE_MATERIAL_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

// 视频素材白名单（与原来的单个视频素材一致）
export const VIDEO_MATERIAL_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'];
```

三条推论：

1. **上限是「合计」而非「每组各 20」**：`project:add-materials` 的判据是 `list.length + added.length >= MAX_MATERIALS`，会先把当前列表长度算进去，因此图片组与视频组共用同一份额度。
2. **`svg` 是刻意的**：矢量图做图标 / 装饰最省体积，且不涉及解码器；扩展名比对**大小写不敏感**（`materialKindOf()` 先 `toLowerCase()`）。
3. **视频白名单与旧的单个视频素材完全一致**：素材库改造没有扩大视频格式范围，`project:pick-media` 的视频分支过滤项就是这份数组。

### 2.2 「成片画布」四个常量的取值理由（源码注释逐字）

```ts
// ===== 成片画布（HyperFrames 的画布预设，**尺寸唯一真源**）=====
// 取值与尺寸必须与 HyperFrames CLI 的 CANVAS_DIMENSIONS 对齐（resources/hyperframes/.../dist/cli.js：
//   landscape 1920x1080 / portrait 1080x1920 / square 1080x1080，另有 4k 三档——本项目只暴露 1080 三档）。
// 为什么放在 shared：三个消费点必须用同一组数——
//   ① 主进程往渲染入口注入 <html data-resolution="…">（src/main/video.ts）
//   ② 主进程把它写进生成提示词，让模型按同一块画布排版式（src/main/projects.ts）
//   ③ 渲染层选项表与预览 iframe 的画布尺寸（renderer/utils/render.ts、HtmlGenPage/PreviewSection.vue）
// 改这里的尺寸/取值时，CLI 那边若对不上，成片会退回 CLI 自己的兜底 portrait（见 video.ts 的注释）。
export const RENDER_CANVASES: RenderCanvas[] = ['landscape', 'portrait', 'square'];
// 每个画布的实际像素（= composition 尺寸 = 成片尺寸；CLI 不传 --resolution 时输出就是它本身）
export const CANVAS_SIZES: Record<RenderCanvas, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
};
// 画布的界面/提示词文案（中文简写）。放这里而不是各处自己拼：提示词（主进程）与下拉选项（渲染层）
// 必须说同一句话，否则「界面选的」和「告诉模型的」会对不上。
export const CANVAS_LABELS: Record<RenderCanvas, string> = {
  landscape: '横屏 16:9',
  portrait: '竖屏 9:16',
  square: '方形 1:1'
};
// 项目没设 canvas 时用的画布。选 landscape 的理由：应用内预览画布历来是 16:9、首页也写着「1080P 导出」，
// 老项目因此保持原有观感；此前「成片莫名变竖屏」正是因为没有这个确定值（CLI 兜底 portrait）。
export const DEFAULT_CANVAS: RenderCanvas = 'landscape';
```

三条推论：

1. **取值的真源在 CLI**：三档名字不是应用自己发明的，而是 HyperFrames `CANVAS_DIMENSIONS` 的键（另有 `landscape-4k` / `portrait-4k` / `square-4k` 三档未暴露）；`data-resolution` 只接受这几个值之一，写别的等于没写。
2. **它是项目属性、不是渲染档位**：与 `AppSettings.render`（全局默认）和 `Project.render`（项目覆盖）那套层级无关——画布只有一处选择点（「HTML生成」页生成侧的「画布」下拉），存 `project.json` 的 `canvas`，缺省由 `DEFAULT_CANVAS` 兜底。
3. **一个值管三处**：生成提示词里给模型的版式尺寸、预览 iframe 的画布、渲染入口注入的 `<html data-resolution>` 都读同一个值，所以「预览看到的画布」与「成片尺寸」必然一致。

### 2.3 「估时语速」一个常量 + 一个函数的取值理由（源码注释逐字）

```ts
// ===== 估时语速（字/秒，**唯一真源**）=====
// 一个语速三个用处，改这一行就一起变：
//   ① 字幕估时公式 estimateSubtitleDur()（本文件下方）。它有两个消费方——渲染层字幕页
//      （SubtitlePage/helpers.ts 的 estDur → 「由脚本旁白生成」/ 新增条目 / 纯文本与 SRT 解析）
//      与主进程 parseSubtitle（逐句对齐时给「整行没有 [时间] 前缀」的行兜底起始时间）；
//   ② 内容脚本页「AI 创作」结果卡上的「估算时长」= 总字数 ÷ 它（ContentPage 的 AiChatPanel / ScriptRoundCard）；
//   ③ 主进程脚本 Agent 提示词里的字数预算：「目标总时长 × 它 = 旁白总字数上限」（agent/script.ts）。
// 历史：这条规则原来在渲染层与主进程各写了一遍（0.15 秒/字 ≈ 6.7 字/秒，本是给「一条短句」估时用的
// 老系数，套到一整段场景旁白上快一倍——93 字的旁白只排 15.5 秒、实际要读 23 秒，字幕读不完），
// 而内容脚本页另写 4.5 字/秒，两套口径对不上；2026-10-21 统一成 4 字/秒。
// 注意：这只是**估时**，不读音频；真实时长得走配音页的「字幕配音（逐句对齐）」实测。
export const EST_CHARS_PER_SEC = 4;
// 估时公式：max(2.4, 1.6 + 字数 / 语速)。下限 2.4 秒与基数 1.6 秒是历史沿用的取值，与语速无关。
export function estimateSubtitleDur(text: string): number {
  const n = String(text == null ? '' : text).length;
  return Math.max(2.4, 1.6 + n / EST_CHARS_PER_SEC);
}
```

语速取 **4 字/秒**，**一个语速三处用：字幕估时 / AI 面板估算时长 / 提示词字数预算**。

三条推论：

1. **为什么放在 shared、且必须只有一份**：这条规则被**三个地方**同时需要——渲染层决定页面里字幕条目的显示时长，主进程决定落盘的 `[起-止]` 时间轴，而「目标时长 ↔ 旁白字数」是同一个物理量在另外两处的衍生（AI 面板的估算时长、脚本 Agent 的字数预算）。三处各写一份时曾经是三套值（`0.15` 秒/字、`3`、`4.5`），同一段旁白在页内预览、导出字幕、AI 面板与提示词预算里能出现四个时长。现在三处都 `import` 本文件，改 `EST_CHARS_PER_SEC` 一行就一起变。
2. **口径变化的量级（实测）**：

   | 项 | 上一轮（3，已废弃） | 现在（4 字/秒） | 最初（0.15 秒/字） |
   |---|---|---|---|
   | 93 字单段 | 32.6s | **24.85s** | 15.55s |
   | 用户项目 8 场景（85~100 字）合计 | 256.8s（4:16.8） | **195.8s（3:15.8）** | 122.6s（2:02.6） |
   | AI 面板 732 字 | — | **183s（3:03）** | — |
   | 提示词 60 秒预算 | — | **240 字** | 270 字（按 4.5） |

   实测方式：把本文件单独 `tsc` 成 CJS 后 `node -e` 跑 `estimateSubtitleDur`，`EST_CHARS_PER_SEC` 读回 `4`。旧系数 6.7 字/秒本来是给「一条短句」估时用的，套到一整段场景旁白上就快一倍、字幕根本读不完。
3. **它只是估时**：公式下限 2.4 秒、基数 1.6 秒是历史沿用的取值（与语速无关），且**不读音频**；要真实时长得走配音页的「字幕配音（逐句对齐）」实测。**渲染层界面文案也引用该常量、不写死数字**：字幕页的提示行是 `{{ EST_CHARS_PER_SEC }} 字/秒`、按钮 `title` 与 `fromContent()` 的 toast 都是模板 / 字符串拼接该常量，所以界面永远说「4 字/秒」，不会与源码脱节。

### 2.4 品牌常量的推导关系

- `APP_USER_AGENT` 是**派生常量**（`APP_NAME_EN + '/1.0'`），不是独立字面量：改英文名时它自动跟随，不需要单独维护。版本片段 `'/1.0'` 是硬编码字面量，与 `package.json` 的 `version`（应用版本号）**无关**。
- `APP_SLOGAN_SHORT` 是 `APP_SLOGAN` 的**独立子串**（去掉「一站式」），源码用两个常量分别表达「首页宽位」与「启动画面窄位」两种排版需求，而不是运行时 `slice()`。

## 3. 品牌注入链路（三条路径）

品牌文案在本文件只有一处来源，但「到达界面」的路径有三条，取决于消费方能否 `import` TypeScript：

| 路径 | 消费方 | 机制 |
|---|---|---|
| ① 直接 `import` | `src/main/whisper.ts`（`APP_USER_AGENT`）、`App.vue`（`APP_NAME`）、`HomePage/index.vue`（`APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN`） | 编译期引入，打包器内联进各自产物 |
| ② HTML 占位符 + 构建期注入 | `src/renderer/index.html` 的 `<title>` 与启动画面 | HTML 是静态标记、**无法 `import` TS 常量**，故写 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()`（`transformIndexHtml` 且 `order: 'pre'`）在 dev/build 期替换 |
| ③ JSON 无法 import ⇒ 只能校验 | `package.json` 的 `build.productName` | `electron.vite.config.ts` 的 `checkBrandConsistency()` 读 `package.json`，与 `APP_NAME_EN` 不一致时 `console.warn('[dsh:brand] …')`（加载配置时执行一次） |

`brandHtmlPlugin` 用 `order: 'pre'` 是刻意的：早于 Vite 自带的 `%VITE_*%` 替换，保证占位符一定先被吃掉、不会残留到产物里。

## 4. 改品牌名的完整清单

源码头部注释给出的清单（「除此以外不需要再全局搜『影坊 / ShadowMill』」）：

| # | 位置 | 改什么 |
|---|---|---|
| 1 | **本文件** §应用标识 | `APP_NAME` / `APP_NAME_EN`（`APP_USER_AGENT` 随之派生）、按需改两句口号 |
| 2 | `package.json` | `build.productName`（安装包与 `*.exe` 名字）、`description`、`build.appId` |
| 3 | `src/renderer/index.html` | 无需改动——用 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%` 占位，构建期注入 |
| 4 | 渲染层组件 | 无需改动——直接 `import` 本文件 |

两点**不在**清单里（源码注释明确排除）：

- **渲染层 localStorage 的 `'myapp.*'` 键名故意不跟随品牌名**：prod 下页面走 `file://` 同源，键名就是用户数据的地址，改名会让「上次打开的项目 / 设置页上次的分类」读不到。见 `src/renderer/src/constants.ts`。
- **版本号不在本文件**：一律运行时取 `app.getVersion()`（设置页经 `window.updateTools.version()` 的 `sendSync` 拿）。

## 5. 依赖与协作

| 方向 | 对象 | 说明 |
|---|---|---|
| 依赖 | `src/shared/types.ts`（仅 `import type { RenderCanvas }`） | 零运行时 import、零副作用，是纯常量模块（另有一个纯函数 `estimateSubtitleDur`） |
| 被 import | `src/main/whisper.ts` | `APP_USER_AGENT` → `httpGetFollow()` 的请求头 |
| 被 import | `src/renderer/src/App.vue` | `APP_NAME` → 标题栏文案 |
| 被 import | `src/renderer/src/pages/HomePage/index.vue` | `APP_NAME` / `APP_NAME_EN` → `brandTag`；`APP_SLOGAN` → `<h1>` |
| 被 import | `src/main/projects.ts` | **`IMAGE_MATERIAL_EXTS` / `MAX_MATERIALS` / `VIDEO_MATERIAL_EXTS`**（素材库那轮新增）：`materialKindOf()` 判类型、`materialExtsText()` 拼提示、`normalizeMaterials()` 截断、`project:pick-media` 给文件框过滤、`project:add-materials` 判上限；**`estimateSubtitleDur`**：`parseSubtitle()` 给「整行没有 `[时间]` 前缀」的行兜底起始时间（`ttsAlign.ts` 的逐句对齐也吃这条时间轴） |
| 被 import | `src/renderer/src/pages/SubtitlePage/helpers.ts` | **`estimateSubtitleDur`**：原样再导出为 `estDur`——字幕页「由脚本旁白生成」、新增条目、粘贴纯文本与 SRT 解析都走它；`SubtitlePage/index.vue` 与 `TranscribeSection.vue` 的 `estDur` `import` 一行未改 |
| 被 import | `src/renderer/src/pages/SubtitlePage/index.vue` | **`EST_CHARS_PER_SEC`**（本轮新增）：提示行 `{{ EST_CHARS_PER_SEC }} 字/秒`、按钮 `:title` 的拼接表达式、`fromContent()` toast 的「N 条按 <语速> 字/秒估时」——界面不写死数字 |
| 被 import | `src/renderer/src/pages/ContentPage/AiChatPanel.vue` | **`EST_CHARS_PER_SEC`**（本轮新增）：模板 `:chars-per-second="EST_CHARS_PER_SEC"` 传给 `ScriptRoundCard.vue`；本文件已无语速常量（旧实现曾写死 4.5） |
| 被 import | `src/main/agent/script.ts` | **`EST_CHARS_PER_SEC`**（本轮新增）：`SCRIPT_AGENT_SYSTEM` 第 6 条（「中文口语约 N 字/秒」）与 `buildScriptPrompt()` 的字数预算 `Math.round(seconds * EST_CHARS_PER_SEC)`；本文件已无语速常量（旧实现曾写死 4.5） |
| 被 import | `src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue` | **`IMAGE_MATERIAL_EXTS` / `MAX_MATERIALS` / `VIDEO_MATERIAL_EXTS`**：`n / {{ MAX_MATERIALS }}` 计数、`extText` 支持格式提示、上限 `title` |
| 被 import | `src/main/video.ts` | **`CANVAS_SIZES` / `DEFAULT_CANVAS` / `RENDER_CANVASES`**（画布那轮新增）：画布白名单校验、把 `data-resolution` 写进渲染入口、把「成片画布 = …」写进 `userData/video-duration.log` |
| 被 import | `src/renderer/src/utils/render.ts` | **`CANVAS_LABELS` / `CANVAS_SIZES` / `DEFAULT_CANVAS` / `RENDER_CANVASES`**（画布那轮新增）：再导出为 `RENDER_CANVAS_OPTIONS` / `canvasLabel()` / `canvasSize()` / `normalizeCanvas()` 给页面用 |
| 被 import | `electron.vite.config.ts` | `APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN_SHORT` → `brandHtmlPlugin()` 与 `checkBrandConsistency()` |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 两份子工程都 `include: src/shared/**/*.ts`，故 main / preload / 渲染层三端都能引用 |
| 别名 | `@shared/*` → `src/shared` | 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 两处声明，新增别名需同步；渲染层引用写法为 `import { APP_NAME } from '@shared/constants'`（素材常量同理：`import { IMAGE_MATERIAL_EXTS, MAX_MATERIALS, VIDEO_MATERIAL_EXTS } from '@shared/constants'`；画布常量：`import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, RENDER_CANVASES } from '@shared/constants'`；估时：`import { EST_CHARS_PER_SEC, estimateSubtitleDur } from '@shared/constants'`） |

## 6. 注意事项与实现要点

- **不是 IPC 契约**：`ipc.ts` / `types.ts` 的「禁止改动」约束不适用于本文件——改品牌名不需要动任何频道名或载荷格式。但**素材常量改的是产品规则**：`MAX_MATERIALS` 一改，主进程的准入 / 截断与界面的 `n / 20` 会同时变，提示词长度与生成质量也随之变。**画布常量同理且更硬**：`CANVAS_SIZES` 必须与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 保持一致，改错等于成片尺寸错（CLI 读不到合法 `data-resolution` 时兜底 `portrait`）。**估时语速同理**：`EST_CHARS_PER_SEC` 一改，页面里看到的字幕时长、落盘 / 导出的 `[起-止]` 时间轴、AI 面板的估算时长与脚本 Agent 提示词的字数预算会一起变（三处 import 同一份，不会各变各的）。
- **上限只有一个来源**：不要在渲染层或主进程另写 `20`；渲染层只做展示（超限按钮不禁用，交给主进程回报跳过数），真正的截断发生在 `normalizeMaterials()` 与 `project:add-materials`。
- **估时公式只有一个来源，语速也只有一个来源**：不要在渲染层或主进程再写 `0.15` / `1.6` / `2.4` 这类系数，也不要再写 `4` / `4.5` 这类语速字面量；要改语速只改 `EST_CHARS_PER_SEC`，要改公式只改 `estimateSubtitleDur()`。渲染层保留的 `estDur` 只是别名，不是第二份实现；**渲染层界面文案也引用该常量，不写死数字**（`SubtitlePage/index.vue` 的提示行 / 按钮 `title` / toast 都是模板拼接）。
- **零运行时开销**：常量被各端打包器内联，main / preload / renderer 各自持有副本，不存在跨进程共享对象。
- **不要在 shared 放业务逻辑**：本层任何实现都会同时进入 main 与 preload 两个 bundle。唯一允许的函数是 **`estimateSubtitleDur()`**——纯函数、无副作用、无外部依赖（`materialKindOf()` 这类判断仍留在 `src/main/projects.ts`）。
- **`productName` 的漂移只能告警、不能报错**：`checkBrandConsistency()` 内部 `try/catch` 并在不一致时 `console.warn`，因为「校验失败不应影响构建」；改 `APP_NAME_EN` 后请留意构建/开发启动日志里的 `[dsh:brand]` 提示。
- **`APP_NAME_EN` 同时是三类东西**：界面英文名、安装包/可执行文件名（经 `productName`）、出网 `User-Agent` 前缀——改名时三者会一起变，属预期行为。
- **`name`（npm 包名）在此清单之外——但它是 userData 目录名的来源**：Electron 的 `userData` 就是 `%APPDATA%\<name>`（`src/main/index.ts` **不做** `app.setPath`）。因此**改 `name` 等于换数据目录**：必须把旧名字手动加进 `index.ts` 的 `LEGACY_DIR_NAMES`，启动扫描时才会弹窗让用户选「迁移 / 删除 / 稍后」（见 [main/index.ts.md](../main/index.ts.md) §3.1）。这与本文件的品牌文案仍是两件事。
