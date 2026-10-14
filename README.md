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

# 影坊（ShadowMill）—— 一站式音视频创作流水线

基于 **Electron + Vue 3 + electron-vite + TypeScript** 的桌面应用，以「项目」为粒度，把 **内容脚本 → 配音 → 字幕 → HTML 动画 → 视频** 五个创作节点串成一条完整流水线。每个项目对应本地一个目录，字幕既可由脚本旁白生成，也可用**内置 whisper.cpp 在本机把音频转录成字幕**；视频由 **HyperFrames + FFmpeg 在本机渲染**——语音识别与视频渲染都不消耗 API 额度。

> 工程内知识库（源码级说明、IPC 契约、逐文件文档）见 [`wiki/README.md`](wiki/README.md)；
> 更新日志（按版本记录每次修改，发布内容看这一份）见 [`CHANGELOG.md`](CHANGELOG.md)；
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
- 首页「我的项目」区块：项目卡片显示**项目名**（不显示 `project.json` 里的标题——其缺省值会让用户困惑）、副行 `HTML✓ / 视频✓ / 字幕✓`（无则显示 `—`）与「更新于 YYYY-MM-DD HH:mm」；点卡片即切换项目并进入「HTML生成」页，列表为空时提示去顶部「工作项目」栏新建。
- 顶部 **step-bar** 实时显示五节点完成状态，点击可跳转；第二行是所有节点页共用的**工作项目切换器**（下拉只列「我的项目」、值即项目名，为空时显示「暂无项目，请先『新建项目』」）+ **新建项目** + **打开目录**（打开当前项目所在目录）。**新建项目是弹窗**：点按钮 → 输入项目名称 → Enter（或「创建并切换」）确认后立即创建并切换到新项目，Esc / 点遮罩 / 取消关闭、创建中禁止关闭与重复提交。首页只负责选择 / 打开项目，**不再有新建入口**。

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

- 用**需求描述（提示词）**驱动自定义模型 Agent：动作行是**两个并列按钮**——**「生成 HTML」**（主按钮，不参考现有页面、从零做一版新的）与**「按需求修改」**（在当前页面上按需求改一版、整页输出并覆盖；还没有 HTML 时该按钮禁用）。两者的区别由**每个动作按钮内部各带一个的行内帮助 `?`**（悬浮只显示该动作自己的说明）承载，不靠按钮文案自适应。已有 HTML 时点「生成 HTML」**直接覆盖**——**点一次即执行，没有二次确认**（按钮文案恒为「生成 HTML」；想留底稿请先点「下载 HTML」）。生成期间实时显示阶段进度与 **AI 思考过程**原文。
- **项目素材**可选配并注入提示词：字幕（当前项目 / 其它含字幕项目）、视频素材（Agent 会以 `<video>` 静音自动播放引入并用 GSAP 编排播放时段）。视频素材**只有一个选择入口**（在「项目素材」块内）：下拉里可直接选项目现有素材，也可选「选择本地视频文件…」当场导入自定义文件（复制进项目 `video/` 目录，**导入即选中**，不必再去别处选一次）；某次不想用视频就选「不使用视频素材」。
- **背景音频**不在提示词里：在下方「预览」卡片里选定（本地音频 / 「已生成音频」列表 / 从视频提取原声），由应用直接写进 HTML 的 `<audio id="myv-bgm" autoplay loop>`——选定或更换后重载预览即可听到，不占提示词、也不交给 Agent。
- **预览**：内嵌 iframe 按 1920×1080 等比缩放，带暂停 / 播放 / 重播与进度条。
- 可**下载 HTML** 到本地任意位置（导出的是单个文件，会把项目内的 `./gsap.min.js` 相对引用换回固定版本 CDN 地址，保证导出物在别处联网即可独立打开）；HTML 变更后旧的视频产物自动失效。
- **转视频**：动作行的「转视频」按钮把当前项目 `index.html` 交给 HyperFrames 后台渲染成 MP4（页面里的 `<audio id="myv-bgm">` 音轨由 CLI 内部提取并混入，应用侧不做 ffmpeg 混音），完成后把产物路径回写项目并提示到「视频预览」页查看；渲染进度实时回推为中文阶段文案。
- **渲染档位**：动作行下方可选**质量**（快速预览 / 标准 / 高画质）与**帧率**（30 / 24）；默认档位在设置页配置，单个项目可在本行覆盖（出现「恢复默认档位」按钮即表示当前项目有自定义档位）。
- 上面那一行「视频素材」下拉旁还有「移除视频」与**「提取原声为背景音频」**（ffmpeg 转 AAC 192k，提取后立即注入 HTML 音轨）——导入 / 移除 / 提取原声与素材预览都收在这一处，不再有单独的「导入为项目素材」卡片。

### 1.7 视频预览

- 进入「视频预览」页即自动加载当前项目已渲染的成品 MP4 并内嵌播放；「重新加载」重新读盘（同一路径重新渲染后也能刷新），「在文件夹中显示」在系统文件管理器中定位产物。
- 尚无成品时按项目状态给出引导：已有 HTML → 提示到「HTML生成」页点「转视频」；还没有 HTML → 提示先生成 HTML。

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

- **Electron 44.7.0（Chromium 152 + Node 24.21.0）+ Vue 3.5 + electron-vite 5 + Vite 7 + TypeScript 7**；全量 TS，`main` / `preload` 输出 **CJS**（sandboxed preload 的硬要求，全工程无 `"type": "module"`）。
- **无 vue-router / pinia**：导航用页面注册表（`src/renderer/src/pages/index.ts`）的 `goPage()`，全局状态为模块级 `reactive` / `ref` 单例（`composables/useAppStore.ts`）。
- 源码分层：

```
src/
├─ main/       主进程 12 个模块（index 装配器 + 11 个业务/工具域，统一 register(ctx) 模式）
│              index · hfEnv · settings · systemVoices · htmlAgent · projects · voice · ttsAlign · video · whisper · vad · updater
├─ preload/    index.ts（9 个 contextBridge 命名空间）+ index.d.ts（window.* 类型）
├─ shared/     ipc.ts（8 组 75 个频道常量）· types.ts（跨进程载荷与 window API 契约）
├─ renderer/   Vue 界面：index.html · src/{main.ts, App.vue, assets/main.css, components/, composables/, utils/, pages/}
│              pages/ 一页一目录 9 页：Home · Content · TextTts · Subtitle · HtmlGen · VideoPreview · SoundCopy · Settings · About
└─ agent/      独立 ESM 实验脚本（不进构建图、不打包）
```

仓库顶层另有随应用分发的静态资源：

```
vendor/gsap/gsap.min.js   # 随包 GSAP 3.14.2（离线渲染/预览用），经 build.files 打进 asar
resources/                # 内置运行时（ffmpeg / hyperframes+chrome / whisper），约 632 MB，
                          #   打包时由 scripts/pack-runtime.mjs 分成两个包：ffmpeg.7z 与 hyperframes.7z，
                          #   二者**不随安装包**、用到时由用户在应用内确认后下载（可取消）；
                          #   只有 whisper/ 走 extraResources 随安装包（转录缺它就完全不能用）
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
│  ├─ index.html                 # Agent 生成的 HyperFrames composition（+ 应用注入的 <audio id="myv-bgm"> 背景音轨）
│  ├─ index.preview.html         # 预览副本（剥离 CSP + 注入播放控制脚本，从 index.html 生成、故自带音轨）
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
- **转视频**：Node 优先**复用 Electron 内嵌的 Node**（以 `ELECTRON_RUN_AS_NODE=1` 跑 `electron.exe`，Electron 44.7.0 内置 Node 24.21.0，满足 HyperFrames 的 >= 22 要求），失败才回退系统 Node（同样要求 >= 22，并解析为真实绝对路径以规避 nvm shim / WindowsApps alias）；`findNode()` 返回的 `env` 必须合进子进程环境，否则 `electron.exe` 会把自己当应用启动。渲染前会先校验运行环境（ffmpeg + hyperframes 两个包），缺包则弹确认框让用户决定是否下载（可取消）；就绪后把内置 FFmpeg 的 bin 注入渲染进程 `PATH`（并设 `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH`），指定内置 chrome-headless-shell，避免渲染时重新下载浏览器；质量 / 帧率档位随 `video:render` 载荷传入，主进程按白名单拼 `--quality` / `--fps`（缺省走 CLI 默认 `standard` / `30`）。
- **预览协议 `hgpreview://`**：dev 下渲染层来自 http 源，Chromium 会拦截 `file://` iframe，故预览统一走自定义协议 `hgpreview://p/<项目名>/<相对路径>`；主进程把 URL 映射回项目目录内的文件，并做目录穿越校验（解析后必须位于该项目目录内），显式给出 MIME、`Cache-Control: no-store`，失败落盘日志便于排查。

---

## 三、流水线流程

1. **内容脚本**：写全局风格与逐场景旁白 / 画面 / 时长（可选，但建议——它是后续三步的共同内容源）。
2. **配音**：文字生音频合成语音；或用「逐句对齐」按字幕生成对齐配音。（可选节点）
3. **字幕**：手写条目、`[分:秒]` 定时、由脚本旁白生成，或用 whisper 从音频转录；可导出 / 复制 SRT。保存后点亮「字幕」节点。
4. **HTML 生成**：先在「项目素材」里选好素材（均可选），再到「需求描述（提示词）」框描述想要的效果（背景音频不在这里，在下方「预览」处选定、由应用直接注入 HTML，不进提示词）；点动作行按钮——**「生成 HTML」**不参考现有页面、从零做一版新的（已有 HTML 时**点一次即直接覆盖，没有二次确认**），**「按需求修改」**在当前页面的基础上按需求改一版（还没有 HTML 时该按钮禁用），分不清就点按钮里的 **`?`** 看该动作自己的悬浮说明。Agent 写回 `index.html` 并刷新预览；满意后可下载 HTML，也可直接点「转视频」（质量 / 帧率档位可选）把当前 HTML 渲染成 MP4。
5. **视频预览**：进入「视频预览」页查看成品——内嵌播放、重新加载、在文件夹中显示；产物路径已由上一步回写项目、点亮「视频」节点。

整条链路围绕同一个「项目」实体共享状态，不再有「选 HTML 文件」这类割裂操作。

---

## 四、HTML 由自定义模型 Agent 实现（重要说明）

- **生成**：应用不内置 HTML 模板。填写需求描述（可选配字幕 / 视频素材；背景音频由应用注入、无需写进提示词）后，主进程把需求连同当前项目**内容脚本**（旁白 / 画面 / 时长）与素材一起提交给自定义模型；Agent 产出符合行业规范（含 `data-composition-id` 与 GSAP `__timelines`）的 HTML，写回项目 `index.html`，应用刷新预览并点亮节点。写盘后主进程会按 `project.audioFile` 把背景音轨 `<audio id="myv-bgm">` 补注入 HTML（生成 / 修改 / 手改保存三处同一套规则）。
- **修改**：已有 HTML 时，点「按需求修改」，Agent 基于当前源码按修改诉求改造，覆盖写回、刷新预览，并置空失效的旧视频产物（界面入口就是该按钮，走 `project:modify-html`，提示词带当前 `index.html` 全文）；**没有 HTML，或点了「生成 HTML」（点一次即执行、无二次确认），则走 `project:generate-html`**（提示词不含现有页面）。这两个频道 / handler 在主进程各自独立，并未合并。
- **接入方式**：优先走 `openai` SDK，不可用时回退直接请求 `${baseUrl}/chat/completions`，**两条路径都是 `stream: true` 流式接收**，边收边按阶段回调。
- **输出为空的升档重试**：`max_tokens` 全被思考阶段消耗导致输出为空或被截断时自动升档（32768 → 65536）；仍失败则抛出带 `usage` 的诊断错误，便于区分配额问题与网关异常。
- **模型配置**：设置页配置 Base URL / 模型 ID / API Key / 启用，「测试连接」必须拿到模型文本输出才算通过；API Key 仅保存在本机 `settings.json`，由主进程读取、不经渲染层外传。
- **应用侧职责**：UI（需求输入 / 素材选配 / 背景音频选定 / 预览 / 链路状态）、文件落盘、**背景音轨注入 HTML**、导出与转视频调度；生成与修改的具体创作交给 Agent。

---

## 五、运行与依赖

```bash
cd E:\my
npm install

npm run dev        # 开发：起 Vite dev server（127.0.0.1:5173）+ Electron，渲染层 HMR
npm run build      # 构建三端产物到 out/
npm start          # 以构建产物启动（= electron-vite preview，需先 npm run build）
npm run typecheck  # 三份 tsconfig 串行类型检查
npm run runtime:pack  # 把 resources/ 打成运行环境包（build/runtime-pack/{ffmpeg,hyperframes}.7z + .json；源目录没变则自动跳过，--only <name> 只重打一个）
npm run pack       # runtime:pack + build + electron-builder --dir（免安装解包目录）
npm run dist       # runtime:pack + build + electron-builder --win（NSIS 安装包）
```

> **安装与首次运行提示（Electron 44）**：Electron 44 的 npm 包**没有 `postinstall`**，二进制改为**首次 `require('electron')` 时懒下载**——因此 `npm install` 完成后 `node_modules/electron/dist` 可能并不存在，**首次 `npm run dev` 会触发约 150 MB 的下载**（需要显式安装时用 `npx install-electron`，其 bin 为 `install-electron` → `node_modules/electron/install.js`）。下载镜像由仓库根新增的 `.npmrc` 提供：`electron_mirror=https://npmmirror.com/mirrors/electron/`（该地址会 302 跳到 `https://cdn.npmmirror.com/binaries/electron/`，下载器自行跟随；CDN 上没有 `/mirrors/` 前缀，只有 `binaries/`）。它与 `package.json` 的 `build.electronDownload.mirror` 分工不同——后者只在 electron-builder 打包时下载 Electron 运行时，管不到 `npm install`。

**外部依赖**

- **Node.js ≥ 22**：HyperFrames CLI 需要。两种途径按序回退：① **Electron 内嵌 Node**（`ELECTRON_RUN_AS_NODE=1` + `process.execPath`，Electron 44.7.0 实测 Node 24.21.0；探针用 `-e` 打印 `process.versions.node`，要求 `status === 0` 且主版本 >= 22，该复用依赖 Electron 的 `RunAsNode` 熔丝保持默认开启）→ ② 系统 Node（`NVM_SYMLINK` → `LOCALAPPDATA\nvm\nodejs` → `C:\Program Files\nodejs` → `where.exe`，同样要求 >= 22，且解析为真实绝对路径以规避 nvm shim / WindowsApps alias）。由 `src/main/hfEnv.ts` 的 `findNode()` 统一返回 `{ cmd, env }`。**随包的 `resources/node/node.exe` 已整条移除**（它当年那条「回退」在打包态本来就够不着），代价是若将来在 `build.electronFuses` 里关掉 `RunAsNode` 熔丝，就必须把 node.exe 放回来或把系统 Node 变成硬性前置。
- **HyperFrames CLI**：内置 `resources/hyperframes/`（含 chrome-headless-shell），也可用环境变量 `HYPERFRAMES_CLI` 指定。
- **FFmpeg / FFprobe**：内置 `resources/ffmpeg/bin/`，同时会探测 WinGet 安装的 `Gyan.FFmpeg` 并注入 `PATH`。
- **whisper-cli.exe**：内置 `resources/whisper/`（含依赖 DLL），经 `extraResources` **随安装包**；**识别模型文件不随包分发**，在应用内按需下载。
- **GSAP**：随包 `vendor/gsap/gsap.min.js`（3.14.2），无需联网；版本与更新步骤见 `vendor/gsap/README.md`。
- **运行环境分包（ffmpeg / hyperframes）**：这两项合计约 620 MB、4900+ 文件，**不随安装包发布**。
  `scripts/pack-runtime.mjs` 把它们各打成一个 7z（`build/runtime-pack/{ffmpeg,hyperframes}.7z` + 同名 `.json` 清单），
  上传到更新源（`app-update.yml` 的 url 目录）后由应用**用到时按需下载**：
  转视频要 ffmpeg + hyperframes，提取音轨 / 逐句对齐 / 非 wav·mp3·flac·ogg 的转录要 ffmpeg。
  下载与解包都在应用内进行（有进度、可取消；取消＝不下载且那次操作一并作废），
  解到 `%APPDATA%\shadowmill\runtime\<包名>\`，之后除非该包内容变了否则不再下载。
  安装包里只有解包器 `7za.exe`（`build/tools/`，约 1 MB）与 `whisper/`；
  **开发态**直接用项目根 `resources/`，不走下载与解包。
  访问不到更新源的机器可以在设置页用「从本地文件安装…」直接导入一个 `ffmpeg.7z` / `hyperframes.7z`。

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
- **④ 字幕生成 HTML**：两个并列按钮「生成 HTML」/「按需求修改」+ **每个动作按钮内部各带一个 `?`** 悬浮说明（一个动作一个、只讲自己那个动作；动作行末尾不再有独立 `?`；无 HTML 时「按需求修改」禁用；「生成 HTML」点一次即执行、无二次确认；主进程 `project:generate-html` / `project:modify-html` 两个频道各自独立、未合并）、Agent 流式生成 / 修改、思考过程实时展示、输出为空自动升档重试、素材注入（字幕 / 视频）、**背景音轨由应用注入 HTML**、1920×1080 等比预览与播放控制、下载 HTML、**转视频（含质量 / 帧率档位）**、会话记录落盘。
- **生成契约与 HyperFrames 对齐 + GSAP 本地化**：提示词要求 `gsap.timeline({ paused: true })` 与「以 composition id 为键的 `__timelines` 对象」（与官方文档一致）；GSAP 改为随包 `vendor/gsap/gsap.min.js` + 项目内相对引用，生成 / 保存 / 预览 / 渲染四环节自动改写残留 CDN 引用，预览控制脚本同时兼容旧生成物的数组形态。
- **⑤ 视频预览与转视频**：合规校验、HyperFrames 后台渲染与中文进度文案、**渲染档位（设置页全局默认 + 项目级覆盖）**、成品内嵌播放与「重新加载」「在文件夹中显示」、产物回写项目。
- **项目化**：创建（弹窗输入名称 → 立即创建并切换）/ 切换 / 删除、字幕与内容脚本保存、背景音频与视频素材管理（含提取原声）、`hgpreview://` 预览协议。
- **工程化**：TypeScript 全量覆盖（`npm run typecheck` 全绿）、IPC 载荷类型集中在 `shared/types.ts` 并作为 `window.*` 的唯一真源、CSP/sandbox/contextIsolation 安全边界、electron-builder 打包配置完备（ffmpeg / hyperframes 两个运行环境包**不随安装包**，用到时由用户在应用内确认后下载，见上文「外部依赖 · 运行环境分包」）、**Electron 升级到 44.7.0**（HyperFrames 复用 Electron 内嵌 Node，`resources/node/node.exe` 那 83 MB 已整条删除）、安装包只保留中英两套 Chromium 语言包（`build.win.electronLanguages`，从 55 个 `.pak` 48.3 MB 收到约 1.1 MB）。
- **文档与变更记录**：`wiki/` 是源码级知识库，[`CHANGELOG.md`](CHANGELOG.md) 是唯一的更新日志——**一个版本一个区块，每次修改追加一条**（`[新增]`/`[修改]`/`[修复]`/`[重构]`/`[优化]`/`[文档]`/`[工程]` + 影响范围 + 验证方式）；同一功能在当前版本改到第 2 次标 `[完整版]`，所以每次发布都能直接看到这一版改了什么。约定见 [`AGENTS.md`](AGENTS.md) 第三节与关键约定第 3、4 条。

### 已知限制与说明

- **识别模型不随包分发**：首次转录前必须在设置页下载模型，`whisper-cli.exe` 缺失会直接阻塞转录。
- **VAD 静音裁剪无开关**：阈值与窗口为固定常量，背景噪声较大时可能整体不生效（保守行为）。
- **对齐配音**：单句最多加速到 1.15 倍，超出靠顺延；末句无槽位、不加速也不顺延；同一时刻只允许一个对齐任务，取消是句间软中断（当前句的合成请求不会被打断）。
- **本地音频格式**：whisper-cli 原生只支持 flac/mp3/ogg/wav（其它格式会先自动转码）；克隆音色上传的本地音频 Base64 后需小于 10 MB；VAD 只解析 16 bit PCM WAV。
- **API Key 以明文保存在本机 `userData/settings.json`**，仅主进程读取，不会外传；如需更高安全性可后续接入 Electron `safeStorage` 加密。
- **HyperFrames 复用 Electron 内嵌 Node 依赖 `RunAsNode` 熔丝**：默认开启时用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 即可当 Node 用；**若将来在 `package.json` 的 `build.electronFuses` 里把该熔丝关掉**，`findNode()` 的探针会失败并静默回落到系统 Node——不报错，但那时必须重新提供一份 Node（把 `resources/node/node.exe` 放回来并让它进运行环境包，或把「系统 Node ≥ 22」变成硬性前置）。
- **首次启动要下载运行环境**：安装包**不再包含** ffmpeg 与 hyperframes（**实测安装包 257.6 MB → 105.08 MB**，这就是原因）。启动时只**探测**并显示「运行环境需要下载」，不偷偷下载；等用户第一次点「转成视频 / 提取原声 / 逐句对齐」（或需要转码的转录）时，弹确认框说明要下什么、多大（**实测：ffmpeg 42.6 MB、hyperframes 103.1 MB，两个都下约 146 MB**，与旧版单包 147.4 MB 基本持平），用户点「下载运行环境」才开始（可取消；取消＝不下载且那次操作一并作废）。装好后框里的按钮变**「继续」**，点它才接着做刚才那件事（**不会自动开始**）。转录本身不受影响：`whisper-cli.exe` 随安装包，装完即离线可用。
- **运行环境下载可断点续传**：包写在 `%APPDATA%\shadowmill\runtime\downloads\<包名>-<id>.7z.part`，网络中断后再试会接着下（服务端需支持 `Range`，OSS 默认支持）；只有用户点「取消」才清掉残片。旧版本（安装包里带 `runtime.7z` 那几版）升级上来的用户会**继续沿用**已解开的 `runtime/<旧id>/` 目录，只有某个包确实有更新时才下载它，两个包都就位后旧目录（632 MB）自动清理。
- **首次启动不再解包运行环境**：安装包里没有 ffmpeg / hyperframes（只有代码 + `whisper/`），所以首启没有「正在准备运行环境 x%」这段等待，也不再往 `%APPDATA%\shadowmill\runtime\` 解 632 MB。**下载与解包只发生在用户确认之后**（见上一条），装完即用；只有用户升级自旧版本（安装包里带 `runtime.7z` 的那几版）时，应用才会沿用已解开的旧目录、不做任何新动作。首启仍可能慢上十几秒，那来自 Windows Defender 扫描新落盘文件与磁盘冷缓存，与应用逻辑无关。应用自身的启动开销也已压缩——`electron-updater` 与 `openai` 两个大模块改为懒加载、启动时不再重复拉取项目数据。
- **更新安装期间应用会整体消失约 1~2 分钟**：NSIS 更新是「静默卸载旧版本 → 解压复制新安装包」，期间安装目录被清空重建，**桌面 / 开始菜单快捷方式会暂时指向不存在的文件**（点击提示「文件不存在或已被移动」，属正常现象，勿重复点击），装完会自动重新打开。因此「重启安装」必须由用户显式点击（弹窗会先说明这段预期与 UAC 提权），应用**不再在关窗时自动安装**；安装成功后的首次启动会清掉 `%LOCALAPPDATA%\shadowmill-updater\pending\` 里重复的安装包（约 275 MB）。更新耗时的大头原本是 632 MB 运行资源被反复重装 —— 分包后安装包里已不含它们（见上文「外部依赖 · 运行环境分包」），且**只有某个包内容变了才会重新下载那一个包**。
- **排查启动耗时**：`%APPDATA%\shadowmill\startup.log` 每次启动追加几行，每行形如 `2026-10-12T01:02:19.780Z +4200ms window created`——`+NNNms` 是距进程启动的毫秒数，可直接看出时间花在「主进程模块加载 / 建窗 / 页面加载」哪一段。（更新日志在同目录 `updater.log`，运行环境解包日志在 `runtime.log`，预览协议日志在 `preview-protocol.log`。）旧版本（`MarvisStudio` / npm 包名 `my-app`）的 `%APPDATA%\my-app\` 会在首次启动时**自动迁移**到 `%APPDATA%\shadowmill\`（开发态同样迁移；需要保留旧目录做对照时，用 `MIGRATE_USER_DATA=0` 启动一次即可跳过）。

*（内容由AI生成，仅供参考）*
