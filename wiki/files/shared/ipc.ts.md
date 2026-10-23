# src/shared/ipc.ts

> 三端共享的 IPC 频道名常量表，**11 组频道常量**的唯一真源（preload 12 个命名空间全部依赖这些字面量）

- **所在目录**：`src/shared/`
- **类型**：共享常量（含派生类型）
- **规模**：160 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：`IPC`（`as const` 常量对象，含 Window / App / Update / Settings / Voice / Whisper / Project / **Script** / Video / Runtime / **Legacy** 十一个分组（共 **100** 个频道））、`IpcChannel`（频道字面量联合类型）

## 1. 作用与职责

本文件是项目中**所有跨进程通信频道名的唯一定义处**。它不注册也不调用任何 IPC，只提供字符串常量：

1. 消除主进程 `ipcMain.handle` / `ipcMain.on` 与 preload `ipcRenderer.invoke` / `send` / `on` 之间的"手写字符串魔数"重复 —— 两侧都 `import { IPC }`，拼写错误在编译期就能被发现。
2. 用 `as const` 冻结字面量类型，再由 `IpcChannel` 派生出全部频道名的联合类型，可用于类型收窄或工具函数签名。
3. 通过分组（Window / App / Update / Settings / Voice / Whisper / Project / **Script** / Video / Runtime / Legacy）让"哪个进程模块负责哪批频道"一目了然：分组名与 `src/main/*.ts` 的文件职责基本对应。

文件首行注释明确了硬约束：**频道名与现行实现逐一对应，禁止改动**。preload 的 **12 个命名空间**（`electronAPI` / `appTools` / `windowControls` / `hfTools` / `settingsTools` / `voiceTools` / `whisperTools` / `projectTools` / **`scriptTools`** / `updateTools` / `runtimeTools` / `legacyTools`）与渲染层全部调用都依赖这些字符串，任何一个字符的改动都会导致 invoke 无响应（`ipcMain.handle` 未命中时 Promise 会抛 "No handler registered"）。

> 源码第 2 行的注释已同步为「preload **12 命名空间**与渲染层调用依赖它们」（含 `scriptTools`），与本文一致。命名空间或分组再增减时，这行注释与本文都要一起改。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `IPC` | `const` 对象（`as const`） | 十一个分组的嵌套常量表，值为普通字符串字面量 |
| `IpcChannel` | `export type` | `(typeof IPC)[keyof typeof IPC]`，即十一个分组对象类型的并集（注意：类型粒度为"分组对象"，而非单个频道字符串） |

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
| `Update.Changelog` | `update:changelog` | renderer → main，`invoke`，取随包 `CHANGELOG.md` 的**原文**（`app.getAppPath()/CHANGELOG.md`）；主进程只定位 + 读文件，分块与行内排版在渲染层 `utils/changelog.ts`。与 `OpenLog` 一样**不依赖 electron-updater 是否加载成功** |
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

> 本组共 **32** 个频道。素材库改造是 **3 换 3**：`PickVideo` / `SetVideo` / `ClearVideo` 下线，`PickMedia` / `AddMaterials` / `SaveMaterials` 上线，**组内计数不变**；此后 `Update.Changelog`、成片画布的 `Project.SetCanvas` 与 `Script` 分组（先 2 条、后 +2 条、再扩到 7 条）各净增若干条 ⇒ 全库到 **94**（10 组 → 11 组）；角色库那一轮加 4 条（`CastLibrary` / `PromoteCast` / `ImportCast` / `RemoveCastFromLibrary`）⇒ 组内 **26 → 30**、全库 **94 → 98**；**本轮为项目角色加 2 条**（`NewCast` / `SaveCast`）⇒ 组内 **30 → 32**、全库 **98 → 100**，**分组数仍是 11**。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Project.List` | `project:list` | 项目列表（含 hasSubtitle / hasHtml / hasVideo / subtitleCount / updatedAt） |
| `Project.Create` | `project:create` | 新建项目（参数为裸字符串 `name`） |
| `Project.Load` | `project:load` | 读取项目元数据与内容（返回值里的 `materials` 已由主进程规范化） |
| `Project.SaveSubtitle` | `project:save-subtitle` | 保存字幕文本与标题 |
| `Project.SaveContent` | `project:save-content` | 保存内容（文案/结构化数据） |
| `Project.GenerateHtml` | `project:generate-html` | 调模型生成 HTML（带素材：字幕 + `materialIds`）；失败体可能带 `needConfig` / `title`（配置类错误，由 `configTargetOf()` 补分类） |
| `Project.ModifyHtml` | `project:modify-html` | 调模型修改既有 HTML；失败体同上传配置类字段 |
| `Project.DownloadHtml` | `project:download-html` | 导出 HTML 到用户选定位置（章节模式下**同时内联 `pages/cNN.js`、`cast/<id>.js` 与 `core.js`**） |
| `Project.ExportSrt` | `project:export-srt` | 导出 SRT 字幕文件 |
| `Project.OpenFolder` | `project:open-folder` | 打开项目目录（项目尚未落盘时提示「项目目录不存在（项目尚未保存）」） |
| `Project.OpenFolderOf` | `project:open-folder-of` | 打开某个绝对路径（文件或目录）所在目录 |
| `Project.Delete` | `project:delete` | 删除项目 |
| `Project.SaveVideo` | `project:save-video` | 把渲染产物视频路径写回项目（与「视频素材」无关） |
| `Project.SetRender` | `project:set-render` | 写 / 清除项目级渲染档位覆盖（`render` 传 `null` 即回到跟随全局默认） |
| `Project.SetCanvas` | `project:set-canvas` | 写**成片画布方向**（`landscape` \| `portrait` \| `square`）：它是**项目属性不是渲染档位**（不进 `settings.json`、没有全局默认那一层），白名单 `RENDER_CANVASES`、非法回 `画布取值非法`；值变化时把 `videoPath` 置空（旧成片尺寸不再匹配） |
| `Project.PickAudio` | `project:pick-audio` | 选择项目音频 |
| `Project.SetAudio` | `project:set-audio` | 写入项目音频 |
| `Project.ClearAudio` | `project:clear-audio` | 清除项目音频 |
| `Project.PickMedia` | `project:pick-media` | **项目素材库：选文件**（按 `kind` 给扩展名过滤；图片 `multiSelections`、视频单选，返回绝对路径数组） |
| `Project.AddMaterials` | `project:add-materials` | **项目素材库：复制入库 + 登记**（超限 / 格式不支持则跳过并回报跳过数） |
| `Project.SaveMaterials` | `project:save-materials` | **项目素材库：整份列表回写**（移除与勾选共用；移除只摘登记、不删文件） |
| `Project.ExtractVideoAudio` | `project:extract-video-audio` | 从项目视频抽取音轨作为音频（**频道与 handler 保留，界面入口本轮临时下线**；handler 仍读历史字段 `proj.videoMaterial`） |
| `Project.ReadHtml` | `project:read-html` | 读取项目 HTML 源码 |
| `Project.PreviewHtml` | `project:preview-html` | 生成预览用 HTML（页面引了 `./core.js` 时**先按版本同步一次助手**再写预览副本） |
| `Project.SaveHtml` | `project:save-html` | 保存手工编辑后的 HTML |
| `Project.CastLibrary` | `project:cast-library` | **全局角色库：列库**（`<userData>/cast-library/index.json` + `<id>.js`；「索引有、文件不在」的条目回 `missing: true`，不静默消失） |
| `Project.PromoteCast` | `project:promote-cast` | **全局角色库：把项目里的一个角色存为全局**（同 id 覆盖库里那份；只搬文件，不调模型） |
| `Project.ImportCast` | `project:import-cast` | **全局角色库：导入选中的角色到项目**（**复制**进 `<项目>/cast/` 并合并进 `Project.cast`，章节模式下随即重写骨架） |
| `Project.RemoveCastFromLibrary` | `project:remove-cast-from-library` | **全局角色库：从库里删一个角色**（只删库里那份，不动任何已导入它的项目） |
| `Project.NewCast` | `project:new-cast` | **项目角色：手动新建一个角色**——调一次模型画 `cast/<id>.js`（**与「生成 HTML」无关**），成功后加入 `Project.cast` 并 `refreshCastInPage()` |
| `Project.SaveCast` | `project:save-cast` | **项目角色：整份角色表回写**（勾选 / 移除 / 改名共用，与 `project:save-materials` 同语义）；清单里没有的角色的 `cast/<id>.js` 一并删除 |
| `Project.HtmlProgress` | `project:html-progress` | main → renderer，推送 HTML 生成/修改进度（单订阅） |

### 2.8 Script 分组（`src/main/agent/script.ts`，内容脚本 Agent）

> 本组共 **7** 个频道，位置在 `Project` 之后、`Video` 之前。分组注释把定位写死：**生成只产出文本、不写文件——场景落盘走 `project:save-content`**（由渲染层的自动保存触发）；**chat 系列管的是对话记录**（`projects/<项目名>/chat/`：`index.json` 索引 + `versions/<versionId>.json` 每版副本，读写与 100 轮上限在 `agent/chatLog.ts`）。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Script.Generate` | `script:generate` | renderer → main，`invoke`，内容脚本 Agent：载荷 `ScriptGeneratePayload`（`name` / `request` / `scenes` / `sceneCount?` / `targetSeconds?`）→ 返回 `ScriptGenerateReply`（成功 `{ ok:true, scenes, totalChars, message? }` / 失败 `{ ok:false, message, raw?, needConfig?, title? }`）。**上下文（当前场景）由渲染层随载荷给，主进程不读 `content.json`** |
| `Script.LoadChat` | `script:load-chat` | renderer → main，`invoke`，载荷 `{ name }`：读 `chat/index.json` → `IpcResult<ScriptChatIndex>`（`{ ok: true, rounds, activeVersionId }`，**不含 scenes**）；索引不存在 / 损坏、副本已丢的条目都被剔除，缺项目名回 `缺少项目名` |
| `Script.AppendRound` | `script:append-round` | renderer → main，`invoke`，载荷 `ScriptAppendRoundPayload`（`{ name, round, scenes }`）：**先写副本 `chat/versions/<新 id>.json`，再更新索引**并把 `activeVersionId` 指向新版本 → `IpcResult<{ versionId }>`；没有可用场景回 `这一轮没有场景，未写入对话记录`，写失败回 `保存对话记录失败：…` |
| `Script.ReadVersion` | `script:read-version` | renderer → main，`invoke`，载荷 `{ name, versionId }`：读某一版副本 → `IpcResult<ScriptVersionResult>`（`{ ok: true, scenes }`）；`versionId` 非法回 `非法的版本 id`，副本不在回 `这一版脚本读不到了（副本可能已被删除）`；**只读、无副作用** |
| `Script.SetActiveVersion` | `script:set-active-version` | renderer → main，`invoke`，载荷 `{ name, versionId }`：把某一版记为「当前应用」＝只改索引的 `activeVersionId`（**不写 `content.json`**）；该版不在索引里回 `这一版不在对话记录里` |
| `Script.ClearChat` | `script:clear-chat` | renderer → main，`invoke`，载荷 `{ name }`：删掉整个 `chat/` 目录（索引 + 全部版本副本）→ `IpcResult`；**不动 `content.json` / 编辑器里的场景** |
| `Script.Progress` | `script:progress` | main → renderer，`send`，推送五阶段进度 + 中文 `text` 文案（`ScriptProgressPayload`，单订阅；由 `agent/script.ts` 的 `registerScript(getProjectDir)` 用 `event.sender.send` 只推给发起窗口） |

### 2.9 Video 分组（video.js / video.ts）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Video.OpenHtml` | `dialog:open-html` | 打开文件框选择 HTML（注意前缀是 `dialog:`，不属于 `video:` 命名空间）；**保留但渲染层当前无调用方** |
| `Video.ShowInFolder` | `video:show-in-folder` | 在资源管理器中定位产物文件（「视频预览」页「在文件夹中显示」） |
| `Video.Render` | `video:render` | HyperFrames 渲染为视频 |
| `Video.Progress` | `video:progress` | main → renderer，推送渲染进度 `{ text }` |

### 2.10 Runtime 分组（runtime.ts，运行环境分包）

> 运行环境由「安装包里带一个整体包」改为**分包**：`ffmpeg` 与 `hyperframes` 各自一个 7z、首次用到时下载并解到 `<userData>/runtime/<包名>/`，`whisper` 随安装包。方案见 `docs/runtime-pack-split.md`。

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Runtime.Status` | `runtime:status` | renderer → main，`invoke`，查询运行环境状态（`RuntimeProgressPayload`：`phase` / `pack` / `percent` / `packs` / `missing` / `status` / …） |
| `Runtime.Prepare` | `runtime:prepare` | renderer → main，`invoke`，主动准备指定包（载荷 `packs?: RuntimePackName[]`，**省略 = 全部**） |
| `Runtime.Cancel` | `runtime:cancel` | renderer → main，`invoke`，**取消**进行中的下载 / 解包（中断 HTTP 请求与 `7za` 子进程，并清掉半成品） |
| `Runtime.Progress` | `runtime:progress` | main → renderer，`send`，推送运行环境进度（单订阅；唯一出口 `push()`） |

### 2.11 Legacy 分组（`src/main/index.ts`，历史数据目录）

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
| `src/main/projects.ts` | 同上（含本轮新增的 4 条 `Project.Cast*` / `Project.PromoteCast` / `Project.ImportCast` / `Project.RemoveCastFromLibrary`） |
| `src/main/voice.ts` | 同上 |
| `src/main/ttsAlign.ts` | 同上 |
| `src/main/whisper.ts` | 同上 |
| `src/main/video.ts` | 同上 |
| `src/main/updater/index.ts`（目录出口） | 同上 |
| `src/main/runtime.ts` | 同上（`Runtime` 四频道：`Status` / `Prepare` / `Cancel` / `Progress`） |
| `src/main/agent/script.ts` | 同上（`Script` 七频道：`Generate` / `LoadChat` / `AppendRound` / `ReadVersion` / `SetActiveVersion` / `ClearChat` 的 `ipcMain.handle` 与 `Progress` 的 `event.sender.send`） |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`，逐方法绑定频道 |
| `tsconfig.web.json` | `include` 含 `"src/shared/**/*.ts"`，故渲染层也可直接引用 |

### 3.2 `as const` 与 `IpcChannel`

- `export const IPC = { ... } as const` 使每个属性成为**只读的字面量类型**（如 `'window:minimize'` 而非 `string`），赋值给其他变量时不会意外放宽。
- `export type IpcChannel = (typeof IPC)[keyof typeof IPC]`：TypeScript 中 `keyof typeof IPC` 得到 `'Window' | 'App' | 'Update' | 'Settings' | 'Voice' | 'Whisper' | 'Project' | 'Script' | 'Video' | 'Runtime' | 'Legacy'` **十一个**键，取 `[keyof ...]` 后得到的是**十一个分组对象类型**的并集，而不是 100 个频道字符串字面量的并集。因此该别名适合"传一个分组对象"这类签名，并不适合用于"传单个频道名"的参数约束。

### 3.3 三种通道方向约定

| 方向 | 通道举例 | 典型注册方式 |
| --- | --- | --- |
| renderer → main（请求-响应） | `settings:get`、`project:list`、**`project:pick-media`**、**`project:cast-library` / `project:import-cast` / `project:new-cast` / `project:save-cast`**、`voice:synth`、`update:open-log`、**`update:changelog`**、`legacy:status`、`legacy:resolve`、`app:copy-text` | 主进程 `ipcMain.handle`，preload `invoke` |
| renderer → main（单向） | `window:minimize`、`voice:align-cancel` | 主进程 `ipcMain.on`，preload `send` |
| main → renderer（推送） | `window:maximized-change`、`video:progress`、`whisper:progress`、`voice:align-progress`、`project:html-progress`、**`script:progress`**、`update:progress`、`runtime:progress` | 主进程 `win.webContents.send`（或 `event.sender.send`），preload `on` |

> `Legacy` 组**刻意只走第一种方向**：旧数据是否存在的结论由渲染层主动拉取，主进程不推送、不弹窗。
>
> `project:pick-media` 是少数**返回裸数组**的请求-响应频道（`string[]`，不走 `IpcResult`），取消时返回空数组。
>
> **角色相关的 6 条频道全是第一种方向**（4 条角色库 + 2 条项目角色，一律 `ipcMain.handle` + preload `invoke`），没有任何推送：角色操作是用户点一下、等一个结果的动作（新建那一条虽然要调模型，进度仍走既有的 `project:html-progress`，**没有为新角色加进度频道**）。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | 无 | 本文件零 import、零副作用，是纯常量模块 |
| 被 import | `src/main/` 10 个模块 | 全部 IPC 注册点（`index.ts` / `settings.ts` / `projects.ts` / **`agent/script.ts`** / `voice.ts` / `ttsAlign.ts` / `whisper.ts` / `video.ts` / `updater/index.ts` / `runtime.ts`；`hfEnv.ts` / `coreLib.ts` / `castLibrary.ts` / `agent/chat.ts` / `agent/html.ts` / `systemVoices.ts` / `vad.ts` 不注册 IPC） |
| 被 import | `src/preload/index.ts` | 全部 API 绑定点（12 个命名空间） |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 分别覆盖主进程/preload 与渲染层编译 |
| 类型被消费 | `IpcChannel` | 供需要约束频道名的工具函数使用 |

## 5. 注意事项与实现要点

- **禁止改动频道名字符串**：文件首行注释即写明"频道名与现行实现逐一对应，禁止改动"。改动会导致 `ipcMain.handle` 未命中，渲染层收到 `Error: No handler registered for 'xxx'`。
- **素材库这一次是三处齐改的正面实例**：`shared/ipc.ts` 换 3 个常量 → `src/main/projects.ts` 换 3 个 handler → `src/preload/index.ts` 换 3 个桥接方法，并同步 `src/shared/types.ts` ⑨ 节 `PreloadApi.projectTools` 的签名。**组内计数不变**——「3 换 3」时不要顺手改动总数。此后 `Project.SetCanvas`（25 → 26）与 `Update.Changelog`（8 → 9）各净增 1 条；`Script` 分组先新增 2 条（分组 10 → 11、全库 87 → 89），再为对话记录补 `LoadChat` / `SaveChat`（组内 2 → 4、全库 **89 → 91**），本文件当时把它扩成 5 条 chat handler（`LoadChat` / `AppendRound` / `ReadVersion` / `SetActiveVersion` / `ClearChat`，删掉 `SaveChat`：组内 **4 → 7**、全库 **91 → 94**，**分组数仍是 11**）。
- **角色库这 4 条是本项目第一次「一个功能加一批频道」而不是加 1 条**：`shared/ipc.ts`（`Project` 组 +4）→ `src/preload/index.ts`（方法全挂在**既有** `projectTools` 命名空间下，**命名空间数不变，仍是 12 个**）→ `src/main/projects.ts`（四个 `ipcMain.handle`）。组内 **26 → 30**、全库 **94 → 98**、分组数仍是 **11**。**为什么不并为一条频道**：四个动作的语义与失败方式各不相同（列库要有 `missing` 标记、导入要合并角色表并重写骨架、从库删不能碰项目），并成一条只会让三个参数互相打架；而 preload 侧不新增命名空间，所以界面调用的形状没有变复杂。
- **`Script` 分组是三处齐改的又一实例**：`shared/ipc.ts` 加 `Script.Generate` / `Script.Progress`（后加 `LoadChat` / `SaveChat`，后来换成 `AppendRound` / `ReadVersion` / `SetActiveVersion` / `ClearChat`）→ `src/main/agent/script.ts` 的 `registerScript(getProjectDir)` 挂对应 `ipcMain.handle(IPC.Script.…)` 并 `event.sender.send(IPC.Script.Progress, …)`（对话记录的文件读写下沉到 `src/main/agent/chatLog.ts`）→ `src/preload/index.ts` 加 `scriptTools` 七个方法；同时 `src/shared/types.ts` 补 ⑥ 节 `ScriptGeneratePayload` / `ScriptGenerateReply` / `ScriptChatRoundMeta` / `ScriptChatIndex` / `ScriptVersionResult` / `ScriptAppendRoundPayload`、⑧ 节 `ScriptProgressPayload`、⑨ 节 `PreloadApi.scriptTools`。**生成与 `project:*` 的分界是「只造文本、不碰文件」**：`script:generate` 不写 `content.json`（落盘由渲染层自动保存调 `project:save-content`）；**对话记录确实写文件，但只碰自己那个 `chat/` 目录**（索引 + 每版副本），与项目索引 / 正文完全无关。
- **命名不再完全对齐**：`Window.*` 用 `window:` 前缀、`Video.OpenHtml` 却用 `dialog:open-html` 前缀，属历史遗留，**不可"顺手统一"**，因为字符串就是协议本身。
- **新增频道需三处齐改**：本文件加常量 → `src/main/*.ts` 注册 handler（载荷用 `shared/types.ts` 的 `*Payload` 标注）→ `src/preload/index.ts` 绑定方法，并在 `src/shared/types.ts` ⑨ 节 `PreloadApi` 补签名（`src/preload/index.d.ts` 只做 `extends`，无需改动）。`legacy:status` / `legacy:resolve`、运行环境分包的 `Runtime.Cancel` 与 `Settings.PickRuntimePack`、角色库的 4 条、以及项目角色的 `project:new-cast` / `project:save-cast` 都是这条流程的实例（其中 `app:open-external` 曾按同法加过，又在 `909526c` 按「摘除未经同意的按钮」整条三处一起删掉——**加与删都要走齐三处**）。
- **往 `IpcFail` 加字段不必改 preload**：preload 只是 `ipcRenderer.invoke` 转发、原样返回主进程对象，因此 `IpcFail` 新增的 `needConfig` / `title` 与 preload 无关（改动只落在 `src/shared/types.ts` 的声明与主进程/渲染层的读写上）。
- **`Update.OpenLog` 的位置与语义**（2026-10 新增）：它排在 `Status` 与 `Progress` 之间，值 `update:open-log`。主进程侧刻意**不经过** `ensureUpdater()`——更新失败时最常见的场景恰恰是 electron-updater 没加载起来，若把它挂在懒加载之后，最需要看日志的时候反而打不开日志。
- **`Update.Status` 的位置与语义**（2026-10 新增）：它排在 `Version` 之后、`OpenLog` 之前，值 `update:status`，`ipcMain.handle(IPC.Update.Status, () => payload())`。存在的理由：启动静默检查发生在设置页订阅 `update:progress` 之前，没有这条通道渲染层只会看到 `idle`。主进程 `state` 常驻，设置页每次挂载都能拉到当前状态；它与 `OpenLog` 一样不进 `ensureUpdater()`。
- **`Project.SetCanvas` 的位置与语义**：它排在 `SetRender` 之后、`PickAudio` 之前，值 `project:set-canvas`，`ipcMain.handle(IPC.Project.SetCanvas, …)`（`src/main/projects.ts`）。它是**成片画布方向**，属**项目属性而非渲染档位**——不写进 `settings.json`、没有「全局默认 → 项目覆盖」那套层级，只在「HTML生成」页生成侧的「画布」下拉里选一次，落进 `project.json` 的 `canvas`，并由同一个值决定生成提示词的版式尺寸、预览 iframe 的画布与渲染入口写入的 **舞台 `data-width`/`data-height`（成片宽高真正来源）+ `<html data-resolution>`（页面自描述，渲染链路不读）**。白名单来自 `shared/constants.ts` 的 `RENDER_CANVASES`（`landscape` / `portrait` / `square`），非法值回 `{ ok:false, message:'画布取值非法' }`、缺项目名回 `缺少项目名`；值变化时把已有的 `videoPath` 置空（尺寸变了，旧成片不再代表当前产物）。
- **`Project.CastLibrary` 等 4 条的位置与语义**（全局角色库那一轮新增）：它们排在 `SaveHtml` 之后、`Project.HtmlProgress` 之前（推送频道放在组末的惯例不变）。四条的载荷都极窄——`CastLibrary` 无载荷、`PromoteCast` 是 `{ name, id }`、`ImportCast` 是 `{ name, ids }`、`RemoveCastFromLibrary` 只有 `{ id }`（库里删东西不需要项目名：库是应用级的）。**它们不产生任何 app 状态之外的东西**：`ImportCast` 成功后回 `ProjectCastResult`（`{ ok, message, cast }`），渲染层据此原地刷新 `appState.project`，不必整份重载项目。
- **本轮加的 2 条是「项目角色」而不是「角色库」，位置紧跟那 4 条之后**：`Project.NewCast`（`project:new-cast`）与 `Project.SaveCast`（`project:save-cast`）排在 `RemoveCastFromLibrary` 之后、`Project.HtmlProgress` 之前，组内 **30 → 32**、全库 **98 → 100**、分组数仍是 **11**、preload 命名空间仍是 **12** 个（两个方法都挂在既有 `projectTools` 下）。源码里这一对上方有一行分组注释把语义写死：「项目角色（角色是**项目资产**，与单文件 / 章节化无关）：`NewCast` = 手动新建一个角色（调一次模型画 `cast/<id>.js`），`SaveCast` = 整份角色表回写（勾选 / 删除 / 改名）」。**为什么是两条而不是一条**：新建要调模型、要生成代码文件，回写是纯数据操作（与 `project:save-materials` 同语义），失败方式与耗时完全不同。
- **`Update.Changelog` 的位置与语义**：它排在 `OpenLog` 之后、`Progress` 之前，值 `update:changelog`，`ipcMain.handle(IPC.Update.Changelog, () => readBundledChangelog())`（`readBundledChangelog()` 在 `src/main/updater/base.ts`）。主进程**只定位并读文件**（`path.join(app.getAppPath(), 'CHANGELOG.md')`，dev = 项目根、打包后 = asar 根，两种形态同一份路径逻辑），失败回 `{ ok: false, message, detail }`；**解析与排版一律在渲染层**（`src/renderer/src/utils/changelog.ts`）。与 `OpenLog` / `Status` 一样**刻意不进 `ensureUpdater()`**：看日志与更新器能否加载无关。消费方是设置页「应用更新」的「查看更新日志」按钮与其弹窗 `ChangelogDialog.vue`。
- **分组名 ≠ 文件名**：`Settings` 对应 `settings.ts`、`Video` 对应 `video.ts`、**`Script` 对应 `agent/script.ts`**；`App` 分组实际由 `src/main/index.ts` 处理、`Voice` 分组横跨 `voice.ts` 与 `ttsAlign.ts`、**`Legacy` 分组也由 `src/main/index.ts` 处理**（与 `App` 同理）。
- **`as const` 后不可写**：所有属性为只读，运行时尝试 `IPC.Window.Close = 'x'` 在严格模式下会抛错。
- **`IpcChannel` 粒度提示**：如上文所述它是"分组对象"的并集，误当作"频道字符串联合"使用会得到过于宽泛的类型。
- **零运行时开销**：常量会被打包器内联，主进程与 preload 各自持有自己的副本，不存在跨进程共享对象。
