// src/main/projects/ipc/cast.ts
// 角色相关的频道。**角色只有全局一份**（<userData>/cast-library/），所以这里分两组：
//   · cast:*      —— 全局角色库本身：列 / 新建 / 改画法 / 改元数据 / 删除 / 预览。与项目无关，
//                    没有"当前项目"也能用（「角色」页就是靠这组）。
//   · project:save-cast —— 本片用到哪几个角色（[{ id, selected }]）：存进 project.json、
//                    把选中的从库同步成 <项目>/cast/ 副本、并按当前产物形态重刷页面。
// 落盘逻辑在 main/cast/library.ts 与 main/cast/preview.ts（那边不 import electron，可离线测），
// 本文件只做 IPC 装配、模型调用与进度推送。

import type { RegisterCtx } from '../../../shared/types';
import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { chatWithCast } from '../../agent';
import { configTargetOf } from '../../../shared/errors';
import * as cast from '../../cast';
import * as hfEnv from '../../hfEnv';
import { IPC } from '../../../shared/ipc';
import type {
  CastCreatePayload, CastLibraryResult, CastPreviewPayload, CastRecreatePayload,
  CastResult, CastSaveMetaPayload, ProjectCastMember, ProjectCastResult, ProjectSaveCastPayload
} from '../../../shared/types';
import { refreshCastInPage } from '../htmlWrite';
import { castLibraryRoot, castPreviewDir, projectDir } from '../paths';
import { progressSender, pushStatus } from '../progress';
import { buildCastEditPrompt, buildCastPrompt } from '../prompts';
import { ensureProject, normalizeCastSelections } from '../store';

// 标题 → id 的 slug（取标题里的英文 / 数字；取不到由 nextAutoId 兜底成 cast2 / cast3…）
function slugFromTitle(title: string): string {
  const s = String(title || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return /^[a-z]/.test(s) ? s : '';
}

// 身高（高几个 u）：与 library.ts / table.ts 的规范口径一致 —— 1~30，非法值落回 8。
// 不能只做 Math.min(30, n)：0.5 这类小于 1 的值能通过 min，落盘时又被规范化成 8，
// 于是「弹窗里显示 0.5u、库里存 8u」，两处对不上。
function unitsOf(raw: unknown): number {
  const n = Number(raw);
  return isFinite(n) && n >= 1 ? Math.min(30, Math.round(n * 10) / 10) : 8;
}

// 库成员的对外形状：补上 missing（索引有、文件不在）——界面据此显示「文件缺失」而不是静默消失
function withMissing(member: ProjectCastMember): CastResult['member'] {
  return { ...member, missing: !cast.libraryFileExists(castLibraryRoot(), member.id) };
}

// 本域的 IPC 注册入口：register.ts 按固定顺序调用它（每个频道只注册一次）。
export function registerCastIpc(ctx: RegisterCtx): void {
  // ===== 全局角色库（<userData>/cast-library/）=====
  // 列库：纯读。把索引里"有索引、文件不在"的条目标成 missing 一起回给界面（而不是静默消失）。
  ipcMain.handle(IPC.Cast.List, () => {
    const root = castLibraryRoot();
    const lib = cast.readLibrary(root);
    if (lib.error) return { ok: false, message: lib.error };
    const members = lib.members.map((m) => withMissing(m));
    return { ok: true, members } as { ok: true; members: CastLibraryResult['members'] };
  });

  // 新建一个角色：调一次模型画 <id>.js，**直接写进库**（与任何项目无关）。
  // 进度按 taskId 分发（见 preload 的 onTaskProgress）：与「生成 HTML」并行时不会互相顶掉。
  ipcMain.handle(IPC.Cast.Create, async (event, payload?: CastCreatePayload) => {
    const taskId = payload && typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return { ok: false, message: '内部错误：缺少任务 id（进度无法回传），请刷新页面后重试' };
    const title = String((payload && payload.title) || '').trim();
    const desc = String((payload && payload.desc) || '').trim();
    const style = String((payload && payload.style) || '').trim();
    if (!title && !desc) return { ok: false, message: '请至少填角色名或一句描述' };
    const root = castLibraryRoot();
    const lib = cast.readLibrary(root);
    if (lib.error) return { ok: false, message: lib.error };
    const existing = new Set(lib.members.map((m) => m.id));
    let id = slugFromTitle(title);
    if (!id) id = cast.nextAutoId(root);
    if (existing.has(id)) return { ok: false, message: '已经有同名角色（id ' + id + '），换个名字' };
    const uses = (payload && payload.watercolor) ? ['p5', 'p5.brush'] : [];
    const member: ProjectCastMember = {
      id,
      name: title || id,
      desc,
      units: unitsOf(payload && payload.units),
      ...(style ? { style } : {}),
      ...(uses.length ? { uses } : {})
    };
    try {
      const onProgress = progressSender(event, { taskId });
      pushStatus(event, '正在画角色「' + member.name + '」…', { taskId });
      // 角色表带上库里已有的那些：同一套角色要能靠 units 对齐比例、也要能一眼分清
      const prompt = buildCastPrompt({ requirement: desc || title, list: [...lib.members, member], index: lib.members.length, style });
      const reply = await chatWithCast(prompt, { onProgress, meta: { action: 'cast-create-' + id } });
      const parsed = cast.parseCastFiles(reply, cast.castRelPath(id));
      const want = cast.castRelPath(id);
      const hit = parsed.files.find((f) => f.path === want);
      const bad = cast.validateCastCode(hit ? hit.code : '');
      if (bad) return { ok: false, message: '角色「' + member.name + '」生成失败：' + bad + '。把描述写得更具体或更简单后重试。' };
      const w = cast.upsertMember(root, member, (hit as { code: string }).code);
      if (!w.ok) return { ok: false, message: w.message };
      return { ok: true, member: withMissing(member) } as { ok: true; member: CastLibraryResult['members'][number] };
    } catch (e) {
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 改画法：在库里这个角色的现有代码上按用户要求重画，**覆盖库里的那份**。
  // 这是「改角色」的唯一入口 —— HTML 生成 / 按需求修改都不许动角色（见 main/cast/edit.ts 的说明）。
  ipcMain.handle(IPC.Cast.Recreate, async (event, payload?: CastRecreatePayload) => {
    const id = String((payload && payload.id) || '').trim().toLowerCase();
    const request = String((payload && payload.request) || '').trim();
    const taskId = payload && typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return { ok: false, message: '内部错误：缺少任务 id（进度无法回传），请刷新页面后重试' };
    if (!cast.isCastPath('cast/' + id + '.js')) return { ok: false, message: '角色 id 不合法：' + String(payload && payload.id) };
    if (!request) return { ok: false, message: '请写一句「要改成什么样」' };
    const root = castLibraryRoot();
    const lib = cast.readLibrary(root);
    if (lib.error) return { ok: false, message: lib.error };
    const member = lib.members.find((m) => m.id === id);
    if (!member) return { ok: false, message: '角色库里没有这个角色：' + id };
    const code = cast.readMemberCode(root, id);
    if (!code.trim()) return { ok: false, message: '角色库里找不到这个角色的代码：' + id + '.js' };
    try {
      const onProgress = progressSender(event, { taskId });
      pushStatus(event, '正在改角色「' + member.name + '」…', { taskId });
      const prompt = buildCastEditPrompt({ member, list: lib.members, code, request });
      const reply = await chatWithCast(prompt, { onProgress, meta: { action: 'cast-edit-' + id } });
      const parsed = cast.parseCastFiles(reply, cast.castRelPath(id));
      const want = cast.castRelPath(id);
      const hit = parsed.files.find((f) => f.path === want);
      const bad = cast.validateCastCode(hit ? hit.code : '');
      if (bad) return { ok: false, message: '角色「' + member.name + '」改画法失败：' + bad + '。把要求写得更具体后重试。' };
      const w = cast.writeMemberCode(root, id, (hit as { code: string }).code);
      if (!w.ok) return { ok: false, message: w.message };
      // 元数据不改（名字 / 身高 / 画风都由「改信息」管）：这里只换了画法
      return { ok: true, member: withMissing(member) } as { ok: true; member: CastLibraryResult['members'][number] };
    } catch (e) {
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 只改元数据（名字 / 描述 / 画风 / 身高 / 是否水彩）：不调模型，立刻生效。
  // 因为项目里的角色元数据是回库读的，改完所有引用它的项目下一次读项目就跟着变。
  ipcMain.handle(IPC.Cast.SaveMeta, (_event, payload?: CastSaveMetaPayload) => {
    const id = String((payload && payload.id) || '');
    if (!id) return { ok: false, message: '缺少角色 id' };
    const r = cast.updateMemberMeta(castLibraryRoot(), id, {
      name: payload && payload.name,
      desc: payload && payload.desc,
      style: payload && payload.style,
      units: payload && payload.units,
      watercolor: payload && payload.watercolor
    });
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, member: withMissing(r.member as ProjectCastMember) } as { ok: true; member: CastLibraryResult['members'][number] };
  });

  // 从库里删掉一个角色（不动项目里已同步的副本；下次 syncProjectCast 会把副本也收走）
  ipcMain.handle(IPC.Cast.Remove, (_event, payload?: { id?: string }) => {
    const id = payload && payload.id;
    if (!id) return { ok: false, message: '缺少角色 id' };
    return cast.removeFromLibrary(castLibraryRoot(), String(id));
  });

  // 角色预览（「这个角色长什么样」）：只读库里的代码 + 写一页预览 HTML，**不改任何角色文件**。
  // 主进程负责「读源码 + 拼页面 + 落盘」，真正跑代码的是 iframe 里的浏览器（见 main/cast/preview.ts）。
  // 预览页落 <userData>/cast-preview/（与项目无关）：hgpreview://…?user=1 放行这一个目录。
  ipcMain.handle(IPC.Cast.Preview, (_event, payload?: CastPreviewPayload) => {
    const id = String((payload && payload.id) || '').trim().toLowerCase();
    if (!cast.isCastPath('cast/' + id + '.js')) return { ok: false, message: '角色 id 不合法：' + String(payload && payload.id) };
    const code = cast.readMemberCode(castLibraryRoot(), id);
    if (!code.trim()) return { ok: false, message: '角色库里找不到这个角色的代码：' + id + '.js' };
    // core.js 用应用内置真源（与项目里那份同版本，见 coreLib.ts）：预览与项目无关，不该去读某个项目目录
    let core = '';
    try { const src = hfEnv.coreSource(); if (src && fs.existsSync(src)) core = fs.readFileSync(src, 'utf8') } catch (e) { core = ''; }
    const uses = (payload && Array.isArray(payload.uses)) ? payload.uses : [];
    const html = cast.buildCastPreviewHtml({
      id,
      code,
      core,
      units: Number(payload && payload.units),
      title: String((payload && payload.title) || id),
      watercolor: uses.indexOf('p5') >= 0
    });
    const rel = cast.previewRelPath(id);
    try {
      const abs = path.join(castPreviewDir(), id + '.html');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, html, 'utf8');
    } catch (e) {
      return { ok: false, message: '写角色预览页失败：' + ((e as Error).message || String(e)) };
    }
    return { ok: true, rel };
  });

  // ===== 本片用到哪几个角色 =====
  // 整份回写 [{ id, selected }] → 从库补全元数据 → 同步项目副本 → 按当前产物形态重刷页面。
  // 勾选 / 取消勾选 / 增删角色都走这一条（没有"导入""存为全局"这些动作了）。
  ipcMain.handle(IPC.Project.SaveCast, (_event, payload?: ProjectSaveCastPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const root = castLibraryRoot();
    const lib = cast.readLibrary(root);
    if (lib.error) return { ok: false, message: lib.error };
    const byId = new Map(lib.members.map((m) => [m.id, m]));
    const refs = normalizeCastSelections(payload && payload.cast);
    const next: ProjectCastMember[] = [];
    const unknown: string[] = [];
    for (const r of refs) {
      const m = byId.get(r.id);
      if (!m) { unknown.push(r.id); continue; }
      next.push({ ...m, selected: r.selected !== false });
    }
    if (!next.length && unknown.length) {
      return { ok: false, message: '角色库里没有这些角色：' + unknown.join('、') };
    }
    const proj = ensureProject(name);
    proj.cast = next;
    // 先把选中的副本同步进 <项目>/cast/，再重刷页面（骨架 / 注入里的 script 清单就是"谁参与"的真相）
    cast.syncProjectCast(root, projectDir(name), cast.selectedMembers(next).map((m) => m.id));
    refreshCastInPage(name, proj);
    return { ok: true, cast: next, ...(unknown.length ? { message: '库里缺这些角色，已跳过：' + unknown.join('、') } : {}) } as { ok: true; cast: ProjectCastResult['cast'] };
  });
}
