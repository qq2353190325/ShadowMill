# src/main/hfEnv.ts

> **按包解析**的内在依赖定位与环境探测：ffmpeg（ffmpeg 运行环境包）/ chrome-headless-shell、HyperFrames CLI（hyperframes 运行环境包）/ Node（Electron 内嵌或系统）；另有 GSAP 本地化（离线可用）与导出外部化辅助

- **所在目录**：src/main/
- **类型**：环境探测 + GSAP 本地化辅助模块（无 IPC 注册、无业务依赖）
- **规模**：343 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：常量 `BUILTIN_RESOURCES`，函数 `refreshBuiltinResources`（兼容保留）、**`refreshPack`**、**`packReady`**、`findHyperframesCli`、`resolveNodePath`、`findNode`（返回 `{ cmd, env }` 而非纯路径）、`findFfmpegBin`、`isHyperframesComposition`、`findLocalGsap`、`hasGsapCdnRef`、`referencesLocalGsap`、`localizeGsapHtml`、`externalizeGsapHtml`、`copyGsapIntoProject`（共 15 个）

## 1. 作用与职责

- **资源根解析**：区分开发版与打包版两种资源根，并一次性算出内置依赖的全部绝对路径。
- **可执行文件探测**：为 HyperFrames 渲染链寻找 Chrome headless-shell、Node（要求 >= 22；**两级优先：Electron 内嵌 Node → 系统 Node**）、FFmpeg（WinGet 安装目录）。
- **CLI 入口探测**：定位 `hyperframes.mjs`，内置优先、环境变量兜底。
- **合规校验**：判断一段 HTML 是否为 HyperFrames 规范的 composition。
- **GSAP 本地化（离线可用）**：定位随包携带的 `vendor/gsap/gsap.min.js`，把 HTML 里的 GSAP CDN 引用改写为项目内相对引用 `./gsap.min.js`，并按需把该文件复制进项目目录——让生成的 composition 在离线或 CDN 抖动时也能预览与渲染；复制失败（返回值 `false`）时由调用方退回 CDN 引用，保证「引用存在的文件」。
- **导出外部化（反向）**：导出/下载的是**单个 HTML 文件**，同目录没有 `gsap.min.js`，故 `externalizeGsapHtml()` 把 `./gsap.min.js` 换回固定版本的 CDN 地址（`GSAP_CDN_PINNED`），让导出物脱离项目目录也能独立打开（联网即可）。
- 本模块不注册任何 IPC，也不读写业务数据（`project.json`、字幕等一概不碰）；唯一的写盘行为是 GSAP 本地化的 `copyGsapIntoProject()`，它只把随包文件复制到调用方指定的目录。`BUILTIN_RESOURCES` 的字段是 **getter + 按包缓存**（`cachedPackRoots`，另有 `cachedChrome`；Node 探测另有 `cachedNode`），路径在首次访问时求值，之后复用缓存值，直到 `refreshPack(name, root?)` 按包清缓存（或 `refreshBuiltinResources()` 清全部）（详见 3.4 / 5）。**`cachedChrome` 是个例外：它只缓存「找到的」结果**（`if (cachedChrome) return cachedChrome;`），找不到时返回 `null` 但不写缓存——详见 3.1。

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
| `findLocalGsap()` | `() => string \| null` | 返回随包 `vendor/gsap/gsap.min.js` 的绝对路径；两个候选都不存在则 `null` |
| `hasGsapCdnRef(html)` | `(html: string) => boolean` | HTML 是否含 GSAP 的 CDN 引用（按 `GSAP_CDN_RE` 判定）；被 `localizeGsapHtml` 用作前置短路判断 |
| `referencesLocalGsap(html)` | `(html: string) => boolean` | HTML 是否引用了项目内的 `./gsap.min.js`（决定要不要把随包文件复制进项目目录） |
| `localizeGsapHtml(html)` | `(html: string) => string` | 把 HTML 里的 GSAP CDN 引用全部替换为 `./gsap.min.js`；空串 / 无 CDN 引用 / 随包文件缺失时**原样返回**（退化为在线加载） |
| `externalizeGsapHtml(html)` | `(html: string) => string` | 反向：把带引号的 `./gsap.min.js`（含 `gsap.min.js`、`/gsap.min.js`）换回固定版本 CDN `GSAP_CDN_PINNED`；用于单文件导出，也被 `projects.ts` 作者态三处用作**复制失败时的兜底**；**不依赖 `findLocalGsap`** |
| `copyGsapIntoProject(dir)` | `(dir: string) => boolean` | 幂等地把随包 `gsap.min.js` 复制进 `dir`；返回该目录是否可用于 `./gsap.min.js` 引用——`projects.ts` 的三个作者态写盘点用这个返回值决定要不要退回 CDN |

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

### 2.2 GSAP 本地化 / 导出外部化的内部常量（不导出）

| 名称 | 类型 | 取值 / 作用 |
| --- | --- | --- |
| `GSAP_LOCAL_CANDIDATES` | `(() => string)[]` | 两个**惰性求值**的候选路径工厂（见 3.7），依次为 `app.getAppPath()/vendor/gsap/gsap.min.js` 与 `process.resourcesPath/vendor/gsap/gsap.min.js` |
| `GSAP_CDN_RE` | `RegExp`（`g` + `i`） | `/(?:https?:)?\/\/(?:cdn\.jsdelivr\.net\/npm\/gsap\|unpkg\.com\/gsap\|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap)[^"'<>()\s]*/gi`——覆盖 jsDelivr / unpkg / cdnjs 三家、任意版本与路径后缀，并兼容协议相对写法 `//…` |
| `GSAP_LOCAL_REF` | `string` | `'./gsap.min.js'`，改写后的项目内相对引用（生成侧约定的唯一写法） |
| `GSAP_CDN_PINNED` | `string` | `'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'`，导出外部化时写回的**固定版本** CDN 地址；注释要求与 `vendor/gsap/gsap.min.js` 的版本必须一致——更新随包文件时必须同步改这一行 |

注意 `GSAP_CDN_RE` 带 `g` 标志，因此每次使用前都显式把 `GSAP_CDN_RE.lastIndex = 0`（`hasGsapCdnRef`、`localizeGsapHtml` 各一次），避免带状态正则跨次调用漏匹配。`externalizeGsapHtml` 用的是另写的 `gi` 正则字面量，每次调用重新创建、无跨调用的 `lastIndex` 残留。

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

### 3.7 GSAP 本地化与导出外部化（`findLocalGsap` / `hasGsapCdnRef` / `referencesLocalGsap` / `localizeGsapHtml` / `externalizeGsapHtml` / `copyGsapIntoProject`）

背景（源码注释）：生成的 HTML 原先按提示词从 CDN 引 GSAP，离线或 CDN 抖动时 `gsap` 未定义、时间轴不存在，导致预览静止、转视频可能失败。故随包携带一份 `vendor/gsap/gsap.min.js`（版本、来源、sha512/SHA256 与更新步骤见 `vendor/gsap/README.md`），在**生成 / 保存 / 预览 / 渲染**四个环节把 CDN 引用改写为 `./gsap.min.js` 并把文件复制到位。

反向的一步（导出）：导出物是**单个 HTML 文件**，随手放到别处会缺同目录的 `gsap.min.js`、动画完全不跑（本地化引入的回归），故 `externalizeGsapHtml()` 在导出时把相对引用换回固定版本 CDN。

**① 随包文件定位 `findLocalGsap()`**：按 `GSAP_LOCAL_CANDIDATES` 顺序逐个调用工厂并 `fs.existsSync`，命中即返回该绝对路径；全部未命中返回 `null`。

| 顺序 | 候选路径 | 说明 |
| --- | --- | --- |
| 1 | `path.join(app.getAppPath(), 'vendor', 'gsap', 'gsap.min.js')` | dev = 项目根；打包后 = `app.asar` 根（该目录由 `package.json` 的 `build.files` 白名单 `vendor/**/*` 打进 asar） |
| 2 | `path.join(process.resourcesPath \|\| '', 'vendor', 'gsap', 'gsap.min.js')` | 兜底：若将来改走 `extraResources` 投放，同样能命中 |

- 候选是**函数**而非字符串常量：每个候选各自包在 `try/catch` 中，异常只影响该候选；也不像 `BUILTIN_RESOURCES` 那样带缓存，每次调用都重新探测。

**② CDN 引用识别 `hasGsapCdnRef(html)`**：`String(html || '')` 归一后，先把 `GSAP_CDN_RE.lastIndex` 归零，再用 `.test()` 判断是否含 CDN 引用。它是 `localizeGsapHtml` 的前置短路条件（见 ④），也是本模块唯一在内部被复用的“识别”函数。

**③ 本地引用识别 `referencesLocalGsap(html)`**：正则 `/["'(]\.?\/?gsap\.min\.js/i` —— 只在引号或左括号之后匹配 `gsap.min.js`（允许 `./gsap.min.js`、`/gsap.min.js`、`gsap.min.js` 三种写法），用于决定要不要把随包文件复制进项目目录。

**④ 改写 `localizeGsapHtml(html)`**：

1. `raw = String(html || '')`；
2. **三重短路**：`if (!raw || !hasGsapCdnRef(raw) || !findLocalGsap()) return raw;` —— 空串、本来就没有 CDN 引用、随包文件缺失，三者任一命中都**原样返回**（退化为在线加载，不破坏现状）；
3. 否则把 `GSAP_CDN_RE.lastIndex` 归零后 `raw.replace(GSAP_CDN_RE, GSAP_LOCAL_REF)`，把所有 CDN 地址替换为 `./gsap.min.js`。

**⑤ 落位 `copyGsapIntoProject(dir)`**：

1. `findLocalGsap()` 为 `null` → 返回 `false`（调用方据此知道 `./gsap.min.js` 不可用）；
2. `dest = path.join(dir, 'gsap.min.js')`，先 `fs.mkdirSync(dir, { recursive: true })`；
3. **幂等**：`dest` 已存在且 `statSync(dest).size === statSync(src).size` → 直接返回 `true`（不重复写盘）；体积不一致（旧版本残留）则覆盖复制；
4. `fs.copyFileSync(src, dest)` 后返回 `true`；整段 `try/catch`，任何异常返回 `false`。

**返回值怎么被用**（调用方在 `projects.ts` 里补的兜底）：三个作者态写盘点（generate / modify / save-html）形态统一（变量名随调用点：generate 与 save-html 的目标目录是 `dir`、modify 是 `projDir`；保存分支被改写的变量是 `localHtml`）：

```ts
// 随包 gsap.min.js 不可用（缺失 / 未随包）时退回 CDN 引用，避免页面引用了 ./gsap.min.js 却缺文件、动画完全不跑
if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(dir)) html = hfEnv.externalizeGsapHtml(html);
```

即「引用本地 → 先复制；复制失败（`false`：随包缺失、目标目录不可写等）才把引用换回 CDN」——宁可联网也不能让页面引用一个不存在的文件。`project:preview-html` 与 `video.ts` 的渲染副本仍忽略该返回值（见第 5 节）。

**⑥ 导出外部化 `externalizeGsapHtml(html)`**（反向，`localizeGsapHtml` 的逆操作）：

1. 单步 `String(html || '').replace(/(["'])(?:\.\/|\/)?gsap\.min\.js\1/gi, '$1' + GSAP_CDN_PINNED + '$1')`；
2. 正则要求**成对的引号包裹**：只匹配 `"./gsap.min.js"` / `'./gsap.min.js'` / `"gsap.min.js"` / `"/gsap.min.js"` 这类写法，捕获组 `\1` 保留原引号风格；
3. **不依赖 `findLocalGsap()`**：随包文件缺失时也能换回 CDN（导出行为与本地环境无关）；
4. 只改文本、不落文件；无引号出现的提及（如纯文本里的 `gsap.min.js`）不会被改写。

> 往返一致性（源码作者当初实测所得）：对一份 `index.html` 执行 `localize → externalize` 后与原文件**逐字节一致**（其中 CDN 地址正是 `GSAP_CDN_PINNED`）；带引号的三种本地写法都能换回；无引号出现的 `gsap.min.js` 提及不改写；已本地化的 HTML 再次 `localize` 幂等。该结论来自正则与引号捕获的构造，随包 GSAP 版本未变时依然成立。

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
| `src/main/video.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.ffmpeg`、`BUILTIN_RESOURCES.ffprobe`、`BUILTIN_RESOURCES.chromeShell`、`isHyperframesComposition`、`findHyperframesCli`、`findNode`（**返回值是 `{ cmd, env }`；`cmd` 交给 `spawn`，`env` 必须并入子进程环境**）、`findFfmpegBin`，以及 GSAP 本地化的 `localizeGsapHtml` / `referencesLocalGsap` / `copyGsapIntoProject`（就地渲染：本地化产物是**项目目录**里的 `gsap.min.js`，入口 HTML 在 `.render-tmp/` 里用 `../gsap.min.js` 引用它）。其中 `chromeShell` 的用法值得单独记一笔：它被赋给子进程环境的 `PRODUCER_HEADLESS_SHELL_PATH`，**渲染本身与「渲染前现场量 GSAP 时间轴」这两步共用同一个解析结果**（量测那步就是拿 `env.PRODUCER_HEADLESS_SHELL_PATH` 当 `chrome` 参数去跑 `--headless --dump-dom`）；因此这里拿到 `null` 时，量测会被跳过、日志写 `chrome=无`（见 3.1 与本文件末节的故障说明） |
| `src/main/projects.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.ffmpeg`、`isHyperframesComposition`（HTML 生成/修改/保存侧的合规判断），GSAP 本地化的 `localizeGsapHtml` / `referencesLocalGsap` / `copyGsapIntoProject`（生成 / 修改 / 保存 / 预览四个写盘环节；其中**前三个用 `copyGsapIntoProject` 的返回值做「复制失败即退回 CDN」兜底**），以及 `externalizeGsapHtml`（兜底改写 + `project:download-html` 的导出改写） |
| `src/main/ttsAlign.ts` | `BUILTIN_RESOURCES`（取 `ffmpeg` / `ffprobe`） |
| `src/main/voice.ts` | `import { BUILTIN_RESOURCES } from './hfEnv'`：`voice:create` 创建克隆音色时取 `BUILTIN_RESOURCES.ffmpeg` / `BUILTIN_RESOURCES.ffprobe`，把本地参考音频裁成前 15 秒 / 24 kHz / 单声道 `pcm_s16le` wav（见 [voice.ts.md](./voice.ts.md) §4.1.1） |
| `src/main/whisper.ts` | `BUILTIN_RESOURCES`（取 `ffmpeg`；并把它当作 `resolveCliPath()` 的第二候选根——whisper 现在**随安装包**，首选 `<resources>/whisper`，`root` 只是旧布局兜底） |
| `src/main/runtime.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，**主要用 `refreshPack(name, root)`**（探测到某包就绪、以及解包完成时，把该包目录交给 `hfEnv` 重算该包缓存）；`refreshBuiltinResources(...)` 与 `packReady(...)` 也已导出但当前调用点在 `runtime.ts` 内以 `refreshPack` 为主 |

`findLocalGsap` 仅在本模块内部被 `localizeGsapHtml` / `copyGsapIntoProject` 使用；`hasGsapCdnRef` 现由 `localizeGsapHtml` 调用——**本模块已无「零调用点」的导出**。

`src/main/index.ts` 只在注释中登记本模块，并不 import 它——因为本模块不注册 IPC。

**被引用方注入的环境变量（由 `src/main/video.ts` 设置，非本文件）**：`ELECTRON_RUN_AS_NODE`（仅当 `findNode()` 走 ① 时，值来自本模块返回的 `env`）、`HYPERFRAMES_FFMPEG_PATH`、`HYPERFRAMES_FFPROBE_PATH`、`PRODUCER_HEADLESS_SHELL_PATH`，以及把 `findFfmpegBin()` 结果前置进 `PATH`。

**本模块读取的环境变量**：`HYPERFRAMES_CLI`、`NVM_SYMLINK`、`LOCALAPPDATA`。

## 5. 注意事项与实现要点

- **路径解析是「按包缓存 + 可失效」而非一次性快照**：`BUILTIN_RESOURCES` 的字段都是 getter，`ffmpeg` 一族与 `hfCli` 一族各自经 `resolvePackRoot(name)` 解析并按包写入 `cachedPackRoots`；候选依次是「该包已解到 `<userData>/runtime/<包名>/`（需 `ok.json`）」→「旧版整体包目录（`current.json` + `ok.json`）」→「`process.resourcesPath` / 开发态项目根 `resources`」。`root` 只作后两者的兜底。运行环境包解包完成或切换目录时由调用方 `refreshPack(name, root?)` 失效该包缓存（并清 `cachedChrome`，hyperframes 时另清 `cachedNode`），`refreshBuiltinResources(root?)` 则一次清两个包 + 两个探测缓存（兼容保留）。
- **平台假设为 Windows**：路径与文件名硬编码 `node.exe`、`ffmpeg.exe`、`ffprobe.exe`、`chrome-headless-shell.exe`、`where.exe`、`C:\Program Files\nodejs`，非 Windows 平台这些分支会全部落空。
- **只做“存在 + 能跑”的轻量验证**：所有探测都是 `existsSync` 加 `spawnSync(..., ['-v'])` 的 `status === 0` 判定，不解析版本（`resolveNodePath`、`findHyperframesCli`、`findFfmpegBin` 均不校验版本）；**唯一例外是 `findNode`**——① 与 ③ 分支都解析主版本并要求 >= 22。
- **`findNode` 的版本门槛覆盖两条分支**：① 用 `-e` 探针取 `process.versions.node` 并要求 >= 22；② 用 `node -v` 的输出判 >= 22。**原先的 ② 「随包 `resources/node/node.exe`」已随该目录整体删除**——它当年不校验版本，且在打包态本来就够不着（`build.files` / `extraResources` 都不带 `resources/**`，只有 dev 的 `resolveRoot()` 指向项目根 `resources` 才会命中）。
- **`findNode` 的返回值必须成对使用**：只取 `cmd` 而丢掉 `env` 会让 `electron.exe` 以应用身份启动（渲染直接失败）。这是本模块唯一「返回值不只是路径」的函数，`video.ts` 用 `{ ...process.env, ...nodeRt.env }` 合并它。
- **① 的复用依赖 `RunAsNode` 熔丝**：熔丝默认开启；一旦在 `build.electronFuses` 里关掉，探针（`-e`）失败并静默回落到 ② 系统 Node，不报错但那时必须重新提供 Node（见 3.4 的注）。探针刻意不用 `-v`，因为 `-v` 打印的是 Electron 版本（44 >= 22），会把「不可复用」误判成可用。
- **探测失败一律返回 `null`，不抛出**：`chromeShell` 的遍历异常被 `catch` 吞掉，`where.exe` 分支同样被 `catch` 包住，`findNode` 的 ① 探针也包在 `try/catch` 里；调用方必须自行处理 `null` 并给出可读提示。
- **`cachedChrome` 是「只缓存成功」的那一个**（2026-10 修正，别再退回旧写法）：模块里三个探测缓存语义**并不相同**——`cachedPackRoots` / `cachedNode` 把「确实没有」的结论也缓存下来（包根缓存空串、Node 缓存 `null`），靠 `refreshPack()` / `refreshBuiltinResources()` 失效；而 `cachedChrome` **只在找到时才写**，找不到返回 `null` 而不写缓存。原因：`chrome-headless-shell` 完全可能在「第一次被问到」之后才落到盘上（运行环境包是异步解包的），把 `null` 钉死会让渲染前的时间轴量测永久失效（症状是 `video-duration.log` 里 `chrome=无`、量不到时间轴、成片被最长媒体顶长）；而 Node 的探测要 `spawnSync` 一次 `electron.exe`（200~400ms、阻塞主进程），才需要「一次会话只探一次」的强缓存。
- **`BUILTIN_RESOURCES.chromeShell` 的消费面是「渲染 + 渲染前量测」两处，共用一次解析**：`video.ts` 取一次 `hfEnv.BUILTIN_RESOURCES.chromeShell` 写进 `env.PRODUCER_HEADLESS_SHELL_PATH`，随后既交给 HyperFrames CLI 渲染（避免它去 `.cache` 重新下载 Chrome），也交给自己的 `measureTimelineDuration()` 跑无头浏览器量 GSAP 时间轴（`--virtual-time-budget=5000 --dump-dom`）。所以「这里返回 `null`」的后果有两个：CLI 侧可能重新下载 / 找不到浏览器，应用侧则完全量不到时间轴。
- **可执行路径都是绝对路径**：源码注释强调“一律返回绝对路径”，以规避 `spawn('node')` 在部分环境下 ENOENT。
- **DFS 不是纯递归**：`stack.pop()` 为后进先出，命中顺序取决于目录读取顺序；只要存在一个匹配的 `chrome-headless-shell.exe` 即可，不保证选中最外层或版本最新的那个。
- **合规校验是启发式**：仅三个正则文本匹配，不解析 DOM、不校验 `__timelines` 的实际结构，也不校验 GSAP 是否真的被加载；因此可能出现“文本合规但渲染失败”的情况。
- **本模块返回「怎么跑」的只有 Node**：`findNode()` 除路径外还给出必须注入的 `env`；CLI / ffmpeg / chrome-headless-shell 仍只返回路径，是否可用、如何拼命令、如何注入环境变量全部由 `src/main/video.ts` 决定。
- **模块已声明不再是“纯函数”（已修正）**：源码头部注释现为「环境探测 + HyperFrames 资源定位 + GSAP 本地化（无 IPC 注册，无业务状态）」，并额外写明「本模块不再是『纯函数』—— GSAP 本地化那组会读写文件（只复制随包的 gsap.min.js，不碰业务数据）」。GSAP 段确实带 `statSync` / `mkdirSync` / `copyFileSync` 等文件系统操作，与注释一致；「无 IPC 注册」「无业务状态」「不碰业务数据」仍然成立。
- **随包文件缺失时静默退化**：`localizeGsapHtml` 直接原样返回（HTML 继续引 CDN，在线时照常工作），`copyGsapIntoProject` 返回 `false`。**返回值不再被普遍忽略**：`projects.ts` 的三个作者态写盘点（generate / modify / save-html）在复制失败时会把引用换回 CDN（`externalizeGsapHtml`），因此落盘结果永远有一个可用的 GSAP 来源；仅 `project:preview-html` 与 `video.ts` 的渲染副本仍忽略返回值（不会报错、也无提示）。
- **导出外部化只认带引号的写法**：`/(["'])(?:\.\/|\/)?gsap\.min\.js\1/gi` 要求成对引号；若写成无引号的 `src=gsap.min.js`，导出时不会被换回 CDN（导出物仍缺文件）。它也不判断“这是不是真的 script 引用”——任何带引号的 `"gsap.min.js"` 提及（含注释、纯文本）都会被替换成 CDN 地址。
- **两个方向的取舍**：项目内优先本地引用（离线可预览/渲染），导出物一律换回固定版本 CDN（`GSAP_CDN_PINNED`，单文件即可独立打开）。二者互补：只本地化会让导出物缺 `gsap.min.js` 而动画不跑；只走 CDN 会让离线预览/渲染失败。作者态三处还多一层保险：本地复制失败时**也**退回 CDN——宁可联网也不能引用一个不存在的文件。
- **兜底只在作者态生效（预览 / 渲染仍忽略返回值）**：`project:preview-html` 与 `video.ts` 的渲染副本不做这层兜底（按作者说明：预览副本与原件引用一致，属同状态）。若出现「`gsap.min.js` 复制失败、但 HTML 本身写得进去」的偏门情形，作者态落盘的是 CDN 引用，而预览副本在 `localizeGsapHtml` 之后会重新变成 `./gsap.min.js`（复制同样失败），预览便可能取不到该文件。
- **`GSAP_CDN_PINNED` 是手工同步点**：它写死 `@3.14.2`，必须与 `vendor/gsap/gsap.min.js` 的版本一致；升级随包 GSAP 时若忘记改这一行，导出物会引到与随包版本不同的 GSAP（当前能跑，但版本会悄悄漂移）。
- **CDN 覆盖面是白名单式**：只识别 jsDelivr / unpkg / cdnjs 三家的 `gsap` 路径。其他 CDN（自建镜像、`esm.sh`、其他包名路径）既不会被 `localizeGsapHtml` 改写，也不会被判定为“可本地化”，随包文件不会被复制。
- **幂等判据是“体积一致”**：`copyGsapIntoProject` 只比较字节数。若项目目录里已有一份**体积恰好相同**的旧版 `gsap.min.js`，不会被刷新；升级随包版本时若体积恰好相同，需要手动清理项目目录里的旧副本。
- **正则尾部字符集决定截断位置**：`[^"'<>()\s]*` 在引号 / 空格 / 括号处停止，因此 `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js` 这类带路径的地址会被整体替换，`?ver=1` 之类的查询串也在替换范围内；但写成 `src=gsap.min.js`（无引号）时不会被 `referencesLocalGsap` 的 `/["'(]…/` 命中。
- **改写与复制是两件事**：`localizeGsapHtml` 只管改文本、不落任何文件；`copyGsapIntoProject` 只管复制文件、不看 HTML。“改谁、复制到哪”由 `projects.ts` / `video.ts` 决定（例如预览与渲染都只改副本，不动用户原件）。
- **本地化只覆盖 GSAP**：项目 HTML 里其它 CDN 引用（若有）不受 `localizeGsapHtml` 影响，离线能力取决于这些资源是否另有本地来源。
