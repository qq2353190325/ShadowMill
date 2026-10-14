// src/main/voice.ts
// 千问语音：音色管理 + 文字生音频（Qwen-TTS / Qwen-Audio-TTS 双系列 HTTP 方案）
// 提供：isAudioTtsModel / getVoiceApiError / parseJsonLike / voiceFriendlyError /
//       nowStamp / guessAudioExt / resolveTtsDir + 全部 voice:* IPC
// 依赖：settings(getVoiceSettings / getVoiceProviderConfig / saveVoiceProviderConfig / readSettings / writeSettings) /
//       voiceCatalog（**按厂家组织**的模型表与音色表：apiBase / API Key / 克隆模型都从厂家取） /
//       projects(projectsRoot / scanProjects) / hfEnv(BUILTIN_RESOURCES.ffmpeg / ffprobe，裁参考音频用) / dialog
import { app, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import * as settings from './settings'
import * as projects from './projects'
import { BUILTIN_RESOURCES } from './hfEnv'
import {
  VOICE_MODELS,
  VOICE_PROVIDERS,
  providerByKey,
  providerOfModel,
  providerOfSystemVoice,
  seriesDefaultModel,
  type VoiceProviderDef
} from './voiceCatalog'
import { IPC } from '../shared/ipc'
import type {
  RegisterCtx,
  SystemVoice,
  VoiceCreatePayload,
  VoiceProfileKeyPayload,
  VoiceProfilePayload,
  VoiceProfile,
  VoiceProviderView,
  VoiceSaveConfigPayload,
  VoiceSaveDirPayload,
  VoiceSynthPayload
} from '../shared/types'

// 模型表 / 端点 / 克隆模型名全部来自 voiceCatalog（按厂家组织）
// Qwen-Audio-TTS 系列模型名特征（如 qwen-audio-3.0-tts-flash / qwen-audio-3.0-tts-plus）；
// 也是「能不能作复刻目标模型」的唯一判据（vc 系列已移除）
function isAudioTtsModel(model: string): boolean {
  return /^qwen-audio-.*-tts/i.test(String(model || ''));
}

// ===== 克隆参考音频的准备（本地文件 → 前 15 秒 / 24kHz / 单声道 wav）=====
// 为什么要先在本地裁：create_voice 只用参考音频的前 max_prompt_audio_length 秒（3~30，默认 10），
// 整段上传毫无意义，还会把 base64 请求体撑大（15 秒 24k 单声道 wav ≈ 700KB，比原文件直传小一个量级）。
// 端点：POST /services/audio/tts/customization，input.url —— **既收公网 URL，也收 data: 音频 URI**
// （官方文档只写了「要求公网可访问的 URL」；2026-10-14 实测 data URI 同样返回 200 并成功合成，
//  所以本地文件不必再先传到公网）。
const CLONE_SR = 24000;   // 与 Qwen-Audio-TTS 原生采样率一致
const CLONE_SECONDS = 15; // 截取的参考音频时长（官方推荐 10~20 秒清晰人声）
const CLONE_PREFIX_MAX = 10; // input.prefix 仅允许数字/英文字母且不超过 10 字符

// ffmpeg / ffprobe 调用样板（同 whisper.ts / ttsAlign.ts：windowsHide + Promise，不引第三方依赖）
function runProc(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new Error('无法启动 ' + path.basename(exe) + '：' + err.message)));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(path.basename(exe) + ' 退出码 ' + code + (stderr.trim() ? '：' + stderr.trim().slice(-300) : '')));
    });
  });
}

// ffprobe 量音频时长（秒，float）；失败 reject
async function probeDuration(file: string): Promise<number> {
  const out = await runProc(BUILTIN_RESOURCES.ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file
  ]);
  const d = parseFloat(String(out).trim());
  if (!isFinite(d) || d < 0) throw new Error('无法读取音频时长：' + file);
  return d;
}

// 本地音频 → 参考样本 wav（截前 CLONE_SECONDS 秒、单声道、24kHz、pcm_s16le）。
// 返回的临时文件由调用方在 finally 里删除；时长不足 3 秒直接报错（服务端要求 3~30 秒）。
async function makeCloneSample(src: string): Promise<string> {
  const ffmpeg = BUILTIN_RESOURCES.ffmpeg;
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(BUILTIN_RESOURCES.ffprobe)) {
    throw new Error('未找到内置 ffmpeg/ffprobe（运行环境包可能还没解包完成），无法裁取参考音频');
  }
  const dur = await probeDuration(src);
  if (dur < 3) {
    throw new Error('参考音频太短（' + dur.toFixed(1) + ' 秒）：声音复刻要求 3~30 秒的清晰人声');
  }
  const out = path.join(app.getPath('temp'), 'shadowmill-clone-' + Date.now() + '.wav');
  await runProc(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-vn', '-t', String(CLONE_SECONDS), '-ac', '1', '-ar', String(CLONE_SR), '-c:a', 'pcm_s16le', out
  ]);
  return out;
}

// 错误对象 → 消息串（多处 catch 共用）
function errMsg(e: unknown): string {
  return (e as Error) && (e as Error).message ? (e as Error).message : String(e);
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
function parseJsonLike(text: string): Record<string, any> | null {
  try { return JSON.parse(text); } catch (e) { return null; }
}
function voiceFriendlyError(err: unknown, label: string): string {
  let msg = (err && (err as Error).message) ? (err as Error).message : String(err);
  if (/Model not exist/i.test(msg)) {
    msg = '这个模型在当前账号里不存在（' + msg + '）：请到「设置 → 语音服务」核对厂家，或到「音色管理 → 音色映射管理」把该音色改绑到可用的模型';
  } else if (/does not exist or is not licensed/i.test(msg)) {
    msg = '音色未获授权或不存在（' + msg + '）：克隆音色只能用创建时对应的复刻模型合成，该模型在当前账号不可用时请改用系统音色';
  } else if (/InvalidApiKey|unauthorized|Unauthorized|401|403/i.test(msg)) msg = 'API Key 无效或无权限，请检查后重试';
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
  const projectsRoot = projects.projectsRoot();
  if (projectName) {
    const dir = path.join(projectsRoot, projectName);
    return path.join(dir, 'audio');
  }
  const projs = projects.scanProjects();
  if (projs && projs.length) return path.join(projectsRoot, projs[0].name, 'audio');
  return path.join(app.getPath('userData'), 'tts-output');
}

// 系统音色默认合成模型：交给 voiceCatalog 按「该厂家的模型表 + 音色的 series」推导（替代原先写死的映射表）
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
  if (noKey) return { ok: false, message: noKey };
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

function register(ctx?: RegisterCtx): void {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

  // 语音服务配置：按厂家回带（active + 各厂家已保存的 apiKey + 全局保存目录）；没有全局模型设置
  // 渲染层另有 voice:list-models 回带厂家目录（label / Key 提示 / 模型 / 音色），两者配合渲染「语音服务」页
  ipcMain.handle(IPC.Voice.GetConfig, () => {
    const vs = settings.getVoiceSettings();
    return { ok: true, active: vs.active, providers: vs.providers, saveDir: String(vs.saveDir || '') };
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

  // 保存语音配置。两种用途：
  //   ① 保存「某个厂家」的 API Key：{ provider?: string, config: { apiKey } }（provider 缺省 = 当前 active；保存即切到该厂家）
  //   ② 只改全局「自定义保存目录」：{ saveDir }（「保存到：自定义目录 / 恢复默认」，不动 Key、不切厂家）
  // 兼容历史形态：{ voiceTTS: { apiKey, targetModel } } 与裸 { apiKey, targetModel }（旧渲染层会这么发；
  // 其中的 targetModel 一律忽略——「厂家默认模型」这个设置已废除，模型表在 voiceCatalog 里）。
  ipcMain.handle(IPC.Voice.SaveConfig, (_event, payload?: VoiceSaveConfigPayload | { voiceTTS?: { apiKey?: string; targetModel?: string }; apiKey?: string; targetModel?: string; saveDir?: string }) => {
    const p = (payload || {}) as {
      provider?: string;
      config?: { apiKey?: string };
      saveDir?: string;
      voiceTTS?: { apiKey?: string; targetModel?: string };
      apiKey?: string;
      targetModel?: string;
    };
    const legacy = p.voiceTTS || p;
    const patch = (p.config && typeof p.config === 'object') ? p.config : {};
    const dir = typeof p.saveDir === 'string' ? p.saveDir : undefined;
    const apiKey = typeof patch.apiKey === 'string' ? patch.apiKey
      : (typeof p.config !== 'object' && typeof legacy.apiKey === 'string' ? legacy.apiKey : undefined);
    // 只有真的给了 Key 或明确点了厂家时才去动厂家配置，否则光改目录会把 active 悄悄切走；
    // 两者都没给（空载荷）时什么也不写，避免把已有目录清空
    const merged = (apiKey === undefined && p.provider === undefined)
      ? (dir === undefined ? settings.getVoiceSettings() : settings.saveVoiceSaveDir(dir))
      : settings.saveVoiceProviderConfig(p.provider, { apiKey: apiKey }, dir);
    return { ok: true, settings: settings.readSettings(), voice: merged };
  });

  ipcMain.handle(IPC.Voice.PickAudio, async () => {
    const win = getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择用于克隆音色的音频（推荐 10~20 秒清晰人声，主进程会自动截取前 15 秒）',
      // 任何 ffmpeg 能解码的格式都行（本地文件会先转成 24k 单声道 wav 再提交）
      filters: [{ name: '音频 / 视频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'mp4', 'mov', 'mkv'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 创建克隆音色：model=<厂家的克隆模型>（千问为 voice-enrollment）+ action=create_voice
  // 音频位置（payload.audioPath）支持三种形态：本地绝对路径、http(s)/oss 远程地址、data:audio/... URI。
  //   · 远程地址与 data URI 直接放进 input.url 透传；
  //   · 本地文件先经 ffmpeg 裁成前 15 秒 24k 单声道 wav，再转 base64 data URI 放进 input.url
  //     （实测 data URI 被接受；文档写的是「公网可访问的 URL」，但并非硬校验，所以不必先传到公网）。
  ipcMain.handle(IPC.Voice.Create, async (_event, payload?: VoiceCreatePayload) => {
    const audioPath = String((payload && payload.audioPath) || '').trim();
    // 目标模型决定这次克隆走哪个厂家（模型属于哪家就用哪家的 Key 与端点）；
    // 没给模型时用当前厂家的默认合成模型。
    const active = providerFor();
    const useModel = String((payload && payload.targetModel) || '').trim() || active.defaultModel;
    const prov = providerFor(undefined, useModel);
    const noKey = getVoiceApiError(prov.def, prov.apiKey);
    if (noKey) return { ok: false, message: noKey };
    // 只有 Qwen-Audio-TTS 系列能作复刻目标模型（vc 那条线已彻底移除，见 voiceCatalog 注释）。
    // 系统音色模型（如 qwen3-tts-flash）走不到这里：界面只列 role=clone 的模型，这里再兜一道。
    if (!isAudioTtsModel(useModel)) {
      return { ok: false, message: '模型「' + useModel + '」不支持音色复刻：请把「目标模型」选成 qwen-audio-* 系列（如 qwen-audio-3.0-tts-flash）' };
    }
    if (!audioPath) return { ok: false, message: '请先选择本地音频文件，或粘贴可公开访问的音频 URL' };
    // 远程地址（http/https/oss）与 data URI 都不落本地，直接用
    const isRemoteUrl = /^(https?|oss):\/\//i.test(audioPath);
    const isDataUri = /^data:audio\//i.test(audioPath);
    // input.prefix 仅允许数字/字母/下划线且不超过 CLONE_PREFIX_MAX 个字符
    const preferredName = String((payload && payload.preferredName) || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!preferredName || preferredName.length > CLONE_PREFIX_MAX) {
      return { ok: false, message: '音色名称需 1~' + CLONE_PREFIX_MAX + ' 个字符，仅限数字、字母、下划线' };
    }
    let localSample = '';
    try {
      // input.url：远程地址原样用；本地文件裁 15 秒后转 data URI
      let urlToSend = audioPath;
      if (!isRemoteUrl && !isDataUri) {
        if (!fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在：' + audioPath };
        try {
          localSample = await makeCloneSample(audioPath);
          urlToSend = 'data:audio/wav;base64,' + fs.readFileSync(localSample).toString('base64');
        } catch (e) {
          return { ok: false, message: '准备参考音频失败：' + errMsg(e) };
        }
      }
      const input = {
        action: 'create_voice',
        target_model: useModel,
        prefix: preferredName,
        url: urlToSend,
        // 文档参数：语种提示（默认 zh）与参考音频最大时长（3~30 秒，默认 10；这里与本地裁剪的 15 秒一致）
        language_hints: ['zh'],
        max_prompt_audio_length: CLONE_SECONDS
      };
      const resp = await fetch(prov.def.apiBase + '/services/audio/tts/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + prov.apiKey },
        body: JSON.stringify({ model: prov.def.enrollModel, input })
      });
      const raw = await resp.text();
      const json = parseJsonLike(raw);
      if (!resp.ok) {
        const code = (json && json.code) || '';
        // 音频类报错单独提示（样本不合规是最常见的原因：太短、无人声、格式不对）
        if (/audio/i.test(code + ' ' + ((json && json.message) || ''))) {
          return {
            ok: false,
            message: '创建音色失败（服务端不接受这段参考音频）：HTTP ' + resp.status
              + ((json && json.message) ? '：' + json.message : '')
              + '。请换一段 3~30 秒、清晰无噪音的人声（本地文件会自动截取前 ' + CLONE_SECONDS + ' 秒）。'
          };
        }
        throw new Error('HTTP ' + resp.status + ((json && json.message) ? '：' + json.message : ''));
      }
      const out = (json && json.output) || {};
      // 严格按文档口径解析创建返回体：只有 output.voice_id（+ usage.count / request_id，不用）。
      // 不再读 output.target_model / fallback_mode / fallback_reason —— 这三个字段文档没有、实测也从未返回过。
      const voice = out.voice_id;
      if (!voice) throw new Error('接口未返回音色 ID（output.voice_id）');
      return {
        ok: true,
        voice: voice,
        // 回执里的模型取「本次请求发的目标模型」（创建返回体不带 target_model）
        targetModel: useModel
      };
    } catch (e) {
      return { ok: false, message: voiceFriendlyError(e, '创建音色失败') };
    } finally {
      // 本地裁出来的参考样本（15 秒 wav）用完即删，别在用户临时目录里留垃圾
      if (localSample) { try { fs.unlinkSync(localSample); } catch (e) { /* 删不掉不影响主流程 */ } }
    }
  });

  // 内置系统音色列表（无需 API Key，直接返回；每项附所属厂家 provider 与其默认合成模型 model）
  ipcMain.handle(IPC.Voice.ListSystemVoices, () => {
    const profiles = settings.getVoiceProfiles();
    const voices: (SystemVoice & { model: string; provider: string; providerLabel: string })[] = [];
    VOICE_PROVIDERS.forEach((p) => {
      p.voices.forEach((v) => {
        const prof = profiles['system:' + v.voice];
        const bound = prof && prof.targetModel;
        voices.push({
          voice: v.voice,
          desc: v.desc,
          langs: v.langs,
          series: v.series,
          // 绑定的模型必须还在该厂家模型表里，否则按固定绑定回落到系统合成模型
          model: bound && modelKnownFor(p, bound) ? bound : systemVoiceDefaultModel(p, v),
          provider: p.key,
          providerLabel: p.label
        });
      });
    });
    return { ok: true, voices: voices, total: voices.length };
  });

  // 候选模型表（音色复制/合成可选模型）+ **厂家目录**（label / Key 提示 / 默认模型 / 模型 / 音色）
  // 渲染层据此把模型与音色按厂家分组展示，不再需要自己维护一份厂家/模型清单。
  ipcMain.handle(IPC.Voice.ListModels, () => ({
    ok: true,
    models: VOICE_MODELS,
    providers: VOICE_PROVIDERS.map((p): VoiceProviderView => ({
      key: p.key,
      label: p.label,
      apiKeyHint: p.apiKeyHint,
      defaultModel: p.defaultModel,
      models: p.models,
      voices: p.voices
    }))
  }));

  // 本地音色映射：读取 / 保存 / 删除（key 形如 system:<voice> 或 custom:<voice_id>）
  ipcMain.handle(IPC.Voice.GetProfiles, () => ({ ok: true, profiles: settings.getVoiceProfiles() }));
  ipcMain.handle(IPC.Voice.SaveProfile, (_event, payload?: VoiceProfilePayload) => {
    const p = (payload && payload.profile) || {};
    const key = String(p.key || '').trim();
    if (!key || !p.voice || !p.targetModel) return { ok: false, message: '映射信息不完整' };
    // 保存映射时就拦住「跨厂家绑定」：系统音色按它所属厂家，克隆音色按当前厂家；
    // 不再用全量白名单 + 静默回落（那会把别家的音色悄悄绑到千问的默认模型上）。
    const voice = String(p.voice).trim();
    const wanted = String(p.targetModel).trim();
    const voiceVendor = providerOfSystemVoice(voice) || activeProviderDef();
    const modelVendor = providerOfModel(wanted);
    if (modelVendor.key !== voiceVendor.key) {
      return {
        ok: false,
        message: '模型「' + wanted + '」属于「' + modelVendor.label + '」，而音色「' + voice + '」属于「'
          + voiceVendor.label + '」：两者必须同属一个厂家'
      };
    }
    if (!voiceVendor.models.some((m) => m.id === wanted)) {
      return { ok: false, message: '「' + voiceVendor.label + '」的模型表里没有「' + wanted + '」' };
    }
    settings.saveVoiceProfile(key, {
      key: key,
      name: String(p.name || p.voice || '').trim() || String(p.voice),
      voice: voice,
      targetModel: wanted,
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

  // 删除**云端**克隆音色（不可撤销）：schema model = 厂家的克隆模型（千问为 voice-enrollment），
  // input { action: 'delete_voice', voice_id }（vc 系列的 action='delete' 写法随该系列一同移除）。
  // 成功响应形如 { output: {}, usage: { count: 1 } }。
  // 删完顺手清掉该音色的本地映射（音色已不存在，留着只会变成一条指向幽灵音色的条目）。
  ipcMain.handle(IPC.Voice.DeleteCloud, async (_event, payload?: { voice?: string }) => {
    const voice = String((payload && payload.voice) || '').trim();
    if (!voice) return { ok: false, message: '缺少音色 id' };
    const provider = activeProviderDef();
    const apiKey = settings.getVoiceProviderConfig(provider.key).config.apiKey;
    const noKey = getVoiceApiError(provider, apiKey);
    if (noKey) return { ok: false, message: noKey };
    try {
      const resp = await fetch(provider.apiBase + '/services/audio/tts/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: provider.enrollModel, input: { action: 'delete_voice', voice_id: voice } })
      });
      const raw = await resp.text();
      const json = parseJsonLike(raw);
      const code = String((json && json.code) || '');
      const message = String((json && json.message) || '');
      if (resp.ok) {
        settings.deleteVoiceProfile('custom:' + voice);
        return { ok: true, voice: voice, profiles: settings.getVoiceProfiles() };
      }
      if (/VoiceNotFound/i.test(code)) {
        return { ok: false, message: '云端没有这个音色（可能已被删除）：' + voice };
      }
      // 音色不存在时也把本地映射清掉，免得留一条指向幽灵音色的条目
      if (/not\s*(exist|found)|invalid/i.test(code + ' ' + message)) {
        settings.deleteVoiceProfile('custom:' + voice);
        return { ok: false, message: '云端删除被拒绝（' + (code || message) + '），已清除该音色的本地映射' };
      }
      throw new Error('HTTP ' + resp.status + (code || message ? '：' + (code ? code + ' ' : '') + message : ''));
    } catch (e) {
      return { ok: false, message: voiceFriendlyError(e, '删除云端音色失败') };
    }
  });

  // 查询克隆音色列表（model=厂家的克隆模型 + action=list_voice，见 fetchClonedVoices）
  ipcMain.handle(IPC.Voice.List, () => fetchClonedVoices());

  // 合并音色列表：系统音色 + 克隆音色，统一 { key, type, name, voiceId, model }（「音色即模型」UI 入口）
  ipcMain.handle(IPC.Voice.ListAll, async () => {
    const profiles = settings.getVoiceProfiles();
    const sysItems = VOICE_PROVIDERS.flatMap((p) => p.voices.map((v) => {
      const key = 'system:' + v.voice;
      const prof = profiles[key];
      return {
        key: key,
        type: 'system',
        name: (prof && prof.name) || v.desc,
        voiceId: v.voice,
        model: resolveVoiceModel(key, ctx)
      };
    }));
    const customItems: { key: string; type: string; name: string; voiceId: string; model: string }[] = [];
    const cloud = await fetchClonedVoices();
    if (cloud.ok && Array.isArray(cloud.voices)) {
      cloud.voices.forEach((v: any) => {
        const voiceId = v.voice || v.voice_id || '';
        if (!voiceId) return;
        const key = 'custom:' + voiceId;
        const prof = profiles[key];
        // 克隆音色模型三级回退：本地映射 targetModel → 云端 target_model → 当前厂家的默认合成模型
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
    const projectsRoot = projects.projectsRoot();
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
    // 自定义保存目录（若已设置；与厂家无关，全局一份）
    const custom = String(settings.getVoiceSettings().saveDir || '').trim();
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

  // 文字合成语音并保存（两个系列都是「接口 → output.audio.url → 二次下载」，见 synthOne）
  ipcMain.handle(IPC.Voice.Synth, async (_event, payload?: VoiceSynthPayload) => {
    const text = String((payload && payload.text) || '').trim();
    const voice = String((payload && payload.voice) || '').trim();
    if (!text) return { ok: false, message: '合成文本为空' };
    if (!voice) return { ok: false, message: '请先选择（或创建）音色' };
    // 合成使用的模型：优先取「当前音色绑定/选定的模型」，无则回落当前厂家的默认合成模型；
    // 用哪家的 Key 由这个模型决定（synthOne 内部按模型选厂家）。
    const active = providerFor(voice);
    const useModel = String((payload && payload.targetModel) || '').trim() || active.defaultModel;
    const prov = providerFor(voice, useModel);
    const noKey = getVoiceApiError(prov.def, prov.apiKey);
    if (noKey) return { ok: false, message: noKey };
    try {
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
      const projectsRoot = projects.projectsRoot();
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
