// src/main/agent/castAction.ts
// 「角色」页 · 动作示范 · AI 生成专属动作：**动作脚本**的系统提示词与调用。
//
// 为什么单独一个文件、不塞回 html.ts：那边的角色画师提示词（HTML_CAST_SYSTEM）已经让 html.ts 顶到
// 500 行的硬上限了，而这里回答的是**另一个问题**——"这一条动作让角色的参数怎么随时间变"，
// 与"这个人长什么样、怎么摆姿势"不是同一件事（参考项目里也是两个角色在干这件事）。
//
// 走的是通用传输层 ./chat：多轮消息 / 流式 / max_tokens 升档重试 / jsonl 记录都在那边，
// 本文件只提供 system 提示词、完整性判定与 label。
import { chatWithModel } from './chat'
import type { AgentOpts } from './html'
import { HTML_CAST_ACTION_SYSTEM } from './constants'

// 提示词常量本身在 ./constants.ts（agent 模块的文案唯一真源），这里只是再导出，保持对外口径不变。
export { HTML_CAST_ACTION_SYSTEM }

// 动作脚本的"完整性"判定：有 END ACTION 标记，或以 `}` 收尾（动作就是一个返回对象的函数）
function isCompleteAction(content: string): boolean {
  const t = String(content || '').trim()
  if (/<<<END\s*ACTION>>>\s*$/i.test(t)) return true
  return /\}\s*;?\s*$/.test(t)
}


// 动作生成：读这个角色的源码后写一条它专属的动作脚本（返回动画参数对象的纯函数）
export async function chatWithCastAction(userPrompt: string, opts?: AgentOpts): Promise<string> {
  const o = opts || {}
  return chatWithModel(
    [
      { role: 'system', content: HTML_CAST_ACTION_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    {
      label: '生成动作',
      noun: '动作脚本',
      logFile: 'html-agent/cast-action.jsonl',
      isComplete: isCompleteAction,
      truncatedHint: '这条动作太长被截断：把要求写得更简单（少几个部位、少几段）',
      meta: o.meta,
      maxTokenTries: o.maxTokenTries,
      onProgress: o.onProgress
    }
  )
}
