// renderer/pages/subtitle.js —— 字幕页：字幕编辑器（条目列表）+「从音频生成字幕」转录弹窗
// 模型下载/删除/当前使用档位的管理入口在「设置」页（语音识别模型区块）；
// 本页只负责：条目增删改 + 保存到项目 + 由脚本旁白生成 + 打开转录弹窗并在完成后回填条目。
(function () {
  'use strict';

  const { AppState, renderStepBar, toast, refreshProject, goPage } = window.App;

  const escTxt = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ===== 时间工具：条目内部用「秒」，界面显示「分:秒」，落盘沿用 [分:秒] 文本（与主进程 parseSubtitle 一致） =====
  function fmtTime(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function parseTime(str) {
    const t = String(str == null ? '' : str).trim();
    if (!t) return null;
    let m = t.match(/^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
    if (m) return (+m[1]) * 60 + (+m[2]) + (+(m[3] || 0)) / 1000;
    m = t.match(/^(\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]);
    return null;
  }
  // 无时间戳行的估时规则（与主进程 parseSubtitle 保持一致：max(2.4, 1.6 + 字数 * 0.15)）
  function estDur(text) {
    const t = String(text || '');
    return Math.max(2.4, 1.6 + t.length * 0.15);
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  // ===== 字幕条目状态 =====
  let items = [];        // [{ start:秒, end:秒, text }]
  let dom = {};
  let transcribing = false;
  let escHandler = null;  // 弹窗 ESC 关闭监听（每次进入页面先解绑上一次，避免叠加）

  // 由下一行起始时间推导结束时间；末条按时长估算
  function fillEnds(list) {
    list.forEach((it, i) => {
      const next = list[i + 1];
      const start = Number(it.start) || 0;
      const end = next ? Number(next.start) || 0 : start + estDur(it.text);
      it.end = end > start ? end : start + estDur(it.text);
    });
    return list;
  }

  // 解析项目字幕文本 → 条目数组（支持 [分:秒] / [分:秒.毫秒] 与纯文本行）
  function parseSubtitleText(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const list = [];
    let autoT = 0.4;
    lines.forEach((line) => {
      const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?\]\s*(.*)$/);
      let txt = line;
      let time = null;
      if (m) {
        txt = m[4].trim();
        time = (+m[1]) * 60 + (+m[2]) + (+(m[3] || 0)) / 1000;
      }
      if (!txt) return;
      if (time === null) {
        time = autoT;
        autoT += estDur(txt);
      }
      list.push({ start: time, end: null, text: txt });
    });
    return fillEnds(list);
  }

  // 条目数组 → 项目字幕文本（[分:秒] 文本；时间轴以起始时间为准）
  function serializeItems(list) {
    return list
      .filter((it) => String(it.text || '').trim())
      .map((it) => {
        const txt = String(it.text).replace(/\s+/g, ' ').trim();
        return (it.start === null || it.start === undefined || !isFinite(Number(it.start)) ? '' : '[' + fmtTime(it.start) + '] ') + txt;
      })
      .join('\n');
  }

  function updateCount() {
    if (!dom.count) return;
    const valid = items.filter((it) => String(it.text || '').trim()).length;
    if (!valid) { dom.count.textContent = ''; return; }
    const last = items[items.length - 1];
    const total = Number(last && last.end) || 0;
    dom.count.textContent = '共 ' + valid + ' 条 · 总时长约 ' + fmtTime(total);
  }

  function setStatus(msg, color) {
    if (!dom.status) return;
    dom.status.textContent = msg || '';
    dom.status.style.color = color || '';
  }

  // ===== 条目列表渲染 =====
  function renderList() {
    if (!dom.list) return;
    if (!items.length) {
      dom.list.innerHTML = '<div class="sub-empty">暂无字幕条目。可点「新增条目」手工添加，或用上方「从音频生成字幕」「由脚本旁白生成」自动生成。</div>';
      updateCount();
      return;
    }
    dom.list.innerHTML = items.map((it, i) => {
      const startV = (it.start === null || it.start === undefined || !isFinite(Number(it.start))) ? '' : fmtTime(it.start);
      const endV = (it.end === null || it.end === undefined || !isFinite(Number(it.end))) ? '' : fmtTime(it.end);
      return '<div class="sub-row" data-i="' + i + '">' +
        '<div class="sub-idx">' + (i + 1) + '</div>' +
        '<input class="sub-time" data-f="start" value="' + escTxt(startV) + '" title="起始时间（分:秒），字幕时间轴以此为准"/>' +
        '<span class="sub-arrow">→</span>' +
        '<input class="sub-time" data-f="end" value="' + escTxt(endV) + '" title="结束时间（分:秒），编辑参考用"/>' +
        '<textarea class="sub-text" data-f="text" spellcheck="false" placeholder="该条字幕文本">' + escTxt(it.text) + '</textarea>' +
        '<button class="sub-del" data-act="del" title="删除该条">删除</button>' +
      '</div>';
    }).join('');
    updateCount();
  }

  // ===== 保存到项目 =====
  async function saveToProject(options) {
    const silent = !!(options && options.silent);
    if (AppState.isBuiltin) {
      if (!silent) toast('内置示例项目只读，请先切换到自己的项目');
      return false;
    }
    const text = serializeItems(items);
    if (!text.trim()) {
      if (!silent) toast('字幕内容为空，请先添加条目或生成字幕');
      return false;
    }
    const title = dom.title ? dom.title.value.trim() : '';
    const res = await window.projectTools.saveSubtitle(AppState.currentName, text, title);
    if (!res || !res.ok) {
      if (!silent) toast((res && res.message) || '保存失败');
      return false;
    }
    await refreshProject();
    if (!silent) toast('字幕已保存：共 ' + ((res.project && res.project.subtitleCount) || items.length) + ' 条');
    return true;
  }

  // ===== 转录弹窗 =====
  function setTwStatus(msg, kind) {
    if (!dom.twStatus) return;
    dom.twStatus.textContent = msg || '';
    dom.twStatus.classList.remove('hf-error', 'hf-ok');
    if (kind) dom.twStatus.classList.add(kind);
  }
  function showTwBar(msg, indeterminate) {
    if (!dom.twBarWrap) return;
    const info = msg || {};
    dom.twBarWrap.style.display = '';
    dom.twBar.className = 'whisper-bar' + (indeterminate ? ' indeterminate' : '');
    dom.twFill.className = 'whisper-bar-fill' + (info.kind === 'done' ? ' done' : info.kind === 'error' ? ' error' : '');
    dom.twBarText.textContent = info.text || '';
  }
  function hideTwBar() {
    if (dom.twBarWrap) dom.twBarWrap.style.display = 'none';
    if (dom.twBarText) dom.twBarText.textContent = '';
  }
  function syncTwStart() {
    if (!dom.twStart) return;
    dom.twStart.disabled = transcribing || !dom.twAudioInput.value || !twModelReady();
    dom.twStart.textContent = transcribing ? '转录中…' : '开始转录';
  }
  let twModel = { id: '', label: '', downloaded: false };

  function twModelReady() {
    return !!(twModel.id && twModel.downloaded);
  }

  async function loadTwModel() {
    const status = await window.whisperTools.status().catch(() => null);
    if (!status) { twModel = { id: '', label: '', downloaded: false }; }
    else {
      const list = status.models || [];
      let cur = list.find((m) => m.isCurrent) || list.find((m) => m.id === status.currentModelId);
      let fallback = false;
      if (!cur) {
        cur = list.find((m) => m.downloaded);
        fallback = !!cur;
      }
      twModel = cur ? { id: cur.id, label: cur.label, downloaded: !!cur.downloaded, fallback } : { id: '', label: '', downloaded: false };
      if (dom.langSel && status.langs && status.langs.length) {
        dom.langSel.innerHTML = status.langs.map((l) => '<option value="' + escTxt(l.id) + '">' + escTxt(l.label) + '</option>').join('');
        dom.langSel.value = 'auto';
      }
    }
    if (dom.twModel) {
      if (!twModel.id) { dom.twModel.textContent = '未选择识别模型'; dom.twModel.style.color = 'var(--color-warning)'; }
      else if (!twModel.downloaded) { dom.twModel.textContent = twModel.label + '（已选但未下载）'; dom.twModel.style.color = 'var(--color-warning)'; }
      else { dom.twModel.textContent = twModel.label + (twModel.fallback ? '（已下载，尚未设为当前使用）' : '（已就绪）'); dom.twModel.style.color = ''; }
    }
    const hint = dom.twModelHint;
    if (hint) {
      hint.textContent = twModelReady()
        ? '转录在本机 CPU 完成，不消耗 API 额度。'
        : (!twModel.id
            ? '当前没有可用的识别模型：请到「设置 → 语音识别模型」下载并设为当前使用后再转录。'
            : '当前识别模型尚未下载完成：请到「设置 → 语音识别模型」下载「' + twModel.label + '」。');
      hint.style.color = twModelReady() ? '' : 'rgba(255, 176, 32, 0.9)';
    }
    syncTwStart();
  }

  async function loadProjectAudio() {
    const name = AppState.currentName;
    const res = await window.whisperTools.projectAudio(name).catch(() => null);
    if (res && res.ok) {
      dom.twAudioInput.value = res.path;
      return { ok: true, path: res.path };
    }
    dom.twAudioInput.value = '';
    return { ok: false, message: (res && res.message) || '读取项目音频失败' };
  }

  async function openTw() {
    if (AppState.isBuiltin) { toast('内置示例项目只读，请先切换到自己的项目'); return; }
    if (!dom.twMask) return;
    dom.twMask.style.display = 'flex';
    // 清空上一轮残留状态（避免旧状态/旧结果误显）
    setTwStatus('', '');
    hideTwBar();
    dom.twFootStart.style.display = '';
    dom.twFootApply.style.display = 'none';
    dom.twAudioInput.value = '';
    dom.twSrcProject.checked = true;
    dom.twPick.disabled = true;
    pendingResult = null;
    syncTwStart();
    await loadTwModel();
    const a = await loadProjectAudio();
    if (a.ok) setTwStatus('已载入项目音频：' + a.path, '');
    else setTwStatus(a.message + '（可切换为「浏览本地文件」）', 'hf-error');
    syncTwStart();
  }

  function closeTw() {
    if (!dom.twMask) return;
    dom.twMask.style.display = 'none';
    hideTwBar();
    setTwStatus('', '');
    dom.twFootStart.style.display = '';
    dom.twFootApply.style.display = 'none';
  }

  let pendingResult = null; // 转录结果 { segments }

  async function doTranscribe() {
    if (transcribing) return;
    const audioPath = dom.twAudioInput.value;
    if (!audioPath) { setTwStatus('请先选择要转录的音频', 'hf-error'); return; }
    if (!twModelReady()) { setTwStatus('识别模型不可用，请先到设置页下载并设为当前使用', 'hf-error'); return; }
    transcribing = true;
    pendingResult = null;
    dom.twFootStart.style.display = '';
    dom.twFootApply.style.display = 'none';
    syncTwStart();
    setTwStatus('正在启动 whisper-cli（' + twModel.label + '）…', '');
    showTwBar({ text: '正在启动转录…' }, true);
    try {
      const res = await window.whisperTools.transcribe({
        id: twModel.id,
        audioPath,
        language: dom.langSel ? dom.langSel.value : 'auto'
      });
      if (!res || !res.ok) {
        showTwBar({ text: (res && res.message) || '转录失败', kind: 'error' }, false);
        setTwStatus((res && res.message) || '转录失败', 'hf-error');
        return;
      }
      pendingResult = { segments: res.segments || [] };
      const n = (res.segments || []).length;
      showTwBar({ text: '转录完成：' + n + ' 条字幕（模型 ' + (res.model || twModel.label) + '）', kind: 'done' }, false);
      setTwStatus('转录完成。请选择回填方式：替换现有字幕，或追加到现有字幕末尾。', 'hf-ok');
      dom.twFootStart.style.display = 'none';
      dom.twFootApply.style.display = '';
    } catch (e) {
      const msg = String((e && e.message) || e);
      showTwBar({ text: msg, kind: 'error' }, false);
      setTwStatus(msg, 'hf-error');
    } finally {
      transcribing = false;
      syncTwStart();
    }
  }

  function applyTranscript(mode) {
    if (!pendingResult || !pendingResult.segments || !pendingResult.segments.length) {
      toast('没有可回填的转录结果');
      return;
    }
    const segs = pendingResult.segments
      .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text || '').trim() }))
      .filter((s) => s.text);
    if (!segs.length) { toast('转录结果中没有有效文本'); return; }
    if (mode === 'replace') {
      items = segs;
    } else {
      let base = 0;
      if (items.length) {
        const last = items[items.length - 1];
        base = (last.end === null || last.end === undefined || !isFinite(Number(last.end)) || Number(last.end) <= Number(last.start))
          ? (Number(last.start) || 0) + estDur(last.text)
          : Number(last.end);
      }
      items = items.concat(segs.map((s) => ({ start: s.start + base, end: s.end + base, text: s.text })));
    }
    items.forEach((it) => {
      it.start = Math.max(0, Number(it.start) || 0);
      it.end = Math.max(it.start, Number(it.end) || 0) || it.start + estDur(it.text);
    });
    renderList();
    closeTw();
    toast(mode === 'replace' ? '已用转录结果替换字幕：共 ' + segs.length + ' 条' : '已在字幕末尾追加 ' + segs.length + ' 条');
    // 回填即落盘，避免用户忘记保存（保存失败时给出提示，条目仍保留在编辑器中）
    saveToProject({ silent: true }).then((ok) => {
      if (!ok) setStatus('转录结果已回填，但自动保存失败，请点「保存到项目」重试', 'var(--color-danger)');
      else setStatus('转录结果已回填并保存到项目「' + AppState.currentName + '」', 'var(--color-success)');
    });
  }

  // ===== 由脚本旁白生成条目 =====
  function fromContent() {
    const content = AppState.project && AppState.project.content;
    const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
    if (!scenes.length) { toast('当前项目无内容脚本，请先到「内容脚本」页编写'); return; }
    let time = 0;
    let usedDur = 0;
    let estimated = 0;
    const list = [];
    scenes.forEach((s) => {
      const narr = (s && typeof s.narration === 'string' ? s.narration : '').trim();
      if (!narr) return;
      const raw = s && s.durHint;
      const rawN = Number(raw);
      const hasDur = raw !== '' && raw !== null && raw !== undefined && isFinite(rawN) && rawN > 0;
      const dur = hasDur ? rawN : estDur(narr);
      if (hasDur) usedDur++; else estimated++;
      list.push({ start: time, end: time + dur, text: narr });
      time += dur;
    });
    if (!list.length) { toast('内容脚本中暂无有效的旁白文本，请先到「内容脚本」页填写旁白'); return; }
    items = list;
    renderList();
    toast('已由脚本旁白生成 ' + list.length + ' 条字幕，可保存到项目'
      + (usedDur ? '（' + usedDur + ' 条按时长提示累计）' : '')
      + (estimated ? '（' + estimated + ' 条按估时）' : ''));
  }

  App.pages.subtitle = {
    html: `<div class="project-bar" data-slot></div>

<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>字幕编辑器</div>
  <div class="hgen-tip">逐条编辑字幕：序号 / 起始时间 / 结束时间 / 文本，可删除与新增，编辑完点「保存到项目」。也可由音频自动识别，或由内容脚本旁白生成初稿。字幕时间轴以下方的「起始时间」为准。</div>
  <div class="hgen-actions" style="margin-top:var(--space-4)">
    <button class="hf-btn hf-btn-primary" id="sub-open-tw">从音频生成字幕</button>
    <button class="hf-btn" id="sub-from-content" title="依据内容脚本的场景旁白与时长提示生成逐条字幕，覆盖当前条目">由脚本旁白生成</button>
  </div>
</div>

<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>字幕条目</div>
  <div class="sub-list" id="sub-list"></div>
  <div class="hgen-actions" style="margin-top:var(--space-3)">
    <button class="hf-btn" id="sub-add">新增条目</button>
    <span class="sub-count" id="sub-count"></span>
  </div>
  <div class="hgen-row" style="margin-top:var(--space-4)">
    <label class="sel-label">页面标题</label>
    <input id="sub-title" class="hgen-input" style="flex:1" placeholder="字幕动画标题，如：我的第一个字幕动画"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="sub-save">保存到项目</button>
  </div>
  <div class="hf-status" id="sub-status"></div>
  <div class="sub-note">时间格式：<code>分:秒</code>（如 <code>00:05</code>），也可填 <code>00:05.500</code> 精确到毫秒；保存时以起始时间写入 <code>[分:秒] 文本</code>，供 HTML / 视频阶段对齐时间轴。</div>
</div>

<div class="hf-modal-mask" id="tw-mask" style="display:none">
  <div class="hf-modal">
    <div class="hf-modal-head">
      <span class="hf-modal-title">从音频生成字幕</span>
      <button class="hf-modal-close" id="tw-close" title="关闭">×</button>
    </div>
    <div class="hf-modal-body">
      <div class="panel-title-sm" style="margin-top:0">① 选择音频</div>
      <div class="hgen-row">
        <label class="hgen-check"><input type="radio" name="tw-src" id="tw-src-project" checked/> 使用项目音频</label>
        <label class="hgen-check"><input type="radio" name="tw-src" id="tw-src-file"/> 浏览本地文件</label>
      </div>
      <div class="hgen-row">
        <input id="tw-audio" class="hgen-input" style="flex:1" readonly placeholder="项目音频（可在「配音」页生成 / 选择）"/>
        <button class="hf-btn" id="tw-pick" disabled>选择音频</button>
      </div>

      <div class="panel-title-sm">② 识别模型</div>
      <div class="hgen-row">
        <span class="sel-label">当前识别模型</span>
        <span class="tw-model" id="tw-model">—</span>
        <a class="tw-link" id="tw-manage">管理模型</a>
      </div>
      <div class="whisper-tip" id="tw-model-hint"></div>
      <div class="hgen-row" style="margin-top:var(--space-3)">
        <label class="sel-label">识别语言</label>
        <select id="tw-lang" class="hgen-select" style="flex:1">
          <option value="auto">自动检测</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      <div class="whisper-bar-wrap" id="tw-bar-wrap" style="display:none">
        <div class="whisper-bar" id="tw-bar"><div class="whisper-bar-fill" id="tw-fill"></div></div>
        <div class="whisper-bar-text" id="tw-bar-text"></div>
      </div>
      <div class="hf-status" id="tw-status" style="margin-top:var(--space-3)"></div>
    </div>
    <div class="hf-modal-foot" id="tw-foot-start">
      <button class="hf-btn" id="tw-cancel">取消</button>
      <button class="hf-btn hf-btn-primary" id="tw-start">开始转录</button>
    </div>
    <div class="hf-modal-foot" id="tw-foot-apply" style="display:none">
      <button class="hf-btn" id="tw-replace">替换现有</button>
      <button class="hf-btn hf-btn-primary" id="tw-append">追加到末尾</button>
    </div>
  </div>
</div>`,
    init: function () {
      renderStepBar('subtitle');
      dom = {
        list: document.getElementById('sub-list'),
        count: document.getElementById('sub-count'),
        add: document.getElementById('sub-add'),
        title: document.getElementById('sub-title'),
        save: document.getElementById('sub-save'),
        status: document.getElementById('sub-status'),
        openTw: document.getElementById('sub-open-tw'),
        fromContent: document.getElementById('sub-from-content'),
        twMask: document.getElementById('tw-mask'),
        twClose: document.getElementById('tw-close'),
        twCancel: document.getElementById('tw-cancel'),
        twSrcProject: document.getElementById('tw-src-project'),
        twSrcFile: document.getElementById('tw-src-file'),
        twAudioInput: document.getElementById('tw-audio'),
        twPick: document.getElementById('tw-pick'),
        twModel: document.getElementById('tw-model'),
        twModelHint: document.getElementById('tw-model-hint'),
        twManage: document.getElementById('tw-manage'),
        langSel: document.getElementById('tw-lang'),
        twBarWrap: document.getElementById('tw-bar-wrap'),
        twBar: document.getElementById('tw-bar'),
        twFill: document.getElementById('tw-fill'),
        twBarText: document.getElementById('tw-bar-text'),
        twStatus: document.getElementById('tw-status'),
        twFootStart: document.getElementById('tw-foot-start'),
        twFootApply: document.getElementById('tw-foot-apply'),
        twStart: document.getElementById('tw-start'),
        twReplace: document.getElementById('tw-replace'),
        twAppend: document.getElementById('tw-append')
      };
      if (!dom.list) return;

      // 初始化：清空状态文案，载入项目字幕条目（避免旧状态残留误显）
      const proj = AppState.project || {};
      setStatus('', '');
      dom.title.value = (proj.title && proj.title !== '字幕动画') ? proj.title : '';
      items = parseSubtitleText(proj.subtitle || '');
      renderList();
      if (AppState.isBuiltin) toast('当前是内置示例项目（只读），请切换到自己的项目来编辑字幕');

      // —— 条目列表交互（事件委托，避免重建丢焦点） ——
      dom.list.addEventListener('input', (e) => {
        const row = e.target.closest('.sub-row');
        if (!row) return;
        const i = Number(row.dataset.i);
        if (!items[i]) return;
        if (e.target.dataset.f === 'text') {
          items[i].text = e.target.value;
          // 末条结束时间随文本估时长更新
          if (i === items.length - 1 && (!isFinite(Number(items[i].end)) || Number(items[i].end) <= Number(items[i].start))) {
            items[i].end = Number(items[i].start) + estDur(items[i].text);
          }
          updateCount();
        }
      });
      // 时间编辑：change（失焦/回车）时解析并规范化显示；解析失败回填原值
      dom.list.addEventListener('change', (e) => {
        const row = e.target.closest('.sub-row');
        if (!row || !e.target.classList.contains('sub-time')) return;
        const i = Number(row.dataset.i);
        const it = items[i];
        if (!it) return;
        const f = e.target.dataset.f;
        const v = parseTime(e.target.value);
        if (v === null) {
          e.target.value = (it[f] === null || it[f] === undefined || !isFinite(Number(it[f]))) ? '' : fmtTime(it[f]);
          setStatus('时间格式无法识别（请用 分:秒，如 00:12），已保留原值', 'var(--color-warning)');
          return;
        }
        setStatus('', '');
        it[f] = v;
        if (f === 'start' && !(Number(it.end) > v)) it.end = v + estDur(it.text);
        e.target.value = fmtTime(v);
        updateCount();
      });
      dom.list.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act="del"]');
        if (!btn) return;
        const row = btn.closest('.sub-row');
        const i = Number(row && row.dataset.i);
        if (!items[i]) return;
        items.splice(i, 1);
        fillEnds(items);
        renderList();
        toast('已删除第 ' + (i + 1) + ' 条（点「保存到项目」生效）');
      });

      dom.add.addEventListener('click', () => {
        const last = items[items.length - 1];
        const start = itemStartAfter(last);
        items.push({ start, end: start + 2.4, text: '' });
        renderList();
        const rows = dom.list.querySelectorAll('.sub-row .sub-text');
        const el = rows[rows.length - 1];
        if (el) el.focus();
      });

      function itemStartAfter(last) {
        if (!last) return 0;
        const end = Number(last.end);
        if (isFinite(end) && end > Number(last.start)) return end;
        return (Number(last.start) || 0) + estDur(last.text);
      }

      dom.save.addEventListener('click', () => { saveToProject({}); });

      dom.fromContent.addEventListener('click', fromContent);

      // —— 转录弹窗 ——
      dom.openTw.addEventListener('click', openTw);
      dom.twClose.addEventListener('click', closeTw);
      dom.twCancel.addEventListener('click', closeTw);
      dom.twMask.addEventListener('click', (e) => { if (e.target === dom.twMask) closeTw(); });
      // ESC 关闭弹窗：记录并解绑上一次的监听，避免页面多次进入后监听叠加
      if (escHandler) document.removeEventListener('keydown', escHandler);
      escHandler = (e) => {
        if (e.key === 'Escape' && dom.twMask && dom.twMask.style.display !== 'none') closeTw();
      };
      document.addEventListener('keydown', escHandler);

      dom.twSrcProject.addEventListener('change', async () => {
        if (!dom.twSrcProject.checked) return;
        dom.twPick.disabled = true;
        hideTwBar();
        const a = await loadProjectAudio();
        if (a.ok) setTwStatus('已载入项目音频：' + a.path, '');
        else setTwStatus(a.message + '（可切换为「浏览本地文件」）', 'hf-error');
        syncTwStart();
      });
      dom.twSrcFile.addEventListener('change', async () => {
        if (!dom.twSrcFile.checked) return;
        dom.twPick.disabled = false;
        hideTwBar();
        setTwStatus('请选择要转录的本地音频文件', '');
        dom.twAudioInput.value = '';
        syncTwStart();
      });
      dom.twPick.addEventListener('click', async () => {
        const p = await window.whisperTools.pickAudio().catch(() => null);
        if (!p) return;
        dom.twAudioInput.value = p;
        dom.twAudioInput.title = p;
        setTwStatus('已选择音频：' + p, '');
        syncTwStart();
      });
      dom.twStart.addEventListener('click', doTranscribe);
      dom.twReplace.addEventListener('click', () => applyTranscript('replace'));
      dom.twAppend.addEventListener('click', () => applyTranscript('append'));
      dom.twManage.addEventListener('click', () => {
        closeTw();
        goPage('settings');
      });

      // 转录进度（preload 为单订阅，重复注册仅替换回调；切页后本页回调不再触发）
      window.whisperTools.onProgress((payload) => {
        if (!payload || !dom.twMask || dom.twMask.style.display === 'none') return;
        if (payload.stage === 'starting' || payload.stage === 'transcribing') {
          showTwBar({ text: payload.message || '转录中…' }, true);
          setTwStatus(payload.message || '转录中…', '');
        }
      });

      syncTwStart();
    }
  };
})();
