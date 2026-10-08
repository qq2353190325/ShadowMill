// src/preload/index.d.ts —— preload 暴露的 window.* 全局类型（渲染层 tsconfig.web 引入）
// 契约与 src/preload/index.ts 的 8 个 contextBridge 命名空间一一对应，禁止漂移。
import type { AppSettings, CustomModelConfig, VoiceProfile, VoiceTTSConfig } from '../shared/types'

// 通用 IPC 结果：ok=true 携带业务数据；ok=false/canceled 携带 message
interface OkResult<T = unknown> {
  ok: true
  [key: string]: any
  data?: T
}
interface FailResult {
  ok: false
  message: string
  canceled?: boolean
}
type IpcResult<T = unknown> = OkResult<T> | FailResult

export {}

declare global {
  interface Window {
    electronAPI: {
      platform: string
      versions: { node: string; chrome: string; electron: string }
    }
    appTools: {
      copyText(text: string): Promise<boolean>
    }
    windowControls: {
      minimize(): void
      toggleMaximize(): void
      close(): void
      onMaximizedChange(callback: (isMaximized: boolean) => void): void
    }
    hfTools: {
      openHtml(): Promise<string | null>
      listProjects(): Promise<{ name: string; html: string }[]>
      previewShell(htmlPath: string): Promise<IpcResult<{ shellPath: string }>>
      renderVideo(htmlPath: string): Promise<IpcResult<{ outputVideo: string; projectDir: string }> & { compatible?: boolean }>
      showInFolder(filePath: string): Promise<void>
      onProgress(callback: (data: { text: string }) => void): void
    }
    settingsTools: {
      get(): Promise<AppSettings>
      save(customModel: CustomModelConfig): Promise<IpcResult<{ settings: AppSettings }>>
      test(customModel: CustomModelConfig): Promise<IpcResult>
    }
    voiceTools: {
      getConfig(): Promise<IpcResult<{ apiKey: string; targetModel: string; saveDir: string }>>
      getSaveDir(payload: { saveDir?: string; defaultOut?: boolean; projectName?: string }): Promise<IpcResult<{ mode: string; saveDir: string }>>
      saveConfig(voiceTTS: Partial<VoiceTTSConfig>): Promise<IpcResult<{ settings: AppSettings }>>
      pickAudio(): Promise<string | null>
      pickDir(): Promise<IpcResult<{ dir: string }>>
      listGenerated(): Promise<IpcResult<{ items: { path: string; name: string; group: string; size: number; mtime: number }[]; total: number }>>
      create(audioPath: string, preferredName: string, targetModel: string): Promise<IpcResult<{ voice: string; targetModel: string; fallbackMode: boolean; fallbackReason: string }>>
      list(): Promise<IpcResult<{ voices: any[]; total: number }>>
      listSystemVoices(): Promise<IpcResult<{ voices: { voice: string; desc: string; langs: string; series: string[]; model: string }[]; total: number }>>
      listAll(): Promise<IpcResult<{ voices: { key: string; type: string; name: string; voiceId: string; model: string }[]; total: number; cloudMessage: string }>>
      listModels(): Promise<IpcResult<{ models: any[] }>>
      getProfiles(): Promise<IpcResult<{ profiles: Record<string, VoiceProfile> }>>
      saveProfile(profile: VoiceProfile): Promise<IpcResult<{ profiles: Record<string, VoiceProfile> }>>
      deleteProfile(key: string): Promise<IpcResult<{ profiles: Record<string, VoiceProfile> }>>
      synth(text: string, voice: string, projectName: string, saveDir: string, targetModel: string, audioName: string, defaultOut: boolean): Promise<IpcResult<{ savePath: string; projectName: string; savedTo: string; size: number }>>
      synthAligned(payload: Record<string, unknown>): Promise<IpcResult<{ mode: string; subtitleText: string; audioPath: string; totalDur: number; details: any[] }>>
      cancelAlign(): void
      onAlignProgress(callback: (data: Record<string, unknown>) => void): void
    }
    whisperTools: {
      status(): Promise<IpcResult<{ cli: { exists: boolean; path: string }; modelsDir: string; langs: { id: string; label: string }[]; models: any[]; unknownFiles: string[]; usedBytes: number; currentModelId: string }>>
      download(id: string): Promise<IpcResult<{ id: string; sizeBytes: number }>>
      delete(id: string): Promise<IpcResult<{ id: string; removed: string }>>
      setCurrent(id: string): Promise<IpcResult<{ id: string }>>
      addModel(payload: Record<string, unknown>): Promise<IpcResult<{ id: string }>>
      updateModel(payload: Record<string, unknown>): Promise<IpcResult<{ id: string }>>
      removeModel(payload: Record<string, unknown>): Promise<IpcResult<{ id: string }>>
      openDir(which: string): Promise<IpcResult<{ path: string }>>
      pickAudio(): Promise<string | null>
      projectAudio(name: string): Promise<IpcResult<{ path: string; name: string }>>
      transcribe(payload: Record<string, unknown>): Promise<IpcResult<{ id: string; text: string; subtitleText: string; segments: { start: number; end: number; text: string }[]; model: string }>>
      onProgress(callback: (data: Record<string, unknown>) => void): void
    }
    projectTools: {
      list(): Promise<{ name: string; title: string; hasSubtitle: boolean; hasHtml: boolean; hasVideo: boolean; subtitleCount: number; updatedAt: string }[]>
      create(name: string): Promise<IpcResult<{ project: any }>>
      load(name: string): Promise<any | null>
      saveSubtitle(name: string, subtitle: string, title: string): Promise<IpcResult<{ project: any }>>
      saveContent(name: string, content: unknown): Promise<IpcResult<{ project: any }>>
      generateHtml(name: string, prompt: string, materials?: Record<string, unknown>): Promise<IpcResult<{ htmlPath: string; compatible: boolean }>>
      modifyHtml(name: string, prompt: string, materials?: Record<string, unknown>): Promise<IpcResult<{ htmlPath: string; compatible: boolean }>>
      downloadHtml(name: string): Promise<IpcResult<{ savedPath: string }>>
      downloadFile(srcPath: string, defaultName: string): Promise<IpcResult<{ savedPath: string }>>
      exportSrt(name: string, srt: string): Promise<IpcResult<{ savedPath: string }>>
      readHtml(name: string): Promise<IpcResult<{ html: string }>>
      saveHtml(name: string, html: string): Promise<IpcResult<{ htmlPath: string; compatible: boolean }>>
      previewHtml(name: string): Promise<IpcResult<{ previewPath: string }>>
      pickAudio(): Promise<string | null>
      setAudio(name: string, audioPath: string): Promise<IpcResult<{ audioFile: string }>>
      clearAudio(name: string): Promise<IpcResult>
      pickVideo(): Promise<string | null>
      setVideo(name: string, videoPath: string): Promise<IpcResult<{ videoFile: string; abs: string }>>
      clearVideo(name: string): Promise<IpcResult>
      extractVideoAudio(name: string): Promise<IpcResult<{ audioFile: string }>>
      openFolder(name: string): Promise<IpcResult<{ }>>
      openFolderOf(dirOrFile: string): Promise<IpcResult<{ dir: string }>>
      delete(name: string): Promise<IpcResult>
      saveVideo(name: string, videoPath: string): Promise<IpcResult<{ project: any }>>
      onHtmlProgress(callback: (data: Record<string, unknown>) => void): void
    }
  }
}
