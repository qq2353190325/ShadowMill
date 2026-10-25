// src/main/projects/materials.ts
// 项目素材库（图片 / 视频）：id、类型判定、拷入项目目录、清单规范化、扩展名文案。
// 角色（cast/）不走这里：它是共用绘制代码，有自己的 cast/ 目录模块（table / edit / inject / library / preview）。

import path from 'node:path';
import fs from 'node:fs';
import { IMAGE_MATERIAL_EXTS, MAX_MATERIALS, VIDEO_MATERIAL_EXTS } from '../../shared/constants';
import type { ProjectMaterial, ProjectMaterialKind } from '../../shared/types';
import { projectDir } from './paths';

// ===== 项目素材库（图片 / 视频）=====
// 素材按 kind 落到各自的目录；与场景/字幕一样，project.json 里只登记**项目内相对引用**（file），
// 因此项目目录可以整体搬走/复制，页面里的 <img src="images/x.png"> 也不会失效。
export const MATERIAL_DIR: Record<ProjectMaterialKind, string> = { image: 'images', video: 'video' };

// 素材 id：进入界面即稳定不变（勾选、移除都按它定位），与文件名解耦（同名文件重复导入也不会串）
export let materialSeq = 0;

export function newMaterialId(): string {
  materialSeq++;
  return 'mat-' + Date.now().toString(36) + '-' + materialSeq;
}

// 由扩展名判素材类型；白名单外一律不认（返回 ''），调用方自行跳过
export function materialKindOf(filePath: string): ProjectMaterialKind | '' {
  const ext = path.extname(String(filePath || '')).replace('.', '').toLowerCase();
  if (IMAGE_MATERIAL_EXTS.includes(ext)) return 'image';
  if (VIDEO_MATERIAL_EXTS.includes(ext)) return 'video';
  return '';
}

// 将外部图片 / 视频复制进项目素材目录，返回相对引用（images/xxx | video/xxx）；复制失败返回 ''
export function copyMaterialIntoProject(name: string, kind: ProjectMaterialKind, srcPath: string): string {
  if (!name || !srcPath || !fs.existsSync(srcPath)) return '';
  try {
    const dirName = MATERIAL_DIR[kind];
    const dir = path.join(projectDir(name), dirName);
    fs.mkdirSync(dir, { recursive: true });
    const basename = path.basename(srcPath).replace(/[\\/:*?"<>|]/g, '_');
    const extIndex = basename.lastIndexOf('.');
    const stem = extIndex > 0 ? basename.slice(0, extIndex) : basename;
    const ext = extIndex > 0 ? basename.slice(extIndex) : '';
    let saveName = basename;
    let i = 1;
    while (fs.existsSync(path.join(dir, saveName))) {
      saveName = stem + '_' + i + ext;
      i++;
      if (i > 1000) break;
    }
    fs.copyFileSync(srcPath, path.join(dir, saveName));
    return dirName + '/' + saveName;
  } catch (e) {
    return '';
  }
}

// 素材列表规范化（**读盘与写盘共用**）：脏数据在进入渲染层之前就被清掉，写回时也不会落进 project.json。
// ① 非数组/非对象丢弃；② kind 只认 image/video；③ file 必须是本项目 images/ 或 video/ 下的相对路径
// （挡掉 ../ 与绝对路径这类越权引用）；④ id 缺失补一个；⑤ selected 缺省视为 true；⑥ 条数截到 MAX_MATERIALS。
export function normalizeMaterials(raw: unknown): ProjectMaterial[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ProjectMaterial[] = [];
  for (const item of list) {
    if (out.length >= MAX_MATERIALS) break;
    const o = (item && typeof item === 'object' && !Array.isArray(item)) ? item as Record<string, unknown> : null;
    if (!o) continue;
    const kind: ProjectMaterialKind | '' = o.kind === 'image' ? 'image' : (o.kind === 'video' ? 'video' : '');
    if (!kind) continue;
    const file = typeof o.file === 'string' ? o.file.replace(/\\/g, '/').replace(/^\.\//, '') : '';
    if (!file || file.includes('..') || !file.startsWith(MATERIAL_DIR[kind] + '/')) continue;
    const addedAt = typeof o.addedAt === 'string' && o.addedAt ? o.addedAt : new Date().toISOString();
    out.push({
      id: (typeof o.id === 'string' && o.id) ? o.id : newMaterialId(),
      kind,
      file,
      label: (typeof o.label === 'string' && o.label) ? o.label : path.basename(file),
      selected: o.selected !== false,
      addedAt
    });
  }
  return out;
}

// 素材白名单的可读文案（失败提示里给用户看）
export function materialExtsText(): string {
  return ['图片 ' + IMAGE_MATERIAL_EXTS.join('/'), '视频 ' + VIDEO_MATERIAL_EXTS.join('/')].join('，');
}
