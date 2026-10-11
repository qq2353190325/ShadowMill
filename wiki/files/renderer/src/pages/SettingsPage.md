# src/renderer/src/pages/SettingsPage/（页面）

> 设置页：自定义模型、千问语音、视频渲染默认档位与应用更新，并挂载语音识别模型区块。

- **覆盖文件**：

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/renderer/src/pages/SettingsPage/index.vue` | 354 | 页面主体：自定义模型卡片、千问语音卡片、视频渲染默认档位卡片、应用更新卡片，末张卡片挂载子组件 |
| `src/renderer/src/pages/SettingsPage/WhisperSection.vue` | 274 | 页面子组件：语音识别模型区块（原 `pages/settings/whisper.js` 的 `window.__settings.initWhisper`） |

- **类型**：页面 + 页面子组件（均为 SFC，`<script setup lang="ts">`）
- **对外导出**：两者均为默认导出组件，**无 props、无 emit**（`<WhisperSection />` 不传 props、不监听事件，状态全部内部维护）
- **持久化**：配置写入本机 `userData/settings.json`，表单式「读 → 改 → 保存」

## 1. 结构总览

根节点下依次五张 `.card.hgen-panel`（后四张 `margin-top:16px`，第 1 张无上边距）：

| 卡片 | 内容 | 归属 |
|------|------|------|
| 1 | 「自定义模型（OpenAI 兼容）」：Base URL / 模型 ID / API Key / 启用 + 保存 / 测试连接 | 父组件 |
| 2 | 「千问语音（音色管理 & 文字生音频）」：API Key + 目标模型下拉 + 保存 | 父组件 |
| 3 | 「视频渲染默认档位」：质量 / 帧率下拉 + 保存渲染默认档位 + 状态条 + 当前质量说明 | 父组件 |
| 4 | 「应用更新」：当前版本 + 更新源输入 + 启动检查开关 + 保存更新设置 / 检查更新 / 下载更新 / 取消下载 / 立即重启安装 + 跳过版本 | 父组件 |
| 5 | 「语音识别模型（whisper.cpp 字幕转录）」：仅标题与 `.hgen-tip` 长说明 | `<WhisperSection />` |

自定义模型开启后「HTML 生成 / 修改」页改用该模型；千问语音配置供「音色管理」「文字生音频」使用；卡片 3 是「HTML生成」页「转视频」的全局默认档位（项目级覆盖优先于它）；卡片 4 是应用自更新的唯一入口（检查 / 下载 / 重启安装，全部状态由 `update:progress` 通道驱动）；卡片 5 供字幕页「从音频生成字幕」本机离线识别（不消耗 API 额度）。

## 2. SettingsPage/index.vue

### 2.1 模板区块

| 区块 | 关键点 |
|------|--------|
| Base URL / 模型 ID 行 | `v-model="baseUrl"`，placeholder「https://api.openai.com/v1（需以 /v1 结尾，按服务商实际提供）」；`v-model="modelId"`，placeholder「如 gpt-4o-mini / deepseek-chat」 |
| API Key 行（卡片 1） | `v-model="apiKey"`、`type="password"`，placeholder「sk-...」 |
| 启用行 | `v-model="enabled"`、`type="checkbox"`，文字「使用自定义模型生成 / 修改 HTML」 |
| `.hgen-actions`（卡片 1） | `保存配置`（主按钮 → `onSave`）、`测试连接`（`onTest`） |
| `.hf-status`（卡片 1） | `:class="statusClass"`，`{{ status }}` |
| API Key 行（卡片 2） | `v-model="vApiKey"`、`type="password"`，placeholder「sk-...（DASHSCOPE_API_KEY）」 |
| 目标模型行 | `v-model="vModel"` 的 `<select>`，`v-for="m in voiceModels"`、`:value="m.id"`、显示 `m.label` |
| `.hgen-actions` / `.hf-status`（卡片 2） | `保存千问语音配置` → `onSaveVoice`；`:class="vStatusClass"`、`{{ vStatus }}` |
| 质量 / 帧率行（卡片 3） | 两个 `select.hgen-select`：`v-model="rQuality"` / `v-model="rFps"`，选项来自 `qualityOptions`（`RENDER_QUALITY_OPTIONS`）与 `fpsOptions`（`RENDER_FPS_OPTIONS`） |
| `.hgen-actions` / `.hf-status`（卡片 3） | `保存渲染默认档位`（主按钮 → `onSaveRender`）；`:class="rStatusClass"`、`{{ rStatus }}`；下方 `.hgen-tip` 显示 `{{ qualityHint }}`（当前所选质量的说明） |
| `.hgen-tip`（卡片 3 顶部） | 原文：「「HTML生成」页点「转视频」时的默认档位，普通使用只需在这两项中选择。单个项目可在「HTML生成」页的「渲染档位」单独覆盖（项目覆盖优先于这里的默认）。质量 draft 编码最快但文字边缘可能有压缩痕迹，仅用于快速确认内容；降低帧率不会缩短成片时长，只是采样更稀、渲染更快。」|
| 更新源 / 启动检查行（卡片 4） | `v-model="feedUrl"`（`.hgen-input`，placeholder「留空 = 使用打包时内置的更新地址；如 http://192.168.1.10:8099/」）+ `v-model="autoCheck"` 复选框「启动后静默检查一次更新」 |
| `.hgen-actions`（卡片 4） | `保存更新设置`（主按钮 → `onSaveUpdater`）、`检查更新`（`:disabled="updateBusy"` → `onCheckUpdate`）、`下载更新`（仅 `updateStage` 为 `available` / `skipped` 时渲染 → `onDownloadUpdate`）、`取消下载`（仅 `downloading`）、`立即重启安装`（仅 `downloaded`，主按钮 → `onInstallUpdate`） |
| `.hf-status`（卡片 4） | `:class="updateStatusClass"`、`{{ updateMessage }}`（文案全部来自主进程 `update:progress` 推送） |
| 跳过版本行（卡片 4） | `available` 态显示「跳过版本 x.y.z」→ `onSkipVersion(true)`；`skipped` 态显示「恢复提示版本 x.y.z」→ `onSkipVersion(false)` |

卡片 5 说明由父组件提供：模型按「id ↔ 文件名」枚举登记、枚举外文件视为未知模型、模型不随应用打包、下载源为 HuggingFace 国内镜像 hf-mirror.com（规避 GitHub 直链超时）。

### 2.2 状态与类型

| 名称 | 类型 | 说明 |
|------|------|------|
| `baseUrl` / `modelId` / `apiKey` | `ref('')` | 自定义模型三项文本 |
| `enabled` | `ref(false)` | 是否启用自定义模型生成 / 修改 HTML |
| `status` / `statusClass` | `ref('')` | 卡片 1 状态文案与样式类（`''` / `'hf-ok'` / `'hf-error'`） |
| `vApiKey` / `vModel` | `ref('')` | 千问语音 API Key、目标模型 id |
| `voiceModels` | `ref<VoiceModelView[]>([])` | 候选项，元素 `{ id, label, isDefault? }` |
| `vStatus` / `vStatusClass` | `ref('')` | 卡片 2 状态文案与样式类 |
| `qualityOptions` / `fpsOptions` | 常量 | 直接引用 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` |
| `rQuality` / `rFps` | `ref<RenderQuality>` / `ref<RenderFps>` | 卡片 3 的全局默认档位，初值取 `FALLBACK_RENDER`（`standard` / `30`） |
| `rStatus` / `rStatusClass` | `ref('')` | 卡片 3 状态文案与样式类 |
| `qualityHint` | `computed<string>` | 当前所选质量档位的 `hint`（找不到时为空串） |
| `updateVersion` | `ref('')` | 当前版本号；`onMounted` 用同步的 `window.updateTools.version()` 首屏填充，后续由 `update:progress` 的 `currentVersion` 刷新 |
| `updateStage` | `ref<UpdateStage>('idle')` | 应用更新阶段；`idle` 表示本进程尚未检查过 |
| `updateMessage` / `updateStatusClass` | `ref('')` | 卡片 4 状态文案与样式类（`error` → `hf-error`，`downloaded` / `available` → `hf-ok`） |
| `updateBusy` | `computed<boolean>` | `updateStage` 为 `checking` / `downloading` 时禁用「检查更新」按钮 |
| `feedUrl` / `autoCheck` | `ref('')` / `ref(true)` | 更新源覆盖地址与启动静默检查开关（回填自 `settings.updater`） |
| `updaterStatus` / `updaterStatusClass` | `ref('')` | 保存更新设置的状态文案与样式类 |

`interface VoiceModelView { id: string; label: string; isDefault?: boolean }`。

### 2.3 函数

| 名称 | 说明 |
|------|------|
| `setStatus` / `setVStatus(text, kind)` | 分别写 `status`/`statusClass`、`vStatus`/`vStatusClass`，文案取 `text \|\| ''` |
| `setRStatus(text, kind)` | 写卡片 3 的 `rStatus` / `rStatusClass`，同样 `text \|\| ''` |
| `collectCustomModel()` | 返回 `{ baseUrl, modelId, apiKey, enabled }`，三个字符串字段均 `.trim()`，`enabled` 取布尔值 |
| `onSave()` | 校验通过后 `await window.settingsTools.save(customModel)` |
| `onTest()` | `await window.settingsTools.test(collectCustomModel())` |
| `onSaveVoice()` | `await window.voiceTools.saveConfig({ apiKey: vApiKey.value.trim(), targetModel: vModel.value })` |
| `onSaveRender()` | `await saveRenderDefaults({ quality: rQuality.value, fps: rFps.value })`（`useRenderOptions.ts`，内部走 `settingsTools.saveRender` → `settings:save-render`）；成功提示「渲染默认档位已保存：质量标签 · N fps」`hf-ok`，失败 `res.message \|\| '保存失败'` `hf-error` |
| `applyUpdateProgress(d)` | `update:progress` 的回调：写 `updateStage` / `updateVersion`（取 `d.currentVersion`）/ `updateMessage` / `updateStatusClass` |
| `setUpdaterStatus(text, kind)` | 写卡片 4 的 `updaterStatus` / `updaterStatusClass`，`text \|\| ''` |
| `onSaveUpdater()` | `await window.settingsTools.saveUpdater({ feedUrl: feedUrl.value.trim(), autoCheck: autoCheck.value })` → `settings:save-updater`；成功「更新设置已保存（下次启动按新设置检查）」 |
| `onCheckUpdate()` | 先置「正在检查更新…」，再 `await window.updateTools.check()`；**用返回值兜底重写一次状态**（主进程事件可能早于 IPC 返回到达），按 `state` 分支写文案 |
| `onDownloadUpdate()` / `onCancelUpdate()` | `window.updateTools.download()` / `cancel()`；下载失败时写 `hf-error` |
| `onInstallUpdate()` | `window.updateTools.install()`；成功时主进程即将退出安装，**只在返回 `ok: false` 时**写提示（如「当前有任务正在进行」） |
| `onSkipVersion(skip)` | `saveUpdater({ skippedVersion: skip ? updateVersion.value : '' })`，用于「跳过版本」与「恢复提示版本」两个按钮 |
| `onMounted(async cb)` | 配置回填（见 2.4） |

### 2.4 关键流程

**挂载回填**：① `settingsTools.get()` → `s.customModel || {}` 回填 `baseUrl`/`modelId`/`apiKey`/`enabled = !!m.enabled`，异常写 `setStatus('读取配置失败：' + message, 'hf-error')`；② `await window.voiceTools.listModels().catch(() => ({ ok: false, models: [] } as any))`，取 `mm.models || []` 写入 `voiceModels`（失败即空数组，不抛错）；③ 再次 `settingsTools.get()` → `s.voiceTTS || {}` 回填 `vApiKey`，`v.targetModel` 存在且候选列表含同 id 时选中它，否则有候选项时优先 `isDefault === true`、再退到 `voiceModels[0]`，异常写 `setVStatus('读取千问语音配置失败', 'hf-error')`。② 必须先于 `vModel` 回填，否则 `some(...)` 失效直接落默认项；④ 第三次 `settingsTools.get()` → `const r = (s && s.render) || FALLBACK_RENDER`，仅当值在 `RENDER_QUALITY_OPTIONS` / `RENDER_FPS_OPTIONS` 白名单内才写入 `rQuality` / `rFps`（异常静默忽略，读取失败沿用内置默认 `standard` / `30`）。

**保存自定义模型**：`collectCustomModel()` 后若 `baseUrl`/`modelId`/`apiKey` 任一为空 → `setStatus('配置不完整：Base URL / Model ID / API Key 均需填写', 'hf-error')` 并中止（不发任何 IPC）；否则成功提示「配置已保存，可开始使用自定义模型生成 HTML」`hf-ok`，失败显示 `res.message || '保存失败'` `hf-error`。

**测试连接**：先置「正在测试连接...」（样式类清空，保持中性），用**当前表单内容**（不要求已保存）调 `settingsTools.test`，成功 `res.message || '连接成功'`、失败 `res.message || '测试失败'`。

**保存千问语音**：无前置校验，直接提交，成功提示「千问语音配置已保存，可在「音色管理」「文字生音频」中使用」`hf-ok`，失败 `res.message || '保存失败'` `hf-error`。

**保存渲染默认档位**（`onSaveRender`）：无前置校验（下拉值必然合法），经 `saveRenderDefaults({ quality, fps })` 提交；该函数内部调 `window.settingsTools.saveRender(next)`（`settings:save-render`），成功后用返回的 `res.settings.render` 就地刷新模块级单例 `renderDefaults`——因此保存后无需重启或刷新页面，「HTML生成」页的 `optionNote`（「跟随设置页默认：…」）立刻反映新值。失败时取 `res.message || '保存失败'`。

**应用更新**（卡片 4）：状态**全部由主进程 `update:progress` 推送驱动**，页面本身不做轮询。挂载时 `window.updateTools.onProgress(applyUpdateProgress)` 订阅（preload 为单订阅，反复进出本页只替换回调）；`updateVersion` 先用同步的 `window.updateTools.version()` 首屏填充；随后第四次 `settingsTools.get()` → `s.updater || {}` 回填 `feedUrl` / `autoCheck`（`autoCheck !== false` 即视为开启，与主进程默认值一致）。因为主进程的启动静默检查在 3 秒后触发，用户若已进入本页就会直接看到状态变化；若在此之前就发生过，页面首次检查时会由 `onCheckUpdate()` 的返回值补齐状态。所有触发动作都只是 `invoke` 一发，结果与进度都从同一路推送回来。

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
| `vue`（页面） | `computed`、`onMounted`、`ref` | 响应式、派生的档位说明与挂载回填 |
| `@shared/types`（页面） | `type RenderFps`、`type RenderQuality`、`type UpdateProgressPayload`、`type UpdateStage` | 卡片 3 两个下拉的类型标注；卡片 4 的进度回调与阶段标注 |
| `@renderer/utils/render`（页面） | `FALLBACK_RENDER`、`RENDER_FPS_OPTIONS`、`RENDER_QUALITY_OPTIONS`、`renderQualityLabel` | 档位选项表、内置默认档位与保存成功文案里的质量标签 |
| `@renderer/composables/useRenderOptions`（页面） | `saveRenderDefaults` | 保存全局默认档位（内部刷新 `renderDefaults` 单例） |
| `./WhisperSection.vue`（页面） | `WhisperSection` | 语音识别模型区块子组件 |
| `vue`（子组件） | `computed`、`onMounted`、`ref` | 派生文案、进度订阅与状态 |
| `@renderer/utils/escape`（子组件） | `escTxt` | 模型文本（名称、文件名、说明、URL、`localFile`）的 HTML 转义 |

页面**未**引入 `useToast`、`escTxt`，提示全部走 `status` / `vStatus` / `rStatus` 三条状态条；子组件不 import 任何组件或 composable，也不接收 / 抛出事件。`sizeMB`、`speed`、`localBytes`、`barPercent`、`barText` 未转义（由本组件生成或来自主进程数值）。

### 4.2 preload 方法汇总

| preload 调用 | IPC 频道 | 说明 |
|--------------|----------|------|
| `window.settingsTools.get()` | `settings:get` | 读取 `AppSettings`（页面四次调用：`customModel`、`voiceTTS`、`render`、`updater`） |
| `window.settingsTools.save(customModel)` | `settings:save` | preload 包装为 `{ customModel }` |
| `window.settingsTools.test(customModel)` | `settings:test` | preload 包装为 `{ customModel }`，用当前表单内容测试 |
| `window.settingsTools.saveRender(render)` | `settings:save-render` | preload 包装为 `{ render }`；经 `saveRenderDefaults` 调用，只更新 `render` 段 |
| `window.settingsTools.saveUpdater(updater)` | `settings:save-updater` | preload 包装为 `{ updater }`；只更新 `updater` 段（`feedUrl` / `autoCheck` / `skippedVersion`） |
| `window.updateTools.version()` | `update:version` | **同步**返回当前版本号字符串（`sendSync`），首屏显示用 |
| `window.updateTools.check()` | `update:check` | 检查更新，返回 `{ ok, state, version, currentVersion }` |
| `window.updateTools.download()` | `update:download` | 下载安装包 |
| `window.updateTools.cancel()` | `update:cancel` | 取消下载 |
| `window.updateTools.install()` | `update:install` | 退出并运行安装器；本机有任务在跑时返回 `ok: false` + 提示 |
| `window.updateTools.onProgress(cb)` | `update:progress` | 更新状态与下载进度订阅（单订阅） |
| `window.voiceTools.saveConfig({ apiKey, targetModel })` | `voice:save-config` | preload 包装为 `{ voiceTTS }` |
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

1. **千问语音读取入口是 `settingsTools.get()`**：页面从返回值的 `voiceTTS` 回填，**未调用** `window.voiceTools.getConfig()`；`voiceTools.getConfig` / `voiceTools.pickDir` 由「音色管理」「文字生音频」等页面使用。
2. 本页**没有**「自定义保存目录」表单项（只有 API Key 与目标模型），保存目录由使用侧经 `voiceTools.getSaveDir`、`voiceTools.pickDir` 处理。
3. **`settingsTools.get()` 调用三次**，各自在独立 `try` 中，失败分别写 `status` / `vStatus`（第三次仅静默回落内置默认），互不影响。
4. **`vModel` 回填条件**：只有候选列表含该 id 才采用已保存值，否则回落 `isDefault` 项或第一项，避免已下线模型 id 导致下拉空选。
5. **`onSaveVoice` 无前置校验**：空 API Key 也会提交，合法性由主进程判断并回传 `message`；**API Key 落盘位置**界面明确为「仅保存在本机 userData/settings.json」，两个输入框均 `type="password"`，不做额外脱敏。
6. **状态类名沿用全局约定**：`''` / `'hf-ok'` / `'hf-error'`，与 `hf-status` 样式配套，三处状态条（卡片 1、卡片 2、子组件表单）共用。
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
