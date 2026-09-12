// renderer/pages/subtitle.js —— 字幕生成页（编辑字幕 + 保存到项目 + 保存并生成 HTML）
(function () {
  'use strict';

  const { AppState, renderStepBar, toast, refreshProject, goPage } = window.App;

  App.pages.subtitle = {
    html: `<div class="project-bar" data-slot></div>
<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>编辑字幕文本</div>
  <textarea id="sub-editor" class="hgen-subtitle" spellcheck="false" placeholder="每行一条字幕。支持两种格式：&#10;1) 纯文本行 —— 自动按语速估算时长&#10;2) [分:秒] 文本 —— 指定时间轴（转视频后精确对齐）&#10;示例：&#10;[00:00] 大家好&#10;[00:05] 欢迎来到深空科技&#10;[00:12] 我们一起用字幕生成 HTML 和视频"></textarea>
  <div class="hgen-row">
    <label class="sel-label">页面标题</label>
    <input id="sub-title" class="hgen-input" style="flex:1" placeholder="字幕动画标题，如：我的第一个字幕动画"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn" id="sub-save">保存到项目</button>
    <button class="hf-btn hf-btn-primary" id="sub-tohtml">保存并生成 HTML</button>
  </div>
  <div class="hgen-tip">带时间戳格式：<code>[00:05] 文本</code>，分钟:秒；两种格式可混用。保存后项目链路「字幕」节点自动点亮。</div>
</div>`,
    // 字幕生成页
    init: function () {
      renderStepBar('subtitle');
      if (AppState.isBuiltin) {
        toast('当前是内置示例项目（只读），请切换到自己的项目来编辑字幕');
      }
      const editor = document.getElementById('sub-editor');
      const title = document.getElementById('sub-title');
      if (!editor) return;
      editor.value = AppState.project.subtitle || '';
      title.value = (AppState.project.title && AppState.project.title !== '字幕动画') ? AppState.project.title : '';

      const doSave = async (goHtml) => {
        if (AppState.isBuiltin) { toast('内置项目只读，请先切换到自己的项目'); return; }
        const text = editor.value;
        const t = title.value.trim();
        if (!text.trim()) { toast('字幕内容为空，请先输入'); return; }
        const res = await window.projectTools.saveSubtitle(AppState.currentName, text, t);
        if (!res.ok) { toast(res.message || '保存失败'); return; }
        await refreshProject();
        toast('字幕已保存：共 ' + res.project.subtitleCount + ' 条');
        if (goHtml) goPage('html-gen');
      };
      document.getElementById('sub-save').addEventListener('click', () => doSave(false));
      document.getElementById('sub-tohtml').addEventListener('click', () => doSave(true));
    }
  };
})();
