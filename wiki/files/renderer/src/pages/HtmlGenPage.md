# src/renderer/src/pages/HtmlGenPage/（页面）

> HTML 生成 / 修改 + **画布（成片尺寸，项目属性：只在本页生成侧选一次）** + 项目素材库（多图片 / 多视频的增删与勾选）+ 背景音频选定（音轨由主进程注入 HTML）+ 实时预览（iframe 视口 = 项目画布，含播放控制与拖动 seek）+ AI 思考过程展示 + **转视频（点按钮先开「渲染档位」弹窗，确认后渲染；弹窗里没有画布）**。

- **覆盖文件**（AGENTS.md 第五节 6：页面自己的子组件与助手并入同一篇）：
  | 文件 | 行数 | 角色 |
  |------|------|------|
  | `HtmlGenPage/index.vue` | 416 | 页面入口：状态条 / 字幕下拉 / **画布下拉** / 需求描述 / 四个动作按钮 / 转视频弹窗；生成与渲染两套动作链 |
  | `HtmlGenPage/MaterialsSection.vue` | 167 | 「项目素材」区块：图片组 / 视频组的卡片墙（勾选、移除、添加） |
  | `HtmlGenPage/PreviewSection.vue` | 353 | 「预览」卡片：背景音频、状态行、AI 思考过程、**只读画布行**、iframe 预览副本（尺寸随画布内联绑定）、播放控制条 |
- **所在目录**：`src/renderer/src/pages/HtmlGenPage/`（一页一目录，入口 `index.vue`）
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：3 个文件合计 936 行（`index.vue` 416 + `MaterialsSection.vue` 167 + `PreviewSection.vue` 353）
- **对外导出**：`index.vue` 默认导出组件（无 props，模板内渲染 `StepBar` / `MaterialsSection` / `PreviewSection`）；两个子组件分别是「无 props / 无 emits」与「4 个 props + `reload()`」

## 1. 作用与职责

本页是流水线的「HTML」环节（`PageKey = 'html-gen'`）：用户填写需求描述并选配项目素材，调用主进程 Agent 生成或修改项目 `index.html`；同时把 Agent 的阶段文案与思考原文实时渲染出来，并在 `hgpreview://` 协议下用 iframe 等比缩放预览产物。

生成侧是**两个并列的按钮**：「生成 HTML」（主按钮，不参考现有页面、从零做一版）与「按需求修改」（次要按钮，在当前页面基础上改一版）。两者的区别不靠按钮文案自适应，而是由**每个动作按钮内部各带一个的行内帮助 `?`**（`.hg-help`，悬浮只显示该动作自己的说明）承载；「按需求修改」在没有 HTML 时直接禁用（仍可用「生成 HTML」从零生成）。**「生成 HTML」点一次即执行，没有二次确认**：已有 HTML 时它会直接覆盖 `index.html`（按钮文案恒为「生成 HTML」，不随状态自适应），要留底稿只能自己先点「下载 HTML」。主进程 `project:generate-html` / `project:modify-html` 两个 handler 未变、也没有合并——界面只是把它们分别挂在两个按钮后面。

**「转视频」也已并入本页**（渲染动作原在独立的视频页，现已整体搬到这里）：动作行多一个「转视频」按钮，**点它先弹出「转视频」弹窗**（`.hf-modal-mask`，内为「渲染档位」：质量 / 帧率 + 档位来源说明 + 画质说明 + 按需出现的「恢复默认档位」），在弹窗里点「开始渲染」才真正发起渲染；渲染成功后就地回写项目并 toast 引导去「视频预览」页看成片。这样做的原因是渲染需要 HTML 生成流程的上下文（`hasHtml` / `htmlPath`），放在同一页即可用同一个按钮闭环；而档位从「页面下方一行常驻控件」改成「弹窗内确认一次」，是为了让选档位 → 确认成为一次显式动作，也避免误改落盘。

### 1.1 三个文件的职责边界

拆分按「一个文件一件事」切（源码注释在 `index.vue:101`、`MaterialsSection.vue:66`、`PreviewSection.vue:59`）：

| 文件 | 只回答一个问题 | 不负责什么 |
|------|----------------|------------|
| `index.vue` | 「这一页要生成 / 修改 / 渲染什么」——项目状态条、字幕素材下拉、**画布（成片尺寸）下拉**、需求描述、四个动作按钮、转视频弹窗与渲染档位、两套动作的状态文案 | 素材的增删勾选（交 `MaterialsSection`）、预览与背景音频/试听（交 `PreviewSection`） |
| `MaterialsSection.vue` | 「这次生成用哪些素材」——图片 / 视频素材库的展示与增删勾选 | 生成流程、预览、渲染；不碰文件系统，全部经主进程 |
| `PreviewSection.vue` | 「产物长什么样」——预览副本 iframe、播放控制与 seek、AI 思考过程展示、背景音频选定与试听 | 发起生成 / 渲染（按钮在父页），因此状态由父页以 props 传入 |

## 2. `index.vue`：模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'html-gen'" />` | 顶部五节点流水线 + 工作项目切换条，`page` 传字面量 `'html-gen'` |
| `.card.hgen-panel`（第 1 张） | 标题仍随状态自适应：`HTML · Agent {{ hasHtml ? '修改' : '生成' }}`（无 HTML 时不出现「修改」字样）；卡片内区块顺序为 **`.proj-meta` 项目状态条 → `.hgen-block`「字幕素材（可选，留空则跳过）」→ `.hgen-block`「画布（成片尺寸）」→ `<MaterialsSection />` → `.hgen-block`「需求描述（提示词）」→ `.hgen-actions` 动作行** |
| `.proj-meta` | 项目状态条（源码注释标为「原 renderMeta 的 `#hg-meta`」），无条件渲染 4 条 `.proj-stat`（数据源 `meta` computed） |
| `.proj-stat`（HTML） | `:class="{ on: meta.hasH }"`，文案 `已生成` / `尚未生成` |
| `.proj-stat`（内容脚本） | `:class="{ on: meta.sceneN > 0 }"`，`meta.sceneN` 为场景数（按 `narration` 非空过滤），文案提示「生成时自动附带」 |
| `.proj-stat`（素材） | `:class="{ on: meta.matN > 0 \|\| meta.subCount > 0 }"`，文案为 `meta.matText`——**一格同时反映字幕 / 背景音频 / 素材库**（见 2.1） |
| `.proj-stat`（用法） | 按 `meta.hasH` 给两种操作引导文案：已有 HTML → 「填写需求后点「按需求修改」（在当前页面上改）；想整页重来点「生成 HTML」（会直接覆盖当前页面，点一次即执行），也可「下载 HTML」备份」；未生成 → 「在「项目素材」里选好素材（可多张图片 / 多个视频，勾选决定这次用哪些），再填写需求描述点「生成 HTML」；背景音频在下方「预览」里选定」 |
| `.hgen-block`（字幕素材） | `.panel-title-sm`「字幕素材（可选，留空则跳过）」+ `.hgen-row`：`span.sel-label`「字幕」+ `HfSelect` `v-model="subSel"` `:groups="subSelGroups"` `title="按所选字幕逐条设计动画"`。**本页素材侧只剩这一处下拉**：视频素材不再是「一个入口的下拉」，改为 `MaterialsSection` 里的素材卡片墙 |
| `.hgen-block`（画布，本次新增） | `.panel-title-sm`「画布（成片尺寸）」+ `.hgen-row`（行内 `style="margin-bottom:0"`）：`label.sel-label`（行内 `style="flex:none;width:40px"`）「画布」+ `HfSelect` `v-model="canvas"` `:groups="canvasGroups"` `:disabled="rendering"` `@change="onCanvasChange"`；下方 `.hgen-tip` 显示 `canvasHint`。**这是画布在全应用里唯一的选择点**（转视频弹窗里刻意没有画布）。源码注释写明它是**项目属性**（不是渲染档位，不进设置页那套「全局默认 / 项目覆盖」）：「它是生成前的版式前提：模型要按这块画布排版式，预览与成片也都用它，所以放在生成这一侧。」 |
| `<MaterialsSection />` | 无 props、无 emits（见第 3 节） |
| `.hgen-block`（需求描述） | `textarea.hgen-subtitle`，`v-model="prompt"`、`spellcheck="false"`、`:placeholder="promptPlaceholder"`；文案随 `hasHtml` 变：已有 HTML 讲「这次要改什么」（换紫色霓虹配色 / 字幕节奏放慢），否则讲「你想要的 HTML 效果」（深空科技风格标题动画页 / 每条字幕间隔两秒依次上浮淡入） |
| `.hgen-actions` | 动作行，顺序固定为：**「生成 HTML」**（`hf-btn hf-btn-primary`，`:disabled="rendering"`，`@click="onGenerate"`，文案恒为字面量 `生成 HTML`，**无 `:title`**）→ **「按需求修改」**（`hf-btn`，`:disabled="!hasHtml \|\| rendering"`，`@click="onModify"`，**无 `:title`**）→ 「下载 HTML」（`onDownload`，`title`「下载当前项目 HTML 到本地」）→ **「转视频」**（主按钮，`:disabled="!hasHtml \|\| rendering"`，`openRenderModal`，`title` 为「把当前 HTML 渲染成 MP4（约 30 秒）」）。**行内帮助 `?` 在 `<button>` 内部、每个动作按钮里各一个**（`<span class="hg-help" @click.stop>` > `.hg-help-icon`「?」 + `.hg-help-pop`），原文照抄：「生成 HTML」按钮内 —「不参考现有页面，从零做一版新的。点一次即开始并覆盖当前页面，想留底稿可先「下载 HTML」。」；「按需求修改」按钮内 —「在当前页面的基础上，按你描述的改一版——换配色、调节奏、改文案都用它。还没生成过 HTML 时不可用。」。**动作行末尾没有独立的 `?`** |
| `<PreviewSection />`（第 1 张卡片之外） | `ref="previewRef"`，四个 props：`:status` / `:status-class` / `:think-text` / `:rendering`（全部来自本页状态），见第 4 节 |
| 「转视频」弹窗（页面级，位于两张卡片之外） | `.hf-modal-mask`（`v-show="renderModalVisible"`，遮罩点击自身关闭 `@click.self="closeRenderModal"`）> `.hf-modal`（行内 `style="width:min(520px,92vw)"`；**样式全部复用 `assets/main.css` 的通用弹窗类，未新增 CSS 类**）：`.hf-modal-head`（`.hf-modal-title`「转视频」+ `.hf-modal-close`「×」，`title`「关闭」）→ `.hf-modal-body`（`.panel-title-sm`「渲染档位」（行内 `style="margin-top:0"`）→ 质量 `.hgen-row`（`label.sel-label`「质量」+ `HfSelect` `v-model="quality"`、`:groups="qualityGroups"`、`:disabled="rendering"`、`@change="onOptionChange"`）→ 帧率 `.hgen-row`（同上，`v-model="fps"` / `:groups="fpsGroups"`）→ 档位来源 `.hgen-row`（`style="margin-bottom:0"`：`.hf-file` 显示 `optionNote` + `v-if="overridden"` 的「恢复默认档位」）→ `.hgen-tip`）→ `.hf-modal-foot`（「取消」`closeRenderModal` / 「开始渲染」（主按钮）`confirmRenderVideo`） |
| `.hgen-tip`（**在弹窗内、档位来源行下方**） | `{{ qualityHint }}` + 「转视频」说明：「把当前 HTML 渲染成 MP4（约 30 秒）；渲染完成后到「视频预览」页查看成品。」|

### 2.1 项目状态条文案（`meta` computed）

```js
const mats = (p && p.materials) || [];
const images = mats.filter((m) => m.kind === 'image').length;
const videos = mats.filter((m) => m.kind === 'video').length;
const picked = mats.filter((m) => m.selected).length;
const subCount = (p && p.subtitleCount) || 0;
const parts: string[] = [];
if (subCount) parts.push('字幕 ' + subCount + ' 条');
if (p && p.audioFile) parts.push('已配背景音频');
if (mats.length) parts.push('素材 ' + mats.length + ' 个（图片 ' + images + ' · 视频 ' + videos + '，参与生成 ' + picked + '）');
```

- `meta` 返回 `{ hasH, sceneN, subCount, matN, matText }`（`hasH` 取 `hasHtml.value`，`sceneN` 统计非空 `narration` 场景数）。
- 三段都为空时 `matText` 恒为「无素材（可先到「字幕生成」页添加字幕，或在上方「项目素材」里添加图片 / 视频）」。
- 与素材库的联动是**自动的**：`MaterialsSection` 每次落盘后调 `refreshProject()`，本 computed 直接读 `appState.project.materials`，因此计数与「参与生成 N 个」无需父页参与。

## 3. `MaterialsSection.vue`：「项目素材」区块

### 3.1 契约：无 props、无 emits（自包含）

源码注释（`MaterialsSection.vue:66`）：

> 自包含：不接 props、不 emit —— 素材状态就是 appState.project.materials（模块级 reactive 单例），每次落盘后调 refreshProject() 刷新，页面上的计数、生成时的取材都自动跟着变。增删改一律经主进程（复制入库 + 规范化 + 上限校验），本组件不直接碰文件系统。

由此推出的三条约定：

1. **状态真源只有一个**：`appState.project.materials`（`computed mats`），本组件不复制一份本地列表；父页的 `meta` computed 也读同一份，所以「素材」格与本组件的 `n / 20` 自动一致。
2. **落盘即刷新**：所有写操作成功（`res.ok`）后都 `await refreshProject()`，再由父页 `index.vue` 的 `runAgent()` 在生成时读 `materials.filter(m => m.selected)` 取 id。
3. **不碰文件系统**：选文件走 `pickMedia`、复制入库与登记走 `addMaterials`、移除与勾选都走 `saveMaterials`（整份列表回写），组件里没有任何 `fs` / 路径拼接逻辑。

### 3.2 模板结构

| 区块 | 说明 |
|------|------|
| `.hgen-block` 根 | 整块在根节点，直接插在父页动作链中间；无 props 因此没有属性透传 |
| `.panel-head` | 左 `.panel-title-sm`「项目素材」+ `<span class="mat-count">勾选的会随需求一起交给 Agent</span>`；右 `.panel-head-actions` 内 `<span class="mat-count" :title="'图片 + 视频合计上限 ' + MAX_MATERIALS + ' 个'">{{ mats.length }} / {{ MAX_MATERIALS }}</span>` |
| `.panel-title`（图片组） | `<span class="dot dot-img"></span>图片 · {{ images.length }} 张`（行内 `style="margin:0;letter-spacing:1px"`；`.dot-img` 用辅色，与视频组的主色点区分） |
| `.mat-grid`（图片组） | `v-for="m in images"` 渲染 `.mat-card`（`:class="{ off: !m.selected }"`）+ 末尾一个 `.mat-add` |
| `.mat-card` 内部 | ① `.mat-check`（`:class="{ on: m.selected }"`、`:disabled="busy"`、`@click="onToggle(m)"`，`title` 随勾选态在「本次生成会带上这张图片（点击取消）」/「本次生成不带这张图片（点击选中）」间切换，内容为 `{{ m.selected ? '✓' : '' }}`）；② `.hf-btn.hf-btn-danger.mat-del`（「移除」，`:disabled="busy"`，`title="从素材列表移除（项目内的文件保留）"`，`@click="onRemove(m)"`）；③ `.mat-thumb` 内 `<img :src="thumbUrl(m.file)" :alt="m.label" />`；④ `.mat-meta` 内 `.mat-name`（`{{ m.label }}`，带 `:title="m.label"`）与 `.mat-path`（`{{ m.file }}`，带 `:title="m.file"`） |
| `.mat-add`（图片组末尾） | `<button class="mat-add" :disabled="busy" title="选择本地图片导入项目（可多选）" @click="onAdd('image')"><i>＋</i>添加图片…</button>` |
| `.panel-title`（视频组） | `<span class="dot"></span>视频 · {{ videos.length }} 个`（行内 `style="margin:16px 0 0;letter-spacing:1px"`） |
| `.mat-grid`（视频组） | 与图片组同构；**缩略图位置不抽帧**，用 `<span class="mat-play">▶</span>` 占位（源码注释：抽帧要额外依赖，收益不抵成本） |
| `.mat-add`（视频组末尾） | `title="选择本地视频导入项目"`，`@click="onAdd('video')"`；紧跟其后是**被注释掉的「提取原声为背景音频」按钮**（见 3.5） |
| `.hgen-tip` | 「勾选的素材会随需求一起交给 Agent：图片按 `images/文件名`、视频按 `video/文件名` 的相对路径写进页面。上限 `{{ MAX_MATERIALS }}` 个（图片 + 视频合计），支持 `{{ extText }}`；「移除」只把素材从列表里摘掉，**项目目录里的文件会保留**。」（`images/` / `video/` 为 `<code>`，加粗为 `<b>`） |

### 3.3 状态与函数

| 名称 | 说明 |
|------|------|
| `busy` | `ref(false)`：一轮写操作未结束时为真，**禁用全部按钮**（避免并发「读-改-写」把列表互相冲掉） |
| `mats` | `computed<ProjectMaterial[]>`：`(appState.project && appState.project.materials) \|\| []` |
| `images` / `videos` | 按 `m.kind === 'image' / 'video'` 过滤出的两个数组 |
| `extText` | `IMAGE_MATERIAL_EXTS.join('/') + ' 与 ' + VIDEO_MATERIAL_EXTS.join('/')`（提示行里的支持格式文案） |
| `thumbUrl(file)` | 缩略图 URL：`return previewUrl(appState.currentName, file)`——拼装统一走 `@renderer/utils/url` 的 `previewUrl()`，产出 `hgpreview://p/<encodeURIComponent(项目名)>/<逐段编码的相对路径>`（**逐段 `encodeURIComponent`、斜杠保持原样**，与主进程 hgpreview 处理器「按段 decode」的口径严格对应）。素材文件本身不变，故**不传 `bust`**（不加时间戳缓存串） |
| `plainList(list)` | 把 reactive 元素铺平成普通对象（见 3.4） |
| `save(list, tip)` | 写盘统一收尾：`busy = true` → `window.projectTools.saveMaterials(appState.currentName, plainList(list))`（`.catch(() => null)`）→ `busy = false` → 失败 toast `res.message` 或「保存素材失败」并返回 `false`；成功 `await refreshProject()`，`tip` 非空再 toast，返回 `true` |
| `onToggle(m)` | `busy` 守卫 → 生成新列表（同 id 的那条改成 `{ ...x, selected: !x.selected }`）→ `save(next, (m.selected ? '已取消参与生成：' : '已设为参与生成：') + m.label)` |
| `onRemove(m)` | `busy` 守卫 → `save(mats.filter(x => x.id !== m.id), '已移除素材：' + m.label + '（项目内文件保留）')` |
| `onAdd(kind)` | `busy` 守卫 → `window.projectTools.pickMedia(kind)`（`.catch(() => [])`，空数组直接返回）→ `busy = true` → `window.projectTools.addMaterials(appState.currentName, paths)`（`.catch(() => null)`）→ `busy = false` → 失败 toast；成功 `await refreshProject()`，toast 优先用 `res.message`（主进程「部分成功」时带回跳过数），否则「已添加图片/视频素材 ×N」 |

### 3.4 两个实现细节（源码注释明确写过）

**① 提交 IPC 前必须铺平 reactive 元素**（`MaterialsSection.vue:89`）：

```js
// 交给 IPC 的必须是**普通对象**：mats 来自 reactive 单例，元素是 Proxy，直接传会在结构化克隆时抛
// DataCloneError（历史事故见 CHANGELOG #11「下载运行环境点了毫无反应」），所以这里显式铺平成新对象。
function plainList(list: ProjectMaterial[]): ProjectMaterial[] {
  return list.map((m) => ({ id: m.id, kind: m.kind, file: m.file, label: m.label, selected: m.selected, addedAt: m.addedAt }));
}
```

**② 缩略图走 `hgpreview://`**（而不是 `file://`），因此 `src/renderer/index.html` 的 CSP 必须放行 `hgpreview:`（`img-src 'self' file: hgpreview: data:`；样式侧见 `assets/main.css` 的 `.mat-thumb` 注释）。URL 的拼装本身在 `utils/url.ts` 的 `previewUrl()` 里，本组件只传「项目名 + 项目内相对路径」。

### 3.5 被注释下线的「提取原声为背景音频」入口

多素材化后「提哪一条视频」需要按素材 id 重做，而主进程 handler 仍读历史字段 `project.videoMaterial`；本轮按用户决定**只隐藏界面入口**：IPC 频道、preload 方法与主进程 handler 一行未改。落地方式是**模板里注释掉按钮 + 脚本里整段注释掉实现**，并写明恢复方式（`MaterialsSection.vue:53`）：

```
<!-- 提取原声为背景音频：入口临时下线（多视频下「提哪一条」要按素材 id 重做，主进程 handler 仍读
     历史字段 project.videoMaterial 且一行未改）。恢复时把下面这行按钮放进本组的 .panel-head-actions：
     <button class="hf-btn" :disabled="!videos.length" title="把视频里的声音提取出来，作为背景音频" @click="onExtractAudio()">{{ extractText }}</button> -->
```

脚本末尾（`MaterialsSection.vue:138-166`）是一整段注释掉的实现，原样如下（含 `useEnvGate` import、`extractText`、`onExtractAudio`）：

```js
// ===== 提取视频原声为背景音频（入口临时下线，恢复时取消注释本段，并把上面模板注释里的按钮放回视频组）=====
// 多素材化后「提哪一条视频」需要按素材 id 重做（主进程 handler 仍读历史字段 project.videoMaterial）；
// 本轮按用户决定只隐藏界面入口：IPC 频道、preload 方法与主进程 handler 一行未改。
// import { useEnvGate } from '@renderer/composables/useEnvGate'
// const envGate = useEnvGate();
// const extractText = ref('提取原声为背景音频');
// async function onExtractAudio(skipEnvGuard = false): Promise<void> {
//   if (!videos.value.length) { toast('还没有视频素材：点「添加视频…」导入'); return; }
//   // 提取音轨要 ffmpeg 包（不随安装包）：缺则先问用户；点「继续」回到这里时不再弹框
//   if (!skipEnvGuard) {
//     const g = await envGate.guard(['ffmpeg'], '提取视频原声', () => { void onExtractAudio(true); });
//     if (!g.ok) return;
//   }
//   extractText.value = '提取中…';
//   const res = await window.projectTools.extractVideoAudio(appState.currentName).catch(() => null);
//   extractText.value = '提取原声为背景音频';
//   if (!res || !res.ok) {
//     const fail = res as { message?: string; needPacks?: ('ffmpeg' | 'hyperframes')[] } | null;
//     if (fail && fail.needPacks && fail.needPacks.length) {
//       toast(fail.message || '需要先下载运行环境');
//       void envGate.guard(fail.needPacks, '提取视频原声', () => { void onExtractAudio(true); });
//       return;
//     }
//     toast((fail && fail.message) || '提取失败');
//     return;
//   }
//   await refreshProject();
//   toast('已提取原声并设为背景音频：' + res.audioFile);
// }
```

> 结论：`project:extract-video-audio` 频道、`projectTools.extractVideoAudio` 与主进程 handler 都还在（**当前界面无入口，属"保留但不可达"**）；恢复时要先解决「按哪条素材提取」这件事（主进程 handler 至今读 `proj.videoMaterial`，该字段本轮起不再写入）。

## 4. `PreviewSection.vue`：「预览」卡片

### 4.1 契约：4 个 props + `defineExpose({ reload })`

```js
const props = defineProps<{
  status: string
  statusClass: string
  thinkText: string
  rendering: boolean
}>();
```

```js
// 父页在 Agent 成功 / 项目状态变化后调用：重新判定并载入预览（原 index.vue 的 syncPreview）
defineExpose({ reload: syncPreview });
```

- **props 单向**：生成与渲染两套状态都归父页写（发起两者的按钮都在父页），本组件只读不改；`status` / `statusClass` 是父页的最终文案与样式，`thinkText` 是流式思考原文，`rendering` 用于判断是否让全局 trace 接管状态行。
- **`reload()` 是唯一对外方法**，父页在两处调用：Agent 成功（`previewRef.value?.reload()`）与生成失败且项目原本无 HTML（同样 `reload()` → 回到「尚未生成」展示）。

### 4.2 模板结构

| 区块 | 说明 |
|------|------|
| `.card.hgen-panel`（`style="margin-top:16px"`） | 标题「预览」；卡片内顺序为**背景音频行 → 试听行（`v-show`）→ `.hf-status` → AI 思考过程 → `.empty-hint` → 只读「画布」行（本次新增）→ iframe 画布 → 播放控制条** |
| 背景音频行（`.hgen-row`） | `span.sel-label`「背景音频」+ `.hf-file`（`escTxt(appState.project.audioFile)` 或「未设置音频」，`:title` 取 `audioFile \|\| '未设置音频'`）+ `HfSelect` `v-model="audioPick"` `:groups="audioSelGroups"` `title="选一份已生成音频作为背景音频"` `@change="onAudioPick"` + 「选择音频文件…」（`onPickAudioFile`，`title="选择本地音频文件作为背景音频"`）+ 「移除音频」（`:disabled="!appState.project?.audioFile"`，`title="移除背景音频"`，`onRemoveAudio`） |
| 试听行 `v-show="audioPreviewVisible"` | `<audio ref="audioEl" :src="audioSrc" controls>` + `label.sel-label`「语速」+ `.rate-spinner`：`−`（`rateStep(-0.05)`）/ `<input ref="rateEl" :value="rateValue" inputmode="decimal" class="hgen-input">`（`@input="onRateInput"`）/ `+`（`rateStep(0.05)`），按钮各自带 `title`（「语速减 0.05」/「语速加 0.05」），输入框 `title`「播放语速 0.5~2.0（非法或空值自动回退 1x）」 |
| `.hf-status` | `:class="statusDisplayClass"`，文本 `statusDisplay`（渲染中优先显示全局 trace，其余为本页传入的 `status`） |
| AI 思考过程区 `v-show="showThink"` | 蓝色描边块，标题「AI 思考过程（实时）」，内为 `<pre ref="thinkPreEl">{{ thinkText }}</pre>`（`max-height:220px;overflow-y:auto`） |
| `.empty-hint` `v-show="emptyVisible"` | 空态 / 失败态提示，文本 `emptyText` |
| 只读「画布」行（本次新增，在预览框之前） | `.hgen-row`（行内 `style="margin-bottom:8px"`）：`span.sel-label`「画布」+ `span.hf-file`（`{{ canvasText }}`，`title="预览与成片都按这块画布"`）+ `span.hgen-tip`（文案「在「HTML · Agent」卡片的「画布」里选择（版式在生成时按它排）」）。源码注释：**画布（只读）：预览 iframe 的视口就是这块画布，成片尺寸与它一致；选择入口在「HTML · Agent」卡片的「画布」处（它是项目属性，只在那一处选）** |
| `.hgen-frame-wrap` `v-show="frameVisible"` | 预览画布容器（`ref="frameWrapEl"`）：**留位比例改为内联绑定** `:style="{ paddingBottom: framePadPct }"`（`framePadPct` = 画布高/宽×100，`toFixed(4)`；横屏 16:9 → `56.2500%`），CSS 里的 `padding-bottom:56.25%` 退化为「挂载前占位的默认值（横屏）」 |
| `iframe.hgen-frame` | `:src="frameSrc"`、`sandbox="allow-scripts allow-same-origin"`、`@load="onFrameLoad"`，**宽高改为内联绑定** `:style="{ width: canvasBox.width + 'px', height: canvasBox.height + 'px' }"`——即 iframe 的**内部视口就是项目选定的画布尺寸**（= 渲染时 HyperFrames 的 composition 尺寸），外层容器按画布宽高比留位、再由 `fitFrame()` 按容器宽度整体 `scale()`，因此预览里看到的版式就是成片里的版式 |
| `.hg-prev-ctl` `v-show="ctlVisible"` | `暂停`/`播放`（`prevToggleText`，`onPrevToggle`）、`重新播放`（`onPrevReplay`）、进度条 `.hg-prev-bar`（`:class="{ seeking }"`、`title="点击或按住拖动进度条，可跳转到任意播放位置"`、`@pointerdown="onSeekStart"` / `@pointermove="onSeekMove"` / `@pointerup="onSeekEnd"` / `@pointercancel="onSeekEnd"`；内层 `.hg-prev-track` 再包 `.hg-prev-bar-fill`，宽度 `prevFillPct`——热区与视觉条分离）、`.hg-prev-time`（`prevTimeText`）、`.hg-prev-hint`（`v-if="!prevPlaying && prevDur > 0 && prevTimeCur < 0.05"`，文案「已暂停在第 0 帧 · 起始帧本就是空的，点「播放」或拖动进度条」） |

### 4.3 状态

| 名称 | 说明 |
|------|------|
| `statusDisplay` | `computed`：`(props.rendering && renderProgress.text) ? renderProgress.text : props.status`——**渲染中状态行让位给全局 trace** |
| `statusDisplayClass` | `computed`：trace 接管时返回 `''`（中性样式），否则返回 `props.statusClass` |
| `frameEl` / `frameWrapEl` | 预览 iframe 与画布容器引用（`fitFrame` 依据后者 `clientWidth` 计算缩放） |
| `canvas` | `computed<RenderCanvas>`（本次新增）：`normalizeCanvas(appState.project && appState.project.canvas)`——**画布是项目属性**（缺省横屏 1920×1080，脏数据/缺省一律落 `DEFAULT_CANVAS`），选择入口在「HTML · Agent」卡片 |
| `canvasBox` | `computed`（本次新增）：`canvasSize(canvas.value)` → `{ width, height }`（画布像素 = composition 尺寸 = 成片尺寸） |
| `canvasText` | `computed`（本次新增）：`canvasLabel(canvas.value) + '（' + canvasBox.value.width + '×' + canvasBox.value.height + '）'`，即只读行显示的「横屏 16:9（1920×1080）」 |
| `framePadPct` | `computed`（本次新增）：`((canvasBox.value.height / canvasBox.value.width) * 100).toFixed(4) + '%'`——容器留位比例 = 高/宽（16:9 → 56.2500%），绑到 `.hgen-frame-wrap` 的 `padding-bottom` |
| `frameVisible` / `frameSrc` / `emptyVisible` / `emptyText` | 画布显隐、iframe 地址（`hgpreview://` URL，由 `previewUrl()` 拼）、空态显隐与文案（初值「尚未生成 HTML。」） |
| `ctlVisible` | 等同 `frameVisible.value` |
| `thinkPreEl` / `showThink` | `<pre>` 引用；`showThink` = `props.thinkText.length > 0`；`watch(() => props.thinkText)` 每次更新把 `<pre>` 滚到底部 |
| `prevPlaying` | `ref(true)` 初值，但 `onFrameLoad()` 会置 `false`（预览**不自动播放**），之后由画面回报的 `playing` 校准 |
| `prevDur` / `prevTimeCur` / `prevFillPct` / `prevTimeText` / `prevToggleText` | 预览总时长、当前时间、进度条宽度百分比、`mm:ss / mm:ss` 文案、按钮文案（`暂停` / `播放`） |
| `seeking` | `ref(false)`：是否正在拖动进度条（拖动期间本地跟手、忽略画面回报） |
| `seekPending` | `ref(false)`：松手后等待画面 `ack` 期间只更新总时长 |
| `seekAckTimer` | `let seekAckTimer = 0`：**模块作用域的普通变量**（非 ref），800ms 兜底定时器，收到 `ack` 或组件卸载时清掉 |
| `audioPick` | `ref('')`：「从已生成音频中选择…」下拉的索引字符串（`''` = 未选），选中即生效、用完立即复位 |
| `audioEl` / `audioSrc` / `audioPreviewVisible` | 试听元素引用、试听源（**`hgpreview://p/…`**，由 `previewUrl(appState.currentName, relFile, true)` 拼，本轮之前是 `file:///`）、试听行显隐 |
| `genAudios` | `ref<GenAudioItem[]>`（`{ path, name, group, size, mtime }`），**仅用于填充下拉**（本页不再有独立的列表 + 试听 + 设为背景音频三件套） |
| `audioSelGroups` | `HfSelect` 选项：首项 `{ value: '', label: '从已生成音频中选择…' }`，其后按 `genAudios` 下标生成 `{ value: String(i), label: it.name + '（' + it.group + '）' }` |
| `rateEl` / `rateValue` | 语速输入框引用与其受控值（`@input` 回写规范化结果） |

### 4.4 函数

| 名称 | 说明 |
|------|------|
| `fmtPrev(sec)` | 秒 → `mm:ss`（`Math.floor`、`padStart(2,'0')`） |
| `prevPost(type, seconds?)` | 向 iframe 的 `contentWindow` 发送 `{ __hg: true, type, seconds }`，目标源 `'*'`；`seconds` 只在 `'seek'` 时给值 |
| `onSeekStart(ev)` | 无 `frameSrc` 或 `prevDur <= 0` 时忽略；置 `seeking = true`、`setPointerCapture(ev.pointerId)`，随即 `seekTo(ev)` |
| `seekRatio(ev)` / `seekTo(ev)` | 按 `clientX` 相对进度条 `getBoundingClientRect()` 求比例（钳制 0~1）；`prevDur <= 0` 直接返回，否则**本地立即**写 `prevTimeCur` 并 `prevPost('seek', sec)` |
| `onSeekMove(ev)` | 仅当 `seeking` 时 `seekTo(ev)` |
| `onSeekEnd(ev)` | 置 `seeking = false`、`releasePointerCapture`，再置 `seekPending = true` 并起 800ms 兜底定时器（在收到画面 `ack` 之前不采信回报） |
| `onPrevMessage(ev)` | 过滤 `d.__hg && d.type === 'progress'`；`d.ack === true` 时清 `seekPending` 与定时器；**拖动中、或 `seekPending` 且本条不是 ack** 时只更新 `prevDur` 并 `return`；否则写 `prevTimeCur` / `prevDur`，按 `d.playing` 校准 `prevPlaying`，播到 `prevDur - 0.25` 时视为自然播完 |
| `fitFrame()` | `frame.style.transform = 'scale(' + (wrap.clientWidth / canvasBox.value.width) + ')'`——**本次由「固定除以 1920」改为按当前画布宽度算**（竖屏 1080 / 方形 1080 各按自己的宽度缩放） |
| `watch(canvas, …)` | 本次新增：画布变了（用户在「HTML · Agent」卡片里改）时容器比例与 iframe 尺寸随 computed 自动更新，缩放比要重算一次（`fitFrame` 读容器宽度），因此 `watch(canvas, () => { void nextTick(fitFrame); })` **等 DOM 更新后再算**，否则量到的还是旧布局 |
| `onFrameLoad()` | 每次载入完成（含 `restart` 引发的 reload）复位 `prevPlaying = false` / `prevDur = 0` / `prevTimeCur = 0` 并 `fitFrame()`；**刻意不主动起播** |
| `onPrevToggle()` / `onPrevReplay()` | 无 `frameSrc` → `toast('暂无预览')`；已自然播完时「播放」等价于从头重播（发 `'restart'`）；否则切换 `prevPlaying` 并发 `'play'` / `'pause'`；「重新播放」恒发 `'restart'` 并置播放态 |
| `loadFrame()` | 调 `window.projectTools.previewHtml(appState.currentName)`；失败则关画布、`emptyText` 取 `res.message` 或「预览副本生成失败」；成功则由 `previewPath` 取文件名（`String(res.previewPath).split(/[\\\\/]/).pop()`，兜底 `'index.preview.html'`），再 `frameSrc.value = previewUrl(appState.currentName, relFile, true)`——**`bust = true` 附 `?v=<Date.now()>` 强制重新加载**（走 `hgpreview://` 而不是 `file://`：dev 的 http 页面下 file:// iframe 会被 Chromium 拦截） |
| `syncPreview()` | 状态联动：`!!(appState.project && appState.project.htmlExists && appState.project.htmlPath)` 成立 → `loadFrame()`；否则关画布、清 `frameSrc`、显示空态「尚未生成 HTML。」——**即对父页暴露的 `reload()`** |
| `setAudioPreview(relFile)` | 参数是**项目内相对路径**（原先收绝对路径）：非空则 `audioSrc.value = previewUrl(appState.currentName, relFile, true)`（`hgpreview://p/…?v=<时间戳>`，时间戳避免看到缓存里的旧音频）并显示试听行，否则清空并隐藏 |
| `afterAudioChange(tip, relFile)` | 设 / 换 / 移除背景音频的统一收尾：`await refreshProject()` → `setAudioPreview(relFile)` → `await loadFrame()`（主进程已同步改写 `index.html` 的音轨，不重载就听不到）→ `toast(tip)`。**两处调用点传的都是主进程回执里的 `res.audioFile`**（项目内相对路径，如 `audio/xxx.mp3`——`setAudio` 已把音频复制进项目 `audio/`），`onRemoveAudio` 传 `''` |
| `onPickAudioFile()` / `onAudioPick()` / `onRemoveAudio()` | 三条入口最终都走 `setAudio` / `clearAudio` + `afterAudioChange`（并传 `res.audioFile`）；`onAudioPick` 先取下标并**立即复位为 `''`**，再从 `genAudios` 取路径 |
| `onRateInput()` / `rateStep(delta)` | `rateValue.value = String(applyRate(rateEl.value, audioEl.value))` / `String(stepRate(rateEl.value, audioEl.value, delta))` |
| `genLoad()` | `window.voiceTools.listGenerated()`（`.catch` 归为 `{ ok: false, message: '调用失败' }`）；**失败静默返回**（下拉留空即可，生成音频不是本页必需），成功写 `genAudios = res.items \|\| []` |
| `onMounted(cb)` | `window.addEventListener('message', onPrevMessage)`、`window.addEventListener('resize', fitFrame)`、`syncPreview()`、`genLoad()`（`resize` 时同样按**当前画布宽度**重算缩放） |
| `onBeforeUnmount(cb)` | 成对移除上述两个 window 监听，并清掉 `seekAckTimer`（`if (seekAckTimer) { window.clearTimeout(seekAckTimer); seekAckTimer = 0 }`） |

> **监听归属**：`message` / `resize` 两个 window 监听与 `seekAckTimer` 都在本组件内注册与清理（拆分前在 `index.vue`）；父页只保留 `document` 级的 `keydown`（转视频弹窗 ESC）。若本组件被卸载，iframe 上报不会再被处理。

## 5. `index.vue`：脚本逻辑

### 5.1 状态

| 名称 | 类型 | 说明 |
|------|------|------|
| `envGate` | `useEnvGate()` 实例 | 运行环境缺包守卫（本页只服务「转视频」，见第 8 节） |
| `configPrompt` | `useConfigPrompt()` 实例 | 配置类错误弹窗（Key 无效 / 余额不足 / 配置不完整…），主进程判好分类，本页只负责触发 |
| `prompt` | `ref<string>` | 需求描述（提示词），生成/修改的入参 |
| `promptPlaceholder` | `computed<string>` | 提示词框的 `:placeholder` 文案，随 `hasHtml` 变（见第 2 节模板表对应行） |
| `subSel` | `ref<string>` | 字幕素材选择值：`''`（不使用字幕）/ `'__current__'`（当前项目字幕）/ 其他项目名 |
| `canvas` | `ref<RenderCanvas>` | **成片画布方向（本次新增，项目属性不是渲染档位）**：初值 `normalizeCanvas(appState.project && appState.project.canvas)`（缺省横屏 1920×1080），挂载时由 `syncCanvas()` 同步；同一个值决定三件事——① 生成提示词里给模型的版式尺寸（主进程 `buildCanvasBlock()`）② 预览 iframe 的画布（`PreviewSection` 直接读 `appState.project.canvas`）③ 渲染入口注入的 `data-resolution`。**没有「设置页默认 → 项目覆盖」那种层级** |
| `canvasGroups` | `computed<HfSelectGroup[]>`（本次新增） | 画布下拉选项：单组，`options` = `RENDER_CANVAS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))`，label 形如「横屏 16:9（1920×1080）」（取自 `@shared/constants`，与提示词同源） |
| `canvasHint` | `computed<string>`（本次新增） | 下拉下方的提示：`'预览与成片都按「' + canvasLabel(canvas.value) + '」这块画布；版式是生成时按画布排的，所以换画布后请重新「生成 HTML」或「按需求修改」，让模型按新画布重排（只换画布不会自动重排已有页面）。'` |
| `subSelGroups` | `computed<HfSelectGroup[]>` | 字幕下拉选项：`'不使用字幕'` + 仅当 `appState.project?.subtitle` 非空时出现的 `'当前项目字幕（N 条）'` + `appState.myProjects.filter(m => m.name !== currentName && m.hasSubtitle)` 的项目字幕（文案 `项目「标题或名」字幕（N 条）`） |
| `status` / `statusClass` / `thinkText` | `ref<string>` | 状态条文本、样式类（`''` / `'hf-ok'` / `'hf-error'`）、AI 思考原文；三者整体传给 `PreviewSection` |
| `meta` | `computed` | 项目状态条数据源，见 2.1 |
| `previewRef` | `ref<{ reload: () => void } \| null>` | 预览子组件引用；**对外契约只有 `reload()`** |
| `agentRunning` | `let agentRunning = false` | **模块作用域普通变量**（非 ref），生成/修改并发互斥标志 |
| `rendering` | `ref(false)` | 转视频进行中标志（禁用三个动作按钮与弹窗里的两个档位下拉），并传给 `PreviewSection` 决定状态行是否让位给 trace |
| `qualityOptions` / `fpsOptions` | 常量 | 直接引用 `utils/render.ts` 的 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` |
| `quality` / `fps` | `ref<RenderQuality>` / `ref<RenderFps>` | 当前所选档位，初值取 `FALLBACK_RENDER`（`standard` / `30`），挂载时按 `effectiveRenderOptions()` 同步 |
| `qualityGroups` / `fpsGroups` | `computed<HfSelectGroup[]>` | 两个档位下拉的选项（`qualityOptions` / `fpsOptions` 映射成单组） |
| `projectOverride` | `computed<RenderOverride \| null>` | 当前项目的覆盖值：`(appState.project && appState.project.render) \|\| null` |
| `overridden` | `computed<boolean>` | `isRenderOverridden(renderDefaults, projectOverride.value)`：覆盖是否真的改变了生效档位 |
| `optionNote` | `computed<string>` | 「本项目自定义档位」或「跟随设置页默认：<档位摘要>」 |
| `qualityHint` | `computed<string>` | 当前所选质量档位的 `hint`（末尾带 `；`），选「快速预览」时明确提示画质代价 |
| `renderModalVisible` | `ref(false)` | 「转视频」弹窗开关（`v-show` 控制 `.hf-modal-mask`） |

### 5.2 函数

| 名称 | 说明 |
|------|------|
| `runAgent(mode)` | 生成/修改主流程（见 6.2）：守卫 → 组装 `materials` 载荷 → 按 `mode` 调 `generateHtml` / `modifyHtml` → 成功后 `refreshProject()` + `previewRef.value?.reload()` |
| `onGenerate()` | 渲染中 → `toast('正在渲染视频，请等它结束再提交需求')` 并返回；否则 `void runAgent('generate')`。**没有二次确认** |
| `onModify()` | `!appState.project?.htmlExists` → `toast('还没有 HTML，先点「生成 HTML」')`（模板已 `:disabled`，这里是兜底），否则 `void runAgent('modify')` |
| `onDownload()` | 只走 `window.projectTools.downloadHtml(appState.currentName)`；按 `ok` / `canceled` / `message` 分支提示 |
| `syncFromEffective()` | `const eff = effectiveRenderOptions(); quality.value = eff.quality; fps.value = eff.fps` |
| `syncCanvas()` | 本次新增：`canvas.value = normalizeCanvas(appState.project && appState.project.canvas)`——项目切换 / 刷新后同步显示值（脏数据落回默认横屏），挂载时与 `onCanvasChange()` 的失败分支都会调 |
| `onCanvasChange()` | 本次新增：`await window.projectTools.setCanvas(appState.currentName, canvas.value)`；失败（`!res.ok`）→ `toast(res.message \|\| '保存画布失败')` + `syncCanvas()` 回滚显示值并返回；成功 → `await refreshProject()` → `syncCanvas()` → `previewRef.value?.reload()`（**预览画布尺寸变了，必须重载 iframe，缩放比按新画布重算**） |
| `onOptionChange()` | 下拉改动 → `await saveProjectRenderOverride({ quality, fps })`（内部走 `project:set-render`）；失败且有 `message` 时 toast |
| `onResetOptions()` | `await saveProjectRenderOverride(null)` 清除项目覆盖；成功则 `syncFromEffective()`，失败且有 `message` 时 toast |
| `openRenderModal()` | 三道守卫（`rendering` / `agentRunning` / `htmlPath` + `htmlExists`）全部通过才 `renderModalVisible = true`（见 6.6） |
| `closeRenderModal()` | `renderModalVisible = false`；供「取消」、「×」、遮罩点击（`@click.self`）与 ESC 共用 |
| `confirmRenderVideo()` | **先关弹窗**再 `void onRenderVideo()` |
| `onModalKeydown(e)` | `document` 级 `keydown`：`e.key === 'Escape' && renderModalVisible.value` 时 `closeRenderModal()` |
| `onRenderVideo(skipEnvGuard = false)` | 转视频主流程（见 6.7） |
| `onMounted(cb)` | 清空 `status` / `statusClass` / `thinkText`；`resetRenderProgress()`；`syncFromEffective()`（渲染档位：项目覆盖 > 设置页全局默认）；**`syncCanvas()`（本次新增：画布显示，项目属性、缺省横屏）**；注册 `onHtmlProgress`；注册 `document` 级 `keydown`（弹窗 ESC） |
| `onBeforeUnmount(cb)` | 只 `document.removeEventListener('keydown', onModalKeydown)` |

## 6. 关键流程

### 6.1 挂载加载（`onMounted`）

1. 复位 `status`、`statusClass`、`thinkText`，避免复用实例时残留上一次会话的文案。
2. `resetRenderProgress()` 清掉上一次渲染的 trace 残留（源码注释：渲染中若再次进入本页，随后仍会被新 trace 覆盖）；`syncFromEffective()` 把档位下拉刷成「项目覆盖 > 设置页全局默认」的生效值；**`syncCanvas()`（本次新增）把画布下拉刷成当前项目的画布值**（源码注释：画布显示：项目属性（缺省横屏））。
3. `window.projectTools.onHtmlProgress((info) => …)` 注册进度回调（preload 侧为**单订阅**：重复注册只替换回调，因此切页不会叠加监听）。回调只用两个字段：`info.text` → `status`（同时清空 `statusClass`）、`info.thinkText` → `thinkText`（`String(info.thinkText || '')`）。
4. 注册 `document.addEventListener('keydown', onModalKeydown)`（弹窗 ESC 关闭）；卸载时在 `onBeforeUnmount` 移除。
5. 预览、已生成音频列表与 iframe 播放控制**不在这里**：`PreviewSection` 自己在 `onMounted` 里 `syncPreview()` + `genLoad()` + 注册 `message` / `resize`。

> 拆分后本页不再注册 `message` / `resize`，也不再清理 seek 定时器——这些随预览整块搬进了 `PreviewSection.vue`。

### 6.2 生成 / 修改 HTML（`runAgent`）

生成侧在界面上是**两个并列的按钮，各自对应一个明确动作**：`生成 HTML`（主按钮 → `onGenerate`）与 `按需求修改`（次要按钮 → `onModify`）。两者的区别写在**每个动作按钮内部各自的 `?`** 里，按钮文案本身不随状态变化。

1. `agentRunning` 为真 → `toast('上一个请求还在处理中，请稍候')` 并返回（重复提交防护）。
2. `rendering` 为真 → `toast('正在渲染视频，请等它结束再提交需求')` 并返回；`prompt.trim()` 为空 → `toast('请先填写需求描述（上方提示词输入框）')` 并返回。
3. 置 `agentRunning = true`，再按 `meta.value.sceneN` 写初始状态文案：有场景为「将附带当前项目内容脚本（N 个场景），已提交给 Agent，处理中...」，无场景为「当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...」，并清空 `statusClass`。
4. 组装本次生成的素材载荷（源码注释：字幕 + 素材库里**勾选**的图片/视频，顺序 = 列表顺序；**音轨不在其中**，主进程在 HTML 落盘后按 `project.audioFile` 注入 `<audio id="myv-bgm">`）：

```js
const materials = {
  subtitleProject: subSel.value,
  materialIds: ((appState.project && appState.project.materials) || []).filter((m) => m.selected).map((m) => m.id)
};
```

5. 按模式调用 IPC：`mode === 'generate'` → `window.projectTools.generateHtml(appState.currentName, p, materials)`；否则 `window.projectTools.modifyHtml(appState.currentName, p, materials)`。
6. 成功（`res.ok`）：`await refreshProject()` → `previewRef.value?.reload()` → `status = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : '')`、`statusClass = 'hf-ok'`，并 toast「HTML 已生成」/「HTML 已修改」。**`refreshProject()` 必须先做**：素材可能与生成过程无关地变了，且预览副本要基于新的 `index.html` 重生成。
7. 失败：`status = res.message || '提交失败'`、`statusClass = 'hf-error'`；随后**按主进程分类分流**——`res.needConfig` 为真时调 `configPrompt.open(msg, res.needConfig, false, res.title)`（`jump = false`：只说明原因，不把用户拽离本页）且**不叠 toast**，否则维持 `toast(msg)`；再判「无 HTML 才恢复空态」：若 `!appState.project?.htmlExists` 则 `previewRef.value?.reload()`（等价于旧的关画布 + 空态）。**余额 / 欠费不在 `needConfig` 之内**，因此仍走 `toast` + 状态行。
8. `finally` 中复位 `agentRunning = false`，保证异常路径也能再次提交。
9. **两个频道的提示词差异（主进程侧）**：`project:generate-html` 的提示词只含需求 + 内容脚本 + 素材（**不含现有页面**）；`project:modify-html` 会把当前 `index.html` 全文作为 `extra` 置于提示词最前（见 [main/projects.ts.md](../../../main/projects.ts.md)）。素材部分由主进程 `buildMaterialBlock()` 按 `materialIds` 生成「【图片素材】/【视频素材】」两段。
10. **素材链路**：添加素材（`pick-media` → `add-materials`）→ 复制进项目 `images/` / `video/` 并在 `project.json` 的 `materials` 里登记 → 卡片上勾选（`selected`，经 `save-materials` 整份回写）→ 生成时提交 `materialIds` → 主进程 `resolveMaterials()` 按 id 过滤 → `buildMaterialBlock()` 拼提示词 → 模型在 HTML 里按 `images/文件名` / `video/文件名` 的相对路径引用。

### 6.3 进度阶段文案与思考原文

1. 主进程 Agent 的 `AgentProgress.stage` 取值为 `'connecting' | 'thinking' | 'writing' | 'retry' | 'done'`，主进程 `progressText` 把它翻成 `正在连接模型…` / `AI 正在推理中…（已思考 N 字符）` / `AI 正在生成 HTML…（已输出 N 字符）` / `本次输出为空，正在升档重试…` / `模型输出完成，正在写入文件…`，随 `IPC.Project.HtmlProgress` 推送。
2. 本页回调写 `status` / `statusClass` / `thinkText`（见 6.1），**展示由 `PreviewSection` 负责**（`.hf-status` 与 `.pre` 都在「预览」卡片里）。
3. 主进程上报时对思考原文做**尾部截断**：`thinkText.slice(-20000)`，即最多 2 万字符的末尾片段；完整思考原文与 `thinkChars` / `contentChars` 会落到 userData 下 `html-agent/chat.jsonl` 供分析。
4. `thinkText` 非空即 `showThink` 为真显示思考区；`PreviewSection` 内的 `watch` 每次更新把 `<pre>` 滚到底部，形成「实时滚动」观感。

### 6.4 生成预览副本与 iframe 载入（`PreviewSection`）

1. `loadFrame()` 调 `window.projectTools.previewHtml(appState.currentName)`；主进程读取项目 `index.html`，注入播放控制脚本后写出同目录 `index.preview.html`（并为副本剥离 CSP），返回 `{ ok, previewPath }`。**页面不调用 `projectTools.readHtml`**，读取发生在主进程内部。
2. 失败（`!res || !res.ok`）：隐藏画布、清空 `frameSrc`、`emptyText` 取 `res.message` 或 `'预览副本生成失败'`。
3. 成功：`relFile` 取 `previewPath` 的文件名（兜底 `'index.preview.html'`），再 `frameSrc.value = previewUrl(appState.currentName, relFile, true)`。源码注释说明两点原因：dev 的 http 页面下 `file://` iframe 会被 Chromium 拦截，故走自定义协议；`bust = true` 附的时间戳强制重新加载。
4. `frameVisible = true`、`emptyVisible = false`；iframe `@load` 触发 `onFrameLoad()` 复位进度并按容器宽度 `fitFrame()`。

### 6.5 预览 postMessage 协议与 seek（`PreviewSection`）

父页 → iframe：`prevPost(type, seconds?)` 发送 `{ __hg: true, type, seconds }`，`type` 取 `'pause'` / `'play'` / `'seek'` / `'restart'`；副本注入脚本收到 `'restart'` 时 `location.reload()`、收到 `'seek'` 时调 `setTime(d.seconds)`（只挪播放头、不改播放/暂停状态，并立刻回一条带 `ack` 的进度），见 [main/projects.ts.md](../../../main/projects.ts.md)。**载入完成后不再发 `'play'`**：预览默认静止。

iframe → 父页：副本每 300ms 以及「冻住后 / seek 后」立刻上报 `{ __hg: true, type: 'progress', time, dur, playing, ack }`（`playing` 是真实播放状态、**已播完不算在播**；`ack` 只在收到 seek 后的那条上报里为 `true`）。

本组件处理（`onPrevMessage`）：只接受 `d.__hg && d.type === 'progress'`；先看 `d.ack === true`——命中就清 `seekPending` 与兜底定时器；随后**拖动中、或「松手后还没等到 ack」时只更新 `prevDur`**，位置与播放状态一律不采信；正常回报则写 `prevTimeCur` / `prevDur`，`typeof d.playing === 'boolean'` 时校准 `prevPlaying`，最后当处于播放态且 `prevTimeCur >= prevDur - 0.25` 时把 `prevPlaying` 置回 false。**拖动本身不改变播放/暂停状态**。

### 6.6 转视频：弹窗确认档位（`openRenderModal` / `confirmRenderVideo`）

**第一步：点「转视频」只开弹窗，不渲染。** 三道守卫，任一不通过就 toast 且**不开弹窗**：① `rendering.value` 为真直接返回（按钮本身也已 `:disabled`）；② `agentRunning` 为真 → `toast('Agent 正在处理 HTML，请等它结束再转视频')`；③ 取 `appState.project.htmlPath`，`!htmlPath || !htmlExists` → `toast('还没有 HTML，请先「生成 HTML」')`。

守卫放在 `openRenderModal` 而不是只放在 `onRenderVideo`，是为了避免「弹窗打开了又被拒」的观感；`onRenderVideo` 内保留同一套守卫，兜住弹窗打开后状态被改的窗口期。

**第二步：在弹窗里确认档位。**（**弹窗里没有画布控件**：画布是全应用唯一一处选择点，在「HTML · Agent」卡片的「画布」区块；弹窗只负责质量 / 帧率这两个渲染档位，画布随载荷由页面状态带下去。）质量 / 帧率两个下拉直接绑定 `quality` / `fps`（`@change="onOptionChange"`，改动**立即**写入项目级覆盖），`.hf-file` 显示 `optionNote`，`v-if="overridden"` 时右侧多出「恢复默认档位」，下方 `.hgen-tip` 是当前质量的画质说明 + 用途说明。关闭有四种：`取消`、`×`、点弹窗外（`@click.self`）、ESC（`onModalKeydown`）——**都只关弹窗，不发起渲染，也不回滚已改的档位**。

**第三步：`开始渲染` → `confirmRenderVideo()` 先关弹窗，再走 `onRenderVideo()`**，见 6.7。

### 6.7 转视频主流程（`onRenderVideo(skipEnvGuard = false)`）

1. 进行中守卫（`rendering`）→ **Agent 忙守卫**（`agentRunning` → toast）→ `htmlPath` / `htmlExists` 校验。
2. `options = { quality: quality.value, fps: fps.value, canvas: canvas.value }`（**本次新增 `canvas`**：质量 / 帧率是渲染档位，`canvas` 是项目属性，一起随载荷下发）；`skipEnvGuard` 为假时先过 `envGate.guard(['ffmpeg', 'hyperframes'], '转成视频', () => { void onRenderVideo(true); })`，`!g.ok` 直接返回（见第 8 节）。
3. `status = '已提交渲染（' + renderOptionsText(options) + ' · ' + canvasLabel(options.canvas) + '，约 30 秒）...'`（**状态文案本次追加了画布标签**）、`statusClass = ''`、`rendering = true`。
4. `await window.hfTools.renderVideo(htmlPath, options)`（`video:render`；主进程按白名单拼 `--quality` / `--fps`）。
5. 返回后先 `resetRenderProgress()`：用本地完成/失败文案覆盖全局 trace 残留（渲染期间状态区优先显示 trace，见 5.4 的 `statusDisplay`）。
6. **成功**：`status = '视频已生成（' + renderOptionsText(options) + ' · ' + canvasLabel(options.canvas) + '）：' + res.outputVideo`（**同样追加画布标签**）、`statusClass = 'hf-ok'`；随后 `await window.projectTools.saveVideo(appState.currentName, res.outputVideo)` → `await refreshProject()` → `toast('视频已生成，可到「视频预览」页查看')`。
7. **缺包分支**（`res.needPacks` 非空）：写失败状态后 `void envGate.guard(res.needPacks, '转成视频', () => { void onRenderVideo(true); })`。
8. **失败**：`status = res.message || '渲染失败'`、`statusClass = 'hf-error'`，并 toast 同一文案。
9. **异常分支**（`catch`）：同样先 `resetRenderProgress()`，再写 `status = '渲染失败：' + message`、`statusClass = 'hf-error'` 并 toast。
10. `finally` 中复位 `rendering = false`。

> 渲染期间弹窗不会重新出现（按钮 `:disabled`）；渲染进度显示在「预览」卡片的状态行（`.hf-status`，`rendering` 为真时由 `PreviewSection` 优先显示 `renderProgress.text`），成品到「视频预览」页看。

### 6.8 渲染档位的同步与项目级覆盖

1. **优先级**：项目级覆盖（`project.json` 的 `render`）> 全局默认（`settings.json` 的 `render` 段）> 内置默认（`standard` / `30`）；覆盖里缺省的字段跟随上一级。合并由 `useRenderOptions.effectiveRenderOptions()` 调 `utils/render.ts` 的 `resolveRenderOptions()` 完成。
2. **下行（读）**：`onMounted` 与「恢复默认档位」成功后都调 `syncFromEffective()`。
3. **上行（写）**：两个下拉的 `@change` 统一走 `onOptionChange()` → `saveProjectRenderOverride({ quality, fps })`（内部 `projectTools.setRender` / `project:set-render`），成功后把返回的 `project.render` 经 `pickRenderOverride` 规范化后写回 `appState.project.render`。**改动即写**，取消弹窗不会回滚已改的档位。
4. **恢复默认**：`onResetOptions()` 传 `null`，主进程删除 `proj.render`；成功后再次 `syncFromEffective()`，`overridden` 变假，按钮随之消失。
5. **无当前项目时不落盘**：`saveProjectRenderOverride` 只在 `currentName` 为空时直接返回 `{ ok: true }`、不发起 IPC。

### 6.9 素材库：添加 / 勾选 / 移除（`MaterialsSection`）

1. **添加**：点「添加图片…/添加视频…」→ `pickMedia(kind)` 打开系统文件框（图片多选、视频见主进程 filters）→ 选中则 `addMaterials(currentName, paths)`：主进程把文件复制进项目 `images/` / `video/` 并登记进 `materials`（新素材**默认参与生成**、落在所属分组末尾），超限或不支持的扩展名会被跳过并带回跳过信息（本组件优先用 `res.message` 作 toast 文案）。
2. **勾选 / 取消**：点卡片左上角的 `.mat-check` → 以 `map` 生成同 id 替换后的新列表 → `saveMaterials` 整份回写。`selected` 是「本次生成是否带上」的开关，**不影响文件、也不影响卡片显示顺序**；未勾选的卡片加 `.off` 整体压暗（仍可读、仍可点）。
3. **移除**：点卡片右上角「移除」 → 从列表里摘掉该 id 后整份回写；**项目目录里的文件保留**（源码 `title` 与 tip 都写明这一点）。
4. **上限与白名单**：`mats.length / MAX_MATERIALS` 常驻显示；上限与扩展名白名单来自 `src/shared/constants.ts`，由主进程 `normalizeMaterials()` 强制执行、渲染层只用于显示与提示。
5. **并发防护**：`busy` 期间所有按钮 `:disabled`，避免两次「读-改-写」互相覆盖。

### 6.10 背景音频：设定 / 更换 / 移除（`PreviewSection`，音轨由主进程注入 HTML）

背景音轨**不经过 Agent**：本卡片只负责「选定哪份音频」，写 HTML 由主进程完成——`project:set-audio` / `project:clear-audio` / `project:extract-video-audio` 在 `writeProject` 之后调用 `applyBgmToHtml()`，按 `project.audioFile` 重写 `index.html` 里的 `<audio id="myv-bgm" src="audio/…" autoplay loop>`（先摘掉本应用注入的旧标签、再摘掉引用同一音频文件的历史标签；幂等，内容无变化时不写盘，无 HTML 时静默返回 `false`）。细节见 [main/projects.ts.md](../../../main/projects.ts.md)。

1. **设定 / 更换**：两条入口（下拉「从已生成音频中选择…」、「选择音频文件…」）最终都走 `setAudio` + `afterAudioChange`。
2. **试听**：`setAudio` 的回执 `res.audioFile` 就是**项目内相对引用**（`audio/xxx`，主进程已把音频复制进项目），`setAudioPreview(relFile)` 直接把它交给 `previewUrl()` 拼 `hgpreview://p/…` 显示 `<audio>` 试听行（语速控件见 6.11）——**本轮之前这里收的是绝对路径并拼 `file:///`**，在 dev 下会被 Chromium 拒（见第 8 节的背景说明）。
3. **移除**：「移除音频」调 `clearAudio(currentName)`：主进程清空 `proj.audioFile` 并把 HTML 里注入的 `<audio>` 一并摘掉，随后同样重载预览（`setAudioPreview('')` 清空试听源）。
4. **与生成 / 修改的衔接**：`project:generate-html` / `project:modify-html` / `project:save-html` 写入 `index.html` 后都会再调一次 `applyBgmToHtml()`；提示词里固定只有一行「【音轨】背景音轨由应用在渲染前自动注入（`<audio id="myv-bgm">`），请勿写入、修改或删除任何 `<audio>` 标签，也不要为音轨预留页面元素。」——**音频不占提示词、也不交给 Agent**。
5. **转视频**：`video.ts` 直接把 `index.html` 所在目录交给 HyperFrames CLI，页面里的 `<audio id="myv-bgm">` 由 CLI 在 trace 阶段提取并混入 MP4。

### 6.11 语速控件（`applyRate` / `stepRate`）

1. `−` / `+` 按钮分别调用 `rateStep(-0.05)` / `rateStep(0.05)`；输入框为 `:value="rateValue"`、`@input="onRateInput"`，`inputmode="decimal"`。
2. 两者都作用于 `utils/rate.ts` 的共享实现：`applyRate(el, audio)` 解析输入值，非有限值回退 1，再钳到 `0.5~2.0`，写回 `el.value` 并设置 `audio.playbackRate`；`stepRate(el, audio, delta)` 按 `Math.round((v + delta) * 100) / 100` 步进后同样钳制。
3. **只改播放 `playbackRate`，不改磁盘音频**；本组件把返回值同步回 `rateValue`。

## 7. 依赖与协作

### 7.1 `index.vue` 的导入

| 依赖 | 用途 |
|------|------|
| `vue`：`computed, onBeforeUnmount, onMounted, ref` | 响应式状态与生命周期（**`watch` 已随预览块移走**） |
| `@shared/types`：**`type RenderCanvas`**、`type RenderFps`、`type RenderQuality` | 档位下拉（`quality` / `fps`）与**画布下拉（`canvas`，本次新增）**的类型标注 |
| `@renderer/composables/useAppStore`：`appState, hasHtml, refreshProject` | 全局项目状态、`hasHtml` 判定、刷新项目列表与详情 |
| `@renderer/composables/useToast`：`toast` | 统一的轻提示 |
| `@renderer/composables/useRenderProgress`：`resetRenderProgress` | 渲染 trace 复位（读 `renderProgress` 的是 `PreviewSection`） |
| `@renderer/composables/useEnvGate`：`useEnvGate` | 转视频的运行环境缺包守卫 |
| `@renderer/composables/useConfigPrompt`：`useConfigPrompt` | 配置类错误弹窗 |
| `@renderer/utils/render`：`FALLBACK_RENDER, RENDER_FPS_OPTIONS, RENDER_QUALITY_OPTIONS, isRenderOverridden, renderOptionsText` + **本次新增 `RENDER_CANVAS_OPTIONS, canvasLabel, normalizeCanvas`** | 档位选项表、默认档位、覆盖判定与档位摘要文案 + **画布下拉选项、画布标签（提示文案与渲染状态文案用）与画布规范化（`syncCanvas()` / `canvas` 初值）** |
| `@renderer/composables/useRenderOptions`：`effectiveRenderOptions, renderDefaults, saveProjectRenderOverride` | 生效档位、全局默认、写入 / 清除项目覆盖 |
| `@renderer/components/StepBar.vue` | 顶部流水线步骤条 + 工作项目切换 |
| `@renderer/components/HfSelect.vue`：`HfSelect`（默认）、`type HfSelectGroup` | 全局自绘下拉组件 |
| `./MaterialsSection.vue` / `./PreviewSection.vue` | 同目录子组件，**相对路径导入**（AGENTS.md 第五节 7） |

### 7.2 `MaterialsSection.vue` 的导入

| 依赖 | 用途 |
|------|------|
| `vue`：`computed, ref` | `busy` 与三个 computed |
| `@shared/constants`：`IMAGE_MATERIAL_EXTS, MAX_MATERIALS, VIDEO_MATERIAL_EXTS` | 上限与扩展名白名单文案 |
| `@shared/types`：`type ProjectMaterial, type ProjectMaterialKind` | 列表元素与 `onAdd(kind)` 的类型 |
| `@renderer/composables/useAppStore`：`appState, refreshProject` | 读素材列表、落盘后刷新全局状态 |
| `@renderer/composables/useToast`：`toast` | 增删勾选与失败提示 |
| **`@renderer/utils/url`：`previewUrl`** | 素材缩略图的 `hgpreview://p/…` URL 拼装（`thumbUrl()`） |

### 7.3 `PreviewSection.vue` 的导入

| 依赖 | 用途 |
|------|------|
| `vue`：`computed, onBeforeUnmount, onMounted, ref, watch` | 响应式状态、生命周期、思考文本自动滚底、**`watch(canvas)` → `nextTick(fitFrame)` 重算缩放（本次新增）** |
| `@shared/types`：**`type RenderCanvas`** | **画布 computed 的类型标注（本次新增）** |
| `@renderer/composables/useAppStore`：`appState, refreshProject` | 读 `audioFile` / `htmlExists` / `htmlPath` 与**成片画布 `canvas`**，音频变更后刷新项目 |
| `@renderer/composables/useToast`：`toast` | 轻提示 |
| `@renderer/utils/escape`：`escTxt` | 背景音频文件名渲染前转义（`& < >`） |
| `@renderer/utils/rate`：`applyRate, stepRate` | 试听语速控件共享逻辑 |
| **`@renderer/utils/render`：`canvasLabel, canvasSize, normalizeCanvas`（本次新增）** | 只读画布行的文案（`canvasText`）、iframe 内联宽高与缩放比（`canvasBox` / `framePadPct` / `fitFrame()`）、画布值规范化（`canvas` computed） |
| **`@renderer/utils/url`：`previewUrl`** | 预览副本 iframe 与背景音频试听的 `hgpreview://p/…` URL 拼装（`loadFrame()` / `setAudioPreview()`，均 `bust = true`） |
| `@renderer/composables/useRenderProgress`：`renderProgress` | 渲染中状态行改显全局 trace |
| `@renderer/components/HfSelect.vue`：`HfSelect`（默认）、`type HfSelectGroup` | 背景音频下拉 |

### 7.4 调用的 preload / IPC

| 方法 | 用途 | 调用点 |
|------|------|--------|
| `previewHtml(name)` | 生成 `index.preview.html` 预览副本，返回 `previewPath` | `PreviewSection.loadFrame` |
| `generateHtml(name, prompt, materials)` | 生成 `index.html`（`materials` = `{ subtitleProject, materialIds }`，**不含音频**；音轨由主进程在落盘后注入） | `index.vue` 的「生成 HTML」按钮 |
| `modifyHtml(name, prompt, materials)` | 基于现有 HTML 改造并覆盖（载荷同上）。提示词含当前 `index.html` 全文 | `index.vue` 的「按需求修改」按钮 |
| `pickMedia(kind)` | 按素材类型打开文件选择框，返回本地绝对路径数组（取消 → 空数组） | `MaterialsSection.onAdd` |
| `addMaterials(name, paths)` | 把所选文件复制进项目并登记进 `materials`，返回登记结果（含被跳过数时的 `message`） | `MaterialsSection.onAdd` |
| `saveMaterials(name, materials)` | 整份素材列表回写（移除与勾选共用） | `MaterialsSection.save` |
| `downloadHtml(name)` | 另存项目 HTML（主进程把 `./gsap.min.js` 换回 CDN 后写出） | `index.vue.onDownload` |
| `pickAudio()` / `setAudio(name, audioPath)` / `clearAudio(name)` | 背景音频选择 / 设置 / 移除；主进程同时改写 `index.html` 里的注入音轨，`setAudio` 回执的 `audioFile`（项目内相对路径）被交给 `previewUrl()` 试听 | `PreviewSection` |
| `extractVideoAudio(name)` | 提取视频原声为背景音频——**本页当前无界面入口**（实现整段被注释，见 3.5），频道与 preload 方法保留 | 无（保留但不可达） |
| `onHtmlProgress(callback)` | 订阅 `IPC.Project.HtmlProgress` 流式进度（单订阅） | `index.vue.onMounted` |
| `setCanvas(name, canvas)` | 调 `project:set-canvas`，写**成片画布方向**（项目属性；白名单校验在主进程，值变化时主进程把 `videoPath` 置空） | `index.vue` 画布下拉（`onCanvasChange`） |
| `setRender(name, render \| null)` | 调 `project:set-render`（经 `saveProjectRenderOverride`），写 / 清除项目级渲染档位覆盖 | `index.vue` 档位下拉 |
| `saveVideo(name, videoPath)` | 调 `project:save-video`，渲染成功后把产物路径回写到项目 `project.json` | `index.vue.onRenderVideo` |
| `window.hfTools.renderVideo(htmlPath, { quality, fps, canvas })` | 调 `video:render`，把当前项目 HTML 渲染为 MP4（**载荷本次新增 `canvas`**：主进程据此往渲染入口注入 `<html data-resolution>`——不传就会被 HyperFrames 兜底成竖屏） | `index.vue.onRenderVideo` |
| `window.voiceTools.listGenerated()` | 已生成音频列表，**仅用于填充背景音频下拉** | `PreviewSection.genLoad` |

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import HtmlGenPage from './HtmlGenPage/index.vue'`，注册为 `pages['html-gen']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行三个组件的 `onMounted`。

## 8. 注意事项与实现要点

- **写入类动作不再有形态守卫**：`runAgent`、`onPickAudioFile`、`onAudioPick`、`onRemoveAudio`、`onAdd`、`onRemove`、`onToggle`、`openRenderModal`、`onRenderVideo` 的入口只剩并发 / 前置条件校验（`agentRunning`、`rendering`、`busy`、`htmlExists`、`currentName` 等），没有「项目是否只读」这一类判断——项目一律是 `userData/projects/<项目名>/` 下可读可写的普通目录。
- **失败提示**：Agent 失败时状态条一律用 `hf-error` 保留原因；**配置类**（`res.needConfig` 为真）额外弹 `useConfigPrompt` 的「去设置」弹窗并**跳过 toast**，其余失败仍 `toast` 同文案；仅当项目原本无 HTML 才 `previewRef.value?.reload()` 恢复空态，避免把「已存在的旧 HTML」误标为未生成。
- **`refreshProject()` 是素材侧唯一的「广播」**：`MaterialsSection` 不接 props，靠刷新 `appState` 让父页状态条与生成载荷同步；因此任何新增写操作都必须以 `await refreshProject()` 收尾。
- **reactive 对象不能直接过 IPC**：`plainList()` 是必须的（DataCloneError），新增素材写操作时不要图省事直接传 `mats.value`。
- **视频缩略图不抽帧**：统一用 `▶` 标记（`main.css` 注释：抽帧要额外依赖，收益不抵成本）。
- **预览缩放实现**：iframe CSS 固定 `1920px × 1080px` + `transform-origin: 0 0`，容器用 `padding-bottom: 56.25%` 撑出 16:9 高度；`fitFrame()` 以容器 `clientWidth / 1920` 设置 `transform: scale(...)`。窗口 `resize` 与每次 `load` 都会重新缩放。
- **思考文本截断**：展示的是主进程 `thinkText.slice(-20000)` 的结果（仅末尾片段），完整原文写入 userData 下 `html-agent/chat.jsonl`。
- **思考区样式与状态样式互斥**：进度回调每次设置 `status` 都会把 `statusClass` 清空，只有最终成功/失败分支才写入 `hf-ok` / `hf-error`。
- **取消 / 重复提交防护**：`agentRunning` 为模块作用域普通变量（非响应式），`try/finally` 保证复位；并发点击「生成 HTML」/「按需求修改」会被直接 toast 拒绝。渲染与 Agent 互斥：渲染中禁用两个按钮与「转视频」，Agent 处理中调 `openRenderModal` / `onRenderVideo` 都会被 toast 拦下。
- **弹窗与页面级监听**：转视频弹窗用的是通用弹窗类（`.hf-modal-mask` / `.hf-modal*`，与「从音频生成字幕」弹窗同一套），**没有新增 CSS 类**，`assets/main.css` 无需为它改动（本轮该文件新增的是素材卡片墙的 `.mat-*` 一节）；弹窗节点写在模板末尾（两张卡片之外），靠 `position: fixed` 覆盖全屏。ESC 关闭走 `document` 级 `keydown`（`onModalKeydown`），必须与 `onMounted` / `onBeforeUnmount` 成对，否则切页后会留下悬挂监听。**iframe 的 `message` / `resize` 监听改由 `PreviewSection` 自己成对管理**（含 `seekAckTimer`）。
- **弹窗不承担「取消档位改动」**：质量 / 帧率下拉的 `@change` 仍然即时落盘，点「取消」只关弹窗、不回滚档位；弹窗的语义只是「确认要开始渲染」。
- **进度订阅的单订阅语义**：`onHtmlProgress` 在 preload 中只绑定一次 `ipcRenderer.on`，后续注册仅替换回调；本页因此只需在 `onMounted` 注册、无需（也无法）取消订阅。
- **播放控制边界**：`ctlVisible` 跟随 `frameVisible`；无 `frameSrc` 时点「暂停/播放」「重新播放」只 toast「暂无预览」。**预览默认静止**：载入完成后不再主动发 `'play'`，`prevPlaying` 置 `false`，按钮文案由画面回报的 `playing` 校准——首帧本来就是空的（合成 `paused: true` + 开头 `opacity: 0`），`.hg-prev-hint` 就是把这句说明写在进度条旁边。
- **进度条拖动跳转（seek）的四条约定**：① 拖动期间不采信画面回报；② 松手后等 `ack`（800ms 兜底）；③ 本地立即跟手，画面侧 `setTime()` 只挪播放头、不改播放/暂停状态；④ 总时长未上报时忽略拖动，并用 `setPointerCapture` 保证拖出控件仍继续收 `pointermove`。
- **预览副本与原件分离**：预览用 `index.preview.html`（剥离 CSP、注入控制脚本），下载与转视频始终使用原件 `index.html`。
- **素材的三种「非破坏性」**：勾选只改 `selected`、移除只改列表、移除后项目文件保留；页面 tip 与按钮 `title` 都向用户明说了这三点。
- **`genLoad()` 失败必须静默**：已生成音频只是下拉的可选项，不是本页必需；`listGenerated()` 失败时直接返回、下拉留空，不 toast 打断。
- **语速仅影响试听**：`applyRate` / `stepRate` 只改 `playbackRate`，不写磁盘、不影响最终产物。
- **「转视频」用原件而非预览副本**：渲染入参是 `appState.project.htmlPath`（项目 `index.html`），预览用的是 `index.preview.html`，两者不要混用。
- **渲染产物就地落在项目目录里**：MP4 由主进程**就地渲染**直接写在 `<项目目录>/video/output.mp4`（不再有 `userData/hf-projects/html-video-<时间戳>/` 那种临时工作目录；渲染入口只在项目内的 `.render-tmp/` 里存在一瞬、渲完即删）；本页调 `projectTools.saveVideo` 把它回写到 `project.json` 的 `videoPath`（**落盘为项目内相对路径 `video/output.mp4`**），因此「视频预览」页进入时才能自动加载。
- **状态区文本与样式成对切换**：`statusDisplay` 与 `statusDisplayClass` 必须一起用（都在 `PreviewSection`）；若只换文本不换样式，渲染中的 trace 文案会继承上一次的 `hf-ok` / `hf-error` 颜色。
- **渲染中切页的语义**：`resetRenderProgress()` 只在 `HtmlGenPage/index.vue` 的挂载与渲染结束时调用；渲染进行中切走再回来，本页会先清空 trace，随后的新 trace 会重新写入（源码注释已说明此取舍）。
- **`hgpreview:` 是本页三种页面资源的共同出口**：`<img :src="thumbUrl(...)">`（`MaterialsSection`）、`iframe.hgen-frame`（`PreviewSection` 的 `loadFrame()`）与 `<audio :src="audioSrc">`（`PreviewSection` 的背景音频试听）都经该协议，因此 `src/renderer/index.html` 的 CSP 需要同时放行 `img-src`、`frame-src` 与 `media-src`。
- **背景音频试听的源本轮从 `file://` 改为 `hgpreview://p/…`**：`setAudioPreview(relFile)` 现在收**项目内相对路径**（两处调用点传 `res.audioFile`，`onRemoveAudio` 传 `''`），URL 由 `previewUrl(appState.currentName, relFile, true)` 拼成 `hgpreview://p/<编码项目名>/<逐段编码的相对路径>?v=<时间戳>`；音频与视频一样吃主进程 `rangeResponse()` 的字节范围支持，进度条才能拖。**背景（为什么以前能用）**：旧版 `createWindow()` 用 `mainWindow.loadFile(...)`，**dev 与生产都是 `file://` 源**，`'file:///' + encodeURI(path)` 这批写法当时确实成立（旧树里十余处，Vue 化时整段照搬）；`9615eaf`（electron-vite 重构）引入 `if (process.env['ELECTRON_RENDERER_URL']) loadURL(...) else loadFile(...)` 之后，**dev 渲染页变成 `http://localhost` 源**，Chromium 拒绝 http 页读 `file://`，本卡与配音页的音频试听在 dev 下一直**静默失效**（打包版仍可用，CHANGELOG #25 / #26 / #27）。渲染层现在不再拼 `file://`：路径 → URL 一律经 `src/renderer/src/utils/url.ts`（`previewUrl()` / `ttsUrl()`），**逐段 `encodeURIComponent`** 与主进程「按段 `decodeURIComponent`」严格对应。

## 9. 运行环境缺包守卫（`useEnvGate`）

`转成视频` 需要**不随安装包**的运行环境：`video:render` 需要 `ffmpeg` + `hyperframes`（**两包实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14）；`project:extract-video-audio` 需要 `ffmpeg`（42.6 MB）——但该入口当前已下线（见 3.5），所以本目录现在**只有 `onRenderVideo(skipEnvGuard)` 一个守卫调用点**（分包方案见 `docs/runtime-pack-split.md`、主进程实现见 [main/video.ts.md](../../../main/video.ts.md) / [main/projects.ts.md](../../../main/projects.ts.md)）。

- 动手前先 `const g = await envGate.guard(['ffmpeg','hyperframes'], '转成视频', () => { void onRenderVideo(true) })`；`!g.ok`（缺包已弹框或用户取消）就 `return`，**不发后续 IPC、不产生任何下载**；
- 主进程返回 `res.needPacks`（并发 / 探测窗口造成的二次缺包）时再 `envGate.guard(res.needPacks, '转成视频', …)` 一次；
- 用户在确认框里点「继续」时，`onContinue` 以 `skipEnvGuard = true` 重发同一次操作（**不自动续做**，见 [common.md](../common.md)）；
- 确认框本身由 `App.vue` 内联渲染（`useEnvGate` 是模块级单例），本页只调 `guard()`；**取消下载 = 取消这次转视频**，界面上横幅与设置页仍保留「需要下载」状态与重试入口。
