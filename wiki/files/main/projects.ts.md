# src/main/projects.ts

> 主进程「我的项目」项目化流水线核心：项目落盘（**索引 + 正文分层**）、字幕 / 内容脚本、**项目素材库（图片 / 视频 / 角色）**、HTML 生成与 `project:*` IPC。

- **所在目录**：src/main/
- **类型**：主进程业务模块（项目化流水线 + project:* IPC）
- **规模**：1808 行（实测 `[IO.File]::ReadAllLines`；上一版 1745 行，本轮 **+63 行**：角色从「规划产物」改为「项目素材」——新增 `applyCastToHtml` / `refreshCastInPage` 与 `project:new-cast` / `project:save-cast` 两个 handler，删掉「先 M 次角色 → 再 N 次章节」那一段；另为单文件提示词加了一段【分层要求】）
- **对外导出**（与文件末尾的 `export { … }` 清单逐字一致，共 13 个）：
  - 函数：`register`、`scanProjects`、`projectsRoot`（**函数**，见 §3）、`projectDir`、`projectFilePath`、`readProject`、`writeProject`、`ensureProject`、`parseSubtitle`、`normalizeContent`、`copyAudioIntoProject`、`copyMaterialIntoProject`、`normalizeMaterials`
  - **不在导出清单里（文件内私有）**：`contentFilePath`、`readSubtitle`、`readContent`、`writeContent`、`resolveVideoAbs`、`applyBgmToHtml` 及背景音轨 / 素材库 / 提示词一组助手。引用它们只能在主进程本文件内（例如 `resolveVideoAbs` 只被 `project:load` 与 `scanProjects` 调用，见 3.8）
  - 类型（**再导出**，定义在 `src/shared/types.ts`）：`Scene`、`ContentScript`、`Project`、`SubtitleLine` —— 本文件用 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 转发，因此 `projects.Project` / `from './projects'` 的既有引用面不变。**新的 `ProjectIndex` 只 `import type` 进来用，没有再导出**（它描述磁盘上的 `project.json`，属本模块的实现细节）
- **磁盘布局**：`userData\projects\<项目名>\` 下含 `project.json`（**只有索引**，见 2.3 / 2.7）、`subtitle.txt`（字幕正文，**唯一正文**）、**`content.json`（内容脚本正文 `{ style, scenes }`，唯一正文，本轮新增）**、`index.html`（生成的 HTML composition）、`index.preview.html`（预览副本，按需生成）、`gsap.min.js` / `p5.min.js` / `p5.brush.js`（按需从随包 `vendor/` 复制的第三方前端库，供 HTML 内以 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 引用；p5.brush 必须先加载 p5）、`images/`（**图片素材**）、`video/`（视频素材——兼作素材库视频与历史单视频素材的落点）、`audio/`（音频素材）、**`pages/`（章节模式：每章一个 `c01.js` / `c02.js`…，`index.html` 由应用确定性生成）**、**`cast/`（**项目角色**：每个角色一份 `<id>.js`，与图片 / 视频并列属于「项目素材」；章节模式由骨架引入、单文件模式由 `castInject.ts` 注入 —— 与产物形态无关）**

## 1. 作用与职责

1. **项目容器管理**：把「字幕 → 内容脚本 → HTML → 视频」全链路状态收敛到 `userData\projects\<项目名>\`，但**正文不再塞进 `project.json`**——索引（name / title / subtitleCount / htmlPath / videoPath / audioFile / materials / render / canvas / 时间戳等小字段）留在 `project.json`，字幕正文在 `subtitle.txt`、内容脚本正文在 `content.json`；对外提供建 / 读 / 写 / 扫 / 删。
2. **字幕解析**：把用户书写的字幕文本解析成带秒级（可含毫秒小数）起止时间的结构化行，供时间轴对齐（`ttsAlign.ts`）与 HTML 生成使用。
3. **HTML 生成与修改**：把手写字幕、内容脚本、**勾选的项目素材（多图片 / 多视频 / 多角色）**拼装成提示词，调用自定义模型 Agent（`src/main/agent/` 的 `html.ts`）产出/改造 `index.html`，并做 HyperFrames 合规校验。**角色是素材**：被勾选的角色不进「内容」、也不由模型画，而是由应用把 `core.js` + `cast/<id>.js` **注入页面**（章节模式写进骨架、单文件模式由 `castInject.ts` 注入），模型只负责调用。**背景音频不是生成素材**（不进提示词、也不交给 Agent）：音轨由本文件按 `project.audioFile` 确定性注入 HTML，见第 3.5 节与 5.11。
4. **背景音轨注入**：`applyBgmToHtml()` 按 `project.audioFile` 重写 `index.html` 里固定 id 的 `<audio id="myv-bgm" src="audio/…" autoplay loop>`（幂等）；共 6 处调用点（`set-audio` / `clear-audio` / `extract-video-audio` / `generate-html` / `modify-html` / `save-html`），保证预览副本与转视频用的原件都带音轨。
5. **素材归置**：外部音频 / 图片 / 视频复制进项目目录（`audio/`、`images/`、`video/`）并以**项目内相对引用**登记，保证 HTML 内相对路径与预览、转视频一致可用；素材列表统一经 `normalizeMaterials()` 规范化（读盘与写盘共用）。
6. **随包前端库本地化与导出外部化**：生成 / 修改 / 保存 / 预览四个写盘环节把 HTML 里的 CDN 引用（GSAP / p5 / p5.brush，含 `node_modules/p5/lib/…` 这类本地相对引用）改写为项目内 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`（`hfEnv.localizeVendorHtml`），并把页面引用到的随包文件复制进项目目录（`hfEnv.ensureVendorFiles`）——三个**作者态**写盘点（generate / modify / save-html）还会用复制结果做兜底：`ensureVendorFiles` 返回 `false`（有库缺失 / 复制失败）就把引用换回固定版本 CDN（`hfEnv.externalizeVendorHtml`），宁可联网也不引用不存在的文件。导出频道 `project:download-html` 同样反向调用 `externalizeVendorHtml`，保证导出的单个 HTML 文件放到别处也能独立打开。**另有一件同层的事：共享绘制助手 `./core.js` 按版本同步进项目**（`syncCoreLib` → `coreLib.syncCoreTo`，版本一致 + 文件在就什么都不做），时机是「写骨架前 / 预览前（仅当页面引了 `./core.js`）/ 导出前」，覆盖时往 `userData/core-lib.log` 记一行；导出时它**不走 CDN 换回、而是内联**（`coreLib.readProjectCore`）——它不是第三方库，没有 CDN 形态。
7. **老项目免批量迁移**：读取时兼容（`subtitle` 内联旧字段优先、`content.json` 文件优先，缺失时回退内联旧字段），下一次任意保存（`writeProject`）自动把正文落到文件并把内联字段从索引里剥掉——**没有迁移脚本、没有一次性的批量改写**（机制见 3.9）。
8. **IPC 网关**：在 `register(ctx)` 中注册全部 `project:*` 频道（**31 个 `ipcMain.handle`**），供渲染层完成项目列表、生成、预览、导出、素材选择、角色搬移与新建、产物回写等操作。
9. **章节化长片（W3）+ 项目角色（本轮定稿：角色是**项目资产**）**：`project:generate-html` 改为**先规划再分支**——先让模型做一次结构规划（输出只剩 `mode` + `chapters`），判 `single` 走整份 `index.html` 路径、判 `chapters` 走章节模式（每章 `pages/cNN.js`，`index.html` 由 `chapters.ts` 的 `buildSkeleton` 确定性生成，**全部成功才落盘**）。**角色不在这条链路里产生**：它落在 `Project.cast`、代码在 `cast/<id>.js`，由「新建角色」（`project:new-cast`，调一次模型）或「从全局库添加」（`project:import-cast`，复制文件）建好；生成时只取 `cast.selectedMembers(proj.cast)`（勾选参与本次生成的那些），**两种形态都注入**——章节模式按传入的 `cast` 列表写 `<script src="./cast/<id>.js">`（不再看各章 cast 并集），单文件模式由 `applyCastToHtml()` 调 `castInject.injectCastTags()` 整组插在模型自己的第一个 `<script>` 之前。「按需求修改」在章节模式下仍是**两段式**：先只发「大纲 + 角色表 + 用户的话」让模型报要改哪几份文件（`editRoute.parseRouteReply`，≤6 个、只认真实存在的 `pages/cNN.js` / `cast/<id>.js`，解析失败回退成发全部源码），再只读那几份源码定向编辑；`HTML_CHAPTER_EDIT_SYSTEM` 明确「角色表不归你管，只可能被要求改某个角色的画法」。`project:download-html` **两种形态都内联**角色与 `core.js`。进度复用 `project:html-progress`，载荷多 `chapterIndex` / `chapterTotal`（**没有新增进度频道**）。
10. **全局角色库**：跨项目复用同一份角色绘制代码。库在 `<userData>/cast-library/`（`index.json` + `<id>.js`），是**用户资产**（可备份、可迁移、不进安装包），与 `vendor/` 的应用资源刻意分开。四个动作各一条频道：列库（`project:cast-library`，条目带 `missing`）、存为全局（`project:promote-cast`，同 id 覆盖）、导入项目（`project:import-cast`，**复制**进 `cast/`、合并角色表（默认勾选）、随后 `refreshCastInPage()` 让页面立刻反映）、从库删（`project:remove-cast-from-library`，不动已导入的项目）。**导入是复制不是引用**：预览协议只放行项目目录、渲染静态服务器 root 只有编译产物 + 项目目录，项目外的文件页面读不到。相应地，**全局库改了不会自动改已导入的项目**——要更新就再导入一次。
11. **角色表变更立即生效（`refreshCastInPage`）**：新建 / 导入 / 勾选 / 移除之后都走它——章节模式重写骨架、单文件模式按新勾选重新注入（`castInject` 幂等，**不动模型写的内容**），然后写 `project.json`。

## 2. 数据结构

> 本节五个结构（`Scene` / `ContentScript` / `ProjectIndex` / `Project` / `SubtitleLine`）的**定义都在 `src/shared/types.ts`**（跨进程单一真源），本文件靠顶部的 `export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'` 再导出前四个中的四个（`ProjectIndex` 只 import 不再导出），各 IPC handler 的 `payload` 参数同样改用共享层的 `Project*Payload` 类型。字段语义如下（与源码逐字一致）。

### 2.1 `Scene`（内容脚本中的单个场景）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 场景唯一标识；缺失/空时由 `normalizeContent` 自动补 `scene-<base36 时间>-<索引>-<序号>` |
| `narration` | `string` | 场景旁白 / 配音稿；**可以为空**——空旁白表示静音段（该场没有配音、成片里纯画面播放），进提示词时写成 `- 旁白：（无，本场静音）`。它**不再是**提示词里的有效性判据（判据是 `visual` 非空，见 §3 的 `buildContentBlock`） |
| `visual` | `string` | 画面分镜：**一行写一个镜头**，行首带该镜头的时长（如 `2.5s `），一个场景 2–5 行、不要写成一大段；进生成提示词时逐行缩进成 `  - 2.5s …`（主进程只排版、**不解析时长**，见 §3 的 `buildContentBlock`） |
| `durHint` | `string` | 时长提示（字符串，用于提示模型节奏） |

### 2.2 `ContentScript`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `style` | `string` | 全局视觉风格描述；由 `buildStyleBlock()` **无条件**写进生成/修改提示词（用户没填时该块明说「未指定、自行拟定」，见 §3.10）。**不在 `buildContentBlock()` 里**——那块没有有效场景时返回 `''`，风格挂在里面会被一起吞掉 |
| `scenes` | `Scene[]` | 场景数组 |

### 2.3 `ProjectIndex`（= `project.json` 的落盘字段，**只有索引**）

源码定义（`src/shared/types.ts`）：

```ts
export type ProjectIndex = Omit<Project, 'subtitle' | 'content'> & {
  subtitle?: string
  content?: ContentScript
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | 项目名（目录名，非法字符 `\ / : * ? " < > \|` 会被替换为 `_`） |
| `title` | `string` | 是 | 展示标题，缺省使用 `字幕动画` |
| `subtitleCount` | `number` | 否 | 字幕条目数，由 `parseSubtitle(subtitle).length` 统计（`project:save-subtitle` 写） |
| `htmlPath` | `string` | 是 | `index.html` 的**绝对路径**（空串表示未生成） |
| `videoPath` | `string` | 是 | **转视频产物的项目内相对路径**（形如 `video/output.mp4`；空串表示未生成 / 已失效）。`project:load` 返回给渲染层前会经 `resolveVideoAbs()` 换算成**绝对路径**，`project:save-video` 落盘时把项目目录内的绝对路径换算回相对路径——详见 3.8 |
| `audioFile` | `string` | 是 | 背景音频相对引用（`audio/xxx`，空串表示无）；同时是注入 HTML 音轨（`<audio id="myv-bgm">`）的唯一来源，见 3.5 |
| `materials` | `ProjectMaterial[]` | 否 | **项目素材库**（图片 / 视频），`ensureProject` 的初始对象为 `[]`；读盘与写盘都经 `normalizeMaterials()` 规范化（见 2.6 / 3.6） |
| `render` | `RenderOverride` | 否 | 视频渲染档位的**项目级覆盖**：字段缺省即跟随全局默认（`settings.json` 的 `render`） |
| `canvas` | `RenderCanvas` | 否 | **成片画布方向（项目属性）**：`'landscape'` / `'portrait'` / `'square'`，字段不存在即缺省 `DEFAULT_CANVAS` = `landscape`（1920×1080）；由 `project:set-canvas` 写入，**生成提示词 / 预览画布 / 渲染入口注入的舞台 `data-width`/`data-height` 与 `<html data-resolution>` 三处都读它**（见 4 的 `project:set-canvas` 行与 5.13） |
| `videoMaterial` | `string` | 否 | **历史字段**：单视频素材时代的相对引用（`video/xxx`）。本轮起不再新写、素材列表也不读它；`writeProject` 只剥 `subtitle` / `content` 两个正文字段，因此老索引里若还留着它会被原样写回（仅 `project:extract-video-audio` 这个已下线入口的 handler 仍在读它，见 3.6 / 4 的 `project:extract-video-audio` 行）。`ttsAudio` 同属「只保留、不新写」的历史字段（由 `voice.ts` 的回执写，本文件不碰） |
| `createdAt` | `string` | 是 | ISO 时间字符串 |
| `updatedAt` | `string` | 否 | 每次 `writeProject` 自动刷新为 ISO 时间，列表按此倒序 |
| `subtitle` | `string` | 否 | **只作为老项目的内联旧格式存在**：读取时当回退来源（且**优先于** `subtitle.txt`，见 3.9），`writeProject` 时一律剥掉，不会写回 |
| `content` | `ContentScript` | 否 | 同上：老项目的内联旧格式，`readContent` 的文件兜底来源，`writeProject` 时剥掉 |

### 2.4 `Project`（完整视图 = 索引 + 两个正文文件）

源码注释逐字：「项目的**完整视图**（renderer 侧与主进程内部使用的形状）。注意：正文（subtitle / content）**不在 project.json 里**——它们分别是项目目录下的 subtitle.txt 与 content.json；project:load 由主进程把三者拼成这个结构，渲染层契约因此不变。」

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `subtitle` | `string` | **字幕正文**（来自 `subtitle.txt`，老项目内联字段优先），`project:load` 时由 `readSubtitle()` 取得；`writeProject` 会把它同步写进 `subtitle.txt` |
| `content` | `ContentScript` | **内容脚本正文**（来自 `content.json`，老项目内联字段兜底），由 `readContent()` 取得；`writeProject` 会把非空的它补写进 `content.json`（文件不存在时） |
| 其余字段 | — | 与 2.3 的索引字段同名同义：`Project` 是完整声明，`ProjectIndex` 由它 `Omit` 掉 `subtitle` / `content` 再把这两个字段补成可选而来 |

> 除上表两行以外，`Project` 与 `ProjectIndex` 的字段集合相同；**唯一的结构差别**是 `Project` 的 `subtitle` / `content` 为**必填**，`ProjectIndex` 里这两个字段**可选**（只服务老数据）。

### 2.5 `SubtitleLine`（`parseSubtitle` 输出）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `n` | `number` | 行号（从 1 开始；被跳过的空文本行仍会占用行号，故可能出现跳号） |
| `text` | `string` | 该行文本（已 trim） |
| `time` | `number` | 开始时间，单位秒，可含小数（毫秒精度） |
| `end` | `number \| null` | 结束时间，单位秒；无结束时间或解析出的结束不大于开始时为 `null` |

### 2.6 `ProjectMaterial`（素材库条目，定义在 `shared/types.ts`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 素材 id（`newMaterialId()` 生成，形如 `mat-<base36 时间>-<自增序号>`）；勾选与移除都按它定位，与文件名解耦（同名文件重复导入也不会串） |
| `kind` | `ProjectMaterialKind` = `'image' \| 'video'` | 素材类型，决定落盘目录（`MATERIAL_DIR`）与提示词分块 |
| `file` | `string` | **项目内相对引用**（`images/xxx` 或 `video/xxx`），必须落在本项目对应目录下（`normalizeMaterials` 强制校验） |
| `label` | `string` | 展示用文件名（导入时取 `path.basename(原路径)`，缺失时回退 `path.basename(file)`） |
| `selected` | `boolean` | 本次生成是否带上（`normalizeMaterials` 里 `o.selected !== false`，即**缺省视为 true**） |
| `addedAt` | `string` | ISO 时间；缺失时补当前时间 |

### 2.7 磁盘布局：`project.json` 只存索引，正文各归其文件

源码文件头注释逐字（`src/main/projects.ts` 顶部）：

```ts
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本（**唯一正文**）
//   content.json  内容脚本 { style, scenes }（**唯一正文**）
//   index.html    由脚本/字幕生成的 HTML composition
//   project.json  **只有索引**：name/title/subtitleCount/htmlPath/videoPath/audioFile/
//                 materials/render/canvas/时间戳 等小字段；不含字幕与脚本正文
//   images/       图片素材（HTML 生成用，project.json 的 materials 以相对引用登记）
//   video/        视频素材（同上）
```

三条要点：

1. **`subtitle.txt` 是字幕的唯一正文，`content.json` 是内容脚本的唯一正文**（本轮新增的文件，内容为 `{ style, scenes }` 的 `JSON.stringify(…, null, 2)`）。
2. **`project.json` 只是索引**：上面那张 2.3 的表就是它的全部字段（老项目可能还带 `subtitle` / `content` 内联旧字段，`writeProject` 会剥掉）。
3. **为什么必须分层**：`scanProjects()` 在**每次 `project:list`** 都要把**每个项目**的这份 JSON 读出来 `JSON.parse`，而字幕正文曾占其中 87–96%，等于让列表为了一点元数据反复解析整篇字幕。实测体积（同一份数据重构前后）：`任意文件女生` 的 `project.json` **5283 B → 849 B**，`项目3` **7930 B → 278 B**。

## 3. 内部实现函数

> **`projectsRoot` 自更早一轮起由「模块级常量」改为「函数」**（2026-10 品牌改名事故修复）。原因（源码注释要点）：ESM 的 `import` 提升会让本模块在 `index.ts` 的模块体之前求值；**当前 userData 位置只跟随 `package.json` 的 `name`，模块级快照本来也正确**——但只要将来有任何「在模块体里改 userData 位置」的代码（例如重新引入 `app.setPath`），快照就会静默钉在**当时**的 userData 上，表现为「项目全没了」且极难查。写成函数永远按当前值解析，代价为零，属**纯保险**。
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
> | `projectDir(name)`（函数体里的 `path.join(projectsRoot(), …)`） | `path.join(projectsRoot(), 净化后的项目名)` |
> | `scanProjects()`（函数开头那行 `const root = projectsRoot()`） | 先 `const root = projectsRoot()`，后续只用 `root`（`existsSync` / `readdirSync`） |
> | `IPC.Project.Delete`（`ipcMain.handle(IPC.Project.Delete, …)` 里的 `dir.startsWith(projectsRoot())`） | `dir.startsWith(projectsRoot())` 前缀校验 |

| 名称 | 导出 | 行号 | 说明 |
| --- | --- | --- | --- |
| `projectsRoot()` | 是 | 73 | **函数**：`path.join(app.getPath('userData'), 'projects')`，所有项目目录的根；每次调用都重新求值（惰性），调用点不得把它缓存成模块级常量 |
| `projectDir(name)` | 是 | 77 | 拼接项目目录；把 `name` 中 `[\\/:*?"<>\|]` 替换为 `_` 防非法路径 |
| `projectFilePath(name, file)` | 是 | 80 | `path.join(projectDir(name), file)`，项目内文件绝对路径 |
| `contentFilePath(name)` | **否** | 87 | **本轮新增**：`projectFilePath(name, 'content.json')`——内容脚本正文文件的唯一路径来源（`readContent` / `writeContent` / `writeProject` 都用它，不各自拼字符串） |
| `readProject(name)` | 是 | 91 | **只读索引**：`project.json` 不存在或 `JSON.parse` 异常返回 `null`（静默容错），否则返回 `ProjectIndex`；**不做任何规范化**（脏数据原样带出，规范化在各消费点做） |
| `readSubtitle(name, legacy?)` | **否** | 104 | **本轮新增**：字幕正文读取。`legacy` 是**非空字符串**时直接返回它（**内联旧字段优先**）；否则读 `subtitle.txt`（存在才读，读失败当空）；都没有返回 `''`。为什么内联优先见 3.9 |
| `readContent(name, legacy?)` | **否** | 114 | **本轮新增**：内容脚本读取。`content.json` 存在则 `normalizeContent(JSON.parse(…))`；文件缺失/损坏/解析异常回退 `normalizeContent(legacy)`；两者都没有得到 `{ style: '', scenes: [] }` |
| `writeContent(name, content)` | **否** | 122 | **本轮新增**：递归建目录后把 `content` 以 `JSON.stringify(content, null, 2)` / `utf8` 写成 `content.json` |
| `writeProject(proj)` | 是 | 128 | **写项目**：① 递归建目录 ② 刷新 `proj.updatedAt` ③ **先把正文落盘**：`subtitle.txt` 与 `proj.subtitle` 不同才写、非空的 `content` 落成 `content.json`（**文件不存在才写**）④ **只写索引**：`const { subtitle, content, ...index } = proj` 后写 `project.json`。顺序细节见 3.9 |
| `ensureProject(name)` | 是 | 159 | 索引 + 正文文件拼成**完整 `Project`**：`readProject` 命中时取 `{ subtitle, content, ...rest }`，返回 `{ ...rest, name, subtitle: readSubtitle(name, legacySub), content: readContent(name, legacyContent) }`；否则返回默认项目（`title='字幕动画'`、空 `subtitle`/`htmlPath`/`videoPath`/`audioFile`、**`materials: []`**、`content={style:'',scenes:[]}`、`createdAt=now`）；**不落盘** |
| `normalizeContent(raw)` | 是 | 186 | 内容脚本规范化：非对象按空处理，`style` 非字符串置 `''`，逐场景做类型收敛并补 `id`，实现旧数据向后兼容 |
| `scanProjects()` | 是 | 209 | 扫描 `projectsRoot()` 各子目录，`readProject` 为 `null` 者跳过，返回 `{ name, title, hasSubtitle, hasHtml, hasVideo, subtitleCount, updatedAt }`，按 `updatedAt` 倒序；`hasVideo` = `!!resolveVideoAbs(p.name, p.videoPath)`；**`hasSubtitle` = `(p.subtitleCount \|\| 0) > 0 \|\| !!p.subtitle \|\| fs.existsSync(projectFilePath(d.name, 'subtitle.txt'))`**（字幕正文已不在索引里，故三路判定，见 3.9） |
| `parseSubtitle(text)` | 是 | 236 | 解析字幕：支持 `[分:秒] 文本`、`[分:秒-分:秒] 文本`（小数位数即精度，3 位=毫秒）与纯文本自动估时（估时走共享层的 `estimateSubtitleDur()`，见 3.1） |
| `copyAudioIntoProject(name, audioPath)` | 是 | 268 | 复制音频到 `audio/`，重名自动追加 `_1`…`_1000`，返回 `audio/文件名`；失败返回 `''` |
| `copyMaterialIntoProject(name, kind, srcPath)` | 是 | 312 | **取代原 `copyVideoIntoProject`**：按 `MATERIAL_DIR[kind]` 复制到 `images/` 或 `video/`，命名与去重规则同旧实现（`[\\/:*?"<>\|]` → `_`，重名追加 `_1`…`_1000`），返回 `images/文件名` 或 `video/文件名`；失败返回 `''` |
| `normalizeMaterials(raw)` | 是 | 339 | 素材列表规范化，**读盘与写盘共用**（见 3.6）；返回干净的 `ProjectMaterial[]` |
| `MATERIAL_DIR` | 否 | 294 | `const MATERIAL_DIR: Record<ProjectMaterialKind, string> = { image: 'images', video: 'video' };`——素材按类型分目录，是「项目内相对引用」与越权校验的共同基准 |
| `materialSeq` / `newMaterialId()` | 否 | 297 / 298 | 素材 id：`'mat-' + Date.now().toString(36) + '-' + materialSeq`，`materialSeq` 为模块级自增序号，保证同一毫秒内多个素材也不同 id |
| `materialKindOf(filePath)` | 否 | 304 | 由扩展名判类型（`path.extname(...).replace('.','').toLowerCase()`）：命中 `IMAGE_MATERIAL_EXTS` → `'image'`、命中 `VIDEO_MATERIAL_EXTS` → `'video'`，**白名单外一律返回 `''`，调用方自行跳过** |
| `materialExtsText()` | 否 | 364 | 白名单的可读文案：`['图片 ' + IMAGE_MATERIAL_EXTS.join('/'), '视频 ' + VIDEO_MATERIAL_EXTS.join('/')].join('，')`，用于「没有可添加的素材」失败提示 |
| `buildAgentPrompt(parts)` | 否 | 369 | `parts.filter(Boolean).join('\n')`，拼接提示词片段 |
| `buildContentBlock(content)` | 否 | 379 | 由 `content` 生成「内容脚本」提示块：**有效场景判据 = 画面分镜（`visual`）非空，旁白可为空**（空旁白写成 `- 旁白：（无，本场静音）`，块头也写明「旁白写『（无，本场静音）』的场景没有配音，按画面分镜照常呈现即可」）。**块头的第二行是画面分镜的书写约定**（逐字）：「画面分镜按「一行一个镜头」书写，行首形如「2.5s」的是该镜头的时长：请把这些时长按顺序累加成绝对时间（第 1 个镜头从 0 开始）再安排动画；行首没写时长的镜头按该场景的时长提示均分；镜头时长之和与该场景的时长提示冲突时，以镜头时长之和为准。」**每个场景先出一行标题 `- 画面分镜：`，再把 `visual` 按行拆开、逐行缩进成 `  - 2.5s …`**——拆行是为了让第二个镜头起不会被读成新的顶层字段；**主进程不解析任何时长、只排版**，节奏由模型按行读。无有效场景（**画面分镜全空**）返回 `''`，老项目因此回退原流程。**本块不含全局视觉风格**（原先它只是本块的第一行，会随 `''` 一起被吞掉——风格改由 `buildStyleBlock` 无条件注入，见 3.10） |
| `buildStyleBlock(content)` | 否 | 413 | **【全局视觉风格】块（生成 / 修改共用，无条件注入）**：`content.style` 非空就写成「本项目整片的视觉基调（用户指定，页面配色、质感与氛围以此为准）：<用户填的内容>」，为空则写成「用户未指定，按需求描述与内容脚本自行拟定（不要套用固定的配色模板）」。与 `buildContentBlock` **解耦**的根因见 3.10 |
| `HG_PREVIEW_CTRL` | 否 | 428 | 注入预览副本的播放控制脚本源码（IIFE 字符串常量） |
| `BGM_TAG_ID` | 否 | 581 | 注入音轨标签的固定 id 常量 `'myv-bgm'`——保证重复设置不叠出多条音轨（见 3.5） |
| `insertHtmlSnippet(html, snippet)` | 否 | 585 | 把片段插到文档末尾：优先 `</body>` 前，其次 `</head>` 后，都没有则拼最前。`IPC.Project.PreviewHtml` 原先内联的同一段 if/else 已改为调用本助手（行为不变） |
| `escapeRegExp(s)` | 否 | 592 | 转义正则元字符（供 `stripAudioOfFile` 把音频文件名安全拼进正则） |
| `stripInjectedBgm(html)` | 否 | 597 | 按 `BGM_TAG_ID` 摘掉本应用注入的音轨标签（幂等） |
| `stripAudioOfFile(html, audioRef)` | 否 | 602 | 摘掉引用同一项目音频文件的历史 `<audio>`（旧版由模型按提示词写入），避免与新标签双份播放 |
| `applyBgmToHtml(name, proj?)` | 否 | 611 | 按 `proj.audioFile` 重写 `index.html` 的音轨；无 HTML 时静默返回 `false`，内容无变化不写盘；返回 `true` = 文件被改写（见 3.5）。**`proj` 缺省时读的是 `readProject(name)`（索引）**——它只用到 `audioFile` 一个字段，因此不需要拼完整 `Project` |
| `resolveMaterials(proj, payload: ProjectAgentPayload)` | 否 | 635 | 解析 `subtitleProject` / `materialIds`，返回 `{ subtitleText, materials }`（**两个选择项都只是「要不要带上」**：字幕不带路径；素材按 id 从项目素材库取，顺序 = 渲染层列表顺序，取不到的 id 静默忽略；音频则由 `applyBgmToHtml` 注入 HTML、完全不经过本函数）。「别的项目的字幕」分支本轮改为 `readSubtitle(subSel, src.subtitle)`（见 3.3） |
| `buildMaterialBlock(materials)` | 否 | 656 | 由勾选素材生成「【图片素材】/【视频素材】」两段提示词（见 3.7） |
| `buildCanvasBlock(proj, forModify = false)` | 否 | 677 | **生成/修改共用的【画布】块**：把项目选定的画布告诉模型（`成片画布固定为 <CANVAS_LABELS[canvas]>（<宽>×<高> 像素），渲染视口就等于这块画布`），并列出**四条固定要求**（写死 `data-resolution`、主舞台严格等于该尺寸且写固定 px、不要 vw / vh / 百分比 / `transform: scale`、内容排满整块画布）；**`forModify === true` 时额外追加第 ⑤ 条**——若当前页面的 `<html data-resolution>` 或主舞台尺寸与本画布**不一致**（典型：页面原按横屏 1920×1080 排过版、画布后来改成方形 / 竖屏），必须**重新排布**（主舞台改成上面的尺寸、按新画布重算所有元素的位置 / 字号 / 间距、内容排满整块画布），**不要**用 `transform: scale`、居中留白或黑边把旧版式硬套进新画布（详见 4.2）。第 ①–④ 条与原有措辞一字未改。`project.json` 可能被手改过 ⇒ **非 `RENDER_CANVASES` 白名单取值一律落回 `DEFAULT_CANVAS`**（避免 `CANVAS_SIZES` 取不到而崩） |
| `buildMaterialPrompt(prompt, proj, mats, extra, forModify = false)` | 否 | 701 | 生成/修改共用的提示词装配：`extra`（修改时为当前源码）在最前，随后需求、内容脚本块、**【全局视觉风格】块（`buildStyleBlock(proj.content)`，紧跟内容脚本块、不受「有没有场景」影响）**、字幕、【音轨】声明、**【画布】块（`buildCanvasBlock(proj, forModify)`）**、**【成片时长】声明**、`buildMaterialBlock(mats.materials)`。**`forModify` 只透传给画布块**：生成路径不传（默认 `false`），修改路径显式传 `true`（见 4.2 / 5.2 / 5.3） |
| `progressText(info)` | 否 | 732 | 把 `AgentProgress.stage` 转为中文进度文案（连接/推理/生成/重试/完成），并给章节 / 角色模式加前缀：`chapterIndex`+`chapterTotal` ⇒ 「第 k/N 章：…」，`castIndex`+`castTotal` ⇒ 「**角色 k/M：…**」 |
| `castLibraryRoot()` | 否 | 775 | **本轮新增**：`path.join(app.getPath('userData'), 'cast-library')`——全局角色库的根。注释：库是**用户资产**（可备份、可迁移），落 userData 下；`core.js` 的真源在应用里（`hfEnv.coreSource()`），两者不是一个东西 |
| `syncCoreLib(projDir)` | 否 | 781 | **本轮新增**：把共享绘制助手同步进项目。`hfEnv.coreSource()` 拿不到真源就 **直接 return（不拦下生成）**；否则 `coreLib.syncCoreTo(projDir, src)` —— 只有 `copied` 或 `error` 时才往 `<userData>/core-lib.log` 追加一行（`ISO [项目名] core.js 版本 a → b` / `core.js 同步失败：…`），日志写失败静默。**幂等**：版本一致 + 文件在就什么都不做，所以预览 / 渲染这类高频路径可以每次都调 |
| `applyCastToHtml(html, proj, dir)` | 否 | 954 | **本轮新增**：单文件模式的角色注入。`cast.selectedMembers(proj.cast)` → `cast/<id>.js` 相对路径 → `castInject.injectCastTags(html, rels, { withCore })`。**没勾选任何角色时只把旧注入剥掉、不塞 `core.js`**（`injectCastTags(html, [], { withCore: false })`：模型写的页面本来就不认识 `MC.*`）；有勾选角色时先 `syncCoreLib(dir)` 再注入（页面引的是 `./core.js`，文件必须先到位）。幂等，见 [castInject.ts](./castInject.ts.md) |
| `refreshCastInPage(name, proj)` | 否 | 966 | **本轮新增**：角色表变了（新建 / 导入 / 勾选 / 移除）之后让页面立刻反映——`proj.chapters` 非空就 `writeChapterSkeleton(name, proj, proj.chapters, cast.selectedMembers(proj.cast))`（骨架里的 script 清单就是「谁参与」的真相）；否则读回 `index.html`、`applyCastToHtml()` 重新注入、**有变化才写盘**（不动模型写的内容）；最后 `writeProject(proj)` |
| `register(ctx?)` | 是 | 1187 | 注册全部 `project:*` IPC（**31 个 `ipcMain.handle`**，本轮 +2 个角色 handler `NewCast` / `SaveCast`）；`ctx.getWindow` 用于给各类对话框提供父窗口 |

> **行号列的口径**：本轮在 `projectCanvas()` 之后插入了 `castLibraryRoot`（775）/ `syncCoreLib`（781）两个函数（连同注释共 20 行），其后各函数整体后移，`register()` 现在在第 **1187** 行。表里更早几行的行号是上一版遗留的小偏移，**定位时以函数名为准**。

### 3.1 `parseSubtitle` 细节

- 匹配正则：`^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?(?:\s*-\s*(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?)?\]\s*(.*)$`，即分/秒、毫秒可选、起止区间可选。
- 小数解释：`frac(digits) = (+digits) / 10^digits.length`（`.9` = 0.9s、`.900` = 0.9s）。
- 纯文本自动估时：首行 0.4s，之后每行步进 `estimateSubtitleDur(文本)` 秒——该函数来自 `@shared/constants`（与渲染层字幕页 `estDur` 是同一份实现，本文件不再写系数）。公式是 `max(2.4, 1.6 + 字数 ÷ 4)`（分母是 `@shared/constants` 的 `EST_CHARS_PER_SEC`，**4 字/秒**）；下限 2.4 秒与基数 1.6 秒是历史沿用值，与语速无关。
- 这条「整行没有 `[时间]` 前缀 ⇒ 用估时兜底一个起始时间」正是 `ttsAlign.ts` 逐句对齐的输入基础：`voice:synth-aligned` 里 `parseSubtitle(subtitleText)` 拿到的 `time` 可能全部来自估时（用户只写了纯文本旁白），模式 A 的首句锚点（`lines[0].time`）与模式 B 的槽位都建立在这条时间轴上。所以估时口径是**跨进程的**：渲染层预览的字幕时长、落盘的 `[起-止]` 文本、对齐用的槽位必须由同一套规则算出。

对应源码（`parseSubtitle` 的无时间戳分支）：

```ts
    if (time === null) {
      time = autoT;
      autoT += estimateSubtitleDur(txt); // 估时规则与渲染层共用（@shared/constants），别在这里另写系数
    }
```
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
| `subtitleProject` | `'__current__'` | 使用当前项目 `proj.subtitle`（此时 `proj` 由 `ensureProject` 拼好，字幕即 `subtitle.txt` / 内联旧字段的那一份） |
| `subtitleProject` | 其他字符串（项目名） | `readProject(subSel)` 取该项目索引，再用 **`readSubtitle(subSel, src.subtitle)`** 取它的字幕正文——与 `ensureProject` 同一口径（内联优先、`subtitle.txt` 兜底）；索引读不到就是 `''` |
| `materialIds` | 缺省 / 非数组 / 空数组 | 不带任何素材 |
| `materialIds` | `string[]` | 按 id 从 `normalizeMaterials(proj.materials)` 里逐条取，**顺序即提示词里的列举顺序**；取不到的 id 静默忽略 |

「别的项目的字幕」分支实现即：

```js
// 别的项目的字幕同样按「内联优先、其次 subtitle.txt」取（与 ensureProject 同一口径）
const src = readProject(subSel);
subtitleText = src ? readSubtitle(subSel, src.subtitle) : '';
```

素材分支实现即：

```js
const ids = Array.isArray(payload.materialIds) ? payload.materialIds : [];
const all = normalizeMaterials(proj.materials);
const materials = ids
  .map((id) => all.find((m) => m.id === id))
  .filter((m): m is ProjectMaterial => !!m);
```

**素材的复制入库不在这里**：加载 / 导入统一走 `project:add-materials`（复制进项目并登记，见 §4），因此本函数既不看文件是否存在，也不改动项目目录——它只做「按 id 挑出本次要用的那几条」。

**音频选择项已删除**：`ProjectAgentPayload` 不再有 `audioPath`，`resolveMaterials` 也不返回 `audioRef`。背景音频不是生成素材——它由 `applyBgmToHtml` 按 `project.audioFile` 直接写进 HTML，提示词里只声明「不要写音轨标签」（见 3.5）。`copyAudioIntoProject` 仍由 `project:set-audio` 使用。

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

常量为 `BGM_TAG_ID = 'myv-bgm'`（注入标签的固定 id），五个助手都是文件内私有函数：

| 助手 | 行为 |
| --- | --- |
| `insertHtmlSnippet(html, snippet)` | `lastIndexOf('</body>')` 命中则插在它前面；否则退回 `lastIndexOf('</head>') + 7`（即 `</head>` 之后）；两者都没有则把片段拼在文档最前。注释说明原因：模型输出可能被截断而缺 `</body>`，此时直接拼在文件末尾会落进未闭合的 `<script>`，导致整页 SyntaxError（`fitStage` / 时间轴全失效）。`IPC.Project.PreviewHtml` 里原来内联的同一段 if/else 已改为调用本助手，**行为不变** |
| `escapeRegExp(s)` | `String(s).replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')`，把音频文件名安全拼进正则 |
| `stripInjectedBgm(html)` | 用 `'<audio\\b[^>]*\\bid=["\']myv-bgm["\'][^>]*>(?:[\\s\\S]*?</audio>)?'`（`gi`）全量替换为空——摘掉本应用注入的标签（幂等） |
| `stripAudioOfFile(html, audioRef)` | 先 `path.basename(audioRef)` 取文件名（空则原样返回），再用转义后的文件名拼正则，摘掉 `src` 里含该文件名的**任意** `<audio>`——清理旧版由模型按提示词写入的历史标签，避免与新标签双份播放 |
| `applyBgmToHtml(name, proj?)` | 见下面的算法 |

`applyBgmToHtml(name, proj?)`（返回 `boolean`）：

1. `projectFilePath(name, 'index.html')` 不存在 → 直接 `false`（还没生成 HTML 时静默跳过，调用方无需分支）。
2. `proj` 缺省时 `readProject(name)`（**索引**，只用 `audioFile`）；`audioRef = (p && p.audioFile) \|\| ''`。
3. 读原文 `before` → `stripInjectedBgm(before)`；若 `audioRef` 非空再 `stripAudioOfFile(html, audioRef)`（**先摘后插**，保证幂等）。
4. 若 `audioRef` 非空，`insertHtmlSnippet(html, '<audio id="myv-bgm" src="' + audioRef + '" autoplay loop></audio>')`——`autoplay + loop` 与旧提示词要求一致（音轨通常短于整条时间轴）。
5. `html === before` → 返回 `false`（**内容无变化不写盘**，避免无谓的 mtime 抖动）；否则 `writeFileSync` 后返回 `true`。
6. 整个读改写包在 `try/catch` 中，异常一律 `false`（不抛异常、不阻断调用方主流程）。

**为什么标签要带固定 id**：`set-audio` / `extract-video-audio` 会被反复调用（换音频），固定 id 让「先摘再插」成为幂等操作，否则 HTML 里会随每次设置叠出一条音轨。

**为什么音轨不交给 Agent**：模型重写整页时可能整段丢掉注入标签，且提示词里的素材块越多越容易顾此失彼；改为「模型只声明、主进程负责写」，并在生成/修改写盘后再补一次注入（见 5.11）。

### 3.6 项目素材库（`MATERIAL_DIR` + 5 个助手）

**动机**：原来的「单个视频素材」（`Project.videoMaterial` + `project:pick-video` / `set-video` / `clear-video`）无法表达「多张图片 + 多个视频」的素材库；本轮改为 `Project.materials` 列表 + 三个新频道。

```js
// 素材按 kind 落到各自的目录；与场景/字幕一样，project.json 里只登记**项目内相对引用**（file），
// 因此项目目录可以整体搬走/复制，页面里的 <img src="images/x.png"> 也不会失效。
const MATERIAL_DIR: Record<ProjectMaterialKind, string> = { image: 'images', video: 'video' };

// 素材 id：进入界面即稳定不变（勾选、移除都按它定位），与文件名解耦（同名文件重复导入也不会串）
let materialSeq = 0;
function newMaterialId(): string {
  materialSeq++;
  return 'mat-' + Date.now().toString(36) + '-' + materialSeq;
}

// 由扩展名判素材类型；白名单外一律不认（返回 ''），调用方自行跳过
function materialKindOf(filePath: string): ProjectMaterialKind | '' {
  const ext = path.extname(String(filePath || '')).replace('.', '').toLowerCase();
  if (IMAGE_MATERIAL_EXTS.includes(ext)) return 'image';
  if (VIDEO_MATERIAL_EXTS.includes(ext)) return 'video';
  return '';
}
```

`normalizeMaterials(raw: unknown): ProjectMaterial[]` —— **读盘与写盘共用**，源码注释列了六条规则：

```
// 素材列表规范化（**读盘与写盘共用**）：脏数据在进入渲染层之前就被清掉，写回时也不会落进 project.json。
// ① 非数组/非对象丢弃；② kind 只认 image/video；③ file 必须是本项目 images/ 或 video/ 下的相对路径
// （挡掉 ../ 与绝对路径这类越权引用）；④ id 缺失补一个；⑤ selected 缺省视为 true；⑥ 条数截到 MAX_MATERIALS。
```

具体实现要点（逐条对应源码）：

1. `const list = Array.isArray(raw) ? raw : []`；`out.length >= MAX_MATERIALS` 时 `break`（**截断而非报错**）。
2. 非对象 / 数组元素 `continue`。
3. `kind` 只接受字面量 `'image'` / `'video'`，其他一律 `continue`。
4. `file` 取 `o.file.replace(/\\/g, '/').replace(/^\.\//, '')`；**空、含 `..`、不以 `MATERIAL_DIR[kind] + '/'` 开头**三种情况都 `continue`（把 `../` 与绝对路径这类越权引用挡在进入渲染层之前）。
5. `id` 缺失（非字符串或空）时 `newMaterialId()`；`label` 缺失时 `path.basename(file)`；`addedAt` 缺失时补当前 ISO 时间。
6. `selected: o.selected !== false`（缺省 true）。

`materialExtsText()` 返回 `图片 png/jpg/…，视频 mp4/…` 形态的可读白名单，用于 `project:add-materials` 的失败提示。

**为什么规范化要读盘写盘共用**：`project:load` 会把盘上的 `materials` 规范一遍再交给渲染层（界面不必再校验），`project:save-materials` 也把提交回来的列表规范一遍再落盘（渲染层传来的脏数据 / 越权路径不会进 `project.json`）。

### 3.7 素材如何进入提示词（`buildMaterialBlock`）

```js
// 素材块（图片 / 视频分开写）：给模型的是**项目内相对路径**——页面里直接 <img src="images/x.png">，
// 预览走 hgpreview:// 协议、转视频时同目录相对引用同样成立（与背景音轨、gsap.min.js 同一套相对引用规则）。
function buildMaterialBlock(materials: ProjectMaterial[]): string {
  const imgs = materials.filter((m) => m.kind === 'image');
  const vids = materials.filter((m) => m.kind === 'video');
  const list = (arr: ProjectMaterial[]): string => arr.map((m) => m.file + '（原文件名 ' + m.label + '）').join('、');
  const parts: string[] = [];
  if (imgs.length) {
    parts.push('\n【图片素材】项目内图片文件：' + list(imgs) + '。请按 <img src="' + imgs[0].file
      + '"> 这类项目内相对路径嵌入，并用 GSAP 为每张图编排入场/退场（淡入淡出、位移、缩放）与切换节奏；多张图片按内容脚本的场景顺序分配。');
  }
  if (vids.length) {
    parts.push('\n【视频素材】项目内视频文件：' + list(vids) + '。请用 <video src="' + vids[0].file
      + '" autoplay muted loop playsinline> 嵌入，并用 GSAP 时间轴编排其入场/出场与播放时段。');
  }
  return parts.join('');
}
```

- 两段都以**勾选的第一条**（`imgs[0].file` / `vids[0].file`）作为写法示例，随后列举全部素材（`file（原文件名 label）`）。
- 元素写法固定为 `<img src="images/…">` / `<video src="video/…" autoplay muted loop playsinline>`——与预览、转视频的相对引用规则一致。
- 该块由 `buildMaterialPrompt()` 接在【成片时长】声明之后，取代了旧的单条「【视频素材】…请将该视频作为页面内容的一部分嵌入（…）」文案。

### 3.8 成品路径改为「项目内相对路径」（`resolveVideoAbs`）

**为什么改**（源码注释给出的三条理由）：① 项目要**自包含**、能整体搬走 / 复制；② 绝对路径会因 userData 改名而失效——本仓库的老数据里就有指向旧目录 `…\my-app\projects\…` 的死路径（品牌改名前的目录名）；③ 旧实现把成品放在**渲染临时目录** `hf-projects\…` 里，那条路径随时会被清理，「有视频」的判定跟着一起塌。

**为什么能改**：成品现在由 `video.ts` **就地渲染**、直接生成在 `<项目目录>/video/output.mp4`，天然落在项目目录内（`video/` 正是素材目录 `MATERIAL_DIR.video`，两者同目录但语义不同：`video/output.mp4` 是**产出成品**，`video/xxx.mp4` 是**输入素材**）。

`resolveVideoAbs(name, videoPath)`（**文件内私有**，不导出）是唯一的解析入口，三条分支：

| `videoPath` 形态 | 返回 |
| --- | --- |
| 空 / 只有空白 | `''` |
| **绝对路径** | 文件存在 → 原样返回（兼容老记录，含 `hf-projects` 里的旧成品）；不存在 → `''`（死路径被判定为「没有视频」） |
| 相对路径（新写法） | `path.join(projectDir(name), v)`，**不判存在性** |

三个消费点：

| 消费点 | 语义 |
| --- | --- |
| `project:load` | 返回前 `videoPath: resolveVideoAbs(name, proj.videoPath)`——**交给渲染层的一律是绝对路径**（视频预览页要 `play`、要「在文件夹中显示」） |
| `scanProjects()` | `hasVideo: !!resolveVideoAbs(p.name, p.videoPath)`——取代原先的 `fs.existsSync(p.videoPath)`（旧写法依赖临时目录是否还在，且不认相对路径） |
| `project:save-video` | 落盘时的**反向换算**，见 5.6 |

> 注意：`videoMaterial` 与 `materials[].file` 仍是**相对引用**（它们是 HTML 里要用的输入素材），`htmlPath` 仍是**绝对路径**；只有 `videoPath` 这一处改成了「落盘相对、交给界面绝对」的双向语义，因为它是唯一会被「界面直接播放 / 定位」的字段。

### 3.9 正文的读写分层与老项目懒迁移

**分层后的四个读写入点**（都只碰自己那一个文件）：

```
contentFilePath(name)  →  <项目目录>/content.json            （路径唯一来源）
readProject(name)      →  project.json       → ProjectIndex〔只读索引〕
readSubtitle(name,l)   →  内联 l 优先，其次 subtitle.txt
readContent(name,l)    →  content.json 优先（normalizeContent），其次内联 l
writeContent(name,c)   →  content.json（mkdir + JSON.stringify(c,null,2)）
writeProject(proj)     →  先落正文（subtitle.txt / content.json），再只写索引
ensureProject(name)    →  索引 + 两个正文文件 拼成完整 Project
```

**`readSubtitle` 为什么内联优先**（源码注释逐字）：

```ts
// 字幕正文：**老项目的内联字段优先**——它才是当前界面显示的那一份。
// 实测历史数据里两者可能不一致（某项目 subtitle.txt 只有 1.5KB、project.json 里的内联是 5.7KB），
// 若让文件优先，老项目一升级字幕就会变短。内联字段会在下一次 writeProject 时被剥掉，之后只剩文件。
function readSubtitle(name: string, legacy?: unknown): string {
  if (typeof legacy === 'string' && legacy) return legacy;
  try {
    const p = projectFilePath(name, 'subtitle.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch (e) { /* 文件读不到就当空 */ }
  return '';
}
```

**`readContent` 为什么反过来文件优先**：`content.json` 是本轮新写的唯一正文，只要文件存在就是最新的（`normalizeContent` 顺带兜住 JSON 损坏）；文件缺失 / 抛异常才回退内联旧字段：

```ts
// 内容脚本正文：content.json 优先；文件缺失/损坏时回退内联旧字段（都没有就是空的 { style:'', scenes:[] }）
function readContent(name: string, legacy?: unknown): ContentScript {
  try {
    const p = contentFilePath(name);
    if (fs.existsSync(p)) return normalizeContent(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) { /* 回退内联 */ }
  return normalizeContent(legacy);
}
```

**`writeProject` 的顺序是这次重构的关键**（先落正文、后剥字段）：

```ts
function writeProject(proj: Project): Project {
  const dir = projectDir(proj.name);
  fs.mkdirSync(dir, { recursive: true });
  proj.updatedAt = new Date().toISOString();
  // 剥掉正文之前先把正文落盘：老项目的字幕 / 脚本可能只存在于 project.json 的内联字段里，
  // 直接剥掉等于把它们删了（下一次读会回退到更旧的 subtitle.txt）。只在「文件缺失或内容不同」时写。
  const subPath = path.join(dir, 'subtitle.txt');
  let fileSub = '';
  try { fileSub = fs.existsSync(subPath) ? fs.readFileSync(subPath, 'utf8') : ''; } catch (e) { fileSub = ''; }
  if (proj.subtitle && proj.subtitle !== fileSub) fs.writeFileSync(subPath, proj.subtitle, 'utf8');
  const hasContent = !!(proj.content && (proj.content.style || (proj.content.scenes || []).length));
  if (hasContent && !fs.existsSync(contentFilePath(proj.name))) writeContent(proj.name, proj.content);
  // 只写索引：正文（字幕 / 内容脚本）在各自文件里，这里剥掉——否则老项目的内联字段会一直留着，
  // 而且 project.json 会随内容变大（它被 scanProjects 对**每个项目**解析，不能塞正文）。
  const { subtitle, content, ...index } = proj;
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(index, null, 2), 'utf8');
  return proj;
}
```

逐条语义：

1. **目录 + 时间戳**：`mkdirSync(recursive)` 后**先把 `proj.updatedAt` 刷成当前 ISO 时间**——写入的索引里带的就是这个新值（`writeProject` 会就地改传入对象）。
2. **字幕**：先读盘上 `subtitle.txt` 得 `fileSub`（读不到当 `''`），**只有 `proj.subtitle` 非空且与盘上不同才写**。这条「不同才写」既避免无谓 mtime 抖动，也保证不会用空字幕把文件清空。
3. **内容脚本**：`hasContent` 只看 `style` 非空或 `scenes` 非空；**且只在 `content.json` 不存在时**才 `writeContent`。即：老项目第一次任意保存会把内联脚本落成文件，之后不再重复覆盖（`project:save-content` 走的是显式的 `writeContent`，见 5.5）。
4. **索引**：`const { subtitle, content, ...index } = proj` 把两个正文字段剥掉，写 `JSON.stringify(index, null, 2)`。**只剥这两个字段**——`videoMaterial` / `ttsAudio` 这类历史字段若老索引里本来有，会被原样写回（源码不再新写它们）。
5. **返回 `proj`**（仍是完整 `Project`，含正文），因此 handler 可以把它原样回给渲染层。

**`ensureProject` 的拼装**：

```ts
function ensureProject(name: string): Project {
  const index = readProject(name);
  if (index) {
    // 索引 + 正文（subtitle.txt / content.json 优先，缺失回退内联旧字段）= 完整 Project。
    // 老项目里的内联 subtitle / content 只当回退来源，下一次 writeProject 就会把它们从索引里剥掉。
    const { subtitle: legacySub, content: legacyContent, ...rest } = index;
    return {
      ...rest,
      name,
      subtitle: readSubtitle(name, legacySub),
      content: readContent(name, legacyContent)
    };
  }
  return {
    name,
    title: '字幕动画',
    subtitle: '',
    htmlPath: '',
    videoPath: '',
    materials: [],
    audioFile: '',
    content: { style: '', scenes: [] },
    createdAt: new Date().toISOString()
  };
}
```

注意两点：① `name` 用**入参**覆盖索引里的值（索引被手改过也不会串项目）；② 默认分支**不带** `subtitleCount` / `updatedAt`，所以新项目 `project.json` 里这两个字段可能缺席——`scanProjects` 都按 `|| 0` / `|| ''` 兜。

**老项目免批量迁移（读时兼容 / 写时迁走）**：

| 时机 | 发生什么 |
| --- | --- |
| 读（`project:load` / `project:list` / 任何 `ensureProject`） | 索引里的内联 `subtitle` / `content` 当**回退来源**（字幕内联优先、脚本文件优先）；`hasSubtitle` 三路判定，字幕只存在于内联也算「有字幕」 |
| 写（任意一次 `writeProject`） | 先把正文落盘（字幕「内容不同才写」、脚本「`content.json` 不存在才写」），再把 `subtitle` / `content` 从索引里剥掉 ⇒ **下一次读就只剩文件** |
| 不用做的事 | 没有迁移脚本、没有批量改写：`project.json` 的布局对**读**是向后兼容的，对**写**是自动收敛的 |

**`scanProjects` 的 `hasSubtitle` 为什么是三路**（源码注释逐字）：

```ts
// 字幕正文已不在索引里：判「有没有字幕」看 subtitleCount（老项目与 SaveSubtitle 都会写），
// 再兜底看内联旧字段与 subtitle.txt（内联优先的那份可能还没来得及迁移到文件）。
const hasSubtitle = (p.subtitleCount || 0) > 0 || !!p.subtitle
  || fs.existsSync(projectFilePath(d.name, 'subtitle.txt'));
```

### 3.10 「全局视觉风格」块（`buildStyleBlock`）

**在页面上**：用户在**「HTML生成」页 · 全局视觉风格 输入框**（区块标题「全局视觉风格（整片视觉基调）」，在生成这一侧、紧挨「画布」那一行）填的内容就是这块的数据来源，落盘为项目 `content.json` 的 `style` 字段；本函数负责把它变成提示词里的【全局视觉风格】块。

**为什么单独一块**（源码注释给出的根因）：`buildContentBlock()` 在「没有画面分镜（`visual`）非空」的场景时**直接 `return ''`**——没写内容脚本的项目，用户在「HTML生成」页 · 全局视觉风格 输入框里填的风格**一个字都进不了提示词**（「填了看着没反应」的真实现象）。风格是整片级前提、与有没有场景无关，因此单独成块、**无条件返回**。

**两条分支**（`content` 缺失、或 `style` 非字符串时按 `''` 处理，非空值先 `trim()`；返回值以换行开头）：

| `content.style` | 产出的块 |
| --- | --- |
| 非空 | `【全局视觉风格】本项目整片的视觉基调（用户指定，页面配色、质感与氛围以此为准）：<用户填的内容>` |
| 空 / 缺失 | `【全局视觉风格】用户未指定，按需求描述与内容脚本自行拟定（不要套用固定的配色模板）。` |

源码逐字：

```ts
function buildStyleBlock(content: ContentScript | undefined): string {
  const style = content && typeof content.style === 'string' ? content.style.trim() : '';
  return style
    ? '\n【全局视觉风格】本项目整片的视觉基调（用户指定，页面配色、质感与氛围以此为准）：' + style
    : '\n【全局视觉风格】用户未指定，按需求描述与内容脚本自行拟定（不要套用固定的配色模板）。';
}
```

**配套的另一半在 `agent/html.ts`**：HTML 系统提示词里**不再写死任何风格**（原第 3 条「深空科技 / Cyber UI」已删，见 [agent.md](./agent.md) 的 §2 `HTML_AGENT_SYSTEM` 行与 §5.3），因此本块是模型唯一的风格来源；用户没填时由它明确说「未指定、自行拟定」，避免模型又滑回固定配色。

**用户可见的行为变化**：以前靠系统提示词兜底出深色科技风的项目，若「全局视觉风格」为空，页面**不再被强制成深空科技**，改为模型按需求描述与内容脚本自行拟配色。生成与修改两条链路共用本块（都由 `buildMaterialPrompt()` 装配）。

### 3.11 章节化编排（调用 `chapters.ts` 的纯逻辑）

章节模式的解析 / 校验 / 落盘 / 骨架全部下沉到 [chapters.ts](./chapters.ts.md)（纯逻辑、不 import 本文件、不调用模型），本文件只负责「拼提示词 → 调模型 → 推进度 → 按分支落盘」：

| 助手 | 作用 |
| --- | --- |
| `progressSender(...)` / `pushStatus(...)` | 生成链路的进度推送封装（文案前缀：「第 k/N 章」；`castIndex` / `castTotal` 的「角色 k/M」机制仍在，但**本轮起生成链路不再有角色阶段**） |
| `validSceneList(...)` | 取本次有效场景（章节场景覆盖校验的基准） |
| `projectCanvas(...)` | 取项目画布 |
| `buildPlanPrompt(...)` | 拼结构规划提示词（只输出 JSON，判 single / chapters）。**规划不再产角色**：提示词里没有角色表规则，`Project.cast` 也不交给它 |
| `subtitleWindowText(...)` | 拼「字幕窗口」文本 |
| `buildChapterPrompt(...)` | 拼单章 JS 提示词。**角色段改成「已注入页面」口径**：【项目角色】只列 `cast.selectedMembers(proj.cast)`，并写明「页面上已经就位 N 个角色（骨架已引入它们的 `cast/*.js`），**必须用它们画、不许在本章里重画**」+ 调用方式 `window.__cast["<第一个 id>"](x, y, u, { ctx })`；一个都没勾时写「本项目没有勾选任何角色（不要调用 `window.__cast`）」 |
| `buildCastPrompt(...)` | 拼单个角色的绘制提示词（「新建角色」用）——【角色文件】= `cast/<id>.js`（文件块里的路径必须与这一行完全一致）、【角色设定】= 用户填的外形描述、【身高】= 「高 Nu」、【全片角色表】= `castOutlineText([...旧角色, 新角色])`（要求画面上一眼分得清谁是谁），业务参数由 `chatWithCast` 写死 |
| `writeSingleHtml(...)` | single 分支的整份 HTML 落盘：本地化随包引用 → **`applyCastToHtml()` 注入 `core.js` + 被勾选角色** → 写 `index.html` → `writeProject` → 补音轨。**角色不跟着清**：切回单文件只 `chapters.removeChapterFiles()` 清 `pages/` 与 `proj.chapters`，`Project.cast` 与 `cast/` 原样保留（角色是项目素材） |
| `writeChapterSkeleton(...)` | 章节骨架落盘：`fs.mkdirSync(dir)` 之后、`chapters.buildSkeleton()` 之前调 `syncCoreLib(dir)`——骨架里的 `<script src="./core.js">` 必须指向一个真实存在的文件（按版本覆盖，幂等，所以每次写骨架都调没有代价） |
| `writeChapterSkeleton(name, proj, list, castList)` | 写应用生成的 `index.html`（`chapters.buildSkeleton({ chapters, canvas, total, cast })`，**`cast` 就是「谁参与」**）并**同时写 `proj.cast = castList`** |
| `generateByChapters(...)` | **逐章 N 次 → 全部成功才落盘**：循环里 `buildChapterPrompt` + `chatWithChapter` + `chapters.validateChapterCode`；结束后 `writeChapterFiles` 落盘并清孤儿，再写骨架。**不再有角色阶段**（上一版的「先 M 次角色 → 再 N 次章节」已删除），`castList` 由调用方用 `cast.selectedMembers(proj.cast)` 传进来 |
| `applyChapterEdit(...)` | 章节模式的「按需求修改」：**两段式**——先 `chatWithRoute` 让模型报要改的几份文件（`editRoute.parseRouteReply`，失败即回退成发全部源码），再只带那几份源码（`<<<CURRENT 路径>>>`）连同大纲定向编辑。**角色表不解析**：`nextCast = curCast`（角色是项目素材）；回复里出现的 `cast/<id>.js` 文件块只允许改**已有**角色，返回别的 id 直接失败（「角色只能在「项目素材 · 角色」里新建或从全局库导入，不能靠改稿生成」） |

规则全部落在 `chapters.ts` / `cast.ts`：章节目录 `pages`、路径白名单 `pages/cNN.js`、单章 ≤180 秒、场景连续升序且**不重不漏覆盖全部有效场景**、代码禁 `repeat: -1` / `repeat: Infinity`、必须登记 `window.__chapters[id] = { build(...) }`；角色目录 `cast`、路径白名单 `cast/<id>.js`、id 必须是 slug 且不重复、≤12 个、`units` 缺省 8 限 1–30、`selected` 缺省参与、角色代码必须挂 `window.__cast` 且含函数、不许出现 HTML 标签、≤1200 行。写盘用 `writeChapterFiles` / `cast.writeCastFiles`（各自删掉清单外的孤儿文件）；切回单文件模式（`Project.chapters` 清空）时用 `removeChapterFiles(dir)` 清空 `pages/`，**`cast/` 不清**（角色是项目素材，`cast.removeCastFiles` 因此当前没有调用方）；骨架引哪些角色脚本只由 `cast.selectedMembers(proj.cast)` 决定，与各章 `ProjectChapter.cast` 无关。

## 4. IPC 频道一览

`register()` 共注册 **31 个 `ipcMain.handle` 频道**（素材库那次 3 个下线 + 3 个新增、当时总数不变；更早一轮新增 `project:set-canvas` 一条；上一轮新增 4 个角色库 handler；**本轮再新增 `project:new-cast` 与 `project:save-cast` 两条**），并额外使用 1 个主→渲染推送频道（`project:html-progress`）。**全库频道总数现在是 100 个**（本轮从 **98 → 100**：`Project` 组 30 → 32、分组数仍是 11、preload 命名空间仍是 12 个）。返回统一为 `{ ok, ... }` 结构。下表的「参数载荷」列在括号内给出源码中的标注类型（均来自 `src/shared/types.ts`），handler 形参一律写作 `payload?: <类型>`。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
| --- | --- | --- | --- |
| `project:list` | 无 | `scanProjects()` 数组 | 列出「我的项目」，按 `updatedAt` 倒序。**只解析索引**（不含正文，见 2.7）；`hasSubtitle` 三路判定见 3.9 |
| `project:create` | `name?: string`（裸字符串） | `{ ok, project }` / `{ ok:false, message }` | 空名、含 `\ / : * ? " < > \|`、同名已存在（`readProject(n)` 命中，读的是索引）均拒绝；通过则 `ensureProject(n)` + `writeProject(proj)`（**落盘的是索引 + 正文文件**） |
| `project:load` | `name?: string`（裸字符串） | `Project` \| `null` | 无名字返回 `null`；否则 **`ensureProject(name)`**（索引 + `subtitle.txt` / `content.json` 拼成完整 `Project`），再返回 `{ ...proj, videoPath: resolveVideoAbs(name, proj.videoPath), materials: normalizeMaterials(proj.materials) }`——素材列表按当前盘上数据规范化、`videoPath` 换算成**绝对路径**。**对外结构一个字段都没变**（仍是含 `subtitle` / `content` 的完整 `Project`），渲染层因此 0 行改动 |
| `project:save-subtitle` | `ProjectSaveSubtitlePayload`（`{ name?, subtitle?, title? }`） | `{ ok, project }` | 先 `mkdirSync` 并**直接写 `subtitle.txt`**；再 `ensureProject(name)` 取完整项目 → `proj.subtitle = subtitle`（`title` 非空才覆盖）→ `proj.subtitleCount = parseSubtitle(subtitle).length` → `writeProject(proj)`。**行为与重构前逐字不变**（正文本来就在 `subtitle.txt`），只是 `writeProject` 现在只写索引 |
| `project:save-content` | `ProjectSaveContentPayload`（`{ name?, content? }`） | `{ ok, project }` | **本轮改写入位置**：`normalizeContent(payload.content)` → `proj.content = content` → **`writeContent(name, content)` 写 `content.json`** → `writeProject(proj)`（只更新索引里的 `updatedAt` 等）。注释原文：「整体保存内容脚本（style + scenes）到当前项目：正文写 content.json，project.json 只更新时间戳」 |
| `project:generate-html` | `ProjectAgentPayload`（`{ name, prompt, subtitleProject?, materialIds? }`） | `{ ok, htmlPath, compatible, message }`；失败 `{ ok:false, message, needConfig?, title? }` | 解析素材（字幕 / 勾选素材）→ 装配提示词（**不传 `forModify`**，【画布】块只有 ①–④）→ `chatWithCustomModel` → `extractHtmlFromReply` → `hfEnv.localizeVendorHtml` 本地化 → `ensureVendorFiles(dir, html)`，**返回 `false`（库缺失 / 复制失败）则 `externalizeVendorHtml` 退回 CDN** → 写 `index.html` → **`applyBgmToHtml` 补注入音轨**；置空 `videoPath`。**本轮改为先规划再分支**：先调 `chatWithChapterPlan` 做结构规划，判 `single` 时走上面这条原路径；判 `chapters` 时逐章生成（`pages/cNN.js`）+ 写 `index.html` 骨架，**全部章节成功才落盘**（见 3.11 / 5.2） |
| `project:modify-html` | 同 `project:generate-html`（同一 `ProjectAgentPayload`） | `{ ok, htmlPath, compatible, message }`；失败 `{ ok:false, message, needConfig?, title? }` | 需已有 `index.html`；把当前源码作为 `extra` 前置，装配提示词时**显式传 `forModify = true`**（【画布】块因此多带第 ⑤ 条：旧版式与新画布不一致必须重排，见 4.2），Agent 输出完整新 HTML 后**同样先本地化（`localizeVendorHtml`）、再按 `ensureVendorFiles` 的返回值决定是否 `externalizeVendorHtml` 退回 CDN**，覆盖写盘后**再 `applyBgmToHtml` 补回音轨**（模型重写时可能整段丢掉注入标签）。**章节模式下改发「大纲 + 全部章节源码 + 需求」**，由模型自报改哪一章；改结构要先交完整新 PLAN（见 3.11 / 5.3） |
| `project:download-html` | `name?: string`（裸字符串） | `{ ok, savedPath }` / `{ ok:false, canceled:true }` | 「另存为」导出项目 `index.html`（默认文件名 `<name>.html`）：读原文 → `hfEnv.externalizeVendorHtml` 把 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 换回各自登记的固定版本 CDN → **文本写出**（不再 `copyFileSync`），理由见 5.9；**章节模式下先 `syncCoreLib(dir)` 同步一次、再 `inlineChapters()` 把 `pages/cNN.js`、`cast/<id>.js` 与 `core.js` 一起内联进单文件**（导出物旁边不会有这几个文件；`core.js` 是**内联**而不是换回 CDN，因为它没有 CDN 形态） |
| `project:export-srt` | `ProjectExportSrtPayload`（`{ name?, srt? }`） | `{ ok, savedPath }` | 内容为空则拒绝；否则写 `.srt` 文件（utf8） |
| `project:open-folder` | `name?: string`（裸字符串） | `{ ok, message }` | `await shell.openPath(projectDir)`；目录不存在提示「项目目录不存在（项目尚未保存）」 |
| `project:open-folder-of` | `p?: string`（裸字符串） | `{ ok, dir }` | 入参可以是文件或目录：是文件则取其所在目录；目录存在才 `shell.openPath`。源码注释：「打开指定文件所在目录 / 指定目录（配音、对齐、音色等页面的「打开目录」入口）」 |
| `project:delete` | `name?: string`（裸字符串） | `{ ok }` / `{ ok:false, message }` | 仅允许删除 `projectsRoot()` 下的目录（`dir.startsWith(projectsRoot())` 校验），`rmSync(..., { recursive: true, force: true })` |
| `project:save-video` | `ProjectSetVideoPayload`（`{ name?, videoPath? }`；该类型**现在只服务本频道的产物回写**） | `{ ok, project }` | 视频渲染完成后回写产物路径（点亮链路「视频」节点）：**项目目录内的路径换算成项目内相对路径 `video/output.mp4` 存入，目录外的原样存**（见 5.6） |
| `project:set-render` | `ProjectSetRenderPayload`（`{ name?, render?: RenderOverride \| null }`） | `{ ok, project }` | 写 / 清除**项目级渲染档位覆盖**：`render` 传 `null`（或字段全非法）即删除 `proj.render`，回到跟随 `settings.json` 的全局默认 |
| `project:set-canvas` | `ProjectSetCanvasPayload`（`{ name?, canvas?: RenderCanvas }`） | `{ ok, project }` | **写成片画布方向**：它是**项目属性、不是渲染档位**（不进 `settings.json`、没有全局默认那一层）。缺 `name` → `缺少项目名`；`RENDER_CANVASES.indexOf(canvas) < 0` → `画布取值非法`；**值变化时**写 `proj.canvas` 并把已有的 `proj.videoPath` 置空（尺寸变了，旧成片不再代表当前产物），再 `writeProject(proj)`。画布一变，**已生成的 HTML 版式不会自动重排**——界面提示用户重新「生成 HTML」/「按需求修改」，而修改路径的提示词会硬性要求模型重排（第 ⑤ 条，见 4.2 与 5.13） |
| `project:pick-audio` | 无 | 绝对路径 \| `null` | 打开文件选择框（`mp3/wav/m4a/aac/ogg/flac/mp4`），取消返回 `null` |
| `project:set-audio` | `ProjectSetAudioPayload`（`{ name?, audioPath? }`） | `{ ok, audioFile, htmlUpdated }` | 校验文件存在 → 复制进 `audio/` → 写入 `proj.audioFile` → `applyBgmToHtml` 立即重写 HTML 音轨；`htmlUpdated` = 是否真的改写了 `index.html` |
| `project:clear-audio` | `ProjectNamePayload`（`{ name: string }`） | `{ ok, htmlUpdated }` | 仅清空 `proj.audioFile` 引用（保留音频文件，避免误删），并由 `applyBgmToHtml` 把 HTML 里注入的 `<audio>` 一并摘掉（否则成片仍有声、与项目状态不符） |
| `project:pick-media` | `ProjectPickMediaPayload`（`{ kind?: ProjectMaterialKind }`） | `string[]`（绝对路径列表；取消 / 无窗口 → `[]`） | **按 kind 给不同过滤器**：`kind === 'image'` 用 `IMAGE_MATERIAL_EXTS` + `properties: ['openFile', 'multiSelections']`（一屏素材一次加完）、否则 `VIDEO_MATERIAL_EXTS` + `['openFile']`（单文件常很大）；标题分别为「选择图片素材（将复制进项目，作为页面素材嵌入 HTML）」/「选择视频素材（…）」 |
| `project:add-materials` | `ProjectAddMaterialsPayload`（`{ name?, paths? }`） | `{ ok, materials, message? }` / `{ ok:false, message }` | 复制入库 + 登记（见 5.12）；超限 / 格式不支持则跳过并如实回报跳过数 |
| `project:save-materials` | `ProjectSaveMaterialsPayload`（`{ name?, materials? }`） | `{ ok, materials }` / `{ ok:false, message }` | **整份素材列表回写**（移除与勾选共用）：`proj.materials = normalizeMaterials(payload.materials)` 后落盘 |
| `project:extract-video-audio` | `name?: string`（裸字符串） | 成功 `{ ok, audioFile, htmlUpdated }`；**缺 ffmpeg 运行环境包时 `{ ok: false, needPacks: ['ffmpeg'], message }`** | **handler 一行未改、当前界面入口已下线**（见 3.6 末与 5.6 末）：先按 `FFMPEG_PACKS = ['ffmpeg']` 做缺包纯校验（不下载、不阻塞），通过后用 ffmpeg 从**历史字段 `proj.videoMaterial`** 提取音轨为 `audio/<同名>.m4a`（AAC 192k）并设为背景音频，随后 `applyBgmToHtml` 立即注入 HTML |
| `project:read-html` | `name?: string`（裸字符串） | `{ ok, html }` | 读取当前 `index.html` 源码供编辑器载入 |
| `project:preview-html` | `name?: string`（裸字符串） | `{ ok, previewPath, pageCanvas }` | 生成去掉 CSP、**对副本做随包前端库本地化**、注入 `HG_PREVIEW_CTRL` 的 `index.preview.html` 副本；注入片段落位复用的是音轨注入同一助手 `insertHtmlSnippet()`。**本轮新增一步**：副本里若还能匹配到 `<script src="./core.js">`（正则 `/src=["'](?:\.\/)?core\.js["']/i`），就先 `syncCoreLib(path.dirname(htmlPath))` 按版本同步共享绘制助手——否则「应用升级后旧项目预览仍是老助手、渲染却是新助手」，两边画面不一致。**另外在去 CSP / 本地化之前**，用正则 `/<html[^>]*\sdata-resolution\s*=\s*["']([^"']*)["']/i` 从**原 HTML** 取页面自己声明的画布，经 `RENDER_CANVASES` 白名单校验后作为 `pageCanvas` 返回（缺失 / 非法 = `''`）——渲染层据此把预览 iframe 设成「页面原生尺寸」，见 5.4 |
| `project:save-html` | `ProjectSaveHtmlPayload`（`{ name?, html? }`） | `{ ok, htmlPath, compatible }`（**未新增 `htmlUpdated`**） | 先 `hfEnv.localizeVendorHtml` 改写 CDN 引用（**合规校验也用改写后的 `localHtml`**），再 `ensureVendorFiles(dir, localHtml)`、**返回 `false` 则 `externalizeVendorHtml` 退回 CDN**，然后覆盖保存编辑器中的 HTML；置空 `videoPath` 表示旧视频失效；随后调 `applyBgmToHtml` 把音轨补回（手改 / 粘贴进来的 HTML 可能没有音轨）。该频道目前在渲染层**没有调用方**（预留接口） |
| `project:cast-library` | 无 | `{ ok, members }`（`CastLibraryResult`）/ `{ ok:false, message }` | **本轮新增**：列全局角色库。`castLibraryRoot()` 取 `<userData>/cast-library`，`castLibrary.readLibrary(root)` 读索引（文件缺失当空库、损坏才回 `error`），再把每条映射成 `{ ...m, missing: !libraryFileExists(root, m.id) }`——**「索引有、文件不在」的条目标成 `missing` 一起回给界面**（界面压暗不可选），不静默消失 |
| `project:promote-cast` | `{ name?: string; id?: string }`（就地内联） | `{ ok, message }` | **本轮新增**：把项目里的某个角色**存为全局**。缺参数回 `缺少项目名或角色 id`；在 `proj.cast` 里找不到回 `项目里没有这个角色：…`；否则 `castLibrary.promoteFromProject(root, projectDir(name), member)`——复制 `cast/<id>.js` 进库、更新索引（**同 id 覆盖**）。**全程不调模型** |
| `project:import-cast` | `{ name?: string; ids?: string[] }`（就地内联） | `{ ok, message, cast }`（`ProjectCastResult`）/ `{ ok:false, message }` | **本轮新增**：把选中的全局角色**导入本项目**。`castLibrary.importToProject(root, projectDir(name), ids, proj.cast \|\| [])` —— **复制**进 `<项目>/cast/` 并合并进 `Project.cast`；成功后 `proj.cast = r.cast`，**章节模式下随即 `writeChapterSkeleton(...)` 重写骨架**（新角色要按需引入，否则章节调 `window.__cast` 会是 undefined），单文件模式只 `writeProject(proj)`。回带 `cast` 让界面原地刷新，不必整份重载项目 |
| `project:remove-cast-from-library` | `{ id?: string }`（就地内联） | `{ ok, message }` | **全局角色库：从库删一个角色**。载荷**只有 `{ id }`**（库是应用级资产，不需要项目名）；`castLibrary.removeFromLibrary(root, id)` 只删库里那份 + 更新索引，**不动任何已导入它的项目** |
| `project:new-cast` | `ProjectNewCastPayload`（`{ name?, title?, desc?, units?, watercolor? }`） | `{ ok, member, cast }`（`ProjectNewCastResult`）/ `{ ok:false, message, needConfig?, title? }` | **本轮新增：「新建角色」**——手动建一个角色，**与「生成 HTML」完全无关**。`title` / `desc` 至少要有一个（都没有回「请至少填角色名或一句描述」）；id 用 slug（取标题里的英数、取不到就 `cast<N>`，已存在则报「已经有同名角色」）；`units` 缺省 8、上限 30；`watercolor === true` ⇒ `uses: ['p5','p5.brush']`；`selected: true`。随后 `buildCastPrompt` → `chatWithCast`（**一次模型调用**）→ `cast.parseCastFiles` / `cast.validateCastCode` → `cast.writeCastFiles` → `proj.cast = nextCast` → `refreshCastInPage()`。失败不落盘 |
| `project:save-cast` | `ProjectSaveCastPayload`（`{ name?, cast? }`） | `{ ok, cast }`（`ProjectCastResult`）/ `{ ok:false, message }` | **本轮新增：整份角色表回写**（勾选 / 移除 / 改名共用，与 `project:save-materials` **同语义**）：`cast.normalizeCastList(payload.cast)` 规范化（含 `selected`），**先删掉清单里没有的角色的 `cast/<id>.js`**（只删文件、不改已有角色的代码），再 `proj.cast = n.cast` → `refreshCastInPage()`（勾掉的角色要从骨架 / 注入里消失） |
| `project:html-progress` | 主→渲染推送：`Object.assign({}, info, { text })` | — | 生成/修改过程中由 `event.sender.send` 推送 Agent 进度（`sender.isDestroyed()` 时不发送） |

**更早一轮「数据层重构」不变的部分**（历史记录，别拿它当本轮的口径）：那一轮频道名、载荷类型、preload 方法、返回结构全部保持原样（`project:load` 仍是完整 `Project`，`project:save-content` 仍返回 `{ ok, project }`），所以当轮渲染层 `src/renderer/**` **0 行改动**。

**本轮（角色 = 项目素材）渲染层同样有改动**：「HTML生成」页 ·「项目素材」区 · 「角色」块的 `CastSection.vue` 从 159 行涨到 **262 行**——常显（0 个也显示）、每行多一个**勾选框**（`selected`）+ 三个动作（存为全局 / 改这个角色 / 移除）、标题右侧两个动作（从全局库添加 / **新建角色**）、两个弹窗（全局库勾选导入、新建角色表单，后者填 角色名 / 外形描述 / 高几 u / 是否用水彩）；位置也变了——在 `index.vue` 里**紧跟 `MaterialsSection`（素材区）**、章节块 `ChapterSection` 在其后。此外 `main.css` 的 `.cast-row` 加了勾选列与 `.off`（`24px` + `minmax(0,1.2fr) minmax(0,2.6fr) 48px minmax(0,1.3fr) auto`），`shared/types.ts` 新增 `ProjectCastMember.selected?` 与 `ProjectNewCastPayload` / `ProjectNewCastResult` / `ProjectSaveCastPayload`。

**更早一轮下线的三个频道**（handler 与 `shared/ipc.ts` 的常量一并删除）：`project:pick-video`、`project:set-video`、`project:clear-video`。它们原先的唯一调用方是「HTML生成」页的「视频素材」下拉行——该行已被 `MaterialsSection.vue` 的素材卡片墙取代。

### 4.1 提示词里的【成片时长】要求（`buildMaterialPrompt` 的新增条目）

`buildMaterialPrompt()` 在【音轨】那条之后**新增一条**（生成与修改共用，因为两个频道都走同一个装配函数）：

| 条目 | 文案要点 |
| --- | --- |
| 【成片时长】 | 必须把**动画结束时间**写在根元素上：`<html data-composition-duration="<秒数>">`（可带小数，如 `45.6`）。**这个值要等于你写的时间轴总长度（最后一条 `tl.to` 的位置 + 它的 `duration`，取最大），不是素材时长**。漏写的话渲染器会拿最长素材当片长，成片尾部会出现大段静止画面 |

**提示词为什么仍然要模型写 `<html data-composition-duration>`**：那是**应用读取模型声明的唯一入口**——`video.ts` 的 `declaredDuration()` 用正则从 `<html …>` 上取这个属性（见 [video.ts.md](./video.ts.md) §1.1）。**但 CLI 渲染链路不读它**：`compileForRender` 只读舞台元素的 `data-duration`（cli.js 第 **126320** 行），`rootEl` = 文档里第一个带 `data-composition-id` 的元素，而 `<html>` 既没有这个属性、也不是那个元素。旧文档以为 CLI 会在编译阶段直接读 `<html>` 上这个属性——**那是错的**，已按 cli.js 删除该说法。**真正生效靠 `video.ts`**：`prepareEntry()` 裁定出 `target` 后，用 `applyStageDuration()` 把同一个值写到舞台元素的 `data-duration`（先剥掉该元素上已有的 `data-duration` / `data-composition-duration`，避免同名两个），另外再写一份 `<html data-composition-duration>` 只作页面自描述（预览 / `info` / 下次生成读它，CLI 不读）。

源码注释给出的动机（实测数据）：**不给这个数，渲染器只能取「页面里最长媒体」当片长——素材常比动画长得多**（动画 45 秒 + 素材原声 225 秒 ⇒ 成片 3 分 45 秒、后 3 分钟全是黑帧）。声明经应用写到舞台上之后，成片就与声明等长；**写错 / 漏写时应用会自己量一次时间轴兜底**（`video.ts` 的 `prepareEntry()`，见 [video.ts.md](./video.ts.md) §4）。

> 与 `video.ts` 的配合是「声明 → 实测 → 最长媒体」三级兜底：模型写了就用声明（零成本），没写就由主进程用无头 Chromium 现场量 GSAP 时间轴，两者都拿不到才交给 CLI 按最长媒体裁定。**但声明只能把成片拉长、拉不短**（规则是 `max(声明, 最长媒体)`），所以主进程还会按裁定值把超长媒体**裁成副本**再渲染——两件事合起来成片时长才真被顶住。**本轮口径变化（用户可见）**：声明写进舞台 `data-duration` 后真的生效——声明比时间轴长会把片子拉长到声明值、比时间轴短会按时长截断（裁超长媒体副本仍按同一个 `target`，未变）。

### 4.2 提示词里的【画布】块（`buildCanvasBlock(proj, forModify = false)`）

`buildMaterialPrompt()` 在**【音轨】与【成片时长】之间**插入了 `buildCanvasBlock(proj, forModify)` 的产物。产出的那段文案是（**①–④ 生成与修改都有**）：

> 【画布】成片画布固定为 `<CANVAS_LABELS[canvas]>`（`<width>×<height>` 像素），渲染视口就等于这块画布。必须：① 在 `<html>` 标签上写死 `data-resolution="<canvas>"`；② 页面主舞台（承载全部内容的那层容器）尺寸严格等于 `<width>×<height>`，写固定 px，不要用 vw / vh / 百分比自适应，也不要用 `transform: scale` 去缩放舞台；③ 内容排满整块画布（该铺满的铺满、该居中的居中），四周不要留大片空白；④ 所有元素的坐标、字号、间距都按这块画布设计。

**第 ⑤ 条只在修改路径追加**（`forModify === true`），条文原文（源码里是三行字符串拼接，此处合成一段）：

> ⑤ 若当前页面的 `<html data-resolution>` 或主舞台尺寸与本画布**不一致**（典型情形：页面原来按横屏 1920×1080 排过版，而画布后来被改成了方形 / 竖屏），必须**重新排布**：把主舞台改成上面的尺寸，并按新画布重算所有元素的位置、字号与间距，让内容排满整块画布；**不要**用 transform: scale、居中留白或黑边把旧版式硬套进新画布。

源码注释给出的「为什么只给修改」（参数含义逐字）：**`forModify`：修改场景追加第 ⑤ 条——换过画布的旧页面必须重排，而不是把旧版式硬塞进新画布**；以及「⑤ 只在修改时给：换画布不会自动重排已有页面（`project.canvas` 变了、页面舞台还是旧的），于是渲染视口变成新画布后四周留黑边、内容还会被裁——只能让模型按新画布重排一次」。**生成路径是从零做一版**、页面本来就按当前画布排，因此不追加；第 ①–④ 条与原有措辞**一字未改**。

源码注释给出的动机：画布是**渲染时的实际视口尺寸**（HyperFrames composition 尺寸 = 成片尺寸），模型若按自己习惯的 `1600x900` 之类固定尺寸画，画布一变四周就会留大片黑边（本项目实测故障）；缺省画布 = `DEFAULT_CANVAS`（`landscape`），与老项目的原始观感一致。

与 `video.ts` 的配合是「提示词负责让页面**自描述**，成片尺寸由应用在渲染入口保证」，**两道都必要但职责不同**：提示词要求模型在 `<html>` 写死 `data-resolution`、把主舞台写成该画布尺寸的固定 px，作用只是让页面**自己说清楚**按哪块画布排的版（预览 iframe 与 `hyperframes info` 读得到）——**它不决定成片宽高**。成片宽高由 `video.ts` 在渲染入口给**第一个带 `data-composition-id` 的元素**（最外层舞台）写死 `data-width` / `data-height` 来保证（`applyCanvasSize()`，与 CLI 的 `document.querySelector('[data-composition-id]')` 同口径）：CLI 0.8.33 的 `compileForRender` 只读这对属性，读不到就直接兜底 **1080×1920（竖屏）**，而 `<html data-resolution>` 在渲染链路里**一次都不读**（`parseResolutionFromHtml()` 的唯一调用点是 `info` 命令）。因此**模型漏写 / 写错 `data-resolution` 或舞台尺寸都不影响成片尺寸**——提示词那部分只影响「模型是否按正确画布排版」（排错就会出现黑边 / 裁切），分辨率本身由应用兜住。两处说法都取 `shared/constants.ts` 的 `CANVAS_LABELS` / `CANVAS_SIZES`（同源），因此「告诉模型的尺寸」与「界面选的、预览用的、渲染注入的」必然一致。

> **应用侧的另一种做法本轮没做**：让预览 / 渲染把旧页面**等比缩放、上下留黑带**（成片会永远带黑边，且必须同时改预览副本与渲染入口）属**待定事项**——渲染层与 `video.ts` 本轮一行未改，换画布后的重排完全靠上面这条提示词硬要求 + 用户重新「生成 HTML」/「按需求修改」。

## 5. 关键流程

### 5.1 新建项目（`project:create`）

1. 取 `String(name || '').trim()`，为空返回「项目名不能为空」。
2. 正则 `/[\\/:*?"<>|]/` 命中则返回「项目名含非法字符（\ / : * ? " < > |）」。
3. `readProject(n)` 命中（**读索引**）则返回「项目「n」已存在」。
4. `ensureProject(n)` 生成带 `createdAt` 的默认项目对象（含 `materials: []`）。
5. `writeProject(proj)` 递归建目录、**写 `project.json` 索引**（此时没有正文，`subtitle.txt` 只会因 `proj.subtitle` 非空而写、`content.json` 不会产生；`updatedAt` 同时刷新）。
6. 返回 `{ ok: true, project }`。

### 5.2 生成 HTML（`project:generate-html`）

1. 校验 `name` 与 `prompt.trim()`，任一为空直接失败。
2. `ensureProject(name)` 取**完整项目**（索引 + 两个正文文件——内容脚本与字幕因此都能进提示词），`resolveMaterials(proj, payload || {})` 处理字幕 / 勾选素材——**两者都只是「要不要带上」**：素材按 `materialIds` 从项目素材库取（复制入库早在 `project:add-materials` 完成），**音频不在这里解析**（音轨由 `applyBgmToHtml` 注入 HTML）。
3. `buildMaterialPrompt('用户需求：' + prompt.trim(), proj, mats, [])` 装配提示词：需求 → 内容脚本块 → **【全局视觉风格】块**（`buildStyleBlock(proj.content)`，见 3.10，无条件注入） → 字幕块 → 【音轨】声明行（固定文案：音轨由应用在渲染前自动注入 `<audio id="myv-bgm">`，请勿写入 / 修改 / 删除任何 `<audio>` 标签，也不要为音轨预留页面元素）→ **【画布】块（`buildCanvasBlock(proj, false)`，见 4.2）** → **【成片时长】声明行（见 4.1）** → `buildMaterialBlock()` 的【图片素材】/【视频素材】两段。**该调用不传第 5 个参数 ⇒ `forModify` 取默认 `false`，画布块只有 ①–④ 条**。
4. 构造 `onProgress`，把 `progressText(info)` 的结果经 `project:html-progress` 推给发起窗口。
5. `await chatWithCustomModel(userPrompt, { onProgress, meta: { project: name, action: 'generate' } })`。
6. `extractHtmlFromReply(reply)` 抽出 HTML 后交给 `hfEnv.localizeVendorHtml()`（把 CDN / `node_modules` 引用改写为 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js`；随包文件缺失的库整条跳过、退化为在线加载）；`trim()` 为空返回「模型未返回内容，请检查自定义模型配置」。
7. **随包库落位 + 兜底**：`if (!hfEnv.ensureVendorFiles(dir, html)) html = hfEnv.externalizeVendorHtml(html);` —— 先把页面引用到的随包文件复制进项目目录（幂等，只复制引用到的）；返回 `false`（有库缺失 / 复制失败）就把引用换回 CDN，避免引用一个不存在的文件；页面没引用任何库时返回 `true`、什么也不做。随后写 `projectDir(name)/index.html`（utf8），置 `proj.htmlPath = htmlPath` 绝对路径。
8. **`proj.videoPath = ''`**：HTML 刷新后旧视频失效，避免链路误显示成品。
9. `writeProject(proj)` 落盘（**只写索引**，正文不在这一步变动），**再调 `applyBgmToHtml(name, proj)` 按当前背景音频补注入音轨**（模型侧已明确不写 `<audio>`），然后 `isHyperframesComposition(html)` 做合规校验。
10. 返回 `{ ok: true, htmlPath, compatible, message }`；不合规时提示缺 `data-composition-id / __timelines / gsap`，预览可用但转视频前需调整。
11. 异常统一捕获：先拼 `const msg = 'Agent 调用失败：' + 错误信息`，再 `return { ok: false, message: msg, ...configTargetOf(msg) }`——`chatWithCustomModel` 抛出的已经是人话文案，这里只用 `shared/errors` 的 `configTargetOf()` 复用同一张码表**补一次配置类分类**（可能多出 `needConfig` / `title`；非配置类返回 `{}`，展开后等于什么都没加）。`project:modify-html` 的 `catch` 写法完全相同。

**章节分支（本轮口径：角色不在生成链路里）**：进入生成之前先做一次结构规划（`buildPlanPrompt` + `chatWithChapterPlan`，输出只有 `mode` + `chapters`）——`mode === 'single'` 时后续步骤原样执行（拼提示词 → 调模型 → 本地化 → **注入角色** → 写盘 → 补音轨）；`mode === 'chapters'` 时 `castList = cast.selectedMembers(proj.cast)`（**规划不产角色，也不再解析角色表**），然后改走 `generateByChapters(...)`：**逐章 N 次**（`buildChapterPrompt` + `chatWithChapter`，`chapters.validateChapterCode` 逐章校验、`writeChapterFiles` 落盘并清孤儿）→ `writeChapterSkeleton(name, proj, list, castList)` 写 `index.html` 并写 `proj.cast`，**全部成功才写项目**。进度文案：「第 k/N 章」（`chapterIndex` / `chapterTotal`）。

**单文件分支同样带角色（本轮新增）**：`selected = cast.selectedMembers(proj.cast)` 非空时，用户提示词后面追加两段——【项目角色】「下面这些角色**已经注入页面**（`window.__cast` 里就有），必须用它们画、不许重画」+ `cast.castOutlineText(selected)` + 调用方式（`(x, y)` 是脚底中点、`u` 是 1 个单位的像素数、请建一张 canvas 挂在舞台容器内把 2D 上下文当 `ctx` 传进去）+「角色没列出的不要调用」；紧跟其后的**【分层要求】**则把「角色画在独立的透明 canvas 上」写死：

> 【分层要求】角色画在**独立的透明 canvas** 上（铺满舞台、叠在 `<video>` / `<img>` / DOM 之上），可以直接用助手建层：`var layer = MC.castLayer(stage, 宽, 高)`；每帧先 `MC.clearLayer(layer.ctx)` 再画角色。

落盘时由 `writeSingleHtml` → `applyCastToHtml()` 把 `core.js` 与被勾选角色的 script **整组注入模型写的 `index.html`**（插在第一个 `<script>` 之前；没勾任何角色时只剥掉旧注入、不塞 `core.js`）。

### 5.3 修改 HTML（`project:modify-html`）

1. 校验 `name` 与需求描述。
2. `projectFilePath(name, 'index.html')` 不存在则返回「该项目还没有 HTML，请先生成」。
3. 读取当前源码 `curHtml`，`ensureProject(name)` 后 `resolveMaterials(proj, payload || {})` 重新解析素材（字幕 / 勾选素材，可在改造时换素材）。
4. 提示词把 `['当前项目的 index.html 源码如下：', '```html', curHtml, '```', '']` 作为 `extra` 置于最前，再附需求「在此基础上改造后输出完整新 HTML」；**该调用显式传第 5 个参数 `true`（`forModify = true`）**，调用处源码注释逐字：「forModify=true：画布块多带一条『旧页面版式与新画布不一致就必须重排』的硬要求」——因此修改路径的【画布】块比生成路径多一条第 ⑤ 条（见 4.2）。
5. 调用 Agent（`meta.action = 'modify'`），同样支持 `project:html-progress` 进度推送。
6. 抽取 HTML 并先经 `hfEnv.localizeVendorHtml()` 本地化、再走同一套兜底（`if (!hfEnv.ensureVendorFiles(projDir, html)) html = hfEnv.externalizeVendorHtml(html);`）；随后**覆盖** `index.html`，更新 `htmlPath`、置空 `videoPath`、`writeProject`，**再调 `applyBgmToHtml(name, proj)` 补回音轨**（模型重写时可能整段丢掉注入标签），最后返回合规校验结果（`compatible` 基于最终写盘的 HTML）。

**章节分支（两段式，本轮）**：章节模式下不再把 `index.html` 整份交给模型，也不再把全部源码一次发过去——先**路由**：只发「大纲（`chapterOutlineText`）+ 角色表 + 用户需求」，让模型报这次要改哪几个文件（`<<<ROUTE>>>` 块，`editRoute.parseRouteReply` 白名单过滤 / 去重 / ≤6 个）；**路由失败自动回退成「发全部源码」**（`routed.route` 为空时 `targets = allPaths` 并把原因写进状态行），保证改稿不会因为路由猜不准而做不了。然后**定向编辑**：只读被点名的那几份源码、用 `<<<CURRENT 路径>>>` 包起来连同大纲发给模型。**角色表不解析**（`nextCast = curCast`）：它由用户在「项目素材」区勾选 / 新建，模型只可能被要求改某个**已有**角色的画法（那就只交 `cast/<id>.js` 那一个块），返回项目里没有的角色 id 会直接失败；改结构（增删章 / 改时长）要先交一份完整新 PLAN（**只有 `chapters`，没有 `cast`**）。落盘与骨架同生成路径（`chapters.ts` / `cast.ts`）。

### 5.4 预览副本 `index.preview.html` 的生成

1. `project:preview-html` 中确认 `index.html` 存在。
2. **先解析页面自己声明的画布**（在去 CSP / 随包库本地化**之前**、从原 HTML 取）：正则 `/<html[^>]*\sdata-resolution\s*=\s*["']([^"']*)["']/i` 取属性值 → `trim()` → 只有 `RENDER_CANVASES.indexOf(值) >= 0` 才认，缺失 / 非法一律 `''`；结果作为 **`pageCanvas`** 随回执返回（渲染层据此把预览 iframe 设成「页面原生尺寸」，无声明时回落项目画布）。源码注释：「渲染层要用它把预览 iframe 设成页面原生尺寸，再整体缩进当前视角里看（等比 contain + 黑边），这样横屏页面放进方形视口时右边不会被裁」。
3. 读取源码，用 `/<meta[^>]*content-security-policy[^>]*>/gi` 删除 CSP meta（**仅副本**，保证注入脚本可执行）。
4. **对副本做随包前端库本地化**：`html = hfEnv.localizeVendorHtml(html)`，再 `hfEnv.ensureVendorFiles(path.dirname(htmlPath), html)` 把引用到的库文件复制进项目目录——只改副本、不去动原件；库文件落在项目目录，因此原件里的相对引用同样成立。该处**不判断返回值**（预览只求能看，与 `video.ts` 同口径），与作者态三处的兜底不同。
5. 组装 `<script>` + `HG_PREVIEW_CTRL` + `</scr' + 'ipt'>` 注入片段，调用 `insertHtmlSnippet(html, ctrl)` 落位（**与音轨注入复用同一助手**）：优先插到 `</body>`（`lastIndexOf`）前；无 `</body>`（模型输出被截断）时插到 `</head>` 之后；连 `</head>` 也没有时插到文档最前——避免拼在文件末尾落入未闭合 `<script>` 导致整页脚本 SyntaxError。
5.5 **本轮新增：按版本同步 `./core.js`**（在随包库本地化之后、写副本之前）：`if (/src=["'](?:\.\/)?core\.js["']/i.test(html)) syncCoreLib(path.dirname(htmlPath))`。**只当页面确实引了助手才同步**——单文件模式的老项目没有这个引用，不该因此多写一份文件。为什么要同步：章节模式的页面引 `./core.js`，若应用升级后只更新了「新生成的项目」，旧项目的预览会继续用老助手、而渲染前 `video.ts` 又会同步成新助手，同一份项目「预览与成片画面不一致」。
6. `htmlPath.replace(/\.html$/i, '.preview.html')` 得到 `index.preview.html` 并写盘，返回 `{ ok: true, previewPath, pageCanvas }`。
7. 预览副本与原件**同目录**，相对素材引用仍有效（包括原件里的 `<audio id="myv-bgm">`、页面里的 `<img src="images/…">` / `<video src="video/…">`）；下载与转视频始终使用原件 `index.html`。

### 5.5 字幕保存与内容脚本保存（`project:save-subtitle` / `project:save-content`）

**`project:save-subtitle`（行为与重构前一致）**：

1. 校验 `name`，`subtitle` 非字符串时归 `''`，`title` 非字符串时归 `''`。
2. `fs.mkdirSync(projectDir(name), { recursive: true })` 并**直接写 `subtitle.txt`**（utf8）。
3. `ensureProject(name)` 取完整项目（此时 `readSubtitle` 读到的正是刚写入的文件），`proj.subtitle = subtitle`；`title` 非空才覆盖原标题。
4. `proj.subtitleCount = parseSubtitle(subtitle).length` 统计条目数（列表页显示用）。
5. `writeProject(proj)` 落盘（`subtitle.txt` 内容与 `proj.subtitle` 相同 ⇒ 不重复写；`project.json` 只写索引），返回 `{ ok: true, project }`。

**`project:save-content`（本轮改写入位置）**：

1. 校验 `name`（缺则 `缺少项目名`）。
2. `const content = normalizeContent(payload && payload.content)` —— 整份 `{ style, scenes }` 先规范化。
3. `ensureProject(name)` 取完整项目后 `proj.content = content`。
4. **`writeContent(name, content)`** —— 正文落 `content.json`（`JSON.stringify(content, null, 2)`）。
5. `writeProject(proj)` —— `content.json` 已存在，故这一步不会再写正文，只刷新索引里的 `updatedAt`。
6. 返回 `{ ok: true, project: proj }`；渲染层据此 `refreshProject()`，链路「内容脚本」节点靠 `hasContent` 点亮。

> 该频道是**整份 `content` 覆盖**（不是按字段合并），所以只改 `style` 的调用方（「HTML生成」页）必须把现有 `scenes` 原样带回、只改场景的调用方（「内容脚本」页）必须把已落盘的 `style` 原样带回——缺了谁就等于把谁清空。

### 5.6 视频产物回写（`project:save-video`）与已下线的原声提取入口

1. 校验 `name` 与 `videoPath` 均存在。
2. `ensureProject(name)` → `const dir = projectDir(name)` → `const abs = path.resolve(String(videoPath))`；**`proj.videoPath` = 项目目录内的路径就换算成相对路径，否则原样存**：

   ```ts
   proj.videoPath = abs === dir || abs.startsWith(dir + path.sep)
     ? path.relative(dir, abs).replace(/\\/g, '/')
     : String(videoPath);
   ```

   —— 就地渲染后成品恒为 `<项目目录>\video\output.mp4`，落盘值因此是 `video/output.mp4`（**正斜杠**，跨平台稳定）；老调用方仍可能传绝对路径，落在项目目录内的会被换算、项目外的（拿不到相对基准）原样保留。
3. `writeProject(proj)`（只更新索引里的 `videoPath` / `updatedAt`），返回项目对象；渲染层据此点亮链路「视频」节点。
4. 与素材字段区分：`materials`（`video/…` 相对引用）是参与 HTML 制作的**输入素材**，`videoPath` 是流水线**产出成品**（落盘为项目内相对路径、经 `project:load` 换算成绝对路径后才交给界面）。
5. `project:extract-video-audio` 先按 `FFMPEG_PACKS`（`const FFMPEG_PACKS: RuntimePackName[] = ['ffmpeg']`）调 `runtime.missingPacks()` 做**纯校验**：缺包立刻返回 `{ ok: false, needPacks: lack, message: '提取视频音轨需要先下载运行环境（' + runtime.packSizeText(lack) + '）' }`（**不再** `await runtime.ensureRuntime()` 等下载）；校验通过后才反向从 `videoMaterial` 提取音轨：用 `hfEnv.BUILTIN_RESOURCES.ffmpeg`（来自 ffmpeg 运行环境包）执行 `-hide_banner -loglevel error -y -i <video> -vn -ac 2 -c:a aac -b:a 192k <out>`；失败或产物为空都会清理文件并返回中文错误，成功后 `proj.audioFile = 'audio/' + outName`、`writeProject`，然后 `applyBgmToHtml` 立即把这条音轨注入 HTML，返回 `{ ok, audioFile, htmlUpdated }`。
6. **该 handler 本轮一行未改，但界面入口已下线**：其上方注释（源码）：

```
// 注意：素材改为多图/多视频素材库之后，本 handler 的**界面入口已临时注释下线**（原按钮在「HTML生成」页的
// 视频素材行；多视频下「提哪一条」需要按素材 id 重做，见 MaterialsSection.vue 里的注释块）。
// 本轮按用户要求「IPC 与 handler 原样保留」，因此它仍读历史字段 project.videoMaterial；恢复入口前先重做这一步。
```

### 5.7 目录穿越防护

- `projectDir` 对项目名中的路径分隔符与保留字符做替换，杜绝 `..\` 之类的名称注入。
- `project:delete` 校验 `dir.startsWith(projectsRoot())`，只允许删除 `userData\projects` 下的目录。
- **`normalizeMaterials` 校验 `file` 必须落在本项目 `images/` / `video/` 下且不含 `..`**，把越权素材引用挡在进入渲染层之前（读盘与写盘都会过一遍）。
- `hgpreview` 协议处理器（`main/index.ts`）用 `projects.projectDir(name)` 得根目录，再 `path.resolve(dir, rel)`，要求结果等于 `dir` 或以 `dir + path.sep` 开头，否则返回 403——素材缩略图（`images/…`）与预览副本都走这条协议。
- `project:set-audio` / `project:add-materials` / `project:extract-video-audio` 均先 `fs.existsSync` 校验源文件（`copyMaterialIntoProject` 内部也再判一次）。
- `project:open-folder-of` 只对存在的路径执行 `shell.openPath`。
- 正文分文件不影响这条防线：`contentFilePath(name)` 走的是同一个 `projectFilePath`，项目名净化规则一致。

### 5.8 随包前端库本地化（生成 / 修改 / 保存 / 预览四个写盘环节）

四个环节都先 `hfEnv.localizeVendorHtml(html)` 改写（CDN 与 `node_modules` 两种来源都改），差别在落位与兜底：

- **作者态三处**（generate / modify / save-html）统一写成 `if (!hfEnv.ensureVendorFiles(dir, html)) html = hfEnv.externalizeVendorHtml(html);`（modify 的目录变量名为 `projDir`，save-html 被改写的变量是 `localHtml`）—— 先把页面引用到的随包文件复制到位；**`ensureVendorFiles` 返回 `false`（有库缺失 / 复制失败）才把引用换回 CDN**（宁可联网也不引用不存在的文件）。因此这三处的 HTML 变量都由 `const` 改成 `let`。
- **预览**（preview-html）只改写副本、按需复制，**不判断返回值**（预览副本与原件引用一致，属同状态）。

| 环节 | 本地化的对象 | 目标目录 | `ensureVendorFiles` 返回 false 时 |
| --- | --- | --- | --- |
| `project:generate-html` | Agent 回复里抽取出的 HTML（`let html`） | `projectDir(name)` | `externalizeVendorHtml` 退回 CDN 后再写盘 |
| `project:modify-html` | Agent 回复里抽取出的 HTML（`let html`） | `path.dirname(htmlPath)`（即项目目录） | 同上 |
| `project:save-html` | 编辑器提交的 `html`（`let localHtml`，合规校验也用它） | `projectDir(name)` | 同上 |
| `project:preview-html` | 去掉 CSP 之后的**预览副本**文本 | `path.dirname(htmlPath)`（供原件与副本共同引用） | 忽略返回值（不退回） |

- `hfEnv` 侧的原语是「改写文本」（`localizeVendorHtml` / `externalizeVendorHtml`）与「幂等复制文件」（`ensureVendorFiles`）；是否改写、复制到哪、失败后是否退回，由本文件决定。`ensureVendorFiles` 只复制页面**引用到的**库文件，页面没引用任何库时直接返回 `true`。
- 随包文件缺失时 `localizeVendorHtml` 对缺的那家库整条跳过（退化为在线加载）；若 HTML 本来就引本地（模型照提示词写的），`ensureVendorFiles` 返回 `false`，作者态三处随即退回 CDN，流程不报错。
- 渲染路径上还有第五处本地化（`src/main/video.ts`：`localizeVendorHtml` + `ensureVendorFiles`，入口在 `.render-tmp/` 里再用 `hoistVendorRefs` 把引用抬成 `../`），不属本文件，且**仍忽略返回值**。
- 反向的一步（导出时换回 CDN）见 5.9。

### 5.9 导出外部化（`project:download-html`）

导出物是**单个 HTML 文件**，目标位置同目录不会有这些库文件；若原样导出项目内的 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 相对引用，导出后动画会完全不跑（这是本地化引入的回归）。因此导出频道改为「文本读出 → `hfEnv.externalizeVendorHtml` 换回各家登记的固定版本 CDN（`VENDOR_LIBS.pinned`）→ 文本写出」。

| 频道 | 写出方式 |
| --- | --- |
| `project:download-html` | 一律 `fs.writeFileSync(save, hfEnv.externalizeVendorHtml(fs.readFileSync(htmlPath, 'utf8')), 'utf8')`（原先是 `fs.copyFileSync`） |

> 导出频道只有 `project:download-html` 一个；`project:export-srt` 是纯文本写出，不涉及库引用改写。

- `externalizeVendorHtml` 不依赖随包文件是否存在（都不查 `vendorSource`）：文件缺失时照样能把本地引用换回 CDN。
- 只换回**带引号**的 `./p5.min.js` / `p5.min.js` / `/p5.min.js` 这类写法（每家库一条，写回该库的 `pinned`）；无引号写法的提及不改写。
- 导出只影响落盘的那一份拷贝，**项目目录内的 `index.html` 与库文件不变**（预览/渲染仍走本地引用）；导出物里的 `<img src="images/…">` 仍是相对路径，随附素材目录才能显示。
- **两种形态都内联角色与 `core.js`**：`project:download-html` 先按形态补一次助手文件（章节模式无条件 `syncCoreLib(dir)`；**单文件模式也调一次**——`if (!(proj.chapters && proj.chapters.length)) syncCoreLib(dir)`，因为注入的那份页面引的正是 `./core.js`）→ 调 `chapters.inlineChapters(html, sources)`：`sources` = 各章 `pages/cNN.js`（**只在章节模式才有**）**加上各角色 `cast/<id>.js`**（`cast.readCastCode(dir, proj.cast || [])`，**两种形态都加**）**再加上 `{ path: coreLib.CORE_FILE, code: coreLib.readProjectCore(dir) }`**，把每个 `<script src>` 换成内联脚本（`</script` 转义），再走上面的外部化与文本写出——否则导出物旁边没有 `pages/`、`cast/` 与 `core.js`，页面会是空白或「`MC` is not defined」。
- **`core.js` 为什么是内联而不是「换回 CDN」**：`externalizeVendorHtml` 只处理 `VENDOR_LIBS` 里那三个第三方库（各有 `pinned` 地址）；`core.js` 是影坊自己的文件、**没有 CDN 形态**，所以它走 `inlineChapters` 这条内联路径，而不是外部化路径。这也是它**故意不进 `VENDOR_LIBS`** 的原因（见 [hfEnv.ts.md](./hfEnv.ts.md) §2.2）。

### 5.10 项目级渲染档位覆盖（`project:set-render`）

渲染档位的三层优先级是「**项目覆盖（`project.json` 的 `render`）> 全局默认（`settings.json` 的 `render`）> 内置默认（`standard` / `30`）**」，本频道只负责中间那一层落在项目上的部分：

1. `name` 为空返回 `{ ok: false, message: '缺少项目名' }`。
2. `ensureProject(name)` 后计算 `const override = (payload && payload.render === null) ? {} : pickRenderOverride(payload && payload.render)`——`pickRenderOverride` 来自 `./settings`（与 `settings.ts`、`video.ts` 复用同一份白名单）。
3. `Object.keys(override).length` 为真 → `proj.render = override`；否则 `delete proj.render`（**清除覆盖**，字段不存在即表示跟随全局默认，而不是写入一份等于默认值的覆盖）。
4. `writeProject(proj)` 并返回 `{ ok: true, project }`，渲染层据此立即刷新 `appState.project.render` 与「是否显示恢复默认档位」。
5. 字段校验语义：只接受白名单内的显式值（`quality` ∈ `draft/standard/high`、`fps` ∈ `24/30`），任何非法值被丢弃——因此「只改质量」不会把帧率写成默认值。
6. **它是「顺手调用 `writeProject` 的写操作」里最需要正文兜底的一个**：老项目的字幕 / 脚本只存在于内联旧字段时，`writeProject` 会先把它们落成 `subtitle.txt` / `content.json` 再从索引里剥掉（见 3.9）——否则「只切个渲染档位」会把老项目正文删掉。`project:set-canvas` / `save-video` / `add-materials` / `save-materials` 同理。

### 5.11 背景音轨的六处调用点（`applyBgmToHtml`）

音轨注入不是一次性动作，而是「任何可能改动 `index.html` 或 `project.audioFile` 的写操作之后都必须补一次」：

| 调用点 | 时机 | 为什么需要 |
| --- | --- | --- |
| `project:set-audio` | `writeProject` 之后 | 选定 / 更换背景音频：立刻让预览可听、转视频带上 |
| `project:clear-audio` | `writeProject` 之后 | 移除音频：把注入的 `<audio>` 一并摘掉，否则成片仍有声 |
| `project:extract-video-audio` | `writeProject` 之后 | 提取出的原声同样立即注入（入口已下线，handler 保留） |
| `project:generate-html` | 写完 `index.html` + `writeProject` 之后 | 新 HTML 落盘后补音轨（模型侧被要求不写 `<audio>`） |
| `project:modify-html` | 覆盖写盘 + `writeProject` 之后 | 模型重写时可能整段丢掉注入标签，必须补回 |
| `project:save-html` | `writeProject` 之后 | 手改 / 粘贴进来的 HTML 可能没有音轨，按项目当前背景音频补回（与生成 / 修改同一套规则） |

- 前 3 处把 `applyBgmToHtml` 的返回值作为 `htmlUpdated` 返回给渲染层（`project:set-audio` / `project:extract-video-audio` 同时保留 `audioFile`）；**`project:save-html` 有意不改返回结构**，仍是 `{ ok, htmlPath, compatible }`。
- 后 3 处（generate / modify / save-html）忽略返回值：HTML 刚写过，调用方本就按 `htmlPath` / `compatible` 处理。
- 3 个音频频道改写 HTML 后，渲染层会重载预览（`HtmlGenPage` 的 `PreviewSection` → `afterAudioChange` → `loadFrame()`），因此预览副本始终与原件一致。

### 5.12 素材添加与列表回写（`project:add-materials` / `project:save-materials`）

**`project:add-materials`（复制入库 + 登记）**：

1. `name` 为空 → `{ ok: false, message: '缺少项目名' }`；`paths` 过滤出非空字符串，为空 → `{ ok: false, message: '没有选择文件' }`。
2. `ensureProject(name)`；`const list = normalizeMaterials(proj.materials)`（先把盘上的列表整理干净再追加）。
3. 逐个路径处理：
   - `list.length + added.length >= MAX_MATERIALS` → `skipped++` 并 `continue`（**已到上限的剩余文件整体跳过**）；
   - `materialKindOf(p)` 返回 `''`（白名单外）→ `skipped++`；
   - `copyMaterialIntoProject(name, kind, p)` 返回 `''`（复制失败）→ `skipped++`；
   - 成功则 `added.push({ id: newMaterialId(), kind, file, label: path.basename(p), selected: true, addedAt: new Date().toISOString() })`——**新素材默认参与生成**。
4. `added` 为空 → `{ ok: false, message: '没有可添加的素材：仅支持 ' + materialExtsText() + '，且上限 ' + MAX_MATERIALS + ' 个' }`。
5. `proj.materials = [...list, ...added]` → `writeProject(proj)` → `{ ok: true, materials: proj.materials, message: skipped ? '已添加 N 个素材，跳过 M 个（格式不支持或已达上限 20 个）' : undefined }`——**部分成功也返回 `ok: true`，跳过数放在 `message` 里**（渲染层优先用它作 toast）。

**`project:save-materials`（整份列表回写，移除与勾选共用）**：

1. `name` 为空 → `{ ok: false, message: '缺少项目名' }`。
2. `ensureProject(name)` → `proj.materials = normalizeMaterials(payload && payload.materials)` → `writeProject(proj)` → `{ ok: true, materials: proj.materials }`。
3. 主进程只做「规范化后落盘」，不做差集比对；**移除素材只摘登记、不删项目内的文件**（与原来的 `clear-video` 语义一致，避免误删资源）。

### 5.13 成片画布（`project:set-canvas`）

渲染档位那条线（5.10）是「项目覆盖 > 全局默认 > 内置默认」的三层结构；**成片画布刻意不走这套层级**——它是**项目属性**（源码注释：不进 `settings.json`、没有全局默认那一层），只在一处选（「HTML生成」页生成侧的「画布」下拉），落进 `project.json` 的 `canvas`，并且同一个值同时决定三件事：生成提示词里的版式尺寸（4.2）、预览 iframe 的画布、渲染入口注入的**舞台 `data-width`/`data-height`（成片宽高真正来源）**与 `<html data-resolution>`。

1. **取值**：`payload.canvas` 必须命中 `shared/constants.ts` 的 `RENDER_CANVASES`（`landscape` / `portrait` / `square`），否则 `{ ok: false, message: '画布取值非法' }`；缺 `name` → `{ ok: false, message: '缺少项目名' }`。
2. **只在值真变了才写**：`if (proj.canvas !== next)` 成立时才 `proj.canvas = next`，并**把已有的 `proj.videoPath` 置空**——理由与「HTML 改动后旧成片失效」同构：画布一变，已渲好的成片尺寸就不再匹配当前项目设定，不能继续被当成当前产物（界面据此重新显示「未生成视频」）。
3. **一定落盘**：无论值是否变化都 `writeProject(proj)` 并返回 `{ ok: true, project: proj }`（幂等，渲染层拿回执刷新全局状态；**对老项目的内联正文而言，这一次落盘也是一次迁移机会**，见 3.9）。
4. **它不会自动重排已有版式**：画布只影响**下一次**生成/修改时的提示词与之后的渲染；已有 `index.html` 的版式仍是按旧画布排的。改完之后：**修改路径会硬性要求模型重排**（`project:modify-html` 传 `forModify = true`，画布块多带第 ⑤ 条，见 4.2 / 5.3）；**生成路径没有这条**（从零做一版，本来就按当前画布排）。界面上的提示分两处承接：`HtmlGenPage` 画布行 `?` 气泡的固定常量 `canvasHint` 说明「换画布不会自动重排已有页面：…切到竖屏 / 方形会留下黑边或裁切」，动作行上方的统一 `.hgen-tip` 要求「改完要重新「生成 HTML」或「按需求修改」才会体现在页面上」。**应用侧「等比缩放旧页面 + 上下留黑带」本轮没做**（会让成片永远带黑边，且要同时改预览副本与渲染入口），属待定事项。
5. **渲染侧的对应值**：渲染时渲染层把 `appState.project.canvas` 随 `video:render` 载荷一起下发（`VideoRenderPayload.canvas`），`video.ts` 再白名单校验一次（非法 / 缺省落 `DEFAULT_CANVAS`）后写进入口 HTML——**舞台元素（第一个带 `data-composition-id` 的元素）的 `data-width`/`data-height` 是成片宽高的真正来源**，`<html data-resolution>` 只做页面自描述。详见 [video.ts.md](./video.ts.md) §1.2。

### 5.14 全局角色库与 `core.js` 版本同步

**A. 全局角色库 = 项目 ↔ 库之间的文件搬移**（库在 `<userData>/cast-library/`，用户资产、不进安装包）

| 动作 | 频道 | 主进程做的事 | 界面 |
| --- | --- | --- | --- |
| 列库 | `project:cast-library` | `readLibrary()` + 逐条 `libraryFileExists()` → 加 `missing` | 「从全局库添加」弹窗（缺文件的行压暗、不可勾选） |
| 存为全局 | `project:promote-cast` | 从 `Project.cast` 取元数据 + 复制 `cast/<id>.js` 进库 + 更新索引（同 id 覆盖） | 角色行「存为全局」 |
| 导入 | `project:import-cast` | 复制进 `<项目>/cast/` + 合并 `Project.cast`（新导入的默认 `selected: true`）+ **`refreshCastInPage()` 让页面立刻反映** | 弹窗勾选后「导入 N 个」 |
| 从库删 | `project:remove-cast-from-library` | 只删库里那份 + 更新索引 | （库管理动作，当前无界面调用方） |

- **导入必须是复制**：预览协议只放行项目目录、渲染静态服务器的 root 只有「编译产物目录 + 项目目录」，项目外的文件页面读不到。
- **库改了不会自动改已导入的项目**：角色是内容不是基础设施，要更新就再导入一次（同 id 覆盖）。
- **为什么导入后要重刷页面**：页面里的 script 清单（章节模式的骨架 / 单文件模式的注入）决定「谁被引入」。不重刷，新角色不会被 `<script>` 引入，章节里 `window.__cast["x"]` 是 `undefined`——成片少个人还不报错。
- **两种形态都重刷**：章节模式重写骨架、单文件模式按新勾选重新注入（`refreshCastInPage` 内部按 `proj.chapters` 是否为空分流），所以「单文件项目导入角色后要等下次生成才生效」的旧说法已不成立。

**B. `core.js` 的四处同步时机**（`syncCoreLib(dir)` = `hfEnv.coreSource()` + `coreLib.syncCoreTo()` + 留痕）

| 时机 | 位置 | 行为 |
| --- | --- | --- |
| 写骨架前 | `writeChapterSkeleton()` | 无条件同步（页面一定引了 `./core.js`） |
| **单文件注入前（本轮新增）** | `applyCastToHtml()` | **仅当勾了角色时**才同步（没勾角色的页面里根本不会塞 `core.js`，没必要多写一份文件） |
| 预览前 | `PreviewHtml` | 仅当副本里匹配到 `<script src="./core.js">` 才同步 |
| 导出前 | `DownloadHtml` | 章节模式无条件同步；单文件模式也同步一次（导出的页面引了 `./core.js`），同步后再内联 |
| 渲染前 | `video.ts`（不在本文件） | 仅当页面引了 `./core.js`；留痕写 `video-duration.log` 而不是 `core-lib.log` |

- **幂等**：`coreLib.syncCoreTo` 在「版本一致 + 文件在」时什么都不做，所以这几处每次调用都没有代价。
- **留痕只在真复制 / 出错时写**：`<userData>/core-lib.log` 一行 `ISO [项目名] core.js 版本 a → b`；日志写失败静默（不影响生成）。
- **拿不到真源不拦路**：`hfEnv.coreSource()` 回 `null` 时 `syncCoreLib` 直接 return——页面里的 `MC` 会是 `undefined`（可接受的降级），但不该因为「应用里缺一个 8 KB 文件」让整次生成失败。

### 5.15 项目角色的两条创建路径与「变更立即生效」

**角色是项目资产**：它在「HTML生成」页 · 「项目素材」区（图片 / 视频 / 角色三类并列）里维护，与「单文件 / 章节化」两种产物形态**完全无关**。两条创建路径**都不经过「生成 HTML」**：

| 路径 | 频道 | 做什么 | 调模型吗 |
| --- | --- | --- | --- |
| **手动「新建角色」** | `project:new-cast` | 弹窗填 角色名 / 外形描述 / 高几 u / 是否用水彩 → 拼一个 `ProjectCastMember`（`selected: true`，水彩 ⇒ `uses: ['p5','p5.brush']`）→ `buildCastPrompt` → `chatWithCast` 画 `cast/<id>.js` → `cast.writeCastFiles` → `proj.cast` 追加 → `refreshCastInPage()` | **是，一次**（画这个角色） |
| **「从全局库添加」** | `project:import-cast` | 从 `<userData>/cast-library/` **复制**进项目 `cast/` → 合并进 `Project.cast`（默认勾选）→ `refreshCastInPage()` | 否（纯搬文件） |

**勾选「参与本次生成」**：`ProjectCastMember.selected?: boolean`，与 `ProjectMaterial.selected` 同语义，**缺省 = 参与**。只有勾选的角色才会被注入页面（`cast.selectedMembers()` 是唯一判据），勾选 / 取消 / 移除 / 改名都走 `project:save-cast`（整份角色表回写，与 `project:save-materials` **同语义**）。

**`refreshCastInPage(name, proj)` 是「立即生效」的唯一出口**：

```
refreshCastInPage(name, proj)
  ├─ proj.chapters 非空 → writeChapterSkeleton(name, proj, proj.chapters, selectedMembers(proj.cast))
  │                        （骨架里的 script 清单就是「谁参与」的真相）
  └─ 否则读回 index.html → applyCastToHtml(cur, proj, dir) → 有变化才写盘
                           （castInject 幂等：先整组剥掉旧注入、再按新勾选注入；不动模型写的内容）
  → writeProject(proj)
```

三个调用点：`project:new-cast`（新建后）、`project:import-cast`（导入后）、`project:save-cast`（勾选 / 移除后）。**这就是「角色表变更立即生效」**：不需要重新「生成 HTML」。

## 6. 依赖与协作

**本模块 import：**

| 来源 | 引入物 | 用途 |
| --- | --- | --- |
| `electron` | `app, ipcMain, dialog, shell` | `userData` 路径（每次经 `projectsRoot()` 惰性求值）、IPC 注册、文件/目录选择对话框、打开目录 |
| `node:path` / `node:fs` | `path` / `fs` | 路径拼接与全部同步文件读写 |
| `node:child_process` | `spawn` | 调用内置 ffmpeg 提取视频音轨 |
| `./agent` | `chatWithCustomModel`、`extractHtmlFromReply`、`type AgentProgress` | 调用自定义模型生成/修改 HTML、抽取回复中的 HTML、进度事件类型（三个名字都经 `agent/index.ts` 再导出；目录化重构只改 import 的来源目录，名字与两个调用点未变）；章节模式另从 `./agent` 取 `chatWithChapterPlan` / `chatWithChapter` / `chatWithChapterEdit` / **`chatWithCast`** / **`chatWithRoute`** 五个包装 |
| `./chapters` | `parsePlanReply`、`parseFileBlocks`、`validateChapterCode`、`writeChapterFiles`、`removeChapterFiles`、`readChapterCode`、`totalDuration`、`chapterOffsets`、`buildSkeleton`、`inlineChapters`、`chapterOutlineText` | 章节模式的解析 / 校验 / 读写 `pages/cNN.js` / 装配骨架 / 导出内联（纯逻辑，不反向 import 本文件，避免成环）；**`buildSkeleton` 的 `cast` 参数是「要引入的那几个」（传谁引谁，不再看各章 cast 并集）、`inlineChapters` 收「项目内相对路径 + 代码」数组** |
| `./cast` | 命名空间导入 `import * as cast from './cast'`：`cast.castRelPath`、`cast.castOutlineText`、**`cast.selectedMembers`**、`cast.parseCastFiles`、`cast.validateCastCode`、`cast.writeCastFiles`、`cast.readCastCode`（**`cast.parseCastTable` / `cast.removeCastFiles` 本文件已不再调用**） | **角色表的纯逻辑**（解析 / 校验 / 过滤 / 读写 `cast/<id>.js` / 大纲文案），与 `chapters.ts` 同构：不 import 本文件、不调模型 |
| `./castInject` | **命名空间导入** `import * as castInject from './castInject'`：`castInject.injectCastTags` | **本轮新增**：单文件模式的角色注入（`applyCastToHtml`），纯字符串变换、幂等，见 [castInject.ts](./castInject.ts.md) |
| `./editRoute` | `parseRouteReply` | 「按需求修改」第一段的路由结果解析（白名单过滤 / 去重 / ≤6 个 / 允许 `restructure` 空 targets）；解析失败由本文件回退成「发全部源码」 |
| `../shared/errors` | `configTargetOf` | 两处 Agent 调用失败时，对**已翻译的中文文案**复用同一张码表补配置类分类（`needConfig` / `title`），供渲染层弹「去设置」；余额类不参与（它没有 `needConfig`） |
| `../shared/constants` | `CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, IMAGE_MATERIAL_EXTS, MAX_MATERIALS, RENDER_CANVASES, VIDEO_MATERIAL_EXTS, estimateSubtitleDur` | 素材类型白名单与合计上限（`materialKindOf` / `materialExtsText` / `normalizeMaterials` / `project:pick-media` / `project:add-materials`）+ **成片画布三档与尺寸（`buildCanvasBlock()` 拼【画布】块、`project:set-canvas` 做白名单校验）** + **字幕估时函数 `estimateSubtitleDur`（`parseSubtitle` 给无时间戳行兜底起始时间，与渲染层 `estDur` 共用同一份）** |
| `./hfEnv` | **命名空间导入** `import * as hfEnv from './hfEnv'`：`hfEnv.BUILTIN_RESOURCES`（取 `ffmpeg`，来自 ffmpeg 运行环境包）、`hfEnv.isHyperframesComposition`、`hfEnv.localizeVendorHtml`、`hfEnv.ensureVendorFiles`、`hfEnv.externalizeVendorHtml`、**`hfEnv.coreSource`（本轮新增：`./core.js` 真源路径）** | ffmpeg 路径、HyperFrames composition 合规校验、生成 / 修改 / 保存 / 预览四个写盘环节的随包前端库本地化（GSAP / p5 / p5.brush），以及导出频道的反向外部化；`coreSource` 供 `syncCoreLib` 定位共享绘制助手 |
| `./coreLib` | **命名空间导入** `import * as coreLib from './coreLib'`：`coreLib.syncCoreTo`、`coreLib.readProjectCore`、`coreLib.CORE_FILE` | **本轮新增**：`./core.js` 的版本同步（写骨架 / 预览 / 导出三处）与导出内联（`readProjectCore` 取项目里那份代码、`CORE_FILE` 当内联 `path`）。纯逻辑模块，不 import electron / 不 import 本文件 |
| `./castLibrary` | **命名空间导入** `import * as castLibrary from './castLibrary'`：`castLibrary.readLibrary`、`castLibrary.libraryFileExists`、`castLibrary.promoteFromProject`、`castLibrary.importToProject`、`castLibrary.removeFromLibrary` | **本轮新增**：全局角色库的四个动作（列库 / 存为全局 / 导入 / 从库删）。库根目录由本文件的 `castLibraryRoot()` 传进去；`missing` 由本文件在 handler 里现算 |
| `./runtime` | `import * as runtime` → `runtime.missingPacks()` / `runtime.packSizeText()` | `project:extract-video-audio` 先做**缺包纯校验**（`FFMPEG_PACKS = ['ffmpeg']`）：缺包即返回 `{ ok: false, needPacks, message }`，**不下载、不阻塞**；是否下载由界面（`useEnvGate`）问用户。ffmpeg 属于「ffmpeg 运行环境包」（包实测 **42.6 MB**，2026-10-14；解包 179.9 MB），不再随安装包 |
| `../shared/ipc` | `IPC` | 频道常量（`IPC.Project.*`） |
| `./settings` | `pickRenderOverride` | `project:set-render` 的项目级档位覆盖白名单过滤（与 `settings.ts` / `video.ts` 复用同一实现） |
| `../shared/types` | `type RegisterCtx`、`type ProjectAgentPayload`、`type ProjectExportSrtPayload`、`type ProjectNamePayload`、`type ProjectSaveContentPayload`、`type ProjectSaveHtmlPayload`、`type ProjectSaveSubtitlePayload`、`type ProjectSetAudioPayload`、`type ProjectSetVideoPayload`、`type ProjectSetRenderPayload`、**`type ProjectSetCanvasPayload`**、**`type ProjectMaterial`、`type ProjectMaterialKind`、`type ProjectAddMaterialsPayload`、`type ProjectPickMediaPayload`、`type ProjectSaveMaterialsPayload`**、**`type RenderCanvas`**（画布局部变量与 handler 载荷元素类型）、**`type ProjectIndex`（本轮新增：`readProject` 的返回类型、`applyBgmToHtml` 里 `readProject(name)` 的推断类型）**，**`type ProjectCastMember`（角色表 / `selectedMembers` / `new-cast` 的返回值）、`type ProjectNewCastPayload`、`type ProjectNewCastResult`、`type ProjectSaveCastPayload`（本轮新增的三个角色类型）、`type CastLibraryResult`、`type ProjectCastResult`**，以及 `type ContentScript` / `type Project` / `type Scene` / `type SubtitleLine`（后者四个在 import 后立即 `export type { … } from '../shared/types'` 再导出） | `register(ctx)` 的窗口上下文类型 + 全部 `project:*` handler 的载荷类型 + 项目结构（单一真源，本文件不再自行声明 interface） |

**被谁使用：**

| 使用方 | 方式 |
| --- | --- |
| `src/main/index.ts` | `import * as projects`；`createWindow()` 后 `projects.register(ctx)` 注册全部 `project:*`；`hgpreview` 协议处理器使用 `projects.projectDir(name)` 定位并校验项目目录 |
| `src/main/voice.ts` | 三处调用 `projects.projectsRoot()`（**函数**）取项目根：`resolveTtsDir()`、`voice:list-generated`、`voice:synth` 落盘回执；另用 `projects.scanProjects()` 枚举项目 |
| `src/main/whisper.ts` | `import * as projects`，配合 `ensureProject` / `projectDir` 解析项目内音频相对路径 |
| `src/main/ttsAlign.ts` | `import { parseSubtitle, type SubtitleLine }`，字幕时间轴对齐（无 `[时间]` 前缀的行由 `estimateSubtitleDur` 兜底起始时间，见 3.1） |
| 渲染层 | 经 preload 的 `projectTools`（`window.projectTools`）调用上述频道；生成/修改期间监听 `project:html-progress` 渲染进度；素材库由 `HtmlGenPage/MaterialsSection.vue` 调 `pickMedia` / `addMaterials` / `saveMaterials`；**角色这一侧渲染层本轮改动最大**：「HTML生成」页 ·「项目素材」区 ·「角色」块的 `CastSection.vue`（159 → **262** 行）常显、每行多一个勾选框、标题右侧多一个「新建角色」，调 `listCastLibrary` / `promoteCast` / `importCast` / **`newCast`** / **`saveCast`** 五个方法（`removeCastFromLibrary` 目前无界面调用方）。`project:load` 仍回完整 `Project`、`project:save-content` / `save-materials` 回执结构没变——**数据契约没动，变的是「角色多了两条创建路径 + 一个勾选开关」** |

## 7. 注意事项与实现要点

1. **项目一律是 `userData\projects` 下的真实目录**：每个项目都有对应的本地目录，不存在「无本地目录的项目」。`project:open-folder` 的目录不存在分支只剩一种情形——项目尚未保存（`ensureProject` 只在内存里构造对象、不落盘），文案为「项目目录不存在（项目尚未保存）」。
2. **`projectsRoot` 是函数、不是常量**：`path.join(app.getPath('userData'), 'projects')` 每次调用重新求值。**新代码不要把它提成模块级常量，也不要在模块顶层 `const root = projectsRoot()`**。
3. **正文分层是硬约束，不是优化**：`project.json` **只存索引**，字幕正文只在 `subtitle.txt`、内容脚本正文只在 `content.json`。新增字段前先问「它会不会让 `project.json` 随内容变大」——它会被 `scanProjects()` 对**每个项目**解析（每次 `project:list` 都跑一遍），塞正文等于把列表页变成全文解析。实测：`任意文件女生` **5283 B → 849 B**、`项目3` **7930 B → 278 B**。
4. **`readSubtitle` 内联优先、`readContent` 文件优先——不是笔误**：老数据的 `subtitle.txt` 可能比内联字幕更旧（实测「任意文件女生」txt 1.5 KB / 内联 5.7 KB），文件优先会让升级后字幕突然变短；而 `content.json` 是本轮才出现的新文件，存在即最新。两者的共同点是：内联旧字段只当兜底来源，`writeProject` 一律剥掉。
5. **`writeProject` 必须先落正文、再剥字段**：只调一次 `set-canvas` / `set-render` / `save-video` 之类不碰正文的写操作时，老项目的字幕 / 脚本可能只存在于索引的内联字段里——先落盘才不会被「剥字段」删掉。落盘规则是「不同才写」（字幕）与「文件不存在才写」（脚本）。
6. **路径校验**：`projectDir` 做项目名字符净化，`project:create` 前置拦截非法字符，`project:delete` 用 `dir.startsWith(projectsRoot())` 兜底，`normalizeMaterials` 校验素材 `file` 必须在本项目素材目录下且不含 `..`——三层合起来禁止越界读写与删除。
7. **`ensureProject` 不落盘**：它只构造内存对象（`materials: []` 就在这个初始对象里），因此 `project:load` 打开不存在/未保存的项目不会产生目录；真正落盘发生在 `writeProject`。
8. **编码统一 utf8**：`project.json`、`subtitle.txt`、**`content.json`**、`index.html`、`.srt` 均以 `'utf8'` 读写；两个 JSON 都按 `JSON.stringify(…, null, 2)` 落盘（便于 diff / 手查）。
9. **失败处理风格**：所有 IPC 返回 `{ ok, message }` 而不抛异常；Agent 与 ffmpeg 的异常被包装成中文错误文案（Agent 侧还会经 `configTargetOf()` 补配置类分类 `needConfig` / `title`）；`readProject` 解析失败静默返回 `null`；`readContent` 解析失败静默回退内联；`copyAudioIntoProject` / `copyMaterialIntoProject` 复制失败返回 `''` 由调用方报错（`add-materials` 把它算进 `skipped`）。
10. **进度推送安全**：发送前判断 `sender.isDestroyed()`，避免窗口销毁后 `send` 抛错。
11. **字段兼容与向后兼容**：`subtitleCount`、`videoMaterial`、`updatedAt`、`materials`、`render`、`canvas` 均为可选字段；`materials` 缺失 / 非数组时被 `normalizeMaterials` 归为 `[]`，因此老项目照常打开、只是素材库为空；老项目没有 `content`、或 `content.scenes` 里**没有画面分镜（`visual`）非空**的场景时 `buildContentBlock` 返回 `''`——判据是画面分镜，**旁白为空不影响**（那样的场景是静音段，照常进提示词）。**全局视觉风格不跟着一起消失**：它由 `buildStyleBlock` 无条件输出（见 3.10），用户填没填都有一段。**索引里的 `subtitle` / `content` 是「只读兼容字段」**：读到就用（并尽快迁走），永远不会被写回。
12. **素材 vs 成品**：`audioFile` / `materials[].file` 是相对引用（`audio/xxx`、`images/xxx`、`video/xxx`，与 HTML 同目录系，保证预览与渲染都能解析），`htmlPath` 是绝对路径，而 `videoPath` **落盘为项目内相对路径**（`video/output.mp4`，见 3.8）、只在 `project:load` 交给渲染层的那一刻换算成绝对路径；移除素材 / 清空音频只摘登记不删文件，避免误删素材——但**清空音频会同步摘掉 HTML 里注入的 `<audio>`**，因为音轨是 HTML 的一部分（见 5.11）。
13. **`videoMaterial` 是历史字段**：不再新写、素材列表也不读它；只有已下线的 `project:extract-video-audio` handler 还在读（恢复该入口前必须先按素材 id 重做）。`writeProject` **没有**剥它——老索引里若本来有，会被原样写回。
14. **HTML 变更即令视频失效**：生成、修改、直接保存 HTML 三处都会把 `videoPath` 置空，防止链路状态误报。
15. **合规检查只提示不阻断**：`compatible` 为 `false` 时仍返回 `ok: true` 并允许预览，仅在 `message` 中提示转视频前需调整（缺 `data-composition-id` / `__timelines` / `gsap`）。
16. **预览副本专供应用内预览**：CSP 剥离与脚本注入只作用于 `index.preview.html`，原件始终保持模型产出的原貌；注入音轨则相反——它写进**原件** `index.html`（预览副本从原件派生，因此自动带上）。
17. **素材上限与白名单只在本文件与 `shared/constants.ts` 一处**：`MAX_MATERIALS = 20` 是「图片 + 视频合计」，`IMAGE_MATERIAL_EXTS` / `VIDEO_MATERIAL_EXTS` 是唯一白名单；渲染层只用它们做展示与提示（`n / 20`、支持格式文案），真正的准入与截断发生在 `project:add-materials` / `normalizeMaterials`。
18. **ffmpeg 来自运行环境包、缺包即回 `needPacks`**：`project:extract-video-audio` 第一步就 `runtime.missingPacks(FFMPEG_PACKS)`（纯探测、不下载），缺包返回 `{ ok: false, needPacks: ['ffmpeg'], message: '提取视频音轨需要先下载运行环境（约 43 MB）' }`（体积文案由 `runtime.packSizeText()` 按 `PACK_DEFS.hint` 生成；ffmpeg 包实测 42.6 MB），由渲染层弹确认框；校验通过后才用 `hfEnv.BUILTIN_RESOURCES.ffmpeg`（`<userData>/runtime/ffmpeg/ffmpeg/bin/ffmpeg.exe`）提取，提取失败会删除半成品 `.m4a`。**旧行为「`await runtime.ensureRuntime()` 静默等下载」已删除**。
19. **结构类型只在 `shared/types.ts` 定义一处**：本文件已删掉本地的 `Scene` / `ContentScript` / `Project` / `SubtitleLine` interface，改为顶部的 `export type { … } from '../shared/types'` 再导出；`ProjectMaterial` / **`ProjectIndex`** 同样定义在共享层（`ProjectIndex` 只 import 不再导出）。修改字段请改共享层，不要在本文件重建 interface（否则又会出现两份会漂移的定义）。
20. **handler 载荷全部有契约类型**：`ProjectNamePayload.name` 是**必填** `string`（用于 `clear-audio`），而 `ProjectSaveSubtitlePayload` / `ProjectSetAudioPayload` / `ProjectSetVideoPayload` / **`ProjectPickMediaPayload` / `ProjectAddMaterialsPayload` / `ProjectSaveMaterialsPayload`** 等字段全部可选，运行时依旧保留 `payload && payload.name` 式的判空写法。
21. **随包库本地化的兜底语义**：改写只在「该库的随包文件存在」时发生，缺哪家就整条跳过（`localizeVendorHtml` 保留那家原来的引用，继续走 CDN，在线可用），因此这是**能力增强而非硬依赖**。`ensureVendorFiles` 的返回值在本文件**只剩 `project:preview-html` 一处被忽略**：generate / modify / save-html 三处现在都用它做兜底——返回 `false` 即 `externalizeVendorHtml` 退回 CDN。`video.ts` 的渲染副本仍忽略返回值。
22. **导出时换回 CDN、项目内保持本地引用**：`project:download-html` 是「读出 → `hfEnv.externalizeVendorHtml` → 文本写出」，导出物里的库引用是各家登记的指定版本 CDN 地址，因此导出的单个 HTML 放到别处联网即可独立打开；项目目录内的 `index.html` 仍是 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 本地引用（离线预览/渲染不受影响）。注意：导出物从此依赖网络，而素材（`images/` / `video/`）也不会被带上——导出的 HTML 只有在素材目录同行的位置才能显示素材。
23. **预览只在副本上改写**：`project:preview-html` 的 CSP 剥离与随包库改写都作用于 `index.preview.html`，原件 `index.html` 保持原貌；但库文件（`gsap.min.js` / `p5.min.js` / `p5.brush.js`）是落在**项目目录**（原件与副本共用），所以原件的相对引用也成立。该处**不参与作者态的复制失败兜底**（返回值被忽略）。
24. **`./hfEnv` 已改为命名空间导入**：`import * as hfEnv from './hfEnv'`，全文以 `hfEnv.` 前缀引用，原解构导入已取消。
25. **音轨注入的三条不变量**：① 标签 id 固定为 `myv-bgm`，注入前先 `stripInjectedBgm`，重复设置不会叠出多条音轨；② 引用同一项目音频文件的历史 `<audio>`（旧版由模型按提示词写入）由 `stripAudioOfFile` 摘掉，避免双份播放；③ 没有 `index.html` 时 `applyBgmToHtml` 静默返回 `false`——因此「先生成音频、后生成 HTML」的顺序不会报错，音频会在下次生成 / 修改时随 HTML 一起补上。
26. **预览默认静止、播放由用户驱动**：合成的 timeline 是 `paused: true` 创建、开头又 `gsap.set(..., { opacity: 0 })`，所以载入后画面停在第 0 帧、**起始帧本来就是空的**——这不是加载失败。`HG_PREVIEW_CTRL` 只做三件事：`freeze()` 冻住并立刻上报一次；用户发来任何 `pause`/`play`/`seek`/`restart` 就置 `userActed` 停手；`watchEnd()` 在真实时间轴全部跑完时统一 `setPaused(true)`。配套地 `isPlaying()` 把「已播完」排除在「在播」之外；`setTime()` 只挪播放头、不改播放/暂停状态，并在 seek 后回一条带 `ack` 的上报供父页定位。
27. **换画布后「旧页面重排」靠提示词、不靠应用缩放**：`buildCanvasBlock()` 的第 ⑤ 条**只在修改路径注入**（`project:modify-html` 传 `forModify = true`；生成路径不传、默认 `false`），条文要求模型把主舞台改成新画布尺寸并重算坐标 / 字号 / 间距，**不许用 `transform: scale` / 居中留白 / 黑边硬套旧版式**。应用侧「把旧页面等比缩放、上下留黑带」本轮**没有做**（渲染层与 `video.ts` 一行未改）：那是另一种结果（成片永远带黑边），且必须同时改预览副本与渲染入口，属待定事项。因此换画布后必须重新「生成 HTML」或「按需求修改」才会生效。
28. **预览视口由「页面声明」决定，成片仍按项目画布**：`project:preview-html` 除 `previewPath` 还回 **`pageCanvas`**（从原 HTML 的 `<html data-resolution>` 解析 + `RENDER_CANVASES` 白名单，缺失 / 非法 `''`）；渲染层用它把预览 iframe 设成**页面原生尺寸**，再整体按视角 contain（等比 + 黑边）。**这只是一条只读回执字段**：不新增频道、preload 一行未改、`video.ts` 不受影响——**成片仍按项目画布渲染、该裁就裁**，所以「页面版式与画布不匹配」时预览与成片可以不一致；要让成片也重排只能靠 4.2 的第 ⑤ 条提示词 + 重新生成。
29. **`project:load` 的对外契约没变，是上一轮数据层重构的核心约束**：handler 里只是把「读索引 + 拼正文」换成 `ensureProject(name)`，返回的仍是含 `subtitle` / `content` 的完整 `Project`（外加 `videoPath` 绝对化、`materials` 规范化）。因此那一轮 `src/renderer/**` 0 行改动、preload 与 IPC 频道都没动；新增的 `ProjectIndex` 只活在主进程（`readProject` 的返回类型）与 `shared/types.ts` 里。**注意「频道数」的正确值**：全库频道总数现在是 **100 个**（本轮给项目角色加了 `new-cast` / `save-cast` 两条，`Project` 组从 30 涨到 32），不是 87——**87 是当时 `src/` 下的文件数**，与频道数无关，早前把它写成「87 个频道」是错的。
30. **章节模式的 `index.html` 由应用生成、模型只写每章 JS**：舞台 / 画布 / 脚本顺序 / 主时间轴装配 / `__timelines` 登记 / `data-duration`（= Σ 章时长）全部来自 `chapters.buildSkeleton()`；章节脚本不许写 `<script>`，要用 p5 / p5.brush 只能在 `ProjectChapter.uses` 里声明；**随包库按「章节 `uses` ∪ 传入角色列表的 `uses`」的并集引入，顺序固定 `gsap → p5.min.js → p5.brush.js → core.js → cast/<角色>.js → 章节脚本`**——角色脚本必须排在章节之前，章节里才拿得到 `window.__cast`。
31. **`Project.chapters` 为空 = 单文件模式**：老项目零迁移；从章节模式切回单文件只清空 `pages/`（`chapters.removeChapterFiles`）与 `proj.chapters`，**`cast/` 与 `Project.cast` 原样保留**（角色是项目素材；`cast.removeCastFiles` 因此没有调用方）。单文件模式下角色靠 `castInject` 注入，切换形态不会让角色从页面里"消失"到要重新建一遍。
32. **角色是项目资产、是一份跨形态共用的绘制代码**：`cast/<id>.js` 里只有 `window.__cast["hero"] = function (x, y, u, o) { … }`，`(x, y)` 是脚底中点、`u` 是 1 个单位的像素高度；角色表 `units` 声明「高几个 u」（主角 8u、配角 6u），多角色身高比例靠它。**章节是互相隔离的 IIFE、作用域不共享**，不共享角色代码同一角色就会在各章被各画一遍，长相就散了——这是角色必须单独一层、且由骨架 / 注入在用到它的代码之前引入的原因。**它归项目所有、与产物形态无关**：勾选参与本次生成，两种形态都注入。
33. **改稿两段式与「路由失败就回退」**：`applyChapterEdit()` 先 `chatWithRoute`（只发大纲 + 角色表 + 需求）让模型报要改哪几份文件，再只带那几份源码定向编辑；路由解析失败 / 目标全不在白名单时回退成「发全部源码」。**为什么**：长片源码合计几百 KB（章节 × 30–70 KB + 角色 × 10–20 KB），一次全发会撞模型上下文上限；代价只是多一次很便宜的路由调用。**频道数不变**，界面上也看不到「路由」这一步。
