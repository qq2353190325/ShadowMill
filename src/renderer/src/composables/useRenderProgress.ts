// composables/useRenderProgress.ts —— 全局 HyperFrames 渲染进度解析（原 entry.js 的 HF 进度监听）
// 原则：只上屏「用户看得懂」的内容，宁愿不刷新也不显示内部术语/英文。三道闸门：
//   ① 阶段名只认 HF_PHASE_LABELS 登记的长阶段；CLI 的 pipeline / file_server / worker_resolution /
//      capture_strategy / hdr_detection 等内部微阶段（以及将来新增的未登记阶段）一律不上屏；
//   ② 只有 status=error 才原样展示事件消息（截断），其余消息一律丢——**但消息被丢掉不等于事件被丢掉**：
//      CLI 的心跳 checkpoint（message = "stage still running"）带着实时的 elapsedMs 与 framesCompleted，
//      它是长阶段里唯一会持续到达的 trace，必须照常解析（见下）；
//   ③ 普通日志行（[initSession:screenshot] …、[Browser:…]、捕获进度条等）不参与更新，文案保持上一条；
//      首次渲染的空白期由页面自己的占位文案兜着（「已提交渲染（…，约 30 秒）...」）。
//
// 实时性由三路拼出来（这是「看起来卡死」的修复）：
//   · trace 事件：捕获阶段每 ~15–30 秒一条心跳（带 elapsedMs / framesCompleted），其余阶段在边界上各一条；
//   · 本地秒表：每秒重算一次「已用 Ns」，与 trace 是否到达无关（否则两个数会长达半分钟不动，
//     用户看到的是「卡很久然后突然跳到 70s」——实测捕获阶段 203 秒里只有 3 条 trace）；
//   · stdout 进度条（每 30 帧一行「Capturing frames N/M」）：作为帧数兜底，trace 不带帧号时也能走。
//
// 最终文案形如「渲染中 · 逐帧捕获（已用 45s · 帧 1360/6764）：快速捕获未通过校验…」；
// 展示方：pages/HtmlGenPage/index.vue（发起渲染，唯一的渲染入口）+ pages/VideoPreviewPage/index.vue。
import { reactive } from 'vue'

// 对用户有意义的长阶段；capture_* 三种共用「逐帧捕获」（底层捕获策略与用户无关）
const HF_PHASE_LABELS: Record<string, string> = {
  compile: '编译组合',
  browser_launch: '启动渲染浏览器',
  browser_probe: '浏览器校准',
  session_init: '初始化渲染会话',
  video_extract: '提取视频素材',
  audio_process: '处理音轨',
  capture_calibration: '帧捕获校准',
  capture_hdr_layered: '逐帧捕获',
  capture_streaming: '逐帧捕获',
  capture_disk: '逐帧捕获',
  encode: '视频编码',
  assemble: '合成输出'
};

// 真·逐帧捕获：只有这三个的 trace 里 framesCompleted 才有意义
// （capture_calibration 只出探针帧，framesCompleted 恒为 0，报帧数会误导）
const HF_CAPTURE_PHASES = ['capture_hdr_layered', 'capture_streaming', 'capture_disk'];

// 值得告诉用户的 trace 消息（其余英文/内部术语一律不显示）
const HF_MESSAGE_LABELS: Record<string, string> = {
  'drawElement self-verify failed; retrying with forceScreenshot': '快速捕获未通过校验，改用逐帧截图（会慢一些）',
  'spawn failed; falling back to disk': '并行捕获启动失败，改用磁盘模式'
};

export const renderProgress = reactive({ text: '' });

// ===== 进度状态（模块级：页面切换后仍在，直到下一次 reset）=====
let startAtMs = 0;              // 本次渲染的挂钟起点（由 trace 的 elapsedMs 反推，见 parseTrace）
let phaseLabel = '';            // 当前阶段文案（中文）
let phaseKey = '';              // 当前阶段 key（判断帧号是否可信）
let frames: { done: number; total: number } | null = null;
let msgText = '';               // 当前要附在文案后的消息（白名单里的提示 / 失败原因），ticker 每跳一次都要带上
let ticker: ReturnType<typeof setInterval> | null = null;

function stopTicker(): void {
  if (ticker) { clearInterval(ticker); ticker = null }
}

// 每秒重算「已用 Ns」：trace 之间也持续走字，不用等 CLI 再发一条事件
function startTicker(): void {
  if (ticker || !startAtMs) return;
  ticker = setInterval(() => { renderText() }, 1000);
}

function renderText(): void {
  if (!phaseLabel) { renderProgress.text = ''; return }
  const meta: string[] = [];
  if (startAtMs) meta.push('已用 ' + Math.max(0, Math.round((Date.now() - startAtMs) / 1000)) + 's');
  // 帧号只在真·逐帧捕获阶段可信（校准阶段的 framesCompleted 恒为 0，报出来会误导）
  if (frames && HF_CAPTURE_PHASES.indexOf(phaseKey) >= 0) meta.push('帧 ' + frames.done + '/' + frames.total);
  renderProgress.text = '渲染中 · ' + phaseLabel + (meta.length ? '（' + meta.join(' · ') + '）' : '')
    + (msgText ? '：' + msgText : '');
}

// 页面挂载时复位（对应原 initHfPage 清空 #hf-status / 丢弃未挂载期缓冲的语义）
export function resetRenderProgress(): void {
  renderProgress.text = '';
  hfLogBuf = '';
  startAtMs = 0;
  phaseLabel = '';
  phaseKey = '';
  frames = null;
  msgText = '';
  stopTicker();
}

let hfLogBuf = '';   // 跨 chunk 的半行缓冲（日志行可能被分块截断）

// 剥掉 ANSI 控制码：CLI 的进度条自带颜色/光标码，不剥会把「Capturing frames N/M」的匹配打断
// （实测管道模式下每行行尾还有一段 reset 码）
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function parseTrace(line: string): void {
  const i = line.indexOf('[Render:trace]');
  if (i < 0) return;
  let ev: Record<string, unknown>;
  try {
    // lastIndexOf 取最后一段，容忍同一行里重复出现该前缀
    ev = JSON.parse(line.slice(line.lastIndexOf('[Render:trace]') + 14).trim());
  } catch (e) {
    return;   // 半截 JSON：保持上一条，绝不把原始日志丢给用户
  }

  const key = String(ev.phase || '');
  const label = HF_PHASE_LABELS[key];
  if (!label) return;   // 未登记阶段（CLI 内部微阶段）：不上屏；新增阶段请补 HF_PHASE_LABELS
  phaseKey = key;
  phaseLabel = label;

  // 起点只在「已用」还是 0 时定一次：CLI 的 elapsedMs 从它自己的渲染开始计时，
  // 用它反推挂钟起点后，本地秒表就能给出与 CLI 口径一致的「已用 Ns」。
  const elapsedMs = Number(ev.elapsedMs);
  if (isFinite(elapsedMs) && elapsedMs > 0 && !startAtMs) {
    startAtMs = Date.now() - elapsedMs;
    startTicker();
  }

  // 帧号：心跳 checkpoint（每个长阶段每 15~30 秒一条）也带 framesCompleted，照收。
  // 换到非捕获阶段（编码 / 合成）必须清掉——否则界面会挂着「帧 6764/6764」这种与当前阶段无关的数。
  const inCapture = HF_CAPTURE_PHASES.indexOf(key) >= 0;
  const total = Number(ev.totalFrames);
  const done = Number(ev.framesCompleted);
  if (inCapture && isFinite(total) && total > 0 && isFinite(done) && done >= 0) frames = { done, total };
  else if (!inCapture) frames = null;

  // 消息只认白名单；失败原因例外，原样展示（截断）方便定位。
  // 存进 msgText 而不是只拼一次字符串：秒表每秒重画文案，一次性拼接会被下一次 tick 抹掉。
  const rawMsg = String(ev.message || '').trim();
  msgText = (ev.status === 'error' && rawMsg)
    ? rawMsg.slice(0, 120)
    : (HF_MESSAGE_LABELS[rawMsg] || '');
  renderText();
}

export function initRenderProgress(): void {
  window.hfTools.onProgress((data) => {
    hfLogBuf += String((data && data.text) || '');
    let nl;
    while ((nl = hfLogBuf.indexOf('\n')) >= 0) {
      const line = stripAnsi(hfLogBuf.slice(0, nl)).trim();
      hfLogBuf = hfLogBuf.slice(nl + 1);
      if (!line) continue;
      if (line.indexOf('[Render:trace]') >= 0) { parseTrace(line); continue }
      // stdout 兜底：捕获进度条每 30 帧一行「Capturing frames N/M (6 workers)」，
      // trace 不带帧号时（例如某版本只报心跳不报帧）也能让帧数走起来。
      // 只更帧号，不碰阶段名；**阶段名还没到就什么都不做**——否则 renderText() 会把文案清空，
      // 把页面自己的占位文案（「已提交渲染（…，约 30 秒）...」）也一起擦掉。
      const m = line.match(/(\d+)\s*\/\s*(\d+)\s*\(\s*\d+\s*worker/i);
      if (m && phaseLabel) {
        frames = { done: Number(m[1]), total: Number(m[2]) };
        renderText();
      }
    }
  });
}
