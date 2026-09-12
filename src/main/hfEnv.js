// src/main/hfEnv.js
// 环境探测与 HyperFrames 资源定位（纯函数，无 IPC 注册，无业务依赖）
// 依赖：electron(app) / path / fs / child_process
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { app } = require('electron');

// ===== 内置依赖资源定位（打包后由 electron-builder extraResources 投放至 resources）=====
// 注：本模块位于 src/main/ 下，开发版资源根目录为 项目根/resources（相对 __dirname 上移两级）
const BUILTIN_RESOURCES = (() => {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', '..', 'resources');
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
    hivePlayer: path.join(root, 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'hyperframes-player.global.js'),
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

module.exports = {
  BUILTIN_RESOURCES,
  findHyperframesCli,
  resolveNodePath,
  findNode,
  findFfmpegBin,
  isHyperframesComposition
};
