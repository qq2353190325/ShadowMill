// src/main/settings.js
// 设置存储（userData/settings.json）与 OpenAI 兼容客户端工具
// 提供：readSettings / writeSettings / getCustomModel / getVoiceConfig / requireOpenAI
//       以及 settings:get / settings:save / settings:test IPC
//       + whisper 当前模型档位与自定义模型列表（getWhisperModel / saveWhisperModel / getWhisperCustomModels / saveWhisperCustomModels）
// 依赖：app / ipcMain / fs / path
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = () => ({
  customModel: { baseUrl: '', modelId: '', apiKey: '', enabled: false },
  voiceTTS: { apiKey: '', targetModel: 'qwen-audio-3.0-tts-flash', saveDir: '' },
  voiceProfiles: {}, // 本地音色映射：key 形如 "system:Cherry" / "custom:<voice_id>"，值为 { key, name, voice, targetModel, type }
  whisper: { modelId: '', customModels: [] } // 语音识别（whisper.cpp）：modelId 为当前使用档位，customModels 为用户自定义模型条目
});

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const base = DEFAULT_SETTINGS();
    return {
      customModel: Object.assign({}, base.customModel, (raw && raw.customModel) || {}),
      voiceTTS: Object.assign({}, base.voiceTTS, (raw && raw.voiceTTS) || {}),
      voiceProfiles: Object.assign({}, (raw && raw.voiceProfiles) || {}),
      whisper: Object.assign({}, base.whisper, (raw && raw.whisper) || {})
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
function getVoiceConfig() {
  const s = readSettings();
  return Object.assign({}, DEFAULT_SETTINGS().voiceTTS, (s && s.voiceTTS) || {});
}
// ===== 语音识别（whisper.cpp）当前模型档位：持久化在 settings.json 的 whisper.modelId =====
function getWhisperModel() {
  const s = readSettings();
  return (s && s.whisper && s.whisper.modelId) || '';
}
function saveWhisperModel(id) {
  const s = readSettings();
  s.whisper = Object.assign({}, s.whisper || {}, { modelId: typeof id === 'string' ? id : '' });
  writeSettings(s);
  return getWhisperModel();
}
// ===== 语音识别自定义模型列表：持久化在 settings.json 的 whisper.customModels =====
// 条目结构：{ id, name, file, url, sizeMB, desc }；id 由文件名派生（ggml-base-q5_1.bin → base-q5_1）
function getWhisperCustomModels() {
  const s = readSettings();
  const list = (s && s.whisper && s.whisper.customModels) || [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === 'object' && typeof c.file === 'string' && c.file)
    .map((c) => ({
      id: typeof c.id === 'string' && c.id ? c.id : String(c.file).replace(/^ggml-/i, '').replace(/\.bin$/i, ''),
      name: typeof c.name === 'string' ? c.name : '',
      file: c.file,
      url: typeof c.url === 'string' ? c.url : '',
      sizeMB: Number(c.sizeMB) || 0,
      desc: typeof c.desc === 'string' ? c.desc : ''
    }));
}
function saveWhisperCustomModels(list) {
  const s = readSettings();
  s.whisper = Object.assign({}, s.whisper || {}, { customModels: Array.isArray(list) ? list : [] });
  writeSettings(s);
  return getWhisperCustomModels();
}
function getVoiceProfiles() {
  const s = readSettings();
  return Object.assign({}, (s && s.voiceProfiles) || {});
}
function saveVoiceProfile(key, profile) {
  const s = readSettings();
  s.voiceProfiles = s.voiceProfiles || {};
  s.voiceProfiles[key] = profile;
  writeSettings(s);
  return getVoiceProfiles();
}
function deleteVoiceProfile(key) {
  const s = readSettings();
  if (s.voiceProfiles && Object.prototype.hasOwnProperty.call(s.voiceProfiles, key)) {
    delete s.voiceProfiles[key];
  }
  writeSettings(s);
  return getVoiceProfiles();
}

// 可选加载 openai SDK（未安装时降级 Node 22 原生 fetch）
function requireOpenAI() {
  try {
    return require('openai');
  } catch (e) {
    return null;
  }
}

function register(ctx) {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

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

  // 测试连接：用当前（或传入的待测）配置发起一次最小对话，必须拿到模型返回文本才算成功
  ipcMain.handle('settings:test', async (event, payload) => {
    const m = Object.assign({}, getCustomModel(), (payload && payload.customModel) || {});
    if (!m.baseUrl || !m.modelId || !m.apiKey) {
      return { ok: false, message: '配置不完整：Base URL / Model ID / API Key 均需填写' };
    }
    try {
      const OpenAI = requireOpenAI();
      let text = '';
      if (OpenAI) {
        const client = new OpenAI({ apiKey: m.apiKey, baseURL: m.baseUrl });
        const res = await client.chat.completions.create({
          model: m.modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 64
        });
        text = (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '';
      } else {
        // 兜底 fetch
        const url = String(m.baseUrl).replace(/\/+$/, '') + '/chat/completions';
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiKey },
          body: JSON.stringify({ model: m.modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 64 })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error('HTTP ' + resp.status + '：' + JSON.stringify(data));
        text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      }
      if (!String(text).trim()) {
        return { ok: false, message: '连接已通但模型未返回文本内容（可能为推理模型/网关异常），请检查 Model ID 或更换模型' };
      }
      return { ok: true, message: '连接成功：模型已响应（' + String(text).slice(0, 40) + '）' };
    } catch (e) {
      return { ok: false, message: '连接失败：' + (e && e.message ? e.message : String(e)) };
    }
  });
}

module.exports = {
  register,
  readSettings,
  writeSettings,
  getCustomModel,
  getVoiceConfig,
  getWhisperModel,
  saveWhisperModel,
  getWhisperCustomModels,
  saveWhisperCustomModels,
  getVoiceProfiles,
  saveVoiceProfile,
  deleteVoiceProfile,
  DEFAULT_SETTINGS,
  requireOpenAI
};
