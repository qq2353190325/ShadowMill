<template>
  <div>
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>文字生音频（TTS 合成）</div>
      <div class="hgen-tip">选择音色后按该音色绑定的模型合成语音（克隆音色绑定创建时选择的目标模型，系统音色绑定默认合成模型）。结果默认保存到所选项目的 <code>audio/</code>，也可在「保存到」中选择自定义目录或音频输出目录。展示的目标模型（<b>{{ modelTag }}</b>）为未绑定模型音色时的兜底值，可在「音色管理」页为音色改名、改模型。</div>
      <div style="margin-top:var(--space-4)">
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2)">
          <div class="panel-title-sm" style="margin:0">合成文本</div>
          <button class="hf-btn" title="把当前项目内容脚本的旁白逐场景载入合成文本（每场景一段，空行分隔），可继续手动编辑" style="padding:4px 12px;font-size:12px" @click="onLoadNarration">载入脚本旁白</button>
        </div>
        <textarea v-model="text" class="hgen-subtitle" style="height:150px;margin-bottom:var(--space-3)" spellcheck="false" placeholder="输入要合成语音的文字…"></textarea>
      </div>
      <div class="hgen-row">
        <label class="sel-label">音色</label>
        <select v-model="voiceId" class="hgen-select" style="flex:1">
          <optgroup v-for="g in voiceGroups" :key="g.label" :label="g.label">
            <option v-for="o in g.options" :key="o.voiceId" :value="o.voiceId">{{ o.label }}</option>
          </optgroup>
        </select>
        <button class="hf-btn" title="重新拉取音色列表" @click="onRefreshVoice">刷新</button>
        <button class="hf-btn" title="前往「音色管理」页：克隆音色 / 为音色改名、改模型" style="padding:4px 12px;font-size:12px" @click="goPage('sound-copy')">管理音色</button>
      </div>
      <div class="hgen-row">
        <label class="sel-label">保存到</label>
        <select v-model="saveTo" class="hgen-select" style="flex:1" title="合成结果保存位置：项目 audio/（写入项目）· 自定义目录 · 音频输出目录（不写入项目）" @change="onSaveToChange">
          <option v-for="p in appState.myProjects" :key="p.name" :value="'proj:' + p.name">项目「{{ p.title || p.name }}」（audio/）</option>
          <option value="custom">{{ cfgSaveDir ? '自定义目录…（' + cfgSaveDir + '）' : '自定义目录…（未选择）' }}</option>
          <option value="out">音频输出目录（不写入项目）</option>
        </select>
        <button class="hf-btn" title="打开当前选择的保存目录（无需等合成完成）" @click="onOpenFolder">打开目录</button>
      </div>
      <div class="hgen-row" v-show="parseSaveTo().kind === 'custom'">
        <span class="hf-file">{{ cfgSaveDir ? '自定义目录：' + cfgSaveDir : '（尚未选择自定义目录）' }}</span>
        <button class="hf-btn" title="清除自定义目录，保存到恢复为项目 / 音频输出目录" @click="onClearCustom">恢复默认</button>
      </div>
      <div class="hgen-row">
        <label class="sel-label" title="选填。留空时自动命名：时间_前五个字_音色id">音频名字</label>
        <input v-model="audioName" class="hgen-input" type="text" placeholder="选填；不填自动命名：时间_前五个字_音色id" style="flex:1" />
        <span class="hgen-tip" style="margin:0;font-size:12px;white-space:nowrap">选填</span>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" :disabled="synthBusy" @click="onSynth">合成并保存</button>
      </div>
      <div class="hf-status" :class="statusClass">{{ status }}</div>
      <button class="hf-btn" title="跳转到「设置」-「千问语音」（未配置 Key 时合成会自动引导）" style="padding:2px 10px;font-size:12px;opacity:.55;margin-top:var(--space-2)" @click="goPage('settings')">API Key 设置</button>
    </div>
    <div class="card hgen-panel" style="margin-top:16px" v-show="ttsResultShown">
      <div class="panel-title"><span class="dot"></span>合成结果</div>
      <div class="hgen-row">
        <span class="hf-file">{{ resultPath ? '保存路径：' + resultPath : '' }}</span>
        <button class="hf-btn" :disabled="!resultPath" @click="onOpenResultDir">打开目录</button>
      </div>
      <div class="hgen-row">
        <audio ref="resultAudioEl" :src="resultSrc" class="hf-video" controls style="flex:1;max-height:54px"></audio>
        <label class="sel-label">语速</label>
        <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
          <button type="button" class="hf-btn" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="resultRateStep(-0.05)">−</button>
          <input ref="resultRateEl" :value="resultRateValue" type="text" inputmode="decimal" class="hgen-input" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none" @input="onResultRateInput" />
          <button type="button" class="hf-btn" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="resultRateStep(0.05)">+</button>
        </span>
      </div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>已生成音频（可选，作为当前项目背景音频复用）</div>
      <div class="hgen-row">
        <select v-model="genSelIdx" class="hgen-select" style="flex:1" @change="updateGenSel">
          <option v-if="!genAudios.length" value="">（暂无已生成音频）</option>
          <optgroup v-for="g in genGroups" :key="g.label" :label="g.label">
            <option v-for="pair in g.pairs" :key="pair.i" :value="String(pair.i)">{{ pair.it.name }}</option>
          </optgroup>
        </select>
        <button class="hf-btn" @click="fillGenAudios(false)">刷新</button>
        <button class="hf-btn" @click="onGenPlay">试听</button>
      </div>
      <div class="hgen-row">
        <span class="hf-file">{{ genInfo }}</span>
        <button class="hf-btn" :disabled="genOpenDisabled" @click="onGenOpenDir">打开目录</button>
        <button class="hf-btn hf-btn-primary" :disabled="genSetDisabled" @click="onGenSetBg">设为当前项目背景音频</button>
      </div>
      <div class="hgen-row" v-show="genPlayRowVisible">
        <audio ref="genAudioEl" :src="genAudioSrc" controls style="flex:1;max-height:44px;width:100%;min-width:0"></audio>
        <label class="sel-label">语速</label>
        <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
          <button type="button" class="hf-btn" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="genRateStep(-0.05)">−</button>
          <input ref="genRateEl" :value="genRateValue" type="text" inputmode="decimal" class="hgen-input" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none" @input="onGenRateInput" />
          <button type="button" class="hf-btn" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="genRateStep(0.05)">+</button>
        </span>
      </div>
      <div class="hgen-tip">列出历史合成保存的 TTS 音频（默认输出目录、自定义保存目录）与各项目 audio/ 中的音频，可直接一键设为当前项目的背景音频（复制进项目 audio/ 并写入 project.json）。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/textTts/SynthSection.vue —— 文字生音频（TTS 合成）卡（原 pages/textTts/synth.js 移植）
import { computed, onMounted, ref } from 'vue'
import { appState, refreshProject } from '../../composables/useAppStore'
import { toast } from '../../composables/useToast'
import { applyRate, stepRate } from '../../composables/rate'
import { goPage } from '../../pages'
import {
  cfgSaveDir, firstVoiceId, loadVoices, modelTag, requireCfg, setCfgSaveDir,
  ttsResultShown, voiceGroups, voiceModelOf
} from './helpers'

const status = ref('');
const statusClass = ref('');
const setStatus = (text: string, kind: string): void => {
  status.value = text || '';
  statusClass.value = kind;
};

// ===== 音色 =====
const voiceId = ref('');
async function onRefreshVoice(): Promise<void> {
  if (await requireCfg(setStatus)) {
    await loadVoices(setStatus);
    voiceId.value = firstVoiceId();
  }
}

// ===== 合成文本 / 音频名字 =====
const text = ref('');
const audioName = ref('');

function onLoadNarration(): void {
  const content = appState.project && appState.project.content;
  const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
  const narrs = scenes
    .map((s) => (s && typeof s.narration === 'string' ? s.narration.trim() : ''))
    .filter((t) => t.length > 0);
  if (!narrs.length) {
    setStatus('当前项目无内容脚本（或场景无旁白），请先到「内容脚本」页编写', 'hf-error');
    return;
  }
  text.value = narrs.join('\n\n');
  setStatus('已载入 ' + narrs.length + ' 段旁白（每场景一段、空行分隔），可继续手动编辑', 'hf-ok');
}

// ===== 保存到（项目 audio/ · 自定义目录 · 音频输出目录 三选一） =====
const saveTo = ref('');
const lastSaveTo = ref('');
function parseSaveTo(): { kind: 'custom' | 'output' | 'project' | 'none'; saveDir?: string; projectName?: string } {
  const v = saveTo.value;
  if (v === 'custom') return { kind: 'custom', saveDir: cfgSaveDir.value };
  if (v === 'out') return { kind: 'output' };
  if (v && v.indexOf('proj:') === 0) return { kind: 'project', projectName: v.slice(5) };
  return { kind: 'none' };
}
function fillSaveTo(): void {
  const prev = lastSaveTo.value || saveTo.value;
  const opts: string[] = [
    ...appState.myProjects.map((p) => 'proj:' + p.name),
    'custom',
    'out'
  ];
  let want = opts.includes(prev) ? prev : '';
  if (!want) {
    // 默认：已持久化自定义目录 → 自定义；否则当前项目（内置项目则最近项目）；无项目 → 音频输出目录
    want = cfgSaveDir.value ? 'custom' : (appState.myProjects.length ? 'proj:' + ((appState.currentName && !appState.isBuiltin) ? appState.currentName : appState.myProjects[0].name) : 'out');
  }
  if (!opts.includes(want)) want = 'out';
  saveTo.value = want;
  lastSaveTo.value = want;
}
async function onSaveToChange(): Promise<void> {
  if (saveTo.value === 'custom' && !cfgSaveDir.value) {
    const r = await window.voiceTools.pickDir().catch(() => null);
    if (!r || r.canceled || !r.ok || !r.dir) {
      saveTo.value = lastSaveTo.value; // 未选目录则回退原选择
      return;
    }
    setCfgSaveDir(r.dir);
    const res = await window.voiceTools.saveConfig({ saveDir: cfgSaveDir.value }).catch(() => null);
    if (!res || !res.ok) setStatus('目录已选但保存设置失败：' + ((res as { message?: string })?.message || ''), 'hf-error');
  }
  lastSaveTo.value = saveTo.value;
  if (saveTo.value === 'custom') setStatus('保存位置已设为自定义目录：' + cfgSaveDir.value, 'hf-ok');
}
async function onClearCustom(): Promise<void> {
  setCfgSaveDir('');
  await window.voiceTools.saveConfig({ saveDir: '' }).catch(() => null);
  const fallback = appState.myProjects.length ? 'proj:' + ((appState.currentName && !appState.isBuiltin) ? appState.currentName : appState.myProjects[0].name) : 'out';
  saveTo.value = fallback;
  lastSaveTo.value = fallback;
  setStatus('已恢复默认保存位置（项目 audio/ 或音频输出目录）', 'hf-ok');
}
async function onOpenFolder(): Promise<void> {
  const s = parseSaveTo();
  const r = await window.voiceTools.getSaveDir({
    projectName: s.kind === 'project' ? s.projectName : '',
    saveDir: s.kind === 'custom' ? s.saveDir : '',
    defaultOut: s.kind === 'output'
  }).catch(() => null);
  if (!r || !r.ok || !r.saveDir) {
    setStatus((r as { message?: string })?.message || '获取保存目录失败', 'hf-error');
    return;
  }
  window.projectTools.openFolderOf(r.saveDir);
  setStatus('已打开保存目录：' + r.saveDir, 'hf-ok');
}

// ===== 合成 =====
const synthBusy = ref(false);
async function onSynth(): Promise<void> {
  const c = await requireCfg(setStatus); if (!c) return;
  const t = text.value.trim();
  const v = voiceId.value;
  if (!t) { setStatus('请输入合成文本', 'hf-error'); return; }
  if (!v) { setStatus('请先选择（或创建）音色', 'hf-error'); return; }
  const s = parseSaveTo();
  if (s.kind === 'none') { setStatus('请选择保存位置', 'hf-error'); return; }
  // 使用当前音色绑定的模型合成（选中音色即对应其模型）；无绑定则回落全局默认
  const voiceModel = voiceModelOf(v);
  synthBusy.value = true;
  setStatus('正在按所选音色（' + (voiceModel || '默认模型') + '）合成并下载语音…', '');
  try {
    const res = await window.voiceTools.synth(t, v, s.kind === 'project' ? s.projectName as string : '', s.kind === 'custom' ? s.saveDir as string : '', voiceModel, audioName.value.trim(), s.kind === 'output');
    if (res && res.ok) {
      const where = res.savedTo === 'project'
        ? '已保存到项目「' + (res.projectName || '') + '」'
        : res.savedTo === 'output' ? '已保存到音频输出目录' : '已保存到自定义目录';
      setStatus('合成完成，' + where, 'hf-ok');
      ttsResultShown.value = true;
      resultPath.value = res.savePath || '';
      if (res.savePath) {
        resultSrc.value = 'file:///' + encodeURI(String(res.savePath).replace(/\\/g, '/'));
      }
      fillGenAudios(true);
    } else {
      setStatus((res as { message?: string })?.message || '合成失败', 'hf-error');
    }
  } finally {
    synthBusy.value = false;
  }
}

// ===== 合成结果 =====
const resultPath = ref('');
const resultSrc = ref('');
const resultAudioEl = ref<HTMLAudioElement | null>(null);
const resultRateEl = ref<HTMLInputElement | null>(null);
const resultRateValue = ref('1');
function onResultRateInput(): void {
  const el = resultRateEl.value;
  if (!el) return;
  resultRateValue.value = String(applyRate(el, resultAudioEl.value));
}
function resultRateStep(delta: number): void {
  const el = resultRateEl.value;
  if (!el) return;
  resultRateValue.value = String(stepRate(el, resultAudioEl.value, delta));
}
function onOpenResultDir(): void {
  if (!resultPath.value) { toast('暂无合成文件可打开'); return; }
  window.projectTools.openFolderOf(resultPath.value);
}

// ===== 已生成音频（复用为背景音频） =====
interface GenAudioItem { path: string; name: string; group: string; size: number; mtime: number }
const genAudios = ref<GenAudioItem[]>([]);
const genSelIdx = ref('');
const genInfo = ref('');
const genSetDisabled = ref(true);
const genOpenDisabled = ref(true);
const genPlayRowVisible = ref(false);
const genAudioEl = ref<HTMLAudioElement | null>(null);
const genAudioSrc = ref('');
const genRateEl = ref<HTMLInputElement | null>(null);
const genRateValue = ref('1');

const genGroups = computed(() => {
  const byGroup = new Map<string, { it: GenAudioItem; i: number }[]>();
  genAudios.value.forEach((it, i) => {
    const g = it.group || '其他';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push({ it, i });
  });
  return Array.from(byGroup.entries()).map(([label, pairs]) => ({ label, pairs }));
});

function updateGenSel(): void {
  const it = genAudios.value[Number(genSelIdx.value)];
  if (!it) {
    genInfo.value = '';
    genSetDisabled.value = true;
    genOpenDisabled.value = true;
    return;
  }
  genInfo.value = it.path;
  genSetDisabled.value = appState.isBuiltin;
  genOpenDisabled.value = appState.isBuiltin;
  genAudioSrc.value = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
  genPlayRowVisible.value = false;
}
async function fillGenAudios(silent: boolean): Promise<void> {
  const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' } as any));
  if (!res || !res.ok) {
    if (!silent) setStatus((res as { message?: string })?.message || '加载已生成音频失败', 'hf-error');
    return;
  }
  genAudios.value = res.items || [];
  if (!genAudios.value.length) {
    genSelIdx.value = '';
    genInfo.value = '';
    genSetDisabled.value = true;
    genOpenDisabled.value = true;
    genAudioSrc.value = '';
    genPlayRowVisible.value = false;
    return;
  }
  updateGenSel();
}
function onGenPlay(): void {
  const el = genAudioEl.value;
  if (!el || !genAudioSrc.value) { toast('请先选择已生成音频'); return; }
  genPlayRowVisible.value = true;
  if (el.paused) { el.play().catch(() => toast('音频试听失败（可能文件已被移动）')); }
  else el.pause();
}
async function onGenSetBg(): Promise<void> {
  const it = genAudios.value[Number(genSelIdx.value)];
  if (!it) { toast('请先选择已生成音频'); return; }
  if (appState.isBuiltin) { toast('内置项目只读，请切换到自己的项目'); return; }
  const res = await window.projectTools.setAudio(appState.currentName, it.path);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置背景音频失败'); return; }
  await refreshProject();
  toast('已设为当前项目背景音频：' + res.audioFile);
}
function onGenOpenDir(): void {
  const it = genAudios.value[Number(genSelIdx.value)];
  if (!it) { toast('请先选择已生成音频'); return; }
  window.projectTools.openFolderOf(it.path);
}
function onGenRateInput(): void {
  const el = genRateEl.value;
  if (!el) return;
  genRateValue.value = String(applyRate(el, genAudioEl.value));
}
function genRateStep(delta: number): void {
  const el = genRateEl.value;
  if (!el) return;
  genRateValue.value = String(stepRate(el, genAudioEl.value, delta));
}

onMounted(() => {
  fillSaveTo();
  void (async () => {
    if (await requireCfg(setStatus)) {
      fillSaveTo();
      await loadVoices(setStatus);
      voiceId.value = firstVoiceId();
      fillGenAudios(true);
    }
  })();
});
</script>
