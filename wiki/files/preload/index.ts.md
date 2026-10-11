# src/preload/index.ts

> 通过 contextBridge 向渲染层暴露 8 个命名空间的预加载桥接层

- **所在目录**：`src/preload/`
- **类型**：预加载脚本（sandboxed preload，编译为 CJS）
- **规模**：159 行
- **对外导出**：本文件不产生模块导出；其作用是把 8 个命名空间注入渲染层 `window`，命名空间为 `electronAPI`、`appTools`、`windowControls`、`hfTools`、`settingsTools`、`voiceTools`、`whisperTools`、`projectTools`
- **类型契约**：8 个对象全部以 `PreloadApi['<命名空间>']` 标注（`PreloadApi` 定义在 `src/shared/types.ts` ⑨ 节），因此实现被契约校验；渲染层看到的签名由 `src/preload/index.d.ts` 挂载同一份契约

## 1. 作用与职责

本文件是 Electron 主进程与渲染进程之间的**唯一安全通道**。它不直接操作任何业务逻辑，只做三件事：

1. 用 `contextBridge.exposeInMainWorld` 把固定命名的 API 对象挂到渲染层的 `window` 上，使渲染层（Vue 页面）无需开启 `nodeIntegration` 即可调用主进程能力。
2. 为每个方法绑定一个来自 `IPC` 常量的频道名，`invoke` 用于请求-响应，`send` 用于单向通知。
3. 对进度推送频道实施**单订阅语义**：模块级保存回调并仅注册一次 `ipcRenderer.on`，重复注册只替换回调，避免页面切换时监听器不断叠加 —— 实际覆盖 `project:html-progress` / `whisper:progress` / `voice:align-progress` 三路；`hfTools.onProgress`（`video:progress`）仍是直接转发的 `ipcRenderer.on`，没有单订阅包装（详见 3.2）。

由于 preload 运行在 sandbox 环境且全项目无 `"type":"module"`，本文件必须被编译为 **CJS**；`import` 由 electron-vite 打包内联，运行时仅依赖 `require('electron')`。

## 2. 导出与关键实现

本文件无 ES 导出，全部实现以 `contextBridge.exposeInMainWorld` 的形式对外暴露。

### 2.0 类型标注方式（`PreloadApi['<命名空间>']`）

8 个对象都写成「契约标注 + 字面量实现」的形式：

```ts
import type { AlignProgressPayload, HtmlProgressPayload, PreloadApi, WhisperProgressPayload } from '../shared/types'

const hfTools: PreloadApi['hfTools'] = { /* 方法实现 */ };
contextBridge.exposeInMainWorld('hfTools', hfTools);
```

- `PreloadApi` 定义在 `src/shared/types.ts` ⑨ 节，是「preload 实现 ↔ 渲染层消费」的唯一真源；方法名拼错、参数个数不符、返回类型不匹配都会在 `tsconfig.node.json` 阶段直接编译失败。
- 进度回调的模块级状态变量也用共享层的载荷类型标注：`_htmlProgressCb: ((data: HtmlProgressPayload) => void) | null`、`_whisperProgressCb: ((data: WhisperProgressPayload) => void) | null`、`_alignProgressCb: ((data: AlignProgressPayload) => void) | null`（`hfTools.onProgress` 仍是就地构造的 `{ text: string }`）。
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
| `hfTools` | `openHtml` | `dialog:open-html` | 选择 HTML 文件，返回 `Promise<string \| null>` |
| `hfTools` | `listProjects` | `video:list-projects` | 列出可渲染项目，`{ name, html }[]` |
| `hfTools` | `previewShell` | `video:preview-shell` | 传 `{ htmlPath }`，生成预览壳 |
| `hfTools` | `renderVideo` | `video:render` | 传 `{ htmlPath }`，HyperFrames 转视频 |
| `hfTools` | `showInFolder` | `video:show-in-folder` | 在文件管理器中定位产物 |
| `hfTools` | `onProgress` | `video:progress` | 渲染进度订阅，数据形如 `{ text }` |
| `settingsTools` | `get` | `settings:get` | 读取 `AppSettings` |
| `settingsTools` | `save` | `settings:save` | 传 `{ customModel }` 保存自定义模型配置 |
| `settingsTools` | `test` | `settings:test` | 传 `{ customModel }` 测试连通性 |
| `voiceTools` | `getConfig` | `voice:get-config` | 取语音配置（apiKey / targetModel / saveDir） |
| `voiceTools` | `getSaveDir` | `voice:get-save-dir` | 传 `{ saveDir?, defaultOut?, projectName? }` 解析保存目录 |
| `voiceTools` | `saveConfig` | `voice:save-config` | 传 `{ voiceTTS }`（`Partial<VoiceTTSConfig>`） |
| `voiceTools` | `pickAudio` | `voice:pick-audio` | 选择音频文件 |
| `voiceTools` | `pickDir` | `voice:pick-dir` | 选择目录 |
| `voiceTools` | `listGenerated` | `voice:list-generated` | 列出已生成音频 |
| `voiceTools` | `create` | `voice:create` | 传 `{ audioPath, preferredName, targetModel }` 克隆音色 |
| `voiceTools` | `list` | `voice:list` | 列出云端音色 |
| `voiceTools` | `listSystemVoices` | `voice:list-system-voices` | 列出 Qwen-TTS 系统音色 |
| `voiceTools` | `listAll` | `voice:list-all` | 系统 + 自定义音色合并列表 |
| `voiceTools` | `listModels` | `voice:list-models` | 列出可用语音模型 |
| `voiceTools` | `getProfiles` | `voice:get-profiles` | 读取本地音色映射 |
| `voiceTools` | `saveProfile` | `voice:save-profile` | 传 `{ profile }`（`VoiceProfile`） |
| `voiceTools` | `deleteProfile` | `voice:delete-profile` | 传 `{ key }` |
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
| `projectTools` | `load` | `project:load` | 参数为裸字符串 `name` |
| `projectTools` | `saveSubtitle` | `project:save-subtitle` | `{ name, subtitle, title }` |
| `projectTools` | `saveContent` | `project:save-content` | `{ name, content }` |
| `projectTools` | `generateHtml` | `project:generate-html` | `{ name, prompt, ...materials }` 展开合并 |
| `projectTools` | `modifyHtml` | `project:modify-html` | `{ name, prompt, ...materials }` 展开合并 |
| `projectTools` | `downloadHtml` | `project:download-html` | 参数为裸字符串 `name` |
| `projectTools` | `downloadFile` | `project:download-file` | `{ srcPath, defaultName }` |
| `projectTools` | `exportSrt` | `project:export-srt` | `{ name, srt }` |
| `projectTools` | `readHtml` | `project:read-html` | 参数为裸字符串 `name` |
| `projectTools` | `saveHtml` | `project:save-html` | `{ name, html }` |
| `projectTools` | `previewHtml` | `project:preview-html` | 参数为裸字符串 `name` |
| `projectTools` | `pickAudio` | `project:pick-audio` | 选择项目音频 |
| `projectTools` | `setAudio` | `project:set-audio` | `{ name, audioPath }` |
| `projectTools` | `clearAudio` | `project:clear-audio` | `{ name }` |
| `projectTools` | `pickVideo` | `project:pick-video` | 选择项目视频 |
| `projectTools` | `setVideo` | `project:set-video` | `{ name, videoPath }` |
| `projectTools` | `clearVideo` | `project:clear-video` | `{ name }` |
| `projectTools` | `extractVideoAudio` | `project:extract-video-audio` | 参数为裸字符串 `name` |
| `projectTools` | `openFolder` | `project:open-folder` | 参数为裸字符串 `name` |
| `projectTools` | `openFolderOf` | `project:open-folder-of` | 参数为裸字符串 `dirOrFile` |
| `projectTools` | `delete` | `project:delete` | 参数为裸字符串 `name` |
| `projectTools` | `saveVideo` | `project:save-video` | `{ name, videoPath }` |
| `projectTools` | `onHtmlProgress` | `project:html-progress` | HTML 生成/修改进度订阅（单订阅） |

## 3. 关键流程或结构

### 3.1 三种通道形态

| 形态 | 用法 | 代表频道 |
| --- | --- | --- |
| 请求-响应 | `ipcRenderer.invoke(channel, payload)` | `settings:get`、`project:list` |
| 单向通知 | `ipcRenderer.send(channel)` | `window:minimize`、`voice:align-cancel` |
| 主进程推送 | `ipcRenderer.on(channel, handler)` | `window:maximized-change`、`video:progress` |

### 3.2 4 个进度通道与单订阅语义

| 通道 | 订阅方法 | 相关模块级状态 |
| --- | --- | --- |
| `video:progress` | `hfTools.onProgress` | 无状态标志（直接 `ipcRenderer.on` 注册） |
| `project:html-progress` | `projectTools.onHtmlProgress` | `_htmlProgressCb`、`_htmlProgressBound` |
| `whisper:progress` | `whisperTools.onProgress` | `_whisperProgressCb`、`_whisperProgressBound` |
| `voice:align-progress` | `voiceTools.onAlignProgress` | `_alignProgressCb`、`_alignProgressBound` |

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
| 依赖（仅类型） | `../shared/types` | `PreloadApi`（8 个对象的契约类型）、`AlignProgressPayload`、`HtmlProgressPayload`、`WhisperProgressPayload`（进度回调载荷） |
| 被构建使用 | `electron.vite.config.ts` → `preload` 段 | 打包为 out/preload 产物，由主进程 `webPreferences.preload` 加载 |
| 被消费 | 渲染层全部页面 | 契约由 `src/shared/types.ts` ⑨ 节的 `PreloadApi` 定义、经 `src/preload/index.d.ts` 挂到 `window`，`window.*` 调用遍布 `src/renderer/src/pages/`、`src/renderer/src/composables/`、`src/renderer/src/App.vue` |
| 对端实现 | `src/main/*.ts` | `ipcMain.handle` / `ipcMain.on` 的注册方，频道名与本文件逐一对应 |

## 5. 注意事项与实现要点

- **频道名不得硬编码**：本文件所有频道都通过 `IPC.Xxx.Yyy` 取用，禁止改成字符串字面量，否则与 `src/main/*.ts` 的注册方脱钩。
- **方法名与参数顺序是对外契约**：唯一真源是 `src/shared/types.ts` ⑨ 节的 `PreloadApi` —— 本文件的 8 个对象都以 `PreloadApi['<命名空间>']` 标注（实现侧被校验），渲染层经 `index.d.ts` 的 `interface Window extends PreloadApi {}` 拿到同一份签名；改契约请改共享层，不要在任一侧另行声明。
- **`send` 与 `invoke` 不可混用**：`windowControls` 的三个窗口操作和 `voiceTools.cancelAlign` 是 `send`（无返回值），其余基本是 `invoke`；把 `send` 改成 `invoke` 需要主进程同步改成 `ipcMain.handle`。
- **payload 透传**：`whisperTools.addModel/updateModel/removeModel/transcribe` 与 `voiceTools.synthAligned` 原样透传对象载荷（类型分别为 `WhisperAddModelPayload` / `WhisperUpdateModelPayload` / `{ id: string }` / `WhisperTranscribePayload` / `VoiceAlignPayload`），不在 preload 做字段校验，字段合法性由主进程负责；`voiceTools.synth` / `create` 则把位置参数组装成共享层定义的载荷对象后 `invoke`。
- **`generateHtml` / `modifyHtml` 的对象展开**：使用 `{ name, prompt, ...(materials || {}) }`，因此 `materials` 的键会与 `name` / `prompt` 平铺在同一层，`materials` 中不要出现同名键。
- **单订阅的副作用**：`onHtmlProgress` / `onProgress` / `onAlignProgress` 均无法"注销"回调；页面卸载后旧回调仍被引用，若回调里访问已销毁的组件状态需自行容错。
- **`process` 可用性**：preload 在 sandbox 下仍可读取 `process.platform` 与 `process.versions`，但不可假设 `process.env`、文件系统等其他 Node 能力可用。
