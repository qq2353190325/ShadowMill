---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_566161c2aff911f18874525400287e28
    ReservedCode1: n/C5UHkbt+XC6mkpM4VL9VQRQd3Dsoc+VZMHRkeuxPkaoSGJCTttJ/VxjAbsAfX0tg/SXnwD7YjPAQBajvZysJP/9v6lZdO+bUuF2cQaPPsZI+azcbIzv8Sdj84OVjS2y+uPuP7HC4KjfrB2KGVYFYWKmtFZR3OOcddmxIJ5i3grX3KOkEGru7E7hFI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_566161c2aff911f18874525400287e28
    ReservedCode2: n/C5UHkbt+XC6mkpM4VL9VQRQd3Dsoc+VZMHRkeuxPkaoSGJCTttJ/VxjAbsAfX0tg/SXnwD7YjPAQBajvZysJP/9v6lZdO+bUuF2cQaPPsZI+azcbIzv8Sdj84OVjS2y+uPuP7HC4KjfrB2KGVYFYWKmtFZR3OOcddmxIJ5i3grX3KOkEGru7E7hFI=
---



# 我的（My）—— 一站式音视频创作流水线

一个基于 Electron 的桌面应用，以「项目」为粒度，把 **音色管理 → 文字生音频 → 文字转字幕 → 字幕生成 HTML → 转成视频** 五个创作节点串联成一条完整流水线。每个项目对应一个本地目录，字幕既可由脚本旁白生成，也可用**内置 whisper.cpp 在本机把音频转录成字幕**（本地 CPU 推理，不消耗 API 额度）。

---

## 一、项目功能

- **项目化管理**：所有创作围绕一个「项目」实体进行，每个项目对应一个目录，统一存放字幕、HTML、音频、视频产物；可在首页或各页顶部「新建项目」直接创建并切换，首页「我的项目」卡片按 `HTML✓ / 视频✓ / 字幕✓` 标注各项目进度；内置示例项目放在 `video-projects`（只读）。
- **内容脚本**：为项目编写全局视觉风格与场景分镜（旁白 + 画面分镜 + 时长提示），作为配音、字幕与 HTML 生成共用的内容源。
- **音色管理**：接入千问AI平台 Qwen-TTS，上传 / 粘贴人声音频即可创建克隆音色；按目标模型自动切换输入方式（qwen-audio-* 粘贴音频 URL、qwen3-tts-vc-* 上传本地文件），并支持本地中文显示名与绑定模型映射管理。
- **文字生音频**：选择音色按绑定模型合成自然语音，保存到项目 `audio/` 或自定义保存目录；合成结果可试听、可一键设为当前项目背景音频。
- **文字转字幕**：以条目列表编辑字幕（增删改、时间轴自动接续、保存即落盘），支持两种格式混用：
  - 纯文本行：自动按语速估算时长；
  - `[分:秒] 文本`：指定时间轴（如 `[00:05] 大家好`），转视频后精确对齐。
  - 还可「由脚本旁白生成」，按内容脚本的场景旁白与时长提示批量生成条目。
- **从音频生成字幕（语音识别转录）**：把**项目音频或任意本地音频**一键转录成带时间轴的字幕。转录在本机 CPU 完成，不消耗 API 额度；支持自动检测 / 中文 / English；完成后可选「替换现有」或「追加到末尾」回填条目，并自动保存到项目。
- **语音识别模型管理**：「设置 → 语音识别模型」内置四档 whisper.cpp 模型，一键下载（走国内镜像）、删除文件、设为当前使用，并统计各模型本地占用空间；亦可**添加自定义模型**（名称 / 文件名 / 下载地址 / 体积 / 说明），模型目录中未登记的文件会自动列出并引导纳入管理。
- **字幕生成 HTML（Agent 接口）**：把内容脚本与字幕渲染成精美的 HTML 动画页面。生成与修改均通过**提示词输入框**提交需求，由**自定义模型 Agent**（OpenAI 兼容接口，流式对话）完成，应用侧不内置模板；生成过程实时显示阶段进度与 **AI 思考过程**原文。
- **HTML 预览**：HTML 生成页内嵌 iframe 实时预览；「视频生成」页同样可预览项目 HTML 并一键转视频。
- **背景音频**：可选为本项目配置一首背景音乐，Agent 生成 HTML 时会注入为音轨（在索引 `audio/` 下），预览即可听，转视频时自动混入声音。
- **下载 HTML**：一键把项目当前的 `index.html` 导出到本地任意位置。
- **转成视频**：复用项目内 HTML，调用 HyperFrames CLI 在后台渲染为 MP4，渲染完成后直接在页面内播放，并支持「在文件夹中显示」定位产物。
- **链路状态条**：顶部 step-bar 实时显示五个节点（音色管理 → 文字生音频 → 文字转字幕 → 字幕生成 HTML → 转成视频）的完成进度，已完成节点自动点亮，点击可跳转对应页面。

---

## 二、主要实现

### 2.1 技术栈与架构

- **Electron + 原生前端**（HTML / CSS / JS），无第三方 UI 框架。
- 主进程 `main.js`：装配各业务模块并注册 IPC；`src/main/` 下按职责划分：`settings.js`（设置存储）、`voice.js`（千问语音）、`projects.js`（项目化流水线）、`htmlAgent.js`（自定义模型 Agent）、`video.js`（HyperFrames 转视频）、`whisper.js`（whisper.cpp 字幕转录与模型管理）、`hfEnv.js`（环境探测与内置资源定位）、`systemVoices.js`（内置系统音色表）。
- 预加载脚本 `preload.js`：通过 `contextBridge` 安全暴露 API：
  - `projectTools` —— 项目化流水线（list / create / load / saveSubtitle / saveContent / generateHtml / modifyHtml / downloadHtml / downloadFile / readHtml / saveHtml / pickAudio / setAudio / clearAudio / openFolder / openFolderOf / delete / saveVideo），以及 HTML 生成过程的流式进度订阅 onHtmlProgress。
  - `hfTools` —— HTML 预览与 HyperFrames 转视频（openHtml / listProjects / previewShell / renderVideo / showInFolder / onProgress）。
  - `voiceTools` —— 千问语音：音色管理 + 文字生音频（getConfig / getSaveDir / saveConfig / pickAudio / pickDir / listGenerated / create / list / listSystemVoices / listAll / listModels / getProfiles / saveProfile / deleteProfile / synth）。
  - `whisperTools` —— whisper.cpp 字幕转录（status / download / delete / setCurrent / addModel / updateModel / removeModel / openDir / pickAudio / projectAudio / transcribe / onProgress）。
  - `settingsTools` —— 自定义模型（OpenAI 兼容）设置（get / save / test）。
  - `windowControls` —— 自绘标题栏的窗口控制。
- 渲染进程 `src/renderer/`：`app.js` 承担状态、路由与顶部链路状态条（renderStepBar）；`entry.js` 承担左侧菜单导航与窗口控制；`pages/<页面>/` 每个页面一个文件夹（`template.js` DOM 模板 → `App.templates`，`index.js` 逻辑，大页面再拆逻辑模块）；`renderer.css` 承担深空科技风格视觉。

### 2.2 项目目录结构

```
userData/projects/<项目名>/
├── project.json        # 项目元数据（标题、字幕、内容脚本、音频引用、HTML/视频产物路径等）
├── subtitle.txt        # 字幕文本
├── index.html          # Agent 生成的 HTML composition
└── audio/              # 背景音频副本与 TTS 合成结果（可选）
```

语音识别模型不放在项目内，而是全局共享在：

```
userData/whisper/models/  # whisper.cpp 识别模型（ggml-*.bin，按需下载，不打包进应用）
```

内容脚本（`content.style` + 逐场景 `narration / visual / durHint`）随项目元数据存入 `project.json`，作为配音、字幕与 HTML 生成的统一内容源。内置示例项目位于 `E:\my\video-projects`（只读展示）。

### 2.3 关键技术点

- **音色管理输入联动**：音色管理页按所选目标模型的名称正则切换输入方式 —— `qwen-audio-*`（Qwen-Audio-TTS）显示「粘贴音频 URL」行，`qwen3-tts-vc-*` 系列显示「上传本地文件」行；模型下拉 `change` 事件即时联动，模型列表加载后按当前选中值同步初始态。
- **TTS 保存位置**：文字生音频页用单个「保存到」下拉合并三种落盘位置 —— 项目 `audio/`（写入 project.json）/ 自定义目录（持久化保存到 settings.json）/ 音频输出目录（不写入项目）。选择「自定义目录」时直接弹出文件夹选择器（取消则回退原选择），已选目录可一键恢复默认；「打开目录」按钮经 `voice:get-save-dir` IPC 直接取得当前选择的保存目录并打开，无需等待合成完成。
- **转视频**：主进程解析出 Node.js 真实绝对路径（应对 nvm shim / WindowsApps alias 下 `spawn('node')` 不稳定问题），以绝对路径 spawn 运行 `hyperframes.mjs render`；同时把 WinGet 安装的 `Gyan.FFmpeg` 的 bin 目录注入渲染进程的 `env.PATH`，保证 FFmpeg 可用。内置依赖（chrome-headless-shell / node / ffmpeg / hyperframes）优先从打包 `resources` 或项目 `resources/` 目录定位。
- **HTML 合规校验**：转视频前校验 HTML 是 HyperFrames 合规的 composition —— 需同时包含 `data-composition-id` 与 GSAP `__timelines` 结构。
- **whisper.cpp 本地转录**：`whisper.js` 以 `child_process.spawn` 调 `whisper-cli.exe`（`-m 模型 -f 音频 -oj 输出 JSON --no-prints -pp`），解析 JSON 的 `transcription.segments` 取出 `{start, end, text}`，再按项目字幕格式转成 `[分:秒] 文本`，因此转录结果与手写字幕无缝混用、可直接参与后续 HTML 生成与转视频。转录不直接写项目文件：由渲染层弹窗按「替换现有 / 追加到末尾」回填条目后统一走 `project:save-subtitle` 落盘。进度分两阶段回推：spawn 后先为「正在加载模型」（不确定态进度条），从 stderr 解析到首个 `whisper_print_progress_callback: progress = N%` 进度行后进入「转录中 N%」（按百分比填充进度条）。
- **识别模型的「id ↔ 文件名」严格对应**：内置档位与自定义模型各自登记唯一的 `ggml-*.bin` 文件名，识别本地文件时只认登记名，不做前缀或模糊归属推断 —— 因此 `base` 与 `base-q5_1` 是相互独立的档位。枚举外的模型文件一律列为「未知模型」，引导用户「添加自定义模型」纳入管理（自定义条目含名称 / 文件 / 下载地址 / 体积 / 说明，持久化在 settings.json 的 `whisper.customModels`）。
- **模型下载**：模型文件不打包进应用，首次使用时按需下载（`https://hf-mirror.com/ggerganov/whisper.cpp` 国内镜像，规避 GitHub 直链超时），边下边写 `.part`、进度节流回推（`whisper:progress`），完成后原子 rename；下载失败清理残片。`whisper-cli.exe` 及其 DLL 由打包 `extraResources` 携带，开发运行则从项目 `resources/whisper/` 定位。
- **生成过程流式反馈**：HTML 生成/修改通过 SSE 流式接收，按 `connecting → thinking → writing → retry → done` 分阶段回推（`project:html-progress`），页面既显示阶段文案也实时滚动展示模型 `reasoning_content` 思考原文。推理模型可能把 `max_tokens` 全耗在思考阶段导致 `content` 为空，此时按 `32768 → 65536` 自动升档重试，仍失败则抛出带 `usage` 的诊断错误。
- **对话记录落盘**：每次 HTML 生成/修改的完整会话以 JSONL 追加写入 `userData/html-agent/chat.jsonl`（一行一次会话，含项目名、generate/modify 动作、模型与 Base URL）。每行含 `messages`（system + user 完整输入）与 `attempts` 数组——**每档 max_tokens 尝试的完整思考原文（`reasoning_content` 全文）、完整输出、`finish_reason`、`usage`（token 用量）与各阶段耗时（总耗时 / 首 token 等待 / 纯思考时长 / 输出时长）**，升档重试的每一档都会记录，供事后分析每次生成的优化空间；记录失败静默忽略，不影响主流程。
- **CSP 与安全**：iframe 预览使用 `sandbox="allow-scripts allow-same-origin"`；字幕文本一律用 `textContent` 写入，防注入。

---

## 三、流水线流程

```
① 音色管理  →  ② 文字生音频  →  ③ 文字转字幕  →  ④ 字幕生成 HTML  →  ⑤ 转成视频
  (克隆音色/留档)     (文字合成语音)   (whisper 音频转录 或 手写/脚本生成)  (渲染动画页面)   (导出 MP4)
```

1. **音色管理**：克隆音色 / 音色改名与绑定模型（可选节点）。
2. **文字生音频**：输入文字合成自然语音（可选节点）。
3. **文字转字幕**：在「字幕生成」页编辑字幕条目（纯文本自动估时，或 `[分:秒]` 精确定时）；编辑支持「逐条编辑 / SRT」两种写入方式（SRT 为单文本域、标准 SRT 字幕格式：序号 / 时间轴 / 文本，块间空行分隔），并可一键「复制字幕」（复制的文本不含时间线）；也可点「由脚本旁白生成」按内容脚本批量生成，或点「从音频生成字幕」用 whisper.cpp 把项目音频转录成带时间轴的字幕（转录完可选替换或追加），保存后点亮「字幕」节点。
4. **字幕生成 HTML**：在「HTML 生成」页打开对话框，描述想要的效果，提交给 Agent；Agent 生成/修改 HTML 写回项目并刷新预览；如需背景音乐，先选好音频再让 Agent 带上音轨。满意后可「下载 HTML」。
5. **转成视频**：在「视频生成」页预览项目 HTML 并一键转换（后台渲染），完成后内嵌播放并显示产物文件位置。

整个链路围绕同一个「项目」实体共享状态，各页面顶部 step-bar 实时反映进度，避免了「选 HTML 文件」这类割裂操作。

---

## 四、HTML 由自定义模型 Agent 实现（重要说明）

- **生成**：HTML 不再由应用内置模板生成。在「HTML 生成」页填写需求描述（提示词输入框），可选配**字幕**与**背景音频**素材后点击 **生成 HTML**，应用把需求描述连同当前项目内容脚本（旁白 / 画面分镜 / 时长）与所选素材一起提交给自定义模型 Agent；Agent 产出符合规范（含 `data-composition-id` 与 GSAP `__timelines`）的 HTML，写回项目 `index.html`，应用刷新预览并点亮链路节点。
- **修改**：项目已有 HTML 后点击 **修改 HTML**，Agent 基于当前 `index.html` 源码按修改诉求改造，覆盖项目 `index.html` 并刷新预览，同时置空失效的旧视频产物。不需要源码兜底编辑，应用不内置生成逻辑。
- **Agent 接入（已实装）**：主进程 `htmlAgent.js` 实现 `chatWithCustomModel` —— 优先经 OpenAI 兼容客户端（`openai` 依赖），回退直接请求 `${baseUrl}/chat/completions`，**两条路径均走 `stream: true` 流式接收**，边收边按阶段回调 `onProgress`（`connecting / thinking / writing / retry / done`，含思考与输出字符数）；系统提示词约束输出完整、独立、符合 HyperFrames composition 规范的 HTML，并从回复中提取 HTML（兼容 Markdown 代码块包裹）。
- **输出为空的升档重试**：推理模型可能把 `max_tokens` 全部消耗在 `reasoning_content` 上，导致 `content` 为空且 `finish_reason === 'length'`。此时自动按 `32768 → 65536` 升档重试；仍无内容则抛出带 `usage` 的诊断错误，便于判断是配额问题还是模型/网关异常。
- **模型配置**：在「设置」页配置自定义模型（Base URL / 模型 ID / API Key / 启用），提供「测试连接」按钮验证 —— 必须拿到模型返回的文本才算连接成功，避免把「接口通了但模型不产出」误判为可用；API Key 仅保存在本机 `userData/settings.json`，不明文外传。自定义模型未启用或配置不完整时，生成/修改接口返回明确错误提示。
- **应用侧职责**：仅负责 UI（需求输入 / 素材选配 / 预览 / 链路状态）、文件落盘、下载导出与转视频调度；生成与修改的具体魔法由 Agent 完成。主进程 `project:generate-html` / `project:modify-html` 收到 `{ name, prompt, subtitleProject, audioPath }` 后调用 Agent，回写 HTML 后更新 `htmlPath` 并置空失效的 `videoPath`，同时做 HyperFrames 合规校验并返回 `compatible` 提示。

---

## 五、当前进度

### 已完成

- **五节点流水线全链路贯通**：内容脚本（辅助数据源）→ 音色管理 → 文字生音频 → 文字转字幕 → 字幕生成 HTML → 转成视频；链路状态条 step-bar 实时反馈各节点完成状态，点击可跳转对应页面。
- **① 音色管理（已完整）**：接入千问AI平台 Qwen-TTS 克隆音色（pages/soundCopy/ / voice.js）。按目标模型自动联动输入方式：`qwen-audio-*`（Qwen-Audio-TTS）显示「粘贴音频 URL」行、`qwen3-tts-vc-*` 系列显示「上传本地音频文件」行（applyInputMode 正则切换）；可创建克隆音色、拉取云端音色列表，并为任意音色维护本地中文显示名与绑定合成模型（映射仅存本机 settings.json）。
- **② 文字生音频（已完整）**：按所选音色绑定的模型调用千问 TTS 合成语音（pages/textTts/ / voice.js）。「保存到」下拉合并项目 `audio/`、自定义目录（持久化记忆）、音频输出目录三选一，旁常驻「打开目录」按钮（`voice:get-save-dir` IPC，无需等合成完成即可打开当前选择的保存目录）；合成成功提示按实际落盘位置回报（项目 / 自定义目录 / 音频输出目录）；「已生成音频」区按来源分组列出历史 TTS 音频，可试听、可一键设为当前项目背景音频；「合成结果」卡紧邻合成区展示产物路径并可打开所在目录；支持「载入脚本旁白」与带语速调节的双区域试听（仅改播放速率，不改磁盘音频）。
- **③ 文字转字幕（已完整）**：条目列表式字幕编辑器（增删改、时间轴自动接续、字数统计），支持纯文本自动估时与 `[分:秒]` 精确定时、两种格式混用；可「由脚本旁白生成」按场景旁白与时长提示逐条生成；保存后链路「字幕」节点点亮（pages/subtitle/ / projects.js）。
- **③+ 从音频生成字幕（已完整）**：内置 whisper.cpp 本地转录（whisper.js / pages/subtitle/transcribe.js）。转录弹窗可选「使用项目音频」或「浏览本地文件」、选识别语言（自动检测 / 中文 / English），带进度条与阶段状态；完成后「替换现有」或「追加到末尾」回填条目并自动保存。转录在本机 CPU 完成、不消耗 API 额度。
- **语音识别模型管理（已完整）**：设置页「语音识别模型」区块（pages/settings/whisper.js / whisper.js）。四档内置模型（tiny-q8_0 / base / base-q5_1 / small-q8_0）下载 / 删除 / 设为当前使用 / 本地占用统计，走国内镜像下载并实时回推进度；支持添加、编辑、移除自定义模型，并可一键打开模型目录或 whisper-cli 所在目录。
- **④ 字幕生成 HTML（已完整）**：HTML 由自定义模型 Agent 流式生成/修改（pages/htmlGen/ / htmlAgent.js / projects.js），不再依赖内置模板；生成期间实时显示阶段进度（连接 / 推理 / 生成 / 重试）与 AI 思考过程原文，输出为空时自动升档重试；可选用字幕素材（当前项目/其他项目）与背景音频（自动复制进项目 `audio/`）；生成后刷新预览、点亮链路节点；可下载 HTML 到本地；修改后旧视频产物自动置空。
- **⑤ 转成视频（已完整）**：预览外壳 + HyperFrames 后台渲染（video.js / projects.js / hfEnv.js），Node 绝对路径启动 CLI、FFmpeg PATH 注入，渲染进度实时推送；完成后内嵌播放 + 「在文件夹中显示」，产物路径回写项目并点亮「视频」节点。
- **内容脚本（已完整）**：全局视觉风格 + 场景分镜（旁白 / 画面分镜 / 时长提示）编辑保存（pages/content/），作为配音、字幕与 HTML 生成共用的内容源。
- **项目创建与切换（已完整）**：新增 `project:create` IPC（项目名校验 + 写 `project.json`）；顶部步骤条内置全局「工作项目」切换器（我的项目 / 内置示例）+ 新建项目，所有节点页均可直接切换（app.js renderStepBar）；首页「我的项目」卡片区按 `HTML✓ / 视频✓ / 字幕✓` 标注进度（pages/home/ / projects.js）。
- **设置与配置（已完整）**：设置页支持自定义模型（OpenAI 兼容，Base URL / 模型 ID / API Key / 启用 + 测试连接）、千问语音（API Key / 目标模型 / 自定义保存目录）与语音识别模型（whisper.cpp 模型档位管理）三块配置（pages/settings/）。
- **内置示例与打包**：`video-projects` 内置示例项目（只读，可预览 / 转视频）；electron-builder 打包配置完备，`resources/` 下的 node / ffmpeg / whisper-cli 及依赖 DLL 经 `extraResources` 随应用携带（识别模型体积大，改为首次使用时按需下载）；git 仓库已多次提交，README 与代码保持同步。

### 说明

- 内置示例项目只读，进入各页时会提示切换到「我的项目」后再编辑。
- 首次使用需在「设置」页配置千问语音 API Key（用于音色管理 / 文字生音频）与自定义模型（用于 HTML 生成 / 修改）；若要用「从音频生成字幕」，还需在「设置 → 语音识别模型」下载并设为当前使用一个识别模型。
- 语音识别模型文件不随应用打包，首次使用时按需下载到 `userData/whisper/models/`；`whisper-cli.exe` 及依赖 DLL 随应用携带（开发运行从项目 `resources/whisper/` 读取）。

---

## 六、运行

```bash
cd E:\my
npm install        # 首次安装 Electron 等依赖
npm start          # 启动应用（或用 electron .
```

> 转视频依赖：Node.js >= 22（HyperFrames CLI）、HyperFrames CLI（`hyperframes.mjs`，可用环境变量 `HYPERFRAMES_CLI` 指定路径）、FFmpeg（WinGet 安装 `Gyan.FFmpeg`）。
> 字幕转录依赖：`resources/whisper/whisper-cli.exe`（含依赖 DLL，已随仓库/打包携带）+ 一个已下载的 ggml 识别模型（在应用内下载，无需自备）。

首次启动后，请先到「设置」页完成配置：① 千问语音 API Key 与目标模型（供音色管理 / 文字生音频）；② 自定义模型 Base URL / 模型 ID / API Key 并启用（供 HTML 生成 / 修改），保存后可用「测试连接」验证；③ 如需字幕转录，在「语音识别模型」区块下载一个识别模型并「设为当前使用」。
*（内容由AI生成，仅供参考）*
*（内容由AI生成，仅供参考）*
