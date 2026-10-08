// src/main/index.ts —— MarvisStudio 主进程入口（装配器）
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
// 依赖图：settings ← htmlAgent ← projects ← voice ← ttsAlign；hfEnv ← video；无环。
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
