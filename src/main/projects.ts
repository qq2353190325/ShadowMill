// src/main/projects.ts
// 项目化贯通流水线：字幕 → HTML → 预览/转视频
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本（**唯一正文**）
//   content.json  内容脚本 { style, scenes }（**唯一正文**）
//   index.html    由脚本/字幕生成的 HTML composition
//   project.json  **只有索引**：name/title/subtitleCount/htmlPath/videoPath/audioFile/
//                 materials/render/canvas/时间戳 等小字段；不含字幕与脚本正文
//   images/       图片素材（HTML 生成用，project.json 的 materials 以相对引用登记）
//   video/        视频素材（同上）
// 提供：scanProjects / projectDir / projectFilePath / readProject / writeProject /
//       ensureProject / parseSubtitle / copyAudioIntoProject（供 voice 引用）/
//       copyMaterialIntoProject + normalizeMaterials + 全部 project:* IPC
// 依赖：agent(chatWithCustomModel / extractHtmlFromReply) /
//       hfEnv(isHyperframesComposition) / runtime(确保运行环境包已解包) / settings(渲染档位白名单) / dialog / shell
import { app, ipcMain, dialog, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chatWithCustomModel, chatWithChapterPlan, chatWithChapter, chatWithChapterEdit, chatWithCast, chatWithRoute, extractHtmlFromReply, type AgentProgress } from './agent'
import { configTargetOf } from '../shared/errors'
import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, IMAGE_MATERIAL_EXTS, MAX_MATERIALS, RENDER_CANVASES, VIDEO_MATERIAL_EXTS, estimateSubtitleDur } from '../shared/constants'
import * as chapters from './chapters'
import * as cast from './cast'
import * as castLibrary from './castLibrary'
import * as castInject from './castInject'
import * as coreLib from './coreLib'
import { parseRouteReply } from './editRoute'
import * as hfEnv from './hfEnv'
import * as runtime from './runtime'
import { pickRenderOverride } from './settings'
import { IPC } from '../shared/ipc'
import type {
  CastLibraryResult,
  ContentScript,
  Project,
  ProjectAddMaterialsPayload,
  ProjectAgentPayload,
  ProjectCastMember,
  ProjectCastResult,
  ProjectNewCastPayload,
  ProjectSaveCastPayload,
  ProjectChapter,
  ProjectExportSrtPayload,
  ProjectIndex,
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

// ===== 读盘：索引 + 正文分开 =====
// project.json 只存索引；字幕在 subtitle.txt、内容脚本在 content.json。
// 老项目免迁移：文件缺失时回退到 project.json 里的内联旧字段，下次保存自然迁走（写回时剥掉内联字段）。
function contentFilePath(name: string): string {
  return projectFilePath(name, 'content.json');
}

function readProject(name: string): ProjectIndex | null {
  const jsonPath = path.join(projectDir(name), 'project.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 字幕正文：**老项目的内联字段优先**——它才是当前界面显示的那一份。
// 实测历史数据里两者可能不一致（某项目 subtitle.txt 只有 1.5KB、project.json 里的内联是 5.7KB），
// 若让文件优先，老项目一升级字幕就会变短。内联字段会在下一次 writeProject 时被剥掉，之后只剩文件。
function readSubtitle(name: string, legacy?: unknown): string {
  if (typeof legacy === 'string' && legacy) return legacy;
  try {
    const p = projectFilePath(name, 'subtitle.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch (e) { /* 文件读不到就当空 */ }
  return '';
}

// 内容脚本正文：content.json 优先；文件缺失/损坏时回退内联旧字段（都没有就是空的 { style:'', scenes:[] }）
function readContent(name: string, legacy?: unknown): ContentScript {
  try {
    const p = contentFilePath(name);
    if (fs.existsSync(p)) return normalizeContent(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) { /* 回退内联 */ }
  return normalizeContent(legacy);
}

function writeContent(name: string, content: ContentScript): void {
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(contentFilePath(name), JSON.stringify(content, null, 2), 'utf8');
}

function writeProject(proj: Project): Project {
  const dir = projectDir(proj.name);
  fs.mkdirSync(dir, { recursive: true });
  proj.updatedAt = new Date().toISOString();
  // 剥掉正文之前先把正文落盘：老项目的字幕 / 脚本可能只存在于 project.json 的内联字段里，
  // 直接剥掉等于把它们删了（下一次读会回退到更旧的 subtitle.txt）。只在「文件缺失或内容不同」时写。
  const subPath = path.join(dir, 'subtitle.txt');
  let fileSub = '';
  try { fileSub = fs.existsSync(subPath) ? fs.readFileSync(subPath, 'utf8') : ''; } catch (e) { fileSub = ''; }
  if (proj.subtitle && proj.subtitle !== fileSub) fs.writeFileSync(subPath, proj.subtitle, 'utf8');
  const hasContent = !!(proj.content && (proj.content.style || (proj.content.scenes || []).length));
  if (hasContent && !fs.existsSync(contentFilePath(proj.name))) writeContent(proj.name, proj.content);
  // 只写索引：正文（字幕 / 内容脚本）在各自文件里，这里剥掉——否则老项目的内联字段会一直留着，
  // 而且 project.json 会随内容变大（它被 scanProjects 对**每个项目**解析，不能塞正文）。
  const { subtitle, content, ...index } = proj;
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(index, null, 2), 'utf8');
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
  const index = readProject(name);
  if (index) {
    // 索引 + 正文（subtitle.txt / content.json 优先，缺失回退内联旧字段）= 完整 Project。
    // 老项目里的内联 subtitle / content 只当回退来源，下一次 writeProject 就会把它们从索引里剥掉。
    const { subtitle: legacySub, content: legacyContent, ...rest } = index;
    return {
      ...rest,
      name,
      subtitle: readSubtitle(name, legacySub),
      content: readContent(name, legacyContent)
    };
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
    // 字幕正文已不在索引里：判「有没有字幕」看 subtitleCount（老项目与 SaveSubtitle 都会写），
    // 再兜底看内联旧字段与 subtitle.txt（内联优先的那份可能还没来得及迁移到文件）。
    const hasSubtitle = (p.subtitleCount || 0) > 0 || !!p.subtitle
      || fs.existsSync(projectFilePath(d.name, 'subtitle.txt'));
    list.push({
      name: p.name,
      title: p.title || '字幕动画',
      hasSubtitle,
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
      autoT += estimateSubtitleDur(txt); // 估时规则与渲染层共用（@shared/constants），别在这里另写系数
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
// 含逐场景 { 旁白, 画面分镜, 时长提示 }，指示模型据此设计页面视觉与动画节奏。
// **有效场景的判据是「画面分镜非空」**（旁白可以为空：那样的场景是静音段，成片里纯画面播放）。
// 早先按「旁白非空」筛，等于把静音段整段从提示词里丢掉；反过来画面分镜空着的场景没什么可画，不必给模型。
// **全局视觉风格不在这里**：本块在没有有效场景时返回空串，风格挂在里面会被一起吞掉 —— 见 buildStyleBlock()。
// 无 content 或没有有效场景时返回 ''，老项目（无内容脚本）走原 prompt 流程。
function buildContentBlock(content: ContentScript | undefined): string {
  const src = content || {} as ContentScript;
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const valid = scenes.filter((s) => s && String(s.visual || '').trim());
  if (!valid.length) return '';
  const parts = [
    '【内容脚本 · 本项目的整体内容源，请据此设计页面视觉风格与动画节奏；旁白写「（无，本场静音）」的场景没有配音，按画面分镜照常呈现即可】',
    // 画面分镜是「一行一个镜头、行首带时长」的写法（见 agent/script.ts 第 3 条）。
    // **主进程不解析这些时长**：原样交给模型，只在这里把约定讲清楚，让模型自己累加成绝对时间。
    '画面分镜按「一行一个镜头」书写，行首形如「2.5s」的是该镜头的时长：请把这些时长按顺序累加成绝对时间（第 1 个镜头从 0 开始）再安排动画；行首没写时长的镜头按该场景的时长提示均分；镜头时长之和与该场景的时长提示冲突时，以镜头时长之和为准。'
  ];
  valid.forEach((s, i) => {
    const dur = (s.durHint !== undefined && s.durHint !== null && String(s.durHint).trim() !== '')
      ? String(s.durHint).trim() + ' 秒'
      : '未指定';
    const visual = String(s.visual || '').trim();
    // 旁白可以空：那样的场景是静音段（没有配音、成片里纯画面），明确写出来免得模型误以为漏填而自行补旁白
    const narration = String(s.narration || '').trim();
    parts.push('场景 ' + (i + 1) + '（时长提示：' + dur + '）：');
    parts.push('- 旁白：' + (narration || '（无，本场静音）'));
    parts.push('- 画面分镜：');
    // 一行一个镜头（行首带时长）；拆出来逐行缩进，免得第二个镜头起看起来像新的顶层字段
    visual.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => parts.push('  - ' + l));
  });
  return '\n' + parts.join('\n');
}

// 「全局视觉风格」块（生成/修改共用，**无条件注入**）。
// 数据来源：用户在「HTML生成」页填的「全局视觉风格」输入框（存 project.json 的 content.style）。
// 为什么不并进 buildContentBlock：那块在没有「画面分镜非空」的场景时直接 return ''，
// 没写内容脚本的项目，用户在输入框里填的风格就一个字都进不了提示词（填了看着没反应）。
// 风格是整片级前提，与有没有场景无关，所以单独成块、无条件返回。
// 与之配套：HTML 系统提示词里不写任何风格（html.ts），本块是模型唯一的风格来源；
// 用户没填时由它说「未指定、自行拟定」，避免模型滑向固定配色。
function buildStyleBlock(content: ContentScript | undefined): string {
  const style = content && typeof content.style === 'string' ? content.style.trim() : '';
  return style
    ? '\n【全局视觉风格】本项目整片的视觉基调（用户指定，页面配色、质感与氛围以此为准）：' + style
    : '\n【全局视觉风格】用户未指定，按需求描述与内容脚本自行拟定（不要套用固定的配色模板）。';
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
  // ===== 时长可信度闸门：超长就报「无法确定」，别把 1e10 秒原样上屏 =====
  // 页面里有 GSAP 的 repeat: -1 时，那个 tween 的时长是 1e10 秒量级（GSAP 的无限循环哨兵，不是 Infinity），
  // 父时间轴 duration() = 1e10 + 起点 ⇒ 总时长会显示成「166666668:12」（317 年），进度条与 seek 一并废掉。
  // 判据两条：① 超过页面自己声明的成片时长 10 倍（声明写在 <html data-composition-duration>）；
  //         ② 超过 24 小时（页面没写声明时的兜底，与 HyperFrames 自己的渲染上限同口径）。
  // 命中就回 dur=0 + unknown，父页显示「--:--」并说明原因（不猜一个假时长）。
  '    var declared = 0;',
  '    try { declared = Number(document.documentElement.getAttribute("data-composition-duration")) || 0; } catch (e) {}',
  '    if ((declared > 0 && dur > declared * 10) || dur > 86400) return { time: time, dur: 0, unknown: true };',
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
  '    try { parent.postMessage({ __hg: true, type: "progress", time: c.time, dur: c.dur, unknown: !!c.unknown, playing: isPlaying(), ack: !!ack }, "*"); } catch (e) {}',
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
    // 别的项目的字幕同样按「内联优先、其次 subtitle.txt」取（与 ensureProject 同一口径）
    const src = readProject(subSel);
    subtitleText = src ? readSubtitle(subSel, src.subtitle) : '';
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
// 预览走 hgpreview:// 协议、转视频时同目录相对引用同样成立（与背景音轨、随包前端库文件同一套相对引用规则）。
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
    // 风格紧跟内容脚本、**不受「有没有场景」影响**（见 buildStyleBlock 注释）
    buildStyleBlock(proj.content),
    mats.subtitleText ? '\n【项目字幕】每行格式为 [开始-结束] 文本，时间为秒、可带小数（毫秒精度，如 17.920）：该条字幕必须在开始时间出现、在结束时间前完成淡出，严格按此窗口显示，不得挂到下一条开始；GSAP 时间轴直接用这些小数秒定位（如 tl.to(el,{...},17.920)）；仅 [开始] 无结束时间的行自行按语义安排节奏。\n' + mats.subtitleText : '',
    '\n【音轨】背景音轨由应用在渲染前自动注入（<audio id="myv-bgm">），请勿写入、修改或删除任何 <audio> 标签，也不要为音轨预留页面元素。',
    buildCanvasBlock(proj, forModify),
    // 成片时长声明：不给这个数，渲染器只能取「页面里最长媒体」当片长——素材常比动画长得多
    // （实测：动画 45 秒 + 素材原声 225 秒 ⇒ 成片 3 分 45 秒、后 3 分钟全是黑帧）。
    // 根节点写死这个属性，成片就与动画等长；写错/漏写时应用会自己量一次时间轴兜底（见 video.ts）。
    '\n【成片时长】必须把**动画结束时间**写在根元素上：<html data-composition-duration="<秒数>">（可带小数，如 45.6）。' +
      '这个值要等于你写的时间轴总长度（最后一条 tl.to 的位置 + 它的 duration，取最大），不是素材时长。' +
      '漏写的话渲染器会拿最长素材当片长，成片尾部会出现大段静止画面。' +
      // 无限循环是「时长变成 1e10 秒」的唯一来源（2026-10 实测：13 处 repeat:-1 让预览总时长显示成
      // 166666668:12，转视频直接渲不出来）。GSAP 对 repeat:-1 不返回 Infinity，而是把该 tween 的时长
      // 当作 1e10 秒，父时间轴的 duration() 就是「1e10 + 起点」——这条必须在生成时按死。
      '\n【禁止无限循环】任何 tl.to / tl.fromTo / gsap.to 都**不许**写 repeat: -1（也不许 repeat: Infinity）：' +
      'GSAP 会把这种 tween 的时长当成 1e10 秒，整条时间轴的 duration() 立刻变成「1e10 + 起点」，' +
      '预览的总时长会显示成 166666668:12 这种荒谬数字，转视频也渲染不出来。' +
      '需要「一直在动」的效果（呼吸、闪烁、流光、数字雨、扫描线）一律用**有限次数**：按你要的总秒数算好次数，' +
      '如 duration 1.1 + repeat 12 + repeatDelay 0.4；次数照抄成 -1 是明确禁止的。',
    buildMaterialBlock(mats.materials)
  ]);
}

// Agent 进度 → 渲染层可读文案（projects:* 进度推送共用）
// 章节模式下带上「第 k/N 章」前缀：一条 3 分钟的片要发 1 + N 次请求，没有这个前缀用户看到的
// 永远只是「AI 正在生成 HTML…」，判断不了还要等多久。
function progressText(info: AgentProgress): string {
  const stage = info && info.stage;
  const text = stage === 'connecting' ? '正在连接模型…'
    : stage === 'thinking' ? 'AI 正在推理中…（已思考 ' + (info.thinkChars || 0) + ' 字符）'
    : stage === 'writing' ? 'AI 正在生成 HTML…（已输出 ' + (info.contentChars || 0) + ' 字符）'
    : stage === 'retry' ? '本次输出为空，正在升档重试…'
    : stage === 'done' ? '模型输出完成，正在写入文件…'
    : '';
  const idx = info && info.chapterIndex;
  const tot = info && info.chapterTotal;
  if (text && idx && tot) return '第 ' + idx + '/' + tot + ' 章：' + text;
  const ci = info && info.castIndex;
  const ct = info && info.castTotal;
  if (text && ci && ct) return '角色 ' + ci + '/' + ct + '：' + text;
  return text;
}

// ===== 章节化长片（W3）：规划 → 逐角色 → 逐章 → 装配骨架 =====
// 分工：跨进程类型在 shared/types.ts（ProjectChapter / ProjectCastMember）、纯逻辑在 main/chapters.ts
// 与 main/cast.ts（解析/校验/写盘/骨架）、改稿路由在 main/editRoute.ts、
// 提示词在 agent/html.ts，本文件只做编排（谁先谁后、进度怎么报、落盘顺序）。
// 一条硬规则：**模型永远不写 index.html**。骨架由 writeChapterSkeleton() 按当前清单生成，
// 所以「改一章 / 改一个角色」不可能改坏画布、成片时长与 HyperFrames 合规结构。
// 角色为什么要有共享层：章节是互相隔离的 IIFE，作用域不共享；不共享角色代码，同一角色会在每章被各画一遍。

// 有效场景：与 buildContentBlock 同一口径（画面分镜非空才算一场），规划里的场景序号就是按这个顺序编的
function validSceneList(content: ContentScript | undefined): Scene[] {
  const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
  return scenes.filter((s) => s && String(s.visual || '').trim());
}

// 项目画布（脏数据落回缺省，与 buildCanvasBlock 同一口径）
function projectCanvas(proj: Project): RenderCanvas {
  const raw = proj && proj.canvas;
  return raw && RENDER_CANVASES.indexOf(raw) >= 0 ? raw : DEFAULT_CANVAS;
}

// ===== 全局角色库与共享绘制助手的根路径 =====
// 角色库是**用户资产**（可备份、可迁移），落 userData 下；core.js 的真源在应用里（hfEnv.coreSource()）。
function castLibraryRoot(): string {
  return path.join(app.getPath('userData'), 'cast-library');
}

// 把共享绘制助手 core.js 同步进项目（按 CORE_VERSION 覆盖，见 coreLib.ts）并留痕。
// 调用时机：生成/改稿写完骨架前、预览前、渲染前——三处都调，保证页面引用的 ./core.js 一定在。
function syncCoreLib(projDir: string): void {
  const src = hfEnv.coreSource();
  if (!src) return;   // 应用里没有这份文件（不该发生）：页面会 404，但不该因此拦下生成
  const r = coreLib.syncCoreTo(projDir, src);
  if (!r.copied && !r.error) return;
  try {
    const line = new Date().toISOString() + ' [' + path.basename(projDir) + '] '
      + (r.error ? ('core.js 同步失败：' + r.error) : ('core.js 版本 ' + (r.from || '无') + ' → ' + r.to))
      + '\n';
    fs.appendFileSync(path.join(app.getPath('userData'), 'core-lib.log'), line, 'utf8');
  } catch (e) { /* 日志失败不影响生成 */ }
}

// 进度发送器：chapterIndex/chapterTotal、castIndex/castTotal 只在章节模式带
// （渲染层据此拼「第 3/7 章」「角色 2/3」）
function progressSender(event: IpcMainInvokeEvent, extra?: { chapterIndex?: number; chapterTotal?: number; castIndex?: number; castTotal?: number }) {
  const sender = event.sender;
  return (info: AgentProgress) => {
    const merged = Object.assign({}, info, extra || {});
    const text = progressText(merged);
    if (text && !sender.isDestroyed()) sender.send(IPC.Project.HtmlProgress, Object.assign({}, merged, { text }));
  };
}

// 一条直接的进度文案（不带模型阶段，用于「正在规划章节…」「规划失败改用单文件」这类提示）
function pushStatus(event: IpcMainInvokeEvent, text: string, extra?: { chapterIndex?: number; chapterTotal?: number; castIndex?: number; castTotal?: number }): void {
  const sender = event.sender;
  if (!text || sender.isDestroyed()) return;
  sender.send(IPC.Project.HtmlProgress, Object.assign({ stage: 'connecting', thinkChars: 0, contentChars: 0, thinkText: '', text }, extra || {}));
}

// 规划提示词：只喂判断结构所需的信息（需求 + 内容脚本 + 全片规模），不喂画布/素材/音轨这些与分章无关的块
function buildPlanPrompt(requirement: string, proj: Project, sub: SubtitleLine[]): string {
  const sceneN = validSceneList(proj.content).length;
  const lastEnd = sub.reduce((m, l) => Math.max(m, l.time + (l.end || 0)), 0);
  return [
    '用户需求：' + requirement,
    buildContentBlock(proj.content),
    '\n【全片规模】有效场景 ' + sceneN + ' 个' +
      (sub.length ? '；字幕 ' + sub.length + ' 条，最后一条结束于 ' + lastEnd.toFixed(2) + ' 秒' : '；没有字幕'),
    '\n【任务】判断这支片子该写成一份 HTML（single），还是拆成若干章（chapters），' +
      '并按系统提示词的规则给出每章的 id / title / scenes / duration / summary。只输出 JSON。'
  ].filter(Boolean).join('\n');
}

// 字幕在某一时间窗内的条目（章节模式下只给本章窗内的字幕，模型才不会去画别章的内容）
function subtitleWindowText(sub: SubtitleLine[], a: number, b: number): string {
  const hit = sub.filter((l) => {
    const t0 = l.time;
    const t1 = l.end === null || l.end === undefined ? t0 + 2 : l.end;
    return t1 > a + 0.001 && t0 < b - 0.001;
  });
  if (!hit.length) return '';
  return hit.map((l) => '[' + l.time.toFixed(2) + (l.end === null || l.end === undefined ? '' : '-' + l.end.toFixed(2)) + '] ' + l.text).join('\n');
}

// 逐章生成的用户提示：共用部分（需求/风格/画布/素材）+ 全片大纲 + 本章自己的场景与字幕 + 本章角色
function buildChapterPrompt(opts: {
  proj: Project;
  requirement: string;
  list: ProjectChapter[];
  index: number;
  validScenes: Scene[];
  mats: { subtitleText: string; materials: ProjectMaterial[] };
  sub: SubtitleLine[];
  cast: ProjectCastMember[];
}): string {
  const { proj, list, index, validScenes, mats, sub } = opts;
  const ch = list[index];
  const offs = chapters.chapterOffsets(list);
  const a = offs[index];
  const b = Math.round((a + ch.duration) * 100) / 100;
  // 本章场景：buildContentBlock 会从 1 重新编号，所以必须显式说明「原文第几场」
  const slice = ch.sceneFrom > 0 ? validScenes.slice(ch.sceneFrom - 1, ch.sceneTo) : [];
  const sceneBlock = slice.length
    ? buildContentBlock({ style: '', scenes: slice })
    : '';
  // 角色是**项目素材**（用户勾选），与拆不拆章无关：这里只列"勾选参与本次生成"的那些，
  // 并说清它们在页面里已经就位（骨架 / 注入的 script 都已就位）。
  const castList = opts.cast;
  return [
    '用户需求：' + opts.requirement,
    '\n【本章任务】只写第 ' + (index + 1) + '/' + list.length + ' 章（id ' + ch.id + '，标题「' + ch.title + '」，时长 ' +
      ch.duration + ' 秒，整片第 ' + a.toFixed(2) + '–' + b.toFixed(2) + ' 秒）。',
    '\n【本章文件】' + chapters.chapterRelPath(ch.id) + '（文件块里的路径必须与这一行完全一致）',
    // 随包库是「声明了才有」：没声明 p5 的章里 window.p5 是 undefined，模型必须知道这一点
    '\n【本章随包库】' + (ch.uses && ch.uses.length ? ch.uses.join(' + ') + '（骨架已引入，可直接用）' : '只有 gsap + core.js（本章没有声明 p5，用不了 p5 / p5.brush）'),
    // 角色：只给"这一版参与生成"的那些（含身高单位），并明确「必须调用共享角色库、不许重画」
    castList.length
      ? '\n【项目角色】页面上已经就位 ' + castList.length + ' 个角色（骨架已引入它们的 cast/*.js），**必须用它们画，不许在本章里重画**：\n'
        + castList.map((m) => '- cast/' + m.id + '.js（' + m.name + '，高 ' + m.units + 'u）：' + (m.desc || '（未描述）')).join('\n')
        + '\n调用方式：window.__cast["' + castList[0].id + '"](x, y, u, { ctx: ctx2d, … })；(x, y) 是脚底中点，u 是 1 个单位的像素数，'
        + '**ctx 必须传**（本章 canvas 的 2D 上下文，角色就是往它上面画）。'
        + '角色高 ' + castList[0].units + 'u ⇒ 希望它占画面高度 H 的三分之一，就把 u 设成 H/3/' + castList[0].units + '。'
        + '\n本章用不到的角色不要调用（没出场的角色不必出现）。'
      : '\n【项目角色】本项目没有勾选任何角色（不要调用 window.__cast）。',
    // 时间轴从 0 开始是本契约里最容易出错的一条，单独说一次
    '\n【时间口径】本章的时间轴从 0 开始、到 ' + ch.duration + ' 秒结束；不要写绝对时间，也不要引用别章的时间。',
    '\n【全片大纲】（了解上下文即可，**不要画别章的内容**）',
    chapters.chapterOutlineText(list),
    sceneBlock ? '\n【本章内容脚本】下面只列本章覆盖的场景（原内容脚本第 ' + ch.sceneFrom + '–' + ch.sceneTo + ' 场，此处按本章顺序重新编号）：' + sceneBlock : '',
    (() => {
      const win = subtitleWindowText(sub, a, b);
      return win ? '\n【本章字幕】只有这些条目落在本章时间窗内（时间为整片秒数，写进本章时要减去本章起点 ' + a.toFixed(2) + '）：\n' + win : '';
    })(),
    buildStyleBlock(proj.content),
    buildCanvasBlock(proj),
    buildMaterialBlock(mats.materials)
  ].filter(Boolean).join('\n');
}

// 单个角色的生成提示：只给这个角色的设定 + 全片角色表（比例参照）+ 视觉风格 + 它会用到的库
function buildCastPrompt(opts: {
  proj: Project;
  requirement: string;
  list: ProjectCastMember[];
  index: number;
}): string {
  const { proj, list, index } = opts;
  const m = list[index];
  return [
    '用户需求：' + opts.requirement,
    '\n【角色任务】只定义第 ' + (index + 1) + '/' + list.length + ' 个角色「' + m.name + '」（id ' + m.id + '）。',
    '\n【角色文件】' + cast.castRelPath(m.id) + '（文件块里的路径必须与这一行完全一致）',
    '\n【角色设定】' + (m.desc || '（没写描述，请按全片视觉风格自行拟定，并把画法要点写进文件注释）'),
    '\n【身高】这个角色高 ' + m.units + 'u（u = 1 个单位的像素数，由调用方传）；同一画面里别的角色的身高见下面的角色表，'
      + '比例要靠你们的 units 对齐，不要各画各的。',
    '\n【全片角色表】（画的时候要让观众一眼分得清谁是谁）\n' + cast.castOutlineText(list),
    '\n【本角色随包库】' + (m.uses && m.uses.length ? m.uses.join(' + ') + '（骨架已引入，可直接用）' : '只有 gsap（本角色没有声明 p5，只能用传进来的 o.ctx 画）'),
    '\n【往哪画】章节调用时会传 o.ctx（Canvas 2D 上下文），默认就用它画；这样 DOM 章节与 Canvas 章节都能调用你。'
      + (m.uses && m.uses.length ? '你声明了 p5，也可以改用 p5 全局绘制，但必须优先支持 o.ctx。' : ''),
    buildStyleBlock(proj.content)
  ].filter(Boolean).join('\n');
}

// 单文件模式落盘（生成与修改共用）：本地化随包引用 → 注入角色/助手 → 写 index.html → 更新索引 → 补音轨
// 章节模式切回单文件时把 chapters 清空并删掉孤儿章节文件：留着只会让下次渲染的护栏扫到旧内容。
// **角色不跟着清**：角色是项目素材，与"这一版用几个文件写"无关（见 types 里 ProjectCastMember 的说明）。
function writeSingleHtml(opts: { name: string; proj: Project; reply: string }): { ok: boolean; htmlPath?: string; compatible?: boolean; message: string } {
  const { name, proj } = opts;
  let html = hfEnv.localizeVendorHtml(extractHtmlFromReply(opts.reply));
  if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  // 随包文件不可用（缺失 / 未随包）时退回 CDN 引用，避免页面引用了 ./gsap.min.js 却缺文件、动画完全不跑
  if (!hfEnv.ensureVendorFiles(dir, html)) html = hfEnv.externalizeVendorHtml(html);
  // 角色与共享助手注入（幂等）：模型写的单文件页面里没有 window.__cast，靠这里补上
  html = applyCastToHtml(html, proj, dir);
  const htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  proj.htmlPath = htmlPath;
  proj.videoPath = ''; // HTML 刷新后旧视频失效
  // 从章节模式切回单文件：章节文件是上一版产物，留着只会让渲染前的护栏扫到旧内容
  if (proj.chapters && proj.chapters.length) {
    chapters.removeChapterFiles(dir);
    proj.chapters = [];
  }
  writeProject(proj);
  applyBgmToHtml(name, proj);
  const compatible = hfEnv.isHyperframesComposition(html);
  return {
    ok: true,
    htmlPath,
    compatible,
    message: compatible ? '' : '（未通过 HyperFrames 合规检查：缺 data-composition-id / __timelines / gsap，预览可用，转视频前需调整）'
  };
}

// 角色注入（单文件模式）：只注入**勾选参与本次生成**的角色 + core.js 助手。
// 幂等（castInject 会先剥掉上次注入的整组标签）；没勾角色时只注入 core.js（页面里仍有 MC.* 可用）。
function applyCastToHtml(html: string, proj: Project, dir: string): string {
  const rels = cast.selectedMembers(proj.cast).map((m) => cast.castRelPath(m.id));
  // 没有选中角色时**不动页面**（只把上次注入的剥掉）：模型写的单文件页面本来就不认识 MC.*，
  // 硬塞一份 core.js 只是无谓的体积；章节模式不经过这里（骨架里本来就有 core.js）。
  if (!rels.length) return castInject.injectCastTags(html, [], { withCore: false });
  syncCoreLib(dir);   // 注入的是 ./core.js，文件必须先到位
  return castInject.injectCastTags(html, rels, { withCore: true });
}

// 角色表变了（新建 / 导入 / 勾选 / 删除）之后，让页面立刻反映出来：
//   · 章节模式：重写骨架（骨架里的 script 清单就是"谁参与"的真相）；
//   · 单文件模式：把上一次注入剥掉、按新勾选重新注入 —— **不动模型写的内容**（castInject 幂等）。
function refreshCastInPage(name: string, proj: Project): void {
  if (proj.chapters && proj.chapters.length) {
    writeChapterSkeleton(name, proj, proj.chapters, cast.selectedMembers(proj.cast));
    return;
  }
  const htmlPath = projectFilePath(name, 'index.html');
  if (fs.existsSync(htmlPath)) {
    try {
      const cur = fs.readFileSync(htmlPath, 'utf8');
      const next = applyCastToHtml(cur, proj, projectDir(name));
      if (next !== cur) fs.writeFileSync(htmlPath, next, 'utf8');
    } catch (e) { /* 注入失败不拦保存：至少把索引写下去 */ }
  }
  writeProject(proj);
}

// 章节模式落盘：骨架 index.html 由应用按当前章节清单 / 角色表生成（模型不参与），再补音轨
function writeChapterSkeleton(name: string, proj: Project, list: ProjectChapter[], castList: ProjectCastMember[]): { htmlPath: string; compatible: boolean } {
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  // 页面引用了 ./core.js：写骨架前先把助手同步到位（按版本号覆盖，幂等）
  syncCoreLib(dir);
  const total = chapters.totalDuration(list);
  let html = hfEnv.localizeVendorHtml(chapters.buildSkeleton({ chapters: list, canvas: projectCanvas(proj), total, cast: castList }));
  if (!hfEnv.ensureVendorFiles(dir, html)) html = hfEnv.externalizeVendorHtml(html);
  const htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  proj.htmlPath = htmlPath;
  proj.videoPath = '';
  proj.chapters = list;
  proj.cast = castList;
  writeProject(proj);
  applyBgmToHtml(name, proj);
  return { htmlPath, compatible: hfEnv.isHyperframesComposition(html) };
}

// 章节化生成：逐章 N 次，**全部成功才落盘**
// （中途失败不会留下"半支片 + 旧骨架"的混合状态）
// 角色不在这里生成：角色是项目素材（「新建角色」或全局库导入时产生），这里只把它们注入骨架。
async function generateByChapters(opts: {
  event: IpcMainInvokeEvent;
  name: string;
  proj: Project;
  requirement: string;
  list: ProjectChapter[];
  castList: ProjectCastMember[];
  mats: { subtitleText: string; materials: ProjectMaterial[] };
}): Promise<{ ok: boolean; htmlPath?: string; compatible?: boolean; message: string }> {
  const { event, name, proj, list, mats, castList } = opts;
  const validScenes = validSceneList(proj.content);
  const sub = mats.subtitleText ? parseSubtitle(mats.subtitleText) : [];
  const dir = projectDir(name);

  // 逐章
  const files: { path: string; code: string }[] = [];
  const total = list.length;
  for (let i = 0; i < total; i++) {
    const ch = list[i];
    pushStatus(event, '正在生成第 ' + (i + 1) + '/' + total + ' 章（' + ch.title + '，' + ch.duration + ' 秒）…', { chapterIndex: i + 1, chapterTotal: total });
    const prompt = buildChapterPrompt({ proj, requirement: opts.requirement, list, index: i, validScenes, mats, sub, cast: castList });
    const reply = await chatWithChapter(prompt, {
      onProgress: progressSender(event, { chapterIndex: i + 1, chapterTotal: total }),
      meta: { project: name, action: 'chapter-' + ch.id }
    });
    const parsed = chapters.parseFileBlocks(reply, chapters.chapterRelPath(ch.id));
    // 只要本章那一份（模型偶尔会把别章的也吐出来，别章由别章的调用负责）
    const want = chapters.chapterRelPath(ch.id);
    const hit = parsed.files.find((f) => f.path === want);
    const code = hit ? hit.code : '';
    const bad = chapters.validateChapterCode(code);
    if (bad) {
      return { ok: false, message: '第 ' + (i + 1) + ' 章（' + ch.id + '）生成失败：' + bad + '。可再点一次「生成 HTML」，或把这一章拆短后重试。' };
    }
    files.push({ path: want, code });
  }

  chapters.writeChapterFiles(dir, list, files);
  const wrote = writeChapterSkeleton(name, proj, list, castList);
  return {
    ok: true,
    htmlPath: wrote.htmlPath,
    compatible: wrote.compatible,
    message: '已生成 ' + total + ' 章' + (castList.length ? '（页面已引入 ' + castList.length + ' 个角色）' : '')
      + '（共 ' + chapters.totalDuration(list).toFixed(1) + ' 秒），骨架 index.html 由应用生成'
  };
}

// 章节模式下的「按需求修改」，分两段（用户 2026-10-23 定）：
//   ① 路由：只发「大纲 + 角色表 + 用户的话」，让模型报这次要改哪几个文件（不读源码）；
//   ② 定向编辑：只读它点名的那些文件，连同大纲一起发给模型改。
// 为什么要分两段：长片源码合计几百 KB，一次全发会撞模型的上下文上限；分两段后模型只看到自己点名的
// 那一两份源码（用户说「把第 3 章改慢点」就只发第 3 章）。路由失败则回退成「发全部源码」，保证能改。
async function applyChapterEdit(opts: {
  event: IpcMainInvokeEvent;
  name: string;
  proj: Project;
  requirement: string;
  mats: { subtitleText: string; materials: ProjectMaterial[] };
  onProgress: (info: AgentProgress) => void;
}): Promise<{ ok: boolean; htmlPath?: string; compatible?: boolean; message: string }> {
  const { name, proj, mats, onProgress } = opts;
  const dir = projectDir(name);
  const cur = proj.chapters || [];
  const curCast = proj.cast || [];
  const validScenes = validSceneList(proj.content);
  const outline = chapters.chapterOutlineText(cur);
  const castText = cast.castOutlineText(curCast);
  // 项目里当前存在的全部源码路径（路由只允许点名这些）
  const allPaths = cur.map((c) => chapters.chapterRelPath(c.id)).concat(curCast.map((m) => cast.castRelPath(m.id)));

  // ① 路由：只发大纲与需求
  pushStatus(opts.event, '正在判断要改哪几个文件…');
  const routePrompt = [
    '用户需求：' + opts.requirement,
    '\n【章节大纲】\n' + outline,
    '\n【角色表】\n' + castText,
    '\n【可改的文件】\n' + allPaths.join('\n'),
    '\n【任务】指出为了让这条需求生效，模型需要读到哪几个文件的源码。只输出 JSON。'
  ].filter(Boolean).join('\n');
  const routeReply = await chatWithRoute(routePrompt, { onProgress, meta: { project: name, action: 'route' } });
  const routed = parseRouteReply(routeReply, allPaths);
  // 路由失败 → 回退成「发全部源码」（否则这条需求根本改不了）
  const fallbackAll = !routed.route;
  const targets = routed.route ? routed.route.paths.slice() : allPaths;
  const restructure = !!(routed.route && routed.route.restructure);
  if (fallbackAll) {
    pushStatus(opts.event, '没能判断出改动范围（' + (routed.error || '未知原因') + '），改为带上全部源码…');
  } else {
    pushStatus(opts.event, '这次要改：' + (targets.length ? targets.join('、') : '（结构变更）') + (restructure ? '（含结构变更）' : ''));
  }

  // ② 定向编辑：只读被点名的文件
  const targetChapters = cur.filter((c) => targets.indexOf(chapters.chapterRelPath(c.id)) >= 0);
  const targetCast = curCast.filter((m) => targets.indexOf(cast.castRelPath(m.id)) >= 0);
  const codeBlocks = [
    ...chapters.readChapterCode(dir, targetChapters).map((c) => '<<<CURRENT ' + chapters.chapterRelPath(c.id) + '>>>\n' + c.code + '\n<<<END CURRENT>>>'),
    ...cast.readCastCode(dir, targetCast).map((m) => '<<<CURRENT ' + cast.castRelPath(m.id) + '>>>\n' + m.code + '\n<<<END CURRENT>>>')
  ].join('\n\n');
  const editPrompt = [
    '用户需求（改这一版）：' + opts.requirement,
    '\n【章节大纲】改完若结构有变要给出新的 PLAN 块：\n' + outline,
    '\n【角色表】' + (curCast.length ? '\n' + castText : '（本片暂无角色）'),
    restructure ? '\n【注意】这条需求会改变结构（增删章 / 增删角色 / 改时长）：请**先给新的 PLAN 块**（含完整 chapters 与 cast），再给受影响的文件块。新增的章节 / 角色没有现有源码可参考，按大纲与用户需求直接写。' : '',
    '\n【这次允许你改的文件】' + (targets.length ? targets.join('、') : '（无现有文件；只允许新增）'),
    buildStyleBlock(proj.content),
    buildCanvasBlock(proj, true),
    mats.subtitleText ? '\n【项目字幕】每行格式为 [开始-结束] 文本（秒，可带小数）。章节里的时间从 0 开始，写进某章时要减去该章起点：\n' + mats.subtitleText : '',
    buildMaterialBlock(mats.materials),
    codeBlocks ? '\n【当前源码】（只给了这次允许改的文件）\n' + codeBlocks : ''
  ].filter(Boolean).join('\n');

  const reply = await chatWithChapterEdit(editPrompt, { onProgress, meta: { project: name, action: 'chapter-edit' } });

  // ③ 新 PLAN / CAST（增删章 / 改时长 / 改角色表时才需要）
  const planParsed = chapters.parsePlanReply(reply, validScenes.length);
  let list = cur;
  if (planParsed.plan && planParsed.plan.mode === 'chapters') list = planParsed.plan.chapters;
  else if (planParsed.plan && planParsed.plan.mode === 'single') {
    return { ok: false, message: '章节模式的修改不能把整片改回单文件：请先「生成 HTML」并让规划判成单文件，或只改章节内容。' };
  }
  // 角色表不解析：角色是项目素材（在素材区新建 / 勾选 / 导入），模型只可能被要求改某个角色的画法，
  // 那走的是 cast/<id>.js 文件块，不涉及表结构。
  const nextCast = curCast;
  if (!planParsed.plan && planParsed.error) {
    // 没有 PLAN 块是正常的（大多数修改只动画面不动结构）；但若连文件块都没有，就是真失败了
    const probe = chapters.parseFileBlocks(reply);
    if (!probe.files.length) return { ok: false, message: '模型的回复里既没有可用的文件块，也没有可解析的 PLAN：' + planParsed.error };
  }

  // ④ 拆出两类文件块并逐个校验
  const chapterFiles: { path: string; code: string }[] = [];
  const castFiles: { path: string; code: string }[] = [];
  const touched: string[] = [];
  const chapterBlocks = chapters.parseFileBlocks(reply);
  const castBlocks = cast.parseCastFiles(reply);
  for (const f of chapterBlocks.files) {
    const id = path.basename(f.path).replace(/\.js$/i, '');
    if (!list.some((c) => c.id === id)) {
      return { ok: false, message: '模型返回了清单里没有的章节文件（' + f.path + '）：请在 PLAN 块里列出新增章节，或让它只改已有章节。' };
    }
    const bad = chapters.validateChapterCode(f.code);
    if (bad) return { ok: false, message: '第 ' + id + ' 章改动不合法：' + bad };
    chapterFiles.push({ path: f.path, code: f.code });
    touched.push(id);
  }
  for (const f of castBlocks.files) {
    const id = path.basename(f.path).replace(/\.js$/i, '');
    if (!nextCast.some((m) => m.id === id)) {
      return { ok: false, message: '模型返回了项目里没有的角色文件（' + f.path + '）：角色只能在「项目素材 · 角色」里新建或从全局库导入，不能靠改稿生成。' };
    }
    const bad = cast.validateCastCode(f.code);
    if (bad) return { ok: false, message: '角色 ' + id + ' 改动不合法：' + bad };
    castFiles.push({ path: f.path, code: f.code });
    touched.push(id);
  }
  if (!touched.length) {
    // 两类解析器都会把"对方的合法路径"记成坏路径，所以这里只报「既没有合法文件块」这个事实，不列路径以免误导
    return { ok: false, message: '模型没有返回任何可用的文件块（可能只是解释性文字），请把要求写得更具体后重试' };
  }

  // ⑤ 新 PLAN 里新增的章节必须自带代码，否则骨架会引用一个空文件
  for (const ch of list) {
    if (cur.some((c) => c.id === ch.id)) continue;
    if (!chapterFiles.some((f) => path.basename(f.path).replace(/\.js$/i, '') === ch.id)) {
      return { ok: false, message: '新 PLAN 里新增了第 ' + ch.id + ' 章，但没有给出它的代码：请让它连代码一起输出。' };
    }
  }

  if (chapterFiles.length) chapters.writeChapterFiles(dir, list, chapterFiles);
  if (castFiles.length) cast.writeCastFiles(dir, nextCast, castFiles);
  const wrote = writeChapterSkeleton(name, proj, list, cast.selectedMembers(nextCast));
  return {
    ok: true,
    htmlPath: wrote.htmlPath,
    compatible: wrote.compatible,
    message: '已修改 ' + touched.length + ' 个文件（' + touched.join('、') + '）'
      + (list !== cur ? '，章节结构已更新' : '')
      + (fallbackAll ? '（路由失败，本次带上了全部源码）' : '')
  };
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
    // ensureProject 会把索引与两个正文文件拼成完整 Project —— 渲染层契约不变
    const proj = ensureProject(name);
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

  // 整体保存内容脚本（style + scenes）到当前项目：正文写 content.json，project.json 只更新时间戳
  ipcMain.handle(IPC.Project.SaveContent, (_event, payload?: ProjectSaveContentPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const content = normalizeContent(payload && payload.content);
    const proj = ensureProject(name);
    proj.content = content;
    writeContent(name, content);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // ===== HTML 生成/修改：由 Agent 接口实现（应用侧不内置模板） =====
  // 生成分两步：① 规划调用判「单文件还是拆章」② 按结果走单文件（一次写整份 HTML）或章节模式（逐章写 pages/cNN.js）。
  // 规划失败不拦路：解析不出来就按单文件继续（老路径完全没变），只是少了章节化这一档。
  ipcMain.handle(IPC.Project.GenerateHtml, async (event, payload?: ProjectAgentPayload) => {
    const name = payload && payload.name as string;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

    const proj = ensureProject(name);
    const mats = resolveMaterials(proj, payload || {});
    const userPrompt = buildMaterialPrompt('用户需求：' + prompt.trim(), proj, mats, []);
    const sub = mats.subtitleText ? parseSubtitle(mats.subtitleText) : [];

    try {
      const onProgress = progressSender(event);
      pushStatus(event, '正在判断整片结构（单文件 / 章节化）…');
      const planReply = await chatWithChapterPlan(buildPlanPrompt(prompt.trim(), proj, sub), {
        onProgress,
        meta: { project: name, action: 'plan' }
      });
      const parsed = chapters.parsePlanReply(planReply, validSceneList(proj.content).length);
      if (parsed.plan && parsed.plan.mode === 'chapters') {
        // 角色不在规划结果里：角色是项目素材（用户在素材区新建 / 勾选 / 从全局库导入），
        // 这里只取「勾选参与本次生成」的那几个，交给骨架按需引入。
        return await generateByChapters({
          event,
          name,
          proj,
          requirement: prompt.trim(),
          list: parsed.plan.chapters,
          castList: cast.selectedMembers(proj.cast),
          mats
        });
      }
      // 规划判定为单文件 / 规划解析失败：都走老的「一次生成整份 HTML」
      if (parsed.error) pushStatus(event, '章节规划未能解析（' + parsed.error + '），改用单文件模式生成…');
      // 单文件模式同样要带角色：提示词里给出角色清单，落盘时注入 script（与章节化无关）
      const selected = cast.selectedMembers(proj.cast);
      const singlePrompt = selected.length
        ? userPrompt + '\n【项目角色】下面这些角色**已经注入页面**（window.__cast 里就有），必须用它们画、不许重画：\n'
          + cast.castOutlineText(selected)
          + '\n调用方式：window.__cast["' + selected[0].id + '"](x, y, u, { ctx: ctx2d, … })——(x, y) 是脚底中点，u 是 1 个单位的像素数。'
          + '\n【分层要求】角色画在**独立的透明 canvas** 上（铺满舞台、叠在 <video> / <img> / DOM 之上），'
          + '可以直接用助手建层：var layer = MC.castLayer(stage, 宽, 高)；每帧先 MC.clearLayer(layer.ctx) 再画角色。'
          + '**禁止在这张画布上填整屏底色**——那会把视频/图片背景整块盖住。'
          + '只有整页都由代码画（下面没有任何素材）时，角色才可以画进主画布。角色没列出的不要调用。'
        : '';
      const reply = await chatWithCustomModel(singlePrompt || userPrompt, { onProgress, meta: { project: name, action: 'generate' } });
      const wrote = writeSingleHtml({ name, proj, reply });
      return wrote.ok
        ? { ok: true, htmlPath: wrote.htmlPath, compatible: wrote.compatible, message: 'HTML 已生成' + (wrote.message || '') }
        : wrote;
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
    const mats = resolveMaterials(proj, payload || {});
    const onProgress = progressSender(event);

    try {
      // ===== 章节模式：两段式改稿（路由 → 定向编辑），见 applyChapterEdit 的注释 =====
      // 不用再发 index.html：骨架由应用生成，模型改它没有意义（也不会被采用）。
      if (proj.chapters && proj.chapters.length) {
        return await applyChapterEdit({ event, name, proj, requirement: prompt.trim(), mats, onProgress });
      }
      // ===== 单文件模式（老路径，行为不变）=====
      const curHtml = fs.readFileSync(htmlPath, 'utf8');
      // forModify=true：画布块多带一条「旧页面版式与新画布不一致就必须重排」的硬要求
      const userPrompt = buildMaterialPrompt(
        '用户需求（在此基础上改造后输出完整新 HTML）：' + prompt.trim(),
        proj,
        mats,
        ['当前项目的 index.html 源码如下：', '```html', curHtml, '```', ''],
        true
      );
      const reply = await chatWithCustomModel(userPrompt, { onProgress, meta: { project: name, action: 'modify' } });
      const wrote = writeSingleHtml({ name, proj, reply });
      return wrote.ok
        ? { ok: true, htmlPath: wrote.htmlPath, compatible: wrote.compatible, message: 'HTML 已修改' + (wrote.message || '') }
        : wrote;
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
    // 导出的是「单个 HTML 文件」，要处理两件事，否则导出后在别处打开就是空白页：
    // ① 章节模式：把 <script src="./pages/cNN.js"> 与 <script src="./cast/x.js"> 换成内联脚本
    //    （导出的文件旁边没有 pages/ 与 cast/ 目录）；
    // ② 随包库：把 ./gsap.min.js / ./p5.min.js 换回固定版本 CDN 地址（旁边没有这些文件）。
    let html = fs.readFileSync(htmlPath, 'utf8');
    const proj = ensureProject(String(name || ''));
    const dir = path.dirname(htmlPath);
    // 角色与助手与"拆不拆章"无关：两种形态都要内联，否则导出的单文件在别处打开就没有 window.__cast / MC。
    const sources: { path: string; code: string }[] = [];
    if (proj.chapters && proj.chapters.length) {
      for (const c of chapters.readChapterCode(dir, proj.chapters)) sources.push({ path: chapters.chapterRelPath(c.id), code: c.code });
    }
    for (const m of cast.readCastCode(dir, proj.cast || [])) sources.push({ path: cast.castRelPath(m.id), code: m.code });
    if (!(proj.chapters && proj.chapters.length)) syncCoreLib(dir);   // 单文件模式导出前补一次助手文件
    const coreCode = coreLib.readProjectCore(dir);
    if (coreCode) sources.push({ path: coreLib.CORE_FILE, code: coreCode });
    html = chapters.inlineChapters(html, sources);
    fs.writeFileSync(save, hfEnv.externalizeVendorHtml(html), 'utf8');
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

  // ===== 全局角色库（<userData>/cast-library/）=====
  // 四个动作都是「库 ↔ 项目」之间搬角色文件；库本身是用户资产，不进安装包、也不进项目目录。
  // 读库时把「索引有、文件不在」的条目标成 missing 一起回给界面（而不是静默消失）。
  ipcMain.handle(IPC.Project.CastLibrary, () => {
    const root = castLibraryRoot();
    const lib = castLibrary.readLibrary(root);
    if (lib.error) return { ok: false, message: lib.error };
    const members = lib.members.map((m) => ({ ...m, missing: !castLibrary.libraryFileExists(root, m.id) }));
    return { ok: true, members } as { ok: true; members: CastLibraryResult['members'] };
  });

  // 把当前项目里的某个角色存为全局（同 id 覆盖库里的那份）
  ipcMain.handle(IPC.Project.PromoteCast, (_event, payload?: { name?: string; id?: string }) => {
    const name = payload && payload.name;
    const id = payload && payload.id;
    if (!name || !id) return { ok: false, message: '缺少项目名或角色 id' };
    const proj = ensureProject(name);
    const member = (proj.cast || []).find((m) => m.id === String(id).toLowerCase());
    if (!member) return { ok: false, message: '项目里没有这个角色：' + String(id) };
    return castLibrary.promoteFromProject(castLibraryRoot(), projectDir(name), member);
  });

  // 把全局角色导入当前项目：复制进 <项目>/cast/，合并进 project.cast（默认勾选参与本次生成），
  // 然后按当前产物形态把页面重刷一遍——章节模式重写骨架、单文件模式重新注入 script。
  ipcMain.handle(IPC.Project.ImportCast, (_event, payload?: { name?: string; ids?: string[] }) => {
    const name = payload && payload.name;
    const ids = payload && Array.isArray(payload.ids) ? payload.ids : [];
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!ids.length) return { ok: false, message: '没有选择要导入的角色' };
    const proj = ensureProject(name);
    const r = castLibrary.importToProject(castLibraryRoot(), projectDir(name), ids, proj.cast || []);
    if (!r.ok) return { ok: false, message: r.message };
    // 导入的角色默认参与本次生成（与新建一致）
    const merged = r.cast.map((m) => ({ ...m, selected: m.selected === false ? false : true }));
    proj.cast = merged;
    refreshCastInPage(name, proj);
    return { ok: true, message: r.message, cast: merged } as { ok: true; message: string; cast: ProjectCastResult['cast'] };
  });

  // 从全局库删掉一个角色（不动任何已经导入它的项目）
  ipcMain.handle(IPC.Project.RemoveCastFromLibrary, (_event, payload?: { id?: string }) => {
    const id = payload && payload.id;
    if (!id) return { ok: false, message: '缺少角色 id' };
    return castLibrary.removeFromLibrary(castLibraryRoot(), String(id));
  });

  // 手动新建一个角色：调一次模型画 cast/<id>.js（**与「生成 HTML」完全无关**），
  // 然后按当前产物形态重刷页面（章节模式写骨架 / 单文件模式注入 script）。
  ipcMain.handle(IPC.Project.NewCast, async (event, payload?: ProjectNewCastPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const title = String((payload && payload.title) || '').trim();
    const desc = String((payload && payload.desc) || '').trim();
    if (!title && !desc) return { ok: false, message: '请至少填角色名或一句描述' };
    // id 用 slug：优先取标题里的英文/数字，取不到就按现有数量生成 hero / cast2 …
    const existing = new Set((proj.cast || []).map((m) => m.id));
    let id = String(title).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    if (!/^[a-z]/.test(id)) id = '';
    if (!id) {
      let n = (proj.cast || []).length + 1;
      while (existing.has('cast' + n)) n++;
      id = 'cast' + n;
    }
    if (existing.has(id)) return { ok: false, message: '已经有同名角色（id ' + id + '），换个名字' };
    const units = isFinite(Number(payload && payload.units)) && Number(payload && payload.units) > 0
      ? Math.min(30, Number(payload && payload.units))
      : 8;
    const uses = (payload && payload.watercolor) ? ['p5', 'p5.brush'] : [];
    const member: ProjectCastMember = { id, name: title || id, desc, units, selected: true, ...(uses.length ? { uses } : {}) };

    try {
      const onProgress = progressSender(event);
      pushStatus(event, '正在画角色「' + member.name + '」…');
      const prompt = buildCastPrompt({ proj, requirement: desc || title, list: [...(proj.cast || []), member], index: (proj.cast || []).length });
      const reply = await chatWithCast(prompt, { onProgress, meta: { project: name, action: 'cast-new-' + id } });
      const parsed = cast.parseCastFiles(reply, cast.castRelPath(id));
      const want = cast.castRelPath(id);
      const hit = parsed.files.find((f) => f.path === want);
      const bad = cast.validateCastCode(hit ? hit.code : '');
      if (bad) return { ok: false, message: '角色「' + member.name + '」生成失败：' + bad + '。把描述写得更具体或更简单后重试。' };
      cast.writeCastFiles(projectDir(name), [...(proj.cast || []), member], [{ path: want, code: (hit as { code: string }).code }]);
      const nextCast = [...(proj.cast || []), member];
      proj.cast = nextCast;
      refreshCastInPage(name, proj);
      return { ok: true, member, cast: nextCast } as { ok: true; member: ProjectCastMember; cast: ProjectCastMember[] };
    } catch (e) {
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 整份角色表回写（勾选 / 删除 / 改名 / 改身高）：与 project:save-materials 同一套「整份覆盖」语义，
  // 落盘后按当前产物形态重刷页面（勾掉的角色要从骨架/注入里消失）。
  ipcMain.handle(IPC.Project.SaveCast, (_event, payload?: ProjectSaveCastPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const n = cast.normalizeCastList(payload && payload.cast);
    if (n.error) return { ok: false, message: n.error };
    // 只删掉"清单里没有的"角色文件；不改已有角色的代码文件
    const keep = new Set(n.cast.map((m) => m.id));
    for (const old of (proj.cast || [])) {
      if (!keep.has(old.id)) {
        try { fs.rmSync(path.join(projectDir(name), 'cast', old.id + '.js'), { force: true }); } catch (e) { /* ignore */ }
      }
    }
    proj.cast = n.cast;
    refreshCastInPage(name, proj);
    return { ok: true, cast: n.cast } as { ok: true; cast: ProjectCastResult['cast'] };
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
    // 随包库本地化（仅副本，不动原件）：老项目仍引 CDN 时也能离线预览
    html = hfEnv.localizeVendorHtml(html);
    hfEnv.ensureVendorFiles(path.dirname(htmlPath), html);
    // 章节模式还引了 ./core.js（共享绘制助手）：预览前同样按版本同步一次，
    // 否则应用升级后「旧项目预览仍是老助手、渲染却是新助手」，两边画面不一致
    if (/src=["'](?:\.\/)?core\.js["']/i.test(html)) syncCoreLib(path.dirname(htmlPath));
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
    // 随包库本地化：手改/粘贴进来仍带 CDN 地址的 HTML 也统一改写为项目内引用（随包缺失则退回 CDN）
    let localHtml = hfEnv.localizeVendorHtml(html);
    if (!hfEnv.ensureVendorFiles(dir, localHtml)) localHtml = hfEnv.externalizeVendorHtml(localHtml);
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
