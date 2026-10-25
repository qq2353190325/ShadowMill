// src/main/projects/ipc/html.ts
// project:* 的 HTML 类频道：生成、按需求修改、下载、读取、预览副本、手写保存。
// 生成与修改是两条不同的 Agent 契约（agent/html.ts 与 agent/htmlEdit.ts），见各分支注释。

import type { RegisterCtx } from '../../../shared/types';
import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { chatWithCustomModel, chatWithChapterPlan, chatWithHtmlEdit } from '../../agent';
import { configTargetOf } from '../../../shared/errors';
import { RENDER_CANVASES } from '../../../shared/constants';
import * as chapters from '../../chapters';
import * as cast from '../../cast';
import * as coreLib from '../../coreLib';
import * as hfEnv from '../../hfEnv';
import { IPC } from '../../../shared/ipc';
import type { Project, ProjectAgentPayload, ProjectSaveHtmlPayload, RenderCanvas } from '../../../shared/types';
import { applyBgmToHtml, insertHtmlSnippet } from '../bgm';
import { applyChapterEdit, generateByChapters } from '../chaptersFlow';
import { syncCoreLib, writeSingleHtml } from '../htmlWrite';
import { projectDir, projectFilePath } from '../paths';
import { HG_PREVIEW_CTRL } from '../previewScript';
import { progressSender, pushStatus } from '../progress';
import { buildMaterialPrompt, buildPlanPrompt, resolveMaterials, validSceneList } from '../prompts';
import { ensureProject, parseSubtitle, writeProject } from '../store';

// 本域的 IPC 注册入口：register.ts 按固定顺序调用它（每个频道只注册一次）。
export function registerHtmlIpc(ctx: RegisterCtx): void {
  const getWindow = ctx.getWindow;

  // ===== HTML 生成/修改：由 Agent 接口实现（应用侧不内置模板） =====
  // 生成分两步：① 规划调用判「单文件还是拆章」② 按结果走单文件（一次写整份 HTML）或章节模式（逐章写 pages/cNN.js）。
  // 规划失败不拦路：解析不出来就按单文件继续（老路径完全没变），只是少了章节化这一档。
  ipcMain.handle(IPC.Project.GenerateHtml, async (event, payload?: ProjectAgentPayload) => {
    const name = payload && payload.name as string;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };
    // 进度按 taskId 分发（见 preload 的 onTaskProgress）：缺了就无法回传进度，且这说明调用方写错了，
    // 直接拒绝比"进度静默丢失"好排查。
    const taskId = payload && typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return { ok: false, message: '内部错误：缺少任务 id（进度无法回传），请刷新页面后重试' };

    const proj = ensureProject(name);
    const mats = resolveMaterials(proj, payload || {});
    const userPrompt = buildMaterialPrompt('用户需求：' + prompt.trim(), proj, mats, []);
    const sub = mats.subtitleText ? parseSubtitle(mats.subtitleText) : [];

    try {
      const onProgress = progressSender(event, { taskId });
      pushStatus(event, '正在判断整片结构（单文件 / 章节化）…', { taskId });
      const planReply = await chatWithChapterPlan(buildPlanPrompt(prompt.trim(), proj, sub), {
        onProgress,
        meta: { project: name, action: 'plan' }
      });
      const parsed = chapters.parsePlanReply(planReply, validSceneList(proj.content).length);
      if (parsed.plan && parsed.plan.mode === 'chapters') {
        // 角色不在规划结果里：角色只有全局一份（「角色」页管），这里只取「本片勾选」的那几个，
        // 交给骨架引入它们的项目副本（<项目>/cast/，由 syncProjectCast 从库同步）。
        return await generateByChapters({
          event,
          name,
          taskId,
          proj,
          requirement: prompt.trim(),
          list: parsed.plan.chapters,
          castList: cast.selectedMembers(proj.cast),
          mats
        });
      }
      // 规划判定为单文件 / 规划解析失败：都走老的「一次生成整份 HTML」
      if (parsed.error) pushStatus(event, '章节规划未能解析（' + parsed.error + '），改用单文件模式生成…', { taskId });
      // 单文件模式同样要带角色：提示词里给出角色清单，落盘时注入 script（与章节化无关）
      const selected = cast.selectedMembers(proj.cast);
      const singlePrompt = selected.length
        ? userPrompt + '\n【项目角色】下面这些角色**已经注入页面**（window.__cast 里就有），必须用它们画、不许重画：\n'
          + cast.castOutlineText(selected)
          + '\n调用方式：window.__cast["' + selected[0].id + '"](x, y, u, { ctx: ctx2d, … })——(x, y) 是脚底中点，u 是 1 个单位的像素数。'
          + '\n**光传 ctx，角色就是一张不会动的立绘**：它读的是 o 里的动画参数（o.walk 摆腿相位 / o.aL、o.aR 摆臂角度 /'
          + ' o.eyes、o.mouth 表情 / o.blink 眨眼 / o.dy、o.dx 位移 / o.rot 旋转 / o.sq 挤压）。出镜期间按你的 t 算出细微动态'
          + '（呼吸 + 眨眼就够），有表演时再叠摆臂、走路与表情；**参数必须由 t 直接算**（draw(t) 是纯函数，seek 后要能重现），'
          + '不要 tween 一个外部对象再读它的值。确实要静止的镜头（定格、纯背景人物）只传 ctx 也行——那是**有意的静止**。'
          + '\n【分层要求】角色画在**独立的透明 canvas** 上（铺满舞台、叠在 <video> / <img> / DOM 之上），'
          + '可以直接用助手建层：var layer = MC.castLayer(stage, 宽, 高)；每帧先 MC.clearLayer(layer.ctx) 再画角色。'
          + '**禁止在这张画布上填整屏底色**——那会把视频/图片背景整块盖住。'
          + '只有整页都由代码画（下面没有任何素材）时，角色才可以画进主画布。角色没列出的不要调用。'
        : '';
      const reply = await chatWithCustomModel(singlePrompt || userPrompt, { onProgress, meta: { project: name, action: 'generate' } });
      const wrote = writeSingleHtml({ name, proj, reply });
      return wrote.ok
        ? { ok: true, htmlPath: wrote.htmlPath, compatible: wrote.compatible, message: 'HTML 已生成' + (wrote.message || '') }
        : wrote;
    } catch (e) {
      // chatWithCustomModel 抛出的已是人话文案；这里只补一次分类，把「配置类」标记带给界面（弹「去设置」）
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 修改：基于现有 HTML，由 Agent 按需求改造后覆盖
  ipcMain.handle(IPC.Project.ModifyHtml, async (event, payload?: ProjectAgentPayload) => {
    const name = payload && payload.name as string;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };
    // 进度按 taskId 分发（与 GenerateHtml 同一约定：缺 id 直接拒绝，不静默丢进度）
    const taskId = payload && typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return { ok: false, message: '内部错误：缺少任务 id（进度无法回传），请刷新页面后重试' };

    const htmlPath = projectFilePath(name, 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML，请先生成' };

    const proj = ensureProject(name);
    const mats = resolveMaterials(proj, payload || {});
    const onProgress = progressSender(event, { taskId });

    try {
      // ===== 章节模式：两段式改稿（路由 → 定向编辑），见 applyChapterEdit 的注释 =====
      // 不用再发 index.html：骨架由应用生成，模型改它没有意义（也不会被采用）。
      if (proj.chapters && proj.chapters.length) {
        return await applyChapterEdit({ event, name, taskId, proj, requirement: prompt.trim(), mats, onProgress });
      }
      // ===== 单文件模式：只改页面，**角色不归改稿管** =====
      // 角色只有全局一份（<userData>/cast-library/），新建与改画法都在「角色」页做（cast:create / cast:recreate）；
      // 这里只把角色表发给模型（让它知道页面里有哪些 window.__cast 可以调用、不许重画），
      // 不收、也不写任何角色文件块 —— 用户明确要求"HTML 那边不允许新增和修改角色"。
      const curHtml = fs.readFileSync(htmlPath, 'utf8');
      const allCast = proj.cast || [];
      // forModify=true：画布块多带一条「旧页面版式与新画布不一致就必须重排」的硬要求
      const userPrompt = buildMaterialPrompt(
        '用户需求（在此基础上改造页面）：' + prompt.trim(),
        proj,
        mats,
        ['当前项目的 index.html 源码如下：', '```html', curHtml, '```', ''],
        true
      ) + cast.buildCastTableBlock(allCast);
      const reply = await chatWithHtmlEdit(userPrompt, { onProgress, meta: { project: name, action: 'modify' } });
      // 剥掉万一冒出来的角色文件块与残留 FILE 标记，再判有没有 HTML、再抽 HTML；
      // 否则那些标记会原样落进 index.html，变成页面上的可见文字（纯字符串处理在 cast/edit.ts 里）。
      const htmlReply = cast.stripCastFileBlocks(reply);
      if (!/<!DOCTYPE\s+html|<html[\s>]/i.test(htmlReply)) {
        return { ok: false, message: '模型的回复里没有可用的 HTML，请把要求写得更具体后重试' };
      }
      const wrote = writeSingleHtml({ name, proj, reply: htmlReply });
      return wrote.ok
        ? { ok: true, htmlPath: wrote.htmlPath, compatible: wrote.compatible, message: 'HTML 已修改' + (wrote.message || '') }
        : wrote;
    } catch (e) {
      // Agent 调用抛出的已是人话文案；这里只补一次分类，把「配置类」标记带给界面（弹「去设置」）
      const msg = 'Agent 调用失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e));
      return { ok: false, message: msg, ...configTargetOf(msg) };
    }
  });

  // 下载项目 HTML 到本地（导出入口）
  ipcMain.handle(IPC.Project.DownloadHtml, (_event, name?: string) => {
    const htmlPath = projectFilePath(String(name || ''), 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    const win = getWindow();
    const save = win ? dialog.showSaveDialogSync(win, {
      title: '导出 HTML',
      defaultPath: (name || 'project') + '.html',
      filters: [{ name: 'HTML 文件', extensions: ['html'] }]
    }) : undefined;
    if (!save) return { ok: false, canceled: true };
    // 导出的是「单个 HTML 文件」，要处理两件事，否则导出后在别处打开就是空白页：
    // ① 章节模式：把 <script src="./pages/cNN.js"> 与 <script src="./cast/x.js"> 换成内联脚本
    //    （导出的文件旁边没有 pages/ 与 cast/ 目录）；
    // ② 随包库：把 ./gsap.min.js / ./p5.min.js 换回固定版本 CDN 地址（旁边没有这些文件）。
    let html = fs.readFileSync(htmlPath, 'utf8');
    const proj = ensureProject(String(name || ''));
    const dir = path.dirname(htmlPath);
    // 角色与助手与"拆不拆章"无关：两种形态都要内联，否则导出的单文件在别处打开就没有 window.__cast / MC。
    const sources: { path: string; code: string }[] = [];
    if (proj.chapters && proj.chapters.length) {
      for (const c of chapters.readChapterCode(dir, proj.chapters)) sources.push({ path: chapters.chapterRelPath(c.id), code: c.code });
    }
    for (const m of cast.readCastCode(dir, proj.cast || [])) sources.push({ path: cast.castRelPath(m.id), code: m.code });
    if (!(proj.chapters && proj.chapters.length)) syncCoreLib(dir);   // 单文件模式导出前补一次助手文件
    const coreCode = coreLib.readProjectCore(dir);
    if (coreCode) sources.push({ path: coreLib.CORE_FILE, code: coreCode });
    html = chapters.inlineChapters(html, sources);
    fs.writeFileSync(save, hfEnv.externalizeVendorHtml(html), 'utf8');
    return { ok: true, savedPath: save };
  });

  // 读取项目当前 HTML 源码（供编辑器载入）
  ipcMain.handle(IPC.Project.ReadHtml, (_event, name?: string) => {
    const htmlPath = projectFilePath(String(name || ''), 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    return { ok: true, html: fs.readFileSync(htmlPath, 'utf8') };
  });

  // 预览副本：index.html + 注入播放控制脚本 → 同目录 index.preview.html
  // （与原件同目录保证相对引用素材可用；预览副本仅用于应用内预览，下载/转视频始终用原件）
  ipcMain.handle(IPC.Project.PreviewHtml, (_event, name?: string) => {
    const htmlPath = projectFilePath(String(name || ''), 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    let html = fs.readFileSync(htmlPath, 'utf8');
    // 页面自己声明的画布（<html data-resolution="…">）：渲染层要用它把预览 iframe 设成「页面原生尺寸」，
    // 再整体缩进当前视角里看（等比 contain + 黑边），这样横屏页面放进方形视口时右边不会被裁。
    // 只认白名单取值；缺失 / 非法一律 ''，由渲染层回落成「按项目当前画布显示」。
    const declared = /<html[^>]*\sdata-resolution\s*=\s*["']([^"']*)["']/i.exec(html);
    const declaredCanvas = declared ? declared[1].trim() : '';
    const pageCanvas: RenderCanvas | '' = RENDER_CANVASES.indexOf(declaredCanvas as RenderCanvas) >= 0
      ? declaredCanvas as RenderCanvas
      : '';
    // 预览副本去除 CSP 限制（仅副本），保证注入的控制脚本可执行
    html = html.replace(/<meta[^>]*content-security-policy[^>]*>/gi, '');
    // 随包库本地化（仅副本，不动原件）：老项目仍引 CDN 时也能离线预览
    html = hfEnv.localizeVendorHtml(html);
    hfEnv.ensureVendorFiles(path.dirname(htmlPath), html);
    // 章节模式还引了 ./core.js（共享绘制助手）：预览前同样按版本同步一次，
    // 否则应用升级后「旧项目预览仍是老助手、渲染却是新助手」，两边画面不一致
    if (/src=["'](?:\.\/)?core\.js["']/i.test(html)) syncCoreLib(path.dirname(htmlPath));
    const ctrl = '<script>' + HG_PREVIEW_CTRL + '</scr' + 'ipt>';
    // 注入到 </body> 前；模型输出被截断缺 </body> 时落到 </head>（或文档最前）作为独立 script，
    // 否则会拼进未闭合的 <script>，令整段页面脚本 SyntaxError（fitStage/时间轴全失效）
    html = insertHtmlSnippet(html, ctrl);
    const previewPath = htmlPath.replace(/\.html$/i, '.preview.html');
    fs.writeFileSync(previewPath, html, 'utf8');
    return { ok: true, previewPath, pageCanvas };
  });

  // 直接保存（覆盖）项目 HTML 源码，支持"不满意再改"
  ipcMain.handle(IPC.Project.SaveHtml, (_event, payload?: ProjectSaveHtmlPayload) => {
    const name = payload && payload.name;
    const html = payload && typeof payload.html === 'string' ? payload.html : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!String(html).trim()) return { ok: false, message: 'HTML 内容为空' };
    const dir = projectDir(name);
    fs.mkdirSync(dir, { recursive: true });
    // 随包库本地化：手改/粘贴进来仍带 CDN 地址的 HTML 也统一改写为项目内引用（随包缺失则退回 CDN）
    let localHtml = hfEnv.localizeVendorHtml(html);
    if (!hfEnv.ensureVendorFiles(dir, localHtml)) localHtml = hfEnv.externalizeVendorHtml(localHtml);
    const htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(htmlPath, localHtml, 'utf8');
    const proj = ensureProject(name);
    proj.htmlPath = htmlPath;
    // HTML 改动后旧视频不再匹配 → 标记失效
    proj.videoPath = '';
    writeProject(proj);
    // 手改/粘贴进来的 HTML 可能没有音轨：按项目当前背景音频补回（与生成/修改路径同一套规则）
    applyBgmToHtml(name, proj);
    return { ok: true, htmlPath, compatible: hfEnv.isHyperframesComposition(localHtml) };
  });
}
