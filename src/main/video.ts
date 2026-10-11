// src/main/video.ts
// 预览 / HyperFrames 转视频（自定义 HTML 渲染）
// 提供：dialog:open-html / video:show-in-folder / video:render（含 video:progress 推送）
// 依赖：hfEnv(BUILTIN_RESOURCES / findHyperframesCli / findNode / findFfmpegBin /
//       isHyperframesComposition) / settings(渲染档位白名单) / dialog / shell
import { app, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import * as hfEnv from './hfEnv'
import { pickRenderOverride } from './settings'
import { IPC } from '../shared/ipc'
import type {
  RegisterCtx,
  VideoRenderPayload,
  VideoRenderResult
} from '../shared/types'

// 载荷与结果类型统一取自 shared/types.ts（⑦ 节），此处不再重复声明：
// RenderPayload / PreviewShellPayload / RenderResult（见 VideoRenderPayload / VideoPreviewShellPayload / VideoRenderResult）
// 渲染档位（质量 / 帧率）也在 VideoRenderPayload 内：只接受白名单内的显式值，缺省不传参数、走 CLI 默认（standard / 30）

function register(ctx?: RegisterCtx): void {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

  ipcMain.handle(IPC.Video.OpenHtml, async () => {
    const win = getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择要预览的 HTML 文件',
      filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 在资源管理器中定位视频文件
  ipcMain.handle(IPC.Video.ShowInFolder, (_event, filePath?: string) => {
    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle(IPC.Video.Render, (event, payload?: VideoRenderPayload) => {
    return new Promise<VideoRenderResult>((resolve) => {
      const htmlPath = payload && payload.htmlPath;
      if (!htmlPath || !fs.existsSync(htmlPath)) {
        resolve({ ok: false, message: 'HTML 文件不存在' });
        return;
      }

      const raw = fs.readFileSync(htmlPath, 'utf8');
      if (!hfEnv.isHyperframesComposition(raw)) {
        resolve({
          ok: false,
          compatible: false,
          message: '该 HTML 不是 HyperFrames 规范的 composition（缺少 data-composition-id / GSAP __timelines 结构）。' +
            '建议先用 HyperFrames 引导生成合规模板，再替换为自己的 HTML 内容。'
        });
        return;
      }

      const hfCli = hfEnv.findHyperframesCli();
      if (!hfCli) {
        resolve({ ok: false, message: '未找到 hyperframes CLI（hyperframes.mjs）。可设置环境变量 HYPERFRAMES_CLI 指向其路径。' });
        return;
      }
      const nodeCmd = hfEnv.findNode();
      if (!nodeCmd) {
        resolve({ ok: false, message: '未找到系统 Node.js（HyperFrames 要求 >= 22）' });
        return;
      }

      // 搭建临时项目目录并放入目标 HTML
      // 若 HTML 所在目录带有配套资源（audio/ 等），整体复制，保证音频能随 HTML 一起渲染
      const projDir = path.join(app.getPath('userData'), 'hf-projects', 'html-video-' + Date.now());
      fs.mkdirSync(projDir, { recursive: true });
      const srcDir = path.dirname(htmlPath);
      try {
        const siblings = fs.readdirSync(srcDir);
        const hasAssets = siblings.some((f) => f !== 'index.html' && f !== 'output.mp4');
        if (hasAssets) {
          fs.cpSync(srcDir, projDir, { recursive: true });
        } else {
          fs.copyFileSync(htmlPath, path.join(projDir, 'index.html'));
        }
      } catch (e) {
        resolve({ ok: false, message: '复制 HTML 失败：' + ((e as Error).message || String(e)) });
        return;
      }

      // GSAP 本地化（仅改渲染副本，不动用户原件）：老项目 HTML 仍引 CDN 时，离线渲染会因 gsap 未定义而失败。
      // 有随包 gsap.min.js 时把副本里的 CDN 引用改写为 ./gsap.min.js 并把文件放进渲染目录。
      try {
        const copyHtml = path.join(projDir, 'index.html');
        if (fs.existsSync(copyHtml)) {
          const localized = hfEnv.localizeGsapHtml(fs.readFileSync(copyHtml, 'utf8'));
          fs.writeFileSync(copyHtml, localized, 'utf8');
          if (hfEnv.referencesLocalGsap(localized)) hfEnv.copyGsapIntoProject(projDir);
        }
      } catch (e) { /* 本地化失败不阻断渲染：在线时仍可由 CDN 加载 */ }

      const outMp4 = path.join(projDir, 'output.mp4');

      const env: Record<string, string | undefined> = { ...process.env };
      const ffBin = hfEnv.findFfmpegBin();
      if (ffBin) env.PATH = ffBin + path.delimiter + (env.PATH || '');
      // 内置 ffmpeg/ffprobe 路径显式注入，避免依赖系统 PATH（HYPERFRAMES_* 为可选）
      if (fs.existsSync(hfEnv.BUILTIN_RESOURCES.ffmpeg)) env.HYPERFRAMES_FFMPEG_PATH = hfEnv.BUILTIN_RESOURCES.ffmpeg;
      if (fs.existsSync(hfEnv.BUILTIN_RESOURCES.ffprobe)) env.HYPERFRAMES_FFPROBE_PATH = hfEnv.BUILTIN_RESOURCES.ffprobe;
      // 内置 Chrome headless-shell（避免渲染时去 .cache 重新下载）
      if (hfEnv.BUILTIN_RESOURCES.chromeShell) {
        env.PRODUCER_HEADLESS_SHELL_PATH = hfEnv.BUILTIN_RESOURCES.chromeShell;
      }

      // 渲染档位：只把载荷里显式给出的合法值拼进 CLI 参数（缺省交给 CLI 自己的默认 standard / 30）
      const renderArgs = [hfCli, 'render', '-o', outMp4];
      const renderOpts = pickRenderOverride(payload);
      if (renderOpts.quality) renderArgs.push('--quality', renderOpts.quality);
      if (renderOpts.fps) renderArgs.push('--fps', String(renderOpts.fps));

      const child = spawn(nodeCmd, renderArgs, {
        cwd: projDir,
        env
      });

      let finished = false;
      const done = (res: VideoRenderResult) => {
        if (finished) return;
        finished = true;
        resolve(res);
      };

      child.stdout.on('data', (d: Buffer) => {
        const text = d.toString();
        event.sender.send(IPC.Video.Progress, { text });
      });
      child.stderr.on('data', (d: Buffer) => {
        const text = d.toString();
        event.sender.send(IPC.Video.Progress, { text });
      });
      child.on('error', (err) => done({ ok: false, message: '启动渲染失败：' + err.message + '（node: ' + (nodeCmd || 'null') + '）' }));
      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outMp4)) {
          done({ ok: true, outputVideo: outMp4, projectDir: projDir });
        } else {
          done({ ok: false, message: '渲染失败（exit=' + code + '）' });
        }
      });
    });
  });
}

export {
  register
};
