// src/shared/types.ts —— 跨进程共享的载荷类型（main / preload / 渲染层三端共用）
// 约束：线上载荷格式必须与现行实现逐字节一致，禁止改动结构。
import type { BrowserWindow } from 'electron'

// ===== 主进程装配上下文（main.js 的 register(ctx) 模式） =====
export interface RegisterCtx {
  getWindow: () => BrowserWindow | null
}

// ===== 设置（userData/settings.json） =====
export interface CustomModelConfig {
  baseUrl: string
  modelId: string
  apiKey: string
  enabled: boolean
}

export interface VoiceTTSConfig {
  apiKey: string
  targetModel: string
  saveDir: string
}

// 本地音色映射：key 形如 "system:Cherry" / "custom:<voice_id>"
export interface VoiceProfile {
  key: string
  name: string
  voice: string
  targetModel: string
  type: string
}

// whisper 自定义模型条目：{ id, name, file, url, sizeMB, desc }；id 由文件名派生
export interface WhisperCustomModel {
  id: string
  name: string
  file: string
  url: string
  sizeMB: number
  desc: string
}

export interface AppSettings {
  customModel: CustomModelConfig
  voiceTTS: VoiceTTSConfig
  voiceProfiles: Record<string, VoiceProfile>
  whisper: { modelId: string; customModels: WhisperCustomModel[] }
}

// ===== Qwen-TTS 系统音色 =====
export interface SystemVoice {
  voice: string
  desc: string
  langs: string
  series: string[]
}
