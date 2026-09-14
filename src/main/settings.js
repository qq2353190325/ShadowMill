// src/main/settings.js
// 设置存储（userData/settings.json）与 OpenAI 兼容客户端工具
// 提供：readSettings / writeSettings / getCustomModel / getVoiceConfig / requireOpenAI
//       以及 settings:get / settings:save / settings:test IPC
// 依赖：app / ipcMain / fs / path
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = () => ({
  customModel: { baseUrl: '', modelId: '', apiKey: '', enabled: false },
  voiceTTS: { apiKey: '', targetModel: 'qwen-audio-3.0-tts-flash', saveDir: '' },
  voiceProfiles: {} // 本地音色映射：key 形如 "system:Cherry" / "custom:<voice_id>"，值为 { key, name, voice, targetModel, type }
});

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const base = DEFAULT_SETTINGS();
    return {
      customModel: Object.assign({}, base.customModel, (raw && raw.customModel) || {}),
      voiceTTS: Object.assign({}, base.voiceTTS, (raw && raw.voiceTTS) || {}),
      voiceProfiles: Object.assign({}, (raw && raw.voiceProfiles) || {})
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
}

module.exports = {
  register,
  readSettings,
  writeSettings,
  getCustomModel,
  getVoiceConfig,
  getVoiceProfiles,
  saveVoiceProfile,
  deleteVoiceProfile,
  DEFAULT_SETTINGS,
  requireOpenAI
};
