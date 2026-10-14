# 友好错误映射清单（错误码 → 人话文案）

> 状态：**设计文档（待实施）**。本文是「把原始错误翻译成人话」这件事的唯一清单来源，实现按本文逐条落地；落地情况回写 `CHANGELOG.md`。
> 最后更新：2026-10-14。涉及源码（预计）：`src/shared/errors.ts`（新增）、`src/main/htmlAgent.ts`、`src/main/voice.ts`、`src/main/settings.ts`、`src/main/projects.ts`、`src/main/updater.ts`、`src/main/whisper.ts`、`src/main/ttsAlign.ts`、`src/main/video.ts`、`src/main/runtime.ts`。
> 起因：用户配 `https://api.deepseek.com` 生成 HTML 时界面弹出 `402 Insufficient Balance (request_id: fec71a52-…)` —— 原始英文报文直接透传给终端用户。
>
> 码表来源：DeepSeek 官方 [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes)（400 / 401 / 402 / 422 / 429 / 500 / 503 已逐条核对）+ 本项目实测报文 + DashScope 官方错误码（V 系列，见 §12 待确认项）。

---

## 1. 现状：错误文案的三套处理方式

| 模块 | 现状 | 问题 |
|---|---|---|
| `updater.ts` | 已有 `humanError(raw) → { message, detail }`，403 / 404 / 网络 / sha512 / app-update.yml 五档 | **全仓唯一做对的地方，应作为统一范式** |
| `voice.ts` | 已有 `voiceFriendlyError(err, label)`：模型不存在 / 音色未授权 / 鉴权 / 额度 四档 | 正则顺序把 `401\|403` 与 `Insufficient` 混在一条链上，额度类只加前缀不给人话；**未覆盖阿里云的 `Arrearage`（余额）/ `Throttling.*`（限流）/ `DataInspectionFailed`（合规）** |
| `htmlAgent.ts` / `settings.ts` / `projects.ts` | **零映射**，直接把 SDK / fetch 的 message 抛给界面 | 用户看到 `402 Insufficient Balance`、`HTTP 422：{"error":…}` 这类原文 |

**结论**：缺的是「一张共用表 + 一个共用函数」，而不是各自打补丁。三套入口应统一到 `friendlyError(err, ctx)`。

---

## 2. 错误源盘点（谁在什么时候会吐码）

| # | 调用点 | 目标 | 协议 | 可能吐出的码 | 现在怎么显示 |
|---|---|---|---|---|---|
| A | `htmlAgent.chatWithCustomModel()` | 自定义模型（DeepSeek / 百炼兼容模式 / 智谱 / MiniMax） | OpenAI 兼容 `/chat/completions`（SDK 优先，兜底 fetch） | HTTP 400/401/402/403/404/422/429/5xx + 厂商 `code` | **原始英文（就是这次的 402）** |
| B | `settings.ts` 测试连接 | 同上 | 同上 | 同上 | 原始英文（拼在「连接失败：」后） |
| C | `voice.ts` `/services/audio/tts/customization` | DashScope 原生 `api/v1` | Bearer + `model`/`input`/`parameters` | HTTP 400/401/429/5xx + 厂商 `code`（`InvalidApiKey` / `Arrearage` / `Throttling.*` / `DataInspectionFailed` …） | 部分友好（四档） |
| D | `voice.ts` 兼容模式合成 | `dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容 | 同上 | 同 C |
| E | `whisper.ts` | 本机 `whisper-cli.exe` | 子进程 | 退出码 / stderr / 无 JSON | 已有中文文案，补 `ENOENT`/`EACCES` |
| F | `video.ts` | 本机 `hyperframes.mjs` + `node` | 子进程 | `exit=N` + stderr | 「渲染失败（exit=1）」——**没有 stderr、没有处置建议** |
| G | `runtime.ts` | 自建更新源 | HTTP + 7za | HTTP / sha512 / 磁盘 | 已有人话（`fail()`）+ detail |
| H | 全模块 | 本机文件系统 | Node fs | `ENOENT`/`EACCES`/`EBUSY`/`ENOSPC`/`EPERM`/`EROFS`/`EPIPE` | 英文原文 |
| I | 兜底 fetch | 任意主机 | fetch | `ENOTFOUND`/`EAI_AGAIN`/`ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`/`CERT_*`/`fetch failed`/`aborted` | 英文原文 |

**展示形态分两种**（2026-10-14 决策，详见 §11.1）：**配置类**（缺 Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用 / 余额不足）→ **弹窗 + [去设置] / [取消]**；**其余全部**（限流、5xx、网络、合规、参数、文件、子进程）→ 内嵌状态行 + `.hf-detail` 折叠排障详情，不弹窗。

---

## 3. 统一范式（两层分离，不分模块）

沿用 `updater.ts` 已定下的约定，全应用一致：

- `message` —— 终端用户看的。只说「发生了什么 + 你能做什么」，**不许出现** `HTTP 402` / `Insufficient Balance` / `ECONNRESET` / `request_id` / 存储桶 / `latest.yml` 这类词。
- `detail` —— 排障用的原始报文（HTTP 状态 + 厂商 code + request_id + 首行截断 300 字符），由 UI 的「查看详情」折叠展示，并全量落日志。
- 提供方：`src/shared/errors.ts` 导出 `friendlyError(err, ctx) → { message, detail }`；`ctx` 至少含 `label`（动作名，如「生成 HTML」）与可选 `provider`。

> 例外（照 `updater.ts` 的先例）：**没有原始异常**的失败（如「响应为空」「被 max_tokens 截断」）由调用方成对手写 `message`/`detail`，不经 `friendlyError()`。

---

## 4. 表 1：HTTP 状态码（所有外部服务通用，按匹配顺序）

> 顺序不可变：**feature 性 code 先于状态码**（如 DeepSeek 的 402 报文里 message 就是 `Insufficient Balance`，DashScope 的鉴权失败也可能是 400 + `InvalidApiKey`）。
> DeepSeek 码表见 [官方 Error Codes](https://api-docs.deepseek.com/quick_start/error_codes)（400/401/402/422/429/500/503，无 403/404）；DashScope 的余额类错误**不是 402**，见 §6 的 `Arrearage`。

| ID | HTTP | 厂商 code / 报文特征 | message（用户可见 · 中文） | detail（排障） | 建议处置 |
|---|---|---|---|---|---|
| H-400 | 400 | `invalid_request_error` / `InvalidParameter` / `DataInspectionFailed` | 请求格式或内容不合规，本次生成已中止 | 服务端拒绝该请求：参数或内容不合法 | 改需求描述后重试；若反复出现按「查看详情」提交报文 |
| H-401 | 401 | `invalid_api_key` / `AuthenticationError` / `InvalidApiKey` | API Key 无效，请到「设置」重新填写并保存 | 鉴权失败：Key 错误、已删除或不属于该厂家 | 打开设置页对应厂家的 API Key 输入框 |
| H-402 | 402 | `Insufficient Balance` | **账户余额不足，无法调用模型；请充值或改用其它模型** | 服务端判定余额不足（预付费平台充值余额与赠送额度分列，赠金过期同样报此错） | 主按钮「去充值」（打开厂家充值页）+ 次按钮「打开设置」 |
| H-403 | 403 | `permission_denied` / `AccessDenied` / `Forbidden` | 该 API Key 没有调用此模型的权限 | 权限被拒：Key 未开通该模型、或额度被冻结 | 换模型或到厂家控制台开通 |
| H-404 | 404 | `model_not_found` / `Model not exist` | 模型不存在：请核对「设置」里的模型 ID | 模型 ID 在当前账号/该 Base URL 上不存在 | 设置页「测试连接」；音色类另见 V-900 |
| H-413 | 413 | `RequestEntityTooLarge` | 输入内容过长，服务端拒收 | 请求体超过服务端上限（字幕 / 素材过多） | 精简字幕或素材后重试 |
| H-422 | 422 | `invalid_parameter` / `Unprocessable` | 请求参数不被接受，请检查模型 ID 与请求设置 | 参数校验失败（常见于模型不支持某参数） | 换模型；详情里看具体字段 |
| H-429 | 429 | `rate_limit` / `Throttling` / `Throttling.RateQuota` / `RequestsRateLimitExceeded` | **请求过于频繁，稍等片刻再试**（免费/低档账号限制更严） | 触发厂家限流（RPM/TPM） | 退避重试（自动 1 次 + 手动） |
| H-429q | 429* | `insufficient_quota` / `Allocated quota exceeded` | 本周期额度已用完，请等下个周期或升级套餐 | 配额耗尽（与限流不同：等再久也不会恢复） | 厂家控制台查看配额（百炼侧对应 `Throttling.AllocationQuota`，见 V-429） |
| H-500 | 500 | `server_error` / `InternalError` | 模型服务内部错误，请稍后重试 | 服务端 5xx | 重试 |
| H-502/503/504 | 502/503/504 | `ServiceUnavailable` / 网关超时 | **模型服务暂时不可用，请稍后重试** | 网关 / 服务过载或超时 | 重试；避开高峰 |

\* 429 与「配额耗尽」的实际状态码各厂家不统一（DashScope 侧常见 400/429 混用），匹配时**以 code 字符串优先**。

---

## 5. 表 2：模型（HTML 生成 / 测试连接）专属

| ID | 触发条件（源码位置） | message | detail |
|---|---|---|---|
| M-001 | `htmlAgent.ts:66` 未启用 | 自定义模型未启用：请到「设置」打开开关并填写 Base URL / Model ID / API Key | 配置项 `customModel.enabled = false` |
| M-002 | `htmlAgent.ts:67` 缺字段 | 模型配置不完整：Base URL / Model ID / API Key 三项都要填 | 缺字段清单（哪几项为空） |
| M-003 | 响应为空（`htmlAgent.ts:236`） | 模型没有返回任何内容，请重试或更换模型 | usage / finish_reason 原文 |
| M-004 | `finish_reason=length` 截断（`htmlAgent.ts:234`） | HTML 被最大长度截断，全部档位都不完整：请精简字幕素材，或换输出上限更大的模型 | 每档 max_tokens 与 usage |
| M-005 | `settings.ts:381` 通但无文本 | 连接已通但模型没返回文本（推理模型或网关异常），请检查 Model ID 或更换模型 | 原始响应 |
| M-006 | `settings.ts:355` 测试时缺字段 | 配置不完整：Base URL / Model ID / API Key 均需填写 | 缺字段清单 |
| M-007 | Base URL 填错（如漏了 `/v1`、填了网页地址）→ 404/405/HTML 响应 | Base URL 可能填错了：请填写以 `/v1` 结尾的接口地址（不是网页地址） | 实际请求 URL + 响应首行 |
| M-008 | 非流式/流式被网关改写成 JSON（无 `data:`） | 服务端没有按流式返回：可能是 Base URL 或模型不支持流式，请更换模型或网关 | 响应前 300 字符 |
| M-009 | 用户取消 / 切页导致 `aborted` | 已取消本次生成 | `ERR_ABORTED` 原文 |

---

## 6. 表 3：语音 / 音色复刻专属（DashScope）

> 现有 `voiceFriendlyError()` 的四档在此表内收编（V-401 / V-429 / V-900 / V-901），**新增 V-402（阿里云余额是 400 + `Arrearage`，不是 402）、V-403、V-406、V-906、V-907 与 V-902/903/904/905**。

| ID | 厂商 code / 报文 | message | 处置 |
|---|---|---|---|
| V-000 | 未配置 Key（`getVoiceApiError`） | 未配置「〈厂家〉」的 API Key，请先到「设置 → 语音服务」填写并保存 | 打开设置页 |
| V-401 | `InvalidApiKey` / `Unauthorized` / `401` / `403` | 语音服务的 API Key 无效或无权限，请检查后重试 | 换 Key |
| V-402 | **`Arrearage`**（HTTP 400）/ `isv.OUT_OF_SERVICE` / `Insufficient` / `Insufficient Balance` | **语音服务账户余额不足或已欠费，服务已暂停，请充值后再试** | 去充值（阿里云费用中心） |
| V-429 | `Throttling.RateQuota` / `Throttling.AllocationQuota` / `Throttling.BurstRate`（HTTP 429，OpenAI 兼容侧别名 `limit_requests` / `insufficient_quota` / `limit_burst_rate`） | **语音合成请求过于频繁或用量超限，请稍后再试** | 重试；突发限流可加 `X-DashScope-Wait-Timeout` 头（3~120 秒）让服务端排队 |
| V-403 | `DataInspectionFailed` / `data_inspection_failed` | **内容未通过服务端合规检查**（字幕或参考音频被判为敏感），请修改后重试 | 改文本 / 换素材 |
| V-406 | `InvalidParameter.DataInspection` + `Unable to download the media resource` | 参考音频/素材下载超时（跨区域或第三方的安全策略拦截）：建议改用本地上传或同区域存储 | 改传本地文件 |
| V-800 | 音色与模型不同厂家（`vendorMismatch`） | 音色「〈v〉」属于「〈A〉」，模型「〈m〉」属于「〈B〉」：两者必须同厂家，请改选模型或到「音色映射管理」改绑 | 已有文案，保留 |
| V-900 | `Model not exist` | 这个模型在当前账号里不存在：请到「设置 → 语音服务」核对厂家，或到「音色映射管理」把该音色改绑到可用模型 | 已有文案，保留 |
| V-901 | `does not exist or is not licensed` | 音色未获授权或不存在：克隆音色只能用创建时的复刻模型，该模型不可用时请改用系统音色 | 已有文案，保留 |
| V-902 | `VoiceNotFound`（删除音色） | 云端没有这个音色（可能已被删除）：〈id〉 | 已有文案，保留 |
| V-903 | 参数/模型不匹配（如把 `qwen3-tts-flash` 用于复刻） | 模型「〈m〉」不支持音色复刻：请把目标模型选成 `qwen-audio-*` 系列 | 已有文案，保留 |
| V-904 | 参考音频过短 / 读不出时长 | 参考音频太短（〈n〉秒）：声音复刻要求 3~30 秒清晰人声 | 已有文案，保留 |
| V-905 | 未返回 `output.audio.url` / `output.voice_id` | 接口没有返回音频地址 / 音色 ID，请重试（可能被服务端策略拦截） | 详情里放原始响应 |
| V-906 | `The requested voice 'xxx' is not supported.`（400 `invalid_value`） | **该音色不被当前模型支持**：实时合成的 `model` 必须与克隆时用的 `target_model` 一致 | 到「音色映射管理」改绑模型 |
| V-907 | `[tts:]Engine return error code: 418` | 音色与模型的版本不匹配（v1/v2 混用）或音色不属于当前账号 | 核对音色状态与版本 |

---

## 7. 表 4：网络与传输（含兜底 fetch）

| ID | 特征 | message | 处置 |
|---|---|---|---|
| N-001 | `ENOTFOUND` / `EAI_AGAIN` / `getaddrinfo` | 无法解析服务器地址，请检查网络与 Base URL 拼写 | 显示实际请求的 host |
| N-002 | `ECONNREFUSED` / `ECONNRESET` / `EPIPE` / `socket hang up` | 连接被拒绝或中断，请检查网络（代理 / VPN / 防火墙）后重试 | 重试 |
| N-003 | `ETIMEDOUT` / `timeout` / `UND_ERR_CONNECT_TIMEOUT` | 连接超时：网络不通或服务无响应，请稍后重试 | 重试 |
| N-004 | `CERT_` / `UNABLE_TO_VERIFY` / `self signed` / `SELF_SIGNED_CERT_IN_CHAIN` | 证书校验失败：可能是代理/抓包工具拦截了 HTTPS | 关闭代理或换网络 |
| N-005 | `fetch failed`（无更细信息） | 网络请求失败，请检查网络后重试 | 详情里放 `cause` |
| N-006 | `aborted` / `ERR_ABORTED` | 已取消 | — |

---

## 8. 表 5：本机文件系统 / 子进程

> 面向中文用户的桌面应用，这些英文 errno **不该直接出现在界面上**。原有中文文案保留，只补 errno 档。

| ID | errno / 特征 | message | 处置 |
|---|---|---|---|
| F-001 | `ENOENT`（用户文件路径） | 文件不存在或已被移动：〈路径〉 | 让用户重新选择 |
| F-002 | `ENOENT`（内部资源，如 `whisper-cli.exe` / `hyperframes.mjs` / `ffmpeg.exe`） | 运行环境不完整（缺 〈文件名〉）：请到「设置 → 运行环境」重新下载 | 已有同类文案，统一到这条 |
| F-003 | `EACCES` / `EPERM` | 没有权限访问该文件：可能被其它程序占用，或需要以管理员身份运行 | 关闭占用程序 |
| F-004 | `EBUSY` / `UNKNOWN`（文件被占用） | 文件正被其它程序占用（〈路径〉），请关闭后重试 | 常见于 Excel / 播放器打开着输出目录 |
| F-005 | `ENOSPC` | 磁盘空间不足，请清理后重试 | — |
| F-006 | `EROFS` | 目标位置不可写入，请更换保存目录 | 指向设置页保存目录 |
| F-007 | 子进程 `exit≠0` + stderr | 转码 / 渲染失败：〈stderr 关键行〉 | **详情里必须带 stderr 尾部**（当前 `video.ts:167` 只有 `exit=N`，无法排障） |
| F-008 | `spawn ... ENOENT` | 找不到要启动的程序：〈cmd〉 | 指向环境包 |
| F-009 | Node 版本 `>= 22` 不符 | 未找到可用的 Node.js（HyperFrames 要求 ≥ 22） | 已有文案，保留 |

---

## 9. 表 6：已有且不必改的（回归用，别重复实现）

| 来源 | 文案 | 备注 |
|---|---|---|
| `updater.humanError()` | 更新服务暂时不可用 / 暂时没有可用的新版本信息 / 网络连接失败 / 安装包下载不完整 / 当前版本不支持自动更新 | 403 / 404 / 网络 / sha512 / app-update.yml 五档 + detail，**保持判断顺序不变** |
| `updater` 无事件守卫 | 开发环境不检查更新 / 下载没有开始，请稍后重试 | 没有原始异常，成对手写（见本文 §3 例外） |
| `runtime.ts` | 运行环境尚未准备好 / 需要联网下载但更新源没有清单 / 下载校验失败 / 下载解包失败 / 正在准备另一个运行环境包 | 已两层分离 + `needPacks` |
| `whisper.ts` / `ttsAlign.ts` / `projects.ts` / `voice.ts` | 「模型未下载」「字幕为空」「项目还没有 HTML」「已有转录任务进行中」等**业务校验**文案 | 这些不是错误码，属参数校验，保持不动 |
| 「有任务进行中」一族 | 转录 / 渲染 / 配音互斥 | 保持不动 |

---

## 10. 匹配顺序（实现时必须照此）

1. **业务 code 优先**（`VoiceNotFound`、`Model not exist`、`does not exist or is not licensed`、`Arrearage` / `isv.OUT_OF_SERVICE`、`Throttling.RateQuota` / `Throttling.AllocationQuota` / `Throttling.BurstRate`、`DataInspectionFailed`、`Insufficient`）；
2. 再判 **HTTP 状态码**（402 → 401 → 403 → 429 → 404 → 422 → 413 → 5xx）；
3. 再判**网络 errno**（`ENOTFOUND` → `ECONNREFUSED/ECONNRESET` → `ETIMEDOUT` → `CERT_`）；
4. 再判**文件系统 errno**（`ENOENT` → `EACCES/EPERM` → `EBUSY` → `ENOSPC` → `EROFS`）；
5. 都不命中 → 通用兜底：`〈动作〉失败，请重试`，`detail` 放原始首行。

反例（现在的坑）：`voiceFriendlyError` 把 `401|403` 和 `Insufficient` 写在同一条 if 链上，`Model not exist` 必须排在最前，否则会被 404 分支吃掉。

---

## 11. 落地约定

1. **新增 `src/shared/errors.ts`**：`friendlyError()` + `type FriendlyError = { message: string; detail: string; needConfig?: ConfigTarget }`（`ConfigTarget = 'model' | 'voice' | 'billing'`）+ 纯函数便于单测；主进程各模块 import，渲染层只渲染不做二次翻译（与 `UpdateCheckResult` 同一分层）。
2. **`IpcFail` 已支持 `detail`**（`src/shared/types.ts`，2026-10 加入）。**新增可选 `needConfig` 字段的成本实测只有两处**：`src/shared/types.ts` 加字段 + `src/main/**` 生产它。**preload 不需要改**——它是纯转发（`ipcRenderer.invoke(...)` 把主进程返回的对象原样交给渲染层，既不解构也不重建），`detail` 与 `needPacks` 当年就是这样过去的。仍建议在 `src/preload/index.ts` 相应方法或注释里点一句，属于「类型契约在 shared、转发在 preload」的知情成本，不是代码成本。
3. **UI 挂载点**：`HtmlGenPage`（生成 HTML 失败的 `.hf-status.hf-error` 行）+ `SettingsPage`（测试连接、应用更新）已有 `.hf-detail` 折叠块与「查看详情」按钮范式，直接复用；余额类（DeepSeek 402 / 百炼 `Arrearage`）的弹窗按钮改为「去充值」+「取消」（`shell.openExternal` 打开厂家充值页）。
4. **日志**：`detail` 与原始终端报文一并落 `userData/*.log`（复用 `updater.log` / `runtime.log` 的追加写范式）。
5. **默认不加重试**：402 / 401 / 400 / 422 重试无意义（余额与配置问题），429 / 5xx / 网络类可自动退避重试 1 次——与 `htmlAgent` 现有「升档重试」区分开（那是针对 `max_tokens` 截断，不是针对错误码）。

### 11.1 配置类错误 → 升级为「弹窗 + 去设置 / 取消」（2026-10-14 决策）

**背景**：这类错误只躺在状态行里太弱——用户看一眼不知道去哪修，或者要自己翻到设置页找对应填框。

**判定为「配置类」的档位（弹窗）**：

| ID | 报错 | 弹窗标题 |
|---|---|---|
| H-401 / V-401 | `invalid_api_key` / `InvalidApiKey` / `Unauthorized` / 401 / 403 | 「模型 API Key 无效」/「语音 API Key 无效」 |
| M-001 | 自定义模型未启用 | 「自定义模型未启用」 |
| M-002 / M-006 | 模型配置不完整（Base URL / Model ID / API Key 缺失） | 「模型配置不完整」 |
| M-007 | Base URL 填错（补 `/v1`） | 「Base URL 可能填错了」 |
| V-000 | 未配置语音 API Key | 「未配置语音 API Key」 |
| H-402 / V-402 | 余额不足 / 欠费（DeepSeek 402 / 百炼 `Arrearage`、`isv.OUT_OF_SERVICE`） | 「账户余额不足」→ 按钮改「去充值」+「取消」 |

`needConfig` 只标**需要用户去设置页改配置**的档位；**其余档位一律保持内嵌 `.hf-status.hf-error` + `.hf-detail`，不弹窗**：429 限流、5xx、网络 / 证书、`DataInspectionFailed` 合规拦截、404 模型不存在、参数类 4xx、渲染 / 转录 / 文件的 exit≠0 与 errno。

**弹窗内不显示「查看详情」**（2026-10-14 决定）：配置类弹窗只有 `[去设置]` / `[取消]` 两个按钮，正文只说「发生了什么 + 去哪修」；`detail` 仍照常写日志。理由：配置类错误的原始报文对用户没有可操作性，而弹窗多一个折叠区会让「点哪个按钮」这个唯一决策变模糊。

**两处判定（选其一即可，推荐 1）**：

1. **主进程打标**（推荐）：`friendlyError()` 判定命中「配置类」档位时，在 `IpcFail` 上带 `needConfig: 'model' | 'voice' | 'billing'`；渲染层 `if (res.needConfig) configPrompt.open(res.needConfig, res.message)`。判据是**结构化字段**而非文案，措辞怎么改都不会漏。
2. **渲染层正则兜底**（零 IPC 改动）：由渲染层对 message 做正则判定——`未启用|配置不完整|均需填写|三项都要填|Base URL|API Key|api[ _-]?key|InvalidApiKey|unauthorized|余额不足|欠费`。
   注意**误判陷阱**：不能用 `api.?key` 这种松写法——`Insufficient Balance` 里的 `Balance` 会被 `ala` 命中，把「没钱」误判成「Key 错了」（余额类按钮是「去充值」，误判就会给错按钮），故必须写成 `API Key`（带空格）或 `api[ _-]?key`（限定分隔符）。
   另有兜底缺口：`/chat/completions` 被自定义 Base URL 换成非 OpenAI 协议的服务时，可能返回本表之外的报文——加 `detail` 请用户提交报文即可，不必追求穷举。**只有两处调用点**（`projects.ts:589` / `:641` 的 generate / modify）保留正则，其余一律走字段。

**复用现成范式**：App.vue 已有运行环境确认框（`env-gate`）就是「全局单例 + 两个按钮 + 取消即作废」——弹窗照它做：新增 `composables/useConfigPrompt.ts`（模块级单例：`visible` / `title` / `message` / `detail` / `section`），在 App.vue 的 `env-gate` 之后渲染一个 `.hf-modal`，标题与正文字号沿用 §3.1 刻度（标题 14px、说明 12px）。

**按钮行为**：`[去设置]` = `requestSettingsSection(section)`（复用 `composables/useNavIntent.ts`，**不要新造跳页信号**）+ `goPage('settings')` + 关框；`[取消]` = 关框、本次操作作废。分类映射：`model` → `model` 分类、`voice` → `voice` 分类、`billing`/更新源 → 各自分类。

**顺带收口**：`pages/TextTtsPage/helpers.ts` 的 `requireCfg()` 目前**直接 `goPage('settings')` 把用户从当前页拽走**（`useNavIntent` 里那句注释就是描述这个行为）——改为弹同一个框，由用户决定去不去。

---

## 12. 待确认 / 风险

| 项 | 说明 |
|---|---|
| DashScope 余额态是 **400 + `Arrearage`**，不是 402 | **已确认（[官方错误码](https://www.alibabacloud.com/help/en/model-studio/error-code)）**：`400-Arrearage` → `Access denied, please make sure your account is in good standing.`，处置为到费用中心充值；另有 `isv.OUT_OF_SERVICE`（余额不足、服务已停）与第三方客户端聚合后的 `API provider returned a billing error … insufficient balance`（底层仍是 Arrearage）。**故 402 只对 DeepSeek 这类平台成立，阿里云必须靠 code 字符串匹配** |
| DashScope 限流码 | **已确认（[限流最佳实践](https://www.alibabacloud.com/help/en/model-studio/rate-limiting-best-practices)）**：`Throttling.RateQuota`（RPM/RPS）、`Throttling.AllocationQuota`（TPM/TPS）、`Throttling.BurstRate`（流量突增）；OpenAI 兼容侧别名为 `limit_requests` / `insufficient_quota` / `limit_burst_rate`；触发后一般 1 分钟内恢复 |
| 429 的可优化项 | 官方提供 `X-DashScope-Wait-Timeout`（3~120 秒）让服务端排队，仅对 `Throttling.BurstRate` 有效——若要实现「自动重试 1 次」，比客户端睡眠更省事（**待决策**，属功能增强，不在本次错误映射范围内） |
| DeepSeek 官方错误码全集 | **已确认（[官方文档](https://api-docs.deepseek.com/quick_start/error_codes)）**：仅 400 / 401 / 402 / 422 / 429 / 500 / 503 七种，**没有 403 与 404** ⇒ 表 1 的 403、404 档对 DeepSeek 不会命中（保留给百炼 / 智谱 / MiniMax）；「模型 ID 不存在」在 DeepSeek 侧按 400 `Invalid Format` 或 422 `Invalid Parameters` 返回，故 H-404 的文案需允许由报文字符串（含 `model`）二次判定 |
| DeepSeek 402 与充值入口 | **已确认（官方文档）**：`402 - Insufficient Balance` = 余额用尽，处置为到 `https://platform.deepseek.com/top_up` 充值；与本次实测报文 `402 Insufficient Balance (request_id: …)` 一致 |
| 智谱 / MiniMax 码表 | 未核对官方文档（本项目 `MODEL_PROVIDERS` 里的另外两家）。它们同为 OpenAI 兼容协议，表 1 的状态码档可覆盖大部分；若用户实际用这两家报错，再按同一格式补行 |
