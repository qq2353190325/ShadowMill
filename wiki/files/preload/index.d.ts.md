# src/preload/index.d.ts

> 把 `shared/types.ts` 的 `PreloadApi` 挂到全局 `Window` 上，供渲染层类型检查使用

- **所在目录**：`src/preload/`
- **类型**：全局类型声明（`.d.ts`，纯类型、无运行时代码）
- **规模**：11 行（**命名空间增删时本文件不需要改**：它只做 `extends`，签名全在 `PreloadApi` 里。素材三件套那次如此，本轮新增 `scriptTools`（11 → 12 个命名空间）同样一个字都没改）
- **对外导出**：`export {}`（仅使文件成为模块）；通过 `declare global` 声明 `interface Window extends PreloadApi {}`。**本文件不再定义任何自己的类型**，`IpcResult` 等结果类型已上移到 `src/shared/types.ts`

## 1. 作用与职责

本文件只做一件事：**把 preload 脚本运行期真实挂载到 `window` 上的 API，接上 `src/shared/types.ts` 的 `PreloadApi` 契约**。

它不参与打包、不在产物中出现，但其声明决定了整个渲染层的开发体验：

1. 让 `src/renderer/src/**` 中的 `window.electronAPI`、`window.projectTools` 等调用通过编译期检查，并在 VS Code 中获得自动补全与参数提示。
2. 通过 `interface Window extends PreloadApi {}` 把 `PreloadApi` 声明的**全部命名空间**（`electronAPI` / `appTools` / `windowControls` / `hfTools` / `settingsTools` / `voiceTools` / `whisperTools` / `projectTools` / **`scriptTools`** / `updateTools` / `runtimeTools` / `legacyTools`，共 **12** 个）一次性并入全局 `Window`，成员签名直接来自共享层的 ⑨ 节（成员数随契约演进，不在本文件写死）。
3. 与 `src/preload/index.ts` 共用**同一份契约**：preload 实现侧用 `PreloadApi['<命名空间>']` 标注各 `contextBridge` 对象，本文件把同一契约交给渲染层，因此「实现」与「渲染层看到的签名」不会再各自漂移。

## 2. 导出与关键实现

本文件只有 4 段语句，全部列出：

| 顺序 | 代码 | 说明 |
| --- | --- | --- |
| 1 | `import type { PreloadApi } from '../shared/types'` | 唯一依赖；仅类型导入，编译后不残留 |
| 2 | `export {}` | 使文件成为模块，`declare global` 才能生效 |
| 3 | `declare global { interface Window extends PreloadApi {} }` | 用**接口继承**把 `PreloadApi` 的全部命名空间并入全局 `Window` |
| 4 | （注释） | 文件头部注释说明唯一真源与「实现 / 消费同一契约」的语义 |

### 2.1 与旧形态的差异

| 维度 | 旧形态 | 现形态 |
| --- | --- | --- |
| `OkResult<T>` / `FailResult` / `IpcResult<T>` | 在本文件内部定义（未导出，110 行版的主体） | 上移到 `src/shared/types.ts` ① 节，即 `IpcFail` / `IpcResult<T>` |
| 各命名空间的方法签名 | 在本文件 `declare global` 里逐条手写 | 汇总成 `src/shared/types.ts` ⑨ 节的 `PreloadApi`，本文件只做 `extends` |
| 与 preload 实现的关系 | 「实现 + 声明」两份契约，需人工保持逐字一致 | 同一份契约：preload 实现标注 `PreloadApi['x']`，本文件把 `PreloadApi` 挂给渲染层 |
| 成功载荷的字段访问 | `OkResult` 带 `[key: string]: any` 索引签名，拼错字段名不报错 | 成功分支是 `{ ok: true } & T` 交叉类型，字段名有精确类型（索引签名已取消） |

### 2.2 `declare global` 内 Window 的 12 个命名空间

各命名空间的成员一览（成员数以第三列为准，签名详见 [`shared/types.ts.md`](../shared/types.ts.md) 第 2.9 节）：

| 命名空间 | 成员数 | 成员一览 |
| --- | --- | --- |
| `electronAPI` | 2 | `platform: string`；`versions: { node; chrome; electron }` |
| `appTools` | 1 | `copyText(text): Promise<boolean>` |
| `windowControls` | 4 | `minimize()`、`toggleMaximize()`、`close()`、`onMaximizedChange(cb)` |
| `hfTools` | 4 | `openHtml`、`renderVideo`、`showInFolder`、`onProgress` |
| `settingsTools` | 6 | `get`、`save`、`saveRender`、`saveUpdater`、`test`、`pickRuntimePack` |
| `voiceTools` | 19 | `getConfig`、`getSaveDir`、`saveConfig`、`pickAudio`、`pickDir`、`listGenerated`、`create`、`list`、`listSystemVoices`、`listAll`、`listModels`、`getProfiles`、`saveProfile`、`deleteProfile`、`deleteCloudVoice`、`synth`、`synthAligned`、`cancelAlign`、`onAlignProgress` |
| `whisperTools` | 12 | `status`、`download`、`delete`、`setCurrent`、`addModel`、`updateModel`、`removeModel`、`openDir`、`pickAudio`、`projectAudio`、`transcribe`、`onProgress` |
| `projectTools` | 26 | `list`、`create`、`load`、`saveSubtitle`、`saveContent`、`generateHtml`、`modifyHtml`、`downloadHtml`、`exportSrt`、`readHtml`、`saveHtml`、`previewHtml`、`pickAudio`、`setAudio`、`clearAudio`、**`pickMedia`、`addMaterials`、`saveMaterials`**、`extractVideoAudio`、`openFolder`、`openFolderOf`、`delete`、`saveVideo`、`setRender`、**`setCanvas`**、**`onTaskProgress`**（素材那次是 **3 换 3**、成员数当时仍是 25；此后新增 `setCanvas` ⇒ **26**；**`onHtmlProgress` 已由 `onTaskProgress(taskId, cb)` 1 换 1 取代**——本表成员数尚未随角色库 / 项目角色 / 角色预览那几轮重算，取当前值请以 `PreloadApi` 为准：**33**） |
| **`scriptTools`** | **2** | **`generate(payload: ScriptGeneratePayload): Promise<ScriptGenerateReply>`**、**`onProgress(cb: (data: ScriptProgressPayload) => void)`**（内容脚本 Agent；`generate` 不经 `IpcResult`，成功 `{ ok:true, scenes, totalChars }`、失败 `{ ok:false, message, raw?, needConfig?, title? }`；`onProgress` 为单订阅） |
| `updateTools` | 9 | `version`、`check`、`download`、`cancel`、`install`、`status`、`openLog`、`changelog`、`onProgress` |
| `runtimeTools` | 4 | `status`、`prepare`、`cancel`、`onProgress` |
| `legacyTools` | 2 | `status`、`resolve`（**无 `on*` 订阅**：旧数据是否存在由渲染层主动拉取，主进程不推送） |

### 2.3 结果类型约定（定义在 `src/shared/types.ts` ① 节）

| 约定 | 取值 | 渲染层用法 |
| --- | --- | --- |
| `ok` | `true` / `false` | 判别联合的判别式；`if (!res.ok)` 后 TS 自动收窄到 `IpcFail` |
| `canceled` | 可选 `boolean`（仅失败分支） | 用户在文件选择框点了取消；渲染层通常静默忽略而非报错 |
| `message` | 可选 `string`（仅失败分支） | 错误/取消说明。**可选**：`voice:pick-dir` 的用户取消分支没有 `message` |
| 业务字段 | `T` 的键**平铺**在结果对象上（仅成功分支） | 如 `{ ok: true, htmlPath, compatible }`，直接 `res.htmlPath` 访问，没有 `data` 包装 |

不走 `IpcResult` 的方法仍有一批：`settingsTools.get()` 直接返回 `AppSettings`、`projectTools.list()` 返回数组、`projectTools.load()` 返回 `Project | null`、**`projectTools.pickMedia()` 返回 `string[]`（本轮新增，取消时为空数组）**、`hfTools.openHtml` / `projectTools.pickAudio` 返回 `string | null`、`appTools.copyText` 返回 `boolean`、`hfTools.renderVideo` 返回 `VideoRenderResult`。这是历史契约，改动会同时影响渲染层多处调用。

### 2.4 本轮素材接口的签名变化（在 `PreloadApi.projectTools` 内）

| 方法 | 签名要点 |
| --- | --- |
| `pickMedia(kind: ProjectMaterialKind)` | `Promise<string[]>`（**无 `IpcResult` 包装**；`kind` 决定文件框过滤：图片多选、视频单选） |
| `addMaterials(name: string, paths: string[])` | `Promise<IpcResult<ProjectMaterialsResult>>`（复制入库 + 登记；`materials` = 落盘后的完整列表，部分成功时 `message` 说明跳过数） |
| `saveMaterials(name: string, materials: ProjectMaterial[])` | `Promise<IpcResult<ProjectMaterialsResult>>`（整份列表回写：移除与勾选共用） |
| `extractVideoAudio(name: string)` | 签名不变；**界面入口暂未开放**，注释标明「保留（界面入口暂未开放）」 |

> `PreloadApi` 里删掉的三个方法（`pickVideo` / `setVideo` / `clearVideo`）与 `src/shared/ipc.ts` 删除的三个频道、`src/main/projects.ts` 删除的三个 handler 一一对应；本文件因为只做 `extends`，**不需要跟着改**。

## 3. 关键流程或结构

### 3.1 类型如何抵达渲染层

```
src/shared/types.ts  的 PreloadApi        src/preload/index.ts（实现，标注 PreloadApi['x']）
        │                                          │
        └───────────────┬──────────────────────────┘
                        ▼
            src/preload/index.d.ts
            （interface Window extends PreloadApi {}）
                        │  (include 声明)
                        ▼
tsconfig.web.json ── include: ["src/renderer/src/**/*.ts", "src/renderer/src/**/*.vue", "src/preload/index.d.ts", "src/shared/**/*.ts"]
                        │
                        ▼
        `tsc --noEmit -p tsconfig.web.json`（npm run typecheck 的第二段）
                        │
                        ▼
        渲染层 window.projectTools.xxx() 等调用获得参数与返回值类型
```

`tsconfig.web.json` 的 `include` 中显式列出了 `"src/preload/index.d.ts"`（第 21 行），而**没有**包含 `src/preload/index.ts`（后者由 `tsconfig.node.json` 覆盖）。这就是「实现文件与类型文件分离」的关键：渲染层只看到声明，看不到 preload 的 Node 侧实现细节；而声明本身又只是共享层契约的转发，故三端对齐。

### 3.2 类型解析路径

- `import type { PreloadApi } from '../shared/types'` —— 从共享层引入唯一契约，使渲染层看到的签名与主进程/preload 使用的类型完全同源。
- 文件末尾 `export {}` 把文件标记为模块，`declare global` 才能合法地向全局 `Window` 做**声明合并**（而非新建一个局部 interface）。
- `interface Window extends PreloadApi {}` —— 用接口继承（而非在 `Window` 内重复列出成员）。若将来 `PreloadApi` 增删命名空间或方法，本文件**一个字都不用改**（本轮的素材三件套正是如此）。

### 3.3 结果类型的收窄流程

1. 调用方 `const res = await window.projectTools.generateHtml(name, prompt)`。
2. 判 `if (res.ok)` → TS 收窄到 `{ ok: true } & ProjectHtmlResult`，此时可平铺访问 `res.htmlPath` / `res.compatible` / `res.message`（后者在成功分支也存在）。
3. 判 `else` → 收窄到 `IpcFail`，可安全读取 `res.message`（可能为 `undefined`），并按 `res.canceled` 区分「用户取消」与「真实失败」。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖（仅类型） | `../shared/types` | 仅 `PreloadApi` 一项 |
| 被引用 | `tsconfig.web.json` | `include` 第 21 行显式引入，使声明进入渲染层编译上下文 |
| 被校验 | `npm run typecheck` | `tsc --noEmit -p tsconfig.web.json` 会同时校验渲染层调用与本文声明 |
| 契约来源 | `src/shared/types.ts` ⑨ 节 | `PreloadApi` 是唯一真源；本文件只转发 |
| 契约对端 | `src/preload/index.ts` | **12** 个命名空间、方法名、参数顺序、返回结构由同一份 `PreloadApi` 约束 |
| 契约下游 | `src/renderer/src/**` | `pages/`（含 `HtmlGenPage/MaterialsSection.vue` 的素材三件套调用）、`composables/`、`App.vue` 等全部 `window.*` 调用 |

## 5. 注意事项与实现要点

- **禁止在本文件重新声明 window 成员**：唯一真源是 `src/shared/types.ts` 的 `PreloadApi`；在本文件补一个方法签名等于又造出一份会漂移的副本（这正是旧形态的问题）。
- **`extends` 而非重复声明合并**：本文件用 `interface Window extends PreloadApi {}` 一次性并入全部命名空间；不要在 `declare global` 里再写 `interface Window { projectTools: {...} }` 之类的片段，否则与 `PreloadApi` 冲突或互相覆盖。
- **索引签名已取消**：旧版 `OkResult` 的 `[key: string]: any` 让平铺字段可访问但屏蔽拼写错误；现在成功分支是精确交叉类型，拼错字段名会直接编译失败（这是有意收紧）。
- **`IpcResult` / `IpcFail` 不在这里定义**：它们属于 `src/shared/types.ts` ① 节；需要引用时从 `../shared/types` 导入，不要在本文件「补一个」。
- **取消类结果没有 `message`**：`{ ok: false, canceled: true }` 是合法失败分支，读 `message` 前按可选处理。
- **纯声明文件**：本文件不产生任何运行时代码，不得在其中写实现或副作用语句；`export {}` 之外不应新增导出。
