// src/main/chapters.ts
// 章节化长片（W3）：把一支长片拆成「一章一个 JS 文件」，并由应用**确定性**生成 index.html 骨架。
// 本文件只做四件事：① 解析模型回复（规划块 PLAN / 文件块 FILE）② 校验（id、场景范围、路径、无限循环）
// ③ 读写 pages/cNN.js ④ 装配骨架。
//
// 刻意不做的事（分工边界）：
//   · **不调模型**：提示词在 agent/html.ts，调用与编排在 projects.ts，本文件只收纯文本。
//   · **不 import projects.ts**：否则与 projects.ts 的调用形成循环依赖。目录由调用方给。
//
// 为什么这些代码留在一个文件里（351 行，刚过「该考虑拆分」的 300 线）：整体的对象只有一个——
// **章节的文件格式与骨架契约**。解析、校验、写盘、装配四步读的是同一份 ProjectChapter 定义，
// 拆成四个文件后每一步都要把「另一条规则」重新讲一遍（例如「chapterFrom 是 1 起的有效场景序号」
// 在解析、校验、拼骨架三处都要成立），反而更难维护。
//
// 为什么骨架由应用写（而不是让模型写 index.html）：
//   舞台尺寸、data-duration、章节 script 顺序、__timelines 登记、音轨注入这五件事都必须与
//   「当前章节清单」严格一致，而模型每次重写整份 HTML 都可能写错一处。骨架由应用生成后，
//   模型只改 pages/cNN.js —— 改一章永远不会改坏画布、时长与合规结构。
import path from 'node:path'
import fs from 'node:fs'
import { CANVAS_SIZES } from '../shared/constants'
import type { ProjectCastMember, ProjectChapter, RenderCanvas } from '../shared/types'

// 章节文件所在的项目内子目录与命名：pages/c01.js（与 CODE_FILM_PLAN 的 W3 一致）
const CHAPTER_DIR = 'pages'
const ID_RE = /^c\d{2,3}$/
// 模型写 id 时偶尔会少补零（`c1`）：这里统一补成 `c01`，否则既对不上文件名、也让排序错乱（c10 < c2）。
// 补零后只认 ID_RE 的两位/三位形态，所以文件名始终是 pages/c01.js 这一种。
const RAW_ID_RE = /^c(\d{1,3})$/i
const FILE_RE = /^pages\/(c\d{2,3})\.js$/
// 单章上限：超过它就是「一次生成一定被 max_tokens 截断」的量级（实测一章 15–25 s 的代码约 30–70 KB）
const MAX_CHAPTER_SECONDS = 180
// 章节能声明的随包库（骨架据此按需引入）。白名单：只有这两个是 UMD、能在经典 <script> 里同步加载；
// three.js 要 importmap + module（异步），章节脚本可能先跑，所以章节模式暂不支持。
const USES_WHITELIST = ['p5', 'p5.brush']

export function chapterRelPath(id: string): string {
  return CHAPTER_DIR + '/' + id + '.js'
}

// ===== 规划回复的解析 =====
// 规划调用的输出契约（见 agent/html.ts 的 HTML_PLAN_SYSTEM）：
//   <<<PLAN>>>
//   {"mode":"single","reason":"…"}  或  {"mode":"chapters","chapters":[{"id":"c01",…}]}
//   <<<END PLAN>>>
// 容错：没有 PLAN 标记时，退回「整段回复当 JSON」与「```json 围栏里的内容」两种写法。
export type ChapterPlanReply =
  | { mode: 'single'; reason: string }
  | { mode: 'chapters'; chapters: ProjectChapter[] }

const PLAN_BLOCK_RE = /<<<PLAN>>>([\s\S]*?)<<<END\s*PLAN>>>/i
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i

function tryJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(String(text || '').trim())
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch (e) { return null }
}

// 章节 id 归一：`c1` / `C1` / `c01` 都收，统一成 `c01`；不合法返回 ''
function normalizeId(raw: unknown): string {
  const m = String(raw === undefined || raw === null ? '' : raw).trim().match(RAW_ID_RE)
  return m ? 'c' + m[1].padStart(2, '0') : ''
}

// 章节数组 → 规范化后的 ProjectChapter[]；不合法直接给错误文案（调用方据此退回单文件模式）
function normalizeChapters(raw: unknown, validSceneCount: number): { chapters: ProjectChapter[]; error?: string } {
  if (!Array.isArray(raw) || !raw.length) return { chapters: [], error: '规划里没有 chapters 数组' }
  if (raw.length > 40) return { chapters: [], error: '章节数过多（' + raw.length + ' 章）' }
  const out: ProjectChapter[] = []
  const seen = new Set<string>()
  let picked = 0
  for (let i = 0; i < raw.length; i++) {
    const it = (raw[i] && typeof raw[i] === 'object' && !Array.isArray(raw[i])) ? raw[i] as Record<string, unknown> : {};
    const id = normalizeId(it.id)
    if (!id) return { chapters: [], error: '第 ' + (i + 1) + ' 章的 id 不合法（必须是 c01 这种纯序号）：' + String(it.id) }
    if (seen.has(id)) return { chapters: [], error: '章节 id 重复：' + id }
    seen.add(id)
    const duration = Number(it.duration)
    if (!isFinite(duration) || duration <= 0) return { chapters: [], error: '第 ' + (i + 1) + ' 章缺少有效的 duration（秒数）' }
    if (duration > MAX_CHAPTER_SECONDS) {
      return { chapters: [], error: '第 ' + (i + 1) + ' 章时长 ' + duration + ' 秒，超过单章上限 ' + MAX_CHAPTER_SECONDS + ' 秒（应拆成更短的段落）' }
    }
    // 场景范围：连续、升序、落在有效场景数之内 —— 这是「章边界不切在场景中间」的执行点
    let sceneFrom = 0
    let sceneTo = 0
    const scenes = Array.isArray(it.scenes) ? it.scenes.map((n) => Number(n)) : []
    if (validSceneCount > 0) {
      if (!scenes.length) return { chapters: [], error: '第 ' + (i + 1) + ' 章缺少 scenes（本章覆盖的场景序号）' }
      for (let k = 0; k < scenes.length; k++) {
        const n = scenes[k]
        if (!Number.isInteger(n) || n < 1 || n > validSceneCount) {
          return { chapters: [], error: '第 ' + (i + 1) + ' 章的 scenes 出现越界序号 ' + String(scenes[k]) + '（有效场景 1–' + validSceneCount + '）' }
        }
        if (k > 0 && n !== scenes[k - 1] + 1) return { chapters: [], error: '第 ' + (i + 1) + ' 章的 scenes 必须连续：' + scenes.join(',') }
      }
      sceneFrom = scenes[0]
      sceneTo = scenes[scenes.length - 1]
      picked += scenes.length
    } else if (scenes.length) {
      sceneFrom = Math.min(...scenes)
      sceneTo = Math.max(...scenes)
    }
    const title = typeof it.title === 'string' ? it.title.trim().slice(0, 80) : ''
    const summary = typeof it.summary === 'string' ? it.summary.trim().slice(0, 200) : ''
    // uses：只认白名单里的库，并按白名单顺序固定输出（'p5.brush' 隐含 'p5'，骨架会按这个顺序引入，
    // 免得模型把两个库写反、或写成 three 之类章节模式用不了的库）
    const useSet = new Set<string>()
    for (const u of (Array.isArray(it.uses) ? it.uses : [])) {
      const name = String(u || '').trim().toLowerCase()
      if (USES_WHITELIST.indexOf(name) >= 0) useSet.add(name)
    }
    if (useSet.has('p5.brush')) useSet.add('p5')
    const uses = USES_WHITELIST.filter((u) => useSet.has(u))
    // cast：本章用到哪些角色（id 必须与角色表里的 id 一致；不存在的 id 由调用方按错误处理）
    const castRefs: string[] = []
    for (const c of (Array.isArray(it.cast) ? it.cast : [])) {
      const id = String(c === undefined || c === null ? '' : c).trim().toLowerCase()
      if (id && castRefs.indexOf(id) < 0) castRefs.push(id)
    }
    out.push({
      id, title: title || id, duration: Math.round(duration * 100) / 100, sceneFrom, sceneTo, summary,
      ...(uses.length ? { uses } : {}),
      ...(castRefs.length ? { cast: castRefs } : {})
    })
  }
  if (validSceneCount > 0 && picked !== validSceneCount) {
    return { chapters: [], error: '章节覆盖的场景数与内容脚本不一致：共 ' + validSceneCount + ' 场，划分里覆盖了 ' + picked + ' 场（要求不重不漏）' }
  }
  // 按章号排序：模型偶尔会把 c03 写在 c02 前面，时间偏移靠这个顺序算
  out.sort((a, b) => a.id.localeCompare(b.id))
  return { chapters: out }
}

export function parsePlanReply(reply: string, validSceneCount: number): { plan: ChapterPlanReply | null; error?: string } {
  const text = String(reply || '')
  const candidates: string[] = []
  const block = text.match(PLAN_BLOCK_RE)
  if (block) candidates.push(block[1])
  const fence = text.match(FENCE_RE)
  if (fence) candidates.push(fence[1])
  candidates.push(text)
  let json: Record<string, unknown> | null = null
  for (const c of candidates) { json = tryJson(c); if (json) break }
  if (!json) return { plan: null, error: '规划回复里找不到可解析的 JSON' }
  const mode = json.mode === 'chapters' ? 'chapters' : 'single'
  if (mode === 'single') {
    return { plan: { mode: 'single', reason: typeof json.reason === 'string' ? json.reason.trim().slice(0, 200) : '' } }
  }
  const n = normalizeChapters(json.chapters, validSceneCount)
  if (n.error) return { plan: null, error: n.error }
  return { plan: { mode: 'chapters', chapters: n.chapters } }
}

// ===== 章节回复的解析 =====
// 逐章生成与「按需求修改」共用同一种文件块，一个回复可以带多个块（修改时模型只回它改过的那些）：
//   <<<FILE pages/c03.js>>>
//   ...JS...
//   <<<END FILE>>>
// fallbackPath：逐章生成时已知目标文件；模型若没包 FILE 标记，把整段回复当作该文件内容。
const FILE_BLOCK_RE = /<<<FILE\s+([^\s>]+)\s*>>>([\s\S]*?)<<<END\s*FILE>>>/gi

function normalizeFileRel(raw: string): string {
  const p = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  return p
}

// 通用文件块解析：accept 决定哪些路径合法（章节 pages/cNN.js、角色 cast/<id>.js 共用这一套标记与解析）。
// 不合法的路径不静默丢，收进 badPaths 由调用方决定怎么报。
export function parseFileBlocksWith(reply: string, accept: (rel: string) => boolean, fallbackPath?: string): { files: { path: string; code: string }[]; badPaths: string[] } {
  const text = String(reply || '')
  const files: { path: string; code: string }[] = []
  const badPaths: string[] = []
  let m: RegExpExecArray | null
  FILE_BLOCK_RE.lastIndex = 0
  while ((m = FILE_BLOCK_RE.exec(text)) !== null) {
    const rel = normalizeFileRel(m[1])
    const code = String(m[2] || '').trim()
    if (!accept(rel)) { badPaths.push(rel); continue }
    files.push({ path: rel, code })
  }
  if (!files.length && fallbackPath) {
    // 没包标记：去掉可能的 ``` 围栏后整体当这一个文件的内容（模型偶尔直接吐裸代码）
    const fence = text.match(FENCE_RE)
    const code = (fence ? fence[1] : text).trim()
    if (code) files.push({ path: normalizeFileRel(fallbackPath), code })
  }
  return { files, badPaths }
}

// 章节文件：只认 pages/cNN.js
export function parseFileBlocks(reply: string, fallbackPath?: string): { files: { path: string; code: string }[]; badPaths: string[] } {
  return parseFileBlocksWith(reply, (rel) => FILE_RE.test(rel), fallbackPath)
}

// 章节代码的硬校验（写盘前做，免得坏代码落到盘上再让渲染端去猜）
export function validateChapterCode(code: string): string | null {
  const c = String(code || '')
  if (!c.trim()) return '章节代码是空的'
  // 与 video.ts 的渲染前护栏同一个理由：GSAP 把 repeat:-1 当 1e10 秒，成片时长会变成 317 年
  if (/repeat\s*:\s*(?:-1|Infinity)\b/i.test(c.replace(/\s+/g, ' '))) {
    return '章节代码里有无限循环（repeat: -1），成片时长无法确定；请改成有限次数（如 repeat: 12, repeatDelay: 0.4）'
  }
  if (!/\bbuild\s*[:(]/.test(c) || !/__chapters/.test(c)) {
    return '章节代码没有按契约登记：需要 window.__chapters["cNN"] = { build: function (stage) { … } }'
  }
  if (/<\/script/i.test(c)) return '章节代码里出现了 </script，会截断页面'
  return null
}

// ===== 读写章节文件 =====
function chapterFilesOnDisk(dir: string): string[] {
  try {
    const d = path.join(dir, CHAPTER_DIR)
    if (!fs.existsSync(d)) return []
    return fs.readdirSync(d).filter((f) => ID_RE.test(f.replace(/\.js$/i, '')) && /\.js$/i.test(f))
  } catch (e) { return [] }
}

// 写入给定的章节文件；同时删掉「清单里没有的孤儿章节文件」（旧章节目录残留会让下次读盘读到别的内容）
export function writeChapterFiles(dir: string, chapters: ProjectChapter[], files: { path: string; code: string }[]): { written: string[]; removed: string[] } {
  const pagesDir = path.join(dir, CHAPTER_DIR)
  fs.mkdirSync(pagesDir, { recursive: true })
  const want = new Set(chapters.map((c) => c.id + '.js'))
  const written: string[] = []
  for (const f of files) {
    const name = path.basename(f.path)
    if (!want.has(name)) continue   // 规划里没有这章：不写（避免生成多余文件）
    fs.writeFileSync(path.join(pagesDir, name), String(f.code).trim() + '\n', 'utf8')
    written.push(name)
  }
  const removed: string[] = []
  for (const name of chapterFilesOnDisk(dir)) {
    if (want.has(name)) continue
    try { fs.rmSync(path.join(pagesDir, name), { force: true }); removed.push(name) } catch (e) { /* 删不掉不影响本次生成 */ }
  }
  return { written, removed }
}

// 清空整个章节目录（从章节模式切回单文件模式时用：留着孤儿文件只会让时长/护栏扫到旧内容）
export function removeChapterFiles(dir: string): string[] {
  const pagesDir = path.join(dir, CHAPTER_DIR)
  const removed: string[] = []
  for (const name of chapterFilesOnDisk(dir)) {
    try { fs.rmSync(path.join(pagesDir, name), { force: true }); removed.push(name) } catch (e) { /* ignore */ }
  }
  return removed
}

// 读回章节源码（修改时给模型看；缺失的章节返回空串，由调用方决定是否报错）
export function readChapterCode(dir: string, chapters: ProjectChapter[]): { id: string; title: string; code: string }[] {
  return chapters.map((c) => {
    let code = ''
    try {
      const p = path.join(dir, CHAPTER_DIR, c.id + '.js')
      if (fs.existsSync(p)) code = fs.readFileSync(p, 'utf8')
    } catch (e) { /* 读不到就当空 */ }
    return { id: c.id, title: c.title, code }
  })
}

// ===== 时间：偏移与总长 =====
export function totalDuration(chapters: ProjectChapter[]): number {
  return chapters.reduce((s, c) => s + (isFinite(c.duration) && c.duration > 0 ? c.duration : 0), 0)
}

// 每章在整片里的起始秒数（与 chapters 同序）：第 1 章 0，第 n 章 = 前 n-1 章时长之和
export function chapterOffsets(chapters: ProjectChapter[]): number[] {
  const out: number[] = []
  let at = 0
  for (const c of chapters) { out.push(Math.round(at * 1000) / 1000); at += isFinite(c.duration) && c.duration > 0 ? c.duration : 0 }
  return out
}

// ===== 骨架 index.html =====
// 这张骨架是「章节模式的全部结构真相」：舞台 / 画布 / 章节脚本顺序 / 主时间轴装配 / __timelines 登记 / 时长。
// 逐章脚本只负责往自己的容器里画，并从 0 开始返回一条 timeline；装配（累加偏移、控制各章显隐）在这里做一次。
// 契约要点（写进 agent/html.ts 的 HTML_CHAPTER_SYSTEM）：
//   · 章节的 timeline **不要 paused**：master 是 paused 的，paused 的子时间轴跟着 master 不会推进；
//   · 章节只建自己那一段，**不注册 __timelines**（骨架末尾统一登记 "main"，与 data-composition-id 对齐）；
//   · 每章拿到的 stage 是骨架给它新建的专属容器（铺满画布、只在本章时间窗内显示），
//     所以「上一章的画面残留」不会透到下一章下面 —— 这是 GSAP 式章节与 PDoom「每帧重画整幅」的关键差别。
export function buildSkeleton(opts: { chapters: ProjectChapter[]; canvas: RenderCanvas; total: number; cast?: ProjectCastMember[] }): string {
  const size = CANVAS_SIZES[opts.canvas] || CANVAS_SIZES.landscape
  const total = Math.max(0, opts.total)
  const totalText = total.toFixed(2)
  const ids = opts.chapters.map((c) => ({ id: c.id, d: Math.round(c.duration * 100) / 100 }))
  const tags = opts.chapters.map((c) => '<script src="./' + chapterRelPath(c.id) + '"></script>').join('\n')
  // 随包库按需引入（只看 union，不看是哪一章要）：顺序固定 gsap → p5 → p5.brush，
  // p5.brush 是 p5 的插件，必须后于 p5 加载。
  // 并集要**同时**算章节的 uses 与角色的 uses：只有角色用水彩、没有任何章声明 p5 时，
  // 光看章节就会漏引 p5，角色一调用就崩。
  const needs = new Set<string>()
  for (const c of opts.chapters) for (const u of (c.uses || [])) needs.add(u)
  for (const m of (opts.cast || [])) for (const u of (m.uses || [])) needs.add(u)
  if (needs.has('p5.brush')) needs.add('p5')
  // 角色脚本：**传进来的 cast 就是"要引入的那几个"**（调用方只传勾选参与本次生成的角色），
  // 按角色表顺序插入；必须**先于**章节脚本加载，章节里 `window.__cast["hero"]` 才拿得到
  // （PDoomVideo 也是把 clawd.js / cast.js 放在 ch/*.js 之前）。
  // 注意：这里**不再依据「各章 cast 的并集」**——角色是项目素材，与怎么拆章无关。
  const castList = opts.cast || []
  const castTags = castList.map((m) => '<script src="./cast/' + m.id + '.js"></script>').join('\n')
  // 共享绘制助手 core.js：由应用内置、按版本同步进项目（见 main/coreLib.ts）。
  // 位置在 p5 / p5.brush **之后**（core.js 的水彩路线直接用 window.brush）、角色与章节**之前**。
  // 章节模式一律引入：DOM/CSS 章节用不上它，但那 8 KB 换来"想画水彩就有"。
  const libTags = [
    '<script src="./gsap.min.js"></script>',
    needs.has('p5') ? '<script src="./p5.min.js"></script>' : '',
    needs.has('p5.brush') ? '<script src="./p5.brush.js"></script>' : '',
    '<script src="./core.js"></script>',
    castTags
  ].filter(Boolean).join('\n')
  const plan = JSON.stringify(ids)
  return [
    '<!DOCTYPE html>',
    '<html data-resolution="' + opts.canvas + '" data-composition-duration="' + totalText + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;padding:0;background:#000;overflow:hidden}',
    '#stage{position:relative;width:' + size.width + 'px;height:' + size.height + 'px;overflow:hidden}',
    '</style>',
    '</head>',
    '<body>',
    '<div data-composition-id="main" data-width="' + size.width + '" data-height="' + size.height + '" data-duration="' + totalText + '">',
    '<div id="stage"></div>',
    '</div>',
    libTags,
    tags,
    '<script>',
    '// 由应用生成：按章节清单把各章的 timeline 依次装进主时间轴（本章时间从 0 开始，偏移在这里累加）',
    '(function () {',
    '  var PLAN = ' + plan + ';',
    '  var stage = document.getElementById("stage");',
    '  var master = window.gsap ? window.gsap.timeline({ paused: true }) : null;',
    '  var at = 0;',
    '  for (var i = 0; i < PLAN.length; i++) {',
    '    var p = PLAN[i];',
    '    var ch = window.__chapters && window.__chapters[p.id];',
    '    if (!master) break;',
    '    if (!ch || typeof ch.build !== "function") { console.warn("[骨架] 章节缺少 build()：" + p.id); at += p.d; continue; }',
    '    // 每章一个专属容器：只在它自己的时间窗内显示。',
    '    // 为什么不把各章都挂到同一个 stage 上：GSAP 章节是"往 DOM 里加东西"，不像 PDoom 那样每帧重画整幅，',
    '    // 上一章的节点会一直留在下面；没有这层显隐控制，下一章的入场淡入期间会透出上一章的残影。',
    '    var box = document.createElement("div");',
    '    box.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:none";',
    '    stage.appendChild(box);',
    '    master.set(box, { display: "block" }, at);',
    '    master.set(box, { display: "none" }, at + p.d);',
    '    try {',
    '      var tl = ch.build(box);',
    '      if (tl && typeof tl.add === "function") master.add(tl, at);',
    '      else console.warn("[骨架] 章节没有返回时间轴：" + p.id);',
    '    } catch (e) { console.error("[骨架] 章节构建失败：" + p.id, e); }',
    '    at += p.d;',
    '  }',
    '  window.__timelines = window.__timelines || {};',
    '  window.__timelines["main"] = master;',
    '})();',
    '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

// 导出单个 HTML 用：把章节 / 角色的 <script src="./x"> 换成内联脚本。
// 不内联的话，导出的文件离开项目目录后 pages/ 与 cast/ 都不存在，页面就是空白（动画完全不跑）。
export function inlineChapters(html: string, sources: { path: string; code: string }[]): string {
  let out = String(html || '')
  for (const s of sources) {
    if (!s.code) continue
    const safe = s.code.replace(/<\/script/gi, '<\\/script')
    const rel = String(s.path || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp('<script\\b[^>]*\\bsrc\\s*=\\s*["\'](?:\\./)?' + rel + '["\'][^>]*>\\s*</script>', 'gi')
    out = out.replace(re, '<script>\n' + safe + '\n</script>')
  }
  return out
}

// 给提示词用的章节大纲（逐章生成与修改都带上；不含源码，省 token）
export function chapterOutlineText(chapters: ProjectChapter[]): string {
  const offs = chapterOffsets(chapters)
  return chapters.map((c, i) => {
    const a = offs[i]
    const b = Math.round((a + c.duration) * 100) / 100
    const sceneText = c.sceneFrom > 0 ? '场景 ' + c.sceneFrom + '–' + c.sceneTo : '无内容脚本'
    const useText = c.uses && c.uses.length ? '［随包库：' + c.uses.join(' + ') + '］' : ''
    const castText = c.cast && c.cast.length ? '［角色：' + c.cast.join('、') + '］' : ''
    return '第 ' + (i + 1) + ' 章 ' + c.id + '（' + a.toFixed(2) + '–' + b.toFixed(2) + ' 秒，' + c.duration.toFixed(2) + ' 秒，' + sceneText + '）：'
      + c.title + (c.summary ? ' —— ' + c.summary : '') + useText + castText
  }).join('\n')
}
