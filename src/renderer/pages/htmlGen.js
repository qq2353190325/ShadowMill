// renderer/pages/htmlGen.js —— HTML 生成/修改页：Agent 对话框 + 素材下拉 + 下载 + 预览
(function () {
  'use strict';

  const { AppState, escTxt, hasHtml, renderStepBar, toast, refreshProject } = window.App;

  App.pages['html-gen'] = {
    html: `<div class="project-bar" data-slot></div>
<div class="project-selector">
  <span class="sel-label">工作项目</span>
  <select id="hg-proj-select" class="hf-select"></select>
  <button class="hf-btn" id="hg-proj-open" title="打开当前项目所在目录">打开目录</button>
</div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>HTML · Agent 生成 / 修改</div>
  <div class="proj-meta" id="hg-meta"></div>
  <div class="hgen-block">
    <div class="panel-title-sm">需求描述（提示词）</div>
    <textarea id="hg-prompt" class="hgen-subtitle" spellcheck="false" placeholder="描述你想要的 HTML 效果，例如：&#10;· 深空科技风格的标题动画页，标题为“我的作品集”&#10;· 每条字幕间隔两秒，依次从下方上浮淡入&#10;· 修改时：换成紫色霓虹配色，并把标题放大"></textarea>
  </div>
  <div class="hgen-block">
    <div class="panel-title-sm">生成素材 · 字幕 / 背景音频（均可选，留空则跳过）</div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">字幕</span>
      <select id="hg-sub-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪份字幕逐条设计动画"></select>
    </div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">背景音频</span>
      <select id="hg-audio-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪份音频作为音轨注入"></select>
    </div>
    <div class="hgen-tip">生成 / 修改 HTML 时使用所选素材：字幕逐条设计动画、音频作为音轨注入（自动复制进本项目 audio/）。两者均可留空 = 跳过对应素材，仅按需求描述生成。</div>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="hg-gen">生成 HTML</button>
    <button class="hf-btn" id="hg-mod" title="基于当前 HTML 按项目需求修改并覆盖">修改 HTML</button>
    <button class="hf-btn" id="hg-download" title="下载当前项目 HTML 到本地">下载 HTML</button>
    <button class="hf-btn" id="hg-open">打开项目目录</button>
  </div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>背景音频（可选）</div>
  <div class="hgen-row">
    <button class="hf-btn" id="hg-pick-audio">选择音频文件</button>
    <span class="hf-file" id="hg-audio-name">未设置音频</span>
    <button class="hf-btn" id="hg-clear-audio" disabled>移除音频</button>
  </div>
  <div class="hgen-row">
    <select id="hg-gen-list" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="hg-gen-refresh">刷新</button>
    <button class="hf-btn" id="hg-gen-play">试听</button>
    <button class="hf-btn hf-btn-primary" id="hg-gen-use" disabled>设为背景音频</button>
  </div>
  <div class="hgen-row" id="hg-gen-play-row" style="display:none">
    <audio id="hg-gen-audio" controls style="flex:1;max-height:44px"></audio>
    <label class="sel-label">语速</label>
    <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
      <button type="button" class="hf-btn" id="hg-gen-rate-dec" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">−</button>
      <input id="hg-gen-rate" type="text" inputmode="decimal" class="hgen-input" value="1" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none"/>
      <button type="button" class="hf-btn" id="hg-gen-rate-inc" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">+</button>
    </span>
  </div>
  <div class="hgen-tip">音频由 Agent 在生成/修改 HTML 时注入为音轨：预览即可听，转视频自动混入。下方还可直接选择已生成 TTS 音频复用为当前项目背景音频。</div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>预览</div>
  <div class="hf-status" id="hg-status"></div>
  <div class="empty-hint" id="hg-empty">尚未生成 HTML。</div>
  <iframe class="hgen-frame" id="hg-frame" style="display:none" sandbox="allow-scripts allow-same-origin"></iframe>
</div>`,
    // HTML 生成/修改页：Agent 对话框 + 下载 + 预览
    init: function () {
      renderStepBar('html-gen');
      if (AppState.isBuiltin) { toast('当前是内置示例项目（只读），请切换到自己的项目'); }
      const frame = document.getElementById('hg-frame');
      const empty = document.getElementById('hg-empty');
      const status = document.getElementById('hg-status');
      // 进入页面即清空上一轮状态文案/样式，避免残留“已生成 / 失败”的旧信息
      if (status) { status.textContent = ''; status.classList.remove('hf-error', 'hf-ok'); }
      const subList = document.getElementById('hg-sub-list');
      const audioList = document.getElementById('hg-audio-list');

      const pfx = (p) => (p && p.audioFile) ? escTxt(p.audioFile) : '未设置';
      const renderMeta = () => {
        const p = AppState.project || {};
        const hasH = hasHtml();
        const subCount = (p && p.subtitleCount) || 0;
        const c = (p && p.content) || {};
        const sceneN = Array.isArray(c.scenes)
          ? c.scenes.filter((s) => s && typeof s.narration === 'string' && s.narration.trim()).length
          : 0;
        const meta = document.getElementById('hg-meta');
        if (meta) {
          meta.innerHTML = AppState.isBuiltin
            ? '<div class="proj-stat"><b>内置示例（只读）</b>示例项目不可生成 / 修改，自带示例 HTML。请在「工作项目」下拉切换到「我的项目」。</div>'
            : '<div class="proj-stat ' + (hasH ? 'on' : '') + '"><b>HTML</b>' + (hasH ? '已生成' : '尚未生成') + '</div>' +
              '<div class="proj-stat ' + (sceneN ? 'on' : '') + '"><b>内容脚本</b>' + (sceneN ? sceneN + ' 个场景（生成时自动附带）' : '无（可先到「内容脚本」页编写）') + '</div>' +
              '<div class="proj-stat ' + (subCount ? 'on' : '') + '"><b>素材</b>' + (subCount ? '字幕 ' + subCount + ' 条' + ((p && p.audioFile) ? ' · 已配背景音频' : '') : '无字幕（可先到「字幕生成」页添加）') + '</div>' +
              '<div class="proj-stat"><b>用法</b>' + (hasH ? '可「下载 HTML」；也可填写需求后「修改 HTML」' : '填写需求描述后点「生成 HTML」；字幕 / 背景音频在上方选配（均可选）') + '</div>';
        }
        const aName = document.getElementById('hg-audio-name');
        const aClear = document.getElementById('hg-clear-audio');
        if (aName) aName.textContent = pfx(p);
        if (aClear) aClear.disabled = !(p && p.audioFile);
      };

      const loadFrame = (htmlPath) => {
        if (!frame) return;
        frame.style.display = '';
        if (empty) empty.style.display = 'none';
        frame.src = 'file:///' + encodeURI(htmlPath.replace(/\\/g, '/'));
      };

      // 状态联动：有 HTML → 自动预览；无 HTML → 恢复“尚未生成”提示（不展示空 iframe）
      const syncPreview = () => {
        // 内置示例为只读项目：其 HTML 属于示例资源而非本页生成产物，不在此展示为“已生成”/自动预览
        const ok = !AppState.isBuiltin && !!(AppState.project.htmlExists && AppState.project.htmlPath);
        if (ok) loadFrame(AppState.project.htmlPath);
        else {
          if (frame) { frame.style.display = 'none'; frame.removeAttribute('src'); }
          if (empty) {
            empty.style.display = '';
            empty.textContent = AppState.isBuiltin
              ? '内置示例项目为只读：自带示例 HTML，可到「HTML 预览」页查看效果；生成请先在「工作项目」下拉切换到「我的项目」。'
              : '尚未生成 HTML。';
          }
        }
      };

      // —— 素材选择：字幕（当前项目字幕 + 其它带字幕项目）——
      const fillSubList = () => {
        if (!subList) return;
        subList.innerHTML = '';
        const addOpt = (value, text) => {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          subList.appendChild(o);
        };
        addOpt('', '不使用字幕');
        const p = AppState.project || {};
        if (!AppState.isBuiltin && (p.subtitle || '').trim()) {
          addOpt('__current__', '当前项目字幕（' + ((p.subtitleCount) || 0) + ' 条）');
        }
        (AppState.myProjects || []).forEach((mp) => {
          if (mp && mp.name !== AppState.currentName && mp.hasSubtitle) {
            addOpt(String(mp.name), '项目「' + (mp.title || mp.name) + '」字幕（' + (mp.subtitleCount || 0) + ' 条）');
          }
        });
      };

      // —— 素材选择：背景音频（当前项目背景音频 + 已生成 TTS 音频）——
      let genAudios = [];
      const fillAudioList = (items) => {
        if (!audioList) return;
        genAudios = items || [];
        audioList.innerHTML = '';
        const addOpt = (value, text) => {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          audioList.appendChild(o);
        };
        addOpt('', '不使用背景音频');
        const p = AppState.project || {};
        if (!AppState.isBuiltin && p.audioFile) {
          addOpt('__current__', '当前项目背景音频（' + p.audioFile + '）');
        }
        genAudios.forEach((it) => {
          if (it && it.path) addOpt(String(it.path), '已生成：' + (it.name || it.path) + (it.group ? '（' + it.group + '）' : ''));
        });
      };

      (async () => {
        fillSubList();
        renderMeta();
        syncPreview();
        // 载入已生成 TTS 音频列表，填充背景音频下拉
        const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, items: [] }));
        fillAudioList((res && res.ok) ? (res.items || []) : []);
      })();

      // —— 生成 / 修改：读取行内提示词输入框，提交给自定义模型 Agent ——
      let agentRunning = false;
      const runAgent = async (mode) => {
        if (agentRunning) { toast('上一个请求还在处理中，请稍候'); return; }
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
        const promptEl = document.getElementById('hg-prompt');
        const prompt = promptEl.value.trim();
        if (!prompt) { toast('请先填写需求描述（上方提示词输入框）'); promptEl.focus(); return; }
        agentRunning = true;
        if (status) {
          const c = (AppState.project && AppState.project.content) || {};
          const sceneN = Array.isArray(c.scenes)
            ? c.scenes.filter((s) => s && typeof s.narration === 'string' && s.narration.trim()).length
            : 0;
          // 方案B：生成/修改前提示将附带当前项目内容脚本（脚本为 HTML 的整体内容源）
          status.textContent = sceneN
            ? '将附带当前项目内容脚本（' + sceneN + ' 个场景），已提交给 Agent，处理中...'
            : '当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...';
          status.classList.remove('hf-error', 'hf-ok');
        }
        // 本次生成/修改所选素材（均可空：留空 = 不拼接对应素材；'' → 跳过）
        const materials = {
          subtitleProject: subList ? subList.value : '',
          audioPath: audioList ? audioList.value : ''
        };
        try {
          const call = (mode === 'generate')
            ? window.projectTools.generateHtml(AppState.currentName, prompt, materials)
            : window.projectTools.modifyHtml(AppState.currentName, prompt, materials);
          const res = await call;
          if (res && res.ok) {
            await refreshProject();
            renderMeta();
            syncPreview();
            if (status) { status.textContent = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : ''); status.classList.add('hf-ok'); }
            toast(mode === 'generate' ? 'HTML 已生成' : 'HTML 已修改');
            renderStepBar('html-gen');
          } else {
            const msg = (res && res.message) || '提交失败';
            if (status) { status.textContent = msg; status.classList.add('hf-error'); }
            // 生成失败且项目原本就无 HTML：恢复“未生成”展示，避免误显示为已生成
            if (!AppState.project.htmlExists) {
              if (frame) { frame.style.display = 'none'; frame.removeAttribute('src'); }
              if (empty) empty.style.display = '';
            }
            toast(msg);
          }
        } finally {
          agentRunning = false;
        }
      };
      document.getElementById('hg-gen').addEventListener('click', () => runAgent('generate'));
      document.getElementById('hg-mod').addEventListener('click', () => {
        if (!AppState.project.htmlExists) { toast('还没有 HTML，先「生成 HTML」'); return; }
        runAgent('modify');
      });

      // —— 下载 HTML ——
      document.getElementById('hg-download').addEventListener('click', async () => {
        let res;
        if (AppState.isBuiltin && AppState.project.htmlPath) {
          // 内置示例：直接导出其自带 index.html（只读；不落盘到 userData 项目）
          res = await window.projectTools.downloadFile(AppState.project.htmlPath, AppState.currentName + '.html');
        } else {
          res = await window.projectTools.downloadHtml(AppState.currentName);
        }
        if (!res) return;
        if (res.ok) toast('已导出：' + res.savedPath);
        else if (!res.canceled) toast(res.message || '下载失败');
      });

      // —— 打开项目目录 ——
      document.getElementById('hg-open').addEventListener('click', () => {
        window.projectTools.openFolder(AppState.currentName);
      });

      // —— 背景音频 ——
      document.getElementById('hg-pick-audio').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
        const picked = await window.projectTools.pickAudio();
        if (!picked) return;
        const res = await window.projectTools.setAudio(AppState.currentName, picked);
        if (!res.ok) { toast(res.message || '设置音频失败'); return; }
        await refreshProject();
        renderMeta();
        toast('已加入音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
      });
      document.getElementById('hg-clear-audio').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
        await window.projectTools.clearAudio(AppState.currentName);
        await refreshProject();
        renderMeta();
        toast('已移除音频');
      });

      // —— 已生成音频：复用为当前项目背景音频（入口） ——
      const hgGenSel = document.getElementById('hg-gen-list');
      const hgGenPlay = document.getElementById('hg-gen-play');
      const hgGenUse = document.getElementById('hg-gen-use');
      const hgGenAudio = document.getElementById('hg-gen-audio');
      let hgGenAudios = [];
      const hgGenUpdate = () => {
        const it = hgGenAudios[Number(hgGenSel.value)];
        if (!it) { hgGenUse.disabled = true; return; }
        hgGenUse.disabled = AppState.isBuiltin;
        if (hgGenAudio) {
          hgGenAudio.dataset.path = it.path;
          hgGenAudio.src = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
          hgGenAudio.load();
        }
        const hgGenPlayRow = document.getElementById('hg-gen-play-row');
        if (hgGenPlayRow) hgGenPlayRow.style.display = '';
      };
      const hgGenLoad = async (silent) => {
        const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' }));
        if (!res || !res.ok) {
          if (!silent) toast((res && res.message) || '加载已生成音频失败');
          return;
        }
        hgGenAudios = res.items || [];
        hgGenSel.innerHTML = '';
        if (!hgGenAudios.length) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = '（暂无已生成音频）';
          hgGenSel.appendChild(o);
          hgGenUse.disabled = true;
          if (hgGenAudio) { hgGenAudio.src = ''; }
          const hgGenPlayRowEmpty = document.getElementById('hg-gen-play-row');
          if (hgGenPlayRowEmpty) hgGenPlayRowEmpty.style.display = 'none';
          return;
        }
        hgGenAudios.forEach((it, i) => {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = it.name + '（' + it.group + '）';
          hgGenSel.appendChild(o);
        });
        hgGenUpdate();
      };
      document.getElementById('hg-gen-refresh').addEventListener('click', () => hgGenLoad(false));
      hgGenSel.addEventListener('change', hgGenUpdate);
      hgGenPlay.addEventListener('click', () => {
        if (!hgGenAudio || !hgGenAudio.dataset.path) { toast('请先选择已生成音频'); return; }
        if (hgGenAudio.paused) hgGenAudio.play().catch(() => toast('音频试听失败（可能文件已被移动）'));
        else hgGenAudio.pause();
      });
      hgGenUse.addEventListener('click', async () => {
        const it = hgGenAudios[Number(hgGenSel.value)];
        if (!it) { toast('请先选择已生成音频'); return; }
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在上方「工作项目」切换到「我的项目」'); return; }
        const res = await window.projectTools.setAudio(AppState.currentName, it.path);
        if (!res || !res.ok) { toast((res && res.message) || '设置背景音频失败'); return; }
        await refreshProject();
        renderMeta();
        toast('已设为背景音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
      });
      // —— 已生成音频试听：语速调节（左右 ±0.05 步进 + 可手输任意小数；仅改播放 playbackRate，不改磁盘音频；0.5~2.0，非法或空值回退 1） ——
      const hgGenRate = document.getElementById('hg-gen-rate');
      if (hgGenRate) hgGenRate.addEventListener('input', () => applyRate(hgGenRate, hgGenAudio));
      const hgGenRateDec = document.getElementById('hg-gen-rate-dec');
      if (hgGenRateDec) hgGenRateDec.addEventListener('click', () => stepRate(hgGenRate, hgGenAudio, -0.05));
      const hgGenRateInc = document.getElementById('hg-gen-rate-inc');
      if (hgGenRateInc) hgGenRateInc.addEventListener('click', () => stepRate(hgGenRate, hgGenAudio, 0.05));
      hgGenLoad(true);
    }
  };
})();
