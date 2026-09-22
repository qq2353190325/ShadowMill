// renderer/pages/settings/template.js —— DOM 模板（与 index.js 逻辑分离）
App.templates['settings'] = `<div class="card hgen-panel">
  <div class="panel-title"><span class="dot"></span>自定义模型（OpenAI 兼容）</div>
  <div class="hgen-tip">配置用于「HTML 生成 / 修改」的自定义模型 Agent。填写 Base URL、模型 ID 与 API Key 并开启后，HTML 生成页即使用该模型工作。API Key 仅保存在本机 userData/settings.json。</div>
  <div class="hgen-row">
    <label class="sel-label">Base URL</label>
    <input id="set-base-url" class="hgen-input" style="flex:1" placeholder="https://api.openai.com/v1（需以 /v1 结尾，按服务商实际提供）"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">模型 ID</label>
    <input id="set-model-id" class="hgen-input" style="flex:1" placeholder="如 gpt-4o-mini / deepseek-chat"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">API Key</label>
    <input id="set-api-key" type="password" class="hgen-input" style="flex:1" placeholder="sk-..."/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">启用</label>
    <label class="hgen-check"><input id="set-enabled" type="checkbox"/> 使用自定义模型生成 / 修改 HTML</label>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="set-save">保存配置</button>
    <button class="hf-btn" id="set-test">测试连接</button>
  </div>
  <div class="hf-status" id="set-status"></div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>千问语音（音色管理 & 文字生音频）</div>
  <div class="hgen-tip">配置千问AI平台 API Key 与目标语音合成模型，供「音色管理」和「文字生音频」使用。API Key 仅保存在本机 userData/settings.json。创建音色时的 target_model 必须与合成模型一致。</div>
  <div class="hgen-row">
    <label class="sel-label">API Key</label>
    <input id="set-v-api-key" type="password" class="hgen-input" style="flex:1" placeholder="sk-...（DASHSCOPE_API_KEY）"/>
  </div>
  <div class="hgen-row">
    <label class="sel-label">目标模型</label>
    <select id="set-v-model" class="hgen-select" style="flex:1"></select>
  </div>
  <div class="hgen-actions">
    <button class="hf-btn hf-btn-primary" id="set-v-save">保存千问语音配置</button>
  </div>
  <div class="hf-status" id="set-v-status"></div>
</div>
<div class="card hgen-panel" style="margin-top:16px">
  <div class="panel-title"><span class="dot"></span>语音识别模型（whisper.cpp 字幕转录）</div>
  <div class="hgen-tip">供字幕页「从音频生成字幕」在本机离线识别使用（不消耗 API 额度）。模型按「id ↔ 文件名」一一枚举登记：只识别登记在枚举内的文件名，枚举外的文件视为未知模型。模型文件不随应用打包，首次使用需在此下载（下载源为 HuggingFace 国内镜像 hf-mirror.com，规避 GitHub 直链超时）。点「设为当前使用」后，字幕转录弹窗即使用该档位；其他 ggml 模型可用「添加自定义模型」起名登记。</div>
  <div class="model-grid" id="wm-grid"></div>
  <div class="whisper-tip" id="wm-unknown"></div>
  <div class="whisper-bar-wrap" id="wm-bar-wrap" style="display:none">
    <div class="whisper-bar" id="wm-bar"><div class="whisper-bar-fill" id="wm-fill"></div></div>
    <div class="whisper-bar-text" id="wm-bar-text"></div>
  </div>
  <div class="hgen-actions" style="margin-top:var(--space-4)">
    <button class="hf-btn" id="wm-refresh">刷新状态</button>
    <button class="hf-btn" id="wm-open-models">打开模型目录</button>
    <button class="hf-btn" id="wm-add">添加自定义模型</button>
  </div>
  <div class="hgen-form" id="wm-form" style="display:none">
    <div class="hgen-row">
      <label>模型名称</label>
      <input class="hgen-input" id="wm-f-name" placeholder="例如：我的中文模型（用于界面显示，可随时改）">
    </div>
    <div class="hgen-row">
      <label>模型文件名</label>
      <input class="hgen-input" id="wm-f-file" placeholder="例如：ggml-medium-q8_0.bin（须为 ggml- 开头、.bin 结尾，登记后不可改）">
    </div>
    <div class="hgen-row">
      <label>下载地址</label>
      <input class="hgen-input" id="wm-f-url" placeholder="留空则按默认镜像 + 文件名拼接">
    </div>
    <div class="hgen-row">
      <label>体积(MB)</label>
      <input class="hgen-input" id="wm-f-size" placeholder="可留空">
    </div>
    <div class="hgen-row">
      <label>说明</label>
      <input class="hgen-input" id="wm-f-desc" placeholder="可留空">
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" id="wm-f-save">保存</button>
      <button class="hf-btn" id="wm-f-cancel">取消</button>
    </div>
    <div class="hf-status" id="wm-f-status"></div>
  </div>
  <div class="hgen-tip" id="wm-store"></div>
  <div class="whisper-tip" id="wm-cli-tip"></div>
  <div class="hf-status" id="wm-status"></div>
</div>`;
