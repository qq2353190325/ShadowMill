# 05 · 目录架构：`src/shared/`（三端共享层）

> 全应用唯一的「契约层」：频道名与跨进程载荷类型。它没有自己的运行时产物（构建时被内联进 main / preload / renderer 三端），但决定了三端能否对齐。

---

## 1. 文件清单

| 文件 | 行数 | 角色 |
|---|---|---|
| [ipc.ts](./files/shared/ipc.ts.md) | 107 | IPC 频道名常量（8 个分组、75 个频道）+ `IpcChannel` 类型 |
| [types.ts](./files/shared/types.ts.md) | 692 | 跨进程载荷类型（10 小节）：通用 IPC 结果 `IpcFail` / `IpcResult<T>`、`RegisterCtx`、设置（含渲染档位与更新设置）、音色与配音、语音识别、项目与字幕、预览/转视频、应用自更新、进度推送，以及 `PreloadApi`（`window.*` 契约唯一真源）；其中 `ProjectHtmlMaterials` 已删 `audioPath`（背景音轨由主进程注入 HTML），`ProjectSetAudioResult` 增加可选 `htmlUpdated` |

---

## 2. `ipc.ts` —— 频道常量

以冻结对象字面量导出（`as const`），按业务域分 8 组：

| 分组 | 频道数 | 频道 |
|---|---|---|
| `Window` | 4 | `window:minimize`、`window:toggle-maximize`、`window:close`、`window:maximized-change` |
| `App` | 1 | `app:copy-text` |
| `Update` | 6 | `update:check`、`update:download`、`update:cancel`、`update:install`、`update:version`、`update:progress` |
| `Settings` | 5 | `settings:get`、`settings:save`、`settings:save-render`、`settings:save-updater`、`settings:test` |
| `Voice` | 18 | `voice:get-config`、`voice:get-save-dir`、`voice:save-config`、`voice:pick-audio`、`voice:create`、`voice:list-system-voices`、`voice:list-models`、`voice:get-profiles`、`voice:save-profile`、`voice:delete-profile`、`voice:list`、`voice:list-all`、`voice:pick-dir`、`voice:list-generated`、`voice:synth`、`voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| `Whisper` | 12 | `whisper:status`、`whisper:download`、`whisper:delete`、`whisper:set-current`、`whisper:add-model`、`whisper:update-model`、`whisper:remove-model`、`whisper:open-dir`、`whisper:project-audio`、`whisper:pick-audio`、`whisper:transcribe`、`whisper:progress` |
| `Project` | 25 | `project:list`、`project:create`、`project:load`、`project:save-subtitle`、`project:save-content`、`project:generate-html`、`project:modify-html`、`project:download-html`、`project:export-srt`、`project:open-folder`、`project:open-folder-of`、`project:delete`、`project:save-video`、`project:set-render`、`project:pick-audio`、`project:set-audio`、`project:clear-audio`、`project:pick-video`、`project:set-video`、`project:clear-video`、`project:extract-video-audio`、`project:read-html`、`project:preview-html`、`project:save-html`、`project:html-progress` |
| `Video` | 4 | `dialog:open-html`、`video:show-in-folder`、`video:render`、`video:progress` |

合计 **75** 个频道（Window 4 + App 1 + Update 6 + Settings 5 + Voice 18 + Whisper 12 + Project 25 + Video 4）。

两个容易踩的点：

1. **`IPC.Video.OpenHtml` 的值是 `'dialog:open-html'`**，不是 `video:` 前缀 —— 历史遗留，改它会同时打断主进程与 preload 两侧，属于「不可顺手统一」的项。
2. **`IpcChannel` 类型是分组对象的并集**（`(typeof IPC)[keyof typeof IPC]`），即「`Window` 对象 | `App` 对象 | …」，而不是频道字符串的并集。它用于约束「必须传入 IPC 分组对象」，不要误当作字符串联合类型使用。

约束（源码注释明确写着）：频道名与现行实现逐一对应，**禁止改动**；preload 的 9 命名空间与渲染层调用全部依赖这些字面量。

---

## 3. `types.ts` —— 跨进程载荷类型

按 10 个小节组织（源码注释的编号 ①～⑨，其中新增的更新一节编号为 ③.5）：

| 小节 | 内容 | 代表类型 |
|---|---|---|
| ① 通用 IPC 结果 | 全部 `{ ok, ... }` 结果的形状 | `IpcFail`（`ok:false` + 可选 `message` / `canceled`）、`IpcResult<T> = ({ ok: true } & T) \| IpcFail`（**取代**旧版只存在于 `preload/index.d.ts` 内部的 `OkResult` / `FailResult`） |
| ② 主进程装配上下文 | `register(ctx)` 的能力面 | `RegisterCtx`（`getWindow: () => BrowserWindow \| null`） |
| ③ 设置 | `userData/settings.json` 的完整 schema 与 `settings:*` 载荷 | `CustomModelConfig`、`VoiceTTSConfig`、`VoiceProfile`、`VoiceProfileType`、`VoiceProfileInput`、`WhisperCustomModel`、`WhisperSettings`、`UpdaterSettings`、`AppSettings`、`SettingsSaveResult` |
| ③.5 应用自更新 | `update:*` 的检查结果与进度载荷 | `UpdateCheckState`、`UpdateCheckResult`、`UpdateStage`、`UpdateProgressPayload` |
| ④ 音色与配音 | 系统/克隆音色、映射、合成与逐句对齐 | `SystemVoice`、`SystemVoiceItem`、`VoiceModel`、`VoiceListItem`、`VoiceCreateResult`、`VoiceSynthResult`、`VoiceAlignPayload`、`VoiceAlignResult` |
| ⑤ 语音识别 | whisper 模型状态与转录 | `WhisperModelItem`、`WhisperStatusResult`、`WhisperTranscribePayload`、`WhisperTranscribeResult` |
| ⑥ 项目与字幕 | `project.json`、字幕行、HTML 生成载荷 | `Scene`、`ContentScript`、`Project`、`SubtitleLine`、`ProjectMeta`、`ProjectAgentPayload`、`ProjectHtmlResult` |
| ⑦ 预览 / 转视频 | 渲染载荷与结果、进度 | `VideoRenderPayload`、`VideoRenderResult`、`VideoProgressPayload` |
| ⑧ 进度推送 | 5 路 main → renderer 推送载荷 | `HtmlProgressPayload`、`WhisperProgressPayload`、`AlignProgressPayload`、`VideoProgressPayload`、`UpdateProgressPayload` |
| ⑨ `window.*` 契约 | 9 个命名空间的完整方法签名 | `PreloadApi`（preload 实现与渲染层消费的唯一真源） |

三条关键约定：

1. **载荷格式禁止改动**：线上载荷必须与现行实现逐字段一致；设置文件已落盘在用户 `userData`，改字段名等于丢配置。
2. **「结构类型再导出」保引用面**：`src/main/projects.ts` 用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发四个项目结构，`src/renderer/src/composables/useAppStore.ts` 用 `export type { ProjectMeta }` 转发列表项类型 —— `projects.Project` / `from './projects'` 等既有引用不需要改，但结构只定义一处（本文件）。
3. **「本地类型」已清空**：`src/main/` 下不再有任何本地声明的 payload / result / progress 接口（可 `grep '^interface .*(Payload|Result|Progress|Info)' src/main` 验证为 0 命中），各 IPC handler 的 `payload` 参数一律标注共享层的 `*Payload` 类型。

---

## 4. 消费方与编译期归属

| 消费方 | 引入方式 | 归属 tsconfig |
|---|---|---|
| `src/main/*.ts` | `import { IPC } from '../shared/ipc'`、`import type { … } from '../shared/types'`（10 个模块引入类型；`projects.ts` 还再导出四个项目结构） | `tsconfig.node.json`（`include: src/shared/**/*.ts`，`paths: @shared/*`） |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`（构建时内联）+ `import type { PreloadApi, AlignProgressPayload, HtmlProgressPayload, RenderOverride, UpdateProgressPayload, WhisperProgressPayload } from '../shared/types'` | `tsconfig.node.json` |
| `src/preload/index.d.ts` | `import type { PreloadApi } from '../shared/types'`，再 `interface Window extends PreloadApi {}` | `tsconfig.web.json` |
| `src/renderer/src/**` | 主要经 `window.*` 类型（由 `index.d.ts` 挂载）；如需共享类型可用别名 `@shared/*`（如 `useAppStore.ts` 的 `import type { ProjectMeta } from '@shared/types'`） | `tsconfig.web.json`（`include: src/shared/**/*.ts`，`paths: @shared/*`） |

构建期行为：

- main / preload 使用 `externalizeDepsPlugin()`，但**相对路径** import（即 `../shared/*`）会被打包器内联进产物，因此 `out/main/index.js`、`out/preload/index.js` 里没有对 `shared` 的运行时依赖。
- 渲染层别名 `@shared` → `src/shared` 在 `electron.vite.config.ts` 与 `tsconfig.web.json` 中**两处**声明，新增别名需同步。

---

## 5. 维护约定

1. **新增 IPC 必须三处齐改**：`shared/ipc.ts` 加频道常量 → 主进程对应 `register()` 内 `ipcMain.handle/on`（载荷用本层的 `*Payload` 类型标注）→ preload 命名空间加方法，并在 `shared/types.ts` ⑨ 节 `PreloadApi` 补签名（`index.d.ts` 只做 `extends`，无需再改）。
2. **不要在本层放业务逻辑**：只放常量与类型；任何函数实现都会同时进入 main 与 preload 两个 bundle，带来不必要的重复。
3. **类型与实现同源**：`PreloadApi`（⑨ 节）是唯一真源 —— `preload/index.ts` 用 `PreloadApi['<命名空间>']` 标注实现、`preload/index.d.ts` 用 `interface Window extends PreloadApi` 交给渲染层，因此「实现」与「渲染层签名」由同一份契约约束；不要再在别处复制一份方法签名（旧版 `index.d.ts` 内联签名的做法已废弃）。
4. **载荷类型不再宽松**：语音 / whisper / 项目的复杂入参已从 `Record<string, unknown>` 收敛为具名 `*Payload`（如 `VoiceSaveDirPayload`、`WhisperTranscribePayload`、`ProjectAgentPayload`），字段写错会在编译期暴露；确实需要动态字段时才用可选字段表达。

---

## 6. 相关文档

- 逐文件说明：[files/shared/](./files/shared/)
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 频道总表（含方向与消费方）：[01-架构总览.md](./01-架构总览.md) 第 3.3 节
