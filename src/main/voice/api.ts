// src/main/voice/api.ts
// 语音接口层：厂家解析（谁家的话走谁家的端点与 Key）、错误文案、音色→模型解析、克隆音色列表、单次合成。
// **只做纯逻辑与 HTTP**：不注册任何 IPC（频道在 ipc/ 下，装配在 register.ts）。
//
// 依赖：settings（各厂家 Key / 音色映射）/ projects（落盘目录）/ catalog（按厂家组织的模型表与音色表）/
//       shared/errors（人话错误文案）。录制参考音频在 cloneAudio.ts，IPC 在 ipc/。
import { app } from 'electron'
import path from 'node:path'
import * as settings from '../settings'
import * as projects from '../projects'
import { providerByKey, providerOfModel, providerOfSystemVoice, seriesDefaultModel, type VoiceProviderDef } from './catalog'
import { friendlyError } from '../../shared/errors'
import type { ConfigTarget, RegisterCtx, SystemVoice } from '../../shared/types'

// 模型表 / 端点 / 克隆模型名全部来自 catalog（按厂家组织）
// Qwen-Audio-TTS 系列模型名特征（如 qwen-audio-3.0-tts-flash / qwen-audio-3.0-tts-plus）；
// 也是「能不能作复刻目标模型」的唯一判据（vc 系列已移除）
export function isAudioTtsModel(model: string): boolean {
  return /^qwen-audio-.*-tts/i.test(String(model || ''));
}

// ===== 厂家解析（谁家的话走谁家的端点与 Key）=====
// 当前选中的厂家（settings.voice.active）——「克隆音色列表」这类没有模型信息的调用用它
function activeProviderDef(): VoiceProviderDef {
  return providerByKey(settings.getVoiceSettings().active);
}
// 模型 → 厂家（最准）；系统音色按它所属厂家；都没有则退回当前 active 厂家。
// defaultModel 一律取**厂家目录里的出厂默认**（不再有用户可改的「厂家默认模型」）。
function providerFor(voice?: string, model?: string): { def: VoiceProviderDef; apiKey: string; defaultModel: string } {
  const def = (model ? providerOfModel(model) : null) || providerOfSystemVoice(voice) || activeProviderDef();
  const { config } = settings.getVoiceProviderConfig(def.key);
  return { def, apiKey: config.apiKey, defaultModel: def.defaultModel };
}
/** 该模型是否在这个厂家的模型表里（用来识别「映射里绑的是已下线/不存在的模型」） */
function modelKnownFor(provider: VoiceProviderDef, model?: string): boolean {
  const m = String(model || '').trim();
  return !!m && provider.models.some((x) => x.id === m);
}
// 音色与模型必须同厂家：音色名是厂家私有的（千问是 Cherry/Serena… 这类 voice 参数，别家是另一套 id），
// 把千问的音色发给别家端点只会得到「音色不存在」这种看不出原因的报错。这里统一给出**明确提示**，
// 不做静默改名、也不静默换厂家。返回 null = 没问题。
// 克隆音色（custom:xxx）拿不到厂家信息（在云端），按模型所属厂家处理，不在此拦。
function vendorMismatch(voice?: string, model?: string): string | null {
  const v = String(voice || '').trim();
  const m = String(model || '').trim();
  if (!v || !m) return null;
  const vProvider = providerOfSystemVoice(v);
  if (!vProvider) return null;
  const mProvider = providerOfModel(m);
  if (!mProvider || mProvider.key === vProvider.key) return null;
  return '音色「' + v + '」属于「' + vProvider.label + '」，而模型「' + m + '」属于「' + mProvider.label
    + '」：两者必须同属一个厂家，请改选模型，或到「音色管理 → 音色映射管理」改绑该音色的模型。';
}
function getVoiceApiError(provider: VoiceProviderDef, apiKey: string): string | null {
  return apiKey ? null : '未配置「' + provider.label + '」的 API Key，请先到「设置」-「语音服务」填写并保存';
}
// 未配置 Key 是「配置类」错误：带上 needConfig，界面据此弹「去设置 / 取消」弹窗而不是只显示一行红字
function voiceNoKeyFail(msg: string): { ok: false; message: string; needConfig: ConfigTarget } {
  return { ok: false, message: msg, needConfig: 'voice' };
}
function parseJsonLike(text: string): Record<string, any> | null {
  try { return JSON.parse(text); } catch (e) { return null; }
}
// 语音侧的错误翻译：统一走 shared/errors 的 friendlyError（人话文案 + 排障详情）。
// 与旧实现（本地 4 条 if 链）的差异：
//   ① 余额 / 欠费独立成档——阿里云是 **400 + Arrearage**（不是 402），旧实现把它混在「额度不足」里只加个前缀；
//   ② 限流按官方三个维度分档（Throttling.RateQuota / AllocationQuota / BurstRate，兼容模式别名为
//      limit_requests / insufficient_quota / limit_burst_rate）；
//   ③ 合规拦截（DataInspectionFailed）给出「改字幕 / 换素材」这种可操作的说法。
// **保留原始报文**：旧行为是把原文拼进 message（终端用户能据此报障），故这里把 detail 追加回文案，
// 界面只有在判出「配置类」时才只显示前面那句人话（见 docs/error-mapping.md §11.1）。
function voiceFriendlyError(err: unknown, label: string): string {
  const f = friendlyError(err, { label, provider: activeProviderDef().key, baseUrl: activeProviderDef().apiBase });
  return f.detail ? f.message + '（' + f.detail + '）' : f.message;
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
  const projectsRoot = projects.projectsRoot();
  if (projectName) {
    const dir = path.join(projectsRoot, projectName);
    return path.join(dir, 'audio');
  }
  const projs = projects.scanProjects();
  if (projs && projs.length) return path.join(projectsRoot, projs[0].name, 'audio');
  return path.join(app.getPath('userData'), 'tts-output');
}

// 系统音色默认合成模型：交给 catalog 按「该厂家的模型表 + 音色的 series」推导（替代原先写死的映射表）
function systemVoiceDefaultModel(provider: VoiceProviderDef, v: SystemVoice | Record<string, never>): string {
  return seriesDefaultModel(provider, (v as SystemVoice).series);
}

// 统一「音色→模型」解析（voice:list-all 等共用单一入口）
// 三级：① 本地映射 voiceProfiles[voiceKey].targetModel（**必须是该厂家模型表里现存的模型**，
//          绑着已下线/不存在的模型时忽略它，否则合成必然 404「Model not exist」）；
//       ② 系统音色按它的 series 取该厂家的系统合成模型（系统音色与模型是固定绑定）；
//       ③ 兜底「当前厂家的出厂默认模型」。
function resolveVoiceModel(voiceKey: string, _ctx?: RegisterCtx): string {
  const key = String(voiceKey || '').trim();
  const bare = key.replace(/^(system|custom):/i, ''); // 兼容带前缀 key（system:Cherry / custom:<voice_id>）
  const sysProvider = providerOfSystemVoice(bare);
  const provider = sysProvider || activeProviderDef();
  const profiles = settings.getVoiceProfiles();
  const prof = profiles[key] || profiles[bare];
  if (prof && prof.targetModel && modelKnownFor(provider, prof.targetModel)) return prof.targetModel; // ① 本地映射命中
  if (sysProvider) { // ② 系统音色：按系列取该厂家的系统合成模型
    const sys = sysProvider.voices.find((v) => v.voice === bare);
    return systemVoiceDefaultModel(sysProvider, sys || {});
  }
  // ③ 兜底：当前厂家的出厂默认模型
  return provider.defaultModel;
}

// 查询克隆音色列表，供 voice:list / voice:list-all 复用。
// 接口：model=voice-enrollment（厂家的克隆模型）+ action=list_voice。
// 历史坑（2026-10-14 实测）：这里曾只查 qwen-voice-enrollment 的 action=list（Qwen-TTS/vc 系列），
// 而创建走的是 voice-enrollment 的 create_voice —— 于是新建的音色云端 status=OK、本地映射也有中文名，
// 「我的音色」里却看不见。vc 那条线已彻底移除，现在只有一套接口，不再存在两边错配的问题。
// 返回字段兼容：接口给 `voice_id`，历史数据给 `voice`，这里统一成两者都填同一个 id，
// 并把 `target_model` / `targetModel` 补齐，渲染层不必再按系列分支。
// 克隆音色属于某个账号 ⇒ 必须用「该厂家」的 Key 与该厂家的端点；providerKey 缺省 = 当前 active 厂家
async function fetchClonedVoices(providerKey?: string): Promise<{ ok: boolean; voices?: any[]; total?: number; message?: string }> {
  const provider = providerKey ? providerByKey(providerKey) : activeProviderDef();
  const key = settings.getVoiceProviderConfig(provider.key).config.apiKey;
  const noKey = getVoiceApiError(provider, key);
  if (noKey) return voiceNoKeyFail(noKey);
  try {
    const resp = await fetch(provider.apiBase + '/services/audio/tts/customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: provider.enrollModel, input: { action: 'list_voice', page_size: 100, page_index: 0 } })
    });
    const raw = await resp.text();
    const json = parseJsonLike(raw);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ((json && json.message) ? '：' + json.message : ''));
    const out = (json && json.output) || {};
    const list = Array.isArray(out.voice_list) ? out.voice_list : [];
    const voices: any[] = [];
    const seen: Record<string, boolean> = {};
    list.forEach((v: any) => {
      const id = String((v && (v.voice || v.voice_id)) || '').trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      const model = String((v && (v.target_model || v.targetModel)) || '').trim();
      voices.push(Object.assign({}, v, { voice: id, voice_id: id, target_model: model, targetModel: model }));
    });
    return { ok: true, voices: voices, total: voices.length };
  } catch (e) {
    return { ok: false, message: voiceFriendlyError(e, '查询音色失败') };
  }
}

// 单次文字合成（不落盘）：两个系列都是「接口 → output.audio.url → 二次下载」
// （Qwen-Audio-TTS 走 SpeechSynthesizer、Qwen-TTS 走 multimodal-generation，响应体都是 JSON）
// 返回 { buf, ext }；失败抛错（由调用方 voiceFriendlyError 包装）。供 voice:synth 与 ttsAlign 逐句合成共用
// 用哪个厂家的 Key 由「合成模型」决定（模型属于哪家就走哪家）；模型为空时按音色所属厂家。
async function synthOne(text: string, voice: string, useModel: string): Promise<{ buf: Buffer; ext: string }> {
  const mismatch = vendorMismatch(voice, useModel);
  if (mismatch) throw new Error(mismatch);
  const prov = providerFor(voice, useModel);
  const noKey = getVoiceApiError(prov.def, prov.apiKey);
  if (noKey) throw new Error(noKey);
  const isAudio = isAudioTtsModel(useModel);
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + prov.apiKey };
  if (isAudio) {
    // Qwen-Audio-TTS 系列：POST /services/audio/tts/SpeechSynthesizer
    // **这个端点不回音频流**，回的是 JSON { output.audio.url }，必须再下载一次。
    // （2026-10-14 实测：漏掉这一步会把 467 字节的 JSON 当成 mp3 存下来，音频必然打不开。）
    const resp = await fetch(prov.def.apiBase + '/services/audio/tts/SpeechSynthesizer', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: useModel,
        input: { text: text, voice: voice, format: 'mp3', sample_rate: 24000 }
      })
    });
    const raw = await resp.text();
    const json = parseJsonLike(raw);
    if (!resp.ok) {
      const extra = (json && json.code ? '[' + json.code + '] ' : '') + ((json && json.message) ? json.message : '');
      throw new Error('HTTP ' + resp.status + (extra ? '：' + extra : ''));
    }
    const audioUrl = (json && json.output && json.output.audio && json.output.audio.url) || '';
    if (!audioUrl) throw new Error('接口未返回音频地址（output.audio.url）');
    // 回带的是 http:// 的 OSS 地址，统一升到 https 再取（明文 http 在部分网络环境会被拦）
    const dlResp = await fetch(String(audioUrl).replace(/^http:\/\//i, 'https://'));
    if (!dlResp.ok) throw new Error('下载音频失败：HTTP ' + dlResp.status);
    return { buf: Buffer.from(await dlResp.arrayBuffer()), ext: guessAudioExt(String(audioUrl)) };
  }
  // Qwen-TTS 系列：generation 接口取 output.audio.url 再下载
  const resp = await fetch(prov.def.apiBase + '/services/aigc/multimodal-generation/generation', {
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

export {
  activeProviderDef,
  providerFor,
  modelKnownFor,
  getVoiceApiError,
  voiceNoKeyFail,
  parseJsonLike,
  voiceFriendlyError,
  nowStamp,
  guessAudioExt,
  resolveTtsDir,
  systemVoiceDefaultModel,
  resolveVoiceModel,
  fetchClonedVoices,
  synthOne
};
