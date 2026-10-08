// composables/rate.ts —— 语速控件共享逻辑（原 window.App 的 rateClamp/applyRate/stepRate）
// 仅改播放 playbackRate，不改磁盘音频；0.5~2.0，非法或空值回退 1
export function rateClamp(v: number): number {
  return Math.min(2, Math.max(0.5, v))
}
export function applyRate(el: HTMLInputElement, audio: HTMLMediaElement | null = null): number {
  let v = parseFloat(el.value)
  if (!isFinite(v)) v = 1
  v = rateClamp(v)
  el.value = String(v)
  if (audio) audio.playbackRate = v
  return v
}
export function stepRate(el: HTMLInputElement, audio: HTMLMediaElement | null, delta: number): number {
  let v = parseFloat(el.value)
  if (!isFinite(v)) v = 1
  v = rateClamp(Math.round((v + delta) * 100) / 100)
  el.value = String(v)
  if (audio) audio.playbackRate = v
  return v
}
