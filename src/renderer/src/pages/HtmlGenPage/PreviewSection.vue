<template>
  <div class="card hgen-panel" style="margin-top:16px">
    <div class="panel-title"><span class="dot"></span>预览</div>
    <!-- 背景音频：不经过 Agent，选定后由主进程注入 HTML 的 <audio>（预览即刻可听，转视频由 HyperFrames 混入 MP4）。
         这一行只有一个控件：下拉占满整行，**当前音频就是「已生成音频」里的选中项**（勾选 + 显示在该下拉上），
         清空走「不使用背景音频」那一项 —— 所以没有独立的「移除」按钮、也不挂 `?` 气泡
         （音轨的注入规则写在触发器 title 里，鼠标悬停即可看到）。 -->
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:56px">背景音频</span>
      <HfSelect v-model="audioPick" :groups="audioSelGroups" style="flex:1" :title="audioFile ? '当前背景音频：' + audioFile + '（由应用注入 HTML，不进生成提示词）' : '还没有背景音频：可选「已生成音频」或本地文件；音轨由应用注入 HTML，不进生成提示词'" @change="onAudioPick" />
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
    <!-- 视角比例（**不再显示「画布」值**：画布是项目属性、入口在「HTML · Agent」卡片，预览卡里不重复它）。
         iframe 的视口 = 页面自己声明的画布（`<html data-resolution>`，无声明时回落项目画布），再按这个**比例**
         contain 进容器 ⇒ 横屏页面按 1:1 看 = 等比缩小 + 上下黑边，右边不被裁。比例只是观看方式：
         成片仍是真实分辨率（横屏就是 1920×1080），不受这里影响。 -->
    <div class="hgen-row" style="margin-bottom:8px">
      <label class="sel-label" style="flex:none;width:56px">视角比例</label>
      <HfSelect v-model="viewMode" :groups="VIEW_MODE_GROUPS" style="width:130px;flex:none" title="预览按哪种比例显示；只影响观看，成片仍是真实分辨率" />
      <span class="hg-help" @click.stop>
        <span class="hg-help-icon">?</span>
        <span class="hg-help-pop" style="top:calc(100% + 8px);bottom:auto">预览只按<b>比例</b>缩放显示（等比 contain + 居中），像素由成片保证——成片才是真实分辨率。切到别的比例＝「把这条片子放进那种形状的屏幕里看」，多出来的地方就是黑边，<b>不影响成片</b>；页面仍按它自己声明的画布渲染，所以版式不会被裁。</span>
      </span>
      <span v-show="viewHint" class="hgen-tip" style="margin:0">{{ viewHint }}</span>
    </div>
    <div ref="frameWrapEl" class="hgen-frame-wrap" v-show="frameVisible" :style="frameStyle">
      <iframe ref="frameEl" :src="frameSrc" class="hgen-frame" sandbox="allow-scripts allow-same-origin" :style="{ width: pageBox.width + 'px', height: pageBox.height + 'px' }" @load="onFrameLoad"></iframe>
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
// pages/HtmlGenPage/PreviewSection.vue —— 「预览」卡片（从 index.vue 整块搬来，行为逐字不变）
// 职责：iframe 预览副本 + 播放控制条（暂停/重播/拖动 seek）+ AI 思考过程 + 背景音频选定与试听。
// 契约：status / statusClass / thinkText / rendering 由父页传入（生成与渲染两套状态都归父页写，
//       因为发起生成与渲染的按钮都在父页）；defineExpose({ reload }) 供父页在 Agent 成功或
//       项目状态变化后重新载入预览（原 index.vue 里的 syncPreview()）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RenderCanvas } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { applyRate, stepRate } from '@renderer/utils/rate'
import { canvasSize, normalizeCanvas } from '@renderer/utils/render'
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
// 总时长不可信（画面里的闸门判它超过「声明时长 10 倍」或 24 小时）：界面显示 --:-- 并说明原因
const prevDurUnknown = ref(false);
const prevFillPct = computed(() => (prevDur.value > 0 ? Math.min(100, (prevTimeCur.value / prevDur.value) * 100).toFixed(2) + '%' : '0%'));
const prevTimeText = computed(() => fmtPrev(prevTimeCur.value) + ' / ' + (prevDur.value > 0 ? fmtPrev(prevDur.value) : '--:--'));
// 播放键三态（原「暂停/继续」与「从头重新播放」两个按钮已合并成一个）：
// 播放中 → 暂停；已播完 → 重新播放；其余（未开始 / 暂停在中途）→ 播放（继续）。
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
  // 画面里的 clock() 会把「不可信的超长时长」降级成 dur=0 + unknown=true（见主进程注入脚本），
  // 这里只负责上屏：总时长走 --:--，并显示那行原因说明。
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
// 预览的几何：iframe 视口 = **页面自己声明的画布**（`<html data-resolution>`，由 project:preview-html 带回），
// 页面没声明（老页面）时回落项目当前画布。外层容器按「视角比例」留位，iframe 再等比 contain 进去
// ⇒ 只要比例对，页面版式就不会被裁（多出来的地方是黑边）。**画布值不在本卡显示**（入口在「HTML · Agent」卡片）。
const canvas = computed<RenderCanvas>(() => normalizeCanvas(appState.project && appState.project.canvas));
const pageDeclared = ref<RenderCanvas | ''>('');
const pageBox = computed(() => canvasSize(pageDeclared.value || canvas.value));
// 页面天然的比例（= 页面声明的画布；无声明时取项目画布）：它就是「视角」的默认值，此时不留黑边
const pageMode = computed<RenderCanvas>(() => pageDeclared.value || canvas.value);

// ===== 视角比例（只影响观看，不改变成片）=====
// 预览只按**比例**缩放显示：像素由成片保证（横屏成片就是 1920×1080），这里只关心比例。
// 刻意不设「跟随画布」这类选项：默认值就是页面比例，切画布 / 换页面时自动归位。
const VIEW_MODE_OPTIONS: { value: RenderCanvas; label: string }[] = [
  { value: 'landscape', label: '16:9' },
  { value: 'portrait', label: '9:16' },
  { value: 'square', label: '1:1' }
];
const VIEW_MODE_GROUPS: HfSelectGroup[] = [{ label: '', options: VIEW_MODE_OPTIONS }];
const viewMode = ref<RenderCanvas>(pageMode.value);
const viewBox = computed(() => canvasSize(viewMode.value));
// 视图容器的尺寸规则（用户定稿）：**高度上限 800px、宽度由比例决定**——
// 宽窗口里就是 800 高（16:9 → 1422×800 / 9:16 → 450×800 / 1:1 → 800×800），切比例只改宽度；
// 可用宽度不够时整体等比缩小（宽度 = min(可用宽, 800 × 比例)），所以永远不会裁切。
// 用 CSS aspect-ratio + width:min() 表达，不写死像素：容器的 clientWidth/clientHeight 交给 fitFrame 去算缩放比。
const VIEW_MAX_HEIGHT = 800;
const frameStyle = computed(() => ({
  width: 'min(100%, ' + Math.round(VIEW_MAX_HEIGHT * viewBox.value.width / viewBox.value.height) + 'px)',
  aspectRatio: viewBox.value.width + ' / ' + viewBox.value.height,
  // 覆盖 .hgen-frame-wrap 的 padding-bottom 占位（那是纯 CSS 时代的留位技巧，现在由 aspect-ratio 决定高度）
  paddingBottom: '0'
}));
// 这一行说明只在「需要解释」时出现：按别的比例看、或页面根本没声明画布；默认态为空
const viewHint = computed(() => {
  if (viewMode.value !== pageMode.value) {
    const vw = viewBox.value.width / viewBox.value.height;
    const pw = pageBox.value.width / pageBox.value.height;
    const band = vw > pw ? '左右留黑边' : (vw < pw ? '上下留黑边' : '不留黑边');
    const hit = VIEW_MODE_OPTIONS.find((o) => o.value === viewMode.value);
    return '模拟：按「' + (hit ? hit.label : '') + '」观看（' + band + '）；只影响预览';
  }
  if (!pageDeclared.value) return '本页未声明画布，按当前项目画布的比例显示';
  return '';
});
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
// 画布变了（用户在「HTML · Agent」卡片里改）：视角回到「页面比例」（没有声明时就是新画布的比例），
// 再重算容器比例与缩放比（fitFrame 读容器尺寸，等 DOM 更新后再算，否则量到的还是旧布局）。
watch(canvas, () => {
  viewMode.value = pageMode.value;
  void nextTick(fitFrame);
});
// 换视角：容器尺寸随 frameStyle 变（高度上限 800、宽度按比例），缩放比要在 DOM 更新后重算
watch(viewMode, () => { void nextTick(fitFrame); });
function onFrameLoad(): void {
  // 每次载入完成（含重新播放的 reload）：重置进度与按钮状态，并按容器宽度重新缩放画布。
  // 这里刻意**不**主动起播——预览默认静止在第 0 帧，播放交给用户（「播放」按钮 / 拖动进度条）。
  // 按钮文案靠画面回报的 playing 校准，所以第一帧就会显示「播放」而不是假装在播。
  prevPlaying.value = false;
  prevDur.value = 0;
  prevTimeCur.value = 0;
  prevDurUnknown.value = false;
  fitFrame();
}
function onPrevToggle(): void {
  if (!frameSrc.value) { toast('暂无预览'); return; }
  if (prevEnded.value) {
    // 已自然播完：同一个键 = 从头重播（原来这是独立的「重新播放」按钮）
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

// ===== 背景音频（在本卡片里选定；由主进程注入 HTML，不进生成提示词）=====
// 「不使用背景音频」这一项（清空音轨）：原来是独立的「移除」按钮，现并入下拉
const NONE_AUDIO = '__none__';
// 下拉的选中值：「已生成音频」的下标字符串；'' = 没有对得上的项（未设置，或当前音频来自本地文件 / 视频原声）
const audioPick = ref('');
// 背景音频（项目内相对路径；空 = 未设置）：「移除」的显隐、试听源、下拉首项的文案都看它
const audioFile = computed(() => (appState.project && appState.project.audioFile) || '');
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

// 「更换背景音频」下拉 = **列表 + 动作**：当前音频直接在「已生成音频」里显示为选中项（HfSelect 自己的勾选），
// 选任何一项即生效，清空走「不使用背景音频」；选完后选中态回到"当前音频对得上的那条"。
async function onAudioPick(): Promise<void> {
  const picked = audioPick.value;
  audioPick.value = currentAudioIndex.value >= 0 ? String(currentAudioIndex.value) : '';
  if (!picked) return;
  if (picked === '__file__') { await onPickAudioFile(); return; }
  if (picked === NONE_AUDIO) { await onRemoveAudio(); return; }
  const it = genAudios.value[Number(picked)];
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

// 把项目里的背景音轨（audio/<文件名>）对回「已生成音频」里的一条：主进程 copyAudioIntoProject()
// 复制进项目时**保留原文件名**（重名才补 _1 / _2 后缀），所以按 basename 去掉 _N 后缀比较即可；
// 对不上（本地文件 / 从视频提取的原声）返回 -1，由下拉首项把名字显示出来。
function audioBaseName(p: string): string {
  return (p || '').split(/[\\/]/).pop() || '';
}
const currentAudioIndex = computed(() => {
  const save = audioBaseName(audioFile.value);
  if (!save) return -1;
  const norm = (s: string) => s.replace(/_\d+(?=\.[^.]+$)/, '');
  return genAudios.value.findIndex((it) => norm(audioBaseName(it.path)) === norm(save));
});
// 当前音频变了（选中 / 清空 / 换项目 / 列表刚加载完）就把下拉的选中态同步过去——这就是"选中态"的唯一来源
watch([currentAudioIndex, genAudios], () => {
  audioPick.value = currentAudioIndex.value >= 0 ? String(currentAudioIndex.value) : '';
}, { immediate: true });

// 下拉 = **列表 + 动作**：当前音频就是「已生成音频」里的选中项，**不再单独造一条「当前：…」**。
// 只有对不上列表的值（本地文件 / 提取的原声）才用一个同名项把值显示出来；有音频时另有「不使用背景音频」用于清空。
const audioSelGroups = computed<HfSelectGroup[]>(() => {
  const head: { value: string; label: string }[] = [];
  if (currentAudioIndex.value < 0) head.push({ value: '', label: audioFile.value ? audioBaseName(audioFile.value) : '未设置背景音频' });
  if (audioFile.value) head.push({ value: NONE_AUDIO, label: '不使用背景音频' });
  return ([
    { label: '', options: head },
    { label: '已生成音频', options: genAudios.value.map((it, i) => ({ value: String(i), label: it.name + '（' + it.group + '）' })) },
    { label: '本地', options: [{ value: '__file__', label: '选择本地文件…' }] }
  ] as HfSelectGroup[]).filter((g) => g.options.length > 0);
});
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
  // 试听源按**项目现有的**背景音频初始化：不这么做，切页回来 audioPreviewVisible 又是 false，
  // 那一行试听就整块消失（用户实测过）。没有音频时传空串，setAudioPreview 会把行收起来。
  setAudioPreview(audioFile.value);
  syncPreview();
  genLoad();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onPrevMessage);
  window.removeEventListener('resize', fitFrame);
  if (seekAckTimer) { window.clearTimeout(seekAckTimer); seekAckTimer = 0; }
});
</script>
