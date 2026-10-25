// src/main/agent/htmlEdit.ts
// 单文件模式「按需求修改」的系统提示词与调用封装。
//
// 为什么不复用 chatWithCustomModel（HTML_AGENT_SYSTEM）：那份契约是**从零生成**一整份页面，
// 而「修改」要明确「在现有页面上改、不重发与本次无关的东西、角色必须沿用不能重画」。
// 思路与章节模式的 HTML_CHAPTER_EDIT_SYSTEM 一致：**基础契约 + 一段「本次是修改」的追加规则**，
// 不另起一份完整提示词，避免两份契约漂移。
//
// **角色不在这条链路上**：角色只有全局一份（<userData>/cast-library/），新建与改画法都在「角色」页
// （cast:create / cast:recreate）。改稿只把角色表发给模型（让它知道有哪些 window.__cast 可以调用），
// 不收任何 cast/*.js 文件块——用户明确要求"HTML 那边不允许新增和修改角色"。
import { chatWithModel } from './chat'
import { HTML_AGENT_SYSTEM } from './html'
import type { AgentOpts } from './html'

const HTML_AGENT_EDIT_SYSTEM = HTML_AGENT_SYSTEM + '\n' + [
  '7. 本次是**修改**，不是重写整片：用户消息里给了当前 index.html 的源码，以及（有角色时）本片的角色表。',
  '   输出**一整份完整 HTML**（第 1、6 条照旧：<!DOCTYPE html> 开头、</html> 结尾，不要任何解释文字）。',
  '8. **角色必须沿用**：页面里已有的 window.__cast["id"](…) 调用不许删掉，也不许改成在这份 HTML 里自己画一遍——',
  '   角色只有这一份绘制代码（全局角色库），你重画就等于把用户的角色丢掉了。',
  '9. **角色文件不归你改**：不要交 cast/*.js 文件块，不要新建角色，也不要改角色的画法——',
  '   那在应用的「角色」页做。你只负责页面怎么调用它们。'
].join('\n')

// "完整性"判定（只在被 max_tokens 截断时用）：收尾是 </body> / </html> 才算完整。
function isCompleteHtmlEdit(content: string): boolean {
  return /<\/(body|html)\s*>\s*$/i.test(String(content || '').trim())
}

// 单文件模式下的「按需求修改」：只交一整份 HTML（见上面的契约）。
// 日志仍写 html-agent/chat.jsonl：与旧的单文件改稿记录在同一个文件里，便于前后对照（分析脚本按它取数据）。
async function chatWithHtmlEdit(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {}
  return chatWithModel(
    [
      { role: 'system', content: HTML_AGENT_EDIT_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '修改 HTML',
      noun: 'HTML',
      logFile: 'html-agent/chat.jsonl',
      isComplete: isCompleteHtmlEdit,
      truncatedHint: '本轮改动太大被截断：请一次只改一小块页面',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  )
}

export { HTML_AGENT_EDIT_SYSTEM, isCompleteHtmlEdit, chatWithHtmlEdit }
