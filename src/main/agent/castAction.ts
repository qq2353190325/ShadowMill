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

// 动作脚本的"完整性"判定：有 END ACTION 标记，或以 `}` 收尾（动作就是一个返回对象的函数）
function isCompleteAction(content: string): boolean {
  const t = String(content || '').trim()
  if (/<<<END\s*ACTION>>>\s*$/i.test(t)) return true
  return /\}\s*;?\s*$/.test(t)
}

// 与角色画师的分工：角色只决定"长什么样、怎么摆姿势"，这份只决定"这一条动作让它的参数怎么随时间变"。
// 为什么要把角色源码发给模型：每个角色自己实现的 o 参数不止通用那几项（猫的尾巴、四只脚、手持道具），
// 只有看过源码才知道它到底认哪些键、方向与量级怎么给——这正是「AI 生成专属动作」比通用关键帧强的地方。
export const HTML_CAST_ACTION_SYSTEM = [
  '你是动画影片的动作设计师。你**只为一个角色的一条动作写脚本**，不画角色、不改角色代码。',
  '必须遵守以下硬性要求：',
  '1. 只输出一个动作块，不要任何解释文字：',
  '   <<<ACTION>>>',
  '   function (t) {',
  '     return { aL: 0, aR: 0 };',
  '   }',
  '   <<<END ACTION>>>',
  '2. 动作 = 一个**纯函数**：输入 t（秒，0 ≤ t < 时长），返回这一刻要传给角色的参数对象。',
  '   同一个 t 必须永远返回同一个值：不许 Date.now() / performance.now() / Math.random() / 依赖外部状态。',
  '3. **只返回这个角色真的会读的参数**：先读用户消息里的【角色源码】，看 o.xxx 实际读了哪些键再决定。',
  '   通用参数（几乎每个角色都有）：walk 摆腿相位（0..1 一圈）/ aL、aR 手臂角度（正 = 向外抬起）/',
  '   eyes、mouth 表情（normal / happy / sad / angry / surprise）/ blink 眨眼 0..1 /',
  '   dy、dx 位移（**正 = 下、右**，跳起来要写负的 dy）/ rot 旋转弧度（正 = 顺时针）/ sq 挤压（正 = 拉长变窄）。',
  '   角色自己多出来的键（如 o.tail、o.ear）可以照用，但**必须先确认源码里真的读了它**，不要发明参数名。',
  '4. 不要画任何东西、不要碰 ctx / canvas / DOM；不要 window / document / 定时器 / 循环（for、while）；',
  '   只用 Math.sin / Math.cos / Math.abs / Math.min / Math.max、三元与算术。整段不超过 60 行。',
  '5. 情绪类的 eyes / mouth 只能从上面那五个值里取；**mouth 尽量别写**（不写时角色会按 eyes 自己定嘴型）。',
  '6. 动作要"看得出在干嘛"：幅度够大（手臂 0.8–1.8、位移 0.3–1u、sq 0.1–0.4），但别超出上面的常见范围；',
  '   循环动作首尾要接得上（t = 0 与 t = 时长时的参数一致），一次性动作按用户消息给的时长收住。',
  '7. 只写这一条动作，不要顺带改角色的画法，也不要写多个动作。'
].join('\n')

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
