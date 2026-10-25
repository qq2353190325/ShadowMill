// src/main/voice/index.ts
// 语音域（音色 + 配音 + 语音处理）——本目录的统一出口。
// 外部（main/index.ts、settings.ts、whisper.ts）只从 '.../voice' 取，不关心内部怎么分文件——
// 与 src/main/cast/、src/main/agent/、src/main/updater/、src/main/projects/ 同一套「同名目录 + index.ts」约定。
//
// 目录结构（依赖单向：catalog 与 api 在最上游，ipc 在最下游，故不会成环）：
//   catalog.ts       厂家目录：一家 = 一条记录（Key 提示 / 端点 / 克隆模型 / 默认合成模型 / 模型 + 音色表）※ 被 settings 直接引用
//   systemVoices.ts  Qwen-TTS 内置系统音色表（catalog 的数据源，不对外）
//   api.ts           接口层：厂家解析 / 错误文案 / 音色→模型解析 / 克隆音色列表 / 单次合成 synthOne（依赖 settings、catalog）
//   cloneAudio.ts    克隆参考音频：ffmpeg 裁前 15 秒 / 24kHz / 单声道（依赖 hfEnv）
//   vad.ts           能量 VAD 起止静音裁剪（纯函数、零依赖；whisper.ts 与 test/vad-test.js 共用）
//   ttsAlign.ts      字幕配音逐句对齐：合成 → 量时长 → 对齐 → 装配整轨 + voice:synth-aligned / align-cancel（依赖 api）
//   ipc/voices.ts    配置 / 目录 / 音色管理 14 条 voice:* 频道
//   ipc/tts.ts       真的去调接口的两条：voice:create（克隆音色）/ voice:synth（合成落盘）
//   register.ts      只做装配：按固定顺序调两个域的注册函数
//
// 本文件只做再导出，不写任何逻辑。ttsAlign 的 `register` 与语音域的 `register` 重名，出口按 `registerAlign` 暴露。

export { register } from './register'
export { register as registerAlign } from './ttsAlign'

export {
  isAudioTtsModel,
  getVoiceApiError,
  parseJsonLike,
  voiceFriendlyError,
  nowStamp,
  guessAudioExt,
  resolveTtsDir,
  resolveVoiceModel,
  fetchClonedVoices,
  synthOne
} from './api'

export {
  VOICE_PROVIDERS,
  DEFAULT_PROVIDER_KEY,
  VOICE_MODELS,
  providerByKey,
  providerOfModel,
  providerOfSystemVoice,
  seriesDefaultModel
} from './catalog'
export type { VoiceProviderDef } from './catalog'

export { readWavSamples, vadTrimSegments } from './vad'
export type { VadWav, VadSegment } from './vad'

export { fmtTime, planModeA, planModeB, buildTrack } from './ttsAlign'
export type { AlignSeg } from './ttsAlign'
