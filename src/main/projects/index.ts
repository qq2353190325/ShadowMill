// src/main/projects/index.ts
// 项目化贯通流水线：字幕 → HTML → 预览/转视频。本文件是**统一出口**：
// 外部（main/index.ts、voice.ts、whisper.ts、ttsAlign.ts）只从 './projects' 取，不关心内部怎么分文件 ——
// 与 src/main/agent/、src/main/updater/ 同一套「同名目录 + index.ts」约定。
//
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本（**唯一正文**）
//   content.json  内容脚本 { style, scenes }（**唯一正文**）
//   index.html    由脚本/字幕生成的 HTML composition
//   project.json  **只有索引**：name/title/subtitleCount/htmlPath/videoPath/audioFile/
//                 materials/render/canvas/时间戳 等小字段；不含字幕与脚本正文
//   images/       图片素材（HTML 生成用，project.json 的 materials 以相对引用登记）
//   video/        视频素材（同上）
//   cast/         **角色副本**：本片勾选的全局角色（<userData>/cast-library/）在生成前被复制到这里，
//                 因为预览协议与渲染静态服务器只放行项目目录内的文件；界面上不可编辑（见 main/cast/library.ts）
//
// 目录结构（依赖单向，paths 在最上游；上游不 import 下游，不会成环）：
//   paths.ts         项目在磁盘上的位置（只拼路径，不读写）
//   store.ts         项目读写：project.json + subtitle.txt / content.json + 角色表（按 id 回全局库补全）
//   materials.ts     素材库（图片 / 视频）
//   prompts.ts       喂给模型的提示词块与三份 prompt（规划 / 逐章 / 角色：新建与改画法）
//   bgm.ts           背景音轨注入
//   previewScript.ts 预览副本的控制脚本（纯字符串）
//   progress.ts      Agent 进度 → 渲染层文案
//   htmlWrite.ts     Agent 产出落盘：单文件 / 章节骨架 / 角色注入 + 角色副本同步
//   chaptersFlow.ts  章节化：逐章生成 + 两段式改稿（改稿不碰角色）
//   ipc/*.ts         四组频道（项目 / HTML / 素材与音视频 / 角色：全局库 cast:* + project:save-cast）
//   register.ts      只做装配：按固定顺序调四个域的注册函数
//
// 依赖：agent(chatWithCustomModel / chatWithHtmlEdit 等) / hfEnv / runtime / settings / dialog / shell

// 结构定义在 src/shared/types.ts（跨进程单一真源），此处再导出以保持既有引用面不变
export type { ContentScript, Project, Scene, SubtitleLine } from '../../shared/types';

export { copyMaterialIntoProject, normalizeMaterials } from './materials';
export { projectsRoot, projectDir, projectFilePath } from './paths';
export { register } from './register';
export { scanProjects, readProject, writeProject, ensureProject, parseSubtitle, normalizeContent, copyAudioIntoProject } from './store';
