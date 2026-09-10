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

// 自绘标题栏：窗口控制 API
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximized-change', (_event, isMaximized) => callback(isMaximized));
  }
});

// HTML 预览 & HyperFrames 转视频 API
contextBridge.exposeInMainWorld('hfTools', {
  openHtml: () => ipcRenderer.invoke('dialog:open-html'),
  listProjects: () => ipcRenderer.invoke('video:list-projects'),
  renderVideo: (htmlPath) => ipcRenderer.invoke('video:render', { htmlPath }),
  showInFolder: (filePath) => ipcRenderer.invoke('video:show-in-folder', filePath),
  onProgress: (callback) => {
    ipcRenderer.on('video:progress', (_event, data) => callback(data));
  }
});

// 项目化流水线（字幕 → HTML → 预览/转视频）
contextBridge.exposeInMainWorld('projectTools', {
  list: () => ipcRenderer.invoke('project:list'),
  load: (name) => ipcRenderer.invoke('project:load', name),
  saveSubtitle: (name, subtitle, title) => ipcRenderer.invoke('project:save-subtitle', { name, subtitle, title }),
  generateHtml: (name, prompt) => ipcRenderer.invoke('project:generate-html', { name, prompt }),
  modifyHtml: (name, prompt) => ipcRenderer.invoke('project:modify-html', { name, prompt }),
  downloadHtml: (name) => ipcRenderer.invoke('project:download-html', name),
  readHtml: (name) => ipcRenderer.invoke('project:read-html', name),
  saveHtml: (name, html) => ipcRenderer.invoke('project:save-html', { name, html }),
  pickAudio: () => ipcRenderer.invoke('project:pick-audio'),
  setAudio: (name, audioPath) => ipcRenderer.invoke('project:set-audio', { name, audioPath }),
  clearAudio: (name) => ipcRenderer.invoke('project:clear-audio', { name }),
  openFolder: (name) => ipcRenderer.invoke('project:open-folder', name),
  delete: (name) => ipcRenderer.invoke('project:delete', name),
  saveVideo: (name, videoPath) => ipcRenderer.invoke('project:save-video', { name, videoPath })
});
