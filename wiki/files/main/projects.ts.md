# src/main/projects.ts

> 主进程「我的项目」项目化流水线核心：项目落盘、字幕/内容脚本、HTML 生成与 `project:*` IPC。

- **所在目录**：src/main/
- **类型**：主进程业务模块（项目化流水线 + project:* IPC）
- **规模**：731 行
- **对外导出**：
  - 函数/常量：`register`、`scanProjects`、`projectsRoot`、`projectDir`、`projectFilePath`、`readProject`、`writeProject`、`ensureProject`、`parseSubtitle`、`normalizeContent`、`copyAudioIntoProject`、`copyVideoIntoProject`
  - 类型（**再导出**，定义在 `src/shared/types.ts`）：`Scene`、`ContentScript`、`Project`、`SubtitleLine` —— 本文件用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发，因此 `projects.Project` / `from './projects'` 的既有引用面不变
- **磁盘布局**：`userData\projects\<项目名>\` 下含 `project.json`（项目元数据）、`subtitle.txt`（字幕文本）、`index.html`（生成的 HTML composition）、`index.preview.html`（预览副本，按需生成）、`audio/`（音频素材）、`video/`（视频素材）

## 1. 作用与职责

1. **项目容器管理**：把「字幕 → 内容脚本 → HTML → 视频」全链路状态收敛到 `userData\projects\<项目名>\project.json`，提供建/读/写/扫/删。
2. **字幕解析**：把用户书写的字幕文本解析成带秒级（可含毫秒小数）起止时间的结构化行，供时间轴对齐（`ttsAlign.ts`）与 HTML 生成使用。
3. **HTML 生成与修改**：把手写字幕、内容脚本、背景音频、视频素材拼装成提示词，调用自定义模型 Agent（`htmlAgent`）产出/改造 `index.html`，并做 HyperFrames 合规校验。
4. **素材归置**：外部音频/视频复制进项目目录（`audio/`、`video/`）并以相对引用记录，保证 HTML 内相对路径与预览、转视频一致可用。
5. **IPC 网关**：在 `register(ctx)` 中注册全部 `project:*` 频道，供渲染层完成项目列表、生成、预览、导出、素材选择、产物回写等操作。

## 2. 数据结构

> 本节四个结构（`Scene` / `ContentScript` / `Project` / `SubtitleLine`）**已上移到 `src/shared/types.ts` ⑥ 节**（跨进程单一真源），本文件第 38 行再导出以保持既有引用面；各 IPC handler 的 `payload` 参数同样改用共享层的 `Project*Payload` 类型。字段语义如下（与源码逐字一致）。

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
| `audioFile` | `string` | 是 | 背景音频相对引用（`audio/xxx`，空串表示无） |
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

| 名称 | 导出 | 说明 |
| --- | --- | --- |
| `projectsRoot` | 是 | `path.join(app.getPath('userData'), 'projects')`，所有项目目录的根 |
| `projectDir(name)` | 是 | 拼接项目目录；把 `name` 中 `[\\/:*?"<>|]` 替换为 `_` 防非法路径 |
| `projectFilePath(name, file)` | 是 | `path.join(projectDir(name), file)`，项目内文件绝对路径 |
| `readProject(name)` | 是 | 读取并 `JSON.parse` `project.json`；文件不存在或解析异常返回 `null`（静默容错） |
| `writeProject(proj)` | 是 | 递归创建目录，刷新 `updatedAt`，以 `JSON.stringify(proj, null, 2)`、`utf8` 落盘并返回 `proj` |
| `ensureProject(name)` | 是 | 已有项目则读取并回填 `name`；否则返回默认项目（`title='字幕动画'`、空 `subtitle`/`htmlPath`/`videoPath`/`audioFile`、`content={style:'',scenes:[]}`、`createdAt=now`）；**不落盘** |
| `normalizeContent(raw)` | 是 | 内容脚本规范化：非对象按空处理，`style` 非字符串置 `''`，逐场景做类型收敛并补 `id`，实现旧数据向后兼容 |
| `scanProjects()` | 是 | 扫描 `projectsRoot` 各子目录，跳过无 `project.json` 者，返回 `{ name, title, hasSubtitle, hasHtml, hasVideo, subtitleCount, updatedAt }`，按 `updatedAt` 倒序 |
| `parseSubtitle(text)` | 是 | 解析字幕：支持 `[分:秒] 文本`、`[分:秒-分:秒] 文本`（小数位数即精度，3 位=毫秒）与纯文本自动估时 |
| `copyAudioIntoProject(name, audioPath)` | 是 | 复制音频到 `audio/`，重名自动追加 `_1`…`_1000`，返回 `audio/文件名`；失败返回 `''` |
| `copyVideoIntoProject(name, videoPath)` | 是 | 复制视频到 `video/`，命名规则同上，返回 `video/文件名`；失败返回 `''` |
| `buildAgentPrompt(parts)` | 否 | `parts.filter(Boolean).join('\n')`，拼接提示词片段 |
| `buildContentBlock(content)` | 否 | 由 `content` 生成「内容脚本」提示块；无有效场景（旁白全空）返回 `''`，老项目因此回退原流程 |
| `HG_PREVIEW_CTRL` | 否 | 注入预览副本的播放控制脚本源码（IIFE 字符串常量） |
| `resolveMaterials(name, proj, payload: ProjectAgentPayload)` | 否 | 解析 `subtitleProject` / `audioPath` / `videoPath` 三个选择项，返回 `{ subtitleText, audioRef, videoRef }`（载荷类型取自 `shared/types.ts`，此前为 `Record<string, unknown>`） |
| `buildMaterialPrompt(prompt, proj, mats, extra)` | 否 | 生成/修改共用的提示词装配：`extra`（修改时为当前 HTML 源码）在最前，随后需求、内容脚本、字幕、背景音乐、视频素材 |
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
- `timelines()`：优先取 `window.__timelines`，否则回退 `window.gsap.globalTimeline`。
- `setPaused(p)`：暂停/恢复 GSAP 时间轴 + 页面 `audio, video` 元素 + `document.getAnimations()`。
- `clock()`：读 `audio/video` 的 `duration`/`currentTime`，与 `gsap.globalTimeline` 的 `duration()/time()` 取较大值。
- 监听父窗口 `postMessage`：`d.__hg` 为真时，`type` 为 `pause` / `play` / `restart`（`restart` 执行 `location.reload()`）。
- 每 300ms 向 `parent` 发送 `{ __hg: true, type: 'progress', time, dur }`。
- 副本被单独打开时脚本无可见副作用。

### 3.3 `resolveMaterials` 选择项语义

| 载荷字段 | 取值 | 行为 |
| --- | --- | --- |
| `subtitleProject` | `''` / 缺省 | 不使用字幕 |
| `subtitleProject` | `'__current__'` | 使用当前项目 `proj.subtitle` |
| `subtitleProject` | 其他字符串（项目名） | 读取该项目字幕作为本次素材 |
| `audioPath` | `''` / 缺省 | 不使用音频 |
| `audioPath` | `'__current__'` | 沿用 `proj.audioFile` |
| `audioPath` | 存在的文件绝对路径 | `copyAudioIntoProject` 复制后取相对引用 |
| `videoPath` | `''` / 缺省 | 不使用视频素材 |
| `videoPath` | `'__current__'` | 沿用 `proj.videoMaterial` |
| `videoPath` | 存在的文件绝对路径 | `copyVideoIntoProject` 复制后取相对引用 |

### 3.4 `progressText` 文案映射

| `stage` | 输出文案 |
| --- | --- |
| `connecting` | 正在连接模型… |
| `thinking` | AI 正在推理中…（已思考 N 字符） |
| `writing` | AI 正在生成 HTML…（已输出 N 字符） |
| `retry` | 本次输出为空，正在升档重试… |
| `done` | 模型输出完成，正在写入文件… |

## 4. IPC 频道一览

`register()` 共注册 **24 个 `ipcMain.handle` 频道**，并额外使用 1 个主→渲染推送频道。返回统一为 `{ ok, ... }` 结构。下表的「参数载荷」列在括号内给出源码中的标注类型（均来自 `src/shared/types.ts` ⑥ 节），handler 形参一律写作 `payload?: <类型>`。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
| --- | --- | --- | --- |
| `project:list` | 无 | `scanProjects()` 数组 | 列出「我的项目」，按 `updatedAt` 倒序 |
| `project:create` | `name?: string`（裸字符串） | `{ ok, project }` / `{ ok:false, message }` | 空名、含 `\ / : * ? " < > \|`、同名已存在均拒绝；通过则 `ensureProject` + `writeProject` |
| `project:load` | `name?: string`（裸字符串） | `Project` \| `null` | 无名字返回 `null`；否则 `readProject(name) || ensureProject(name)`（不落盘） |
| `project:save-subtitle` | `ProjectSaveSubtitlePayload`（`{ name?, subtitle?, title? }`） | `{ ok, project }` | 写 `subtitle.txt`（utf8）；`title` 非空才覆盖；同步 `subtitle` 与 `subtitleCount` |
| `project:save-content` | `ProjectSaveContentPayload`（`{ name?, content? }`） | `{ ok, project }` | 经 `normalizeContent` 归一化后整体保存 `content` |
| `project:generate-html` | `ProjectAgentPayload`（`{ name, prompt, subtitleProject?, audioPath?, videoPath? }`） | `{ ok, htmlPath, compatible, message }` | 解析素材 → 装配提示词 → `chatWithCustomModel` → `extractHtmlFromReply` → 写 `index.html`；置空 `videoPath` |
| `project:modify-html` | 同 `project:generate-html`（同一 `ProjectAgentPayload`） | `{ ok, htmlPath, compatible, message }` | 需已有 `index.html`；把当前源码作为 `extra` 前置，Agent 输出完整新 HTML 后覆盖 |
| `project:download-html` | `name?: string`（裸字符串） | `{ ok, savedPath }` / `{ ok:false, canceled:true }` | 「另存为」导出项目 `index.html`（默认文件名 `<name>.html`） |
| `project:download-file` | `ProjectDownloadFilePayload`（`{ srcPath?, defaultName? }`） | `{ ok, savedPath }` / `{ ok:false, canceled:true }` | 导出任意存在文件（内置示例 HTML 的**只读导出**入口）；`defaultName` 非法字符会被替换 |
| `project:export-srt` | `ProjectExportSrtPayload`（`{ name?, srt? }`） | `{ ok, savedPath }` | 内容为空则拒绝；否则写 `.srt` 文件（utf8） |
| `project:open-folder` | `name?: string`（裸字符串） | `{ ok, message }` | `await shell.openPath(projectDir)`；目录不存在提示「该项目/内置示例无本地目录」 |
| `project:open-folder-of` | `p?: string`（裸字符串） | `{ ok, dir }` | 传入文件则取其所在目录，再 `shell.openPath` |
| `project:delete` | `name?: string`（裸字符串） | `{ ok }` / `{ ok:false, message }` | 仅允许删除 `projectsRoot` 下的目录（`startsWith(projectsRoot)` 校验），`rmSync(..., { recursive: true, force: true })` |
| `project:save-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`，与 `set-video` 同形复用一个类型） | `{ ok, project }` | 视频渲染完成后回写产物路径（点亮链路「视频」节点） |
| `project:pick-audio` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp3/wav/m4a/aac/ogg/flac/mp4`），取消返回 `null` |
| `project:set-audio` | `ProjectSetAudioPayload`（`{ name?, audioPath? }`） | `{ ok, audioFile }` | 校验文件存在 → 复制进 `audio/` → 写入 `proj.audioFile` |
| `project:clear-audio` | `ProjectNamePayload`（`{ name: string }`） | `{ ok }` | 仅清空 `proj.audioFile` 引用（保留音频文件，避免误删） |
| `project:pick-video` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp4/webm/mov/mkv/m4v/avi`） |
| `project:set-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`） | `{ ok, videoFile, abs }` | 复制进 `video/` → 写 `proj.videoMaterial`；`abs` 为项目内绝对路径供预览 |
| `project:clear-video` | `ProjectNamePayload`（`{ name: string }`） | `{ ok }` | 仅清空 `proj.videoMaterial` 引用（保留视频文件） |
| `project:extract-video-audio` | `name?: string`（裸字符串） | `{ ok, audioFile }` | 用内置 ffmpeg 从 `videoMaterial` 提取音轨为 `audio/<同名>.m4a`（AAC 192k）并设为背景音频 |
| `project:read-html` | `name?: string`（裸字符串） | `{ ok, html }` | 读取当前 `index.html` 源码供编辑器载入 |
| `project:preview-html` | `name?: string`（裸字符串） | `{ ok, previewPath }` | 生成去掉 CSP、注入 `HG_PREVIEW_CTRL` 的 `index.preview.html` 副本 |
| `project:save-html` | `ProjectSaveHtmlPayload`（`{ name?, html? }`） | `{ ok, htmlPath, compatible }` | 直接覆盖保存编辑器中的 HTML；置空 `videoPath` 表示旧视频失效 |
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
2. `ensureProject(name)` 取项目（无则用默认值），`resolveMaterials` 处理字幕/音频/视频素材（外部素材此时被复制进项目目录）。
3. `buildMaterialPrompt('用户需求：' + prompt.trim(), proj, mats, [])` 装配提示词：需求 → 内容脚本块 → 字幕块 → 背景音乐块 → 视频素材块。
4. 构造 `onProgress`，把 `progressText(info)` 的结果经 `project:html-progress` 推给发起窗口。
5. `await chatWithCustomModel(userPrompt, { onProgress, meta: { project: name, action: 'generate' } })`。
6. `extractHtmlFromReply(reply)` 抽出 HTML；`trim()` 为空返回「模型未返回内容，请检查自定义模型配置」。
7. 写 `projectDir(name)/index.html`（utf8），置 `proj.htmlPath = htmlPath` 绝对路径。
8. **`proj.videoPath = ''`**：HTML 刷新后旧视频失效，避免链路误显示成品。
9. `writeProject(proj)` 落盘，`isHyperframesComposition(html)` 做合规校验。
10. 返回 `{ ok: true, htmlPath, compatible, message }`；不合规时提示缺 `data-composition-id / __timelines / gsap`，预览可用但转视频前需调整。
11. 异常统一捕获为 `{ ok: false, message: 'Agent 调用失败：' + 错误信息 }`。

### 5.3 修改 HTML（`project:modify-html`）

1. 校验 `name` 与需求描述。
2. `projectFilePath(name, 'index.html')` 不存在则返回「该项目还没有 HTML，请先生成」。
3. 读取当前源码 `curHtml`，`resolveMaterials` 重新解析素材（可在改造时换素材）。
4. 提示词把 `['当前项目的 index.html 源码如下：', '```html', curHtml, '```', '']` 作为 `extra` 置于最前，再附需求「在此基础上改造后输出完整新 HTML」。
5. 调用 Agent（`meta.action = 'modify'`），同样支持 `project:html-progress` 进度推送。
6. 抽取 HTML 后**覆盖** `index.html`，更新 `htmlPath`、置空 `videoPath`、`writeProject` 并返回合规校验结果。

### 5.4 预览副本 `index.preview.html` 的生成

1. `project:preview-html` 中确认 `index.html` 存在。
2. 读取源码，用 `/<meta[^>]*content-security-policy[^>]*>/gi` 删除 CSP meta（**仅副本**，保证注入脚本可执行）。
3. 组装 `<script>` + `HG_PREVIEW_CTRL` + `</scr' + 'ipt>` 注入片段。
4. 定位 `</body>`（`lastIndexOf`）并插到其前面。
5. 若无 `</body>`（模型输出被截断），则插到 `</head>` 之后；连 `</head>` 也没有时插到文档最前——避免拼在文件末尾落入未闭合 `<script>` 导致整页脚本 SyntaxError。
6. `htmlPath.replace(/\.html$/i, '.preview.html')` 得到 `index.preview.html` 并写盘，返回 `previewPath`。
7. 预览副本与原件**同目录**，相对素材引用仍有效；下载与转视频始终使用原件 `index.html`。

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
5. `project:extract-video-audio` 则反向从 `videoMaterial` 提取音轨：用 `BUILTIN_RESOURCES.ffmpeg` 执行 `-hide_banner -loglevel error -y -i <video> -vn -ac 2 -c:a aac -b:a 192k <out>`；失败或产物为空都会清理文件并返回中文错误，成功后 `proj.audioFile = 'audio/' + outName`。

### 5.7 目录穿越防护

- `projectDir` 对项目名中的路径分隔符与保留字符做替换，杜绝 `..\` 之类的名称注入。
- `project:delete` 校验 `dir.startsWith(projectsRoot)`，只允许删除 `userData\projects` 下的目录。
- `hgpreview` 协议处理器（`main/index.ts`）用 `projects.projectDir(name)` 得根目录，再 `path.resolve(dir, rel)`，要求结果等于 `dir` 或以 `dir + path.sep` 开头，否则返回 403。
- `project:set-audio` / `project:set-video` / `project:extract-video-audio` 均先 `fs.existsSync` 校验源文件。
- `project:open-folder-of` 只对存在的路径执行 `shell.openPath`。

## 6. 依赖与协作

**本模块 import：**

| 来源 | 引入物 | 用途 |
| --- | --- | --- |
| `electron` | `app, ipcMain, dialog, shell` | `userData` 路径、IPC 注册、文件/目录选择对话框、打开目录 |
| `node:path` / `node:fs` | `path` / `fs` | 路径拼接与全部同步文件读写 |
| `node:child_process` | `spawn` | 调用内置 ffmpeg 提取视频音轨 |
| `./htmlAgent` | `chatWithCustomModel`、`extractHtmlFromReply`、`type AgentProgress` | 调用自定义模型生成/修改 HTML、抽取回复中的 HTML、进度事件类型 |
| `./hfEnv` | `BUILTIN_RESOURCES`、`isHyperframesComposition` | 内置 ffmpeg 路径、HyperFrames composition 合规校验 |
| `../shared/ipc` | `IPC` | 频道常量（`IPC.Project.*`） |
| `../shared/types` | `type RegisterCtx`、`type ProjectAgentPayload`、`type ProjectDownloadFilePayload`、`type ProjectExportSrtPayload`、`type ProjectNamePayload`、`type ProjectSaveContentPayload`、`type ProjectSaveHtmlPayload`、`type ProjectSaveSubtitlePayload`、`type ProjectSetAudioPayload`、`type ProjectSetVideoPayload`，以及 `type ContentScript` / `type Project` / `type Scene` / `type SubtitleLine`（后者四个在 import 后立即 `export type { … } from '../shared/types'` 再导出） | `register(ctx)` 的窗口上下文类型 + 全部 `project:*` handler 的载荷类型 + 项目结构（单一真源，本文件不再自行声明 interface） |

**被谁使用：**

| 使用方 | 方式 |
| --- | --- |
| `src/main/index.ts` | `import * as projects`；`createWindow()` 后 `projects.register(ctx)` 注册全部 `project:*`；`hgpreview` 协议处理器使用 `projects.projectDir(name)` 定位并校验项目目录 |
| `src/main/voice.ts` | 使用 `projects.projectsRoot`、`projects.scanProjects()` 枚举项目 |
| `src/main/whisper.ts` | `import * as projects`，配合 `ensureProject` / `projectDir` 解析项目内音频相对路径 |
| `src/main/ttsAlign.ts` | `import { parseSubtitle, type SubtitleLine }`，字幕时间轴对齐 |
| 渲染层 | 经 preload 的 `projectTools`（`window.projectTools`）调用上述频道；生成/修改期间监听 `project:html-progress` 渲染进度 |

## 7. 注意事项与实现要点

1. **内置示例项目只读**：内置示例没有 `userData\projects` 下的真实目录，`project:open-folder` 会返回「项目目录不存在（该内置示例/未保存项目无本地目录）」；导出请走 `project:download-file`（只复制源文件，不改原目录）。
2. **路径校验**：`projectDir` 做项目名字符净化，`project:create` 前置拦截非法字符，`project:delete` 用 `startsWith(projectsRoot)` 兜底，禁止越界读写与删除。
3. **`ensureProject` 不落盘**：它只构造内存对象，因此 `project:load` 打开不存在/未保存的项目不会产生目录；真正落盘发生在 `writeProject`。
4. **编码统一 utf8**：`project.json`、`subtitle.txt`、`index.html`、`.srt` 均以 `'utf8'` 读写。
5. **失败处理风格**：所有 IPC 返回 `{ ok, message }` 而不抛异常；Agent 与 ffmpeg 的异常被包装成中文错误文案；`readProject` 解析失败静默返回 `null`；`copyAudioIntoProject` / `copyVideoIntoProject` 复制失败返回 `''` 由调用方报错。
6. **进度推送安全**：发送前判断 `sender.isDestroyed()`，避免窗口销毁后 `send` 抛错。
7. **字段兼容与向后兼容**：`subtitleCount`、`videoMaterial`、`updatedAt` 均为可选字段；老项目没有 `content` 或 `content.scenes` 为空时，`buildContentBlock` 返回 `''`，流程回退为「仅按用户需求 + 字幕」生成；`normalizeContent` 对非法输入一律收敛为空内容脚本并自动补 `id`。
8. **素材 vs 成品**：`audioFile` / `videoMaterial` 是相对引用（`audio/xxx`、`video/xxx`，与 HTML 同目录系，保证预览与渲染都能解析），`htmlPath` / `videoPath` 是绝对路径；清空音频/视频只清引用不删文件，避免误删素材。
9. **HTML 变更即令视频失效**：生成、修改、直接保存 HTML 三处都会把 `videoPath` 置空，防止链路状态误报。
10. **合规检查只提示不阻断**：`compatible` 为 `false` 时仍返回 `ok: true` 并允许预览，仅在 `message` 中提示转视频前需调整（缺 `data-composition-id` / `__timelines` / `gsap`）。
11. **预览副本专供应用内预览**：CSP 剥离与脚本注入只作用于 `index.preview.html`，原件始终保持模型产出的原貌。
12. **ffmpeg 依赖内置资源**：`BUILTIN_RESOURCES.ffmpeg` 缺失时 `project:extract-video-audio` 直接返回「未找到内置 ffmpeg（resources/ffmpeg/bin）」；提取失败会删除半成品 `.m4a`。
13. **结构类型只在 `shared/types.ts` 定义一处**：本文件已删掉本地的 `Scene` / `ContentScript` / `Project` / `SubtitleLine` interface，改为第 38 行的 `export type { … } from '../shared/types'`；因此 `from './projects'` 取到这些类型的既有代码（如 `ttsAlign.ts` 的 `type SubtitleLine`、`projects.Project` 形式的引用）字段完全同源。修改字段请改共享层，不要在本文件重建 interface（否则又会出现两份会漂移的定义）。
14. **handler 载荷全部有契约类型**：原先多处写作 `Record<string, unknown>` 或省略类型，现统一为 `Project*Payload`。注意 `ProjectNamePayload.name` 是**必填** `string`（用于 `clear-audio` / `clear-video`），而 `ProjectSaveSubtitlePayload` / `ProjectSetAudioPayload` / `ProjectSetVideoPayload` 等字段全部可选，运行时依旧保留 `payload && payload.name` 式的判空写法。
