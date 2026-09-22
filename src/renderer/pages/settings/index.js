// renderer/pages/settings/index.js —— 设置页：自定义模型（OpenAI 兼容）+ 千问语音配置
// 语音识别模型（whisper.cpp）区块见 whisper.js（挂载到 window.__settings）
(function () {
  'use strict';

  App.pages.settings = {
    html: App.templates['settings'],
    init: function () {
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

      // —— 千问语音配置（音色管理 & 文字生音频）——
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
          // 动态填充候选模型表（语音复刻 + 系统音色合成）
          const mm = await window.voiceTools.listModels().catch(() => ({ models: [] }));
          const models = (mm && mm.models) || [];
          if (vModelEl && models.length) {
            vModelEl.innerHTML = models.map((m) => '<option value="' + m.id + '"' + (m.isDefault ? ' selected' : '') + '>' + m.label + '</option>').join('');
          }
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
          setVStatus(res && res.ok ? '千问语音配置已保存，可在「音色管理」「文字生音频」中使用' : ((res && res.message) || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
        });
      }

      // —— 语音识别模型（whisper.cpp）区块：whisper.js ——
      if (window.__settings && window.__settings.initWhisper) window.__settings.initWhisper();
    }
  };
})();
