// src/main/account/store.ts
// 登录令牌的本地持久化：safeStorage 加密后写 userData/account.bin。
//
// 三条约定：
//   ① **令牌只存在主进程**：渲染层永远拿不到它（IPC 返回的是 AccountSession，不含 token）；
//   ② 用 Electron 的 safeStorage（Windows = DPAPI / macOS = 钥匙串）加密，不写明文；
//   ③ safeStorage 不可用时**只存内存**，绝不降级成明文落盘——代价是下次启动要重新登录，
//      这个代价远小于「令牌明文躺在 %APPDATA% 里」。
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 落盘结构（也是内存结构）：令牌 + 过期时间戳（毫秒） */
export interface StoredSession {
  token: string
  expiresAt: number
}

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'account.bin')
}

// 内存缓存：命中后不再读盘；进程重启即失效（这正是持久化要解决的问题）
let memory: StoredSession | null = null
let loaded = false

function isValid(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<StoredSession>
  return typeof session.token === 'string' && session.token.length > 0 && typeof session.expiresAt === 'number'
}

/**
 * 读取已保存的会话。
 * 任何异常（文件不存在 / 解密失败 / 脏数据）一律当「未登录」，不抛错——启动路径不能被它拖垮。
 */
export function load(): StoredSession | null {
  if (loaded && memory) return memory
  if (loaded && !memory) return null
  loaded = true

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[account] safeStorage 不可用，登录态只保留在本次运行中（不落盘）')
      return null
    }
    const encrypted = fs.readFileSync(sessionFile())
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted))
    if (!isValid(parsed)) {
      clear()
      return null
    }
    if (parsed.expiresAt <= Date.now()) {
      // 自然过期：清掉，避免下次启动又解一次
      clear()
      return null
    }
    memory = parsed
    return memory
  } catch {
    return null
  }
}

/**
 * 保存会话。
 *
 * @returns 是否**持久化成功**（false 表示只留在内存里，下次启动需要重新登录）
 */
export function save(session: StoredSession): boolean {
  memory = session
  loaded = true
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[account] safeStorage 不可用，登录态只保留在本次运行中')
      return false
    }
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true })
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(session)))
    return true
  } catch (error) {
    console.warn('[account] 保存登录态失败：', String(error instanceof Error ? error.message : error))
    return false
  }
}

/** 清除会话：内存 + 磁盘（文件不存在也不报错） */
export function clear(): void {
  memory = null
  loaded = true
  try {
    fs.rmSync(sessionFile(), { force: true })
  } catch {
    // 删不掉也不影响：内存已经清了，下次启动解密失败同样当未登录
  }
}
