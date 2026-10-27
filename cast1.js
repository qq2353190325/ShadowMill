(function () {
  window.__cast = window.__cast || {};

  /* 十六进制混色，用于生成暗部（避免依赖任何全局库） */
  function mix(a, b, t) {
    var ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
    var br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
    return "rgb(" + Math.round(ar + (br - ar) * t) + "," +
                    Math.round(ag + (bg - ag) * t) + "," +
                    Math.round(ab + (bb - ab) * t) + ")";
  }

  window.__cast["cast1"] = function (x, y, u, o) {
    o = o || {};
    var ctx = o.ctx;
    if (!ctx) return;                 // 本角色只用传进来的 2D 上下文

    /* ---------- 调色板（我的世界 · 史蒂夫） ----------
       皮肤 #C9A17C / 中间调 #B08968 / 暗部 #966F4C
       头发 #3A2A1E / 发顶高光 #4E3A29
       上衣 #00A6A6 / 暗 #007C7C
       裤子 #3C4AA0 / 暗 #2B3576
       鞋   #4B4B4B / 暗 #343434
       眼白 #F5F5F5 / 瞳 #4A3FA8 / 嘴 #5A3A2E             */
    var P = {
      skin:     "#C9A17C",
      skinMid:  "#B08968",
      skinDark: "#966F4C",
      hair:     "#3A2A1E",
      hairTop:  "#4E3A29",
      shirt:    "#00A6A6",
      shirtDark:"#007C7C",
      pants:    "#3C4AA0",
      pantsDark:"#2B3576",
      shoe:     "#4B4B4B",
      shoeDark: "#343434",
      eye:      "#F5F5F5",
      iris:     "#4A3FA8",
      line:     "#33251C",
      mouth:    "#5A3A2E"
    };
    if (o.col) { P.shirt = o.col; P.shirtDark = mix(o.col, "#000000", 0.36); }

    var sq = Math.max(-1, Math.min(1, o.sq || 0));
    var sx = 1 - 0.26 * sq;
    var sy = 1 + 0.26 * sq;

    /* 局部坐标系：原点 = 脚底中点，(0,-8) = 头顶 */
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * (o.alpha == null ? 1 : o.alpha);
    ctx.translate(x + (o.dx || 0) * u, y + (o.dy || 0) * u);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(u * sx * (o.flip ? -1 : 1), u * sy);

    function box(bx, by, bw, bh, c) {
      ctx.fillStyle = c;
      ctx.fillRect(bx, by, bw, bh);
    }

    /* 统一的“外侧暗面”位置：肢体宽 1、外缘在 ±0.5，
       左右两侧都把暗条**贴着外缘**放在肢体内部（-0.5..-0.5+w / 0.5-w..0.5），
       不再出现伸到肢体外面的独立柱子。 */
    function outerX(side, w) {
      return side < 0 ? -0.5 : 0.5 - w;
    }

    /* ---------------- 腿（高 3u，髋部 y=-3） ---------------- */
    var walk = o.walk || 0;
    var swing = Math.sin(walk * Math.PI * 2) * 0.40;

    function leg(side) {
      var a = side < 0 ? swing : -swing;
      ctx.save();
      ctx.translate(side * 0.5, -3);
      ctx.rotate(a);
      box(-0.5, 0, 1, 2.4, P.pants);
      box(outerX(side, 0.28), 0, 0.28, 2.4, P.pantsDark);        // 外侧暗面（贴外缘，两腿一致）
      box(-0.5, 2.4, 1, 0.6, P.shoe);                            // 鞋
      box(-0.5, 2.85, 1, 0.15, P.shoeDark);
      ctx.restore();
    }
    leg(-1);
    leg(1);

    /* ---------------- 躯干（宽 2u，y=-6..-3） ---------------- */
    box(-1, -6, 2, 3, P.shirt);
    box(0.66, -6, 0.34, 3, P.shirtDark);      // 右侧暗面
    box(-1, -3.32, 2, 0.32, P.shirtDark);     // 下摆阴影

    /* ---------------- 手臂（宽 1u，长 3u，肩在 y=-6） ----------------
       枢轴 = **身体与手臂的连接面（躯干边缘 x=±1）再往下 1u（= 一个手臂宽）**，即 (side*1, -5)。
       为什么不放在肩线 y=-6 上：y=-6 正好是头底/下巴那条线，绕它转时臂根顶角会翘到下巴上
       （抬到 86°~100° 时高出肩线 0.49u，看上去像手臂从头上长出来）。
       下移 1u 后：抬到 90° 时手臂正好是"上沿压在肩线、向外伸出"的一条，不会再越过肩线；
       而静止时盒子仍等价于 x∈[±1,±2]、y∈[-6,-3]，外观与以前逐像素相同。
       代价（几何上必然）：抬手时那截短袖会转到躯干内部（同色、看不见）⇒ 抬起的手臂从肩线
       开始就是肤色；手臂往后摆时腋下会有一小块缺口。 */
    function arm(side, ang) {
      var a = side < 0 ? ang : -ang;          // 正角度 = 向外抬起
      // 局部 x 从 0（连接面）到 1（外缘）：左臂取 [-1,0]，右臂取 [0,1]
      var x0 = side < 0 ? -1 : 0;
      ctx.save();
      ctx.translate(side, -5);
      ctx.rotate(a);
      box(x0, -1, 1, 1.05, P.shirt);          // 短袖
      box(x0, -0.1, 1, 0.15, P.shirtDark);    // 袖口
      box(x0, 0.05, 1, 1.95, P.skin);         // 小臂 / 手
      // 外侧暗面：贴着外缘、画在手臂内部（局部 x：右 0.7~1、左 -1~-0.7）
      box(side < 0 ? -1 : 0.7, -1, 0.3, 3, "rgba(0,0,0,0.10)");
      ctx.restore();
    }
    arm(-1, o.aL == null ? 0 : o.aL);
    arm(1, o.aR == null ? 0 : o.aR);

    /* ---------------- 头（2u × 2u，y=-8..-6） ---------------- */
    box(-1, -8, 2, 2, P.skin);
    box(0.7, -7.5, 0.3, 1.5, "rgba(0,0,0,0.07)");   // 脸颊暗面

    // 头发：顶部一条 + 美人尖 + 两侧鬓角
    box(-1, -8, 2, 0.5, P.hair);
    box(-1, -8, 2, 0.14, P.hairTop);
    box(-0.25, -7.5, 0.5, 0.1, P.hair);
    box(-1, -7.5, 0.15, 0.72, P.hair);
    box(0.85, -7.5, 0.15, 0.72, P.hair);

    /* ---------------- 表情 ---------------- */
    var es = o.eyes || "normal";
    var ms = o.mouth || es;
    if (ms !== "happy" && ms !== "sad" && ms !== "angry" && ms !== "surprise") ms = "normal";
    var blink = Math.max(0, Math.min(1, o.blink == null ? 0 : o.blink));

    var eyeTop = -7.26, eyeH = 0.26;

    if (es === "happy" && blink < 0.7) {
      // 弯弯的笑眼
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 0.1;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(-0.5, -7.06, 0.19, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      ctx.beginPath(); ctx.arc(0.5, -7.06, 0.19, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    } else if (blink > 0.7) {
      // 闭眼
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 0.08;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-0.72, -7.12); ctx.lineTo(-0.28, -7.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.28, -7.12); ctx.lineTo(0.72, -7.12); ctx.stroke();
    } else {
      var h = eyeH * (1 - blink * 0.9);
      var top = eyeTop + (eyeH - h) * 0.5;
      if (es === "surprise") { h = eyeH * 1.18; top = eyeTop - 0.045; }
      // 眼白
      box(-0.75, top, 0.5, h, P.eye);
      box(0.25, top, 0.5, h, P.eye);
      // 瞳孔（靠鼻梁一侧）
      var ih = h * (es === "surprise" ? 0.45 : 0.58);
      var iy = top + (es === "sad" ? h - ih : (h - ih) * 0.35);
      box(-0.5, iy, 0.25, ih, P.iris);
      box(0.25, iy, 0.25, ih, P.iris);
    }

    // 眉毛（难过 / 生气）
    if (es === "sad" || es === "angry") {
      var tilt = es === "angry" ? 0.26 : -0.24;
      ctx.save(); ctx.translate(-0.5, -7.42); ctx.rotate(tilt);
      box(-0.3, -0.07, 0.6, 0.14, P.hair); ctx.restore();
      ctx.save(); ctx.translate(0.5, -7.42); ctx.rotate(-tilt);
      box(-0.3, -0.07, 0.6, 0.14, P.hair); ctx.restore();
    }

    // 鼻子（略深的肤色块）
    box(-0.18, -6.98, 0.36, 0.2, P.skinMid);
    box(-0.18, -6.84, 0.36, 0.06, P.skinDark);

    /* ---------------- 胡须 + 嘴 ---------------- */
    box(-0.8, -6.66, 0.26, 0.48, P.hair);      // 左腮胡
    box(0.54, -6.66, 0.26, 0.48, P.hair);      // 右腮胡
    box(-0.44, -6.66, 0.88, 0.16, P.hair);     // 上唇胡
    box(-0.54, -6.26, 1.08, 0.2, P.hair);      // 下巴胡

    ctx.strokeStyle = P.mouth;
    ctx.fillStyle = P.mouth;
    ctx.lineCap = "round";
    ctx.lineWidth = 0.1;
    if (ms === "happy") {
      ctx.beginPath();
      ctx.moveTo(-0.26, -6.5);
      ctx.quadraticCurveTo(0, -6.24, 0.26, -6.5);
      ctx.stroke();
    } else if (ms === "sad") {
      ctx.beginPath();
      ctx.moveTo(-0.26, -6.3);
      ctx.quadraticCurveTo(0, -6.52, 0.26, -6.3);
      ctx.stroke();
    } else if (ms === "surprise") {
      ctx.beginPath();
      ctx.ellipse(0, -6.38, 0.14, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (ms === "angry") {
      box(-0.3, -6.46, 0.6, 0.14, P.mouth);
      box(-0.34, -6.46, 0.1, 0.2, P.mouth);
      box(0.24, -6.46, 0.1, 0.2, P.mouth);
    } else {
      box(-0.22, -6.46, 0.44, 0.11, P.mouth);
    }

    /* 手持道具钩子（章节传入，局部坐标：脚底为原点、身高 8 单位） */
    if (typeof o.hold === "function") o.hold(ctx);

    ctx.restore();
  };
})();
