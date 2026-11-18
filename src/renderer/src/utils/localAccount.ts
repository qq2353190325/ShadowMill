// utils/localAccount.ts —— 账号的「渲染层半边」：纯前端校验 + 调 IPC。
//
// 真正的请求与令牌都在主进程（src/main/account/）：渲染层拿不到 token，也不直接连后端
// （CSP 的 connect-src 是 'self'，打包后页面 Origin 是 file://，直连会被拦）。
// 本文件只保留三件事：① 邮箱 / 密码的纯校验与强度提示；② accountApi 的薄封装；③ 展示名推导。
//
// 历史：这里曾是**本地占位实现**（localStorage 账号表 + djb2 摘要），已按
// docs/account-integration.md 换成真实后端；账号表与摘要函数一并删除。
import type {
  AccountErrorCode,
  AccountLoginPayload,
  AccountRegisterPayload,
  AccountResult,
  AccountSendCodeResult
} from '@shared/types'

export type { AccountErrorCode, AccountResult, AccountSendCodeResult }

/** 邮箱格式：不追求 RFC 5322 全覆盖，只挡明显错误（无 @、无域名点、域名尾点是连字符等） */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
const EMAIL_MAX = 254
const PASSWORD_MIN = 8
const PASSWORD_MAX = 64

/** 规范化邮箱：去首尾空格 + 统一小写（避免 A@x.com 与 a@x.com 被当成两个账号） */
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase()
}

/** 邮箱校验：返回错误文案，通过返回 null */
export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email)
  if (!value) return '请输入邮箱'
  if (value.length > EMAIL_MAX) return `邮箱过长（最多 ${EMAIL_MAX} 个字符）`
  if (!EMAIL_RE.test(value)) return '邮箱格式不正确，例如 name@example.com'
  const [local, domain] = value.split('@')
  if (local.length > 64) return '邮箱 @ 前部分过长'
  if (domain.startsWith('-') || domain.endsWith('-')) return '邮箱域名不正确'
  return null
}

/** 密码校验（硬规则只有长度与空白；强度只做提示，不拦截，免得把用户挡在门外） */
export function validatePassword(password: string): string | null {
  if (!password) return '请输入密码'
  if (/\s/.test(password)) return '密码不能包含空格'
  if (password.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  if (password.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位`
  return null
}

export type PasswordLevel = 'weak' | 'medium' | 'strong'

export interface PasswordStrength {
  /** 0~4，越长越强；仅用于画强度条 */
  score: number
  level: PasswordLevel
  label: string
  /** 还差什么，给用户一句可执行的建议 */
  tip: string
}

/**
 * 密码强度：长度、大小写混合、数字、符号 + "够长"加成，四项各 1 分。
 * 只提示不拦截（长度不足由 validatePassword 单独挡），所以这里不做失败分支。
 */
export function passwordStrength(password: string): PasswordStrength {
  const pwd = password || ''
  let score = 0
  if (pwd.length >= PASSWORD_MIN) score++
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++
  if (/\d/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 12) score++

  if (!pwd) return { score: 0, level: 'weak', label: '未输入', tip: `至少 ${PASSWORD_MIN} 位，建议混合大小写、数字与符号` }
  if (score <= 1) return { score, level: 'weak', label: '弱', tip: '建议混合大小写字母、数字或符号' }
  if (score <= 2) return { score, level: 'medium', label: '中', tip: '再加数字或符号会更安全' }
  return { score, level: 'strong', label: '强', tip: '' }
}

/** 展示名：取邮箱 @ 前部分；空邮箱兜底空串，由 authUserName 统一兜「用户」 */
export function emailUserName(email: string): string {
  const value = normalizeEmail(email)
  const at = value.indexOf('@')
  return at > 0 ? value.slice(0, at) : value
}

/**
 * 账号接口（渲染层唯一入口）。所有方法都走主进程：
 * 主进程负责 HTTP、错误码映射与令牌落盘，这里只做参数归一化。
 */
export const accountApi = {
  /** 发送注册验证码：冷却与有效期以后端返回为准 */
  sendCode(email: string): Promise<AccountSendCodeResult> {
    return window.accountTools.sendCode(normalizeEmail(email))
  },

  /** 注册：邮箱 + 密码 + 邮箱验证码（昵称可选，后端为空时取邮箱 @ 前部分） */
  register(input: AccountRegisterPayload): Promise<AccountResult> {
    return window.accountTools.register({
      email: normalizeEmail(input.email),
      password: input.password,
      code: (input.code || '').trim(),
      nickname: input.nickname
    })
  },

  /** 登录：邮箱 + 密码 */
  login(input: AccountLoginPayload): Promise<AccountResult> {
    return window.accountTools.login({ email: normalizeEmail(input.email), password: input.password })
  }
}
