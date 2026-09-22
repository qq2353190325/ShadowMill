// renderer/pages/subtitle/transcribe.js —— 字幕页转录弹窗（从音频生成字幕）：模型加载 / 音频选择 / 转录进度 / 回填条目
// 由 index.js 传入 ctx（dom / 条目读写 / 渲染 / 保存等共享函数），本模块不直接持有页面状态
(function () {
  'use strict';

  window.__sub = window.__sub || {};

  let escHandler = null;  // 弹窗 ESC 关闭监听（每次进入页面先解绑上一次，避免叠加）

  window.__sub.initTranscribe = function (ctx) {
    const { dom, getItems, setItems, renderList, isTextMode, fillTextArea, saveToProject, estDur, toast, AppState, escTxt, goPage } = ctx;

    let transcribing = false;
    let pendingResult = null; // 转录结果 { segments }
    let twModel = { id: '', label: '', downloaded: false };

    function setTwStatus(msg, kind) {
      if (!dom.twStatus) return;
      dom.twStatus.textContent = msg || '';
      dom.twStatus.classList.remove('hf-error', 'hf-ok');
      if (kind) dom.twStatus.classList.add(kind);
    }
    // percent：null/省略为不确定态；done/error 固定填满
    function showTwBar(msg, indeterminate, percent) {
      if (!dom.twBarWrap) return;
      const info = msg || {};
      dom.twBarWrap.style.display = '';
      dom.twBar.className = 'whisper-bar' + (indeterminate ? ' indeterminate' : '');
      dom.twFill.className = 'whisper-bar-fill' + (info.kind === 'done' ? ' done' : info.kind === 'error' ? ' error' : '');
      const p = (typeof percent === 'number' && percent >= 0) ? percent : (info.kind === 'done' || info.kind === 'error' ? 100 : 0);
      dom.twFill.style.width = p + '%';
      dom.twBarText.textContent = info.text || '';
    }
    function hideTwBar() {
      if (dom.twBarWrap) dom.twBarWrap.style.display = 'none';
      if (dom.twBarText) dom.twBarText.textContent = '';
    }
    function twModelReady() {
      return !!(twModel.id && twModel.downloaded);
    }
    function syncTwStart() {
      if (!dom.twStart) return;
      dom.twStart.disabled = transcribing || !dom.twAudioInput.value || !twModelReady();
      dom.twStart.textContent = transcribing ? '转录中…' : '开始转录';
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
        updateTwAudioHint();
        return { ok: true, path: res.path };
      }
      dom.twAudioInput.value = '';
      updateTwAudioHint();
      return { ok: false, message: (res && res.message) || '读取项目音频失败' };
    }

    // 音频格式提示：whisper-cli 自带解码器仅支持 wav/mp3/flac/ogg，
    // 其余格式（mp4/m4a/aac 等）主进程会在转录前用内置 ffmpeg 自动转换，这里提前告知用户
    const TW_DIRECT_EXTS = ['wav', 'mp3', 'flac', 'ogg'];
    function updateTwAudioHint() {
      if (!dom.twAudioHint) return;
      const p = (dom.twAudioInput && dom.twAudioInput.value) || '';
      const ext = p.lastIndexOf('.') >= 0 ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '';
      if (!ext || TW_DIRECT_EXTS.indexOf(ext) >= 0) {
        dom.twAudioHint.style.display = 'none';
        dom.twAudioHint.textContent = '';
        return;
      }
      dom.twAudioHint.textContent = '「' + ext.toUpperCase() + '」格式不支持直接转录，开始后会先自动提取音频并转为 16kHz WAV 再识别（多花几秒，原文件不受影响）。';
      dom.twAudioHint.style.display = '';
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
      updateTwAudioHint();
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
      setTwStatus('正在加载模型（' + twModel.label + '）…', '');
      showTwBar({ text: '正在加载模型（' + twModel.label + '）…' }, true);
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
      let next;
      if (mode === 'replace') {
        next = segs;
      } else {
        const items = getItems();
        let base = 0;
        if (items.length) {
          const last = items[items.length - 1];
          base = (last.end === null || last.end === undefined || !isFinite(Number(last.end)) || Number(last.end) <= Number(last.start))
            ? (Number(last.start) || 0) + estDur(last.text)
            : Number(last.end);
        }
        next = items.concat(segs.map((s) => ({ start: s.start + base, end: s.end + base, text: s.text })));
      }
      next.forEach((it) => {
        it.start = Math.max(0, Number(it.start) || 0);
        it.end = Math.max(it.start, Number(it.end) || 0) || it.start + estDur(it.text);
      });
      setItems(next);
      renderList();
      if (isTextMode()) fillTextArea();
      closeTw();
      toast(mode === 'replace' ? '已用转录结果替换字幕：共 ' + segs.length + ' 条' : '已在字幕末尾追加 ' + segs.length + ' 条');
      // 回填即落盘，避免用户忘记保存（保存失败时给出提示，条目仍保留在编辑器中）
      saveToProject({ silent: true }).then((ok) => {
        if (!ok) setTwStatus('转录结果已回填，但自动保存失败，请点「保存到项目」重试', 'hf-error');
        else setTwStatus('转录结果已回填并保存到项目「' + AppState.currentName + '」', 'hf-ok');
      });
    }

    // —— 事件绑定 ——
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
      updateTwAudioHint();
      syncTwStart();
    });
    dom.twPick.addEventListener('click', async () => {
      const p = await window.whisperTools.pickAudio().catch(() => null);
      if (!p) return;
      dom.twAudioInput.value = p;
      dom.twAudioInput.title = p;
      updateTwAudioHint();
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
      if (payload.stage === 'loading') {
        // 模型加载阶段：不确定态进度条
        showTwBar({ text: payload.message || '正在加载模型…' }, true);
        setTwStatus(payload.message || '正在加载模型…', '');
      } else if (payload.stage === 'transcribing') {
        // 转录阶段：按 whisper-cli 回推的百分比填充进度条
        const pct = (typeof payload.percent === 'number' && payload.percent >= 0) ? payload.percent : null;
        showTwBar({ text: payload.message || '转录中…' }, pct === null, pct === null ? 0 : pct);
        setTwStatus(payload.message || '转录中…', '');
      }
    });

    syncTwStart();
  };
})();
