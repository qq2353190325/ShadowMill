// scripts/release.mjs —— 发版上传 + 自检（手工上传漏文件是「差量更新退回全量」的头号原因）
//
// 为什么需要它：electron-builder 的 generic provider **不会自动上传**任何东西，而要让「只更新改动的部分」
// 真正成立，每次发版必须把这几样一起放上去，缺一样就退化成全量下载：
//   ① ShadowMill Setup <版本>.exe            安装包本体
//   ② ShadowMill Setup <版本>.exe.blockmap   差量下载的元数据（漏传 ⇒ 客户端退回全量下 145MB+）
//   ③ latest.yml                             版本清单（客户端只认它）
//   ④ ffmpeg.7z / ffmpeg.json                运行环境包（分包，见 docs/runtime-pack-split.md）
//   ⑤ hyperframes.7z / hyperframes.json
// OSS 侧要求：bucket 公共读（generic provider 匿名 GET）+ **支持 Range**（断点续传与差量下载都依赖它）。
//
// 用法：
//   npm run ship                     ★ 一条命令：出安装包（dist 全流程）+ 把七个文件集中到 release-output/
//   node scripts/release.mjs --stage [--dir <目录>]      只集中已产出的文件（默认 release-output/），附 UPLOAD.txt
//   node scripts/release.mjs --dry-run                   只检查本地文件齐不齐、要传哪些（不上传）
//   node scripts/release.mjs --verify-only               只做远端自检（匿名 GET + Range 206）
//   node scripts/release.mjs --oss --bucket <bucket>     直接用 ossutil 传（需已装 ossutil + 配好 AK）
//   node scripts/release.mjs --checklist                 打印手工上传清单（不想用脚本时照它做）
//
// 出包方式（任选，都不需要额外依赖）：
//   --stage [--dir <dir>]   把七个文件集中到一个目录 + 写 UPLOAD.txt（手动上传的主路径；--copy 是它的别名）
//   --oss --bucket <name>   阿里云 OSS：调 ossutil（需已安装并配置好 AK，或用上面的环境变量）
//   --rclone <remote:path>  任何 rclone 支持的远端（S3 / WebDAV / 网盘…）
//   --copy <dir>            同 --stage（保留旧名字，语义一致）
//
// ⚠ 发版前先升 package.json 的 version：客户端只比较版本号，远端与已装同号时老用户收不到提示。
// 不带任何后端参数时等价于 --dry-run。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PACK_DIR = path.join(ROOT, 'build', 'runtime-pack')
const ARGV = process.argv.slice(2)
const has = (f) => ARGV.includes(f)
const opt = (name) => {
  const i = ARGV.indexOf(name)
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : ''
}

const DRY = has('--dry-run') || (!has('--oss') && !has('--rclone') && !has('--copy') && !has('--stage') && !has('--verify-only') && !has('--checklist'))
const VERIFY_ONLY = has('--verify-only')
const CHECKLIST = has('--checklist')

function log(msg) { process.stdout.write('[release] ' + msg + '\n') }
function fail(msg) { process.stderr.write('[release] ✗ ' + msg + '\n'); process.exit(1) }

// ===== 1. 读版本与发布地址 =====
function readPkg() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  } catch (e) {
    fail('读不到 package.json：' + (e && e.message ? e.message : e))
  }
}
const pkg = readPkg()
const version = pkg.version || ''
const publishUrl = (pkg.build && pkg.build.publish && pkg.build.publish[0] && pkg.build.publish[0].url) || ''
if (!version) fail('package.json 里没有 version')

// ===== 2. 收集本次要传的文件（缺哪个就明确报出来）=====
function collect() {
  const files = []
  const add = (abs, why, required = true) => {
    const exists = fs.existsSync(abs)
    files.push({ abs, name: path.basename(abs), why, required, exists, bytes: exists ? fs.statSync(abs).size : 0 })
  }
  const setup = path.join(DIST, 'ShadowMill Setup ' + version + '.exe')
  add(setup, '安装包（差量更新的基线）')
  add(setup + '.blockmap', '差量下载元数据（漏传 ⇒ 客户端每次全量下）')
  add(path.join(DIST, 'latest.yml'), '版本清单（客户端只认它）')
  for (const name of ['ffmpeg', 'hyperframes']) {
    add(path.join(PACK_DIR, name + '.7z'), '运行环境包：' + name)
    add(path.join(PACK_DIR, name + '.json'), '运行环境包清单：' + name)
  }
  return files
}

const files = collect()
const missing = files.filter((f) => f.required && !f.exists)

// ===== 3. 自检：远端匿名可读 + Range 支持 =====
async function head(url) {
  try {
    const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } })
    return { status: r.status, len: r.headers.get('content-length') }
  } catch (e) {
    return { status: 0, error: String((e && e.message) || e) }
  }
}

async function verify() {
  if (!publishUrl) {
    log('package.json 的 build.publish[0].url 为空，跳过远端自检')
    return
  }
  const base = publishUrl.replace(/\/+$/, '/')
  log('远端自检（匿名 GET + Range）：' + base)
  const targets = ['latest.yml', 'ffmpeg.json', 'hyperframes.json']
  let bad = 0
  for (const t of targets) {
    const r = await head(base + t)
    // 206 = 支持 Range（断点续传 / 差量下载依赖它）；200 也能用，但断点续传会退化为整包重下
    const okStatus = r.status === 206 || r.status === 200
    if (!okStatus) bad++
    log('  ' + (okStatus ? '✓' : '✗') + ' ' + t + ' → HTTP ' + r.status + (r.status === 206 ? '（支持 Range）' : (r.status === 200 ? '（**不支持 Range**：断点续传会退化）' : '')) + (r.error ? ' ' + r.error : ''))
  }
  if (bad) log('有 ' + bad + ' 个远端文件不可匿名读取：检查 bucket 公共读 / 是否已上传')
  else log('远端自检通过')
}

// ===== 4. 上传后端 =====
// 七个文件按上传顺序排列：**先传大的、最后传三个小的开关文件**（latest.yml 与两份 pack.json）。
// 原因是客户端靠那三个小文件判断「要不要更新 / 要不要下运行环境包」——先把大文件摆好，
// 最后再翻开开关，就不会出现「清单说更新、文件还没传完」的窗口（对象存储没有事务）。
// 顺序：0 安装包本体 → 1 差量元数据 → 2 运行环境包正文 → 9 三个清单（list 里 required=true 的按此序）
const STAGE_MANIFEST = 'UPLOAD.txt'

function uploadOrder(f) {
  if (/Setup .*\.exe$/.test(f.name)) return 0
  if (f.name.endsWith('.blockmap')) return 1
  if (f.name.endsWith('.7z')) return 2
  return 9 // latest.yml 与两份 *.json：最后传
}

function orderHint(f) {
  const o = uploadOrder(f)
  return o === 0 ? '① 安装包本体' : o === 1 ? '② 差量元数据' : o === 2 ? '③ 运行环境包正文' : '④ 清单（最后传）'
}

/** 把七个文件集中到一个目录，并写一份 UPLOAD.txt（含 OSS 路径 + 上传顺序 + 校验值） */
function stageTo(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const sorted = files.slice().sort((a, b) => (uploadOrder(a) - uploadOrder(b)) || a.name.localeCompare(b.name))
  const lines = []
  lines.push('ShadowMill ' + version + ' 发版上传清单')
  lines.push('生成时间：' + new Date().toISOString())
  lines.push('目标目录：' + (publishUrl || '(package.json 里未配置 build.publish.url)'))
  lines.push('')
  lines.push('用法：把本目录下的七个文件**按下面顺序**原样传到上面那个目录（名字一个字都不要改）。')
  lines.push('      大文件先传、三个清单最后传：客户端靠清单判断「要不要更新 / 要不要下运行环境包」，')
  lines.push('      顺序反了会出现「清单说更新、文件还没传完」的窗口。')
  lines.push('      传完可用 `npm run release -- --verify-only` 匿名自检。')
  lines.push('')
  let n = 0
  for (const f of sorted) {
    if (!f.exists) continue
    n++
    const dest = path.join(dir, f.name)
    fs.copyFileSync(f.abs, dest)
    lines.push(n + '. ' + orderHint(f) + '  ' + f.name + '  （' + (f.bytes / 1024 / 1024).toFixed(2) + ' MB）')
    lines.push('   来源：' + path.relative(ROOT, f.abs))
    lines.push('   去向：' + (publishUrl || '') + f.name)
    if (f.name.endsWith('.7z') || f.name.endsWith('.json')) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f.name.replace(/\.7z$/, '.json')), 'utf8'))
        if (f.name.endsWith('.7z')) lines.push('   sha512：' + m.sha512)
        else lines.push('   id：' + m.id + '  bytes：' + m.bytes)
      } catch (e) { /* 清单读不到就跳过 */ }
    }
    lines.push('')
  }
  lines.push('注：.exe 与同名 .blockmap 必须成对存在；.json 与同名 .7z 必须成对存在。')
  fs.writeFileSync(path.join(dir, STAGE_MANIFEST), lines.join('\n'), 'utf8')
  log('七个文件已集中到：' + dir + '（附 ' + STAGE_MANIFEST + '）')
  log('按里面的顺序传到 ' + (publishUrl || '(更新源)') + ' 即可；传完跑 npm run release -- --verify-only 自检')
}

function copyBackend(dir) {
  stageTo(dir)
}

function rcloneBackend(remote) {
  const r = spawnSync('rclone', ['copy', PACK_DIR, remote, '--include', '*.7z', '--include', '*.json'], { stdio: 'inherit' })
  if (r.status !== 0) fail('rclone 上传运行环境包失败（退出码 ' + r.status + '）')
  for (const f of files) {
    if (!f.exists || f.abs.startsWith(PACK_DIR)) continue
    const rr = spawnSync('rclone', ['copy', path.dirname(f.abs), remote, '--include', f.name], { stdio: 'inherit' })
    if (rr.status !== 0) fail('rclone 上传 ' + f.name + ' 失败（退出码 ' + rr.status + '）')
  }
  log('rclone 上传完成')
}

function ossBackend(bucket) {
  const which = spawnSync('where.exe', ['ossutil'], { encoding: 'utf8' })
  if (which.status !== 0) {
    fail('找不到 ossutil。两个选择：① 装一个 ossutil 并配置好 AK；② 用 --copy <dir> 导出文件后手工上传（脚本会打印清单）')
  }
  const env = { ...process.env }
  if (env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET) {
    env.OSS_ACCESS_KEY_ID = env.OSS_ACCESS_KEY_ID
  }
  for (const f of files) {
    if (!f.exists) continue
    const dest = 'oss://' + bucket + '/shadowmill/' + f.name
    const args = ['cp', '-f', f.abs, dest]
    if (env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET) {
      args.push('--access-key-id', env.OSS_ACCESS_KEY_ID, '--access-key-secret', env.OSS_ACCESS_KEY_SECRET)
    }
    const r = spawnSync('ossutil', args, { stdio: 'inherit', env })
    if (r.status !== 0) fail('ossutil 上传 ' + f.name + ' 失败（退出码 ' + r.status + '）')
    log('已上传：' + f.name)
  }
}

// ===== 5. 主流程 =====
async function main() {
  if (CHECKLIST) {
    log('发版上传清单（版本 ' + version + '，目标 ' + (publishUrl || '(未配置)') + '）：')
    for (const f of files) log('  ' + (f.exists ? '✓' : '✗ 缺') + ' ' + f.name + '   ' + f.why)
    return
  }

  log('版本 ' + version + '，目标 ' + (publishUrl || '(未配置 publish.url)'))
  for (const f of files) {
    log('  ' + (f.exists ? '✓' : '✗ 缺') + ' ' + f.name + '（' + (f.bytes / 1024 / 1024).toFixed(1) + ' MB）   ' + f.why)
  }
  if (missing.length) {
    fail('缺 ' + missing.length + ' 个必传文件：' + missing.map((m) => m.name).join('、') +
      '\n  提示：安装包与 latest.yml / blockmap 由 npm run dist 产出；运行环境包由 npm run runtime:pack 产出')
  }

  if (VERIFY_ONLY) { await verify(); return }

  // --stage [--dir <目录>]：把七个文件集中到一个目录（默认 release-output/）+ 写 UPLOAD.txt。
  // 这是「手动上传」的主路径，也等价于 --copy <目录>。
  if (has('--stage')) {
    stageTo(path.resolve(opt('--dir') || path.join(ROOT, 'release-output')))
    return
  }
  if (DRY) { log('（--dry-run：只检查，不上传）'); await verify(); return }

  const copyDir = opt('--copy')
  const remote = opt('--rclone')
  const bucket = opt('--bucket')
  if (copyDir) copyBackend(copyDir)
  else if (remote) rcloneBackend(remote)
  else if (has('--oss')) {
    if (!bucket) fail('--oss 需要 --bucket <bucket名>')
    ossBackend(bucket)
  } else {
    fail('没有指定上传后端：用 --stage / --oss --bucket <name> / --rclone <remote> / --copy <dir>，或 --dry-run 只检查')
  }
  await verify()
}

void main().catch((e) => fail(String((e && e.message) || e)))
