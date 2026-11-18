// composables/useAuth.ts —— 登录态的渲染层镜像
//
// 只保存**展示字段**（昵称 / 邮箱 / 过期时间），**不保存令牌**：令牌在主进程的 safeStorage 里
// （见 src/main/account/store.ts），渲染层从头到尾碰不到它。
//
// 三条不变量（与 docs/account-integration.md 一致）：
//  ① 未登录 100% 可用：本文件不 gate 任何页面/功能；
//  ② 登录态失效只影响云端能力：restore() 只在明确 UNAUTHORIZED 时清态；
//  ③ 断网不等于未登录：NETWORK / SERVER 保留上次展示态（离线可用）。
import { computed, reactive } from 'vue'
import { STORAGE_KEY_AUTH } from '@renderer/constants'
import { emailUserName } from '@renderer/utils/localAccount'
import type { AccountSession } from '@shared/types'

export interface AuthState {
  loggedIn: boolean
  /** 登录后的展示名（昵称，空则用邮箱 @ 前部分，再空兜「用户」）；未登录时为空串 */
  userName: string
  /** 登录用的邮箱（规范化小写）；未登录时为空串 */
  email: string
  /** 会话过期时间（毫秒时间戳）；未登录时为 0 */
  expiresAt: number
}

const EMPTY: AuthState = { loggedIn: false, userName: '', email: '', expiresAt: 0 }

// 启动时同步读一次：localStorage 读失败（隐私模式 / 脏数据）一律退回未登录，不让启动路径抛错
function readState(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH)
    if (!raw) return { ...EMPTY }
    const saved = JSON.parse(raw) as Partial<AuthState>
    if (!saved || saved.loggedIn !== true) return { ...EMPTY }
    return {
      loggedIn: true,
      userName: typeof saved.userName === 'string' ? saved.userName : '',
      email: typeof saved.email === 'string' ? saved.email : '',
      expiresAt: typeof saved.expiresAt === 'number' ? saved.expiresAt : 0
    }
  } catch {
    // 脏数据按未登录处理
    return { ...EMPTY }
  }
}

// 模块级 reactive 单例：与 useAppStore / useSettingsDialog 同一套写法（无 Pinia）
export const authState = reactive<AuthState>(readState())

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_AUTH,
      JSON.stringify({
        loggedIn: authState.loggedIn,
        userName: authState.userName,
        email: authState.email,
        expiresAt: authState.expiresAt
      })
    )
  } catch {
    // 配额满 / 不可写时只丢持久化，不阻断当前会话
  }
}

export const isLoggedIn = computed(() => authState.loggedIn)
/** 登录后的展示名（已登录兜底「用户」；未登录为空串） */
export const authUserName = computed(() => (authState.loggedIn ? authState.userName || '用户' : ''))
/** 登录后的邮箱（未登录为空串），用户区悬停提示用 */
export const authUserEmail = computed(() => (authState.loggedIn ? authState.email : ''))

/** 展示名：优先用后端昵称，其次邮箱 @ 前部分 */
function displayNameOf(session: AccountSession): string {
  const nickname = (session.user.nickname || '').trim()
  return nickname || emailUserName(session.user.email) || '用户'
}

/**
 * 写入登录态：注册成功与登录成功都走这里。
 * 令牌不在这里——它已经在主进程的 safeStorage 里了。
 */
export function signIn(session: AccountSession): void {
  authState.loggedIn = true
  authState.userName = displayNameOf(session)
  authState.email = session.user.email || ''
  authState.expiresAt = session.expiresAt || 0
  persist()
}

function clearState(): void {
  authState.loggedIn = false
  authState.userName = ''
  authState.email = ''
  authState.expiresAt = 0
  persist()
}

/** 退出登录：先让主进程撤销服务端会话并清掉令牌，再清本地展示态 */
export async function logout(): Promise<void> {
  try {
    await window.accountTools.logout()
  } catch (error) {
    // 主进程异常也要把界面切回未登录，否则用户点了没反应
    console.warn('[auth] 退出登录失败：', String(error instanceof Error ? error.message : error))
  }
  clearState()
}

/**
 * 启动时校验登录态：让主进程带令牌问一次 /me。
 * <p>只有明确「未授权」才清态；网络错误 / 服务端 5xx 一律保留（离线可用）。</p>
 */
export async function restore(): Promise<void> {
  if (!authState.loggedIn) return
  try {
    const result = await window.accountTools.me()
    if (result.ok) {
      signIn(result.session)
      return
    }
    if (result.code === 'UNAUTHORIZED') clearState()
  } catch (error) {
    // IPC 出错按网络问题处理：保留现状，不清登录态
    console.warn('[auth] 校验登录态失败：', String(error instanceof Error ? error.message : error))
  }
}
