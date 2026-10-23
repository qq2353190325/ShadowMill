# src/main/castInject.ts

> 把「共享绘制助手 `core.js` + 项目里被勾选的角色」注入到**模型写的单文件 `index.html`** 里的**纯函数**模块（只做字符串变换）：整组插在模型自己的第一个 `<script>` 之前、带 `data-myv-*` 标记、注入前先整组剥掉（幂等）

- **所在目录**：src/main/
- **类型**：纯逻辑（HTML 文本变换），**不调用模型、不读写磁盘、不注册 IPC、不 import 其他主进程模块**
- **规模**：54 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：3 个函数（`stripInjectedCast` / `injectCastTags` / `referencesCore`）

## 1. 作用与界面位置

**在页面上没有对应的控件**：它不产生新界面，作用对象是「HTML生成」页点「生成 HTML」之后**落到盘上的那份 `index.html`**。

它要解决的问题是**产物形态不同、角色却要一样能用**：

- **章节模式**：`index.html` 是应用自己生成的骨架，直接写 `<script src="./cast/<id>.js">` 就行（见 [chapters.ts](./chapters.ts.md) 的 `buildSkeleton`）。
- **单文件模式**：`index.html` 是模型一次吐出来的整份页面，应用只能**事后**往里塞脚本——这正是「角色属于素材、与单文件 / 章节化无关」的落地方式：不管页面是哪种形态，被勾选的角色都必须能 `window.__cast["hero"](x, y, u, { ctx })` 调用到。

三条规则（源码头部注释逐字）：

| 规则 | 内容 |
| --- | --- |
| ① **顺序** | `core.js` 在前、各角色在后；整组插在「模型自己的第一个 `<script>` 之前」——**script 是同步执行的**，角色定义必须先于使用（否则模型页面里的调用会是 `undefined`） |
| ② **幂等** | 注入的标签带 `data-myv-*` 标记，重写前先整组剥掉，反复生成 / 修改不会叠加 |
| ③ **兜底** | 页面里一个 `<script>` 都没有（极端情况）就插到 `</head>` 前，再没有就插到文档最前 |

调用方只有 `projects.ts` 的 `applyCastToHtml()`（单文件落盘与 `refreshCastInPage()` 两处共用），**章节模式不经过本文件**。本文件是纯函数，方便离线断言。

## 2. 导出

| 名称 | 签名 | 说明 |
| --- | --- | --- |
| `stripInjectedCast(html)` | `(html: string) => string` | 剥掉上一次注入的整组标签（含它们之间的空白）：两条正则分别匹配带 `data-myv-core` / `data-myv-cast` 的 `<script …>…</script>`（`gi`），**不带标记的同名脚本不动** |
| `injectCastTags(html, relPaths, opts?)` | `(html: string, relPaths: string[], opts?: { withCore?: boolean }) => string` | 注入。`relPaths` = 要注入的角色文件（项目内相对路径，如 `cast/hero.js`，按角色表顺序）；`opts.withCore` **缺省 true**（不传 `opts` 也注入 `core.js`） |
| `referencesCore(html)` | `(html: string) => boolean` | 页面里是否已经引了 `core.js`（正则 `src\s*=\s*["'](?:\.\/)?core\.js["']`，`i`）——源码注释说明它是留给「预览 / 导出据此判断要不要同步 / 内联」的判据 |

模块内私有：`CORE_MARK = 'data-myv-core'`、`CAST_MARK = 'data-myv-cast'`、`esc(s)`（转义正则元字符，只服务 `referencesCore`）。

## 3. 关键流程

`injectCastTags()` 的完整算法（8 步，与源码一一对应）：

```
injectCastTags(html, relPaths, opts)
  ① src = stripInjectedCast(html)                      # 先剥上一次注入（幂等）
  ② withCore = !opts || opts.withCore !== false        # 缺省 true
  ③ paths = relPaths 里只留匹配 /^cast\/[a-z][a-z0-9_]{0,23}\.js$/i 的
  ④ tags = []
     if (withCore) tags.push('<script data-myv-core src="./core.js"></script>')
     for p of paths:
         id = p 去掉前缀 cast/ 与后缀 .js
         tags.push('<script data-myv-cast="' + id + '" src="./' + p + '"></script>')
  ⑤ tags 为空 → 直接返回 src（= 只剥不塞）
  ⑥ block = tags.join('\n')
  ⑦ 找第一个 /<script\b/i：
       命中 → src.slice(0, at) + block + '\n' + src.slice(at)      # 定义先于使用
     否则找 /<\/head\s*>/i：
       命中 → 插在它前面
     否则 → block + '\n' + src                                      # 放最前
```

四条要点：

1. **顺序固定为「core.js → 各角色」**，角色之间按 `relPaths` 传入顺序（= 角色表顺序，不重排）。
2. **标记写在标签属性上**：`data-myv-core`（无值属性）与 `data-myv-cast="<id>"`——它们同时是「下次要剥哪些」的唯一判据，所以**剥和塞必须成对**。
3. **路径白名单与 `cast.ts` 同一条**：`cast/<slug>.js`，slug 是 `^[a-z][a-z0-9_]{0,23}$`；不合规的路径被静默丢掉（不会写出一个页面读不到的文件）。
4. **`withCore: false` 时整组只剩角色脚本**；而当 `relPaths` 也为空时 `tags` 为空、函数退化成「只剥不塞」——这正是「**没有勾选任何角色时只把旧注入剥掉、不塞 `core.js`**」的实现（模型写的单文件页面本来就不认识 `MC.*`，硬塞一份 core.js 只是无谓体积）。

注入后的形态（以两个角色为例）：

```html
<script data-myv-core src="./core.js"></script>
<script data-myv-cast="hero" src="./cast/hero.js"></script>
<script data-myv-cast="cat" src="./cast/cat.js"></script>
<script src="./gsap.min.js"></script>
```

## 4. 依赖与协作

- **唯一调用方是 `projects.ts`**：`applyCastToHtml(html, proj, dir)` 先取 `cast.selectedMembers(proj.cast)` 映射成 `cast/<id>.js` 相对路径，再 `castInject.injectCastTags(html, rels, { withCore: … })`；`writeSingleHtml()`（生成 / 修改落盘）与 `refreshCastInPage()`（角色表变更后按新勾选重新注入）都经过它。
- **`core.js` 文件本身不在这里写**：注入的是 `./core.js` 这个引用，真正的复制由 `projects.ts` 的 `syncCoreLib()` → [coreLib.ts](./coreLib.ts.md) 负责（`applyCastToHtml` 在有勾选角色时先同步一次，文件必须先到位）。
- **不依赖 `cast.ts`**：本模块只做字符串变换，路径白名单是对 `cast.ts` 的 `FILE_RE` 的**同构复制**（一个正则），不 import 它，也不认识 `ProjectCastMember`。
- **不依赖 `chapters.ts`**：章节模式的 script 标签由 `buildSkeleton` 直接拼，本文件不参与。
- **导出链路不经过本文件**：`project:download-html` 用 [chapters.ts](./chapters.ts.md) 的 `inlineChapters()` 把 `<script src>` 换成内联脚本，`core.js` 与 `cast/<id>.js` 都在那份 `sources` 里。

## 5. 注意事项与实现要点

- **不要改成「追加到 `</body>` 前」**：script 是同步执行的，追加到末尾会让模型页面里 `window.__cast[…]` 的调用先跑、拿到 `undefined`；「第一个 `<script>` 之前」是唯一能保证「定义先于使用」的位置。
- **幂等靠标记、不靠内容比对**：`stripInjectedCast()` 只认 `data-myv-core` / `data-myv-cast` 两个标记，所以**模型自己写的** `<script src="./core.js">`（不带标记）不会被剥掉；反过来若有人手改了这两个属性，旧标签就再也剥不干净——标记不是装饰。
- **`referencesCore()` 目前没有调用方**（源码里只定义、未使用）：`project:preview-html` 判断「要不要同步 core.js」用的是自己那条内联正则 `/src=["'](?:\.\/)?core\.js["']/i`。两者口径一致，改动时一起看。
- **没有勾选角色时「只剥不塞」是刻意的**：返回值可能比输入更短（旧注入被剥掉），调用方（`refreshCastInPage`）据此判断 `next !== cur` 才写盘。
- **纯字符串变换、无 I/O**：本文件不 import `node:fs` / `node:path` / `electron`，也不 import 任何主进程模块，因此可以直接对着一段 HTML 做离线断言。
- **不改页面其它部分**：不碰 `<head>` 里的库引用、不动模型写的 `<script>` 顺序（只在最前面插一段整组），也不转义 / 重排既有内容。
