// src/shared/errors.ts —— 全应用的「原始报错 → 人话文案」唯一映射表（纯函数，无副作用）
//
// 为什么要有它：外部服务（自定义模型 / 语音服务）与本机文件系统抛出来的都是英文原文
// （`402 Insufficient Balance`、`HTTP 422：{"error":…}`、`ENOENT` …），直接透传给终端用户既看不懂、
// 也不知道该去哪修。三条硬约定：
//   ① message 只说人话：发生了什么 + 你能做什么；**不许出现** HTTP 状态码、`Insufficient Balance`、
//      `ECONNRESET`、`request_id`、厂商 code 这类只有排障时才需要的词。
//   ② detail 存排障信息（原始报文首行，截断 500 字符），由调用方落日志；**配置类弹窗不显示它**
//      （见 docs/error-mapping.md §11.1：弹窗只有「去设置」/「取消」一个决策，不放折叠区）。
//   ③ needConfig 只标「用户去设置页改配置就能解决」的错误（缺 Key / Key 无效 / 配置不完整 /
//      Base URL 填错 / 未启用）。界面据此把错误升级成弹窗；**其余一律走内嵌状态行**。
//      **余额 / 欠费刻意不在其中**（见 ①）：去设置改不了余额，弹一个只能点「取消」的框没有意义。
//
// 完整映射清单（58 条、含官方码表来源）见 docs/error-mapping.md，改这里之前先看那份文档。
// 与 updater.ts 的 `humanError()` 是同一分层约定（message 说人话 / detail 给排障），
// 区别是 updater 只管自更新一条链路、且要抠出请求 URL，故仍留在原处不合并。
import type { ConfigTarget } from './types'

export interface FriendlyError {
  /** 面向用户的中文文案（已含动作前缀，如「生成 HTML 失败：账户余额不足…」） */
  message: string
  /** 排障详情：原始报文首行（截断 500 字符）；没有可留的东西时为 undefined */
  detail?: string
  /**
   * 命中「需要用户去设置页改配置」时给出目标设置分类，界面据此弹「去设置 / 取消」。
   * **余额 / 欠费类刻意不在此列**：去设置改不了余额，它走内嵌状态行（文案已说明去厂家充值）。
   */
  needConfig?: ConfigTarget
}

// 调用上下文：label 是动作名（拼在 message 最前面，用户得知道是哪件事失败了）
export interface ErrorContext {
  label: string
  /** 已解析出的厂家 key（如 qwen） */
  provider?: string
  /** 本次请求的 Base URL（排障详情用；也曾用于给余额类找充值页，该按钮已按用户要求摘除） */
  baseUrl?: string
  /** 附加到详情里的字段（原始 code / HTTP 状态 / 请求地址），比从文案里正则抠更可靠 */
  extras?: string[]
  /**
   * 分类提示：调用方已经知道的事实，但**原文案里没有关键词**（故正则匹配不到）。
   * 例：配置项 enabled=false 抛出的「自定义模型未启用」——这句里没有「400」「api key」，
   * 单靠文案无法定位到「未启用」档。写成 kebab 短标识（如 'model-not-enabled'）即可被码表匹配。
   * 只参与匹配，不进 message、也不进 detail。
   */
  hint?: string
}

// 模型厂家充值页（余额 / 欠费类的「去充值」目标）已按用户要求整条摘除：
// 配置类弹窗只保留「去设置 / 取消」两个按钮，余额类不再弹窗（改设置修不了余额，走内嵌状态行）。

// ===== 从异常对象里取字段（兼容 OpenAI SDK 的 APIError 与自造的 Error）=====
// OpenAI SDK 的 APIError 带 status / code；自造的 Error 则把这些写进了 message（如 'HTTP 402：…'）。
// 两者都要认：先取结构化字段，没有再退回正则。
function rawMessage(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  const e = err as { message?: unknown; code?: unknown; status?: unknown; error?: unknown }
  const parts: string[] = []
  if (e.message) parts.push(String(e.message))
  if (e.error && typeof e.error === 'object') {
    const inner = e.error as { message?: unknown; code?: unknown }
    if (inner.message) parts.push(String(inner.message))
    if (inner.code) parts.push(String(inner.code))
  }
  return parts.length ? parts.join(' ') : String(err)
}
function statusOf(err: unknown): number {
  const s = Number((err as { status?: unknown } | null)?.status)
  return Number.isFinite(s) ? s : 0
}
function codeOf(err: unknown): string {
  const c = (err as { code?: unknown } | null)?.code
  return c == null ? '' : String(c)
}

/** 把「结构化的 message 字段 + 调用方给的分类提示」统一成一段可正则匹配的文本 */
function matchText(err: unknown, hint?: string): string {
  const st = statusOf(err)
  const code = codeOf(err)
  return [hint, code, st ? String(st) : '', rawMessage(err)].filter(Boolean).join(' ')
}

/** 排障详情：原始报文首行，截断 500 字符（与 updater.humanError 同一口径，只是阈值放宽） */
function detailOf(text: string, extras?: string[]): string | undefined {
  const first = String(text || '').trim().split('\n')[0].slice(0, 500)
  const extra = (extras || []).filter(Boolean).join('；')
  if (!first && !extra) return undefined
  return (first ? '原始报错：' + first : '') + (extra ? (first ? '；' : '') + extra : '')
}

// ===== 表：按「配置类优先 → 状态码 → 网络 → 文件系统」的顺序匹配，顺序不可变 =====
// 顺序为什么重要：余额类错误在不同厂家的状态码不一致（DeepSeek 是 402、百炼是 400 + Arrearage），
// 若先按状态码判就会把「欠费」误报成「参数错误」；同理 403 的报错里常带请求 URL，先判 too many 之类会跑偏。
export function friendlyError(err: unknown, ctx: ErrorContext): FriendlyError {
  const label = (ctx && ctx.label) || '操作'
  const core = coreMessage(err, { ...ctx, label })
  return { ...core, message: label + '：' + core.message }
}

// 核心映射（不带动作前缀）：friendlyError 与 configTargetOf 共用，避免两套码表漂移
function coreMessage(err: unknown, ctx: ErrorContext): FriendlyError {
  const text = matchText(err, ctx && ctx.hint)
  const detail = detailOf(text, ctx && ctx.extras)
  const hit = (message: string, needConfig?: ConfigTarget): FriendlyError =>
    ({ message, detail, needConfig })

  // ---------- ① 余额 / 欠费（**不弹窗**：去设置改不了余额，文案直接说清要充值）----------
  // DeepSeek：402 Insufficient Balance；百炼：400 + Arrearage / isv.OUT_OF_SERVICE。
  // 必须排在参数类之前：两家的状态码不一致（402 vs 400），先按状态码判会把欠费误报成「参数错误」。
  if (statusOf(err) === 402 || /insufficient[\s_-]*balance|arrearage|out_of_service|out of credits|欠费|余额不足|in good standing/i.test(text)) {
    return hit('账户余额不足或已欠费，请到厂家控制台充值后重试')
  }
  // ---------- ② 配置类：未启用 / 未配置 / 缺字段 / Key 无效 ----------
  // 「未启用」必须独立成档（它提到要用「设置」里的开关，与「字段没填」是两种修法）。
  if (/model-not-enabled|not enabled|未启用/i.test(text)) {
    return hit('自定义模型未启用，请到「设置」打开开关', 'model')
  }
  // 音色类接口未配置 Key（DashScope）：文案形如「未配置「千问」的 API Key，请先到「设置」-「语音服务」…」，
  // 厂家名就在句子里，抠出来复用，比给一句通用的「未配置语音服务」更有用。
  const noKeyVoice = text.match(/未配置\s*[「"']?([^」"'：:]{1,20})[」"']?\s*的?\s*(API[ _-]?Key|密钥)/i)
  if (noKeyVoice) {
    return hit('未配置「' + noKeyVoice[1] + '」的 API Key，请到「设置 → 语音服务」填写并保存', 'voice')
  }
  if (/配置不完整|均需填写|三项都要填|缺少|not configured|api key is required|no api key/i.test(text) && !statusOf(err)) {
    return hit('模型未配置完整，请到设置页填写 Base URL / Model ID / API Key', 'model')
  }
  // 其余「未配置 / 请填写」类：语音侧指向语音服务，模型侧指向自定义模型
  if (/未配置|请填写|not configured|api key is required/i.test(text)) {
    return /语音|音色|合成|voice|tts/i.test(text)
      ? hit('未配置语音服务的 API Key，请到「设置 → 语音服务」填写并保存', 'voice')
      : hit('模型未配置完整，请到设置页填写 Base URL / Model ID / API Key', 'model')
  }
  // 鉴权：401 / invalid_api_key / InvalidApiKey；403 权限被拒（语义不同，文案也分开）
  if (statusOf(err) === 401 || /\binvalid[_\s-]*api[_\s-]*key\b|invalidapikey|authentication|unauthorized|\b401\b/i.test(text)) {
    return hit('API Key 无效，请到「设置」重新填写并保存', cfgTargetOf(ctx))
  }
  if (statusOf(err) === 403 || /permission[_ ]denied|forbidden|accessdenied|无权限/i.test(text)) {
    return hit('该 API Key 没有调用此模型的权限，请核对模型或厂家控制台', cfgTargetOf(ctx))
  }
  // Base URL 填成网页地址 / 漏了 /v1：404 或 405，文案指向地址本身
  if (statusOf(err) === 404 || statusOf(err) === 405 || /not found|unsupported method/i.test(text)) {
    if (/chat\/completions|\/v1|base ?url/i.test(text + ' ' + (ctx.extras || []).join(' '))) {
      return hit('Base URL 可能填错了：请填写以 /v1 结尾的接口地址（不是网页地址）', 'model')
    }
    return hit('模型不存在：请核对设置页的模型 ID', 'model')
  }
  // ---------- ③ 限流（可重试，不弹窗）----------
  // 配额耗尽（等再久也不恢复）必须排在限流前面：两者的 code 可能同为 429。
  if (/allocationquota|insufficient[_ ]?quota|allocated quota|quota exceeded|额度已用完/i.test(text)) {
    return hit('本周期额度已用完，请等下个周期或升级套餐')
  }
  if (statusOf(err) === 429 || /throttl|rate[_ ]?limit|limit_requests|limit_burst_rate|too many requests|\b429\b/i.test(text)) {
    return hit('请求过于频繁，稍等片刻再试')
  }
  // ---------- ④ 服务端 / 网关（可重试，不弹窗）----------
  if (statusOf(err) >= 500 || /internalerror|server error|service unavailable|overloaded|bad gateway|timeout/i.test(text)) {
    return hit('模型服务暂时不可用，请稍后重试')
  }
  // ---------- ⑤ 内容合规（改内容重试，不弹窗）----------
  if (/datainspectionfailed|data_inspection_failed|inappropriate content|敏感/i.test(text)) {
    return hit('内容未通过服务端合规检查，请修改字幕或素材后重试')
  }
  // ---------- ⑥ 参数类（不弹窗）----------
  if (statusOf(err) === 400 || statusOf(err) === 422 || /invalid[_\s-]*(request|parameter|value)|model not exist/i.test(text)) {
    // 模型 ID 写错在两家都是 400/422（DeepSeek 无 404），只能靠报文字符串二次判定
    if (/model not exist|model[_ ]not[_ ]found|invalid model/i.test(text)) {
      return hit('模型不存在：请到「设置」核对模型 ID', cfgTargetOf(ctx))
    }
    return hit('请求参数不被服务端接受，请检查模型 ID 与参数设置', cfgTargetOf(ctx))
  }
  // ---------- ⑦ 网络（不弹窗）----------
  if (/enotfound|eai_again|getaddrinfo|dns/i.test(text)) {
    return hit('无法解析服务器地址，请检查网络与 Base URL 拼写')
  }
  if (/econnrefused|econnreset|epipe|socket hang up|proxy/i.test(text)) {
    return hit('连接被拒绝或中断，请检查网络（代理 / VPN / 防火墙）后重试')
  }
  if (/etimedout|timed? ?out|und_err_connect_timeout/i.test(text)) {
    return hit('连接超时：网络不通或服务无响应，请稍后重试')
  }
  if (/cert_|unable_to_verify|self[- ]signed/i.test(text)) {
    return hit('证书校验失败：可能是代理或抓包工具拦截了 HTTPS')
  }
  // ---------- ⑧ 文件系统 / 子进程（不弹窗）----------
  if (/enospc|no space left/i.test(text)) return hit('磁盘空间不足，请清理后重试')
  if (/ero?s?fs|read[- ]only file system/i.test(text)) return hit('目标位置不可写入，请更换保存目录')
  if (/ebusy|resource busy|being used by another process/i.test(text)) return hit('文件正被其它程序占用，请关闭后重试')
  if (/eacces|eperm|access is denied|permission denied/i.test(text)) {
    return hit('没有权限访问该文件：可能被其它程序占用，或需要以管理员身份运行')
  }
  if (/enoent|not exist|no such file/i.test(text)) return hit('文件不存在或已被移动')
  if (/aborted|err_aborted|cancell?ed|已取消/i.test(text)) return hit('已取消')
  // ---------- ⑨ 兜底 ----------
  return hit('失败，请重试')
}

// 语音类错误（label 含「语音 / 音色」）指向「语音服务」分类，模型类指向「自定义模型」
function cfgTargetOf(ctx: ErrorContext): ConfigTarget {
  return /语音|音色|合成/.test((ctx && ctx.label) || '') ? 'voice' : 'model'
}

// 配置类弹窗的标题（由主进程随 IPC 一起给，渲染层只显示不判断）
const CONFIG_TITLE: Record<ConfigTarget, string> = {
  model: '需要设置自定义模型',
  voice: '需要设置语音服务'
}
export function configTitle(target?: ConfigTarget): string {
  return (target && CONFIG_TITLE[target]) || '需要先完成设置'
}

// 给「已经翻译过、只剩 message 文本」的上游用（典型：projects/ 捕获 chatWithCustomModel 抛出的错，
// 到那里只剩一句中文 message）。复用同一张码表跑分类，不重复拼 label，故不返回 message。
// 判定文本是**中文文案**（没有数字状态码可判），所以按本文件产出的句式逐条认。
// **余额 / 欠费不在其中**：那类不弹窗，界面保持内嵌状态行。
export function configTargetOf(message: string): { needConfig?: ConfigTarget; title?: string } {
  const text = String(message || '')
  let target: ConfigTarget | undefined
  const voiceLike = /语音|音色|合成|voice|tts/i.test(text)
  if (/未启用|未配置|配置不完整|均需填写|三项都要填/.test(text)) target = voiceLike ? 'voice' : 'model'
  else if (/API Key 无效|重新填写并保存|API Key.*权限/.test(text)) target = voiceLike ? 'voice' : 'model'
  else if (/Base URL|接口地址|模型不存在|核对模型 ID/.test(text)) target = 'model'
  if (!target) return {}
  return { needConfig: target, title: configTitle(target) }
}
