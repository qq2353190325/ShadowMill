// renderer/pages/home/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['home'] = `<section class="hero">
  <span class="hero-tag">CYBER UI · 深空科技</span>
  <h1>一站式音视频创作流水线</h1>
  <p>以“项目”为单位贯通：内容脚本 → 配音 → 字幕 → HTML → 视频，一键生成。</p>
</section>
<div class="flow-pipeline" id="home-flow"></div>
<div class="metric-grid">
  <div class="metric-card"><div class="metric-value">5+</div><div class="metric-label">支持音频格式</div></div>
  <div class="metric-card"><div class="metric-value">1080P</div><div class="metric-label">导出分辨率</div></div>
  <div class="metric-card"><div class="metric-value">5</div><div class="metric-label">项目链路节点</div></div>
  <div class="metric-card"><div class="metric-value">MP4</div><div class="metric-label">视频输出格式</div></div>
</div>`;

// renderer/pages/home/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['about'] = `<div class="card hgen-panel" style="max-width:720px">
  <div class="panel-title"><span class="dot"></span>关于</div>
  <div class="hgen-tip">一站式音视频创作流水线：以「项目」为单位贯通 内容脚本 → 配音 → 字幕 → HTML → 视频 五个创作节点，在本地完成从脚本到成片的完整流程。</div>
  <div class="hgen-row">
    <span class="sel-label" style="flex:none;width:auto">问题反馈</span>
    <span class="hf-file" style="flex:1">使用中遇到问题或有建议，欢迎邮件联系：<b>2353190325@qq.com</b></span>
  </div>
  <div class="hgen-row">
    <span class="sel-label" style="flex:none;width:auto">项目数据</span>
    <span class="hf-file" style="flex:1">项目保存在本机 video-projects 目录，每个项目一个文件夹（audio/ 音频、video/ 素材与成品、project.json 元数据），全部本地留存。</span>
  </div>
</div>`;
