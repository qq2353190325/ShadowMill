// renderer/pages/home.js —— 首页（hero + 动态流水线 + 内置示例快捷入口）+ about 静态页
(function () {
  'use strict';

  const {
    AppState, escTxt, goPage, hasSubtitle, hasHtml, hasVideo, hasContent, hasAudio, switchProject
  } = window.App;

  // ===== 首页模板 =====
  App.pages.home = {
    html: `<section class="hero">
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
</div>`,
    // 首页：动态流水线（反映当前项目状态，可点击跳转）
    init: function () {
      const flow = document.getElementById('home-flow');
      if (!flow) return;
      const p = AppState.project || {};
      const defs = [
        { idx: '01', t: '内容脚本', d: '编写旁白与画面分镜，定义全局风格', page: 'content', done: hasContent() },
        { idx: '02', t: '配音', d: '由脚本旁白合成为自然语音', page: 'text-tts', done: hasAudio() },
        { idx: '03', t: '字幕', d: '由旁白派生对齐的同步字幕', page: 'subtitle', done: hasSubtitle() },
        { idx: '04', t: 'HTML生成', d: '由脚本整体生成精美的 HTML 动画', page: 'html-gen', done: hasHtml() },
        { idx: '05', t: '转成视频', d: '合并素材，导出最终视频成品', page: 'video-gen', done: hasVideo() }
      ];
      flow.innerHTML = defs.map((n, i) =>
        '<div class="flow-node ' + (n.done ? 'flow-done' : '') + '" data-page="' + n.page + '" style="cursor:pointer">' +
        '<span class="flow-node-index">' + n.idx + '</span><h3>' + n.t + '</h3><p>' + n.d + '</p>' +
        (n.done ? '<span class="flow-badge">已完成</span>' : '') +
        '</div>' + (i < defs.length - 1 ? '<i class="flow-arrow">→</i>' : '')
      ).join('');
      flow.querySelectorAll('.flow-node[data-page]').forEach((el) => {
        el.addEventListener('click', () => goPage(el.dataset.page));
      });

      // 我的项目入口：列表 + 新建（第一步：创建 / 选择自己的项目）
      let myHost = document.getElementById('my-section');
      if (!myHost) {
        myHost = document.createElement('div');
        myHost.id = 'my-section';
        myHost.style.cssText = 'margin-top:var(--space-5);';
        flow.insertAdjacentElement('afterend', myHost);
      }
      myHost.innerHTML =
        '<div class="panel-title"><span class="dot"></span>我的项目</div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<input id="my-new-name" class="hgen-input" style="flex:1" placeholder="新项目名，回车或点新建"/>' +
        '<button class="hf-btn hf-btn-primary" id="my-new-btn" style="flex:none">新建项目</button>' +
        '</div>' +
        (AppState.myProjects.length
          ? '<div class="builtin-grid" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">' +
            AppState.myProjects.map((p, i) =>
              '<div class="my-card" data-i="' + i + '" title="打开项目 ' + escTxt(p.name) + '" style="flex:1;min-width:200px;padding:14px 16px;border:1px solid rgba(0,212,255,.35);border-radius:10px;background:linear-gradient(105deg,rgba(0,212,255,.10),rgba(139,92,246,.10));cursor:pointer;">' +
              '<b style="color:#00D4FF;">' + escTxt(p.title || p.name) + '</b>' +
              '<div style="margin-top:var(--space-1);font-size:12px;color:var(--text-secondary,#8CA3C7);">' +
              (p.hasHtml ? 'HTML✓ ' : '') + (p.hasVideo ? '视频✓ ' : '') + (p.hasSubtitle ? '字幕✓' : '') +
              '</div></div>'
            ).join('') + '</div>'
          : '<div class="builtin-empty" style="color:var(--text-secondary,#8CA3C7);font-size:13px;margin-top:12px;">暂无项目，在上方输入名称新建一个（也可先点下方内置示例体验流程）。</div>');
      myHost.querySelectorAll('.my-card').forEach((c) => {
        c.addEventListener('click', () => {
          const p = AppState.myProjects[Number(c.getAttribute('data-i'))];
          if (!p) return;
          switchProject(p.name, false).then(() => goPage('html-preview'));
        });
      });
      const myNameEl = document.getElementById('my-new-name');
      const myBtn = document.getElementById('my-new-btn');
      const doCreateMy = async () => {
        const nm = myNameEl.value.trim();
        if (!nm) { toast('请输入项目名'); myNameEl.focus(); return; }
        const res = await window.projectTools.create(nm);
        if (!res || !res.ok) { toast((res && res.message) || '创建失败'); return; }
        myNameEl.value = '';
        await refreshProject();
        await switchProject(nm, false);
        await goPage('home');
        toast('已创建并切换到项目「' + nm + '」');
      };
      if (myBtn && myNameEl) {
        myBtn.addEventListener('click', doCreateMy);
        myNameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreateMy(); });
      }

      // 内置示例快捷入口：点击即选中该内置项目并进入「HTML 预览」页（可预览 / 转视频，产物不回写项目目录）
      let biHost = document.getElementById('builtin-section');
      if (!biHost) {
        biHost = document.createElement('div');
        biHost.id = 'builtin-section';
        biHost.style.cssText = 'margin-top:var(--space-5);';
        myHost.insertAdjacentElement('afterend', biHost);
      }
      if (!AppState.builtinProjects.length) {
        biHost.innerHTML = '<div class="builtin-empty" style="color:var(--text-secondary,#8CA3C7);font-size:13px;">暂无内置示例项目</div>';
      } else {
        biHost.innerHTML =
          '<div class="panel-title"><span class="dot"></span>内置示例<b style="font-weight:500;color:var(--text-secondary,#8CA3C7);font-size:12px;margin-left:8px;">只读 · 可预览 / 转视频</b></div>' +
          '<div class="builtin-grid" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">' +
          AppState.builtinProjects.map((b, i) =>
            '<div class="builtin-card" data-i="' + i + '" title="打开内置示例 ' + escTxt(b.name) + '" style="flex:1;min-width:200px;padding:14px 16px;border:1px solid rgba(0,212,255,.35);border-radius:10px;background:linear-gradient(105deg,rgba(0,212,255,.10),rgba(139,92,246,.10));cursor:pointer;transition:transform .15s ease, box-shadow .15s ease;">' +
            '<b style="color:#00D4FF;">' + escTxt(b.title) + '</b>' +
            '<div style="margin-top:var(--space-1);font-size:12px;color:var(--text-secondary,#8CA3C7);">点击打开预览 / 转视频</div>' +
            '</div>'
          ).join('') + '</div>';
        biHost.querySelectorAll('.builtin-card').forEach((c) => {
          c.addEventListener('click', () => {
            const b = AppState.builtinProjects[Number(c.getAttribute('data-i'))];
            if (!b) return;
            switchProject(b.name, true).then(() => goPage('html-preview'));
          });
        });
      }
    }
  };

  // ===== 关于页（纯静态模板，无逻辑） =====
  App.pages.about = {
    html: '<h1>关于</h1><p>这是一个基于 Electron 的项目。</p>'
  };
})();
