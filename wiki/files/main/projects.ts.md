# src/main/projects.ts

> 主进程「我的项目」项目化流水线核心：项目落盘、字幕/内容脚本、HTML 生成与 `project:*` IPC。

- **所在目录**：src/main/
- **类型**：主进程业务模块（项目化流水线 + project:* IPC）
- **规模**：772 行
- **对外导出**：
  - 函数/常量：`register`、`scanProjects`、`projectsRoot`、`projectDir`、`projectFilePath`、`readProject`、`writeProject`、`ensureProject`、`parseSubtitle`、`normalizeContent`、`copyAudioIntoProject`、`copyVideoIntoProject`
  - 类型（**再导出**，定义在 `src/shared/types.ts`）：`Scene`、`ContentScript`、`Project`、`SubtitleLine` —— 本文件用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发，因此 `projects.Project` / `from './projects'` 的既有引用面不变
- **磁盘布局**：`userData\projects\<项目名>\` 下含 `project.json`（项目元数据）、`subtitle.txt`（字幕文本）、`index.html`（生成的 HTML composition）、`index.preview.html`（预览副本，按需生成）、`gsap.min.js`（按需从随包文件复制的 GSAP，供 HTML 内 `./gsap.min.js` 引用）、`audio/`（音频素材）、`video/`（视频素材）

## 1. 作用与职责

1. **项目容器管理**：把「字幕 → 内容脚本 → HTML → 视频」全链路状态收敛到 `userData\projects\<项目名>\project.json`，提供建/读/写/扫/删。
2. **字幕解析**：把用户书写的字幕文本解析成带秒级（可含毫秒小数）起止时间的结构化行，供时间轴对齐（`ttsAlign.ts`）与 HTML 生成使用。
3. **HTML 生成与修改**：把手写字幕、内容脚本、背景音频、视频素材拼装成提示词，调用自定义模型 Agent（`htmlAgent`）产出/改造 `index.html`，并做 HyperFrames 合规校验。
4. **素材归置**：外部音频/视频复制进项目目录（`audio/`、`video/`）并以相对引用记录，保证 HTML 内相对路径与预览、转视频一致可用。
5. **GSAP 本地化与导出外部化**：生成 / 修改 / 保存 / 预览四个写盘环节把 HTML 里的 GSAP CDN 引用改写为项目内 `./gsap.min.js`（`hfEnv.localizeGsapHtml`），并在需要时把随包 `vendor/gsap/gsap.min.js` 复制进项目目录（`hfEnv.copyGsapIntoProject`）——三个**作者态**写盘点（generate / modify / save-html）还会用复制返回值做兜底：复制失败就把引用换回 CDN（`hfEnv.externalizeGsapHtml`），宁可联网也不引用不存在的文件。两个导出频道同样反向调用 `externalizeGsapHtml`，保证导出的单个 HTML 文件放到别处也能独立打开。
6. **IPC 网关**：在 `register(ctx)` 中注册全部 `project:*` 频道，供渲染层完成项目列表、生成、预览、导出、素材选择、产物回写等操作。

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
- `timelines()` **三态枚举**（对应「新版对象形态 / 旧生成物数组形态 / 兜底」）：
  1. `Object.prototype.toString.call(t) === "[object Array]"`（`t = window.__timelines`）→ `t.slice()`（旧版生成物的数组形态）；
  2. `t` 是对象 → `for (var k in t)` 遍历取值，只收真值（HyperFrames 契约：以 composition id 为键的对象）；
  3. 两者都没收到 → 回退 `[window.gsap.globalTimeline]`（兜底）；最终仍为空则返回 `[]`。
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

`register()` 共注册 **25 个 `ipcMain.handle` 频道**，并额外使用 1 个主→渲染推送频道。返回统一为 `{ ok, ... }` 结构。下表的「参数载荷」列在括号内给出源码中的标注类型（均来自 `src/shared/types.ts` ⑥ 节），handler 形参一律写作 `payload?: <类型>`。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
| --- | --- | --- | --- |
| `project:list` | 无 | `scanProjects()` 数组 | 列出「我的项目」，按 `updatedAt` 倒序 |
| `project:create` | `name?: string`（裸字符串） | `{ ok, project }` / `{ ok:false, message }` | 空名、含 `\ / : * ? " < > \|`、同名已存在均拒绝；通过则 `ensureProject` + `writeProject` |
| `project:load` | `name?: string`（裸字符串） | `Project` \| `null` | 无名字返回 `null`；否则 `readProject(name) || ensureProject(name)`（不落盘） |
| `project:save-subtitle` | `ProjectSaveSubtitlePayload`（`{ name?, subtitle?, title? }`） | `{ ok, project }` | 写 `subtitle.txt`（utf8）；`title` 非空才覆盖；同步 `subtitle` 与 `subtitleCount` |
| `project:save-content` | `ProjectSaveContentPayload`（`{ name?, content? }`） | `{ ok, project }` | 经 `normalizeContent` 归一化后整体保存 `content` |
| `project:generate-html` | `ProjectAgentPayload`（`{ name, prompt, subtitleProject?, audioPath?, videoPath? }`） | `{ ok, htmlPath, compatible, message }` | 解析素材 → 装配提示词 → `chatWithCustomModel` → `extractHtmlFromReply` → `hfEnv.localizeGsapHtml` 本地化 → 引用本地时 `copyGsapIntoProject`，**复制失败则 `externalizeGsapHtml` 退回 CDN** → 写 `index.html`；置空 `videoPath` |
| `project:modify-html` | 同 `project:generate-html`（同一 `ProjectAgentPayload`） | `{ ok, htmlPath, compatible, message }` | 需已有 `index.html`；把当前源码作为 `extra` 前置，Agent 输出完整新 HTML 后**同样先本地化、再按复制结果决定是否退回 CDN**，最后覆盖 |
| `project:download-html` | `name?: string`（裸字符串） | `{ ok, savedPath }` / `{ ok:false, canceled:true }` | 「另存为」导出项目 `index.html`（默认文件名 `<name>.html`）：读原文 → `hfEnv.externalizeGsapHtml` 把 `./gsap.min.js` 换回固定版本 CDN → **文本写出**（不再 `copyFileSync`），理由见 5.9 |
| `project:download-file` | `ProjectDownloadFilePayload`（`{ srcPath?, defaultName? }`） | `{ ok, savedPath }` / `{ ok:false, canceled:true }` | 导出任意存在文件（内置示例 HTML 的**只读导出**入口）；源文件扩展名匹配 `/\.html?$/i` 时同样走「读取 → `externalizeGsapHtml` → 文本写出」，其它扩展名保持 `fs.copyFileSync` 字节复制；`defaultName` 非法字符会被替换 |
| `project:export-srt` | `ProjectExportSrtPayload`（`{ name?, srt? }`） | `{ ok, savedPath }` | 内容为空则拒绝；否则写 `.srt` 文件（utf8） |
| `project:open-folder` | `name?: string`（裸字符串） | `{ ok, message }` | `await shell.openPath(projectDir)`；目录不存在提示「该项目/内置示例无本地目录」 |
| `project:open-folder-of` | `p?: string`（裸字符串） | `{ ok, dir }` | 传入文件则取其所在目录，再 `shell.openPath` |
| `project:delete` | `name?: string`（裸字符串） | `{ ok }` / `{ ok:false, message }` | 仅允许删除 `projectsRoot` 下的目录（`startsWith(projectsRoot)` 校验），`rmSync(..., { recursive: true, force: true })` |
| `project:save-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`，与 `set-video` 同形复用一个类型） | `{ ok, project }` | 视频渲染完成后回写产物路径（点亮链路「视频」节点） |
| `project:set-render` | `ProjectSetRenderPayload`（`{ name?, render?: RenderOverride \| null }`） | `{ ok, project }` | 写 / 清除**项目级渲染档位覆盖**：`render` 传 `null`（或字段全非法）即删除 `proj.render`，回到跟随 `settings.json` 的全局默认 |
| `project:pick-audio` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp3/wav/m4a/aac/ogg/flac/mp4`），取消返回 `null` |
| `project:set-audio` | `ProjectSetAudioPayload`（`{ name?, audioPath? }`） | `{ ok, audioFile }` | 校验文件存在 → 复制进 `audio/` → 写入 `proj.audioFile` |
| `project:clear-audio` | `ProjectNamePayload`（`{ name: string }`） | `{ ok }` | 仅清空 `proj.audioFile` 引用（保留音频文件，避免误删） |
| `project:pick-video` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp4/webm/mov/mkv/m4v/avi`） |
| `project:set-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`） | `{ ok, videoFile, abs }` | 复制进 `video/` → 写 `proj.videoMaterial`；`abs` 为项目内绝对路径供预览 |
| `project:clear-video` | `ProjectNamePayload`（`{ name: string }`） | `{ ok }` | 仅清空 `proj.videoMaterial` 引用（保留视频文件） |
| `project:extract-video-audio` | `name?: string`（裸字符串） | `{ ok, audioFile }` | 用内置 ffmpeg 从 `videoMaterial` 提取音轨为 `audio/<同名>.m4a`（AAC 192k）并设为背景音频 |
| `project:read-html` | `name?: string`（裸字符串） | `{ ok, html }` | 读取当前 `index.html` 源码供编辑器载入 |
| `project:preview-html` | `name?: string`（裸字符串） | `{ ok, previewPath }` | 生成去掉 CSP、**对副本做 GSAP 本地化**、注入 `HG_PREVIEW_CTRL` 的 `index.preview.html` 副本 |
| `project:save-html` | `ProjectSaveHtmlPayload`（`{ name?, html? }`） | `{ ok, htmlPath, compatible }` | 先 `hfEnv.localizeGsapHtml` 改写 CDN 引用（**合规校验也用改写后的 `localHtml`**），再在引用本地时 `copyGsapIntoProject`、**复制失败则 `externalizeGsapHtml` 退回 CDN**，然后覆盖保存编辑器中的 HTML；置空 `videoPath` 表示旧视频失效 |
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
6. `extractHtmlFromReply(reply)` 抽出 HTML 后交给 `hfEnv.localizeGsapHtml()`（把 GSAP CDN 引用改写为 `./gsap.min.js`；随包文件缺失则原样返回）；`trim()` 为空返回「模型未返回内容，请检查自定义模型配置」。
7. **GSAP 落位 + 兜底**：`if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(dir)) html = hfEnv.externalizeGsapHtml(html);` —— 引用本地时先复制随包 `gsap.min.js`（幂等）；复制失败（返回 `false`）就把引用换回 CDN，避免引用一个不存在的文件。随后写 `projectDir(name)/index.html`（utf8），置 `proj.htmlPath = htmlPath` 绝对路径。
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
6. 抽取 HTML 并先经 `hfEnv.localizeGsapHtml()` 本地化、再走同一套兜底（`if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(projDir)) html = hfEnv.externalizeGsapHtml(html);`）；随后**覆盖** `index.html`，更新 `htmlPath`、置空 `videoPath`、`writeProject` 并返回合规校验结果（`compatible` 基于最终写盘的 HTML）。

### 5.4 预览副本 `index.preview.html` 的生成

1. `project:preview-html` 中确认 `index.html` 存在。
2. 读取源码，用 `/<meta[^>]*content-security-policy[^>]*>/gi` 删除 CSP meta（**仅副本**，保证注入脚本可执行）。
3. **对副本做 GSAP 本地化**：`html = hfEnv.localizeGsapHtml(html)`；若结果引用 `./gsap.min.js`（`hfEnv.referencesLocalGsap`）则 `hfEnv.copyGsapIntoProject(path.dirname(htmlPath))`——只改副本、不去动原件；`gsap.min.js` 落在项目目录，因此原件里的相对引用同样成立。
4. 组装 `<script>` + `HG_PREVIEW_CTRL` + `</scr' + 'ipt>` 注入片段。
5. 定位 `</body>`（`lastIndexOf`）并插到其前面。
6. 若无 `</body>`（模型输出被截断），则插到 `</head>` 之后；连 `</head>` 也没有时插到文档最前——避免拼在文件末尾落入未闭合 `<script>` 导致整页脚本 SyntaxError。
7. `htmlPath.replace(/\.html$/i, '.preview.html')` 得到 `index.preview.html` 并写盘，返回 `previewPath`。
8. 预览副本与原件**同目录**，相对素材引用仍有效；下载与转视频始终使用原件 `index.html`。

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
5. `project:extract-video-audio` 则反向从 `videoMaterial` 提取音轨：用 `hfEnv.BUILTIN_RESOURCES.ffmpeg` 执行 `-hide_banner -loglevel error -y -i <video> -vn -ac 2 -c:a aac -b:a 192k <out>`；失败或产物为空都会清理文件并返回中文错误，成功后 `proj.audioFile = 'audio/' + outName`。

### 5.7 目录穿越防护

- `projectDir` 对项目名中的路径分隔符与保留字符做替换，杜绝 `..\` 之类的名称注入。
- `project:delete` 校验 `dir.startsWith(projectsRoot)`，只允许删除 `userData\projects` 下的目录。
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

### 5.9 导出外部化（`project:download-html` / `project:download-file`）

导出物是**单个 HTML 文件**，目标位置同目录不会有 `gsap.min.js`；若原样导出项目内的 `./gsap.min.js` 相对引用，导出后动画会完全不跑（这是本地化引入的回归）。两个导出频道因此改为「文本读出 → `hfEnv.externalizeGsapHtml` 换回固定版本 CDN（`GSAP_CDN_PINNED`）→ 文本写出」。

| 频道 | 写出方式 |
| --- | --- |
| `project:download-html` | 一律 `fs.writeFileSync(save, hfEnv.externalizeGsapHtml(fs.readFileSync(htmlPath, 'utf8')), 'utf8')`（原先是 `fs.copyFileSync`） |
| `project:download-file` | `srcPath` 扩展名匹配 `/\.html?$/i` → 同上的读取+外部化+文本写出；其它扩展名仍 `fs.copyFileSync(src, save)`，保持字节复制以免破坏二进制导出 |

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

## 6. 依赖与协作

**本模块 import：**

| 来源 | 引入物 | 用途 |
| --- | --- | --- |
| `electron` | `app, ipcMain, dialog, shell` | `userData` 路径、IPC 注册、文件/目录选择对话框、打开目录 |
| `node:path` / `node:fs` | `path` / `fs` | 路径拼接与全部同步文件读写 |
| `node:child_process` | `spawn` | 调用内置 ffmpeg 提取视频音轨 |
| `./htmlAgent` | `chatWithCustomModel`、`extractHtmlFromReply`、`type AgentProgress` | 调用自定义模型生成/修改 HTML、抽取回复中的 HTML、进度事件类型 |
| `./hfEnv` | **命名空间导入** `import * as hfEnv from './hfEnv'`：`hfEnv.BUILTIN_RESOURCES`（取 `ffmpeg`）、`hfEnv.isHyperframesComposition`、`hfEnv.localizeGsapHtml`、`hfEnv.referencesLocalGsap`、`hfEnv.copyGsapIntoProject`、`hfEnv.externalizeGsapHtml` | 内置 ffmpeg 路径、HyperFrames composition 合规校验、生成 / 修改 / 保存 / 预览四个写盘环节的 GSAP 本地化，以及两个导出频道的反向外部化 |
| `../shared/ipc` | `IPC` | 频道常量（`IPC.Project.*`） |
| `./settings` | `pickRenderOverride` | `project:set-render` 的项目级档位覆盖白名单过滤（与 `settings.ts` / `video.ts` 复用同一实现） |
| `../shared/types` | `type RegisterCtx`、`type ProjectAgentPayload`、`type ProjectDownloadFilePayload`、`type ProjectExportSrtPayload`、`type ProjectNamePayload`、`type ProjectSaveContentPayload`、`type ProjectSaveHtmlPayload`、`type ProjectSaveSubtitlePayload`、`type ProjectSetAudioPayload`、`type ProjectSetVideoPayload`、`type ProjectSetRenderPayload`，以及 `type ContentScript` / `type Project` / `type Scene` / `type SubtitleLine`（后者四个在 import 后立即 `export type { … } from '../shared/types'` 再导出） | `register(ctx)` 的窗口上下文类型 + 全部 `project:*` handler 的载荷类型 + 项目结构（单一真源，本文件不再自行声明 interface） |

**被谁使用：**

| 使用方 | 方式 |
| --- | --- |
| `src/main/index.ts` | `import * as projects`；`createWindow()` 后 `projects.register(ctx)` 注册全部 `project:*`；`hgpreview` 协议处理器使用 `projects.projectDir(name)` 定位并校验项目目录 |
| `src/main/voice.ts` | 使用 `projects.projectsRoot`、`projects.scanProjects()` 枚举项目 |
| `src/main/whisper.ts` | `import * as projects`，配合 `ensureProject` / `projectDir` 解析项目内音频相对路径 |
| `src/main/ttsAlign.ts` | `import { parseSubtitle, type SubtitleLine }`，字幕时间轴对齐 |
| 渲染层 | 经 preload 的 `projectTools`（`window.projectTools`）调用上述频道；生成/修改期间监听 `project:html-progress` 渲染进度 |

## 7. 注意事项与实现要点

1. **内置示例项目只读**：内置示例没有 `userData\projects` 下的真实目录，`project:open-folder` 会返回「项目目录不存在（该内置示例/未保存项目无本地目录）」；导出请走 `project:download-file`（读出后写到用户选定位置，不改原目录）。
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
12. **ffmpeg 依赖内置资源**：`hfEnv.BUILTIN_RESOURCES.ffmpeg` 缺失时 `project:extract-video-audio` 直接返回「未找到内置 ffmpeg（resources/ffmpeg/bin）」；提取失败会删除半成品 `.m4a`。
13. **结构类型只在 `shared/types.ts` 定义一处**：本文件已删掉本地的 `Scene` / `ContentScript` / `Project` / `SubtitleLine` interface，改为第 38 行的 `export type { … } from '../shared/types'`；因此 `from './projects'` 取到这些类型的既有代码（如 `ttsAlign.ts` 的 `type SubtitleLine`、`projects.Project` 形式的引用）字段完全同源。修改字段请改共享层，不要在本文件重建 interface（否则又会出现两份会漂移的定义）。
14. **handler 载荷全部有契约类型**：原先多处写作 `Record<string, unknown>` 或省略类型，现统一为 `Project*Payload`。注意 `ProjectNamePayload.name` 是**必填** `string`（用于 `clear-audio` / `clear-video`），而 `ProjectSaveSubtitlePayload` / `ProjectSetAudioPayload` / `ProjectSetVideoPayload` 等字段全部可选，运行时依旧保留 `payload && payload.name` 式的判空写法。
15. **GSAP 本地化的兜底语义**：改写只在「随包 `vendor/gsap/gsap.min.js` 存在」时发生，否则 `localizeGsapHtml` 原样返回（继续走 CDN，在线可用），因此这是**能力增强而非硬依赖**。`copyGsapIntoProject` 的返回值在本文件**只剩 `project:preview-html` 一处被忽略**：generate / modify / save-html 三处现在都用它做兜底——复制失败即 `externalizeGsapHtml` 退回 CDN，保证落盘的 HTML 不会引用一个不存在的 `gsap.min.js`。`video.ts` 的渲染副本仍忽略返回值。
16. **导出时换回 CDN、项目内保持本地引用**：`project:download-html` 与 `project:download-file` 的 `.html/.htm` 分支都是「读出 → `hfEnv.externalizeGsapHtml` → 文本写出」，导出物里的 GSAP 引用是指定版本的 CDN 地址（`https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`），因此导出的单个 HTML 放到别处联网即可独立打开；项目目录内的 `index.html` 仍是 `./gsap.min.js` 本地引用（离线预览/渲染不受影响）。注意：导出物从此依赖网络（不再自带 GSAP），而导出的 `gsap.min.js` 副本本身不会被带上——原先「导出后缺 gsap.min.js 导致动画不跑」的问题已由这次改动修掉。
17. **预览只在副本上改写**：`project:preview-html` 的 CSP 剥离与 GSAP 改写都作用于 `index.preview.html`，原件 `index.html` 保持原貌；但 `gsap.min.js` 是落在**项目目录**（原件与副本共用），所以原件的相对引用也成立。该处**不参与作者态的复制失败兜底**（返回值被忽略）：若出现「`gsap.min.js` 复制失败、但 HTML 本身写得进去」的偏门情形，作者态三处会把原件退回 CDN，而预览副本在 `localizeGsapHtml` 之后又会引 `./gsap.min.js`（复制同样失败），此时预览可能取不到该文件。
18. **`./hfEnv` 已改为命名空间导入**：`import * as hfEnv from './hfEnv'`，全文以 `hfEnv.` 前缀引用（如 `hfEnv.BUILTIN_RESOURCES.ffmpeg`、`hfEnv.isHyperframesComposition(...)`、`hfEnv.localizeGsapHtml(...)`），原解构导入已取消。
19. **内置示例并非完全离线**：`video-projects/*/index.html` 除 GSAP 外仍从 CDN 引 `@hyperframes/core` 与 `@hyperframes/shader-transitions`，本轮只本地化了 GSAP；示例仅在渲染路径由 HyperFrames CLI 自带运行时兜底，预览/独立打开仍需网络。
