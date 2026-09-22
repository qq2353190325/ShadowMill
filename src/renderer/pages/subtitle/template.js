// renderer/pages/subtitle/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['subtitle'] = `<div class="project-bar" data-slot></div>

<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>字幕编辑器</div>
  <div class="hgen-tip">逐条编辑字幕：序号 / 起始时间 / 结束时间 / 文本，可删除与新增；也可切「SRT」模式用单个文本域按标准 SRT 格式编辑（序号 / 时间轴 / 文本）。还可由音频自动识别，或由内容脚本旁白生成初稿。字幕时间轴以下方的「起始时间」为准。</div>
  <div class="hgen-actions" style="margin-top:var(--space-4)">
    <button class="hf-btn hf-btn-primary" id="sub-open-tw">从音频生成字幕</button>
    <button class="hf-btn" id="sub-from-content" title="依据内容脚本的场景旁白与时长提示生成逐条字幕，覆盖当前条目">由脚本旁白生成</button>
  </div>
</div>

<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>字幕条目</div>
  <div class="hgen-row" style="margin-top:var(--space-3)">
    <span class="sel-label">写入方式</span>
    <button class="hf-btn sub-mode-btn active" id="sub-mode-rows" title="按条目逐条编辑：序号 / 时间 / 文本">逐条编辑</button>
    <button class="hf-btn sub-mode-btn" id="sub-mode-text" title="单文本域：SRT 字幕格式（序号 / 时间轴 / 文本）">SRT</button>
  </div>
  <div class="sub-list" id="sub-list"></div>
  <textarea id="sub-textarea" class="sub-textarea" style="display:none" rows="14" spellcheck="false" placeholder="SRT 模式：单文本域按 SRT 字幕格式编辑，块间用空行分隔，例如：
1
00:00:00,400 --> 00:00:02,000
第一行字幕

2
00:00:02,000 --> 00:00:04,000
第二行字幕

也可直接粘贴纯文本，每行一条，自动估时。"></textarea>
  <div class="hgen-actions" style="margin-top:var(--space-3)">
    <button class="hf-btn" id="sub-add">新增条目</button>
    <button class="hf-btn" id="sub-top" title="滚动到第一条字幕">↑ 到顶部</button>
    <button class="hf-btn" id="sub-bottom" title="滚动到最后一条字幕">↓ 到底部</button>
    <span class="sub-count" id="sub-count"></span>
  </div>
  <div class="hgen-row" style="margin-top:var(--space-4)">
    <label class="sel-label">页面标题</label>
    <input id="sub-title" class="hgen-input" style="flex:1" placeholder="字幕动画标题，如：我的第一个字幕动画"/>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn" id="sub-copy" title="复制全部字幕文本（不含时间线）">复制字幕</button>
    <button class="hf-btn" id="sub-export-srt" title="把当前字幕导出为 .srt 字幕文件（含时间轴）">导出 SRT 文件</button>
    <button class="hf-btn hf-btn-primary" id="sub-save">保存到项目</button>
  </div>
  <div class="hf-status" id="sub-status"></div>
  <div class="sub-note">时间格式：<code>分:秒</code>（如 <code>00:05</code>），也可填 <code>00:05.500</code> 精确到毫秒；保存时以起始时间写入 <code>[分:秒] 文本</code>，供 HTML / 视频阶段对齐时间轴。「导出 SRT 文件」可生成标准 <code>.srt</code> 字幕（含时间轴）供外部播放器 / 剪辑软件使用。</div>
</div>

<div class="hf-modal-mask" id="tw-mask" style="display:none">
  <div class="hf-modal">
    <div class="hf-modal-head">
      <span class="hf-modal-title">从音频生成字幕</span>
      <button class="hf-modal-close" id="tw-close" title="关闭">×</button>
    </div>
    <div class="hf-modal-body">
      <div class="panel-title-sm" style="margin-top:0">① 选择音频</div>
      <div class="hgen-row">
        <label class="hgen-check"><input type="radio" name="tw-src" id="tw-src-project" checked/> 使用项目音频</label>
        <label class="hgen-check"><input type="radio" name="tw-src" id="tw-src-file"/> 浏览本地文件</label>
      </div>
      <div class="hgen-row">
        <input id="tw-audio" class="hgen-input" style="flex:1" readonly placeholder="项目音频（可在「配音」页生成 / 选择）"/>
        <button class="hf-btn" id="tw-pick" disabled>选择音频</button>
      </div>
      <div class="whisper-tip" id="tw-audio-hint" style="display:none"></div>

      <div class="panel-title-sm">② 识别模型</div>
      <div class="hgen-row">
        <span class="sel-label">当前识别模型</span>
        <span class="tw-model" id="tw-model">—</span>
        <a class="tw-link" id="tw-manage">管理模型</a>
      </div>
      <div class="whisper-tip" id="tw-model-hint"></div>
      <div class="hgen-row" style="margin-top:var(--space-3)">
        <label class="sel-label">识别语言</label>
        <select id="tw-lang" class="hgen-select" style="flex:1">
          <option value="auto">自动检测</option>
          <option value="zh">中文（简体）</option>
          <option value="zh-hant">中文（繁体）</option>
          <option value="en">English</option>
        </select>
      </div>

      <div class="whisper-bar-wrap" id="tw-bar-wrap" style="display:none">
        <div class="whisper-bar" id="tw-bar"><div class="whisper-bar-fill" id="tw-fill"></div></div>
        <div class="whisper-bar-text" id="tw-bar-text"></div>
      </div>
      <div class="hf-status" id="tw-status" style="margin-top:var(--space-3)"></div>
    </div>
    <div class="hf-modal-foot" id="tw-foot-start">
      <button class="hf-btn" id="tw-cancel">取消</button>
      <button class="hf-btn hf-btn-primary" id="tw-start">开始转录</button>
    </div>
    <div class="hf-modal-foot" id="tw-foot-apply" style="display:none">
      <button class="hf-btn" id="tw-replace">替换现有</button>
      <button class="hf-btn hf-btn-primary" id="tw-append">追加到末尾</button>
    </div>
  </div>
</div>`;
