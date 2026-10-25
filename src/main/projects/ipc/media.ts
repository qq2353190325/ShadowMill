// src/main/projects/ipc/media.ts
// project:* 的素材 / 音频 / 视频类频道：素材增删改、背景音频选定与提取、成品视频回写、渲染档位与画布。

import type { RegisterCtx } from '../../../shared/types';
import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { IMAGE_MATERIAL_EXTS, MAX_MATERIALS, RENDER_CANVASES, VIDEO_MATERIAL_EXTS } from '../../../shared/constants';
import * as hfEnv from '../../hfEnv';
import * as runtime from '../../runtime';
import { pickRenderOverride } from '../../settings';
import { IPC } from '../../../shared/ipc';
import type { Project, ProjectAddMaterialsPayload, ProjectMaterial, ProjectMaterialKind, ProjectNamePayload, ProjectPickMediaPayload, ProjectSaveMaterialsPayload, ProjectSetAudioPayload, ProjectSetCanvasPayload, ProjectSetRenderPayload, ProjectSetVideoPayload, RenderCanvas, RuntimePackName } from '../../../shared/types';
import { applyBgmToHtml } from '../bgm';
import { copyMaterialIntoProject, materialExtsText, materialKindOf, newMaterialId, normalizeMaterials } from '../materials';
import { projectDir } from '../paths';
import { copyAudioIntoProject, ensureProject, writeProject } from '../store';

// 提取视频音轨要哪几包（分包后 ffmpeg 不再随安装包，缺了就由界面问用户是否下载）
export const FFMPEG_PACKS: RuntimePackName[] = ['ffmpeg']

// 本域的 IPC 注册入口：register.ts 按固定顺序调用它（每个频道只注册一次）。
export function registerMediaIpc(ctx: RegisterCtx): void {
  const getWindow = ctx.getWindow;

  // 视频渲染完成后，把产物路径回写进项目（供链路状态条点亮“视频”节点）
  // 存**项目内相对路径**（成品就生成在 <项目目录>/video/output.mp4，见 video.ts 的就地渲染）；
  // 老调用方仍可能传绝对路径，落在项目目录内就换算成相对，项目外的才原样存（见 resolveVideoAbs 的说明）。
  ipcMain.handle(IPC.Project.SaveVideo, (_event, payload?: ProjectSetVideoPayload) => {
    const name = payload && payload.name;
    const videoPath = payload && payload.videoPath;
    if (!name || !videoPath) return { ok: false, message: '参数缺失' };
    const proj = ensureProject(name);
    const dir = projectDir(name);
    const abs = path.resolve(String(videoPath));
    proj.videoPath = abs === dir || abs.startsWith(dir + path.sep)
      ? path.relative(dir, abs).replace(/\\/g, '/')
      : String(videoPath);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 视频渲染档位的项目级覆盖（普通用户两项：质量 + 帧率）
  // render 传 null 或字段全非法 → 清除覆盖、回到跟随全局默认（settings.json 的 render）
  ipcMain.handle(IPC.Project.SetRender, (_event, payload?: ProjectSetRenderPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const override = (payload && payload.render === null) ? {} : pickRenderOverride(payload && payload.render);
    if (Object.keys(override).length) proj.render = override;
    else delete proj.render;
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 成片画布方向（**项目属性，不是渲染档位**：不进 settings.json、没有全局默认那一层）。
  // 取值白名单来自 shared/constants 的 RENDER_CANVASES（与 HyperFrames 的画布预设对齐）；非法/缺省一律忽略。
  // 画布一变，已渲好的成片尺寸就不再匹配 ⇒ 与「HTML 改动」同样把 videoPath 置空（避免旧成片被当成当前产物）。
  ipcMain.handle(IPC.Project.SetCanvas, (_event, payload?: ProjectSetCanvasPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const canvas = payload && payload.canvas;
    if (RENDER_CANVASES.indexOf(canvas as RenderCanvas) < 0) return { ok: false, message: '画布取值非法' };
    const proj = ensureProject(name);
    const next = canvas as RenderCanvas;
    if (proj.canvas !== next) {
      proj.canvas = next;
      if (proj.videoPath) proj.videoPath = '';
    }
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // ===== 项目音频：让生成的 HTML 视频有声音 =====
  ipcMain.handle(IPC.Project.PickAudio, async () => {
    const win = getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择音频文件（将复制进项目，随视频一起渲染）',
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 把音频复制进项目目录 audio/ 并记录相对引用
  ipcMain.handle(IPC.Project.SetAudio, (_event, payload?: ProjectSetAudioPayload) => {
    const name = payload && payload.name;
    const audioPath = payload && payload.audioPath;
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在' };
    const audioFile = copyAudioIntoProject(name, audioPath);
    if (!audioFile) return { ok: false, message: '音频复制到项目失败' };
    const proj = ensureProject(name);
    proj.audioFile = audioFile;
    writeProject(proj);
    // 音频一变，立刻重写 HTML 音轨：预览即刻可听，转视频也一定带上
    const htmlUpdated = applyBgmToHtml(name, proj);
    return { ok: true, audioFile: proj.audioFile, htmlUpdated };
  });

  // 移除当前项目音频引用（保留音频文件，避免误删资源）
  ipcMain.handle(IPC.Project.ClearAudio, (_event, payload?: ProjectNamePayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    proj.audioFile = '';
    writeProject(proj);
    // 移除音轨：把 HTML 里注入的 <audio> 一并摘掉（否则成片仍有声，与项目状态不符）
    const htmlUpdated = applyBgmToHtml(name, proj);
    return { ok: true, htmlUpdated };
  });

  // ===== 项目素材库：图片 / 视频（HTML 生成用；替代原来的「单个视频素材」） =====
  // 一个文件框按 kind 给不同扩展名过滤；图片允许多选（一屏素材一次加完），视频单选（单文件常很大）
  ipcMain.handle(IPC.Project.PickMedia, async (_event, payload?: ProjectPickMediaPayload) => {
    const win = getWindow();
    if (!win) return [];
    const kind: ProjectMaterialKind = (payload && payload.kind === 'image') ? 'image' : 'video';
    const exts = kind === 'image' ? [...IMAGE_MATERIAL_EXTS] : [...VIDEO_MATERIAL_EXTS];
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'image'
        ? '选择图片素材（将复制进项目，作为页面素材嵌入 HTML）'
        : '选择视频素材（将复制进项目，作为页面素材嵌入 HTML）',
      filters: [{ name: kind === 'image' ? '图片文件' : '视频文件', extensions: exts }],
      properties: kind === 'image' ? ['openFile', 'multiSelections'] : ['openFile']
    });
    if (r.canceled) return [];
    return r.filePaths || [];
  });

  // 把用户选中的外部文件复制进项目素材目录并登记（新素材默认参与生成；到上限或格式不支持则跳过并如实回报）
  ipcMain.handle(IPC.Project.AddMaterials, (_event, payload?: ProjectAddMaterialsPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const paths = (payload && Array.isArray(payload.paths) ? payload.paths : []).filter((p) => typeof p === 'string' && p);
    if (!paths.length) return { ok: false, message: '没有选择文件' };
    const proj = ensureProject(name);
    const list = normalizeMaterials(proj.materials);
    const added: ProjectMaterial[] = [];
    let skipped = 0;
    for (const p of paths) {
      if (list.length + added.length >= MAX_MATERIALS) { skipped++; continue; }
      const kind = materialKindOf(p);
      if (!kind) { skipped++; continue; }
      const file = copyMaterialIntoProject(name, kind, p);
      if (!file) { skipped++; continue; }
      added.push({ id: newMaterialId(), kind, file, label: path.basename(p), selected: true, addedAt: new Date().toISOString() });
    }
    if (!added.length) {
      return { ok: false, message: '没有可添加的素材：仅支持 ' + materialExtsText() + '，且上限 ' + MAX_MATERIALS + ' 个' };
    }
    proj.materials = [...list, ...added];
    writeProject(proj);
    return {
      ok: true,
      materials: proj.materials,
      message: skipped ? '已添加 ' + added.length + ' 个素材，跳过 ' + skipped + ' 个（格式不支持或已达上限 ' + MAX_MATERIALS + ' 个）' : undefined
    };
  });

  // 整份素材列表回写：**移除与勾选都走这条**（渲染层持完整列表，主进程只做规范化后落盘）。
  // 移除素材只摘登记、**不删项目内的文件**（与原来的 clear-video 语义一致，避免误删资源）。
  ipcMain.handle(IPC.Project.SaveMaterials, (_event, payload?: ProjectSaveMaterialsPayload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    proj.materials = normalizeMaterials(payload && payload.materials);
    writeProject(proj);
    return { ok: true, materials: proj.materials };
  });

  // 从项目视频素材提取原声音轨 → audio/ 下 .m4a（AAC 192k，同名前缀），设为背景音频
  // 注意：素材改为多图/多视频素材库之后，本 handler 的**界面入口已临时注释下线**（原按钮在「HTML生成」页的
  // 视频素材行；多视频下「提哪一条」需要按素材 id 重做，见 MaterialsSection.vue 里的注释块）。
  // 本轮按用户要求「IPC 与 handler 原样保留」，因此它仍读历史字段 project.videoMaterial；恢复入口前先重做这一步。
  ipcMain.handle(IPC.Project.ExtractVideoAudio, async (_event, name?: string) => {
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    const videoRef = proj.videoMaterial || '';
    if (!videoRef) return { ok: false, message: '该项目没有视频素材：请先在「HTML生成」页的「视频素材」里选「选择本地视频文件…」导入' };
    const videoPath = path.join(projectDir(name), videoRef);
    if (!fs.existsSync(videoPath)) return { ok: false, message: '视频素材文件不存在：' + videoRef };
    // 分包之后运行环境不再随安装包：提取音轨要 ffmpeg 包。纯校验（不下载），缺包交给界面问用户
    const lack = runtime.missingPacks(FFMPEG_PACKS);
    if (lack.length) {
      return { ok: false, needPacks: lack, message: '提取视频音轨需要先下载运行环境（' + runtime.packSizeText(lack) + '）' };
    }
    const ffmpeg = hfEnv.BUILTIN_RESOURCES.ffmpeg;
    if (!ffmpeg || !fs.existsSync(ffmpeg)) return { ok: false, message: '未找到 ffmpeg（运行环境包可能损坏，可在设置页重新下载）' };
    const stem = path.basename(videoPath).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    const outName = stem + '.m4a';
    const audioDir = path.join(projectDir(name), 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const outPath = path.join(audioDir, outName);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', outPath], { windowsHide: true });
        child.on('error', (err) => reject(new Error('无法启动 ffmpeg：' + err.message)));
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('提取失败（ffmpeg 退出码 ' + code + '）'))));
      });
    } catch (e) {
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (e2) { /* ignore */ }
      return { ok: false, message: String(((e as Error) && (e as Error).message) || e) };
    }
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      try { fs.unlinkSync(outPath); } catch (e) { /* ignore */ }
      return { ok: false, message: '提取失败：输出音频为空（该视频可能没有音轨）' };
    }
    proj.audioFile = 'audio/' + outName;
    writeProject(proj);
    // 提取出的原声同样立刻注入 HTML（保留原声路线）
    const htmlUpdated = applyBgmToHtml(name, proj);
    return { ok: true, audioFile: proj.audioFile, htmlUpdated };
  });
}
