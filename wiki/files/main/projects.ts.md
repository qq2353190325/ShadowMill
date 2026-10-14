# src/main/projects.ts

> 主进程「我的项目」项目化流水线核心：项目落盘、字幕/内容脚本、HTML 生成与 `project:*` IPC。

- **所在目录**：src/main/
- **类型**：主进程业务模块（项目化流水线 + project:* IPC）
- **规模**：924 行
- **对外导出**：
  - 函数/常量：`register`、`scanProjects`、`projectsRoot`（**函数**，见 §3）、`projectDir`、`projectFilePath`、`readProject`、`writeProject`、`ensureProject`、`parseSubtitle`、`normalizeContent`、`copyAudioIntoProject`、`copyVideoIntoProject`
  - 类型（**再导出**，定义在 `src/shared/types.ts`）：`Scene`、`ContentScript`、`Project`、`SubtitleLine` —— 本文件用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发，因此 `projects.Project` / `from './projects'` 的既有引用面不变
- **磁盘布局**：`userData\projects\<项目名>\` 下含 `project.json`（项目元数据）、`subtitle.txt`（字幕文本）、`index.html`（生成的 HTML composition）、`index.preview.html`（预览副本，按需生成）、`gsap.min.js`（按需从随包文件复制的 GSAP，供 HTML 内 `./gsap.min.js` 引用）、`audio/`（音频素材）、`video/`（视频素材）

## 1. 作用与职责

1. **项目容器管理**：把「字幕 → 内容脚本 → HTML → 视频」全链路状态收敛到 `userData\projects\<项目名>\project.json`，提供建/读/写/扫/删。
2. **字幕解析**：把用户书写的字幕文本解析成带秒级（可含毫秒小数）起止时间的结构化行，供时间轴对齐（`ttsAlign.ts`）与 HTML 生成使用。
3. **HTML 生成与修改**：把手写字幕、内容脚本、视频素材拼装成提示词，调用自定义模型 Agent（`htmlAgent`）产出/改造 `index.html`，并做 HyperFrames 合规校验。**背景音频不再是生成素材**（不进提示词、也不交给 Agent）：音轨由本文件按 `project.audioFile` 确定性注入 HTML，见第 3.5 节与 5.11。
4. **背景音轨注入**：`applyBgmToHtml()` 按 `project.audioFile` 重写 `index.html` 里固定 id 的 `<audio id="myv-bgm" src="audio/…" autoplay loop>`（幂等）；共 6 处调用点（`set-audio` / `clear-audio` / `extract-video-audio` / `generate-html` / `modify-html` / `save-html`），保证预览副本与转视频用的原件都带音轨。
5. **素材归置**：外部音频/视频复制进项目目录（`audio/`、`video/`）并以相对引用记录，保证 HTML 内相对路径与预览、转视频一致可用。
6. **GSAP 本地化与导出外部化**：生成 / 修改 / 保存 / 预览四个写盘环节把 HTML 里的 GSAP CDN 引用改写为项目内 `./gsap.min.js`（`hfEnv.localizeGsapHtml`），并在需要时把随包 `vendor/gsap/gsap.min.js` 复制进项目目录（`hfEnv.copyGsapIntoProject`）——三个**作者态**写盘点（generate / modify / save-html）还会用复制返回值做兜底：复制失败就把引用换回 CDN（`hfEnv.externalizeGsapHtml`），宁可联网也不引用不存在的文件。两个导出频道同样反向调用 `externalizeGsapHtml`，保证导出的单个 HTML 文件放到别处也能独立打开。
7. **IPC 网关**：在 `register(ctx)` 中注册全部 `project:*` 频道，供渲染层完成项目列表、生成、预览、导出、素材选择、产物回写等操作。

## 2. 数据结构

> 本节四个结构（`Scene` / `ContentScript` / `Project` / `SubtitleLine`）**已上移到 `src/shared/types.ts` ⑥ 节**（跨进程单一真源），本文件靠顶部的 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 再导出以保持既有引用面；各 IPC handler 的 `payload` 参数同样改用共享层的 `Project*Payload` 类型。字段语义如下（与源码逐字一致）。

### 2.1 `Scene`（内容脚本中的单个场景）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 场景唯一标识；缺失/空时由 `normalizeContent` 自动补 `scene-<base36 时间>-<索引>-<序号>` |
| `narration` | `string` | 场景旁白（内容脚本的有效性判定依据，仅非空旁白的场景会进入提示词） |
| `visual` | `string` | 画面分镜描述 |
| `durHint` | `string` | 时长提示（字符串，用于提示模型节奏） |

### 2.2 `ContentScript`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `style` | `string` | 全局视觉风格描述 |
| `scenes` | `Scene[]` | 场景数组 |

### 2.3 `Project`（= `project.json` 落盘字段）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | 项目名（目录名，非法字符 `\ / : * ? " < > \|` 会被替换为 `_`） |
| `title` | `string` | 是 | 展示标题，缺省使用 `字幕动画` |
| `subtitle` | `string` | 是 | 字幕原文 |
| `subtitleCount` | `number` | 否 | 字幕条目数，由 `parseSubtitle(subtitle).length` 统计 |
| `htmlPath` | `string` | 是 | `index.html` 的**绝对路径**（空串表示未生成） |
| `videoPath` | `string` | 是 | 转视频产物路径（HTML 变更后会被置空表示失效） |
| `videoMaterial` | `string` | 否 | **视频素材**相对引用（`video/xxx`，与成品 `videoPath` 严格区分） |
| `audioFile` | `string` | 是 | 背景音频相对引用（`audio/xxx`，空串表示无）；同时是注入 HTML 音轨（`<audio id="myv-bgm">`）的唯一来源，见 3.5 |
| `content` | `ContentScript` | 是 | 内容脚本（`style` + `scenes`） |
| `createdAt` | `string` | 是 | ISO 时间字符串 |
| `updatedAt` | `string` | 否 | 每次 `writeProject` 自动刷新为 ISO 时间，列表按此倒序 |

### 2.4 `SubtitleLine`（`parseSubtitle` 输出）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `n` | `number` | 行号（从 1 开始；被跳过的空文本行仍会占用行号，故可能出现跳号） |
| `text` | `string` | 该行文本（已 trim） |
| `time` | `number` | 开始时间，单位秒，可含小数（毫秒精度） |
| `end` | `number \| null` | 结束时间，单位秒；无结束时间或解析出的结束不大于开始时为 `null` |

## 3. 内部实现函数

> **`projectsRoot` 自本轮起由「模块级常量」改为「函数」**（2026-10 品牌改名事故修复）。原因（源码注释要点）：ESM 的 `import` 提升会让本模块在 `index.ts` 的模块体之前求值；**当前 userData 位置只跟随 `package.json` 的 `name`，模块级快照本来也正确**——但只要将来有任何「在模块体里改 userData 位置」的代码（例如重新引入 `app.setPath`），快照就会静默钉在**当时**的 userData 上，表现为「项目全没了」且极难查。写成函数永远按当前值解析，代价为零，属**纯保险**。
>
> ```ts
> function projectsRoot(): string {
>   return path.join(app.getPath('userData'), 'projects');
> }
> ```
>
> 这与 `whisper.modelsDir()` / `runtime.runtimeDir()` / `settings.settingsFile()` 是同一约定：**业务模块的 userData 路径一律惰性求值**（零代价纯保险，详见 [index.ts.md](./index.ts.md) §3.1① 与 §5）。
>
> **三个内部调用点**（导出名不变，导出的现在就是这个函数）：
>
> | 位置 | 写法 |
> | --- | --- |
> | `projectDir(name)`（函数体里的 `path.join(projectsRoot(), …)`；当前约在第 52 行，**行号随代码变动，仅供大致定位**） | `path.join(projectsRoot(), 净化后的项目名)` |
> | `scanProjects()`（函数开头那行 `const root = projectsRoot()`；当前约在第 117 行） | 先 `const root = projectsRoot()`，后续只用 `root`（`existsSync` / `readdirSync`） |
> | `IPC.Project.Delete`（`ipcMain.handle(IPC.Project.Delete, …)` 里的 `dir.startsWith(projectsRoot())`；当前约在第 698 行） | `dir.startsWith(projectsRoot())` 前缀校验 |

| 名称 | 导出 | 说明 |
| --- | --- | --- |
| `projectsRoot()` | 是 | **函数**：`path.join(app.getPath('userData'), 'projects')`，所有项目目录的根；每次调用都重新求值（惰性），调用点不得把它缓存成模块级常量 |
| `projectDir(name)` | 是 | 拼接项目目录；把 `name` 中 `[\\/:*?"<>|]` 替换为 `_` 防非法路径 |
| `projectFilePath(name, file)` | 是 | `path.join(projectDir(name), file)`，项目内文件绝对路径 |
| `readProject(name)` | 是 | 读取并 `JSON.parse` `project.json`；文件不存在或解析异常返回 `null`（静默容错） |
| `writeProject(proj)` | 是 | 递归创建目录，刷新 `updatedAt`，以 `JSON.stringify(proj, null, 2)`、`utf8` 落盘并返回 `proj` |
| `ensureProject(name)` | 是 | 已有项目则读取并回填 `name`；否则返回默认项目（`title='字幕动画'`、空 `subtitle`/`htmlPath`/`videoPath`/`audioFile`、`content={style:'',scenes:[]}`、`createdAt=now`）；**不落盘** |
| `normalizeContent(raw)` | 是 | 内容脚本规范化：非对象按空处理，`style` 非字符串置 `''`，逐场景做类型收敛并补 `id`，实现旧数据向后兼容 |
| `scanProjects()` | 是 | 扫描 `projectsRoot()` 各子目录，跳过无 `project.json` 者，返回 `{ name, title, hasSubtitle, hasHtml, hasVideo, subtitleCount, updatedAt }`，按 `updatedAt` 倒序 |
| `parseSubtitle(text)` | 是 | 解析字幕：支持 `[分:秒] 文本`、`[分:秒-分:秒] 文本`（小数位数即精度，3 位=毫秒）与纯文本自动估时 |
| `copyAudioIntoProject(name, audioPath)` | 是 | 复制音频到 `audio/`，重名自动追加 `_1`…`_1000`，返回 `audio/文件名`；失败返回 `''` |
| `copyVideoIntoProject(name, videoPath)` | 是 | 复制视频到 `video/`，命名规则同上，返回 `video/文件名`；失败返回 `''` |
| `buildAgentPrompt(parts)` | 否 | `parts.filter(Boolean).join('\n')`，拼接提示词片段 |
| `buildContentBlock(content)` | 否 | 由 `content` 生成「内容脚本」提示块；无有效场景（旁白全空）返回 `''`，老项目因此回退原流程 |
| `HG_PREVIEW_CTRL` | 否 | 注入预览副本的播放控制脚本源码（IIFE 字符串常量） |
| `BGM_TAG_ID` | 否 | 注入音轨标签的固定 id 常量 `'myv-bgm'`——保证重复设置不叠出多条音轨（见 3.5） |
| `insertHtmlSnippet(html, snippet)` | 否 | 把片段插到文档末尾：优先 `</body>` 前，其次 `</head>` 后，都没有则拼最前。`IPC.Project.PreviewHtml` 原先内联的同一段 if/else 已改为调用本助手（行为不变） |
| `escapeRegExp(s)` | 否 | 转义正则元字符（供 `stripAudioOfFile` 把音频文件名安全拼进正则） |
| `stripInjectedBgm(html)` | 否 | 按 `BGM_TAG_ID` 摘掉本应用注入的音轨标签（幂等） |
| `stripAudioOfFile(html, audioRef)` | 否 | 摘掉引用同一项目音频文件的历史 `<audio>`（旧版由模型按提示词写入），避免与新标签双份播放 |
| `applyBgmToHtml(name, proj?)` | 否 | 按 `proj.audioFile` 重写 `index.html` 的音轨；无 HTML 时静默返回 `false`，内容无变化不写盘；返回 `true` = 文件被改写（见 3.5） |
| `resolveMaterials(proj, payload: ProjectAgentPayload)` | 否 | 解析 `subtitleProject` / `videoPath` 两个选择项，返回 `{ subtitleText, videoRef }`（**两个选择项都只是「要不要带上」，都不带路径**：视频的自定义导入走 `project:set-video`，音频则由 `applyBgmToHtml` 注入 HTML、完全不经过本函数；形参里原先不再使用的 `name` 已删除，两个调用点都写作 `resolveMaterials(proj, payload \|\| {})`；载荷类型取自 `shared/types.ts`，此前为 `Record<string, unknown>`） |
| `buildMaterialPrompt(prompt, proj, mats, extra)` | 否 | 生成/修改共用的提示词装配：`extra`（修改时为当前 HTML 源码）在最前，随后需求、内容脚本、字幕、【音轨】声明、视频素材（`mats` 形参已收窄为 `{ subtitleText, videoRef }`） |
| `progressText(info)` | 否 | 把 `AgentProgress.stage` 转为中文进度文案（连接/推理/生成/重试/完成） |
| `register(ctx?)` | 是 | 注册全部 `project:*` IPC；`ctx.getWindow` 用于给各类对话框提供父窗口 |

### 3.1 `parseSubtitle` 细节

- 匹配正则：`^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?(?:\s*-\s*(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?)?\]\s*(.*)$`，即分/秒、毫秒可选、起止区间可选。
- 小数解释：`frac(digits) = (+digits) / 10^digits.length`（`.9` = 0.9s、`.900` = 0.9s）。
- 纯文本自动估时：首行 0.4s，之后每行步进 `Math.max(2.4, 1.6 + 文本长度 * 0.15)` 秒。
- 结束时间仅在 `e > time` 时写入，否则保持 `null`。
- 文本为空的行被跳过（不产出条目），但 `lineNo` 仍自增。

### 3.2 `HG_PREVIEW_CTRL`（预览播放控制脚本）细节

- 以 `window.__hgPreviewCtrl` 标记防重复注入。
- `rawTimelines()`：**只取真实的 `window.__timelines`**，两种形态都收——`Object.prototype.toString.call(t) === "[object Array]"`（旧版生成物的数组形态）→ `t.slice()`；`t` 是对象 → `for (var k in t)` 遍历取值、只收真值（HyperFrames 契约：以 composition id 为键的对象）；取不到返回 `[]`。
- `timelines()`：`rawTimelines()` 非空就返回它；否则兜底 `[window.gsap.globalTimeline]`（没有 `gsap` 时返回 `[]`）。**判定「有没有真实时间轴」一律用 `rawTimelines()`**（`watchEnd()` 同样只看它）。
- `setPaused(p)`：暂停/恢复 GSAP 时间轴 + 页面 `audio, video` 元素 + `document.getAnimations()`。恢复侧**只对确实处于暂停的对象动手**：timeline 先判 `t.paused && t.paused()` 才 `resume()`、媒体先判 `ms[i].paused` 才 `play()`、WAAPI 先判 `a.playState === "paused"` 才 `play()`（源码注释：对正在跑或已播完的对象反复 resume/play，会把动画重头播一遍）。
- `isPlaying()`：**「播完不算在播」**——timeline 先 `if (t.paused && t.paused()) return;`，再 `if (t.progress && t.progress() >= 1 && (!t.repeat || t.repeat() >= 0)) return;`（源码注释：GSAP 时间轴跑完后 `paused()` 仍是 `false`，只看 `paused` 会让按钮永远停在「暂停」）；媒体检查不变（任一 `!paused` 即算在播）。结果回给父页用于校准「暂停/播放」按钮。
- `clock()`：**优先遍历 `rawTimelines()` 取 `t.duration()` / `t.time()` 的最大值**（进度条要反映「这条动画多长」，而不是页面里恰好嵌着的素材多长）；只有 `dur <= 0`（没有真实时间轴，如老生成物 / 纯 CSS 动画页）时才退回「`document.querySelector("audio, video")` 的 `duration`/`currentTime`」与「`gsap.globalTimeline` 的 `duration()/time()`」取大者。源码注释给出实例：3:45 的视频素材塞进 10 秒合成时，旧实现把总时长显示成 `03:45`、进度跟着素材跑，而素材是 `loop` 的 ⇒「自然播完」判定 `time >= dur - 0.25` 永远等不到。
- `setTime(raw)`（父页发 `type: 'seek'` 时调用，载荷 `{ __hg: true, type: 'seek', seconds }`）：`Number(raw)` 非有限数或为负则直接 `return`；否则 `timelines().forEach((t) => t.time(s))`（GSAP 播放头定位，**播放中也安全**——从新位置继续跑）+ 逐个 `document.querySelectorAll("audio, video")`「时长有效且 `s <= duration` 时写 `currentTime = s`」（越界的素材跳过）+ `document.getAnimations()` 逐个 `a.currentTime = s * 1000`。**只挪播放头，不改播放/暂停状态**。
- **载入后保持静止（已无 `kick` / `userPaused`）**：`userActed`（用户发来任何 `pause` / `play` / `seek` / `restart` 消息即置真）、`report(ack)`（把原 `setInterval` 里的上报抽成函数，载荷 `{ __hg: true, type: 'progress', time, dur, playing: isPlaying(), ack: !!ack }`）、`freeze()`（`if (userActed) return; setPaused(true); report(false);`）与 `freezeLoop`（`document.readyState === "complete"` 时 `setTimeout(freezeLoop, 0)`，否则挂 `load` 事件再 `setTimeout`；每 250ms 补一次、最多 5 次，`userActed` 后立即停手）。源码注释：合成是 `gsap.timeline({ paused: true })` 创建、开头又普遍 `gsap.set(..., { opacity: 0 })`，所以**「什么都不做」就是停在第 0 帧——首帧本来就是空的，不是加载失败**；播放交给用户（「播放」按钮 / 拖动进度条）；顺带把页面里带 `autoplay` 的 `<audio>/<video>` 一起冻住，并立刻上报一次，让父页按钮文案与总时长第一帧就对。
- **播完就整体停住 `watchEnd()`**（300ms 的 `setInterval` 里先 `watchEnd()` 再 `report(false)`）：真实时间轴全部满足 `time() >= duration() - 0.05` 时 `setPaused(true)` + `report(false)`，用 `ended` 标志防重复；`repeat() < 0`（无限循环）的合成永远不算播完；没有真实时间轴（媒体页 / 老生成物）不干预。注释理由：合成的媒体元素普遍带 `loop`，时间轴跑完后媒体还在后台一直转（画面看着「结束了」、元素还耗 CPU、按钮一直显示「暂停」）。
- 监听父窗口 `postMessage`：`d.__hg` 为真时**先置 `userActed = true`**（用户接管 ⇒ `freezeLoop` 立即停手），`type` 为 `pause`（`setPaused(true)`）/ `play`（`setPaused(false)`）/ `seek`（`{ setTime(d.seconds); report(true); }`——**带 ack**，父页据此把进度条钉在目标位置）/ `restart`（`location.reload()`）。
- 每 300ms 向 `parent` 发送进度（`watchEnd(); report(false)`），载荷见上（含 `playing` 与 `ack` 两个给父页校准用的字段）。
- 副本被单独打开时没有额外 UI，也**不再自动播放**：脚本只会把画面冻在第 0 帧（首帧本就是空的）。

### 3.3 `resolveMaterials` 选择项语义

| 载荷字段 | 取值 | 行为 |
| --- | --- | --- |
| `subtitleProject` | `''` / 缺省 | 不使用字幕 |
| `subtitleProject` | `'__current__'` | 使用当前项目 `proj.subtitle` |
| `subtitleProject` | 其他字符串（项目名） | 读取该项目字幕作为本次素材 |
| `videoPath` | `''` / 缺省（含其他任何值） | 不使用视频素材 |
| `videoPath` | `'__current__'` | 沿用 `proj.videoMaterial` |

**视频只判 `'__current__'`**：实现就是一行 `const videoRef = payload.videoPath === '__current__' ? (proj.videoMaterial || '') : '';`——**外部绝对路径不再在这里复制进项目**（原 `copyVideoIntoProject` 分支已删除），自定义导入统一走 `project:set-video`（复制进 `video/` 并登记 `proj.videoMaterial`，见 §4 的 `project:set-video` 行）；因此本函数既不看文件是否存在，也不改动项目目录。

**音频选择项已删除**：`ProjectAgentPayload` 不再有 `audioPath`（`shared/types.ts` 的 `ProjectHtmlMaterials` 同步删字段），`resolveMaterials` 也不再返回 `audioRef`。背景音频不是生成素材——它由 `applyBgmToHtml` 按 `project.audioFile` 直接写进 HTML，提示词里只声明「不要写音轨标签」（见 3.5）。`copyAudioIntoProject` 仍由 `project:set-audio` 使用。

### 3.4 `progressText` 文案映射

| `stage` | 输出文案 |
| --- | --- |
| `connecting` | 正在连接模型… |
| `thinking` | AI 正在推理中…（已思考 N 字符） |
| `writing` | AI 正在生成 HTML…（已输出 N 字符） |
| `retry` | 本次输出为空，正在升档重试… |
| `done` | 模型输出完成，正在写入文件… |

### 3.5 背景音轨注入（`BGM_TAG_ID` + 5 个助手）

**动机**：旧版把 `<audio autoplay loop>` 写进提示词、让模型照着写，结果模型经常漏写、写错路径或与页面动画打架；现在改为**主进程确定性注入**——音频不再是生成素材，Agent 侧只被要求「不要写音轨标签」。

常量为 `BGM_TAG_ID = 'myv-bgm'`（注入标签的固定 id），五个助手都是文件内私有函数（源码位置：`HG_PREVIEW_CTRL` 之后、「素材选择结果」注释之前）：

| 助手 | 行为 |
| --- | --- |
| `insertHtmlSnippet(html, snippet)` | `lastIndexOf('</body>')` 命中则插在它前面；否则退回 `lastIndexOf('</head>') + 7`（即 `</head>` 之后）；两者都没有则把片段拼在文档最前。注释说明原因：模型输出可能被截断而缺 `</body>`，此时直接拼在文件末尾会落进未闭合的 `<script>`，导致整页 SyntaxError（`fitStage` / 时间轴全失效）。`IPC.Project.PreviewHtml` 里原来内联的同一段 if/else 已改为调用本助手，**行为不变** |
| `escapeRegExp(s)` | `String(s).replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')`，把音频文件名安全拼进正则 |
| `stripInjectedBgm(html)` | 用 `'<audio\\b[^>]*\\bid=["\']myv-bgm["\'][^>]*>(?:[\\s\\S]*?</audio>)?'`（`gi`）全量替换为空——摘掉本应用注入的标签（幂等） |
| `stripAudioOfFile(html, audioRef)` | 先 `path.basename(audioRef)` 取文件名（空则原样返回），再用转义后的文件名拼正则，摘掉 `src` 里含该文件名的**任意** `<audio>`——清理旧版由模型按提示词写入的历史标签，避免与新标签双份播放 |
| `applyBgmToHtml(name, proj?)` | 见下面的算法 |

`applyBgmToHtml(name, proj?)`（返回 `boolean`）：

1. `projectFilePath(name, 'index.html')` 不存在 → 直接 `false`（还没生成 HTML 时静默跳过，调用方无需分支）。
2. `proj` 缺省时 `readProject(name)`；`audioRef = (p && p.audioFile) \|\| ''`。
3. 读原文 `before` → `stripInjectedBgm(before)`；若 `audioRef` 非空再 `stripAudioOfFile(html, audioRef)`（**先摘后插**，保证幂等）。
4. 若 `audioRef` 非空，`insertHtmlSnippet(html, '<audio id="myv-bgm" src="' + audioRef + '" autoplay loop></audio>')`——`autoplay + loop` 与旧提示词要求一致（音轨通常短于整条时间轴）。
5. `html === before` → 返回 `false`（**内容无变化不写盘**，避免无谓的 mtime 抖动）；否则 `writeFileSync` 后返回 `true`。
6. 整个读改写包在 `try/catch` 中，异常一律 `false`（不抛异常、不阻断调用方主流程）。

**为什么标签要带固定 id**：`set-audio` / `extract-video-audio` 会被反复调用（换音频），固定 id 让「先摘再插」成为幂等操作，否则 HTML 里会随每次设置叠出一条音轨。

**为什么音轨不交给 Agent**：模型重写整页时可能整段丢掉注入标签，且提示词里的素材块越多越容易顾此失彼；改为「模型只声明、主进程负责写」，并在生成/修改写盘后再补一次注入（见 5.11）。

## 4. IPC 频道一览

`register()` 共注册 **24 个 `ipcMain.handle` 频道**，并额外使用 1 个主→渲染推送频道。返回统一为 `{ ok, ... }` 结构。下表的「参数载荷」列在括号内给出源码中的标注类型（均来自 `src/shared/types.ts` ⑥ 节），handler 形参一律写作 `payload?: <类型>`。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
| --- | --- | --- | --- |
| `project:list` | 无 | `scanProjects()` 数组 | 列出「我的项目」，按 `updatedAt` 倒序 |
| `project:create` | `name?: string`（裸字符串） | `{ ok, project }` / `{ ok:false, message }` | 空名、含 `\ / : * ? " < > \|`、同名已存在均拒绝；通过则 `ensureProject` + `writeProject` |
| `project:load` | `name?: string`（裸字符串） | `Project` \| `null` | 无名字返回 `null`；否则 `readProject(name) || ensureProject(name)`（不落盘） |
| `project:save-subtitle` | `ProjectSaveSubtitlePayload`（`{ name?, subtitle?, title? }`） | `{ ok, project }` | 写 `subtitle.txt`（utf8）；`title` 非空才覆盖；同步 `subtitle` 与 `subtitleCount` |
| `project:save-content` | `ProjectSaveContentPayload`（`{ name?, content? }`） | `{ ok, project }` | 经 `normalizeContent` 归一化后整体保存 `content` |
| `project:generate-html` | `ProjectAgentPayload`（`{ name, prompt, subtitleProject?, videoPath? }`，**已无 `audioPath`**） | `{ ok, htmlPath, compatible, message }`；失败 `{ ok:false, message, needConfig?, title? }` | 解析素材（字幕 / 视频）→ 装配提示词 → `chatWithCustomModel` → `extractHtmlFromReply` → `hfEnv.localizeGsapHtml` 本地化 → 引用本地时 `copyGsapIntoProject`，**复制失败则 `externalizeGsapHtml` 退回 CDN** → 写 `index.html` → **`applyBgmToHtml` 补注入音轨**；置空 `videoPath` |
| `project:modify-html` | 同 `project:generate-html`（同一 `ProjectAgentPayload`） | `{ ok, htmlPath, compatible, message }`；失败 `{ ok:false, message, needConfig?, title? }` | 需已有 `index.html`；把当前源码作为 `extra` 前置，Agent 输出完整新 HTML 后**同样先本地化、再按复制结果决定是否退回 CDN**，覆盖写盘后**再 `applyBgmToHtml` 补回音轨**（模型重写时可能整段丢掉注入标签） |
| `project:download-html` | `name?: string`（裸字符串） | `{ ok, savedPath }` / `{ ok:false, canceled:true }` | 「另存为」导出项目 `index.html`（默认文件名 `<name>.html`）：读原文 → `hfEnv.externalizeGsapHtml` 把 `./gsap.min.js` 换回固定版本 CDN → **文本写出**（不再 `copyFileSync`），理由见 5.9 |
| `project:export-srt` | `ProjectExportSrtPayload`（`{ name?, srt? }`） | `{ ok, savedPath }` | 内容为空则拒绝；否则写 `.srt` 文件（utf8） |
| `project:open-folder` | `name?: string`（裸字符串） | `{ ok, message }` | `await shell.openPath(projectDir)`；目录不存在提示「项目目录不存在（项目尚未保存）」 |
| `project:open-folder-of` | `p?: string`（裸字符串） | `{ ok, dir }` | 入参可以是文件或目录：是文件则取其所在目录；目录存在才 `shell.openPath`。源码注释：「打开指定文件所在目录 / 指定目录（配音、对齐、音色等页面的「打开目录」入口）」 |
| `project:delete` | `name?: string`（裸字符串） | `{ ok }` / `{ ok:false, message }` | 仅允许删除 `projectsRoot()` 下的目录（`dir.startsWith(projectsRoot())` 校验），`rmSync(..., { recursive: true, force: true })` |
| `project:save-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`，与 `set-video` 同形复用一个类型） | `{ ok, project }` | 视频渲染完成后回写产物路径（点亮链路「视频」节点） |
| `project:set-render` | `ProjectSetRenderPayload`（`{ name?, render?: RenderOverride \| null }`） | `{ ok, project }` | 写 / 清除**项目级渲染档位覆盖**：`render` 传 `null`（或字段全非法）即删除 `proj.render`，回到跟随 `settings.json` 的全局默认 |
| `project:pick-audio` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp3/wav/m4a/aac/ogg/flac/mp4`），取消返回 `null` |
| `project:set-audio` | `ProjectSetAudioPayload`（`{ name?, audioPath? }`） | `{ ok, audioFile, htmlUpdated }` | 校验文件存在 → 复制进 `audio/` → 写入 `proj.audioFile` → `applyBgmToHtml` 立即重写 HTML 音轨；`htmlUpdated` = 是否真的改写了 `index.html` |
| `project:clear-audio` | `ProjectNamePayload`（`{ name: string }`） | `{ ok, htmlUpdated }` | 仅清空 `proj.audioFile` 引用（保留音频文件，避免误删），并由 `applyBgmToHtml` 把 HTML 里注入的 `<audio>` 一并摘掉（否则成片仍有声、与项目状态不符） |
| `project:pick-video` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp4/webm/mov/mkv/m4v/avi`） |
| `project:set-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`） | `{ ok, videoFile, abs }` | 复制进 `video/` → 写 `proj.videoMaterial`；`abs` 为项目内绝对路径供预览 |
| `project:clear-video` | `ProjectNamePayload`（`{ name: string }`） | `{ ok }` | 仅清空 `proj.videoMaterial` 引用（保留视频文件） |
| `project:extract-video-audio` | `name?: string`（裸字符串） | 成功 `{ ok, audioFile, htmlUpdated }`；**缺 ffmpeg 运行环境包时 `{ ok: false, needPacks: ['ffmpeg'], message }`** | 先按 `FFMPEG_PACKS = ['ffmpeg']` 做缺包纯校验（不下载、不阻塞），通过后用 ffmpeg 从 `videoMaterial` 提取音轨为 `audio/<同名>.m4a`（AAC 192k）并设为背景音频，随后 `applyBgmToHtml` 立即注入 HTML（提取出的原声同样走音轨路线） |
| `project:read-html` | `name?: string`（裸字符串） | `{ ok, html }` | 读取当前 `index.html` 源码供编辑器载入 |
| `project:preview-html` | `name?: string`（裸字符串） | `{ ok, previewPath }` | 生成去掉 CSP、**对副本做 GSAP 本地化**、注入 `HG_PREVIEW_CTRL` 的 `index.preview.html` 副本；注入片段落位复用的是音轨注入同一助手 `insertHtmlSnippet()` |
| `project:save-html` | `ProjectSaveHtmlPayload`（`{ name?, html? }`） | `{ ok, htmlPath, compatible }`（**未新增 `htmlUpdated`**） | 先 `hfEnv.localizeGsapHtml` 改写 CDN 引用（**合规校验也用改写后的 `localHtml`**），再在引用本地时 `copyGsapIntoProject`、**复制失败则 `externalizeGsapHtml` 退回 CDN**，然后覆盖保存编辑器中的 HTML；置空 `videoPath` 表示旧视频失效；随后调 `applyBgmToHtml` 把音轨补回（手改 / 粘贴进来的 HTML 可能没有音轨）。该频道目前在渲染层**没有调用方**（预留接口） |
| `project:html-progress` | 主→渲染推送：`Object.assign({}, info, { text })`（线上形状即 `HtmlProgressPayload`） | — | 生成/修改过程中由 `event.sender.send` 推送 Agent 进度（`sender.isDestroyed()` 时不发送） |

## 5. 关键流程

### 5.1 新建项目（`project:create`）

1. 取 `String(name || '').trim()`，为空返回「项目名不能为空」。
2. 正则 `/[\\/:*?"<>|]/` 命中则返回「项目名含非法字符（\ / : * ? " < > |）」。
3. `readProject(n)` 命中则返回「项目「n」已存在」。
4. `ensureProject(n)` 生成带 `createdAt` 的默认项目对象。
5. `writeProject(proj)` 递归建目录、写 `project.json`（`updatedAt` 同时刷新）。
6. 返回 `{ ok: true, project }`。

### 5.2 生成 HTML（`project:generate-html`）

1. 校验 `name` 与 `prompt.trim()`，任一为空直接失败。
2. `ensureProject(name)` 取项目（无则用默认值），`resolveMaterials(proj, payload || {})` 处理字幕 / 视频素材——**两者都只是「要不要带上」，都不带路径**：视频的自定义导入走 `project:set-video`，**音频不在这里解析**（`payload.audioPath` 已随字段删除，音轨由 `applyBgmToHtml` 注入 HTML）。
3. `buildMaterialPrompt('用户需求：' + prompt.trim(), proj, mats, [])` 装配提示词：需求 → 内容脚本块 → 字幕块 → 【音轨】声明行（固定文案：音轨由应用在渲染前自动注入 `<audio id="myv-bgm">`，请勿写入 / 修改 / 删除任何 `<audio>` 标签，也不要为音轨预留页面元素）→ 视频素材块。
4. 构造 `onProgress`，把 `progressText(info)` 的结果经 `project:html-progress` 推给发起窗口。
5. `await chatWithCustomModel(userPrompt, { onProgress, meta: { project: name, action: 'generate' } })`。
6. `extractHtmlFromReply(reply)` 抽出 HTML 后交给 `hfEnv.localizeGsapHtml()`（把 GSAP CDN 引用改写为 `./gsap.min.js`；随包文件缺失则原样返回）；`trim()` 为空返回「模型未返回内容，请检查自定义模型配置」。
7. **GSAP 落位 + 兜底**：`if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(dir)) html = hfEnv.externalizeGsapHtml(html);` —— 引用本地时先复制随包 `gsap.min.js`（幂等）；复制失败（返回 `false`）就把引用换回 CDN，避免引用一个不存在的文件。随后写 `projectDir(name)/index.html`（utf8），置 `proj.htmlPath = htmlPath` 绝对路径。
8. **`proj.videoPath = ''`**：HTML 刷新后旧视频失效，避免链路误显示成品。
9. `writeProject(proj)` 落盘，**再调 `applyBgmToHtml(name, proj)` 按当前背景音频补注入音轨**（模型侧已明确不写 `<audio>`），然后 `isHyperframesComposition(html)` 做合规校验。
10. 返回 `{ ok: true, htmlPath, compatible, message }`；不合规时提示缺 `data-composition-id / __timelines / gsap`，预览可用但转视频前需调整。
11. 异常统一捕获：先拼 `const msg = 'Agent 调用失败：' + 错误信息`，再 `return { ok: false, message: msg, ...configTargetOf(msg) }`——`chatWithCustomModel` 抛出的已经是人话文案，这里只用 `shared/errors` 的 `configTargetOf()` 复用同一张码表**补一次配置类分类**（可能多出 `needConfig` / `title`；非配置类返回 `{}`，展开后等于什么都没加）。`project:modify-html` 的 `catch` 写法完全相同。

### 5.3 修改 HTML（`project:modify-html`）

1. 校验 `name` 与需求描述。
2. `projectFilePath(name, 'index.html')` 不存在则返回「该项目还没有 HTML，请先生成」。
3. 读取当前源码 `curHtml`，`resolveMaterials(proj, payload || {})` 重新解析素材（字幕 / 视频素材，可在改造时换素材；视频同样只判 `''` / `'__current__'`）。
4. 提示词把 `['当前项目的 index.html 源码如下：', '```html', curHtml, '```', '']` 作为 `extra` 置于最前，再附需求「在此基础上改造后输出完整新 HTML」。
5. 调用 Agent（`meta.action = 'modify'`），同样支持 `project:html-progress` 进度推送。
6. 抽取 HTML 并先经 `hfEnv.localizeGsapHtml()` 本地化、再走同一套兜底（`if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(projDir)) html = hfEnv.externalizeGsapHtml(html);`）；随后**覆盖** `index.html`，更新 `htmlPath`、置空 `videoPath`、`writeProject`，**再调 `applyBgmToHtml(name, proj)` 补回音轨**（模型重写时可能整段丢掉注入标签），最后返回合规校验结果（`compatible` 基于最终写盘的 HTML）。

### 5.4 预览副本 `index.preview.html` 的生成

1. `project:preview-html` 中确认 `index.html` 存在。
2. 读取源码，用 `/<meta[^>]*content-security-policy[^>]*>/gi` 删除 CSP meta（**仅副本**，保证注入脚本可执行）。
3. **对副本做 GSAP 本地化**：`html = hfEnv.localizeGsapHtml(html)`；若结果引用 `./gsap.min.js`（`hfEnv.referencesLocalGsap`）则 `hfEnv.copyGsapIntoProject(path.dirname(htmlPath))`——只改副本、不去动原件；`gsap.min.js` 落在项目目录，因此原件里的相对引用同样成立。
4. 组装 `<script>` + `HG_PREVIEW_CTRL` + `</scr' + 'ipt>` 注入片段，调用 `insertHtmlSnippet(html, ctrl)` 落位（**与音轨注入复用同一助手**）：优先插到 `</body>`（`lastIndexOf`）前；无 `</body>`（模型输出被截断）时插到 `</head>` 之后；连 `</head>` 也没有时插到文档最前——避免拼在文件末尾落入未闭合 `<script>` 导致整页脚本 SyntaxError。该落位逻辑此前是本频道内联的 if/else，现已抽成助手，**行为不变**。
5. `htmlPath.replace(/\.html$/i, '.preview.html')` 得到 `index.preview.html` 并写盘，返回 `previewPath`。
6. 预览副本与原件**同目录**，相对素材引用仍有效（包括原件里的 `<audio id="myv-bgm">`）；下载与转视频始终使用原件 `index.html`。

### 5.5 字幕保存与条目统计（`project:save-subtitle`）

1. 校验 `name`，`subtitle` 非字符串时归 `''`，`title` 非字符串时归 `''`。
2. `fs.mkdirSync(projectDir(name), { recursive: true })` 并写 `subtitle.txt`。
3. `ensureProject(name)` 后写入 `proj.subtitle`；`title` 非空才覆盖原标题。
4. `proj.subtitleCount = parseSubtitle(subtitle).length` 统计条目数（列表页显示用）。
5. `writeProject(proj)` 落盘并返回 `{ ok: true, project }`。

### 5.6 视频产物回写（`project:save-video`）

1. 校验 `name` 与 `videoPath` 均存在。
2. `ensureProject(name)` → `proj.videoPath = String(videoPath)`。
3. `writeProject(proj)`，返回项目对象；渲染层据此点亮链路「视频」节点。
4. 与素材字段区分：`videoMaterial` 是参与 HTML 制作的输入素材，`videoPath` 是流水线产出成品。
5. `project:extract-video-audio` 先按 `FFMPEG_PACKS`（`const FFMPEG_PACKS: RuntimePackName[] = ['ffmpeg']`，第 39 行）调 `runtime.missingPacks()` 做**纯校验**：缺包立刻返回 `{ ok: false, needPacks: lack, message: '提取视频音轨需要先下载运行环境（' + runtime.packSizeText(lack) + '）' }`（**不再** `await runtime.ensureRuntime()` 等下载）；校验通过后才反向从 `videoMaterial` 提取音轨：用 `hfEnv.BUILTIN_RESOURCES.ffmpeg`（来自 ffmpeg 运行环境包）执行 `-hide_banner -loglevel error -y -i <video> -vn -ac 2 -c:a aac -b:a 192k <out>`；失败或产物为空都会清理文件并返回中文错误，成功后 `proj.audioFile = 'audio/' + outName`、`writeProject`，然后 `applyBgmToHtml` 立即把这条音轨注入 HTML，返回 `{ ok, audioFile, htmlUpdated }`。

### 5.7 目录穿越防护

- `projectDir` 对项目名中的路径分隔符与保留字符做替换，杜绝 `..\` 之类的名称注入。
- `project:delete` 校验 `dir.startsWith(projectsRoot())`，只允许删除 `userData\projects` 下的目录。
- `hgpreview` 协议处理器（`main/index.ts`）用 `projects.projectDir(name)` 得根目录，再 `path.resolve(dir, rel)`，要求结果等于 `dir` 或以 `dir + path.sep` 开头，否则返回 403。
- `project:set-audio` / `project:set-video` / `project:extract-video-audio` 均先 `fs.existsSync` 校验源文件。
- `project:open-folder-of` 只对存在的路径执行 `shell.openPath`。

### 5.8 GSAP 本地化（生成 / 修改 / 保存 / 预览四个写盘环节）

四个环节都先 `hfEnv.localizeGsapHtml(html)` 改写；差别在落位与兜底：

- **作者态三处**（generate / modify / save-html）统一写成 `if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(dir)) html = hfEnv.externalizeGsapHtml(html);`（modify 的目录变量名为 `projDir`，save-html 被改写的变量是 `localHtml`）—— 引用本地时先复制；**复制失败才把引用换回 CDN**（宁可联网也不引用不存在的文件）。因此这三处的 HTML 变量都由 `const` 改成 `let`。
- **预览**（preview-html）只改写副本、按需复制，**不使用返回值**（预览副本与原件引用一致，属同状态）。

| 环节 | 本地化的对象 | 目标目录 | 复制失败时 |
| --- | --- | --- | --- |
| `project:generate-html` | Agent 回复里抽取出的 HTML（`let html`） | `projectDir(name)` | `externalizeGsapHtml` 退回 CDN 后再写盘 |
| `project:modify-html` | Agent 回复里抽取出的 HTML（`let html`） | `path.dirname(htmlPath)`（即项目目录） | 同上 |
| `project:save-html` | 编辑器提交的 `html`（`let localHtml`，合规校验也用它） | `projectDir(name)` | 同上 |
| `project:preview-html` | 去掉 CSP 之后的**预览副本**文本 | `path.dirname(htmlPath)`（供原件与副本共同引用） | 忽略返回值（不退回） |

- `hfEnv` 侧的两个原语是「改写文本」与「幂等复制文件」；是否改写、复制到哪、失败后是否退回，由本文件决定。
- 随包 `vendor/gsap/gsap.min.js` 缺失时 `localizeGsapHtml` 原样返回；若 HTML 本来就引本地（模型照提示词写的），`copyGsapIntoProject` 返回 `false`，作者态三处随即退回 CDN，流程不报错。
- 渲染路径上还有第五处本地化（`src/main/video.ts` 对渲染工作目录里的副本再做一次），不属本文件，且**仍忽略复制返回值**。
- 反向的一步（导出时换回 CDN）见 5.9。

### 5.9 导出外部化（`project:download-html`）

导出物是**单个 HTML 文件**，目标位置同目录不会有 `gsap.min.js`；若原样导出项目内的 `./gsap.min.js` 相对引用，导出后动画会完全不跑（这是本地化引入的回归）。因此导出频道改为「文本读出 → `hfEnv.externalizeGsapHtml` 换回固定版本 CDN（`GSAP_CDN_PINNED`）→ 文本写出」。

| 频道 | 写出方式 |
| --- | --- |
| `project:download-html` | 一律 `fs.writeFileSync(save, hfEnv.externalizeGsapHtml(fs.readFileSync(htmlPath, 'utf8')), 'utf8')`（原先是 `fs.copyFileSync`） |

> 导出频道只有 `project:download-html` 一个；`project:export-srt` 是纯文本写出，不涉及 GSAP 改写。

- `externalizeGsapHtml` 不依赖 `findLocalGsap()`：随包文件缺失时照样能把本地引用换回 CDN。
- 只换回**带引号**的 `./gsap.min.js` / `gsap.min.js` / `/gsap.min.js`；无引号写法的提及不改写。
- 导出只影响落盘的那一份拷贝，**项目目录内的 `index.html` 与 `gsap.min.js` 不变**（预览/渲染仍走本地引用）。

### 5.10 项目级渲染档位覆盖（`project:set-render`）

渲染档位的三层优先级是「**项目覆盖（`project.json` 的 `render`）> 全局默认（`settings.json` 的 `render`）> 内置默认（`standard` / `30`）**」，本频道只负责中间那一层落在项目上的部分：

1. `name` 为空返回 `{ ok: false, message: '缺少项目名' }`。
2. `ensureProject(name)` 后计算 `const override = (payload && payload.render === null) ? {} : pickRenderOverride(payload && payload.render)`——`pickRenderOverride` 来自 `./settings`（与 `settings.ts`、`video.ts` 复用同一份白名单）。
3. `Object.keys(override).length` 为真 → `proj.render = override`；否则 `delete proj.render`（**清除覆盖**，字段不存在即表示跟随全局默认，而不是写入一份等于默认值的覆盖）。
4. `writeProject(proj)` 并返回 `{ ok: true, project }`，渲染层据此立即刷新 `appState.project.render` 与「是否显示恢复默认档位」。
5. 字段校验语义：只接受白名单内的显式值（`quality` ∈ `draft/standard/high`、`fps` ∈ `24/30`），任何非法值被丢弃——因此「只改质量」不会把帧率写成默认值。

### 5.11 背景音轨的六处调用点（`applyBgmToHtml`）

音轨注入不是一次性动作，而是「任何可能改动 `index.html` 或 `project.audioFile` 的写操作之后都必须补一次」：

| 调用点 | 时机 | 为什么需要 |
| --- | --- | --- |
| `project:set-audio` | `writeProject` 之后 | 选定 / 更换背景音频：立刻让预览可听、转视频带上 |
| `project:clear-audio` | `writeProject` 之后 | 移除音频：把注入的 `<audio>` 一并摘掉，否则成片仍有声 |
| `project:extract-video-audio` | `writeProject` 之后 | 提取出的原声同样立即注入（保留原声路线） |
| `project:generate-html` | 写完 `index.html` + `writeProject` 之后 | 新 HTML 落盘后补音轨（模型侧被要求不写 `<audio>`） |
| `project:modify-html` | 覆盖写盘 + `writeProject` 之后 | 模型重写时可能整段丢掉注入标签，必须补回 |
| `project:save-html` | `writeProject` 之后 | 手改 / 粘贴进来的 HTML 可能没有音轨，按项目当前背景音频补回（与生成 / 修改同一套规则） |

- 前 3 处把 `applyBgmToHtml` 的返回值作为 `htmlUpdated` 返回给渲染层（`project:set-audio` / `project:extract-video-audio` 同时保留 `audioFile`）；**`project:save-html` 有意不改返回结构**，仍是 `{ ok, htmlPath, compatible }`。
- 后 3 处（generate / modify / save-html）忽略返回值：HTML 刚写过，调用方本就按 `htmlPath` / `compatible` 处理。
- 3 个音频频道改写 HTML 后，渲染层会重载预览（`HtmlGenPage` 的 `afterAudioChange` → `loadFrame()`），因此预览副本始终与原件一致。

## 6. 依赖与协作

**本模块 import：**

| 来源 | 引入物 | 用途 |
| --- | --- | --- |
| `electron` | `app, ipcMain, dialog, shell` | `userData` 路径（每次经 `projectsRoot()` 惰性求值）、IPC 注册、文件/目录选择对话框、打开目录 |
| `node:path` / `node:fs` | `path` / `fs` | 路径拼接与全部同步文件读写 |
| `node:child_process` | `spawn` | 调用内置 ffmpeg 提取视频音轨 |
| `./htmlAgent` | `chatWithCustomModel`、`extractHtmlFromReply`、`type AgentProgress` | 调用自定义模型生成/修改 HTML、抽取回复中的 HTML、进度事件类型 |
| `../shared/errors` | `configTargetOf` | 两处 Agent 调用失败时，对**已翻译的中文文案**复用同一张码表补配置类分类（`needConfig` / `title`），供渲染层弹「去设置」；余额类不参与（它没有 `needConfig`） |
| `./hfEnv` | **命名空间导入** `import * as hfEnv from './hfEnv'`：`hfEnv.BUILTIN_RESOURCES`（取 `ffmpeg`，来自 ffmpeg 运行环境包）、`hfEnv.isHyperframesComposition`、`hfEnv.localizeGsapHtml`、`hfEnv.referencesLocalGsap`、`hfEnv.copyGsapIntoProject`、`hfEnv.externalizeGsapHtml` | ffmpeg 路径（ffmpeg 运行环境包）、HyperFrames composition 合规校验、生成 / 修改 / 保存 / 预览四个写盘环节的 GSAP 本地化，以及两个导出频道的反向外部化 |
| `./runtime` | `import * as runtime` → `runtime.missingPacks()` / `runtime.packSizeText()` | `project:extract-video-audio` 先做**缺包纯校验**（`FFMPEG_PACKS = ['ffmpeg']`）：缺包即返回 `{ ok: false, needPacks, message }`，**不下载、不阻塞**；是否下载由界面（`useEnvGate`）问用户。ffmpeg 属于「ffmpeg 运行环境包」（包实测 **42.6 MB**，2026-10-14；解包 179.9 MB），不再随安装包 |
| `../shared/ipc` | `IPC` | 频道常量（`IPC.Project.*`） |
| `./settings` | `pickRenderOverride` | `project:set-render` 的项目级档位覆盖白名单过滤（与 `settings.ts` / `video.ts` 复用同一实现） |
| `../shared/types` | `type RegisterCtx`、`type ProjectAgentPayload`、`type ProjectExportSrtPayload`、`type ProjectNamePayload`、`type ProjectSaveContentPayload`、`type ProjectSaveHtmlPayload`、`type ProjectSaveSubtitlePayload`、`type ProjectSetAudioPayload`、`type ProjectSetVideoPayload`、`type ProjectSetRenderPayload`，以及 `type ContentScript` / `type Project` / `type Scene` / `type SubtitleLine`（后者四个在 import 后立即 `export type { … } from '../shared/types'` 再导出） | `register(ctx)` 的窗口上下文类型 + 全部 `project:*` handler 的载荷类型 + 项目结构（单一真源，本文件不再自行声明 interface） |

**被谁使用：**

| 使用方 | 方式 |
| --- | --- |
| `src/main/index.ts` | `import * as projects`；`createWindow()` 后 `projects.register(ctx)` 注册全部 `project:*`；`hgpreview` 协议处理器使用 `projects.projectDir(name)` 定位并校验项目目录 |
| `src/main/voice.ts` | 三处调用 `projects.projectsRoot()`（**函数**）取项目根：`resolveTtsDir()`、`voice:list-generated`、`voice:synth` 落盘回执；另用 `projects.scanProjects()` 枚举项目 |
| `src/main/whisper.ts` | `import * as projects`，配合 `ensureProject` / `projectDir` 解析项目内音频相对路径 |
| `src/main/ttsAlign.ts` | `import { parseSubtitle, type SubtitleLine }`，字幕时间轴对齐 |
| 渲染层 | 经 preload 的 `projectTools`（`window.projectTools`）调用上述频道；生成/修改期间监听 `project:html-progress` 渲染进度 |

## 7. 注意事项与实现要点

1. **项目一律是 `userData\projects` 下的真实目录**：每个项目都有对应的本地目录，不存在「无本地目录的项目」。`project:open-folder` 的目录不存在分支只剩一种情形——项目尚未保存（`ensureProject` 只在内存里构造对象、不落盘），文案为「项目目录不存在（项目尚未保存）」。
2. **`projectsRoot` 是函数、不是常量（本轮改动）**：`path.join(app.getPath('userData'), 'projects')` 每次调用重新求值。当前 userData 只跟随 `package.json` 的 `name`，模块级快照本来也正确；函数化是为了**将来**若有人重新引入 `setPath` 之类的改动时不会静默错位（纯保险）。三个调用点见 §3 的说明表；**新代码不要把它提成模块级常量，也不要在模块顶层 `const root = projectsRoot()`**。
3. **路径校验**：`projectDir` 做项目名字符净化，`project:create` 前置拦截非法字符，`project:delete` 用 `dir.startsWith(projectsRoot())` 兜底，禁止越界读写与删除。
4. **`ensureProject` 不落盘**：它只构造内存对象，因此 `project:load` 打开不存在/未保存的项目不会产生目录；真正落盘发生在 `writeProject`。
5. **编码统一 utf8**：`project.json`、`subtitle.txt`、`index.html`、`.srt` 均以 `'utf8'` 读写。
6. **失败处理风格**：所有 IPC 返回 `{ ok, message }` 而不抛异常；Agent 与 ffmpeg 的异常被包装成中文错误文案（Agent 侧还会经 `configTargetOf()` 补配置类分类 `needConfig` / `title`）；`readProject` 解析失败静默返回 `null`；`copyAudioIntoProject` / `copyVideoIntoProject` 复制失败返回 `''` 由调用方报错。
7. **进度推送安全**：发送前判断 `sender.isDestroyed()`，避免窗口销毁后 `send` 抛错。
8. **字段兼容与向后兼容**：`subtitleCount`、`videoMaterial`、`updatedAt` 均为可选字段；老项目没有 `content` 或 `content.scenes` 为空时，`buildContentBlock` 返回 `''`，流程回退为「仅按用户需求 + 字幕」生成；`normalizeContent` 对非法输入一律收敛为空内容脚本并自动补 `id`。
9. **素材 vs 成品**：`audioFile` / `videoMaterial` 是相对引用（`audio/xxx`、`video/xxx`，与 HTML 同目录系，保证预览与渲染都能解析），`htmlPath` / `videoPath` 是绝对路径；清空音频/视频只清引用不删文件，避免误删素材——但**清空音频会同步摘掉 HTML 里注入的 `<audio>`**，因为音轨是 HTML 的一部分（见 5.11）。
10. **HTML 变更即令视频失效**：生成、修改、直接保存 HTML 三处都会把 `videoPath` 置空，防止链路状态误报。
11. **合规检查只提示不阻断**：`compatible` 为 `false` 时仍返回 `ok: true` 并允许预览，仅在 `message` 中提示转视频前需调整（缺 `data-composition-id` / `__timelines` / `gsap`）。
12. **预览副本专供应用内预览**：CSP 剥离与脚本注入只作用于 `index.preview.html`，原件始终保持模型产出的原貌；注入音轨则相反——它写进**原件** `index.html`（预览副本从原件派生，因此自动带上）。
13. **ffmpeg 来自运行环境包、缺包即回 `needPacks`**：`project:extract-video-audio` 第一步就 `runtime.missingPacks(FFMPEG_PACKS)`（纯探测、不下载），缺包返回 `{ ok: false, needPacks: ['ffmpeg'], message: '提取视频音轨需要先下载运行环境（约 43 MB）' }`（体积文案由 `runtime.packSizeText()` 按 `PACK_DEFS.hint` 生成；ffmpeg 包实测 42.6 MB），由渲染层弹确认框；校验通过后才用 `hfEnv.BUILTIN_RESOURCES.ffmpeg`（`<userData>/runtime/ffmpeg/ffmpeg/bin/ffmpeg.exe`）提取，提取失败会删除半成品 `.m4a`。**旧行为「`await runtime.ensureRuntime()` 静默等下载」已删除**。
14. **结构类型只在 `shared/types.ts` 定义一处**：本文件已删掉本地的 `Scene` / `ContentScript` / `Project` / `SubtitleLine` interface，改为顶部的 `export type { … } from '../shared/types'` 再导出；因此 `from './projects'` 取到这些类型的既有代码（如 `ttsAlign.ts` 的 `type SubtitleLine`、`projects.Project` 形式的引用）字段完全同源。修改字段请改共享层，不要在本文件重建 interface（否则又会出现两份会漂移的定义）。
15. **handler 载荷全部有契约类型**：原先多处写作 `Record<string, unknown>` 或省略类型，现统一为 `Project*Payload`。注意 `ProjectNamePayload.name` 是**必填** `string`（用于 `clear-audio` / `clear-video`），而 `ProjectSaveSubtitlePayload` / `ProjectSetAudioPayload` / `ProjectSetVideoPayload` 等字段全部可选，运行时依旧保留 `payload && payload.name` 式的判空写法。
16. **GSAP 本地化的兜底语义**：改写只在「随包 `vendor/gsap/gsap.min.js` 存在」时发生，否则 `localizeGsapHtml` 原样返回（继续走 CDN，在线可用），因此这是**能力增强而非硬依赖**。`copyGsapIntoProject` 的返回值在本文件**只剩 `project:preview-html` 一处被忽略**：generate / modify / save-html 三处现在都用它做兜底——复制失败即 `externalizeGsapHtml` 退回 CDN，保证落盘的 HTML 不会引用一个不存在的 `gsap.min.js`。`video.ts` 的渲染副本仍忽略返回值。
17. **导出时换回 CDN、项目内保持本地引用**：`project:download-html` 是「读出 → `hfEnv.externalizeGsapHtml` → 文本写出」，导出物里的 GSAP 引用是指定版本的 CDN 地址（`https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`），因此导出的单个 HTML 放到别处联网即可独立打开；项目目录内的 `index.html` 仍是 `./gsap.min.js` 本地引用（离线预览/渲染不受影响）。注意：导出物从此依赖网络（不再自带 GSAP），而导出的 `gsap.min.js` 副本本身不会被带上——原先「导出后缺 gsap.min.js 导致动画不跑」的问题已由这次改动修掉。
18. **预览只在副本上改写**：`project:preview-html` 的 CSP 剥离与 GSAP 改写都作用于 `index.preview.html`，原件 `index.html` 保持原貌；但 `gsap.min.js` 是落在**项目目录**（原件与副本共用），所以原件的相对引用也成立。该处**不参与作者态的复制失败兜底**（返回值被忽略）：若出现「`gsap.min.js` 复制失败、但 HTML 本身写得进去」的偏门情形，作者态三处会把原件退回 CDN，而预览副本在 `localizeGsapHtml` 之后又会引 `./gsap.min.js`（复制同样失败），此时预览可能取不到该文件。
19. **`./hfEnv` 已改为命名空间导入**：`import * as hfEnv from './hfEnv'`，全文以 `hfEnv.` 前缀引用（如 `hfEnv.BUILTIN_RESOURCES.ffmpeg`、`hfEnv.isHyperframesComposition(...)`、`hfEnv.localizeGsapHtml(...)`），原解构导入已取消。
20. **音轨注入的三条不变量**：① 标签 id 固定为 `myv-bgm`，注入前先 `stripInjectedBgm`，重复设置不会叠出多条音轨；② 引用同一项目音频文件的历史 `<audio>`（旧版由模型按提示词写入）由 `stripAudioOfFile` 摘掉，避免双份播放；③ 没有 `index.html` 时 `applyBgmToHtml` 静默返回 `false`——因此「先生成音频、后生成 HTML」的顺序不会报错，音频会在下次生成 / 修改时随 HTML 一起补上。三个音频频道改写 HTML 后渲染层需重载预览才能听到（`HtmlGenPage` 已按 `htmlUpdated` 语义统一重载）。
21. **预览默认静止、播放由用户驱动（本轮行为反转）**：合成的 timeline 是 `paused: true` 创建、开头又 `gsap.set(..., { opacity: 0 })`，所以载入后画面停在第 0 帧、**起始帧本来就是空的**——这不是加载失败，也不是白屏故障。`HG_PREVIEW_CTRL` 不再自动起播，只做三件事：`freeze()` 把画面（含带 `autoplay` 的 `<audio>/<video>`）冻住并立刻上报一次状态；一旦用户发来任何 `pause`/`play`/`seek`/`restart` 就置 `userActed` 停手、不再干预；`watchEnd()` 在真实时间轴全部跑完时统一 `setPaused(true)`（避免带 `loop` 的媒体在后台空转、按钮卡在「暂停」）。配套地 `isPlaying()` 把「已播完」排除在「在播」之外；`setTime()` 只挪播放头、不改播放/暂停状态，并在 seek 后回一条带 `ack` 的上报供父页定位。
