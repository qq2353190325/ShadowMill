// renderer/pages/soundCopy/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['sound-copy'] = `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>音色管理 · 创建克隆音色</div>
  <div class="hgen-tip">选择目标模型并上传/粘贴人声音频，即可创建克隆音色。创建时选定的模型会绑定到该音色，后续用该音色合成时自动沿用同一模型（创建计费 0.01 元/个）：<br/>· Qwen-Audio-TTS（qwen-audio-3.0-tts-flash）：粘贴一段 10~20 秒清晰人声的<b>可公开访问音频 URL</b>（该模型克隆不接受本地文件直传）；<br/>· qwen3-tts-vc-* 系列：上传本地音频文件（.wav / .mp3 / .m4a，Base64 后需小于 10 MB）。</div>
  <div class="hgen-row">
    <label class="sel-label">显示名称</label>
    <input id="vc-name" class="hgen-input" style="flex:1" placeholder="给音色起个名字，支持中文，如：旁白"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">目标模型</label>
    <select id="vc-model" class="hgen-select" style="flex:1"></select>
  </div>
  <div class="hgen-row" id="vc-file-row">
    <button class="hf-btn" id="vc-pick">选择音频文件</button>
    <span class="hf-file" id="vc-file">未选择文件</span>
  </div>
  <div class="hgen-row" id="vc-url-row" style="display:none">
    <label class="sel-label">音频 URL</label>
    <input id="vc-url" class="hgen-input" style="flex:1" placeholder="https://...（可公开访问的音频文件地址，如 .wav / .mp3 / .m4a）"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="vc-create">创建音色</button>
    <button class="hf-btn" id="vc-to-settings">API Key 设置</button>
  </div>
  <div class="hf-status" id="vc-status"></div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>我的音色</div>
  <div class="hf-status" id="vc-list-status"></div>
  <div id="vc-list" class="hgen-tip">点击「刷新音色列表」从千问AI平台拉取已创建的克隆音色。</div>
  <div class="hgen-actions">
    <button class="hf-btn" id="vc-refresh">刷新音色列表</button>
  </div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>音色映射管理</div>
  <div class="hgen-tip">为任意音色（系统音色 / 克隆音色）设置本地中文显示名与合成模型。显示名与模型仅保存在本机 settings.json；系统音色不传中文名时使用默认描述，不选模型时使用该音色默认合成模型。</div>
  <div class="hgen-row">
    <label class="sel-label">音色</label>
    <select id="vc-map-voice" class="hgen-select" style="flex:1"></select>
  </div>
  <div class="hgen-row">
    <label class="sel-label">显示名称</label>
    <input id="vc-map-name" class="hgen-input" style="flex:1" placeholder="中文显示名，留空则使用默认（系统音色用内置描述，克隆音色用其 ID）"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">合成模型</label>
    <select id="vc-map-model" class="hgen-select" style="flex:1"></select>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="vc-map-save">保存映射</button>
    <button class="hf-btn" id="vc-map-clear">解除映射</button>
  </div>
  <div class="hf-status" id="vc-map-status"></div>
</div>`;
