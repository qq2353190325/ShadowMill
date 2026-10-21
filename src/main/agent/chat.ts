// src/main/agent/chat.ts
// 通用 AI 对话层：多轮消息 + 流式输出 + max_tokens 升档重试 + 过程记录。
// 调用方：agent/html.ts（生成/修改 HTML）、agent/script.ts（生成/修改内容脚本）。
// 本模块**不认识任何业务**——系统提示词、完成判定、日志文件、错误文案都由调用方传入，
// 所以以后再加"对话式操作"只需再写一个薄封装。
//
// 依赖：../settings（模型配置 + openai 懒加载）/ ../../shared/errors（英文报错转人话）。
// 不依赖任何项目模块：本层只负责"问模型、收流、重试、记日志"，不读写项目文件。
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getCustomModel, loadOpenAI } from '../settings'
import { friendlyError } from '../../shared/errors'
import type { AgentProgressPayload, ConfigTarget } from '../../shared/types'

// 一条对话消息（OpenAI 兼容协议）。多轮场景由调用方按顺序排好（system 在最前）。
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AgentChatOptions {
  // friendlyError 的文案前缀，如「生成 HTML」「生成脚本」
  label: string
  // 失败文案里的名词，如 'HTML'、'脚本'
  noun: string
  // 过程记录文件（相对 userData），如 'html-agent/chat.jsonl'
  logFile: string
  // 仅在 finish_reason === 'length'（被 max_tokens 截断）时用于判定"其实是否完整"。
  // 不传 = 有内容也算不完整（走升档重试）。
  isComplete?: (content: string) => boolean
  // 截断时给用户的下一步建议（拼进错误文案）
  truncatedHint?: string
  meta?: { project?: string; action?: string }
  maxTokenTries?: number[]
  onProgress?: (p: AgentProgressPayload) => void
}

// 生成类任务 max_tokens 升档序列：推理模型可能把配额全耗在 reasoning 导致 content 为空，
// 8192/16384 实测会被 thinking 阶段耗尽（reasoning_tokens=16384 仍无输出），故直接 32768 起步
const MAX_TOKEN_TRIES = [32768, 65536];

// 对话记录落盘：每次调用追加一行 jsonl，含完整会话与全过程记录——
//   messages：完整输入（system + 多轮 user/assistant）；attempts：每档 max_tokens 尝试的完整思考原文
//   （reasoning_content 全文）、完整输出、finish_reason、usage 与各阶段耗时（首 token / 思考 / 输出）。
// 记录失败静默忽略，不影响主流程。
function logConversation(logFile: string, entry: Record<string, unknown>): void {
  try {
    const full = path.join(app.getPath('userData'), logFile);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { /* ignore */ }
}

// 调用自定义模型（OpenAI 兼容协议），流式接收并通过 opts.onProgress 上报阶段。
// content 为空 / 被 max_tokens 截断时自动升档重试；全部档位失败则抛出人话错误。
// 成功时返回模型正文（调用方自己提取 / 解析），思考内容只进日志与进度，绝不混进返回值。
async function chatWithModel(messages: ChatMessage[], opts: AgentChatOptions): Promise<string> {
  const m = getCustomModel();
  // 配置类失败统一走 friendlyError（人话文案 + 排障详情；配置类还带 needConfig，界面据此弹「去设置」）
  const cfgErr = (raw: string, hint?: string): never => {
    const f = friendlyError(new Error(raw), { label: opts.label, baseUrl: m.baseUrl, hint });
    throw new Error(f.message);
  };
  if (!m.enabled) cfgErr('自定义模型未启用', 'model-not-enabled');
  if (!m.baseUrl || !m.modelId || !m.apiKey) cfgErr('自定义模型配置不完整：Base URL / Model ID / API Key 均需填写');

  const meta = opts.meta || {};
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

  const tries = opts.maxTokenTries || MAX_TOKEN_TRIES;
  const onProgress = opts.onProgress || null;
  const isComplete = opts.isComplete || null;

  for (const maxTokens of tries) {
    let content = '';
    let thinkText = '';
    let finishReason = '';
    let usage: unknown = null;
    let attemptErr: string | null = null;
    // 本次尝试的失败分类（needConfig 非空 = 配置类，界面弹「去设置」）
    let attemptCfg: { needConfig: ConfigTarget } | null = null;
    // 失败时的排障详情（原始报文首行 + 请求地址），只进日志与对话记录，不进用户文案
    let attemptDetail = '';
    // 非 2xx 时的响应体（排障详情），只进详情不进用户文案
    let httpDetail = '';
    // 本次实际请求的地址：排障详情里带上它，403 / 404 才看得出「到底在请求哪个地址」
    const apiUrl = String(m.baseUrl).replace(/\/+$/, '') + '/chat/completions';
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
    const emit = (stage: AgentProgressPayload['stage'], force?: boolean) => {
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
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiKey },
          body: JSON.stringify({ model: m.modelId, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } })
        });
        if (!resp.ok) {
          // 非 2xx：把响应体留作排障详情（解析不出 JSON 时保留前 300 字符原文）
          httpDetail = 'HTTP ' + resp.status + ' ' + (await resp.text().catch(() => '')).slice(0, 300);
          throw new Error(httpDetail);
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
      // 原始报错一律先翻译成人话：message 给用户、detail 给排障、needConfig 决定界面是否弹「去设置」
      const f = friendlyError(e, {
        label: opts.label,
        baseUrl: m.baseUrl,
        extras: [apiUrl ? '请求地址：' + apiUrl : '', httpDetail]
      });
      attemptErr = f.message;
      attemptCfg = f.needConfig ? { needConfig: f.needConfig } : null;
      attemptDetail = f.detail || '';
    }
    attempts.push({
      maxTokens,
      startTs: new Date(reqStart).toISOString(),
      thinkText,          // 完整思考原文（reasoning_content 全文，供分析推理质量）
      thinkChars: thinkText.length,
      content,            // 本次尝试完整输出（成功时即最终正文）
      contentChars: content.length,
      finishReason,
      usage: usage || null,
      error: attemptErr,
      detail: attemptDetail || undefined,  // 排障详情（原始报文首行 + 请求地址）
      needConfig: attemptCfg,              // 配置类标记（非配置类为 null）
      timing: {
        totalMs: Date.now() - reqStart,
        firstTokenMs: firstTokenAt ? firstTokenAt - reqStart : null, // 首 token 等待时长
        thinkMs: firstThinkAt ? ((firstWriteAt || Date.now()) - firstThinkAt) : 0, // 纯思考时长
        writeMs: firstWriteAt ? Date.now() - firstWriteAt : 0 // 输出时长
      }
    });
    if (attemptErr) {
      logConversation(opts.logFile, logEntry({ ok: false, reply: '', error: attemptErr, detail: attemptDetail }));
      throw new Error(attemptErr);
    }
    // content 非空但被 max_tokens 截断（finishReason=length 且调用方判定"不完整"）
    // → 升档重试，避免把残缺内容交给调用方（残缺 HTML / 残缺 JSON 都是坏结果）
    const truncated = finishReason === 'length' && !!content.trim() && !(isComplete ? isComplete(content) : false);
    if (truncated) {
      emit('retry', true);
      continue;
    }
    if (content.trim()) {
      emit('done', true);
      logConversation(opts.logFile, logEntry({ ok: true, reply: content, error: null }));
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
  const lastFinish = last ? String(last.finishReason || '') : '';
  const lastContent = last ? String(last.content || '').trim() : '';
  const truncatedOut = lastFinish === 'length' && !!lastContent && !(isComplete ? isComplete(lastContent) : false);
  const usageInfo = last && last.usage ? '（usage: ' + JSON.stringify(last.usage) + '）' : '';
  const errMsg = truncatedOut
    ? opts.noun + ' 被 max_tokens 截断：全部配额档位均用完仍不完整' + (opts.truncatedHint ? '，' + opts.truncatedHint : '') + usageInfo
    : '模型未返回内容' +
      (lastFinish === 'length'
        ? '：max_tokens 已用完但未产出 ' + opts.noun + '，可能是推理模型将配额耗在思考阶段，已自动升档重试仍失败' + usageInfo
        : '：模型响应为空' + usageInfo);
  logConversation(opts.logFile, logEntry({ ok: false, reply: '', error: errMsg }));
  throw new Error(errMsg);
}

export { MAX_TOKEN_TRIES, chatWithModel };
