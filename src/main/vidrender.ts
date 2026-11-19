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
import {
  extractVideoFrames, framesDir, injectionScript, measureVideoBoxes, seekScript,
  type VideoBox,
} from './vidrenderFrames'

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

function writeAll(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      stream.off('drain', onDrain); stream.off('error', onError); stream.off('close', onClose); clearTimeout(timer)
    }
    const onDrain = () => { if (settled) return; settled = true; cleanup(); resolve() }
    const onError = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(e) }
    // 编码器提前退出（参数错误 / 崩溃）时 drain 永远不来，await 会永久挂起，
    // IPC handler 不返回 → 渲染层只收到 "reply was never sent"（实测踩过）。
    // 加 10s 超时把它变成明确错误，且 close 时也兜底 reject。
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('写入编码器 stdin 超时（10s）：编码器可能已提前退出（参数不兼容？）'))
    }, 10000)
    const onClose = () => onError(new Error('编码器在写入期间退出'))
    stream.once('close', onClose)
    if (stream.write(buf)) { onDrain(); return }
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
    // 去掉窗口外框（标题栏约 17px + 边框 3px）：无边框窗口的内容视口严格等于
    // width×height，capturePage() 才抓得到完整画布。实测 useContentSize:true
    // 在本机 offscreen 窗口上无效（截图反而是 1923×1063），故改走 frame:false。
    frame: false,
    webPreferences: {
      offscreen: true,
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  let child: ChildProcess | null = null
  const renderStart = Date.now()
  try {
    await win.loadFile(htmlPath)
    // 渲染模式：先把本地 <video> 按 fps 抽成 PNG，再注入隐藏 <img> 兄弟。
    // 逐帧只换 img.src，不再逐帧 seek <video>（后者会把渲染循环饿死到 ~5s/帧）。
    const tmpDir = path.dirname(htmlPath)
    // 先量每个 <video> 的显示盒子，抽帧只按显示尺寸（cover 精确模拟），
    // 不再一律按画布全尺寸 —— 视频只占画布 1/4 时体积再降约 75%。
    const boxes = await win.webContents.executeJavaScript(measureVideoBoxes()) as VideoBox[]
    const extractStart = Date.now()
    const tables = await extractVideoFrames(htmlPath, tmpDir, opts.fps, duration, boxes, opts.onProgress)
    if (tables.length) {
      opts.onProgress?.(`[小内核] 抽帧 ${tables.length} 路，用时 ${((Date.now() - extractStart) / 1000).toFixed(1)}s`)
    }
    if (tables.length) await win.webContents.executeJavaScript(injectionScript(tables))
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
    let warned = false

    for (let f = 0; f < total; f++) {
      await win.webContents.executeJavaScript(seekScript(f / opts.fps), true)
      const image = await win.webContents.capturePage()
      const shot = image.getSize()
      // Windows offscreen 窗口的 capturePage 实得尺寸会因外框 / DPI 抖动（实测 1920×1063、
      // 1923×1063），frame:false / useContentSize 在本机都不稳定。不再依赖窗口尺寸：
      // 先把截图裁到目标宽高（多余边框切掉），尺寸不足时再缩放补齐，保证每帧字节数恒定。
      let normalized = image.crop({ x: 0, y: 0, width: Math.min(shot.width, size.width), height: Math.min(shot.height, size.height) })
      if (shot.width !== size.width || shot.height !== size.height) {
        normalized = normalized.resize({ width: size.width, height: size.height, quality: 'good' })
        if (!warned) {
          warned = true
          opts.onProgress?.(`[小内核] 截图 ${shot.width}×${shot.height}，已归一化到 ${size.width}×${size.height}`)
        }
      }
      const buf = normalized.toBitmap()
      if (buf.length !== frameSize) {
        throw new Error(
          '抓帧尺寸不符：截图 ' + shot.width + '×' + shot.height +
          '，归一化后 ' + buf.length + ' 字节，期望 ' + size.width + '×' + size.height + '（' + frameSize + ' 字节）'
        )
      }
      await writeAll(child.stdin!, buf)
      if (f % 15 === 0) {
        const elapsed = (Date.now() - renderStart) / 1000
        const fps = elapsed > 0.05 ? (f + 1) / elapsed : 0
        const remain = fps > 0 ? (total - f - 1) / fps : 0
        opts.onProgress?.(
          `[小内核] ${f + 1}/${total} 帧 · 已用 ${elapsed.toFixed(1)}s · 剩余约 ${remain.toFixed(0)}s · ${fps.toFixed(1)} fps`
        )
      }
    }
    child.stdin!.end()
    const code = await exited
    if (spawnError) throw spawnError
    if (code !== 0) throw new Error('vidrender-encode 退出码 ' + code + '；stderr 尾部：\n' + stderrTail)
    const totalSec = (Date.now() - renderStart) / 1000
    opts.onProgress?.(`[小内核] 渲染完成：${total} 帧 / ${totalSec.toFixed(1)}s（平均 ${(total / totalSec).toFixed(1)} fps）`)
    return opts.output
  } finally {
    try { child && child.exitCode === null && child.kill() } catch (e) { /* ignore */ }
    try { win.close() } catch (e) { /* ignore */ }
    try { fs.rmSync(framesDir(path.dirname(htmlPath)), { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}
