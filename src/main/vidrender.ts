// src/main/vidrender.ts —— 产品侧「Rust 小内核」渲染后端（双后端里的新路径）
//
// 与 demo（scripts/demo-vidrender.cjs）同构，但吃的是产品已经准备好的
// <projDir>/.render-tmp/entry.html：负责本地资源回退、BGM 路径解析、画布尺寸、
// 进度回调与清理；不注册任何新 IPC，由 video.ts 按设置分流调用。
// 默认后端仍是 hyperframes，本模块只在用户显式切到 vidrender 时进入。
import { BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CANVAS_SIZES } from '../shared/constants'
import type { RenderCanvas, RenderQuality } from '../shared/types'
import { BGM_TAG_ID } from './projects/bgm'
import * as hfEnv from './hfEnv'

export interface VidrenderOptions {
  /** 产品在 .render-tmp/ 下写好的入口 HTML（绝对路径） */
  entryHtml: string
  /** 成片输出路径 */
  output: string
  canvas: RenderCanvas
  fps: number
  quality?: RenderQuality
  audio?: string
  onProgress?: (text: string) => void
}

const CRF: Record<RenderQuality, number> = { draft: 26, standard: 20, high: 18 }

// 入口在 .render-tmp/，但 HTML 里的素材路径按项目根写（HyperFrames 以 cwd 解析）。
// 这里把「在 .render-tmp 下找不到、在项目根能找到」的 src/href 回退成 ../xxx；
// 已经 hoist 过的 vendor 库（../gsap.min.js）与裁剪副本（./media/xxx）保持不动。
function resolveLocalRefs(entryHtml: string): { htmlPath: string; bgmPath: string } {
  const tmpDir = path.dirname(entryHtml)
  const projDir = path.dirname(tmpDir)
  const html = fs.readFileSync(entryHtml, 'utf8')
  const fallback = (ref: string): string => {
    if (/^(?:[a-z]+:|\/\/|#|\.\.\/)/i.test(ref) || path.isAbsolute(ref)) return ref
    if (fs.existsSync(path.join(tmpDir, ref))) return ref
    if (fs.existsSync(path.join(projDir, ref))) return '../' + ref
    return ref
  }
  const rewritten = html.replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi,
    (whole, attr: string, quote: string, ref: string) => `${attr}=${quote}${fallback(ref)}${quote}`)

  let bgmPath = ''
  const bgmRe = new RegExp('<audio\\b[^>]*\\bid=["\']' + BGM_TAG_ID + '["\'][^>]*\\bsrc=["\']([^"\']+)["\']', 'i')
  const m = rewritten.match(bgmRe)
  if (m) {
    const ref = m[1]
    const underTmp = path.join(tmpDir, ref)
    const candidate = fs.existsSync(underTmp) ? underTmp : path.join(projDir, ref)
    if (fs.existsSync(candidate)) bgmPath = candidate
  }

  const htmlPath = path.join(tmpDir, 'entry.vidrender.html')
  fs.writeFileSync(htmlPath, rewritten, 'utf8')
  return { htmlPath, bgmPath }
}

// 第 t 秒的 seek：GSAP 式时间轴 + <video>.currentTime（seeked 确认）+ 双 rAF。
// 与 demo 一致；片中视频不 seek 会一直停首帧。
function seekScript(t: number): string {
  return `(async () => {
    const t = ${t};
    const timelines = window.__timelines || {};
    for (const key of Object.keys(timelines)) {
      const tl = timelines[key];
      if (!tl) continue;
      if (typeof tl.pause === 'function') tl.pause();
      if (typeof tl.time === 'function') tl.time(t);
      else if (typeof tl.seek === 'function') tl.seek(t, false);
    }
    for (const v of Array.from(document.querySelectorAll('video'))) {
      v.pause();
      const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
      const target = Math.max(0, Math.min(t, dur > 0.01 ? dur - 0.001 : t));
      if (Math.abs(v.currentTime - target) > 0.01) {
        await new Promise((resolve) => {
          let settled = false;
          const done = () => { if (!settled) { settled = true; resolve(); } };
          v.addEventListener('seeked', done, { once: true });
          try { v.currentTime = target; } catch (e) { done(); }
          setTimeout(done, 2000);
        });
      }
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`
}

// 等页面里的 <video> 拿到首帧（产品 composition 没有 demo 的 __videoReady 钩子）。
const VIDEO_READY_SCRIPT = `new Promise((resolve) => {
  const vids = Array.from(document.querySelectorAll('video'));
  if (!vids.length) { resolve(true); return; }
  let left = vids.length;
  const done = () => { if (--left <= 0) resolve(true); };
  for (const v of vids) {
    if (v.readyState >= 2) { done(); continue; }
    v.addEventListener('loadeddata', done, { once: true });
    v.addEventListener('error', done, { once: true });
    setTimeout(done, 5000);
  }
})`

function writeAll(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { stream.off('drain', onDrain); stream.off('error', onError) }
    const onDrain = () => { cleanup(); resolve() }
    const onError = (e: Error) => { cleanup(); reject(e) }
    if (stream.write(buf)) { resolve(); return }
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}

export async function renderWithVidrender(opts: VidrenderOptions): Promise<string> {
  const exe = hfEnv.BUILTIN_RESOURCES.vidrenderEncode
  if (!exe) throw new Error('未找到 vidrender-encode：请在设置里下载 Rust 编码内核运行环境包')

  const size = CANVAS_SIZES[opts.canvas]
  const frameSize = size.width * size.height * 4
  const html = fs.readFileSync(opts.entryHtml, 'utf8')
  const durMatch = html.match(/\bdata-(?:hf-)?duration\s*=\s*["']([\d.]+)["']/i)
  const duration = durMatch ? Number(durMatch[1]) : 3
  const total = Math.max(1, Math.round((Number.isFinite(duration) && duration > 0 ? duration : 3) * opts.fps))
  const { htmlPath, bgmPath } = resolveLocalRefs(opts.entryHtml)
  const audio = opts.audio || bgmPath

  const env: NodeJS.ProcessEnv = { ...process.env }
  const ffmpegBin = hfEnv.BUILTIN_RESOURCES.ffmpegBin
  if (ffmpegBin) env.PATH = ffmpegBin + path.delimiter + (env.PATH || '')
  const args = [
    '--width', String(size.width), '--height', String(size.height), '--fps', String(opts.fps),
    '--pix-fmt', 'bgra', '--input-format', 'raw', '--crf', String(CRF[opts.quality || 'standard']),
    '--output', opts.output
  ]
  if (audio) args.push('--audio', audio)

  const win = new BrowserWindow({
    width: size.width, height: size.height, show: false,
    webPreferences: {
      offscreen: true,
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  let child: ChildProcess | null = null
  try {
    await win.loadFile(htmlPath)
    await win.webContents.executeJavaScript(VIDEO_READY_SCRIPT)
    child = spawn(exe, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

    let stderrTail = ''
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      stderrTail = (stderrTail + text).slice(-4000)
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          if (ev.event === 'progress') opts.onProgress?.('[小内核] 编码 ' + ev.frame + '/' + total + ' 帧')
          else if (ev.event === 'error') opts.onProgress?.('[小内核] ' + ev.message)
        } catch (e) { /* ffmpeg 原始行由编码器 stderr 内部处理，这里不刷屏 */ }
      }
    })
    let spawnError: Error | null = null
    child.on('error', (e) => { spawnError = e })
    const exited = new Promise<number>((resolve) => child!.on('close', (code) => resolve(code ?? 1)))

    for (let f = 0; f < total; f++) {
      await win.webContents.executeJavaScript(seekScript(f / opts.fps), true)
      const image = await win.webContents.capturePage()
      const buf = image.crop({ x: 0, y: 0, width: size.width, height: size.height }).toBitmap()
      if (buf.length !== frameSize) {
        throw new Error('抓帧尺寸不符：' + buf.length + ' 字节，期望 ' + frameSize)
      }
      await writeAll(child.stdin!, buf)
      if (f % 15 === 0) opts.onProgress?.('[小内核] seek ' + f + '/' + total)
    }
    child.stdin!.end()
    const code = await exited
    if (spawnError) throw spawnError
    if (code !== 0) throw new Error('vidrender-encode 退出码 ' + code + '；stderr 尾部：\n' + stderrTail)
    return opts.output
  } finally {
    try { child && child.exitCode === null && child.kill() } catch (e) { /* ignore */ }
    try { win.close() } catch (e) { /* ignore */ }
  }
}
