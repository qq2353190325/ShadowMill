// src/main/updater/base.ts —— 应用自更新的底座：运行态、日志与小工具、错误文案、进度推送与事件绑定
// 本文件**不 import 同目录其它模块**（依赖方向的最上游）：actions / install / index 都从这里读写状态，
// 这样拆成多个文件后也不会出现互相 import 成环。三条设计约定的完整说明见 ./index.ts 的文件头。
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { IPC } from '../../shared/ipc'
import type { UpdateProgressPayload, UpdateStage } from '../../shared/types'
import { getUpdaterSettings } from '../settings'

// electron-updater 是 CJS 包（main 指向 out/main.js 且无 ESM 具名导出），
// 这里按官方 TypeScript 写法取 autoUpdater；整段包在 try 里，缺依赖时给出明确失败而不是让主进程启动崩掉。
//
// 【为什么是懒加载】它的模块图不小（require 实测 ~70ms，冷启动/杀软扫描时更久），而"检查更新"
// 最早也发生在启动 3s 之后（见 register 的静默检查）或用户手动点击时。顶层 require 会让主进程在
// **建窗之前**就白付这段成本、直接推迟首屏，因此改为 ensureUpdater() 首次真正用到时再加载。
export interface UpdaterProgressLike {
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}
export interface UpdaterInfoLike {
  version?: string
}
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL(options: { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): void
}

// ===== 模块内部状态（拆成多个文件后仍是「一个模块级单例」）=====
// loadError：electron-updater 的加载失败原因（空串 = 已加载或尚未尝试）。
// **刻意是 getter 而不是快照**——它在 ensureUpdater() 里被赋值，若这里导出的是当时的字符串，
// 拿到手的永远是初始的 ''（拆分前它是模块内变量，读的人看到的是实时值）。
export const updater: {
  loadTried: boolean
  instance: UpdaterLike | null
} = { loadTried: false, instance: null }
let updaterLoadError = ''
/** electron-updater 的加载失败原因（空串 = 已加载或尚未尝试）。做成取值函数：调用方拿到的是实时值，
 *  而拆分前那种「模块级 let + 按值导出」在拆成多文件后只会导出初始快照（永远是 ''）。 */
export const getUpdaterLoadError = (): string => updaterLoadError

// 开关类标记：谁写谁读都从这里走，避免拆开后各文件各留一份 let
export const flags: {
  getWindow: (() => any) | null
  busy: boolean        // 本机长任务是否在跑（由进度通道推导）
  quitFlag: boolean    // 已开始退出安装（供主进程 index.ts 的 window-all-closed 判断）
  checkedOnce: boolean // 避免同一进程内重复做「启动静默检查」
} = { getWindow: null, busy: false, quitFlag: false, checkedOnce: false }

// 刻意放宽为 string：stage 由 electron-updater 的事件回调跨函数写入，若标注成联合类型，
// TS 的控制流分析会在每个 await 后把函数内最后一次赋值当作当前类型，导致后续比较全被判成「不可能分支」。
export const state = {
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

export const appVersion = (): string => {
  try { return app.getVersion() } catch (e) { return '' }
}

// ===== 日志：落 userData/updater.log（沿用 preview-protocol.log 的排查口子）=====
export const logPath = (): string => path.join(app.getPath('userData'), 'updater.log')
export function writeLog(line: string): void {
  try {
    fs.appendFileSync(logPath(), new Date().toISOString() + ' ' + line + '\n', 'utf8')
  } catch (e) { /* 日志失败不影响更新流程 */ }
}

export const msg = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e))
export const errText = (e: unknown): string => {
  const err = e as { message?: string } | null
  return err && err.message ? String(err.message) : String(e)
}
export const bytesText = (n: number): string => {
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
export interface HumanError { message: string; detail: string }
export function humanError(raw: string): HumanError {
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
export function setError(raw: string): void {
  const h = humanError(raw)
  state.stage = 'error'
  state.error = h.message
  state.detail = h.detail
  state.message = h.message
}

// ===== 懒加载 electron-updater（只尝试一次）=====
// 成功：取到 autoUpdater → 立刻设好两个开关并绑定事件（bindEvents 必须恰好一次，故放在这里）。
// 失败：记 loadError + 落日志，返回 null，调用方走 actions.notReady() 给出明确文案。
// 放在依赖最上游的 base.ts 而不是 index.ts：actions / install 都要用它，放 index 会与之成环。
export function ensureUpdater(): UpdaterLike | null {
  if (updater.loadTried) return updater.instance
  updater.loadTried = true
  try {
    const mod: any = require('electron-updater')
    const cand: any = mod && mod.autoUpdater ? mod.autoUpdater : (mod && mod.default && mod.default.autoUpdater ? mod.default.autoUpdater : null)
    if (cand && typeof cand.checkForUpdates === 'function') {
      updater.instance = cand as UpdaterLike
      updater.instance.autoDownload = false       // 安装包近百 MB：下载只能由用户显式触发
      // 关窗即装会带来「应用自己消失约 100 秒、快捷方式失效」的无提示体验，改成只能显式点「立即重启安装」
      updater.instance.autoInstallOnAppQuit = false
      // dev：electron-updater 只在「已打包」或 forceDevUpdateConfig 时才真的检查（见 isUpdaterActive，
      // 否则 checkForUpdates() 直接返回 null 且不发任何事件）。项目根放了 dev-app-update.yml 就替它打开
      // 这个开关，让手动检查与启动静默检查走同一条路，不再出现「点了没反应」。
      if (!app.isPackaged && fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'))) {
        try { (updater.instance as any).forceDevUpdateConfig = true } catch (e) { /* 老版本无此属性则忽略 */ }
      }
      bindEvents(updater.instance)
    } else {
      updaterLoadError = 'electron-updater 未导出 autoUpdater（依赖未正确打包？）'
      writeLog('updater 不可用：' + updaterLoadError)
    }
  } catch (e) {
    updaterLoadError = 'electron-updater 加载失败：' + errText(e)
    writeLog('updater 不可用：' + updaterLoadError)
  }
  return updater.instance
}

// ===== 进度推送（单订阅语义由 preload 保证）=====
// stage 经白名单收敛成 UpdateStage：state.stage 为放宽的 string，交出去前必须收口
function toStage(raw: string): UpdateStage {
  const list: UpdateStage[] = ['idle', 'checking', 'available', 'skipped', 'downloading', 'downloaded', 'none', 'error']
  return (list as string[]).indexOf(raw) >= 0 ? raw as UpdateStage : 'none'
}
export function payload(): UpdateProgressPayload {
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
export function send(extra?: string): void {
  const win = flags.getWindow ? flags.getWindow() : null
  try {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.Update.Progress, payload())
  } catch (e) { /* 窗口已销毁则忽略 */ }
  if (extra) writeLog(extra)
}

// ===== 事件绑定（ensureUpdater 首次加载成功时一次）=====
export function bindEvents(u: UpdaterLike): void {
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
