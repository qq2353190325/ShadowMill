// renderer/pages/htmlGen/index.js —— HTML 生成/修改页：Agent 对话框 + 素材下拉 + 下载 + 预览
(function () {
  'use strict';

  const { AppState, escTxt, hasHtml, renderStepBar, toast, refreshProject } = window.App;

  // ===== 预览播放控制（进度条 / 暂停 / 重新播放） =====
  // 预览 iframe 内为注入控制脚本的 HTML 副本，经 postMessage 回推进度（time/dur）。
  // 消息监听全应用只绑定一次，元素按 id 实时查找：切页后旧节点自动忽略，不会叠加监听。
  let prevPlaying = true;
  let prevDur = 0;
  let prevTimeCur = 0;
  const fmtPrev = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const prevPost = (frame, type) => {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ __hg: true, type }, '*');
  };
  const syncPrevCtl = (frame) => {
    const ctl = document.getElementById('hg-prev-ctl');
    if (ctl && frame) ctl.style.display = frame.style.display === 'none' ? 'none' : '';
  };
  const renderPrevProgress = () => {
    const fill = document.getElementById('hg-prev-fill');
    if (fill && prevDur > 0) fill.style.width = Math.min(100, (prevTimeCur / prevDur) * 100).toFixed(2) + '%';
    const timeEl = document.getElementById('hg-prev-time');
    if (timeEl) timeEl.textContent = fmtPrev(prevTimeCur) + ' / ' + (prevDur > 0 ? fmtPrev(prevDur) : '--:--');
  };
  let hgPrevMsgBound = false;
  if (!hgPrevMsgBound) {
    hgPrevMsgBound = true;
    window.addEventListener('message', (ev) => {
      const d = ev && ev.data;
      if (!d || !d.__hg || d.type !== 'progress') return;
      prevTimeCur = Number(d.time) || 0;
      prevDur = Number(d.dur) || 0;
      renderPrevProgress();
      if (prevPlaying && prevDur > 0 && prevTimeCur >= prevDur - 0.25) {
        prevPlaying = false; // 自然播完：进度停满，按钮回「播放」（点击即从头重播）
        const b = document.getElementById('hg-prev-toggle');
        if (b) b.textContent = '播放';
      }
    });
  }

  App.pages['html-gen'] = {
    html: App.templates['html-gen'],
    // HTML 生成/修改页：Agent 对话框 + 下载 + 预览
    init: function () {
      renderStepBar('html-gen');
      if (AppState.isBuiltin) { toast('当前是内置示例项目（只读），请切换到自己的项目'); }
      const frame = document.getElementById('hg-frame');
      const empty = document.getElementById('hg-empty');
      const status = document.getElementById('hg-status');
      // 进入页面即清空上一轮状态文案/样式，避免残留“已生成 / 失败”的旧信息
      if (status) { status.textContent = ''; status.classList.remove('hf-error', 'hf-ok'); }
      // 思考过程展示区：进入页面即清空并隐藏，仅在生成/修改期间实时显示
      const thinkWrap = document.getElementById('hg-think-wrap');
      const thinkPre = document.getElementById('hg-think');
      if (thinkWrap) thinkWrap.style.display = 'none';
      if (thinkPre) thinkPre.textContent = '';
      // —— 生成/修改过程实时显示：主进程流式推送 AI 推理/输出阶段 ——
      window.projectTools.onHtmlProgress((info) => {
        if (!info) return;
        if (info.text && status) {
          status.textContent = info.text;
          status.classList.remove('hf-error', 'hf-ok');
        }
        // 实时显示 AI 思考过程原文（随字符计数同步更新，自动滚动到底部）
        if (thinkPre) {
          thinkPre.textContent = info.thinkText || '';
          if (thinkWrap) thinkWrap.style.display = (info.thinkText && info.thinkText.length) ? '' : 'none';
          thinkPre.scrollTop = thinkPre.scrollHeight;
        }
      });
      const subList = document.getElementById('hg-sub-list');
      const audioList = document.getElementById('hg-audio-list');
      const videoList = document.getElementById('hg-video-list');

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
            ? '<div class="proj-stat"><b>内置示例（只读）</b>示例项目不可生成 / 修改，自带示例 HTML。请在顶部「工作项目」切换到「我的项目」。</div>'
            : '<div class="proj-stat ' + (hasH ? 'on' : '') + '"><b>HTML</b>' + (hasH ? '已生成' : '尚未生成') + '</div>' +
              '<div class="proj-stat ' + (sceneN ? 'on' : '') + '"><b>内容脚本</b>' + (sceneN ? sceneN + ' 个场景（生成时自动附带）' : '无（可先到「内容脚本」页编写）') + '</div>' +
              '<div class="proj-stat ' + (subCount ? 'on' : '') + '"><b>素材</b>' + (subCount ? '字幕 ' + subCount + ' 条' + ((p && p.audioFile) ? ' · 已配背景音频' : '') + ((p && p.videoMaterial) ? ' · 已配视频素材' : '') : '无字幕（可先到「字幕生成」页添加）') + '</div>' +
              '<div class="proj-stat"><b>用法</b>' + (hasH ? '可「下载 HTML」；也可填写需求后「修改 HTML」' : '填写需求描述后点「生成 HTML」；字幕 / 背景音频 / 视频素材在上方「项目素材」选配（均可选，缺少的素材在「自定义素材」导入）') + '</div>';
        }
        const aName = document.getElementById('hg-audio-name');
        const aClear = document.getElementById('hg-clear-audio');
        if (aName) aName.textContent = pfx(p);
        if (aClear) aClear.disabled = !(p && p.audioFile);
        const vName = document.getElementById('hg-video-name');
        const vClear = document.getElementById('hg-clear-video');
        if (vName) vName.textContent = (p && p.videoMaterial) ? escTxt(p.videoMaterial) : '未设置视频';
        if (vClear) vClear.disabled = !(p && p.videoMaterial);
        const vExtract = document.getElementById('hg-extract-audio');
        if (vExtract) vExtract.disabled = !(p && p.videoMaterial) || AppState.isBuiltin;
      };

      // 加载预览：主进程生成带控制脚本的预览副本（index.preview.html），iframe 载入副本
      const loadFrame = async () => {
        if (!frame) return;
        const res = await window.projectTools.previewHtml(AppState.currentName).catch(() => null);
        if (!res || !res.ok) {
          if (frame) { frame.style.display = 'none'; frame.removeAttribute('src'); }
          syncPrevCtl(frame);
          if (empty) { empty.style.display = ''; empty.textContent = (res && res.message) || '预览副本生成失败'; }
          return;
        }
        frame.style.display = '';
        if (empty) empty.style.display = 'none';
        // ?v= 时间戳：同路径也强制重新加载（重新生成/修改后同样拿到最新预览副本）
        frame.src = 'file:///' + encodeURI(res.previewPath.replace(/\\/g, '/')) + '?v=' + Date.now();
        syncPrevCtl(frame);
      };

      // 状态联动：有 HTML → 自动预览；无 HTML → 恢复“尚未生成”提示（不展示空 iframe）
      const syncPreview = () => {
        // 内置示例为只读项目：其 HTML 属于示例资源而非本页生成产物，不在此展示为“已生成”/自动预览
        const ok = !AppState.isBuiltin && !!(AppState.project.htmlExists && AppState.project.htmlPath);
        if (ok) loadFrame();
        else {
          if (frame) { frame.style.display = 'none'; frame.removeAttribute('src'); }
          syncPrevCtl(frame);
          if (empty) {
            empty.style.display = '';
            empty.textContent = AppState.isBuiltin
              ? '内置示例项目为只读：自带示例 HTML，可到「视频生成」页查看效果；生成请先在顶部「工作项目」切换到「我的项目」。'
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

      // —— 素材选择：背景音频（仅当前项目背景音频；TTS 音频在「自定义素材」卡内设为项目音频后选用）——
      const fillAudioList = () => {
        if (!audioList) return;
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
      };

      // —— 素材选择：视频素材（当前项目视频素材；外部视频经下方面板选择复制进项目）——
      const fillVideoList = () => {
        if (!videoList) return;
        videoList.innerHTML = '';
        const addOpt = (value, text) => {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          videoList.appendChild(o);
        };
        addOpt('', '不使用视频素材');
        const p = AppState.project || {};
        if (!AppState.isBuiltin && p.videoMaterial) {
          addOpt('__current__', '当前项目视频素材（' + p.videoMaterial + '）');
        }
      };


      // 进入页面即填充三个「项目素材」下拉；TTS 音频列表由下方「自定义素材」卡单独加载
      fillSubList();
      fillAudioList();
      fillVideoList();
      renderMeta();
      syncPreview();

      // —— 预览播放控制：暂停/播放、重新播放、进度条 ——
      if (frame) {
        frame.addEventListener('load', () => {
          // 每次载入完成（含重新播放的 reload）：重置进度与按钮状态
          prevPlaying = true;
          prevDur = 0;
          prevTimeCur = 0;
          const fill = document.getElementById('hg-prev-fill');
          if (fill) fill.style.width = '0%';
          const timeEl = document.getElementById('hg-prev-time');
          if (timeEl) timeEl.textContent = '0:00 / 0:00';
          const b = document.getElementById('hg-prev-toggle');
          if (b) b.textContent = '暂停';
          syncPrevCtl(frame);
        });
      }
      const prevToggle = document.getElementById('hg-prev-toggle');
      const prevReplay = document.getElementById('hg-prev-replay');
      if (prevToggle) prevToggle.addEventListener('click', () => {
        if (!frame || !frame.src) { toast('暂无预览'); return; }
        if (!prevPlaying && prevDur > 0 && prevTimeCur >= prevDur - 0.25) {
          // 已自然播完：播放键 = 从头重播
          prevPost(frame, 'restart');
          prevPlaying = true;
          prevTimeCur = 0;
          prevDur = 0;
          renderPrevProgress();
          prevToggle.textContent = '暂停';
          return;
        }
        prevPlaying = !prevPlaying;
        prevPost(frame, prevPlaying ? 'play' : 'pause');
        prevToggle.textContent = prevPlaying ? '暂停' : '播放';
      });
      if (prevReplay) prevReplay.addEventListener('click', () => {
        if (!frame || !frame.src) { toast('暂无预览'); return; }
        prevPost(frame, 'restart');
        prevPlaying = true;
      });

      // —— 生成 / 修改：读取行内提示词输入框，提交给自定义模型 Agent ——
      let agentRunning = false;
      const runAgent = async (mode) => {
        if (agentRunning) { toast('上一个请求还在处理中，请稍候'); return; }
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
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
          audioPath: audioList ? audioList.value : '',
          videoPath: videoList ? videoList.value : ''
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
              syncPrevCtl(frame);
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

      // —— 背景音频 ——
      document.getElementById('hg-pick-audio').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
        const picked = await window.projectTools.pickAudio();
        if (!picked) return;
        const res = await window.projectTools.setAudio(AppState.currentName, picked);
        if (!res.ok) { toast(res.message || '设置音频失败'); return; }
        await refreshProject();
        renderMeta();
        fillAudioList();
        toast('已加入音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
      });
      document.getElementById('hg-clear-audio').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
        await window.projectTools.clearAudio(AppState.currentName);
        await refreshProject();
        renderMeta();
        fillAudioList();
        toast('已移除音频');
      });

      // —— 视频素材：预览（主进程返回项目内绝对路径，file:// 直接播放） ——
      const videoPrev = document.getElementById('hg-video-prev');
      const videoPrevRow = document.getElementById('hg-video-prev-row');
      const syncVideoPreview = (absPath) => {
        if (!videoPrev || !videoPrevRow) return;
        if (absPath && absPath.length) {
          videoPrev.src = 'file:///' + encodeURI(String(absPath).replace(/\\/g, '/'));
          videoPrevRow.style.display = '';
        } else {
          videoPrev.removeAttribute('src');
          videoPrevRow.style.display = 'none';
        }
      };
      document.getElementById('hg-pick-video').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
        const picked = await window.projectTools.pickVideo();
        if (!picked) return;
        const res = await window.projectTools.setVideo(AppState.currentName, picked);
        if (!res || !res.ok) { toast((res && res.message) || '设置视频失败'); return; }
        await refreshProject();
        renderMeta();
        fillVideoList();
        syncVideoPreview(res.abs);
        toast('已加入视频素材：' + res.videoFile + '（生成/修改时让 Agent 嵌入该视频片段）');
      });
      document.getElementById('hg-clear-video').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
        await window.projectTools.clearVideo(AppState.currentName);
        await refreshProject();
        renderMeta();
        fillVideoList();
        syncVideoPreview('');
        toast('已移除视频素材');
      });

      // —— 提取视频原声：mp4 音轨 → 项目背景音频（保留原声路线） ——
      const hgExtractAudio = document.getElementById('hg-extract-audio');
      if (hgExtractAudio) hgExtractAudio.addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先切换到自己的项目'); return; }
        if (!(AppState.project && AppState.project.videoMaterial)) { toast('还没有视频素材，请先「选择视频文件」'); return; }
        hgExtractAudio.disabled = true;
        hgExtractAudio.textContent = '提取中…';
        const res = await window.projectTools.extractVideoAudio(AppState.currentName).catch(() => null);
        hgExtractAudio.disabled = false;
        hgExtractAudio.textContent = '提取原声为背景音频';
        if (!res || !res.ok) { toast((res && res.message) || '提取失败'); return; }
        await refreshProject();
        renderMeta();
        fillAudioList();
        toast('已提取原声并设为背景音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
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
        if (AppState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
        const res = await window.projectTools.setAudio(AppState.currentName, it.path);
        if (!res || !res.ok) { toast((res && res.message) || '设置背景音频失败'); return; }
        await refreshProject();
        renderMeta();
        fillAudioList();
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
