# src/main/video.ts

> HyperFrames 转视频：注册 3 个 IPC 频道（含 1 路进度推送），**就地渲染**到 `<项目目录>/video/output.mp4`——先裁定成片时长（模型声明 / 实测时间轴 / 最长媒体三档）并裁掉超长媒体副本，再在项目内临时子目录写渲染入口。**画布和时长都是「写两处、只有一处生效」**：画布 = 舞台元素的 `data-width` / `data-height`（**成片宽高的真正来源**，`applyCanvasSize`）+ 入口 `<html>` 的 `data-resolution`（**页面自描述**，`applyCanvasDeclaration`）；时长 = 舞台元素的 `data-duration`（**CLI 编译阶段唯一读的地方**，`applyStageDuration`）+ `<html data-composition-duration>`（**页面自描述**，预览 / `info` / 下次生成读它）。`<html>` 上那两样渲染链路都**不读**。全程把 CLI 子进程日志流式回推渲染层。**动手渲染之前还有一道无限循环静态守卫**：`index.html` 或章节脚本 `pages/cNN.js` 里出现 GSAP 的 `repeat: -1`（或 `repeat: Infinity`）就当场拒绝、不进 CLI（GSAP 把这种 tween 当成 1e10 秒，不拦的话成片时长没法确定、CLI 会按 1e10 秒排帧、永远渲不完）。量时间轴的探针副本落在项目根、用未抬级原文（否则章节脚本 `./pages/cNN.js` 会 404、时间轴量回 0）。

- **所在目录**：src/main/
- **类型**：主进程业务模块（IPC 注册 + 子进程编排）
- **规模**：485 行（实测 `[IO.File]::ReadAllLines`；上一版 474 行，本轮 **+11 行**：渲染前按版本同步共享绘制助手 `./core.js`，见 §3.3 第 7.5 步）
- **对外导出**：`register`（唯一导出）

## 1. 作用与职责

本模块是渲染层视频环节的主进程后端，服务两个页面：**发起渲染与档位选择的「HTML生成」页**、**播放成品的「视频预览」页**。覆盖的能力：

| 能力 | 说明 |
|------|------|
| 选 HTML 文件 | 弹系统文件选择框挑 HTML（`dialog:open-html`，**保留但渲染层当前无调用方**） |
| 转视频（准备阶段） | 校验 HyperFrames 合规性 → **无限循环静态守卫（页面里有 GSAP 的 `repeat: -1` / `repeat: Infinity` 直接拒绝，见 §1.3）** → 定位 hyperframes CLI 与 Node（`{ cmd, env }` 一对）→ **就地确定渲染根（HTML 所在的项目目录）** → 随包前端库本地化（幂等；GSAP / p5 / p5.brush）→ 注入环境变量 → **取画布（白名单校验，缺省落 `DEFAULT_CANVAS`）** → **把画布写两处（舞台 `data-width`/`data-height` + `<html data-resolution>`）、裁定成片时长、把裁定出的时长写进舞台 `data-duration`（`applyStageDuration`——**CLI 编译阶段唯一读的地方**；`<html data-composition-duration>` 只为页面自描述）、裁掉超长媒体的副本、写渲染入口** |
| 转视频（渲染阶段） | 按载荷里的渲染档位拼 `--quality` / `--fps`（**不拼 `--resolution`**：画布已经写进入口的舞台 `data-width` / `data-height` 了），`spawn` 子进程在项目内渲染出 `video/output.mp4`，全程把 stdout/stderr 回推渲染进程，收尾删除临时入口目录 |

**最大的形态变化是「就地渲染」**（取代旧的临时工作目录方案）：

| | 旧实现 | 现实现 |
|---|---|---|
| 渲染根（`cwd`） | `userData/hf-projects/html-video-<时间戳>/` | `path.dirname(htmlPath)`，即 **HTML 所在的项目目录** |
| 素材 | 整目录 `cpSync` 复制进工作目录 | **不复制**；入口 HTML 里仍按**相对项目根**写（如 `video/x.mp4`），CLI 也按项目根解析 |
| 成品 | 留在临时工作目录里（几百 MB） | 直接生成在 `<项目目录>/video/output.mp4` |
| 渲染入口 | 工作目录的 `index.html` | 项目内的临时子目录 `<项目目录>/.render-tmp/entry.html`（CLI 硬要求：`-c` 的入口必须落在项目根之内），**渲完即删**（`fs.rmSync(tmpDir)`） |
| 随包前端库 | 对工作目录里的副本**再做一次本地化** | 本文件**不再**做「面向渲染副本」的本地化改写，只调用一次幂等的 `hfEnv.localizeVendorHtml()`（老项目 HTML 仍引 CDN 时才真正改写），再用 `hfEnv.ensureVendorFiles(projDir, localized)` 把库文件落进项目目录；入口在子目录里，因此 `prepareEntry()` 用 `hfEnv.hoistVendorRefs(localized, '../')` 把 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 引用改成 `../…` |

为什么不复制也能跑（源码注释给出的三条理由）：① 随包前端库本地化是幂等的、产物就是项目目录里的 `gsap.min.js` / `p5.min.js` / `p5.brush.js`（`projects.ts` 的保存/生成流程已在做，`ensureVendorFiles` 按需补位）；② BGM 注入本来只写 `index.html`（`projects.ts` 的 `applyBgmToHtml`），渲染时不需要再动；③ 入口放在项目内的临时子目录、媒体用相对项目根的引用，实测 CLI 能正常解析（2026-10 验证）。好处是**不再复制 200 MB+ 素材、不再留几百 MB 的 `hf-projects` 工作目录、成品直接长在项目里**。

模块**不再自行声明载荷/结果类型**：仅本文件使用的 `RenderPayload` / `RenderResult` 已删除，统一改用 `src/shared/types.ts` ⑦ 节的 `VideoRenderPayload`（`extends RenderOverride`，即 `{ htmlPath?: string; quality?: RenderQuality; fps?: RenderFps; canvas?: RenderCanvas }`——`canvas` 是**项目属性**（成片画布方向）、不是渲染档位）、`VideoRenderResult`（成功 `{ ok: true; outputVideo: string; projectDir: string }`，失败 `{ ok: false; message: string; compatible?: boolean; needPacks?: RuntimePackName[] }`），并从共享层引入 `RegisterCtx`、`RuntimePackName`。渲染档位的**白名单校验复用** `./settings` 的 `pickRenderOverride()`（与 `projects.ts` 同一处实现）。`video:progress` 推送仍就地构造 `{ text }`（该形状即共享层 ⑧ 节的 `VideoProgressPayload`，但本文件没有单独 import 它）。

### 1.1 成片时长：谁说了算

源码在模块顶部用一整段注释写清了这条规则（HyperFrames 的 `cli.js` 实测结论）：

> **成片时长 = max(根节点声明的时长, 页面里最长媒体的时长)**。

声明只能把片子拉长、拉不短 ⇒ **只声明没用，超长的媒体必须一起裁掉**，否则「动画 45 秒、素材 225 秒」就会渲出 225 秒、后 180 秒全是黑帧（本项目的真实故障）。时长来源按下面的顺序取（前一个拿到就不看后面的）：

| 顺序 | 来源 | 成本 / 口径 |
|---|---|---|
| ① | 模型在 `<html data-composition-duration="…">` 里声明的（**应用就是从这一处读**：提示词要求模型写在那儿） | 零成本；提示词已要求模型写（见 [projects.md](./projects.md) 的【成片时长】条） |
| ② | 现场量 GSAP 时间轴 | 无头 Chromium 跑一次，**与预览脚本的 `clock()` 同一口径**（多个时间轴取最大）；不需要字幕，3~5 秒 |
| ③ | 页面里最长媒体的时长 | 老页面没有时间轴时的兜底，即拆分前的行为（交给 CLI 自己裁定） |

裁定出的 `target` 不是「写回它被读出来的那个地方」就完事：**CLI 渲染链路只读舞台元素的 `data-duration`**（见下面的小节），所以 `prepareEntry()` 把同一个 `target` 写两处——**① `<html data-composition-duration>` 只为页面自描述**（应用内预览、`hyperframes info`、下次生成读它；**CLI 渲染不读**，且仅在页面原本没声明时才补）、**② 舞台元素的 `data-duration` 才是真正生效的那处**。裁超长媒体副本仍按同一个 `target`，未变。

#### 成片时长：CLI 的 `compileForRender` 只认舞台的 `data-duration`

HyperFrames CLI 0.8.33 的 producer 编译阶段，`resources/hyperframes/node_modules/hyperframes/dist/cli.js` 第 **126320** 行就是取成片时长的全部代码：

```js
staticDuration = rootEl ? rootEl.getAttribute("data-duration") ?? rootEl.getAttribute("data-composition-duration") ?? 0 : 0
```

`rootEl` 就是下面 §1.2 里那个「文档里**第一个**带 `data-composition-id` 的元素」。**该值为 0 时**，渲染计划（同文件第 **127154–127166** 行）改为向浏览器探时间轴（`getCompositionDuration(session)`）并采用它——也就是「页面 GSAP 时间轴多长，成片就多长」。

⇒ **`<html>` 上的 `data-composition-duration` 渲染链路不读**：`<html>` 既没有 `data-composition-id`、也不是那个 `rootEl`。所以「把时长写进 `<html>`」以前等于没写——成片长度实际由页面 GSAP 时间轴决定（历史现象：声明 120s、时间轴也恰好 120s，才看着像生效）。

现在 `prepareEntry()` 写两处（顺序见 §4）：

| # | 写哪儿 | 谁在读 | 实现 |
|---|---|---|---|
| ① | `<html data-composition-duration>`（**仅在页面原本没声明时才补**） | 页面自描述：应用内预览、`hyperframes info`、下次生成读它 | `prepareEntry()` 里内联的 `entry.replace(/<html\b([^>]*)>/i, …)` |
| ② | 舞台元素的 `data-duration`（先剥掉该元素上已有的 `data-duration` 与 `data-composition-duration`，避免同名两个） | **`compileForRender`——真正决定成片长度** | `applyStageDuration()`（走共用助手 `rewriteStageTag()`） |

**口径变化（用户可见）**：声明时长从此真的生效——**声明比时间轴长会把片子拉长到声明值；声明比时间轴短会按时长截断**。裁超长媒体副本仍按同一个 `target`，未变。

> **前提是时长本身有限**：`repeat: -1` 的 tween 会让 GSAP 的时间轴 `duration()` 变成 1e10 量级（不是 `Infinity`），上面三级兜底拿到的也是一个荒谬的数。所以渲染前先过 §1.3 那道静态守卫。

### 1.2 成片画布：谁说了算

画布由**项目属性**决定（`project.json` 的 `canvas`，三档 `landscape` / `portrait` / `square`，缺省 = `shared/constants.ts` 的 `DEFAULT_CANVAS` = `landscape`），渲染层随载荷下发；`video:render` 用同一份共享常量 `RENDER_CANVASES` 做白名单校验：

```ts
const wanted = payload && payload.canvas
const canvas: RenderCanvas = wanted && RENDER_CANVASES.indexOf(wanted) >= 0 ? wanted : DEFAULT_CANVAS
```

#### 成片宽高：CLI 的 `compileForRender` 只认舞台的 `data-width` / `data-height`

HyperFrames CLI 0.8.33 的 producer 编译阶段，`resources/hyperframes/node_modules/hyperframes/dist/cli.js` 第 **126316–126319** 行就是决定成片宽高的全部代码：

```js
const { document: document2 } = parseHTML(html);
const rootEl = document2.querySelector("[data-composition-id]");
const width = rootEl ? parseInt(rootEl.getAttribute("data-width") || "1080", 10) : 1080;
const height = rootEl ? parseInt(rootEl.getAttribute("data-height") || "1920", 10) : 1920;
```

⇒ **成片宽高 = 文档里第一个带 `data-composition-id` 的元素（最外层舞台）的 `data-width` / `data-height`；读不到就分别兜底 1080 / 1920——也就是 1080×1920 竖屏。**

#### `<html data-resolution>` 不在渲染链路上

`parseResolutionFromHtml()` 只有 `info` 命令这条链在用：`info` 的 handler 在 cli.js 第 **157255** 行调 `parseHtml(html)`，`parseHtml()` 内部第 **54322** 行才是 `parseResolutionFromHtml(doc) ?? parseResolutionFromCss(doc, allStyles)`。`render` 那条链路（`compileForRender`）**一次都不读** `data-resolution`。

⚠️ 旧版文档（以及只写 `data-resolution` 的旧实现）认为「`data-resolution` 在 CLI 解析优先级里最高、压得住页面自己的舞台尺寸 ⇒ 成片必与项目所选一致」——**这是错的，已按实测删除**。照它做出来的正是本项目的真实故障：2026-10-21「HTML生成」页选横屏，成片仍是 1080×1920 竖屏，而 `video-duration.log` 里明明白白记着 `landscape`。

#### 所以画布要写两处，缺一处都不成立

| # | 写哪儿 | 谁在读 | 实现 |
|---|---|---|---|
| ① | 舞台元素（第一个带 `data-composition-id` 的元素）的 `data-width` / `data-height` | **`compileForRender`——真正决定成片宽高** | `applyCanvasSize()` |
| ② | 入口 `<html>` 的 `data-resolution`（CLI 只认 `landscape` / `portrait` / `landscape-4k` / `portrait-4k` / `square` / `square-4k`） | 页面自描述：应用内预览与 `hyperframes info` 读得到 | `applyCanvasDeclaration()` |

两处都由应用写、**不靠模型**：模型写的画布可能与该项目的选择不一致（甚至整份都不写），而「项目所选定下的画布说了算」是这一层唯一该保证的事。

`applyCanvasSize(html, canvas): string | null` 只决定「往舞台上写什么」，**找舞台 + 改写开标签属性由共用助手 `rewriteStageTag(html, rewrite)` 承担**（`applyStageDuration()` 也走它，两处口径不会分叉）：

- `rewriteStageTag` 的规则：**开标签整体匹配** `/<([a-zA-Z][-a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g`（属性值里的 `>` 由引号分支吃掉），再用属性分词器 `/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g` 判标签上有没有 `data-composition-id`；**命中第一个就停**——与 CLI 的 `document.querySelector("[data-composition-id]")` **同口径**（树序里祖先在前，所以命中的是最外层舞台，不是嵌套子 composition）；命中后把该标签的属性串交给调用方的 `rewrite` 回调决定写什么；**找不到舞台返回 `null`**（HTML 原样不动），调用方据此写不同的日志。
- `applyCanvasSize` 的 `rewrite` 是：先 `stripAttrs(attrs, ['data-width', 'data-height'])` 剥掉该元素上已有的宽高，再写入 `CANVAS_SIZES[canvas]` 的 `data-width` / `data-height`。
- `applyStageDuration` 的 `rewrite` 是（见 §1.1）：先 `stripAttrs(attrs, ['data-duration', 'data-composition-duration'])` 剥掉该元素上已有的两个时长属性（**避免同名两个**），再写入 `data-duration="<target>"`。

HyperFrames 自己的模板是把 `data-composition-id` 写在 `<html>` 上的（cli.js 第 55774 行：`<html data-composition-id="…" data-composition-duration="…">`），那种页面的「舞台」就是根节点——`data-width` / `data-height`、`data-resolution`、`data-duration` 会落在同一个 `<html>` 标签上，而**这个 `<html>` 恰好就是 CLI 的 `rootEl`，所以此时写在 `<html>` 上确实是生效的**。

**已知限制（写进了 `rewriteStageTag()` 的注释，两条助手共用一份）**：CLI 的 DOM 查询不进入 `<template>` 的内容，本实现的正则会跳；不过本应用的生成提示词不产出 `data-composition-src` 子 composition（含 `<template>` 包装），将来支持子 composition 时要一起改这里。

`applyCanvasDeclaration(html, canvas)` **行为不变**，只把内部助手从 `stripDataResolution(attrs)` 换成通用的 `stripAttrs(attrs, ['data-resolution'])`：**先剥后写**；**整篇连 `<html>` 标签都没有时**（模型输出被截断的罕见情况）直接前置一个 `<html data-resolution="…">`。

剥属性刻意**不用一条「匹配 `data-resolution=`」的正则**，而是**逐属性扫描**、`<html>` 与舞台两处共用同一个助手 `stripAttrs(attrs, names)`：用 `/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g` 逐个消费属性（引号包住的值整段被消费，值内部的同名文本不会再被二次匹配），只把**属性名命中 `names` 里任一项（忽略大小写）**的那个匹配替换为空串、其余原样返回，最后 `.trim()`，非空则前面补一个空格。源码注释记了两条动机：① 只匹配**带值**写法（`data-resolution="…"`）会漏掉 HTML 合法的**无值**写法 `<html data-resolution>`——注入后同一个标签上就有两个同名属性，而 **HTML 解析规则取第一个**（正好是空值）⇒ 项目所选被默默压过、注入等于没做（2026-10 实测复现）；② 反过来把 `=` 与值都写成可选，又会命中**别的属性值里**的同名文本（实测 `<html data-x="data-resolution">` 会连带把 `data-x` 的值清成空），所以必须按属性逐个扫描。

**传 `--resolution` 不能替代它**：CLI 对该参数的说明是「composition 尺寸不变，Chrome 用更高 DPR（`deviceScaleFactor`）渲染后落到目标尺寸」，并且**要求宽高比与 composition 一致、缩放必须是整数倍**（实现里对宽高比不符 → aspect-mismatch、目标比 composition 小 → 「Downsampling via --resolution is not supported」、比例非整数 → non-integer scale factor 三种情况分别报错），所以它无法把竖屏 composition 掰成横屏。

写盘前还会往 `userData/video-duration.log` 追加一行留痕（与成片时长裁定同一个日志文件——这类「为什么渲出来是这样」的问题必须可事后查），两种文案：

- 找到了舞台：`成片画布 = <canvas>（<宽>x<高>）：已写入舞台 data-width/data-height 与 <html data-resolution>`
- 页面里没有带 `data-composition-id` 的舞台：`成片画布 = <canvas>（<宽>x<高>）：页面里找不到带 data-composition-id 的舞台，只写了 <html data-resolution>（CLI 将兜底 1080x1920 竖屏）`

### 1.3 无限循环：渲染前就拦住，不进 CLI

**页面上看到的效果**：在「HTML生成」页点「转视频」，如果这个项目的 `index.html` 里还有 GSAP 的 `repeat: -1`，界面上不会开始渲染，而是直接在「预览」卡的状态行收到一句人话拒绝——「页面里有无限循环动画（GSAP 的 repeat: -1），成片时长没法确定，转视频会永远渲不完。请到「HTML生成」页让这些循环改成有限次数（例如 repeat: 12, repeatDelay: 0.4，次数按目标秒数算好）后再转视频。」（这句就是主进程返回的 `message`，渲染层原样显示）。

**为什么必须拦**（源码注释里的根因链，全部实测）：GSAP 把 `repeat:-1` 的 tween 时长当成 **1e10 秒**（**不是** `Infinity`），父时间轴 `duration()` 就是「1e10 + 该 tween 的起点」；而 HyperFrames 的成片时长 = `max(页面声明, 时间轴实测)`，应用写进舞台的 `data-duration` 压不过它 ⇒ CLI 会按 1e10 秒去计划帧数，实际永远渲不完（2026-10 实测：预览总时长显示 `166666668:12`，即 1e10+92 秒）。与其让它排几个小时的队，不如在门口说清楚。

**判据是静态的**（`video:render` handler 里，`isHyperframesComposition(raw)` 兼容性检查**之后**、`rmSync(tmpDir)` / `prepareEntry()` **之前**）。**扫描范围是整份页面的脚本**：`index.html` 与章节模式下的 `pages/cNN.js`（同一正则一起扫）。核心那一次判断源码逐字：

```ts
    // ===== 无限循环护栏：页面里有 GSAP 的 repeat: -1 就当场拒绝 =====
    // GSAP 把 repeat:-1 的 tween 时长当成 1e10 秒（**不是** Infinity），父时间轴 duration() 就是
    // 「1e10 + 该 tween 的起点」。而 HyperFrames 的成片时长 = max(页面声明, 时间轴实测)，应用写进舞台的
    // data-duration 压不过它 ⇒ CLI 会按 1e10 秒去计划帧数，实际永远渲不完（2026-10 实测：预览总时长显示
    // 166666668:12，即 1e10+92 秒）。与其让它排几个小时的队，不如在门口说清楚。
    // 静态判据足够：GSAP 的无限循环只有 repeat: -1 / repeat: Infinity 两种写法；
    // CSS 的 animation-iteration-count: infinite 不算——HF 的 CSS 适配器对 endTime 非有限的动画直接跳过。
    if (/repeat\s*:\s*(?:-1|Infinity)\b/i.test(raw)) {
      return {
        ok: false,
        message: '页面里有无限循环动画（GSAP 的 repeat: -1），成片时长没法确定，转视频会永远渲不完。' +
          '请到「HTML生成」页让这些循环改成有限次数（例如 repeat: 12, repeatDelay: 0.4，次数按目标秒数算好）后再转视频。'
      } as VideoRenderResult;
    }
```

四条边界（都在上面注释里写死了）：

| 边界 | 行为 |
|---|---|
| 命中后做什么 | 直接 `return { ok: false, message }`——**不进 CLI、不写 `.render-tmp`、不裁媒体、不定位 CLI / Node**（这段位置刻意在那一切之前） |
| 认哪些写法 | 只认 GSAP 的 `repeat: -1` / `repeat: Infinity`（`/repeat\s*:\s*(?:-1|Infinity)\b/i`，忽略大小写、冒号两侧可有空白） |
| 扫哪些文件 | `index.html` + 章节模式下的 `pages/cNN.js`（同一正则一起扫——章节脚本也是页面的一部分，只扫 `index.html` 会漏掉章节里的无限循环） |
| **不**拦什么 | CSS 的 `animation-iteration-count: infinite` **不拦**——HF 的 CSS 适配器只收 `endTime` 有限的动画，无限 CSS 动画本来就不会把时长撑大 |
| 修完之后 | 用户到「HTML生成」页把循环改成有限次数（如 `repeat: 12, repeatDelay: 0.4`）再点「转视频」即可；提示词侧也已要求模型不许写无限循环（见 [projects.md](./projects.md) 的【禁止无限循环】块） |

> 这是**判据放在渲染入口**、而不放在预览侧的第二个落点：预览侧的同类闸门在 `projects.ts` 的 `HG_PREVIEW_CTRL` 里（超长时长降级成 `--:--`，见 [projects.md](./projects.md) §5），两者各自独立、互不依赖。

## 2. 导出与关键实现

### 2.1 对外导出

| 名称 | 类型 | 说明 |
|------|------|------|
| `register` | 函数 | `register(ctx?: RegisterCtx): void`，注册全部 IPC handler；`getWindow` 取自 `ctx.getWindow`，缺省时回退为 `() => null` |

### 2.2 注册的 IPC 频道

| 频道常量 | 频道路由名 | 方向 | 载荷 → 返回 |
|----------|-----------|------|-------------|
| `IPC.Video.OpenHtml` | `dialog:open-html` | `ipcMain.handle` | 无参 → `string \| null`（选中文件绝对路径；渲染层当前无调用方） |
| `IPC.Video.ShowInFolder` | `video:show-in-folder` | `ipcMain.handle` | `filePath?: string` → `void` |
| `IPC.Video.Render` | `video:render` | `ipcMain.handle` | `VideoRenderPayload` → `VideoRenderResult` |
| `IPC.Video.Progress` | `video:progress` | 主进程 → 渲染进程推送（`event.sender.send`） | `{ text: string }`（形状即共享层的 `VideoProgressPayload`） |

### 2.3 模块级常量

| 名称 | 类型 | 取值 / 说明 |
|------|------|-------------|
| `RENDER_PACKS` | `RuntimePackName[]` | `['ffmpeg', 'hyperframes']`——渲染要哪几包：HyperFrames CLI 与浏览器壳在 `hyperframes` 包，编码与素材探测在 `ffmpeg` 包；分包后两者都在安装包之外，**缺哪个就提示下载哪个** |

> 画布相关常量不在这里自己声明：`RENDER_CANVASES` / `CANVAS_SIZES` / `DEFAULT_CANVAS` 一律从 `../shared/constants` 取（三端同源），本文件只用它们做白名单校验、写舞台宽高（`applyCanvasSize`）与日志留痕。

### 2.4 内部函数一览

| 名称 | 签名要点 | 说明 |
|------|----------|------|
| `runCapture(cmd, args, cwd, env, timeoutMs)` | `Promise<string>` | 带超时的子进程抓输出：成功返回 stdout+stderr 合并文本，超时 / 启动失败 / 异常一律返回 `''` |
| `declaredDuration(html)` | `number` | 读 `<html … data-composition-duration="45">`，没有或非法（非有限数、<= 0）返回 `0` |
| `applyCanvasSize(html, canvas)` | `string \| null` | **把项目选定的画布写成入口舞台的 `data-width` / `data-height`（成片宽高的真正来源）**：找舞台与改写开标签**全部交给 `rewriteStageTag()`**，自己只提供 `rewrite`（先 `stripAttrs(attrs, ['data-width', 'data-height'])` 再写 `CANVAS_SIZES[canvas]` 的宽高）。**页面里找不到舞台返回 `null`**（HTML 原样不动，见 §1.2） |
| `applyStageDuration(html, seconds)` | `string \| null` | 把裁定出的成片时长写成舞台元素的 `data-duration`（**CLI 编译阶段唯一读的地方**，`staticDuration`，cli.js 126320）。同样走 `rewriteStageTag()`，`rewrite` 先 `stripAttrs(attrs, ['data-duration', 'data-composition-duration'])` 再写 `data-duration="<seconds>"`（先剥掉同名属性、避免同一个标签上两个）；**找不到舞台返回 `null`**（见 §1.1 / §4） |
| `rewriteStageTag(html, rewrite)` | `string \| null` | 共用助手：找到文档里第一个带 `data-composition-id` 的元素（与 CLI 的 `querySelector("[data-composition-id]")` 同口径），把它开标签的属性串交给 `rewrite(attrs)` 决定写什么；找不到返回 `null`。**`applyCanvasSize()` 与 `applyStageDuration()` 都走它**，两条已知限制（不进入 `<template>`、不产出 `data-composition-src` 子 composition）也搬到它的注释上（见 §1.2） |
| `applyCanvasDeclaration(html, canvas)` | `string` | **把项目选定的画布写成入口的 `<html data-resolution="…">`**（页面自描述，CLI 的渲染链路不读它）：先调 `stripAttrs(attrs, ['data-resolution'])` 剥掉页面里已有的同名属性再写；整篇连 `<html>` 标签都没有时前置一个带声明的 `<html>`。行为与上一版一致（见 §1.2） |
| `stripAttrs(attrs, names)` | `string` | **逐属性扫描，摘掉 `names` 里列出的属性（忽略大小写、含无值写法）**，其余属性原样保留、开头空白收成一个空格。`<html>` 与舞台两处共用（取代原来的 `stripDataResolution(attrs)`）。正则原文：`/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"\|'[^']*'\|[^\s"'>]+))?/g`（定义在 `applyCanvasDeclaration()` 之后，见 §1.2） |
| `measureTimelineDuration(html, probeDir, …)` | `Promise<number>` | 无头 Chromium 加载「量测副本 + 量测脚本」，用 `--dump-dom` 读回 GSAP 时间轴长度；拿不到返回 `0`。**副本落在项目根**（`probeDir`），内容用**未抬级原文**——章节脚本按 `./pages/cNN.js` 写，副本在 `.render-tmp/` 下会 404、时间轴量回 0，成片时长就静默退回按最长媒体裁定 |
| `probeDuration(file, ffprobe, cwd, env)` | `Promise<number>` | `ffprobe -show_entries format=duration` 量媒体时长（秒）；失败返回 `0` |
| `writeTrimLog(projDir, line)` | `void` | 追加一行到 `userData/video-duration.log`（带 ISO 时间与项目目录名）；日志失败不影响渲染 |
| `prepareEntry(opts)` | `Promise<string>` | **画布两处注入 + 时长裁定 + 裁超长媒体副本 + 写入口**：返回最终要渲染的入口 HTML 文本（见 §4） |
| `register(ctx?)` | `void` | 注册全部 handler（§3）；无限循环守卫是 `video:render` handler 内的一段内联判断，**不是独立函数** |

## 3. 关键流程

### 3.1 `dialog:open-html`

1. `getWindow()` 取窗口，为空则返回 `null`。
2. `dialog.showOpenDialog`，`title: '选择要预览的 HTML 文件'`，`filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }]`，`properties: ['openFile']`。
3. 取消或无选中文件返回 `null`，否则返回 `r.filePaths[0]`。

### 3.2 `video:show-in-folder`

`filePath` 是字符串且 `fs.existsSync(filePath)` 时调 `shell.showItemInFolder(filePath)`；否则什么都不做。

### 3.3 `video:render` —— 两段式结构（准备阶段 + 渲染阶段）

**整体分成两段，中间的分界线是那个 `new Promise`**：准备阶段是普通 `await` 代码，渲染阶段包在 `return new Promise<VideoRenderResult>((resolve) => { … })` 里。这样切分的**唯一原因**是 Promise 的执行器是同步函数、里面不能出现 `await`（源码注释写明），而准备阶段必须 `await` 子进程（量时间轴、ffprobe、ffmpeg 裁剪）。准备阶段失败一律直接返回错误对象、不进渲染。

#### 准备阶段（`await` 代码）

1. **缺包校验（最先做）**：`const lack = runtime.missingPacks(RENDER_PACKS)`——非空立刻返回 `{ ok: false, needPacks: lack, message: '转视频需要先下载运行环境（' + runtime.packSizeText(lack) + '）' }`：**不下载、不阻塞**，渲染层据此弹「下载运行环境」确认框（`useEnvGate`），用户点「继续」才用原参数重发本操作（见 `docs/runtime-pack-split.md`）。
2. **入口校验**：`payload.htmlPath` 缺失或文件不存在 → `{ ok: false, message: 'HTML 文件不存在' }`；读取原文。
3. **合规校验**：`hfEnv.isHyperframesComposition(raw)`（要求同时含 `data-composition-id`、`__timelines`、`gsap`）；不合规则返回 `{ ok: false, compatible: false, message: … }`，提示先用 HyperFrames 引导生成合规模板。
4. **无限循环静态守卫**（本轮新增，§1.3）：`if (/repeat\s*:\s*(?:-1|Infinity)\b/i.test(raw))` 命中就返回 `{ ok: false, message: '页面里有无限循环动画（GSAP 的 repeat: -1）…' }`——**此时还没建 `.render-tmp`、没定位 CLI / Node、也没写 `video-duration.log`**。章节模式下同一正则连 `pages/cNN.js` 一起扫（章节模式没有新增频道，守卫仍在这一个 handler 里）。
5. **定位 CLI**：`hfEnv.findHyperframesCli()`（内置 `hyperframes.mjs` 优先，回退环境变量 `HYPERFRAMES_CLI`）；找不到返回「未找到 hyperframes CLI（hyperframes.mjs）。可设置环境变量 HYPERFRAMES_CLI 指向其路径。」
6. **定位 Node**：`hfEnv.findNode()` —— 返回 `{ cmd, env }`（**两级优先**：① Electron 内嵌 Node，即 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`；② 系统 Node，要求主版本 >= 22）；`null` 时给出「未找到可用的 Node.js（HyperFrames 要求 >= 22；Electron 内嵌 / 系统两种途径均不可用）」。`env` **必须**合进下面 `spawn` 的环境，否则 `electron.exe` 会把自己当应用来启动。
7. **就地确定渲染根与路径**（取代「建临时工作目录 + 复制素材」）：

   | 变量 | 取值 |
   |---|---|
   | `projDir` | `path.dirname(htmlPath)` —— **HTML 所在的项目目录就是渲染根** |
   | `tmpDir` | `path.join(projDir, '.render-tmp')` —— 项目内的临时子目录 |
   | `entryHtml` | `path.join(tmpDir, 'entry.html')` —— 渲染入口（相对项目根即 `.render-tmp/entry.html`） |
   | `outMp4` | `path.join(projDir, 'video', 'output.mp4')` —— 成品路径 |

   `try` 里先 `rmSync(tmpDir, { recursive: true, force: true })`（清掉上次残留）→ `mkdirSync(tmpDir)` → `mkdirSync(path.dirname(outMp4))`；异常返回「准备渲染目录失败：…」。

7.5 **渲染前同步共享绘制助手 `./core.js`（本轮新增，`projDir` 定完、`tmpDir` 之前）**：

   ```ts
   try {
     const coreSrc = hfEnv.coreSource()
     if (coreSrc && /src=["'](?:\.\/)?core\.js["']/i.test(raw)) {
       const r = coreLib.syncCoreTo(projDir, coreSrc)
       if (r.copied) writeTrimLog(projDir, 'core.js 版本 ' + (r.from || '无') + ' → ' + r.to + '（渲染前按版本同步）')
       else if (r.error) writeTrimLog(projDir, 'core.js 同步失败：' + r.error)
     }
   } catch (e) { /* 同步失败不拦渲染：项目里那份旧版仍能用 */ }
   ```

   - **只当页面确实引了 `./core.js` 才同步**（正则同 `projects.ts` 的 `PreviewHtml`）：单文件模式的页面没有这个引用，不该因此多写一份文件、多刷一行日志。
   - **与 `projects.ts` 的 `syncCoreLib()` 同一份逻辑**（`coreLib.syncCoreTo`，按 `CORE_VERSION` 覆盖、版本一致 + 文件在就什么都不做）：区别只在这里**不写 `userData/core-lib.log`**，而是把 `core.js 版本 a → b（渲染前按版本同步）` 写进 `video-duration.log`——渲染侧的留痕跟「这次成片」放在一起。
   - **为什么渲染前还要同步一次**：`projects.ts` 的同步发生在写骨架 / 预览 / 导出，而项目可能很久没重新生成就被人直接转视频；这一处保证「应用升级后，第二次渲染就吃到新版助手」，不会出现「预览是新助手、成片是老助手」。
   - **同步失败不拦渲染**：整个块包在 `try/catch` 里（`syncCoreTo` 自己也只回 `error` 不抛），项目里那份旧版仍能用——把片子渲出来比「助手版本对不对」重要。

8. **随包前端库本地化（幂等）**：`const localized = hfEnv.localizeVendorHtml(raw)` + `hfEnv.ensureVendorFiles(projDir, localized)`——把 CDN / `node_modules` 引用改写为 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`，并把页面引用到的随包文件复制进**项目目录**（入口在子目录里，所以下面 `prepareEntry()` 用 `hfEnv.hoistVendorRefs(localized, '../')` 把它们抬一级）。本文件**没有** `try/catch` 包裹、也**不判断** `ensureVendorFiles` 的返回值（在线时仍可由 CDN 加载；与 `projects.ts` 作者态三处的兜底策略不同）。
9. **构造环境变量**：
   - `env = { ...process.env, ...nodeRt.env }` —— 把 `findNode()` 给的附加环境合并进来；
   - `hfEnv.findFfmpegBin()` 命中时把该 bin 目录前置到 `env.PATH`（`ffBin + path.delimiter + env.PATH`）；
   - `hfEnv.BUILTIN_RESOURCES.ffmpeg` 存在 → `env.HYPERFRAMES_FFMPEG_PATH`；
   - `hfEnv.BUILTIN_RESOURCES.ffprobe` 存在 → `env.HYPERFRAMES_FFPROBE_PATH`；
   - `hfEnv.BUILTIN_RESOURCES.chromeShell` 存在 → `env.PRODUCER_HEADLESS_SHELL_PATH`（避免渲染时去 `.cache` 重新下载 Chrome；**量时间轴那一步也用它**——`prepareEntry()` 的 `chrome` 参数就是 `env.PRODUCER_HEADLESS_SHELL_PATH || ''`，即渲染与量测共用同一份 chrome-headless-shell 解析结果）。
10. **定画布 + 时长裁定 + 裁媒体 + 写入口**（与源码逐行一致）：
    - **先定画布**：`const wanted = payload && payload.canvas`，`const canvas: RenderCanvas = wanted && RENDER_CANVASES.indexOf(wanted) >= 0 ? wanted : DEFAULT_CANVAS`——白名单校验，非法 / 缺省一律落 `DEFAULT_CANVAS`（源码注释强调**绝不能「不传」**：不传就写不出舞台的 `data-width` / `data-height`，CLI 兜底 1080×1920、成片变竖屏，见 §1.2 与 `applyCanvasSize`）。

    ```ts
    let entry = ''
    try {
      entry = await prepareEntry({
        localized,
        entryHtml,
        tmpDir,
        projDir,
        env,
        chrome: env.PRODUCER_HEADLESS_SHELL_PATH || '',
        canvas
      })
      fs.writeFileSync(entryHtml, entry, 'utf8')
    } catch (e) {
      return { ok: false, message: '准备渲染入口失败：' + ((e as Error).message || String(e)) } as VideoRenderResult;
    }
    ```

#### 渲染阶段（`new Promise` 执行器内，同步代码）

1. **拼参数**：`const renderArgs = [hfCli, 'render', '-c', '.render-tmp/entry.html', '-o', outMp4]`——`-c` 用**相对项目根的路径**（CLI 硬要求入口落在项目根之内）。再 `const renderOpts = pickRenderOverride(payload)`；`renderOpts.quality` 为真时 `renderArgs.push('--quality', renderOpts.quality)`，`renderOpts.fps` 为真时 `renderArgs.push('--fps', String(renderOpts.fps))`（缺省 / 非法一律不传，交给 CLI 自己的默认 `standard` / `30`）。
2. **启动子进程**：`spawn(nodeRt.cmd, renderArgs, { cwd: projDir, env })`——**`cwd` 就是项目目录**，CLI 的素材解析据此把 `video/x.mp4` 这类相对引用还原成项目内的真实文件。
3. **日志回推**：`child.stdout` 与 `child.stderr` 的 `data` 事件都 `event.sender.send(IPC.Video.Progress, { text })`，渲染进度由渲染层自行解析（`[Render:trace]` 等）。
4. **失败与完成**：
   - `child.on('error')` → 「启动渲染失败：…（node: `<nodeRt.cmd>`）」；
   - `child.on('close', code)` → 先 `try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 被占用则留着，下次渲染前会先删 */ }`（**渲染入口是临时物，无论成败都清掉**；成品不需要「搬回来」，所以没有额外清理步骤）→ `code === 0 && fs.existsSync(outMp4)` 时返回 `{ ok: true, outputVideo: outMp4, projectDir: projDir }`，否则返回「渲染失败（exit=…）」；
   - 闭包 `done(res)` 用 `finished` 标志位保证 Promise 只 settle 一次。

## 4. `prepareEntry()` —— 画布两处注入、时长裁定（并写两处）与裁媒体

`prepareEntry(opts: { localized, entryHtml, tmpDir, projDir, env, chrome, canvas }): Promise<string>` 的返回值就是最终写盘、并交给 CLI 的入口 HTML 文本。**`canvas` 是画布入参**（`RenderCanvas`）：它决定成片画布，由调用方白名单校验后传入。

下面编号从随包前端库的引用改写开始；**在库引用改写之后、时长裁定之前，是画布的两步注入**（源码注释：画布写两处、放在最前，后面量时间轴时写盘的副本、最终留给 CLI 的入口都带上它们）：

```ts
entry = applyCanvasDeclaration(entry, canvas)   // ② <html data-resolution>（页面自描述）
const sized = applyCanvasSize(entry, canvas)    // ① 舞台 data-width/data-height（成片宽高的真正来源）
if (sized) entry = sized
```

紧跟着往 `video-duration.log` 追加一行留痕：

```ts
const size = CANVAS_SIZES[canvas]
writeTrimLog(projDir, '成片画布 = ' + canvas + '（' + size.width + 'x' + size.height + '）：' +
  (sized
    ? '已写入舞台 data-width/data-height 与 <html data-resolution>'
    : '页面里找不到带 data-composition-id 的舞台，只写了 <html data-resolution>（CLI 将兜底 1080x1920 竖屏）'))
```

`sized === null`（页面里没有带 `data-composition-id` 的舞台）时只写了 `<html data-resolution>`，成片会退回 CLI 自己的兜底 1080×1920。步骤：

1. **随包库引用抬级**：`let entry = hfEnv.hoistVendorRefs(localized, '../')`——入口在 `.render-tmp/` 下，库文件（`gsap.min.js` / `p5.min.js` / `p5.brush.js`）在项目根，故统一回退一层；已是 `../` 的引用不会被再次加前缀（重复调用安全）。
2. **① 模型声明**：`let target = declaredDuration(localized)`，`let source = '声明'`。
3. **② 没声明就现场量一次**（量测脚本要读页面文件，所以先把量测副本落盘）：
   - `chrome` 非空时把**未抬级原文**（`localized`，即抬级前的 `entry`）写成**项目根**下的量测副本（写失败只影响量测，`catch` 里忽略）→ `await measureTimelineDuration(localized, projDir, …)`（`probeDir` = 项目根），`source = '实测时间轴'`；
   - **副本不能放 `.render-tmp/`**：章节脚本是按 `./pages/cNN.js` 写的，副本在 `.render-tmp/` 下会 404 ⇒ 时间轴量回 0 ⇒ 成片时长静默退回「按最长媒体裁定」；
   - `chrome` 为空时 `source = ''`（不去量）。
4. **③ 都拿不到**：`target <= 0` 时写一条日志（`'成片时长：模型未声明且时间轴量不到（chrome=有/无）→ 交给 CLI 按最长媒体裁定'`）并**原样返回** `entry`——保持旧行为。
5. **裁超长媒体**：用 `/(<(?:video|audio)\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi` 扫入口 HTML 里的 `<video>` / `<audio>` 的 `src`：
   - 跳过 `http:` / `https:` / `data:` / `blob:` / `file:` 开头的、以及含 `..` 的（已指到项目外的，本应用不会生成）；
   - **路径解析必须 `path.resolve(projDir, src)`，不能 `resolve(tmpDir, src)`**——HTML 里的 `video/x.mp4` 是相对**项目根**写的（CLI 也按项目根解析），按 `tmpDir` 解析会指向不存在的 `.render-tmp\video\…`，一句「找不到就跳过」就把裁剪全跳过了（源码注释记录了这个 2026-10 实测踩到的坑）；
   - 文件不存在 → 写日志「媒体文件不存在，跳过裁剪：<src>」并跳过；
   - `probeDuration()` 量时长，`dur <= target + 0.25` 视为不用裁；
   - 需要裁时：输出到 `path.join(tmpDir, 'media', path.basename(abs))`（`mkdirSync` 建目录），用 `ffmpeg -hide_banner -loglevel error -y -i <原文件> -t <target> -c copy <副本>`——**从头裁到目标时长、`-c copy` 不重压（秒级完成）**；**只裁副本、原件不动**；
   - 副本存在且非空才算成功：把该 `src` 记进 `jobs`，入口里改写成 `'./media/' + path.basename(abs)`（入口自身就在 `.render-tmp/` 里，相对它写 `./media/xxx` 最稳妥），并写日志「裁剪 <文件>：<原时长>s → <目标>s」；失败写日志「裁剪失败（…）」并把 ffmpeg 输出的最后 160 字符附上；
   - 循环结束后统一 `entry = entry.split('"' + j.from + '"').join('"' + j.to + '"')`（按完整带引号的 src 做字面替换），有裁剪时再写一条汇总日志。
6. **成片时长写两处：① `<html>` 自描述、② 舞台 `data-duration`（生效的那处）**：
   - **① 页面自描述**：`target > 0 && !declaredDuration(entry)` 时，用 `entry.replace(/<html\b([^>]*)>/i, '<html$1 data-composition-duration="' + target + '">')` 注入；**没有 `<html …>` 标签时**直接把 `'<html data-composition-duration="' + target + '">'` 拼在文档最前。源码注释写明它**只为页面自描述**（预览、`info`、下次生成读它），**CLI 渲染不读**——旧文档以为 CLI 会在编译阶段直接读 `<html>` 上这个属性，**那是错的**（按 cli.js 126320 更正）。画布的 `<html data-resolution>` 已在第一步写过，所以这一段既有的正则**一定能命中**根节点（原页面没有 `<html>` 时命中的就是被前置的那个根节点；舞台恰是 `<html>` 时三者都在同一个标签上）。
   - **② 真正生效**：`const durated = applyStageDuration(entry, target)`，非 `null` 就替换 `entry`。它走共用助手 `rewriteStageTag()`：找到第一个带 `data-composition-id` 的元素，**先剥掉该元素上已有的 `data-duration` 与 `data-composition-duration`**（避免同名两个），再写入 `data-duration="<target>"`。这是 CLI 编译阶段唯一读的地方（`rootEl.getAttribute("data-duration")`，cli.js 126320）。
   - 上一步写完后往 `userData/video-duration.log` 追加一条**新日志**（源码两条文案逐字）：
     - 找到了舞台：`成片时长声明已写到舞台 data-duration = 120.00s（CLI 编译阶段只读这一处）`
     - 找不到舞台：`成片时长：页面里找不到带 data-composition-id 的舞台，只写了 <html data-composition-duration>（CLI 渲染不读它）`
7. **留痕**：最后写一条「成片时长 = <target.toFixed(2)>s（来源：<source>）」（这条是原有的，仍在最后），返回 `entry`。

`measureTimelineDuration()` 的量测口径（与预览脚本 `clock()` 一致）：

1. 读**未抬级原文**，追加一段量测脚本后写成**项目根**下的量测副本（**为什么要复制一份：用 iframe 套一层就取不到内层 GSAP**）。**副本落在项目根、且用未抬级原文**：章节脚本按 `./pages/cNN.js` 写，副本若放进 `.render-tmp/` 会 404，时间轴量回 0、成片时长就静默退回按最长媒体裁定。
2. 脚本在 `setTimeout(…, 1500)` 之后：先收 `window.__timelines` 里的所有时间轴；为空时退而遍历 `window.gsap`，收 `typeof v.duration === "function"` 的对象；对每条取 `duration()`，**取最大值**；把结果写进一个 `<pre id="hf-dur-out">`，文本形如 `<marker><d>_END`。
3. `runCapture(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--virtual-time-budget=5000', '--dump-dom', url], cwd, env, 30000)` 把 DOM dump 回来，用 `<marker>([\d.]+)_END` 正则取出数值；量到 0 / 解析失败 / 异常都返回 `0`（调用方据此退回媒体时长）。
4. `url` 由绝对路径手工拼成 `file:///` 形式（`\\` → `/`、空格 → `%20`）——本文件**不 import `node:url`**。
5. 量测副本在 `finally` 里 `fs.rmSync(…, { force: true })` 删除（落在项目根、用完即删）；`entry.html` 本身（渲染入口）则由渲染阶段收尾时连同整个 `.render-tmp/` 一起删除。

## 5. 渲染产物路径的语义变化（`project:save-video` 的配合）

- **本模块只产出并返回成品绝对路径**：`{ ok: true, outputVideo: outMp4 (= <项目目录>\video\output.mp4), projectDir: projDir }`。**不写 `project.json`**。
- 回写由渲染层「HTML生成」页负责：`res.ok` 后调 `window.projectTools.saveVideo(appState.currentName, res.outputVideo)`（`project:save-video`）→ 主进程把**项目目录内的绝对路径换算成项目内相对路径** `video/output.mp4` 存进 `project.json`（见 [projects.md](./projects.md) 的 `resolveVideoAbs()` 与 `project:save-video`）。
- 「视频预览」页取路径时拿到的又是绝对路径（`project:load` 返回前用 `resolveVideoAbs()` 还原），再经 `hgpreview://` 协议播放（见 [VideoPreviewPage.md](../renderer/src/pages/VideoPreviewPage.md)）。
- 旧记录里指向 `hf-projects\…` 的绝对路径仍能被 `resolveVideoAbs()` 兼容读出（文件存在就用），但**新的渲染不会再产生那种目录**（磁盘上残留的 244 MB 旧目录已删）。

## 6. 依赖与协作

### 6.1 导入

| 来源 | 导入项 | 用途 |
|------|--------|------|
| `electron` | `app`、`ipcMain`、`dialog`、`shell` | `app.getPath('userData')`（仅作 `video-duration.log` 的落点）、IPC 注册、文件选择框、资源管理器定位 |
| `node:path` | `path`（默认导入） | 路径拼接、`path.dirname` / `path.resolve` / `path.basename` / `path.delimiter` |
| `node:fs` | `fs`（默认导入） | 存在性判断、目录创建与删除、读写入口 HTML、裁剪产物大小校验 |
| `node:child_process` | `spawn` | 启动 hyperframes CLI 渲染子进程；也被 `runCapture()` 用于量时间轴 / ffprobe / ffmpeg |
| `./hfEnv` | `* as hfEnv` | `BUILTIN_RESOURCES`（`ffmpeg` / `ffprobe` / `chromeShell`）、`findHyperframesCli`、`findNode`（返回 `{ cmd, env }`）、`findFfmpegBin`、`isHyperframesComposition`、**`coreSource`（本轮新增：`./core.js` 的真源路径）**，以及随包前端库本地化的 `localizeVendorHtml` / `ensureVendorFiles` / `hoistVendorRefs` |
| `./coreLib` | `* as coreLib` | **本轮新增**：`syncCoreTo(projDir, coreSrc)` —— 渲染前把共享绘制助手按 `CORE_VERSION` 同步进项目（只同步、不写 `core-lib.log`） |
| `./runtime` | `* as runtime` | `missingPacks(RENDER_PACKS)` / `packSizeText(lack)` 做缺包纯校验 |
| `./settings` | `pickRenderOverride` | 渲染档位（质量 / 帧率）白名单校验，与 `projects.ts` 复用同一实现 |
| `../shared/constants` | `CANVAS_SIZES`、`DEFAULT_CANVAS`、`RENDER_CANVASES` | 成片画布：`RENDER_CANVASES` 做白名单校验、`DEFAULT_CANVAS` 做缺省、`CANVAS_SIZES` 里的宽高写进舞台 `data-width` / `data-height` 并进日志留痕 |
| `../shared/ipc` | `IPC` | 频道常量 |
| `../shared/types` | `type RegisterCtx`、**`type RenderCanvas`**、`type RuntimePackName`、`type VideoRenderPayload`、`type VideoRenderResult` | `register` 的上下文类型、**画布入参 / 局部变量的类型**、`RENDER_PACKS` 的元素类型、渲染 handler 的载荷/结果类型 |

> 本文件**不 import `node:url`**（量时间轴的 `file:///` URL 是手工拼的）；`app` 的使用点只剩 `writeTrimLog()` 里的 `app.getPath('userData')`。

### 6.2 被谁使用

| 使用方 | 用法 |
|--------|------|
| `src/main/index.ts` | `video.register(ctx)` 完成注册（依赖图注释：`hfEnv ← projects, voice, whisper, video, runtime`） |
| `src/preload/index.ts` | 暴露 `openHtml` / `renderVideo` / `showInFolder` / `onProgress`，分别转发上述频道 |
| `src/renderer/src/pages/HtmlGenPage/index.vue` | **发起渲染**（「转视频」按钮，带质量 / 帧率档位）、成功后回写产物并刷新项目；被无限循环守卫拒绝时，就把返回的 `message` 直接写进「预览」卡的状态行（见 [HtmlGenPage.md](../renderer/src/pages/HtmlGenPage.md) §6.7） |
| `src/renderer/src/pages/VideoPreviewPage/index.vue` | **可选项目的**纯预览：下拉选择要看的项目（默认当前工作项目，只列 `hasVideo` 的项目）、展示 / 定位成品视频；**切换不改工作项目、也不发起渲染** |
| `src/renderer/src/composables/useRenderProgress.ts` | 通过 `window.hfTools.onProgress` 解析 `video:progress` 文本 |

## 7. 注意事项与实现要点

- **渲染根 = HTML 所在的项目目录**：`cwd = path.dirname(htmlPath)`。因此「HTML 必须放在项目目录里」从「约定」升级为「渲染能工作的前提」——`-c` 的入口必须落在项目根之内、媒体 `src` 也按项目根解析。传一个项目外的 HTML 路径进来，行为（尤其是媒体解析）不再有保证。
- **`.render-tmp/` 是项目内的临时目录**：渲染前先 `rmSync` 清残留、渲染入口写在 `<tmpDir>/entry.html`、裁剪产物写在 `<tmpDir>/media/`，渲染收尾（`close` 事件，无论成败）整体删除。若删除失败（文件被占用）会留着，下次渲染前会被先删掉。**量时间轴的探针副本不在它里面**——落在项目根、用完即删（章节脚本 `./pages/cNN.js` 只有在项目根下才解析得到）。**它不在 `index.ts` 迁移老数据的白名单 `OWN_DATA_ENTRIES` 里**（那是 Chromium profile 之外的业务条目清单，与旧 `hf-projects` 的处置相同）。
- **`hf-projects` 已下线**：`userData/hf-projects/` 这条渲染临时目录**不再产生**（磁盘上残留的 244 MB 旧目录已人工删除）；`index.ts` 的 `OWN_DATA_ENTRIES` 注释里也只把它当作历史遗留提及。
- **无限循环的判据只在入口拦、不改页面**：那道守卫是一组静态正则（`/repeat\s*:\s*(?:-1|Infinity)\b/i`，同一表达式扫 `index.html` 与章节脚本 `pages/cNN.js`），命中就返回一句话拒绝，**不修 HTML、不改项目文件、不写任何日志目录**；要真正修好只能让用户在「HTML生成」页把循环改成有限次数（或重新生成）。**不要**把它挪到 `prepareEntry()` 里或改成「自动把 `-1` 替换成某个次数」——次数该由内容与目标秒数决定，应用无从猜（提示词侧只负责让模型别写出这种循环）。
- **成片时长要「写对地方」才生效，规则仍是 `max(声明, 最长媒体)`**：CLI 的 `compileForRender` 只读**舞台元素的 `data-duration`**（读不到就向浏览器探时间轴，见 §1.1）——所以「把时长写进 `<html>`」等于没写，`prepareEntry()` 必须用 `applyStageDuration()` 写到**第一个带 `data-composition-id` 的元素**上才算真声明。生效后还有两条推论：① 声明（或实测值）比最长媒体长时，仍要**同时**把超长媒体裁到同长（声明 5 秒而素材 225 秒，成片仍是 225.4 秒——声明被最长媒体顶掉；声明 120 秒则精确渲成 120.000 秒，本项目实测）；② **声明比时间轴长会把片子拉长到声明值、比时间轴短会按时长截断**——这是上一轮的口径变化，用户能直接看到（以前没写到舞台时，成片长度其实由页面 GSAP 时间轴决定）。
- **裁剪是「只裁副本」**：`ffmpeg -c copy -t <target>` 写进 `.render-tmp/media/`，项目里的原始素材一动不动，入口 HTML 里把 `src` 改写成 `./media/<文件名>`。**`-c copy` 不会消除 CLI 的 sparse keyframes 警告**（关键帧间隔原样保留，本项目实测 8.3 秒）——要真正解决得重编码，本轮没做。
- **`0.25` 秒容差**：`dur <= target + 0.25` 就跳过裁剪（容器时长与关键帧对齐会有小误差，差这一点不值得重裁）。
- **裁媒体失败只降级、不阻断**：单条媒体失败写日志继续，整个 `prepareEntry()` 抛错才会让 `video:render` 直接返回「准备渲染入口失败：…」。
- **量时间轴依赖 chrome-headless-shell，且共用一个解析结果**：`chrome` 参数取 `env.PRODUCER_HEADLESS_SHELL_PATH`（来自 `hfEnv.BUILTIN_RESOURCES.chromeShell`）。拿不到（`null`）时装不出这个环境变量，`prepareEntry()` 就跳过 ②、直接走 ③，日志写「chrome=无」。**历史故障正是「`chromeShell` 被缓存的 `null` 永久钉住」**（见 [hfEnv.ts.md](./hfEnv.ts.md) 的 `findChromeShell()`），修正缓存语义后此处才能量到时间轴。**探针副本落在项目根、用未抬级原文**：章节脚本按 `./pages/cNN.js` 写，副本放进 `.render-tmp/` 会 404、时间轴量回 0。
- **量测入口的写法必须常量**：`measureTimelineDuration()` 把量测脚本拆成 `'…</scr' + 'ipt>'` 拼接，避免这段字符串里出现真正的 `</script>` 提前闭合外层脚本。
- **渲染前会按版本同步 `./core.js`（本轮新增）**：页面引了共享绘制助手时，`hfEnv.coreSource()` 取真源、`coreLib.syncCoreTo(projDir, src)` 按 `CORE_VERSION` 覆盖项目里那份，覆盖 / 失败都写进 `video-duration.log`（`core.js 版本 a → b（渲染前按版本同步）`）。**它不改入口 HTML、不参与本地化**：`./core.js` 的引用形态固定，页面直接用项目根那份，抬级只针对 `./gsap.min.js` 这类随包库。同步失败不拦渲染（旧版仍可用）。
- **`writeTrimLog()` 的落点是 `userData/video-duration.log`**（不是项目目录、也不是 `runtime.log`）：「片子为什么这么长」这类问题必须留痕可查——裁定结果、媒体裁剪、跳过原因、失败原文都往这里写；**写日志失败被静默忽略**，不影响渲染。**本轮起 `core.js` 的同步留痕也走这里**（它是「这次成片用了哪个版本的助手」的唯一记录；`projects.ts` 那边另有一份 `userData/core-lib.log`）。
- **渲染入口是临时物、成品不是**：`close` 里只清 `.render-tmp/`；成品 `video/output.mp4` 直接长在项目里，**不存在「从工作目录搬回来」这一步**（旧实现才有）。
- **画布与档位是两套东西、下发路径也不同**：`canvas`（`landscape` / `portrait` / `square`）是**项目属性**，决定 composition / 成片尺寸，由 `applyCanvasSize()` 写进舞台的 `data-width` / `data-height`（成片宽高的真正来源）、由 `applyCanvasDeclaration()` 写进入口的 `<html data-resolution>`（页面自描述，CLI 渲染链路不读）；`quality` / `fps` 是**渲染档位**，经 `pickRenderOverride()` 拼成 `--quality` / `--fps`。两者一起随载荷下发，但**画布绝不「缺省不传」**（缺省即落 `DEFAULT_CANVAS`；不传就写不出舞台宽高、CLI 兜底 1080×1920 竖屏），而档位缺省就是不传、交给 CLI 默认。**也不要改用 `--resolution` 去改画布**：它只做 DPR 上采样，要求宽高比与 composition 一致且缩放为整数倍。
- **档位只透传白名单值**：`pickRenderOverride(payload)` 过滤掉缺省与非法字段，两个参数都只在**显式给出**时才拼进 CLI 命令，因此「不传档位」与「传默认档位」在 CLI 侧等价（都走 `standard` / `30`）；白名单取值（`draft/standard/high`、`24/30`）与 `shared/types.ts` 的 `RenderQuality` / `RenderFps` 及渲染层 `utils/render.ts` 必须保持一致。
- **本文件不做随包库本地化的兜底判断、也不做 BGM 注入**：本地化那一步只改文本（`localizeVendorHtml`）、按需复制到项目目录（`ensureVendorFiles`），**不判断 `ensureVendorFiles()` 的返回值**（与 `projects.ts` 作者态三处「文件未就位即退回 CDN」不同）；`<audio id="myv-bgm">` 完全由 `projects.ts` 的 `applyBgmToHtml()` 在生成 / 修改 / 保存 / 设置音频时写进 `index.html`，渲染时随项目内的 HTML 一起被 CLI 读到，**音轨提取与混入 MP4 全部发生在 HyperFrames CLI 内部**（trace 阶段 `audio_process`）。因此「页面有音轨但成片没声音」应查注入标签是否存在，而不是查本模块。
- **`dialog:open-html` 是保留能力、当前无调用方**：`hfTools.openHtml()` 仍暴露在 preload 上，但渲染层已不再调用；不要据此以为存在「手动选 HTML 渲染」的界面入口。
- **合规校验是硬门槛**：`data-composition-id`、`__timelines`、`gsap` 三者缺一不可，失败时额外回传 `compatible: false` 供界面区分「环境错误」与「HTML 不合规」。**无限循环守卫排在它之后**（先把「不是 composition」这种更根本的问题报出去，再看循环写法）。
- **Node 的解析与「怎么跑」都交给 `hfEnv.findNode()`**：模块自身不拼 node 路径、不假定可执行文件叫什么名字。`cmd` 在复用 Electron 内嵌 Node 时就是 `process.execPath`（绝对路径，天然规避 nvm shim / WindowsApps alias 下 `spawn('node')` 的 ENOENT），`env` 里带 `ELECTRON_RUN_AS_NODE=1` 并**必须**用 `{ ...process.env, ...nodeRt.env }` 合并；系统 Node 途径 `env` 为空对象。`child.on('error')` 文案里也会带上 `nodeRt.cmd` 便于排查。
- **环境变量注入而非依赖系统 PATH**：`HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` / `PRODUCER_HEADLESS_SHELL_PATH` 均为显式注入，`HYPERFRAMES_CLI` 是 CLI 缺失时的可选回退。这些变量名与 `hfEnv.ts` 的读取逻辑一一对应。**量时间轴（ffprobe / ffmpeg / chrome）用的就是同一份 `env`**，所以缺包时整段准备阶段根本不会开始（第 1 步就回了 `needPacks`）。
- **`done` 幂等**：`finished` 标志位防止 `error` 与 `close` 双触发导致 Promise 重复 settle。
- **进度不解析、只透传**：主进程原样转发子进程 stdout/stderr 文本，`[Render:trace]` 一类的语义解析在渲染层完成。
- **不生成预览外壳**：模块只注册三个 handler 与一路推送，项目内只临时产出 `.render-tmp/**` 与成品 `video/output.mp4`，不写任何 HTML 外壳文件，也不生成 `index.preview.html`（那是 `projects.ts` 的 `project:preview-html`）。
- **本模块需要的两个包都不随安装包**：`ffmpeg`（解包 179.9 MB）与 `hyperframes`（解包 439.9 MB）各是一个 7z（**实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14），首次用到时下载并解到 `<userData>/runtime/<包名>/`（`src/main/runtime.ts`）。因此 `BUILTIN_RESOURCES.ffmpeg` / `ffprobe` / `chromeShell` 在这些包未就绪时分别是空串 / `null`，上面的环境变量注入会整段跳过；缺包时第 1 步就把 `needPacks` 交回界面，**不会**走到「CLI / Node 定位失败」那种报错。
- **实测数据（本项目的真实项目，2026-10）**：动画内容 36.65 秒结束、GSAP 时间轴 45 秒（被一条 45 秒的进度条动画撑长）、旁白 / 字幕到 60 秒、素材视频与 BGM 都是 225.4 秒。声明有效性对照：**无声明 → 成片 225.4 秒；声明 5 → 仍 225.4 秒（被最长媒体顶掉）；声明 120 → 精确 120.000 秒**。裁剪效果：213.5 MB 素材 → 44.6 MB / 45.1 秒，`-c copy` 约 0.1 秒完成。就地渲染验证：`◇ projects\任意文件女生\video\output.mp4 1.1 MB · 5.0s · rendered in 17.4s`（子目录入口 + `../` 素材引用 + 输出直写项目 + 无事务残渣）。**反面对照**：同一个项目的页面被写进 13 处 `repeat: -1` 后，预览总时长显示 `166666668:12`（= 1e10+92 秒按 `mm:ss` 口径格式化），转视频会永远渲不完——这就是 §1.3 那道守卫要拦的情形。
