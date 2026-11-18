// scripts/demo-vidrender.cjs —— 小内核最小联调（不接产品渲染链路）
//
// 跑法：npm run demo:vidrender   （需等待，交给用户执行）
// 链路：Electron 隐藏 offscreen 窗口 → 逐帧 seek（含 <video>.currentTime）→
//       capturePage() 抓帧 → 裁到内容视口取原始像素 → vidrender-encode 的 stdin → MP4。
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
    // 每次背压都挂 once 监听却不摘，60 帧累积后会触发 MaxListenersExceededWarning。
    const cleanup = () => {
      stream.off('drain', onDrain)
      stream.off('error', onError)
    }
    const onDrain = () => { cleanup(); resolve() }
    const onError = (e) => { cleanup(); reject(e) }
    if (stream.write(buf)) { cleanup(); resolve(); return }
    stream.once('drain', onDrain)
    stream.once('error', onError)
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

  // 用 capturePage 而不是 beginFrameSubscription：后者只在 presentation 事件时回调，
  // 隐藏的离屏窗口会合并/跳过呈现，实测会偶发长时间无帧；capturePage 按需抓，单路径稳定。
  // 抓到的图比 composition 略大（窗口边框），裁到 640x360 后每帧正好 WIDTH*HEIGHT*4 字节。
  const cropBitmap = (image) => image.crop({ x: 0, y: 0, width: WIDTH, height: HEIGHT }).toBitmap()
  const nextFrame = async () => cropBitmap(await win.webContents.capturePage())

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
  // close 事件回传的是单个退出码（不是数组），不能解构
  const code = await exited
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
