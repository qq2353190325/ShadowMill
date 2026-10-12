# package.json

> 工程根 npm 清单：脚本入口 + 依赖 + electron-builder 打包配置

- **位置**：工程根
- **类型**：npm 清单（同时承载 electron-builder 的 `build` 段）
- **规模**：83 行

## 1. 作用与职责

- **项目身份**：声明 `name` / `version` / `description`，并指定 Electron 主进程入口 `main`。
- **脚本入口**：`start` / `dev` / `build` / `typecheck` / `pack` / `dist` 六个脚本，覆盖「开发 → 构建 → 类型检查 → 打包 → 出安装包」全流程。
- **依赖分层**：`devDependencies` 放构建期工具（electron、electron-vite、vite、typescript 等），`dependencies` 放**运行期真正被 require 的库**（openai、opencc-js、electron-updater、vue）。
- **打包配置**：`build` 段直接内嵌 electron-builder 配置（appId、`files` 收口、asar、NSIS 安装器、`publish` 更新源、extraResources）。
- **注意**：本文件**没有** `"type"` 字段，因此包根默认按 CommonJS 解析（见第 3 节）。

## 2. 内容详解

### 2.1 基础字段

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `name` | `shadowmill` | npm 包名（`productName` 另为 `ShadowMill`，二者的书写形式不同）；**同时决定 Electron 的 userData 目录名**（`%APPDATA%\shadowmill`，主进程不做 `setPath`）——改它就等于换数据目录，必须把旧名字加进 `src/main/index.ts` 的 `LEGACY_DIR_NAMES`，否则老用户下次启动不会被提示迁移（见 [main/index.ts.md](../main/index.ts.md) §3.1） |
| `version` | `0.0.3` | 应用与安装包版本号；与 `src/shared/constants.ts` 的 `APP_USER_AGENT = 'ShadowMill/1.0'` 里那个 `1.0` **无关**（后者是固定的请求标识片段，版本号一律运行时取 `app.getVersion()`） |
| `description` | `ShadowMill（影坊）：Electron 桌面应用，以「项目」为粒度的一站式音视频创作流水线` | 项目描述（改品牌名时属于清单第 2 项，需与 `src/shared/constants.ts` 一并改） |
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
| `electron` | `44.7.0` | Electron 运行时（**精确锁定**，无 `^`），与 `build.electronVersion` 一致；该 npm 包**已无 `postinstall`**，二进制改为首次 `require('electron')` 时懒下载（见 §5.3） |
| `electron-builder` | `^26.15.3` | 打包/出安装包工具，读取 `build` 段 |
| `electron-vite` | `^5.0.0` | 三端（main/preload/renderer）一体化构建工具，提供 `dev`/`build`/`preview` 与 `externalizeDepsPlugin` |
| `typescript` | `^7.0.2` | 类型检查器（`tsc`） |
| `vite` | `^7.3.6` | 底层打包器/dev server |

### 2.4 dependencies

| 包 | 版本 | 说明 |
| --- | --- | --- |
| `openai` | `^7.15.0` | LLM / TTS 云端调用 SDK；被主进程在**运行时** require，故必须留在 `dependencies` |
| `opencc-js` | `^1.4.2` | 简繁转换库；同样在运行时 require |
| `electron-updater` | `^6.8.9` | 应用自更新库；被 `src/main/updater.ts` 在**运行时** `require`（CJS 包，不能 `import`），故必须留在 `dependencies` 并进 `files` 白名单 |
| `vue` | `^3.5.43` | 渲染层框架；由 Vite 打进 renderer bundle（但仍按惯例列在 `dependencies`） |

### 2.5 build 段（electron-builder）

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `appId` | `com.shadowmill.app` | Windows 应用唯一标识（安装/升级识别用） |
| `productName` | `ShadowMill` | 安装包与可执行文件显示名、快捷方式名（产物为 `ShadowMill.exe` / `ShadowMill Setup <版本>.exe`）；**必须与 `src/shared/constants.ts` 的 `APP_NAME_EN` 一致**——JSON 无法 import TS 常量，故由 `electron.vite.config.ts` 的 `checkBrandConsistency()` 在配置加载时（`npm run dev` / `build` 各一次）比对，不一致时打印 `[dsh:brand] …` 告警（只告警、不阻断构建） |
| `electronVersion` | `44.7.0` | 打包时下载/使用的 Electron 版本，与 `devDependencies.electron` 对齐（Electron 44.7.0 = Chromium 152 + Node 24.21.0；HyperFrames 渲染复用其内嵌 Node，见 [main/hfEnv.ts.md](./main/hfEnv.ts.md) §3.4） |
| `electronDownload.mirror` | `https://npmmirror.com/mirrors/electron/` | **打包期**下载 Electron 运行时的国内镜像；`npm install` 期的二进制下载另由仓库根 `.npmrc` 的 `electron_mirror` 负责，两者分工不同、取值一致 |
| `directories.output` | `dist` | 所有打包产物输出目录（与 `.gitignore` 的 `dist/` 对应） |
| `asar` | `true` | 将应用代码打包为 `app.asar` 单文件（`out/**`、`vendor/**` 等被塞进 asar；extraResources 除外） |
| `compression` | `normal` | 压缩级别 normal（非 `store` 非 `maximum`），体积与打包耗时的折中 |
| `win.target` | `[{ target: "nsis", arch: ["x64"] }]` | 仅出 Windows x64 的 NSIS 安装包 |
| `nsis.oneClick` | `false` | 走图形化安装向导（而非一键静默安装） |
| `nsis.perMachine` | `true` | **全机安装**（装到 `Program Files`，安装/升级需要管理员权限，配合下面的 `allowElevation` / `packElevateHelper`） |
| `nsis.allowElevation` | `true` | 允许安装器请求提权 |
| `nsis.packElevateHelper` | `true` | 随包携带提权辅助程序（安装与自更新提权都要用） |
| `nsis.allowToChangeInstallationDirectory` | `true` | 允许用户自选安装目录 |
| `nsis.createDesktopShortcut` | `true` | 创建桌面快捷方式 |
| `nsis.createStartMenuShortcut` | `true` | 创建开始菜单快捷方式 |
| `nsis.differentialPackage` | `true` | 生成差分包元数据，配合安装包旁的 `.exe.blockmap` 让客户端只下变化部分 |
| `publish` | `[{ "provider": "generic", "url": "https://chaoming-zhaoling.oss-cn-beijing.aliyuncs.com/shadowmill/" }]` | 更新源（阿里云 OSS，公共读 + 尾斜杠必备）。**`npm run dist` 借此生成 `resources/app-update.yml` 与 `dist/latest.yml`；generic 源不会自动上传**，两个文件要手工传到该 URL 下 |
| `extraResources` | `[{ "from": "resources", "to": "." }]` | 把工程根 `resources/` 原样复制到安装目录的 `resources/`（asar **外**） |

### 2.6 files 收口（逐条）

```json
"files": [
  "out/**/*",
  "vendor/**/*",
  "README.md",
  "!node_modules/@vue/**/*",
  "!node_modules/@babel/**/*",
  "!node_modules/vue/**/*",
  "!*.js.map"
]
```

| 模式 | 含义 |
| --- | --- |
| `out/**/*` | electron-vite 的三端构建产物（main/preload/renderer），应用代码主体 |
| `vendor/**/*` | 随包携带的第三方运行时；当前只有 `vendor/gsap/gsap.min.js`（GSAP 3.14.2，72,779 字节 ≈ 71.07 KB），供 HTML composition 离线引用 `./gsap.min.js`，由 `src/main/hfEnv.ts` 的 `findLocalGsap()` 定位；导出的单个 HTML 则由 `hfEnv.externalizeGsapHtml()` 换回同版本的 CDN 地址（`GSAP_CDN_PINNED`） |
| `README.md` | 说明文档，便于用户直接看到 |
| `!node_modules/@vue/**/*`、`!node_modules/@babel/**/*`、`!node_modules/vue/**/*` | 排除**构建期**工具链（约 12.6 MB）。这三个包只被 Vite/SFC 编译器用，运行时不需要：`vue` 已打进 `out/renderer/assets/index-*.js`，`@vue/*`、`@babel/*` 只在编译 SFC 时参与 |
| `!*.js.map` | 排除 sourcemap，减小体积、避免泄露源码映射 |

> **`node_modules` 下其余内容由 electron-builder 按 `dependencies` 自动收集**（含传递依赖闭包），不再手写白名单——原因见 §5.1。注意这里只有「排除项」，没有任何「逐包捞回」，所以运行时依赖不可能被漏掉。
>
> 用户项目数据只存在 `userData/projects/` 下，不随包分发，因此 `build.files` 里没有任何项目数据条目。

## 3. 关键流程或约定

1. **开发**：`npm run dev` → electron-vite 起 dev server（127.0.0.1:5173，`strictPort`）→ Electron 主进程加载该 URL（首次运行会触发 Electron 二进制的懒下载，见 §5.3）。
2. **检查**：`npm run typecheck` → 三个 `tsc -p` 串行执行，全部 `--noEmit`。
3. **构建**：`npm run build` → `out/` 三端产物。
4. **打包**：`npm run pack`（解包目录，快速验证；**不生成 `app-update.yml`，无法验证自动更新**）或 `npm run dist`（NSIS 安装包 + `latest.yml` + `.exe.blockmap` + `resources/app-update.yml`）。
5. **运行期依赖解析**：`main` 指向的 `out/main/index.js` 里对 `openai` / `opencc-js` / `electron-updater` 保持 `require` 形态，由 asar 内 electron-builder 自动收集的 `node_modules` 提供（`build.files` 里没有 `!node_modules/**/*`，也没有逐包白名单）。**新增运行时依赖后仍建议 `npm run pack` 并用 `npx asar list dist/win-unpacked/resources/app.asar` 抽查关键包。**
6. **运行时二进制**：ffmpeg/node 等大体积运行时不在 asar 内，而从安装目录 `resources/` 取（见第 4、5 节）。

## 4. 与其他文件的关系

| 关联文件 | 关系 |
| --- | --- |
| `electron.vite.config.ts` | 被 `electron-vite` 自动读取；`externalizeDepsPlugin()` 决定 `dependencies` 里的包**不内联**，从而要求 asar 内必须能找到真实的包文件（现由 electron-builder 按 `dependencies` 自动收集）；其 `checkBrandConsistency()` 会读本文件的 `build.productName` 与 `src/shared/constants.ts` 的 `APP_NAME_EN` 比对，不一致即告警 |
| `.npmrc`（工程根） | **安装期**配置：唯一有效项是 `electron_mirror=https://npmmirror.com/mirrors/electron/`（其余是注释）。npm 把该键导出为环境变量 `npm_config_electron_mirror`，由 `@electron/get` 的 `mirrorVar()` 命中（`npm_config_*` > 环境变量 > options），从而加速 Electron 二进制下载；**它只在 `npm install` / `npm ci` 期生效、不进安装包**，与 `build.electronDownload.mirror`（打包期）分工不同。临时覆盖可用环境变量 `ELECTRON_MIRROR`（优先级更高） |
| `tsconfig.node.json` / `tsconfig.web.json` / `tsconfig.agent.json` | `typecheck` 脚本按这三个 `-p` 逐个检查 |
| `tsconfig.json` | 只是 solution 根，不被任何脚本直接使用（`tsc -b` 未被调用） |
| `.gitignore` | 忽略 `node_modules/`、`dist/`、`out/`、`resources/`，与本文件的依赖目录、打包输出、extraResources 源一一对应 |
| `resources/` | `extraResources.from` 的源目录；`.gitignore` 排除它是因为里面是 ffmpeg 等大体积运行时 |
| `vendor/gsap/` | `files` 白名单中 `vendor/**/*` 的源目录；`vendor/gsap/README.md` 记录版本、来源、sha512/SHA256 与更新步骤。该目录**未被 `.gitignore` 忽略**（受版本控制），与 `resources/` 的处理方式正好相反 |
| `src/preload/index.d.ts` | 渲染层类型契约，与 `dependencies.vue` 一起支撑 renderer 的类型检查 |

## 5. 注意事项与实现要点

### 5.1 为什么不再手写 `node_modules` 白名单（2026-10 修正）

**旧做法（已废弃）**：`files` 里先 `!node_modules/**/*` 排除全部，再逐条 `node_modules/<包>/**/*` 把运行时依赖捞回来。

**问题**：这种「范围太窄」的模式一旦漏列就**运行时崩溃**，而且只在安装版暴露（开发态直接读 `node_modules` 永远正常）。实际踩坑：`electron-updater → builder-util-runtime → require('debug')`，漏了 `debug` 与其依赖 `ms`，安装版启动即报 `Cannot find module 'debug'`，整个自动更新功能不可用。手写清单需要人肉维护完整依赖闭包，不可靠。

**现做法**：不再排除 `node_modules`，交给 electron-builder **按 `dependencies` 自动收集完整依赖闭包**，只显式排除确定不进运行时的构建期包：

```json
"files": [
  "out/**/*", "vendor/**/*", "README.md",
  "!node_modules/@vue/**/*", "!node_modules/@babel/**/*", "!node_modules/vue/**/*",
  "!*.js.map"
]
```

**为什么这样更安全**：自动收集是「范围太宽」，多带包只增加体积；手写白名单是「范围太窄」，漏包直接崩。前者是可接受的失败模式，后者不是。`vue` 已被 Vite 打进 renderer bundle、`@vue/*` 与 `@babel/*` 只在构建期用到，故显式排除（约省 12.6 MB）；即便排除规则写错，后果也只是体积变大，不会缺包。

**代价与实测**：asar 28.14 MB → 42.31 MB（自动收集全量），加排除后回落。验证方式：

```powershell
npm run pack
npx asar list dist\win-unpacked\resources\app.asar > list.txt
findstr /C:"node_modules\debug\" list.txt    # 每个运行时依赖都要 >0
```

> 对照记忆：`vue` 也在 `dependencies` 里，但它被 Vite **打进**了 renderer bundle，因此 asar 内不需要 `node_modules/vue`；`@vue/*`、`@babel/*` 同理只在构建期参与编译。

### 5.2 为什么 `resources/` 走 `extraResources` 而不是 `files`

- `resources/` 里放的是**外部可执行文件与运行时**（ffmpeg、node、hyperframes + chrome-headless-shell 等），见 `.gitignore` 注释。
- **可执行文件不能从 asar 内运行**：`child_process.spawn` 需要一个真实存在的磁盘路径，asar 是归档文件无法直接 exec。因此这类二进制必须放在 asar **之外**。
- `extraResources: [{ from: "resources", to: "." }]` 把整个目录复制到安装目录的 `resources/`（`to: "."` 即资源根），运行期以真实路径访问。
- `files` 进的是 `app.asar`，`extraResources` 进的是 asar 同级资源目录——两者职责不同，不能互换。

### 5.3 其他要点

- `electron` 依赖被**精确锁定为 `44.7.0`**（无 `^`），且与 `build.electronVersion` 保持一致，避免构建期与打包期版本漂移。Electron 44 的 npm 包**没有 `postinstall`**：不再在 `npm install` 时下载二进制，而是改为首次 `require('electron')` 时懒下载——因此 `npm install` 完成后 `node_modules/electron/dist` **可能并不存在**，**首次 `npm run dev` 会触发约 150 MB 的下载**（需要显式下载时用 `npx install-electron`，其 `bin` 为 `install-electron` → `node_modules/electron/install.js`）。下载镜像由仓库根 `.npmrc` 的 `electron_mirror` 提供（`https://npmmirror.com/mirrors/electron/`，实测会 302 跳到 `https://cdn.npmmirror.com/binaries/electron/`，`@electron/get` 自行跟随重定向；CDN 上只有 `binaries/` 前缀，没有 `/mirrors/`）；打包期的镜像仍是 `build.electronDownload.mirror`。配套事实：Electron 44.7.0 = Chromium 152 + Node 24.21.0。
- `main` 是 `out/main/index.js`：**必须先 `build` 才能 `start`**，否则 `electron-vite preview` 无产物可加载。
- package.json 根**无 `"type": "module"`**：根部默认 CommonJS。`src/agent/` 下有独立的 `{"type":"module"}` 标记，仅让该子目录按 ESM 解析。
- `pack` 与 `dist` 都带 `npm run build` 前置，但**不**包含 `typecheck`——类型检查需要单独执行。
- **改品牌名要动本文件三处**：`build.productName`（安装包与 exe 名）、`description`、`build.appId`；`build.productName` 与 `src/shared/constants.ts` 的 `APP_NAME_EN` 必须一致（构建期由 `checkBrandConsistency()` 告警），而显示用的中文名 / 口号只改 `src/shared/constants.ts` 即可（`index.html` 走占位符注入、渲染层直接 import）。注意 `name`（`shadowmill`）**不在**品牌清单里，但**它决定 userData 目录名**（`%APPDATA%\<name>`，主进程不做 `setPath`）：改它必须把旧名字加进 `src/main/index.ts` 的 `LEGACY_DIR_NAMES`，否则启动时不会扫描到老目录、用户看到的就是「项目全没了」（扫描后还会先做归属证明，见 [main/index.ts.md](../main/index.ts.md) §3.1）。`build.appId` 则必须与 `index.ts` 的 `APP_ID` 保持一致——它是归属证明里比对的那个 `appId`。
- `build.files` 只收应用代码与随包资源（`out/**/*`、`vendor/**/*`、`README.md` + 排除项）；用户项目数据一律在 `userData/projects/` 下，不随包分发。
- **`vendor/**/*` 进 asar，而不是走 `extraResources`**：`vendor/gsap/gsap.min.js` 只被主进程**按字节读取与复制**（`fs.readFileSync` / `fs.copyFileSync`），不需要 `spawn` 执行，因此放进 asar 即可；`hfEnv.findLocalGsap()` 用 `app.getAppPath()` 定位它（dev = 项目根，打包后 = `app.asar` 根），两种形态都能命中。配套的一对改写：项目内 `index.html` 用 `./gsap.min.js` 本地引用（`localizeGsapHtml`），**导出/下载单个 HTML 时**用 `externalizeGsapHtml` 换回固定版本 CDN——因此随包文件只服务打包后的离线预览/渲染，导出物本身不携带它。
- **`vendor/` 未被 `.gitignore` 忽略且不应忽略**：它是分发给最终用户的运行资源，必须随源码入库（否则新环境克隆后 GSAP 本地化会静默退化为 CDN 加载）。更新步骤见 `vendor/gsap/README.md`；升级时 `hfEnv.ts` 的 `GSAP_CDN_PINNED` 必须同步改版本号。
