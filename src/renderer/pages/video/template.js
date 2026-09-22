// renderer/pages/video/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['video-gen'] = `<div class="project-bar" data-slot></div>
<div class="card hf-page" style="margin-top:16px">
  <div class="hf-toolbar">
    <button class="hf-btn" data-hf="open">选择 HTML 文件</button>
    <span class="hf-file" id="hf-file">未选择文件</span>
    <button class="hf-btn hf-btn-primary" data-hf="render" disabled>HyperFrames 转视频</button>
  </div>
  <div class="hf-status" id="hf-status"></div>
  <iframe class="hf-frame" id="hf-frame" sandbox="allow-scripts allow-same-origin"></iframe>
  <div class="hf-video-wrap" id="hf-video-wrap" hidden>
    <video class="hf-video" id="hf-video" controls></video>
    <div class="hf-video-actions">
      <button class="hf-btn" data-hf="show-folder">在文件夹中显示</button>
    </div>
  </div>
</div>`;
