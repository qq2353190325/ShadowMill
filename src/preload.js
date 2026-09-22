// 预加载脚本：通过 contextBridge 向渲染进程暴露安全 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});

// 应用级小工具：剪贴板复制（sandbox 下渲染层无 clipboard 模块，经主进程写入）
contextBridge.exposeInMainWorld('appTools', {
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text)
});

// 自绘标题栏：窗口控制 API
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximized-change', (_event, isMaximized) => callback(isMaximized));
  }
});

// 预览 & HyperFrames 转视频 API
contextBridge.exposeInMainWorld('hfTools', {
  openHtml: () => ipcRenderer.invoke('dialog:open-html'),
  listProjects: () => ipcRenderer.invoke('video:list-projects'),
  previewShell: (htmlPath) => ipcRenderer.invoke('video:preview-shell', { htmlPath }),
  renderVideo: (htmlPath) => ipcRenderer.invoke('video:render', { htmlPath }),
  showInFolder: (filePath) => ipcRenderer.invoke('video:show-in-folder', filePath),
  onProgress: (callback) => {
    ipcRenderer.on('video:progress', (_event, data) => callback(data));
  }
});

// 设置 & 自定义模型（OpenAI 兼容）API
contextBridge.exposeInMainWorld('settingsTools', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (customModel) => ipcRenderer.invoke('settings:save', { customModel }),
  test: (customModel) => ipcRenderer.invoke('settings:test', { customModel })
});

// 千问语音：音色管理 + 文字生音频（Qwen-TTS 非实时 HTTP 方案）
contextBridge.exposeInMainWorld('voiceTools', {
  getConfig: () => ipcRenderer.invoke('voice:get-config'),
  getSaveDir: (payload) => ipcRenderer.invoke('voice:get-save-dir', payload),
  saveConfig: (voiceTTS) => ipcRenderer.invoke('voice:save-config', { voiceTTS }),
  pickAudio: () => ipcRenderer.invoke('voice:pick-audio'),
  pickDir: () => ipcRenderer.invoke('voice:pick-dir'),
  listGenerated: () => ipcRenderer.invoke('voice:list-generated'),
  create: (audioPath, preferredName, targetModel) => ipcRenderer.invoke('voice:create', { audioPath, preferredName, targetModel }),
  list: () => ipcRenderer.invoke('voice:list'),
  listSystemVoices: () => ipcRenderer.invoke('voice:list-system-voices'),
  listAll: () => ipcRenderer.invoke('voice:list-all'),
  listModels: () => ipcRenderer.invoke('voice:list-models'),
  getProfiles: () => ipcRenderer.invoke('voice:get-profiles'),
  saveProfile: (profile) => ipcRenderer.invoke('voice:save-profile', { profile }),
  deleteProfile: (key) => ipcRenderer.invoke('voice:delete-profile', { key }),
  synth: (text, voice, projectName, saveDir, targetModel, audioName, defaultOut) => ipcRenderer.invoke('voice:synth', { text, voice, projectName, saveDir, targetModel, audioName, defaultOut }),
  // 字幕配音（逐句对齐）：逐句合成 + 对齐/重排；进度经 voice:align-progress 回推
  synthAligned: (payload) => ipcRenderer.invoke('voice:synth-aligned', payload),
  cancelAlign: () => ipcRenderer.send('voice:align-cancel'),
  // 单订阅：重复注册仅替换回调，避免页面切换叠加监听
  onAlignProgress: (callback) => {
    _alignProgressCb = callback;
    if (!_alignProgressBound) {
      _alignProgressBound = true;
      ipcRenderer.on('voice:align-progress', (_event, data) => { if (typeof _alignProgressCb === 'function') _alignProgressCb(data); });
    }
  }
});

// whisper.cpp 字幕转录：模型状态/下载/删除/设为当前 + 自定义模型增删改 + 项目音频 + 音频选择 + 转录（进度经 whisper:progress 回推）
contextBridge.exposeInMainWorld('whisperTools', {
  status: () => ipcRenderer.invoke('whisper:status'),
  download: (id) => ipcRenderer.invoke('whisper:download', { id }),
  delete: (id) => ipcRenderer.invoke('whisper:delete', { id }),
  setCurrent: (id) => ipcRenderer.invoke('whisper:set-current', { id }),
  addModel: (payload) => ipcRenderer.invoke('whisper:add-model', payload),
  updateModel: (payload) => ipcRenderer.invoke('whisper:update-model', payload),
  removeModel: (payload) => ipcRenderer.invoke('whisper:remove-model', payload),
  openDir: (which) => ipcRenderer.invoke('whisper:open-dir', { which }),
  pickAudio: () => ipcRenderer.invoke('whisper:pick-audio'),
  projectAudio: (name) => ipcRenderer.invoke('whisper:project-audio', { name }),
  transcribe: (payload) => ipcRenderer.invoke('whisper:transcribe', payload),
  // 单订阅：重复注册仅替换回调，避免页面切换叠加监听
  onProgress: (callback) => {
    _whisperProgressCb = callback;
    if (!_whisperProgressBound) {
      _whisperProgressBound = true;
      ipcRenderer.on('whisper:progress', (_event, data) => { if (typeof _whisperProgressCb === 'function') _whisperProgressCb(data); });
    }
  }
});

// 项目化流水线（字幕 → HTML → 预览/转视频）
contextBridge.exposeInMainWorld('projectTools', {
  list: () => ipcRenderer.invoke('project:list'),
  create: (name) => ipcRenderer.invoke('project:create', name),
  load: (name) => ipcRenderer.invoke('project:load', name),
  saveSubtitle: (name, subtitle, title) => ipcRenderer.invoke('project:save-subtitle', { name, subtitle, title }),
  saveContent: (name, content) => ipcRenderer.invoke('project:save-content', { name, content }),
  generateHtml: (name, prompt, materials) => ipcRenderer.invoke('project:generate-html', { name, prompt, ...(materials || {}) }),
  modifyHtml: (name, prompt, materials) => ipcRenderer.invoke('project:modify-html', { name, prompt, ...(materials || {}) }),
  downloadHtml: (name) => ipcRenderer.invoke('project:download-html', name),
  downloadFile: (srcPath, defaultName) => ipcRenderer.invoke('project:download-file', { srcPath, defaultName }),
  exportSrt: (name, srt) => ipcRenderer.invoke('project:export-srt', { name, srt }),
  readHtml: (name) => ipcRenderer.invoke('project:read-html', name),
  saveHtml: (name, html) => ipcRenderer.invoke('project:save-html', { name, html }),
  previewHtml: (name) => ipcRenderer.invoke('project:preview-html', name),
  pickAudio: () => ipcRenderer.invoke('project:pick-audio'),
  setAudio: (name, audioPath) => ipcRenderer.invoke('project:set-audio', { name, audioPath }),
  clearAudio: (name) => ipcRenderer.invoke('project:clear-audio', { name }),
  pickVideo: () => ipcRenderer.invoke('project:pick-video'),
  setVideo: (name, videoPath) => ipcRenderer.invoke('project:set-video', { name, videoPath }),
  clearVideo: (name) => ipcRenderer.invoke('project:clear-video', { name }),
  extractVideoAudio: (name) => ipcRenderer.invoke('project:extract-video-audio', name),
  openFolder: (name) => ipcRenderer.invoke('project:open-folder', name),
  openFolderOf: (dirOrFile) => ipcRenderer.invoke('project:open-folder-of', dirOrFile),
  delete: (name) => ipcRenderer.invoke('project:delete', name),
  saveVideo: (name, videoPath) => ipcRenderer.invoke('project:save-video', { name, videoPath }),
  // HTML 生成/修改过程进度（单订阅：重复注册仅替换回调，避免页面切换叠加监听）
  onHtmlProgress: (callback) => {
    _htmlProgressCb = callback;
    if (!_htmlProgressBound) {
      _htmlProgressBound = true;
      ipcRenderer.on('project:html-progress', (_event, data) => { if (typeof _htmlProgressCb === 'function') _htmlProgressCb(data); });
    }
  }
});
let _htmlProgressCb = null;
let _htmlProgressBound = false;
let _whisperProgressCb = null;
let _whisperProgressBound = false;
let _alignProgressCb = null;
let _alignProgressBound = false;
