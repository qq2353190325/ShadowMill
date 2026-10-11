# 03 · 目录架构：`src/preload/`（桥接层）

> 预加载脚本是渲染层通往系统的**唯一门面**：它把 69 个 IPC 频道收敛成 8 个命名空间的方法，并用「单订阅」语义转发 4 路进度推送。渲染层永远不直接接触 `ipcRenderer`。

---

## 1. 文件清单

| 文件 | 行数 | 角色 | 是否进运行时 |
|---|---|---|---|
| [index.ts](./files/preload/index.ts.md) | 159 | `contextBridge` 暴露 8 个命名空间 + 4 路进度通道的单订阅转发；每个对象用 `PreloadApi['<命名空间>']` 标注 | 是（构建为 `out/preload/index.js`，CJS） |
| [index.d.ts](./files/preload/index.d.ts.md) | 11 | 只做 `interface Window extends PreloadApi {}`，把共享层契约挂到全局 `Window` | 否（仅类型，被 `tsconfig.web.json` include，为渲染层提供智能提示） |

---

## 2. 为什么必须是 CJS

- Electron 31 的 **sandboxed preload 只支持 CommonJS**，因此全工程刻意**不设置** `"type": "module"`，`electron.vite.config.ts` 的 preload 段只挂 `externalizeDepsPlugin()`，由 electron-vite 输出 CJS。
- `src/agent/package.json` 单独声明 `{"type":"module"}` 只影响该子目录，不会污染主工程输出。
- preload 源码里对 `../shared/ipc` 与 `../shared/types` 的 `import` 在构建时被**内联**，运行时只依赖 `require('electron')`。

---

## 3. 暴露的 8 个命名空间

| 命名空间 | 方法数 | 底层域 | 说明 |
|---|---|---|---|
| `electronAPI` | — | 无（纯数据） | `platform`、`versions{node,chrome,electron}` |
| `appTools` | 1 | `app:copy-text` | 剪贴板写入（sandbox 下渲染层无 `clipboard` 模块） |
| `windowControls` | 4 | `window:*` | 最小化 / 最大化切换 / 关闭 / 最大化状态订阅 |
| `hfTools` | 6 | `dialog:open-html`、`video:*` | HTML 选择、内置项目列表、预览外壳、转视频、在文件夹中显示、渲染进度订阅 |
| `settingsTools` | 3 | `settings:*` | 读取 / 保存 / 连接测试 |
| `voiceTools` | 18 | `voice:*` | 音色管理、文字生音频、字幕配音对齐（含 `synthAligned` / `cancelAlign` / `onAlignProgress`） |
| `whisperTools` | 12 | `whisper:*` | 模型状态 / 下载 / 删除 / 设为当前 / 自定义模型增删改 / 打开目录 / 选音频 / 项目音频 / 转录 / 进度订阅 |
| `projectTools` | 25 | `project:*` | 项目化流水线全量能力 + `onHtmlProgress` |

> 渲染层对主进程的全部依赖面就是这 8 个命名空间（渲染层现有 95 处 `window.<命名空间>.*` 调用），因此它们被定义为**不可漂移的契约**：方法签名唯一真源是 `src/shared/types.ts` ⑨ 节的 `PreloadApi`，频道名一一对应 `src/shared/ipc.ts`。

---

## 4. 进度通道的「单订阅」语义

4 路主→渲染推送在 preload 中被统一处理成「注册回调」的形式：

| 通道 | 命名空间方法 | 单订阅实现 |
|---|---|---|
| `project:html-progress` | `projectTools.onHtmlProgress(cb)` | `_htmlProgressCb` + `_htmlProgressBound` |
| `whisper:progress` | `whisperTools.onProgress(cb)` | `_whisperProgressCb` + `_whisperProgressBound` |
| `voice:align-progress` | `voiceTools.onAlignProgress(cb)` | `_alignProgressCb` + `_alignProgressBound` |
| `video:progress` | `hfTools.onProgress(cb)` | 直接 `ipcRenderer.on` 转发（无单订阅标志） |

做法：模块级保存「当前回调」，只在首次注册时真正 `ipcRenderer.on` 一次；后续调用**只替换回调函数**。目的与效果：

- 页面反复挂载/切换时不会重复叠加监听器，避免同一条进度被处理多次、以及旧页面回调泄漏。
- 语义上等价于「全局只有一个进度消费方」，所以渲染层各页面在 `onMounted` 注册一次即可（如 `useRenderProgress.ts` 由 `App.vue` 订阅一次；whisper 区块在自身 `onMounted` 订阅，切页即替换）。

---

## 5. 类型来源：`shared/types.ts` 的 `PreloadApi`

- **唯一真源在共享层**：8 个命名空间的方法签名、参数顺序与返回类型统一定义在 `src/shared/types.ts` ⑨ 节的 `PreloadApi`；`index.d.ts` 只剩一句 `interface Window extends PreloadApi {}`（外加 `import type` 与 `export {}`）。
- **实现侧也被同一份契约约束**：`index.ts` 的每个对象都写成 `const hfTools: PreloadApi['hfTools'] = { ... }` 形式（`electronAPI` / `appTools` / `windowControls` / `hfTools` / `settingsTools` / `voiceTools` / `whisperTools` / `projectTools` 共 8 处），因此方法名、参数个数、返回类型写错会直接在 `tsconfig.node.json` 阶段编译失败。
- **结果类型约定（① 节）**：

```ts
interface IpcFail { ok: false; message?: string; canceled?: boolean }
type IpcResult<T = unknown> = ({ ok: true } & T) | IpcFail
```

  `message` 为**可选**，因为 `voice:pick-dir` 的用户取消分支只回 `{ ok: false, canceled: true }`；成功分支的业务字段是**平铺**的（没有 `data` 包装，也没有旧版 `OkResult` 的 `[key: string]: any` 索引签名）。
- 该文件被 `tsconfig.web.json` 的 `include` 显式引入（`src/preload/index.d.ts`），这是渲染层获得 IPC 类型的唯一途径；`tsconfig.node.json` 则包含 `src/preload/index.ts` 本体，两侧共同保证契约不漂移。
- 少数接口不遵循 `IpcResult`：`projectTools.list()` 返回数组、`projectTools.load()` 返回项目对象或 `null`、`pickAudio()` / `pickVideo()` 返回 `string | null`、`hfTools.listProjects()` 返回数组、`settingsTools.get()` 直接返回 `AppSettings`、`hfTools.renderVideo()` 返回 `VideoRenderResult` —— 这些是历史契约，改动会同时影响渲染层多处调用。

---

## 6. 与本层相关的注意事项

1. **频道名必须引用 `IPC.*` 常量**，不得写字符串字面量：常量集中在 `src/shared/ipc.ts`，是主进程、preload 两侧唯一的对齐依据（例外：`dialog:open-html` 属于 `IPC.Video.OpenHtml`，命名上不属于 `video:` 前缀，属历史遗留，不可「顺手统一」）。
2. **不要让 `ipcRenderer` 泄漏到渲染层**：不暴露通用的 `invoke(channel, …)` 逃生舱，所有能力都必须显式列在命名空间里，保证攻击面可枚举。
3. **`send` 与 `invoke` 的区分**：窗口控制与 `voice:align-cancel` 是单向 `send`（无返回值），其余为 `invoke`。
4. **进度回调参数有具名类型**：`onHtmlProgress` / `onProgress` / `onAlignProgress` 的回调分别标注 `HtmlProgressPayload` / `WhisperProgressPayload` / `AlignProgressPayload`（模块级 `_htmlProgressCb` 等变量同类型），`hfTools.onProgress` 则仍是就地构造的 `{ text: string }`；改字段请改 `src/shared/types.ts` ⑧ 节。

---

## 7. 相关文档

- 逐文件说明：[files/preload/](./files/preload/)
- 频道常量与类型定义：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 频道总表：[01-架构总览.md](./01-架构总览.md) 第 3.3 节
