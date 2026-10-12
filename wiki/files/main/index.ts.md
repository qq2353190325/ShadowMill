# src/main/index.ts

> ShadowMill（影坊）主进程入口：历史数据目录的归属证明与旧数据处置契约（`legacy:*`）、装配窗口、预览协议与各业务域 IPC

- **所在目录**：src/main/
- **类型**：主进程入口（装配器，副作用型模块）
- **规模**：464 行（2026-10 品牌改名事故修复后由 265 行增长；本轮把「原生三按钮对话框 + 1.5s 延迟」改为「主进程只提供 `legacy:*` 两个 handler、界面交给渲染层」后由 481 行缩短，行数以工作区源码为准）
- **对外导出**：无 `export`（模块加载即执行归属标记写入、协议特权声明与 IPC 监听；`app.whenReady()` 后完成装配并注册 `legacy:*` 两个 handler）；内部包含 `LEGACY_DIR_NAMES` / `OWN_DATA_ENTRIES` / `USER_DATA_DIR` / `DATA_MARKER` / `APP_ID` / `STARTUP_LOG` / `BOOT_AT` 等模块级常量、`type MergeStat`、模块级可变状态 `legacyScanned` / `legacyFound`，函数 `hasOurIdentity()` / `isOurs()` / `writeIdentity()` / `mergeTree()` / `pruneEmptyDirs()` / `migrateFrom()` / `findLegacyData()` / `legacyInfo()` / `resolveLegacy(action)` / `previewMime(p)` / `createWindow()` / `getWindow()` / `bootLog(stage)`，以及模块级 `let mainWindow`

## 1. 作用与职责

- **进程入口**：被 electron-vite 打包为 `out/main/index.js`，是应用唯一的主进程启动点。
- **userData 位置保持 Electron 默认**：`const USER_DATA_DIR = app.getPath('userData')`，即 `%APPDATA%\<package.json 的 name>`（现为 `%APPDATA%\shadowmill`）。**刻意不做 `app.setPath('userData', …)`**——目录名继续跟随 `name`，保持 Electron 的默认语义；本文件不做任何位置钉死。
- **归属证明（`isOurs`）**：`my-app` 这种名字太通用，`%APPDATA%` 下完全可能有别的应用也叫这个。所以扫到同名目录之后**必须先证明它是我们的**：① 目录里**任意一个点开头的标记文件（名字不限）**内容里的 `appId` 与 `APP_ID` 一致；② 否则看结构特征 `<目录>\projects\<项目名>\project.json` 是否存在（专为「标记机制上线之前」的历史目录准备，比如 `my-app`）。两条都不满足 ⇒ 不提示、不迁移（重名应用挡在这里）。**读取只按内容认、不猜文件名**（`hasOurIdentity()`）。见 §3.1②。
- **历史数据目录：主进程只回答「有没有 / 是什么」并执行选择，不做任何界面展示**：品牌改名（`my-app` → `shadowmill`）会让 userData 目录名随之改变，老用户打开应用会看到「项目全没了」（数据其实还在 `%APPDATA%\my-app` 里）。本文件扫 `LEGACY_DIR_NAMES`，通过归属证明且**确有应用数据**时把结论缓存起来，经 `legacy:status` 交给渲染层；界面由渲染层的应用内弹窗 `LegacyDataDialog.vue`（沿用 `.hf-modal` 体系）负责，用户选完再把 `migrate` / `delete` / `later` 经 `legacy:resolve` 回传，由 `resolveLegacy()` 执行。**不做静默自动迁移**：静默挪动上 GB 的数据出问题极难追查，而弹窗本身就把「数据在哪、有多少、要怎么办」讲清楚了。见 §3.1。
- **窗口与生命周期**：创建 `BrowserWindow`（1200×800，最小 800×600，`titleBarStyle: 'hidden'`，`backgroundColor: '#0B1220'`），处理 `activate` / `window-all-closed`。
- **首屏时序打点**：`bootLog()` 把「模块加载 → app ready → 建窗 → 页面开始加载 → DOM ready → 加载完成 → 首帧」写进 `userData/startup.log`，用于排查首屏慢（每次启动几行，超 64KB 自动清空）；迁移/删除/「稍后再说」的结果也写同一文件。
- **预览协议宿主**：声明并实现自定义协议 `hgpreview`，让渲染层的预览 iframe 能读取 `userData\projects` 下的项目文件；dev 阶段渲染层来自 `http://localhost`，Chromium 会拦截 `file://` iframe（`Not allowed to load local resource`），因此必须走该协议。
- **基础 IPC**：窗口控制（最小化 / 最大化切换 / 关闭）与剪贴板写入。
- **业务域装配**：按固定顺序调用各业务模块的 `register(ctx)`，把窗口引用注入各域（供打开对话框时作为父窗口）。
- 具体业务逻辑不在本文件实现，按域拆到 `src/main/` 下的 `hfEnv.ts`、`settings.ts`、`htmlAgent.ts`、`projects.ts`、`voice.ts`、`ttsAlign.ts`、`video.ts`、`whisper.ts`、`updater.ts`、`runtime.ts`。

## 2. 导出与关键实现

本文件不导出任何符号，以下均为模块内部实现：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `LEGACY_DIR_NAMES` | `string[]`（模块级常量） | `['my-app']`——**历史数据目录名清单，也是唯一的发现机制**（没有任何自动发现）。`findLegacyData()` 只在这份清单里找目录，`resolveLegacy()` 删除前还会用它做二次校验 |
| `OWN_DATA_ENTRIES` | `string[]`（模块级常量） | `['projects', 'whisper', 'voice', 'tts-output', 'html-agent', 'settings.json']`——值得提示/迁移的**应用自有条目白名单**，也用于「确有数据 / 空壳」判定；新增应用自有条目时记得加进来 |
| `USER_DATA_DIR` | `string`（模块级常量） | `app.getPath('userData')`，即 `%APPDATA%\<package.json 的 name>`；`STARTUP_LOG`、`migrateFrom`（迁移目标）、`findLegacyData` / `resolveLegacy`（`path.dirname` 求 `%APPDATA%`）都以它为基准。**没有 `setPath`，没有钉死** |
| `DATA_MARKER` | `string`（模块级常量） | `'.shadowmill-data'`——归属标记文件名（固定品牌名形态） |
| `APP_ID` | `string`（模块级常量） | `'com.shadowmill.app'`，与 `package.json` 的 `build.appId` 一致；归属判定的比对值 |
| `MergeStat` | `type` | `{ moved: number; skipped: number; failed: number }`——迁移统计；`resolveLegacy()` 的返回值与 `startup.log` 都靠它（`failed === 0` 即成功） |
| `hasOurIdentity(dir)` | 函数 `(string) => boolean` | 归属判定的第一道判据（见 §3.1②）：遍历目录里**点开头**的条目，跳过 `size > 64KB` 的，`JSON.parse` 后若 `raw.appId === APP_ID` 立即 `true`；其余静默跳过，遍历完返回 `false`。**只看内容里的 `appId`，不看文件名** |
| `isOurs(dir)` | 函数 `(string) => boolean` | 归属判定：① `hasOurIdentity(dir)` ⇒ `true`；② 否则看结构特征 `<dir>\projects\<项目名>\project.json` 是否存在 ⇒ `true`（给「标记机制上线之前」的历史目录准备）；③ 都不满足 ⇒ `false`。见 §3.1② |
| `writeIdentity(dir)` | 函数 `(string) => void` | 在 `dir` 里落/更新 `\.shadowmill-data`（`{ appId, appName, dirName, at }`，2 空格缩进）；**只在 `appId` 或 `dirName` 变化时重写**（内容一致直接返回），失败静默（写不进去不影响使用，只是将来改名后认不出这个目录） |
| `writeIdentity(USER_DATA_DIR)` | **模块体调用（一次）** | 紧跟三个归属函数之后、`mergeTree` 之前执行：启动时就把归属标记写进当前 userData（幂等），供将来的归属判定与 `isOurs()` 使用 |
| `mergeTree(src, dst, st)` | 函数 `(string, string, MergeStat) => void` | 递归合并目录树；见 §3.1⑦ |
| `pruneEmptyDirs(dir)` | 函数 `(string) => boolean` | 自底向上删掉**空**目录（只删空的），返回该目录是否已空；见 §3.1⑧ |
| `migrateFrom(oldDir)` | 函数 `(string) => MergeStat` | 把老目录里白名单条目的内容**移动**进当前 userData；见 §3.1⑥ |
| `findLegacyData()` | 函数 `() => { dir; entries; projects } \| null` | 扫 `LEGACY_DIR_NAMES`，排除自身 + 归属证明 + 只认**确有应用数据**的老目录；返回目录、命中条目与项目数，否则 `null`（不打扰用户）；见 §3.1③ |
| `legacyScanned` / `legacyFound` | `boolean` / `LegacyDataInfo \| null`（模块级可变） | 「扫一次即缓存」的两个状态位：首次查询时置 `legacyScanned = true` 并写入扫描结果；`legacyInfo()` 后续直接返回缓存 |
| `legacyInfo()` | 函数 `() => LegacyDataInfo \| null` | 主进程对「有没有旧数据 / 是什么」的**唯一回答**；缓存语义与 `MIGRATE_USER_DATA=0` 关闸见 §3.1④ |
| `resolveLegacy(action?)` | 函数 `(LegacyResolveAction?) => LegacyResolveResult` | 执行用户在弹窗里的选择（`migrate` / `delete` / `later`），非法或缺省的 action 归一为 `'later'`；返回 `{ ok, action, moved?, skipped?, failed?, message? }`；见 §3.1⑤ |
| `STARTUP_LOG` | `string`（模块级常量） | `path.join(USER_DATA_DIR, 'startup.log')`，启动打点日志路径；**在这里解析一次并缓存**（注释说明：userData 位置只跟随 `name`，运行期不会变，缓存是安全的） |
| `previewMime(p)` | 函数 `(string) => string` | 预览协议 MIME 表；按 `path.extname(p).toLowerCase()` 查表，未命中返回 `application/octet-stream` |
| `mainWindow` | `BrowserWindow \| null` | 主窗口引用；`closed` 事件中置回 `null` |
| `getWindow()` | 箭头函数 `() => BrowserWindow \| null` | 装配上下文 `RegisterCtx.getWindow` 的实现；各业务域的对话框用它取父窗口 |
| `BOOT_AT` | `number`（模块级常量） | 进程启动时刻（`Date.now() - process.uptime()*1000`，含 Electron 引导耗时），`bootLog` 的相对时间基准 |
| `bootLog(stage)` | 函数 `(string) => void` | 往 `STARTUP_LOG` 追加一行 `ISO 时间 + 空格 + '+<距进程启动毫秒>ms ' + stage`；文件超 64KB 先删再写；整段 `try/catch` 静默失败 |
| `createWindow()` | 函数 `() => void` | 清空应用菜单 + 创建窗口 + 装 dev/prod 加载分支 + 绑定窗口事件 + 首屏打点 |
| `IPC.Window.Minimize` | `ipcMain.on` | 频道 `'window:minimize'`，触发 `mainWindow.minimize()` |
| `IPC.Window.ToggleMaximize` | `ipcMain.on` | 频道 `'window:toggle-maximize'`，已最大化则 `unmaximize()`，否则 `maximize()` |
| `IPC.Window.Close` | `ipcMain.on` | 频道 `'window:close'`，触发 `mainWindow.close()` |
| `IPC.Window.MaximizedChange` | `webContents.send` | 频道 `'window:maximized-change'`，主 → 渲染推送最大化状态布尔值 |
| `IPC.App.CopyText` | `ipcMain.handle` | 频道 `'app:copy-text'`，`clipboard.writeText(String(text == null ? '' : text))` 后返回 `true` |
| `IPC.Legacy.Status` | `ipcMain.handle`（在 `app.whenReady()` 内、`createWindow()` 之后注册） | 频道 `'legacy:status'`，`() => legacyInfo()`——渲染层挂载时问一次「有没有待处理的旧数据」 |
| `IPC.Legacy.Resolve` | `ipcMain.handle`（同上） | 频道 `'legacy:resolve'`，`(_event, action?) => resolveLegacy(action)`——回传用户在弹窗里的选择并同步拿到执行结果 |
| `protocol.registerSchemesAsPrivileged([...])` | 模块顶层调用 | 为 `hgpreview` 声明 `{ standard: true, secure: true, supportFetchAPI: true, stream: true }` |
| `protocol.handle('hgpreview', handler)` | `app.whenReady()` 内调用 | 把 URL 路径映射到项目目录内文件并返回 `Response` |
| `ctx: RegisterCtx` | 对象 `{ getWindow }` | 由 `src/shared/types.ts` 定义，仅含 `getWindow` 一个字段 |

> **已作废的历史方案（文档与代码里都不再存在，勿再引用）**：`USER_DATA_DIR_NAME`、`app.setPath('userData', …)`、目录位置钉死、启动时「身份标记自动认领」（`readMarkerAppId()` / `adoptExistingData()`）、`README_NAME` / `README_TEXT`（`README-请勿删除.txt`），以及备份名 `.before-adopt.bak`。
> 注意区分：`DATA_MARKER` / `APP_ID` / `writeIdentity()` **在**（本轮重新引入，用途变了，见 §3.1②）；被删掉的是旧方案里那套「按标记自动把老目录并过来」的启动逻辑。
> **本轮又删掉的一层**：`promptLegacyData()`（原生 `dialog.showMessageBox` 三按钮对话框整段）、它的调用 `setTimeout(() => promptLegacyData(), 1500)`，以及 `electron` 的 `dialog` 导入与 `import type { MessageBoxOptions }`。因此**启动路径上已经没有任何与旧数据相关的延迟或原生对话框**；取而代之的是 §3.1④/⑤ 的 `legacyInfo()` / `resolveLegacy()` 与两个 `legacy:*` handler。

## 3. 关键流程 / 算法

### 3.1 历史数据目录：归属证明 + 扫描 + 用户确认式处置

**背景**：userData 目录名跟随 `package.json` 的 `name`（Electron 默认行为）。2026-10-12 品牌更名（`my-app` → `shadowmill`）后目录随之改变，老用户打开应用会看到「项目全没了」——数据其实还在 `%APPDATA%\my-app` 里。

**方案取向（源码注释「2026-10-12 定稿」+ 本轮「界面交给渲染层」的修订）**：

| 决策 | 理由 |
| --- | --- |
| **不改 userData 的位置**，目录名继续跟随 `name` | 保持 Electron 的默认语义（本轮**没有** `app.setPath`） |
| 扫到同名目录后**先做归属证明**再提示 | `my-app` 这种名字太通用，`%APPDATA%` 下可能有别的应用也叫这个；只按名字就弹「要不要迁移」有把别人数据搬进来的风险 |
| 扫 `LEGACY_DIR_NAMES`，**确有应用数据**才把结论交给渲染层，由用户选「迁移 / 删除 / 稍后」 | 静默搬迁会在用户毫无察觉的情况下挪动上 GB 数据，真出问题极难追查；弹窗本身把「数据在哪、有多少、要怎么办」讲清楚了 |
| **不用原生 `dialog.showMessageBox`，改由渲染层弹应用内弹窗** | 原生对话框与项目的 Cyber UI 设计系统（规范见 `src/renderer/agents.md`）不一致；项目已有 `.hf-modal` 弹窗体系（遮罩 / `.hf-modal` / `.hf-modal-head` / `.hf-modal-body` / `.hf-modal-foot` / `.hf-btn`）可复用，样式、文案与交互都能与其它弹窗保持一致 |
| **主进程不再做任何界面展示** | 它只回答「有没有 / 是什么」（`legacy:status`）并执行用户选择（`legacy:resolve`），界面与提示（toast）全在渲染层，职责单一、可测 |
| **去掉启动时的 1.5s 延迟** | 显示时机由渲染层掌握：外壳挂载时首屏已经渲染完，弹窗不会糊在空界面上；主进程侧不再需要「等首屏画完」的魔法数字 |
| 迁移复用同一套合并逻辑：白名单 + 递归 + 文件已存在就跳过（绝不覆盖）+ `settings.json` 特例 | 与「用户手动复制粘贴」相比更安全，且不会覆盖新目录里已有的数据 |
| 「稍后再说」什么也不做，下次启动**再问一次** | 问题没解决就不该被静默遗忘 |

> **⚠ 代价（务必记住）**：以后再改 `package.json` 的 `name`，**必须把旧名字手动加进 `LEGACY_DIR_NAMES`**——这里**没有任何自动发现机制**。忘了加，用户又会看到「项目全没了」。

#### ① 位置与白名单

```ts
const LEGACY_DIR_NAMES = ['my-app'];                    // 历史目录名清单：唯一的发现机制
const OWN_DATA_ENTRIES = ['projects', 'whisper', 'voice', 'tts-output', 'html-agent', 'settings.json'];
const USER_DATA_DIR = app.getPath('userData');          // %APPDATA%\<package.json 的 name>
```

- `OWN_DATA_ENTRIES` 是「值得提示/迁移的应用自有条目」，同时用于 §3.1③ 的「确有数据 / 空壳」判定。**不列** Chromium 的 profile 目录（`Cache` / `Code Cache` / `GPUCache` / `Local State` / `Network` / `IndexedDB` …）——那是浏览器缓存，跨目录搬没有意义；也**不列** `hf-projects`（渲染临时目录，几百 MB 且可随时重新生成）。
- `USER_DATA_DIR` 是模块级常量，但**这里不再有任何 `setPath`**：位置就是 Electron 默认值。`path.dirname(USER_DATA_DIR)` 即 `%APPDATA%`，是查找与校验的基准。

#### ② 归属证明：`hasOurIdentity()` / `isOurs()` / `writeIdentity()`

标记文件内容形如（**写入**当前 userData 时固定叫 `.shadowmill-data`）：

```json
{ "appId": "com.shadowmill.app", "appName": "shadowmill", "dirName": "shadowmill", "at": "<ISO 时间>" }
```

| 函数 | 行为 |
| --- | --- |
| `hasOurIdentity(dir)` | `readdirSync(dir)` 遍历条目，**只看点开头的**（`n.startsWith('.')`，标记文件必然是点开头）；跳过 `fs.statSync(p).size > 64 * 1024` 的（标记必然很小，顺带避免误读大文件）；`JSON.parse(fs.readFileSync(p, 'utf8'))` 后若 `raw.appId === APP_ID` 立即返回 `true`；`readdirSync` 抛错返回 `false`；不是 JSON / 不是标记（如 `.updaterId`）在 `catch` 里静默跳过。**刻意只看内容、不看文件名**，理由见下方 |
| `isOurs(dir)` | ① `hasOurIdentity(dir)` ⇒ `true`；② 否则看结构特征：`dir\projects\<任意项目名>\project.json` 存在 ⇒ `true`（**这条专为「标记机制上线之前」的历史目录准备**，例如 `my-app`，那时从没写过标记）；③ 两条都不满足 ⇒ `false`（重名应用挡在这里，**不提示、不迁移**） |
| `writeIdentity(dir)` | `mkdirSync(dir, { recursive: true })` → 读旧标记，**`appId` 与 `dirName` 都没变就直接返回**（幂等，不抖动 mtime）→ 否则以**固定名 `DATA_MARKER`（`.shadowmill-data`）**写 `{ appId, appName: app.getName(), dirName, at }`（2 空格缩进）。整段 `try/catch`：写不进去不影响使用，只是将来改名后认不出这个目录。**写入用固定名、读取按内容**是刻意分开的 |
| `writeIdentity(USER_DATA_DIR)` | **模块体里立刻调用一次**（在三个函数声明之后、`mergeTree` 之前）：启动即把归属标记写进当前 userData，作为**将来改名后「这个目录是我的」的依据** |

> **为什么读取不做成「猜文件名」（设计取舍）**：标记名是各个版本按**当时的品牌 / 目录名**起的（`.shadowmill-data` / `.my-app-data` / …），而「改过几次名」是无法穷举的——按固定候选名依次尝试，只要哪一次改名的组合没猜中（例如 `package.json` 的 `name` 与品牌名不一致时就存在这种组合），就会**静默漏掉自己的老目录**，表现为「项目全没了」again。改成按内容认（`appId` 是我们独有的 `com.shadowmill.app`）之后，归属判定与「标记叫什么名字」完全无关，**改多少次名都不会漏**。代价是每次判定要读若干个小文件（≪1ms，只在启动扫描时发生）。

> **`.shadowmill-data` 的职责已经变了**：它**不再**承担旧方案里的「启动时按标记自动认领老数据」，现在只有两个用途——**(a) 扫描历史目录时作为归属证明**（§3.1③ 的第二道闸）；**(b) 将来改名后作为「这个目录是我的」的依据**（当 `LEGACY_DIR_NAMES` 里的名字被扫到时，标记能给出比目录名更硬的证据）。

#### ③ 发现：`findLegacyData()`

按 `LEGACY_DIR_NAMES` 顺序逐个检查 `%APPDATA%\<名字>`，**四道闸依次**：

| # | 闸 | 行为 |
| --- | --- | --- |
| 1 | `dir.toLowerCase() === USER_DATA_DIR.toLowerCase()` | `continue`——**别把自己的目录当历史目录**（正常不会同名，但 `name` 改回旧值时就会） |
| 2 | `!fs.existsSync(dir)` | `continue`——目录不存在 |
| 3 | `!isOurs(dir)` | `continue`——**归属证明不通过就不提示**：重名应用挡在这里，不会把别人的数据搬进来 |
| 4 | 白名单条目全空（空壳） | `continue`——只剩 Chromium 缓存或空目录时**不打扰用户** |

通过后：逐个白名单条目判「确有数据」（目录看 `readdirSync(p).length > 0`，文件看 `statSync(p).size > 0`）记入 `entries`；`projects` = `readdirSync(<dir>/projects).length`（读不到则 0）——用来在弹窗文案里说「（N 个项目）」。命中即返回 `{ dir, entries, projects }`；整个扫描包在 `try/catch` 里，失败返回 `null`（扫描失败不影响启动）。

#### ④ 就绪查询：`legacyInfo()`（扫一次即缓存）

```ts
if (process.env['MIGRATE_USER_DATA'] === '0') return null;   // 自测时整段关闭
if (!legacyScanned) { legacyScanned = true; try { legacyFound = findLegacyData(); } catch (e) { legacyFound = null; } }
return legacyFound;
```

- **缓存的理由**（源码注释）：渲染层可能多次问（外壳挂载问一次，将来设置页也可能问），文件系统扫描只做一次。
- **缓存的生命周期**：只有 `resolveLegacy()` 在「删除成功」或「迁移零失败」时把 `legacyFound` 置回 `null`；其余情况（含迁移有失败项、用户选「稍后」）都保留，因此渲染层再问一次仍会拿到同一份结论。
- `MIGRATE_USER_DATA=0` 时无论何时问都返回 `null`（**关闸在这里，而不是在扫描里**）。
- 本函数**不做任何界面展示**，也不写入日志；它是 `legacy:status` handler 的唯一实现体。

#### ⑤ 执行选择：`resolveLegacy(action?)`

1. 先取 `found = legacyInfo()`；`act` 归一化——只有 `'migrate'` / `'delete'` 原样保留，其余（含 `undefined`、非法字符串）一律当 **`'later'`**。
2. `!found` ⇒ 直接返回 `{ ok: false, action: act, message: '没有待处理的旧数据' }`（例如已处理过、或 `MIGRATE_USER_DATA=0`）。
3. 按 `act` 分支：

| `act` | 行为 | 返回值 |
| --- | --- | --- |
| `'later'` | 只 `bootLog('旧数据待处理（用户选择稍后）：<老目录>')`，**什么都不动** | `{ ok: true, action }` |
| `'delete'` | **先二次校验**：`LEGACY_DIR_NAMES.some(n => path.join(path.dirname(USER_DATA_DIR), n).toLowerCase() === found.dir.toLowerCase())`——只允许删 `%APPDATA%` 下、名字在清单里的目录；不通过直接返回 `{ ok: false, action, message: '该目录不在允许删除的名单内' }`。通过则 `fs.rmSync(found.dir, { recursive: true, force: true })` → `bootLog('旧数据目录已按用户选择删除：<老目录>')` → **清缓存**（`legacyFound = null`） | 成功 `{ ok: true, action }`；失败 `{ ok: false, action, message: <原始错误信息> }` 并 `bootLog('删除旧数据目录失败：…')` |
| `'migrate'` | `migrateFrom(found.dir)`（见 ⑥）→ `pruneEmptyDirs(found.dir)` 返回真则 `rmdirSync(found.dir)` 清掉空壳（占用中失败则留着）→ `bootLog('旧数据迁移：搬迁 N 项，跳过 N 项，失败 N 项（<老目录>）')` → **只有 `failed === 0` 才清缓存**；有失败项保留缓存，**允许用户下次重试** | `{ ok: failed === 0, action, moved, skipped, failed, message }`；`failed > 0` 时 `message` 为 `'有 N 项没能迁移（可能正被占用），可稍后重试'`，否则 `''` |

> - **「稍后」不清理缓存**：本次会话内渲染层再问仍会得到同一个老目录；真正的「下次启动再问」由进程重启后的重新扫描自然实现（缓存是进程内状态）。
> - **失败保留缓存是刻意的**：迁移部分失败时用户还有机会再点一次「迁移过来」；重新扫描反而可能因为部分条目已被搬走而改变 `entries` 文案。
> - **返回值里的 `ok` 表达的是「这一动作是否成功」，不是「用户是否做了选择」**；「稍后」属于成功的选择，故 `ok: true`。
> - 渲染层据此给 toast 文案：成功报搬迁项数与被保留项数，失败报 `message`（见 `src/renderer/src/components/LegacyDataDialog.vue`）。

#### ⑥ 迁移：`migrateFrom(oldDir): MergeStat`

按 `OWN_DATA_ENTRIES` 逐项处理：

1. 老目录里没有该项 → 跳过。
2. 目标不存在 ⇒ **整个条目直接 `fs.renameSync(src, dst)`**（升级场景的常态，也是最快路径），`st.moved++`；`rename` 抛错（跨分区 / 被占用）则**落到下面的按文件合并**。
3. `settings.json` 特例（它在新目录里基本必然已存在——应用启动时按默认值写过，而「目标已存在就跳过」会让用户的 API Key / 自定义音色 / 各档设置全部留在老目录）：
   - `!settings.isPristineSettings(dst)` ⇒ `st.skipped++`（新位置**已被用户配置过**，不动它）；
   - 否则先 `copyFileSync(dst, dst + '.before-migrate.bak')` **备份**，再 `copyFileSync(src, dst)` 覆盖，然后 `rmSync(src, { force: true })` 删掉老文件，`st.moved++`；失败 `st.failed++`。
4. 其余项 → `mergeTree(src, dst, st)`（见 ⑦）。

> 迁移是**移动**而不是复制：同分区（新旧目录都在 `%APPDATA%` 下）时 `renameSync` 是原子操作，上 GB 也是瞬间完成，**所以整个迁移不需要进度条**（也不需要弹窗里的进度状态，只有 `busy` 期间按钮禁用与「处理中…」文案）。

#### ⑦ `mergeTree(src, dst, st)` 递归合并（不覆盖）

1. 先尽力 `mkdirSync(dst, { recursive: true })`（失败不返回，逐项写入时还会再报）。
2. `readdirSync(src)` 失败 → 直接返回。
3. 逐项：
   - 是**目录** → 递归 `mergeTree(s, d, st)` **继续往下走**，而不是整目录跳过。源码注释说明了原因：`whisper/` 这种两边都存在的目录，整目录跳过会把里面的 252MB 模型一起漏掉。
   - 是文件且目标已存在 → `st.skipped++`，**绝不覆盖**。
   - 否则 `renameSync(s, d)`（同分区内是原子改名，不下沉拷贝），成功 `st.moved++`；失败（跨分区 / 占用）退化为 `copyFileSync` + `rmSync(s, { force: true })`，成功 `st.moved++`，仍失败 `st.failed++`（单项失败不牵连其它项）。

#### ⑧ `pruneEmptyDirs(dir)`

自底向上删掉**空**目录（`rmdirSync`，只删空的；非空则保留并向上返回「还有东西」）。迁移后调用一次，返回 `true`（老目录已空）才 `rmdirSync(oldDir)`；失败（如仍被占用）静默留着。

#### ⑨ 契约与时机、关闸与代价

- **契约（`src/shared/ipc.ts` 的 `Legacy` 组）**：`legacy:status`（invoke，无载荷，返回 `LegacyDataInfo | null`）与 `legacy:resolve`（invoke，载荷是 `action` 字符串，返回 `LegacyResolveResult`）；preload 对应 `window.legacyTools.status()` / `window.legacyTools.resolve(action)`，类型在 `src/shared/types.ts` 的 `PreloadApi.legacyTools`。
- **时机**：两个 handler 在 `app.whenReady()` 里 **`createWindow()` 之后**注册（紧跟 `createWindow()`，在 `ctx` 与各业务域 `register()` 之前）。**本轮起没有任何 `setTimeout` 延迟**——显示时机交给渲染层：外壳 `onMounted` 时调 `initLegacyData()` → `legacy:status`，此时首屏已渲染完，弹窗不会糊在空界面上。
- **关闸**：`MIGRATE_USER_DATA=0` 单次关闭（`legacyInfo()` 恒返回 `null`，因此渲染层永远看不到弹窗；自测时用）。
- **日志**：删除成功 / 删除失败、迁移统计、用户选「稍后」各写一行 `userData/startup.log`（见 ⑤）。
- **代价**：`LEGACY_DIR_NAMES` 是手工清单，**改 `name` 必须手动加旧名字**，否则用户又会看到「项目全没了」。

### 3.2 协议特权注册（模块顶层，早于 app ready）

1. 在模块顶层（`app.whenReady()` 之前）调用 `protocol.registerSchemesAsPrivileged`，这是 Electron 的硬性时序要求。
2. 特权项：`standard: true` 保证 URL 按层级结构解析、相对路径可用；`secure: true` 让页面获得与 `file://` 对齐的安全上下文行为；`supportFetchAPI: true`、`stream: true` 允许页面内 `fetch` 与流式消费。

### 3.3 hgpreview 请求处理（`protocol.handle`）

URL 形态：`hgpreview://p/<encodeURIComponent(项目名)>/<相对路径>`。因 `standard: true`，`p` 是 URL 的 host，**不进入 `pathname`**，因此 `pathname` 的第一段就是项目名。

1. 定义内部 `log(line)`：以 `appendFileSync` 追加写 `userData/preview-protocol.log`，行格式 `ISO 时间 + 空格 + line`，整段包 `try/catch` 静默忽略失败。
2. `new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent)` → `segs`。
3. `name = segs[0]`（项目名）、`rel = segs.slice(1).join('/')`（项目内相对路径）；任一为空则记 `404 <url>` 并返回 `404 Not Found`。
4. `dir = projects.projectDir(name)`（项目目录绝对路径），`full = path.resolve(dir, rel)`。
5. 目录穿越防护：若 `full !== dir` 且 `!full.startsWith(dir + path.sep)`，记 `403 <url>` 并返回 `403 Forbidden`。
6. 存在性校验：`fs.existsSync(full)` 且 `fs.statSync(full).isFile()` 不满足则记 `404 <url> -> <full>` 并返回 `404 Not Found`。
7. `fs.readFileSync(full)` 直接读字节，构造 `Response`，头为 `Content-Type: previewMime(full)` 与 `Cache-Control: no-store`。
8. 任意异常落入 `catch`：记 `500 <url> <message>`，但**响应状态码为 400 `Bad Request`**（日志前缀与响应码不一致，属现有实现）。

### 3.4 createWindow 装配流程

1. `Menu.setApplicationMenu(null)`——彻底移除默认菜单栏（不出现 File/Edit/View）。
2. 创建 `BrowserWindow`：`width: 1200`、`height: 800`、`minWidth: 800`、`minHeight: 600`、`titleBarStyle: 'hidden'`、`autoHideMenuBar: true`、**`backgroundColor: '#0B1220'`**（与设计系统 `--bg-primary` 及 `index.html` 的启动画面同色，页面首帧之前不闪白）。
3. `webPreferences`：`preload: path.join(__dirname, '../preload/index.js')`、`contextIsolation: true`、`nodeIntegration: false`——渲染层无 Node 能力，一切特权操作走 preload 暴露的 IPC（这也是剪贴板必须经主进程写入的原因）。
4. 建窗后立即装首屏打点：`webContents` 的 `did-start-loading` / `dom-ready` / `did-finish-load` 与窗口的 `ready-to-show`（首帧）各写一行 `startup.log`。
5. 加载分支：存在 `process.env['ELECTRON_RENDERER_URL']` 时 `loadURL(...)`（electron-vite dev + HMR）；否则 `loadFile(path.join(__dirname, '../renderer/index.html'))`（生产构建产物）。
6. 绑定事件：`maximize` → 推送 `IPC.Window.MaximizedChange`（`true`）；`unmaximize` → 推送同一频道（`false`），供渲染层切换最大化/还原图标；`closed` → `mainWindow = null`。

### 3.5 模块求值顺序与 app.whenReady 装配顺序

```
模块求值
  ├─ LEGACY_DIR_NAMES / OWN_DATA_ENTRIES / USER_DATA_DIR = app.getPath('userData')   // 只读默认位置，无 setPath
  ├─ DATA_MARKER / APP_ID
  ├─ hasOurIdentity / isOurs / writeIdentity 定义
  ├─ writeIdentity(USER_DATA_DIR)        // 立刻在当前 userData 落/更新归属标记（幂等）
  ├─ mergeTree / pruneEmptyDirs / migrateFrom / findLegacyData 定义
  ├─ legacyScanned = false / legacyFound = null
  ├─ legacyInfo / resolveLegacy 定义
  ├─ STARTUP_LOG = path.join(USER_DATA_DIR, 'startup.log')   // 位置只跟随 name，缓存安全
  ├─ bootLog('main module loaded')
  └─ protocol.registerSchemesAsPrivileged([...])   // 协议特权必须在 app ready 之前
whenReady
  ├─ bootLog('app ready')
  ├─ protocol.handle('hgpreview', ...)   // 协议处理器先就绪，预览才可用
  ├─ createWindow()                       // 窗口先建好，ctx.getWindow / 各域对话框父窗口才有值
  │    └─ bootLog('window created') → loadFile/loadURL
  │         （异步阶段另打点：page load start → dom ready → page load finished → first paint）
  ├─ ipcMain.handle(IPC.Legacy.Status, () => legacyInfo())          // 只提供契约，不弹任何界面
  ├─ ipcMain.handle(IPC.Legacy.Resolve, (_e, action) => resolveLegacy(action))
  ├─ ctx = { getWindow }
  ├─ settings.register(ctx)
  ├─ projects.register(ctx)
  ├─ voice.register(ctx)
  ├─ ttsAlign.register(ctx)
  ├─ video.register(ctx)
  ├─ whisper.register(ctx)
  ├─ updater.register(ctx)                // 内部另安排 3s 后的启动静默检查
  └─ runtime.register(ctx)                // 最后注册；运行环境包自己带 2s 延迟在后台解包（不抢启动时间）
```

顺序即数据依赖顺序；源码注释给出的依赖图：`settings ← htmlAgent ← projects ← voice ← ttsAlign`，`hfEnv ← video`，`settings ← updater`，全图**无环**。`hfEnv.ts` 不注册 IPC，因此不在此列表中。

生命周期收尾：`app.on('activate')` 时若 `BrowserWindow.getAllWindows().length === 0` 则重新 `createWindow()`；`app.on('window-all-closed')` 时先看 `updater.quitForUpdate()`——正在退出安装则直接返回（让 electron-updater 的安装器接管退出流程），否则非 `darwin` 平台调用 `app.quit()`。

## 4. 依赖与协作

**import（顶部）**

| 来源 | 引入内容 |
| --- | --- |
| `electron` | `app`、`BrowserWindow`、`Menu`、`ipcMain`、`clipboard`、`protocol`（**本轮起不再有 `dialog`**） |
| `node:path` | `path`（`join` / `resolve` / `dirname` / `basename` / `extname` / `sep`） |
| `node:fs` | `fs`（`existsSync` / `statSync` / `readdirSync` / `readFileSync` / `writeFileSync` / `appendFileSync` / `mkdirSync` / `renameSync` / `copyFileSync` / `rmSync` / `rmdirSync`） |
| `../shared/ipc` | `IPC` 频道常量表（本轮用到新增的 `IPC.Legacy.Status` / `IPC.Legacy.Resolve`） |
| `../shared/types` | 类型 `LegacyDataInfo`、`LegacyResolveAction`、`LegacyResolveResult`、`RegisterCtx`（均为 `import type`；**本轮起不再有 `MessageBoxOptions`**） |
| `./settings` | `import * as settings`——`migrateFrom()` 用 `settings.isPristineSettings(dst)` 判定「新 settings.json 是否仍是出厂状态」（见 §3.1⑥） |
| `./projects`、`./voice`、`./ttsAlign`、`./video`、`./whisper`、`./updater`、`./runtime` | 各业务域模块，全部以 `import * as` 引入并调用其 `register(ctx)`；`projects.projectDir(name)` 另被 `hgpreview` 协议处理器使用 |

**被谁依赖 / 协作关系**

- `src/preload/index.ts` 通过 `IPC.Window.Minimize` / `IPC.Window.ToggleMaximize` / `IPC.Window.MaximizedChange` / `IPC.App.CopyText` 与本文件通信；`legacyTools` 命名空间则对应本文件的 `IPC.Legacy.Status` / `IPC.Legacy.Resolve`。
- 渲染层的 `src/renderer/src/composables/useLegacyData.ts`（挂载时问一次、回传选择）与 `src/renderer/src/components/LegacyDataDialog.vue`（应用内弹窗）是本文件 `legacy:*` 契约的唯一消费方。
- `src/renderer/src/pages/HtmlGenPage/index.vue` 生成 `hgpreview://p/<encodeURIComponent(appState.currentName)>/<encodeURIComponent(relFile)>?v=<时间戳>` 形式的 iframe 地址；`src/renderer/index.html` 的 CSP 中 `frame-src file: hgpreview:` 放行该协议。
- `src/main/projects.ts` 提供 `projectDir(name)`，是本文件协议处理器的路径基准；`src/main/settings.ts` 提供 `isPristineSettings()`，是迁移时 `settings.json` 特例的判据。**这两处调用都不构成环**（index 是装配器，位于依赖图顶端）。
- 业务模块各自用 `app.getPath('userData')` 取数据根（如 `projects.projectsRoot()` / `whisper.modelsDir()` / `runtime.runtimeRoot()` / `settings.settingsFile()`），本文件**不再**在任何位置改写 userData，因此「模块级快照 vs import 提升」在这一版里是**纯保险**问题（见 §5）。

## 5. 注意事项与实现要点

- **时序**：`writeIdentity(USER_DATA_DIR)` 在模块体里就执行（早于 `app ready`，但只写文件、不依赖 ready）；`protocol.registerSchemesAsPrivileged` 必须位于模块顶层、`app ready` 之前；`legacy:*` 两个 handler 与各业务域一样必须在 `createWindow()` **之后**注册（渲染层要等外壳挂载才会问）。**启动路径上没有任何延迟**：本轮已删掉 `setTimeout(() => promptLegacyData(), 1500)`。
- **UI 不在主进程**：本文件不 `import dialog`，也没有任何 `showMessageBox`；旧数据的「展示」由渲染层的 `LegacyDataDialog.vue` 完成（`.hf-modal` 体系，与 `src/renderer/agents.md` 的 Cyber UI 规范一致），toast 也在渲染层。主进程只负责扫描结论（`legacy:status`）与执行结果（`legacy:resolve`）。
- **⚠ `LEGACY_DIR_NAMES` 是手工清单，没有自动发现**：以后改 `package.json` 的 `name`（或任何会影响 `app.getPath('userData')` 的配置），**必须**把旧目录名加进这份清单，否则用户又会看到「项目全没了」；同时注意 `findLegacyData()` 按数组顺序取**第一个**通过全部闸门的目录，连续改过多次名时只会提示其中一个。
- **归属证明是「宁可漏、不可错」**：`isOurs()` 不通过就**既不提示也不迁移**（重名应用挡在这里）。第一道判据按内容认（`hasOurIdentity()`，与标记文件名无关）；第二道结构特征（`projects\<项目名>\project.json`）是为了照顾标记机制上线之前的历史目录，因此**若某天 `projects/` 的布局变了，这条判据必须同步更新**，否则老目录会被判成「不是我们的」而永远不被提示。
- **`writeIdentity()` 是幂等的**：内容一致（`appId` 与 `dirName` 都没变）直接返回，不重写；标记文件损坏时会被当成「需要重写」。写失败静默——只是将来改名后认不出这个目录。**读（`hasOurIdentity()`）按内容里的 `appId`、与文件名无关；写（`writeIdentity()`）固定用 `.shadowmill-data`**。
- **不做静默处置是刻意选择**：迁移/删除都由用户在应用内弹窗里点，主进程只认 `migrate` / `delete` / `later` 三种 action，**非法或缺失的 action 一律当 `later`**（不是报错，也不是默认迁移——绝不会因为调用方写错就把数据搬走或删掉）。要临时关掉整段功能用 `MIGRATE_USER_DATA=0`。
- **删除有二次校验**：只有当目标目录确实等于 `%APPDATA%\<LEGACY_DIR_NAMES 里的名字>`（大小写不敏感比较）时才 `rmSync(..., { recursive: true, force: true })`；校验不通过返回 `{ ok: false, message: '该目录不在允许删除的名单内' }`，绝不删。删除成功才清缓存（本次会话不再提示）。
- **迁移是「移动 + 不覆盖」**：目标不存在时整个条目 `renameSync`（同分区原子、上 GB 瞬间完成，因此没有进度条）；目标已存在的**文件**一律跳过；唯一例外是仍处「出厂状态」的 `settings.json`，覆盖前先写 `settings.json.before-migrate.bak` 备份，覆盖后删除老文件。
- **迁移失败保留缓存、允许重试**：`failed === 0` 才清缓存；有失败项时返回 `ok: false` 且 `message` 说明可能被占用、可稍后重试，用户再点「迁移过来」会重走一遍（已搬走的项因为老目录里已不存在而被跳过）。`ok` 反映动作成败，「稍后」属成功选择故 `ok: true`。
- **只搬白名单条目**：`OWN_DATA_ENTRIES` 之外的一切（Chromium profile 的 `Cache` / `Code Cache` / `GPUCache` / `Local State` / `Network` / `IndexedDB` … 与 `hf-projects`）都不搬，理由见 §3.1①；新增应用自有数据目录时要显式加进白名单，否则老用户的那部分数据不会被迁走。
- **「空壳」判定避免打扰**：老目录里若只剩 Chromium 缓存（白名单条目全空或不存在），`findLegacyData()` 返回 `null`，`legacy:status` 返回 `null`，渲染层**不会**弹出任何弹窗。
- **userData 位置本身仍是 Electron 默认语义**：`USER_DATA_DIR = app.getPath('userData')` = `%APPDATA%\<package.json 的 name>`（现 `shadowmill`）；本文件不调用 `app.setPath`。因此**迁移只发生在用户点击之后**，不存在任何隐式的目录改写。
- **业务模块仍保持惰性求值（纯保险）**：`projects.projectsRoot()` 等一律写成函数 / getter，源码注释（含 `STARTUP_LOG` 的缓存说明）已把理由写作「**将来**若有人重新引入 `setPath` 之类的改动，模块级快照会静默钉在当时的位置」——当前 userData 只跟随 `name`，快照本来也正确，函数化属于零代价的保险。**不要**把它写成「禁止模块级快照的硬约束源于现行的 setPath」。
- **必须显式给 MIME**：直接读字节构造 `Response` 时若缺 `Content-Type`（缺省 `application/octet-stream`）会被 Chromium 的严格 MIME 检查拦下脚本，因此 `previewMime` 是功能必需而非优化；常用映射为 `.html/.htm`→`text/html; charset=utf-8`、`.js/.mjs`→`text/javascript; charset=utf-8`、`.css`→`text/css; charset=utf-8`、`.json`→`application/json`、`.svg`→`image/svg+xml`、`.mp3`→`audio/mpeg`、`.wav`→`audio/wav`、`.mp4/.m4v`→`video/mp4`、`.woff2`→`font/woff2`、`.txt`→`text/plain; charset=utf-8`。
- **不要用 `net.fetch('file://...')`**：源码注释明确该方式在协议处理器内存在兼容性问题，易致预览空白，故改为 `fs.readFileSync` 手工构造响应。
- **禁用缓存**：`Cache-Control: no-store`，配合渲染层的 `?v=` 时间戳实现预览强制刷新。
- **安全边界**：`path.resolve` + `startsWith(dir + path.sep)` 组合是防目录穿越的唯一防线；`full === dir` 放行但随后会被 `isFile()` 判否返回 404。每段单独 `decodeURIComponent`，注意编码后的斜杠在分段解码后才会显现。
- **排障入口**：预览异常时看 `userData/preview-protocol.log`；**首屏慢 / 启动卡顿看 `userData/startup.log`**（每行带「距进程启动毫秒数」，可直接判断时间花在模块加载、建窗还是页面加载），历史数据迁移/删除/「稍后」那几行也在同一文件里（见 §3.1⑤）。
- **两种 IPC 语义不能混用**：窗口控制是 `ipcMain.on`（渲染层 `send`，单向、无返回值），剪贴板与 `legacy:*` 都是 `ipcMain.handle`（渲染层 `invoke`，返回 Promise）。`IPC.Window.MaximizedChange` 是主进程 → 渲染层的推送频道；`legacy:*` 没有主 → 渲染的推送，**完全由渲染层拉取**。
- **`register(ctx)` 顺序有约束**：必须在 `createWindow()` 之后、且按 settings → projects → voice → ttsAlign → video → whisper → updater → runtime 注册，避免跨域依赖缺位（`runtime` 放最后是因为它自带延迟解包，不抢启动时间）；`legacy:*` 两个 handler 也在这个位置注册，顺序上写在 `ctx` 之前。
- **`window-all-closed` 要给更新安装让路**：`updater.quitForUpdate()` 为真时直接返回，否则 `app.quit()` 会与 electron-updater 调起的 NSIS 安装器抢退出流程（表现为「点了重启安装但没装上」）。
- **窗口引用失效**：`closed` 后 `mainWindow = null`，所有 IPC 回调都先做空值判断，`maximize`/`unmaximize` 回调使用 `mainWindow?.` 可选链。`legacy:*` 两个 handler 不使用窗口引用（不弹原生框、不需要父窗口），因此**与窗口生命周期完全解耦**。
- **输出布局**：主进程 `out/main/index.js`、preload `out/preload/index.js`、渲染层 `out/renderer/`；`__dirname` 相对定位依赖这一布局。
