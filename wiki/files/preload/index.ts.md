# src/preload/index.ts

> 通过 contextBridge 向渲染层暴露 **12** 个命名空间的预加载桥接层

- **所在目录**：`src/preload/`
- **类型**：预加载脚本（sandboxed preload，编译为 CJS）
- **规模**：259 行
- **对外导出**：本文件不产生模块导出；其作用是把 **12** 个命名空间注入渲染层 `window`，命名空间为 `electronAPI`、`appTools`、`windowControls`、`hfTools`、`settingsTools`、`voiceTools`、`whisperTools`、`projectTools`、**`scriptTools`**、`updateTools`、`runtimeTools`、`legacyTools`
- **类型契约**：12 个对象全部以 `PreloadApi['<命名空间>']` 标注（`PreloadApi` 定义在 `src/shared/types.ts` ⑨ 节），因此实现被契约校验；渲染层看到的签名由 `src/preload/index.d.ts` 挂载同一份契约

## 1. 作用与职责

本文件是 Electron 主进程与渲染进程之间的**唯一安全通道**。它不直接操作任何业务逻辑，只做三件事：

1. 用 `contextBridge.exposeInMainWorld` 把固定命名的 API 对象挂到渲染层的 `window` 上，使渲染层（Vue 页面）无需开启 `nodeIntegration` 即可调用主进程能力。
2. 为每个方法绑定一个来自 `IPC` 常量的频道名，`invoke` 用于请求-响应，`send` 用于单向通知。
3. 对进度推送频道实施**单订阅语义**：模块级保存回调并仅注册一次 `ipcRenderer.on`，重复注册只替换回调，避免页面切换时监听器不断叠加 —— 有单订阅标志的是 **6 路**：`project:html-progress` / **`script:progress`** / `whisper:progress` / `voice:align-progress` / `update:progress` / `runtime:progress`；`hfTools.onProgress`（`video:progress`）仍是直接转发的 `ipcRenderer.on`，没有单订阅包装（详见 3.2）。**整层因此是 7 路进度订阅**——源文件头注释的「6 个进度推送通道」指的是有单订阅标志的那 6 路。

由于 preload 运行在 sandbox 环境且全项目无 `"type":"module"`，本文件必须被编译为 **CJS**；`import` 由 electron-vite 打包内联，运行时仅依赖 `require('electron')`。

## 2. 导出与关键实现

本文件无 ES 导出，全部实现以 `contextBridge.exposeInMainWorld` 的形式对外暴露。

### 2.0 类型标注方式（`PreloadApi['<命名空间>']`）

**12** 个对象都写成「契约标注 + 字面量实现」的形式：

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

（以上为 `src/preload/index.ts` 第 10–22 行的逐字内容，**`PreloadApi` + 10 个类型**；本轮新增的是 `ScriptProgressPayload`。）

```ts
const hfTools: PreloadApi['hfTools'] = { /* 方法实现 */ };
contextBridge.exposeInMainWorld('hfTools', hfTools);
```

- `PreloadApi` 定义在 `src/shared/types.ts` ⑨ 节，是「preload 实现 ↔ 渲染层消费」的唯一真源；方法名拼错、参数个数不符、返回类型不匹配都会在 `tsconfig.node.json` 阶段直接编译失败。
- 进度回调的模块级状态变量也用共享层的载荷类型标注：`_htmlProgressCb: ((data: HtmlProgressPayload) => void) | null`、**`_scriptProgressCb: ((data: ScriptProgressPayload) => void) | null`**、`_whisperProgressCb`、`_alignProgressCb`、`_updateProgressCb`、`_runtimeProgressCb`（`hfTools.onProgress` 仍是就地构造的 `{ text: string }`）。
- 本文件不再从 `../shared/types` 引入 `AppSettings` / `CustomModelConfig` / `VoiceProfile` / `VoiceTTSConfig` 等业务结构：这些类型已由 `PreloadApi` 的成员签名间接表达。

### 2.1 非方法成员（electronAPI）

| 命名空间 | 成员 | 底层来源 | 说明 |
| --- | --- | --- | --- |
| `electronAPI` | `platform` | `process.platform` | 当前平台标识（如 `win32`） |
| `electronAPI` | `versions` | `process.versions` | 含 `node` / `chrome` / `electron` 三个版本号字符串 |

### 2.2 命名空间 → 方法 → 频道 全量对照

| 命名空间 | 方法 | 底层 IPC 频道 | 说明 |
| --- | --- | --- | --- |
| `appTools` | `copyText` | `app:copy-text` | 经主进程写剪贴板（sandbox 下渲染层无 clipboard 模块）；`invoke`，返回 `Promise<boolean>` |
| `windowControls` | `minimize` | `window:minimize` | `send` 单向，最小化窗口 |
| `windowControls` | `toggleMaximize` | `window:toggle-maximize` | `send` 单向，最大化/还原切换 |
| `windowControls` | `close` | `window:close` | `send` 单向，关闭窗口 |
| `windowControls` | `onMaximizedChange` | `window:maximized-change` | 监听主进程回推的最大化状态，回调参数 `isMaximized: boolean` |
| `hfTools` | `openHtml` | `dialog:open-html` | 选择 HTML 文件，返回 `Promise<string \| null>`；**保留但渲染层当前无调用方** |
| `hfTools` | `renderVideo` | `video:render` | 传 `{ htmlPath, ...options }`，实现是 `ipcRenderer.invoke(IPC.Video.Render, Object.assign({ htmlPath }, options \|\| {}))`，即载荷形如 `{ htmlPath, quality?, fps?, canvas? }`：档位（质量 / 帧率）缺省项**不下发**（交给 CLI 默认 standard / 30），而 `canvas`（**成片画布方向，项目属性**）缺省时由主进程落 `DEFAULT_CANVAS`。签名本次由 `options?: RenderOverride` 改为 `options?: Omit<VideoRenderPayload, 'htmlPath'>`（`htmlPath` 已由第一参数给，故排除） |
| `hfTools` | `showInFolder` | `video:show-in-folder` | 在文件管理器中定位产物 |
| `hfTools` | `onProgress` | `video:progress` | 渲染进度订阅，数据形如 `{ text }` |
| `settingsTools` | `get` | `settings:get` | 读取 `AppSettings` |
| `settingsTools` | `save` | `settings:save` | 传 `{ customModel }` 保存自定义模型配置 |
| `settingsTools` | `saveRender` | `settings:save-render` | 传 `{ render }` 保存视频渲染默认档位（`RenderOverride`） |
| `settingsTools` | `saveUpdater` | `settings:save-updater` | 传 `{ updater }` 保存更新设置（`Partial<UpdaterSettings>`：`feedUrl` / `autoCheck` / `skippedVersion`） |
| `settingsTools` | `test` | `settings:test` | 传 `{ customModel }` 测试连通性 |
| `settingsTools` | `pickRuntimePack` | `settings:pick-runtime-pack` | 运行环境「从本地文件安装…」：弹文件框选 `ffmpeg.7z` / `hyperframes.7z`（取消时 `{ ok:false, canceled:true }`；导入成功后调用方接着 `runtimeTools.prepare()`） |
| `voiceTools` | `getConfig` | `voice:get-config` | 取语音配置（`{ active, providers, saveDir }`，**按厂家**） |
| `voiceTools` | `getSaveDir` | `voice:get-save-dir` | 传 `{ saveDir?, defaultOut?, projectName? }` 解析保存目录 |
| `voiceTools` | `saveConfig` | `voice:save-config` | **直接透传载荷** `VoiceSaveConfigPayload`（`{ provider?, config }`）到主进程——不再包 `{ voiceTTS }` |
| `voiceTools` | `pickAudio` | `voice:pick-audio` | 选择音频文件 |
| `voiceTools` | `pickDir` | `voice:pick-dir` | 选择目录 |
| `voiceTools` | `listGenerated` | `voice:list-generated` | 列出已生成音频 |
| `voiceTools` | `create` | `voice:create` | 传 `{ audioPath, preferredName, targetModel }` 克隆音色 |
| `voiceTools` | `list` | `voice:list` | 列出云端音色 |
| `voiceTools` | `listSystemVoices` | `voice:list-system-voices` | 列出 Qwen-TTS 系统音色 |
| `voiceTools` | `listAll` | `voice:list-all` | 系统 + 自定义音色合并列表 |
| `voiceTools` | `listModels` | `voice:list-models` | 列出可用语音模型**与厂家目录**（`{ models, providers }`） |
| `voiceTools` | `getProfiles` | `voice:get-profiles` | 读取本地音色映射 |
| `voiceTools` | `saveProfile` | `voice:save-profile` | 传 `{ profile }`（`VoiceProfile`） |
| `voiceTools` | `deleteProfile` | `voice:delete-profile` | 传 `{ key }`（只清**本地映射**） |
| `voiceTools` | `deleteCloudVoice` | `voice:delete-cloud` | 传 `{ voice }`（**删云端克隆音色**，不可撤销） |
| `voiceTools` | `synth` | `voice:synth` | 7 参数展开为 `{ text, voice, projectName, saveDir, targetModel, audioName, defaultOut }` |
| `voiceTools` | `synthAligned` | `voice:synth-aligned` | 字幕配音逐句合成 + 对齐/重排，原样透传 payload |
| `voiceTools` | `cancelAlign` | `voice:align-cancel` | `send` 单向，取消对齐任务 |
| `voiceTools` | `onAlignProgress` | `voice:align-progress` | 对齐进度订阅（单订阅） |
| `whisperTools` | `status` | `whisper:status` | whisper.cpp 运行时 / 模型状态 |
| `whisperTools` | `download` | `whisper:download` | 传 `{ id }` 下载模型 |
| `whisperTools` | `delete` | `whisper:delete` | 传 `{ id }` 删除模型 |
| `whisperTools` | `setCurrent` | `whisper:set-current` | 传 `{ id }` 设为当前模型 |
| `whisperTools` | `addModel` | `whisper:add-model` | 新增自定义模型，payload 原样透传 |
| `whisperTools` | `updateModel` | `whisper:update-model` | 更新自定义模型 |
| `whisperTools` | `removeModel` | `whisper:remove-model` | 删除自定义模型 |
| `whisperTools` | `openDir` | `whisper:open-dir` | 传 `{ which }` 打开模型/程序目录 |
| `whisperTools` | `pickAudio` | `whisper:pick-audio` | 选择待转录音频 |
| `whisperTools` | `projectAudio` | `whisper:project-audio` | 传 `{ name }` 取项目音频 |
| `whisperTools` | `transcribe` | `whisper:transcribe` | 执行转录，payload 原样透传 |
| `whisperTools` | `onProgress` | `whisper:progress` | 转录进度订阅（单订阅） |
| `projectTools` | `list` | `project:list` | 项目列表 |
| `projectTools` | `create` | `project:create` | 参数为裸字符串 `name` |
| `projectTools` | `load` | `project:load` | 参数为裸字符串 `name`；返回的 `materials` 已由主进程规范化 |
| `projectTools` | `saveSubtitle` | `project:save-subtitle` | `{ name, subtitle, title }` |
| `projectTools` | `saveContent` | `project:save-content` | `{ name, content }` |
| `projectTools` | `generateHtml` | `project:generate-html` | `{ name, prompt, ...materials }` 展开合并（`materials` = `ProjectHtmlMaterials`：`subtitleProject` / **`materialIds`**，**已无 `audioPath` / `videoPath`**；音轨由主进程注入 HTML） |
| `projectTools` | `modifyHtml` | `project:modify-html` | `{ name, prompt, ...materials }` 展开合并（同上） |
| `projectTools` | `downloadHtml` | `project:download-html` | 参数为裸字符串 `name` |
| `projectTools` | `exportSrt` | `project:export-srt` | `{ name, srt }` |
| `projectTools` | `readHtml` | `project:read-html` | 参数为裸字符串 `name` |
| `projectTools` | `saveHtml` | `project:save-html` | `{ name, html }`；**目前渲染层没有调用方（预留接口）** |
| `projectTools` | `previewHtml` | `project:preview-html` | 参数为裸字符串 `name` |
| `projectTools` | `pickAudio` | `project:pick-audio` | 选择项目音频，返回 `Promise<string \| null>` |
| `projectTools` | `setAudio` | `project:set-audio` | `{ name, audioPath }`；返回 `IpcResult<ProjectSetAudioResult>`，成功分支带 `audioFile` 与可选 `htmlUpdated`（是否同步改写了 `index.html` 的注入音轨） |
| `projectTools` | `clearAudio` | `project:clear-audio` | `{ name }`；主进程实际返回 `{ ok, htmlUpdated }`（是否摘掉了 HTML 里的注入音轨），但契约写作 `IpcResult`（无载荷） |
| `projectTools` | **`pickMedia`** | **`project:pick-media`** | **项目素材库：选文件**。签名 `pickMedia(kind): Promise<string[]>`，实现 `ipcRenderer.invoke(IPC.Project.PickMedia, { kind })`——`kind` 决定文件框过滤（图片多选、视频单选），取消 / 无窗口时主进程返回空数组；**不走 `IpcResult`** |
| `projectTools` | **`addMaterials`** | **`project:add-materials`** | **项目素材库：复制入库 + 登记**。签名 `addMaterials(name, paths: string[])`，实现 `ipcRenderer.invoke(IPC.Project.AddMaterials, { name, paths })`；返回 `IpcResult<ProjectMaterialsResult>`（`materials` = 完整列表，「部分成功」时 `ok: true` 且 `message` 说明跳过了几个） |
| `projectTools` | **`saveMaterials`** | **`project:save-materials`** | **项目素材库：整份列表回写**（移除与勾选共用）。签名 `saveMaterials(name, materials: ProjectMaterial[])`，实现 `ipcRenderer.invoke(IPC.Project.SaveMaterials, { name, materials })`；主进程规范化后落盘并回带完整列表 |
| `projectTools` | `extractVideoAudio` | `project:extract-video-audio` | 参数为裸字符串 `name`；返回 `IpcResult<ProjectSetAudioResult>`（`audioFile` + 可选 `htmlUpdated`，提取出的原声会立即注入 HTML）。**界面入口本轮临时下线**（`HtmlGenPage/MaterialsSection.vue` 的调用整段被注释），但**本方法按用户要求原样保留** |
| `projectTools` | `openFolder` | `project:open-folder` | 参数为裸字符串 `name` |
| `projectTools` | `openFolderOf` | `project:open-folder-of` | 参数为裸字符串 `dirOrFile` |
| `projectTools` | `delete` | `project:delete` | 参数为裸字符串 `name` |
| `projectTools` | `saveVideo` | `project:save-video` | `{ name, videoPath }`（渲染产物回写，与「视频素材」无关） |
| `projectTools` | `setRender` | `project:set-render` | `{ name, render }`；`render` 传 `null` 清除项目级档位覆盖 |
| `projectTools` | **`setCanvas`** | **`project:set-canvas`** | **成片画布方向（项目属性，不是渲染档位）**。签名 `setCanvas(name: string, canvas: RenderCanvas)`，实现 `ipcRenderer.invoke(IPC.Project.SetCanvas, { name, canvas })`；白名单校验在主进程（`RENDER_CANVASES`），非法值由主进程忽略并回 `画布取值非法` |
| `projectTools` | `onHtmlProgress` | `project:html-progress` | HTML 生成/修改进度订阅（单订阅） |
| **`scriptTools`** | **`generate`** | **`script:generate`** | 内容脚本 Agent。实现 `generate: (payload) => ipcRenderer.invoke(IPC.Script.Generate, payload)`——载荷原样透传（`ScriptGeneratePayload`：`name` / `request` / `scenes` / `sceneCount?` / `targetSeconds?`），返回 `Promise<ScriptGenerateReply>`（成功 `{ ok:true, scenes, totalChars }` / 失败 `{ ok:false, message, raw?, needConfig?, title? }`）。**只造文本**：场景落盘由渲染层的自动保存走 `projectTools.saveContent` |
| **`scriptTools`** | **`loadChat`** | **`script:load-chat`** | **对话记录：读索引**。实现 `loadChat: (name: string) => ipcRenderer.invoke(IPC.Script.LoadChat, { name })`，返回 `Promise<IpcResult<ScriptChatIndex>>`（`{ ok: true, rounds, activeVersionId }`，**不含 scenes**）。索引不存在 / 损坏、以及「版本副本已不存在」的条目都被主进程剔除 |
| **`scriptTools`** | **`appendRound`** | **`script:append-round`** | **对话记录：追加一版**。实现 `appendRound: (payload) => ipcRenderer.invoke(IPC.Script.AppendRound, payload)`（载荷原样透传 `ScriptAppendRoundPayload`：`{ name, round, scenes }`），返回 `Promise<IpcResult<{ versionId: string }>>`；**主进程写 `chat/versions/<id>.json` + 更新索引并把 `activeVersionId` 指向新版本**，preload 不拼路径、不裁剪 |
| **`scriptTools`** | **`readVersion`** | **`script:read-version`** | **对话记录：读某一版副本**。实现 `readVersion: (name: string, versionId: string) => ipcRenderer.invoke(IPC.Script.ReadVersion, { name, versionId })`，返回 `Promise<IpcResult<ScriptVersionResult>>`（`{ ok: true, scenes }`）；**只读、无副作用**（展开预览 / 应用前取内容） |
| **`scriptTools`** | **`setActiveVersion`** | **`script:set-active-version`** | **对话记录：应用哪一版**。实现 `setActiveVersion: (name: string, versionId: string) => ipcRenderer.invoke(IPC.Script.SetActiveVersion, { name, versionId })`，返回 `Promise<IpcResult>`；只改索引的 `activeVersionId`（**不写 `content.json`**，内容落盘仍走 `projectTools.saveContent`） |
| **`scriptTools`** | **`clearChat`** | **`script:clear-chat`** | **对话记录：清空**。实现 `clearChat: (name: string) => ipcRenderer.invoke(IPC.Script.ClearChat, { name })`，返回 `Promise<IpcResult>`；主进程删掉整个 `chat/` 目录（索引 + 全部版本副本），不动编辑器里的场景 |
| **`scriptTools`** | **`onProgress`** | **`script:progress`** | 内容脚本生成/修改进度订阅（**单订阅**；`_scriptProgressCb` / `_scriptProgressBound`）。载荷 `ScriptProgressPayload` = 五阶段 + `thinkChars` / `contentChars` / `thinkText` + 中文 `text` 文案 |
| `updateTools` | `version` | `update:version` | **同步**返回当前版本号字符串（`sendSync`），供设置页首屏显示 |
| `updateTools` | `check` | `update:check` | 检查更新，返回 `{ ok: true, state: 'none' \| 'available' \| 'skipped', version, currentVersion, message, detail? }`（失败分支为 `{ ok: false, message, detail? }`） |
| `updateTools` | `download` | `update:download` | 下载安装包（`autoDownload = false`，仅用户触发）；失败分支带 `message` + `detail` |
| `updateTools` | `cancel` | `update:cancel` | 取消下载；异常时回 `取消下载失败，请重试` + `detail` |
| `updateTools` | `install` | `update:install` | 退出并运行安装器（本机有转录 / 渲染 / 配音任务时拒绝） |
| `updateTools` | `status` | `update:status` | 取一次主进程当前更新状态（`invoke`）：返回 `UpdateProgressPayload`（`stage` 经 `toStage()` 白名单收敛）。主进程状态常驻、跨设置页挂载持续存在；设置页挂载时用它补齐「启动静默检查」那次失败——该事件发生在页面订阅 `update:progress` 之前 |
| `updateTools` | `openLog` | `update:open-log` | 在文件管理器里定位 `userData/updater.log`（没有日志则打开 `userData` 目录），返回 `IpcResult<{ path }>`；**更新失败时的排障出口，不依赖 electron-updater 是否加载成功** |
| `updateTools` | `changelog` | `update:changelog` | 取随包 `CHANGELOG.md` 的**原文**（`ipcRenderer.invoke(IPC.Update.Changelog)`，无载荷），返回 `IpcResult<{ text: string }>`；**主进程只负责定位与读取文件**（`app.getAppPath()/CHANGELOG.md`），分块与行内排版在渲染层 `@renderer/utils/changelog` |
| `updateTools` | `onProgress` | `update:progress` | 更新阶段 / 下载进度订阅（单订阅） |
| `runtimeTools` | `status` | `runtime:status` | renderer → main，`invoke`；查询运行环境（分包 ffmpeg / hyperframes）状态 |
| `runtimeTools` | `prepare` | `runtime:prepare` | renderer → main，`invoke`；主动准备指定包（载荷 `packs?: RuntimePackName[]`，省略 = 全部）。**载荷必须是普通数组**（渲染层用 `toRaw(list).slice()`）：`invoke` 的参数要过结构化克隆，Vue 响应式 `Proxy` 会直接抛 `DataCloneError`，主进程 handler 不会执行 |
| `runtimeTools` | `cancel` | `runtime:cancel` | renderer → main，`invoke`；取消进行中的**检查 / 下载 / 解包**（成功后 `message` 为「已取消下载」；取清单 20 秒无响应属**超时**，不算取消） |
| `runtimeTools` | `onProgress` | `runtime:progress` | 运行环境进度订阅（单订阅，`_runtimeProgressCb` / `_runtimeProgressBound`） |
| `legacyTools` | `status` | `legacy:status` | renderer → main，`invoke`，无载荷；返回 `LegacyDataInfo \| null`（有没有待处理的旧数据目录 / 里面有什么） |
| `legacyTools` | `resolve` | `legacy:resolve` | renderer → main，`invoke`；**只把 `action` 字符串透传**（`resolve(action)` → `ipcRenderer.invoke(IPC.Legacy.Resolve, action)`），返回 `LegacyResolveResult` |

### 2.3 `projectTools` 的增删（素材库那次 3 换 3，方法数当时仍是 25；本次新增 `setCanvas` ⇒ 26）

**被删除的三行**（原文已从 `src/preload/index.ts` 移除，此处按 git 历史逐字保留以便对照）：

```ts
pickVideo: (): Promise<string | null> => ipcRenderer.invoke(IPC.Project.PickVideo),
setVideo: (name: string, videoPath: string) => ipcRenderer.invoke(IPC.Project.SetVideo, { name, videoPath }),
clearVideo: (name: string) => ipcRenderer.invoke(IPC.Project.ClearVideo, { name }),
```

**现行实现**（`src/preload/index.ts` 中 `projectTools` 字面量的三行，逐字一致）：

```ts
pickMedia: (kind): Promise<string[]> => ipcRenderer.invoke(IPC.Project.PickMedia, { kind }),
addMaterials: (name: string, paths: string[]) => ipcRenderer.invoke(IPC.Project.AddMaterials, { name, paths }),
saveMaterials: (name: string, materials) => ipcRenderer.invoke(IPC.Project.SaveMaterials, { name, materials }),
```

- 三个旧方法对应的 `project:pick-video` / `project:set-video` / `project:clear-video` 频道已在 `src/shared/ipc.ts` 与 `src/main/projects.ts` 中一并删除（**三处齐改**）；`PreloadApi['projectTools']` 的签名同步换过，因此本文件少写一个都会编译不过。
- 参数类型由契约给出（`kind: ProjectMaterialKind`、`materials: ProjectMaterial[]`），实现里只做「组装载荷 + invoke」。
- `pickMedia` 是**少数不返回 `IpcResult` 的方法**（返回裸 `string[]`），与 `projectTools.load()` / `pickAudio()` 同类。
- **本次新增的 `setCanvas`**（与上面 3 换 3 无关，只加不减）：`setCanvas: (name: string, canvas: RenderCanvas) => ipcRenderer.invoke(IPC.Project.SetCanvas, { name, canvas })`，位置在 `setRender` 之后、`onHtmlProgress` 之前，上方注释写明「成片画布方向（项目属性）：白名单校验在主进程（`RENDER_CANVASES`）」。它与 `hfTools.renderVideo` 载荷里的 `canvas` 是不同的路径：前者把画布**存进项目**（`project.json` 的 `canvas`），后者把当前画布**带给渲染器**。

## 3. 关键流程或结构

### 3.1 三种通道形态

| 形态 | 用法 | 代表频道 |
| --- | --- | --- |
| 请求-响应 | `ipcRenderer.invoke(channel, payload)` | `settings:get`、`project:list`、**`project:pick-media`**、`update:open-log`、**`update:changelog`** |
| 单向通知 | `ipcRenderer.send(channel)` | `window:minimize`、`voice:align-cancel` |
| 同步取值 | `ipcRenderer.sendSync(channel)` | `update:version`（全工程唯一的同步频道，只回版本号字符串） |
| 主进程推送 | `ipcRenderer.on(channel, handler)` | `window:maximized-change`、`video:progress`、`update:progress`、`runtime:progress` |

### 3.2 7 路进度通道与单订阅语义

| 通道 | 订阅方法 | 相关模块级状态 |
| --- | --- | --- |
| `video:progress` | `hfTools.onProgress` | 无状态标志（直接 `ipcRenderer.on` 注册） |
| `project:html-progress` | `projectTools.onHtmlProgress` | `_htmlProgressCb`、`_htmlProgressBound` |
| **`script:progress`** | **`scriptTools.onProgress`** | **`_scriptProgressCb`、`_scriptProgressBound`** |
| `whisper:progress` | `whisperTools.onProgress` | `_whisperProgressCb`、`_whisperProgressBound` |
| `voice:align-progress` | `voiceTools.onAlignProgress` | `_alignProgressCb`、`_alignProgressBound` |
| `update:progress` | `updateTools.onProgress` | `_updateProgressCb`、`_updateProgressBound` |
| `runtime:progress` | `runtimeTools.onProgress` | `_runtimeProgressCb`、`_runtimeProgressBound` |

> 计数口径：**表里 7 行 = 整层 7 路进度通道**；其中 6 行有模块级单订阅标志（`video:progress` 那行没有），这正是源文件头注释写「6 个进度推送通道」的原因。写新文档 / 加新通道时按 7 路核。

单订阅的实现模式（以 HTML 进度为例）：

1. 调用 `onHtmlProgress(cb)` 时先把 `_htmlProgressCb` 赋值为新回调 —— **总是覆盖**。
2. 仅当 `_htmlProgressBound` 为 `false` 时才真正执行 `ipcRenderer.on`，并把标志置为 `true`。
3. 真正注册的监听函数内部读取模块级 `_htmlProgressCb`，用 `typeof === 'function'` 守卫后调用。

这样做的原因：渲染层页面在切换时会重新调用 `onXxxProgress` 注册回调。如果每次都执行一次 `ipcRenderer.on`，主进程每推一条进度就会被多条监听处理，导致渲染层重复执行、进度条跳变或重复弹窗，而且旧页面已卸载的回调会形成内存泄漏。因此这里把"回调"与"监听注册"解耦：**监听永远只有一条，回调可以随时替换**。代价是同一时刻只能有一个订阅者生效（后注册者覆盖先注册者），这正是各页面"进入时注册、离开时不注销"的用法所期望的。

### 3.3 为什么必须是 CJS

- Electron 的 sandboxed preload 不支持 ESM 加载语义，preload 必须是 CommonJS 产物。
- 全项目 `package.json` 未声明 `"type":"module"`，且 `electron.vite.config.ts` 的 `preload` 段仅启用 `externalizeDepsPlugin()`，保持外部依赖以运行时 `require` 形式存在。
- 因此本文件的 `import { contextBridge, ipcRenderer } from 'electron'` 在构建时被内联/转译，运行时只依赖 `require('electron')`、`require('../shared/ipc')` 的常量内联结果。若改成 ESM，sandbox preload 将直接加载失败。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | `electron` | 仅使用 `contextBridge` 与 `ipcRenderer` |
| 依赖 | `../shared/ipc` | 引入 `IPC` 常量对象，所有频道名均取自此处，不写字面量 |
| 依赖（仅类型） | `../shared/types` | `PreloadApi`（**12** 个对象的契约类型）、`AlignProgressPayload`、`HtmlProgressPayload`、**`RenderCanvas`**、`RenderOverride`、`RuntimePackName`、`RuntimeProgressPayload`、**`ScriptProgressPayload`（本轮新增）**、`UpdateProgressPayload`、**`VideoRenderPayload`**、`WhisperProgressPayload`（进度回调载荷） |
| 被构建使用 | `electron.vite.config.ts` → `preload` 段 | 打包为 out/preload 产物，由主进程 `webPreferences.preload` 加载 |
| 被消费 | 渲染层全部页面 | 契约由 `src/shared/types.ts` ⑨ 节的 `PreloadApi` 定义、经 `src/preload/index.d.ts` 挂到 `window`，`window.*` 调用遍布 `src/renderer/src/pages/`、`src/renderer/src/composables/`、`src/renderer/src/App.vue` |
| 对端实现 | `src/main/*.ts` | `ipcMain.handle` / `ipcMain.on` 的注册方，频道名与本文件逐一对应（素材三件套在 `src/main/projects.ts` 的 `register()` 里） |

## 5. 注意事项与实现要点

- **频道名不得硬编码**：本文件所有频道都通过 `IPC.Xxx.Yyy` 取用，禁止改成字符串字面量，否则与 `src/main/*.ts` 的注册方脱钩。
- **方法名与参数顺序是对外契约**：唯一真源是 `src/shared/types.ts` ⑨ 节的 `PreloadApi` —— 本文件的 **12** 个对象都以 `PreloadApi['<命名空间>']` 标注（实现侧被校验），渲染层经 `index.d.ts` 的 `interface Window extends PreloadApi {}` 拿到同一份签名；改契约请改共享层，不要在任一侧另行声明。
- **`send` 与 `invoke` 不可混用**：`windowControls` 的三个窗口操作和 `voiceTools.cancelAlign` 是 `send`（无返回值），`updateTools.version` 是 `sendSync`（同步有返回值，主进程用 `ipcMain.on` + `event.returnValue`），其余基本是 `invoke`（含 `updateTools.openLog` 与 `updateTools.changelog`）。
- **payload 透传**：`whisperTools.addModel/updateModel/removeModel/transcribe` 与 `voiceTools.synthAligned` 原样透传对象载荷，不在 preload 做字段校验，字段合法性由主进程负责；`voiceTools.synth` / `create` 则把位置参数组装成共享层定义的载荷对象后 `invoke`。
- **`generateHtml` / `modifyHtml` 的对象展开**：使用 `{ name, prompt, ...(materials || {}) }`，因此 `materials` 的键会与 `name` / `prompt` 平铺在同一层，`materials` 中不要出现同名键。`materials` 现为 `ProjectHtmlMaterials`（`subtitleProject` / `materialIds`），`audioPath` 与 `videoPath` 都已删除；对应的 `ProjectAgentPayload` 因此也不再携带音频选择。
- **素材三件套的载荷必须是普通对象 / 数组**：`invoke` 的参数要过**结构化克隆**，Vue 响应式 `Proxy` 会直接抛 `DataCloneError`（主进程 handler 根本不会执行）。因此 `HtmlGenPage/MaterialsSection.vue` 在调 `saveMaterials` 前用 `plainList()` 把 `appState.project.materials` 的元素铺平成普通对象；`addMaterials` 传的是 `pickMedia` 返回的普通字符串数组。**新增写素材的代码不要直接把 reactive 列表传进来**。
- **单订阅的副作用**：`onHtmlProgress` / **`scriptTools.onProgress`** / `whisperTools.onProgress` / `onAlignProgress` / `updateTools.onProgress` / `runtimeTools.onProgress` 均无法"注销"回调；页面卸载后旧回调仍被引用，若回调里访问已销毁的组件状态需自行容错（`ContentPage/AiChatPanel.vue` 的做法是回调内先判 `busy`，非生成态直接 return）。
- **`scriptTools` 是第 12 个命名空间、现有 7 个方法**：`generate` 直接把渲染层给的 `payload` 原样 `invoke`（不做字段校验，校验在 `src/main/agent/script.ts`）；`loadChat` 只组装 `{ name }`、`appendRound` 原样透传、`readVersion` / `setActiveVersion` 组装 `{ name, versionId }`、`clearChat` 组装 `{ name }`（**路径、副本命名、索引清理、100 轮上限全在主进程**，preload 不拼路径也不裁剪）；`onProgress` 是标准单订阅。它与 `projectTools.saveContent` 的关系是「前者只造文本、后者负责落盘」，**不要在 preload 里替它写文件**。
- **`legacyTools` 是纯拉取、没有推送通道**：它只有 `status` / `resolve` 两个 `invoke` 方法，故意不提供任何 `on*` 订阅——旧数据是否存在由渲染层挂载时主动问一次（`status`），主进程不做推送、也不弹任何界面（原生 `dialog.showMessageBox` 已废弃）。`resolve` 的实现就是把 `action` 字符串直接交给 `ipcRenderer.invoke(IPC.Legacy.Resolve, action)`，不在 preload 侧包成对象。
- **`process` 可用性**：preload 在 sandbox 下仍可读取 `process.platform` 与 `process.versions`，但不可假设 `process.env`、文件系统等其他 Node 能力可用。
