// src/main/video.ts
// 预览 / HyperFrames 转视频（内置项目列表 + 自定义 HTML 渲染）
// 提供：dialog:open-html / video:list-projects / video:preview-shell /
//       video:show-in-folder / video:render（含 video:progress 推送）
// 依赖：hfEnv(BUILTIN_RESOURCES / findHyperframesCli / findNode / findFfmpegBin /
//       isHyperframesComposition) / dialog / shell
import { app, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import * as hfEnv from './hfEnv'
import { IPC } from '../shared/ipc'
import type { RegisterCtx } from '../shared/types'

interface RenderPayload {
  htmlPath?: string
}
interface PreviewShellPayload {
  htmlPath?: string
}
type RenderResult = { ok: true; outputVideo: string; projectDir: string } | { ok: false; message: string; compatible?: boolean }

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

  // 扫描内置视频项目（项目根 video-projects 下含 index.html 的子目录）
  // 注：内置项目根以 app.getAppPath() 为基准（dev=项目根，打包后=app.asar 根，均命中）
  ipcMain.handle(IPC.Video.ListProjects, () => {
    const root = path.join(app.getAppPath(), 'video-projects');
    if (!fs.existsSync(root)) return [];
    const list: { name: string; html: string }[] = [];
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const html = path.join(root, d.name, 'index.html');
      if (fs.existsSync(html)) list.push({ name: d.name, html });
    }
    return list;
  });

  // 生成（复用）"预览外壳"页面：位于目标 HTML 同目录，经本地 hyperframes-player 组件加载
  // composition，提供播放条（controls）与等比缩放，修复"预览只显示一部分/无进度条"问题。
  ipcMain.handle(IPC.Video.PreviewShell, (_event, payload?: PreviewShellPayload) => {
    const htmlPath = payload && payload.htmlPath;
    if (!htmlPath || typeof htmlPath !== 'string' || !fs.existsSync(htmlPath)) {
      return { ok: false, message: 'HTML 文件不存在' };
    }
    const dir = path.dirname(htmlPath);
    const shellPath = path.join(dir, '_hf_preview_shell.html');
    try {
      if (!fs.existsSync(shellPath)) {
        let playerTag = '';
        const localPlayer = hfEnv.BUILTIN_RESOURCES.hivePlayer;
        if (localPlayer && fs.existsSync(localPlayer)) {
          playerTag = '<script src="' + pathToFileURL(localPlayer).href + '"></script>';
        } else {
          playerTag = '<script type="module" src="https://cdn.jsdelivr.net/npm/@hyperframes/player@latest"></script>';
        }
        const html =
          '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>HyperFrames Preview</title>\n' +
          '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}</style>\n' +
          playerTag + '\n</head>\n<body>\n' +
          '<hyperframes-player id="p" controls autoplay muted preload style="display:block;width:100vw;height:100vh"></hyperframes-player>\n' +
          '<script>document.getElementById("p").setAttribute("src", "./' + path.basename(htmlPath) + '");</script>\n' +
          '</body>\n</html>\n';
        fs.writeFileSync(shellPath, html, 'utf8');
      }
      return { ok: true, shellPath };
    } catch (e) {
      return { ok: false, message: (e as Error) && (e as Error).message ? (e as Error).message : String(e) };
    }
  });

  // 在资源管理器中定位视频文件
  ipcMain.handle(IPC.Video.ShowInFolder, (_event, filePath?: string) => {
    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle(IPC.Video.Render, (event, payload?: RenderPayload) => {
    return new Promise<RenderResult>((resolve) => {
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

      const child = spawn(nodeCmd, [hfCli, 'render', '-o', outMp4], {
        cwd: projDir,
        env
      });

      let finished = false;
      const done = (res: RenderResult) => {
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
