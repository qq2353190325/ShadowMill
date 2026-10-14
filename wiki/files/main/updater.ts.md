# src/main/updater.ts

> 应用自更新：`electron-updater` + electron-builder 的 generic provider（自建 HTTP 静态服务器）

- **所在目录**：src/main/
- **类型**：业务域模块（`register(ctx)` 装配模式，唯一使用**同步 IPC** 的模块）
- **规模**：600 行
- **对外导出**：`register`、`checkNow`、`downloadUpdate`、`cancelDownload`、`installNow`、`isBusy`、`quitForUpdate`、`updaterLoadError`
- **IPC 域**：`update:check` / `update:download` / `update:cancel` / `update:install` / **`update:status`** / `update:open-log`（6 个 `handle`）、`update:version`（`on` + `event.returnValue`）、`update:progress`（推送）

## 1. 作用与职责

- **检查更新**：读更新源的 `latest.yml`，与 `app.getVersion()` 比较，得出「有新版本 / 已是最新 / 该版本已被用户跳过」三态。
- **下载更新**：仅由用户显式触发（`autoDownload = false`）；安装包带 `.blockmap`，electron-updater 会自动做差分下载。
- **退出安装**：`quitAndInstall(true, true)` 静默安装并重启；安装前检查本机是否有长任务在跑。
- **打开日志目录**：`update:open-log` 把用户 / 维护者送到 `userData/updater.log`（有日志则 `shell.showItemInFolder()` 选中文件，没有则 `shell.openPath(userData)` 打开目录），是更新失败时唯一的原始报错出口。它**刻意不经过 `ensureUpdater()`**：electron-updater 加载失败恰恰是最需要看日志的场景。设置页也只在更新确实出错时才显示这个入口（`updateLogVisible`，见 §3.4）。
- **状态补齐（`update:status`）**：`invoke` 一次即回一份 `payload()`；主进程更新状态 `state` 常驻（模块级），设置页反复挂载都能据此补出「启动静默检查」那次失败——那次事件发生在页面订阅之前，只靠 `update:progress` 永远看不到（见 §3.4）。
- **启动静默检查**：`register()` 末尾延时 3 秒做一次检查（受 `updater.autoCheck` 控制），只更新状态与设置页文案，不弹窗打扰。
- **检查 / 下载「有事件才算成功」（设计约定 ⑦，2026-10 加入）**：`electron-updater` 的 `checkForUpdates()` 有两种**一个字的事件都不发**的静默放弃——① 未打包且未置 `forceDevUpdateConfig` 时 `isUpdaterActive()` 为假，它直接 `return Promise.resolve(null)`；② 已有一次检查在飞时它复用同一个 Promise，同样不发新事件。此时若照样按成功回带，主进程自己写下的临时文案「正在检查更新…」就被当成终态送到渲染层，卡片永远停在那一句（表现为「点了检查像卡死」）。因此 `checkNow()` 在报成功之前必判一次「`state.stage` 是否还停在 `checking`」，`downloadUpdate()` 也做同类判断（见 §3.2）。
- **忙碌态判定**：不改动任何业务模块，靠监听 4 路进度通道的起止推导「本机是否有转录 / 渲染 / 配音任务在跑」。
- **electron-updater 懒加载**：`electron-updater` 的 `require` **不在启动路径上**——`register()` 只挂 IPC 与忙碌推导，模块加载推迟到 `ensureUpdater()`（首次真正要检查更新时，最早是启动 3s 后的静默检查）。目的是不把这份模块加载成本压在建窗 / 首屏之前。
- **文案分两层**：所有错误经 `humanError()` 产出 `{ message, detail }` 成对结果——`message` 只说人话给终端用户，`detail` 存原始报错（含请求地址）给排障；`setError()` 负责统一落态（见 §5）。**「静默放弃」的两条新文案不走 `humanError()`**（它们不是报错，没有原始异常可抠），由 `checkNow()` / `downloadUpdate()` 自己成对写下 `message` / `detail`。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `register(ctx)` | `(ctx: RegisterCtx) => void` | 绑定事件、注册 8 个 `update:*` 频道（4 个动作 + `status` 状态补齐 + `open-log` + 同步版本号 + 进度推送）、安排启动静默检查 |
| `checkNow(trigger)` | `(trigger: 'manual' \| 'startup') => Promise<结果>` | 真实发起一次检查；`trigger` 只进日志。五个返回分支（available / skipped / error / none / **静默放弃**）都带 `message` + `detail` |
| `downloadUpdate()` | `() => Promise<结果>` | 下载安装包（未处于 `available` / `skipped` 时拒绝）；失败分支与**静默放弃**分支都带 `message` + `detail` |
| `cancelDownload()` | `() => 结果` | 调 `autoUpdater.cancelDownload()` 并回到 `available` 态；异常时回 `{ ok: false, message: '取消下载失败，请重试', detail: '取消失败：…' }` |
| `installNow()` | `() => 结果` | 忙碌或未下载完成时拒绝；否则置 `quitFlag` 后延时 300ms 调 `quitAndInstall`（其异常写 message + detail） |
| `isBusy()` | `() => boolean` | 长任务是否在跑（`installNow` 的判据） |
| `quitForUpdate()` | `() => boolean` | 是否正在退出安装（供 `index.ts` 的 `window-all-closed` 判断） |
| `updaterLoadError` | `string` | `require('electron-updater')` 失败时的原因文本；缺依赖时所有动作回 `notReady()`，它只出现在 `detail` 里 |

内部辅助：`payload()`（把常驻的 `state` 收成一份 `UpdateProgressPayload`，`update:progress` 推送与 `update:status` 取用共用同一个出口）、`toStage()`（把放宽的 `state.stage` 收口成 `UpdateStage`）、`humanError()`（报错 → `{ message, detail }` 的文案分层，见 §5）、`setError()`（统一写 `state.stage='error'` / `state.error` / `state.detail` / `state.message`，取代原先三处各写一半的写法）、`logPath()`（`userData/updater.log` 绝对路径，`writeLog()` 与 `update:open-log` handler 共用）、`applyFeedUrl()`、`bindEvents()`、`bindBusyTracking()`、`ensureUpdater()`（懒加载 electron-updater，成功时顺带设开关 + 绑事件，只在 dev 且项目根有 `dev-app-update.yml` 时打开 `forceDevUpdateConfig`，只尝试一次）、`writeLog()`、`bytesText()`。

`state` 里除 `stage` / `version` / `message` / `error` 外还持有 `detail: '' as string | undefined`；每次进入 checking / available / none / downloaded / cancel 等新状态都会清空它（避免上一次的报错一直挂在卡片上），`payload()` 把它随 `update:progress` 一起下发。

各动作入口都先过 `ensureUpdater()`：返回 null（依赖不可用）即回 `notReady()` —— `{ ok: false, message: '更新模块不可用，请重新安装应用', detail: updaterLoadError || 'electron-updater 未加载' }`。技术原因（依赖没打包、模块没导出 `autoUpdater`）只留在 `detail`。

## 3. 关键流程

### 3.1 更新源优先级

```
settings.json 的 updater.feedUrl（非空）
  → autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })      ← 覆盖
留空
  → resources/app-update.yml（打包时由 package.json 的 build.publish 生成）
```

`app-update.yml` 由 `npm run dist` 产出，内容形如：

```yaml
provider: generic
url: https://chaoming-zhaoling.oss-cn-beijing.aliyuncs.com/shadowmill/
updaterCacheDirName: shadowmill-updater
```

> 本项目实际使用**阿里云 OSS**（bucket `chaoming-zhaoling`，北京 region）作为更新源。注意三点：
> ① `oss://bucket/path/` 是 OSS 内部协议标识，**不能**填进 `publish.url` —— electron-updater 只认 HTTP(S)，必须写成 `https://<bucket>.oss-cn-<region>.aliyuncs.com/<路径>/`；
> ② bucket 必须是**公共读**（generic provider 匿名 GET，无法签名），对象需支持 `Range` 请求（OSS 默认支持，差分下载依赖它）；
> ③ 路径**必须带尾斜杠**，否则会拼成 `.../shadowmilllatest.yml`。
> 另外 electron-builder 的内置 provider 列表（Keygen / Generic / GitHub / S3 / Spaces / R2 / Snap）**不含阿里云 OSS**，generic 源不会自动上传，发版后需用 `ossutil cp` 手工上传三件套。
> `updaterCacheDirName` 由产品改名自动变化：它默认派生自 `app.getName()`（即 `package.json` 的 `name`），源码**未显式设置** `updaterCacheDirName`，故由 `my-app-updater` 变为 `shadowmill-updater`（已下载的旧缓存不会被自动继承）。

### 3.2 检查 → 下载 → 安装

```
任一入口（IPC / 启动静默检查）→ ensureUpdater()   ← 首次调用才 require electron-updater
  ├─ 成功：autoDownload=false、autoInstallOnAppQuit=false、bindEvents() 各一次
  │         dev（!app.isPackaged）且项目根有 dev-app-update.yml ⇒ forceDevUpdateConfig = true（try/catch 包住）
  └─ 失败：记 updaterLoadError + 写 userData/updater.log
           动作回 notReady()：message「更新模块不可用，请重新安装应用」+ detail 技术原因
update:check → checkNow('manual')
  → applyFeedUrl() → state.stage='checking' + 「正在检查更新…」→ 日志 check start trigger=… feed=…
  → autoUpdater.checkForUpdates()
  → 事件：checking-for-update / update-available / update-not-available / error
  → 每次事件都经 send() 推 update:progress（含 stage / version / message / detail）
  → 沉默守卫：await 回来后 state.stage 仍是 'checking' ⇒ 全程无事件（未打包未强制 dev 时 return null，
     或复用了进行中的检查）⇒ 落 error + message「开发环境不检查更新」/「检查更新失败，请稍后重试」
     + detail「原始信息：checkForUpdates() 未发出任何事件（返回 null 或复用了进行中的检查）。」
     + 日志 check declined trigger=… packaged=…，返回 { ok: false, … }
  → 五个返回分支（available / skipped / error / none / 静默放弃）都回带 message + detail
update:available 态下点「下载更新」→ update:download → downloadUpdate()
  → 事件：download-progress（percent / transferred / total / bytesPerSecond）→ 频繁推送
  → 事件：update-downloaded → stage = downloaded（正常路径在 downloadUpdate() resolve 之前就发）
  → 沉默守卫：resolve 后仍是 'downloading' 且 !state.downloaded ⇒ 落 error
     + message「下载没有开始，请稍后重试」+ detail「原始信息：downloadUpdate() 未发出任何事件
     （既无下载进度，也没有 update-downloaded）。」+ 日志 download declined，返回 { ok: false, … }
update:install → installNow()
  → busy 检查 → quitFlag = true → 300ms 后 quitAndInstall(true, true)
update:status → payload()
  → 随时回一次当前状态（主进程 state 常驻，跨设置页挂载持续存在）
  → 设置页挂载时用它补齐「启动静默检查」那次失败（那次事件早于页面订阅 update:progress）
```

状态文案**主要由 `bindEvents()` 的事件回调产出**（available / skipped / none / 下载进度 / error），动作接口把当前态原样回带；渲染层不再自己拼一套，避免「同一状态两句话互相覆盖」。**例外是上面两条「沉默守卫」**：那种情况下没有任何事件回调可写文案，只能由动作入口自己成对写 `message` / `detail` 并落 `error`。

### 3.3 忙碌态判定（零侵入）

| 监听的通道 | 置忙条件 | 置闲条件 |
| --- | --- | --- |
| `whisper:progress` | `stage` 为 `downloading` / `loading` / `transcribing` | 其它 stage（含 `done` / `error`） |
| `video:progress` | 任意一条日志 | 无单独的「结束」事件，靠后续通道或用户操作复位 |
| `voice:align-progress` | `stage` 为 `synth` / `assemble` | `done` / `error` |
| `project:html-progress` | `stage !== 'done'` | `stage === 'done'` |

因为是「后到的通道覆盖全局标志」，多任务并发时最后一个置闲的通道会提前解除忙碌；`installNow()` 因此只把忙碌当作**尽力而为的保护**，真正的兜底是提示用户自行确认。

### 3.4 打开日志目录（`update:open-log`）

```
renderer「打开日志目录」→ updateTools.openLog() → update:open-log
  └─ handler（不调用 ensureUpdater）
       ├─ p = logPath()（userData/updater.log）
       ├─ 日志存在 → shell.showItemInFolder(p)      在文件管理器里选中它
       ├─ 日志不存在 → shell.openPath(userData)     至少把目录打开
       └─ 返回 { ok: true, path: p }；异常 → { ok: false, message: '打开日志目录失败', detail: errText(e) }
```

它存在的原因与**出现时机**：`message` 只说人话（不含 `latest.yml` / 存储桶 / 请求 URL），真正的处置线索全在日志里。入口**只在更新确实出错时出现**——设置页用 `updateLogVisible = updateStage === 'error' || updateStatusClass === 'hf-error'` 控制它的 `v-if`：没出错时把用户送进日志目录没有意义（他看不懂日志），只会以为哪里坏了；出错时它是拿到原始报错的唯一出口。**启动静默检查的失败同样能看见**：那次失败发生在设置页订阅 `update:progress` 之前，页面 `onMounted` 在订阅之后用 `updateTools.status()` 补一次主进程状态（`stage` 非 `idle` 才套用），把 `error` 阶段连同这个入口一起带出来。它不依赖 electron-updater 能否加载，也不依赖任何更新状态——这两条理由不变。

### 3.5 状态文案（主进程单点产出）

`state.message` 只在 `bindEvents()` 的事件回调与各动作入口里写，渲染层直接渲染、不再拼串（2026-10 起）：

| 触发点 | stage | message（用户可见，逐字） |
| --- | --- | --- |
| `checking-for-update` | `checking` | `正在检查更新…` |
| `update-available`（该版本未被跳过） | `available` | `发现新版本 <version>，可点「下载更新」获取安装包` |
| `update-available`（`skippedVersion` 命中该版本） | `skipped` | `版本 <version> 已跳过，如需安装请点「下载更新」` |
| `update-not-available` | `none` | `当前已是最新版本（<appVersion>）` |
| `download-progress` | `downloading` | `正在下载更新 <n>%（<transferred> / <total>）`（字节数经 `bytesText`） |
| `update-downloaded` | `downloaded` | `更新已下载（<version>），点「立即重启安装」完成更新（安装期间应用会关闭约 1~2 分钟）` |
| `error` 事件 / `setError()` | `error` | 见 §5 的 `humanError()` 对照表第一列 |
| `downloadUpdate()` 入口 | `downloading` | `正在下载更新…` |
| `downloadUpdate()` 前置校验失败 | — | `当前没有可下载的更新，请先检查更新` |
| **检查沉默守卫**（`checkNow()`） | `error` | 未打包：`开发环境不检查更新`；已打包：`检查更新失败，请稍后重试`（detail 见 §3.2 / §5） |
| **下载沉默守卫**（`downloadUpdate()`） | `error` | `下载没有开始，请稍后重试`（detail：`原始信息：downloadUpdate() 未发出任何事件（既无下载进度，也没有 update-downloaded）。`） |
| `cancelDownload()` 成功 / 异常 | 回到 `available` | `已取消下载` / `取消下载失败，请重试`（detail：`取消失败：…`） |
| `installNow()` 未下载完成 / 忙碌 | — | `更新尚未下载完成` / `当前有任务正在进行（转录 / 渲染 / 配音），请等任务结束后再重启安装` |
| `installNow()` 即将退出安装 | — | `正在退出并安装更新…` |
| `quitAndInstall` 抛错 | `error` | `启动安装程序失败，请重新下载安装包后手动安装`（detail：`quitAndInstall 失败：…`） |
| 模块未加载（`notReady()`） | — | `更新模块不可用，请重新安装应用`（detail：`updaterLoadError \|\| 'electron-updater 未加载'`） |
| `update:open-log` handler 抛错 | — | `打开日志目录失败`（detail：原始异常） |

**检查沉默守卫的两条 detail 是拼出来的**（前半句按环境分叉，后半句固定）：

```ts
state.detail = (dev
  ? '当前是未打包的开发环境：electron-updater 在 app.isPackaged 为假时不会发起检查（需在项目根放 dev-app-update.yml 强制开启）。'
  : '更新模块没有返回任何结果。') + '原始信息：checkForUpdates() 未发出任何事件（返回 null 或复用了进行中的检查）。'
```

## 4. 依赖与协作

**import**

| 来源 | 引入内容 |
| --- | --- |
| `electron` | `app`、`ipcMain`、`shell`（`shell` 仅供 `update:open-log` 使用） |
| `node:path` / `node:fs` | 日志落盘路径与追加写、`open-log` 前的 `existsSync` 判定、**dev 判定 `process.cwd()/dev-app-update.yml` 是否存在**（`ensureUpdater()` 与 `register()` 的启动分支各判一次） |
| `../shared/ipc` | `IPC`（含 `IPC.Update` 组） |
| `../shared/types` | `RegisterCtx`、`UpdateCheckResult`、`UpdateProgressPayload`、`UpdateStage` |
| `./settings` | `getUpdaterSettings`、`saveUpdaterSettings` |
| `electron-updater` | `ensureUpdater()` 内运行时 `require()` 取 `autoUpdater`（**不 import、也不在模块顶层 require**，见 §5） |

**被谁引用 / 影响谁**

| 位置 | 关系 |
| --- | --- |
| `src/main/index.ts` | `updater.register(ctx)`；`window-all-closed` 用 `updater.quitForUpdate()` 避让安装器 |
| `src/main/settings.ts` | 提供 `getUpdaterSettings()` / `saveUpdaterSettings()` 与 `settings:save-updater` |
| `src/preload/index.ts` | `updateTools` 命名空间（7 个方法 + 进度订阅）：`version` / `check` / `download` / `cancel` / `install` / `status` / `openLog` / `onProgress` |
| `src/renderer/src/pages/SettingsPage/index.vue` | 「应用更新」卡片：版本显示（`updateVersion` = 当前版本）/ 检查 / 下载 / 取消 / 重启安装 / 更新源设置 / 跳过版本（`updateNewVersion` = 待安装的目标版本，写入 `skippedVersion`）/ 「查看详情 · 收起详情」详情折叠 / 「打开日志目录」（**仅 `updateLogVisible` 时出现**）/ 挂载时用 `updateTools.status()` 补齐主进程状态 |

## 5. 注意事项与实现要点

- **`electron-updater` 是运行时 `require`，不是 `import`**：它是 CJS 包（`main: out/main.js`，无 ESM 具名导出），`import { autoUpdater }` 会失败。整段 `require` 包在 `try` 里，失败只记 `updaterLoadError`，**不会让主进程启动崩掉**。
- **懒加载是首屏优化的一部分**（2026-10 加入）：原先顶层 `require('electron-updater')` 会在**建窗之前**付出它的模块图加载成本（实测 ~70ms，冷启动 / 杀软扫描时更久），直接推迟首屏。现在 `register()` 完全不碰它，`ensureUpdater()` 在首次真正要用时才加载并完成一次 `bindEvents`；`autoCheck=false` 的用户更是整个会话都不会加载它。**注意**：`ensureUpdater()` 有 `updaterLoadTried` 一次性标志，失败后不会反复重试（避免每次都卡在坏依赖上）。**`update:open-log` 与 `update:status` 是例外**——两者都不进 `ensureUpdater()`：前者在依赖加载失败时最需要（见 §3.4），后者只是把常驻的 `state` 读出来，与 electron-updater 能否加载无关。
- **`forceDevUpdateConfig` 只在 `ensureUpdater()` 里打开（2026-10 调整）**：`!app.isPackaged && fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'))` 成立时，用 `try { (autoUpdater as any).forceDevUpdateConfig = true } catch {}` 打开它。**理由**：手动检查与启动静默检查必须走同一条路——原先只有 `register()` 的启动分支会打开这个开关，于是「dev 里项目根放了 `dev-app-update.yml`、点『检查更新』却没反应」，而 3 秒后的静默检查反而能通。启动分支里那段重复的赋值**已删除**，只留一句注释指向 `ensureUpdater()`；启动分支的提前 return（dev 且无该文件 ⇒ 写日志 `startup check skipped: dev 环境未提供 dev-app-update.yml` 并跳过）保持不变。该文件名已进 `.gitignore`，**故 `npm run dev` 默认就是「不检查」**——这正是下面那条守卫要在界面上说清楚的事。
- **「有事件才算成功」的两条守卫（设计约定 ⑦，2026-10 加入）**：`checkNow()` 在 `await u.checkForUpdates()` 之后、`if (state.stage === 'available')` 之前判 `state.stage === 'checking'`；`downloadUpdate()` 在 `try/catch` 之后、`return { ok: true, version }` 之前判 `state.stage === 'downloading' && !state.downloaded`。两者都落 `error`、成对写 `message` / `detail`、写一行 `check declined` / `download declined` 日志并返回 `ok: false`。**依据**：electron-updater 在 `!isUpdaterActive()` 时 `checkForUpdates()` 直接 `return Promise.resolve(null)` 且不发任何事件（`isUpdaterActive()` = `app.isPackaged || forceDevUpdateConfig`）；已有检查在飞时它复用旧 Promise、同样不发新事件。`downloadUpdate()` 的正常路径则必然在 resolve 之前发 `update-downloaded`（其 `executeDownload` 里 `await taskOptions.done(...)`），所以「resolve 了却既无进度也无 downloaded 标记」等价于全程无事件。没有这两条守卫时，主进程自己写下的「正在检查更新…」/「正在下载更新…」会被当作终态送到界面，卡片永远停在那一句。
- **依赖由 electron-builder 自动收集**（2026-10 修正）：`build.files` 里**不再**有 `"!node_modules/**/*"` 与逐包白名单，`electron-updater` 及其传递依赖（`builder-util-runtime`、`debug`、`ms`、`sax`、`js-yaml`、`semver`、`fs-extra`、`lazy-val`、`lodash.*`、`tiny-typed-emitter` 等）由打包器按 `dependencies` 闭包自动纳入。
  **曾经的故障**：手写白名单时漏掉 `debug`（`builder-util-runtime/out/httpExecutor.js` 里 `require('debug')`）及其依赖 `ms`，安装版启动即 `Cannot find module 'debug'`，**自动更新整条功能不可用，而 dev 下永远正常**。漏依赖的表现是「dev 正常、安装版功能静默不可用」（因为本节第一点的 `try` 把加载失败降级成了 `message` + `detail` 文案）。
  复核方式（只需确认关键包存在，不必再维护清单）：
  ```powershell
  npm run pack
  npx asar list dist\win-unpacked\resources\app.asar > list.txt
  findstr /C:"node_modules\debug\" list.txt      # 7 个文件
  findstr /C:"node_modules\ms\" list.txt         # 3 个文件
  ```
- **`npm run pack` 不生成 `app-update.yml`**：`--dir`（免安装目录）模式下不写更新配置，只有全量 `npm run dist` 才产出 `app-update.yml` 与 `latest.yml`。因此**验证更新功能必须用 `dist` 并安装后再试**。
- **`stage` 刻意放宽为 `string`**：阶段由 electron-updater 的事件回调跨函数写入，若标注成 `UpdateStage` 联合类型，TS 的控制流分析会把函数内最后一次赋值当成当前类型，导致后续比较全被判成「不可能分支」（实测 9 处 `TS2367`）。交出前由 `toStage()` 白名单收口。**这也是两条沉默守卫必须显式比较 `state.stage` 字符串、而不能依赖类型窄化的原因。**
- **`autoDownload = false` + `autoInstallOnAppQuit = false`**：下载必须用户点（安装包近 300 MB）；安装同样只由用户显式触发——NSIS 更新是「整体卸载旧版 → 解压复制新包」（实测一次约 97 秒），期间应用不存在、快捷方式指向空路径，这种长时间不可用不能因为「用户只是关了个窗」就在背后静默开始。
- **与 `window-all-closed` 的配合**：`quitAndInstall()` 会关闭窗口；若入口的 `window-all-closed` 再 `app.quit()` 会与安装器抢退出流程，故 `installNow()` 先置 `quitFlag`，入口据此直接返回。
- **dev 环境需 `dev-app-update.yml`**：未打包时需在项目根提供 `dev-app-update.yml`（内容同 `app-update.yml`）才会检查——`forceDevUpdateConfig` 由 `ensureUpdater()` 统一代为打开（见上文），启动静默检查则在缺该文件时直接跳过并写日志（该文件名已进 `.gitignore`）。
- **`update:version` 是全工程唯一的同步 IPC**：`ipcMain.on` + `event.returnValue`，只回版本号字符串，供设置页首屏显示。
- **错误文案分两层（`message` / `detail`，2026-10 加入）**：`humanError(raw)` 的返回类型是 `{ message: string; detail: string }`，`setError()` 用它一次性写全 `state`。
  - `message` 是**终端用户看的**：只说「发生了什么 + 你能做什么」，**不许出现** `latest.yml` / 存储桶 / 匿名读取 / `app-update.yml` / `electron-updater` 这类只有发布者才懂的词——403 / 404 / 缺 `app-update.yml` 三种情况的真正处置动作都在发布者那一侧，用户看到「请把存储桶设为公共读」既做不了、也只会以为是自己弄坏了什么。**唯一的例外是「开发环境不检查更新」**：这条只可能出现在未打包的 dev（终端用户拿不到），它必须说清 `dev-app-update.yml` 才能让开发者知道下一步做什么。
  - `detail` 是**排障用的原始信息**，由 UI 的「查看详情」展开、并已全量落在 `updater.log`，能力一点没丢。构造方式是 `tail = (url ? '请求地址：' + url + '；' : '') + '原始报错：' + first`：
    - `first` = 原始报错**首行**（`.trim().split('\n')[0].slice(0, 300)`）——electron-updater 的报错后面跟的是 HTML 错误页 / 整段堆栈，首行足够定位，日志里有全量；
    - `url` = 从报错里用 `/url:\s*(\S+)/i` 抠出的**请求地址**，再 `.split('?')[0]` 去掉 electron-updater 自己加的 `noCache` 查询串。抠它是为了 403 / 404 能一眼看出「应用到底在请求哪个地址」（真实故障就是「装的是 0.0.2 找 `/shadowmill/`，而文件传在 `/MarvisStudio/`」）；
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

  > 上表之外还有两条**不由 `humanError()` 产出**的 `error` 文案（两条沉默守卫，逐字见 §3.5）：`开发环境不检查更新` / `检查更新失败，请稍后重试`、`下载没有开始，请稍后重试`。它们没有原始异常可抠，`detail` 是手写的固定句子。

- **动作接口的失败分支也成对回带**：`checkNow()` 的 5 个返回分支、`downloadUpdate()` 的失败与静默放弃分支、`cancelDownload()` / `installNow()` 的异常分支都带 `message` + `detail`；`notReady()` 同样是双字段。
- **日志**：所有动作与事件写 `userData/updater.log`（与 `preview-protocol.log` 同思路），路径由 `logPath()` 单点产出、`writeLog()` 与 `update:open-log` 共用；排查「检查更新失败」先看它，界面上则点「打开日志目录」。动作入口的行有 `check start trigger=` / `check declined trigger=` / `download start` / `download declined` / `cancel` / `quitAndInstall`，事件行有 `update-available <version>` / `update-downloaded <version>` / `error <原文>`。

## 6. 发版流程（三个文件缺一不可）

```powershell
# 1. 升版本号（app.getVersion() 读的就是它）
npm version patch --no-git-tag-version

# 2. 全量打包（产出安装包 + latest.yml + .blockmap）
npm run dist

# 3. 上传到更新源（generic provider 不会自动上传）
#    dist\ShadowMill Setup <版本>.exe
#    dist\ShadowMill Setup <版本>.exe.blockmap      ← 差分下载靠它，不传则每次全量下
#    dist\latest.yml                                ← 客户端检查更新的入口

# 4. 本地验证
npx http-server dist -p 8099
#    应用内「设置 → 应用更新 → 更新源」填 http://127.0.0.1:8099/
```
