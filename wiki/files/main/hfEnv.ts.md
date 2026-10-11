# src/main/hfEnv.ts

> 内置依赖定位与环境探测：chrome-headless-shell / node / ffmpeg / HyperFrames CLI

- **所在目录**：src/main/
- **类型**：环境探测模块（纯函数，无 IPC 注册、无业务依赖）
- **规模**：138 行
- **对外导出**：常量 `BUILTIN_RESOURCES`，函数 `findHyperframesCli`、`resolveNodePath`、`findNode`、`findFfmpegBin`、`isHyperframesComposition`

## 1. 作用与职责

- **资源根解析**：区分开发版与打包版两种资源根，并一次性算出内置依赖的全部绝对路径。
- **可执行文件探测**：为 HyperFrames 渲染链寻找 Chrome headless-shell、Node（要求 >= 22）、FFmpeg（WinGet 安装目录）。
- **CLI 入口探测**：定位 `hyperframes.mjs`，内置优先、环境变量兜底。
- **合规校验**：判断一段 HTML 是否为 HyperFrames 规范的 composition。
- 本模块不注册任何 IPC，也不读写业务数据；`BUILTIN_RESOURCES` 在模块加载时（IIFE）求值一次并缓存。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `BUILTIN_RESOURCES` | 常量对象（IIFE 结果） | 字段：`root`、`node`、`ffmpegBin`、`ffmpeg`、`ffprobe`、`hfCli`、`hivePlayer`、`chromeShell` |
| `findHyperframesCli()` | `() => string \| null` | 返回 `hyperframes.mjs` 绝对路径或 `null` |
| `resolveNodePath()` | `() => string \| null` | 返回 Node 可执行文件真实绝对路径或 `null` |
| `findNode()` | `() => string \| null` | 返回可用 Node 绝对路径或 `null`（内置优先，含 >= 22 版本判断） |
| `findFfmpegBin()` | `() => string \| null` | 返回 WinGet 安装的 Gyan.FFmpeg 的 `bin` 目录或 `null` |
| `isHyperframesComposition(raw)` | `(raw: string) => boolean` | 三个正则全部命中才返回 `true` |

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

## 4. 依赖与协作

**import**

| 来源 | 引入内容 |
| --- | --- |
| `node:path` | `path`（`join`） |
| `node:fs` | `fs`（`existsSync`、`readdirSync`） |
| `node:child_process` | `spawnSync` |
| `electron` | `app`（`isPackaged`、`getAppPath`） |

**被谁引用**

| 引用方 | 使用的导出 |
| --- | --- |
| `src/main/video.ts` | 以 `import * as hfEnv from './hfEnv'` 整体引入，使用 `BUILTIN_RESOURCES.hivePlayer`、`BUILTIN_RESOURCES.ffmpeg`、`BUILTIN_RESOURCES.ffprobe`、`BUILTIN_RESOURCES.chromeShell`、`isHyperframesComposition`、`findHyperframesCli`、`findNode`、`findFfmpegBin` |
| `src/main/projects.ts` | `BUILTIN_RESOURCES`、`isHyperframesComposition`（HTML 生成/修改侧的合规判断） |
| `src/main/ttsAlign.ts` | `BUILTIN_RESOURCES`（取 `ffmpeg` / `ffprobe`） |
| `src/main/whisper.ts` | `BUILTIN_RESOURCES`（取其内的 `ffmpeg`） |

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
