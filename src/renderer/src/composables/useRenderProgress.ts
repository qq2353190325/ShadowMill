// composables/useRenderProgress.ts —— 全局 HyperFrames 渲染进度解析（原 entry.js 的 HF 进度监听）
// HyperFrames CLI 会输出 [Render:trace] {"phase":...,"status":...,"elapsedMs":...,"message":...} 行：
// 解析为「渲染中 · 阶段中文名（耗时）：消息」；解析失败（普通日志/进度行）回退显示原文尾部。
// 解析结果写入 renderProgress.text，由视频页（Phase 6）展示；订阅在 App.vue onMounted 执行一次。
import { reactive } from 'vue'

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

export const renderProgress = reactive({ text: '' });

// 页面挂载时复位（对应原 initHfPage 清空 #hf-status / 丢弃未挂载期缓冲的语义）
export function resetRenderProgress(): void {
  renderProgress.text = '';
  hfLogBuf = '';
  hfLastLine = '';
}

let hfLogBuf = '';    // 跨 chunk 的半行缓冲（日志行可能被分块截断）
let hfLastLine = '';  // 最近一条完整日志行（trace 解析失败时兜底）

export function initRenderProgress(): void {
  window.hfTools.onProgress((data) => {
    hfLogBuf += String((data && data.text) || '');
    let nl;
    while ((nl = hfLogBuf.indexOf('\n')) >= 0) {
      const line = hfLogBuf.slice(0, nl).trim();
      hfLogBuf = hfLogBuf.slice(nl + 1);
      if (line) hfLastLine = line;
    }
    const tIdx = hfLastLine.lastIndexOf('[Render:trace]');
    if (tIdx >= 0) {
      try {
        const ev = JSON.parse(hfLastLine.slice(tIdx + 14).trim());
        const phase = HF_PHASE_LABELS[ev.phase] || String(ev.phase || '');
        const msg = String(ev.message || '').trim();
        const secs = isFinite(Number(ev.elapsedMs)) ? Math.round(Number(ev.elapsedMs) / 1000) : 0;
        renderProgress.text = '渲染中 · ' + phase + (secs ? '（' + secs + 's）' : '') + (msg ? '：' + msg : '');
        return;
      } catch (e) { /* 解析失败走兜底 */ }
    }
    renderProgress.text = '渲染中... ' + hfLastLine.slice(-160);
  });
}
