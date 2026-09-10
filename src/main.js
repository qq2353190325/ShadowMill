const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

// 窗口引用：供 IPC 窗口控制回调使用
let mainWindow = null;

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

  mainWindow.loadFile('index.html');

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

// ===== HTML 预览 / HyperFrames 转视频 =====

// ===== 内置依赖资源定位（打包后由 electron-builder extraResources 投放至 resources）=====
const BUILTIN_RESOURCES = (() => {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
  const exists = (p) => fs.existsSync(p);

  // chrome-headless-shell 可执行：<root>\hyperframes\chrome\chrome-headless-shell\**\chrome-headless-shell.exe
  let chromeShell = null;
  try {
    const base = path.join(root, 'hyperframes', 'chrome', 'chrome-headless-shell');
    if (exists(base)) {
      const stack = [base];
      while (stack.length && !chromeShell) {
        const cur = stack.pop();
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          if (e.isDirectory()) stack.push(path.join(cur, e.name));
          else if (/^chrome-headless-shell\.exe$/i.test(e.name)) {
            chromeShell = path.join(cur, e.name);
            break;
          }
        }
      }
    }
  } catch (e) { chromeShell = null; }

  return {
    root,
    node: path.join(root, 'node', 'node.exe'),
    ffmpegBin: path.join(root, 'ffmpeg', 'bin'),
    ffmpeg: path.join(root, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ffprobe: path.join(root, 'ffmpeg', 'bin', 'ffprobe.exe'),
    hfCli: path.join(root, 'hyperframes', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
    chromeShell
  };
})();

// 探测 HyperFrames CLI 入口（hyperframes.mjs）：内置优先，回退系统安装/环境变量
function findHyperframesCli() {
  if (fs.existsSync(BUILTIN_RESOURCES.hfCli)) return BUILTIN_RESOURCES.hfCli;
  if (process.env.HYPERFRAMES_CLI && fs.existsSync(process.env.HYPERFRAMES_CLI)) {
    return process.env.HYPERFRAMES_CLI;
  }
  const candidates = [path.join('E:', 'my', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 解析 node 的真实绝对路径（避免 spawn('node') 在部分环境 ENOENT）
function resolveNodePath() {
  const candidates = [];
  if (process.env.NVM_SYMLINK) candidates.push(path.join(process.env.NVM_SYMLINK, 'node.exe'));
  candidates.push(path.join(process.env.LOCALAPPDATA || '', 'nvm', 'nodejs', 'node.exe'));
  candidates.push(path.join('C:', 'Program Files', 'nodejs', 'node.exe'));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const p = spawnSync(c, ['-v'], { encoding: 'utf8' });
      if (p.status === 0) return c;
    }
  }
  // 兜底：where node 解析真实路径
  try {
    const w = spawnSync('where.exe', ['node'], { encoding: 'utf8' });
    if (w.status === 0 && w.stdout) {
      const line = w.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l && /\.exe$/i.test(l));
      if (line && fs.existsSync(line)) return line;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 探测 Node（HyperFrames 要求 >= 22）：内置优先，回退系统，一律返回绝对路径
function findNode() {
  // 内置 Node 优先（打包分发免装环境）
  if (fs.existsSync(BUILTIN_RESOURCES.node)) {
    const p = spawnSync(BUILTIN_RESOURCES.node, ['-v'], { encoding: 'utf8' });
    if (p.status === 0) return BUILTIN_RESOURCES.node;
  }
  const probe = spawnSync('node', ['-v'], { encoding: 'utf8' });
  if (probe.status === 0) {
    const v = (probe.stdout || '').trim().replace('v', '');
    const major = parseInt(v.split('.')[0], 10);
    if (!isNaN(major) && major >= 22) {
      const resolved = resolveNodePath();
      return resolved; // 有绝对路径用绝对路径；极端情况为 null 时下面会报错
    }
  }
  return resolveNodePath();
}

// 探测 WinGet 安装的 Gyan.FFmpeg 可执行目录
function findFfmpegBin() {
  const pkgRoot = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgRoot)) return null;
  const dirs = fs.readdirSync(pkgRoot, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('Gyan.FFmpeg')) continue;
    const full = path.join(pkgRoot, d.name);
    const subs = fs.readdirSync(full, { withFileTypes: true });
    for (const s of subs) {
      if (!s.isDirectory() || !s.name.includes('full_build')) continue;
      const bin = path.join(full, s.name, 'bin');
      if (fs.existsSync(path.join(bin, 'ffmpeg.exe'))) return bin;
    }
  }
  return null;
}

// 判断 HTML 是否 HyperFrames 合规 composition
function isHyperframesComposition(raw) {
  return /data-composition-id/i.test(raw) && /__timelines/i.test(raw) && /\bgsap\b/i.test(raw);
}

ipcMain.handle('dialog:open-html', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择要预览的 HTML 文件',
    filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 扫描内置视频项目（项目根 video-projects 下含 index.html 的子目录）
ipcMain.handle('video:list-projects', () => {
  const root = path.join(__dirname, '..', 'video-projects');
  if (!fs.existsSync(root)) return [];
  const list = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const html = path.join(root, d.name, 'index.html');
    if (fs.existsSync(html)) list.push({ name: d.name, html });
  }
  return list;
});

// 在资源管理器中定位视频文件
ipcMain.handle('video:show-in-folder', (event, filePath) => {
  if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle('video:render', (event, payload) => {
  return new Promise((resolve) => {
    const htmlPath = payload && payload.htmlPath;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      resolve({ ok: false, message: 'HTML 文件不存在' });
      return;
    }

    const raw = fs.readFileSync(htmlPath, 'utf8');
    if (!isHyperframesComposition(raw)) {
      resolve({
        ok: false,
        compatible: false,
        message: '该 HTML 不是 HyperFrames 规范的 composition（缺少 data-composition-id / GSAP __timelines 结构）。' +
          '建议先用 HyperFrames 引导生成合规模板，再替换为自己的 HTML 内容。'
      });
      return;
    }

    const hfCli = findHyperframesCli();
    if (!hfCli) {
      resolve({ ok: false, message: '未找到 hyperframes CLI（hyperframes.mjs）。可设置环境变量 HYPERFRAMES_CLI 指向其路径。' });
      return;
    }
    const nodeCmd = findNode();
    if (!nodeCmd) {
      resolve({ ok: false, message: '未找到系统 Node.js（HyperFrames 要求 >= 22）' });
      return;
    }

    // 搭建临时项目目录并放入目标 HTML
    // 若 HTML 所在目录带有配套资源（audio/ 等），整体复制，保证音频能随 HTML 一起渲染
    const projDir = path.join(app.getPath('userData'), 'hf-projects', 'html-video-' + Date.now());
    fs.mkdirSync(projDir, { recursive: true });
    const srcDir = path.dirname(htmlPath);
    try {
      const siblings = fs.readdirSync(srcDir);
      const hasAssets = siblings.some((f) => f !== 'index.html' && f !== 'output.mp4');
      if (hasAssets) {
        fs.cpSync(srcDir, projDir, { recursive: true });
      } else {
        fs.copyFileSync(htmlPath, path.join(projDir, 'index.html'));
      }
    } catch (e) {
      resolve({ ok: false, message: '复制 HTML 失败：' + e.message });
      return;
    }
    const outMp4 = path.join(projDir, 'output.mp4');

    const env = { ...process.env };
    const ffBin = findFfmpegBin();
    if (ffBin) env.PATH = ffBin + path.delimiter + (env.PATH || '');
    // 内置 ffmpeg/ffprobe 路径显式注入，避免依赖系统 PATH（HYPERFRAMES_* 为可选）
    if (fs.existsSync(BUILTIN_RESOURCES.ffmpeg)) env.HYPERFRAMES_FFMPEG_PATH = BUILTIN_RESOURCES.ffmpeg;
    if (fs.existsSync(BUILTIN_RESOURCES.ffprobe)) env.HYPERFRAMES_FFPROBE_PATH = BUILTIN_RESOURCES.ffprobe;
    // 内置 Chrome headless-shell（避免渲染时去 .cache 重新下载）
    if (BUILTIN_RESOURCES.chromeShell) {
      env.PRODUCER_HEADLESS_SHELL_PATH = BUILTIN_RESOURCES.chromeShell;
    }

    const child = spawn(nodeCmd, [hfCli, 'render', '-o', outMp4], {
      cwd: projDir,
      env
    });

    let finished = false;
    const done = (res) => {
      if (finished) return;
      finished = true;
      resolve(res);
    };

    child.stdout.on('data', (d) => {
      const text = d.toString();
      event.sender.send('video:progress', { text });
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      event.sender.send('video:progress', { text });
    });
    child.on('error', (err) => done({ ok: false, message: '启动渲染失败：' + err.message + '（node: ' + (nodeCmd || 'null') + '）' }));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outMp4)) {
        done({ ok: true, outputVideo: outMp4, projectDir: projDir });
      } else {
        done({ ok: false, message: '渲染失败（exit=' + code + '）' });
      }
    });
  });
});

// ===== 项目化贯通流水线：字幕 → HTML → 预览/转视频 =====
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本
//   index.html    由字幕生成的 HTML composition
//   project.json  项目元数据（name/subtitle/htmlPath/videoPath/title 等）

const projectsRoot = path.join(app.getPath('userData'), 'projects');

function projectDir(name) {
  return path.join(projectsRoot, String(name || '').replace(/[\\/:*?"<>|]/g, '_'));
}
function projectFilePath(name, file) {
  return path.join(projectDir(name), file);
}

function readProject(name) {
  const jsonPath = path.join(projectDir(name), 'project.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeProject(proj) {
  const dir = projectDir(proj.name);
  fs.mkdirSync(dir, { recursive: true });
  proj.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(proj, null, 2), 'utf8');
  return proj;
}
function ensureProject(name) {
  const existing = readProject(name);
  if (existing) {
    existing.name = name;
    return existing;
  }
  return {
    name,
    title: '字幕动画',
    subtitle: '',
    htmlPath: '',
    videoPath: '',
    audioFile: '',
    createdAt: new Date().toISOString()
  };
}

// 扫描“我的项目”（可读写，供项目选择器使用）
function scanProjects() {
  if (!fs.existsSync(projectsRoot)) return [];
  const list = [];
  for (const d of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = readProject(d.name);
    if (!p) continue;
    list.push({
      name: p.name,
      title: p.title || '字幕动画',
      hasSubtitle: !!p.subtitle,
      hasHtml: !!(p.htmlPath && fs.existsSync(p.htmlPath)),
      hasVideo: !!(p.videoPath && fs.existsSync(p.videoPath)),
      subtitleCount: p.subtitleCount || 0,
      updatedAt: p.updatedAt || ''
    });
  }
  return list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// 解析字幕文本：支持 [分:秒] 文本 或 纯文本（自动估算时间）
function parseSubtitle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  let autoT = 0.4;
  let lineNo = 1;
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?\]\s*(.*)$/);
    let txt = line;
    let time = null;
    if (m) {
      txt = m[4].trim();
      time = (+m[1]) * 60 + (+m[2]) + ((+(m[3] || 0)) / 1000);
    }
    if (!txt) { lineNo++; continue; }
    if (time === null) {
      time = autoT;
      autoT += Math.max(2.4, 1.6 + txt.length * 0.15);
    }
    items.push({ n: lineNo, text: txt, time });
    lineNo++;
  }
  return items;
}

ipcMain.handle('project:list', () => scanProjects());

ipcMain.handle('project:load', (event, name) => {
  if (!name) return null;
  return readProject(name) || ensureProject(name);
});

// 保存字幕到当前项目
ipcMain.handle('project:save-subtitle', (event, payload) => {
  const name = payload && payload.name;
  const subtitle = payload && typeof payload.subtitle === 'string' ? payload.subtitle : '';
  const title = payload && typeof payload.title === 'string' ? payload.title : '';
  if (!name) return { ok: false, message: '缺少项目名' };
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'subtitle.txt'), subtitle, 'utf8');
  const proj = ensureProject(name);
  proj.subtitle = subtitle;
  if (title) proj.title = title;
  proj.subtitleCount = parseSubtitle(subtitle).length;
  writeProject(proj);
  return { ok: true, project: proj };
});

// ===== HTML 生成/修改：由 Agent 接口实现（应用侧不内置模板） =====
// 接入点：handler 收到 { name, prompt[, mode] } 后调用 Agent，
// Agent 产出/修改 HTML 并写入 projectFilePath(name,'index.html')，
// 应用侧随后更新 proj.htmlPath、置空 proj.videoPath 并刷新链路。
ipcMain.handle('project:generate-html', (event, payload) => {
  const name = payload && payload.name;
  if (!name) return { ok: false, message: '缺少项目名' };
  return { ok: false, message: 'Agent 接口未接入：HTML 生成请通过 Agent 完成' };
});

// 修改：基于现有 HTML，由 Agent 按需求改造后覆盖
ipcMain.handle('project:modify-html', (event, payload) => {
  const name = payload && payload.name;
  if (!name) return { ok: false, message: '缺少项目名' };
  return { ok: false, message: 'Agent 接口未接入：HTML 修改请通过 Agent 完成' };
});

// 下载项目 HTML 到本地（导出入口）
ipcMain.handle('project:download-html', (event, name) => {
  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
  const save = dialog.showSaveDialogSync(mainWindow, {
    title: '导出 HTML',
    defaultPath: (name || 'project') + '.html',
    filters: [{ name: 'HTML 文件', extensions: ['html'] }]
  });
  if (!save) return { ok: false, canceled: true };
  fs.copyFileSync(htmlPath, save);
  return { ok: true, savedPath: save };
});

// 打开项目所在目录
ipcMain.handle('project:open-folder', (event, name) => {
  const dir = projectDir(name);
  if (fs.existsSync(dir)) shell.openPath(dir);
  return { ok: true };
});

// 删除“我的项目”（慎重：仅限 userData 下的项目目录）
ipcMain.handle('project:delete', (event, name) => {
  const dir = projectDir(name);
  if (!name || !dir.startsWith(projectsRoot)) return { ok: false, message: '非法项目名' };
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { ok: true };
});

// 视频渲染完成后，把产物路径回写进项目（供链路状态条点亮“视频”节点）
ipcMain.handle('project:save-video', (event, payload) => {
  const name = payload && payload.name;
  const videoPath = payload && payload.videoPath;
  if (!name || !videoPath) return { ok: false, message: '参数缺失' };
  const proj = ensureProject(name);
  proj.videoPath = String(videoPath);
  writeProject(proj);
  return { ok: true, project: proj };
});
// ===== 项目音频：让生成的 HTML 视频有声音 =====
ipcMain.handle('project:pick-audio', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频文件（将复制进项目，随视频一起渲染）',
    filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 把音频复制进项目目录 audio/ 并记录相对引用
ipcMain.handle('project:set-audio', (event, payload) => {
  const name = payload && payload.name;
  const audioPath = payload && payload.audioPath;
  if (!name) return { ok: false, message: '缺少项目名' };
  if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在' };
  const dir = projectDir(name);
  const audioDir = path.join(dir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const basename = path.basename(audioPath).replace(/[\\/:*?"<>|]/g, '_');
  const extIndex = basename.lastIndexOf('.');
  const stem = extIndex > 0 ? basename.slice(0, extIndex) : basename;
  const ext = extIndex > 0 ? basename.slice(extIndex) : '';
  let saveName = basename;
  let i = 1;
  while (fs.existsSync(path.join(audioDir, saveName))) {
    saveName = stem + '_' + i + ext;
    i++;
    if (i > 1000) break;
  }
  fs.copyFileSync(audioPath, path.join(audioDir, saveName));
  const proj = ensureProject(name);
  proj.audioFile = 'audio/' + saveName;
  writeProject(proj);
  return { ok: true, audioFile: proj.audioFile };
});

// 移除当前项目音频引用（保留音频文件，避免误删资源）
ipcMain.handle('project:clear-audio', (event, payload) => {
  const name = payload && payload.name;
  if (!name) return { ok: false, message: '缺少项目名' };
  const proj = ensureProject(name);
  proj.audioFile = '';
  writeProject(proj);
  return { ok: true };
});

// 读取项目当前 HTML 源码（供编辑器载入）
ipcMain.handle('project:read-html', (event, name) => {
  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
  return { ok: true, html: fs.readFileSync(htmlPath, 'utf8') };
});

// 直接保存（覆盖）项目 HTML 源码，支持"不满意再改"
ipcMain.handle('project:save-html', (event, payload) => {
  const name = payload && payload.name;
  const html = payload && typeof payload.html === 'string' ? payload.html : '';
  if (!name) return { ok: false, message: '缺少项目名' };
  if (!String(html).trim()) return { ok: false, message: 'HTML 内容为空' };
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  const proj = ensureProject(name);
  proj.htmlPath = htmlPath;
  // HTML 改动后旧视频不再匹配 → 标记失效
  proj.videoPath = '';
  writeProject(proj);
  return { ok: true, htmlPath, compatible: isHyperframesComposition(html) };
});
