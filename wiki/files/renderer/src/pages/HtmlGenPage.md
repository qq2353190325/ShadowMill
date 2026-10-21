# src/renderer/src/pages/HtmlGenPage/（页面）

> HTML 生成 / 修改 + **画布（成片尺寸，项目属性：只在本页生成侧选一次）** + **全局视觉风格（整片视觉基调，项目属性 `content.style`：也只在本页生成侧编辑）** + 项目素材库（多图片 / 多视频的增删与勾选）+ 背景音频选定（音轨由主进程注入 HTML）+ 实时预览（iframe 视口 = **页面自己声明的画布**，含**视角比例切换**、播放控制与拖动 seek）+ AI 思考过程展示 + **转视频（点按钮先开「渲染档位」弹窗，确认后渲染；弹窗里没有画布）**。

- **覆盖文件**（AGENTS.md 第五节 6：页面自己的子组件与助手并入同一篇）：
  | 文件 | 行数 | 角色 |
  |------|------|------|
  | `HtmlGenPage/index.vue` | 490 | 页面入口：状态条（3 个纯数据格 + 标题右侧「用法」`?`）/ **字幕 + 画布（同一行）** / **全局视觉风格输入框** / 需求描述 / 统一的生成前提提示 / 四个动作按钮 / 转视频弹窗；生成与渲染两套动作链 |
  | `HtmlGenPage/MaterialsSection.vue` | 167 | 「项目素材」区块：图片组 / 视频组的卡片墙（勾选、移除、添加） |
  | `HtmlGenPage/PreviewSection.vue` | 439 | 「预览」卡片：**背景音频行（一个占满整行的下拉：当前音频 = 「已生成音频」里的选中项 + 清空/本地两项动作）**、状态行、AI 思考过程、**「视角比例」行**（**不显示画布值**）、iframe 预览副本（**视口 = 页面声明的画布**；**容器高度上限 800px、宽度按比例、水平居中**，页面按 contain 缩放 + 居中）、播放控制条（**一个三态键** + 进度条 + 时间） |
- **所在目录**：`src/renderer/src/pages/HtmlGenPage/`（一页一目录，入口 `index.vue`）
- **类型**：页面组件（SFC，`<script setup lang="ts">`）
- **规模**：3 个文件合计 1096 行（`index.vue` 490 + `MaterialsSection.vue` 167 + `PreviewSection.vue` 439）
- **对外导出**：`index.vue` 默认导出组件（无 props，模板内渲染 `StepBar` / `MaterialsSection` / `PreviewSection`）；两个子组件分别是「无 props / 无 emits」与「4 个 props + `reload()`」

## 1. 作用与职责

本页是流水线的「HTML」环节（`PageKey = 'html-gen'`）：用户填写需求描述并选配项目素材，调用主进程 Agent 生成或修改项目 `index.html`；同时把 Agent 的阶段文案与思考原文实时渲染出来，并在 `hgpreview://` 协议下用 iframe 等比缩放预览产物。

生成侧是**两个并列的按钮**：「生成 HTML」（主按钮，不参考现有页面、从零做一版）与「按需求修改」（次要按钮，在当前页面基础上改一版）。两者的区别不靠按钮文案自适应，而是由**每个动作按钮内部各带一个的行内帮助 `?`**（`.hg-help`，悬浮只显示该动作自己的说明）承载；「按需求修改」在没有 HTML 时直接禁用（仍可用「生成 HTML」从零生成）。**「生成 HTML」点一次即执行，没有二次确认**：已有 HTML 时它会直接覆盖 `index.html`（按钮文案恒为「生成 HTML」，不随状态自适应），要留底稿只能自己先点「下载 HTML」。主进程 `project:generate-html` / `project:modify-html` 两个 handler 未变、也没有合并——界面只是把它们分别挂在两个按钮后面。

**生成侧的两个「项目属性」控件**：**「画布（成片尺寸）」下拉**与**「全局视觉风格」输入框**。两者都不是渲染档位（不进设置页那套「全局默认 / 项目覆盖」），都只在本页编辑一次、都只影响生成提示词，生效方式也相同——「改完要重新「生成 HTML」或「按需求修改」才会体现在页面上」这句**统一写在动作行上方的一句 `.hgen-tip` 里**（原先在画布与风格两处 tip 里各说一遍，见第 2 节）。全局视觉风格原先在「内容脚本」页，本轮搬到本页与画布同级：它只进 HTML 生成提示词（配音与字幕只读场景的旁白 / 时长提示，不读它）。

**字幕与画布并成一行**：原先「字幕素材」与「画布」是**两个 `.hgen-block`、各自一行小标题 + 一行控件**，本轮合成**一个 `.hgen-block` + 一个 `.hgen-row`**——两条 `.panel-title-sm`（「字幕素材（可选，留空则跳过）」与「画布（成片尺寸）」）**都已删除**（源码注释：两个控件挤一行后「哪个标题管哪个控件」会歧义，名称交给行内 `.sel-label`）；「全局视觉风格（整片视觉基调）」的标题**保留**（它仍是独立区块）。同时**画布的说明全部收进 `?` 气泡**（正文是 `{{ canvasNote }} {{ canvasHint }}` 两段拼接，原先那一行行内 `.hgen-tip` 已删除），字幕的「留空则跳过」也不再单独写提示——下拉第一项本身就叫「不使用字幕」。

**项目状态条只放数据、不放说明**：`.proj-meta` 现在只有 3 个 `.proj-stat`（HTML / 内容脚本 / 素材）。原先的第 4 格「用法」是**操作说明**、不是项目数据，会把状态条撑得很难扫，本轮改为**卡片标题右侧的行内帮助 `?`**（正文来自新增的 `usageHint`，见 2.1）。

**「转视频」也已并入本页**（渲染动作原在独立的视频页，现已整体搬到这里）：动作行多一个「转视频」按钮，**点它先弹出「转视频」弹窗**（`.hf-modal-mask`，内为「渲染档位」：质量 / 帧率 + 档位来源说明 + 画质说明 + 按需出现的「恢复默认档位」），在弹窗里点「开始渲染」才真正发起渲染；渲染成功后就地回写项目并 toast 引导去「视频预览」页看成片。这样做的原因是渲染需要 HTML 生成流程的上下文（`hasHtml` / `htmlPath`），放在同一页即可用同一个按钮闭环；而档位从「页面下方一行常驻控件」改成「弹窗内确认一次」，是为了让选档位 → 确认成为一次显式动作，也避免误改落盘。

### 1.1 三个文件的职责边界

拆分按「一个文件一件事」切（源码注释在 `index.vue:101`、`MaterialsSection.vue:66`、`PreviewSection.vue:59`）：

| 文件 | 只回答一个问题 | 不负责什么 |
|------|----------------|------------|
| `index.vue` | 「这一页要生成 / 修改 / 渲染什么」——项目状态条（3 个纯数据格）、标题右侧的「用法」`?` 气泡、**字幕素材 + 画布下拉（同一个 `.hgen-row`，本轮合并）**、**全局视觉风格输入框（`content.style`）**、需求描述、动作行上方统一的生成前提提示、四个动作按钮、转视频弹窗与渲染档位、两套动作的状态文案 | 素材的增删勾选（交 `MaterialsSection`）、预览与背景音频/试听（交 `PreviewSection`） |
| `MaterialsSection.vue` | 「这次生成用哪些素材」——图片 / 视频素材库的展示与增删勾选 | 生成流程、预览、渲染；不碰文件系统，全部经主进程 |
| `PreviewSection.vue` | 「产物长什么样」——预览副本 iframe（**按页面自己声明的画布渲染**）、**视角比例（换一种比例观察）**、播放控制与 seek、AI 思考过程展示、背景音频选定与试听 | 发起生成 / 渲染（按钮在父页），因此状态由父页以 props 传入；**也不显示「画布」值**（那属于「HTML · Agent」卡片） |

## 2. `index.vue`：模板结构

| 区块 | 说明 |
|------|------|
| `<StepBar :page="'html-gen'" />` | 顶部五节点流水线 + 工作项目切换条，`page` 传字面量 `'html-gen'` |
| `.card.hgen-panel`（第 1 张） | 标题仍随状态自适应：`HTML · Agent {{ hasHtml ? '修改' : '生成' }}`（无 HTML 时不出现「修改」字样），**右侧挂「用法」`?` 气泡**；卡片内区块顺序为 **`.proj-meta` 项目状态条（3 格）→ `.hgen-block`（字幕 + 画布，同一行）→ `.hgen-block`「全局视觉风格（整片视觉基调）」→ `<MaterialsSection />` → `.hgen-block`「需求描述（提示词）」→ 统一的 `.hgen-tip`「画布与视觉风格都是生成前提…」→ `.hgen-actions` 动作行** |
| `.panel-title` 内的「用法」`?` | `<span class="panel-title"><span class="dot"></span>HTML · Agent …` 之后：`<span class="hg-help" style="letter-spacing:0" @click.stop>` > `.hg-help-icon`「?」+ `.hg-help-pop`（**行内 `style="top:calc(100% + 8px);bottom:auto"`，向下展开**），正文 `{{ usageHint }}`。原先它是 `.proj-meta` 的第 4 个状态格。源码注释把两点写死：① **`letter-spacing:0`**——`.panel-title` 带 `2px` 字距，不清掉气泡正文会整段变宽；② **气泡向下**——标题就在卡片最顶端，向上会顶出滚动容器 `.content`（`overflow-y:auto`）被整块裁掉（`.hg-help-pop` 默认向上） |
| `.proj-meta` | 项目状态条（源码注释标为「原 renderMeta 的 `#hg-meta`」），无条件渲染 **3 条纯数据 `.proj-stat`**（数据源 `meta` computed）——HTML / 内容脚本 / 素材。源码注释：「只放「这个项目现在有什么」这类数据，说明类文案一律不进这里」；原先的第 4 格「用法」已删除，改挂标题右侧的 `?` 气泡（上一行） |
| `.proj-stat`（HTML） | `:class="{ on: meta.hasH }"`，文案 `已生成` / `尚未生成` |
| `.proj-stat`（内容脚本） | `:class="{ on: meta.sceneN > 0 }"`，文案三态：`meta.sceneN ? meta.sceneN + ' 个场景（生成时自动附带）' : (meta.missVisual ? '有旁白但都没填「画面分镜」' : '无（可先到「内容脚本」页编写）')`——**`meta.sceneN` 按画面分镜（`visual`）非空过滤**，与主进程 `buildContentBlock` 的附带口径一致（旁白可以为空 = 静音段）；`meta.missVisual` 专门承接「写了旁白、但一场都没填画面分镜」这一态 |
| `.proj-stat`（素材） | `:class="{ on: meta.matN > 0 \|\| meta.subCount > 0 }"`，文案为 `meta.matText`——**一格同时反映字幕 / 背景音频 / 素材库**（见 2.1） |
| `.hgen-block`（**字幕 + 画布，本轮合并成一行**） | **一个 `.hgen-block` + 一个 `.hgen-row`（行内 `style="margin-bottom:0"`）**，顺序固定：`span.sel-label`（行内 `style="flex:none;width:40px"`）「字幕」→ `HfSelect` `v-model="subSel"` `:groups="subSelGroups"` **`style="width:260px;flex:none"`** `title="按所选字幕逐条设计动画"` → `label.sel-label`（同样 `style="flex:none;width:40px"`）「画布」→ `HfSelect` `v-model="canvas"` `:groups="canvasGroups"` `:disabled="rendering"` **`style="width:188px;flex:none"`** `@change="onCanvasChange"` → `.hg-help`（内联 `style="letter-spacing:0"`、`@click.stop`；气泡 `style="top:calc(100% + 8px);bottom:auto"` **向下展开**，正文 `{{ canvasNote }} {{ canvasHint }}`）。**两条 `.panel-title-sm`（「字幕素材（可选，留空则跳过）」「画布（成片尺寸）」）已删除**（源码注释：两个控件挤一行后「哪个标题管哪个控件」会歧义，名称交给行内标签）；字幕「留空则跳过」也不再单独提示——下拉第一项就叫「不使用字幕」。**画布说明全在气泡里**（`canvasNote` 随画布变 + `canvasHint` 固定），**行内不再有 `.hgen-tip`**；气泡向下的原因：**这一行常被滚到视口顶端，向上会被 `.content` 的 `overflow` 裁掉**（`.hg-help-pop` 默认向上）。**两个下拉宽度刻意不对称**：字幕 260px 是因为它的选项是「项目「标题」字幕（N 条）」这类长句，而 `HfSelect` 的 `.hf-sel-text` 是 `overflow:hidden + text-overflow:ellipsis`、`title` 又被固定说明「按所选字幕逐条设计动画」占用（不显示选中项全文），收到 188px 就分不清选的是哪个项目；画布选项是「横屏 16:9（1920×1080）」这类短句，188px 够用。**这是画布在全应用里唯一的选择点**（转视频弹窗里刻意没有画布）；源码注释写明它是**项目属性**（不是渲染档位，不进设置页那套「全局默认 / 项目覆盖」，「改完要重新生成」那句统一在动作行上方说一次）——该段注释挂在**行内的 `HfSelect` 上方**（原先挂在 `.hgen-block` 上方） |
| `.hgen-block`（全局视觉风格，排在字幕 + 画布之后、`<MaterialsSection />` 之前） | `.panel-title-sm`「全局视觉风格（整片视觉基调）」**（标题保留**——另外两条小标题已随字幕 / 画布的合并删除）+ `.hgen-row`（行内 `style="margin-bottom:0"`）：`label.sel-label`（行内 `style="flex:none;width:40px"`）「风格」+ `input.hgen-input`（行内 `style="flex:1"`）`v-model="styleText"`、`@change="onStyleChange"`、placeholder 原文「整支片子的视觉基调，如：深空科技 Cyber 风、霓虹紫渐变、粒子背景（只影响「生成 HTML」）」；下方 `.hgen-tip` 原文「留空 = 未指定，模型按需求描述自行拟定；改完失焦即保存到项目。」（删掉了原先那句「生效方式与画布相同：要重新「生成 HTML」或「按需求修改」才会体现在页面上」——它已统一到动作行上方的 `.hgen-tip`）。源码注释写明：**存内容脚本正文文件 `content.json` 的 `content.style`**（即 `project:save-content` 写的那个文件；`project.json` 只更新索引、不含正文），是**项目属性**（与「画布」同属生成前的整片级前提，所以编辑入口放在生成这一侧）；只进 HTML 生成提示词（`projects.ts` 的 `buildStyleBlock()` 写成【全局视觉风格】块，**无条件注入**——原先写在 `buildContentBlock()` 里，那块没有有效场景就返回空串、风格会跟着丢掉），配音与字幕只读场景的旁白 / 时长提示、不读这个字段。这是该字段**在全应用里唯一的编辑点**（内容脚本页只做只读回写） |
| `<MaterialsSection />` | 无 props、无 emits（见第 3 节） |
| `.hgen-block`（需求描述） | `textarea.hgen-subtitle`，`v-model="prompt"`、`spellcheck="false"`、`:placeholder="promptPlaceholder"`；文案随 `hasHtml` 变：已有 HTML 讲「这次要改什么」（换紫色霓虹配色 / 字幕节奏放慢），否则讲「你想要的 HTML 效果」（深空科技风格标题动画页 / 每条字幕间隔两秒依次上浮淡入） |
| 统一的 `.hgen-tip`（动作行上方） | 原文：「画布与视觉风格都是生成前提：改完要重新「生成 HTML」或「按需求修改」才会体现在页面上。」——源码注释：「画布与视觉风格的共同前提（原先在两处 tip 里各说一遍）：改完不会自动生效，要重新生成」。它是 `.hgen-actions` 之前、卡片内的最后一个区块 |
| `.hgen-actions` | 动作行，顺序固定为：**「生成 HTML」**（`hf-btn hf-btn-primary`，`:disabled="rendering"`，`@click="onGenerate"`，文案恒为字面量 `生成 HTML`，**无 `:title`**）→ **「按需求修改」**（`hf-btn`，`:disabled="!hasHtml \|\| rendering"`，`@click="onModify"`，**无 `:title`**）→ 「下载 HTML」（`onDownload`，`title`「下载当前项目 HTML 到本地」）→ **「转视频」**（主按钮，`:disabled="!hasHtml \|\| rendering"`，`openRenderModal`，`title` 为「把当前 HTML 渲染成 MP4（约 30 秒）」）。**行内帮助 `?` 在 `<button>` 内部、每个动作按钮里各一个**（`<span class="hg-help" @click.stop>` > `.hg-help-icon`「?」 + `.hg-help-pop`），原文照抄：「生成 HTML」按钮内 —「不参考现有页面，从零做一版新的。点一次即开始并覆盖当前页面，想留底稿可先「下载 HTML」。」；「按需求修改」按钮内 —「在当前页面的基础上，按你描述的改一版——换配色、调节奏、改文案都用它。还没生成过 HTML 时不可用。」。**动作行末尾没有独立的 `?`**（本页的另外两处 `?` 在标题「用法」与字幕 / 画布那一行，见上） |
| `<PreviewSection />`（第 1 张卡片之外） | `ref="previewRef"`，四个 props：`:status` / `:status-class` / `:think-text` / `:rendering`（全部来自本页状态），见第 4 节 |
| 「转视频」弹窗（页面级，位于两张卡片之外） | `.hf-modal-mask`（`v-show="renderModalVisible"`，遮罩点击自身关闭 `@click.self="closeRenderModal"`）> `.hf-modal`（行内 `style="width:min(520px,92vw)"`；**样式全部复用 `assets/main.css` 的通用弹窗类，未新增 CSS 类**）：`.hf-modal-head`（`.hf-modal-title`「转视频」+ `.hf-modal-close`「×」，`title`「关闭」）→ `.hf-modal-body`（`.panel-title-sm`「渲染档位」（行内 `style="margin-top:0"`）→ 质量 `.hgen-row`（`label.sel-label`「质量」+ `HfSelect` `v-model="quality"`、`:groups="qualityGroups"`、`:disabled="rendering"`、`@change="onOptionChange"`）→ 帧率 `.hgen-row`（同上，`v-model="fps"` / `:groups="fpsGroups"`）→ 档位来源 `.hgen-row`（`style="margin-bottom:0"`：`.hf-file` 显示 `optionNote` + `v-if="overridden"` 的「恢复默认档位」）→ `.hgen-tip`）→ `.hf-modal-foot`（「取消」`closeRenderModal` / 「开始渲染」（主按钮）`confirmRenderVideo`） |
| `.hgen-tip`（**在弹窗内、档位来源行下方**） | `{{ qualityHint }}` + 「转视频」说明：「把当前 HTML 渲染成 MP4（约 30 秒）；渲染完成后到「视频预览」页查看成品。」|

### 2.1 项目状态条文案（`meta` computed）

```js
const c = (p && p.content) || { scenes: [] };
const filled = (Array.isArray(c.scenes) ? c.scenes : [])
  .filter((s) => s && (String(s.narration || '').trim() || String(s.visual || '').trim()));
const sceneN = filled.filter((s) => String(s.visual || '').trim()).length;
const missVisual = filled.length > 0 && sceneN === 0;
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

- `meta` 返回 `{ hasH, sceneN, missVisual, subCount, matN, matText }`：`hasH` 取 `hasHtml.value`；`filled` = 「旁白或画面分镜非空」的场景（**两个字段都空**的空壳不算——`loadScenes` 会给空项目补一个空场景）；`sceneN` = `filled` 里**画面分镜非空**的条数（统计**画面分镜非空**的场景数，与主进程 `buildContentBlock` 的附带口径一致，旁白可以为空 = 静音段）；`missVisual` = `filled.length > 0 && sceneN === 0`（**写了旁白、但一场都没填画面分镜**——这时报「无内容脚本」会让人以为自己的脚本白写了，所以要单独说清楚缺什么）。
- 三段都为空时 `matText` 恒为「无素材（可先到「字幕生成」页添加字幕，或在上方「项目素材」里添加图片 / 视频）」。
- 与素材库的联动是**自动的**：`MaterialsSection` 每次落盘后调 `refreshProject()`，本 computed 直接读 `appState.project.materials`，因此计数与「参与生成 N 个」无需父页参与。
- **「用法」文案不在 `meta` 里**：`usageHint` 是定义在 `meta` **之后**的另一个 computed（`meta.value.hasH` 为真 / 为假各给一段，逐字来自原先的第 4 格，只补了句号），挂在标题右侧的 `?` 气泡上；`meta` 只保留上面这六项数据，`.proj-meta` 因此只剩 3 格。

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

// 父页在 Agent 成功 / 项目状态变化后调用：重新判定并载入预览（原 index.vue 的 syncPreview）
defineExpose({ reload: syncPreview });
```

- **props 单向**：生成与渲染两套状态都归父页写（发起两者的按钮都在父页），本组件只读不改；`status` / `statusClass` 是父页的最终文案与样式，`thinkText` 是流式思考原文，`rendering` 用于判断是否让全局 trace 接管状态行。
- **`reload()` 是唯一对外方法**，父页在两处调用：Agent 成功（`previewRef.value?.reload()`）与生成失败且项目原本无 HTML（同样 `reload()` → 回到「尚未生成」展示）。

### 4.2 模板结构

| 区块 | 说明 |
|------|------|
| `.card.hgen-panel`（`style="margin-top:16px"`） | 标题「预览」；卡片内顺序为**背景音频行（只有一个占满整行的下拉）→ 试听行（`v-show`）→ `.hf-status` → AI 思考过程 → `.empty-hint` → 「视角比例」行 → iframe 画布 → 播放控制条** |
| 背景音频行（`.hgen-row`，**一行一个控件；当前值落在列表的选中项上**） | 只有两个元素：`span.sel-label`（行内 `style="flex:none;width:56px"`）「背景音频」+ **`HfSelect` `v-model="audioPick"` `:groups="audioSelGroups"` 行内 `style="flex:1"`（**占满整行**）**；`:title` 动态——有音频 `'当前背景音频：' + audioFile + '（由应用注入 HTML，不进生成提示词）'`，无音频 `'还没有背景音频：可选「已生成音频」或本地文件；音轨由应用注入 HTML，不进生成提示词'`。源码注释：「这一行只有一个控件：下拉占满整行，**当前音频就是「已生成音频」里的选中项**（勾选 + 显示在该下拉上），清空走「不使用背景音频」那一项 —— 所以没有独立的「移除」按钮、也不挂 `?` 气泡（音轨的注入规则写在触发器 title 里，鼠标悬停即可看到）」。**注意弹层宽度**：`HfSelect` 的菜单宽度是 `max(触发器宽, 220px)`，触发器占满整行 ⇒ 弹层也跟着变宽——这是「占满一行」的直接结果 |
| 试听行 `v-show="audioPreviewVisible"` | `<audio ref="audioEl" :src="audioSrc" controls>`（行内 `flex:1;max-height:44px`）+ `label.sel-label`「语速」+ `.rate-spinner`：`−`（`rateStep(-0.05)`）/ `<input ref="rateEl" :value="rateValue" inputmode="decimal" class="hgen-input">`（`@input="onRateInput"`）/ `+`（`rateStep(0.05)`），按钮各自带 `title`（「语速减 0.05」/「语速加 0.05」），输入框 `title`「播放语速 0.5~2.0（非法或空值自动回退 1x）」 |
| `.hf-status` | `:class="statusDisplayClass"`，文本 `statusDisplay`（渲染中优先显示全局 trace，其余为本页传入的 `status`） |
| AI 思考过程区 `v-show="showThink"` | 蓝色描边块，标题「AI 思考过程（实时）」，内为 `<pre ref="thinkPreEl">{{ thinkText }}</pre>`（`max-height:220px;overflow-y:auto`） |
| `.empty-hint` `v-show="emptyVisible"` | 空态 / 失败态提示，文本 `emptyText` |
| **「视角比例」行**（在预览框之前；**不显示画布值**） | `.hgen-row`（行内 `style="margin-bottom:8px"`）：`label.sel-label`（行内 `style="flex:none;width:56px"`）「**视角比例**」+ `HfSelect` `v-model="viewMode"` `:groups="VIEW_MODE_GROUPS"`（行内 `style="width:130px;flex:none"`，`title`「预览按哪种比例显示；只影响观看，成片仍是真实分辨率」）+ `.hg-help`（`@click.stop`，向下气泡，正文原文：「预览只按**比例**缩放显示（等比 contain + 居中），像素由成片保证——成片才是真实分辨率。切到别的比例＝『把这条片子放进那种形状的屏幕里看』，多出来的地方就是黑边，**不影响成片**；页面仍按它自己声明的画布渲染，所以版式不会被裁。」）+ 行尾 `span.hgen-tip` `v-show="viewHint"`（行内 `style="margin:0"`）显示 `{{ viewHint }}`（默认态为空串 ⇒ 不渲染）。**画布的 `sel-label` 与它的值显示（原胶囊 + `canvasText`）已删除**（源码注释：画布是项目属性、入口在「HTML · Agent」卡片，预览卡里不重复它）。**这是预览卡里唯一带 `?` 的行**（背景音频行的 `?` 已随简化删除）。三档只有 `landscape`「16:9」/ `portrait`「9:16」/ `square`「1:1」，**没有「跟随画布」这一项**（初值就是页面天然比例 `pageMode`） |
| `.hgen-frame-wrap` `v-show="frameVisible"` | 预览画布容器（`ref="frameWrapEl"`）：**尺寸内联绑定 `:style="frameStyle"`**——高度上限 **800px**、宽度 = `min(100%, Math.round(800 × 宽/高)px)`、高度由 `aspect-ratio` 决定、`paddingBottom` 被内联设成 `'0'`。**宽窗口下的实际尺寸**：`16:9` → **1422×800**、`9:16` → **450×800**、`1:1` → **800×800**；**可用宽度不够时宽度退到 `100%`、高度按比例下降，永不裁切**。源码注释：`paddingBottom: '0'` 是**覆盖 `.hgen-frame-wrap` 的 `padding-bottom` 占位**（那是纯 CSS 时代的留位技巧，现在由 `aspect-ratio` 决定高度）。**容器水平居中**：`main.css` 的 `.hgen-frame-wrap` 有 **`margin-inline: auto`**——宽度小于可用宽度时左右均分余量（否则会贴左、右边空一大块，9:16 最明显），宽度吃满时 margin 为 0 等于没有 |
| `iframe.hgen-frame` | `:src="frameSrc"`、`sandbox="allow-scripts allow-same-origin"`、`@load="onFrameLoad"`，**宽高内联绑定 `pageBox`** `:style="{ width: pageBox.width + 'px', height: pageBox.height + 'px' }"`——即 iframe 的**内部视口 = 页面自己声明的画布**（`<html data-resolution>`，由 `project:preview-html` 的 `pageCanvas` 带回；页面没声明时回落成**项目当前画布** = 旧行为）。外层容器按**视角比例**留位，再由 `fitFrame()` 把整块页面画布 **contain** 进去（居中 + 黑边），因此横屏页面按 1:1 看就是「等比缩小 + 上下黑边」，而不是右边被裁 |
| `.hg-prev-ctl` `v-show="ctlVisible"` | **只有一个三态按钮**：`<button class="hf-btn" :title="prevToggleTitle" @click="onPrevToggle">{{ prevToggleText }}</button>`——播放中显示 `暂停`（title「暂停动画」）、已播完显示 `重新播放`（title「从头重新播放」）、其余显示 `播放`（title「播放 / 继续动画」）；**「从头重新播放」那个独立按钮已删除**（功能并入同一个键）。其后是进度条 `.hg-prev-bar`（`:class="{ seeking }"`、`title="点击或按住拖动进度条，可跳转到任意播放位置"`、`@pointerdown="onSeekStart"` / `@pointermove="onSeekMove"` / `@pointerup="onSeekEnd"` / `@pointercancel="onSeekEnd"`；内层 `.hg-prev-track` 再包 `.hg-prev-bar-fill`，宽度 `prevFillPct`——热区与视觉条分离）、`.hg-prev-time`（`prevTimeText`）、`.hg-prev-hint`（`v-if="!prevPlaying && prevDur > 0 && prevTimeCur < 0.05"`，文案「已暂停在第 0 帧 · 起始帧本就是空的，点「播放」或拖动进度条」） |

### 4.3 状态

| 名称 | 说明 |
|------|------|
| `statusDisplay` | `computed`：`(props.rendering && renderProgress.text) ? renderProgress.text : props.status`——**渲染中状态行让位给全局 trace** |
| `statusDisplayClass` | `computed`：trace 接管时返回 `''`（中性样式），否则返回 `props.statusClass` |
| `frameEl` / `frameWrapEl` | 预览 iframe 与画布容器引用（`fitFrame()` 读后者的 `clientWidth` / `clientHeight` 算 contain 缩放比与居中偏移） |
| `canvas` | `computed<RenderCanvas>`：`normalizeCanvas(appState.project && appState.project.canvas)`——**画布是项目属性**（缺省横屏 1920×1080，脏数据/缺省一律落 `DEFAULT_CANVAS`），选择入口在「HTML · Agent」卡片；在本组件里它只作为「页面未声明画布时的回落值」 |
| `pageDeclared` | `ref<RenderCanvas \| ''>('')`：页面自己声明的画布，来自 `loadFrame()` 里 `pageDeclared.value = res.pageCanvas \|\| ''`（`project:preview-html` 从原 HTML 的 `<html data-resolution>` 解析、白名单校验，缺失 / 非法为空串） |
| `pageBox` | `computed`：`canvasSize(pageDeclared.value \|\| canvas.value)` → **iframe 的视口尺寸**（页面原生画布；无声明时回落项目画布） |
| `pageMode` | `computed<RenderCanvas>`：`pageDeclared.value \|\| canvas.value`——**页面天然的比例**，它同时是「视角比例」的**默认值**（此时不留黑边）与 `loadFrame()` 的跟随基准 |
| `VIEW_MODE_OPTIONS` / `VIEW_MODE_GROUPS` | 视角选项常量（`{ value: RenderCanvas; label: string }[]`，三项 **`landscape`「16:9」/ `portrait`「9:16」/ `square`「1:1」**——**只讲比例、不带「横屏 / 方形」这类画布腔调**）与它的 `HfSelect` 单组形态 `[{ label: '', options: VIEW_MODE_OPTIONS }]`（普通常量，不是 computed） |
| `viewMode` | `ref<RenderCanvas>`：当前**视角比例**，初值 `pageMode.value`；**纯观看状态、不落盘**；`watch(canvas)` 与 `loadFrame()` 都会把它归位回 `pageMode`（后者只在用户没手动改过时） |
| `viewBox` | `computed`：`canvasSize(viewMode.value)` → 视角比例的像素尺寸（`frameStyle` 的宽高与比例按它算） |
| `viewHint` | `computed`（**只剩两种非空状态**）：① `viewMode !== pageMode` → `'模拟：按「<比例标签>」观看（左右 / 上下 / 不留黑边）；只影响预览'`（黑边方向由 `viewBox` 与 `pageBox` 的宽高比比较得出）；② 视角 = 页面比例但**页面未声明画布** → `'本页未声明画布，按当前项目画布的比例显示'`；其余 `''`（模板 `v-show`） |
| `VIEW_MAX_HEIGHT` | 普通常量 `800`：预览「屏幕」的**高度上限**——宽窗口下 `16:9` 就是 **1422×800**、`9:16` 是 **450×800**、`1:1` 是 **800×800** |
| `frameStyle` | `computed`（**本轮新增，取代已删除的 `framePadPct`**）：`{ width: 'min(100%, ' + Math.round(VIEW_MAX_HEIGHT * viewBox.width / viewBox.height) + 'px)', aspectRatio: viewBox.width + ' / ' + viewBox.height, paddingBottom: '0' }`——高度上限 800、宽度按比例、**宽度不足时退到 `100%` 且高度按比例下降**（永不裁切）；绑到 `.hgen-frame-wrap`，并用内联 `paddingBottom:'0'` 覆盖 CSS 里的 `padding-bottom` 占位 |
| `frameVisible` / `frameSrc` / `emptyVisible` / `emptyText` | 画布显隐、iframe 地址（`hgpreview://` URL，由 `previewUrl()` 拼）、空态显隐与文案（初值「尚未生成 HTML。」） |
| `ctlVisible` | 等同 `frameVisible.value` |
| `thinkPreEl` / `showThink` | `<pre>` 引用；`showThink` = `props.thinkText.length > 0`；`watch(() => props.thinkText)` 每次更新把 `<pre>` 滚到底部 |
| `prevPlaying` | `ref(true)` 初值，但 `onFrameLoad()` 会置 `false`（预览**不自动播放**），之后由画面回报的 `playing` 校准 |
| `prevDur` / `prevTimeCur` / `prevFillPct` / `prevTimeText` | 预览总时长、当前时间、进度条宽度百分比、`mm:ss / mm:ss` 文案 |
| `prevEnded` | `computed<boolean>`（**本轮新增**）：`!prevPlaying && prevDur > 0 && prevTimeCur >= prevDur - 0.25`——「已自然播完」。它同时驱动按钮的第三态（`prevToggleText` / `prevToggleTitle`）与 `onPrevToggle` 的 restart 分支 |
| `prevToggleText` / `prevToggleTitle` | 同一个按钮的文案与 `title`，三态：播放中 `暂停` / 「暂停动画」；已播完 `重新播放` / 「从头重新播放」；其余 `播放` / 「播放 / 继续动画」 |
| `seeking` | `ref(false)`：是否正在拖动进度条（拖动期间本地跟手、忽略画面回报） |
| `seekPending` | `ref(false)`：松手后等待画面 `ack` 期间只更新总时长 |
| `seekAckTimer` | `let seekAckTimer = 0`：**模块作用域的普通变量**（非 ref），800ms 兜底定时器，收到 `ack` 或组件卸载时清掉 |
| `NONE_AUDIO` | 普通常量 `'__none__'`：下拉里「不使用背景音频」那一项的值（**清空入口**，取代了原先的独立「移除」按钮）——只在 `audioFile` 非空时才进选项；选中它 → `onAudioPick` 转到 `onRemoveAudio` |
| `audioBaseName(p)` | 函数（**本轮新增**）：取 basename——`(p \|\| '').split(/[\\\\/]/).pop() \|\| ''`；把 `audioFile`（`audio/<文件名>`）与 `genAudios[].path` 两侧都化到「只有文件名」再比 |
| `currentAudioIndex` | `computed<number>`（**本轮新增**）：把 `audioFile` 对回 `genAudios` 的下标，**对不上返回 `-1`**（本地导入 / 从视频提取的原声）。匹配口径：两侧都取 `audioBaseName`，再用 `s.replace(/_\d+(?=\.[^.]+$)/, '')` 去掉重名后缀后比较——前提是主进程 `copyAudioIntoProject()` **复制进项目时保留原文件名**、重名才补 `_1/_2`。**它是「当前值」的唯一判定依据**（决定首组要不要退一个同名项、以及下拉的选中下标） |
| `audioFile` | `computed`：`(appState.project && appState.project.audioFile) \|\| ''`——**四处看它**：试听源初始化（`onMounted`）、`currentAudioIndex` 的匹配输入、`NONE_AUDIO` 与「对不上时那一个同名项」的出现条件、触发器的**动态 `:title`**；**行内没有第二个控件显示它** |
| `audioPick` | `ref('')`：下拉的选中值，**初值 `''`**；三种取值 = ① **匹配到的下标字符串**（`String(currentAudioIndex)`，正常态——选中态就落在「已生成音频」那条上）、② `''`（对不上列表、或项目未设音频）、③ **瞬时动作哨兵** `NONE_AUDIO` / `'__file__'`（选完立刻复位，不留在界面上）。**合成的 `CURRENT_AUDIO` 已整个删除** |
| `audioEl` / `audioSrc` / `audioPreviewVisible` | 试听元素引用、试听源（**`hgpreview://p/…`**，由 `previewUrl(appState.currentName, relFile, true)` 拼）、试听行显隐——由 `onMounted` 按项目现有 `audioFile` 初始化，所以切页回来那一行不会消失 |
| `genAudios` | `ref<GenAudioItem[]>`（`{ path, name, group, size, mtime }`），**既填充「已生成音频」分组，也是 `currentAudioIndex` 的匹配源**（列表加载完 watcher 会自动把选中态对齐） |
| `audioSelGroups` | `computed<HfSelectGroup[]>`：**「列表 + 动作」三段**——① 首组 `head`（动态）：**仅当 `currentAudioIndex < 0`** 才 `push({ value: '', label: audioFile.value ? audioBaseName(audioFile.value) : '未设置背景音频' })`（**label 就是文件名，不再写「当前：」**），再在 `audioFile` 非空时 `push({ value: NONE_AUDIO, label: '不使用背景音频' })`；② `{ label: '已生成音频', options: genAudios.map((it, i) => ({ value: String(i), label: it.name + '（' + it.group + '）' })) }`——**当前音频的选中态就落在这里**；③ `{ label: '本地', options: [{ value: '__file__', label: '选择本地文件…' }] }`；末尾 `.filter((g) => g.options.length > 0)` 去掉空分组（首组两项都不加时整组被滤掉） |
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
| `fitFrame()` | **contain（输入是 `pageBox`）**：`k = Math.min(wrap.clientWidth / pageBox.width, wrap.clientHeight / pageBox.height)`（把「页面原生视口」整体缩进视角比例形状，取宽 / 高两个方向缩放比的较小值）；`tx = (wrap.clientWidth - pageBox.width * k) / 2`、`ty = (wrap.clientHeight - pageBox.height * k) / 2`；最终 `frame.style.transform = 'translate(tx, ty) scale(k)'`（`transform-origin: 0 0` 不变） |
| `watch(canvas, …)` | 画布变了（用户在「HTML · Agent」卡片里改）时**把 `viewMode.value = pageMode.value` 归位**（否则界面会留着别的比例），再 `void nextTick(fitFrame)`（`fitFrame` 读容器尺寸，等 DOM 更新后再算） |
| `watch(viewMode, …)` | 换比例后**容器尺寸随 `frameStyle` 变**（高度上限 800、宽度按比例）、缩放比要在 DOM 更新后重算 → `void nextTick(fitFrame)`（源码注释原文） |
| `watch([currentAudioIndex, genAudios], …, { immediate: true })` | **选中态的唯一来源**（本轮新增）：`audioPick.value = currentAudioIndex >= 0 ? String(currentAudioIndex) : ''`，源码注释：「当前音频变了（选中 / 清空 / 换项目 / 列表刚加载完）就把下拉的选中态同步过去」。因此**不要在别处再手动 set 一次 `audioPick`**（`onAudioPick` 只负责「读值 → 复位 → 派发动作」） |
| `onFrameLoad()` | 每次载入完成（含 `restart` 引发的 reload）复位 `prevPlaying = false` / `prevDur = 0` / `prevTimeCur = 0` 并 `fitFrame()`；**刻意不主动起播** |
| `onPrevToggle()` | **三态键的唯一处理**：无 `frameSrc` → `toast('暂无预览')`；`prevEnded` 为真（源码注释：「已自然播完：同一个键 = 从头重播（原来这是独立的「重新播放」按钮）」）→ 发 `'restart'` 并置播放态；否则切换 `prevPlaying` 并发 `'play'` / `'pause'`。**`onPrevReplay()` 已整个删除**（功能并入这里） |
| `loadFrame()` | 调 `window.projectTools.previewHtml(appState.currentName)`；失败则关画布、`emptyText` 取 `res.message` 或「预览副本生成失败」；成功则**先记下旧的 `pageMode`**，再 `pageDeclared.value = res.pageCanvas \|\| ''`，**并且只在用户没手动改过比例时才跟随页面**：`const prevPageMode = pageMode.value; … if (viewMode.value === prevPageMode) viewMode.value = pageMode.value;`；随后由 `previewPath` 取文件名（兜底 `'index.preview.html'`），`frameSrc.value = previewUrl(appState.currentName, relFile, true)`——**`bust = true` 附 `?v=<Date.now()>` 强制重新加载**（走 `hgpreview://` 而不是 `file://`：dev 的 http 页面下 file:// iframe 会被 Chromium 拦截） |
| `syncPreview()` | 状态联动：`!!(appState.project && appState.project.htmlExists && appState.project.htmlPath)` 成立 → `loadFrame()`；否则关画布、清 `frameSrc`、显示空态「尚未生成 HTML。」——**即对父页暴露的 `reload()`** |
| `setAudioPreview(relFile)` | 参数是**项目内相对路径**：非空则 `audioSrc.value = previewUrl(appState.currentName, relFile, true)`（`hgpreview://p/…?v=<时间戳>`，时间戳避免看到缓存里的旧音频）并显示试听行，否则清空并隐藏 |
| `afterAudioChange(tip, relFile)` | 设 / 换 / 清空背景音频的统一收尾：`await refreshProject()` → `setAudioPreview(relFile)` → `await loadFrame()`（主进程已同步改写 `index.html` 的音轨，不重载就听不到）→ `toast(tip)`。**调用点传的都是主进程回执里的 `res.audioFile`**（项目内相对路径，如 `audio/xxx.mp3`——`setAudio` 已把音频复制进项目 `audio/`），`onRemoveAudio` 传 `''`。刷新后 `currentAudioIndex` 会跟着变，watcher 自动把选中态挪到新那条（或 `-1` → 首组退一个同名项） |
| `onAudioPick()` | 下拉的唯一入口：先 `const picked = audioPick.value;` → **无条件复位** `audioPick.value = currentAudioIndex >= 0 ? String(currentAudioIndex) : ''`（回到「当前项的选中态」，不再是某个合成哨兵）→ `if (!picked) return`（选了自己的那条 = 无操作）→ `'__file__'` 走 `onPickAudioFile()` → `NONE_AUDIO` 走 `onRemoveAudio()` → 否则按 `Number(picked)` 取 `genAudios` 项并 `setAudio`。分支顺序就是这三条 + 下标，**没有 `CURRENT_AUDIO` 分支了** |
| `onPickAudioFile()` / `onRemoveAudio()` | 「选择本地文件…」与「不使用背景音频」两条入口：前者 `window.projectTools.pickAudio()` → `setAudio` + `afterAudioChange`（传 `res.audioFile`）；后者 `clearAudio(currentName)` + `afterAudioChange('已移除背景音频', '')`——**只由下拉的 `NONE_AUDIO` 项触发**。本地文件设成背景音频后 `currentAudioIndex` 是 `-1`（它不在生成音频列表里），因此首组会退一个同名项把值显示出来 |
| `onRateInput()` / `rateStep(delta)` | `rateValue.value = String(applyRate(rateEl.value, audioEl.value))` / `String(stepRate(rateEl.value, audioEl.value, delta))` |
| `genLoad()` | `window.voiceTools.listGenerated()`（`.catch` 归为 `{ ok: false, message: '调用失败' }`）；**失败静默返回**（「已生成音频」分组留空即可），成功写 `genAudios = res.items \|\| []`（随后 `watch([currentAudioIndex, genAudios])` 触发一次，把选中态对齐） |
| `onMounted(cb)` | `window.addEventListener('message', onPrevMessage)`、`window.addEventListener('resize', fitFrame)`、**`setAudioPreview(audioFile.value)`（按项目现有的背景音频初始化试听源——不这么做，切页回来 `audioPreviewVisible` 又是 `false`，那一行试听会整块消失；无音频时传空串，行自动收起）**、`syncPreview()`、`genLoad()`（`resize` 时同样按 contain 重算缩放与居中） |
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
| `subSel` | `ref<string>` | 字幕素材选择值：`''`（不使用字幕）/ `'__current__'`（当前项目字幕）/ 其他项目名。**下拉与画布同处一行**（见第 2 节） |
| `canvas` | `ref<RenderCanvas>` | **成片画布方向（项目属性不是渲染档位）**：初值 `normalizeCanvas(appState.project && appState.project.canvas)`（缺省横屏 1920×1080），挂载时由 `syncCanvas()` 同步；同一个值决定三件事——① 生成提示词里给模型的版式尺寸（主进程 `buildCanvasBlock()`）② 预览 iframe 的回落画布（`PreviewSection` 直接读 `appState.project.canvas`）③ 渲染入口注入的 `data-resolution`。**没有「设置页默认 → 项目覆盖」那种层级** |
| `canvasGroups` | `computed<HfSelectGroup[]>` | 画布下拉选项：单组，`options` = `RENDER_CANVAS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))`，label 形如「横屏 16:9（1920×1080）」（取自 `@shared/constants`，与提示词同源） |
| `canvasNote` | `computed<string>` | 画布 `?` 气泡的**前半句**（随当前画布变）：`'预览与成片都按「' + canvasLabel(canvas.value) + '」这块画布。'`（末尾补了句号）；与 `canvasHint` 拼在同一个气泡里（`{{ canvasNote }} {{ canvasHint }}`），**行内不再单独显示** |
| `canvasHint` | 普通常量 `string`（**不是 computed**） | 画布 `?` 气泡的**后半句**（固定文案，内容一字未变）：`'换画布不会自动重排已有页面：版式是生成时按画布排的，模型若按横屏排过版，切到竖屏 / 方形会留下黑边或裁切。'`——只讲「换画布要付出什么代价」，「改完要重新生成」那句由动作行上方的统一 `.hgen-tip` 承担 |
| `styleText` | `ref<string>` | **全局视觉风格文本（项目属性 `content.style`）**：初值 `''`，挂载时由 `syncStyle()` 从 `appState.project.content.style` 同步；输入框 `v-model="styleText"`，`@change`（失焦）触发 `onStyleChange()` 落盘。它是该字段在全应用里**唯一的编辑点**（内容脚本页只做「原样带回」的只读回写） |
| `subSelGroups` | `computed<HfSelectGroup[]>` | 字幕下拉选项：`'不使用字幕'` + 仅当 `appState.project?.subtitle` 非空时出现的 `'当前项目字幕（N 条）'` + `appState.myProjects.filter(m => m.name !== currentName && m.hasSubtitle)` 的项目字幕（文案 `项目「标题或名」字幕（N 条）`） |
| `status` / `statusClass` / `thinkText` | `ref<string>` | 状态条文本、样式类（`''` / `'hf-ok'` / `'hf-error'`）、AI 思考原文；三者整体传给 `PreviewSection` |
| `meta` | `computed` | 项目状态条数据源，见 2.1（**只出数据**：`{ hasH, sceneN, missVisual, subCount, matN, matText }`；`sceneN` 数**画面分镜非空**的场景、`missVisual` = 有旁白但一场都没填画面分镜） |
| `usageHint` | `computed<string>` | 标题右侧「用法」`?` 气泡的正文，定义在 `meta` **之后**：`meta.value.hasH` 为真 → 「填写需求后点「按需求修改」（在当前页面上改）；想整页重来点「生成 HTML」（会直接覆盖当前页面，点一次即执行），也可「下载 HTML」备份。」；为假 → 「在「项目素材」里选好素材（可多张图片 / 多个视频，勾选决定这次用哪些），再填写需求描述点「生成 HTML」；背景音频在下方「预览」里选定。」——两段逐字来自原先 `.proj-meta` 的第 4 格（只补了句号） |
| `previewRef` | `ref<{ reload: () => void } \| null>` | 预览子组件引用；**对外契约只有 `reload()`** |
| `agentRunning` | `let agentRunning = false` | **模块作用域普通变量**（非 ref），生成/修改并发互斥标志 |
| `rendering` | `ref(false)` | 转视频进行中标志（禁用三个动作按钮、画布下拉与弹窗里的两个档位下拉），并传给 `PreviewSection` 决定状态行是否让位给 trace |
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
| `syncCanvas()` | `canvas.value = normalizeCanvas(appState.project && appState.project.canvas)`——项目切换 / 刷新后同步显示值（脏数据落回默认横屏），挂载时与 `onCanvasChange()` 的失败分支都会调 |
| `onCanvasChange()` | `await window.projectTools.setCanvas(appState.currentName, canvas.value)`；失败（`!res.ok`）→ `toast(res.message \|\| '保存画布失败')` + `syncCanvas()` 回滚显示值并返回；成功 → `await refreshProject()` → `syncCanvas()` → `previewRef.value?.reload()`（**预览画布尺寸变了，必须重载 iframe，缩放比按新画布重算**） |
| `syncStyle()` | `styleText.value = (appState.project && appState.project.content && appState.project.content.style) \|\| ''`——把输入框刷成项目里已落盘的风格值（项目切换 / 刷新后同步显示），挂载时与 `onStyleChange()` 的两个分支都会调 |
| `onStyleChange()` | 失焦即落盘（见 6.12）。取当前项目的 `content.scenes`（非数组则 `[]`）**原样带回**，`await window.projectTools.saveContent(appState.currentName, { style: styleText.value.trim(), scenes })`；失败（`!res.ok`）→ `toast((res as { message?: string })?.message \|\| '保存视觉风格失败')` + `syncStyle()` 回退显示值并返回；成功 → `await refreshProject()` → `syncStyle()`。**不重载预览**（风格只进生成提示词，页面本身不变） |
| `onOptionChange()` | 下拉改动 → `await saveProjectRenderOverride({ quality, fps })`（内部走 `project:set-render`）；失败且有 `message` 时 toast |
| `onResetOptions()` | `await saveProjectRenderOverride(null)` 清除项目覆盖；成功则 `syncFromEffective()`，失败且有 `message` 时 toast |
| `openRenderModal()` | 三道守卫（`rendering` / `agentRunning` / `htmlPath` + `htmlExists`）全部通过才 `renderModalVisible = true`（见 6.6） |
| `closeRenderModal()` | `renderModalVisible = false`；供「取消」、「×」、遮罩点击（`@click.self`）与 ESC 共用 |
| `confirmRenderVideo()` | **先关弹窗**再 `void onRenderVideo()` |
| `onModalKeydown(e)` | `document` 级 `keydown`：`e.key === 'Escape' && renderModalVisible.value` 时 `closeRenderModal()` |
| `onRenderVideo(skipEnvGuard = false)` | 转视频主流程（见 6.7） |
| `onMounted(cb)` | 清空 `status` / `statusClass` / `thinkText`；`resetRenderProgress()`；`syncFromEffective()`（渲染档位：项目覆盖 > 设置页全局默认）；`syncCanvas()`（画布显示，项目属性、缺省横屏）；`syncStyle()`（全局视觉风格显示，项目属性 `content.style`）；注册 `onHtmlProgress`；注册 `document` 级 `keydown`（弹窗 ESC） |
| `onBeforeUnmount(cb)` | 只 `document.removeEventListener('keydown', onModalKeydown)` |

## 6. 关键流程

### 6.1 挂载加载（`onMounted`）

1. 复位 `status`、`statusClass`、`thinkText`，避免复用实例时残留上一次会话的文案。
2. `resetRenderProgress()` 清掉上一次渲染的 trace 残留（源码注释：渲染中若再次进入本页，随后仍会被新 trace 覆盖）；`syncFromEffective()` 把档位下拉刷成「项目覆盖 > 设置页全局默认」的生效值；`syncCanvas()` 把画布下拉刷成当前项目的画布值（源码注释：画布显示：项目属性（缺省横屏））；**`syncStyle()` 把全局视觉风格输入框刷成当前项目的 `content.style`**（源码注释：全局视觉风格显示：项目属性（`content.style`））。
3. `window.projectTools.onHtmlProgress((info) => …)` 注册进度回调（preload 侧为**单订阅**：重复注册只替换回调，因此切页不会叠加监听）。回调只用两个字段：`info.text` → `status`（同时清空 `statusClass`）、`info.thinkText` → `thinkText`（`String(info.thinkText || '')`）。
4. 注册 `document.addEventListener('keydown', onModalKeydown)`（弹窗 ESC 关闭）；卸载时在 `onBeforeUnmount` 移除。
5. 预览、已生成音频列表与 iframe 播放控制**不在这里**：`PreviewSection` 自己在 `onMounted` 里 `setAudioPreview(audioFile)` + `syncPreview()` + `genLoad()` + 注册 `message` / `resize`。

> 拆分后本页不再注册 `message` / `resize`，也不再清理 seek 定时器——这些随预览整块搬进了 `PreviewSection.vue`。

### 6.2 生成 / 修改 HTML（`runAgent`）

生成侧在界面上是**两个并列的按钮，各自对应一个明确动作**：`生成 HTML`（主按钮 → `onGenerate`）与 `按需求修改`（次要按钮 → `onModify`）。两者的区别写在**每个动作按钮内部各自的 `?`** 里，按钮文案本身不随状态变化。

1. `agentRunning` 为真 → `toast('上一个请求还在处理中，请稍候')` 并返回（重复提交防护）。
2. `rendering` 为真 → `toast('正在渲染视频，请等它结束再提交需求')` 并返回；`prompt.trim()` 为空 → `toast('请先填写需求描述（上方提示词输入框）')` 并返回。
3. 置 `agentRunning = true`，再按 `meta.value.sceneN` 与 `meta.value.missVisual` 写初始状态文案（**三态**）：有场景（`sceneN` 为真）→「将附带当前项目内容脚本（N 个场景），已提交给 Agent，处理中...」（N 即画面分镜非空的场景数）；`missVisual`（有旁白但一场都没填画面分镜，而画面才是附带门槛）→「当前项目的内容脚本都缺「画面分镜」，附带不到提示词里，将仅按需求描述生成。已提交给 Agent，处理中...」；其余 →「当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...」。最后清空 `statusClass`。
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

1. `loadFrame()` 调 `window.projectTools.previewHtml(appState.currentName)`；主进程读取项目 `index.html`，**先从原 HTML 的 `<html data-resolution>` 解析页面自己声明的画布**（`RENDER_CANVASES` 白名单校验，缺失 / 非法为 `''`），再注入播放控制脚本、写出同目录 `index.preview.html`（并为副本剥离 CSP），返回 `{ ok, previewPath, pageCanvas }`。**页面不调用 `projectTools.readHtml`**，读取发生在主进程内部。
2. 失败（`!res || !res.ok`）：隐藏画布、清空 `frameSrc`、`emptyText` 取 `res.message` 或 `'预览副本生成失败'`。
3. 成功：记下旧的 `pageMode` → `pageDeclared.value = res.pageCanvas || ''` → **只在用户没手动改过比例时**让 `viewMode` 跟随新的 `pageMode`；`relFile` 取 `previewPath` 的文件名（兜底 `'index.preview.html'`），再 `frameSrc.value = previewUrl(appState.currentName, relFile, true)`。源码注释说明两点原因：dev 的 http 页面下 `file://` iframe 会被 Chromium 拦截，故走自定义协议；`bust = true` 附的时间戳强制重新加载。
4. `frameVisible = true`、`emptyVisible = false`；iframe `@load` 触发 `onFrameLoad()` 复位进度并按 **contain** 重新缩放（`fitFrame()`：`min(宽比, 高比)` + `translate` 居中，输入是 `pageBox`）。

### 6.5 预览 postMessage 协议与 seek（`PreviewSection`）

父页 → iframe：`prevPost(type, seconds?)` 发送 `{ __hg: true, type, seconds }`，`type` 取 `'pause'` / `'play'` / `'seek'` / `'restart'`；副本注入脚本收到 `'restart'` 时 `location.reload()`、收到 `'seek'` 时调 `setTime(d.seconds)`（只挪播放头、不改播放/暂停状态，并立刻回一条带 `ack` 的进度），见 [main/projects.ts.md](../../../main/projects.ts.md)。**载入完成后不再发 `'play'`**：预览默认静止。

iframe → 父页：副本每 300ms 以及「冻住后 / seek 后」立刻上报 `{ __hg: true, type: 'progress', time, dur, playing, ack }`（`playing` 是真实播放状态、**已播完不算在播**；`ack` 只在收到 seek 后的那条上报里为 `true`）。

本组件处理（`onPrevMessage`）：只接受 `d.__hg && d.type === 'progress'`；先看 `d.ack === true`——命中就清 `seekPending` 与兜底定时器；随后**拖动中、或「松手后还没等到 ack」时只更新 `prevDur`**，位置与播放状态一律不采信；正常回报则写 `prevTimeCur` / `prevDur`，`typeof d.playing === 'boolean'` 时校准 `prevPlaying`，最后当处于播放态且 `prevTimeCur >= prevDur - 0.25` 时把 `prevPlaying` 置回 false。**拖动本身不改变播放/暂停状态**。

### 6.6 转视频：弹窗确认档位（`openRenderModal` / `confirmRenderVideo`）

**第一步：点「转视频」只开弹窗，不渲染。** 三道守卫，任一不通过就 toast 且**不开弹窗**：① `rendering.value` 为真直接返回（按钮本身也已 `:disabled`）；② `agentRunning` 为真 → `toast('Agent 正在处理 HTML，请等它结束再转视频')`；③ 取 `appState.project.htmlPath`，`!htmlPath || !htmlExists` → `toast('还没有 HTML，请先「生成 HTML」')`。

守卫放在 `openRenderModal` 而不是只放在 `onRenderVideo`，是为了避免「弹窗打开了又被拒」的观感；`onRenderVideo` 内保留同一套守卫，兜住弹窗打开后状态被改的窗口期。

**第二步：在弹窗里确认档位。**（**弹窗里没有画布控件**：画布是全应用唯一一处选择点，在「HTML · Agent」卡片的字幕 / 画布那一行；弹窗只负责质量 / 帧率这两个渲染档位，画布随载荷由页面状态带下去。）质量 / 帧率两个下拉直接绑定 `quality` / `fps`（`@change="onOptionChange"`，改动**立即**写入项目级覆盖），`.hf-file` 显示 `optionNote`，`v-if="overridden"` 时右侧多出「恢复默认档位」，下方 `.hgen-tip` 是当前质量的画质说明 + 用途说明。关闭有四种：`取消`、`×`、点弹窗外（`@click.self`）、ESC（`onModalKeydown`）——**都只关弹窗，不发起渲染，也不回滚已改的档位**。

**第三步：`开始渲染` → `confirmRenderVideo()` 先关弹窗，再走 `onRenderVideo()`**，见 6.7。

### 6.7 转视频主流程（`onRenderVideo(skipEnvGuard = false)`）

1. 进行中守卫（`rendering`）→ **Agent 忙守卫**（`agentRunning` → toast）→ `htmlPath` / `htmlExists` 校验。
2. `options = { quality: quality.value, fps: fps.value, canvas: canvas.value }`（质量 / 帧率是渲染档位，`canvas` 是项目属性，一起随载荷下发）；`skipEnvGuard` 为假时先过 `envGate.guard(['ffmpeg', 'hyperframes'], '转成视频', () => { void onRenderVideo(true); })`，`!g.ok` 直接返回（见第 8 节）。
3. `status = '已提交渲染（' + renderOptionsText(options) + ' · ' + canvasLabel(options.canvas) + '，约 30 秒）...'`、`statusClass = ''`、`rendering = true`。
4. `await window.hfTools.renderVideo(htmlPath, options)`（`video:render`；主进程按白名单拼 `--quality` / `--fps`）。
5. 返回后先 `resetRenderProgress()`：用本地完成/失败文案覆盖全局 trace 残留（渲染期间状态区优先显示 trace，见 5.4 的 `statusDisplay`）。
6. **成功**：`status = '视频已生成（' + renderOptionsText(options) + ' · ' + canvasLabel(options.canvas) + '）：' + res.outputVideo`、`statusClass = 'hf-ok'`；随后 `await window.projectTools.saveVideo(appState.currentName, res.outputVideo)` → `await refreshProject()` → `toast('视频已生成，可到「视频预览」页查看')`。
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

### 6.10 背景音频：设定 / 更换 / 清空（`PreviewSection`，音轨由主进程注入 HTML）

背景音轨**不经过 Agent**：本卡片只负责「选定哪份音频」，写 HTML 由主进程完成——`project:set-audio` / `project:clear-audio` / `project:extract-video-audio` 在 `writeProject` 之后调用 `applyBgmToHtml()`，按 `project.audioFile` 重写 `index.html` 里的 `<audio id="myv-bgm" src="audio/…" autoplay loop>`（先摘掉本应用注入的旧标签、再摘掉引用同一音频文件的历史标签；幂等，内容无变化时不写盘，无 HTML 时静默返回 `false`）。细节见 [main/projects.ts.md](../../../main/projects.ts.md)。

1. **下拉 = 列表 + 动作（当前值就落在列表的选中项上）**：从「已生成音频」里挑出来的那条**就是下拉的选中项**——HfSelect 自己的勾选打在这一行、触发器显示它的名字，**没有「当前：…」这种合成项**（合成的 `CURRENT_AUDIO` 已删除）。首组只在 `currentAudioIndex < 0`（对不上列表）时才放一个同名项把值显示出来（label = 文件名，无音频时「未设置背景音频」），有音频时再加「不使用背景音频」（`NONE_AUDIO`）= 清空入口；其后是「已生成音频」与「本地」→「选择本地文件…」（值 `'__file__'`）。**没有独立「移除」按钮、也没有 `?` 气泡**：清空走 `NONE_AUDIO`，音轨注入规则写在触发器 `title` 里（「由应用注入 HTML，不进生成提示词」）。
2. **试听**：`setAudio` 的回执 `res.audioFile` 就是**项目内相对引用**（`audio/xxx`，主进程已把音频复制进项目），`setAudioPreview(relFile)` 直接把它交给 `previewUrl()` 拼 `hgpreview://p/…` 显示 `<audio>` 试听行（语速控件见 6.11）。**进入本页时 `onMounted` 会先按项目现有的 `audioFile` 初始化试听源**——否则切页回来后 `audioPreviewVisible` 又是 `false`，那一行试听会整块消失；无音频时传空串，行自动收起。
3. **清空**：选中下拉里的「不使用背景音频」（`NONE_AUDIO`，只在有音频时出现）→ `onAudioPick` 转到 `onRemoveAudio()`：主进程清空 `proj.audioFile` 并把 HTML 里注入的 `<audio>` 一并摘掉，随后同样重载预览（`setAudioPreview('')` 清空试听源）；**不删除 `audio/` 里的原文件**。
4. **与生成 / 修改的衔接**：`project:generate-html` / `project:modify-html` / `project:save-html` 写入 `index.html` 后都会再调一次 `applyBgmToHtml()`；提示词里固定只有一行「【音轨】背景音轨由应用在渲染前自动注入（`<audio id="myv-bgm">`），请勿写入、修改或删除任何 `<audio>` 标签，也不要为音轨预留页面元素。」——**音频不占提示词、也不交给 Agent**。
5. **转视频**：`video.ts` 直接把 `index.html` 所在目录交给 HyperFrames CLI，页面里的 `<audio id="myv-bgm">` 由 CLI 在 trace 阶段提取并混入 MP4。

### 6.11 语速控件（`applyRate` / `stepRate`）

1. `−` / `+` 按钮分别调用 `rateStep(-0.05)` / `rateStep(0.05)`；输入框为 `:value="rateValue"`、`@input="onRateInput"`，`inputmode="decimal"`。
2. 两者都作用于 `utils/rate.ts` 的共享实现：`applyRate(el, audio)` 解析输入值，非有限值回退 1，再钳到 `0.5~2.0`，写回 `el.value` 并设置 `audio.playbackRate`；`stepRate(el, audio, delta)` 按 `Math.round((v + delta) * 100) / 100` 步进后同样钳制。
3. **只改播放 `playbackRate`，不改磁盘音频**；本组件把返回值同步回 `rateValue`。

### 6.12 全局视觉风格：失焦即落盘（`onStyleChange`）

1. 输入框 `v-model="styleText"`，`@change`（失焦）触发 `onStyleChange()`，**没有独立保存按钮**——与「画布」下拉 `@change` 是同一节奏。
2. **`project:save-content` 是整份 `content` 覆盖**，所以必须先取当前项目的场景原样带回（源码注释：「所以必须把现有 scenes 原样带回——只提交 style 会把场景清空」）：

```js
const cur = appState.project && appState.project.content;
const scenes = (cur && Array.isArray(cur.scenes)) ? cur.scenes : [];
const res = await window.projectTools.saveContent(appState.currentName, { style: styleText.value.trim(), scenes });
```

3. **失败**（`!res || !res.ok`）：`toast((res as { message?: string })?.message || '保存视觉风格失败')` → `syncStyle()` 把输入框退回项目里已落盘的旧值（源码注释：避免界面显示一个并没保存的值）→ `return`。
4. **成功**：`await refreshProject()` → `syncStyle()`。**不重载预览**（页面本身没变）。
5. 生效方式与画布相同：值只进生成提示词，要重新「生成 HTML」或「按需求修改」才会体现在页面上（这句统一在动作行上方的 `.hgen-tip` 里，本区块自己的 tip 不再重复）。配音（`SynthSection` 的「载入脚本旁白」）与字幕（「由脚本旁白生成」）只读场景的旁白 / 时长提示，**都不读这个字段**。

## 7. 依赖与协作

### 7.1 `index.vue` 的导入

| 依赖 | 用途 |
|------|------|
| `vue`：`computed, onBeforeUnmount, onMounted, ref` | 响应式状态与生命周期（**`watch` 已随预览块移走**） |
| `@shared/types`：**`type RenderCanvas`**、`type RenderFps`、`type RenderQuality` | 档位下拉（`quality` / `fps`）与**画布下拉（`canvas`）**的类型标注 |
| `@renderer/composables/useAppStore`：`appState, hasHtml, refreshProject` | 全局项目状态、`hasHtml` 判定、刷新项目列表与详情（**全局视觉风格的读 / 写都靠这三者：`syncStyle()` 读 `appState.project.content.style`，`onStyleChange()` 落盘后 `refreshProject()`**） |
| `@renderer/composables/useToast`：`toast` | 统一的轻提示（含「保存视觉风格失败」） |
| `@renderer/composables/useRenderProgress`：`resetRenderProgress` | 渲染 trace 复位（读 `renderProgress` 的是 `PreviewSection`） |
| `@renderer/composables/useEnvGate`：`useEnvGate` | 转视频的运行环境缺包守卫 |
| `@renderer/composables/useConfigPrompt`：`useConfigPrompt` | 配置类错误弹窗 |
| `@renderer/utils/render`：`FALLBACK_RENDER, RENDER_FPS_OPTIONS, RENDER_QUALITY_OPTIONS, isRenderOverridden, renderOptionsText` + `RENDER_CANVAS_OPTIONS, canvasLabel, normalizeCanvas` | 档位选项表、默认档位、覆盖判定与档位摘要文案 + 画布下拉选项、**画布标签（`canvasNote` 气泡前半句与渲染状态文案用）**与画布规范化（`syncCanvas()` / `canvas` 初值） |
| `@renderer/composables/useRenderOptions`：`effectiveRenderOptions, renderDefaults, saveProjectRenderOverride` | 生效档位、全局默认、写入 / 清除项目覆盖 |
| `@renderer/components/StepBar.vue` | 顶部流水线步骤条 + 工作项目切换 |
| `@renderer/components/HfSelect.vue`：`HfSelect`（默认）、`type HfSelectGroup` | 全局自绘下拉组件（**全局视觉风格用的是原生 `input`**） |
| `./MaterialsSection.vue` / `./PreviewSection.vue` | 同目录子组件，**相对路径导入**（AGENTS.md 第五节 7） |

> **本轮没有新增 import**：`NONE_AUDIO` 仍是本文件内的普通常量，`audioBaseName` 是模块内普通函数、`currentAudioIndex` 是 `computed`（合成的 `CURRENT_AUDIO` 已删除）。

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
| `vue`：`computed, nextTick, onBeforeUnmount, onMounted, ref, watch` | 响应式状态与生命周期、思考文本自动滚底、**三个 `watch`（`canvas` → 归位视角比例 + `nextTick(fitFrame)`；`viewMode` → `nextTick(fitFrame)`；`[currentAudioIndex, genAudios]` → 同步背景音频下拉的选中态）** |
| `@shared/types`：**`type RenderCanvas`** | 画布 / 页面声明画布 / 视角比例 / `pageMode` 的类型标注（`VIEW_MODE_OPTIONS` 的 `value` 也用这个类型） |
| `@renderer/composables/useAppStore`：`appState, refreshProject` | 读 `audioFile` / `htmlExists` / `htmlPath` 与**成片画布 `canvas`**，音频变更后刷新项目 |
| `@renderer/composables/useToast`：`toast` | 轻提示 |
| `@renderer/utils/rate`：`applyRate, stepRate` | 试听语速控件共享逻辑 |
| **`@renderer/utils/render`：`canvasSize, normalizeCanvas`** | iframe 视口（`pageBox`）与视角比例尺寸（`viewBox`，`frameStyle` 的宽高来源）、contain 缩放比（`fitFrame()`）、画布值规范化（`canvas` computed）；**不用 `canvasLabel`**（预览卡里没有画布文案了） |
| **`@renderer/utils/url`：`previewUrl`** | 预览副本 iframe 与背景音频试听的 `hgpreview://p/…` URL 拼装（`loadFrame()` / `setAudioPreview()`，均 `bust = true`） |
| `@renderer/composables/useRenderProgress`：`renderProgress` | 渲染中状态行改显全局 trace |
| `@renderer/components/HfSelect.vue`：`HfSelect`（默认）、`type HfSelectGroup` | 背景音频的下拉 + 预览「视角比例」下拉 |

> **导入面稳定**：`NONE_AUDIO` / `pageMode` / `audioBaseName` / `currentAudioIndex` 都只是本文件内的常量、函数与 computed，不新增任何 import；`escTxt` 与 `canvasLabel` 都已不再使用。

### 7.4 调用的 preload / IPC

| 方法 | 用途 | 调用点 |
|------|------|--------|
| `previewHtml(name)` | 生成 `index.preview.html` 预览副本；返回 `{ ok, previewPath, pageCanvas }`——`pageCanvas` 是**页面自己声明的画布**（取自原 HTML 的 `<html data-resolution>`，`RENDER_CANVASES` 白名单，缺失 / 非法为 `''`），渲染层用它决定预览 iframe 的视口 | `PreviewSection.loadFrame` |
| `generateHtml(name, prompt, materials)` | 生成 `index.html`（`materials` = `{ subtitleProject, materialIds }`，**不含音频**；音轨由主进程在落盘后注入） | `index.vue` 的「生成 HTML」按钮 |
| `modifyHtml(name, prompt, materials)` | 基于现有 HTML 改造并覆盖（载荷同上）。提示词含当前 `index.html` 全文 | `index.vue` 的「按需求修改」按钮 |
| `pickMedia(kind)` | 按素材类型打开文件选择框，返回本地绝对路径数组（取消 → 空数组） | `MaterialsSection.onAdd` |
| `addMaterials(name, paths)` | 把所选文件复制进项目并登记进 `materials`，返回登记结果（含被跳过数时的 `message`） | `MaterialsSection.onAdd` |
| `saveMaterials(name, materials)` | 整份素材列表回写（移除与勾选共用） | `MaterialsSection.save` |
| `saveContent(name, content)` | 调 `project:save-content`：写入 `{ style, scenes }`——`style` 取输入框的 `trim()` 值，`scenes` 是当前项目 `content.scenes` 的**原样带回**（整份覆盖，不带就把场景清空） | `index.vue` 的「全局视觉风格」输入框（`onStyleChange`） |
| `downloadHtml(name)` | 另存项目 HTML（主进程把 `./gsap.min.js` 换回 CDN 后写出） | `index.vue.onDownload` |
| `pickAudio()` / `setAudio(name, audioPath)` / `clearAudio(name)` | 背景音频选择 / 设置 / 清空；主进程同时改写 `index.html` 里的注入音轨，`setAudio` 回执的 `audioFile`（项目内相对路径）被交给 `previewUrl()` 试听 | `PreviewSection`（`onPickAudioFile` / `onAudioPick` / `onRemoveAudio`） |
| `extractVideoAudio(name)` | 提取视频原声为背景音频——**本页当前无界面入口**（实现整段被注释，见 3.5），频道与 preload 方法保留 | 无（保留但不可达） |
| `onHtmlProgress(callback)` | 订阅 `IPC.Project.HtmlProgress` 流式进度（单订阅） | `index.vue.onMounted` |
| `setCanvas(name, canvas)` | 调 `project:set-canvas`，写**成片画布方向**（项目属性；白名单校验在主进程，值变化时主进程把 `videoPath` 置空） | `index.vue` 字幕 / 画布行里的画布下拉（`onCanvasChange`） |
| `setRender(name, render \| null)` | 调 `project:set-render`（经 `saveProjectRenderOverride`），写 / 清除项目级渲染档位覆盖 | `index.vue` 档位下拉 |
| `saveVideo(name, videoPath)` | 调 `project:save-video`，渲染成功后把产物路径回写到项目 `project.json` | `index.vue.onRenderVideo` |
| `window.hfTools.renderVideo(htmlPath, { quality, fps, canvas })` | 调 `video:render`，把当前项目 HTML 渲染为 MP4（载荷含 `canvas`：主进程据此往渲染入口注入 `<html data-resolution>`——不传就会被 HyperFrames 兜底成竖屏） | `index.vue.onRenderVideo` |
| `window.voiceTools.listGenerated()` | 已生成音频列表，**仅用于填充「已生成音频」分组** | `PreviewSection.genLoad` |

注册与挂载：`src/renderer/src/pages/index.ts` 中 `import HtmlGenPage from './HtmlGenPage/index.vue'`，注册为 `pages['html-gen']`；页面切换使用 `shallowRef` + 递增的 `pageNavKey` 强制重挂载，因此每次进入本页都会重新执行三个组件的 `onMounted`。

## 8. 注意事项与实现要点

- **写入类动作不再有形态守卫**：`runAgent`、`onPickAudioFile`、`onAudioPick`、`onRemoveAudio`、`onAdd`、`onRemove`、`onToggle`、`openRenderModal`、`onRenderVideo`、`onStyleChange` 的入口只剩并发 / 前置条件校验（`agentRunning`、`rendering`、`busy`、`htmlExists`、`currentName` 等），没有「项目是否只读」这一类判断——项目一律是 `userData/projects/<项目名>/` 下可读可写的普通目录。
- **状态条只放数据、说明走 `?` 气泡**：`.proj-meta` 的 3 格都是「这个项目现在有什么」（HTML / 内容脚本 / 素材），第 4 格「用法」这类操作说明已移到标题右侧的 `.hg-help`；改状态条时不要把说明类文案塞回去（源码注释已写明这条分工）。
- **字幕与画布同一行、各自不再有小标题**：合并的代价是 `.panel-title-sm` 会歧义（「哪个标题管哪个控件」），因此名称交给行内 `.sel-label`；**「全局视觉风格」保留自己的标题**（它仍是独立 `.hgen-block`）。两个下拉宽度刻意不对称（字幕 260px / 画布 188px），原因见第 2 节那一行——不要为了「对齐好看」把字幕收窄。
- **`.hg-help` 在本页的落点**：两个动作按钮内部各 1 个、标题「用法」1 个、字幕 / 画布行 1 个、预览卡「视角比例」行 1 个；**背景音频行的 `?` 本轮已删除**（信息改写进触发器 `title`）。非按钮锚点靠内联覆盖：① `letter-spacing:0`（标题那处挂进带 `2px` 字距的 `.panel-title`）；② 气泡 `top:calc(100% + 8px);bottom:auto`（**向下展开**——锚点在卡片最顶端 / 常被滚到视口顶端，向上会顶出滚动容器 `.content` 的 `overflow-y:auto` 被整块裁掉）。
- **背景音频行是「一行一个控件」的极端形态**（用户本轮原话：「移除给我删了，不选在下拉框里面，占满一行，？也删除了」）：只剩 `sel-label`（56px）+ `HfSelect`（`flex:1` 占满整行）。三条直接后果：① 清空入口只能进下拉（`NONE_AUDIO`「不使用背景音频」，仅在有音频时出现）；② 音轨说明只能进 `title`；③ 弹层宽度 = `max(触发器宽, 220px)`，触发器占满整行 ⇒ 弹层也跟着变宽。
- **「当前值」落在「列表里选中」，不给值再造一块、也不造合成项**（设计规范 `src/renderer/agents.md` §5.7 本轮已按此改写：「当前值优先落在『列表里选中』…不要为它单造一条『当前：…』」）：从「已生成音频」挑出来的那条**就是选中项**（HfSelect 勾选 + 触发器名字），由 `currentAudioIndex` + `watch([currentAudioIndex, genAudios])` 维持；**只有对不上列表的值**（本地导入 / 从视频提取的原声）才在首组退一个同名项（label = 文件名）。**两种更早的反例都被否**：裸 `.hf-file` 会被读成「文件名行」；带底/描边的胶囊块会被读成可点按钮（`.prop-chip` 已连同样式删除）。
- **匹配口径（`currentAudioIndex`）**：`audioFile`（`audio/<文件名>`）对 `genAudios[].path`，两侧都取 `audioBaseName`、再用 `s.replace(/_\d+(?=\.[^.]+$)/, '')` 去掉重名后缀后比较，**对不上返回 `-1`**。这条能成立的前提：主进程 `copyAudioIntoProject()` 复制进项目时**保留原文件名**、重名才补 `_1/_2`——改复制策略会让这里对不上（届时要同步改匹配口径）。
- **选中态只有一个来源**：`watch([currentAudioIndex, genAudios], …, { immediate: true })` 写 `audioPick`（下标串 / `''`）。选中、清空、换项目、列表刚加载完都由它覆盖，**不要在别处再 set 一次 `audioPick`**。
- **哨兵只剩动作两个**：`NONE_AUDIO = '__none__'`（清空）与 `'__file__'`（选本地文件），都是**瞬时**的（`onAudioPick` 立刻复位成「当前项的选中态」）；`CURRENT_AUDIO = '__current__'` **已整个删除**。**不要把哨兵当成真实音频路径**。
- **试听源必须在 `onMounted` 初始化**：`setAudioPreview(audioFile.value)`——`audioPreviewVisible` 原本只在设置 / 清空音频的收尾里被置位，重进页面时它是 `false`，试听那一行就整块消失；传空串时 `setAudioPreview` 会把行收起。
- **画布说明全在一个 `?` 气泡里**（HTML · Agent 卡片那处）：正文是两段拼接——`canvasNote`（computed，随画布变）+ `canvasHint`（普通常量，固定文案）；行内那行 `.hgen-tip` 已删除，「改完要重新生成」统一在动作行上方说一次。**预览卡里不显示画布值**（只留「视角比例」行）。
- **预览视口 = 页面自己声明的画布**：`pageDeclared` 由 `previewHtml()` 回执的 `pageCanvas` 写入，`pageBox = canvasSize(pageDeclared || canvas)` 决定 **iframe 的宽高**；页面没声明（老页面）或声明非法 ⇒ `''` ⇒ 回落成项目当前画布，**行为与旧实现完全一致**。主进程侧的解析在 `project:preview-html`（从**原 HTML** 取，发生在去 CSP / GSAP 本地化之前），见 [main/projects.ts.md](../../../main/projects.ts.md) §5.4。
- **「视角比例」只影响观看、不落盘**：`viewMode` 只换外层容器的**尺寸形状**（`frameStyle`：高度上限 800、宽度按比例）并让 `fitFrame()` 把 `pageBox` **contain** 进去（居中 + 黑边），**iframe 视口与成片都不变**——预览只按**比例**缩放，像素由成片保证（横屏成片仍是 1920×1080）。默认值 = **`pageMode`（页面天然比例）**，此时不留黑边；没有「跟随画布」这一项。`watch(canvas)` 把 `viewMode` 归位到 `pageMode`；`loadFrame()` 只在**用户没手动改过**（`viewMode === 旧 pageMode`）时才跟随页面切换。**因此当页面版式与项目画布不匹配时，预览与成片仍可能不一致**（预览按页面原生画布裁/缩，成片按项目画布渲染）——要让成片也重排，只能靠主进程提示词（`buildCanvasBlock` 第 ⑤ 条）让模型重排后重新生成。
- **`viewHint` 只剩两态、默认态为空**：① 视角比例 ≠ 页面比例（「模拟：按「16:9」观看（左右 / 上下 留黑边）；只影响预览」）；② 页面未声明画布（「本页未声明画布，按当前项目画布的比例显示」）；其余为空串 ⇒ `v-show="viewHint"` 不渲染。模板上**默认态不留任何提示**。
- **预览缩放实现**：**容器尺寸由 `frameStyle` 内联决定**——高度上限 `VIEW_MAX_HEIGHT = 800`、宽度 `min(100%, round(800 × 宽/高)px)`、高度由 `aspect-ratio` 撑、`paddingBottom: '0'` 覆盖 CSS 占位（**宽窗口：16:9 = 1422×800、9:16 = 450×800、1:1 = 800×800；窄窗口宽度退到 100%、高度按比例降，永不裁切**）；iframe 的宽高仍**内联绑定 `pageBox`**（视口 = 页面原生画布 + `transform-origin: 0 0`）；`fitFrame()` 用 **contain** —— `k = Math.min(wrap.clientWidth / pageBox.width, wrap.clientHeight / pageBox.height)`，`tx/ty = (容器尺寸 - pageBox 尺寸 × k) / 2`，最终 `transform: translate(tx, ty) scale(k)`；`watch(canvas)` 先归位 `viewMode` 再 `nextTick(fitFrame)`，`watch(viewMode)` 单独重算一次（容器尺寸随 `frameStyle` 变）。窗口 `resize`（`onMounted` 的 `addEventListener('resize', fitFrame)`）与每次 `load`（`@load="onFrameLoad"` 内调 `fitFrame()`）都会重新缩放。
- **思考文本截断**：展示的是主进程 `thinkText.slice(-20000)` 的结果（仅末尾片段），完整原文写入 userData 下 `html-agent/chat.jsonl`。
- **思考区样式与状态样式互斥**：进度回调每次设置 `status` 都会把 `statusClass` 清空，只有最终成功/失败分支才写入 `hf-ok` / `hf-error`。
- **取消 / 重复提交防护**：`agentRunning` 为模块作用域普通变量（非响应式），`try/finally` 保证复位；并发点击「生成 HTML」/「按需求修改」会被直接 toast 拒绝。渲染与 Agent 互斥：渲染中禁用两个按钮与「转视频」，Agent 处理中调 `openRenderModal` / `onRenderVideo` 都会被 toast 拦下。
- **弹窗与页面级监听**：转视频弹窗用的是通用弹窗类（`.hf-modal-mask` / `.hf-modal*`，与「从音频生成字幕」弹窗同一套），**没有新增 CSS 类**；弹窗节点写在模板末尾（两张卡片之外），靠 `position: fixed` 覆盖全屏。ESC 关闭走 `document` 级 `keydown`（`onModalKeydown`），必须与 `onMounted` / `onBeforeUnmount` 成对，否则切页后会留下悬挂监听。**iframe 的 `message` / `resize` 监听改由 `PreviewSection` 自己成对管理**（含 `seekAckTimer`）。
- **弹窗不承担「取消档位改动」**：质量 / 帧率下拉的 `@change` 仍然即时落盘，点「取消」只关弹窗、不回滚档位；弹窗的语义只是「确认要开始渲染」。
- **进度订阅的单订阅语义**：`onHtmlProgress` 在 preload 中只绑定一次 `ipcRenderer.on`，后续注册仅替换回调；本页因此只需在 `onMounted` 注册、无需（也无法）取消订阅。
- **播放控制边界**：`ctlVisible` 跟随 `frameVisible`；无 `frameSrc` 时点那个三态键只 toast「暂无预览」。**只有一个按钮、三种语义**（播放中 = 暂停 / 播完 = 重新播放 / 其余 = 播放），由 `prevEnded` 判定第三态，**不要再加第二个「重新播放」按钮**。**预览默认静止**：载入完成后不再主动发 `'play'`，`prevPlaying` 置 `false`，按钮文案由画面回报的 `playing` 校准——首帧本来就是空的（合成 `paused: true` + 开头 `opacity: 0`），`.hg-prev-hint` 就是把这句说明写在进度条旁边。
- **进度条拖动跳转（seek）的四条约定**：① 拖动期间不采信画面回报；② 松手后等 `ack`（800ms 兜底）；③ 本地立即跟手，画面侧 `setTime()` 只挪播放头、不改播放/暂停状态；④ 总时长未上报时忽略拖动，并用 `setPointerCapture` 保证拖出控件仍继续收 `pointermove`。
- **预览副本与原件分离**：预览用 `index.preview.html`（剥离 CSP、注入控制脚本），下载与转视频始终使用原件 `index.html`；`pageCanvas` 也是从**原件**解析的，副本里的剥离 / 本地化不影响这个判断。
- **素材的三种「非破坏性」**：勾选只改 `selected`、移除只改列表、移除后项目文件保留；页面 tip 与按钮 `title` 都向用户明说了这三点。
- **`genLoad()` 失败必须静默**：已生成音频只是「已生成音频」分组，不是本页必需；`listGenerated()` 失败时直接返回、该分组为空，不 toast 打断。
- **语速仅影响试听**：`applyRate` / `stepRate` 只改 `playbackRate`，不写磁盘、不影响最终产物。
- **「转视频」用原件而非预览副本**：渲染入参是 `appState.project.htmlPath`（项目 `index.html`），预览用的是 `index.preview.html`，两者不要混用。
- **渲染产物就地落在项目目录里**：MP4 由主进程**就地渲染**直接写在 `<项目目录>/video/output.mp4`；本页调 `projectTools.saveVideo` 把它回写到 `project.json` 的 `videoPath`（**落盘为项目内相对路径 `video/output.mp4`**），因此「视频预览」页进入时才能自动加载。
- **状态区文本与样式成对切换**：`statusDisplay` 与 `statusDisplayClass` 必须一起用（都在 `PreviewSection`）；若只换文本不换样式，渲染中的 trace 文案会继承上一次的 `hf-ok` / `hf-error` 颜色。
- **渲染中切页的语义**：`resetRenderProgress()` 只在 `HtmlGenPage/index.vue` 的挂载与渲染结束时调用；渲染进行中切走再回来，本页会先清空 trace，随后的新 trace 会重新写入（源码注释已说明此取舍）。
- **`hgpreview:` 是本页三种页面资源的共同出口**：`<img :src="thumbUrl(...)">`（`MaterialsSection`）、`iframe.hgen-frame`（`PreviewSection` 的 `loadFrame()`）与 `<audio :src="audioSrc">`（`PreviewSection` 的背景音频试听）都经该协议，因此 `src/renderer/index.html` 的 CSP 需要同时放行 `img-src`、`frame-src` 与 `media-src`。
- **背景音频试听的源从 `file://` 改为 `hgpreview://p/…`**：`setAudioPreview(relFile)` 现在收**项目内相对路径**（设置 / 清空两处调用点传 `res.audioFile` 或 `''`），URL 由 `previewUrl(appState.currentName, relFile, true)` 拼成 `hgpreview://p/<编码项目名>/<逐段编码的相对路径>?v=<时间戳>`；音频与视频一样吃主进程 `rangeResponse()` 的字节范围支持，进度条才能拖。**背景（为什么以前能用）**：旧版 `createWindow()` 用 `mainWindow.loadFile(...)`，**dev 与生产都是 `file://` 源**，`'file:///' + encodeURI(path)` 这批写法当时确实成立（旧树里十余处，Vue 化时整段照搬）；`9615eaf`（electron-vite 重构）引入 `if (process.env['ELECTRON_RENDERER_URL']) loadURL(...) else loadFile(...)` 之后，**dev 渲染页变成 `http://localhost` 源**，Chromium 拒绝 http 页读 `file://`，本卡与配音页的音频试听在 dev 下一直**静默失效**（打包版仍可用，CHANGELOG #25 / #26 / #27）。渲染层现在不再拼 `file://`：路径 → URL 一律经 `src/renderer/src/utils/url.ts`（`previewUrl()` / `ttsUrl()`），**逐段 `encodeURIComponent`** 与主进程「按段 `decodeURIComponent`」严格对应。

## 9. 运行环境缺包守卫（`useEnvGate`）

`转成视频` 需要**不随安装包**的运行环境：`video:render` 需要 `ffmpeg` + `hyperframes`（**两包实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14）；`project:extract-video-audio` 需要 `ffmpeg`（42.6 MB）——但该入口当前已下线（见 3.5），所以本目录现在**只有 `onRenderVideo(skipEnvGuard)` 一个守卫调用点**（分包方案见 `docs/runtime-pack-split.md`、主进程实现见 [main/video.ts.md](../../../main/video.ts.md) / [main/projects.ts.md](../../../main/projects.ts.md)）。

- 动手前先 `const g = await envGate.guard(['ffmpeg','hyperframes'], '转成视频', () => { void onRenderVideo(true) })`；`!g.ok`（缺包已弹框或用户取消）就 `return`，**不发后续 IPC、不产生任何下载**；
- 主进程返回 `res.needPacks`（并发 / 探测窗口造成的二次缺包）时再 `envGate.guard(res.needPacks, '转成视频', …)` 一次；
- 用户在确认框里点「继续」时，`onContinue` 以 `skipEnvGuard = true` 重发同一次操作（**不自动续做**，见 [common.md](../common.md)）；
- 确认框本身由 `App.vue` 内联渲染（`useEnvGate` 是模块级单例），本页只调 `guard()`；**取消下载 = 取消这次转视频**，界面上横幅与设置页仍保留「需要下载」状态与重试入口。
