// src/main/index.ts —— ShadowMill（影坊）主进程入口（装配器）
// 职责：app 生命周期、createWindow、窗口控制 IPC，以及业务域模块的 import + register 装配。
// 业务逻辑按域拆至 src/main/ 下：
//   hfEnv.ts     环境探测与 HyperFrames 资源定位（纯函数）
//   settings.ts  设置存储（settings.json）+ settings:* IPC
//   htmlAgent.ts HTML 生成/修改的自定义模型 Agent（chatWithCustomModel）
//   projects.ts  项目化流水线 + project:* IPC（含 copyAudioIntoProject，供 voice 引用）
//   voice.ts     千问语音（音色管理/文字生音频）+ voice:* IPC
//   ttsAlign.ts  字幕配音逐句合成与时间对齐 + voice:synth-aligned / voice:align-cancel IPC
//   video.ts     预览 / HyperFrames 转视频 + dialog:open-html / video:* IPC
//   whisper.ts   whisper.cpp 字幕转录 + whisper:* IPC
//   updater.ts   应用自更新（electron-updater generic provider）+ update:* IPC
//   runtime.ts   运行环境包（ffmpeg/node/hyperframes/whisper 解包到 userData）+ runtime:* IPC
// 依赖图：settings ← htmlAgent ← projects ← voice ← ttsAlign；hfEnv ← video；updater ← settings；无环。
// 打包输出 out/main/index.js；preload 输出 out/preload/index.js；渲染层输出 out/renderer/。
import { app, BrowserWindow, Menu, ipcMain, clipboard, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { IPC } from '../shared/ipc'
import type { LegacyDataInfo, LegacyResolveAction, LegacyResolveResult, RegisterCtx } from '../shared/types'
import * as settings from './settings'
import * as projects from './projects'
import * as voice from './voice'
import * as ttsAlign from './ttsAlign'
import * as video from './video'
import * as whisper from './whisper'
import * as updater from './updater'
import * as runtime from './runtime'

// ===== 历史数据目录：启动时扫描 + 询问用户是否迁移 =====
// 背景：userData 目录名跟随 package.json 的 name（Electron 默认行为）。2026-10-12 品牌更名
// （my-app → shadowmill）后目录随之改变，老用户打开应用会看到"项目全没了"——数据其实还在
// %APPDATA%\my-app 里。
//
// 方案（2026-10-12 定稿，取代早先的「钉死目录名 + 身份标记自动认领」）：
//   · **不**改 userData 的位置，目录名继续跟随 name，保持 Electron 的默认语义；
//   · 扫描 LEGACY_DIR_NAMES，找到**确有应用数据**的老目录就由渲染层弹**应用内**弹窗让用户选：
//       迁移过来 / 删除旧数据 / 稍后再说
//   · 「迁移过来」复用下面的合并逻辑：白名单 + 递归 + 文件已存在就跳过（绝不覆盖）+ settings.json 特例；
//   · 「稍后再说」什么也不做，下次启动会再问一次——问题没解决就不该被静默遗忘。
// 为什么交给用户决定而不是静默迁移：静默搬迁会在用户毫无察觉的情况下挪动上 GB 的数据，
// 真出问题极难追查；而这个对话框本身就把「数据在哪、有多少、要怎么办」讲清楚了。
//
// ⚠ 代价（务必记住）：以后再改 package.json 的 name，**必须把旧名字加进 LEGACY_DIR_NAMES**，
//   这里没有任何自动发现机制。忘了加 → 用户又会看到"项目全没了"。
const LEGACY_DIR_NAMES = ['my-app'];
// 值得提示/迁移的应用自有条目（白名单）。**不列** Chromium 的 profile 目录
// （Cache / Code Cache / GPUCache / Local State / Network / IndexedDB …）：那是浏览器缓存，
// 跨目录搬没有意义；也不列 hf-projects（渲染临时目录，几百 MB 且可随时重新生成）。
// 以后新增应用自有条目时记得加进来。
const OWN_DATA_ENTRIES = ['projects', 'whisper', 'voice', 'tts-output', 'html-agent', 'settings.json'];
const USER_DATA_DIR = app.getPath('userData'); // %APPDATA%\<package.json 的 name>

// ===== 归属证明：光靠目录名不可信 =====
// 'my-app' 这种名字太通用，%APPDATA% 下完全可能有别的应用也叫这个。只按名字就去问"要不要迁移"，
// 有把别人数据搬进来的风险。所以扫到同名目录之后**必须先证明它是我们的**：
//   ① 目录里任意一个点开头的标记文件（**名字不限**）内容里的 appId 与我们一致 ⇒ 明确是我们的；
//   ② 否则看结构特征：<目录>\projects\<项目名>\project.json 存在 ⇒ 是我们的
//      —— 这一条是给「标记机制上线之前」的历史目录准备的（那时从没写过标记，比如 my-app）；
//   ③ 两条都不满足 ⇒ 不提示、不迁移（重名应用就挡在这里）。
// 标记由本文件在启动时写进当前 userData，内容含 appId / appName / dirName。
// 它现在的用途是**归属证明**：扫描 LEGACY_DIR_NAMES 里的目录时，靠它（或结构特征）确认那是我们的数据，
// 避免把同名的别的应用的数据搬进来。将来若想改成"不靠手工维护名字清单、按标记自动发现老目录"，
// 它就是现成的依据——但那需要额外设计（多候选怎么合并、何时停止提示），当前版本不做。
const DATA_MARKER = '.shadowmill-data';
const APP_ID = 'com.shadowmill.app'; // 与 package.json 的 build.appId 一致

type MergeStat = { moved: number; skipped: number; failed: number };

// 目录里有没有「属于本应用」的归属标记。
//
// **刻意不看文件名、只看文件内容里的 appId**。原因：标记名是各个版本按**当时的品牌/目录名**起的
// （.shadowmill-data / .my-app-data / …），而"改过几次名字"是无法穷举的——按固定名字依次尝试，
// 只要哪一次改名的组合没猜中（例如 package.json 的 name 与品牌名不一致时就存在这种组合），就会
// 静默漏掉自己的老目录，表现为"项目全没了"again。改成按内容认（appId 是我们独有的
// com.shadowmill.app），就跟标记叫什么名字完全无关，改多少次名都不会漏。
function hasOurIdentity(dir: string): boolean {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch (e) { return false; }
  for (const n of names) {
    // 标记文件一定是点开头的；.updaterId 这类非 JSON 的点文件会在 parse 那里被跳过
    if (!n.startsWith('.')) continue;
    const p = path.join(dir, n);
    try {
      if (fs.statSync(p).size > 64 * 1024) continue; // 标记文件必然很小，顺带避免误读大文件
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (raw && raw.appId === APP_ID) return true;
    } catch (e) { /* 不是 JSON / 不是标记：继续找 */ }
  }
  return false;
}

// 是不是我们这个应用的数据目录（判定依据见上方「归属证明」注释）
function isOurs(dir: string): boolean {
  if (hasOurIdentity(dir)) return true;
  try {
    const pj = path.join(dir, 'projects');
    for (const name of fs.readdirSync(pj)) {
      if (fs.existsSync(path.join(pj, name, 'project.json'))) return true;
    }
  } catch (e) { /* 没有 projects 目录 */ }
  return false;
}

// 在当前 userData 里落 / 更新归属标记（appId 或 dirName 变了才重写）
function writeIdentity(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, DATA_MARKER);
    const dirName = path.basename(dir);
    let cur: any = null;
    try { cur = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch (e) { cur = null; }
    if (cur && cur.appId === APP_ID && cur.dirName === dirName) return;
    fs.writeFileSync(marker, JSON.stringify({
      appId: APP_ID,
      appName: app.getName(),
      dirName,
      at: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) { /* 标记写不进去不影响使用，只是将来改名后认不出这个目录 */ }
}
writeIdentity(USER_DATA_DIR);

// 递归合并：两边都有的**目录**继续往下走，而不是整目录跳过——whisper/ 这种两边都存在的目录，
// 整目录跳过会把里面的 252MB 模型一起漏掉。两边都有的文件一律跳过，绝不覆盖。
function mergeTree(src: string, dst: string, st: MergeStat): void {
  try { fs.mkdirSync(dst, { recursive: true }); } catch (e) { /* 逐项写入时还会再报 */ }
  let names: string[] = [];
  try { names = fs.readdirSync(src); } catch (e) { return; }
  for (const name of names) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    let isDir = false;
    try { isDir = fs.statSync(s).isDirectory(); } catch (e) { continue; }
    if (isDir) { mergeTree(s, d, st); continue; }
    if (fs.existsSync(d)) { st.skipped++; continue; }
    try {
      fs.renameSync(s, d); // 同分区内是原子改名，不下沉拷贝
      st.moved++;
    } catch (e) {
      try { // 跨分区：退化为拷贝
        fs.copyFileSync(s, d);
        fs.rmSync(s, { force: true });
        st.moved++;
      } catch (e2) { st.failed++; }
    }
  }
}

// 自底向上删掉空目录（只删空的）；返回该目录是否已空
function pruneEmptyDirs(dir: string): boolean {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch (e) { return false; }
  let remaining = 0;
  for (const name of names) {
    const p = path.join(dir, name);
    let isDir = false;
    try { isDir = fs.statSync(p).isDirectory(); } catch (e) { remaining++; continue; }
    if (!isDir) { remaining++; continue; }
    if (pruneEmptyDirs(p)) {
      try { fs.rmdirSync(p); } catch (e) { remaining++; }
    } else remaining++;
  }
  return remaining === 0;
}

// 把 oldDir 的应用自有条目合并进当前 userData；返回统计。
// 迁移是**移动**而不是复制：同分区（都在 %APPDATA% 下）时 renameSync 是原子操作，上 GB 也是瞬间完成，
// 所以整个迁移不需要进度条。
function migrateFrom(oldDir: string): MergeStat {
  const st: MergeStat = { moved: 0, skipped: 0, failed: 0 };
  for (const name of OWN_DATA_ENTRIES) {
    const src = path.join(oldDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(USER_DATA_DIR, name);
    // 目标不存在 ⇒ 整个条目直接改名（升级场景的常态，也是最快路径）
    if (!fs.existsSync(dst)) {
      try { fs.renameSync(src, dst); st.moved++; continue; } catch (e) { /* 落到下面按文件合并 */ }
    }
    // settings.json 特例：它在新目录里基本必然已存在（应用启动时按默认值写过），而"目标已存在就
    // 跳过"会让用户的 API Key / 自定义音色 / 各档设置全部留在老目录。所以放宽为：
    // 只有当新文件**还是出厂状态**（用户在新位置什么都没配）时才用老配置覆盖，并且先备份。
    if (name === 'settings.json') {
      if (!settings.isPristineSettings(dst)) { st.skipped++; continue; }
      try {
        fs.copyFileSync(dst, dst + '.before-migrate.bak');
        fs.copyFileSync(src, dst);
        fs.rmSync(src, { force: true });
        st.moved++;
      } catch (e) { st.failed++; }
      continue;
    }
    mergeTree(src, dst, st);
  }
  return st;
}

// 扫历史目录：只认**确有应用数据**的（空壳——只剩 Chromium 缓存或空目录——不打扰用户）
function findLegacyData(): { dir: string; entries: string[]; projects: number } | null {
  try {
    const base = path.dirname(USER_DATA_DIR);
    for (const name of LEGACY_DIR_NAMES) {
      const dir = path.join(base, name);
      // 别把自己的目录当历史目录（正常不会同名，但 name 改回旧值时就会）
      if (dir.toLowerCase() === USER_DATA_DIR.toLowerCase()) continue;
      if (!fs.existsSync(dir)) continue;
      // 归属证明不通过就不提示：重名应用挡在这里，不会把别人的数据搬进来
      if (!isOurs(dir)) continue;
      const entries: string[] = [];
      for (const e of OWN_DATA_ENTRIES) {
        const p = path.join(dir, e);
        try {
          const st = fs.statSync(p);
          if (st.isDirectory() ? fs.readdirSync(p).length > 0 : st.size > 0) entries.push(e);
        } catch (err) { /* 该项不存在 */ }
      }
      if (!entries.length) continue;
      let projects = 0;
      try { projects = fs.readdirSync(path.join(dir, 'projects')).length; } catch (e) { /* 没有 projects */ }
      return { dir, entries, projects };
    }
  } catch (e) { /* 扫描失败不影响启动 */ }
  return null;
}

// 扫一次即缓存：渲染层可能多次问（外壳挂载、以后设置页也可能问），文件系统扫描只做一次。
// MIGRATE_USER_DATA=0 时整段功能关闭（自测用）。
let legacyScanned = false;
let legacyFound: LegacyDataInfo | null = null;
function legacyInfo(): LegacyDataInfo | null {
  if (process.env['MIGRATE_USER_DATA'] === '0') return null;
  if (!legacyScanned) {
    legacyScanned = true;
    try { legacyFound = findLegacyData(); } catch (e) { legacyFound = null; }
  }
  return legacyFound;
}

// 执行用户在弹窗里的选择（迁移 / 删除 / 稍后）。
// 迁移零失败、或删除成功后清掉缓存（本次会话不再提示）；「稍后」只记一条日志，
// 下次启动会重新扫、重新问——问题没解决就不该被静默遗忘。
function resolveLegacy(action?: LegacyResolveAction): LegacyResolveResult {
  const found = legacyInfo();
  const act: LegacyResolveAction = (action === 'migrate' || action === 'delete') ? action : 'later';
  if (!found) return { ok: false, action: act, message: '没有待处理的旧数据' };
  if (act === 'later') {
    bootLog('旧数据待处理（用户选择稍后）：' + found.dir);
    return { ok: true, action: act };
  }
  if (act === 'delete') {
    // 删除前再校验一次：只允许删 %APPDATA% 下、名字在 LEGACY_DIR_NAMES 里的目录
    const base = path.dirname(USER_DATA_DIR);
    const safe = LEGACY_DIR_NAMES.some((n) => path.join(base, n).toLowerCase() === found.dir.toLowerCase());
    if (!safe) return { ok: false, action: act, message: '该目录不在允许删除的名单内' };
    try {
      fs.rmSync(found.dir, { recursive: true, force: true });
      bootLog('旧数据目录已按用户选择删除：' + found.dir);
      legacyFound = null;
      return { ok: true, action: act };
    } catch (e) {
      const m = String((e as Error) && (e as Error).message ? (e as Error).message : e);
      bootLog('删除旧数据目录失败：' + m);
      return { ok: false, action: act, message: m };
    }
  }
  const st = migrateFrom(found.dir);
  if (pruneEmptyDirs(found.dir)) {
    try { fs.rmdirSync(found.dir); } catch (e) { /* 占用中：留着无妨 */ }
  }
  bootLog('旧数据迁移：搬迁 ' + st.moved + ' 项，跳过 ' + st.skipped + ' 项，失败 ' + st.failed + ' 项（' + found.dir + '）');
  if (st.failed === 0) legacyFound = null; // 干净迁移完就不再提示；有失败则保留，允许用户重试
  return {
    ok: st.failed === 0,
    action: act,
    moved: st.moved,
    skipped: st.skipped,
    failed: st.failed,
    message: st.failed ? '有 ' + st.failed + ' 项没能迁移（可能正被占用），可稍后重试' : ''
  };
}

// ===== 启动时序打点（userData/startup.log）=====
// 首屏慢（「只有背景很久」）时用来定位时间花在哪一段：进程启动 → 主进程模块加载 → app ready
// → 建窗 → 页面开始加载 → DOM ready → 加载完成 → 首帧（ready-to-show）。
// 每行：ISO 时间 + 距**进程启动**的毫秒数 + 阶段；写盘用 appendFileSync（每次启动几行，<1ms），
// 文件超过 64KB 自动清一次，避免长期使用无限增长。打点失败一律静默——它不能影响启动。
// 路径在这里解析一次并缓存：userData 位置只跟随 package.json 的 name，运行期不会变，缓存是安全的
// （projects.ts 里 projectsRoot() 之所以仍写成函数，是防将来有人重新引入 setPath 之类的改动）。
const BOOT_AT = Date.now() - Math.round(process.uptime() * 1000) // 进程启动时刻（用 uptime 反推，含 Electron 自身引导耗时）
const STARTUP_LOG = path.join(USER_DATA_DIR, 'startup.log');
function bootLog(stage: string): void {
  try {
    const file = STARTUP_LOG;
    try {
      if (fs.statSync(file).size > 64 * 1024) fs.rmSync(file);
    } catch (e) { /* 日志不存在：首次启动的正常情形 */ }
    fs.appendFileSync(file, new Date().toISOString() + ' +' + (Date.now() - BOOT_AT) + 'ms ' + stage + '\n', 'utf8');
  } catch (e) { /* 打点失败不影响启动 */ }
}
bootLog('main module loaded');

// ===== 预览文件协议 hgpreview://p/<encodeURIComponent(项目名)>/<相对路径> =====
// dev 下渲染层来自 http://localhost，Chromium 会拦截 file:// iframe（Not allowed to load local resource），
// 故 HTML 预览统一走本协议：主进程把 URL 路径映射回 userData\projects 下对应项目目录内文件。
// 须在 app ready 前声明特权（standard 保证相对路径解析、secure 对齐 file:// 的安全上下文行为）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'hgpreview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// 预览协议用 MIME 表（直接读字节构造 Response 时必须显式给出，缺省 octet-stream 会被 Chromium 严格 MIME 检查拦下脚本）
function previewMime(p: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8'
  };
  return map[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

// 窗口引用：供 IPC 窗口控制回调使用
let mainWindow: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => mainWindow

// ===== 窗口控制 IPC =====
ipcMain.on(IPC.Window.Minimize, () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on(IPC.Window.ToggleMaximize, () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on(IPC.Window.Close, () => {
  if (mainWindow) mainWindow.close()
})

// ===== 剪贴板 IPC（渲染层 sandbox 无 clipboard 模块，复制经主进程写入） =====
ipcMain.handle(IPC.App.CopyText, (_event, text: unknown) => {
  clipboard.writeText(String(text == null ? '' : text))
  return true
})

function createWindow(): void {
  // 彻底移除默认应用菜单栏（避免出现 File/Edit/View）
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    // 与设计系统 --bg-primary / index.html 启动画面同色：窗口在页面首帧之前也不会闪白，
    // 「窗口已出现但内容未上屏」的那一小段是品牌底色而不是空白。
    backgroundColor: '#0B1220',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  bootLog('window created')

  // 页面加载各阶段（首屏排查用；只打点，无业务副作用）
  mainWindow.webContents.on('did-start-loading', () => bootLog('page load start'))
  mainWindow.webContents.on('dom-ready', () => bootLog('dom ready'))
  mainWindow.webContents.on('did-finish-load', () => bootLog('page load finished'))
  mainWindow.on('ready-to-show', () => bootLog('first paint (ready-to-show)'))

  // dev：electron-vite 注入 ELECTRON_RENDERER_URL（HMR）；prod：加载构建产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 同步最大化状态给渲染层（用于切换 最大化/还原 图标）
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC.Window.MaximizedChange, true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC.Window.MaximizedChange, false)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  bootLog('app ready')
  // hgpreview 协议处理：仅允许读取目标项目目录内的文件（防目录穿越），供预览 iframe 与页面内相对素材引用。
  // 直接读文件字节构造 Response（net.fetch(file://) 在协议处理器内存在兼容性问题，易致预览空白）；
  // 失败/异常落盘 userData/preview-protocol.log，便于预览异常时排查。
  protocol.handle('hgpreview', (request) => {
    const log = (line: string): void => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'preview-protocol.log'), new Date().toISOString() + ' ' + line + '\n', 'utf8');
      } catch (e) { /* ignore */ }
    };
    try {
      const segs = new URL(request.url).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
      const name = segs[0];
      const rel = segs.slice(1).join('/');
      if (!name || !rel) { log('404 ' + request.url); return new Response('Not Found', { status: 404 }); }
      const dir = projects.projectDir(name);
      const full = path.resolve(dir, rel);
      if (full !== dir && !full.startsWith(dir + path.sep)) { log('403 ' + request.url); return new Response('Forbidden', { status: 403 }); }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { log('404 ' + request.url + ' -> ' + full); return new Response('Not Found', { status: 404 }); }
      const data = fs.readFileSync(full);
      return new Response(data as unknown as BodyInit, {
        headers: { 'Content-Type': previewMime(full), 'Cache-Control': 'no-store' }
      });
    } catch (e) {
      log('500 ' + request.url + ' ' + String((e as Error) && (e as Error).message ? (e as Error).message : e));
      return new Response('Bad Request', { status: 400 });
    }
  });

  createWindow()

  // 历史数据目录：主进程只回答「有没有 / 是什么」并执行用户的选择，**显示时机交给渲染层**
  // （应用内的 LegacyDataDialog）。所以既不在启动时糊一个原生对话框，也不需要"等首屏画完"的魔法延迟。
  ipcMain.handle(IPC.Legacy.Status, () => legacyInfo());
  ipcMain.handle(IPC.Legacy.Resolve, (_event, action?: LegacyResolveAction) => resolveLegacy(action));

  // 注册各业务域 IPC（窗口已就绪；ctx.getWindow 使各模块的对话框以主窗口为父）
  const ctx: RegisterCtx = { getWindow }
  settings.register(ctx)
  projects.register(ctx)
  voice.register(ctx)
  ttsAlign.register(ctx)
  video.register(ctx)
  whisper.register(ctx)
  updater.register(ctx)
  // 运行环境包（runtime.ts）：自己带 2s 延迟在后台解包，注册顺序放在最后（不抢启动时间）
  runtime.register(ctx)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 更新安装：updater.installNow() 已调用 quitAndInstall（由 electron-updater 自己重启应用），
  // 此处再 app.quit() 会与安装器抢退出流程，故直接返回
  if (updater.quitForUpdate()) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
