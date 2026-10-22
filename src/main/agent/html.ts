// src/main/agent/html.ts
// HTML 生成/修改：本文件只剩「HTML 专用」的东西 —— 系统提示词与回复提取；
// 真正的传输层（多轮消息、流式输出、max_tokens 升档重试、过程记录）在 ./chat.ts。
// 提供：HTML_AGENT_SYSTEM / extractHtmlFromReply / chatWithCustomModel
// 依赖：./chat(chatWithModel)
import { chatWithModel } from './chat'
import type { AgentProgressPayload } from '../../shared/types'

// 系统提示词：只放「模型必须无条件满足」的结构契约（文档结构 / HyperFrames 规范 / 渲染技术 / 字幕时间轴 / 输出格式）。
// **这里不放任何视觉风格**：整支片子要多深多亮、什么配色，由用户在「HTML生成」页填的
// 「全局视觉风格」输入框决定（主进程的 buildStyleBlock 把它拼成用户消息里的块），也可写在同一页的「需求描述」里。
// 理由：本列表每一条都是硬性要求，这里一旦写死某种配色，用户的选择就会被压掉（想换浅色 / 别的风格都改不动）。
// 渲染技术那三条子项是**结构契约而不是风格**：HyperFrames 是按 GSAP 时间轴 seek 后截帧的，
// 逐帧绘制若不挂在时间轴上、或用了墙钟时间/随机数，seek 之后画面就不会重绘、成片会是静态或错帧（已实测）。
// three.js 是唯一允许走 CDN 的依赖（体积 663 KB，不进安装包）；GSAP 仍必须用随包的 ./gsap.min.js。
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
  '   - 画布（成片尺寸）以用户消息里【画布】给出的尺寸为准：在 <html> 上写死 data-resolution="landscape|portrait|square"，',
  '     并把主舞台容器做成该尺寸的固定 px 版式（不要用 vw / vh / 百分比自适应、不要 transform: scale 缩放舞台），内容排满整块画布；',
  '   - 画面默认用 DOM/CSS + GSAP 完成；只有确实需要逐帧绘制时才改用 canvas：2D 用 Canvas 2D，3D 用 three.js 并以 ESM 引入',
  '     （在 <head> 里先写 <script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.170.0/build/three.module.js"}}</script>，',
  '     再用 <script type="module">import * as THREE from "three"</script>；three 只允许用这一个 CDN 地址，GSAP 仍必须用本地 ./gsap.min.js、不得改成 CDN）；',
  '   - 逐帧绘制必须由 GSAP 时间轴驱动：把绘制写在 tl.to({v:0}, {v:1, duration:<成片时长>, ease:"none", onUpdate: function () { draw(tl.time()); }}) 的 onUpdate 里；',
  '     draw(t) 必须只由 t 决定——禁止使用 Date.now() / performance.now() / 帧计数器 / 未设种子的随机数，禁止依赖上一帧留下的状态；',
  '   - canvas 与 three.js 的渲染尺寸按【画布】写死像素值，不要用 CSS 自适应缩放；',
  '3. 若用户提供了字幕，按字幕条目逐条依次播放入场动画。',
  '4. 字幕时间轴必须严格按提供的起止时间执行：每条字幕在其开始时间出现、结束时间前完成淡出，禁止把上一条字幕显示到下一条开始；时间为秒、可带小数（毫秒精度），GSAP 时间轴直接按这些小数秒定位，不要四舍五入或自行重排；无结束时间的行自行按语义安排节奏。',
  '5. 不得输出任何解释文字、Markdown 注释或代码块围栏，只输出 HTML 源码。'
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

// 进度载荷类型统一取自 shared/types.ts 的 AgentProgressPayload（⑧ 节；旧名 HtmlAgentProgress 仍可用）
export type AgentProgress = AgentProgressPayload

export interface AgentOpts {
  meta?: { project?: string; action?: string }
  maxTokenTries?: number[]
  onProgress?: (p: AgentProgress) => void
}

// HTML 的"完整性"判定：只在 finish_reason === 'length' 时被 ./chat 调用，
// 结尾有 </body> / </html> 就认为没被截断（提示词第 1 条要求完整文档结构，二者互相支撑）
function isCompleteHtml(content: string): boolean {
  return /<\/(body|html)\s*>\s*$/i.test(content.trim());
}

// 调用自定义模型生成/修改 HTML，返回模型输出的 HTML 原文（流式过程经 opts.onProgress 上报）
async function chatWithCustomModel(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {};
  return chatWithModel(
    [
      { role: 'system', content: HTML_AGENT_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '生成 HTML',
      noun: 'HTML',
      logFile: 'html-agent/chat.jsonl',
      isComplete: isCompleteHtml,
      truncatedHint: '请精简字幕/素材或更换模型',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  );
}

export {
  HTML_AGENT_SYSTEM,
  extractHtmlFromReply,
  chatWithCustomModel
};
