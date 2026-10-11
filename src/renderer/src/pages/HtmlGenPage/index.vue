<template>
  <div>
    <StepBar :page="'html-gen'" />
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>HTML · Agent 生成 / 修改</div>
      <!-- 项目状态（原 renderMeta 的 #hg-meta） -->
      <div class="proj-meta">
        <div v-if="meta.builtin" class="proj-stat"><b>内置示例（只读）</b>示例项目不可生成 / 修改，自带示例 HTML。请在顶部「工作项目」切换到「我的项目」。</div>
        <template v-else>
          <div class="proj-stat" :class="{ on: meta.hasH }"><b>HTML</b>{{ meta.hasH ? '已生成' : '尚未生成' }}</div>
          <div class="proj-stat" :class="{ on: meta.sceneN > 0 }"><b>内容脚本</b>{{ meta.sceneN ? meta.sceneN + ' 个场景（生成时自动附带）' : '无（可先到「内容脚本」页编写）' }}</div>
          <div class="proj-stat" :class="{ on: meta.subCount > 0 }"><b>素材</b>{{ meta.subCount ? '字幕 ' + meta.subCount + ' 条' + (meta.audioFile ? ' · 已配背景音频' : '') + (meta.videoMaterial ? ' · 已配视频素材' : '') : '无字幕（可先到「字幕生成」页添加）' }}</div>
          <div class="proj-stat"><b>用法</b>{{ meta.hasH ? '可「下载 HTML」；也可填写需求后「修改 HTML」' : '填写需求描述后点「生成 HTML」；字幕 / 背景音频 / 视频素材在上方「项目素材」选配（均可选，缺少的素材在「自定义素材」导入）' }}</div>
        </template>
      </div>
      <div class="hgen-block">
        <div class="panel-title-sm">需求描述（提示词）</div>
        <textarea v-model="prompt" class="hgen-subtitle" spellcheck="false" placeholder="描述你想要的 HTML 效果，例如：&#10;· 深空科技风格的标题动画页，标题为“我的作品集”&#10;· 每条字幕间隔两秒，依次从下方上浮淡入&#10;· 修改时：换成紫色霓虹配色，并把标题放大"></textarea>
      </div>
      <div class="hgen-block">
        <div class="panel-title-sm">项目素材（均可选，留空则跳过）</div>
        <div class="hgen-row">
          <span class="sel-label" style="flex:none;width:auto">字幕</span>
          <select v-model="subSel" class="hgen-select" style="flex:1" title="生成/修改时选用哪份字幕逐条设计动画">
            <option value="">不使用字幕</option>
            <option v-if="!appState.isBuiltin && (appState.project?.subtitle || '').trim()" value="__current__">当前项目字幕（{{ appState.project?.subtitleCount || 0 }} 条）</option>
            <option v-for="mp in appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)" :key="mp.name" :value="mp.name">项目「{{ mp.title || mp.name }}」字幕（{{ mp.subtitleCount || 0 }} 条）</option>
          </select>
        </div>
        <div class="hgen-row">
          <span class="sel-label" style="flex:none;width:auto">背景音频</span>
          <select v-model="audioSel" class="hgen-select" style="flex:1" title="生成/修改时选用哪份音频作为音轨注入">
            <option value="">不使用背景音频</option>
            <option v-if="!appState.isBuiltin && appState.project?.audioFile" value="__current__">当前项目背景音频（{{ appState.project?.audioFile }}）</option>
          </select>
        </div>
        <div class="hgen-row">
          <span class="sel-label" style="flex:none;width:auto">视频素材</span>
          <select v-model="videoSel" class="hgen-select" style="flex:1" title="生成/修改时选用哪个视频片段嵌入页面">
            <option value="">不使用视频素材</option>
            <option v-if="!appState.isBuiltin && appState.project?.videoMaterial" value="__current__">当前项目视频素材（{{ appState.project?.videoMaterial }}）</option>
          </select>
        </div>
        <div class="hgen-tip">生成 / 修改 HTML 时使用所选素材：字幕逐条设计动画、音频作为音轨注入、视频作为页面片段嵌入。留空 = 跳过对应素材，仅按需求描述生成。项目里还没有的素材，可在下方「自定义素材」导入。</div>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="runAgent('generate')">生成 HTML</button>
        <button class="hf-btn" title="基于当前 HTML 按项目需求修改并覆盖" @click="onModify">修改 HTML</button>
        <button class="hf-btn" title="下载当前项目 HTML 到本地" @click="onDownload">下载 HTML</button>
      </div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>自定义素材 · 导入为项目素材（可选）</div>
      <div class="panel-title-sm" style="margin-top:0">背景音频</div>
      <div class="hgen-row">
        <button class="hf-btn" @click="onPickAudio">选择音频文件</button>
        <span class="hf-file">{{ appState.project?.audioFile ? escTxt(appState.project.audioFile) : '未设置音频' }}</span>
        <button class="hf-btn" :disabled="!appState.project?.audioFile" @click="onClearAudio">移除音频</button>
      </div>
      <div class="hgen-row">
        <select v-model="genSelIdx" class="hgen-select" style="flex:1" @change="genUpdate">
          <option v-if="!genAudios.length" value="">（暂无已生成音频）</option>
          <option v-for="(it, i) in genAudios" :key="it.path" :value="String(i)">{{ it.name }}（{{ it.group }}）</option>
        </select>
        <button class="hf-btn" @click="onGenRefresh">刷新</button>
        <button class="hf-btn" @click="onGenPlay">试听</button>
        <button class="hf-btn hf-btn-primary" :disabled="genUseDisabled" @click="onGenUse">设为背景音频</button>
      </div>
      <div class="hgen-row" v-show="genPlayRowVisible">
        <audio ref="genAudioEl" :src="genAudioSrc" controls style="flex:1;max-height:44px"></audio>
        <label class="sel-label">语速</label>
        <span class="rate-spinner" style="display:inline-flex;align-items:center;flex:none;gap:2px">
          <button type="button" class="hf-btn" title="语速减 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="rateStep(-0.05)">−</button>
          <input ref="rateEl" :value="rateValue" type="text" inputmode="decimal" class="hgen-input" title="播放语速 0.5~2.0（非法或空值自动回退 1x）" style="width:60px;text-align:center;flex:none" @input="onRateInput" />
          <button type="button" class="hf-btn" title="语速加 0.05" style="padding:0;width:28px;height:28px;line-height:1;flex:none" @click="rateStep(0.05)">+</button>
        </span>
      </div>
      <div class="hgen-tip">本地音频或已生成 TTS 音频设为当前项目背景音频（自动复制进项目 audio/ 目录），即可在上方「项目素材」下拉选用，生成 / 修改时注入为音轨：预览即可听，转视频自动混入。</div>
      <div class="panel-title-sm" style="margin-top:20px">视频素材</div>
      <div class="hgen-row">
        <button class="hf-btn" @click="onPickVideo">选择视频文件</button>
        <span class="hf-file">{{ appState.project?.videoMaterial ? escTxt(appState.project.videoMaterial) : '未设置视频' }}</span>
        <button class="hf-btn" :disabled="!appState.project?.videoMaterial" @click="onClearVideo">移除视频</button>
        <button class="hf-btn" :disabled="!appState.project?.videoMaterial || appState.isBuiltin" title="从当前视频素材提取原声音轨（mp4 → m4a），自动设为项目背景音频" @click="onExtractAudio">{{ extractText }}</button>
      </div>
      <div class="hgen-row" v-show="videoPrevRowVisible">
        <video ref="videoPrevEl" :src="videoPrevSrc" controls style="flex:1;max-height:200px;border-radius:8px;background:#000"></video>
      </div>
      <div class="hgen-tip">本地视频设为当前项目视频素材（自动复制进项目 video/ 目录），即可在上方「项目素材」下拉选用：Agent 自动以 &lt;video&gt; 引入（静音自动播放，保证转视频时可渲染）并用 GSAP 编排播放时段。如需视频原声，点「提取原声为背景音频」把其音轨提取为项目背景音频（保留原声路线）。</div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>预览</div>
      <div class="hf-status" :class="statusClass">{{ status }}</div>
      <div v-show="showThink" style="margin-top:10px;padding:10px 12px;border:1px solid rgba(0,212,255,.22);border-radius:8px;background:rgba(0,212,255,.05)">
        <div style="font-size:12px;color:#00D4FF;margin-bottom:6px">AI 思考过程（实时）</div>
        <pre ref="thinkPreEl" style="margin:0;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;font-size:12px;line-height:1.7;color:rgba(255,255,255,.82)">{{ thinkText }}</pre>
      </div>
      <div class="empty-hint" v-show="emptyVisible">{{ emptyText }}</div>
      <div ref="frameWrapEl" class="hgen-frame-wrap" v-show="frameVisible">
        <iframe ref="frameEl" :src="frameSrc" class="hgen-frame" sandbox="allow-scripts allow-same-origin" @load="onFrameLoad"></iframe>
      </div>
      <div class="hg-prev-ctl" v-show="ctlVisible">
        <button class="hf-btn" title="暂停 / 继续播放动画" style="padding:4px 14px;font-size:12px" @click="onPrevToggle">{{ prevToggleText }}</button>
        <button class="hf-btn" title="从头重新播放" style="padding:4px 14px;font-size:12px" @click="onPrevReplay">重新播放</button>
        <div class="hg-prev-bar"><div class="hg-prev-bar-fill" :style="{ width: prevFillPct }"></div></div>
        <span class="hg-prev-time">{{ prevTimeText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/index.vue —— HTML 生成/修改页（原 JS 版 htmlGen 模块 {template,index}.js 移植）
// 预览 postMessage 监听改为 onMounted/onBeforeUnmount 成对（原模块级 once-guard 删除）；
// 原 renderMeta/fill*List 的 DOM 重建改为 computed + v-for 响应式。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appState, hasHtml, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { escTxt } from '@renderer/utils/escape'
import { applyRate, stepRate } from '@renderer/utils/rate'
import StepBar from '@renderer/components/StepBar.vue'

// ===== 生成/修改 =====
const prompt = ref('');
const subSel = ref('');
const audioSel = ref('');
const videoSel = ref('');
const status = ref('');
const statusClass = ref('');
const thinkText = ref('');
const thinkPreEl = ref<HTMLElement | null>(null);
const showThink = computed(() => thinkText.value.length > 0);
watch(thinkText, () => {
  if (thinkPreEl.value) thinkPreEl.value.scrollTop = thinkPreEl.value.scrollHeight;
});

// 项目状态条（原 renderMeta）
const meta = computed(() => {
  if (appState.isBuiltin) return { builtin: true as const, hasH: false, sceneN: 0, subCount: 0, audioFile: '', videoMaterial: '' };
  const p = appState.project;
  const c = (p && p.content) || { scenes: [] };
  const sceneN = Array.isArray(c.scenes)
    ? c.scenes.filter((s) => s && typeof s.narration === 'string' && s.narration.trim()).length
    : 0;
  return {
    builtin: false as const,
    hasH: hasHtml.value,
    sceneN,
    subCount: (p && p.subtitleCount) || 0,
    audioFile: (p && p.audioFile) || '',
    videoMaterial: (p && p.videoMaterial) || ''
  };
});

// ===== 预览 =====
const frameEl = ref<HTMLIFrameElement | null>(null);
const frameWrapEl = ref<HTMLElement | null>(null);
const frameVisible = ref(false);
const frameSrc = ref('');
const emptyVisible = ref(true);
const emptyText = ref('尚未生成 HTML。');
const ctlVisible = computed(() => frameVisible.value);

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
function prevPost(type: string): void {
  const frame = frameEl.value;
  if (frame && frame.contentWindow) frame.contentWindow.postMessage({ __hg: true, type }, '*');
}
function onPrevMessage(ev: MessageEvent): void {
  const d = ev && ev.data;
  if (!d || !d.__hg || d.type !== 'progress') return;
  prevTimeCur.value = Number(d.time) || 0;
  prevDur.value = Number(d.dur) || 0;
  if (prevPlaying.value && prevDur.value > 0 && prevTimeCur.value >= prevDur.value - 0.25) {
    prevPlaying.value = false; // 自然播完：进度停满，按钮回「播放」（点击即从头重播）
  }
}
// 预览画布：iframe 内部恒为 1920x1080 视口，按容器宽度等比缩放，完整装入预览窗口
function fitFrame(): void {
  const wrap = frameWrapEl.value;
  const frame = frameEl.value;
  if (wrap && frame) {
    frame.style.transform = 'scale(' + (wrap.clientWidth / 1920) + ')';
  }
}
function onFrameLoad(): void {
  // 每次载入完成（含重新播放的 reload）：重置进度与按钮状态，并按容器宽度重新缩放画布
  prevPlaying.value = true;
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
  // 走 hgpreview:// 协议（dev http 页下 file:// iframe 会被 Chromium 拦截）；?v= 时间戳强制重新加载
  const relFile = String(res.previewPath).split(/[\\/]/).pop() || 'index.preview.html';
  frameSrc.value = 'hgpreview://p/' + encodeURIComponent(appState.currentName) + '/' + encodeURIComponent(relFile) + '?v=' + Date.now();
  frameVisible.value = true;
  emptyVisible.value = false;
}

// 状态联动：有 HTML → 自动预览；无 HTML → 恢复“尚未生成”提示（不展示空 iframe）
function syncPreview(): void {
  // 内置示例为只读项目：其 HTML 属于示例资源而非本页生成产物，不在此展示为“已生成”/自动预览
  const ok = !appState.isBuiltin && !!(appState.project && appState.project.htmlExists && appState.project.htmlPath);
  if (ok) loadFrame();
  else {
    frameVisible.value = false;
    frameSrc.value = '';
    emptyVisible.value = true;
    emptyText.value = appState.isBuiltin
      ? '内置示例项目为只读：自带示例 HTML，可到「视频生成」页查看效果；生成请先在顶部「工作项目」切换到「我的项目」。'
      : '尚未生成 HTML。';
  }
}

// ===== 生成 / 修改 =====
let agentRunning = false;
async function runAgent(mode: 'generate' | 'modify'): Promise<void> {
  if (agentRunning) { toast('上一个请求还在处理中，请稍候'); return; }
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  const p = prompt.value.trim();
  if (!p) { toast('请先填写需求描述（上方提示词输入框）'); return; }
  agentRunning = true;
  const sceneN = meta.value.sceneN;
  // 方案B：生成/修改前提示将附带当前项目内容脚本（脚本为 HTML 的整体内容源）
  status.value = sceneN
    ? '将附带当前项目内容脚本（' + sceneN + ' 个场景），已提交给 Agent，处理中...'
    : '当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...';
  statusClass.value = '';
  // 本次生成/修改所选素材（均可空：留空 = 不拼接对应素材；'' → 跳过）
  const materials = {
    subtitleProject: subSel.value,
    audioPath: audioSel.value,
    videoPath: videoSel.value
  };
  try {
    const call = (mode === 'generate')
      ? window.projectTools.generateHtml(appState.currentName, p, materials)
      : window.projectTools.modifyHtml(appState.currentName, p, materials);
    const res = await call;
    if (res && res.ok) {
      await refreshProject();
      syncPreview();
      status.value = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : '');
      statusClass.value = 'hf-ok';
      toast(mode === 'generate' ? 'HTML 已生成' : 'HTML 已修改');
    } else {
      const msg = (res && res.message) || '提交失败';
      status.value = msg;
      statusClass.value = 'hf-error';
      // 生成失败且项目原本就无 HTML：恢复“未生成”展示，避免误显示为已生成
      if (!appState.project?.htmlExists) {
        frameVisible.value = false;
        frameSrc.value = '';
        emptyVisible.value = true;
      }
      toast(msg);
    }
  } finally {
    agentRunning = false;
  }
}
function onModify(): void {
  if (!appState.project?.htmlExists) { toast('还没有 HTML，先「生成 HTML」'); return; }
  runAgent('modify');
}

// ===== 下载 HTML =====
async function onDownload(): Promise<void> {
  let res;
  if (appState.isBuiltin && appState.project && appState.project.htmlPath) {
    // 内置示例：直接导出其自带 index.html（只读；不落盘到 userData 项目）
    res = await window.projectTools.downloadFile(appState.project.htmlPath, appState.currentName + '.html');
  } else {
    res = await window.projectTools.downloadHtml(appState.currentName);
  }
  if (!res) return;
  if (res.ok) toast('已导出：' + res.savedPath);
  else if (!(res as { canceled?: boolean }).canceled) toast((res as { message?: string }).message || '下载失败');
}

// ===== 背景音频 =====
async function onPickAudio(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  const picked = await window.projectTools.pickAudio();
  if (!picked) return;
  const res = await window.projectTools.setAudio(appState.currentName, picked);
  if (!res.ok) { toast((res as { message?: string }).message || '设置音频失败'); return; }
  audioSel.value = '';
  await refreshProject();
  toast('已加入音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
}
async function onClearAudio(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  await window.projectTools.clearAudio(appState.currentName);
  audioSel.value = '';
  await refreshProject();
  toast('已移除音频');
}

// ===== 视频素材 =====
const videoPrevSrc = ref('');
const videoPrevRowVisible = ref(false);
function syncVideoPreview(absPath: string): void {
  if (absPath && absPath.length) {
    videoPrevSrc.value = 'file:///' + encodeURI(String(absPath).replace(/\\/g, '/'));
    videoPrevRowVisible.value = true;
  } else {
    videoPrevSrc.value = '';
    videoPrevRowVisible.value = false;
  }
}
async function onPickVideo(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  const picked = await window.projectTools.pickVideo();
  if (!picked) return;
  const res = await window.projectTools.setVideo(appState.currentName, picked);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置视频失败'); return; }
  videoSel.value = '';
  await refreshProject();
  syncVideoPreview(res.abs);
  toast('已加入视频素材：' + res.videoFile + '（生成/修改时让 Agent 嵌入该视频片段）');
}
async function onClearVideo(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  await window.projectTools.clearVideo(appState.currentName);
  videoSel.value = '';
  await refreshProject();
  syncVideoPreview('');
  toast('已移除视频素材');
}

// ===== 提取视频原声 =====
const extractText = ref('提取原声为背景音频');
async function onExtractAudio(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先切换到自己的项目'); return; }
  if (!(appState.project && appState.project.videoMaterial)) { toast('还没有视频素材，请先「选择视频文件」'); return; }
  extractText.value = '提取中…';
  const res = await window.projectTools.extractVideoAudio(appState.currentName).catch(() => null);
  extractText.value = '提取原声为背景音频';
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '提取失败'); return; }
  audioSel.value = '';
  await refreshProject();
  toast('已提取原声并设为背景音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
}

// ===== 已生成音频：复用为当前项目背景音频 =====
interface GenAudioItem { path: string; name: string; group: string; size: number; mtime: number }
const genAudios = ref<GenAudioItem[]>([]);
const genSelIdx = ref('');
const genUseDisabled = ref(true);
const genPlayRowVisible = ref(false);
const genAudioEl = ref<HTMLAudioElement | null>(null);
const genAudioSrc = ref('');

function genUpdate(): void {
  const it = genAudios.value[Number(genSelIdx.value)];
  if (!it) { genUseDisabled.value = true; return; }
  genUseDisabled.value = appState.isBuiltin;
  genAudioSrc.value = 'file:///' + encodeURI(String(it.path).replace(/\\/g, '/'));
  genPlayRowVisible.value = true;
}
async function onGenRefresh(): Promise<void> {
  await genLoad(false);
}
async function genLoad(silent: boolean): Promise<void> {
  const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' }));
  if (!res || !res.ok) {
    if (!silent) toast((res as { message?: string })?.message || '加载已生成音频失败');
    return;
  }
  genAudios.value = res.items || [];
  if (!genAudios.value.length) {
    genSelIdx.value = '';
    genUseDisabled.value = true;
    genAudioSrc.value = '';
    genPlayRowVisible.value = false;
    return;
  }
  genUpdate();
}
function onGenPlay(): void {
  const el = genAudioEl.value;
  if (!el || !genAudioSrc.value) { toast('请先选择已生成音频'); return; }
  if (el.paused) el.play().catch(() => toast('音频试听失败（可能文件已被移动）'));
  else el.pause();
}
async function onGenUse(): Promise<void> {
  const it = genAudios.value[Number(genSelIdx.value)];
  if (!it) { toast('请先选择已生成音频'); return; }
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  const res = await window.projectTools.setAudio(appState.currentName, it.path);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置背景音频失败'); return; }
  audioSel.value = '';
  await refreshProject();
  toast('已设为背景音频：' + res.audioFile + '（生成/修改时让 Agent 带上该音轨）');
}

// ===== 已生成音频试听：语速调节（仅改 playbackRate；0.5~2.0，非法或空值回退 1） =====
const rateEl = ref<HTMLInputElement | null>(null);
const rateValue = ref('1');
function onRateInput(): void {
  const el = rateEl.value;
  if (!el) return;
  rateValue.value = String(applyRate(el, genAudioEl.value));
}
function rateStep(delta: number): void {
  const el = rateEl.value;
  if (!el) return;
  rateValue.value = String(stepRate(el, genAudioEl.value, delta));
}

// ===== 生命周期 =====
onMounted(() => {
  if (appState.isBuiltin) { toast('当前是内置示例项目（只读），请切换到自己的项目'); }
  status.value = '';
  statusClass.value = '';
  thinkText.value = '';
  // 生成/修改过程实时显示：主进程流式推送 AI 推理/输出阶段（preload 单订阅：切页即替换，与现行为一致）
  window.projectTools.onHtmlProgress((info) => {
    if (!info) return;
    if (info.text) {
      status.value = String(info.text);
      statusClass.value = '';
    }
    // 实时显示 AI 思考过程原文（随字符计数同步更新，自动滚动到底部）
    thinkText.value = String(info.thinkText || '');
  });
  window.addEventListener('message', onPrevMessage);
  window.addEventListener('resize', fitFrame);
  syncPreview();
  genLoad(true);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onPrevMessage);
  window.removeEventListener('resize', fitFrame);
});
</script>
