// src/preload/index.ts —— 预加载脚本：通过 contextBridge 向渲染进程暴露安全 API
// 8 个命名空间（electronAPI/appTools/windowControls/hfTools/settingsTools/voiceTools/whisperTools/projectTools）
// 与 4 个进度推送通道的单订阅语义（重复注册仅替换回调，避免页面切换叠加监听）。
// 类型契约：每个对象都以 PreloadApi['<命名空间>'] 标注（见 src/shared/types.ts ⑨ 节），
//           渲染层拿到的 window.* 签名由 preload/index.d.ts 挂载同一份契约 —— 两处不会漂移。
// 注意：sandboxed preload 必须编译为 CJS（全项目无 "type":"module"）；
//       本文件的 import 由 electron-vite 打包内联，运行时仅依赖 require('electron')。
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { AlignProgressPayload, HtmlProgressPayload, PreloadApi, RenderOverride, WhisperProgressPayload } from '../shared/types'

const electronAPI: PreloadApi['electronAPI'] = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
};
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// 应用级小工具：剪贴板复制（sandbox 下渲染层无 clipboard 模块，经主进程写入）
const appTools: PreloadApi['appTools'] = {
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.App.CopyText, text)
};
contextBridge.exposeInMainWorld('appTools', appTools);

// 自绘标题栏：窗口控制 API
const windowControls: PreloadApi['windowControls'] = {
  minimize: (): void => ipcRenderer.send(IPC.Window.Minimize),
  toggleMaximize: (): void => ipcRenderer.send(IPC.Window.ToggleMaximize),
  close: (): void => ipcRenderer.send(IPC.Window.Close),
  onMaximizedChange: (callback: (isMaximized: boolean) => void): void => {
    ipcRenderer.on(IPC.Window.MaximizedChange, (_event, isMaximized: boolean) => callback(isMaximized));
  }
};
contextBridge.exposeInMainWorld('windowControls', windowControls);

// 预览 & HyperFrames 转视频 API
const hfTools: PreloadApi['hfTools'] = {
  openHtml: (): Promise<string | null> => ipcRenderer.invoke(IPC.Video.OpenHtml),
  listProjects: () => ipcRenderer.invoke(IPC.Video.ListProjects),
  previewShell: (htmlPath: string) => ipcRenderer.invoke(IPC.Video.PreviewShell, { htmlPath }),
  // 渲染档位（质量 / 帧率）随载荷下发；缺省项不下发，由主进程交给 CLI 默认（standard / 30）
  renderVideo: (htmlPath: string, options?: RenderOverride) => ipcRenderer.invoke(IPC.Video.Render, Object.assign({ htmlPath }, options || {})),
  showInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC.Video.ShowInFolder, filePath),
  onProgress: (callback: (data: { text: string }) => void): void => {
    ipcRenderer.on(IPC.Video.Progress, (_event, data: { text: string }) => callback(data));
  }
};
contextBridge.exposeInMainWorld('hfTools', hfTools);

// 设置 & 自定义模型（OpenAI 兼容）API
const settingsTools: PreloadApi['settingsTools'] = {
  get: () => ipcRenderer.invoke(IPC.Settings.Get),
  save: (customModel) => ipcRenderer.invoke(IPC.Settings.Save, { customModel }),
  // 渲染默认档位（质量 / 帧率）：只更新 settings.json 的 render 段
  saveRender: (render) => ipcRenderer.invoke(IPC.Settings.SaveRender, { render }),
  test: (customModel) => ipcRenderer.invoke(IPC.Settings.Test, { customModel })
};
contextBridge.exposeInMainWorld('settingsTools', settingsTools);

// 千问语音：音色管理 + 文字生音频（Qwen-TTS 非实时 HTTP 方案）
const voiceTools: PreloadApi['voiceTools'] = {
  getConfig: () => ipcRenderer.invoke(IPC.Voice.GetConfig),
  getSaveDir: (payload) => ipcRenderer.invoke(IPC.Voice.GetSaveDir, payload),
  saveConfig: (voiceTTS) => ipcRenderer.invoke(IPC.Voice.SaveConfig, { voiceTTS }),
  pickAudio: (): Promise<string | null> => ipcRenderer.invoke(IPC.Voice.PickAudio),
  pickDir: () => ipcRenderer.invoke(IPC.Voice.PickDir),
  listGenerated: () => ipcRenderer.invoke(IPC.Voice.ListGenerated),
  create: (audioPath: string, preferredName: string, targetModel: string) => ipcRenderer.invoke(IPC.Voice.Create, { audioPath, preferredName, targetModel }),
  list: () => ipcRenderer.invoke(IPC.Voice.List),
  listSystemVoices: () => ipcRenderer.invoke(IPC.Voice.ListSystemVoices),
  listAll: () => ipcRenderer.invoke(IPC.Voice.ListAll),
  listModels: () => ipcRenderer.invoke(IPC.Voice.ListModels),
  getProfiles: () => ipcRenderer.invoke(IPC.Voice.GetProfiles),
  saveProfile: (profile) => ipcRenderer.invoke(IPC.Voice.SaveProfile, { profile }),
  deleteProfile: (key: string) => ipcRenderer.invoke(IPC.Voice.DeleteProfile, { key }),
  synth: (text: string, voice: string, projectName: string, saveDir: string, targetModel: string, audioName: string, defaultOut: boolean) =>
    ipcRenderer.invoke(IPC.Voice.Synth, { text, voice, projectName, saveDir, targetModel, audioName, defaultOut }),
  // 字幕配音（逐句对齐）：逐句合成 + 对齐/重排；进度经 voice:align-progress 回推
  synthAligned: (payload) => ipcRenderer.invoke(IPC.Voice.SynthAligned, payload),
  cancelAlign: (): void => ipcRenderer.send(IPC.Voice.AlignCancel),
  // 单订阅：重复注册仅替换回调，避免页面切换叠加监听
  onAlignProgress: (callback) => {
    _alignProgressCb = callback;
    if (!_alignProgressBound) {
      _alignProgressBound = true;
      ipcRenderer.on(IPC.Voice.AlignProgress, (_event, data) => { if (typeof _alignProgressCb === 'function') _alignProgressCb(data); });
    }
  }
};
contextBridge.exposeInMainWorld('voiceTools', voiceTools);

// whisper.cpp 字幕转录：模型状态/下载/删除/设为当前 + 自定义模型增删改 + 项目音频 + 音频选择 + 转录（进度经 whisper:progress 回推）
const whisperTools: PreloadApi['whisperTools'] = {
  status: () => ipcRenderer.invoke(IPC.Whisper.Status),
  download: (id: string) => ipcRenderer.invoke(IPC.Whisper.Download, { id }),
  delete: (id: string) => ipcRenderer.invoke(IPC.Whisper.Delete, { id }),
  setCurrent: (id: string) => ipcRenderer.invoke(IPC.Whisper.SetCurrent, { id }),
  addModel: (payload) => ipcRenderer.invoke(IPC.Whisper.AddModel, payload),
  updateModel: (payload) => ipcRenderer.invoke(IPC.Whisper.UpdateModel, payload),
  removeModel: (payload) => ipcRenderer.invoke(IPC.Whisper.RemoveModel, payload),
  openDir: (which) => ipcRenderer.invoke(IPC.Whisper.OpenDir, { which }),
  pickAudio: (): Promise<string | null> => ipcRenderer.invoke(IPC.Whisper.PickAudio),
  projectAudio: (name: string) => ipcRenderer.invoke(IPC.Whisper.ProjectAudio, { name }),
  transcribe: (payload) => ipcRenderer.invoke(IPC.Whisper.Transcribe, payload),
  // 单订阅：重复注册仅替换回调，避免页面切换叠加监听
  onProgress: (callback) => {
    _whisperProgressCb = callback;
    if (!_whisperProgressBound) {
      _whisperProgressBound = true;
      ipcRenderer.on(IPC.Whisper.Progress, (_event, data) => { if (typeof _whisperProgressCb === 'function') _whisperProgressCb(data); });
    }
  }
};
contextBridge.exposeInMainWorld('whisperTools', whisperTools);

// 项目化流水线（字幕 → HTML → 预览/转视频）
const projectTools: PreloadApi['projectTools'] = {
  list: () => ipcRenderer.invoke(IPC.Project.List),
  create: (name: string) => ipcRenderer.invoke(IPC.Project.Create, name),
  load: (name: string) => ipcRenderer.invoke(IPC.Project.Load, name),
  saveSubtitle: (name: string, subtitle: string, title: string) => ipcRenderer.invoke(IPC.Project.SaveSubtitle, { name, subtitle, title }),
  saveContent: (name: string, content: unknown) => ipcRenderer.invoke(IPC.Project.SaveContent, { name, content }),
  generateHtml: (name: string, prompt: string, materials) => ipcRenderer.invoke(IPC.Project.GenerateHtml, { name, prompt, ...(materials || {}) }),
  modifyHtml: (name: string, prompt: string, materials) => ipcRenderer.invoke(IPC.Project.ModifyHtml, { name, prompt, ...(materials || {}) }),
  downloadHtml: (name: string) => ipcRenderer.invoke(IPC.Project.DownloadHtml, name),
  downloadFile: (srcPath: string, defaultName: string) => ipcRenderer.invoke(IPC.Project.DownloadFile, { srcPath, defaultName }),
  exportSrt: (name: string, srt: string) => ipcRenderer.invoke(IPC.Project.ExportSrt, { name, srt }),
  readHtml: (name: string) => ipcRenderer.invoke(IPC.Project.ReadHtml, name),
  saveHtml: (name: string, html: string) => ipcRenderer.invoke(IPC.Project.SaveHtml, { name, html }),
  previewHtml: (name: string) => ipcRenderer.invoke(IPC.Project.PreviewHtml, name),
  pickAudio: (): Promise<string | null> => ipcRenderer.invoke(IPC.Project.PickAudio),
  setAudio: (name: string, audioPath: string) => ipcRenderer.invoke(IPC.Project.SetAudio, { name, audioPath }),
  clearAudio: (name: string) => ipcRenderer.invoke(IPC.Project.ClearAudio, { name }),
  pickVideo: (): Promise<string | null> => ipcRenderer.invoke(IPC.Project.PickVideo),
  setVideo: (name: string, videoPath: string) => ipcRenderer.invoke(IPC.Project.SetVideo, { name, videoPath }),
  clearVideo: (name: string) => ipcRenderer.invoke(IPC.Project.ClearVideo, { name }),
  extractVideoAudio: (name: string) => ipcRenderer.invoke(IPC.Project.ExtractVideoAudio, name),
  openFolder: (name: string) => ipcRenderer.invoke(IPC.Project.OpenFolder, name),
  openFolderOf: (dirOrFile: string) => ipcRenderer.invoke(IPC.Project.OpenFolderOf, dirOrFile),
  delete: (name: string) => ipcRenderer.invoke(IPC.Project.Delete, name),
  saveVideo: (name: string, videoPath: string) => ipcRenderer.invoke(IPC.Project.SaveVideo, { name, videoPath }),
  // 渲染档位的项目级覆盖（render 传 null 清除覆盖、回到跟随全局默认）
  setRender: (name: string, render: RenderOverride | null) => ipcRenderer.invoke(IPC.Project.SetRender, { name, render }),
  // HTML 生成/修改过程进度（单订阅：重复注册仅替换回调，避免页面切换叠加监听）
  onHtmlProgress: (callback) => {
    _htmlProgressCb = callback;
    if (!_htmlProgressBound) {
      _htmlProgressBound = true;
      ipcRenderer.on(IPC.Project.HtmlProgress, (_event, data) => { if (typeof _htmlProgressCb === 'function') _htmlProgressCb(data); });
    }
  }
};
contextBridge.exposeInMainWorld('projectTools', projectTools);

// ===== 进度通道单订阅状态（模块级标志，避免页面切换叠加监听） =====
let _htmlProgressCb: ((data: HtmlProgressPayload) => void) | null = null;
let _htmlProgressBound = false;
let _whisperProgressCb: ((data: WhisperProgressPayload) => void) | null = null;
let _whisperProgressBound = false;
let _alignProgressCb: ((data: AlignProgressPayload) => void) | null = null;
let _alignProgressBound = false;
