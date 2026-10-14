// src/main/projects.ts
// 项目化贯通流水线：字幕 → HTML → 预览/转视频
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本
//   index.html    由字幕生成的 HTML composition
//   project.json  项目元数据（name/subtitle/htmlPath/videoPath/title 等）
// 提供：scanProjects / projectDir / projectFilePath / readProject / writeProject /
//       ensureProject / parseSubtitle / copyAudioIntoProject（供 voice 引用）+ 全部 project:* IPC
// 依赖：htmlAgent(chatWithCustomModel / extractHtmlFromReply) /
//       hfEnv(isHyperframesComposition) / runtime(确保运行环境包已解包) / settings(渲染档位白名单) / dialog / shell
import { app, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chatWithCustomModel, extractHtmlFromReply, type AgentProgress } from './htmlAgent'
import * as hfEnv from './hfEnv'
import * as runtime from './runtime'
import { pickRenderOverride } from './settings'
import { IPC } from '../shared/ipc'
import type {
  ContentScript,
  Project,
  ProjectAgentPayload,
  ProjectExportSrtPayload,
  ProjectNamePayload,
  ProjectSaveContentPayload,
  ProjectSaveHtmlPayload,
  ProjectSaveSubtitlePayload,
  ProjectSetAudioPayload,
  ProjectSetRenderPayload,
  ProjectSetVideoPayload,
  RegisterCtx,
  Scene,
  SubtitleLine
} from '../shared/types'

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
      hasVideo: !!(p.videoPath && fs.existsSync(p.videoPath)),
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

// 将外部视频复制进项目 video/ 目录，返回相对引用（video/xxx）；复制失败返回 ''
function copyVideoIntoProject(name: string, videoPath: string): string {
  if (!name || !videoPath || !fs.existsSync(videoPath)) return '';
  try {
    const videoDir = path.join(projectDir(name), 'video');
    fs.mkdirSync(videoDir, { recursive: true });
    const basename = path.basename(videoPath).replace(/[\\/:*?"<>|]/g, '_');
    const extIndex = basename.lastIndexOf('.');
    const stem = extIndex > 0 ? basename.slice(0, extIndex) : basename;
    const ext = extIndex > 0 ? basename.slice(extIndex) : '';
    let saveName = basename;
    let i = 1;
    while (fs.existsSync(path.join(videoDir, saveName))) {
      saveName = stem + '_' + i + ext;
      i++;
      if (i > 1000) break;
    }
    fs.copyFileSync(videoPath, path.join(videoDir, saveName));
    return 'video/' + saveName;
  } catch (e) {
    return '';
  }
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

// 素材选择结果（生成/修改共用）：字幕 / 视频引用
// 两者都只是「要不要带上」，都不带路径：视频的自定义导入走 project:set-video（复制进项目 video/ 并登记），
// 音频则由 applyBgmToHtml 注入 HTML，完全不经过这里。
function resolveMaterials(proj: Project, payload: ProjectAgentPayload): { subtitleText: string; videoRef: string } {
  // 字幕：'' = 不使用；'__current__' = 当前项目字幕；其他 = 指定带字幕的项目名
  let subtitleText = '';
  const subSel = payload.subtitleProject;
  if (subSel === '__current__') subtitleText = proj.subtitle || '';
  else if (subSel && typeof subSel === 'string') {
    const src = readProject(subSel);
    subtitleText = (src && src.subtitle) || '';
  }
  // 视频素材：'' = 不使用；'__current__' = 当前项目视频素材
  const videoRef = payload.videoPath === '__current__' ? (proj.videoMaterial || '') : '';
  return { subtitleText, videoRef };
}

// 构造 Agent 用户提示（生成与修改共用；extra 置于最前——修改场景为「当前 HTML 源码」段）
function buildMaterialPrompt(prompt: string, proj: Project, mats: { subtitleText: string; videoRef: string }, extra: string[]): string {
  return buildAgentPrompt([
    ...extra,
    prompt,
    buildContentBlock(proj.content),
    mats.subtitleText ? '\n【项目字幕】每行格式为 [开始-结束] 文本，时间为秒、可带小数（毫秒精度，如 17.920）：该条字幕必须在开始时间出现、在结束时间前完成淡出，严格按此窗口显示，不得挂到下一条开始；GSAP 时间轴直接用这些小数秒定位（如 tl.to(el,{...},17.920)）；仅 [开始] 无结束时间的行自行按语义安排节奏。\n' + mats.subtitleText : '',
    '\n【音轨】背景音轨由应用在渲染前自动注入（<audio id="myv-bgm">），请勿写入、修改或删除任何 <audio> 标签，也不要为音轨预留页面元素。',
    mats.videoRef ? '\n【视频素材】项目内视频文件：' + mats.videoRef + '，请将该视频作为页面内容的一部分嵌入（<video src="' + mats.videoRef + '" autoplay muted loop playsinline>），并用 GSAP 时间轴编排其入场/出场与播放时段。' : ''
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
    return readProject(name) || ensureProject(name);
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
      return { ok: false, message: 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e)) };
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
    const userPrompt = buildMaterialPrompt(
      '用户需求（在此基础上改造后输出完整新 HTML）：' + prompt.trim(),
      proj,
      mats,
      ['当前项目的 index.html 源码如下：', '```html', curHtml, '```', '']
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
      return { ok: false, message: 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e)) };
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
  ipcMain.handle(IPC.Project.SaveVideo, (_event, payload?: ProjectSetVideoPayload) => {
    const name = payload && payload.name;
    const videoPath = payload && payload.videoPath;
    if (!name || !videoPath) return { ok: false, message: '参数缺失' };
    const proj = ensureProject(name);
    proj.videoPath = String(videoPath);
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

  // ===== 项目视频素材：让生成的 HTML 可嵌入视频片段（作为页面内容的一部分） =====
  ipcMain.handle(IPC.Project.PickVideo, async () => {
    const win = getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择视频文件（将复制进项目，作为页面素材嵌入 HTML）',
      filters: [{ name: '视频文件', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 把视频复制进项目目录 video/ 并记录相对引用（videoMaterial 与成品 videoPath 字段区分）
  ipcMain.handle(IPC.Project.SetVideo, (_event, payload?: ProjectSetVideoPayload) => {
    const name = payload && payload.name;
    const videoPath = payload && payload.videoPath;
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, message: '视频文件不存在' };
    const videoFile = copyVideoIntoProject(name, videoPath);
    if (!videoFile) return { ok: false, message: '视频复制到项目失败' };
    const proj = ensureProject(name);
    proj.videoMaterial = videoFile;
    writeProject(proj);
    // abs：项目内绝对路径，供渲染层预览
    return { ok: true, videoFile: proj.videoMaterial, abs: path.join(projectDir(name), videoFile) };
  });

  // 移除当前项目视频素材引用（保留视频文件，避免误删资源）
  ipcMain.handle(IPC.Project.ClearVideo, (_event, payload?: ProjectNamePayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    proj.videoMaterial = '';
    writeProject(proj);
    return { ok: true };
  });

  // 从项目视频素材提取原声音轨 → audio/ 下 .m4a（AAC 192k，同名前缀），设为背景音频
  ipcMain.handle(IPC.Project.ExtractVideoAudio, async (_event, name?: string) => {
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const videoRef = proj.videoMaterial || '';
    if (!videoRef) return { ok: false, message: '该项目没有视频素材：请先在「HTML生成」页的「视频素材」里选「选择本地视频文件…」导入' };
    const videoPath = path.join(projectDir(name), videoRef);
    if (!fs.existsSync(videoPath)) return { ok: false, message: '视频素材文件不存在：' + videoRef };
    // 运行环境（ffmpeg 等共约 716MB）首次启动可能还在解包：等它就绪再判可执行文件
    const rt = await runtime.ensureRuntime();
    if (!rt.ok) return { ok: false, message: rt.message || '运行环境尚未准备好', detail: rt.detail };
    const ffmpeg = hfEnv.BUILTIN_RESOURCES.ffmpeg;
    if (!fs.existsSync(ffmpeg)) return { ok: false, message: '未找到内置 ffmpeg（resources/ffmpeg/bin）' };
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
    return { ok: true, previewPath };
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
  copyVideoIntoProject
};
