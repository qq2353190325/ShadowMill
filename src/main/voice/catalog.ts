// src/main/voice/catalog.ts
// 语音服务目录：**按厂家（厂商）组织**的模型表与系统音色表，是「主进程 + 渲染层」共用的唯一数据来源。
//
// 为什么单独一个文件：模型与音色天然属于某个厂家（千问的模型只能配千问的 Key、跑千问的端点），
// 散在语音接口层（模型表）与 systemVoices.ts（音色表）里时看不出这层归属，界面上也就只能给一个
// 平铺的「目标模型」下拉。这里把它们收进 VoiceProviderDef：一家 = 一条记录，含自己的
// Key 提示 / 端点 / 克隆模型 / 默认合成模型 / 模型数组 / 音色数组。
//
// 加一家（比如字节、MiniMax 的 TTS）：在 VOICE_PROVIDERS 里加一条即可；各请求函数都按
// 「模型或音色所属的厂家」取 apiBase 与 apiKey（见 api.ts 的 providerFor / synthOne 用法），不写死单一端点。
import type { SystemVoice, VoiceModel } from '../../shared/types'
import { SYSTEM_VOICES } from './systemVoices'

export interface VoiceProviderDef {
  key: string
  label: string
  /** API Key 输入框的占位提示 */
  apiKeyHint: string
  /** 该厂家的 HTTP 基址：所有端点都拼在它后面 */
  apiBase: string
  /** 克隆（voice enrollment）用的模型名（如 Qwen-Audio-TTS 的 voice-enrollment） */
  enrollModel: string
  /** 该厂家的默认合成模型（音色未在「音色映射管理」里单独绑模型时的兜底） */
  defaultModel: string
  models: VoiceModel[]
  voices: SystemVoice[]
}

// 千问（阿里云百炼）的候选模型表。
// 分两类，用途完全不同：
//   · role=system：系统音色的合成模型（**系统音色与它是固定绑定**）。2026-10-13 用该账号的 Key 实测：
//       qwen3-tts-flash → HTTP 200 ✓（Cherry/Momo/Jennifer… 均通过）；qwen3-tts-flash-realtime 存在
//       但不支持 HTTP 调用（400 current user api does not support http call）；qwen3-tts-instruct-flash、
//       qwen-tts 实测 404「Model not exist」，已移除。
//   · role=clone：创建克隆音色时的「目标模型」。
//       qwen-audio-3.0-tts-flash（Qwen-Audio-TTS/CosyVoice）→ **唯一**的复刻通道（2026-10-14 收口）：
//         创建走 voice-enrollment 的 action=create_voice，input.url 收公网音频 URL，
//         也**直接收 data:audio/...;base64**（实测：15 秒本地 wav 转 data URI → HTTP 200，
//         且用该音色合成出真 mp3），所以本地文件不必先传到公网；合成走 SpeechSynthesizer，
//         **响应是 JSON + output.audio.url（不是音频流）**，必须二次下载——见 voice.ts synthOne。
//       已删除的两条（用户确认「vc 这条线彻底清掉」，2026-10-14）：
//         · qwen3-tts-vc-2026-01-22（Qwen-TTS/vc 系列）——官方已下线该复刻模型（合成报「Model not exist」），
//           留着只会让人选到一个必然失败的目标模型；它对应的 `enrollModel: 'qwen-voice-enrollment'`、
//           创建分支（audio.data）与列表/删除接口也已一并从 voice.ts 移除。
//         · 同 id 的 qwen3-tts-flash（当时只把 role 标成 clone 用来验证「平台按登记时的 target_model 授权」
//           这条猜测）——既然本地文件已能在 qwen-audio 上跑通，这条实验路径失去意义。
const QWEN_MODELS: VoiceModel[] = [
  { id: 'qwen3-tts-flash', label: '千问3-TTS-Flash', role: 'system', series: 'flash', isDefault: true },
  { id: 'qwen-audio-3.0-tts-flash', label: 'qwen-audio-3.0-tts-flash（语音复刻，本地文件 / 公网 URL 均可）', role: 'clone', input: 'url', group: '语音复刻（克隆音色合成）' }
];

const QWEN: VoiceProviderDef = {
  key: 'qwen',
  label: '千问（阿里云百炼）',
  apiKeyHint: 'sk-...（DASHSCOPE_API_KEY）',
  apiBase: 'https://dashscope.aliyuncs.com/api/v1',
  enrollModel: 'voice-enrollment',           // 克隆（voice enrollment）模型名：Qwen-Audio-TTS/CosyVoice 系列，请勿修改
  defaultModel: 'qwen3-tts-flash',           // 出厂默认（= 系统音色用的模型；不再有用户可改的「厂家默认模型」）
  models: QWEN_MODELS,
  voices: SYSTEM_VOICES
};

export const VOICE_PROVIDERS: VoiceProviderDef[] = [QWEN];

/** 兜底厂家：配置里 active 为空 / 指向未知厂家时用它 */
export const DEFAULT_PROVIDER_KEY = QWEN.key;

/** 全量模型（跨厂家）：需要「按 id 找模型」或平铺展示时用 */
export const VOICE_MODELS: VoiceModel[] = VOICE_PROVIDERS.flatMap((p) => p.models);

export function providerByKey(key?: string): VoiceProviderDef {
  const k = String(key || '').trim();
  return VOICE_PROVIDERS.find((p) => p.key === k) || VOICE_PROVIDERS[0];
}

/** 某个合成模型属于哪家（找不到就用兜底厂家） */
export function providerOfModel(modelId?: string): VoiceProviderDef {
  const id = String(modelId || '').trim();
  if (id) {
    const hit = VOICE_PROVIDERS.find((p) => p.models.some((m) => m.id === id));
    if (hit) return hit;
  }
  return VOICE_PROVIDERS[0];
}

/** 某个内置系统音色属于哪家；不是内置音色（如克隆音色）返回 null，由调用方按 active 厂家处理 */
export function providerOfSystemVoice(voice?: string): VoiceProviderDef | null {
  const v = String(voice || '').trim();
  if (!v) return null;
  return VOICE_PROVIDERS.find((p) => p.voices.some((x) => x.voice === v)) || null;
}

/**
 * 系统音色按它的 series 取该厂家的默认合成模型（替代原先写死的 SYSTEM_SERIES_MODEL 映射）。
 * 规则：按 series 顺序找第一个「同 series 且 role=system」的模型；都没有则回该厂家的 defaultModel。
 */
export function seriesDefaultModel(provider: VoiceProviderDef, series?: string[]): string {
  const list = Array.isArray(series) ? series : [];
  for (const s of list) {
    const hit = provider.models.find((m) => m.role === 'system' && m.series === s);
    if (hit) return hit.id;
  }
  return provider.defaultModel;
}
