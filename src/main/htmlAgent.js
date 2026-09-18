// src/main/htmlAgent.js
// HTML 生成/修改：自定义模型 Agent 实现（生成/修改共用）
// 提供：HTML_AGENT_SYSTEM / extractHtmlFromReply / chatWithCustomModel
// 依赖：settings(settings.getCustomModel / settings.requireOpenAI)
const settings = require('./settings.js');

const HTML_AGENT_SYSTEM = [
  '你是专业的 HTML 动画创作者，为桌面创作应用输出完整、独立、可运行的 HTML 单页。',
  '必须遵守以下硬性要求：',
  '1. 直接输出一个完整 HTML 文档（以 <!DOCTYPE html> 开头），包含 <head> 与 <body>。',
  '2. 必须满足 HyperFrames composition 规范（用于后续转视频）：',
  '   - 动画根容器元素带 data-composition-id 属性（如 <div data-composition-id="comp-demo">）；',
  '   - 通过 <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script> 引入 GSAP；',
  '   - 所有时间轴声明进 window.__timelines 数组（例：const tl = gsap.timeline(); /* ... */; window.__timelines = [tl];），保证源码同时出现 __timelines 与 gsap 字样。',
  '3. 视觉风格：深空科技 / Cyber UI（深色背景 #0B1220、电子蓝 #00D4FF 辉光、玻璃拟态、霓虹渐变）。',
  '4. 若用户提供了字幕，按字幕条目逐条依次播放入场动画。',
  '5. 不得输出任何解释文字、Markdown 注释或代码块围栏，只输出 HTML 源码。'
].join('\n');

// 从模型回复中提取 HTML（兼容 Markdown 代码块包裹的情况）
function extractHtmlFromReply(text) {
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

// 调用自定义模型（OpenAI 兼容协议），流式接收并通过 opts.onProgress 上报阶段
// onProgress({ stage:'connecting'|'thinking'|'writing'|'retry'|'done', thinkChars, contentChars })
// content 为空且 finish_reason=length 时自动升档重试；升档后仍无内容则抛出带 usage 的诊断错误
async function chatWithCustomModel(userPrompt, opts) {
  const m = settings.getCustomModel();
  if (!m.enabled) throw new Error('自定义模型未启用：请先到「设置」开启并配置 Base URL / Model ID / API Key');
  if (!m.baseUrl || !m.modelId || !m.apiKey) throw new Error('自定义模型配置不完整：Base URL / Model ID / API Key 均需填写');
  const messages = [
    { role: 'system', content: HTML_AGENT_SYSTEM },
    { role: 'user', content: userPrompt }
  ];
  const tries = (opts && opts.maxTokenTries) || MAX_TOKEN_TRIES;
  const onProgress = (opts && opts.onProgress) || null;
  let finishReason = '';
  let usage = null;
  for (const maxTokens of tries) {
    let content = '';
    let thinkText = '';
    let lastStage = '';
    let lastEmitAt = 0;
    const emit = (stage, force) => {
      const now = Date.now();
      if (!force && now - lastEmitAt < 300) return;
      lastEmitAt = now;
      if (onProgress) {
        onProgress({ stage, thinkChars: thinkText.length, contentChars: content.length, thinkText: thinkText.slice(-20000) });
      }
    };
    try {
      const OpenAI = settings.requireOpenAI();
      if (OpenAI) {
        const client = new OpenAI({ apiKey: m.apiKey, baseURL: m.baseUrl });
        const stream = await client.chat.completions.create({
          model: m.modelId, messages, max_tokens: maxTokens, stream: true
        });
        for await (const chunk of stream) {
          if (chunk && chunk.usage) usage = chunk.usage;
          const ch = chunk && chunk.choices && chunk.choices[0];
          if (ch && ch.finish_reason) finishReason = ch.finish_reason;
          const d = (ch && ch.delta) || {};
          if (d.reasoning_content) {
            thinkText += String(d.reasoning_content);
            if (lastStage !== 'thinking') { lastStage = 'thinking'; emit('thinking', true); }
            else emit('thinking');
          }
          if (d.content) {
            content += d.content;
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
          body: JSON.stringify({ model: m.modelId, messages, max_tokens: maxTokens, stream: true })
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error('HTTP ' + resp.status + '：' + JSON.stringify(errData));
        }
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
            let chunk;
            try { chunk = JSON.parse(payload); } catch (e) { continue; }
            if (chunk && chunk.usage) usage = chunk.usage;
            const ch = chunk.choices && chunk.choices[0];
            if (ch && ch.finish_reason) finishReason = ch.finish_reason;
            const d = (ch && ch.delta) || {};
            if (d.reasoning_content) {
              thinkText += String(d.reasoning_content);
              if (lastStage !== 'thinking') { lastStage = 'thinking'; emit('thinking', true); }
              else emit('thinking');
            }
            if (d.content) {
              content += d.content;
              if (lastStage !== 'writing') { lastStage = 'writing'; emit('writing', true); }
              else emit('writing');
            }
          }
        }
      }
    } catch (e) {
      throw new Error(String(e && e.message ? e.message : e));
    }
    if (content.trim()) {
      emit('done', true);
      return content;
    }
    // content 为空：若因 max_tokens 截断（配额耗在 reasoning）则升档重试，否则也再试一档兜底
    if (finishReason === 'length') {
      emit('retry', true);
      continue;
    }
    break;
  }
  const usageInfo = usage ? '（usage: ' + JSON.stringify(usage) + '）' : '';
  throw new Error(
    '模型未返回内容' +
      (finishReason === 'length'
        ? '：max_tokens 已用完但未产出 HTML，可能是推理模型将配额耗在思考阶段，已自动升档重试仍失败' + usageInfo
        : '：模型响应为空' + usageInfo)
  );
}

module.exports = {
  HTML_AGENT_SYSTEM,
  extractHtmlFromReply,
  chatWithCustomModel
};
