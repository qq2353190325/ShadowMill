// src/main/projects/chaptersFlow.ts
// 章节化长片的两条流程：逐章生成（全部成功才落盘）与两段式改稿（先路由、再定向编辑）。
// 两者都会读写 cast/<id>.js —— 角色是项目素材，与「单文件 / 章节化」无关。

import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { chatWithChapter, chatWithChapterEdit, chatWithRoute, type AgentProgress } from '../agent';
import * as chapters from '../chapters';
import * as cast from '../cast';
import { parseRouteReply } from '../editRoute';
import type { Project, ProjectCastMember, ProjectChapter, ProjectMaterial } from '../../shared/types';
import { writeChapterSkeleton } from './htmlWrite';
import { projectDir } from './paths';
import { progressSender, pushStatus } from './progress';
import { buildCanvasBlock, buildChapterPrompt, buildMaterialBlock, buildStyleBlock, validSceneList } from './prompts';
import { parseSubtitle } from './store';

// 章节化生成：逐章 N 次，**全部成功才落盘**
// （中途失败不会留下"半支片 + 旧骨架"的混合状态）
// 角色不在这里生成：角色只有全局一份（「角色」页新建 / 改画法），这里只把它们注入骨架。
export async function generateByChapters(opts: {
  event: IpcMainInvokeEvent;
  name: string;
  // 本次生成任务的 id（进度按它分发；N 次逐章调用共用同一个 id）
  taskId: string;
  proj: Project;
  requirement: string;
  list: ProjectChapter[];
  castList: ProjectCastMember[];
  mats: { subtitleText: string; materials: ProjectMaterial[] };
}): Promise<{ ok: boolean; htmlPath?: string; compatible?: boolean; message: string }> {
  const { event, name, proj, list, mats, castList, taskId } = opts;
  const validScenes = validSceneList(proj.content);
  const sub = mats.subtitleText ? parseSubtitle(mats.subtitleText) : [];
  const dir = projectDir(name);

  // 逐章
  const files: { path: string; code: string }[] = [];
  const total = list.length;
  for (let i = 0; i < total; i++) {
    const ch = list[i];
    pushStatus(event, '正在生成第 ' + (i + 1) + '/' + total + ' 章（' + ch.title + '，' + ch.duration + ' 秒）…', { taskId, chapterIndex: i + 1, chapterTotal: total });
    const prompt = buildChapterPrompt({ proj, requirement: opts.requirement, list, index: i, validScenes, mats, sub, cast: castList });
    const reply = await chatWithChapter(prompt, {
      onProgress: progressSender(event, { taskId, chapterIndex: i + 1, chapterTotal: total }),
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
// **角色不在这条链路上**：角色只有全局一份，新建 / 改画法都在「角色」页（cast:create / cast:recreate），
// 这里只把角色表当上下文（哪几个角色可用、怎么调用），既不发角色源码、也不收角色文件块。
export async function applyChapterEdit(opts: {
  event: IpcMainInvokeEvent;
  name: string;
  // 本次修改任务的 id（路由 + 定向编辑两次调用共用，进度按它分发）
  taskId: string;
  proj: Project;
  requirement: string;
  mats: { subtitleText: string; materials: ProjectMaterial[] };
  onProgress: (info: AgentProgress) => void;
}): Promise<{ ok: boolean; htmlPath?: string; compatible?: boolean; message: string }> {
  const { name, proj, mats, onProgress, taskId } = opts;
  const dir = projectDir(name);
  const cur = proj.chapters || [];
  const curCast = proj.cast || [];
  const validScenes = validSceneList(proj.content);
  const outline = chapters.chapterOutlineText(cur);
  const castText = cast.castOutlineText(curCast);
  // 这次允许改的文件：**只有章节**。角色（全局角色库）不在这条链路上，见函数头注释。
  const allPaths = cur.map((c) => chapters.chapterRelPath(c.id));

  // ① 路由：只发大纲与需求
  pushStatus(opts.event, '正在判断要改哪几个文件…', { taskId });
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
    pushStatus(opts.event, '没能判断出改动范围（' + (routed.error || '未知原因') + '），改为带上全部源码…', { taskId });
  } else {
    pushStatus(opts.event, '这次要改：' + (targets.length ? targets.join('、') : '（结构变更）') + (restructure ? '（含结构变更）' : ''), { taskId });
  }

  // ② 定向编辑：只读被点名的文件
  const targetChapters = cur.filter((c) => targets.indexOf(chapters.chapterRelPath(c.id)) >= 0);
  const codeBlocks = chapters.readChapterCode(dir, targetChapters)
    .map((c) => '<<<CURRENT ' + chapters.chapterRelPath(c.id) + '>>>\n' + c.code + '\n<<<END CURRENT>>>')
    .join('\n\n');
  const editPrompt = [
    '用户需求（改这一版）：' + opts.requirement,
    '\n【章节大纲】改完若结构有变要给出新的 PLAN 块：\n' + outline,
    '\n【角色表】（角色由应用注入页面，**不归你改**；只需要在章节里正确调用它们）' + (curCast.length ? '\n' + castText : '（本片暂无角色）'),
    restructure ? '\n【注意】这条需求会改变结构（增删章 / 改时长）：请**先给新的 PLAN 块**（含完整 chapters），再给受影响的文件块。新增的章节没有现有源码可参考，按大纲与用户需求直接写。' : '',
    '\n【这次允许你改的文件】' + (targets.length ? targets.join('、') : '（无现有文件；只允许新增章节）'),
    '\n【角色文件不归你改】不要交 cast/*.js 文件块；角色要换样子请让用户去「角色」页改它。',
    buildStyleBlock(proj.content),
    buildCanvasBlock(proj, true),
    mats.subtitleText ? '\n【项目字幕】每行格式为 [开始-结束] 文本（秒，可带小数）。章节里的时间从 0 开始，写进某章时要减去该章起点：\n' + mats.subtitleText : '',
    buildMaterialBlock(mats.materials),
    codeBlocks ? '\n【当前源码】（只给了这次允许改的文件）\n' + codeBlocks : ''
  ].filter(Boolean).join('\n');

  const reply = await chatWithChapterEdit(editPrompt, { onProgress, meta: { project: name, action: 'chapter-edit' } });

  // ③ 新 PLAN（增删章 / 改时长时才需要）
  const planParsed = chapters.parsePlanReply(reply, validScenes.length);
  let list = cur;
  if (planParsed.plan && planParsed.plan.mode === 'chapters') list = planParsed.plan.chapters;
  else if (planParsed.plan && planParsed.plan.mode === 'single') {
    return { ok: false, message: '章节模式的修改不能把整片改回单文件：请先「生成 HTML」并让规划判成单文件，或只改章节内容。' };
  }
  // 角色表不解析也不改：角色只有全局一份，改画法在「角色」页做（cast:recreate）；
  // 改稿只可能被要求调整章节里对它的调用。
  const nextCast = curCast;
  if (!planParsed.plan && planParsed.error) {
    // 没有 PLAN 块是正常的（大多数修改只动画面不动结构）；但若连文件块都没有，就是真失败了
    const probe = chapters.parseFileBlocks(reply);
    if (!probe.files.length) return { ok: false, message: '模型的回复里既没有可用的文件块，也没有可解析的 PLAN：' + planParsed.error };
  }

  // ④ 拆出章节文件块并逐个校验（角色文件块一律忽略：它不是这条链路能改的东西）
  const chapterFiles: { path: string; code: string }[] = [];
  const touched: string[] = [];
  const chapterBlocks = chapters.parseFileBlocks(reply);
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
  if (!touched.length) {
    return { ok: false, message: '模型没有返回任何可用的章节文件块（可能只是解释性文字，或只交了角色文件——角色不归改稿管），请把要求写得更具体后重试' };
  }

  // ⑤ 新 PLAN 里新增的章节必须自带代码，否则骨架会引用一个空文件
  for (const ch of list) {
    if (cur.some((c) => c.id === ch.id)) continue;
    if (!chapterFiles.some((f) => path.basename(f.path).replace(/\.js$/i, '') === ch.id)) {
      return { ok: false, message: '新 PLAN 里新增了第 ' + ch.id + ' 章，但没有给出它的代码：请让它连代码一起输出。' };
    }
  }

  if (chapterFiles.length) chapters.writeChapterFiles(dir, list, chapterFiles);
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
