// src/main/projects/previewScript.ts
// 预览副本（index.preview.html）里注入的控制脚本：响应父窗口 postMessage、每 300ms 上报进度、载入后起播。
// 纯字符串常量，单独成文件是因为它本身就有 150+ 行。

// ===== 预览播放控制脚本（注入到 index.preview.html 副本） =====
// 生成的 HTML 由模型产出、结构不可控，且 file:// iframe 与父页跨源无法直接操作 DOM，
// 故预览时在项目目录内写一份副本并注入本脚本：① 响应父窗口 postMessage（pause/play/restart）；
// ② 每 300ms 上报 { time, dur, playing } 供父页进度条与「暂停/播放」按钮；
// ③ **载入后自动起播**——合成的时间轴是 gsap.timeline({ paused: true }) 创建、开头又把元素全部设为
//    opacity:0，播放本来由 HyperFrames 播放器（转视频 CLI）负责，预览里没人接管就会永远停在第 0 帧
//    （整页只剩底色，看着就是白屏）。
// 注意：因为会自动起播，这份副本**单独用浏览器打开也会自己播放**，它不再是"无副作用的纯控制脚本"。
export const HG_PREVIEW_CTRL = [
  '(function () {',
  '  if (window.__hgPreviewCtrl) return;',
  '  window.__hgPreviewCtrl = true;',
  '  var rawTimelines = function () {',
  '    var out = [];',
  '    try {',
  '      var t = window.__timelines;',
  // HyperFrames 契约：__timelines 是「以 composition id 为键的对象」；旧版生成物可能是数组，两种都收
  '      if (Object.prototype.toString.call(t) === "[object Array]") out = t.slice();',
  '      else if (t && typeof t === "object") { for (var k in t) { if (t[k]) out.push(t[k]); } }',
  '    } catch (e) {}',
  '    return out;',
  '  };',
  '  var timelines = function () {',
  '    var out = rawTimelines();',
  '    if (out.length) return out;',
  '    try { if (window.gsap) return [window.gsap.globalTimeline]; } catch (e) {}',
  '    return [];',
  '  };',
  // 只对「确实处于暂停」的对象动手：对正在跑（或已播完）的对象反复 resume/play，会把动画重头播一遍
  '  var setPaused = function (p) {',
  '    timelines().forEach(function (t) { try { if (p) t.pause(); else if (t.paused && t.paused()) t.resume(); } catch (e) {} });',
  '    var ms = document.querySelectorAll("audio, video");',
  '    for (var i = 0; i < ms.length; i++) {',
  '      try { if (p) ms[i].pause(); else if (ms[i].paused) ms[i].play().catch(function () {}); } catch (e) {}',
  '    }',
  '    if (document.getAnimations) {',
  '      document.getAnimations().forEach(function (a) { try { if (p) a.pause(); else if (a.playState === "paused") a.play(); } catch (e) {} });',
  '    }',
  '  };',
  // 真实播放状态（回给父页，让「暂停/播放」按钮别自说自话）
  // 「播完」不算在播：GSAP 时间轴跑完后 paused() 仍是 false，只看 paused 会让按钮永远停在「暂停」。
  '  var isPlaying = function () {',
  '    var any = false;',
  '    timelines().forEach(function (t) {',
  '      try {',
  '        if (t.paused && t.paused()) return;',
  '        if (t.progress && t.progress() >= 1 && (!t.repeat || t.repeat() >= 0)) return;',
  '        any = true;',
  '      } catch (e) {}',
  '    });',
  '    var ms = document.querySelectorAll("audio, video");',
  '    for (var i = 0; i < ms.length; i++) { try { if (!ms[i].paused) any = true; } catch (e) {} }',
  '    return any;',
  '  };',
  '  var clock = function () {',
  '    var time = 0, dur = 0;',
  // 优先用真实的 composition 时间轴：进度条要反映「这条动画有多长」，而不是页面里恰好嵌着的素材有多长。
  // 素材常比合成长得多（3:45 的视频塞进 10 秒合成）：旧实现取 document.querySelector("audio, video") 的
  // duration，于是总时长显示成素材长度、进度也跟着素材跑，并且素材是 loop 的 ⇒「自然播完」永远等不到。
  '    rawTimelines().forEach(function (t) {',
  '      try { var d = t.duration(); if (d > dur) dur = d; var tt = t.time(); if (tt > time) time = tt; } catch (e) {}',
  '    });',
  '    if (dur <= 0) {',
  // 没有时间轴（老生成物 / 纯 CSS 动画页）：才退回媒体元素与 gsap 全局时间轴
  '      var m = document.querySelector("audio, video");',
  '      if (m && isFinite(m.duration) && m.duration > 0) { dur = m.duration; time = m.currentTime; }',
  '      try { if (window.gsap) { var gt = window.gsap.globalTimeline; if (gt.duration() > dur) dur = gt.duration(); if (gt.time() > time) time = gt.time(); } } catch (e) {}',
  '    }',
  // ===== 时长可信度闸门：超长就报「无法确定」，别把 1e10 秒原样上屏 =====
  // 页面里有 GSAP 的 repeat: -1 时，那个 tween 的时长是 1e10 秒量级（GSAP 的无限循环哨兵，不是 Infinity），
  // 父时间轴 duration() = 1e10 + 起点 ⇒ 总时长会显示成「166666668:12」（317 年），进度条与 seek 一并废掉。
  // 判据两条：① 超过页面自己声明的成片时长 10 倍（声明写在 <html data-composition-duration>）；
  //         ② 超过 24 小时（页面没写声明时的兜底，与 HyperFrames 自己的渲染上限同口径）。
  // 命中就回 dur=0 + unknown，父页显示「--:--」并说明原因（不猜一个假时长）。
  '    var declared = 0;',
  '    try { declared = Number(document.documentElement.getAttribute("data-composition-duration")) || 0; } catch (e) {}',
  '    if ((declared > 0 && dur > declared * 10) || dur > 86400) return { time: time, dur: 0, unknown: true };',
  '    return { time: time, dur: dur };',
  '  };',
  // 拖动预览进度条 → 跳转播放位置：composition 时间轴、页面里的音频/视频、WAAPI 动画一起定位到第 s 秒。
  // 只改播放头，不动播放/暂停状态（GSAP 的 t.time(s) 在播放中也安全：从新位置继续跑）。
  '  var setTime = function (raw) {',
  '    var s = Number(raw);',
  '    if (!isFinite(s) || s < 0) return;',
  '    timelines().forEach(function (t) { try { t.time(s); } catch (e) {} });',
  '    var ms = document.querySelectorAll("audio, video");',
  '    for (var i = 0; i < ms.length; i++) {',
  '      try { if (isFinite(ms[i].duration) && ms[i].duration > 0 && s <= ms[i].duration) ms[i].currentTime = s; } catch (e) {}',
  '    }',
  '    if (document.getAnimations) {',
  '      document.getAnimations().forEach(function (a) { try { a.currentTime = s * 1000; } catch (e) {} });',
  '    }',
  '  };',
  // ===== 载入后保持静止：预览刻意**不自动播放** =====
  // 生成的合成是 gsap.timeline({ paused: true }) 创建、开头又普遍 gsap.set(..., { opacity: 0 })，
  // 所以「什么都不做」就等于停在第 0 帧——起始帧本来就是空的，这是合成自身的设计，不是加载失败。
  // 播放交给用户（「播放」按钮 / 拖动进度条）。这里只做两件事：
  //   ① 把页面里带 autoplay 的 <audio>/<video> 一起冻住（否则合成没动，素材自己先跑起来）；
  //   ② 立刻上报一次状态，让父页的按钮文案与总时长第一帧就对（不用等 300ms 那一轮）。
  // 用户一旦有任何操作（play/pause/seek）就不再干预，避免把刚点下的「播放」又按停（userActed）。
  '  var userActed = false;',
  '  var report = function (ack) {',
  '    var c = clock();',
  '    try { parent.postMessage({ __hg: true, type: "progress", time: c.time, dur: c.dur, unknown: !!c.unknown, playing: isPlaying(), ack: !!ack }, "*"); } catch (e) {}',
  '  };',
  '  var freeze = function () {',
  '    if (userActed) return;',
  '    setPaused(true);',
  '    report(false);',
  '  };',
  '  var freezes = 0;',
  '  var freezeLoop = function () {',
  '    freeze();',
  '    freezes++;',
  // 补几次：兜住「合成晚于 load 才建 timeline / 媒体元数据晚就绪」的情况
  '    if (!userActed && freezes < 5) setTimeout(freezeLoop, 250);',
  '  };',
  '  if (document.readyState === "complete") setTimeout(freezeLoop, 0);',
  '  else window.addEventListener("load", function () { setTimeout(freezeLoop, 0); });',
  // ===== 播完就整体停住 =====
  // 合成的元素普遍带 loop（<video autoplay muted loop> / <audio autoplay loop>），时间轴跑完后
  // 媒体还会在后台一直转：画面看着"结束了"，元素却还在耗 CPU，按钮也会一直显示「暂停」。
  // 这里在真实时间轴全部跑完时统一 setPaused(true)，行为与视频播放器一致（停在末帧，再点「播放」从头重播）。
  // 无限循环（repeat: -1）的合成永远不算播完；没有真实时间轴的页面（媒体页 / 老生成物）不干预。
  '  var ended = false;',
  '  var watchEnd = function () {',
  '    var ts = rawTimelines();',
  '    if (!ts.length) return;',
  '    var allDone = true;',
  '    ts.forEach(function (t) {',
  '      try {',
  '        if (t.repeat && t.repeat() < 0) { allDone = false; return; }',
  '        if (t.time() < t.duration() - 0.05) allDone = false;',
  '      } catch (e) { allDone = false; }',
  '    });',
  '    if (!allDone) { ended = false; return; }',
  '    if (ended) return;',
  '    ended = true;',
  '    setPaused(true);',
  '    report(false);',
  '  };',
  '  window.addEventListener("message", function (ev) {',
  '    var d = ev.data || {};',
  '    if (!d.__hg) return;',
  '    userActed = true;   // 用户接管：freezeLoop 立即停手',
  '    if (d.type === "pause") setPaused(true);',
  '    else if (d.type === "play") setPaused(false);',
  // 拖动跳转：定位后立刻回一条带 ack 的进度，父页据此把进度条钉在目标位置
  // （否则松手后可能先收到一条拖动前发出的旧回报，看起来像"被拽回原位"）
  '    else if (d.type === "seek") { setTime(d.seconds); report(true); }',
  '    else if (d.type === "restart") location.reload();',
  '  });',
  '  setInterval(function () { watchEnd(); report(false); }, 300);',
  '})();'
].join('\n');
