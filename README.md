---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_566161c2aff911f18874525400287e28
    ReservedCode1: n/C5UHkbt+XC6mkpM4VL9VQRQd3Dsoc+VZMHRkeuxPkaoSGJCTttJ/VxjAbsAfX0tg/SXnwD7YjPAQBajvZysJP/9v6lZdO+bUuF2cQaPPsZI+azcbIzv8Sdj84OVjS2y+uPuP7HC4KjfrB2KGVYFYWKmtFZR3OOcddmxIJ5i3grX3KOkEGru7E7hFI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_566161c2aff911f18874525400287e28
    ReservedCode2: n/C5UHkbt+XC6mkpM4VL9VQRQd3Dsoc+VZMHRkeuxPkaoSGJCTttJ/VxjAbsAfX0tg/SXnwD7YjPAQBajvZysJP/9v6lZdO+bUuF2cQaPPsZI+azcbIzv8Sdj84OVjSuy+uPuP7HC4KjfrB2KGVYFYWKmtFZR3OOcddmxIJ5i3grX3KOkEGru7E7hFI=
---

# MarvisStudio（我的应用）—— 一站式音视频创作流水线

基于 **Electron + Vue 3 + electron-vite + TypeScript** 的桌面应用，以「项目」为粒度，把 **内容脚本 → 配音 → 字幕 → HTML 动画 → 视频** 五个创作节点串成一条完整流水线。每个项目对应本地一个目录，字幕既可由脚本旁白生成，也可用**内置 whisper.cpp 在本机把音频转录成字幕**；视频由 **HyperFrames + FFmpeg 在本机渲染**——语音识别与视频渲染都不消耗 API 额度。

> 工程内知识库（源码级说明、IPC 契约、逐文件文档）见 [`wiki/README.md`](wiki/README.md)；
> 界面设计规范（深空科技 / Cyber UI 配色与组件风格）见 [`src/renderer/agents.md`](src/renderer/agents.md)；
> Vue3 + TS 重构的过程记录见 [`REFACTOR_PLAN.md`](REFACTOR_PLAN.md)。

---

## 一、项目功能

### 1.1 五个创作节点

```
① 音色管理   →   ② 配音        →   ③ 字幕            →   ④ 字幕生成 HTML     →   ⑤ 视频预览
（克隆音色）      （文字生音频 /     （手写 / 脚本生成 /    （自定义模型 Agent      （播放 / 定位
                  逐句对齐配音）      whisper 本机转录）     流式生成 + 转视频）     成品 MP4）
```

| 节点 | 页面 | 要点 |
|---|---|---|
| — 内容脚本 | 内容脚本 | 全局视觉风格 + 逐场景「旁白 / 画面分镜 / 时长提示」，是配音、字幕与 HTML 生成共用的内容源 |
| ① 音色管理 | 音色管理（无侧栏入口，从配音页「管理音色」进入） | 上传 / 粘贴音频创建 Qwen 克隆音色；按目标模型自动切换输入方式；维护本地中文显示名与绑定模型 |
| ② 配音 | 配音 | 「TTS 合成」与「字幕配音（逐句对齐）」两个 Tab |
| ③ 字幕 | 字幕生成 | 条目编辑器、`[分:秒]` / `[开始-结束]` 时间轴、SRT 双向编辑与导出、whisper 转录 |
| ④ HTML | HTML生成 | 提示词驱动 Agent 流式生成 / 修改，内嵌 1920×1080 等比预览 |
| ⑤ 视频 | 视频预览 | 播放 / 定位已渲染的成品 MP4；**「转视频」按钮在 ④ HTML生成页**（含质量 / 帧率档位） |
| — 设置 | 设置 | 自定义模型 / 千问语音 / 语音识别模型 / 视频渲染默认档位四块配置 |

### 1.2 项目化与链路状态

- 每个项目 = `userData/projects/<项目名>/` 一个目录，统一存放 `project.json`、`subtitle.txt`、`index.html`、`audio/`、`video/`。
- 首页「我的项目」卡片按 `HTML✓ / 视频✓ / 字幕✓` 标注进度；顶部 **step-bar** 实时显示五节点完成状态，点击可跳转；step-bar 第二行内置**工作项目切换器**（我的项目 / 内置示例）、**新建项目**、**打开目录**，所有节点页都能直接切换。
- 内置示例项目在 `video-projects/`（**只读**）：`person-video`、`walk-video`，可在「视频预览」页预览示例 HTML 并试渲染，编辑类操作会引导切换到「我的项目」。

### 1.3 内容脚本

编辑全局视觉风格与逐场景分镜（旁白 / 画面分镜 / 时长提示），支持添加、上移、下移、删除；保存写入 `project.json` 的 `content`，之后成为配音（「载入脚本旁白」）、字幕（「由脚本旁白生成」）与 HTML 生成（自动附带）的统一内容源。

### 1.4 配音

**Tab A · 文字生音频（TTS 合成）**

- 输入文本 + 选择音色（系统音色 / 我的克隆音色分组）+ 可选文件名（留空自动命名「时间_前五字_音色id」）。
- **保存位置三选一**：项目 `audio/`（回写 `project.json`）· 自定义目录（持久化记忆）· 音频输出目录（`userData/tts-output`，不写入项目）；旁常驻「打开目录」，无需等合成完成即可打开当前目录。
- 可「载入脚本旁白」批量填入；合成结果可试听（语速仅改播放速率，不改磁盘音频）。
- 「已生成音频」区按来源分组列出历史产物，可试听、可一键**设为当前项目背景音频**。

**Tab B · 字幕配音（逐句对齐）**

把字幕逐句合成配音，再按两种模式对齐成一条音轨：

- **重排字幕（音频驱动，默认）**：以每句实测时长重建字幕时间线，句间停顿优先按字幕原有间隔推算、放不下才用「句间停顿（秒）」兜底（0–10 s，默认 0.5）；音频不变速。
- **修正音频（时间轴驱动）**：字幕时间不变，每句配音摆到其字幕时间点（句间补静音）；槽位放不下先 `atempo` 轻微加速（**上限 1.15 倍**），仍溢出则顺延后续句子并**同步平移后续字幕时间**。
- 结果区逐句显示字幕起点 / 音频起点 / 实测时长与状态徽标（正常 / 加速 / 顺延 +Ns），可试听单句或整轨；「写入当前项目」把**毫秒精度**的对齐字幕与音轨一起写回项目。
- 进度两阶段（逐句合成 → 对齐装配），支持取消（句间检查点，当前句合成完成后停止）。

### 1.5 字幕生成

- **条目编辑器**：增删改、时间轴自动接续、字数与总时长统计；`[分:秒]` 精确定时与纯文本行（按语速估时）可混用。
- **两种写入方式**：「逐条编辑」与「SRT」（标准 SRT 文本域）可互相转换，复制 / 导出 / 保存三个出口都会先应用当前编辑。
- **复制字幕**：复制纯文本（不含时间线）；**导出 SRT 文件**：保存为标准 `.srt`。
- **由脚本旁白生成**：按内容脚本的场景旁白与时长提示批量生成条目。
- **从音频生成字幕**：用内置 whisper.cpp 把项目音频或任意本地音频转录成带时间轴的字幕，可选自动检测 / 中文（简体）/ 中文（繁体）/ English；完成后选「替换现有」或「追加到末尾」回填并自动保存。转录在本机 CPU 完成、不消耗 API 额度。

### 1.6 字幕生成 HTML

- 用**需求描述（提示词）**驱动自定义模型 Agent：可生成，也可在已有 HTML 上「修改 HTML」；生成期间实时显示阶段进度与 **AI 思考过程**原文。
- **项目素材**可选配并注入提示词：字幕（当前项目 / 其它含字幕项目）、背景音频、视频素材（Agent 会以 `<video>` 引入并用 GSAP 编排播放时段）。
- **预览**：内嵌 iframe 按 1920×1080 等比缩放，带暂停 / 播放 / 重播与进度条。
- 可**下载 HTML** 到本地任意位置（导出的是单个文件，会把项目内的 `./gsap.min.js` 相对引用换回固定版本 CDN 地址，保证导出物在别处联网即可独立打开）；HTML 变更后旧的视频产物自动失效。
- **转视频**：动作行的「转视频」按钮把当前项目 `index.html` 交给 HyperFrames 后台渲染成 MP4，完成后把产物路径回写项目并提示到「视频预览」页查看；渲染进度实时回推为中文阶段文案。
- **渲染档位**：动作行下方可选**质量**（快速预览 / 标准 / 高画质）与**帧率**（30 / 24）；默认档位在设置页配置，单个项目可在本行覆盖（出现「恢复默认档位」按钮即表示当前项目有自定义档位）。
- 「自定义素材」区可导入 / 移除背景音频、从已生成音频中设为背景音频、导入 / 移除视频素材，或把视频**原声提取为背景音频**（ffmpeg 转 AAC 192k）。

### 1.7 视频预览

- 进入「视频预览」页即自动加载当前项目已渲染的成品 MP4 并内嵌播放；「重新加载」重新读盘（同一路径重新渲染后也能刷新），「在文件夹中显示」在系统文件管理器中定位产物。
- 尚无成品时按项目状态给出引导：已有 HTML → 提示到「HTML生成」页点「转视频」；还没有 HTML → 提示先生成 HTML。
- **内置示例项目（只读）**：本页提供示例 HTML 预览（预览外壳 + 等比缩放）与「HyperFrames 试渲染」，档位只在本次会话生效、不写入项目，试渲染结果直接在页内播放。

### 1.8 设置

| 区块 | 配置项 | 说明 |
|---|---|---|
| 自定义模型（OpenAI 兼容） | Base URL / 模型 ID / API Key / 启用 | HTML 生成与修改的唯一模型入口；「测试连接」**必须拿到模型文本输出**才算成功 |
| 千问语音 | API Key / 目标模型 | 音色管理、文字生音频与逐句对齐配音依赖它；候选模型表内置 7 条 |
| 语音识别模型（whisper.cpp） | 内置 4 档 + 自定义模型 | 下载 / 删除 / 设为当前 / 本地占用统计；可打开模型目录；模型文件不随包分发 |
| 视频渲染默认档位 | 质量 / 帧率 | 「转视频」的全局默认档位（`settings.json` 的 `render` 段）；单个项目可在「HTML生成」页覆盖，覆盖优先于此处 |

内置识别档位（**id 与文件名严格一一对应**，`base` 与 `base-q5_1` 是两个独立档位）：

| id | 文件名 | 体积 | 速度 | 适用 |
|---|---|---|---|---|
| `tiny-q8_0` | `ggml-tiny-q8_0.bin` | 43.5 MB | 最快 | 快速出稿、长音频粗剪、低配机器 |
| `base` | `ggml-base.bin` | 148 MB | 快 | 日常转录 |
| `base-q5_1` | `ggml-base-q5_1.bin` | 59.7 MB | 快 | 常规字幕生成（体积约为 base 的四成） |
| `small-q8_0` | `ggml-small-q8_0.bin` | 264 MB | 较慢 | 中文准确率明显提升，长音频推荐 |

下载走国内镜像 `hf-mirror.com`，边下边写 `.part`、完成后原子改名，进度实时回推；枚举外的模型文件会列为「未知模型」，可「添加自定义模型」（名称 / 文件名 / 下载地址 / 体积 / 说明）纳入管理。

---

## 二、主要实现

### 2.1 技术栈与架构

- **Electron 31.7.7 + Vue 3.5 + electron-vite 5 + Vite 7 + TypeScript 7**；全量 TS，`main` / `preload` 输出 **CJS**（sandboxed preload 的硬要求，全工程无 `"type": "module"`）。
- **无 vue-router / pinia**：导航用页面注册表（`src/renderer/src/pages/index.ts`）的 `goPage()`，全局状态为模块级 `reactive` / `ref` 单例（`composables/useAppStore.ts`）。
- 源码分层：

```
src/
├─ main/       主进程 11 个模块（index 装配器 + 10 个业务/工具域，统一 register(ctx) 模式）
│              index · hfEnv · settings · systemVoices · htmlAgent · projects · voice · ttsAlign · video · whisper · vad
├─ preload/    index.ts（8 个 contextBridge 命名空间）+ index.d.ts（window.* 类型）
├─ shared/     ipc.ts（7 组 71 个频道常量）· types.ts（跨进程载荷与 window API 契约）
├─ renderer/   Vue 界面：index.html · src/{main.ts, App.vue, assets/main.css, components/, composables/, utils/, pages/}
│              pages/ 一页一目录 9 页：Home · Content · TextTts · Subtitle · HtmlGen · VideoPreview · SoundCopy · Settings · About
└─ agent/      独立 ESM 实验脚本（不进构建图、不打包）
```

仓库顶层另有随应用分发的静态资源：

```
vendor/gsap/gsap.min.js   # 随包 GSAP 3.14.2（离线渲染/预览用），经 build.files 打进 asar
resources/                # 内置运行时（node / ffmpeg / hyperframes+chrome / whisper），走 extraResources，约 715 MB
video-projects/           # 内置只读示例项目（person-video / walk-video）
```

- **IPC 契约单一真源**：频道名集中在 `src/shared/ipc.ts`；所有载荷、结果与进度推送类型集中在 `src/shared/types.ts`；`window.*` 的签名由 `types.ts` 的 `PreloadApi` 统一定义——preload 实现按 `PreloadApi['<命名空间>']` 标注，渲染层通过 `preload/index.d.ts` 挂载同一份契约，两端不会各自漂移。
- **安全边界**：`contextIsolation: true` + `nodeIntegration: false`；API Key 只留在主进程 `settings.json`；CSP meta 禁 `unsafe-eval`（SFC 全预编译）；渲染层无 `clipboard` 模块（复制经 `app:copy-text` 主进程写入）；文本一律 `textContent` / `escTxt()` 写入防注入；外置程序一律取自随包 `resources/`，`spawn` 用数组参数不经 shell。

### 2.2 运行时数据目录

```
userData/
├─ settings.json                 # customModel / voiceTTS / voiceProfiles / whisper / render 五个分区
├─ projects/<项目名>/
│  ├─ project.json               # 项目元数据：title/subtitle/htmlPath/videoPath/audioFile/videoMaterial/content/render…
│  ├─ subtitle.txt               # 字幕文本（[开始-结束] 文本，毫秒精度）
│  ├─ index.html                 # Agent 生成的 HyperFrames composition
│  ├─ index.preview.html         # 预览副本（剥离 CSP + 注入播放控制脚本）
│  ├─ audio/                     # 背景音频副本与 TTS 合成结果
│  └─ video/                     # 视频素材副本
├─ whisper/models/               # 识别模型（ggml-*.bin，按需下载）
├─ html-agent/chat.jsonl         # 每次 HTML 生成/修改的完整会话（含思考全文、usage、各阶段耗时）
├─ voice/align-<时间戳>/         # 逐句对齐任务临时目录（raw/seg/sil + 整轨 WAV），只保留最近一次
├─ hf-projects/html-video-<时间戳>/  # HyperFrames 渲染工作目录（output.mp4）
├─ tts-output/                   # 「音频输出目录（不写入项目）」的落点
└─ preview-protocol.log          # hgpreview:// 协议请求日志，排查预览异常
```

### 2.3 关键技术点

- **TTS 保存位置**：由渲染层显式传入（`项目 audio/` / 自定义目录 / 音频输出目录），主进程按 `saveDir → defaultOut → 项目 audio/ → 兜底` 解析；只有真正写入项目 `audio/` 时才回写 `project.json`。
- **逐句对齐配音**：逐句合成后统一转 24 kHz 单声道（避开 mp3 头尾 padding 的时间漂移）→ ffprobe 量实测时长 → 按模式重排/摆放 → 静音拼接 + `-c copy` **零重编码**装配整轨 → 整轨时长终验（与末句终点偏差 > 0.3 s 即判失败）。模式 B 的加速上限 1.15 倍，加速后必须重新量时长（吸收帧粒度误差）。
- **whisper 本地转录**：`spawn whisper-cli.exe -m 模型 -f 音频 -oj --no-prints -pp`，从 stderr 抓进度行；非 CLI 原生支持的格式先经内置 ffmpeg 转 16 kHz WAV；中文自动繁→简（opencc-js，失败降级保留原文）；解析 `transcription.segments` 后转为项目的 `[开始-结束]` 毫秒精度字幕，与手写字幕无缝混用。
- **VAD 静音裁剪**：转录后对每段做能量 VAD，把结束时间收敛到**实际语音结束**（前导 ≥0.4 s、尾随 ≥0.15 s 才裁剪，只收敛不放大、相邻段至少留 0.05 s）；纯函数模块、无参数无开关，失败静默跳过、不阻断转录。
- **模型管理**：id 与文件名严格一一对应，不做前缀 / 模糊归属推断；下载走国内镜像、边下边写 `.part`、完成后同目录原子改名，断网或中断不会留下「看似已下载」的坏档。
- **HTML 生成流式反馈**：按 `connecting → thinking → writing → retry → done` 分阶段回推（300 ms 节流），实时滚动展示模型思考原文（末 2 万字符）；推理模型把配额耗在思考阶段导致输出为空或被截断时，自动按 **32768 → 65536** 升档重试；每次生成/修改的完整会话写入 `html-agent/chat.jsonl`（含每档尝试的思考全文、`finish_reason`、`usage` 与各阶段耗时），供事后分析。
- **HTML 合规校验**：转视频前要求源码同时命中 `data-composition-id` / `__timelines` / `gsap` 三个特征（启发式文本匹配）；生成侧只提示不阻断，转视频侧是硬门槛。
- **GSAP 本地化（离线可用）**：生成的 HTML 统一以 `<script src="./gsap.min.js"></script>` 引入 GSAP，文件由随包携带的 `vendor/gsap/gsap.min.js`（3.14.2）提供——生成 / 保存 / 预览 / 渲染四个环节都会把残留的 CDN 引用改写为项目内相对引用并复制该文件（渲染与预览只改副本，不动原件）。时间轴按 HyperFrames 契约写成 `gsap.timeline({ paused: true })` 并登记为**以 composition id 为键的对象**（`window.__timelines["<id>"] = tl`），预览控制脚本同时兼容旧生成物的数组形态。
- **转视频**：把 Node 解析为真实绝对路径（规避 nvm shim / WindowsApps alias），把内置 FFmpeg 的 bin 注入渲染进程 `PATH`，并指定内置 chrome-headless-shell，避免渲染时重新下载浏览器；质量 / 帧率档位随 `video:render` 载荷传入，主进程按白名单拼 `--quality` / `--fps`（缺省走 CLI 默认 `standard` / `30`）。
- **预览协议 `hgpreview://`**：dev 下渲染层来自 http 源，Chromium 会拦截 `file://` iframe，故预览统一走自定义协议 `hgpreview://p/<项目名>/<相对路径>`；主进程把 URL 映射回项目目录内的文件，并做目录穿越校验（解析后必须位于该项目目录内），显式给出 MIME、`Cache-Control: no-store`，失败落盘日志便于排查。

---

## 三、流水线流程

1. **内容脚本**：写全局风格与逐场景旁白 / 画面 / 时长（可选，但建议——它是后续三步的共同内容源）。
2. **配音**：文字生音频合成语音；或用「逐句对齐」按字幕生成对齐配音。（可选节点）
3. **字幕**：手写条目、`[分:秒]` 定时、由脚本旁白生成，或用 whisper 从音频转录；可导出 / 复制 SRT。保存后点亮「字幕」节点。
4. **HTML 生成**：在提示词框描述想要的效果（可附带字幕 / 背景音频 / 视频素材），Agent 生成或修改 `index.html` 并刷新预览；满意后可下载 HTML，也可直接点「转视频」（质量 / 帧率档位可选）把当前 HTML 渲染成 MP4。
5. **视频预览**：进入「视频预览」页查看成品——内嵌播放、重新加载、在文件夹中显示；产物路径已由上一步回写项目、点亮「视频」节点。

整条链路围绕同一个「项目」实体共享状态，不再有「选 HTML 文件」这类割裂操作。

---

## 四、HTML 由自定义模型 Agent 实现（重要说明）

- **生成**：应用不内置 HTML 模板。填写需求描述（可选配字幕 / 背景音频 / 视频素材）后，主进程把需求连同当前项目**内容脚本**（旁白 / 画面 / 时长）与素材一起提交给自定义模型；Agent 产出符合行业规范（含 `data-composition-id` 与 GSAP `__timelines`）的 HTML，写回项目 `index.html`，应用刷新预览并点亮节点。
- **修改**：已有 HTML 时，Agent 基于当前源码按修改诉求改造，覆盖写回、刷新预览，并置空失效的旧视频产物。
- **接入方式**：优先走 `openai` SDK，不可用时回退直接请求 `${baseUrl}/chat/completions`，**两条路径都是 `stream: true` 流式接收**，边收边按阶段回调。
- **输出为空的升档重试**：`max_tokens` 全被思考阶段消耗导致输出为空或被截断时自动升档（32768 → 65536）；仍失败则抛出带 `usage` 的诊断错误，便于区分配额问题与网关异常。
- **模型配置**：设置页配置 Base URL / 模型 ID / API Key / 启用，「测试连接」必须拿到模型文本输出才算通过；API Key 仅保存在本机 `settings.json`，由主进程读取、不经渲染层外传。
- **应用侧职责**：UI（需求输入 / 素材选配 / 预览 / 链路状态）、文件落盘、导出与转视频调度；生成与修改的具体创作交给 Agent。

---

## 五、运行与依赖

```bash
cd E:\my
npm install

npm run dev        # 开发：起 Vite dev server（127.0.0.1:5173）+ Electron，渲染层 HMR
npm run build      # 构建三端产物到 out/
npm start          # 以构建产物启动（= electron-vite preview，需先 npm run build）
npm run typecheck  # 三份 tsconfig 串行类型检查
npm run pack       # build + electron-builder --dir（免安装解包目录）
npm run dist       # build + electron-builder --win（NSIS 安装包）
```

**外部依赖**

- **Node.js ≥ 22**：HyperFrames CLI 需要；优先使用随包 `resources/node/node.exe`，否则解析系统 Node 真实路径。
- **HyperFrames CLI**：优先用内置 `resources/hyperframes/`（含 chrome-headless-shell），也可用环境变量 `HYPERFRAMES_CLI` 指定。
- **FFmpeg / FFprobe**：内置 `resources/ffmpeg/bin/`，同时会探测 WinGet 安装的 `Gyan.FFmpeg` 并注入 `PATH`。
- **whisper-cli.exe**：内置 `resources/whisper/`（含依赖 DLL）；**识别模型文件不随包分发**，在应用内按需下载。
- **GSAP**：随包 `vendor/gsap/gsap.min.js`（3.14.2），无需联网；版本与更新步骤见 `vendor/gsap/README.md`。

**首次使用配置**（设置页）

1. **自定义模型**：填 Base URL / 模型 ID / API Key 并启用（HTML 生成/修改的唯一入口）。
2. **千问语音**：填 DashScope API Key、选目标模型（音色管理与配音依赖它）。
3. **语音识别模型**：确认 `whisper-cli.exe：已就绪`，下载至少一个档位并「设为当前使用」（要转录才需要）。

---

## 六、当前进度

### 已完成

- **五节点流水线全链路贯通**：内容脚本 → 配音 → 字幕 → HTML → 视频；step-bar 实时反馈完成状态、可点击跳转、内置工作项目切换器与新建项目。
- **① 音色管理**：克隆音色创建（按模型自动切换「粘贴 URL / 上传文件」）、系统音色表、云端克隆列表、本地显示名与绑定模型映射管理。
- **② 配音**：TTS 合成（保存位置三选一、载入脚本旁白、试听与语速调节、历史音频复用、设为背景音频）+ **字幕配音逐句对齐**（双模式、加速/顺延、进度与取消、结果明细、写回项目）。
- **③ 字幕**：条目编辑器（时间轴自动接续）、逐条编辑 / SRT 双向、复制字幕、导出 SRT、由脚本旁白生成、whisper 本机转录（替换 / 追加、两阶段进度）。
- **语音识别模型管理**：内置 4 档 + 自定义模型的下载 / 删除 / 设为当前 / 占用统计，镜像下载与原子落盘。
- **④ 字幕生成 HTML**：Agent 流式生成 / 修改、思考过程实时展示、输出为空自动升档重试、素材注入、1920×1080 等比预览与播放控制、下载 HTML、**转视频（含质量 / 帧率档位）**、会话记录落盘。
- **生成契约与 HyperFrames 对齐 + GSAP 本地化**：提示词要求 `gsap.timeline({ paused: true })` 与「以 composition id 为键的 `__timelines` 对象」（与官方文档、内置示例一致）；GSAP 改为随包 `vendor/gsap/gsap.min.js` + 项目内相对引用，生成 / 保存 / 预览 / 渲染四环节自动改写残留 CDN 引用，预览控制脚本同时兼容旧生成物的数组形态。
- **⑤ 视频预览与转视频**：合规校验、预览外壳、HyperFrames 后台渲染与中文进度文案、**渲染档位（设置页全局默认 + 项目级覆盖）**、成品内嵌播放与「在文件夹中显示」、产物回写项目；内置示例可在同一页试渲染。
- **项目化**：创建 / 切换 / 删除、字幕与内容脚本保存、背景音频与视频素材管理（含提取原声）、内置只读示例、`hgpreview://` 预览协议。
- **工程化**：TypeScript 全量覆盖（`npm run typecheck` 全绿）、IPC 载荷类型集中在 `shared/types.ts` 并作为 `window.*` 的单一真源、CSP/sandbox/contextIsolation 安全边界、electron-builder 打包配置完备（内置运行时经 `extraResources` 携带）。

### 已知限制与说明

- **内置示例的预览仍依赖网络**：`video-projects/` 下的两个示例除 GSAP 外还从 CDN 引 `@hyperframes/core` 与 `@hyperframes/shader-transitions`（本轮只本地化了 GSAP）。**转视频不受影响**（HyperFrames CLI 自带并注入自己的运行时），但完全离线时示例的页面内预览可能不完整。
- **识别模型不随包分发**：首次转录前必须在设置页下载模型，`whisper-cli.exe` 缺失会直接阻塞转录。
- **VAD 静音裁剪无开关**：阈值与窗口为固定常量，背景噪声较大时可能整体不生效（保守行为）。
- **对齐配音**：单句最多加速到 1.15 倍，超出靠顺延；末句无槽位、不加速也不顺延；同一时刻只允许一个对齐任务，取消是句间软中断（当前句的合成请求不会被打断）。
- **本地音频格式**：whisper-cli 原生只支持 flac/mp3/ogg/wav（其它格式会先自动转码）；克隆音色上传的本地音频 Base64 后需小于 10 MB；VAD 只解析 16 bit PCM WAV。
- **API Key 以明文保存在本机 `userData/settings.json`**，仅主进程读取，不会外传；如需更高安全性可后续接入 Electron `safeStorage` 加密。
- **内置示例只读**：进入各页编辑时会提示切换到「我的项目」。

*（内容由AI生成，仅供参考）*
