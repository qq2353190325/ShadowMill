// src/main/settings.ts
// 设置存储（userData/settings.json）与 OpenAI 兼容客户端工具
// 提供：readSettings / writeSettings / getCustomModel / getVoiceConfig / getUpdaterSettings
//       以及 settings:get / settings:save / settings:save-render / settings:save-updater / settings:test IPC
//       + whisper 当前模型档位与自定义模型列表（getWhisperModel / saveWhisperModel / getWhisperCustomModels / saveWhisperCustomModels）
//       + 视频渲染档位的白名单校验（DEFAULT_RENDER / normalizeRenderOptions / pickRenderOverride，供 projects.ts / video.ts 复用）
// 依赖：app / ipcMain / fs / path / openai
import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import OpenAI from 'openai'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  CustomModelConfig,
  RegisterCtx,
  RenderFps,
  RenderOptions,
  RenderOverride,
  RenderQuality,
  SettingsSaveRenderPayload,
  SettingsSaveUpdaterPayload,
  UpdaterSettings,
  VoiceProfile,
  VoiceTTSConfig,
  WhisperCustomModel
} from '../shared/types'

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

// ===== 视频渲染档位（普通用户只有质量 + 帧率两项）=====
// 白名单只此一处：projects.ts（项目覆盖落盘）、video.ts（渲染参数）都复用这里，避免校验三处漂移。
const DEFAULT_RENDER: RenderOptions = { quality: 'standard', fps: 30 };
const RENDER_QUALITIES: RenderQuality[] = ['draft', 'standard', 'high'];
const RENDER_FPS: RenderFps[] = [24, 30];

// 完整档位：非法/缺省字段一律回退 fallback
function normalizeRenderOptions(raw: unknown, fallback: RenderOptions = DEFAULT_RENDER): RenderOptions {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const quality = RENDER_QUALITIES.indexOf(src.quality as RenderQuality) >= 0 ? src.quality as RenderQuality : fallback.quality;
  const fps = RENDER_FPS.indexOf(Number(src.fps) as RenderFps) >= 0 ? Number(src.fps) as RenderFps : fallback.fps;
  return { quality, fps };
}

// 仅保留显式给出的合法字段：没给 ≠ 要默认值（项目覆盖与「未选档位就不传参数」都靠它）
function pickRenderOverride(raw: unknown): RenderOverride {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: RenderOverride = {};
  if (RENDER_QUALITIES.indexOf(src.quality as RenderQuality) >= 0) out.quality = src.quality as RenderQuality;
  if (RENDER_FPS.indexOf(Number(src.fps) as RenderFps) >= 0) out.fps = Number(src.fps) as RenderFps;
  return out;
}

// ===== 应用自更新设置：与渲染档位同思路，非法/缺省字段一律回退默认 =====
// feedUrl 不做 URL 合法性校验（内网地址形态多），仅 trim 且要求 http(s) 开头，避免把本地路径塞进来；
// autoCheck 缺省即 true（旧用户升级上来默认开启启动静默检查）；skippedVersion 为空串表示没有跳过任何版本。
function normalizeUpdaterSettings(raw: unknown, fallback?: UpdaterSettings): UpdaterSettings {
  const base = fallback || { feedUrl: '', autoCheck: true, skippedVersion: '' };
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const rawUrl = typeof src.feedUrl === 'string' ? src.feedUrl.trim() : '';
  const feedUrl = (rawUrl === '' || /^https?:\/\//i.test(rawUrl)) ? rawUrl : base.feedUrl;
  const autoCheck = typeof src.autoCheck === 'boolean' ? src.autoCheck : base.autoCheck;
  const skippedVersion = typeof src.skippedVersion === 'string' ? src.skippedVersion.trim() : base.skippedVersion;
  return { feedUrl, autoCheck, skippedVersion };
}

const DEFAULT_SETTINGS = (): AppSettings => ({
  customModel: { baseUrl: '', modelId: '', apiKey: '', enabled: false },
  voiceTTS: { apiKey: '', targetModel: 'qwen-audio-3.0-tts-flash', saveDir: '' },
  voiceProfiles: {}, // 本地音色映射：key 形如 "system:Cherry" / "custom:<voice_id>"，值为 { key, name, voice, targetModel, type }
  whisper: { modelId: '', customModels: [] }, // 语音识别（whisper.cpp）：modelId 为当前使用档位，customModels 为用户自定义模型条目
  render: Object.assign({}, DEFAULT_RENDER), // 视频渲染全局默认档位（项目未覆盖时生效）
  // 应用自更新：feedUrl 留空即用打包时 app-update.yml 里的地址；autoCheck 为启动后静默检查
  updater: { feedUrl: '', autoCheck: true, skippedVersion: '' }
});

function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const base = DEFAULT_SETTINGS();
    return {
      customModel: Object.assign({}, base.customModel, (raw && raw.customModel) || {}),
      voiceTTS: Object.assign({}, base.voiceTTS, (raw && raw.voiceTTS) || {}),
      voiceProfiles: Object.assign({}, (raw && raw.voiceProfiles) || {}),
      whisper: Object.assign({}, base.whisper, (raw && raw.whisper) || {}),
      // 渲染档位：旧 settings.json（无 render 字段）落回默认；已写入的值经白名单规范化
      render: normalizeRenderOptions(raw && raw.render),
      // 更新设置：旧 settings.json（无 updater 字段）落回默认；逐字段做类型收敛
      updater: normalizeUpdaterSettings(raw && raw.updater)
    };
  } catch (e) {
    return DEFAULT_SETTINGS();
  }
}
function writeSettings(s: AppSettings): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
}
function getCustomModel(): CustomModelConfig {
  const s = readSettings();
  return s.customModel || DEFAULT_SETTINGS().customModel;
}
function getVoiceConfig(): VoiceTTSConfig {
  const s = readSettings();
  return Object.assign({}, DEFAULT_SETTINGS().voiceTTS, (s && s.voiceTTS) || {});
}
// ===== 应用自更新设置：持久化在 settings.json 的 updater 段（updater.ts 依赖本函数读 feedUrl / autoCheck）=====
function getUpdaterSettings(): UpdaterSettings {
  const s = readSettings();
  return normalizeUpdaterSettings(s && s.updater);
}
// 只更新传入的字段：saveUpdaterSettings({ skippedVersion: '1.0.2' }) 不会清掉 feedUrl
function saveUpdaterSettings(patch?: Partial<UpdaterSettings>): UpdaterSettings {
  const cur = readSettings();
  const merged = Object.assign({}, cur.updater, patch || {});
  cur.updater = normalizeUpdaterSettings(merged);
  writeSettings(cur);
  return cur.updater;
}
// ===== 语音识别（whisper.cpp）当前模型档位：持久化在 settings.json 的 whisper.modelId =====
function getWhisperModel(): string {
  const s = readSettings();
  return (s && s.whisper && s.whisper.modelId) || '';
}
function saveWhisperModel(id: string): string {
  const s = readSettings();
  s.whisper = Object.assign({}, s.whisper || {}, { modelId: typeof id === 'string' ? id : '' });
  writeSettings(s);
  return getWhisperModel();
}
// ===== 语音识别自定义模型列表：持久化在 settings.json 的 whisper.customModels =====
// 条目结构：{ id, name, file, url, sizeMB, desc }；id 由文件名派生（ggml-base-q5_1.bin → base-q5_1）
function getWhisperCustomModels(): WhisperCustomModel[] {
  const s = readSettings();
  const list = (s && s.whisper && s.whisper.customModels) || [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((c: any) => c && typeof c === 'object' && typeof c.file === 'string' && c.file)
    .map((c: any) => ({
      id: typeof c.id === 'string' && c.id ? c.id : String(c.file).replace(/^ggml-/i, '').replace(/\.bin$/i, ''),
      name: typeof c.name === 'string' ? c.name : '',
      file: c.file,
      url: typeof c.url === 'string' ? c.url : '',
      sizeMB: Number(c.sizeMB) || 0,
      desc: typeof c.desc === 'string' ? c.desc : ''
    }));
}
function saveWhisperCustomModels(list: WhisperCustomModel[]): WhisperCustomModel[] {
  const s = readSettings();
  s.whisper = Object.assign({}, s.whisper || {}, { customModels: Array.isArray(list) ? list : [] });
  writeSettings(s);
  return getWhisperCustomModels();
}
function getVoiceProfiles(): Record<string, VoiceProfile> {
  const s = readSettings();
  return Object.assign({}, (s && s.voiceProfiles) || {});
}
function saveVoiceProfile(key: string, profile: VoiceProfile): Record<string, VoiceProfile> {
  const s = readSettings();
  s.voiceProfiles = s.voiceProfiles || {};
  s.voiceProfiles[key] = profile;
  writeSettings(s);
  return getVoiceProfiles();
}
function deleteVoiceProfile(key: string): Record<string, VoiceProfile> {
  const s = readSettings();
  if (s.voiceProfiles && Object.prototype.hasOwnProperty.call(s.voiceProfiles, key)) {
    delete s.voiceProfiles[key];
  }
  writeSettings(s);
  return getVoiceProfiles();
}

function register(ctx?: RegisterCtx): void {
  void ctx;

  ipcMain.handle(IPC.Settings.Get, () => readSettings());

  ipcMain.handle(IPC.Settings.Save, (_event, payload?: { customModel?: Partial<CustomModelConfig> }) => {
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

  // 渲染默认档位（普通用户两项：质量 + 帧率）：只更新 render 段，不动 customModel
  ipcMain.handle(IPC.Settings.SaveRender, (_event, payload?: SettingsSaveRenderPayload) => {
    const cur = readSettings();
    cur.render = normalizeRenderOptions(Object.assign({}, cur.render, (payload && payload.render) || {}));
    writeSettings(cur);
    return { ok: true, settings: cur };
  });

  // 更新源与自动检查开关（普通用户一般不用填）：只更新 updater 段，不动 customModel / render
  ipcMain.handle(IPC.Settings.SaveUpdater, (_event, payload?: SettingsSaveUpdaterPayload) => {
    saveUpdaterSettings((payload && payload.updater) || {});
    return { ok: true, settings: readSettings() };
  });

  // 测试连接：用当前（或传入的待测）配置发起一次最小对话，必须拿到模型返回文本才算成功
  ipcMain.handle(IPC.Settings.Test, async (_event, payload?: { customModel?: Partial<CustomModelConfig> }) => {
    const m = Object.assign({}, getCustomModel(), (payload && payload.customModel) || {});
    if (!m.baseUrl || !m.modelId || !m.apiKey) {
      return { ok: false, message: '配置不完整：Base URL / Model ID / API Key 均需填写' };
    }
    try {
      let text = '';
      if (typeof OpenAI === 'function') {
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
      return { ok: false, message: '连接失败：' + (e && (e as Error).message ? (e as Error).message : String(e)) };
    }
  });
}

export {
  register,
  readSettings,
  writeSettings,
  DEFAULT_RENDER,
  normalizeRenderOptions,
  pickRenderOverride,
  getCustomModel,
  getVoiceConfig,
  getUpdaterSettings,
  saveUpdaterSettings,
  getWhisperModel,
  saveWhisperModel,
  getWhisperCustomModels,
  saveWhisperCustomModels,
  getVoiceProfiles,
  saveVoiceProfile,
  deleteVoiceProfile,
  DEFAULT_SETTINGS
};
