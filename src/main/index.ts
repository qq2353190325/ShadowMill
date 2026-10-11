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
// 依赖图：settings ← htmlAgent ← projects ← voice ← ttsAlign；hfEnv ← video；updater ← settings；无环。
// 打包输出 out/main/index.js；preload 输出 out/preload/index.js；渲染层输出 out/renderer/。
import { app, BrowserWindow, Menu, ipcMain, clipboard, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { IPC } from '../shared/ipc'
import type { RegisterCtx } from '../shared/types'
import * as settings from './settings'
import * as projects from './projects'
import * as voice from './voice'
import * as ttsAlign from './ttsAlign'
import * as video from './video'
import * as whisper from './whisper'
import * as updater from './updater'

// ===== userData 目录迁移：my-app → shadowmill =====
// 应用名（package.json 的 name）决定 userData 目录名，改名会让老用户的数据目录"看起来消失"
// （项目、设置、识别模型全在里面）。这里在**任何模块读写 userData 之前**做一次搬迁：
//   %APPDATA%\my-app  →  %APPDATA%\shadowmill
// 安全策略（任一不满足就放弃搬迁，绝不动老目录）：
//   ① 开发态也执行（不然 `npm run dev` 会看到"项目全没了"）；需要保留旧目录做对照时，
//      用环境变量 MIGRATE_USER_DATA=0 单次关闭；
//   ② 新目录已存在 ⇒ 视为已迁移过（或全新安装），不覆盖；
//   ③ 逐项搬迁：目标已存在同名项则跳过该项，只搬不会覆盖数据的部分；
//   ④ 整件事包在 try/catch 里，失败只记一条日志，绝不影响启动。
// 能这么做的前提：新版首次启动**必然**看到"新目录不存在 + 老目录存在"，此时两个目录里都还没有
// 本进程写入的任何文件（打点日志路径也是迁移之后才解析的），所以搬迁不会与自身写入打架。
// 名字故意写死成字面量（而不是读 package.json）：迁移后代码就不再引用旧名，
// 将来二次改名时，只需把这里的 oldName 换成新名字即可。
const LEGACY_APP_NAME = 'my-app';
const APP_NAME = app.getName(); // 取自 package.json 的 name
const USER_DATA_DIR = app.getPath('userData'); // %APPDATA%\<APP_NAME>

function migrateLegacyUserData(): void {
  try {
    if (process.env['MIGRATE_USER_DATA'] === '0') return;
    if (APP_NAME === LEGACY_APP_NAME) return;
    const base = path.dirname(USER_DATA_DIR);
    if (path.basename(USER_DATA_DIR).toLowerCase() !== APP_NAME.toLowerCase()) return; // 无法从目录名推导 ⇒ 放弃
    const oldDir = path.join(base, LEGACY_APP_NAME);
    const newDir = USER_DATA_DIR;
    if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return;
    fs.mkdirSync(newDir, { recursive: true });
    let moved = 0;
    let skipped = 0;
    let failed = 0;
    for (const entry of fs.readdirSync(oldDir)) {
      const src = path.join(oldDir, entry);
      const dst = path.join(newDir, entry);
      try {
        if (fs.existsSync(dst)) { skipped++; continue; }
        fs.renameSync(src, dst); // 同一分区内的目录改名是原子操作，不下沉拷贝
        moved++;
      } catch (e) {
        // 跨分区 / 目录被占用：退化为递归拷贝，失败则单独计数（不牵连其它项）
        try {
          fs.cpSync(src, dst, { recursive: true, errorOnExist: false });
          fs.rmSync(src, { recursive: true, force: true });
          moved++;
        } catch (e2) {
          failed++;
        }
      }
    }
    // 老目录已空则删掉；若仍有失败项则保留，便于人工取回
    try {
      if (fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir);
    } catch (e) { /* 留着重试也无妨 */ }
    fs.appendFileSync(
      path.join(newDir, 'startup.log'),
      new Date().toISOString() + ' userData 迁移 ' + LEGACY_APP_NAME + ' → ' + APP_NAME +
        '：搬迁 ' + moved + ' 项，跳过 ' + skipped + ' 项，失败 ' + failed + ' 项\n',
      'utf8'
    );
  } catch (e) { /* 迁移失败不影响启动；老数据仍在 %APPDATA%\my-app */ }
}
migrateLegacyUserData();

// ===== 启动时序打点（userData/startup.log）=====
// 首屏慢（「只有背景很久」）时用来定位时间花在哪一段：进程启动 → 主进程模块加载 → app ready
// → 建窗 → 页面开始加载 → DOM ready → 加载完成 → 首帧（ready-to-show）。
// 每行：ISO 时间 + 距**进程启动**的毫秒数 + 阶段；写盘用 appendFileSync（每次启动几行，<1ms），
// 文件超过 64KB 自动清一次，避免长期使用无限增长。打点失败一律静默——它不能影响启动。
// 路径在迁移之后解析一次并缓存：否则前面几行打点会把新目录提前建出来，让迁移误判为"已迁移过"。
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

  // 注册各业务域 IPC（窗口已就绪；ctx.getWindow 使各模块的对话框以主窗口为父）
  const ctx: RegisterCtx = { getWindow }
  settings.register(ctx)
  projects.register(ctx)
  voice.register(ctx)
  ttsAlign.register(ctx)
  video.register(ctx)
  whisper.register(ctx)
  updater.register(ctx)

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
