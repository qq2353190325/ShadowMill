// renderer/pages/content.js —— 内容脚本页（方案B：脚本 → 配音/字幕/HTML）
// 编辑全局视觉风格 + 场景分镜列表（每条：旁白 narration / 画面分镜 visual / 时长提示 durHint）
// 保持字幕 / HTML 生成逻辑不变，本页仅搭建「内容脚本」数据层的编辑与保存骨架。
(function () {
  'use strict';

  const { AppState, escTxt, renderStepBar, toast, refreshProject } = window.App;

  // 场景条目分隔：避免编号错乱（删除后按数组下标重排）
  let scenes = [];

  App.pages.content = {
    html: `<div class="project-bar" data-slot></div>
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
</div>`,
    // 内容脚本页
    init: function () {
      renderStepBar('content');
      if (AppState.isBuiltin) {
        toast('当前是内置示例项目（只读），请切换到自己的项目来编辑内容脚本');
      }
      const host = document.getElementById('ct-scenes');
      const styleEl = document.getElementById('ct-style');
      if (!host || !styleEl) return;

      // 载入当前项目 content（向后兼容：无 content 视为空）
      const content = AppState.project.content || { style: '', scenes: [] };
      styleEl.value = content.style || '';
      scenes = (Array.isArray(content.scenes) ? content.scenes : []).map((s) => {
        const item = (s && typeof s === 'object') ? s : {};
        return {
          id: (typeof item.id === 'string' && item.id.trim()) ? item.id.trim() : ('scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)),
          narration: typeof item.narration === 'string' ? item.narration : '',
          visual: typeof item.visual === 'string' ? item.visual : '',
          durHint: (item.durHint === undefined || item.durHint === null) ? '' : String(item.durHint)
        };
      });
      if (!scenes.length) scenes.push(emptyScene());

      const render = () => {
        if (!host) return;
        if (!scenes.length) {
          host.innerHTML = '<div class="empty-hint">暂无场景。点击「添加场景」开始编写内容脚本。</div>';
          return;
        }
        host.innerHTML = scenes.map((s, i) => {
          const dur = s.durHint || '';
          return '<div class="hgen-block ct-scene" data-i="' + i + '" style="border:1px solid rgba(0,212,255,.15);border-radius:10px;padding:14px 16px;margin-top:12px;background:rgba(0,212,255,.03);">' +
            '<div class="panel-title-sm">场景 #' + (i + 1) + '</div>' +
            '<div class="hgen-row"><label class="sel-label" style="flex:none;width:auto">旁白</label>' +
            '<textarea class="hgen-subtitle ct-narration" spellcheck="false" style="height:84px" placeholder="该场景的旁白/配音文本，字幕将据此生成…">' + escTxt(s.narration) + '</textarea></div>' +
            '<div class="hgen-row"><label class="sel-label" style="flex:none;width:auto">画面分镜</label>' +
            '<textarea class="hgen-subtitle ct-visual" spellcheck="false" style="height:64px" placeholder="描述该场景呈现的画面，如：深空背景，标题从上方浮入…">' + escTxt(s.visual) + '</textarea></div>' +
            '<div class="hgen-row">' +
            '<label class="sel-label" style="flex:none;width:auto">时长提示(秒)</label>' +
            '<input class="hgen-input ct-dur" style="flex:none;width:110px" placeholder="可空" value="' + String(escTxt(dur)).replace(/"/g, '&quot;') + '"/>' +
            '<button class="hf-btn ct-up" style="padding:6px 12px;font-size:12px"' + (i === 0 ? ' disabled' : '') + '>上移</button>' +
            '<button class="hf-btn ct-down" style="padding:6px 12px;font-size:12px"' + (i === scenes.length - 1 ? ' disabled' : '') + '>下移</button>' +
            '<button class="hf-btn ct-del" style="padding:6px 12px;font-size:12px;color:#ff5470;border-color:rgba(255,84,112,.5)">删除</button>' +
            '</div></div>';
        }).join('');
      };

      // 收集当前 DOM 输入回写到 scenes 数组
      const collect = () => {
        scenes = scenes.map((s, i) => {
          const box = host.querySelector('.ct-scene[data-i="' + i + '"]');
          if (!box) return s;
          const narr = box.querySelector('.ct-narration');
          const vis = box.querySelector('.ct-visual');
          const dur = box.querySelector('.ct-dur');
          return {
            id: s.id,
            narration: narr ? narr.value : s.narration,
            visual: vis ? vis.value : s.visual,
            durHint: dur ? dur.value.trim() : s.durHint
          };
        });
      };

      host.addEventListener('click', (e) => {
        const up = e.target.closest('.ct-up');
        const down = e.target.closest('.ct-down');
        const del = e.target.closest('.ct-del');
        if (!up && !down && !del) return;
        const box = e.target.closest('.ct-scene');
        if (!box) return;
        const i = Number(box.getAttribute('data-i'));
        if (up && i > 0) { collect(); const t = scenes[i]; scenes[i] = scenes[i - 1]; scenes[i - 1] = t; render(); }
        else if (down && i < scenes.length - 1) { collect(); const t = scenes[i]; scenes[i] = scenes[i + 1]; scenes[i + 1] = t; render(); }
        else if (del) { collect(); scenes.splice(i, 1); if (!scenes.length) scenes.push(emptyScene()); render(); }
      });
      document.getElementById('ct-add').addEventListener('click', () => {
        collect(); scenes.push(emptyScene()); render();
      });
      document.getElementById('ct-save').addEventListener('click', async () => {
        if (AppState.isBuiltin) { toast('内置项目只读，请先切换到自己的项目'); return; }
        collect();
        const content = { style: styleEl.value.trim(), scenes: scenes.map((s) => ({ id: s.id, narration: s.narration, visual: s.visual, durHint: s.durHint })) };
        const res = await window.projectTools.saveContent(AppState.currentName, content);
        if (!res || !res.ok) { toast((res && res.message) || '保存失败'); return; }
        await refreshProject();
        toast('内容脚本已保存：' + scenes.length + ' 个场景' + (content.style ? '，风格「' + content.style + '」' : ''));
        renderStepBar('content');
      });

      render();
    }
  };

  function emptyScene() {
    return { id: 'scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), narration: '', visual: '', durHint: '' };
  }
})();
