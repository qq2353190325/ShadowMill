// scripts/pack-runtime.mjs —— 把 resources/ 打成「运行环境包」（每类资源一个 7z + 一份清单）
//
// 背景（为什么需要运行环境包）：ffmpeg(180MB) / hyperframes(440MB) / whisper(12.5MB) 是安装体积的大头，
// 但**跨版本几乎不变**。NSIS 的更新是「整体卸载旧版 → 解压复制新包」，这些文件每次更新都要重新解压+复制
// 一遍（实测一次更新 97 秒，期间应用不存在、快捷方式失效）。改成「安装包里不带、首次用到时下载成 7z 再解到
// userData」之后：① 安装包从约 258MB 降到约 145MB；② 更新只下载变过的那一类资源；③ 解包交给应用自己做（有进度）。
//
// 分包规则（2026-10 定的，详见 docs/runtime-pack-split.md）：
//   ffmpeg       —— 被「转录转码」与「HyperFrames 渲染」两条线共用，独立成包，两边都不为对方的升级买单
//   hyperframes  —— 只有渲染要（内含 chrome-headless-shell 268MB，所以这一包最大）
//   whisper      —— **不进任何包**：只 12.5MB（gzip 后 4.4MB），但「文字转字幕」缺它就完全不能用，
//                   因此改为随安装包（package.json 的 extraResources），换来「装完即离线可用」
//   node         —— 已整条移除（findNode() 复用 Electron 内嵌 Node；历史与回退后路见 src/main/hfEnv.ts）
//
// 产物（都在 build/ 下，不进 git）：
//   build/runtime-pack/ffmpeg.7z      + ffmpeg.json
//   build/runtime-pack/hyperframes.7z + hyperframes.json
//   build/tools/7za.exe               解包器（随包发布，主进程用它解 7z）
//   清单字段：name / id(内容 sha512 前 12 位) / file / sha512 / bytes / files / unpackedBytes / sourceKey / appVersion / createdAt
//
// 用法：node scripts/pack-runtime.mjs [--only <name>] [--force] [--list]
//   --only <name>  只打某一个包（本地迭代用；显式指定即视为该包强制重打）
//   --force        忽略 sourceKey 缓存，强制重打全部（默认：源指纹没变就跳过，省几分钟）
//   --list         只打印包定义与是否命中缓存，不打包
// 远程模式：把 <name>.7z 与 <name>.json 上传到 app-update.yml 的 url 目录即可，应用在本地无包时自动下载。
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

// ===== 包定义：一个包 = 一批要进同一个 7z 的顶层目录 =====
const PACKS = [
  { name: 'ffmpeg', roots: ['ffmpeg'] },
  { name: 'hyperframes', roots: ['hyperframes'] }
]

// 不进任何包的顶层条目（它们要么随安装包、要么已删除）：
//   whisper —— 随安装包（extraResources），见文件头说明
//   node    —— 已删除（resources/node 不存在了）
//   ⚠ 若将来又要「随包 node.exe」（例如关掉 Electron 的 RunAsNode 熔丝后必须回退）：
//     把 resources/node/node.exe 放回来，并在这里去掉 'node'、同时在 PACKS 里加一个含 'node' 的包。
const EXCLUDE_TOP = ['whisper', 'node']

const ARGV = process.argv.slice(2)
const FORCE = ARGV.includes('--force')
const LIST = ARGV.includes('--list')
const ONLY = (() => {
  const i = ARGV.indexOf('--only')
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : ''
})()

function log(msg) { process.stdout.write('[runtime-pack] ' + msg + '\n') }
function fail(msg) { process.stderr.write('[runtime-pack] ' + msg + '\n'); process.exit(1) }

const packFile = (name) => path.join(OUT_DIR, name + '.7z')
const manifestFile = (name) => path.join(OUT_DIR, name + '.json')

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
// ⚠ 指纹必须只覆盖**真正进这个包的那部分文件**，并且把 roots 一起算进去：
//   曾经是「整棵 resources/ 树的 files:bytes:maxMtime」，于是改 EXCLUDE_TOP（例如把 whisper 从包里拿掉）
//   时指纹一个字节都不变，脚本会以为「源没变」而继续复用旧包——产物与预期不符却毫无提示。
//   现在指纹 = <包名>:<roots 排序后拼接>:<files>:<bytes>:<maxMtime>，扫描范围限定在包内。
function scanSource(roots) {
  let files = 0
  let bytes = 0
  let maxMtime = 0
  const stack = roots.map((r) => path.join(SRC_DIR, r))
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch (e) {
      fail('读不到要打包的目录：' + cur + '（' + (e && e.message ? e.message : e) + '）')
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) { stack.push(full); continue }
      if (!e.isFile()) continue
      const st = fs.statSync(full)
      files++
      bytes += st.size
      if (st.mtimeMs > maxMtime) maxMtime = Math.floor(st.mtimeMs)
    }
  }
  return { files, bytes, maxMtime, key: roots.slice().sort().join(',') + ':' + files + ':' + bytes + ':' + maxMtime }
}

function comboKey(pack, src) {
  return pack.name + ':' + src.key
}

// ===== 3. 打包 =====
function buildPack(sevenZip, pack, force) {
  for (const r of pack.roots) {
    if (!fs.existsSync(path.join(SRC_DIR, r))) fail('缺少要打包的目录：' + path.join(SRC_DIR, r))
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(TOOLS_DIR, { recursive: true })

  const src = scanSource(pack.roots)
  const key = comboKey(pack, src)
  const out = packFile(pack.name)

  if (!force && fs.existsSync(out) && fs.existsSync(manifestFile(pack.name))) {
    try {
      const old = JSON.parse(fs.readFileSync(manifestFile(pack.name), 'utf8'))
      if (old && old.sourceKey === key) {
        log('[' + pack.name + '] 源指纹未变（' + key + '），跳过重打：' + path.relative(ROOT, out))
        return
      }
      if (old && old.sourceKey && old.sourceKey !== key && !old.sourceKey.startsWith(pack.name + ':')) {
        log('[' + pack.name + '] 旧清单是单包时代的格式，重建')
      }
    } catch (e) { /* 清单坏了就重打 */ }
  }
  if (LIST) {
    log('[' + pack.name + '] 需要重打（指纹 ' + key + '）')
    return
  }

  // 顶层条目显式列出（不用 "*"：spawn 不经 shell，通配符展开交给 7z 反而不确定）
  const entries = pack.roots.filter((r) => fs.existsSync(path.join(SRC_DIR, r)))
  if (!entries.length) fail('[' + pack.name + '] 没有可打包的内容')
  try { fs.rmSync(out, { force: true }) } catch (e) { /* ignore */ }

  log('[' + pack.name + '] 开始打包 ' + entries.length + ' 个顶层条目（' + (src.bytes / 1024 / 1024).toFixed(1) + ' MB / ' + src.files + ' 文件），这一步要几分钟…')
  // -mx=9 最高压缩；-mtm/-mta/-mtc=off 抹掉时间戳 ⇒ 输入相同则字节完全相同（不重复下载与内容 id 都依赖这一点）
  const args = ['a', '-t7z', '-mx=9', '-mmt=on', '-bd', '-mtm=off', '-mta=off', '-mtc=off', out].concat(entries)
  const t0 = Date.now()
  const r = spawnSync(sevenZip, args, { cwd: SRC_DIR, stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) fail('[' + pack.name + '] 7za 打包失败（退出码 ' + r.status + '）：' + sevenZip + ' ' + args.join(' '))
  log('[' + pack.name + '] 打包完成，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒')

  const buf = fs.readFileSync(out)
  const sha512 = crypto.createHash('sha512').update(buf).digest('base64')
  const manifest = {
    name: pack.name,
    id: 'r' + crypto.createHash('sha512').update(buf).digest('hex').slice(0, 12),
    file: path.basename(out),
    sha512,
    bytes: buf.length,
    files: src.files,
    unpackedBytes: src.bytes,
    sourceKey: key,
    appVersion: readAppVersion(),
    createdAt: new Date().toISOString()
  }
  fs.writeFileSync(manifestFile(pack.name), JSON.stringify(manifest, null, 2), 'utf8')
  log('[' + pack.name + '] 包体积 ' + (manifest.bytes / 1024 / 1024).toFixed(1) + ' MB（解包后 ' +
      (manifest.unpackedBytes / 1024 / 1024).toFixed(1) + ' MB / ' + manifest.files + ' 文件），id=' + manifest.id)
  log('[' + pack.name + '] 清单：' + path.relative(ROOT, manifestFile(pack.name)))
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

// 单包时代的遗留产物：runtime.7z / runtime.json（现在改为按包各产一份）。
// 留着既占 147 MB，又容易被误当成「本次的包」上传到更新源，故自动清掉（只删这两个固定名）。
function cleanLegacySinglePack() {
  for (const name of ['runtime.7z', 'runtime.json']) {
    const p = path.join(OUT_DIR, name)
    if (!fs.existsSync(p)) continue
    try {
      fs.rmSync(p, { force: true })
      log('已清理单包时代遗留产物：' + path.relative(ROOT, p))
    } catch (e) {
      log('遗留产物删不掉（可能被占用）：' + path.relative(ROOT, p))
    }
  }
}

function readAppVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''
  } catch (e) {
    return ''
  }
}

// ===== 主流程 =====
if (!fs.existsSync(SRC_DIR)) fail('缺少 resources/ 目录：' + SRC_DIR)
if (ONLY && !PACKS.some((p) => p.name === ONLY)) {
  fail('--only 只认这些包名：' + PACKS.map((p) => p.name).join(' / '))
}
const targets = ONLY ? PACKS.filter((p) => p.name === ONLY) : PACKS
const sevenZip = find7za()
log('使用 7-Zip：' + sevenZip)
log('包定义：' + PACKS.map((p) => p.name + '(' + p.roots.join('+') + ')').join('，') +
    '；排除顶层条目：' + (EXCLUDE_TOP.length ? EXCLUDE_TOP.join(' / ') : '（无）'))
for (const pack of targets) {
  // --only 显式指定 = 这个包强制重打
  buildPack(sevenZip, pack, FORCE || (!!ONLY && pack.name === ONLY))
}
if (!LIST) {
  cleanLegacySinglePack()
  copy7za(sevenZip)
}
log(LIST ? '（--list：只检查，未打包）' : '全部完成。')
