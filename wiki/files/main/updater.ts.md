# src/main/updater.ts

> 应用自更新：`electron-updater` + electron-builder 的 generic provider（自建 HTTP 静态服务器）

- **所在目录**：src/main/
- **类型**：业务域模块（`register(ctx)` 装配模式，唯一使用**同步 IPC** 的模块）
- **规模**：378 行
- **对外导出**：`register`、`checkNow`、`downloadUpdate`、`cancelDownload`、`installNow`、`isBusy`、`quitForUpdate`、`updaterLoadError`
- **IPC 域**：`update:check` / `update:download` / `update:cancel` / `update:install`（`handle`）、`update:version`（`on` + `event.returnValue`）、`update:progress`（推送）

## 1. 作用与职责

- **检查更新**：读更新源的 `latest.yml`，与 `app.getVersion()` 比较，得出「有新版本 / 已是最新 / 该版本已被用户跳过」三态。
- **下载更新**：仅由用户显式触发（`autoDownload = false`）；安装包带 `.blockmap`，electron-updater 会自动做差分下载。
- **退出安装**：`quitAndInstall(true, true)` 静默安装并重启；安装前检查本机是否有长任务在跑。
- **启动静默检查**：`register()` 末尾延时 3 秒做一次检查（受 `updater.autoCheck` 控制），只更新状态与设置页文案，不弹窗打扰。
- **忙碌态判定**：不改动任何业务模块，靠监听 4 路进度通道的起止推导「本机是否有转录 / 渲染 / 配音任务在跑」。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `register(ctx)` | `(ctx: RegisterCtx) => void` | 绑定事件、注册 6 个 `update:*` 频道、安排启动静默检查 |
| `checkNow(trigger)` | `(trigger: 'manual' \| 'startup') => Promise<结果>` | 真实发起一次检查；`trigger` 只进日志 |
| `downloadUpdate()` | `() => Promise<结果>` | 下载安装包（未处于 `available` / `skipped` 时拒绝） |
| `cancelDownload()` | `() => 结果` | 调 `autoUpdater.cancelDownload()` 并回到 `available` 态 |
| `installNow()` | `() => 结果` | 忙碌或未下载完成时拒绝；否则置 `quitFlag` 后延时 300ms 调 `quitAndInstall` |
| `isBusy()` | `() => boolean` | 长任务是否在跑（`installNow` 的判据） |
| `quitForUpdate()` | `() => boolean` | 是否正在退出安装（供 `index.ts` 的 `window-all-closed` 判断） |
| `updaterLoadError` | `string` | `require('electron-updater')` 失败时的原因文本（缺依赖时所有调用回 `{ ok: false, message }`） |

内部辅助：`toStage()`（把放宽的 `state.stage` 收口成 `UpdateStage`）、`humanError()`（错误中文化）、`applyFeedUrl()`、`bindEvents()`、`bindBusyTracking()`、`writeLog()`、`bytesText()`。

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
url: https://updates.example.com/marvisstudio/
updaterCacheDirName: my-app-updater
```

### 3.2 检查 → 下载 → 安装

```
update:check → checkNow('manual')
  → applyFeedUrl() → autoUpdater.checkForUpdates()
  → 事件：checking-for-update / update-available / update-not-available / error
  → 每次事件都经 send() 推 update:progress（含 stage / version / message）
update:available 态下点「下载更新」→ update:download → downloadUpdate()
  → 事件：download-progress（percent / transferred / total / bytesPerSecond）→ 频繁推送
  → 事件：update-downloaded → stage = downloaded
update:install → installNow()
  → busy 检查 → quitFlag = true → 300ms 后 quitAndInstall(true, true)
```

### 3.3 忙碌态判定（零侵入）

| 监听的通道 | 置忙条件 | 置闲条件 |
| --- | --- | --- |
| `whisper:progress` | `stage` 为 `downloading` / `loading` / `transcribing` | 其它 stage（含 `done` / `error`） |
| `video:progress` | 任意一条日志 | 无单独的「结束」事件，靠后续通道或用户操作复位 |
| `voice:align-progress` | `stage` 为 `synth` / `assemble` | `done` / `error` |
| `project:html-progress` | `stage !== 'done'` | `stage === 'done'` |

因为是「后到的通道覆盖全局标志」，多任务并发时最后一个置闲的通道会提前解除忙碌；`installNow()` 因此只把忙碌当作**尽力而为的保护**，真正的兜底是提示用户自行确认。

## 4. 依赖与协作

**import**

| 来源 | 引入内容 |
| --- | --- |
| `electron` | `app`、`ipcMain` |
| `node:path` / `node:fs` | 日志落盘路径与追加写 |
| `../shared/ipc` | `IPC`（含 `IPC.Update` 组） |
| `../shared/types` | `RegisterCtx`、`UpdateCheckResult`、`UpdateProgressPayload`、`UpdateStage` |
| `./settings` | `getUpdaterSettings`、`saveUpdaterSettings` |
| `electron-updater` | 运行时 `require()` 取 `autoUpdater`（**不 import**，见 §5） |

**被谁引用 / 影响谁**

| 位置 | 关系 |
| --- | --- |
| `src/main/index.ts` | `updater.register(ctx)`；`window-all-closed` 用 `updater.quitForUpdate()` 避让安装器 |
| `src/main/settings.ts` | 提供 `getUpdaterSettings()` / `saveUpdaterSettings()` 与 `settings:save-updater` |
| `src/preload/index.ts` | `updateTools` 命名空间（5 个方法 + 进度订阅） |
| `src/renderer/src/pages/SettingsPage/index.vue` | 「应用更新」卡片：版本显示 / 检查 / 下载 / 取消 / 重启安装 / 更新源设置 / 跳过版本 |

## 5. 注意事项与实现要点

- **`electron-updater` 是运行时 `require`，不是 `import`**：它是 CJS 包（`main: out/main.js`，无 ESM 具名导出），`import { autoUpdater }` 会失败。整段 `require` 包在 `try` 里，失败只记 `updaterLoadError`，**不会让主进程启动崩掉**。
- **依赖必须同时进 `build.files` 白名单**：`package.json` 的 `build.files` 有 `"!node_modules/**/*"`，electron-updater 及其 13 个传递依赖（`builder-util-runtime`、`js-yaml`、`semver`、`fs-extra`、`lazy-val`、`lodash.isequal`、`lodash.escaperegexp`、`tiny-typed-emitter`、`argparse`、`graceful-fs`、`jsonfile`、`universalify`、`sax`）都要显式列出。漏了的表现是 **dev 下正常、安装版功能静默不可用**；验证方式：
  ```powershell
  npx asar list dist\win-unpacked\resources\app.asar | Select-String "electron-updater|js-yaml"
  ```
- **`npm run pack` 不生成 `app-update.yml`**：`--dir`（免安装目录）模式下不写更新配置，只有全量 `npm run dist` 才产出 `app-update.yml` 与 `latest.yml`。因此**验证更新功能必须用 `dist` 并安装后再试**。
- **`stage` 刻意放宽为 `string`**：阶段由 electron-updater 的事件回调跨函数写入，若标注成 `UpdateStage` 联合类型，TS 的控制流分析会把函数内最后一次赋值当成当前类型，导致后续比较全被判成「不可能分支」（实测 9 处 `TS2367`）。交出前由 `toStage()` 白名单收口。
- **`autoDownload = false` + `autoInstallOnAppQuit = true`**：下载必须用户点（安装包近 300 MB），但已下载的更新在用户直接关窗时也会装上。
- **与 `window-all-closed` 的配合**：`quitAndInstall()` 会关闭窗口；若入口的 `window-all-closed` 再 `app.quit()` 会与安装器抢退出流程，故 `installNow()` 先置 `quitFlag`，入口据此直接返回。
- **dev 环境需 `dev-app-update.yml`**：未打包时既要有根目录的 `dev-app-update.yml`（内容同 `app-update.yml`），又要置 `forceDevUpdateConfig = true` 才会检查；缺文件则跳过启动静默检查（该文件名已进 `.gitignore`）。
- **`update:version` 是全工程唯一的同步 IPC**：`ipcMain.on` + `event.returnValue`，只回版本号字符串，供设置页首屏显示。
- **错误中文化**：`humanError()` 把 404 / DNS / 校验失败等翻译成可操作提示（如「更新源上没有找到 latest.yml，请确认已把安装包与 latest.yml 上传到更新源」）。
- **日志**：所有动作与事件写 `userData/updater.log`（与 `preview-protocol.log` 同思路），排查「检查更新失败」先看它。

## 6. 发版流程（三个文件缺一不可）

```powershell
# 1. 升版本号（app.getVersion() 读的就是它）
npm version patch --no-git-tag-version

# 2. 全量打包（产出安装包 + latest.yml + .blockmap）
npm run dist

# 3. 上传到更新源（generic provider 不会自动上传）
#    dist\MarvisStudio Setup <版本>.exe
#    dist\MarvisStudio Setup <版本>.exe.blockmap   ← 差分下载靠它，不传则每次全量下
#    dist\latest.yml                                ← 客户端检查更新的入口

# 4. 本地验证
npx http-server dist -p 8099
#    应用内「设置 → 应用更新 → 更新源」填 http://127.0.0.1:8099/
```
