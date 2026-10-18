// src/main/projects.ts
// 项目化贯通流水线：字幕 → HTML → 预览/转视频
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本
//   index.html    由字幕生成的 HTML composition
//   project.json  项目元数据（name/subtitle/htmlPath/videoPath/materials/title 等）
//   images/       图片素材（HTML 生成用，project.json 的 materials 以相对引用登记）
//   video/        视频素材（同上）
// 提供：scanProjects / projectDir / projectFilePath / readProject / writeProject /
//       ensureProject / parseSubtitle / copyAudioIntoProject（供 voice 引用）/
//       copyMaterialIntoProject + normalizeMaterials + 全部 project:* IPC
// 依赖：htmlAgent(chatWithCustomModel / extractHtmlFromReply) /
//       hfEnv(isHyperframesComposition) / runtime(确保运行环境包已解包) / settings(渲染档位白名单) / dialog / shell
import { app, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chatWithCustomModel, extractHtmlFromReply, type AgentProgress } from './htmlAgent'
import { configTargetOf } from '../shared/errors'
import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, IMAGE_MATERIAL_EXTS, MAX_MATERIALS, RENDER_CANVASES, VIDEO_MATERIAL_EXTS } from '../shared/constants'
import * as hfEnv from './hfEnv'
import * as runtime from './runtime'
import { pickRenderOverride } from './settings'
import { IPC } from '../shared/ipc'
import type {
  ContentScript,
  Project,
  ProjectAddMaterialsPayload,
  ProjectAgentPayload,
  ProjectExportSrtPayload,
  ProjectMaterial,
  ProjectMaterialKind,
  ProjectNamePayload,
  ProjectPickMediaPayload,
  ProjectSaveContentPayload,
  ProjectSaveHtmlPayload,
  ProjectSaveMaterialsPayload,
  ProjectSaveSubtitlePayload,
  ProjectSetAudioPayload,
  ProjectSetCanvasPayload,
  ProjectSetRenderPayload,
  ProjectSetVideoPayload,
  RegisterCtx,
  RenderCanvas,
  RuntimePackName,
  Scene,
  SubtitleLine
} from '../shared/types'

// 提取视频音轨要哪几包（分包后 ffmpeg 不再随安装包，缺了就由界面问用户是否下载）
const FFMPEG_PACKS: RuntimePackName[] = ['ffmpeg']

// ===== 项目数据结构 =====
// 结构定义已上移到 src/shared/types.ts（跨进程单一真源），此处再导出以保持既有引用面：
// 主进程内部与 `projects.Project` / `./projects` 的旧引用都不受影响，但字段只定义一处。
export type { ContentScript, Project, Scene, SubtitleLine } from '../shared/types'

// 项目根目录：**故意用函数、不用模块级常量**。
// 原因：ESM 的 import 提升会让本模块在 index.ts 的模块体之前求值。当前 userData 位置只跟随
// package.json 的 name，模块级快照本来也正确；但只要将来有任何"在模块体里改 userData 位置"的代码
// （例如重新引入 app.setPath），快照就会静默钉在**当时**的 userData 上，表现为"项目全没了"，
// 而且极难查。写成函数永远按当前值解析，代价为零，属于纯保险。
// 写法与 whisper.modelsDir() / runtime.runtimeDir() 保持一致。
function projectsRoot(): string {
  return path.join(app.getPath('userData'), 'projects');
}

function projectDir(name: string): string {
  return path.join(projectsRoot(), String(name || '').replace(/[\\/:*?"<>|]/g, '_'));
}
function projectFilePath(name: string, file: string): string {
  return path.join(projectDir(name), file);
}

function readProject(name: string): Project | null {
  const jsonPath = path.join(projectDir(name), 'project.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeProject(proj: Project): Project {
  const dir = projectDir(proj.name);
  fs.mkdirSync(dir, { recursive: true });
  proj.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(proj, null, 2), 'utf8');
  return proj;
}
// ===== 视频成品路径：项目内相对路径 =====
// 成品由「转视频」直接生成在 <项目目录>/video/output.mp4，project.json 里只记相对引用（video/output.mp4）。
// 为什么不记绝对路径：① 项目要自包含、能整体搬走；② 绝对路径会因 userData 改名而失效——
// 本仓库的老数据里就有指向旧目录 `…\my-app\projects\…` 的死路径（改名前的品牌）；③ 旧实现把成品放在
// 渲染临时目录 `hf-projects\…`，那条路径随时会被清理，"有视频"的判定跟着一起塌。
// 兼容旧值：老记录里可能是绝对路径（存在的就用它，可能是 hf-projects 的旧成品），否则按项目内相对路径解析。
function resolveVideoAbs(name: string, videoPath: string): string {
  const v = String(videoPath || '').trim()
  if (!v) return ''
  if (path.isAbsolute(v)) return fs.existsSync(v) ? v : ''
  return path.join(projectDir(name), v)
}

function ensureProject(name: string): Project {
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
    materials: [],
    audioFile: '',
    content: { style: '', scenes: [] },
    createdAt: new Date().toISOString()
  };
}

// 内容脚本数据规范化：基本类型校验 + 场景 id 自动补全（向后兼容：无/非法 content 视为空）
function normalizeContent(raw: unknown): ContentScript {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const style = typeof src.style === 'string' ? src.style : '';
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const now = Date.now().toString(36);
  let seen = 0;
  const out = scenes.map((s, i) => {
    const item = (s && typeof s === 'object' && !Array.isArray(s)) ? s as Record<string, unknown> : {};
    let id = (typeof item.id === 'string' && item.id.trim()) ? item.id.trim() : '';
    if (!id) { seen++; id = 'scene-' + now + '-' + i + '-' + seen; }
    const dur = item.durHint;
    const durHint = (dur === undefined || dur === null || dur === '') ? '' : String(dur);
    return {
      id,
      narration: typeof item.narration === 'string' ? item.narration : '',
      visual: typeof item.visual === 'string' ? item.visual : '',
      durHint
    };
  });
  return { style, scenes: out };
}

// 扫描“我的项目”（可读写，供项目选择器使用）
function scanProjects(): { name: string; title: string; hasSubtitle: boolean; hasHtml: boolean; hasVideo: boolean; subtitleCount: number; updatedAt: string }[] {
  const root = projectsRoot();
  if (!fs.existsSync(root)) return [];
  const list: { name: string; title: string; hasSubtitle: boolean; hasHtml: boolean; hasVideo: boolean; subtitleCount: number; updatedAt: string }[] = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = readProject(d.name);
    if (!p) continue;
    list.push({
      name: p.name,
      title: p.title || '字幕动画',
      hasSubtitle: !!p.subtitle,
      hasHtml: !!(p.htmlPath && fs.existsSync(p.htmlPath)),
      hasVideo: !!resolveVideoAbs(p.name, p.videoPath),
      subtitleCount: p.subtitleCount || 0,
      updatedAt: p.updatedAt || ''
    });
  }
  return list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// 解析字幕文本：支持 [分:秒] 文本、[分:秒-分:秒] 文本（真实起止，秒可带小数=毫秒精度）或纯文本（自动估算时间）
// 返回 { n, text, time（秒，开始）, end（秒，结束；无结束时间为 null）}
function parseSubtitle(text: string): SubtitleLine[] {
  // 小数部分按位数解释：.9 = 0.9s、.900 = 0.9s（3 位=毫秒），与落盘 fmtTsMs 对齐
  const frac = (digits: string | undefined) => (digits === undefined ? 0 : (+digits) / Math.pow(10, digits.length));
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: SubtitleLine[] = [];
  let autoT = 0.4;
  let lineNo = 1;
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?(?:\s*-\s*(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?)?\]\s*(.*)$/);
    let txt = line;
    let time: number | null = null;
    let end: number | null = null;
    if (m) {
      txt = m[7].trim();
      time = (+m[1]) * 60 + (+m[2]) + frac(m[3]);
      if (m[4] !== undefined) {
        const e = (+m[4]) * 60 + (+m[5]) + frac(m[6]);
        if (e > time) end = e;
      }
    }
    if (!txt) { lineNo++; continue; }
    if (time === null) {
      time = autoT;
      autoT += Math.max(2.4, 1.6 + txt.length * 0.15);
    }
    items.push({ n: lineNo, text: txt, time, end });
    lineNo++;
  }
  return items;
}

// 将外部音频复制进项目 audio/ 目录，返回相对引用（audio/xxx）；复制失败返回 ''
function copyAudioIntoProject(name: string, audioPath: string): string {
  if (!name || !audioPath || !fs.existsSync(audioPath)) return '';
  try {
    const audioDir = path.join(projectDir(name), 'audio');
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
    return 'audio/' + saveName;
  } catch (e) {
    return '';
  }
}

// ===== 项目素材库（图片 / 视频）=====
// 素材按 kind 落到各自的目录；与场景/字幕一样，project.json 里只登记**项目内相对引用**（file），
// 因此项目目录可以整体搬走/复制，页面里的 <img src="images/x.png"> 也不会失效。
const MATERIAL_DIR: Record<ProjectMaterialKind, string> = { image: 'images', video: 'video' };

// 素材 id：进入界面即稳定不变（勾选、移除都按它定位），与文件名解耦（同名文件重复导入也不会串）
let materialSeq = 0;
function newMaterialId(): string {
  materialSeq++;
  return 'mat-' + Date.now().toString(36) + '-' + materialSeq;
}

// 由扩展名判素材类型；白名单外一律不认（返回 ''），调用方自行跳过
function materialKindOf(filePath: string): ProjectMaterialKind | '' {
  const ext = path.extname(String(filePath || '')).replace('.', '').toLowerCase();
  if (IMAGE_MATERIAL_EXTS.includes(ext)) return 'image';
  if (VIDEO_MATERIAL_EXTS.includes(ext)) return 'video';
  return '';
}

// 将外部图片 / 视频复制进项目素材目录，返回相对引用（images/xxx | video/xxx）；复制失败返回 ''
function copyMaterialIntoProject(name: string, kind: ProjectMaterialKind, srcPath: string): string {
  if (!name || !srcPath || !fs.existsSync(srcPath)) return '';
  try {
    const dirName = MATERIAL_DIR[kind];
    const dir = path.join(projectDir(name), dirName);
    fs.mkdirSync(dir, { recursive: true });
    const basename = path.basename(srcPath).replace(/[\\/:*?"<>|]/g, '_');
    const extIndex = basename.lastIndexOf('.');
    const stem = extIndex > 0 ? basename.slice(0, extIndex) : basename;
    const ext = extIndex > 0 ? basename.slice(extIndex) : '';
    let saveName = basename;
    let i = 1;
    while (fs.existsSync(path.join(dir, saveName))) {
      saveName = stem + '_' + i + ext;
      i++;
      if (i > 1000) break;
    }
    fs.copyFileSync(srcPath, path.join(dir, saveName));
    return dirName + '/' + saveName;
  } catch (e) {
    return '';
  }
}

// 素材列表规范化（**读盘与写盘共用**）：脏数据在进入渲染层之前就被清掉，写回时也不会落进 project.json。
// ① 非数组/非对象丢弃；② kind 只认 image/video；③ file 必须是本项目 images/ 或 video/ 下的相对路径
// （挡掉 ../ 与绝对路径这类越权引用）；④ id 缺失补一个；⑤ selected 缺省视为 true；⑥ 条数截到 MAX_MATERIALS。
function normalizeMaterials(raw: unknown): ProjectMaterial[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ProjectMaterial[] = [];
  for (const item of list) {
    if (out.length >= MAX_MATERIALS) break;
    const o = (item && typeof item === 'object' && !Array.isArray(item)) ? item as Record<string, unknown> : null;
    if (!o) continue;
    const kind: ProjectMaterialKind | '' = o.kind === 'image' ? 'image' : (o.kind === 'video' ? 'video' : '');
    if (!kind) continue;
    const file = typeof o.file === 'string' ? o.file.replace(/\\/g, '/').replace(/^\.\//, '') : '';
    if (!file || file.includes('..') || !file.startsWith(MATERIAL_DIR[kind] + '/')) continue;
    const addedAt = typeof o.addedAt === 'string' && o.addedAt ? o.addedAt : new Date().toISOString();
    out.push({
      id: (typeof o.id === 'string' && o.id) ? o.id : newMaterialId(),
      kind,
      file,
      label: (typeof o.label === 'string' && o.label) ? o.label : path.basename(file),
      selected: o.selected !== false,
      addedAt
    });
  }
  return out;
}

// 素材白名单的可读文案（失败提示里给用户看）
function materialExtsText(): string {
  return ['图片 ' + IMAGE_MATERIAL_EXTS.join('/'), '视频 ' + VIDEO_MATERIAL_EXTS.join('/')].join('，');
}

// 拼接生成/修改 HTML 时的用户提示（字幕 + 背景音频素材，均可选）
function buildAgentPrompt(parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

// 由项目 content 构造「内容脚本」块（方案B：脚本为 HTML 的整体内容源）。
// 含全局 style 与逐场景 { 旁白, 画面分镜, 时长提示 }，指示模型据此设计页面视觉与动画节奏。
// 无 content 或 scenes 为空（含全部无旁白）时返回 ''，老项目（无内容脚本）走原 prompt 流程。
function buildContentBlock(content: ContentScript | undefined): string {
  const src = content || {} as ContentScript;
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const valid = scenes.filter((s) => s && typeof s.narration === 'string' && s.narration.trim());
  if (!valid.length) return '';
  const style = typeof src.style === 'string' && src.style.trim() ? src.style.trim() : '';
  const parts = ['【内容脚本 · 本项目的整体内容源，请据此设计页面视觉风格与动画节奏】'];
  parts.push(style ? '全局视觉风格：' + style : '全局视觉风格：（未指定，可自行拟定）');
  valid.forEach((s, i) => {
    const dur = (s.durHint !== undefined && s.durHint !== null && String(s.durHint).trim() !== '')
      ? String(s.durHint).trim() + ' 秒'
      : '未指定';
    const visual = (typeof s.visual === 'string' && s.visual.trim()) ? s.visual.trim() : '（未指定）';
    parts.push('场景 ' + (i + 1) + '（时长提示：' + dur + '）：');
    parts.push('- 旁白：' + s.narration.trim());
    parts.push('- 画面分镜：' + visual);
  });
  return '\n' + parts.join('\n');
}

// ===== 预览播放控制脚本（注入到 index.preview.html 副本） =====
// 生成的 HTML 由模型产出、结构不可控，且 file:// iframe 与父页跨源无法直接操作 DOM，
// 故预览时在项目目录内写一份副本并注入本脚本：① 响应父窗口 postMessage（pause/play/restart）；
// ② 每 300ms 上报 { time, dur, playing } 供父页进度条与「暂停/播放」按钮；
// ③ **载入后自动起播**——合成的时间轴是 gsap.timeline({ paused: true }) 创建、开头又把元素全部设为
//    opacity:0，播放本来由 HyperFrames 播放器（转视频 CLI）负责，预览里没人接管就会永远停在第 0 帧
//    （整页只剩底色，看着就是白屏）。
// 注意：因为会自动起播，这份副本**单独用浏览器打开也会自己播放**，它不再是"无副作用的纯控制脚本"。
const HG_PREVIEW_CTRL = [
  '(function () {',
  '  if (window.__hgPreviewCtrl) return;',
  '  window.__hgPreviewCtrl = true;',
  '  var rawTimelines = function () {',
  '    var out = [];',
  '    try {',
  '      var t = window.__timelines;',
  // HyperFrames 契约：__timelines 是「以 composition id 为键的对象」；旧版生成物可能是数组，两种都收
  '      if (Object.prototype.toString.call(t) === "[object Array]") out = t.slice();',
  '      else if (t && typeof t === "object") { for (var k in t) { if (t[k]) out.push(t[k]); } }',
  '    } catch (e) {}',
  '    return out;',
  '  };',
  '  var timelines = function () {',
  '    var out = rawTimelines();',
  '    if (out.length) return out;',
  '    try { if (window.gsap) return [window.gsap.globalTimeline]; } catch (e) {}',
  '    return [];',
  '  };',
  // 只对「确实处于暂停」的对象动手：对正在跑（或已播完）的对象反复 resume/play，会把动画重头播一遍
  '  var setPaused = function (p) {',
  '    timelines().forEach(function (t) { try { if (p) t.pause(); else if (t.paused && t.paused()) t.resume(); } catch (e) {} });',
  '    var ms = document.querySelectorAll("audio, video");',
  '    for (var i = 0; i < ms.length; i++) {',
  '      try { if (p) ms[i].pause(); else if (ms[i].paused) ms[i].play().catch(function () {}); } catch (e) {}',
  '    }',
  '    if (document.getAnimations) {',
  '      document.getAnimations().forEach(function (a) { try { if (p) a.pause(); else if (a.playState === "paused") a.play(); } catch (e) {} });',
  '    }',
  '  };',
  // 真实播放状态（回给父页，让「暂停/播放」按钮别自说自话）
  // 「播完」不算在播：GSAP 时间轴跑完后 paused() 仍是 false，只看 paused 会让按钮永远停在「暂停」。
  '  var isPlaying = function () {',
  '    var any = false;',
  '    timelines().forEach(function (t) {',
  '      try {',
  '        if (t.paused && t.paused()) return;',
  '        if (t.progress && t.progress() >= 1 && (!t.repeat || t.repeat() >= 0)) return;',
  '        any = true;',
  '      } catch (e) {}',
  '    });',
  '    var ms = document.querySelectorAll("audio, video");',
  '    for (var i = 0; i < ms.length; i++) { try { if (!ms[i].paused) any = true; } catch (e) {} }',
  '    return any;',
  '  };',
  '  var clock = function () {',
  '    var time = 0, dur = 0;',
  // 优先用真实的 composition 时间轴：进度条要反映「这条动画有多长」，而不是页面里恰好嵌着的素材有多长。
  // 素材常比合成长得多（3:45 的视频塞进 10 秒合成）：旧实现取 document.querySelector("audio, video") 的
  // duration，于是总时长显示成素材长度、进度也跟着素材跑，并且素材是 loop 的 ⇒「自然播完」永远等不到。
  '    rawTimelines().forEach(function (t) {',
  '      try { var d = t.duration(); if (d > dur) dur = d; var tt = t.time(); if (tt > time) time = tt; } catch (e) {}',
  '    });',
  '    if (dur <= 0) {',
  // 没有时间轴（老生成物 / 纯 CSS 动画页）：才退回媒体元素与 gsap 全局时间轴
  '      var m = document.querySelector("audio, video");',
  '      if (m && isFinite(m.duration) && m.duration > 0) { dur = m.duration; time = m.currentTime; }',
  '      try { if (window.gsap) { var gt = window.gsap.globalTimeline; if (gt.duration() > dur) dur = gt.duration(); if (gt.time() > time) time = gt.time(); } } catch (e) {}',
  '    }',
  '    return { time: time, dur: dur };',
  '  };',
  // 拖动预览进度条 → 跳转播放位置：composition 时间轴、页面里的音频/视频、WAAPI 动画一起定位到第 s 秒。
  // 只改播放头，不动播放/暂停状态（GSAP 的 t.time(s) 在播放中也安全：从新位置继续跑）。
  '  var setTime = function (raw) {',
  '    var s = Number(raw);',
  '    if (!isFinite(s) || s < 0) return;',
  '    timelines().forEach(function (t) { try { t.time(s); } catch (e) {} });',
  '    var ms = document.querySelectorAll("audio, video");',
  '    for (var i = 0; i < ms.length; i++) {',
  '      try { if (isFinite(ms[i].duration) && ms[i].duration > 0 && s <= ms[i].duration) ms[i].currentTime = s; } catch (e) {}',
  '    }',
  '    if (document.getAnimations) {',
  '      document.getAnimations().forEach(function (a) { try { a.currentTime = s * 1000; } catch (e) {} });',
  '    }',
  '  };',
  // ===== 载入后保持静止：预览刻意**不自动播放** =====
  // 生成的合成是 gsap.timeline({ paused: true }) 创建、开头又普遍 gsap.set(..., { opacity: 0 })，
  // 所以「什么都不做」就等于停在第 0 帧——起始帧本来就是空的，这是合成自身的设计，不是加载失败。
  // 播放交给用户（「播放」按钮 / 拖动进度条）。这里只做两件事：
  //   ① 把页面里带 autoplay 的 <audio>/<video> 一起冻住（否则合成没动，素材自己先跑起来）；
  //   ② 立刻上报一次状态，让父页的按钮文案与总时长第一帧就对（不用等 300ms 那一轮）。
  // 用户一旦有任何操作（play/pause/seek）就不再干预，避免把刚点下的「播放」又按停（userActed）。
  '  var userActed = false;',
  '  var report = function (ack) {',
  '    var c = clock();',
  '    try { parent.postMessage({ __hg: true, type: "progress", time: c.time, dur: c.dur, playing: isPlaying(), ack: !!ack }, "*"); } catch (e) {}',
  '  };',
  '  var freeze = function () {',
  '    if (userActed) return;',
  '    setPaused(true);',
  '    report(false);',
  '  };',
  '  var freezes = 0;',
  '  var freezeLoop = function () {',
  '    freeze();',
  '    freezes++;',
  // 补几次：兜住「合成晚于 load 才建 timeline / 媒体元数据晚就绪」的情况
  '    if (!userActed && freezes < 5) setTimeout(freezeLoop, 250);',
  '  };',
  '  if (document.readyState === "complete") setTimeout(freezeLoop, 0);',
  '  else window.addEventListener("load", function () { setTimeout(freezeLoop, 0); });',
  // ===== 播完就整体停住 =====
  // 合成的元素普遍带 loop（<video autoplay muted loop> / <audio autoplay loop>），时间轴跑完后
  // 媒体还会在后台一直转：画面看着"结束了"，元素却还在耗 CPU，按钮也会一直显示「暂停」。
  // 这里在真实时间轴全部跑完时统一 setPaused(true)，行为与视频播放器一致（停在末帧，再点「播放」从头重播）。
  // 无限循环（repeat: -1）的合成永远不算播完；没有真实时间轴的页面（媒体页 / 老生成物）不干预。
  '  var ended = false;',
  '  var watchEnd = function () {',
  '    var ts = rawTimelines();',
  '    if (!ts.length) return;',
  '    var allDone = true;',
  '    ts.forEach(function (t) {',
  '      try {',
  '        if (t.repeat && t.repeat() < 0) { allDone = false; return; }',
  '        if (t.time() < t.duration() - 0.05) allDone = false;',
  '      } catch (e) { allDone = false; }',
  '    });',
  '    if (!allDone) { ended = false; return; }',
  '    if (ended) return;',
  '    ended = true;',
  '    setPaused(true);',
  '    report(false);',
  '  };',
  '  window.addEventListener("message", function (ev) {',
  '    var d = ev.data || {};',
  '    if (!d.__hg) return;',
  '    userActed = true;   // 用户接管：freezeLoop 立即停手',
  '    if (d.type === "pause") setPaused(true);',
  '    else if (d.type === "play") setPaused(false);',
  // 拖动跳转：定位后立刻回一条带 ack 的进度，父页据此把进度条钉在目标位置
  // （否则松手后可能先收到一条拖动前发出的旧回报，看起来像"被拽回原位"）
  '    else if (d.type === "seek") { setTime(d.seconds); report(true); }',
  '    else if (d.type === "restart") location.reload();',
  '  });',
  '  setInterval(function () { watchEnd(); report(false); }, 300);',
  '})();'
].join('\n');

// ===== 背景音轨：由主进程确定性注入 HTML（不再交给 Agent 写 <audio>）=====
// 选定 / 更换 / 移除背景音频后，主进程按 project.audioFile 重写 index.html 里的 <audio>：
// 预览副本（PreviewHtml 由 index.html 生成）与转视频（video.ts 直接把 index.html 所在目录交给
// HyperFrames CLI）因此都能拿到音轨；音轨提取与混流由 CLI 内部完成（trace 阶段 audio_process），
// 应用侧不做任何 ffmpeg 混音。标签带固定 id，保证重复设置不会叠出多条音轨。
const BGM_TAG_ID = 'myv-bgm';

// 把一段 HTML 片段插到文档末尾（优先 </body>，其次 </head>，都没有则拼在最前）。
// 模型输出可能被截断而缺 </body>：此时若直接拼到文件末尾，会落进未闭合的 <script> 导致整页 SyntaxError。
function insertHtmlSnippet(html: string, snippet: string): string {
  const bodyEnd = html.lastIndexOf('</body>');
  if (bodyEnd >= 0) return html.slice(0, bodyEnd) + snippet + html.slice(bodyEnd);
  const headEnd = html.lastIndexOf('</head>');
  return headEnd >= 0 ? html.slice(0, headEnd + 7) + snippet + html.slice(headEnd + 7) : snippet + html;
}

function escapeRegExp(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 去掉本应用注入的音轨标签（幂等）
function stripInjectedBgm(html: string): string {
  return html.replace(new RegExp('<audio\\b[^>]*\\bid=["\']' + BGM_TAG_ID + '["\'][^>]*>(?:[\\s\\S]*?</audio>)?', 'gi'), '');
}

// 去掉引用同一个项目音频文件的历史标签（旧版由模型按提示词写入的 <audio>），避免与新标签双份播放
function stripAudioOfFile(html: string, audioRef: string): string {
  const base = path.basename(audioRef);
  if (!base) return html;
  const re = new RegExp('<audio\\b[^>]*src=["\'][^"\']*' + escapeRegExp(base) + '[^"\']*["\'][^>]*>(?:[\\s\\S]*?</audio>)?', 'gi');
  return html.replace(re, '');
}

// 按项目当前 audioFile 重写 HTML 音轨；无 HTML（还没生成）时静默跳过。
// 返回 true = index.html 被改写（调用方可据此刷新预览 / 给提示）。
function applyBgmToHtml(name: string, proj?: Project): boolean {
  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return false;
  const p = proj || readProject(name);
  const audioRef = (p && p.audioFile) || '';
  try {
    const before = fs.readFileSync(htmlPath, 'utf8');
    let html = stripInjectedBgm(before);
    if (audioRef) html = stripAudioOfFile(html, audioRef);
    if (audioRef) {
      // 与旧的提示词要求一致：autoplay + loop（音轨通常短于整条时间轴）
      html = insertHtmlSnippet(html, '<audio id="' + BGM_TAG_ID + '" src="' + audioRef + '" autoplay loop></audio>');
    }
    if (html === before) return false;
    fs.writeFileSync(htmlPath, html, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// 素材选择结果（生成/修改共用）：字幕 / 本次参与生成的项目素材
// 两者都只是「要不要带上」，都不带绝对路径：素材的导入走 project:add-materials（复制进项目并登记），
// 音频则由 applyBgmToHtml 注入 HTML，完全不经过这里。
function resolveMaterials(proj: Project, payload: ProjectAgentPayload): { subtitleText: string; materials: ProjectMaterial[] } {
  // 字幕：'' = 不使用；'__current__' = 当前项目字幕；其他 = 指定带字幕的项目名
  let subtitleText = '';
  const subSel = payload.subtitleProject;
  if (subSel === '__current__') subtitleText = proj.subtitle || '';
  else if (subSel && typeof subSel === 'string') {
    const src = readProject(subSel);
    subtitleText = (src && src.subtitle) || '';
  }
  // 素材：按 id 从项目素材库取（顺序 = 渲染层列表顺序）；取不到的 id 静默忽略
  const ids = Array.isArray(payload.materialIds) ? payload.materialIds : [];
  const all = normalizeMaterials(proj.materials);
  const materials = ids
    .map((id) => all.find((m) => m.id === id))
    .filter((m): m is ProjectMaterial => !!m);
  return { subtitleText, materials };
}

// 素材块（图片 / 视频分开写）：给模型的是**项目内相对路径**——页面里直接 <img src="images/x.png">，
// 预览走 hgpreview:// 协议、转视频时同目录相对引用同样成立（与背景音轨、gsap.min.js 同一套相对引用规则）。
function buildMaterialBlock(materials: ProjectMaterial[]): string {
  const imgs = materials.filter((m) => m.kind === 'image');
  const vids = materials.filter((m) => m.kind === 'video');
  const list = (arr: ProjectMaterial[]): string => arr.map((m) => m.file + '（原文件名 ' + m.label + '）').join('、');
  const parts: string[] = [];
  if (imgs.length) {
    parts.push('\n【图片素材】项目内图片文件：' + list(imgs) + '。请按 <img src="' + imgs[0].file
      + '"> 这类项目内相对路径嵌入，并用 GSAP 为每张图编排入场/退场（淡入淡出、位移、缩放）与切换节奏；多张图片按内容脚本的场景顺序分配。');
  }
  if (vids.length) {
    parts.push('\n【视频素材】项目内视频文件：' + list(vids) + '。请用 <video src="' + vids[0].file
      + '" autoplay muted loop playsinline> 嵌入，并用 GSAP 时间轴编排其入场/出场与播放时段。');
  }
  return parts.join('');
}

// 画布块（生成/修改共用）：把项目选定的画布告诉模型，并要求它按这块画布排版式。
// 为什么必须说：画布是**渲染时的实际视口尺寸**（HyperFrames composition 尺寸 = 成片尺寸），
// 模型若按自己习惯的 1600x900 之类固定尺寸画，画布一变就会在四周留大片黑边（本项目的真实故障）。
// 缺省画布 = DEFAULT_CANVAS（landscape），与老项目的原始观感一致。
// forModify：修改场景追加第 ⑤ 条——换过画布的旧页面必须重排，而不是把旧版式硬塞进新画布。
function buildCanvasBlock(proj: Project, forModify = false): string {
  // project.json 可能被手改过：非白名单取值一律落回缺省画布，避免 CANVAS_SIZES 取不到而崩
  const raw = proj && proj.canvas;
  const canvas: RenderCanvas = raw && RENDER_CANVASES.indexOf(raw) >= 0 ? raw : DEFAULT_CANVAS;
  const size = CANVAS_SIZES[canvas];
  const label = CANVAS_LABELS[canvas] || canvas;
  // ⑤ 只在修改时给：换画布不会自动重排已有页面（project.canvas 变了、页面舞台还是旧的），
  // 于是渲染视口变成新画布后四周留黑边、内容还会被裁——只能让模型按新画布重排一次。
  const relayout = forModify
    ? '⑤ 若当前页面的 <html data-resolution> 或主舞台尺寸与本画布**不一致**（典型情形：页面原来按横屏 1920×1080 排过版，'
      + '而画布后来被改成了方形 / 竖屏），必须**重新排布**：把主舞台改成上面的尺寸，并按新画布重算所有元素的位置、字号与间距，'
      + '让内容排满整块画布；**不要**用 transform: scale、居中留白或黑边把旧版式硬套进新画布。'
    : '';
  return '\n【画布】成片画布固定为 ' + label + '（' + size.width + '×' + size.height + ' 像素），渲染视口就等于这块画布。必须：' +
    '① 在 <html> 标签上写死 data-resolution="' + canvas + '"；' +
    '② 页面主舞台（承载全部内容的那层容器）尺寸严格等于 ' + size.width + '×' + size.height + '，写固定 px，' +
    '不要用 vw / vh / 百分比自适应，也不要用 transform: scale 去缩放舞台；' +
    '③ 内容排满整块画布（该铺满的铺满、该居中的居中），四周不要留大片空白；' +
    '④ 所有元素的坐标、字号、间距都按这块画布设计。' +
    relayout;
}

// 构造 Agent 用户提示（生成与修改共用；extra 置于最前——修改场景为「当前 HTML 源码」段）
// forModify=true 时画布块会追加「旧页面版式与本画布不一致就必须重排」的硬要求（见 buildCanvasBlock）
function buildMaterialPrompt(prompt: string, proj: Project, mats: { subtitleText: string; materials: ProjectMaterial[] }, extra: string[], forModify = false): string {
  return buildAgentPrompt([
    ...extra,
    prompt,
    buildContentBlock(proj.content),
    mats.subtitleText ? '\n【项目字幕】每行格式为 [开始-结束] 文本，时间为秒、可带小数（毫秒精度，如 17.920）：该条字幕必须在开始时间出现、在结束时间前完成淡出，严格按此窗口显示，不得挂到下一条开始；GSAP 时间轴直接用这些小数秒定位（如 tl.to(el,{...},17.920)）；仅 [开始] 无结束时间的行自行按语义安排节奏。\n' + mats.subtitleText : '',
    '\n【音轨】背景音轨由应用在渲染前自动注入（<audio id="myv-bgm">），请勿写入、修改或删除任何 <audio> 标签，也不要为音轨预留页面元素。',
    buildCanvasBlock(proj, forModify),
    // 成片时长声明：不给这个数，渲染器只能取「页面里最长媒体」当片长——素材常比动画长得多
    // （实测：动画 45 秒 + 素材原声 225 秒 ⇒ 成片 3 分 45 秒、后 3 分钟全是黑帧）。
    // 根节点写死这个属性，成片就与动画等长；写错/漏写时应用会自己量一次时间轴兜底（见 video.ts）。
    '\n【成片时长】必须把**动画结束时间**写在根元素上：<html data-composition-duration="<秒数>">（可带小数，如 45.6）。' +
      '这个值要等于你写的时间轴总长度（最后一条 tl.to 的位置 + 它的 duration，取最大），不是素材时长。' +
      '漏写的话渲染器会拿最长素材当片长，成片尾部会出现大段静止画面。',
    buildMaterialBlock(mats.materials)
  ]);
}

// Agent 进度 → 渲染层可读文案（projects:* 进度推送共用）
function progressText(info: AgentProgress): string {
  const stage = info && info.stage;
  const text = stage === 'connecting' ? '正在连接模型…'
    : stage === 'thinking' ? 'AI 正在推理中…（已思考 ' + (info.thinkChars || 0) + ' 字符）'
    : stage === 'writing' ? 'AI 正在生成 HTML…（已输出 ' + (info.contentChars || 0) + ' 字符）'
    : stage === 'retry' ? '本次输出为空，正在升档重试…'
    : stage === 'done' ? '模型输出完成，正在写入文件…'
    : '';
  return text;
}

function register(ctx?: RegisterCtx): void {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

  ipcMain.handle(IPC.Project.List, () => scanProjects());

  // 新建“我的项目”：名字校验 + 写 project.json（目录在写入时创建）
  ipcMain.handle(IPC.Project.Create, (_event, name?: string) => {
    const n = String(name || '').trim();
    if (!n) return { ok: false, message: '项目名不能为空' };
    if (/[\\/:*?"<>|]/.test(n)) return { ok: false, message: '项目名含非法字符（\\ / : * ? " < > |）' };
    if (readProject(n)) return { ok: false, message: '项目「' + n + '」已存在' };
    const proj = ensureProject(n);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  ipcMain.handle(IPC.Project.Load, (_event, name?: string) => {
    if (!name) return null;
    const proj = readProject(name) || ensureProject(name);
    // 素材列表按当前盘上数据规范化后再交给渲染层（脏数据/越权路径在这里就被清掉，界面不必再校验一遍）；
    // videoPath 一并换算成**绝对路径**（视频预览页要拿它 play、要"在文件夹中显示"）。
    return {
      ...proj,
      videoPath: resolveVideoAbs(name, proj.videoPath),
      materials: normalizeMaterials(proj.materials)
    };
  });

  // 保存字幕到当前项目
  ipcMain.handle(IPC.Project.SaveSubtitle, (_event, payload?: ProjectSaveSubtitlePayload) => {
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

  // 整体保存内容脚本（style + scenes）到当前项目
  ipcMain.handle(IPC.Project.SaveContent, (_event, payload?: ProjectSaveContentPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const content = normalizeContent(payload && payload.content);
    const proj = ensureProject(name);
    proj.content = content;
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // ===== HTML 生成/修改：由 Agent 接口实现（应用侧不内置模板） =====
  // 接入点：handler 收到 { name, prompt } 后调用自定义模型 Agent，
  // Agent 产出/修改 HTML 并写入 projectFilePath(name,'index.html')，
  // 应用侧随后更新 proj.htmlPath、置空 proj.videoPath 并刷新链路。
  ipcMain.handle(IPC.Project.GenerateHtml, async (event, payload?: ProjectAgentPayload) => {
    const name = payload && payload.name as string;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

    const proj = ensureProject(name);
    const mats = resolveMaterials(proj, payload || {});
    const userPrompt = buildMaterialPrompt('用户需求：' + prompt.trim(), proj, mats, []);

    try {
      const sender = event.sender;
      const onProgress = (info: AgentProgress) => {
        const text = progressText(info);
        if (text && !sender.isDestroyed()) sender.send(IPC.Project.HtmlProgress, Object.assign({}, info, { text }));
      };
      const reply = await chatWithCustomModel(userPrompt, { onProgress, meta: { project: name, action: 'generate' } });
      // GSAP 本地化：模型若仍写了 CDN 地址则改写为 ./gsap.min.js，并把随包文件复制进项目（离线可渲染）
      let html = hfEnv.localizeGsapHtml(extractHtmlFromReply(reply));
      if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
      const dir = projectDir(name);
      fs.mkdirSync(dir, { recursive: true });
      // 随包 gsap.min.js 不可用（缺失 / 未随包）时退回 CDN 引用，避免页面引用了 ./gsap.min.js 却缺文件、动画完全不跑
      if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(dir)) html = hfEnv.externalizeGsapHtml(html);
      const htmlPath = path.join(dir, 'index.html');
      fs.writeFileSync(htmlPath, html, 'utf8');
      proj.htmlPath = htmlPath;
      proj.videoPath = ''; // HTML 刷新后旧视频失效
      writeProject(proj);
      // 新 HTML 落盘后按项目当前背景音频注入音轨（模型侧已明确不写 <audio>）
      applyBgmToHtml(name, proj);
      const compatible = hfEnv.isHyperframesComposition(html);
      return {
        ok: true,
        htmlPath,
        compatible,
        message: compatible
          ? 'HTML 已生成'
          : 'HTML 已生成，但未通过 HyperFrames 合规检查（缺 data-composition-id / __timelines / gsap），预览可用，转视频前需调整。'
      };
    } catch (e) {
      // chatWithCustomModel 抛出的已是人话文案；这里只补一次分类，把「配置类」标记带给界面（弹「去设置」）
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 修改：基于现有 HTML，由 Agent 按需求改造后覆盖
  ipcMain.handle(IPC.Project.ModifyHtml, async (event, payload?: ProjectAgentPayload) => {
    const name = payload && payload.name as string;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

    const htmlPath = projectFilePath(name, 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML，请先生成' };

    const proj = ensureProject(name);
    const curHtml = fs.readFileSync(htmlPath, 'utf8');
    const mats = resolveMaterials(proj, payload || {});
    // forModify=true：画布块多带一条「旧页面版式与新画布不一致就必须重排」的硬要求
    const userPrompt = buildMaterialPrompt(
      '用户需求（在此基础上改造后输出完整新 HTML）：' + prompt.trim(),
      proj,
      mats,
      ['当前项目的 index.html 源码如下：', '```html', curHtml, '```', ''],
      true
    );

    try {
      const sender = event.sender;
      const onProgress = (info: AgentProgress) => {
        const text = progressText(info);
        if (text && !sender.isDestroyed()) sender.send(IPC.Project.HtmlProgress, Object.assign({}, info, { text }));
      };
      const reply = await chatWithCustomModel(userPrompt, { onProgress, meta: { project: name, action: 'modify' } });
      // GSAP 本地化：同生成分支（改写 CDN 引用 + 随包文件落位；随包缺失则退回 CDN）
      let html = hfEnv.localizeGsapHtml(extractHtmlFromReply(reply));
      if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
      const projDir = path.dirname(htmlPath);
      if (hfEnv.referencesLocalGsap(html) && !hfEnv.copyGsapIntoProject(projDir)) html = hfEnv.externalizeGsapHtml(html);
      fs.writeFileSync(htmlPath, html, 'utf8');
      proj.htmlPath = htmlPath;
      proj.videoPath = '';
      writeProject(proj);
      // 修改后的 HTML 同样补回音轨（模型重写时可能整段丢掉注入标签）
      applyBgmToHtml(name, proj);
      const compatible = hfEnv.isHyperframesComposition(html);
      return {
        ok: true,
        htmlPath,
        compatible,
        message: compatible
          ? 'HTML 已修改'
          : 'HTML 已修改，但未通过 HyperFrames 合规检查，转视频前需调整。'
      };
    } catch (e) {
      // chatWithCustomModel 抛出的已是人话文案；这里只补一次分类，把「配置类」标记带给界面（弹「去设置」）
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 下载项目 HTML 到本地（导出入口）
  ipcMain.handle(IPC.Project.DownloadHtml, (_event, name?: string) => {
    const htmlPath = projectFilePath(String(name || ''), 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    const win = getWindow();
    const save = win ? dialog.showSaveDialogSync(win, {
      title: '导出 HTML',
      defaultPath: (name || 'project') + '.html',
      filters: [{ name: 'HTML 文件', extensions: ['html'] }]
    }) : undefined;
    if (!save) return { ok: false, canceled: true };
    // 导出的是「单个 HTML 文件」：把项目内的 ./gsap.min.js 相对引用换回 CDN 地址，
    // 否则导出后在别处打开会缺 gsap.min.js（同目录没有该文件）导致动画完全不跑。
    fs.writeFileSync(save, hfEnv.externalizeGsapHtml(fs.readFileSync(htmlPath, 'utf8')), 'utf8');
    return { ok: true, savedPath: save };
  });

  // 导出字幕为 .srt 文件（含时间轴，供外部播放器/剪辑软件使用）
  ipcMain.handle(IPC.Project.ExportSrt, (_event, payload?: ProjectExportSrtPayload) => {
    const name = payload && payload.name;
    const srt = payload && typeof payload.srt === 'string' ? payload.srt : '';
    if (!String(srt).trim()) return { ok: false, message: 'SRT 内容为空' };
    const win = getWindow();
    const save = win ? dialog.showSaveDialogSync(win, {
      title: '导出 SRT 字幕',
      defaultPath: (name || 'subtitle') + '.srt',
      filters: [{ name: 'SRT 字幕文件', extensions: ['srt'] }]
    }) : undefined;
    if (!save) return { ok: false, canceled: true };
    fs.writeFileSync(save, srt, 'utf8');
    return { ok: true, savedPath: save };
  });

  // 打开项目所在目录
  ipcMain.handle(IPC.Project.OpenFolder, async (_event, name?: string) => {
    const dir = projectDir(String(name || ''));
    if (!fs.existsSync(dir)) return { ok: false, message: '项目目录不存在（项目尚未保存）' };
    // shell.openPath 返回 Promise<string>：成功为空串，失败为错误信息，必须 await
    const r = await shell.openPath(dir);
    return { ok: r === '' ? true : false, message: r ? ('打开失败：' + r) : '' };
  });

  // 打开指定文件所在目录 / 指定目录（配音、对齐、音色等页面的「打开目录」入口）
  ipcMain.handle(IPC.Project.OpenFolderOf, (_event, p?: string) => {
    if (!p || typeof p !== 'string') return { ok: false, message: '参数缺失' };
    let dir = p;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) dir = path.dirname(p);
    } catch (e) { /* ignore */ }
    if (dir && fs.existsSync(dir)) {
      shell.openPath(dir);
      return { ok: true, dir };
    }
    return { ok: false, message: '目录不存在' };
  });

  // 删除“我的项目”（慎重：仅限 userData 下的项目目录）
  ipcMain.handle(IPC.Project.Delete, (_event, name?: string) => {
    const dir = projectDir(String(name || ''));
    if (!name || !dir.startsWith(projectsRoot())) return { ok: false, message: '非法项目名' };
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { ok: true };
  });

  // 视频渲染完成后，把产物路径回写进项目（供链路状态条点亮“视频”节点）
  // 存**项目内相对路径**（成品就生成在 <项目目录>/video/output.mp4，见 video.ts 的就地渲染）；
  // 老调用方仍可能传绝对路径，落在项目目录内就换算成相对，项目外的才原样存（见 resolveVideoAbs 的说明）。
  ipcMain.handle(IPC.Project.SaveVideo, (_event, payload?: ProjectSetVideoPayload) => {
    const name = payload && payload.name;
    const videoPath = payload && payload.videoPath;
    if (!name || !videoPath) return { ok: false, message: '参数缺失' };
    const proj = ensureProject(name);
    const dir = projectDir(name);
    const abs = path.resolve(String(videoPath));
    proj.videoPath = abs === dir || abs.startsWith(dir + path.sep)
      ? path.relative(dir, abs).replace(/\\/g, '/')
      : String(videoPath);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 视频渲染档位的项目级覆盖（普通用户两项：质量 + 帧率）
  // render 传 null 或字段全非法 → 清除覆盖、回到跟随全局默认（settings.json 的 render）
  ipcMain.handle(IPC.Project.SetRender, (_event, payload?: ProjectSetRenderPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const override = (payload && payload.render === null) ? {} : pickRenderOverride(payload && payload.render);
    if (Object.keys(override).length) proj.render = override;
    else delete proj.render;
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 成片画布方向（**项目属性，不是渲染档位**：不进 settings.json、没有全局默认那一层）。
  // 取值白名单来自 shared/constants 的 RENDER_CANVASES（与 HyperFrames 的画布预设对齐）；非法/缺省一律忽略。
  // 画布一变，已渲好的成片尺寸就不再匹配 ⇒ 与「HTML 改动」同样把 videoPath 置空（避免旧成片被当成当前产物）。
  ipcMain.handle(IPC.Project.SetCanvas, (_event, payload?: ProjectSetCanvasPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const canvas = payload && payload.canvas;
    if (RENDER_CANVASES.indexOf(canvas as RenderCanvas) < 0) return { ok: false, message: '画布取值非法' };
    const proj = ensureProject(name);
    const next = canvas as RenderCanvas;
    if (proj.canvas !== next) {
      proj.canvas = next;
      if (proj.videoPath) proj.videoPath = '';
    }
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // ===== 项目音频：让生成的 HTML 视频有声音 =====
  ipcMain.handle(IPC.Project.PickAudio, async () => {
    const win = getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择音频文件（将复制进项目，随视频一起渲染）',
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 把音频复制进项目目录 audio/ 并记录相对引用
  ipcMain.handle(IPC.Project.SetAudio, (_event, payload?: ProjectSetAudioPayload) => {
    const name = payload && payload.name;
    const audioPath = payload && payload.audioPath;
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在' };
    const audioFile = copyAudioIntoProject(name, audioPath);
    if (!audioFile) return { ok: false, message: '音频复制到项目失败' };
    const proj = ensureProject(name);
    proj.audioFile = audioFile;
    writeProject(proj);
    // 音频一变，立刻重写 HTML 音轨：预览即刻可听，转视频也一定带上
    const htmlUpdated = applyBgmToHtml(name, proj);
    return { ok: true, audioFile: proj.audioFile, htmlUpdated };
  });

  // 移除当前项目音频引用（保留音频文件，避免误删资源）
  ipcMain.handle(IPC.Project.ClearAudio, (_event, payload?: ProjectNamePayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    proj.audioFile = '';
    writeProject(proj);
    // 移除音轨：把 HTML 里注入的 <audio> 一并摘掉（否则成片仍有声，与项目状态不符）
    const htmlUpdated = applyBgmToHtml(name, proj);
    return { ok: true, htmlUpdated };
  });

  // ===== 项目素材库：图片 / 视频（HTML 生成用；替代原来的「单个视频素材」） =====
  // 一个文件框按 kind 给不同扩展名过滤；图片允许多选（一屏素材一次加完），视频单选（单文件常很大）
  ipcMain.handle(IPC.Project.PickMedia, async (_event, payload?: ProjectPickMediaPayload) => {
    const win = getWindow();
    if (!win) return [];
    const kind: ProjectMaterialKind = (payload && payload.kind === 'image') ? 'image' : 'video';
    const exts = kind === 'image' ? [...IMAGE_MATERIAL_EXTS] : [...VIDEO_MATERIAL_EXTS];
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'image'
        ? '选择图片素材（将复制进项目，作为页面素材嵌入 HTML）'
        : '选择视频素材（将复制进项目，作为页面素材嵌入 HTML）',
      filters: [{ name: kind === 'image' ? '图片文件' : '视频文件', extensions: exts }],
      properties: kind === 'image' ? ['openFile', 'multiSelections'] : ['openFile']
    });
    if (r.canceled) return [];
    return r.filePaths || [];
  });

  // 把用户选中的外部文件复制进项目素材目录并登记（新素材默认参与生成；到上限或格式不支持则跳过并如实回报）
  ipcMain.handle(IPC.Project.AddMaterials, (_event, payload?: ProjectAddMaterialsPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const paths = (payload && Array.isArray(payload.paths) ? payload.paths : []).filter((p) => typeof p === 'string' && p);
    if (!paths.length) return { ok: false, message: '没有选择文件' };
    const proj = ensureProject(name);
    const list = normalizeMaterials(proj.materials);
    const added: ProjectMaterial[] = [];
    let skipped = 0;
    for (const p of paths) {
      if (list.length + added.length >= MAX_MATERIALS) { skipped++; continue; }
      const kind = materialKindOf(p);
      if (!kind) { skipped++; continue; }
      const file = copyMaterialIntoProject(name, kind, p);
      if (!file) { skipped++; continue; }
      added.push({ id: newMaterialId(), kind, file, label: path.basename(p), selected: true, addedAt: new Date().toISOString() });
    }
    if (!added.length) {
      return { ok: false, message: '没有可添加的素材：仅支持 ' + materialExtsText() + '，且上限 ' + MAX_MATERIALS + ' 个' };
    }
    proj.materials = [...list, ...added];
    writeProject(proj);
    return {
      ok: true,
      materials: proj.materials,
      message: skipped ? '已添加 ' + added.length + ' 个素材，跳过 ' + skipped + ' 个（格式不支持或已达上限 ' + MAX_MATERIALS + ' 个）' : undefined
    };
  });

  // 整份素材列表回写：**移除与勾选都走这条**（渲染层持完整列表，主进程只做规范化后落盘）。
  // 移除素材只摘登记、**不删项目内的文件**（与原来的 clear-video 语义一致，避免误删资源）。
  ipcMain.handle(IPC.Project.SaveMaterials, (_event, payload?: ProjectSaveMaterialsPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    proj.materials = normalizeMaterials(payload && payload.materials);
    writeProject(proj);
    return { ok: true, materials: proj.materials };
  });

  // 从项目视频素材提取原声音轨 → audio/ 下 .m4a（AAC 192k，同名前缀），设为背景音频
  // 注意：素材改为多图/多视频素材库之后，本 handler 的**界面入口已临时注释下线**（原按钮在「HTML生成」页的
  // 视频素材行；多视频下「提哪一条」需要按素材 id 重做，见 MaterialsSection.vue 里的注释块）。
  // 本轮按用户要求「IPC 与 handler 原样保留」，因此它仍读历史字段 project.videoMaterial；恢复入口前先重做这一步。
  ipcMain.handle(IPC.Project.ExtractVideoAudio, async (_event, name?: string) => {
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const videoRef = proj.videoMaterial || '';
    if (!videoRef) return { ok: false, message: '该项目没有视频素材：请先在「HTML生成」页的「视频素材」里选「选择本地视频文件…」导入' };
    const videoPath = path.join(projectDir(name), videoRef);
    if (!fs.existsSync(videoPath)) return { ok: false, message: '视频素材文件不存在：' + videoRef };
    // 分包之后运行环境不再随安装包：提取音轨要 ffmpeg 包。纯校验（不下载），缺包交给界面问用户
    const lack = runtime.missingPacks(FFMPEG_PACKS);
    if (lack.length) {
      return { ok: false, needPacks: lack, message: '提取视频音轨需要先下载运行环境（' + runtime.packSizeText(lack) + '）' };
    }
    const ffmpeg = hfEnv.BUILTIN_RESOURCES.ffmpeg;
    if (!ffmpeg || !fs.existsSync(ffmpeg)) return { ok: false, message: '未找到 ffmpeg（运行环境包可能损坏，可在设置页重新下载）' };
    const stem = path.basename(videoPath).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    const outName = stem + '.m4a';
    const audioDir = path.join(projectDir(name), 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const outPath = path.join(audioDir, outName);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', outPath], { windowsHide: true });
        child.on('error', (err) => reject(new Error('无法启动 ffmpeg：' + err.message)));
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('提取失败（ffmpeg 退出码 ' + code + '）'))));
      });
    } catch (e) {
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (e2) { /* ignore */ }
      return { ok: false, message: String(((e as Error) && (e as Error).message) || e) };
    }
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      try { fs.unlinkSync(outPath); } catch (e) { /* ignore */ }
      return { ok: false, message: '提取失败：输出音频为空（该视频可能没有音轨）' };
    }
    proj.audioFile = 'audio/' + outName;
    writeProject(proj);
    // 提取出的原声同样立刻注入 HTML（保留原声路线）
    const htmlUpdated = applyBgmToHtml(name, proj);
    return { ok: true, audioFile: proj.audioFile, htmlUpdated };
  });

  // 读取项目当前 HTML 源码（供编辑器载入）
  ipcMain.handle(IPC.Project.ReadHtml, (_event, name?: string) => {
    const htmlPath = projectFilePath(String(name || ''), 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    return { ok: true, html: fs.readFileSync(htmlPath, 'utf8') };
  });

  // 预览副本：index.html + 注入播放控制脚本 → 同目录 index.preview.html
  // （与原件同目录保证相对引用素材可用；预览副本仅用于应用内预览，下载/转视频始终用原件）
  ipcMain.handle(IPC.Project.PreviewHtml, (_event, name?: string) => {
    const htmlPath = projectFilePath(String(name || ''), 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    let html = fs.readFileSync(htmlPath, 'utf8');
    // 页面自己声明的画布（<html data-resolution="…">）：渲染层要用它把预览 iframe 设成「页面原生尺寸」，
    // 再整体缩进当前视角里看（等比 contain + 黑边），这样横屏页面放进方形视口时右边不会被裁。
    // 只认白名单取值；缺失 / 非法一律 ''，由渲染层回落成「按项目当前画布显示」。
    const declared = /<html[^>]*\sdata-resolution\s*=\s*["']([^"']*)["']/i.exec(html);
    const declaredCanvas = declared ? declared[1].trim() : '';
    const pageCanvas: RenderCanvas | '' = RENDER_CANVASES.indexOf(declaredCanvas as RenderCanvas) >= 0
      ? declaredCanvas as RenderCanvas
      : '';
    // 预览副本去除 CSP 限制（仅副本），保证注入的控制脚本可执行
    html = html.replace(/<meta[^>]*content-security-policy[^>]*>/gi, '');
    // GSAP 本地化（仅副本，不动原件）：老项目仍引 CDN 时也能离线预览
    html = hfEnv.localizeGsapHtml(html);
    if (hfEnv.referencesLocalGsap(html)) hfEnv.copyGsapIntoProject(path.dirname(htmlPath));
    const ctrl = '<script>' + HG_PREVIEW_CTRL + '</scr' + 'ipt>';
    // 注入到 </body> 前；模型输出被截断缺 </body> 时落到 </head>（或文档最前）作为独立 script，
    // 否则会拼进未闭合的 <script>，令整段页面脚本 SyntaxError（fitStage/时间轴全失效）
    html = insertHtmlSnippet(html, ctrl);
    const previewPath = htmlPath.replace(/\.html$/i, '.preview.html');
    fs.writeFileSync(previewPath, html, 'utf8');
    return { ok: true, previewPath, pageCanvas };
  });

  // 直接保存（覆盖）项目 HTML 源码，支持"不满意再改"
  ipcMain.handle(IPC.Project.SaveHtml, (_event, payload?: ProjectSaveHtmlPayload) => {
    const name = payload && payload.name;
    const html = payload && typeof payload.html === 'string' ? payload.html : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!String(html).trim()) return { ok: false, message: 'HTML 内容为空' };
    const dir = projectDir(name);
    fs.mkdirSync(dir, { recursive: true });
    // GSAP 本地化：手改/粘贴进来仍带 CDN 地址的 HTML 也统一改写为项目内引用（随包缺失则退回 CDN）
    let localHtml = hfEnv.localizeGsapHtml(html);
    if (hfEnv.referencesLocalGsap(localHtml) && !hfEnv.copyGsapIntoProject(dir)) localHtml = hfEnv.externalizeGsapHtml(localHtml);
    const htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(htmlPath, localHtml, 'utf8');
    const proj = ensureProject(name);
    proj.htmlPath = htmlPath;
    // HTML 改动后旧视频不再匹配 → 标记失效
    proj.videoPath = '';
    writeProject(proj);
    // 手改/粘贴进来的 HTML 可能没有音轨：按项目当前背景音频补回（与生成/修改路径同一套规则）
    applyBgmToHtml(name, proj);
    return { ok: true, htmlPath, compatible: hfEnv.isHyperframesComposition(localHtml) };
  });
}

export {
  register,
  scanProjects,
  projectsRoot,
  projectDir,
  projectFilePath,
  readProject,
  writeProject,
  ensureProject,
  parseSubtitle,
  normalizeContent,
  copyAudioIntoProject,
  copyMaterialIntoProject,
  normalizeMaterials
};
