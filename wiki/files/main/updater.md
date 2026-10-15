# src/main/updater/（应用自更新）

> 应用自更新：`electron-updater` + electron-builder 的 generic provider（自建 HTTP 静态服务器）。**一个模块、四个文件**：同名目录 + `index.ts` 统一出口，对外接口与拆分前逐字相同。

- **覆盖文件**：`updater/index.ts`（108 行）、`updater/base.ts`（285 行）、`updater/actions.ts`（139 行）、`updater/install.ts`（134 行）——行数为工作区实测（`[IO.File]::ReadAllLines`）
- **所在目录**：src/main/updater/
- **类型**：业务域模块（`register(ctx)` 装配模式，全工程唯一使用**同步 IPC** 的模块）；拆分为「同名目录 + `index.ts` 统一出口」（形态与依赖方向属工程约定，见根 `AGENTS.md` 关键约定 9）
- **对外导出**（全部由 `index.ts` 再导出，与拆分前同名）：`register`、`checkNow`、`downloadUpdate`、`cancelDownload`、`installNow`、`isBusy`、`quitForUpdate`、`updaterLoadError`（**取值函数** `() => string`，不再是字符串）
- **IPC 域**：`update:check` / `update:download` / `update:cancel` / `update:install` / `update:status` / `update:open-log` / `update:changelog`（7 个 `handle`）、`update:version`（`on` + `event.returnValue`）、`update:progress`（推送）
- **调用方零改动**：`src/main/index.ts` 仍是 `import * as updater from './updater'`（目录索引解析到 `./updater/index.ts`），只用 `updater.register(ctx)` 与 `updater.quitForUpdate()`；preload 与渲染层完全不感知这次拆分

## 1. 四个文件的分工与依赖方向

| 文件 | 行数 | 职责 | 该文件的关键名字 |
| --- | --- | --- | --- |
| `index.ts` | 108 | **统一出口**：`register(ctx)` 装配 8 个 `update:*` 频道 + 3 秒启动静默检查 + 5 秒迟到清缓存；把各子文件的具名导出原样再导出；文件头保留全部设计约定（①～⑦） | `register`、`register()` 内的 `Update.OpenLog` handler、`register()` 内的 `Update.Changelog` handler、`export { getUpdaterLoadError as updaterLoadError }` |
| `base.ts` | 285 | **底座 / 依赖最上游**：运行态单例（`updater` 句柄 + `flags` + `state`）、日志与小工具（`writeLog` / `logPath` / `msg` / `errText` / `bytesText` / `appVersion`）、**随包更新日志的定位与读取**（`changelogPath()` / `readBundledChangelog()`）、`humanError()` 文案映射与 `setError()`、进度 `payload()` / `send()`、electron-updater 的 6 个事件绑定 `bindEvents()`、懒加载 `ensureUpdater()` | `updater`、`getUpdaterLoadError`、`flags`、`state`、`appVersion`、`logPath`、`writeLog`、`msg`、`errText`、`bytesText`、**`changelogPath`、`readBundledChangelog`**、`HumanError`、`humanError`、`setError`、`ensureUpdater`、`payload`、`send`、`bindEvents`、`UpdaterLike` / `UpdaterProgressLike` / `UpdaterInfoLike` |
| `actions.ts` | 139 | **对外动作**：`notReady()`、更新源覆盖 `applyFeedUrl()`（**私有**）、`checkNow()`、`downloadUpdate()`、`cancelDownload()`（含两条「无事件不许报成功」的守卫） | `notReady`、`checkNow`、`downloadUpdate`、`cancelDownload`、`isBusy`（本文件也有一份，当前无调用方，见 §5） |
| `install.ts` | 134 | **退出安装 / 缓存清理 / 忙碌推导**：`updaterCacheDir()`（私有）、`installMarkerPath()`（私有）、`finalizePendingUpdate()`、`installNow()`、`bindBusyTracking()`、`quitForUpdate()` | `finalizePendingUpdate`、`installNow`、`bindBusyTracking`、`isBusy`、`quitForUpdate` |

**依赖方向单向、不成环**（设计要求）：

```
index.ts  ──→  install.ts  ──→  actions.ts  ──→  base.ts
（出口）        （安装/清理）     （对外动作）      （状态/日志/事件，不 import 同目录任何模块）
```

- `index.ts` 从 `./base` 取 `flags` / `ensureUpdater` / `writeLog` / `payload` / `errText` / `logPath` / `appVersion` / `getUpdaterLoadError` / `readBundledChangelog`，从 `./actions` 取三个动作，从 `./install` 取 `installNow` / `finalizePendingUpdate` / `bindBusyTracking` / `isBusy` / `quitForUpdate`。
- `install.ts` 从 `./base` 取状态与小工具、从 `./actions` 取 `notReady`。
- `actions.ts` 只 import `./base` 与 `../settings`（**不 import `./install`**）。
- `base.ts` **一行同目录 import 都没有**——它是 `flags` / `state` / `updater` / `updaterLoadError` 的唯一宿主，所以四个文件之间不会互相 import 成环。

## 2. 对外接口（全部挂在 `index.ts` 上）

| 名称 | 定义在 | 类型 | 说明 |
| --- | --- | --- | --- |
| `register(ctx)` | `index.ts` | `(ctx: RegisterCtx) => void` | 记下 `flags.getWindow`、调 `bindBusyTracking()`、注册 8 个 `update:*` 频道、安排 3 秒启动静默检查与 5 秒迟到清缓存。**刻意不加载 electron-updater** |
| `checkNow(trigger)` | `actions.ts` | `(trigger: 'manual' \| 'startup') => Promise<结果>` | 真实发起一次检查；`trigger` 只进日志。五个返回分支（available / skipped / error / none / **静默放弃**）都带 `message` + `detail` |
| `downloadUpdate()` | `actions.ts` | `() => Promise<结果>` | 下载安装包（未处于 `available` / `skipped` 时拒绝）；失败分支与**静默放弃**分支都带 `message` + `detail` |
| `cancelDownload()` | `actions.ts` | `() => 结果` | 调 `autoUpdater.cancelDownload()` 并回到 `available` 态；异常时回 `{ ok: false, message: '取消下载失败，请重试', detail: '取消失败：…' }` |
| `installNow()` | `install.ts` | `() => 结果` | 忙碌或未下载完成时拒绝；否则置 `quitFlag` 后延时 300ms 调 `quitAndInstall(true, true)`（其异常写 message + detail） |
| `isBusy()` | `install.ts` | `() => boolean` | 长任务是否在跑（`installNow()` 的判据）；`index.ts` 重导出的是这一份 |
| `quitForUpdate()` | `install.ts` | `() => boolean` | 是否正在退出安装（供 `index.ts` 的 `window-all-closed` 判断） |
| `updaterLoadError` | `base.ts`（`getUpdaterLoadError`） | `() => string` | `require('electron-updater')` 失败时的原因文本；缺依赖时所有动作回 `notReady()`，它只出现在 `detail` 里。**是取值函数而不是字符串快照**，原因见 §5 |

### 2.1 `register(ctx)` 注册的频道（`index.ts`）

| 频道 | 注册方式 | 行为 |
| --- | --- | --- |
| `update:check` | `ipcMain.handle` | `checkNow('manual')` |
| `update:download` | `ipcMain.handle` | `downloadUpdate()` |
| `update:cancel` | `ipcMain.handle` | `cancelDownload()` |
| `update:install` | `ipcMain.handle` | `installNow()` |
| `update:version` | `ipcMain.on` | **同步**：`event.returnValue = appVersion()`，设置页首屏立刻显示，不必再等一轮 async 渲染（全工程唯一的同步 IPC） |
| `update:status` | `ipcMain.handle` | `payload()`——主进程状态常驻，设置页挂载时补一次；**不进 `ensureUpdater()`** |
| `update:open-log` | `ipcMain.handle` | `logPath()` → 有日志 `shell.showItemInFolder(p)`、没有则 `shell.openPath(app.getPath('userData'))`；返回 `{ ok: true, path }`，异常回 `{ ok: false, message: '打开日志目录失败', detail: errText(e) }`。**刻意不进 `ensureUpdater()`** |
| `update:changelog` | `ipcMain.handle` | `readBundledChangelog()`（`base.ts`）——读 `app.getAppPath()/CHANGELOG.md` 的**原文**交渲染层；失败回 `{ ok: false, message, detail }`（`没有找到更新日志文件` + 文件路径 / `读取更新日志失败` + 原始异常）。**只定位与读取、不做任何解析**，同样**刻意不进 `ensureUpdater()`** |
| `update:progress` | 由 `base.send()` 推送 | 主 → 渲染：阶段 / 版本 / 下载进度 / `message` / `detail` |

`register()` 末尾另有两个定时器：

- **3 秒启动静默检查**：`flags.checkedOnce` 已置则直接返回；否则先置真 → `getUpdaterSettings()`，`autoCheck` 为假时写日志 `startup check skipped: autoCheck=false` 并跳过 → 未打包且项目根没有 `dev-app-update.yml` 时写日志 `startup check skipped: dev 环境未提供 dev-app-update.yml` 并跳过 → `ensureUpdater()` 返回 null 则返回 → `void checkNow('startup')`。
- **5 秒迟到清缓存**：`finalizePendingUpdate()`。延迟是刻意的——别和首屏、启动检查抢时间；清缓存失败也只是少腾点磁盘。

### 2.2 `base.ts` 的运行态（跨文件共享的唯一宿主）

| 名字 | 形态 | 内容 |
| --- | --- | --- |
| `updater` | 导出对象 | `{ loadTried: boolean; instance: UpdaterLike \| null }`，初值 `{ loadTried: false, instance: null }`；`loadTried` 让 `ensureUpdater()` 只尝试一次（失败后不反复重试坏依赖） |
| `getUpdaterLoadError` | 导出取值函数 | `() => string`，读的是模块内私有的 `let updaterLoadError`（空串 = 已加载或尚未尝试） |
| `flags` | 导出对象 | `{ getWindow: (() => any) \| null; busy: boolean; quitFlag: boolean; checkedOnce: boolean }`，初值 `{ getWindow: null, busy: false, quitFlag: false, checkedOnce: false }`；`getWindow` 由 `register()` 写入，`busy` 由 `bindBusyTracking()` 推导，`quitFlag` 由 `installNow()` 置真，`checkedOnce` 由启动静默检查置真 |
| `state` | 导出对象 | `{ stage, version, currentVersion, percent, transferred, total, bps, message, detail, downloaded, error }`；初值 `stage: 'idle'`、`percent` / `transferred` / `total` / `bps` 全 0、`version` / `currentVersion` / `message` / `detail` / `error` 均为空串（`detail` / `error` 的类型是 `string \| undefined`，但初值是 `''`）、`downloaded: false` |

`state.stage` **刻意放宽为 `string`**：阶段由 electron-updater 的事件回调跨函数写入，若标注成 `UpdateStage` 联合类型，TS 的控制流分析会把函数内最后一次赋值当成当前类型，后续比较全被判成「不可能分支」（实测 9 处 `TS2367`）；交出前由私有的 `toStage()` 用白名单收敛（`idle` / `checking` / `available` / `skipped` / `downloading` / `downloaded` / `none` / `error`，不在表内落 `none`）。**这也是两条沉默守卫必须显式比较 `state.stage` 字符串、而不能依赖类型窄化的原因。**

其余底座设施：

- `appVersion()`：`app.getVersion()`，抛错回空串。
- 日志：`logPath()` = `userData/updater.log`（与 `preview-protocol.log` 同思路）；`writeLog(line)` 追加 `ISO 时间 + 空格 + line`，**写失败静默**（日志失败不影响更新流程）。
- 小工具：`msg(e)`（取 `e.message`，否则 `String(e)`）、`errText(e)`（同上，语义为「原始报错文本」）、`bytesText(n)`（小于 1024 回 `<n> B`；小于 1 MB 回一位小数 `KB`；否则回一位小数 `MB`）。
- **随包更新日志**：`changelogPath()` = `path.join(app.getAppPath(), 'CHANGELOG.md')`（dev = 项目根、打包后 = `app.asar` 根，两种形态命中同一份路径逻辑，与 `hfEnv` 读 `vendor/gsap` 同口径）；`readBundledChangelog()` 做存在性检查后 `readFileSync(file, 'utf8')`，返回 `{ ok: true, text }`；文件不存在回 `{ ok: false, message: '没有找到更新日志文件', detail: file }`，读取抛错回 `{ ok: false, message: '读取更新日志失败', detail: errText(e) }`。**只读原文、不解析**（分块与行内排版在渲染层 `@renderer/utils/changelog.ts`），与 `logPath()` / `update:open-log` 一样**刻意不依赖 electron-updater**。
- `payload()`：把常驻 `state` 收成一份 `UpdateProgressPayload`（`stage` 经 `toStage()`、`currentVersion` 为空时回落 `appVersion()`、`bytesPerSecond` 取自 `state.bps`）；`update:progress` 推送与 `update:status` 取用**共用同一个出口**。
- `send(extra?)`：`flags.getWindow()` 取窗口，`win && !win.isDestroyed()` 时 `webContents.send(IPC.Update.Progress, payload())`（抛错忽略）；给 `extra` 时顺带写一行日志。
- `bindEvents(u)`：**只在 `ensureUpdater()` 首次加载成功时绑一次**，共 6 个事件——`checking-for-update`（`checking` + `正在检查更新…`）、`update-available`（按 `skippedVersion` 命中与否落 `skipped` / `available`）、`update-not-available`（`none`）、`download-progress`（`downloading` + 百分比与字节数）、`update-downloaded`（`downloaded`）、`error`（`setError()`）。每次回调末尾都 `send()`（`update-available` / `update-downloaded` / `error` 另带一行日志）。
- `ensureUpdater()`：`loadTried` 已置则直接返回 `updater.instance`；否则置真并 `require('electron-updater')`，取 `mod.autoUpdater` 或 `mod.default.autoUpdater`，校验 `checkForUpdates` 是函数后：置 `autoDownload = false`、`autoInstallOnAppQuit = false`，dev（`!app.isPackaged`）且项目根存在 `dev-app-update.yml` 时 `try { forceDevUpdateConfig = true } catch {}`，最后 `bindEvents(instance)`。取不到或抛错时写 `updaterLoadError`（`electron-updater 未导出 autoUpdater（依赖未正确打包？）` / `electron-updater 加载失败：<errText>`）并落日志，返回 `null`。

### 2.3 `actions.ts` 的动作层

- `notReady()`：`{ ok: false, message: '更新模块不可用，请重新安装应用', detail: getUpdaterLoadError() || 'electron-updater 未加载' }`。技术原因（依赖没打包、模块没导出 `autoUpdater`）**只留在 `detail`**。
- `applyFeedUrl(u)`（**私有**）：`getUpdaterSettings().feedUrl` 去空白，为空则返回空串（走打包内置地址）；非空则 `u.setFeedURL({ provider: 'generic', url: feedUrl })` 并返回该地址；`setFeedURL` 抛错时写日志 `setFeedURL 失败: …` 并返回空串。
- `checkNow(trigger)`：`ensureUpdater()` → 空则 `notReady()`；`state.currentVersion = appVersion()` → `applyFeedUrl()` → 落 `checking` + `正在检查更新…` → 日志 `check start trigger=… feed=…`（feed 为空时记 `(app-update.yml)`）→ `await u.checkForUpdates()`。`catch` 里只有 `state.stage !== 'error'` 才补一次 `setError()`（事件回调与 Promise reject 会各报一次）；随后是**沉默守卫**与四个按 `state.stage` 分派的返回分支。
- `downloadUpdate()`：`ensureUpdater()` → 空则 `notReady()`；已 `downloaded` 直接回 `{ ok: true, version }`；不在 `available` / `skipped` 时回 `当前没有可下载的更新，请先检查更新`；处于 `skipped` 时先 `saveUpdaterSettings({ skippedVersion: '' })`（用户改主意要装，清掉跳过标记）→ 落 `downloading` + `正在下载更新…` + 日志 `download start` → `await u.downloadUpdate()`；`catch` 同上只补一次 `setError()`；随后是**下载沉默守卫**。
- `cancelDownload()`：`ensureUpdater()` → 空则 `notReady()`；有 `cancelDownload` 方法就调；成功则回到 `available` 态、清空进度、`已取消下载`、日志 `cancel`，回 `{ ok: true }`；抛错回 `{ ok: false, message: '取消下载失败，请重试', detail: '取消失败：' + msg(e) }`。
- `isBusy`：`() => flags.busy`（与 `install.ts` 的同名导出实现相同、当前无调用方，见 §5）。

### 2.4 `install.ts` 的安装层

- `updaterCacheDir()`（**私有**）：与 electron-updater 的 `cacheDir` **完全一致**——先按平台定 base（win32 `LOCALAPPDATA` 或 `~/AppData/Local`、darwin `~/Library/Caches`、其它 `XDG_CACHE_HOME` 或 `~/.cache`），目录名默认 `app.getName() + '-updater'`，再尝试从 `resources/app-update.yml` 里读 `updaterCacheDirName` 覆盖（读不到就落回默认名）。
- `installMarkerPath()`（**私有**）：`userData/update-installing.json`。
- `finalizePendingUpdate()`：读标记（没有标记 = 本次启动与更新安装无关，直接返回；读完即删标记）→ 标记里的版本与 `appVersion()` 不一致时写日志 `install marker 版本 … ≠ 当前 …（未装上或已回退），保留下载缓存` 并返回 → 一致则删除 `<cacheDir>/pending/` 下的条目（逐个 `rmSync`，单个失败不影响其余；删了才写一行日志）。**只清 `pending/`**：`cacheDir/installer.exe` 必须保留，它是 electron-updater 下次差分下载的旧文件基线。安装是否真的生效只能等下次启动比版本号，这就是标记文件的用处。
- `installNow()`：`ensureUpdater()` → 空则 `notReady()`；未 `downloaded` 回 `更新尚未下载完成`；`flags.busy` 时回 `当前有任务正在进行（转录 / 渲染 / 配音），请等任务结束后再重启安装`；随后弹原生 `dialog.showMessageBox`（窗口还在就以它为父），标题「重启并安装更新」、按钮「立即重启安装 / 取消」，`detail` 里写明「安装期间应用会关闭约 1~2 分钟、快捷方式会暂时失效、UAC 要点『是』」——这段预期必须提前说清楚，否则用户看到的是「应用莫名消失很久，点快捷方式说文件不存在」。用户取消（对话框异常时按继续处理）→ 日志 `quitAndInstall cancelled by user` + `{ ok: true, message: '已取消安装，可稍后再点「立即重启安装」' }`；确认则写标记 → `flags.quitFlag = true` → `state.message = '正在退出并安装更新…'` + 日志 `quitAndInstall <version>` → 300ms 后 `u.quitAndInstall(true, true)`，抛错时回滚 `quitFlag`、落 `error` + `启动安装程序失败，请重新下载安装包后手动安装` + `detail: 'quitAndInstall 失败：…'`。
- `bindBusyTracking()`：不改动任何业务模块，只监听 4 路进度通道的**起止**推导全局 `flags.busy`（明细见 §3.3）。
- `quitForUpdate()`：`() => flags.quitFlag`（与 `isBusy()` 同为本文件的两个只读出口）。

## 3. 关键流程

### 3.1 更新源优先级

```
settings.json 的 updater.feedUrl（非空）
  → autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })      ← 覆盖
留空
  → resources/app-update.yml（打包时由 package.json 的 build.publish 生成）
```

覆盖动作是 `actions.ts` 的私有 `applyFeedUrl()`，优先级判定也只在那一处。`app-update.yml` 由 `npm run dist` 产出，内容形如：

```yaml
provider: generic
url: https://chaoming-zhaoling.oss-cn-beijing.aliyuncs.com/shadowmill/
updaterCacheDirName: shadowmill-updater
```

> 本项目实际使用**阿里云 OSS**（bucket `chaoming-zhaoling`，北京 region）作为更新源。注意四点：
> ① `oss://bucket/path/` 是 OSS 内部协议标识，**不能**填进 `publish.url` —— electron-updater 只认 HTTP(S)，必须写成 `https://<bucket>.oss-cn-<region>.aliyuncs.com/<路径>/`；
> ② bucket 必须是**公共读**（generic provider 匿名 GET，无法签名），对象需支持 `Range` 请求（OSS 默认支持，差分下载依赖它）；
> ③ 路径**必须带尾斜杠**，否则会拼成 `.../shadowmilllatest.yml`。
> ④ `app-update.yml` 是**打包时由 `publish.url` 生成、烘进安装包**的静态文件 ⇒ 改 `publish.url` 只影响**之后**打出的包；存量已装版本（其包内 `app-update.yml` 还是旧前缀）要靠设置页「自定义更新源」过渡（`settings.updater.feedUrl` 优先级高于内置 yml，且 `runtime.ts` 的 `feedUrl()` 同样读它 ⇒ 自更新与运行环境包同源），或装上由新改动产出的包后清空该字段。
> 另外 electron-builder 的内置 provider 列表（Keygen / Generic / GitHub / S3 / Spaces / R2 / Snap）**不含阿里云 OSS**，generic 源不会自动上传，发版后需用 `ossutil cp` 手工上传三件套。
> `updaterCacheDirName` 由产品改名自动变化：它默认派生自 `app.getName()`（即 `package.json` 的 `name`），源码**未显式设置** `updaterCacheDirName`，故由 `my-app-updater` 变为 `shadowmill-updater`（已下载的旧缓存不会被自动继承）。

### 3.2 检查 → 下载 → 安装

```
任一入口（IPC / 启动静默检查）→ base.ensureUpdater()   ← 首次调用才 require electron-updater
  ├─ 成功：autoDownload=false、autoInstallOnAppQuit=false、bindEvents() 各一次
  │         dev（!app.isPackaged）且项目根有 dev-app-update.yml ⇒ forceDevUpdateConfig = true（try/catch 包住）
  └─ 失败：记 updaterLoadError + 写 userData/updater.log
           动作回 actions.notReady()：message「更新模块不可用，请重新安装应用」+ detail 技术原因
update:check → actions.checkNow('manual')
  → applyFeedUrl() → state.stage='checking' + 「正在检查更新…」→ 日志 check start trigger=… feed=…
  → autoUpdater.checkForUpdates()
  → 事件（base.bindEvents）：checking-for-update / update-available / update-not-available / error
  → 每次事件都经 send() 推 update:progress（含 stage / version / message / detail）
  → 沉默守卫：await 回来后 state.stage 仍是 'checking' ⇒ 全程无事件（未打包未强制 dev 时 return null，
     或复用了进行中的检查）⇒ 落 error + message「开发环境不检查更新」/「检查更新失败，请稍后重试」
     + 手写 detail（前半句按环境分叉，后半句固定为「原始信息：checkForUpdates() 未发出任何事件
     （返回 null 或复用了进行中的检查）。」）+ 日志 check declined trigger=… packaged=…，返回 { ok: false, … }
  → 五个返回分支（available / skipped / error / none / 静默放弃）都回带 message + detail
available / skipped 态下点「下载更新」→ update:download → actions.downloadUpdate()
  → 事件：download-progress（percent / transferred / total / bytesPerSecond）→ 频繁推送
  → 事件：update-downloaded → stage = downloaded（正常路径在 downloadUpdate() resolve 之前就发）
  → 沉默守卫：resolve 后仍是 'downloading' 且 !state.downloaded ⇒ 落 error
     + message「下载没有开始，请稍后重试」+ 手写 detail「原始信息：downloadUpdate() 未发出任何事件
     （既无下载进度，也没有 update-downloaded）。」+ 日志 download declined，返回 { ok: false, … }
update:install → install.installNow()
  → busy 检查 → quitFlag = true → 300ms 后 quitAndInstall(true, true)
update:status → base.payload()
  → 随时回一次当前状态（主进程 state 常驻，跨设置页挂载持续存在）
  → 设置页挂载时用它补齐「启动静默检查」那次失败（那次事件早于页面订阅 update:progress）
```

状态文案**主要由 `base.bindEvents()` 的事件回调产出**（available / skipped / none / 下载进度 / error），动作接口把当前态原样回带；渲染层不再自己拼一套，避免「同一状态两句话互相覆盖」。**例外是上面两条「沉默守卫」**：那种情况下没有任何事件回调可写文案，只能由 `actions.checkNow()` / `actions.downloadUpdate()` 自己成对写 `message` / `detail` 并落 `error`。

### 3.3 忙碌态判定（`install.bindBusyTracking()`，零侵入）

| 监听的通道 | 置忙条件 | 置闲条件 |
| --- | --- | --- |
| `whisper:progress` | `stage` 为 `downloading` / `loading` / `transcribing` | 其它 stage（含 `done` / `error`） |
| `video:progress` | 任意一条日志 | 无单独的「结束」事件，靠后续通道或用户操作复位 |
| `voice:align-progress` | `stage` 为 `synth` / `assemble` | `done` / `error` |
| `project:html-progress` | `stage !== 'done'` | `stage === 'done'` |

因为是「后到的通道覆盖全局标志」，多任务并发时最后一个置闲的通道会提前解除忙碌；`installNow()` 因此只把忙碌当作**尽力而为的保护**，真正的兜底是提示用户自行确认。

### 3.4 打开日志目录（`update:open-log`，`index.ts` 内的 handler）

```
renderer「打开日志目录」→ updateTools.openLog() → update:open-log
  └─ handler（不调用 ensureUpdater）
       ├─ p = logPath()（userData/updater.log）
       ├─ 日志存在 → shell.showItemInFolder(p)      在文件管理器里选中它
       ├─ 日志不存在 → shell.openPath(userData)     至少把目录打开
       └─ 返回 { ok: true, path: p }；异常 → { ok: false, message: '打开日志目录失败', detail: errText(e) }
```

它存在的原因与**出现时机**：`message` 只说人话（不含 `latest.yml` / 存储桶 / 请求 URL），真正的处置线索全在日志里。入口**只在更新确实出错时出现**——设置页用 `updateLogVisible = updateStage === 'error' || updateStatusClass === 'hf-error'` 控制它的 `v-if`：没出错时把用户送进日志目录没有意义（他看不懂日志），只会以为哪里坏了；出错时它是拿到原始报错的唯一出口。**启动静默检查的失败同样能看见**：那次失败发生在设置页订阅 `update:progress` 之前，页面 `onMounted` 在订阅之后用 `updateTools.status()` 补一次主进程状态（`stage` 非 `idle` 才套用），把 `error` 阶段连同这个入口一起带出来。它不依赖 electron-updater 能否加载，也不依赖任何更新状态——这两条理由不变。

### 3.5 查看更新日志（`update:changelog`，`index.ts` 内的 handler）

```
renderer「查看更新日志」→ updateTools.changelog() → update:changelog
  └─ handler（不调用 ensureUpdater）
       ├─ file = base.changelogPath()      → app.getAppPath()/CHANGELOG.md
       ├─ 文件不存在 → { ok: false, message: '没有找到更新日志文件', detail: file }
       ├─ 读取抛错   → { ok: false, message: '读取更新日志失败', detail: errText(e) }
       └─ 读到了     → { ok: true, text }   UTF-8 原文，一个字符都不改
```

它存在的理由：应用内原先没有「这个版本改了什么」的入口，更新日志只存在于仓库里。**主进程只做「定位 + 读取」**——分块（按 `## ` 切块、块内按**表头列名**映射条目，因为这份日志的表格有 5 列 / 4 列 / 3 列三套）、挑出「最新一版」、把行内 markdown 记号还原成纯文字，全部属于展示层，落在渲染层纯函数 `src/renderer/src/utils/changelog.ts`；界面是设置页「应用更新」第一排动作按钮里的「查看更新日志」与其弹窗 `ChangelogDialog.vue`（`v-if` 挂载即取一次、关掉即销毁）。弹窗**只显示最新一版**：一行「版本 / 时间」+ 每条一行「`[标签]` 标题」，**最多先 10 条**（`ENTRY_LIMIT`，超出给「展开全部 N 条」按钮），旧版收进「历史版本（N）」折叠区；**全模板纯文本渲染，没有 `v-html`**，解析器也不产出 HTML。

能读到内容的前提是 `CHANGELOG.md` 随包进 asar——`package.json` 的 `build.files` 里列了 `"CHANGELOG.md"`（与 `"README.md"` 并列），于是 `app.getAppPath()` 在 dev 与打包版都命中它。与 `update:open-log` / `update:status` 同理，这条 handler **刻意不进 `ensureUpdater()`**：看日志与 electron-updater 能否加载无关。

### 3.6 状态文案（主进程单点产出）

`state.message` 只在 `base.bindEvents()` 的事件回调与各动作入口里写，渲染层直接渲染、不再拼串（2026-10 起）：

| 触发点 | 所在文件 | stage | message（用户可见，逐字） |
| --- | --- | --- | --- |
| `checking-for-update` | `base.ts` | `checking` | `正在检查更新…` |
| `update-available`（该版本未被跳过） | `base.ts` | `available` | `发现新版本 <version>，可点「下载更新」获取安装包` |
| `update-available`（`skippedVersion` 命中该版本） | `base.ts` | `skipped` | `版本 <version> 已跳过，如需安装请点「下载更新」` |
| `update-not-available` | `base.ts` | `none` | `当前已是最新版本（<appVersion>）` |
| `download-progress` | `base.ts` | `downloading` | `正在下载更新 <n>%（<transferred> / <total>）`（字节数经 `bytesText`） |
| `update-downloaded` | `base.ts` | `downloaded` | `更新已下载（<version>），点「立即重启安装」完成更新（安装期间应用会关闭约 1~2 分钟）` |
| `error` 事件 / `setError()` | `base.ts` | `error` | 见 §5 的 `humanError()` 对照表第一列 |
| `checkNow()` 入口 | `actions.ts` | `checking` | `正在检查更新…` |
| **检查沉默守卫**（`checkNow()`） | `actions.ts` | `error` | 未打包：`开发环境不检查更新`；已打包：`检查更新失败，请稍后重试`（detail 见 §3.2 / §5） |
| `downloadUpdate()` 入口 | `actions.ts` | `downloading` | `正在下载更新…` |
| `downloadUpdate()` 前置校验失败 | `actions.ts` | — | `当前没有可下载的更新，请先检查更新` |
| **下载沉默守卫**（`downloadUpdate()`） | `actions.ts` | `error` | `下载没有开始，请稍后重试`（detail：`原始信息：downloadUpdate() 未发出任何事件（既无下载进度，也没有 update-downloaded）。`） |
| `cancelDownload()` 成功 / 异常 | `actions.ts` | 回到 `available` | `已取消下载` / `取消下载失败，请重试`（detail：`取消失败：…`） |
| `installNow()` 未下载完成 / 忙碌 | `install.ts` | — | `更新尚未下载完成` / `当前有任务正在进行（转录 / 渲染 / 配音），请等任务结束后再重启安装` |
| `installNow()` 被用户取消 | `install.ts` | — | `已取消安装，可稍后再点「立即重启安装」` |
| `installNow()` 即将退出安装 | `install.ts` | — | `正在退出并安装更新…` |
| `quitAndInstall` 抛错 | `install.ts` | `error` | `启动安装程序失败，请重新下载安装包后手动安装`（detail：`quitAndInstall 失败：…`） |
| 模块未加载（`notReady()`） | `actions.ts` | — | `更新模块不可用，请重新安装应用`（detail：`updaterLoadError \|\| 'electron-updater 未加载'`） |
| `update:open-log` handler 抛错 | `index.ts` | — | `打开日志目录失败`（detail：原始异常） |
| `update:changelog` handler 读不到文件 / 读失败 | `base.ts` | — | `没有找到更新日志文件`（detail：期望的文件绝对路径）/ `读取更新日志失败`（detail：原始异常）——这两条由 `readBundledChangelog()` 直接产出，展示在 `ChangelogDialog.vue` 的状态行里 |

## 4. 依赖与协作

**目录内 import**（单向）

| 文件 | import 自 | 引入内容 |
| --- | --- | --- |
| `index.ts` | `./base` | `flags`、`ensureUpdater`、`writeLog`、`payload`、`errText`、`logPath`、`appVersion`、`getUpdaterLoadError`、`readBundledChangelog` |
| `index.ts` | `./actions` | `checkNow`、`downloadUpdate`、`cancelDownload` |
| `index.ts` | `./install` | `installNow`、`finalizePendingUpdate`、`bindBusyTracking`、`isBusy`、`quitForUpdate` |
| `actions.ts` | `./base` | `state`、`flags`、`ensureUpdater`、`getUpdaterLoadError`、`appVersion`、`writeLog`、`msg`、`setError`、`humanError`、`send`、`errText`、类型 `UpdaterLike` |
| `install.ts` | `./base` | `state`、`flags`、`ensureUpdater`、`appVersion`、`writeLog`、`msg`、`send` |
| `install.ts` | `./actions` | `notReady` |

**目录外 import**

| 来源 | 引入内容 | 所在文件 |
| --- | --- | --- |
| `electron` | `app`、`ipcMain`、`shell`（`shell` 仅供 `update:open-log` 使用） | `index.ts`；`app` / `ipcMain` / `dialog` 由 `install.ts` 使用；`app` 由 `actions.ts` 使用 |
| `node:path` / `node:fs` / `node:os` | 日志落盘与追加写、`open-log` 前的 `existsSync` 判定、**随包 `CHANGELOG.md` 的定位与读取**（`base.changelogPath()` / `base.readBundledChangelog()`）、**dev 判定 `process.cwd()/dev-app-update.yml` 是否存在**（`register()` 的启动分支与 `ensureUpdater()` 各判一次）、缓存目录与标记文件的路径拼装（`os.homedir()` 供 `updaterCacheDir()`） | `index.ts` / `base.ts` / `install.ts` |
| `../shared/ipc` | `IPC`（含 `IPC.Update` 组） | `index.ts`（频道装配与 `send()` 的推送频道）、`base.ts`、`install.ts`（4 路进度通道名） |
| `../shared/types` | `RegisterCtx`、`UpdateCheckResult`、`UpdateProgressPayload`、`UpdateStage` | `index.ts` / `actions.ts` / `base.ts` |
| `../settings` | `getUpdaterSettings`、`saveUpdaterSettings` | `actions.ts`（读写更新设置）、`base.ts`（`update-available` 分支读 `skippedVersion`）、`index.ts`（启动静默检查读 `autoCheck`） |
| `electron-updater` | `ensureUpdater()` 内运行时 `require()` 取 `autoUpdater`（**不 import、也不在模块顶层 require**，见 §5） | `base.ts` |

**被谁引用 / 影响谁**

| 位置 | 关系 |
| --- | --- |
| `src/main/index.ts` | `import * as updater from './updater'`（目录索引 → `./updater/index.ts`）；`updater.register(ctx)`；`window-all-closed` 用 `updater.quitForUpdate()` 避让安装器 |
| `src/main/settings.ts` | 提供 `getUpdaterSettings()` / `saveUpdaterSettings()` 与 `settings:save-updater` |
| `src/preload/index.ts` | `updateTools` 命名空间（8 个方法 + 进度订阅）：`version` / `check` / `download` / `cancel` / `install` / `status` / `openLog` / **`changelog`** / `onProgress` |
| `src/renderer/src/pages/SettingsPage/components/UpdateSection.vue` | 「应用更新」区块：版本显示（`updateVersion` = 当前版本）/ 检查 / 下载 / 取消 / 重启安装 / 更新源设置 / **「查看更新日志」（`changelogVisible`，打开子组件 `ChangelogDialog.vue`，数据来自 `update:changelog`）** / 跳过版本（`updateNewVersion` = 待安装的目标版本，写入 `skippedVersion`）/ 「查看详情 · 收起详情」详情折叠 / 「打开日志目录」（**仅 `updateLogVisible` 时出现**）/ 挂载时用 `updateTools.status()` 补齐主进程状态 |

## 5. 注意事项与实现要点

### 5.1 拆分成目录带来的三处形态变化（都不是行为变化）

1. **跨文件共享的模块级 `let` 收进对象**：原先散在单文件里的 `getWindow` / `busy` / `quitFlag` / `checkedOnce` 四个 `let` 现在统一放进 `base.ts` 的 `flags` 对象；`state` 对象也迁到 `base.ts` 并 `export`。它们是「谁写谁读都从 base 走」的唯一共享点，因此不会出现「某文件各自留一份 let」。写入方：`flags.getWindow` ← `index.register()`；`flags.busy` ← `install.bindBusyTracking()`；`flags.quitFlag` ← `install.installNow()`；`flags.checkedOnce` ← `index.register()` 的启动静默检查。
2. **`updaterLoadError` 由字符串导出改为取值函数**：`index.ts` 里是 `export { getUpdaterLoadError as updaterLoadError } from './base'`，签名 `() => string`（实现在 `base.ts`，读模块内私有的 `let updaterLoadError`）。原因：这个值是在**懒加载那一刻**（`ensureUpdater()`）才写入的，跨文件后按值导出只会交出初始快照（永远是 `''`），读的人再也看不到真正的失败原因。**本仓库内没有调用方**（只有本模块自己写日志用），故直接改签名、不再保留旧的字符串导出。
3. **`ensureUpdater()` 从 index 内的私有函数变成 `base.ts` 的导出函数**：`actions.ts` 与 `install.ts` 都要用它，放在 `index.ts` 会与之成环；放在依赖最上游的 `base.ts` 后，依赖方向保持 `index → install → actions → base`。

> 附带一处重复定义（非本次拆分引入的行为变化）：`isBusy = (): boolean => flags.busy` 在 `actions.ts`（文件末）与 `install.ts`（两个只读出口处）各有一份，实现相同；`index.ts` 重导出的是 **`install.ts` 那份**，`actions.ts` 那份当前无调用方（本仓库内 `isBusy` 无任何外部调用点）。

### 5.2 其余实现要点

- **`electron-updater` 是运行时 `require`，不是 `import`**：它是 CJS 包（`main: out/main.js`，无 ESM 具名导出），`import { autoUpdater }` 会失败。整段 `require` 包在 `try` 里（在 `base.ensureUpdater()` 内），失败只记 `updaterLoadError`，**不会让主进程启动崩掉**。
- **懒加载是首屏优化的一部分**（2026-10 加入）：原先顶层 `require('electron-updater')` 会在**建窗之前**付出它的模块图加载成本（实测 ~70ms，冷启动 / 杀软扫描时更久），直接推迟首屏。现在 `register()` 完全不碰它，`ensureUpdater()` 在首次真正要用时才加载并完成一次 `bindEvents`；`autoCheck=false` 的用户更是整个会话都不会加载它。**注意**：`ensureUpdater()` 有 `updater.loadTried` 一次性标志，失败后不会反复重试（避免每次都卡在坏依赖上）。**`update:open-log` / `update:status` / `update:changelog` 是例外**——三者都不进 `ensureUpdater()`：前者在依赖加载失败时最需要（见 §3.4），`status` 只是把常驻的 `state` 读出来，`changelog` 只读一次随包文件，都与 electron-updater 能否加载无关。
- **`forceDevUpdateConfig` 只在 `base.ensureUpdater()` 里打开（2026-10 调整）**：`!app.isPackaged && fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'))` 成立时，用 `try { (autoUpdater as any).forceDevUpdateConfig = true } catch {}` 打开它。**理由**：手动检查与启动静默检查必须走同一条路——原先只有 `register()` 的启动分支会打开这个开关，于是「dev 里项目根放了 `dev-app-update.yml`、点『检查更新』却没反应」，而 3 秒后的静默检查反而能通。启动分支里那段重复的赋值**已删除**，只留一句注释指向 `ensureUpdater()`；启动分支的提前 return（dev 且无该文件 ⇒ 写日志 `startup check skipped: dev 环境未提供 dev-app-update.yml` 并跳过）保持不变。该文件名已进 `.gitignore`，**故 `npm run dev` 默认就是「不检查」**——这正是下面那条守卫要在界面上说清楚的事。
- **「有事件才算成功」的两条守卫（设计约定 ⑦，2026-10 加入）**：`actions.checkNow()` 在 `await u.checkForUpdates()` 之后、`if (state.stage === 'available')` 之前判 `state.stage === 'checking'`；`actions.downloadUpdate()` 在 `try/catch` 之后、`return { ok: true, version }` 之前判 `state.stage === 'downloading' && !state.downloaded`。两者都落 `error`、成对写 `message` / `detail`、写一行 `check declined` / `download declined` 日志并返回 `ok: false`。**依据**：electron-updater 在 `!isUpdaterActive()` 时 `checkForUpdates()` 直接 `return Promise.resolve(null)` 且不发任何事件（`isUpdaterActive()` = `app.isPackaged || forceDevUpdateConfig`）；已有检查在飞时它复用旧 Promise、同样不发新事件。`downloadUpdate()` 的正常路径则必然在 resolve 之前发 `update-downloaded`（其 `executeDownload` 里 `await taskOptions.done(...)`），所以「resolve 了却既无进度也无 downloaded 标记」等价于全程无事件。没有这两条守卫时，主进程自己写下的「正在检查更新…」/「正在下载更新…」会被当作终态送到界面，卡片永远停在那一句。
- **依赖由 electron-builder 自动收集**（2026-10 修正）：`build.files` 里**不再**有 `"!node_modules/**/*"` 与逐包白名单，`electron-updater` 及其传递依赖（`builder-util-runtime`、`debug`、`ms`、`sax`、`js-yaml`、`semver`、`fs-extra`、`lazy-val`、`lodash.*`、`tiny-typed-emitter` 等）由打包器按 `dependencies` 闭包自动纳入。
  **曾经的故障**：手写白名单时漏掉 `debug`（`builder-util-runtime/out/httpExecutor.js` 里 `require('debug')`）及其依赖 `ms`，安装版启动即 `Cannot find module 'debug'`，**自动更新整条功能不可用，而 dev 下永远正常**。漏依赖的表现是「dev 正常、安装版功能静默不可用」（因为 `ensureUpdater()` 的 `try` 把加载失败降级成了 `message` + `detail` 文案）。
  复核方式（只需确认关键包存在，不必再维护清单）：
  ```powershell
  npm run pack
  npx asar list dist\win-unpacked\resources\app.asar > list.txt
  findstr /C:"node_modules\debug\" list.txt      # 7 个文件
  findstr /C:"node_modules\ms\" list.txt         # 3 个文件
  ```
- **`npm run pack` 不生成 `app-update.yml`**：`--dir`（免安装目录）模式下不写更新配置，只有全量 `npm run dist` 才产出 `app-update.yml` 与 `latest.yml`。因此**验证更新功能必须用 `dist` 并安装后再试**。
- **`autoDownload = false` + `autoInstallOnAppQuit = false`**：下载必须用户点（源码注释：「安装包近百 MB，不在后台偷流量」；分包与 `electronLanguages` 收口后实测 `ShadowMill Setup 0.0.3.exe` = **105.08 MB**）；安装同样只由用户显式触发——NSIS 更新是「整体卸载旧版 → 解压复制新包」（实测一次约 97 秒），期间应用不存在、快捷方式指向空路径，这种长时间不可用不能因为「用户只是关了个窗」就在背后静默开始。
- **与 `window-all-closed` 的配合**：`quitAndInstall()` 会关闭窗口；若入口的 `window-all-closed` 再 `app.quit()` 会与安装器抢退出流程，故 `install.installNow()` 先置 `flags.quitFlag`，入口据此直接返回（`updater.quitForUpdate()`）。
- **dev 环境需 `dev-app-update.yml`**：未打包时需在项目根提供 `dev-app-update.yml`（内容同 `app-update.yml`）才会检查——`forceDevUpdateConfig` 由 `base.ensureUpdater()` 统一代为打开（见上文），启动静默检查则在缺该文件时直接跳过并写日志（该文件名已进 `.gitignore`）。
- **`update:version` 是全工程唯一的同步 IPC**：`ipcMain.on` + `event.returnValue`，只回版本号字符串，供设置页首屏显示；注册点在 `index.ts`。
- **错误文案分两层（`message` / `detail`，2026-10 加入）**：`base.humanError(raw)` 的返回类型是 `{ message: string; detail: string }`，`base.setError()` 用它一次性写全 `state`（`stage='error'` / `error` / `detail` / `message`），取代原先三处各写一半的写法。
  - `message` 是**终端用户看的**：只说「发生了什么 + 你能做什么」，**不许出现** `latest.yml` / 存储桶 / 匿名读取 / `app-update.yml` / `electron-updater` 这类只有发布者才懂的词——403 / 404 / 缺 `app-update.yml` 三种情况的真正处置动作都在发布者那一侧，用户看到「请把存储桶设为公共读」既做不了、也只会以为是自己弄坏了什么。**唯一的例外是「开发环境不检查更新」**：这条只可能出现在未打包的 dev（终端用户拿不到），它必须说清 `dev-app-update.yml` 才能让开发者知道下一步做什么。
  - `detail` 是**排障用的原始信息**，由 UI 的「查看详情」展开、并已全量落在 `updater.log`，能力一点没丢。构造方式是 `tail = (url ? '请求地址：' + url + '；' : '') + '原始报错：' + first`：
    - `first` = 原始报错**首行**（`.trim().split('\n')[0].slice(0, 300)`）——electron-updater 的报错后面跟的是 HTML 错误页 / 整段堆栈，首行足够定位，日志里有全量；
    - `url` = 从报错里用 `/url:\s*(\S+)/i` 抠出的**请求地址**，再 `.split('?')[0]` 去掉 electron-updater 自己加的 `noCache` 查询串。抠它是为了 403 / 404 能一眼看出「应用到底在请求哪个地址」（真实故障就是「装的是 0.0.2 找 `/shadowmill/`，而文件传在 `/MarvisStudio/`」——这是当时的历史情形，**前缀已于 2026-10-15 统一为 `/shadowmill/`，见 CHANGELOG #14**，不代表现况）；
    - 抠不到 URL 时 `tail` 退化成 `原始报错：<首行>`；兜底分支只给 `'原始报错：' + first`，不带请求地址。
  - **判断顺序不能变**：403 的报错文本里**必然包含请求 URL**（末尾就是 `latest.yml`），若先判 `latest\.yml` 就会把「权限被拒」误报成「文件没上传」，把人带偏到错误方向。

  | 匹配（按此顺序） | message（用户可见） | detail（排障，拼在 `tail` 之前的前缀） |
  | --- | --- | --- |
  | `403` / `forbidden` / `accessdenied` / `access denied` / `no right to access` / `bucket acl` / `unauthorized` / `401` | 更新服务暂时不可用，请稍后重试 | `更新源拒绝访问（403）：存储桶 / 对象需设为「公共读」，generic 更新源必须能被匿名下载。` + tail |
  | `404` / `not found` / `cannot find` | 暂时没有可用的新版本信息，请稍后重试 | `更新源上没有找到 latest.yml（尚未上传，或上传目录与更新源地址不一致）。` + tail |
  | `ENOTFOUND` / `EAI_AGAIN` / `ETIMEDOUT` / `ECONNREFUSED` / `ECONNRESET` / `net::` | 网络连接失败，请检查网络后重试 | `无法连接更新源。` + tail |
  | `sha512` / `checksum` | 安装包下载不完整，请重试 | `安装包校验失败（文件不完整或与服务端不一致）。` + tail |
  | `app-update\.yml` / `ENOENT` | 当前版本不支持自动更新，请到应用官网下载最新版本 | `本机缺少更新配置（app-update.yml），当前可能不是安装版。` + tail |
  | 兜底 | 更新失败，请稍后重试 | `原始报错：` + first（**不带**请求地址） |

  > 上表之外还有两条**不由 `humanError()` 产出**的 `error` 文案（两条沉默守卫，逐字见 §3.6）：`开发环境不检查更新` / `检查更新失败，请稍后重试`、`下载没有开始，请稍后重试`。它们没有原始异常可抠，`detail` 是手写的固定句子。
- **动作接口的失败分支也成对回带**：`checkNow()` 的 5 个返回分支、`downloadUpdate()` 的失败与静默放弃分支、`cancelDownload()` / `installNow()` 的异常分支都带 `message` + `detail`；`notReady()` 同样是双字段。
- **日志**：所有动作与事件写 `userData/updater.log`（与 `preview-protocol.log` 同思路），路径由 `base.logPath()` 单点产出、`base.writeLog()` 与 `index.ts` 的 `update:open-log` handler 共用；排查「检查更新失败」先看它，界面上则点「打开日志目录」。动作入口的行有 `check start trigger=` / `check declined trigger=` / `download start` / `download declined` / `cancel` / `quitAndInstall`，事件行有 `update-available <version>` / `update-downloaded <version>` / `error <原文>`，安装收尾另有 `install marker 版本 …` / `安装成功（…），已清理下载缓存 pending/ 共 N 项`。

## 6. 发版流程（**五类七个文件缺一不可**，推荐用 `npm run release` 自检）

```powershell
# 1. 升版本号（app.getVersion() 读的就是它）
npm version patch --no-git-tag-version

# 2. 全量打包：先打两个运行环境包（ffmpeg.7z / hyperframes.7z + 同名 .json，产出在 build/runtime-pack/），
#    再构建并出安装包；产出安装包 + latest.yml + .exe.blockmap
npm run dist

# 3. 一条命令检查 + 上传 + 远端自检（scripts/release.mjs）
npm run release -- --dry-run                     # 只检查本地文件齐不齐 + 远端匿名 GET / Range 自检
npm run release -- --copy .\publish              # 或 --rclone <remote:path> / --oss --bucket <bucket名>
#    不带任何后端参数等价于 --dry-run；--checklist 只打印手工上传清单

# 4. 必传的五个东西（generic provider 不会自动上传；缺 .blockmap ⇒ 客户端每次全量下）
#    dist\ShadowMill Setup <版本>.exe
#    dist\ShadowMill Setup <版本>.exe.blockmap      ← 差分下载靠它
#    dist\latest.yml                                ← 客户端检查更新的入口
#    build\runtime-pack\ffmpeg.7z      + ffmpeg.json
#    build\runtime-pack\hyperframes.7z  + hyperframes.json

# 5. 本地验证
npx http-server dist -p 8099
#    应用内「设置 → 应用更新 → 更新源」填 http://127.0.0.1:8099/
```

> **远端自检**（`release.mjs` 的 `verify()`）：对 `latest.yml`、`ffmpeg.json`、`hyperframes.json` 发匿名 GET + `Range: bytes=0-0`——`206` 表示支持 Range（断点续传与差量下载都依赖它），`200` 表示**不支持**（断点续传会退化为整包重下）。OSS 桶必须公共读（generic provider 匿名 GET）。
