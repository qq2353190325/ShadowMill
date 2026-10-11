# src/main/index.ts

> MarvisStudio 主进程入口：装配窗口、预览协议与各业务域 IPC

- **所在目录**：src/main/
- **类型**：主进程入口（装配器，副作用型模块）
- **规模**：180 行
- **对外导出**：无 `export`（模块加载即执行协议特权声明与 IPC 监听，`app.whenReady()` 后完成装配）；内部包含 `previewMime(p)`、`createWindow()`、`getWindow()`、`bootLog(stage)`、模块级 `let mainWindow` 与启动时刻常量 `BOOT_AT`

## 1. 作用与职责

- **进程入口**：被 electron-vite 打包为 `out/main/index.js`，是应用唯一的主进程启动点。
- **窗口与生命周期**：创建 `BrowserWindow`（1200×800，最小 800×600，`titleBarStyle: 'hidden'`，`backgroundColor: '#0B1220'`），处理 `activate` / `window-all-closed`。
- **首屏时序打点**：`bootLog()` 把「模块加载 → app ready → 建窗 → 页面开始加载 → DOM ready → 加载完成 → 首帧」写进 `userData/startup.log`，用于排查首屏慢（每次启动几行，超 64KB 自动清空）。
- **预览协议宿主**：声明并实现自定义协议 `hgpreview`，让渲染层的预览 iframe 能读取 `userData\projects` 下的项目文件；dev 阶段渲染层来自 `http://localhost`，Chromium 会拦截 `file://` iframe（`Not allowed to load local resource`），因此必须走该协议。
- **基础 IPC**：窗口控制（最小化 / 最大化切换 / 关闭）与剪贴板写入。
- **业务域装配**：按固定顺序调用各业务模块的 `register(ctx)`，把窗口引用注入各域（供打开对话框时作为父窗口）。
- 具体业务逻辑不在本文件实现，按域拆到 `src/main/` 下的 `hfEnv.ts`、`settings.ts`、`htmlAgent.ts`、`projects.ts`、`voice.ts`、`ttsAlign.ts`、`video.ts`、`whisper.ts`、`updater.ts`。

## 2. 导出与关键实现

本文件不导出任何符号，以下均为模块内部实现：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `previewMime(p)` | 函数 `(string) => string` | 预览协议 MIME 表；按 `path.extname(p).toLowerCase()` 查表，未命中返回 `application/octet-stream` |
| `mainWindow` | `BrowserWindow \| null` | 主窗口引用；`closed` 事件中置回 `null` |
| `getWindow()` | 箭头函数 `() => BrowserWindow \| null` | 装配上下文 `RegisterCtx.getWindow` 的实现，传给各域 `register` |
| `BOOT_AT` | `number`（模块级常量） | 进程启动时刻（`Date.now() - process.uptime()*1000`，含 Electron 引导耗时），`bootLog` 的相对时间基准 |
| `bootLog(stage)` | 函数 `(string) => void` | 往 `userData/startup.log` 追加一行 `ISO 时间 + 空格 + '+<距进程启动毫秒>ms ' + stage`；文件超 64KB 先删再写；整段 `try/catch` 静默失败 |
| `createWindow()` | 函数 `() => void` | 清空应用菜单 + 创建窗口 + 装 dev/prod 加载分支 + 绑定窗口事件 + 首屏打点 |
| `IPC.Window.Minimize` | `ipcMain.on` | 频道 `'window:minimize'`，触发 `mainWindow.minimize()` |
| `IPC.Window.ToggleMaximize` | `ipcMain.on` | 频道 `'window:toggle-maximize'`，已最大化则 `unmaximize()`，否则 `maximize()` |
| `IPC.Window.Close` | `ipcMain.on` | 频道 `'window:close'`，触发 `mainWindow.close()` |
| `IPC.Window.MaximizedChange` | `webContents.send` | 频道 `'window:maximized-change'`，主 → 渲染推送最大化状态布尔值 |
| `IPC.App.CopyText` | `ipcMain.handle` | 频道 `'app:copy-text'`，`clipboard.writeText(String(text == null ? '' : text))` 后返回 `true` |
| `protocol.registerSchemesAsPrivileged([...])` | 模块顶层调用 | 为 `hgpreview` 声明 `{ standard: true, secure: true, supportFetchAPI: true, stream: true }` |
| `protocol.handle('hgpreview', handler)` | `app.whenReady()` 内调用 | 把 URL 路径映射到项目目录内文件并返回 `Response` |
| `ctx: RegisterCtx` | 对象 `{ getWindow }` | 由 `src/shared/types.ts` 定义，仅含 `getWindow` 一个字段 |

## 3. 关键流程 / 算法

### 3.1 协议特权注册（模块顶层，早于 app ready）

1. 在模块顶层（`app.whenReady()` 之前）调用 `protocol.registerSchemesAsPrivileged`，这是 Electron 的硬性时序要求。
2. 特权项：`standard: true` 保证 URL 按层级结构解析、相对路径可用；`secure: true` 让页面获得与 `file://` 对齐的安全上下文行为；`supportFetchAPI: true`、`stream: true` 允许页面内 `fetch` 与流式消费。

### 3.2 hgpreview 请求处理（`protocol.handle`）

URL 形态：`hgpreview://p/<encodeURIComponent(项目名)>/<相对路径>`。因 `standard: true`，`p` 是 URL 的 host，**不进入 `pathname`**，因此 `pathname` 的第一段就是项目名。

1. 定义内部 `log(line)`：以 `appendFileSync` 追加写 `userData/preview-protocol.log`，行格式 `ISO 时间 + 空格 + line`，整段包 `try/catch` 静默忽略失败。
2. `new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent)` → `segs`。
3. `name = segs[0]`（项目名）、`rel = segs.slice(1).join('/')`（项目内相对路径）；任一为空则记 `404 <url>` 并返回 `404 Not Found`。
4. `dir = projects.projectDir(name)`（项目目录绝对路径），`full = path.resolve(dir, rel)`。
5. 目录穿越防护：若 `full !== dir` 且 `!full.startsWith(dir + path.sep)`，记 `403 <url>` 并返回 `403 Forbidden`。
6. 存在性校验：`fs.existsSync(full)` 且 `fs.statSync(full).isFile()` 不满足则记 `404 <url> -> <full>` 并返回 `404 Not Found`。
7. `fs.readFileSync(full)` 直接读字节，构造 `Response`，头为 `Content-Type: previewMime(full)` 与 `Cache-Control: no-store`。
8. 任意异常落入 `catch`：记 `500 <url> <message>`，但**响应状态码为 400 `Bad Request`**（日志前缀与响应码不一致，属现有实现）。

### 3.3 createWindow 装配流程

1. `Menu.setApplicationMenu(null)`——彻底移除默认菜单栏（不出现 File/Edit/View）。
2. 创建 `BrowserWindow`：`width: 1200`、`height: 800`、`minWidth: 800`、`minHeight: 600`、`titleBarStyle: 'hidden'`、`autoHideMenuBar: true`、**`backgroundColor: '#0B1220'`**（与设计系统 `--bg-primary` 及 `index.html` 的启动画面同色，页面首帧之前不闪白）。
3. `webPreferences`：`preload: path.join(__dirname, '../preload/index.js')`、`contextIsolation: true`、`nodeIntegration: false`——渲染层无 Node 能力，一切特权操作走 preload 暴露的 IPC（这也是剪贴板必须经主进程写入的原因）。
4. 建窗后立即装首屏打点：`webContents` 的 `did-start-loading` / `dom-ready` / `did-finish-load` 与窗口的 `ready-to-show`（首帧）各写一行 `startup.log`。
5. 加载分支：存在 `process.env['ELECTRON_RENDERER_URL']` 时 `loadURL(...)`（electron-vite dev + HMR）；否则 `loadFile(path.join(__dirname, '../renderer/index.html'))`（生产构建产物）。
6. 绑定事件：`maximize` → 推送 `IPC.Window.MaximizedChange`（`true`）；`unmaximize` → 推送同一频道（`false`），供渲染层切换最大化/还原图标；`closed` → `mainWindow = null`。

### 3.4 app.whenReady 装配顺序与依赖图

```
模块求值
  ├─ bootLog('main module loaded')        // 顶部的各业务模块 import 已全部求值完毕
whenReady
  ├─ bootLog('app ready')
  ├─ protocol.handle('hgpreview', ...)   // 协议处理器先就绪，预览才可用
  ├─ createWindow()                       // 窗口先建好，ctx.getWindow 才有值
  │    └─ bootLog('window created') → loadFile/loadURL
  │         （异步阶段另打点：page load start → dom ready → page load finished → first paint）
  ├─ ctx = { getWindow }
  ├─ settings.register(ctx)
  ├─ projects.register(ctx)
  ├─ voice.register(ctx)
  ├─ ttsAlign.register(ctx)
  ├─ video.register(ctx)
  ├─ whisper.register(ctx)
  └─ updater.register(ctx)                // 最后注册；内部另安排 3s 后的启动静默检查
```

顺序即数据依赖顺序；源码注释给出的依赖图：`settings ← htmlAgent ← projects ← voice ← ttsAlign`，`hfEnv ← video`，`settings ← updater`，全图**无环**。`hfEnv.ts` 不注册 IPC，因此不在此列表中。

生命周期收尾：`app.on('activate')` 时若 `BrowserWindow.getAllWindows().length === 0` 则重新 `createWindow()`；`app.on('window-all-closed')` 时先看 `updater.quitForUpdate()`——正在退出安装则直接返回（让 electron-updater 的安装器接管退出流程），否则非 `darwin` 平台调用 `app.quit()`。

## 4. 依赖与协作

**import（顶部）**

| 来源 | 引入内容 |
| --- | --- |
| `electron` | `app`、`BrowserWindow`、`Menu`、`ipcMain`、`clipboard`、`protocol` |
| `node:path` | `path`（`join` / `resolve` / `extname` / `sep`） |
| `node:fs` | `fs`（`existsSync` / `statSync` / `readFileSync` / `appendFileSync` / `rmSync`） |
| `../shared/ipc` | `IPC` 频道常量表 |
| `../shared/types` | 类型 `RegisterCtx`（`import type`） |
| `./settings`、`./projects`、`./voice`、`./ttsAlign`、`./video`、`./whisper`、`./updater` | 各业务域模块，全部以 `import * as` 引入并调用其 `register(ctx)` |

**被谁依赖 / 协作关系**

- `src/preload/index.ts` 通过 `IPC.Window.Minimize` / `IPC.Window.ToggleMaximize` / `IPC.Window.MaximizedChange` / `IPC.App.CopyText` 与本文件通信。
- `src/renderer/src/pages/HtmlGenPage/index.vue` 生成 `hgpreview://p/<encodeURIComponent(appState.currentName)>/<encodeURIComponent(relFile)>?v=<时间戳>` 形式的 iframe 地址；`src/renderer/index.html` 的 CSP 中 `frame-src file: hgpreview:` 放行该协议。
- `src/main/projects.ts` 提供 `projectDir(name)`，是本文件协议处理器的路径基准。

## 5. 注意事项与实现要点

- **时序**：`protocol.registerSchemesAsPrivileged` 必须位于模块顶层、`app ready` 之前，否则协议特权不生效。
- **必须显式给 MIME**：直接读字节构造 `Response` 时若缺 `Content-Type`（缺省 `application/octet-stream`）会被 Chromium 的严格 MIME 检查拦下脚本，因此 `previewMime` 是功能必需而非优化；常用映射为 `.html/.htm`→`text/html; charset=utf-8`、`.js/.mjs`→`text/javascript; charset=utf-8`、`.css`→`text/css; charset=utf-8`、`.json`→`application/json`、`.svg`→`image/svg+xml`、`.mp3`→`audio/mpeg`、`.wav`→`audio/wav`、`.mp4/.m4v`→`video/mp4`、`.woff2`→`font/woff2`、`.txt`→`text/plain; charset=utf-8`。
- **不要用 `net.fetch('file://...')`**：源码注释明确该方式在协议处理器内存在兼容性问题，易致预览空白，故改为 `fs.readFileSync` 手工构造响应。
- **禁用缓存**：`Cache-Control: no-store`，配合渲染层的 `?v=` 时间戳实现预览强制刷新。
- **安全边界**：`path.resolve` + `startsWith(dir + path.sep)` 组合是防目录穿越的唯一防线；`full === dir` 放行但随后会被 `isFile()` 判否返回 404。每段单独 `decodeURIComponent`，注意编码后的斜杠在分段解码后才会显现。
- **排障入口**：预览异常时看 `userData/preview-protocol.log`；**首屏慢 / 启动卡顿看 `userData/startup.log`**（每行带「距进程启动毫秒数」，可直接判断时间花在模块加载、建窗还是页面加载）。日志函数自身失败不抛出。
- **两种 IPC 语义不能混用**：窗口控制是 `ipcMain.on`（渲染层 `send`，单向、无返回值），剪贴板是 `ipcMain.handle`（渲染层 `invoke`，返回 `Promise<boolean>`）。`IPC.Window.MaximizedChange` 是主进程 → 渲染层的推送频道。
- **`register(ctx)` 顺序有约束**：必须在 `createWindow()` 之后、且按 settings → projects → voice → ttsAlign → video → whisper → updater 注册，避免跨域依赖缺位。
- **`window-all-closed` 要给更新安装让路**：`updater.quitForUpdate()` 为真时直接返回，否则 `app.quit()` 会与 electron-updater 调起的 NSIS 安装器抢退出流程（表现为「点了重启安装但没装上」）。
- **窗口引用失效**：`closed` 后 `mainWindow = null`，所有 IPC 回调都先做空值判断，`maximize`/`unmaximize` 回调使用 `mainWindow?.` 可选链。
- **输出布局**：主进程 `out/main/index.js`、preload `out/preload/index.js`、渲染层 `out/renderer/`；`__dirname` 相对定位依赖这一布局。
