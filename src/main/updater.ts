// src/main/updater.ts
// 应用自更新（electron-updater + electron-builder generic provider）
// 提供：register(ctx) 装配（update:check / update:download / update:cancel / update:install IPC + update:progress 回推）
//       checkNow / downloadUpdate / cancelDownload / installNow / isBusy / quitForUpdate
// 依赖：app / ipcMain / electron-updater（作为 dependencies 随包发布，不内联）+ settings.ts（读 updater.feedUrl）
//
// 三条设计约定：
// ① 更新源优先级：settings.json 的 updater.feedUrl（非空即覆盖）> 打包时 resources/app-update.yml 的 publish 地址。
//    前者供测试源 / 内网源切换，后者由 package.json 的 build.publish 在 npm run dist 时生成。
// ② 下载由用户显式触发（autoDownload = false）：安装包近百 MB，不在后台偷流量；但下载完成后
//    autoInstallOnAppQuit = true，用户直接关窗也会装上。
// ③ 安装前检查「本机任务是否在跑」：whisper 转录 / HyperFrames 渲染 / 逐句对齐期间重启会丢进度，
//    故忙碌时拒绝安装并回明确文案（忙状态由 4 路进度通道的起止自动推导，无需其它模块配合）。
// ④ electron-updater 一律**懒加载**（ensureUpdater）：启动路径不 require 它，首屏不为更新模块买单。
import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { IPC } from '../shared/ipc'
import type {
  RegisterCtx,
  UpdateCheckResult,
  UpdateProgressPayload,
  UpdateStage
} from '../shared/types'
import { getUpdaterSettings, saveUpdaterSettings } from './settings'

// electron-updater 是 CJS 包（main 指向 out/main.js 且无 ESM 具名导出），
// 这里按官方 TypeScript 写法取 autoUpdater；整段包在 try 里，缺依赖时给出明确失败而不是让主进程启动崩掉。
//
// 【为什么是懒加载】它的模块图不小（require 实测 ~70ms，冷启动/杀软扫描时更久），而"检查更新"
// 最早也发生在启动 3s 之后（见 register 的静默检查）或用户手动点击时。顶层 require 会让主进程在
// **建窗之前**就白付这段成本、直接推迟首屏，因此改为 ensureUpdater() 首次真正用到时再加载。
interface UpdaterProgressLike {
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}
interface UpdaterInfoLike {
  version?: string
}
interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL(options: { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): void
}
let autoUpdater: UpdaterLike | null = null
let updaterLoadError = ''
let updaterLoadTried = false

function errText(e: unknown): string {
  const err = e as { message?: string } | null
  return err && err.message ? String(err.message) : String(e)
}

// ===== 运行时状态 =====
let getWindow: (() => any) | null = null
let busy = false        // 本机长任务是否在跑（由进度通道推导）
let quitFlag = false    // 已开始退出安装（供 index.ts 的 window-all-closed 判断）
let checkedOnce = false // 避免同一进程内重复做「启动静默检查」
// 刻意放宽为 string：stage 由 electron-updater 的事件回调跨函数写入，若标注成联合类型，
// TS 的控制流分析会在每个 await 后把函数内最后一次赋值当作当前类型，导致后续比较全被判成「不可能分支」。
const state = {
  stage: 'idle' as string,
  version: '',
  currentVersion: '',
  percent: 0,
  transferred: 0,
  total: 0,
  bps: 0,
  message: '',
  downloaded: false,
  error: '' as string | undefined
}

const appVersion = (): string => {
  try { return app.getVersion() } catch (e) { return '' }
}

// ===== 日志：落 userData/updater.log（沿用 preview-protocol.log 的排查口子）=====
function writeLog(line: string): void {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'updater.log'),
      new Date().toISOString() + ' ' + line + '\n',
      'utf8'
    )
  } catch (e) { /* 日志失败不影响更新流程 */ }
}

const msg = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e))
const bytesText = (n: number): string => {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}
// 把 electron-updater 的报错翻译成用户看得懂的话（HTTP 错误码优先）
// 注意：更新源上没有 latest.yml 时，electron-updater 抛的是 `Cannot find channel "latest.yml" ...`，
// 未必带 404，故「文件缺失」两种文案都要判，否则会落到兜底的「更新失败：…」。
function humanError(raw: string): string {
  const s = String(raw || '')
  if (/404|not found|cannot find|latest\.yml/i.test(s)) return '更新源上没有找到 latest.yml，请确认已把安装包与 latest.yml 上传到更新源'
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::/i.test(s)) return '无法连接更新源，请检查网络或更新源地址'
  if (/sha512|checksum/i.test(s)) return '安装包校验失败（文件不完整或与服务端不一致），请重试'
  if (/app-update\.yml|ENOENT/i.test(s)) return '本机缺少更新配置（app-update.yml），当前可能不是安装版'
  return '更新失败：' + s
}

// ===== 进度推送（单订阅语义由 preload 保证）=====
// stage 经白名单收敛成 UpdateStage：state.stage 为放宽的 string，交出去前必须收口
function toStage(raw: string): UpdateStage {
  const list: UpdateStage[] = ['idle', 'checking', 'available', 'skipped', 'downloading', 'downloaded', 'none', 'error']
  return (list as string[]).indexOf(raw) >= 0 ? raw as UpdateStage : 'none'
}
function payload(): UpdateProgressPayload {
  return {
    stage: toStage(state.stage),
    version: state.version,
    currentVersion: state.currentVersion || appVersion(),
    percent: state.percent,
    transferred: state.transferred,
    total: state.total,
    bytesPerSecond: state.bps,
    message: state.message
  }
}
function send(extra?: string): void {
  const win = getWindow ? getWindow() : null
  try {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.Update.Progress, payload())
  } catch (e) { /* 窗口已销毁则忽略 */ }
  if (extra) writeLog(extra)
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

// ===== 事件绑定（ensureUpdater 首次加载成功时一次）=====
function bindEvents(u: UpdaterLike): void {
  u.on('checking-for-update', () => {
    state.stage = 'checking'
    state.message = '正在检查更新…'
    state.error = undefined
    send()
  })
  u.on('update-available', (info: UpdaterInfoLike) => {
    const version = (info && info.version) || ''
    const skipped = getUpdaterSettings().skippedVersion
    state.version = version
    state.error = undefined
    // 用户「跳过」过的版本：仅在主动检查时说明，启动静默检查不打扰
    state.stage = (skipped && skipped === version) ? 'skipped' : 'available'
    state.message = state.stage === 'skipped'
      ? ('已跳过版本 ' + version)
      : ('发现新版本 ' + version + '，可下载更新')
    send('update-available ' + version)
  })
  u.on('update-not-available', () => {
    state.stage = 'none'
    state.version = ''
    state.message = '当前已是最新版本（' + appVersion() + '）'
    send()
  })
  u.on('download-progress', (p: UpdaterProgressLike) => {
    state.stage = 'downloading'
    state.percent = Math.max(0, Math.min(100, Math.round(Number(p && p.percent) || 0)))
    state.transferred = Number(p && p.transferred) || 0
    state.total = Number(p && p.total) || 0
    state.bps = Number(p && p.bytesPerSecond) || 0
    state.message = '正在下载更新 ' + state.percent + '%（' + bytesText(state.transferred) + ' / ' + bytesText(state.total) + '）'
    send()
  })
  u.on('update-downloaded', (info: UpdaterInfoLike) => {
    state.stage = 'downloaded'
    state.downloaded = true
    state.percent = 100
    state.version = (info && info.version) || state.version
    state.message = '更新已下载（' + state.version + '），重启应用完成安装'
    send('update-downloaded ' + state.version)
  })
  u.on('error', (e: unknown) => {
    const raw = msg(e)
    state.stage = 'error'
    state.error = humanError(raw)
    state.message = state.error
    send('error ' + raw)
  })
}

// ===== 懒加载 electron-updater（只尝试一次）=====
// 成功：取到 autoUpdater → 立刻设好两个开关并绑定事件（bindEvents 必须恰好一次，故放在这里）。
// 失败：记 updaterLoadError + 落日志，返回 null，调用方走 notReady() 给出明确文案。
function ensureUpdater(): UpdaterLike | null {
  if (updaterLoadTried) return autoUpdater
  updaterLoadTried = true
  try {
    const mod: any = require('electron-updater')
    const cand: any = mod && mod.autoUpdater ? mod.autoUpdater : (mod && mod.default && mod.default.autoUpdater ? mod.default.autoUpdater : null)
    if (cand && typeof cand.checkForUpdates === 'function') {
      autoUpdater = cand as UpdaterLike
      autoUpdater.autoDownload = false       // 安装包近百 MB：下载只能由用户显式触发
      autoUpdater.autoInstallOnAppQuit = true // 已下载完成则关窗即装
      bindEvents(autoUpdater)
    } else {
      updaterLoadError = 'electron-updater 未导出 autoUpdater（依赖未正确打包？）'
      writeLog('updater 不可用：' + updaterLoadError)
    }
  } catch (e) {
    updaterLoadError = 'electron-updater 加载失败：' + errText(e)
    writeLog('updater 不可用：' + updaterLoadError)
  }
  return autoUpdater
}

// ===== 对外动作 =====
function notReady(): { ok: false; message: string } {
  return { ok: false, message: updaterLoadError || '更新模块不可用，请重新安装应用' }
}

// 检查更新：不做「已跳过」的提前 return，仍走真实检查（用户可能在设置页手动点），
// 只是把 stage 标为 skipped 让 UI 显示「已跳过该版本」。
async function checkNow(trigger: 'manual' | 'startup'): Promise<any> {
  const u = ensureUpdater()
  if (!u) return notReady()
  state.currentVersion = appVersion()
  const feedUrl = applyFeedUrl(u)
  state.stage = 'checking'
  state.message = '正在检查更新…'
  state.error = undefined
  send('check start trigger=' + trigger + ' feed=' + (feedUrl || '(app-update.yml)'))
  try {
    await u.checkForUpdates()
  } catch (e) {
    // 事件回调与 Promise reject 会各报一次，这里只在还未进入 error 态时补一次
    if (state.stage !== 'error') {
      state.stage = 'error'
      state.error = humanError(msg(e))
      state.message = state.error
      send('check failed ' + msg(e))
    }
    return { ok: false, message: state.error || humanError(msg(e)), currentVersion: appVersion() }
  }
  if (state.stage === 'available') {
    return { ok: true, state: 'available', version: state.version, currentVersion: appVersion() } as UpdateCheckResult & { ok: true }
  }
  if (state.stage === 'skipped') {
    return { ok: true, state: 'skipped', version: state.version, currentVersion: appVersion() } as UpdateCheckResult & { ok: true }
  }
  if (state.stage === 'error') {
    return { ok: false, message: state.error || '检查更新失败', currentVersion: appVersion() }
  }
  return { ok: true, state: 'none', version: '', currentVersion: appVersion() } as UpdateCheckResult & { ok: true }
}

// 下载更新：用户点「下载」才走这里（autoDownload = false）
async function downloadUpdate(): Promise<any> {
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
  state.message = '正在下载更新…'
  send('download start ' + state.version)
  try {
    await u.downloadUpdate()
  } catch (e) {
    if (state.stage !== 'error') {
      state.stage = 'error'
      state.error = humanError(msg(e))
      state.message = state.error
      send('download failed ' + msg(e))
    }
    return { ok: false, message: state.error || humanError(msg(e)) }
  }
  return { ok: true, version: state.version }
}

function cancelDownload(): any {
  const u = ensureUpdater() as any
  if (!u) return notReady()
  try {
    if (typeof u.cancelDownload === 'function') u.cancelDownload()
    state.stage = 'available'
    state.percent = 0
    state.transferred = 0
    state.total = 0
    state.bps = 0
    state.message = '已取消下载'
    send('cancel')
    return { ok: true }
  } catch (e) {
    return { ok: false, message: '取消失败：' + msg(e) }
  }
}

// 退出并安装：置 quitForUpdate 标志，让 index.ts 的 window-all-closed 不再抢着 app.quit()
function installNow(): any {
  const u = ensureUpdater()
  if (!u) return notReady()
  if (!state.downloaded) return { ok: false, message: '更新尚未下载完成' }
  if (busy) return { ok: false, message: '当前有任务正在进行（转录 / 渲染 / 配音），请等任务结束后再重启安装' }
  quitFlag = true
  state.message = '正在退出并安装更新…'
  send('quitAndInstall ' + state.version)
  setTimeout(() => {
    try {
      u.quitAndInstall(true, true)
    } catch (e) {
      quitFlag = false
      state.stage = 'error'
      state.error = '启动安装程序失败：' + msg(e)
      state.message = state.error
      send('quitAndInstall failed ' + msg(e))
    }
  }, 300)
  return { ok: true }
}

const isBusy = (): boolean => busy
const quitForUpdate = (): boolean => quitFlag

// ===== 忙碌状态：4 路进度通道的起止自动推导（不改动 whisper / video / ttsAlign / projects 模块）=====
function bindBusyTracking(): void {
  // 开始即忙
  ipcMain.on(IPC.Whisper.Progress, (_e, d: any) => { busy = !!(d && (d.stage === 'downloading' || d.stage === 'loading' || d.stage === 'transcribing')) })
  ipcMain.on(IPC.Video.Progress, () => { busy = true })
  ipcMain.on(IPC.Voice.AlignProgress, (_e, d: any) => { busy = !!(d && (d.stage === 'synth' || d.stage === 'assemble')) })
  ipcMain.on(IPC.Project.HtmlProgress, (_e, d: any) => { busy = !!(d && d.stage !== 'done') })
}

function register(ctx: RegisterCtx): void {
  getWindow = ctx && ctx.getWindow ? ctx.getWindow : null

  // 这里刻意**不**加载 electron-updater：装配阶段只挂 IPC 与忙碌推导（都是极轻的操作），
  // 真正的 require 推迟到 ensureUpdater()——即启动静默检查（3s 后）或用户手动点检查时。
  bindBusyTracking()

  ipcMain.handle(IPC.Update.Check, () => checkNow('manual'))
  ipcMain.handle(IPC.Update.Download, () => downloadUpdate())
  ipcMain.handle(IPC.Update.Cancel, () => cancelDownload())
  ipcMain.handle(IPC.Update.Install, () => installNow())
  // 同步版本号：设置页首屏要立刻显示，避免走 async 再等一轮渲染
  ipcMain.on(IPC.Update.Version, (event) => { event.returnValue = appVersion() })

  // 启动静默检查一次：延迟 3s 让窗口首屏先出来；autoCheck 关闭或非安装版（无 app-update.yml）则跳过
  setTimeout(() => {
    if (checkedOnce) return
    checkedOnce = true
    const cfg = getUpdaterSettings()
    if (!cfg.autoCheck) { writeLog('startup check skipped: autoCheck=false'); return }
    // dev 下 electron-vite 未打包，没有 app-update.yml：要么配 dev-app-update.yml + forceDevUpdateConfig，要么跳过
    if (!app.isPackaged && !fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'))) {
      writeLog('startup check skipped: dev 环境未提供 dev-app-update.yml')
      return
    }
    const u = ensureUpdater()
    if (!u) return
    if (!app.isPackaged) {
      try { (u as any).forceDevUpdateConfig = true } catch (e) { /* 老版本无此属性则忽略 */ }
    }
    void checkNow('startup')
  }, 3000)
}

export {
  register,
  checkNow,
  downloadUpdate,
  cancelDownload,
  installNow,
  isBusy,
  quitForUpdate,
  updaterLoadError
}
