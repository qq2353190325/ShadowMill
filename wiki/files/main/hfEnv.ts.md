# src/main/hfEnv.ts

> 内置依赖定位与环境探测：chrome-headless-shell / node / ffmpeg / HyperFrames CLI；另有 GSAP 本地化（离线可用）与导出外部化辅助

- **所在目录**：src/main/
- **类型**：环境探测 + GSAP 本地化辅助模块（无 IPC 注册、无业务依赖）
- **规模**：212 行
- **对外导出**：常量 `BUILTIN_RESOURCES`，函数 `findHyperframesCli`、`resolveNodePath`、`findNode`、`findFfmpegBin`、`isHyperframesComposition`、`findLocalGsap`、`hasGsapCdnRef`、`referencesLocalGsap`、`localizeGsapHtml`、`externalizeGsapHtml`、`copyGsapIntoProject`

## 1. 作用与职责

- **资源根解析**：区分开发版与打包版两种资源根，并一次性算出内置依赖的全部绝对路径。
- **可执行文件探测**：为 HyperFrames 渲染链寻找 Chrome headless-shell、Node（要求 >= 22）、FFmpeg（WinGet 安装目录）。
- **CLI 入口探测**：定位 `hyperframes.mjs`，内置优先、环境变量兜底。
- **合规校验**：判断一段 HTML 是否为 HyperFrames 规范的 composition。
- **GSAP 本地化（离线可用）**：定位随包携带的 `vendor/gsap/gsap.min.js`，把 HTML 里的 GSAP CDN 引用改写为项目内相对引用 `./gsap.min.js`，并按需把该文件复制进项目目录——让生成的 composition 在离线或 CDN 抖动时也能预览与渲染；复制失败（返回值 `false`）时由调用方退回 CDN 引用，保证「引用存在的文件」。
- **导出外部化（反向）**：导出/下载的是**单个 HTML 文件**，同目录没有 `gsap.min.js`，故 `externalizeGsapHtml()` 把 `./gsap.min.js` 换回固定版本的 CDN 地址（`GSAP_CDN_PINNED`），让导出物脱离项目目录也能独立打开（联网即可）。
- 本模块不注册任何 IPC，也不读写业务数据（`project.json`、字幕等一概不碰）；唯一的写盘行为是 GSAP 本地化的 `copyGsapIntoProject()`，它只把随包文件复制到调用方指定的目录。`BUILTIN_RESOURCES` 在模块加载时（IIFE）求值一次并缓存。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `BUILTIN_RESOURCES` | 常量对象（IIFE 结果） | 字段：`root`、`node`、`ffmpegBin`、`ffmpeg`、`ffprobe`、`hfCli`、`hivePlayer`、`chromeShell` |
| `findHyperframesCli()` | `() => string \| null` | 返回 `hyperframes.mjs` 绝对路径或 `null` |
| `resolveNodePath()` | `() => string \| null` | 返回 Node 可执行文件真实绝对路径或 `null` |
| `findNode()` | `() => string \| null` | 返回可用 Node 绝对路径或 `null`（内置优先，含 >= 22 版本判断） |
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
| `root` | `string` | `app.isPackaged` 为真时 `process.resourcesPath`；否则 `path.join(app.getAppPath(), 'resources')` |
| `node` | `string` | `<root>/node/node.exe` |
| `ffmpegBin` | `string` | `<root>/ffmpeg/bin` |
| `ffmpeg` | `string` | `<root>/ffmpeg/bin/ffmpeg.exe` |
| `ffprobe` | `string` | `<root>/ffmpeg/bin/ffprobe.exe` |
| `hfCli` | `string` | `<root>/hyperframes/node_modules/hyperframes/bin/hyperframes.mjs` |
| `hivePlayer` | `string` | `<root>/hyperframes/node_modules/hyperframes/dist/hyperframes-player.global.js` |
| `chromeShell` | `string \| null` | 在 `<root>/hyperframes/chrome/chrome-headless-shell` 子树中递归找出的 `chrome-headless-shell.exe` |

开发版资源根为项目根 `resources`（以 `app.getAppPath()` 为基准），打包后由 electron-builder 的 `extraResources`（`package.json` 中 `from: "resources"` → `to: "."`）投放到 `resources` 目录，故两种情形的子路径结构一致。

### 2.2 GSAP 本地化 / 导出外部化的内部常量（不导出）

| 名称 | 类型 | 取值 / 作用 |
| --- | --- | --- |
| `GSAP_LOCAL_CANDIDATES` | `(() => string)[]` | 两个**惰性求值**的候选路径工厂（见 3.7），依次为 `app.getAppPath()/vendor/gsap/gsap.min.js` 与 `process.resourcesPath/vendor/gsap/gsap.min.js` |
| `GSAP_CDN_RE` | `RegExp`（`g` + `i`） | `/(?:https?:)?\/\/(?:cdn\.jsdelivr\.net\/npm\/gsap\|unpkg\.com\/gsap\|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap)[^"'<>()\s]*/gi`——覆盖 jsDelivr / unpkg / cdnjs 三家、任意版本与路径后缀，并兼容协议相对写法 `//…` |
| `GSAP_LOCAL_REF` | `string` | `'./gsap.min.js'`，改写后的项目内相对引用（生成侧约定的唯一写法） |
| `GSAP_CDN_PINNED` | `string` | `'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'`，导出外部化时写回的**固定版本** CDN 地址；注释要求与 `vendor/gsap/gsap.min.js` 的版本必须一致——更新随包文件时必须同步改这一行 |

注意 `GSAP_CDN_RE` 带 `g` 标志，因此每次使用前都显式把 `GSAP_CDN_RE.lastIndex = 0`（`hasGsapCdnRef`、`localizeGsapHtml` 各一次），避免带状态正则跨次调用漏匹配。`externalizeGsapHtml` 用的是另写的 `gi` 正则字面量，每次调用重新创建、无跨调用的 `lastIndex` 残留。

## 3. 关键流程 / 算法

### 3.1 chrome-headless-shell 定位（模块加载时执行）

1. `base = <root>/hyperframes/chrome/chrome-headless-shell`；`base` 不存在则 `chromeShell` 保持 `null`。
2. 用数组 `stack` 做栈式深度优先遍历：`stack.pop()` 取当前目录。
3. 对 `fs.readdirSync(cur, { withFileTypes: true })` 的每个条目：目录则 `push(path.join(cur, e.name))`；文件名匹配 `/^chrome-headless-shell\.exe$/i` 则记录绝对路径并 `break` 内层循环。
4. 整个遍历包在 `try/catch` 中，任何异常（如权限、竞态）都把 `chromeShell` 置为 `null`，不影响其余字段。

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

1. 内置 Node 优先（打包分发免装环境）：`BUILTIN_RESOURCES.node` 存在则 `spawnSync(..., ['-v'])`，`status === 0` 即返回它。
2. 否则 `spawnSync('node', ['-v'])`；`status === 0` 时取 `stdout`，`trim()` 后去掉前缀 `v`，取首个 `.` 前的段做 `parseInt(..., 10)`。
3. 当 `major` 非 `NaN` 且 `major >= 22` 时，返回 `resolveNodePath()` 的结果（有绝对路径就用绝对路径）。
4. 其余情况（无系统 Node、或版本低于 22）同样返回 `resolveNodePath()`——源码注释说明“极端情况为 `null` 时下面会报错”，即由调用方处理 `null`。

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

- 候选是**函数**而非字符串常量：每个候选各自包在 `try/catch` 中，异常只影响该候选；也不像 `BUILTIN_RESOURCES` 那样在模块加载期求值并缓存，每次调用都重新探测。

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

> 往返一致性（源码作者实测）：对内置示例 `video-projects/walk-video|person-video/index.html` 执行 `localize → externalize` 后与原文件**逐字节一致**（示例里的 CDN 地址正是 `GSAP_CDN_PINNED`）；带引号的三种本地写法都能换回；无引号出现的 `gsap.min.js` 提及不改写；已本地化的 HTML 再次 `localize` 幂等。

## 4. 依赖与协作

**import**

| 来源 | 引入内容 |
| --- | --- |
| `node:path` | `path`（`join`） |
| `node:fs` | `fs`（`existsSync`、`readdirSync`、`statSync`、`mkdirSync`、`copyFileSync`） |
| `node:child_process` | `spawnSync` |
| `electron` | `app`（`isPackaged`、`getAppPath`） |

**被谁引用**

| 引用方 | 使用的导出 |
| --- | --- |
| `src/main/video.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.hivePlayer`、`BUILTIN_RESOURCES.ffmpeg`、`BUILTIN_RESOURCES.ffprobe`、`BUILTIN_RESOURCES.chromeShell`、`isHyperframesComposition`、`findHyperframesCli`、`findNode`、`findFfmpegBin`，以及 GSAP 本地化的 `localizeGsapHtml` / `referencesLocalGsap` / `copyGsapIntoProject`（作用于渲染工作目录里的 HTML 副本） |
| `src/main/projects.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.ffmpeg`、`isHyperframesComposition`（HTML 生成/修改/保存侧的合规判断），GSAP 本地化的 `localizeGsapHtml` / `referencesLocalGsap` / `copyGsapIntoProject`（生成 / 修改 / 保存 / 预览四个写盘环节；其中**前三个用 `copyGsapIntoProject` 的返回值做「复制失败即退回 CDN」兜底**），以及 `externalizeGsapHtml`（兜底改写 + `project:download-html`、`project:download-file` 的 `.html/.htm` 导出） |
| `src/main/ttsAlign.ts` | `BUILTIN_RESOURCES`（取 `ffmpeg` / `ffprobe`） |
| `src/main/whisper.ts` | `BUILTIN_RESOURCES`（取其内的 `ffmpeg`） |

`findLocalGsap` 仅在本模块内部被 `localizeGsapHtml` / `copyGsapIntoProject` 使用；`hasGsapCdnRef` 现由 `localizeGsapHtml` 调用——**本模块已无「零调用点」的导出**。

`src/main/index.ts` 只在注释中登记本模块，并不 import 它——因为本模块不注册 IPC。

**被引用方注入的环境变量（由 `src/main/video.ts` 设置，非本文件）**：`HYPERFRAMES_FFMPEG_PATH`、`HYPERFRAMES_FFPROBE_PATH`、`PRODUCER_HEADLESS_SHELL_PATH`，以及把 `findFfmpegBin()` 结果前置进 `PATH`。

**本模块读取的环境变量**：`HYPERFRAMES_CLI`、`NVM_SYMLINK`、`LOCALAPPDATA`。

## 5. 注意事项与实现要点

- **`root` 在模块加载时定值**：`app.isPackaged` 与 `app.getAppPath()` 只在 IIFE 中求值一次；运行期改变工作目录或打包状态不会刷新它。
- **平台假设为 Windows**：路径与文件名硬编码 `node.exe`、`ffmpeg.exe`、`ffprobe.exe`、`chrome-headless-shell.exe`、`where.exe`、`C:\Program Files\nodejs`，非 Windows 平台这些分支会全部落空。
- **只做“存在 + 能跑”的轻量验证**：所有探测都是 `existsSync` 加 `spawnSync(..., ['-v'])` 的 `status === 0` 判定，不解析版本（`resolveNodePath`、`findHyperframesCli`、`findFfmpegBin` 均不校验版本）。
- **内置 Node 未做 >= 22 校验**：`findNode` 对 `BUILTIN_RESOURCES.node` 只验证能否执行；>= 22 的版本门槛只在系统 Node 分支生效。
- **探测失败一律返回 `null`，不抛出**：`chromeShell` 的遍历异常被 `catch` 吞掉，`where.exe` 分支同样被 `catch` 包住；调用方必须自行处理 `null` 并给出可读提示。
- **返回的都是绝对路径**：源码注释强调“一律返回绝对路径”，以规避 `spawn('node')` 在部分环境下 ENOENT。
- **DFS 不是纯递归**：`stack.pop()` 为后进先出，命中顺序取决于目录读取顺序；只要存在一个匹配的 `chrome-headless-shell.exe` 即可，不保证选中最外层或版本最新的那个。
- **合规校验是启发式**：仅三个正则文本匹配，不解析 DOM、不校验 `__timelines` 的实际结构，也不校验 GSAP 是否真的被加载；因此可能出现“文本合规但渲染失败”的情况。
- **此处只负责“找到路径”**：是否可用、如何组装命令、如何注入 `env` 全部由 `src/main/video.ts` 决定。
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
- **与「内置示例未完全离线」的关系**：内置示例 `video-projects/*/index.html` 除 GSAP 外仍从 CDN 引 `@hyperframes/core` 与 `@hyperframes/shader-transitions`，本轮只本地化了 GSAP；示例仅在渲染路径由 CLI 自带运行时兜底。
