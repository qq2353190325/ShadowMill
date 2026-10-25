// core.js —— 影坊的共享绘制助手（应用内置、随项目复制一份；CORE_VERSION 变化时应用会覆盖这一份）
//
// 为什么要有这个文件：章节与角色都是"用代码画形状"，每个形状若都手写一串 p5.brush 调用
// （noStroke / fill / fillBleed / fillTexture / polygon …），代码会长得离谱，而且每个角色自己拧
// 一遍参数，笔触质感就对不齐。这一层把「一个形状 = 一次 paint(点列, 选项)」封起来，
// 并提供几何点列生成、缓动与**确定性抖动**（替掉 Math.random，保证 seek 到任意一帧都能重现）。
//
// 用法（章节与角色都能用，脚本由骨架在 gsap / p5 之后、章节之前引入）：
//   MC.paint(MC.ellPts(0, 0, 40, 40), { wash: '#D97757', fill: '#2B2233', ink: '#2B2233' })
//   MC.jit(帧号 * 7, 1.5)        ← 抖动：同一个 seed 永远得到同一个偏移
//   MC.ease(MC.clamp(t / 2))     ← 缓动
//
// 两条硬约定：
//   ① 有 p5 + p5.brush 时用笔刷画（水彩质感的来源）；没有时传 opts.ctx（Canvas 2D 上下文）也能画，
//      只是变成平涂 + 描边。**同一个形状两种模式都该能画出来。**
//   ② 不许引入**有状态**的时间概念：不读 Date.now / 不自己跑 rAF 与时间轴（动画由章节的时间轴驱动）。
//      **纯函数式**的「时间 → 拍位 / 扫色进度」换算是允许且必须在这一层做的，见 v7 的
//      beatAt / beatN / pulse / pulse2 / karaoke / karaokeBand。
//
// 本文件**必须保持单文件**：骨架按 `./core.js` 给每个项目复制一份、按 CORE_VERSION 覆盖（见 coreLib.ts）。
// 拆成多文件会让每个项目多出几个引用与同步点，而且没有第二个入口去聚合它们。
(function () {
  'use strict';

  // 这个常量是「应用要不要覆盖项目里这一份」的唯一判据，**改这个文件就必须调大它**
  // v2：新增 castLayer / clearLayer（角色层的分层约定）
  // v3：p5 走**实例模式**——paint 从 o.p / window.__p5Active 取实例来 push/pop（章节模式下 p5 没有全局函数）
  // v4：实探发现 window.brush **没有** activateInstance / deactivateInstance 这两个导出（它们在内部 runtime
  //     adapter 上），对外只有 `brush.instance(p)`。paint 在画之前用 brush.instance(P) 显式激活，
  //     这样"在 p5 的 draw() 之外调用"也能正确落到本实例上。
  // v5：实探发现笔型名写 `ink` 会报 `Brush "ink" not found`（`ink` 在本文件里是**墨线颜色**，不是笔型名）。
  //     p5.brush 2.2.3 只有 pen/rotring/2B/HB/2H/cpencil/pastel/crayon/charcoal/spray/marker 这 11 种笔型，
  //     默认改成 `pen`，传错的名字一律退回 `pen`（别让一次笔型拼错把整个形状的描边炸掉）。
  // v6：加 `PRESETS`（wash / soak / grain / light / inked）+ `paint` 的 `preset` 选项。实测「平涂还是水彩」
  //     全看 bleed / tex / fillOp 这几个数，把好用的组合命好名，模型用名字而不是每次自己拧。
  // v7：卡拍与卡拉OK 收进这一层：`beatAt / beatN / pulse / pulse2`（BPM + 偏移 → 拍位 / 击拍脉冲，**BPM 由调用方自己定**）、
  //     `karaoke / karaokeBand`（按字符估唱速的扫色进度与字幕条绘制）。理由：参考实现（PDoomVideo）就是
  //     把 88 BPM / 0.21s 写死在代码里，并不存在「节拍网格」输入；而每章手写这套换算必然踩同一个坑
  //     （把拍和小节搞混、用 Math.random 抖动、读 Date.now 让 seek 后不可重现）。
  var CORE_VERSION = '7';

  // ===== 确定性随机：同一个 seed 永远同一个结果（禁 Math.random 的替代品） =====
  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  // 抖动：seed 可以是帧号 / 形状编号 / 两者相乘；amp 是幅度（像素）
  function jit(seed, amp) {
    return (hash(seed) * 2 - 1) * (amp === undefined ? 1 : amp);
  }

  // ===== 数学与缓动 =====
  function clamp(x, a, b) {
    if (a === undefined) { a = 0; b = 1; }
    else if (b === undefined) { b = 1; }
    return x < a ? a : (x > b ? b : x);
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function ease(x) { x = clamp(x); return x * x * (3 - 2 * x); }
  function easeOut(x) { x = clamp(x); var y = 1 - x; return 1 - y * y * y; }
  function easeIn(x) { x = clamp(x); return x * x * x; }
  function backOut(x) {
    x = clamp(x);
    var s = 1.9;
    return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  }
  // 关键帧插值：MC.kf(t, [[0, 0], [1, 100], [2, 30]], MC.ease)；值可以是数字或数字数组
  function kf(t, keys, e) {
    e = e || ease;
    if (!keys || !keys.length) return 0;
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t < keys[i][0]) {
        var a = keys[i - 1][0], va = keys[i - 1][1], b = keys[i][0], vb = keys[i][1];
        var k = e((t - a) / (b - a));
        return (typeof va === 'number') ? lerp(va, vb, k) : va.map(function (v, j) { return lerp(v, vb[j], k); });
      }
    }
    return keys[keys.length - 1][1];
  }

  // ===== 节奏与字幕扫色（纯函数：给时间，出拍位 / 脉冲 / 唱到第几个字）=====
  // 为什么放在这一层：卡拍只是一次「时间 → 拍位」换算，但每章手写一遍迟早出三种错——
  // 把「拍」和「小节」搞混、给抖动用 Math.random、读 Date.now（seek 到任意一帧就不可重现）。
  // **BPM 与偏移由调用方自己定**：整片用一个常量写在文件顶部（参考实现 PDoomVideo 就是把
  // 88 BPM / 0.21s 写死在代码里的），别每章各拧一个——那是「整支片子的节奏」，不是「一章的参数」。
  // 为什么这里还给一份默认值：章节是**一章一次调用**生成的，模型看不到别的章写了什么；
  // 不给默认值，各章会各写一个 BPM，视觉上就是"同一支片子换了三次拍"。不传 bpm/offset 就用 MC.BPM / MC.OFF。
  var DEFAULT_BPM = 88, DEFAULT_OFF = 0;
  function beatAt(t, bpm, offset) {
    var b = bpm > 0 ? bpm : DEFAULT_BPM;
    var off = offset === undefined ? DEFAULT_OFF : offset;
    return (t - off) * b / 60;
  }
  function beatN(t, bpm, offset) { return Math.floor(beatAt(t, bpm, offset)); }
  // 击拍脉冲：每次踩到拍给 1，之后线性衰减回 0。decay 的单位是「拍」（默认 0.35 拍 ≈ 240ms @ 88BPM）
  function pulse(t, bpm, offset, decay) {
    var p = beatAt(t, bpm, offset), k = p - Math.floor(p);
    var d = decay === undefined ? 0.35 : decay;
    if (!(d > 0)) return k < 1e-9 ? 1 : 0;
    return Math.max(0, 1 - k / d);
  }
  // 八分音符脉冲：同一套换算，BPM 翻倍（这就是参考实现的 pulse2）
  function pulse2(t, bpm, offset, decay) { return pulse(t, (bpm > 0 ? bpm : DEFAULT_BPM) * 2, offset, decay); }
  // 卡拉OK 扫色进度：一条字幕 [a, b] + 文本 → 已经唱了几个字。
  // 唱速按字符估（0.45s 起步 + 每字 0.075s，与参考实现一致）⇒ **不需要词级时间戳**，
  // 句级起止时间就够；中英文混排都按「非空白字符数」算。
  function karaoke(t, a, b, text) {
    var txt = (text === undefined || text === null) ? '' : String(text);
    var chars = txt.replace(/\s+/g, '').length;
    var dur = Math.min(Math.max(0.001, b - a - 0.1), 0.45 + chars * 0.075);
    var p = clamp(dur > 0 ? (t - a) / dur : 1);
    return { p: p, chars: chars, sungChars: Math.floor(p * chars), dur: dur };
  }
  // 圆角矩形路径（卡拉OK 字幕条的底；不引 paint，免得没有 p5 就画不出来）
  function roundedRectPath(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  // 直接画一条扫色字幕条（Canvas 2D）：圆角药丸底 + 已唱部分换色重绘一遍。
  // o 全部可选：{ cx, cy, h, font, pad, bg, color, sung, radius, alpha }
  //   默认居中贴底（cy = 画布高 × 0.93）、高 88、44px 粗体。
  // 「哪条字幕、什么时候出现」仍由章节的时间轴决定，这里只负责把**当前这条**画对。
  function karaokeBand(ctx, t, a, b, text, o) {
    if (!ctx) return null;
    o = o || {};
    var txt = (text === undefined || text === null) ? '' : String(text);
    if (!txt) return null;
    var K = karaoke(t, a, b, txt);
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var font = o.font || '800 44px "Microsoft YaHei UI", "PingFang SC", sans-serif';
    var pad = o.pad === undefined ? 36 : o.pad;
    var h = o.h === undefined ? 88 : o.h;
    var cy = o.cy === undefined ? H * 0.93 : o.cy;
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha = ctx.globalAlpha * o.alpha;
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var tw = ctx.measureText(txt).width;
    var w = Math.min(W - 40, tw + pad * 2);
    var x = (o.cx === undefined ? W / 2 : o.cx) - w / 2;
    var r = o.radius === undefined ? h / 2 : o.radius;
    // 底：圆角药丸
    ctx.beginPath();
    roundedRectPath(ctx, x, cy - h / 2, w, h, r);
    ctx.fillStyle = o.bg || 'rgba(11, 18, 32, 0.82)';
    ctx.fill();
    // 文字：裁在药丸内；先整句暗色，再把「已唱宽度」裁出来重画一遍亮色（扫色效果）
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, x, cy - h / 2, w, h, r);
    ctx.clip();
    var tx = x + pad, ty = cy;
    ctx.fillStyle = o.color || '#E6F1FF';
    ctx.fillText(txt, tx, ty);
    if (K.chars > 0 && K.sungChars > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx - 2, ty - h, tw * (K.sungChars / K.chars) + 2, h * 2);
      ctx.clip();
      ctx.fillStyle = o.sung || '#00D4FF';
      ctx.fillText(txt, tx, ty);
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
    return K;
  }

  // ===== 几何：生成点列（不画，只出点） =====
  function withJit(pts, j) {
    if (!j) return pts;
    return pts.map(function (p) { return [p[0] + jit(p[0] * 0.017 + p[1] * 0.031, j), p[1] + jit(p[1] * 0.023 + p[0] * 0.013, j)]; });
  }
  function ellPts(cx, cy, rx, ry, n, j, rot) {
    n = n || 28; rot = rot || 0;
    var out = [], i, a;
    for (i = 0; i < n; i++) {
      a = rot + i / n * Math.PI * 2;
      out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return withJit(out, j);
  }
  function rrPts(x, y, w, h, r, j) {
    r = r === undefined ? 8 : r;
    var out = [], seg = 5, t;
    function corner(cx, cy, a0) {
      for (var i = 0; i <= seg; i++) {
        t = a0 + i / seg * Math.PI / 2;
        out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
      }
    }
    corner(x + w - r, y + r, -Math.PI / 2);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    return withJit(out, j);
  }
  function starPts(cx, cy, r, inner, n, rot) {
    inner = inner === undefined ? 0.38 : inner; n = n || 4; rot = rot === undefined ? -Math.PI / 2 : rot;
    var out = [], i, a, q;
    for (i = 0; i < n * 2; i++) {
      a = rot + i * Math.PI / n;
      q = (i % 2) ? r * inner : r;
      out.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]);
    }
    return out;
  }
  function linePts(x1, y1, x2, y2, n, j) {
    n = n || 2;
    var out = [], i, k;
    for (i = 0; i < n; i++) {
      k = n === 1 ? 0 : i / (n - 1);
      out.push([lerp(x1, x2, k), lerp(y1, y2, k)]);
    }
    return withJit(out, j);
  }

  // ===== 绘制 =====
  // p5.brush 2.2.3 只认这 11 种笔型（**`ink` 不是笔型**——它在本文件里是墨线颜色，混用会报
  // `Brush "ink" not found`）。传了不认识的名字就退回 pen，别让一笔描边把整个形状炸掉。
  var BRUSHES = ['pen', 'rotring', '2B', 'HB', '2H', 'cpencil', 'pastel', 'crayon', 'charcoal', 'spray', 'marker'];
  function brushName(n) { return BRUSHES.indexOf(n) >= 0 ? n : 'pen'; }

  // 水彩参数预设：名字 → 一组实测好看的参数（1920×1080 真渲对比过，见 CHANGELOG #81）。
  // 用法：MC.paint(pts, { preset: 'soak', wash: '#8EC3E6', fill: '#D97757' })
  //   —— 预设里的键会被 opts 里**显式写出**的键盖掉（你写的优先，包括显式写 null 表示"这条不要"）。
  // 为什么要有预设：「像不像水彩」全在 bleed / tex / fillOp 这几个数上，差一点就退化成平涂；
  // 让每个角色 / 每章自己拧，一支片子里会出现好几种质感。
  var PRESETS = {
    // 纯底色：大片天空 / 地面，只上水彩不叠色、不描边
    wash: { washOp: 235, ink: null },
    // 渗色最重：颜料糊出形状外、色块深浅不均 —— 最像手绘水彩的一档
    soak: { washOp: 220, fillOp: 170, bleed: 0.9, tex: 0.2, ink: null },
    // 湿纸颗粒：边缘相对规整，形状内部有纸张的斑驳
    grain: { washOp: 220, fillOp: 170, bleed: 0.1, tex: 0.4, ink: null },
    // 淡彩：远景 / 阴影 / 半透明叠色
    light: { washOp: 120, fillOp: 60, bleed: 0.5, tex: 0.6, ink: null },
    // 带炭笔勾线：颗粒感的深色轮廓（手绘线，不是钢笔线）
    inked: { washOp: 200, fillOp: 140, bleed: 0.45, tex: 0.7, ink: '#2b2233', sw: 2.2, br: 'charcoal' }
  };
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  // 把预设垫在 opts 下面：opts 里显式写的键优先（含显式 null）
  function withPreset(o) {
    var pre = PRESETS[o.preset];
    if (!pre) return o;
    var out = {}, k;
    for (k in pre) if (has(pre, k)) out[k] = pre[k];
    for (k in o) if (has(o, k) && k !== 'preset') out[k] = o[k];
    return out;
  }

  // paint(pts, opts)：一个形状 = 一次调用。opts 全部可选：
  //   preset     预设名（wash / soak / grain / light / inked），见上面的 PRESETS；显式键会盖掉预设
  //   ctx        Canvas 2D 上下文。给了就用它平涂（没有 p5 时也能画）
  //   wash/washOp  水彩填充色 / 不透明度(0-255)     fill/fillOp  平涂色 / 不透明度
  //   bleed / tex  渗色 / 纹理 (0-1，仅 p5.brush)   ink / sw     墨线色 / 线宽（ink: null = 不描边）
  //   br           描边用的笔型（默认 pen，只认 BRUSHES 里那 11 个；不是颜色，颜色是 ink）
  //   hatch        { d: 线距, a: 角度, b: 笔型, c: 色, w: 线宽 }（仅 p5.brush）
  //   alpha        整体不透明度 (0-1)
  function paint(pts, o) {
    o = o || {};
    if (o.preset) o = withPreset(o);
    if (!pts || !pts.length) return;
    var ctx = o.ctx;
    if (ctx) {
      ctx.save();
      if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (o.fill || o.wash) {
        ctx.fillStyle = o.fill || o.wash;
        ctx.fill();
      }
      if (o.ink !== null && (o.ink || o.sw)) {
        ctx.strokeStyle = o.ink || '#2b2233';
        ctx.lineWidth = o.sw === undefined ? 1 : o.sw;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    // p5 + p5.brush 路线（水彩）
    if (!window.brush) return;
    // 章节模式下 p5 是**实例模式**（没有全局 push/pop），所以取实例来调栈操作：
    // 优先 opts.p，其次 window.__p5Active（章节/角色在 setup 里自己挂一下即可）。
    var P = o.p || window.__p5Active || null;
    // 显式激活本实例：对外 API 是 brush.instance(p)（**没有** activateInstance / deactivateInstance，
    // 那两个名字在内部 runtime adapter 上，直接调会报 "is not a function"）。
    if (P && typeof brush.instance === 'function') { try { brush.instance(P); } catch (e) { /* 老版本没有就不管 */ } }
    var hasStack = !!(P && typeof P.push === 'function');
    if (o.alpha !== undefined) { if (hasStack) P.push(); }
    if (o.wash) { brush.wash(o.wash, o.washOp === undefined ? 255 : o.washOp); } else { brush.noWash(); }
    if (o.fill) {
      brush.fill(o.fill, o.fillOp === undefined ? 170 : o.fillOp);
      brush.fillBleed(o.bleed === undefined ? 0.1 : o.bleed);
      brush.fillTexture(o.tex === undefined ? 0.4 : o.tex, o.border === undefined ? 0.35 : o.border);
    } else { brush.noFill(); }
    if (o.hatch) {
      brush.hatch(o.hatch.d || 40, o.hatch.a || 0, o.hatch.o || { rand: 0.15 });
      brush.hatchStyle(o.hatch.b || 'HB', o.hatch.c || '#2b2233', o.hatch.w || 1);
    } else { brush.noHatch(); }
    brush.noStroke();
    brush.polygon(pts);
    if (o.ink !== null) {
      brush.noWash(); brush.noFill(); brush.noHatch();
      brush.set(brushName(o.br), o.ink || '#2b2233', o.sw === undefined ? 1 : o.sw);
      brush.beginShape(0);
      for (var k = 0; k < pts.length; k++) brush.vertex(pts[k][0], pts[k][1]);
      brush.endShape(true);
    }
    if (o.alpha !== undefined) { if (hasStack) P.pop(); }
  }

  // 只画线（不闭合）：适合头发、绳子、地平线这种
  function inkLine(pts, sw, col, curv) {
    if (!pts || pts.length < 2) return;
    if (!window.brush) return;
    brush.noFill(); brush.noWash(); brush.noHatch();
    brush.set('pen', col || '#2b2233', sw === undefined ? 1 : sw);
    brush.spline(pts, curv === undefined ? 0.5 : curv);
  }

  // ===== 角色层（分层约定） =====
  // 角色**永远画在自己那张透明画布上**，叠在背景（视频 / 图片 / DOM / 背景画布）之上。
  // 这样「画布盖住视频」这件事从结构上不会发生：这张画布每帧只 clearRect，只有角色的像素会盖住下面的东西。
  // 反过来，如果整页都是代码画的（没有视频/图片底），角色也可以画进主画布——但**推荐仍然分层**：
  // 换角色 / 单独重生成某个角色时，背景不必跟着重画。
  function castLayer(stage, w, h, z) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.setAttribute('data-cast-layer', '1');
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none'
      + (z === undefined ? ';z-index:10' : ';z-index:' + z);
    stage.appendChild(cv);
    return { canvas: cv, ctx: cv.getContext('2d') };
  }
  // 每帧清空角色层——**不是填充底色**（填了就成一块不透明的板，盖住背景）
  function clearLayer(ctx, w, h) {
    if (!ctx) return;
    ctx.clearRect(0, 0, w === undefined ? ctx.canvas.width : w, h === undefined ? ctx.canvas.height : h);
  }

  window.MC = {
    CORE_VERSION: CORE_VERSION,
    version: function () { return CORE_VERSION; },
    hash: hash,
    jit: jit,
    clamp: clamp,
    lerp: lerp,
    ease: ease,
    easeOut: easeOut,
    easeIn: easeIn,
    backOut: backOut,
    kf: kf,
    ellPts: ellPts,
    rrPts: rrPts,
    starPts: starPts,
    linePts: linePts,
    paint: paint,
    inkLine: inkLine,
    // v7：卡拍（BPM + 偏移由调用方给）与卡拉OK 扫色
    BPM: DEFAULT_BPM,
    OFF: DEFAULT_OFF,
    beatAt: beatAt,
    beatN: beatN,
    pulse: pulse,
    pulse2: pulse2,
    karaoke: karaoke,
    karaokeBand: karaokeBand,
    castLayer: castLayer,
    clearLayer: clearLayer
  };
})();
