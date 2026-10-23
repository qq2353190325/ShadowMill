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
  ScriptChatIndex,
  ScriptChatRoundMeta,
  ScriptGeneratePayload,
  ScriptGenerateReply,
  ScriptProgressPayload,
  ScriptVersionResult
} from '../../shared/types'

// 一次最多产出多少场景（防模型跑飞：把整部剧塞进一个数组）
const MAX_SCENES = 50;
// 语速口径来自 @shared/constants（与字幕估时、内容脚本页「估算时长」同一份），这里只用于把
// 「目标总时长」换算成提示词里的字数预算——别在本文件另写一个 4.5 / 4 之类的常数。

// 系统提示词：只约束"产出什么形状"，不涉及视觉/HTML（那是 ./html.ts 的事）
export const SCRIPT_AGENT_SYSTEM = [
  '你是短视频 / 解说类内容的脚本作者，为桌面创作应用输出可直接配音的分镜脚本。',
  '必须遵守以下硬性要求：',
  '1. 只输出一个 JSON 对象，形如 {"scenes":[{"narration":"…","visual":"…"}]}；不要 Markdown 代码块、不要任何解释文字。',
  '2. 每个场景的 narration 是该场景的旁白 / 配音稿：口语、可直接朗读；不要写序号、小标题、括号说明、emoji，也不要写"（停顿）"这类舞台提示。',
  // 第 3 条为什么要求「一行一个镜头、行首带时长」：visual 是「HTML生成」页生成 / 修改时的画面依据
  // （projects.ts 的 buildContentBlock 把它原样拼进【内容脚本】块）。写成一大段时，模型只能自己猜
  // 「该拆几个画面、每个占多久」；按行拆开、行首给时长，画面节奏才是用户能指定的。
  // 注意：这里只规定「怎么写」，主进程**不做任何解析**——多行文本原样进提示词，由模型按行读。
  '3. 每个场景的 visual 是该场景的画面分镜，后面要照着它做页面与动画，所以必须写具体、能照着画出来：',
  '   - **一行写一个镜头**，一个场景写 2–5 行，不要写成一大段。行首必须带该镜头的时长，写法是「2.5s 」再接描述，例如「2.5s 标题缩小上移，中央浮出三个发光圆环」。',
  '   - 各镜头时长之和要等于该场景的时长提示（没给时长提示就按旁白语速约 ' + EST_CHARS_PER_SEC + ' 字/秒估算），不要明显超时。',
  '   - 每个镜头都要交代四件事：① 画面里有什么（主体、背景、版面构成、元素之间的位置关系）；② 这个镜头怎么动（哪个元素从哪出现、往哪动、怎么消失）；③ 画面上要出现的关键文字或数字（直接写出原话，如标题、关键词、数据）；④ 氛围与衔接（色调、光线、镜头感，以及和上一个镜头怎么接）。',
  '   - 只描述画面上看得见的东西：不要写 HTML、CSS、JS、GSAP 或动画参数，不要写具体像素、坐标或帧数。',
  '4. 场景之间按时间顺序衔接，整体围绕同一个主题；不要重复同一句话，也不要把同一个意思拆成两个场景。',
  '5. 用户给了场景数就按它写；没给就写 5–8 个场景。',
  '6. 用户给了目标总时长就控制旁白总字数（中文口语约 ' + EST_CHARS_PER_SEC + ' 字/秒），不要明显超时。',
  '7. 【当前脚本】非空时，它是当前版本：只按【要求】改它，**没被要求改的场景必须逐字保留**（旁白与画面都不要动），不要自行重写全文、合并或调换顺序。',
  '8. 只写脚本，不要输出片名、封面文案、BGM 建议、拍摄建议等额外内容。',
  '9. 输出形状参考（下面这段只是**两场景的格式示例**，主题与你无关，照这个形状写、不要照抄内容，也不要照抄它的场景数）：',
  '{"scenes":[{"narration":"你有没有想过，同样一句话，为什么有的回答听起来那么像真的？","visual":"2.0s 深空蓝黑的背景，画面中央先浮出一个由细线描出的问号，线条带一层青色微光。\\n2.5s 问号向四周散成几十个细小光点，光点缓慢向右上方飘出画面。\\n2.0s 左下角淡入一行小字「听起来像真的」，几秒后被一个白色方框圈住；整场偏冷调，底部有缓慢流动的星尘。"},{"narration":"因为模型更擅长把话补完整，而不是先把事实核对一遍。","visual":"2.0s 画面从上一场的星尘切到一张半透明的信息卡，卡片从右侧滑入、停在画面中央偏左。\\n2.5s 卡片上的一句话被逐字打出来，其中关键词「补完整」先变成青色，再放大到两倍并罩上一层光晕。\\n2.0s 卡片右侧同时浮出三条浅灰色细线，代表被略过的核对步骤，闪一下后暗下去；镜头不动，只留卡片边缘一层呼吸感的微光。"}]}',
  '10. 允许静音场景：需要纯画面、不放配音的场景，把该场 narration 留空字符串（""），visual 照常写清楚——不要为了凑旁白硬写话。每个场景（包括静音场景）的 visual 都必须写，并按第 3 条一行一个镜头写清楚（2–5 行，每行行首带时长），不能留空、不能只写一行。',
  '11. 错误示例（都会被判为不合格）：用 Markdown 代码块（三反引号）包裹；在 JSON 前后写"好的，这是脚本："之类的解释；额外输出 title、duration、bgm 等字段；把 narration 写成要点列表；把 visual 写成一大段而不是分行、或让某一行只写「深色背景 + 标题浮入」这类骨架子、或行首不带时长（后面做不出这一场的画面节奏）。'
].join('\n');

// 构造用户提示：要求 + 当前脚本 + 参数（场景数 / 目标总时长换算的字数预算）
export function buildScriptPrompt(payload: ScriptGeneratePayload): string {
  const parts: string[] = [];
  parts.push('【要求】' + String(payload.request || '').trim());

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

// 五阶段进度 → 界面文案（与 projects.ts 的 progressText 同一个口径，只是"生成 HTML"换成"生成脚本"）
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

    const userPrompt = buildScriptPrompt({
      name,
      request,
      scenes,
      sceneCount: payload && payload.sceneCount,
      targetSeconds: payload && payload.targetSeconds
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
