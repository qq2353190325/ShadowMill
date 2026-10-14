// src/shared/types.ts —— 跨进程共享的载荷类型（main / preload / 渲染层三端共用）
// 约束一：载荷格式必须与现行实现逐字段一致，禁止改结构（本文件只「描述」载荷，不含任何运行时逻辑）。
// 约束二：新增/修改 IPC 接口须三处齐改 —— 主进程 register() 回调、本文件类型、preload 桥接方法。
// 组织：① 通用 IPC 结果 ② 主进程装配上下文 ③ 设置 ④ 音色与配音 ⑤ 语音识别 ⑥ 项目与字幕 ⑦ 预览/转视频 ⑧ 进度推送
import type { BrowserWindow } from 'electron'

// ============================================================
// ① 通用 IPC 结果
// ============================================================
// 失败分支：多数频道必带 message；唯 voice:pick-dir 的「用户取消」分支只回
// { ok:false, canceled:true }（无 message），故 message 为可选、canceled 用于区分取消与真失败。
// 运行环境分包名（定义放最前：IpcFail.needPacks 与 ⑧ 的进度载荷都要用；详细说明见本文件「运行环境」一节）
export type RuntimePackName = 'ffmpeg' | 'hyperframes'

export interface IpcFail {
  ok: false
  message?: string
  // 可选的技术详情（原始报错 / HTTP 状态 / 请求 URL）：供 UI 的「查看详情」折叠展示，
  // 与面向用户的 message 分离——message 说人话，detail 给排障。见 UpdateCheckResult.detail
  detail?: string
  canceled?: boolean
  // 这次失败是因为「本机缺运行环境包」：界面据此弹「需要下载运行环境（体积）/ 取消」确认框，
  // 用户确认后调 runtimeTools.prepare(needPacks) 下载，下完由用户在同一个框里点「继续」重发本操作。
  // 详见 docs/runtime-pack-split.md §5.2
  needPacks?: RuntimePackName[]
}
// 成功分支：{ ok: true } 与业务字段 T 的交叉类型；T 缺省（unknown）表示调用方只关心 ok。
// message 在成功分支也可选：取消、幂等复用（"当前没有正在进行的下载"）等场景需要给一句话回执。
export type IpcResult<T = unknown> = ({ ok: true; message?: string } & T) | IpcFail

// ============================================================
// ② 主进程装配上下文（各业务模块 register(ctx) 模式）
// ============================================================
export interface RegisterCtx {
  getWindow: () => BrowserWindow | null
}

// ============================================================
// ③ 设置（userData/settings.json）
// ============================================================
export interface CustomModelConfig {
  baseUrl: string
  modelId: string
  apiKey: string
  enabled: boolean
}

// ===== 语音服务：按厂家（厂商）组织 =====
// 一家 = 一条记录：只有一把 API Key；模型表与系统音色表都在厂家的目录里（main/voiceCatalog.ts 的 VOICE_PROVIDERS）。
// **不再有「厂家默认模型」这种全局设置**：系统音色与模型是固定的对应关系（目录里写死），
// 克隆音色按其本地映射/云端 target_model 走，都没有时才落到目录里该厂家的出厂默认模型。
export interface VoiceProviderConfig {
  apiKey: string
}
export interface VoiceSettings {
  /** 当前选中的厂家 key（对应 voiceCatalog 的 VoiceProviderDef.key） */
  active: string
  /** 厂家 key → 该厂家已保存的配置 */
  providers: Record<string, VoiceProviderConfig>
  /** 自定义保存目录（与厂家无关，全局一份） */
  saveDir: string
}

// 旧结构（单厂家、无厂家字段）：仅作为迁移来源读取，新写入一律是上面的 VoiceSettings。
// 保留类型是为了 settings.ts 的迁移分支能显式声明「我在读旧字段」。
export interface VoiceTTSConfig {
  apiKey: string
  targetModel: string
  saveDir: string
}

// ===== 应用自更新（electron-updater generic provider）=====
// feedUrl 留空 = 使用打包时写死在 resources/app-update.yml 的地址（由 package.json 的 build.publish 生成）；
// 非空 = 运行时用 autoUpdater.setFeedURL 覆盖，供测试源 / 内网源切换（见 settings:save-updater）。
export interface UpdaterSettings {
  feedUrl: string
  // 启动后是否静默检查一次（只更新状态，不弹窗打扰）
  autoCheck: boolean
  // 用户选择「跳过」的版本号；该版本不再提示（升到更新的版本后提示自动恢复）
  skippedVersion: string
}

// 音色类型：system = 内置系统音色，custom = 用户克隆音色
export type VoiceProfileType = 'system' | 'custom'

// 本地音色映射：key 形如 "system:Cherry" / "custom:<voice_id>"
export interface VoiceProfile {
  key: string
  name: string
  voice: string
  targetModel: string
  type: VoiceProfileType
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

// 保存「本地音色映射」的入参：name / type 可缺省（主进程按 voice 回填 name、按 'system' 之外一律归 'custom'）
export interface VoiceProfileInput {
  key: string
  voice: string
  targetModel: string
  name?: string
  type?: VoiceProfileType
}

export interface WhisperSettings {
  modelId: string
  customModels: WhisperCustomModel[]
}

// ===== 视频渲染档位（普通用户只暴露这两项：质量 + 帧率）=====
// 质量 draft|standard|high；帧率 24|30（HyperFrames CLI 还支持 60，属专业档位，本轮不暴露）。
// 主进程按白名单校验后才拼 --quality / --fps（见 video.ts / settings.ts），非法值一律忽略。
export type RenderQuality = 'draft' | 'standard' | 'high'
export type RenderFps = 24 | 30
export interface RenderOptions {
  quality: RenderQuality
  fps: RenderFps
}
// 项目级覆盖：字段可缺省，缺省项跟随全局默认（settings.json 的 render）
export type RenderOverride = Partial<RenderOptions>

export interface AppSettings {
  customModel: CustomModelConfig
  // 语音服务（按厂家）：唯一写入源
  voice: VoiceSettings
  // 旧结构：只读兼容（迁移来源），新写入不再包含该字段
  voiceTTS?: VoiceTTSConfig
  voiceProfiles: Record<string, VoiceProfile>
  whisper: WhisperSettings
  // 视频渲染全局默认档位（项目未覆盖时生效）
  render: RenderOptions
  // 应用自更新：更新源覆盖 / 启动静默检查 / 已跳过版本
  updater: UpdaterSettings
}

// settings:* 载荷与结果（settings:get 直接返回 AppSettings，不经 ok 包裹）
export interface SettingsSavePayload {
  customModel: CustomModelConfig
}
export interface SettingsTestPayload {
  customModel: CustomModelConfig
}
export interface SettingsSaveResult {
  settings: AppSettings
}
// settings:save-render 载荷：只更新渲染默认档位，不动 customModel
export interface SettingsSaveRenderPayload {
  render?: RenderOverride
}
// settings:save-updater 载荷：只更新更新源 / 自动检查开关
export interface SettingsSaveUpdaterPayload {
  updater?: Partial<UpdaterSettings>
}

// ============================================================
// ③.5 应用自更新（src/main/updater.ts）
// ============================================================
// update:check 的三种非失败分支：none 已是最新 / available 有新版本 / skipped 该版本被用户跳过
export type UpdateCheckState = 'none' | 'available' | 'skipped'
export interface UpdateCheckResult {
  state: UpdateCheckState
  // 状态为 none / skipped 时也回带，便于 UI 显示「已是最新 1.0.0」
  version: string
  currentVersion: string
  // 用户可见文案：由主进程**单点产出**（含 available / skipped / none 三种状态文案），
  // UI 直接渲染即可——早前渲染层也自己拼一套「发现新版本…」，与事件推送的文案互相覆盖。
  message: string
  // 排障详情（HTTP 状态、AccessDenied 原文、请求 URL 等）：只在 UI「查看详情」里展开，
  // 与 message 分离是因为 403 / 404 / 缺 app-update.yml 的处置动作都在发布者那一侧。
  detail?: string
}
// update:progress 的进度阶段：
// idle 尚未检查；checking 检查中；available 有新版本；skipped 该版本被用户跳过；
// downloading 下载中；downloaded 已下载待重启安装；none 已是最新；error 出错
export type UpdateStage = 'idle' | 'checking' | 'available' | 'skipped' | 'downloading' | 'downloaded' | 'none' | 'error'
export interface UpdateProgressPayload {
  stage: UpdateStage
  // 目标版本（checking 阶段未知时为空串）
  version: string
  currentVersion: string
  // downloading 阶段有效；其余阶段为 0
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
  // 用户可见文案（人话：发生了什么 + 能做什么）
  message: string
  // 排障详情，仅 error 阶段非空；UI 默认折叠，见 UpdateCheckResult.detail
  detail?: string
}

// ============================================================
// ③.6 运行环境包（src/main/runtime.ts）
// ============================================================
// 运行环境（分包：ffmpeg / hyperframes 各自一个 7z，首次用到时下载；whisper 随安装包）
// ============================================================
// 为什么分包：ffmpeg(180MB) 被「转录转码」与「渲染」两条线共用、hyperframes(440MB) 只有渲染要、
// whisper(12.5MB) 缺了转录就完全不能用——三者变化节奏与归属都不同，捆在一起会让每次更新都重下全部。
// 详见 docs/runtime-pack-split.md。
// 单个包的状态：ready 已就绪；missing 本机没有（需要下载）；unknown 还没探测过
export type RuntimePackState = 'ready' | 'missing' | 'unknown'
// phase：idle 未开始；checking 探测/取清单；downloading 下载中；extracting 解包中；
//        ready 需要的包都就绪；cancelled 用户取消（**不是失败**）；error 失败（有 detail 可排障）
export type RuntimePhase = 'idle' | 'checking' | 'downloading' | 'extracting' | 'ready' | 'cancelled' | 'error'
export interface RuntimeProgressPayload {
  phase: RuntimePhase
  // 正在处理的包；空闲 / 就绪时为 null
  pack: RuntimePackName | null
  // downloading / extracting 阶段有效（当前这个包的百分比），ready 为 100
  percent: number
  // 本次操作需要的全部包（供界面说明「要下什么」）
  packs: RuntimePackName[]
  // 当前仍缺的包（就绪后为空数组）
  missing: RuntimePackName[]
  // 各包在本机的状态（设置页据此分项显示）
  status: Record<RuntimePackName, RuntimePackState>
  // 用户可见文案（人话：正在做什么 / 已经就绪 / 失败了怎么办）
  message: string
  // 排障详情（7za 退出码、HTTP 状态、路径等），仅失败或降级时有值
  detail?: string
  // 来源：remote=从更新源下载；local=用户指定的本地 7z（SHADOWMILL_RUNTIME_PACK / 设置页选择）；
  //       legacy=沿用旧版整体包已解开的目录；dev=开发态项目根 resources；cache=复用已解包目录
  source: string
  // 当前包的下载体积（下载进度用）
  bytes: number
  // 解包后体积与文件数（解包进度的分母）
  unpackedBytes: number
  files: number
  // 是否可取消（downloading / extracting 期间为 true）
  cancellable: boolean
}

// ============================================================
// ⑧b 历史数据目录（品牌/目录改名留下的老数据）
// ============================================================
// 背景：userData 目录名跟随 package.json 的 name。2026-10-12 品牌更名（my-app → shadowmill）后，
// 老用户的数据仍留在 %APPDATA%\my-app，打开应用会看到「项目全没了」。
// 流程：主进程扫历史目录名 + 归属证明确认 → 渲染层弹应用内弹窗 → 用户选 迁移 / 删除 / 稍后。
export interface LegacyDataInfo {
  // 老目录绝对路径（例如 C:\Users\x\AppData\Roaming\my-app）
  dir: string
  // 其中确有数据的条目名（projects / whisper / voice / tts-output / html-agent / settings.json）
  entries: string[]
  // projects/ 下的项目数；没数出来为 0
  projects: number
}
export type LegacyResolveAction = 'migrate' | 'delete' | 'later'
export interface LegacyResolveResult {
  ok: boolean
  action: LegacyResolveAction
  // 迁移统计（action === 'migrate' 时有值）
  moved?: number
  skipped?: number
  failed?: number
  message?: string
}

// ============================================================
// ④ 音色与配音（voice.ts / ttsAlign.ts）
// ============================================================
// Qwen-TTS 系统音色（内置表 systemVoices.ts 的条目结构）
export interface SystemVoice {
  voice: string
  desc: string
  langs: string
  series: string[]
}

// voice:list-system-voices 结果项：系统音色 + 其绑定/默认合成模型
export interface SystemVoiceItem extends SystemVoice {
  model: string
}

// 候选合成模型（voice:list-models）：role=clone 用于克隆音色，role=system 用于系统音色
export type VoiceModelRole = 'clone' | 'system'
// 音色克隆的音频输入方式：url = 除本地文件外还接受公网音频 URL（qwen-audio-*），file = 只接受本地音频文件
// （vc 系列移除后千问只剩 url 一档；file 留给将来「只收本地文件」的厂家）
export type VoiceModelInput = 'url' | 'file'
export interface VoiceModel {
  id: string
  label: string
  role: VoiceModelRole
  input?: VoiceModelInput
  group?: string
  isDefault?: boolean
  series?: string
}

// 云端克隆音色项（voice:list）：Qwen-TTS 系列返回 voice，Qwen-Audio-TTS 系列返回 voice_id
export interface ClonedVoice {
  voice?: string
  voice_id?: string
  target_model?: string
  targetModel?: string
}

// voice:list-all 结果项（系统 + 克隆合并，统一「音色即模型」UI 形态）
export interface VoiceListItem {
  key: string
  type: VoiceProfileType
  name: string
  voiceId: string
  model: string
}

// voice:list-generated 结果项
export interface GeneratedAudioItem {
  path: string
  name: string
  group: string
  size: number
  mtime: number
}

// voice:list-models / voice:get-config 回带的「厂家目录」：渲染层据此把模型与音色按厂家分组展示
export interface VoiceProviderView {
  key: string
  label: string
  /** API Key 输入框的占位提示（形如 sk-...（DASHSCOPE_API_KEY）） */
  apiKeyHint: string
  /** 厂家的默认合成模型（音色未单独绑模型时的兜底） */
  defaultModel: string
  models: VoiceModel[]
  voices: SystemVoice[]
}

export interface VoiceConfigResult {
  /** 当前选中的厂家 key */
  active: string
  /** 各厂家已保存的配置（key 缺失表示该厂家还没配过） */
  providers: Record<string, VoiceProviderConfig>
  saveDir: string
}

export interface VoiceSaveDirPayload {
  saveDir?: string
  defaultOut?: boolean
  projectName?: string
}
// 保存目录解析模式：custom = 自定义目录，output = 音频输出目录（不写入项目），project = 项目 audio/，default = 兜底目录
export type VoiceSaveDirMode = 'custom' | 'output' | 'project' | 'default'
export interface VoiceSaveDirResult {
  mode: VoiceSaveDirMode
  saveDir: string
}

export interface VoiceSaveConfigPayload {
  /** 要保存的厂家 key；缺省 = 当前 active 厂家 */
  provider?: string
  /** 该厂家要更新的字段（未给的字段保持原值） */
  config?: Partial<VoiceProviderConfig>
  /** 全局「自定义保存目录」；给了就一并更新（不动 Key、不切厂家） */
  saveDir?: string
}
export interface VoiceProfilesResult {
  profiles: Record<string, VoiceProfile>
}
export interface VoiceProfilePayload {
  profile: Partial<VoiceProfile> & { type?: string }
}
export interface VoiceProfileKeyPayload {
  key: string
}

// voice:create 载荷：audioPath 为本地音频绝对路径、公网 URL / oss:// 地址，或 data:audio/...;base64 URI。
// 本地文件由主进程用 ffmpeg 裁成前 15 秒 24k 单声道 wav 再转 data URI，放进复刻接口的 input.url
// （Qwen-Audio-TTS 系列；该系列也接受公网 URL，两者都由主进程按字符串形态分流）。
export interface VoiceCreatePayload {
  audioPath?: string
  targetModel?: string
  preferredName?: string
}
// voice:create 结果：voice 取自返回体的 output.voice_id；targetModel 是本次请求发的目标模型
// （创建返回体不带 target_model，所以这里不再从响应里猜；曾经的 fallbackMode / fallbackReason 已删——
//   文档没有这两个字段，实测也从未返回过）
export interface VoiceCreateResult {
  voice: string
  targetModel: string
}

// voice:synth 载荷与结果（载荷由 preload 按位置参数组装）
export interface VoiceSynthPayload {
  text?: string
  voice?: string
  targetModel?: string
  projectName?: string
  saveDir?: string
  defaultOut?: boolean
  audioName?: string
}
export interface VoiceSynthResult {
  savePath: string
  projectName: string
  savedTo: VoiceSavedTo
  size: number
}
// voice:synth 落盘位置（与 voice:get-save-dir 的 VoiceSaveDirMode 取值集合相同，但字段名不同：
// 这里叫 savedTo，那里叫 mode —— 现行实现如此，勿「统一化」）
export type VoiceSavedTo = 'custom' | 'output' | 'project' | 'default'

// voice:synth-aligned —— 字幕配音逐句对齐
// audio-driven：以实测每句时长重建字幕时间线（音频不变速）
// timeline-driven：保持字幕时间，每句配音摆放到其字幕时间点（超时先 atempo 加速，仍超则顺延）
export type VoiceAlignMode = 'audio-driven' | 'timeline-driven'
export interface VoiceAlignPayload {
  subtitleText: string
  voice: string
  mode?: VoiceAlignMode
  gapSec?: number
  voiceModel?: string
  projectName?: string
}
// 段状态：ok = 正常，accelerated = 已 atempo 加速，pushed = 槽位不足顺延且平移后续字幕时间
export type AlignSegStatus = 'ok' | 'accelerated' | 'pushed'
export interface VoiceAlignDetail {
  index: number
  text: string
  subtitleStart: number
  audioStart: number
  audioDur: number
  status: AlignSegStatus
  rate: number
  delta: number
  segPath: string
}
export interface VoiceAlignResult {
  mode: VoiceAlignMode
  subtitleText: string
  audioPath: string
  totalDur: number
  details: VoiceAlignDetail[]
}

// ============================================================
// ⑤ 语音识别（whisper.ts）
// ============================================================
// 识别语言 id（whisper-cli 的 -l 参数；zh-hant 也按 zh 识别，仅区别是否做繁→简转换）
export type WhisperLangId = 'auto' | 'zh' | 'zh-hant' | 'en'
export interface WhisperLang {
  id: WhisperLangId
  label: string
}

// whisper:status 的模型项（内置档位与自定义模型统一结构）
export interface WhisperModelItem {
  id: string
  label: string
  sizeMB: number
  speed: string
  desc: string
  file: string
  custom: boolean
  localFile: string
  url: string
  downloaded: boolean
  localBytes: number
  isCurrent: boolean
}

export interface WhisperStatusResult {
  cli: { exists: boolean; path: string }
  modelsDir: string
  langs: WhisperLang[]
  models: WhisperModelItem[]
  unknownFiles: string[]
  usedBytes: number
  currentModelId: string
}

export interface WhisperIdPayload {
  id: string
}
export interface WhisperAddModelPayload {
  name?: string
  file?: string
  url?: string
  desc?: string
  sizeMB?: number | string
}
// 编辑时 file / id 固定不变，仅按需更新 name / url / sizeMB / desc（空值保留原值）
export interface WhisperUpdateModelPayload {
  id?: string
  name?: string
  url?: string
  desc?: string
  sizeMB?: number | string
}
export interface WhisperOpenDirPayload {
  which?: 'models' | 'cli'
}

export interface WhisperProjectAudioPayload {
  name?: string
}

export interface WhisperTranscribePayload {
  id?: string
  audioPath?: string
  language?: WhisperLangId
}
export interface WhisperSegment {
  start: number
  end: number
  text: string
}
export interface WhisperTranscribeResult {
  id: string
  text: string
  subtitleText: string
  segments: WhisperSegment[]
  model: string
}
export interface WhisperProjectAudioResult {
  path: string
  name: string
}

// ============================================================
// ⑥ 项目与字幕（projects.ts）
// ============================================================
export interface Scene {
  id: string
  narration: string
  visual: string
  durHint: string
}
export interface ContentScript {
  style: string
  scenes: Scene[]
}

// userData/projects/<项目名>/project.json 的完整结构
export interface Project {
  name: string
  title: string
  subtitle: string
  subtitleCount?: number
  htmlPath: string
  videoPath: string
  videoMaterial?: string
  audioFile: string
  content: ContentScript
  // 视频渲染档位的项目级覆盖：字段缺省即跟随全局默认（settings.json 的 render）
  render?: RenderOverride
  createdAt: string
  updatedAt?: string
}

// 字幕行（projects.ts parseSubtitle 输出）：time / end 为秒，可带小数
export interface SubtitleLine {
  n: number
  text: string
  time: number
  end: number | null
}

// project:list 结果项（首页 / 步骤条的项目卡片与下拉）
export interface ProjectMeta {
  name: string
  title: string
  hasSubtitle: boolean
  hasHtml: boolean
  hasVideo: boolean
  subtitleCount: number
  updatedAt: string
}

// 仅以项目名定位的载荷（delete / open-folder / extract-video-audio 等）
export interface ProjectNamePayload {
  name: string
}
export interface ProjectSaveSubtitlePayload {
  name?: string
  subtitle?: string
  title?: string
}
export interface ProjectSaveContentPayload {
  name?: string
  content?: unknown
}
export interface ProjectSaveResult {
  project: Project
}
export interface ProjectExportSrtPayload {
  name?: string
  srt?: string
}
export interface ProjectDownloadResult {
  savedPath: string
}
export interface ProjectSetAudioPayload {
  name?: string
  audioPath?: string
}
// project:set-video 与 project:save-video 载荷同形（name + 绝对 videoPath），共用此类型
export interface ProjectSetVideoPayload {
  name?: string
  videoPath?: string
}
// project:set-render 载荷：render 传 null（或字段全非法）表示清除项目覆盖、回到跟随全局默认
export interface ProjectSetRenderPayload {
  name?: string
  render?: RenderOverride | null
}
export interface ProjectSetAudioResult {
  audioFile: string
  // 设置/移除背景音频时，若 index.html 里的注入音轨被同步改写则为 true（渲染层据此刷新预览）
  htmlUpdated?: boolean
}
export interface ProjectSetVideoResult {
  videoFile: string
  abs: string
}
export interface ProjectReadHtmlResult {
  html: string
}
export interface ProjectSaveHtmlPayload {
  name?: string
  html?: string
}
export interface ProjectPreviewHtmlResult {
  previewPath: string
}
export interface ProjectOpenFolderOfResult {
  dir: string
}

// HTML 生成/修改的素材选择（键名与主进程 resolveMaterials 严格对应）：
// subtitleProject：'' = 不使用；'__current__' = 当前项目字幕；其他 = 指定带字幕的项目名
// videoPath：'' = 不使用；'__current__' = 当前项目视频素材（自定义导入走 project:set-video，不由本载荷传路径）
// 注：背景音频不是生成素材——它由应用按 project.audioFile 直接注入 HTML 的 <audio id="myv-bgm">，
//     提示词只声明「不要写音轨标签」，模型不需要也无法处理音轨。
export interface ProjectHtmlMaterials {
  subtitleProject?: string
  videoPath?: string
}
// project:generate-html / project:modify-html 线上载荷 = 项目名 + 需求描述 + 素材（preload 展开合并）
export interface ProjectAgentPayload extends ProjectHtmlMaterials {
  name: string
  prompt: string
}
export interface ProjectHtmlResult {
  htmlPath: string
  compatible: boolean
  // 成功分支也可能带提示：合规校验未过 / 修改后旧视频已置空等
  message?: string
}

// ============================================================
// ⑦ 预览 / HyperFrames 转视频（video.ts）
// ============================================================
// 渲染档位随载荷下发（渲染层已把「项目覆盖 > 全局默认」合并成有效值）；缺省则不传参数、走 CLI 默认
export interface VideoRenderPayload extends RenderOverride {
  htmlPath?: string
}
// 渲染结果：失败分支的 compatible=false 表示 HTML 未通过 HyperFrames 合规校验；
// needPacks 非空表示本机缺运行环境包（界面据此弹下载确认框，见 docs/runtime-pack-split.md §5.2）
export type VideoRenderResult =
  | { ok: true; outputVideo: string; projectDir: string }
  | { ok: false; message: string; compatible?: boolean; needPacks?: RuntimePackName[] }

// ============================================================
// ⑧ 进度推送（4 路 main → renderer，均为单订阅语义）
// ============================================================
// project:html-progress —— HTML 生成/修改的五阶段（projects.ts 额外补 text 文案字段）
export type HtmlAgentStage = 'connecting' | 'thinking' | 'writing' | 'retry' | 'done'
export interface HtmlAgentProgress {
  stage: HtmlAgentStage
  thinkChars: number
  contentChars: number
  thinkText: string
}
export interface HtmlProgressPayload extends HtmlAgentProgress {
  text: string
}

// whisper:progress —— 下载与转录共用；loading / transcribing 为转录两阶段
export type WhisperProgressStage = 'downloading' | 'loading' | 'transcribing' | 'done' | 'error'
export interface WhisperProgressPayload {
  id?: string
  stage: WhisperProgressStage
  percent?: number
  receivedBytes?: number
  totalBytes?: number
  message: string
}

// voice:align-progress —— 逐句对齐：synth（逐句合成）→ assemble（装配）→ done / error
export type AlignProgressStage = 'synth' | 'assemble' | 'done' | 'error'
export interface AlignProgressPayload {
  stage: AlignProgressStage
  index?: number
  total?: number
  percent?: number
  message: string
}

// video:progress —— HyperFrames 渲染日志行（渲染层按 [Render:trace] 前缀自行解析）
export interface VideoProgressPayload {
  text: string
}

// ============================================================
// ⑨ window.* API 契约（preload 实现与渲染层消费的唯一真源）
// ============================================================
// 用法：preload/index.ts 用 PreloadApi['<命名空间>'] 标注各 contextBridge 对象（实现被契约校验），
//      preload/index.d.ts 用 `interface Window extends PreloadApi` 暴露给渲染层（消费方拿到同一签名）。
// 因此「preload 实现」与「渲染层看到的 window.*」不会再各自漂移：改这里两端同时生效。
// 命名空间与 IPC 频道的对应关系见 src/shared/ipc.ts（9 个命名空间 ↔ 8 组频道常量）。
export interface PreloadApi {
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
    // options 为渲染档位（质量 / 帧率）；缺省项不下发，由主进程交给 CLI 默认（standard / 30）
    renderVideo(htmlPath: string, options?: RenderOverride): Promise<VideoRenderResult>
    showInFolder(filePath: string): Promise<void>
    onProgress(callback: (data: VideoProgressPayload) => void): void
  }
  settingsTools: {
    get(): Promise<AppSettings>
    save(customModel: CustomModelConfig): Promise<IpcResult<SettingsSaveResult>>
    // 渲染默认档位（settings.json 的 render 段）
    saveRender(render: RenderOverride): Promise<IpcResult<SettingsSaveResult>>
    // 更新源与自动检查开关（settings.json 的 updater 段）
    saveUpdater(updater: Partial<UpdaterSettings>): Promise<IpcResult<SettingsSaveResult>>
    test(customModel: CustomModelConfig): Promise<IpcResult>
    // 运行环境「从本地文件安装」：弹出文件选择框选一个 <pack>.7z 并导入（离线 / 内网机器兜底）。
    // 取消时 { ok:false, canceled:true }；导入成功后调用方接着 runtimeTools.prepare()
    pickRuntimePack(): Promise<IpcResult<{ pack?: RuntimePackName }>>
  }
  // 应用自更新（electron-updater）：检查 / 下载 / 取消 / 重启安装 + 进度推送
  updateTools: {
    // 同步返回当前版本号（app.getVersion()），供设置页首屏显示
    version(): string
    check(): Promise<IpcResult<UpdateCheckResult>>
    download(): Promise<IpcResult<{ version: string }>>
    cancel(): Promise<IpcResult>
    // 退出应用并运行安装程序（主进程先置 quitForUpdate 标志，避免与 window-all-closed 抢流程）
    install(): Promise<IpcResult>
    // 取一次当前更新状态（主进程状态跨页面挂载持续存在）：
    // 设置页挂载时补齐一次，好让「启动静默检查」的那次失败也能显示出来
    status(): Promise<UpdateProgressPayload>
    // 在文件管理器里定位 userData/updater.log（没有日志则打开 userData 目录）：
    // 更新失败时用户 / 维护者唯一的原始报错出口，不依赖 electron-updater 是否加载成功
    openLog(): Promise<IpcResult<{ path: string }>>
    onProgress(callback: (data: UpdateProgressPayload) => void): void
  }
  // 运行环境（分包）：ffmpeg / hyperframes 各自一个 7z、首次用到时下载；whisper 随安装包。
  // 页面据此显示「正在下载运行环境 x%」，以及缺失时的「需要下载 xx MB」与取消入口
  runtimeTools: {
    status(): Promise<RuntimeProgressPayload>
    // 主动准备指定包（省略 = 全部）：用户确认下载 / 失败后重试 / 设置页「下载」按钮。
    // 幂等，并发调用共享同一次执行；进度由 runtime:progress 回推，这里只回成败（取消时 ok=false）
    prepare(packs?: RuntimePackName[]): Promise<IpcResult>
    // 取消正在进行的下载 / 解包（用户点「取消」）：取消后不留半份状态，也不产生任何下载结果
    cancel(): Promise<IpcResult>
    onProgress(callback: (data: RuntimeProgressPayload) => void): void
  }
  // 历史数据目录（品牌/目录改名留下的老数据）：渲染层挂载时问一次有没有待处理的旧目录，
  // 有就弹应用内弹窗；用户的选择经 resolve 回传。主进程不做任何"启动时弹原生对话框"。
  legacyTools: {
    status(): Promise<LegacyDataInfo | null>
    resolve(action: LegacyResolveAction): Promise<LegacyResolveResult>
  }
  voiceTools: {
    getConfig(): Promise<IpcResult<VoiceConfigResult>>
    getSaveDir(payload: VoiceSaveDirPayload): Promise<IpcResult<VoiceSaveDirResult>>
    saveConfig(payload: VoiceSaveConfigPayload): Promise<IpcResult<SettingsSaveResult>>
    pickAudio(): Promise<string | null>
    pickDir(): Promise<IpcResult<{ dir: string }>>
    listGenerated(): Promise<IpcResult<{ items: GeneratedAudioItem[]; total: number }>>
    create(audioPath: string, preferredName: string, targetModel: string): Promise<IpcResult<VoiceCreateResult>>
    list(): Promise<IpcResult<{ voices: ClonedVoice[]; total: number }>>
    listSystemVoices(): Promise<IpcResult<{ voices: SystemVoiceItem[]; total: number }>>
    listAll(): Promise<IpcResult<{ voices: VoiceListItem[]; total: number; cloudMessage: string }>>
    listModels(): Promise<IpcResult<{ models: VoiceModel[]; providers: VoiceProviderView[] }>>
    getProfiles(): Promise<IpcResult<VoiceProfilesResult>>
    saveProfile(profile: VoiceProfileInput): Promise<IpcResult<VoiceProfilesResult>>
    deleteProfile(key: string): Promise<IpcResult<VoiceProfilesResult>>
    /** 删除云端克隆音色（不可撤销）；成功后主进程会一并清掉该音色的本地映射，并回带最新映射表 */
    deleteCloudVoice(voice: string): Promise<IpcResult<VoiceProfilesResult & { voice: string }>>
    synth(text: string, voice: string, projectName: string, saveDir: string, targetModel: string, audioName: string, defaultOut: boolean): Promise<IpcResult<VoiceSynthResult>>
    synthAligned(payload: VoiceAlignPayload): Promise<IpcResult<VoiceAlignResult>>
    cancelAlign(): void
    onAlignProgress(callback: (data: AlignProgressPayload) => void): void
  }
  whisperTools: {
    status(): Promise<IpcResult<WhisperStatusResult>>
    // 以下写操作成功分支均可能回带 message（如「本地已有模型文件，无需重复下载」）
    download(id: string): Promise<IpcResult<{ id: string; sizeBytes: number; message?: string }>>
    delete(id: string): Promise<IpcResult<{ id: string; removed: string }>>
    setCurrent(id: string): Promise<IpcResult<{ id: string }>>
    addModel(payload: WhisperAddModelPayload): Promise<IpcResult<{ id: string; message?: string }>>
    updateModel(payload: WhisperUpdateModelPayload): Promise<IpcResult<{ id: string; message?: string }>>
    removeModel(payload: { id: string }): Promise<IpcResult<{ id: string; message?: string }>>
    openDir(which: 'models' | 'cli'): Promise<IpcResult<{ path: string }>>
    pickAudio(): Promise<string | null>
    projectAudio(name: string): Promise<IpcResult<WhisperProjectAudioResult>>
    transcribe(payload: WhisperTranscribePayload): Promise<IpcResult<WhisperTranscribeResult>>
    onProgress(callback: (data: WhisperProgressPayload) => void): void
  }
  projectTools: {
    list(): Promise<ProjectMeta[]>
    create(name: string): Promise<IpcResult<ProjectSaveResult>>
    load(name: string): Promise<Project | null>
    saveSubtitle(name: string, subtitle: string, title: string): Promise<IpcResult<ProjectSaveResult>>
    saveContent(name: string, content: unknown): Promise<IpcResult<ProjectSaveResult>>
    generateHtml(name: string, prompt: string, materials?: ProjectHtmlMaterials): Promise<IpcResult<ProjectHtmlResult>>
    modifyHtml(name: string, prompt: string, materials?: ProjectHtmlMaterials): Promise<IpcResult<ProjectHtmlResult>>
    downloadHtml(name: string): Promise<IpcResult<ProjectDownloadResult>>
    exportSrt(name: string, srt: string): Promise<IpcResult<ProjectDownloadResult>>
    readHtml(name: string): Promise<IpcResult<ProjectReadHtmlResult>>
    saveHtml(name: string, html: string): Promise<IpcResult<ProjectHtmlResult>>
    previewHtml(name: string): Promise<IpcResult<ProjectPreviewHtmlResult>>
    pickAudio(): Promise<string | null>
    setAudio(name: string, audioPath: string): Promise<IpcResult<ProjectSetAudioResult>>
    clearAudio(name: string): Promise<IpcResult>
    pickVideo(): Promise<string | null>
    setVideo(name: string, videoPath: string): Promise<IpcResult<ProjectSetVideoResult>>
    clearVideo(name: string): Promise<IpcResult>
    extractVideoAudio(name: string): Promise<IpcResult<ProjectSetAudioResult>>
    openFolder(name: string): Promise<IpcResult>
    openFolderOf(dirOrFile: string): Promise<IpcResult<ProjectOpenFolderOfResult>>
    delete(name: string): Promise<IpcResult>
    saveVideo(name: string, videoPath: string): Promise<IpcResult<ProjectSaveResult>>
    // 渲染档位的项目级覆盖；render 传 null 清除覆盖、回到跟随全局默认
    setRender(name: string, render: RenderOverride | null): Promise<IpcResult<ProjectSaveResult>>
    onHtmlProgress(callback: (data: HtmlProgressPayload) => void): void
  }
}
