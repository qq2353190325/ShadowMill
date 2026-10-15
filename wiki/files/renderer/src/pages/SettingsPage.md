# src/renderer/src/pages/SettingsPage/（页面）

> 设置页：**一个页面目录 = 一个 66 行外壳 + 5 个区块组件**。外壳 `index.vue` 只负责「显示哪一类」——左侧 5 类平级导航（`v-for` 渲染 `SETTINGS_NAV_ITEMS`）+ 右侧挂载当前分类（`whisper` 走独立的 `.card.hgen-panel` 分支，其余分类走 `<component :is="SECTION_COMPONENTS[activeSection]">`）+ 分类记忆 + 跨页导航意图消费；页面正文按分类分布在 `components/` 下，各区块自带状态与 IPC 调用（卡片外壳：`model` / `voice` / `render` / `update` 四类自带，`WhisperSection` 由外壳提供）。**挂载即读配置**：切换分类 = 卸载旧区块、挂载新区块，各区块的配置读取都在自己的 `onMounted` 里，未选中的分类不跑 IPC。

- **覆盖文件**（9 个）：

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/renderer/src/pages/SettingsPage/index.vue` | 66 | 外壳：左侧 5 类导航（`v-for` 渲染 `SETTINGS_NAV_ITEMS`）+ 右侧挂载当前分类（`whisper` 的 `.card.hgen-panel` 分支写在模板里，其余分类走 `<component :is="SECTION_COMPONENTS[activeSection]">`）+ 分类记忆 + 意图消费 |
| `src/renderer/src/pages/SettingsPage/types.ts` | 12 | 页面类型出口：`export type { VoiceProviderView } from '@shared/types'`、`export type UpdateCheckReply = IpcResult<UpdateCheckResult>` |
| `src/renderer/src/pages/SettingsPage/constants.ts` | 32 | 页面级常量：`CUSTOM_VALUE = '__custom__'`、`SETTINGS_SECTION_KEY = STORAGE_KEY_SETTINGS_SECTION`、`SETTINGS_NAV_ITEMS`（5 项：模型配置 / 语音服务 / 渲染档位 / 语音识别模型 / 应用更新）、`SETTINGS_SECTION_KEYS = SETTINGS_SECTIONS` |
| `src/renderer/src/pages/SettingsPage/helpers.ts` | 56 | 分类状态：`activeSection`（模块级 ref）+ `persistActiveSection` / `applySection` / `applySectionIntent` / `watchSectionIntent` + `updateStage`（模块级 ref，供导航红点） |
| `src/renderer/src/pages/SettingsPage/components/ModelSection.vue` | 162 | 「模型配置」区块：自定义模型（Base URL / 模型 ID 预设联动、API Key、启用、保存、测试连接） |
| `src/renderer/src/pages/SettingsPage/components/VoiceSection.vue` | 85 | 「语音服务」区块（按厂家：厂家下拉 + API Key） |
| `src/renderer/src/pages/SettingsPage/components/RenderSection.vue` | 74 | 「渲染档位」区块：视频渲染默认档位（质量 / 帧率） |
| `src/renderer/src/pages/SettingsPage/components/WhisperSection.vue` | 274 | 「语音识别模型」区块（whisper.cpp：模型网格、下载 / 删除 / 设为当前、自定义模型登记、状态与进度条；**卡片外壳 / 标题 / 长说明由外壳 `index.vue` 提供**） |
| `src/renderer/src/pages/SettingsPage/components/UpdateSection.vue` | 385 | 「应用更新」区块（版本 / 检查 / 下载 / 安装 / 更新源弹窗）+ 运行环境一行三态 + 本地导入 |

- **类型**：6 个 SFC（外壳 1 + 区块 5，均 `<script setup lang="ts">`）+ 3 个普通 `.ts`（类型出口 / 常量 / 助手）
- **对外导出**：SFC 全部为默认导出组件，**无 props、无 emit**（外壳用 `<component :is>` 挂载区块，不传 props、不监听事件；区块状态全部内部维护，唯一跨组件共享的是 `helpers.ts` 的两个模块级 ref）；`constants.ts` 导出 `CUSTOM_VALUE` / `SETTINGS_SECTION_KEY` / `interface SettingsNavItem` / `SETTINGS_NAV_ITEMS` / `SETTINGS_SECTION_KEYS`；`helpers.ts` 导出 `activeSection` / `persistActiveSection` / `applySection` / `applySectionIntent` / `watchSectionIntent` / `updateStage`；`types.ts` 只做类型转出
- **持久化**：配置写入本机 `userData/settings.json`（表单式「读 → 改 → 保存」，读的人变成「当前挂载的那个区块」）；**左侧分类的记忆**（`'model'` / `'voice'` / `'render'` / `'whisper'` / `'update'` 五类）另存在渲染层 `localStorage`，键名取 `@renderer/constants` 的 `STORAGE_KEY_SETTINGS_SECTION`（值 `'myapp.settingsSection'`，在 `constants.ts` 里落到页面级 `SETTINGS_SECTION_KEY`），读写都在 `helpers.ts`，**不跟随品牌改名**（见 §5.17、§5.18）

## 1. 结构总览

外壳模板只有三块：`.settings-layout` 下的 `.settings-nav`（5 个分类按钮）+ `.settings-content`（当前分类的区块）。`SECTION_COMPONENTS` 只有 **4 个键**（`model` / `voice` / `render` / `update`），**`whisper` 不在表里**——它的卡片外壳、标题与长说明由外壳给（子组件本体只画模型网格与表单），所以模板里它是独立的 `v-if` 分支，其余分类走 `v-else-if="activeSection !== 'whisper'"` 的 `<component :is>`：

| 分类 key | 导航标签 | 区块组件 | 行数 | 内容 |
|---|---|---|---|---|
| `model` | 模型配置 | `components/ModelSection.vue` | 162 | 自定义模型：Base URL（预设下拉 / 手填二选一）/ 模型 ID（同）/ API Key / 启用 + 保存配置 / 测试连接 |
| `voice` | 语音服务 | `components/VoiceSection.vue` | 85 | 语音服务（按厂家配置）：厂家下拉 + API Key（placeholder 来自厂家）+ 「保存该厂家配置」。**只有 API Key**：模型与音色由厂家目录固定，没有「厂家默认模型」这类全局设置（见 §5.4） |
| `render` | 渲染档位 | `components/RenderSection.vue` | 74 | 视频渲染默认档位：质量 / 帧率下拉 + 保存渲染默认档位 + 状态条 + 当前质量说明 |
| `whisper` | 语音识别模型 | `components/WhisperSection.vue`（挂载点在 `index.vue` 的 `.card.hgen-panel` 分支里） | 274 | 语音识别模型（whisper.cpp 字幕转录）：模型网格、下载 / 删除 / 设为当前、自定义模型登记、状态与进度条（**卡片外壳 / 标题 / 长说明由外壳 `index.vue` 提供**，见 §4.4、§5.28） |
| `update` | 应用更新 | `components/UpdateSection.vue` | 385 | 应用更新（**卡片内渲染顺序见 §4.5**）：当前版本 + 更新动作按钮排（检查更新 / 自定义更新源（弹窗）/ 下载更新 / 取消下载 / 立即重启安装）+ 状态条 + **详情按钮排（查看详情 · 收起详情 / 仅更新出错时才出现的「打开日志目录」，`updateLogVisible`）** + 详情折叠块 + **跳过版本 / 恢复提示版本（独立成行，排在运行环境之前）** + 运行环境一行（三态 + 本地导入）+ 保存 / 重置反馈行 |

各分类的用途：`model` 开启后「HTML 生成 / 修改」页改用该模型；`voice` 的配置供「音色管理」「文字生音频」使用；`render` 是「HTML生成」页「转视频」的全局默认档位（项目级覆盖优先于它）；`update` 是应用自更新的唯一入口（检查 / 下载 / 重启安装，全部状态由 `update:progress` 通道驱动；**文案由主进程单点产出，区块只渲染 `message`、把 `detail` 收进可折叠的详情块**）；`whisper` 供字幕页「从音频生成字幕」本机离线识别（不消耗 API 额度）。

**挂载语义**：切换分类 = 卸载旧区块、挂载新区块（外壳注释原文：「右侧只渲染当前分类（未选中的不挂载）」——`whisper` 走的是模板里那层 `.card.hgen-panel` 分支），因此需要读配置的区块都把自己的读取放在 `onMounted` 里——**未选中的分类不跑 IPC**（`whisper` 也一样：进度订阅与状态拉取都在自己的 `onMounted`）。`UpdateSection` 的进度订阅（`updateTools.onProgress`）与键盘监听（ESC 关弹窗）成对注册 / 卸载（`onMounted` / `onBeforeUnmount`），离开设置页或切到别的分类即随之解绑（见 §4.5）。

## 2. 外壳：`index.vue`（66 行）

### 2.1 模板

| 区块 | 关键点 |
|------|--------|
| `.settings-layout` | 根节点，内部只有左导航 + 右内容两栏 |
| `.settings-nav` | **5 个按钮由 `v-for="item in SETTINGS_NAV_ITEMS"` 渲染**（`:key="item.key"`、`class="settings-nav-item"`、`:class="{ active: activeSection === item.key }"`、`@click="activeSection = item.key"`）；按钮内容 = `{{ item.label }}` **紧跟一个红点 span**：`v-if="item.key === 'update' && updateStage === 'available'"`、`class="settings-nav-dot"`——「应用更新」上有新版本时点一个主色小点，其它分类不受影响 |
| `.settings-content`（whisper 分支） | `<div v-if="activeSection === 'whisper'" class="card hgen-panel">`：内部依次 `.panel-title`「语音识别模型（whisper.cpp 字幕转录）」、`.hgen-tip` 长说明、`<WhisperSection />`——**卡片外壳 / 标题 / 长说明由外壳给**（源码注释：子组件本体只画模型网格与表单） |
| `.settings-content`（其余分类） | `<component :is="SECTION_COMPONENTS[activeSection]" v-else-if="activeSection !== 'whisper'" />`——**一次只挂载一个区块**；映射表里只有 `model` / `voice` / `render` / `update` 四个键 |

**`.settings-nav-item` 上的 `white-space: nowrap`**（`assets/main.css`）：源码注释写明原因是「导航项是 v-for 渲染的单行按钮：标签一律不换行，免得 4 字与 6 字的项在 150px 栏宽下高度不一致」——5 个标签长度不一（`模型配置` / `语音识别模型`），不写它就会各自折行、高度参差。

### 2.2 脚本

- 导入：`vue` 的 `watch`；`./helpers` 的 `activeSection` / `applySectionIntent` / `persistActiveSection` / `updateStage` / `watchSectionIntent`；`./constants` 的 `SETTINGS_NAV_ITEMS`；5 个区块组件（相对路径 `./components/*.vue`——`WhisperSection` 供模板里那个 `.card.hgen-panel` 分支直接使用，其余 4 个进下面的映射表）
- `const SECTION_COMPONENTS = { model: ModelSection, voice: VoiceSection, render: RenderSection, update: UpdateSection } as const`——**只有 4 个键**（源码注释：`whisper` 不在表里，它由本页模板里那层卡片外壳包着挂载）；**刻意用普通对象**（源码注释：编译器按静态属性直接解析，不会把组件定义 reactive 化）
- `watch(activeSection, (v) => persistActiveSection(v))`——分类变化即写 `localStorage`
- `applySectionIntent()`（**`<script setup>` 顶层直接调用**，先落实「带意图跳进来的分类」，例：音色管理 → API Key 设置 → 语音服务），随后 `watchSectionIntent()` 作兜底（本页已在挂载状态、不经 `goPage` 重挂载时也能响应）
- **本文件没有 `onMounted` / `onBeforeUnmount`**：配置读取在各区块自己的 `onMounted` 里；订阅与监听成对登记在 `UpdateSection` / `WhisperSection` 内部

## 3. 页面级支撑文件

### 3.1 `types.ts`（12 行）

`<script setup>` 内不能 `export`，所以页面内跨组件共用的类型一律放这个普通 `.ts`。源码注释的约定：**不重定义 `@shared/types` 已有的类型**——`VoiceProviderView` 直接转出共享层的定义，`UpdateCheckReply` 由 `IpcResult<UpdateCheckResult>` 组合出来，「同一个类型只允许有一份定义」；对外只有两行类型转出：

| 名称 | 定义 | 说明 |
|---|---|---|
| `VoiceProviderView` | `export type { VoiceProviderView } from '@shared/types'` | 厂家目录条目（厂家 key / 名称 / Key 提示 / 出厂默认模型 / 模型 / 音色）；真源在 `src/shared/types.ts`，供本页组件 `import type` 使用 |
| `UpdateCheckReply` | `export type UpdateCheckReply = IpcResult<UpdateCheckResult>` | `update:check` 的回执（`{ ok }` 与 `UpdateCheckResult` 的交叉类型，`IpcResult` 真源在 `@shared/types`） |

`import type { IpcResult, UpdateCheckResult } from '@shared/types'` 只服务于第二行。

### 3.2 `constants.ts`（32 行）

| 名称 | 值 / 类型 | 说明 |
|---|---|---|
| `CUSTOM_VALUE` | `'__custom__'` | Base URL / 模型 ID 下拉里「自定义…（手动填写）」的**哨兵值**：选中它只切到手填输入框、**不动当前值**（常见诉求是"在现有地址上改一改"，见 §5.20） |
| `SETTINGS_SECTION_KEY` | `= STORAGE_KEY_SETTINGS_SECTION`（`'myapp.settingsSection'`） | 分类记忆的 `localStorage` 键名；页面内只此一处引用该键，避免裸字面量 |
| `SettingsNavItem` | `interface { key: SettingsSectionKey; label: string }` | 导航项形状 |
| `SETTINGS_NAV_ITEMS` | `SettingsNavItem[]`，5 项 | 顺序 = 显示顺序（与 `SETTINGS_SECTIONS` 的声明顺序一致）：`model` 模型配置 / `voice` 语音服务 / `render` 渲染档位 / `whisper` 语音识别模型 / `update` 应用更新 |
| `SETTINGS_SECTION_KEYS` | `= SETTINGS_SECTIONS` | 分类 key 次序的**唯一数组**，页面在「上次分类 / 导航意图是否合法」两处校验都用它 |

**共享 vs 局部的边界**（源码头部注释写明）：厂家预设表 `MODEL_PROVIDERS` 与分类记忆的存储键 `STORAGE_KEY_SETTINGS_SECTION` 都在 `@renderer/constants`（见 [constants.ts.md](../constants.ts.md)），分类枚举 `SETTINGS_SECTIONS` 在 `@renderer/composables/useNavIntent`——**不要在这里再抄一份**，那份漂移是这套导航最容易出的问题。设置分类的**真源**是 `useNavIntent.ts`（跨页导航意图与这里共用一份），所以 `SETTINGS_NAV_ITEMS` 的 `key` 一律从它派生（类型标注 `SettingsSectionKey`）：将来加分类时漏改本文件只会是「新分类没有导航按钮」，不会变成两套枚举。

分类 key 次序 / 白名单的角色由 `SETTINGS_SECTION_KEYS` 独自承担：`helpers.ts` 的读记忆与意图校验都用它（页面里没有分类字面量数组）。

### 3.3 `helpers.ts`（56 行）

设置分类（左侧导航 → 右侧内容）有 5 类平级，枚举与「跨页导航意图」共用同一份（`@renderer/composables/useNavIntent`），本文件只管「当前停在哪一类」。**仿 `TextTtsPage/helpers.ts` 的 `activeTtsTab` 范式**：跨组件共享的一次性状态放在页面级 `helpers.ts` 的模块级 ref 里，而不是塞进某个组件再层层传。

| 名称 | 类型 | 说明 |
|---|---|---|
| `activeSection` | 模块级 `ref<SettingsSectionKey>` | 当前分类，**初值 = `readActiveSection()`**——`readActiveSection()` 是文件内私有函数，读 `localStorage[SETTINGS_SECTION_KEY]`，值必须命中 `SETTINGS_SECTION_KEYS` 白名单才采用，否则（没存过 / 值已不在枚举内 / 读失败）一律回落到第一类 `'model'` |
| `persistActiveSection(v)` | `(SettingsSectionKey) => void` | 写 `localStorage.setItem(SETTINGS_SECTION_KEY, v)`，整段 `try/catch`（源码注释：隐私模式等场景静默忽略）；由外壳的 `watch(activeSection)` 调用 |
| `applySection(want)` | `(SettingsSectionKey \| null) => void` | 落到指定分类：`want` 命中白名单且与当前不同才改写 `activeSection`（不在枚举内的请求忽略） |
| `applySectionIntent()` | `() => void` | 消费跨页导航意图：`applySection(consumeSettingsSection())` |
| `watchSectionIntent()` | `() => void` | 兜底：`watch(useSettingsSectionRequest(), () => applySectionIntent())`——本页已在挂载状态（不经 `goPage` 重挂载）时也能响应 |
| `updateStage` | 模块级 `ref<UpdateStage>('idle')` | **应用更新：导航红点状态**。只放「导航红点需要的那一个字段」：其余更新状态（message / detail / 目标版本…）都留在 `UpdateSection` 内部——搬进来会变成「设置页所有状态的公共池」，就没人知道谁负责谁了 |

**为什么 `activeSection` 必须是模块级 ref**（源码注释）：导航项「应用更新」上的红点（`updateStage === 'available'` 时显示）由 `UpdateSection` 写、`index.vue` 读，两边都要能拿到同一份状态；同理 `updateStage` 也不能留在任何一个组件里。

## 4. 区块组件（`components/`）

`model` / `voice` / `render` / `update` 四个区块各自自带**卡片外壳**（`.card.hgen-panel` + `.panel-title` + 自己的 `.hf-status` 状态行）；`WhisperSection` 的卡片外壳、标题与长说明由外壳 `index.vue` 提供（见 §4.4）。相互之间没有 props / emit，唯一的共享通道是 `../helpers` 那两个模块级 ref。

### 4.1 `ModelSection.vue`（162 行）——「模型配置」

**模板**（卡片 1，`.card.hgen-panel`，无上边距）：

| 区块 | 关键点 |
|------|--------|
| `.hgen-tip` | 原文（改写后）：「配置「HTML 生成 / 修改」使用的模型服务。只支持 OpenAI 格式的端点，Anthropic 格式暂不支持。Base URL 与模型 ID 可从常见服务商直接选，也可手填自己的服务地址；填好 API Key 并勾选「启用」后，HTML 生成页就用这个模型工作。API Key 只保存在本电脑。」**措辞约定**：这段是给使用者看的——不出现 `userData/settings.json` 这类内部路径、不写「OpenAI 兼容模式」这类无信息量的标签（见 §5.24）；但**要写影响决策的限制**，「只支持 OpenAI 格式的端点，Anthropic 格式暂不支持」就是典型（自建网关 / 中转站用户只看手填框、看不到下拉，必须从文字上知道；**这句话也是下拉里不再列 Anthropic 灰项的理由**——见 §5.23）。安全说明用「只保存在本电脑」。卡片标题也据此简化为「自定义模型」（去掉「（OpenAI 兼容）」——协议限制改由这段文字承担） |
| **Base URL 行** | **二选一渲染**：`v-if="!baseUrlCustom"` → `HfSelect`（`:model-value="baseUrl"`、`:groups="baseUrlGroups"`、`@change="onBaseUrlPick"`，**不用 `v-model`**）；`v-else` → `<input v-model="baseUrl" class="hgen-input" style="flex:1" placeholder="https://…/v1（OpenAI 兼容，需含版本段）">` + 「从列表选」按钮（`@click="baseUrlCustom = false"`，切回下拉态；手填值保留） |
| **模型 ID 行** | 同上的二选一：`v-if="!modelCustom"` → `HfSelect`（`:model-value="modelId"`、`:groups="modelGroups"`、`@change="onModelPick"`）；`v-else` → `<input v-model="modelId" … placeholder="如 deepseek-flash / qwen3.8-max">` + 「从列表选」（`@click="modelCustom = false"`） |
| API Key 行 | `v-model="apiKey"`、`type="password"`，placeholder「sk-...」 |
| 启用行 | `v-model="enabled"`、`type="checkbox"`，文字「使用自定义模型生成 / 修改 HTML」 |
| `.hgen-actions` | `保存配置`（主按钮 → `onSave`）、`测试连接`（`onTest`） |
| `.hf-status` | `:class="statusClass"`、`{{ status }}` |

**状态**：

| 名称 | 类型 | 说明 |
|------|------|------|
| `baseUrl` / `modelId` / `apiKey` | `ref('')` | 自定义模型三项文本 |
| `enabled` | `ref(false)` | 是否启用自定义模型生成 / 修改 HTML |
| `status` / `statusClass` | `ref('')` | 区块状态文案与样式类（`''` / `'hf-ok'` / `'hf-error'`） |
| `baseUrlCustom` / `modelCustom` | `ref(false)` | 该行是否处于**手填态**：`false` 渲染 `HfSelect`、`true` 渲染 `<input>` + 「从列表选」。用户点「自定义…」置 `true`，「从列表选」按钮置 `false`；`onMounted` 还会按已保存值是否命中预设初始化（见下） |
| `currentProvider` | `computed` | 当前 `baseUrl` 命中了 `MODEL_PROVIDERS` 里哪家服务商（`p.baseUrls.includes(baseUrl.value)` 全等匹配），没命中为 `null`；模型下拉的候选跟着它联动 |
| `baseUrlGroups` | `computed<HfSelectGroup[]>` | Base URL 下拉的分组选项，见 §4.1.1 |
| `modelGroups` | `computed<HfSelectGroup[]>` | 模型 ID 下拉的分组选项，见 §4.1.1 |

**函数**：

| 名称 | 说明 |
|------|------|
| `onBaseUrlPick(v)` | Base URL 下拉的 `@change` 回调：`v === CUSTOM_VALUE` → **只**把 `baseUrlCustom` 置 `true`（**不动 `baseUrl`**，便于在现有地址上改一改）；否则写入 `baseUrl`、`baseUrlCustom = false`，并在**已填模型不属于新服务商**（`currentProvider` 为空或 `models` 不含它）时把 `modelCustom` 置 `true`——值保留，便于改名而不是从头输 |
| `onModelPick(v)` | 模型下拉的 `@change` 回调：`v === CUSTOM_VALUE` → 只置 `modelCustom = true`；否则写入 `modelId` 并置 `modelCustom = false` |
| `setStatus(text, kind)` | 写 `status` / `statusClass`，文案取 `text \|\| ''` |
| `collectCustomModel()` | 返回 `{ baseUrl, modelId, apiKey, enabled }`，三个字符串字段均 `.trim()`，`enabled` 取布尔值 |
| `onSave()` | 校验通过后 `await window.settingsTools.save(customModel)`；成功提示「配置已保存，可开始使用自定义模型生成 HTML」`hf-ok`，失败显示 `res.message \|\| '保存失败'` `hf-error` |
| `onTest()` | `await window.settingsTools.test(collectCustomModel())`；刻意**不弹配置类弹窗**（源码注释：按钮与失败状态行都在这个区块上，再弹一个「去设置」框是让用户从原地跳到原地），主进程照常回 `needConfig` 供别的入口用 |
| `onMounted(async)` | `settingsTools.get()` → `s.customModel \|\| {}` 回填 `baseUrl` / `modelId` / `apiKey` / `enabled = !!m.enabled`，异常写 `setStatus('读取配置失败：' + message, 'hf-error')`；随后**按已保存值初始化两个手填态**：`baseUrlCustom = !!baseUrl && 该地址不在任何预设的 baseUrls 里`、`modelCustom = !!modelId && 该模型不属于 currentProvider`（顺序在赋值之后，故 `currentProvider` 已按新 `baseUrl` 求值）——不这么做下拉会显示空占位，用户看到的是「我配的地址 / 模型没了」（见 §5.22） |

**关键流程**：

- **保存自定义模型**：`collectCustomModel()` 后若 `baseUrl` / `modelId` / `apiKey` 任一为空 → `setStatus('配置不完整：Base URL / Model ID / API Key 均需填写', 'hf-error')` 并中止（不发任何 IPC）。
- **测试连接**：先置「正在测试连接...」（样式类清空，保持中性），用**当前表单内容**（不要求已保存）调 `settingsTools.test`，成功 `res.message || '连接成功'`、失败 `res.message || '测试失败'`。主进程失败时还会带 `detail`（排障原文）与可能的 `needConfig`（配置类分类），**这里刻意不使用它们**——`needConfig` 只供别的入口判断。
- **选 Base URL / 模型**：两行的下拉都绑定 `@change`（不是 `v-model`）。选「自定义…」时只切到手填态、**不写值**；选具体项时写值并切回下拉态；Base URL 一改，若已填模型不属于新服务商则模型行自动切手填（值保留）。`HfSelect` 只在**用户点选且值确实变化**时 emit `change`（程序化改值不发），并会把 `disabled` 选项渲染成不可点选的行。

#### 4.1.1 两个下拉的选项来源

两个 `computed<HfSelectGroup[]>`（`HfSelectGroup` 见 [components.md](../components.md)：`{ label: string; options: { value; label; title?; disabled? }[] }`），数据源是 `@renderer/constants` 的 `MODEL_PROVIDERS`（见 [constants.ts.md](../constants.ts.md) §3.1 / §3.3）。注意 `HfSelectOption` 的 `disabled` 是**组件本身的能力**（渲染成不可点选的行，见 [components.md](../components.md)），这两个下拉现在都不传它——预设表里已经没有灰项了（§5.23）。

**`baseUrlGroups`** —— 先按服务商分组平铺预设：

- 每条 `MODEL_PROVIDERS` 一组（`label` 取 `p.label`），组内每条 `baseUrls` 一个选项（**`baseUrls` 是纯 URL 字符串数组**）；
- **选项文字就是 URL 本身**：`options: p.baseUrls.map((u) => ({ value: u, label: u }))`——不拼接 `note`、不传 `title`、不传 `disabled`（源码注释：「Base URL 没有需要额外解释的地方，加了反而是噪音」）。预设表里每家的 `baseUrls` 都只有一条，所以每个服务商组下只有一个可选项，**没有需要用户分辨的候选**（`note` 字段与 Anthropic 灰项的设计取舍见 §5.23）；
- **已保存地址不在预设里时补一组「当前配置」**（单选 `${baseUrl}`，`title` 说明「你当前保存的值」）——自建网关 / 中转站的地址不该在下拉里凭空消失；
- 最后**固定追加**一组空标题的「自定义…（手动填写）」（`value = CUSTOM_VALUE`）。

**`modelGroups`** —— 跟随 `currentProvider`：

- 命中服务商才列该家的 `models`（组标题即该服务商 `label`），`value` 与 `label` 都是模型名本身；
- 已保存模型不属于当前服务商的 `models` 时补一组「当前配置」（含 `currentProvider` 为 `null` 的情况）；
- 最后同样固定追加「自定义…（手动填写）」；
- **没命中服务商时刻意不列任何预设模型**：免得列一堆跟当前端点配不上的名字诱导用户选错——选错就是运行期 `404 model not found`。

### 4.2 `VoiceSection.vue`（85 行）——「语音服务」

**模板**（`.card.hgen-panel`）：`.panel-title`「语音服务（按厂家配置）」+ `.hgen-tip`（「每个厂家一把 API Key；模型与音色都在厂家的目录里，**系统音色与合成模型是固定绑定**（当前厂家：系统音色用 `{{ vendorSystemModel }}`）。API Key 只保存在本电脑。」）+ 厂家行（`HfSelect v-model="vProvider" :groups="vendorGroups" @change="syncVoiceForm"`，选项来自**厂家目录** `VoiceProviderView[]`）+ API Key 行（`v-model="vApiKey"`、`type="password"`、`:placeholder="vendorKeyHint"`，占位提示**来自厂家**，千问为「sk-...（DASHSCOPE_API_KEY）」）+ `.hgen-actions`「保存该厂家配置」（→ `onSaveVoice`）+ `.hf-status`（`:class="vStatusClass"`、`{{ vStatus }}`）。

**状态**：

| 名称 | 类型 | 说明 |
|------|------|------|
| `voiceProviders` | `ref<VoiceProviderView[]>([])` | **厂家目录**（来自 `voice:list-models`）：`key` / `label` / `apiKeyHint` / `defaultModel` / `models` / `voices` |
| `vProvider` | `ref('')` | 当前编辑的厂家 key（厂家下拉的值） |
| `vApiKey` | `ref('')` | 当前厂家的 API Key（**切厂家会回填**）；`vModel` 已随「厂家默认模型」行一起删除 |
| `vSaved` | `ref<Record<string, { apiKey: string }>>({})` | 各厂家**已保存**的配置（来自 `settings.json` 的 `voice.providers`），`syncVoiceForm()` 的回填源（**只有 `apiKey`**） |
| `vStatus` / `vStatusClass` | `ref('')` | 区块状态文案与样式类 |
| `currentVendor` | `computed` | 当前厂家在目录里的记录（找不到就退到第一个厂家） |
| `vendorGroups` / `vendorKeyHint` / `vendorSystemModel` | `computed` | 厂家下拉分组（单组、`value` = `p.key`）/ Key 占位提示（`apiKeyHint`）/ **该厂家系统音色固定使用的模型**（`currentVendor.defaultModel`，仅用于说明文案） |

**函数与流程**：

| 名称 | 说明 |
|------|------|
| `syncVoiceForm()` | 按当前厂家从 `vSaved` 回填 `vApiKey`（切厂家不丢另一家已填的 Key） |
| `setVStatus(text, kind)` | 写 `vStatus` / `vStatusClass`，`text \|\| ''` |
| `onSaveVoice()` | `window.voiceTools.saveConfig({ provider: vendor.key, config: { apiKey: vApiKey.value.trim() } })`——**只提交 apiKey**（不再有 `defaultModel`）；成功后同步更新本地 `vSaved[vendor.key]`（「『厂家』的 API Key 已保存，可在「音色管理」「文字生音频」中使用」`hf-ok`），失败 `res.message \|\| '保存失败'` `hf-error`；厂家目录没加载时先给「厂家目录未加载，请重开本页」 |
| `onMounted(async)` | ① `await window.voiceTools.listModels().catch(() => null)` → `mm.providers \|\| []` 写入 `voiceProviders`（**厂家目录**，失败即空数组、不抛错）；② `settingsTools.get()` → `s.voice` → `vSaved = voice.providers \|\| {}`、`vProvider = String(voice.active \|\| '') \|\| 第一个厂家的 key`（异常写 `setVStatus('读取语音服务配置失败', 'hf-error')`）；③ `syncVoiceForm()`。①必须先于③，否则 `currentVendor` 为空、Key 占位提示拿不到 |

**保存语义**：无前置校验，空 API Key 也会提交，合法性由主进程判断并回传 `message`（见 §5.5）。**逐个音色换模型不在这里**——那是配音页「音色映射管理」的事。

### 4.3 `RenderSection.vue`（74 行）——「渲染档位」

**模板**（`.card.hgen-panel`）：`.panel-title`「视频渲染默认档位」+ `.hgen-tip` 原文（「「HTML生成」页点「转视频」时的默认档位，普通使用只需在这两项中选择。单个项目可在「HTML生成」页的「渲染档位」单独覆盖（项目覆盖优先于这里的默认）。质量 draft 编码最快但文字边缘可能有压缩痕迹，仅用于快速确认内容；降低帧率不会缩短成片时长，只是采样更稀、渲染更快。」）+ 质量行 / 帧率行（两个 `HfSelect`：`v-model="rQuality"` / `v-model="rFps"`、`:groups="qualityGroups"` / `"fpsGroups"`）+ `.hgen-actions`「保存渲染默认档位」（→ `onSaveRender`）+ `.hf-status`（`:class="rStatusClass"`、`{{ rStatus }}`）+ 下方 `.hgen-tip`（`{{ qualityHint }}`，当前所选质量的说明）。

**状态与函数**：

| 名称 | 类型 / 签名 | 说明 |
|------|------|------|
| `qualityOptions` / `fpsOptions` | 常量 | 直接引用 `RENDER_QUALITY_OPTIONS`（质量 draft / standard / high）/ `RENDER_FPS_OPTIONS`（帧率 24 / 30） |
| `qualityGroups` / `fpsGroups` | `computed<HfSelectGroup[]>` | 单组选项（原为 `<option v-for>`）；`value` / `label` 取自选项表 |
| `rQuality` / `rFps` | `ref<RenderQuality>` / `ref<RenderFps>` | 全局默认档位，初值取 `FALLBACK_RENDER`（`standard` / `30`） |
| `rStatus` / `rStatusClass` | `ref('')` | 区块状态文案与样式类 |
| `qualityHint` | `computed<string>` | 当前所选质量档位的 `hint`（找不到时为空串） |
| `setRStatus(text, kind)` | | 写 `rStatus` / `rStatusClass`，`text \|\| ''` |
| `onSaveRender()` | | `await saveRenderDefaults({ quality: rQuality.value, fps: rFps.value })`（`@renderer/composables/useRenderOptions`，内部走 `settingsTools.saveRender` → `settings:save-render`）；成功提示「渲染默认档位已保存：质量标签 · N fps」`hf-ok`，失败 `res.message \|\| '保存失败'` `hf-error` |
| `onMounted(async)` | | `settingsTools.get()` → `const r = (s && s.render) \|\| FALLBACK_RENDER`，仅当值在 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` 白名单内才写入 `rQuality` / `rFps`（异常静默忽略，读取失败沿用内置默认 `standard` / `30`） |

**保存后无需刷新**：`saveRenderDefaults()` 成功后就地刷新模块级单例 `renderDefaults`，「HTML生成」页的 `optionNote`（「跟随设置页默认：…」）立刻反映新值（见 §5.15、§5.16）。

### 4.4 `WhisperSection.vue`（274 行）——「语音识别模型」

源码头部注释说明本区块的来源与形态：由 JS 版 settings 模块 `whisper.js`（`window.__settings.initWhisper`）移植为设置页子组件、网格按钮由事件委托改为逐卡 `@click`、下载进度订阅在 `onMounted`（preload 单订阅：切页即替换）。**卡片外壳、标题与长说明不由本文件给**——模板根节点是普通 `<div>`（内部直接是 `.model-grid`），外面那层 `.card.hgen-panel` + `.panel-title`「语音识别模型（whisper.cpp 字幕转录）」+ `.hgen-tip` 长说明写在 `index.vue` 的 `v-if="activeSection === 'whisper'"` 分支里（见 §2.1、§5.28）。

#### 4.4.1 模板结构

| 区块 | 说明 |
|------|------|
| `.model-grid` | 卡片网格 `v-for="m in models"`、`:key="m.id"`，卡片类 `:class="{ downloaded: m.downloaded, current: m.isCurrent }"`（按钮由事件委托改为逐卡 `@click`） |
| `.model-head` | `escTxt(m.label)` + 徽标：`isCurrent` → 「当前使用」（`model-badge current`）、否则 `downloaded` → 「已下载」（`model-badge ok`）、否则「未下载」（`model-badge`） |
| `.model-meta` | `file` · `sizeMB ? '约 N MB' : '体积未知'` · 有 `speed` 时「速度X」 · `custom ? '自定义' : '内置'` · 已下载时「本地占用 fmtBytes(localBytes)」 · 已下载且 `localFile !== file` 时「实际文件 localFile」 |
| `.model-desc` / `.model-url` | 说明与下载地址（均经 `escTxt`） |
| `.model-actions` | 已下载且非当前 → 「设为当前使用」`actCurrent`；已下载 → 「删除文件」`actDelete`；未下载 → 「下载」（主按钮，`:disabled="wmBusy !== ''"`）`actDownload`；`custom` → 「编辑」`openForm`、「移除」`actRemove` |
| `.whisper-tip` ×2 | 第 1 处 `{{ unknownTip }}`；末处 `{{ cliTip }}` 带 `:style="cliTipColor ? { color: cliTipColor } : {}"` |
| `.whisper-bar-wrap` | `v-show="barVisible"`：`.whisper-bar-fill`（`:class="barState"`、`:style="{ width: barPercent + '%' }"`）+ `.whisper-bar-text`（`barText`） |
| `.hgen-actions` | 「刷新状态」`onRefresh`、「打开模型目录」`onOpenModels`、「添加自定义模型」`onToggleForm` |
| `.hgen-form` | `v-show="formVisible"`：`formName`、`formFile`（`:disabled="editId !== ''"`，编辑时不可改）、`formUrl`、`formSize`、`formDesc` + 「保存」`onSaveForm` /「取消」`onCancelForm` + `formStatus` / `formStatusClass` |
| `.hgen-tip` / `.hf-status` | `{{ storeTip }}`（存储位置与已用空间）；`:class="statusClass"`、`{{ status }}` 区块级反馈 |

#### 4.4.2 类型与状态

两个本文件内联接口：`WhisperModelView`：`id`、`label`、`sizeMB`、`speed`、`desc`、`file`、`custom`、`localFile`、`url`、`downloaded`、`localBytes`、`isCurrent`；`WhisperStatusView`：`cli: { exists, path }`、`modelsDir`、`models[]`、`unknownFiles[]`、`usedBytes`。

ref：`wmState`（`status()` 快照）、`wmBusy`（正在下载的模型 id，非空即禁用全部下载按钮并拒绝新任务）、`status` / `statusClass`、`barVisible` / `barPercent` / `barText` / `barState`、`formVisible`、`editId`（非空为编辑模式）、`formName` / `formFile` / `formUrl` / `formSize` / `formDesc` / `formStatus` / `formStatusClass`。

computed：`models`（`wmState.models || []`）、`storeTip`（「存储位置：modelsDir　已用空间：fmtBytes(usedBytes)」）、`unknownTip`（`unknownFiles` 非空时「发现 N 个未登记的模型文件（不在枚举内，暂时无法用于转录）：a、b。可点上方「添加自定义模型」按文件名登记后启用。」，用 `、` 拼接）、`cliTip`（就绪「whisper-cli.exe：已就绪（cli.path）」；缺失引导从 whisper.cpp 官方 Releases 取 windows-x64 包的 `whisper-cli.exe` 放到 `cli.path || 'resources/whisper/whisper-cli.exe'`）、`cliTipColor`（缺失时 `'rgba(255, 176, 32, 0.9)'` 警告橙，否则空串）。

#### 4.4.3 函数

| 名称 | 说明 |
|------|------|
| `fmtBytes(n)` | ≥1073741824 → `x.xx GB`；≥1048576 → `x.x MB`；≥1024 → `x.x KB`；否则 `x B`；`Number(n) \|\| 0` 兜底 |
| `setStatus` / `showBar(percent, text, state)` | 写状态；`showBar` 显示进度条并把 `barPercent` 钳制到 0~100 |
| `refreshWm()` | `await window.whisperTools.status().catch(() => null)`；无结果或 `!s.ok` → 「读取识别模型状态失败，请重试」`hf-error`；否则写入 `wmState` |
| `actDownload(m)` | 见 §4.4.4 |
| `actDelete(m)` | `whisperTools.delete(m.id)`；成功「已删除模型「id」（如需再用可重新下载）」`hf-ok`，失败 `message \|\| '删除失败'`；随后 `refreshWm()` |
| `actCurrent(m)` | `whisperTools.setCurrent(m.id)`；成功「已将「id」设为字幕转录使用的模型」；随后 `refreshWm()` |
| `actRemove(m)` | `whisperTools.removeModel({ id: m.id })`；优先 `res.message`，否则按 `ok` 给「已移除」/「移除失败」；随后 `refreshWm()` |
| `openForm(model)` | 填充表单（`formSize` 取 `sizeMB ? String(sizeMB) : ''`）并展开；引导语：编辑「正在编辑「label」：文件名不可改，其余可改」/ 新增「填写后点「保存」登记；登记成功后即可像内置模型一样下载与使用」，`formStatusClass=''` |
| `onToggleForm` / `onCancelForm` | 展开态则收起并清 `editId`，否则 `openForm(null)`；取消同样收起并清 `editId`、`formStatus`、`formStatusClass` |
| `onSaveForm()` | 见 §4.4.5 |
| `onRefresh()` | 清空区块状态后 `refreshWm()` |
| `onOpenModels()` | `await window.whisperTools.openDir('models')`；失败 `message \|\| '打开目录失败'` `hf-error` |
| `onMounted()` | 注册 `whisperTools.onProgress` → `setStatus('', '')` → `refreshWm()`（preload 单订阅：切到本页时本页回调生效） |

#### 4.4.4 下载与进度

`actDownload`：`wmBusy` 非空 → 「已有下载任务进行中，请稍候」`hf-error` 返回；否则置 `wmBusy = m.id`、「开始下载「id」…模型体积较大，请保持网络畅通」、`showBar(0, '正在连接下载源（hf-mirror.com）…', '')`；`await whisperTools.download(m.id)` 失败 → `showBar(100, message || '下载失败', 'error')` + `hf-error`，成功且带 `message`（如「本地已有模型文件 …，无需重复下载」）→ `hf-ok`；最后 `wmBusy=''`、`refreshWm()`。

`onProgress` 回调参数 `p: WhisperProgressPayload`（类型来自 `src/shared/types.ts`，由 `PreloadApi['whisperTools']` 自动推断，不再是渲染层手写的 `Record<string, unknown>`；取值处保留了 `as string` / `as number` 断言），按 `p.stage` 分支（`p` 为空则忽略）；主进程回推字段 `id`、`stage`、`percent`、`receivedBytes`、`totalBytes`、`message`：

| `stage` | 行为 |
|---------|------|
| `'downloading'` | `wmBusy = (p.id as string) \|\| wmBusy`；`p.totalBytes` 为真时拼「（fmtBytes(p.receivedBytes as number) / fmtBytes(p.totalBytes as number)）」；`showBar((p.percent as number) \|\| 0, ((p.message as string) \|\| '下载中') + sizeTxt, '')` |
| `'done'` | `showBar(100, (p.message as string) \|\| '下载完成', 'done')`；`setStatus('模型下载完成，点「设为当前使用」即可用于字幕转录', 'hf-ok')`；`wmBusy=''`；`refreshWm()` |
| `'error'` | `showBar(100, (p.message as string) \|\| '下载失败', 'error')`；`setStatus((p.message as string) \|\| '下载失败', 'hf-error')`；`wmBusy=''`；`refreshWm()` |
| 其它（如 `loading` / `transcribing`） | 静默忽略（预期行为，转录阶段不在本区块显示） |

#### 4.4.5 保存自定义模型表单

组装 `payload = { name, file, url, sizeMB, desc }`（全部 `.trim()`）→ `!name` → `formStatus='请填写模型名称'` `hf-error` 返回；非编辑模式且 `!file` → `'请填写模型文件名（ggml- 开头的 .bin 文件）'` `hf-error` 返回；提交时 `editId` 非空走 `updateModel(Object.assign({ id: editId.value }, payload))`，否则 `addModel(payload)`。成功：`formStatus = message || '已保存'` `hf-ok`，收起表单并清 `editId`，同一文案写入区块级 `status`，再 `refreshWm()`；失败：`formStatus = message || '保存失败'` `hf-error`，表单保持展开便于修改重试。

#### 4.4.6 `status()` 返回字段用法

| 字段 | 用法 |
|------|------|
| `ok` | `refreshWm` 判失败 |
| `cli.exists` / `cli.path` | `cliTip` 文案与 `cliTipColor` 警告橙；缺失时 `cli.path` 作为应放置位置提示（兜底 `'resources/whisper/whisper-cli.exe'`） |
| `modelsDir` | `storeTip` 存储位置；`unknownTip` 中的用户指引 |
| `models[]` | 卡片网格数据源，逐项用 `id`、`label`、`file`、`sizeMB`、`speed`、`desc`、`url`、`custom`、`downloaded`、`localBytes`、`isCurrent` |
| `unknownFiles[]` | `unknownTip` 统计数量并列举文件名 |
| `usedBytes` | `storeTip` 经 `fmtBytes` 显示 |
| `langs`、`currentModelId` | 主进程同样返回，但 `WhisperStatusView` 未声明、界面未使用（`refreshWm` 用 `s as unknown as WhisperStatusView` 断言赋值） |

### 4.5 `UpdateSection.vue`（385 行）——「应用更新」（含运行环境 + 更新源弹窗）

`updateStage` 不在这个文件里，而在 `../helpers`（模块级 ref）——左侧导航项「应用更新」的红点要读同一个值（源码注释与 §3.3）。其余更新状态全部留在这个文件里。全部更新状态由主进程 `update:progress` 通道驱动：这里只是订阅方 + 触发方（检查 / 下载 / 重启安装）。**文案不在这一层拼**：`available` / `skipped` / `none` / `error` 的句子统一由主进程 `updater/`（`base.ts` 的 `bindEvents()` 与 `actions.ts` 的动作入口）产出（早前渲染层也拼一套，与事件推送的文案互相覆盖，同一状态两句话在打架）。这里只渲染 `message`，并把 `detail`（排障详情）收进可折叠的「查看详情」。

#### 4.5.1 模板（按卡片内实际渲染顺序排列，模板行序即界面行序）

| 区块 | 关键点 |
|------|--------|
| 当前版本行 | `.sel-label`「当前版本」+ `.hf-file` 显示 `{{ updateVersion \|\| '—' }}`——**只显示当前版本**；待安装的目标版本另有 `updateNewVersion`（见 §4.5.2 与 §5.26） |
| `.hgen-actions`（更新动作按钮排） | `检查更新`（主按钮，`:disabled="updateBusy"`）、`自定义更新源`（→ `openFeedDialog`）、`下载更新`（仅 `available` / `skipped`）、`取消下载`（仅 `downloading`）、`立即重启安装`（仅 `downloaded`，主按钮） |
| `.hf-status`（状态行） | `{{ updateMessage }}`（检查 / 下载进度，`:class="updateStatusClass"`），文案来自主进程 |
| 详情按钮行 | **按需出现**的 `.hgen-actions`（`style="margin-top:0"`，`v-if="updateDetail \|\| updateLogVisible"`）：`查看详情 / 收起详情` 按钮**仅当 `updateDetail` 非空时渲染**（`v-if="updateDetail"`，文案 `showUpdateDetail ? '收起详情' : '查看详情'`，点击切换 `showUpdateDetail`）；`打开日志目录` 按钮**仅当 `updateLogVisible` 为真时渲染**（`v-if="updateLogVisible"`，→ `onOpenUpdateLog`），而 `const updateLogVisible = computed(() => updateStage.value === 'error' \|\| updateStatusClass.value === 'hf-error')`。之所以不再常驻：**没出错时把用户送进日志目录没有意义**（他看到的是自己读不懂的文件，只会以为哪里坏了），只在更新确实出错（检查 / 下载 / 安装失败）时才露出排障入口。启动静默检查的失败也不会因此看不见——本区块 `onMounted` 在订阅 `update:progress` 之后用 `window.updateTools.status()` 补齐一次主进程状态（`stage` 非 `idle` 才套用），把 `error` 阶段连同这个入口一起带出来 |
| 详情块 | `<div v-if="updateDetail && showUpdateDetail" class="hf-detail">{{ updateDetail }}</div>`：等宽字体 + `white-space: pre-wrap` + `user-select: text`，默认折叠（类样式见 [assets.md](../assets.md)） |
| 跳过版本行 | **独立成行的 `.hgen-actions`（`style="margin-top:8px"`，不并入上面的更新动作按钮排）**，且**排在详情块之后、「运行环境（分包）」状态行之前**（源码注释：它俩是「应用更新」的分支动作，必须排在运行环境那几行之前，掉到「下载运行环境」下面会被读成运行环境的操作，用户反馈过）：`available` 态显示「跳过版本 {{ updateNewVersion }}」；`skipped` 态显示「恢复提示版本 {{ updateNewVersion }}」——**用的是目标版本**（`update:progress` 载荷 / 检查回执的 `version`），不是当前版本；两个按钮都走 `onSkipVersion` |
| 运行环境状态行 | `v-if="runtimeBusy \|\| runtimeFailed \|\| runtimeHasMissing"` 的 `.hf-status`（`:class="runtimeStatusClass"`、`{{ runtimeStatusText }}`）：**不再无条件渲染、也不再显示「运行环境已就绪（体积）」**——就绪是常态，不占位；`runtimeStatusText` 三支（`runtimeBusy` → 主进程 `message` 或 `正在准备运行环境…`；`runtimeFailed` → 主进程 `message` 或 `运行环境准备失败`；`runtimeHasMissing` → `'运行环境需要下载：' + runtimeMissingText`），其余为空串；`runtimeStatusClass` 只在 `runtimeFailed` 时给 `hf-error`；同排 `.hgen-actions`（`v-if="runtimeFailed \|\| runtimeHasMissing"`、`style="margin-top:0"`）给「下载运行环境 / 重试」（`runtimeHasMissing` 时为「下载运行环境」，否则「重试」；`onPrepareRuntime`，`:disabled="runtimeBusy"`）、`runtimeCancellable` 时「取消下载」（`cancelRuntime`）、`runtimeMissing.length` 时「从本地文件安装…」（`onPickLocalPack`）；其下是 `runtimeNotice` 反馈行（`v-if`）。数据来自 `useRuntime()` 解构的 `{ runtime, busy, failed, hasMissing, cancelable, missing, missingText, prepare, cancel }`（`ready` / `sizeText` 已删，见 §6），显隐口径与外壳 `App.vue` 的 `runtimeVisible = busy \|\| failed \|\| hasMissing` 一致 |
| `.hf-status`（反馈行） | `v-if="updaterStatus"`、`:class="updaterStatusClass"`、`{{ updaterStatus }}`（保存 / 重置 / 打开日志失败的反馈）——**仍在运行环境一行之后、卡片最末**，且**必须与状态行分两行**：共行会被随后的进度文案盖掉，表现为「点了保存没反应」（源码注释：保存 / 重置的反馈独立成行） |
| **自定义更新源弹窗** | 沿用 `.hf-modal-mask` / `.hf-modal` 组件类（同 `HtmlGenPage` 的渲染档位弹窗，宽度 `min(520px,92vw)`）；含更新源输入 `v-model="feedDraft"`、启动检查 `v-model="autoCheckDraft"`、说明 `留空即重置为应用内置的更新地址。地址需指向存放 latest.yml 的目录，并以 / 结尾。`；底部 `重置` / `取消` / `保存` 三个按钮；`.hf-modal-mask` 上 `@click.self="closeFeedDialog"` |

#### 4.5.2 状态

| 名称 | 类型 | 说明 |
|------|------|------|
| `updateVersion` | `ref('')` | **当前版本号，只用于显示**：模板 `{{ updateVersion \|\| '—' }}`、`onMounted` 用同步的 `window.updateTools.version()` 首屏填充，后续由 `update:progress` 的 `currentVersion`（与 `onCheckUpdate` 回执的 `currentVersion`）刷新 |
| `updateNewVersion` | `ref('')` | **待安装的目标版本**（`UpdateProgressPayload.version` 就是目标版本），专供「跳过版本 / 恢复提示版本」：按钮标签渲染它，`onSkipVersion()` 写 `skippedVersion` 也用它。**必须与 `updateVersion` 分开**——主进程是拿 available 的目标版本与 `settings.json` 的 `skippedVersion` 比较（`updater/base.ts` 的 `update-available` 分支），写当前版本永远不命中，「跳过」等于没生效（见 §5.26） |
| `updateStage` | 模块级 `ref<UpdateStage>('idle')`（**来自 `../helpers`**） | 应用更新阶段；`idle` 表示本进程尚未检查过。本文件是唯一的写入方（`applyUpdateProgress` / `onCheckUpdate` / 各失败分支），`index.vue` 只读它决定导航红点 |
| `updateMessage` / `updateStatusClass` | `ref('')` | 状态行的文案与样式类（`error` → `hf-error`，`downloaded` / `available` → `hf-ok`）；文案一律取主进程的 `message`，本区块不拼串 |
| `updateDetail` / `showUpdateDetail` | `ref('')` / `ref(false)` | 排障详情（HTTP 状态 / AccessDenied 原文 / 请求地址等）与其折叠开关；`updateDetail` 为空时详情块与「查看详情」按钮都不渲染，`showUpdateDetail` 自动复位为 `false` |
| `updateLogVisible` | `computed<boolean>` | `updateStage === 'error' \|\| updateStatusClass === 'hf-error'`：控制「打开日志目录」按钮的出现（详见 §5.19） |
| `updateBusy` | `computed<boolean>` | `updateStage` 为 `checking` / `downloading` 时禁用「检查更新」按钮 |
| `feedUrl` / `autoCheck` | `ref('')` / `ref(true)` | **已保存**的更新源覆盖地址与启动静默检查开关（回填自 `settings.updater`） |
| `updaterStatus` / `updaterStatusClass` | `ref('')` | 保存 / 重置 / 打开日志的反馈文案与样式类（独立于 `updateMessage` 那行，避免互相覆盖） |
| `feedDialogVisible` | `ref(false)` | 自定义更新源弹窗可见性 |
| `feedDraft` / `autoCheckDraft` | `ref('')` / `ref(true)` | 弹窗内**编辑中的副本**：只有点「保存」才写回 `feedUrl` / `autoCheck` 并落盘，取消不影响已存值 |
| `runtimeNotice` | `ref('')` | 「从本地文件安装…」的即时反馈（导入成功 / 失败），与主进程推来的状态分开显示 |

运行环境相关的派生值（`runtimeState` / `runtimeBusy` / `runtimeFailed` / `runtimeHasMissing` / `runtimeCancellable` / `runtimeMissing` / `runtimeMissingText` / `prepareRuntime` / `cancelRuntime`）与 `runtimeStatusText` / `runtimeStatusClass` 都由 `useRuntime()` 解构或就地 `computed`（见 §4.5.1 与 §6）。

#### 4.5.3 函数

| 名称 | 说明 |
|------|------|
| `onPrepareRuntime()` | `await prepareRuntime()` |
| `onPickLocalPack()` | 见 §6 |
| `openFeedDialog()` / `closeFeedDialog()` | 打开时把已存的 `feedUrl` / `autoCheck` 拷进 draft；关闭只清 `feedDialogVisible`（不落盘） |
| `onFeedDialogKey(e)` | 弹窗 ESC 关闭；在 `onMounted` 注册、`onBeforeUnmount` 注销（成对，项目既有惯例） |
| `applyUpdateProgress(d)` | `update:progress` 的回调：写 `updateStage` / `updateVersion`（取 `d.currentVersion`）/ **`updateNewVersion`（取 `d.version`，目标版本）** / `updateMessage`（`d.message \|\| ''`）/ **`updateDetail`（`d.detail \|\| ''`）** / `updateStatusClass`；`detail` 为空即把 `showUpdateDetail` 复位为 `false`，避免旧报错的面板一直挂着 |
| `setUpdaterStatus(text, kind)` | 写 `updaterStatus` / `updaterStatusClass`，`text \|\| ''` |
| `onSaveFeed()` | 把 draft 写入 `saveUpdater({ feedUrl, autoCheck })` → `settings:save-updater`；成功后回写 `feedUrl` / `autoCheck`（并优先采用返回值里规范化过的 `settings.updater.feedUrl`），提示「更新源已保存」并关闭弹窗；异常被 `try/catch` 兜住并写 `hf-error` |
| `onResetFeed()` | `saveUpdater({ feedUrl: '', skippedVersion: '' })`：**清空更新源回到内置地址，同时清掉「跳过版本」**，让所有版本重新可提示；成功后 draft 同步清空 |
| `handleUpdateError(what, e)` | **所有更新动作的统一异常兜底**。`updateTools.*` / `settingsTools.saveUpdater` 都是 `ipcRenderer.invoke`：主进程 handler 抛错或频道未注册时 Promise 会 **reject**，不用 `try/catch` 包住就既不改状态也不提示——界面表现为「点了没反应」（历史上 `electron-updater` 加载失败时正是如此）。现在它把**人话进 `updateMessage`、原始异常一律进 `updateDetail`**：`what === '安装'` → 「启动安装程序失败，请重新下载安装包后手动安装」；其他 → `what + '失败，请稍后重试'`，并置 `hf-error`；`onCheckUpdate` / `onDownloadUpdate` / `onCancelUpdate` / `onInstallUpdate` / `onSkipVersion` / `onSaveFeed` / `onResetFeed` 全部已包 `try/catch` |
| `onCheckUpdate()` | 先把状态行置「正在检查更新…」并清空 `updateDetail` / 收起详情，再 `await window.updateTools.check()`；成功后**只回填主进程给的文案**（`updateMessage = res.message \|\| '检查完成'`、`updateDetail = res.detail \|\| ''`、`updateStage = res.state`）并回填两个版本号：`updateVersion = res.currentVersion`、**`updateNewVersion = res.version \|\| updateNewVersion.value`**（事件可能早于本次 invoke 返回，这里保证「跳过版本」标签不为空）；失败分支同样读 `res.message` / `res.detail` |
| `onOpenUpdateLog()` | `await window.updateTools.openLog()`：在文件管理器里定位 `userData/updater.log`（没有日志则打开 `userData` 目录）；失败时把消息写到**另一行** `updaterStatus`（`hf-error`），异常同样兜住 |
| `onDownloadUpdate()` / `onCancelUpdate()` | `window.updateTools.download()` / `cancel()`；失败时 message + detail 双写（取消下载现在也读返回值：`updateMessage = res.message \|\| '取消下载失败，请重试'`、`updateDetail = res.detail \|\| ''`、`hf-error`） |
| `onInstallUpdate()` | `window.updateTools.install()`；成功时主进程即将退出安装，**只在 `ok: false` 或返回了 `message` 时**写提示（如「当前有任务正在进行」）；失败同样 message + detail 双写 |
| `onSkipVersion(skip)` | `saveUpdater({ skippedVersion: skip ? updateNewVersion.value : '' })`——**写入的是目标版本**（不是 `updateVersion`），用于「跳过版本」与「恢复提示版本」两个按钮；成功时清空 `updateDetail`（并写「已跳过版本 x」/「已恢复提示版本 x」，x 同样取 `updateNewVersion.value`）；失败取 `res.message \|\| '操作失败'` 并置 `hf-error` |
| `onMounted(async)` | ① `try { updateVersion.value = window.updateTools.version() \|\| '' } catch` ——**读版本号失败时写本区块自己的 `updateMessage = '读取版本号失败'` 与 `updateStatusClass = 'hf-error'`**；② `window.updateTools.onProgress(applyUpdateProgress)` 订阅（preload 单订阅，反复进出本页只替换回调）；③ 再用 `window.updateTools.status()` 补齐一次主进程状态（`try` 包住、失败静默保持 `idle`；只在 `st.stage` 存在且不为 `idle` 时套用）——**这条补齐是必需的**：主进程的启动静默检查（3 秒）早于本页订阅，不补这一次，那次失败就只剩「尚未检查更新」，连带它的「查看详情 / 打开日志目录」一起看不到；补齐之后若 `updateMessage` 仍为空，才按状态兜底成「尚未检查更新」或「上次检查更新失败」；④ `settingsTools.get()` → `s.updater \|\| {}` 回填 `feedUrl` / `autoCheck`（`autoCheck !== false` 即视为开启，与主进程默认值一致），异常写 `setUpdaterStatus('读取更新设置失败', 'hf-error')`；⑤ `window.addEventListener('keydown', onFeedDialogKey)` |
| `onBeforeUnmount()` | `window.removeEventListener('keydown', onFeedDialogKey)`——与 `onMounted` 成对注册，避免离开设置页后监听器残留 |

**关键流程**：

- **更新源编辑（弹窗）**：更新源不在卡片上直接编辑，而是「自定义更新源」按钮打开弹窗。打开时 `openFeedDialog()` 把已存值拷进 `feedDraft` / `autoCheckDraft`；**编辑期间不动已存值**，点「保存」才经 `settings:save-updater` 落盘并关闭，点「取消」或 ESC 直接丢弃。「重置」把 `feedUrl` 与 `skippedVersion` 一起清空（回到打包内置地址、并恢复所有版本的提示）。保存 / 重置 / 打开日志的反馈写在**卡片最后一行 `.hf-status`**（`updaterStatus`，排在运行环境一行之后），与检查更新的进度文案（`updateMessage`）分属两行 —— 早前把两者放在同一行时，保存后紧接着到达的进度推送会把提示覆盖掉，表现为「点了保存没反应」。
- **应用更新（文案单点产出 + 详情折叠）**：状态**全部由主进程 `update:progress` 推送驱动**，本区块不做轮询，也**不自己拼文案**。所有触发动作都只是 `invoke` 一发，结果与进度都从同一路推送回来。

> **为什么渲染层不再拼串**：`available` / `skipped` / `none` / `error` 的句子统一由主进程 `updater/` 产出（单点产出：`base.ts` 的 `bindEvents()` 写状态文案，`actions.ts` 写两条「无事件」守卫文案），渲染层只渲染 `message`、把 `detail` 收进「查看详情」。早前渲染层也自己拼一套（如「发现新版本 X，点『下载更新』获取安装包」），与事件推送的文案**两处各写一套、互相覆盖**，同一状态会出现两句话打架。

## 5. 注意事项与实现要点

1. **语音服务按厂家配置**：`settingsTools.get()` 返回的 `s.voice` 里有 `active` 与 `providers`（各家 **`{ apiKey }`**，已无 `defaultModel`），区块把 `providers` 存进 `vSaved`、把 `active` 写进 `vProvider`，再调 `syncVoiceForm()` 回填表单；`voice:list-models` 另提供**厂家目录**（label / Key 提示 / 出厂默认模型 / 模型表），因此「加一家厂家」只需改主进程的 `voiceCatalog.ts`，本区块不用改。保存走 `{ provider, config: { apiKey } }`。
2. 本区块**没有**「自定义保存目录」表单项（只有厂家 / API Key），也没有「厂家默认模型」（本轮删除）；保存目录仍**全局一份**、由使用侧经 `voiceTools.getSaveDir`、`voiceTools.pickDir` 处理。
3. **`settingsTools.get()` 由四个区块各调一次**（`ModelSection` / `VoiceSection` / `RenderSection` / `UpdateSection` 各自的 `onMounted`，分别取 `customModel` / `voice` / `render` / `updater`），各自在独立 `try` 中，失败分别写 `status` / `vStatus`（渲染档位那次仅静默回落内置默认，更新那次写 `updaterStatus`），互不影响。**未挂载的分类一次都不调**。
4. **「厂家默认模型」已删除**：`syncVoiceForm()` 切厂家时只回填该厂家的 `apiKey`；系统音色用哪个模型由厂家目录固定（`vendorSystemModel` 只用于说明文案），克隆音色的模型在「音色管理 → 音色映射管理」里按音色绑定。
5. **`onSaveVoice` 无前置校验**：空 API Key 也会提交，合法性由主进程判断并回传 `message`；**API Key 落盘位置**界面只说「只保存在本电脑」（不写 `userData/settings.json` 这类内部路径），两个输入框均 `type="password"`，不做额外脱敏。
6. **状态类名沿用全局约定**：`''` / `'hf-ok'` / `'hf-error'`，与 `hf-status` 样式配套，各区块的状态条（模型配置、语音服务、渲染档位、应用更新两行、whisper 表单）共用。
7. **单订阅进度回调**：preload 用模块级 `_whisperProgressCb` / `_whisperProgressBound` 实现「重复注册仅替换回调」，`WhisperSection` 的 `onMounted` 注册即可、无需解绑；离开页面后回调仍指向该闭包，其它页面用同一通道会互相覆盖。
8. **`wmBusy` 与主进程双重防重**：界面 `:disabled="wmBusy !== ''"` 禁用全部下载按钮，`actDownload` 入口再判一次，主进程还有 `downloading` 标志与「已有模型下载任务进行中，请稍候」兜底。
9. **`barPercent` 钳制**：`showBar` 内 `Math.max(0, Math.min(100, Number(percent) || 0))`，异常值不会撑破进度条。
10. **文件名登记后不可改**：编辑模式 `formFile` 输入框 `:disabled="editId !== ''"`，提示「须为 ggml- 开头、.bin 结尾，登记后不可改」；主进程按 `id ↔ 文件名` 严格一一对应，不做前缀或模糊归属。
11. **未知模型文件只能提示**：`unknownFiles` 无法直接使用，需经「添加自定义模型」按文件名登记后才能像内置模型一样下载与使用。
12. **whisper-cli.exe 缺失是硬阻塞**：`cliTip` 以警告橙显示放置路径；缺该文件时转录无法进行（主进程 `whisper:transcribe` 同样校验并返回提示）。
13. **`WhisperSection` 只暴露「打开模型目录」一个入口**：即 `openDir('models')`；`cliTip` 文案提到的「旁的位置」实指 whisper 资源目录，界面无对应按钮（主进程支持 `openDir('cli')`）。
14. **提示优先级与删除语义**：`actRemove` 先取 `res.message`（主进程会说明本地模型文件仍保留），无 message 才按 `ok` 给简短文案；`actDelete` / `actRemove` 均无二次确认弹窗——前者删本地模型文件，后者只删登记条目。
15. **渲染默认档位是「全局默认」而非唯一真源**：真正生效的档位是「项目覆盖（`project.json` 的 `render`）> 此处保存的全局默认 > 内置默认」；本区块只写全局默认（`settings:save-render`），项目级覆盖由「HTML生成」页的档位下拉经 `project:set-render` 写入，两处互不覆盖。
16. **渲染默认档位不需要 `onMounted` 之外的状态同步**：`saveRenderDefaults()` 成功后就地刷新 `composables/useRenderOptions.ts` 的模块级 `renderDefaults` 单例，因此保存后其他页面（尤其「HTML生成」页的 `optionNote`）立即看到新默认值，无需再次 `get()`。
17. **分类记忆键名走常量、不可跟随品牌改名**：左侧导航的上次分类存在渲染层 `localStorage` 的 `STORAGE_KEY_SETTINGS_SECTION`（`@renderer/constants`，值 `'myapp.settingsSection'`），页面内在 `constants.ts` 里以 `SETTINGS_SECTION_KEY` 引用、由 `helpers.ts` 读写。键名前缀 `'myapp.'` 是首次上线时的 npm 包名、**故意不跟随品牌名「影坊 / ShadowMill」**——prod 下页面走 `file://` 同源，键名就是用户数据的地址，改名会让「上次停留的分类」与「上次打开的项目」（`STORAGE_KEY_PROJECT_CTX`）一起读不到。真要改前缀必须补「读旧键 → 写新键」的迁移，不能只改常量。同理，页面上要显示的**品牌文案**不要写死在这里，取 `@shared/constants`。
18. **`activeSection` 的读写都是静默容错**：`helpers.ts` 的 `readActiveSection()`（读）与 `persistActiveSection()`（写）各自包 `try/catch`（源码注释：隐私模式等场景静默忽略），因此「分类记忆失效」永远不会以报错形式出现——排查时先看 `localStorage` 里该键的实际值。
19. **详情区：文案主进程单点产出、渲染层只分两层渲染**：`updateMessage`（人话）来自主进程，`updateDetail`（原始报错 + 请求地址）默认折叠；`applyUpdateProgress()` 在 `detail` 为空时自动把 `showUpdateDetail` 复位，避免旧报错面板常驻。**「打开日志目录」按钮只在更新确实出错时出现**：`updateLogVisible = computed(() => updateStage.value === 'error' || updateStatusClass.value === 'hf-error')` 控制它的 `v-if`（所在动作行 `v-if="updateDetail || updateLogVisible"`）——没出错时把用户送进日志目录没有意义（他看到的是自己读不懂的文件，只会以为哪里坏了），出错时它才是拿到原始报错的唯一出口。**启动静默检查的失败仍然能看见**：`UpdateSection` 的 `onMounted` 在订阅 `update:progress` 之后用 `window.updateTools.status()` 补齐一次主进程状态（`stage` 非 `idle` 才套用），把 `error` 阶段连同这个入口一起带出来（此前那次失败发生在订阅之前，传不到渲染层，卡片只会显示「尚未检查更新」）。它的失败反馈写在独立一行 `updaterStatus`，不会覆盖检查/下载的状态文案。
20. **两个下拉用 `:model-value` + `@change`，刻意不用 `v-model`**：`CUSTOM_VALUE`（`'__custom__'`）是哨兵值，不是真实地址 / 模型名。用 `v-model` 时 `HfSelect` 会先 emit `update:modelValue`，哨兵值当场写进 `baseUrl` / `modelId`，用户接着点「保存配置」就会把 `'__custom__'` 存进 `settings.json`（下次启动下拉里显示一个假地址）。改成 `@change` + `onBaseUrlPick` / `onModelPick` 后，选「自定义…」只切手填态、**不动当前值**——这也正好符合常见诉求「在现有地址上改一改」。注意 `HfSelect` 只在用户点选**且值确实变化**时 emit `change`（程序化改值不发），所以哨兵分支不会因重复点选而反复触发。
21. **必须保留「自定义」手填**：`MODEL_PROVIDERS` 只是常见取值快捷方式（见 [constants.ts.md](../constants.ts.md) §3.3），自建网关 / 中转站 / 未收录服务商都要能用；而且模型名会被服务商下线、改名，枚举必然过时。因此两行的下拉最后都固定带一项「自定义…（手动填写）」，切到手填态后走原来的 `v-model` 输入框 + `collectCustomModel()` 提交路径，**手填值不受预设表任何约束**（本区块也不用预设表做校验）。
22. **「当前配置」兜底项是必需的**：`baseUrlGroups` / `modelGroups` 会把「已保存但不在预设内」的值补成一组「当前配置」。不加这一步，`HfSelect` 找不到匹配选项就退回占位文字（本区块未传 `placeholder`，即显示「请选择…」），用户看到的是「我配的地址 / 模型没了」——实际值还在 `settings.json` 里。`onMounted` 里把 `baseUrlCustom` / `modelCustom` 置 `true` 是同一问题的另一半：命中不了预设时直接进手填态，把真实值原样显示出来。
23. **选项文字就是 URL 本身，不拼接任何说明**：`baseUrlGroups` 的选项由 `p.baseUrls.map((u) => ({ value: u, label: u }))` 生成——Base URL 没有需要额外解释的地方，加了反而是噪音（源码注释）。早前选项文案是 `url + '（' + note + '）'`，`note` 只用来标「OpenAI 格式 / Anthropic 格式，当前不支持」，**这一整套已随预设表删掉 `note` 字段而移除**；`/v1` 只是同一格式下的写法差异，所以**每家用一条官方写法就够**（DeepSeek 两种拼法都能用，但只列不带 `/v1` 的那条；百炼的 `/v1` 是它路径的固定组成部分，照原样保留）。「当前配置」兜底项仍带 `title: '你当前保存的值'`，那是**它自己的说明**，与预设表的 `note` 无关。HfSelect 组件支持 `disabled` 选项（不可点选），但**预设里已无 `disabled` 端点**：卡片提示已经写明「只支持 OpenAI 格式的端点，Anthropic 格式暂不支持」，再在下拉里列两个灰项等于同一句话说两遍（与 §5.24 同一条判据）。
24. **界面文案不写「OpenAI 兼容模式」这类术语**（2026-10 起）：它原本想告诉用户"这个端点是 OpenAI 接口规范的、本应用能用"，但对用户是纯噪音——用户选的是**哪家服务商**，不是"某个协议"；能不能用已经由**选项列表本身**表达（列出来的都是能用的，不支持的端点不列，见 §5.23）；而且 `/compatible-mode/` 就写在 URL 里，说一遍等于重复。所以服务商组标题只说名字（`阿里云百炼`，不带括号补充），选项文字就是裸 URL。**判断标准**：这句话删掉会不会让用户少知道一件"他需要据此做决定"的事？不会就删。
25. **跨页「带意图跳转」在本页落地**：配音页「音色管理」弹窗里的「API Key 设置」（以及它未配 Key 时的自动跳转）会先 `requestSettingsSection('voice')` 再 `goPage('settings')`；`index.vue` 在 `<script setup>` 里先调 `applySectionIntent()` 消费它（`watchSectionIntent()` 作兜底），因此进设置页直接落在「语音服务」。分类枚举只在 `@renderer/composables/useNavIntent` 定义一处（`SETTINGS_SECTIONS`），页面不再有本地字面量数组——新增分类必须同时改 `useNavIntent.ts` 与这里派生的 `SETTINGS_SECTION_KEYS` / `SETTINGS_NAV_ITEMS` 消费者。详见 [common.md](../common.md) §10。
26. **「跳过版本」必须写目标版本（`updateNewVersion`），不能写当前版本（`updateVersion`）**（2026-10 修复）：主进程在 `updater/base.ts` 的 `update-available` 分支里是拿 **available 的那个版本号**与 `settings.json` 的 `skippedVersion` 比较，而原先两个按钮的标签与 `onSkipVersion()` 读写都用了 `updateVersion`（当前版本）——写进去的当前版本**永远不命中**，「跳过该版本」等于没生效；按钮标签还把「新版本」显示成了「当前版本」。现在新增 `const updateNewVersion = ref('')`（源码注释写明它专供跳过逻辑），四处使用：`applyUpdateProgress()`（`updateNewVersion.value = d.version || ''`，`UpdateProgressPayload.version` 即目标版本；`currentVersion` 仍写 `updateVersion`）、`onCheckUpdate()` 成功分支（`res.version || updateNewVersion.value`）、模板两个按钮的标签、`onSkipVersion()` 的写入值与两条提示文案。`updateVersion` 收窄为**只做「当前版本」显示**（模板 `{{ updateVersion || '—' }}`、`applyUpdateProgress()` 的 `currentVersion`、`onCheckUpdate()` 的 `currentVersion`、`onMounted` 的 `window.updateTools.version()`）。
27. **「跳过版本 / 恢复提示版本」独立成行、排在「运行环境（分包）」之前**（2026-10 调整，用户反馈驱动）：此前这两段在卡片最末尾（`updaterStatus` 反馈行之后），界面上落到了「下载运行环境」按钮下面，被读成运行环境的操作（用户反馈「跳过版本在下载环境下面了，不合理」）。现在**整段上移**到「查看详情」详情块与运行环境状态行之间，并在源码里就地留注释写明「它俩属于『应用更新』的分支操作，必须排在运行环境那几行之前」。**方案取舍**：用户明确选择「**仍独立成行**、只把它提到运行环境区块之前」，**没有**把它并进上面那排更新动作按钮（检查更新 / 自定义更新源 / 下载更新 / 取消下载 / 立即重启安装）——那排是进行中的更新动作，跳过 / 恢复是分支操作，混排会让按钮语义变模糊。**逻辑零改动**：仍是 `updateStage === 'available'` / `'skipped'` 两段 `v-if` / `v-else-if`，状态、函数与 IPC 一律未动（本次只动模板顺序 + 2 行注释）。`UpdateSection` 现在的完整渲染顺序：当前版本 → 更新动作按钮排 → 更新状态文案 → 详情按钮排（查看详情 · 收起详情 / 打开日志目录）→ 详情折叠块 → **跳过版本 / 恢复提示版本** → 运行环境状态行 + 运行环境按钮排（下载运行环境 / 重试 · 取消下载 · 从本地文件安装…）+ `runtimeNotice` → 保存 / 重置反馈行（`updaterStatus`）。
28. **whisper 的卡片外壳、标题与长说明由 `index.vue` 提供，`components/WhisperSection.vue` 只画网格与表单**：因此它**不能**像其余四个区块那样自带 `.card.hgen-panel`——`SECTION_COMPONENTS` 里没有 `whisper` 键，模板里它是独立的 `<div v-if="activeSection === 'whisper'" class="card hgen-panel">` 分支（内部依次 `.panel-title` / `.hgen-tip` / `<WhisperSection />`），其余分类才走 `<component :is>`。改这一类的卡片外观（标题文案、说明、要不要卡片）要动 `index.vue`；改模型网格与表单才动 `components/WhisperSection.vue`。
29. **导航项由 `v-for` 渲染、导航项样式写 `white-space: nowrap`**：导航项文案与顺序的唯一来源是 `constants.ts` 的 `SETTINGS_NAV_ITEMS`；红点 span 的显隐条件是 `item.key === 'update' && updateStage === 'available'`（读的是 `helpers.ts` 的模块级 `updateStage`）。`assets/main.css` 的 `.settings-nav-item` 里 `white-space: nowrap` 的源码注释写明原因：「导航项是 v-for 渲染的单行按钮：标签一律不换行，免得 4 字与 6 字的项在 150px 栏宽下高度不一致」。

## 6. 运行环境（分包）一行（`useRuntime`）

运行环境改成「`ffmpeg` / `hyperframes` 各成一个 7z（**实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14）、首次用到时由用户确认后下载并解到 `<userData>/runtime/<包名>/`，`whisper` 随安装包」之后，`UpdateSection` 的这一行是**三态**（分包方案见 `docs/runtime-pack-split.md`）：

- **显隐**：`v-if="runtimeBusy || runtimeFailed || runtimeHasMissing"`（就绪是常态，不再占位、也不再显示「运行环境已就绪（体积）」）；
- **文案**：`runtimeStatusText` —— busy → `runtime.message || '正在准备运行环境…'`；failed → `runtime.message || '运行环境准备失败'`；hasMissing → `'运行环境需要下载：' + runtimeMissingText`。`runtimeStatusClass` 只在 `runtimeFailed` 时给 `hf-error`；
- **按钮**：「下载运行环境 / 重试」（`onPrepareRuntime()`，`:disabled="runtimeBusy"`）、`runtimeCancellable` 时「取消下载」（`cancelRuntime`）、`runtimeMissing.length` 时**「从本地文件安装…」**（`onPickLocalPack()`，按 `docs/runtime-pack-split.md` §11.1：这个入口只在缺包 / 失败时出现）；
- **`onPickLocalPack()`**：调 `window.settingsTools.pickRuntimePack()`（频道 `settings:pick-runtime-pack`，弹文件框选 `ffmpeg.7z` / `hyperframes.7z`）；取消或失败写 `runtimeNotice`，成功后写「已导入本地运行环境包，正在解包…」并 `await prepareRuntime()` 触发解包；
- **`runtimeNotice`**：这一行下方的反馈文本（`v-if`），与区块自身的 `updateMessage` / `updaterStatus` 相互独立；
- **数据来源**：`useRuntime()` 解构出的 `{ runtime, busy, failed, hasMissing, cancelable, missing, missingText, prepare, cancel }`（旧的 `retry` / `sizeText` 已删，见 [common.md](../common.md) §4.1）；
- **与「应用更新」的先后**：「跳过版本 / 恢复提示版本」两行排在**本区块之前**（源码注释：它俩是「应用更新」的分支动作，掉到「下载运行环境」下面会被读成运行环境的操作）；保存 / 重置 / 打开日志的反馈行（`updaterStatus`）仍在**本区块之后**，本次未动。

## 7. 依赖与协作

### 7.1 import 一览（按文件）

| 文件 | 来源 | 名称 | 用途 |
|------|------|------|------|
| `index.vue` | `vue` | `watch` | 分类变化写回 `localStorage` |
| `index.vue` | `./helpers` | `activeSection`、`applySectionIntent`、`persistActiveSection`、`updateStage`、`watchSectionIntent` | 分类状态、意图消费、导航红点 |
| `index.vue` | `./constants` | `SETTINGS_NAV_ITEMS` | `v-for` 渲染 5 个导航按钮 |
| `index.vue` | `./components/*.vue` | 5 个区块组件 | 4 个（`model` / `voice` / `render` / `update`）进 `SECTION_COMPONENTS` 映射，`WhisperSection` 供 whisper 分类的 `.card.hgen-panel` 分支直接使用 |
| `constants.ts` | `@renderer/constants` | `STORAGE_KEY_SETTINGS_SECTION` | 分类记忆键名（落成 `SETTINGS_SECTION_KEY`） |
| `constants.ts` | `@renderer/composables/useNavIntent` | `SETTINGS_SECTIONS`、`type SettingsSectionKey` | 分类枚举的唯一来源 |
| `helpers.ts` | `vue` | `ref`、`watch` | 模块级 ref 与意图兜底监听 |
| `helpers.ts` | `@shared/types` | `type UpdateStage` | `updateStage` 的类型 |
| `helpers.ts` | `@renderer/composables/useNavIntent` | `consumeSettingsSection`、`useSettingsSectionRequest`、`type SettingsSectionKey` | 跨页导航意图的消费 |
| `helpers.ts` | `./constants` | `SETTINGS_SECTION_KEYS`、`SETTINGS_SECTION_KEY` | 白名单校验与键名 |
| `types.ts` | `@shared/types` | `type IpcResult`、`type UpdateCheckResult` | `UpdateCheckReply` 的组成 |
| `ModelSection.vue` | `vue` | `computed`、`onMounted`、`ref` | 响应式与挂载回填 |
| `ModelSection.vue` | `@renderer/constants` | `MODEL_PROVIDERS` | 两个下拉的预设数据源（`ProviderPreset[]`） |
| `ModelSection.vue` | `@renderer/components/HfSelect.vue` | `HfSelect`（默认）、`type HfSelectGroup` | 两处下拉与选项分组类型 |
| `ModelSection.vue` | `../constants` | `CUSTOM_VALUE` | 「自定义…」哨兵值 |
| `VoiceSection.vue` | `vue` | `computed`、`onMounted`、`ref` | 同上 |
| `VoiceSection.vue` | `../types` | `type VoiceProviderView` | 厂家目录条目 |
| `VoiceSection.vue` | `@renderer/components/HfSelect.vue` | `HfSelect`、`type HfSelectGroup` | 厂家下拉 |
| `RenderSection.vue` | `vue` | `computed`、`onMounted`、`ref` | 同上 |
| `RenderSection.vue` | `@shared/types` | `type RenderFps`、`type RenderQuality` | 两个档位的类型标注 |
| `RenderSection.vue` | `@renderer/utils/render` | `FALLBACK_RENDER`、`RENDER_FPS_OPTIONS`、`RENDER_QUALITY_OPTIONS`、`renderQualityLabel` | 档位选项表、内置默认与保存成功文案里的质量标签 |
| `RenderSection.vue` | `@renderer/composables/useRenderOptions` | `saveRenderDefaults` | 保存全局默认档位（内部刷新 `renderDefaults` 单例） |
| `RenderSection.vue` | `@renderer/components/HfSelect.vue` | `HfSelect`、`type HfSelectGroup` | 质量 / 帧率两处下拉 |
| `WhisperSection.vue` | `vue` | `computed`、`onMounted`、`ref` | 派生文案、进度订阅与状态 |
| `WhisperSection.vue` | `@renderer/utils/escape` | `escTxt` | 模型文本（名称、文件名、说明、URL、`localFile`）的 HTML 转义 |
| `UpdateSection.vue` | `vue` | `computed`、`onBeforeUnmount`、`onMounted`、`ref` | 更新与运行环境状态；`onBeforeUnmount` 用于注销 ESC 监听 |
| `UpdateSection.vue` | `@shared/types` | `type UpdateProgressPayload` | `applyUpdateProgress` 的载荷标注 |
| `UpdateSection.vue` | `@renderer/composables/useRuntime` | `useRuntime` | 运行环境状态行与「下载运行环境 / 重试」「取消下载」「从本地文件安装…」 |
| `UpdateSection.vue` | `../types` | `type UpdateCheckReply` | `updateTools.check()` 回执的类型标注 |
| `UpdateSection.vue` | `../helpers` | `updateStage` | 跨组件共享状态（导航红点共用） |

**本页不引入 `useToast`**：提示全部走各区块自己的状态行（`status` / `vStatus` / `rStatus` / `updateMessage` / `updaterStatus` / whisper 的 `status`）；`WhisperSection` 不 import 任何组件或 composable，也不接收 / 抛出事件。`sizeMB`、`speed`、`localBytes`、`barPercent`、`barText` 未转义（由该组件生成或来自主进程数值）。

### 7.2 preload 方法汇总

| preload 调用 | IPC 频道 | 归属文件 | 说明 |
|--------------|----------|----------|------|
| `window.settingsTools.get()` | `settings:get` | Model / Voice / Render / Update 四个区块的 `onMounted` | 读取 `AppSettings`（各区块只取自己那一段：`customModel` / `voice` / `render` / `updater`；未挂载的分类不调用） |
| `window.settingsTools.save(customModel)` | `settings:save` | ModelSection | preload 包装为 `{ customModel }` |
| `window.settingsTools.test(customModel)` | `settings:test` | ModelSection | preload 包装为 `{ customModel }`，用当前表单内容测试 |
| `window.settingsTools.saveRender(render)` | `settings:save-render` | RenderSection（经 `saveRenderDefaults`） | preload 包装为 `{ render }`；只更新 `render` 段 |
| `window.settingsTools.saveUpdater(updater)` | `settings:save-updater` | UpdateSection | preload 包装为 `{ updater }`；只更新 `updater` 段（`feedUrl` / `autoCheck` / `skippedVersion`） |
| `window.settingsTools.pickRuntimePack()` | `settings:pick-runtime-pack` | UpdateSection | 选一个本地 `ffmpeg.7z` / `hyperframes.7z` 导入（离线兜底），成功后接着 `prepareRuntime()` |
| `window.updateTools.version()` | `update:version` | UpdateSection | **同步**返回当前版本号字符串（`sendSync`），`onMounted` 首屏显示用（全应用唯一的同步 IPC，调用点见 §4.5.3 的 `onMounted` 行与 [04-目录架构-src-renderer.md](../../../../04-目录架构-src-renderer.md) §7 第 6 条） |
| `window.updateTools.check()` | `update:check` | UpdateSection | 检查更新，返回 `{ ok, state, version, currentVersion, message, detail? }`（失败分支 `{ ok: false, message, detail? }`） |
| `window.updateTools.download()` | `update:download` | UpdateSection | 下载安装包；失败分支带 `message` + `detail` |
| `window.updateTools.cancel()` | `update:cancel` | UpdateSection | 取消下载；异常时回 `取消下载失败，请重试` + `detail` |
| `window.updateTools.install()` | `update:install` | UpdateSection | 退出并运行安装器；本机有任务在跑时返回 `ok: false` + 提示 |
| `window.updateTools.status()` | `update:status` | UpdateSection | 取一次主进程当前更新状态（`Promise<UpdateProgressPayload>`）：主进程 `state` 常驻，用于 `onMounted` 补齐「启动静默检查」那次失败（该事件早于本区块订阅 `update:progress`） |
| `window.updateTools.openLog()` | `update:open-log` | UpdateSection | 在文件管理器里定位 `userData/updater.log`（无日志则打开 `userData` 目录）；只在本区块判断更新出错（`updateLogVisible`）时才有按钮；失败时消息写在 `updaterStatus` 那行 |
| `window.updateTools.onProgress(cb)` | `update:progress` | UpdateSection | 更新状态与下载进度订阅（单订阅），载荷含 `message` / `detail` |
| `window.voiceTools.listModels()` | `voice:list-models` | VoiceSection | 取**厂家目录 `providers`**（本区块只用 `providers`；异常被 `.catch()` 吞掉） |
| `window.voiceTools.saveConfig({ provider, config })` | `voice:save-config` | VoiceSection | preload **直接透传**该载荷（不再包 `{ voiceTTS }`） |
| `window.whisperTools.status()` | `whisper:status` | WhisperSection | 返回 `{ ok, cli, modelsDir, langs, models, unknownFiles, usedBytes, currentModelId }` |
| `window.whisperTools.download(id)` | `whisper:download` | WhisperSection | preload 包装为 `{ id }`；本地已有文件时直接返回提示不重复下载 |
| `window.whisperTools.delete(id)` | `whisper:delete` | WhisperSection | preload 包装为 `{ id }`；转录进行中会被主进程拒绝 |
| `window.whisperTools.setCurrent(id)` | `whisper:set-current` | WhisperSection | 未下载 / 转录中会被拒绝并回传 `message` |
| `window.whisperTools.addModel(payload)` | `whisper:add-model` | WhisperSection | `payload` 为表单对象 |
| `window.whisperTools.updateModel(payload)` | `whisper:update-model` | WhisperSection | `payload` 含 `id` 与可改字段 |
| `window.whisperTools.removeModel({ id })` | `whisper:remove-model` | WhisperSection | 仅移除登记条目，本地模型文件保留 |
| `window.whisperTools.openDir('models')` | `whisper:open-dir` | WhisperSection | 主进程 `which === 'cli'` 时可开 cli 目录，本区块只传 `'models'` |
| `window.whisperTools.onProgress(cb)` | `whisper:progress` | WhisperSection | main → renderer 进度推送（单订阅） |
| `window.runtimeTools.prepare(packs?)` / `cancel()` | `runtime:prepare` / `runtime:cancel` | UpdateSection（经 `useRuntime`） | 由 `useRuntime()` 的 `prepare` / `cancel` 间接调用，不直接出现 `window.runtimeTools.*` |

### 7.3 组件协作

- **外壳 ↔ 区块**：**不传 props、不监听事件**——`model` / `voice` / `render` / `update` 由外壳用 `<component :is>` 挂载，`whisper` 由外壳的 `.card.hgen-panel` 分支（里面直接写 `<WhisperSection />`）挂载；「显示哪一类」由外壳决定，「这一类里显示什么」全归区块（whisper 的卡片外壳、标题与说明归外壳）。
- **区块 ↔ 区块**：互不引用；要共享的只有 `helpers.ts` 的两个模块级 ref（`activeSection` 供导航高亮 / 点击，`updateStage` 供「应用更新」红点与更新阶段判断）。
- **区块 ↔ 共享层**：各区块直接从 `@renderer/*` 取公共能力（`HfSelect` / `MODEL_PROVIDERS` / 渲染档位工具 / `useRenderOptions` / `useRuntime`），页面级相对路径（`../constants` / `../types` / `../helpers`）只用于本页内部。
