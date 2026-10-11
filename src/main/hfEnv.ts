// src/main/hfEnv.ts
// 环境探测 + HyperFrames 资源定位 + GSAP 本地化（无 IPC 注册，无业务状态）
// 依赖：electron(app) / path / fs / child_process
// 注：本模块不再是「纯函数」—— GSAP 本地化那组会读写文件（只复制随包的 gsap.min.js，不碰业务数据）。
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'

// ===== 内置依赖资源定位（打包后由 electron-builder extraResources 投放至 resources）=====
// 注：开发版资源根为 项目根/resources（以 app.getAppPath() 为基准，打包后走 process.resourcesPath）
const BUILTIN_RESOURCES: {
  root: string
  node: string
  ffmpegBin: string
  ffmpeg: string
  ffprobe: string
  hfCli: string
  hivePlayer: string
  chromeShell: string | null
} = (() => {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');
  const exists = (p: string) => fs.existsSync(p);

  // chrome-headless-shell 可执行：<root>\hyperframes\chrome\chrome-headless-shell\**\chrome-headless-shell.exe
  let chromeShell: string | null = null;
  try {
    const base = path.join(root, 'hyperframes', 'chrome', 'chrome-headless-shell');
    if (exists(base)) {
      const stack = [base];
      while (stack.length && !chromeShell) {
        const cur = stack.pop() as string;
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

// 探测 HyperFrames CLI 入口（hyperframes.mjs）：内置优先，回退环境变量
function findHyperframesCli(): string | null {
  if (fs.existsSync(BUILTIN_RESOURCES.hfCli)) return BUILTIN_RESOURCES.hfCli;
  if (process.env.HYPERFRAMES_CLI && fs.existsSync(process.env.HYPERFRAMES_CLI)) {
    return process.env.HYPERFRAMES_CLI;
  }
  return null;
}

// 解析 node 的真实绝对路径（避免 spawn('node') 在部分环境 ENOENT）
function resolveNodePath(): string | null {
  const candidates: string[] = [];
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
function findNode(): string | null {
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
function findFfmpegBin(): string | null {
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
function isHyperframesComposition(raw: string): boolean {
  return /data-composition-id/i.test(raw) && /__timelines/i.test(raw) && /\bgsap\b/i.test(raw);
}

// ===== GSAP 本地化（离线可用） =====
// 背景：生成的 HTML 原先按提示词从 CDN 引 GSAP，离线或 CDN 抖动时 gsap 未定义、时间轴不存在，
//       预览静止、转视频可能失败。故随包携带一份 vendor/gsap/gsap.min.js（版本与来源见 vendor/gsap/README.md），
//       在生成 / 保存 / 预览 / 渲染四个环节把 CDN 引用改写为项目内相对引用 ./gsap.min.js，并把文件复制到位。
// 路径基准：app.getAppPath() 在 dev = 项目根、打包后 = app.asar 根，两种形态都能命中（只读字节，无需 extraResources）。
const GSAP_LOCAL_CANDIDATES: (() => string)[] = [
  () => path.join(app.getAppPath(), 'vendor', 'gsap', 'gsap.min.js'),
  () => path.join(process.resourcesPath || '', 'vendor', 'gsap', 'gsap.min.js')
];

// 随包 gsap.min.js 的绝对路径（不存在返回 null）
function findLocalGsap(): string | null {
  for (const c of GSAP_LOCAL_CANDIDATES) {
    try {
      const p = c();
      if (p && fs.existsSync(p)) return p;
    } catch (e) { /* ignore */ }
  }
  return null;
}

// 常见 CDN 引入地址（jsDelivr / unpkg / cdnjs，任意版本），用于改写为本地相对引用
const GSAP_CDN_RE = /(?:https?:)?\/\/(?:cdn\.jsdelivr\.net\/npm\/gsap|unpkg\.com\/gsap|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap)[^"'<>()\s]*/gi;
// 项目内相对引用（生成侧约定的写法）
const GSAP_LOCAL_REF = './gsap.min.js';
// 导出用：固定版本的 CDN 地址 —— 与 vendor/gsap/gsap.min.js 的版本必须一致（更新随包文件时这里一起改）
const GSAP_CDN_PINNED = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';

function hasGsapCdnRef(html: string): boolean {
  GSAP_CDN_RE.lastIndex = 0;
  return GSAP_CDN_RE.test(String(html || ''));
}

// HTML 是否引用了项目内的 gsap.min.js（用于决定要不要把随包文件复制进项目目录）
function referencesLocalGsap(html: string): boolean {
  return /["'(]\.?\/?gsap\.min\.js/i.test(String(html || ''));
}

// 把 HTML 里的 GSAP CDN 引用改写为 ./gsap.min.js；随包文件缺失时原样返回（退化为在线加载，不破坏现状）
function localizeGsapHtml(html: string): string {
  const raw = String(html || '');
  if (!raw || !hasGsapCdnRef(raw) || !findLocalGsap()) return raw;
  GSAP_CDN_RE.lastIndex = 0;
  return raw.replace(GSAP_CDN_RE, GSAP_LOCAL_REF);
}

// 导出（下载为单个 HTML 文件）用：把 ./gsap.min.js 换回固定版本 CDN 地址。
// 理由：导出物只有一个文件，随手放到别处会缺同目录的 gsap.min.js，动画会完全不跑；换回 CDN 后联网即可独立打开。
function externalizeGsapHtml(html: string): string {
  return String(html || '').replace(/(["'])(?:\.\/|\/)?gsap\.min\.js\1/gi, '$1' + GSAP_CDN_PINNED + '$1');
}

// 把随包 gsap.min.js 复制进指定目录（幂等：已存在且体积一致即跳过）；返回该目录是否可用于 ./gsap.min.js 引用
function copyGsapIntoProject(dir: string): boolean {
  const src = findLocalGsap();
  if (!src) return false;
  const dest = path.join(dir, 'gsap.min.js');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) return true;
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    return false;
  }
}

export {
  BUILTIN_RESOURCES,
  findHyperframesCli,
  resolveNodePath,
  findNode,
  findFfmpegBin,
  isHyperframesComposition,
  findLocalGsap,
  hasGsapCdnRef,
  referencesLocalGsap,
  localizeGsapHtml,
  externalizeGsapHtml,
  copyGsapIntoProject
};
