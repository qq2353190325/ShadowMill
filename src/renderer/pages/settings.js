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
  <div class="panel-title"><span class="dot"></span>千问语音（音色管理 & 文字生音频）</div>
  <div class="hgen-tip">配置千问AI平台 API Key 与目标语音合成模型，供「音色管理」和「文字生音频」使用。API Key 仅保存在本机 userData/settings.json。创建音色时的 target_model 必须与合成模型一致。</div>
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
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>语音识别模型（whisper.cpp 字幕转录）</div>
  <div class="hgen-tip">供字幕页「从音频生成字幕」在本机离线识别使用（不消耗 API 额度）。模型按「id ↔ 文件名」一一枚举登记：只识别登记在枚举内的文件名，枚举外的文件视为未知模型。模型文件不随应用打包，首次使用需在此下载（下载源为 HuggingFace 国内镜像 hf-mirror.com，规避 GitHub 直链超时）。点「设为当前使用」后，字幕转录弹窗即使用该档位；其他 ggml 模型可用「添加自定义模型」起名登记。</div>
  <div class="model-grid" id="wm-grid"></div>
  <div class="whisper-tip" id="wm-unknown"></div>
  <div class="whisper-bar-wrap" id="wm-bar-wrap" style="display:none">
    <div class="whisper-bar" id="wm-bar"><div class="whisper-bar-fill" id="wm-fill"></div></div>
    <div class="whisper-bar-text" id="wm-bar-text"></div>
  </div>
  <div class="hgen-actions" style="margin-top:var(--space-4)">
    <button class="hf-btn" id="wm-refresh">刷新状态</button>
    <button class="hf-btn" id="wm-open-models">打开模型目录</button>
    <button class="hf-btn" id="wm-add">添加自定义模型</button>
  </div>
  <div class="hgen-form" id="wm-form" style="display:none">
    <div class="hgen-row">
      <label>模型名称</label>
      <input class="hgen-input" id="wm-f-name" placeholder="例如：我的中文模型（用于界面显示，可随时改）">
    </div>
    <div class="hgen-row">
      <label>模型文件名</label>
      <input class="hgen-input" id="wm-f-file" placeholder="例如：ggml-medium-q8_0.bin（须为 ggml- 开头、.bin 结尾，登记后不可改）">
    </div>
    <div class="hgen-row">
      <label>下载地址</label>
      <input class="hgen-input" id="wm-f-url" placeholder="留空则按默认镜像 + 文件名拼接">
    </div>
    <div class="hgen-row">
      <label>体积(MB)</label>
      <input class="hgen-input" id="wm-f-size" placeholder="可留空">
    </div>
    <div class="hgen-row">
      <label>说明</label>
      <input class="hgen-input" id="wm-f-desc" placeholder="可留空">
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" id="wm-f-save">保存</button>
      <button class="hf-btn" id="wm-f-cancel">取消</button>
    </div>
  </div>
  <div class="hgen-tip" id="wm-store"></div>
  <div class="whisper-tip" id="wm-cli-tip"></div>
  <div class="hf-status" id="wm-status"></div>
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

      // —— 语音识别模型（whisper.cpp 字幕转录：下载 / 删除 / 当前使用 / 空间统计）——
      const wmGrid = document.getElementById('wm-grid');
      if (wmGrid && window.whisperTools) {
        const wmBarWrap = document.getElementById('wm-bar-wrap');
        const wmBar = document.getElementById('wm-bar');
        const wmFill = document.getElementById('wm-fill');
        const wmBarText = document.getElementById('wm-bar-text');
        const wmStore = document.getElementById('wm-store');
        const wmCliTip = document.getElementById('wm-cli-tip');
        const wmUnknown = document.getElementById('wm-unknown');
        const wmStatusEl = document.getElementById('wm-status');
        let wmState = null;
        let wmBusy = '';

        const fmtBytes = (n) => {
          n = Number(n) || 0;
          if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
          if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
          if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
          return n + ' B';
        };
        const setWmStatus = (text, kind) => {
          wmStatusEl.textContent = text || '';
          wmStatusEl.classList.remove('hf-error', 'hf-ok');
          if (kind) wmStatusEl.classList.add(kind);
        };
        const showWmBar = (percent, text, state) => {
          wmBarWrap.style.display = '';
          wmBar.className = 'whisper-bar';
          wmFill.className = 'whisper-bar-fill' + (state ? ' ' + state : '');
          wmFill.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%';
          wmBarText.textContent = text || '';
        };

        const escWm = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        function renderWm() {
          if (!wmState) return;
          wmGrid.innerHTML = (wmState.models || []).map((m) => {
            const badge = m.isCurrent
              ? '<span class="model-badge current">当前使用</span>'
              : (m.downloaded ? '<span class="model-badge ok">已下载</span>' : '<span class="model-badge">未下载</span>');
            const acts = [];
            if (m.downloaded) {
              if (!m.isCurrent) acts.push('<button class="hf-btn" data-act="current" data-id="' + escWm(m.id) + '">设为当前使用</button>');
              acts.push('<button class="hf-btn" data-act="delete" data-id="' + escWm(m.id) + '">删除文件</button>');
            } else {
              acts.push('<button class="hf-btn hf-btn-primary" data-act="download" data-id="' + escWm(m.id) + '">下载</button>');
            }
            if (m.custom) {
              acts.push('<button class="hf-btn" data-act="edit" data-id="' + escWm(m.id) + '">编辑</button>');
              acts.push('<button class="hf-btn" data-act="remove" data-id="' + escWm(m.id) + '">移除</button>');
            }
            const metaParts = [escWm(m.file)];
            metaParts.push(m.sizeMB ? '约 ' + m.sizeMB + ' MB' : '体积未知');
            if (m.speed) metaParts.push('速度' + m.speed);
            metaParts.push(m.custom ? '自定义' : '内置');
            if (m.downloaded) metaParts.push('本地占用 ' + fmtBytes(m.localBytes));
            if (m.downloaded && m.localFile && m.localFile !== m.file) metaParts.push('实际文件 ' + escWm(m.localFile));
            return '<div class="model-card' + (m.downloaded ? ' downloaded' : '') + (m.isCurrent ? ' current' : '') + '">' +
              '<div class="model-head"><span class="model-name">' + escWm(m.label) + '</span>' + badge + '</div>' +
              '<div class="model-meta">' + metaParts.join(' · ') + '</div>' +
              '<div class="model-desc">' + escWm(m.desc) + '</div>' +
              '<div class="model-url">' + escWm(m.url) + '</div>' +
              '<div class="model-actions">' + acts.join('') + '</div>' +
            '</div>';
          }).join('');
          wmStore.textContent = '存储位置：' + wmState.modelsDir + '　已用空间：' + fmtBytes(wmState.usedBytes);
          const unk = wmState.unknownFiles || [];
          wmUnknown.textContent = unk.length
            ? '发现 ' + unk.length + ' 个未登记的模型文件（不在枚举内，暂时无法用于转录）：' + unk.join('、') + '。可点上方「添加自定义模型」按文件名登记后启用。'
            : '';
          if (wmState.cli && wmState.cli.exists) {
            wmCliTip.textContent = 'whisper-cli.exe：已就绪（' + wmState.cli.path + '）';
            wmCliTip.style.color = '';
          } else {
            wmCliTip.textContent = '未检测到 whisper-cli.exe：请从 whisper.cpp 官方 Releases 下载 windows-x64 包，取出 whisper-cli.exe 放到 ' + ((wmState.cli && wmState.cli.path) || 'resources/whisper/whisper-cli.exe') + '（可点「打开模型目录」旁的位置手动放置）。缺少该文件时无法转录。';
            wmCliTip.style.color = 'rgba(255, 176, 32, 0.9)';
          }
        }

        async function refreshWm() {
          const s = await window.whisperTools.status().catch(() => null);
          if (!s || !s.ok) { setWmStatus('读取识别模型状态失败，请重试', 'hf-error'); return; }
          wmState = s;
          renderWm();
        }

        // 下载进度（preload 单订阅：切到设置页时本页回调生效）
        window.whisperTools.onProgress((p) => {
          if (!p) return;
          if (p.stage === 'downloading') {
            wmBusy = p.id || wmBusy;
            const sizeTxt = p.totalBytes ? '（' + fmtBytes(p.receivedBytes) + ' / ' + fmtBytes(p.totalBytes) + '）' : '';
            showWmBar(p.percent || 0, (p.message || '下载中') + sizeTxt, '');
          } else if (p.stage === 'done') {
            showWmBar(100, p.message || '下载完成', 'done');
            setWmStatus('模型下载完成，点「设为当前使用」即可用于字幕转录', 'hf-ok');
            wmBusy = '';
            refreshWm();
          } else if (p.stage === 'error') {
            showWmBar(100, p.message || '下载失败', 'error');
            setWmStatus(p.message || '下载失败', 'hf-error');
            wmBusy = '';
            refreshWm();
          }
        });

        wmGrid.addEventListener('click', async (e) => {
          const btn = e.target.closest('button[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          const id = btn.dataset.id;
          if (act === 'download') {
            if (wmBusy) { setWmStatus('已有下载任务进行中，请稍候', 'hf-error'); return; }
            wmBusy = id;
            btn.disabled = true;
            setWmStatus('开始下载「' + id + '」…模型体积较大，请保持网络畅通', '');
            showWmBar(0, '正在连接下载源（hf-mirror.com）…', '');
            const res = await window.whisperTools.download(id);
            if (!res || !res.ok) {
              showWmBar(100, (res && res.message) || '下载失败', 'error');
              setWmStatus((res && res.message) || '下载失败', 'hf-error');
            } else if (res.message) {
              setWmStatus(res.message, 'hf-ok');
            }
            wmBusy = '';
            btn.disabled = false;
            refreshWm();
          } else if (act === 'delete') {
            btn.disabled = true;
            const res = await window.whisperTools.delete(id);
            btn.disabled = false;
            if (res && res.ok) {
              setWmStatus('已删除模型「' + id + '」（如需再用可重新下载）', 'hf-ok');
            } else {
              setWmStatus((res && res.message) || '删除失败', 'hf-error');
            }
            refreshWm();
          } else if (act === 'current') {
            btn.disabled = true;
            const res = await window.whisperTools.setCurrent(id);
            btn.disabled = false;
            setWmStatus(res && res.ok ? '已将「' + id + '」设为字幕转录使用的模型' : ((res && res.message) || '设置失败'), res && res.ok ? 'hf-ok' : 'hf-error');
            refreshWm();
          } else if (act === 'edit') {
            const m = (wmState && wmState.models || []).find((x) => x.id === id);
            if (!m) return;
            openWmForm(m);
          } else if (act === 'remove') {
            btn.disabled = true;
            const res = await window.whisperTools.removeModel({ id });
            btn.disabled = false;
            setWmStatus((res && res.message) || (res && res.ok ? '已移除' : '移除失败'), res && res.ok ? 'hf-ok' : 'hf-error');
            refreshWm();
          }
        });

        // —— 自定义模型表单（添加 / 编辑；文件名与 id 登记后不可改）——
        const wmForm = document.getElementById('wm-form');
        const wmFName = document.getElementById('wm-f-name');
        const wmFFile = document.getElementById('wm-f-file');
        const wmFUrl = document.getElementById('wm-f-url');
        const wmFSize = document.getElementById('wm-f-size');
        const wmFDesc = document.getElementById('wm-f-desc');
        const wmFStatus = document.getElementById('wm-f-status');
        let wmEditId = '';

        const setWmFStatus = (text, kind) => {
          wmFStatus.textContent = text || '';
          wmFStatus.classList.remove('hf-error', 'hf-ok');
          if (kind) wmFStatus.classList.add(kind);
        };
        function openWmForm(model) {
          wmEditId = model ? model.id : '';
          wmFName.value = model ? (model.label || '') : '';
          wmFFile.value = model ? (model.file || '') : '';
          wmFUrl.value = model ? (model.url || '') : '';
          wmFSize.value = model && model.sizeMB ? String(model.sizeMB) : '';
          wmFDesc.value = model ? (model.desc || '') : '';
          wmFFile.disabled = !!model;
          wmForm.style.display = '';
          setWmFStatus(model ? ('正在编辑「' + model.label + '」：文件名不可改，其余可改') : '填写后点「保存」登记；登记成功后即可像内置模型一样下载与使用', '');
        }
        document.getElementById('wm-add').addEventListener('click', () => {
          if (wmForm.style.display === 'none' || !wmForm.style.display) openWmForm(null);
          else { wmForm.style.display = 'none'; wmEditId = ''; }
        });
        document.getElementById('wm-f-cancel').addEventListener('click', () => {
          wmForm.style.display = 'none';
          wmEditId = '';
          setWmFStatus('', '');
        });
        document.getElementById('wm-f-save').addEventListener('click', async () => {
          const payload = {
            name: wmFName.value.trim(),
            file: wmFFile.value.trim(),
            url: wmFUrl.value.trim(),
            sizeMB: wmFSize.value.trim(),
            desc: wmFDesc.value.trim()
          };
          if (!payload.name) { setWmFStatus('请填写模型名称', 'hf-error'); return; }
          if (!wmEditId && !payload.file) { setWmFStatus('请填写模型文件名（ggml- 开头的 .bin 文件）', 'hf-error'); return; }
          const res = wmEditId
            ? await window.whisperTools.updateModel(Object.assign({ id: wmEditId }, payload))
            : await window.whisperTools.addModel(payload);
          if (res && res.ok) {
            setWmFStatus(res.message || '已保存', 'hf-ok');
            wmForm.style.display = 'none';
            wmEditId = '';
            setWmStatus(res.message || '已保存', 'hf-ok');
            refreshWm();
          } else {
            setWmFStatus((res && res.message) || '保存失败', 'hf-error');
          }
        });

        document.getElementById('wm-refresh').addEventListener('click', () => {
          setWmStatus('', '');
          refreshWm();
        });
        document.getElementById('wm-open-models').addEventListener('click', async () => {
          const res = await window.whisperTools.openDir('models');
          if (!res || !res.ok) setWmStatus((res && res.message) || '打开目录失败', 'hf-error');
        });

        setWmStatus('', '');
        refreshWm();
      }
    }
  };
})();
