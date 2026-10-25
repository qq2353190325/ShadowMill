// src/main/cast/preview.ts
// 「这个角色长什么样」的**静态预览页**（「角色」页的卡片墙 / 新建与改画法的弹窗）。
//
// 为什么需要它：角色不是图片，而是 `<id>.js` 里登记的绘制函数
// `window.__cast["hero"] = function (x, y, u, o) { … o.ctx … }`——不真的跑一遍，
// 界面上就只有一个文件名可看（建完也判断不出 AI 到底画成了什么样）。
//
// 为什么是「一页自包含 HTML」而不是让页面去 <script src> 那份角色代码：
//   · 角色库在 <userData>/cast-library/，与任何项目都无关；而 hgpreview:// 默认只放行**项目目录**
//     （见 main/index.ts 的 resolveHgPreviewPath）——所以预览页单独落在 <userData>/cast-preview/，
//     由那条路由的白名单放行（`?user=1`，与 tts 产物同一套）；
//   · 把 core.js 与角色代码内联进来，一页就能独立跑，也不必为 p5 之类的依赖再往项目里铺文件。
//
// 谁负责落盘：projects/ 的 `cast:preview`。本文件只拼字符串，
// 不 import electron、不读写文件（与 coreLib.ts / library.ts 同一套可离线测试的写法）。
//
// 已知边界（写进页面里的提示，不是 bug）：
//   · 预览是**静态一帧**——角色本身是纯绘制函数，动画由章节的时间轴驱动，这里只画一次；
//   · 声明了 p5 / p5.brush 的水彩角色走的是 p5 的 WEBGL 画布，这条路径只画得到它
//     传了 `o.ctx` 的那些部件，所以页内会标一句「只显示 Canvas 2D 部分」。

// 预览页落在 <userData>/cast-preview/ 下（与角色库并列的临时目录、同 id 覆盖）：
// 一个角色一份文件，所以并发预览多个角色时互不覆盖。
const PREVIEW_DIR = 'cast-preview'

// 预览页相对 **userData** 的路径（渲染层用 utils/url.ts 的 userFileUrl 拼成 hgpreview://...?user=1）。
export function previewRelPath(id: string): string {
  return PREVIEW_DIR + '/' + String(id || '') + '.html'
}

// 内联脚本里的 `</script` 会提前截断整段（角色代码写盘时已有硬校验挡 HTML 标签，这里再保一道）
function escapeInlineScript(code: string): string {
  return String(code || '').replace(/<\/(script)/gi, '<\\/$1')
}

// 拼一页预览页：canvas + core.js + 角色代码 + 调用脚本。
// id / units / watercolor / title 决定「调用哪个函数、画多大、给什么提示」，不改任何源文件。
export function buildCastPreviewHtml(opts: {
  id: string
  code: string
  core?: string
  units?: number
  title?: string
  watercolor?: boolean
}): string {
  const id = String(opts.id || '')
  // units 与 table.ts 的规范口径一致：1~30，非法值落回主角默认 8
  const rawUnits = Number(opts.units)
  const units = isFinite(rawUnits) && rawUnits >= 1 && rawUnits <= 30 ? Math.round(rawUnits * 10) / 10 : 8
  const watercolor = !!opts.watercolor
  const title = String(opts.title || id || '角色预览').slice(0, 40)

  // 页内脚本：刻意不写模板字符串（避免与 TS 的插值打架），字面量一律 JSON.stringify 注入
  const pageScript = [
    '(function () {',
    '  var ID = ' + JSON.stringify(id) + ';',
    '  var UNITS = ' + String(units) + ';',
    '  var WATERCOLOR = ' + String(watercolor) + ';',
    '  var cv = document.getElementById("cv");',
    '  var note = document.getElementById("note");',
    '  function say(text, isErr) {',
    '    if (!text) { note.hidden = true; return; }',
    '    note.hidden = false;',
    '    note.textContent = text;',
    '    note.className = isErr ? "err" : "";',
    '  }',
    '  function draw() {',
    '    var W = Math.max(1, cv.clientWidth);',
    '    var H = Math.max(1, cv.clientHeight);',
    // 预览位很窄（< 120px）时塞不下整句话：只给一个短标记，别让提示条盖住角色本身
    // （现在三处预览位都不窄：角色卡片 130px、全局库方格 132px、新建大图 200px ⇒ 此分支不触发，留作更小格子的兜底）
    '    var small = W < 120;',
    '    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));',
    '    cv.width = Math.round(W * dpr);',
    '    cv.height = Math.round(H * dpr);',
    '    var ctx = cv.getContext("2d");',
    '    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);',
    '    ctx.clearRect(0, 0, W, H);',
    '    var fn = (window.__cast || {})[ID];',
    '    if (typeof fn !== "function") {',
    '      say(small ? "⚠" : "角色代码没有把绘制函数挂到 window.__cast[\\"" + ID + "\\"] 上", true);',
    '      return;',
    '    }',
    '    // u = 1 个单位的像素数：上下各留 8%，让整身高（UNITS 个 u）都进画面（(x, y) 是脚底中点）',
    '    var u = (H * 0.84) / UNITS;',
    '    try {',
    '      fn(W / 2, H - H * 0.08, u, { ctx: ctx });',
    '    } catch (e) {',
    '      say(small ? "⚠" : "绘制出错：" + ((e && e.message) ? e.message : String(e)), true);',
    '      return;',
    '    }',
    '    // 画出来是空的？典型原因是这个角色只走 p5 的水彩画布（那需要章节里的 p5 实例，静态预览没有）',
    '    var empty = true;',
    '    try {',
    '      var data = ctx.getImageData(0, 0, cv.width, cv.height).data;',
    '      for (var i = 3; i < data.length; i += 4) { if (data[i] !== 0) { empty = false; break; } }',
    '    } catch (e) { empty = false; }  // 读不到像素就当它画了东西，别误报',
    '    if (empty) {',
    '      say(small ? "空" : (WATERCOLOR',
    '        ? "水彩角色（p5）：这里画不出它的水彩笔触，生成后的页面里才看得到"',
    '        : "这个角色没有在预览画布上画出内容（可能依赖 p5 画布，或需要章节传参）"), false);',
    '    } else if (WATERCOLOR) {',
    '      say(small ? "水彩" : "水彩角色（p5）：这里只显示它的 Canvas 2D 部分", false);',
    '    }',
    '  }',
    '  // iframe 刚插进 DOM 时可能还没布局（clientWidth = 0）：等下一帧再试，最多十来帧',
    '  function boot(tries) {',
    '    if ((cv.clientWidth < 2 || cv.clientHeight < 2) && tries > 0) {',
    '      window.requestAnimationFrame(function () { boot(tries - 1); });',
    '      return;',
    '    }',
    '    draw();',
    '  }',
    '  boot(12);',
    '})();'
  ].join('\n')

  const style = [
    'html, body { margin: 0; height: 100%; background: #EEF2F7; overflow: hidden; }',
    '#cv { display: block; width: 100%; height: 100%; }',
    // 提示条压在画布底部：它只在「出错 / 空画 / 水彩角色」时说一句话，正常角色不占地方
    '#note { position: absolute; left: 0; right: 0; bottom: 0; padding: 5px 7px;',
    '  font: 11px/1.45 "Microsoft YaHei UI", "PingFang SC", sans-serif; color: #46536A;',
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
    '<div id="note" hidden></div>',
    // ① 共享绘制助手（core.js 原文）：角色里的 MC.paint / MC.ellPts 之类都靠它；
    //    传了 ctx 就是 Canvas 2D 路线，所以没有 p5 也画得出来（inkLine 这类水彩助手会自己 return）
    '<script>\n' + escapeInlineScript(opts.core || '') + '\n</script>',
    // ② 角色代码（cast/<id>.js 原文）：自己把绘制函数挂到 window.__cast 上
    '<script>\n' + escapeInlineScript(opts.code || '') + '\n</script>',
    // ③ 调用一次
    '<script>\n' + pageScript + '\n</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
