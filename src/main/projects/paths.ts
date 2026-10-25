// src/main/projects/paths.ts
// 项目在磁盘上的位置：根目录、项目目录、项目内文件路径、视频相对路径换算、全局角色库根。
// 只做路径拼接，不读写任何文件（读写在 store.ts）。

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// 项目根目录：**故意用函数、不用模块级常量**。
// 原因：ESM 的 import 提升会让本模块在 index.ts 的模块体之前求值。当前 userData 位置只跟随
// package.json 的 name，模块级快照本来也正确；但只要将来有任何"在模块体里改 userData 位置"的代码
// （例如重新引入 app.setPath），快照就会静默钉在**当时**的 userData 上，表现为"项目全没了"，
// 而且极难查。写成函数永远按当前值解析，代价为零，属于纯保险。
// 写法与 whisper.modelsDir() / runtime.runtimeDir() 保持一致。
export function projectsRoot(): string {
  return path.join(app.getPath('userData'), 'projects');
}

export function projectDir(name: string): string {
  return path.join(projectsRoot(), String(name || '').replace(/[\\/:*?"<>|]/g, '_'));
}

export function projectFilePath(name: string, file: string): string {
  return path.join(projectDir(name), file);
}

// ===== 读盘：索引 + 正文分开 =====
// project.json 只存索引；字幕在 subtitle.txt、内容脚本在 content.json。
// 老项目免迁移：文件缺失时回退到 project.json 里的内联旧字段，下次保存自然迁走（写回时剥掉内联字段）。
export function contentFilePath(name: string): string {
  return projectFilePath(name, 'content.json');
}

// ===== 视频成品路径：项目内相对路径 =====
// 成品由「转视频」直接生成在 <项目目录>/video/output.mp4，project.json 里只记相对引用（video/output.mp4）。
// 为什么不记绝对路径：① 项目要自包含、能整体搬走；② 绝对路径会因 userData 改名而失效——
// 本仓库的老数据里就有指向旧目录 `…\my-app\projects\…` 的死路径（改名前的品牌）；③ 旧实现把成品放在
// 渲染临时目录 `hf-projects\…`，那条路径随时会被清理，"有视频"的判定跟着一起塌。
// 兼容旧值：老记录里可能是绝对路径（存在的就用它，可能是 hf-projects 的旧成品），否则按项目内相对路径解析。
export function resolveVideoAbs(name: string, videoPath: string): string {
  const v = String(videoPath || '').trim()
  if (!v) return ''
  if (path.isAbsolute(v)) return fs.existsSync(v) ? v : ''
  return path.join(projectDir(name), v)
}

// ===== 全局角色库与共享绘制助手的根路径 =====
// 角色库是**用户资产**（可备份、可迁移），落 userData 下；core.js 的真源在应用里（hfEnv.coreSource()）。
export function castLibraryRoot(): string {
  return path.join(app.getPath('userData'), 'cast-library');
}

// 角色预览页的落盘目录（<userData>/cast-preview/）：角色与项目无关，预览页不能落在某个项目里；
// 它由 hgpreview 的 `?user=1` 白名单放行（见 main/index.ts 的 USER_PREVIEW_DIRS）。
export function castPreviewDir(): string {
  return path.join(app.getPath('userData'), 'cast-preview');
}
