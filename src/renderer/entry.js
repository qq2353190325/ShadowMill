// renderer/entry.js —— 入口：左侧菜单导航 + 自绘标题栏窗口控制 + 全局进度监听 + 启动
// 必须在 app.js 与 pages/*/template.js、pages/*/index.js 之后加载（app.js 挂 window.App，pages 注册各页模板/init）。
(function () {
  'use strict';

  const content = document.getElementById('content');

  // ===== 左侧菜单导航 =====
  const menuItems = document.querySelectorAll('.menu-item');
  menuItems.forEach((item) => {
    item.addEventListener('click', () => App.goPage(item.dataset.page));
  });

  // ===== 全局监听渲染进度，实时刷新当前页状态条 =====
  // HyperFrames CLI 会输出 [Render:trace] {"phase":...,"status":...,"elapsedMs":...,"message":...} 行：
  // 解析为「渲染中 · 阶段中文名（耗时）：消息」；解析失败（普通日志/进度行）回退显示原文尾部。
  const HF_PHASE_LABELS = {
    compile: '编译组合',
    browser_launch: '启动渲染浏览器',
    browser_probe: '浏览器校准',
    session_init: '初始化渲染会话',
    video_extract: '提取视频素材',
    audio_process: '处理音轨',
    capture_calibration: '帧捕获校准',
    capture_hdr_layered: '逐帧捕获',
    capture_streaming: '逐帧捕获',
    capture_disk: '逐帧捕获',
    encode: '视频编码',
    assemble: '合成输出'
  };
  let hfLogBuf = '';    // 跨 chunk 的半行缓冲（日志行可能被分块截断）
  let hfLastLine = '';  // 最近一条完整日志行（trace 解析失败时兜底）
  if (window.hfTools) {
    window.hfTools.onProgress((data) => {
      const statusEl = content.querySelector('#hf-status');
      if (!statusEl) return;
      hfLogBuf += String(data.text || '');
      let nl;
      while ((nl = hfLogBuf.indexOf('\n')) >= 0) {
        const line = hfLogBuf.slice(0, nl).trim();
        hfLogBuf = hfLogBuf.slice(nl + 1);
        if (line) hfLastLine = line;
      }
      const tIdx = hfLastLine.lastIndexOf('[Render:trace]');
      if (tIdx >= 0) {
        try {
          const ev = JSON.parse(hfLastLine.slice(tIdx + 14).trim());
          const phase = HF_PHASE_LABELS[ev.phase] || String(ev.phase || '');
          const msg = String(ev.message || '').trim();
          const secs = isFinite(Number(ev.elapsedMs)) ? Math.round(Number(ev.elapsedMs) / 1000) : 0;
          statusEl.textContent = '渲染中 · ' + phase + (secs ? '（' + secs + 's）' : '') + (msg ? '：' + msg : '');
          return;
        } catch (e) { /* 解析失败走兜底 */ }
      }
      statusEl.textContent = '渲染中... ' + hfLastLine.slice(-160);
    });
  }

  // ===== 自绘标题栏：窗口控制按钮 =====
  const btnMin = document.getElementById('btn-min');
  const btnMax = document.getElementById('btn-max');
  const btnClose = document.getElementById('btn-close');

  function setMaximizedState(isMaximized) {
    document.getElementById('icon-max').style.display = isMaximized ? 'none' : '';
    document.getElementById('icon-restore').style.display = isMaximized ? '' : 'none';
    btnMax.title = isMaximized ? '还原' : '最大化';
  }

  if (window.windowControls) {
    btnMin.addEventListener('click', () => window.windowControls.minimize());
    btnMax.addEventListener('click', () => window.windowControls.toggleMaximize());
    btnClose.addEventListener('click', () => window.windowControls.close());
    window.windowControls.onMaximizedChange(setMaximizedState);
  }

  // ===== 启动：恢复上次项目上下文 → 刷新项目 → 进入首页 =====
  App.init();
})();
