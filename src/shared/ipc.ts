// src/shared/ipc.ts —— IPC 频道名常量（main / preload / 渲染层三端共享）
// 频道名与现行实现逐一对应，禁止改动（preload 11 命名空间与渲染层调用依赖它们）。

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
  // 应用自更新（updater.js，electron-updater generic provider）
  Update: {
    Check: 'update:check',
    Download: 'update:download',
    Cancel: 'update:cancel',
    Install: 'update:install',
    // 同步取当前版本号（sendSync）：设置页首屏要立刻显示「当前版本 x.y.z」，不等异步检查
    Version: 'update:version',
    // 取一次当前更新状态（invoke）：启动静默检查发生在设置页订阅之前，
    // 没有这个通道渲染层永远只看到 idle——那次失败（以及它的「打开日志目录」入口）就丢了
    Status: 'update:status',
    // 定位 userData/updater.log（排障出口，不依赖 electron-updater 加载成功）
    OpenLog: 'update:open-log',
    Progress: 'update:progress'
  },
  // 设置（settings.js）
  Settings: {
    Get: 'settings:get',
    Save: 'settings:save',
    SaveRender: 'settings:save-render',
    SaveUpdater: 'settings:save-updater',
    Test: 'settings:test',
    // 运行环境「从本地文件安装」：选一个 <pack>.7z 导入（离线 / 内网机器的兜底入口）
    PickRuntimePack: 'settings:pick-runtime-pack'
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
    // 删除**云端**克隆音色（DashScope customization: action=delete）；与 DeleteProfile（只清本地映射）不同
    DeleteCloud: 'voice:delete-cloud',
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
    ShowInFolder: 'video:show-in-folder',
    Render: 'video:render',
    Progress: 'video:progress'
  },
  // 运行环境（分包）：ffmpeg / hyperframes 各一个 7z，首次用到时下载并解到 userData；
  // whisper 随安装包（extraResources），不需要下载
  Runtime: {
    Status: 'runtime:status',
    // 主动准备指定包（省略 = 全部）；取消用 Cancel
    Prepare: 'runtime:prepare',
    // 取消正在进行的下载 / 解包（用户点「取消」⇒ 不下载，且发起该操作的动作一并作废）
    Cancel: 'runtime:cancel',
    Progress: 'runtime:progress'
  },
  // 历史数据目录（index.js）：品牌/目录改名后，老目录里可能留着用户的全部数据（项目、模型、配置）。
  // 主进程负责扫描与执行；渲染层挂载时问一次 Status，用户在选择弹窗里做完决定回传 Resolve。
  Legacy: {
    Status: 'legacy:status',
    Resolve: 'legacy:resolve'
  }
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
