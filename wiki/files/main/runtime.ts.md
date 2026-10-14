# src/main/runtime.ts

> 运行环境（**分包**）：把 `ffmpeg`（179.9 MB / 9 文件）与 `hyperframes`（439.9 MB / 4892 文件）从「随安装包展开」改成「各自一个 7z、**首次用到时**从更新源下载并解到 `<userData>/runtime/<包名>/`」；`whisper`（12.5 MB / 15 文件）改为**随安装包**（见 `package.json` 的 `extraResources`），装完即可离线转录。注册 3 个 `runtime:*` handle + 1 路 `runtime:progress` 推送。分包实测：`ffmpeg` 42.6 MB + `hyperframes` **103.1 MB = 两包合计 145.7 MB**（比旧单包 `runtime.7z` 的 147.4 MB 还小 1.7 MB）。方案与验收清单见 `docs/runtime-pack-split.md`。

- **所在目录**：src/main/
- **类型**：主进程业务模块（IPC 注册 + 网络下载 + 子进程解包）
- **规模**：786 行
- **对外导出**：`register`、`ensurePacks`、`prepareInBackground`、`cancelPrepare`、`packsStatus`、`missingPacks`、`packSizeText`、`packRoots`、`runtimeStatus`、`runtimeDir`（另有 `export type PackManifest`、`export type PackStatus`）

## 1. 作用与职责

NSIS 的更新方式是「整体卸载旧版 → 解压复制新包」，而这 632.3 MB / 4916 文件的运行资源每次更新都要重新解压复制一遍（源码注释记的实测值：**一次更新 97 秒**，期间应用不存在、桌面快捷方式指向空路径）。分包之后：

1. 安装包只带**代码 + whisper**（转录缺 whisper 就完全不能用，所以随包）⇒ 安装包实测 **257.6 MB → 105.08 MB**（`dist\ShadowMill Setup 0.0.3.exe` = 110,180,042 字节；−152.5 MB / −59%），且**装完即离线可用**（转录 / 配音 / 字幕 / HTML 生成都不需要下载）。设计文档预估的「约 145-150 MB」**偏高**：旧算法把「`runtime.7z` 在安装包内被压到约 90 MB」重复计了一次，实际是整块移出（`win-unpacked/resources` 只剩 `app.asar` 24.7 MB + `whisper` + `tools`，合计 38.1 MB；`locales` 也从 55 个 `.pak` / 48.3 MB 降到 2 个 / 1.1 MB）。注：源码头部注释仍写着「安装包从约 258MB 降到约 145MB」（改造时的预估），**以实测值为准**；
2. `ffmpeg` 与 `hyperframes` 各成一个包、**各自独立升级与校验**：改渲染引擎不必让「转录转码」重下 ffmpeg；
3. **是否下载由用户决定**（用到相关功能时提示体积、可取消），下载与解包进度可视化。包体积（2026-10-14 实测）：`ffmpeg` **42.6 MB**（`build/runtime-pack/ffmpeg.json` 的 `bytes` = 44,698,068，`id` = `rb0fc1c8a7e3e`；解包后 188,683,776 B / 9 文件；打包用时 76 秒），`hyperframes` **103.1 MB**（`bytes` = 108,076,664，`id` = `r724f4002624d`；解包后 461,299,233 B / 4892 文件；大头是未压缩 268.6 MB 的 `chrome/chrome-headless-shell`）——**两包合计 145.7 MB**，比旧单包 `runtime.7z` 的 147.4 MB 还小 1.7 MB（即「拆包的固实压缩损失」实测为零）。

| 能力 | 说明 |
|------|------|
| 纯探测 | `packsStatus()` / `missingPacks(needs?)` / `packSizeText(names)` 只查盘上标记与关键文件，**不下载、不阻塞**，供消费点在动手前校验 |
| 下载 + 解包 | `ensurePacks(packs?)` 才真正取清单 / 下载 / 解包（幂等 + 并发安全），带进度与取消 |
| 启动探测 | `prepareInBackground()` **只探测、不下载**：缺包时把 phase 置 `idle`、文案「运行环境需要下载（<体积>）」，让横幅与设置页首屏就有话说 |
| 进度回推 | 检查 / 下载 / 解包每个阶段都经 `runtime:progress` 推给渲染层（唯一出口 `push()`） |
| 取消 | `cancelPrepare()` 中断 HTTP 请求与 `7za` 子进程，并清掉半成品（**只有取消才删残片**） |
| 资源路径交接 | 某包就绪后调 `hfEnv.refreshPack(name, root)`，让 `hfEnv` 按包重算路径缓存 |
| 老用户沿用 | 旧版整体包目录（`current.json` + `ok.json` + 两包资源齐备）识别为 `legacy` 继续沿用；两个分包都就位后由 `gc()` 删掉它 |

包与清单由 `scripts/pack-runtime.mjs` 产出为 `build/runtime-pack/<包名>.7z` + `<包名>.json`（`ffmpeg` / `hyperframes` 各一份），上传到更新源（`app-update.yml` 的 `url` 目录）后由应用按需下载；访问不到更新源的机器可以让用户在设置页「从本地文件安装…」（`settings:pick-runtime-pack` → `userData/runtime/local-import/`）或把环境变量 `SHADOWMILL_RUNTIME_PACK` 指向本地包目录。

## 2. 导出与关键实现

### 2.1 对外导出

| 名称 | 类型 | 说明 |
|------|------|------|
| `register` | `(ctx: RegisterCtx) => void` | 存下 `ctx.getWindow`（缺失则为 `null`）→ 注册 `runtime:status` / `runtime:prepare` / `runtime:cancel` 三个 handler → 调 `prepareInBackground()`（**只探测，不下载**）。排在 `index.ts` 装配序列最后只保证 handler 先挂上 |
| `ensurePacks` | `(packs?: RuntimePackName[]) => Promise<IpcResult>` | 包名先过滤成合法集（缺省 = 全部两包）；已有 `inFlight` ⇒ 返回 `{ ok:false, message:'正在准备另一个运行环境包，请稍候再试' }`；合法集为空 ⇒ `{ ok:true }`；否则 `inFlight = runOnce(want).catch(e => fail('运行环境准备失败', String(e), want)).then(r => { inFlight = null; return r })`，settle 后清锁 |
| `prepareInBackground` | `() => void` | `syncStatus(packsStatus())` 取缺包：无缺 ⇒ `phase='ready'` / `percent=100` / 文案「运行环境已就绪」；有缺 ⇒ `phase='idle'` / `percent=0` / `source=''` / 文案「运行环境需要下载（<`packSizeText(miss)`>）」，然后 `push()` 一次。异常只写 `runtime.log('启动探测失败：…')`。**刻意不下载**：静默下载会把「用户的选择」变成「已经在跑了」 |
| `cancelPrepare` | `() => IpcResult` | 非忙（`phase` 不在 `downloading` / `extracting` / `checking`）⇒ `{ ok:true, message:'当前没有正在进行的下载' }`；否则置 `cancelRequested`、`activeReq.abort()`、`activeChild.kill()`、写日志，返回 `{ ok:true, message:'已取消下载' }` |
| `packsStatus` | `() => PackStatus` | 纯探测：逐包判 `installedEntry()` → legacy 满足 → `missing`，返回每包的 `{ state, id, root, files, unpackedBytes, bytes, legacy }` |
| `missingPacks` | `(needs?: RuntimePackName[]) => RuntimePackName[]` | `packsStatus()` + `syncStatus()` 后，返回 `needs`（缺省 = 全部包）里 `state !== 'ready'` 的包（按 `PACK_DEFS` 顺序） |
| `packSizeText` | `(names: RuntimePackName[]) => string` | 按 `PACK_DEFS.hint`（ffmpeg **43 MiB**、hyperframes **105 MiB**——两者都已按 2026-10-14 实测的 42.6 MB / 103.1 MB 回填）求和后 `bytesText()` 成「约 xx MB」，用于确认框与失败文案 |
| `packRoots` | `() => Partial<Record<RuntimePackName, string>>` | 各包解出来的根目录（未就绪的不出现），供主进程其它模块定位资源 |
| `runtimeStatus` | `() => RuntimeProgressPayload` | 同步探测后整理状态：`phase` 不在 `checking` / `downloading` / `extracting` 时按缺包重置成 `idle`（文案「运行环境需要下载（<体积>）」/ `percent=0`）或 `ready`（「运行环境已就绪」/ `percent=100`），返回 `payload()` |
| `runtimeDir` | `() => string` | `<userData>/runtime` |

### 2.2 注册的 IPC 频道

| 频道常量 | 频道路由名 | 方向 | 载荷 → 返回 |
|----------|-----------|------|-------------|
| `IPC.Runtime.Status` | `runtime:status` | `ipcMain.handle` | 无参 → `RuntimeProgressPayload`（`runtimeStatus()` 快照；渲染层挂载时用它补齐首帧） |
| `IPC.Runtime.Prepare` | `runtime:prepare` | `ipcMain.handle` | `packs?: RuntimePackName[]`（**省略 = 全部**）→ `Promise<IpcResult>`（`ensurePacks(packs)`；失败后重试入口，重复点击共享同一次执行） |
| `IPC.Runtime.Cancel` | `runtime:cancel` | `ipcMain.handle` | 无参 → `IpcResult`（`cancelPrepare()`；取消 = 不下载，且发起该操作的动作一并作废） |
| `IPC.Runtime.Progress` | `runtime:progress` | 主进程 → 渲染进程推送（`win.webContents.send`） | `RuntimeProgressPayload`（唯一推送出口 `push()`，发送前判 `win && !win.isDestroyed()`） |

### 2.3 关键内部实现

| 名称 | 类型 | 说明 |
|------|------|------|
| `PACK_DEFS` | 常量数组 | 包注册表，**必须与 `scripts/pack-runtime.mjs` 的 `PACKS` 对应**：`ffmpeg`（title「音视频处理（ffmpeg）」、hint **43 MiB（按实测 42.6 MB 回填）**、关键文件 `ffmpeg/bin/ffmpeg.exe` + `ffmpeg/bin/ffprobe.exe`）、`hyperframes`（title「视频渲染引擎（HyperFrames）」、hint **105 MiB（按实测 103.1 MB 回填）**、关键文件 `hyperframes/node_modules/hyperframes/bin/hyperframes.mjs`）。`PACK_NAMES` 是它的 `name` 列表 |
| `PackManifest` | `interface`（**已导出**） | 清单结构：`name?` / `id` / `file` / `sha512` / `bytes` / `files` / `unpackedBytes` + 可选 `sourceKey?` / `appVersion?` / `createdAt?`。**字段必须与 `scripts/pack-runtime.mjs` 一致** |
| `PacksState` | `interface`（未导出） | `userData/runtime/packs.json` 的形状：`{ version, packs: { <包名>: { id, files, unpackedBytes, at } }, legacy?: { id, root, at } }` |
| `PackStatusEntry` / `PackStatus` | `interface` / `type`（`PackStatus` 已导出） | 单包探测结果 `{ state, id, root, files, unpackedBytes, bytes, legacy }`；`PackStatus = Record<RuntimePackName, PackStatusEntry>` |
| `state` | 模块级对象 | `phase` / `pack` / `percent` / `packs` / `missing` / `status` / `message` / `detail` / `source` / `bytes` / `unpackedBytes` / `files`；初值 `phase:'idle'`、`message:'尚未检查运行环境'`、两包 `status` 均为 `'unknown'`。`phase` **刻意放宽为 `string`**（与 `updater.ts` 同因：跨回调写入后 TS 会把联合类型判成不可能分支），交出前由 `payload()` 断言成 `RuntimeProgressPayload['phase']` |
| `inFlight` / `cancelRequested` / `activeReq` / `activeChild` | 模块级状态 | 并发锁（同时只跑一次准备）、取消标志、当前 HTTP 请求、当前 `7za` 子进程 |
| `payload()` | 函数 | 把 `state` 转成 `RuntimeProgressPayload`：`percent` 先 clamp 到 `[0,100]` 再 `Math.round`；`packs` / `missing` / `status` 都是切片或浅拷贝；`cancellable = phase ∈ {downloading, extracting}`——**所有回执与推送的唯一形状** |
| `push()` / `setPhase(phase, message, detail?)` | 函数 | `push()` 取窗口并 `webContents.send(runtime:progress)`（窗口已销毁则忽略）；`setPhase` 写 `phase` / `message` / `detail` 后推一次 |
| `fail(message, detail, packs?)` | 函数 | 置 `pack=null`、`missing=packs`、`phase='error'` + 推送 + 写 `runtime.log('error: …')` + 返回 `{ ok:false, message, detail }` |
| `cancelledResult()` | 函数 | 置 `phase='cancelled'`、`percent=0`、文案「已取消下载（运行环境未安装）」、推一次、写日志，返回 `{ ok:false, message:'已取消下载' }`（**取消不是失败**） |
| `readState()` / `writeState(s)` | 函数 | 读写 `userData/runtime/packs.json`（`readState` 对损坏文件回落 `{ version: 1, packs: {} }`；`writeState` 先 `mkdirSync` 再美化写出，失败只记日志） |
| `writeLog(line)` | 函数 | 追加写 `userData/runtime.log`（超过 64KB 先删一次），与 `updater.log` / `startup.log` 同一套排障口子；写失败静默 |
| `bytesText(n)` | 函数 | 字节数格式化：`<1024` → `B`、`<1MB` → `KB`（1 位小数）、否则 `MB`（1 位小数） |
| `runtimeDir()` / `downloadsDir()` / `stateFile()` / `packDir(name)` / `packOkFile(name)` | 函数 | `userData/runtime` / `…/downloads`（`<包名>-<id>.7z` 下载缓存）/ `…/packs.json` / `…/<包名>`（解包直落该目录）/ `…/<包名>/ok.json`（完整性标记） |
| `legacyPointer()` | 函数 | `userData/runtime/current.json`——**旧版布局的指针，只读不写**，仅用于老用户沿用判定 |
| `packReadyAt(name, root)` | 函数 | 就绪判定三件套：`root/ok.json` 存在 **且** `PACK_DEFS` 里该包的关键文件全在，缺一即 false |
| `legacyRoot()` | 函数 | 旧版整体包目录：优先 `packs.json` 里记的 `legacy.root`；否则读 `current.json` 的 `id` + `ok.json`，并要求「两包资源同时齐备」（去掉包名那一层再找一遍，避免把某个分包目录误认成整体包），命中就补记 `legacy` 并写日志 |
| `installedEntry(name)` | 函数 | `packs.json` 有该包记录 **且** `packReadyAt(name, packDir(name))` 为真才返回记录，否则 `null` |
| `syncStatus(status)` | 函数 | 把探测结果写进 `state.status`，并对已就绪的包调 `hfEnv.refreshPack(name, root)`——**探测即顺手校正 `hfEnv` 的解析** |
| `feedUrl()` | 函数 | 与 `updater.ts` 同优先级：`getUpdaterSettings().feedUrl`（去尾斜杠、把非协议处的重复斜杠压成一个）→ 打包态 `resources/app-update.yml` / dev `dev-app-update.yml` 里的 `url:` 行 → 空串 |
| `resolveSevenZip()` | 函数 | 解包器：`<resources>/tools/7za.exe`（非 win32 为 `7za`）→ dev 下的 `build/tools/7za(.exe)`；都没有返回 `null` |
| `localPackDir()` | 函数 | 本地包目录：环境变量 `SHADOWMILL_RUNTIME_PACK`（指向文件则取其目录）→ 存在则用 `userData/runtime/local-import/`（设置页「从本地文件安装…」把 7z 与清单放这里）→ 空串 |
| `readLocalManifest(dir, name)` | 函数 | 读 `<dir>/<name>.json`，校验 `id` / `file` 非空且 `<dir>/<file>` 存在，否则 `null` |
| `httpText(url)` | 函数 | 用 Electron `net.request`（不是 `fetch`）取小文本（清单）：非 200 即 reject。注释说明 `IncomingMessage` 的类型只暴露 `statusCode` / `headers` / `on`，故运行时断言成 `NodeJS.ReadableStream` |
| `downloadToFile(url, dest, onProgress)` | 函数 | 断点续传下载，见 §3.3；**成功的字节落在 `<dest>.part`**，调用方校验通过后自己 rename |
| `sha512Of(file)` | 函数 | 流式 `sha512`（1 MB 高水位）返回 **base64**，与清单的 `sha512` 直接比较 |
| `fetchRemoteManifest(name)` | 函数 | GET `<feed><包名>.json`：`feed` 为空或以任何原因失败都返回 `null`（只写日志，文案由调用方给） |
| `extractPack(sevenZip, packFile, dest, name)` | 函数 | `spawn(7za, ['x', packFile, '-o' + dest, '-y', '-bsp1'], { windowsHide: true })`：`-bsp1` 让百分比打到 stdout，用「末尾 400 字符窗口 + 末个 `N%`」解析并推「正在准备运行环境 N%（<包名>）」，**同值不重复推**；`close` 时 `cancelRequested` 即 reject「已取消」，退出码非 0 则把 tail 最后一行带进错误 |
| `cleanupHalfDone(name, file, dest)` | 函数 | 取消后清半成品：解包目录（recursive）、`<file>.part`、`<file>`——**只在取消时删**，网络失败要留残片续传 |
| `isCancelError(e)` | 函数 | `cancelRequested` 为真、或错误信息含 `已取消下载`、或匹配 `/aborted|ERR_ABORTED/i` |
| `installOne(sevenZip, name)` | 函数 | 单包安装四段，见 §3.2 |
| `gc()` | 函数 | 两包都就位后删 legacy 目录与 `current.json` 并从 `packs.json` 删除 `legacy` 字段；`downloads/` 只保留当前各包 `<包名>-<id>.7z`。任何失败只忽略（占用中下次再清） |
| `runOnce(packs)` | 函数 | 一轮准备主流程，见 §3.1 |

## 3. 关键流程

### 3.1 `runOnce(packs)` —— 一轮准备

1. `state.packs = packs.slice()`；若 `cancelRequested` 直接 `cancelledResult()`。
2. `setPhase('checking', '正在检查运行环境…')`；`resolveSevenZip()` 失败 ⇒ `fail('运行环境无法准备：缺少解包程序', '未找到 7za.exe（应为 <resources>/tools/7za.exe）。请用 npm run pack / npm run dist 重新打包。', packs)`。
3. `syncStatus(packsStatus())` 后算 `state.missing`；**没有缺包** ⇒ `pack=null`、`percent=100`、`phase='ready'`、文案「运行环境已就绪」、推一次、`{ ok: true }`（这是「已装好」的常态）。
4. 取 `feed = feedUrl()` 与 `ldir = localPackDir()`；两者都为空 ⇒ `fail('运行环境尚未准备好，暂时无法使用渲染 / 转录转码功能', '更新源未配置且本机没有运行环境包（可用环境变量 SHADOWMILL_RUNTIME_PACK 指向本地包目录）。', state.missing)`。
5. 逐个装缺的包（每轮循环前判一次取消）：`installOne()` 抛错时——取消错误 ⇒ `cleanupHalfDone()` + 重算 `missing` + `cancelledResult()`；`NO_MANIFEST` ⇒ `fail('运行环境需要联网下载，但更新源上没有找到对应清单', '已尝试：<feed 或 (未配置更新源)><包名>.json；本地包目录：<ldir 或 (未设置)>', state.missing)`；`BADSHA` ⇒ `fail('运行环境下载校验失败（sha512 不符），已丢弃', '请重试；若反复失败请检查更新源上的 <包名>.7z 是否被改动。', state.missing)`；其它 ⇒ `fail('运行环境下载 / 解包失败', '<包名>：<原因>', state.missing)`。
6. 全部装完：重算 `missing`、`pack=null`、`percent=100`、`source='cache'`、`phase='ready'`、文案「运行环境已就绪」、推一次、`gc()`、返回 `{ ok: true }`。

### 3.2 `installOne()` —— 单包四段

| 段 | 行为 |
|---|---|
| ① 清单 | `readLocalManifest(localPackDir(), name)` 命中 ⇒ `source='local'` 且用本地 7z；否则 `setPhase('checking', '正在获取运行环境信息（<title>）…')` 再 `fetchRemoteManifest(name)`，拿不到抛 `NO_MANIFEST`。随后把清单的 `bytes` / `unpackedBytes` / `files` 写进 `state` |
| ② 下载 | 本地包直接跳过；否则看 `downloads/<包名>-<id>.7z`：**已存在且 sha512 相符就复用**（不重下）；否则 `setPhase('downloading', '正在下载运行环境（<title>，<体积>）…')` 并 `downloadToFile()`，边下边推「正在下载 <title> <已下> / <总量>（N%）」。下完复核 sha512：不符 ⇒ 删 `.part` 与正式名并抛 `BADSHA`；相符才 `renameSync(.part → cached)`（**内容不完整的一律不叫「已下载」**）并写日志（含续传起点与用时） |
| ③ 解包 | 先 `rmSync(dest, { recursive: true, force: true })` 清掉上次残留（否则半成品会被当成完整包），`setPhase('extracting', '正在准备运行环境（<title>）0%')`，再 `extractPack()` |
| ④ 落标记 | **先写 `<包名>/ok.json`**（`{ name, id, files, unpackedBytes, at }`），再写 `packs.json` 的 `packs[包名]` 记录；然后 `state.status[name]='ready'`、`hfEnv.refreshPack(name, dest)`、写「解包完成 id=… 用时 N 秒，来源 <source>」日志 |

### 3.3 下载与断点续传（`downloadToFile`）

- 残片固定在 `<dest>.part`；开下之前按它的体积定 `start`，`start > 0` 时带 `Range: bytes=<start>-`。
- 只在 `206 && start > 0` 时**追加**写；服务端忽略 Range 回 `200` ⇒ `start` 归零、从头覆盖（绝不能把新内容接在旧残片后面）。
- `total = append ? start + content-length : content-length`，`onProgress(got, total)` 驱动百分比。
- 返回 `{ bytes, resumedFrom, part }`；`activeReq` 指向当前请求（供取消），无论成败最后都置回 `null`。
- 非 200 / 206 一律 reject（带 HTTP 状态与 URL）。

### 3.4 取消语义

`cancelPrepare()`（框内「取消」/ 横幅「取消」/ 设置页「取消下载」三条路都到这里）⇒ 置 `cancelRequested`、`activeReq.abort()`、`activeChild.kill()`；主流程在每段边界判一次标志，抛出的取消错误被 `isCancelError()` 识别 ⇒ `cleanupHalfDone()` 清 `.part` 与半解目录 ⇒ `cancelledResult()`（`phase='cancelled'`、文案「已取消下载（运行环境未安装）」）。**取消不写 `packs.json`、不留半解目录、不产生任何下载**；网络中断则相反——残片保留，下次续传。

### 3.5 启动时序（`register`）

`register(ctx)` 里 `getWindow = ctx?.getWindow || null` → 注册三个 handle → **立即** `prepareInBackground()`：它只做几个 `existsSync` / `statSync` 探测（微秒级），随后推一次状态；重活（取清单、下载、解包）都要等用户确认后 `ensurePacks()` 才发生。`src/main/index.ts` 把 `runtime.register(ctx)` 排在装配序列最后，只是为了先挂上 handler。

### 3.6 老用户沿用与 `gc()`

旧版（安装包里带 `runtime.7z` 的那一版）的 `userData/runtime/<id>/` 里三样资源俱全，`legacyRoot()` 据此登记 `legacy`，`packsStatus()` 会把两包都判成「由 legacy 满足」（`state='ready'`、`legacy=true`）⇒ 升级后**不重下 147 MB**。当两个分包都真的就位（`installedEntry` 两包都命中）时 `gc()` 删掉 legacy 目录与 `current.json`，并清 `packs.json` 的 `legacy` 字段；`downloads/` 里非当前 id 的文件一并清掉。

### 3.7 与 `hfEnv` 的资源路径交接

本模块是 `packs.json` 与 `<包名>/ok.json` 的**唯一写入方**，也是 `current.json` 的**唯一读取方**（只读，不再写）。路径交接有两条：① `syncStatus()` / `missingPacks()` / `packsStatus()` 探测到某包就绪时 `hfEnv.refreshPack(name, root)`；② 解包完成时再 `refreshPack(name, dest)`。于是 `hfEnv.BUILTIN_RESOURCES` 的 `ffmpeg` / `ffprobe` / `hfCli` / `chromeShell` 等 getter 指向真正可用的包目录。

## 4. 依赖与协作

### 4.1 导入

| 来源 | 导入项 | 用途 |
|------|--------|------|
| `electron` | `app`、`ipcMain`、`net` | userData 路径与打包态判断、IPC 注册、HTTP（清单文本 + 包下载） |
| `electron`（类型） | `type ClientRequest` | `activeReq` 的类型（供 `abort()`） |
| `node:path` | `path`（默认导入） | 路径拼接、`path.join` 拼关键文件相对路径 |
| `node:fs` | `fs`（默认导入） | 状态文件、`ok.json`、`.part`、解包目录、下载缓存 |
| `node:crypto` | `crypto`（默认导入） | `sha512`（base64）校验 |
| `node:child_process` | `spawn`、`type ChildProcess` | 启动 `7za` 解包子进程（`activeChild` 供取消时 `kill()`） |
| `../shared/ipc` | `IPC` | 频道常量 |
| `../shared/types` | `type IpcResult`、`type RegisterCtx`、`type RuntimePackName`、`type RuntimePackState`、`type RuntimeProgressPayload` | 回执、注册上下文、包名与推送 / 回执载荷类型（③.6 节） |
| `./hfEnv` | `* as hfEnv` | `refreshPack()`（按包交接资源根）——不再主要依赖 `refreshBuiltinResources()` |
| `./settings` | `getUpdaterSettings` | 读 `feedUrl` 作为运行环境包的下载源（与 `updater.ts` 同优先级） |

> 本文件**不 import `dialog` / `shell`**：它不弹任何界面，失败信息经 `runtime:progress` / `runtime:prepare` 交给渲染层展示。

### 4.2 被谁使用

| 使用方 | 用法 |
|--------|------|
| `src/main/index.ts` | `runtime.register(ctx)`——装配顺序里**最后一个**（注释：启动只探测；排最后只保证 handler 先挂上） |
| `src/main/video.ts` | `video:render` 先 `runtime.missingPacks(['ffmpeg','hyperframes'])`，缺包即返回 `{ ok:false, needPacks, message }` |
| `src/main/projects.ts` | `project:extract-video-audio` 先 `runtime.missingPacks(['ffmpeg'])`，缺包即返回 `needPacks` |
| `src/main/ttsAlign.ts` | `voice:synth-aligned` 先 `runtime.missingPacks(['ffmpeg'])`，缺包即返回 `needPacks` |
| `src/main/whisper.ts` | 只在「非 wav/flac/mp3/ogg 要转码」且缺 ffmpeg 时用 `runtime.packSizeText(['ffmpeg'])` 组文案，并回 `needPacks:['ffmpeg']` |
| `src/main/hfEnv.ts` | 交接对端：接收 `refreshPack(name, root)`，据此重算该包根与 `cachedChrome` / `cachedNode` |
| `src/preload/index.ts` | `runtimeTools` 命名空间：`status` / `prepare(packs?)` / `cancel` / `onProgress`（单订阅）分别转发上述四个频道 |
| `src/renderer/src/composables/useRuntime.ts` | 模块级状态单例：`initRuntime()` 订阅 `runtime:progress` + 查一次 `runtime:status`，派生 `busy` / `failed` / `missing` / `hasMissing` / `ready` / `cancelable` / `missingText` 与 `prepare(packs?)` / `cancel()` |
| `src/renderer/src/composables/useEnvGate.ts` | 「需要下载运行环境」确认框：`guard(need, actionName, onContinue)` → `confirmDownload()`（内部 `rt.prepare(packs)`）/ `cancelDownload()` / `continueAction()`（**不自动续做**）。进度**不自己订阅** `runtime:progress`，而是 `watch(() => useRuntime().runtime.value, applyProgress, { deep: true })`——见 §5 的单订阅说明 |
| `src/renderer/src/App.vue`、`src/renderer/src/pages/SettingsPage/index.vue` | 外壳横幅（下载中 + 取消 / 缺包 + 下载 / 失败 + 重试）与设置页运行环境行（三态 + 「下载运行环境」/「取消下载」/「从本地文件安装…」） |

## 5. 注意事项与实现要点

- **`phase` 刻意放宽为 `string`**：与 `updater.ts` 同因——阶段由事件 / 异步回调跨函数写入，标注成 `RuntimePhase` 联合类型后 TS 的控制流分析会把最后一次赋值当成当前类型，后续比较被判「不可能分支」。交出前由 `payload()` 断言成 `RuntimeProgressPayload['phase']` 收口。
- **`ok.json` 是完整性标记，`packs.json` 是记录**：`installedEntry()` 要求「`packs.json` 有该包 `id`」**且**「目录内有 `ok.json`」**且**「关键文件都在」，三者缺一即视为未就绪并触发重下；解包成功时也**先写 `ok.json` 再写记录**——中途断电不会出现「记录指向一个没解完的目录」。
- **`current.json` 只读**：它是旧版布局留下的指针，只用于 legacy 判定与清理，新代码不再写它。老用户如果手动删掉 `userData/runtime/`，等同全新安装。
- **sha512 用 base64 与清单直接比较**：下载完成后必须复核，不符即刻删除残片并抛 `BADSHA`；已存在且校验相符的下载文件会**直接复用**，不重复下载（ffmpeg 实际 42.6 MB、hyperframes 实际 103.1 MB，两包合计 145.7 MB）。
- **只有取消才删残片**：`cleanupHalfDone()` 只挂在取消分支；网络中断 / 关进程都保留 `.part`，下次用 `Range` 续传。**服务端必须支持 Range**（否则回 200 从头下，见 `docs/runtime-pack-split.md` §8 的自检）。
- **`7za` 是随安装包的外部依赖**：只认 `<resources>/tools/7za.exe`（dev 为 `build/tools/7za.exe`），找不到直接 `fail` 并提示重新打包——**不要**试图回退到系统 `7z`。
- **本地包优先于下载**：`SHADOWMILL_RUNTIME_PACK` 或 `runtime/local-import/` 里的 `<包名>.json` + `<包名>.7z` 命中即走 `source='local'`（内网 / 离线机器靠这条与设置页导入入口）。
- **下载源与更新源同优先级**：`settings.json` 的 `updater.feedUrl` 优先，其次打包的 `app-update.yml`（dev 为 `dev-app-update.yml`）；`feedUrl()` 会裁掉尾斜杠并把非协议处的重复斜杠压成一个，再拼 `<包名>.json` / `<清单里的 file>`。
- **`percent` 语义**：`downloading` / `extracting` 阶段有效（下载按已下 / 总量，解包取 `7za -bsp1` 的百分比），`ready` 为 100；`payload()` 里统一 clamp 并 `Math.round`，渲染层拿到的一定是合法整数；`cancellable` 只在 `downloading` / `extracting` 为真。
- **失败不阻断应用**：任何一步失败都走 `fail()`——只更新 `state`（`phase='error'` + 人话 `message` + 排障 `detail`）、推一次进度、写一行 `runtime.log`，并返回 `{ ok:false, … }`。安装包自带 whisper，因此**离线首启时项目、音色、配音、转录、字幕、HTML 生成全部可用**，只有渲染 / 转码会缺包。
- **启动不再静默下载**：`prepareInBackground()` 只探测并推一次「运行环境需要下载（<体积>）」，是否下载由用户在某处确认（两包合计 145.7 MB：ffmpeg 42.6 + hyperframes 103.1）；`ensurePacks()` 忙碌期重复调用只返回一句提示，不排队。
- **旧包与下载目录会自清**：两包都就位后 `gc()` 删 legacy 目录（632 MB）与 `current.json`，并只保留当前各包 id 的下载缓存；被占用的下次再清。
- **`userData/runtime.log`**：与 `updater.log` / `startup.log` 同一套排障口子（超过 64KB 自动清一次），记录「启动探测失败」「取消」「远端清单不可用」「下载完成 + 续传起点 + 用时」「解包完成 + 用时 + 来源」「识别到旧版整体目录」等关键节点。
- **`register` 只注册三个 `handle` + 一路 `send`**：查询 / 准备 / 取消都是「问一次答一次」，没有主 → 渲染的独立命令通道；进度完全由 `runtime:progress` 单路推送。
- **不写 `settings.json`、不碰项目数据**：本模块只管理自己的 `userData/runtime/**`（`packs.json` + 各包目录与 `ok.json` + `downloads/` + `local-import/`），只**读** `settings.json` 的 `updater.feedUrl`。
