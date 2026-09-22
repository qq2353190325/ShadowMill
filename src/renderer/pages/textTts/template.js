// renderer/pages/textTts/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['text-tts'] = `<div class="project-bar" data-slot></div>
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
</div>`;
