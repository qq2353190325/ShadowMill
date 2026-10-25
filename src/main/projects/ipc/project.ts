// src/main/projects/ipc/project.ts
// project:* 的项目生命周期类频道：列表、新建、载入、存字幕、存内容脚本、导出 SRT、打开目录、删除。

import type { RegisterCtx } from '../../../shared/types';
import { ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { IPC } from '../../../shared/ipc';
import type { Project, ProjectExportSrtPayload, ProjectSaveContentPayload, ProjectSaveSubtitlePayload } from '../../../shared/types';
import { normalizeMaterials } from '../materials';
import { projectDir, projectsRoot, resolveVideoAbs } from '../paths';
import { ensureProject, normalizeContent, parseSubtitle, readProject, scanProjects, writeContent, writeProject } from '../store';

// 本域的 IPC 注册入口：register.ts 按固定顺序调用它（每个频道只注册一次）。
export function registerProjectIpc(ctx: RegisterCtx): void {
  const getWindow = ctx.getWindow;

  ipcMain.handle(IPC.Project.List, () => scanProjects());

  // 新建“我的项目”：名字校验 + 写 project.json（目录在写入时创建）
  ipcMain.handle(IPC.Project.Create, (_event, name?: string) => {
    const n = String(name || '').trim();
    if (!n) return { ok: false, message: '项目名不能为空' };
    if (/[\\/:*?"<>|]/.test(n)) return { ok: false, message: '项目名含非法字符（\\ / : * ? " < > |）' };
    if (readProject(n)) return { ok: false, message: '项目「' + n + '」已存在' };
    const proj = ensureProject(n);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  ipcMain.handle(IPC.Project.Load, (_event, name?: string) => {
    if (!name) return null;
    // ensureProject 会把索引与两个正文文件拼成完整 Project —— 渲染层契约不变
    const proj = ensureProject(name);
    // 素材列表按当前盘上数据规范化后再交给渲染层（脏数据/越权路径在这里就被清掉，界面不必再校验一遍）；
    // videoPath 一并换算成**绝对路径**（视频预览页要拿它 play、要"在文件夹中显示"）。
    return {
      ...proj,
      videoPath: resolveVideoAbs(name, proj.videoPath),
      materials: normalizeMaterials(proj.materials)
    };
  });

  // 保存字幕到当前项目
  ipcMain.handle(IPC.Project.SaveSubtitle, (_event, payload?: ProjectSaveSubtitlePayload) => {
    const name = payload && payload.name;
    const subtitle = payload && typeof payload.subtitle === 'string' ? payload.subtitle : '';
    const title = payload && typeof payload.title === 'string' ? payload.title : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    const dir = projectDir(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'subtitle.txt'), subtitle, 'utf8');
    const proj = ensureProject(name);
    proj.subtitle = subtitle;
    if (title) proj.title = title;
    proj.subtitleCount = parseSubtitle(subtitle).length;
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 整体保存内容脚本（style + scenes）到当前项目：正文写 content.json，project.json 只更新时间戳
  ipcMain.handle(IPC.Project.SaveContent, (_event, payload?: ProjectSaveContentPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const content = normalizeContent(payload && payload.content);
    const proj = ensureProject(name);
    proj.content = content;
    writeContent(name, content);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 导出字幕为 .srt 文件（含时间轴，供外部播放器/剪辑软件使用）
  ipcMain.handle(IPC.Project.ExportSrt, (_event, payload?: ProjectExportSrtPayload) => {
    const name = payload && payload.name;
    const srt = payload && typeof payload.srt === 'string' ? payload.srt : '';
    if (!String(srt).trim()) return { ok: false, message: 'SRT 内容为空' };
    const win = getWindow();
    const save = win ? dialog.showSaveDialogSync(win, {
      title: '导出 SRT 字幕',
      defaultPath: (name || 'subtitle') + '.srt',
      filters: [{ name: 'SRT 字幕文件', extensions: ['srt'] }]
    }) : undefined;
    if (!save) return { ok: false, canceled: true };
    fs.writeFileSync(save, srt, 'utf8');
    return { ok: true, savedPath: save };
  });

  // 打开项目所在目录
  ipcMain.handle(IPC.Project.OpenFolder, async (_event, name?: string) => {
    const dir = projectDir(String(name || ''));
    if (!fs.existsSync(dir)) return { ok: false, message: '项目目录不存在（项目尚未保存）' };
    // shell.openPath 返回 Promise<string>：成功为空串，失败为错误信息，必须 await
    const r = await shell.openPath(dir);
    return { ok: r === '' ? true : false, message: r ? ('打开失败：' + r) : '' };
  });

  // 打开指定文件所在目录 / 指定目录（配音、对齐、音色等页面的「打开目录」入口）
  ipcMain.handle(IPC.Project.OpenFolderOf, (_event, p?: string) => {
    if (!p || typeof p !== 'string') return { ok: false, message: '参数缺失' };
    let dir = p;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) dir = path.dirname(p);
    } catch (e) { /* ignore */ }
    if (dir && fs.existsSync(dir)) {
      shell.openPath(dir);
      return { ok: true, dir };
    }
    return { ok: false, message: '目录不存在' };
  });

  // 删除“我的项目”（慎重：仅限 userData 下的项目目录）
  ipcMain.handle(IPC.Project.Delete, (_event, name?: string) => {
    const dir = projectDir(String(name || ''));
    if (!name || !dir.startsWith(projectsRoot())) return { ok: false, message: '非法项目名' };
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { ok: true };
  });
}
