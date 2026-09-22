// renderer/pages/subtitle/index.js —— 字幕页：条目编辑器（增删改 / 写入方式 / 保存 / 由脚本旁白生成）
// 转录弹窗（从音频生成字幕）逻辑见 transcribe.js（通过 ctx 共享条目与渲染函数）
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
    if (m) return (+m[1]) * 60 + (+m[2]) + (m[3] !== undefined ? (+m[3]) / Math.pow(10, m[3].length) : 0);
    m = t.match(/^(\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]);
    return null;
  }

  // 秒 → [分:秒]（整秒显示）；[分:秒.毫秒] 输入显示用（去尾零，如 00:17.9）
  function fmtTimeTrim(sec) {
    const t = Math.max(0, Number(sec) || 0);
    const s = Math.floor(t);
    let ms = Math.round((t - s) * 1000);
    if (ms >= 1000) { ms = 0; return fmtTime(s + 1); }
    const base = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    return base + (ms ? '.' + String(ms).replace(/0+$/, '') : '');
  }

  // 秒 → [分:秒.毫秒]（3 位毫秒，落盘格式；与主进程 fmtTsMs 一致）
  function fmtTimeMs(sec) {
    const t = Math.max(0, Number(sec) || 0);
    const s = Math.floor(t);
    let ms = Math.round((t - s) * 1000);
    if (ms >= 1000) { ms = 0; return fmtTimeMs(s + 1); }
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }
  // 无时间戳行的估时规则（与主进程 parseSubtitle 保持一致：max(2.4, 1.6 + 字数 * 0.15)）
  function estDur(text) {
    const t = String(text || '');
    return Math.max(2.4, 1.6 + t.length * 0.15);
  }

  // ===== 字幕条目状态 =====
  let items = [];        // [{ start:秒, end:秒, text }]
  let dom = {};
  let textMode = false;  // 写入方式：逐条编辑 / SRT

  const getItems = () => items;
  const setItems = (v) => { items = v; };

  // 缺失的结束时间由下一行起始时间推导；末条按时长估算（已有真实结束时间的行不覆盖）
  function fillEnds(list) {
    list.forEach((it, i) => {
      const start = Number(it.start) || 0;
      if (isFinite(Number(it.end)) && Number(it.end) > start) return;
      const next = list[i + 1];
      const end = next ? Number(next.start) || 0 : start + estDur(it.text);
      it.end = end > start ? end : start + estDur(it.text);
    });
    return list;
  }

  // 解析项目字幕文本 → 条目数组（支持 [分:秒] / [分:秒-分:秒]（秒可带小数=毫秒精度）与纯文本行）
  function parseSubtitleText(text) {
    // 小数部分按位数解释：.9 = 0.9s、.900 = 0.9s（3 位=毫秒），与落盘 fmtTimeMs 对齐
    const frac = (digits) => (digits === undefined ? 0 : (+digits) / Math.pow(10, digits.length));
    const lines = String(text == null ? '' : text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const list = [];
    let autoT = 0.4;
    lines.forEach((line) => {
      const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?(?:\s*-\s*(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?)?\]\s*(.*)$/);
      let txt = line;
      let time = null;
      let end = null;
      if (m) {
        txt = m[7].trim();
        time = (+m[1]) * 60 + (+m[2]) + frac(m[3]);
        if (m[4] !== undefined) {
          const e = (+m[4]) * 60 + (+m[5]) + frac(m[6]);
          if (e > time) end = e;
        }
      }
      if (!txt) return;
      if (time === null) {
        time = autoT;
        autoT += estDur(txt);
      }
      list.push({ start: time, end, text: txt });
    });
    return fillEnds(list);
  }

  // 条目数组 → 项目字幕文本（[开始-结束] 毫秒精度；结束时间按真实值写入，供 HTML 生成严格按窗口显示）
  function serializeItems(list) {
    return list
      .filter((it) => String(it.text || '').trim())
      .map((it) => {
        const txt = String(it.text).replace(/\s+/g, ' ').trim();
        if (it.start === null || it.start === undefined || !isFinite(Number(it.start))) return txt;
        const s = Number(it.start);
        const e = Number(it.end);
        return '[' + fmtTimeMs(s) + (isFinite(e) && e > s ? '-' + fmtTimeMs(e) : '') + '] ' + txt;
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
      const startV = (it.start === null || it.start === undefined || !isFinite(Number(it.start))) ? '' : fmtTimeTrim(it.start);
      const endV = (it.end === null || it.end === undefined || !isFinite(Number(it.end))) ? '' : fmtTimeTrim(it.end);
      return '<div class="sub-row" data-i="' + i + '">' +
        '<div class="sub-idx">' + (i + 1) + '</div>' +
        '<input class="sub-time" data-f="start" value="' + escTxt(startV) + '" title="起始时间（分:秒，可带小数=毫秒），字幕时间轴以此为准"/>' +
        '<span class="sub-arrow">→</span>' +
        '<input class="sub-time" data-f="end" value="' + escTxt(endV) + '" title="结束时间（分:秒，可带小数=毫秒），编辑参考用"/>' +
        '<textarea class="sub-text" data-f="text" spellcheck="false" placeholder="该条字幕文本">' + escTxt(it.text) + '</textarea>' +
        '<button class="sub-del" data-act="del" title="删除该条">删除</button>' +
      '</div>';
    }).join('');
    updateCount();
  }

  // 条目 → 纯文本（每行一条，无时间线，供「复制字幕」使用）
  function plainText() {
    return items
      .filter((it) => String(it.text || '').trim())
      .map((it) => String(it.text).replace(/\s+/g, ' ').trim())
      .join('\n');
  }

  // 秒 → SRT 时间戳（时:分:秒,毫秒）
  function fmtSrt(sec) {
    const t = Math.max(0, Number(sec) || 0);
    const h = Math.floor(t / 3600);
    const m = Math.floor(t / 60) % 60;
    const s = Math.floor(t) % 60;
    const ms = Math.round((t - Math.floor(t)) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
  }

  // 条目 → SRT 文本（序号 / 时间轴 / 文本，块间空行）
  function itemsToSrt(list) {
    return list
      .filter((it) => String(it.text || '').trim())
      .map((it, i) => {
        const start = Number(it.start) || 0;
        let end = Number(it.end);
        if (!isFinite(end) || end <= start) end = start + estDur(String(it.text || ''));
        return (i + 1) + '\n' + fmtSrt(start) + ' --> ' + fmtSrt(end) + '\n' + String(it.text).replace(/\s+/g, ' ').trim();
      })
      .join('\n\n');
  }

  // 条目 → 文本域（SRT 格式）
  function fillTextArea() {
    if (dom.textArea) dom.textArea.value = itemsToSrt(items);
  }

  // SRT 文本 → 条目：按空行分块解析 序号/时间轴/文本；
  // 块内带时间轴 → 其后各行合并为该条文本；块内无时间轴 → 纯文本兜底，每行一条自动估时
  function parseSrtText(text) {
    const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    const list = [];
    let autoT = 0.4;
    for (const b of blocks) {
      const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      let i = 0;
      if (/^\d+$/.test(lines[0])) i = 1; // 跳过序号行
      let start = null;
      let end = null;
      const tm = i < lines.length ? lines[i].match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/) : null;
      if (tm) {
        start = (+tm[1]) * 3600 + (+tm[2]) * 60 + (+tm[3]) + (+tm[4]) / 1000;
        end = (+tm[5]) * 3600 + (+tm[6]) * 60 + (+tm[7]) + (+tm[8]) / 1000;
        i += 1;
        const txt = lines.slice(i).join(' ').replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        if (!isFinite(end) || end <= start) end = start + estDur(txt);
        autoT = Math.max(autoT, end);
        list.push({ start, end, text: txt });
      } else {
        // 纯文本兜底：无时间轴的块，每行一条字幕，自动估时
        for (const ln of lines.slice(i)) {
          const txt = ln.replace(/\s+/g, ' ').trim();
          if (!txt) continue;
          const s = autoT;
          const e = s + estDur(txt);
          autoT = e;
          list.push({ start: s, end: e, text: txt });
        }
      }
    }
    // 注意：不经过 fillEnds——每条块的结束时间已显式给出或已估时，fillEnds 会按下一条起始覆盖显式结束时间
    return list;
  }

  // 文本域（SRT）→ 条目
  function applyTextMode() {
    items = parseSrtText(dom.textArea.value);
    renderList();
  }

  // 切换写入方式；离开 SRT 模式时先把文本域内容写回条目
  function setMode(tm) {
    if (tm === textMode || !dom.textArea) return;
    if (textMode) applyTextMode();
    textMode = tm;
    dom.list.style.display = tm ? 'none' : '';
    dom.textArea.style.display = tm ? '' : 'none';
    dom.add.style.display = tm ? 'none' : '';
    dom.count.style.display = tm ? 'none' : '';
    dom.top.style.display = tm ? 'none' : '';
    dom.bottom.style.display = tm ? 'none' : '';
    dom.modeRows.classList.toggle('active', !tm);
    dom.modeText.classList.toggle('active', tm);
    if (tm) fillTextArea();
    setStatus(tm ? 'SRT 模式：单文本域按 SRT 字幕格式编辑（序号 / 时间轴 / 文本），切回「逐条编辑」或保存时解析回条目；「复制字幕」仍复制不含时间线的纯文本' : '', '');
  }

  // 复制字幕文本（不含时间线）
  async function copySubtitles() {
    if (textMode) applyTextMode();
    const txt = plainText();
    if (!txt) { toast('字幕内容为空，没有可复制的文本'); return; }
    let ok = false;
    try {
      ok = !!(window.appTools && window.appTools.copyText && (await window.appTools.copyText(txt)));
    } catch (e) { ok = false; }
    if (ok) toast('已复制 ' + items.length + ' 条字幕文本（不含时间线）');
    else setStatus('复制失败，请重试', 'var(--color-danger)');
  }

  // 导出 SRT：把当前条目导出为 .srt 字幕文件（含时间轴）
  async function exportSrtFile() {
    if (textMode) applyTextMode();
    const srt = itemsToSrt(items);
    if (!srt) { toast('字幕内容为空，没有可导出的内容'); return; }
    const res = await window.projectTools.exportSrt(AppState.currentName, srt).catch(() => null);
    if (!res) return;
    if (res.ok) toast('已导出：' + res.savedPath);
    else if (!res.canceled) toast(res.message || '导出失败');
  }

  // ===== 保存到项目 =====
  async function saveToProject(options) {
    const silent = !!(options && options.silent);
    if (AppState.isBuiltin) {
      if (!silent) toast('内置示例项目只读，请先切换到自己的项目');
      return false;
    }
    if (textMode) applyTextMode(); // SRT 模式：先把文本域写回条目再保存
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
    if (textMode) fillTextArea();
    toast('已由脚本旁白生成 ' + list.length + ' 条字幕，可保存到项目'
      + (usedDur ? '（' + usedDur + ' 条按时长提示累计）' : '')
      + (estimated ? '（' + estimated + ' 条按估时）' : ''));
  }

  App.pages.subtitle = {
    html: App.templates['subtitle'],
    init: function () {
      renderStepBar('subtitle');
      dom = {
        list: document.getElementById('sub-list'),
        count: document.getElementById('sub-count'),
        add: document.getElementById('sub-add'),
        top: document.getElementById('sub-top'),
        bottom: document.getElementById('sub-bottom'),
        title: document.getElementById('sub-title'),
        save: document.getElementById('sub-save'),
        status: document.getElementById('sub-status'),
        modeRows: document.getElementById('sub-mode-rows'),
        modeText: document.getElementById('sub-mode-text'),
        textArea: document.getElementById('sub-textarea'),
        copy: document.getElementById('sub-copy'),
        exportSrt: document.getElementById('sub-export-srt'),
        openTw: document.getElementById('sub-open-tw'),
        fromContent: document.getElementById('sub-from-content'),
        twMask: document.getElementById('tw-mask'),
        twClose: document.getElementById('tw-close'),
        twCancel: document.getElementById('tw-cancel'),
        twSrcProject: document.getElementById('tw-src-project'),
        twSrcFile: document.getElementById('tw-src-file'),
        twAudioInput: document.getElementById('tw-audio'),
        twAudioHint: document.getElementById('tw-audio-hint'),
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
      textMode = false; // 页面重建后回到「逐条编辑」默认模式
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
          e.target.value = (it[f] === null || it[f] === undefined || !isFinite(Number(it[f]))) ? '' : fmtTimeTrim(it[f]);
          setStatus('时间格式无法识别（请用 分:秒，如 00:12 或 00:12.5），已保留原值', 'var(--color-warning)');
          return;
        }
        setStatus('', '');
        it[f] = v;
        if (f === 'start' && !(Number(it.end) > v)) it.end = v + estDur(it.text);
        e.target.value = fmtTimeTrim(v);
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

      // —— 条目区域滚动跳转（列表限定高度后内部滚动） ——
      dom.top.addEventListener('click', () => { dom.list.scrollTop = 0; });
      dom.bottom.addEventListener('click', () => { dom.list.scrollTop = dom.list.scrollHeight; });

      function itemStartAfter(last) {
        if (!last) return 0;
        const end = Number(last.end);
        if (isFinite(end) && end > Number(last.start)) return end;
        return (Number(last.start) || 0) + estDur(last.text);
      }

      dom.save.addEventListener('click', () => { saveToProject({}); });

      dom.fromContent.addEventListener('click', fromContent);

      // —— 写入方式切换与复制字幕 ——
      dom.modeRows.addEventListener('click', () => setMode(false));
      dom.modeText.addEventListener('click', () => setMode(true));
      dom.copy.addEventListener('click', copySubtitles);
      dom.exportSrt.addEventListener('click', exportSrtFile);

      // —— 转录弹窗（transcribe.js）：通过 ctx 共享条目与渲染函数 ——
      const ctx = {
        dom,
        getItems, setItems,
        renderList,
        isTextMode: () => textMode,
        fillTextArea,
        saveToProject,
        estDur,
        toast,
        AppState,
        escTxt,
        goPage
      };
      if (window.__sub && window.__sub.initTranscribe) window.__sub.initTranscribe(ctx);
    }
  };
})();
