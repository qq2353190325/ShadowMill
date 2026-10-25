// src/main/projects/htmlWrite.ts
// 把 Agent 的产出落成项目产物：单文件 index.html、角色注入、章节骨架；以及角色表变化后的页面刷新。
// 模型只产出文本，落盘一律在这里做（含随包文件本地化与 HyperFrames 合规检查）。

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { extractHtmlFromReply } from '../agent';
import * as chapters from '../chapters';
import * as cast from '../cast';
import * as coreLib from '../coreLib';
import * as hfEnv from '../hfEnv';
import type { Project, ProjectCastMember, ProjectChapter } from '../../shared/types';
import { applyBgmToHtml } from './bgm';
import { castLibraryRoot, projectDir, projectFilePath } from './paths';
import { projectCanvas } from './prompts';
import { writeProject } from './store';

// 把共享绘制助手 core.js 同步进项目（按 CORE_VERSION 覆盖，见 coreLib.ts）并留痕。
// 调用时机：生成/改稿写完骨架前、预览前、渲染前——三处都调，保证页面引用的 ./core.js 一定在。
export function syncCoreLib(projDir: string): void {
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

// 单文件模式落盘（生成与修改共用）：本地化随包引用 → 注入角色/助手 → 写 index.html → 更新索引 → 补音轨
// 章节模式切回单文件时把 chapters 清空并删掉孤儿章节文件：留着只会让下次渲染的护栏扫到旧内容。
// **角色不跟着清**：角色是项目素材，与"这一版用几个文件写"无关（见 types 里 ProjectCastMember 的说明）。
export function writeSingleHtml(opts: { name: string; proj: Project; reply: string }): { ok: boolean; htmlPath?: string; compatible?: boolean; message: string } {
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

// 角色副本同步：角色只有全局一份（<userData>/cast-library/），页面 / 预览 / 渲染却只认**项目目录内**的文件
// （hgpreview:// 与 HyperFrames 静态服务器都不放行项目外），所以「本片用到哪几个角色」必须在这里落成
// <项目>/cast/<id>.js 副本。幂等，且会把"不再勾选"的副本删掉（只删库里认得的 id，见 syncProjectCast）。
export function syncProjectCast(dir: string, castList: ProjectCastMember[]): void {
  const picked = cast.selectedMembers(castList);
  cast.syncProjectCast(castLibraryRoot(), dir, picked.map((m) => m.id));
}

// 角色注入（单文件模式）：只注入**勾选参与本次生成**的角色 + core.js 助手。
// 幂等（cast.injectCastTags 会先剥掉上次注入的整组标签）；没勾角色时只注入 core.js（页面里仍有 MC.* 可用）。
export function applyCastToHtml(html: string, proj: Project, dir: string): string {
  const rels = cast.selectedMembers(proj.cast).map((m) => cast.castRelPath(m.id));
  // 副本先到位，再往页面里写 <script src="./cast/x.js">（顺序反了就是 404）
  syncProjectCast(dir, proj.cast || []);
  // 没有选中角色时**不动页面**（只把上次注入的剥掉）：模型写的单文件页面本来就不认识 MC.*，
  // 硬塞一份 core.js 只是无谓的体积；章节模式不经过这里（骨架里本来就有 core.js）。
  if (!rels.length) return cast.injectCastTags(html, [], { withCore: false });
  syncCoreLib(dir);   // 注入的是 ./core.js，文件必须先到位
  return cast.injectCastTags(html, rels, { withCore: true });
}

// 本片角色勾选变了（勾上 / 取消 / 库里删了角色）之后，让页面立刻反映出来：
//   · 章节模式：重写骨架（骨架里的 script 清单就是"谁参与"的真相）；
//   · 单文件模式：把上一次注入剥掉、按新勾选重新注入 —— **不动模型写的内容**（cast.injectCastTags 幂等）。
export function refreshCastInPage(name: string, proj: Project): void {
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
export function writeChapterSkeleton(name: string, proj: Project, list: ProjectChapter[], castList: ProjectCastMember[]): { htmlPath: string; compatible: boolean } {
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  // 页面引用了 ./core.js：写骨架前先把助手同步到位（按版本号覆盖，幂等）
  syncCoreLib(dir);
  // 角色副本同理：骨架里的 <script src="./cast/x.js"> 必须先有文件
  syncProjectCast(dir, castList);
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
