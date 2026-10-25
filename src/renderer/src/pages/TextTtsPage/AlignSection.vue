<template>
  <div class="card hgen-panel" style="margin-top:16px">
    <div class="panel-title"><span class="dot"></span>字幕配音（逐句对齐）</div>
    <div class="hgen-tip" v-show="alignMode === 'audio-driven'">逐句 TTS 合成后以实测每句时长为准重建字幕时间线，句间停顿优先按字幕原有间隔推算。结果写入当前项目。</div>
    <div class="hgen-tip" v-show="alignMode === 'timeline-driven'">保持字幕时间不变，把每句配音摆到其字幕时间戳（句间补静音），放不下时轻微加速（≤1.15 倍）或顺延后续句子并同步改字幕。结果写入当前项目。</div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">字幕来源</span>
      <HfSelect v-model="subSrc" :groups="subSrcGroups" title="选用哪份字幕逐句合成配音" @change="syncSubCount" />
      <button class="hf-btn" @click="syncSubCount">刷新</button>
      <span class="hgen-tip" style="margin:0;font-size:12px;white-space:nowrap">{{ subCountTip }}</span>
    </div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">音色</span>
      <HfSelect v-model="voiceId" :groups="voiceGroups" :disabled="!voiceKeyReady" :title="voiceKeyReady ? '' : '先在「设置」-「语音服务」填好该厂家的 API Key，才能选择音色'" />
      <button class="hf-btn" @click="onRefreshVoice">刷新</button>
      <button class="hf-btn" v-if="!voiceKeyReady" title="跳转到「设置」-「语音服务」" style="padding:4px 12px;font-size:12px" @click="goSettingsVoice">API Key 设置</button>
    </div>
    <div class="hgen-tip" v-if="!voiceKeyReady" style="margin-top:0">还没配置「{{ activeProviderLabel || '当前厂家' }}」的 API Key：先在「设置 → 语音服务」填好并保存，才能选择音色与模型（没 Key 时逐句合成一定失败）。</div>
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:auto">对齐方式</span>
      <label class="hgen-check"><input type="radio" value="audio-driven" v-model="alignMode" /> 重排字幕（音频驱动）</label>
      <label class="hgen-check"><input type="radio" value="timeline-driven" v-model="alignMode" /> 修正音频（时间轴驱动）</label>
    </div>
    <div class="hgen-row" v-show="alignMode === 'audio-driven'">
      <span class="sel-label" style="flex:none;width:auto">句间停顿（秒）</span>
      <input v-model="gap" class="hgen-input" type="number" min="0" max="10" step="0.1" style="width:90px;flex:none" title="最小停顿：每句停顿优先按字幕原有时间间隔推算；仅当字幕间隔放不下本句音频、或字幕无时间线（估时）时，才用此值兜底" />
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" :disabled="alignBusy" @click="startAlign()">开始对齐合成</button>
      <button class="hf-btn" v-show="alignBusy" @click="onCancel">取消</button>
      <button class="hf-btn" v-show="!alignBusy && !alignResult" @click="startAlign()">重试</button>
    </div>
    <div class="whisper-bar-wrap" v-show="barVisible">
      <div class="whisper-bar" :class="{ indeterminate: barIndeterminate }"><div class="whisper-bar-fill" :class="barState" :style="{ width: barPercent + '%' }"></div></div>
      <div class="whisper-bar-text">{{ barText }}</div>
    </div>
    <div class="hf-status" :class="statusClass" style="margin-top:var(--space-3)">{{ status }}</div>
    <div v-show="alignResult !== null" style="margin-top:var(--space-4)">
      <div class="hgen-row">
        <audio ref="alignAudioEl" :src="alignAudioSrc" class="hf-video" controls style="flex:1;max-height:54px"></audio>
        <button class="hf-btn" @click="onOpenDir">打开目录</button>
        <button class="hf-btn hf-btn-primary" @click="writeAlign">写入当前项目</button>
      </div>
      <div class="hgen-tip" style="margin-top:var(--space-3)">{{ summary }}</div>
      <div class="sub-list" style="max-height:300px">
        <div v-for="d in details" :key="d.index" class="align-row">
          <span class="align-idx">{{ d.index + 1 }}</span>
          <span class="align-txt" :title="escTxt(d.text)">{{ escTxt(d.text) }}</span>
          <span class="align-time">{{ fmtTime(d.subtitleStart) }}</span>
          <span class="align-time">{{ fmtTime(d.audioStart) }}</span>
          <span class="align-dur">{{ Number(d.audioDur).toFixed(1) }}s</span>
          <span v-if="d.status === 'accelerated'" class="align-badge warn">加速 x{{ Number(d.rate).toFixed(2) }}</span>
          <span v-else-if="d.status === 'pushed'" class="align-badge warn">顺延 +{{ Number(d.delta).toFixed(1) }}s</span>
          <span v-else class="align-badge ok">正常</span>
          <button v-if="d.segPath" type="button" class="hf-btn align-play" style="padding:2px 10px;font-size:12px" @click="playSeg(d.segPath)">试听</button>
        </div>
      </div>
    </div>
    <audio ref="segAudioEl" style="display:none"></audio>
  </div>
</template>

<script setup lang="ts">
// pages/TextTtsPage/AlignSection.vue —— 字幕配音（逐句对齐）卡（原 JS 版 textTts 模块 align.js 移植）
import { computed, onMounted, ref, watch } from 'vue'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { useConfigPrompt } from '@renderer/composables/useConfigPrompt'
import { goPage } from '@renderer/pages'
import { requestSettingsSection } from '@renderer/composables/useNavIntent'
import { escTxt } from '@renderer/utils/escape'
import { useEnvGate } from '@renderer/composables/useEnvGate'
import { fmtTime, fmtTimeMs } from '@renderer/utils/time'
import { userPathUrl } from '@renderer/utils/url'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import { activeProviderLabel, activeTtsTab, firstVoiceId, loadVoices, refreshVoiceKeyState, requireCfg, voiceGroups, voiceKeyReady, voiceModelOf } from './helpers'

// 运行环境缺包时的确认框（ffmpeg 不随安装包；见 docs/runtime-pack-split.md）
const envGate = useEnvGate();
// 配置类错误弹窗（Key 无效 / 余额不足 / 未配置…）：主进程判好分类，本页只负责触发
const configPrompt = useConfigPrompt();

interface AlignDetail {
  index: number
  text: string
  subtitleStart: number
  audioStart: number
  audioDur: number
  status: string
  rate: number
  delta: number
  segPath?: string
}
interface AlignResult {
  audioPath: string
  subtitleText: string
  details: AlignDetail[]
  totalDur: number
  mode: string
}

const status = ref('');
const statusClass = ref('');
const setStatus = (text: string, kind: string): void => {
  status.value = text || '';
  statusClass.value = kind;
};

// ===== 字幕来源 =====
const subSrc = ref('__current__');
const subCountTip = ref('');
// HfSelect 选项（原为 <option v-for> + 固定 option；候选项筛选条件与原实现一致）
const subSrcGroups = computed<HfSelectGroup[]>(() => [{
  label: '',
  options: [
    { value: '__current__', label: '当前项目字幕（' + (appState.project?.subtitleCount || 0) + ' 条）' },
    ...appState.myProjects
      .filter((m) => m.name !== appState.currentName && m.hasSubtitle)
      .map((mp) => ({ value: mp.name, label: '项目「' + (mp.title || mp.name) + '」字幕（' + (mp.subtitleCount || 0) + ' 条）' }))
  ]
}]);
const countSubtitleLines = (text: string): number => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;
function syncSubCount(): void {
  if (subSrc.value === '__current__') {
    subCountTip.value = '共 ' + countSubtitleLines((appState.project && appState.project.subtitle) || '') + ' 行';
  } else {
    subCountTip.value = '';
  }
}
async function getAlignSubtitleText(): Promise<{ ok: boolean; text?: string; message?: string }> {
  const v = subSrc.value;
  if (!v) return { ok: false, message: '请选择字幕来源' };
  if (v === '__current__') {
    const t = (appState.project && appState.project.subtitle) || '';
    return t.trim() ? { ok: true, text: t } : { ok: false, message: '当前项目没有字幕，请先到「字幕生成」页生成或填写' };
  }
  const res = await window.projectTools.load(v).catch(() => null);
  const t = (res && res.subtitle) || '';
  return t.trim() ? { ok: true, text: t } : { ok: false, message: '项目「' + v + '」没有字幕' };
}

// ===== 音色 / 对齐方式 =====
const voiceId = ref('');
const alignMode = ref<'audio-driven' | 'timeline-driven'>('audio-driven');
const gap = ref('0.5');
// 「API Key 设置」：切到设置页并落在「语音服务」（与合成卡同款意图跳转）
function goSettingsVoice(): void {
  requestSettingsSection('voice');
  goPage('settings');
}
async function onRefreshVoice(): Promise<void> {
  if (await requireCfg(setStatus)) {
    await loadVoices(setStatus);
    voiceId.value = firstVoiceId();
  }
}

// ===== 进度条 =====
const barVisible = ref(false);
const barIndeterminate = ref(false);
const barPercent = ref(0);
const barText = ref('');
const barState = ref('');
// percent 数字为确定态，null/省略为不确定态；done/error 固定填满（同字幕页 showTwBar 语义）
function showAlignBar(info: { text: string; kind?: string }, indeterminate: boolean, percent?: number): void {
  barVisible.value = true;
  barIndeterminate.value = !!indeterminate;
  barState.value = info.kind === 'done' ? 'done' : info.kind === 'error' ? 'error' : '';
  const p = (typeof percent === 'number' && percent >= 0) ? percent : (info.kind === 'done' || info.kind === 'error' ? 100 : 0);
  barPercent.value = p;
  barText.value = info.text || '';
}
function hideAlignBar(): void {
  barVisible.value = false;
  barText.value = '';
}

// ===== 对齐任务 =====
const alignBusy = ref(false);
const alignResult = ref<AlignResult | null>(null);
const alignAudioEl = ref<HTMLAudioElement | null>(null);
const alignAudioSrc = ref('');
const segAudioEl = ref<HTMLAudioElement | null>(null);

const details = computed(() => (alignResult.value && alignResult.value.details) || []);
const summary = computed(() => {
  const res = alignResult.value;
  if (!res) return '';
  const ds = res.details || [];
  const accN = ds.filter((d) => d.status === 'accelerated').length;
  const pushN = ds.filter((d) => d.status === 'pushed').length;
  return '共 ' + ds.length + ' 句 · 总时长 ' + fmtTime(res.totalDur) +
    (accN ? ' · 加速 ' + accN + ' 句' : '') + (pushN ? ' · 顺延 ' + pushN + ' 句' : '') +
    (res.mode === 'audio-driven' ? ' · 字幕时间已按配音重排' : ' · 音频已按字幕时间摆放');
});

function resetAlignUi(): void {
  alignResult.value = null;
  alignAudioSrc.value = '';
}

async function startAlign(skipEnvGuard = false): Promise<void> {
  if (alignBusy.value) { toast('对齐合成进行中，请稍候'); return; }
  if (!(await requireCfg(setStatus))) return;
  const sub = await getAlignSubtitleText();
  if (!sub.ok) { setStatus(sub.message || '字幕为空', 'hf-error'); return; }
  const v = voiceId.value;
  if (!v) { setStatus('请先选择（或创建）音色', 'hf-error'); return; }
  // 逐句对齐要 ffmpeg 包（不随安装包）：缺则先问用户；点「继续」回到这里时不再弹框
  if (!skipEnvGuard) {
    const g = await envGate.guard(['ffmpeg'], '逐句对齐配音', () => { void startAlign(true); });
    if (!g.ok) return;
  }
  const mode = alignMode.value;
  const gapSec = Number(gap.value);
  const voiceModel = voiceModelOf(v);
  alignBusy.value = true;
  resetAlignUi();
  hideAlignBar();
  setStatus('正在提交逐句合成任务…', '');
  try {
    const res = await window.voiceTools.synthAligned({
      projectName: appState.currentName,
      subtitleText: sub.text,
      voice: v,
      voiceModel,
      mode,
      gapSec
    });
    if (res && res.ok) {
      alignResult.value = res as unknown as AlignResult;
      // 整轨试听走 hgpreview://…?user=1（对齐产物在 userData/voice/align-*/，见 utils/url.ts）
      alignAudioSrc.value = userPathUrl(String(res.audioPath || ''));
      showAlignBar({ text: '对齐完成：' + ((res as unknown as AlignResult).details || []).length + ' 句', kind: 'done' }, false);
      setStatus(res.message || '对齐完成', 'hf-ok');
    } else if (res && res.canceled) {
      hideAlignBar();
      setStatus((res.message) || '已取消', '');
      toast((res.message) || '已取消');
    } else {
      const fail = res as { message?: string; needPacks?: ('ffmpeg' | 'hyperframes')[] } | null;
      const msg = (fail && fail.message) || '对齐合成失败';
      showAlignBar({ text: msg, kind: 'error' }, false);
      setStatus(msg, 'hf-error');
      if (configPrompt.fromResult(fail)) {
        // 配置类（Key 无效 / 未配置…）：已弹「去设置」，不再叠 toast
      } else if (fail && fail.needPacks && fail.needPacks.length) {
        // 缺 ffmpeg：弹确认框，用户点「继续」时重发这次对齐
        void envGate.guard(fail.needPacks, '逐句对齐配音', () => { void startAlign(true); });
      } else {
        toast(msg);
      }
    }
  } catch (e) {
    const msg = String((e as Error) && (e as Error).message || e);
    showAlignBar({ text: msg, kind: 'error' }, false);
    setStatus(msg, 'hf-error');
  } finally {
    alignBusy.value = false;
  }
}

function onCancel(): void {
  window.voiceTools.cancelAlign();
  setStatus('正在取消（当前句完成后停止）…', '');
}

function playSeg(path: string): void {
  const el = segAudioEl.value;
  if (!el) return;
  const url = userPathUrl(path);   // 对齐产物在 userData/voice/align-*/ 下，走 hgpreview://…?user=1
  if (!url) { toast('这一句的试听文件不在可预览目录里'); return; }
  el.src = url;
  // 失败原因别只报"文件失效"：dev 下以前是 http 页读 file:// 被 Chromium 拒（现已改走协议），
  // 现在真正常见的是对齐任务目录已被下一次对齐清理掉。
  el.play().catch(() => toast('这一句试听失败：对齐任务目录可能已被清理，可试听整轨'));
}

function onOpenDir(): void {
  if (alignResult.value && alignResult.value.audioPath) window.projectTools.openFolderOf(alignResult.value.audioPath);
}

// 写入当前项目：覆盖字幕 + 音频设为背景音频（复用现有 save-subtitle / set-audio）
async function writeAlign(): Promise<void> {
  const last = alignResult.value;
  if (!last) { toast('暂无对齐结果'); return; }
  // [开始-结束] 毫秒精度按实测音频起止写入：结束 = 该句音频起点 + 实测时长（与成片音轨严格一致）
  const ds = last.details || [];
  const lines = ds
    .map((d) => {
      const s = Math.max(0, Number(d.subtitleStart) || 0);
      const e = s + Math.max(0, Number(d.audioDur) || 0);
      const txt = String(d.text || '').trim();
      if (!txt) return '';
      return '[' + fmtTimeMs(s) + (e > s ? '-' + fmtTimeMs(e) : '') + '] ' + txt;
    })
    .filter(Boolean);
  if (!lines.length) { toast('对齐结果为空，无法写入'); return; }
  const r1 = await window.projectTools.saveSubtitle(appState.currentName, lines.join('\n'), '');
  if (!r1 || !r1.ok) { toast((r1 as { message?: string })?.message || '字幕写回失败'); return; }
  const r2 = await window.projectTools.setAudio(appState.currentName, last.audioPath);
  if (!r2 || !r2.ok) { toast((r2 as { message?: string })?.message || '音频写回失败'); return; }
  await refreshProject();
  toast('已写入：字幕 ' + ds.length + ' 条 + 对齐配音 ' + r2.audioFile);
}

onMounted(() => {
  // 先算「当前厂家 Key 是否就绪」：没就绪时音色下拉直接禁用并给出提示
  void refreshVoiceKeyState();
  // 进度推送（preload 单订阅；切页后本页回调不再触发）
  window.voiceTools.onAlignProgress((p) => {
    if (!p) return;
    if (p.stage === 'synth' || p.stage === 'measure') {
      showAlignBar({ text: (p.message as string) || '合成中…' }, false, p.percent as number);
      setStatus((p.message as string) || '合成中…', '');
    } else if (p.stage === 'assemble') {
      showAlignBar({ text: (p.message as string) || '装配中…' }, true);
      setStatus((p.message as string) || '装配中…', '');
    } else if (p.stage === 'done') {
      showAlignBar({ text: (p.message as string) || '完成', kind: 'done' }, false);
      setStatus((p.message as string) || '完成', 'hf-ok');
    } else if (p.stage === 'error') {
      showAlignBar({ text: (p.message as string) || '失败', kind: 'error' }, false);
      setStatus((p.message as string) || '失败', 'hf-error');
    }
  });
  syncSubCount();
  void (async () => { if (await requireCfg(setStatus)) { await loadVoices(setStatus); voiceId.value = firstVoiceId(); } })();
});

// 切回本 Tab 时重拉音色列表（理由同合成卡：v-show 切换不重新挂载，新建的音色不会自动出现）
watch(activeTtsTab, async (t) => {
  if (t !== 'align') return;
  await refreshVoiceKeyState();
  if (!voiceKeyReady.value) return;
  await loadVoices(setStatus);
  if (!voiceGroups.value.some((g) => g.options.some((o) => o.value === voiceId.value))) voiceId.value = firstVoiceId();
});
</script>
