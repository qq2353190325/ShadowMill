# package.json

> 工程根 npm 清单：脚本入口 + 依赖 + electron-builder 打包配置

- **位置**：工程根
- **类型**：npm 清单（同时承载 electron-builder 的 `build` 段）
- **规模**：73 行

## 1. 作用与职责

- **项目身份**：声明 `name` / `version` / `description`，并指定 Electron 主进程入口 `main`。
- **脚本入口**：`start` / `dev` / `build` / `typecheck` / `pack` / `dist` 六个脚本，覆盖「开发 → 构建 → 类型检查 → 打包 → 出安装包」全流程。
- **依赖分层**：`devDependencies` 放构建期工具（electron、electron-vite、vite、typescript 等），`dependencies` 放**运行期真正被 require 的库**（openai、opencc-js、vue）。
- **打包配置**：`build` 段直接内嵌 electron-builder 配置（appId、产物白名单、asar、NSIS 安装器、extraResources）。
- **注意**：本文件**没有** `"type"` 字段，因此包根默认按 CommonJS 解析（见第 3 节）。

## 2. 内容详解

### 2.1 基础字段

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `name` | `my-app` | npm 包名（`productName` 另为 `MarvisStudio`，二者不同） |
| `version` | `1.0.0` | 应用与安装包版本号 |
| `description` | `Electron 项目：左侧菜单 + 右侧内容区布局（五节点音视频创作流水线）` | 项目描述 |
| `main` | `out/main/index.js` | Electron 主进程入口；`out/` 由 electron-vite 构建产出，即源码 `src/main/index.ts` 的编译结果 |

### 2.2 scripts（逐条）

| 脚本 | 命令 | 做什么 |
| --- | --- | --- |
| `start` | `electron-vite preview` | 用**已构建**的 `out/` 产物启动 Electron，做产物态预览（不跑 dev server、不热更新） |
| `dev` | `electron-vite dev` | 开发模式：启动 renderer 的 Vite dev server（固定在 127.0.0.1:5173）并拉起 Electron，主进程/preload 改动自动重启，渲染层走 HMR |
| `build` | `electron-vite build` | 一次性构建三端产物到 `out/`（`out/main`、`out/preload`、`out/renderer`） |
| `typecheck` | `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.agent.json` | 依次对三份子工程做**纯类型检查**（三处均带 `--noEmit`，不产文件）；用 `&&` 串联，任一失败即整体失败 |
| `pack` | `npm run build && npx electron-builder --dir` | 先构建，再打出**免安装的解包目录**（`--dir`，只生成 `dist/win-unpacked` 之类的目录，不做安装器），用于快速验证打包结果 |
| `dist` | `npm run build && npx electron-builder --win` | 先构建，再按 `build.win.target` 生成 **Windows NSIS 安装包**（正式分发用） |

要点：`pack` / `dist` 都**先跑 `build`**，避免把过期产物打进包里。

### 2.3 devDependencies

| 包 | 版本 | 说明 |
| --- | --- | --- |
| `@types/node` | `^22.20.2` | Node 内置模块（`node:fs`、`node:path` 等）的类型声明 |
| `@vitejs/plugin-vue` | `^6.0.9` | Vite 的 Vue SFC 编译插件，用于 renderer |
| `electron` | `31.7.7` | Electron 运行时（**精确锁定**，无 `^`），与 `build.electronVersion` 一致 |
| `electron-builder` | `^26.15.3` | 打包/出安装包工具，读取 `build` 段 |
| `electron-vite` | `^5.0.0` | 三端（main/preload/renderer）一体化构建工具，提供 `dev`/`build`/`preview` 与 `externalizeDepsPlugin` |
| `typescript` | `^7.0.2` | 类型检查器（`tsc`） |
| `vite` | `^7.3.6` | 底层打包器/dev server |

### 2.4 dependencies

| 包 | 版本 | 说明 |
| --- | --- | --- |
| `openai` | `^7.15.0` | LLM / TTS 云端调用 SDK；被主进程在**运行时** require，故必须留在 `dependencies` |
| `opencc-js` | `^1.4.2` | 简繁转换库；同样在运行时 require |
| `vue` | `^3.5.43` | 渲染层框架；由 Vite 打进 renderer bundle（但仍按惯例列在 `dependencies`） |

### 2.5 build 段（electron-builder）

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `appId` | `com.marvis.avpipeline` | Windows 应用唯一标识（安装/升级识别用） |
| `productName` | `MarvisStudio` | 安装包与可执行文件显示名、快捷方式名 |
| `electronVersion` | `31.7.7` | 打包时下载/使用的 Electron 版本，与 `devDependencies.electron` 对齐 |
| `electronDownload.mirror` | `https://npmmirror.com/mirrors/electron/` | Electron 二进制下载镜像（国内网络加速） |
| `directories.output` | `dist` | 所有打包产物输出目录（与 `.gitignore` 的 `dist/` 对应） |
| `asar` | `true` | 将应用代码打包为 `app.asar` 单文件（`out/**`、`vendor/**` 等被塞进 asar；extraResources 除外） |
| `compression` | `normal` | 压缩级别 normal（非 `store` 非 `maximum`），体积与打包耗时的折中 |
| `win.target` | `[{ target: "nsis", arch: ["x64"] }]` | 仅出 Windows x64 的 NSIS 安装包 |
| `nsis.oneClick` | `false` | 走图形化安装向导（而非一键静默安装） |
| `nsis.allowToChangeInstallationDirectory` | `true` | 允许用户自选安装目录 |
| `nsis.createDesktopShortcut` | `true` | 创建桌面快捷方式 |
| `nsis.createStartMenuShortcut` | `true` | 创建开始菜单快捷方式 |
| `extraResources` | `[{ "from": "resources", "to": "." }]` | 把工程根 `resources/` 原样复制到安装目录的 `resources/`（asar **外**） |

### 2.6 files 白名单（逐条）

```json
"files": [
  "out/**/*",
  "video-projects/**/*",
  "vendor/**/*",
  "README.md",
  "!node_modules/**/*",
  "node_modules/openai/**/*",
  "node_modules/opencc-js/**/*",
  "!*.js.map"
]
```

| 模式 | 含义 |
| --- | --- |
| `out/**/*` | electron-vite 的三端构建产物（main/preload/renderer），应用代码主体 |
| `video-projects/**/*` | 用户项目数据目录（工程 / 字幕 / HTML / 视频），随包携带初始内容 |
| `vendor/**/*` | 随包携带的第三方运行时；当前只有 `vendor/gsap/gsap.min.js`（GSAP 3.14.2，72,779 字节 ≈ 71.07 KB），供 HTML composition 离线引用 `./gsap.min.js`，由 `src/main/hfEnv.ts` 的 `findLocalGsap()` 定位；导出的单个 HTML 则由 `hfEnv.externalizeGsapHtml()` 换回同版本的 CDN 地址（`GSAP_CDN_PINNED`） |
| `README.md` | 说明文档，便于用户直接看到 |
| `!node_modules/**/*` | **先整体排除** node_modules（体积控制），避免把整个依赖树塞进 asar |
| `node_modules/openai/**/*` | 再把 openai **单独捞回来** |
| `node_modules/opencc-js/**/*` | 再把 opencc-js **单独捞回来** |
| `!*.js.map` | 排除所有 sourcemap，减小体积、避免泄露源码映射 |

## 3. 关键流程或约定

1. **开发**：`npm run dev` → electron-vite 起 dev server（127.0.0.1:5173，`strictPort`）→ Electron 主进程加载该 URL。
2. **检查**：`npm run typecheck` → 三个 `tsc -p` 串行执行，全部 `--noEmit`。
3. **构建**：`npm run build` → `out/` 三端产物。
4. **打包**：`npm run pack`（解包目录，快速验证）或 `npm run dist`（NSIS 安装包）。
5. **运行期依赖解析**：`main` 指向的 `out/main/index.js` 里对 `openai` / `opencc-js` 保持 `require` 形态，由 asar 内的 `node_modules` 提供。
6. **运行时二进制**：ffmpeg/node 等大体积运行时不在 asar 内，而从安装目录 `resources/` 取（见第 4、5 节）。

## 4. 与其他文件的关系

| 关联文件 | 关系 |
| --- | --- |
| `electron.vite.config.ts` | 被 `electron-vite` 自动读取；`externalizeDepsPlugin()` 决定 `dependencies` 里的包**不内联**，从而反过来要求 `files` 显式保留它们 |
| `tsconfig.node.json` / `tsconfig.web.json` / `tsconfig.agent.json` | `typecheck` 脚本按这三个 `-p` 逐个检查 |
| `tsconfig.json` | 只是 solution 根，不被任何脚本直接使用（`tsc -b` 未被调用） |
| `.gitignore` | 忽略 `node_modules/`、`dist/`、`out/`、`resources/`，与本文件的依赖目录、打包输出、extraResources 源一一对应 |
| `resources/` | `extraResources.from` 的源目录；`.gitignore` 排除它是因为里面是 ffmpeg 等大体积运行时 |
| `vendor/gsap/` | `files` 白名单中 `vendor/**/*` 的源目录；`vendor/gsap/README.md` 记录版本、来源、sha512/SHA256 与更新步骤。该目录**未被 `.gitignore` 忽略**（受版本控制），与 `resources/` 的处理方式正好相反 |
| `src/preload/index.d.ts` | 渲染层类型契约，与 `dependencies.vue` 一起支撑 renderer 的类型检查 |

## 5. 注意事项与实现要点

### 5.1 为什么 `files` 必须显式带上 `node_modules/openai/**/*` 与 `node_modules/opencc-js/**/*`

- `electron.vite.config.ts` 在 main/preload 里都启用了 `externalizeDepsPlugin()`，该插件会把 `dependencies` 中的包**排除出 bundle**，让产物保留运行时 `require('openai')` / `require('opencc-js')`。
- 既然代码没有把这两个库内联进 `out/`，打包后就必须在 asar 内**能找到真实的包文件**，否则运行时报 `Cannot find module`。
- 但 `files` 中的 `!node_modules/**/*` 已经把 node_modules 整体排除，所以必须用**更具体的模式按顺序重新包含**回来——数组顺序即匹配顺序，后写的包含规则生效。
- 只捞这两个包（及其依赖树），而不是放开整个 `node_modules`，是为了在可用性与体积之间取平衡。
- 对照：`vue` 也在 `dependencies` 里，但它是被 Vite **打进** renderer bundle 的，不需要在 asar 里保留 `node_modules/vue`。

### 5.2 为什么 `resources/` 走 `extraResources` 而不是 `files`

- `resources/` 里放的是**外部可执行文件与运行时**（ffmpeg、node、hyperframes + chrome-headless-shell 等），见 `.gitignore` 注释。
- **可执行文件不能从 asar 内运行**：`child_process.spawn` 需要一个真实存在的磁盘路径，asar 是归档文件无法直接 exec。因此这类二进制必须放在 asar **之外**。
- `extraResources: [{ from: "resources", to: "." }]` 把整个目录复制到安装目录的 `resources/`（`to: "."` 即资源根），运行期以真实路径访问。
- `files` 进的是 `app.asar`，`extraResources` 进的是 asar 同级资源目录——两者职责不同，不能互换。

### 5.3 其他要点

- `electron` 依赖被**精确锁定为 `31.7.7`**（无 `^`），且与 `build.electronVersion` 保持一致，避免构建期与打包期版本漂移。
- `main` 是 `out/main/index.js`：**必须先 `build` 才能 `start`**，否则 `electron-vite preview` 无产物可加载。
- package.json 根**无 `"type": "module"`**：根部默认 CommonJS。`src/agent/` 下有独立的 `{"type":"module"}` 标记，仅让该子目录按 ESM 解析。
- `pack` 与 `dist` 都带 `npm run build` 前置，但**不**包含 `typecheck`——类型检查需要单独执行。
- `build.files` 中的 `video-projects/**/*` 属于用户数据，随包分发时要注意不要夹带私人素材。
- **`vendor/**/*` 进 asar，而不是走 `extraResources`**：`vendor/gsap/gsap.min.js` 只被主进程**按字节读取与复制**（`fs.readFileSync` / `fs.copyFileSync`），不需要 `spawn` 执行，因此放进 asar 即可；`hfEnv.findLocalGsap()` 用 `app.getAppPath()` 定位它（dev = 项目根，打包后 = `app.asar` 根），两种形态都能命中。配套的一对改写：项目内 `index.html` 用 `./gsap.min.js` 本地引用（`localizeGsapHtml`），**导出/下载单个 HTML 时**用 `externalizeGsapHtml` 换回固定版本 CDN——因此随包文件只服务打包后的离线预览/渲染，导出物本身不携带它。
- **`vendor/` 未被 `.gitignore` 忽略且不应忽略**：它是分发给最终用户的运行资源，必须随源码入库（否则新环境克隆后 GSAP 本地化会静默退化为 CDN 加载）。更新步骤见 `vendor/gsap/README.md`；升级时 `hfEnv.ts` 的 `GSAP_CDN_PINNED` 必须同步改版本号。
