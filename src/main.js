const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

// 窗口引用：供 IPC 窗口控制回调使用
let mainWindow = null;

// ===== 窗口控制 IPC =====
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

function createWindow() {
  // 彻底移除默认应用菜单栏（避免出现 File/Edit/View）
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 同步最大化状态给渲染层（用于切换 最大化/还原 图标）
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-change', false);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ===== 设置存储（userData/settings.json） =====
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = () => ({
  customModel: { baseUrl: '', modelId: '', apiKey: '', enabled: false },
  voiceTTS: { apiKey: '', targetModel: 'qwen-audio-3.0-tts-flash', saveDir: '' }
});

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const base = DEFAULT_SETTINGS();
    return {
      customModel: Object.assign({}, base.customModel, (raw && raw.customModel) || {}),
      voiceTTS: Object.assign({}, base.voiceTTS, (raw && raw.voiceTTS) || {})
    };
  } catch (e) {
    return DEFAULT_SETTINGS();
  }
}
function writeSettings(s) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
}
function getCustomModel() {
  const s = readSettings();
  return s.customModel || DEFAULT_SETTINGS().customModel;
}

// 可选加载 openai SDK（未安装时降级 Node 22 原生 fetch）
function requireOpenAI() {
  try {
    return require('openai');
  } catch (e) {
    return null;
  }
}

ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:save', (event, payload) => {
  const raw = readSettings();
  const incoming = (payload && payload.customModel) || {};
  raw.customModel = Object.assign({}, raw.customModel, {
    baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl : '',
    modelId: typeof incoming.modelId === 'string' ? incoming.modelId : '',
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : '',
    enabled: !!incoming.enabled
  });
  writeSettings(raw);
  return { ok: true, settings: raw };
});

// 测试连接：用当前（或传入的待测）配置发起一次最小对话
ipcMain.handle('settings:test', async (event, payload) => {
  const m = Object.assign({}, getCustomModel(), (payload && payload.customModel) || {});
  if (!m.baseUrl || !m.modelId || !m.apiKey) {
    return { ok: false, message: '配置不完整：Base URL / Model ID / API Key 均需填写' };
  }
  try {
    const OpenAI = requireOpenAI();
    if (OpenAI) {
      const client = new OpenAI({ apiKey: m.apiKey, baseURL: m.baseUrl });
      const res = await client.chat.completions.create({
        model: m.modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8
      });
      const text = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
      return { ok: true, message: '连接成功：模型已响应' + (text ? '（' + String(text).slice(0, 40) + '）' : '') };
    }
    // 兜底 fetch
    const url = String(m.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiKey },
      body: JSON.stringify({ model: m.modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error('HTTP ' + resp.status + '：' + JSON.stringify(data));
    return { ok: true, message: '连接成功：模型已响应' };
  } catch (e) {
    return { ok: false, message: '连接失败：' + (e && e.message ? e.message : String(e)) };
  }
});

// ===== 千问语音：声音复制 + 文字生音频（Qwen-TTS / Qwen-Audio-TTS 双系列 HTTP 方案） =====
const VOICE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const VOICE_ENROLL_MODEL = 'qwen-voice-enrollment'; // Qwen-TTS 系列克隆模型，请勿修改
const VOICE_ENROLL_MODEL_AUDIO = 'voice-enrollment'; // Qwen-Audio-TTS 系列克隆模型
const VOICE_TTS_MODELS = [
  'qwen3-tts-vc-2026-01-22',
  'qwen3-tts-vc-realtime-2026-01-15',
  'qwen3-tts-vc-realtime-2025-11-27',
  'qwen-audio-3.0-tts-flash'
];
const VOICE_MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4' };
// Qwen-Audio-TTS 系列模型名特征（如 qwen-audio-3.0-tts-flash / qwen-audio-3.0-tts-plus）
function isAudioTtsModel(model) {
  return /^qwen-audio-.*-tts/i.test(String(model || ''));
}

function getVoiceConfig() {
  const s = readSettings();
  return Object.assign({}, DEFAULT_SETTINGS().voiceTTS, (s && s.voiceTTS) || {});
}
function getVoiceApiError(cfg) {
  return cfg.apiKey ? null : '未配置千问语音 API Key，请先到「设置」-「千问语音」填写';
}
function parseJsonLike(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
function voiceFriendlyError(err, label) {
  let msg = (err && err.message) ? err.message : String(err);
  if (/InvalidApiKey|unauthorized|Unauthorized|401|403/i.test(msg)) msg = 'API Key 无效或无权限，请检查后重试';
  else if (/quota|ExceededQuota|Insufficient/i.test(msg)) msg = '额度不足或已被限流：' + msg;
  return label + '：' + msg;
}
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function guessAudioExt(url) {
  try {
    const clean = String(url).split('?')[0];
    const base = decodeURIComponent(clean.split('/').pop() || '');
    const m = base.match(/\.(wav|mp3|m4a|mp4|aac|ogg|flac)$/i);
    if (m) return m[1].toLowerCase();
  } catch (e) { /* ignore */ }
  return 'wav';
}

ipcMain.handle('voice:get-config', () => {
  const c = getVoiceConfig();
  return { ok: true, apiKey: c.apiKey, targetModel: c.targetModel, saveDir: String(c.saveDir || '') };
});

ipcMain.handle('voice:save-config', (event, payload) => {
  const raw = readSettings();
  const incoming = (payload && payload.voiceTTS) || payload || {};
  const t = typeof incoming.targetModel === 'string' ? incoming.targetModel : 'qwen-audio-3.0-tts-flash';
  raw.voiceTTS = {
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : '',
    targetModel: VOICE_TTS_MODELS.includes(t) ? t : 'qwen-audio-3.0-tts-flash',
    saveDir: typeof incoming.saveDir === 'string' ? incoming.saveDir.trim() : ''
  };
  writeSettings(raw);
  return { ok: true, settings: raw };
});

ipcMain.handle('voice:pick-audio', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择用于克隆音色的音频（推荐 10~20 秒清晰人声）',
    filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'mp4'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 创建克隆音色（Qwen-TTS：action=create / Qwen-Audio-TTS：action=create_voice）
ipcMain.handle('voice:create', async (event, payload) => {
  const cfg = getVoiceConfig();
  const noKey = getVoiceApiError(cfg);
  if (noKey) return { ok: false, message: noKey };
  const audioPath = payload && payload.audioPath;
  const isAudio = isAudioTtsModel(cfg.targetModel);
  // Qwen-Audio-TTS（如 qwen-audio-3.0-tts-flash）克隆仅接受可公开访问的音频 URL
  const isAudioUrl = isAudio && /^https?:\/\//i.test(String(audioPath || ''));
  if (!isAudioUrl && (!audioPath || !fs.existsSync(audioPath))) return { ok: false, message: '音频文件不存在：' + (audioPath || '') };
  let preferredName = String((payload && payload.preferredName) || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
  if (!preferredName || preferredName.length > 16) {
    return { ok: false, message: '音色名称需 1~16 个字符，仅限数字、字母、下划线' };
  }
  let dataUri = '';
  if (!isAudioUrl) {
    const mime = VOICE_MIME[path.extname(audioPath).toLowerCase()];
    if (!mime) return { ok: false, message: '不支持的音频格式，请使用 wav / mp3 / m4a' };
    let b64 = '';
    try {
      const data = fs.readFileSync(audioPath);
      b64 = data.toString('base64');
    } catch (e) {
      return { ok: false, message: '读取音频失败：' + (e && e.message ? e.message : String(e)) };
    }
    if (Buffer.byteLength(b64, 'utf8') > 10 * 1024 * 1024) {
      return { ok: false, message: '音频过大：Base64 编码后需小于 10 MB（约对应原文件 7.5 MB），请截取 10~20 秒样本' };
    }
    dataUri = 'data:' + mime + ';base64,' + b64;
  }
  try {
    // 按模型系列路由：
    // - Qwen-TTS（qwen3-tts-vc-*）：model=qwen-voice-enrollment, action=create, preferred_name, audio.data
    // - Qwen-Audio-TTS（qwen-audio-*-tts）URL 模式：model=voice-enrollment, action=create_voice, prefix, audio.url
    // - Qwen-Audio-TTS（qwen-audio-*-tts）文件模式：model=voice-enrollment, action=create_voice, prefix, audio.data（base64 可能不被接受）
    const input = isAudioUrl
      ? { action: 'create_voice', target_model: cfg.targetModel, prefix: preferredName, audio: { url: audioPath } }
      : isAudio
        ? { action: 'create_voice', target_model: cfg.targetModel, prefix: preferredName, audio: { data: dataUri } }
        : { action: 'create', target_model: cfg.targetModel, preferred_name: preferredName, audio: { data: dataUri } };
    const resp = await fetch(VOICE_API_BASE + '/services/audio/tts/customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: isAudio ? VOICE_ENROLL_MODEL_AUDIO : VOICE_ENROLL_MODEL, input })
    });
    const raw = await resp.text();
    const json = parseJsonLike(raw);
    if (!resp.ok) {
      const code = (json && json.code) || '';
      // Qwen-Audio-TTS 对 base64 音频不支持时报 Audio 类错误，提示改用可公开访问的音频 URL
      if (isAudio && /audio/i.test(code + ' ' + ((json && json.message) || '')) && /url|address|link|preprocess|data/i.test(raw)) {
        return {
          ok: false,
          message: '创建音色失败（Qwen-Audio-TTS 不接受直传音频）：HTTP ' + resp.status
            + ((json && json.message) ? '：' + json.message : '')
            + '。请改用可公开访问的音频 URL 提交（本接口对 Qwen-Audio-TTS 使用 audio.data 直传可能不被支持）。'
        };
      }
      throw new Error('HTTP ' + resp.status + ((json && json.message) ? '：' + json.message : ''));
    }
    const out = (json && json.output) || {};
    // 字段差异：Qwen-TTS 系列返回 output.voice；Qwen-Audio-TTS 系列返回 output.voice_id
    const voice = out.voice || out.voice_id;
    if (!voice) throw new Error('接口未返回音色 ID（voice / voice_id）');
    return {
      ok: true,
      voice: voice,
      targetModel: out.target_model || cfg.targetModel,
      fallbackMode: !!out.fallback_mode,
      fallbackReason: out.fallback_reason || ''
    };
  } catch (e) {
    return { ok: false, message: voiceFriendlyError(e, '创建音色失败') };
  }
});

// 查询克隆音色列表（action=list）
ipcMain.handle('voice:list', async () => {
  const cfg = getVoiceConfig();
  const noKey = getVoiceApiError(cfg);
  if (noKey) return { ok: false, message: noKey };
  try {
    const resp = await fetch(VOICE_API_BASE + '/services/audio/tts/customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: VOICE_ENROLL_MODEL,
        input: { action: 'list', page_size: 100, page_index: 0 }
      })
    });
    const raw = await resp.text();
    const json = parseJsonLike(raw);
    if (!resp.ok) {
      throw new Error('HTTP ' + resp.status + ((json && json.message) ? '：' + json.message : ''));
    }
    const out = (json && json.output) || {};
    const list = Array.isArray(out.voice_list) ? out.voice_list : [];
    return { ok: true, voices: list, total: out.total || list.length };
  } catch (e) {
    return { ok: false, message: voiceFriendlyError(e, '查询音色失败') };
  }
});

// 选择 TTS 保存的自定义目录（目录选择器）
ipcMain.handle('voice:pick-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 TTS 音频保存目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, dir: r.filePaths[0] };
});

// 扫描已生成 TTS 音频：默认输出目录 + 自定义保存目录 + 各项目 audio/（供渲染层复用为背景音频）
ipcMain.handle('voice:list-generated', async () => {
  const cfg = getVoiceConfig();
  const AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg|flac|mp4)$/i;
  const items = [];
  const seen = new Set();
  const pushDir = (dir, group) => {
    if (!dir || !fs.existsSync(dir)) return;
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach((f) => {
      if (!AUDIO_RE.test(f)) return;
      const p = path.join(dir, f);
      if (seen.has(p)) return;
      seen.add(p);
      let st = null;
      try { st = fs.statSync(p); } catch (e) { return; }
      if (!st.isFile()) return;
      items.push({ path: p, name: f, group: group, size: st.size, mtime: st.mtimeMs });
    });
  };
  // 默认输出目录
  pushDir(path.join(app.getPath('userData'), 'tts-output'), '音频输出目录');
  // 自定义保存目录（若已设置）
  const custom = String(cfg.saveDir || '').trim();
  if (custom) pushDir(custom, '自定义目录');
  // 各项目 audio/
  if (fs.existsSync(projectsRoot)) {
    let projs;
    try { projs = fs.readdirSync(projectsRoot); } catch (e) { projs = []; }
    projs.forEach((proj) => {
      pushDir(path.join(projectsRoot, proj, 'audio'), '项目 · ' + proj);
    });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return { ok: true, items: items, total: items.length };
});

// 解析落盘目录：自定义 saveDir 优先；否则按 指定项目 → 其 audio/；无指定项目 → 最近项目 audio/；均无 → userData/tts-output
function resolveTtsDir(projectName, saveDir) {
  const dir = String(saveDir || '').trim();
  if (dir) return dir;
  if (projectName) {
    const dir = path.join(projectsRoot, projectName);
    return path.join(dir, 'audio');
  }
  const projs = scanProjects();
  if (projs && projs.length) return path.join(projectsRoot, projs[0].name, 'audio');
  return path.join(app.getPath('userData'), 'tts-output');
}

// 文字合成语音并保存（Qwen-TTS：generation 取 audio.url 下载 / Qwen-Audio-TTS：SpeechSynthesizer 直写音频流）
ipcMain.handle('voice:synth', async (event, payload) => {
  const cfg = getVoiceConfig();
  const noKey = getVoiceApiError(cfg);
  if (noKey) return { ok: false, message: noKey };
  const text = String((payload && payload.text) || '').trim();
  const voice = String((payload && payload.voice) || '').trim();
  if (!text) return { ok: false, message: '合成文本为空' };
  if (!voice) return { ok: false, message: '请先选择（或创建）音色' };
  try {
    const isAudio = isAudioTtsModel(cfg.targetModel);
    let buf;
    let ext;
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    if (isAudio) {
      // Qwen-Audio-TTS 系列：POST /services/audio/tts/SpeechSynthesizer，响应体直接为音频流
      const resp = await fetch(VOICE_API_BASE + '/services/audio/tts/SpeechSynthesizer', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: cfg.targetModel,
          input: { text: text, voice: voice, format: 'mp3', sample_rate: 24000 }
        })
      });
      if (!resp.ok) {
        const json = parseJsonLike(await resp.text());
        const extra = (json && json.code ? '[' + json.code + '] ' : '') + ((json && json.message) ? json.message : '');
        throw new Error('HTTP ' + resp.status + (extra ? '：' + extra : ''));
      }
      buf = Buffer.from(await resp.arrayBuffer());
      ext = 'mp3';
    } else {
      // Qwen-TTS 系列：generation 接口取 output.audio.url 再下载
      const resp = await fetch(VOICE_API_BASE + '/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ model: cfg.targetModel, input: { text: text, voice: voice } })
      });
      const raw = await resp.text();
      const json = parseJsonLike(raw);
      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status + ((json && json.message) ? '：' + json.message : ''));
      }
      const audio = (json && json.output && json.output.audio) || {};
      const audioUrl = audio.url;
      if (!audioUrl) throw new Error('接口未返回音频地址（output.audio.url）');
      const audioResp = await fetch(audioUrl);
      if (!audioResp.ok) throw new Error('下载音频失败：HTTP ' + audioResp.status);
      buf = Buffer.from(await audioResp.arrayBuffer());
      ext = guessAudioExt(audioUrl);
    }

    const projectName = String((payload && payload.projectName) || '').trim();
    // 保存位置：payload.saveDir 透传优先，缺省回落已持久化的自定义 saveDir；为空则走默认三级降级
    const dirOverride = String((payload && payload.saveDir) || '').trim() || String(cfg.saveDir || '').trim();
    const destDir = resolveTtsDir(projectName, dirOverride);
    fs.mkdirSync(destDir, { recursive: true });
    const stamp = nowStamp();
    const short = String(voice).replace(/[^a-zA-Z0-9_]/g, '').slice(-12) || 'voice';
    const saveName = 'tts_' + stamp + '_' + short + '.' + ext;
    const savePath = path.join(destDir, saveName);
    fs.writeFileSync(savePath, buf);

    // 仅当落盘到项目 audio/（未用自定义目录且显式指定项目）时，回写 project.json 的 ttsAudio（与背景音频 audioFile 语义区分）
    let targetName = projectName || '';
    if (!dirOverride && projectName) {
      const projDir = path.join(projectsRoot, projectName);
      const pf = path.join(projDir, 'project.json');
      if (fs.existsSync(pf)) {
        try {
          const proj = JSON.parse(fs.readFileSync(pf, 'utf8'));
          proj.ttsAudio = path.join('audio', path.basename(savePath));
          fs.writeFileSync(pf, JSON.stringify(proj, null, 2), 'utf8');
        } catch (e) { /* 不阻断主流程 */ }
      }
    } else if (!dirOverride) {
      const projs = scanProjects();
      if (projs && projs.length) targetName = projs[0].name;
    }

    return { ok: true, savePath: savePath, projectName: targetName, size: buf.length };
  } catch (e) {
    return { ok: false, message: voiceFriendlyError(e, '合成语音失败') };
  }
});

// ===== HTML 生成/修改：自定义模型 Agent 实现（应用侧不内置模板） =====
const HTML_AGENT_SYSTEM = [
  '你是专业的 HTML 动画创作者，为桌面创作应用输出完整、独立、可运行的 HTML 单页。',
  '必须遵守以下硬性要求：',
  '1. 直接输出一个完整 HTML 文档（以 <!DOCTYPE html> 开头），包含 <head> 与 <body>。',
  '2. 必须满足 HyperFrames composition 规范（用于后续转视频）：',
  '   - 动画根容器元素带 data-composition-id 属性（如 <div data-composition-id="comp-demo">）；',
  '   - 通过 <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script> 引入 GSAP；',
  '   - 所有时间轴声明进 window.__timelines 数组（例：const tl = gsap.timeline(); /* ... */; window.__timelines = [tl];），保证源码同时出现 __timelines 与 gsap 字样。',
  '3. 视觉风格：深空科技 / Cyber UI（深色背景 #0B1220、电子蓝 #00D4FF 辉光、玻璃拟态、霓虹渐变）。',
  '4. 若用户提供了字幕，按字幕条目逐条依次播放入场动画。',
  '5. 不得输出任何解释文字、Markdown 注释或代码块围栏，只输出 HTML 源码。'
].join('\n');

// 从模型回复中提取 HTML（兼容 Markdown 代码块包裹的情况）
function extractHtmlFromReply(text) {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] && fence[1].trim()) return fence[1].trim();
  const start = t.search(/<!DOCTYPE html|<html/i);
  if (start >= 0) return t.slice(start).trim();
  return t;
}

// 调用自定义模型（OpenAI 兼容协议），返回模型回复文本
async function chatWithCustomModel(userPrompt) {
  const m = getCustomModel();
  if (!m.enabled) throw new Error('自定义模型未启用：请先到「设置」开启并配置 Base URL / Model ID / API Key');
  if (!m.baseUrl || !m.modelId || !m.apiKey) throw new Error('自定义模型配置不完整：Base URL / Model ID / API Key 均需填写');
  const messages = [
    { role: 'system', content: HTML_AGENT_SYSTEM },
    { role: 'user', content: userPrompt }
  ];
  try {
    const OpenAI = requireOpenAI();
    if (OpenAI) {
      const client = new OpenAI({ apiKey: m.apiKey, baseURL: m.baseUrl });
      const resp = await client.chat.completions.create({ model: m.modelId, messages, max_tokens: 8192 });
      return (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
    }
    const url = String(m.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiKey },
      body: JSON.stringify({ model: m.modelId, messages, max_tokens: 8192 })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error('HTTP ' + resp.status + '：' + JSON.stringify(data));
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } catch (e) {
    throw new Error(String(e && e.message ? e.message : e));
  }
}

// ===== HTML 预览 / HyperFrames 转视频 =====

// ===== 内置依赖资源定位（打包后由 electron-builder extraResources 投放至 resources）=====
const BUILTIN_RESOURCES = (() => {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
  const exists = (p) => fs.existsSync(p);

  // chrome-headless-shell 可执行：<root>\hyperframes\chrome\chrome-headless-shell\**\chrome-headless-shell.exe
  let chromeShell = null;
  try {
    const base = path.join(root, 'hyperframes', 'chrome', 'chrome-headless-shell');
    if (exists(base)) {
      const stack = [base];
      while (stack.length && !chromeShell) {
        const cur = stack.pop();
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          if (e.isDirectory()) stack.push(path.join(cur, e.name));
          else if (/^chrome-headless-shell\.exe$/i.test(e.name)) {
            chromeShell = path.join(cur, e.name);
            break;
          }
        }
      }
    }
  } catch (e) { chromeShell = null; }

  return {
    root,
    node: path.join(root, 'node', 'node.exe'),
    ffmpegBin: path.join(root, 'ffmpeg', 'bin'),
    ffmpeg: path.join(root, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ffprobe: path.join(root, 'ffmpeg', 'bin', 'ffprobe.exe'),
    hfCli: path.join(root, 'hyperframes', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
    hivePlayer: path.join(root, 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'hyperframes-player.global.js'),
    chromeShell
  };
})();

// 探测 HyperFrames CLI 入口（hyperframes.mjs）：内置优先，回退系统安装/环境变量
function findHyperframesCli() {
  if (fs.existsSync(BUILTIN_RESOURCES.hfCli)) return BUILTIN_RESOURCES.hfCli;
  if (process.env.HYPERFRAMES_CLI && fs.existsSync(process.env.HYPERFRAMES_CLI)) {
    return process.env.HYPERFRAMES_CLI;
  }
  const candidates = [path.join('E:', 'my', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 解析 node 的真实绝对路径（避免 spawn('node') 在部分环境 ENOENT）
function resolveNodePath() {
  const candidates = [];
  if (process.env.NVM_SYMLINK) candidates.push(path.join(process.env.NVM_SYMLINK, 'node.exe'));
  candidates.push(path.join(process.env.LOCALAPPDATA || '', 'nvm', 'nodejs', 'node.exe'));
  candidates.push(path.join('C:', 'Program Files', 'nodejs', 'node.exe'));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const p = spawnSync(c, ['-v'], { encoding: 'utf8' });
      if (p.status === 0) return c;
    }
  }
  // 兜底：where node 解析真实路径
  try {
    const w = spawnSync('where.exe', ['node'], { encoding: 'utf8' });
    if (w.status === 0 && w.stdout) {
      const line = w.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l && /\.exe$/i.test(l));
      if (line && fs.existsSync(line)) return line;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 探测 Node（HyperFrames 要求 >= 22）：内置优先，回退系统，一律返回绝对路径
function findNode() {
  // 内置 Node 优先（打包分发免装环境）
  if (fs.existsSync(BUILTIN_RESOURCES.node)) {
    const p = spawnSync(BUILTIN_RESOURCES.node, ['-v'], { encoding: 'utf8' });
    if (p.status === 0) return BUILTIN_RESOURCES.node;
  }
  const probe = spawnSync('node', ['-v'], { encoding: 'utf8' });
  if (probe.status === 0) {
    const v = (probe.stdout || '').trim().replace('v', '');
    const major = parseInt(v.split('.')[0], 10);
    if (!isNaN(major) && major >= 22) {
      const resolved = resolveNodePath();
      return resolved; // 有绝对路径用绝对路径；极端情况为 null 时下面会报错
    }
  }
  return resolveNodePath();
}

// 探测 WinGet 安装的 Gyan.FFmpeg 可执行目录
function findFfmpegBin() {
  const pkgRoot = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgRoot)) return null;
  const dirs = fs.readdirSync(pkgRoot, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('Gyan.FFmpeg')) continue;
    const full = path.join(pkgRoot, d.name);
    const subs = fs.readdirSync(full, { withFileTypes: true });
    for (const s of subs) {
      if (!s.isDirectory() || !s.name.includes('full_build')) continue;
      const bin = path.join(full, s.name, 'bin');
      if (fs.existsSync(path.join(bin, 'ffmpeg.exe'))) return bin;
    }
  }
  return null;
}

// 判断 HTML 是否 HyperFrames 合规 composition
function isHyperframesComposition(raw) {
  return /data-composition-id/i.test(raw) && /__timelines/i.test(raw) && /\bgsap\b/i.test(raw);
}

ipcMain.handle('dialog:open-html', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择要预览的 HTML 文件',
    filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 扫描内置视频项目（项目根 video-projects 下含 index.html 的子目录）
ipcMain.handle('video:list-projects', () => {
  const root = path.join(__dirname, '..', 'video-projects');
  if (!fs.existsSync(root)) return [];
  const list = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const html = path.join(root, d.name, 'index.html');
    if (fs.existsSync(html)) list.push({ name: d.name, html });
  }
  return list;
});

// 生成（复用）"预览外壳"页面：位于目标 HTML 同目录，经本地 hyperframes-player 组件加载
// composition，提供播放条（controls）与等比缩放，修复"预览只显示一部分/无进度条"问题。
ipcMain.handle('video:preview-shell', (event, payload) => {
  const htmlPath = payload && payload.htmlPath;
  if (!htmlPath || typeof htmlPath !== 'string' || !fs.existsSync(htmlPath)) {
    return { ok: false, message: 'HTML 文件不存在' };
  }
  const dir = path.dirname(htmlPath);
  const shellPath = path.join(dir, '_hf_preview_shell.html');
  try {
    if (!fs.existsSync(shellPath)) {
      const { pathToFileURL } = require('url');
      let playerTag = '';
      const localPlayer = BUILTIN_RESOURCES.hivePlayer;
      if (localPlayer && fs.existsSync(localPlayer)) {
        playerTag = '<script src="' + pathToFileURL(localPlayer).href + '"></script>';
      } else {
        playerTag = '<script type="module" src="https://cdn.jsdelivr.net/npm/@hyperframes/player@latest"></script>';
      }
      const html =
        '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>HyperFrames Preview</title>\n' +
        '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}</style>\n' +
        playerTag + '\n</head>\n<body>\n' +
        '<hyperframes-player id="p" controls autoplay muted preload style="display:block;width:100vw;height:100vh"></hyperframes-player>\n' +
        '<script>document.getElementById("p").setAttribute("src", "./' + path.basename(htmlPath) + '");</script>\n' +
        '</body>\n</html>\n';
      fs.writeFileSync(shellPath, html, 'utf8');
    }
    return { ok: true, shellPath };
  } catch (e) {
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }
});

// 在资源管理器中定位视频文件
ipcMain.handle('video:show-in-folder', (event, filePath) => {
  if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle('video:render', (event, payload) => {
  return new Promise((resolve) => {
    const htmlPath = payload && payload.htmlPath;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      resolve({ ok: false, message: 'HTML 文件不存在' });
      return;
    }

    const raw = fs.readFileSync(htmlPath, 'utf8');
    if (!isHyperframesComposition(raw)) {
      resolve({
        ok: false,
        compatible: false,
        message: '该 HTML 不是 HyperFrames 规范的 composition（缺少 data-composition-id / GSAP __timelines 结构）。' +
          '建议先用 HyperFrames 引导生成合规模板，再替换为自己的 HTML 内容。'
      });
      return;
    }

    const hfCli = findHyperframesCli();
    if (!hfCli) {
      resolve({ ok: false, message: '未找到 hyperframes CLI（hyperframes.mjs）。可设置环境变量 HYPERFRAMES_CLI 指向其路径。' });
      return;
    }
    const nodeCmd = findNode();
    if (!nodeCmd) {
      resolve({ ok: false, message: '未找到系统 Node.js（HyperFrames 要求 >= 22）' });
      return;
    }

    // 搭建临时项目目录并放入目标 HTML
    // 若 HTML 所在目录带有配套资源（audio/ 等），整体复制，保证音频能随 HTML 一起渲染
    const projDir = path.join(app.getPath('userData'), 'hf-projects', 'html-video-' + Date.now());
    fs.mkdirSync(projDir, { recursive: true });
    const srcDir = path.dirname(htmlPath);
    try {
      const siblings = fs.readdirSync(srcDir);
      const hasAssets = siblings.some((f) => f !== 'index.html' && f !== 'output.mp4');
      if (hasAssets) {
        fs.cpSync(srcDir, projDir, { recursive: true });
      } else {
        fs.copyFileSync(htmlPath, path.join(projDir, 'index.html'));
      }
    } catch (e) {
      resolve({ ok: false, message: '复制 HTML 失败：' + e.message });
      return;
    }
    const outMp4 = path.join(projDir, 'output.mp4');

    const env = { ...process.env };
    const ffBin = findFfmpegBin();
    if (ffBin) env.PATH = ffBin + path.delimiter + (env.PATH || '');
    // 内置 ffmpeg/ffprobe 路径显式注入，避免依赖系统 PATH（HYPERFRAMES_* 为可选）
    if (fs.existsSync(BUILTIN_RESOURCES.ffmpeg)) env.HYPERFRAMES_FFMPEG_PATH = BUILTIN_RESOURCES.ffmpeg;
    if (fs.existsSync(BUILTIN_RESOURCES.ffprobe)) env.HYPERFRAMES_FFPROBE_PATH = BUILTIN_RESOURCES.ffprobe;
    // 内置 Chrome headless-shell（避免渲染时去 .cache 重新下载）
    if (BUILTIN_RESOURCES.chromeShell) {
      env.PRODUCER_HEADLESS_SHELL_PATH = BUILTIN_RESOURCES.chromeShell;
    }

    const child = spawn(nodeCmd, [hfCli, 'render', '-o', outMp4], {
      cwd: projDir,
      env
    });

    let finished = false;
    const done = (res) => {
      if (finished) return;
      finished = true;
      resolve(res);
    };

    child.stdout.on('data', (d) => {
      const text = d.toString();
      event.sender.send('video:progress', { text });
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      event.sender.send('video:progress', { text });
    });
    child.on('error', (err) => done({ ok: false, message: '启动渲染失败：' + err.message + '（node: ' + (nodeCmd || 'null') + '）' }));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outMp4)) {
        done({ ok: true, outputVideo: outMp4, projectDir: projDir });
      } else {
        done({ ok: false, message: '渲染失败（exit=' + code + '）' });
      }
    });
  });
});

// ===== 项目化贯通流水线：字幕 → HTML → 预览/转视频 =====
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本
//   index.html    由字幕生成的 HTML composition
//   project.json  项目元数据（name/subtitle/htmlPath/videoPath/title 等）

const projectsRoot = path.join(app.getPath('userData'), 'projects');

function projectDir(name) {
  return path.join(projectsRoot, String(name || '').replace(/[\\/:*?"<>|]/g, '_'));
}
function projectFilePath(name, file) {
  return path.join(projectDir(name), file);
}

function readProject(name) {
  const jsonPath = path.join(projectDir(name), 'project.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeProject(proj) {
  const dir = projectDir(proj.name);
  fs.mkdirSync(dir, { recursive: true });
  proj.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(proj, null, 2), 'utf8');
  return proj;
}
function ensureProject(name) {
  const existing = readProject(name);
  if (existing) {
    existing.name = name;
    return existing;
  }
  return {
    name,
    title: '字幕动画',
    subtitle: '',
    htmlPath: '',
    videoPath: '',
    audioFile: '',
    createdAt: new Date().toISOString()
  };
}

// 扫描“我的项目”（可读写，供项目选择器使用）
function scanProjects() {
  if (!fs.existsSync(projectsRoot)) return [];
  const list = [];
  for (const d of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = readProject(d.name);
    if (!p) continue;
    list.push({
      name: p.name,
      title: p.title || '字幕动画',
      hasSubtitle: !!p.subtitle,
      hasHtml: !!(p.htmlPath && fs.existsSync(p.htmlPath)),
      hasVideo: !!(p.videoPath && fs.existsSync(p.videoPath)),
      subtitleCount: p.subtitleCount || 0,
      updatedAt: p.updatedAt || ''
    });
  }
  return list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// 解析字幕文本：支持 [分:秒] 文本 或 纯文本（自动估算时间）
function parseSubtitle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  let autoT = 0.4;
  let lineNo = 1;
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?\]\s*(.*)$/);
    let txt = line;
    let time = null;
    if (m) {
      txt = m[4].trim();
      time = (+m[1]) * 60 + (+m[2]) + ((+(m[3] || 0)) / 1000);
    }
    if (!txt) { lineNo++; continue; }
    if (time === null) {
      time = autoT;
      autoT += Math.max(2.4, 1.6 + txt.length * 0.15);
    }
    items.push({ n: lineNo, text: txt, time });
    lineNo++;
  }
  return items;
}

ipcMain.handle('project:list', () => scanProjects());

ipcMain.handle('project:load', (event, name) => {
  if (!name) return null;
  return readProject(name) || ensureProject(name);
});

// 保存字幕到当前项目
ipcMain.handle('project:save-subtitle', (event, payload) => {
  const name = payload && payload.name;
  const subtitle = payload && typeof payload.subtitle === 'string' ? payload.subtitle : '';
  const title = payload && typeof payload.title === 'string' ? payload.title : '';
  if (!name) return { ok: false, message: '缺少项目名' };
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'subtitle.txt'), subtitle, 'utf8');
  const proj = ensureProject(name);
  proj.subtitle = subtitle;
  if (title) proj.title = title;
  proj.subtitleCount = parseSubtitle(subtitle).length;
  writeProject(proj);
  return { ok: true, project: proj };
});

// ===== HTML 生成/修改：由 Agent 接口实现（应用侧不内置模板） =====
// 接入点：handler 收到 { name, prompt } 后调用自定义模型 Agent，
// Agent 产出/修改 HTML 并写入 projectFilePath(name,'index.html')，
// 应用侧随后更新 proj.htmlPath、置空 proj.videoPath 并刷新链路。
ipcMain.handle('project:generate-html', async (event, payload) => {
  const name = payload && payload.name;
  if (!name) return { ok: false, message: '缺少项目名' };
  const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

  const proj = ensureProject(name);
  // —— 素材选择（均可选，不选不强制拼接）——
  // 字幕：'' = 不使用；'__current__' = 当前项目字幕；其他 = 指定带字幕的项目名
  let subtitleText = '';
  const subSel = payload && payload.subtitleProject;
  if (subSel === '__current__') subtitleText = proj.subtitle || '';
  else if (subSel && typeof subSel === 'string') {
    const src = readProject(subSel);
    subtitleText = (src && src.subtitle) || '';
  }
  // 音频：'' = 不使用；'__current__' = 当前项目背景音频；其他 = 外部音频绝对路径（复制进本项目 audio/ 后按相对引用）
  let audioRef = '';
  const audSel = payload && payload.audioPath;
  if (audSel === '__current__') audioRef = proj.audioFile || '';
  else if (audSel && typeof audSel === 'string' && fs.existsSync(audSel)) audioRef = copyAudioIntoProject(name, audSel);
  const userPrompt = [
    '用户需求：' + prompt.trim(),
    subtitleText ? '\n【项目字幕，请据此逐条设计动画】\n' + subtitleText : '',
    audioRef ? '\n【背景音乐】项目内音频文件：' + audioRef + '，请在 HTML 中通过 <audio autoplay loop> 引用为音轨。' : ''
  ].filter(Boolean).join('\n');

  try {
    const reply = await chatWithCustomModel(userPrompt);
    const html = extractHtmlFromReply(reply);
    if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
    const dir = projectDir(name);
    fs.mkdirSync(dir, { recursive: true });
    const htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf8');
    proj.htmlPath = htmlPath;
    proj.videoPath = ''; // HTML 刷新后旧视频失效
    writeProject(proj);
    const compatible = isHyperframesComposition(html);
    return {
      ok: true,
      htmlPath,
      compatible,
      message: compatible
        ? 'HTML 已生成'
        : 'HTML 已生成，但未通过 HyperFrames 合规检查（缺 data-composition-id / __timelines / gsap），预览可用，转视频前需调整。'
    };
  } catch (e) {
    return { ok: false, message: 'Agent 调用失败：' + (e && e.message ? e.message : String(e)) };
  }
});

// 修改：基于现有 HTML，由 Agent 按需求改造后覆盖
ipcMain.handle('project:modify-html', async (event, payload) => {
  const name = payload && payload.name;
  if (!name) return { ok: false, message: '缺少项目名' };
  const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML，请先生成' };

  const proj = ensureProject(name);
  const curHtml = fs.readFileSync(htmlPath, 'utf8');
  // 素材选择（语义同生成：均可选，不选不拼接）
  let subtitleText = '';
  const subSel = payload && payload.subtitleProject;
  if (subSel === '__current__') subtitleText = proj.subtitle || '';
  else if (subSel && typeof subSel === 'string') {
    const src = readProject(subSel);
    subtitleText = (src && src.subtitle) || '';
  }
  let audioRef = '';
  const audSel = payload && payload.audioPath;
  if (audSel === '__current__') audioRef = proj.audioFile || '';
  else if (audSel && typeof audSel === 'string' && fs.existsSync(audSel)) audioRef = copyAudioIntoProject(name, audSel);
  const userPrompt = [
    '当前项目的 index.html 源码如下：',
    '```html',
    curHtml,
    '```',
    '',
    '用户需求（在此基础上改造后输出完整新 HTML）：' + prompt.trim(),
    subtitleText ? '\n【项目字幕，请据此逐条设计动画】\n' + subtitleText : '',
    audioRef ? '\n【背景音乐】项目内音频文件：' + audioRef + '，请在 HTML 中通过 <audio autoplay loop> 引用为音轨。' : ''
  ].join('\n');

  try {
    const reply = await chatWithCustomModel(userPrompt);
    const html = extractHtmlFromReply(reply);
    if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
    fs.writeFileSync(htmlPath, html, 'utf8');
    proj.htmlPath = htmlPath;
    proj.videoPath = '';
    writeProject(proj);
    const compatible = isHyperframesComposition(html);
    return {
      ok: true,
      htmlPath,
      compatible,
      message: compatible
        ? 'HTML 已修改'
        : 'HTML 已修改，但未通过 HyperFrames 合规检查，转视频前需调整。'
    };
  } catch (e) {
    return { ok: false, message: 'Agent 调用失败：' + (e && e.message ? e.message : String(e)) };
  }
});

// 下载项目 HTML 到本地（导出入口）
ipcMain.handle('project:download-html', (event, name) => {
  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
  const save = dialog.showSaveDialogSync(mainWindow, {
    title: '导出 HTML',
    defaultPath: (name || 'project') + '.html',
    filters: [{ name: 'HTML 文件', extensions: ['html'] }]
  });
  if (!save) return { ok: false, canceled: true };
  fs.copyFileSync(htmlPath, save);
  return { ok: true, savedPath: save };
});

// 打开项目所在目录
ipcMain.handle('project:open-folder', (event, name) => {
  const dir = projectDir(name);
  if (fs.existsSync(dir)) shell.openPath(dir);
  return { ok: true };
});

// 导出任意文件（内置示例项目 HTML 的只读导出入口）
ipcMain.handle('project:download-file', (event, payload) => {
  const src = payload && payload.srcPath;
  const defaultName = (payload && payload.defaultName) || 'export.html';
  if (!src || typeof src !== 'string' || !fs.existsSync(src)) {
    return { ok: false, message: '文件不存在' };
  }
  const save = dialog.showSaveDialogSync(mainWindow, {
    title: '导出 HTML',
    defaultPath: String(defaultName).replace(/[\\/:*?"<>|]/g, '_'),
    filters: [{ name: 'HTML 文件', extensions: ['html'] }]
  });
  if (!save) return { ok: false, canceled: true };
  fs.copyFileSync(src, save);
  return { ok: true, savedPath: save };
});

// 打开指定文件所在目录 / 指定目录（内置示例资源目录入口）
ipcMain.handle('project:open-folder-of', (event, p) => {
  if (!p || typeof p !== 'string') return { ok: false, message: '参数缺失' };
  let dir = p;
  try {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) dir = path.dirname(p);
  } catch (e) { /* ignore */ }
  if (dir && fs.existsSync(dir)) {
    shell.openPath(dir);
    return { ok: true, dir };
  }
  return { ok: false, message: '目录不存在' };
});

// 删除“我的项目”（慎重：仅限 userData 下的项目目录）
ipcMain.handle('project:delete', (event, name) => {
  const dir = projectDir(name);
  if (!name || !dir.startsWith(projectsRoot)) return { ok: false, message: '非法项目名' };
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { ok: true };
});

// 视频渲染完成后，把产物路径回写进项目（供链路状态条点亮“视频”节点）
ipcMain.handle('project:save-video', (event, payload) => {
  const name = payload && payload.name;
  const videoPath = payload && payload.videoPath;
  if (!name || !videoPath) return { ok: false, message: '参数缺失' };
  const proj = ensureProject(name);
  proj.videoPath = String(videoPath);
  writeProject(proj);
  return { ok: true, project: proj };
});
// ===== 项目音频：让生成的 HTML 视频有声音 =====
// 将外部音频复制进项目 audio/ 目录，返回相对引用（audio/xxx）；复制失败返回 ''
function copyAudioIntoProject(name, audioPath) {
  if (!name || !audioPath || !fs.existsSync(audioPath)) return '';
  try {
    const audioDir = path.join(projectDir(name), 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const basename = path.basename(audioPath).replace(/[\\/:*?"<>|]/g, '_');
    const extIndex = basename.lastIndexOf('.');
    const stem = extIndex > 0 ? basename.slice(0, extIndex) : basename;
    const ext = extIndex > 0 ? basename.slice(extIndex) : '';
    let saveName = basename;
    let i = 1;
    while (fs.existsSync(path.join(audioDir, saveName))) {
      saveName = stem + '_' + i + ext;
      i++;
      if (i > 1000) break;
    }
    fs.copyFileSync(audioPath, path.join(audioDir, saveName));
    return 'audio/' + saveName;
  } catch (e) {
    return '';
  }
}

ipcMain.handle('project:pick-audio', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频文件（将复制进项目，随视频一起渲染）',
    filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 把音频复制进项目目录 audio/ 并记录相对引用
ipcMain.handle('project:set-audio', (event, payload) => {
  const name = payload && payload.name;
  const audioPath = payload && payload.audioPath;
  if (!name) return { ok: false, message: '缺少项目名' };
  if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在' };
  const audioFile = copyAudioIntoProject(name, audioPath);
  if (!audioFile) return { ok: false, message: '音频复制到项目失败' };
  const proj = ensureProject(name);
  proj.audioFile = audioFile;
  writeProject(proj);
  return { ok: true, audioFile: proj.audioFile };
});

// 移除当前项目音频引用（保留音频文件，避免误删资源）
ipcMain.handle('project:clear-audio', (event, payload) => {
  const name = payload && payload.name;
  if (!name) return { ok: false, message: '缺少项目名' };
  const proj = ensureProject(name);
  proj.audioFile = '';
  writeProject(proj);
  return { ok: true };
});

// 读取项目当前 HTML 源码（供编辑器载入）
ipcMain.handle('project:read-html', (event, name) => {
  const htmlPath = projectFilePath(name, 'index.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
  return { ok: true, html: fs.readFileSync(htmlPath, 'utf8') };
});

// 直接保存（覆盖）项目 HTML 源码，支持"不满意再改"
ipcMain.handle('project:save-html', (event, payload) => {
  const name = payload && payload.name;
  const html = payload && typeof payload.html === 'string' ? payload.html : '';
  if (!name) return { ok: false, message: '缺少项目名' };
  if (!String(html).trim()) return { ok: false, message: 'HTML 内容为空' };
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  const proj = ensureProject(name);
  proj.htmlPath = htmlPath;
  // HTML 改动后旧视频不再匹配 → 标记失效
  proj.videoPath = '';
  writeProject(proj);
  return { ok: true, htmlPath, compatible: isHyperframesComposition(html) };
});
