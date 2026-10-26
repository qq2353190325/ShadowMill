// src/main/agent/script.ts
// 内容脚本 Agent：把「要写什么 + 当前场景」交给自定义模型，产出结构化场景数组。
//
// 定位（与 ./html.ts 完全同构）：只做「拼提示词 → 调模型 → 解析 JSON」，**不读写任何项目文件**。
//   · 上下文由渲染层通过载荷给（当前编辑器里的 scenes），主进程不读 content.json；
//   · 结果回给渲染层，落盘仍走 project:save-content（用户点「保存到项目」才发生）；
//   · 没有文件工具、没有 shell —— 模型只负责产出 JSON，不接触文件系统。
// 传输层（多轮消息 / 流式 / 升档 / 日志）在 ./chat.ts。
//
// 依赖：./chat(chatWithModel) / ./chatLog(对话记录读写) / ../../shared(errors、ipc、types)。
import { ipcMain } from 'electron'
import { chatWithModel } from './chat'
import {
  clearChat,
  isValidVersionId,
  newVersionId,
  normalizeScenes,
  readChatIndex,
  readVersion,
  writeChatIndex,
  writeVersion
} from './chatLog'
import { EST_CHARS_PER_SEC } from '../../shared/constants'
import { configTargetOf } from '../../shared/errors'
import { IPC } from '../../shared/ipc'
import type {
  AgentProgressPayload,
  IpcResult,
  Scene,
  ScriptAppendRoundPayload,
  ScriptCastRef,
  ScriptChatIndex,
  ScriptChatRoundMeta,
  ScriptGeneratePayload,
  ScriptGenerateReply,
  ScriptProgressPayload,
  ScriptVersionResult
} from '../../shared/types'
import { SCRIPT_AGENT_SYSTEM } from './constants'

// 提示词常量本身在 ./constants.ts（agent 模块的文案唯一真源），这里只是再导出，保持对外口径不变。
export { SCRIPT_AGENT_SYSTEM }

// 一次最多产出多少场景（防模型跑飞：把整部剧塞进一个数组）
const MAX_SCENES = 50;
// 一次最多带多少个角色进提示词（防清单跑飞；一部片子的角色远少于这个数）
const MAX_CAST = 20;
// 语速口径来自 @shared/constants（与字幕估时、内容脚本页「估算时长」同一份），这里只用于把
// 「目标总时长」换算成提示词里的字数预算——别在本文件另写一个 4.5 / 4 之类的常数。


// 构造用户提示：要求 + 当前脚本 + 参数（场景数 / 目标总时长换算的字数预算）
export function buildScriptPrompt(payload: ScriptGeneratePayload): string {
  const parts: string[] = [];
  parts.push('【要求】' + String(payload.request || '').trim());

  // 角色（用户在「AI 创作」里从全局角色库挑）：只作写稿上下文，不进 scenes、不落盘。
  // **空数组 = 没选角色，整块省略**——没选角色时提示词必须与加这个字段之前逐字一致（老行为不变）。
  const cast = Array.isArray(payload.cast) ? payload.cast : [];
  if (cast.length) {
    parts.push('【角色】（本片有哪些角色；称呼与外观以这里为准）');
    cast.forEach((m) => {
      const desc = String(m.desc || '').trim();
      parts.push('- ' + m.name + '（id ' + m.id + '，高 ' + m.units + 'u）：' + (desc || '（未描述，外观自行拟定并全片保持一致）'));
    });
    parts.push('【角色使用约定】');
    parts.push('- 旁白和画面分镜里提到某个角色时，一律用上表的名字称呼，外观按上表的描述写。');
    parts.push('- 只让上表里的角色登场；表外的人只能匿名泛称（如「路人」「一群人」），不要给它们取名或写外形细节。');
    parts.push('- 不要为了用满角色表让每个场景都出现角色；某个场景不需要角色就别写。');
    parts.push('- 分镜要写清角色在画面里的位置、动作和镜头关系（角色后面是照着分镜画的，写得越具体越画得出来）。');
  }

  const scenes = Array.isArray(payload.scenes) ? payload.scenes : [];
  const valid = scenes.filter((s) => s && (String(s.narration || '').trim() || String(s.visual || '').trim()));
  if (valid.length) {
    parts.push('【当前脚本】（当前版本；没被要求改的场景请逐字保留）');
    valid.forEach((s, i) => {
      parts.push('场景 ' + (i + 1) + '：');
      parts.push('- 旁白：' + String(s.narration || '').trim());
      parts.push('- 画面分镜：' + (String(s.visual || '').trim() || '（未填写）'));
      const dur = String(s.durHint || '').trim();
      if (dur) parts.push('- 时长提示：' + dur + ' 秒');
    });
  } else {
    parts.push('【当前脚本】（空：请从零写一版）');
  }

  const params: string[] = [];
  const count = Number(payload.sceneCount);
  params.push(isFinite(count) && count > 0
    ? '- 场景数：' + Math.round(count) + ' 个'
    : '- 场景数：未指定，按 5–8 个写');
  const seconds = Number(payload.targetSeconds);
  if (isFinite(seconds) && seconds > 0) {
    const budget = Math.round(seconds * EST_CHARS_PER_SEC);
    params.push('- 目标总时长：' + Math.round(seconds) + ' 秒（中文口语约 ' + EST_CHARS_PER_SEC
      + ' 字/秒）→ 旁白总字数控制在约 ' + budget + ' 字以内');
  } else {
    params.push('- 目标总时长：未指定');
  }
  parts.push('【参数】');
  parts.push(...params);
  return parts.join('\n');
}

// 解析模型回复 → 场景数组（容错：去代码围栏、取首个 { 到末个 }、兼容裸数组）
// 解析失败会抛错，由调用方决定把原文回给用户（不静默吞）
export function parseScriptReply(text: string): Scene[] {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('模型没有返回内容');
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence && fence[1] && fence[1].trim() ? fence[1].trim() : raw;

  // 依次尝试三种切法，取第一个"形状能用"的（对象带 scenes / 或直接是数组）：
  //   ① 首个 { 到末个 }（模型前后带解释文字时用）② 首个 [ 到末个 ]（裸数组）③ 原文
  const candidates: string[] = [];
  const objStart = body.indexOf('{');
  const objEnd = body.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) candidates.push(body.slice(objStart, objEnd + 1));
  const arrStart = body.indexOf('[');
  const arrEnd = body.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(body.slice(arrStart, arrEnd + 1));
  candidates.push(body);

  let list: unknown[] | null = null;
  for (const candidate of candidates) {
    let data: unknown;
    try { data = JSON.parse(candidate); } catch (e) { continue; }
    if (Array.isArray(data)) { list = data; break; }
    if (data && typeof data === 'object' && Array.isArray((data as { scenes?: unknown }).scenes)) {
      list = (data as { scenes: unknown[] }).scenes;
      break;
    }
  }
  if (!list) throw new Error('模型返回的不是可解析的脚本 JSON');

  const now = Date.now().toString(36);
  const out: Scene[] = [];
  for (const item of list) {
    if (out.length >= MAX_SCENES) break;
    const o = (item && typeof item === 'object' && !Array.isArray(item)) ? item as Record<string, unknown> : null;
    if (!o) continue;
    const narration = typeof o.narration === 'string' ? o.narration.trim() : '';
    const visual = typeof o.visual === 'string' ? o.visual.trim() : '';
    // **旁白允许为空**：那样的场景是静音段（该场没有配音，成片里纯画面播放）。只砍「旁白与画面分镜都空」的空壳。
    // 早先要求旁白非空，等于模型永远写不出静音段；而「只有旁白、画面分镜还空着」的场景也不能在这里被删
    // ——系统提示词第 7 条要求"没被要求改的场景逐字保留"，删掉就等于改稿吃掉了用户写的内容。
    if (!narration && !visual) continue;
    // durHint 不进提示词的输出契约；模型若原样带回（修改场景时）就保留，否则留空——
    // 真实时长靠「字幕配音（逐句对齐）」量出来，这里不编造。
    const durRaw = o.durHint;
    const durHint = (durRaw === undefined || durRaw === null || durRaw === '') ? '' : String(durRaw).trim();
    out.push({
      id: 'scene-' + now + '-' + out.length + '-' + Math.random().toString(36).slice(2, 6),
      narration,
      visual,
      durHint
    });
  }
  // 两个字段都空的场景已被上面滤掉，走到这里还空 = 模型返回的场景全没有内容
  if (!out.length) throw new Error('模型返回的脚本里没有有效场景（旁白与画面分镜都为空）');
  return out;
}

// 五阶段进度 → 界面文案（与 projects/ 的 progressText 同一个口径，只是"生成 HTML"换成"生成脚本"）
function progressText(info: AgentProgressPayload): string {
  const stage = info && info.stage;
  return stage === 'connecting' ? '正在连接模型…'
    : stage === 'thinking' ? 'AI 正在推理中…（已思考 ' + (info.thinkChars || 0) + ' 字符）'
    : stage === 'writing' ? 'AI 正在生成脚本…（已输出 ' + (info.contentChars || 0) + ' 字符）'
    : stage === 'retry' ? '本次输出为空，正在升档重试…'
    : stage === 'done' ? '模型输出完成，正在解析脚本…'
    : '';
}

// ===== 对话记录（projects/<项目名>/chat/：index.json + versions/<id>.json）=====
// 文件读写与规范化在 ./chatLog.ts；这里只记住「项目名 → 项目目录」的注入函数——
// 由 main/index.ts 传入 projects.projectDir（agent 不反向 import projects，避免与 projects → agent 成环）。
let projectDirOf: (name: string) => string = () => '';

function projectDir(name: string): string {
  return projectDirOf(name);
}

// 注册 IPC：script:generate / load-chat / append-round / read-version / set-active-version / clear-chat
//          + script:progress（send，单订阅由 preload 保证）
// getProjectDir：项目名 → 项目目录（main/index.ts 传 projects.projectDir）
export function registerScript(getProjectDir: (name: string) => string): void {
  projectDirOf = typeof getProjectDir === 'function' ? getProjectDir : () => '';
  ipcMain.handle(IPC.Script.Generate, async (event, payload?: ScriptGeneratePayload): Promise<ScriptGenerateReply> => {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    const request = payload && typeof payload.request === 'string' ? payload.request.trim() : '';
    if (!request) return { ok: false, message: '请先写下要求（例如：60 秒讲清什么是大模型幻觉）' };

    // 上下文只收"形状合法"的场景，并截到上限；主进程不读项目文件（内容以载荷为准）
    const scenes: Scene[] = (payload && Array.isArray(payload.scenes) ? payload.scenes : [])
      .filter((s) => s && typeof s === 'object')
      .slice(0, MAX_SCENES)
      .map((s) => ({
        id: String(s.id || ''),
        narration: String(s.narration || ''),
        visual: String(s.visual || ''),
        durHint: (s.durHint === undefined || s.durHint === null) ? '' : String(s.durHint)
      }));

    // 角色上下文：只收形状合法的（名字非空），上限 MAX_CAST，描述截 300 字（一条超长描述会挤爆提示词）。
    // 与 scenes 一样**只认载荷**：主进程不读项目的 cast/、不读全局角色库——用户选了什么就是什么。
    const cast: ScriptCastRef[] = (payload && Array.isArray(payload.cast) ? payload.cast : [])
      .filter((m) => m && typeof m.name === 'string' && m.name.trim())
      .slice(0, MAX_CAST)
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id.trim() : '',
        name: m.name.trim(),
        desc: typeof m.desc === 'string' ? m.desc.trim().slice(0, 300) : '',
        units: (typeof m.units === 'number' && isFinite(m.units) && m.units > 0) ? m.units : 8
      }));

    const userPrompt = buildScriptPrompt({
      name,
      request,
      scenes,
      sceneCount: payload && payload.sceneCount,
      targetSeconds: payload && payload.targetSeconds,
      cast
    });

    const sender = event.sender;
    const onProgress = (info: AgentProgressPayload) => {
      const text = progressText(info);
      if (!text || !sender || sender.isDestroyed()) return;
      const data: ScriptProgressPayload = Object.assign({}, info, { text });
      sender.send(IPC.Script.Progress, data);
    };

    let reply = '';
    try {
      reply = await chatWithModel(
        [
          { role: 'system', content: SCRIPT_AGENT_SYSTEM },
          { role: 'user', content: userPrompt }
        ],
        {
          label: '生成脚本',
          noun: '脚本',
          logFile: 'script-agent/chat.jsonl',
          // 脚本是一整份 JSON：被 max_tokens 截断时通常连右括号都没有，按结尾 } 粗判即可
          isComplete: (c) => /\}\s*$/.test(String(c || '').trim()),
          truncatedHint: '请减少场景数或缩短目标时长，或更换模型',
          meta: { project: name, action: scenes.length ? 'modify' : 'generate' },
          onProgress
        }
      );
    } catch (e) {
      // chatWithModel 抛出的已是人话文案；这里补一次分类，把「配置类」标记带给界面（弹「去设置」）
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }

    try {
      const parsed = parseScriptReply(reply);
      const totalChars = parsed.reduce((n, s) => n + s.narration.length, 0);
      return { ok: true, scenes: parsed, totalChars };
    } catch (e) {
      // 解析失败：把模型原文一并回给界面（截断到 2 万字符），用户能自己看出模型跑偏在哪
      const msg = '脚本解析失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, raw: reply.slice(0, 20000) };
    }
  });

  // 读索引（不含 scenes）：没有记录就是空（首次进入 / 老项目都走这条，无需迁移）
  ipcMain.handle(IPC.Script.LoadChat, (_event, payload?: { name?: string }): IpcResult<ScriptChatIndex> => {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    const index = readChatIndex(projectDir(name));
    return { ok: true, rounds: index.rounds, activeVersionId: index.activeVersionId };
  });

  // 追加一轮：先写版本副本，再更新索引（顺序不能反——索引会顺带清理"不再被引用"的旧副本）
  ipcMain.handle(IPC.Script.AppendRound, (_event, payload?: ScriptAppendRoundPayload): IpcResult<{ versionId: string }> => {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    const scenes = normalizeScenes(payload && payload.scenes);
    if (!scenes.length) return { ok: false, message: '这一轮没有场景，未写入对话记录' };
    const dir = projectDir(name);
    const round = (payload && payload.round && typeof payload.round === 'object') ? payload.round : { id: '', request: '', totalChars: 0, ts: 0 };
    const versionId = newVersionId();
    try {
      writeVersion(dir, versionId, scenes);
      const index = readChatIndex(dir);
      const meta: ScriptChatRoundMeta = {
        id: (typeof round.id === 'string' && round.id) ? round.id : 'round-' + Date.now().toString(36),
        request: typeof round.request === 'string' ? round.request : '',
        versionId,
        totalChars: (typeof round.totalChars === 'number' && isFinite(round.totalChars) && round.totalChars >= 0)
          ? Math.round(round.totalChars)
          : scenes.reduce((n, s) => n + s.narration.length, 0),
        sceneCount: scenes.length,
        ts: (typeof round.ts === 'number' && isFinite(round.ts)) ? round.ts : Date.now()
      };
      writeChatIndex(dir, { rounds: [...index.rounds, meta], activeVersionId: versionId });
      return { ok: true, versionId };
    } catch (e) {
      return { ok: false, message: '保存对话记录失败：' + (((e as Error) && (e as Error).message) || String(e)) };
    }
  });

  // 读某一版（展开预览用，无副作用）
  ipcMain.handle(IPC.Script.ReadVersion, (_event, payload?: { name?: string; versionId?: string }): IpcResult<ScriptVersionResult> => {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    const versionId = payload && payload.versionId;
    if (!isValidVersionId(versionId)) return { ok: false, message: '非法的版本 id' };
    const scenes = readVersion(projectDir(name), versionId);
    if (!scenes) return { ok: false, message: '这一版脚本读不到了（副本可能已被删除）' };
    return { ok: true, scenes };
  });

  // 把某一版设为「当前应用」（应用旧版时调用；不写 content.json，内容的落盘仍走 project:save-content）
  ipcMain.handle(IPC.Script.SetActiveVersion, (_event, payload?: { name?: string; versionId?: string }): IpcResult => {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    const versionId = payload && payload.versionId;
    if (!isValidVersionId(versionId)) return { ok: false, message: '非法的版本 id' };
    try {
      const dir = projectDir(name);
      const index = readChatIndex(dir);
      if (!index.rounds.some((r) => r.versionId === versionId)) return { ok: false, message: '这一版不在对话记录里' };
      writeChatIndex(dir, { rounds: index.rounds, activeVersionId: versionId });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: '更新对话记录失败：' + (((e as Error) && (e as Error).message) || String(e)) };
    }
  });

  // 清空：删索引与全部版本副本（不动 content.json / 编辑器里的场景）
  ipcMain.handle(IPC.Script.ClearChat, (_event, payload?: { name?: string }): IpcResult => {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    clearChat(projectDir(name));
    return { ok: true };
  });
}
