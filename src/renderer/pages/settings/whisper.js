// renderer/pages/settings/whisper.js —— 设置页语音识别模型（whisper.cpp）区块：下载 / 删除 / 当前使用 / 自定义模型登记
// 由 index.js 调用 window.__settings.initWhisper() 初始化
(function () {
  'use strict';

  window.__settings = window.__settings || {};

  window.__settings.initWhisper = function () {
    // —— 语音识别模型（whisper.cpp 字幕转录：下载 / 删除 / 当前使用 / 空间统计）——
    const wmGrid = document.getElementById('wm-grid');
    if (!wmGrid || !window.whisperTools) return;
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
      if (!wmFStatus) return;
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
  };
})();
