// src/main/htmlAgent.ts
// HTML 生成/修改：自定义模型 Agent 实现（生成/修改共用）
// 提供：HTML_AGENT_SYSTEM / extractHtmlFromReply / chatWithCustomModel
// 依赖：settings(settings.getCustomModel / settings.loadOpenAI)
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getCustomModel, loadOpenAI } from './settings'
import type { HtmlAgentProgress } from '../shared/types'

const HTML_AGENT_SYSTEM = [
  '你是专业的 HTML 动画创作者，为桌面创作应用输出完整、独立、可运行的 HTML 单页。',
  '必须遵守以下硬性要求：',
  '1. 直接输出一个完整 HTML 文档（以 <!DOCTYPE html> 开头），包含 <head> 与 <body>。',
  '2. 必须满足 HyperFrames composition 规范（用于后续转视频）：',
  '   - 动画根容器元素带 data-composition-id 属性（如 <div data-composition-id="main">），并记住这个 id；',
  '   - 用 <script src="./gsap.min.js"></script> 引入 GSAP（该文件由应用随项目提供，禁止改用任何 CDN 地址）；',
  '   - 时间轴一律用 gsap.timeline({ paused: true }) 创建（起播由渲染器与预览控制负责，不要自动播放）；',
  '   - 时间轴登记到「以 composition id 为键的对象」上，而不是数组：',
  '     window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;（键必须与 data-composition-id 完全一致）',
  '3. 视觉风格：深空科技 / Cyber UI（深色背景 #0B1220、电子蓝 #00D4FF 辉光、玻璃拟态、霓虹渐变）。',
  '4. 若用户提供了字幕，按字幕条目逐条依次播放入场动画。',
  '5. 字幕时间轴必须严格按提供的起止时间执行：每条字幕在其开始时间出现、结束时间前完成淡出，禁止把上一条字幕显示到下一条开始；时间为秒、可带小数（毫秒精度），GSAP 时间轴直接按这些小数秒定位，不要四舍五入或自行重排；无结束时间的行自行按语义安排节奏。',
  '6. 不得输出任何解释文字、Markdown 注释或代码块围栏，只输出 HTML 源码。'
].join('\n');

// 从模型回复中提取 HTML（兼容 Markdown 代码块包裹的情况）
function extractHtmlFromReply(text: string): string {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] && fence[1].trim()) return fence[1].trim();
  const start = t.search(/<!DOCTYPE html|<html/i);
  if (start >= 0) return t.slice(start).trim();
  return t;
}

// 生成类任务 max_tokens 升档序列：推理模型可能把配额全耗在 reasoning 导致 content 为空，
// 8192/16384 实测会被 thinking 阶段耗尽（reasoning_tokens=16384 仍无输出），故直接 32768 起步
const MAX_TOKEN_TRIES = [32768, 65536];

// 对话记录落盘：每次生成/修改写一行 jsonl，含完整会话与全过程记录——
//   messages：system + user 完整输入；attempts：每档 max_tokens 尝试的完整思考原文（reasoning_content 全文）、
//   完整输出、finish_reason、usage 与各阶段耗时（首 token / 思考 / 输出），供事后分析每次生成的优化空间。
// 路径：userData/html-agent/chat.jsonl（记录失败静默忽略，不影响主流程）
function logConversation(entry: Record<string, unknown>): void {
  try {
    const dir = path.join(app.getPath('userData'), 'html-agent');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'chat.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { /* ignore */ }
}

// 进度载荷类型统一取自 shared/types.ts 的 HtmlAgentProgress（⑧ 节）
export type AgentProgress = HtmlAgentProgress

export interface AgentOpts {
  meta?: { project?: string; action?: string }
  maxTokenTries?: number[]
  onProgress?: (p: AgentProgress) => void
}

// 调用自定义模型（OpenAI 兼容协议），流式接收并通过 opts.onProgress 上报阶段
// content 为空且 finish_reason=length 时自动升档重试；升档后仍无内容则抛出带 usage 的诊断错误
async function chatWithCustomModel(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const m = getCustomModel();
  if (!m.enabled) throw new Error('自定义模型未启用：请先到「设置」开启并配置 Base URL / Model ID / API Key');
  if (!m.baseUrl || !m.modelId || !m.apiKey) throw new Error('自定义模型配置不完整：Base URL / Model ID / API Key 均需填写');
  const meta = (opts && opts.meta) || {};
  const messages: any[] = [
    { role: 'system', content: HTML_AGENT_SYSTEM },
    { role: 'user', content: userPrompt }
  ];
  const attempts: Record<string, unknown>[] = []; // 每档 max_tokens 尝试的完整记录，随流式过程逐次填充
  const logEntry = (extra: Record<string, unknown>) => Object.assign({
    ts: new Date().toISOString(),
    project: meta.project || '',
    action: meta.action || '',
    model: m.modelId,
    baseUrl: m.baseUrl,
    messages,
    attempts
  }, extra);
  const tries = (opts && opts.maxTokenTries) || MAX_TOKEN_TRIES;
  const onProgress = (opts && opts.onProgress) || null;
  for (const maxTokens of tries) {
    let content = '';
    let thinkText = '';
    let finishReason = '';
    let usage: unknown = null;
    let attemptErr: string | null = null;
    let lastStage = '';
    let lastEmitAt = 0;
    const reqStart = Date.now();
    let firstTokenAt = 0;
    let firstThinkAt = 0;
    let firstWriteAt = 0;
    // 记录首 token / 首思考 / 首输出时间点，供阶段耗时分析
    const noteToken = (kind: string) => {
      const now = Date.now();
      if (!firstTokenAt) firstTokenAt = now;
      if (kind === 'think' && !firstThinkAt) firstThinkAt = now;
      if (kind === 'write' && !firstWriteAt) firstWriteAt = now;
    };
    const emit = (stage: AgentProgress['stage'], force?: boolean) => {
      const now = Date.now();
      if (!force && now - lastEmitAt < 300) return;
      lastEmitAt = now;
      if (onProgress) {
        onProgress({ stage, thinkChars: thinkText.length, contentChars: content.length, thinkText: thinkText.slice(-20000) });
      }
    };
    try {
      const OpenAI = loadOpenAI();
      if (OpenAI) {
        const client = new OpenAI({ apiKey: m.apiKey, baseURL: m.baseUrl });
        const stream = await client.chat.completions.create({
          model: m.modelId, messages, max_tokens: maxTokens, stream: true,
          stream_options: { include_usage: true } // 末块回传 usage（prompt/completion/reasoning tokens），供分析
        });
        for await (const chunk of stream as AsyncIterable<any>) {
          if (chunk && chunk.usage) usage = chunk.usage;
          const ch = chunk && chunk.choices && chunk.choices[0];
          if (ch && ch.finish_reason) finishReason = ch.finish_reason;
          const d = (ch && ch.delta) || {};
          if (d.reasoning_content) {
            thinkText += String(d.reasoning_content);
            noteToken('think');
            if (lastStage !== 'thinking') { lastStage = 'thinking'; emit('thinking', true); }
            else emit('thinking');
          }
          if (d.content) {
            content += d.content;
            noteToken('write');
            if (lastStage !== 'writing') { lastStage = 'writing'; emit('writing', true); }
            else emit('writing');
          }
        }
      } else {
        // 兜底 fetch：SSE 流式解析
        const url = String(m.baseUrl).replace(/\/+$/, '') + '/chat/completions';
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiKey },
          body: JSON.stringify({ model: m.modelId, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } })
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error('HTTP ' + resp.status + '：' + JSON.stringify(errData));
        }
        if (!resp.body) throw new Error('HTTP 响应无 body');
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let chunk: any;
            try { chunk = JSON.parse(payload); } catch (e) { continue; }
            if (chunk && chunk.usage) usage = chunk.usage;
            const ch = chunk.choices && chunk.choices[0];
            if (ch && ch.finish_reason) finishReason = ch.finish_reason;
            const d = (ch && ch.delta) || {};
            if (d.reasoning_content) {
              thinkText += String(d.reasoning_content);
              noteToken('think');
              if (lastStage !== 'thinking') { lastStage = 'thinking'; emit('thinking', true); }
              else emit('thinking');
            }
            if (d.content) {
              content += d.content;
              noteToken('write');
              if (lastStage !== 'writing') { lastStage = 'writing'; emit('writing', true); }
              else emit('writing');
            }
          }
        }
      }
    } catch (e) {
      attemptErr = String((e as Error) && (e as Error).message ? (e as Error).message : e);
    }
    attempts.push({
      maxTokens,
      startTs: new Date(reqStart).toISOString(),
      thinkText,          // 完整思考原文（reasoning_content 全文，供分析推理质量）
      thinkChars: thinkText.length,
      content,            // 本次尝试完整输出（成功时即最终 HTML 源码）
      contentChars: content.length,
      finishReason,
      usage: usage || null,
      error: attemptErr,
      timing: {
        totalMs: Date.now() - reqStart,
        firstTokenMs: firstTokenAt ? firstTokenAt - reqStart : null, // 首 token 等待时长
        thinkMs: firstThinkAt ? ((firstWriteAt || Date.now()) - firstThinkAt) : 0, // 纯思考时长
        writeMs: firstWriteAt ? Date.now() - firstWriteAt : 0 // 输出时长
      }
    });
    if (attemptErr) {
      logConversation(logEntry({ ok: false, reply: '', error: attemptErr }));
      throw new Error(attemptErr);
    }
    // content 非空但被 max_tokens 截断（finishReason=length 且结尾缺 </body>/</html>，HTML 明显不完整）
    // → 升档重试，避免把残缺 HTML 落盘（残缺脚本会导致预览缩放/时间轴全部失效）
    const truncated = finishReason === 'length' && !!content.trim() && !/<\/(body|html)\s*>\s*$/i.test(content.trim());
    if (truncated) {
      emit('retry', true);
      continue;
    }
    if (content.trim()) {
      emit('done', true);
      logConversation(logEntry({ ok: true, reply: content, error: null }));
      return content;
    }
    // content 为空：若因 max_tokens 截断（配额耗在 reasoning）则升档重试，否则也再试一档兜底
    if (finishReason === 'length') {
      emit('retry', true);
      continue;
    }
    break;
  }
  const last = attempts.length ? attempts[attempts.length - 1] : null;
  const lastFinish = last ? last.finishReason : '';
  const lastContent = last ? String(last.content || '').trim() : '';
  const truncatedHtml = lastFinish === 'length' && !!lastContent && !/<\/(body|html)\s*>\s*$/i.test(lastContent);
  const usageInfo = last && last.usage ? '（usage: ' + JSON.stringify(last.usage) + '）' : '';
  const errMsg = truncatedHtml
    ? 'HTML 被 max_tokens 截断：全部配额档位均用完仍不完整，请精简字幕/素材或更换模型' + usageInfo
    : '模型未返回内容' +
      (lastFinish === 'length'
        ? '：max_tokens 已用完但未产出 HTML，可能是推理模型将配额耗在思考阶段，已自动升档重试仍失败' + usageInfo
        : '：模型响应为空' + usageInfo);
  logConversation(logEntry({ ok: false, reply: '', error: errMsg }));
  throw new Error(errMsg);
}

export {
  HTML_AGENT_SYSTEM,
  extractHtmlFromReply,
  chatWithCustomModel
};
