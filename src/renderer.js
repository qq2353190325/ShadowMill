// 渲染进程：菜单切换 + 项目化贯通流水线（字幕 → HTML → 预览/转视频）
const menuItems = document.querySelectorAll('.menu-item');
const content = document.getElementById('content');

const escTxt = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ===== 全局项目状态 =====
const AppState = {
  currentName: 'demo-project',
  isBuiltin: false,
  project: null,      // 当前项目详情
  myProjects: [],     // 我的项目列表
  builtinProjects: [] // 内置示例项目
};

function hasSubtitle() { const p = AppState.project; return !AppState.isBuiltin && !!(p && p.subtitle); }
function hasHtml() { const p = AppState.project; return !!(p && p.htmlExists); }
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
    htmlExists: true,
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
  let html = '<span class="proj-name ' + (AppState.isBuiltin ? '' : 'placeholder') + '" title="' + escTxt(nameShown) + '">' + escTxt(nameShown) + '</span>';
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
}

// ===== 页面模板 =====
const pages = {
  home: `<section class="hero">
  <span class="hero-tag">CYBER UI · 深空科技</span>
  <h1>一站式音视频创作流水线</h1>
  <p>以“项目”为单位贯通：字幕 → HTML → 视频，一键生成。</p>
</section>
<div class="flow-pipeline" id="home-flow"></div>
<div class="metric-grid">
  <div class="metric-card"><div class="metric-value">5+</div><div class="metric-label">支持音频格式</div></div>
  <div class="metric-card"><div class="metric-value">1080P</div><div class="metric-label">导出分辨率</div></div>
  <div class="metric-card"><div class="metric-value">3</div><div class="metric-label">项目链路节点</div></div>
  <div class="metric-card"><div class="metric-value">MP4</div><div class="metric-label">视频输出格式</div></div>
</div>`,
  about: '<h1>关于</h1><p>这是一个基于 Electron 的项目。</p>',
  settings: '<h1>设置</h1><p>设置项暂未实现。</p>',
  'sound-copy': '<h1>声音复制</h1><p>将导入的音频复制生成新的声音副本，功能开发中。</p>',
  subtitle: `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>编辑字幕文本</div>
  <textarea id="sub-editor" class="hgen-subtitle" spellcheck="false" placeholder="每行一条字幕。支持两种格式：&#10;1) 纯文本行 —— 自动按语速估算时长&#10;2) [分:秒] 文本 —— 指定时间轴（转视频后精确对齐）&#10;示例：&#10;[00:00] 大家好&#10;[00:05] 欢迎来到深空科技&#10;[00:12] 我们一起用字幕生成 HTML 和视频"></textarea>
  <div class="hgen-row">
    <label class="sel-label">页面标题</label>
    <input id="sub-title" class="hgen-input" style="flex:1" placeholder="字幕动画标题，如：我的第一个字幕动画"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn" id="sub-save">保存到项目</button>
    <button class="hf-btn hf-btn-primary" id="sub-tohtml">保存并生成 HTML</button>
  </div>
  <div class="hgen-tip">带时间戳格式：<code>[00:05] 文本</code>，分钟:秒；两种格式可混用。保存后项目链路「字幕」节点自动点亮。</div>
</div>`,
    'html-gen': `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>HTML · Agent 生成 / 修改</div>
  <div class="proj-meta" id="hg-meta"></div>
  <div class="hgen-tip">HTML 由 Agent 接口生成与修改：点下方按钮打开对话框，填写需求并提交，Agent 返回成品后自动写入项目并刷新预览。应用侧不内置模板。</div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="hg-gen">生成 HTML</button>
    <button class="hf-btn" id="hg-mod" title="基于当前 HTML 提出修改需求，Agent 修改后覆盖">修改 HTML</button>
    <button class="hf-btn" id="hg-download" title="下载当前项目 HTML 到本地">下载 HTML</button>
    <button class="hf-btn" id="hg-open">打开项目目录</button>
  </div>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>背景音频（可选）</div>
  <div class="hgen-row">
    <button class="hf-btn" id="hg-pick-audio">选择音频文件</button>
    <span class="hf-file" id="hg-audio-name">未设置音频</span>
    <button class="hf-btn" id="hg-clear-audio" disabled>移除音频</button>
  </div>
  <div class="hgen-tip">音频由 Agent 在生成/修改 HTML 时注入为音轨：预览即可听，转视频自动混入。</div>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>预览</div>
  <div class="hf-status" id="hg-status"></div>
  <div class="empty-hint" id="hg-empty">尚未生成 HTML。</div>
  <iframe class="hgen-frame" id="hg-frame" style="display:none" sandbox="allow-scripts allow-same-origin"></iframe>
</div>
<div class="modal-mask" id="hg-modal" hidden>
  <div class="modal-box">
    <div class="panel-title-sm" id="hg-modal-title">生成 HTML</div>
    <textarea id="hg-modal-prompt" class="hgen-subtitle" spellcheck="false" placeholder="描述你想要的 HTML 效果，例如：&#10;· 深空科技风格的标题动画页，标题为“我的作品集”&#10;· 每条字幕间隔两秒，依次从下方上浮淡入"></textarea>
    <div class="modal-actions">
      <button class="hf-btn" id="hg-modal-cancel">取消</button>
      <button class="hf-btn hf-btn-primary" id="hg-modal-ok">提交给 Agent</button>
    </div>
  </div>
</div>`,
  'html-preview': `<div class="project-bar" data-slot></div>
<div class="project-selector">
  <span class="sel-label">工作项目</span>
  <select id="proj-select" class="hf-select"></select>
  <span class="hf-file" id="proj-file">未选择</span>
  <button class="hf-btn" id="btn-openfolder" disabled>打开目录</button>
</div>
<div class="card hf-page">
  <div class="hf-toolbar">
    <button class="hf-btn" data-hf="open">选择 HTML 文件</button>
    <span class="hf-file" id="hf-file">未选择文件</span>
    <button class="hf-btn" data-hf="refresh" disabled>刷新</button>
    <button class="hf-btn hf-btn-primary" data-hf="render" disabled>转为视频</button>
  </div>
  <div class="hf-status" id="hf-status"></div>
  <iframe class="hf-frame" id="hf-frame" sandbox="allow-scripts allow-same-origin"></iframe>
</div>`,
  'video-gen': `<div class="project-bar" data-slot></div>
<div class="project-selector">
  <span class="sel-label">工作项目</span>
  <select id="proj-select" class="hf-select"></select>
  <span class="hf-file" id="proj-file">未选择</span>
  <button class="hf-btn" id="btn-openfolder" disabled>打开目录</button>
</div>
<div class="card hf-page">
  <div class="hf-toolbar">
    <button class="hf-btn" data-hf="open">选择 HTML 文件</button>
    <span class="hf-file" id="hf-file">未选择文件</span>
    <button class="hf-btn hf-btn-primary" data-hf="render" disabled>HyperFrames 转视频</button>
  </div>
  <div class="hf-status" id="hf-status"></div>
  <iframe class="hf-frame" id="hf-frame" sandbox="allow-scripts allow-same-origin"></iframe>
  <div class="hf-video-wrap" id="hf-video-wrap" hidden>
    <video class="hf-video" id="hf-video" controls></video>
    <div class="hf-video-actions">
      <button class="hf-btn" data-hf="show-folder">在文件夹中显示</button>
    </div>
  </div>
</div>`
};

// ===== 页面初始化 =====
const INIT = {};

// 首页：动态流水线（反映当前项目状态，可点击跳转）
INIT.home = function () {
  const flow = document.getElementById('home-flow');
  if (!flow) return;
  const p = AppState.project || {};
  const defs = [
    { idx: '01', t: '声音复制', d: '导入音频，复制生成全新声音副本', page: 'sound-copy', done: false },
    { idx: '02', t: '文字生音频', d: '输入文字，智能合成为自然语音', page: 'sound-copy', done: false },
    { idx: '03', t: '文字转字幕', d: '语音自动对齐，生成同步字幕', page: 'subtitle', done: hasSubtitle() },
    { idx: '04', t: '字幕生成HTML', d: '将字幕渲染为精美的 HTML 页面', page: 'html-gen', done: hasHtml() },
    { idx: '05', t: '转成视频', d: '合并素材，导出最终视频成品', page: 'video-gen', done: hasVideo() }
  ];
  flow.innerHTML = defs.map((n, i) =>
    '<div class="flow-node ' + (n.done ? 'flow-done' : '') + '" data-page="' + n.page + '" style="cursor:pointer">' +
    '<span class="flow-node-index">' + n.idx + '</span><h3>' + n.t + '</h3><p>' + n.d + '</p>' +
    (n.done ? '<span class="flow-badge">已完成</span>' : '') +
    '</div>' + (i < defs.length - 1 ? '<i class="flow-arrow">→</i>' : '')
  ).join('');
  flow.querySelectorAll('.flow-node[data-page]').forEach((el) => {
    el.addEventListener('click', () => goPage(el.dataset.page));
  });
};

// 字幕生成页
INIT.subtitle = function () {
  renderStepBar('subtitle');
  if (AppState.isBuiltin) {
    toast('当前是内置示例项目（只读），请切换到自己的项目来编辑字幕');
  }
  const editor = document.getElementById('sub-editor');
  const title = document.getElementById('sub-title');
  if (!editor) return;
  editor.value = AppState.project.subtitle || '';
  title.value = (AppState.project.title && AppState.project.title !== '字幕动画') ? AppState.project.title : '';

  const doSave = async (goHtml) => {
    if (AppState.isBuiltin) { toast('内置项目只读，请先切换到自己的项目'); return; }
    const text = editor.value;
    const t = title.value.trim();
    if (!text.trim()) { toast('字幕内容为空，请先输入'); return; }
    const res = await window.projectTools.saveSubtitle(AppState.currentName, text, t);
    if (!res.ok) { toast(res.message || '保存失败'); return; }
    await refreshProject();
    toast('字幕已保存：共 ' + res.project.subtitleCount + ' 条');
    if (goHtml) goPage('html-gen');
  };
  document.getElementById('sub-save').addEventListener('click', () => doSave(false));
  document.getElementById('sub-tohtml').addEventListener('click', () => doSave(true));
};

// HTML 生成/修改页：Agent 对话框 + 下载 + 预览
INIT['html-gen'] = function () {
  renderStepBar('html-gen');
  if (AppState.isBuiltin) { toast('当前是内置示例项目（只读），请切换到自己的项目'); }
  const frame = document.getElementById('hg-frame');
  const empty = document.getElementById('hg-empty');
  const status = document.getElementById('hg-status');

  const pfx = (p) => (p && p.audioFile) ? escTxt(p.audioFile) : '未设置';
  const renderMeta = () => {
    const p = AppState.project;
    const hasSub = hasSubtitle(), hasH = hasHtml(), hasV = hasVideo();
    document.getElementById('hg-meta').innerHTML =
      '<div class="proj-stat ' + (hasSub ? 'on' : '') + '"><b>字幕</b>' + (hasSub ? ((p && p.subtitleCount) || 0) + ' 条' : '未生成') + '</div>' +
      '<div class="proj-stat ' + (hasH ? 'on' : '') + '"><b>HTML</b>' + (hasH ? '已生成' : '未生成') + '</div>' +
      '<div class="proj-stat ' + (hasV ? 'on' : '') + '"><b>视频</b>' + (hasV ? '已生成' : '未生成') + '</div>' +
      '<div class="proj-stat ' + (p && p.audioFile ? 'on' : '') + '"><b>音频</b>' + pfx(p) + '</div>';
    const aName = document.getElementById('hg-audio-name');
    const aClear = document.getElementById('hg-clear-audio');
    if (aName) aName.textContent = pfx(p);
    if (aClear) aClear.disabled = !(p && p.audioFile);
  };

  const loadFrame = (htmlPath) => {
    if (!frame) return;
    frame.style.display = '';
    if (empty) empty.style.display = 'none';
    frame.src = 'file:///' + encodeURI(htmlPath.replace(/\\/g, '/'));
  };

  // 已有 HTML → 进入页面自动预览
  (async () => {
    try {
      if (AppState.project.htmlExists && AppState.project.htmlPath) loadFrame(AppState.project.htmlPath);
    } catch (e) { /* ignore */ }
    renderMeta();
  })();

  // —— 对话框（生成 / 修改）——
  const modal = document.getElementById('hg-modal');
  const modalTitle = document.getElementById('hg-modal-title');
  const modalPrompt = document.getElementById('hg-modal-prompt');
  let modalMode = 'generate';
  const openModal = (mode) => {
    modalMode = mode;
    modalTitle.textContent = (mode === 'generate' ? '生成 HTML（描述需求给 Agent）' : '修改 HTML（描述要改什么给 Agent）');
    modalPrompt.value = '';
    modal.hidden = false;
    modalPrompt.focus();
  };
  document.getElementById('hg-gen').addEventListener('click', () => openModal('generate'));
  document.getElementById('hg-mod').addEventListener('click', () => {
    if (!AppState.project.htmlExists) { toast('还没有 HTML，先「生成 HTML」'); return; }
    openModal('modify');
  });
  document.getElementById('hg-modal-cancel').addEventListener('click', () => { modal.hidden = true; });
  document.getElementById('hg-modal-ok').addEventListener('click', async () => {
    if (AppState.isBuiltin) { toast('内置项目只读'); return; }
    const prompt = modalPrompt.value.trim();
    if (!prompt) { toast('请填写需求描述'); return; }
    modal.hidden = true;
    if (status) { status.textContent = '已提交给 Agent，处理中...'; status.classList.remove('hf-error', 'hf-ok'); }
    const call = (modalMode === 'generate')
      ? window.projectTools.generateHtml(AppState.currentName, prompt)
      : window.projectTools.modifyHtml(AppState.currentName, prompt);
    const res = await call;
    if (res && res.ok) {
      await refreshProject();
      renderMeta();
      if (res.htmlPath) loadFrame(res.htmlPath);
      if (status) { status.textContent = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : ''); status.classList.add('hf-ok'); }
      toast(modalMode === 'generate' ? 'HTML 已生成' : 'HTML 已修改');
      renderStepBar('html-gen');
    } else {
      const msg = (res && res.message) || '提交失败';
      if (status) { status.textContent = msg; status.classList.add('hf-error'); }
      toast(msg);
    }
  });

  // —— 下载 HTML ——
  document.getElementById('hg-download').addEventListener('click', async () => {
    const res = await window.projectTools.downloadHtml(AppState.currentName);
    if (!res) return;
    if (res.ok) toast('已导出：' + res.savedPath);
    else if (!res.canceled) toast(res.message || '下载失败');
  });

  // —— 打开项目目录 ——
  document.getElementById('hg-open').addEventListener('click', () => {
    window.projectTools.openFolder(AppState.currentName);
  });

  // —— 背景音频 ——
  document.getElementById('hg-pick-audio').addEventListener('click', async () => {
    if (AppState.isBuiltin) { toast('内置项目只读'); return; }
    const picked = await window.projectTools.pickAudio();
    if (!picked) return;
    const res = await window.projectTools.setAudio(AppState.currentName, picked);
    if (!res.ok) { toast(res.message || '设置音频失败'); return; }
    await refreshProject();
    renderMeta();
    toast('已加入音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
  });
  document.getElementById('hg-clear-audio').addEventListener('click', async () => {
    if (AppState.isBuiltin) { toast('内置项目只读'); return; }
    await window.projectTools.clearAudio(AppState.currentName);
    await refreshProject();
    renderMeta();
    toast('已移除音频');
  });
};
// ===== HTML 预览 / 视频生成（共用） =====
let hfHtmlPath = null;
let lastVideoPath = null;

function fillProjSelect(sel) {
  sel.innerHTML = '';
  const my = document.createElement('optgroup');
  my.label = '我的项目';
  AppState.myProjects.forEach((p) => {
    const o = document.createElement('option');
    o.value = 'my:' + p.name;
    o.textContent = p.name + (p.hasHtml ? ' · HTML✓' : '') + (p.hasVideo ? ' · 视频✓' : '');
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
}

function initHfPage(page) {
  renderStepBar(page);
  const el = content.querySelector('.hf-page');
  if (!el) return;
  const fileEl = el.querySelector('#hf-file');
  const projFileEl = el.querySelector('#proj-file');
  const statusEl = el.querySelector('#hf-status');
  const btnOpen = el.querySelector('[data-hf="open"]');
  const btnRender = el.querySelector('[data-hf="render"]');
  const btnRefresh = el.querySelector('[data-hf="refresh"]');
  const frame = el.querySelector('#hf-frame');
  const videoWrap = el.querySelector('#hf-video-wrap');
  const videoEl = el.querySelector('#hf-video');
  const btnShowFolder = el.querySelector('[data-hf="show-folder"]');
  const sel = el.querySelector('#proj-select');
  const btnOpenFolder = el.querySelector('#btn-openfolder');
  hfHtmlPath = null;
  lastVideoPath = null;

  statusEl.textContent = '';
  statusEl.classList.remove('hf-error', 'hf-ok');
  fileEl.textContent = '未选择文件';
  projFileEl.textContent = AppState.project.name || '未选择';
  btnRender.disabled = true;
  if (btnRefresh) btnRefresh.disabled = true;
  if (videoWrap && videoEl) {
    videoWrap.hidden = true;
    videoEl.removeAttribute('src');
    videoEl.load();
  }
  if (frame) frame.removeAttribute('src');

  const setHtml = (p) => {
    hfHtmlPath = p;
    fileEl.textContent = p;
    if (frame) {
      frame.src = 'file:///' + encodeURI(p.replace(/\\/g, '/'));
      statusEl.textContent = '已加载预览';
      statusEl.classList.add('hf-ok');
    }
    btnRender.disabled = false;
    if (btnRefresh) btnRefresh.disabled = false;
  };

  // 项目选择
  if (sel) {
    fillProjSelect(sel);
    sel.addEventListener('change', async () => {
      const v = sel.value;
      if (!v) return;
      const isBuiltin = v.startsWith('builtin:');
      const name = v.slice(isBuiltin ? 8 : 3);
      await switchProject(name, isBuiltin);
      await goPage(page);
    });
  }
  if (btnOpenFolder) {
    btnOpenFolder.disabled = AppState.isBuiltin;
    btnOpenFolder.addEventListener('click', () => {
      if (!AppState.isBuiltin) window.projectTools.openFolder(AppState.currentName);
    });
  }

  // 当前项目已有 HTML → 自动加载预览
  if (AppState.project.htmlExists) {
    setHtml(AppState.project.htmlPath);
  }

  btnOpen.addEventListener('click', async () => {
    const p = await window.hfTools.openHtml();
    if (p) setHtml(p);
  });

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (hfHtmlPath && frame) {
        frame.src = 'file:///' + encodeURI(hfHtmlPath.replace(/\\/g, '/'));
      }
    });
  }

  if (btnShowFolder) {
    btnShowFolder.addEventListener('click', () => {
      if (lastVideoPath) window.hfTools.showInFolder(lastVideoPath);
    });
  }

  btnRender.addEventListener('click', async () => {
    if (!hfHtmlPath) return;
    statusEl.textContent = '渲染中，请稍候（约 30 秒）...';
    statusEl.classList.remove('hf-error', 'hf-ok');
    btnRender.disabled = true;
    const res = await window.hfTools.renderVideo(hfHtmlPath);
    btnRender.disabled = false;
    if (res.ok) {
      lastVideoPath = res.outputVideo;
      statusEl.textContent = '渲染完成：' + res.outputVideo;
      statusEl.classList.add('hf-ok');
      // 回写视频产物到当前项目（我的项目）
      if (!AppState.isBuiltin) {
        await window.projectTools.saveVideo(AppState.currentName, res.outputVideo);
        await refreshProject();
        renderStepBar(page);
      }
      if (videoWrap && videoEl) {
        videoEl.src = 'file:///' + encodeURI(res.outputVideo.replace(/\\/g, '/'));
        videoWrap.hidden = false;
        videoEl.load();
      }
    } else {
      statusEl.textContent = res.message || '渲染失败';
      statusEl.classList.add('hf-error');
    }
  });
}

INIT['html-preview'] = function () { initHfPage('html-preview'); };
INIT['video-gen'] = function () { initHfPage('video-gen'); };

// ===== 页面路由 =====
function setActiveMenu(page) {
  menuItems.forEach((i) => i.classList.toggle('active', i.dataset.page === page));
}

async function goPage(page) {
  setActiveMenu(page);
  await refreshProject();
  content.innerHTML = pages[page] || '<h1>空页面</h1><p>暂无内容。</p>';
  content.scrollTop = 0;
  if (INIT[page]) INIT[page]();
}

menuItems.forEach((item) => {
  item.addEventListener('click', () => goPage(item.dataset.page));
});

// 全局监听渲染进度，实时刷新当前页状态条
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

// ===== 启动 =====
(async function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem('myapp.projectCtx') || 'null');
    if (saved && saved.name) {
      AppState.currentName = saved.name;
      AppState.isBuiltin = !!saved.builtin;
    }
  } catch (e) { /* ignore */ }
  await refreshProject();
  goPage('home');
})();
