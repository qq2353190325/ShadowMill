// src/shared/constants.ts —— 应用级公共常量（main / preload / 渲染层 / 构建配置共用）
//
// 存在的理由：品牌文案（中文应用名、英文名、口号）原先散落在 index.html 的窗口标题与启动画面、
// App.vue 标题栏、HomePage 首页、whisper.ts 的 User-Agent 等处，改一处漏一处且没有编译期提示。
// 现在**品牌文案只有本文件一处来源**，各处一律 import 它。
//
// 改品牌名（如「影坊」→ 新名）时的完整清单，除此以外不需要再全局搜「影坊 / ShadowMill」：
//   1) 本文件 §应用标识；
//   2) package.json 的 productName / description / appId
//      （JSON 无法 import TS，构建期由 electron.vite.config.ts 校验 productName 并在不一致时告警）；
//   3) src/renderer/index.html —— 用 %APP_NAME% / %APP_NAME_EN% / %APP_SLOGAN_SHORT% 占位，构建期注入；
//   4) 渲染层组件直接 import 本文件。
// 注意：渲染层 localStorage 的 'myapp.*' 键名**故意不跟随**品牌名（改了会丢老用户记忆），
// 见 src/renderer/src/constants.ts。
// 版本号不在本文件：一律运行时取 app.getVersion()（设置页经 window.updateTools.version() 拿）。

import type { RenderCanvas } from './types';

// ===== 应用标识（品牌文案唯一来源）=====
// 中文显示名：标题栏、启动画面、首页角标
export const APP_NAME = '影坊';
// 英文名：与 package.json 的 productName 一致（安装包与可执行文件名 ShadowMill.exe 同此），
// 也用于出网请求的 User-Agent
export const APP_NAME_EN = 'ShadowMill';
// 首页主标题
export const APP_SLOGAN = '一站式音视频创作流水线';
// 短位文案（启动画面副标题）：不带「一站式」，避免窄位换行
export const APP_SLOGAN_SHORT = '音视频创作流水线';

// ===== 出网请求标识 =====
// 主进程下载 whisper 模型等外部请求的 User-Agent：带上应用名便于对端统计与排查
export const APP_USER_AGENT = APP_NAME_EN + '/1.0';

// ===== 项目素材（HTML 生成用的图片 / 视频素材库，结构见 types.ts 的 ProjectMaterial）=====
// 上限按「图片 + 视频合计」算：素材会逐个写进 Agent 提示词并成为页面元素，数量一多提示词过长、
// HTML 生成质量与渲染耗时都会明显变差，20 是权衡后的取值。主进程校验，渲染层用它显示「n / 20」。
export const MAX_MATERIALS = 20;

// 图片素材白名单（svg 也收：矢量图做图标/装饰最省体积，且不涉及解码器）
export const IMAGE_MATERIAL_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

// 视频素材白名单（与原来的单个视频素材一致）
export const VIDEO_MATERIAL_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'];

// ===== 成片画布（HyperFrames 的画布预设，**尺寸唯一真源**）=====
// 取值与尺寸必须与 HyperFrames CLI 的 CANVAS_DIMENSIONS 对齐（resources/hyperframes/.../dist/cli.js：
//   landscape 1920x1080 / portrait 1080x1920 / square 1080x1080，另有 4k 三档——本项目只暴露 1080 三档）。
// 为什么放在 shared：三个消费点必须用同一组数——
//   ① 主进程往渲染入口注入舞台 data-width/data-height（成片宽高的真正来源）与 <html data-resolution>
//      （src/main/video.ts；CLI 只认前者，读不到就兜底 1080x1920）
//   ② 主进程把它写进生成提示词，让模型按同一块画布排版式（src/main/projects.ts）
//   ③ 渲染层选项表与预览 iframe 的画布尺寸（renderer/utils/render.ts、HtmlGenPage/PreviewSection.vue）
// 改这里的尺寸/取值时，CLI 那边若对不上，成片会退回 CLI 自己的兜底 1080x1920 竖屏（见 video.ts 的注释）。
export const RENDER_CANVASES: RenderCanvas[] = ['landscape', 'portrait', 'square'];
// 每个画布的实际像素（= composition 尺寸 = 成片尺寸；CLI 不传 --resolution 时输出就是它本身）
export const CANVAS_SIZES: Record<RenderCanvas, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
};
// 画布的界面/提示词文案（中文简写）。放这里而不是各处自己拼：提示词（主进程）与下拉选项（渲染层）
// 必须说同一句话，否则「界面选的」和「告诉模型的」会对不上。
export const CANVAS_LABELS: Record<RenderCanvas, string> = {
  landscape: '横屏 16:9',
  portrait: '竖屏 9:16',
  square: '方形 1:1'
};
// 项目没设 canvas 时用的画布。选 landscape 的理由：应用内预览画布历来是 16:9、首页也写着「1080P 导出」，
// 老项目因此保持原有观感；此前「成片莫名变竖屏」正是因为没有这个确定值（CLI 兜底 portrait）。
export const DEFAULT_CANVAS: RenderCanvas = 'landscape';

// ===== 估时语速（字/秒，**唯一真源**）=====
// 一个语速三个用处，改这一行就一起变：
//   ① 字幕估时公式 estimateSubtitleDur()（本文件下方）。它有两个消费方——渲染层字幕页
//      （SubtitlePage/helpers.ts 的 estDur → 「由脚本旁白生成」/ 新增条目 / 纯文本与 SRT 解析）
//      与主进程 parseSubtitle（逐句对齐时给「整行没有 [时间] 前缀」的行兜底起始时间）；
//   ② 内容脚本页「AI 创作」结果卡上的「估算时长」= 总字数 ÷ 它（ContentPage 的 AiChatPanel / ScriptRoundCard）；
//   ③ 主进程脚本 Agent 提示词里的字数预算：「目标总时长 × 它 = 旁白总字数上限」（agent/script.ts）。
// 历史：这条规则原来在渲染层与主进程各写了一遍（0.15 秒/字 ≈ 6.7 字/秒，本是给「一条短句」估时用的
// 老系数，套到一整段场景旁白上快一倍——93 字的旁白只排 15.5 秒、实际要读 23 秒，字幕读不完），
// 而内容脚本页另写 4.5 字/秒，两套口径对不上；2026-10-21 统一成 4 字/秒。
// 注意：这只是**估时**，不读音频；真实时长得走配音页的「字幕配音（逐句对齐）」实测。
export const EST_CHARS_PER_SEC = 4;
// 估时公式：max(2.4, 1.6 + 字数 / 语速)。下限 2.4 秒与基数 1.6 秒是历史沿用的取值，与语速无关。
export function estimateSubtitleDur(text: string): number {
  const n = String(text == null ? '' : text).length;
  return Math.max(2.4, 1.6 + n / EST_CHARS_PER_SEC);
}

