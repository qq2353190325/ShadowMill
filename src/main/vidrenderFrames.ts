// src/main/vidrenderFrames.ts —— 小内核路径的「渲染模式」抽帧换图（大内核.MD §4）
//
// 浏览器逐帧 seek <video> 会把媒体管线踢起来、饿死渲染循环（真实合成实测 ~5s/帧）。
// 这里照搬 Rust 大内核已验证的方案：渲染前用 FFmpeg 按输出 fps 把本地视频抽成 PNG，
// 页面里插入继承样式与 data-* 计时的隐藏 <img> 兄弟，逐帧只换 img.src + 等 decode()。
// 原视频隐藏（可见性仍由 GSAP 管），音频不参与渲染同步 —— BGM 走 --audio 离线 mux。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as hfEnv from './hfEnv'

/** 一个视频的帧表：把 composition 时间 t 映射到源视频的帧号 */
export interface FrameTable {
  documentIndex: number
  start: number
  duration: number
  mediaStart: number
  rate: number
  looped: boolean
  count: number
  base: string        // 相对渲染入口的 URL 前缀（正斜杠）
  fps: number
  sourceDuration: number
}

/** 页面里一个 <video> 的显示盒子（CSS 像素），由页面实测得到 */
export interface VideoBox {
  documentIndex: number
  width: number
  height: number
  fit: 'cover' | 'contain' | 'fill'
}

/**
 * 在页面加载后实测每个 <video> 的显示盒子。
 * HY 的 videoShownBoxes 同款思路：视频在页面里只占多大，就抽多大的帧，
 * 不再一律按画布全尺寸抽 —— 本项目视频 490×600、画布 1920×1080，面积仅 1/4。
 */
export function measureVideoBoxes(): string {
  return `(() => {
  const boxes = [];
  const videos = Array.prototype.slice.call(document.querySelectorAll('video'));
  videos.forEach((v, i) => {
    const r = v.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fit = window.getComputedStyle(v).objectFit || 'fill';
    boxes.push({ documentIndex: i, width: Math.round(r.width), height: Math.round(r.height),
      fit: (fit === 'cover' || fit === 'contain' || fit === 'fill') ? fit : 'fill' });
  });
  return boxes;
})()`
}

function htmlVideos(html: string): string[] {
  const tags: string[] = []
  let cursor = 0
  for (;;) {
    const start = html.indexOf('<video', cursor)
    if (start < 0) break
    const end = html.indexOf('>', start)
    if (end < 0) break
    tags.push(html.slice(start, end + 1))
    cursor = end + 1
  }
  return tags
}

function attr(tag: string, name: string): string | undefined {
  const at = tag.indexOf(name)
  if (at < 0) return undefined
  let rest = tag.slice(at + name.length).trimStart()
  if (!rest.startsWith('=')) return undefined
  rest = rest.slice(1).trimStart()
  const quote = rest[0]
  if (quote !== '"' && quote !== "'") return undefined
  const body = rest.slice(1)
  const end = body.indexOf(quote)
  return end < 0 ? undefined : body.slice(0, end)
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const exe = hfEnv.BUILTIN_RESOURCES.ffmpeg
  if (!exe) return Promise.reject(new Error('未找到 ffmpeg：请先下载运行环境包'))
  const env: NodeJS.ProcessEnv = { ...process.env }
  const bin = hfEnv.BUILTIN_RESOURCES.ffmpegBin
  if (bin) env.PATH = bin + path.delimiter + (env.PATH || '')
  const TIMEOUT_MS = 5 * 60 * 1000
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let tail = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      // ffmpeg 卡住时绝不能让 await 永远悬着 —— 那样 IPC handler 不返回，
      // 渲染层只会收到 "reply was never sent"（实测踩过）。超时杀进程并回报 stderr 尾巴。
      try { child.kill() } catch (e) { /* ignore */ }
      finish(() => reject(new Error('ffmpeg 抽帧超时（5 分钟），已终止；stderr 尾部：' + tail)))
    }, TIMEOUT_MS)
    child.stderr?.on('data', (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-2000) })
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) => finish(() => code === 0 ? resolve() : reject(new Error('ffmpeg 抽帧失败：' + tail))))
  })
}

/**
 * 扫描入口 HTML 里的本地 <video>，按 fps 抽 PNG 到 root 下的临时目录。
 * 返回帧表；调用方负责在 finally 里删掉临时目录（它就在 .render-tmp/ 内，随入口一起清理）。
 * 远程 / 缺失 / 解码失败的视频跳过并写进度，不让单个素材毁掉整次渲染。
 */
export async function extractVideoFrames(
  entryHtml: string,
  root: string,
  fps: number,
  maxDuration: number,
  boxes: VideoBox[] = [],
  onProgress?: (text: string) => void,
): Promise<FrameTable[]> {
  const html = fs.readFileSync(entryHtml, 'utf8')
  const dir = path.join(root, `.vidrender-frames-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })

  const tables: FrameTable[] = []
  const videos = htmlVideos(html)
  for (let i = 0; i < videos.length; i++) {
    const tag = videos[i]
    const src = attr(tag, 'src')
    if (!src || /^(?:[a-z]+:|\/\/)/i.test(src)) continue
    const source = path.isAbsolute(src) ? src : path.resolve(root, src)
    if (!fs.existsSync(source)) {
      onProgress?.(`[小内核] 视频 ${src} 不存在，跳过抽帧`)
      continue
    }
    const videoDir = path.join(dir, String(i))
    fs.mkdirSync(videoDir, { recursive: true })
    try {
      // 只抽成片时长范围内的帧：视频可能有 225 秒而合成只有 45 秒，
      // 全量抽会产生数千张全尺寸帧，拖垮主进程导致 IPC 无回复。
      // 格式用 JPG（q3 ≈ 上游 HY 的 draft 质量）：实测 1350 帧 1920×1080
      // PNG 1.7GB → JPG 260MB（−85%），这是上游默认（auto：带 alpha 才 PNG）。
      // 按页面实测的显示盒子抽帧（cover 精确模拟：先 scale 到覆盖盒子，再 crop 中心）：
      // 视频显示 490×600、画布 1920×1080 时面积只 1/4，体积再降约 75%。
      const box = boxes.find((b) => b.documentIndex === i)
      const filters = [`fps=${fps}`]
      if (box && box.width > 0 && box.height > 0) {
        if (box.fit === 'cover') {
          filters.push(`scale=${box.width}:${box.height}:force_original_aspect_ratio=increase`,
            `crop=${box.width}:${box.height}`)
        } else if (box.fit === 'contain') {
          filters.push(`scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease`,
            `pad=${box.width}:${box.height}:(ow-iw)/2:(oh-ih)/2`)
        } else {
          filters.push(`scale=${box.width}:${box.height}:force_original_aspect_ratio=disregard`)
        }
      }
      const args = [
        '-v', 'error', '-i', source, '-vf', filters.join(','),
        '-q:v', '3', '-start_number', '0',
      ]
      if (Number.isFinite(maxDuration) && maxDuration > 0) args.push('-t', String(maxDuration))
      args.push(path.join(videoDir, '%05d.jpg'))
      await runFfmpeg(args, root)
    } catch (e) {
      onProgress?.(`[小内核] 视频 ${src} 抽帧失败，跳过：${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    const count = fs.readdirSync(videoDir).filter((f) => f.endsWith('.jpg')).length
    if (!count) continue
    tables.push({
      documentIndex: i,
      start: num(attr(tag, 'data-start'), 0),
      duration: num(attr(tag, 'data-duration'), Infinity),
      mediaStart: num(attr(tag, 'data-media-start') ?? attr(tag, 'data-playback-start'), 0),
      rate: num(attr(tag, 'data-playback-rate'), 1),
      looped: /\bloop\b/i.test(tag),
      count,
      base: `./${path.basename(dir)}/${i}`,
      fps,
      sourceDuration: count / fps,
    })
    onProgress?.(`[小内核] 视频 ${path.basename(source)} 抽帧 ${count} 张`)
  }
  return tables
}

/** 临时帧目录（抽帧时固定按 pid 命名，供 finally 清理） */
export function framesDir(root: string): string {
  return path.join(root, `.vidrender-frames-${process.pid}`)
}

/** 注入脚本：给每个视频插入继承样式与计时的隐藏 <img> 兄弟，原视频隐藏。 */
export function injectionScript(tables: FrameTable[]): string {
  const entries = JSON.stringify(tables)
  return `(function () {
  var tables = ${entries};
  window.__vidrenderFrames = [];
  var videos = Array.prototype.slice.call(document.querySelectorAll('video'));
  tables.forEach(function (table) {
    var video = videos[table.documentIndex];
    if (!video) return;
    var img = document.createElement('img');
    img.setAttribute('data-vidrender-frame', String(table.documentIndex));
    ['data-start','data-duration','data-media-start','data-playback-rate','class'].forEach(function (name) {
      if (video.hasAttribute(name)) img.setAttribute(name, video.getAttribute(name));
    });
    img.style.cssText = video.style.cssText;
    var computed = window.getComputedStyle(video);
    ['position','left','right','top','bottom','width','height','objectFit','objectPosition',
     'transform','transformOrigin','opacity','zIndex','borderRadius','filter','clipPath',
     'mixBlendMode','maxWidth','maxHeight'].forEach(function (name) {
      var value = computed.getPropertyValue(name);
      if (value) img.style.setProperty(name, value);
    });
    img.style.display = 'block';
    img.style.visibility = 'visible';
    video.parentNode.insertBefore(img, video.nextSibling);
    video.setAttribute('data-vidrender-original-video', '1');
    video.style.visibility = 'hidden';
    try { video.pause(); video.preload = 'none'; } catch (e) {}
    table.img = img;
    window.__vidrenderFrames.push(table);
  });
  return window.__vidrenderFrames.length;
})()`
}

/**
 * 第 t 秒的 seek：GSAP 时间轴定位 + 按时间映射换 img.src + 等 decode + 双 rAF。
 * 不再写 video.currentTime、不等 seeked（那是 5s/帧卡顿的根因）。
 */
export function seekScript(t: number): string {
  return `new Promise((resolve) => {
  var settled = false;
  var finish = function () { if (settled) return; settled = true; resolve(true); };
  setTimeout(finish, 5000);
  var t = ${t};
  var timelines = window.__timelines || {};
  Object.keys(timelines).forEach(function (key) {
    var tl = timelines[key];
    if (!tl) return;
    if (typeof tl.pause === 'function') tl.pause();
    if (typeof tl.time === 'function') tl.time(t);
    else if (typeof tl.seek === 'function') tl.seek(t, false);
  });
  var frames = window.__vidrenderFrames || [];
  var pending = [];
  frames.forEach(function (f) {
    var local = Math.min(Math.max(t - f.start, 0), f.duration);
    var sourceTime = f.mediaStart + local * f.rate;
    if (f.looped && f.sourceDuration > 0) {
      sourceTime = ((sourceTime % f.sourceDuration) + f.sourceDuration) % f.sourceDuration;
    } else if (f.sourceDuration > 0) {
      sourceTime = Math.min(sourceTime, f.sourceDuration);
    }
    var index = Math.max(0, Math.min(f.count - 1, Math.floor(sourceTime * f.fps)));
    var url = f.base + '/' + ('00000' + index).slice(-5) + '.jpg';
    var img = f.img;
    if (img.getAttribute('src') !== url) {
      img.src = url;
      if (typeof img.decode === 'function') pending.push(img.decode().catch(function () {}));
    }
  });
  var done = function () { requestAnimationFrame(function () { requestAnimationFrame(finish); }); };
  Promise.all(pending).then(done, done);
  setTimeout(done, 500);
})`
}
