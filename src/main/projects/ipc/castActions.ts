// src/main/projects/ipc/castActions.ts
// 角色**动作示范**的频道（「角色」页 · 双击卡片 / 「…」菜单 · 动作示范）——从 ipc/cast.ts 分出来的，
// 那边已经两百多行，再塞五条频道就会越过 300 行的建议线；两组的职责也不同：
//   · ipc/cast.ts      —— 角色本身（库 / 新建 / 改画法 / 改信息 / 删除 / 静态预览）；
//   · 本文件            —— 动作（公共动作 + 每角色专属）与**会动的**示范页。
//
// 动作是什么：角色是纯绘制函数 `window.__cast[id](x, y, u, o)`、不含动画，一条动作 =
// 「时间 → o 里的动画参数」的曲线（见 shared/types.ts 的 CastActionDef 与 main/cast/actions.ts）。
// 所以这里既没有"改角色代码"，也不碰项目：动作存 <userData>/cast-library/actions.json，与角色库并列。
//
// 落盘与拼页都在 main/cast/（actions.ts / demo.ts，不 import electron，可离线测），
// 本文件只做 IPC 装配、唯一的那次模型调用（生成专属动作）与进度推送。
import type { RegisterCtx } from '../../../shared/types';
import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { chatWithCastAction } from '../../agent';
import { configTargetOf } from '../../../shared/errors';
import * as cast from '../../cast';
import * as hfEnv from '../../hfEnv';
import { IPC } from '../../../shared/ipc';
import type {
  CastActionDef, CastActionGeneratePayload, CastActionListResult, CastActionRemovePayload,
  CastActionSavePayload, CastDemoPayload, CastDemoResult
} from '../../../shared/types';
import { CAST_ACTION_DURATION, CAST_ACTION_NAME_MAX } from '../../../shared/constants';
import { castLibraryRoot, castPreviewDir } from '../paths';
import { progressSender, pushStatus } from '../progress';
import { buildCastActionPrompt } from '../prompts';

// 时长：与 actions.ts 的规范化口径一致（0.3~30 秒，两位小数），非法值落回 2 秒
function durationOf(raw: unknown): number {
  const n = Number(raw);
  if (!isFinite(n)) return 2;
  return Math.round(Math.min(CAST_ACTION_DURATION.max, Math.max(CAST_ACTION_DURATION.min, n)) * 100) / 100;
}

// 某个作用范围里已经用掉的 id（新建时交给 cast.nextActionId 避开）
function takenIds(scope: 'shared' | 'own', castId: string): string[] {
  const store = cast.readActions(castLibraryRoot());
  const list = scope === 'shared' ? store.shared : (store.byCast[castId] || []);
  return list.map((a) => a.id);
}

export function registerCastActionIpc(ctx: RegisterCtx): void {
  // 列动作：公共动作（内置 + 用户自建）+ 这个角色的专属动作
  ipcMain.handle(IPC.Cast.ActionList, (_event, payload?: { castId?: string }) => {
    const list: CastActionListResult = cast.listActionsFor(castLibraryRoot(), String((payload && payload.castId) || ''));
    return { ok: true, ...list } as { ok: true } & CastActionListResult;
  });

  // 保存一条关键帧动作（同 id 覆盖；id 为空 = 新建，由主进程起 id —— 渲染层不用自己编 id）
  ipcMain.handle(IPC.Cast.SaveAction, (_event, payload?: CastActionSavePayload) => {
    const scope = payload && payload.scope === 'own' ? 'own' : 'shared';
    const castId = String((payload && payload.castId) || '').trim().toLowerCase();
    const raw = (payload && payload.action) || ({} as CastActionDef);
    const action: CastActionDef = String(raw.id || '').trim()
      ? raw
      : { ...raw, id: cast.nextActionId(takenIds(scope, castId)) };
    const r = cast.upsertAction(castLibraryRoot(), scope, castId, action);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, action: r.action } as { ok: true; action: CastActionDef };
  });

  // 删一条动作（专属动作要带 castId）
  ipcMain.handle(IPC.Cast.RemoveAction, (_event, payload?: CastActionRemovePayload) => {
    const scope = payload && payload.scope === 'own' ? 'own' : 'shared';
    const r = cast.removeAction(
      castLibraryRoot(), scope,
      String((payload && payload.castId) || ''),
      String((payload && payload.actionId) || '')
    );
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  });

  // AI 生成**专属**动作：把角色源码发给模型，让它写一条返回动画参数对象的纯函数。
  // 生成的动作存进 byCast[<角色id>]（只这个角色能演：它可能用了角色自己的参数，如尾巴）。
  // 进度按 taskId 分发（见 preload 的 onTaskProgress）：与「生成 HTML」「画角色」并行也不互相顶掉。
  ipcMain.handle(IPC.Cast.GenerateAction, async (event, payload?: CastActionGeneratePayload) => {
    const id = String((payload && payload.castId) || '').trim().toLowerCase();
    const request = String((payload && payload.request) || '').trim();
    const taskId = payload && typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return { ok: false, message: '内部错误：缺少任务 id（进度无法回传），请刷新页面后重试' };
    if (!cast.isCastPath('cast/' + id + '.js')) return { ok: false, message: '角色 id 不合法：' + String(payload && payload.castId) };
    if (!request) return { ok: false, message: '请写一句「要什么动作」' };
    const root = castLibraryRoot();
    const lib = cast.readLibrary(root);
    if (lib.error) return { ok: false, message: lib.error };
    const member = lib.members.find((m) => m.id === id);
    if (!member) return { ok: false, message: '角色库里没有这个角色：' + id };
    const code = cast.readMemberCode(root, id);
    if (!code.trim()) return { ok: false, message: '角色库里找不到这个角色的代码：' + id + '.js' };
    const duration = durationOf(payload && payload.duration);
    try {
      const onProgress = progressSender(event, { taskId });
      pushStatus(event, '正在给「' + member.name + '」编动作…', { taskId });
      const prompt = buildCastActionPrompt({ member, code, request, duration });
      const reply = await chatWithCastAction(prompt, { onProgress, meta: { action: 'cast-action-' + id } });
      const script = cast.parseCastActionReply(reply);
      if (!script) return { ok: false, message: '模型没有交回动作脚本：把要求写得更具体后重试' };
      const bad = cast.validateActionCode(script);
      if (bad) return { ok: false, message: '动作生成失败：' + bad + '。把要求写得更简单后重试。' };
      const name = (String((payload && payload.name) || '').trim() || request).slice(0, CAST_ACTION_NAME_MAX);
      const action: CastActionDef = {
        id: cast.nextActionId(takenIds('own', id)),
        name,
        duration,
        loop: payload ? payload.loop !== false : true,
        code: script,
        from: 'ai'
      };
      const w = cast.upsertAction(root, 'own', id, action);
      if (!w.ok) return { ok: false, message: w.message };
      return { ok: true, action: w.action } as { ok: true; action: CastActionDef };
    } catch (e) {
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 会动的示范页：读库里的角色代码 + 这个角色的全部动作 → 拼一页自包含 HTML 落盘。
  // 真正跑代码的是 iframe 里的浏览器（sandbox 只给 allow-scripts，见 demo.ts）；
  // 换动作只改 URL 的 #hash，不重新加载这一页，所以一次落盘可以演所有动作。
  ipcMain.handle(IPC.Cast.Demo, (_event, payload?: CastDemoPayload) => {
    const id = String((payload && payload.id) || '').trim().toLowerCase();
    if (!cast.isCastPath('cast/' + id + '.js')) return { ok: false, message: '角色 id 不合法：' + String(payload && payload.id) };
    const root = castLibraryRoot();
    const code = cast.readMemberCode(root, id);
    if (!code.trim()) return { ok: false, message: '角色库里找不到这个角色的代码：' + id + '.js' };
    // core.js 用应用内置真源（与项目里那份同版本，见 coreLib.ts）：示范页与项目无关
    let core = '';
    try { const src = hfEnv.coreSource(); if (src && fs.existsSync(src)) core = fs.readFileSync(src, 'utf8') } catch (e) { core = ''; }
    const uses = (payload && Array.isArray(payload.uses)) ? payload.uses : [];
    const list = cast.listActionsFor(root, id);
    const html = cast.buildCastDemoHtml({
      id,
      code,
      core,
      units: Number(payload && payload.units),
      title: String((payload && payload.title) || id),
      watercolor: uses.indexOf('p5') >= 0,
      actions: [...list.shared, ...list.own]
    });
    const rel = cast.demoRelPath(id);
    try {
      const abs = path.join(castPreviewDir(), id + '.demo.html');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, html, 'utf8');
    } catch (e) {
      return { ok: false, message: '写动作示范页失败：' + ((e as Error).message || String(e)) };
    }
    return { ok: true, rel } as { ok: true } & CastDemoResult;
  });
}
