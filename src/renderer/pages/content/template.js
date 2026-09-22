// renderer/pages/content/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['content'] = `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>内容脚本 · 全局视觉风格</div>
  <div class="hgen-row">
    <label class="sel-label" style="flex:none;width:auto">风格</label>
    <input id="ct-style" class="hgen-input" style="flex:1" placeholder="全局视觉风格描述，将作用于后续配音 / 字幕 / HTML 生成的整体观感，如：深空科技 Cyber 风、霓虹紫渐变、粒子背景"/>
  </div>
  <div class="hgen-tip">描述整支视频的视觉基调。留空 = 未指定，后续节点将按各自提示生成。</div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>场景分镜（旁白 + 画面分镜 + 时长提示）</div>
  <div id="ct-scenes"></div>
  <div class="hgen-actions">
    <button class="hf-btn" id="ct-add">添加场景</button>
    <button class="hf-btn hf-btn-primary" id="ct-save">保存到项目</button>
  </div>
  <div class="hgen-tip">场景按顺序播放：<code>旁白</code> 将作为配音文本、并派生字幕；<code>画面分镜</code> 描述该场景对应的视觉画面（供 HTML 生成引用）；<code>时长提示</code>（秒）可空。保存后项目链路「内容脚本」节点自动点亮。已有项目无内容脚本时默认展示一个空场景。</div>
</div>`;
