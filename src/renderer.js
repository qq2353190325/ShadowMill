// 渲染进程：菜单切换 + 项目化贯通流水线（字幕 → HTML → 预览/转视频）
const menuItems = document.querySelectorAll('.menu-item');
const content = document.getElementById('content');

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
  settings: `<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>自定义模型（OpenAI 兼容）</div>
  <div class="hgen-tip">配置用于「HTML 生成 / 修改」的自定义模型 Agent。填写 Base URL、模型 ID 与 API Key 并开启后，HTML 生成页即使用该模型工作。API Key 仅保存在本机 userData/settings.json。</div>
  <div class="hgen-row">
    <label class="sel-label">Base URL</label>
    <input id="set-base-url" class="hgen-input" style="flex:1" placeholder="https://api.openai.com/v1（需以 /v1 结尾，按服务商实际提供）"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">模型 ID</label>
    <input id="set-model-id" class="hgen-input" style="flex:1" placeholder="如 gpt-4o-mini / deepseek-chat"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">API Key</label>
    <input id="set-api-key" type="password" class="hgen-input" style="flex:1" placeholder="sk-..."/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">启用</label>
    <label class="hgen-check"><input id="set-enabled" type="checkbox"/> 使用自定义模型生成 / 修改 HTML</label>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="set-save">保存配置</button>
    <button class="hf-btn" id="set-test">测试连接</button>
  </div>
  <div class="hf-status" id="set-status"></div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>千问语音（声音复制 & 文字生音频）</div>
  <div class="hgen-tip">配置千问AI平台 API Key 与目标语音合成模型，供「声音复制」和「文字生音频」使用。API Key 仅保存在本机 userData/settings.json。创建音色时的 target_model 必须与合成模型一致。</div>
  <div class="hgen-row">
    <label class="sel-label">API Key</label>
    <input id="set-v-api-key" type="password" class="hgen-input" style="flex:1" placeholder="sk-...（DASHSCOPE_API_KEY）"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">目标模型</label>
    <select id="set-v-model" class="hgen-select" style="flex:1">
      <option value="qwen-audio-3.0-tts-flash">qwen-audio-3.0-tts-flash（Qwen-Audio-TTS，默认）</option>
      <option value="qwen3-tts-vc-2026-01-22">qwen3-tts-vc-2026-01-22（非实时）</option>
      <option value="qwen3-tts-vc-realtime-2026-01-15">qwen3-tts-vc-realtime-2026-01-15（实时）</option>
      <option value="qwen3-tts-vc-realtime-2025-11-27">qwen3-tts-vc-realtime-2025-11-27（实时）</option>
    </select>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="set-v-save">保存千问语音配置</button>
  </div>
  <div class="hf-status" id="set-v-status"></div>
</div>`,
  'sound-copy': `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>声音复制（创建克隆音色）</div>
  <div class="hgen-tip">创建克隆音色绑定当前「设置」中选择的目标模型，后续合成必须使用相同模型（创建计费 0.01 元/个）：<br/>· Qwen-Audio-TTS（qwen-audio-3.0-tts-flash）：粘贴一段 10~20 秒清晰人声的<b>可公开访问音频 URL</b>（该模型克隆不接受本地文件直传）；<br/>· Qwen-TTS（qwen3-tts-vc-*）：上传本地音频文件（.wav / .mp3 / .m4a，Base64 后需小于 10 MB）。</div>
  <div class="hgen-row">
    <label class="sel-label">音色名称</label>
    <input id="vc-name" class="hgen-input" style="flex:1" placeholder="仅限数字、字母、下划线，最多 16 字符，如 myvoice"/>
  </div>
  <div class="hgen-row" id="vc-file-row">
    <button class="hf-btn" id="vc-pick">选择音频文件</button>
    <span class="hf-file" id="vc-file">未选择文件</span>
  </div>
  <div class="hgen-row" id="vc-url-row" style="display:none">
    <label class="sel-label">音频 URL</label>
    <input id="vc-url" class="hgen-input" style="flex:1" placeholder="https://...（可公开访问的音频文件地址，如 .wav / .mp3 / .m4a）"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="vc-create">创建音色</button>
    <button class="hf-btn" id="vc-to-settings">API Key 设置</button>
  </div>
  <div class="hf-status" id="vc-status"></div>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>我的音色（voice 列表）</div>
  <div class="hf-status" id="vc-list-status"></div>
  <div id="vc-list" class="hgen-tip">点击「刷新音色列表」从千问AI平台拉取已创建的克隆音色。</div>
  <div class="hgen-actions">
    <button class="hf-btn" id="vc-refresh">刷新音色列表</button>
  </div>
</div>`,
  'text-tts': `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>文字生音频（TTS 合成）</div>
  <div class="hgen-tip">使用千问语音模型（当前模型：<b id="tts-model-tag">qwen-audio-3.0-tts-flash</b>）把文字合成为语音，结果保存到项目目录 <code>audio/</code> 中。Qwen-Audio-TTS 与 Qwen-TTS 系列均支持。</div>
  <div>
    <div class="panel-title-sm">合成文本</div>
    <textarea id="tts-text" class="hgen-subtitle" style="height:150px" spellcheck="false" placeholder="输入要合成语音的文字…"></textarea>
  </div>
  <div class="hgen-row">
    <label class="sel-label">音色</label>
    <select id="tts-voice" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="tts-refresh-voice" title="重新拉取音色列表">刷新</button>
  </div>
  <div class="hgen-row">
    <label class="sel-label">保存到项目</label>
    <select id="tts-proj" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="tts-open-folder" disabled>打开目录</button>
  </div>
  <div class="hgen-row">
    <label class="sel-label">保存位置</label>
    <select id="tts-save-mode" class="hgen-select" style="flex:1">
      <option value="default">默认（项目 audio/ 或音频输出目录）</option>
      <option value="custom">自定义目录（持久化记忆）</option>
    </select>
    <button class="hf-btn" id="tts-pick-dir" style="display:none">选择文件夹</button>
    <button class="hf-btn" id="tts-reset-dir" style="display:none">恢复默认</button>
  </div>
  <div class="hgen-row" id="tts-save-dir-row" style="display:none">
    <span class="hf-file" id="tts-save-dir">（尚未选择自定义目录）</span>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="tts-synth">合成并保存</button>
    <button class="hf-btn" id="tts-to-settings">API Key 设置</button>
  </div>
  <div class="hf-status" id="tts-status"></div>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>已生成音频（可选，作为当前项目背景音频复用）</div>
  <div class="hgen-row">
    <select id="tts-gen-list" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="tts-gen-refresh">刷新</button>
    <button class="hf-btn" id="tts-gen-play">试听</button>
  </div>
  <div class="hgen-row">
    <span class="hf-file" id="tts-gen-info">未加载</span>
    <button class="hf-btn hf-btn-primary" id="tts-gen-setbg" disabled>设为当前项目背景音频</button>
  </div>
  <div class="hgen-row" id="tts-gen-play-row" style="display:none">
    <audio id="tts-gen-audio" controls style="flex:1;max-height:44px"></audio>
    <label class="sel-label">语速</label>
    <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
      <button type="button" class="hf-btn" id="tts-gen-rate-dec" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">−</button>
      <input id="tts-gen-rate" type="text" inputmode="decimal" class="hgen-input" value="1" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none"/>
      <button type="button" class="hf-btn" id="tts-gen-rate-inc" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">+</button>
    </span>
  </div>
  <div class="hgen-tip">列出历史合成保存的 TTS 音频（默认输出目录、自定义保存目录）与各项目 audio/ 中的音频，可直接一键设为当前项目的背景音频（复制进项目 audio/ 并写入 project.json）。</div>
</div>
<div class="card hgen-panel" id="tts-result-wrap" style="display:none">
  <div class="panel-title"><span class="dot"></span>合成结果</div>
  <div class="hgen-tip" id="tts-result-path"></div>
  <div class="hgen-row">
    <audio class="hf-video" id="tts-audio" controls style="flex:1;max-height:54px"></audio>
    <label class="sel-label">语速</label>
    <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
      <button type="button" class="hf-btn" id="tts-rate-dec" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">−</button>
      <input id="tts-rate" type="text" inputmode="decimal" class="hgen-input" value="1" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none"/>
      <button type="button" class="hf-btn" id="tts-rate-inc" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">+</button>
    </span>
  </div>
</div>`,
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
<div class="project-selector">
  <span class="sel-label">工作项目</span>
  <select id="hg-proj-select" class="hf-select"></select>
  <button class="hf-btn" id="hg-proj-open" title="打开当前项目所在目录">打开目录</button>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>HTML · Agent 生成 / 修改</div>
  <div class="proj-meta" id="hg-meta"></div>
  <div class="hgen-block">
    <div class="panel-title-sm">需求描述（提示词）</div>
    <textarea id="hg-prompt" class="hgen-subtitle" spellcheck="false" placeholder="描述你想要的 HTML 效果，例如：&#10;· 深空科技风格的标题动画页，标题为“我的作品集”&#10;· 每条字幕间隔两秒，依次从下方上浮淡入&#10;· 修改时：换成紫色霓虹配色，并把标题放大"></textarea>
  </div>
  <div class="hgen-block">
    <div class="panel-title-sm">生成素材 · 字幕 / 背景音频（均可选，留空则跳过）</div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">字幕</span>
      <select id="hg-sub-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪份字幕逐条设计动画"></select>
    </div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">背景音频</span>
      <select id="hg-audio-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪份音频作为音轨注入"></select>
    </div>
    <div class="hgen-tip">生成 / 修改 HTML 时使用所选素材：字幕逐条设计动画、音频作为音轨注入（自动复制进本项目 audio/）。两者均可留空 = 跳过对应素材，仅按需求描述生成。</div>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="hg-gen">生成 HTML</button>
    <button class="hf-btn" id="hg-mod" title="基于当前 HTML 按项目需求修改并覆盖">修改 HTML</button>
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
  <div class="hgen-row">
    <select id="hg-gen-list" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="hg-gen-refresh">刷新</button>
    <button class="hf-btn" id="hg-gen-play">试听</button>
    <button class="hf-btn hf-btn-primary" id="hg-gen-use" disabled>设为背景音频</button>
  </div>
  <div class="hgen-row" id="hg-gen-play-row" style="display:none">
    <audio id="hg-gen-audio" controls style="flex:1;max-height:44px"></audio>
    <label class="sel-label">语速</label>
    <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
      <button type="button" class="hf-btn" id="hg-gen-rate-dec" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">−</button>
      <input id="hg-gen-rate" type="text" inputmode="decimal" class="hgen-input" value="1" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none"/>
      <button type="button" class="hf-btn" id="hg-gen-rate-inc" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">+</button>
    </span>
  </div>
  <div class="hgen-tip">音频由 Agent 在生成/修改 HTML 时注入为音轨：预览即可听，转视频自动混入。下方还可直接选择已生成 TTS 音频复用为当前项目背景音频。</div>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>预览</div>
  <div class="hf-status" id="hg-status"></div>
  <div class="empty-hint" id="hg-empty">尚未生成 HTML。</div>
  <iframe class="hgen-frame" id="hg-frame" style="display:none" sandbox="allow-scripts allow-same-origin"></iframe>
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
    { idx: '02', t: '文字生音频', d: '输入文字，智能合成为自然语音', page: 'text-tts', done: false },
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

  // 内置示例快捷入口：点击即选中该内置项目并进入「HTML 预览」页（可预览 / 转视频，产物不回写项目目录）
  let biHost = document.getElementById('builtin-section');
  if (!biHost) {
    biHost = document.createElement('div');
    biHost.id = 'builtin-section';
    biHost.style.cssText = 'margin-top:24px;';
    flow.insertAdjacentElement('afterend', biHost);
  }
  if (!AppState.builtinProjects.length) {
    biHost.innerHTML = '<div class="builtin-empty" style="color:var(--text-secondary,#8CA3C7);font-size:13px;">暂无内置示例项目</div>';
  } else {
    biHost.innerHTML =
      '<div class="panel-title"><span class="dot"></span>内置示例<b style="font-weight:500;color:var(--text-secondary,#8CA3C7);font-size:12px;margin-left:8px;">只读 · 可预览 / 转视频</b></div>' +
      '<div class="builtin-grid" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">' +
      AppState.builtinProjects.map((b, i) =>
        '<div class="builtin-card" data-i="' + i + '" title="打开内置示例 ' + escTxt(b.name) + '" style="flex:1;min-width:200px;padding:14px 16px;border:1px solid rgba(0,212,255,.35);border-radius:10px;background:linear-gradient(105deg,rgba(0,212,255,.10),rgba(139,92,246,.10));cursor:pointer;transition:transform .15s ease, box-shadow .15s ease;">' +
        '<b style="color:#00D4FF;">' + escTxt(b.title) + '</b>' +
        '<div style="margin-top:4px;font-size:12px;color:var(--text-secondary,#8CA3C7);">点击打开预览 / 转视频</div>' +
        '</div>'
      ).join('') + '</div>';
    biHost.querySelectorAll('.builtin-card').forEach((c) => {
      c.addEventListener('click', () => {
        const b = AppState.builtinProjects[Number(c.getAttribute('data-i'))];
        if (!b) return;
        switchProject(b.name, true).then(() => goPage('html-preview'));
      });
    });
  }
};

// ===== 声音复制页（千问 Qwen-TTS 克隆音色） =====
INIT['sound-copy'] = function () {
  renderStepBar('sound-copy');
  const status = document.getElementById('vc-status');
  const listHost = document.getElementById('vc-list');
  const listStatus = document.getElementById('vc-list-status');
  const fileEl = document.getElementById('vc-file');
  const setStatus = (el, text, kind) => {
    el.textContent = text || '';
    el.classList.remove('hf-error', 'hf-ok');
    if (kind) el.classList.add(kind);
  };
  let audioPath = null;
  // —— 目标模型分支：Qwen-Audio-TTS（qwen-audio-3.0-tts-flash）克隆改用「音频 URL」，其余模型保持选择本地文件 ——
  let urlMode = false;
  const fileRow = document.getElementById('vc-file-row');
  const urlRow = document.getElementById('vc-url-row');
  const urlInput = document.getElementById('vc-url');
  const applyInputMode = (c) => {
    urlMode = /^qwen-audio-.*-tts/i.test(String((c && c.targetModel) || ''));
    if (urlRow) urlRow.style.display = urlMode ? '' : 'none';
    if (fileRow) fileRow.style.display = urlMode ? 'none' : '';
  };

  const getCfg = async () => {
    try {
      const c = await window.voiceTools.getConfig();
      return c && c.ok ? c : null;
    } catch (e) { return null; }
  };
  const requireCfg = async () => {
    const c = await getCfg();
    if (!c || !c.apiKey) {
      setStatus(status, '尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error');
      goPage('settings');
      return null;
    }
    return c;
  };

  const renderList = (voices) => {
    if (!listHost) return;
    if (!voices || !voices.length) { listHost.innerHTML = '当前账号下暂无克隆音色。请在「声音复制」上传音频创建。'; return; }
    const head = '<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px 12px;font-size:12px;color:var(--text-secondary);padding:6px 2px;"><span>音色（名字(模型)）</span><span>创建时间</span></div>';
    const rows = voices.map((v) => '<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px 12px;align-items:center;padding:6px 2px;border-top:1px solid rgba(0,212,255,.08);word-break:break-all;"><span style="color:var(--color-primary)">' + escTxt(v.voice) + (v.target_model ? '（' + escTxt(v.target_model) + '）' : '') + '</span><span style="color:var(--text-secondary)">' + escTxt(v.gmt_create || '') + '</span></div>').join('');
    listHost.innerHTML = head + rows;
  };
  const loadList = async (silent) => {
    if (!silent) setStatus(listStatus, '拉取音色列表…', '');
    const res = await window.voiceTools.list().catch(() => ({ ok: false, message: '调用失败' }));
    if (res && res.ok) {
      renderList(res.voices);
      setStatus(listStatus, '共 ' + res.voices.length + ' 个克隆音色', 'hf-ok');
    } else {
      setStatus(listStatus, (res && res.message) || '拉取失败', 'hf-error');
    }
  };

  document.getElementById('vc-pick').addEventListener('click', async () => {
    const c = await requireCfg(); if (!c) return;
    const p = await window.voiceTools.pickAudio();
    if (p) { audioPath = p; fileEl.textContent = p; }
  });
  document.getElementById('vc-create').addEventListener('click', async () => {
    const c = await requireCfg(); if (!c) return;
    const name = document.getElementById('vc-name').value.trim();
    if (!name) { setStatus(status, '请填写音色名称', 'hf-error'); return; }
    if (urlMode) {
      const u = urlInput.value.trim();
      if (!u) { setStatus(status, '请填写可公开访问的音频文件地址（URL）', 'hf-error'); return; }
      setStatus(status, '正在使用音频 URL 创建音色（约几秒）…', '');
      const res = await window.voiceTools.create(u, name);
      if (res && res.ok) {
        setStatus(status, '音色创建成功：' + res.voice + (res.fallbackMode ? '（降级模式：' + escTxt(res.fallbackReason || '') + '）' : ''), 'hf-ok');
        loadList(true);
      } else {
        setStatus(status, (res && res.message) || '创建失败', 'hf-error');
      }
      return;
    }
    if (!audioPath) { setStatus(status, '请先选择音频文件', 'hf-error'); return; }
    setStatus(status, '正在上传音频并创建音色（约几秒）…', '');
    const res = await window.voiceTools.create(audioPath, name);
    if (res && res.ok) {
      setStatus(status, '音色创建成功：' + res.voice + (res.fallbackMode ? '（降级模式：' + escTxt(res.fallbackReason || '') + '）' : ''), 'hf-ok');
      loadList(true);
    } else {
      setStatus(status, (res && res.message) || '创建失败', 'hf-error');
    }
  });
  document.getElementById('vc-refresh').addEventListener('click', () => loadList(false));
  document.getElementById('vc-to-settings').addEventListener('click', () => goPage('settings'));
  (async () => {
    const cc = await window.voiceTools.getConfig().catch(() => null);
    applyInputMode(cc && cc.ok ? cc : { targetModel: 'qwen-audio-3.0-tts-flash' });
    if (cc && cc.ok && cc.apiKey) loadList(true);
  })();
};

// ===== 文字生音频页（千问 Qwen-TTS 非实时合成） =====
INIT['text-tts'] = function () {
  renderStepBar('text-tts');
  const status = document.getElementById('tts-status');
  const voiceSel = document.getElementById('tts-voice');
  const projSel = document.getElementById('tts-proj');
  const openBtn = document.getElementById('tts-open-folder');
  const tag = document.getElementById('tts-model-tag');
  // —— 保存位置（自定义目录持久化） ——
  const saveModeSel = document.getElementById('tts-save-mode');
  const pickDirBtn = document.getElementById('tts-pick-dir');
  const resetDirBtn = document.getElementById('tts-reset-dir');
  const saveDirRow = document.getElementById('tts-save-dir-row');
  const saveDirEl = document.getElementById('tts-save-dir');
  let cfgSaveDir = '';
  const renderSaveDir = () => {
    const custom = saveModeSel.value === 'custom';
    pickDirBtn.style.display = custom ? '' : 'none';
    resetDirBtn.style.display = custom ? '' : 'none';
    saveDirRow.style.display = custom ? '' : 'none';
    saveDirEl.textContent = cfgSaveDir ? '自定义目录：' + cfgSaveDir : '（尚未选择自定义目录，将使用默认规则）';
  };
  // —— 已生成音频（复用为背景音频） ——
  const genSel = document.getElementById('tts-gen-list');
  const genInfo = document.getElementById('tts-gen-info');
  const genPlayBtn = document.getElementById('tts-gen-play');
  const genSetBtn = document.getElementById('tts-gen-setbg');
  const genAudio = document.getElementById('tts-gen-audio');
  let genAudios = [];
  const updateGenSel = () => {
    const it = genAudios[Number(genSel.value)];
    if (!it) { genInfo.textContent = ''; genSetBtn.disabled = true; return; }
    genInfo.textContent = it.path;
    genSetBtn.disabled = AppState.isBuiltin;
    if (genAudio) {
      genAudio.dataset.path = it.path;
      genAudio.src = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
      genAudio.load();
    }
    const genPlayRow = document.getElementById('tts-gen-play-row');
    if (genPlayRow) genPlayRow.style.display = '';
  };
  const fillGenAudios = async (silent) => {
    const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' }));
    if (!res || !res.ok) {
      if (!silent) setStatus(status, (res && res.message) || '加载已生成音频失败', 'hf-error');
      return;
    }
    genAudios = res.items || [];
    genSel.innerHTML = '';
    if (!genAudios.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（暂无已生成音频）';
      genSel.appendChild(o);
      genInfo.textContent = '';
      genSetBtn.disabled = true;
      if (genAudio) { genAudio.src = ''; }
      const genPlayRowEmpty = document.getElementById('tts-gen-play-row');
      if (genPlayRowEmpty) genPlayRowEmpty.style.display = 'none';
      return;
    }
    genAudios.forEach((it, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = it.name + '（' + it.group + '）';
      genSel.appendChild(o);
    });
    updateGenSel();
  };
  const setStatus = (el, text, kind) => {
    el.textContent = text || '';
    el.classList.remove('hf-error', 'hf-ok');
    if (kind) el.classList.add(kind);
  };

  const defaultProj = () => projSel.value || '';
  const fillProj = () => {
    projSel.innerHTML = '';
    if (!AppState.myProjects.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（暂无「我的项目」，将保存到音频输出目录）';
      projSel.appendChild(o);
      return;
    }
    let selected = false;
    AppState.myProjects.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      projSel.appendChild(o);
      if (!AppState.isBuiltin && p.name === AppState.currentName && !selected) { o.selected = true; selected = true; }
    });
    if (!projSel.value) projSel.selectedIndex = 0; // 默认最近项目
  };

  const requireCfg = async () => {
    const c = await window.voiceTools.getConfig().catch(() => null);
    if (!c || !c.ok || !c.apiKey) {
      setStatus(status, '尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error');
      goPage('settings');
      return null;
    }
    if (tag) tag.textContent = c.targetModel || 'qwen-audio-3.0-tts-flash';
    // 恢复持久化的自定义保存目录状态
    cfgSaveDir = String((c && c.saveDir) || '').trim();
    saveModeSel.value = cfgSaveDir ? 'custom' : 'default';
    renderSaveDir();
    return c;
  };

  const fillVoices = async () => {
    setStatus(status, '拉取音色列表…', '');
    const res = await window.voiceTools.list().catch(() => ({ ok: false, message: '调用失败' }));
    if (res && res.ok) {
      voiceSel.innerHTML = '';
      if (!res.voices.length) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = '暂无克隆音色，请先到「声音复制」创建';
        voiceSel.appendChild(o);
      } else {
        res.voices.forEach((v) => {
          const o = document.createElement('option');
          o.value = v.voice;
          o.textContent = v.voice + (v.target_model ? '（' + v.target_model + '）' : '');
          voiceSel.appendChild(o);
        });
        voiceSel.selectedIndex = 0;
      }
      setStatus(status, '已加载 ' + res.voices.length + ' 个音色。注意：创建音色与合成须使用相同模型。', 'hf-ok');
    } else {
      setStatus(status, (res && res.message) || '拉取音色失败', 'hf-error');
    }
  };

  document.getElementById('tts-refresh-voice').addEventListener('click', async () => { if (await requireCfg()) fillVoices(); });
  document.getElementById('tts-synth').addEventListener('click', async () => {
    const c = await requireCfg(); if (!c) return;
    const text = document.getElementById('tts-text').value.trim();
    const voice = voiceSel.value;
    if (!text) { setStatus(status, '请输入合成文本', 'hf-error'); return; }
    if (!voice) { setStatus(status, '请先选择（或创建）音色', 'hf-error'); return; }
    const btn = document.getElementById('tts-synth');
    btn.disabled = true;
    setStatus(status, '正在合成并下载语音…', '');
    try {
      const res = await window.voiceTools.synth(text, voice, defaultProj(), saveModeSel.value === 'custom' ? cfgSaveDir : '');
      if (res && res.ok) {
        setStatus(status, '合成完成，已保存到项目：' + (res.projectName || '（音频输出目录）'), 'hf-ok');
        const wrap = document.getElementById('tts-result-wrap');
        if (wrap) wrap.style.display = '';
        const rp = document.getElementById('tts-result-path');
        if (rp) rp.textContent = '保存路径：' + (res.savePath || '');
        const au = document.getElementById('tts-audio');
        if (au && res.savePath) {
          au.src = 'file:///' + encodeURI(String(res.savePath).replace(/\\/g, '/'));
          au.load();
        }
        openBtn.disabled = false;
        fillGenAudios(true);
      } else {
        setStatus(status, (res && res.message) || '合成失败', 'hf-error');
      }
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('tts-to-settings').addEventListener('click', () => goPage('settings'));
  openBtn.addEventListener('click', () => {
    const n = defaultProj();
    if (n) window.projectTools.openFolder(n);
  });

  // —— 保存位置：切换 / 选择文件夹 / 恢复默认 ——
  saveModeSel.addEventListener('change', () => {
    if (saveModeSel.value === 'custom' && !cfgSaveDir) {
      setStatus(status, '请点击「选择文件夹」指定自定义保存目录（持久化，后续合成默认生效）', 'hf-error');
    }
    renderSaveDir();
  });
  pickDirBtn.addEventListener('click', async () => {
    const c = await requireCfg(); if (!c) return;
    const r = await window.voiceTools.pickDir();
    if (!r || r.canceled) return;
    if (!r.ok) { setStatus(status, (r.message) || '选择目录失败', 'hf-error'); return; }
    cfgSaveDir = r.dir;
    saveModeSel.value = 'custom';
    renderSaveDir();
    const res = await window.voiceTools.saveConfig({ apiKey: c.apiKey, targetModel: c.targetModel, saveDir: cfgSaveDir });
    if (res && res.ok) setStatus(status, '保存位置已设为自定义目录：' + cfgSaveDir, 'hf-ok');
    else setStatus(status, (res && res.message) || '保存设置失败', 'hf-error');
  });
  resetDirBtn.addEventListener('click', async () => {
    const c = await requireCfg(); if (!c) return;
    cfgSaveDir = '';
    saveModeSel.value = 'default';
    renderSaveDir();
    const res = await window.voiceTools.saveConfig({ apiKey: c.apiKey, targetModel: c.targetModel, saveDir: '' });
    if (res && res.ok) setStatus(status, '已恢复默认保存位置（项目 audio/ 或音频输出目录）', 'hf-ok');
    else setStatus(status, (res && res.message) || '保存设置失败', 'hf-error');
  });

  // —— 已生成音频：刷新 / 试听 / 设为当前项目背景音频 ——
  document.getElementById('tts-gen-refresh').addEventListener('click', () => fillGenAudios(false));
  genSel.addEventListener('change', updateGenSel);
  genPlayBtn.addEventListener('click', () => {
    if (!genAudio || !genAudio.dataset.path) { toast('请先选择已生成音频'); return; }
    if (genAudio.paused) { genAudio.play().catch(() => toast('音频试听失败（可能文件已被移动）')); }
    else genAudio.pause();
  });
  genSetBtn.addEventListener('click', async () => {
    const it = genAudios[Number(genSel.value)];
    if (!it) { toast('请先选择已生成音频'); return; }
    if (AppState.isBuiltin) { toast('内置项目只读，请切换到自己的项目'); return; }
    const res = await window.projectTools.setAudio(AppState.currentName, it.path);
    if (!res || !res.ok) { toast((res && res.message) || '设置背景音频失败'); return; }
    await refreshProject();
    toast('已设为当前项目背景音频：' + res.audioFile);
  });

  // —— 已生成音频 / 合成结果：语速调节（左右 ±0.05 步进 + 可手输任意小数；仅改播放 playbackRate，不改磁盘音频；0.5~2.0，非法或空值回退 1） ——
  const bindRate = (inputId, decId, incId, audio) => {
    const input = document.getElementById(inputId);
    const dec = document.getElementById(decId);
    const inc = document.getElementById(incId);
    if (input) input.addEventListener('input', () => applyRate(input, audio));
    if (dec) dec.addEventListener('click', () => stepRate(input, audio, -0.05));
    if (inc) inc.addEventListener('click', () => stepRate(input, audio, 0.05));
  };
  bindRate('tts-gen-rate', 'tts-gen-rate-dec', 'tts-gen-rate-inc', genAudio);
  bindRate('tts-rate', 'tts-rate-dec', 'tts-rate-inc', document.getElementById('tts-audio'));

  fillProj();
  (async () => {
    if (await requireCfg()) { fillVoices(); fillGenAudios(true); }
  })();
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
  // 进入页面即清空上一轮状态文案/样式，避免残留“已生成 / 失败”的旧信息
  if (status) { status.textContent = ''; status.classList.remove('hf-error', 'hf-ok'); }
  const subList = document.getElementById('hg-sub-list');
  const audioList = document.getElementById('hg-audio-list');

  const pfx = (p) => (p && p.audioFile) ? escTxt(p.audioFile) : '未设置';
  const renderMeta = () => {
    const p = AppState.project || {};
    const hasH = hasHtml();
    const subCount = (p && p.subtitleCount) || 0;
    const meta = document.getElementById('hg-meta');
    if (meta) {
      meta.innerHTML = AppState.isBuiltin
        ? '<div class="proj-stat"><b>内置示例（只读）</b>示例项目不可生成 / 修改，自带示例 HTML。请在「工作项目」下拉切换到「我的项目」。</div>'
        : '<div class="proj-stat ' + (hasH ? 'on' : '') + '"><b>HTML</b>' + (hasH ? '已生成' : '尚未生成') + '</div>' +
          '<div class="proj-stat ' + (subCount ? 'on' : '') + '"><b>素材</b>' + (subCount ? '字幕 ' + subCount + ' 条' + ((p && p.audioFile) ? ' · 已配背景音频' : '') : '无字幕（可先到「字幕生成」页添加）') + '</div>' +
          '<div class="proj-stat"><b>用法</b>' + (hasH ? '可「下载 HTML」；也可填写需求后「修改 HTML」' : '填写需求描述后点「生成 HTML」；字幕 / 背景音频在上方选配（均可选）') + '</div>';
    }
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

  // 状态联动：有 HTML → 自动预览；无 HTML → 恢复“尚未生成”提示（不展示空 iframe）
  const syncPreview = () => {
    // 内置示例为只读项目：其 HTML 属于示例资源而非本页生成产物，不在此展示为“已生成”/自动预览
    const ok = !AppState.isBuiltin && !!(AppState.project.htmlExists && AppState.project.htmlPath);
    if (ok) loadFrame(AppState.project.htmlPath);
    else {
      if (frame) { frame.style.display = 'none'; frame.removeAttribute('src'); }
      if (empty) {
        empty.style.display = '';
        empty.textContent = AppState.isBuiltin
          ? '内置示例项目为只读：自带示例 HTML，可到「HTML 预览」页查看效果；生成请先在「工作项目」下拉切换到「我的项目」。'
          : '尚未生成 HTML。';
      }
    }
  };

  // —— 素材选择：字幕（当前项目字幕 + 其它带字幕项目）——
  const fillSubList = () => {
    if (!subList) return;
    subList.innerHTML = '';
    const addOpt = (value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      subList.appendChild(o);
    };
    addOpt('', '不使用字幕');
    const p = AppState.project || {};
    if (!AppState.isBuiltin && (p.subtitle || '').trim()) {
      addOpt('__current__', '当前项目字幕（' + ((p.subtitleCount) || 0) + ' 条）');
    }
    (AppState.myProjects || []).forEach((mp) => {
      if (mp && mp.name !== AppState.currentName && mp.hasSubtitle) {
        addOpt(String(mp.name), '项目「' + (mp.title || mp.name) + '」字幕（' + (mp.subtitleCount || 0) + ' 条）');
      }
    });
  };

  // —— 素材选择：背景音频（当前项目背景音频 + 已生成 TTS 音频）——
  let genAudios = [];
  const fillAudioList = (items) => {
    if (!audioList) return;
    genAudios = items || [];
    audioList.innerHTML = '';
    const addOpt = (value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      audioList.appendChild(o);
    };
    addOpt('', '不使用背景音频');
    const p = AppState.project || {};
    if (!AppState.isBuiltin && p.audioFile) {
      addOpt('__current__', '当前项目背景音频（' + p.audioFile + '）');
    }
    genAudios.forEach((it) => {
      if (it && it.path) addOpt(String(it.path), '已生成：' + (it.name || it.path) + (it.group ? '（' + it.group + '）' : ''));
    });
  };

  (async () => {
    fillSubList();
    renderMeta();
    syncPreview();
    // 载入已生成 TTS 音频列表，填充背景音频下拉
    const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, items: [] }));
    fillAudioList((res && res.ok) ? (res.items || []) : []);
  })();

  // —— 生成 / 修改：读取行内提示词输入框，提交给自定义模型 Agent ——
  let agentRunning = false;
  const runAgent = async (mode) => {
    if (agentRunning) { toast('上一个请求还在处理中，请稍候'); return; }
    if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
    const promptEl = document.getElementById('hg-prompt');
    const prompt = promptEl.value.trim();
    if (!prompt) { toast('请先填写需求描述（上方提示词输入框）'); promptEl.focus(); return; }
    agentRunning = true;
    if (status) { status.textContent = '已提交给 Agent，处理中...'; status.classList.remove('hf-error', 'hf-ok'); }
    // 本次生成/修改所选素材（均可空：留空 = 不拼接对应素材；'' → 跳过）
    const materials = {
      subtitleProject: subList ? subList.value : '',
      audioPath: audioList ? audioList.value : ''
    };
    try {
      const call = (mode === 'generate')
        ? window.projectTools.generateHtml(AppState.currentName, prompt, materials)
        : window.projectTools.modifyHtml(AppState.currentName, prompt, materials);
      const res = await call;
      if (res && res.ok) {
        await refreshProject();
        renderMeta();
        syncPreview();
        if (status) { status.textContent = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : ''); status.classList.add('hf-ok'); }
        toast(mode === 'generate' ? 'HTML 已生成' : 'HTML 已修改');
        renderStepBar('html-gen');
      } else {
        const msg = (res && res.message) || '提交失败';
        if (status) { status.textContent = msg; status.classList.add('hf-error'); }
        // 生成失败且项目原本就无 HTML：恢复“未生成”展示，避免误显示为已生成
        if (!AppState.project.htmlExists) {
          if (frame) { frame.style.display = 'none'; frame.removeAttribute('src'); }
          if (empty) empty.style.display = '';
        }
        toast(msg);
      }
    } finally {
      agentRunning = false;
    }
  };
  document.getElementById('hg-gen').addEventListener('click', () => runAgent('generate'));
  document.getElementById('hg-mod').addEventListener('click', () => {
    if (!AppState.project.htmlExists) { toast('还没有 HTML，先「生成 HTML」'); return; }
    runAgent('modify');
  });

  // —— 下载 HTML ——
  document.getElementById('hg-download').addEventListener('click', async () => {
    let res;
    if (AppState.isBuiltin && AppState.project.htmlPath) {
      // 内置示例：直接导出其自带 index.html（只读；不落盘到 userData 项目）
      res = await window.projectTools.downloadFile(AppState.project.htmlPath, AppState.currentName + '.html');
    } else {
      res = await window.projectTools.downloadHtml(AppState.currentName);
    }
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
    if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
    const picked = await window.projectTools.pickAudio();
    if (!picked) return;
    const res = await window.projectTools.setAudio(AppState.currentName, picked);
    if (!res.ok) { toast(res.message || '设置音频失败'); return; }
    await refreshProject();
    renderMeta();
    toast('已加入音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
  });
  document.getElementById('hg-clear-audio').addEventListener('click', async () => {
    if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
    await window.projectTools.clearAudio(AppState.currentName);
    await refreshProject();
    renderMeta();
    toast('已移除音频');
  });

  // —— 已生成音频：复用为当前项目背景音频（入口） ——
  const hgGenSel = document.getElementById('hg-gen-list');
  const hgGenPlay = document.getElementById('hg-gen-play');
  const hgGenUse = document.getElementById('hg-gen-use');
  const hgGenAudio = document.getElementById('hg-gen-audio');
  let hgGenAudios = [];
  const hgGenUpdate = () => {
    const it = hgGenAudios[Number(hgGenSel.value)];
    if (!it) { hgGenUse.disabled = true; return; }
    hgGenUse.disabled = AppState.isBuiltin;
    if (hgGenAudio) {
      hgGenAudio.dataset.path = it.path;
      hgGenAudio.src = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
      hgGenAudio.load();
    }
    const hgGenPlayRow = document.getElementById('hg-gen-play-row');
    if (hgGenPlayRow) hgGenPlayRow.style.display = '';
  };
  const hgGenLoad = async (silent) => {
    const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' }));
    if (!res || !res.ok) {
      if (!silent) toast((res && res.message) || '加载已生成音频失败');
      return;
    }
    hgGenAudios = res.items || [];
    hgGenSel.innerHTML = '';
    if (!hgGenAudios.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（暂无已生成音频）';
      hgGenSel.appendChild(o);
      hgGenUse.disabled = true;
      if (hgGenAudio) { hgGenAudio.src = ''; }
      const hgGenPlayRowEmpty = document.getElementById('hg-gen-play-row');
      if (hgGenPlayRowEmpty) hgGenPlayRowEmpty.style.display = 'none';
      return;
    }
    hgGenAudios.forEach((it, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = it.name + '（' + it.group + '）';
      hgGenSel.appendChild(o);
    });
    hgGenUpdate();
  };
  document.getElementById('hg-gen-refresh').addEventListener('click', () => hgGenLoad(false));
  hgGenSel.addEventListener('change', hgGenUpdate);
  hgGenPlay.addEventListener('click', () => {
    if (!hgGenAudio || !hgGenAudio.dataset.path) { toast('请先选择已生成音频'); return; }
    if (hgGenAudio.paused) hgGenAudio.play().catch(() => toast('音频试听失败（可能文件已被移动）'));
    else hgGenAudio.pause();
  });
  hgGenUse.addEventListener('click', async () => {
    const it = hgGenAudios[Number(hgGenSel.value)];
    if (!it) { toast('请先选择已生成音频'); return; }
    if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
    const res = await window.projectTools.setAudio(AppState.currentName, it.path);
    if (!res || !res.ok) { toast((res && res.message) || '设置背景音频失败'); return; }
    await refreshProject();
    renderMeta();
    toast('已设为背景音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
  });
  // —— 已生成音频试听：语速调节（左右 ±0.05 步进 + 可手输任意小数；仅改播放 playbackRate，不改磁盘音频；0.5~2.0，非法或空值回退 1） ——
  const hgGenRate = document.getElementById('hg-gen-rate');
  if (hgGenRate) hgGenRate.addEventListener('input', () => applyRate(hgGenRate, hgGenAudio));
  const hgGenRateDec = document.getElementById('hg-gen-rate-dec');
  if (hgGenRateDec) hgGenRateDec.addEventListener('click', () => stepRate(hgGenRate, hgGenAudio, -0.05));
  const hgGenRateInc = document.getElementById('hg-gen-rate-inc');
  if (hgGenRateInc) hgGenRateInc.addEventListener('click', () => stepRate(hgGenRate, hgGenAudio, 0.05));
  hgGenLoad(true);
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
  // 修复：项目选择器（#proj-select / #proj-file / #btn-openfolder）位于 .project-selector 中，
  // 它是 .card.hf-page 的兄弟节点而非子节点，必须从 content 作用域查询；否则为 null 会中断本页初始化。
  const fileEl = el.querySelector('#hf-file');
  const projFileEl = content.querySelector('#proj-file');
  const statusEl = el.querySelector('#hf-status');
  const btnOpen = el.querySelector('[data-hf="open"]');
  const btnRender = el.querySelector('[data-hf="render"]');
  const btnRefresh = el.querySelector('[data-hf="refresh"]');
  const frame = el.querySelector('#hf-frame');
  const videoWrap = el.querySelector('#hf-video-wrap');
  const videoEl = el.querySelector('#hf-video');
  const btnShowFolder = el.querySelector('[data-hf="show-folder"]');
  const sel = content.querySelector('#proj-select');
  const btnOpenFolder = content.querySelector('#btn-openfolder');
  hfHtmlPath = null;
  lastVideoPath = null;

  statusEl.textContent = '';
  statusEl.classList.remove('hf-error', 'hf-ok');
  fileEl.textContent = '未选择文件';
  if (projFileEl) projFileEl.textContent = AppState.project.name || '未选择';
  btnRender.disabled = true;
  if (btnRefresh) btnRefresh.disabled = true;
  if (videoWrap && videoEl) {
    videoWrap.hidden = true;
    videoEl.removeAttribute('src');
    videoEl.load();
  }
  if (frame) frame.removeAttribute('src');

  const setHtml = async (p) => {
    hfHtmlPath = p;
    fileEl.textContent = p;
    let src = null;
    try {
      // 优先经"预览外壳"加载：外壳在目标 HTML 同目录、内部使用本地 hyperframes-player
      // 组件，提供播放条（controls）与等比缩放，避免直接落地 iframe 导致无进度条、内容被裁剪。
      if (window.hfTools && typeof window.hfTools.previewShell === 'function') {
        const res = await window.hfTools.previewShell(p);
        if (res && res.ok && res.shellPath) {
          src = 'file:///' + encodeURI(res.shellPath.replace(/\\/g, '/'));
        }
      }
    } catch (e) { src = null; }
    if (frame) {
      frame.src = src || ('file:///' + encodeURI(p.replace(/\\/g, '/')));
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
    btnOpenFolder.addEventListener('click', () => {
      if (AppState.isBuiltin) {
        if (AppState.project.htmlPath) {
          window.projectTools.openFolderOf(AppState.project.htmlPath);
        } else {
          toast('内置示例项目为只读；可在「HTML 生成」页切换到「我的项目」');
        }
        return;
      }
      window.projectTools.openFolder(AppState.currentName);
    });
  }

  // 联动“已生成”状态：未生成 HTML 时给出引导提示，但仍保留手动预览能力
  if (!AppState.project.htmlExists) {
    statusEl.textContent = '该项目尚未生成 HTML，请先在「HTML 生成」页生成；也可以点击“选择 HTML 文件”手动预览。';
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
      // 走 setHtml 统一入口，刷新后仍保持播放外壳（进度条/等比缩放）
      if (hfHtmlPath) setHtml(hfHtmlPath);
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

// ===== 设置页：自定义模型（OpenAI 兼容） =====
INIT.settings = function () {
  const baseEl = document.getElementById('set-base-url');
  const modelEl = document.getElementById('set-model-id');
  const keyEl = document.getElementById('set-api-key');
  const enabledEl = document.getElementById('set-enabled');
  const statusEl = document.getElementById('set-status');
  if (!baseEl || !modelEl || !keyEl) return;

  const setStatus = (text, kind) => {
    statusEl.textContent = text || '';
    statusEl.classList.remove('hf-error', 'hf-ok');
    if (kind) statusEl.classList.add(kind);
  };

  // 载入当前配置
  (async () => {
    try {
      const s = await window.settingsTools.get();
      const m = (s && s.customModel) || {};
      baseEl.value = m.baseUrl || '';
      modelEl.value = m.modelId || '';
      keyEl.value = m.apiKey || '';
      enabledEl.checked = !!m.enabled;
    } catch (e) { setStatus('读取配置失败：' + (e && e.message ? e.message : e), 'hf-error'); }
  })();

  document.getElementById('set-save').addEventListener('click', async () => {
    const customModel = {
      baseUrl: baseEl.value.trim(),
      modelId: modelEl.value.trim(),
      apiKey: keyEl.value.trim(),
      enabled: enabledEl.checked
    };
    if (!customModel.baseUrl || !customModel.modelId || !customModel.apiKey) {
      setStatus('配置不完整：Base URL / Model ID / API Key 均需填写', 'hf-error');
      return;
    }
    const res = await window.settingsTools.save(customModel);
    setStatus(res && res.ok ? '配置已保存，可开始使用自定义模型生成 HTML' : ((res && res.message) || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
  });

  document.getElementById('set-test').addEventListener('click', async () => {
    const customModel = {
      baseUrl: baseEl.value.trim(),
      modelId: modelEl.value.trim(),
      apiKey: keyEl.value.trim(),
      enabled: enabledEl.checked
    };
    setStatus('正在测试连接...', '');
    const res = await window.settingsTools.test(customModel);
    setStatus(res && res.ok ? res.message : ((res && res.message) || '测试失败'), res && res.ok ? 'hf-ok' : 'hf-error');
  });

  // —— 千问语音配置（声音复制 & 文字生音频）——
  const vKeyEl = document.getElementById('set-v-api-key');
  const vModelEl = document.getElementById('set-v-model');
  const vStatusEl = document.getElementById('set-v-status');
  if (vKeyEl && vModelEl && vStatusEl) {
    const setVStatus = (text, kind) => {
      vStatusEl.textContent = text || '';
      vStatusEl.classList.remove('hf-error', 'hf-ok');
      if (kind) vStatusEl.classList.add(kind);
    };
    (async () => {
      try {
        const s = await window.settingsTools.get();
        const v = (s && s.voiceTTS) || {};
        vKeyEl.value = v.apiKey || '';
        if (v.targetModel && vModelEl.querySelector('option[value="' + v.targetModel + '"]')) {
          vModelEl.value = v.targetModel;
        }
      } catch (e) { setVStatus('读取千问语音配置失败', 'hf-error'); }
    })();
    document.getElementById('set-v-save').addEventListener('click', async () => {
      const res = await window.voiceTools.saveConfig({ apiKey: vKeyEl.value.trim(), targetModel: vModelEl.value });
      setVStatus(res && res.ok ? '千问语音配置已保存，可在「声音复制」「文字生音频」中使用' : ((res && res.message) || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
    });
  }
};

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
