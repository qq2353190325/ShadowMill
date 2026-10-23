# src/main/hfEnv.ts

> **按包解析**的内在依赖定位与环境探测：ffmpeg（ffmpeg 运行环境包）/ chrome-headless-shell、HyperFrames CLI（hyperframes 运行环境包）/ Node（Electron 内嵌或系统）；另有**随包前端库本地化**（GSAP / p5 / p5.brush，离线可用）、**共享绘制助手 core.js 的真源定位**、导出外部化与渲染入口抬级辅助

- **所在目录**：src/main/
- **类型**：环境探测 + 随包前端库本地化辅助模块（无 IPC 注册、无业务依赖）
- **规模**：398 行（实测 `[IO.File]::ReadAllLines`；上一版 384 行，本轮 **+14 行**：新增 `coreSource()` 及其注释）
- **对外导出**：常量 `BUILTIN_RESOURCES`，函数 `refreshBuiltinResources`（兼容保留）、**`refreshPack`**、**`packReady`**、`findHyperframesCli`、`resolveNodePath`、`findNode`（返回 `{ cmd, env }` 而非纯路径）、`findFfmpegBin`、`isHyperframesComposition`、**`localizeVendorHtml`**、**`externalizeVendorHtml`**、**`referencedVendorFiles`**、**`ensureVendorFiles`**、**`hoistVendorRefs`**、**`coreSource`**（共 15 个）

## 1. 作用与职责

- **资源根解析**：区分开发版与打包版两种资源根，并一次性算出内置依赖的全部绝对路径。
- **可执行文件探测**：为 HyperFrames 渲染链寻找 Chrome headless-shell、Node（要求 >= 22；**两级优先：Electron 内嵌 Node → 系统 Node**）、FFmpeg（WinGet 安装目录）。
- **CLI 入口探测**：定位 `hyperframes.mjs`，内置优先、环境变量兜底。
- **合规校验**：判断一段 HTML 是否为 HyperFrames 规范的 composition。
- **随包前端库本地化（离线可用）**：把 HTML 里的第三方前端库引用（GSAP / p5 / p5.brush）改写成项目内相对引用 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`，并按需把随包文件复制进调用方指定的项目目录——让生成的 composition 在离线或 CDN 抖动时也能预览与渲染。**能识别两种来源**：CDN 地址（jsDelivr / unpkg / cdnjs）与本地 `node_modules/p5/lib/…` 这类相对引用（PDoom 风格写法）。`ensureVendorFiles` 返回 `false`（有库缺失 / 复制失败）时，作者态三处（生成 / 修改 / 保存）会把引用换回 CDN；预览与渲染副本不判断返回值（见 3.7 的调用点表）。
- **共享绘制助手真源定位（本轮新增）**：`coreSource()` 给出应用内置 `vendor/shadowmill/core.js` 的绝对路径，供 `coreLib.syncCoreTo()` 在「写骨架 / 预览 / 导出 / 渲染前」把这份助手**按版本复制进项目**。它与 `vendor/` 的库共用同一套定位规则，但**刻意不进 `VENDOR_LIBS`**（见 2.2 与 5 的最后几条）。
- **导出外部化（反向）**：导出/下载的是**单个 HTML 文件**，同目录没有这些库文件，故 `externalizeVendorHtml()` 把 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 换回 `VENDOR_LIBS` 里登记的固定版本 CDN 地址，让导出物脱离项目目录也能独立打开（联网即可）。
- **渲染入口抬级**：渲染入口写在项目的 `.render-tmp/` 子目录里，`hoistVendorRefs(html, '../')` 把 `./<库文件>` 改写成 `../<库文件>`（引用要比项目根多退一级）。
- 本模块不注册任何 IPC，也不读写业务数据（`project.json`、字幕等一概不碰）；唯一的写盘行为是本地化的 `ensureVendorFiles()`，它只把随包文件复制到调用方指定的目录。`BUILTIN_RESOURCES` 的字段是 **getter + 按包缓存**（`cachedPackRoots`，另有 `cachedChrome`；Node 探测另有 `cachedNode`），路径在首次访问时求值，之后复用缓存值，直到 `refreshPack(name, root?)` 按包清缓存（或 `refreshBuiltinResources()` 清全部）（详见 3.4 / 5）。**`cachedChrome` 是个例外：它只缓存「找到的」结果**（`if (cachedChrome) return cachedChrome;`），找不到时返回 `null` 但不写缓存——详见 3.1。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `BUILTIN_RESOURCES` | 常量对象（字段为 getter） | 字段：`root`、`ffmpegBin`、`ffmpeg`、`ffprobe`、`hfCli`、`hivePlayer`、`chromeShell`（**已无 `node` 字段**：`resources/node` 整体删除；`root` 只作旧布局 / dev 的兜底，不再是一切资源的父目录） |
| `refreshPack(name, root?)` | `(name: 'ffmpeg' \| 'hyperframes', root?: string) => void` | **按包失效路径缓存**：传 `root` 则把该包钉到该目录，不传（或空串）则删掉该包缓存、下次按盘上标记重新解析；同时清 `cachedChrome`，`name === 'hyperframes'` 时另清 `cachedNode`。由 `runtime.ts` 在「探测到某包就绪」与「解包完成」时调用 |
| `packReady(name)` | `(name: 'ffmpeg' \| 'hyperframes') => boolean` | 纯查询：该包根是否解析得到（不触发下载、不写盘），供消费点校验 |
| `refreshBuiltinResources(root?)` | `(root?: string) => string` | **兼容保留**的旧接口：把传入的根同时钉给两个包（不传则清两个包缓存），再清 `cachedChrome` / `cachedNode`，返回 hyperframes 包根；分包后 `runtime.ts` 主要走 `refreshPack()` |
| `findHyperframesCli()` | `() => string \| null` | 返回 `hyperframes.mjs` 绝对路径或 `null` |
| `resolveNodePath()` | `() => string \| null` | 返回 Node 可执行文件真实绝对路径或 `null` |
| `findNode()` | `() => { cmd: string; env: Record<string, string> } \| null` | 返回可用的 Node **运行方式**：`cmd` 是绝对路径（Electron 内嵌时为 `process.execPath`），`env` 是**必须合并进子进程环境**的附加变量（内嵌时为 `{ ELECTRON_RUN_AS_NODE: '1' }`，系统 Node 途径为 `{}`）；**两级优先**：Electron 内嵌 Node（>= 22 探针）→ 系统 Node（>= 22） |
| `findFfmpegBin()` | `() => string \| null` | 返回 WinGet 安装的 Gyan.FFmpeg 的 `bin` 目录或 `null` |
| `isHyperframesComposition(raw)` | `(raw: string) => boolean` | 三个正则全部命中才返回 `true` |
| `localizeVendorHtml(html)` | `(html: string) => string` | 遍历 `VENDOR_LIBS`，把每家库的 CDN / `node_modules` 引用全部替换成 `./<库文件>`；**随包文件缺失的库整条跳过**（退化为在线加载）；空串原样返回 |
| `referencedVendorFiles(html)` | `(html: string) => string[]` | 页面引用了哪些随包文件（按 HTML 里的 `./<库文件>` 判断，`../x` 不算本级），返回文件名数组（如 `['p5.min.js', 'p5.brush.js']`） |
| `ensureVendorFiles(dir, html)` | `(dir: string, html: string) => boolean` | 把页面**引用到的**随包文件复制进 `dir`（幂等：已存在且体积一致即跳过）；`true` = 引用到的文件都已就位（**页面没引用任何库也算 true**），`false` = 有库缺失或复制失败 |
| `externalizeVendorHtml(html)` | `(html: string) => string` | 反向：把带引号的 `./<库文件>`（以及 `/<库文件>`、`<库文件>` 写法）换回 `VENDOR_LIBS` 里登记的固定版本 CDN（`pinned`）；不依赖随包文件是否存在 |
| `hoistVendorRefs(html, prefix)` | `(html: string, prefix: string) => string` | 渲染入口在 `.render-tmp/` 子目录里，把本级 `./<库文件>` 改写成 `prefix + <库文件>`（`prefix` 传 `'../'`）；已是 `../` 的引用不再二次加前缀 |
| **`coreSource()`** | `() => string \| null` | **共享绘制助手 `vendor/shadowmill/core.js` 的绝对路径**（与 `vendorSource` 同一套定位规则：`app.getAppPath()/vendor` → `process.resourcesPath/vendor`；都不存在回 `null`）。**只给路径、不复制**——复制与版本比对在 `coreLib.ts` 的 `syncCoreTo()` |

### 2.1 `BUILTIN_RESOURCES` 字段与路径构成

| 字段 | 类型 | 取值 |
| --- | --- | --- |
| `root` | `string` | **只作兜底**（旧布局 / dev 的资源根）：旧版整体包目录（`<userData>/runtime/current.json` 的 `id` → `<userData>/runtime/<id>`，该目录需存在 `ok.json`）优先，解析不到则回落 `process.resourcesPath`（打包）/ `path.join(app.getAppPath(), 'resources')`（开发态，刻意不看盘上标记，改 `resources/` 立即生效）。**分包后它不再是一切资源的父目录** |
| `ffmpegBin` | `string` | `resolvePackRoot('ffmpeg')` + `/ffmpeg/bin`（该包未就绪时为空串） |
| `ffmpeg` | `string` | 同上 + `/ffmpeg/bin/ffmpeg.exe` |
| `ffprobe` | `string` | 同上 + `/ffmpeg/bin/ffprobe.exe` |
| `hfCli` | `string` | `resolvePackRoot('hyperframes')` + `/hyperframes/node_modules/hyperframes/bin/hyperframes.mjs` |
| `hivePlayer` | `string` | hyperframes 包根 + `/hyperframes/node_modules/hyperframes/dist/hyperframes-player.global.js` |
| `chromeShell` | `string \| null` | `findChromeShell(<hyperframes 包根>)` 的返回值：在包根 + `/chrome/chrome-headless-shell` 子树中递归找出的 `chrome-headless-shell.exe` 绝对路径（该包未就绪时 `null`）；getter 每次访问都会重新求值，但**只有找到的结果**会被缓存（见 3.1） |

`resolvePackRoot(name)` 是分包后的核心（候选顺序）：① `<userData>/runtime/<包名>/`——目录内有 `ok.json` 才算完整（与 `runtime.ts` 先写 `ok.json` 再写记录的顺序一致）；② 旧版整体包目录（`current.json` + `ok.json` 的 `<id>` 目录，实现于 `legacyRoots()`）；③ `process.resourcesPath`（打包态）或项目根 `resources`（开发态，走 `devResourceRoot()`）。候选目录下必须存在与包名同名的子目录（`<候选>/ffmpeg` 或 `<候选>/hyperframes`）才算命中。命中结果按包写入 `cachedPackRoots`；解包完成或包切换时由 `runtime.ts` 调 `refreshPack(name, root?)` 失效。**这解释了为什么 `root` 不能再直接用 `process.resourcesPath`**：打包后 ffmpeg / hyperframes 各在 `userData/runtime/<包名>/` 下，安装目录里根本没有它们。

### 2.2 随包前端库：`VENDOR_LIBS` 表与不导出的助手

| 名称 | 类型 | 取值 / 作用 |
| --- | --- | --- |
| `VendorLib` | `interface`（**不导出**） | 一条库记录：`dir`（`vendor/` 下的子目录）、`file`（复制进项目后的文件名，同时也是页面里的相对引用名）、`patterns: RegExp[]`（命中即改写为 `./<file>`，**只匹配「路径本身」，不含两侧引号**）、`pinned`（导出单文件时换回的固定版本地址，必须与随包文件版本一致） |
| `VENDOR_LIBS` | `VendorLib[]`（**不导出**，三项、顺序敏感） | 见下表；数组顺序是有意的：`p5.brush` 排在 `p5` 之前，加库时不要把这两条调换（离线断言里专门验证过 p5.brush 的地址不会被 p5 那条正则抢走） |
| `vendorSource(lib)` | `(lib: VendorLib) => string \| null` | 随包文件的绝对路径：依次看 `app.getAppPath()/vendor/<dir>/<file>` 与 `process.resourcesPath/vendor/<dir>/<file>`，都不存在返回 `null` |
| `coreSource()` | `() => string \| null` | **导出**。同样的两处基准 + `<base>/shadowmill/core.js`；不存在回 `null`（调用方据此跳过同步，不乱覆盖） |
| `escFile(f)` | `(f: string) => string` | 把文件名里的 `.` 转义成 `\\.`，供下面两处拼正则 |
| `referencesLocalFile(html, file)` | `(html: string, file: string) => boolean` | 是否引用了项目内的该文件：`(?<![.\w])\./<file>`（前面不能是 `.` 或单词字符，**`../x` 不算本级**），不区分大小写 |

`VENDOR_LIBS` 的三条记录（顺序即数组顺序）：

| # | `dir` | `file` | `pinned`（固定版本 CDN） | `patterns` 覆盖 |
| --- | --- | --- | --- | --- |
| 1 | `p5` | `p5.brush.js` | `https://cdn.jsdelivr.net/npm/p5.brush@2.2.3/dist/p5.brush.js` | jsDelivr / unpkg / cdnjs 的 `p5.brush` 路径 + `node_modules/p5.brush/dist/…` |
| 2 | `p5` | `p5.min.js` | `https://cdn.jsdelivr.net/npm/p5@2.3.3/lib/p5.min.js` | jsDelivr / unpkg / cdnjs 的 `p5` 路径 + `node_modules/p5/lib/…` |
| 3 | `gsap` | `gsap.min.js` | `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js` | jsDelivr / unpkg / cdnjs 的 `gsap` 路径 |

- 每条 `patterns` 的 CDN 分支形如 `/(?:https?:)?\/\/(?:cdn\.jsdelivr\.net\/npm\/p5(?:@|\/)|unpkg\.com\/p5(?:@|\/)|cdnjs\.cloudflare\.com\/ajax\/libs\/p5\.js)[^"'<>()\s]*/gi`——兼容协议相对写法 `//…`、任意版本与路径后缀；本地分支形如 `/(?:\.\/)?node_modules\/p5\/lib\/[^"'<>()\s]*/gi`（可选 `./` 前缀）。
- 正则都带 `g` + `i`；只用于 `String.replace` 与「每次新建 RegExp 的 test」，**没有上一版 `GSAP_CDN_RE` 那种跨调用的 `lastIndex` 残留问题**。
- **`VENDOR_LIBS` 是「要本地化并可换回 CDN」的库表，不是「所有随包文件」的清单**：`vendor/shadowmill/core.js` 是影坊自己的绘制助手，没有公共 CDN 形态，导出时只能**内联**（`projects.ts` 的 `DownloadHtml` 用 `coreLib.readProjectCore()` 取项目里那份代码再交给 `chapters.inlineChapters()`）。把它放进 `VENDOR_LIBS` 会让导出物引到一个不存在的 `pinned` 地址。源码注释里就写明了这条理由。

## 3. 关键流程 / 算法

### 3.1 chrome-headless-shell 定位（`findChromeShell(hfRoot)`，访问 `chromeShell` 时执行）

1. `hfRoot = resolvePackRoot('hyperframes')`（未就绪则本函数根本不会被调用，`chromeShell` 直接为 `null`）；`base = <hfRoot>/chrome/chrome-headless-shell`（目录层级随 hyperframes 版本变化，故按文件名递归找）；`base` 不存在则结果保持 `null`。
2. 用数组 `stack` 做栈式深度优先遍历：`stack.pop()` 取当前目录。
3. 对 `fs.readdirSync(cur, { withFileTypes: true })` 的每个条目：目录则 `push(path.join(cur, e.name))`；文件名匹配 `/^chrome-headless-shell\.exe$/i` 则记录绝对路径并 `break` 内层循环。
4. 整个遍历包在 `try/catch` 中，任何异常（如权限、竞态）都把结果置为 `null`，不影响其余字段。
5. **缓存语义（本轮修正，务必别改回去）**：函数开头是 `if (cachedChrome) return cachedChrome;`——**只缓存找到的结果**；接着 `cachedChrome = null;` 先假定没有，遍历命中才赋绝对路径，最后 `return cachedChrome`。也就是说「没找到」返回 `null` 但**不写进缓存**，下次调用会重新在盘上找。
   - **原先的写法是 `if (cachedChrome !== undefined) return cachedChrome;`，把 `null` 也一并缓存**。后果：只要在运行环境包解包完成之前被问过一次（启动探测、渲染前的准备阶段都可能问到），「没有」这个结论就被**永久钉住**，此后即使包已解到磁盘上也永远拿不到路径——表现为渲染前量不到时间轴、`video-duration.log` 里写 `chrome=无`（2026-10 实测踩到：包明明就在 `userData/runtime/hyperframes/` 下）。
   - 失效通道不变：`refreshPack('hyperframes')` / `refreshPack(name)` / `refreshBuiltinResources()` 把 `cachedChrome` 置回 `undefined`；**但修正后即使没人调它们，找不到的结果也会自动重试**——这才是「解包完成后立刻可用」的保证（`runtime.ts` 的 `refreshPack()` 仍是主动失效的主要入口）。

### 3.2 `findHyperframesCli` 候选顺序

1. `BUILTIN_RESOURCES.hfCli` 存在（`fs.existsSync`）→ 直接返回内置路径。
2. 否则若 `process.env.HYPERFRAMES_CLI` 有值且该路径存在 → 返回该环境变量指向的路径。
3. 都不成立 → 返回 `null`（调用方据此提示“可设置环境变量 `HYPERFRAMES_CLI`”）。

### 3.3 `resolveNodePath` 候选顺序（“解析真实绝对路径”，避免 `spawn('node')` 在某些环境 ENOENT）

1. `path.join(process.env.NVM_SYMLINK, 'node.exe')`
2. `path.join(process.env.LOCALAPPDATA || '', 'nvm', 'nodejs', 'node.exe')`
3. `path.join('C:', 'Program Files', 'nodejs', 'node.exe')`
4. 对每个候选：`fs.existsSync(c)` 为真后执行 `spawnSync(c, ['-v'], { encoding: 'utf8' })`，仅当 `p.status === 0` 才返回该路径。
5. 兜底：`spawnSync('where.exe', ['node'], { encoding: 'utf8' })`，`status === 0` 且有 stdout 时，按 `/\r?\n/` 拆行、逐行 `trim`，取第一个非空且匹配 `/\.exe$/i` 的行，且该文件存在则返回。
6. 全部失败返回 `null`。

### 3.4 `findNode` 判定流程（HyperFrames 要求 Node >= 22）

**返回值不是路径而是 `{ cmd, env }`**：`env` 必须合进子进程环境后再 `spawn`，否则复用 Electron 时会把它当应用启动（见 3.4 的 ①）。结果缓存在模块级 `cachedNode`（含「确认为不可用」的 `null`）；探针要 `spawnSync` 一次 `electron.exe`（约 200–400ms，且会阻塞主进程），故一次会话只探一次，`refreshPack('hyperframes')`（或 `refreshBuiltinResources()`）时把 `cachedNode` 置回 `undefined` 一并失效。

1. **① Electron 内嵌 Node（首选；免下载，也不需要随包 Node）**：以 `env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }` 执行 `process.execPath -e 'process.stdout.write(String(process.versions.node || ""))'`；仅当 `status === 0`、输出可解析出主版本号且 **>= 22** 时，缓存并返回 `{ cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }`（Electron 44.7.0 实测内置 Node 24.21.0）。整段包在 `try/catch` 中，探针失败即静默回落、不影响启动。
   - 探针刻意用 **`-e` 而不是 `-v`**：若 Electron 的 `RunAsNode` 熔丝被关闭，`-e` 会被当作应用路径而直接失败；而 `-v` 会打印 **Electron** 版本（44 >= 22），会造成「复用可用」的误判。
2. **② 系统 Node**：`spawnSync('node', ['-v'])`，`status === 0` 时取 `stdout`、`trim()` 后去掉前缀 `v`，取首个 `.` 前的段做 `parseInt(..., 10)`；当 `major` 非 `NaN` 且 `major >= 22` 时返回 `{ cmd: resolveNodePath() 的结果, env: {} }`（有绝对路径就用绝对路径）。
3. **兜底**：前面都不成立时仍会尝试 `resolveNodePath()`——拿到路径就返回 `{ cmd: <绝对路径>, env: {} }`，拿不到则缓存并返回 `null`；`null` 由调用方（`video.ts`）转成可读提示。

> ① 的复用依赖 Electron 的 **`RunAsNode` 熔丝处于默认开启状态**。若将来在 `package.json` 的 `build.electronFuses` 里把它关掉，探针会失败并自动回落到 ② 系统 Node——不报错，但那时**必须**重新提供一份 Node：要么把 `resources/node/node.exe` 放回来并让它进运行环境包（`scripts/pack-runtime.mjs` 的 `PACKS` 与 `EXCLUDE_TOP` 两处都要改），要么把「系统 Node >= 22」变成硬性前置条件。源码内有一段长注释记录了实测结论（onnxruntime-node 与 sharp 均可在 Electron 的 Node 24 下加载；同一 composition 的成片与用 node 22 渲染逐项相同，含字节数；hyperframes 内部三处 `spawn(process.execPath)` 都继承 `process.env`，标志会传到子进程）。

### 3.5 `findFfmpegBin` 探测流程

1. `pkgRoot = <LOCALAPPDATA>/Microsoft/WinGet/Packages`；目录不存在直接返回 `null`。
2. 遍历 `pkgRoot` 的子目录，目录名以 `Gyan.FFmpeg` 开头者入选。
3. 在该包目录下再遍历其子目录，子目录名 `includes('full_build')` 者入选。
4. 若 `<full>/<sub>/bin/ffmpeg.exe` 存在则返回该 `bin` 目录；否则继续。
5. 无命中返回 `null`（调用方仅把它追加进 `PATH`，不追加也不致命）。

### 3.6 `isHyperframesComposition` 合规校验规则

```ts
/data-composition-id/i.test(raw) && /__timelines/i.test(raw) && /\bgsap\b/i.test(raw)
```

三个条件必须**同时**成立（`&&` 短路）：

1. 含 `data-composition-id`（不区分大小写）；
2. 含 `__timelines`；
3. 含独立单词 `gsap`（`\b` 词边界、不区分大小写）。

任一不满足即判定为非合规 composition。

### 3.7 随包前端库：本地化 / 落位 / 外部化 / 抬级（`VENDOR_LIBS` + 5 个函数）

背景（源码注释）：生成的 HTML 原先按提示词从 CDN 引 GSAP（现在还要引 p5 + p5.brush），离线或 CDN 抖动时 `gsap` 未定义、时间轴不存在，导致预览静止、转视频可能失败。故随包携带 `vendor/{gsap,p5}/`，在**生成 / 保存 / 预览 / 渲染**四个环节把 CDN 与 `node_modules` 引用改写为项目内相对引用（`./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`）并把文件复制到位。路径基准用 `app.getAppPath()`：dev = 项目根、打包后 = `app.asar` 根，只读字节，不需要 `extraResources`。各库版本、来源、许可证见 `vendor/gsap/README.md` 与 `vendor/p5/README.md`。

**为什么改成表驱动**：上一版是 6 个 GSAP 专用函数（`findLocalGsap` / `hasGsapCdnRef` / `referencesLocalGsap` / `localizeGsapHtml` / `externalizeGsapHtml` / `copyGsapIntoProject`），库名、文件名、CDN 正则、固定版本地址逐处写死在函数体里——加一个库要同时改 6 个函数和各调用方。现在同一个库的四件事（目录 / 文件名 / 匹配正则表 / 固定版本地址）收在 `VENDOR_LIBS` 一条记录里，5 个函数只遍历这张表，**再加库只改一张表**（往 `vendor/<dir>/` 放文件 + 在表里加一条记录；调用方一行不用动）。旧函数名已全部删除，全库检索零命中。

**① 改写 `localizeVendorHtml(html)`**：

1. `out = String(html || '')`，空串直接返回；
2. 按 `VENDOR_LIBS` 顺序逐库处理：`if (!vendorSource(lib)) continue;`——**随包文件缺失的库整条跳过**（退化为在线加载，不破坏现状）；
3. 对该库的每条 `patterns` 执行 `out = out.replace(re, './' + lib.file)`，把 CDN 地址、`node_modules/…` 本地引用、以及带 `./` 前缀的 `node_modules/…` 写法**统一改成 `./<库文件>`**；
4. 已是 `./<库文件>` 的写法不会被再改一次（patterns 只匹配 CDN 与 `node_modules` 形态），因此**幂等**；正文里出现的 “p5.js” 这类普通文本不误伤（只匹配 URL / 路径形态）。

**② 引用清单 `referencedVendorFiles(html)`**：`VENDOR_LIBS.filter((lib) => referencesLocalFile(html, lib.file)).map((lib) => lib.file)`——只认 `./<库文件>` 写法，`../<库文件>` 不算本级。该函数也导出（供调用方预检），当前唯一调用点在模块内部（`ensureVendorFiles`）。

**③ 落位 `ensureVendorFiles(dir, html)`**：

1. 对 `referencedVendorFiles(html)` 的每个文件名，反查 `VENDOR_LIBS` 得到库记录，再 `vendorSource(lib)` 取源文件；源文件为 `null` → `ok = false` 并继续；
2. `fs.mkdirSync(dir, { recursive: true })` 建目录，目标 `dest = path.join(dir, file)`；
3. **幂等**：`dest` 已存在且 `statSync(dest).size === statSync(src).size` → 跳过（不重复写盘）；体积不一致（旧版本残留）则覆盖复制；
4. `fs.copyFileSync(src, dest)`；整个复制包在 `try/catch` 里，异常置 `ok = false`；
5. 返回 `ok`：**`true` = 页面引用到的文件都已就位（页面没引用任何库也算 `true`）**，`false` = 有库缺失或复制失败——调用方据此决定要不要把引用换回 CDN。

**④ 外部化 `externalizeVendorHtml(html)`**（反向，导出单文件时用）：对每个库执行 `out = out.replace(new RegExp('(["\'])(?:\\.\\/|\\/)?' + escFile(lib.file) + '\\1', 'gi'), '$1' + lib.pinned + '$1')`——

1. 正则要求**成对的引号包裹**：只匹配 `"./p5.min.js"` / `'./p5.min.js'` / `"p5.min.js"` / `"/p5.min.js"` 这类写法，捕获组 `\1` 保留原引号风格；无引号出现的提及（如纯文本里的 `p5.min.js`）不改写。
2. **不依赖 `vendorSource()`**：随包文件缺失时也能换回 CDN（导出行为与本地环境无关）。
3. 写回的是 `VENDOR_LIBS` 的 `pinned` 字段——**该字段必须与随包文件版本一致**（升级时两处一起改，见 `vendor/p5/README.md`）。
4. 只改文本、不落文件。

**⑤ 抬级 `hoistVendorRefs(html, prefix)`**：渲染入口在 `.render-tmp/` 子目录里，库文件在项目根，因此 `out.replace(new RegExp('(?<![.\\w])\\./' + escFile(lib.file), 'gi'), prefix + lib.file)` 把本级引用改成上一级（调用方传 `'../'`）。负向后顾保证 `../x` 不会被再次加前缀，**重复调用不会叠出 `../../x`**（离线断言里专门验证过“入口抬级不重复加”）。

**⑥ 共享绘制助手（不属于上面这套表）**：`coreSource()` 只回答「应用里那份 `core.js` 在哪」，**不做任何改写、也不复制**。真正的同步是 `coreLib.syncCoreTo(dir, srcPath)`：读源码里的 `CORE_VERSION`、与项目里的 `.core-version` 比对，不一致才覆盖 `./core.js`。它也不参与 `localizeVendorHtml` / `externalizeVendorHtml`——页面里的引用形态固定就是 `./core.js`，不需要在 CDN 与本地之间切换。

**加载顺序固定**：页面里先 `p5.min.js`、再 `p5.brush.js`（后者是前者的插件）；`VENDOR_LIBS` 的数组顺序同样把 p5.brush 排在 p5 之前（源码注释标注顺序敏感），加库时不要把这两条调换。

**调用点（语义与改动前逐条对齐）**：

| 文件 | 处数 | 用法 |
| --- | --- | --- |
| `src/main/video.ts` | 2 | `prepareEntry()` 拿到 `localized` 后的第一步就是 `hfEnv.hoistVendorRefs(localized, '../')`；渲染前 `const localized = hfEnv.localizeVendorHtml(raw)` + `hfEnv.ensureVendorFiles(projDir, localized)`（**不判断返回值**，离线时仍可由 CDN 加载）。**另有 `hfEnv.coreSource()` 一处**：渲染前若页面引了 `./core.js`，用 `coreLib.syncCoreTo` 按版本同步一次 |
| `src/main/projects.ts` | 5 | 生成 / 修改 / 保存 / 预览 / 导出统一成 `localizeVendorHtml` + `if (!hfEnv.ensureVendorFiles(dir, html)) html = hfEnv.externalizeVendorHtml(html)` 的模式（导出那一处直接 `externalizeVendorHtml`）。**另有 `hfEnv.coreSource()` 一处**：`syncCoreLib(dir)` 用它定位真源 |

## 4. 依赖与协作

**import**

| 来源 | 引入内容 |
| --- | --- |
| `node:path` | `path`（`join`） |
| `node:fs` | `fs`（`existsSync`、`readFileSync`、`readdirSync`、`statSync`、`mkdirSync`、`copyFileSync`） |
| `node:child_process` | `spawnSync` |
| `electron` | `app`（`isPackaged`、`getAppPath`、`getPath('userData')`） |

**被谁引用**

| 引用方 | 使用的导出 |
| --- | --- |
| `src/main/video.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.ffmpeg`、`BUILTIN_RESOURCES.ffprobe`、`BUILTIN_RESOURCES.chromeShell`、`isHyperframesComposition`、`findHyperframesCli`、`findNode`（**返回值是 `{ cmd, env }`；`cmd` 交给 `spawn`，`env` 必须并入子进程环境**）、`findFfmpegBin`、**`coreSource`（本轮新增，渲染前同步 `core.js`）**，以及本地化的 `localizeVendorHtml` / `ensureVendorFiles`（就地渲染：本地化产物是**项目目录**里的库文件，入口 HTML 在 `.render-tmp/` 里用 `hoistVendorRefs(localized, '../')` 改成 `../<库文件>` 引用）。其中 `chromeShell` 的用法值得单独记一笔：它被赋给子进程环境的 `PRODUCER_HEADLESS_SHELL_PATH`，**渲染本身与「渲染前现场量 GSAP 时间轴」这两步共用同一个解析结果**（量测那步就是拿 `env.PRODUCER_HEADLESS_SHELL_PATH` 当 `chrome` 参数去跑 `--headless --dump-dom`）；因此这里拿到 `null` 时，量测会被跳过、日志写 `chrome=无`（见 3.1 与本文件末节的故障说明） |
| `src/main/projects.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.ffmpeg`、`isHyperframesComposition`（HTML 生成/修改/保存侧的合规判断），本地化的 `localizeVendorHtml` / `ensureVendorFiles`（生成 / 修改 / 保存 / 预览四个写盘环节；其中**作者态三处用 `ensureVendorFiles` 的返回值做「文件未就位即退回 CDN」兜底**），以及 `externalizeVendorHtml`（兜底改写 + `project:download-html` 的导出改写）。**本轮新增 `coreSource`**：`syncCoreLib(projDir)` 用它取助手真源，再交给 `coreLib.syncCoreTo` |
| `src/main/ttsAlign.ts` | `BUILTIN_RESOURCES`（取 `ffmpeg` / `ffprobe`） |
| `src/main/voice.ts` | `import { BUILTIN_RESOURCES } from './hfEnv'`：`voice:create` 创建克隆音色时取 `BUILTIN_RESOURCES.ffmpeg` / `BUILTIN_RESOURCES.ffprobe`，把本地参考音频裁成前 15 秒 / 24 kHz / 单声道 `pcm_s16le` wav（见 [voice.ts.md](./voice.ts.md) §4.1.1） |
| `src/main/whisper.ts` | `BUILTIN_RESOURCES`（取 `ffmpeg`；并把它当作 `resolveCliPath()` 的第二候选根——whisper 现在**随安装包**，首选 `<resources>/whisper`，`root` 只是旧布局兜底） |
| `src/main/runtime.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，**主要用 `refreshPack(name, root)`**（探测到某包就绪、以及解包完成时，把该包目录交给 `hfEnv` 重算该包缓存）；`refreshBuiltinResources(...)` 与 `packReady(...)` 也已导出但当前调用点在 `runtime.ts` 内以 `refreshPack` 为主 |

`vendorSource` 仅在本模块内部被 `localizeVendorHtml` / `ensureVendorFiles` 使用；`referencesLocalFile` 由 `referencedVendorFiles` 调用；`referencedVendorFiles` 也已导出，但当前只在模块内部被 `ensureVendorFiles` 调用（全库无外部调用点）。`coreSource` 是**唯一一个专门为模块外调用而存在的路径函数**：本文件内没有它的调用点，唯一消费方是 `projects.ts` 的 `syncCoreLib`（`video.ts` 直接 `import * as hfEnv` 后自己调用，不经 `projects.ts`）。

`src/main/index.ts` 只在注释中登记本模块，并不 import 它——因为本模块不注册 IPC。

**被引用方注入的环境变量（由 `src/main/video.ts` 设置，非本文件）**：`ELECTRON_RUN_AS_NODE`（仅当 `findNode()` 走 ① 时，值来自本模块返回的 `env`）、`HYPERFRAMES_FFMPEG_PATH`、`HYPERFRAMES_FFPROBE_PATH`、`PRODUCER_HEADLESS_SHELL_PATH`，以及把 `findFfmpegBin()` 结果前置进 `PATH`。

**本模块读取的环境变量**：`HYPERFRAMES_CLI`、`NVM_SYMLINK`、`LOCALAPPDATA`。

## 5. 注意事项与实现要点

- **路径解析是「按包缓存 + 可失效」而非一次性快照**：`BUILTIN_RESOURCES` 的字段都是 getter，`ffmpeg` 一族与 `hfCli` 一族各自经 `resolvePackRoot(name)` 解析并按包写入 `cachedPackRoots`；候选依次是「该包已解到 `<userData>/runtime/<包名>/`（需 `ok.json`）」→「旧版整体包目录（`current.json` + `ok.json`）」→「`process.resourcesPath` / 开发态项目根 `resources`」。`root` 只作后两者的兜底。运行环境包解包完成或切换目录时由调用方 `refreshPack(name, root?)` 失效该包缓存（并清 `cachedChrome`，hyperframes 时另清 `cachedNode`），`refreshBuiltinResources(root?)` 则一次清两个包 + 两个探测缓存（兼容保留）。
- **平台假设为 Windows**：路径与文件名硬编码 `node.exe`、`ffmpeg.exe`、`ffprobe.exe`、`chrome-headless-shell.exe`、`where.exe`、`C:\Program Files\nodejs`，非 Windows 平台这些分支会全部落空。
- **只做“存在 + 能跑”的轻量验证**：所有探测都是 `existsSync` 加 `spawnSync(..., ['-v'])` 的 `status === 0` 判定，不解析版本（`resolveNodePath`、`findHyperframesCli`、`findFfmpegBin` 均不校验版本）；**唯一例外是 `findNode`**——① 与 ② 分支都解析主版本并要求 >= 22。
- **`findNode` 的版本门槛覆盖两条分支**：① 用 `-e` 探针取 `process.versions.node` 并要求 >= 22；② 用 `node -v` 的输出判 >= 22。**原先的「随包 `resources/node/node.exe`」已随该目录整体删除**——它当年不校验版本，且在打包态本来就够不着（`build.files` / `extraResources` 都不带 `resources/**`，只有 dev 的 `resolveRoot()` 指向项目根 `resources` 才会命中）。
- **`findNode` 的返回值必须成对使用**：只取 `cmd` 而丢掉 `env` 会让 `electron.exe` 以应用身份启动（渲染直接失败）。这是本模块唯一「返回值不只是路径」的函数，`video.ts` 用 `{ ...process.env, ...nodeRt.env }` 合并它。
- **① 的复用依赖 `RunAsNode` 熔丝**：熔丝默认开启；一旦在 `build.electronFuses` 里关掉，探针（`-e`）失败并静默回落到 ② 系统 Node，不报错但那时必须重新提供 Node（见 3.4 的注）。探针刻意不用 `-v`，因为 `-v` 打印的是 Electron 版本（44 >= 22），会把「不可复用」误判成可用。
- **探测失败一律返回 `null`，不抛出**：`chromeShell` 的遍历异常被 `catch` 吞掉，`where.exe` 分支同样被 `catch` 包住，`findNode` 的 ① 探针也包在 `try/catch` 里；调用方必须自行处理 `null` 并给出可读提示。`coreSource()` 同样如此：来回 `try/catch` + `null`，**拿不到真源时不抛错、不拦下生成**（`projects.ts` 的 `syncCoreLib` 见 `null` 直接 return）。
- **`cachedChrome` 是「只缓存成功」的那一个**（2026-10 修正，别再退回旧写法）：模块里三个探测缓存语义**并不相同**——`cachedPackRoots` / `cachedNode` 把「确实没有」的结论也缓存下来（包根缓存空串、Node 缓存 `null`），靠 `refreshPack()` / `refreshBuiltinResources()` 失效；而 `cachedChrome` **只在找到时才写**，找不到返回 `null` 而不写缓存。原因：`chrome-headless-shell` 完全可能在「第一次被问到」之后才落到盘上（运行环境包是异步解包的），把 `null` 钉死会让渲染前的时间轴量测永久失效（症状是 `video-duration.log` 里 `chrome=无`、量不到时间轴、成片被最长媒体顶长）；而 Node 的探测要 `spawnSync` 一次 `electron.exe`（200~400ms、阻塞主进程），才需要「一次会话只探一次」的强缓存。
- **`BUILTIN_RESOURCES.chromeShell` 的消费面是「渲染 + 渲染前量测」两处，共用一次解析**：`video.ts` 取一次 `hfEnv.BUILTIN_RESOURCES.chromeShell` 写进 `env.PRODUCER_HEADLESS_SHELL_PATH`，随后既交给 HyperFrames CLI 渲染（避免它去 `.cache` 重新下载 Chrome），也交给自己的 `measureTimelineDuration()` 跑无头浏览器量 GSAP 时间轴（`--virtual-time-budget=5000 --dump-dom`）。所以「这里返回 `null`」的后果有两个：CLI 侧可能重新下载 / 找不到浏览器，应用侧则完全量不到时间轴。
- **可执行路径都是绝对路径**：源码注释强调“一律返回绝对路径”，以规避 `spawn('node')` 在部分环境下 ENOENT。
- **DFS 不是纯递归**：`stack.pop()` 为后进先出，命中顺序取决于目录读取顺序；只要存在一个匹配的 `chrome-headless-shell.exe` 即可，不保证选中最外层或版本最新的那个。
- **合规校验是启发式**：仅三个正则文本匹配，不解析 DOM、不校验 `__timelines` 的实际结构，也不校验 GSAP 是否真的被加载；因此可能出现“文本合规但渲染失败”的情况。
- **本模块返回「怎么跑」的只有 Node**：`findNode()` 除路径外还给出必须注入的 `env`；CLI / ffmpeg / chrome-headless-shell / `coreSource` 仍只返回路径，是否可用、如何拼命令、如何注入环境变量全部由调用方（`src/main/video.ts` / `src/main/projects.ts`）决定。
- **模块已声明不再是“纯函数”（已修正）**：源码头部注释现为「环境探测 + HyperFrames 资源定位 + GSAP 本地化（无 IPC 注册，无业务状态）」，并额外写明「本模块不再是『纯函数』—— GSAP 本地化那组会读写文件（只复制随包的 gsap.min.js，不碰业务数据）」。**头部那两行注释还停留在「只有 GSAP」的旧口径**，而实现段的新注释已写「随包前端库（vendor/）本地化」；实际读写文件的只有 `ensureVendorFiles`（只复制随包文件，不碰业务数据），「无 IPC 注册」「无业务状态」「不碰业务数据」仍然成立。
- **随包文件缺失时静默退化**：`localizeVendorHtml` 对该库整条跳过（HTML 继续引原来的 CDN / `node_modules`，在线时照常工作），`ensureVendorFiles` 返回 `false`。`projects.ts` 的作者态三处在返回 `false` 时会把引用换回 CDN（`externalizeVendorHtml`），因此落盘结果永远有一个可用的库来源；`project:preview-html` 与 `video.ts` 的渲染副本仍忽略返回值（不报错、也无提示）。
- **导出外部化只认带引号的写法**：`(["\'])(?:\.\/|\/)?<文件名>\1` 要求成对引号；若写成无引号的 `src=p5.min.js`，导出时不会被换回 CDN（导出物仍缺文件）。它也不判断“这是不是真的 script 引用”——任何带引号的 `"p5.min.js"` 提及（含注释、纯文本）都会被替换成 CDN 地址。
- **两个方向的取舍**：项目内优先本地引用（离线可预览/渲染），导出物一律换回固定版本 CDN（`VENDOR_LIBS.pinned`，单文件即可独立打开）。二者互补：只本地化会让导出物缺库文件而动画不跑；只走 CDN 会让离线预览/渲染失败。作者态三处还多一层保险：复制不成功时**也**退回 CDN——宁可联网也不能引用一个不存在的文件。
- **兜底只在作者态生效（预览 / 渲染仍忽略返回值）**：`project:preview-html` 与 `video.ts` 的渲染副本不做这层兜底（按作者说明：预览副本与原件引用一致，属同状态）。若出现「`p5.min.js` 复制失败、但 HTML 本身写得进去」的偏门情形，作者态落盘的是 CDN 引用，而预览副本在 `localizeVendorHtml` 之后会重新变成 `./p5.min.js`（复制同样失败），预览便可能取不到该文件。
- **`VENDOR_LIBS.pinned` 是手工同步点**：三条记录分别写死 `p5.brush@2.2.3` / `p5@2.3.3` / `gsap@3.14.2`，必须与 `vendor/` 下的随包文件版本一致；升级随包库时若忘记改对应的那条 `pinned`，导出物会引到与随包版本不同的库（当前能跑，但版本会悄悄漂移）。`vendor/p5/README.md` 已写明「升级时两处一起改」。
- **`coreSource()` 为什么不进 `VENDOR_LIBS`**（本轮新增，务必别挪进去）：那张表只装**能被换回公共 CDN 的第三方库**——每条记录都必须有 `pinned` 地址，导出单文件时用它替换本地引用。`core.js` 是影坊自己的绘制助手，没有 CDN 形态，硬塞进表里会让导出物引一个不存在的地址。所以它的导出路径是**内联**：`projects.ts` 的 `DownloadHtml` 先 `syncCoreLib(dir)` 保证项目里那份是最新版，再 `coreLib.readProjectCore(dir)` 读出来作为一条 `{ path: 'core.js', code }` 交给 `chapters.inlineChapters()`。
- **随包位置与打包**：`core.js` 放在 `vendor/shadowmill/core.js`，`build.files` 的 `vendor/**/*` 本来就覆盖它，**打包配置未改**；`coreSource()` 与 `vendorSource()` 用同一套两级路径，dev 命中项目根 `vendor/`、打包命中 `resourcesPath/vendor`。
- **覆盖面是白名单式**：只识别 `p5.brush`、`p5`、`gsap` 三家包名在 jsDelivr / unpkg / cdnjs 上的路径，以及 `node_modules/{p5,p5.brush}/…` 这两种本地形态。其他 CDN（自建镜像、`esm.sh`）、其他包名路径（如 three.js）既不会被 `localizeVendorHtml` 改写，也不会被判定为“可本地化”，随包文件不会被复制。
- **改写面比上一版宽**：除 CDN 地址，还会把 `node_modules/p5/lib/p5.min.js`、`node_modules/p5.brush/dist/p5.brush.js`（含 `./` 前缀写法）这类**本地相对引用**改写成项目内的 `./p5.min.js` / `./p5.brush.js`——即「PDoom 风格」的 node_modules 直引页面同样能离线。
- **幂等判据是“体积一致”**：`ensureVendorFiles` 只比较字节数。若项目目录里已有一份**体积恰好相同**的旧版库文件，不会被刷新；升级随包版本时若体积恰好相同，需要手动清理项目目录里的旧副本。（`core.js` 不走这条判据：它按 `CORE_VERSION` 覆盖，见 [coreLib.ts.md](./coreLib.ts.md)。）
- **正则尾部字符集决定截断位置**：`[^"'<>()\s]*` 在引号 / 空格 / 括号处停止，因此 `https://cdn.jsdelivr.net/npm/p5@2.3.3/lib/p5.min.js` 这类带路径的地址会被整体替换，`?ver=1` 之类的查询串也在替换范围内；但写成 `src=p5.min.js`（无引号）时不会被 `referencesLocalFile` 的 `(?<![.\w])\./…` 命中。
- **改写与复制是两件事**：`localizeVendorHtml` 只管改文本、不落任何文件；`ensureVendorFiles` 只管复制文件、不看 HTML 是否真的被改过（它只看 `./<库文件>` 引用）。“改谁、复制到哪”由 `projects.ts` / `video.ts` 决定（例如预览与渲染都只改副本，不动用户原件）。
- **页面可用的随包库从「只有 GSAP」变成「GSAP + p5 + p5.brush」，再加上 core.js 的 `MC` 对象**：页面可以写 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`（p5.brush 必须先加载 p5），章节模式下骨架还一律引入 `./core.js`（全局对象 `MC`）。**本轮生成提示词已同步**——`agent/html.ts` 的三份系统提示词都加了「画形状优先用 `MC.*`、抖动一律用 `MC.jit`、不许 `Math.random()`」那一条。
- **打包与依赖**：`build.files` 里的 `vendor/**/*` 本来就有，**打包配置未改**；`package.json` 也未改——p5 / p5.brush 只用 `npm install` 取产物，不是应用运行时依赖。`vendor/p5/` 是**未跟踪的新目录**（5 个文件：`p5.min.js` 990,372 B、`p5.brush.js` 71,792 B、`P5-LICENSE.txt` 24,480 B、`P5.BRUSH-LICENSE.md` 1,084 B、`README.md` 1,391 B），提交时才进版本库；`vendor/shadowmill/core.js` 是本轮新增（**270 行、13,366 B，当前 `CORE_VERSION = '6'`**），同样是 `vendor/**/*` 覆盖。
- **许可证是分发约束**：p5 用 **LGPL-2.1**、p5.brush 用 **MIT**（原文分别在 `vendor/p5/P5-LICENSE.txt` 与 `vendor/p5/P5.BRUSH-LICENSE.md`）。当前以「独立文件 + 运行时动态加载」分发，满足 LGPL 的可替换要求；若将来把库打进应用 bundle，需要重新评估许可证义务。`core.js` 是本项目自己的代码，无第三方许可证问题。
- **验证状态（别把未验证写成已验证）**：`npm run typecheck` 三工程（node / web / agent）退出码 0；全库检索 6 个旧函数名零命中；离线断言 **20/20** 通过（从源码 `VENDOR_LIBS` 字面量取正则跑样例：四种来源的 p5 / p5.brush 都能改对、p5.brush 的 URL 不被 p5 正则抢走、`./x` 原样、正文里的 “p5.js” 不误伤、`../x` 不算本级、导出换回固定地址、入口抬级不重复加）。**未验证**：应用内实机、Mac/Linux 打包后 `vendor/` 是否随包。
