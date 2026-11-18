// scripts/demo-vidrender.cjs —— 小内核最小联调（不接产品渲染链路）
//
// 跑法：npm run demo:vidrender   （需等待，交给用户执行）
// 链路：Electron 隐藏 offscreen 窗口 → 逐帧 seek（含 <video>.currentTime）→
//       beginFrameSubscription 拿原始 BGRA → vidrender-encode 的 stdin → MP4。
// 只验证协议与画面能否成片；「HTML生成」页的「转成视频」按钮仍走 hyperframes，未改动。
const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'vidrender', 'index.html')
const OUT = process.env.VIDRENDER_OUT || path.join(ROOT, '.tmp', 'vidrender-demo', 'out.mp4')
const WIDTH = 640
const HEIGHT = 360
const FPS = 30
const FRAMES = 60
const FRAME_SIZE = WIDTH * HEIGHT * 4
// Electron 官方文档只说 toBitmap 的原始像素格式「平台相关」，架构文档按 BGRA 设计。
// 若成片红蓝颠倒，用 VIDRENDER_PIX_FMT=rgba 重跑即可。
const PIX_FMT = (process.env.VIDRENDER_PIX_FMT || 'bgra').toLowerCase()

function encodePath() {
  if (process.env.VIDRENDER_ENCODE) return process.env.VIDRENDER_ENCODE
  const candidates = [
    path.join(ROOT, 'resources', 'bin', 'vidrender-encode.exe'), // dev
    path.join(process.resourcesPath || '', 'bin', 'vidrender-encode.exe'), // 安装包 extraResources
    path.join(app.getPath('userData'), 'runtime', 'vidrender', 'bin', 'vidrender-encode.exe') // 运行环境包
  ]
  const found = candidates.find((p) => p && fs.existsSync(p))
  if (!found) throw new Error('找不到 vidrender-encode.exe，试过：\n' + candidates.join('\n'))
  return found
}

// 第 t 秒的 seek：GSAP 式时间轴 + <video> 逐帧定位 + 双 rAF 等待合成稳定。
// video 的 currentTime 用 seeked 事件确认（2 秒兜底），否则片中视频会一直停首帧。
function seekScript(t) {
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

function writeAll(stream, buf) {
  return new Promise((resolve, reject) => {
    if (stream.write(buf)) return resolve()
    stream.once('drain', resolve)
    stream.once('error', reject)
  })
}

async function main() {
  const exe = encodePath()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  try { fs.rmSync(OUT, { force: true }) } catch (e) { /* ignore */ }
  console.log('编码内核:', exe)
  console.log('测试合成:', FIXTURE)
  console.log('输出:', OUT)

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: {
      offscreen: true,
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  await win.loadFile(FIXTURE)
  await win.webContents.executeJavaScript('window.__videoReady')

  let latest = null
  let waiter = null
  win.webContents.beginFrameSubscription(false, (image) => {
    const buf = image.toBitmap() // 原始字节；格式按 PIX_FMT 交给小内核解释
    if (waiter) { const fn = waiter; waiter = null; fn(buf) } else latest = buf
  })
  const nextFrame = () => new Promise((resolve, reject) => {
    if (latest) { const b = latest; latest = null; resolve(b); return }
    const timer = setTimeout(() => { waiter = null; reject(new Error('等待合成帧超时')) }, 3000)
    waiter = (buf) => { clearTimeout(timer); resolve(buf) }
  })

  const child = spawn(exe, [
    '--width', String(WIDTH), '--height', String(HEIGHT), '--fps', String(FPS),
    '--pix-fmt', PIX_FMT, '--input-format', 'raw', '--output', OUT
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

  let stderrTail = ''
  child.stderr.on('data', (d) => {
    const text = d.toString()
    stderrTail = (stderrTail + text).slice(-4000)
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev.event === 'progress') process.stdout.write('\r  编码进度 ' + ev.frame + '/' + FRAMES + ' 帧')
        else if (ev.event === 'done') console.log('\n  编码完成：' + ev.frames + ' 帧 / ' + ev.duration.toFixed(2) + ' 秒')
        else console.log('\n  [encode] ' + line)
      } catch (e) {
        console.log('\n  [ffmpeg] ' + line)
      }
    }
  })
  let spawnError = null
  child.on('error', (e) => { spawnError = e })
  const exited = new Promise((resolve) => child.on('close', resolve))

  for (let f = 0; f < FRAMES; f++) {
    await win.webContents.executeJavaScript(seekScript(f / FPS), true)
    const bmp = await nextFrame()
    if (bmp.length !== FRAME_SIZE) {
      throw new Error('帧尺寸不符：拿到 ' + bmp.length + ' 字节，期望 ' + FRAME_SIZE + '（' + WIDTH + 'x' + HEIGHT + ' BGRA）')
    }
    await writeAll(child.stdin, bmp)
    if (f % 15 === 0) console.log('  seek ' + f + '/' + FRAMES)
  }
  child.stdin.end()
  const [code] = await exited
  if (spawnError) throw spawnError
  if (code !== 0) throw new Error('vidrender-encode 退出码 ' + code + '；stderr 尾部：\n' + stderrTail)

  console.log('成片：', OUT, '（' + fs.statSync(OUT).size + ' 字节）')
  win.close()
  app.exit(0)
}

app.whenReady().then(() => main().catch((err) => {
  console.error('联调失败：', err)
  app.exit(1)
}))
