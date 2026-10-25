// src/main/projects/bgm.ts
// 背景音轨：由主进程**确定性注入** HTML（不交给 Agent 写 <audio>），也可按项目当前音频重新补回。
// 幂等：注入前先剥掉上次注入的整组标签，反复生成 / 修改不会叠加。

import path from 'node:path';
import fs from 'node:fs';
import type { Project } from '../../shared/types';
import { projectFilePath } from './paths';
import { readProject } from './store';

// ===== 背景音轨：由主进程确定性注入 HTML（不再交给 Agent 写 <audio>）=====
// 选定 / 更换 / 移除背景音频后，主进程按 project.audioFile 重写 index.html 里的 <audio>：
// 预览副本（PreviewHtml 由 index.html 生成）与转视频（video.ts 直接把 index.html 所在目录交给
// HyperFrames CLI）因此都能拿到音轨；音轨提取与混流由 CLI 内部完成（trace 阶段 audio_process），
// 应用侧不做任何 ffmpeg 混音。标签带固定 id，保证重复设置不会叠出多条音轨。
export const BGM_TAG_ID = 'myv-bgm';

// 把一段 HTML 片段插到文档末尾（优先 </body>，其次 </head>，都没有则拼在最前）。
// 模型输出可能被截断而缺 </body>：此时若直接拼到文件末尾，会落进未闭合的 <script> 导致整页 SyntaxError。
export function insertHtmlSnippet(html: string, snippet: string): string {
  const bodyEnd = html.lastIndexOf('</body>');
  if (bodyEnd >= 0) return html.slice(0, bodyEnd) + snippet + html.slice(bodyEnd);
  const headEnd = html.lastIndexOf('</head>');
  return headEnd >= 0 ? html.slice(0, headEnd + 7) + snippet + html.slice(headEnd + 7) : snippet + html;
}

export function escapeRegExp(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 去掉本应用注入的音轨标签（幂等）
export function stripInjectedBgm(html: string): string {
  return html.replace(new RegExp('<audio\\b[^>]*\\bid=["\']' + BGM_TAG_ID + '["\'][^>]*>(?:[\\s\\S]*?</audio>)?', 'gi'), '');
}

// 去掉引用同一个项目音频文件的历史标签（旧版由模型按提示词写入的 <audio>），避免与新标签双份播放
export function stripAudioOfFile(html: string, audioRef: string): string {
  const base = path.basename(audioRef);
  if (!base) return html;
  const re = new RegExp('<audio\\b[^>]*src=["\'][^"\']*' + escapeRegExp(base) + '[^"\']*["\'][^>]*>(?:[\\s\\S]*?</audio>)?', 'gi');
  return html.replace(re, '');
}

// 按项目当前 audioFile 重写 HTML 音轨；无 HTML（还没生成）时静默跳过。
// 返回 true = index.html 被改写（调用方可据此刷新预览 / 给提示）。
export function applyBgmToHtml(name: string, proj?: Project): boolean {
  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return false;
  const p = proj || readProject(name);
  const audioRef = (p && p.audioFile) || '';
  try {
    const before = fs.readFileSync(htmlPath, 'utf8');
    let html = stripInjectedBgm(before);
    if (audioRef) html = stripAudioOfFile(html, audioRef);
    if (audioRef) {
      // 与旧的提示词要求一致：autoplay + loop（音轨通常短于整条时间轴）
      html = insertHtmlSnippet(html, '<audio id="' + BGM_TAG_ID + '" src="' + audioRef + '" autoplay loop></audio>');
    }
    if (html === before) return false;
    fs.writeFileSync(htmlPath, html, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}
