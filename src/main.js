// src/main.js —— MarvisStudio 主进程入口（装配器）
// 职责：app 生命周期、createWindow、窗口控制 IPC，以及业务域模块的 require + register 装配。
// 业务逻辑按域拆至 src/main/ 下：
//   hfEnv.js     环境探测与 HyperFrames 资源定位（纯函数）
//   settings.js  设置存储（settings.json）+ settings:* IPC
//   htmlAgent.js HTML 生成/修改的自定义模型 Agent（chatWithCustomModel）
//   projects.js  项目化流水线 + project:* IPC（含 copyAudioIntoProject，供 voice 引用）
//   voice.js     千问语音（声音复制/文字生音频）+ voice:* IPC
//   video.js     HTML 预览 / HyperFrames 转视频 + dialog:open-html / video:* IPC
// 依赖图：settings ← htmlAgent ← projects ← voice；hfEnv ← video；无环。
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

// 业务域模块（顶层 require 即可装配纯逻辑；含 IPC 的模块经 register 在窗口就绪后注册）
require('./main/hfEnv.js');
require('./main/settings.js');
require('./main/htmlAgent.js');
const projects = require('./main/projects.js');
const voice = require('./main/voice.js');
const video = require('./main/video.js');
require('./main/whisper.js');

// 窗口引用：供 IPC 窗口控制回调使用
let mainWindow = null;
const getWindow = () => mainWindow;

// ===== 窗口控制 IPC =====
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

function createWindow() {
  // 彻底移除默认应用菜单栏（避免出现 File/Edit/View）
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 同步最大化状态给渲染层（用于切换 最大化/还原 图标）
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-change', false);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // 注册各业务域 IPC（窗口已就绪；ctx.getWindow 使各模块的对话框以主窗口为父）
  const ctx = { getWindow };
  require('./main/settings.js').register(ctx);
  projects.register(ctx);
  voice.register(ctx);
  video.register(ctx);
  require('./main/whisper.js').register(ctx);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
