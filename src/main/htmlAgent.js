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

// 调用自定义模型（OpenAI 兼容协议），返回模型回复文本
async function chatWithCustomModel(userPrompt) {
  const m = settings.getCustomModel();
  if (!m.enabled) throw new Error('自定义模型未启用：请先到「设置」开启并配置 Base URL / Model ID / API Key');
  if (!m.baseUrl || !m.modelId || !m.apiKey) throw new Error('自定义模型配置不完整：Base URL / Model ID / API Key 均需填写');
  const messages = [
    { role: 'system', content: HTML_AGENT_SYSTEM },
    { role: 'user', content: userPrompt }
  ];
  try {
    const OpenAI = settings.requireOpenAI();
    if (OpenAI) {
      const client = new OpenAI({ apiKey: m.apiKey, baseURL: m.baseUrl });
      const resp = await client.chat.completions.create({ model: m.modelId, messages, max_tokens: 8192 });
      return (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
    }
    const url = String(m.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiKey },
      body: JSON.stringify({ model: m.modelId, messages, max_tokens: 8192 })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error('HTTP ' + resp.status + '：' + JSON.stringify(data));
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } catch (e) {
    throw new Error(String(e && e.message ? e.message : e));
  }
}

module.exports = {
  HTML_AGENT_SYSTEM,
  extractHtmlFromReply,
  chatWithCustomModel
};
