<template>
  <div class="card hgen-panel" style="margin-top:16px">
    <div class="panel-title"><span class="dot"></span>预览</div>
    <!-- 背景音频：不经过 Agent，选定后由主进程注入 HTML 的 <audio>（预览即刻可听，转视频由 HyperFrames 混入 MP4） -->
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">背景音频</span>
      <span class="hf-file" style="flex:none;max-width:300px" :title="appState.project?.audioFile || '未设置音频'">{{ appState.project?.audioFile ? escTxt(appState.project.audioFile) : '未设置音频' }}</span>
      <HfSelect v-model="audioPick" :groups="audioSelGroups" title="选一份已生成音频作为背景音频" @change="onAudioPick" />
      <button class="hf-btn" title="选择本地音频文件作为背景音频" @click="onPickAudioFile">选择音频文件…</button>
      <button class="hf-btn" :disabled="!appState.project?.audioFile" title="移除背景音频" @click="onRemoveAudio">移除音频</button>
    </div>
    <div class="hgen-row" v-show="audioPreviewVisible">
      <audio ref="audioEl" :src="audioSrc" controls style="flex:1;max-height:44px"></audio>
      <label class="sel-label">语速</label>
      <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
        <button type="button" class="hf-btn" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="rateStep(-0.05)">−</button>
        <input ref="rateEl" :value="rateValue" type="text" inputmode="decimal" class="hgen-input" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none" @input="onRateInput" />
        <button type="button" class="hf-btn" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="rateStep(0.05)">+</button>
      </span>
    </div>
    <div class="hf-status" :class="statusDisplayClass">{{ statusDisplay }}</div>
    <div v-show="showThink" style="margin-top:10px;padding:10px 12px;border:1px solid rgba(0,212,255,.22);border-radius:8px;background:rgba(0,212,255,.05)">
      <div style="font-size:12px;color:#00D4FF;margin-bottom:6px">AI 思考过程（实时）</div>
      <pre ref="thinkPreEl" style="margin:0;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;font-size:12px;line-height:1.7;color:rgba(255,255,255,.82)">{{ thinkText }}</pre>
    </div>
    <div class="empty-hint" v-show="emptyVisible">{{ emptyText }}</div>
    <!-- 画布（只读）：预览 iframe 的视口就是这块画布，成片尺寸与它一致。
         选择入口在「HTML · Agent」卡片的「画布」处（它是项目属性，只在那一处选） -->
    <div class="hgen-row" style="margin-bottom:8px">
      <span class="sel-label" style="flex:none;width:auto">画布</span>
      <span class="hf-file" style="flex:none;max-width:260px" title="预览与成片都按这块画布">{{ canvasText }}</span>
      <span class="hgen-tip" style="margin:0">在「HTML · Agent」卡片的「画布」里选择（版式在生成时按它排）</span>
    </div>
    <div ref="frameWrapEl" class="hgen-frame-wrap" v-show="frameVisible" :style="{ paddingBottom: framePadPct }">
      <iframe ref="frameEl" :src="frameSrc" class="hgen-frame" sandbox="allow-scripts allow-same-origin" :style="{ width: canvasBox.width + 'px', height: canvasBox.height + 'px' }" @load="onFrameLoad"></iframe>
    </div>
    <div class="hg-prev-ctl" v-show="ctlVisible">
      <button class="hf-btn" title="暂停 / 继续播放动画" style="padding:4px 14px;font-size:12px" @click="onPrevToggle">{{ prevToggleText }}</button>
      <button class="hf-btn" title="从头重新播放" style="padding:4px 14px;font-size:12px" @click="onPrevReplay">重新播放</button>
      <div
        class="hg-prev-bar"
        :class="{ seeking }"
        title="点击或按住拖动进度条，可跳转到任意播放位置"
        @pointerdown="onSeekStart"
        @pointermove="onSeekMove"
        @pointerup="onSeekEnd"
        @pointercancel="onSeekEnd"
      >
        <div class="hg-prev-track"><div class="hg-prev-bar-fill" :style="{ width: prevFillPct }"></div></div>
      </div>
      <span class="hg-prev-time">{{ prevTimeText }}</span>
      <!-- 预览默认不自动播放、合成又普遍以 opacity:0 开头 ⇒ 首帧是空的。这里说明一句，免得被当成"白屏故障" -->
      <span v-if="!prevPlaying && prevDur > 0 && prevTimeCur < 0.05" class="hg-prev-hint">已暂停在第 0 帧 · 起始帧本就是空的，点「播放」或拖动进度条</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/PreviewSection.vue —— 「预览」卡片（从 index.vue 整块搬来，行为逐字不变）
// 职责：iframe 预览副本 + 播放控制条（暂停/重播/拖动 seek）+ AI 思考过程 + 背景音频选定与试听。
// 契约：status / statusClass / thinkText / rendering 由父页传入（生成与渲染两套状态都归父页写，
//       因为发起生成与渲染的按钮都在父页）；defineExpose({ reload }) 供父页在 Agent 成功或
//       项目状态变化后重新载入预览（原 index.vue 里的 syncPreview()）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RenderCanvas } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { escTxt } from '@renderer/utils/escape'
import { applyRate, stepRate } from '@renderer/utils/rate'
import { canvasLabel, canvasSize, normalizeCanvas } from '@renderer/utils/render'
import { previewUrl } from '@renderer/utils/url'
import { renderProgress } from '@renderer/composables/useRenderProgress'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'

const props = defineProps<{
  status: string
  statusClass: string
  thinkText: string
  rendering: boolean
}>();

// 状态区文案：渲染中优先显示全局 trace（[Render:trace] 解析结果），其余时候显示父页给的状态
const statusDisplay = computed(() => ((props.rendering && renderProgress.text) ? renderProgress.text : props.status));
const statusDisplayClass = computed(() => ((props.rendering && renderProgress.text) ? '' : props.statusClass));

// ===== 预览 =====
const frameEl = ref<HTMLIFrameElement | null>(null);
const frameWrapEl = ref<HTMLElement | null>(null);
const frameVisible = ref(false);
const frameSrc = ref('');
const emptyVisible = ref(true);
const emptyText = ref('尚未生成 HTML。');
const ctlVisible = computed(() => frameVisible.value);

// AI 思考过程：父页把流式原文传进来，这里只负责展示与自动滚到底部
const thinkPreEl = ref<HTMLElement | null>(null);
const showThink = computed(() => props.thinkText.length > 0);
watch(() => props.thinkText, () => {
  if (thinkPreEl.value) thinkPreEl.value.scrollTop = thinkPreEl.value.scrollHeight;
});

const prevPlaying = ref(true);
const prevDur = ref(0);
const prevTimeCur = ref(0);
const prevFillPct = computed(() => (prevDur.value > 0 ? Math.min(100, (prevTimeCur.value / prevDur.value) * 100).toFixed(2) + '%' : '0%'));
const prevTimeText = computed(() => fmtPrev(prevTimeCur.value) + ' / ' + (prevDur.value > 0 ? fmtPrev(prevDur.value) : '--:--'));
const prevToggleText = computed(() => (prevPlaying.value ? '暂停' : '播放'));

function fmtPrev(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function prevPost(type: string, seconds?: number): void {
  const frame = frameEl.value;
  if (frame && frame.contentWindow) frame.contentWindow.postMessage({ __hg: true, type, seconds }, '*');
}
// ===== 进度条拖动跳转（seek）=====
// 拖动中本地立即跟手（不画面里的 300ms 回报会打架），松手前把 seeking 置位以忽略回报；
// 定位由画面里的桥接脚本完成（composition 时间轴 + 音频/视频一起跳到该秒，保持播放/暂停状态）。
const seeking = ref(false);
// 松手后等画面 ack（或超时）期间：丢弃一切旧回报
const seekPending = ref(false);
let seekAckTimer = 0;
function seekRatio(ev: PointerEvent): number {
  const el = ev.currentTarget as HTMLElement | null;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
}
function seekTo(ev: PointerEvent): void {
  const dur = prevDur.value;
  if (!(dur > 0)) return; // 总时长还没上报（画面刚载入）→ 无从换算，忽略
  const sec = seekRatio(ev) * dur;
  prevTimeCur.value = sec;
  prevPost('seek', sec);
}
function onSeekStart(ev: PointerEvent): void {
  if (!frameSrc.value || !(prevDur.value > 0)) return;
  seeking.value = true;
  // 指针捕获：拖出进度条（甚至拖到按钮上）也继续收 move 事件
  try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
  seekTo(ev);
}
function onSeekMove(ev: PointerEvent): void {
  if (seeking.value) seekTo(ev);
}
function onSeekEnd(ev: PointerEvent): void {
  if (!seeking.value) return;
  seeking.value = false;
  try { (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
  // 松手后画面会立刻回一条带 ack 的进度（见主进程的 report(true)）；在收到它之前一律不采信回报，
  // 否则可能先收到一条"拖动前发出"的旧回报，看起来就像进度条被拽回原位。
  // 800ms 是兜底：画面里若是旧脚本（不认 seek）也不会让进度条永远卡住不更新。
  seekPending.value = true;
  if (seekAckTimer) window.clearTimeout(seekAckTimer);
  seekAckTimer = window.setTimeout(() => { seekPending.value = false; }, 800);
}
function onPrevMessage(ev: MessageEvent): void {
  const d = ev && ev.data;
  if (!d || !d.__hg || d.type !== 'progress') return;
  const acked = d.ack === true;
  if (acked) {
    seekPending.value = false;
    if (seekAckTimer) { window.clearTimeout(seekAckTimer); seekAckTimer = 0; }
  }
  // 拖动中、或松手后还没等到 ack：只更新总时长，位置与播放状态一律不采信
  if (seeking.value || (seekPending.value && !acked)) {
    prevDur.value = Number(d.dur) || 0;
    return;
  }
  prevTimeCur.value = Number(d.time) || 0;
  prevDur.value = Number(d.dur) || 0;
  // 用画面里的真实播放状态校准按钮文案：合成的 timeline 是 paused:true 创建的，
  // 「看似播着、其实停在第 0 帧」正是白屏时按钮却写着「暂停」的原因。
  if (typeof d.playing === 'boolean') prevPlaying.value = d.playing;
  if (prevPlaying.value && prevDur.value > 0 && prevTimeCur.value >= prevDur.value - 0.25) {
    prevPlaying.value = false; // 自然播完：进度停满，按钮回「播放」（点击即从头重播）
  }
}
// 预览画布：iframe **内部视口就是项目选定的画布尺寸**（= 渲染时 HyperFrames 的 composition 尺寸），
// 外层容器按画布宽高比留位、iframe 按容器宽度等比缩放 ⇒ 预览里看到的版式就是成片里的版式。
// 画布是项目属性（appState.project.canvas，缺省横屏 1920x1080），选择入口在「HTML · Agent」卡片。
const canvas = computed<RenderCanvas>(() => normalizeCanvas(appState.project && appState.project.canvas));
const canvasBox = computed(() => canvasSize(canvas.value));
const canvasText = computed(() => canvasLabel(canvas.value) + '（' + canvasBox.value.width + '×' + canvasBox.value.height + '）');
// 容器留位比例：padding-bottom = 高/宽（16:9 → 56.25%）
const framePadPct = computed(() => ((canvasBox.value.height / canvasBox.value.width) * 100).toFixed(4) + '%');
function fitFrame(): void {
  const wrap = frameWrapEl.value;
  const frame = frameEl.value;
  if (wrap && frame) {
    frame.style.transform = 'scale(' + (wrap.clientWidth / canvasBox.value.width) + ')';
  }
}
// 画布变了（用户在「HTML · Agent」卡片里改）：容器比例与 iframe 尺寸随 computed 自动更新，
// 缩放比要重算一次（fitFrame 读容器宽度）。等 DOM 更新后再算，否则量到的还是旧布局。
watch(canvas, () => { void nextTick(fitFrame); });
function onFrameLoad(): void {
  // 每次载入完成（含重新播放的 reload）：重置进度与按钮状态，并按容器宽度重新缩放画布。
  // 这里刻意**不**主动起播——预览默认静止在第 0 帧，播放交给用户（「播放」按钮 / 拖动进度条）。
  // 按钮文案靠画面回报的 playing 校准，所以第一帧就会显示「播放」而不是假装在播。
  prevPlaying.value = false;
  prevDur.value = 0;
  prevTimeCur.value = 0;
  fitFrame();
}
function onPrevToggle(): void {
  if (!frameSrc.value) { toast('暂无预览'); return; }
  if (!prevPlaying.value && prevDur.value > 0 && prevTimeCur.value >= prevDur.value - 0.25) {
    // 已自然播完：播放键 = 从头重播
    prevPost('restart');
    prevPlaying.value = true;
    prevTimeCur.value = 0;
    prevDur.value = 0;
    return;
  }
  prevPlaying.value = !prevPlaying.value;
  prevPost(prevPlaying.value ? 'play' : 'pause');
}
function onPrevReplay(): void {
  if (!frameSrc.value) { toast('暂无预览'); return; }
  prevPost('restart');
  prevPlaying.value = true;
}

// 加载预览：主进程生成带控制脚本的预览副本（index.preview.html），iframe 载入副本
async function loadFrame(): Promise<void> {
  const res = await window.projectTools.previewHtml(appState.currentName).catch(() => null);
  if (!res || !res.ok) {
    frameVisible.value = false;
    frameSrc.value = '';
    emptyVisible.value = true;
    emptyText.value = (res as { message?: string })?.message || '预览副本生成失败';
    return;
  }
  // 走 hgpreview:// 协议（dev http 页下 file:// iframe 会被 Chromium 拦截）；bust=true 附时间戳强制重新加载
  const relFile = String(res.previewPath).split(/[\\/]/).pop() || 'index.preview.html';
  frameSrc.value = previewUrl(appState.currentName, relFile, true);
  frameVisible.value = true;
  emptyVisible.value = false;
}

// 状态联动：有 HTML → 自动预览；无 HTML → 恢复“尚未生成”提示（不展示空 iframe）
function syncPreview(): void {
  const ok = !!(appState.project && appState.project.htmlExists && appState.project.htmlPath);
  if (ok) loadFrame();
  else {
    frameVisible.value = false;
    frameSrc.value = '';
    emptyVisible.value = true;
    emptyText.value = '尚未生成 HTML。';
  }
}

// ===== 背景音频（在本卡片里选定；由主进程注入 HTML，不进生成提示词）=====
const audioPick = ref('');   // 已生成音频下拉（'' = 未选）
const audioEl = ref<HTMLAudioElement | null>(null);
const audioSrc = ref('');
const audioPreviewVisible = ref(false);

// 背景音频试听：走 hgpreview://（dev 下 http 页读不了 file://，见 CHANGELOG #25）+ 时间戳避免缓存
function setAudioPreview(relFile: string): void {
  if (relFile) {
    audioSrc.value = previewUrl(appState.currentName, relFile, true);
    audioPreviewVisible.value = true;
  } else {
    audioSrc.value = '';
    audioPreviewVisible.value = false;
  }
}

// 设 / 换 / 移除背景音频的统一收尾：刷新项目 → 更新试听源 → 重新加载预览
// （主进程在 setAudio / clearAudio 里同步改写了 index.html 的音轨，必须重载 iframe 才听得到）
// relFile 是**项目内相对路径**（audio/xxx）：主进程 setAudio 已把音频复制进项目目录。
async function afterAudioChange(tip: string, relFile: string): Promise<void> {
  await refreshProject();
  setAudioPreview(relFile);
  await loadFrame();
  toast(tip);
}

async function onPickAudioFile(): Promise<void> {
  const picked = await window.projectTools.pickAudio();
  if (!picked) return;
  const res = await window.projectTools.setAudio(appState.currentName, picked);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置音频失败'); return; }
  await afterAudioChange('已设为背景音频：' + res.audioFile, res.audioFile || '');
}

// 从「已生成音频」里选一份设为背景音频（选中即生效，用完把下拉复位）
async function onAudioPick(): Promise<void> {
  const idx = audioPick.value;
  audioPick.value = '';
  const it = genAudios.value[Number(idx)];
  if (!it) return;
  const res = await window.projectTools.setAudio(appState.currentName, it.path);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置背景音频失败'); return; }
  await afterAudioChange('已设为背景音频：' + res.audioFile, res.audioFile || '');
}

async function onRemoveAudio(): Promise<void> {
  await window.projectTools.clearAudio(appState.currentName);
  await afterAudioChange('已移除背景音频（HTML 里的音轨也已摘掉）', '');
}

// 已生成音频列表（只用于填充本卡片的下拉；本页不再有独立的列表 + 试听 + 设为背景音频三件套）
interface GenAudioItem { path: string; name: string; group: string; size: number; mtime: number }
const genAudios = ref<GenAudioItem[]>([]);
// HfSelect 选项（value 仍是下标字符串，'' = 未选）
const audioSelGroups = computed<HfSelectGroup[]>(() => [{
  label: '',
  options: [
    { value: '', label: '从已生成音频中选择…' },
    ...genAudios.value.map((it, i) => ({ value: String(i), label: it.name + '（' + it.group + '）' }))
  ]
}]);
async function genLoad(): Promise<void> {
  const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' }));
  if (!res || !res.ok) return;   // 静默：下拉留空即可，不打断页面（生成音频不是本页必需）
  genAudios.value = res.items || [];
}

// ===== 背景音频试听：语速调节（仅改 playbackRate；0.5~2.0，非法或空值回退 1） =====
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

// 父页在 Agent 成功 / 项目状态变化后调用：重新判定并载入预览（原 index.vue 的 syncPreview）
defineExpose({ reload: syncPreview });

onMounted(() => {
  window.addEventListener('message', onPrevMessage);
  window.addEventListener('resize', fitFrame);
  syncPreview();
  genLoad();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onPrevMessage);
  window.removeEventListener('resize', fitFrame);
  if (seekAckTimer) { window.clearTimeout(seekAckTimer); seekAckTimer = 0; }
});
</script>
