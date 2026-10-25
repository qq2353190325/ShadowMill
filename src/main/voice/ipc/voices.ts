// src/main/voice/ipc/voices.ts
// voice:* 里「配置 / 目录 / 音色管理」这一组频道（14 条）：语音服务配置（按厂家回带与保存、全局保存目录）、
// 目录选择（参考音频 / 保存目录）、系统音色与模型目录、本地音色映射（读 / 存 / 删）、云端克隆音色（列 / 删）、
// 合并音色列表、已生成音频扫描。
// 合成与克隆在 ipc/tts.ts（那两条是「真的去调接口」的动作，与这里的读配置 / 读列表分开）。
//
// 依赖：settings（配置与映射）/ projects（扫描各项目 audio/）/ ../api（厂家与错误）/ ../catalog（厂家目录）。
import { app, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as settings from '../../settings'
import * as projects from '../../projects'
import {
  activeProviderDef,
  getVoiceApiError,
  voiceNoKeyFail,
  parseJsonLike,
  voiceFriendlyError,
  resolveTtsDir,
  resolveVoiceModel,
  modelKnownFor,
  systemVoiceDefaultModel,
  fetchClonedVoices
} from '../api'
import { VOICE_MODELS, VOICE_PROVIDERS, providerOfModel, providerOfSystemVoice } from '../catalog'
import { IPC } from '../../../shared/ipc'
import type {
  RegisterCtx,
  SystemVoice,
  VoiceProfileKeyPayload,
  VoiceProfilePayload,
  VoiceProviderView,
  VoiceSaveConfigPayload,
  VoiceSaveDirPayload
} from '../../../shared/types'

// 本域的注册入口：register.ts 按固定顺序调用它（每个频道只注册一次）。
export function registerVoicesIpc(ctx?: RegisterCtx): void {
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
  // 其中的 targetModel 一律忽略——「厂家默认模型」这个设置已废除，模型表在 catalog 里）。
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
    if (noKey) return voiceNoKeyFail(noKey);
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
}
