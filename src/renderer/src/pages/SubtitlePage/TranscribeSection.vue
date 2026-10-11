<template>
  <div class="hf-modal-mask" v-show="maskVisible" @click.self="closeTw">
    <div class="hf-modal">
      <div class="hf-modal-head">
        <span class="hf-modal-title">从音频生成字幕</span>
        <button class="hf-modal-close" title="关闭" @click="closeTw">×</button>
      </div>
      <div class="hf-modal-body">
        <div class="panel-title-sm" style="margin-top:0">① 选择音频</div>
        <div class="hgen-row">
          <label class="hgen-check"><input type="radio" value="project" v-model="srcMode" /> 使用项目音频</label>
          <label class="hgen-check"><input type="radio" value="file" v-model="srcMode" /> 浏览本地文件</label>
        </div>
        <div class="hgen-row">
          <input v-model="audioInput" class="hgen-input" style="flex:1" readonly :title="audioInput" placeholder="项目音频（可在「配音」页生成 / 选择）" />
          <button class="hf-btn" :disabled="srcMode !== 'file'" @click="onPick">选择音频</button>
        </div>
        <div class="whisper-tip" v-show="audioHint !== ''">{{ audioHint }}</div>

        <div class="panel-title-sm">② 识别模型</div>
        <div class="hgen-row">
          <span class="sel-label">当前识别模型</span>
          <span class="tw-model" :style="modelColor ? { color: modelColor } : {}">{{ modelText }}</span>
          <a class="tw-link" @click="onManage">管理模型</a>
        </div>
        <div class="whisper-tip" :style="modelHintColor ? { color: modelHintColor } : {}">{{ modelHint }}</div>
        <div class="hgen-row" style="margin-top:var(--space-3)">
          <label class="sel-label">识别语言</label>
          <HfSelect v-model="lang" :groups="langGroups" />
        </div>

        <div class="whisper-bar-wrap" v-show="barVisible">
          <div class="whisper-bar" :class="{ indeterminate: barIndeterminate }"><div class="whisper-bar-fill" :class="barState" :style="{ width: barPercent + '%' }"></div></div>
          <div class="whisper-bar-text">{{ barText }}</div>
        </div>
        <div class="hf-status" :class="statusClass" style="margin-top:var(--space-3)">{{ status }}</div>
      </div>
      <div class="hf-modal-foot" v-show="!applyMode">
        <button class="hf-btn" @click="closeTw">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="startDisabled" @click="doTranscribe">{{ startText }}</button>
      </div>
      <div class="hf-modal-foot" v-show="applyMode">
        <button class="hf-btn" @click="applyTranscript('replace')">替换现有</button>
        <button class="hf-btn hf-btn-primary" @click="applyTranscript('append')">追加到末尾</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/SubtitlePage/TranscribeSection.vue —— 转录弹窗（原 JS 版 subtitle 模块 transcribe.js 移植）
// ctx 共享改显式 props（pageCtx）；ESC 关闭改为 onMounted/onBeforeUnmount 成对（原 escHandler 重绑 guard 删除）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appState } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { goPage } from '@renderer/pages'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import { estDur, type SubtitleItem } from './helpers'

const props = defineProps<{
  pageCtx: {
    getItems: () => SubtitleItem[]
    setItems: (v: SubtitleItem[]) => void
    isTextMode: () => boolean
    syncTextArea: () => void
    saveToProject: (options?: { silent?: boolean }) => Promise<boolean>
    estDur: (t: string) => number
  }
}>();

const maskVisible = ref(false);
const srcMode = ref<'project' | 'file'>('project');
const audioInput = ref('');
const audioHint = ref('');
const lang = ref('auto');
// HfSelect 选项（原为 4 个固定 <option>）
const langGroups: HfSelectGroup[] = [{
  label: '',
  options: [
    { value: 'auto', label: '自动检测' },
    { value: 'zh', label: '中文（简体）' },
    { value: 'zh-hant', label: '中文（繁体）' },
    { value: 'en', label: 'English' }
  ]
}];
const status = ref('');
const statusClass = ref('');
const transcribing = ref(false);
const applyMode = ref(false);
let pendingResult: { segments: { start: number; end: number; text: string }[] } | null = null;
const twModel = ref<{ id: string; label: string; downloaded: boolean; fallback?: boolean }>({ id: '', label: '', downloaded: false });

// 进度条
const barVisible = ref(false);
const barIndeterminate = ref(false);
const barPercent = ref(0);
const barText = ref('');
const barState = ref('');

const modelText = computed(() => {
  const m = twModel.value;
  if (!m.id) return '未选择识别模型';
  if (!m.downloaded) return m.label + '（已选但未下载）';
  return m.label + (m.fallback ? '（已下载，尚未设为当前使用）' : '（已就绪）');
});
const modelColor = computed(() => {
  const m = twModel.value;
  return (!m.id || !m.downloaded) ? 'var(--color-warning)' : '';
});
const modelHint = computed(() => {
  const m = twModel.value;
  return m.id && m.downloaded
    ? '转录在本机 CPU 完成，不消耗 API 额度。'
    : (!m.id
      ? '当前没有可用的识别模型：请到「设置 → 语音识别模型」下载并设为当前使用后再转录。'
      : '当前识别模型尚未下载完成：请到「设置 → 语音识别模型」下载「' + m.label + '」。');
});
const modelHintColor = computed(() => {
  const m = twModel.value;
  return m.id && m.downloaded ? '' : 'rgba(255, 176, 32, 0.9)';
});
const startDisabled = computed(() => transcribing.value || !audioInput.value || !(twModel.value.id && twModel.value.downloaded));
const startText = computed(() => (transcribing.value ? '转录中…' : '开始转录'));

function setTwStatus(msg: string, kind: string): void {
  status.value = msg || '';
  statusClass.value = kind;
}
// percent：null/省略为不确定态；done/error 固定填满
function showTwBar(msg: string | { text?: string; kind?: string }, indeterminate: boolean, percent?: number): void {
  const info = (msg && typeof msg === 'object') ? msg : { text: String(msg || ''), kind: '' };
  barVisible.value = true;
  barIndeterminate.value = !!indeterminate;
  barState.value = info.kind === 'done' ? 'done' : info.kind === 'error' ? 'error' : '';
  const p = (typeof percent === 'number' && percent >= 0) ? percent : (info.kind === 'done' || info.kind === 'error' ? 100 : 0);
  barPercent.value = p;
  barText.value = info.text || '';
}
function hideTwBar(): void {
  barVisible.value = false;
  barText.value = '';
}

async function loadTwModel(): Promise<void> {
  const st = await window.whisperTools.status().catch(() => null);
  if (!st) { twModel.value = { id: '', label: '', downloaded: false }; }
  else {
    const list = st.models || [];
    let cur = list.find((m) => m.isCurrent) || list.find((m) => m.id === st.currentModelId);
    let fallback = false;
    if (!cur) {
      cur = list.find((m) => m.downloaded);
      fallback = !!cur;
    }
    twModel.value = cur ? { id: cur.id, label: cur.label, downloaded: !!cur.downloaded, fallback } : { id: '', label: '', downloaded: false };
    if (st.langs && st.langs.length) {
      // 语言选项来自主进程枚举（固定 auto/zh/zh-hant/en，模板已静态列出，保持默认 auto）
      lang.value = 'auto';
    }
  }
}

async function loadProjectAudio(): Promise<{ ok: boolean; path?: string; message?: string }> {
  const name = appState.currentName;
  const res = await window.whisperTools.projectAudio(name).catch(() => null);
  if (res && res.ok) {
    audioInput.value = res.path;
    updateAudioHint();
    return { ok: true, path: res.path };
  }
  audioInput.value = '';
  updateAudioHint();
  return { ok: false, message: (res as { message?: string })?.message || '读取项目音频失败' };
}

// 音频格式提示：whisper-cli 自带解码器仅支持 wav/mp3/flac/ogg，
// 其余格式（mp4/m4a/aac 等）主进程会在转录前用内置 ffmpeg 自动转换，这里提前告知用户
const TW_DIRECT_EXTS = ['wav', 'mp3', 'flac', 'ogg'];
function updateAudioHint(): void {
  const p = audioInput.value || '';
  const ext = p.lastIndexOf('.') >= 0 ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!ext || TW_DIRECT_EXTS.indexOf(ext) >= 0) {
    audioHint.value = '';
    return;
  }
  audioHint.value = '「' + ext.toUpperCase() + '」格式不支持直接转录，开始后会先自动提取音频并转为 16kHz WAV 再识别（多几秒，原文件不受影响）。';
}

// 打开弹窗（由父组件 openTranscribe 触发，经 watch 联动）
watch(maskVisible, (v) => {
  if (v) void openInit();
});
async function openInit(): Promise<void> {
  // 清空上一轮残留状态（避免旧状态/旧结果误显）
  setTwStatus('', '');
  hideTwBar();
  applyMode.value = false;
  audioInput.value = '';
  srcMode.value = 'project';
  pendingResult = null;
  updateAudioHint();
  await loadTwModel();
  const a = await loadProjectAudio();
  if (a.ok) setTwStatus('已载入项目音频：' + (a.path || ''), '');
  else setTwStatus((a.message || '') + '（可切换为「浏览本地文件」）', 'hf-error');
}

function closeTw(): void {
  maskVisible.value = false;
  hideTwBar();
  setTwStatus('', '');
  applyMode.value = false;
}

async function doTranscribe(): Promise<void> {
  if (transcribing.value) return;
  const audioPath = audioInput.value;
  if (!audioPath) { setTwStatus('请先选择要转录的音频', 'hf-error'); return; }
  if (!(twModel.value.id && twModel.value.downloaded)) { setTwStatus('识别模型不可用，请先到设置页下载并设为当前使用', 'hf-error'); return; }
  transcribing.value = true;
  pendingResult = null;
  applyMode.value = false;
  setTwStatus('正在加载模型（' + twModel.value.label + '）…', '');
  showTwBar({ text: '正在加载模型（' + twModel.value.label + '）…' }, true);
  try {
    const res = await window.whisperTools.transcribe({
      id: twModel.value.id,
      audioPath,
      language: lang.value
    });
    if (!res || !res.ok) {
      showTwBar({ text: (res as { message?: string })?.message || '转录失败', kind: 'error' }, false);
      setTwStatus((res as { message?: string })?.message || '转录失败', 'hf-error');
      return;
    }
    pendingResult = { segments: res.segments || [] };
    const n = (res.segments || []).length;
    showTwBar({ text: '转录完成：' + n + ' 条字幕（模型 ' + (res.model || twModel.value.label) + '）', kind: 'done' }, false);
    setTwStatus('转录完成。请选择回填方式：替换现有字幕，或追加到现有字幕末尾。', 'hf-ok');
    applyMode.value = true;
  } catch (e) {
    const msg = String((e as Error) && (e as Error).message || e);
    showTwBar({ text: msg, kind: 'error' }, false);
    setTwStatus(msg, 'hf-error');
  } finally {
    transcribing.value = false;
  }
}

function applyTranscript(mode: 'replace' | 'append'): void {
  if (!pendingResult || !pendingResult.segments || !pendingResult.segments.length) {
    toast('没有可回填的转录结果');
    return;
  }
  const segs = pendingResult.segments
    .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text || '').trim() }))
    .filter((s) => s.text);
  if (!segs.length) { toast('转录结果中没有有效文本'); return; }
  let next: SubtitleItem[];
  if (mode === 'replace') {
    next = segs;
  } else {
    const cur = props.pageCtx.getItems();
    let base = 0;
    if (cur.length) {
      const last = cur[cur.length - 1];
      base = (last.end === null || last.end === undefined || !isFinite(Number(last.end)) || Number(last.end) <= Number(last.start))
        ? (Number(last.start) || 0) + estDur(last.text)
        : Number(last.end);
    }
    next = cur.concat(segs.map((s) => ({ start: s.start + base, end: s.end + base, text: s.text })));
  }
  next.forEach((it) => {
    it.start = Math.max(0, Number(it.start) || 0);
    it.end = Math.max(it.start, Number(it.end) || 0) || it.start + estDur(it.text);
  });
  props.pageCtx.setItems(next);
  if (props.pageCtx.isTextMode()) props.pageCtx.syncTextArea();
  closeTw();
  toast(mode === 'replace' ? '已用转录结果替换字幕：共 ' + segs.length + ' 条' : '已在字幕末尾追加 ' + segs.length + ' 条');
  // 回填即落盘，避免用户忘记保存（保存失败时给出提示，条目仍保留在编辑器中）
  props.pageCtx.saveToProject({ silent: true }).then((ok) => {
    if (!ok) setTwStatus('转录结果已回填，但自动保存失败，请点「保存到项目」重试', 'hf-error');
    else setTwStatus('转录结果已回填并保存到项目「' + appState.currentName + '」', 'hf-ok');
  });
}

async function onPick(): Promise<void> {
  const p = await window.whisperTools.pickAudio().catch(() => null);
  if (!p) return;
  audioInput.value = p;
  updateAudioHint();
  setTwStatus('已选择音频：' + p, '');
}
function onManage(): void {
  closeTw();
  goPage('settings');
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && maskVisible.value) closeTw();
}

watch(srcMode, (m) => {
  if (m === 'project') {
    hideTwBar();
    void (async () => {
      const a = await loadProjectAudio();
      if (a.ok) setTwStatus('已载入项目音频：' + (a.path || ''), '');
      else setTwStatus((a.message || '') + '（可切换为「浏览本地文件」）', 'hf-error');
    })();
  } else {
    hideTwBar();
    setTwStatus('请选择要转录的本地音频文件', '');
    audioInput.value = '';
    updateAudioHint();
  }
});

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  // 转录进度（preload 为单订阅，重复注册仅替换回调；切页后本页回调不再触发）
  window.whisperTools.onProgress((payload) => {
    if (!payload || !maskVisible.value) return;
    if (payload.stage === 'loading') {
      // 模型加载阶段：不确定态进度条
      showTwBar({ text: (payload.message as string) || '正在加载模型…' }, true);
      setTwStatus((payload.message as string) || '正在加载模型…', '');
    } else if (payload.stage === 'transcribing') {
      // 转录阶段：按 whisper-cli 回推的百分比填充进度条
      const pct = (typeof payload.percent === 'number' && payload.percent >= 0) ? payload.percent : null;
      showTwBar({ text: (payload.message as string) || '转录中…' }, pct === null, pct === null ? 0 : pct);
      setTwStatus((payload.message as string) || '转录中…', '');
    }
  });
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});

// 供父组件打开弹窗（父组件直接控制 maskVisible 亦可；这里暴露打开入口）
defineExpose({
  open: () => {
    maskVisible.value = true;
  }
});

// 注意：openTranscribe 在父组件通过 ref 调用本组件 open()
</script>
