// src/main/account/index.ts
// 账号域装配：5 条 account:* 频道（见 src/shared/ipc.ts）的 handler。
// 分工：api.ts 只发 HTTP；store.ts 只管令牌落盘；本文件把两者拼成「一条登录态」，
// 并处理与环境相关的那点差异（开发模式验证码只在未打包时透给渲染层）。
import { app, ipcMain } from 'electron'
import type {
  AccountLoginPayload,
  AccountRegisterPayload,
  AccountResult,
  AccountSendCodeResult,
  RegisterCtx
} from '../../shared/types'
import { IPC } from '../../shared/ipc'
import * as api from './api'
import * as store from './store'

export function register(_ctx: RegisterCtx): void {
  ipcMain.handle(IPC.Account.SendCode, async (_event, payload?: { email?: unknown }) =>
    handleSendCode(String((payload && payload.email) || ''))
  )
  ipcMain.handle(IPC.Account.Register, async (_event, payload: AccountRegisterPayload) =>
    remember(await api.register(payload))
  )
  ipcMain.handle(IPC.Account.Login, async (_event, payload: AccountLoginPayload) =>
    remember(await api.login(payload))
  )
  ipcMain.handle(IPC.Account.Me, async () => currentSession())
  ipcMain.handle(IPC.Account.Logout, async () => {
    await logout()
  })
}

/** 当前令牌（给将来的云端接口复用：额度 / 项目同步等）。渲染层拿不到它。 */
export function currentToken(): string | null {
  return store.load()?.token ?? null
}

async function handleSendCode(email: string): Promise<AccountSendCodeResult> {
  const result = await api.sendCode(email)
  if (!result.ok) return result
  // 调试码只在开发期（未打包）透给渲染层；打包版把字段去掉，渲染层不必自己做环境判断
  if (app.isPackaged && result.devCode) {
    const { devCode: _devCode, ...rest } = result
    return rest
  }
  return result
}

/** 注册 / 登录成功后：令牌进 safeStorage，渲染层只拿展示字段 */
function remember(outcome: api.ApiOutcome<api.IssuedSession>): AccountResult {
  if (!outcome.ok) return outcome
  const issued = outcome.data
  // 落盘失败不拦登录：本次会话照常可用，只是下次启动需要重新登录（store 内部已 warn）
  store.save({ token: issued.token, expiresAt: issued.expiresAt })
  return { ok: true, session: { user: issued.user, expiresAt: issued.expiresAt } }
}

/** 用已保存的令牌取当前用户；401 清令牌，网络错误保留（断网不能把登录态弄丢） */
async function currentSession(): Promise<AccountResult> {
  const stored = store.load()
  if (!stored) return api.fail('UNAUTHORIZED')

  const outcome = await api.me(stored.token)
  if (!outcome.ok) {
    if (outcome.code === 'UNAUTHORIZED') store.clear()
    return outcome
  }
  return { ok: true, session: { user: outcome.data, expiresAt: stored.expiresAt } }
}

/** 登出：先撤销服务端会话，再清本地（服务端失败也照常清，否则用户会被卡在「登不出去」） */
async function logout(): Promise<void> {
  const stored = store.load()
  if (stored) await api.logout(stored.token)
  store.clear()
}
