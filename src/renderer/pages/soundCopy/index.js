// renderer/pages/soundCopy/index.js —— 音色管理页（千问 Qwen-TTS 克隆音色 + 本地音色映射管理）
(function () {
  'use strict';

  const { renderStepBar, goPage, escTxt } = window.App;

  // 克隆提交名称必须是 1~16 位 ASCII（数字/字母/下划线）；中文名仅保存为本地「显示名称」
  const toAsciiName = (raw) => String(raw || '').trim().replace(/[^A-Za-z0-9_]/g, '');
  const genAsciiName = (raw) => {
    let n = toAsciiName(raw);
    if (!n) n = 'myvoice' + Date.now().toString().slice(-8);
    if (n.length > 16) n = n.slice(0, 16);
    return n;
  };

  App.pages['sound-copy'] = {
    html: App.templates['sound-copy'],
    // ===== 音色管理页（千问 Qwen-TTS 克隆音色 + 本地映射） =====
    init: function () {
      renderStepBar('sound-copy');
      const status = document.getElementById('vc-status');
      const listHost = document.getElementById('vc-list');
      const listStatus = document.getElementById('vc-list-status');
      const mapStatus = document.getElementById('vc-map-status');
      const fileEl = document.getElementById('vc-file');
      const setStatus = (el, text, kind) => {
        el.textContent = text || '';
        el.classList.remove('hf-error', 'hf-ok');
        if (kind) el.classList.add(kind);
      };
      let audioPath = null;
      // —— 状态缓存：候选模型表 / 系统音色 / 云端克隆 / 本地映射 ——
      let models = [];
      let cloneModels = [];
      let sysVoices = [];
      let cloudVoices = [];
      let profiles = {};
      const getProfile = (key) => profiles[key];
      const profileDisplayName = (prof, fallback) => (prof && prof.name) || fallback;

      // —— 目标模型分支：Qwen-Audio-TTS（qwen-audio-3.0-tts-flash）克隆改用「音频 URL」，其余模型保持选择本地文件 ——
      let urlMode = false;
      const fileRow = document.getElementById('vc-file-row');
      const urlRow = document.getElementById('vc-url-row');
      const urlInput = document.getElementById('vc-url');
      const applyInputMode = (m) => {
        urlMode = /^qwen-audio-.*-tts/i.test(String(m || ''));
        if (urlRow) urlRow.style.display = urlMode ? '' : 'none';
        if (fileRow) fileRow.style.display = urlMode ? 'none' : '';
      };

      // 模型切换即时联动音频输入方式：qwen-audio-* 克隆用「粘贴音频 URL」，qwen3-tts-vc-* 等其余模型用「上传本地音频文件」
      const modelSelect = document.getElementById('vc-model');
      if (modelSelect) modelSelect.addEventListener('change', () => applyInputMode(modelSelect.value));
      const mapModelSelect = document.getElementById('vc-map-model');
      const mapVoiceSelect = document.getElementById('vc-map-voice');
      const mapNameInput = document.getElementById('vc-map-name');
      const fillModelSelect = (sel, list, selected) => {
        sel.innerHTML = list.map((m) => '<option value="' + m.id + '"' + (m.id === selected ? ' selected' : '') + '>' + m.label + '</option>').join('');
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

      // —— 更新「映射管理」下拉 ——
      const fillMapVoiceSelect = () => {
        if (!mapVoiceSelect) return;
        const opts = [];
        sysVoices.forEach((v) => {
          opts.push('<option value="system:' + v.voice + '" data-type="system" data-voice="' + v.voice + '" data-model="' + (v.model || '') + '">[系统] ' + v.desc + '（' + v.voice + '）</option>');
        });
        cloudVoices.forEach((v) => {
          const tm = v.target_model || '';
          opts.push('<option value="custom:' + v.voice + '" data-type="custom" data-voice="' + v.voice + '" data-model="' + tm + '">[克隆] ' + v.voice + '</option>');
        });
        mapVoiceSelect.innerHTML = opts.join('');
        if (mapVoiceSelect.options.length && !mapVoiceSelect.value) {
          mapVoiceSelect.value = mapVoiceSelect.options[0].value;
        }
        syncMapForm();
      };
      const syncMapForm = () => {
        const key = mapVoiceSelect.value;
        const prof = getProfile(key);
        const opt = mapVoiceSelect.options[mapVoiceSelect.selectedIndex];
        const defModel = opt ? (opt.getAttribute('data-model') || '') : '';
        mapNameInput.value = prof ? prof.name : '';
        fillModelSelect(mapModelSelect, models, prof ? prof.targetModel : defModel);
      };

      // —— 渲染「我的音色」列表（合并系统音色 + 克隆音色，带中文显示名） ——
      const renderList = () => {
        if (!listHost) return;
        const all = [];
        sysVoices.forEach((v) => {
          const key = 'system:' + v.voice;
          const prof = getProfile(key);
          all.push({
            key: key,
            name: profileDisplayName(prof, v.desc),
            voice: v.voice,
            targetModel: (prof && prof.targetModel) || v.model || '',
            type: 'system'
          });
        });
        cloudVoices.forEach((v) => {
          const key = 'custom:' + v.voice;
          const prof = getProfile(key);
          all.push({
            key: key,
            name: profileDisplayName(prof, v.voice),
            voice: v.voice,
            targetModel: (prof && prof.targetModel) || v.target_model || '',
            type: 'custom'
          });
        });
        if (!all.length) { listHost.innerHTML = '暂无音色。可在上方「创建克隆音色」区创建，或到「配音」页使用内置系统音色。'; return; }
        const head = '<div style="display:grid;grid-template-columns:1.5fr 1.2fr 1fr;gap:8px 12px;font-size:12px;color:var(--text-secondary);padding:6px 2px;"><span>显示名称</span><span>音色 ID（合成模型）</span><span>创建时间 / 参数</span></div>';
        const rows = all.map((it) => {
          const extra = it.type === 'system' ? '系统音色' : (((cloudVoices.find((cv) => cv.voice === it.voice)) || {}).gmt_create || '');
          return '<div style="display:grid;grid-template-columns:1.5fr 1.2fr 1fr;gap:8px 12px;align-items:center;padding:6px 2px;border-top:1px solid rgba(0,212,255,.08);word-break:break-all;"><span style="color:var(--color-primary)">' + escTxt(it.name) + ' <span style="color:var(--text-secondary)">[' + escTxt(it.type === 'system' ? '系统' : '克隆') + ']</span></span><button class="hf-btn" style="padding:2px 8px;font-size:12px;justify-self:start" data-edit="' + it.key + '">' + escTxt(it.voice) + '（' + escTxt(it.targetModel) + '）</button><span style="color:var(--text-secondary)">' + escTxt(extra) + '</span></div>';
        }).join('');
        listHost.innerHTML = head + rows;
        listHost.querySelectorAll('button[data-edit]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (mapVoiceSelect) { mapVoiceSelect.value = btn.getAttribute('data-edit'); syncMapForm(); }
            if (mapVoiceSelect && mapVoiceSelect.scrollIntoView) mapVoiceSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      };
      const loadAll = async (silent) => {
        if (!silent) setStatus(listStatus, '拉取音色与映射…', '');
        const [sysRes, cloudRes, profRes] = await Promise.all([
          window.voiceTools.listSystemVoices().catch(() => ({ ok: false })),
          window.voiceTools.list().catch(() => ({ ok: false })),
          window.voiceTools.getProfiles().catch(() => ({ ok: false }))
        ]);
        sysVoices = (sysRes && sysRes.ok && sysRes.voices) || [];
        cloudVoices = (cloudRes && cloudRes.ok && cloudRes.voices) || [];
        profiles = (profRes && profRes.ok && profRes.profiles) || {};
        renderList();
        fillMapVoiceSelect();
        setStatus(listStatus, '系统音色 ' + sysVoices.length + ' 个 · 克隆音色 ' + cloudVoices.length + ' 个', 'hf-ok');
      };

      document.getElementById('vc-pick').addEventListener('click', async () => {
        const c = await requireCfg(); if (!c) return;
        const p = await window.voiceTools.pickAudio();
        if (p) { audioPath = p; fileEl.textContent = p; }
      });
      document.getElementById('vc-create').addEventListener('click', async () => {
        const c = await requireCfg(); if (!c) return;
        const name = document.getElementById('vc-name').value.trim();
        if (!name) { setStatus(status, '请填写显示名称', 'hf-error'); return; }
        const targetModel = modelSelect.value;
        applyInputMode(targetModel);
        if (urlMode) {
          const u = urlInput.value.trim();
          if (!u) { setStatus(status, '请填写可公开访问的音频文件地址（URL）', 'hf-error'); return; }
          setStatus(status, '正在使用音频 URL 创建音色（约几秒）…', '');
          const res = await window.voiceTools.create(u, genAsciiName(name), targetModel);
          if (res && res.ok) {
            await window.voiceTools.saveProfile({ key: 'custom:' + res.voice, name: name, voice: res.voice, targetModel: targetModel, type: 'custom' });
            setStatus(status, '音色创建成功，已绑定中文名「' + name + '」与模型「' + targetModel + '」' + (res.fallbackMode ? '（降级模式：' + escTxt(res.fallbackReason || '') + '）' : ''), 'hf-ok');
            loadAll(true);
          } else {
            setStatus(status, (res && res.message) || '创建失败', 'hf-error');
          }
          return;
        }
        if (!audioPath) { setStatus(status, '请先选择音频文件', 'hf-error'); return; }
        setStatus(status, '正在上传音频并创建音色（约几秒）…', '');
        const res = await window.voiceTools.create(audioPath, genAsciiName(name), targetModel);
        if (res && res.ok) {
          await window.voiceTools.saveProfile({ key: 'custom:' + res.voice, name: name, voice: res.voice, targetModel: targetModel, type: 'custom' });
          setStatus(status, '音色创建成功，已绑定中文名「' + name + '」与模型「' + targetModel + '」' + (res.fallbackMode ? '（降级模式：' + escTxt(res.fallbackReason || '') + '）' : ''), 'hf-ok');
          loadAll(true);
        } else {
          setStatus(status, (res && res.message) || '创建失败', 'hf-error');
        }
      });
      document.getElementById('vc-refresh').addEventListener('click', () => loadAll(false));
      document.getElementById('vc-to-settings').addEventListener('click', () => goPage('settings'));

      // —— 映射管理：保存 / 解除 ——
      document.getElementById('vc-map-save').addEventListener('click', async () => {
        const key = mapVoiceSelect.value;
        if (!key) { setStatus(mapStatus, '请先选择要管理的音色', 'hf-error'); return; }
        const opt = mapVoiceSelect.options[mapVoiceSelect.selectedIndex];
        const voice = opt.getAttribute('data-voice');
        const type = opt.getAttribute('data-type') === 'system' ? 'system' : 'custom';
        const targetModel = mapModelSelect.value;
        const name = mapNameInput.value.trim();
        const res = await window.voiceTools.saveProfile({ key: key, name: name || undefined, voice: voice, targetModel: targetModel, type: type });
        if (res && res.ok) {
          profiles = res.profiles || {};
          setStatus(mapStatus, '映射已保存' + (name ? '：' + name : ''), 'hf-ok');
          renderList();
          fillMapVoiceSelect();
        } else {
          setStatus(mapStatus, (res && res.message) || '保存失败', 'hf-error');
        }
      });
      document.getElementById('vc-map-clear').addEventListener('click', async () => {
        const key = mapVoiceSelect.value;
        if (!key) { setStatus(mapStatus, '请先选择要解除映射的音色', 'hf-error'); return; }
        const res = await window.voiceTools.deleteProfile(key);
        if (res && res.ok) {
          profiles = res.profiles || {};
          setStatus(mapStatus, '已解除该音色的本地映射（云端克隆音色本身未删除）', 'hf-ok');
          renderList();
          fillMapVoiceSelect();
        } else {
          setStatus(mapStatus, (res && res.message) || '解除失败', 'hf-error');
        }
      });
      mapVoiceSelect.addEventListener('change', syncMapForm);

      (async () => {
        const [cc, mm] = await Promise.all([
          window.voiceTools.getConfig().catch(() => null),
          window.voiceTools.listModels().catch(() => ({ models: [] }))
        ]);
        models = (mm && mm.models) || [];
        // 模型表取「语音复刻」类作为创建可选模型
        cloneModels = models.filter((m) => m.role === 'clone');
        const cfg = cc && cc.ok ? cc : { targetModel: 'qwen-audio-3.0-tts-flash' };
        if (cloneModels.length) fillModelSelect(modelSelect, cloneModels, cfg.targetModel);
        if (models.length) fillModelSelect(mapModelSelect, models, cfg.targetModel);
        applyInputMode(modelSelect.value || cfg.targetModel);
        loadAll(true);
      })();
    }
  };
})();
