// src/shared/ipc.ts —— IPC 频道名常量（main / preload / 渲染层三端共享）
// 频道名与现行实现逐一对应，禁止改动（preload 13 命名空间与渲染层调用依赖它们）。

export const IPC = {
  // 窗口控制（renderer → main，send）+ 最大化状态回推（main → renderer）
  Window: {
    Minimize: 'window:minimize',
    ToggleMaximize: 'window:toggle-maximize',
    Close: 'window:close',
    MaximizedChange: 'window:maximized-change'
  },
  // 应用级小工具（renderer → main，invoke）
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
    // 取随包 CHANGELOG.md 原文（设置 → 应用更新「查看更新日志」）：
    // 主进程只读文件、不做解析——分块与排版是渲染层 utils/changelog.ts 的事
    Changelog: 'update:changelog',
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
    // 成片画布方向（项目属性，不是渲染档位）：见 shared/constants.ts 的 RENDER_CANVASES
    SetCanvas: 'project:set-canvas',
    PickAudio: 'project:pick-audio',
    SetAudio: 'project:set-audio',
    ClearAudio: 'project:clear-audio',
    // 项目素材库（图片 / 视频）：选文件 / 复制入库 / 整份列表回写（移除与勾选共用）
    PickMedia: 'project:pick-media',
    AddMaterials: 'project:add-materials',
    SaveMaterials: 'project:save-materials',
    ExtractVideoAudio: 'project:extract-video-audio',
    ReadHtml: 'project:read-html',
    PreviewHtml: 'project:preview-html',
    SaveHtml: 'project:save-html',
    // 本片用到哪几个**全局角色**（角色只有全局一份，见下面的 Cast 组）：整份列表回写，
    // 载荷是 [{ id, selected }]，主进程据此把选中的角色从库里复制进 <项目>/cast/ 并重刷页面。
    // 勾选 / 取消勾选 / 增删角色都走这一条（没有"导入""存为全局"这些动作了）。
    SaveCast: 'project:save-cast',
    HtmlProgress: 'project:html-progress'
  },
  // 全局角色库（main/cast/library.ts）：角色**只有全局一份**，落 <userData>/cast-library/
  // （index.json 存元数据 + <id>.js 存绘制代码），与项目无关——不依赖"当前项目"也能用。
  // 项目里只记「本片用了哪几个角色」（project.cast = [{ id, selected }]），生成时由主进程
  // 把选中的那些从库复制进 <项目>/cast/（预览协议与渲染静态服务器只认项目目录内的文件）。
  Cast: {
    // 列库（首次调用会把旧项目 cast/ 里尚未全局化的角色迁进库，见 ipc/cast.ts 的 migrate）
    List: 'cast:list',
    // 调一次模型画一个新角色，直接写进库（taskId 必填，进度按它路由）
    Create: 'cast:create',
    // 调一次模型按用户要求**重画库里这个角色**（覆盖库里的那份代码）
    Recreate: 'cast:recreate',
    // 只改元数据（名字 / 描述 / 画风 / 身高 / 是否水彩），不调模型
    SaveMeta: 'cast:save-meta',
    // 从库里删掉（不动任何项目里已同步的副本）
    Remove: 'cast:remove',
    // 静态预览页：主进程把 core.js + 这份角色代码拼成一页自包含 HTML，
    // 落 <userData>/cast-preview/<id>.html，渲染层用 hgpreview://…?user=1 载进 iframe（见 main/cast/preview.ts）
    Preview: 'cast:preview',
    // ===== 动作示范（「角色」页 · 双击卡片 / 「…」菜单 · 动作示范）=====
    // 角色是纯绘制函数、不含动画：一条动作 = 「时间 → 动画参数」的曲线（见 shared/types.ts 的 CastActionDef）。
    // 公共动作存 <userData>/cast-library/actions.json 的 shared，专属动作存 byCast[<角色id>]。
    ActionList: 'cast:action-list',
    // 保存 / 覆盖一条关键帧动作（同 id 覆盖；id 为空 = 新建，由主进程起 id）
    SaveAction: 'cast:action-save',
    RemoveAction: 'cast:action-remove',
    // 调一次模型，读这个角色的源码后生成一条**它专属**的动作（能用到角色自己的参数，如尾巴 / 四只脚）
    GenerateAction: 'cast:action-generate',
    // 会动的示范页：core.js + 角色代码 + 全部动作拼成 <userData>/cast-preview/<id>.demo.html
    Demo: 'cast:demo'
  },
  // 内容脚本 Agent（main/agent/script.ts）：对话式生成 / 修改场景脚本。
  // generate 只产出文本（落盘走 project:save-content）；chat 系列管 projects/<名>/chat/ 下的
  // 索引（index.json）与每版脚本副本（versions/<versionId>.json）。
  Script: {
    Generate: 'script:generate',
    LoadChat: 'script:load-chat',
    AppendRound: 'script:append-round',
    ReadVersion: 'script:read-version',
    SetActiveVersion: 'script:set-active-version',
    ClearChat: 'script:clear-chat',
    Progress: 'script:progress'
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
