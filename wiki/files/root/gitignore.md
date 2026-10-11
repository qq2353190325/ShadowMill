# .gitignore

> git 忽略规则：依赖、大体积内置运行时、构建产物、日志与编辑器垃圾

- **位置**：工程根
- **类型**：git 忽略规则
- **规模**：28 行

## 1. 作用与职责

- 决定哪些文件**不进版本库**，控制仓库体积与噪声。
- 全文共 **9 条实际规则**（其余为分组注释），按「依赖 / 构建产物 / 日志 / 编辑器系统 / 临时缓存」五类分组。
- 核心取舍：**凡是可由命令重新生成的、或体积过大的二进制运行时，一律不入库**；凡是源码、配置、用户项目数据则保留跟踪。

## 2. 内容详解

### 2.1 依赖

| 规则 | 被忽略的内容 | 原因 |
| --- | --- | --- |
| `node_modules/` | npm 安装的全部依赖目录 | 可由 `package.json` + 锁文件完整还原，且文件数以万计；入库会让仓库体积暴涨、diff 噪声淹没真实改动 |

### 2.2 打包内置运行时

| 规则 | 被忽略的内容 | 原因 |
| --- | --- | --- |
| `resources/` | `resources/` 目录全部内容——依据文件内注释，即**打包内置运行时**：ffmpeg / node / hyperframes + chrome-headless-shell | 这是**大体积二进制**（注释原文：「体积大不进 git」）。它们由打包流程或下载脚本提供，通过 `package.json` 的 `extraResources` 复制进安装目录，而不是作为源码分发 |

注释原文（第 5 行）：`# 打包内置运行时（ffmpeg / node / hyperframes + chrome-headless-shell，体积大不进 git）`

### 2.3 构建产物

| 规则 | 被忽略的内容 | 原因 |
| --- | --- | --- |
| `dist/` | **electron-builder** 的输出：安装包 / 便携版 / 缓存（注释原文如此） | 与 `package.json` 的 `build.directories.output: "dist"` 对应；产出物可重新生成，且单文件动辄上百 MB |
| `out/` | **electron-vite** 的三端构建输出（`out/main`、`out/preload`、`out/renderer`） | 与 `package.json` 的 `main: "out/main/index.js"` 对应；`npm run build` 可随时重建 |

### 2.4 日志

| 规则 | 被忽略的内容 | 原因 |
| --- | --- | --- |
| `*.log` | 所有以 `.log` 结尾的文件 | 运行日志属本机状态，含时间戳/绝对路径，提交无意义 |
| `npm-debug.log*` | npm 崩溃调试日志（含 `npm-debug.log.1` 这类轮转文件） | 由 `*` 通配覆盖带后缀的轮转文件 |
| `yarn-error.log*` | Yarn 报错日志（含轮转文件） | 同上，兼容可能使用 Yarn 的环境 |

### 2.5 编辑器 / 系统

| 规则 | 被忽略的内容 | 原因 |
| --- | --- | --- |
| `.vscode/` | VS Code 工作区目录（`settings.json`、`launch.json` 等） | 大多属个人偏好，含本机路径 |
| `.idea/` | JetBrains 系列 IDE 的项目目录 | 同上 |
| `Thumbs.db` | Windows 资源管理器生成的缩略图缓存 | 系统自动生成，无意义 |
| `Desktop.ini` | Windows 文件夹视图配置文件 | 系统自动生成，无意义 |

### 2.6 临时 / 缓存

| 规则 | 被忽略的内容 | 原因 |
| --- | --- | --- |
| `.tmp/` | 工程内 `.tmp` 目录（目录级） | 临时中间产物；注意写法带尾斜杠，**只匹配目录** |
| `*.tmp` | 任意位置的 `.tmp` 文件（文件级） | 兜住散落在各处的临时文件；与上一条互补（一条管目录、一条管文件） |

## 3. 关键流程或约定

### 3.1 分组结构

文件内用 5 行分隔注释把规则分组，便于后续新增：

```
# ---------- 依赖 ----------
# ---------- 构建产物 ----------
# ---------- 日志 ----------
# ---------- 编辑器 / 系统 ----------
# ---------- 临时 / 缓存 ----------
```

### 3.2 匹配语义约定

- **带尾斜杠**（`node_modules/`、`resources/`、`dist/`、`out/`、`.vscode/`、`.idea/`、`.tmp/`）→ 只匹配**目录**，不会误伤同名文件。
- **前缀通配**（`npm-debug.log*`、`yarn-error.log*`）→ 覆盖轮转后的多份日志。
- **后缀通配**（`*.log`、`*.tmp`）→ 匹配**任意深度**的同后缀文件（无 `/` 的模式在各级目录生效）。
- 全文**没有使用否定规则 `!`**，也没有限定目录前缀（如 `/dist/`）——即所有规则在整棵工作树范围内生效，而非仅根目录。

### 3.3 「不入库 → 从哪来」的闭环

| 被忽略项 | 运行/打包时的来源 |
| --- | --- |
| `node_modules/` | `npm install`（依赖清单见 `package.json` 的 `dependencies` / `devDependencies`） |
| `out/` | `npm run build`（即 `electron-vite build`） |
| `dist/` | `npm run pack`（`electron-builder --dir`）或 `npm run dist`（`electron-builder --win`） |
| `resources/` | 预先准备的本地运行时目录；打包时由 `build.extraResources` 的 `{ from: "resources", to: "." }` 复制进安装目录 |

## 4. 与其他文件的关系

| 关联文件 | 关系 |
| --- | --- |
| `package.json` | `build.directories.output: "dist"` 对应 `dist/` 规则；`extraResources.from: "resources"` 对应 `resources/` 规则；`main: "out/main/index.js"` 对应 `out/` 规则；`dependencies` / `devDependencies` 对应 `node_modules/` 规则 |
| `electron.vite.config.ts` | 其构建输出即为被忽略的 `out/` |
| `src/**`、`wiki/**`、`README.md`、`video-projects/` | **未**被本文件忽略，属正常跟踪内容 |

## 5. 注意事项与实现要点

- **`resources/` 进 git 会让仓库爆体积**：该目录装的是 ffmpeg、node、hyperframes + chrome-headless-shell 等成套二进制运行时，单个可执行文件就可达数十至上百 MB，且是压缩过的二进制、git 无法有效增量存储——一旦提交，历史里每一版都会永久留存，克隆与拉取成本不可逆。
- **忽略的连带影响**：`resources/` 不入库意味着**新环境克隆后应用无法直接运行**（缺 ffmpeg 等），必须另行分发或下载这些运行时。
- **忽略 ≠ 不打包**：`resources/` 被 git 忽略，但**仍然会进入安装包**（通过 `extraResources`）。版本控制范围与分发范围是两件事，不要混淆。
- **`out/` 与 `dist/` 职责不同**：`out/` 是 electron-vite 的三端编译产物（应用代码），`dist/` 是 electron-builder 的安装包/解包目录（含 `out/` 与 `resources/` 的最终形态）。
- **无 `!` 否定规则**：如果将来需要把 `resources/` 里的**小体积必要文件**（如某个配置或脚本）纳入版本库，必须新增 `!resources/xxx` 这样的否定规则，并注意 git 的「已忽略目录内的文件无法用 `!` 重新包含」限制——需要先不忽略该目录本身。
- **`video-projects/` 未被忽略**：用户项目数据会被 git 跟踪，同时也在 `package.json` 的 `build.files` 白名单中；分发前应确认其中不含私人素材。
- **无锁文件规则**：本文件**没有**忽略 `package-lock.json` 之类的锁文件，即锁文件应当入库以保证依赖可复现。
- **`.tmp/` 与 `*.tmp` 成对出现**：前者管目录、后者管文件，删掉任一条都会留下漏网之鱼。
