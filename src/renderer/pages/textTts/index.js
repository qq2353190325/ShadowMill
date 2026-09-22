// renderer/pages/textTts/index.js —— 文字生音频页共享壳：Tab 切换 + 公共工具（setStatus / requireCfg / 音色下拉）
// 合成卡逻辑见 synth.js，字幕对齐卡逻辑见 align.js（均挂载到 window.__tts）
(function () {
  'use strict';

  const { renderStepBar, goPage } = window.App;

  // 页内共享命名空间：synth.js / align.js 挂载各自卡片的初始化函数，本文件挂载公共工具
  const C = window.__tts = {};

  App.pages['text-tts'] = {
    html: App.templates['text-tts'],
    // ===== 文字生音频页（千问 Qwen-TTS 非实时合成） =====
    init: function () {
      renderStepBar('text-tts');
      // —— 页内 Tab：文字生音频 / 字幕配音 ——
      const tabCards = document.querySelectorAll('[data-tab-card]');
      const tabBtns = document.querySelectorAll('.hf-tab');
      let resultShown = false; // 合成结果卡是否出现（TTS 合成成功后置 true 并重绘 Tab）
      const applyTab = () => {
        const active = document.querySelector('.hf-tab.active');
        const name = (active && active.dataset.tab) || 'synth';
        tabCards.forEach((el) => {
          if (el.dataset.tabCard !== name) { el.style.display = 'none'; return; }
          el.style.display = (el.id === 'tts-result-wrap' && !resultShown) ? 'none' : '';
        });
      };
      tabBtns.forEach((b) => b.addEventListener('click', () => {
        tabBtns.forEach((x) => x.classList.toggle('active', x === b));
        applyTab();
      }));
      applyTab();

      const status = document.getElementById('tts-status');
      const setStatus = (el, text, kind) => {
        el.textContent = text || '';
        el.classList.remove('hf-error', 'hf-ok');
        if (kind) el.classList.add(kind);
      };
      let cfgSaveDir = ''; // 持久化的自定义保存目录（synth 卡的「保存到」使用）

      const requireCfg = async () => {
        const c = await window.voiceTools.getConfig().catch(() => null);
        if (!c || !c.ok || !c.apiKey) {
          setStatus(status, '尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error');
          goPage('settings');
          return null;
        }
        const tag = document.getElementById('tts-model-tag');
        if (tag) tag.textContent = c.targetModel || 'qwen-audio-3.0-tts-flash';
        cfgSaveDir = String((c && c.saveDir) || '').trim();
        return c;
      };

      // 原组装逻辑（voice:list-all 不可用时的回退路径：listSystemVoices + list 组装）
      const fillVoicesFallback = async (sel, stEl) => {
        setStatus(stEl, '加载音色列表…', '');
        // 系统音色：内置，无需 API Key
        const sys = await window.voiceTools.listSystemVoices().catch(() => ({ ok: false, message: '调用失败' }));
        // 自定义音色：账号下克隆音色，需 API Key
        const res = await window.voiceTools.list().catch(() => ({ ok: false, message: '调用失败' }));
        // 本地映射（中文名 / 绑定模型）
        const profRes = await window.voiceTools.getProfiles().catch(() => ({ ok: false }));
        const profiles = (profRes && profRes.ok && profRes.profiles) || {};
        const pName = (key, fallback) => { const p = profiles[key]; return (p && p.name) || fallback; };
        const pModel = (key, fallback) => { const p = profiles[key]; return (p && p.targetModel) || fallback; };

        sel.innerHTML = '';
        // 分组一：系统音色
        const sysGroup = document.createElement('optgroup');
        sysGroup.label = '系统音色（内置）';
        const sysList = (sys && sys.ok && sys.voices) || [];
        sysList.forEach((v) => {
          const o = document.createElement('option');
          o.value = v.voice;
          o.textContent = pName('system:' + v.voice, v.desc) + ' — ' + v.voice + '（' + pModel('system:' + v.voice, v.model || '') + '）';
          if (v.langs) o.setAttribute('title', '特色语种：' + v.langs);
          o.dataset.model = pModel('system:' + v.voice, v.model || '');
          sysGroup.appendChild(o);
        });
        if (!sysList.length) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = '（系统音色加载失败）';
          sysGroup.appendChild(o);
        }
        sel.appendChild(sysGroup);

        // 分组二：自定义音色
        const customGroup = document.createElement('optgroup');
        customGroup.label = '自定义音色（我的克隆）';
        if (res && res.ok) {
          res.voices.forEach((v) => {
            const o = document.createElement('option');
            o.value = v.voice;
            o.textContent = pName('custom:' + v.voice, v.voice) + '（' + pModel('custom:' + v.voice, v.target_model || '') + '）';
            o.dataset.model = pModel('custom:' + v.voice, v.target_model || '');
            customGroup.appendChild(o);
          });
        } else {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = (res && res.message) || '拉取自定义音色失败';
          customGroup.appendChild(o);
        }
        sel.appendChild(customGroup);

        sel.value = '';
        sel.selectedIndex = 0; // 默认选中第一个系统音色

        const parts = [];
        if (sysList.length) parts.push('系统音色 ' + sysList.length + ' 个');
        const customN = (res && res.ok && Array.isArray(res.voices)) ? res.voices.length : 0;
        if (customN) parts.push('自定义音色 ' + customN + ' 个');
        setStatus(stEl, parts.length ? '已加载：' + parts.join('，') + '。选中音色将使用其绑定的模型合成。' : '音色列表为空', 'hf-ok');
      };

      // 统一音色下拉填充（主合成卡与对齐卡共用）：优先 voice:list-all（合并系统/克隆 + 已解析 model），失败或无数据回退原组装
      const fillVoiceSelect = async (sel, stEl) => {
        setStatus(stEl, '加载音色列表…', '');
        const all = await window.voiceTools.listAll().catch(() => ({ ok: false, message: '调用失败' }));
        const items = (all && all.ok && Array.isArray(all.voices)) ? all.voices : [];
        if (items.length) {
          sel.innerHTML = '';
          const sysGroup = document.createElement('optgroup');
          sysGroup.label = '系统音色（内置）';
          const customGroup = document.createElement('optgroup');
          customGroup.label = '自定义音色（我的克隆）';
          let sysN = 0;
          let customN = 0;
          items.forEach((it) => {
            const o = document.createElement('option');
            o.value = it.voiceId;
            o.dataset.model = it.model || '';
            o.dataset.voiceId = it.voiceId || '';
            if (it.type === 'custom') {
              o.textContent = it.name + '（' + (it.model || '') + '）';
              customGroup.appendChild(o);
              customN++;
            } else {
              o.textContent = it.name + ' — ' + it.voiceId + '（' + (it.model || '') + '）';
              sysGroup.appendChild(o);
              sysN++;
            }
          });
          if (sysN) sel.appendChild(sysGroup);
          if (customN) sel.appendChild(customGroup);
          sel.value = '';
          sel.selectedIndex = 0; // 默认选中第一个系统音色
          const parts = [];
          if (sysN) parts.push('系统音色 ' + sysN + ' 个');
          if (customN) parts.push('自定义音色 ' + customN + ' 个');
          setStatus(stEl, parts.length ? '已加载：' + parts.join('，') + '。选中音色将使用其绑定的模型合成。' : '音色列表为空', 'hf-ok');
          return;
        }
        // 回退：list-all 不可用或返回空列表
        await fillVoicesFallback(sel, stEl);
      };

      // 共享给两个卡片模块
      Object.assign(C, {
        status: status,
        setStatus: setStatus,
        requireCfg: requireCfg,
        fillVoiceSelect: fillVoiceSelect,
        applyTab: applyTab,
        markResultShown: () => { resultShown = true; },
        getCfgSaveDir: () => cfgSaveDir,
        setCfgSaveDir: (v) => { cfgSaveDir = v; }
      });

      if (C.initSynth) C.initSynth();
      if (C.initAlign) C.initAlign();
    }
  };
})();
