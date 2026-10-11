# src/renderer/src/pages/ContentPage/（页面）

> 内容脚本编辑器：全局视觉风格 + 场景分镜的增删改排序与保存。

- **覆盖文件**：`ContentPage/index.vue`（本目录唯一文件，106 行）
- **所在目录**：`src/renderer/src/pages/ContentPage/`
- **类型**：页面组件（SFC）
- **规模**：106 行
- **对外导出**：默认导出组件（无 props）

## 1. 作用与职责

本页是五节点流水线的**第一站**，负责编辑当前项目的 `content` 字段：

- **全局视觉风格**：编辑 `content.style`，作用于后续配音 / 字幕 / HTML 生成的整体观感。
- **场景分镜列表**：以 `v-model` 直接编辑 `content.scenes` 数组，每条场景包含 `narration`（旁白）、`visual`（画面分镜）、`durHint`（时长提示，秒）。
- **场景管理**：添加、删除、上移、下移。
- **保存**：经 `window.projectTools.saveContent` 落盘，随后 `refreshProject()` 让链路节点「内容脚本」自动点亮。

原 `pages/content/{template,index}.js` 的 `innerHTML` + `collect()` 手工收集改为响应式 `v-model`；`StepBar` 的响应式刷新取代了原先重调 `renderStepBar`。

## 2. 模板结构

| 区块 | 说明 |
| --- | --- |
| `StepBar :page="'content'"` | 顶部项目链路状态条，高亮「内容脚本」节点，并提供工作项目切换 / 新建 / 打开目录入口 |
| 「内容脚本 · 全局视觉风格」卡片 | `div.card.hgen-panel`，内含 `v-model="style"` 的 `input.hgen-input`，placeholder 说明风格描述的作用范围；下方 `hgen-tip` 提示「留空 = 未指定」 |
| 「场景分镜」卡片 | `div.card.hgen-panel`（`margin-top:16px`），标题为「场景分镜（旁白 + 画面分镜 + 时长提示）」 |
| 空态 | `v-if="!scenes.length"` 时渲染 `div.empty-hint`：「暂无场景。点击「添加场景」开始编写内容脚本。」 |
| 场景块 `v-else` | `v-for="(s, i) in scenes"` :key 为 `s.id`，`div.hgen-block.ct-scene`；标题 `场景 #{{ i + 1 }}` |
| 旁白输入 | `<textarea v-model="s.narration" class="hgen-subtitle">`，高度 84px |
| 画面分镜输入 | `<textarea v-model="s.visual" class="hgen-subtitle">`，高度 64px |
| 时长与操作行 | `<input v-model="s.durHint">`（宽 110px）+ 「上移」（`i === 0` 禁用）+ 「下移」（`i === scenes.length - 1` 禁用）+ 「删除」 |
| 底部操作区 | `div.hgen-actions`：「添加场景」（`@click="add"`）与主按钮「保存到项目」（`@click="save"`） |
| 底部说明 | `hgen-tip` 解释 `<code>旁白</code>` / `<code>画面分镜</code>` / `<code>时长提示</code>` 的用途，并说明保存后节点自动点亮、无内容脚本时默认展示一个空场景 |

## 3. 脚本逻辑

### 类型

| 名称 | 定义 |
| --- | --- |
| `Scene` | `{ id: string; narration: string; visual: string; durHint: string }` |

### 状态

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `style` | `ref<string>` | 全局视觉风格，初值 `''`；绑定到 `input` 的 `v-model` |
| `scenes` | `ref<Scene[]>` | 场景列表，初值 `[]`；每个元素通过 `v-model` 双向绑定到表单控件 |

> 注意：`style` 的 `v-model` 为局部 `ref`，`scenes[i]` 的 `v-model` 是对象属性绑定；两者在 `save()` 中才被组装成 `content` 提交。

### 函数

| 名称 | 说明 |
| --- | --- |
| `emptyScene(): Scene` | 生成空场景，`id` 为 `'scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)`，其余字段均为 `''` |
| `load(): void` | 页面挂载时加载数据（详见第 4 节） |
| `add(): void` | 向 `scenes.value` 推入一个 `emptyScene()` |
| `remove(i: number): void` | `scenes.value.splice(i, 1)`；若删除后数组为空，立即补一个 `emptyScene()`，保证始终至少有一个场景块 |
| `move(i: number, delta: number): void` | 目标下标 `j = i + delta`，越界（`j < 0 || j >= scenes.value.length`）直接 `return`；否则交换 `scenes.value[i]` 与 `scenes.value[j]` |
| `save(): Promise<void>` | 保存到项目（详见第 4 节） |

### 生命周期

| 钩子 | 调用 |
| --- | --- |
| `onMounted` | `load` |

## 4. 关键流程

### 4.1 页面挂载加载数据（`load`）

1. 取 `const content = (appState.project && appState.project.content) || { style: '', scenes: [] }`。
2. `style.value = content.style || ''`。
3. `scenes.value = (Array.isArray(content.scenes) ? content.scenes : []).map(...)`，逐字段做类型守卫：
   - `id`：非空字符串则 `trim()` 后保留，否则新生成一个 `scene-...` 形式的 id；
   - `narration` / `visual`：仅接受字符串，否则 `''`；
   - `durHint`：`undefined` / `null` 转为 `''`，其余用 `String(...)` 转换。
4. 若 `!scenes.value.length`，推入一个 `emptyScene()`——即「已有项目无内容脚本时默认展示一个空场景」。

### 4.2 用户交互

- 修改风格或任一场景字段：`v-model` 直接写入 `style.value` / `scenes.value[i].narration` / `.visual` / `.durHint`。
- 「添加场景」→ `add()`；「删除」→ `remove(i)`；「上移 / 下移」→ `move(i, -1)` / `move(i, 1)`。
- 首个场景的「上移」与末个场景的「下移」按钮通过 `:disabled` 置灰。

### 4.3 落盘持久化（`save`）

1. 组装载荷：
   ```ts
   const content = {
     style: style.value.trim(),
     scenes: scenes.value.map((s) => ({ id: s.id, narration: s.narration, visual: s.visual, durHint: s.durHint }))
   }
   ```
2. `const res = await window.projectTools.saveContent(appState.currentName, content)`。
3. 失败处理：`if (!res || !res.ok) { toast(res?.message || '保存失败'); return; }`。

### 4.4 状态刷新

1. `await refreshProject()` 重新拉取 `appState.myProjects` 与当前项目详情，`hasContent` 随之变为真，`StepBar` 与首页流水线的「内容脚本」节点自动点亮。
2. `toast('内容脚本已保存：' + scenes.value.length + ' 个场景' + (content.style ? '，风格「' + content.style + '」' : ''))`。

## 5. 依赖与协作

**导入**

| 来源 | 引入内容 |
| --- | --- |
| `vue` | `onMounted`、`ref` |
| `@renderer/composables/useAppStore` | `appState`、`refreshProject` |
| `@renderer/composables/useToast` | `toast` |
| `@renderer/components/StepBar.vue` | `StepBar`（以 `:page="'content'"` 传入页面 key） |

**调用的 IPC / preload 方法**

| 方法 | 用途 |
| --- | --- |
| `window.projectTools.saveContent(appState.currentName, content)` | 将 `{ style, scenes }` 写入当前项目的 `project.json` |
| `window.projectTools.load(...)`（经 `refreshProject`） | 重新加载当前项目详情，`load()` 从中读取 `content` |

**注册关系**：在 `src/renderer/src/pages/index.ts` 中作为 `pages.content` 注册，对应页面 key `content`（与 `StepBar`、`HomePage` 流水线的 `page: 'content'` 一致）。

## 6. 注意事项与实现要点

- **保存没有前置拦截**：`save()` 只做「组装载荷 → 调 `project:save-content` → 失败 toast」三步，不检查项目形态；每个项目都是可读可写的普通目录。
- **空数组自动补位**：`load()` 与 `remove()` 都会在 `scenes` 为空时补一个 `emptyScene()`，因此「空态提示」实际上只在极短暂的初始渲染阶段可能出现（`scenes` 初始为 `[]`，`onMounted` 后即被填充）。
- **`v-model` 直接改对象**：`s.narration` / `s.visual` / `s.durHint` 都是对 `scenes.value[i]` 属性的直接绑定，没有 `collect()` 收集步骤；`save()` 时再做一次显式字段挑选（只提交 `id` / `narration` / `visual` / `durHint`）。
- **`durHint` 以字符串保存**：`Scene.durHint` 类型为 `string`，`load()` 用 `String(item.durHint)` 归一化，输入框 placeholder 为「可空」。
- **`style` 提交前 `trim()`**：空字符串表示「未指定」，此时保存提示中不拼接风格片段。
- **错误提示统一形态**：所有失败分支都用 `toast`，并优先取结果对象上的 `message` 字段，缺失时回退到固定文案（`'创建失败'` 形态的 `'保存失败'`）。
- **响应式刷新链路**：`saveContent` → `refreshProject()` → `hasContent` computed 变化 → `StepBar` 与 `HomePage.flowDefs` 自动更新，无需手动调用渲染函数。
- **`StepBar` 的页面 key**：本页传入字面量 `'content'`，同时用于节点高亮 `active-now` 与「切换项目后重进当前页」的 `goPage(props.page)`。
