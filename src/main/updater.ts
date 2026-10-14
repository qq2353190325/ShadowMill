// src/main/updater.ts
// 应用自更新（electron-updater + electron-builder generic provider）
// 提供：register(ctx) 装配（update:check / update:download / update:cancel / update:install IPC + update:progress 回推）
//       checkNow / downloadUpdate / cancelDownload / installNow / isBusy / quitForUpdate
// 依赖：app / ipcMain / electron-updater（作为 dependencies 随包发布，不内联）+ settings.ts（读 updater.feedUrl）
//
// 三条设计约定：
// ① 更新源优先级：settings.json 的 updater.feedUrl（非空即覆盖）> 打包时 resources/app-update.yml 的 publish 地址。
//    前者供测试源 / 内网源切换，后者由 package.json 的 build.publish 在 npm run dist 时生成。
// ② 下载由用户显式触发（autoDownload = false）：安装包近百 MB，不在后台偷流量。
//    安装同样只由用户显式触发（autoInstallOnAppQuit = false）：NSIS 的更新是「整体卸载旧版 → 解压复制新包」，
//    实测一次约 97 秒，期间应用不存在、桌面快捷方式指向空路径（点击报「文件不存在或已被移动」）。
//    这种长时间不可用必须由用户点确认后发生，不能因为「用户只是关了个窗」就在背后静默开始。
// ③ 安装前检查「本机任务是否在跑」：whisper 转录 / HyperFrames 渲染 / 逐句对齐期间重启会丢进度，
//    故忙碌时拒绝安装并回明确文案（忙状态由 4 路进度通道的起止自动推导，无需其它模块配合）。
// ④ electron-updater 一律**懒加载**（ensureUpdater）：启动路径不 require 它，首屏不为更新模块买单。
// ⑤ 错误文案分两层：message 说人话给终端用户，detail 存原始报错给排障（见 humanError）。
// ⑥ 安装成功后清一次下载缓存：pending/ 那份与 cacheDir/installer.exe 重复（各约 275 MB），
//    是否装上只能等下次启动用版本号验证，故退出前落 update-installing.json 标记（见 finalizePendingUpdate）。
// ⑦ **检查必须「有事件才算成功」**：electron-updater 的 checkForUpdates() 有两种「一个字的事件都不发」的
//    静默放弃——① 未打包且未 forceDevUpdateConfig 时 isUpdaterActive() 为假，直接 `return null`；
//    ② 已有一次检查在飞时复用同一个 Promise，也不再发事件。这两种情况若照样按成功回带，主进程自己
//    写下的临时文案「正在检查更新…」就会被当成终态送到界面——卡片永远停在那句话上，看起来像卡死。
//    所以 checkNow() 在报成功之前必判一次「state.stage 是否还停在 checking」（见该函数注释）。
import { app, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
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
  detail: '' as string | undefined,
  downloaded: false,
  error: '' as string | undefined
}

const appVersion = (): string => {
  try { return app.getVersion() } catch (e) { return '' }
}

// ===== 日志：落 userData/updater.log（沿用 preview-protocol.log 的排查口子）=====
const logPath = (): string => path.join(app.getPath('userData'), 'updater.log')
function writeLog(line: string): void {
  try {
    fs.appendFileSync(logPath(), new Date().toISOString() + ' ' + line + '\n', 'utf8')
  } catch (e) { /* 日志失败不影响更新流程 */ }
}

const msg = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e))
const bytesText = (n: number): string => {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}
// 把 electron-updater 的报错翻译成用户看得懂的话（HTTP 错误码优先）。
// 判断顺序很重要：403 的报错文本里**必然包含请求 URL**（末尾就是 latest.yml），
// 若先判 `latest\.yml` 就会把「权限被拒」误报成「文件没上传」，会把人带偏到错误方向。
//
// 结果分两段，这是刻意的：
//   message —— 终端用户看的。只说「发生了什么 + 你能做什么」，**不许出现** latest.yml /
//              存储桶 / 匿名读取 / app-update.yml / electron-updater 这类只有发布者才懂的词。
//              403 / 404 / 缺 app-update.yml 三种情况的真正处置动作都在发布者那一侧，
//              用户看到「请把存储桶设为公共读」既做不了、也只会以为是自己弄坏了什么。
//   detail  —— 排障用的原始信息（HTTP 状态 + AccessDenied 原文 + 请求 URL），
//              由 UI 的「查看详情」展开、并已全量落在 updater.log，能力一点没丢。
interface HumanError { message: string; detail: string }
function humanError(raw: string): HumanError {
  const s = String(raw || '')
  // 详情只留首行：electron-updater 的报错后面跟的是 HTML 错误页 / 整段堆栈，日志里有全量
  const first = s.trim().split('\n')[0].slice(0, 300)
  // 抠出请求 URL：403 / 404 的排查关键就是「应用到底在请求哪个地址」
  // （本次真实故障就是「装的是 0.0.2 找 /shadowmill/，文件传在 /MarvisStudio/」）。
  // noCache 查询串是 electron-updater 自己加的，属噪声，去掉。
  const urlRaw = (s.match(/url:\s*(\S+)/i) || [])[1] || ''
  const url = urlRaw.split('?')[0]
  const tail = (url ? '请求地址：' + url + '；' : '') + '原始报错：' + first
  // ① 先判权限：403 与各类「拒绝访问」文案（OSS/S3/GitHub 私有库都会出现）
  if (/403|forbidden|accessdenied|access denied|no right to access|bucket acl|unauthorized|401/i.test(s)) {
    return {
      message: '更新服务暂时不可用，请稍后重试',
      detail: '更新源拒绝访问（403）：存储桶 / 对象需设为「公共读」，generic 更新源必须能被匿名下载。' + tail
    }
  }
  // ② 再判缺失：404，或 electron-updater 的 `Cannot find channel "latest.yml"`
  if (/404|not found|cannot find/i.test(s)) {
    return {
      message: '暂时没有可用的新版本信息，请稍后重试',
      detail: '更新源上没有找到 latest.yml（尚未上传，或上传目录与更新源地址不一致）。' + tail
    }
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::/i.test(s)) {
    return { message: '网络连接失败，请检查网络后重试', detail: '无法连接更新源。' + tail }
  }
  if (/sha512|checksum/i.test(s)) {
    return { message: '安装包下载不完整，请重试', detail: '安装包校验失败（文件不完整或与服务端不一致）。' + tail }
  }
  if (/app-update\.yml|ENOENT/i.test(s)) {
    return {
      message: '当前版本不支持自动更新，请到应用官网下载最新版本',
      detail: '本机缺少更新配置（app-update.yml），当前可能不是安装版。' + tail
    }
  }
  return { message: '更新失败，请稍后重试', detail: '原始报错：' + first }
}

// 统一的错误落态：message / detail 永远成对写入，避免只改一处的半吊子状态
function setError(raw: string): void {
  const h = humanError(raw)
  state.stage = 'error'
  state.error = h.message
  state.detail = h.detail
  state.message = h.message
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
    message: state.message,
    detail: state.detail
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
    state.detail = ''
    send()
  })
  u.on('update-available', (info: UpdaterInfoLike) => {
    const version = (info && info.version) || ''
    const skipped = getUpdaterSettings().skippedVersion
    state.version = version
    state.error = undefined
    state.detail = ''
    // 用户「跳过」过的版本：仅在主动检查时说明，启动静默检查不打扰
    state.stage = (skipped && skipped === version) ? 'skipped' : 'available'
    // 状态文案只在这里产出（渲染层不再自己拼一套），故写成可直接照做的句子
    state.message = state.stage === 'skipped'
      ? ('版本 ' + version + ' 已跳过，如需安装请点「下载更新」')
      : ('发现新版本 ' + version + '，可点「下载更新」获取安装包')
    send('update-available ' + version)
  })
  u.on('update-not-available', () => {
    state.stage = 'none'
    state.version = ''
    state.detail = ''
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
    state.detail = ''
    state.message = '更新已下载（' + state.version + '），点「立即重启安装」完成更新（安装期间应用会关闭约 1~2 分钟）'
    send('update-downloaded ' + state.version)
  })
  u.on('error', (e: unknown) => {
    const raw = msg(e)
    setError(raw)
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
      // 关窗即装会带来「应用自己消失约 100 秒、快捷方式失效」的无提示体验，改成只能显式点「立即重启安装」
      autoUpdater.autoInstallOnAppQuit = false
      // dev：electron-updater 只在「已打包」或 forceDevUpdateConfig 时才真的检查（见 isUpdaterActive，
      // 否则 checkForUpdates() 直接返回 null 且不发任何事件）。项目根放了 dev-app-update.yml 就替它打开
      // 这个开关，让手动检查与启动静默检查走同一条路，不再出现「点了没反应」。
      if (!app.isPackaged && fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'))) {
        try { (autoUpdater as any).forceDevUpdateConfig = true } catch (e) { /* 老版本无此属性则忽略 */ }
      }
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
// 模块没加载起来时给用户的说法：加载失败的技术原因（依赖没打包等）只留在 detail
function notReady(): { ok: false; message: string; detail: string } {
  return {
    ok: false,
    message: '更新模块不可用，请重新安装应用',
    detail: updaterLoadError || 'electron-updater 未加载'
  }
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
  // 状态文案由主进程单点产出（见 bindEvents），这里把当前态原样回带，渲染层不再拼串
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
  // 与 checkNow 同一条纪律：downloadUpdate() 正常时会在 resolve 之前发 update-downloaded
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
    state.detail = ''
    state.message = '已取消下载'
    send('cancel')
    return { ok: true }
  } catch (e) {
    return { ok: false, message: '取消下载失败，请重试', detail: '取消失败：' + msg(e) }
  }
}

// ===== 下载缓存（与 electron-updater 的 cacheDir 完全一致：ElectronAppAdapter.getAppCacheDir + app-update.yml）=====
// 用途只有一个：安装成功后清掉 pending/ 里那份重复的安装包（约 275 MB）；
// cacheDir/installer.exe 必须保留 —— 它是 electron-updater 下次差分下载的旧文件基线。
function updaterCacheDir(): string {
  const home = os.homedir()
  const base = process.platform === 'win32'
    ? (process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local'))
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches')
      : (process.env['XDG_CACHE_HOME'] || path.join(home, '.cache'))
  let dirName = app.getName() + '-updater'
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const m = /^\s*updaterCacheDirName:\s*(\S+)\s*$/m.exec(yml)
    if (m && m[1]) dirName = m[1]
  } catch (e) { /* 非安装版 / 文件缺失：落回 <name>-updater */ }
  return path.join(base, dirName)
}

// 安装是否真的生效，只能等下次启动比较版本号：installNow() 退出前落标记，
// 新进程版本与标记一致 ⇒ 装上了 ⇒ 清掉 pending/（那份安装包已在 cacheDir 里留了基线，重复的没必要留）
function installMarkerPath(): string {
  return path.join(app.getPath('userData'), 'update-installing.json')
}

function finalizePendingUpdate(): void {
  let recorded = ''
  try {
    const raw = JSON.parse(fs.readFileSync(installMarkerPath(), 'utf8'))
    recorded = raw && typeof raw.version === 'string' ? raw.version : ''
  } catch (e) {
    return // 没有标记 = 本次启动与更新安装无关，什么都不做
  }
  try { fs.rmSync(installMarkerPath(), { force: true }) } catch (e) { /* ignore */ }
  const now = appVersion()
  if (!recorded || recorded !== now) {
    writeLog('install marker 版本 ' + (recorded || '(空)') + ' ≠ 当前 ' + now + '（未装上或已回退），保留下载缓存')
    return
  }
  try {
    const dir = path.join(updaterCacheDir(), 'pending')
    let cleaned = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      try {
        fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true })
        cleaned++
      } catch (e) { /* 单个失败不影响其余 */ }
    }
    if (cleaned) writeLog('安装成功（' + now + '），已清理下载缓存 pending/ 共 ' + cleaned + ' 项')
  } catch (e) { /* pending 目录不存在：正常情况 */ }
}

// 退出并安装。先置 quitForUpdate 标志（index.ts 的 window-all-closed 据此不再抢着 app.quit()），
// 再给用户一句明确的预期：安装期间应用目录会被清空重建，快捷方式会短暂失效。
async function installNow(): Promise<any> {
  const u = ensureUpdater()
  if (!u) return notReady()
  if (!state.downloaded) return { ok: false, message: '更新尚未下载完成' }
  if (busy) return { ok: false, message: '当前有任务正在进行（转录 / 渲染 / 配音），请等任务结束后再重启安装' }

  // 实测：一次更新要 90~120 秒（旧版整体卸载 + 约 1GB 安装内容解压/复制）。
  // 这段预期必须提前说清楚 —— 否则用户看到的是「应用莫名消失很久，点快捷方式说文件不存在」。
  const win = getWindow ? getWindow() : null
  const options = {
    type: 'info' as const,
    buttons: ['立即重启安装', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: '重启并安装更新',
    message: '重启并安装 ' + (state.version || '新版本') + '？',
    detail: [
      '安装期间应用会关闭约 1~2 分钟（新旧版本文件整体替换），完成后会自动重新打开。',
      '',
      '・期间桌面 / 开始菜单快捷方式会暂时失效，点击会提示「文件不存在或已被移动」，属正常现象，请勿重复点击；',
      '・若弹出系统权限（UAC）窗口，请点「是」，否则更新不会开始。'
    ].join('\n')
  }
  try {
    const res = (win && !win.isDestroyed())
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    if (res.response !== 0) {
      send('quitAndInstall cancelled by user')
      return { ok: true, message: '已取消安装，可稍后再点「立即重启安装」' }
    }
  } catch (e) {
    // 对话框失败不阻断安装（照旧往下走）
  }

  try {
    fs.writeFileSync(installMarkerPath(), JSON.stringify({ version: state.version || '', at: new Date().toISOString() }), 'utf8')
  } catch (e) { /* 标记写不了不影响安装，只是下次不会清缓存 */ }

  quitFlag = true
  state.message = '正在退出并安装更新…'
  send('quitAndInstall ' + state.version)
  setTimeout(() => {
    try {
      u.quitAndInstall(true, true)
    } catch (e) {
      quitFlag = false
      state.stage = 'error'
      state.error = '启动安装程序失败，请重新下载安装包后手动安装'
      state.detail = 'quitAndInstall 失败：' + msg(e)
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
  // 取当前状态：状态活在主进程（跨页面挂载持续存在），设置页挂载时用它补齐一次。
  // 这是「启动静默检查失败」唯一能被渲染层看见的路径——那次失败发生在设置页订阅进度之前。
  ipcMain.handle(IPC.Update.Status, () => payload())
  // 打开日志：更新失败时用户 / 维护者拿到原始报错的唯一出口。
  // 刻意不进 ensureUpdater——electron-updater 加载失败恰恰是最需要看日志的场景。
  ipcMain.handle(IPC.Update.OpenLog, () => {
    const p = logPath()
    try {
      if (fs.existsSync(p)) shell.showItemInFolder(p)        // 有日志：在文件管理器里选中它
      else void shell.openPath(app.getPath('userData'))      // 还没写过日志：至少把目录打开
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, message: '打开日志目录失败', detail: errText(e) }
    }
  })

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
    // dev 下的 forceDevUpdateConfig 由 ensureUpdater() 统一设置（上面的提前 return 已保证 dev 必有该文件）
    void checkNow('startup')
  }, 3000)

  // 上次退出是去装更新了吗？是的话这次启动顺手清掉下载缓存里的重复安装包（约 275 MB）。
  // 延迟 5s：别和首屏、启动检查抢时间；清缓存失败也只是少腾点磁盘，不影响任何功能。
  setTimeout(() => { finalizePendingUpdate() }, 5000)
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
