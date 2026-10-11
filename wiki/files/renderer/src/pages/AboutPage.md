# src/renderer/src/pages/AboutPage/（页面）

> 关于页：纯静态展示，介绍产品定位、反馈邮箱与项目数据存放方式。

- **覆盖文件**：`AboutPage/index.vue`（本目录唯一文件，18 行）
- **所在目录**：`src/renderer/src/pages/AboutPage/`
- **类型**：页面组件（SFC）
- **规模**：18 行
- **对外导出**：默认导出组件（无 props）

## 1. 作用与职责

「关于」页是一个**完全静态**的说明页，没有任何脚本逻辑、响应式状态或副作用：

- 说明产品定位：以「项目」为单位贯通 内容脚本 → 配音 → 字幕 → HTML → 视频 五个创作节点，全部在本地完成。
- 提供问题反馈渠道（邮箱）。
- 说明项目数据在本机的存放位置与目录结构，向用户传达「数据全部本地留存」的信息。

`<script setup lang="ts">` 中仅保留一行注释，说明该模板源自原 `pages/home/template.js` 的 about 模板，移植后无逻辑。

本页**明确不做**的事情：

- 不读取当前项目（不引用 `appState`），因此不展示项目名、路径或产出状态。
- 不调用任何 preload / IPC 方法，不触发文件读写。
- 不渲染 `StepBar`，不参与五节点流水线的链路展示。
- 不声明 `props` / `emits`，不接受父级传入的参数。

## 2. 模板结构

整体是单个卡片容器 `<div class="card hgen-panel" style="max-width:720px">`，内部包含标题、一段提示文本和两行信息。

| 区块 | 元素 | 说明 |
| --- | --- | --- |
| 卡片容器 | `div.card.hgen-panel` | 通过内联 `max-width:720px` 限制宽度，避免内容在宽屏下过散 |
| 标题 | `div.panel-title` > `span.dot` + 文本 | 标题文字为「关于」，`dot` 是主题里的辉光圆点装饰 |
| 定位说明 | `div.hgen-tip` | 一段完整的产品定位描述文案（见下方「实际渲染文案」） |
| 信息行 1 | `div.hgen-row` > `span.sel-label` + `span.hf-file` | 左侧标签「问题反馈」，右侧给出反馈邮箱 |
| 信息行 2 | `div.hgen-row` > `span.sel-label` + `span.hf-file` | 左侧标签「项目数据」，右侧说明本机存储位置与目录构成 |

### 实际渲染文案

| 位置 | 文案 |
| --- | --- |
| 标题 | 关于 |
| `hgen-tip` | 一站式音视频创作流水线：以「项目」为单位贯通 内容脚本 → 配音 → 字幕 → HTML → 视频 五个创作节点，在本地完成从脚本到成片的完整流程。 |
| 标签 1 | 问题反馈 |
| 内容 1 | 使用中遇到问题或有建议，欢迎邮件联系：**2353190325@qq.com** |
| 标签 2 | 项目数据 |
| 内容 2 | 项目保存在本机 video-projects 目录，每个项目一个文件夹（audio/ 音频、video/ 素材与成品、project.json 元数据），全部本地留存。 |

### 复用的全局样式类

| 类名 | 在本页的作用 |
| --- | --- |
| `card` | 卡片外壳（深色面板底、圆角、描边） |
| `hgen-panel` | 面板内边距与排版基线（与「内容脚本」等页保持一致的观感） |
| `panel-title` | 区块标题排版（字号 / 字重 / 下边距） |
| `dot` | 标题前的辉光圆点装饰，与其它面板标题统一 |
| `hgen-tip` | 说明性文本样式（字号更小、颜色更淡） |
| `hgen-row` | 一行「标签 + 内容」的横向布局容器 |
| `sel-label` | 左侧标签样式；本页用内联 `flex:none;width:auto` 覆盖默认宽度 |
| `hf-file` | 右侧内容框样式；本页用内联 `flex:1` 让其占满剩余宽度 |

## 3. 脚本逻辑

### 状态

无。组件未声明任何 `ref` / `reactive` / `computed`。

### 函数

无。组件未定义任何函数，也没有 `onMounted` 等生命周期钩子。

### 依赖

无 `import` 语句。`script setup` 块内只有注释：

```
// pages/AboutPage/index.vue —— 关于页（原 pages/home/template.js 的 about 模板，无逻辑）
```

## 4. 关键流程

因为无逻辑，该页的「流程」仅是渲染链路：

1. **页面挂载**：`goPage('about')` 将 `pages.about` 赋给 `currentPage`，Vue 挂载本组件。
2. **用户交互**：无交互点——没有按钮、表单、输入框或事件绑定；页面展示的信息均为写死的字面量。
3. **落盘持久化**：无。本页不写入任何文件，也不调用任何 IPC。
4. **状态刷新**：无。页面内容不随当前项目变化；项目切换后再进入本页，渲染结果完全相同。

## 5. 依赖与协作

| 项目 | 说明 |
| --- | --- |
| Vue API | 无（未使用 `ref`、`computed`、`onMounted` 等） |
| composables | 无（不引用 `useAppStore` / `useToast`） |
| 子组件 | 无（不引用 `StepBar` 等） |
| IPC / preload | 无 |
| 被谁注册 | `src/renderer/src/pages/index.ts` 中注册为 `pages.about`（对应页面 key `about`） |
| 样式来源 | 复用全局样式类：`card`、`hgen-panel`、`panel-title`、`dot`、`hgen-tip`、`hgen-row`、`sel-label`、`hf-file` |

页面 key `about` 也是 `PageKey` 联合类型的成员之一，与侧栏菜单的 `data-page` 保持一致。

## 6. 注意事项与实现要点

- **纯静态，无任何守卫**：与 `ContentPage` 不同，本页不检查 `appState.isBuiltin`，因为不涉及任何写操作。
- **不展示当前项目信息**：本页刻意与项目上下文解耦，切换项目不会改变其内容。
- **文案中的路径为说明性文本**：`video-projects`、`audio/`、`video/`、`project.json` 均作为提示文字直接渲染，不由代码动态拼接。
- **邮箱为写死的字面量**：`2353190325@qq.com` 使用 `<b>` 加粗强调，未做 `mailto:` 链接。
- **无 `props` 与 `emits`**：父级 `App.vue` 通过 `<component :is="currentPage">` 渲染，不传递任何属性。
- **空态 / 错误提示**：本页不涉及——没有数据请求，因此不存在空态或失败提示分支。
- **与其它页面的对比**：`HomePage`、`ContentPage` 等页面依赖 `appState` 与 `toast`，而本页连 `import` 都没有，是整个页面目录中最简单的组件之一。
- **可安全直接访问**：由于无副作用且无守卫，无论当前项目是「我的项目」还是内置示例（`appState.isBuiltin` 为真），本页渲染结果都完全一致。
- **改动成本低**：文案都在模板中，修改说明文字只需编辑 `.vue` 的模板部分，不涉及任何逻辑或类型。
- **无路由参数**：进入本页只需 `goPage('about')`，无需携带项目名或其它上下文。
- **渲染方式**：由 `App.vue` 通过 `<component :is="currentPage">` 挂载，与其它页面共享同一容器与滚动复位逻辑。
