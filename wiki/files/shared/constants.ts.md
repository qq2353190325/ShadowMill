# src/shared/constants.ts

> 应用级公共常量：品牌文案（中文名 / 英文名 / 口号）+ 出网请求 User-Agent + **项目素材的类型白名单与合计上限** + **成片画布的取值与尺寸（`RenderCanvas`）** + **估时语速（4 字/秒，一个语速三处用）与估时公式** + **角色动作的参数表与三类上限（`CAST_ACTION_*`）**的唯一来源

- **所在目录**：`src/shared/`
- **类型**：共享常量 + 一个纯函数（`estimateSubtitleDur`，零副作用；顶部只有一处 `import type { RenderCanvas } from './types'`，纯类型导入不产生运行时代码）
- **规模**：**129 行**（89 → 129 是本轮新增「角色动作的参数表」一节：`CastActionParam` 接口 + `CAST_ACTION_PARAMS`（10 项）+ `CAST_ACTION_NAME_MAX` / `CAST_ACTION_DURATION` / `CAST_ACTION_MAX_PER_SCOPE` 三个上限）
- **对外导出**：**17 个常量 + 1 个函数 + 1 个接口**——`APP_NAME`、`APP_NAME_EN`、`APP_SLOGAN`、`APP_SLOGAN_SHORT`、`APP_USER_AGENT`（5 个字符串常量）+ `MAX_MATERIALS`、`IMAGE_MATERIAL_EXTS`、`VIDEO_MATERIAL_EXTS`（3 个素材常量）+ `RENDER_CANVASES`、`CANVAS_SIZES`、`CANVAS_LABELS`、`DEFAULT_CANVAS`（4 个画布常量）+ **`EST_CHARS_PER_SEC`** + `estimateSubtitleDur(text)` + **`CastActionParam`（接口）、`CAST_ACTION_PARAMS`、`CAST_ACTION_NAME_MAX`、`CAST_ACTION_DURATION`、`CAST_ACTION_MAX_PER_SCOPE`（本轮新增）**

## 1. 作用与职责

本文件是**品牌文案的唯一定义处**：中文显示名、英文名、两句口号、以及出网请求的 User-Agent 都从这里导出。它不注册任何东西、也不调用任何接口，只提供字符串 / 数值 / 字符串数组常量。

它存在的理由（源码头部注释写明）：品牌文案原先散落在 `src/renderer/index.html` 的窗口标题与启动画面、`App.vue` 标题栏、`HomePage` 首页、`whisper.ts` 的 User-Agent 等处，「改一处漏一处」，而且散落的字符串没有任何编译期提示。现在各处一律 `import` 本文件，改品牌名只需要动清单上的少数几处。

**「成片画布」一节复用同一思路**：画布的取值与像素必须三端一致（主进程往渲染入口注入**舞台 `data-width`/`data-height`（成片宽高真正来源）与 `<html data-resolution>`**、主进程写生成提示词、渲染层的下拉选项与预览 iframe），所以集中在本文件当**尺寸唯一真源**——取值与尺寸要与 HyperFrames CLI 的 `CANVAS_DIMENSIONS` 对齐（本项目只暴露 1080 三档）。

**「项目素材」一节复用同一思路**：素材的类型白名单与合计上限集中在本文件，**主进程用它做准入与截断，渲染层用同一份常量做展示**（`n / 20` 计数与「支持哪些格式」的提示行）。

**「估时语速」一节复用同一思路**：同一条规则原先在两个进程里各写了一遍（渲染层 `SubtitlePage/helpers.ts` 的 `estDur` 与主进程 `parseSubtitle` 里内联的 `0.15` 系数），内容脚本页又另写了一个 4.5 的本地语速常量。现在**只有一个常量 `EST_CHARS_PER_SEC`（4 字/秒）**：① 字幕估时公式 `estimateSubtitleDur()`；② 内容脚本页「AI 创作」结果卡的「估算时长」；③ 主进程脚本 Agent 提示词的字数预算。

**「角色动作的参数表」一节（本轮新增）复用同一思路**：角色是纯绘制函数 `window.__cast[id](x, y, u, o)`，动画全靠调用方把参数塞进 `o` 里。界面上「关键帧表能填哪些参数」与主进程「落盘时收哪些参数」必须是同一份清单——就是这里。它同时被三处消费：关键帧编辑器（表格的列）、主进程 `cast/actions.ts` 的 `normalizeActionDef`（逐参数夹范围 / 查白名单）、内置动作 `cast/presets.ts`（同一套键名与量级）。

与 `ipc.ts` / `types.ts` 的定位差别：

| 文件 | 内容 | 是否属于「IPC 契约」 |
|---|---|---|
| `ipc.ts` | 106 个 IPC 频道名字符串（12 组） | 是（禁止改动） |
| `types.ts` | 跨进程载荷类型 | 是（线上字段格式禁止改动） |
| `constants.ts` | 品牌文案、请求标识、**成片画布取值与尺寸**、**素材白名单与上限**、**估时语速与公式**、**动作参数表与上限** | **否**——改它不影响任何频道名或载荷格式；但**素材常量会同时约束主进程校验与界面提示**、**画布常量会同时约束生成提示词 / 预览画布 / 渲染入口**、**估时语速会同时改字幕时间轴、面板估算时长与提示词字数预算**、**动作参数表会同时改编辑器的列与落盘校验**，改动等于改产品规则 |

## 2. 导出常量

| 常量 | 值 | 类型 | 用途与消费方 |
|---|---|---|---|
| `APP_NAME` | `'影坊'` | `string` | 中文显示名：窗口/任务栏标题、`App.vue` 标题栏 `.titlebar-title`、启动画面 `.boot-title`、首页 hero 角标 |
| `APP_NAME_EN` | `'ShadowMill'` | `string` | 英文名：与 `package.json` 的 `build.productName` 一致，并作为 `APP_USER_AGENT` 的前缀 |
| `APP_SLOGAN` | `'一站式音视频创作流水线'` | `string` | 首页（HomePage）主标题 `<h1>` |
| `APP_SLOGAN_SHORT` | `'音视频创作流水线'` | `string` | 短位文案：启动画面副标题 `.boot-sub` |
| `APP_USER_AGENT` | `APP_NAME_EN + '/1.0'`（即 `'ShadowMill/1.0'`） | `string` | 主进程出网请求（whisper 模型下载）的 `User-Agent` |
| `MAX_MATERIALS` | `20` | `number` | **项目素材合计上限**（图片 + 视频一起算）：主进程 `project:add-materials` 据此跳过超限文件、`normalizeMaterials()` 据此截断；渲染层 `MaterialsSection.vue` 用它显示 `n / 20` |
| `IMAGE_MATERIAL_EXTS` | `['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']` | `string[]` | 图片素材白名单：`project:pick-media` 的文件框过滤、`materialKindOf()` 判类型、界面提示 |
| `VIDEO_MATERIAL_EXTS` | `['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi']` | `string[]` | 视频素材白名单（视频单选） |
| `RENDER_CANVASES` | `['landscape', 'portrait', 'square']` | `RenderCanvas[]` | **成片画布三档**：主进程白名单、渲染层下拉选项来源；类型 `RenderCanvas` 定义在 `types.ts` |
| `CANVAS_SIZES` | `landscape: 1920×1080`、`portrait: 1080×1920`、`square: 1080×1080` | `Record<RenderCanvas, { width; height }>` | 每个画布的实际像素（= composition 尺寸 = 成片尺寸） |
| `CANVAS_LABELS` | `'横屏 16:9'` / `'竖屏 9:16'` / `'方形 1:1'` | `Record<RenderCanvas, string>` | 画布的界面 / 提示词文案（两处必须说同一句话） |
| `DEFAULT_CANVAS` | `'landscape'` | `RenderCanvas` | 项目没设 `canvas` 时用的画布 |
| `EST_CHARS_PER_SEC` | `4` | `number` | **估时语速（字/秒）**，一个语速三处用（见 §2.3） |
| `estimateSubtitleDur` | `(text: string) => number` | 函数 | **估时公式唯一真源**：`max(2.4, 1.6 + 字数 / EST_CHARS_PER_SEC)` |
| **`CastActionParam`** | `{ key; label; type; min?; max?; step?; def?; options? }` | **接口** | 一个动作参数的界面元数据（见 §2.5） |
| **`CAST_ACTION_PARAMS`** | 10 项（`dy` / `dx` / `aL` / `aR` / `rot` / `sq` / `walk` / `blink` 数字 + `eyes` / `mouth` 枚举） | **`CastActionParam[]`** | **动作参数表（唯一真源）**：关键帧编辑器的列、`normalizeActionDef` 的逐参数校验都用它 |
| **`CAST_ACTION_NAME_MAX`** | `12` | **`number`** | 动作名长度上限（编辑器 `maxlength`、主进程起名时截断） |
| **`CAST_ACTION_DURATION`** | `{ min: 0.3, max: 30 }` | **只读对象** | 一条动作的时长范围（秒）：编辑器输入框与主进程 `durationOf()` 都夹它 |
| **`CAST_ACTION_MAX_PER_SCOPE`** | `40` | **`number`** | 同一作用范围（公共 / 某个角色专属）最多存几条动作，`upsertAction` 超限拒绝 |

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

1. **上限是「合计」而非「每组各 20」**：`project:add-materials` 的判据会先把当前列表长度算进去。
2. **`svg` 是刻意的**：矢量图做图标 / 装饰最省体积，且不涉及解码器；扩展名比对**大小写不敏感**。
3. **视频白名单与旧的单个视频素材完全一致**：素材库改造没有扩大视频格式范围。

### 2.2 「成片画布」四个常量的取值理由（源码注释逐字）

```ts
// ===== 成片画布（HyperFrames 的画布预设，**尺寸唯一真源**）=====
// 取值与尺寸必须与 HyperFrames CLI 的 CANVAS_DIMENSIONS 对齐（resources/hyperframes/.../dist/cli.js：
//   landscape 1920x1080 / portrait 1080x1920 / square 1080x1080，另有 4k 三档——本项目只暴露 1080 三档）。
// 为什么放在 shared：三个消费点必须用同一组数——
//   ① 主进程往渲染入口注入舞台 data-width/data-height（成片宽高的真正来源）与 <html data-resolution>
//      （src/main/video.ts；CLI 只认前者，读不到就兜底 1080x1920）
//   ② 主进程把它写进生成提示词，让模型按同一块画布排版式（src/main/projects/prompts.ts）
//   ③ 渲染层选项表与预览 iframe 的画布尺寸（renderer/utils/render.ts、HtmlGenPage/PreviewSection.vue）
// 改这里的尺寸/取值时，CLI 那边若对不上，成片会退回 CLI 自己的兜底 1080x1920 竖屏（见 video.ts 的注释）。
export const RENDER_CANVASES: RenderCanvas[] = ['landscape', 'portrait', 'square'];
```

三条推论：

1. **取值的真源在 CLI**：三档名字是 HyperFrames `CANVAS_DIMENSIONS` 的键（另有 4k 三档未暴露）；但 **CLI 渲染时不读 `data-resolution`**——成片尺寸来自舞台元素的 `data-width`/`data-height`。
2. **它是项目属性、不是渲染档位**：与 `AppSettings.render`（全局默认）和 `Project.render`（项目覆盖）那套层级无关——画布只有一处选择点（「HTML生成」页生成侧的「画布」下拉），存 `project.json` 的 `canvas`。
3. **一个值管三处**：生成提示词的版式尺寸、预览 iframe 的画布、渲染入口注入的舞台宽高与 `<html data-resolution>` 都读同一个值。

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

三条推论：

1. **为什么放在 shared、且必须只有一份**：渲染层决定页面里字幕条目的显示时长，主进程决定落盘的 `[起-止]` 时间轴，而「目标时长 ↔ 旁白字数」是同一个物理量在另外两处的衍生。
2. **它只是估时**：公式下限 2.4 秒、基数 1.6 秒是历史沿用的取值（与语速无关），且**不读音频**；要真实时长得走配音页的「字幕配音（逐句对齐）」实测。**渲染层界面文案也引用该常量、不写死数字**。
3. **不要在别处再写 `4` / `4.5` / `0.15` 这类字面量**：改语速只改 `EST_CHARS_PER_SEC`，改公式只改 `estimateSubtitleDur()`。

### 2.4 品牌常量的推导关系

- `APP_USER_AGENT` 是**派生常量**（`APP_NAME_EN + '/1.0'`），不是独立字面量：改英文名时它自动跟随。版本片段 `'/1.0'` 与 `package.json` 的 `version` **无关**。
- `APP_SLOGAN_SHORT` 是 `APP_SLOGAN` 的**独立子串**（去掉「一站式」），不是运行时 `slice()`。

### 2.5 「角色动作的参数表」五个导出的取值理由（本轮新增）

**界面上在哪**：「角色」页 · 卡片双击（或「…」菜单 ·「动作示范…」）→ 动作示范弹窗 ·「新建动作…」→ **关键帧编辑器**的表格：一行一个时间点、一列一个参数。这张表的列**不在这里另写一份**，就是 `CAST_ACTION_PARAMS`；主进程落盘时也用同一份清单做夹取与白名单。

```ts
// ===== 角色动作的参数表（「角色」页 · 动作示范 · 关键帧编辑器，**唯一真源**）=====
// 角色是纯绘制函数 `window.__cast[id](x, y, u, o)`，动画全靠调用方把这几项塞进 o 里驱动
// （契约见 src/main/agent/html.ts 的 HTML_CAST_SYSTEM 第 4 条）。一条动作 = 这组参数随时间的曲线，
// 所以「界面能填哪些参数」「主进程落盘时收哪些参数」必须是同一份清单——就是这里。
// 方向与量纲都按角色端实际实现写（不是随手给的宽松区间）：
//   dy 正 = 下移（负才是跳起来）/ dx 正 = 右移 / aL、aR 正 = 向外抬起 / sq 正 = 拉长变窄 /
//   rot 弧度、正 = 顺时针（绕脚底）/ walk 相位 1 = 一个完整步。
// mouth 多一个 'auto'：**不传这个参数**，让角色自己按 eyes 定嘴型（多数角色是 mouth 跟随 eyes，
// 显式给 'normal' 会把笑眼配成平嘴）。
```

| `key` | `label`（界面列名） | `type` | 范围 / 选项 | 说明 |
| --- | --- | --- | --- | --- |
| `dy` | 上下 dy | number | `-3 ~ 3`，步长 0.05，默认 0 | **正 = 下移**（跳起来要写负的） |
| `dx` | 左右 dx | number | `-3 ~ 3`，步长 0.05，默认 0 | 正 = 右移 |
| `aL` | 左臂 aL | number | `-2 ~ 2`，步长 0.05，默认 0 | 正 = 向外抬起（0 = 自然下垂） |
| `aR` | 右臂 aR | number | `-2 ~ 2`，步长 0.05，默认 0 | 同上 |
| `rot` | 旋转 rot | number | `-0.8 ~ 0.8`，步长 0.02，默认 0 | 弧度，**正 = 顺时针**（绕脚底转） |
| `sq` | 挤压 sq | number | `-1 ~ 1`，步长 0.05，默认 0 | 正 = 拉长变窄、负 = 压矮变宽 |
| `walk` | 摆腿 walk | number | `0 ~ 4`，步长 0.05，默认 0 | 摆腿相位（1 = 一个完整步） |
| `blink` | 眨眼 blink | number | `0 ~ 1`，步长 0.05，默认 0 | 0 = 睁眼、1 = 闭眼 |
| `eyes` | 表情 eyes | enum | `normal` / `happy` / `sad` / `angry` / `surprise` | 表情 |
| `mouth` | 嘴型 mouth | enum | `auto` + 上面五个 | **`auto` = 不传这个参数**（让角色按 `eyes` 自己定嘴型），落盘时丢弃 |

`CastActionParam` 的字段：`key`（写进 `o` 的键）/ `label`（界面列名）/ `type`（`'number'` 或 `'enum'`）/ `min`、`max`、`step`（数字参数的范围与输入步长）/ `def`（新建一帧时的预填值，与角色端「没传 = 0」一致）/ `options`（枚举取值，`'auto'` = 不传）。

三个上限：

| 常量 | 值 | 谁在用 |
| --- | --- | --- |
| `CAST_ACTION_NAME_MAX` | `12` | 关键帧编辑器的 `maxlength`、主进程起名时 `.slice(0, 12)` |
| `CAST_ACTION_DURATION` | `{ min: 0.3, max: 30 }` | 编辑器的时长输入（`min` / `max`）、`projects/ipc/castActions.ts` 的 `durationOf()`、`cast/actions.ts` 的 `normalizeActionDef`（两位小数） |
| `CAST_ACTION_MAX_PER_SCOPE` | `40` | `cast/actions.ts` 的 `upsertAction`：同一作用范围超 40 条直接拒绝 |

**三条推论**：

1. **改参数表等于改三处**：编辑器的列（`CastActionEditor.vue` 直接遍历 `CAST_ACTION_PARAMS`）、主进程的夹取 / 白名单（`normalizeActionDef`：数字夹到 `min`–`max`、枚举查 `options`、`'auto'` 丢弃）、内置动作的量级（`presets.ts` 照同一套方向写）。
2. **`mouth` 的 `'auto'` 是「不传」，不是「一个值」**：编辑器里选「自动」会 `delete row.o[key]`，主进程落盘时也把它丢掉——这样角色才会按 `eyes` 定嘴型。
3. **方向不是随口写的**：`dy` 正 = 下、`dx` 正 = 右、`aL`/`aR` 正 = 向外、`sq` 正 = 拉长变窄、`rot` 正 = 顺时针，都按角色端实际实现（`ctx.translate(x + dx*u, y + dy*u)` 之类）写；写反了动作会朝反方向演。

## 3. 品牌注入链路（三条路径）

| 路径 | 消费方 | 机制 |
|---|---|---|
| ① 直接 `import` | `src/main/whisper.ts`（`APP_USER_AGENT`）、`App.vue`（`APP_NAME`）、`HomePage/index.vue`（`APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN`） | 编译期引入，打包器内联进各自产物 |
| ② HTML 占位符 + 构建期注入 | `src/renderer/index.html` 的 `<title>` 与启动画面 | 写 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()`（`transformIndexHtml` 且 `order: 'pre'`）在 dev/build 期替换 |
| ③ JSON 无法 import ⇒ 只能校验 | `package.json` 的 `build.productName` | `electron.vite.config.ts` 的 `checkBrandConsistency()` 读 `package.json`，与 `APP_NAME_EN` 不一致时 `console.warn('[dsh:brand] …')` |

`brandHtmlPlugin` 用 `order: 'pre'` 是刻意的：早于 Vite 自带的 `%VITE_*%` 替换，保证占位符一定先被吃掉。

## 4. 改品牌名的完整清单

| # | 位置 | 改什么 |
|---|---|---|
| 1 | **本文件** §应用标识 | `APP_NAME` / `APP_NAME_EN`（`APP_USER_AGENT` 随之派生）、按需改两句口号 |
| 2 | `package.json` | `build.productName`、`description`、`build.appId` |
| 3 | `src/renderer/index.html` | 无需改动——用占位符，构建期注入 |
| 4 | 渲染层组件 | 无需改动——直接 `import` 本文件 |

两点**不在**清单里（源码注释明确排除）：

- **渲染层 localStorage 的 `'myapp.*'` 键名故意不跟随品牌名**：prod 下页面走 `file://` 同源，键名就是用户数据的地址。见 `src/renderer/src/constants.ts`。
- **版本号不在本文件**：一律运行时取 `app.getVersion()`。

## 5. 依赖与协作

| 方向 | 对象 | 说明 |
|---|---|---|
| 依赖 | `src/shared/types.ts`（仅 `import type { RenderCanvas }`） | 零运行时 import、零副作用，是纯常量模块（另有一个纯函数 `estimateSubtitleDur`） |
| 被 import | `src/main/whisper.ts` | `APP_USER_AGENT` → 请求头 |
| 被 import | `src/renderer/src/App.vue` / `HomePage/index.vue` | 品牌文案 |
| 被 import | `src/main/projects/materials.ts` | `IMAGE_MATERIAL_EXTS` / `MAX_MATERIALS` / `VIDEO_MATERIAL_EXTS`：`materialKindOf()`、`materialExtsText()`、`normalizeMaterials()`、`project:pick-media` 的文件框过滤、`project:add-materials` 的上限判据 |
| 被 import | `src/main/projects/store.ts` | `estimateSubtitleDur`：`parseSubtitle()` 给「整行没有 `[时间]` 前缀」的行兜底起始时间 |
| 被 import | `src/renderer/src/pages/SubtitlePage/helpers.ts` | `estimateSubtitleDur` → 再导出为 `estDur` |
| 被 import | `src/renderer/src/pages/SubtitlePage/index.vue` / `ContentPage/AiChatPanel.vue` | `EST_CHARS_PER_SEC`（界面文案与估算时长，不写死数字） |
| 被 import | `src/main/agent/script.ts` | `EST_CHARS_PER_SEC`：系统提示词第 6 条与 `buildScriptPrompt()` 的字数预算 |
| 被 import | `src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue` | 素材白名单与上限（`n / 20`、支持格式提示） |
| 被 import | `src/main/video.ts` | `CANVAS_SIZES` / `DEFAULT_CANVAS` / `RENDER_CANVASES`：白名单校验、舞台宽高与 `<html data-resolution>` |
| 被 import | `src/renderer/src/utils/render.ts` | 画布常量 → `RENDER_CANVAS_OPTIONS` / `canvasLabel()` / `canvasSize()` / `normalizeCanvas()` |
| 被 import | **`src/main/cast/actions.ts`** | **`CAST_ACTION_DURATION` / `CAST_ACTION_MAX_PER_SCOPE` / `CAST_ACTION_NAME_MAX` / `CAST_ACTION_PARAMS`**：动作规范化、上限、id / 时长校验 |
| 被 import | **`src/main/cast/presets.ts`** | 只 import 类型（`CastActionDef`）；参数键名与方向按本文件的表来写 |
| 被 import | **`src/main/projects/ipc/castActions.ts`** | **`CAST_ACTION_DURATION` / `CAST_ACTION_NAME_MAX`**：`durationOf()` 夹 0.3–30、动作名截 12 |
| 被 import | **`src/renderer/src/pages/CastPage/CastActionEditor.vue`** | **`CAST_ACTION_DURATION` / `CAST_ACTION_NAME_MAX` / `CAST_ACTION_PARAMS`**：关键帧表的列与三个上限 |
| 被 import | `electron.vite.config.ts` | `APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN_SHORT` → 注入与校验 |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 两份子工程都 `include: src/shared/**/*.ts`，三端都能引用 |
| 别名 | `@shared/*` → `src/shared` | 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 两处声明 |

## 6. 注意事项与实现要点

- **不是 IPC 契约**：`ipc.ts` / `types.ts` 的「禁止改动」约束不适用于本文件——改品牌名不需要动任何频道名或载荷格式。但**素材常量改的是产品规则**、**画布常量更硬**（`CANVAS_SIZES` 必须与 CLI 的 `CANVAS_DIMENSIONS` 一致，改错等于成片尺寸错）、**估时语速会一起改三处**、**动作参数表会一起改编辑器的列与落盘校验**。
- **上限只有一个来源**：不要在渲染层或主进程另写 `20` / `40` / `12`；渲染层只做展示，真正的截断在主进程。
- **估时公式只有一个来源，语速也只有一个来源**：不要另写 `0.15` / `1.6` / `2.4` / `4` / `4.5` 这类字面量；渲染层保留的 `estDur` 只是别名。
- **动作参数不要在两个地方各写一份**：`CAST_ACTION_PARAMS` 是界面与主进程的共同真源；新增一个参数（比如某个角色自己的 `tail`）若只加在编辑器里，主进程落盘时会把它过滤掉。
- **零运行时开销**：常量被各端打包器内联，main / preload / renderer 各自持有副本。
- **不要在 shared 放业务逻辑**：唯一允许的函数是 `estimateSubtitleDur()`——纯函数、无副作用、无外部依赖。
- **`productName` 的漂移只能告警、不能报错**：`checkBrandConsistency()` 内部 `try/catch` 并不一致时 `console.warn`。
- **`APP_NAME_EN` 同时是三类东西**：界面英文名、安装包/可执行文件名（经 `productName`）、出网 `User-Agent` 前缀。
- **`name`（npm 包名）在此清单之外——但它是 userData 目录名的来源**：改 `name` 等于换数据目录，必须把旧名字加进 `index.ts` 的 `LEGACY_DIR_NAMES`（见 [main/index.ts.md](../main/index.ts.md) §3.1）。
