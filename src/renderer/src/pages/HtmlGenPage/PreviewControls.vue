<template>
  <!-- pages/HtmlGenPage/PreviewControls.vue —— 右侧栏常驻「预览」分组里的控件
       背景音频 / 语速 / 视角比例从 PreviewSection.vue 整块搬来：画面留在左主区，控件集中到右边。
       视角相关的共享状态走 composables/usePreviewView.ts；改完背景音频由 requestPreviewReload() 通知画面重载。 -->
  <div class="hgen-preview-controls">
    <!-- part 指定时只渲染对应半边：右侧栏「背景音频」块要 下拉+语速，「其他」块只要视角比例 -->
    <template v-if="showAudio">
    <!-- 背景音频：不经过 Agent，选定后由主进程注入 HTML 的 <audio>（不进生成提示词）。
         当前音频就是「已生成音频」里的选中项，清空走「不使用背景音频」那一项，没有独立的移除按钮。 -->
    <div class="hgen-row">
      <span class="sel-label" style="flex:none;width:56px">背景音频</span>
      <HfSelect
        v-model="audioPick"
        :groups="audioSelGroups"
        style="flex:1;min-width:0"
        :title="audioFile ? '当前背景音频：' + audioFile + '（由应用注入 HTML，不进生成提示词）' : '还没有背景音频：可选「已生成音频」或本地文件；音轨由应用注入 HTML，不进生成提示词'"
        @change="onAudioPick"
      />
    </div>
    <!-- 试听条：自绘播放器（进度 + 当前/总秒数），语速单独一行，不再挤在原生 controls 旁边 -->
    <div v-show="audioPreviewVisible" style="margin:8px 0">
      <AudioPlayer :src="audioSrc" />
    </div>
    </template>
    <template v-if="showView">
    <!-- 视角比例：只影响观看，成片仍是真实分辨率。气泡向上 + 向左展开（右侧栏只有 300px，向右会被裁） -->
    <div class="hgen-row" style="margin-bottom:0">
      <label class="sel-label" style="flex:none;width:56px">视角比例</label>
      <HfSelect :model-value="viewMode" :groups="VIEW_MODE_GROUPS" style="width:110px;flex:none" title="预览按哪种比例显示；只影响观看，成片仍是真实分辨率" @change="onViewModeChange" />
      <span class="hg-help" @click.stop>
        <span class="hg-help-icon">?</span>
        <span class="hg-help-pop" style="right:0;left:auto;max-width:240px">预览只按<b>比例</b>缩放显示（等比 contain + 居中），像素由成片保证——成片才是真实分辨率。切到别的比例＝「把这条片子放进那种形状的屏幕里看」，多出来的地方就是黑边，<b>不影响成片</b>；页面仍按它自己声明的画布渲染，所以版式不会被裁。</span>
      </span>
    </div>
    <div v-if="viewHint" class="hgen-tip" style="margin:6px 0 0">{{ viewHint }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { RenderCanvas } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { previewUrl } from '@renderer/utils/url'
import { pageBox, pageDeclared, pageMode, requestPreviewReload, viewBox, viewMode } from '@renderer/composables/usePreviewView'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import AudioPlayer from './AudioPlayer.vue'

// 右侧栏把预览控件拆到两个竖排块：'audio' = 背景音频 + 语速，'view' = 视角比例；不传 = 两块都显示
const props = defineProps<{ part?: 'audio' | 'view' }>();
const showAudio = computed(() => !props.part || props.part === 'audio');
const showView = computed(() => !props.part || props.part === 'view');

// ===== 背景音频 =====
const NONE_AUDIO = '__none__';
// 下拉的选中值：「已生成音频」的下标字符串；'' = 没有对得上的项（未设置，或当前音频来自本地文件 / 视频原声）
const audioPick = ref('');
const audioFile = computed(() => (appState.project && appState.project.audioFile) || '');
const audioSrc = ref('');
const audioPreviewVisible = ref(false);

// 试听走 hgpreview://（dev 下 http 页读不了 file://）+ 时间戳避免缓存
function setAudioPreview(relFile: string): void {
  if (relFile) {
    audioSrc.value = previewUrl(appState.currentName, relFile, true);
    audioPreviewVisible.value = true;
  } else {
    audioSrc.value = '';
    audioPreviewVisible.value = false;
  }
}

// 设 / 换 / 移除背景音频的统一收尾：刷新项目 → 更新试听源 → 重载预览 iframe
// （主进程在 setAudio / clearAudio 里同步改写了 index.html 的音轨，必须重载才听得到）
async function afterAudioChange(tip: string, relFile: string): Promise<void> {
  await refreshProject();
  setAudioPreview(relFile);
  await requestPreviewReload();
  toast(tip);
}

async function onPickAudioFile(): Promise<void> {
  const picked = await window.projectTools.pickAudio();
  if (!picked) return;
  const res = await window.projectTools.setAudio(appState.currentName, picked);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置音频失败'); return; }
  await afterAudioChange('已设为背景音频：' + res.audioFile, res.audioFile || '');
}

// 下拉 = 列表 + 动作：当前音频直接在「已生成音频」里显示为选中项，选任何一项即生效，清空走「不使用背景音频」
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

interface GenAudioItem { path: string; name: string; group: string; size: number; mtime: number }
const genAudios = ref<GenAudioItem[]>([]);

// 把项目里的背景音轨对回「已生成音频」里的一条：主进程复制进项目时保留原文件名（重名才补 _N 后缀）
function audioBaseName(p: string): string {
  return (p || '').split(/[\\/]/).pop() || '';
}
const currentAudioIndex = computed(() => {
  const save = audioBaseName(audioFile.value);
  if (!save) return -1;
  const norm = (s: string) => s.replace(/_\d+(?=\.[^.]+$)/, '');
  return genAudios.value.findIndex((it) => norm(audioBaseName(it.path)) === norm(save));
});
// 当前音频变了（选中 / 清空 / 换项目 / 列表刚加载完）就把下拉的选中态同步过去——选中态的唯一来源
watch([currentAudioIndex, genAudios], () => {
  audioPick.value = currentAudioIndex.value >= 0 ? String(currentAudioIndex.value) : '';
}, { immediate: true });

// 只有对不上列表的值（本地文件 / 提取的原声）才用一个同名项把值显示出来；有音频时另有「不使用背景音频」用于清空
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

// ===== 视角比例（只影响观看，不改变成片）=====
// 刻意不设「跟随画布」这类选项：默认值就是页面比例，切画布 / 换页面时自动归位（联动在 PreviewSection 里）
const VIEW_MODE_OPTIONS: { value: RenderCanvas; label: string }[] = [
  { value: 'landscape', label: '16:9' },
  { value: 'portrait', label: '9:16' },
  { value: 'square', label: '1:1' }
];
const VIEW_MODE_GROUPS: HfSelectGroup[] = [{ label: '', options: VIEW_MODE_OPTIONS }];
// viewMode 是从 composable import 的共享 ref：不走 v-model（import 绑定的可写性交给编译器判断），
// 改为显式 @change 写回，值只可能来自上面三个合法选项。
function onViewModeChange(v: string): void {
  viewMode.value = v as RenderCanvas;
}
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

onMounted(() => {
  // 只渲染视角比例时不必拉「已生成音频」列表，也不必初始化试听源
  if (!showAudio.value) return;
  // 切页回来时试听源要按项目现有的背景音频初始化，否则那一行试听会整块消失（用户实测过）
  setAudioPreview(audioFile.value);
  genLoad();
});
</script>
