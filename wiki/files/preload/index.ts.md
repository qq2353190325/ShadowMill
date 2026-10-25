# src/preload/index.ts

> 通过 contextBridge 向渲染层暴露 **13** 个命名空间的预加载桥接层（本轮 `castTools` 从 7 个方法扩到 **12** 个：新增动作示范的 `listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`；**命名空间数与频道计数只变 `Cast` 组**：`Cast` 6 → 11、全库 101 → 106）

- **所在目录**：`src/preload/`
- **类型**：预加载脚本（sandboxed preload，编译为 CJS）
- **规模**：**305 行**（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：本文件不产生模块导出；其作用是把 **13** 个命名空间注入渲染层 `window`，命名空间为 `electronAPI`、`appTools`、`windowControls`、`hfTools`、`settingsTools`、`voiceTools`、`whisperTools`、`projectTools`、**`castTools`**、`scriptTools`、`updateTools`、`runtimeTools`、`legacyTools`
- **类型契约**：13 个对象全部以 `PreloadApi['<命名空间>']` 标注（`PreloadApi` 定义在 `src/shared/types.ts` ⑨ 节），因此实现被契约校验；渲染层看到的签名由 `src/preload/index.d.ts` 挂载同一份契约

## 1. 作用与职责

本文件是 Electron 主进程与渲染进程之间的**唯一安全通道**。它不直接操作任何业务逻辑，只做三件事：

1. 用 `contextBridge.exposeInMainWorld` 把固定命名的 API 对象挂到渲染层的 `window` 上，使渲染层（Vue 页面）无需开启 `nodeIntegration` 即可调用主进程能力。
2. 为每个方法绑定一个来自 `IPC` 常量的频道名，`invoke` 用于请求-响应，`send` 用于单向通知。
3. 转发进度推送频道：模块级只注册一次 `ipcRenderer.on`，避免页面切换时监听器不断叠加。**分发方式分两种**：`project:html-progress` 是**一条频道 + 按任务 id 分发**（`_progressCbs` 这个 `Map<taskId, 回调>` + `_htmlProgressBound`，订阅函数返回退订函数）；其余 **5 路**仍是「单槽回调、后注册覆盖前注册」（`script:progress` / `whisper:progress` / `voice:align-progress` / `update:progress` / `runtime:progress`）；`hfTools.onProgress`（`video:progress`）直接 `ipcRenderer.on`，没有任何模块级状态。**整层仍是 7 路进度订阅**。**动作示范的 5 个方法（`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`）全是请求-响应，没有新增进度通道**；「AI 生成专属动作」的进度走既有的 `project:html-progress`，用的是它**自己的 taskId**（`newTaskId('act')`），因此可以与「生成 HTML」「画角色」并行。

由于 preload 运行在 sandbox 环境且全项目无 `"type":"module"`，本文件必须被编译为 **CJS**；`import` 由 electron-vite 打包内联，运行时仅依赖 `require('electron')`。

## 2. 导出与关键实现

本文件无 ES 导出，全部实现以 `contextBridge.exposeInMainWorld` 的形式对外暴露。

### 2.0 类型标注方式（`PreloadApi['<命名空间>']`）

**13** 个对象都写成「契约标注 + 字面量实现」的形式：

```ts
import type {
  AlignProgressPayload,
  HtmlProgressPayload,
  PreloadApi,
  RenderCanvas,
  RenderOverride,
  RuntimePackName,
  RuntimeProgressPayload,
  ScriptProgressPayload,
  UpdateProgressPayload,
  VideoRenderPayload,
  WhisperProgressPayload
} from '../shared/types'
```

（以上为 `src/preload/index.ts` 头部的逐字内容，**`PreloadApi` + 10 个类型**。）

```ts
const hfTools: PreloadApi['hfTools'] = { /* 方法实现 */ };
contextBridge.exposeInMainWorld('hfTools', hfTools);
```

- `PreloadApi` 定义在 `src/shared/types.ts` ⑨ 节，是「preload 实现 ↔ 渲染层消费」的唯一真源；方法名拼错、参数个数不符、返回类型不匹配都会在 `tsconfig.node.json` 阶段直接编译失败。
- 进度回调的模块级状态变量也用共享层的载荷类型标注：`_progressCbs` 是 `Map<string, (data: HtmlProgressPayload) => void>`、`_scriptProgressCb: ((data: ScriptProgressPayload) => void) | null`、`_whisperProgressCb`、`_alignProgressCb`、`_updateProgressCb`、`_runtimeProgressCb`。
- 本文件不再从 `../shared/types` 引入业务结构：这些类型已由 `PreloadApi` 的成员签名间接表达。**`CastLibraryMember` / `CastActionResult` / `CastDemoResult` 同样不进 preload 的 import 清单**——它们的形状已经写在 `PreloadApi['castTools']` 的方法签名里。

### 2.1 非方法成员（electronAPI）

| 命名空间 | 成员 | 底层来源 | 说明 |
| --- | --- | --- | --- |
| `electronAPI` | `platform` | `process.platform` | 当前平台标识（如 `win32`） |
| `electronAPI` | `versions` | `process.versions` | 含 `node` / `chrome` / `electron` 三个版本号字符串 |

### 2.2 命名空间 → 方法 → 频道 全量对照

| 命名空间 | 方法 | 底层 IPC 频道 | 说明 |
| --- | --- | --- | --- |
| `appTools` | `copyText` | `app:copy-text` | 经主进程写剪贴板（sandbox 下渲染层无 clipboard 模块）；`invoke`，返回 `Promise<boolean>` |
| `windowControls` | `minimize` / `toggleMaximize` / `close` | `window:minimize` / `window:toggle-maximize` / `window:close` | `send` 单向 |
| `windowControls` | `onMaximizedChange` | `window:maximized-change` | 监听最大化状态回推，回调参数 `isMaximized: boolean` |
| `hfTools` | `openHtml` | `dialog:open-html` | 返回 `Promise<string \| null>`；**保留但渲染层当前无调用方** |
| `hfTools` | `renderVideo` | `video:render` | `invoke(IPC.Video.Render, Object.assign({ htmlPath }, options \|\| {}))`，载荷形如 `{ htmlPath, quality?, fps?, canvas? }`；`options` 类型是 `Omit<VideoRenderPayload, 'htmlPath'>` |
| `hfTools` | `showInFolder` | `video:show-in-folder` | 在文件管理器中定位产物 |
| `hfTools` | `onProgress` | `video:progress` | 渲染进度订阅，数据形如 `{ text }` |
| `settingsTools` | `get` | `settings:get` | 读取 `AppSettings` |
| `settingsTools` | `save` | `settings:save` | 传 `{ customModel }` |
| `settingsTools` | `saveRender` | `settings:save-render` | 传 `{ render }`（`RenderOverride`） |
| `settingsTools` | `saveUpdater` | `settings:save-updater` | 传 `{ updater }`（`feedUrl` / `autoCheck` / `skippedVersion`） |
| `settingsTools` | `test` | `settings:test` | 传 `{ customModel }` 测试连通性 |
| `settingsTools` | `pickRuntimePack` | `settings:pick-runtime-pack` | 运行环境「从本地文件安装…」（取消时 `{ ok:false, canceled:true }`） |
| `voiceTools` | `getConfig` / `getSaveDir` / `saveConfig` | `voice:get-config` / `voice:get-save-dir` / `voice:save-config` | 语音配置（按厂家）；`saveConfig` 直接透传 `VoiceSaveConfigPayload` |
| `voiceTools` | `pickAudio` / `pickDir` / `listGenerated` | `voice:pick-audio` / `voice:pick-dir` / `voice:list-generated` | 选文件 / 选目录 / 列已生成音频 |
| `voiceTools` | `create` | `voice:create` | 传 `{ audioPath, preferredName, targetModel }` 克隆音色 |
| `voiceTools` | `list` / `listSystemVoices` / `listAll` / `listModels` | `voice:list` / `voice:list-system-voices` / `voice:list-all` / `voice:list-models` | 音色与模型列表 |
| `voiceTools` | `getProfiles` / `saveProfile` / `deleteProfile` / `deleteCloudVoice` | `voice:get-profiles` / `voice:save-profile` / `voice:delete-profile` / `voice:delete-cloud` | 本地音色映射与云端克隆音色（后者**不可撤销**） |
| `voiceTools` | `synth` / `synthAligned` / `cancelAlign` / `onAlignProgress` | `voice:synth` / `voice:synth-aligned` / `voice:align-cancel` / `voice:align-progress` | 合成（7 个位置参数展开成对象）/ 逐句对齐 / 取消（`send`）/ 进度（单订阅） |
| `whisperTools` | `status` / `download` / `delete` / `setCurrent` | `whisper:status` / `whisper:download` / `whisper:delete` / `whisper:set-current` | 模型状态与增删 |
| `whisperTools` | `addModel` / `updateModel` / `removeModel` | `whisper:add-model` / `whisper:update-model` / `whisper:remove-model` | 自定义模型（载荷原样透传） |
| `whisperTools` | `openDir` / `pickAudio` / `projectAudio` / `transcribe` / `onProgress` | `whisper:open-dir` / `whisper:pick-audio` / `whisper:project-audio` / `whisper:transcribe` / `whisper:progress` | 目录 / 音频 / 转录 / 进度（单订阅） |
| `projectTools` | `list` / `create` / `load` | `project:list` / `project:create` / `project:load` | 项目列表 / 新建（裸 `name`）/ 载入（裸 `name`，返回的 `materials` 已规范化） |
| `projectTools` | `saveSubtitle` / `saveContent` | `project:save-subtitle` / `project:save-content` | `{ name, subtitle, title }` / `{ name, content }` |
| `projectTools` | `generateHtml` / `modifyHtml` | `project:generate-html` / `project:modify-html` | `{ name, prompt, ...(materials \|\| {}) }`；`materials` 类型是 **`Omit<ProjectAgentPayload, 'name' \| 'prompt'>`（必填）**，含必填 `taskId` |
| `projectTools` | `downloadHtml` / `exportSrt` / `readHtml` / `saveHtml` / `previewHtml` | `project:download-html` / `project:export-srt` / `project:read-html` / `project:save-html` / `project:preview-html` | 导出 / 读取 / 手写保存 / 预览副本 |
| `projectTools` | `pickAudio` / `setAudio` / `clearAudio` | `project:pick-audio` / `project:set-audio` / `project:clear-audio` | 背景音频（`setAudio` 成功分支带可选 `htmlUpdated`） |
| `projectTools` | `pickMedia` / `addMaterials` / `saveMaterials` | `project:pick-media` / `project:add-materials` / `project:save-materials` | 项目素材库：选文件（**返回裸 `string[]`**）/ 复制入库 / 整份回写 |
| `projectTools` | `extractVideoAudio` | `project:extract-video-audio` | 从项目视频提取原声；**界面入口临时下线，方法保留** |
| `projectTools` | `openFolder` / `openFolderOf` / `delete` | `project:open-folder` / `project:open-folder-of` / `project:delete` | 目录与删除 |
| `projectTools` | `saveVideo` / `setRender` / `setCanvas` | `project:save-video` / `project:set-render` / `project:set-canvas` | 产物回写 / 渲染档位覆盖（`null` 清除）/ 成片画布（项目属性） |
| `projectTools` | **`saveCast`** | `project:save-cast` | **本片用哪几个角色**：`saveCast(name, cast)` → `invoke(…, { name, cast })`，`cast` 是 `[{ id, selected }]` |
| `projectTools` | **`onTaskProgress`** | `project:html-progress` | **按任务 id 订阅进度**（生成 HTML / 修改 / 画角色 / **编动作**）：`onTaskProgress(taskId, cb)` → 退订函数 |
| **`castTools`** | **`list` / `create` / `recreate`** | `cast:list` / `cast:create` / `cast:recreate` | 角色库：列库 / 画一个新角色 / 按 `request` 重画库里那份 |
| **`castTools`** | **`saveMeta` / `remove`** | `cast:save-meta` / `cast:remove` | 只改元数据（不调模型）/ 从库里删（连带清专属动作） |
| **`castTools`** | **`preview`** | `cast:preview` | **静态预览（一帧）**：`preview(id, options?)` → `invoke(…, { id, ...(options \|\| {}) })`，回 `{ ok, rel }` |
| **`castTools`** | **`listActions`** | `cast:action-list` | **列动作**：`listActions(castId)` → `invoke(…, { castId })`，回 `{ ok, shared, own }` |
| **`castTools`** | **`saveAction`** | `cast:action-save` | **存一条关键帧动作**：`saveAction(payload)` → `invoke(…, payload \|\| {})`（`{ castId, scope, action }`） |
| **`castTools`** | **`removeAction`** | `cast:action-remove` | **删一条动作**：`removeAction(payload)` → `invoke(…, payload \|\| {})`（`{ castId, scope, actionId }`） |
| **`castTools`** | **`generateAction`** | `cast:action-generate` | **AI 生成专属动作**（唯一会调模型的动作路径）：`generateAction(payload)` → `invoke(…, payload \|\| {})`，回 `{ ok, action }` |
| **`castTools`** | **`demo`** | `cast:demo` | **会动的示范页**：`demo(id, options?)` → `invoke(…, { id, ...(options \|\| {}) })`，回 `{ ok, rel }`（`rel` 形如 `cast-preview/hero.demo.html`） |
| **`castTools`** | **`onTaskProgress`** | `project:html-progress` | **与 `projectTools.onTaskProgress` 共用同一个订阅函数**：一条频道 + 按 `taskId` 分发 |
| `scriptTools` | `generate` | `script:generate` | 内容脚本 Agent：载荷原样透传，返回 `ScriptGenerateReply`（不走 `IpcResult`） |
| `scriptTools` | `loadChat` / `appendRound` / `readVersion` / `setActiveVersion` / `clearChat` | `script:*` 五条 | 对话记录（索引 / 追加一版 / 读某版 / 应用某版 / 清空） |
| `scriptTools` | `onProgress` | `script:progress` | 内容脚本进度（单订阅） |
| `updateTools` | `version` | `update:version` | **同步**返回当前版本号（`sendSync`） |
| `updateTools` | `check` / `download` / `cancel` / `install` | `update:*` 四条 | 检查 / 下载 / 取消 / 安装 |
| `updateTools` | `status` / `openLog` / `changelog` | `update:status` / `update:open-log` / `update:changelog` | 取当前状态 / 定位日志 / 取更新日志原文 |
| `updateTools` | `onProgress` | `update:progress` | 更新进度订阅（单订阅） |
| `runtimeTools` | `status` / `prepare` / `cancel` | `runtime:status` / `runtime:prepare` / `runtime:cancel` | 运行环境（**载荷必须是普通数组**：`toRaw(list).slice()`，`Proxy` 过不了结构化克隆） |
| `runtimeTools` | `onProgress` | `runtime:progress` | 运行环境进度（单订阅） |
| `legacyTools` | `status` / `resolve` | `legacy:status` / `legacy:resolve` | 旧数据目录（`resolve` 只把 `action` 字符串透传） |

### 2.3 本轮新增的 5 个方法（动作示范，逐字一致）

```ts
  listActions: (castId: string) => ipcRenderer.invoke(IPC.Cast.ActionList, { castId }),
  saveAction: (payload) => ipcRenderer.invoke(IPC.Cast.SaveAction, payload || {}),
  removeAction: (payload) => ipcRenderer.invoke(IPC.Cast.RemoveAction, payload || {}),
  generateAction: (payload) => ipcRenderer.invoke(IPC.Cast.GenerateAction, payload || {}),
  demo: (id: string, options) => ipcRenderer.invoke(IPC.Cast.Demo, { id, ...(options || {}) }),
```

- 位置在 `castTools` 的 `preview` 之后、`onTaskProgress` 之前；上方注释写清「动作示范（「角色」页 · 双击卡片 /「…」菜单）」以及「动作 = 时间 → 动画参数的曲线，存 `<userData>/cast-library/actions.json`」。
- **只组装载荷 + `invoke`**：不拼路径、不读写文件、不拼示范页。落盘与拼页都在主进程 `cast/actions.ts` / `cast/demo.ts`，IPC 装配在 `projects/ipc/castActions.ts`。
- **`saveAction` / `removeAction` / `generateAction` 是整对象透传**（`payload || {}`），所以新增可选字段不需要改 preload；`listActions` 只组装 `{ castId }`，`demo` 把 `options` **展开合并**进 `{ id, ... }`（与 `preview`、`generateHtml` 同一手法）。
- **`demo` 的 `options` 类型**是 `Omit<CastDemoPayload, 'id'>`（= `Omit<CastPreviewPayload, 'id'>`：`units?` / `title?` / `uses?`），由 `CastDemoShot.vue` 就地拼成普通对象（不是 reactive `Proxy`），能过结构化克隆。
- **方法数 7 → 12**，与 `shared/ipc.ts` 的 `Cast` 组 6 → 11、`projects/ipc/castActions.ts` 的 5 个 `ipcMain.handle` 一一对应（**三处齐改**）。

### 2.4 `projectTools` 侧的变化

- **下线 6 个角色方法**：`listCastLibrary` / `promoteCast` / `importCast` / `removeCastFromLibrary` / `newCast` / `castPreview`（页面里已没有 `projectTools.castPreview`，改成 `castTools.preview`）。`projectTools` 从 **33 → 27** 个方法。
- **保留 `saveCast(name, cast)`**，载荷是 `[{ id, selected }]`（`ProjectCastSelection[]`），不再是完整成员快照。
- **`onTaskProgress` 仍是「一条频道 + 按任务 id 分发」**：

```ts
  onTaskProgress: (taskId, callback) => {
    if (!taskId || typeof callback !== 'function') return () => {};
    _progressCbs.set(taskId, callback);
    if (!_htmlProgressBound) {
      _htmlProgressBound = true;
      ipcRenderer.on(IPC.Project.HtmlProgress, (_event, data) => {
        const d = data as HtmlProgressPayload | undefined;
        const fn = (d && d.taskId) ? _progressCbs.get(d.taskId) : null;
        if (fn) fn(d as HtmlProgressPayload);
      });
    }
    return () => {
      if (_progressCbs.get(taskId) === callback) _progressCbs.delete(taskId);
    };
  }
```

  模块级状态：`const _progressCbs = new Map<string, (data: HtmlProgressPayload) => void>();` + `let _htmlProgressBound = false;`。
  - **没带 `taskId` 的推送直接丢弃**；同一个 `taskId` 重复订阅以最后一次为准（不影响别的 `taskId`）。
  - **退订函数只在「Map 里仍指向同一个回调」时才删除**，旧持有者不会误删新的那个。
  - 这样「生成 HTML」与「画角色 / 编动作」可以并行，各拿各的进度。

## 3. 关键流程或结构

### 3.1 三种通道形态

| 形态 | 用法 | 代表频道 |
| --- | --- | --- |
| 请求-响应 | `ipcRenderer.invoke(channel, payload)` | `settings:get`、`project:list`、`project:pick-media`、**`cast:*` 11 条**、`update:open-log`、`update:changelog` |
| 单向通知 | `ipcRenderer.send(channel)` | `window:minimize`、`voice:align-cancel` |
| 同步取值 | `ipcRenderer.sendSync(channel)` | `update:version`（全工程唯一的同步频道） |
| 主进程推送 | `ipcRenderer.on(channel, handler)` | `window:maximized-change`、`video:progress`、`update:progress`、`runtime:progress` |

### 3.2 7 路进度通道与两种分发方式

| 通道 | 订阅方法 | 相关模块级状态 |
| --- | --- | --- |
| `video:progress` | `hfTools.onProgress` | 无状态标志（直接 `ipcRenderer.on` 注册） |
| `project:html-progress` | `projectTools.onTaskProgress(taskId, cb)` / **`castTools.onTaskProgress`** | **`_progressCbs`（`Map<taskId, 回调>`）+ `_htmlProgressBound`；返回退订函数** |
| `script:progress` | `scriptTools.onProgress` | `_scriptProgressCb`、`_scriptProgressBound` |
| `whisper:progress` | `whisperTools.onProgress` | `_whisperProgressCb`、`_whisperProgressBound` |
| `voice:align-progress` | `voiceTools.onAlignProgress` | `_alignProgressCb`、`_alignProgressBound` |
| `update:progress` | `updateTools.onProgress` | `_updateProgressCb`、`_updateProgressBound` |
| `runtime:progress` | `runtimeTools.onProgress` | `_runtimeProgressCb`、`_runtimeProgressBound` |

- **单槽（script / whisper / align / update / runtime）**：`onXxxProgress(cb)` 总是覆盖模块级回调，只在第一次真正 `ipcRenderer.on`；监听函数内部读模块级回调再调用。目的是避免页面切换时监听器叠加（重复执行 / 旧页面回调泄漏），代价是同一时刻只有一个订阅者。
- **一条频道 + 按任务 id 分发（`project:html-progress`）**：见 §2.4；页面级任务与弹窗级任务（画角色 / 编动作）可以并行、互不顶掉。

### 3.3 为什么必须是 CJS

- Electron 的 sandboxed preload 不支持 ESM 加载语义，preload 必须是 CommonJS 产物。
- 全项目 `package.json` 未声明 `"type":"module"`，且 `electron.vite.config.ts` 的 `preload` 段仅启用 `externalizeDepsPlugin()`。
- 因此 `import { contextBridge, ipcRenderer } from 'electron'` 在构建时被内联/转译，运行时只依赖 `require('electron')`；改成 ESM 会直接加载失败。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | `electron` | 仅使用 `contextBridge` 与 `ipcRenderer` |
| 依赖 | `../shared/ipc` | `IPC` 常量对象，所有频道名均取自此处，不写字面量 |
| 依赖（仅类型） | `../shared/types` | `PreloadApi`（**13** 个对象的契约类型）与各进度载荷类型（`AlignProgressPayload` / `HtmlProgressPayload` / `RenderCanvas` / `RenderOverride` / `RuntimePackName` / `RuntimeProgressPayload` / `ScriptProgressPayload` / `UpdateProgressPayload` / `VideoRenderPayload` / `WhisperProgressPayload`） |
| 被构建使用 | `electron.vite.config.ts` → `preload` 段 | 打包为 out/preload 产物，由主进程 `webPreferences.preload` 加载 |
| 被消费 | 渲染层全部页面 | 契约由 `src/shared/types.ts` ⑨ 节定义、经 `src/preload/index.d.ts` 挂到 `window`。**`onTaskProgress` 的调用点**：`HtmlGenPage/index.vue`（`newTaskId('html')`）、`CastPage/CastEditModal.vue`（画角色）、**`CastPage/CastActionModal.vue`（`newTaskId('act')`，编动作）** |
| 对端实现 | `src/main/**` | `ipcMain.handle` / `ipcMain.on` 的注册方；**动作 5 条在 `projects/ipc/castActions.ts`**，角色 6 条在 `projects/ipc/cast.ts`，`project:html-progress` 的推送方在 `projects/progress.ts` |

## 5. 注意事项与实现要点

- **频道名不得硬编码**：所有频道都通过 `IPC.Xxx.Yyy` 取用，禁止改成字符串字面量。
- **方法名与参数顺序是对外契约**：唯一真源是 `src/shared/types.ts` ⑨ 节的 `PreloadApi`；本文件的 **13** 个对象都以 `PreloadApi['<命名空间>']` 标注，渲染层经 `index.d.ts` 的 `interface Window extends PreloadApi {}` 拿到同一份签名。
- **`send` 与 `invoke` 不可混用**：窗口三操作与 `voiceTools.cancelAlign` 是 `send`，`updateTools.version` 是 `sendSync`，其余基本是 `invoke`（含全部 `cast:*`）。
- **payload 透传**：`whisperTools.addModel/updateModel/removeModel/transcribe`、`voiceTools.synthAligned`、**`castTools.saveAction/removeAction/generateAction`** 原样透传对象载荷；`voiceTools.synth` / `create`、`castTools.preview` / `demo`、`projectTools.generateHtml` 则把位置参数组装 / 展开成载荷对象。
- **对象展开的坑**：`{ name, prompt, ...(materials || {}) }`、`{ id, ...(options || {}) }` 这类写法是同层平铺，`options` / `materials` 里不要出现与外层同名的键。
- **载荷必须是普通对象 / 数组**：`invoke` 要过**结构化克隆**，Vue 响应式 `Proxy` 会抛 `DataCloneError`。素材三件套、`saveCast`、`castPreview` / **`castTools.demo`** 的 `options` 都是就地拼的普通对象 / 数组。
- **订阅方式的差异**：`onTaskProgress` **有退订函数**，调用方必须在 `finally` 里 `off()`；其余 `onProgress` 无法注销，页面卸载后旧回调仍被引用，回调里访问已销毁的组件状态需自行容错。
- **`castTools.preview` / `castTools.demo` 都是只读动作**：主进程只读角色代码 + 写 `<userData>/cast-preview/` 下的一页 HTML（`<id>.html` 与 `<id>.demo.html`），**不改任何项目文件**。渲染层拿到 `rel` 后用 `utils/url.ts` 的 `userFileUrl(rel)` 拼 `hgpreview://user/…?user=1`；续接参数必须用 `&`（写成 `?e=` 会 404）。**换动作只改 hash**，`&e=<epoch>` 只在角色重画 / 动作增删时变。
- **`process` 可用性**：preload 在 sandbox 下仍可读 `process.platform` 与 `process.versions`，但不可假设其他 Node 能力可用。
