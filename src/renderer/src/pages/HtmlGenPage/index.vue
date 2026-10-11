<template>
  <div>
    <StepBar :page="'html-gen'" />
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>HTML · Agent {{ hasHtml ? '修改' : '生成' }}</div>
      <!-- 项目状态（原 renderMeta 的 #hg-meta） -->
      <div class="proj-meta">
        <div v-if="meta.builtin" class="proj-stat"><b>内置示例（只读）</b>示例 HTML 已随包提供、不可改动；请在顶部「工作项目」切换到「我的项目」。</div>
        <template v-else>
          <div class="proj-stat" :class="{ on: meta.hasH }"><b>HTML</b>{{ meta.hasH ? '已生成' : '尚未生成' }}</div>
          <div class="proj-stat" :class="{ on: meta.sceneN > 0 }"><b>内容脚本</b>{{ meta.sceneN ? meta.sceneN + ' 个场景（生成时自动附带）' : '无（可先到「内容脚本」页编写）' }}</div>
          <div class="proj-stat" :class="{ on: meta.subCount > 0 }"><b>素材</b>{{ meta.subCount ? '字幕 ' + meta.subCount + ' 条' + (meta.audioFile ? ' · 已配背景音频' : '') + (meta.videoMaterial ? ' · 已配视频素材' : '') : '无字幕（可先到「字幕生成」页添加）' }}</div>
          <div class="proj-stat"><b>用法</b>{{ meta.hasH ? '填写需求后点「按需求修改」（在当前页面上改）；想整页重来点「生成 HTML」（会直接覆盖当前页面，点一次即执行），也可「下载 HTML」备份' : '在「项目素材」里选好素材，再填写需求描述点「生成 HTML」；背景音频在下方「预览」里选定' }}</div>
        </template>
      </div>
      <div class="hgen-block">
        <div class="panel-title-sm">项目素材（均可选，留空则跳过）</div>
        <div class="hgen-row">
          <span class="sel-label" style="flex:none;width:auto">字幕</span>
          <select v-model="subSel" class="hgen-select" style="flex:1" title="按所选字幕逐条设计动画">
            <option value="">不使用字幕</option>
            <option v-if="!appState.isBuiltin && (appState.project?.subtitle || '').trim()" value="__current__">当前项目字幕（{{ appState.project?.subtitleCount || 0 }} 条）</option>
            <option v-for="mp in appState.myProjects.filter((m) => m.name !== appState.currentName && m.hasSubtitle)" :key="mp.name" :value="mp.name">项目「{{ mp.title || mp.name }}」字幕（{{ mp.subtitleCount || 0 }} 条）</option>
          </select>
        </div>
        <template v-if="!appState.isBuiltin">
          <div class="hgen-row">
            <span class="sel-label" style="flex:none;width:auto">视频素材</span>
            <!-- 视频素材只有一个入口：选项目现有素材、或当场导入自定义文件（导入后自动选中） -->
            <select v-model="videoSel" class="hgen-select" style="flex:1" title="把哪个视频片段放进页面；没有现成素材时可当场导入" @change="onVideoSelect">
              <option value="">不使用视频素材</option>
              <option v-if="appState.project?.videoMaterial" value="__current__">当前项目视频素材（{{ appState.project?.videoMaterial }}）</option>
              <option value="__pick__">选择本地视频文件…（导入为项目素材）</option>
            </select>
            <button class="hf-btn" :disabled="!appState.project?.videoMaterial" @click="onClearVideo">移除视频</button>
            <button class="hf-btn" :disabled="!appState.project?.videoMaterial" title="把视频里的声音提取出来，作为背景音频" @click="onExtractAudio">{{ extractText }}</button>
          </div>
          <div class="hgen-row" v-show="videoPrevRowVisible">
            <video ref="videoPrevEl" :src="videoPrevSrc" controls style="flex:1;max-height:200px;border-radius:8px;background:#000"></video>
          </div>
          <div class="hgen-tip">所选素材会用在页面里：字幕逐条依次做动画，视频作为页面片段放进画面。下拉里的「选择本地视频文件…」会导入一份新素材并自动选中；某次不想用视频，选「不使用视频素材」即可。</div>
        </template>
      </div>
      <div class="hgen-block">
        <div class="panel-title-sm">需求描述（提示词）</div>
        <textarea v-model="prompt" class="hgen-subtitle" spellcheck="false" :placeholder="promptPlaceholder"></textarea>
      </div>
      <div class="hgen-actions">
        <!-- 两个动作并列：生成（从零做一版） / 按需求修改（在现有页面上改）；
             每个按钮里各带一个 ? 图标，鼠标悬浮出现该动作自己的说明（.hg-help-pop；点击 ? 不会触发按钮） -->
        <button class="hf-btn hf-btn-primary" :disabled="rendering" @click="onGenerate">
          生成 HTML
          <span class="hg-help" @click.stop>
            <span class="hg-help-icon">?</span>
            <span class="hg-help-pop">不参考现有页面，从零做一版新的。点一次即开始并覆盖当前页面，想留底稿可先「下载 HTML」。</span>
          </span>
        </button>
        <button class="hf-btn" :disabled="!hasHtml || rendering" @click="onModify">
          按需求修改
          <span class="hg-help" @click.stop>
            <span class="hg-help-icon">?</span>
            <span class="hg-help-pop">在当前页面的基础上，按你描述的改一版——换配色、调节奏、改文案都用它。还没生成过 HTML 时不可用。</span>
          </span>
        </button>
        <button class="hf-btn" title="下载当前项目 HTML 到本地" @click="onDownload">下载 HTML</button>
        <!-- 转视频只剩这一个按钮：点它先开「渲染档位」弹窗，确认后才开始渲染（成品到「视频预览」页看） -->
        <button v-if="!appState.isBuiltin" class="hf-btn hf-btn-primary" :disabled="!hasHtml || rendering" title="把当前 HTML 渲染成 MP4（约 30 秒）" @click="openRenderModal">转视频</button>
      </div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>预览</div>
      <!-- 背景音频：不经过 Agent，选定后由主进程注入 HTML 的 <audio>（预览即刻可听，转视频由 HyperFrames 混入 MP4）；
           内置示例是只读项目、没有项目音频，整块不显示 -->
      <template v-if="!appState.isBuiltin">
        <div class="hgen-row">
          <span class="sel-label" style="flex:none;width:auto">背景音频</span>
          <span class="hf-file" style="flex:none;max-width:300px" :title="appState.project?.audioFile || '未设置音频'">{{ appState.project?.audioFile ? escTxt(appState.project.audioFile) : '未设置音频' }}</span>
          <select v-model="audioPick" class="hgen-select" style="flex:1" title="选一份已生成音频作为背景音频" @change="onAudioPick">
            <option value="">从已生成音频中选择…</option>
            <option v-for="(it, i) in genAudios" :key="it.path" :value="String(i)">{{ it.name }}（{{ it.group }}）</option>
          </select>
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
      </template>
      <div class="hf-status" :class="statusDisplayClass">{{ statusDisplay }}</div>
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

    <!-- 转视频弹窗：把「渲染档位」摆在这里确认一遍再开始（档位文案随「设置页默认 / 本项目覆盖」实时变化） -->
    <div class="hf-modal-mask" v-show="renderModalVisible" @click.self="closeRenderModal">
      <div class="hf-modal" style="width:min(520px,92vw)">
        <div class="hf-modal-head">
          <span class="hf-modal-title">转视频</span>
          <button class="hf-modal-close" title="关闭" @click="closeRenderModal">×</button>
        </div>
        <div class="hf-modal-body">
          <div class="panel-title-sm" style="margin-top:0">渲染档位</div>
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:40px">质量</label>
            <select v-model="quality" class="hgen-select" style="flex:1" :disabled="rendering" @change="onOptionChange">
              <option v-for="o in qualityOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:40px">帧率</label>
            <select v-model="fps" class="hgen-select" style="flex:1" :disabled="rendering" @change="onOptionChange">
              <option v-for="o in fpsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="hgen-row" style="margin-bottom:0">
            <span class="hf-file" style="flex:1">{{ optionNote }}</span>
            <button v-if="overridden" class="hf-btn" :disabled="rendering" @click="onResetOptions">恢复默认档位</button>
          </div>
          <div class="hgen-tip">{{ qualityHint }}「转视频」把当前 HTML 渲染成 MP4（约 30 秒）；渲染完成后到「视频预览」页查看成品。</div>
        </div>
        <div class="hf-modal-foot">
          <button class="hf-btn" @click="closeRenderModal">取消</button>
          <button class="hf-btn hf-btn-primary" @click="confirmRenderVideo">开始渲染</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/index.vue —— HTML 生成/修改页（原 JS 版 htmlGen 模块 {template,index}.js 移植）
// 预览 postMessage 监听改为 onMounted/onBeforeUnmount 成对（原模块级 once-guard 删除）；
// 原 renderMeta/fill*List 的 DOM 重建改为 computed + v-for 响应式。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RenderFps, RenderQuality } from '@shared/types'
import { appState, hasHtml, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { escTxt } from '@renderer/utils/escape'
import { applyRate, stepRate } from '@renderer/utils/rate'
import { renderProgress, resetRenderProgress } from '@renderer/composables/useRenderProgress'
import {
  FALLBACK_RENDER,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITY_OPTIONS,
  isRenderOverridden,
  renderOptionsText
} from '@renderer/utils/render'
import { effectiveRenderOptions, renderDefaults, saveProjectRenderOverride } from '@renderer/composables/useRenderOptions'
import StepBar from '@renderer/components/StepBar.vue'

// ===== 生成/修改 =====
const prompt = ref('');
const subSel = ref('');
const videoSel = ref('');
// 背景音轨不是生成素材（由主进程注入 HTML），故不再有 audioSel
const status = ref('');
const statusClass = ref('');
const thinkText = ref('');
const thinkPreEl = ref<HTMLElement | null>(null);
const showThink = computed(() => thinkText.value.length > 0);
// 提示词占位文案随状态变：没 HTML 时讲"要什么样的页面"，已有 HTML 时讲"这次改什么"
const promptPlaceholder = computed(() => (hasHtml.value
  ? '描述这次要改什么，例如：\n· 换成紫色霓虹配色，并把标题放大\n· 字幕出现得太快，节奏放慢一些'
  : '描述你想要的 HTML 效果，例如：\n· 深空科技风格的标题动画页，标题为“我的作品集”\n· 每条字幕间隔两秒，依次从下方上浮淡入'));
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
      ? '内置示例项目为只读：自带示例 HTML，可到「视频预览」页查看效果；生成请先在顶部「工作项目」切换到「我的项目」。'
      : '尚未生成 HTML。';
  }
}

// ===== 生成 / 修改 =====
let agentRunning = false;
async function runAgent(mode: 'generate' | 'modify'): Promise<void> {
  if (agentRunning) { toast('上一个请求还在处理中，请稍候'); return; }
  if (rendering.value) { toast('正在渲染视频，请等它结束再提交需求'); return; }
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
  // 本次生成/修改所选素材（均可空：留空 = 不拼接对应素材；'' → 跳过）。
  // 音轨不在其中：主进程在 HTML 落盘后按 project.audioFile 注入 <audio id="myv-bgm">。
  const materials = {
    subtitleProject: subSel.value,
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
// 「生成 HTML」：不参考现有页面，从零做一版新的（覆盖 index.html）。
// 点一次即执行，**没有二次确认**（覆盖前不会拦截；想先备份可用「下载 HTML」）。
function onGenerate(): void {
  if (rendering.value) { toast('正在渲染视频，请等它结束再提交需求'); return; }
  void runAgent('generate');
}

// 「按需求修改」：把当前 index.html 全文连同需求交给模型改一版（按钮在无 HTML 时禁用，这里是兜底守卫）
function onModify(): void {
  if (!appState.project?.htmlExists) { toast('还没有 HTML，先点「生成 HTML」'); return; }
  runAgent('modify');
}

// ===== 转视频（整个视频环节就这一个按钮，成品到「视频预览」页看）=====
// 成品 MP4 由主进程写到 userData/hf-projects/... 并回写当前项目，之后到「视频预览」页查看。
const rendering = ref(false);
const qualityOptions = RENDER_QUALITY_OPTIONS;
const fpsOptions = RENDER_FPS_OPTIONS;
const quality = ref<RenderQuality>(FALLBACK_RENDER.quality);
const fps = ref<RenderFps>(FALLBACK_RENDER.fps);

// 当前项目的覆盖值（内置示例只读，不参与覆盖）
const projectOverride = computed(() => (appState.isBuiltin ? null : (appState.project && appState.project.render) || null));
const overridden = computed(() => isRenderOverridden(renderDefaults, projectOverride.value));
const optionNote = computed(() => (appState.isBuiltin
  ? '内置示例（只读）：档位仅本次生效'
  : (overridden.value ? '本项目自定义档位' : '跟随设置页默认：' + renderOptionsText(renderDefaults))));
// 当前所选质量的说明（选「快速预览」时明确提示画质代价）
const qualityHint = computed(() => {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === quality.value);
  return hit ? hit.hint + '；' : '';
});

// 状态区文案：渲染中优先显示全局 trace（[Render:trace] 解析结果），其余时候显示本页状态
const statusDisplay = computed(() => ((rendering.value && renderProgress.text) ? renderProgress.text : status.value));
const statusDisplayClass = computed(() => ((rendering.value && renderProgress.text) ? '' : statusClass.value));

// 用「项目覆盖 > 全局默认」的有效档位刷新下拉显示
function syncFromEffective(): void {
  const eff = effectiveRenderOptions();
  quality.value = eff.quality;
  fps.value = eff.fps;
}

// 下拉改动 → 写入当前项目的覆盖（内置示例不落盘，仅本次生效）
async function onOptionChange(): Promise<void> {
  const res = await saveProjectRenderOverride({ quality: quality.value, fps: fps.value });
  if (!res.ok && res.message) toast(res.message);
}

// 恢复默认档位：清除项目覆盖，回到跟随设置页默认
async function onResetOptions(): Promise<void> {
  const res = await saveProjectRenderOverride(null);
  if (res.ok) syncFromEffective();
  else if (res.message) toast(res.message);
}

// 「转视频」弹窗：把渲染档位（质量 / 帧率 / 档位来源 / 画质说明）摆出来确认一遍再开始。
// 先做与渲染同样的守卫，避免出现「弹窗刚打开又被拒」的观感。
const renderModalVisible = ref(false);
function openRenderModal(): void {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  if (rendering.value) return;
  if (agentRunning) { toast('Agent 正在处理 HTML，请等它结束再转视频'); return; }
  const htmlPath = appState.project && appState.project.htmlPath;
  if (!htmlPath || !(appState.project && appState.project.htmlExists)) { toast('还没有 HTML，请先「生成 HTML」'); return; }
  renderModalVisible.value = true;
}
function closeRenderModal(): void {
  renderModalVisible.value = false;
}
// 确认：先关弹窗，再走原有渲染流程（进度显示在本页状态区，「视频预览」页看成品）
function confirmRenderVideo(): void {
  renderModalVisible.value = false;
  void onRenderVideo();
}
// ESC 关闭弹窗（与「从音频生成字幕」弹窗一致）
function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && renderModalVisible.value) closeRenderModal();
}

async function onRenderVideo(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  if (rendering.value) return;
  if (agentRunning) { toast('Agent 正在处理 HTML，请等它结束再转视频'); return; }
  const htmlPath = appState.project && appState.project.htmlPath;
  if (!htmlPath || !(appState.project && appState.project.htmlExists)) { toast('还没有 HTML，请先「生成 HTML」'); return; }
  const options = { quality: quality.value, fps: fps.value };
  status.value = '已提交渲染（' + renderOptionsText(options) + '，约 30 秒）...';
  statusClass.value = '';
  rendering.value = true;
  try {
    const res = await window.hfTools.renderVideo(htmlPath, options);
    resetRenderProgress(); // 本地完成/失败文案覆盖全局 trace 残留
    if (res.ok) {
      status.value = '视频已生成（' + renderOptionsText(options) + '）：' + res.outputVideo;
      statusClass.value = 'hf-ok';
      // 回写视频产物到当前项目（「视频预览」页据此自动加载）
      await window.projectTools.saveVideo(appState.currentName, res.outputVideo);
      await refreshProject();
      toast('视频已生成，可到「视频预览」页查看');
    } else {
      status.value = (res as { message?: string }).message || '渲染失败';
      statusClass.value = 'hf-error';
      toast(status.value);
    }
  } catch (e) {
    // IPC 层异常（主进程不可用等）：不静默吞掉，也不让 trace 残留继续占着状态区
    resetRenderProgress();
    status.value = '渲染失败：' + (((e as Error) && (e as Error).message) || String(e));
    statusClass.value = 'hf-error';
    toast(status.value);
  } finally {
    rendering.value = false;
  }
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

// ===== 背景音频（在「预览」卡片里选定；由主进程注入 HTML，不进生成提示词）=====
const audioPick = ref('');   // 已生成音频下拉（'' = 未选）
const audioEl = ref<HTMLAudioElement | null>(null);
const audioSrc = ref('');
const audioPreviewVisible = ref(false);

function setAudioPreview(absPath: string): void {
  if (absPath) {
    audioSrc.value = 'file:///' + encodeURI(String(absPath).replace(/\\/g, '/'));
    audioPreviewVisible.value = true;
  } else {
    audioSrc.value = '';
    audioPreviewVisible.value = false;
  }
}

// 设 / 换 / 移除背景音频的统一收尾：刷新项目 → 更新试听源 → 重新加载预览
// （主进程在 setAudio / clearAudio 里同步改写了 index.html 的音轨，必须重载 iframe 才听得到）
async function afterAudioChange(tip: string, absPath: string): Promise<void> {
  await refreshProject();
  setAudioPreview(absPath);
  await loadFrame();
  toast(tip);
}

async function onPickAudioFile(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  const picked = await window.projectTools.pickAudio();
  if (!picked) return;
  const res = await window.projectTools.setAudio(appState.currentName, picked);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置音频失败'); return; }
  await afterAudioChange('已设为背景音频：' + res.audioFile, picked);
}

// 从「已生成音频」里选一份设为背景音频（选中即生效，用完把下拉复位）
async function onAudioPick(): Promise<void> {
  const idx = audioPick.value;
  audioPick.value = '';
  const it = genAudios.value[Number(idx)];
  if (!it) return;
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  const res = await window.projectTools.setAudio(appState.currentName, it.path);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '设置背景音频失败'); return; }
  await afterAudioChange('已设为背景音频：' + res.audioFile, it.path);
}

async function onRemoveAudio(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  await window.projectTools.clearAudio(appState.currentName);
  await afterAudioChange('已移除背景音频（HTML 里的音轨也已摘掉）', '');
}

// 已生成音频列表（只用于填充预览卡片的下拉；本页不再有独立的列表 + 试听 + 设为背景音频三件套）
interface GenAudioItem { path: string; name: string; group: string; size: number; mtime: number }
const genAudios = ref<GenAudioItem[]>([]);
async function genLoad(): Promise<void> {
  const res = await window.voiceTools.listGenerated().catch(() => ({ ok: false, message: '调用失败' }));
  if (!res || !res.ok) return;   // 静默：下拉留空即可，不打断页面（生成音频不是本页必需）
  genAudios.value = res.items || [];
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
// 下拉里「项目现有素材」与「导入自定义文件」的唯一入口：
// 选中「选择本地视频文件…」就弹文件框导入（导入后自动选中新素材）；取消或失败则回到项目真实状态。
async function onVideoSelect(): Promise<void> {
  if (videoSel.value !== '__pick__') return;   // '' / '__current__' 只是本次生成的选择，无需额外动作
  if (appState.isBuiltin) {
    toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」');
    videoSel.value = currentVideoSel();
    return;
  }
  const picked = await window.projectTools.pickVideo();
  if (!picked) { videoSel.value = currentVideoSel(); return; }
  const res = await window.projectTools.setVideo(appState.currentName, picked);
  if (!res || !res.ok) {
    toast((res as { message?: string })?.message || '设置视频失败');
    videoSel.value = currentVideoSel();
    return;
  }
  await refreshProject();
  syncVideoPreview(res.abs);
  videoSel.value = '__current__';   // 导入即选中：本次生成直接带上，不需要再去别处选一次
  toast('已导入视频素材：' + res.videoFile + '（本次生成会交给 Agent 嵌入该片段）');
}

// 项目当前的真实选择：有素材 → 当前项目视频素材，否则 → 不使用
function currentVideoSel(): string {
  return appState.project?.videoMaterial ? '__current__' : '';
}

// 进页面时按项目状态初始化：项目里有视频就默认带上（用户仍可切「不使用」）
function syncVideoSelFromProject(): void {
  videoSel.value = currentVideoSel();
}

async function onClearVideo(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先在顶部「工作项目」切换到「我的项目」'); return; }
  await window.projectTools.clearVideo(appState.currentName);
  await refreshProject();
  syncVideoPreview('');
  videoSel.value = currentVideoSel();
  toast('已移除视频素材');
}

// ===== 提取视频原声 =====
const extractText = ref('提取原声为背景音频');
async function onExtractAudio(): Promise<void> {
  if (appState.isBuiltin) { toast('内置示例项目为只读，请先切换到自己的项目'); return; }
  if (!(appState.project && appState.project.videoMaterial)) { toast('还没有视频素材：可在上方「视频素材」里选「选择本地视频文件…」导入'); return; }
  extractText.value = '提取中…';
  const res = await window.projectTools.extractVideoAudio(appState.currentName).catch(() => null);
  extractText.value = '提取原声为背景音频';
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '提取失败'); return; }
  await refreshProject();
  setAudioPreview('');   // 项目内音频没有渲染层可用的绝对路径：试听交给预览 iframe 里的音轨
  await loadFrame();
  toast('已提取原声并设为背景音频：' + res.audioFile);
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

// ===== 生命周期 =====
onMounted(() => {
  if (appState.isBuiltin) { toast('当前是内置示例项目（只读），请切换到自己的项目'); }
  status.value = '';
  statusClass.value = '';
  thinkText.value = '';
  resetRenderProgress();   // 清掉上一次渲染的 trace 残留（渲染中若再次进入本页，随后仍会被新 trace 覆盖）
  syncFromEffective();     // 渲染档位显示：项目覆盖 > 设置页全局默认
  syncVideoSelFromProject(); // 视频素材下拉：项目里已有素材就默认选中（仍可切「不使用视频素材」）
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
  document.addEventListener('keydown', onModalKeydown);   // 「转视频」弹窗的 ESC 关闭
  syncPreview();
  genLoad();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onPrevMessage);
  window.removeEventListener('resize', fitFrame);
  document.removeEventListener('keydown', onModalKeydown);
});
</script>
