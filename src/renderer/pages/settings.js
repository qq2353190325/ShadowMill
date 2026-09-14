// renderer/pages/settings.js —— 设置页（自定义模型 OpenAI 兼容 + 千问语音配置）
(function () {
  'use strict';

  App.pages.settings = {
    html: `<div class="card hgen-panel">
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
    <select id="set-v-model" class="hgen-select" style="flex:1"></select>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="set-v-save">保存千问语音配置</button>
  </div>
  <div class="hf-status" id="set-v-status"></div>
</div>`,
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
          setVStatus(res && res.ok ? '千问语音配置已保存，可在「声音复制」「文字生音频」中使用' : ((res && res.message) || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
        });
      }
    }
  };
})();
