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
