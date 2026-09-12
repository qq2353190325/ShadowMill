// renderer/app.js —— 应用骨架：挂全局 window.App
// 共享状态(AppState)、公共工具(escTxt/rateClamp/applyRate/stepRate)、
// 项目上下文(saveProjectCtx/refreshProject/switchProject)、
// 轻提示(toast)、链路状态条(renderStepBar)、路由(goPage/setActiveMenu)、
// 页面注册表(App.pages) 与启动初始化(App.init)。
// 加载顺序：app.js 最先，随后 pages/*.js 注册各页，最后 entry.js 驱动。
(function () {
  'use strict';

  const content = document.getElementById('content');
  const menuItems = document.querySelectorAll('.menu-item');

  // ===== 公共工具 =====
  const escTxt = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ===== 语速控件共享逻辑（仅改播放 playbackRate，不改磁盘音频；0.5~2.0，非法或空值回退 1） =====
  function rateClamp(v) { return Math.min(2, Math.max(0.5, v)); }
  function applyRate(el, audio) {
    let v = parseFloat(el.value);
    if (!isFinite(v)) v = 1;
    v = rateClamp(v);
    el.value = v;
    if (audio) audio.playbackRate = v;
    return v;
  }
  function stepRate(el, audio, delta) {
    let v = parseFloat(el.value);
    if (!isFinite(v)) v = 1;
    v = rateClamp(Math.round((v + delta) * 100) / 100);
    el.value = v;
    if (audio) audio.playbackRate = v;
    return v;
  }

  // ===== 全局项目状态 =====
  const AppState = {
    currentName: 'demo-project',
    isBuiltin: false,
    project: null,      // 当前项目详情
    myProjects: [],     // 我的项目列表
    builtinProjects: [] // 内置示例项目
  };

  function hasSubtitle() { const p = AppState.project; return !AppState.isBuiltin && !!(p && p.subtitle); }
  // 仅当存在真实 HTML 路径且非内置示例时才视为“已生成”：内置示例的 HTML 属于只读示例资源，不算用户生成产物
  function hasHtml() { const p = AppState.project; return !AppState.isBuiltin && !!(p && p.htmlExists && p.htmlPath); }
  function hasVideo() { const p = AppState.project; return !!(p && p.videoExists); }

  function saveProjectCtx() {
    localStorage.setItem('myapp.projectCtx', JSON.stringify({ name: AppState.currentName, builtin: AppState.isBuiltin }));
  }

  async function refreshProject() {
    const [projs, built] = await Promise.all([
      window.projectTools.list().catch(() => []),
      window.hfTools.listProjects().catch(() => [])
    ]);
    AppState.myProjects = projs;
    AppState.builtinProjects = built.map((b) => ({
      name: b.name,
      title: b.name,
      htmlPath: b.html,
      htmlExists: !!b.html, // 存在性来源显式化：主进程 list 已按 index.html 是否存在过滤；b.html 为空时绝不标 true
      videoExists: false,
      subtitle: ''
    }));

    if (AppState.isBuiltin) {
      const entry = AppState.builtinProjects.find((b) => b.name === AppState.currentName);
      if (!entry) {
        AppState.currentName = (AppState.myProjects[0] && AppState.myProjects[0].name) || 'demo-project';
        AppState.isBuiltin = false;
        saveProjectCtx();
      } else {
        AppState.project = Object.assign({}, entry);
        return;
      }
    }

    let entry = AppState.myProjects.find((p) => p.name === AppState.currentName);
    if (!entry) {
      AppState.currentName = (AppState.myProjects[0] && AppState.myProjects[0].name) || 'demo-project';
      entry = AppState.myProjects.find((p) => p.name === AppState.currentName);
    }
    const loaded = await window.projectTools.load(AppState.currentName);
    AppState.project = {
      name: loaded.name,
      title: loaded.title || '字幕动画',
      subtitle: loaded.subtitle || '',
      htmlPath: loaded.htmlPath || '',
      videoPath: loaded.videoPath || '',
      audioFile: loaded.audioFile || '',
      htmlExists: !!(entry && entry.hasHtml),
      videoExists: !!(entry && entry.hasVideo),
      subtitleCount: loaded.subtitleCount || 0
    };
  }

  async function switchProject(name, isBuiltin) {
    AppState.currentName = name;
    AppState.isBuiltin = isBuiltin;
    saveProjectCtx();
    await refreshProject();
  }

  // ===== 轻提示 =====
  function toast(msg) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;' +
      'padding:10px 18px;border-radius:8px;font-size:13px;color:#E6F1FF;background:rgba(11,18,32,.95);' +
      'border:1px solid rgba(0,212,255,.5);box-shadow:0 0 18px rgba(0,212,255,.35);max-width:70vw;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  // ===== 项目链路状态条 =====
  function renderStepBar(page) {
    let bar = content.querySelector('.project-bar[data-roled]');
    if (!bar) {
      const slot = content.querySelector('[data-slot]');
      if (!slot) return;
      bar = document.createElement('div');
      bar.className = 'project-bar';
      bar.setAttribute('data-roled', '1');
      slot.replaceWith(bar);
    }
    const p = AppState.project || {};
    const isPage = (pg) => page === pg;
    const subDone = hasSubtitle();
    const htmlDone = hasHtml();
    const videoDone = hasVideo();
    const nameShown = AppState.isBuiltin ? ('内置 · ' + p.name) : p.name;
    let html = '<span class="proj-name ' + (AppState.isBuiltin ? '' : 'placeholder') + '" title="点击打开项目（HTML 预览 / 视频生成）">' + escTxt(nameShown) + '</span>';
    html += '<div class="step-chain">';
    html += '<span class="step-node clickable ' + (isPage('subtitle') ? 'active-now' : '') + ' ' + (subDone ? 'done' : '') + '" data-goto="subtitle"><span class="step-dot"></span>字幕</span>';
    html += '<span class="step-arrow">→</span>';
    html += '<span class="step-node clickable ' + (isPage('html-gen') || isPage('html-preview') ? 'active-now' : '') + ' ' + (htmlDone ? 'done' : '') + '" data-goto="html-preview"><span class="step-dot"></span>HTML</span>';
    html += '<span class="step-arrow">→</span>';
    html += '<span class="step-node clickable ' + (isPage('video-gen') ? 'active-now' : '') + ' ' + (videoDone ? 'done' : '') + '" data-goto="video-gen"><span class="step-dot"></span>视频</span>';
    html += '</div>';
    if (!AppState.isBuiltin) {
      html += '<button class="hf-btn" data-goto="html-gen" style="padding:6px 14px;font-size:12px">转到 HTML 生成</button>';
    }
    bar.innerHTML = html;
    bar.querySelectorAll('[data-goto]').forEach((n) => n.addEventListener('click', () => goPage(n.dataset.goto)));
    // 项目名点击入口：当前项目（含内置）均可点击，直达「HTML 预览」页进行预览 / 转视频
    const nameEl = bar.querySelector('.proj-name');
    if (nameEl) {
      nameEl.addEventListener('click', () => goPage((page === 'html-preview' || page === 'video-gen') ? page : 'html-preview'));
    }
  }

  // ===== 页面路由 =====
  function setActiveMenu(page) {
    menuItems.forEach((i) => i.classList.toggle('active', i.dataset.page === page));
  }

  async function goPage(page) {
    setActiveMenu(page);
    await refreshProject();
    const pg = App.pages[page];
    content.innerHTML = (pg && pg.html) || '<h1>空页面</h1><p>暂无内容。</p>';
    content.scrollTop = 0;
    if (pg && typeof pg.init === 'function') pg.init();
  }

  const App = window.App = {
    AppState,
    escTxt,
    rateClamp, applyRate, stepRate,
    hasSubtitle, hasHtml, hasVideo,
    saveProjectCtx, refreshProject, switchProject,
    toast, renderStepBar,
    setActiveMenu, goPage,
    pages: {},
    // 应用启动初始化：恢复上次项目上下文 → 刷新项目 → 进入首页
    init: async function () {
      try {
        const saved = JSON.parse(localStorage.getItem('myapp.projectCtx') || 'null');
        if (saved && saved.name) {
          AppState.currentName = saved.name;
          AppState.isBuiltin = !!saved.builtin;
        }
      } catch (e) { /* ignore */ }
      await refreshProject();
      goPage('home');
    }
  };
})();
