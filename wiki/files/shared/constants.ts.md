# src/shared/constants.ts

> 应用级公共常量：品牌文案（中文名 / 英文名 / 口号）+ 出网请求 User-Agent + **项目素材的类型白名单与合计上限**的唯一来源

- **所在目录**：`src/shared/`
- **类型**：共享常量（纯字面量，无 import、无副作用）
- **规模**：41 行（本轮由 30 → 41：新增「项目素材」一节 3 个常量）
- **对外导出**：`APP_NAME`、`APP_NAME_EN`、`APP_SLOGAN`、`APP_SLOGAN_SHORT`、`APP_USER_AGENT`（5 个字符串常量）+ `MAX_MATERIALS`、`IMAGE_MATERIAL_EXTS`、`VIDEO_MATERIAL_EXTS`（**本轮新增的 3 个素材常量**）

## 1. 作用与职责

本文件是**品牌文案的唯一定义处**：中文显示名、英文名、两句口号、以及出网请求的 User-Agent 都从这里导出。它不注册任何东西、也不调用任何接口，只提供字符串 / 数值 / 字符串数组常量。

它存在的理由（源码头部注释写明）：品牌文案原先散落在 `src/renderer/index.html` 的窗口标题与启动画面、`App.vue` 标题栏、`HomePage` 首页、`whisper.ts` 的 User-Agent 等处，「改一处漏一处」，而且散落的字符串没有任何编译期提示。现在各处一律 `import` 本文件，改品牌名只需要动清单上的少数几处。

**「项目素材」一节（本轮新增）复用同一思路**：素材的类型白名单与合计上限原先只可能写死在主进程 handler 里，现在集中在本文件，**主进程用它做准入与截断，渲染层用同一份常量做展示**（`n / 20` 计数与「支持哪些格式」的提示行），两端不会各写一套而悄悄漂移。

与 `ipc.ts` / `types.ts` 的定位差别：

| 文件 | 内容 | 是否属于「IPC 契约」 |
|---|---|---|
| `ipc.ts` | 85 个 IPC 频道名字符串（10 组） | 是（禁止改动） |
| `types.ts` | 跨进程载荷类型 | 是（线上字段格式禁止改动） |
| `constants.ts` | 品牌文案、请求标识、**素材白名单与上限** | **否**——改它不影响任何频道名或载荷格式；但**素材常量会同时约束主进程校验与界面提示**，改动等于改产品规则 |

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

### 2.2 品牌常量的推导关系

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
| 依赖 | 无 | 零 import、零副作用，是纯常量模块 |
| 被 import | `src/main/whisper.ts` | `APP_USER_AGENT` → `httpGetFollow()` 的请求头 |
| 被 import | `src/renderer/src/App.vue` | `APP_NAME` → 标题栏文案 |
| 被 import | `src/renderer/src/pages/HomePage/index.vue` | `APP_NAME` / `APP_NAME_EN` → `brandTag`；`APP_SLOGAN` → `<h1>` |
| 被 import | `src/main/projects.ts` | **`IMAGE_MATERIAL_EXTS` / `MAX_MATERIALS` / `VIDEO_MATERIAL_EXTS`**（本轮新增）：`materialKindOf()` 判类型、`materialExtsText()` 拼提示、`normalizeMaterials()` 截断、`project:pick-media` 给文件框过滤、`project:add-materials` 判上限 |
| 被 import | `src/renderer/src/pages/HtmlGenPage/MaterialsSection.vue` | **`IMAGE_MATERIAL_EXTS` / `MAX_MATERIALS` / `VIDEO_MATERIAL_EXTS`**（本轮新增）：`n / {{ MAX_MATERIALS }}` 计数、`extText` 支持格式提示、上限 `title` |
| 被 import | `electron.vite.config.ts` | `APP_NAME` / `APP_NAME_EN` / `APP_SLOGAN_SHORT` → `brandHtmlPlugin()` 与 `checkBrandConsistency()` |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 两份子工程都 `include: src/shared/**/*.ts`，故 main / preload / 渲染层三端都能引用 |
| 别名 | `@shared/*` → `src/shared` | 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 两处声明，新增别名需同步；渲染层引用写法为 `import { APP_NAME } from '@shared/constants'`（素材常量同理：`import { IMAGE_MATERIAL_EXTS, MAX_MATERIALS, VIDEO_MATERIAL_EXTS } from '@shared/constants'`） |

## 6. 注意事项与实现要点

- **不是 IPC 契约**：`ipc.ts` / `types.ts` 的「禁止改动」约束不适用于本文件——改品牌名不需要动任何频道名或载荷格式。但**素材常量改的是产品规则**：`MAX_MATERIALS` 一改，主进程的准入 / 截断与界面的 `n / 20` 会同时变，提示词长度与生成质量也随之变。
- **上限只有一个来源**：不要在渲染层或主进程另写 `20`；渲染层只做展示（超限按钮不禁用，交给主进程回报跳过数），真正的截断发生在 `normalizeMaterials()` 与 `project:add-materials`。
- **零运行时开销**：常量被各端打包器内联，main / preload / renderer 各自持有副本，不存在跨进程共享对象。
- **不要在 shared 放业务逻辑**：本层任何**函数实现**都会同时进入 main 与 preload 两个 bundle（`ipc.ts` 文档中的同一约束），因此这里只放字面量与常量派生（`materialKindOf()` 这类判断留在 `src/main/projects.ts`）。
- **`productName` 的漂移只能告警、不能报错**：`checkBrandConsistency()` 内部 `try/catch` 并在不一致时 `console.warn`，因为「校验失败不应影响构建」；改 `APP_NAME_EN` 后请留意构建/开发启动日志里的 `[dsh:brand]` 提示。
- **`APP_NAME_EN` 同时是三类东西**：界面英文名、安装包/可执行文件名（经 `productName`）、出网 `User-Agent` 前缀——改名时三者会一起变，属预期行为。
- **`name`（npm 包名）在此清单之外——但它是 userData 目录名的来源**：Electron 的 `userData` 就是 `%APPDATA%\<name>`（`src/main/index.ts` **不做** `app.setPath`）。因此**改 `name` 等于换数据目录**：必须把旧名字手动加进 `index.ts` 的 `LEGACY_DIR_NAMES`，启动扫描时才会弹窗让用户选「迁移 / 删除 / 稍后」（见 [main/index.ts.md](../main/index.ts.md) §3.1）。这与本文件的品牌文案仍是两件事。
