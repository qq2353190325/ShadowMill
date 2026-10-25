// src/main/video.ts
// 预览 / HyperFrames 转视频（自定义 HTML 渲染）
// 提供：dialog:open-html / video:show-in-folder / video:render（含 video:progress 推送）
// 依赖：hfEnv(BUILTIN_RESOURCES / findHyperframesCli / findNode / findFfmpegBin /
//       isHyperframesComposition) / runtime(确保运行环境包已解包) / settings(渲染档位白名单) / dialog / shell
import { app, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import * as hfEnv from './hfEnv'
import * as coreLib from './coreLib'
import * as runtime from './runtime'
import { pickRenderOverride } from './settings'
import { CANVAS_SIZES, DEFAULT_CANVAS, RENDER_CANVASES } from '../shared/constants'
import { IPC } from '../shared/ipc'
import type {
  RegisterCtx,
  RenderCanvas,
  RuntimePackName,
  VideoRenderPayload,
  VideoRenderResult
} from '../shared/types'

// 载荷与结果类型统一取自 shared/types.ts（⑦ 节），此处不再重复声明：
// RenderPayload / PreviewShellPayload / RenderResult（见 VideoRenderPayload / VideoPreviewShellPayload / VideoRenderResult）
// 渲染档位（质量 / 帧率）也在 VideoRenderPayload 内：只接受白名单内的显式值，缺省不传参数、走 CLI 默认（standard / 30）

// 渲染要哪几包：HyperFrames CLI 与浏览器壳在 hyperframes 包，编码与素材探测在 ffmpeg 包；
// 分包后两者都在安装包之外，缺哪个就提示下载哪个（见 docs/runtime-pack-split.md）
const RENDER_PACKS: RuntimePackName[] = ['ffmpeg', 'hyperframes']

// ===== 成片时长：谁说了算 =====
// HyperFrames 的规则（cli.js 实测）：**成片时长 = max(根节点声明的时长, 页面里最长媒体的时长)**。
// 声明只能把片子拉长、拉不短 ⇒ 只声明没用，超长的媒体必须一起裁掉，否则「动画 45 秒、素材 225 秒」
// 就会渲出 225 秒、后 180 秒全是黑帧（本项目的真实故障）。
// 时长来源按这个顺序取（前一个拿到就不看后面的）：
//   ① 模型在 <html data-composition-duration> 里声明的（零成本；提示词已要求它写）
//   ② 现场量 GSAP 时间轴（无头浏览器跑一次，与预览脚本的 clock() 同一口径；不需要字幕，3~5 秒）
//   ③ 页面里最长媒体的时长（老页面没有时间轴时的兜底，即拆分前的行为）
async function runCapture(cmd: string, args: string[], cwd: string, env: Record<string, string | undefined>, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (s: string): void => { if (!done) { done = true; resolve(s) } }
    try {
      const child = spawn(cmd, args, { cwd, env, windowsHide: true })
      const timer = setTimeout(() => { try { child.kill() } catch (e) { /* ignore */ } ; finish('') }, timeoutMs)
      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { out += d.toString() })
      child.on('error', () => { clearTimeout(timer); finish('') })
      child.on('close', () => { clearTimeout(timer); finish(out) })
    } catch (e) { finish('') }
  })
}

// 模型在 HTML 里的时长声明（<html ... data-composition-duration="45">），没有则 0
function declaredDuration(html: string): number {
  const m = html.match(/<html[^>]*\bdata-composition-duration\s*=\s*["']([\d.]+)["']/i)
  if (!m) return 0
  const v = parseFloat(m[1])
  return isFinite(v) && v > 0 ? v : 0
}

// ===== 成片画布：两个地方都要写，少一处就变竖屏 =====
// 成片宽高由 CLI（0.8.33）的 producer 编译阶段决定：compileForRender 取文档里**第一个**带
// data-composition-id 的元素（最外层舞台），读它的 data-width / data-height；读不到就分别兜底
// **1080 / 1920** ⇒ 成片是竖屏。`<html data-resolution>` 在渲染链路里一次都不读（只有 `hyperframes info` 用）。
// 所以项目所选画布要写两个地方，缺任何一处都不成立：
//   ① 舞台元素的 data-width / data-height —— 真正决定成片宽高（applyCanvasSize）
//   ② <html data-resolution> —— 让页面自描述，预览与 info 读得到（applyCanvasDeclaration）
// 2026-10-21 实测：只写了 ② 时，video-duration.log 记着 landscape、成片却是 1080x1920（本项目的真实故障）。
// 两处都由应用写、不靠模型：模型写的画布可能与该项目的选择不一致（甚至整份都不写），
// 而"项目所选定下的画布说了算"是这一层唯一该保证的事。
// 传 --resolution 不能替代：那个参数是「保持 composition 尺寸、用 DPR 上采样」，宽高比不符会直接报错。
// 同一个「舞台元素才是渲染入口」的道理也适用于**成片时长**（见 applyStageDuration）：时长写 `<html>` 上也不生效。
function applyCanvasSize(html: string, canvas: RenderCanvas): string | null {
  const size = CANVAS_SIZES[canvas]
  return rewriteStageTag(html, (attrs) =>
    stripAttrs(attrs, ['data-width', 'data-height']) +
    ' data-width="' + size.width + '" data-height="' + size.height + '"')
}

// 时长同理写在舞台上：CLI 编译阶段取第一个 data-composition-id 元素的
// `data-duration` ?? `data-composition-duration`（cli.js 126320），<html> 上那条它不读。
function applyStageDuration(html: string, seconds: number): string | null {
  return rewriteStageTag(html, (attrs) =>
    stripAttrs(attrs, ['data-duration', 'data-composition-duration']) +
    ' data-duration="' + seconds + '"')
}

// 改写「最外层舞台」开标签上的属性：找到文档里第一个带 data-composition-id 的元素，交给 rewrite 决定写什么；
// 找不到返回 null（调用方据此决定是否留痕说明）。画布宽高与成片时长都走这里，两处口径不会分叉。
// 开标签整体匹配（属性值里的 `>` 由引号分支吃掉），逐个标签用属性分词器判「有没有 data-composition-id」，
// 命中第一个就停 —— 与 CLI 的 document.querySelector("[data-composition-id]") 同口径（树序里祖先在前，
// 所以命中的是最外层舞台，不是嵌套子 composition）。
// 已知限制：CLI 的 DOM 查询不进入 `<template>` 内容，这里的正则不跳；但本应用的生成提示词不产出
// data-composition-src 子 composition（含 <template> 包装），换提示词支持子 composition 时要一起改这里。
function rewriteStageTag(html: string, rewrite: (attrs: string) => string): string | null {
  const TAG = /<([a-zA-Z][-a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g
  let done = false
  const out = html.replace(TAG, (whole: string, name: string, attrs: string) => {
    if (done) return whole
    let isStage = false
    attrs.replace(ATTR, (m: string, attrName: string) => {
      if (/^data-composition-id$/i.test(attrName)) isStage = true
      return m
    })
    if (!isStage) return whole
    done = true
    return '<' + name + rewrite(attrs) + '>'
  })
  return done ? out : null
}

function applyCanvasDeclaration(html: string, canvas: RenderCanvas): string {
  const tag = /<html\b([^>]*)>/i
  if (tag.test(html)) {
    return html.replace(tag, (_m: string, attrs: string) => '<html' + stripAttrs(attrs, ['data-resolution']) + ' data-resolution="' + canvas + '">')
  }
  // 模型输出被截断到连 <html> 都没有（罕见）：前置一个带声明的 <html>，至少让画布是对的
  return '<html data-resolution="' + canvas + '">' + html
}

// 剥掉指定属性（含**无值写法**），其余属性原样保留、只把开头空白收成一个空格。
// 为什么不是一条简单正则：① 只匹配「带值」写法会漏掉 HTML 合法的无值写法（如 `<html data-resolution>`），
// 注入后同一个标签上就有两个同名属性，而**HTML 解析规则取第一个**（正好是空值）⇒ 项目所选被默默压过；
// ② 把 `=` 与值写成可选，又会命中**别的属性值里**的同名文本（如 `data-x="data-resolution"`），
// 把那个属性值改坏。所以按属性逐个扫描：引号包住的值整段被消费，内部文本不会再被二次匹配。
function stripAttrs(attrs: string, names: string[]): string {
  const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g
  const left = attrs.replace(ATTR, (m: string, name: string) =>
    names.some((n) => n.toLowerCase() === name.toLowerCase()) ? '' : m).trim()
  return left ? ' ' + left : ''
}

// 现场量时间轴：用无头 Chromium 加载「页面 + 量测脚本」，把 GSAP 时间轴长度读回来
// 口径与预览控制脚本的 clock() 一致（多个时间轴取最大；没有时间轴返回 0 ⇒ 调用方退回媒体时长）。
// 为什么不用 iframe 套一层：套了就取不到内层 GSAP；所以直接把 HTML 追加一段量测脚本，
// 用 --dump-dom 把写进 DOM 的结果读回（本机已实测可用：量出 45 秒，与预览显示完全一致）。
// ⚠ 副本落在**项目根**（probeDir），不是 .render-tmp/：章节化长片的 ./pages/cNN.js、素材的 audio/…
// 全是按项目根写的相对引用，放在 .render-tmp/ 里会 404 ⇒ 章节脚本不执行 ⇒ 时间轴量回 0，
// 然后静默退回「按最长媒体裁片长」（成片被截短，且没有任何报错）。这也是为什么传进来的是
// **未抬级原文**（不带 ../）：抬级是给 .render-tmp/ 里的渲染入口用的。
async function measureTimelineDuration(html: string, probeDir: string, chrome: string, cwd: string, env: Record<string, string | undefined>): Promise<number> {
  const probePath = path.join(probeDir, '.duration-probe.html')
  const marker = 'HF_DUR_MARKER_'
  try {
    const probeScript = '<script>(function(){try{setTimeout(function(){' +
      'var list=[];try{var r=window.__timelines;if(r){for(var k in r){list.push(r[k])}}}catch(e){}' +
      'if(!list.length&&window.gsap){for(var k2 in window.gsap){try{var v=window.gsap[k2];if(v&&typeof v.duration==="function")list.push(v)}catch(e){}}}' +
      'var d=0;for(var i=0;i<list.length;i++){try{var x=list[i].duration();if(typeof x==="number"&&isFinite(x)&&x>d)d=x}catch(e){}}' +
      'var el=document.createElement("pre");el.id="hf-dur-out";el.textContent="' + marker + '"+d+"_END";document.body.appendChild(el);' +
      '},1500)}catch(e){}})();</scr' + 'ipt>'
    fs.writeFileSync(probePath, String(html || '') + probeScript, 'utf8')
    const url = 'file:///' + probePath.replace(/\\/g, '/').replace(/ /g, '%20')
    const dom = await runCapture(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
      '--virtual-time-budget=5000', '--dump-dom', url], cwd, env, 30000)
    const m = dom.match(new RegExp(marker + '([\\d.]+)_END'))
    const v = m ? parseFloat(m[1]) : 0
    return isFinite(v) && v > 0 ? v : 0
  } catch (e) {
    return 0
  } finally {
    try { fs.rmSync(probePath, { force: true }) } catch (e) { /* ignore */ }
  }
}

// 用 ffprobe 量一个媒体文件的时长（秒）
async function probeDuration(file: string, ffprobe: string, cwd: string, env: Record<string, string | undefined>): Promise<number> {
  const out = await runCapture(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], cwd, env, 20000)
  const v = parseFloat(out.trim())
  return isFinite(v) && v > 0 ? v : 0
}

// 时长裁定与媒体裁剪写进 userData/video-duration.log：这类"片子为什么这么长"的问题必须留痕可查
function writeTrimLog(projDir: string, line: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'video-duration.log'),
      new Date().toISOString() + ' [' + path.basename(projDir) + '] ' + line + '\n', 'utf8')
  } catch (e) { /* 日志失败不影响渲染 */ }
}

// 裁定成片时长并裁掉超长媒体，返回最终要渲染的入口 HTML 文本。
// 抽成独立 async 函数的原因：调用点在一个 `new Promise(...)` 的同步执行器里，那里不能出现 await。
async function prepareEntry(opts: {
  localized: string
  tmpDir: string
  projDir: string
  env: Record<string, string | undefined>
  chrome: string
  canvas: RenderCanvas
}): Promise<string> {
  const { localized, tmpDir, projDir, env, chrome, canvas } = opts
  let entry = hfEnv.hoistVendorRefs(localized, '../')
  // 画布写两处，放在最前：后面量时间轴时写盘的副本、最终留给 CLI 的入口都带上它们。
  // ① 舞台 data-width/data-height（成片宽高的真正来源）；② <html data-resolution>（页面自描述）。
  entry = applyCanvasDeclaration(entry, canvas)
  const sized = applyCanvasSize(entry, canvas)
  if (sized) entry = sized
  // 留痕：成片尺寸这类"为什么渲出来是这样"的问题必须可事后查（与时长裁定同一个日志文件）
  const size = CANVAS_SIZES[canvas]
  writeTrimLog(projDir, '成片画布 = ' + canvas + '（' + size.width + 'x' + size.height + '）：' +
    (sized
      ? '已写入舞台 data-width/data-height 与 <html data-resolution>'
      : '页面里找不到带 data-composition-id 的舞台，只写了 <html data-resolution>（CLI 将兜底 1080x1920 竖屏）'))

  // ① 模型声明（零成本）
  let target = declaredDuration(localized)
  let source = '声明'
  // ② 没声明就现场量一次 GSAP 时间轴
  if (target <= 0) {
    if (chrome) {
      // 量测副本从「未抬级」的原文重新拼：它要落在项目根，才能让 ./pages/cNN.js、audio/… 这些
      // 按项目根写的相对引用解析成功（见 measureTimelineDuration 的注释）
      let probeHtml = applyCanvasDeclaration(localized, canvas)
      const probeSized = applyCanvasSize(probeHtml, canvas)
      if (probeSized) probeHtml = probeSized
      target = await measureTimelineDuration(probeHtml, projDir, chrome, projDir, env)
      source = '实测时间轴'
    } else {
      source = ''
    }
  }
  // ③ 都拿不到：保持旧行为（HyperFrames 自己取最长媒体），只落一条日志说明为什么
  if (target <= 0) {
    writeTrimLog(projDir, '成片时长：模型未声明且时间轴量不到（chrome=' + (chrome ? '有' : '无') + '）→ 交给 CLI 按最长媒体裁定')
    return entry
  }

  // 裁超长媒体：声明/实测的时长只有把媒体一起裁到同长才生效（规则是 max(声明, 最长媒体)）
  // ⚠️ 路径解析：入口在 `.render-tmp/` 里，但 HTML 里的 `video/x.mp4` 是**相对项目根**写的
  // （CLI 也按项目根解析）。所以必须 resolve(projDir, src)，不能 resolve(tmpDir, src)——
  // 后者会指向 .render-tmp\video\…（不存在）⇒ 一句"找不到就跳过"就把裁剪全跳过了，
  // 声明写了也白写、成片照样是最长媒体的长度（2026-10 实测踩到）。
  const mediaRe = /(<(?:video|audio)\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi
  const jobs: { from: string; to: string }[] = []
  let mm: RegExpExecArray | null
  while ((mm = mediaRe.exec(entry)) !== null) {
    const src = mm[2]
    if (/^(?:https?:|data:|blob:|file:)/i.test(src)) continue
    if (src.indexOf('..') >= 0) continue   // 已经指到项目外（本应用不会生成这种）：不碰
    const abs = path.resolve(projDir, src)
    if (!fs.existsSync(abs)) { writeTrimLog(projDir, '媒体文件不存在，跳过裁剪：' + src); continue }
    const dur = await probeDuration(abs, hfEnv.BUILTIN_RESOURCES.ffprobe, projDir, env)
    if (dur <= target + 0.25) continue
    const toAbs = path.join(tmpDir, 'media', path.basename(abs))
    fs.mkdirSync(path.dirname(toAbs), { recursive: true })
    // 从头裁到目标时长；-c copy 不重压（秒级完成）
    const log = await runCapture(hfEnv.BUILTIN_RESOURCES.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', abs, '-t', String(target), '-c', 'copy', toAbs], projDir, env, 120000)
    if (fs.existsSync(toAbs) && fs.statSync(toAbs).size > 0) {
      // 入口自身就在 .render-tmp/ 里，相对它写 ./media/xxx 最稳妥（少一层 ../ 的歧义）
      jobs.push({ from: src, to: './media/' + path.basename(abs) })
      writeTrimLog(projDir, '裁剪 ' + path.basename(abs) + '：' + dur.toFixed(1) + 's → ' + target.toFixed(1) + 's')
    } else {
      writeTrimLog(projDir, '裁剪失败（' + dur.toFixed(1) + 's → ' + target + 's）：' + path.basename(abs) + ' ' + log.slice(-160))
    }
  }
  for (const j of jobs) entry = entry.split('"' + j.from + '"').join('"' + j.to + '"')
  if (jobs.length) writeTrimLog(projDir, '裁到 ' + target + 's：' + jobs.map((j) => path.basename(j.from)).join('、'))

  // ① 页面自描述：写进 <html data-composition-duration>（预览、info 与下次生成都读它；**CLI 渲染不读**）
  if (target > 0 && !declaredDuration(entry)) {
    entry = /<html\b[^>]*>/i.test(entry)
      ? entry.replace(/<html\b([^>]*)>/i, '<html$1 data-composition-duration="' + target + '">')
      : '<html data-composition-duration="' + target + '">' + entry
  }
  // ② 真正生效的那处：写进舞台元素的 data-duration —— CLI 编译阶段只读第一个 data-composition-id 元素的
  // data-duration ?? data-composition-duration（cli.js 126320），<html> 上那条它从来不读。只写 ① 时
  // 「声明的时长」等于没有：成片长度由页面 GSAP 时间轴决定（实测那次声明 120s 恰好等于时间轴 120s，才看着像生效）。
  if (target > 0) {
    const durated = applyStageDuration(entry, target)
    if (durated) entry = durated
    writeTrimLog(projDir, durated
      ? '成片时长声明已写到舞台 data-duration = ' + target.toFixed(2) + 's（CLI 编译阶段只读这一处）'
      : '成片时长：页面里找不到带 data-composition-id 的舞台，只写了 <html data-composition-duration>（CLI 渲染不读它）')
  }
  writeTrimLog(projDir, '成片时长 = ' + target.toFixed(2) + 's（来源：' + source + '）')
  return entry
}

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

  ipcMain.handle(IPC.Video.Render, async (event, payload?: VideoRenderPayload) => {
    // 分包之后运行环境**不再随安装包**：渲染要 ffmpeg + hyperframes 两包。
    // 这里只做纯校验（不下载、不阻塞）——缺包就把 needPacks 回给界面，由它问用户是否下载（可取消）；
    // 否则会以「未找到 hyperframes CLI」误导用户，或者让这次请求无声地卡在下载上。
    const lack = runtime.missingPacks(RENDER_PACKS);
    if (lack.length) {
      return {
        ok: false,
        needPacks: lack,
        message: '转视频需要先下载运行环境（' + runtime.packSizeText(lack) + '）'
      } as VideoRenderResult;
    }
    // ===== 准备阶段（异步：定成片时长 + 裁超长媒体副本 + 写渲染入口）=====
    // 刻意**放在 new Promise 之外**：Promise 的执行器是同步函数，里面不能 await；
    // 这里失败一律直接回错误，不进渲染。
    const htmlPath = payload && payload.htmlPath;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      return { ok: false, message: 'HTML 文件不存在' } as VideoRenderResult;
    }

    const raw = fs.readFileSync(htmlPath, 'utf8');
    if (!hfEnv.isHyperframesComposition(raw)) {
      return {
        ok: false,
        compatible: false,
        message: '该 HTML 不是 HyperFrames 规范的 composition（缺少 data-composition-id / GSAP __timelines 结构）。' +
          '建议先用 HyperFrames 引导生成合规模板，再替换为自己的 HTML 内容。'
      } as VideoRenderResult;
    }

    // ===== 无限循环护栏：页面里有 GSAP 的 repeat: -1 就当场拒绝 =====
    // GSAP 把 repeat:-1 的 tween 时长当成 1e10 秒（**不是** Infinity），父时间轴 duration() 就是
    // 「1e10 + 该 tween 的起点」。而 HyperFrames 的成片时长 = max(页面声明, 时间轴实测)，应用写进舞台的
    // data-duration 压不过它 ⇒ CLI 会按 1e10 秒去计划帧数，实际永远渲不完（2026-10 实测：预览总时长显示
    // 166666668:12，即 1e10+92 秒）。与其让它排几个小时的队，不如在门口说清楚。
    // 静态判据足够：GSAP 的无限循环只有 repeat: -1 / repeat: Infinity 两种写法；
    // CSS 的 animation-iteration-count: infinite 不算——HF 的 CSS 适配器对 endTime 非有限的动画直接跳过。
    // 章节化长片：动画代码在 pages/cNN.js 里，入口 index.html 只是应用生成的骨架。
    // 只扫入口会漏掉章节脚本里的无限循环（#61 那个「317 年」故障的复发路径），所以一起扫。
    let guardText = raw
    try {
      const pagesDir = path.join(path.dirname(htmlPath), 'pages')
      if (fs.existsSync(pagesDir)) {
        for (const f of fs.readdirSync(pagesDir)) {
          if (!/^c\d{2,3}\.js$/i.test(f)) continue
          guardText += '\n' + fs.readFileSync(path.join(pagesDir, f), 'utf8')
        }
      }
    } catch (e) { /* 章节目录读不到就只扫入口，不影响单文件模式 */ }
    if (/repeat\s*:\s*(?:-1|Infinity)\b/i.test(guardText)) {
      return {
        ok: false,
        message: '页面里有无限循环动画（GSAP 的 repeat: -1），成片时长没法确定，转视频会永远渲不完。' +
          '请到「HTML生成」页让这些循环改成有限次数（例如 repeat: 12, repeatDelay: 0.4，次数按目标秒数算好）后再转视频。'
      } as VideoRenderResult;
    }

    const hfCli = hfEnv.findHyperframesCli();
    if (!hfCli) {
      return { ok: false, message: '未找到 hyperframes CLI（hyperframes.mjs）。可设置环境变量 HYPERFRAMES_CLI 指向其路径。' } as VideoRenderResult;
    }
    // 返回 { cmd, env }：优先复用 Electron 内嵌 Node，此时 env 里带 ELECTRON_RUN_AS_NODE=1。
    // 这个 env **必须**合进下面 spawn 的环境，否则 electron.exe 会把自己当应用来启动（详见 hfEnv.findNode()）。
    const nodeRt = hfEnv.findNode();
    if (!nodeRt) {
      return { ok: false, message: '未找到可用的 Node.js（HyperFrames 要求 >= 22；Electron 内嵌 / 系统两种途径均不可用）' } as VideoRenderResult;
    }

    // ===== 就地渲染：渲染根目录 = HTML 所在的项目目录，不再把素材复制到 hf-projects =====
    // 为什么以前要复制：CLI 的素材解析一律按「项目根（cwd）+ HTML 里的相对路径」（见 cli.js 的
    // rewriteAssetPath / join(projectDir, src)），而渲染前要改写 GSAP 引用、注入 BGM，不能动用户原件。
    // 现在两者都不需要复制：
    //   · 随包前端库本地化幂等（本文件下面那步），产物就是项目目录里的 gsap.min.js / p5.min.js 等；
    //   · BGM 注入本来只写 index.html（projects/ 的 applyBgmToHtml），渲染时不需要再动；
    //   · 渲染入口写在项目内一个临时子目录里（CLI 要求入口必须在项目根之内），媒体用 ../ 回退引用，
    //     实测 CLI 能正常解析（2026-10 验证：4 秒合成就地渲染成功、素材与 gsap 均从项目内读到）。
    // 好处：不再复制 200MB+ 素材、不再留几百 MB 的 hf-projects 工作目录、成品直接生成在项目里。
    const projDir = path.dirname(htmlPath);
    // 章节模式的页面引了 ./core.js（共享绘制助手）：渲染前按版本同步一次。
    // 与 projects/ 的 syncCoreLib 同一份逻辑（这里只同步、不写日志），保证「应用升级后第二次渲染就吃到新版」。
    try {
      const coreSrc = hfEnv.coreSource();
      if (coreSrc && /src=["'](?:\.\/)?core\.js["']/i.test(raw)) {
        const r = coreLib.syncCoreTo(projDir, coreSrc);
        if (r.copied) writeTrimLog(projDir, 'core.js 版本 ' + (r.from || '无') + ' → ' + r.to + '（渲染前按版本同步）');
        else if (r.error) writeTrimLog(projDir, 'core.js 同步失败：' + r.error);
      }
    } catch (e) { /* 同步失败不拦渲染：项目里那份旧版仍能用 */ }
    const tmpDir = path.join(projDir, '.render-tmp');
    const entryHtml = path.join(tmpDir, 'entry.html');
    const outMp4 = path.join(projDir, 'video', 'output.mp4');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.mkdirSync(path.dirname(outMp4), { recursive: true });
    } catch (e) {
      return { ok: false, message: '准备渲染目录失败：' + ((e as Error).message || String(e)) } as VideoRenderResult;
    }

    // 随包库本地化（幂等；仅当原件仍引 CDN 时才真正改写）：入口在子目录里，引用写成 ../<库文件>
    const localized = hfEnv.localizeVendorHtml(raw)
    hfEnv.ensureVendorFiles(projDir, localized)

    const env: Record<string, string | undefined> = { ...process.env, ...nodeRt.env };
    const ffBin = hfEnv.findFfmpegBin();
    if (ffBin) env.PATH = ffBin + path.delimiter + (env.PATH || '');
    // 内置 ffmpeg/ffprobe 路径显式注入，避免依赖系统 PATH（HYPERFRAMES_* 为可选）
    if (fs.existsSync(hfEnv.BUILTIN_RESOURCES.ffmpeg)) env.HYPERFRAMES_FFMPEG_PATH = hfEnv.BUILTIN_RESOURCES.ffmpeg;
    if (fs.existsSync(hfEnv.BUILTIN_RESOURCES.ffprobe)) env.HYPERFRAMES_FFPROBE_PATH = hfEnv.BUILTIN_RESOURCES.ffprobe;
    // 内置 Chrome headless-shell（避免渲染时去 .cache 重新下载；量时间轴那一步也用它）
    if (hfEnv.BUILTIN_RESOURCES.chromeShell) {
      env.PRODUCER_HEADLESS_SHELL_PATH = hfEnv.BUILTIN_RESOURCES.chromeShell;
    }

    // 裁定成片时长（①模型声明 > ②现场量时间轴 > ③最长媒体）+ 裁超长媒体副本，详见 prepareEntry()
    // 成片画布同样在这里定：项目属性（载荷带下来），非法/缺省一律落 DEFAULT_CANVAS（绝不能"不传"——
    // 不传就写不出舞台 data-width/data-height，CLI 兜底 1080x1920，成片变竖屏，见 applyCanvasSize）
    const wanted = payload && payload.canvas
    const canvas: RenderCanvas = wanted && RENDER_CANVASES.indexOf(wanted) >= 0 ? wanted : DEFAULT_CANVAS
    let entry = ''
    try {
      entry = await prepareEntry({
        localized,
        tmpDir,
        projDir,
        env,
        chrome: env.PRODUCER_HEADLESS_SHELL_PATH || '',
        canvas
      })
      fs.writeFileSync(entryHtml, entry, 'utf8')
    } catch (e) {
      return { ok: false, message: '准备渲染入口失败：' + ((e as Error).message || String(e)) } as VideoRenderResult;
    }

    return new Promise<VideoRenderResult>((resolve) => {

      // 渲染档位：只把载荷里显式给出的合法值拼进 CLI 参数（缺省交给 CLI 自己的默认 standard / 30）。
      // -c 用「相对项目根的路径」（CLI 的硬要求：入口必须落在项目根之内，它也接受绝对路径但相对更稳）。
      const renderArgs = [hfCli, 'render', '-c', '.render-tmp/entry.html', '-o', outMp4];
      const renderOpts = pickRenderOverride(payload);
      if (renderOpts.quality) renderArgs.push('--quality', renderOpts.quality);
      if (renderOpts.fps) renderArgs.push('--fps', String(renderOpts.fps));

      const child = spawn(nodeRt.cmd, renderArgs, {
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
      child.on('error', (err) => done({ ok: false, message: '启动渲染失败：' + err.message + '（node: ' + (nodeRt.cmd || 'null') + '）' }));
      child.on('close', (code) => {
        // 渲染入口是临时物（几十 KB）：无论成败都清掉，不把中间产物留在项目里。
        // 成品的清理不需要做——它就直接长在 video/output.mp4，不存在"从工作目录搬回来"这一步。
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 被占用则留着，下次渲染前会先删 */ }
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
