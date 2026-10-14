// src/main/settings.ts
// 设置存储（userData/settings.json）与 OpenAI 兼容客户端工具
// 提供：readSettings / writeSettings / getCustomModel / getVoiceSettings / getVoiceProviderConfig /
//       saveVoiceProviderConfig / getUpdaterSettings
//       以及 settings:get / settings:save / settings:save-render / settings:save-updater / settings:test IPC
//       + whisper 当前模型档位与自定义模型列表（getWhisperModel / saveWhisperModel / getWhisperCustomModels / saveWhisperCustomModels）
//       + 视频渲染档位的白名单校验（DEFAULT_RENDER / normalizeRenderOptions / pickRenderOverride，供 projects.ts / video.ts 复用）
//       + OpenAI SDK 懒加载入口（loadOpenAI，供 settings:test 与 htmlAgent 共用）
// 依赖：app / ipcMain / fs / path（openai 为懒加载，不在启动路径上）
import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
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
  VoiceProviderConfig,
  VoiceSettings,
  VoiceTTSConfig,
  WhisperCustomModel
} from '../shared/types'
import { DEFAULT_PROVIDER_KEY, providerByKey, type VoiceProviderDef } from './voiceCatalog'

// ===== OpenAI SDK 懒加载（settings:test 与 htmlAgent 共用）=====
// openai SDK 的模块图较大（require 实测 ~110ms，冷启动 + 杀软扫描时更久）。它只在**真正要发请求**的
// 两处才需要（测试连接 / 生成或修改 HTML），而这两处都在用户动作之后，因此顶层不再 import：
// 改成首次用到时 require，主进程启动路径（建窗 → 首屏）不再为它买单。
// 返回 null 表示 SDK 不可用，调用方各自落到内置 fetch 兜底分支（两处都已有该分支）。
let openaiCtor: unknown = null
let openaiLoadTried = false
function loadOpenAI(): any {
  if (!openaiLoadTried) {
    openaiLoadTried = true
    try {
      const mod: any = require('openai')
      openaiCtor = (mod && (mod.default || mod)) || null
    } catch (e) {
      openaiCtor = null
    }
  }
  return typeof openaiCtor === 'function' ? openaiCtor : null
}

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

// 语音服务默认值：按厂家组织，默认厂家与它的「出厂空配置」（只有 API Key，没有全局模型设置）
const defaultVoiceProviders = (): Record<string, VoiceProviderConfig> => ({
  [DEFAULT_PROVIDER_KEY]: { apiKey: '' }
});

const DEFAULT_SETTINGS = (): AppSettings => ({
  customModel: { baseUrl: '', modelId: '', apiKey: '', enabled: false },
  // 语音服务（按厂家）：只有 API Key；模型与音色的对应关系写死在 voiceCatalog 的厂家目录里
  voice: { active: DEFAULT_PROVIDER_KEY, providers: defaultVoiceProviders(), saveDir: '' },
  voiceProfiles: {}, // 本地音色映射：key 形如 "system:Cherry" / "custom:<voice_id>"，值为 { key, name, voice, targetModel, type }
  whisper: { modelId: '', customModels: [] }, // 语音识别（whisper.cpp）：modelId 为当前使用档位，customModels 为用户自定义模型条目
  render: Object.assign({}, DEFAULT_RENDER), // 视频渲染全局默认档位（项目未覆盖时生效）
  // 应用自更新：feedUrl 留空即用打包时 app-update.yml 里的地址；autoCheck 为启动后静默检查
  updater: { feedUrl: '', autoCheck: true, skippedVersion: '' }
});

// 语音服务设置规范化 + 旧结构迁移。
// 旧版是单厂家、无厂家字段的 voiceTTS: { apiKey, targetModel, saveDir }；这里把 **apiKey** 搬进
// providers[qwen]（只在还空着时填，绝不覆盖新结构里已有的值），saveDir 归到全局那一份。
// 旧字段 targetModel（全局「目标模型」）**已废弃、不再读取**：系统音色与模型是固定绑定（写死在厂家目录里），
// 克隆音色按各自的映射/云端 target_model 走，所以迁移时直接丢弃，不搬进新结构。
// 迁移结果由 readSettings 返回；下一次写入（任一保存动作）就会把旧字段从文件里挤掉。
function normalizeVoiceSettings(raw: unknown, legacy: unknown): VoiceSettings {
  const base = DEFAULT_SETTINGS().voice;
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const legacySrc = (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) ? legacy as Record<string, unknown> : {};
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const providers: Record<string, VoiceProviderConfig> = {};
  const rawProviders = (src.providers && typeof src.providers === 'object' && !Array.isArray(src.providers))
    ? src.providers as Record<string, unknown>
    : {};
  for (const key of Object.keys(rawProviders)) {
    const p = (rawProviders[key] && typeof rawProviders[key] === 'object') ? rawProviders[key] as Record<string, unknown> : {};
    providers[key] = { apiKey: s(p.apiKey) };
  }

  // 旧字段迁移到兜底厂家（qwen）：填缺失项，不覆盖已有值
  const legacyKey = DEFAULT_PROVIDER_KEY;
  if (!providers[legacyKey]) providers[legacyKey] = { apiKey: '' };
  const legacyApiKey = s(legacySrc.apiKey);
  if (!providers[legacyKey].apiKey && legacyApiKey) providers[legacyKey].apiKey = legacyApiKey;

  const active = s(src.active) || base.active;
  return {
    active: providers[active] ? active : base.active,
    providers,
    saveDir: s(src.saveDir) || s(legacySrc.saveDir)
  };
}

function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const base = DEFAULT_SETTINGS();
    const out: AppSettings = {
      customModel: Object.assign({}, base.customModel, (raw && raw.customModel) || {}),
      voice: normalizeVoiceSettings(raw && raw.voice, raw && raw.voiceTTS),
      voiceProfiles: Object.assign({}, (raw && raw.voiceProfiles) || {}),
      whisper: Object.assign({}, base.whisper, (raw && raw.whisper) || {}),
      // 渲染档位：旧 settings.json（无 render 字段）落回默认；已写入的值经白名单规范化
      render: normalizeRenderOptions(raw && raw.render),
      // 更新设置：旧 settings.json（无 updater 字段）落回默认；逐字段做类型收敛
      updater: normalizeUpdaterSettings(raw && raw.updater)
    };
    // 旧结构原样带出（只读兼容：isPristineSettings 等仍可能要看它），但不参与新逻辑；
    // 它不会随 writeSettings 落盘（写的是 out 这份，没有 voiceTTS 字段）
    if (raw && raw.voiceTTS && typeof raw.voiceTTS === 'object') out.voiceTTS = raw.voiceTTS as VoiceTTSConfig;
    return out;
  } catch (e) {
    return DEFAULT_SETTINGS();
  }
}
function writeSettings(s: AppSettings): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  // 只写新结构：旧 voiceTTS 若还在内存里（readSettings 带出的兼容字段）也不落盘，避免两处漂移
  const { voiceTTS: _legacy, ...next } = s;
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
}
function getCustomModel(): CustomModelConfig {
  const s = readSettings();
  return s.customModel || DEFAULT_SETTINGS().customModel;
}
function getVoiceSettings(): VoiceSettings {
  const s = readSettings();
  return s.voice || DEFAULT_SETTINGS().voice;
}
/** 取某厂家（缺省 = active）的配置 + 目录定义；配置缺失时按出厂空值补齐 */
function getVoiceProviderConfig(key?: string): { key: string; config: VoiceProviderConfig; def: VoiceProviderDef } {
  const vs = getVoiceSettings();
  const def = providerByKey(key || vs.active);
  const cfg = vs.providers[def.key] || { apiKey: '' };
  return { key: def.key, config: { apiKey: cfg.apiKey || '' }, def };
}
/** 保存某厂家的配置（只更新传入的字段）；provider 缺省 = 当前 active。`saveDir` 给了就一并更新那一份全局设置 */
function saveVoiceProviderConfig(provider: string | undefined, patch: Partial<VoiceProviderConfig>, saveDir?: string): VoiceSettings {
  const cur = readSettings();
  const vs = normalizeVoiceSettings(cur.voice, cur.voiceTTS);
  const def = providerByKey(provider || vs.active);
  const prev = vs.providers[def.key] || { apiKey: '' };
  const next: VoiceProviderConfig = {
    apiKey: typeof patch.apiKey === 'string' ? patch.apiKey.trim() : prev.apiKey
  };
  const merged: VoiceSettings = {
    active: def.key, // 保存某厂家即切到该厂家
    providers: Object.assign({}, vs.providers, { [def.key]: next }),
    saveDir: typeof saveDir === 'string' ? saveDir.trim() : vs.saveDir
  };
  writeSettings(Object.assign({}, cur, { voice: merged }));
  return merged;
}
/** 只改全局的自定义保存目录（「保存到：自定义目录」用），不动任何厂家的 Key、也不切换 active */
function saveVoiceSaveDir(dir: string): VoiceSettings {
  const cur = readSettings();
  const vs = normalizeVoiceSettings(cur.voice, cur.voiceTTS);
  const merged: VoiceSettings = { active: vs.active, providers: vs.providers, saveDir: String(dir || '').trim() };
  writeSettings(Object.assign({}, cur, { voice: merged }));
  return merged;
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
      const OpenAI = loadOpenAI();
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
      return { ok: false, message: '连接失败：' + (e && (e as Error).message ? (e as Error).message : String(e)) };
    }
  });
}

// 判断指定的 settings.json 是否还是「出厂状态」（用户在这个位置什么都没配过）。
// 用途：index.ts 迁移老数据（migrateFrom）时，只有在**新位置还没被配置过**的情况下才用老配置覆盖 settings.json，
// 否则会把用户在新位置刚配好的东西冲掉。
// 只把「用户投入过的字段」算作动过：API Key / Base URL / Model ID / 自定义音色表 / 识别模型档位 /
// 保存目录 / 更新源地址。像 updater.autoCheck、render.quality 这种**开关故意不阻断覆盖**——
// 丢一个开关是两次点击能补回来的，而丢 API Key 要用户去控制台重新翻出来。
function isPristineSettings(file: string): boolean {
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return true; } // 不存在 / 损坏 ⇒ 视为出厂
  if (!raw || typeof raw !== 'object') return true;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const cm = (raw.customModel || {}) as Record<string, unknown>;
  const vt = (raw.voiceTTS || {}) as Record<string, unknown>;
  // 语音服务已改成按厂家存：新结构 voice.providers[*].apiKey / voice.saveDir 都算「用户投入过」；
  // 旧结构 voiceTTS 仍要认（迁移前的老文件就是那个形状）。
  const vs = (raw.voice || {}) as Record<string, unknown>;
  const vproviders = (vs.providers && typeof vs.providers === 'object') ? vs.providers as Record<string, unknown> : {};
  const anyProviderKey = Object.keys(vproviders).some((k) => {
    const p = (vproviders[k] && typeof vproviders[k] === 'object') ? vproviders[k] as Record<string, unknown> : {};
    return !!s(p.apiKey);
  });
  const wp = (raw.whisper || {}) as Record<string, unknown>;
  const up = (raw.updater || {}) as Record<string, unknown>;
  const profiles = (raw.voiceProfiles || {}) as Record<string, unknown>;
  const touched =
    !!s(cm.apiKey) || !!s(cm.baseUrl) || !!s(cm.modelId) || cm.enabled === true ||
    anyProviderKey || !!s(vs.saveDir) ||
    !!s(vt.apiKey) || !!s(vt.saveDir) ||
    !!s(wp.modelId) || (Array.isArray(wp.customModels) && wp.customModels.length > 0) ||
    !!s(up.feedUrl) ||
    Object.keys(profiles).length > 0;
  return !touched;
}

export {
  register,
  readSettings,
  writeSettings,
  loadOpenAI,
  isPristineSettings,
  DEFAULT_RENDER,
  normalizeRenderOptions,
  pickRenderOverride,
  getCustomModel,
  getVoiceSettings,
  getVoiceProviderConfig,
  saveVoiceProviderConfig,
  saveVoiceSaveDir,
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
