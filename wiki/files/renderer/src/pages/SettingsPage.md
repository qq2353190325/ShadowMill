# src/renderer/src/pages/SettingsPage/（页面）

> 设置页：自定义模型（Base URL / 模型 ID 走服务商预设下拉、可切手填）、**语音服务（按厂家配置 API Key；模型与音色由厂家目录固定）**、视频渲染默认档位与应用更新，并挂载语音识别模型区块。

- **覆盖文件**：

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/renderer/src/pages/SettingsPage/index.vue` | 742 | 页面主体：左侧分类导航 + 自定义模型卡片、**语音服务卡片（按厂家）**、视频渲染默认档位卡片、应用更新卡片、**运行环境一行（分包三态 + 本地导入）**，末张卡片挂载子组件；分类记忆键与服务商预设表取 `@renderer/constants`，**分类枚举取 `@renderer/composables/useNavIntent`** |
| `src/renderer/src/pages/SettingsPage/WhisperSection.vue` | 274 | 页面子组件：语音识别模型区块（原 `pages/settings/whisper.js` 的 `window.__settings.initWhisper`） |

- **类型**：页面 + 页面子组件（均为 SFC，`<script setup lang="ts">`）
- **对外导出**：两者均为默认导出组件，**无 props、无 emit**（`<WhisperSection />` 不传 props、不监听事件，状态全部内部维护）
- **持久化**：配置写入本机 `userData/settings.json`，表单式「读 → 改 → 保存」；**左侧分类的记忆**（`'model'` / `'voice'` / `'render'` / `'update'` / `'whisper'`）另存在渲染层 `localStorage`，键名取 `@renderer/constants` 的 `STORAGE_KEY_SETTINGS_SECTION`（值 `'myapp.settingsSection'`），**不跟随品牌改名**（见 §2.2 `activeSection` 与 §5 注意事项）

## 1. 结构总览

根节点下依次五张 `.card.hgen-panel`（后四张 `margin-top:16px`，第 1 张无上边距）：

| 卡片 | 内容 | 归属 |
|------|------|------|
| 1 | 「自定义模型」：Base URL（预设下拉 / 手填二选一）/ 模型 ID（同）/ API Key / 启用 + 保存 / 测试连接 | 父组件 |
| 2 | 「语音服务（按厂家配置）」：厂家下拉 + API Key（placeholder 来自厂家）+ 「保存该厂家配置」。**已删掉「厂家默认模型」整行**（连带 `vModel` / `voiceModelGroups` / `vendorDefaultModel` 与回填逻辑） | 父组件 |
| 3 | 「视频渲染默认档位」：质量 / 帧率下拉 + 保存渲染默认档位 + 状态条 + 当前质量说明 | 父组件 |
| 4 | 「应用更新」：当前版本 + 检查更新 / 自定义更新源（弹窗）/ 下载 / 取消 / 重启安装 + 状态条 + **详情折叠（查看详情 · 收起详情）与仅更新出错时才出现的「打开日志目录」（`updateLogVisible`）** + 跳过版本 | 父组件 |
| 5 | 「语音识别模型（whisper.cpp 字幕转录）」：仅标题与 `.hgen-tip` 长说明 | `<WhisperSection />` |

自定义模型开启后「HTML 生成 / 修改」页改用该模型；**语音服务配置（按厂家）** 供「音色管理」「文字生音频」使用；卡片 3 是「HTML生成」页「转视频」的全局默认档位（项目级覆盖优先于它）；卡片 4 是应用自更新的唯一入口（检查 / 下载 / 重启安装，全部状态由 `update:progress` 通道驱动；**文案由主进程单点产出，本页只渲染 `message`、把 `detail` 收进可折叠的详情块**）；卡片 5 供字幕页「从音频生成字幕」本机离线识别（不消耗 API 额度）。

## 2. SettingsPage/index.vue

### 2.1 模板区块

| 区块 | 关键点 |
|------|--------|
| 卡片 1 顶部 `.hgen-tip` | 原文（改写后）：「配置「HTML 生成 / 修改」使用的模型服务。只支持 OpenAI 格式的端点，Anthropic 格式暂不支持。Base URL 与模型 ID 可从常见服务商直接选，也可手填自己的服务地址；填好 API Key 并勾选「启用」后，HTML 生成页就用这个模型工作。API Key 只保存在本电脑。」**措辞约定**：这段是给使用者看的——不出现 `userData/settings.json` 这类内部路径、不写「OpenAI 兼容模式」这类无信息量的标签（见 §5.24）；但**要写影响决策的限制**，「只支持 OpenAI 格式的端点，Anthropic 格式暂不支持」就是典型（自建网关 / 中转站用户只看手填框、看不到下拉，必须从文字上知道；**这句话也是下拉里不再列 Anthropic 灰项的理由**——见 §5.23）。安全说明用「只保存在本电脑」。卡片标题也据此简化为「自定义模型」（去掉「（OpenAI 兼容）」——协议限制改由这段文字承担）。 |
| **Base URL 行**（卡片 1） | **二选一渲染**：`v-if="!baseUrlCustom"` → `HfSelect`（`:model-value="baseUrl"`、`:groups="baseUrlGroups"`、`@change="onBaseUrlPick"`，**不用 `v-model`**）；`v-else` → `<input v-model="baseUrl" class="hgen-input" style="flex:1" placeholder="https://…/v1（OpenAI 兼容，需含版本段）">` + 「从列表选」按钮（`@click="baseUrlCustom = false"`，切回下拉态；手填值保留） |
| **模型 ID 行**（卡片 1） | 同上的二选一：`v-if="!modelCustom"` → `HfSelect`（`:model-value="modelId"`、`:groups="modelGroups"`、`@change="onModelPick"`）；`v-else` → `<input v-model="modelId" … placeholder="如 deepseek-flash / qwen3.8-max">` + 「从列表选」（`@click="modelCustom = false"`） |
| API Key 行（卡片 1） | `v-model="apiKey"`、`type="password"`，placeholder「sk-...」 |
| 启用行 | `v-model="enabled"`、`type="checkbox"`，文字「使用自定义模型生成 / 修改 HTML」 |
| `.hgen-actions`（卡片 1） | `保存配置`（主按钮 → `onSave`）、`测试连接`（`onTest`） |
| `.hf-status`（卡片 1） | `:class="statusClass"`、`{{ status }}` |
| 厂家行（卡片 2） | `HfSelect v-model="vProvider" :groups="vendorGroups" @change="syncVoiceForm"`——选项来自 `voiceProviders`（`voice:list-models` / `voice:get-config` 回带的**厂家目录** `VoiceProviderView[]`） |
| API Key 行 | `v-model="vApiKey"`、`type="password"`、`:placeholder="vendorKeyHint"`（占位提示**来自厂家**，千问为「sk-...（DASHSCOPE_API_KEY）」） |
| `.hgen-tip`（卡片 2） | 「每个厂家一把 API Key；模型与音色都在厂家的目录里，**系统音色与合成模型是固定绑定**（当前厂家：系统音色用 `{{ vendorSystemModel }}`）。API Key 只保存在本电脑。」——`vendorSystemModel` = `currentVendor.defaultModel` |
| `.hgen-actions` / `.hf-status`（卡片 2） | 「保存该厂家配置」→ `onSaveVoice`；`:class="vStatusClass"`、`{{ vStatus }}` |
| 质量 / 帧率行（卡片 3） | 两个 `HfSelect`（`v-model="rQuality"` / `v-model="rFps"`、`:groups="qualityGroups"` / `"fpsGroups"`），选项来自 `qualityOptions`（`RENDER_QUALITY_OPTIONS`）与 `fpsOptions`（`RENDER_FPS_OPTIONS`） |
| `.hgen-actions` / `.hf-status`（卡片 3） | `保存渲染默认档位`（主按钮 → `onSaveRender`）；`:class="rStatusClass"`、`{{ rStatus }}`；下方 `.hgen-tip` 显示 `{{ qualityHint }}`（当前所选质量的说明） |
| `.hgen-tip`（卡片 3 顶部） | 原文：「「HTML生成」页点「转视频」时的默认档位，普通使用只需在这两项中选择。单个项目可在「HTML生成」页的「渲染档位」单独覆盖（项目覆盖优先于这里的默认）。质量 draft 编码最快但文字边缘可能有压缩痕迹，仅用于快速确认内容；降低帧率不会缩短成片时长，只是采样更稀、渲染更快。」|
| 当前版本行（卡片 4） | `.sel-label`「当前版本」+ `.hf-file` 显示 `{{ updateVersion \|\| '—' }}`——**只显示当前版本**；待安装的目标版本另有 `updateNewVersion`（见 §2.2 与 §5.26） |
| `.hgen-actions`（卡片 4） | `检查更新`（主按钮，`:disabled="updateBusy"`）、`自定义更新源`（→ `openFeedDialog`）、`下载更新`（仅 `available` / `skipped`）、`取消下载`（仅 `downloading`）、`立即重启安装`（仅 `downloaded`，主按钮） |
| `.hf-status`（卡片 4，状态行） | `{{ updateMessage }}`（检查 / 下载进度，`:class="updateStatusClass"`），文案来自主进程 |
| 详情按钮行（卡片 4） | **按需出现**的 `.hgen-actions`（`style="margin-top:0"`，`v-if="updateDetail \|\| updateLogVisible"`）：`查看详情 / 收起详情` 按钮**仅当 `updateDetail` 非空时渲染**（`v-if="updateDetail"`，文案 `showUpdateDetail ? '收起详情' : '查看详情'`，点击切换 `showUpdateDetail`）；`打开日志目录` 按钮**仅当 `updateLogVisible` 为真时渲染**（`v-if="updateLogVisible"`，→ `onOpenUpdateLog`），而 `const updateLogVisible = computed(() => updateStage.value === 'error' \|\| updateStatusClass.value === 'hf-error')`。之所以不再常驻：**没出错时把用户送进日志目录没有意义**（他看到的是自己读不懂的文件，只会以为哪里坏了），只在更新确实出错（检查 / 下载 / 安装失败）时才露出排障入口。启动静默检查的失败也不会因此看不见——本页 `onMounted` 在订阅 `update:progress` 之后用 `window.updateTools.status()` 补齐一次主进程状态（`stage` 非 `idle` 才套用），把 `error` 阶段连同这个入口一起带出来 |
| 详情块（卡片 4） | `<div v-if="updateDetail && showUpdateDetail" class="hf-detail">{{ updateDetail }}</div>`：等宽字体 + `white-space: pre-wrap` + `user-select: text`，默认折叠（类样式见 `assets/main.css`） |
| 运行环境状态行（卡片 4） | `v-if="runtimeBusy \|\| runtimeFailed"` 的 `.hf-status`（`:class="runtimeStatusClass"`、`{{ runtimeStatusText }}`）：**不再无条件渲染、也不再显示「运行环境已就绪（体积）」**——就绪是常态，不占位；`runtimeStatusText` 只有两支（`runtimeBusy` → 主进程 `message` 或 `正在准备运行环境…`；`runtimeFailed` → 主进程 `message` 或 `运行环境准备失败`），其余为空串；`runtimeStatusClass` 只在 `runtimeFailed` 时给 `hf-error`；`runtimeFailed` 时同排给「重新准备运行环境」按钮（`onPrepareRuntime`，`:disabled="runtimeBusy"`）。数据来自 `useRuntime()` 解构的 `{ runtime, busy, failed, retry }`（`ready` / `sizeText` 已删），口径与外壳 `App.vue` 的 `runtimeVisible = busy \|\| failed` 一致 |
| `.hf-status`（卡片 4，反馈行） | `v-if="updaterStatus"`、`:class="updaterStatusClass"`、`{{ updaterStatus }}`（保存 / 重置 / 打开日志失败的反馈）——**必须与状态行分两行**：共行会被随后的进度文案盖掉，表现为「点了保存没反应」 |
| 跳过版本行（卡片 4） | `available` 态显示「跳过版本 {{ updateNewVersion }}」；`skipped` 态显示「恢复提示版本 {{ updateNewVersion }}」——**用的是目标版本**（`update:progress` 载荷 / 检查回执的 `version`），不是当前版本；两个按钮都走 `onSkipVersion` |
| **自定义更新源弹窗** | 沿用 `.hf-modal-mask` / `.hf-modal` 组件类（同 `HtmlGenPage` 的渲染档位弹窗）；含更新源输入 `v-model="feedDraft"`、启动检查 `v-model="autoCheckDraft"`、说明 `留空即重置为内置地址…须以 / 结尾`；底部 `重置` / `取消` / `保存` 三个按钮 |

卡片 5 说明由父组件提供：模型按「id ↔ 文件名」枚举登记、枚举外文件视为未知模型、模型不随应用打包、下载源为 HuggingFace 国内镜像 hf-mirror.com（规避 GitHub 直链超时）。

### 2.2 状态与类型

**自定义模型（含新增的下拉预设状态）**：

| 名称 | 类型 | 说明 |
|------|------|------|
| `baseUrl` / `modelId` / `apiKey` | `ref('')` | 自定义模型三项文本 |
| `enabled` | `ref(false)` | 是否启用自定义模型生成 / 修改 HTML |
| `status` / `statusClass` | `ref('')` | 卡片 1 状态文案与样式类（`''` / `'hf-ok'` / `'hf-error'`） |
| `CUSTOM_VALUE` | 常量 `'__custom__'` | **哨兵值**：下拉里「自定义…（手动填写）」那一项的 `value`，不属于任何真实地址 / 模型名（见 §5.20） |
| `baseUrlCustom` / `modelCustom` | `ref(false)` | 该行是否处于**手填态**：`false` 渲染 `HfSelect`、`true` 渲染 `<input>` + 「从列表选」。用户点「自定义…」置 `true`，「从列表选」按钮置 `false`；`onMounted` 还会按已保存值是否命中预设初始化（见 2.4） |
| `currentProvider` | `computed<ProviderPreset \| null>` | 当前 `baseUrl` 命中了 `MODEL_PROVIDERS` 里哪家服务商（`p.baseUrls.includes(baseUrl.value)` 全等匹配），没命中为 `null`；模型下拉的候选跟着它联动 |
| `baseUrlGroups` | `computed<HfSelectGroup[]>` | Base URL 下拉的分组选项，见 §2.3 |
| `modelGroups` | `computed<HfSelectGroup[]>` | 模型 ID 下拉的分组选项，见 §2.3 |

**其余状态**：

| 名称 | 类型 | 说明 |
|------|------|------|
| `voiceProviders` | `ref<VoiceProviderView[]>([])` | **厂家目录**（来自 `voice:list-models`）：`key` / `label` / `apiKeyHint` / `defaultModel` / `models` / `voices` |
| `vProvider` | `ref('')` | 当前编辑的厂家 key（厂家下拉的值） |
| `vApiKey` | `ref('')` | 当前厂家的 API Key（**切厂家会回填**）；`vModel` 已随「厂家默认模型」行一起删除 |
| `vSaved` | `ref<Record<string, { apiKey: string }>>({})` | 各厂家**已保存**的配置（来自 `voice:get-config` 的 `providers`），`syncVoiceForm()` 的回填源（**只有 `apiKey`**） |
| `currentVendor` | `computed<VoiceProviderView \| null>` | 当前厂家在目录里的记录（找不到就退到第一个厂家） |
| `vendorGroups` / `vendorKeyHint` / `vendorSystemModel` | `computed` | 厂家下拉分组（单组、`value` = `p.key`）/ Key 占位提示（`apiKeyHint`）/ **该厂家系统音色固定使用的模型**（`currentVendor.defaultModel`，仅用于说明文案） |
| `voiceModels` | `ref<VoiceModelView[]>([])` | 候选项，元素 `{ id, label, isDefault? }` |
| `vStatus` / `vStatusClass` | `ref('')` | 卡片 2 状态文案与样式类 |
| `qualityOptions` / `fpsOptions` | 常量 | 直接引用 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` |
| `rQuality` / `rFps` | `ref<RenderQuality>` / `ref<RenderFps>` | 卡片 3 的全局默认档位，初值取 `FALLBACK_RENDER`（`standard` / `30`） |
| `rStatus` / `rStatusClass` | `ref('')` | 卡片 3 状态文案与样式类 |
| `qualityHint` | `computed<string>` | 当前所选质量档位的 `hint`（找不到时为空串） |
| `updateVersion` | `ref('')` | **当前版本号，只用于显示**：模板 `{{ updateVersion \|\| '—' }}`、`onMounted` 用同步的 `window.updateTools.version()` 首屏填充，后续由 `update:progress` 的 `currentVersion`（与 `onCheckUpdate` 回执的 `currentVersion`）刷新 |
| `updateNewVersion` | `ref('')` | **待安装的目标版本**（`UpdateProgressPayload.version` 就是目标版本），专供「跳过版本 / 恢复提示版本」：按钮标签渲染它，`onSkipVersion()` 写 `skippedVersion` 也用它。**必须与 `updateVersion` 分开**——主进程是拿 available 的目标版本与 `settings.json` 的 `skippedVersion` 比较（`updater.ts` 的 `update-available` 分支），写当前版本永远不命中，「跳过」等于没生效（见 §5.26） |
| `updateStage` | `ref<UpdateStage>('idle')` | 应用更新阶段；`idle` 表示本进程尚未检查过 |
| `updateMessage` / `updateStatusClass` | `ref('')` | 卡片 4 状态行的文案与样式类（`error` → `hf-error`，`downloaded` / `available` → `hf-ok`）；文案一律取主进程的 `message`，本页不拼串 |
| `updateDetail` / `showUpdateDetail` | `ref('')` / `ref(false)` | 排障详情（HTTP 状态 / AccessDenied 原文 / 请求地址等）与其折叠开关；`updateDetail` 为空时详情块与「查看详情」按钮都不渲染，`showUpdateDetail` 自动复位为 `false` |
| `updateBusy` | `computed<boolean>` | `updateStage` 为 `checking` / `downloading` 时禁用「检查更新」按钮 |
| `feedUrl` / `autoCheck` | `ref('')` / `ref(true)` | **已保存**的更新源覆盖地址与启动静默检查开关（回填自 `settings.updater`） |
| `updaterStatus` / `updaterStatusClass` | `ref('')` | 保存 / 重置 / 打开日志的反馈文案与样式类（独立于 `updateMessage` 那行，避免互相覆盖） |
| `feedDialogVisible` | `ref(false)` | 自定义更新源弹窗可见性 |
| `feedDraft` / `autoCheckDraft` | `ref('')` / `ref(true)` | 弹窗内**编辑中的副本**：只有点「保存」才写回 `feedUrl` / `autoCheck` 并落盘，取消不影响已存值 |
| `activeSection` | `ref<SettingsSection>` | 左侧导航当前分类，初值 = `readSection()`；`SettingsSection` 是 `useNavIntent` 的 `SettingsSectionKey` **别名**（`'model' \| 'voice' \| 'render' \| 'update' \| 'whisper'` 五类平级），页面正文一律用这个别名 |
| `SETTINGS_SECTION_KEY` | 常量 `string` | `= STORAGE_KEY_SETTINGS_SECTION`（导入自 `@renderer/constants`，值 `'myapp.settingsSection'`）——页面内只此一处引用该键，避免裸字面量 |
| `SECTIONS` | 常量 `SettingsSection[]` | `= SETTINGS_SECTIONS`（导入自 `@renderer/composables/useNavIntent`，**五个分类枚举的唯一来源**；原来是页面本地的字面量数组，已删）；`readSection()` 与 `applySectionIntent()` 都用它做白名单校验 |
| `readSection()` | `() => SettingsSection` | 读 `localStorage[SETTINGS_SECTION_KEY]`：值必须命中 `SECTIONS` 白名单才采用，否则回退 `'model'`；读失败（隐私模式等）同样回退，整段 `try/catch` 静默 |
| `watch(activeSection, …)` | 侦听器 | 分类变化即写 `localStorage.setItem(SETTINGS_SECTION_KEY, v)`（`try/catch` 静默），实现「下次进设置页回到上次的分类」 |
| `applySectionIntent()` | `() => void` | 消费跨页导航意图：`const want = consumeSettingsSection()`，命中 `SECTIONS` 且与当前 `activeSection` 不同则改写它；`onMounted` 第一句调用（先落实意图、再载入配置） |
| `watch(useSettingsSectionRequest(), …)` | 侦听器 | 兜底：本页**已在挂载状态**（不经 `goPage` 重挂载）时也能响应意图，回调里仍调 `applySectionIntent()`（其内部消费并复位） |

两个页面内联接口：

```ts
interface VoiceModelView { id: string; label: string; isDefault?: boolean }
interface UpdateCheckReply {
  ok: boolean
  state?: 'none' | 'available' | 'skipped'
  version?: string
  currentVersion?: string
  message?: string
  detail?: string
}
```

#### 2.2.1 两个下拉的选项来源

两个 `computed<HfSelectGroup[]>`（`HfSelectGroup` 见 [components.md](./components.md)：`{ label: string; options: { value; label; title?; disabled? }[] }`），数据源是 `@renderer/constants` 的 `MODEL_PROVIDERS`（**导入的第一项，另一个是原有的 `STORAGE_KEY_SETTINGS_SECTION`**）。注意 `HfSelectOption` 的 `disabled` 是**组件本身的能力**（渲染成不可点选的行，见 [components.md](./components.md)），本页这两个下拉现在都不传它——预设表里已经没有灰项了（§5.23）。

**`baseUrlGroups`** —— 先按服务商分组平铺预设：

- 每条 `MODEL_PROVIDERS` 一组（`label` 取 `p.label`），组内每条 `baseUrls` 一个选项（**`baseUrls` 是纯 URL 字符串数组**，见 [constants.ts.md](./constants.ts.md) §3.1）；
- **选项文字就是 URL 本身**：`options: p.baseUrls.map((u) => ({ value: u, label: u }))`——不拼接 `note`、不传 `title`、不传 `disabled`（源码注释：「Base URL 没有需要额外解释的地方，加了反而是噪音」）。预设表里每家的 `baseUrls` 都只有一条，所以每个服务商组下只有一个可选项，**没有需要用户分辨的候选**（早前的 `url + '（' + note + '）'` 拼接与 Anthropic 灰项已删除，见 §5.23）；
- **已保存地址不在预设里时补一组「当前配置」**（单选 `${baseUrl}`，`title` 说明「你当前保存的值」）——自建网关 / 中转站的地址不该在下拉里凭空消失；
- 最后**固定追加**一组空标题的「自定义…（手动填写）」（`value = CUSTOM_VALUE`）。

**`modelGroups`** —— 跟随 `currentProvider`：

- 命中服务商才列该家的 `models`（组标题即该服务商 `label`），`value` 与 `label` 都是模型名本身；
- 已保存模型不属于当前服务商的 `models` 时补一组「当前配置」（含 `currentProvider` 为 `null` 的情况）；
- 最后同样固定追加「自定义…（手动填写）」；
- **没命中服务商时刻意不列任何预设模型**：免得列一堆跟当前端点配不上的名字诱导用户选错——选错就是运行期 `404 model not found`。

### 2.3 函数

| 名称 | 说明 |
|------|------|
| `setStatus` / `setVStatus(text, kind)` | 分别写 `status`/`statusClass`、`vStatus`/`vStatusClass`，文案取 `text \|\| ''` |
| `setRStatus(text, kind)` | 写卡片 3 的 `rStatus` / `rStatusClass`，同样 `text \|\| ''` |
| `onBaseUrlPick(v)` | Base URL 下拉的 `@change` 回调：`v === CUSTOM_VALUE` → **只**把 `baseUrlCustom` 置 `true`（**不动 `baseUrl`**，便于在现有地址上改一改）；否则写入 `baseUrl`、`baseUrlCustom = false`，并在**已填模型不属于新服务商**（`currentProvider` 为空或 `models` 不含它）时把 `modelCustom` 置 `true`——值保留，便于改名而不是从头输 |
| `onModelPick(v)` | 模型下拉的 `@change` 回调：`v === CUSTOM_VALUE` → 只置 `modelCustom = true`；否则写入 `modelId` 并置 `modelCustom = false` |
| `collectCustomModel()` | 返回 `{ baseUrl, modelId, apiKey, enabled }`，三个字符串字段均 `.trim()`，`enabled` 取布尔值 |
| `onSave()` | 校验通过后 `await window.settingsTools.save(customModel)` |
| `onTest()` | `await window.settingsTools.test(collectCustomModel())`；**只加了一段注释、行为零变化**：刻意**不弹配置类弹窗**（按钮与失败状态行都在本页上，弹「去设置」等于让用户从原地跳到原地），主进程照常回 `needConfig` 供别的入口用 |
| `onSaveVoice()` | `window.voiceTools.saveConfig({ provider: vendor.key, config: { apiKey: vApiKey.value.trim() } })`——**只提交 apiKey**（不再有 `defaultModel`）；成功后同步更新本地 `vSaved[vendor.key]` |
| `onSaveRender()` | `await saveRenderDefaults({ quality: rQuality.value, fps: rFps.value })`（`useRenderOptions.ts`，内部走 `settingsTools.saveRender` → `settings:save-render`）；成功提示「渲染默认档位已保存：质量标签 · N fps」`hf-ok`，失败 `res.message \|\| '保存失败'` `hf-error` |
| `applyUpdateProgress(d)` | `update:progress` 的回调：写 `updateStage` / `updateVersion`（取 `d.currentVersion`）/ **`updateNewVersion`（取 `d.version`，目标版本）** / `updateMessage`（`d.message \|\| ''`）/ **`updateDetail`（`d.detail \|\| ''`）** / `updateStatusClass`；`detail` 为空即把 `showUpdateDetail` 复位为 `false`，避免旧报错的面板一直挂着 |
| `setUpdaterStatus(text, kind)` | 写卡片 4 的 `updaterStatus` / `updaterStatusClass`，`text \|\| ''` |
| `onSaveUpdater()` → 已拆为 `onSaveFeed()` / `onResetFeed()` | 见下两行 |
| `openFeedDialog()` / `closeFeedDialog()` | 打开时把已存的 `feedUrl` / `autoCheck` 拷进 draft；关闭只清 `feedDialogVisible`（不落盘） |
| `onSaveFeed()` | 把 draft 写入 `saveUpdater({ feedUrl, autoCheck })` → `settings:save-updater`；成功后回写 `feedUrl` / `autoCheck`（并优先采用返回值里规范化过的 `settings.updater.feedUrl`），提示「更新源已保存」并关闭弹窗；异常被 `try/catch` 兜住并写 `hf-error` |
| `onResetFeed()` | `saveUpdater({ feedUrl: '', skippedVersion: '' })`：**清空更新源回到内置地址，同时清掉「跳过版本」**，让所有版本重新可提示；成功后 draft 同步清空 |
| `onFeedDialogKey(e)` | 弹窗 ESC 关闭；在 `onMounted` 注册、`onBeforeUnmount` 注销（成对，项目既有惯例） |
| `onCheckUpdate()` | 先把状态行置「正在检查更新…」并清空 `updateDetail` / 收起详情，再 `await window.updateTools.check()`；成功后**只回填主进程给的文案**（`updateMessage = res.message \|\| '检查完成'`、`updateDetail = res.detail \|\| ''`、`updateStage = res.state`）并回填两个版本号：`updateVersion = res.currentVersion`、**`updateNewVersion = res.version \|\| updateNewVersion.value`**（事件可能早于本次 invoke 返回，这里保证「跳过版本」标签不为空）；失败分支同样读 `res.message` / `res.detail` |
| `onOpenUpdateLog()` | `await window.updateTools.openLog()`：在文件管理器里定位 `userData/updater.log`（没有日志则打开 `userData` 目录）；失败时把消息写到**另一行** `updaterStatus`（`hf-error`），异常同样兜住 |
| `onDownloadUpdate()` / `onCancelUpdate()` | `window.updateTools.download()` / `cancel()`；失败时 message + detail 双写（取消下载现在也读返回值：`updateMessage = res.message \|\| '取消下载失败，请重试'`、`updateDetail = res.detail \|\| ''`、`hf-error`） |
| `onInstallUpdate()` | `window.updateTools.install()`；成功时主进程即将退出安装，**只在 `ok: false` 或返回了 `message` 时**写提示（如「当前有任务正在进行」）；失败同样 message + detail 双写 |
| `handleUpdateError(what, e)` | **所有更新动作的统一异常兜底**。`updateTools.*` / `settingsTools.saveUpdater` 都是 `ipcRenderer.invoke`：主进程 handler 抛错或频道未注册时 Promise 会 **reject**，不用 `try/catch` 包住就既不改状态也不提示——界面表现为「点了没反应」（历史上 `electron-updater` 加载失败时正是如此）。现在它把**人话进 `updateMessage`、原始异常一律进 `updateDetail`**：`what === '安装'` → 「启动安装程序失败，请重新下载安装包后手动安装」；其他 → `what + '失败，请稍后重试'`，并置 `hf-error`；`onCheckUpdate` / `onDownloadUpdate` / `onCancelUpdate` / `onInstallUpdate` / `onSkipVersion` / `onSaveFeed` / `onResetFeed` 全部已包 `try/catch` |
| `onSkipVersion(skip)` | `saveUpdater({ skippedVersion: skip ? updateNewVersion.value : '' })`——**写入的是目标版本**（不是 `updateVersion`），用于「跳过版本」与「恢复提示版本」两个按钮；成功时清空 `updateDetail`（并写「已跳过版本 x」/「已恢复提示版本 x」，x 同样取 `updateNewVersion.value`）；失败取 `res.message \|\| '操作失败'` 并置 `hf-error` |
| `onMounted(async cb)` | 第一句 `applySectionIntent()`（先落实带意图跳进来的分类），其后是配置回填（见 2.4） |

### 2.4 关键流程

**挂载回填**：`onMounted` 的第一句是 `applySectionIntent()`——消费别的页面留下的「落到某分类」意图（`consumeSettingsSection()`；命中 `SECTIONS` 且与当前不同才写 `activeSection`），**优先级高于 localStorage 里的上次分类**（用户这次点的是「去配语音」，不是「回到上次看的那一页」）。⓪ 同步执行 `const activeSection = ref(readSection())`——从 `localStorage[SETTINGS_SECTION_KEY]`（`@renderer/constants` 的 `STORAGE_KEY_SETTINGS_SECTION`）恢复上次停留的分类，值不在 `SECTIONS` 白名单内则回退 `'model'`；随后 `watch(activeSection)` 在每次切换分类时写回该键。① `settingsTools.get()` → `s.customModel || {}` 回填 `baseUrl`/`modelId`/`apiKey`/`enabled = !!m.enabled`，异常写 `setStatus('读取配置失败：' + message, 'hf-error')`；紧接着**按已保存值初始化两个手填态**：`baseUrlCustom = !!baseUrl && 该地址不在任何预设的 baseUrls 里`、`modelCustom = !!modelId && 该模型不属于 currentProvider`（顺序在赋值之后，故 `currentProvider` 已按新 `baseUrl` 求值）——不这么做下拉会显示空占位，用户看到的是「我配的地址 / 模型没了」。② `await window.voiceTools.listModels().catch(() => ({ ok: false, models: [], providers: [] }))`，取 `mm.providers || []` 写入 `voiceProviders`（**厂家目录**，失败即空数组、不抛错）；③ 再取 `settingsTools.get()` 的 `s.voice` → `vSaved = voice.providers || {}`、`vProvider = String(voice.active || '') || 第一个厂家的 key`，随后 `syncVoiceForm()` 按该厂家回填表单（异常写 `setVStatus('读取语音服务配置失败', 'hf-error')`）。② 必须先于 ③ 的表单回填，否则 `currentVendor` 为空、模型选项与 Key 占位提示都拿不到；④ 第三次 `settingsTools.get()` → `const r = (s && s.render) || FALLBACK_RENDER`，仅当值在 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` 白名单内才写入 `rQuality` / `rFps`（异常静默忽略，读取失败沿用内置默认 `standard` / `30`）。

**选 Base URL / 模型**：两行的下拉都绑定 `@change`（不是 `v-model`）。选「自定义…」时只切到手填态、**不写值**；选具体项时写值并切回下拉态；Base URL 一改，若已填模型不属于新服务商则模型行自动切手填（值保留）。`HfSelect` 只在**用户点选且值确实变化**时 emit `change`（程序化改值不发），并会把 `disabled` 选项渲染成不可点选的行。

**保存自定义模型**：`collectCustomModel()` 后若 `baseUrl`/`modelId`/`apiKey` 任一为空 → `setStatus('配置不完整：Base URL / Model ID / API Key 均需填写', 'hf-error')` 并中止（不发任何 IPC）；否则成功提示「配置已保存，可开始使用自定义模型生成 HTML」`hf-ok`，失败显示 `res.message || '保存失败'` `hf-error`。

**测试连接**：先置「正在测试连接...」（样式类清空，保持中性），用**当前表单内容**（不要求已保存）调 `settingsTools.test`，成功 `res.message || '连接成功'`、失败 `res.message || '测试失败'`。主进程失败体现在还会带 `detail`（排障原文）与可能的 `needConfig`（配置类分类），**本页刻意不使用它们**——源码注释写明：按钮与失败文案都在设置页上，再弹一个「去设置」框是让用户原地跳；`needConfig` 只供别的入口判断。

**保存语音服务（按厂家）**：无前置校验，直接把「当前厂家 + 该厂家 API Key / 默认模型」提交给 `voice:save-config`（`{ provider, config }`）；成功提示「配置已保存…」`hf-ok`，失败 `res.message || '保存失败'` `hf-error`。**逐个音色换模型不在这里**——那是配音页「音色映射管理」的事，本页只配「该厂家的兜底默认模型」。

**保存渲染默认档位**（`onSaveRender`）：无前置校验（下拉值必然合法），经 `saveRenderDefaults({ quality, fps })` 提交；该函数内部调 `window.settingsTools.saveRender(next)`（`settings:save-render`），成功后用返回的 `res.settings.render` 就地刷新模块级单例 `renderDefaults`——因此保存后无需重启或刷新页面，「HTML生成」页的 `optionNote`（「跟随设置页默认：…」）立刻反映新值。失败时取 `res.message || '保存失败'`。

**应用更新（文案单点产出 + 详情折叠）**：卡片 4 的状态**全部由主进程 `update:progress` 推送驱动**，页面本身不做轮询，也**不再自己拼文案**。挂载时 `window.updateTools.onProgress(applyUpdateProgress)` 订阅（preload 为单订阅，反复进出本页只替换回调），**随后再用 `window.updateTools.status()` 补齐一次主进程状态**（`try` 包住、失败静默保持 `idle`；只在 `st.stage` 存在且不为 `idle` 时套用）——这条补齐是必需的：主进程的启动静默检查（3 秒）早于本页订阅，不补这一次，那次失败就只剩「尚未检查更新」，连带它的「查看详情 / 打开日志目录」一起看不到；补齐之后若 `updateMessage` 仍为空，才按状态兜底成「尚未检查更新」或「上次检查更新失败」。`updateVersion`（**当前版本**）先用同步的 `window.updateTools.version()` 首屏填充；`updateNewVersion`（**目标版本**）由 `update:progress` 的 `d.version` 与检查回执的 `res.version` 写入，「跳过版本 / 恢复提示版本」两个按钮用的就是它；随后第四次 `settingsTools.get()` → `s.updater || {}` 回填 `feedUrl` / `autoCheck`（`autoCheck !== false` 即视为开启，与主进程默认值一致）。所有触发动作都只是 `invoke` 一发，结果与进度都从同一路推送回来。

> **为什么渲染层不再拼串**：`available` / `skipped` / `none` / `error` 的句子统一由主进程 `updater.ts` 产出（单点产出），渲染层只渲染 `message`、把 `detail` 收进「查看详情」。早前渲染层也自己拼一套（如「发现新版本 X，点『下载更新』获取安装包」），与事件推送的文案**两处各写一套、互相覆盖**，同一状态会出现两句话打架。

**更新源编辑（弹窗）**：更新源不在卡片上直接编辑，而是「自定义更新源」按钮打开弹窗。打开时 `openFeedDialog()` 把已存值拷进 `feedDraft` / `autoCheckDraft`；**编辑期间不动已存值**，点「保存」才经 `settings:save-updater` 落盘并关闭，点「取消」或 ESC 直接丢弃。「重置」把 `feedUrl` 与 `skippedVersion` 一起清空（回到打包内置地址、并恢复所有版本的提示）。保存 / 重置 / 打开日志的反馈写在**卡片最后一行 `.hf-status`**（`updaterStatus`），与检查更新的进度文案（`updateMessage`）分属两行 —— 早前把两者放在同一行时，保存后紧接着到达的进度推送会把提示覆盖掉，表现为「点了保存没反应」。

## 3. SettingsPage/WhisperSection.vue

### 3.1 模板结构

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
| `.hgen-form` | `v-show="formVisible"`：`formName`、`formFile`（`:disabled="editId !== ''"`，编辑时不可改）、`formUrl`、`formSize`、`formDesc` + 「保存」`onSaveForm` /「取消」`onCancelForm` + `formStatus`/`formStatusClass` |
| `.hgen-tip` / `.hf-status` | `{{ storeTip }}`（存储位置与已用空间）；`:class="statusClass"`、`{{ status }}` 区块级反馈 |

### 3.2 类型与状态

`WhisperModelView`：`id`、`label`、`sizeMB`、`speed`、`desc`、`file`、`custom`、`localFile`、`url`、`downloaded`、`localBytes`、`isCurrent`；`WhisperStatusView`：`cli: { exists, path }`、`modelsDir`、`models[]`、`unknownFiles[]`、`usedBytes`。

ref：`wmState`（`status()` 快照）、`wmBusy`（正在下载的模型 id，非空即禁用全部下载按钮并拒绝新任务）、`status`/`statusClass`、`barVisible`/`barPercent`/`barText`/`barState`、`formVisible`、`editId`（非空为编辑模式）、`formName`/`formFile`/`formUrl`/`formSize`/`formDesc`/`formStatus`/`formStatusClass`。

computed：`models`（`wmState.models || []`）、`storeTip`（「存储位置：modelsDir　已用空间：fmtBytes(usedBytes)」）、`unknownTip`（`unknownFiles` 非空时「发现 N 个未登记的模型文件（不在枚举内，暂时无法用于转录）：a、b。可点上方「添加自定义模型」按文件名登记后启用。」，用 `、` 拼接）、`cliTip`（就绪「whisper-cli.exe：已就绪（cli.path）」；缺失引导从 whisper.cpp 官方 Releases 取 windows-x64 包的 `whisper-cli.exe` 放到 `cli.path || 'resources/whisper/whisper-cli.exe'`）、`cliTipColor`（缺失时 `'rgba(255, 176, 32, 0.9)'` 警告橙，否则空串）。

### 3.3 函数

| 名称 | 说明 |
|------|------|
| `fmtBytes(n)` | ≥1073741824 → `x.xx GB`；≥1048576 → `x.x MB`；≥1024 → `x.x KB`；否则 `x B`；`Number(n) \|\| 0` 兜底 |
| `setStatus` / `showBar(percent, text, state)` | 写状态；`showBar` 显示进度条并把 `barPercent` 钳制到 0~100 |
| `refreshWm()` | `await window.whisperTools.status().catch(() => null)`；无结果或 `!s.ok` → 「读取识别模型状态失败，请重试」`hf-error`；否则写入 `wmState` |
| `actDownload(m)` | 见 3.4 |
| `actDelete(m)` | `whisperTools.delete(m.id)`；成功「已删除模型「id」（如需再用可重新下载）」`hf-ok`，失败 `message \|\| '删除失败'`；随后 `refreshWm()` |
| `actCurrent(m)` | `whisperTools.setCurrent(m.id)`；成功「已将「id」设为字幕转录使用的模型」；随后 `refreshWm()` |
| `actRemove(m)` | `whisperTools.removeModel({ id: m.id })`；优先 `res.message`，否则按 `ok` 给「已移除」/「移除失败」；随后 `refreshWm()` |
| `openForm(model)` | 填充表单（`formSize` 取 `sizeMB ? String(sizeMB) : ''`）并展开；引导语：编辑「正在编辑「label」：文件名不可改，其余可改」/ 新增「填写后点「保存」登记；登记成功后即可像内置模型一样下载与使用」，`formStatusClass=''` |
| `onToggleForm` / `onCancelForm` | 展开态则收起并清 `editId`，否则 `openForm(null)`；取消同样收起并清 `editId`、`formStatus`、`formStatusClass` |
| `onSaveForm()` | 见 3.5 |
| `onRefresh()` | 清空区块状态后 `refreshWm()` |
| `onOpenModels()` | `await window.whisperTools.openDir('models')`；失败 `message \|\| '打开目录失败'` `hf-error` |
| `onMounted()` | 注册 `whisperTools.onProgress` → `setStatus('', '')` → `refreshWm()` |

### 3.4 下载与进度

`actDownload`：`wmBusy` 非空 → 「已有下载任务进行中，请稍候」`hf-error` 返回；否则置 `wmBusy = m.id`、「开始下载「id」…模型体积较大，请保持网络畅通」、`showBar(0, '正在连接下载源（hf-mirror.com）…', '')`；`await whisperTools.download(m.id)` 失败 → `showBar(100, message || '下载失败', 'error')` + `hf-error`，成功且带 `message`（如「本地已有模型文件 …，无需重复下载」）→ `hf-ok`；最后 `wmBusy=''`、`refreshWm()`。

`onProgress` 回调参数 `p: WhisperProgressPayload`（类型来自 `src/shared/types.ts` ⑧ 节，由 `PreloadApi['whisperTools']` 自动推断，不再是渲染层手写的 `Record<string, unknown>`；取值处保留了 `as string` / `as number` 断言），按 `p.stage` 分支（`p` 为空则忽略）；主进程回推字段 `id`、`stage`、`percent`、`receivedBytes`、`totalBytes`、`message`：

| `stage` | 行为 |
|---------|------|
| `'downloading'` | `wmBusy = (p.id as string) \|\| wmBusy`；`p.totalBytes` 为真时拼「（fmtBytes(p.receivedBytes as number) / fmtBytes(p.totalBytes as number)）」；`showBar((p.percent as number) \|\| 0, ((p.message as string) \|\| '下载中') + sizeTxt, '')` |
| `'done'` | `showBar(100, (p.message as string) \|\| '下载完成', 'done')`；`setStatus('模型下载完成，点「设为当前使用」即可用于字幕转录', 'hf-ok')`；`wmBusy=''`；`refreshWm()` |
| `'error'` | `showBar(100, (p.message as string) \|\| '下载失败', 'error')`；`setStatus((p.message as string) \|\| '下载失败', 'hf-error')`；`wmBusy=''`；`refreshWm()` |
| 其它（如 `loading` / `transcribing`） | 静默忽略（预期行为，转录阶段不在本区块显示） |

### 3.5 保存自定义模型表单

组装 `payload = { name, file, url, sizeMB, desc }`（全部 `.trim()`）→ `!name` → `formStatus='请填写模型名称'` `hf-error` 返回；非编辑模式且 `!file` → `'请填写模型文件名（ggml- 开头的 .bin 文件）'` `hf-error` 返回；提交时 `editId` 非空走 `updateModel(Object.assign({ id: editId.value }, payload))`，否则 `addModel(payload)`。成功：`formStatus = message || '已保存'` `hf-ok`，收起表单并清 `editId`，同一文案写入区块级 `status`，再 `refreshWm()`；失败：`formStatus = message || '保存失败'` `hf-error`，表单保持展开便于修改重试。

### 3.6 `status()` 返回字段用法

| 字段 | 用法 |
|------|------|
| `ok` | `refreshWm` 判失败 |
| `cli.exists` / `cli.path` | `cliTip` 文案与 `cliTipColor` 警告橙；缺失时 `cli.path` 作为应放置位置提示（兜底 `'resources/whisper/whisper-cli.exe'`） |
| `modelsDir` | `storeTip` 存储位置；`unknownTip` 中的用户指引 |
| `models[]` | 卡片网格数据源，逐项用 `id`、`label`、`file`、`sizeMB`、`speed`、`desc`、`url`、`custom`、`downloaded`、`localBytes`、`isCurrent` |
| `unknownFiles[]` | `unknownTip` 统计数量并列举文件名 |
| `usedBytes` | `storeTip` 经 `fmtBytes` 显示 |
| `langs`、`currentModelId` | 主进程同样返回，但 `WhisperStatusView` 未声明、界面未使用（`refreshWm` 用 `s as unknown as WhisperStatusView` 断言赋值） |

## 4. 依赖与协作

### 4.1 import

| 来源 | 名称 | 用途 |
|------|------|------|
| `vue`（页面） | `computed`、`onBeforeUnmount`、`onMounted`、`ref`、`watch` | 响应式、派生的档位说明 / 下拉选项与挂载回填（`onBeforeUnmount` 用于注销 ESC 监听） |
| `@shared/types`（页面） | `type RenderFps`、`type RenderQuality`、`type UpdateProgressPayload`、`type UpdateStage` | 卡片 3 两个下拉的类型标注（`rQuality` / `rFps`）；卡片 4 的进度回调与阶段标注 |
| `@renderer/constants`（页面） | `MODEL_PROVIDERS`、`STORAGE_KEY_SETTINGS_SECTION`（**按此顺序导入**） | 前者是 Base URL / 模型 ID 两个下拉的预设数据源（`ProviderPreset[]`）；后者是左侧分类导航的记忆键名（赋给页面内 `SETTINGS_SECTION_KEY` 后读写 `localStorage`），值 `'myapp.settingsSection'` |
| `@renderer/utils/render`（页面） | `FALLBACK_RENDER`、`RENDER_FPS_OPTIONS`、`RENDER_QUALITY_OPTIONS`、`renderQualityLabel` | 档位选项表、内置默认档位与保存成功文案里的质量标签 |
| `@renderer/composables/useRenderOptions`（页面） | `saveRenderDefaults` | 保存全局默认档位（内部刷新 `renderDefaults` 单例） |
| `@renderer/composables/useRuntime`（页面） | `useRuntime` | 卡片 4 的运行环境状态行与「重新准备运行环境」 |
| `@renderer/composables/useNavIntent`（页面） | `consumeSettingsSection`、`useSettingsSectionRequest`、`SETTINGS_SECTIONS`、`type SettingsSectionKey` | 分类枚举的唯一来源 + 跨页导航意图的消费（`applySectionIntent()` 与兜底 `watch`）；`type SettingsSection = SettingsSectionKey` 是页面内的别名 |
| `@renderer/components/HfSelect.vue`（页面） | `HfSelect`（默认）、`type HfSelectGroup` | 五处下拉（Base URL / 模型 ID / 目标模型 / 质量 / 帧率）自绘控件与选项分组类型 |
| `./WhisperSection.vue`（页面） | `WhisperSection` | 语音识别模型区块子组件 |
| `vue`（子组件） | `computed`、`onMounted`、`ref` | 派生文案、进度订阅与状态 |
| `@renderer/utils/escape`（子组件） | `escTxt` | 模型文本（名称、文件名、说明、URL、`localFile`）的 HTML 转义 |

页面**未**引入 `useToast`、`escTxt`，提示全部走 `status` / `vStatus` / `rStatus` / `updateMessage` / `updaterStatus` 几条状态行；子组件不 import 任何组件或 composable，也不接收 / 抛出事件。`sizeMB`、`speed`、`localBytes`、`barPercent`、`barText` 未转义（由本组件生成或来自主进程数值）。

### 4.2 preload 方法汇总

| preload 调用 | IPC 频道 | 说明 |
|--------------|----------|------|
| `window.settingsTools.get()` | `settings:get` | 读取 `AppSettings`（页面四次调用：`customModel`、`voice`、`render`、`updater`） |
| `window.settingsTools.save(customModel)` | `settings:save` | preload 包装为 `{ customModel }` |
| `window.settingsTools.test(customModel)` | `settings:test` | preload 包装为 `{ customModel }`，用当前表单内容测试 |
| `window.settingsTools.saveRender(render)` | `settings:save-render` | preload 包装为 `{ render }`；经 `saveRenderDefaults` 调用，只更新 `render` 段 |
| `window.settingsTools.saveUpdater(updater)` | `settings:save-updater` | preload 包装为 `{ updater }`；只更新 `updater` 段（`feedUrl` / `autoCheck` / `skippedVersion`） |
| `window.updateTools.version()` | `update:version` | **同步**返回当前版本号字符串（`sendSync`），首屏显示用 |
| `window.updateTools.check()` | `update:check` | 检查更新，返回 `{ ok, state, version, currentVersion, message, detail? }`（失败分支 `{ ok: false, message, detail? }`） |
| `window.updateTools.download()` | `update:download` | 下载安装包；失败分支带 `message` + `detail` |
| `window.updateTools.cancel()` | `update:cancel` | 取消下载；异常时回 `取消下载失败，请重试` + `detail` |
| `window.updateTools.install()` | `update:install` | 退出并运行安装器；本机有任务在跑时返回 `ok: false` + 提示 |
| `window.updateTools.status()` | `update:status` | 取一次主进程当前更新状态（`Promise<UpdateProgressPayload>`）：主进程 `state` 常驻，用于 `onMounted` 补齐「启动静默检查」那次失败（该事件早于本页订阅 `update:progress`） |
| `window.updateTools.openLog()` | `update:open-log` | 在文件管理器里定位 `userData/updater.log`（无日志则打开 `userData` 目录）；只在本页判断更新出错（`updateLogVisible`）时才有按钮；失败时消息写在 `updaterStatus` 那行 |
| `window.updateTools.onProgress(cb)` | `update:progress` | 更新状态与下载进度订阅（单订阅），载荷含 `message` / `detail` |
| `window.voiceTools.saveConfig({ provider, config })` | `voice:save-config` | preload **直接透传**该载荷（不再包 `{ voiceTTS }`） |
| `window.voiceTools.listModels()` | `voice:list-models` | 取 `models` + **厂家目录 `providers`**（页面只用 `providers`） |
| `window.voiceTools.listModels()` | `voice:list-models` | 候选模型（`id`、`label`、可选 `isDefault`），异常被 `.catch()` 吞掉 |
| `window.whisperTools.status()` | `whisper:status` | 返回 `{ ok, cli, modelsDir, langs, models, unknownFiles, usedBytes, currentModelId }` |
| `window.whisperTools.download(id)` | `whisper:download` | preload 包装为 `{ id }`；本地已有文件时直接返回提示不重复下载 |
| `window.whisperTools.delete(id)` | `whisper:delete` | preload 包装为 `{ id }`；转录进行中会被主进程拒绝 |
| `window.whisperTools.setCurrent(id)` | `whisper:set-current` | 未下载 / 转录中会被拒绝并回传 `message` |
| `window.whisperTools.addModel(payload)` | `whisper:add-model` | `payload` 为表单对象 |
| `window.whisperTools.updateModel(payload)` | `whisper:update-model` | `payload` 含 `id` 与可改字段 |
| `window.whisperTools.removeModel({ id })` | `whisper:remove-model` | 仅移除登记条目，本地模型文件保留 |
| `window.whisperTools.openDir('models')` | `whisper:open-dir` | 主进程 `which === 'cli'` 时可开 cli 目录，子组件只传 `'models'` |
| `window.whisperTools.onProgress(cb)` | `whisper:progress` | main → renderer 进度推送（单订阅） |

### 4.3 父子协作

`<WhisperSection />` 不接收 props、不监听事件，自身在 `onMounted` 调 `whisperTools.status()` 拉状态并订阅 `whisperTools.onProgress`；卡片 3 的标题与说明文字由父组件定义，区块内部 UI 全部归子组件。

## 5. 注意事项与实现要点

- **语音服务按厂家配置**：`settingsTools.get()` 返回的 `s.voice` 里有 `active` 与 `providers`（各家 **`{ apiKey }`**，已无 `defaultModel`），页面把 `providers` 存进 `vSaved`、把 `active` 写进 `vProvider`，再调 `syncVoiceForm()` 回填表单；`voice:list-models` 另提供**厂家目录**（label / Key 提示 / 出厂默认模型 / 模型表），因此「加一家厂家」只需改主进程的 `voiceCatalog.ts`，本页不用改。保存走 `{ provider, config: { apiKey } }`。
2. 本页**没有**「自定义保存目录」表单项（只有厂家 / API Key），也没有「厂家默认模型」（本轮删除）；保存目录仍**全局一份**、由使用侧经 `voiceTools.getSaveDir`、`voiceTools.pickDir` 处理。
3. **`settingsTools.get()` 调用四次**，各自在独立 `try` 中（分别取 `customModel` / `voice` / `render` / `updater`），失败分别写 `status` / `vStatus`（第三次仅静默回落内置默认、第四次写 `updaterStatus`），互不影响。
4. **「厂家默认模型」已删除**：`syncVoiceForm()` 切厂家时只回填该厂家的 `apiKey`；系统音色用哪个模型由厂家目录固定（`vendorSystemModel` 只用于说明文案），克隆音色的模型在「音色管理 → 音色映射管理」里按音色绑定。
5. **`onSaveVoice` 无前置校验**：空 API Key 也会提交，合法性由主进程判断并回传 `message`；**API Key 落盘位置**界面只说「只保存在本电脑」（不写 `userData/settings.json` 这类内部路径），两个输入框均 `type="password"`，不做额外脱敏。
6. **状态类名沿用全局约定**：`''` / `'hf-ok'` / `'hf-error'`，与 `hf-status` 样式配套，四处状态条（卡片 1、卡片 2、卡片 4 两行、子组件表单）共用。
7. **单订阅进度回调**：preload 用模块级 `_whisperProgressCb` / `_whisperProgressBound` 实现「重复注册仅替换回调」，子组件 `onMounted` 注册即可、无需解绑；离开页面后回调仍指向该闭包，其它页面用同一通道会互相覆盖。
8. **`wmBusy` 与主进程双重防重**：界面 `:disabled="wmBusy !== ''"` 禁用全部下载按钮，`actDownload` 入口再判一次，主进程还有 `downloading` 标志与「已有模型下载任务进行中，请稍候」兜底。
9. **`barPercent` 钳制**：`showBar` 内 `Math.max(0, Math.min(100, Number(percent) || 0))`，异常值不会撑破进度条。
10. **文件名登记后不可改**：编辑模式 `formFile` 输入框 `:disabled="editId !== ''"`，提示「须为 ggml- 开头、.bin 结尾，登记后不可改」；主进程按 `id ↔ 文件名` 严格一一对应，不做前缀或模糊归属。
11. **未知模型文件只能提示**：`unknownFiles` 无法直接使用，需经「添加自定义模型」按文件名登记后才能像内置模型一样下载与使用。
12. **whisper-cli.exe 缺失是硬阻塞**：`cliTip` 以警告橙显示放置路径；缺该文件时转录无法进行（主进程 `whisper:transcribe` 同样校验并返回提示）。
13. **子组件只暴露「打开模型目录」一个入口**：即 `openDir('models')`；`cliTip` 文案提到的「旁的位置」实指 whisper 资源目录，界面无对应按钮（主进程支持 `openDir('cli')`）。
14. **提示优先级与删除语义**：`actRemove` 先取 `res.message`（主进程会说明本地模型文件仍保留），无 message 才按 `ok` 给简短文案；`actDelete` / `actRemove` 均无二次确认弹窗——前者删本地模型文件，后者只删登记条目。
15. **渲染默认档位是「全局默认」而非唯一真源**：真正生效的档位是「项目覆盖（`project.json` 的 `render`）> 此处保存的全局默认 > 内置默认」；本页只写全局默认（`settings:save-render`），项目级覆盖由「HTML生成」页的档位下拉经 `project:set-render` 写入，两处互不覆盖。
16. **渲染默认档位不需要 `onMounted` 之外的状态同步**：`saveRenderDefaults()` 成功后就地刷新 `composables/useRenderOptions.ts` 的模块级 `renderDefaults` 单例，因此本页保存后其他页面（尤其「HTML生成」页的 `optionNote`）立即看到新默认值，无需再次 `get()`。
17. **分类记忆键名走常量、不可跟随品牌改名**：左侧导航的上次分类存在渲染层 `localStorage` 的 `STORAGE_KEY_SETTINGS_SECTION`（`@renderer/constants`，值 `'myapp.settingsSection'`），页面内以 `SETTINGS_SECTION_KEY` 引用。键名前缀 `'myapp.'` 是首次上线时的 npm 包名、**故意不跟随品牌名「影坊 / ShadowMill」**——prod 下页面走 `file://` 同源，键名就是用户数据的地址，改名会让「上次停留的分类」与「上次打开的项目」（`STORAGE_KEY_PROJECT_CTX`）一起读不到。真要改前缀必须补「读旧键 → 写新键」的迁移，不能只改常量。同理，页面上要显示的**品牌文案**不要写死在这里，取 `@shared/constants`。
18. **`activeSection` 的读写都是静默容错**：`readSection()` 与 `watch` 里的 `setItem` 各自包 `try/catch`（源码注释：隐私模式等场景静默忽略），因此「分类记忆失效」永远不会以报错形式出现——排查时先看 `localStorage` 里该键的实际值。
19. **详情区：文案主进程单点产出、渲染层只分两层渲染**：`updateMessage`（人话）来自主进程，`updateDetail`（原始报错 + 请求地址）默认折叠；`applyUpdateProgress()` 在 `detail` 为空时自动把 `showUpdateDetail` 复位，避免旧报错面板常驻。**「打开日志目录」按钮只在更新确实出错时出现**：`updateLogVisible = computed(() => updateStage.value === 'error' || updateStatusClass.value === 'hf-error')` 控制它的 `v-if`（所在动作行 `v-if="updateDetail || updateLogVisible"`）——没出错时把用户送进日志目录没有意义（他看到的是自己读不懂的文件，只会以为哪里坏了），出错时它才是拿到原始报错的唯一出口。**启动静默检查的失败仍然能看见**：本页 `onMounted` 在订阅 `update:progress` 之后用 `window.updateTools.status()` 补齐一次主进程状态（`stage` 非 `idle` 才套用），把 `error` 阶段连同这个入口一起带出来（此前那次失败发生在订阅之前，传不到渲染层，卡片只会显示「尚未检查更新」）。它的失败反馈写在独立一行 `updaterStatus`，不会覆盖检查/下载的状态文案。
20. **两个下拉用 `:model-value` + `@change`，刻意不用 `v-model`**：`CUSTOM_VALUE`（`'__custom__'`）是哨兵值，不是真实地址 / 模型名。用 `v-model` 时 `HfSelect` 会先 emit `update:modelValue`，哨兵值当场写进 `baseUrl` / `modelId`，用户接着点「保存配置」就会把 `'__custom__'` 存进 `settings.json`（下次启动下拉里显示一个假地址）。改成 `@change` + `onBaseUrlPick` / `onModelPick` 后，选「自定义…」只切手填态、**不动当前值**——这也正好符合常见诉求「在现有地址上改一改」。注意 `HfSelect` 只在用户点选**且值确实变化**时 emit `change`（程序化改值不发），所以哨兵分支不会因重复点选而反复触发。
21. **必须保留「自定义」手填**：`MODEL_PROVIDERS` 只是常见取值快捷方式（见 [constants.ts.md](./constants.ts.md) §3.3），自建网关 / 中转站 / 未收录服务商都要能用；而且模型名会被服务商下线、改名，枚举必然过时。因此两行的下拉最后都固定带一项「自定义…（手动填写）」，切到手填态后走原来的 `v-model` 输入框 + `collectCustomModel()` 提交路径，**手填值不受预设表任何约束**（本页也不用预设表做校验）。
22. **「当前配置」兜底项是必需的**：`baseUrlGroups` / `modelGroups` 会把「已保存但不在预设内」的值补成一组「当前配置」。不加这一步，`HfSelect` 找不到匹配选项就退回占位文字（本页未传 `placeholder`，即显示「请选择…」），用户看到的是「我配的地址 / 模型没了」——实际值还在 `settings.json` 里。`onMounted` 里把 `baseUrlCustom` / `modelCustom` 置 `true` 是同一问题的另一半：命中不了预设时直接进手填态，把真实值原样显示出来。
23. **选项文字就是 URL 本身，不拼接任何说明**：`baseUrlGroups` 的选项由 `p.baseUrls.map((u) => ({ value: u, label: u }))` 生成——Base URL 没有需要额外解释的地方，加了反而是噪音（源码注释）。早前选项文案是 `url + '（' + note + '）'`，`note` 只用来标「OpenAI 格式 / Anthropic 格式，当前不支持」，**这一整套已随预设表删掉 `note` 字段而移除**；`/v1` 只是同一格式下的写法差异，所以**每家用一条官方写法就够**（DeepSeek 两种拼法都能用，但只列不带 `/v1` 的那条；百炼的 `/v1` 是它路径的固定组成部分，照原样保留）。「当前配置」兜底项仍带 `title: '你当前保存的值'`，那是**它自己的说明**，与预设表的 `note` 无关。HfSelect 组件支持 `disabled` 选项（不可点选），但**预设里已无 `disabled` 端点**：卡片提示已经写明「只支持 OpenAI 格式的端点，Anthropic 格式暂不支持」，再在下拉里列两个灰项等于同一句话说两遍（与 §5.24 同一条判据）。
24. **界面文案不写「OpenAI 兼容模式」这类术语**（2026-10 起）：它原本想告诉用户"这个端点是 OpenAI 接口规范的、本应用能用"，但对用户是纯噪音——用户选的是**哪家服务商**，不是"某个协议"；能不能用已经由**选项列表本身**表达（列出来的都是能用的，不支持的端点不列，见 §5.23）；而且 `/compatible-mode/` 就写在 URL 里，说一遍等于重复。所以服务商组标题只说名字（`阿里云百炼`，不带括号补充），选项文字就是裸 URL。**判断标准**：这句话删掉会不会让用户少知道一件"他需要据此做决定"的事？不会就删。
25. **跨页「带意图跳转」在本页落地**：配音页「音色管理」弹窗里的「API Key 设置」（以及它未配 Key 时的自动跳转）会先 `requestSettingsSection('voice')` 再 `goPage('settings')`；本页 `onMounted` 第一句 `applySectionIntent()` 消费它（`watch(useSettingsSectionRequest())` 作兜底），因此进设置页直接落在「语音服务」。分类枚举只在 `@renderer/composables/useNavIntent` 定义一处（`SETTINGS_SECTIONS`），本页不再有本地字面量数组——新增分类必须同时改 `useNavIntent.ts` 与这里引用的 `SECTIONS` 消费者。详见 [common.md](../common.md) §10。

## 6. 运行环境（分包）一行（`useRuntime`）

运行环境改成「`ffmpeg` / `hyperframes` 各成一个 7z（**实测 42.6 MB + 103.1 MB = 145.7 MB**，2026-10-14）、首次用到时由用户确认后下载并解到 `<userData>/runtime/<包名>/`，`whisper` 随安装包」之后，卡片 4 的这一行是**三态**（分包方案见 `docs/runtime-pack-split.md`）：

- **显隐**：`v-if="runtimeBusy || runtimeFailed || runtimeHasMissing"`（就绪是常态，不再占位、也不再显示「运行环境已就绪（体积）」）；
- **文案**：`runtimeStatusText` —— busy → `runtime.message || '正在准备运行环境…'`；failed → `runtime.message || '运行环境准备失败'`；hasMissing → `'运行环境需要下载：' + runtimeMissingText`。`runtimeStatusClass` 只在 `runtimeFailed` 时给 `hf-error`；
- **按钮**：「下载运行环境 / 重试」（`onPrepareRuntime()`，`:disabled="runtimeBusy"`）、`runtimeCancellable` 时「取消下载」（`cancelRuntime`）、`runtimeMissing.length` 时**「从本地文件安装…」**（`onPickLocalPack()`，按 `docs/runtime-pack-split.md` §11.1：这个入口只在缺包 / 失败时出现）；
- **`onPickLocalPack()`**：调 `window.settingsTools.pickRuntimePack()`（频道 `settings:pick-runtime-pack`，弹文件框选 `ffmpeg.7z` / `hyperframes.7z`）；取消或失败写 `runtimeNotice`，成功后写「已导入本地运行环境包，正在解包…」并 `await prepareRuntime()` 触发解包；
- **`runtimeNotice`**：这一行下方的反馈文本（`v-if`），与卡片自身的 `status` / `updaterStatus` 相互独立；
- **数据来源**：`useRuntime()` 解构出的 `{ runtime, busy, failed, hasMissing, cancelable, missing, missingText, prepare, cancel }`（旧的 `retry` / `sizeText` 已删，见 [common.md](../common.md) §4.1）。
26. **「跳过版本」必须写目标版本（`updateNewVersion`），不能写当前版本（`updateVersion`）**（2026-10 修复）：主进程在 `updater.ts` 的 `update-available` 分支里是拿 **available 的那个版本号**与 `settings.json` 的 `skippedVersion` 比较，而本页原先两个按钮的标签与 `onSkipVersion()` 读写都用了 `updateVersion`（当前版本）——写进去的当前版本**永远不命中**，「跳过该版本」等于没生效；按钮标签还把「新版本」显示成了「当前版本」。现在新增 `const updateNewVersion = ref('')`（源码注释写明它专供跳过逻辑），四处使用：`applyUpdateProgress()`（`updateNewVersion.value = d.version || ''`，`UpdateProgressPayload.version` 即目标版本；`currentVersion` 仍写 `updateVersion`）、`onCheckUpdate()` 成功分支（`res.version || updateNewVersion.value`）、模板两个按钮的标签、`onSkipVersion()` 的写入值与两条提示文案。`updateVersion` 收窄为**只做「当前版本」显示**（模板 `{{ updateVersion || '—' }}`、`applyUpdateProgress()` 的 `currentVersion`、`onCheckUpdate()` 的 `currentVersion`、`onMounted` 的 `window.updateTools.version()`）。
