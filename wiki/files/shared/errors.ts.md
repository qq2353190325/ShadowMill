# src/shared/errors.ts

> 全应用「英文原始报错 → 人话文案」的**唯一映射表**：纯函数、无副作用、不依赖 electron

- **所在目录**：`src/shared/`
- **类型**：共享纯函数模块（+ 2 个类型）
- **规模**：225 行
- **对外导出**：`friendlyError(err, ctx)`、`configTargetOf(message)`、`configTitle(target)`、类型 `FriendlyError` / `ErrorContext`

## 1. 作用与职责

外部服务（自定义模型 / 语音服务）与本机文件系统抛出来的都是英文原文（`402 Insufficient Balance`、`HTTP 422：{"error":…}`、`ENOENT` …），直接透传给终端用户既看不懂、也不知道该去哪修。本文件把「原始异常 → 用户文案 + 排障详情 + 配置分类」这三件事收敛成**一张码表**，供主进程各模块统一调用。

源码头部注释给出三条硬约定：

1. **`message` 只说人话**：发生了什么 + 你能做什么；**不许出现** HTTP 状态码、`Insufficient Balance`、`ECONNRESET`、`request_id`、厂商 code 这类只有排障时才需要的词。
2. **`detail` 存排障信息**（原始报文首行，截断 500 字符），由调用方落日志；**配置类弹窗不显示它**（见 `docs/error-mapping.md` §11.1：弹窗只有「去设置」/「取消」一个决策，不放折叠区）。
3. **`needConfig` 只标「用户去设置页改配置就能解决」的错误**（缺 Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用）。界面据此把错误升级成弹窗；**其余一律走内嵌状态行**——**余额 / 欠费刻意不在此列**：去设置改不了余额，它走内嵌状态行（文案直接说明去厂家控制台充值）。

> 注释与实现此前曾在「余额不足」上不一致（摘除「去充值」时漏改头部注释），2026-10 已把该词从 `needConfig` 适用范围中删除，见 §10。

完整映射清单（58 条、含官方码表来源）见仓库文档 `docs/error-mapping.md`，改这里之前先看那份文档。与 `src/main/updater/base.ts` 的 `humanError()` 是**同一分层约定**（message 说人话 / detail 给排障），区别是 updater 只管自更新一条链路、且要抠出请求 URL，故仍留在原处不合并。

## 2. 导出与内部实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `FriendlyError` | `interface` | 产出结构：`message` / `detail?` / `needConfig?`（**没有 `configUrl`**，见 §10） |
| `ErrorContext` | `interface` | 调用上下文：`label` / `provider?` / `baseUrl?` / `extras?` / `hint?` |
| `friendlyError(err, ctx)` | 函数 | 主入口：翻译 + 拼动作前缀，返回 `FriendlyError` |
| `configTargetOf(message)` | 函数 | 给「只有一句已翻译中文文案」的上游用：复用同一张码表补分类，返回 `{ needConfig?, title? }` |
| `configTitle(target?)` | 函数 | 配置类弹窗标题（主进程单点产出，界面只显示不判断） |

内部（未导出）：`rawMessage` / `statusOf` / `codeOf` / `matchText` / `detailOf` / `coreMessage` / `cfgTargetOf`，常量 `CONFIG_TITLE`。

**依赖**：只有一行 `import type { ConfigTarget } from './types'` —— 没有任何运行时 import，不 import `electron`，不读文件、不发请求，因此 main 与 renderer 内联它都是安全的（当前唯一的运行时消费方是主进程）。

### 2.1 从异常对象里取字段（`rawMessage` / `statusOf` / `codeOf`）

OpenAI SDK 的 `APIError` 带结构化 `status` / `code`，自造的 `Error` 则把状态码写进了 message（如 `'HTTP 402：…'`），两者都要认：**先取结构化字段，没有再退回正则**。

- `rawMessage(err)`：`null` → `''`；`string` → 原样；否则拼接 `err.message` + `err.error.message` + `err.error.code`（对象字段存在才拼），都没有时回退 `String(err)`。
- `statusOf(err)`：`Number(err.status)`，非有限数回 `0`。
- `codeOf(err)`：`String(err.code)`，缺省回 `''`。

### 2.2 匹配文本（`matchText`）

```ts
function matchText(err: unknown, hint?: string): string {
  const st = statusOf(err)
  const code = codeOf(err)
  return [hint, code, st ? String(st) : '', rawMessage(err)].filter(Boolean).join(' ')
}
```

即「`hint` → 厂商 code → 状态码 → 原始报文」拼成一段可正则匹配的文本。**`hint` 只参与匹配**，不进 message、也不进 detail。

## 3. `FriendlyError` 与 `ErrorContext`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `message` | `string` | 面向用户的中文文案（**已含动作前缀**，如「生成 HTML：账户余额不足或已欠费，请到厂家控制台充值后重试」） |
| `detail` | 可选 `string` | 排障详情：原始报文首行（截断 500 字符）；没有可留的东西时为 `undefined` |
| `needConfig` | 可选 `ConfigTarget` | 命中「需要用户去设置页改配置」时给出目标设置分类（`'model' \| 'voice'`），界面据此弹「去设置 / 取消」；不命中则无此字段。源码注释明确：**余额 / 欠费类刻意不在此列** |

| `ErrorContext` 字段 | 必选 | 说明 |
| --- | --- | --- |
| `label` | 是 | 动作名（拼在 message 最前面，用户得知道是哪件事失败了；缺省 `'操作'`） |
| `provider` | 否 | 已解析出的厂家 key（如 `qwen`） |
| `baseUrl` | 否 | 本次请求的 Base URL（**排障详情用**；源码注释另注明：也曾用于给余额类找充值页，那个按钮已按用户要求摘除） |
| `extras` | 否 | 附加到详情里的字段（原始 code / HTTP 状态 / 请求地址），比从文案里正则抠更可靠 |
| `hint` | 否 | **分类提示**：调用方已经知道的事实，但原文案里没有关键词（故正则匹配不到）。例：配置项 `enabled=false` 抛出的「自定义模型未启用」这句里没有 `400` / `api key`，单靠文案无法定位到「未启用」档，于是 `agent/chat.ts` 传 `hint: 'model-not-enabled'`；写成 kebab 短标识即可被码表匹配。只参与匹配，不进 message、也不进 detail |

`friendlyError` 本体只有两步：

```ts
export function friendlyError(err: unknown, ctx: ErrorContext): FriendlyError {
  const label = (ctx && ctx.label) || '操作'
  const core = coreMessage(err, { ...ctx, label })
  return { ...core, message: label + '：' + core.message }
}
```

即：`coreMessage()` 产出「不带动作前缀」的核心文案，`friendlyError()` 只负责加前缀。`configTargetOf()` 也复用 `coreMessage()` 的码表（但它自己按文案句式判分类，见 §8）。

## 4. 判定顺序（核心映射表）

`coreMessage()` 按固定顺序逐档匹配，**顺序不可变**——源码注释解释了原因：余额类错误在不同厂家的状态码不一致（DeepSeek 是 `402`、百炼是 `400` + `Arrearage`），若先按状态码判就会把「欠费」误报成「参数错误」；同理 `403` 的报错里常带请求 URL，先判 `too many` 之类会跑偏。下表「档」沿用源码注释的编号（①～⑨），其中**鉴权 / 地址两档在源码里没有编号**，它们插在 ② 与 ③ 之间。

| 档（源码注释） | 触发条件（状态码 / `hint` / 正则特征词，取自源码） | 产出 `message` | `needConfig` |
| --- | --- | --- | --- |
| ① 余额 / 欠费（**不弹窗**） | `status === 402` **或** `/insufficient[\s_-]*balance\|arrearage\|out_of_service\|out of credits\|欠费\|余额不足\|in good standing/i` | `账户余额不足或已欠费，请到厂家控制台充值后重试` | **无**（刻意不给） |
| ② 未启用 | `/model-not-enabled\|not enabled\|未启用/i`（`hint: 'model-not-enabled'` 走这一档） | `自定义模型未启用，请到「设置」打开开关` | `model` |
| ② 未配置语音 Key | `/未配置\s*[「"']?([^」"'：:]{1,20})[」"']?\s*的?\s*(API[ _-]?Key\|密钥)/i`（厂家名从文案里抠出并复用） | `未配置「<厂家>」的 API Key，请到「设置 → 语音服务」填写并保存` | `voice` |
| ② 配置不完整 | `/配置不完整\|均需填写\|三项都要填\|缺少\|not configured\|api key is required\|no api key/i` **且 `statusOf(err)` 为 0**（即不带状态码） | `模型未配置完整，请到设置页填写 Base URL / Model ID / API Key` | `model` |
| ② 其余「未配置 / 请填写」 | `/未配置\|请填写\|not configured\|api key is required/i`（按文案像不像语音分流：`/语音\|音色\|合成\|voice\|tts/i`） | 像语音 → `未配置语音服务的 API Key，请到「设置 → 语音服务」填写并保存`；否则 → `模型未配置完整，请到设置页填写 Base URL / Model ID / API Key` | `voice` / `model` |
| （未编号）鉴权 401 | `status === 401` **或** `/\binvalid[_\s-]*api[_\s-]*key\b\|invalidapikey\|authentication\|unauthorized\|\b401\b/i` | `API Key 无效，请到「设置」重新填写并保存` | `cfgTargetOf(ctx)` |
| （未编号）鉴权 403 | `status === 403` **或** `/permission[_ ]denied\|forbidden\|accessdenied\|无权限/i` | `该 API Key 没有调用此模型的权限，请核对模型或厂家控制台` | `cfgTargetOf(ctx)` |
| （未编号）地址 / 模型不存在 | `status === 404 \|\| 405` **或** `/not found\|unsupported method/i`；再看 `text + extras` 是否含 `/chat\/completions\|\/v1\|base ?url/i` | 含 → `Base URL 可能填错了：请填写以 /v1 结尾的接口地址（不是网页地址）`；否则 → `模型不存在：请核对设置页的模型 ID` | 都是 `model` |
| ③ 配额耗尽 | `/allocationquota\|insufficient[_ ]?quota\|allocated quota\|quota exceeded\|额度已用完/i`（**必须排在限流之前**：两者的 code 可能同为 `429`，但配额耗尽等再久也不恢复） | `本周期额度已用完，请等下个周期或升级套餐` | 无 |
| ③ 限流 | `status === 429` **或** `/throttl\|rate[_ ]?limit\|limit_requests\|limit_burst_rate\|too many requests\|\b429\b/i` | `请求过于频繁，稍等片刻再试` | 无 |
| ④ 服务端 / 网关 | `status >= 500` **或** `/internalerror\|server error\|service unavailable\|overloaded\|bad gateway\|timeout/i` | `模型服务暂时不可用，请稍后重试` | 无 |
| ⑤ 内容合规 | `/datainspectionfailed\|data_inspection_failed\|inappropriate content\|敏感/i` | `内容未通过服务端合规检查，请修改字幕或素材后重试` | 无 |
| ⑥ 参数类 | `status === 400 \|\| 422` **或** `/invalid[_\s-]*(request\|parameter\|value)\|model not exist/i`；命中后再看是否 `/model not exist\|model[_ ]not[_ ]found\|invalid model/i` | 是 → `模型不存在：请到「设置」核对模型 ID`；否 → `请求参数不被服务端接受，请检查模型 ID 与参数设置` | `cfgTargetOf(ctx)` |
| ⑦ 网络（DNS） | `/enotfound\|eai_again\|getaddrinfo\|dns/i` | `无法解析服务器地址，请检查网络与 Base URL 拼写` | 无 |
| ⑦ 网络（连接） | `/econnrefused\|econnreset\|epipe\|socket hang up\|proxy/i` | `连接被拒绝或中断，请检查网络（代理 / VPN / 防火墙）后重试` | 无 |
| ⑦ 网络（超时） | `/etimedout\|timed? ?out\|und_err_connect_timeout/i` | `连接超时：网络不通或服务无响应，请稍后重试` | 无 |
| ⑦ 网络（证书） | `/cert_\|unable_to_verify\|self[- ]signed/i` | `证书校验失败：可能是代理或抓包工具拦截了 HTTPS` | 无 |
| ⑧ 文件系统（磁盘） | `/enospc\|no space left/i` | `磁盘空间不足，请清理后重试` | 无 |
| ⑧ 文件系统（只读） | `/ero?s?fs\|read[- ]only file system/i` | `目标位置不可写入，请更换保存目录` | 无 |
| ⑧ 文件系统（占用） | `/ebusy\|resource busy\|being used by another process/i` | `文件正被其它程序占用，请关闭后重试` | 无 |
| ⑧ 文件系统（权限） | `/eacces\|eperm\|access is denied\|permission denied/i` | `没有权限访问该文件：可能被其它程序占用，或需要以管理员身份运行` | 无 |
| ⑧ 文件系统（不存在） | `/enoent\|not exist\|no such file/i` | `文件不存在或已被移动` | 无 |
| ⑧ 取消 | `/aborted\|err_aborted\|cancell?ed\|已取消/i` | `已取消` | 无 |
| ⑨ 兜底 | 以上都不命中 | `失败，请重试` | 无 |

要点：

- **只有标了 `needConfig` 的档位会弹窗**（② 未启用/未配置、401/403、地址或模型不存在、400/422），其余档位（① 余额、限流、5xx、合规、网络、文件系统、兜底）都只给 `message` + `detail`，由页面写进内嵌状态行或 toast。
- **`cfgTargetOf(ctx)`** 是私有分流函数：`label` 含「语音 / 音色 / 合成」则回 `'voice'`，否则回 `'model'`。它让「API Key 无效」这类文案在语音链路里也能把用户送到「设置 → 语音服务」。
- 404/405 那一档要读 `ctx.extras`（`agent/chat.ts` 会把「请求地址：…」塞进 extras），否则「Base URL 填错」与「模型不存在」不好区分。
- 每一档的 `detail` 都由 `detailOf()` 统一产出，与该档文案无关。

## 5. 排障详情 `detail`（`detailOf`）

```ts
function detailOf(text: string, extras?: string[]): string | undefined {
  const first = String(text || '').trim().split('\n')[0].slice(0, 500)
  const extra = (extras || []).filter(Boolean).join('；')
  if (!first && !extra) return undefined
  return (first ? '原始报错：' + first : '') + (extra ? (first ? '；' : '') + extra : '')
}
```

- 原始报文取**首行**（`trim()` 后按 `\n` 切第一段）并截断 **500** 字符（与 `updater/base.ts` 的 `humanError` 同一口径，只是阈值放宽）；
- 前缀固定为 `原始报错：`；
- `extras` 过滤空值后用「；」连接追加在后（`agent/chat.ts` 传来的是 `'请求地址：<apiUrl>'` 与 `httpDetail`）；
- 两者都为空时返回 `undefined`（`FriendlyError.detail` 是可选字段）。

## 6. 充值页：已整条摘除

源码第 48–49 行是一段**说明性注释**（不是代码）：

```ts
// 模型厂家充值页（余额 / 欠费类的「去充值」目标）已按用户要求整条摘除：
// 配置类弹窗只保留「去设置 / 取消」两个按钮，余额类不再弹窗（改设置修不了余额，走内嵌状态行）。
```

即：曾有过 `TOPUP_PAGES` 常量与 `topupUrlOf(baseUrl)` 导出（按 DeepSeek / 百炼 / 智谱 / MiniMax 四家的 Base URL 关键字映射到各自充值页），连同 `FriendlyError.configUrl`、`IpcFail.configUrl`、`ConfigTarget` 的 `'billing'`、`app:open-external` 频道一起在 `909526c` 摘除。**现在配置类弹窗只有 `[去设置]` / `[取消]`**，余额 / 欠费的处置写进文案本身（「请到厂家控制台充值后重试」）。

## 7. 弹窗标题 `configTitle(target)`

| `target` | 标题 |
| --- | --- |
| `'model'` | `需要设置自定义模型` |
| `'voice'` | `需要设置语音服务` |
| 其它 / `undefined` | `需要先完成设置`（实现是 `(target && CONFIG_TITLE[target]) \|\| '需要先完成设置'`） |

只有两条标题（没有余额类）。渲染层也有一份同文案的兜底表（`useConfigPrompt.ts` 的 `FALLBACK_TITLE`），主进程给了 `title` 就用主进程的。

## 8. `configTargetOf(message)` —— 对已翻译文案的二次分类

给「已经翻译过、只剩 message 文本」的上游用（典型：`projects.ts` 捕获 `chatWithCustomModel` 抛出的错，到那里只剩一句中文 message）。它复用同一张码表跑分类、**不重复拼 label**，故不返回 `message`：

```ts
export function configTargetOf(message: string): { needConfig?: ConfigTarget; title?: string }
```

判定依据是**本文件自己产出的句式**（没有数字状态码可判）：

| 顺序 | 文本特征 | `needConfig` |
| --- | --- | --- |
| 1 | `/未启用\|未配置\|配置不完整\|均需填写\|三项都要填/` | `voiceLike`（`/语音\|音色\|合成\|voice\|tts/i`）→ `voice`，否则 `model` |
| 2 | `/API Key 无效\|重新填写并保存\|API Key.*权限/` | 同上分流 |
| 3 | `/Base URL\|接口地址\|模型不存在\|核对模型 ID/` | `model` |

- 都没命中 → 返回 `{}`（调用方 `...configTargetOf(msg)` 展开后等于什么都没加）；
- 命中时用 `configTitle(target)` 生成 `title`；**余额 / 欠费不在判定范围内**（那类不弹窗，界面保持内嵌状态行）；
- **注意**：它的正则依赖 `coreMessage()` 产出的文案措辞——改上面任何一句人话文案，都要回来看这里是否还认得出来。

## 9. 消费方

| 消费方 | 用法 | 备注 |
| --- | --- | --- |
| `src/main/agent/html.ts` | `friendlyError` + `ConfigTarget` | 两处配置校验走 `cfgErr()`（`label: '生成 HTML'`、`baseUrl: m.baseUrl`；未启用带 `hint: 'model-not-enabled'`）；每次尝试的 `catch` 用 `label: '生成 HTML'` + `extras: ['请求地址：' + apiUrl, httpDetail]`，产出 `attemptErr` / `attemptCfg`（`{ needConfig: ConfigTarget } \| null`）/ `attemptDetail` |
| `src/main/settings.ts` | `friendlyError` | `IPC.Settings.Test` 的失败分支：`friendlyError(e, { label: '连接失败', baseUrl: m.baseUrl })`，把 `message` / `detail` / `needConfig` 一起回给界面（渲染层的设置页刻意不弹窗，只显示状态） |
| `src/main/voice/api.ts` | `friendlyError` + `ConfigTarget` | `voiceFriendlyError()` 是薄包装：`friendlyError(err, { label, provider: activeProviderDef().key, baseUrl: activeProviderDef().apiBase })`，再把 `detail` 追加回文案（`f.message + '（' + f.detail + '）'`，保留旧行为让用户能报障）；`voiceNoKeyFail()` 直接产出 `needConfig: 'voice'` |
| `src/main/projects.ts` | 只用 `configTargetOf` | `project:generate-html` / `project:modify-html` 两处 catch：`return { ok: false, message: msg, ...configTargetOf(msg) }` |
| `src/renderer/src/composables/useConfigPrompt.ts` | 间接 | 渲染层**不做判定**，只消费 IPC 回传的 `needConfig` / `title` 弹框（`[去设置]` / `[取消]`） |
| `docs/error-mapping.md` | 设计依据 | 58 条映射清单 + §11.1 弹窗决策；改本文件前先看它 |

## 10. 注意事项与实现要点

- **顺序不可变**：余额 / 欠费必须最先判（百炼是 `400 + Arrearage`，先按状态码会误报成参数错误）；配额耗尽必须排在 `429` 之前；`403` 必须在「参数类」之前。调整顺序等于改用户看到的文案，属于行为变更。
- **余额 / 欠费不弹窗是刻意的**：去设置页修不了余额，因此这一档**不给 `needConfig`**，文案直接说清去处（「请到厂家控制台充值后重试」）。这样「弹窗」与「去设置能修好」严格等价。
- **曾有、已被摘除的东西不要再写进文档**：`topupUrlOf()` / `TOPUP_PAGES` / `FriendlyError.configUrl` / `IpcFail.configUrl` / `ConfigTarget` 的 `'billing'` / `app:open-external` 频道（2026-10 `909526c` 按用户要求摘除，原因：那条「去充值」按钮从未被用户同意过）。源码只保留「曾加过、已摘除」的说明性注释。
- **`needConfig` 的适用范围要与实现严格一致**：只含缺 Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用；**余额 / 欠费不在其中**（源码头注释曾在摘除「去充值」时漏改、把「余额不足」列了进去，2026-10 已修正为显式排除）。
- **`message` 里不许出现技术词**：状态码、`Insufficient Balance`、`ECONNRESET`、`request_id`、厂商 code 一律只进 `detail`。
- **配置类弹窗不显示 `detail`**：这是刻意的（`docs/error-mapping.md` §11.1）——弹窗只有一个决策（去设置 / 取消），多一个折叠区会让决策变模糊。语音链路把 detail 追加进 message 是**旧行为兼容**，不是新约定。
- **`hint` 是唯一的「非报文」输入**：只在调用方已知分类、而文案里没有关键词时使用（如 `'model-not-enabled'`），写 kebab 短标识即可；它不进 message、不进 detail。
- **`configTargetOf` 依赖文案措辞**：它匹配的是本文件产出的中文句式，不是原始报错；改文案必须同步这里的正则。
- **纯函数约束**：不 import electron、不读文件、不发请求、无模块级可变状态；新增档位时保持这一点（渲染层将来若要复用也能直接内联）。

## 11. 相关文档

- 类型真源：[types.ts](./types.ts.md)（① 节的 `ConfigTarget` 与 `IpcFail.needConfig` / `title`）
- 弹窗消费方：`src/renderer/src/composables/useConfigPrompt.ts`（见 [renderer/src/common.md](../renderer/src/common.md)）与 `src/renderer/src/App.vue`（见 [renderer/src/App.vue.md](../renderer/src/App.vue.md)）
- 主进程接入点：[main/agent.md](../main/agent.md)（`chat.ts` 的 `friendlyError` / `cfgErr` 与 `script.ts` 的 `configTargetOf`）、[main/settings.ts.md](../main/settings.ts.md)、[main/voice.md](../main/voice.md)、[main/projects.md](../main/projects.md)
- 设计文档（仓库内，非 wiki）：`docs/error-mapping.md`
