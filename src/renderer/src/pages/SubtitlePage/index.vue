<template>
  <div>
    <StepBar :page="'subtitle'" />
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>字幕编辑器</div>
      <div class="hgen-tip">逐条编辑字幕：序号 / 起始时间 / 结束时间 / 文本，可删除与新增；也可切「SRT」模式用单个文本域按标准 SRT 格式编辑（序号 / 时间轴 / 文本）。还可由音频自动识别，或由内容脚本旁白生成初稿。字幕时间轴以下方的「起始时间」为准。</div>
      <div class="hgen-actions" style="margin-top:var(--space-4)">
        <button class="hf-btn hf-btn-primary" @click="openTranscribe">从音频生成字幕</button>
        <button class="hf-btn" title="依据内容脚本的场景旁白与时长提示生成逐条字幕，覆盖当前条目" @click="fromContent">由脚本旁白生成</button>
      </div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>字幕条目</div>
      <div class="hgen-row" style="margin-top:var(--space-3)">
        <span class="sel-label">写入方式</span>
        <button class="hf-btn sub-mode-btn" :class="{ active: !textMode }" @click="setMode(false)">逐条编辑</button>
        <button class="hf-btn sub-mode-btn" :class="{ active: textMode }" @click="setMode(true)">SRT</button>
      </div>
      <div class="sub-list" ref="listEl" v-show="!textMode">
        <div v-if="!items.length" class="sub-empty">暂无字幕条目。可点「新增条目」手工添加，或用上方「从音频生成字幕」「由脚本旁白生成」自动生成。</div>
        <div v-for="(it, i) in items" :key="i" class="sub-row">
          <div class="sub-idx">{{ i + 1 }}</div>
          <input class="sub-time" :value="fmtTimeTrim(it.start)" title="起始时间（分:秒，可带小数=毫秒），字幕时间轴以此为准" @change="onTimeChange(i, 'start', $event)" />
          <span class="sub-arrow">→</span>
          <input class="sub-time" :value="it.end === null || !isFinite(Number(it.end)) ? '' : fmtTimeTrim(it.end)" title="结束时间（分:秒，可带小数=毫秒），编辑参考用" @change="onTimeChange(i, 'end', $event)" />
          <textarea v-model="it.text" class="sub-text" spellcheck="false" placeholder="该条字幕文本" @input="onTextInput(i)"></textarea>
          <button class="sub-del" title="删除该条" @click="removeItem(i)">删除</button>
        </div>
      </div>
      <textarea v-model="srtText" class="sub-textarea" v-show="textMode" rows="14" spellcheck="false" placeholder="SRT 模式：单文本域按 SRT 字幕格式编辑，块间用空行分隔，例如：
1
00:00:00,400 --> 00:00:02,000
第一行字幕

2
00:00:02,000 --> 00:00:04,000
第二行字幕

也可直接粘贴纯文本，每行一条，自动估时。"></textarea>
      <div class="hgen-actions" style="margin-top:var(--space-3)" v-show="!textMode">
        <button class="hf-btn" @click="addItem">新增条目</button>
        <button class="hf-btn" title="滚动到第一条字幕" @click="scrollTop">↑ 到顶部</button>
        <button class="hf-btn" title="滚动到最后一条字幕" @click="scrollBottom">↓ 到底部</button>
        <span class="sub-count">{{ countTip }}</span>
      </div>
      <div class="hgen-row" style="margin-top:var(--space-4)">
        <label class="sel-label">页面标题</label>
        <input v-model="title" class="hgen-input" style="flex:1" placeholder="字幕动画标题，如：我的第一个字幕动画" />
      </div>
      <div class="hgen-actions">
        <button class="hf-btn" title="复制全部字幕文本（不含时间线）" @click="copySubtitles">复制字幕</button>
        <button class="hf-btn" title="把当前字幕导出为 .srt 字幕文件（含时间轴）" @click="exportSrtFile">导出 SRT 文件</button>
        <button class="hf-btn hf-btn-primary" @click="saveToProject({})">保存到项目</button>
      </div>
      <div class="hf-status" :style="statusColor ? { color: statusColor } : {}">{{ status }}</div>
      <div class="sub-note">时间格式：<code>分:秒</code>（如 <code>00:05</code>），也可填 <code>00:05.500</code> 精确到毫秒；保存时以起始时间写入 <code>[分:秒] 文本</code>，供 HTML / 视频阶段对齐时间轴。「导出 SRT 文件」可生成标准 <code>.srt</code> 字幕（含时间轴）供外部播放器 / 剪辑软件使用。</div>
    </div>
    <TranscribeSection ref="transcribeEl" :page-ctx="pageCtx" />
  </div>
</template>

<script setup lang="ts">
// pages/SubtitlePage/index.vue —— 字幕页条目编辑器（原 JS 版 subtitle 模块 index.js 移植）
// 转录弹窗为子组件 TranscribeSection（原 window.__sub.initTranscribe，ctx 模式改显式 props）。
import { computed, nextTick, onMounted, ref } from 'vue'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { fmtTime } from '@renderer/utils/time'
import {
  estDur, fillEnds, fmtTimeTrim, itemsToSrt, parseSrtText, parseSubtitleText,
  parseTime, plainText, serializeItems, type SubtitleItem
} from './helpers'
import StepBar from '@renderer/components/StepBar.vue'
import TranscribeSection from './TranscribeSection.vue'

// ===== 条目状态 =====
const items = ref<SubtitleItem[]>([]);
const textMode = ref(false);
const srtText = ref('');
const title = ref('');
const status = ref('');
const statusColor = ref('');
const listEl = ref<HTMLElement | null>(null);
const transcribeEl = ref<InstanceType<typeof TranscribeSection> | null>(null);

function setStatus(msg: string, color?: string): void {
  status.value = msg || '';
  statusColor.value = color || '';
}

const countTip = computed(() => {
  const valid = items.value.filter((it) => String(it.text || '').trim()).length;
  if (!valid) return '';
  const last = items.value[items.value.length - 1];
  const total = Number(last && last.end) || 0;
  return '共 ' + valid + ' 条 · 总时长约 ' + fmtTime(total);
});

// ===== 条目交互 =====
function onTextInput(i: number): void {
  const it = items.value[i];
  if (!it) return;
  // 末条结束时间随文本估时长更新
  if (i === items.value.length - 1 && (!isFinite(Number(it.end)) || Number(it.end) <= Number(it.start))) {
    it.end = Number(it.start) + estDur(it.text);
  }
}
function onTimeChange(i: number, f: 'start' | 'end', ev: Event): void {
  const el = ev.target as HTMLInputElement;
  const it = items.value[i];
  if (!it) return;
  const v = parseTime(el.value);
  if (v === null) {
    el.value = (it[f] === null || it[f] === undefined || !isFinite(Number(it[f]))) ? '' : fmtTimeTrim(Number(it[f]));
    setStatus('时间格式无法识别（请用 分:秒，如 00:12 或 00:12.5），已保留原值', 'var(--color-warning)');
    return;
  }
  setStatus('', '');
  it[f] = v;
  if (f === 'start' && !(Number(it.end) > v)) it.end = v + estDur(it.text);
}
function removeItem(i: number): void {
  if (!items.value[i]) return;
  items.value.splice(i, 1);
  fillEnds(items.value);
  toast('已删除第 ' + (i + 1) + ' 条（点「保存到项目」生效）');
}
function itemStartAfter(last: SubtitleItem | undefined): number {
  if (!last) return 0;
  const end = Number(last.end);
  if (isFinite(end) && end > Number(last.start)) return end;
  return (Number(last.start) || 0) + estDur(last.text);
}
async function addItem(): Promise<void> {
  const last = items.value[items.value.length - 1];
  const start = itemStartAfter(last);
  items.value.push({ start, end: start + 2.4, text: '' });
  await nextTick();
  const rows = listEl.value?.querySelectorAll('.sub-row .sub-text');
  const el = rows && rows[rows.length - 1] as HTMLTextAreaElement | null;
  if (el) el.focus();
}
function scrollTop(): void {
  if (listEl.value) listEl.value.scrollTop = 0;
}
function scrollBottom(): void {
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

// ===== 写入方式切换 =====
function setMode(tm: boolean): void {
  if (tm === textMode.value) return;
  if (textMode.value) applyTextMode();
  textMode.value = tm;
  if (tm) {
    srtText.value = itemsToSrt(items.value);
    setStatus('SRT 模式：单文本域按 SRT 字幕格式编辑（序号 / 时间轴 / 文本），切回「逐条编辑」或保存时解析回条目；「复制字幕」仍复制不含时间线的纯文本', '');
  }
}
function applyTextMode(): void {
  items.value = parseSrtText(srtText.value);
}

// ===== 复制 / 导出 =====
async function copySubtitles(): Promise<void> {
  if (textMode.value) applyTextMode();
  const txt = plainText(items.value);
  if (!txt) { toast('字幕内容为空，没有可复制的文本'); return; }
  let ok = false;
  try {
    ok = !!(window.appTools && window.appTools.copyText && (await window.appTools.copyText(txt)));
  } catch (e) { ok = false; }
  if (ok) toast('已复制 ' + items.value.length + ' 条字幕文本（不含时间线）');
  else setStatus('复制失败，请重试', 'var(--color-danger)');
}
async function exportSrtFile(): Promise<void> {
  if (textMode.value) applyTextMode();
  const srt = itemsToSrt(items.value);
  if (!srt) { toast('字幕内容为空，没有可导出的内容'); return; }
  const res = await window.projectTools.exportSrt(appState.currentName, srt).catch(() => null);
  if (!res) return;
  if (res.ok) toast('已导出：' + res.savedPath);
  else if (!(res as { canceled?: boolean }).canceled) toast((res as { message?: string }).message || '导出失败');
}

// ===== 保存到项目 =====
async function saveToProject(options?: { silent?: boolean }): Promise<boolean> {
  const silent = !!(options && options.silent);
  if (appState.isBuiltin) {
    if (!silent) toast('内置示例项目只读，请先切换到自己的项目');
    return false;
  }
  if (textMode.value) applyTextMode(); // SRT 模式：先把文本域写回条目再保存
  const text = serializeItems(items.value);
  if (!text.trim()) {
    if (!silent) toast('字幕内容为空，请先添加条目或生成字幕');
    return false;
  }
  const res = await window.projectTools.saveSubtitle(appState.currentName, text, title.value.trim());
  if (!res || !res.ok) {
    if (!silent) toast((res as { message?: string })?.message || '保存失败');
    return false;
  }
  await refreshProject();
  if (!silent) toast('字幕已保存：共 ' + ((res.project && res.project.subtitleCount) || items.value.length) + ' 条');
  return true;
}

// ===== 由脚本旁白生成条目 =====
function fromContent(): void {
  const content = appState.project && appState.project.content;
  const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
  if (!scenes.length) { toast('当前项目无内容脚本，请先到「内容脚本」页编写'); return; }
  let time = 0;
  let usedDur = 0;
  let estimated = 0;
  const list: SubtitleItem[] = [];
  scenes.forEach((s) => {
    const narr = (s && typeof s.narration === 'string' ? s.narration : '').trim();
    if (!narr) return;
    const raw = s && s.durHint;
    const rawN = Number(raw);
    const hasDur = raw !== '' && raw !== null && raw !== undefined && isFinite(rawN) && rawN > 0;
    const dur = hasDur ? rawN : estDur(narr);
    if (hasDur) usedDur++; else estimated++;
    list.push({ start: time, end: time + dur, text: narr });
    time += dur;
  });
  if (!list.length) { toast('内容脚本中暂无有效的旁白文本，请先到「内容脚本」页填写旁白'); return; }
  items.value = list;
  if (textMode.value) srtText.value = itemsToSrt(items.value);
  toast('已由脚本旁白生成 ' + list.length + ' 条字幕，可保存到项目'
    + (usedDur ? '（' + usedDur + ' 条按时长提示累计）' : '')
    + (estimated ? '（' + estimated + ' 条按估时）' : ''));
}

// ===== 转录弹窗 ctx（供 TranscribeSection 回填条目） =====
function openTranscribe(): void {
  // 内置项目守卫在弹窗 open() 内（与原文案一致）
  transcribeEl.value?.open();
}
const pageCtx = {
  getItems: () => items.value,
  setItems: (v: SubtitleItem[]) => { items.value = v; },
  isTextMode: () => textMode.value,
  syncTextArea: () => { if (textMode.value) srtText.value = itemsToSrt(items.value); },
  saveToProject,
  estDur
};

onMounted(() => {
  const proj = appState.project || {};
  setStatus('', '');
  title.value = (proj.title && proj.title !== '字幕动画') ? proj.title : '';
  items.value = parseSubtitleText(proj.subtitle || '');
  textMode.value = false; // 页面重建后回到「逐条编辑」默认模式
  if (appState.isBuiltin) toast('当前是内置示例项目（只读），请切换到自己的项目来编辑字幕');
});
</script>
