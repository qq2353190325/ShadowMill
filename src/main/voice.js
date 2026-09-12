// src/main/voice.js
// 千问语音：声音复制 + 文字生音频（Qwen-TTS / Qwen-Audio-TTS 双系列 HTTP 方案）
// 提供：isAudioTtsModel / getVoiceApiError / parseJsonLike / voiceFriendlyError /
//       nowStamp / guessAudioExt / resolveTtsDir + 全部 voice:* IPC
// 依赖：settings(getVoiceConfig / readSettings / writeSettings / DEFAULT_SETTINGS) /
//       projects(projectsRoot / scanProjects) / dialog
const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const settings = require('./settings.js');
const projects = require('./projects.js');

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
  return settings.getVoiceConfig();
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

// 解析落盘目录：自定义 saveDir 优先；否则按 指定项目 → 其 audio/；无指定项目 → 最近项目 audio/；均无 → userData/tts-output
function resolveTtsDir(projectName, saveDir) {
  const dir = String(saveDir || '').trim();
  if (dir) return dir;
  const projectsRoot = projects.projectsRoot;
  if (projectName) {
    const dir = path.join(projectsRoot, projectName);
    return path.join(dir, 'audio');
  }
  const projs = projects.scanProjects();
  if (projs && projs.length) return path.join(projectsRoot, projs[0].name, 'audio');
  return path.join(app.getPath('userData'), 'tts-output');
}

function register(ctx) {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

  ipcMain.handle('voice:get-config', () => {
    const c = getVoiceConfig();
    return { ok: true, apiKey: c.apiKey, targetModel: c.targetModel, saveDir: String(c.saveDir || '') };
  });

  ipcMain.handle('voice:save-config', (event, payload) => {
    const raw = settings.readSettings();
    const incoming = (payload && payload.voiceTTS) || payload || {};
    const t = typeof incoming.targetModel === 'string' ? incoming.targetModel : 'qwen-audio-3.0-tts-flash';
    raw.voiceTTS = {
      apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : '',
      targetModel: VOICE_TTS_MODELS.includes(t) ? t : 'qwen-audio-3.0-tts-flash',
      saveDir: typeof incoming.saveDir === 'string' ? incoming.saveDir.trim() : ''
    };
    settings.writeSettings(raw);
    return { ok: true, settings: raw };
  });

  ipcMain.handle('voice:pick-audio', async () => {
    if (!getWindow()) return null;
    const r = await dialog.showOpenDialog(getWindow(), {
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
    const r = await dialog.showOpenDialog(getWindow(), {
      title: '选择 TTS 音频保存目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, dir: r.filePaths[0] };
  });

  // 扫描已生成 TTS 音频：默认输出目录 + 自定义保存目录 + 各项目 audio/（供渲染层复用为背景音频）
  ipcMain.handle('voice:list-generated', async () => {
    const cfg = getVoiceConfig();
    const projectsRoot = projects.projectsRoot;
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
      const projectsRoot = projects.projectsRoot;
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
        const projs = projects.scanProjects();
        if (projs && projs.length) targetName = projs[0].name;
      }

      return { ok: true, savePath: savePath, projectName: targetName, size: buf.length };
    } catch (e) {
      return { ok: false, message: voiceFriendlyError(e, '合成语音失败') };
    }
  });
}

module.exports = {
  register,
  isAudioTtsModel,
  getVoiceApiError,
  parseJsonLike,
  voiceFriendlyError,
  nowStamp,
  guessAudioExt,
  resolveTtsDir
};
