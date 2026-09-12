// renderer/entry.js —— 入口：左侧菜单导航 + 自绘标题栏窗口控制 + 全局进度监听 + 启动
// 必须在 app.js 与 pages/*.js 之后加载（app.js 挂 window.App，pages 注册各页模板/init）。
(function () {
  'use strict';

  const content = document.getElementById('content');

  // ===== 左侧菜单导航 =====
  const menuItems = document.querySelectorAll('.menu-item');
  menuItems.forEach((item) => {
    item.addEventListener('click', () => App.goPage(item.dataset.page));
  });

  // ===== 全局监听渲染进度，实时刷新当前页状态条 =====
  if (window.hfTools) {
    window.hfTools.onProgress((data) => {
      const statusEl = content.querySelector('#hf-status');
      if (!statusEl) return;
      const last = String(data.text || '').trim().split('\n').filter(Boolean).pop() || '';
      statusEl.textContent = '渲染中... ' + last.slice(0, 160);
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
