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
  // 内容脚本是否具备：非内置且存在至少一条场景（向后兼容：无 content 字段视为空）
  function hasContent() { const p = AppState.project; return !AppState.isBuiltin && !!(p && p.content && Array.isArray(p.content.scenes) && p.content.scenes.length); }
  // 配音是否具备（本阶段近似判断）：项目内已有背景音频/生成语音即视为已产出声，后续可按实际配音产物细化
  function hasAudio() { const p = AppState.project; return !AppState.isBuiltin && !!(p && p.audioFile); }

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
      videoMaterial: loaded.videoMaterial || '',
      htmlExists: !!(entry && entry.hasHtml),
      videoExists: !!(entry && entry.hasVideo),
      subtitleCount: loaded.subtitleCount || 0,
      content: loaded.content || { style: '', scenes: [] }
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
    const contentDone = hasContent();
    const audioDone = hasAudio();
    const subDone = hasSubtitle();
    const htmlDone = hasHtml();
    const videoDone = hasVideo();
    let html = '<span class="sel-label" style="font-size:12px;color:var(--text-secondary);letter-spacing:1px;flex:none">工作项目</span>';
    html += '<select id="proj-select" class="hf-select" style="width:210px;flex:none" title="切换工作项目（我的项目 / 内置示例只读）"></select>';
    html += '<input id="proj-new-name" class="hgen-input" placeholder="新项目名" style="display:none;flex:none;width:140px"/>';
    html += '<button class="hf-btn" id="proj-new" title="新建我的项目" style="padding:4px 10px;font-size:12px;flex:none">新建项目</button>';
    html += '<button class="hf-btn" id="proj-open" title="打开当前项目所在目录" style="padding:4px 10px;font-size:12px;flex:none">打开目录</button>';
    html += '<div class="step-chain">';
    html += '<span class="step-node clickable ' + (isPage('content') ? 'active-now' : '') + ' ' + (contentDone ? 'done' : '') + '" data-goto="content"><span class="step-dot"></span>内容脚本</span>';
    html += '<span class="step-arrow">→</span>';
    html += '<span class="step-node clickable ' + ((isPage('text-tts') || isPage('sound-copy')) ? 'active-now' : '') + ' ' + (audioDone ? 'done' : '') + '" data-goto="text-tts"><span class="step-dot"></span>配音</span>'; // sound-copy（音色管理）为配音附属页，高亮同一节点
    html += '<span class="step-arrow">→</span>';
    html += '<span class="step-node clickable ' + (isPage('subtitle') ? 'active-now' : '') + ' ' + (subDone ? 'done' : '') + '" data-goto="subtitle"><span class="step-dot"></span>字幕</span>';
    html += '<span class="step-arrow">→</span>';
    html += '<span class="step-node clickable ' + (isPage('html-gen') ? 'active-now' : '') + ' ' + (htmlDone ? 'done' : '') + '" data-goto="html-gen"><span class="step-dot"></span>HTML</span>';
    html += '<span class="step-arrow">→</span>';
    html += '<span class="step-node clickable ' + (isPage('video-gen') ? 'active-now' : '') + ' ' + (videoDone ? 'done' : '') + '" data-goto="video-gen"><span class="step-dot"></span>视频</span>';
    html += '</div>';
    bar.innerHTML = html;
    bar.querySelectorAll('[data-goto]').forEach((n) => n.addEventListener('click', () => goPage(n.dataset.goto)));

    // —— 工作项目切换器（所有节点页共用的全局入口）：填充 / 切换 / 新建 / 打开目录 ——
    const sel = bar.querySelector('#proj-select');
    const my = document.createElement('optgroup');
    my.label = '我的项目';
    AppState.myProjects.forEach((mp) => {
      const o = document.createElement('option');
      o.value = 'my:' + mp.name;
      o.textContent = mp.name + (mp.hasHtml ? ' · HTML✓' : '') + (mp.hasVideo ? ' · 视频✓' : '');
      my.appendChild(o);
    });
    sel.appendChild(my);
    const bi = document.createElement('optgroup');
    bi.label = '内置示例';
    AppState.builtinProjects.forEach((b) => {
      const o = document.createElement('option');
      o.value = 'builtin:' + b.name;
      o.textContent = b.name + ' · 内置';
      bi.appendChild(o);
    });
    sel.appendChild(bi);
    sel.value = (AppState.isBuiltin ? 'builtin:' : 'my:') + AppState.currentName;
    sel.addEventListener('change', async () => {
      const v = sel.value;
      if (!v) return;
      const isBuiltin = v.startsWith('builtin:');
      const name = v.slice(isBuiltin ? 8 : 3);
      await switchProject(name, isBuiltin);
      await goPage(page); // 切换后重进当前页，刷新全部状态
    });

    const newBtn = bar.querySelector('#proj-new');
    const newName = bar.querySelector('#proj-new-name');
    const createProject = async () => {
      const nm = newName.value.trim();
      if (!nm) { toast('请输入项目名'); newName.focus(); return; }
      const res = await window.projectTools.create(nm);
      if (!res || !res.ok) { toast((res && res.message) || '创建失败'); return; }
      newName.value = '';
      newName.style.display = 'none';
      await refreshProject();
      await switchProject(nm, false);
      await goPage(page);
      toast('已创建并切换到项目「' + nm + '」');
    };
    newBtn.addEventListener('click', () => {
      const show = newName.style.display === 'none';
      newName.style.display = show ? '' : 'none';
      if (show) newName.focus();
    });
    newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createProject(); });

    bar.querySelector('#proj-open').addEventListener('click', () => {
      if (AppState.isBuiltin) {
        if (p.htmlPath) window.projectTools.openFolderOf(p.htmlPath);
        else toast('内置示例项目为只读；可在「工作项目」切换到「我的项目」');
        return;
      }
      window.projectTools.openFolder(AppState.currentName);
    });
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
    hasSubtitle, hasHtml, hasVideo, hasContent, hasAudio,
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
