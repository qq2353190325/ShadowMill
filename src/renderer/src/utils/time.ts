// utils/time.ts —— 时间格式化（合并原 subtitle/index.js 与 textTts/align.js 的重复实现）
// fmtTime：秒 → [分:秒]（四舍五入到秒）
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// fmtTimeMs：秒 → [分:秒.毫秒]（3 位毫秒，四舍五入；毫秒进位到秒）
export function fmtTimeMs(sec: number): string {
  const t = Math.max(0, Number(sec) || 0);
  const s = Math.floor(t);
  let ms = Math.round((t - s) * 1000);
  if (ms >= 1000) return fmtTimeMs(s + 1);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}
