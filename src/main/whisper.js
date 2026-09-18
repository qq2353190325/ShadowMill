// src/main/whisper.js
// whisper.cpp 字幕转录：本地模型管理（检查/列表/下载/删除/当前模型）+ 转录（child_process 调 whisper-cli.exe）
// 模型文件单独下载（不打包进应用），存放于 userData/whisper/models/；
// whisper-cli.exe 由打包 extraResources 携带，位于 resources/whisper/whisper-cli.exe。
// 提供：WHISPER_MODELS（内置枚举）/ 自定义模型 / resolveCliPath + 全部 whisper:* IPC
// 依赖：app / ipcMain / dialog / shell / https / child_process / settings(getWhisperModel/saveWhisperModel/getWhisperCustomModels/saveWhisperCustomModels) / projects(ensureProject/projectDir)
const { app, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const projects = require('./projects.js');
const settings = require('./settings.js');

// ===== whisper.cpp 模型档位枚举（ggml 格式）=====
// 枚举规则：id ↔ 文件名严格一一对应登记，只认各自登记的文件名，不做前缀/模糊归属推断，
// 因此 base 与 base-q5_1 是两个相互独立的档位；枚举外的文件名一律视为「未知模型」（可由用户添加为自定义模型）。
// 体积为近似值（十进制 MB），精确值以下载源 Content-Length 为准。
const WHISPER_MODELS = [
  { id: 'tiny-q8_0',  file: 'ggml-tiny-q8_0.bin',  label: 'tiny-q8_0',  sizeMB: 43.5, speed: '最快', desc: '极小体积量化模型（q8_0），速度最快，适合快速出稿、长音频粗剪与低配机器' },
  { id: 'base',       file: 'ggml-base.bin',       label: 'base',       sizeMB: 148,  speed: '快',   desc: '多语言基础模型（未量化），识别质量优于 tiny 档，适合日常转录' },
  { id: 'base-q5_1',  file: 'ggml-base-q5_1.bin',  label: 'base-q5_1',  sizeMB: 59.7, speed: '快',   desc: 'base 的 q5_1 量化版，体积约为 base 的四成，质量接近，适合常规字幕生成' },
  { id: 'small-q8_0', file: 'ggml-small-q8_0.bin', label: 'small-q8_0', sizeMB: 264,  speed: '较慢', desc: 'small 的 q8_0 量化版，中文识别准确率明显提升，长音频推荐' }
];
// 下载源：优先国内可达镜像（hf-mirror.com，HuggingFace 官方仓库的国内镜像），规避 GitHub 直链超时
const MODEL_BASE_URL = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/';
// 未知模型统一提示前缀（id 不在枚举内：内置与自定义都没有该 id）
const UNKNOWN_MODEL_MSG = '未知模型：';
// 转录允许的语言（-l 参数；auto 由 whisper 自动检测）
const WHISPER_LANGS = [
  { id: 'auto', label: '自动检测' },
  { id: 'zh',   label: '中文' },
  { id: 'en',   label: 'English' }
];

function modelsDir() {
  return path.join(app.getPath('userData'), 'whisper', 'models');
}

// 定位 whisper-cli.exe：打包后位于 process.resourcesPath/whisper/；开发运行位于 项目根/resources/whisper/
function resolveCliPath() {
  const candidates = [
    path.join(process.resourcesPath, 'whisper', 'whisper-cli.exe'),
    path.join(app.getAppPath(), 'resources', 'whisper', 'whisper-cli.exe')
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (e) { /* not found */ }
  }
  return candidates[0];
}

// 扫描模型目录下可用的模型文件（排除未完成下载的 .part 与空文件）
function listModelBins() {
  let names = [];
  try {
    names = fs.readdirSync(modelsDir());
  } catch (e) {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!/^ggml-.*\.bin$/i.test(n)) continue;
    if (/\.part$/i.test(n)) continue;
    const p = path.join(modelsDir(), n);
    let bytes = 0;
    try {
      bytes = fs.statSync(p).size;
    } catch (e) { /* ignore */ }
    if (bytes > 0) out.push({ name: n, path: p, bytes });
  }
  return out;
}

// ===== 模型枚举查询（内置枚举 + 用户自定义）=====
// 自定义模型持久化在 settings.json 的 whisper.customModels，条目形如 { id, name, file, url, sizeMB, desc }
function customModels() {
  return settings.getWhisperCustomModels();
}

// 自定义条目 → 统一模型结构（name 为展示名，允许用户起名）
function customToMeta(c) {
  return {
    id: c.id,
    file: c.file,
    label: c.name || c.id,
    sizeMB: Number(c.sizeMB) || 0,
    speed: '',
    desc: c.desc || '用户自定义模型',
    custom: true,
    url: c.url || (MODEL_BASE_URL + c.file)
  };
}

// 全部可用模型（内置枚举 + 自定义），内置在前
function allModels() {
  const builtin = WHISPER_MODELS.map((m) => Object.assign({}, m, { url: MODEL_BASE_URL + m.file, custom: false }));
  return builtin.concat(customModels().map(customToMeta));
}

// 按 id 查模型；null 表示「未知模型」（不在枚举内）
function findModel(id) {
  if (!id) return null;
  const key = String(id);
  return allModels().find((m) => m.id === key) || null;
}

// 自定义模型文件名校验：只接受 ggml-*.bin 形式的纯文件名
function validateModelFile(file) {
  if (!file) return '请填写模型文件名（如 ggml-large-v3.bin）';
  if (/[\\/]/.test(file) || file.indexOf('..') >= 0) return '文件名只能是纯文件名，不能包含路径';
  if (!/^ggml-[\w.\-]+\.bin$/i.test(file)) return '文件名需形如 ggml-xxx.bin';
  return '';
}

// 由文件名派生模型 id：ggml-base-q5_1.bin → base-q5_1
function modelIdFromFile(file) {
  return String(file).replace(/^ggml-/i, '').replace(/\.bin$/i, '');
}

// 文件名是否已被枚举（内置或自定义）占用
function fileInEnum(file) {
  const key = String(file).toLowerCase();
  return allModels().some((m) => String(m.file).toLowerCase() === key);
}

// 精确解析某模型的本地文件：只认该模型登记的文件名，文件不存在或为空返回 null
function resolveModelFile(id) {
  const meta = findModel(id);
  if (!meta || !meta.file) return null;
  const p = path.join(modelsDir(), meta.file);
  let st = null;
  try {
    st = fs.statSync(p);
  } catch (e) {
    return null;
  }
  if (!st.isFile() || st.size <= 0) return null;
  return { name: meta.file, path: p, bytes: st.size };
}

// 扫描模型目录中「不在枚举内」的模型文件（提示用户可用「添加自定义模型」纳入管理）
function unknownModelFiles() {
  const known = new Set(allModels().map((m) => String(m.file).toLowerCase()));
  return listModelBins().filter((f) => !known.has(f.name.toLowerCase())).map((f) => f.name);
}

// 模型文件绝对路径
function modelFilePath(id) {
  const f = resolveModelFile(id);
  return f ? f.path : '';
}

// 兼容重定向的流式下载：http(s) 3xx 跟随（最多 5 跳），边下边写 .part，onProgress 节流回推
function httpGetFollow(url, redirects) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'MarvisStudio/1.0' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('下载重定向次数过多'));
        return resolve(httpGetFollow(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error('下载响应 HTTP ' + code));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function downloadFile(url, destPath, onProgress) {
  const res = await httpGetFollow(url, 5);
  const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
  let received = 0;
  let lastEmitAt = 0;
  const out = fs.createWriteStream(destPath);
  return new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      received += chunk.length;
      out.write(chunk);
      if (onProgress) {
        const now = Date.now();
        if (now - lastEmitAt > 200 || (total && received >= total)) {
          lastEmitAt = now;
          onProgress({
            percent: total ? Math.min(100, Math.round((received * 100) / total)) : 0,
            receivedBytes: received,
            totalBytes: total
          });
        }
      }
    });
    res.on('end', () => out.end());
    res.on('error', (err) => { out.destroy(); reject(err); });
    out.on('finish', () => resolve(received));
    out.on('error', (err) => reject(err));
  });
}

// 调 whisper-cli：-m 模型 -f 音频 -oj 输出 JSON -of 前缀 -l 语言；--no-prints 抑制控制台
function runCli(cliPath, modelPath, audioPath, outPrefix, language, emit, id) {
  return new Promise((resolve, reject) => {
    const args = ['-m', modelPath, '-f', audioPath, '-oj', '-of', outPrefix, '--no-prints'];
    if (language && language !== 'auto') args.push('-l', language);
    const child = spawn(cliPath, args, { windowsHide: true });
    let stderr = '';
    let logEmitted = false;
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (!logEmitted) {
        logEmitted = true;
        emit({ id, stage: 'transcribing', message: 'whisper-cli 正在加载模型并转录…' });
      }
    });
    child.on('error', (err) => reject(new Error('无法启动 whisper-cli：' + err.message)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
        reject(new Error('whisper-cli 退出码 ' + code + (tail ? '：' + tail : '')));
      }
    });
  });
}

// 解析 whisper -oj 输出的 JSON：兼容 transcription.segments 与顶层 segments
function parseWhisperJson(jsonPath) {
  if (!jsonPath || !fs.existsSync(jsonPath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
  const tr = (raw && raw.transcription) || raw || {};
  const segs = (tr && tr.segments) || [];
  const out = segs
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
    .filter((s) => s.text);
  return out.length ? out : null;
}

// 秒 → [分:秒]（项目字幕格式，parseSubtitle 兼容）
function fmtTs(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function register(ctx) {
  const getWindow = (ctx && ctx.getWindow) || (() => null);
  const emit = (payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('whisper:progress', payload);
  };
  let downloading = false;
  let transcribing = false;

  // 模型与 cli 状态：列表 + 本地是否已下载 + 当前使用的模型 + 模型目录已用空间
  ipcMain.handle('whisper:status', () => {
    const cliPath = resolveCliPath();
    const dir = modelsDir();
    // 确保模型目录存在（便于「打开模型目录」入口与首次下载直接落盘）
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    const currentModelId = settings.getWhisperModel();
    const models = allModels().map((m) => {
      // 严格按枚举登记的文件名识别本地文件（不做前缀/模糊归属：base 与 base-q5_1 相互独立）
      const f = resolveModelFile(m.id);
      const downloaded = !!(f && f.bytes > 0);
      const localBytes = downloaded ? f.bytes : 0;
      return {
        id: m.id, label: m.label, sizeMB: m.sizeMB, speed: m.speed, desc: m.desc, file: m.file,
        custom: !!m.custom,
        localFile: f ? f.name : '',
        url: m.url || (MODEL_BASE_URL + m.file), downloaded, localBytes, isCurrent: currentModelId === m.id
      };
    });
    const usedBytes = models.reduce((sum, m) => sum + (m.localBytes || 0), 0);
    return {
      ok: true,
      cli: { exists: fs.existsSync(cliPath), path: cliPath },
      modelsDir: dir,
      langs: WHISPER_LANGS,
      models,
      unknownFiles: unknownModelFiles(),
      usedBytes,
      currentModelId
    };
  });

  // 下载模型（带进度回推 whisper:progress）；一次仅允许一个下载任务
  ipcMain.handle('whisper:download', async (event, payload) => {
    const id = payload && payload.id;
    const meta = findModel(id);
    if (!meta) return { ok: false, message: UNKNOWN_MODEL_MSG + (id || '(空)') };
    if (downloading) return { ok: false, message: '已有模型下载任务进行中，请稍候' };
    const dir = modelsDir();
    fs.mkdirSync(dir, { recursive: true });
    const finalPath = path.join(dir, meta.file);
    const partPath = finalPath + '.part';
    const existing = resolveModelFile(id);
    if (existing) {
      return { ok: true, id, sizeBytes: existing.bytes, message: '本地已有模型文件 ' + existing.name + '，无需重复下载' };
    }
    downloading = true;
    try {
      const url = meta.url || (MODEL_BASE_URL + meta.file);
      emit({ id, stage: 'downloading', percent: 0, receivedBytes: 0, totalBytes: 0, message: '开始下载 ' + meta.label + '…' });
      const received = await downloadFile(url, partPath, (info) => {
        emit(Object.assign({ id, stage: 'downloading', message: '下载中 ' + info.percent + '%' }, info));
      });
      const sizeBytes = fs.statSync(partPath).size;
      fs.renameSync(partPath, finalPath);
      emit({ id, stage: 'done', percent: 100, receivedBytes: sizeBytes, totalBytes: received, message: meta.label + ' 下载完成' });
      return { ok: true, id, sizeBytes };
    } catch (err) {
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (e) { /* ignore */ }
      const msg = String((err && err.message) || err);
      emit({ id, stage: 'error', message: '下载失败：' + msg });
      return { ok: false, message: '下载失败：' + msg };
    } finally {
      downloading = false;
    }
  });

  // 删除已下载模型文件（可重新下载）
  ipcMain.handle('whisper:delete', (event, payload) => {
    const id = payload && payload.id;
    const meta = findModel(id);
    if (!meta) return { ok: false, message: UNKNOWN_MODEL_MSG + (id || '(空)') };
    if (transcribing) return { ok: false, message: '转录进行中，暂不能删除模型' };
    const f = resolveModelFile(id);
    try {
      if (f) fs.unlinkSync(f.path);
      return { ok: true, id, removed: f ? f.name : '' };
    } catch (err) {
      return { ok: false, message: '删除失败：' + ((err && err.message) || err) };
    }
  });

  // 设为「当前使用的识别模型」（已下载才允许，持久化到 userData/settings.json 的 whisper.modelId）
  ipcMain.handle('whisper:set-current', (event, payload) => {
    const id = payload && payload.id;
    const meta = findModel(id);
    if (!meta) return { ok: false, message: UNKNOWN_MODEL_MSG + (id || '(空)') };
    if (transcribing) return { ok: false, message: '转录进行中，暂不能切换识别模型' };
    const f = resolveModelFile(id);
    if (!f) return { ok: false, message: '模型未下载：' + meta.label + '，请先下载，或将 ggml 模型文件放入 ' + modelsDir() };
    settings.saveWhisperModel(id);
    return { ok: true, id };
  });

  // ===== 自定义模型（用户起名 + 自定义下载源；条目写 settings.json，模型文件仍存 modelsDir）=====
  // 添加自定义模型
  ipcMain.handle('whisper:add-model', (event, payload) => {
    const p = payload || {};
    const name = String(p.name || '').trim();
    const file = String(p.file || '').trim();
    const url = String(p.url || '').trim();
    const desc = String(p.desc || '').trim();
    const sizeMB = Number(p.sizeMB) || 0;
    if (!name) return { ok: false, message: '请填写模型名称' };
    const invalid = validateModelFile(file);
    if (invalid) return { ok: false, message: invalid };
    const id = modelIdFromFile(file);
    if (!id) return { ok: false, message: '无法从文件名解析出模型 id，请检查文件名' };
    if (findModel(id)) return { ok: false, message: '模型已存在：' + id + '（同一模型只能登记一次）' };
    if (fileInEnum(file)) return { ok: false, message: '该文件名已被其他模型占用：' + file };
    settings.saveWhisperCustomModels(customModels().concat([{ id, name, file, url, sizeMB, desc }]));
    return { ok: true, id, message: '已添加自定义模型「' + name + '」（文件名 ' + file + '）' };
  });

  // 编辑自定义模型：可改名称 / 下载地址 / 体积 / 说明；文件名与 id 固定不变
  ipcMain.handle('whisper:update-model', (event, payload) => {
    const p = payload || {};
    const id = String(p.id || '');
    const meta = findModel(id);
    if (!meta) return { ok: false, message: UNKNOWN_MODEL_MSG + (id || '(空)') };
    if (!meta.custom) return { ok: false, message: '内置模型不可编辑（如需改名可添加自定义模型）' };
    const list = customModels().map((c) => {
      if (c.id !== id) return c;
      return {
        id: c.id,
        file: c.file,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : c.name,
        url: typeof p.url === 'string' ? p.url.trim() : c.url,
        sizeMB: p.sizeMB === undefined || p.sizeMB === '' ? c.sizeMB : (Number(p.sizeMB) || 0),
        desc: typeof p.desc === 'string' ? p.desc.trim() : c.desc
      };
    });
    settings.saveWhisperCustomModels(list);
    const next = findModel(id);
    return { ok: true, id, message: '已更新模型「' + (next ? next.label : id) + '」' };
  });

  // 移除自定义模型条目（仅从枚举中移除，不删除本地已下载的模型文件）
  ipcMain.handle('whisper:remove-model', (event, payload) => {
    const id = String((payload && payload.id) || '');
    const meta = findModel(id);
    if (!meta) return { ok: false, message: UNKNOWN_MODEL_MSG + (id || '(空)') };
    if (!meta.custom) return { ok: false, message: '内置模型不可移除' };
    if (transcribing) return { ok: false, message: '转录进行中，暂不能移除模型' };
    settings.saveWhisperCustomModels(customModels().filter((c) => c.id !== id));
    // 当前使用被移除时清空档位，避免转录时指向未知模型
    if (settings.getWhisperModel() === id) settings.saveWhisperModel('');
    return { ok: true, id, message: '已移除自定义模型「' + meta.label + '」（本地模型文件仍保留，可在卡片上点「删除文件」清理）' };
  });

  // 打开模型目录 / whisper-cli 所在目录（资源管理器定位，便于用户手动放置 cli 或查看已下载模型）
  ipcMain.handle('whisper:open-dir', async (event, payload) => {
    const which = (payload && payload.which) || 'models';
    let target = modelsDir();
    if (which === 'cli') {
      const cliPath = resolveCliPath();
      target = path.dirname(cliPath);
      try { fs.mkdirSync(target, { recursive: true }); } catch (e) { /* ignore */ }
    } else {
      try { fs.mkdirSync(target, { recursive: true }); } catch (e) { /* ignore */ }
    }
    // shell.openPath 返回 Promise<string>：成功为空串，失败为错误信息，必须 await 后再判断
    const err = await shell.openPath(target);
    if (err) return { ok: false, message: '打开目录失败：' + err + '（路径：' + target + '）' };
    return { ok: true, path: target };
  });

  // 读取当前项目内的音频（供「从音频生成字幕」弹窗的「使用项目音频」）
  ipcMain.handle('whisper:project-audio', (event, payload) => {
    const name = payload && payload.name;
    if (!name) return { ok: false, message: '未指定项目' };
    const proj = projects.ensureProject(name) || {};
    const rel = proj.audioFile || '';
    if (!rel) return { ok: false, message: '项目「' + name + '」还没有音频，请先在「配音」页生成或选择音频' };
    const abs = path.isAbsolute(rel) ? rel : path.join(projects.projectDir(name), rel);
    if (!fs.existsSync(abs)) return { ok: false, message: '项目音频文件不存在：' + abs };
    return { ok: true, path: abs, name: path.basename(abs) };
  });

  // 选择待转录音频
  ipcMain.handle('whisper:pick-audio', async () => {
    if (!getWindow()) return null;
    const r = await dialog.showOpenDialog(getWindow(), {
      title: '选择要转录的音频文件',
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'mp4'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 转录：spawn whisper-cli → 解析 JSON → 返回 [{start,end,text}] 与 [分:秒] 字幕文本
  // 不直接写项目文件：由渲染层弹窗按「替换现有 / 追加到末尾」回填条目列表后统一走 project:save-subtitle 落盘
  ipcMain.handle('whisper:transcribe', async (event, payload) => {
    const id = (payload && payload.id) || settings.getWhisperModel();
    const audioPath = payload && payload.audioPath;
    const language = (payload && payload.language) || 'auto';
    if (!id) return { ok: false, message: '请先在「设置 → 语音识别模型」中选择并下载识别模型' };
    if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在' };
    const meta = findModel(id);
    if (!meta) return { ok: false, message: UNKNOWN_MODEL_MSG + (id || '(空)') };
    const cliPath = resolveCliPath();
    if (!fs.existsSync(cliPath)) return { ok: false, message: '未找到 whisper-cli.exe，请将其放置到 resources/whisper/whisper-cli.exe（打包后自动随应用携带）' };
    const modelFile = resolveModelFile(id);
    if (!modelFile) return { ok: false, message: '模型未下载：' + meta.label + '，请先下载，或将 ggml 模型文件放入 ' + modelsDir() };
    const modelPath = modelFile.path;
    if (transcribing) return { ok: false, message: '已有转录任务进行中，请稍候' };

    transcribing = true;
    const outPrefix = path.join(app.getPath('userData'), 'whisper', 'out_' + Date.now());
    const jsonPath = outPrefix + '.json';
    try {
      emit({ id, stage: 'starting', message: '正在启动 whisper-cli（' + meta.label + '）…' });
      await runCli(cliPath, modelPath, audioPath, outPrefix, language, emit, id);
      const segs = parseWhisperJson(jsonPath);
      if (!segs || !segs.length) return { ok: false, message: '转录完成但没有识别到文本（可能音频过短或无人声）' };
      const text = segs.map((s) => s.text).filter(Boolean).join('\n');
      const subtitleText = segs.map((s) => '[' + fmtTs(s.start) + '] ' + s.text).filter(Boolean).join('\n');
      emit({ id, stage: 'done', message: '转录完成：' + segs.length + ' 条字幕' });
      return { ok: true, id, text, subtitleText, segments: segs, model: meta.label };
    } catch (err) {
      const msg = String((err && err.message) || err);
      emit({ id, stage: 'error', message: msg });
      return { ok: false, message: msg };
    } finally {
      transcribing = false;
      try { if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath); } catch (e) { /* ignore */ }
    }
  });
}

module.exports = {
  WHISPER_MODELS,
  WHISPER_LANGS,
  MODEL_BASE_URL,
  modelsDir,
  resolveCliPath,
  allModels,
  findModel,
  resolveModelFile,
  unknownModelFiles,
  register
};
