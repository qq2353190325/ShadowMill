// composables/useRenderProgress.ts —— 全局 HyperFrames 渲染进度解析（原 entry.js 的 HF 进度监听）
// 原则：只上屏「用户看得懂」的内容，宁愿不刷新也不显示内部术语/英文。三道闸门：
//   ① 阶段名只认 HF_PHASE_LABELS 登记的长阶段；CLI 的 pipeline / file_server / worker_resolution /
//      capture_strategy / hdr_detection 等内部微阶段（以及将来新增的未登记阶段）一律不上屏；
//   ② 事件消息只认 HF_MESSAGE_LABELS 白名单（心跳 "stage still running"、内部 "resolved" 等全部丢弃），
//      唯一例外是 status=error：失败原因原样展示（截断），方便定位问题；
//   ③ 普通日志行（[initSession:screenshot] …、[Browser:…]、进度条等）完全不参与更新，文案保持上一条；
//      首次渲染的空白期由页面自己的占位文案兜着（「已提交渲染（…，约 30 秒）...」）。
// 最终文案形如「渲染中 · 逐帧捕获（已用 45s · 帧 320/900）：快速捕获未通过校验…」；
// 展示方：pages/HtmlGenPage/index.vue（发起渲染，唯一的渲染入口）。
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

// 页面挂载时复位（对应原 initHfPage 清空 #hf-status / 丢弃未挂载期缓冲的语义）
export function resetRenderProgress(): void {
  renderProgress.text = '';
  hfLogBuf = '';
}

let hfLogBuf = '';   // 跨 chunk 的半行缓冲（日志行可能被分块截断）

export function initRenderProgress(): void {
  window.hfTools.onProgress((data) => {
    hfLogBuf += String((data && data.text) || '');
    let nl;
    let trace = '';   // 本 chunk 内最后一条 trace 行（一块可能含多行，只认最后一条）
    while ((nl = hfLogBuf.indexOf('\n')) >= 0) {
      const line = hfLogBuf.slice(0, nl).trim();
      hfLogBuf = hfLogBuf.slice(nl + 1);
      if (line && line.indexOf('[Render:trace]') >= 0) trace = line;
    }
    if (!trace) return;   // 普通日志行：不上屏（保持上一条 / 页面占位文案）

    let ev: Record<string, unknown>;
    try {
      // 14 = '[Render:trace]'.length（lastIndexOf 取最后一段，容忍同一行重复出现）
      ev = JSON.parse(trace.slice(trace.lastIndexOf('[Render:trace]') + 14).trim());
    } catch (e) {
      return;   // 半截 JSON：保持上一条，绝不把原始日志丢给用户
    }

    const key = String(ev.phase || '');
    const phase = HF_PHASE_LABELS[key];
    if (!phase) return;   // 未登记阶段（CLI 内部微阶段）：不上屏；新增阶段请补 HF_PHASE_LABELS

    const rawMsg = String(ev.message || '').trim();
    const msg = (ev.status === 'error' && rawMsg)
      ? rawMsg.slice(0, 120)                                  // 失败原因照实说，便于定位
      : (HF_MESSAGE_LABELS[rawMsg] || '');                    // 其余只认白名单

    const secs = isFinite(Number(ev.elapsedMs)) ? Math.round(Number(ev.elapsedMs) / 1000) : 0;
    const total = Number(ev.totalFrames);
    const done = Number(ev.framesCompleted);
    const withFrames = HF_CAPTURE_PHASES.indexOf(key) >= 0
      && isFinite(total) && total > 0 && isFinite(done) && done >= 0;

    const meta: string[] = [];
    if (secs) meta.push('已用 ' + secs + 's');               // 自渲染开始的总耗时
    if (withFrames) meta.push('帧 ' + done + '/' + total);

    renderProgress.text = '渲染中 · ' + phase
      + (meta.length ? '（' + meta.join(' · ') + '）' : '')
      + (msg ? '：' + msg : '');
  });
}
