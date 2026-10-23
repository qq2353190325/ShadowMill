# src/main/coreLib.ts

> 「共享绘制助手」`core.js` 的**版本同步**：应用里有一份真源（`vendor/shadowmill/core.js`），每个项目里有它的一份副本（项目根 `./core.js`），骨架按 `./core.js` 引入；本模块只做「读版本 / 比对 / 复制」，**不 import electron**

- **所在目录**：src/main/
- **类型**：纯逻辑 + 文件读写模块（**不调用模型、不注册 IPC、不 import `projects.ts` / 不 import `electron`**）
- **规模**：71 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：2 个常量（`CORE_FILE`、`CORE_VERSION_FILE`）+ 4 个函数（`parseCoreVersion` / `readProjectCoreVersion` / `syncCoreTo` / `readProjectCore`）

## 1. 作用与职责

章节模式下每个项目都有一份 `core.js`（页面里的全局对象是 **`MC`**）。它不是 npm 包、也不是 CDN 依赖，而是**影坊自己的绘制助手**：把「一个形状 = 一次 `MC.paint(点列, 选项)`」封起来，并提供几何点列、缓动与**确定性抖动**（替掉 `Math.random`，保证 `gsap` seek 到任意一帧都能重现）。真源随应用走（`vendor/shadowmill/core.js`，**270 行 / 13,366 字节，当前 `CORE_VERSION = '6'`**），项目里那份是副本。

**版本史（改这个文件就必须调大 `CORE_VERSION`）**：

- **v2** 新增 `MC.castLayer(stage, 宽, 高[, z])` / `MC.clearLayer(ctx[, w, h])`：前者建一张铺满舞台、透明、`pointer-events:none`、带 `data-cast-layer` 与上层 z-index 的 canvas（返回 `{ canvas, ctx }`），后者只做 `clearRect`——它们服务的正是「角色画在自己那张透明画布上」这条分层约定。
- **v3** 把 `MC.paint` 的水彩分支改成实例模式：不再调全局 `push()/pop()`，而是从 `opts.p` 或 `window.__p5Active` 取 p5 实例（章节模式下 p5 没有全局函数）。
- **v4** 改用 `window.brush` **对外唯一存在**的 `brush.instance(p)` 显式激活实例——`window.brush` **没有** `activateInstance` / `deactivateInstance`（那两个名字在内部 runtime adapter 上，直接调会报 `is not a function`）；`paint()` 画之前先 `brush.instance(P)`，这样「在 `p.draw()` 之外调用」也能落到本实例上。
- **v5** 让描边笔型名先过 `brushName()` 白名单：p5.brush 2.2.3 只有 **11 种笔型**（pen / rotring / 2B / HB / 2H / cpencil / pastel / crayon / charcoal / spray / marker），而 `ink` 在本文件里是**墨线颜色**（`o.ink`）、不是笔型名；写成笔型会报 `Brush "ink" not found`，导致**每个带描边的形状都少画描边**（水彩探针里就是 12 次 `[Browser:PAGEERROR] Brush "ink" not found`）。现在 `paint()` 的描边那一笔是 `brush.set(brushName(o.br), …)`、`inkLine()` 固定 `brush.set('pen', …)`，传错的名字一律退回 `pen`；`paint` 的 opts 注释也新增了 `br`（描边用的笔型，默认 `pen`，**不是颜色**）。
- **v6** 新增**水彩参数预设**：`var PRESETS = { wash, soak, grain, light, inked }` 5 组（每组就是 `washOp` / `fillOp` / `bleed` / `tex` / `ink` / `sw` / `br` 里的几个键），配 `has(o, k)` 与 `withPreset(o)`——`paint(pts, o)` 开头 `if (o.preset) o = withPreset(o)`，把预设**垫在下面**、**opts 里显式写的键优先（含显式 `ink: null`)**；opts 注释新增 `preset` 一行。为什么要预设：「像不像水彩」全在 `bleed` / `tex` / `fillOp` 这几个数上、差一点就退化成平涂，让每个角色 / 每章自己拧会出现好几种质感。**`window.MC` 的导出键没有变化**——`PRESETS` / `withPreset` / `has` / `BRUSHES` / `brushName` 都留在闭包里，没有挂到 `MC` 上。

- **`MC.paint` 的用法（v6 起）**：`MC.paint(pts, { preset: 'soak', wash: '#8EC3E6', fill: '#D97757' })`。**水彩质感一律用 `preset`，别自己拧 `bleed` / `tex`**；**质感来自 `fill`**（`bleed` / `tex` 只作用于填色那层，只给 `wash` 就是一片平的水彩底色）；`soak` 渗色最重、会把颜料糊出形状外，要干净轮廓的角色 / 物体用 `grain` 或 `wash`。
- **为什么项目里必须有一份物理副本**（而不是让页面直接引用全局路径）：预览走 `hgpreview://` 自定义协议，只放行「项目目录内」（见 `main/index.ts` 的 `resolveHgPreviewPath`）；渲染走 HyperFrames CLI 的静态服务器，root 只有「编译产物目录 + 项目目录」两级。项目外的路径在这两条链路上都读不到，所以只能在用到之前把文件复制进项目。
- **同步策略是「按版本号覆盖」**：`core.js` 里写着 `var CORE_VERSION = '6'`（v1 → v2 加了 `castLayer` / `clearLayer`，v2 → v3 把水彩分支改成 p5 实例模式，v3 → v4 改用 `brush.instance(p)` 激活实例，v4 → v5 换成 11 种笔型白名单，v5 → v6 加水彩参数预设），项目里记一份 `.core-version`；只有两者不一致（或文件丢了）才覆盖，并把 `from → to` 记进 `<userData>/core-lib.log`。好处是应用升级后所有项目在下一次生成 / 预览 / 导出 / 渲染时自动吃到新助手，而日志里能查「这条片子用的是哪个版本」。
- **幂等**：版本一致 + 文件在 ⇒ 什么都不做（`copied: false`）。因此预览、渲染这类高频路径可以每次都调。
- **本文件刻意不 import electron**（保持可离线测试）：真源路径由调用方给（`hfEnv.coreSource()`），本模块只做「读版本 / 比对 / 复制」。

模块本身是**纯逻辑 + 文件读写**：不 import `projects.ts`（避免循环依赖）、不注册 IPC、不认识项目名。与 [castLibrary.ts](./castLibrary.ts.md) 同一套写法：目录一律作参数传入。

## 2. 导出与关键实现

| 名称 | 签名 | 说明 |
| --- | --- | --- |
| `CORE_FILE` | `const string` | `'core.js'`——项目内的文件名，骨架里的引用就是 `./core.js` |
| `CORE_VERSION_FILE` | `const string` | `'.core-version'`——项目内记录的版本文件名（隐藏文件，避免与用户自己的文件混淆） |
| `parseCoreVersion(code)` | `(code: string) => string` | 从源码里读 `CORE_VERSION`（正则 `CORE_VERSION\s*=\s*['"]([0-9A-Za-z._-]+)['"]`）；**读不到返回 `''`**，调用方据此跳过同步、不乱覆盖 |
| `readProjectCoreVersion(dir)` | `(dir: string) => string` | 读项目里 `.core-version` 的内容（`trim`）；文件不存在 / 读失败 / 抛错 ⇒ `''` |
| `syncCoreTo(dir, srcPath)` | `(dir: string, srcPath: string) => { copied: boolean; from: string; to: string; error?: string }` | 把真源同步进项目目录（核心函数，见 2.1） |
| `readProjectCore(dir)` | `(dir: string) => string` | 读项目里那份 `core.js` 的**源码文本**（导出单文件时内联用）；文件不存在 / 读失败 ⇒ `''` |

### 2.1 `syncCoreTo()` 的判定顺序（每一支都有明确理由）

1. `from = readProjectCoreVersion(dir)`（项目里记录的版本，没有就是 `''`）。
2. `srcPath` 为空 / 文件不存在 ⇒ `{ copied: false, from, to: from, error: '内置 core.js 不存在：<路径>' }`。**不抛错**：调用方（`projects.ts` 的 `syncCoreLib`）拿到 error 只写日志，不拦下生成。
3. 读真源失败 ⇒ `{ copied: false, from, to: from, error: '读内置 core.js 失败：…' }`。
4. `to = parseCoreVersion(code)`；为 `''` ⇒ `{ copied: false, from, to: from, error: '内置 core.js 里没有 CORE_VERSION' }`。**没有版本号就不覆盖**——否则每次调用都会重写一遍，日志也会刷。
5. `from === to` **且** `fs.existsSync(path.join(dir, CORE_FILE))` ⇒ `{ copied: false, from, to }`。这就是幂等分支：版本一致 + 文件在，什么都不做。
6. 否则 `mkdirSync(dir, { recursive: true })` → 写 `core.js`（真源全文）→ 写 `.core-version`（`to` + 换行）→ `{ copied: true, from, to }`。
7. 写盘抛错 ⇒ `{ copied: false, from, to, error: '写项目 core.js 失败：…' }`。

> 注意第 5 步的**两个条件都要求**：版本号一致但文件被用户删了，也会重新复制一次（`from === to` 但 `existsSync` 为假）。

### 2.2 项目里落的两个文件

| 文件 | 谁写 | 谁读 | 作用 |
| --- | --- | --- | --- |
| `core.js` | `syncCoreTo()` 覆盖写 | 页面（`<script src="./core.js">`）、`readProjectCore()`（导出内联） | 页面里可用的 `MC` 对象 |
| `.core-version` | `syncCoreTo()` 覆盖写 | `readProjectCoreVersion()` | 「这份副本是哪个版本」，下一次同步的唯一判据 |

## 3. 关键流程 / 算法

### 3.1 同步时机（五处调用，全在 `projects.ts` / `video.ts`，本模块不认识它们）

| 时机 | 调用点 | 为什么在这里 |
| --- | --- | --- |
| **写骨架时** | `projects.ts` 的 `writeChapterSkeleton()`（`fs.mkdirSync(dir)` 之后、`chapters.buildSkeleton()` 之前） | 生成 / 改稿 / 导入角色都会走到这里；骨架里的 `<script src="./core.js">` 必须指向一个真实存在的文件 |
| **单文件注入前** | `projects.ts` 的 `applyCastToHtml()`：勾了角色（要往 `index.html` 里塞 `./core.js`）才同步 | 没勾角色的单文件页面根本不注入 `core.js`，不必多写一份文件 |
| **预览前** | `projects.ts` 的 `PreviewHtml`：`if (/src=["'](?:\.\/)?core\.js["']/i.test(html)) syncCoreLib(dir)` | 只当页面确实引了 `./core.js` 才同步；否则「旧项目预览仍是老助手、渲染却是新助手」，两边画面不一致 |
| **导出前** | `projects.ts` 的 `DownloadHtml`（两种形态都先 `syncCoreLib(dir)`，再用 `readProjectCore(dir)` 内联） | 保证导出物里嵌的是最新版本；项目里没有也能补上 |
| **渲染前** | `video.ts`：页面引了 `./core.js` 就用 `hfEnv.coreSource()` + `coreLib.syncCoreTo` 同步一次，并把 `core.js 版本 a → b（渲染前按版本同步）` 写进 `video-duration.log` | 「应用升级后第二次渲染就吃到新版」；与 `projects.ts` 的 `syncCoreLib` 同一份逻辑（`video.ts` 只同步、不写 `core-lib.log`） |

### 3.2 留痕

`projects.ts` 的 `syncCoreLib()` 只在「真的复制了」或「出错了」时往 `<userData>/core-lib.log` 追加一行：

```
2026-10-23T08:12:33.456Z [我的项目] core.js 版本 5 → 6
```

- 日志写失败静默（`try/catch`），**日志失败不影响生成**。
- 幂等分支（`copied: false` 且没有 `error`）**不写日志**，否则每次预览都会刷一行。
- 版本从无到有时，`from` 写「无」（`(r.from || '无')`）。

## 4. 依赖与协作

- **被 `projects.ts` 调用**：`syncCoreLib()` 包一层（取 `hfEnv.coreSource()` + 写日志），再在写骨架 / 预览 / 导出三处调用；导出时另用 `readProjectCore()` 取内联源码。
- **被 `video.ts` 调用**：渲染前同步一次，覆盖时写 `video-duration.log`。
- **只从 `hfEnv.ts` 拿路径**：`coreSource()` 返回真源绝对路径（dev = 项目根 `vendor/`，打包 = `resourcesPath/vendor`）；`coreSource()` 返回 `null` 时 `syncCoreLib` 直接 return（页面会 404，但不该因此拦下生成）。
- **不 import `projects.ts`**：否则与 `projects → coreLib` 成环。项目目录一律作参数传入（`syncCoreTo(dir, srcPath)` / `readProjectCore(dir)`）。
- **不 import `electron`**：这就是它能被离线测试的原因，也让 `video.ts` 与 `projects.ts` 都能直接调它。
- **不注册 IPC、不碰渲染层**：同步是主进程内部的写盘动作，界面看不到任何「同步」按钮——它发生在用户已经在做的动作（生成 / 预览 / 导出 / 转视频）里。
- **`.core-version` 不进 `project.json`**：它是磁盘上的旁挂文件，不参与 `scanProjects()` 的 `has*` 标记，也不影响项目列表。

## 5. 注意事项与实现要点

- **改 `core.js` 必须调大 `CORE_VERSION`**：这是「应用要不要覆盖项目里那一份」的唯一判据。改了内容却不调版本号，所有项目都会继续用旧副本（`from === to` 且文件在 ⇒ 跳过）。
- **版本号是字符串不是数字**：正则接受 `[0-9A-Za-z._-]+`（`'1'`、`'2'`、`'3'`、`'5'`、`'6'`、`'1.2'`、`'2026-10-23'` 都行），比较用 `===`，**不做数字大小比较**——只要和项目里记的不一样就覆盖。
- **`from === to` 但文件不在也会复制**：两个条件缺一不可（见 2.1 第 5 步）。
- **拿不到真源不拦路**：`coreSource()` 返回 `null` / `syncCoreTo` 返回 error 时，`syncCoreLib` 只写日志就返回——生成与预览照常进行，页面里的 `MC` 会是 `undefined`（可接受的降级，比整次生成失败好）。
- **`core.js` 故意不进 `VENDOR_LIBS`**（那张表在 `hfEnv.ts`）：表里的库在导出单文件时会被换回公共 CDN 地址，而 `core.js` 是影坊自己的文件、**没有 CDN 形态**，导出时必须**内联**（`DownloadHtml` 用 `readProjectCore()` 取项目里那份，交给 `chapters.inlineChapters()`）。
- **两个文件一起写**：`core.js` 与 `.core-version` 都写完才算一次同步；只写其中一个会让下一次判定错乱（要么反复覆盖，要么永远不更新）。
- **`readProjectCore()` 只读不校验**：它不看 `CORE_VERSION`，也不判断文件是不是最新——导出前那次 `syncCoreLib` 已经保证了「项目里那份是最新的」。
- **v6 预设是「参数垫底」，不是新 API**：`preset` 只影响 `paint()` 内部那一组缺省值，`MC` 对外仍只有原来那些键；写 `preset` 的同时照样可以给 `wash` / `fill` / `ink` / `br`，**显式键优先**。别在章节 / 角色里自己拧 `bleed` / `tex`——那正是预设要替掉的东西；**质感来自 `fill`**，只给 `wash` 出来的是一层平的水彩底色。
- **与 `castLibrary.ts` 的分工别混**：`core.js` 是**应用内置的基础设施**（随应用升级、按版本覆盖、用户不该改）；项目里的 `cast/<id>.js` 是**内容**（用户/模型生成、导入即复制、全局库改了不会自动改已导入的项目）。一个是「助手」，一个是「角色」。
