// renderer/pages/soundCopy.js —— 声音复制页（千问 Qwen-TTS 克隆音色）
(function () {
  'use strict';

  const { renderStepBar, goPage, escTxt } = window.App;

  App.pages['sound-copy'] = {
    html: `<div class="project-bar" data-slot></div>
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
    // ===== 声音复制页（千问 Qwen-TTS 克隆音色） =====
    init: function () {
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
    }
  };
})();
