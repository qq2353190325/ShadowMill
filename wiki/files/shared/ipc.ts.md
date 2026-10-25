# src/shared/ipc.ts

> 三端共享的 IPC 频道名常量表，**12 组频道常量 / 106 个频道**的唯一真源（preload 13 个命名空间全部依赖这些字面量）

- **所在目录**：`src/shared/`
- **类型**：共享常量（含派生类型）
- **规模**：184 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：`IPC`（`as const` 常量对象，含 Window / App / Update / Settings / Voice / Whisper / Project / **Cast** / Script / Video / Runtime / Legacy 十二个分组（共 **106** 个频道））、`IpcChannel`（频道字面量联合类型）

## 1. 作用与职责

本文件是项目中**所有跨进程通信频道名的唯一定义处**。它不注册也不调用任何 IPC，只提供字符串常量：

1. 消除主进程 `ipcMain.handle` / `ipcMain.on` 与 preload `ipcRenderer.invoke` / `send` / `on` 之间的「手写字符串魔数」重复 —— 两侧都 `import { IPC }`，拼写错误在编译期就能被发现。
2. 用 `as const` 冻结字面量类型，再由 `IpcChannel` 派生出全部频道名的联合类型（粒度为「分组对象」，见 §3.2），可用于类型收窄或工具函数签名。
3. 通过分组（Window / App / Update / Settings / Voice / Whisper / Project / **Cast** / Script / Video / Runtime / Legacy）让「哪个进程模块负责哪批频道」一目了然：分组名与 `src/main/` 下的模块职责基本对应。

文件首行注释明确了硬约束：**频道名与现行实现逐一对应，禁止改动**。preload 的 **13 个命名空间**（`electronAPI` / `appTools` / `windowControls` / `hfTools` / `settingsTools` / `voiceTools` / `whisperTools` / `projectTools` / **`castTools`** / `scriptTools` / `updateTools` / `runtimeTools` / `legacyTools`）与渲染层全部调用都依赖这些字符串，任何一个字符的改动都会导致 invoke 无响应（`ipcMain.handle` 未命中时 Promise 会抛 "No handler registered"）。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `IPC` | `const` 对象（`as const`） | 十二个分组的嵌套常量表，值为普通字符串字面量 |
| `IpcChannel` | `export type` | `(typeof IPC)[keyof typeof IPC]`，即十二个分组对象类型的并集（注意：类型粒度为「分组对象」，而非单个频道字符串） |

### 2.1 Window 分组（窗口控制 + 状态回推，4 条）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Window.Minimize` | `window:minimize` | renderer → main，`send`，最小化窗口 |
| `Window.ToggleMaximize` | `window:toggle-maximize` | renderer → main，`send`，最大化/还原切换 |
| `Window.Close` | `window:close` | renderer → main，`send`，关闭窗口 |
| `Window.MaximizedChange` | `window:maximized-change` | main → renderer，推送最大化状态，供自绘标题栏切换图标 |

### 2.2 App 分组（应用级小工具，1 条）

> 这个分组装的是「渲染层在 sandbox 下做不到、需要主进程代劳」的零散能力，目前只有一项。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `App.CopyText` | `app:copy-text` | renderer → main，`invoke`，由主进程写剪贴板（sandbox 下渲染层无 clipboard 模块） |

### 2.3 Settings 分组（settings.ts，6 条）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Settings.Get` | `settings:get` | 读取 `AppSettings`（含 customModel / **voice（按厂家）** / voiceProfiles / whisper / render / updater；旧 `voiceTTS` 只读兼容） |
| `Settings.Save` | `settings:save` | 保存自定义模型配置（OpenAI 兼容端点） |
| `Settings.SaveRender` | `settings:save-render` | 保存视频渲染**默认档位**（只更新 `render` 段） |
| `Settings.SaveUpdater` | `settings:save-updater` | 保存**更新设置**（只更新 `updater` 段：`feedUrl` / `autoCheck` / `skippedVersion`） |
| `Settings.Test` | `settings:test` | 用给定 `CustomModelConfig` 发起一次连通性测试（失败分支带 `detail` 与可能的 `needConfig`） |
| `Settings.PickRuntimePack` | `settings:pick-runtime-pack` | 运行环境「从本地文件安装…」：弹文件框选 `ffmpeg.7z` / `hyperframes.7z`，复制到 `userData/runtime/local-import/` 并生成同名清单 |

### 2.4 Update 分组（`updater/index.ts` 注册，9 条）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Update.Check` | `update:check` | 检查更新（读更新源 `latest.yml`） |
| `Update.Download` | `update:download` | 下载安装包（`autoDownload = false`，仅用户触发） |
| `Update.Cancel` | `update:cancel` | 取消下载 |
| `Update.Install` | `update:install` | 退出并运行安装器 |
| `Update.Version` | `update:version` | **`sendSync`（全工程唯一的同步频道）**，只回当前版本号字符串 |
| `Update.Status` | `update:status` | 取一次当前更新状态（`payload()` 快照）；主进程状态常驻，设置页挂载时用它补齐「启动静默检查」那次失败 |
| `Update.OpenLog` | `update:open-log` | 定位 `userData/updater.log`（排障出口，**不依赖 electron-updater 是否加载成功**） |
| `Update.Changelog` | `update:changelog` | 取随包 `CHANGELOG.md` 的**原文**；主进程只定位 + 读文件，分块与行内排版在渲染层 `utils/changelog.ts` |
| `Update.Progress` | `update:progress` | main → renderer，推送更新阶段 / 下载进度（`UpdateProgressPayload`） |

### 2.5 Voice 分组（voice/ipc/* 与 voice/ttsAlign.ts，19 条）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Voice.GetConfig` | `voice:get-config` | 取 `{ active, providers, saveDir }`（**按厂家**） |
| `Voice.GetSaveDir` | `voice:get-save-dir` | 解析本次合成的落盘目录 |
| `Voice.SaveConfig` | `voice:save-config` | 保存 `VoiceSaveConfigPayload`（兼容历史 `{ voiceTTS }` / 裸 `{ apiKey, targetModel }`） |
| `Voice.PickAudio` | `voice:pick-audio` | 弹出文件框选择音色样本音频 |
| `Voice.Create` | `voice:create` | 用样本音频克隆音色，返回 voice_id（未配置 Key 时失败体带 `needConfig:'voice'`） |
| `Voice.ListSystemVoices` | `voice:list-system-voices` | 列出 Qwen-TTS 系统音色 |
| `Voice.ListModels` | `voice:list-models` | 列出可用 TTS 模型 |
| `Voice.GetProfiles` | `voice:get-profiles` | 读取本地音色映射 |
| `Voice.SaveProfile` | `voice:save-profile` | 保存单个音色映射 |
| `Voice.DeleteProfile` | `voice:delete-profile` | 按 key 删除音色映射 |
| `Voice.DeleteCloud` | `voice:delete-cloud` | **删除云端克隆音色**（DashScope customization `action=delete`）；与 `DeleteProfile`（只清本地映射）不同，**不可撤销** |
| `Voice.List` | `voice:list` | 列出云端自定义音色 |
| `Voice.ListAll` | `voice:list-all` | 合并系统音色 + 自定义音色 |
| `Voice.PickDir` | `voice:pick-dir` | 选择保存目录 |
| `Voice.ListGenerated` | `voice:list-generated` | 列出已生成音频 |
| `Voice.Synth` | `voice:synth` | 文字生音频（非实时 HTTP 方案） |
| `Voice.SynthAligned` | `voice:synth-aligned` | 字幕配音：逐句合成 + 对齐/重排 |
| `Voice.AlignCancel` | `voice:align-cancel` | renderer → main，`send`，取消正在进行的对齐任务 |
| `Voice.AlignProgress` | `voice:align-progress` | main → renderer，推送对齐进度（单订阅） |

### 2.6 Whisper 分组（whisper.ts，12 条）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Whisper.Status` | `whisper:status` | 返回 cli 是否存在、modelsDir、langs、models、unknownFiles、usedBytes、currentModelId |
| `Whisper.Download` | `whisper:download` | 下载指定 id 的模型 |
| `Whisper.Delete` | `whisper:delete` | 删除指定 id 的模型文件 |
| `Whisper.SetCurrent` | `whisper:set-current` | 设置当前使用的模型 id |
| `Whisper.AddModel` | `whisper:add-model` | 新增自定义模型条目 |
| `Whisper.UpdateModel` | `whisper:update-model` | 更新自定义模型条目 |
| `Whisper.RemoveModel` | `whisper:remove-model` | 删除自定义模型条目 |
| `Whisper.OpenDir` | `whisper:open-dir` | 打开模型目录或程序目录 |
| `Whisper.ProjectAudio` | `whisper:project-audio` | 取当前项目已设置的音频 |
| `Whisper.PickAudio` | `whisper:pick-audio` | 选择待转录音频 |
| `Whisper.Transcribe` | `whisper:transcribe` | 执行字幕转录，返回 segments |
| `Whisper.Progress` | `whisper:progress` | main → renderer，推送转录进度（单订阅） |

### 2.7 Project 分组（projects/ipc/*，27 条）

> 本组共 **27** 条 = **26 个 `ipcMain.handle` + 1 条推送**（`HtmlProgress`）。角色相关的频道**不在本组**（除 `SaveCast` 这一条「本片用哪几个」）：角色的唯一真源是全局库，读写频道整体搬进了 `Cast` 组。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Project.List` | `project:list` | 项目列表（含 hasSubtitle / hasHtml / hasVideo / subtitleCount / updatedAt） |
| `Project.Create` | `project:create` | 新建项目（参数为裸字符串 `name`） |
| `Project.Load` | `project:load` | 读取项目元数据与内容（`materials` 已由主进程规范化） |
| `Project.SaveSubtitle` | `project:save-subtitle` | 保存字幕文本与标题 |
| `Project.SaveContent` | `project:save-content` | 保存内容（文案 / 结构化数据） |
| `Project.GenerateHtml` | `project:generate-html` | 调模型生成 HTML（带素材：字幕 + `materialIds`）；失败体可能带 `needConfig` / `title` |
| `Project.ModifyHtml` | `project:modify-html` | 调模型修改既有 HTML |
| `Project.DownloadHtml` | `project:download-html` | 导出 HTML（章节模式下**同时内联 `pages/cNN.js`、`cast/<id>.js` 与 `core.js`**） |
| `Project.ExportSrt` | `project:export-srt` | 导出 SRT 字幕文件 |
| `Project.OpenFolder` | `project:open-folder` | 打开项目目录 |
| `Project.OpenFolderOf` | `project:open-folder-of` | 打开某个绝对路径（文件或目录）所在目录 |
| `Project.Delete` | `project:delete` | 删除项目 |
| `Project.SaveVideo` | `project:save-video` | 把渲染产物视频路径写回项目 |
| `Project.SetRender` | `project:set-render` | 写 / 清除项目级渲染档位覆盖（`render` 传 `null` 即回到跟随全局默认） |
| `Project.SetCanvas` | `project:set-canvas` | 写**成片画布方向**（`landscape` / `portrait` / `square`）：**项目属性不是渲染档位**，白名单 `RENDER_CANVASES`、非法回 `画布取值非法`；值变化时把 `videoPath` 置空 |
| `Project.PickAudio` | `project:pick-audio` | 选择项目音频 |
| `Project.SetAudio` | `project:set-audio` | 写入项目音频 |
| `Project.ClearAudio` | `project:clear-audio` | 清除项目音频 |
| `Project.PickMedia` | `project:pick-media` | **项目素材库：选文件**（按 `kind` 给扩展名过滤；图片多选、视频单选） |
| `Project.AddMaterials` | `project:add-materials` | **项目素材库：复制入库 + 登记**（超限 / 格式不支持则跳过并回报跳过数） |
| `Project.SaveMaterials` | `project:save-materials` | **项目素材库：整份列表回写**（移除只摘登记、不删文件） |
| `Project.ExtractVideoAudio` | `project:extract-video-audio` | 从项目视频抽取音轨（**频道与 handler 保留，界面入口已下线**） |
| `Project.ReadHtml` | `project:read-html` | 读取项目 HTML 源码 |
| `Project.PreviewHtml` | `project:preview-html` | 生成预览用 HTML（页面引了 `./core.js` 时**先按版本同步一次助手**再写预览副本） |
| `Project.SaveHtml` | `project:save-html` | 保存手工编辑后的 HTML |
| `Project.SaveCast` | `project:save-cast` | **本片用哪几个全局角色**：载荷 `{ name, cast: [{ id, selected }] }`，主进程按 id 从库补全元数据、把选中的复制进 `<项目>/cast/`、再重刷页面 |
| `Project.HtmlProgress` | `project:html-progress` | main → renderer，推送 HTML 生成 / 修改 / 画角色 / **编动作**的过程进度。**一条频道 + 按任务 id 分发**：每条载荷都带 `taskId`，preload 据此只回调订阅了同一 id 的那一份；订阅方法是 `onTaskProgress(taskId, cb)`（返回退订函数），**不是单订阅** |

### 2.8 Cast 分组（`projects/ipc/cast.ts` + `projects/ipc/castActions.ts`，11 条）

> **角色只有全局一份**：落 `<userData>/cast-library/`（`index.json` 存元数据 + `<id>.js` 存绘制代码），与项目无关——没有当前项目也能用。项目里只记「本片用哪几个」（`project:save-cast`）。本组 11 条 = 角色本身 6 条 + **动作示范 5 条**（本轮新增）。

**角色本身（`ipc/cast.ts`，6 条）**

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Cast.List` | `cast:list` | 列库（**纯读**：`readLibrary` + 按文件在不在补 `missing`，不写任何东西）；「索引有、文件不在」的条目回 `missing: true`，不静默消失 |
| `Cast.Create` | `cast:create` | 调一次模型画一个新角色并写进库（`brief.taskId` 必填，进度按它路由） |
| `Cast.Recreate` | `cast:recreate` | 调一次模型按用户要求**重画库里这个角色**（覆盖库里的那份代码；id / 身高不变） |
| `Cast.SaveMeta` | `cast:save-meta` | 只改元数据（名字 / 描述 / 画风 / 身高 / 是否水彩），**不调模型** |
| `Cast.Remove` | `cast:remove` | 从库删掉（不动任何项目里已同步的副本；**连带清掉它的专属动作**，见 `cast/library.ts` 的 `removeFromLibrary`） |
| `Cast.Preview` | `cast:preview` | **静态预览（一帧）**：主进程把 `core.js` + 角色代码拼成一页自包含 HTML，落 `<userData>/cast-preview/<id>.html`，回 `{ ok, rel }`；渲染层用 `hgpreview://…?user=1` 载进 iframe |

**动作示范（`ipc/castActions.ts`，5 条 —— 本轮新增）**

> 界面上在哪：「角色」页 · 卡片**双击**（或右上「…」菜单 ·「动作示范…」）→ 动作示范弹窗（左边会动的大图、右边公共动作 + 本角色专属两组列表 +「AI 生成…」面板）。

| 常量 | 频道名 | 载荷 → 回执 | 用途 |
| --- | --- | --- | --- |
| `Cast.ActionList` | `cast:action-list` | `{ castId }` → `{ ok, shared, own }` | 列动作：`shared` = 内置 14 条 + 用户自建公共动作；`own` = 这个角色的专属动作 |
| `Cast.SaveAction` | `cast:action-save` | `{ castId, scope: 'shared' \| 'own', action }` → `{ ok, action }` | 保存 / 覆盖一条**关键帧**动作（同 id 覆盖；`id` 为空 = 新建，由主进程起 id） |
| `Cast.RemoveAction` | `cast:action-remove` | `{ castId, scope, actionId }` → `{ ok }` / `{ ok:false, message }` | 删一条动作（专属动作要带 `castId`；内置动作删不掉） |
| `Cast.GenerateAction` | `cast:action-generate` | `{ castId, taskId, request, duration?, loop?, name? }` → `{ ok, action }` | **唯一会调模型的动作路径**：读该角色源码 → `buildCastActionPrompt` → `chatWithCastAction` → `parseCastActionReply` → `validateActionCode` → 存成**专属**动作（可能用了角色自己的参数，如尾巴）；进度按 `taskId` 推送，日志 `html-agent/cast-action.jsonl` |
| `Cast.Demo` | `cast:demo` | `{ id, units?, title?, uses? }` → `{ ok, rel }` | **会动的示范页**：`core.js` + 角色代码 + 这个角色的全部动作拼成 `<userData>/cast-preview/<id>.demo.html`；渲染层把 `rel` 拼成 URL、换动作只改 `#hash` |

### 2.9 Script 分组（`src/main/agent/script.ts`，7 条）

> 分组注释把定位写死：**生成只产出文本、不写文件——场景落盘走 `project:save-content`**；**chat 系列管的是对话记录**（`projects/<项目名>/chat/`：`index.json` 索引 + `versions/<versionId>.json` 每版副本，读写与 100 轮上限在 `agent/chatLog.ts`）。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Script.Generate` | `script:generate` | 内容脚本 Agent：载荷 `ScriptGeneratePayload` → `ScriptGenerateReply`（成功 `{ ok:true, scenes, totalChars }` / 失败带 `raw` / `needConfig`）。**上下文由渲染层随载荷给** |
| `Script.LoadChat` | `script:load-chat` | 读 `chat/index.json` → `{ ok, rounds, activeVersionId }`（**不含 scenes**） |
| `Script.AppendRound` | `script:append-round` | **先写副本、再更新索引**并把 `activeVersionId` 指向新版本 → `{ ok, versionId }` |
| `Script.ReadVersion` | `script:read-version` | 读某一版副本 → `{ ok, scenes }`；**只读、无副作用** |
| `Script.SetActiveVersion` | `script:set-active-version` | 只改索引的 `activeVersionId`（**不写 `content.json`**） |
| `Script.ClearChat` | `script:clear-chat` | 删掉整个 `chat/` 目录（索引 + 全部版本副本） |
| `Script.Progress` | `script:progress` | main → renderer，推送五阶段进度 + 中文 `text` 文案（单订阅，只推给发起窗口） |

### 2.10 Video 分组（video.ts，4 条）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Video.OpenHtml` | `dialog:open-html` | 打开文件框选择 HTML（注意前缀是 `dialog:`，不属于 `video:` 命名空间）；**保留但渲染层当前无调用方** |
| `Video.ShowInFolder` | `video:show-in-folder` | 在资源管理器中定位产物文件 |
| `Video.Render` | `video:render` | HyperFrames 渲染为视频 |
| `Video.Progress` | `video:progress` | main → renderer，推送渲染进度 `{ text }` |

### 2.11 Runtime 分组（runtime.ts，4 条）

> 运行环境由「安装包里带一个整体包」改为**分包**：`ffmpeg` 与 `hyperframes` 各自一个 7z、首次用到时下载并解到 `<userData>/runtime/<包名>/`，`whisper` 随安装包。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Runtime.Status` | `runtime:status` | 查询运行环境状态（`RuntimeProgressPayload`） |
| `Runtime.Prepare` | `runtime:prepare` | 主动准备指定包（载荷 `packs?: RuntimePackName[]`，**省略 = 全部**） |
| `Runtime.Cancel` | `runtime:cancel` | **取消**进行中的下载 / 解包（并清掉半成品） |
| `Runtime.Progress` | `runtime:progress` | main → renderer，`send`，推送运行环境进度（单订阅） |

### 2.12 Legacy 分组（`src/main/index.ts`，2 条）

> 品牌 / 目录改名后，老目录里可能留着用户的全部数据。**主进程负责扫描与执行；界面完全在渲染层**（`LegacyDataDialog.vue`），因此这里只有「问一次」与「回传选择」两条，没有任何主 → 渲染的推送。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Legacy.Status` | `legacy:status` | 返回 `LegacyDataInfo \| null`（老目录绝对路径 / 确有数据的条目名 / 项目数），扫一次即缓存 |
| `Legacy.Resolve` | `legacy:resolve` | 载荷是 `action` 字符串（`'migrate' \| 'delete' \| 'later'`）；返回 `LegacyResolveResult` |

## 3. 关键流程或结构

### 3.1 三端引用关系

```
                 src/shared/ipc.ts  (IPC 常量)
                   │        │        │
      ┌────────────┘        │        └────────────┐
      ▼                     ▼                     ▼
src/main/**/*.ts        src/preload/index.ts    (渲染层经
ipcMain.handle/on      ipcRenderer.invoke/send   window.* 间接使用)
```

| 引用方 | 引用方式 |
| --- | --- |
| `src/main/index.ts` | `IPC.Legacy.*` 的注册点；`App.CopyText` 的剪贴板 handler 也在本文件 |
| `src/main/settings.ts` | `IPC.Settings.*` |
| `src/main/projects/ipc/*.ts` | `Project` / `Cast` 两组的注册点（`project.ts` 9 / `html.ts` 6 / `media.ts` 10 / `cast.ts` 7 / **`castActions.ts` 5**） |
| `src/main/voice/ipc/voices.ts` + `voice/ipc/tts.ts` / `voice/ttsAlign.ts` | `Voice` 组 |
| `src/main/whisper.ts` | `Whisper` 组 |
| `src/main/video.ts` | `Video` 组 |
| `src/main/updater/index.ts` | `Update` 组 |
| `src/main/runtime.ts` | `Runtime` 四频道 |
| `src/main/agent/script.ts` | `Script` 七频道 |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`，逐方法绑定频道 |
| `tsconfig.web.json` | `include` 含 `"src/shared/**/*.ts"`，故渲染层也可直接引用 |

### 3.2 `as const` 与 `IpcChannel`

- `export const IPC = { ... } as const` 使每个属性成为**只读的字面量类型**（如 `'window:minimize'` 而非 `string`）。
- `export type IpcChannel = (typeof IPC)[keyof typeof IPC]`：`keyof typeof IPC` 得到 **12 个分组键**，取 `[keyof ...]` 后得到的是**十二个分组对象类型**的并集，而不是 106 个频道字符串字面量的并集。因此该别名适合「传一个分组对象」这类签名，并不适合用于「传单个频道名」的参数约束。

### 3.3 三种通道方向约定

| 方向 | 通道举例 | 典型注册方式 |
| --- | --- | --- |
| renderer → main（请求-响应） | `settings:get`、`project:list`、`project:pick-media`、**`project:save-cast`**、**`cast:*` 11 条**、`voice:synth`、`update:open-log`、`legacy:status`、`app:copy-text` | 主进程 `ipcMain.handle`，preload `invoke` |
| renderer → main（单向） | `window:minimize`、`voice:align-cancel` | 主进程 `ipcMain.on`，preload `send` |
| main → renderer（推送） | `window:maximized-change`、`video:progress`、`whisper:progress`、`voice:align-progress`、`project:html-progress`、`script:progress`、`update:progress`、`runtime:progress` | 主进程 `win.webContents.send`（或 `event.sender.send`），preload `on` |

> **角色与动作相关的频道全是第一种方向**（11 条 `cast:*` + `project:save-cast`，一律 `ipcMain.handle` + preload `invoke`），没有任何推送：新建角色与编动作虽然要调模型，进度仍走既有的 `project:html-progress`（**没有为新功能加进度频道**）。
>
> `project:pick-media` 是少数**返回裸数组**的请求-响应频道（`string[]`，不走 `IpcResult`），取消时返回空数组。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | 无 | 本文件零 import、零副作用，是纯常量模块 |
| 被 import | `src/main/` 各模块 | 全部 IPC 注册点（`index.ts` / `settings.ts` / **`projects/ipc/*`** / `agent/script.ts` / `voice/ipc/*` + `voice/ttsAlign.ts` / `whisper.ts` / `video.ts` / `updater/index.ts` / `runtime.ts`；`hfEnv.ts` / `coreLib.ts` / `cast/library.ts` / `cast/actions.ts` / `agent/chat.ts` / `agent/html.ts` / `agent/castAction.ts` 不注册 IPC） |
| 被 import | `src/preload/index.ts` | 全部 API 绑定点（13 个命名空间） |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 分别覆盖主进程 / preload 与渲染层编译 |
| 类型被消费 | `IpcChannel` | 供需要约束频道名的工具函数使用 |

## 5. 注意事项与实现要点

- **禁止改动频道名字符串**：改动会导致 `ipcMain.handle` 未命中，渲染层收到 `Error: No handler registered for 'xxx'`。
- **本轮新增的 5 条都在 `Cast` 组**：`ActionList` / `SaveAction` / `RemoveAction` / `GenerateAction` / `Demo`。它们属于「动作」而不是「项目」——动作存 `<userData>/cast-library/actions.json`、示范页存 `<userData>/cast-preview/`，与当前项目无关，所以不需要项目名。
- **计数变化**：上一版 **101 条 / 12 组**（`Project` 27 + `Cast` 6）；本轮 `Cast` 组 **6 → 11**，全库 **101 → 106**，分组数不变（12）。preload 命名空间仍是 13 个（5 个新方法挂在既有 `castTools` 下）。
- **`Cast.Preview` 与 `Cast.Demo` 的分工**：前者是**静态一帧**（`<id>.html`），后者是**会动的那一页**（`<id>.demo.html`）；两者同目录、同一套 `hgpreview://?user=1` 白名单，互不覆盖。
- **新增频道需三处齐改**：本文件加常量 → `src/main/*.ts` 注册 handler（载荷用 `shared/types.ts` 的 `*Payload` 标注）→ `src/preload/index.ts` 绑定方法，并在 `src/shared/types.ts` ⑨ 节 `PreloadApi` 补签名（`src/preload/index.d.ts` 只做 `extends`，无需改动）。
- **往 `IpcFail` 加字段不必改 preload**：preload 只是 `ipcRenderer.invoke` 转发、原样返回主进程对象。
- **`as const` 后不可写**：所有属性为只读，运行时尝试 `IPC.Window.Close = 'x'` 在严格模式下会抛错。
- **零运行时开销**：常量会被打包器内联，主进程与 preload 各自持有自己的副本，不存在跨进程共享对象。
