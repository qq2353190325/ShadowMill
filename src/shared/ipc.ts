// src/shared/ipc.ts —— IPC 频道名常量（main / preload / 渲染层三端共享）
// 频道名与现行实现逐一对应，禁止改动（preload 8 命名空间与渲染层调用依赖它们）。

export const IPC = {
  // 窗口控制（renderer → main，send）+ 最大化状态回推（main → renderer）
  Window: {
    Minimize: 'window:minimize',
    ToggleMaximize: 'window:toggle-maximize',
    Close: 'window:close',
    MaximizedChange: 'window:maximized-change'
  },
  // 剪贴板（renderer → main，invoke）
  App: {
    CopyText: 'app:copy-text'
  },
  // 设置（settings.js）
  Settings: {
    Get: 'settings:get',
    Save: 'settings:save',
    SaveRender: 'settings:save-render',
    Test: 'settings:test'
  },
  // 千问语音（voice.js / ttsAlign.js）
  Voice: {
    GetConfig: 'voice:get-config',
    GetSaveDir: 'voice:get-save-dir',
    SaveConfig: 'voice:save-config',
    PickAudio: 'voice:pick-audio',
    Create: 'voice:create',
    ListSystemVoices: 'voice:list-system-voices',
    ListModels: 'voice:list-models',
    GetProfiles: 'voice:get-profiles',
    SaveProfile: 'voice:save-profile',
    DeleteProfile: 'voice:delete-profile',
    List: 'voice:list',
    ListAll: 'voice:list-all',
    PickDir: 'voice:pick-dir',
    ListGenerated: 'voice:list-generated',
    Synth: 'voice:synth',
    SynthAligned: 'voice:synth-aligned',
    AlignCancel: 'voice:align-cancel',
    AlignProgress: 'voice:align-progress'
  },
  // 语音识别（whisper.js）
  Whisper: {
    Status: 'whisper:status',
    Download: 'whisper:download',
    Delete: 'whisper:delete',
    SetCurrent: 'whisper:set-current',
    AddModel: 'whisper:add-model',
    UpdateModel: 'whisper:update-model',
    RemoveModel: 'whisper:remove-model',
    OpenDir: 'whisper:open-dir',
    ProjectAudio: 'whisper:project-audio',
    PickAudio: 'whisper:pick-audio',
    Transcribe: 'whisper:transcribe',
    Progress: 'whisper:progress'
  },
  // 项目流水线（projects.js）
  Project: {
    List: 'project:list',
    Create: 'project:create',
    Load: 'project:load',
    SaveSubtitle: 'project:save-subtitle',
    SaveContent: 'project:save-content',
    GenerateHtml: 'project:generate-html',
    ModifyHtml: 'project:modify-html',
    DownloadHtml: 'project:download-html',
    DownloadFile: 'project:download-file',
    ExportSrt: 'project:export-srt',
    OpenFolder: 'project:open-folder',
    OpenFolderOf: 'project:open-folder-of',
    Delete: 'project:delete',
    SaveVideo: 'project:save-video',
    SetRender: 'project:set-render',
    PickAudio: 'project:pick-audio',
    SetAudio: 'project:set-audio',
    ClearAudio: 'project:clear-audio',
    PickVideo: 'project:pick-video',
    SetVideo: 'project:set-video',
    ClearVideo: 'project:clear-video',
    ExtractVideoAudio: 'project:extract-video-audio',
    ReadHtml: 'project:read-html',
    PreviewHtml: 'project:preview-html',
    SaveHtml: 'project:save-html',
    HtmlProgress: 'project:html-progress'
  },
  // 预览 / HyperFrames 转视频（video.js）
  Video: {
    OpenHtml: 'dialog:open-html',
    ListProjects: 'video:list-projects',
    PreviewShell: 'video:preview-shell',
    ShowInFolder: 'video:show-in-folder',
    Render: 'video:render',
    Progress: 'video:progress'
  }
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
