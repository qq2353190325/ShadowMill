<template>
  <div>
    <StepBar :page="'html-gen'" />
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>HTML · Agent {{ hasHtml ? '修改' : '生成' }}</div>
      <!-- 项目状态（原 renderMeta 的 #hg-meta） -->
      <div class="proj-meta">
        <div class="proj-stat" :class="{ on: meta.hasH }"><b>HTML</b>{{ meta.hasH ? '已生成' : '尚未生成' }}</div>
        <div class="proj-stat" :class="{ on: meta.sceneN > 0 }"><b>内容脚本</b>{{ meta.sceneN ? meta.sceneN + ' 个场景（生成时自动附带）' : '无（可先到「内容脚本」页编写）' }}</div>
        <div class="proj-stat" :class="{ on: meta.matN > 0 || meta.subCount > 0 }"><b>素材</b>{{ meta.matText }}</div>
        <div class="proj-stat"><b>用法</b>{{ meta.hasH ? '填写需求后点「按需求修改」（在当前页面上改）；想整页重来点「生成 HTML」（会直接覆盖当前页面，点一次即执行），也可「下载 HTML」备份' : '在「项目素材」里选好素材（可多张图片 / 多个视频，勾选决定这次用哪些），再填写需求描述点「生成 HTML」；背景音频在下方「预览」里选定' }}</div>
      </div>
      <div class="hgen-block">
        <div class="panel-title-sm">字幕素材（可选，留空则跳过）</div>
        <div class="hgen-row">
          <span class="sel-label" style="flex:none;width:auto">字幕</span>
          <HfSelect v-model="subSel" :groups="subSelGroups" title="按所选字幕逐条设计动画" />
        </div>
      </div>
      <!-- 项目素材库（图片 / 视频）：增删与勾选都在子组件里完成，落盘后刷新全局项目状态 -->
      <MaterialsSection />
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
        <button class="hf-btn hf-btn-primary" :disabled="!hasHtml || rendering" title="把当前 HTML 渲染成 MP4（约 30 秒）" @click="openRenderModal">转视频</button>
      </div>
    </div>

    <!-- 预览卡片：iframe 预览副本 + 播放控制条 + AI 思考过程 + 背景音频（子组件，状态由本页传入） -->
    <PreviewSection
      ref="previewRef"
      :status="status"
      :status-class="statusClass"
      :think-text="thinkText"
      :rendering="rendering"
    />

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
            <HfSelect v-model="quality" :groups="qualityGroups" :disabled="rendering" @change="onOptionChange" />
          </div>
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:40px">帧率</label>
            <HfSelect v-model="fps" :groups="fpsGroups" :disabled="rendering" @change="onOptionChange" />
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
// pages/HtmlGenPage/index.vue —— HTML 生成/修改页（页面键 html-gen）
// 本页只留「生成/修改 + 渲染」这条主动作链：素材库在 MaterialsSection.vue、预览与背景音频在 PreviewSection.vue。
// 拆分的理由是按「一个文件一件事」切：素材的增删勾选与本页的生成流程互不依赖，预览那套 iframe/seek/音频试听也自成一块。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RenderFps, RenderQuality } from '@shared/types'
import { appState, hasHtml, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { resetRenderProgress } from '@renderer/composables/useRenderProgress'
import { useEnvGate } from '@renderer/composables/useEnvGate'
import { useConfigPrompt } from '@renderer/composables/useConfigPrompt'
import {
  FALLBACK_RENDER,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITY_OPTIONS,
  isRenderOverridden,
  renderOptionsText
} from '@renderer/utils/render'
import { effectiveRenderOptions, renderDefaults, saveProjectRenderOverride } from '@renderer/composables/useRenderOptions'
import StepBar from '@renderer/components/StepBar.vue'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import MaterialsSection from './MaterialsSection.vue'
import PreviewSection from './PreviewSection.vue'

// ===== 生成/修改 =====
const envGate = useEnvGate();
// 配置类错误弹窗（Key 无效 / 余额不足 / 配置不完整…）：主进程判好分类，本页只负责触发
const configPrompt = useConfigPrompt();
const prompt = ref('');
const subSel = ref('');

// ===== 字幕素材下拉选项（HfSelect；原为 <option v-if>/<option v-for>） =====
const subSelGroups = computed<HfSelectGroup[]>(() => [{
  label: '',
  options: [
    { value: '', label: '不使用字幕' },
    ...((appState.project?.subtitle || '').trim()
      ? [{ value: '__current__', label: '当前项目字幕（' + (appState.project?.subtitleCount || 0) + ' 条）' }]
      : []),
    ...appState.myProjects
      .filter((m) => m.name !== appState.currentName && m.hasSubtitle)
      .map((mp) => ({ value: mp.name, label: '项目「' + (mp.title || mp.name) + '」字幕（' + (mp.subtitleCount || 0) + ' 条）' }))
  ]
}]);
const status = ref('');
const statusClass = ref('');
const thinkText = ref('');
// 提示词占位文案随状态变：没 HTML 时讲"要什么样的页面"，已有 HTML 时讲"这次改什么"
const promptPlaceholder = computed(() => (hasHtml.value
  ? '描述这次要改什么，例如：\n· 换成紫色霓虹配色，并把标题放大\n· 字幕出现得太快，节奏放慢一些'
  : '描述你想要的 HTML 效果，例如：\n· 深空科技风格的标题动画页，标题为“我的作品集”\n· 每条字幕间隔两秒，依次从下方上浮淡入'));

// 项目状态条（原 renderMeta）：素材一栏同时反映字幕 / 背景音频 / 素材库勾选情况
const meta = computed(() => {
  const p = appState.project;
  const c = (p && p.content) || { scenes: [] };
  const sceneN = Array.isArray(c.scenes)
    ? c.scenes.filter((s) => s && typeof s.narration === 'string' && s.narration.trim()).length
    : 0;
  const mats = (p && p.materials) || [];
  const images = mats.filter((m) => m.kind === 'image').length;
  const videos = mats.filter((m) => m.kind === 'video').length;
  const picked = mats.filter((m) => m.selected).length;
  const subCount = (p && p.subtitleCount) || 0;
  const parts: string[] = [];
  if (subCount) parts.push('字幕 ' + subCount + ' 条');
  if (p && p.audioFile) parts.push('已配背景音频');
  if (mats.length) parts.push('素材 ' + mats.length + ' 个（图片 ' + images + ' · 视频 ' + videos + '，参与生成 ' + picked + '）');
  return {
    hasH: hasHtml.value,
    sceneN,
    subCount,
    matN: mats.length,
    matText: parts.length ? parts.join(' · ') : '无素材（可先到「字幕生成」页添加字幕，或在上方「项目素材」里添加图片 / 视频）'
  };
});

// 预览子组件的对外契约只有 reload()（Agent 成功后按新的 HTML 重载预览副本）
const previewRef = ref<{ reload: () => void } | null>(null);

// ===== 生成 / 修改 =====
let agentRunning = false;
async function runAgent(mode: 'generate' | 'modify'): Promise<void> {
  if (agentRunning) { toast('上一个请求还在处理中，请稍候'); return; }
  if (rendering.value) { toast('正在渲染视频，请等它结束再提交需求'); return; }
  const p = prompt.value.trim();
  if (!p) { toast('请先填写需求描述（上方提示词输入框）'); return; }
  agentRunning = true;
  const sceneN = meta.value.sceneN;
  // 方案B：生成/修改前提示将附带当前项目内容脚本（脚本为 HTML 的整体内容源）
  status.value = sceneN
    ? '将附带当前项目内容脚本（' + sceneN + ' 个场景），已提交给 Agent，处理中...'
    : '当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...';
  statusClass.value = '';
  // 本次生成/修改所选素材：字幕 + 素材库里**勾选**的图片/视频（顺序 = 列表顺序，提示词按此顺序列路径）。
  // 音轨不在其中：主进程在 HTML 落盘后按 project.audioFile 注入 <audio id="myv-bgm">。
  const materials = {
    subtitleProject: subSel.value,
    materialIds: ((appState.project && appState.project.materials) || []).filter((m) => m.selected).map((m) => m.id)
  };
  try {
    const call = (mode === 'generate')
      ? window.projectTools.generateHtml(appState.currentName, p, materials)
      : window.projectTools.modifyHtml(appState.currentName, p, materials);
    const res = await call;
    if (res && res.ok) {
      await refreshProject();
      previewRef.value?.reload();
      status.value = 'Agent 已更新 HTML' + (res.htmlPath ? '：' + res.htmlPath : '');
      statusClass.value = 'hf-ok';
      toast(mode === 'generate' ? 'HTML 已生成' : 'HTML 已修改');
    } else {
      const msg = (res && res.message) || '提交失败';
      status.value = msg;
      statusClass.value = 'hf-error';
      // 配置类（Key 无效 / 未启用 / 配置不完整 / Base URL 填错…）：主进程判好的分类 → 弹「去设置」
      // 状态行照样留着（框关掉后还能看见原因），但不叠 toast——弹窗已经把信息讲全了
      // 余额 / 欠费不在其中（主进程不会给它 needConfig）：改设置修不好余额，走内嵌状态行
      if (res && res.needConfig) {
        configPrompt.open(msg, res.needConfig, false, res.title);
      } else {
        toast(msg);
      }
      // 生成失败且项目原本就无 HTML：让预览回到「未生成」展示，避免误显示为已生成
      if (!appState.project?.htmlExists) previewRef.value?.reload();
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
// HfSelect 选项（原为 <option v-for>）
const qualityGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: qualityOptions.map((o) => ({ value: o.value, label: o.label })) }]);
const fpsGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: fpsOptions.map((o) => ({ value: o.value, label: o.label })) }]);

// 当前项目的覆盖值
const projectOverride = computed(() => ((appState.project && appState.project.render) || null));
const overridden = computed(() => isRenderOverridden(renderDefaults, projectOverride.value));
const optionNote = computed(() => (overridden.value ? '本项目自定义档位' : '跟随设置页默认：' + renderOptionsText(renderDefaults)));
// 当前所选质量的说明（选「快速预览」时明确提示画质代价）
const qualityHint = computed(() => {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === quality.value);
  return hit ? hit.hint + '；' : '';
});

// 用「项目覆盖 > 全局默认」的有效档位刷新下拉显示
function syncFromEffective(): void {
  const eff = effectiveRenderOptions();
  quality.value = eff.quality;
  fps.value = eff.fps;
}

// 下拉改动 → 写入当前项目的覆盖
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
  if (rendering.value) return;
  if (agentRunning) { toast('Agent 正在处理 HTML，请等它结束再转视频'); return; }
  const htmlPath = appState.project && appState.project.htmlPath;
  if (!htmlPath || !(appState.project && appState.project.htmlExists)) { toast('还没有 HTML，请先「生成 HTML」'); return; }
  renderModalVisible.value = true;
}
function closeRenderModal(): void {
  renderModalVisible.value = false;
}
// 确认：先关弹窗，再走原有渲染流程（进度显示在预览卡片的状态区，「视频预览」页看成品）
function confirmRenderVideo(): void {
  renderModalVisible.value = false;
  void onRenderVideo();
}
// ESC 关闭弹窗（与「从音频生成字幕」弹窗一致）
function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && renderModalVisible.value) closeRenderModal();
}

async function onRenderVideo(skipEnvGuard = false): Promise<void> {
  if (rendering.value) return;
  if (agentRunning) { toast('Agent 正在处理 HTML，请等它结束再转视频'); return; }
  const htmlPath = appState.project && appState.project.htmlPath;
  if (!htmlPath || !(appState.project && appState.project.htmlExists)) { toast('还没有 HTML，请先「生成 HTML」'); return; }
  const options = { quality: quality.value, fps: fps.value };
  // 渲染要 ffmpeg + hyperframes 两个运行环境包（不随安装包）：缺则在确认框里问用户，
  // 用户在框里点「继续」时回到这里（skipEnvGuard=true），不再重复弹框
  if (!skipEnvGuard) {
    const g = await envGate.guard(['ffmpeg', 'hyperframes'], '转成视频', () => { void onRenderVideo(true); });
    if (!g.ok) return;
  }
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
    } else if (res.needPacks && res.needPacks.length) {
      // 主进程校验发现缺包（例如并发期间被清理）：弹同一个框，确认后重来
      status.value = res.message || '需要先下载运行环境';
      statusClass.value = 'hf-error';
      void envGate.guard(res.needPacks, '转成视频', () => { void onRenderVideo(true); });
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
  const res = await window.projectTools.downloadHtml(appState.currentName);
  if (!res) return;
  if (res.ok) toast('已导出：' + res.savedPath);
  else if (!(res as { canceled?: boolean }).canceled) toast((res as { message?: string }).message || '下载失败');
}

// ===== 生命周期 =====
onMounted(() => {
  status.value = '';
  statusClass.value = '';
  thinkText.value = '';
  resetRenderProgress();   // 清掉上一次渲染的 trace 残留（渲染中若再次进入本页，随后仍会被新 trace 覆盖）
  syncFromEffective();     // 渲染档位显示：项目覆盖 > 设置页全局默认
  // 生成/修改过程的实时状态与 AI 思考过程：本页（子组件）自己订阅，主进程为单订阅语义
  window.projectTools.onHtmlProgress((info) => {
    if (!info) return;
    if (info.text) {
      status.value = String(info.text);
      statusClass.value = '';
    }
    thinkText.value = String(info.thinkText || '');
  });
  document.addEventListener('keydown', onModalKeydown);   // 「转视频」弹窗的 ESC 关闭
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onModalKeydown);
});
</script>
