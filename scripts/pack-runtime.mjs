// scripts/pack-runtime.mjs —— 把 resources/ 打成「运行环境包」（runtime.7z + runtime.json）
//
// 背景（为什么需要这个包）：ffmpeg(180MB) / hyperframes(440MB, 4900+ 文件) / whisper(12.5MB)
// 合计约 632MB（node.exe 已不随包，见下方 EXCLUDE_TOP），是安装体积的大头，但**跨版本几乎不变**。NSIS 的更新是「整体卸载旧版 → 解压复制新包」，
// 这些文件每次更新都要重新解压+复制一遍（实测一次更新 97 秒，期间应用不存在、快捷方式失效）。
// 把 resources/ 换成一个 7z 包后：
//   ① 安装目录里的文件数从 ~4900 降到 1 个（安装期的解压/复制开销大幅下降）；
//   ② 应用首次启动时把包解到 userData/runtime/<id>/（有进度可展示），
//      之后更新只要包内容没变就**完全不动**这 632MB。
//
// 产物（都在 build/ 下，不进 git）：
//   build/runtime-pack/runtime.7z    运行环境包本体
//   build/runtime-pack/runtime.json  清单：id(内容 sha512 前 12 位) / file / sha512 / bytes / files / unpackedBytes
//   build/tools/7za.exe              解包器（随包发布，主进程用它解 runtime.7z）
//
// 用法：node scripts/pack-runtime.mjs [--force]
//   --force  忽略 sourceKey 缓存强制重打（默认：源目录指纹没变就跳过，省几分钟）
// 远程模式（把包放到更新源，安装包可再瘦一圈）：把 runtime.7z 与 runtime.json 上传到
//   app-update.yml 的 url 目录即可，应用在本地包缺失时会自动回退到下载。
//
// 依赖：只用 Node 内置模块 + 一个 7za/7z 可执行文件（优先复用 electron-builder 自己下到缓存里的那份）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = path.join(ROOT, 'resources')
const OUT_DIR = path.join(ROOT, 'build', 'runtime-pack')
const TOOLS_DIR = path.join(ROOT, 'build', 'tools')
const PACK_FILE = path.join(OUT_DIR, 'runtime.7z')
const MANIFEST_FILE = path.join(OUT_DIR, 'runtime.json')
const FORCE = process.argv.includes('--force')

// 不打进运行环境包的顶层条目。
// node：hyperframes 现在复用 Electron 内嵌的 Node（src/main/hfEnv.ts 的 findNode() 用
//   ELECTRON_RUN_AS_NODE 跑 process.execPath），这份 83MB 已实测为纯冗余（成片与用 node 22 逐项相同）。
//   ⚠ 要回退成「随包 node.exe」：把 'node' 从这里删掉即可，findNode() 会自动回落到它的 ② 分支
//   （<资源根>/node/node.exe）——注意 resources/node 目录本身要留着，否则回落也无处可去。
const EXCLUDE_TOP = ['node']

function log(msg) { process.stdout.write('[runtime-pack] ' + msg + '\n') }
function fail(msg) { process.stderr.write('[runtime-pack] ' + msg + '\n'); process.exit(1) }

// ===== 1. 找 7za =====
// 顺序刻意如此：electron-builder 打包 NSIS 时必然已经把 7zip 下到缓存（本机路径里的版本号目录随机），
// 复用它就不用额外装环境；再退到 PATH 与常见安装目录。
function find7za() {
  const candidates = []
  const env = process.env
  for (const k of ['SEVEN_ZIP', 'SEVENZA', 'SEVENZIP']) {
    if (env[k] && fs.existsSync(env[k])) candidates.push(env[k])
  }
  const base = env.LOCALAPPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Local')
  const cacheDir = path.join(base, 'electron-builder', 'Cache')
  if (fs.existsSync(cacheDir)) {
    for (const d of fs.readdirSync(cacheDir)) {
      if (!/^7zip@/i.test(d)) continue
      const full = path.join(cacheDir, d)
      for (const sub of fs.readdirSync(full)) {
        for (const name of ['7za.exe', '7z.exe']) {
          const p = path.join(full, sub, 'bin', name)
          if (fs.existsSync(p)) candidates.push(p)
        }
      }
    }
  }
  for (const rel of [
    'node_modules/7zip-bin/win/x64/7za.exe',
    'node_modules/7zip-bin/win/ia32/7za.exe',
    'node_modules/7zip-bin/linux/x64/7za',
    'node_modules/7zip-bin/mac/x64/7za',
    'node_modules/electron-winstaller/vendor/7z.exe'
  ]) {
    const p = path.join(ROOT, rel)
    if (fs.existsSync(p)) candidates.push(p)
  }
  for (const p of ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe']) {
    if (fs.existsSync(p)) candidates.push(p)
  }
  const where = spawnSync('where.exe', ['7za'], { encoding: 'utf8' })
  if (where.status === 0 && where.stdout) {
    const line = where.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l)
    if (line && fs.existsSync(line)) candidates.push(line)
  }
  if (!candidates.length) {
    fail('找不到 7za.exe / 7z.exe。请先跑一次 npm run pack（electron-builder 会把它下到缓存），或安装 7-Zip 后重试。')
  }
  return candidates[0]
}

// ===== 2. 源目录指纹（决定要不要重打）=====
function scanSource() {
  let files = 0
  let bytes = 0
  let maxMtime = 0
  const stack = [SRC_DIR]
  while (stack.length) {
    const cur = stack.pop()
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (cur === SRC_DIR && EXCLUDE_TOP.includes(e.name)) continue
      const full = path.join(cur, e.name)
      if (e.isDirectory()) { stack.push(full); continue }
      if (!e.isFile()) continue
      const st = fs.statSync(full)
      files++
      bytes += st.size
      if (st.mtimeMs > maxMtime) maxMtime = Math.floor(st.mtimeMs)
    }
  }
  return { files, bytes, maxMtime, key: files + ':' + bytes + ':' + maxMtime }
}

// ===== 3. 打包 =====
function buildPack(sevenZip) {
  if (!fs.existsSync(SRC_DIR)) fail('缺少 resources/ 目录：' + SRC_DIR)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(TOOLS_DIR, { recursive: true })

  const src = scanSource()
  if (!FORCE && fs.existsSync(PACK_FILE) && fs.existsSync(MANIFEST_FILE)) {
    try {
      const old = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
      if (old && old.sourceKey === src.key) {
        log('源目录指纹未变（' + src.key + '），跳过重打：' + path.relative(ROOT, PACK_FILE))
        copy7za(sevenZip)
        return
      }
    } catch (e) { /* 清单坏了就重打 */ }
  }

  // 顶层条目显式列出（不用 "*"：spawn 不经 shell，通配符展开交给 7z 反而不确定）
  const entries = fs.readdirSync(SRC_DIR)
    .filter((n) => !EXCLUDE_TOP.includes(n))
    .filter((n) => fs.existsSync(path.join(SRC_DIR, n)))
  if (!entries.length) fail('resources/ 是空的，没有可打包的内容')
  try { fs.rmSync(PACK_FILE, { force: true }) } catch (e) { /* ignore */ }

  log('开始打包 ' + entries.length + ' 个顶层条目（' + (src.bytes / 1024 / 1024).toFixed(1) + ' MB / ' + src.files + ' 文件），这一步要几分钟…')
  // -mx=9 最高压缩；-mtm/-mta/-mtc=off 抹掉时间戳 ⇒ 输入相同则字节完全相同（差分下载与内容 id 都依赖这一点）
  const args = ['a', '-t7z', '-mx=9', '-mmt=on', '-bd', '-mtm=off', '-mta=off', '-mtc=off', PACK_FILE].concat(entries)
  const t0 = Date.now()
  const r = spawnSync(sevenZip, args, { cwd: SRC_DIR, stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) fail('7za 打包失败（退出码 ' + r.status + '）：' + sevenZip + ' ' + args.join(' '))
  log('打包完成，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒')

  const buf = fs.readFileSync(PACK_FILE)
  const sha512 = crypto.createHash('sha512').update(buf).digest('base64')
  const manifest = {
    id: 'r' + crypto.createHash('sha512').update(buf).digest('hex').slice(0, 12),
    file: path.basename(PACK_FILE),
    sha512,
    bytes: buf.length,
    files: src.files,
    unpackedBytes: src.bytes,
    sourceKey: src.key,
    appVersion: readAppVersion(),
    createdAt: new Date().toISOString()
  }
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8')
  copy7za(sevenZip)
  log('包体积 ' + (manifest.bytes / 1024 / 1024).toFixed(1) + ' MB（解包后 ' + (manifest.unpackedBytes / 1024 / 1024).toFixed(1) + ' MB / ' + manifest.files + ' 文件），id=' + manifest.id)
  log('清单：' + path.relative(ROOT, MANIFEST_FILE))
}

function copy7za(sevenZip) {
  const dest = path.join(TOOLS_DIR, process.platform === 'win32' ? '7za.exe' : '7za')
  try {
    fs.copyFileSync(sevenZip, dest)
    log('解包器已就位：' + path.relative(ROOT, dest))
  } catch (e) {
    fail('复制 7za 失败：' + (e && e.message ? e.message : e))
  }
}

function readAppVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''
  } catch (e) {
    return ''
  }
}

const sevenZip = find7za()
log('使用 7-Zip：' + sevenZip)
buildPack(sevenZip)
