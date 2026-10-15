# src/shared/ipc.ts

> 三端共享的 IPC 频道名常量表，**10 组频道常量**的唯一真源（preload 11 个命名空间全部依赖这些字面量）

- **所在目录**：`src/shared/`
- **类型**：共享常量（含派生类型）
- **规模**：133 行（本轮由 132 → 133：Project 分组多了一行小节注释，**频道总数不变、仍是 85**）
- **对外导出**：`IPC`（`as const` 常量对象，含 Window / App / Update / Settings / Voice / Whisper / Project / Video / Runtime / **Legacy** 十个分组（共 **85** 个频道））、`IpcChannel`（频道字面量联合类型）

## 1. 作用与职责

本文件是项目中**所有跨进程通信频道名的唯一定义处**。它不注册也不调用任何 IPC，只提供字符串常量：

1. 消除主进程 `ipcMain.handle` / `ipcMain.on` 与 preload `ipcRenderer.invoke` / `send` / `on` 之间的"手写字符串魔数"重复 —— 两侧都 `import { IPC }`，拼写错误在编译期就能被发现。
2. 用 `as const` 冻结字面量类型，再由 `IpcChannel` 派生出全部频道名的联合类型，可用于类型收窄或工具函数签名。
3. 通过分组（Window / App / Update / Settings / Voice / Whisper / Project / Video / Runtime / Legacy）让"哪个进程模块负责哪批频道"一目了然：分组名与 `src/main/*.ts` 的文件职责基本对应。

文件首行注释明确了硬约束：**频道名与现行实现逐一对应，禁止改动**。preload 的 **11 个命名空间**（`electronAPI` / `appTools` / `windowControls` / `hfTools` / `settingsTools` / `voiceTools` / `whisperTools` / `projectTools` / `updateTools` / `runtimeTools` / `legacyTools`）与渲染层全部调用都依赖这些字符串，任何一个字符的改动都会导致 invoke 无响应（`ipcMain.handle` 未命中时 Promise 会抛 "No handler registered"）。

> 源码第 2 行的注释已同步为「preload 11 命名空间」（2026-10 修正，此前写着 8）。命名空间再增减时，这行注释与本文都要一起改。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `IPC` | `const` 对象（`as const`） | 十个分组的嵌套常量表，值为普通字符串字面量 |
| `IpcChannel` | `export type` | `(typeof IPC)[keyof typeof IPC]`，即十个分组对象类型的并集（注意：类型粒度为"分组对象"，而非单个频道字符串） |

### 2.1 Window 分组（窗口控制 + 状态回推）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Window.Minimize` | `window:minimize` | renderer → main，`send`，最小化窗口 |
| `Window.ToggleMaximize` | `window:toggle-maximize` | renderer → main，`send`，最大化/还原切换 |
| `Window.Close` | `window:close` | renderer → main，`send`，关闭窗口 |
| `Window.MaximizedChange` | `window:maximized-change` | main → renderer，推送最大化状态，供自绘标题栏切换图标 |

### 2.2 App 分组（应用级小工具）

> 分组注释在 2026-10 由「剪贴板（renderer → main，invoke）」改为「应用级小工具（renderer → main，invoke）」：这个分组装的是「渲染层在 sandbox 下做不到、需要主进程代劳」的零散能力，目前只有一项。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `App.CopyText` | `app:copy-text` | renderer → main，`invoke`，由主进程写剪贴板（sandbox 下渲染层无 clipboard 模块） |

> 这里**曾经**还有一条 `App.OpenExternal`（值 `app:open-external`）：它只服务配置类弹窗上的「去充值」按钮，而那个按钮**从未被用户同意过**，已整条摘除（余额 / 欠费改为走内嵌状态行）。频道常量、preload 的 `appTools.openExternal`、主进程 handler 与 `electron` 的 `shell` 导入一并删除，**`App` 分组计数回到 1**；细节见 [shared/errors.ts.md](./errors.ts.md) §6 / §10。

### 2.3 Settings 分组（settings.js / settings.ts）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Settings.Get` | `settings:get` | 读取 `AppSettings`（含 customModel / **voice（按厂家）** / voiceProfiles / whisper / render / updater；旧 `voiceTTS` 只读兼容） |
| `Settings.Save` | `settings:save` | 保存自定义模型配置（OpenAI 兼容端点） |
| `Settings.SaveRender` | `settings:save-render` | 保存视频渲染**默认档位**（只更新 `render` 段，不动 customModel） |
| `Settings.SaveUpdater` | `settings:save-updater` | 保存**更新设置**（只更新 `updater` 段：`feedUrl` / `autoCheck` / `skippedVersion`） |
| `Settings.Test` | `settings:test` | 用给定 `CustomModelConfig` 发起一次连通性测试（失败分支会带 `detail` 与可能的 `needConfig`；设置页刻意不弹窗，只显示状态行） |
| `Settings.PickRuntimePack` | `settings:pick-runtime-pack` | renderer → main，`invoke`，运行环境「从本地文件安装…」：弹文件框选 `ffmpeg.7z` / `hyperframes.7z`，复制到 `userData/runtime/local-import/` 并生成同名清单（离线 / 内网机器的兜底入口，见 `docs/runtime-pack-split.md` §11.1） |

### 2.4 Update 分组（`updater/index.ts` 注册，应用自更新）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Update.Check` | `update:check` | renderer → main，`invoke`，检查更新（读更新源 `latest.yml`） |
| `Update.Download` | `update:download` | renderer → main，`invoke`，下载安装包（`autoDownload = false`，仅用户触发） |
| `Update.Cancel` | `update:cancel` | renderer → main，`invoke`，取消下载 |
| `Update.Install` | `update:install` | renderer → main，`invoke`，退出并运行安装器 |
| `Update.Version` | `update:version` | renderer → main，**`sendSync`（全工程唯一的同步频道）**，只回当前版本号字符串 |
| `Update.Status` | `update:status` | renderer → main，`invoke`，取一次当前更新状态（`payload()` 快照，`stage` 经 `toStage()` 白名单收敛）；主进程状态常驻，设置页挂载时用它补齐「启动静默检查」那次失败（该事件早于页面订阅 `update:progress`） |
| `Update.OpenLog` | `update:open-log` | renderer → main，`invoke`，定位 `userData/updater.log`（排障出口，**不依赖 electron-updater 是否加载成功**） |
| `Update.Progress` | `update:progress` | main → renderer，推送更新阶段 / 下载进度（`UpdateProgressPayload`，含 `message` / `detail`） |

### 2.5 Voice 分组（voice.js / ttsAlign.js）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Voice.GetConfig` | `voice:get-config` | 取 `{ active, providers, saveDir }`（**按厂家**） |
| `Voice.GetSaveDir` | `voice:get-save-dir` | 解析本次合成的落盘目录（支持项目目录 / 自定义目录 / 默认输出目录） |
| `Voice.SaveConfig` | `voice:save-config` | 保存 `VoiceSaveConfigPayload`（`{ provider?, config: { apiKey? } }`；兼容历史 `{ voiceTTS }` / 裸 `{ apiKey, targetModel }`） |
| `Voice.PickAudio` | `voice:pick-audio` | 弹出文件框选择音色样本音频 |
| `Voice.Create` | `voice:create` | 用样本音频克隆音色，返回 voice_id（未配置 Key 时失败体带 `needConfig:'voice'`） |
| `Voice.ListSystemVoices` | `voice:list-system-voices` | 列出 Qwen-TTS 系统音色 |
| `Voice.ListModels` | `voice:list-models` | 列出可用 TTS 模型 |
| `Voice.GetProfiles` | `voice:get-profiles` | 读取本地音色映射 `Record<string, VoiceProfile>` |
| `Voice.SaveProfile` | `voice:save-profile` | 保存单个音色映射 |
| `Voice.DeleteProfile` | `voice:delete-profile` | 按 key 删除音色映射 |
| `Voice.DeleteCloud` | `voice:delete-cloud` | **删除云端克隆音色**（DashScope customization `action=delete` / `delete_voice`）；与 `DeleteProfile`（只清本地映射）不同，**不可撤销** |
| `Voice.List` | `voice:list` | 列出云端自定义音色 |
| `Voice.ListAll` | `voice:list-all` | 合并系统音色 + 自定义音色（含 cloudMessage 降级说明） |
| `Voice.PickDir` | `voice:pick-dir` | 选择保存目录 |
| `Voice.ListGenerated` | `voice:list-generated` | 列出已生成音频（含分组、大小、mtime） |
| `Voice.Synth` | `voice:synth` | 文字生音频（非实时 HTTP 方案） |
| `Voice.SynthAligned` | `voice:synth-aligned` | 字幕配音：逐句合成 + 对齐/重排 |
| `Voice.AlignCancel` | `voice:align-cancel` | renderer → main，`send`，取消正在进行的对齐任务 |
| `Voice.AlignProgress` | `voice:align-progress` | main → renderer，推送对齐进度（单订阅） |

### 2.6 Whisper 分组（whisper.js / whisper.ts）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Whisper.Status` | `whisper:status` | 返回 cli 是否存在、modelsDir、langs、models、unknownFiles、usedBytes、currentModelId |
| `Whisper.Download` | `whisper:download` | 下载指定 id 的模型 |
| `Whisper.Delete` | `whisper:delete` | 删除指定 id 的模型文件 |
| `Whisper.SetCurrent` | `whisper:set-current` | 设置当前使用的模型 id |
| `Whisper.AddModel` | `whisper:add-model` | 新增自定义模型条目（`WhisperCustomModel`） |
| `Whisper.UpdateModel` | `whisper:update-model` | 更新自定义模型条目 |
| `Whisper.RemoveModel` | `whisper:remove-model` | 删除自定义模型条目 |
| `Whisper.OpenDir` | `whisper:open-dir` | 打开模型目录或程序目录（`which`） |
| `Whisper.ProjectAudio` | `whisper:project-audio` | 取当前项目已设置的音频 |
| `Whisper.PickAudio` | `whisper:pick-audio` | 选择待转录音频 |
| `Whisper.Transcribe` | `whisper:transcribe` | 执行字幕转录，返回 segments |
| `Whisper.Progress` | `whisper:progress` | main → renderer，推送转录进度（单订阅） |

### 2.7 Project 分组（projects.js / projects.ts）

> 本组共 **25** 个频道。本轮素材库改造是 **3 换 3**：`PickVideo` / `SetVideo` / `ClearVideo` 下线，`PickMedia` / `AddMaterials` / `SaveMaterials` 上线，**组内计数与全库合计都不变**（全库仍是 85）。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Project.List` | `project:list` | 项目列表（含 hasSubtitle / hasHtml / hasVideo / subtitleCount / updatedAt） |
| `Project.Create` | `project:create` | 新建项目（参数为裸字符串 `name`） |
| `Project.Load` | `project:load` | 读取项目元数据与内容（返回值里的 `materials` 已由主进程规范化） |
| `Project.SaveSubtitle` | `project:save-subtitle` | 保存字幕文本与标题 |
| `Project.SaveContent` | `project:save-content` | 保存内容（文案/结构化数据） |
| `Project.GenerateHtml` | `project:generate-html` | 调模型生成 HTML（带素材：字幕 + `materialIds`）；失败体可能带 `needConfig` / `title`（配置类错误，由 `configTargetOf()` 补分类） |
| `Project.ModifyHtml` | `project:modify-html` | 调模型修改既有 HTML；失败体同上传配置类字段 |
| `Project.DownloadHtml` | `project:download-html` | 导出 HTML 到用户选定位置 |
| `Project.ExportSrt` | `project:export-srt` | 导出 SRT 字幕文件 |
| `Project.OpenFolder` | `project:open-folder` | 打开项目目录（项目尚未落盘时提示「项目目录不存在（项目尚未保存）」） |
| `Project.OpenFolderOf` | `project:open-folder-of` | 打开某个绝对路径（文件或目录）所在目录 |
| `Project.Delete` | `project:delete` | 删除项目 |
| `Project.SaveVideo` | `project:save-video` | 把渲染产物视频路径写回项目（与「视频素材」无关） |
| `Project.SetRender` | `project:set-render` | 写 / 清除项目级渲染档位覆盖（`render` 传 `null` 即回到跟随全局默认） |
| `Project.PickAudio` | `project:pick-audio` | 选择项目音频 |
| `Project.SetAudio` | `project:set-audio` | 写入项目音频 |
| `Project.ClearAudio` | `project:clear-audio` | 清除项目音频 |
| `Project.PickMedia` | `project:pick-media` | **项目素材库：选文件**（按 `kind` 给扩展名过滤；图片 `multiSelections`、视频单选，返回绝对路径数组） |
| `Project.AddMaterials` | `project:add-materials` | **项目素材库：复制入库 + 登记**（超限 / 格式不支持则跳过并回报跳过数） |
| `Project.SaveMaterials` | `project:save-materials` | **项目素材库：整份列表回写**（移除与勾选共用；移除只摘登记、不删文件） |
| `Project.ExtractVideoAudio` | `project:extract-video-audio` | 从项目视频抽取音轨作为音频（**频道与 handler 保留，界面入口本轮临时下线**；handler 仍读历史字段 `proj.videoMaterial`） |
| `Project.ReadHtml` | `project:read-html` | 读取项目 HTML 源码 |
| `Project.PreviewHtml` | `project:preview-html` | 生成预览用 HTML |
| `Project.SaveHtml` | `project:save-html` | 保存手工编辑后的 HTML |
| `Project.HtmlProgress` | `project:html-progress` | main → renderer，推送 HTML 生成/修改进度（单订阅） |

### 2.8 Video 分组（video.js / video.ts）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Video.OpenHtml` | `dialog:open-html` | 打开文件框选择 HTML（注意前缀是 `dialog:`，不属于 `video:` 命名空间）；**保留但渲染层当前无调用方** |
| `Video.ShowInFolder` | `video:show-in-folder` | 在资源管理器中定位产物文件（「视频预览」页「在文件夹中显示」） |
| `Video.Render` | `video:render` | HyperFrames 渲染为视频 |
| `Video.Progress` | `video:progress` | main → renderer，推送渲染进度 `{ text }` |

### 2.9 Runtime 分组（runtime.ts，运行环境分包）

> 运行环境由「安装包里带一个整体包」改为**分包**：`ffmpeg` 与 `hyperframes` 各自一个 7z、首次用到时下载并解到 `<userData>/runtime/<包名>/`，`whisper` 随安装包。方案见 `docs/runtime-pack-split.md`。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Runtime.Status` | `runtime:status` | renderer → main，`invoke`，查询运行环境状态（`RuntimeProgressPayload`：`phase` / `pack` / `percent` / `packs` / `missing` / `status` / …） |
| `Runtime.Prepare` | `runtime:prepare` | renderer → main，`invoke`，主动准备指定包（载荷 `packs?: RuntimePackName[]`，**省略 = 全部**） |
| `Runtime.Cancel` | `runtime:cancel` | renderer → main，`invoke`，**取消**进行中的下载 / 解包（中断 HTTP 请求与 `7za` 子进程，并清掉半成品） |
| `Runtime.Progress` | `runtime:progress` | main → renderer，`send`，推送运行环境进度（单订阅；唯一出口 `push()`） |

### 2.10 Legacy 分组（`src/main/index.ts`，历史数据目录）

> 品牌 / 目录改名后，老目录里可能留着用户的全部数据（项目、模型、配置）。**主进程负责扫描与执行；界面完全在渲染层**（应用内弹窗 `LegacyDataDialog.vue`，沿用 `.hf-modal` 体系），因此这里只有「问一次」与「回传选择」两个频道，没有任何主 → 渲染的推送。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Legacy.Status` | `legacy:status` | renderer → main，`invoke`，无载荷；返回 `LegacyDataInfo \| null`（老目录绝对路径 / 确有数据的条目名 / 项目数），扫一次即缓存（`src/main/index.ts` 的 `legacyInfo()`） |
| `Legacy.Resolve` | `legacy:resolve` | renderer → main，`invoke`，载荷就是 `action` 字符串（`'migrate' \| 'delete' \| 'later'`，非法/缺省一律当 `'later'`）；返回 `LegacyResolveResult`（`ok` / `action` / 迁移三计数 / `message`） |

- **用法**：渲染层外壳挂载时调 `window.legacyTools.status()`，有结果才弹窗；用户在弹窗里的选择经 `window.legacyTools.resolve(action)` 回传。
- **为什么不做成主进程弹原生 `dialog.showMessageBox`**：原生框与 Cyber UI 设计系统（`src/renderer/agents.md`）不一致，而项目已有 `.hf-modal` 弹窗体系可复用；同时**显示时机交给渲染层**后，主进程不再需要「建窗后等 1.5s 再弹」这类魔法延迟。主进程只回答「有没有 / 是什么」并执行选择，不做任何界面展示。
- **删除是危险动作**：主进程在执行 `'delete'` 前会再校验目标确为 `%APPDATA%` 下、名字在 `LEGACY_DIR_NAMES` 内的目录，校验不过直接返回失败（见 `wiki/files/main/index.ts.md` §3.1⑤）。

## 3. 关键流程或结构

### 3.1 三端引用关系

```
                 src/shared/ipc.ts  (IPC 常量)
                   │        │        │
      ┌────────────┘        │        └────────────┐
      ▼                     ▼                     ▼
src/main/*.ts          src/preload/index.ts    (渲染层经
ipcMain.handle/on      ipcRenderer.invoke/send   window.* 间接使用)
```

| 引用方 | 引用方式 |
| --- | --- |
| `src/main/index.ts` | `import { IPC } from '../shared/ipc'`（`IPC.Legacy.*` 的注册点；`App.CopyText` 的剪贴板 handler 也在本文件） |
| `src/main/settings.ts` | 同上 |
| `src/main/projects.ts` | 同上 |
| `src/main/voice.ts` | 同上 |
| `src/main/ttsAlign.ts` | 同上 |
| `src/main/whisper.ts` | 同上 |
| `src/main/video.ts` | 同上 |
| `src/main/updater/index.ts`（目录出口） | 同上 |
| `src/main/runtime.ts` | 同上（`Runtime` 四频道：`Status` / `Prepare` / `Cancel` / `Progress`） |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`，逐方法绑定频道 |
| `tsconfig.web.json` | `include` 含 `"src/shared/**/*.ts"`，故渲染层也可直接引用 |

### 3.2 `as const` 与 `IpcChannel`

- `export const IPC = { ... } as const` 使每个属性成为**只读的字面量类型**（如 `'window:minimize'` 而非 `string`），赋值给其他变量时不会意外放宽。
- `export type IpcChannel = (typeof IPC)[keyof typeof IPC]`：TypeScript 中 `keyof typeof IPC` 得到 `'Window' | 'App' | 'Update' | 'Settings' | 'Voice' | 'Whisper' | 'Project' | 'Video' | 'Runtime' | 'Legacy'` 十个键，取 `[keyof ...]` 后得到的是**十个分组对象类型**的并集，而不是 85 个频道字符串字面量的并集。因此该别名适合"传一个分组对象"这类签名，并不适合用于"传单个频道名"的参数约束。

### 3.3 三种通道方向约定

| 方向 | 通道举例 | 典型注册方式 |
| --- | --- | --- |
| renderer → main（请求-响应） | `settings:get`、`project:list`、**`project:pick-media`**、`voice:synth`、`update:open-log`、`legacy:status`、`legacy:resolve`、`app:copy-text` | 主进程 `ipcMain.handle`，preload `invoke` |
| renderer → main（单向） | `window:minimize`、`voice:align-cancel` | 主进程 `ipcMain.on`，preload `send` |
| main → renderer（推送） | `window:maximized-change`、`video:progress`、`whisper:progress`、`voice:align-progress`、`project:html-progress`、`update:progress`、`runtime:progress` | 主进程 `win.webContents.send`，preload `on` |

> `Legacy` 组**刻意只走第一种方向**：旧数据是否存在的结论由渲染层主动拉取，主进程不推送、不弹窗。
>
> `project:pick-media` 是少数**返回裸数组**的请求-响应频道（`string[]`，不走 `IpcResult`），取消时返回空数组。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | 无 | 本文件零 import、零副作用，是纯常量模块 |
| 被 import | `src/main/` 9 个模块 | 全部 IPC 注册点（`index.ts` / `settings.ts` / `projects.ts` / `voice.ts` / `ttsAlign.ts` / `whisper.ts` / `video.ts` / `updater/index.ts` / `runtime.ts`；`hfEnv.ts` / `htmlAgent.ts` / `systemVoices.ts` / `vad.ts` 不注册 IPC） |
| 被 import | `src/preload/index.ts` | 全部 API 绑定点（11 个命名空间） |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 分别覆盖主进程/preload 与渲染层编译 |
| 类型被消费 | `IpcChannel` | 供需要约束频道名的工具函数使用 |

## 5. 注意事项与实现要点

- **禁止改动频道名字符串**：文件首行注释即写明"频道名与现行实现逐一对应，禁止改动"。改动会导致 `ipcMain.handle` 未命中，渲染层收到 `Error: No handler registered for 'xxx'`。
- **素材库这一次是三处齐改的正面实例**：`shared/ipc.ts` 换 3 个常量 → `src/main/projects.ts` 换 3 个 handler → `src/preload/index.ts` 换 3 个桥接方法，并同步 `src/shared/types.ts` ⑨ 节 `PreloadApi.projectTools` 的签名（`pickVideo` / `setVideo` / `clearVideo` 出、`pickMedia` / `addMaterials` / `saveMaterials` 进）。**组内计数与全库合计都不变**（25 / 85）——「3 换 3」时不要顺手改动总数。
- **命名不再完全对齐**：`Window.*` 用 `window:` 前缀、`Video.OpenHtml` 却用 `dialog:open-html` 前缀，属历史遗留，**不可"顺手统一"**，因为字符串就是协议本身。
- **新增频道需三处齐改**：本文件加常量 → `src/main/*.ts` 注册 handler（载荷用 `shared/types.ts` 的 `*Payload` 标注）→ `src/preload/index.ts` 绑定方法，并在 `src/shared/types.ts` ⑨ 节 `PreloadApi` 补签名（`src/preload/index.d.ts` 只做 `extends`，无需改动）。`legacy:status` / `legacy:resolve`、运行环境分包的 `Runtime.Cancel` 与 `Settings.PickRuntimePack` 都是这条流程的实例（其中 `app:open-external` 曾按同法加过，又在 `909526c` 按「摘除未经同意的按钮」整条三处一起删掉——**加与删都要走齐三处**）。
- **往 `IpcFail` 加字段不必改 preload**：preload 只是 `ipcRenderer.invoke` 转发、原样返回主进程对象，因此 `IpcFail` 新增的 `needConfig` / `title` 与 preload 无关（改动只落在 `src/shared/types.ts` 的声明与主进程/渲染层的读写上）。
- **`Update.OpenLog` 的位置与语义**（2026-10 新增）：它排在 `Status` 与 `Progress` 之间，值 `update:open-log`。主进程侧刻意**不经过** `ensureUpdater()`——更新失败时最常见的场景恰恰是 electron-updater 没加载起来，若把它挂在懒加载之后，最需要看日志的时候反而打不开日志。
- **`Update.Status` 的位置与语义**（2026-10 新增）：它排在 `Version` 之后、`OpenLog` 之前，值 `update:status`，`ipcMain.handle(IPC.Update.Status, () => payload())`。存在的理由：启动静默检查发生在设置页订阅 `update:progress` 之前，没有这条通道渲染层只会看到 `idle`。主进程 `state` 常驻，设置页每次挂载都能拉到当前状态；它与 `OpenLog` 一样不进 `ensureUpdater()`。
- **分组名 ≠ 文件名**：`Settings` 对应 `settings.ts`，`Video` 对应 `video.ts`，`App` 分组实际由 `src/main/index.ts` 处理，`Voice` 分组横跨 `voice.ts` 与 `ttsAlign.ts`，**`Legacy` 分组也由 `src/main/index.ts` 处理**（与 `App` 同理）。
- **`as const` 后不可写**：所有属性为只读，运行时尝试 `IPC.Window.Close = 'x'` 在严格模式下会抛错。
- **`IpcChannel` 粒度提示**：如上文所述它是"分组对象"的并集，误当作"频道字符串联合"使用会得到过于宽泛的类型。
- **零运行时开销**：常量会被打包器内联，主进程与 preload 各自持有自己的副本，不存在跨进程共享对象。
