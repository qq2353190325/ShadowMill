// src/main/cast/demo.ts
// 「角色」页 · 动作示范：**会动的那一页**（预览页 preview.ts 只会画静态一帧）。
//
// 角色本身不含动画——它是纯绘制函数 `window.__cast[id](x, y, u, o)`，动画全靠调用方按时间算出
// o 里的参数（walk / aL / aR / eyes / mouth / blink / dy / dx / rot / sq）。所以这一页做的事
// 就是章节在正片里做的事：按一个动作（见 shared/types.ts 的 CastActionDef）把参数算出来，
// 逐帧调用角色函数重画。动作数据与角色代码一起内联进这一页，换动作只改 URL 的 #hash（不重新加载文档）。
//
// 为什么还是落在 <userData>/cast-preview/：那是 hgpreview 的白名单目录（`?user=1`，见 main/index.ts
// 的 USER_PREVIEW_DIRS），角色库在 userData 下、与任何项目无关，所以示范页不能放进项目目录。
//
// 已知边界（写进页面提示，不是 bug）：水彩角色（p5）走 WEBGL 画布，这条路径只画得到它传了
// `o.ctx` 的那部分——与静态预览页同一条限制。
import type { CastActionDef } from '../../shared/types'

// 示范页落在 <userData>/cast-preview/<id>.demo.html（与静态预览页同目录、不同文件名，互不覆盖）
const PREVIEW_DIR = 'cast-preview'

export function demoRelPath(id: string): string {
  return PREVIEW_DIR + '/' + String(id || '') + '.demo.html'
}

// 内联脚本里的 `</script` 会提前截断整段（动作脚本 / 角色代码写盘时已有硬校验，这里再保一道）
function escapeInlineScript(code: string): string {
  return String(code || '').replace(/<\/(script)/gi, '<\\/$1')
}

// 页面里的动作表：数据驱动的动作只留 keys；代码动作只留一个 `code: true` 标记
// （**源码不放进 JSON**，它另外拼成 `FNS[id] = 函数`——页面里靠这个标记决定该走哪条路）
function actionsJson(actions: CastActionDef[]): string {
  const data = actions.map((a) => ({
    id: a.id,
    name: a.name,
    duration: a.duration,
    loop: a.loop,
    ...(a.code ? { code: true } : { keys: a.keys || [] })
  }))
  return JSON.stringify(data)
}

export function buildCastDemoHtml(opts: {
  id: string
  code: string
  core?: string
  units?: number
  title?: string
  watercolor?: boolean
  actions: CastActionDef[]
}): string {
  const id = String(opts.id || '')
  // units 与 table.ts / preview.ts 的规范口径一致：1~30，非法值落回主角默认 8
  const rawUnits = Number(opts.units)
  const units = isFinite(rawUnits) && rawUnits >= 1 && rawUnits <= 30 ? Math.round(rawUnits * 10) / 10 : 8
  const watercolor = !!opts.watercolor
  const title = String(opts.title || id || '动作示范').slice(0, 40)
  const actions = Array.isArray(opts.actions) ? opts.actions : []

  // 代码动作：原样嵌成 FNS["<id>"] = function (t) { … }（静态白名单在 actions.validateActionCode 里过一遍）
  const fnLines: string[] = ['var FNS = {};']
  for (const a of actions) {
    if (a.code) fnLines.push('FNS[' + JSON.stringify(a.id) + '] = ' + a.code.trim() + ';')
  }

  // 页内脚本：刻意不写模板字符串（避免与 TS 的插值打架），字面量一律 JSON.stringify 注入
  const pageScript = [
    '(function () {',
    '  var ID = ' + JSON.stringify(id) + ';',
    '  var UNITS = ' + String(units) + ';',
    '  var WATERCOLOR = ' + String(watercolor) + ';',
    '  var ACTS = ' + actionsJson(actions) + ';',
    '  var cv = document.getElementById("cv");',
    '  var note = document.getElementById("note");',
    '  var nameEl = document.getElementById("name");',
    '  var clockEl = document.getElementById("clock");',
    '  var playBtn = document.getElementById("play");',
    '  var replayBtn = document.getElementById("replay");',
    '  var W = 0, H = 0, DPR = 1;',
    '  var idx = 0, elapsed = 0, playing = true, last = 0, dirty = true, lastClock = 0;',
    '  function say(text, isErr) {',
    '    if (!text) { note.hidden = true; return; }',
    '    note.hidden = false;',
    '    note.textContent = text;',
    '    note.className = isErr ? "err" : "";',
    '  }',
    // 参数插值：每个参数各找"前后两个写了它"的关键帧，数字平滑过渡、枚举到点才换。
    // 这样一条关键帧只写它关心的参数（比如只写 aR 不会把别的参数打回 0）。
    '  function paramsAt(act, t) {',
    '    if (act.code) return {};',
    '    var keys = act.keys || [];',
    '    var out = {};',
    '    var union = {};',
    '    for (var i = 0; i < keys.length; i++) {',
    '      var o0 = keys[i].o || {};',
    '      for (var k0 in o0) union[k0] = 1;',
    '    }',
    '    for (var k in union) {',
    '      var prev = null, next = null;',
    '      for (var i = 0; i < keys.length; i++) {',
    '        var o = keys[i].o || {};',
    '        if (!(k in o)) continue;',
    '        if (keys[i].t <= t) prev = keys[i];',
    '        if (keys[i].t >= t && next === null) next = keys[i];',
    '      }',
    '      var a = prev ? prev.o[k] : next.o[k];',
    '      var b = next ? next.o[k] : prev.o[k];',
    '      if (typeof a === "number" && typeof b === "number") {',
    '        var f = 1;',
    '        if (prev && next && next.t > prev.t) f = (t - prev.t) / (next.t - prev.t);',
    '        if (f < 0) f = 0; if (f > 1) f = 1;',
    '        var e = f * f * (3 - 2 * f);',
    '        out[k] = a + (b - a) * e;',
    '      } else {',
    '        out[k] = a;',
    '      }',
    '    }',
    '    return out;',
    '  }',
    '  function size() {',
    '    var w = Math.max(1, cv.clientWidth);',
    '    var h = Math.max(1, cv.clientHeight);',
    '    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));',
    '    if (w === W && h === H && dpr === DPR) return false;',
    '    W = w; H = h; DPR = dpr;',
    '    cv.width = Math.round(w * dpr);',
    '    cv.height = Math.round(h * dpr);',
    '    return true;',
    '  }',
    '  function draw() {',
    '    var ctx = cv.getContext("2d");',
    '    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);',
    '    ctx.clearRect(0, 0, W, H);',
    '    var act = ACTS[idx];',
    '    if (!act) { say("这个角色还没有动作"); return; }',
    '    var fn = (window.__cast || {})[ID];',
    '    if (typeof fn !== "function") {',
    '      say("角色代码没有把绘制函数挂到 window.__cast[\\"" + ID + "\\"] 上", true);',
    '      return;',
    '    }',
    '    var o = paramsAt(act, elapsed);',
    '    if (act.code) {',
    '      var cf = FNS[act.id];',
    '      if (typeof cf === "function") {',
    '        try { var got = cf(elapsed); if (got && typeof got === "object") o = got; }',
    '        catch (e) { say("动作脚本出错：" + ((e && e.message) ? e.message : String(e)), true); return; }',
    '      }',
    '    }',
    '    o.ctx = ctx;',
    // u 与基线：比静态预览留更多上方空间（跳跃动作的 dy 是负的、要往上走），11% 边距够用
    '    var u = (H * 0.72) / UNITS;',
    '    var base = H - H * 0.11;',
    '    try {',
    '      fn(W / 2, base, u, o);',
    '    } catch (e) {',
    '      say("绘制出错：" + ((e && e.message) ? e.message : String(e)), true);',
    '    }',
    '  }',
    '  function showName() {',
    '    var act = ACTS[idx];',
    '    nameEl.textContent = act ? act.name : "（没有动作）";',
    '    playBtn.textContent = playing ? "暂停" : "继续";',
    '  }',
    '  function updateClock() {',
    '    var act = ACTS[idx];',
    '    var d = act ? act.duration : 0;',
    '    var t = Math.min(elapsed, d);',
    '    clockEl.textContent = t.toFixed(1) + " / " + d.toFixed(1) + " 秒" + (act && act.loop ? " · 循环" : "");',
    '  }',
    // 换动作：只换"演哪一条"，不重新加载页面（父级把动作 id 写进 URL 的 #hash）
    '  function pick(actionId) {',
    '    for (var i = 0; i < ACTS.length; i++) {',
    '      if (ACTS[i].id === actionId) { idx = i; break; }',
    '    }',
    '    elapsed = 0; playing = true; last = 0; dirty = true;',
    '    showName(); updateClock();',
    '  }',
    '  function tick(now) {',
    '    window.requestAnimationFrame(tick);',
    '    if (!last) last = now;',
    '    var dt = (now - last) / 1000;',
    '    last = now;',
    '    if (dt > 0.1) dt = 0.1;',
    '    var act = ACTS[idx];',
    '    var resized = size();',
    '    if (act && playing) {',
    '      elapsed += dt;',
    '      if (elapsed >= act.duration) {',
    '        if (act.loop) elapsed = elapsed % act.duration;',
    '        else { elapsed = act.duration; playing = false; showName(); }',
    '      }',
    '    }',
    '    if (playing || resized || dirty) { draw(); dirty = false; }',
    '    if (now - lastClock > 100) { lastClock = now; updateClock(); }',
    '  }',
    '  playBtn.addEventListener("click", function () {',
    '    var act = ACTS[idx];',
    '    if (act && !playing && elapsed >= act.duration) elapsed = 0;',
    '    playing = !playing; last = 0; showName();',
    '  });',
    '  replayBtn.addEventListener("click", function () {',
    '    elapsed = 0; playing = true; last = 0; dirty = true; showName();',
    '  });',
    '  window.addEventListener("hashchange", function () {',
    '    var h = "";',
    '    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = location.hash.slice(1); }',
    '    pick(h);',
    '  });',
    '  var first = "";',
    '  try { first = decodeURIComponent(location.hash.slice(1)); } catch (e) { first = ""; }',
    '  pick(first);',
    '  if (!ACTS.length) say("这个角色还没有动作：先在「角色」页新建一个，或让 AI 给它生成一个专属动作");',
    '  else if (WATERCOLOR) say("水彩角色（p5）：这里只显示它的 Canvas 2D 部分，水彩笔触要到成片页面里才看得到");',
    '  window.requestAnimationFrame(tick);',
    '})();'
  ].join('\n')

  const style = [
    'html, body { margin: 0; height: 100%; background: #EEF2F7; overflow: hidden;',
    '  font: 12px/1.4 "Microsoft YaHei UI", "PingFang SC", sans-serif; color: #46536A; }',
    '#cv { display: block; width: 100%; height: 100%; }',
    // 顶部小工具条：动作名 + 时间 + 播放/重播（换动作的列表在应用那一侧，不在这里重复）
    '#bar { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px;',
    '  padding: 6px 8px; background: rgba(255, 255, 255, 0.86); }',
    '#name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  font-weight: 600; color: #2B3446; }',
    '#clock { font-variant-numeric: tabular-nums; color: #7A879B; }',
    '#bar button { font: inherit; padding: 2px 8px; border: 1px solid rgba(0, 120, 180, 0.35);',
    '  border-radius: 6px; background: #fff; color: #1B6E9C; cursor: pointer; }',
    '#bar button:hover { background: #EAF6FC; }',
    '#note { position: absolute; left: 0; right: 0; bottom: 0; padding: 5px 7px;',
    '  font-size: 11px; line-height: 1.45; color: #46536A;',
    '  background: rgba(255, 255, 255, 0.88); white-space: pre-wrap; word-break: break-word; }',
    '#note.err { color: #A3123A; }',
    '#note[hidden] { display: none; }'
  ].join('\n')

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<title>' + title.replace(/[<>&]/g, '') + '</title>',
    '<style>\n' + style + '\n</style>',
    '</head>',
    '<body>',
    '<canvas id="cv"></canvas>',
    '<div id="bar">',
    '<span id="name"></span>',
    '<span id="clock"></span>',
    '<button id="play" type="button">暂停</button>',
    '<button id="replay" type="button">重播</button>',
    '</div>',
    '<div id="note" hidden></div>',
    // ① 共享绘制助手（core.js 原文）：角色里的 MC.paint / MC.ellPts 之类都靠它
    '<script>\n' + escapeInlineScript(opts.core || '') + '\n</script>',
    // ② 角色代码（cast/<id>.js 原文）：自己把绘制函数挂到 window.__cast 上
    '<script>\n' + escapeInlineScript(opts.code || '') + '\n</script>',
    // ③ 动作脚本（只有 AI 生成的那些有）+ 动作表 + 帧循环
    '<script>\n' + escapeInlineScript(fnLines.join('\n') + '\n' + pageScript) + '\n</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
