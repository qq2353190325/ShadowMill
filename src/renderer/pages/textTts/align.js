// renderer/pages/textTts/align.js —— 字幕配音（逐句对齐）卡：逐句合成 + 对齐 + 写入当前项目
// 公共工具（setStatus / requireCfg / fillVoiceSelect 等）由 index.js 挂载到 window.__tts
(function () {
  'use strict';

  const { AppState, escTxt, toast, refreshProject } = window.App;

  window.__tts.initAlign = function () {
    const C = window.__tts;
    const setStatus = C.setStatus;

    // —— 字幕配音（逐句对齐）卡片 ——
    const alignSubSrc = document.getElementById('align-sub-src');
    const alignSubCount = document.getElementById('align-sub-count');
    const alignVoice = document.getElementById('align-voice');
    const alignGap = document.getElementById('align-gap');
    const alignGapRow = document.getElementById('align-gap-row');
    const alignStart = document.getElementById('align-start');
    const alignCancel = document.getElementById('align-cancel');
    const alignRetry = document.getElementById('align-retry');
    const alignBarWrap = document.getElementById('align-bar-wrap');
    const alignBar = document.getElementById('align-bar');
    const alignFill = document.getElementById('align-fill');
    const alignBarText = document.getElementById('align-bar-text');
    const alignStatus = document.getElementById('align-status');
    const alignResult = document.getElementById('align-result');
    const alignAudio = document.getElementById('align-audio');
    const alignSummary = document.getElementById('align-summary');
    const alignList = document.getElementById('align-list');
    const alignSegAudio = document.getElementById('align-seg-audio');
    let alignBusy = false;
    let lastAlignResult = null; // { audioPath, subtitleText, details, totalDur, mode }

    const setAlignStatus = (text, kind) => setStatus(alignStatus, text, kind);
    // 进度条：percent 数字为确定态，null/省略为不确定态；done/error 固定填满（同字幕页 showTwBar 语义）
    const showAlignBar = (info, indeterminate, percent) => {
      if (!alignBarWrap) return;
      alignBarWrap.style.display = '';
      alignBar.className = 'whisper-bar' + (indeterminate ? ' indeterminate' : '');
      alignFill.className = 'whisper-bar-fill' + (info.kind === 'done' ? ' done' : info.kind === 'error' ? ' error' : '');
      const p = (typeof percent === 'number' && percent >= 0) ? percent : (info.kind === 'done' || info.kind === 'error' ? 100 : 0);
      alignFill.style.width = p + '%';
      alignBarText.textContent = info.text || '';
    };
    const hideAlignBar = () => {
      if (alignBarWrap) alignBarWrap.style.display = 'none';
      if (alignBarText) alignBarText.textContent = '';
    };
    // 对齐时间显示：[分:秒]（与字幕页 fmtTime 一致：四舍五入到秒）
    const alignFmt = (sec) => {
      const s = Math.max(0, Math.round(Number(sec) || 0));
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };
    // 写回字幕用：[分:秒.毫秒]（3 位毫秒，与字幕页 fmtTimeMs 一致）
    const alignFmtMs = (sec) => {
      const t = Math.max(0, Number(sec) || 0);
      const s = Math.floor(t);
      let ms = Math.round((t - s) * 1000);
      if (ms >= 1000) { ms = 0; return alignFmtMs(s + 1); }
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
    };

    // 字幕来源：当前项目（置顶）+ 其他带字幕项目
    const fillAlignSubSrc = () => {
      alignSubSrc.innerHTML = '';
      const addOpt = (value, text) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        alignSubSrc.appendChild(o);
      };
      addOpt('__current__', '当前项目字幕（' + ((AppState.project && AppState.project.subtitleCount) || 0) + ' 条）');
      (AppState.myProjects || []).forEach((mp) => {
        if (mp && mp.name !== AppState.currentName && mp.hasSubtitle) {
          addOpt(String(mp.name), '项目「' + (mp.title || mp.name) + '」字幕（' + (mp.subtitleCount || 0) + ' 条）');
        }
      });
      syncAlignSubCount();
    };
    const countSubtitleLines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;
    const syncAlignSubCount = () => {
      if (!alignSubCount) return;
      if (alignSubSrc.value === '__current__') {
        alignSubCount.textContent = '共 ' + countSubtitleLines(AppState.project && AppState.project.subtitle) + ' 行';
      } else {
        alignSubCount.textContent = '';
      }
    };
    const getAlignSubtitleText = async () => {
      const v = alignSubSrc.value;
      if (!v) return { ok: false, message: '请选择字幕来源' };
      if (v === '__current__') {
        const t = (AppState.project && AppState.project.subtitle) || '';
        return t.trim() ? { ok: true, text: t } : { ok: false, message: '当前项目没有字幕，请先到「字幕生成」页生成或填写' };
      }
      const res = await window.projectTools.load(v).catch(() => null);
      const t = (res && res.subtitle) || '';
      return t.trim() ? { ok: true, text: t } : { ok: false, message: '项目「' + v + '」没有字幕' };
    };

    // 进度推送（preload 单订阅；切页后本页回调不再触发）
    window.voiceTools.onAlignProgress((p) => {
      if (!p) return;
      if (p.stage === 'synth' || p.stage === 'measure') {
        showAlignBar({ text: p.message || '合成中…' }, false, p.percent);
        setAlignStatus(p.message || '合成中…', '');
      } else if (p.stage === 'assemble') {
        showAlignBar({ text: p.message || '装配中…' }, true);
        setAlignStatus(p.message || '装配中…', '');
      } else if (p.stage === 'done') {
        showAlignBar({ text: p.message || '完成', kind: 'done' }, false);
        setAlignStatus(p.message || '完成', 'hf-ok');
      } else if (p.stage === 'error') {
        showAlignBar({ text: p.message || '失败', kind: 'error' }, false);
        setAlignStatus(p.message || '失败', 'hf-error');
      }
    });

    const resetAlignUi = () => {
      alignResult.style.display = 'none';
      if (alignAudio) alignAudio.removeAttribute('src');
      alignSummary.textContent = '';
      alignList.innerHTML = '';
      lastAlignResult = null;
    };

    const startAlign = async () => {
      if (alignBusy) { toast('对齐合成进行中，请稍候'); return; }
      if (AppState.isBuiltin) { toast('内置示例项目只读，请先切换到自己的项目'); return; }
      if (!(await C.requireCfg())) return;
      const sub = await getAlignSubtitleText();
      if (!sub.ok) { setAlignStatus(sub.message, 'hf-error'); return; }
      const voiceId = alignVoice.value;
      if (!voiceId) { setAlignStatus('请先选择（或创建）音色', 'hf-error'); return; }
      const checked = document.querySelector('input[name="align-mode"]:checked');
      const mode = (checked && checked.value) || 'audio-driven';
      const gapSec = Number(alignGap.value);
      const opt = alignVoice.options[alignVoice.selectedIndex];
      const voiceModel = opt && opt.dataset ? (opt.dataset.model || '') : '';
      alignBusy = true;
      resetAlignUi();
      alignStart.disabled = true;
      alignCancel.style.display = '';
      alignRetry.style.display = 'none';
      hideAlignBar();
      setAlignStatus('正在提交逐句合成任务…', '');
      try {
        const res = await window.voiceTools.synthAligned({
          projectName: AppState.currentName,
          subtitleText: sub.text,
          voice: voiceId,
          voiceModel,
          mode,
          gapSec
        });
        if (res && res.ok) {
          lastAlignResult = res;
          renderAlignResult(res);
          showAlignBar({ text: '对齐完成：' + (res.details || []).length + ' 句', kind: 'done' }, false);
          setAlignStatus(res.message || '对齐完成', 'hf-ok');
        } else if (res && res.canceled) {
          hideAlignBar();
          setAlignStatus((res.message) || '已取消', '');
          toast((res.message) || '已取消');
        } else {
          const msg = (res && res.message) || '对齐合成失败';
          showAlignBar({ text: msg, kind: 'error' }, false);
          setAlignStatus(msg, 'hf-error');
          toast(msg);
        }
      } catch (e) {
        const msg = String((e && e.message) || e);
        showAlignBar({ text: msg, kind: 'error' }, false);
        setAlignStatus(msg, 'hf-error');
      } finally {
        alignBusy = false;
        alignStart.disabled = false;
        alignCancel.style.display = 'none';
        alignRetry.style.display = lastAlignResult ? 'none' : '';
      }
    };

    // 结果明细：汇总行 + 逐句行（序号 / 文本 / 字幕时间 / 音频起点 / 时长 / 状态徽标 / 试听）
    const renderAlignResult = (res) => {
      alignResult.style.display = '';
      if (alignAudio && res.audioPath) {
        alignAudio.src = 'file:///' + encodeURI(String(res.audioPath).replace(/\\/g, '/'));
        alignAudio.load();
      }
      const details = res.details || [];
      const accN = details.filter((d) => d.status === 'accelerated').length;
      const pushN = details.filter((d) => d.status === 'pushed').length;
      alignSummary.textContent = '共 ' + details.length + ' 句 · 总时长 ' + alignFmt(res.totalDur) +
        (accN ? ' · 加速 ' + accN + ' 句' : '') + (pushN ? ' · 顺延 ' + pushN + ' 句' : '') +
        (res.mode === 'audio-driven' ? ' · 字幕时间已按配音重排' : ' · 音频已按字幕时间摆放');
      alignList.innerHTML = '';
      details.forEach((d) => {
        const row = document.createElement('div');
        row.className = 'align-row';
        const badge = d.status === 'accelerated'
          ? '<span class="align-badge warn">加速 x' + Number(d.rate).toFixed(2) + '</span>'
          : d.status === 'pushed'
            ? '<span class="align-badge warn">顺延 +' + Number(d.delta).toFixed(1) + 's</span>'
            : '<span class="align-badge ok">正常</span>';
        const play = d.segPath
          ? '<button type="button" class="hf-btn align-play" data-path="' + escTxt(d.segPath) + '" style="padding:2px 10px;font-size:12px">试听</button>'
          : '';
        row.innerHTML = '<span class="align-idx">' + (d.index + 1) + '</span>' +
          '<span class="align-txt" title="' + escTxt(d.text) + '">' + escTxt(d.text) + '</span>' +
          '<span class="align-time">' + alignFmt(d.subtitleStart) + '</span>' +
          '<span class="align-time">' + alignFmt(d.audioStart) + '</span>' +
          '<span class="align-dur">' + Number(d.audioDur).toFixed(1) + 's</span>' + badge + play;
        alignList.appendChild(row);
      });
    };
    // 逐句试听（事件委托）
    alignList.addEventListener('click', (e) => {
      const btn = e.target.closest('.align-play');
      if (!btn || !alignSegAudio) return;
      alignSegAudio.src = 'file:///' + encodeURI(String(btn.dataset.path || '').replace(/\\/g, '/'));
      alignSegAudio.play().catch(() => toast('该句试听文件已失效（临时目录被清理），可试听整轨'));
    });

    // 写入当前项目：覆盖字幕 + 音频设为背景音频（复用现有 save-subtitle / set-audio）
    const writeAlign = async () => {
      if (!lastAlignResult) { toast('暂无对齐结果'); return; }
      if (AppState.isBuiltin) { toast('内置示例项目只读，请先切换到自己的项目'); return; }
      // [开始-结束] 毫秒精度按实测音频起止写入：结束 = 该句音频起点 + 实测时长（与成片音轨严格一致）
      const details = lastAlignResult.details || [];
      const lines = details
        .map((d) => {
          const s = Math.max(0, Number(d.subtitleStart) || 0);
          const e = s + Math.max(0, Number(d.audioDur) || 0);
          const txt = String(d.text || '').trim();
          if (!txt) return '';
          return '[' + alignFmtMs(s) + (e > s ? '-' + alignFmtMs(e) : '') + '] ' + txt;
        })
        .filter(Boolean);
      if (!lines.length) { toast('对齐结果为空，无法写入'); return; }
      const r1 = await window.projectTools.saveSubtitle(AppState.currentName, lines.join('\n'), '');
      if (!r1 || !r1.ok) { toast((r1 && r1.message) || '字幕写回失败'); return; }
      const r2 = await window.projectTools.setAudio(AppState.currentName, lastAlignResult.audioPath);
      if (!r2 || !r2.ok) { toast((r2 && r2.message) || '音频写回失败'); return; }
      await refreshProject();
      toast('已写入：字幕 ' + (lastAlignResult.details || []).length + ' 条 + 对齐配音 ' + r2.audioFile);
    };

    document.getElementById('align-sub-refresh').addEventListener('click', () => { fillAlignSubSrc(); });
    alignSubSrc.addEventListener('change', syncAlignSubCount);
    // 对齐方式联动：「修正音频」自动按字幕时间间隔补静音，无需手写停顿 → 隐藏句间停顿行；说明文案按模式切换
    const syncGapRow = () => {
      const checked = document.querySelector('input[name="align-mode"]:checked');
      const mode = (checked && checked.value) || 'audio-driven';
      if (alignGapRow) alignGapRow.style.display = (mode === 'timeline-driven') ? 'none' : '';
      const tipA = document.getElementById('align-tip-audio');
      const tipT = document.getElementById('align-tip-timeline');
      if (tipA) tipA.style.display = (mode === 'audio-driven') ? '' : 'none';
      if (tipT) tipT.style.display = (mode === 'timeline-driven') ? '' : 'none';
    };
    document.querySelectorAll('input[name="align-mode"]').forEach((r) => r.addEventListener('change', syncGapRow));
    syncGapRow();
    document.getElementById('align-voice-refresh').addEventListener('click', async () => { if (await C.requireCfg()) C.fillVoiceSelect(alignVoice, alignStatus); });
    alignStart.addEventListener('click', startAlign);
    alignRetry.addEventListener('click', startAlign);
    alignCancel.addEventListener('click', () => {
      window.voiceTools.cancelAlign();
      setAlignStatus('正在取消（当前句完成后停止）…', '');
    });
    document.getElementById('align-open-dir').addEventListener('click', () => {
      if (lastAlignResult && lastAlignResult.audioPath) window.projectTools.openFolderOf(lastAlignResult.audioPath);
    });
    document.getElementById('align-write').addEventListener('click', writeAlign);

    fillAlignSubSrc();
    (async () => { if (await C.requireCfg()) C.fillVoiceSelect(alignVoice, alignStatus); })();
  };
})();
