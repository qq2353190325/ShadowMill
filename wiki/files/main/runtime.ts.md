# src/main/runtime.ts

> 运行环境包：把 ffmpeg / node / hyperframes / whisper 这些跨版本几乎不变的重型资源（约 716MB / 4900+ 文件）从「随安装包展开」改成「随安装包携带一个 7z、首次启动解到 userData」，并注册 3 个 `runtime:*` 频道（含 1 路进度推送）。

- **所在目录**：src/main/
- **类型**：主进程业务模块（IPC 注册 + 子进程编排 + 网络下载）
- **规模**：478 行
- **对外导出**：`register`、`ensureRuntime`、`prepareInBackground`、`runtimeStatus`、`runtimeRoot`

## 1. 作用与职责

NSIS 的更新方式是「整体卸载旧版 → 解压复制新包」，而这份 716MB / 4900+ 文件的运行资源每次更新都要重新解压复制一遍（源码注释记的实测值：**一次更新 97 秒**，期间应用不存在、桌面快捷方式指向空路径）。拆成运行环境包之后：① 安装目录里的运行资源从 4900 个文件变成 1 个 `runtime.7z`（安装期的复制 / 改名开销大幅下降）；② 解包由应用自己做（**可展示进度**），且包内容没变时下一次更新**完全不碰**这 716MB。

| 能力 | 说明 |
|------|------|
| 状态查询 | `runtime:status` 返回当前阶段 / 进度 / 体积 / 文案的快照 |
| 主动准备 | `runtime:prepare` 触发一次准备（幂等、并发安全），返回成败 + 人话文案 + 排障详情 |
| 进度回推 | 检查 / 下载 / 解包每个阶段都 `runtime:progress` 推给渲染层 |
| 供其它模块等待 | `ensureRuntime()` 让「转录 / 渲染 / 逐句对齐 / 提取音轨」在使用外部工具前先等到就绪 |
| 资源根交接 | 就绪后把解包目录交给 `hfEnv.refreshBuiltinResources()`，使内置资源 getter 指向新根 |

包与清单由 `scripts/pack-runtime.mjs` 生成（`build/runtime-pack/`），随 `extraResources` 进安装目录；也可以把同一份包与清单上传到更新源（`app-update.yml` 的 `url` 目录），**本地包缺失时自动回退到下载**。

## 2. 导出与关键实现

### 2.1 对外导出

| 名称 | 类型 | 说明 |
|------|------|------|
| `register` | `(ctx: RegisterCtx) => void` | 存下 `ctx.getWindow`（缺失则为 `null`）→ 注册 `runtime:status` / `runtime:prepare` 两个 handler → 调 `prepareInBackground()`（默认 2 秒后后台准备） |
| `ensureRuntime` | `() => Promise<{ ok: boolean; message?: string; detail?: string }>` | **幂等 + 并发安全**：`stage === 'ready'` 直接成功返回；已有 `inFlight` 则复用同一个 Promise；否则执行 `run()` 并把 Promise 存进 `inFlight`，settle 后清空 |
| `prepareInBackground` | `(delayMs = 2000) => void` | `setTimeout(() => { void ensureRuntime() }, delayMs)`——先让窗口首屏出来（与 updater 的启动静默检查同思路，不抢启动时间） |
| `runtimeStatus` | `() => RuntimeProgressPayload` | 当前状态快照（`payload()`）；本文件内其它地方都直接用 `payload()` |
| `runtimeRoot` | `() => string` | `hfEnv.BUILTIN_RESOURCES.root`——就绪后（经 `refreshBuiltinResources`）指向真实的资源根 |

### 2.2 注册的 IPC 频道

| 频道常量 | 频道路由名 | 方向 | 载荷 → 返回 |
|----------|-----------|------|-------------|
| `IPC.Runtime.Status` | `runtime:status` | `ipcMain.handle` | 无参 → `RuntimeProgressPayload`（`payload()` 快照；渲染层挂载时用它补齐首帧） |
| `IPC.Runtime.Prepare` | `runtime:prepare` | `ipcMain.handle` | 无参 → `Promise<{ ok, message?, detail? }>`（`ensureRuntime()`；失败后重试入口，重复点击共享同一次执行） |
| `IPC.Runtime.Progress` | `runtime:progress` | 主进程 → 渲染进程推送（`win.webContents.send`） | `RuntimeProgressPayload`（唯一推送出口 `push()`，发送前判 `win && !win.isDestroyed()`） |

### 2.3 关键内部实现

| 名称 | 类型 | 说明 |
|------|------|------|
| `RuntimeManifest` | `interface`（**未导出**） | 清单结构：`id` / `file` / `sha512` / `bytes` / `files` / `unpackedBytes` + 可选 `sourceKey?` / `appVersion?` / `createdAt?`。**字段必须与 `scripts/pack-runtime.mjs` 一致** |
| `state` | 模块级对象 | `stage` / `percent` / `id` / `message` / `detail` / `source` / `bytes` / `unpackedBytes` / `files`；初值 `stage: 'idle'`、`message: '尚未检查运行环境'`。`stage` **刻意放宽为 `string`**（注释给了与 `updater.ts` 相同的原因：跨回调写入后 TS 会把它判成不可能分支） |
| `inFlight` | `Promise<{ ok; message?; detail? }> \| null` | 并发锁：同时只跑一次准备 |
| `getWindow` | `(() => any) \| null` | 由 `register(ctx)` 注入，供 `push()` 取窗口 |
| `payload()` | 函数 | 把 `state` 转成 `RuntimeProgressPayload`：`percent` 先 `Math.max(0, Math.min(100, Math.round(...)))`，`stage` 断言成 `RuntimeProgressPayload['stage']`——**所有回执与推送的唯一形状** |
| `push()` / `setStage(stage, message, detail?)` | 函数 | 改状态并推送；`setStage` 同时写入 `message` / `detail` |
| `fail(message, detail)` | 函数 | 置 `stage='failed'` + 推送 + 写 `runtime.log` + 返回 `{ ok: false, message, detail }` |
| `done(ok, message?, detail?)` | 函数 | 返回 `{ ok: true }` 或 `{ ok: false, message, detail }` |
| `writeLog(line)` | 函数 | 追加写 `userData/runtime.log`（超过 64KB 先删一次），与 `updater.log` / `startup.log` 同一套排障口子；写失败静默 |
| `bytesText(n)` | 函数 | 字节数格式化：`<1024` → `B`、`<1MB` → `KB`（1 位小数）、否则 `MB`（1 位小数） |
| `runtimeDir()` / `downloadsDir()` | 函数 | `userData/runtime` / `userData/runtime/downloads` |
| `currentFile()` / `okFile(id)` | 函数 | `userData/runtime/current.json`（**指针**）/ `userData/runtime/<id>/ok.json`（**完整性标记**） |
| `resolveSevenZip()` | 函数 | 定位解包器：`<resources>/tools/7za.exe`（非 win32 为 `7za`）→ dev 下的 `build/tools/7za.exe`；都没有返回 `null` |
| `localPackDir()` | 函数 | 随包清单目录：环境变量 `SHADOWMILL_RUNTIME_PACK`（文件则取其目录）→ 打包态 `process.resourcesPath/runtime-pack` → dev `build/runtime-pack` |
| `readManifest(dir)` | 函数 | 读 `<dir>/runtime.json`，校验 `id` / `file` 非空且 `<dir>/<file>` 存在，否则 `null` |
| `installedRoot()` | 函数 | 读 `current.json` 的 `id`，**再确认 `ok.json` 存在**才返回 `userData/runtime/<id>`，否则空串 |
| `hasInstalled(id)` | 函数 | 只判 `ok.json` 是否存在 |
| `feedUrl()` | 函数 | 与 `updater.ts` 同优先级：`settings.getUpdaterSettings().feedUrl`（去尾斜杠、压掉重复斜杠）→ 打包态 `resources/app-update.yml` / dev `dev-app-update.yml` 里的 `url:` 行 → 空串 |
| `httpText(url)` / `httpToFile(url, dest, onProgress)` | 函数 | 用 Electron `net.request`（不是 `fetch`）：清单当文本读；包流式落盘并按 `content-length` 报进度。注释说明 `IncomingMessage` 只暴露 `statusCode`/`headers`/`on`，故运行时断言成 `NodeJS.ReadableStream` 再用 `pipe` / `resume` |
| `sha512Of(file)` | 函数 | 流式 `sha512`（1MB 高水位）返回 **base64**，与清单的 `sha512` 直接比较 |
| `fetchRemotePack()` | 函数 | 远端 `runtime.json` → `downloads/<file>`：已存在且 sha512 相符则**复用不重下**；否则下载 → 复核 sha512，不符即删残片并返回 `null` |
| `extractPack(sevenZip, packFile, manifest)` | 函数 | `spawn(7za, ['x', packFile, '-o' + dest, '-y', '-bsp1'], { windowsHide: true })`：`-bsp1` 让百分比打到 stdout，用「末尾 400 字符窗口 + 末个 `N%`」解析进度（同值不重复推）；退出码非 0 时把 tail 最后一行带进错误 |
| `cleanOldPacks(keepId)` | 函数 | 解包成功后删掉 `userData/runtime/` 下除 `keepId` 以外的目录（一个旧包 716MB，留着没用；占用中则下次再清） |

## 3. 关键流程

### 3.1 `run()` —— 准备主流程（五段短路 + 一条主路径）

1. **① 已解包好**：`installedRoot()` 命中 ⇒ `stage='ready'`、`percent=100`、`source='cache'`、文案「运行环境已就绪」→ `hfEnv.refreshBuiltinResources(root)` → 推送 → 成功。**这是常态**（更新后第二次启动起都走这条）。
2. **② 安装目录已是展开形态**：非 `SHADOWMILL_RUNTIME_PACK` 强制、且 `<resources|app.getAppPath()/resources>/ffmpeg/bin/ffmpeg.exe` 存在 ⇒ `stage='ready'`、`source = app.isPackaged ? 'legacy' : 'dev'`、文案「运行环境已就绪（安装目录内置）」→ `refreshBuiltinResources(legacy)` → 写日志 → 成功（dev 与旧版布局安装直接受益）。
3. **③ 定位解包器**：`setStage('checking', '正在检查运行环境…')` 后 `resolveSevenZip()`，缺失 ⇒ `fail('运行环境无法准备：缺少解包程序', '未找到 7za.exe（应为 <resources>/tools/7za.exe）。请用 npm run pack / npm run dist 重新打包。')`。
4. **④ 取包（本地优先，离线可用）**：`readManifest(localPackDir())` 与 `path.join(localPackDir(), manifest.file)`，`source='local'`；本地没有才 `await fetchRemotePack()`（内部会把 `source` 置 `'download'` 并推送下载进度），两条路都拿不到 ⇒ `fail('运行环境尚未准备好，暂时无法使用本地转录 / 渲染功能', '既没有找到随安装包携带的 runtime-pack（<localPackDir()>），也没能从更新源取到运行环境包。')`。
5. **⑤ 幂等认领 / 解包**：把 `manifest` 的 `id` / `bytes` / `unpackedBytes` / `files` 写入 `state`；若 `hasInstalled(manifest.id)`（并发或上次被打断后指针没写）⇒ 直接 `refreshBuiltinResources` + `ready` 成功；否则 `setStage('extracting', '正在准备运行环境 0%（<体积> / <文件数> 个文件）')` 并 `extractPack()`（失败 ⇒ `fail('运行环境解压失败，转录 / 渲染暂不可用', '7za 解包失败：…')`）。
6. **⑥ 落标记与指针**：先写 `<id>/ok.json`（`{ id, files, unpackedBytes, at }`），再写 `current.json`（`{ id, at }`）——写盘异常 ⇒ `fail('运行环境写入失败（磁盘空间或权限问题）', ...)`。随后 `refreshBuiltinResources(dest)` → `cleanOldPacks(id)` → `stage='ready'`、`percent=100`、文案「运行环境已就绪（<体积>）」→ 推送 → `writeLog('解包完成 id=… 用时 N 秒，来源 <source>')` → 成功。

### 3.2 幂等与并发（`ensureRuntime`）

`stage === 'ready'` 时**不发任何 IPC、不碰文件系统**，直接 `Promise.resolve(done(true))`；否则若 `inFlight` 已存在就返回同一个 Promise；否则 `inFlight = run().catch(e => fail('运行环境准备失败', String(e))).then(r => { inFlight = null; return r })`。因此「启动后台准备」与渲染层点「重新准备」天然共享同一次执行，重复点击不会并发解包。

### 3.3 启动时序

`register(ctx)` 里注册完两个 handler 后立即调 `prepareInBackground()`：**延迟 2 秒**（`delayMs` 参数默认 2000）触发 `void ensureRuntime()`，让「建窗 → 首屏」先完成。这与 `updater.register()` 里 3 秒后的启动静默检查是同一思路——入口把 `runtime.register(ctx)` 排在最后也是为此（不抢启动时间）。

### 3.4 与 `hfEnv` 的资源根交接

本模块是 `runtime/current.json` 与 `<id>/ok.json` 的**唯一写入方**；四条就绪路径（cache / legacy-dev / hasInstalled / 解包完成）都会调一次 `hfEnv.refreshBuiltinResources(<目录>)`，把该目录交给 `hfEnv` 清掉并重算它的资源缓存（root / chrome / node），于是 `ffmpeg` / `ffprobe` / `chromeShell` / node 等 getter 指向真正可用的资源。

## 4. 依赖与协作

### 4.1 导入

| 来源 | 导入项 | 用途 |
|------|--------|------|
| `electron` | `app`、`ipcMain`、`net` | userData 路径与打包态判断、IPC 注册、HTTP（清单文本 + 包下载） |
| `node:path` | `path`（默认导入） | 路径拼接、`path.dirname` |
| `node:fs` | `fs`（默认导入） | 清单读写、指针 / 标记、流式落盘、清理 |
| `node:crypto` | `crypto`（默认导入） | `sha512` 校验 |
| `node:child_process` | `spawn` | 启动 `7za` 解包子进程 |
| `../shared/ipc` | `IPC` | 频道常量（`Runtime.Status` / `Runtime.Prepare` / `Runtime.Progress`） |
| `../shared/types` | `type RegisterCtx`、`type RuntimeProgressPayload` | 注册上下文与推送 / 回执的载荷类型（③.6 节） |
| `./hfEnv` | `* as hfEnv` | `refreshBuiltinResources()`（资源根交接）与 `BUILTIN_RESOURCES.root`（`runtimeRoot()`） |
| `./settings` | `getUpdaterSettings` | 读 `feedUrl` 作为运行环境包的下载源（与 `updater.ts` 同优先级） |

> 本文件**不 import `dialog` / `shell`**：它不弹任何界面，失败信息经 `runtime:progress` / `runtime:prepare` 交给渲染层展示。

### 4.2 被谁使用

| 使用方 | 用法 |
|--------|------|
| `src/main/index.ts` | `runtime.register(ctx)`——装配顺序里**最后一个**（注释：自己带 2s 延迟在后台解包，不抢启动时间） |
| `src/main/projects.ts` | `project:extract-video-audio` 先 `await runtime.ensureRuntime()` 等运行环境就绪（未就绪时把其 `message` / `detail` 原样返回给渲染层） |
| `src/main/hfEnv.ts` | 资源根交接对端：本模块调 `refreshBuiltinResources(resolvedRoot)`，`hfEnv` 据此重算内置资源路径 |
| `src/preload/index.ts` | `runtimeTools` 命名空间：`status` / `prepare` / `onProgress`（单订阅）分别转发上述三个频道 |
| `src/renderer/src/composables/useRuntime.ts` | 模块级状态单例：`initRuntime()` 订阅 `runtime:progress` + 查一次 `runtime:status`，派生 `busy` / `failed` / `ready` / `sizeText` 与 `retry()` |
| `src/renderer/src/App.vue`、`src/renderer/src/pages/SettingsPage/index.vue` | 外壳横幅（准备中 / 失败重试）与设置页的运行环境状态行 |

## 5. 注意事项与实现要点

- **`stage` 刻意放宽为 `string`**：与 `updater.ts` 同因——阶段由事件 / 异步回调跨函数写入，若标注成 `RuntimeStage` 联合类型，TS 的控制流分析会把函数内最后一次赋值当成当前类型，导致后续比较被判成「不可能分支」。交出前由 `payload()` 断言成 `RuntimeProgressPayload['stage']` 收口。
- **`ok.json` 是完整性标记，`current.json` 只是指针**：`installedRoot()` 必须两者同时满足才算就绪；解包成功时也**先写 `ok.json` 再写 `current.json`**——这样即使中途断电，也不会出现「指针指向一个没解完的目录」。
- **sha512 用 base64 与清单直接比较**：下载完成后必须复核，不符即刻删除残片并返回 `null`（`fail` 文案会走「既没有本地包也没能从更新源取到」那一支），避免半个包被当作缓存复用；已存在且校验相符的下载文件会**直接复用**，不重复下载 716MB。
- **`7za` 是随包外部依赖**：只认 `<resources>/tools/7za.exe`（dev 为 `build/tools/7za.exe`），找不到直接 `fail` 并提示重新打包——**不要**试图回退到系统 `7z`。
- **本地包优先于下载**：随安装包携带的 `runtime-pack/` 离线可用；`SHADOWMILL_RUNTIME_PACK` 环境变量可把清单目录指到任意位置（dev 自测用），此时 `force = true` 会**跳过「安装目录已是展开形态」那条短路**，强制走真正的取包 / 解包路径。
- **下载源与更新源同优先级**：`settings.json` 的 `updater.feedUrl` 优先，其次打包的 `app-update.yml`（dev 为 `dev-app-update.yml`）；`feedUrl()` 会裁掉尾斜杠并把 `//` 压成 `/`，再拼 `runtime.json` / `<file>`。
- **`percent` 语义**：`downloading` / `extracting` 阶段有效，`ready` 为 100；`payload()` 里统一 clamp 到 `[0,100]` 并 `Math.round`，因此渲染层拿到的一定是合法整数。解包进度来自 `7za -bsp1` 的 stdout 百分比，用「末尾 400 字符窗口取最后一个 `N%`」容忍分块截断，**同值不重复推送**。
- **失败不阻断应用**：任何一步失败都走 `fail()`——只更新 `state`（`stage='failed'` + 人话 `message` + 排障 `detail`）、推一次进度、写一行 `runtime.log`，并返回 `{ ok: false, ... }`；渲染层据此显示红色横幅与「重新准备」按钮，转录 / 渲染等真正依赖外部工具的功能自行等待或报错。
- **旧包与下载目录会自清**：解包成功后 `cleanOldPacks(id)` 删掉 `userData/runtime/` 下除当前 id 以外的所有目录（旧 id 目录与 `downloads/` 一并清掉），失败时只记忽略——被占用的下次解包再清。
- **`userData/runtime.log`**：与 `updater.log` / `startup.log` 同一套排障口子（超过 64KB 自动清一次），记录「使用安装目录内置资源」「远端清单不可用」「下载失败 / 校验失败」「解包完成 + 用时 + 来源」等关键节点。
- **`runtimeRoot()` 依赖 `hfEnv` 的缓存**：它返回 `hfEnv.BUILTIN_RESOURCES.root`，未就绪时是未刷新前的值；要拿「解包目录」应以 `installedRoot()` 的语义为准（本模块内部如此使用）。
- **`register` 只注册两个 `handle` + 一路 `send`**：`runtime:status` / `runtime:prepare` 都是「问一次答一次」，没有主 → 渲染的独立命令通道；进度完全由 `runtime:progress` 单路推送。
- **不写 `settings.json`、不碰项目数据**：本模块只管理 `userData/runtime/` 自己的目录与 `current.json` / `<id>/ok.json` 两个元数据文件。
