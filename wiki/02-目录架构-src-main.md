# 02 · 目录架构：`src/main/`（主进程）

> 主进程是整个应用的能力中心：窗口与生命周期、文件系统、外部程序调用（whisper / ffmpeg / HyperFrames）、全部网络请求（Qwen-TTS / 自定义模型 / 模型下载）以及 60 余个 IPC 频道的实现，全部集中在这个目录。

---

## 1. 文件清单

| 文件 | 行数 | 角色 | 注册的 IPC 域 |
|---|---|---|---|
| [index.ts](./files/main/index.ts.md) | 166 | **入口装配器**：生命周期、窗口、`hgpreview://` 协议、窗口控制与剪贴板 IPC | `window:*`、`app:copy-text` |
| [hfEnv.ts](./files/main/hfEnv.ts.md) | 138 | 环境探测与内置依赖定位（纯函数，不注册 IPC） | — |
| [settings.ts](./files/main/settings.ts.md) | 172 | 设置存储（`userData/settings.json`） | `settings:get/save/test` |
| [systemVoices.ts](./files/main/systemVoices.ts.md) | 63 | Qwen-TTS 内置系统音色静态表 | — |
| [htmlAgent.ts](./files/main/htmlAgent.ts.md) | 246 | 自定义模型 Agent：流式生成/修改 HTML（不注册 IPC，被 projects 调用） | — |
| [projects.ts](./files/main/projects.ts.md) | 731 | 项目化流水线：`project.json`、字幕、内容脚本、HTML、音视频产物（项目结构再导出 `shared/types`） | `project:*`（24 handle + 1 推送） |
| [voice.ts](./files/main/voice.ts.md) | 533 | 千问语音：音色管理 + 文字生音频 | `voice:*`（15） |
| [ttsAlign.ts](./files/main/ttsAlign.ts.md) | 332 | 字幕配音逐句合成与时间对齐（模式 A/B） | `voice:synth-aligned`、`voice:align-cancel`、`voice:align-progress` |
| [video.ts](./files/main/video.ts.md) | 187 | HTML 预览外壳 + HyperFrames 转视频 | `dialog:open-html`、`video:*` |
| [whisper.ts](./files/main/whisper.ts.md) | 704 | whisper.cpp 转录 + 识别模型下载/管理 | `whisper:*`（11 handle + 1 推送） |
| [vad.ts](./files/main/vad.ts.md) | 122 | WAV 采样读取与静音裁剪（零依赖纯函数） | — |

---

## 2. 装配模式：`register(ctx)`

所有业务域模块都导出统一的 `register(ctx?: RegisterCtx)` 函数，由入口在窗口创建后依次调用：

```ts
// src/main/index.ts
const ctx: RegisterCtx = { getWindow }        // getWindow: () => BrowserWindow | null
settings.register(ctx)
projects.register(ctx)
voice.register(ctx)
ttsAlign.register(ctx)
video.register(ctx)
whisper.register(ctx)
```

- `RegisterCtx`（`src/shared/types.ts`）只提供一个能力：拿到主窗口引用，使各域的 `dialog.showOpenDialog` / `showSaveDialog` 以主窗口为父，弹出模态对话框而非游离窗口。
- `register` 是各域**唯一**的 IPC 注册入口：域内的 `ipcMain.handle` / `ipcMain.on` 全部集中在这一个函数体内，便于审阅整个域对外的接口面。
- `index.ts` 自身不属于该模式，它直接注册窗口控制与剪贴板频道。

---

## 3. 模块依赖图（无环）

```
settings ──→ htmlAgent ──→ projects ──→ voice ──→ ttsAlign
                                     ↗
hfEnv ──→ video / whisper / ttsAlign / projects
vad   ──→ whisper
systemVoices ──→ voice
shared/{ipc,types} ──→ 全部模块（仅常量与类型）
```

| 依赖边 | 具体协作点 |
|---|---|
| `voice → projects` | 复用 `copyAudioIntoProject()` 把合成音频复制进项目 `audio/` 并写 `project.json` |
| `ttsAlign → voice` | 复用 `synthOne()`（单句合成）、`resolveVoiceModel()`（音色→模型解析）、`voiceFriendlyError()`（错误友好化） |
| `whisper → vad` | 转录前用 `vadTrimSegments()` 裁掉起止静音；用 `toVadSamples()`（走 `hfEnv` 的 ffmpeg）统一采样率 |
| `whisper / ttsAlign / video / projects → hfEnv` | 定位 CLI、Node 绝对路径、FFmpeg bin、chrome-headless-shell，以及 `isHyperframesComposition()` 合规校验 |
| `projects → htmlAgent` | `project:generate-html` / `project:modify-html` 调用 `chatWithCustomModel()`，并把 `onProgress` 映射为阶段文案推送给渲染层 |
| `voice / whisper / htmlAgent → settings` | 读取 API Key、目标模型、当前识别模型与自定义模型列表；写回配置 |

`src/main/index.ts` 顶部的注释即为这份依赖图的权威描述（`settings ← htmlAgent ← projects ← voice ← ttsAlign`；`hfEnv ← video`；无环）。

---

## 4. 各模块职责

### 4.1 `index.ts` —— 入口装配器

- **协议特权**：`app` ready **之前**调用 `protocol.registerSchemesAsPrivileged([{ scheme: 'hgpreview', privileges: { standard, secure, supportFetchAPI, stream } }])`；ready 之后 `protocol.handle('hgpreview', …)` 把 `hgpreview://p/<encodeURIComponent(项目名)>/<相对路径>` 映射回 `userData/projects/<项目名>/` 内的文件。
  - 目录穿越防护：`path.resolve` 后必须等于项目目录或以 `项目目录 + path.sep` 开头，否则 403。
  - 直接读字节构造 `Response`（`net.fetch(file://)` 在协议处理器内有兼容问题，会导致预览空白），MIME 由 `previewMime()` 的扩展名表显式给出，`Cache-Control: no-store`。
  - 失败路径写入 `userData/preview-protocol.log` 便于排查。
- **窗口**：单窗口 `1200×800`（最小 `800×600`）、`titleBarStyle: 'hidden'`、`Menu.setApplicationMenu(null)`、`contextIsolation: true` / `nodeIntegration: false`、preload 指向 `../preload/index.js`；dev 走 `process.env.ELECTRON_RENDERER_URL`，prod 走 `loadFile('../renderer/index.html')`。
- **IPC**：`window:minimize` / `window:toggle-maximize` / `window:close`（`on`），`app:copy-text`（`handle`，渲染层 sandbox 无 clipboard 模块），最大化状态经 `window:maximized-change` 回推。

### 4.2 `hfEnv.ts` —— 环境探测与资源定位（纯函数）

- 汇总 `BUILTIN_RESOURCES`：资源根在打包态取 `process.resourcesPath`、开发态取 `path.join(app.getAppPath(), 'resources')`，据此派生 node / ffmpegBin / ffmpeg / ffprobe / HyperFrames CLI / chrome-headless-shell 等路径。
- 定位函数均为**多候选回退**：
  - Node：`NVM_SYMLINK` → `LOCALAPPDATA\nvm\nodejs` → `C:\Program Files\nodejs` → `where.exe`，逐个 `spawnSync -v` 校验 `status === 0`；内置 `resources/node/node.exe` 优先（版本下限判断只作用于系统 Node）。之所以要解析**绝对路径**，是为了规避 nvm shim / WindowsApps alias 下 `spawn('node')` 不稳定的问题。
  - FFmpeg：遍历 WinGet 安装目录下的 `Gyan.FFmpeg*` → `*full_build*` → `bin\ffmpeg.exe`。
  - HyperFrames CLI：内置路径优先，其次环境变量 `HYPERFRAMES_CLI`。
- `isHyperframesComposition(raw)`：转视频前的合规校验（`data-composition-id` 与 GSAP `__timelines` 结构等正则同时命中才算合法）。

### 4.3 `settings.ts` —— 设置存储

- `userData/settings.json`，四分区：`customModel`（`baseUrl` / `modelId` / `apiKey` / `enabled`）、`voiceTTS`（`apiKey` / `targetModel` / `saveDir`）、`voiceProfiles`（本地音色映射，key 形如 `system:Cherry` / `custom:<voice_id>`）、`whisper`（`modelId` + `customModels[]`）。
- `readSettings()` 做**逐分区浅合并**并静默容错（文件缺失/损坏回落到默认值）；写盘为整体覆盖。
- `settings:test` 的成功判定刻意严格：配置三项非空后发起一次极小的 `chat.completions` 请求，**必须拿到模型返回的文本内容**才算连接成功，避免把「接口通了但模型不产出」误判为可用。
- API Key 明文保存在本机 `userData/settings.json`，不经 IPC 外传。

### 4.4 `systemVoices.ts` —— 系统音色表

- `SYSTEM_VOICES` 共 48 条，字段 `{ voice, desc, langs, series }`；`series` 取值组合覆盖 `instruct-flash` / `flash` / `tts`（`flash` 为全量系列）。
- `isSystemVoice()` 精确全等匹配（大小写敏感）。
- 与 `voice.ts` 四处配合：默认模型推断（`instruct-flash > flash > tts`）、`voice:list-system-voices` 输出附带 `model`、`voice:list-all` 生成 `key = 'system:' + voice` 条目，以及渲染层音色管理的回退组装。

### 4.5 `htmlAgent.ts` —— 自定义模型 Agent

- 导出 `chatWithCustomModel` 与进度类型（`AgentProgress` 现在是 `src/shared/types.ts` 的 `HtmlAgentProgress` 的类型别名，导出名不变）；核心在**两条等价的流式路径**：优先用 `openai` SDK（`stream: true`），失败回退直接 `fetch ${baseUrl}/chat/completions` 并手写 SSE 解析。
- 关键设计：
  - 系统提示词约束「输出完整、独立、符合 HyperFrames composition 规范的 HTML」，回复中的 HTML 由 `extractHtmlFromReply()` 提取（兼容 Markdown 代码块包裹）。
  - `reasoning_content`（思考）与 `content`（输出）分离统计；`onProgress` 按 `connecting / thinking / writing / retry / done` 分阶段回调。
  - 推理模型可能把 `max_tokens` 全耗在思考上导致 `content` 为空且 `finish_reason === 'length'`，此时按 `32768 → 65536` 自动升档重试，仍无内容则抛出带 `usage` 的诊断错误。
  - 每次会话（含每档尝试的思考原文、输出、`finish_reason`、`usage`、各阶段耗时）追加写入 `userData/html-agent/chat.jsonl`；记录失败静默忽略，不影响主流程。

### 4.6 `projects.ts` —— 项目化流水线（最大模块）

- 项目实体：`userData/projects/<项目名>/`，元数据 `project.json`（`title` / `subtitle` / `subtitleCount` / `content` / `audioFile` / `videoMaterial` / `htmlPath` / `videoPath` / `createdAt` / `updatedAt`），旁挂 `subtitle.txt`、`index.html`、`index.preview.html`、`audio/`、`video/`。
- 对外能力（24 个 `handle` + 1 个推送）：项目 list / create / load / delete、字幕保存、内容脚本保存、HTML 生成 / 修改 / 读取 / 保存 / 预览 / 下载、任意产物导出、SRT 导出、项目目录与文件所在目录打开、音频与视频素材的挑选 / 设置 / 清除、从视频提取音轨、视频产物回写。
- 关键内部设施：`projectDir()`（路径派生的唯一入口，也被 `hgpreview` 协议使用）、`parseSubtitle()`（解析 `[分:秒] 文本` 与纯文本行并统计条目数）、`normalizeContent()`（内容脚本字段兼容）、`scanProjects()`（列表与 `has*` 标记）、`buildContentBlock()` / `buildMaterialPrompt()`（拼装 Agent 提示词）、预览副本注入脚本 `HG_PREVIEW_CTRL`、`progressText()`（Agent 进度 → 中文阶段文案）。
- 写 HTML 成功后会把**失效的旧视频产物置空**，并做 HyperFrames 合规校验，返回 `compatible` 供 UI 提示。

### 4.7 `voice.ts` —— 千问语音

- 导出 `register()`，并向 `ttsAlign.ts` 暴露可复用的单句合成与解析能力。
- 音色克隆按目标模型**自动切换输入方式**：`qwen-audio-*`（Qwen-Audio-TTS）走「粘贴音频 URL」，`qwen3-tts-vc-*` 走「上传本地文件」；请求分支覆盖 `action=create_voice` / `create`、`model=voice-enrollment` / `qwen-voice-enrollment`、`prefix` / `preferred_name`、`audio.url` / `audio.data`；直传音频失败时有专用回退（`fallback_mode` / `fallback_reason`）。
- 音色解析三级优先：本地映射 `voiceProfiles`（`system:X` / `custom:X`）→ 系统音色默认模型 → 内置默认模型。
- 文字生音频 `voice:synth` 支持三种落盘位置（项目 `audio/`、自定义目录、音频输出目录），回执 `savedTo` 说明实际落点；`voice:list-generated` 按来源（音频输出目录 / 自定义目录 / 项目）分组列出历史音频。
- 所有网络错误经 `voiceFriendlyError()` 转成中文可读提示。

### 4.8 `ttsAlign.ts` —— 字幕配音与时间对齐

- 两种模式（详见 [01-架构总览 §5.4](./01-架构总览.md)）：
  - **模式 A（音频驱动）**：以每句实测时长重建时间线（音频不变速），停顿按「字幕原间隔 − 前句时长」推算，放不下才回落到 `gapSec`（默认 0.5，夹在 `[0,10]`）。
  - **模式 B（时间轴驱动）**：以字幕时间戳为槽位，先做单调化（相邻至少 `MIN_SLOT = 0.1s`），溢出时 `atempo` 加速（上限 `MAX_RATE = 1.15`）并重测时长，顶格仍放不下则顺延后续句子。
- 共同设施：逐句 TTS → 24 kHz 单声道 `pcm_s16le` WAV → `ffprobe` 量时长；`buildTrack()` 用静音补齐（差值 > 0.02s）+ `concat -c copy` 零重编码装配整轨，末尾做 ±0.3s 时长终验。
- 进度经 `voice:align-progress` 回推（`synth` / `assemble` / `done` / `error`），`voice:align-cancel` 可中断；旧任务目录按策略清理。

### 4.9 `video.ts` —— 预览与转视频

- 频道：`dialog:open-html`、`video:list-projects`（内置示例项目）、`video:preview-shell`、`video:render`、`video:show-in-folder`，以及推送 `video:progress`。
- 预览外壳：生成 `_hf_preview_shell.html`（本地 hivePlayer 优先、CDN 兜底）。
- 渲染流程：合规校验 → `findHyperframesCli()` / `resolveNodePath()` → 建工作目录 `userData/hf-projects/html-video-<时间戳>/` 并整体复制素材 → 注入环境（FFmpeg bin 进 `PATH`，另设 `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` / `PRODUCER_HEADLESS_SHELL_PATH`）→ `spawn node <hf-cli> render -o output.mp4` → stdout/stderr 经 `video:progress` 实时回推 → 进程 `close` 判定成功并返回输出路径。
- 产物回写由渲染层经 `project:save-video` 完成（主进程 `video.ts` 不写 `project.json`）。

### 4.10 `whisper.ts` —— 本地转录与模型管理

- **内置模型档位 4 个**（`id` / 文件 / 体积）：`tiny-q8_0` / `ggml-tiny-q8_0.bin`、`base` / `ggml-base.bin`、`base-q5_1` / `ggml-base-q5_1.bin`、`small-q8_0` / `ggml-small-q8_0.bin`；下载走国内镜像 `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/`。
- 模型目录 `userData/whisper/models/`；CLI 路径由 `resolveCliPath()` 定位（打包态 `resources/whisper/`，开发态项目 `resources/whisper/`）。
- **`id ↔ 文件名` 严格对应**：只认登记名，不做前缀或模糊归属（`base` 与 `base-q5_1` 相互独立）；枚举外的文件列为「未知模型」，引导用户「添加自定义模型」（持久化在 `settings.json` 的 `whisper.customModels`）。
- 下载策略：边下边写 `.part`、进度节流回推 `whisper:progress`、完成后原子 `rename`、失败清理残片。
- 转录链路：`prepareAudio()`（whisper 不能直接解码的格式先用内置 ffmpeg 转 wav，临时文件用后清理）→ VAD 起止静音裁剪 → `spawn whisper-cli.exe`（`-m 模型 -f 音频 -oj JSON --no-prints -pp`）→ 解析 JSON 的 `transcription.segments` → `opencc-js` 繁转简 → 转成 `[分:秒] 文本`。**不直接写项目文件**，由渲染层弹窗「替换现有 / 追加到末尾」后经 `project:save-subtitle` 落盘。
- 进度两阶段：spawn 后先报「正在加载模型」（不确定态进度条），从 stderr 解析到 `progress = N%` 后进入「转录中 N%」。

### 4.11 `vad.ts` —— 纯函数 VAD

- `readWavSamples()`：解析 16 bit PCM WAV（RIFF/WAVE，chunk 遍历含奇数长度补位、`dataLen` 截断、返回 `Int16Array` 交错样本）；无法识别时返回 `null`。
- `vadTrimSegments(samples, rate, segs)`：基于 20 ms 窗口的噪声底分位与阈值（`thr = max(noiseFloor*3, 200)`）做前后静音裁剪，并用 `leadSilWin 0.4s` / `tailSilWin 0.15s` / `padSec 0.1` / `minDur 0.25` 等参数修正边界，四类异常输入原样返回。
- 之所以拆成独立文件：**零依赖、纯函数、只用类型标注**（不用 `enum` / `namespace` / 构造函数参数属性等需要运行时转换的语法），便于被 `whisper.ts` 复用与单独审阅。

---

## 5. 目录内的通用实现约定

1. **spawn 样板统一**：`child_process.spawn` + `windowsHide: true` + Promise 包装（`runProc` 等），参数以数组传递、不经 shell。
2. **外部依赖只从 `resources/` 取**：一切外部可执行文件都经 `hfEnv.ts` / `resolveCliPath()` 定位，不假设系统已安装（FFmpeg 允许回退到 WinGet 安装位置）。
3. **返回约定**：业务接口统一 `{ ok: true, ... }` / `{ ok: false, message, canceled? }`；查询类可返回数组或 `null`。
4. **进度回推节流**：下载与转录的高频进度按时间/百分比节流后再 `webContents.send`，避免刷爆 IPC。
5. **路径安全**：所有项目内路径由 `projectDir()` 派生并做前缀校验；临时产物集中在 `userData` 下的工作目录或系统临时目录，用后清理。
6. **持久化边界**：只有 `settings.ts` 与 `projects.ts` 直接写盘；其余模块通过它们落盘（如 `video.ts` 不回写 `project.json`，由渲染层调 `project:save-video`）。
7. **载荷 / 结果类型全部来自 `src/shared/types.ts`**：`src/main/` 下已无本地声明的 payload / result / progress 接口，各 handler 的 `payload` 参数统一标注共享层的 `*Payload`（如 `ProjectAgentPayload`、`WhisperTranscribePayload`、`VoiceSynthPayload`），进度推送统一用 `HtmlProgressPayload` / `WhisperProgressPayload` / `AlignProgressPayload`；项目结构类型（`Scene` / `ContentScript` / `Project` / `SubtitleLine`）由 `projects.ts` 再导出。

---

## 6. 相关文档

- 逐文件说明：[files/main/](./files/main/)
- 桥接层：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- IPC 契约全貌：[01-架构总览.md](./01-架构总览.md) 第 3 节
