// src/main/projects/store.ts
// 项目的读写：project.json（索引）+ subtitle.txt / content.json（正文）的读、写、补齐与扫描。
// 正文与索引分开是刻意的：project.json 只存小字段，字幕与内容脚本各占一个文件。
// 角色是**全局资产**（<userData>/cast-library/）：project.json 里只落 [{ id, selected }]，
// 读项目时按 id 从库补全元数据（库里改名 / 改身高，所有项目立刻跟着变）——见下面的 resolveProjectCast()。

import path from 'node:path';
import fs from 'node:fs';
import { estimateSubtitleDur } from '../../shared/constants';
import type { ContentScript, Project, ProjectCastMember, ProjectCastSelection, ProjectIndex, SubtitleLine } from '../../shared/types';
import * as cast from '../cast';
import { castLibraryRoot, contentFilePath, projectDir, projectFilePath, projectsRoot, resolveVideoAbs } from './paths';

// 角色 id 的合法形状（与 main/cast/table.ts、library.ts 的 ID_RE 同一口径：小写 slug，直接当文件名用）
const CAST_ID_RE = /^[a-z][a-z0-9_]{0,23}$/;

export function readProject(name: string): ProjectIndex | null {
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
export function readSubtitle(name: string, legacy?: unknown): string {
  if (typeof legacy === 'string' && legacy) return legacy;
  try {
    const p = projectFilePath(name, 'subtitle.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch (e) { /* 文件读不到就当空 */ }
  return '';
}

// 内容脚本正文：content.json 优先；文件缺失/损坏时回退内联旧字段（都没有就是空的 { style:'', scenes:[] }）
export function readContent(name: string, legacy?: unknown): ContentScript {
  try {
    const p = contentFilePath(name);
    if (fs.existsSync(p)) return normalizeContent(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) { /* 回退内联 */ }
  return normalizeContent(legacy);
}

export function writeContent(name: string, content: ContentScript): void {
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(contentFilePath(name), JSON.stringify(content, null, 2), 'utf8');
}

export function writeProject(proj: Project): Project {
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
  // 角色同理只留 id + 勾选：元数据在全局角色库里，项目里再存一份就会两处漂移。
  const { subtitle, content, cast: castMembers, ...rest } = proj;
  const index = { ...rest, cast: (castMembers || []).map((m) => ({ id: m.id, selected: m.selected !== false })) };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(index, null, 2), 'utf8');
  return proj;
}

// 磁盘上的 [{ id, selected }]（兼容旧数据的完整成员快照：只取 id 与 selected，元数据一律回库读）
export function normalizeCastSelections(raw: unknown): ProjectCastSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectCastSelection[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const o = (it && typeof it === 'object' && !Array.isArray(it)) ? it as Record<string, unknown> : {};
    const id = String(o.id === undefined || o.id === null ? '' : o.id).trim().toLowerCase();
    if (!CAST_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(o.selected === false ? { id, selected: false } : { id });
  }
  return out;
}

// 本片角色 → 完整成员：按 id 回角色库取元数据（库是唯一真源）。
// 库里没有的 id（角色被删掉了）直接跳过：界面上看不见它，也就不可能被注入页面。
export function resolveProjectCast(raw: unknown): ProjectCastMember[] {
  const refs = normalizeCastSelections(raw);
  if (!refs.length) return [];
  const lib = cast.readLibrary(castLibraryRoot()).members;
  const byId = new Map(lib.map((m) => [m.id, m]));
  const out: ProjectCastMember[] = [];
  for (const r of refs) {
    const m = byId.get(r.id);
    if (!m) continue;
    out.push({ ...m, selected: r.selected !== false });
  }
  return out;
}

export function ensureProject(name: string): Project {
  const index = readProject(name);
  if (index) {
    // 索引 + 正文（subtitle.txt / content.json 优先，缺失回退内联旧字段）= 完整 Project。
    // 老项目里的内联 subtitle / content 只当回退来源，下一次 writeProject 就会把它们从索引里剥掉。
    // 角色按 id 从全局库补全（库是元数据真源）；库里没有的 id 直接丢掉，界面上看不见它。
    const { subtitle: legacySub, content: legacyContent, ...rest } = index;
    return {
      ...rest,
      name,
      subtitle: readSubtitle(name, legacySub),
      content: readContent(name, legacyContent),
      cast: resolveProjectCast(index.cast)
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
    cast: [],
    createdAt: new Date().toISOString()
  };
}

// 内容脚本数据规范化：基本类型校验 + 场景 id 自动补全（向后兼容：无/非法 content 视为空）
export function normalizeContent(raw: unknown): ContentScript {
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
export function scanProjects(): { name: string; title: string; hasSubtitle: boolean; hasHtml: boolean; hasVideo: boolean; subtitleCount: number; updatedAt: string }[] {
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
export function parseSubtitle(text: string): SubtitleLine[] {
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
export function copyAudioIntoProject(name: string, audioPath: string): string {
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
