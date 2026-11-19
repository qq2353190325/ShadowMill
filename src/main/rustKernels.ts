// src/main/rustKernels.ts —— 两个 Rust 大内核（WebView / Chrome）的产品接入
//
// 两者都是一次性 CLI，进程内直接调 vidrender-common 的渲染管线：
//   vid            —— WebView 内核（Windows WebView2 / macOS WKWebView）
//   vidrender-cli  —— Chrome 内核（CDP + chrome-headless-shell，与 HY 共用同一个内核 exe）
// HTTP 服务（vidrender-server）只给服务端用，产品侧不走它。
//
// 不注册任何新 IPC：由 video.ts 按设置分流调用。两个 CLI 的 stdout 是 JSON 结果，
// stderr 是消息；都不推逐帧进度（内核的 on_progress 目前为 None），渲染期间由页面占位文案兜底。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CANVAS_SIZES } from '../shared/constants'
import type { RenderCanvas, RenderQuality } from '../shared/types'
import { BGM_TAG_ID } from './projects/bgm'
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
function prepareRustEntry(entryHtml: string): { htmlPath: string; bgmPath: string } {
  const tmpDir = path.dirname(entryHtml)
  const projDir = path.dirname(tmpDir)
  const html = fs.readFileSync(entryHtml, 'utf8')
  const rewritten = html.replace(/\b(src|href)\s*=\s*(["'])\.\.\/([^"']+)\2/gi,
    (_whole, attr: string, quote: string, ref: string) => `${attr}=${quote}${ref}${quote}`)

  let bgmPath = ''
  const bgmRe = new RegExp('<audio\\b[^>]*\\bid=["\']' + BGM_TAG_ID + '["\'][^>]*\\bsrc=["\']([^"\']+)["\']', 'i')
  const m = rewritten.match(bgmRe)
  if (m) {
    const candidate = path.resolve(projDir, m[1])
    if (fs.existsSync(candidate)) bgmPath = candidate
  }

  const htmlPath = path.join(projDir, 'entry.rust.html')
  fs.writeFileSync(htmlPath, rewritten, 'utf8')
  return { htmlPath, bgmPath }
}

/** 用指定的 Rust 内核渲染一次，返回 CLI 自报的耗时（毫秒）。 */
export async function renderWithRustKernel(kernel: RustKernel, opts: RustRenderOptions): Promise<number> {
  const exe = kernel === 'webview'
    ? hfEnv.BUILTIN_RESOURCES.vidCli
    : hfEnv.BUILTIN_RESOURCES.vidrenderCli
  if (!exe) {
    throw new Error(kernel === 'webview'
      ? '未找到 vid（WebView 内核）：请在设置里下载 Rust 渲染内核运行环境包'
      : '未找到 vidrender-cli（Chrome 内核）：请在设置里下载 Rust 渲染内核运行环境包')
  }

  const { htmlPath, bgmPath } = prepareRustEntry(opts.entryHtml)
  const size = CANVAS_SIZES[opts.canvas]
  const env: NodeJS.ProcessEnv = { ...process.env }
  const ffmpegBin = hfEnv.BUILTIN_RESOURCES.ffmpegBin
  if (ffmpegBin) env.PATH = ffmpegBin + path.delimiter + (env.PATH || '')
  // Chrome 内核与 HY 共用同一个谷歌内核：直接把 HY 环境包里的 chrome-headless-shell 交给它，
  // 不再让它自己去 ~/.cache 下载（Rust 侧读 HF_BROWSER_PATH，优先级高于缓存与系统浏览器）。
  if (hfEnv.BUILTIN_RESOURCES.chromeShell) env.HF_BROWSER_PATH = hfEnv.BUILTIN_RESOURCES.chromeShell

  const args = [
    'render', htmlPath,
    '--output', opts.output,
    '--width', String(size.width),
    '--height', String(size.height),
    '--fps', String(opts.fps),
    '--crf', String(CRF[opts.quality || 'standard'])
  ]
  if (bgmPath) args.push('--audio', bgmPath)

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
          done(() => reject(new Error(path.basename(exe) + ' 退出码 ' + code + '：' + stderrTail.trim().split(/\r?\n/).slice(-1)[0])))
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
