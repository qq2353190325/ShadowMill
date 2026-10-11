# src/renderer/src/pages/SoundCopyPage/（页面）

> 音色管理页：创建克隆音色、查看音色列表、维护本地映射

- **覆盖文件**：`SoundCopyPage/index.vue`（本目录唯一文件，308 行）
- **所在目录**：`src/renderer/src/pages/SoundCopyPage/`
- **类型**：页面组件（Vue 3 `<script setup lang="ts">` SFC）
- **规模**：308 行
- **对外导出**：默认导出页面组件；**无 props**（`StepBar` 由组件内部固定传 `:page="'sound-copy'"`）
- **来源**：文件头注释标明由原 `pages/soundCopy/{template,index}.js` 移植，状态缓存（`models` / `sysVoices` / `cloudVoices` / `profiles`）由旧闭包变量改为 `ref`，下拉列表改由 `v-for` 响应式填充。

## 1. 作用与职责

本页是流水线中「配音」环节的**音色资产中心**，页面本身不合成音频，只做三件事：

1. **创建克隆音色**：选择目标模型 → 提供人声音频（粘贴可公开访问的 URL 或上传本地文件）→ 调用 `window.voiceTools.create` 在云端创建克隆音色，并把「中文显示名 + 绑定模型」写入本机 `settings.json`。
2. **展示「我的音色」**：把系统音色（`listSystemVoices`）与云端克隆音色（`list`）合并成一张表，叠加本地映射（`getProfiles`）后给出中文显示名与所属合成模型。
3. **维护本地映射**：「音色映射管理」区可为任意音色（系统 / 克隆）设置本地中文显示名与合成模型（`saveProfile`），或解除映射（`deleteProfile`）。

页面顶部固定渲染 `StepBar`，与内容脚本、字幕、HTML、视频各页共享项目链路状态与工作项目切换器。

## 2. 模板结构

模板由 3 张 `div.card.hgen-panel` 卡片顺序组成。

| 区块 | 说明 |
| --- | --- |
| `<StepBar :page="'sound-copy'" />` | 顶部步骤条；`'sound-copy'` 用于「配音」节点高亮（`StepBar.vue` 中 `text-tts` 与 `sound-copy` 同属配音节点），并提供工作项目切换入口 |
| **卡片 1**：`音色管理 · 创建克隆音色` | 标题由 `<span class="dot">` + 文本构成；`div.hgen-tip` 说明创建计费（0.01 元/个）、模型与音色的绑定关系，以及两类模型各自的输入要求 |
| ├ 目标模型与输入方式联动区 | `select` 绑定 `vcModel`，选项来自 `cloneModels`（`m.id` / `m.label`），`@change="applyInputMode(vcModel)"`；`v-show="!urlMode"` 的行显示「选择音频文件」按钮 + `audioPath ? escTxt(audioPath) : '未选择文件'`；`v-show="urlMode"` 的行显示「音频 URL」输入框（`v-model="vcUrl"`） |
| ├ `qwen-audio-*`（如 `qwen-audio-3.0-tts-flash`） | 正则 `/^qwen-audio-.*-tts/i` 命中 → `urlMode = true`，显示「粘贴音频 URL」行，隐藏本地文件行（提示明确指出该模型克隆不接受本地文件直传） |
| ├ `qwen3-tts-vc-*` 系列 | 正则不命中 → `urlMode = false`，显示「上传本地文件」行（`.wav / .mp3 / .m4a`，Base64 后需小于 10 MB） |
| ├ 克隆名称与提交 | 「显示名称」`input`（`v-model="vcName"`，占位符提示支持中文，如「旁白」）；`div.hgen-actions` 内两个按钮：「创建音色」（`hf-btn-primary`，`@click="onCreate"`）与「API Key 设置」（`@click="goPage('settings')"`）；下方 `div.hf-status`（`:class="statusClass"`）显示本卡状态 |
| **卡片 2**：`我的音色` | 顶部 `div.hf-status`（`:class="listStatusClass"`）显示 `listStatus`；`voiceList` 为空时渲染空态文案 `暂无音色。可在上方「创建克隆音色」区创建，或到「配音」页使用内置系统音色。` |
| ├ 列表表头与行 | 三列网格（`1.5fr 1.2fr 1fr`）：`显示名称` / `音色 ID（合成模型）` / `创建时间 / 参数`；`v-for="it in voiceList" :key="it.key"` 渲染行 |
| ├ 系统音色行 | `it.type === 'system'` 时名称后标注 `[系统]`；`it.name` 取映射名，否则退回 `v.desc`；第三列固定文案 `系统音色` |
| ├ 云端（克隆）音色行 | `it.type !== 'system'` 时标注 `[克隆]`；`it.name` 取映射名，否则退回 `v.voice`；第三列显示 `gmt_create` |
| ├ 本地映射编辑入口 | 第二列是一个 `button.hf-btn`，文案 `{{ escTxt(it.voice) }}（{{ escTxt(it.targetModel) }}）`，`@click="editVoice(it.key)"` —— 点击即把映射管理区的下拉切到该音色并滚动到位 |
| └ 刷新按钮 | `div.hgen-actions` 内「刷新音色列表」`@click="loadAll(false)"`（非静默，会先写 `listStatus`） |
| **卡片 3**：`音色映射管理` | `div.hgen-tip` 说明：显示名与模型**仅保存在本机 `settings.json`**；系统音色不传中文名时使用默认描述，不选模型时使用该音色默认合成模型 |
| ├ 音色选择 | `select` 带 `ref="mapVoiceEl"`、`v-model="mapVoice"`、`@change="syncMapForm"`，选项来自 `mapOptions`（`value` / `label`） |
| ├ 本地显示名编辑 | 「显示名称」`input`（`v-model="mapName"`），占位符说明留空时的回退规则（系统音色用内置描述，克隆音色用其 ID） |
| ├ 绑定模型编辑 | 「合成模型」`select`（`v-model="mapModel"`），选项来自**全部** `models`（非仅 `cloneModels`） |
| ├ 保存 / 删除映射 | 「保存映射」（`hf-btn-primary`，`@click="onSaveMap"`）与「解除映射」（`@click="onClearMap"`） |
| └ 状态 | `div.hf-status`（`:class="mapStatusClass"`）显示 `mapStatus` |

三张卡片复用同一套样式类，语义如下：

| 类名 | 出现位置 | 说明 |
| --- | --- | --- |
| `card hgen-panel` | 三张卡片外层 | 卡片容器；第 2、3 张额外带 `style="margin-top:16px"` 做间距 |
| `panel-title` + `span.dot` | 每张卡片标题 | 标题前缀的小圆点装饰 |
| `hgen-tip` | 卡片 1、卡片 3 | 说明性灰字（卡片 2 的空态也复用它） |
| `hgen-row` | 各表单行 | 一行标签 + 控件；`sel-label` 为行标签 |
| `hgen-input` / `hgen-select` | 输入框 / 下拉 | 均带 `style="flex:1"` 撑满该行剩余宽度 |
| `hgen-actions` | 按钮行 | 卡片操作按钮容器 |
| `hf-status` | 三处状态行 | 配合 `hf-ok` / `hf-error` / 空字符串切换颜色与图标 |

## 3. 脚本逻辑

### 3.1 状态

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `models` | `Ref<ModelView[]>` | 全部可选模型，由 `window.voiceTools.listModels()` 填充 |
| `cloneModels` | `ComputedRef<ModelView[]>` | `models.value.filter((m) => m.role === 'clone')`，供「目标模型」下拉使用 |
| `sysVoices` | `Ref<SysVoiceView[]>` | 系统音色，`voice` / `desc` / `langs` / `series` / `model` |
| `cloudVoices` | `Ref<CloudVoiceView[]>` | 云端克隆音色，字段为 snake_case：`voice` / `target_model?` / `gmt_create?` |
| `profiles` | `Ref<Record<string, ProfileView>>` | 本地音色映射表，key 形如 `system:<voice>` 或 `custom:<voice_id>` |
| `vcName` | `Ref<string>` | 创建克隆音色的显示名称（可含中文） |
| `vcModel` | `Ref<string>` | 目标模型 ID，初值来自配置或 `'qwen-audio-3.0-tts-flash'` |
| `vcUrl` | `Ref<string>` | URL 模式下的音频地址 |
| `audioPath` | `Ref<string \| null>` | 本地音频文件绝对路径，`null` 表示未选择 |
| `urlMode` | `Ref<boolean>` | 是否处于「粘贴音频 URL」模式，由 `applyInputMode` 决定 |
| `status` / `statusClass` | `Ref<string>` | 创建卡片的状态文案与 class（`hf-ok` / `hf-error` / 空） |
| `listStatus` / `listStatusClass` | `Ref<string>` | 「我的音色」列表的状态文案与 class |
| `mapStatus` / `mapStatusClass` | `Ref<string>` | 「音色映射管理」的状态文案与 class |
| `mapVoiceEl` | `Ref<HTMLSelectElement \| null>` | 映射区音色下拉的 DOM 引用，仅用于 `scrollIntoView` |
| `mapVoice` | `Ref<string>` | 映射区当前选中的音色 key |
| `mapName` | `Ref<string>` | 映射区的本地显示名 |
| `mapModel` | `Ref<string>` | 映射区选择的合成模型 |
| `mapOptions` | `ComputedRef<{ value: string; label: string; type: string; voice: string; model: string }[]>` | 系统音色（`[系统] <desc>（<voice>）`）+ 克隆音色（`[克隆] <voice>`）合并选项 |
| `voiceList` | `ComputedRef<{ key; name; voice; targetModel; type; extra }[]>` | 「我的音色」表格数据，由 `sysVoices` + `cloudVoices` + `profiles` 合成 |

### 3.2 接口类型（本文件内声明）

| 名称 | 字段 |
| --- | --- |
| `ModelView` | `id`、`label`、`role?`、`input?`、`isDefault?` |
| `SysVoiceView` | `voice`、`desc`、`langs`、`series: string[]`、`model` |
| `CloudVoiceView` | `voice`、`target_model?`、`gmt_create?` |
| `ProfileView` | `key`、`name`、`voice`、`targetModel`、`type` |

### 3.3 函数

| 名称 | 说明 |
| --- | --- |
| `toAsciiName(raw)` | `String(raw \|\| '').trim().replace(/[^A-Za-z0-9_]/g, '')`，剥离所有非 ASCII 字母/数字/下划线字符 |
| `genAsciiName(raw)` | 在 `toAsciiName` 基础上做克隆提交名校验：结果为空时回退为 `'myvoice' + Date.now().toString().slice(-8)`；长度 > 16 时 `slice(0, 16)`，最终保证 **1~16 位 ASCII** |
| `applyInputMode(m)` | `urlMode.value = /^qwen-audio-.*-tts/i.test(String(m \|\| ''))`，模型切换时的输入方式联动 |
| `getCfg()` | 调 `window.voiceTools.getConfig()`，`ok` 为真则返回配置，异常或失败返回 `null` |
| `requireCfg()` | 在 `getCfg` 之上做「配置存在且 `apiKey` 非空」校验；不满足时写 `status`/`statusClass = 'hf-error'` 并 `goPage('settings')`，返回 `null` |
| `onPick()` | 先 `requireCfg()`，再 `window.voiceTools.pickAudio()`，成功则写入 `audioPath` |
| `onCreate()` | 创建克隆音色的主流程（详见第 4 节） |
| `loadAll(silent)` | 并行拉取 `listSystemVoices` / `list` / `getProfiles`，写入三个 ref；随后校正 `mapVoice` 初值、调 `syncMapForm()`、更新 `listStatus` |
| `syncMapForm()` | 依据 `mapVoice` 找到 `profiles[key]` 与 `mapOptions` 中对应项，回填 `mapName`（无映射则空）与 `mapModel`（无映射则用该项默认模型 `opt.model`） |
| `editVoice(key)` | 供列表按钮调用：`mapVoice.value = key` → `syncMapForm()` → `mapVoiceEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })` |
| `onSaveMap()` | 校验 `mapVoice` 与 `mapOptions` 命中项，调 `saveProfile({ key, name: name \|\| undefined, voice, targetModel, type })`；`type` 归一化为 `'system'` / `'custom'`；成功后用返回的 `res.profiles` 覆盖本地 `profiles` |
| `onClearMap()` | 调 `deleteProfile(key)` 解除本地映射，成功后同步 `profiles`；文案明确「云端克隆音色本身未删除」 |
| `onMounted(async () => {...})` | 并行 `getConfig` / `listModels`，初始化 `models`、`vcModel`、`mapModel`，执行 `applyInputMode(vcModel.value)`，最后 `loadAll(true)` |

### 3.4 状态文案与 class 对照

| 触发点 | 状态文案 | class |
| --- | --- | --- |
| `requireCfg` 缺少 API Key | `尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写` | `hf-error` |
| `onCreate` 显示名为空 | `请填写显示名称` | `hf-error` |
| `onCreate` URL 模式且 URL 为空 | `请填写可公开访问的音频文件地址（URL）` | `hf-error` |
| `onCreate` 文件模式且未选文件 | `请先选择音频文件` | `hf-error` |
| `onCreate` URL 模式提交中 | `正在使用音频 URL 创建音色（约几秒）…` | `''` |
| `onCreate` 文件模式提交中 | `正在上传音频并创建音色（约几秒）…` | `''` |
| `onCreate` 成功 | `音色创建成功，已绑定中文名「<name>」与模型「<targetModel>」`（降级时追加 `（降级模式：<reason>）`） | `hf-ok` |
| `onCreate` 失败 | `res.message \|\| '创建失败'` | `hf-error` |
| `loadAll(false)` 开始 | `拉取音色与映射…` | `''` |
| `loadAll` 结束 | `系统音色 <N> 个 · 克隆音色 <M> 个` | `hf-ok` |
| `onSaveMap` 未选音色 | `请先选择要管理的音色` | `hf-error` |
| `onSaveMap` 成功 | `映射已保存`（有名字时追加 `：<name>`） | `hf-ok` |
| `onSaveMap` 失败 | `res.message \|\| '保存失败'` | `hf-error` |
| `onClearMap` 未选音色 | `请先选择要解除映射的音色` | `hf-error` |
| `onClearMap` 成功 | `已解除该音色的本地映射（云端克隆音色本身未删除）` | `hf-ok` |
| `onClearMap` 失败 | `res.message \|\| '解除失败'` | `hf-error` |

## 4. 关键流程

1. **挂载加载**：`onMounted` 用 `Promise.all` 并发 `getConfig()` 与 `listModels()`（各自 `.catch` 兜底）。`models.value = mm.models || []`；配置失败时 `cfg` 退化为 `{ targetModel: 'qwen-audio-3.0-tts-flash' }`，`vcModel` 取 `cfg.targetModel || 'qwen-audio-3.0-tts-flash'`，`mapModel` 取 `cfg.targetModel || ''`；随后 `applyInputMode(vcModel.value)` 决定初始输入方式，最后 `loadAll(true)`（静默）拉取音色与映射。
2. **模型切换联动输入方式**：用户在下拉中选择模型触发 `@change="applyInputMode(vcModel)"`。命中 `/^qwen-audio-.*-tts/i` → 显示 URL 输入行、隐藏本地文件行；命中 `qwen3-tts-vc-*` → 反之。
3. **克隆音色（音频 URL 模式）**：`requireCfg()` 通过 → 校验显示名非空 → `applyInputMode(targetModel)` → 校验 `vcUrl` 非空 → 状态置「正在使用音频 URL 创建音色（约几秒）…」→ `window.voiceTools.create(u, genAsciiName(name), targetModel)`。成功后立刻 `saveProfile({ key: 'custom:' + res.voice, name, voice: res.voice, targetModel, type: 'custom' })` 绑定中文名与模型，状态置 `hf-ok` 并 `loadAll(true)` 刷新列表。
4. **克隆音色（本地文件模式）**：同上前置步骤，但先校验 `audioPath` 非空（否则提示「请先选择音频文件」），再调 `window.voiceTools.create(audioPath.value, genAsciiName(name), targetModel)`，成功分支与 URL 模式完全一致。
5. **失败回退提示**：`create` 返回 `ok: false` 时，取 `res.message || '创建失败'` 并以 `hf-error` 展示；成功但 `res.fallbackMode` 为真时，状态文案追加 `（降级模式：<escTxt(res.fallbackReason || '')>）`。
6. **保存本地映射**：`onSaveMap` 从 `mapOptions` 反查被管理音色的真实 `voice` 与 `type`，调 `saveProfile`；成功用返回值覆盖 `profiles` 并提示 `映射已保存`（有名字时追加 `：<name>`），失败提示 `res.message || '保存失败'`。
7. **删除映射**：`onClearMap` 调 `deleteProfile(key)`；成功覆盖 `profiles` 并提示「已解除该音色的本地映射（云端克隆音色本身未删除）」。
8. **跳转到配音页**：本页自身不调用 `goPage('text-tts')`；页面内仅通过 `goPage('settings')` 跳设置页（「API Key 设置」按钮与 `requireCfg` 失败分支）。跳往配音相关页面由 `StepBar` 的「配音」节点（`goPage('text-tts')`）与左侧菜单完成。

流程小结（调用顺序）：

| 场景 | 调用链 |
| --- | --- |
| 进入页面 | `onMounted` → `voiceTools.getConfig` ∥ `voiceTools.listModels` → `applyInputMode` → `loadAll(true)` → `listSystemVoices` ∥ `list` ∥ `getProfiles` → `syncMapForm` |
| 选择本地音频 | `onPick` → `requireCfg` → `voiceTools.getConfig` → `voiceTools.pickAudio` |
| 创建（URL） | `onCreate` → `requireCfg` → `applyInputMode` → `voiceTools.create` → `voiceTools.saveProfile` → `loadAll(true)` |
| 创建（文件） | `onCreate` → `requireCfg` → `voiceTools.create` → `voiceTools.saveProfile` → `loadAll(true)` |
| 点列表行编辑 | `editVoice(key)` → `syncMapForm` → `mapVoiceEl.scrollIntoView` |
| 保存映射 | `onSaveMap` → `voiceTools.saveProfile` → 覆盖 `profiles` |
| 解除映射 | `onClearMap` → `voiceTools.deleteProfile` → 覆盖 `profiles` |
| 手动刷新列表 | `loadAll(false)` → 三个查询 IPC + `syncMapForm` |

## 5. 依赖与协作

| 来源 | 导入项 | 用途 |
| --- | --- | --- |
| `vue` | `computed`、`onMounted`、`ref` | 状态与派生数据 |
| `@renderer/pages` | `goPage` | 跳转「设置」页；同时本文件被 `pages/index.ts` 以 key **`'sound-copy'`** 注册进 `pages` 注册表（`currentPage` 为 `shallowRef`，`goPage` 递增 `pageNavKey` 强制重挂载） |
| `@renderer/composables/useToast` | `toast` | **已导入但文件内无任何调用点**（详见第 6 节） |
| `@renderer/utils/escape` | `escTxt` | 对文件路径、音色 ID、模型名、`extra` 等做输出转义 |
| `@renderer/components/StepBar.vue` | `StepBar` | 顶部步骤条 + 工作项目切换器 |
| `window.voiceTools` | `getConfig()` | 读取千问语音配置（`apiKey` / `targetModel` / `saveDir`） |
| `window.voiceTools` | `pickAudio()` | 选择本地音频文件，返回路径或 `null` |
| `window.voiceTools` | `create(audioPath, preferredName, targetModel)` | 创建克隆音色，返回 `voice` / `targetModel` / `fallbackMode` / `fallbackReason` |
| `window.voiceTools` | `listSystemVoices()` | 系统音色列表 |
| `window.voiceTools` | `list()` | 云端克隆音色列表 |
| `window.voiceTools` | `listModels()` | 全部模型（`role === 'clone'` 的进入「目标模型」下拉） |
| `window.voiceTools` | `getProfiles()` | 本地映射表 |
| `window.voiceTools` | `saveProfile(profile)` | 保存 / 更新映射，返回新的 `profiles` |
| `window.voiceTools` | `deleteProfile(key)` | 解除映射，返回新的 `profiles` |

映射数据持久化在 `AppSettings.voiceProfiles`（`Record<string, VoiceProfile>`，key 形如 `"system:Cherry"` / `"custom:<voice_id>"`），即本机 `settings.json`。

## 6. 注意事项与实现要点

- **API Key 缺失提示**：`requireCfg()` 是创建与选文件的前置闸门。未配置时会写状态「尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写」、置 `hf-error`，并**自动跳转设置页**；`loadAll` 与映射管理不经过该校验，因此无 Key 时仍能看到列表（取决于 IPC 返回）并编辑映射。
- **名称校验（1~16 位 ASCII）**：`vcName` 允许中文，但提交给云端的名字必须过 `genAsciiName`——剥离 `[^A-Za-z0-9_]`，为空则用 `myvoice` + `Date.now()` 末 8 位（共 15 位），超 16 位截断。中文原文只作为本地「显示名称」通过 `saveProfile` 保存。`onCreate` 仅校验显示名非空，不做长度/字符前置提示，无效字符是**静默剥离**的。
- **输入方式与模型的强绑定**：`urlMode` 只由正则 `/^qwen-audio-.*-tts/i` 决定；`onCreate` 前会再次 `applyInputMode(targetModel)`，避免下拉未触发 `change` 时模式不同步。URL 模式不读 `audioPath`，文件模式不读 `vcUrl`。
- **失败与降级**：创建失败取 `res.message`；成功但服务端走了降级路径时，状态里附 `fallbackMode` / `fallbackReason`，提示用户该音色绑定的可能不是首选模型。
- **列表合并与回退规则**：`voiceList` 中系统音色名称回退顺序为 `profiles[key].name → v.desc`，模型为 `profiles[key].targetModel → v.model`；克隆音色名称为 `profiles[key].name → v.voice`，模型为 `profiles[key].targetModel → v.target_model`。类型标签只有 `[系统]` / `[克隆]` 两种。
- **映射管理区的默认模型**：`syncMapForm()` 在无映射时用 `opt.model`（系统音色取 `v.model`，克隆音色取 `v.target_model`）预填，「合成模型」下拉却是**全部** `models`，因此理论上可为任意音色挑选非克隆类模型。
- **空态**：`voiceList.length === 0` 时只显示空态提示，表头也不渲染；此时 `mapOptions` 为空，映射区下拉无可选项，`onSaveMap`/`onClearMap` 会命中「请先选择要管理的音色 / 解除映射的音色」分支（`hf-error`）。
- **`mapVoice` 初值**：`loadAll` 中仅当 `mapOptions` 非空且 `mapVoice` 为空时取第一项，避免刷新覆盖用户当前选择。
- **错误提示承载方式**：本页所有反馈走卡片内 `div.hf-status`（`status` / `listStatus` / `mapStatus` 三套独立状态），未使用 toast；`toast` 虽在顶部 import 却无调用点，属于可清理的死导入。
- **内置示例与项目上下文**：本页的音色资产是**全局**的（系统音色 + 云端克隆 + 本机 `settings.json` 映射），与当前「工作项目」无耦合；`StepBar` 切换项目或内置示例不会改变音色列表内容，仅通过 `goPage` 的强制重挂载重跑 `onMounted` 重新拉取。
- **状态复位**：切换页面会因 `pageNavKey` 递增而重建组件实例，`status` / `mapStatus` 等本地状态随之清零。
