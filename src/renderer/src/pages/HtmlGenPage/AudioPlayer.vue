<template>
  <!-- pages/HtmlGenPage/AudioPlayer.vue —— 背景音频试听条（替换难看的原生 <audio controls>）
       一行：播放/暂停 + 可拖动进度条 + 「当前秒数 / 总秒数」；语速单独一行，不再挤在一起。
       音量不单列（系统音量已够用），播放只改内存里的 audio 元素，不动磁盘音频。 -->
  <div class="ap-wrap">
    <div class="ap-main">
      <button class="ap-play" :title="playing ? '暂停试听' : '播放试听'" @click="toggle">
        <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l11 7-11 7z" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7z M13 5h4v14h-4z" /></svg>
      </button>
      <div
        class="ap-bar"
        title="点击或拖动跳转播放位置"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <div class="ap-track"><div class="ap-fill" :style="{ width: fillPct }"></div></div>
      </div>
      <span class="ap-time">{{ fmt(cur) }} / {{ fmt(dur) }}</span>
    </div>
    <div class="ap-rate">
      <span class="sel-label" style="flex:none">语速</span>
      <button type="button" class="hf-btn" title="语速减 0.05" style="padding:0;width:26px;height:26px;line-height:1;flex:none" @click="rateStep(-0.05)">−</button>
      <input ref="rateEl" :value="rateValue" type="text" inputmode="decimal" class="hgen-input ap-rate-input" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" @input="onRateInput" />
      <button type="button" class="hf-btn" title="语速加 0.05" style="padding:0;width:26px;height:26px;line-height:1;flex:none" @click="rateStep(0.05)">+</button>
      <span class="ap-rate-unit">×</span>
    </div>
    <audio ref="audioEl" :src="src" preload="metadata" style="display:none" @loadedmetadata="onMeta" @timeupdate="onTime" @ended="onEnded" @pause="onPause" @play="onPlay" @error="onError"></audio>
  </div>
</template>

<script setup lang="ts">
// 自定义试听条：原生 audio 元素只做解码/播放，UI 全自绘（播放键、进度、时间、语速）。
// src 变化（换背景音频 / 切项目）时由 watch 复位进度与播放态。
import { computed, ref, watch } from 'vue'
import { applyRate, stepRate } from '@renderer/utils/rate'

const props = defineProps<{ src: string }>();

const audioEl = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const cur = ref(0);
const dur = ref(0);
const seeking = ref(false);
const fillPct = computed(() => (dur.value > 0 ? Math.min(100, (cur.value / dur.value) * 100).toFixed(2) + '%' : '0%'));

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

async function toggle(): Promise<void> {
  const a = audioEl.value;
  if (!a || !props.src) return;
  if (a.paused) {
    try { await a.play(); } catch (e) { /* 自动播放被拦截等：保持暂停态即可 */ }
  } else {
    a.pause();
  }
}
function onMeta(): void { dur.value = Number(audioEl.value?.duration) || 0; }
function onTime(): void {
  if (seeking.value) return;   // 拖动中本地跟手，不采信原生回报
  cur.value = Number(audioEl.value?.currentTime) || 0;
}
function onEnded(): void { playing.value = false; cur.value = 0; }
function onPause(): void { playing.value = false; }
function onPlay(): void { playing.value = true; }
function onError(): void { playing.value = false; dur.value = 0; cur.value = 0; }

function ratio(ev: PointerEvent): number {
  const el = ev.currentTarget as HTMLElement | null;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (!r.width) return 0;
  return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
}
function seekTo(ev: PointerEvent): void {
  const a = audioEl.value;
  if (!a || !(dur.value > 0)) return;
  const t = ratio(ev) * dur.value;
  cur.value = t;
  a.currentTime = t;
}
function onDown(ev: PointerEvent): void {
  if (!props.src || !(dur.value > 0)) return;
  seeking.value = true;
  try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
  seekTo(ev);
}
function onMove(ev: PointerEvent): void { if (seeking.value) seekTo(ev); }
function onUp(ev: PointerEvent): void {
  if (!seeking.value) return;
  seeking.value = false;
  try { (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
}

// ===== 语速（仅改 playbackRate；0.5~2.0，非法或空值回退 1） =====
const rateEl = ref<HTMLInputElement | null>(null);
const rateValue = ref('1');
function onRateInput(): void {
  const el = rateEl.value;
  if (!el) return;
  rateValue.value = String(applyRate(el, audioEl.value));
}
function rateStep(delta: number): void {
  const el = rateEl.value;
  if (!el) return;
  rateValue.value = String(stepRate(el, audioEl.value, delta));
}

// 换音频 / 清空：重置 UI，并让 audio 元素重新加载新 src
watch(() => props.src, () => {
  cur.value = 0;
  dur.value = 0;
  playing.value = false;
});
</script>
