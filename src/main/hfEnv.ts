// src/main/hfEnv.ts
// 环境探测 + HyperFrames 资源定位 + GSAP 本地化（无 IPC 注册，无业务状态）
// 依赖：electron(app) / path / fs / child_process
// 注：本模块不再是「纯函数」—— GSAP 本地化那组会读写文件（只复制随包的 gsap.min.js，不碰业务数据）。
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'

// ===== 内置依赖资源定位（ffmpeg / node / hyperframes / whisper）=====
// 资源根按优先级解析：
//   ① <userData>/runtime/<id>：运行环境包解出来的那一份（安装版常态，见 src/main/runtime.ts）
//   ② <resources>：dev 下为 项目根/resources，打包后为 process.resourcesPath（旧版布局 / 兜底）
// 为什么搬到 userData：ffmpeg+node+hyperframes+whisper 合计约 716MB、4900+ 文件，占安装体积 72%，
// 却跨版本几乎不变；而 NSIS 的更新是「整体卸载旧版 → 解压复制新包」，这些文件每次更新都要重来一遍
// （实测一次更新 97 秒，期间应用不存在、快捷方式失效）。拆成运行环境包后更新不再碰它们。
// 实现上刻意用 getter 而不是快照：userData 目录迁移（my-app → shadowmill）与本模块的 import 顺序
// 不确定，解包又是运行时才完成，快照会把路径永久钉在旧值上；getter 每次按当前状态算（结果带缓存，
// 解包完成后由 refreshBuiltinResources() 失效）。
let cachedRoot: string | null = null;
let cachedChrome: string | null | undefined;

// 运行环境包指针：<userData>/runtime/current.json 指向 id，那一份目录里有 ok.json 才算解包完整
function packRootFromMarker(): string {
  try {
    const base = path.join(app.getPath('userData'), 'runtime');
    const cur = JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'));
    const id = cur && typeof cur.id === 'string' ? cur.id : '';
    if (!id) return '';
    const dir = path.join(base, id);
    return fs.existsSync(path.join(dir, 'ok.json')) ? dir : '';
  } catch (e) { return ''; }
}

function resolveRoot(): string {
  if (cachedRoot !== null) return cachedRoot;
  // 开发态刻意不看运行环境包指针：改 resources/ 就该马上生效，不该被上次打包解出来的那份顶掉
  // （要测解包路径时用 SHADOWMILL_RUNTIME_PACK 指向包里目录，runtime.ts 会在解包后显式刷新根）
  cachedRoot = app.isPackaged
    ? (packRootFromMarker() || process.resourcesPath)
    : path.join(app.getAppPath(), 'resources');
  return cachedRoot;
}

// chrome-headless-shell 可执行：<root>\hyperframes\chrome\chrome-headless-shell\**\chrome-headless-shell.exe
// （目录层级随 hyperframes 版本变化，按文件名递归找；结果缓存，缺资源时返回 null）
function findChromeShell(root: string): string | null {
  if (cachedChrome !== undefined) return cachedChrome;
  cachedChrome = null;
  try {
    const base = path.join(root, 'hyperframes', 'chrome', 'chrome-headless-shell');
    if (fs.existsSync(base)) {
      const stack = [base];
      while (stack.length && !cachedChrome) {
        const cur = stack.pop() as string;
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          if (e.isDirectory()) stack.push(path.join(cur, e.name));
          else if (/^chrome-headless-shell\.exe$/i.test(e.name)) {
            cachedChrome = path.join(cur, e.name);
            break;
          }
        }
      }
    }
  } catch (e) { cachedChrome = null; }
  return cachedChrome;
}

const BUILTIN_RESOURCES: {
  readonly root: string
  readonly node: string
  readonly ffmpegBin: string
  readonly ffmpeg: string
  readonly ffprobe: string
  readonly hfCli: string
  readonly hivePlayer: string
  readonly chromeShell: string | null
} = {
  get root() { return resolveRoot(); },
  get node() { return path.join(resolveRoot(), 'node', 'node.exe'); },
  get ffmpegBin() { return path.join(resolveRoot(), 'ffmpeg', 'bin'); },
  get ffmpeg() { return path.join(resolveRoot(), 'ffmpeg', 'bin', 'ffmpeg.exe'); },
  get ffprobe() { return path.join(resolveRoot(), 'ffmpeg', 'bin', 'ffprobe.exe'); },
  get hfCli() { return path.join(resolveRoot(), 'hyperframes', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'); },
  get hivePlayer() { return path.join(resolveRoot(), 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'hyperframes-player.global.js'); },
  get chromeShell() { return findChromeShell(resolveRoot()); }
};

// 资源根变化（运行环境包解包完成 / 切换到指定目录）后调用：清缓存并返回新的根。
// 不传参数即回到「按指针重新解析」。
function refreshBuiltinResources(root?: string): string {
  cachedRoot = (typeof root === 'string' && root) ? root : null;
  cachedChrome = undefined;
  return resolveRoot();
}

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
  refreshBuiltinResources,
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
