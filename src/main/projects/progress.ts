// src/main/projects/progress.ts
// Agent 进度 → 渲染层文案，并按任务 id 推回发起方（生成 HTML 与新建角色可以并行，各走各的 id）。

import type { IpcMainInvokeEvent } from 'electron';
import { type AgentProgress } from '../agent';
import { IPC } from '../../shared/ipc';
import type { Project } from '../../shared/types';

// Agent 进度 → 渲染层可读文案（projects:* 进度推送共用）
// 章节模式下带上「第 k/N 章」前缀：一条 3 分钟的片要发 1 + N 次请求，没有这个前缀用户看到的
// 永远只是「AI 正在生成 HTML…」，判断不了还要等多久。
export function progressText(info: AgentProgress): string {
  const stage = info && info.stage;
  const text = stage === 'connecting' ? '正在连接模型…'
    : stage === 'thinking' ? 'AI 正在推理中…（已思考 ' + (info.thinkChars || 0) + ' 字符）'
    : stage === 'writing' ? 'AI 正在生成 HTML…（已输出 ' + (info.contentChars || 0) + ' 字符）'
    : stage === 'retry' ? '本次输出为空，正在升档重试…'
    : stage === 'done' ? '模型输出完成，正在写入文件…'
    : '';
  const idx = info && info.chapterIndex;
  const tot = info && info.chapterTotal;
  if (text && idx && tot) return '第 ' + idx + '/' + tot + ' 章：' + text;
  const ci = info && info.castIndex;
  const ct = info && info.castTotal;
  if (text && ci && ct) return '角色 ' + ci + '/' + ct + '：' + text;
  return text;
}

// 进度发送器：taskId 必填（一条频道 + 按任务 id 分发，见 preload 的 onTaskProgress），
// chapterIndex/chapterTotal、castIndex/castTotal 是文案用的附加字段（章节 / 角色进度）。
export function progressSender(event: IpcMainInvokeEvent, extra: { taskId: string; chapterIndex?: number; chapterTotal?: number; castIndex?: number; castTotal?: number }) {
  const sender = event.sender;
  return (info: AgentProgress) => {
    const merged = Object.assign({}, info, extra);
    const text = progressText(merged);
    if (text && !sender.isDestroyed()) sender.send(IPC.Project.HtmlProgress, Object.assign({}, merged, { text }));
  };
}

// 一条直接的进度文案（不带模型阶段，用于「正在规划章节…」「规划失败改用单文件」这类提示）
export function pushStatus(event: IpcMainInvokeEvent, text: string, extra: { taskId: string; chapterIndex?: number; chapterTotal?: number; castIndex?: number; castTotal?: number }): void {
  const sender = event.sender;
  if (!text || sender.isDestroyed()) return;
  sender.send(IPC.Project.HtmlProgress, Object.assign({ stage: 'connecting', thinkChars: 0, contentChars: 0, thinkText: '', text }, extra));
}
