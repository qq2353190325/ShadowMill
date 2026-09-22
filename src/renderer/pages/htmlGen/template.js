// renderer/pages/htmlGen/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['html-gen'] = `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>HTML · Agent 生成 / 修改</div>
  <div class="proj-meta" id="hg-meta"></div>
  <div class="hgen-block">
    <div class="panel-title-sm">需求描述（提示词）</div>
    <textarea id="hg-prompt" class="hgen-subtitle" spellcheck="false" placeholder="描述你想要的 HTML 效果，例如：&#10;· 深空科技风格的标题动画页，标题为“我的作品集”&#10;· 每条字幕间隔两秒，依次从下方上浮淡入&#10;· 修改时：换成紫色霓虹配色，并把标题放大"></textarea>
  </div>
  <div class="hgen-block">
    <div class="panel-title-sm">项目素材（均可选，留空则跳过）</div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">字幕</span>
      <select id="hg-sub-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪份字幕逐条设计动画"></select>
    </div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">背景音频</span>
      <select id="hg-audio-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪份音频作为音轨注入"></select>
    </div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">视频素材</span>
      <select id="hg-video-list" class="hgen-select" style="flex:1" title="生成/修改时选用哪个视频片段嵌入页面"></select>
    </div>
    <div class="hgen-tip">生成 / 修改 HTML 时使用所选素材：字幕逐条设计动画、音频作为音轨注入、视频作为页面片段嵌入。留空 = 跳过对应素材，仅按需求描述生成。项目里还没有的素材，可在下方「自定义素材」导入。</div>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="hg-gen">生成 HTML</button>
    <button class="hf-btn" id="hg-mod" title="基于当前 HTML 按项目需求修改并覆盖">修改 HTML</button>
    <button class="hf-btn" id="hg-download" title="下载当前项目 HTML 到本地">下载 HTML</button>
  </div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>自定义素材 · 导入为项目素材（可选）</div>
  <div class="panel-title-sm" style="margin-top:0">背景音频</div>
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
  <div class="hgen-tip">本地音频或已生成 TTS 音频设为当前项目背景音频（自动复制进项目 audio/ 目录），即可在上方「项目素材」下拉选用，生成 / 修改时注入为音轨：预览即可听，转视频自动混入。</div>
  <div class="panel-title-sm" style="margin-top:20px">视频素材</div>
  <div class="hgen-row">
    <button class="hf-btn" id="hg-pick-video">选择视频文件</button>
    <span class="hf-file" id="hg-video-name">未设置视频</span>
    <button class="hf-btn" id="hg-clear-video" disabled>移除视频</button>
    <button class="hf-btn" id="hg-extract-audio" disabled title="从当前视频素材提取原声音轨（mp4 → m4a），自动设为项目背景音频">提取原声为背景音频</button>
  </div>
  <div class="hgen-row" id="hg-video-prev-row" style="display:none">
    <video id="hg-video-prev" controls style="flex:1;max-height:200px;border-radius:8px;background:#000"></video>
  </div>
  <div class="hgen-tip">本地视频设为当前项目视频素材（自动复制进项目 video/ 目录），即可在上方「项目素材」下拉选用：Agent 自动以 &lt;video&gt; 引入（静音自动播放，保证转视频时可渲染）并用 GSAP 编排播放时段。如需视频原声，点「提取原声为背景音频」把其音轨提取为项目背景音频（保留原声路线）。</div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>预览</div>
  <div class="hf-status" id="hg-status"></div>
  <div id="hg-think-wrap" style="display:none;margin-top:10px;padding:10px 12px;border:1px solid rgba(0,212,255,.22);border-radius:8px;background:rgba(0,212,255,.05)">
    <div style="font-size:12px;color:#00D4FF;margin-bottom:6px">AI 思考过程（实时）</div>
    <pre id="hg-think" style="margin:0;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;font-size:12px;line-height:1.7;color:rgba(255,255,255,.82)"></pre>
  </div>
  <div class="empty-hint" id="hg-empty">尚未生成 HTML。</div>
  <iframe class="hgen-frame" id="hg-frame" style="display:none" sandbox="allow-scripts allow-same-origin"></iframe>
  <div class="hg-prev-ctl" id="hg-prev-ctl" style="display:none">
    <button class="hf-btn" id="hg-prev-toggle" title="暂停 / 继续播放动画" style="padding:4px 14px;font-size:12px">暂停</button>
    <button class="hf-btn" id="hg-prev-replay" title="从头重新播放" style="padding:4px 14px;font-size:12px">重新播放</button>
    <div class="hg-prev-bar"><div class="hg-prev-bar-fill" id="hg-prev-fill"></div></div>
    <span class="hg-prev-time" id="hg-prev-time">0:00 / 0:00</span>
  </div>
</div>`;
