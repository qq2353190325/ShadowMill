// src/main/runtime.ts
// 运行环境包（runtime pack）——把 ffmpeg / hyperframes / whisper 这些**跨版本几乎不变**的重型资源
// 从「随安装包展开」改成「随安装包携带一个 7z 包，首次启动解到 userData」。
//
// 为什么：NSIS 的更新是「整体卸载旧版 → 解压复制新包」，而这 632MB / 4916 文件的资源每次更新都要
// 重新解压+复制一遍（实测一次更新 97 秒，期间应用不存在、桌面快捷方式指向空路径）。拆成包之后：
//   ① 安装目录里的运行资源从 4916 个文件变成 1 个 runtime.7z（安装期的复制/改名开销大幅下降）；
//   ② 解包由应用自己做（可展示进度），且包内容没变时**下一次更新完全不碰**这 632MB。
// 包与清单由 scripts/pack-runtime.mjs 生成（build/runtime-pack/），随 extraResources 进安装目录；
// 也可把同一份包与清单上传到更新源（app-update.yml 的 url 目录），本地包缺失时自动回退到下载。
//
// 提供：register(ctx) 装配（runtime:status / runtime:prepare IPC + runtime:progress 回推）
//       ensureRuntime()（幂等、并发安全）/ runtimeStatus() / prepareInBackground() / runtimeRoot()
// 依赖：app / ipcMain / net / child_process(7za) / fs / crypto / hfEnv(刷新资源根) / settings(读 feedUrl)
import { app, ipcMain, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { IPC } from '../shared/ipc'
import type { RegisterCtx, RuntimeProgressPayload } from '../shared/types'
import * as hfEnv from './hfEnv'
import { getUpdaterSettings } from './settings'

// ===== 清单（scripts/pack-runtime.mjs 产出，字段必须与脚本一致）=====
interface RuntimeManifest {
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

// ===== 运行时状态（stage 刻意放宽为 string：与 updater.ts 同因，跨回调写入后比较会被 TS 判成不可能分支）=====
let getWindow: (() => any) | null = null
let inFlight: Promise<{ ok: boolean; message?: string; detail?: string }> | null = null
const state = {
  stage: 'idle' as string, // idle / checking / downloading / extracting / ready / failed
  percent: 0,
  id: '',
  message: '尚未检查运行环境',
  detail: '' as string | undefined,
  source: '' as string, // local（随安装包）/ download（更新源）/ dev / legacy
  bytes: 0,
  unpackedBytes: 0,
  files: 0
}

// ===== 路径 =====
const runtimeDir = (): string => path.join(app.getPath('userData'), 'runtime')
const downloadsDir = (): string => path.join(runtimeDir(), 'downloads')
const currentFile = (): string => path.join(runtimeDir(), 'current.json')
const okFile = (id: string): string => path.join(runtimeDir(), id, 'ok.json')

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
    stage: state.stage as RuntimeProgressPayload['stage'],
    percent: Math.max(0, Math.min(100, Math.round(state.percent))),
    id: state.id,
    message: state.message,
    detail: state.detail,
    source: state.source,
    bytes: state.bytes,
    unpackedBytes: state.unpackedBytes,
    files: state.files
  }
}

function push(): void {
  const win = getWindow ? getWindow() : null
  try {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.Runtime.Progress, payload())
  } catch (e) { /* 窗口已销毁则忽略 */ }
}

function setStage(stage: string, message: string, detail?: string): void {
  state.stage = stage
  state.message = message
  state.detail = detail
  push()
}

function fail(message: string, detail: string): { ok: false; message: string; detail: string } {
  state.stage = 'failed'
  state.message = message
  state.detail = detail
  push()
  writeLog('failed: ' + message + ' | ' + detail)
  return { ok: false, message, detail }
}

// ===== 解包器（7za.exe）：随包发布在 <resources>/tools/，dev 下用 build/tools/ =====
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

// 随安装包携带的清单目录：<resources>/runtime-pack/（dev 下为 build/runtime-pack/）
function localPackDir(): string {
  const env = process.env['SHADOWMILL_RUNTIME_PACK']
  if (env) {
    try {
      const st = fs.statSync(env)
      return st.isDirectory() ? env : path.dirname(env)
    } catch (e) { /* 环境变量指向不存在的路径：忽略 */ }
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, 'runtime-pack')
    : path.join(app.getAppPath(), 'build', 'runtime-pack')
}

function readManifest(dir: string): RuntimeManifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8'))
    if (!m || typeof m.id !== 'string' || !m.id) return null
    if (typeof m.file !== 'string' || !m.file) return null
    if (!fs.existsSync(path.join(dir, m.file))) return null
    return m as RuntimeManifest
  } catch (e) {
    return null
  }
}

// 已解包完成的那一份（ok.json 是完整标记，current.json 只是指针）
function installedRoot(): string {
  try {
    const cur = JSON.parse(fs.readFileSync(currentFile(), 'utf8'))
    const id = cur && typeof cur.id === 'string' ? cur.id : ''
    if (!id) return ''
    return fs.existsSync(okFile(id)) ? path.join(runtimeDir(), id) : ''
  } catch (e) {
    return ''
  }
}

function hasInstalled(id: string): boolean {
  try {
    return fs.existsSync(okFile(id))
  } catch (e) {
    return false
  }
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

// ===== HTTP：清单（小、当文本读）与包（大、流式落盘 + 进度）=====
// 注：Electron 的 IncomingMessage 类型只暴露 statusCode / headers / on，resume / pipe 在运行时存在
// （它就是 Readable），故统一断言成 NodeJS.ReadableStream 再用。
function httpText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    req.on('response', (res) => {
      const stream = res as unknown as NodeJS.ReadableStream
      if (res.statusCode !== 200) {
        stream.resume()
        reject(new Error('HTTP ' + res.statusCode + ' ' + url))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

function httpToFile(url: string, dest: string, onProgress: (got: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    req.on('response', (res) => {
      const stream = res as unknown as NodeJS.ReadableStream
      if (res.statusCode !== 200) {
        stream.resume()
        reject(new Error('HTTP ' + res.statusCode + ' ' + url))
        return
      }
      const len = res.headers['content-length']
      const total = Number(Array.isArray(len) ? len[0] : len) || 0
      let got = 0
      const out = fs.createWriteStream(dest)
      res.on('data', (c: Buffer) => {
        got += c.length
        onProgress(got, total)
      })
      res.on('error', reject)
      out.on('error', reject)
      out.on('finish', () => resolve())
      stream.pipe(out)
    })
    req.on('error', reject)
    req.end()
  })
}

async function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    const rs = fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
    rs.on('error', reject)
    hash.on('error', reject)
    hash.on('end', () => resolve(hash.digest('base64')))
    rs.pipe(hash)
  })
}

// ===== 从更新源取包（本地包缺失时的回退路径）=====
async function fetchRemotePack(): Promise<{ manifest: RuntimeManifest; packFile: string } | null> {
  const base = feedUrl()
  if (!base) return null
  setStage('checking', '正在从更新源获取运行环境信息…')
  let manifest: RuntimeManifest
  try {
    manifest = JSON.parse(await httpText(base + 'runtime.json')) as RuntimeManifest
  } catch (e) {
    writeLog('远端清单不可用（' + base + 'runtime.json）：' + String(e))
    return null
  }
  if (!manifest || typeof manifest.id !== 'string' || !manifest.id || typeof manifest.file !== 'string') {
    writeLog('远端清单格式不对，忽略')
    return null
  }
  const dest = path.join(downloadsDir(), manifest.file)
  fs.mkdirSync(downloadsDir(), { recursive: true })
  // 已有同一份（sha512 相符）就不重复下载
  try {
    if (fs.existsSync(dest) && (await sha512Of(dest)) === manifest.sha512) {
      return { manifest, packFile: dest }
    }
  } catch (e) { /* 校验失败就重下 */ }
  try { fs.rmSync(dest, { force: true }) } catch (e) { /* ignore */ }

  state.bytes = Number(manifest.bytes) || 0
  state.unpackedBytes = Number(manifest.unpackedBytes) || 0
  state.files = Number(manifest.files) || 0
  state.id = manifest.id
  state.source = 'download'
  setStage('downloading', '正在下载运行环境（' + bytesText(state.bytes) + '）…')
  try {
    await httpToFile(base + manifest.file, dest, (got, total) => {
      state.percent = total > 0 ? (got / total) * 100 : 0
      state.message = '正在下载运行环境 ' + bytesText(got) + (total ? ' / ' + bytesText(total) : '') + '（' + Math.round(state.percent) + '%）'
      push()
    })
  } catch (e) {
    try { fs.rmSync(dest, { force: true }) } catch (e2) { /* ignore */ }
    writeLog('下载运行环境失败：' + String(e))
    return null
  }
  const got = await sha512Of(dest).catch(() => '');
  if (got !== manifest.sha512) {
    try { fs.rmSync(dest, { force: true }) } catch (e) { /* ignore */ }
    writeLog('下载的运行环境校验失败（sha512 不符），已删除')
    return null
  }
  return { manifest, packFile: dest }
}

// ===== 解包：7za x <pack> -o<dest> -y -bsp1（-bsp1 把百分比进度打到 stdout）=====
function extractPack(sevenZip: string, packFile: string, manifest: RuntimeManifest): Promise<void> {
  const dest = path.join(runtimeDir(), manifest.id)
  fs.mkdirSync(dest, { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZip, ['x', packFile, '-o' + dest, '-y', '-bsp1'], { windowsHide: true })
    let tail = ''
    let lastPercent = -1
    child.stdout.on('data', (d: Buffer) => {
      tail = (tail + String(d)).slice(-400)
      const m = tail.match(/(\d{1,3})%/g)
      if (!m) return
      const pct = Number(String(m[m.length - 1]).replace('%', ''))
      if (!isNaN(pct) && pct !== lastPercent) {
        lastPercent = pct
        state.percent = pct
        state.message = '正在准备运行环境 ' + pct + '%（' + bytesText(state.unpackedBytes) + ' / ' + state.files + ' 个文件）'
        push()
      }
    })
    child.stderr.on('data', (d: Buffer) => { tail = (tail + String(d)).slice(-400) })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('7za 退出码 ' + code + (tail ? '：' + tail.trim().split('\n').slice(-1)[0] : '')))
    })
  })
}

// ===== 主流程（幂等 + 并发安全）=====
function done(ok: boolean, message?: string, detail?: string): { ok: boolean; message?: string; detail?: string } {
  return ok ? { ok: true } : { ok: false, message, detail }
}

async function run(): Promise<{ ok: boolean; message?: string; detail?: string }> {
  // ① 已解包好：直接就绪（这是常态，更新后第二次启动起都是这条路径）
  const root = installedRoot()
  if (root) {
    state.stage = 'ready'
    state.percent = 100
    state.source = 'cache'
    state.message = '运行环境已就绪'
    hfEnv.refreshBuiltinResources(root)
    push()
    return done(true)
  }

  // ② 安装目录里已经是展开形态（dev 项目资源 / 旧版布局的安装）：无需解包
  const force = !!process.env['SHADOWMILL_RUNTIME_PACK']
  const legacy = path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'))
  if (!force && fs.existsSync(path.join(legacy, 'ffmpeg', 'bin', 'ffmpeg.exe'))) {
    state.stage = 'ready'
    state.percent = 100
    state.source = app.isPackaged ? 'legacy' : 'dev'
    state.message = '运行环境已就绪（安装目录内置）'
    hfEnv.refreshBuiltinResources(legacy)
    writeLog('使用安装目录内置资源：' + legacy)
    push()
    return done(true)
  }

  setStage('checking', '正在检查运行环境…')
  const sevenZip = resolveSevenZip()
  if (!sevenZip) {
    return fail('运行环境无法准备：缺少解包程序', '未找到 7za.exe（应为 <resources>/tools/7za.exe）。请用 npm run pack / npm run dist 重新打包。')
  }

  // ③ 取包：随安装包的优先（离线可用），没有再走更新源下载
  let manifest = readManifest(localPackDir())
  let packFile = manifest ? path.join(localPackDir(), manifest.file) : ''
  state.source = 'local'
  if (!manifest) {
    const remote = await fetchRemotePack()
    if (!remote) {
      return fail(
        '运行环境尚未准备好，暂时无法使用本地转录 / 渲染功能',
        '既没有找到随安装包携带的 runtime-pack（' + localPackDir() + '），也没能从更新源取到运行环境包。'
      )
    }
    manifest = remote.manifest
    packFile = remote.packFile
  }

  state.id = manifest.id
  state.bytes = Number(manifest.bytes) || 0
  state.unpackedBytes = Number(manifest.unpackedBytes) || 0
  state.files = Number(manifest.files) || 0

  // ④ 万一已经解过同一个 id（并发/上次被打断后指针没写）：直接认
  if (hasInstalled(manifest.id)) {
    hfEnv.refreshBuiltinResources(path.join(runtimeDir(), manifest.id))
    state.stage = 'ready'
    state.percent = 100
    state.message = '运行环境已就绪'
    push()
    return done(true)
  }

  setStage('extracting', '正在准备运行环境 0%（' + bytesText(state.unpackedBytes) + ' / ' + state.files + ' 个文件）')
  state.percent = 0
  const t0 = Date.now()
  try {
    await extractPack(sevenZip, packFile, manifest)
  } catch (e) {
    return fail('运行环境解压失败，转录 / 渲染暂不可用', '7za 解包失败：' + (e && (e as Error).message ? (e as Error).message : String(e)))
  }

  // ⑤ 成功：先落 ok.json（完整性标记），再写 current.json 指针，最后刷新资源根
  const dest = path.join(runtimeDir(), manifest.id)
  try {
    fs.writeFileSync(okFile(manifest.id), JSON.stringify({
      id: manifest.id,
      files: state.files,
      unpackedBytes: state.unpackedBytes,
      at: new Date().toISOString()
    }), 'utf8')
    fs.writeFileSync(currentFile(), JSON.stringify({
      id: manifest.id,
      at: new Date().toISOString()
    }), 'utf8')
  } catch (e) {
    return fail('运行环境写入失败（磁盘空间或权限问题）', '写 runtime/current.json 失败：' + (e && (e as Error).message ? (e as Error).message : String(e)))
  }
  hfEnv.refreshBuiltinResources(dest)
  cleanOldPacks(manifest.id)
  state.stage = 'ready'
  state.percent = 100
  state.message = '运行环境已就绪（' + bytesText(state.unpackedBytes) + '）'
  push()
  writeLog('解包完成 id=' + manifest.id + ' 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒，来源 ' + state.source)
  return done(true)
}

// 旧的包目录留着没用（一个 632MB），解包成功后清掉；下载目录同理（包已解出来，留着只是占地方）
function cleanOldPacks(keepId: string): void {
  try {
    for (const e of fs.readdirSync(runtimeDir(), { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === keepId) continue
      try { fs.rmSync(path.join(runtimeDir(), e.name), { recursive: true, force: true }) } catch (e2) { /* 占用中则下次再清 */ }
    }
  } catch (e) { /* ignore */ }
}

function ensureRuntime(): Promise<{ ok: boolean; message?: string; detail?: string }> {
  if (state.stage === 'ready') return Promise.resolve(done(true))
  if (inFlight) return inFlight
  inFlight = run().catch((e) => fail('运行环境准备失败', String(e))).then((r) => {
    inFlight = null
    return r
  })
  return inFlight
}

const runtimeStatus = (): RuntimeProgressPayload => payload()
const runtimeRoot = (): string => hfEnv.BUILTIN_RESOURCES.root

// 启动即开始准备（不延迟）：曾经用 2 秒延迟换首屏，代价是全新安装白等这 2 秒才开始解包。
// 现在直接触发——① 需要同步做的只有几个 existsSync / statSync 探测（微秒级），重活（7za 解包、
// 远程包下载与 sha512 校验）本身都是异步的；② 早到的进度事件渲染层收不到也没关系，
// 外壳与设置页挂载时都会用 runtime:status 补齐当前状态。
function prepareInBackground(): void {
  void ensureRuntime()
}

function register(ctx: RegisterCtx): void {
  getWindow = ctx && ctx.getWindow ? ctx.getWindow : null
  ipcMain.handle(IPC.Runtime.Status, () => payload())
  ipcMain.handle(IPC.Runtime.Prepare, () => ensureRuntime())
  // 启动即准备（不延迟）；register 排在 index.ts 装配序列最后，只保证 handler 先挂上
  prepareInBackground()
}

export {
  register,
  ensureRuntime,
  prepareInBackground,
  runtimeStatus,
  runtimeRoot
}
