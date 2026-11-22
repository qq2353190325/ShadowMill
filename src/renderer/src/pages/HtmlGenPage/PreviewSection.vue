<template>
  <div class="hgen-preview-inner">
    <div class="hf-status" :class="statusDisplayClass">{{ statusDisplay }}</div>
    <!-- AI 思考过程：**标题行本身就是开关**（不另设按钮）。默认收起，只有生成/修改进行中才自动展开；
         一轮结束（running 由真变假）自动收起，想看上一轮的思考点一下标题行即可。 -->
    <div v-show="showThink" style="margin-top:10px;padding:10px 12px;border:1px solid rgba(0,212,255,.22);border-radius:8px;background:rgba(0,212,255,.05)">
      <div
        class="hg-think-head"
        :title="thinkOpen ? '收起思考过程' : '展开思考过程'"
        @click="thinkOpen = !thinkOpen"
      >
        <span class="hg-think-arrow">{{ thinkOpen ? '▾' : '▸' }}</span>
        <span>AI 思考过程{{ running ? '（实时）' : '' }}</span>
      </div>
      <pre v-show="thinkOpen" ref="thinkPreEl" style="margin:6px 0 0;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;font-size:12px;line-height:1.7;color:rgba(255,255,255,.82)">{{ thinkText }}</pre>
    </div>
    <div class="empty-hint" v-show="emptyVisible">{{ emptyText }}</div>
    <div class="hgen-preview-stage">
      <div ref="frameWrapEl" class="hgen-frame-wrap" v-show="frameVisible" :style="frameStyle">
        <iframe ref="frameEl" :src="frameSrc" class="hgen-frame" sandbox="allow-scripts allow-same-origin" :style="{ width: pageBox.width + 'px', height: pageBox.height + 'px' }" @load="onFrameLoad"></iframe>
      </div>
    </div>
    <div class="hg-prev-ctl" v-show="ctlVisible">
      <button class="hf-btn" :title="prevToggleTitle" style="padding:4px 14px;font-size:12px" @click="onPrevToggle">{{ prevToggleText }}</button>
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
    <!-- 时长不可信（页面里有 repeat: -1）：总时长显示 --:-- 并说明原因。
         GSAP 把无限循环 tween 当成 1e10 秒，父时间轴因此报 1e10 量级的 duration，
         以前会原样显示成「166666668:12」（317 年），进度条与拖动跳转一并废掉。 -->
    <div v-if="prevDurUnknown" class="hgen-tip" style="margin:6px 0 0">页面里有无限循环动画（GSAP 的 repeat: -1），总时长无法确定，进度条与拖动跳转暂不可用；把循环改成有限次数（如 repeat: 12, repeatDelay: 0.4）后就会恢复。</div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/PreviewSection.vue —— 主区「预览」画面（工作台左主区）
// 职责：iframe 预览副本 + 播放控制条（暂停/重播/拖动 seek）+ 状态区 + AI 思考过程（可折叠）。
// 背景音频 / 语速 / 视角比例已搬到右侧栏的 PreviewControls.vue；视角与画布状态走 usePreviewView.ts 共享——
// 右侧栏下拉写 viewMode，这里读它决定容器形状，两边天然同步。
// 契约：status / statusClass / thinkText / rendering / running 由父页传入；defineExpose({ reload })
//       供父页在 Agent 成功或项目状态变化后重新载入预览。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appState } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { previewUrl } from '@renderer/utils/url'
import { renderProgress } from '@renderer/composables/useRenderProgress'
import { pageBox, pageDeclared, pageMode, projectCanvas, setPreviewReloadHook, viewBox, viewMode } from '@renderer/composables/usePreviewView'

const props = defineProps<{
  status: string
  statusClass: string
  thinkText: string
  rendering: boolean
  // Agent（生成 / 修改）是否正在进行：只用来决定思考区自动展开还是自动收起
  running: boolean
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

// AI 思考过程：父页把流式原文传进来，这里只负责展示与自动滚到底部。
// 展开状态：**生成中自动展开**、**一轮结束自动收起**，其余时候由用户点标题行自己开关。
const thinkPreEl = ref<HTMLElement | null>(null);
const thinkOpen = ref(false);
const showThink = computed(() => props.thinkText.length > 0);
watch(() => props.running, (now, was) => {
  if (now) thinkOpen.value = true;
  else if (was) thinkOpen.value = false;
});
watch(() => props.thinkText, () => {
  if (!thinkOpen.value) return;   // 收起时不必滚（元素尺寸为 0，滚了也没有意义）
  if (thinkPreEl.value) thinkPreEl.value.scrollTop = thinkPreEl.value.scrollHeight;
});

const prevPlaying = ref(true);
const prevDur = ref(0);
const prevTimeCur = ref(0);
// 总时长不可信（画面里的闸门判它超过「声明时长 10 倍」或 24 小时）：界面显示 --:-- 并说明原因
const prevDurUnknown = ref(false);
const prevFillPct = computed(() => (prevDur.value > 0 ? Math.min(100, (prevTimeCur.value / prevDur.value) * 100).toFixed(2) + '%' : '0%'));
const prevTimeText = computed(() => fmtPrev(prevTimeCur.value) + ' / ' + (prevDur.value > 0 ? fmtPrev(prevDur.value) : '--:--'));
// 播放键三态：播放中 → 暂停；已播完 → 重新播放；其余（未开始 / 暂停在中途）→ 播放（继续）。
const prevEnded = computed(() => !prevPlaying.value && prevDur.value > 0 && prevTimeCur.value >= prevDur.value - 0.25);
const prevToggleText = computed(() => (prevPlaying.value ? '暂停' : (prevEnded.value ? '重新播放' : '播放')));
const prevToggleTitle = computed(() => (prevPlaying.value ? '暂停动画' : (prevEnded.value ? '从头重新播放' : '播放 / 继续动画')));

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
  // 松手后画面会立刻回一条带 ack 的进度；在收到它之前一律不采信回报，
  // 否则可能先收到一条"拖动前发出"的旧回报，看起来就像进度条被拽回原位。800ms 是兜底。
  seekPending.value = true;
  if (seekAckTimer) window.clearTimeout(seekAckTimer);
  seekAckTimer = window.setTimeout(() => { seekPending.value = false; }, 800);
}
function onPrevMessage(ev: MessageEvent): void {
  const d = ev && ev.data;
  if (!d || !d.__hg || d.type !== 'progress') return;
  // 画面里的 clock() 会把「不可信的超长时长」降级成 dur=0 + unknown=true；这里只负责上屏
  prevDurUnknown.value = d.unknown === true;
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

// 预览的几何：pageBox / viewBox / viewMode / pageMode 都来自共享的 usePreviewView.ts——
// 右侧栏的视角下拉写 viewMode，这里读它决定容器形状，两边天然同步。
// 视图容器的尺寸规则：**高度上限 800px、宽度由视角比例算出来**（CSS aspect-ratio）。
// 一屏工作台里预览区是弹性高度的格子：容器按可用高度撑满，宽度 = 高度 × 视角比例；
// 宽窗口最多 800 高，窄 / 矮窗口由 CSS 的 max-width / max-height 收住，绝不溢出。
// iframe 再由 fitFrame 等比 contain 进这块「屏幕」，多出来的地方是黑边（容器底色）。
const VIEW_MAX_HEIGHT = 800;
const frameStyle = computed(() => ({
  height: 'min(100%, ' + VIEW_MAX_HEIGHT + 'px)',
  width: 'auto',
  aspectRatio: viewBox.value.width + ' / ' + viewBox.value.height,
  // 覆盖 .hgen-frame-wrap 的 padding-bottom 占位（纯 CSS 时代的留位技巧，现在高度由 height 决定）
  paddingBottom: '0'
}));
function fitFrame(): void {
  const wrap = frameWrapEl.value;
  const frame = frameEl.value;
  if (!wrap || !frame) return;
  // contain：把「页面原生视口」（pageBox）整体缩进视角形状里，取宽 / 高两个方向的较小缩放比并居中，
  // 多出来的地方就是黑边（容器底色）。页面声明画布 = 项目画布时，与旧的「按宽度缩放」等价。
  const k = Math.min(wrap.clientWidth / pageBox.value.width, wrap.clientHeight / pageBox.value.height);
  const tx = (wrap.clientWidth - pageBox.value.width * k) / 2;
  const ty = (wrap.clientHeight - pageBox.value.height * k) / 2;
  frame.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')';
}
// 项目画布变了（用户在右侧栏「生成前提」里改）：视角回到「页面比例」，再重算缩放比。
// 只监听 projectCanvas，不监听 pageMode —— 载入预览副本时页面声明的画布也会让 pageMode 变，
// 那条路径在 loadFrame 里是「用户没手动选过才归位」的条件更新，不能被这里的无条件重置覆盖。
watch(projectCanvas, () => {
  viewMode.value = pageMode.value;
  void nextTick(fitFrame);
});
// 换视角：容器尺寸随 frameStyle 变，缩放比要在 DOM 更新后重算
watch(viewMode, () => { void nextTick(fitFrame); });
function onFrameLoad(): void {
  // 每次载入完成（含重新播放的 reload）：重置进度与按钮状态，并按容器宽度重新缩放画布。
  // 这里刻意**不**主动起播——预览默认静止在第 0 帧，播放交给用户（「播放」按钮 / 拖动进度条）。
  prevPlaying.value = false;
  prevDur.value = 0;
  prevTimeCur.value = 0;
  prevDurUnknown.value = false;
  fitFrame();
}
function onPrevToggle(): void {
  if (!frameSrc.value) { toast('暂无预览'); return; }
  if (prevEnded.value) {
    // 已自然播完：同一个键 = 从头重播
    prevPost('restart');
    prevPlaying.value = true;
    prevTimeCur.value = 0;
    prevDur.value = 0;
    return;
  }
  prevPlaying.value = !prevPlaying.value;
  prevPost(prevPlaying.value ? 'play' : 'pause');
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
  // 页面声明的画布（空 = 老页面没写 data-resolution）：它决定 iframe 的「原生视口」尺寸。
  // 视角还停在默认（页面比例）时跟着一起更新；用户手动选过别的比例就不打扰他。
  const prevPageMode = pageMode.value;
  pageDeclared.value = res.pageCanvas || '';
  if (viewMode.value === prevPageMode) viewMode.value = pageMode.value;
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

// 一屏工作台下预览区是弹性格子，容器尺寸会随窗口 / 面板变化；ResizeObserver 比 window.resize 更准，
// 尺寸一变就重算 iframe 缩放比（fitFrame 读的是容器 clientWidth/clientHeight）。
let frameObserver: ResizeObserver | null = null;

// 父页在 Agent 成功 / 项目状态变化后调用：重新判定并载入预览
defineExpose({ reload: syncPreview });

onMounted(() => {
  window.addEventListener('message', onPrevMessage);
  window.addEventListener('resize', fitFrame);
  // 模块级共享状态：切页回来先清掉上个项目页面声明的画布，再由 syncPreview → loadFrame 重新填
  pageDeclared.value = '';
  // 背景音频控件在右侧栏：它改完音轨后经 requestPreviewReload() 喊这里重载预览副本
  setPreviewReloadHook(loadFrame);
  syncPreview();
  if (frameWrapEl.value && typeof ResizeObserver !== 'undefined') {
    frameObserver = new ResizeObserver(() => fitFrame());
    frameObserver.observe(frameWrapEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onPrevMessage);
  window.removeEventListener('resize', fitFrame);
  setPreviewReloadHook(null);
  if (frameObserver) { frameObserver.disconnect(); frameObserver = null; }
  if (seekAckTimer) { window.clearTimeout(seekAckTimer); seekAckTimer = 0; }
});
</script>
