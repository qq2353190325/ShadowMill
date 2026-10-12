# src/shared/ipc.ts

> 三端共享的 IPC 频道名常量表，九个命名空间的唯一真源

- **所在目录**：`src/shared/`
- **类型**：共享常量（含派生类型）
- **规模**：109 行
- **对外导出**：`IPC`（`as const` 常量对象，含 Window / App / Update / Settings / Voice / Whisper / Project / Video 八个分组）、`IpcChannel`（频道字面量联合类型）

## 1. 作用与职责

本文件是项目中**所有跨进程通信频道名的唯一定义处**。它不注册也不调用任何 IPC，只提供字符串常量：

1. 消除主进程 `ipcMain.handle` / `ipcMain.on` 与 preload `ipcRenderer.invoke` / `send` / `on` 之间的"手写字符串魔数"重复 —— 两侧都 `import { IPC }`，拼写错误在编译期就能被发现。
2. 用 `as const` 冻结字面量类型，再由 `IpcChannel` 派生出全部频道名的联合类型，可用于类型收窄或工具函数签名。
3. 通过分组（Window / App / Update / Settings / Voice / Whisper / Project / Video）让"哪个进程模块负责哪批频道"一目了然：分组名与 `src/main/*.ts` 的文件职责基本对应。

文件首行注释明确了硬约束：**频道名与现行实现逐一对应，禁止改动**。preload 的 9 个命名空间与渲染层全部调用都依赖这些字符串，任何一个字符的改动都会导致 invoke 无响应（`ipcMain.handle` 未命中时 Promise 会抛 "No handler registered"）。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `IPC` | `const` 对象（`as const`） | 八个分组的嵌套常量表，值为普通字符串字面量 |
| `IpcChannel` | `export type` | `(typeof IPC)[keyof typeof IPC]`，即八个分组对象类型的并集（注意：类型粒度为"分组对象"，而非单个频道字符串） |

### 2.1 Window 分组（窗口控制 + 状态回推）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Window.Minimize` | `window:minimize` | renderer → main，`send`，最小化窗口 |
| `Window.ToggleMaximize` | `window:toggle-maximize` | renderer → main，`send`，最大化/还原切换 |
| `Window.Close` | `window:close` | renderer → main，`send`，关闭窗口 |
| `Window.MaximizedChange` | `window:maximized-change` | main → renderer，推送最大化状态，供自绘标题栏切换图标 |

### 2.2 App 分组（应用级小工具）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `App.CopyText` | `app:copy-text` | renderer → main，`invoke`，由主进程写剪贴板（sandbox 下渲染层无 clipboard 模块） |

### 2.3 Settings 分组（settings.js / settings.ts）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Settings.Get` | `settings:get` | 读取 `AppSettings`（含 customModel / voiceTTS / voiceProfiles / whisper / render / updater） |
| `Settings.Save` | `settings:save` | 保存自定义模型配置（OpenAI 兼容端点） |
| `Settings.SaveRender` | `settings:save-render` | 保存视频渲染**默认档位**（只更新 `render` 段，不动 customModel） |
| `Settings.SaveUpdater` | `settings:save-updater` | 保存**更新设置**（只更新 `updater` 段：`feedUrl` / `autoCheck` / `skippedVersion`） |
| `Settings.Test` | `settings:test` | 用给定 `CustomModelConfig` 发起一次连通性测试 |

### 2.4 Update 分组（updater.ts，应用自更新）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Update.Check` | `update:check` | renderer → main，`invoke`，检查更新（读更新源 `latest.yml`） |
| `Update.Download` | `update:download` | renderer → main，`invoke`，下载安装包（`autoDownload = false`，仅用户触发） |
| `Update.Cancel` | `update:cancel` | renderer → main，`invoke`，取消下载 |
| `Update.Install` | `update:install` | renderer → main，`invoke`，退出并运行安装器 |
| `Update.Version` | `update:version` | renderer → main，**`sendSync`（全工程唯一的同步频道）**，只回当前版本号字符串 |
| `Update.OpenLog` | `update:open-log` | renderer → main，`invoke`，定位 `userData/updater.log`（排障出口，**不依赖 electron-updater 是否加载成功**） |
| `Update.Progress` | `update:progress` | main → renderer，推送更新阶段 / 下载进度（`UpdateProgressPayload`，含 `message` / `detail`） |

### 2.5 Voice 分组（voice.js / ttsAlign.js）

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Voice.GetConfig` | `voice:get-config` | 取 apiKey / targetModel / saveDir |
| `Voice.GetSaveDir` | `voice:get-save-dir` | 解析本次合成的落盘目录（支持项目目录 / 自定义目录 / 默认输出目录） |
| `Voice.SaveConfig` | `voice:save-config` | 保存 `Partial<VoiceTTSConfig>` |
| `Voice.PickAudio` | `voice:pick-audio` | 弹出文件框选择音色样本音频 |
| `Voice.Create` | `voice:create` | 用样本音频克隆音色，返回 voice_id |
| `Voice.ListSystemVoices` | `voice:list-system-voices` | 列出 Qwen-TTS 系统音色 |
| `Voice.ListModels` | `voice:list-models` | 列出可用 TTS 模型 |
| `Voice.GetProfiles` | `voice:get-profiles` | 读取本地音色映射 `Record<string, VoiceProfile>` |
| `Voice.SaveProfile` | `voice:save-profile` | 保存单个音色映射 |
| `Voice.DeleteProfile` | `voice:delete-profile` | 按 key 删除音色映射 |
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

| 常量 | 频道名 | 用途 |
| --- | --- | --- |
| `Project.List` | `project:list` | 项目列表（含 hasSubtitle / hasHtml / hasVideo / subtitleCount / updatedAt） |
| `Project.Create` | `project:create` | 新建项目（参数为裸字符串 `name`） |
| `Project.Load` | `project:load` | 读取项目元数据与内容 |
| `Project.SaveSubtitle` | `project:save-subtitle` | 保存字幕文本与标题 |
| `Project.SaveContent` | `project:save-content` | 保存内容（文案/结构化数据） |
| `Project.GenerateHtml` | `project:generate-html` | 调模型生成 HTML（带素材） |
| `Project.ModifyHtml` | `project:modify-html` | 调模型修改既有 HTML |
| `Project.DownloadHtml` | `project:download-html` | 导出 HTML 到用户选定位置 |
| `Project.ExportSrt` | `project:export-srt` | 导出 SRT 字幕文件 |
| `Project.OpenFolder` | `project:open-folder` | 打开项目目录（项目尚未落盘时提示「项目目录不存在（项目尚未保存）」） |
| `Project.OpenFolderOf` | `project:open-folder-of` | 打开某个绝对路径（文件或目录）所在目录 |
| `Project.Delete` | `project:delete` | 删除项目 |
| `Project.SaveVideo` | `project:save-video` | 把渲染产物视频路径写回项目 |
| `Project.SetRender` | `project:set-render` | 写 / 清除项目级渲染档位覆盖（`render` 传 `null` 即回到跟随全局默认） |
| `Project.PickAudio` | `project:pick-audio` | 选择项目音频 |
| `Project.SetAudio` | `project:set-audio` | 写入项目音频 |
| `Project.ClearAudio` | `project:clear-audio` | 清除项目音频 |
| `Project.PickVideo` | `project:pick-video` | 选择项目视频 |
| `Project.SetVideo` | `project:set-video` | 写入项目视频 |
| `Project.ClearVideo` | `project:clear-video` | 清除项目视频 |
| `Project.ExtractVideoAudio` | `project:extract-video-audio` | 从项目视频抽取音轨作为音频 |
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
| `src/main/index.ts` | `import { IPC } from '../shared/ipc'` |
| `src/main/settings.ts` | 同上 |
| `src/main/projects.ts` | 同上 |
| `src/main/voice.ts` | 同上 |
| `src/main/ttsAlign.ts` | 同上 |
| `src/main/whisper.ts` | 同上 |
| `src/main/video.ts` | 同上 |
| `src/preload/index.ts` | `import { IPC } from '../shared/ipc'`，逐方法绑定频道 |
| `tsconfig.web.json` | `include` 含 `"src/shared/**/*.ts"`，故渲染层也可直接引用 |

### 3.2 `as const` 与 `IpcChannel`

- `export const IPC = { ... } as const` 使每个属性成为**只读的字面量类型**（如 `'window:minimize'` 而非 `string`），赋值给其他变量时不会意外放宽。
- `export type IpcChannel = (typeof IPC)[keyof typeof IPC]`：TypeScript 中 `keyof typeof IPC` 得到 `'Window' | 'App' | 'Update' | 'Settings' | 'Voice' | 'Whisper' | 'Project' | 'Video'` 八个键，取 `[keyof ...]` 后得到的是**八个分组对象类型**的并集，而不是 76 个频道字符串字面量的并集。因此该别名适合"传一个分组对象"这类签名，并不适合用于"传单个频道名"的参数约束。

### 3.3 三种通道方向约定

| 方向 | 通道举例 | 典型注册方式 |
| --- | --- | --- |
| renderer → main（请求-响应） | `settings:get`、`project:list`、`voice:synth`、`update:open-log` | 主进程 `ipcMain.handle`，preload `invoke` |
| renderer → main（单向） | `window:minimize`、`voice:align-cancel` | 主进程 `ipcMain.on`，preload `send` |
| main → renderer（推送） | `window:maximized-change`、`video:progress`、`whisper:progress`、`voice:align-progress`、`project:html-progress` | 主进程 `win.webContents.send`，preload `on` |

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | 无 | 本文件零 import、零副作用，是纯常量模块 |
| 被 import | `src/main/` 7 个模块 | 全部 IPC 注册点 |
| 被 import | `src/preload/index.ts` | 全部 API 绑定点 |
| 被 include | `tsconfig.node.json` / `tsconfig.web.json` | 分别覆盖主进程/preload 与渲染层编译 |
| 类型被消费 | `IpcChannel` | 供需要约束频道名的工具函数使用 |

## 5. 注意事项与实现要点

- **禁止改动频道名字符串**：文件首行注释即写明"频道名与现行实现逐一对应，禁止改动"。改动会导致 `ipcMain.handle` 未命中，渲染层收到 `Error: No handler registered for 'xxx'`。
- **命名不再完全对齐**：`Window.*` 用 `window:` 前缀、`Video.OpenHtml` 却用 `dialog:open-html` 前缀，属历史遗留，**不可"顺手统一"**，因为字符串就是协议本身。
- **新增频道需四处同步**：本文件加常量 → `src/main/*.ts` 注册 handler（载荷用 `shared/types.ts` 的 `*Payload` 标注）→ `src/preload/index.ts` 绑定方法 → `src/shared/types.ts` ⑨ 节 `PreloadApi` 补签名（`src/preload/index.d.ts` 只做 `extends`，无需改动）。
- **`Update.OpenLog` 的位置与语义**（2026-10 新增）：它排在 `Version` 与 `Progress` 之间，值 `update:open-log`。主进程侧刻意**不经过** `ensureUpdater()`——更新失败时最常见的场景恰恰是 electron-updater 没加载起来，若把它挂在懒加载之后，最需要看日志的时候反而打不开日志。
- **分组名 ≠ 文件名**：`Settings` 对应 `settings.ts`，`Video` 对应 `video.ts`，`App` 分组实际由 `src/main/index.ts` 处理，`Voice` 分组横跨 `voice.ts` 与 `ttsAlign.ts`。
- **`as const` 后不可写**：所有属性为只读，运行时尝试 `IPC.Window.Close = 'x'` 在严格模式下会抛错。
- **`IpcChannel` 粒度提示**：如上文所述它是"分组对象"的并集，误当作"频道字符串联合"使用会得到过于宽泛的类型。
- **零运行时开销**：常量会被打包器内联，主进程与 preload 各自持有自己的副本，不存在跨进程共享对象。
