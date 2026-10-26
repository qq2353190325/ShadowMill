// src/main/agent/html.ts
// HTML 生成/修改：本文件只剩「组装与调用」——提示词常量已全部搬到 ./constants.ts（那才是改文案的地方），
// 真正的传输层（多轮消息、流式输出、max_tokens 升档重试、过程记录）在 ./chat.ts。
// 提供：extractHtmlFromReply / chatWithCustomModel / chatWithChapterPlan / chatWithChapter /
//       chatWithChapterEdit / chatWithCast / chatWithRoute，并再导出 ./constants 里的提示词常量。
// 依赖：./chat(chatWithModel)、./constants(提示词)
import { chatWithModel } from './chat'
import {
  HTML_AGENT_SYSTEM,
  HTML_PLAN_SYSTEM,
  HTML_CAST_SYSTEM,
  HTML_ROUTE_SYSTEM,
  HTML_CHAPTER_SYSTEM
} from './constants'
import type { AgentProgressPayload } from '../../shared/types'

// 从模型回复中提取 HTML（兼容 Markdown 代码块包裹的情况）
function extractHtmlFromReply(text: string): string {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] && fence[1].trim()) return fence[1].trim();
  const start = t.search(/<!DOCTYPE html|<html/i);
  if (start >= 0) return t.slice(start).trim();
  return t;
}

// 规划调用的"完整性"判定：只在 finish_reason === 'length' 时被 ./chat 调用。
// 规划输出很短，末尾能解析出 JSON 收尾就算完整（有标记看标记，没有就看最后一个 }）。
function isCompletePlan(content: string): boolean {
  const t = String(content || '').trim();
  if (/<<<END\s*PLAN>>>\s*$/i.test(t)) return true;
  return /\}\s*$/.test(t);
}

// 章节代码的"完整性"判定：有 END FILE 标记，或文件块内容以 `})();` / `}` 收尾
function isCompleteChapter(content: string): boolean {
  const t = String(content || '').trim();
  if (/<<<END\s*FILE>>>\s*$/i.test(t)) return true;
  return /(\}\)\s*\(\s*\)\s*;?|\})\s*$/.test(t);
}

// 角色代码的"完整性"判定：有 END FILE 标记，或以 `})();` 收尾（角色文件就是一层 IIFE）
function isCompleteCast(content: string): boolean {
  const t = String(content || '').trim();
  if (/<<<END\s*FILE>>>\s*$/i.test(t)) return true;
  return /\}\)\s*\(\s*\)\s*;?\s*$/.test(t);
}

// 路由回复的"完整性"判定：JSON 收尾（路由输出很短，结尾是 } 就算完整）
function isCompleteRoute(content: string): boolean {
  const t = String(content || '').trim();
  if (/<<<END\s*ROUTE>>>\s*$/i.test(t)) return true;
  return /\}\s*$/.test(t);
}

// 「按需求修改」在章节模式下的追加规则：与逐章生成共用同一份契约（HTML_CHAPTER_SYSTEM），
// 差别只在「可以只交改动过的章、也可以顺手改结构」。不另起一份完整提示词，避免两份契约漂移。
const HTML_CHAPTER_EDIT_SYSTEM = HTML_CHAPTER_SYSTEM + '\n' + [
  '12. 本次是**修改**，不是重写整片：',
  '    - 只输出你改动过的章节文件块（`<<<FILE pages/cNN.js>>>`），',
  '      没改的文件不要输出——应用会保留盘上原样；用户消息里会用 <<<CURRENT 路径>>> 包出**这次允许你改的源码**；',
  '    - 可以改的文件只有：本次给出的 CURRENT 章节文件。要改别的文件，请用户再提一次要求（不要凭空猜内容改）；',
  '    - 如果要增删章节、改章节时长或调整顺序，**先输出一个完整的新 PLAN 块**（格式与规划调用相同：',
  '      <<<PLAN>>> {"mode":"chapters","chapters":[…]} <<<END PLAN>>>，必须列出改后的全部章节），再输出受影响的文件块；',
  '    - **角色完全不归你管**（角色只有全局一份，在应用的「角色」页新建 / 改画法）。不要交 cast/*.js 文件块、',
  '      不要新造角色、也不要改角色的长相；你只能在章节里按【项目角色】给的 id 与调用方式使用它们；',
  '    - 新的 PLAN 里每章的 `uses` 必须照实写（用了 p5 就补上），骨架按它们决定引入哪些脚本；',
  '    - 无论改哪一章，时间一律从该章的 0 开始；新 PLAN 里的 duration 必须与重写后的代码长度一致；',
  '    - 不要改动与应用约定好的骨架结构（不要写 <html>、不要注册 __timelines、不要自己加 <audio>）。'
].join('\n');

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

// 规划调用（章节化长片第一步）：只回答「单文件还是拆章 + 每章范围与时长」，输出很短。
// 单独一条日志文件（html-agent/plan.jsonl），出问题时能与逐章生成的记录分开看。
async function chatWithChapterPlan(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {};
  return chatWithModel(
    [
      { role: 'system', content: HTML_PLAN_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '规划章节',
      noun: '章节规划',
      logFile: 'html-agent/plan.jsonl',
      isComplete: isCompletePlan,
      truncatedHint: '请减少内容脚本的场景数，或在需求里指定更少的章节',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  );
}

// 逐章生成调用：一次只写一章的 JS 文件（pages/cNN.js）。截断的代价比整片小得多，
// 重试提示也直接指向「把这一章拆短」——这正是章节化要解决问题的能力。
async function chatWithChapter(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {};
  return chatWithModel(
    [
      { role: 'system', content: HTML_CHAPTER_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '生成章节',
      noun: '章节代码',
      logFile: 'html-agent/chapter.jsonl',
      isComplete: isCompleteChapter,
      truncatedHint: '请把这一章拆成更短的段落（缩短本章时长后再试）',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  );
}

// 章节模式下的「按需求修改」：同一份章节契约 + 一段修改规则（可只交改动过的文件，也可先交新 PLAN）
async function chatWithChapterEdit(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {};
  return chatWithModel(
    [
      { role: 'system', content: HTML_CHAPTER_EDIT_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '修改章节',
      noun: '章节代码',
      logFile: 'html-agent/chapter-edit.jsonl',
      isComplete: isCompleteChapter,
      truncatedHint: '本次改动太大被截断：请一次只改一章，或把这一章拆短',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  );
}

// 角色调用：一次只写一个角色的绘制函数（cast/<id>.js）
async function chatWithCast(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {};
  return chatWithModel(
    [
      { role: 'system', content: HTML_CAST_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '生成角色',
      noun: '角色代码',
      logFile: 'html-agent/cast.jsonl',
      isComplete: isCompleteCast,
      truncatedHint: '这个角色的画法太长被截断：请要求它简化画法（少画细节、少用部件）',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  );
}

// 路由调用（改稿第一段）：只看大纲，输出「这次要给模型看哪几个文件」
async function chatWithRoute(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {};
  return chatWithModel(
    [
      { role: 'system', content: HTML_ROUTE_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '定位改动文件',
      noun: '改动定位',
      logFile: 'html-agent/route.jsonl',
      isComplete: isCompleteRoute,
      truncatedHint: '路由输出被截断：请把要求写得更短更具体',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  );
}

export {
  HTML_AGENT_SYSTEM,
  HTML_PLAN_SYSTEM,
  HTML_CHAPTER_SYSTEM,
  HTML_CHAPTER_EDIT_SYSTEM,
  HTML_CAST_SYSTEM,
  HTML_ROUTE_SYSTEM,
  extractHtmlFromReply,
  chatWithCustomModel,
  chatWithChapterPlan,
  chatWithChapter,
  chatWithChapterEdit,
  chatWithCast,
  chatWithRoute
};
