// src/main/projects.js
// 项目化贯通流水线：字幕 → HTML → 预览/转视频
// 每个项目 = userData\projects\<项目名>\ 下一个目录：
//   subtitle.txt  字幕文本
//   index.html    由字幕生成的 HTML composition
//   project.json  项目元数据（name/subtitle/htmlPath/videoPath/title 等）
// 提供：scanProjects / projectDir / projectFilePath / readProject / writeProject /
//       ensureProject / parseSubtitle / copyAudioIntoProject（供 voice 引用）+ 全部 project:* IPC
// 依赖：settings(经 htmlAgent) / htmlAgent(chatWithCustomModel / extractHtmlFromReply) /
//       hfEnv(isHyperframesComposition) / dialog / shell
const { app, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const htmlAgent = require('./htmlAgent.js');
const hfEnv = require('./hfEnv.js');

const projectsRoot = path.join(app.getPath('userData'), 'projects');

function projectDir(name) {
  return path.join(projectsRoot, String(name || '').replace(/[\\/:*?"<>|]/g, '_'));
}
function projectFilePath(name, file) {
  return path.join(projectDir(name), file);
}

function readProject(name) {
  const jsonPath = path.join(projectDir(name), 'project.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeProject(proj) {
  const dir = projectDir(proj.name);
  fs.mkdirSync(dir, { recursive: true });
  proj.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(proj, null, 2), 'utf8');
  return proj;
}
function ensureProject(name) {
  const existing = readProject(name);
  if (existing) {
    existing.name = name;
    return existing;
  }
  return {
    name,
    title: '字幕动画',
    subtitle: '',
    htmlPath: '',
    videoPath: '',
    audioFile: '',
    content: { style: '', scenes: [] },
    createdAt: new Date().toISOString()
  };
}

// 内容脚本数据规范化：基本类型校验 + 场景 id 自动补全（向后兼容：无/非法 content 视为空）
function normalizeContent(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const style = typeof src.style === 'string' ? src.style : '';
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const now = Date.now().toString(36);
  let seen = 0;
  const out = scenes.map((s, i) => {
    const item = (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
    let id = (typeof item.id === 'string' && item.id.trim()) ? item.id.trim() : '';
    if (!id) { seen++; id = 'scene-' + now + '-' + i + '-' + seen; }
    const dur = item.durHint;
    const durHint = (dur === undefined || dur === null || dur === '') ? '' : String(dur);
    return {
      id,
      narration: typeof item.narration === 'string' ? item.narration : '',
      visual: typeof item.visual === 'string' ? item.visual : '',
      durHint
    };
  });
  return { style, scenes: out };
}

// 扫描“我的项目”（可读写，供项目选择器使用）
function scanProjects() {
  if (!fs.existsSync(projectsRoot)) return [];
  const list = [];
  for (const d of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = readProject(d.name);
    if (!p) continue;
    list.push({
      name: p.name,
      title: p.title || '字幕动画',
      hasSubtitle: !!p.subtitle,
      hasHtml: !!(p.htmlPath && fs.existsSync(p.htmlPath)),
      hasVideo: !!(p.videoPath && fs.existsSync(p.videoPath)),
      subtitleCount: p.subtitleCount || 0,
      updatedAt: p.updatedAt || ''
    });
  }
  return list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// 解析字幕文本：支持 [分:秒] 文本 或 纯文本（自动估算时间）
function parseSubtitle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  let autoT = 0.4;
  let lineNo = 1;
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?\]\s*(.*)$/);
    let txt = line;
    let time = null;
    if (m) {
      txt = m[4].trim();
      time = (+m[1]) * 60 + (+m[2]) + ((+(m[3] || 0)) / 1000);
    }
    if (!txt) { lineNo++; continue; }
    if (time === null) {
      time = autoT;
      autoT += Math.max(2.4, 1.6 + txt.length * 0.15);
    }
    items.push({ n: lineNo, text: txt, time });
    lineNo++;
  }
  return items;
}

// 将外部音频复制进项目 audio/ 目录，返回相对引用（audio/xxx）；复制失败返回 ''
function copyAudioIntoProject(name, audioPath) {
  if (!name || !audioPath || !fs.existsSync(audioPath)) return '';
  try {
    const audioDir = path.join(projectDir(name), 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const basename = path.basename(audioPath).replace(/[\\/:*?"<>|]/g, '_');
    const extIndex = basename.lastIndexOf('.');
    const stem = extIndex > 0 ? basename.slice(0, extIndex) : basename;
    const ext = extIndex > 0 ? basename.slice(extIndex) : '';
    let saveName = basename;
    let i = 1;
    while (fs.existsSync(path.join(audioDir, saveName))) {
      saveName = stem + '_' + i + ext;
      i++;
      if (i > 1000) break;
    }
    fs.copyFileSync(audioPath, path.join(audioDir, saveName));
    return 'audio/' + saveName;
  } catch (e) {
    return '';
  }
}

// 拼接生成/修改 HTML 时的用户提示（字幕 + 背景音频素材，均可选）
function buildAgentPrompt(parts) {
  return parts.filter(Boolean).join('\n');
}

// 由项目 content 构造「内容脚本」块（方案B：脚本为 HTML 的整体内容源）。
// 含全局 style 与逐场景 { 旁白, 画面分镜, 时长提示 }，指示模型据此设计页面视觉与动画节奏。
// 无 content 或 scenes 为空（含全部无旁白）时返回 ''，老项目（无内容脚本）走原 prompt 流程。
function buildContentBlock(content) {
  const src = content || {};
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const valid = scenes.filter((s) => s && typeof s.narration === 'string' && s.narration.trim());
  if (!valid.length) return '';
  const style = typeof src.style === 'string' && src.style.trim() ? src.style.trim() : '';
  const parts = ['【内容脚本 · 本项目的整体内容源，请据此设计页面视觉风格与动画节奏】'];
  parts.push(style ? '全局视觉风格：' + style : '全局视觉风格：（未指定，可自行拟定）');
  valid.forEach((s, i) => {
    const dur = (s.durHint !== undefined && s.durHint !== null && String(s.durHint).trim() !== '')
      ? String(s.durHint).trim() + ' 秒'
      : '未指定';
    const visual = (typeof s.visual === 'string' && s.visual.trim()) ? s.visual.trim() : '（未指定）';
    parts.push('场景 ' + (i + 1) + '（时长提示：' + dur + '）：');
    parts.push('- 旁白：' + s.narration.trim());
    parts.push('- 画面分镜：' + visual);
  });
  return '\n' + parts.join('\n');
}

function register(ctx) {
  const getWindow = (ctx && ctx.getWindow) || (() => null);

  ipcMain.handle('project:list', () => scanProjects());

  ipcMain.handle('project:load', (event, name) => {
    if (!name) return null;
    return readProject(name) || ensureProject(name);
  });

  // 保存字幕到当前项目
  ipcMain.handle('project:save-subtitle', (event, payload) => {
    const name = payload && payload.name;
    const subtitle = payload && typeof payload.subtitle === 'string' ? payload.subtitle : '';
    const title = payload && typeof payload.title === 'string' ? payload.title : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    const dir = projectDir(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'subtitle.txt'), subtitle, 'utf8');
    const proj = ensureProject(name);
    proj.subtitle = subtitle;
    if (title) proj.title = title;
    proj.subtitleCount = parseSubtitle(subtitle).length;
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // 整体保存内容脚本（style + scenes）到当前项目
  ipcMain.handle('project:save-content', (event, payload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const content = normalizeContent(payload && payload.content);
    const proj = ensureProject(name);
    proj.content = content;
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // ===== HTML 生成/修改：由 Agent 接口实现（应用侧不内置模板） =====
  // 接入点：handler 收到 { name, prompt } 后调用自定义模型 Agent，
  // Agent 产出/修改 HTML 并写入 projectFilePath(name,'index.html')，
  // 应用侧随后更新 proj.htmlPath、置空 proj.videoPath 并刷新链路。
  ipcMain.handle('project:generate-html', async (event, payload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

    const proj = ensureProject(name);
    // —— 素材选择（均可选，不选不强制拼接）——
    // 字幕：'' = 不使用；'__current__' = 当前项目字幕；其他 = 指定带字幕的项目名
    let subtitleText = '';
    const subSel = payload && payload.subtitleProject;
    if (subSel === '__current__') subtitleText = proj.subtitle || '';
    else if (subSel && typeof subSel === 'string') {
      const src = readProject(subSel);
      subtitleText = (src && src.subtitle) || '';
    }
    // 音频：'' = 不使用；'__current__' = 当前项目背景音频；其他 = 外部音频绝对路径（复制进本项目 audio/ 后按相对引用）
    let audioRef = '';
    const audSel = payload && payload.audioPath;
    if (audSel === '__current__') audioRef = proj.audioFile || '';
    else if (audSel && typeof audSel === 'string' && fs.existsSync(audSel)) audioRef = copyAudioIntoProject(name, audSel);
    const userPrompt = buildAgentPrompt([
      '用户需求：' + prompt.trim(),
      buildContentBlock(proj.content),
      subtitleText ? '\n【项目字幕，请据此逐条设计动画】\n' + subtitleText : '',
      audioRef ? '\n【背景音乐】项目内音频文件：' + audioRef + '，请在 HTML 中通过 <audio autoplay loop> 引用为音轨。' : ''
    ]);

    try {
      const reply = await htmlAgent.chatWithCustomModel(userPrompt);
      const html = htmlAgent.extractHtmlFromReply(reply);
      if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
      const dir = projectDir(name);
      fs.mkdirSync(dir, { recursive: true });
      const htmlPath = path.join(dir, 'index.html');
      fs.writeFileSync(htmlPath, html, 'utf8');
      proj.htmlPath = htmlPath;
      proj.videoPath = ''; // HTML 刷新后旧视频失效
      writeProject(proj);
      const compatible = hfEnv.isHyperframesComposition(html);
      return {
        ok: true,
        htmlPath,
        compatible,
        message: compatible
          ? 'HTML 已生成'
          : 'HTML 已生成，但未通过 HyperFrames 合规检查（缺 data-composition-id / __timelines / gsap），预览可用，转视频前需调整。'
      };
    } catch (e) {
      return { ok: false, message: 'Agent 调用失败：' + (e && e.message ? e.message : String(e)) };
    }
  });

  // 修改：基于现有 HTML，由 Agent 按需求改造后覆盖
  ipcMain.handle('project:modify-html', async (event, payload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim()) return { ok: false, message: '需求描述为空' };

    const htmlPath = projectFilePath(name, 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML，请先生成' };

    const proj = ensureProject(name);
    const curHtml = fs.readFileSync(htmlPath, 'utf8');
    // 素材选择（语义同生成：均可选，不选不拼接）
    let subtitleText = '';
    const subSel = payload && payload.subtitleProject;
    if (subSel === '__current__') subtitleText = proj.subtitle || '';
    else if (subSel && typeof subSel === 'string') {
      const src = readProject(subSel);
      subtitleText = (src && src.subtitle) || '';
    }
    let audioRef = '';
    const audSel = payload && payload.audioPath;
    if (audSel === '__current__') audioRef = proj.audioFile || '';
    else if (audSel && typeof audSel === 'string' && fs.existsSync(audSel)) audioRef = copyAudioIntoProject(name, audSel);
    const userPrompt = buildAgentPrompt([
      '当前项目的 index.html 源码如下：',
      '```html',
      curHtml,
      '```',
      '',
      '用户需求（在此基础上改造后输出完整新 HTML）：' + prompt.trim(),
      buildContentBlock(proj.content),
      subtitleText ? '\n【项目字幕，请据此逐条设计动画】\n' + subtitleText : '',
      audioRef ? '\n【背景音乐】项目内音频文件：' + audioRef + '，请在 HTML 中通过 <audio autoplay loop> 引用为音轨。' : ''
    ]);

    try {
      const reply = await htmlAgent.chatWithCustomModel(userPrompt);
      const html = htmlAgent.extractHtmlFromReply(reply);
      if (!html.trim()) return { ok: false, message: '模型未返回内容，请检查自定义模型配置' };
      fs.writeFileSync(htmlPath, html, 'utf8');
      proj.htmlPath = htmlPath;
      proj.videoPath = '';
      writeProject(proj);
      const compatible = hfEnv.isHyperframesComposition(html);
      return {
        ok: true,
        htmlPath,
        compatible,
        message: compatible
          ? 'HTML 已修改'
          : 'HTML 已修改，但未通过 HyperFrames 合规检查，转视频前需调整。'
      };
    } catch (e) {
      return { ok: false, message: 'Agent 调用失败：' + (e && e.message ? e.message : String(e)) };
    }
  });

  // 下载项目 HTML 到本地（导出入口）
  ipcMain.handle('project:download-html', (event, name) => {
    const htmlPath = projectFilePath(name, 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    const save = dialog.showSaveDialogSync(getWindow(), {
      title: '导出 HTML',
      defaultPath: (name || 'project') + '.html',
      filters: [{ name: 'HTML 文件', extensions: ['html'] }]
    });
    if (!save) return { ok: false, canceled: true };
    fs.copyFileSync(htmlPath, save);
    return { ok: true, savedPath: save };
  });

  // 打开项目所在目录
  ipcMain.handle('project:open-folder', (event, name) => {
    const dir = projectDir(name);
    if (fs.existsSync(dir)) shell.openPath(dir);
    return { ok: true };
  });

  // 导出任意文件（内置示例项目 HTML 的只读导出入口）
  ipcMain.handle('project:download-file', (event, payload) => {
    const src = payload && payload.srcPath;
    const defaultName = (payload && payload.defaultName) || 'export.html';
    if (!src || typeof src !== 'string' || !fs.existsSync(src)) {
      return { ok: false, message: '文件不存在' };
    }
    const save = dialog.showSaveDialogSync(getWindow(), {
      title: '导出 HTML',
      defaultPath: String(defaultName).replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'HTML 文件', extensions: ['html'] }]
    });
    if (!save) return { ok: false, canceled: true };
    fs.copyFileSync(src, save);
    return { ok: true, savedPath: save };
  });

  // 打开指定文件所在目录 / 指定目录（内置示例资源目录入口）
  ipcMain.handle('project:open-folder-of', (event, p) => {
    if (!p || typeof p !== 'string') return { ok: false, message: '参数缺失' };
    let dir = p;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) dir = path.dirname(p);
    } catch (e) { /* ignore */ }
    if (dir && fs.existsSync(dir)) {
      shell.openPath(dir);
      return { ok: true, dir };
    }
    return { ok: false, message: '目录不存在' };
  });

  // 删除“我的项目”（慎重：仅限 userData 下的项目目录）
  ipcMain.handle('project:delete', (event, name) => {
    const dir = projectDir(name);
    if (!name || !dir.startsWith(projectsRoot)) return { ok: false, message: '非法项目名' };
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { ok: true };
  });

  // 视频渲染完成后，把产物路径回写进项目（供链路状态条点亮“视频”节点）
  ipcMain.handle('project:save-video', (event, payload) => {
    const name = payload && payload.name;
    const videoPath = payload && payload.videoPath;
    if (!name || !videoPath) return { ok: false, message: '参数缺失' };
    const proj = ensureProject(name);
    proj.videoPath = String(videoPath);
    writeProject(proj);
    return { ok: true, project: proj };
  });

  // ===== 项目音频：让生成的 HTML 视频有声音 =====
  ipcMain.handle('project:pick-audio', async () => {
    if (!getWindow()) return null;
    const r = await dialog.showOpenDialog(getWindow(), {
      title: '选择音频文件（将复制进项目，随视频一起渲染）',
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 把音频复制进项目目录 audio/ 并记录相对引用
  ipcMain.handle('project:set-audio', (event, payload) => {
    const name = payload && payload.name;
    const audioPath = payload && payload.audioPath;
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在' };
    const audioFile = copyAudioIntoProject(name, audioPath);
    if (!audioFile) return { ok: false, message: '音频复制到项目失败' };
    const proj = ensureProject(name);
    proj.audioFile = audioFile;
    writeProject(proj);
    return { ok: true, audioFile: proj.audioFile };
  });

  // 移除当前项目音频引用（保留音频文件，避免误删资源）
  ipcMain.handle('project:clear-audio', (event, payload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '缺少项目名' };
    const proj = ensureProject(name);
    proj.audioFile = '';
    writeProject(proj);
    return { ok: true };
  });

  // 读取项目当前 HTML 源码（供编辑器载入）
  ipcMain.handle('project:read-html', (event, name) => {
    const htmlPath = projectFilePath(name, 'index.html');
    if (!fs.existsSync(htmlPath)) return { ok: false, message: '该项目还没有 HTML' };
    return { ok: true, html: fs.readFileSync(htmlPath, 'utf8') };
  });

  // 直接保存（覆盖）项目 HTML 源码，支持"不满意再改"
  ipcMain.handle('project:save-html', (event, payload) => {
    const name = payload && payload.name;
    const html = payload && typeof payload.html === 'string' ? payload.html : '';
    if (!name) return { ok: false, message: '缺少项目名' };
    if (!String(html).trim()) return { ok: false, message: 'HTML 内容为空' };
    const dir = projectDir(name);
    fs.mkdirSync(dir, { recursive: true });
    const htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf8');
    const proj = ensureProject(name);
    proj.htmlPath = htmlPath;
    // HTML 改动后旧视频不再匹配 → 标记失效
    proj.videoPath = '';
    writeProject(proj);
    return { ok: true, htmlPath, compatible: hfEnv.isHyperframesComposition(html) };
  });
}

module.exports = {
  register,
  scanProjects,
  projectsRoot,
  projectDir,
  projectFilePath,
  readProject,
  writeProject,
  ensureProject,
  parseSubtitle,
  normalizeContent,
  copyAudioIntoProject
};
