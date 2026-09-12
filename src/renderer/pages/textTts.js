// renderer/pages/textTts.js —— 文字生音频页（千问 Qwen-TTS 非实时合成 + 已生成音频管理 + 语速控件）
(function () {
  'use strict';

  const { AppState, renderStepBar, goPage, toast, refreshProject, applyRate, stepRate } = window.App;

  App.pages['text-tts'] = {
    html: `<div class="project-bar" data-slot></div>
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
    // ===== 文字生音频页（千问 Qwen-TTS 非实时合成） =====
    init: function () {
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
    }
  };
})();
