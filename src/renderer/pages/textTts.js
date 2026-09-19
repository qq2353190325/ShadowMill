// renderer/pages/textTts.js —— 文字生音频页（千问 Qwen-TTS 非实时合成 + 已生成音频管理 + 语速控件）
(function () {
  'use strict';

  const { AppState, escTxt, renderStepBar, goPage, toast, refreshProject, applyRate, stepRate } = window.App;

  App.pages['text-tts'] = {
    html: `<div class="project-bar" data-slot></div>
<div class="hf-tabs">
  <button type="button" class="hf-tab active" data-tab="synth">文字生音频（TTS 合成）</button>
  <button type="button" class="hf-tab" data-tab="align">字幕配音（逐句对齐）</button>
</div>
<div class="card hgen-panel" data-tab-card="synth">
  <div class="panel-title"><span class="dot"></span>文字生音频（TTS 合成）</div>
  <div class="hgen-tip">选择音色后按该音色绑定的模型合成语音（克隆音色绑定创建时选择的目标模型，系统音色绑定默认合成模型）。结果默认保存到所选项目的 <code>audio/</code>，也可在「保存到」中选择自定义目录或音频输出目录。展示的目标模型（<b id="tts-model-tag"></b>）为未绑定模型音色时的兜底值，可在「音色管理」页为音色改名、改模型。</div>
  <div style="margin-top:var(--space-4)">
    <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2)">
      <div class="panel-title-sm" style="margin:0">合成文本</div>
      <button class="hf-btn" id="tts-load-narration" title="把当前项目内容脚本的旁白逐场景载入合成文本（每场景一段，空行分隔），可继续手动编辑" style="padding:4px 12px;font-size:12px">载入脚本旁白</button>
    </div>
    <textarea id="tts-text" class="hgen-subtitle" style="height:150px;margin-bottom:var(--space-3)" spellcheck="false" placeholder="输入要合成语音的文字…"></textarea>
  </div>
  <div class="hgen-row">
    <label class="sel-label">音色</label>
    <select id="tts-voice" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="tts-refresh-voice" title="重新拉取音色列表">刷新</button>
    <button class="hf-btn" id="tts-manage-voice" title="前往「音色管理」页：克隆音色 / 为音色改名、改模型" style="padding:4px 12px;font-size:12px">管理音色</button>
  </div>
  <div class="hgen-row">
    <label class="sel-label">保存到</label>
    <select id="tts-save-to" class="hgen-select" style="flex:1" title="合成结果保存位置：项目 audio/（写入项目）· 自定义目录 · 音频输出目录（不写入项目）"></select>
    <button class="hf-btn" id="tts-open-folder" title="打开当前选择的保存目录（无需等合成完成）">打开目录</button>
  </div>
  <div class="hgen-row" id="tts-save-custom-row" style="display:none">
    <span class="hf-file" id="tts-save-custom">（尚未选择自定义目录）</span>
    <button class="hf-btn" id="tts-clear-custom" title="清除自定义目录，保存到恢复为项目 / 音频输出目录">恢复默认</button>
  </div>
  <div class="hgen-row">
    <label class="sel-label" title="选填。留空时自动命名：时间_前五个字_音色id">音频名字</label>
    <input id="tts-audio-name" class="hgen-input" type="text" placeholder="选填；不填自动命名：时间_前五个字_音色id" style="flex:1" />
    <span class="hgen-tip" style="margin:0;font-size:12px;white-space:nowrap">选填</span>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="tts-synth">合成并保存</button>
  </div>
  <div class="hf-status" id="tts-status"></div>
  <button class="hf-btn" id="tts-to-settings" title="跳转到「设置」-「千问语音」（未配置 Key 时合成会自动引导）" style="padding:2px 10px;font-size:12px;opacity:.55;margin-top:var(--space-2)">API Key 设置</button>
</div>
<div class="card hgen-panel" id="tts-result-wrap" style="margin-top:16px;display:none" data-tab-card="synth">
  <div class="panel-title"><span class="dot"></span>合成结果</div>
  <div class="hgen-row">
    <span class="hf-file" id="tts-result-path"></span>
    <button class="hf-btn" id="tts-result-open-dir" disabled>打开目录</button>
  </div>
  <div class="hgen-row">
    <audio class="hf-video" id="tts-audio" controls style="flex:1;max-height:54px"></audio>
    <label class="sel-label">语速</label>
    <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
      <button type="button" class="hf-btn" id="tts-rate-dec" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">−</button>
      <input id="tts-rate" type="text" inputmode="decimal" class="hgen-input" value="1" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none"/>
      <button type="button" class="hf-btn" id="tts-rate-inc" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">+</button>
    </span>
  </div>
</div>
<div class="card hgen-panel" style="margin-top:16px" data-tab-card="align">
  <div class="panel-title"><span class="dot"></span>字幕配音（逐句对齐）</div>
  <div class="hgen-tip" id="align-tip-audio">逐句 TTS 合成后以实测每句时长为准重建字幕时间线，句间停顿优先按字幕原有间隔推算。结果写入当前项目。</div>
  <div class="hgen-tip" id="align-tip-timeline" style="display:none">保持字幕时间不变，把每句配音摆到其字幕时间戳（句间补静音），放不下时轻微加速（≤1.15 倍）或顺延后续句子并同步改字幕。结果写入当前项目。</div>
  <div class="hgen-row">
    <span class="sel-label" style="flex:none;width:auto">字幕来源</span>
    <select id="align-sub-src" class="hgen-select" style="flex:1" title="选用哪份字幕逐句合成配音"></select>
    <button class="hf-btn" id="align-sub-refresh">刷新</button>
    <span class="hgen-tip" id="align-sub-count" style="margin:0;font-size:12px;white-space:nowrap"></span>
  </div>
  <div class="hgen-row">
    <span class="sel-label" style="flex:none;width:auto">音色</span>
    <select id="align-voice" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="align-voice-refresh">刷新</button>
  </div>
  <div class="hgen-row">
    <span class="sel-label" style="flex:none;width:auto">对齐方式</span>
    <label class="hgen-check"><input type="radio" name="align-mode" value="audio-driven" checked/> 重排字幕（音频驱动）</label>
    <label class="hgen-check"><input type="radio" name="align-mode" value="timeline-driven"/> 修正音频（时间轴驱动）</label>
  </div>
  <div class="hgen-row" id="align-gap-row">
    <span class="sel-label" style="flex:none;width:auto">句间停顿（秒）</span>
    <input id="align-gap" class="hgen-input" type="number" min="0" max="10" step="0.1" value="0.5" style="width:90px;flex:none" title="最小停顿：每句停顿优先按字幕原有时间间隔推算；仅当字幕间隔放不下本句音频、或字幕无时间线（估时）时，才用此值兜底"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="align-start">开始对齐合成</button>
    <button class="hf-btn" id="align-cancel" style="display:none">取消</button>
    <button class="hf-btn" id="align-retry" style="display:none">重试</button>
  </div>
  <div class="whisper-bar-wrap" id="align-bar-wrap" style="display:none">
    <div class="whisper-bar" id="align-bar"><div class="whisper-bar-fill" id="align-fill"></div></div>
    <div class="whisper-bar-text" id="align-bar-text"></div>
  </div>
  <div class="hf-status" id="align-status" style="margin-top:var(--space-3)"></div>
  <div id="align-result" style="display:none;margin-top:var(--space-4)">
    <div class="hgen-row">
      <audio class="hf-video" id="align-audio" controls style="flex:1;max-height:54px"></audio>
      <button class="hf-btn" id="align-open-dir">打开目录</button>
      <button class="hf-btn hf-btn-primary" id="align-write">写入当前项目</button>
    </div>
    <div class="hgen-tip" id="align-summary" style="margin-top:var(--space-3)"></div>
    <div class="sub-list" id="align-list" style="max-height:300px"></div>
  </div>
  <audio id="align-seg-audio" style="display:none"></audio>
</div>
<div class="card hgen-panel" style="margin-top:16px" data-tab-card="synth">
  <div class="panel-title"><span class="dot"></span>已生成音频（可选，作为当前项目背景音频复用）</div>
  <div class="hgen-row">
    <select id="tts-gen-list" class="hgen-select" style="flex:1"></select>
    <button class="hf-btn" id="tts-gen-refresh">刷新</button>
    <button class="hf-btn" id="tts-gen-play">试听</button>
  </div>
  <div class="hgen-row">
    <span class="hf-file" id="tts-gen-info">未加载</span>
    <button class="hf-btn" id="tts-gen-open-dir" disabled>打开目录</button>
    <button class="hf-btn hf-btn-primary" id="tts-gen-setbg" disabled>设为当前项目背景音频</button>
  </div>
  <div class="hgen-row" id="tts-gen-play-row" style="display:none">
    <audio id="tts-gen-audio" controls style="flex:1;max-height:44px;width:100%;min-width:0"></audio>
    <label class="sel-label">语速</label>
    <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
      <button type="button" class="hf-btn" id="tts-gen-rate-dec" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">−</button>
      <input id="tts-gen-rate" type="text" inputmode="decimal" class="hgen-input" value="1" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none"/>
      <button type="button" class="hf-btn" id="tts-gen-rate-inc" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none">+</button>
    </span>
  </div>
  <div class="hgen-tip">列出历史合成保存的 TTS 音频（默认输出目录、自定义保存目录）与各项目 audio/ 中的音频，可直接一键设为当前项目的背景音频（复制进项目 audio/ 并写入 project.json）。</div>
</div>`,
    // ===== 文字生音频页（千问 Qwen-TTS 非实时合成） =====
    init: function () {
      renderStepBar('text-tts');
      // —— 页内 Tab：文字生音频 / 字幕配音（各功能区独立成页，避免长页滚动） ——
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
      const voiceSel = document.getElementById('tts-voice');
      const openBtn = document.getElementById('tts-open-folder');
      const tag = document.getElementById('tts-model-tag');
      // —— 保存到（合并原「保存到项目」「保存位置」：项目 audio/ · 自定义目录 · 音频输出目录 三选一） ——
      const saveToSel = document.getElementById('tts-save-to');
      const saveCustomRow = document.getElementById('tts-save-custom-row');
      const saveCustomEl = document.getElementById('tts-save-custom');
      const clearCustomBtn = document.getElementById('tts-clear-custom');
      let cfgSaveDir = '';
      let lastSaveTo = ''; // 选择自定义目录取消时回退
      // 解析当前选择：proj:<name> → 项目 audio/；custom → 自定义目录；out → 音频输出目录
      const parseSaveTo = () => {
        const v = saveToSel.value;
        if (v === 'custom') return { kind: 'custom', saveDir: cfgSaveDir };
        if (v === 'out') return { kind: 'output' };
        if (v && v.indexOf('proj:') === 0) return { kind: 'project', projectName: v.slice(5) };
        return { kind: 'none' };
      };
      const renderSaveTo = () => {
        saveCustomRow.style.display = parseSaveTo().kind === 'custom' ? '' : 'none';
        saveCustomEl.textContent = cfgSaveDir ? '自定义目录：' + cfgSaveDir : '（尚未选择自定义目录）';
      };
      const fillSaveTo = () => {
        const prev = lastSaveTo || saveToSel.value;
        saveToSel.innerHTML = '';
        AppState.myProjects.forEach((p) => {
          const o = document.createElement('option');
          o.value = 'proj:' + p.name;
          o.textContent = '项目「' + (p.title || p.name) + '」（audio/）';
          saveToSel.appendChild(o);
        });
        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = cfgSaveDir ? '自定义目录…（' + cfgSaveDir + '）' : '自定义目录…（未选择）';
        saveToSel.appendChild(customOpt);
        const outOpt = document.createElement('option');
        outOpt.value = 'out';
        outOpt.textContent = '音频输出目录（不写入项目）';
        saveToSel.appendChild(outOpt);
        const has = (v) => Array.prototype.some.call(saveToSel.options, (o) => o.value === v);
        let want = has(prev) ? prev : '';
        if (!want) {
          // 默认：已持久化自定义目录 → 自定义；否则当前项目（内置项目则最近项目）；无项目 → 音频输出目录
          want = cfgSaveDir ? 'custom' : (AppState.myProjects.length ? 'proj:' + ((AppState.currentName && !AppState.isBuiltin) ? AppState.currentName : AppState.myProjects[0].name) : 'out');
        }
        if (!has(want)) want = 'out';
        saveToSel.value = want;
        lastSaveTo = saveToSel.value;
        renderSaveTo();
      };
      // —— 已生成音频（复用为背景音频） ——
      const genSel = document.getElementById('tts-gen-list');
      const genInfo = document.getElementById('tts-gen-info');
      const genPlayBtn = document.getElementById('tts-gen-play');
      const genSetBtn = document.getElementById('tts-gen-setbg');
      const genOpenDirBtn = document.getElementById('tts-gen-open-dir');
      const genAudio = document.getElementById('tts-gen-audio');
      let genAudios = [];
      let lastSavePath = ''; // 最近一次合成保存的文件路径（供「合成结果」卡打开目录按钮使用）
      const updateGenSel = () => {
        const it = genAudios[Number(genSel.value)];
        if (!it) {
          genInfo.textContent = '';
          genSetBtn.disabled = true;
          if (genOpenDirBtn) genOpenDirBtn.disabled = true;
          return;
        }
        genInfo.textContent = it.path;
        genSetBtn.disabled = AppState.isBuiltin;
        if (genOpenDirBtn) genOpenDirBtn.disabled = AppState.isBuiltin;
        if (genAudio) {
          genAudio.dataset.path = it.path;
          genAudio.src = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
          genAudio.load();
        }
        const genPlayRow = document.getElementById('tts-gen-play-row');
        if (genPlayRow) genPlayRow.style.display = 'none';
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
        // 按来源分组展示（音频输出目录 / 自定义目录 / 项目 · X），避免文件来源混在一起
        const byGroup = new Map();
        genAudios.forEach((it, i) => {
          const g = it.group || '其他';
          if (!byGroup.has(g)) byGroup.set(g, []);
          byGroup.get(g).push([it, i]);
        });
        byGroup.forEach((arr, g) => {
          const og = document.createElement('optgroup');
          og.label = g;
          arr.forEach((pair) => {
            const o = document.createElement('option');
            o.value = String(pair[1]);
            o.textContent = pair[0].name;
            og.appendChild(o);
          });
          genSel.appendChild(og);
        });
        updateGenSel();
      };
      const setStatus = (el, text, kind) => {
        el.textContent = text || '';
        el.classList.remove('hf-error', 'hf-ok');
        if (kind) el.classList.add(kind);
      };

      const requireCfg = async () => {
        const c = await window.voiceTools.getConfig().catch(() => null);
        if (!c || !c.ok || !c.apiKey) {
          setStatus(status, '尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error');
          goPage('settings');
          return null;
        }
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

      document.getElementById('tts-refresh-voice').addEventListener('click', async () => { if (await requireCfg()) fillVoiceSelect(voiceSel, status); });
      // 载入脚本旁白：把当前项目内容脚本的场景旁白逐段填入 tts-text（每场景一段、空行分隔），可继续手动编辑；不改动合成/语速/保存逻辑
      document.getElementById('tts-load-narration').addEventListener('click', () => {
        const content = AppState.project && AppState.project.content;
        const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
        const narrs = scenes
          .map((s) => (s && typeof s.narration === 'string' ? s.narration.trim() : ''))
          .filter((t) => t.length > 0);
        if (!narrs.length) {
          setStatus(status, '当前项目无内容脚本（或场景无旁白），请先到「内容脚本」页编写', 'hf-error');
          return;
        }
        const ta = document.getElementById('tts-text');
        ta.value = narrs.join('\n\n');
        setStatus(status, '已载入 ' + narrs.length + ' 段旁白（每场景一段、空行分隔），可继续手动编辑', 'hf-ok');
      });
      document.getElementById('tts-synth').addEventListener('click', async () => {
        const c = await requireCfg(); if (!c) return;
        const text = document.getElementById('tts-text').value.trim();
        const voice = voiceSel.value;
        if (!text) { setStatus(status, '请输入合成文本', 'hf-error'); return; }
        if (!voice) { setStatus(status, '请先选择（或创建）音色', 'hf-error'); return; }
        const s = parseSaveTo();
        if (s.kind === 'none') { setStatus(status, '请选择保存位置', 'hf-error'); return; }
        // 使用当前音色绑定的模型合成（选中音色即对应其模型）；无绑定则回落全局默认
        const opt = voiceSel.options[voiceSel.selectedIndex];
        const voiceModel = opt ? (opt.dataset && opt.dataset.model) || '' : '';
        const btn = document.getElementById('tts-synth');
        btn.disabled = true;
        setStatus(status, '正在按所选音色（' + (voiceModel || '默认模型') + '）合成并下载语音…', '');
        try {
          const audioName = (document.getElementById('tts-audio-name').value || '').trim();
          const res = await window.voiceTools.synth(text, voice, s.kind === 'project' ? s.projectName : '', s.kind === 'custom' ? s.saveDir : '', voiceModel, audioName, s.kind === 'output');
          if (res && res.ok) {
            const where = res.savedTo === 'project'
              ? '已保存到项目「' + (res.projectName || '') + '」'
              : res.savedTo === 'output' ? '已保存到音频输出目录' : '已保存到自定义目录';
            setStatus(status, '合成完成，' + where, 'hf-ok');
            resultShown = true;
            applyTab();
            const rp = document.getElementById('tts-result-path');
            if (rp) rp.textContent = '保存路径：' + (res.savePath || '');
            lastSavePath = res.savePath || '';
            const roBtn = document.getElementById('tts-result-open-dir');
            if (roBtn) roBtn.disabled = !lastSavePath;
            const au = document.getElementById('tts-audio');
            if (au && res.savePath) {
              au.src = 'file:///' + encodeURI(String(res.savePath).replace(/\\/g, '/'));
              au.load();
            }
            fillGenAudios(true);
          } else {
            setStatus(status, (res && res.message) || '合成失败', 'hf-error');
          }
        } finally {
          btn.disabled = false;
        }
      });
      document.getElementById('tts-to-settings').addEventListener('click', () => goPage('settings'));
      document.getElementById('tts-manage-voice').addEventListener('click', () => goPage('sound-copy'));
      openBtn.addEventListener('click', async () => {
        const s = parseSaveTo();
        const r = await window.voiceTools.getSaveDir({
          projectName: s.kind === 'project' ? s.projectName : '',
          saveDir: s.kind === 'custom' ? s.saveDir : '',
          defaultOut: s.kind === 'output'
        }).catch(() => null);
        if (!r || !r.ok || !r.saveDir) {
          setStatus(status, (r && r.message) || '获取保存目录失败', 'hf-error');
          return;
        }
        window.projectTools.openFolderOf(r.saveDir);
        setStatus(status, '已打开保存目录：' + r.saveDir, 'hf-ok');
      });

      // —— 保存到：切换（自定义目录直接弹选择器，取消回退）/ 恢复默认 ——
      saveToSel.addEventListener('change', async () => {
        if (saveToSel.value === 'custom' && !cfgSaveDir) {
          const r = await window.voiceTools.pickDir().catch(() => null);
          if (!r || r.canceled || !r.ok || !r.dir) {
            saveToSel.value = lastSaveTo; // 未选目录则回退原选择
            return;
          }
          cfgSaveDir = r.dir;
          const res = await window.voiceTools.saveConfig({ saveDir: cfgSaveDir }).catch(() => null);
          if (!res || !res.ok) setStatus(status, '目录已选但保存设置失败：' + ((res && res.message) || ''), 'hf-error');
          const customOpt = saveToSel.querySelector('option[value="custom"]');
          if (customOpt) customOpt.textContent = '自定义目录…（' + cfgSaveDir + '）';
        }
        lastSaveTo = saveToSel.value;
        renderSaveTo();
        if (saveToSel.value === 'custom') setStatus(status, '保存位置已设为自定义目录：' + cfgSaveDir, 'hf-ok');
      });
      clearCustomBtn.addEventListener('click', async () => {
        cfgSaveDir = '';
        await window.voiceTools.saveConfig({ saveDir: '' }).catch(() => null);
        const customOpt = saveToSel.querySelector('option[value="custom"]');
        if (customOpt) customOpt.textContent = '自定义目录…（未选择）';
        const fallback = AppState.myProjects.length ? 'proj:' + ((AppState.currentName && !AppState.isBuiltin) ? AppState.currentName : AppState.myProjects[0].name) : 'out';
        saveToSel.value = fallback;
        lastSaveTo = saveToSel.value;
        renderSaveTo();
        setStatus(status, '已恢复默认保存位置（项目 audio/ 或音频输出目录）', 'hf-ok');
      });

      // —— 已生成音频：刷新 / 试听 / 设为当前项目背景音频 ——
      document.getElementById('tts-gen-refresh').addEventListener('click', () => fillGenAudios(false));
      genSel.addEventListener('change', updateGenSel);
      genPlayBtn.addEventListener('click', () => {
        if (!genAudio || !genAudio.dataset.path) { toast('请先选择已生成音频'); return; }
        const playRow = document.getElementById('tts-gen-play-row');
        if (playRow) playRow.style.display = '';
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
      genOpenDirBtn.addEventListener('click', () => {
        const it = genAudios[Number(genSel.value)];
        if (!it) { toast('请先选择已生成音频'); return; }
        window.projectTools.openFolderOf(it.path);
      });
      document.getElementById('tts-result-open-dir').addEventListener('click', () => {
        if (!lastSavePath) { toast('暂无合成文件可打开'); return; }
        window.projectTools.openFolderOf(lastSavePath);
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

      // —— 字幕配音（逐句对齐）卡片 ——
      const alignSubSrc = document.getElementById('align-sub-src');
      const alignSubCount = document.getElementById('align-sub-count');
      const alignVoice = document.getElementById('align-voice');
      const alignGap = document.getElementById('align-gap');
      const alignGapRow = document.getElementById('align-gap-row');
      const alignStart = document.getElementById('align-start');
      const alignCancel = document.getElementById('align-cancel');
      const alignRetry = document.getElementById('align-retry');
      const alignBarWrap = document.getElementById('align-bar-wrap');
      const alignBar = document.getElementById('align-bar');
      const alignFill = document.getElementById('align-fill');
      const alignBarText = document.getElementById('align-bar-text');
      const alignStatus = document.getElementById('align-status');
      const alignResult = document.getElementById('align-result');
      const alignAudio = document.getElementById('align-audio');
      const alignSummary = document.getElementById('align-summary');
      const alignList = document.getElementById('align-list');
      const alignSegAudio = document.getElementById('align-seg-audio');
      let alignBusy = false;
      let lastAlignResult = null; // { audioPath, subtitleText, details, totalDur, mode }

      const setAlignStatus = (text, kind) => setStatus(alignStatus, text, kind);
      // 进度条：percent 数字为确定态，null/省略为不确定态；done/error 固定填满（同字幕页 showTwBar 语义）
      const showAlignBar = (info, indeterminate, percent) => {
        if (!alignBarWrap) return;
        alignBarWrap.style.display = '';
        alignBar.className = 'whisper-bar' + (indeterminate ? ' indeterminate' : '');
        alignFill.className = 'whisper-bar-fill' + (info.kind === 'done' ? ' done' : info.kind === 'error' ? ' error' : '');
        const p = (typeof percent === 'number' && percent >= 0) ? percent : (info.kind === 'done' || info.kind === 'error' ? 100 : 0);
        alignFill.style.width = p + '%';
        alignBarText.textContent = info.text || '';
      };
      const hideAlignBar = () => {
        if (alignBarWrap) alignBarWrap.style.display = 'none';
        if (alignBarText) alignBarText.textContent = '';
      };
      // 对齐时间显示：[分:秒]（与字幕页 fmtTime 一致：四舍五入到秒）
      const alignFmt = (sec) => {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      };

      // 字幕来源：当前项目（置顶）+ 其他带字幕项目
      const fillAlignSubSrc = () => {
        alignSubSrc.innerHTML = '';
        const addOpt = (value, text) => {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          alignSubSrc.appendChild(o);
        };
        addOpt('__current__', '当前项目字幕（' + ((AppState.project && AppState.project.subtitleCount) || 0) + ' 条）');
        (AppState.myProjects || []).forEach((mp) => {
          if (mp && mp.name !== AppState.currentName && mp.hasSubtitle) {
            addOpt(String(mp.name), '项目「' + (mp.title || mp.name) + '」字幕（' + (mp.subtitleCount || 0) + ' 条）');
          }
        });
        syncAlignSubCount();
      };
      const countSubtitleLines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;
      const syncAlignSubCount = () => {
        if (!alignSubCount) return;
        if (alignSubSrc.value === '__current__') {
          alignSubCount.textContent = '共 ' + countSubtitleLines(AppState.project && AppState.project.subtitle) + ' 行';
        } else {
          alignSubCount.textContent = '';
        }
      };
      const getAlignSubtitleText = async () => {
        const v = alignSubSrc.value;
        if (!v) return { ok: false, message: '请选择字幕来源' };
        if (v === '__current__') {
          const t = (AppState.project && AppState.project.subtitle) || '';
          return t.trim() ? { ok: true, text: t } : { ok: false, message: '当前项目没有字幕，请先到「字幕生成」页生成或填写' };
        }
        const res = await window.projectTools.load(v).catch(() => null);
        const t = (res && res.subtitle) || '';
        return t.trim() ? { ok: true, text: t } : { ok: false, message: '项目「' + v + '」没有字幕' };
      };

      // 进度推送（preload 单订阅；切页后本页回调不再触发）
      window.voiceTools.onAlignProgress((p) => {
        if (!p) return;
        if (p.stage === 'synth' || p.stage === 'measure') {
          showAlignBar({ text: p.message || '合成中…' }, false, p.percent);
          setAlignStatus(p.message || '合成中…', '');
        } else if (p.stage === 'assemble') {
          showAlignBar({ text: p.message || '装配中…' }, true);
          setAlignStatus(p.message || '装配中…', '');
        } else if (p.stage === 'done') {
          showAlignBar({ text: p.message || '完成', kind: 'done' }, false);
          setAlignStatus(p.message || '完成', 'hf-ok');
        } else if (p.stage === 'error') {
          showAlignBar({ text: p.message || '失败', kind: 'error' }, false);
          setAlignStatus(p.message || '失败', 'hf-error');
        }
      });

      const resetAlignUi = () => {
        alignResult.style.display = 'none';
        if (alignAudio) alignAudio.removeAttribute('src');
        alignSummary.textContent = '';
        alignList.innerHTML = '';
        lastAlignResult = null;
      };

      const startAlign = async () => {
        if (alignBusy) { toast('对齐合成进行中，请稍候'); return; }
        if (AppState.isBuiltin) { toast('内置示例项目只读，请先切换到自己的项目'); return; }
        if (!(await requireCfg())) return;
        const sub = await getAlignSubtitleText();
        if (!sub.ok) { setAlignStatus(sub.message, 'hf-error'); return; }
        const voiceId = alignVoice.value;
        if (!voiceId) { setAlignStatus('请先选择（或创建）音色', 'hf-error'); return; }
        const checked = document.querySelector('input[name="align-mode"]:checked');
        const mode = (checked && checked.value) || 'audio-driven';
        const gapSec = Number(alignGap.value);
        const opt = alignVoice.options[alignVoice.selectedIndex];
        const voiceModel = opt && opt.dataset ? (opt.dataset.model || '') : '';
        alignBusy = true;
        resetAlignUi();
        alignStart.disabled = true;
        alignCancel.style.display = '';
        alignRetry.style.display = 'none';
        hideAlignBar();
        setAlignStatus('正在提交逐句合成任务…', '');
        try {
          const res = await window.voiceTools.synthAligned({
            projectName: AppState.currentName,
            subtitleText: sub.text,
            voice: voiceId,
            voiceModel,
            mode,
            gapSec
          });
          if (res && res.ok) {
            lastAlignResult = res;
            renderAlignResult(res);
            showAlignBar({ text: '对齐完成：' + (res.details || []).length + ' 句', kind: 'done' }, false);
            setAlignStatus(res.message || '对齐完成', 'hf-ok');
          } else if (res && res.canceled) {
            hideAlignBar();
            setAlignStatus((res.message) || '已取消', '');
            toast((res.message) || '已取消');
          } else {
            const msg = (res && res.message) || '对齐合成失败';
            showAlignBar({ text: msg, kind: 'error' }, false);
            setAlignStatus(msg, 'hf-error');
            toast(msg);
          }
        } catch (e) {
          const msg = String((e && e.message) || e);
          showAlignBar({ text: msg, kind: 'error' }, false);
          setAlignStatus(msg, 'hf-error');
        } finally {
          alignBusy = false;
          alignStart.disabled = false;
          alignCancel.style.display = 'none';
          alignRetry.style.display = lastAlignResult ? 'none' : '';
        }
      };

      // 结果明细：汇总行 + 逐句行（序号 / 文本 / 字幕时间 / 音频起点 / 时长 / 状态徽标 / 试听）
      const renderAlignResult = (res) => {
        alignResult.style.display = '';
        if (alignAudio && res.audioPath) {
          alignAudio.src = 'file:///' + encodeURI(String(res.audioPath).replace(/\\/g, '/'));
          alignAudio.load();
        }
        const details = res.details || [];
        const accN = details.filter((d) => d.status === 'accelerated').length;
        const pushN = details.filter((d) => d.status === 'pushed').length;
        alignSummary.textContent = '共 ' + details.length + ' 句 · 总时长 ' + alignFmt(res.totalDur) +
          (accN ? ' · 加速 ' + accN + ' 句' : '') + (pushN ? ' · 顺延 ' + pushN + ' 句' : '') +
          (res.mode === 'audio-driven' ? ' · 字幕时间已按配音重排' : ' · 音频已按字幕时间摆放');
        alignList.innerHTML = '';
        details.forEach((d) => {
          const row = document.createElement('div');
          row.className = 'align-row';
          const badge = d.status === 'accelerated'
            ? '<span class="align-badge warn">加速 x' + Number(d.rate).toFixed(2) + '</span>'
            : d.status === 'pushed'
              ? '<span class="align-badge warn">顺延 +' + Number(d.delta).toFixed(1) + 's</span>'
              : '<span class="align-badge ok">正常</span>';
          const play = d.segPath
            ? '<button type="button" class="hf-btn align-play" data-path="' + escTxt(d.segPath) + '" style="padding:2px 10px;font-size:12px">试听</button>'
            : '';
          row.innerHTML = '<span class="align-idx">' + (d.index + 1) + '</span>' +
            '<span class="align-txt" title="' + escTxt(d.text) + '">' + escTxt(d.text) + '</span>' +
            '<span class="align-time">' + alignFmt(d.subtitleStart) + '</span>' +
            '<span class="align-time">' + alignFmt(d.audioStart) + '</span>' +
            '<span class="align-dur">' + Number(d.audioDur).toFixed(1) + 's</span>' + badge + play;
          alignList.appendChild(row);
        });
      };
      // 逐句试听（事件委托）
      alignList.addEventListener('click', (e) => {
        const btn = e.target.closest('.align-play');
        if (!btn || !alignSegAudio) return;
        alignSegAudio.src = 'file:///' + encodeURI(String(btn.dataset.path || '').replace(/\\/g, '/'));
        alignSegAudio.play().catch(() => toast('该句试听文件已失效（临时目录被清理），可试听整轨'));
      });

      // 写入当前项目：覆盖字幕 + 音频设为背景音频（复用现有 save-subtitle / set-audio）
      const writeAlign = async () => {
        if (!lastAlignResult) { toast('暂无对齐结果'); return; }
        if (AppState.isBuiltin) { toast('内置示例项目只读，请先切换到自己的项目'); return; }
        const r1 = await window.projectTools.saveSubtitle(AppState.currentName, lastAlignResult.subtitleText, '');
        if (!r1 || !r1.ok) { toast((r1 && r1.message) || '字幕写回失败'); return; }
        const r2 = await window.projectTools.setAudio(AppState.currentName, lastAlignResult.audioPath);
        if (!r2 || !r2.ok) { toast((r2 && r2.message) || '音频写回失败'); return; }
        await refreshProject();
        toast('已写入：字幕 ' + (lastAlignResult.details || []).length + ' 条 + 对齐配音 ' + r2.audioFile);
      };

      document.getElementById('align-sub-refresh').addEventListener('click', () => { fillAlignSubSrc(); });
      alignSubSrc.addEventListener('change', syncAlignSubCount);
      // 对齐方式联动：「修正音频」自动按字幕时间间隔补静音，无需手写停顿 → 隐藏句间停顿行；说明文案按模式切换
      const syncGapRow = () => {
        const checked = document.querySelector('input[name="align-mode"]:checked');
        const mode = (checked && checked.value) || 'audio-driven';
        if (alignGapRow) alignGapRow.style.display = (mode === 'timeline-driven') ? 'none' : '';
        const tipA = document.getElementById('align-tip-audio');
        const tipT = document.getElementById('align-tip-timeline');
        if (tipA) tipA.style.display = (mode === 'audio-driven') ? '' : 'none';
        if (tipT) tipT.style.display = (mode === 'timeline-driven') ? '' : 'none';
      };
      document.querySelectorAll('input[name="align-mode"]').forEach((r) => r.addEventListener('change', syncGapRow));
      syncGapRow();
      document.getElementById('align-voice-refresh').addEventListener('click', async () => { if (await requireCfg()) fillVoiceSelect(alignVoice, alignStatus); });
      alignStart.addEventListener('click', startAlign);
      alignRetry.addEventListener('click', startAlign);
      alignCancel.addEventListener('click', () => {
        window.voiceTools.cancelAlign();
        setAlignStatus('正在取消（当前句完成后停止）…', '');
      });
      document.getElementById('align-open-dir').addEventListener('click', () => {
        if (lastAlignResult && lastAlignResult.audioPath) window.projectTools.openFolderOf(lastAlignResult.audioPath);
      });
      document.getElementById('align-write').addEventListener('click', writeAlign);

      fillSaveTo();
      (async () => {
        if (await requireCfg()) { fillSaveTo(); fillVoiceSelect(voiceSel, status); fillGenAudios(true); }
      })();
      fillAlignSubSrc();
      (async () => { if (await requireCfg()) fillVoiceSelect(alignVoice, alignStatus); })();
    }
  };
})();
