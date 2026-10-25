# src/main/projects/（项目化流水线）

> 主进程「我的项目」项目化流水线的**同名目录模块**：项目落盘（**索引 + 正文分层**）、字幕 / 内容脚本、**项目素材库（图片 / 视频）**、HTML 生成 / 修改 / 预览 / 导出、**角色库与动作示范的 IPC 装配**、`project:*` / `cast:*` IPC。**一个模块、十六个文件**：同名目录 + `index.ts` 统一出口，对外接口与拆分前逐字相同（调用方的 `import * as projects from './projects'` 一行未改）。
>
> **角色不在这些文件里定义**（真源在 `main/cast/` 的全局角色库）：项目里只记「本片用了哪几个角色」（`project.json` 的 `cast = [{ id, selected }]`），读项目时按 id 从库补全，写盘前把勾中的复制成 `<项目>/cast/` 副本。**动作**（`main/cast/actions.ts` 的动作库）也只存 `<userData>/cast-library/actions.json`，不碰项目。

- **覆盖文件**（16 个 `.ts`，行数为工作区实测 `[IO.File]::ReadAllLines`）：`projects/index.ts`（38 行）、`projects/paths.ts`（57）、`projects/store.ts`（**239**）、`projects/materials.ts`（87）、`projects/prompts.ts`（**354** 行 / **27,844** 字节，全目录最长）、`projects/bgm.ts`（65）、`projects/previewScript.ts`（159）、`projects/progress.ts`（45）、`projects/htmlWrite.ts`（127）、`projects/chaptersFlow.ts`（192）、**`projects/register.ts`（19）**、`projects/ipc/project.ts`（121）、`projects/ipc/html.ts`（**247**）、`projects/ipc/media.ts`（218）、`projects/ipc/cast.ts`（**223**）、**`projects/ipc/castActions.ts`（154）**
- **规模**：**16 个文件、合计 2345 行**，最长 354 行（`prompts.ts`，过了 300 行「考虑拆分」线但未触 500 行硬上限）
- **所在目录**：src/main/projects/
- **类型**：业务域模块（`register(ctx)` 装配模式）；形态为「同名目录 + `index.ts` 统一出口」，与 `src/main/agent/`、`src/main/updater/` 同一套工程约定（见根 `AGENTS.md` 关键约定 9）
- **对外导出**（全部由 `index.ts` 再导出，**13 个值 + 4 个类型**）：`register`、`scanProjects`、`projectsRoot`、`projectDir`、`projectFilePath`、`readProject`、`writeProject`、`ensureProject`、`parseSubtitle`、`normalizeContent`、`copyAudioIntoProject`、`copyMaterialIntoProject`、`normalizeMaterials`；类型 `ContentScript` / `Project` / `Scene` / `SubtitleLine`（定义在 `src/shared/types.ts`，此处只转发）
- **IPC 域**：`register.ts` 按固定顺序调**五个**装配函数——`registerProjectIpc`（9）/ `registerHtmlIpc`（6）/ `registerMediaIpc`（10）/ `registerCastIpc`（**7**：6 条 `cast:*` + `project:save-cast`）/ **`registerCastActionIpc`（5：全部 `cast:*` 动作类）**；另有 1 路推送 `project:html-progress`。`project:*` 组因此是 **26 个 handle + 1 条推送 = 27 条频道**，`cast:*` 组 **6 + 5 = 11 条**
- **调用方零改动**：`src/main/index.ts`、`voice/`、`whisper.ts` 仍是 `import * as projects from './projects'`（目录索引自动解析到 `projects/index.ts`），`voice/ttsAlign.ts` 仍是 `import { parseSubtitle, type SubtitleLine } from './projects'`

## 1. 十六个文件的分工与依赖方向

| 文件 | 行数 | 职责 | 该文件的关键名字 |
| --- | --- | --- | --- |
| `index.ts` | 38 | **统一出口**：再导出 13 个值 + 4 个类型；文件头保留「每个项目目录里有什么」说明与目录结构 / 依赖方向注释 | 13 个再导出、`export type { ContentScript, Project, Scene, SubtitleLine }` |
| `paths.ts` | 57 | **路径层 / 依赖最上游**：只拼路径、不读写文件；项目根故意写成**函数**（惰性求值，见 §5） | `projectsRoot`、`projectDir`、`projectFilePath`、`contentFilePath`、`resolveVideoAbs`、**`castLibraryRoot`**、**`castPreviewDir`** |
| `store.ts` | 239 | **项目读写**：`project.json`（索引）+ `subtitle.txt` / `content.json`（两个正文）的读、写、补齐、扫描与规范化；**角色在磁盘上只落 `[{ id, selected }]`、读项目时按 id 从库补全** | `readProject`、`readSubtitle`、`readContent`、`writeContent`、`writeProject`、`normalizeCastSelections`、`resolveProjectCast`、`ensureProject`、`normalizeContent`、`scanProjects`、`parseSubtitle`、`copyAudioIntoProject` |
| `materials.ts` | 87 | **项目素材库（图片 / 视频）**：目录表、素材 id、扩展名判类型、拷入项目、清单规范化、白名单文案 | `MATERIAL_DIR`、`materialSeq`、`newMaterialId`、`materialKindOf`、`copyMaterialIntoProject`、`normalizeMaterials`、`materialExtsText` |
| `prompts.ts` | **354** | **纯字符串拼装（只读项目数据）**：内容脚本 / 全局视觉风格 / 素材 / 画布 / 成片时长 / 无限循环等提示块，以及规划、逐章、**画角色 / 改画法 / 动作脚本**五份 prompt（**15 个导出函数**）；**不调模型、不写盘**；新增 **`buildCastActionPrompt()`**（见 §1.3）；**本轮 +1 行**：`buildCastEditPrompt` 的**【关节】**整段重写（3 行拼接 → 6 行拼接，见 §1.3） | `buildAgentPrompt`、`buildContentBlock`、`buildStyleBlock`、`resolveMaterials`、`buildMaterialBlock`、`buildCanvasBlock`、`buildMaterialPrompt`、`validSceneList`、`projectCanvas`、`buildPlanPrompt`、`subtitleWindowText`、`buildChapterPrompt`、`buildCastPrompt`、`buildCastEditPrompt`、**`buildCastActionPrompt`** |
| `bgm.ts` | 65 | **背景音轨确定性注入**：按 `project.audioFile` 重写 `index.html` 里的 `<audio id="myv-bgm">`（先摘后插，幂等） | `BGM_TAG_ID`、`insertHtmlSnippet`、`escapeRegExp`、`stripInjectedBgm`、`stripAudioOfFile`、`applyBgmToHtml` |
| `previewScript.ts` | 159 | **预览副本控制脚本**：纯字符串常量，响应父页 `postMessage`、300ms 上报、载入后冻结在第 0 帧 | `HG_PREVIEW_CTRL` |
| `progress.ts` | 45 | **进度文案与推送**：Agent 阶段 → 中文文案（带「第 k/N 章」前缀），并按 `taskId` 推回发起方 | `progressText`、`progressSender`、`pushStatus` |
| `htmlWrite.ts` | 127 | **Agent 产出落盘**：单文件 `index.html`、章节骨架、**角色副本同步**与角色勾选变化后的页面刷新；含随包库本地化兜底、`core.js` 版本同步、HyperFrames 合规检查 | `syncCoreLib`、`writeSingleHtml`、`syncProjectCast`、`applyCastToHtml`、`refreshCastInPage`、`writeChapterSkeleton` |
| `chaptersFlow.ts` | 192 | **章节化两条流程**：逐章生成（N 次调用、**全部成功才落盘**）与两段式改稿（先路由、再定向编辑；**角色不在这条链路上**） | `generateByChapters`、`applyChapterEdit` |
| `ipc/project.ts` | 121 | **项目生命周期频道**（9 个 handle）：列表、新建、载入、存字幕、存内容脚本、导出 SRT、打开项目目录、打开指定路径所在目录、删除 | `registerProjectIpc(ctx)` |
| `ipc/html.ts` | **247** | **HTML 类频道**（6 个 handle）：生成、按需求修改、下载、读取、预览副本、手写保存 | `registerHtmlIpc(ctx)` |
| `ipc/media.ts` | 218 | **素材 / 音频 / 视频类频道**（10 个 handle）：成品回写、渲染档位、画布、选音频 / 设音频 / 清音频、选素材 / 加素材 / 回写素材、从视频提取音轨 | `FFMPEG_PACKS`、`registerMediaIpc(ctx)` |
| `ipc/cast.ts` | 223 | **角色本身**（**7 个 handle**）：全局角色库 6 条（`cast:*`）+ 本片勾选 1 条（`project:save-cast`） | `registerCastIpc(ctx)` |
| **`ipc/castActions.ts`** | **154** | **动作与动作示范**（**5 个 handle**，全部 `cast:*`）：列 / 存 / 删 / **AI 生成**（唯一调模型的动作路径）/ **会动的示范页** | `registerCastActionIpc(ctx)` |
| `register.ts` | **19** | **只做装配**：把 `ctx.getWindow` 包一层（缺省返回 `null`），再按固定顺序调五个域的注册函数（角色那组拆成两支：角色本身 + 动作示范） | `register(ctx?)` |

### 1.1 项目目录里有什么（`index.ts` 顶部说明）

`index.ts` 的文件头保留了「每个项目目录里有什么」的说明（逐字）：

```ts
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本（**唯一正文**）
//   content.json  内容脚本 { style, scenes }（**唯一正文**）
//   index.html    由脚本/字幕生成的 HTML composition
//   project.json  **只有索引**：name/title/subtitleCount/htmlPath/videoPath/audioFile/
//                 materials/render/canvas/时间戳 等小字段；不含字幕与脚本正文
//   images/       图片素材（HTML 生成用，project.json 的 materials 以相对引用登记）
//   video/        视频素材（同上）
//   cast/         **角色副本**：本片勾选的全局角色（<userData>/cast-library/）在生成前被复制到这里，
//                 因为预览协议与渲染静态服务器只放行项目目录内的文件；界面上不可编辑
```

三条要点：① `project.json` **只是索引**（`ProjectIndex`），正文分别在 `subtitle.txt` 与 `content.json`；② 老项目的内联 `subtitle` / `content` 只当回退来源，下一次 `writeProject()` 自动把正文落到文件并从索引里剥掉（**没有迁移脚本**）；③ 所有素材 / 音频 / 成品路径都记**项目内相对引用**（`images/…`、`video/…`、`audio/…`），项目目录可整体搬走。

### 1.2 依赖方向（单向、不成环）

```
paths.ts（最上游，只拼路径）
  ├─→ store.ts ──→ bgm.ts
  ├─→ store.ts ──→ prompts.ts
  ├─→ materials.ts ──→ prompts.ts
  └─→ previewScript.ts（叶子：纯字符串常量，不 import 同目录任何模块）
store.ts / materials.ts / prompts.ts / bgm.ts ──→ htmlWrite.ts
htmlWrite.ts ──→ chaptersFlow.ts
chaptersFlow.ts / htmlWrite.ts ──→ ipc/*.ts ──→ register.ts ──→ index.ts
```

- `paths.ts` 在最上游，只依赖 `electron` / `node:path` / `node:fs`，**没有任何同目录 import**（`castLibraryRoot()` / `castPreviewDir()` 只拼 userData 路径，不依赖角色模块）。
- `store.ts` 从 `./paths` 取路径、从 `shared/constants` 取估时函数，**并 `import * as cast from '../cast'`**（`readLibrary` 补全元数据）。
- `materials.ts` 只从 `./paths` 取项目目录。
- `prompts.ts` 读 `./materials`（`normalizeMaterials`）与 `./store`（`readProject` / `readSubtitle`），**不写盘、不调模型**；它还从 `../cast` 取 `castRelPath` / `castOutlineText` 拼角色块。
- `bgm.ts` 读 `./paths` 与 `./store`（`readProject` 只取 `audioFile`）。
- `htmlWrite.ts` 是「落盘层」：从 `./bgm` / `./paths` / `./prompts` / `./store` 取助手，并调 `../agent` / `../chapters` / `../cast` / `../coreLib` / `../hfEnv`。
- `chaptersFlow.ts` 调 `./htmlWrite` / `./prompts` / `./progress` / `./store` / `./paths`，以及 `../agent` / `../chapters` / `../cast` / `../editRoute`。
- `ipc/*.ts` 是唯一注册 `ipcMain.handle` 的一层，全部依赖上面这些文件；`register.ts` 只依赖五个 `ipc/*`；`index.ts` 只依赖 `paths` / `store` / `materials` / `register`。
- **上游不 import 下游**：`paths` / `store` / `prompts` / `bgm` 里没有任何 `ipc/*`、`register`、`index` 的 import，所以不会成环。
- `previewScript.ts` 与 `progress.ts` 是**零同目录 import** 的两个叶子。

### 1.3 `prompts.ts` 的五份 prompt（本轮新增动作脚本）

| 函数 | 服务的界面入口 | 用户消息里有什么 |
| --- | --- | --- |
| `buildAgentPrompt(parts)` | 「HTML生成」页 ·「生成 HTML」（单文件） | 把拼好的各块用空行连起来 |
| `buildPlanPrompt(requirement, proj, sub)` | 同上，结构规划 | 【需求】+【内容脚本】+【画布】+【字幕窗口】等；输出只有 `mode` + `chapters` |
| `buildChapterPrompt(opts)` | 同上，逐章生成 | 本章契约 +【项目角色】+ 上一章衔接 + 本章字幕窗口 |
| `buildCastPrompt(opts)` | 「角色」页 ·「新建角色」 | 【角色任务】+【角色文件】+【角色设定】+【身高】+【画风】+【全片角色表】+【本角色随包库】+【往哪画】 |
| `buildCastEditPrompt(opts)` | 「角色」页 · 卡片「…」·「改画法…」 | 上面那份的「改」版本：+【本次改动】+**【关节】**（放在【本角色随包库】之后、【当前角色源码】之前）+【当前角色源码】(`<<<CURRENT cast/<id>.js>>>…<<<END CURRENT>>>`)，要求交回整份新文件、id 与身高不变。**【关节】原文**（6 行字符串拼接，成文为）：「【关节】手臂的枢轴 = **手臂宽度中心 · 从手臂顶部往下半个手臂宽**（即：手臂横跨 x=±1..±2，枢轴取中线 x=±1.5、y = 肩线 -6 往下 0.5u = -5.5；盒子局部 x 取 -0.5..0.5、y 取 -0.5..2.5）。抬手到 90° 时手臂的**中线压在肩线上**、上沿只比肩线高约 0.03u（几乎贴齐），臂根也不悬空、**手臂画在躯干之前（身体优先），抬手时手臂不会盖住身体**；静止时与"手臂紧贴身体外侧"的画法逐像素相同。**别把枢轴放在肩线上**（那就是头底/下巴那条线，抬到 86°~100° 时臂根会翘到下巴上，实测踩过），也**别放到肩线下一整个手臂宽**（抬起来手臂会糊到上胸、显得太低），更**不要**用补角 / 长条形肩垫 / 给身体加肩宽来补缝。腿仍按髋部中心转（腿也画在躯干之前，顶部越界会被躯干盖住）。」——它服务的是「用户拿着一个已有角色说『手抬起来会跟身体分开 / 像从头上长出来』」这条最常见的改画法诉求 |
| **`buildCastActionPrompt(opts)`** | **「角色」页 · 动作示范弹窗 ·「AI 生成…」** | 用户需求 +【动作任务】+【时长】（`t` 的范围 `0 ≤ t < duration`）+【角色设定】+【角色源码】（`<<<CURRENT cast/<id>.js>>>…<<<END CURRENT>>>`，让它先读懂这个角色真的读哪些 `o` 参数）+【输出格式】（`<<<ACTION>>> function (t) { return { … }; } <<<END ACTION>>>`） |

- **动作脚本为什么也要发角色源码**：每个角色自己实现的 `o` 参数不止通用那几项（猫的尾巴、四只脚、手持道具），只有看过源码才知道它认哪些键、方向与量级怎么给——这正是「AI 生成专属动作」比通用关键帧强的地方。
- 这五份都是**纯字符串**：不调模型、不写盘；模型调用分别在 `ipc/html.ts` / `ipc/cast.ts` / `ipc/castActions.ts`。

## 2. 对外接口（全部挂在 `index.ts` 上）

### 2.1 十三个值与四个类型

| 名称 | 定义在 | 说明 |
| --- | --- | --- |
| `register(ctx?)` | `register.ts` | 装配入口：`const deps: RegisterCtx = { getWindow: (ctx && ctx.getWindow) \|\| (() => null) }`，随后依次 `registerProjectIpc(deps)` → `registerHtmlIpc(deps)` → `registerMediaIpc(deps)` → `registerCastIpc(deps)` → **`registerCastActionIpc(deps)`**。注册顺序不影响行为（频道互不重复） |
| `projectsRoot()` | `paths.ts` | `path.join(app.getPath('userData'), 'projects')`，**函数**（每次重新求值）；调用点不得缓存成模块级常量 |
| `projectDir(name)` | `paths.ts` | 项目目录；`name` 中 `[\\/:*?"<>\|]` 替换为 `_` |
| `projectFilePath(name, file)` | `paths.ts` | `path.join(projectDir(name), file)` |
| `readProject(name)` | `store.ts` | **只读索引**：`project.json` 缺失或 `JSON.parse` 失败返回 `null`，不做规范化（`cast` 这时还是磁盘上的 `[{ id, selected }]`） |
| `writeProject(proj)` | `store.ts` | 刷新 `updatedAt` → **先把正文落盘** → 剥掉 `subtitle` / `content`、**把 `cast` 裁成 `[{ id, selected: selected !== false }]`**，只写索引 |
| `ensureProject(name)` | `store.ts` | 索引 + 两个正文文件拼成完整 `Project`，并 `cast: resolveProjectCast(index.cast)`；索引缺失返回默认项目；**不落盘** |
| `scanProjects()` | `store.ts` | 扫描项目根各子目录，`readProject` 为 `null` 者跳过；按 `updatedAt` 倒序 |
| `parseSubtitle(text)` | `store.ts` | 解析 `[分:秒] 文本` / `[分:秒-分:秒] 文本` 与纯文本自动估时（`estimateSubtitleDur()`） |
| `normalizeContent(raw)` | `store.ts` | 内容脚本规范化：`style` 非字符串置空、场景只留 `id` / `narration` / `visual` / `durHint` 并补 `id` |
| `copyAudioIntoProject(name, audioPath)` | `store.ts` | 复制进 `audio/`（重名追加 `_1`…`_1000`），返回 `audio/文件名`；失败返回 `''` |
| `copyMaterialIntoProject(name, kind, srcPath)` | `materials.ts` | 按 `MATERIAL_DIR[kind]` 复制进 `images/` 或 `video/`，返回相对引用；失败返回 `''` |
| `normalizeMaterials(raw)` | `materials.ts` | 素材列表规范化（读盘与写盘共用）：kind 只认 `image` / `video`、`file` 必须在项目素材目录下且不含 `..`、补 `id`、`selected` 缺省 `true`、条数截到 `MAX_MATERIALS` |
| `ContentScript` / `Project` / `Scene` / `SubtitleLine` | `../../shared/types` | 只是**类型再导出** |

**不在 `index.ts` 上、只在目录内部用的导出**（外部拿不到）：`paths.ts` 的 `contentFilePath` / `resolveVideoAbs` / `castLibraryRoot` / `castPreviewDir`；`store.ts` 的 `readSubtitle` / `readContent` / `writeContent` / `normalizeCastSelections` / `resolveProjectCast`；`materials.ts` 的一整套；`prompts.ts` 的 15 个拼装函数；`bgm.ts` 的 6 个名字；`previewScript.ts` 的 `HG_PREVIEW_CTRL`；`progress.ts` 的 3 个函数；`htmlWrite.ts` 的 6 个函数；`chaptersFlow.ts` 的 2 个流程；**五个 `registerXxxIpc`** 与 `FFMPEG_PACKS`。**「对外 13 个」是拆分前 `projects.ts` 末尾那份 `export { … }` 清单，不是这 16 个文件导出名的总和。**

### 2.2 `project:*` 与 `cast:*` 频道

| 域文件 | 数量 | 频道 |
| --- | --- | --- |
| `ipc/project.ts`（`registerProjectIpc`） | 9 | `project:list`、`project:create`、`project:load`、`project:save-subtitle`、`project:save-content`、`project:export-srt`、`project:open-folder`、`project:open-folder-of`、`project:delete` |
| `ipc/html.ts`（`registerHtmlIpc`） | 6 | `project:generate-html`、`project:modify-html`、`project:download-html`、`project:read-html`、`project:preview-html`、`project:save-html` |
| `ipc/media.ts`（`registerMediaIpc`） | 10 | `project:save-video`、`project:set-render`、`project:set-canvas`、`project:pick-audio`、`project:set-audio`、`project:clear-audio`、`project:pick-media`、`project:add-materials`、`project:save-materials`、`project:extract-video-audio` |
| `ipc/cast.ts`（`registerCastIpc`） | **6 + 1** | `cast:list`、`cast:create`、`cast:recreate`、`cast:save-meta`、`cast:remove`、`cast:preview`（全局角色库，与项目无关）+ `project:save-cast`（本片用哪几个） |
| **`ipc/castActions.ts`（`registerCastActionIpc`）** | **5** | **`cast:action-list`、`cast:action-save`、`cast:action-remove`、`cast:action-generate`、`cast:demo`**（见 §2.3） |
| `progress.ts`（推送） | 1 路 | `project:html-progress`：`progressSender(event, { taskId })` / `pushStatus(event, text, …)` 用 `event.sender.send` 发给**发起调用的那个窗口**，`taskId` 必填（生成 HTML、画角色、编动作可以并行） |

> 计数口径：`shared/ipc.ts` 的 `Project` 组是 **27 条**（26 个 handle + 1 条推送）、`Cast` 组 **11 条**（角色 6 + 动作 5）；preload 侧对应 `projectTools` 与 `castTools` 两个命名空间。

### 2.3 `ipc/castActions.ts` 的五条频道（动作示范）

**界面上在哪**：「角色」页 · 卡片双击（或右上「…」菜单 ·「动作示范…」）→ 动作示范弹窗（左会动的大图、右动作列表 + AI 面板）。

| 频道 | 载荷 | 回执 | 行为要点 |
| --- | --- | --- | --- |
| `cast:action-list` | `{ castId }` | `{ ok, shared, own }` | `cast.listActionsFor(castLibraryRoot(), castId)`：`shared` = 内置 14 条 + 用户自建公共动作，`own` = 这个角色的专属动作 |
| `cast:action-save` | `{ castId, scope: 'shared' \| 'own', action }` | `{ ok, action }` | `scope` 缺省按 `shared`；`action.id` 为空 = **新建**，由主进程 `cast.nextActionId(takenIds(scope, castId))` 起 id（渲染层不用自己编 id）；落盘走 `cast.upsertAction`（同 id 就地替换，超 40 条拒绝） |
| `cast:action-remove` | `{ castId, scope, actionId }` | `{ ok }` / `{ ok: false, message }` | `cast.removeAction`；专属动作要带 `castId` |
| `cast:action-generate` | `{ castId, taskId, request, duration?, loop?, name? }` | `{ ok, action }` | **唯一会调模型的动作路径**：校验 `taskId` / 角色 id / `request` → `readLibrary` 找角色 + `readMemberCode` 读源码（缺了直接回人话错误）→ `buildCastActionPrompt({ member, code, request, duration })` → `chatWithCastAction`（进度按 `taskId` 推送，日志 `html-agent/cast-action.jsonl`）→ `parseCastActionReply` → `validateActionCode` → 组一条 `{ id: nextActionId(...), name, duration, loop, code, from: 'ai' }` → `upsertAction(root, 'own', id, …)`（**只存专属**，因为它可能用了角色自己的参数） |
| `cast:demo` | `{ id, units?, title?, uses? }` | `{ ok, rel }` | 读库里的角色代码 + 内置 `core.js`（`hfEnv.coreSource()`，与项目无关）+ `listActionsFor` 的全部动作（`[...shared, ...own]`）→ `cast.buildCastDemoHtml` → 写 `<userData>/cast-preview/<id>.demo.html` → 回 `rel`（形如 `cast-preview/hero.demo.html`）。`uses` 里含 `p5` 时给水彩提示 |

- **时长口径**：`durationOf()` 把 `duration` 夹到 `CAST_ACTION_DURATION.min`–`max`（0.3–30 秒、两位小数），非法值落回 **2 秒**；`name` 取不到就用 `request`，截到 `CAST_ACTION_NAME_MAX`（12）。
- **示范页一次落盘、演所有动作**：动作表整份内联进页面，换动作只改 URL 的 `#hash`（渲染层 `CastDemoShot.vue` 负责），所以 `cast:demo` 只在打开弹窗 / 角色重画 / 动作增删时调。
- **不碰项目**：动作存 `<userData>/cast-library/actions.json`，示范页存 `<userData>/cast-preview/`，两者都属用户资产，与当前项目无关。

## 3. 关键流程都落在哪个文件

### 3.1 生成 HTML：先规划，再走单文件或逐章（`ipc/html.ts` + `chaptersFlow.ts` + `htmlWrite.ts`）

```
「HTML生成」页「生成 HTML」→ project:generate-html（ipc/html.ts）
  ├─ 校验 name / prompt / taskId（缺 id 直接回内部错误，不静默丢进度）
  ├─ ensureProject（按 id 从库补全 cast，无迁移）→ resolveMaterials → buildMaterialPrompt(...)
  ├─ pushStatus('正在判断整片结构（单文件 / 章节化）…') → chatWithChapterPlan(buildPlanPrompt(...))
  ├─ chapters.parsePlanReply(reply, validSceneList(proj.content).length)
  ├─ 判 chapters → generateByChapters({ …, castList: cast.selectedMembers(proj.cast) })
  │     ├─ 逐章 chatWithChapter(buildChapterPrompt(...))，一章一个 pages/cNN.js
  │     ├─ chapters.validateChapterCode 不通过就整轮失败（不留半支片）
  │     └─ chapters.writeChapterFiles → writeChapterSkeleton（syncCoreLib + syncProjectCast + 骨架）
  └─ 判 single / 规划解析失败 → chatWithCustomModel → writeSingleHtml（htmlWrite.ts）
        ├─ extractHtmlFromReply → localizeVendorHtml → ensureVendorFiles（失败则退回 CDN）
        ├─ applyCastToHtml（**先 syncProjectCast 把副本放到位**，再注入 core.js + 被勾选角色，幂等）
        ├─ 写 index.html → htmlPath / 置空 videoPath / 清空并删孤儿 chapters → writeProject（cast 裁成 id+selected）
        └─ applyBgmToHtml → isHyperframesComposition 判 compatible
```

- **规划失败不拦路**：`parsePlanReply` 解析不出就按单文件继续，只多一句 `pushStatus('章节规划未能解析…改用单文件模式生成…')`。
- **规划回复里没有角色**：只取 `cast.selectedMembers(proj.cast)`（本片勾选）交给骨架 / 单文件提示词。
- **章节模式「全部成功才落盘」**：任何一章失败立即返回错误，不写 `pages/`、不写骨架。

### 3.2 按需求修改：单文件一条路、章节两条路（`ipc/html.ts` + `chaptersFlow.ts`）

| 产物形态 | 流程 | 落盘 |
| --- | --- | --- |
| 章节模式（`proj.chapters` 非空） | `applyChapterEdit()`：① **路由**——只发大纲 + 角色表 + 用户的话，`chatWithRoute` → `parseRouteReply`（**白名单只剩 `pages/cNN.js`**，解析失败回退成发全部源码）；② **定向编辑**——只读被点名的章节源码，`chatWithChapterEdit` 只交改动过的章节文件 | 校验通过的章节写 `pages/`，随后 `writeChapterSkeleton()` 重生成骨架（顺带同步角色副本）。**模型吐的 `cast/*.js` 文件块一律忽略**；一个章节文件块都没有时直接报错 |
| 单文件模式 | `ipc/html.ts` 直接读 `index.html` 全文 → 拼 `cast.buildCastTableBlock(allCast)`（只读角色表）→ `chatWithHtmlEdit`（system 是 `agent/htmlEdit.ts` 的 `HTML_AGENT_EDIT_SYSTEM`） | `cast.stripCastFileBlocks` 剥掉万一冒出来的角色块 → **回复里没有 HTML 就报错** → 有 HTML 才 `writeSingleHtml` |

- 章节模式的骨架 `index.html` **模型永远不写**——由 `writeChapterSkeleton()` 按当前章节清单确定性生成。
- **两条路都改不了角色**：角色只有全局一份，新建 / 改画法在「角色」页（`cast:create` / `cast:recreate`）。

### 3.3 Agent 产出落盘（`htmlWrite.ts`）

| 函数 | 落盘行为 |
| --- | --- |
| `writeSingleHtml({ name, proj, reply })` | 提取 HTML → 本地化随包引用 → `applyCastToHtml`（内含副本同步）→ 写 `index.html` → 更新索引 → 补音轨 → 返回 `compatible` |
| `writeChapterSkeleton(name, proj, list, castList)` | 先 `syncCoreLib` → **`syncProjectCast(dir, castList)`** → `chapters.buildSkeleton({ chapters, canvas, total, cast })` → 本地化 / 兜底 → 写 `index.html` → 写 `proj.chapters` / `proj.cast` → 补音轨 |
| `syncProjectCast(dir, castList)` | 本文件的薄封装：`cast.selectedMembers(castList)` 取勾选 id，调 `cast.syncProjectCast(castLibraryRoot(), dir, ids)`（复制勾中的、删掉「库里有但这次没勾」的副本，**不删库里没有的 id**） |
| `applyCastToHtml(html, proj, dir)` | **先**同步副本（顺序反了就是 404），再只注入**勾选参与本次生成**的角色 + `core.js`；没勾任何角色时**只把上次注入剥掉、不塞 `core.js`** |
| `refreshCastInPage(name, proj)` | 角色勾选变了之后：章节模式重写骨架；单文件模式读回 `index.html`、重新注入、**有变化才写盘**；最后 `writeProject(proj)` |
| `syncCoreLib(projDir)` | 把 `hfEnv.coreSource()` 交给 `coreLib.syncCoreTo`（版本一致 + 文件在就什么都不做） |

### 3.4 角色：勾选、同步、静态预览（`ipc/cast.ts` + `htmlWrite.ts` + `store.ts`）

- **身高口径（`ipc/cast.ts` 的 `unitsOf`）**：1–30、保留一位小数，非法值落回 8——与 `cast/library.ts` / `cast/table.ts` 的规范口径一致。
- **勾选（`project:save-cast`）**：载荷 `{ name, cast: [{ id, selected }] }` → `normalizeCastSelections` 规范化 → 按 id 从库补全 → `proj.cast = next` → **先同步副本** → `refreshCastInPage` 重刷页面 → 回 `{ ok, cast }`。
- **注入**：`applyCastToHtml()` → `cast.injectCastTags(html, rels, { withCore: true })`——整组插在模型自己的第一个 `<script>` 之前，带 `data-myv-*` 标记、注入前先整组剥掉（幂等）。
- **静态预览（`cast:preview`）**：只读库里那份代码 → 取内置 `core.js`（**不读某个项目目录**）→ `cast.buildCastPreviewHtml` → 写 `<userData>/cast-preview/<id>.html` → 回 `{ ok, rel }`；**不改 `cast/` 里任何文件**。
- **没有旧数据迁移**：角色库是本版本新引入的结构，还没有对外发布、也没有旧用户数据。

### 3.5 动作：列表 / 编辑 / AI 生成 / 示范页（`ipc/castActions.ts`）

- **入口**：「角色」页 · 卡片双击 /「…」菜单 ·「动作示范…」→ `CastActionModal.vue`（见 [CastPage.md](../renderer/src/pages/CastPage.md)）。
- **列表**：打开弹窗调 `cast:action-list`，拿到 `shared`（内置 + 自建公共）与 `own`（专属）。
- **关键帧编辑器**：弹窗「新建动作…」/ 自建动作的「改」→ `CastActionEditor.vue` → 保存走 `cast:action-save` → `upsertAction`；**不调模型**。
- **AI 生成**：弹窗「AI 生成…」面板 → `cast:action-generate`（§2.3）——这是**唯一**会调模型的动作路径，进度按 `taskId` 订阅 `project:html-progress`，日志 `html-agent/cast-action.jsonl`。
- **示范页**：弹窗左侧那张会动的图 → `cast:demo`（§2.3）→ `CastDemoShot.vue` 把 `userFileUrl(rel) + '&e=<epoch>' + '#' + actionId` 设成 iframe 的 `src`；**换动作只改 hash**，`epoch` 变了（角色重画 / 动作增删）才重设整段地址。
- **不进正片**：动作这一版只做示范；生成 HTML 时角色动画仍由章节按 `t` 自己算。

### 3.6 背景音轨 / 预览副本 / 导出

- **音轨**：`bgm.applyBgmToHtml()` 在多个时机被调——`project:set-audio` / `project:clear-audio` / `project:extract-video-audio`、生成与修改后的落盘、`project:save-html`。标签固定 `id="myv-bgm"`，先摘后插所以幂等；音频**不进提示词**。
- **预览副本**：`project:preview-html` → 去 CSP、本地化随包库、页面引了 `./core.js` 就先 `syncCoreLib` → 注入 `HG_PREVIEW_CTRL` → 写 `index.preview.html`，并从原 HTML 解析 `<html data-resolution>` 作 `pageCanvas` 一起回给渲染层。
- **导出**：`project:download-html` 把章节、**角色副本（`cast.readCastCode(dir, proj.cast)`）**、`core.js` 全部内联，再把 `./gsap.min.js` / `./p5.min.js` / `./p5.brush.js` 换回固定版本 CDN——导出的单文件在别处打开也能独立运行。

### 3.7 角色元数据的真源（`store.ts`）

```
project.json（磁盘）        ensureProject(name)              界面 / 提示词拿到的 Project
cast: [{ id, selected }] →  resolveProjectCast(index.cast) ──→ cast: ProjectCastMember[]（元数据来自库）
```

- **`normalizeCastSelections(raw)`**：把任意形状收敛成 `[{ id, selected? }]`——id 必须过 `CAST_ID_RE`、去重、`selected === false` 才保留 `false`。
- **`resolveProjectCast(raw)`**：先规范化，再按 id 从 `cast.readLibrary(castLibraryRoot())` 取元数据；**库里没有的 id 直接跳过**，最后补 `selected: r.selected !== false`。
- **`writeProject(proj)`**：落盘时把 `cast` 裁成 `[{ id, selected }]`——元数据在库里，项目里再存一份就会两处漂移。
- `cast:list` 同样**纯读**：只 `cast.readLibrary` + 按文件在不在补 `missing`，不写任何东西。

## 4. 拆分对照：哪些是拆出来的、原来叫什么

原 `src/main/projects.ts`（**1909 行**，已删除）整体按「一个文件一件事」拆成上面 16 个文件。**所有 handler 与 helper 的函数体逐字搬移**（脚本断言过拆分前后代码行多重集一致），唯一结构调整是：

| 拆分前（`projects.ts` 单文件） | 拆分后 | 说明 |
| --- | --- | --- |
| `register()` 闭包里的 `const getWindow = ctx.getWindow` | 五个 `registerXxxIpc(ctx: RegisterCtx)` 各自 `const getWindow = ctx.getWindow`；`register.ts` 构造 `deps` | **唯一结构调整**：`register()` 从「注册全部频道」变成「只装配」 |
| `projectsRoot` / `projectDir` / `projectFilePath` / `contentFilePath` / `resolveVideoAbs` / `castLibraryRoot` / `castPreviewDir` | `paths.ts` 同名函数 | 只拼路径、不读写 |
| `readProject` / `readSubtitle` / `readContent` / `writeContent` / `writeProject` / `ensureProject` / `normalizeContent` / `scanProjects` / `parseSubtitle` / `copyAudioIntoProject` / `normalizeCastSelections` / `resolveProjectCast` | `store.ts` 同名函数 | 索引 + 正文的读写与扫描、角色的磁盘形态与补全 |
| `MATERIAL_DIR` / `materialSeq` / `newMaterialId` / `materialKindOf` / `copyMaterialIntoProject` / `normalizeMaterials` / `materialExtsText` | `materials.ts` 同名 | 项目素材库 |
| `buildAgentPrompt` / … / `buildCastPrompt` / `buildCastEditPrompt` / **`buildCastActionPrompt`** | `prompts.ts` 同名 | 提示词纯拼装 |
| `BGM_TAG_ID` / `insertHtmlSnippet` / `escapeRegExp` / `stripInjectedBgm` / `stripAudioOfFile` / `applyBgmToHtml` | `bgm.ts` 同名 | 音轨注入 |
| `HG_PREVIEW_CTRL` | `previewScript.ts` | 原文件里 150+ 行的字符串常量，单独成文件 |
| `progressText` | `progress.ts` 的 `progressText`，并新增 `progressSender` / `pushStatus` | 原文件里的进度文案函数 |
| `writeSingleHtml` / `applyCastToHtml` / `refreshCastInPage` / `writeChapterSkeleton` / `syncCoreLib` / `syncProjectCast` | `htmlWrite.ts` 同名 | 落盘层 |
| `generateByChapters` / `applyChapterEdit` | `chaptersFlow.ts` 同名 | 原文件里的章节流程 |
| `register()` 里的 `ipcMain.handle(...)` | `ipc/project.ts`（9）/ `ipc/html.ts`（6）/ `ipc/media.ts`（10）/ `ipc/cast.ts`（7）/ **`ipc/castActions.ts`（5）** | 按域拆开，每域一个 `registerXxxIpc(ctx)`；**角色那组拆两支**（角色本身 / 动作），因为 `ipc/cast.ts` 已两百多行、再塞五条会越过 300 行建议线，两组职责也不同 |
| 文件末尾的 `export { … }` 清单（13 个） + `export type { … }`（4 个） | `index.ts` 的再导出 | 对外导出面一个不多、一个不少 |

## 5. 注意事项

- **行为与对外接口零变化**：除角色 / 动作那几条新频道外，频道名 / 载荷 / 返回结构 / 提示词文案 / 日志路径都未改；preload 与渲染层只感知 `castTools` 多出的 5 个动作方法。
- **`src/main` 的计数**：`.ts` 现共 **55** 个 = 根目录 **9** 个单文件 + **`cast/` 9 个** + **`projects/` 16 个** + **`agent/` 7 个** + `updater/` 4 个 + `voice/` 10 个（`voice/` 与 `cast/` 同为目录模块）。
- **跨文件共享的模块级 `let`**：`materials.ts` 的 `materialSeq` 仍是 `export let`，但**只有本文件的 `newMaterialId()` 读写**。
- **`resolveVideoAbs` 不在 `index.ts` 上**：它只被 `ipc/project.ts` 与 `store.ts` 的 `scanProjects()` 用。
- **`project:extract-video-audio` 的界面入口已下线**（`MaterialsSection.vue` 的实现整段注释），但频道 / handler / preload 方法原样保留。
- **`project.json` 里的 `cast` 从「完整成员快照」变成「只记 id + 勾选」**：读项目时靠 `resolveProjectCast()` 按 id 从全局库补全，**不要在别处直接读 `index.cast` 当 `ProjectCastMember[]` 用**。
- **三道「无限循环」闸门与本模块的分工**：提示词侧在 `prompts.ts` 的 `buildMaterialPrompt()`；预览侧在 `previewScript.ts` 的 `HG_PREVIEW_CTRL.clock()`；渲染入口那道在 `video.ts`，不在这里。
- **动作不是项目数据**：`cast:action-*` 与 `cast:demo` 只碰 `<userData>/cast-library/actions.json` 与 `<userData>/cast-preview/`，**不读也不写任何项目目录**——所以这些 handler 不需要项目名。
- 相关文档：[agent.md](./agent.md)（提示词与调用包装）、[chapters.ts.md](./chapters.ts.md)（章节纯逻辑）、[cast.md](./cast.md)（角色与动作，9 个文件）、[coreLib.ts.md](./coreLib.ts.md)（`core.js` 同步）、[hfEnv.ts.md](./hfEnv.ts.md)（随包库本地化）、[editRoute.ts.md](./editRoute.ts.md)（改稿路由解析）、[02-目录架构-src-main.md](../../02-目录架构-src-main.md)（主进程总览）。
