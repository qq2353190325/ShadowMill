// src/main/updater/actions.ts —— 对外动作：检查 / 下载 / 取消（更新源覆盖也在这一层）
// 依赖方向：index → install → actions → base，本文件只 import ./base 与 ../settings。
import type { UpdateCheckResult } from '../../shared/types'
import { saveUpdaterSettings, getUpdaterSettings } from '../settings'
import { app } from 'electron'
import { state, flags, ensureUpdater, getUpdaterLoadError, appVersion, writeLog, msg, setError, humanError, send, errText, type UpdaterLike } from './base'

// 模块没加载起来时给用户的说法：加载失败的技术原因（依赖没打包等）只留在 detail
export function notReady(): { ok: false; message: string; detail: string } {
  return {
    ok: false,
    message: '更新模块不可用，请重新安装应用',
    detail: getUpdaterLoadError() || 'electron-updater 未加载'
  }
}

// ===== 更新源配置：feedUrl 非空即覆盖打包时写死的地址 =====
function applyFeedUrl(u: UpdaterLike): string {
  const feedUrl = (getUpdaterSettings().feedUrl || '').trim()
  if (!feedUrl) return ''
  try {
    u.setFeedURL({ provider: 'generic', url: feedUrl })
    return feedUrl
  } catch (e) {
    writeLog('setFeedURL 失败: ' + errText(e))
    return ''
  }
}

// 检查更新：不做「已跳过」的提前 return，仍走真实检查（用户可能在设置页手动点），
// 只是把 stage 标为 skipped 让 UI 显示「已跳过该版本」。
export async function checkNow(trigger: 'manual' | 'startup'): Promise<any> {
  const u = ensureUpdater()
  if (!u) return notReady()
  state.currentVersion = appVersion()
  const feedUrl = applyFeedUrl(u)
  state.stage = 'checking'
  state.message = '正在检查更新…'
  state.error = undefined
  state.detail = ''
  send('check start trigger=' + trigger + ' feed=' + (feedUrl || '(app-update.yml)'))
  try {
    await u.checkForUpdates()
  } catch (e) {
    // 事件回调与 Promise reject 会各报一次，这里只在还未进入 error 态时补一次
    if (state.stage !== 'error') {
      setError(msg(e))
      send('check failed ' + msg(e))
    }
    return { ok: false, message: state.error || humanError(msg(e)).message, detail: state.detail, currentVersion: appVersion() }
  }
  // 【不许把「检查中」当成结果】还停在 checking ⇒ 全程没有任何事件 ⇒ electron-updater 静默放弃了
  // （未打包且未强制 dev 配置时 return null；或已有检查在飞时复用旧 Promise）。
  // 这时报成功会把上面刚写下的「正在检查更新…」当成终态送到界面，卡片就永远停在那一句。
  if (state.stage === 'checking') {
    const dev = !app.isPackaged
    state.stage = 'error'
    state.error = dev ? '开发环境不检查更新' : '检查更新失败，请稍后重试'
    state.message = state.error
    state.detail = (dev
      ? '当前是未打包的开发环境：electron-updater 在 app.isPackaged 为假时不会发起检查（需在项目根放 dev-app-update.yml 强制开启）。'
      : '更新模块没有返回任何结果。') + '原始信息：checkForUpdates() 未发出任何事件（返回 null 或复用了进行中的检查）。'
    send('check declined trigger=' + trigger + ' packaged=' + app.isPackaged)
    return { ok: false, message: state.error, detail: state.detail, currentVersion: appVersion() }
  }
  // 状态文案由主进程单点产出（见 base.ts 的 bindEvents），这里把当前态原样回带，渲染层不再拼串
  if (state.stage === 'available') {
    return { ok: true, state: 'available', version: state.version, currentVersion: appVersion(), message: state.message, detail: state.detail } as UpdateCheckResult & { ok: true }
  }
  if (state.stage === 'skipped') {
    return { ok: true, state: 'skipped', version: state.version, currentVersion: appVersion(), message: state.message, detail: state.detail } as UpdateCheckResult & { ok: true }
  }
  if (state.stage === 'error') {
    return { ok: false, message: state.error || '检查更新失败', detail: state.detail, currentVersion: appVersion() }
  }
  return { ok: true, state: 'none', version: '', currentVersion: appVersion(), message: state.message, detail: state.detail } as UpdateCheckResult & { ok: true }
}

// 下载更新：用户点「下载」才走这里（autoDownload = false）
export async function downloadUpdate(): Promise<any> {
  const u = ensureUpdater()
  if (!u) return notReady()
  if (state.downloaded) return { ok: true, version: state.version }
  if (state.stage !== 'available' && state.stage !== 'skipped') {
    return { ok: false, message: '当前没有可下载的更新，请先检查更新' }
  }
  if (state.stage === 'skipped') {
    // 用户此前跳过、现在改主意要装：清掉跳过标记，避免下次又被抑制
    saveUpdaterSettings({ skippedVersion: '' })
  }
  state.stage = 'downloading'
  state.percent = 0
  state.detail = ''
  state.message = '正在下载更新…'
  send('download start ' + state.version)
  try {
    await u.downloadUpdate()
  } catch (e) {
    if (state.stage !== 'error') {
      setError(msg(e))
      send('download failed ' + msg(e))
    }
    return { ok: false, message: state.error || humanError(msg(e)).message, detail: state.detail }
  }
  // 与检查同一条纪律：downloadUpdate() 正常时会在 resolve 之前发 update-downloaded
  // （见其 executeDownload 里 `await taskOptions.done(...)`），所以「resolve 了却还停在 downloading、
  // 也没有 downloaded 标记」= 全程无事件，不能报成功——否则卡片永远停在「正在下载更新…」
  if (state.stage === 'downloading' && !state.downloaded) {
    state.stage = 'error'
    state.error = '下载没有开始，请稍后重试'
    state.message = state.error
    state.detail = '原始信息：downloadUpdate() 未发出任何事件（既无下载进度，也没有 update-downloaded）。'
    send('download declined')
    return { ok: false, message: state.error, detail: state.detail }
  }
  return { ok: true, version: state.version }
}

export function cancelDownload(): any {
  const u = ensureUpdater() as any
  if (!u) return notReady()
  try {
    if (typeof u.cancelDownload === 'function') u.cancelDownload()
    state.stage = 'available'
    state.percent = 0
    state.transferred = 0
    state.total = 0
    state.bps = 0
    state.detail = ''
    state.message = '已取消下载'
    send('cancel')
    return { ok: true }
  } catch (e) {
    return { ok: false, message: '取消下载失败，请重试', detail: '取消失败：' + msg(e) }
  }
}

// 注意：`isBusy()` 不在这里——忙碌状态由 install.ts 的 bindBusyTracking() 推导并导出，
// 读取出口只有那一个（本文件若也导出同名函数就会有两份「同一件事」的实现）。

