# 02 · 目录架构：`src/main/`（主进程）

> 主进程是整个应用的能力中心：窗口与生命周期、运行环境包（716MB 资源）的准备与解包、userData 历史数据目录的扫描与**用户确认式处置**（`legacy:*` 两个频道 + 渲染层应用内弹窗）、文件系统、外部程序调用（whisper / ffmpeg / HyperFrames）、全部网络请求（Qwen-TTS / 自定义模型 / 模型下载 / 运行环境包）以及 **81** 个 IPC 频道的实现，全部集中在这个目录。

---

## 1. 文件清单

| 文件 | 行数 | 角色 | 注册的 IPC 域 |
|---|---|---|---|
| [index.ts](./files/main/index.ts.md) | 464 | **入口装配器**：历史数据目录的归属证明（`isOurs` / `hasOurIdentity`，`.shadowmill-data` 按内容认）与**用户确认式处置**（`legacyInfo()` 扫一次即缓存 → `legacy:status` 交给渲染层；`resolveLegacy()` 执行 `migrate` / `delete` / `later`）、生命周期、窗口（含主题底色 `backgroundColor`）、`hgpreview://` 协议、窗口控制与剪贴板 IPC、启动时序打点 `startup.log` | `window:*`、`app:copy-text`、`legacy:*` |
| [hfEnv.ts](./files/main/hfEnv.ts.md) | 294 | 环境探测与内置依赖定位 + GSAP 本地化 / 导出外部化辅助（不注册 IPC） | — |
| [settings.ts](./files/main/settings.ts.md) | 311 | 设置存储（`userData/settings.json`，含视频渲染默认档位）+ OpenAI SDK 懒加载入口 `loadOpenAI` + 「出厂状态」判定 `isPristineSettings`（供 index.ts 的 `migrateFrom()` 迁移老数据时决定能否覆盖 settings.json） | `settings:*`（5） |
| [systemVoices.ts](./files/main/systemVoices.ts.md) | 63 | Qwen-TTS 内置系统音色静态表 | — |
| [htmlAgent.ts](./files/main/htmlAgent.ts.md) | 248 | 自定义模型 Agent：流式生成/修改 HTML（不注册 IPC，被 projects 调用；SDK 经 settings 懒加载） | — |
| [projects.ts](./files/main/projects.ts.md) | 817 | 项目化流水线：`project.json`、字幕、内容脚本、HTML、背景音轨注入（`<audio id="myv-bgm">`）、GSAP 本地化 / 导出外部化（含复制失败退回 CDN 的兜底）、音视频产物（项目结构再导出 `shared/types`；项目根 `projectsRoot()` 为**函数**、惰性求值） | `project:*`（24 handle + 1 推送） |
| [voice.ts](./files/main/voice.ts.md) | 533 | 千问语音：音色管理 + 文字生音频 | `voice:*`（15） |
| [ttsAlign.ts](./files/main/ttsAlign.ts.md) | 336 | 字幕配音逐句合成与时间对齐（模式 A/B） | `voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| [video.ts](./files/main/video.ts.md) | 164 | HyperFrames 转视频（渲染副本 GSAP 本地化；音轨来自页面内的 `<audio id="myv-bgm">`） | `dialog:open-html`、`video:*`（3 handle + 1 推送） |
| [whisper.ts](./files/main/whisper.ts.md) | 712 | whisper.cpp 转录 + 识别模型下载/管理 | `whisper:*`（11 handle + 1 推送） |
| [updater.ts](./files/main/updater.ts.md) | 563 | 应用自更新（electron-updater generic provider，**懒加载**）：检查 / 下载 / 取消 / 退出安装 / **打开日志** + 启动静默检查 + 忙碌态判定；错误文案分 `message` / `detail` 两层 | `update:*`（5 handle + 1 `on`/`sendSync` + 1 推送） |
| [runtime.ts](./files/main/runtime.ts.md) | 478 | 运行环境包（ffmpeg / node / hyperframes / whisper 约 716MB）：定位随包 `runtime-pack/` 或从更新源下载 → sha512 校验 → `7za` 解包到 `userData/runtime/<id>/`，维护 `current.json` 指针 + `<id>/ok.json` 完整性标记，并就绪后把资源根交给 `hfEnv.refreshBuiltinResources()`；`register()` 里带 2 秒延迟后台准备（不抢启动时间） | `runtime:*`（2 handle + 1 推送） |
| [vad.ts](./files/main/vad.ts.md) | 122 | WAV 采样读取与静音裁剪（零依赖纯函数） | — |

> 行数取自工作区源码实测（`[IO.File]::ReadAllLines` 与编辑器行号一致）。目录下共 **13** 个 `.ts` 文件，上表**已全部收录**（含 `runtime.ts`，其逐文件说明见 [files/main/runtime.ts.md](./files/main/runtime.ts.md)）。

---

## 2. 装配模式：`register(ctx)`

所有业务域模块都导出统一的 `register(ctx?: RegisterCtx)` 函数，由入口在窗口创建后依次调用：

```ts
// src/main/index.ts
const ctx: RegisterCtx = { getWindow }        // getWindow: () => BrowserWindow | null
settings.register(ctx)
projects.register(ctx)
voice.register(ctx)
ttsAlign.register(ctx)
video.register(ctx)
whisper.register(ctx)
updater.register(ctx)
runtime.register(ctx)                          // 运行环境包，最后一步
```

> `updater.register(ctx)` 除注册 `update:*` 频道，还会在 3 秒后做一次「启动静默检查」（受 `settings.json` 的 `updater.autoCheck` 控制；dev 环境未提供 `dev-app-update.yml` 时跳过）。`runtime.register(ctx)` 排在最后：它在 `register()` 里安排 **2 秒延迟**的后台准备（`prepareInBackground()`），不抢启动时间。
>
> `index.ts` 自身的 `legacy:*` 两个 handler 也在这个位置注册（`createWindow()` 之后、`ctx` 之前），但它们不属于 `register(ctx)` 模式——它们直接写在入口里，见 §4.1。

- `RegisterCtx`（`src/shared/types.ts`）只提供一个能力：拿到主窗口引用，使各域的 `dialog.showOpenDialog` / `showSaveDialog` 以主窗口为父，弹出模态对话框而非游离窗口。
- `register` 是各域**唯一**的 IPC 注册入口：域内的 `ipcMain.handle` / `ipcMain.on` 全部集中在这一个函数体内，便于审阅整个域对外的接口面。
- `index.ts` 自身不属于该模式，它直接注册窗口控制与剪贴板频道。

---

## 3. 模块依赖图（无环）

```
settings ──→ htmlAgent ──→ projects ──→ voice ──→ ttsAlign
                                     ↗
hfEnv ──→ video / whisper / ttsAlign / projects
vad   ──→ whisper
systemVoices ──→ voice
settings ──→ updater（读 updater.feedUrl / autoCheck / skippedVersion）
index.ts ──→ settings（处置老数据时用 isPristineSettings 判定出厂状态）
runtime ──→ hfEnv / settings（资源根交接、下载源取 updater.feedUrl）
projects ──→ runtime（提取音轨前 await ensureRuntime()）
shared/{ipc,types} ──→ 全部模块（仅常量与类型）
```

| 依赖边 | 具体协作点 |
|---|---|
| `voice → projects` | 用 `projects.projectsRoot()`（**函数，惰性求值**）定位项目 `audio/` 与枚举项目（`scanProjects()`）；三处调用点见 [voice.ts.md](./files/main/voice.ts.md) §5 |
| `ttsAlign → voice` | 复用 `synthOne()`（单句合成）、`resolveVoiceModel()`（音色→模型解析）、`voiceFriendlyError()`（错误友好化） |
| `whisper → vad` | 转录前用 `vadTrimSegments()` 裁掉起止静音；用 `toVadSamples()`（走 `hfEnv` 的 ffmpeg）统一采样率 |
| `whisper / ttsAlign / video / projects → hfEnv` | 定位 CLI、Node 运行方式（`findNode()` 返回 `{ cmd, env }`，首选 Electron 内嵌 Node）、FFmpeg bin、chrome-headless-shell，以及 `isHyperframesComposition()` 合规校验；`projects` / `video` 另用 GSAP 本地化的 `localizeGsapHtml()` / `referencesLocalGsap()` / `copyGsapIntoProject()` |
| `projects → htmlAgent` | `project:generate-html` / `project:modify-html` 调用 `chatWithCustomModel()`，并把 `onProgress` 映射为阶段文案推送给渲染层 |
| `voice / whisper / htmlAgent → settings` | 读取 API Key、目标模型、当前识别模型与自定义模型列表；写回配置 |
| `index → settings` | 用户选「迁移过来」后，`migrateFrom()` 调 `settings.isPristineSettings(dst)` 判断新 `settings.json` 是否仍是「出厂状态」（是才允许被老配置覆盖，覆盖前先备份成 `.before-migrate.bak`） |
| `projects → runtime` | `project:extract-video-audio` 先 `await runtime.ensureRuntime()` 等运行环境包就绪（未就绪时把其 `message` / `detail` 原样返回） |
| `runtime → hfEnv` | 四条就绪路径都调 `hfEnv.refreshBuiltinResources(<目录>)`，把解包目录交给 `hfEnv` 重算内置资源缓存（root / chrome / node） |
| `runtime → settings` | `getUpdaterSettings().feedUrl` 作为运行环境包的下载源（与 `updater.ts` 同优先级，其次才回落 `app-update.yml`） |
| `updater → settings` | 读 `updater.feedUrl`（非空即 `autoUpdater.setFeedURL` 覆盖打包内置地址）、`autoCheck`（启动静默检查开关）、`skippedVersion`（用户跳过的版本）；下载「跳过版本」的更新时清掉该标记 |

`src/main/index.ts` 顶部的注释即为这份依赖图的权威描述（`settings ← htmlAgent ← projects ← voice ← ttsAlign`；`hfEnv ← video`；无环）。

---

## 4. 各模块职责

### 4.1 `index.ts` —— 入口装配器

- **userData 位置保持 Electron 默认**：`const USER_DATA_DIR = app.getPath('userData')`，即 `%APPDATA%\<package.json 的 name>`（现 `%APPDATA%\shadowmill`）。**刻意不做 `app.setPath('userData', …)`**——目录名继续跟随 `name`，保持 Electron 的默认语义。
- **归属证明（`isOurs`）**：`my-app` 这种名字太通用，`%APPDATA%` 下可能有别的应用也叫这个；只按名字就弹「要不要迁移」有把别人数据搬进来的风险。所以扫到同名目录后先证明「它是我们的」：① `hasOurIdentity(dir)`——遍历目录里**点开头**的条目（标记文件必是点开头），跳过 >64KB 的，`JSON.parse` 后 `appId === APP_ID`（`'com.shadowmill.app'`，与 `build.appId` 一致）即通过；**只看内容、不猜文件名**（「改过几次名」无法穷举，按固定候选名尝试会静默漏掉自己的老目录）；② 否则看结构特征 `<dir>\projects\<项目名>\project.json` 是否存在（**专为标记机制上线之前的历史目录准备**，如 `my-app`）；③ 都不满足 ⇒ 不提示、不迁移。标记由 `writeIdentity(USER_DATA_DIR)` 在**模块体里立刻写一次**（固定名 `.shadowmill-data`；`appId` / `dirName` 未变则跳过，幂等；失败静默）。
- **历史数据目录：扫描 + 用户确认式迁移**：品牌更名（`my-app` → `shadowmill`）后目录名随之改变，老用户看到「项目全没了」（数据其实还在 `%APPDATA%\my-app`）。`findLegacyData()` 扫 `LEGACY_DIR_NAMES = ['my-app']`，四道闸依次：排除自身（`toLowerCase` 比较）→ 目录存在 → **归属证明通过** → 白名单条目**确有数据**（空壳——只剩 Chromium 缓存或空目录——不打扰用户）；返回 `{ dir, entries, projects }`（`projects` 是 `projects/` 里的条目数，用来在文案里说「N 个项目」）。
- **用户决定，不静默处置（本轮改为「主进程只提供契约、界面完全在渲染层」）**：入口在 `createWindow()` 之后注册两个 handler——`ipcMain.handle(IPC.Legacy.Status, () => legacyInfo())`、`ipcMain.handle(IPC.Legacy.Resolve, (_e, action) => resolveLegacy(action))`。`legacyInfo()` **扫一次即缓存**（模块级 `legacyScanned` / `legacyFound`；`MIGRATE_USER_DATA=0` 时恒返回 `null`），只回答「有没有 / 是什么」；渲染层外壳挂载时问一次 `legacy:status`，有结果就弹**应用内**弹窗（`src/renderer/src/components/LegacyDataDialog.vue`，复用 `.hf-modal` 体系），用户选完把 `migrate` / `delete` / `later` 经 `legacy:resolve` 回传，由 `resolveLegacy()` 执行（**非法或缺省的 action 一律当 `'later'`**，绝不因调用方写错就搬走或删掉数据）。动机（源码注释）：静默搬迁会在用户毫无察觉的情况下挪动上 GB 数据，真出问题极难追查；弹窗本身把「数据在哪、有多少、要怎么办」讲清楚了。**三个取舍**：① 不用原生 `dialog.showMessageBox`——它与 Cyber UI 设计系统（`src/renderer/agents.md`）不一致，而项目已有 `.hf-modal` 体系可复用；② **删掉了原先建窗后 1.5s 的 `setTimeout`**——显示时机交给渲染层（外壳挂载时首屏已渲染完），主进程侧不再需要「等首屏画完」的魔法数字；③ 主进程不做任何界面展示，提示（toast）也在渲染层。「稍后再说」什么都不动、**下次启动再问**；`MIGRATE_USER_DATA=0` 可关闭整段功能。
- **迁移语义（`migrateFrom`：移动、逐项、不覆盖）**：只搬 `OWN_DATA_ENTRIES = ['projects','whisper','voice','tts-output','html-agent','settings.json']`；**目标不存在时整个条目直接 `renameSync`**（同分区原子、上 GB 瞬间完成，所以不需要进度条），失败才落到 `mergeTree()` **递归合并**（两边都有的目录继续下钻，`whisper/` 里的大模型才不会因整目录跳过而漏掉），两边都有的**文件**一律跳过、绝不覆盖；`settings.json` 是唯一特例——只有新文件**还是出厂状态**（`settings.isPristineSettings()`）才用老配置覆盖，覆盖前先备份成 `settings.json.before-migrate.bak`。收尾是 `pruneEmptyDirs()`（只删空目录，老目录空了才 `rmdir`）+ 一行 `startup.log`，返回 `{ ok, action, moved, skipped, failed, message }`：**只有 `failed === 0` 才清缓存**（有失败项保留缓存、允许用户再点一次重试），`ok` 表达的是「这一动作是否成功」而不是「用户是否做了选择」（「稍后」属成功选择故 `ok: true`）；成败文案由渲染层 `toast(...)` 呈现，**主进程不再弹任何结果框**。
- **删除要二次校验（也不弹错误框）**：`resolveLegacy('delete')` 先确认目标确实等于 `%APPDATA%\<LEGACY_DIR_NAMES 里的名字>`（大小写不敏感比较），不通过返回 `{ ok: false, action, message: '该目录不在允许删除的名单内' }`；通过才 `rmSync(found.dir, { recursive: true, force: true })`，成功后**清缓存**（本次会话不再提示）并写日志，失败把原始错误信息放进 `message` 交给渲染层。
- **⚠ 代价：`LEGACY_DIR_NAMES` 是手工清单**：它**是唯一的发现机制**，没有任何自动发现——以后再改 `package.json` 的 `name`，**必须**把旧名字加进这份清单，否则用户又会看到「项目全没了」。
- **`.shadowmill-data` 的职责已变**：不再承担旧方案的「启动时按标记自动认领」（那套 `readMarkerAppId()` / `adoptExistingData()` 已删除），现在只有两个用途——(a) 扫描历史目录时的**归属证明**、(b) 将来改名后「这个目录是我的」的依据。
- **刻意不碰 Chromium profile**：白名单之外的一切（`Cache` / `Code Cache` / `GPUCache` / `Local State` / `Network` / `IndexedDB` …）都不搬，因为那是浏览器缓存、跨目录搬没有意义；`hf-projects`（渲染临时目录，几百 MB 且可随时再生）同样不在白名单。详见 [files/main/index.ts.md](./files/main/index.ts.md) §3.1。
- **业务模块的惰性路径写法是「纯保险」**：`projectsRoot()` 等一律写成函数 / getter。当前 userData 只跟随 `name`，模块级快照本来也正确；源码注释（含 `STARTUP_LOG` 的缓存说明）把理由写作「**将来**若有人重新引入 `setPath` 之类的改动，快照就会静默钉在当时的位置」——不要把它描述成「源于现行 setPath 的硬约束」。落地样板：`projects.projectsRoot()`、`whisper.modelsDir()`、`runtime.runtimeRoot()`、`settings.settingsFile()`。
- **启动时序打点**：`bootLog(stage)` 往 `userData/startup.log` 追加 `ISO 时间 + '+<距进程启动毫秒>ms ' + 阶段`；打点覆盖「模块加载 → app ready → 建窗 → page load start → dom ready → page load finished → first paint」。路径在模块顶层解析一次并缓存（`USER_DATA_DIR` 只跟随 `name`，运行期不变，缓存是安全的）。文件超 64KB 自动清空，写失败静默。排查「首屏只有背景很久」时先看它，可直接判断耗时落在主进程启动、建窗还是页面加载。
- **协议特权**：`app` ready **之前**调用 `protocol.registerSchemesAsPrivileged([{ scheme: 'hgpreview', privileges: { standard, secure, supportFetchAPI, stream } }])`；ready 之后 `protocol.handle('hgpreview', …)` 把 `hgpreview://p/<encodeURIComponent(项目名)>/<相对路径>` 映射回 `userData/projects/<项目名>/` 内的文件。
  - 目录穿越防护：`path.resolve` 后必须等于项目目录或以 `项目目录 + path.sep` 开头，否则 403。
  - 直接读字节构造 `Response`（`net.fetch(file://)` 在协议处理器内有兼容问题，会导致预览空白），MIME 由 `previewMime()` 的扩展名表显式给出，`Cache-Control: no-store`。
  - 失败路径写入 `userData/preview-protocol.log` 便于排查。
- **窗口**：单窗口 `1200×800`（最小 `800×600`）、`titleBarStyle: 'hidden'`、**`backgroundColor: '#0B1220'`**（与设计系统 `--bg-primary` / 渲染层启动画面同色，窗口首帧前不闪白）、`Menu.setApplicationMenu(null)`、`contextIsolation: true` / `nodeIntegration: false`、preload 指向 `../preload/index.js`；dev 走 `process.env.ELECTRON_RENDERER_URL`，prod 走 `loadFile('../renderer/index.html')`。
- **IPC**：`window:minimize` / `window:toggle-maximize` / `window:close`（`on`），`app:copy-text`（`handle`，渲染层 sandbox 无 clipboard 模块），最大化状态经 `window:maximized-change` 回推；旧数据处置为 `legacy:status` / `legacy:resolve`（都是 `handle`，**没有主 → 渲染的推送**——结论完全由渲染层主动拉取）。

### 4.2 `hfEnv.ts` —— 环境探测与资源定位（+ GSAP 本地化 / 导出外部化）

- 汇总 `BUILTIN_RESOURCES`：各字段都是 **getter**，路径在首次访问时求值并缓存（`cachedRoot` / `cachedChrome`，Node 探测另有 `cachedNode`）；打包态资源根优先取运行环境包指针（`<userData>/runtime/current.json` 指向的目录，需该目录内有 `ok.json` 才算解包完整），解析不到才回落 `process.resourcesPath`；开发态固定取 `path.join(app.getAppPath(), 'resources')`（刻意不看指针，改 `resources/` 立即生效）。`refreshBuiltinResources(root?)` 清掉三个缓存并重新解析，据此派生 node / ffmpegBin / ffmpeg / ffprobe / HyperFrames CLI / chrome-headless-shell 等路径。
- 定位函数均为**多候选回退**：
  - Node：`findNode()` 三级优先——① **Electron 内嵌 Node**（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`；探针 `-e` 打印 `process.versions.node`，要求 `status === 0` 且主版本 >= 22）→ ② 随包 `resources/node/node.exe`（`spawnSync -v` 校验 `status === 0`，**不校验版本**）→ ③ 系统 Node（`spawnSync('node', ['-v'])` 主版本 >= 22 才走 `resolveNodePath()`；候选顺序 `NVM_SYMLINK` → `LOCALAPPDATA\nvm\nodejs` → `C:\Program Files\nodejs` → `where.exe` 兜底，逐个 `spawnSync -v` 校验）。之所以要解析**绝对路径**，是为了规避 nvm shim / WindowsApps alias 下 `spawn('node')` 不稳定的问题。该函数返回的不是纯路径而是 `{ cmd, env }`：**`env` 必须合并进子进程环境再 spawn**，否则 `electron.exe` 会把自己当应用启动；探针结果缓存于 `cachedNode`（`spawnSync` 会阻塞主进程，故不让它每次重跑）。
  - FFmpeg：遍历 WinGet 安装目录下的 `Gyan.FFmpeg*` → `*full_build*` → `bin\ffmpeg.exe`。
  - HyperFrames CLI：内置路径优先，其次环境变量 `HYPERFRAMES_CLI`。
- `isHyperframesComposition(raw)`：转视频前的合规校验（`data-composition-id` 与 GSAP `__timelines` 结构等正则同时命中才算合法）。
- GSAP 本地化 / 导出外部化一组（`findLocalGsap()` / `hasGsapCdnRef()` / `referencesLocalGsap()` / `localizeGsapHtml()` / `externalizeGsapHtml()` / `copyGsapIntoProject()`）：定位随包 `vendor/gsap/gsap.min.js`，把 HTML 里的 GSAP CDN 引用改写为 `./gsap.min.js`，并按需把该文件幂等复制进项目目录，使 composition 离线也能预览/渲染；导出单文件时反向把 `./gsap.min.js` 换回固定版本 CDN（`GSAP_CDN_PINNED`），避免导出物缺同目录文件而动画不跑。随包文件缺失时 `localizeGsapHtml` 退化为原样返回，`externalizeGsapHtml` 不受影响。该组函数带文件系统写操作，源码头部注释已明确声明本模块**不再是「纯函数」**（只复制随包的 gsap.min.js，不碰业务数据）。`copyGsapIntoProject` 的返回值被 `projects.ts` 的作者态三处用作「复制失败即退回 CDN」的判据。

### 4.3 `settings.ts` —— 设置存储

- `userData/settings.json`，五分区：`customModel`（`baseUrl` / `modelId` / `apiKey` / `enabled`）、`voiceTTS`（`apiKey` / `targetModel` / `saveDir`）、`voiceProfiles`（本地音色映射，key 形如 `system:Cherry` / `custom:<voice_id>`）、`whisper`（`modelId` + `customModels[]`）、`updater`（`feedUrl` / `autoCheck` / `skippedVersion`），另有视频渲染默认档位 `render`（`quality` / `fps`）。
- 三个 `normalize*` 白名单函数各管一段：`normalizeRenderOptions()`（渲染档位，缺省字段回退 `DEFAULT_RENDER`）、`pickRenderOverride()`（只保留显式给出的合法项目覆盖）、`normalizeUpdaterSettings()`（更新设置，`feedUrl` 仅接受空串或 `http(s)://` 开头，非法值回退原值而非清空）。
- `isPristineSettings(file)`：判定指定 settings.json 是否还是「出厂状态」（用户在这个位置什么都没配过）。只看「用户投入过的字段」——`customModel.apiKey/baseUrl/modelId/enabled===true`、`voiceTTS.apiKey/saveDir`、`whisper.modelId`、`whisper.customModels` 非空、`updater.feedUrl`、`voiceProfiles` 非空；像 `updater.autoCheck` / `render.quality` 这类**开关故意不阻断覆盖**（丢开关是两次点击，丢 API Key 要去控制台重新翻）。文件不存在 / 损坏返回 `true`。唯一调用方是 `index.ts` 的 `migrateFrom()`（用户点「迁移过来」之后才执行）。
- `readSettings()` 做**逐分区浅合并**并静默容错（文件缺失/损坏回落到默认值）；写盘为整体覆盖。
- `settings:test` 的成功判定刻意严格：配置三项非空后发起一次极小的 `chat.completions` 请求，**必须拿到模型返回的文本内容**才算连接成功，避免把「接口通了但模型不产出」误判为可用。
- **openai SDK 懒加载**：本模块是启动路径上的模块，因此不在顶层 `import OpenAI from 'openai'`（模块图约 110ms），改为 `loadOpenAI()` 首次真正发请求时才 `require`；`htmlAgent.ts` 与 `settings:test` 共用它，SDK 不可用时各自退到内置 `fetch` 分支。
- API Key 明文保存在本机 `userData/settings.json`，不经 IPC 外传。

### 4.4 `systemVoices.ts` —— 系统音色表

- `SYSTEM_VOICES` 共 48 条，字段 `{ voice, desc, langs, series }`；`series` 取值组合覆盖 `instruct-flash` / `flash` / `tts`（`flash` 为全量系列）。
- `isSystemVoice()` 精确全等匹配（大小写敏感）。
- 与 `voice.ts` 四处配合：默认模型推断（`instruct-flash > flash > tts`）、`voice:list-system-voices` 输出附带 `model`、`voice:list-all` 生成 `key = 'system:' + voice` 条目，以及渲染层音色管理的回退组装。

### 4.5 `htmlAgent.ts` —— 自定义模型 Agent

- 导出 `chatWithCustomModel` 与进度类型（`AgentProgress` 现在是 `src/shared/types.ts` 的 `HtmlAgentProgress` 的类型别名，导出名不变）；核心在**两条等价的流式路径**：优先用 `openai` SDK（`stream: true`），失败回退直接 `fetch ${baseUrl}/chat/completions` 并手写 SSE 解析。
- 关键设计：
  - 系统提示词约束「输出完整、独立、符合 HyperFrames composition 规范的 HTML」，回复中的 HTML 由 `extractHtmlFromReply()` 提取（兼容 Markdown 代码块包裹）。
  - `reasoning_content`（思考）与 `content`（输出）分离统计；`onProgress` 按 `connecting / thinking / writing / retry / done` 分阶段回调。
  - 推理模型可能把 `max_tokens` 全耗在思考上导致 `content` 为空且 `finish_reason === 'length'`，此时按 `32768 → 65536` 自动升档重试，仍无内容则抛出带 `usage` 的诊断错误。
  - 每次会话（含每档尝试的思考原文、输出、`finish_reason`、`usage`、各阶段耗时）追加写入 `userData/html-agent/chat.jsonl`；记录失败静默忽略，不影响主流程。

### 4.6 `projects.ts` —— 项目化流水线（最大模块）

- 项目实体：`userData/projects/<项目名>/`，元数据 `project.json`（`title` / `subtitle` / `subtitleCount` / `content` / `audioFile` / `videoMaterial` / `htmlPath` / `videoPath` / `createdAt` / `updatedAt`），旁挂 `subtitle.txt`、`index.html`、`index.preview.html`、`gsap.min.js`（按需从随包文件复制）、`audio/`、`video/`。
- **项目根路径是函数**：`projectsRoot()` 返回 `path.join(app.getPath('userData'), 'projects')`，**每次调用重新求值**（不是模块级常量）。原因（源码注释）：当前 userData 位置只跟随 `package.json` 的 `name`，模块级快照本来也正确；但只要将来有任何「在模块体里改 userData 位置」的代码（例如重新引入 `app.setPath`），快照就会静默钉在**当时**的 userData 上，表现为「项目全没了」且极难查——函数化是**零代价的纯保险**。内部三个调用点：`projectDir()`、`scanProjects()`（先 `const root = projectsRoot()`）、`project:delete` 的 `dir.startsWith(projectsRoot())` 校验；导出名不变，导出的就是函数。
- 对外能力（24 个 `handle` + 1 个推送）：项目 list / create / load / delete、字幕保存、内容脚本保存、HTML 生成 / 修改 / 读取 / 保存 / 预览 / 下载、SRT 导出、项目目录与指定路径所在目录打开、音频与视频素材的挑选 / 设置 / 清除、从视频提取音轨、视频产物回写、渲染档位覆盖。其中 `set-audio` / `clear-audio` / `extract-video-audio` 会同步改写 HTML 里的注入音轨并回带 `htmlUpdated`。
- 关键内部设施：`projectDir()`（路径派生的唯一入口，也被 `hgpreview` 协议使用）、`parseSubtitle()`（解析 `[分:秒] 文本` 与纯文本行并统计条目数）、`normalizeContent()`（内容脚本字段兼容）、`scanProjects()`（列表与 `has*` 标记）、`buildContentBlock()` / `buildMaterialPrompt()`（拼装 Agent 提示词）、背景音轨注入一组（`BGM_TAG_ID` / `insertHtmlSnippet()` / `stripInjectedBgm()` / `stripAudioOfFile()` / `applyBgmToHtml()`，共 6 处调用点）、预览副本注入脚本 `HG_PREVIEW_CTRL`（`timelines()` 对 `__timelines` 的「数组 / 对象 / 缺失」三态兼容，落位复用 `insertHtmlSnippet()`）、`progressText()`（Agent 进度 → 中文阶段文案）。
- GSAP 本地化：生成 / 修改 / 保存（`project:save-html`）/ 预览副本四个写盘环节先 `hfEnv.localizeGsapHtml()` 改写 CDN 引用，再按需 `hfEnv.copyGsapIntoProject()` 把随包 `gsap.min.js` 复制进项目目录；其中**作者态三处（generate / modify / save-html）会用复制返回值做兜底**——复制失败就把引用换回 CDN（`hfEnv.externalizeGsapHtml()`），预览则忽略返回值、只在副本上改写，原件 `index.html` 保持原貌（渲染路径的第五处本地化见 4.9，同样忽略返回值）。反向地，`project:download-html` 用 `externalizeGsapHtml()` 把 `./gsap.min.js` 换回固定版本 CDN 后再文本写出——导出的是单文件，否则放到别处会缺 `gsap.min.js` 导致动画不跑。
- `project:extract-video-audio` 会先 `await runtime.ensureRuntime()` 等运行环境包就绪（未就绪时原样返回其 `message` / `detail`），再判内置 ffmpeg 是否存在。
- `project:open-folder` 在项目目录不存在时返回「项目目录不存在（项目尚未保存）」。
- 写 HTML 成功后会把**失效的旧视频产物置空**，并做 HyperFrames 合规校验，返回 `compatible` 供 UI 提示。

### 4.7 `voice.ts` —— 千问语音

- 导出 `register()`，并向 `ttsAlign.ts` 暴露可复用的单句合成与解析能力。
- 音色克隆按目标模型**自动切换输入方式**：`qwen-audio-*`（Qwen-Audio-TTS）走「粘贴音频 URL」，`qwen3-tts-vc-*` 走「上传本地文件」；请求分支覆盖 `action=create_voice` / `create`、`model=voice-enrollment` / `qwen-voice-enrollment`、`prefix` / `preferred_name`、`audio.url` / `audio.data`；直传音频失败时有专用回退（`fallback_mode` / `fallback_reason`）。
- 音色解析三级优先：本地映射 `voiceProfiles`（`system:X` / `custom:X`）→ 系统音色默认模型 → 内置默认模型。
- **项目根走 `projects.projectsRoot()` 函数**：三处调用点（`resolveTtsDir()`、`voice:list-generated`、`voice:synth` 落盘回执）都是在函数 / handler 内取一次局部 `const projectsRoot = projects.projectsRoot()`，不是模块级常量。
- 文字生音频 `voice:synth` 支持三种落盘位置（项目 `audio/`、自定义目录、音频输出目录），回执 `savedTo` 说明实际落点；`voice:list-generated` 按来源（音频输出目录 / 自定义目录 / 项目）分组列出历史音频。
- 所有网络错误经 `voiceFriendlyError()` 转成中文可读提示。

### 4.8 `ttsAlign.ts` —— 字幕配音与时间对齐

- 两种模式（详见 [01-架构总览 §5.4](./01-架构总览.md)）：
  - **模式 A（音频驱动）**：以每句实测时长重建时间线（音频不变速），停顿按「字幕原间隔 − 前句时长」推算，放不下才回落到 `gapSec`（默认 0.5，夹在 `[0,10]`）。
  - **模式 B（时间轴驱动）**：以字幕时间戳为槽位，先做单调化（相邻至少 `MIN_SLOT = 0.1s`），溢出时 `atempo` 加速（上限 `MAX_RATE = 1.15`）并重测时长，顶格仍放不下则顺延后续句子。
- 共同设施：逐句 TTS → 24 kHz 单声道 `pcm_s16le` WAV → `ffprobe` 量时长；`buildTrack()` 用静音补齐（差值 > 0.02s）+ `concat -c copy` 零重编码装配整轨，末尾做 ±0.3s 时长终验。
- 进度经 `voice:align-progress` 回推（`synth` / `assemble` / `done` / `error`），`voice:align-cancel` 可中断；旧任务目录按策略清理。

### 4.9 `video.ts` —— 转视频

- 频道：`dialog:open-html`（选 HTML 文件，**保留但渲染层当前无调用方**）、`video:show-in-folder`、`video:render`，以及推送 `video:progress`。
- 渲染流程：合规校验 → `findHyperframesCli()` / `findNode()`（返回 `{ cmd, env }`，首选 Electron 内嵌 Node）→ 建工作目录 `userData/hf-projects/html-video-<时间戳>/` 并整体复制素材 → **对渲染副本再本地化一次 GSAP（`localizeGsapHtml` + 按需 `copyGsapIntoProject`，包在 try/catch 中、失败不阻断）** → 注入环境（`{ ...process.env, ...nodeRt.env }`——复用 Electron 内嵌 Node 时这里带 `ELECTRON_RUN_AS_NODE=1`；FFmpeg bin 进 `PATH`，另设 `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` / `PRODUCER_HEADLESS_SHELL_PATH`）→ `spawn nodeRt.cmd <hf-cli> render -o output.mp4` → stdout/stderr 经 `video:progress` 实时回推 → 进程 `close` 判定成功并返回输出路径。
- 产物回写由渲染层经 `project:save-video` 完成（主进程 `video.ts` 不写 `project.json`）。
- `hf-projects/` 是渲染临时工作目录，**不在 `index.ts` 迁移老数据的白名单 `OWN_DATA_ENTRIES` 里**（每次渲染都重建、几百 MB，搬它没有意义）。

### 4.10 `whisper.ts` —— 本地转录与模型管理

- **内置模型档位 4 个**（`id` / 文件 / 体积）：`tiny-q8_0` / `ggml-tiny-q8_0.bin`、`base` / `ggml-base.bin`、`base-q5_1` / `ggml-base-q5_1.bin`、`small-q8_0` / `ggml-small-q8_0.bin`；下载走国内镜像 `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/`。
- 模型目录 `userData/whisper/models/`；CLI 路径由 `resolveCliPath()` 定位（打包态 `resources/whisper/`，开发态项目 `resources/whisper/`）。
- **`id ↔ 文件名` 严格对应**：只认登记名，不做前缀或模糊归属（`base` 与 `base-q5_1` 相互独立）；枚举外的文件列为「未知模型」，引导用户「添加自定义模型」（持久化在 `settings.json` 的 `whisper.customModels`）。
- 下载策略：边下边写 `.part`、进度节流回推 `whisper:progress`、完成后原子 `rename`、失败清理残片。
- 转录链路：`prepareAudio()`（whisper 不能直接解码的格式先用内置 ffmpeg 转 wav，临时文件用后清理）→ VAD 起止静音裁剪 → `spawn whisper-cli.exe`（`-m 模型 -f 音频 -oj JSON --no-prints -pp`）→ 解析 JSON 的 `transcription.segments` → `opencc-js` 繁转简 → 转成 `[分:秒] 文本`。**不直接写项目文件**，由渲染层弹窗「替换现有 / 追加到末尾」后经 `project:save-subtitle` 落盘。
- 进度两阶段：spawn 后先报「正在加载模型」（不确定态进度条），从 stderr 解析到 `progress = N%` 后进入「转录中 N%」。

### 4.11 `updater.ts` —— 应用自更新

- **更新源三级优先**：`settings.json` 的 `updater.feedUrl`（非空即 `setFeedURL({ provider: 'generic', url })` 覆盖）→ 打包时写入 `resources/app-update.yml` 的 `publish` 地址（由 `package.json` 的 `build.publish` 在 `npm run dist` 时生成）。
- **依赖加载是防御式的、并且是懒加载的**：`electron-updater` 用 `require()` 取 `autoUpdater`，整段包在 `try` 里并存下 `updaterLoadError`；缺依赖时所有 `update:*` 调用都返回 `{ ok: false, message, detail }`（`message` 是「更新模块不可用，请重新安装应用」，技术原因只留在 `detail`），**不会让主进程启动崩掉**（打包白名单漏项这类问题因此表现为「功能不可用」而不是「应用打不开」）。加载动作集中在 `ensureUpdater()`，**`register()` 不再触发它**——`electron-updater` 的模块图（实测 ~70ms，冷启动更久）因此不占用「建窗 → 首屏」这段时间；`autoCheck=false` 的用户整个会话都不会加载它。
- **下载策略**：`autoDownload = false`（安装包近 300 MB，只由用户点「下载更新」触发）、`autoInstallOnAppQuit = true`（已下载的更新在用户直接关窗时也会装上）。
- **安装前拒绝长任务**：`installNow()` 在 `busy` 时返回「当前有任务正在进行（转录 / 渲染 / 配音）」并拒绝重启。`busy` 不改动任何业务模块——它由 `bindBusyTracking()` 监听 4 路进度通道（`whisper:progress` / `video:progress` / `voice:align-progress` / `project:html-progress`）的起止自动推导。
- **与 `window-all-closed` 的配合**：`quitAndInstall()` 会触发窗口关闭，若入口的 `window-all-closed` 再 `app.quit()` 会与安装器抢退出流程，因此 `installNow()` 先置 `quitFlag`，入口据此直接 `return`（`updater.quitForUpdate()`）。
- **`stage` 刻意放宽为 `string`**：阶段由 electron-updater 的事件回调跨函数写入，若标注成 `UpdateStage` 联合类型，TS 的控制流分析会把函数内最后一次赋值当成当前类型，导致后续全部比较被判成「不可能分支」（实测报 9 处 `TS2367`）；交出前由 `toStage()` 白名单收口成 `UpdateStage`。
- **错误文案分两层（`message` / `detail`）**：`humanError()` 返回 `{ message, detail }` —— `message` 只说人话给终端用户（如「暂时没有可用的新版本信息，请稍后重试」），`detail` 存排障信息（原始报错**首行**截断 300 字符 + 从报错里抠出的请求地址，形如 `请求地址：<去掉查询串的 URL>；原始报错：<首行>`），由设置页的「查看详情」折叠展示；`setError()` 统一写 `state.stage='error'` / `error` / `detail` / `message`，取代原先三处各写一半的写法。抠 URL 是为了 403 / 404 能一眼看出「应用在请求哪个地址」。**判断顺序不可变**：403 的报错文本里必然含请求 URL，先判 `latest.yml` 会把权限问题误报成「文件没上传」。
- **打开日志目录**：`update:open-log` 的 handler 用 `shell.showItemInFolder()` 定位 `userData/updater.log`（没有日志则 `shell.openPath(userData)` 打开目录），返回 `{ ok, path }`；它**刻意不进 `ensureUpdater()`**——electron-updater 加载失败恰恰是最需要看日志的场景。所有事件与动作写 `userData/updater.log`，与 `preview-protocol.log` 同思路。
- **dev 环境**：未打包时需根目录提供 `dev-app-update.yml` 且置 `forceDevUpdateConfig = true` 才会检查；没有该文件则跳过启动静默检查（该文件名已进 `.gitignore`）。

### 4.12 `runtime.ts` —— 运行环境包

- **动机**：NSIS 更新是「整体卸载旧版 → 解压复制新包」，716MB / 4900+ 文件的运行资源每次更新都要重解压复制一遍（源码注释记的实测值：一次更新 97 秒，期间应用不存在）。拆包后安装目录里只剩 1 个 `runtime.7z`，解包由应用自己做（可显示进度），包内容没变时下次更新完全不碰这 716MB。包与清单由 `scripts/pack-runtime.mjs` 产出（`build/runtime-pack/`），随 `extraResources` 进安装目录，也可上传到更新源目录。
- **频道**：`runtime:status`（快照 `RuntimeProgressPayload`）、`runtime:prepare`（触发一次准备，返回 `{ ok, message?, detail? }`）、推送 `runtime:progress`（唯一出口 `push()`，发送前判 `win && !win.isDestroyed()`）。
- **主流程 `run()`**：① 已就绪（`current.json` 指针 + `<id>/ok.json` 标记同时在）⇒ `source='cache'` 直接成功（**常态**）→ ② 安装目录已是展开形态（非强制且 `<resources>/ffmpeg/bin/ffmpeg.exe` 存在）⇒ `source = legacy`（打包）/ `dev`（开发）→ ③ 定位 `7za`（`<resources>/tools/7za.exe`，dev 为 `build/tools/`，缺失即失败并提示重新打包）→ ④ 取包：随包 `runtime-pack/runtime.json` 优先（`source='local'`），缺失才从更新源下载（`source='download'`，边下边报进度、下完复核 sha512、不符即删残片）→ ⑤ 解包（`7za x <pack> -o<dest> -y -bsp1`，从 stdout 解析百分比）→ ⑥ **先写 `ok.json` 再写 `current.json`**，然后 `hfEnv.refreshBuiltinResources(dest)`（把资源根交给 `hfEnv`）+ `cleanOldPacks(id)`（旧包目录 716MB，留着无用）。
- **幂等与并发**：`ensureRuntime()` 在 `stage === 'ready'` 时直接成功、已有 `inFlight` 时复用同一个 Promise，因此「启动后台准备」与渲染层点「重新准备」共享同一次执行；`register()` 里 `prepareInBackground()` **默认延迟 2 秒**触发（与 `updater` 的 3 秒静默检查同思路，不抢启动时间）。
- **失败不阻断应用**：任何一步失败都走 `fail()`——只更新状态（`stage='failed'` + 人话 `message` + 排障 `detail`）、推一次进度、写 `userData/runtime.log`，并返回 `{ ok: false, … }`；`projects.ts` 的 `project:extract-video-audio` 会先 `await runtime.ensureRuntime()` 并把失败文案原样返回。详见 [files/main/runtime.ts.md](./files/main/runtime.ts.md)。

### 4.13 `vad.ts` —— 纯函数 VAD

- `readWavSamples()`：解析 16 bit PCM WAV（RIFF/WAVE，chunk 遍历含奇数长度补位、`dataLen` 截断、返回 `Int16Array` 交错样本）；无法识别时返回 `null`。
- `vadTrimSegments(samples, rate, segs)`：基于 20 ms 窗口的噪声底分位与阈值（`thr = max(noiseFloor*3, 200)`）做前后静音裁剪，并用 `leadSilWin 0.4s` / `tailSilWin 0.15s` / `padSec 0.1` / `minDur 0.25` 等参数修正边界，四类异常输入原样返回。
- 之所以拆成独立文件：**零依赖、纯函数、只用类型标注**（不用 `enum` / `namespace` / 构造函数参数属性等需要运行时转换的语法），便于被 `whisper.ts` 复用与单独审阅。

---

## 5. 目录内的通用实现约定

1. **spawn 样板统一**：`child_process.spawn` + `windowsHide: true` + Promise 包装（`runProc` 等），参数以数组传递、不经 shell。
2. **外部依赖只从 `resources/` 取**：一切外部可执行文件都经 `hfEnv.ts` / `resolveCliPath()` 定位，不假设系统已安装（FFmpeg 允许回退到 WinGet 安装位置）。
3. **返回约定**：业务接口统一 `{ ok: true, ... }` / `{ ok: false, message, canceled? }`；查询类可返回数组或 `null`。
4. **进度回推节流**：下载与转录的高频进度按时间/百分比节流后再 `webContents.send`，避免刷爆 IPC。
5. **路径安全**：所有项目内路径由 `projectDir()` 派生并做前缀校验；临时产物集中在 `userData` 下的工作目录或系统临时目录，用后清理。
6. **userData 位置保持 Electron 默认**：`USER_DATA_DIR = app.getPath('userData')` = `%APPDATA%\<package.json 的 name>`，**没有 `setPath`、没有位置钉死**；老数据靠 `index.ts` 的「归属证明 + 用户确认式处置」处理（`legacy:status` 交给渲染层弹应用内弹窗，`legacy:resolve` 执行迁移 / 删除 / 稍后三选一），详见 [files/main/index.ts.md](./files/main/index.ts.md) §3.1。
7. **userData 路径一律惰性求值（纯保险）**：`projects.projectsRoot()` / `whisper.modelsDir()` / `runtime.runtimeRoot()` / `settings.settingsFile()` 都写成函数 / getter——当前位置只跟随 `name`，快照本来也正确，但将来若有人重新引入 `setPath` 之类的改动，模块级快照会静默钉在当时的位置（ESM import 提升使其早于 `index.ts` 模块体求值）；函数化是零代价的保险，不要退化成常量，也不要在模块顶层 `const root = …()`。
8. **改 `package.json` 的 `name` 必须手动登记旧目录名**：`index.ts` 的 `LEGACY_DIR_NAMES`（现为 `['my-app']`）是**唯一**的发现机制，没有任何自动发现；忘了加，老用户就会看到「项目全没了」。
9. **持久化边界**：只有 `settings.ts` 与 `projects.ts` 直接写盘；其余模块通过它们落盘（如 `video.ts` 不回写 `project.json`，由渲染层调 `project:save-video`）；`runtime.ts` 是例外——它只写自己的 `userData/runtime/**`（解包目录 + `current.json` / `<id>/ok.json`）。
10. **载荷 / 结果类型全部来自 `src/shared/types.ts`**：`src/main/` 下已无本地声明的 payload / result / progress 接口，各 handler 的 `payload` 参数统一标注共享层的 `*Payload`（如 `ProjectAgentPayload`、`WhisperTranscribePayload`、`VoiceSynthPayload`、`SettingsSaveUpdaterPayload`、`LegacyResolveAction`），进度推送统一用 `HtmlProgressPayload` / `WhisperProgressPayload` / `AlignProgressPayload` / `UpdateProgressPayload` / `RuntimeProgressPayload`；项目结构类型（`Scene` / `ContentScript` / `Project` / `SubtitleLine`）由 `projects.ts` 再导出。（`updater.ts` 内部的 `UpdaterLike`、`runtime.ts` 的 `RuntimeManifest` 等是对外部契约的最小结构描述，不是 IPC 载荷类型。）
11. **运行时依赖由 electron-builder 自动收集，不要手写 `node_modules` 白名单**：`build.files` 里**没有** `"!node_modules/**/*"`，`dependencies`（`openai` / `opencc-js` / `electron-updater`）及其传递依赖闭包由打包器自动纳入 asar，只显式排除构建期包（`@vue` / `@babel` / `vue`）。早前手写白名单时漏了 `electron-updater → builder-util-runtime → debug`（及其 `ms`），安装版 `require('debug')` 直接失败、自动更新整条不可用，而 **dev 下永远正常**。因此新增 `dependencies` 后仍要复核：`npm run pack && npx asar list dist/win-unpacked/resources/app.asar | findstr /C:"node_modules\<包名>\"`。

---

## 6. 相关文档

- 逐文件说明：[files/main/](./files/main/)
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- IPC 契约全貌：[01-架构总览.md](./01-架构总览.md) 第 3 节
