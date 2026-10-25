// utils/taskId.ts —— 渲染层发起 AI 任务时生成的任务 id（纯函数，无状态依赖）。
//
// 为什么要由渲染层生成：必须先有 id 才能「先订阅、再调用」（见 preload 的 onTaskProgress），
// 否则模型最开头那几条进度会在订阅之前就发出去、没人收。
//
// 唯一性只要求「同一时刻同一页面上不重复」：前缀标出任务来源（html / cast），
// 后面是时间戳 + 进程内自增 + 几位随机，足够区分并行任务；这个串不进提示词、不进日志文件名。
let seq = 0

export function newTaskId(prefix: string): string {
  seq = (seq + 1) % 1e6
  return String(prefix || 'task') + '-' + Date.now().toString(36) + '-' + seq.toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}
