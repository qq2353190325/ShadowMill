# 03 · 目录架构：`src/preload/`（桥接层）

> 预加载脚本是渲染层通往系统的**唯一门面**：它把 **106** 个 IPC 频道收敛成 **13** 个命名空间的方法，并转发 **7 路**主→渲染进度推送（其中 6 路有模块级「只绑一次」标志）。渲染层永远不直接接触 `ipcRenderer`。

---

## 1. 文件清单

| 文件 | 行数 | 角色 | 是否进运行时 |
|---|---|---|---|
| [index.ts](./files/preload/index.ts.md) | **305** | `contextBridge` 暴露 **13** 个命名空间 + 7 路进度通道的订阅转发（6 路有「只绑一次」标志）；每个对象用 `PreloadApi['<命名空间>']` 标注。**进度订阅是 `onTaskProgress(taskId, cb)`：一条频道 + 按任务 id 分发**（`projectTools` 与 `castTools` 共用） | 是（构建为 `out/preload/index.js`，CJS） |
| [index.d.ts](./files/preload/index.d.ts.md) | 11 | 只做 `interface Window extends PreloadApi {}`，把共享层契约挂到全局 `Window` | 否（仅类型，被 `tsconfig.web.json` include，为渲染层提供智能提示） |

---

## 2. 为什么必须是 CJS

- Electron 31 的 **sandboxed preload 只支持 CommonJS**，因此全工程刻意**不设置** `"type": "module"`，`electron.vite.config.ts` 的 preload 段只挂 `externalizeDepsPlugin()`，由 electron-vite 输出 CJS。
- `src/agent/package.json` 单独声明 `{"type":"module"}` 只影响该子目录，不会污染主工程输出。
- preload 源码里对 `../shared/ipc` 与 `../shared/types` 的 `import` 在构建时被**内联**，运行时只依赖 `require('electron')`。

---

## 3. 暴露的 13 个命名空间

| 命名空间 | 方法数 | 底层域 | 说明 |
|---|---|---|---|
| `electronAPI` | — | 无（纯数据） | `platform`、`versions{node,chrome,electron}` |
| `appTools` | 1 | `app:copy-text` | 剪贴板写入（sandbox 下渲染层无 `clipboard` 模块） |
| `windowControls` | 4 | `window:*` | 最小化 / 最大化切换 / 关闭 / 最大化状态订阅 |
| `hfTools` | 4 | `dialog:open-html`、`video:*` | HTML 选择（`openHtml`，**当前无渲染层调用方**）、转视频（`renderVideo(htmlPath, options?)`，`options` = 渲染档位 `quality?` / `fps?` + **项目属性 `canvas?`**）、在文件夹中显示、渲染进度订阅 |
| `settingsTools` | 6 | `settings:*` | 读取 / 保存自定义模型 / 保存渲染档位 / 保存更新设置 / 连接测试 / **运行环境「从本地文件安装…」（`pickRuntimePack`）** |
| `voiceTools` | 19 | `voice:*` | 音色管理、文字生音频、字幕配音对齐（含 `synthAligned` / `cancelAlign` / `onAlignProgress`）；`deleteCloudVoice`（删云端克隆音色） |
| `whisperTools` | 12 | `whisper:*` | 模型状态 / 下载 / 删除 / 设为当前 / 自定义模型增删改 / 打开目录 / 选音频 / 项目音频 / 转录 / 进度订阅 |
| `projectTools` | **27** | `project:*` | 项目化流水线全量能力 + `setCanvas(name, canvas)`（成片画布方向，项目属性、白名单校验在主进程）+ **`saveCast(name, cast)`（`project:save-cast`：本片用哪几个全局角色，载荷 `[{ id, selected }]`）** + **`onTaskProgress(taskId, cb)`（`project:html-progress`，一条频道 + 按任务 id 分发，返回退订函数）**。**角色库那 6 个方法已移到 `castTools`**（`listCastLibrary` / `promoteCast` / `importCast` / `removeCastFromLibrary` / `newCast` / `castPreview` 全部下线；33 − 6 = 27） |
| **`castTools`** | **12** | **`cast:*`（角色 6 + 动作 5 + 进度 1）** | **全局角色库（与项目无关）**：`list()`（`cast:list`）/ `create(brief)`（`cast:create`，`brief` 含必填 `taskId`）/ `recreate(id, request, taskId)`（`cast:recreate`，改画法、覆盖库里那份）/ `saveMeta(patch)`（`cast:save-meta`，只改元数据不调模型）/ `remove(id)`（`cast:remove`）/ `preview(id, options?)`（`cast:preview`，回 `{ ok, rel }`，`rel` 相对 **userData** 形如 `cast-preview/hero.html`）。**动作示范（「角色」页 · 卡片双击 /「…」菜单 · 动作示范…）的 5 个方法**：`listActions(castId)`（`cast:action-list`，回 `{ ok, shared, own }`）/ `saveAction(payload)`（`cast:action-save`，存一条关键帧动作，同 id 覆盖、id 空则由主进程起 `actN`）/ `removeAction(payload)`（`cast:action-remove`，载荷 `{ castId, scope, actionId }`）/ `generateAction(payload)`（`cast:action-generate`，**唯一会调模型的动作路径**：读角色源码 → 生成 `function (t) { … }` → 存成专属动作）/ `demo(id, options?)`（`cast:demo`，拼会动的示范页，回 `{ ok, rel }`）。另有 `onTaskProgress(taskId, cb)`（**与 `projectTools.onTaskProgress` 共用同一个 `subscribeTaskProgress()`**：同一条频道、同一张 `taskId → 回调` 订阅表，所以生成 HTML、画角色、编动作可并行） |
| **`scriptTools`** | **7** | **`script:*`** | **内容脚本 Agent：`generate(payload)`（`script:generate`）+ `loadChat(name)`（`script:load-chat`，只读索引）+ `appendRound(payload)`（`script:append-round`，写副本 + 更新索引并把 `activeVersionId` 指向新版）+ `readVersion(name, versionId)`（`script:read-version`，读某版副本）+ `setActiveVersion(name, versionId)`（`script:set-active-version`）+ `clearChat(name)`（`script:clear-chat`，删整个 `chat/`）+ `onProgress(cb)`（`script:progress`，单订阅）；除 `onProgress` 外全是 `invoke`，无 `send`**。生成只造文本（场景落盘由渲染层的自动保存走 `projectTools.saveContent`）；5 个 chat 方法管对话记录 `projects/<项目名>/chat/`（`index.json` + `versions/<id>.json`） |
| `updateTools` | 8 | `update:*` | 检查更新 / 下载 / 取消 / 重启安装 / **状态查询（`status`）** / **打开日志** / **更新日志原文（`changelog`）** / 版本号（同步）+ 进度订阅 |
| `runtimeTools` | 4 | `runtime:*` | 运行环境（分包 ffmpeg / hyperframes）：状态查询 / 主动准备（`prepare(packs?)`）/ **取消（`cancel`）** / 进度订阅 |
| `legacyTools` | 2 | `legacy:*` | 旧版本数据：状态查询 / 回传选择（`migrate` \| `delete` \| `later`）；**无进度订阅**——旧数据是否存在由渲染层主动问一次，主进程不推送、不弹界面 |

> 渲染层对主进程的全部依赖面就是这 13 个命名空间，因此它们被定义为**不可漂移的契约**：方法签名唯一真源是 `src/shared/types.ts` ⑨ 节的 `PreloadApi`，频道名一一对应 `src/shared/ipc.ts`（12 个分组 / 106 个频道）。

---

## 4. 进度通道的分发方式

**7 路主→渲染进度推送**在 preload 中被处理成「注册回调」的形式，但分发方式有**两种**：

| 通道 | 命名空间方法 | 实现 |
|---|---|---|
| `project:html-progress` | `projectTools.onTaskProgress(taskId, cb)` | **按任务 id 分发**：`_progressCbs`（`Map<string, (data: HtmlProgressPayload) => void>`）+ `_htmlProgressBound`（只绑一次）；返回退订函数 |
| **`script:progress`** | **`scriptTools.onProgress(cb)`** | **`_scriptProgressCb` + `_scriptProgressBound`**（单槽） |
| `whisper:progress` | `whisperTools.onProgress(cb)` | `_whisperProgressCb` + `_whisperProgressBound`（单槽） |
| `voice:align-progress` | `voiceTools.onAlignProgress(cb)` | `_alignProgressCb` + `_alignProgressBound`（单槽） |
| `video:progress` | `hfTools.onProgress(cb)` | 直接 `ipcRenderer.on` 转发（**无模块级标志**） |
| `update:progress` | `updateTools.onProgress(cb)` | `_updateProgressCb` + `_updateProgressBound`（单槽） |
| `runtime:progress` | `runtimeTools.onProgress(cb)` | `_runtimeProgressCb` + `_runtimeProgressBound`（单槽） |

> **「6 个进度推送通道」该怎么读**：源文件头注释写的是「13 个命名空间 / 6 个进度推送通道」，那个 **6 指的是有模块级「只绑一次」标志的通道数**（html / script / whisper / align / update / runtime）；加上 `video:progress`（`hfTools.onProgress` 直接 `ipcRenderer.on`，没有模块级标志），**整层实际暴露 7 路进度订阅**。写文档 / 加通道时按「7 路」核，别把 video 那路漏掉。**注意 html 这一路的「标志」只保证监听器绑一次，回调不再是一个单槽**——它是 `taskId → 回调` 的 Map。

做法分两类：

- **单槽（script / whisper / align / update / runtime）**：模块级保存「当前回调」，只在首次注册时真正 `ipcRenderer.on` 一次；后续调用**只替换回调函数**。页面反复挂载/切换时不会重复叠加监听器，等价于「全局只有一个进度消费方」，所以这些页面的订阅在 `onMounted` 注册一次即可（如 `useRenderProgress.ts` 由 `App.vue` 订阅一次；whisper 区块在自身 `onMounted` 订阅，切页即替换；`AiChatPanel.vue` 同理在 `onMounted` 注册 `scriptTools.onProgress`，回调内再用 `busy` 守卫）。
- **一条频道 + 按任务 id 分发（`project:html-progress`）**：`_progressCbs` 是 `taskId → 回调` 的 `Map`，`ipcRenderer.on(IPC.Project.HtmlProgress, …)` **只绑一次**（`_htmlProgressBound` 守），收到推送后按 `data.taskId` 查 Map 分发；**没带 `taskId` 的推送直接丢弃**。`onTaskProgress(taskId, cb)` 返回退订函数，且只在 Map 里仍指向同一个回调时才删除。于是「生成 / 修改 HTML」（`index.vue` 用 `newTaskId('html')`）与「新建角色」（「角色」页的新建 / 改画法弹窗 `pages/CastPage/CastEditModal.vue` 用 `newTaskId('cast')`）可以**并行**，谁的进度回谁那里、互不覆盖。
- **「角色预览」不是进度通道**：`cast:preview` 是一次普通 `invoke`（请求 → 主进程把内置 `core.js` + 库里这份角色代码拼成一页 HTML，落 `<userData>/cast-preview/<id>.html` → 回 `{ ok, rel }`），没有推送、没有订阅；`CastShot.vue` 每次需要预览就调一次，`rel` 经 `utils/url.ts` 的 `userFileUrl` 拼成 `hgpreview://user/…?user=1`。

---

## 5. 类型来源：`shared/types.ts` 的 `PreloadApi`

- **唯一真源在共享层**：13 个命名空间的方法签名、参数顺序与返回类型统一定义在 `src/shared/types.ts` ⑨ 节的 `PreloadApi`；`index.d.ts` 只剩一句 `interface Window extends PreloadApi {}`（外加 `import type` 与 `export {}`）。
- **实现侧也被同一份契约约束**：`index.ts` 的每个对象都写成 `const hfTools: PreloadApi['hfTools'] = { ... }` 形式（`electronAPI` / `appTools` / `windowControls` / `hfTools` / `settingsTools` / `voiceTools` / `whisperTools` / `projectTools` / **`castTools`** / `scriptTools` / `updateTools` / `runtimeTools` / `legacyTools` 共 **13** 处），因此方法名、参数个数、返回类型写错会直接在 `tsconfig.node.json` 阶段编译失败。
- **结果类型约定（① 节）**：

```ts
interface IpcFail { ok: false; message?: string; detail?: string; canceled?: boolean; needPacks?: RuntimePackName[]; needConfig?: ConfigTarget; title?: string }
type IpcResult<T = unknown> = ({ ok: true; message?: string } & T) | IpcFail
```

  `message` 为**可选**，因为 `voice:pick-dir` 的用户取消分支只回 `{ ok: false, canceled: true }`；成功分支的业务字段是**平铺**的（没有 `data` 包装，也没有旧版 `OkResult` 的 `[key: string]: any` 索引签名），成功分支的 `message` 同样可选（取消、幂等复用等场景给一句话回执）。`detail` 同为可选，是给排障用的技术详情（原始报错 / HTTP 状态 / 请求地址），由 UI 折叠展示——目前主要用在 `update:*` 一族与 `updateTools.openLog()` 的失败分支上。`needPacks` 是运行环境分包带进来的可选字段：缺包时主进程回 `{ ok:false, needPacks: ['ffmpeg', …] }`，渲染层据此弹「下载运行环境」确认框（`useEnvGate`），`VideoRenderResult` 的失败分支另有同名字段。`needConfig` / `title` 是**配置类**字段：主进程 `friendlyError()` 判出「去设置页改配置就能解决」时回 `needConfig: 'model' | 'voice'`（余额 / 欠费**不在其中**，走内嵌状态行），渲染层据此弹只有 `[去设置]` / `[取消]` 的弹窗（`useConfigPrompt`，见 [04-目录架构-src-renderer](./04-目录架构-src-renderer.md)）。**preload 只是 `ipcRenderer.invoke` 原样转发，这两个字段不需要 preload 任何改动**。
- 该文件被 `tsconfig.web.json` 的 `include` 显式引入（`src/preload/index.d.ts`），这是渲染层获得 IPC 类型的唯一途径；`tsconfig.node.json` 则包含 `src/preload/index.ts` 本体，两侧共同保证契约不漂移。
- 少数接口不遵循 `IpcResult`：`projectTools.list()` 返回数组、`projectTools.load()` 返回项目对象或 `null`、`pickAudio()` 返回 `string | null`、`pickMedia(kind)` 返回 `string[]`（项目素材库选文件，取消时为空数组）、`settingsTools.get()` 直接返回 `AppSettings`、`hfTools.renderVideo()` 返回 `VideoRenderResult`（载荷 = `{ htmlPath, quality?, fps?, canvas? }`，`htmlPath` 由第一参数给，故 `PreloadApi` 里写成 `Omit<VideoRenderPayload, 'htmlPath'>`）、**`scriptTools.generate(payload)` 返回 `ScriptGenerateReply`（成功 `{ ok:true, scenes, totalChars, message? }` / 失败 `{ ok:false, message, raw?, needConfig?, title? }`）**—— 这些是历史契约，改动会同时影响渲染层多处调用。`scriptTools` 的 5 个 chat 方法则**走标准 `IpcResult`**（`loadChat` → `IpcResult<ScriptChatIndex>`、`appendRound` → `IpcResult<{ versionId }>`、`readVersion` → `IpcResult<ScriptVersionResult>`、`setActiveVersion` / `clearChat` → `IpcResult`）。
- **`castTools` 里有两类方法**：① 角色本身 6 个（`list` / `create` / `recreate` / `saveMeta` / `remove` / `preview`），都走标准 `IpcResult`；`preview(id, options?)` 的 `options` 是 `Omit<CastPreviewPayload, 'id'>`，成功回 `IpcResult<CastPreviewResult>`（`{ rel }` = `cast-preview/<id>.html`，相对 **userData**），实现里原样展开：`ipcRenderer.invoke(IPC.Cast.Preview, { id, ...(options || {}) })`。② 动作示范 5 个（`listActions` / `saveAction` / `removeAction` / `generateAction` / `demo`）：`listActions(castId)` 组装 `{ castId }`，其余三个**整对象透传**（`payload || {}`），`demo(id, options?)` 把 `options` 展开成 `{ id, ...(options || {}) }`；`generateAction` 是**唯一会调模型的动作方法**（进度按 `taskId` 路由），`demo` 只回示范页的 `rel`（`cast-preview/<id>.demo.html`）。
- 另有 **1 个同步方法**：`updateTools.version()` 走 `ipcRenderer.sendSync('update:version')`，同步返回版本号字符串（设置页首屏要立刻显示，不愿等一轮异步渲染）。这是全层唯一的同步 IPC，除它之外一律异步。

---

## 6. 与本层相关的注意事项

1. **频道名必须引用 `IPC.*` 常量**，不得写字符串字面量：常量集中在 `src/shared/ipc.ts`，是主进程、preload 两侧唯一的对齐依据（例外：`dialog:open-html` 属于 `IPC.Video.OpenHtml`，命名上不属于 `video:` 前缀，属历史遗留，不可「顺手统一」）。
2. **不要让 `ipcRenderer` 泄漏到渲染层**：不暴露通用的 `invoke(channel, …)` 逃生舱，所有能力都必须显式列在命名空间里，保证攻击面可枚举。
3. **`send` 与 `invoke` 的区分**：窗口控制与 `voice:align-cancel` 是单向 `send`（无返回值），`update:version` 是唯一的 `sendSync`（同步取版本号），其余为 `invoke`（含 `updateTools.openLog()` → `update:open-log`，它必须能独立工作：更新失败时 electron-updater 可能根本没加载起来，日志入口不能挂在那条懒加载链上）。**`castTools.preview` 与 `castTools.demo` 都是 `invoke`**：主进程写盘后要回 `rel`，渲染层靠它拼 iframe 地址（`cast:demo` 那页换动作只改 `#hash`）。
4. **进度回调参数有具名类型**：`onTaskProgress`（回调 `(data: HtmlProgressPayload) => void`）/ **`scriptTools.onProgress`** / `whisperTools.onProgress` / `onAlignProgress` / `updateTools.onProgress` / `runtimeTools.onProgress` 的回调分别标注 `HtmlProgressPayload` / **`ScriptProgressPayload`** / `WhisperProgressPayload` / `AlignProgressPayload` / `UpdateProgressPayload` / `RuntimeProgressPayload`（模块级 `_progressCbs` 的 Map 值类型同 `HtmlProgressPayload` 回调），`hfTools.onProgress` 则仍是就地构造的 `{ text: string }`；改字段请改 `src/shared/types.ts` ⑧ 节。
5. **新增一路进度通道的三处齐改**：`shared/ipc.ts` 加频道常量 → 主进程 `sender.send` → 本文件加 `onProgress`（记得同时加模块级 `_xxxProgressCb` / `_xxxProgressBound` 与 `import type` 的载荷类型）+ `shared/types.ts` ⑨ 节 `PreloadApi` 同步签名。`script:progress` 就是照这个流程加的；对话记录那 5 条（`load-chat` / `append-round` / `read-version` / `set-active-version` / `clear-chat`）是普通 `invoke`，只改 `ipc.ts` / `agent/script.ts` / 本文件与 `PreloadApi`，进度通道一路没动。**`project:html-progress` 是唯一改过分发方式的通道**：频道名与数量没变（`ipc.ts` 零改动），只是把单槽换成 `taskId → 回调` 的 Map，并让订阅函数返回退订函数。
6. **新增普通 invoke（如 `castTools.demo`）是「三处齐改 + 一个方法」**：`shared/ipc.ts` 加频道常量 → 主进程对应 `register()` 里加 `ipcMain.handle` → 本文件对应命名空间加一行转发 → `shared/types.ts` 的 `PreloadApi.<命名空间>` 同步签名。**本轮动作示范的 5 条就是这么加的**（`Cast` 组 6 → 11、全库 101 → 106；`castTools` 7 → 12 个方法；`projectTools` 是 33 → **27**，那是上一轮角色频道搬家时下线 6 个方法的账）。

---

## 7. 相关文档

- 逐文件说明：[files/preload/](./files/preload/)
- 频道常量与类型定义：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 频道总表：[01-架构总览.md](./01-架构总览.md) 第 3.3 节

## 附录 · 角色与动作示范的现状（与上文冲突时以本节为准）

- **命名空间 13 个**：新增 **`castTools`**，成员 **12** 个——角色本身 6 个：`list`（`cast:list`）/ `create`（`cast:create`）/ `recreate`（`cast:recreate`）/ `saveMeta`（`cast:save-meta`）/ `remove`（`cast:remove`）/ `preview`（`cast:preview`）；**动作示范 5 个**：`listActions(castId)`（`cast:action-list`）/ `saveAction(payload)`（`cast:action-save`）/ `removeAction(payload)`（`cast:action-remove`）/ `generateAction(payload)`（`cast:action-generate`，**唯一会调模型**）/ `demo(id, options?)`（`cast:demo`，会动的示范页）；外加 `onTaskProgress`（与 `projectTools.onTaskProgress` 同一条频道、同一张订阅表）。
- **`projectTools` 去掉 6 个角色方法**：`listCastLibrary` / `promoteCast` / `importCast` / `removeCastFromLibrary` / `newCast` / `castPreview`（**`projectTools.castPreview` 这个名字已不存在**，换成 `castTools.preview(id, { units, title, uses })`），方法数 33 → **27**。
- **`projectTools.saveCast(name, cast)`**：`cast` 现在是 `ProjectCastSelection[]`（`[{ id, selected }]`），不再是完整成员快照。
- **角色预览 / 动作示范都不是进度通道**：`cast:preview` 与 `cast:demo` 都是一次普通 `invoke`（请求 → 主进程拼页落 `<userData>/cast-preview/` 下的 `<id>.html` / `<id>.demo.html` → 回 `{ ok, rel }`），`CastShot.vue` / `CastDemoShot.vue` 各自调一次，`rel` 再经 `utils/url.ts` 的 `userFileUrl` 拼成 `hgpreview://user/…?user=1`。**`cast:action-generate` 调模型时的进度仍走既有的 `project:html-progress`**（按 `taskId` 分发，没有新增进度通道）。
- **频道总数 106、分组 12**（`Project` 27 + **`Cast` 11** = 角色 6 + 动作 5，见 [shared/ipc.ts.md](./shared/ipc.ts.md)）。
