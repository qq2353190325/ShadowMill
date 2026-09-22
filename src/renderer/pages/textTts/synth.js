// renderer/pages/textTts/synth.js —— 文字生音频（TTS 合成）卡：保存到 / 合成 / 已生成音频 / 合成结果 / 语速
// 公共工具（setStatus / requireCfg / fillVoiceSelect 等）由 index.js 挂载到 window.__tts
(function () {
  'use strict';

  const { AppState, toast, refreshProject, applyRate, stepRate, goPage } = window.App;

  window.__tts.initSynth = function () {
    const C = window.__tts;
    const status = C.status;
    const setStatus = C.setStatus;

    const voiceSel = document.getElementById('tts-voice');
    const openBtn = document.getElementById('tts-open-folder');
    // —— 保存到（合并原「保存到项目」「保存位置」：项目 audio/ · 自定义目录 · 音频输出目录 三选一） ——
    const saveToSel = document.getElementById('tts-save-to');
    const saveCustomRow = document.getElementById('tts-save-custom-row');
    const saveCustomEl = document.getElementById('tts-save-custom');
    const clearCustomBtn = document.getElementById('tts-clear-custom');
    let lastSaveTo = ''; // 选择自定义目录取消时回退
    // 解析当前选择：proj:<name> → 项目 audio/；custom → 自定义目录；out → 音频输出目录
    const parseSaveTo = () => {
      const v = saveToSel.value;
      if (v === 'custom') return { kind: 'custom', saveDir: C.getCfgSaveDir() };
      if (v === 'out') return { kind: 'output' };
      if (v && v.indexOf('proj:') === 0) return { kind: 'project', projectName: v.slice(5) };
      return { kind: 'none' };
    };
    const renderSaveTo = () => {
      saveCustomRow.style.display = parseSaveTo().kind === 'custom' ? '' : 'none';
      saveCustomEl.textContent = C.getCfgSaveDir() ? '自定义目录：' + C.getCfgSaveDir() : '（尚未选择自定义目录）';
    };
    const fillSaveTo = () => {
      const prev = lastSaveTo || saveToSel.value;
      saveToSel.innerHTML = '';
      AppState.myProjects.forEach((p) => {
        const o = document.createElement('option');
        o.value = 'proj:' + p.name;
        o.textContent = '项目「' + (p.title || p.name) + '」（audio/）';
        saveToSel.appendChild(o);
      });
      const customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = C.getCfgSaveDir() ? '自定义目录…（' + C.getCfgSaveDir() + '）' : '自定义目录…（未选择）';
      saveToSel.appendChild(customOpt);
      const outOpt = document.createElement('option');
      outOpt.value = 'out';
      outOpt.textContent = '音频输出目录（不写入项目）';
      saveToSel.appendChild(outOpt);
      const has = (v) => Array.prototype.some.call(saveToSel.options, (o) => o.value === v);
      let want = has(prev) ? prev : '';
      if (!want) {
        // 默认：已持久化自定义目录 → 自定义；否则当前项目（内置项目则最近项目）；无项目 → 音频输出目录
        want = C.getCfgSaveDir() ? 'custom' : (AppState.myProjects.length ? 'proj:' + ((AppState.currentName && !AppState.isBuiltin) ? AppState.currentName : AppState.myProjects[0].name) : 'out');
      }
      if (!has(want)) want = 'out';
      saveToSel.value = want;
      lastSaveTo = saveToSel.value;
      renderSaveTo();
    };
    // —— 已生成音频（复用为背景音频） ——
    const genSel = document.getElementById('tts-gen-list');
    const genInfo = document.getElementById('tts-gen-info');
    const genPlayBtn = document.getElementById('tts-gen-play');
    const genSetBtn = document.getElementById('tts-gen-setbg');
    const genOpenDirBtn = document.getElementById('tts-gen-open-dir');
    const genAudio = document.getElementById('tts-gen-audio');
    let genAudios = [];
    let lastSavePath = ''; // 最近一次合成保存的文件路径（供「合成结果」卡打开目录按钮使用）
    const updateGenSel = () => {
      const it = genAudios[Number(genSel.value)];
      if (!it) {
        genInfo.textContent = '';
        genSetBtn.disabled = true;
        if (genOpenDirBtn) genOpenDirBtn.disabled = true;
        return;
      }
      genInfo.textContent = it.path;
      genSetBtn.disabled = AppState.isBuiltin;
      if (genOpenDirBtn) genOpenDirBtn.disabled = AppState.isBuiltin;
      if (genAudio) {
        genAudio.dataset.path = it.path;
        genAudio.src = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
        genAudio.load();
      }
      const genPlayRow = document.getElementById('tts-gen-play-row');
      if (genPlayRow) genPlayRow.style.display = 'none';
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
      // 按来源分组展示（音频输出目录 / 自定义目录 / 项目 · X），避免文件来源混在一起
      const byGroup = new Map();
      genAudios.forEach((it, i) => {
        const g = it.group || '其他';
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push([it, i]);
      });
      byGroup.forEach((arr, g) => {
        const og = document.createElement('optgroup');
        og.label = g;
        arr.forEach((pair) => {
          const o = document.createElement('option');
          o.value = String(pair[1]);
          o.textContent = pair[0].name;
          og.appendChild(o);
        });
        genSel.appendChild(og);
      });
      updateGenSel();
    };

    document.getElementById('tts-refresh-voice').addEventListener('click', async () => { if (await C.requireCfg()) C.fillVoiceSelect(voiceSel, status); });
    // 载入脚本旁白：把当前项目内容脚本的场景旁白逐段填入 tts-text（每场景一段、空行分隔），可继续手动编辑；不改动合成/语速/保存逻辑
    document.getElementById('tts-load-narration').addEventListener('click', () => {
      const content = AppState.project && AppState.project.content;
      const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
      const narrs = scenes
        .map((s) => (s && typeof s.narration === 'string' ? s.narration.trim() : ''))
        .filter((t) => t.length > 0);
      if (!narrs.length) {
        setStatus(status, '当前项目无内容脚本（或场景无旁白），请先到「内容脚本」页编写', 'hf-error');
        return;
      }
      const ta = document.getElementById('tts-text');
      ta.value = narrs.join('\n\n');
      setStatus(status, '已载入 ' + narrs.length + ' 段旁白（每场景一段、空行分隔），可继续手动编辑', 'hf-ok');
    });
    document.getElementById('tts-synth').addEventListener('click', async () => {
      const c = await C.requireCfg(); if (!c) return;
      const text = document.getElementById('tts-text').value.trim();
      const voice = voiceSel.value;
      if (!text) { setStatus(status, '请输入合成文本', 'hf-error'); return; }
      if (!voice) { setStatus(status, '请先选择（或创建）音色', 'hf-error'); return; }
      const s = parseSaveTo();
      if (s.kind === 'none') { setStatus(status, '请选择保存位置', 'hf-error'); return; }
      // 使用当前音色绑定的模型合成（选中音色即对应其模型）；无绑定则回落全局默认
      const opt = voiceSel.options[voiceSel.selectedIndex];
      const voiceModel = opt ? (opt.dataset && opt.dataset.model) || '' : '';
      const btn = document.getElementById('tts-synth');
      btn.disabled = true;
      setStatus(status, '正在按所选音色（' + (voiceModel || '默认模型') + '）合成并下载语音…', '');
      try {
        const audioName = (document.getElementById('tts-audio-name').value || '').trim();
        const res = await window.voiceTools.synth(text, voice, s.kind === 'project' ? s.projectName : '', s.kind === 'custom' ? s.saveDir : '', voiceModel, audioName, s.kind === 'output');
        if (res && res.ok) {
          const where = res.savedTo === 'project'
            ? '已保存到项目「' + (res.projectName || '') + '」'
            : res.savedTo === 'output' ? '已保存到音频输出目录' : '已保存到自定义目录';
          setStatus(status, '合成完成，' + where, 'hf-ok');
          C.markResultShown();
          C.applyTab();
          const rp = document.getElementById('tts-result-path');
          if (rp) rp.textContent = '保存路径：' + (res.savePath || '');
          lastSavePath = res.savePath || '';
          const roBtn = document.getElementById('tts-result-open-dir');
          if (roBtn) roBtn.disabled = !lastSavePath;
          const au = document.getElementById('tts-audio');
          if (au && res.savePath) {
            au.src = 'file:///' + encodeURI(String(res.savePath).replace(/\\/g, '/'));
            au.load();
          }
          fillGenAudios(true);
        } else {
          setStatus(status, (res && res.message) || '合成失败', 'hf-error');
        }
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById('tts-to-settings').addEventListener('click', () => goPage('settings'));
    document.getElementById('tts-manage-voice').addEventListener('click', () => goPage('sound-copy'));
    openBtn.addEventListener('click', async () => {
      const s = parseSaveTo();
      const r = await window.voiceTools.getSaveDir({
        projectName: s.kind === 'project' ? s.projectName : '',
        saveDir: s.kind === 'custom' ? s.saveDir : '',
        defaultOut: s.kind === 'output'
      }).catch(() => null);
      if (!r || !r.ok || !r.saveDir) {
        setStatus(status, (r && r.message) || '获取保存目录失败', 'hf-error');
        return;
      }
      window.projectTools.openFolderOf(r.saveDir);
      setStatus(status, '已打开保存目录：' + r.saveDir, 'hf-ok');
    });

    // —— 保存到：切换（自定义目录直接弹选择器，取消回退）/ 恢复默认 ——
    saveToSel.addEventListener('change', async () => {
      if (saveToSel.value === 'custom' && !C.getCfgSaveDir()) {
        const r = await window.voiceTools.pickDir().catch(() => null);
        if (!r || r.canceled || !r.ok || !r.dir) {
          saveToSel.value = lastSaveTo; // 未选目录则回退原选择
          return;
        }
        C.setCfgSaveDir(r.dir);
        const res = await window.voiceTools.saveConfig({ saveDir: C.getCfgSaveDir() }).catch(() => null);
        if (!res || !res.ok) setStatus(status, '目录已选但保存设置失败：' + ((res && res.message) || ''), 'hf-error');
        const customOpt = saveToSel.querySelector('option[value="custom"]');
        if (customOpt) customOpt.textContent = '自定义目录…（' + C.getCfgSaveDir() + '）';
      }
      lastSaveTo = saveToSel.value;
      renderSaveTo();
      if (saveToSel.value === 'custom') setStatus(status, '保存位置已设为自定义目录：' + C.getCfgSaveDir(), 'hf-ok');
    });
    clearCustomBtn.addEventListener('click', async () => {
      C.setCfgSaveDir('');
      await window.voiceTools.saveConfig({ saveDir: '' }).catch(() => null);
      const customOpt = saveToSel.querySelector('option[value="custom"]');
      if (customOpt) customOpt.textContent = '自定义目录…（未选择）';
      const fallback = AppState.myProjects.length ? 'proj:' + ((AppState.currentName && !AppState.isBuiltin) ? AppState.currentName : AppState.myProjects[0].name) : 'out';
      saveToSel.value = fallback;
      lastSaveTo = saveToSel.value;
      renderSaveTo();
      setStatus(status, '已恢复默认保存位置（项目 audio/ 或音频输出目录）', 'hf-ok');
    });

    // —— 已生成音频：刷新 / 试听 / 设为当前项目背景音频 ——
    document.getElementById('tts-gen-refresh').addEventListener('click', () => fillGenAudios(false));
    genSel.addEventListener('change', updateGenSel);
    genPlayBtn.addEventListener('click', () => {
      if (!genAudio || !genAudio.dataset.path) { toast('请先选择已生成音频'); return; }
      const playRow = document.getElementById('tts-gen-play-row');
      if (playRow) playRow.style.display = '';
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
    genOpenDirBtn.addEventListener('click', () => {
      const it = genAudios[Number(genSel.value)];
      if (!it) { toast('请先选择已生成音频'); return; }
      window.projectTools.openFolderOf(it.path);
    });
    document.getElementById('tts-result-open-dir').addEventListener('click', () => {
      if (!lastSavePath) { toast('暂无合成文件可打开'); return; }
      window.projectTools.openFolderOf(lastSavePath);
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

    fillSaveTo();
    (async () => {
      if (await C.requireCfg()) { fillSaveTo(); C.fillVoiceSelect(voiceSel, status); fillGenAudios(true); }
    })();
  };
})();
