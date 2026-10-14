// src/main/hfEnv.ts
// 环境探测 + HyperFrames 资源定位 + GSAP 本地化（无 IPC 注册，无业务状态）
// 依赖：electron(app) / path / fs / child_process
// 注：本模块不再是「纯函数」—— GSAP 本地化那组会读写文件（只复制随包的 gsap.min.js，不碰业务数据）。
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'

// ===== 内置依赖资源定位（ffmpeg / hyperframes；whisper 由 whisper.ts 自己解析）=====
// 分包之后不再有「一个包含所有资源的根」：ffmpeg 与 hyperframes 各自解到
//   <userData>/runtime/ffmpeg/ 与 <userData>/runtime/hyperframes/（见 src/main/runtime.ts）
// 所以这里**按单项资源解析**，每个路径自己找：
//   ① 该包已就绪的目录（runtime.ts 解包完成后用 refreshPack() 告诉本模块；也会按盘上标记现查）
//   ② 旧版整体运行环境目录（<userData>/runtime/<id>，安装包里带 runtime.7z 的那一版的遗留）
//   ③ <resources>：dev 下为 项目根/resources，打包后为 process.resourcesPath（旧布局兜底）
// 为什么搬走：ffmpeg(180MB)+hyperframes(440MB) 合计约 620MB、4900+ 文件，占安装体积大头，却跨版本几乎
// 不变；而 NSIS 的更新是「整体卸载旧版 → 解压复制新包」，这些文件每次更新都要重来一遍（实测一次更新
// 97 秒，期间应用不存在、快捷方式失效）。分包后安装包不再携带它们，用到时由用户确认下载（可取消）。
// 实现上刻意用 getter 而不是快照：userData 目录迁移（my-app → shadowmill）与本模块的 import 顺序不确定，
// 解包又是运行时才完成，快照会把路径永久钉在旧值上；getter 每次按当前状态算，结果按包缓存，
// 解包完成后由 refreshPack() 失效。
export type RuntimePackDirName = 'ffmpeg' | 'hyperframes';
const PACK_DIRS: RuntimePackDirName[] = ['ffmpeg', 'hyperframes'];
// 包根缓存：undefined=还没查过；''=查过但没有；非空=已就绪的目录
const cachedPackRoots: Partial<Record<RuntimePackDirName, string>> = {};
let cachedChrome: string | null | undefined;
// 探针结果缓存：探针要 spawn 一次 electron.exe（约 200-400ms，且 spawnSync 会阻塞主进程），
// 而结果在一次会话里不会变。包根变化时由 refreshPack() 一并失效。
let cachedNode: { cmd: string; env: Record<string, string> } | null | undefined;

const runtimeBase = (): string => path.join(app.getPath('userData'), 'runtime');

// 开发态刻意不看作何运行环境包标记：改 resources/ 就该马上生效，不该被上次打包解出来的那份顶掉
// （要测解包路径时用 SHADOWMILL_RUNTIME_PACK 指向包里目录，runtime.ts 会在解包后显式刷新包根）
const devResourceRoot = (): string => path.join(app.getAppPath(), 'resources');

// 旧版布局：<userData>/runtime/<id>/（整体包时代解出来的那一份，里面 ffmpeg/ hyperframes/ whisper/ 俱全）
function legacyRoots(): string[] {
  try {
    const base = runtimeBase();
    const out: string[] = [];
    const cur = JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'));
    const id = cur && typeof cur.id === 'string' ? cur.id : '';
    if (id && fs.existsSync(path.join(base, id, 'ok.json'))) out.push(path.join(base, id));
    return out;
  } catch (e) { return []; }
}

// 某包的解包结果目录：目录里有 ok.json 才算完整（与 runtime.ts 的写标记顺序一致）
function packRootFromDisk(name: RuntimePackDirName): string {
  try {
    const dir = path.join(runtimeBase(), name);
    return fs.existsSync(path.join(dir, 'ok.json')) ? dir : '';
  } catch (e) { return ''; }
}

function resolvePackRoot(name: RuntimePackDirName): string {
  const cached = cachedPackRoots[name];
  if (typeof cached === 'string' && cached) return cached;
  const candidates: string[] = [packRootFromDisk(name)];
  if (app.isPackaged) candidates.push(...legacyRoots(), process.resourcesPath || '');
  else candidates.push(...legacyRoots(), devResourceRoot());
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, name))) {
      cachedPackRoots[name] = c;
      return c;
    }
  }
  cachedPackRoots[name] = '';
  return '';
}

// runtime.ts 在某个包解包完成后调用：把该包解析到指定目录（传空串 = 重新按盘上标记解析）
function refreshPack(name: RuntimePackDirName, root?: string): void {
  cachedPackRoots[name] = typeof root === 'string' && root ? root : ('' as string);
  if (typeof root !== 'string' || !root) delete cachedPackRoots[name];
  cachedChrome = undefined;
  if (name === 'hyperframes') cachedNode = undefined;
}

// 兼容旧调用（runtime.ts 换分包后主要用 refreshPack；这里保留以免外部调用点全改）
function refreshBuiltinResources(root?: string): string {
  for (const n of PACK_DIRS) {
    if (typeof root === 'string' && root) cachedPackRoots[n] = root;
    else delete cachedPackRoots[n];
  }
  cachedChrome = undefined;
  cachedNode = undefined;
  return resolvePackRoot('hyperframes');
}

// 兜底根（仅用于「旧布局 / dev 的资源根」判断，不再是所有资源的父目录）
function resolveRoot(): string {
  const legacy = legacyRoots()[0];
  if (legacy) return legacy;
  return app.isPackaged ? (process.resourcesPath || '') : devResourceRoot();
}

// chrome-headless-shell 可执行：<hfRoot>\chrome\chrome-headless-shell\**\chrome-headless-shell.exe
// （hfRoot 是 hyperframes 包解出来的目录，其下第一层就是 hyperframes/；目录层级随 hyperframes 版本
//   变化，按文件名递归找；结果缓存，缺资源时返回 null）
function findChromeShell(hfRoot: string): string | null {
  if (cachedChrome !== undefined) return cachedChrome;
  cachedChrome = null;
  try {
    const base = path.join(hfRoot, 'chrome', 'chrome-headless-shell');
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
  readonly ffmpegBin: string
  readonly ffmpeg: string
  readonly ffprobe: string
  readonly hfCli: string
  readonly hivePlayer: string
  readonly chromeShell: string | null
} = {
  // root 只是「旧布局 / dev 的资源根」兜底（不再是所有资源的父目录）；ffmpeg / hyperframes 各自解析
  get root() { return resolveRoot(); },
  get ffmpegBin() { const r = resolvePackRoot('ffmpeg'); return r ? path.join(r, 'ffmpeg', 'bin') : ''; },
  get ffmpeg() { const r = resolvePackRoot('ffmpeg'); return r ? path.join(r, 'ffmpeg', 'bin', 'ffmpeg.exe') : ''; },
  get ffprobe() { const r = resolvePackRoot('ffmpeg'); return r ? path.join(r, 'ffmpeg', 'bin', 'ffprobe.exe') : ''; },
  get hfCli() { const r = resolvePackRoot('hyperframes'); return r ? path.join(r, 'hyperframes', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs') : ''; },
  get hivePlayer() { const r = resolvePackRoot('hyperframes'); return r ? path.join(r, 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'hyperframes-player.global.js') : ''; },
  get chromeShell() { const r = resolvePackRoot('hyperframes'); return r ? findChromeShell(r) : null; }
};

// 某包是否已就绪（纯查询，不触发下载）：供消费点在动手前校验
function packReady(name: RuntimePackDirName): boolean {
  return !!resolvePackRoot(name);
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

// 探测 Node（HyperFrames 要求 >= 22）。返回 { cmd, env }：**env 必须合进子进程环境后再 spawn**，
// 不能再当纯路径用。优先级：① Electron 内嵌 Node → ② 系统 Node。
//
// 为什么首选 ①：Electron 35+ 内置 Node >= 22（44.7.0 实测 v24.21.0），加 ELECTRON_RUN_AS_NODE
// 即可让 electron.exe 以 Node 行为跑 hyperframes CLI。曾经的 ② 候选「随包 resources/node/node.exe」
// （83MB）已整体删除：它在打包态本来就够不着（build.files / extraResources 都不带 resources/**，
// 只有 dev 的 resolveRoot() 指向项目根 resources 时才会命中），留着等于给 dev 和 wiki 一个假回退。
// 实测（2026-10-12，Electron 44.7.0 + hyperframes 0.8.33，1280x720 / 2s / 60 帧的 composition）：
//   · onnxruntime-node 与 sharp 都能在 Electron 的 Node 24 下加载（libvips 与 Node 22 下一致，8.18.6）；
//   · 成片与用 node 22 渲染的逐项相同，含字节数（157397 字节）；
//   · hyperframes 内部三处 spawn(process.execPath) 均继承 process.env，标志会传到子进程，
//     不会出现「子进程以为自己是 Electron 应用」而误启主程序。
//
// ⚠ 这条复用依赖 Electron 的 RunAsNode 熔丝处于默认开启状态。若将来在 package.json 的
//   build.electronFuses 里把它关掉，下面的探针会失败并自动回落到 ② —— 不报错，但那时**必须**
//   重新提供一份 Node：要么把 resources/node/node.exe 放回来（并让它进运行环境包，见
//   scripts/pack-runtime.mjs 的 EXCLUDE_TOP），要么把「系统 Node >= 22」变成硬性前置条件。
// 探针刻意用 `-e` 打印 Node 版本、而不是 `-v`：熔丝若被关闭，electron.exe 会把 `-e` 当应用路径
// 而直接失败；但 `-v` 会打印 Electron 版本（44 >= 22），会造成「复用可用」的误判。
function findNode(): { cmd: string; env: Record<string, string> } | null {
  if (cachedNode !== undefined) return cachedNode;
  // ① Electron 内嵌 Node（免下载、免随包 83MB）
  const reuseEnv = { ELECTRON_RUN_AS_NODE: '1' };
  try {
    const self = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.versions.node || ""))'],
      { encoding: 'utf8', env: { ...process.env, ...reuseEnv } }
    );
    const v = String(self.stdout || '').trim();
    const major = parseInt(v.split('.')[0], 10);
    if (self.status === 0 && !isNaN(major) && major >= 22) {
      cachedNode = { cmd: process.execPath, env: reuseEnv };
      return cachedNode;
    }
  } catch (e) { /* 探针失败即回落，不影响启动 */ }

  // ② 系统 Node
  const probe = spawnSync('node', ['-v'], { encoding: 'utf8' });
  if (probe.status === 0) {
    const v = (probe.stdout || '').trim().replace('v', '');
    const major = parseInt(v.split('.')[0], 10);
    if (!isNaN(major) && major >= 22) {
      const resolved = resolveNodePath();
      if (resolved) { cachedNode = { cmd: resolved, env: {} }; return cachedNode; }
    }
  }
  const fallback = resolveNodePath();
  cachedNode = fallback ? { cmd: fallback, env: {} } : null;
  return cachedNode;
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
  refreshPack,
  packReady,
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
