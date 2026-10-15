// src/main/runtime.ts
// 运行环境（分包）——把 ffmpeg / hyperframes 这些**跨版本几乎不变**的重型资源从「随安装包展开」
// 改成「首次用到时从更新源下载 7z，再由应用自己解到 userData」。
//
// 为什么：NSIS 的更新是「整体卸载旧版 → 解压复制新包」，而这 632MB / 4916 文件的资源每次更新都要重新
// 解压+复制一遍（实测一次更新 97 秒，期间应用不存在、桌面快捷方式指向空路径）。分包之后：
//   ① 安装包只带代码 + whisper（12.5MB，转录缺它就完全不能用，所以随包，见 package.json 的 extraResources）
//      ⇒ 安装包**实测 257.6MB → 105.08MB**（−59%，2026-10-14；当初预估的「约 145MB」偏高，因为把
//      「runtime.7z 在安装包里被压到约 90MB」重复算了一次——实际是整块移出），且装完即离线可用
//      （转录 / 配音 / 字幕 / HTML 生成都不需要下载）；
//   ② ffmpeg 与 hyperframes 各成一个包，各自独立升级、独立校验：改渲染引擎不必让转录功能重下 ffmpeg；
//   ③ 是否下载由**用户决定**（用到相关功能时提示体积、可取消），下载进度可视化；
//   ④ 下载与校验都有**收尾保护**（字节达标即收尾 + 停滞看门狗 + 校验读超时）：任何一步走不动，都要落在
//      「一条人话报错 + 进度留着可续传」上，而不是无声地停在 100%（2026-10-15 实测踩过一次）。
//
// 提供：register(ctx)（runtime:status / runtime:prepare / runtime:cancel + runtime:progress 回推）
//       packsStatus()（纯探测，不下载）/ ensurePacks(packs)（下载+解包，可取消）/ packRoots() / runtimeDir()
// 依赖：app / ipcMain / net / child_process(7za) / fs / crypto / hfEnv(刷新资源路径) / settings(读 feedUrl)
// 详细方案与验收清单见 docs/runtime-pack-split.md。
import { app, ipcMain, net } from 'electron'
import type { ClientRequest } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { IPC } from '../shared/ipc'
import type {
  IpcResult,
  RegisterCtx,
  RuntimePackName,
  RuntimePackState,
  RuntimeProgressPayload
} from '../shared/types'
import * as hfEnv from './hfEnv'
import { getUpdaterSettings } from './settings'

// ===== 包定义（scripts/pack-runtime.mjs 的 PACKS 必须与之对应）=====
// hint：界面在用户确认下载前给出的体积提示。两个都已按 2026-10-14 的实测回填，并**取整到 MiB**：
//   ffmpeg 42.6 MiB（build/runtime-pack/ffmpeg.json 的 bytes = 44,698,068）⇒ 43
//   hyperframes 103.1 MiB（bytes = 108,076,664，内含 chrome-headless-shell 268 MB 的未压缩体量）⇒ 103
// 取整值之和（43 + 103 = 146.0）与实测合计 145.7 MiB 一致；**不要回退成向上取整**（105 那版界面会报
// 148.0 MB，比真实下载量多报 2 MiB，与 README / CHANGELOG 的「约 146 MB」自相矛盾）。
// 准备过程中会用清单里的真实字节覆盖这个提示值。
// files：判定「解包完整」的关键文件（相对包目录），缺一即视为未就绪并触发重下。
const PACK_DEFS: { name: RuntimePackName; title: string; hint: number; files: string[] }[] = [
  { name: 'ffmpeg', title: '音视频处理（ffmpeg）', hint: 43 * 1024 * 1024, files: [path.join('ffmpeg', 'bin', 'ffmpeg.exe'), path.join('ffmpeg', 'bin', 'ffprobe.exe')] },
  { name: 'hyperframes', title: '视频渲染引擎（HyperFrames）', hint: 103 * 1024 * 1024, files: [path.join('hyperframes', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')] }
]
const PACK_NAMES: RuntimePackName[] = PACK_DEFS.map((d) => d.name)

// ===== 清单（scripts/pack-runtime.mjs 产出，字段必须与脚本一致）=====
interface PackManifest {
  name?: string
  id: string
  file: string
  sha512: string
  bytes: number
  files: number
  unpackedBytes: number
  sourceKey?: string
  appVersion?: string
  createdAt?: string
}

// ===== 持久状态（userData/runtime/packs.json）=====
interface PacksState {
  version: number
  packs: Partial<Record<RuntimePackName, { id: string; files: number; unpackedBytes: number; at: string }>>
  // 旧版整体运行环境包（安装包里带 runtime.7z 的那一版）解开的目录：里面三样资源俱全，
  // 留着可让老用户升级后**不重下**；两个分包都就位后由 gc() 删除。
  legacy?: { id: string; root: string; at: string }
}
interface PackStatusEntry {
  state: RuntimePackState
  id: string
  root: string
  files: number
  unpackedBytes: number
  bytes: number
  legacy: boolean
}
export type PackStatus = Record<RuntimePackName, PackStatusEntry>

// ===== 运行时状态 =====
let getWindow: (() => any) | null = null
let inFlight: Promise<IpcResult> | null = null
let cancelRequested = false
let activeReq: ClientRequest | null = null
let activeChild: ChildProcess | null = null

const state = {
  phase: 'idle' as string,
  pack: null as RuntimePackName | null,
  percent: 0,
  packs: [] as RuntimePackName[],
  missing: [] as RuntimePackName[],
  status: {} as Record<RuntimePackName, RuntimePackState>,
  message: '尚未检查运行环境',
  detail: '' as string | undefined,
  source: '',
  bytes: 0,
  unpackedBytes: 0,
  files: 0
}
for (const n of PACK_NAMES) state.status[n] = 'unknown'

// ===== 路径 =====
const runtimeDir = (): string => path.join(app.getPath('userData'), 'runtime')
const downloadsDir = (): string => path.join(runtimeDir(), 'downloads')
const stateFile = (): string => path.join(runtimeDir(), 'packs.json')
const packDir = (name: RuntimePackName): string => path.join(runtimeDir(), name)
const packOkFile = (name: RuntimePackName): string => path.join(packDir(name), 'ok.json')
// 旧版布局的指针（整体包时代）：仅用于「老用户沿用」，新代码不再写它
const legacyPointer = (): string => path.join(runtimeDir(), 'current.json')

// ===== 日志：userData/runtime.log（与 updater.log / startup.log 同一套排障口子，超过 64KB 清一次）=====
function writeLog(line: string): void {
  try {
    const file = path.join(app.getPath('userData'), 'runtime.log')
    try {
      if (fs.statSync(file).size > 64 * 1024) fs.rmSync(file)
    } catch (e) { /* 首次写日志：文件不存在 */ }
    fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n', 'utf8')
  } catch (e) { /* 日志失败不影响运行环境 */ }
}

const bytesText = (n: number): string => {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}

function payload(): RuntimeProgressPayload {
  return {
    phase: state.phase as RuntimeProgressPayload['phase'],
    pack: state.pack,
    percent: Math.max(0, Math.min(100, Math.round(state.percent))),
    packs: state.packs.slice(),
    missing: state.missing.slice(),
    status: { ...state.status },
    message: state.message,
    detail: state.detail,
    source: state.source,
    bytes: state.bytes,
    unpackedBytes: state.unpackedBytes,
    files: state.files,
    cancellable: state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'extracting'
  }
}

function push(): void {
  const win = getWindow ? getWindow() : null
  try {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.Runtime.Progress, payload())
  } catch (e) { /* 窗口已销毁则忽略 */ }
}

function setPhase(phase: string, message: string, detail?: string): void {
  state.phase = phase
  state.message = message
  state.detail = detail
  push()
}

function fail(message: string, detail: string, packs: RuntimePackName[] = []): IpcResult {
  state.pack = null
  state.missing = packs.slice()
  setPhase('error', message, detail)
  writeLog('error: ' + message + ' | ' + detail)
  return { ok: false, message, detail }
}

function cancelledResult(): IpcResult {
  state.pack = null
  state.phase = 'cancelled'
  state.percent = 0
  state.message = '已取消下载（运行环境未安装）'
  state.detail = undefined
  push()
  writeLog('cancelled by user')
  return { ok: false, message: '已取消下载' }
}

// ===== 状态文件读写 =====
function readState(): PacksState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as PacksState
    if (s && typeof s === 'object') {
      if (!s.packs || typeof s.packs !== 'object') s.packs = {}
      return s
    }
  } catch (e) { /* 首次运行 / 文件损坏：当作空状态 */ }
  return { version: 1, packs: {} }
}

function writeState(s: PacksState): void {
  try {
    fs.mkdirSync(runtimeDir(), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), 'utf8')
  } catch (e) {
    writeLog('写 packs.json 失败：' + (e && (e as Error).message ? (e as Error).message : String(e)))
  }
}

// ===== 就绪判定：必须「有记录 + 有 ok.json + 关键文件都在」三者齐备，缺一即视为未就绪 =====
function packReadyAt(name: RuntimePackName, root: string): boolean {
  const def = PACK_DEFS.find((d) => d.name === name)
  if (!def) return false
  try {
    if (!fs.existsSync(path.join(root, 'ok.json'))) return false
    for (const rel of def.files) {
      if (!fs.existsSync(path.join(root, rel))) return false
    }
    return true
  } catch (e) {
    return false
  }
}

// 旧版整体包目录：packs.json 里记的，或旧 current.json + ok.json 推断出来的（升级第一次探测时补记）
function legacyRoot(): string {
  const s = readState()
  if (s.legacy && s.legacy.root) {
    const abs = path.join(runtimeDir(), s.legacy.root)
    if (fs.existsSync(abs)) return abs
  }
  try {
    const cur = JSON.parse(fs.readFileSync(legacyPointer(), 'utf8'))
    const id = cur && typeof cur.id === 'string' ? cur.id : ''
    if (!id) return ''
    const abs = path.join(runtimeDir(), id)
    if (!fs.existsSync(path.join(abs, 'ok.json'))) return ''
    // 只认「同时含两包资源」的那一份，避免把某个分包目录误认成旧版整体包
    const looksLegacy = PACK_DEFS.every((d) => d.files.every((rel) => {
      const inside = rel.split(path.sep).slice(1).join(path.sep) // 去掉包名那一层
      return fs.existsSync(path.join(abs, rel)) || fs.existsSync(path.join(abs, inside))
    }))
    if (!looksLegacy) return ''
    const s2 = readState()
    s2.legacy = { id, root: id, at: new Date().toISOString() }
    writeState(s2)
    writeLog('识别到旧版整体运行环境目录，沿用：' + abs)
    return abs
  } catch (e) {
    return ''
  }
}

const installedEntry = (name: RuntimePackName) => {
  const s = readState()
  const e = s.packs[name]
  if (!e || !e.id) return null
  if (!packReadyAt(name, packDir(name))) return null
  return e
}

// 纯探测：不下载、不阻塞
function packsStatus(): PackStatus {
  const out = {} as PackStatus
  const legacy = legacyRoot()
  for (const def of PACK_DEFS) {
    const entry = installedEntry(def.name)
    if (entry) {
      out[def.name] = { state: 'ready', id: entry.id, root: packDir(def.name), files: entry.files, unpackedBytes: entry.unpackedBytes, bytes: 0, legacy: false }
      continue
    }
    if (legacy && packReadyAt(def.name, legacy)) {
      out[def.name] = { state: 'ready', id: '', root: legacy, files: 0, unpackedBytes: 0, bytes: 0, legacy: true }
      continue
    }
    out[def.name] = { state: 'missing', id: '', root: '', files: 0, unpackedBytes: 0, bytes: 0, legacy: false }
  }
  return out
}

// 把探测结果写进推送状态与 hfEnv 的解析
function syncStatus(status: PackStatus): PackStatus {
  for (const def of PACK_DEFS) {
    const st = status[def.name]
    state.status[def.name] = st.state
    if (st.state === 'ready') hfEnv.refreshPack(def.name, st.root)
  }
  return status
}

// 缺哪些包（供消费点校验；缺的按 PACK_DEFS 顺序返回）
function missingPacks(needs?: RuntimePackName[]): RuntimePackName[] {
  const want = needs && needs.length ? needs : PACK_NAMES
  const status = packsStatus()
  syncStatus(status)
  return want.filter((n) => status[n].state !== 'ready')
}

const packSizeText = (names: RuntimePackName[]): string => {
  let sum = 0
  for (const n of names) {
    const def = PACK_DEFS.find((d) => d.name === n)
    if (def) sum += def.hint
  }
  return bytesText(sum)
}

// ===== 更新源：与 updater.ts 同优先级（settings 的 feedUrl > 打包 app-update.yml）=====
function feedUrl(): string {
  const s = (getUpdaterSettings().feedUrl || '').trim()
  if (s) return s.replace(/\/+$/, '/').replace(/([^:])\/{2,}/g, '$1/')
  const yml = app.isPackaged
    ? path.join(process.resourcesPath, 'app-update.yml')
    : path.join(app.getAppPath(), 'dev-app-update.yml')
  try {
    const raw = fs.readFileSync(yml, 'utf8')
    const m = /^\s*url:\s*(\S+)\s*$/m.exec(raw)
    if (m && m[1]) return m[1].replace(/\/+$/, '/')
  } catch (e) { /* 非安装版 / 未配置 */ }
  return ''
}

// 解包器：随安装包的 <resources>/tools/7za.exe（dev 为 build/tools/）
function resolveSevenZip(): string | null {
  const name = process.platform === 'win32' ? '7za.exe' : '7za'
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', name),
    path.join(app.getAppPath(), 'build', 'tools', name)
  ]
  for (const c of candidates) {
    try {
      if (c && fs.statSync(c).isFile()) return c
    } catch (e) { /* 继续找下一个 */ }
  }
  return null
}

// 本地包目录（离线/内网用）：
//   ① SHADOWMILL_RUNTIME_PACK 指向含 <pack>.json 与 <pack>.7z 的目录（dev 自测 / 内网分发）
//   ② userData/runtime/local-import/（设置页「从本地文件安装…」把用户选的 7z 与清单放这里）
function localPackDir(): string {
  const env = process.env['SHADOWMILL_RUNTIME_PACK']
  if (env) {
    try {
      const st = fs.statSync(env)
      return st.isDirectory() ? env : path.dirname(env)
    } catch (e) { /* 环境变量指向不存在：忽略 */ }
  }
  try {
    const imported = path.join(runtimeDir(), 'local-import')
    if (fs.existsSync(imported)) return imported
  } catch (e) { /* ignore */ }
  return ''
}

function readLocalManifest(dir: string, name: RuntimePackName): PackManifest | null {
  if (!dir) return null
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')) as PackManifest
    if (!m || typeof m.id !== 'string' || !m.id) return null
    if (typeof m.file !== 'string' || !m.file) return null
    if (!fs.existsSync(path.join(dir, m.file))) return null
    return m
  } catch (e) {
    return null
  }
}

// ===== HTTP：清单（小、当文本读）与包（大、可断点续传）=====
// 取清单的等待上限：网络卡住时不能让「下载运行环境」永远停在 checking —— inFlight 会一直挂着，
// 之后每次点击都被「正在准备另一个运行环境包」挡回，界面上就成了「点了没反应」（实测踩过）。
const MANIFEST_TIMEOUT_MS = 20 * 1000
// 超时不是用户取消：残片要留着续传，判定取消时要先把它排掉（见 isCancelError）
const TIMEOUT_TEXT = '超时'

// 下载大包的「停滞」上限：**从发出请求起算**（含「连不上 / 服务端不回响应头」那段，不只是收数据之间），
// 这么久没有任何进展（也没下满）就判为卡住。
// 起因（2026-10-15 实测）：一次 ffmpeg 下载把 42.6 MB 全部写完——`.part` 尺寸与清单 bytes 一字不差、
// sha512 也对得上——但响应流始终没有 end，而这条链路的成功出口只有 out 的 'finish' ⇒ Promise 永不落定：
// 界面永久停在「42.6 MB / 42.6 MB（100%）」、不报错、不重试，主进程 CPU 为 0（不是忙，是干等）。
const DOWNLOAD_STALL_MS = 30 * 1000
// 卡住不是用户取消：`.part` 残片要留着续传（同 TIMEOUT_TEXT 的理由，见 isCancelError）
const STALL_TEXT = '下载中断'
// 校验阶段同样要有上限（大包 42.6 / 103.1 MB，读流卡住也会把 installOne 永远挂在这儿）。
// 「校验没做成」（读不动 / 超时）与「校验不符」是两回事：前者保留 `.part` 可重试，只有后者才丢弃（BADSHA）
const HASH_TIMEOUT_MS = 60 * 1000
const HASH_STALL_TEXT = '校验中断'

// 注：Electron 的 IncomingMessage 类型只暴露 statusCode / headers / on，resume / pipe 在运行时存在
// （它就是 Readable），故统一断言成 NodeJS.ReadableStream 再用。
function httpText(url: string, timeoutMs: number = MANIFEST_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }
    let req: ClientRequest
    try {
      req = net.request(url)
    } catch (e) {
      reject(e)
      return
    }
    timer = setTimeout(() => {
      // 先落定再 abort：abort 触发的 error 事件会因为 settled 被忽略，不会覆盖这条更准确的文案
      finish(() => reject(new Error(TIMEOUT_TEXT + '（' + Math.round(timeoutMs / 1000) + ' 秒无响应）：' + url)))
      try { req.abort() } catch (e) { /* 请求可能已经结束 */ }
    }, timeoutMs)
    req.on('response', (res) => {
      const stream = res as unknown as NodeJS.ReadableStream
      if (res.statusCode !== 200) {
        stream.resume()
        finish(() => reject(new Error('HTTP ' + res.statusCode + ' ' + url)))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)))
      res.on('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf8'))))
      res.on('error', (e: Error) => finish(() => reject(e)))
    })
    req.on('error', (e: Error) => finish(() => reject(e)))
    req.end()
  })
}

// 断点续传下载：已经下过的部分留在 <dest>.part 里，用 Range 续；服务端不支持（回 200）则从头覆盖。
// 只有「取消」才删残片；网络中断一律保留 .part，下次接着下（ffmpeg/hyperframes 包有 60-70MB，重下不可接受）。
// 注意：**成功的字节落在 <dest>.part**，调用方校验通过后必须自己 rename 成 <dest>（见 installOne）。
//
// 三条收尾保护（2026-10-15 实测「永久停在 100%」之后加的，缺一条都可能让流程无声卡死）：
//   ① **收满即收尾**：content-length 收齐就是下完了，不再等响应流的 'end'（实测出现过「字节全到、
//      流却不 end」⇒ 成功出口只有 out 的 'finish' ⇒ Promise 永不落定）。这里主动 unpipe + 丢掉流 +
//      显式 out.end()；内容对不对由调用方的 sha512 兜底。
//   ② **停滞看门狗**：从请求发出起算（含等服务端响应头那段），DOWNLOAD_STALL_MS 没有任何进展就落定成
//      失败并 abort 这条连接（`.part` 保留 ⇒ 重试走 Range 续传）。
//   ③ **416 当作已下完**：S3 语义下「Range 起点已在文件末尾」回 416（残片其实是完整的），此时没有更多
//      字节可拿 ⇒ 直接回到调用方交给 sha512 判定，而不是报一个 HTTP 416 让用户重下整包。
//      注意实测差异（2026-10-15）：**阿里云 OSS 对 `Range: bytes=<文件大小>-` 回的是 200 + 整个文件**
//      （不是 416）⇒ 走不到这条分支，`append` 判为 false、从头覆盖，重试会把整包重下一遍（能用但费流量）。
//      要省掉这次重下，得在 installOne 里先认领「尺寸已达清单 bytes 的 `.part`」。
function downloadToFile(
  url: string,
  dest: string,
  onProgress: (got: number, total: number) => void
): Promise<{ bytes: number; resumedFrom: number; part: string }> {
  const part = dest + '.part'
  let start = 0
  try {
    if (fs.existsSync(part)) start = fs.statSync(part).size
  } catch (e) { start = 0 }
  return new Promise<{ bytes: number; resumedFrom: number; part: string }>((resolve, reject) => {
    let settled = false
    let stallTimer: NodeJS.Timeout | null = null
    let done = false      // 字节已收满：只等 <dest>.part 落盘完（out 的 'finish'）就 resolve
    let settling = false  // 收尾动作（unpipe + destroy + out.end()）只做一次
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (stallTimer) clearTimeout(stallTimer)
      fn()
    }
    const req = net.request({ method: 'GET', url, headers: start > 0 ? { Range: 'bytes=' + start + '-' } : {} })
    activeReq = req
    // 看门狗：**从发出请求就开始计时**，每收到一段数据重置一次，超时即判卡住。
    // 计时必须覆盖「连不上 / 服务端收了请求却不回响应头」这一段——实测踩过：http 层复用了一条上一次
    // 响应没收尾的连接，这个请求的 response 事件永远不来，而若只在拿到响应后才计时 ⇒ 又永久卡死。
    // 落定后顺手 abort 这条连接：别让它继续挂着，也别让它被复用去跑下一次重试（abort 触发的 error 会被 settled 挡掉）。
    const armStall = (): void => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        finish(() => reject(new Error(STALL_TEXT + '：下载 ' + Math.round(DOWNLOAD_STALL_MS / 1000) +
          ' 秒没有进展（' + url + '）')))
        try { req.abort() } catch (e) { /* 请求可能已经结束 */ }
      }, DOWNLOAD_STALL_MS)
    }
    req.on('response', (res) => {
      const stream = res as unknown as NodeJS.ReadableStream
      const code = res.statusCode || 0
      // ③ 416：Range 起点已到文件末尾（残片其实是完整的）⇒ 没有更多字节可拿，按「已下完」收尾
      //    （阿里云 OSS 对同样的请求回 200 + 整包，走不到这里；见函数头 ③ 的实测差异）
      if (code === 416 && start > 0) {
        stream.resume()
        onProgress(start, start)
        finish(() => resolve({ bytes: start, resumedFrom: start, part }))
        return
      }
      if (code !== 200 && code !== 206) {
        stream.resume()
        finish(() => reject(new Error('HTTP ' + code + ' ' + url)))
        return
      }
      // 服务端忽略了 Range（回 200）⇒ 从头写，不能把新内容追加到旧残片后面
      const append = code === 206 && start > 0
      if (!append) start = 0
      const missing = Number(res.headers['content-length']) || 0
      const total = append ? start + missing : missing
      let got = start
      const out = fs.createWriteStream(part, append ? { flags: 'a' } : {})
      // ① 收满即收尾：摘掉管道、丢掉还在等 'end' 的流，再显式 out.end()，让 'finish' 把 Promise 落定。
      //    两个要点：**先 unpipe**（否则 destroy 之后残留的数据事件还会往 out 里写）；调用方一律
      //    **延后一拍**（setImmediate）—— 本次 'data' 事件里 pipe 自己的监听器还要把这一块写进 out
      //    （Node 派发事件用的是监听器快照，unpipe 拦不住本次），提前 end() 会撞
      //    ERR_STREAM_WRITE_AFTER_END，把一次成功的下载判成失败。
      const settleIfDone = (): void => {
        if (settled || !done || settling) return
        settling = true
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
        try { stream.unpipe(out) } catch (e) { /* ignore */ }
        try { (stream as unknown as { destroy?: () => void }).destroy?.() } catch (e) { /* ignore */ }
        try { out.end() } catch (e) { /* ignore */ }
      }
      // 续传时残片本来就完整：服务端可能回 206 + 空体（一点数据都不会来），这里先判一次
      if (total > 0 && got >= total) done = true
      onProgress(got, total)
      armStall()
      stream.on('data', (c: Buffer) => {
        got += c.length
        onProgress(got, total)
        armStall()
        if (total > 0 && got >= total) { done = true; setImmediate(settleIfDone) }
      })
      // 收满之后的流上报错一律忽略（字节已齐，报错只可能来自我们主动 destroy，或服务端的收尾噪音）
      stream.on('error', (e: any) => { if (!done) finish(() => reject(e)) })
      out.on('error', (e: any) => finish(() => reject(e)))
      out.on('finish', () => finish(() => resolve({ bytes: got, resumedFrom: start, part })))
      stream.pipe(out)
      // 同样是延后一拍：pipe 在本次同步流程里可能就吐出已缓冲的数据块，先让它写完再收尾
      if (done) setImmediate(settleIfDone)
    })
    req.on('error', (e: any) => finish(() => reject(e)))
    armStall()
    req.end()
  }).finally(() => {
    activeReq = null
  })
}

// 大包校验（42.6 / 103.1 MB）也要有上限：读流若卡住，installOne 会一直等在这里。
// 超时按「校验没做成」处理 ⇒ `.part` 保留、可重试，**不**当作 sha 不符把已下好的包丢掉（只有 BADSHA 才丢）。
//
// ⚠️ **不能用 `rs.pipe(hash)` + `hash.on('end')` 来收结果**：crypto 的 Hash 是 Transform，它的**读侧**
// 没人消费时不会流动，`pipe()` 只把读流的数据写进去（写侧最终发 'finish'），`'end'` 是读侧事件，
// 于是那个监听器**永远不会被调用** ⇒ 每次校验都只能等 HASH_TIMEOUT_MS 超时，报「校验中断」。
// 实测（同一实现搬到 Node 跑）：4 MiB 文件在 TEMP 目录也一样，事件序列停在 `rs:end, hash:finish`；
// 改成「读流 on('data') 手工 update」或把 hash 的 readable 读干，'end' 才正常触发。
// 这里选前者：不需要管道，读完就地 digest，超时语义不变。
async function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const hash = crypto.createHash('sha512')
    const rs = fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }
    timer = setTimeout(() => {
      done(() => reject(new Error(HASH_STALL_TEXT + '：读 ' + path.basename(file) + ' 超过 ' +
        Math.round(HASH_TIMEOUT_MS / 1000) + ' 秒没读完')))
      try { rs.destroy() } catch (e) { /* ignore */ }
    }, HASH_TIMEOUT_MS)
    rs.on('data', (c) => { hash.update(c) })
    rs.on('end', () => done(() => resolve(hash.digest('base64'))))
    rs.on('error', (e) => done(() => reject(e)))
  })
}

// 从更新源取某包的清单（失败返回 null，由调用方给文案）
async function fetchRemoteManifest(name: RuntimePackName): Promise<PackManifest | null> {
  const base = feedUrl()
  if (!base) return null
  try {
    const m = JSON.parse(await httpText(base + name + '.json')) as PackManifest
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.file !== 'string' || !m.file) {
      writeLog('[' + name + '] 远端清单格式不对，忽略')
      return null
    }
    return m
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    writeLog('[' + name + '] 远端清单不可用（' + base + name + '.json）：' + msg)
    // 超时 ≠ 清单不存在：错在连不上更新源，得让用户看到真实原因（否则会被误报成 404「没有清单」）
    if (msg.indexOf(TIMEOUT_TEXT) >= 0) throw new Error('MANIFEST_TIMEOUT')
    return null
  }
}

// ===== 解包：7za x <pack> -o<dest> -y -bsp1（-bsp1 把百分比打到 stdout）=====
function extractPack(sevenZip: string, packFile: string, dest: string, name: RuntimePackName): Promise<void> {
  fs.mkdirSync(dest, { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZip, ['x', packFile, '-o' + dest, '-y', '-bsp1'], { windowsHide: true })
    activeChild = child
    let tail = ''
    let lastPercent = -1
    child.stdout?.on('data', (d: Buffer) => {
      tail = (tail + String(d)).slice(-400)
      const m = tail.match(/(\d{1,3})%/g)
      if (!m) return
      const pct = Number(String(m[m.length - 1]).replace('%', ''))
      if (!isNaN(pct) && pct !== lastPercent) {
        lastPercent = pct
        state.percent = pct
        state.message = '正在准备运行环境 ' + pct + '%（' + state.pack + '）'
        push()
      }
    })
    child.stderr?.on('data', (d: Buffer) => { tail = (tail + String(d)).slice(-400) })
    child.on('error', (e) => { if (activeChild === child) activeChild = null; reject(e) })
    child.on('close', (code) => {
      if (activeChild === child) activeChild = null
      if (cancelRequested) { reject(new Error('已取消')); return }
      if (code === 0) resolve()
      else reject(new Error('7za 退出码 ' + code + (tail ? '：' + tail.trim().split('\n').slice(-1)[0] : '')))
    })
  })
}

// ===== 取消 =====
const CANCEL_MSG = '已取消下载'

function cancelPrepare(): IpcResult {
  const busy = state.phase === 'downloading' || state.phase === 'extracting' || state.phase === 'checking'
  if (!busy) return { ok: true, message: '当前没有正在进行的下载' }
  cancelRequested = true
  try { if (activeReq) activeReq.abort() } catch (e) { /* 请求可能已完成 */ }
  try { if (activeChild) activeChild.kill() } catch (e) { /* 进程可能已退出 */ }
  writeLog('cancel requested（phase=' + state.phase + '）')
  return { ok: true, message: CANCEL_MSG }
}

// 取消后清掉半成品：半解目录 + .part 残片（**只在取消时**删，网络失败要留着续传）
function cleanupHalfDone(name: RuntimePackName, file: string, dest: string): void {
  try { fs.rmSync(dest, { recursive: true, force: true }) } catch (e) { /* 占用中则下次再清 */ }
  try { fs.rmSync(file + '.part', { force: true }) } catch (e) { /* ignore */ }
  try { fs.rmSync(file, { force: true }) } catch (e) { /* ignore */ }
}

// ===== 主流程 =====
function isCancelError(e: unknown): boolean {
  const msg = String((e as Error)?.message || e)
  // 超时 / 卡住都不是取消：`.part` 残片要留着续传，不能被 cleanupHalfDone() 当成「用户取消」清掉
  if (msg.indexOf(TIMEOUT_TEXT) >= 0 || msg.indexOf(STALL_TEXT) >= 0 || msg.indexOf(HASH_STALL_TEXT) >= 0) return false
  return cancelRequested || msg.indexOf(CANCEL_MSG) >= 0 || /aborted|ERR_ABORTED/i.test(msg)
}

async function installOne(sevenZip: string, name: RuntimePackName): Promise<void> {
  const def = PACK_DEFS.find((d) => d.name === name) as typeof PACK_DEFS[number]
  const dest = packDir(name)
  state.pack = name
  state.status[name] = 'missing'
  const ldir = localPackDir()

  // ① 清单：本地（SHADOWMILL_RUNTIME_PACK）优先，其次更新源
  let manifest = readLocalManifest(ldir, name)
  let packFile = manifest ? path.join(ldir, manifest.file) : ''
  state.source = manifest ? 'local' : 'remote'
  if (!manifest) {
    setPhase('checking', '正在获取运行环境信息（' + def.title + '）…')
    manifest = await fetchRemoteManifest(name)
    if (!manifest) throw new Error('NO_MANIFEST')
  }
  if (cancelRequested) throw new Error(CANCEL_MSG)

  state.bytes = Number(manifest.bytes) || 0
  state.unpackedBytes = Number(manifest.unpackedBytes) || 0
  state.files = Number(manifest.files) || 0

  // ② 下载（本地包跳过；已有同 id 且校验相符的缓存也跳过）
  if (!packFile) {
    const base = feedUrl()
    const cached = path.join(downloadsDir(), name + '-' + manifest.id + '.7z')
    fs.mkdirSync(downloadsDir(), { recursive: true })
    let ok = false
    try {
      if (fs.existsSync(cached) && (await sha512Of(cached)) === manifest.sha512) ok = true
    } catch (e) { ok = false }
    if (!ok) {
      try { fs.rmSync(cached, { force: true }) } catch (e) { /* ignore */ }
      // 「上次已经下完、只是校验/解包那一步没走成」的收尾：把完整的 .part 认领下来，
      // 避免重下整个包。判据是**字节数与清单逐字相等**（.part 只有在收满时才可能到这个长度），
      // 再算一次 sha512 确认——相符就改名成交付名直接进解包，不符则照旧走下面的重新下载。
      // 注意：这段必须在 downloadToFile 之前，因为它一见到服务端回 200（OSS 对整文件请求就是 200）
      // 就会以覆盖模式打开 .part 从头写，残留的好字节会被就地截断。
      const partFile = cached + '.part'
      let claimed = false
      try {
        const partBytes = fs.existsSync(partFile) ? fs.statSync(partFile).size : 0
        if (Number(manifest.bytes) > 0 && partBytes === Number(manifest.bytes) && (await sha512Of(partFile)) === manifest.sha512) {
          try { fs.rmSync(cached, { force: true }) } catch (e) { /* 不存在也无所谓 */ }
          fs.renameSync(partFile, cached)
          claimed = true
          writeLog('[' + name + '] 复用上次下完的残片 ' + bytesText(partBytes) + '（无需重新下载）')
        }
      } catch (e) { /* 读不动 / 校验超时：按没有残片处理，下面照常下载 */ }
      if (claimed) {
        packFile = cached
        state.percent = 100
        setPhase('extracting', '正在准备运行环境（' + def.title + '）0%')
      }
    }
    if (!packFile) {
      state.percent = 0
      setPhase('downloading', '正在下载运行环境（' + def.title + '，' + bytesText(state.bytes) + '）…')
      const t0 = Date.now()
      const r = await downloadToFile(base + manifest.file, cached, (got, total) => {
        state.percent = total > 0 ? (got / total) * 100 : 0
        state.message = '正在下载 ' + def.title + ' ' + bytesText(got) + (total ? ' / ' + bytesText(total) : '') +
          '（' + Math.round(state.percent) + '%）'
        push()
      })
      if (cancelRequested) throw new Error(CANCEL_MSG)
      // 校验通过后才把 .part 变成正式名：内容不完整的一律不叫「已下载」
      // 校验**没做成**（读不动 / 超时）不能吞成空串 —— 那会被下面的 BADSHA 分支当成「内容不符」，
      // 把已经下好的整包删掉重下。让它按 HASH_STALL_TEXT 抛出去：`.part` 留着，重试只重新校验。
      const got512 = await sha512Of(r.part)
      if (got512 !== manifest.sha512) {
        try { fs.rmSync(r.part, { force: true }) } catch (e) { /* ignore */ }
        try { fs.rmSync(cached, { force: true }) } catch (e) { /* ignore */ }
        throw new Error('BADSHA')
      }
      try {
        fs.rmSync(cached, { force: true })
      } catch (e) { /* 不存在也无所谓 */ }
      fs.renameSync(r.part, cached)
      writeLog('[' + name + '] 下载完成 ' + bytesText(r.bytes) + '（续传起点 ' + r.resumedFrom + ' 字节，用时 ' +
        ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）')
      packFile = cached
    }
  }

  // ③ 解包（先删掉半成品目录，避免上一次中断残留的文件被当成完整包）
  if (cancelRequested) throw new Error(CANCEL_MSG)
  try { fs.rmSync(dest, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  state.percent = 0
  setPhase('extracting', '正在准备运行环境（' + def.title + '）0%')
  const t1 = Date.now()
  await extractPack(sevenZip, packFile, dest, name)
  if (cancelRequested) throw new Error(CANCEL_MSG)

  // ④ 完整性标记（先 ok.json，再 packs.json 记录；两者齐备才算就绪）
  fs.writeFileSync(packOkFile(name), JSON.stringify({
    name,
    id: manifest.id,
    files: state.files,
    unpackedBytes: state.unpackedBytes,
    at: new Date().toISOString()
  }), 'utf8')
  const s = readState()
  s.packs[name] = { id: manifest.id, files: state.files, unpackedBytes: state.unpackedBytes, at: new Date().toISOString() }
  writeState(s)
  state.status[name] = 'ready'
  hfEnv.refreshPack(name, dest)
  writeLog('[' + name + '] 解包完成 id=' + manifest.id + ' 用时 ' + ((Date.now() - t1) / 1000).toFixed(1) + ' 秒，来源 ' + state.source)
}

// 两个分包都就位后，旧版整体包目录就没用了（632MB）
function gc(): void {
  try {
    const s = readState()
    const legacy = s.legacy && s.legacy.root ? path.join(runtimeDir(), s.legacy.root) : ''
    const allReady = PACK_NAMES.every((n) => installedEntry(n))
    if (legacy && allReady) {
      try { fs.rmSync(legacy, { recursive: true, force: true }) } catch (e) { /* 占用中则下次再清 */ }
      try { if (fs.existsSync(legacyPointer())) fs.rmSync(legacyPointer(), { force: true }) } catch (e) { /* ignore */ }
      delete s.legacy
      writeState(s)
      writeLog('旧版整体运行环境目录已清理：' + legacy)
    }
  } catch (e) { /* ignore */ }
  // downloads/ 只保留当前各包 id 对应的那一份
  try {
    const s = readState()
    const keep = new Set<string>()
    for (const n of PACK_NAMES) {
      const e = s.packs[n]
      if (e && e.id) keep.add(n + '-' + e.id + '.7z')
    }
    for (const f of fs.readdirSync(downloadsDir())) {
      if (keep.has(f)) continue
      try { fs.rmSync(path.join(downloadsDir(), f), { recursive: true, force: true }) } catch (e) { /* 占用中则下次再清 */ }
    }
  } catch (e) { /* downloads 目录可能还不存在 */ }
}

async function runOnce(packs: RuntimePackName[]): Promise<IpcResult> {
  state.packs = packs.slice()
  if (cancelRequested) return cancelledResult()
  setPhase('checking', '正在检查运行环境…')
  const sevenZip = resolveSevenZip()
  if (!sevenZip) {
    return fail('运行环境无法准备：缺少解包程序',
      '未找到 7za.exe（应为 <resources>/tools/7za.exe）。请用 npm run pack / npm run dist 重新打包。', packs)
  }

  // 当前缺的包（可能被 legacy 满足）
  let status = syncStatus(packsStatus())
  state.missing = packs.filter((n) => status[n].state !== 'ready')
  push()
  if (!state.missing.length) {
    state.pack = null
    state.percent = 100
    state.phase = 'ready'
    state.message = '运行环境已就绪'
    state.detail = undefined
    push()
    return { ok: true }
  }

  const feed = feedUrl()
  const ldir = localPackDir()
  const canRemote = !!feed || !!ldir
  if (!canRemote) {
    return fail('运行环境尚未准备好，暂时无法使用渲染 / 转录转码功能',
      '更新源未配置且本机没有运行环境包（可用环境变量 SHADOWMILL_RUNTIME_PACK 指向本地包目录）。', state.missing)
  }

  for (const name of state.missing.slice()) {
    if (cancelRequested) return cancelledResult()
    try {
      await installOne(sevenZip, name)
    } catch (e) {
      if (isCancelError(e)) {
        cleanupHalfDone(name, path.join(downloadsDir(), name + '.7z'), packDir(name))
        cancelRequested = false
        const st = syncStatus(packsStatus())
        state.missing = packs.filter((n) => st[n].state !== 'ready')
        return cancelledResult()
      }
      const msg = String((e as Error)?.message || e)
      if (msg === 'NO_MANIFEST') {
        return fail('运行环境需要联网下载，但更新源上没有找到对应清单',
          '已尝试：' + (feed || '(未配置更新源)') + name + '.json；本地包目录：' + (ldir || '(未设置)'), state.missing)
      }
      if (msg === 'MANIFEST_TIMEOUT') {
        return fail('连接更新源超时，没能取到运行环境清单',
          '已在 ' + (feed || '(未配置更新源)') + name + '.json 上等待 ' + Math.round(MANIFEST_TIMEOUT_MS / 1000) +
          ' 秒无响应；请检查网络 / 代理后重试，或改用「从本地文件安装…」导入本机的 ' + name + '.7z。', state.missing)
      }
      // 卡住（下载没数据 / 校验读不完）：残片没坏、也没下错，别让用户重下整包
      if (msg.indexOf(STALL_TEXT) >= 0) {
        return fail('运行环境下载中断，已下好的部分留着',
          msg + '；再点「下载运行环境」会从断点续传，不必重下整个包。', state.missing)
      }
      if (msg.indexOf(HASH_STALL_TEXT) >= 0) {
        return fail('运行环境已下载完，但完整性校验没能走完',
          msg + '；包留在本机的 downloads 目录里，重试只会重新校验，不会重下。', state.missing)
      }
      if (msg === 'BADSHA') {
        return fail('运行环境下载校验失败（sha512 不符），已丢弃',
          '请重试；若反复失败请检查更新源上的 ' + name + '.7z 是否被改动。', state.missing)
      }
      return fail('运行环境下载 / 解包失败', name + '：' + msg, state.missing)
    }
  }

  if (cancelRequested) { cancelRequested = false; return cancelledResult() }

  const st = syncStatus(packsStatus())
  state.missing = packs.filter((n) => st[n].state !== 'ready')
  state.pack = null
  state.percent = 100
  state.source = 'cache'
  state.phase = 'ready'
  state.message = '运行环境已就绪'
  state.detail = undefined
  push()
  gc()
  return { ok: true }
}

// 幂等 + 并发安全：同一时刻只允许一次准备；忙碌期内的重复调用返回提示（界面按进度渲染）
function ensurePacks(packs?: RuntimePackName[]): Promise<IpcResult> {
  const want = packs && packs.length ? packs.filter((n) => PACK_NAMES.indexOf(n) >= 0) : PACK_NAMES.slice()
  if (inFlight) {
    return Promise.resolve({ ok: false, message: '正在准备另一个运行环境包，请稍候再试' })
  }
  if (!want.length) return Promise.resolve({ ok: true })
  cancelRequested = false
  inFlight = runOnce(want)
    .catch((e) => fail('运行环境准备失败', String(e), want))
    .then((r) => {
      inFlight = null
      return r
    })
  return inFlight
}

// 启动时的后台准备：**只做探测**，不下载。
// 理由：是否下载 60-70MB 必须由用户决定（用到相关功能时提示体积、可取消），静默下载会把「用户的选择」
// 变成「已经在跑了」；这里探测一次是为了让横幅/设置页首屏就显示「需要下载」而不是空白。
function prepareInBackground(): void {
  try {
    const status = syncStatus(packsStatus())
    const miss = PACK_NAMES.filter((n) => status[n].state !== 'ready')
    state.packs = PACK_NAMES.slice()
    state.missing = miss
    if (!miss.length) {
      state.phase = 'ready'
      state.percent = 100
      state.message = '运行环境已就绪'
      state.detail = undefined
    } else {
      state.phase = 'idle'
      state.percent = 0
      state.source = ''
      state.message = '运行环境需要下载（' + packSizeText(miss) + '）'
    }
    push()
  } catch (e) {
    writeLog('启动探测失败：' + String(e))
  }
}

// 供 hfEnv / 其它主进程模块用：各包解出来的根目录（未就绪为空串）
function packRoots(): Partial<Record<RuntimePackName, string>> {
  const status = packsStatus()
  const out: Partial<Record<RuntimePackName, string>> = {}
  for (const def of PACK_DEFS) {
    if (status[def.name].state === 'ready') out[def.name] = status[def.name].root
  }
  return out
}

const runtimeStatus = (): RuntimeProgressPayload => {
  const status = syncStatus(packsStatus())
  state.missing = PACK_NAMES.filter((n) => status[n].state !== 'ready')
  if (state.phase !== 'downloading' && state.phase !== 'extracting' && state.phase !== 'checking') {
    state.phase = state.missing.length ? 'idle' : 'ready'
    state.message = state.missing.length ? '运行环境需要下载（' + packSizeText(state.missing) + '）' : '运行环境已就绪'
    state.percent = state.missing.length ? 0 : 100
  }
  return payload()
}

function register(ctx: RegisterCtx): void {
  getWindow = ctx && ctx.getWindow ? ctx.getWindow : null
  ipcMain.handle(IPC.Runtime.Status, () => runtimeStatus())
  ipcMain.handle(IPC.Runtime.Prepare, (_e, packs?: RuntimePackName[]) => ensurePacks(packs))
  ipcMain.handle(IPC.Runtime.Cancel, () => cancelPrepare())
  // 启动只探测、不下载；register 排在 index.ts 装配序列最后，只保证 handler 先挂上
  prepareInBackground()
}

export {
  register,
  ensurePacks,
  prepareInBackground,
  cancelPrepare,
  packsStatus,
  missingPacks,
  packSizeText,
  packRoots,
  runtimeStatus,
  runtimeDir
}
export type { PackManifest }
