<template>
  <div>
    <div class="model-grid">
      <div v-for="m in models" :key="m.id" class="model-card" :class="{ downloaded: m.downloaded, current: m.isCurrent }">
        <div class="model-head"><span class="model-name">{{ escTxt(m.label) }}</span>
          <span v-if="m.isCurrent" class="model-badge current">当前使用</span>
          <span v-else-if="m.downloaded" class="model-badge ok">已下载</span>
          <span v-else class="model-badge">未下载</span>
        </div>
        <div class="model-meta">
          {{ escTxt(m.file) }} · {{ m.sizeMB ? '约 ' + m.sizeMB + ' MB' : '体积未知' }}<template v-if="m.speed"> · 速度{{ m.speed }}</template> · {{ m.custom ? '自定义' : '内置' }}<template v-if="m.downloaded"> · 本地占用 {{ fmtBytes(m.localBytes) }}</template><template v-if="m.downloaded && m.localFile && m.localFile !== m.file"> · 实际文件 {{ escTxt(m.localFile) }}</template>
        </div>
        <div class="model-desc">{{ escTxt(m.desc) }}</div>
        <div class="model-url">{{ escTxt(m.url) }}</div>
        <div class="model-actions">
          <button v-if="m.downloaded && !m.isCurrent" class="hf-btn" @click="actCurrent(m)">设为当前使用</button>
          <button v-if="m.downloaded" class="hf-btn" @click="actDelete(m)">删除文件</button>
          <button v-else class="hf-btn hf-btn-primary" :disabled="wmBusy !== ''" @click="actDownload(m)">下载</button>
          <button v-if="m.custom" class="hf-btn" @click="openForm(m)">编辑</button>
          <button v-if="m.custom" class="hf-btn" @click="actRemove(m)">移除</button>
        </div>
      </div>
    </div>
    <div class="whisper-tip">{{ unknownTip }}</div>
    <div class="whisper-bar-wrap" v-show="barVisible">
      <div class="whisper-bar"><div class="whisper-bar-fill" :class="barState" :style="{ width: barPercent + '%' }"></div></div>
      <div class="whisper-bar-text">{{ barText }}</div>
    </div>
    <div class="hgen-actions" style="margin-top:var(--space-4)">
      <button class="hf-btn" @click="onRefresh">刷新状态</button>
      <button class="hf-btn" @click="onOpenModels">打开模型目录</button>
      <button class="hf-btn" @click="onToggleForm">添加自定义模型</button>
    </div>
    <div class="hgen-form" v-show="formVisible">
      <div class="hgen-row">
        <label>模型名称</label>
        <input v-model="formName" class="hgen-input" placeholder="例如：我的中文模型（用于界面显示，可随时改）">
      </div>
      <div class="hgen-row">
        <label>模型文件名</label>
        <input v-model="formFile" class="hgen-input" :disabled="editId !== ''" placeholder="例如：ggml-medium-q8_0.bin（须为 ggml- 开头、.bin 结尾，登记后不可改）">
      </div>
      <div class="hgen-row">
        <label>下载地址</label>
        <input v-model="formUrl" class="hgen-input" placeholder="留空则按默认镜像 + 文件名拼接">
      </div>
      <div class="hgen-row">
        <label>体积(MB)</label>
        <input v-model="formSize" class="hgen-input" placeholder="可留空">
      </div>
      <div class="hgen-row">
        <label>说明</label>
        <input v-model="formDesc" class="hgen-input" placeholder="可留空">
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveForm">保存</button>
        <button class="hf-btn" @click="onCancelForm">取消</button>
      </div>
      <div class="hf-status" :class="formStatusClass">{{ formStatus }}</div>
    </div>
    <div class="hgen-tip">{{ storeTip }}</div>
    <div class="whisper-tip" :style="cliTipColor ? { color: cliTipColor } : {}">{{ cliTip }}</div>
    <div class="hf-status" :class="statusClass">{{ status }}</div>
  </div>
</template>

<script setup lang="ts">
// pages/settings/WhisperSection.vue —— 设置页语音识别模型（whisper.cpp）区块
// 原 pages/settings/whisper.js（window.__settings.initWhisper）移植为 SettingsPage 子组件；
// 网格按钮由事件委托改为逐卡 @click；下载进度订阅在 onMounted（preload 单订阅：切页即替换）。
import { computed, onMounted, ref } from 'vue'
import { escTxt } from '../../utils/escape'

interface WhisperModelView {
  id: string
  label: string
  sizeMB: number
  speed: string
  desc: string
  file: string
  custom: boolean
  localFile: string
  url: string
  downloaded: boolean
  localBytes: number
  isCurrent: boolean
}
interface WhisperStatusView {
  cli: { exists: boolean; path: string }
  modelsDir: string
  models: WhisperModelView[]
  unknownFiles: string[]
  usedBytes: number
}

const wmState = ref<WhisperStatusView | null>(null);
const wmBusy = ref('');
const status = ref('');
const statusClass = ref('');
// 进度条
const barVisible = ref(false);
const barPercent = ref(0);
const barText = ref('');
const barState = ref('');
// 自定义模型表单
const formVisible = ref(false);
const editId = ref('');
const formName = ref('');
const formFile = ref('');
const formUrl = ref('');
const formSize = ref('');
const formDesc = ref('');
const formStatus = ref('');
const formStatusClass = ref('');

const models = computed(() => (wmState.value && wmState.value.models) || []);
const storeTip = computed(() => (wmState.value ? '存储位置：' + wmState.value.modelsDir + '　已用空间：' + fmtBytes(wmState.value.usedBytes) : ''));
const unknownTip = computed(() => {
  const unk = (wmState.value && wmState.value.unknownFiles) || [];
  return unk.length
    ? '发现 ' + unk.length + ' 个未登记的模型文件（不在枚举内，暂时无法用于转录）：' + unk.join('、') + '。可点上方「添加自定义模型」按文件名登记后启用。'
    : '';
});
const cliTip = computed(() => {
  const cli = wmState.value && wmState.value.cli;
  if (cli && cli.exists) return 'whisper-cli.exe：已就绪（' + cli.path + '）';
  return '未检测到 whisper-cli.exe：请从 whisper.cpp 官方 Releases 下载 windows-x64 包，取出 whisper-cli.exe 放到 ' + ((cli && cli.path) || 'resources/whisper/whisper-cli.exe') + '（可点「打开模型目录」旁的位置手动放置）。缺少该文件时无法转录。';
});
const cliTipColor = computed(() => {
  const cli = wmState.value && wmState.value.cli;
  return cli && cli.exists ? '' : 'rgba(255, 176, 32, 0.9)';
});

function fmtBytes(n: number | string): string {
  const v = Number(n) || 0;
  if (v >= 1073741824) return (v / 1073741824).toFixed(2) + ' GB';
  if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
  return v + ' B';
}
function setStatus(text: string, kind: string): void {
  status.value = text || '';
  statusClass.value = kind;
}
function showBar(percent: number, text: string, state: string): void {
  barVisible.value = true;
  barPercent.value = Math.max(0, Math.min(100, Number(percent) || 0));
  barText.value = text || '';
  barState.value = state;
}

async function refreshWm(): Promise<void> {
  const s = await window.whisperTools.status().catch(() => null);
  if (!s || !s.ok) { setStatus('读取识别模型状态失败，请重试', 'hf-error'); return; }
  wmState.value = s as unknown as WhisperStatusView;
}

// ===== 网格操作 =====
async function actDownload(m: WhisperModelView): Promise<void> {
  if (wmBusy.value) { setStatus('已有下载任务进行中，请稍候', 'hf-error'); return; }
  wmBusy.value = m.id;
  setStatus('开始下载「' + m.id + '」…模型体积较大，请保持网络畅通', '');
  showBar(0, '正在连接下载源（hf-mirror.com）…', '');
  const res = await window.whisperTools.download(m.id);
  if (!res || !res.ok) {
    showBar(100, (res as { message?: string })?.message || '下载失败', 'error');
    setStatus((res as { message?: string })?.message || '下载失败', 'hf-error');
  } else if ((res as { message?: string }).message) {
    setStatus((res as { message?: string }).message as string, 'hf-ok');
  }
  wmBusy.value = '';
  refreshWm();
}
async function actDelete(m: WhisperModelView): Promise<void> {
  const res = await window.whisperTools.delete(m.id);
  if (res && res.ok) {
    setStatus('已删除模型「' + m.id + '」（如需再用可重新下载）', 'hf-ok');
  } else {
    setStatus((res as { message?: string })?.message || '删除失败', 'hf-error');
  }
  refreshWm();
}
async function actCurrent(m: WhisperModelView): Promise<void> {
  const res = await window.whisperTools.setCurrent(m.id);
  setStatus(res && res.ok ? '已将「' + m.id + '」设为字幕转录使用的模型' : ((res as { message?: string })?.message || '设置失败'), res && res.ok ? 'hf-ok' : 'hf-error');
  refreshWm();
}
async function actRemove(m: WhisperModelView): Promise<void> {
  const res = await window.whisperTools.removeModel({ id: m.id });
  setStatus((res as { message?: string })?.message || (res && res.ok ? '已移除' : '移除失败'), res && res.ok ? 'hf-ok' : 'hf-error');
  refreshWm();
}

// ===== 自定义模型表单（添加 / 编辑；文件名与 id 登记后不可改） =====
function openForm(model: WhisperModelView | null): void {
  editId.value = model ? model.id : '';
  formName.value = model ? (model.label || '') : '';
  formFile.value = model ? (model.file || '') : '';
  formUrl.value = model ? (model.url || '') : '';
  formSize.value = model && model.sizeMB ? String(model.sizeMB) : '';
  formDesc.value = model ? (model.desc || '') : '';
  formVisible.value = true;
  formStatus.value = model ? ('正在编辑「' + model.label + '」：文件名不可改，其余可改') : '填写后点「保存」登记；登记成功后即可像内置模型一样下载与使用';
  formStatusClass.value = '';
}
function onToggleForm(): void {
  if (formVisible.value) { formVisible.value = false; editId.value = ''; }
  else openForm(null);
}
function onCancelForm(): void {
  formVisible.value = false;
  editId.value = '';
  formStatus.value = '';
  formStatusClass.value = '';
}
async function onSaveForm(): Promise<void> {
  const payload = {
    name: formName.value.trim(),
    file: formFile.value.trim(),
    url: formUrl.value.trim(),
    sizeMB: formSize.value.trim(),
    desc: formDesc.value.trim()
  };
  if (!payload.name) { formStatus.value = '请填写模型名称'; formStatusClass.value = 'hf-error'; return; }
  if (!editId.value && !payload.file) { formStatus.value = '请填写模型文件名（ggml- 开头的 .bin 文件）'; formStatusClass.value = 'hf-error'; return; }
  const res = editId.value
    ? await window.whisperTools.updateModel(Object.assign({ id: editId.value }, payload))
    : await window.whisperTools.addModel(payload);
  if (res && res.ok) {
    formStatus.value = (res as { message?: string }).message || '已保存';
    formStatusClass.value = 'hf-ok';
    formVisible.value = false;
    editId.value = '';
    setStatus((res as { message?: string }).message || '已保存', 'hf-ok');
    refreshWm();
  } else {
    formStatus.value = (res as { message?: string })?.message || '保存失败';
    formStatusClass.value = 'hf-error';
  }
}

function onRefresh(): void {
  setStatus('', '');
  refreshWm();
}
async function onOpenModels(): Promise<void> {
  const res = await window.whisperTools.openDir('models');
  if (!res || !res.ok) setStatus((res as { message?: string })?.message || '打开目录失败', 'hf-error');
}

onMounted(() => {
  // 下载进度（preload 单订阅：切到设置页时本页回调生效）
  window.whisperTools.onProgress((p) => {
    if (!p) return;
    if (p.stage === 'downloading') {
      wmBusy.value = (p.id as string) || wmBusy.value;
      const sizeTxt = p.totalBytes ? '（' + fmtBytes(p.receivedBytes as number) + ' / ' + fmtBytes(p.totalBytes as number) + '）' : '';
      showBar((p.percent as number) || 0, ((p.message as string) || '下载中') + sizeTxt, '');
    } else if (p.stage === 'done') {
      showBar(100, (p.message as string) || '下载完成', 'done');
      setStatus('模型下载完成，点「设为当前使用」即可用于字幕转录', 'hf-ok');
      wmBusy.value = '';
      refreshWm();
    } else if (p.stage === 'error') {
      showBar(100, (p.message as string) || '下载失败', 'error');
      setStatus((p.message as string) || '下载失败', 'hf-error');
      wmBusy.value = '';
      refreshWm();
    }
  });
  setStatus('', '');
  refreshWm();
});
</script>
