// src/main/account/api.ts
// 账号后端 HTTP 客户端：只做「发请求 → 解包 ApiResponse → 映射成 AccountResult」。
//
// 为什么在主进程而不是渲染层：
//   ① 渲染层的 CSP 是 connect-src 'self'（见 src/renderer/index.html），直连后端会被浏览器拦掉；
//   ② 打包后页面 Origin 是 file://，后端 CORS 只放 http://localhost:*，直连也过不了预检；
//   ③ 令牌不该交给渲染层（XSS 拿不到它，也就偷不走会话）。
//
// 后端地址：环境变量 SHADOWMILL_API_BASE → 缺省 http://127.0.0.1:8080（本地后端）。
// 设置页里加输入框是后续的事，见 docs/account-integration.md §6。
import type {
  AccountErrorCode,
  AccountFail,
  AccountLoginPayload,
  AccountRegisterPayload,
  AccountSendCodeOk,
  AccountSendCodeResult,
  AccountUser
} from '../../shared/types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080'
const REQUEST_TIMEOUT_MS = 10_000

/** 后端地址（去掉末尾斜杠，避免拼出 //api/auth） */
export function apiBaseUrl(): string {
  const fromEnv = (process.env['SHADOWMILL_API_BASE'] || '').trim()
  return (fromEnv || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/** 后端统一响应体（ApiResponse） */
interface Envelope {
  success?: boolean
  code?: string
  message?: string
  data?: unknown
}

/** 后端签发的会话（含令牌）：只在本进程内流转，绝不跨 IPC */
export interface IssuedSession {
  token: string
  expiresAt: number
  user: AccountUser
}

export type ApiOutcome<T> = { ok: true; data: T } | AccountFail

/** 错误码 → 兜底文案。后端给了 message 就用后端的（它更具体），这里只在没有时兜底。 */
const FALLBACK_MESSAGE: Record<AccountErrorCode, string> = {
  INVALID_EMAIL: '邮箱格式不正确，例如 name@example.com',
  WEAK_PASSWORD: '密码至少 8 位，且不能包含空格',
  EMAIL_TAKEN: '该邮箱已注册，请直接登录',
  ACCOUNT_NOT_FOUND: '该邮箱尚未注册，请先注册',
  WRONG_PASSWORD: '邮箱或密码错误',
  CODE_INVALID: '验证码不正确',
  CODE_EXPIRED: '验证码已过期，请重新获取',
  CODE_TOO_MANY: '验证码错误次数过多，请重新获取',
  CODE_COOLDOWN: '发送太频繁，请稍后再试',
  BAD_REQUEST: '填写内容不符合要求，请检查后重试',
  UNAUTHORIZED: '登录已过期，请重新登录',
  NETWORK: '无法连接账号服务器，请检查网络后重试',
  SERVER: '账号服务暂时不可用，请稍后重试',
  STORAGE_FAILED: '无法保存登录状态，请检查磁盘权限'
}

/** 造一个失败结果（文案缺省时用码表兜底） */
export function fail(code: AccountErrorCode, message?: string): AccountFail {
  const text = (message || '').trim()
  return { ok: false, code, message: text || FALLBACK_MESSAGE[code] }
}

/** 后端业务码 → 客户端错误码（同名直通；其余按 HTTP 状态兜底） */
const SERVER_CODE_MAP: Record<string, AccountErrorCode> = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  CODE_INVALID: 'CODE_INVALID',
  CODE_EXPIRED: 'CODE_EXPIRED',
  CODE_TOO_MANY: 'CODE_TOO_MANY',
  CODE_COOLDOWN: 'CODE_COOLDOWN',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED'
}

function mapCode(status: number, envelope: Envelope | null, fallback: AccountErrorCode): AccountErrorCode {
  const fromBody = envelope && envelope.code ? SERVER_CODE_MAP[envelope.code] : undefined
  if (fromBody) return fromBody
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 409) return 'EMAIL_TAKEN'
  if (status === 429) return 'CODE_COOLDOWN'
  if (status === 400 || status === 422) return 'BAD_REQUEST'
  return fallback
}

/** 设备标识：只用于后端「设备管理」的展示，取不到也不影响登录 */
function deviceName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return process.platform
}

async function request<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; token?: string }
): Promise<ApiOutcome<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Name': deviceName()
  }
  if (init.token) headers['Authorization'] = 'Bearer ' + init.token

  let response: Response
  try {
    response = await fetch(apiBaseUrl() + path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    // 连不上 / DNS 失败 / 超时：对用户而言都是「网络不通」，不细分
    console.warn('[account] 请求失败：', path, String(error instanceof Error ? error.message : error))
    return fail('NETWORK')
  }

  const text = await response.text().catch(() => '')
  let envelope: Envelope | null = null
  if (text) {
    try {
      envelope = JSON.parse(text) as Envelope
    } catch {
      envelope = null
    }
  }

  if (response.ok && (!envelope || envelope.success !== false)) {
    return { ok: true, data: (envelope ? envelope.data : null) as T }
  }
  const code = mapCode(response.status, envelope, 'SERVER')
  return fail(code, envelope?.message ?? undefined)
}

/** 后端 AuthResponse（token / tokenType / expiresInSeconds / user） */
interface ServerAuthData {
  token?: unknown
  tokenType?: unknown
  expiresInSeconds?: unknown
  user?: Partial<AccountUser> | null
}

function toIssuedSession(outcome: ApiOutcome<ServerAuthData>): ApiOutcome<IssuedSession> {
  if (!outcome.ok) return outcome
  const data = outcome.data
  if (!data || typeof data.token !== 'string' || !data.user) {
    // 形状不对说明两端契约漂移了：如实报错，不要假装登录成功
    return fail('SERVER', '账号服务返回的数据不完整，请稍后重试')
  }
  const user: AccountUser = {
    id: Number(data.user.id) || 0,
    email: String(data.user.email || ''),
    nickname: String(data.user.nickname || ''),
    createdAt: String(data.user.createdAt || '')
  }
  const seconds = Math.max(0, Number(data.expiresInSeconds) || 0)
  return { ok: true, data: { token: data.token, expiresAt: Date.now() + seconds * 1000, user } }
}

/** 发送注册验证码 */
export async function sendCode(email: string): Promise<AccountSendCodeResult> {
  const outcome = await request<{
    expiresInSeconds?: unknown
    resendAfterSeconds?: unknown
    debugCode?: unknown
  }>('/api/auth/send-code', { method: 'POST', body: { email } })
  if (!outcome.ok) return outcome

  const result: AccountSendCodeOk = {
    ok: true,
    expiresInSeconds: Math.max(0, Number(outcome.data?.expiresInSeconds) || 0),
    resendAfterSeconds: Math.max(0, Number(outcome.data?.resendAfterSeconds) || 0)
  }
  if (outcome.data && typeof outcome.data.debugCode === 'string' && outcome.data.debugCode) {
    result.devCode = outcome.data.debugCode
  }
  return result
}

/** 注册（需邮箱验证码） */
export async function register(payload: AccountRegisterPayload): Promise<ApiOutcome<IssuedSession>> {
  return toIssuedSession(await request<ServerAuthData>('/api/auth/register', { method: 'POST', body: payload }))
}

/** 登录 */
export async function login(payload: AccountLoginPayload): Promise<ApiOutcome<IssuedSession>> {
  const outcome = toIssuedSession(await request<ServerAuthData>('/api/auth/login', { method: 'POST', body: payload }))
  if (!outcome.ok && outcome.code === 'UNAUTHORIZED') {
    // 登录页的 401 是「邮箱或密码错误」，不是「登录已过期」——同一个业务码，语境不同
    return fail('WRONG_PASSWORD', outcome.message)
  }
  return outcome
}

/** 取当前用户（令牌由调用方从 store 取出传入） */
export async function me(token: string): Promise<ApiOutcome<AccountUser>> {
  const outcome = await request<Partial<AccountUser>>('/api/auth/me', { method: 'GET', token })
  if (!outcome.ok) return outcome
  const data = outcome.data
  if (!data) return fail('SERVER', '账号服务返回的数据不完整，请稍后重试')
  return {
    ok: true,
    data: {
      id: Number(data.id) || 0,
      email: String(data.email || ''),
      nickname: String(data.nickname || ''),
      createdAt: String(data.createdAt || '')
    }
  }
}

/** 撤销服务端会话（失败也不影响本地清理，调用方照常清令牌） */
export async function logout(token: string): Promise<AccountFail | null> {
  const outcome = await request<null>('/api/auth/logout', { method: 'POST', token })
  return outcome.ok ? null : outcome
}
