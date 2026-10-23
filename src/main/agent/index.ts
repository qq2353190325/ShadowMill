// src/main/agent/index.ts
// Agent 层的统一出口：外部（projects.ts、main/index.ts）只从 './agent' 取，
// 不关心内部怎么分文件——与 src/main/updater/ 同一套「同名目录 + index.ts」约定。
//
// 目录结构（依赖单向，chat 在最上游，chatLog 是纯文件模块，html / script 只依赖 chat）：
//   chat.ts    通用对话传输：多轮消息 / 流式 / max_tokens 升档重试 / jsonl（不认识任何业务）
//   chatLog.ts 对话记录文件读写（projects/<名>/chat/ 下的索引与版本副本）：只依赖 fs/path（不对外再导出）
//   html.ts    HTML Agent：HTML 系统提示词 + 回复提取（走 chat）
//   script.ts  内容脚本 Agent：脚本提示词 + JSON 解析 + script:* handler（走 chat / chatLog）
//   index.ts   本文件：只做再导出，不写任何逻辑（chatLog 是内部模块，不在此再导出）
export { chatWithModel, MAX_TOKEN_TRIES } from './chat'
export type { ChatMessage, AgentChatOptions } from './chat'
export { HTML_AGENT_SYSTEM, extractHtmlFromReply, chatWithCustomModel } from './html'
export { HTML_PLAN_SYSTEM, HTML_CHAPTER_SYSTEM, HTML_CHAPTER_EDIT_SYSTEM, HTML_CAST_SYSTEM, HTML_ROUTE_SYSTEM, chatWithChapterPlan, chatWithChapter, chatWithChapterEdit, chatWithCast, chatWithRoute } from './html'
export type { AgentOpts, AgentProgress } from './html'
export { SCRIPT_AGENT_SYSTEM, buildScriptPrompt, parseScriptReply, registerScript } from './script'
