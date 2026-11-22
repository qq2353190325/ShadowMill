// src/main/rustKernels.ts —— 两个 Rust 大内核（WebView / Chrome）的产品接入
//
// 两者共用同一个一次性 CLI `vidrender.exe`，通过 --backend 选内核：
//   --backend webview —— WebView 内核（Windows WebView2 / macOS WKWebView）
//   --backend chrome  —— Chrome 内核（CDP + chrome-headless-shell，与 HY 共用同一个内核 exe）
// HTTP 服务（vidrender-http）只给服务端用，产品侧不走它。
//
// 不注册任何新 IPC：由 video.ts 按设置分流调用。CLI 的 stdout 是 JSON 结果，
// stderr 是消息；不推逐帧进度（内核的 on_progress 目前为 None），渲染期间由页面占位文案兜底。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CANVAS_SIZES } from '../shared/constants'
import type { RenderCanvas, RenderQuality } from '../shared/types'
import * as hfEnv from './hfEnv'

export type RustKernel = 'webview' | 'server'

export interface RustRenderOptions {
  entryHtml: string
  output: string
  canvas: RenderCanvas
  fps: number
  quality?: RenderQuality
  onProgress?: (text: string) => void
}

interface RustResult {
  ok?: boolean
  output?: string
  elapsed_ms?: number
  error?: { code: string; message: string }
}

const CRF: Record<RenderQuality, number> = { draft: 26, standard: 20, high: 18 }

// Rust 管线把入口 HTML 的**父目录**作为 loopback 静态根（见 vidrender-common/pipeline.rs）。
// 产品入口写在 <项目>/.render-tmp/，素材引用是 ../xxx，会跑出静态根之外。
// 因此这里把 ../ 去掉、把入口重写到项目根，让所有引用都落在静态根内。
// 音频由内核直接读 <audio> 元素（多轨混音），所以这里只负责路径改写，不提取音频路径。
function prepareRustEntry(entryHtml: string): string {
  const tmpDir = path.dirname(entryHtml)
  const projDir = path.dirname(tmpDir)
  const html = fs.readFileSync(entryHtml, 'utf8')
  let rewritten = html.replace(/\b(src|href)\s*=\s*(["'])\.\.\/([^"']+)\2/gi,
    (_whole, attr: string, quote: string, ref: string) => `${attr}=${quote}${ref}${quote}`)
  // 超长媒体被 prepareEntry 裁到 .render-tmp/media/，src 写成 ./media/xxx（相对 tmpDir）。
  // 入口搬到项目根后，这个相对路径会失效——改成相对项目根的 .render-tmp/media/xxx。
  rewritten = rewritten.replace(/\b(src|href)\s*=\s*(["'])\.\/media\//gi,
    (_whole, attr: string, quote: string) => `${attr}=${quote}.render-tmp/media/`)
  const htmlPath = path.join(projDir, 'entry.rust.html')
  fs.writeFileSync(htmlPath, rewritten, 'utf8')
  return htmlPath
}

/** 用指定的 Rust 内核渲染一次，返回 CLI 自报的耗时（毫秒）。 */
export async function renderWithRustKernel(kernel: RustKernel, opts: RustRenderOptions): Promise<number> {
  // 两个 getter 现在都指向同一个 vidrender.exe；用 --backend 区分内核。
  const exe = kernel === 'webview'
    ? hfEnv.BUILTIN_RESOURCES.vidCli
    : hfEnv.BUILTIN_RESOURCES.vidrenderCli
  if (!exe) {
    throw new Error('未找到 vidrender.exe（Rust 渲染内核）：它随安装包内置，请检查 <安装目录>/resources/bin 或重新安装')
  }

  const htmlPath = prepareRustEntry(opts.entryHtml)
  const size = CANVAS_SIZES[opts.canvas]
  const env: NodeJS.ProcessEnv = { ...process.env }
  const ffmpegBin = hfEnv.BUILTIN_RESOURCES.ffmpegBin
  if (ffmpegBin) env.PATH = ffmpegBin + path.delimiter + (env.PATH || '')
  // Chrome 内核与 HY 共用同一个谷歌内核：把独立 chrome 运行包里的 chrome-headless-shell 交给它，
  // 不再让它自己去 ~/.cache 下载（Rust 侧读 HF_BROWSER_PATH，优先级高于缓存与系统浏览器）。
  if (hfEnv.BUILTIN_RESOURCES.chromeShell) env.HF_BROWSER_PATH = hfEnv.BUILTIN_RESOURCES.chromeShell

  const args = [
    'render', htmlPath,
    '--backend', kernel === 'webview' ? 'webview' : 'chrome',
    '--output', opts.output,
    '--width', String(size.width),
    '--height', String(size.height),
    '--fps', String(opts.fps),
    '--crf', String(CRF[opts.quality || 'standard'])
  ]

  if (opts.onProgress) opts.onProgress('[Rust 内核] 正在启动渲染...')
  try {
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(exe, args, { env, windowsHide: true })
      let stdout = ''
      let stderrTail = ''
      let settled = false
      const done = (fn: () => void) => { if (!settled) { settled = true; fn() } }
      const report = (text: string) => {
        const line = text.trim()
        if (line && opts.onProgress) opts.onProgress('[Rust 内核] ' + line)
      }
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString()
        for (const line of d.toString().split(/\r?\n/)) report(line)
      })
      child.stderr.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-2000)
        for (const line of d.toString().split(/\r?\n/)) report(line)
      })
      child.on('error', (e) => done(() => reject(new Error('启动 ' + path.basename(exe) + ' 失败：' + e.message))))
      child.on('close', (code) => {
        if (code !== 0) {
          // 不能只取最后一行：CLI 的错误链可能跨多行，根因往往在第二行以后。
          done(() => reject(new Error(path.basename(exe) + ' 退出码 ' + code + '：\n' + stderrTail.trim())))
          return
        }
        let result: RustResult | null = null
        try {
          const line = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).slice(-1)[0]
          if (line) result = JSON.parse(line) as RustResult
        } catch (e) { /* 解析失败按无结果处理 */ }
        if (result && result.ok === false) {
          done(() => reject(new Error(result!.error?.message || '渲染失败')))
          return
        }
        done(() => resolve(Number(result?.elapsed_ms) || 0))
      })
    })
  } finally {
    try { fs.rmSync(htmlPath, { force: true }) } catch (e) { /* ignore */ }
  }
}
