// src/main/voice.ts
// 千问语音：音色管理 + 文字生音频（Qwen-TTS / Qwen-Audio-TTS 双系列 HTTP 方案）
// 提供：isAudioTtsModel / getVoiceApiError / parseJsonLike / voiceFriendlyError /
//       nowStamp / guessAudioExt / resolveTtsDir + 全部 voice:* IPC
// 依赖：settings(getVoiceConfig / readSettings / writeSettings / DEFAULT_SETTINGS) /
//       projects(projectsRoot / scanProjects) / dialog
import { app, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as settings from './settings'
import * as projects from './projects'
import { SYSTEM_VOICES, isSystemVoice } from './systemVoices'
import { IPC } from '../shared/ipc'
import type {
  RegisterCtx,
  SystemVoice,
  VoiceCreatePayload,
  VoiceModel,
  VoiceProfileKeyPayload,
  VoiceProfilePayload,
  VoiceProfile,
  VoiceSaveConfigPayload,
  VoiceSaveDirPayload,
  VoiceSynthPayload,
  VoiceTTSConfig
} from '../shared/types'

const VOICE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const VOICE_ENROLL_MODEL = 'qwen-voice-enrollment'; // Qwen-TTS 系列克隆模型，请勿修改
const VOICE_ENROLL_MODEL_AUDIO = 'voice-enrollment'; // Qwen-Audio-TTS 系列克隆模型
// 候选模型表（角色：clone=语音复刻/克隆音色合成，system=内置系统音色合成）；结构见 shared/types.ts 的 VoiceModel
const VOICE_MODELS: VoiceModel[] = [
  { id: 'qwen-audio-3.0-tts-flash', label: 'qwen-audio-3.0-tts-flash', role: 'clone', input: 'url', group: '语音复刻（克隆音色合成）', isDefault: true },
  { id: 'qwen3-tts-vc-2026-01-22', label: 'qwen3-tts-vc-2026-01-22（非实时）', role: 'clone', input: 'file' },
  { id: 'qwen3-tts-vc-realtime-2026-01-15', label: 'qwen3-tts-vc-realtime-2026-01-15（实时）', role: 'clone', input: 'file' },
  { id: 'qwen3-tts-vc-realtime-2025-11-27', label: 'qwen3-tts-vc-realtime-2025-11-27（实时）', role: 'clone', input: 'file' },
  { id: 'qwen3-tts-instruct-flash', label: '千问3-TTS-Instruct-Flash', role: 'system', series: 'instruct-flash', group: '系统音色合成' },
  { id: 'qwen3-tts-flash', label: '千问3-TTS-Flash', role: 'system', series: 'flash' },
  { id: 'qwen-tts', label: '千问-TTS', role: 'system', series: 'tts' }
];
// 各系列系统音色默认合成模型
const SYSTEM_SERIES_MODEL: Record<string, string> = { 'instruct-flash': 'qwen3-tts-instruct-flash', 'flash': 'qwen3-tts-flash', 'tts': 'qwen-tts' };
const VOICE_TTS_MODELS = VOICE_MODELS.map((m) => m.id);
const VOICE_MIME: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4' };
// Qwen-Audio-TTS 系列模型名特征（如 qwen-audio-3.0-tts-flash / qwen-audio-3.0-tts-plus）
function isAudioTtsModel(model: string): boolean {
  return /^qwen-audio-.*-tts/i.test(String(model || ''));
}

function getVoiceConfig(): VoiceTTSConfig {
  return settings.getVoiceConfig();
}
function getVoiceApiError(cfg: VoiceTTSConfig): string | null {
  return cfg.apiKey ? null : '未配置千问语音 API Key，请先到「设置」-「千问语音」填写';
}
function parseJsonLike(text: string): Record<string, any> | null {
  try { return JSON.parse(text); } catch (e) { return null; }
}
function voiceFriendlyError(err: unknown, label: string): string {
  let msg = (err && (err as Error).message) ? (err as Error).message : String(err);
  if (/InvalidApiKey|unauthorized|Unauthorized|401|403/i.test(msg)) msg = 'API Key 无效或无权限，请检查后重试';
  else if (/quota|ExceededQuota|Insufficient/i.test(msg)) msg = '额度不足或已被限流：' + msg;
  return label + '：' + msg;
}
function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function guessAudioExt(url: string): string {
  try {
    const clean = String(url).split('?')[0];
    const base = decodeURIComponent(clean.split('/').pop() || '');
    const m = base.match(/\.(wav|mp3|m4a|mp4|aac|ogg|flac)$/i);
    if (m) return m[1].toLowerCase();
  } catch (e) { /* ignore */ }
  return 'wav';
}

// 解析落盘目录：自定义 saveDir 优先；否则按 指定项目 → 其 audio/；无指定项目 → 最近项目 audio/；均无 → userData/tts-output
function resolveTtsDir(projectName: string, saveDir: string): string {
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

// 系统音色默认合成模型：按 series 优先级取（instruct-flash > flash > tts）
function systemVoiceDefaultModel(v: SystemVoice | Record<string, never>): string {
  const s = (v as SystemVoice).series;
  if (Array.isArray(s)) {
    if (s.indexOf('instruct-flash') >= 0) return SYSTEM_SERIES_MODEL['instruct-flash'];
    if (s.indexOf('flash') >= 0) return SYSTEM_SERIES_MODEL['flash'];
    if (s.indexOf('tts') >= 0) return SYSTEM_SERIES_MODEL['tts'];
  }
  return 'qwen3-tts-flash';
}

// 统一「音色→模型」解析（voice:list-all 等共用单一入口）
// 三级：① 本地映射 voiceProfiles[voiceKey].targetModel；② 系统音色按其 series 默认模型；③ 兜底全局默认 targetModel
function resolveVoiceModel(voiceKey: string, _ctx?: RegisterCtx): string {
  const key = String(voiceKey || '').trim();
  const bare = key.replace(/^(system|custom):/i, ''); // 兼容带前缀 key（system:Cherry / custom:<voice_id>）
  const profiles = settings.getVoiceProfiles();
  const prof = profiles[key] || profiles[bare];
  if (prof && prof.targetModel) return prof.targetModel; // ① 本地映射命中
  if (isSystemVoice(bare)) { // ② 系统音色：按系列取默认合成模型
    const sys = SYSTEM_VOICES.find((v) => v.voice === bare);
    return systemVoiceDefaultModel(sys || {});
  }
  // ③ 兜底：全局默认 targetModel
  return getVoiceConfig().targetModel;
}

// 查询克隆音色列表（action=list，供 voice:list / voice:list-all 复用）
async function fetchClonedVoices(): Promise<{ ok: boolean; voices?: any[]; total?: number; message?: string }> {
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
}

// 单次文字合成（不落盘）：Qwen-Audio-TTS 直写音频流 / Qwen-TTS 取 output.audio.url 下载
// 返回 { buf, ext }；失败抛错（由调用方 voiceFriendlyError 包装）。供 voice:synth 与 ttsAlign 逐句合成共用
async function synthOne(text: string, voice: string, useModel: string): Promise<{ buf: Buffer; ext: string }> {
  const cfg = getVoiceConfig();
  const noKey = getVoiceApiError(cfg);
  if (noKey) throw new Error(noKey);
  const isAudio = isAudioTtsModel(useModel);
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
  if (isAudio) {
    // Qwen-Audio-TTS 系列：POST /services/audio/tts/SpeechSynthesizer，响应体直接为音频流
    const resp = await fetch(VOICE_API_BASE + '/services/audio/tts/SpeechSynthesizer', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: useModel,
        input: { text: text, voice: voice, format: 'mp3', sample_rate: 24000 }
      })
    });
    if (!resp.ok) {
      const json = parseJsonLike(await resp.text());
      const extra = (json && json.code ? '[' + json.code + '] ' : '') + ((json && json.message) ? json.message : '');
      throw new Error('HTTP ' + resp.status + (extra ? '：' + extra : ''));
    }
    return { buf: Buffer.from(await resp.arrayBuffer()), ext: 'mp3' };
  }
  // Qwen-TTS 系列：generation 接口取 output.audio.url 再下载
  const resp = await fetch(VOICE_API_BASE + '/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ model: useModel, input: { text: text, voice: voice } })
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
  return { buf: Buffer.from(await audioResp.arrayBuffer()), ext: guessAudioExt(audioUrl) };
}

function register(ctx?: RegisterCtx): void {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

  ipcMain.handle(IPC.Voice.GetConfig, () => {
    const c = getVoiceConfig();
    return { ok: true, apiKey: c.apiKey, targetModel: c.targetModel, saveDir: String(c.saveDir || '') };
  });

  // 返回当前选择的 TTS 保存目录绝对路径（配音页「打开目录」按钮用，无需合成）
  // 与 voice:synth 相同优先级解析：自定义目录 > 音频输出目录 > 所选项目 audio/ > 兜底
  ipcMain.handle(IPC.Voice.GetSaveDir, (_event, payload?: VoiceSaveDirPayload) => {
    const saveDir = String((payload && payload.saveDir) || '').trim();
    const defaultOut = !!(payload && payload.defaultOut);
    const projectName = String((payload && payload.projectName) || '').trim();
    const dir = defaultOut
      ? path.join(app.getPath('userData'), 'tts-output')
      : resolveTtsDir(projectName, saveDir);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 目录不可用时由打开动作报错 */ }
    const mode = defaultOut ? 'output' : saveDir ? 'custom' : projectName ? 'project' : 'default';
    return { ok: true, mode: mode, saveDir: dir };
  });

  // 兼容两种线上形态：{ voiceTTS } 与裸 Partial<VoiceTTSConfig>（历史调用）
  ipcMain.handle(IPC.Voice.SaveConfig, (_event, payload?: VoiceSaveConfigPayload | Partial<VoiceTTSConfig>) => {
    const raw = settings.readSettings();
    const incoming = (payload && (payload as any).voiceTTS) || payload || {};
    // 与既有配置合并：未传入的字段保留原值（避免「只存 saveDir」时误清空 API Key，也避免设置页保存时覆盖 saveDir）
    const prev = raw.voiceTTS || {};
    const t = typeof incoming.targetModel === 'string' ? incoming.targetModel : String(prev.targetModel || '');
    raw.voiceTTS = {
      apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : String(prev.apiKey || ''),
      targetModel: VOICE_TTS_MODELS.includes(t) ? t : 'qwen-audio-3.0-tts-flash',
      saveDir: typeof incoming.saveDir === 'string' ? incoming.saveDir.trim() : String(prev.saveDir || '')
    };
    settings.writeSettings(raw);
    return { ok: true, settings: raw };
  });

  ipcMain.handle(IPC.Voice.PickAudio, async () => {
    const win = getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择用于克隆音色的音频（推荐 10~20 秒清晰人声）',
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'mp4'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 创建克隆音色（Qwen-TTS：action=create / Qwen-Audio-TTS：action=create_voice）
  ipcMain.handle(IPC.Voice.Create, async (_event, payload?: VoiceCreatePayload) => {
    const cfg = getVoiceConfig();
    const noKey = getVoiceApiError(cfg);
    if (noKey) return { ok: false, message: noKey };
    const audioPath = payload && payload.audioPath;
    // 音色复制时可选目标模型（创建后合成须沿用该模型）
    const useModel = String((payload && payload.targetModel) || '').trim() || cfg.targetModel;
    const isAudio = isAudioTtsModel(useModel);
    // Qwen-Audio-TTS（如 qwen-audio-3.0-tts-flash）克隆仅接受可公开访问的音频 URL
    const isAudioUrl = isAudio && /^https?:\/\//i.test(String(audioPath || ''));
    if (!isAudioUrl && (!audioPath || !fs.existsSync(audioPath))) return { ok: false, message: '音频文件不存在：' + (audioPath || '') };
    let preferredName = String((payload && payload.preferredName) || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!preferredName || preferredName.length > 16) {
      return { ok: false, message: '音色名称需 1~16 个字符，仅限数字、字母、下划线' };
    }
    let dataUri = '';
    if (!isAudioUrl) {
      const mime = VOICE_MIME[path.extname(audioPath as string).toLowerCase()];
      if (!mime) return { ok: false, message: '不支持的音频格式，请使用 wav / mp3 / m4a' };
      let b64 = '';
      try {
        const data = fs.readFileSync(audioPath as string);
        b64 = data.toString('base64');
      } catch (e) {
        return { ok: false, message: '读取音频失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : String(e)) };
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
        ? { action: 'create_voice', target_model: useModel, prefix: preferredName, audio: { url: audioPath } }
        : isAudio
          ? { action: 'create_voice', target_model: useModel, prefix: preferredName, audio: { data: dataUri } }
          : { action: 'create', target_model: useModel, preferred_name: preferredName, audio: { data: dataUri } };
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

  // 内置 Qwen-TTS 系统音色列表（无需 API Key，直接返回；每项附默认合成模型 model）
  ipcMain.handle(IPC.Voice.ListSystemVoices, () => {
    const voices = SYSTEM_VOICES.map((v) => {
      const prof = settings.getVoiceProfiles()['system:' + v.voice];
      return {
        voice: v.voice,
        desc: v.desc,
        langs: v.langs,
        series: v.series,
        model: prof && prof.targetModel ? prof.targetModel : systemVoiceDefaultModel(v)
      };
    });
    return { ok: true, voices: voices, total: voices.length };
  });

  // 候选模型表（音色复制/合成可选模型）
  ipcMain.handle(IPC.Voice.ListModels, () => ({ ok: true, models: VOICE_MODELS }));

  // 本地音色映射：读取 / 保存 / 删除（key 形如 system:<voice> 或 custom:<voice_id>）
  ipcMain.handle(IPC.Voice.GetProfiles, () => ({ ok: true, profiles: settings.getVoiceProfiles() }));
  ipcMain.handle(IPC.Voice.SaveProfile, (_event, payload?: VoiceProfilePayload) => {
    const p = (payload && payload.profile) || {};
    const key = String(p.key || '').trim();
    if (!key || !p.voice || !p.targetModel) return { ok: false, message: '映射信息不完整' };
    settings.saveVoiceProfile(key, {
      key: key,
      name: String(p.name || p.voice || '').trim() || String(p.voice),
      voice: String(p.voice).trim(),
      targetModel: VOICE_TTS_MODELS.includes(p.targetModel) ? p.targetModel : VOICE_TTS_MODELS[0],
      type: p.type === 'system' ? 'system' : 'custom'
    });
    return { ok: true, profiles: settings.getVoiceProfiles() };
  });
  ipcMain.handle(IPC.Voice.DeleteProfile, (_event, payload?: VoiceProfileKeyPayload) => {
    const key = String((payload && payload.key) || '').trim();
    if (!key) return { ok: false, message: '缺少映射 key' };
    settings.deleteVoiceProfile(key);
    return { ok: true, profiles: settings.getVoiceProfiles() };
  });

  // 查询克隆音色列表（action=list）
  ipcMain.handle(IPC.Voice.List, () => fetchClonedVoices());

  // 合并音色列表：系统音色 + 克隆音色，统一 { key, type, name, voiceId, model }（「音色即模型」UI 入口）
  ipcMain.handle(IPC.Voice.ListAll, async () => {
    const profiles = settings.getVoiceProfiles();
    const sysItems = SYSTEM_VOICES.map((v) => {
      const key = 'system:' + v.voice;
      const prof = profiles[key];
      return {
        key: key,
        type: 'system',
        name: (prof && prof.name) || v.desc,
        voiceId: v.voice,
        model: resolveVoiceModel(key, ctx)
      };
    });
    const customItems: { key: string; type: string; name: string; voiceId: string; model: string }[] = [];
    const cloud = await fetchClonedVoices();
    if (cloud.ok && Array.isArray(cloud.voices)) {
      cloud.voices.forEach((v: any) => {
        const voiceId = v.voice || v.voice_id || '';
        if (!voiceId) return;
        const key = 'custom:' + voiceId;
        const prof = profiles[key];
        // 克隆音色模型三级回退：本地映射 targetModel → 云端 target_model → 全局默认
        const cloudModel = String(v.target_model || v.targetModel || '').trim();
        const profModel = (prof && prof.targetModel) || '';
        customItems.push({
          key: key,
          type: 'custom',
          name: (prof && prof.name) || voiceId,
          voiceId: voiceId,
          model: profModel || cloudModel || resolveVoiceModel(key, ctx)
        });
      });
    }
    const voices = sysItems.concat(customItems);
    return { ok: true, voices: voices, total: voices.length, cloudMessage: cloud.ok ? '' : (cloud.message || '') };
  });

  // 选择 TTS 保存的自定义目录（目录选择器）
  ipcMain.handle(IPC.Voice.PickDir, async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win as Electron.BrowserWindow, {
      title: '选择 TTS 音频保存目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, dir: r.filePaths[0] };
  });

  // 扫描已生成 TTS 音频：默认输出目录 + 自定义保存目录 + 各项目 audio/（供渲染层复用为背景音频）
  ipcMain.handle(IPC.Voice.ListGenerated, async () => {
    const cfg = getVoiceConfig();
    const projectsRoot = projects.projectsRoot;
    const AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg|flac|mp4)$/i;
    const items: { path: string; name: string; group: string; size: number; mtime: number }[] = [];
    const seen = new Set<string>();
    const pushDir = (dir: string, group: string) => {
      if (!dir || !fs.existsSync(dir)) return;
      let names: string[];
      try { names = fs.readdirSync(dir); } catch (e) { return; }
      names.forEach((f) => {
        if (!AUDIO_RE.test(f)) return;
        const p = path.join(dir, f);
        if (seen.has(p)) return;
        seen.add(p);
        let st: fs.Stats | null = null;
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
      let projs: string[];
      try { projs = fs.readdirSync(projectsRoot); } catch (e) { projs = []; }
      projs.forEach((proj) => {
        pushDir(path.join(projectsRoot, proj, 'audio'), '项目 · ' + proj);
      });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, items: items, total: items.length };
  });

  // 文字合成语音并保存（Qwen-TTS：generation 取 audio.url 下载 / Qwen-Audio-TTS：SpeechSynthesizer 直写音频流）
  ipcMain.handle(IPC.Voice.Synth, async (_event, payload?: VoiceSynthPayload) => {
    const cfg = getVoiceConfig();
    const noKey = getVoiceApiError(cfg);
    if (noKey) return { ok: false, message: noKey };
    const text = String((payload && payload.text) || '').trim();
    const voice = String((payload && payload.voice) || '').trim();
    if (!text) return { ok: false, message: '合成文本为空' };
    if (!voice) return { ok: false, message: '请先选择（或创建）音色' };
    try {
      // 合成使用的模型：优先取「当前音色绑定/选定的模型」，无则回落全局默认（与克隆创建时的 target_model 保持一致）
      const useModel = String((payload && payload.targetModel) || '').trim() || cfg.targetModel;
      const { buf, ext } = await synthOne(text, voice, useModel);

      const projectName = String((payload && payload.projectName) || '').trim();
      const saveDir = String((payload && payload.saveDir) || '').trim();
      const defaultOut = !!(payload && payload.defaultOut);
      // 保存位置三选一（前端显式传入，不再回落持久化 saveDir，避免「保存到项目」被静默忽略）：
      // 自定义目录 > 音频输出目录 > 所选项目 audio/
      const destDir = saveDir
        ? resolveTtsDir('', saveDir)
        : defaultOut
          ? path.join(app.getPath('userData'), 'tts-output')
          : resolveTtsDir(projectName, '');
      fs.mkdirSync(destDir, { recursive: true });
      // 文件名：自定义 audioName（可选）优先；缺省用「时间_前五个字_音色id」
      const NAME_BAD = /[\\/:*?"<>|]/g;
      const customName = String((payload && payload.audioName) || '').trim().replace(NAME_BAD, ' ').replace(/\s+/g, ' ').trim();
      const stamp = nowStamp();
      const short = String(voice).replace(/[^a-zA-Z0-9_]/g, '').slice(-12) || 'voice';
      let base;
      if (customName) {
        base = customName;
      } else {
        const head = Array.from(text).slice(0, 5).join('').replace(NAME_BAD, '').trim() || 'tts';
        base = stamp + '_' + head + '_' + short;
      }
      const saveName = base + '.' + ext;
      const savePath = path.join(destDir, saveName);
      fs.writeFileSync(savePath, buf);

      // 落盘位置回执：仅实际写入项目 audio/ 时才回写 project.json 并返回项目名，
      // 存到自定义目录 / 音频输出目录时不再冒充「已保存到项目」
      let savedTo = saveDir ? 'custom' : defaultOut ? 'output' : 'default';
      let targetName = projectName || '';
      const projectsRoot = projects.projectsRoot;
      if (!saveDir && !defaultOut && projectName) {
        const projDir = path.join(projectsRoot, projectName);
        const pf = path.join(projDir, 'project.json');
        if (fs.existsSync(pf)) {
          try {
            const proj = JSON.parse(fs.readFileSync(pf, 'utf8'));
            proj.ttsAudio = path.join('audio', path.basename(savePath));
            fs.writeFileSync(pf, JSON.stringify(proj, null, 2), 'utf8');
          } catch (e) { /* 不阻断主流程 */ }
        }
        savedTo = 'project';
      } else if (!saveDir && !defaultOut) {
        const projs = projects.scanProjects();
        if (projs && projs.length) { targetName = projs[0].name; savedTo = 'project'; }
        else savedTo = 'output';
      }

      return { ok: true, savePath: savePath, projectName: targetName, savedTo: savedTo, size: buf.length };
    } catch (e) {
      return { ok: false, message: voiceFriendlyError(e, '合成语音失败') };
    }
  });
}

export {
  synthOne,
  register,
  isAudioTtsModel,
  getVoiceApiError,
  parseJsonLike,
  voiceFriendlyError,
  nowStamp,
  guessAudioExt,
  resolveTtsDir,
  resolveVoiceModel,
  fetchClonedVoices
};
