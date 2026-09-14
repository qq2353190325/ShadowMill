// renderer/pages/video.js —— HTML 预览 / 视频生成（两页共用预览与转视频逻辑）
(function () {
  'use strict';

  const { AppState, goPage, refreshProject, renderStepBar, switchProject, toast } = window.App;
  const content = document.getElementById('content');

  // 当前预览的 HTML 路径与最近渲染出的视频（页面级共享状态）
  let hfHtmlPath = null;
  let lastVideoPath = null;

  function fillProjSelect(sel) {
    sel.innerHTML = '';
    const my = document.createElement('optgroup');
    my.label = '我的项目';
    AppState.myProjects.forEach((p) => {
      const o = document.createElement('option');
      o.value = 'my:' + p.name;
      o.textContent = p.name + (p.hasHtml ? ' · HTML✓' : '') + (p.hasVideo ? ' · 视频✓' : '');
      my.appendChild(o);
    });
    sel.appendChild(my);
    const bi = document.createElement('optgroup');
    bi.label = '内置示例';
    AppState.builtinProjects.forEach((b) => {
      const o = document.createElement('option');
      o.value = 'builtin:' + b.name;
      o.textContent = b.name + ' · 内置';
      bi.appendChild(o);
    });
    sel.appendChild(bi);
    sel.value = (AppState.isBuiltin ? 'builtin:' : 'my:') + AppState.currentName;
  }

  function initHfPage(page) {
    renderStepBar(page);
    const el = content.querySelector('.hf-page');
    if (!el) return;
    // 修复：项目选择器（#proj-select / #proj-file / #btn-openfolder）位于 .project-selector 中，
    // 它是 .card.hf-page 的兄弟节点而非子节点，必须从 content 作用域查询；否则为 null 会中断本页初始化。
    const fileEl = el.querySelector('#hf-file');
    const projFileEl = content.querySelector('#proj-file');
    const statusEl = el.querySelector('#hf-status');
    const btnOpen = el.querySelector('[data-hf="open"]');
    const btnRender = el.querySelector('[data-hf="render"]');
    const btnRefresh = el.querySelector('[data-hf="refresh"]');
    const frame = el.querySelector('#hf-frame');
    const videoWrap = el.querySelector('#hf-video-wrap');
    const videoEl = el.querySelector('#hf-video');
    const btnShowFolder = el.querySelector('[data-hf="show-folder"]');
    const sel = content.querySelector('#proj-select');
    const btnOpenFolder = content.querySelector('#btn-openfolder');
    hfHtmlPath = null;
    lastVideoPath = null;

    statusEl.textContent = '';
    statusEl.classList.remove('hf-error', 'hf-ok');
    fileEl.textContent = '未选择文件';
    if (projFileEl) projFileEl.textContent = AppState.project.name || '未选择';
    btnRender.disabled = true;
    if (btnRefresh) btnRefresh.disabled = true;
    if (videoWrap && videoEl) {
      videoWrap.hidden = true;
      videoEl.removeAttribute('src');
      videoEl.load();
    }
    if (frame) frame.removeAttribute('src');

    const setHtml = async (p) => {
      hfHtmlPath = p;
      fileEl.textContent = p;
      let src = null;
      try {
        // 优先经"预览外壳"加载：外壳在目标 HTML 同目录、内部使用本地 hyperframes-player
        // 组件，提供播放条（controls）与等比缩放，避免直接落地 iframe 导致无进度条、内容被裁剪。
        if (window.hfTools && typeof window.hfTools.previewShell === 'function') {
          const res = await window.hfTools.previewShell(p);
          if (res && res.ok && res.shellPath) {
            src = 'file:///' + encodeURI(res.shellPath.replace(/\\/g, '/'));
          }
        }
      } catch (e) { src = null; }
      if (frame) {
        frame.src = src || ('file:///' + encodeURI(p.replace(/\\/g, '/')));
        statusEl.textContent = '已加载预览';
        statusEl.classList.add('hf-ok');
      }
      btnRender.disabled = false;
      if (btnRefresh) btnRefresh.disabled = false;
    };

    // 项目选择
    if (sel) {
      fillProjSelect(sel);
      sel.addEventListener('change', async () => {
        const v = sel.value;
        if (!v) return;
        const isBuiltin = v.startsWith('builtin:');
        const name = v.slice(isBuiltin ? 8 : 3);
        await switchProject(name, isBuiltin);
        await goPage(page);
      });
    }
    if (btnOpenFolder) {
      btnOpenFolder.addEventListener('click', () => {
        if (AppState.isBuiltin) {
          if (AppState.project.htmlPath) {
            window.projectTools.openFolderOf(AppState.project.htmlPath);
          } else {
            toast('内置示例项目为只读；可在「HTML 生成」页切换到「我的项目」');
          }
          return;
        }
        window.projectTools.openFolder(AppState.currentName);
      });
    }

    // 联动“已生成”状态：未生成 HTML 时给出引导提示，但仍保留手动预览能力
    if (!AppState.project.htmlExists) {
      statusEl.textContent = '该项目尚未生成 HTML，请先在「HTML 生成」页生成；也可以点击“选择 HTML 文件”手动预览。';
    }

    // 当前项目已有 HTML → 自动加载预览
    if (AppState.project.htmlExists) {
      setHtml(AppState.project.htmlPath);
    }

    btnOpen.addEventListener('click', async () => {
      const p = await window.hfTools.openHtml();
      if (p) setHtml(p);
    });

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        // 走 setHtml 统一入口，刷新后仍保持播放外壳（进度条/等比缩放）
        if (hfHtmlPath) setHtml(hfHtmlPath);
      });
    }

    if (btnShowFolder) {
      btnShowFolder.addEventListener('click', () => {
        if (lastVideoPath) window.hfTools.showInFolder(lastVideoPath);
      });
    }

    btnRender.addEventListener('click', async () => {
      if (!hfHtmlPath) return;
      statusEl.textContent = '渲染中，请稍候（约 30 秒）...';
      statusEl.classList.remove('hf-error', 'hf-ok');
      btnRender.disabled = true;
      const res = await window.hfTools.renderVideo(hfHtmlPath);
      btnRender.disabled = false;
      if (res.ok) {
        lastVideoPath = res.outputVideo;
        statusEl.textContent = '渲染完成：' + res.outputVideo;
        statusEl.classList.add('hf-ok');
        // 回写视频产物到当前项目（我的项目）
        if (!AppState.isBuiltin) {
          await window.projectTools.saveVideo(AppState.currentName, res.outputVideo);
          await refreshProject();
          renderStepBar(page);
        }
        if (videoWrap && videoEl) {
          videoEl.src = 'file:///' + encodeURI(res.outputVideo.replace(/\\/g, '/'));
          videoWrap.hidden = false;
          videoEl.load();
        }
      } else {
        statusEl.textContent = res.message || '渲染失败';
        statusEl.classList.add('hf-error');
      }
    });
  }

  // ===== HTML 预览页模板 =====
  App.pages['html-preview'] = {
    html: `<div class="project-bar" data-slot></div>
<div class="project-selector">
  <span class="sel-label">工作项目</span>
  <select id="proj-select" class="hf-select"></select>
  <span class="hf-file" id="proj-file">未选择</span>
  <button class="hf-btn" id="btn-openfolder" disabled>打开目录</button>
</div>
<div class="card hf-page" style="margin-top:16px">
  <div class="hf-toolbar">
    <button class="hf-btn" data-hf="open">选择 HTML 文件</button>
    <span class="hf-file" id="hf-file">未选择文件</span>
    <button class="hf-btn" data-hf="refresh" disabled>刷新</button>
    <button class="hf-btn hf-btn-primary" data-hf="render" disabled>转为视频</button>
  </div>
  <div class="hf-status" id="hf-status"></div>
  <iframe class="hf-frame" id="hf-frame" sandbox="allow-scripts allow-same-origin"></iframe>
</div>`,
    init: function () { initHfPage('html-preview'); }
  };

  // ===== 视频生成页模板 =====
  App.pages['video-gen'] = {
    html: `<div class="project-bar" data-slot></div>
<div class="project-selector">
  <span class="sel-label">工作项目</span>
  <select id="proj-select" class="hf-select"></select>
  <span class="hf-file" id="proj-file">未选择</span>
  <button class="hf-btn" id="btn-openfolder" disabled>打开目录</button>
</div>
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
</div>`,
    init: function () { initHfPage('video-gen'); }
  };
})();
