<template>
  <!-- HTML生成页工作台：一屏三区 —— 左主区（预览 + 对话）、右侧配置栏。
       项目状态条（HTML/脚本/素材三格）按用户要求删掉；工作项目切换已挪到侧栏「工作项目」区。 -->
  <div class="hgen-workbench" :class="{ 'is-collapsed': sideCollapsed }">
    <div class="hgen-main">
      <!-- 预览卡：只放画面本体（状态 / 思考 / 播放条）；标题与两个产物动作都在右侧栏常驻「预览」分组 -->
      <section class="card hgen-preview-card">
        <PreviewSection
          ref="previewRef"
          :status="status"
          :status-class="statusClass"
          :think-text="thinkText"
          :rendering="rendering"
          :running="agentRunning"
        />
      </section>

      <!-- 对话区：仍是原来的「需求描述 + 生成/修改」，只换成输入框 + 按钮的样子，逻辑零改动 -->
      <section class="card hgen-chat-card">
        <div class="hgen-chat-head">
          <div class="panel-title-sm" style="margin:0">需求描述（提示词）</div>
          <span class="hg-help" style="letter-spacing:0" @click.stop>
            <span class="hg-help-icon">?</span>
            <span class="hg-help-pop" style="top:calc(100% + 8px);bottom:auto">{{ usageHint }}</span>
          </span>
        </div>
        <textarea v-model="prompt" class="hgen-subtitle hgen-chat-input" spellcheck="false" :placeholder="promptPlaceholder"></textarea>
        <div class="hgen-chat-foot">
          <!-- 第一行：主动作（生成 / 修改） -->
          <div class="hgen-chat-actions">
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
          </div>
          <!-- 第二行：产物动作（下载 HTML / 转视频），就在输入框下面，不用去右侧栏找 -->
          <div class="hgen-chat-actions hgen-chat-actions-sub">
            <button class="hf-btn" title="下载当前项目 HTML 到本地" @click="onDownload">下载 HTML</button>
            <button class="hf-btn hf-btn-primary" :disabled="!hasHtml || rendering" title="把当前 HTML 渲染成 MP4（约 30 秒）" @click="openRenderModal">转视频</button>
          </div>
        </div>
      </section>
    </div>

    <!-- 右侧栏：竖排 5 个手风琴块（一次只展开一个）+ 整条栏可收起 -->
    <WorkbenchSide v-model:collapsed="sideCollapsed">
      <template #other>
        <div class="hgen-side-sub">预览设置</div>
        <PreviewControls part="view" />
        <div class="hgen-side-sub">生成设置</div>
        <div class="hgen-row" style="margin-bottom:0">
          <span class="sel-label" style="flex:none;width:40px">字幕</span>
          <HfSelect v-model="subSel" :groups="subSelGroups" style="flex:1;min-width:0" title="按所选字幕逐条设计动画" />
        </div>
        <div class="hgen-row" style="margin-bottom:0">
          <label class="sel-label" style="flex:none;width:40px">画布</label>
          <HfSelect v-model="canvas" :groups="canvasGroups" :disabled="rendering" style="flex:1;min-width:0" @change="onCanvasChange" />
          <!-- 气泡向上 + 向左展开并限宽：右侧栏手风琴里这行不在视口顶端，向上不会顶出滚动区；
               向左才不会超出 300px 栏宽被裁 -->
          <span class="hg-help" style="letter-spacing:0" @click.stop>
            <span class="hg-help-icon">?</span>
            <span class="hg-help-pop" style="right:0;left:auto;max-width:240px">{{ canvasNote }} {{ canvasHint }}</span>
          </span>
        </div>
        <div class="hgen-block">
          <div class="panel-title-sm">全局视觉风格（整片视觉基调）</div>
          <input
            v-model="styleText"
            class="hgen-input"
            style="width:100%"
            placeholder="整支片子的视觉基调，如：深空科技 Cyber 风、霓虹紫渐变（只影响「生成 HTML」）"
            @change="onStyleChange"
          />
          <div class="hgen-tip">留空 = 未指定，模型按需求描述自行拟定；改完失焦即保存到项目。</div>
        </div>
        <div class="hgen-tip">画布与视觉风格都是生成前提：改完要重新「生成 HTML」或「按需求修改」才会体现在页面上。</div>
        <template v-if="chapterCount > 0">
          <div class="hgen-side-sub">章节（{{ chapterCount }} 章）</div>
          <ChapterSection v-model:prompt="prompt" />
        </template>
      </template>
    </WorkbenchSide>

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
// 本页只留「生成/修改 + 渲染」这条主动作链：右侧栏在 WorkbenchSide.vue、预览画面在 PreviewSection.vue。
// 布局为工作台：预览 + 对话常驻主区，素材/角色/音频/设置收进右侧竖排手风琴；逻辑与原版逐字一致。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RenderCanvas, RenderFps, RenderQuality, RuntimePackName } from '@shared/types'
import { appState, hasHtml, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { resetRenderProgress } from '@renderer/composables/useRenderProgress'
import { useEnvGate } from '@renderer/composables/useEnvGate'
import { useConfigPrompt } from '@renderer/composables/useConfigPrompt'
import {
  FALLBACK_RENDER,
  RENDER_CANVAS_OPTIONS,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITY_OPTIONS,
  canvasLabel,
  isRenderOverridden,
  normalizeCanvas,
  renderOptionsText
} from '@renderer/utils/render'
import { effectiveRenderOptions, renderBackend, renderDefaults, saveProjectRenderOverride } from '@renderer/composables/useRenderOptions'
import { useProjectMeta } from '@renderer/composables/useProjectMeta'
import { newTaskId } from '@renderer/utils/taskId'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import ChapterSection from './ChapterSection.vue'
import PreviewSection from './PreviewSection.vue'
import PreviewControls from './PreviewControls.vue'
import WorkbenchSide from './WorkbenchSide.vue'

// ===== 右侧栏：竖排手风琴 + 整条栏收起态（状态只在本页，不落盘，重进页面默认展开） =====
const sideCollapsed = ref(false);
const chapterCount = computed(() => ((appState.project && appState.project.chapters) || []).length);

// ===== 生成/修改 =====
const envGate = useEnvGate();
// 配置类错误弹窗（Key 无效 / 余额不足 / 配置不完整…）：主进程判好分类，本页只负责触发
const configPrompt = useConfigPrompt();
const prompt = ref('');
const subSel = ref('');

// ===== 字幕素材下拉选项 =====
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

// ===== 画布（成片尺寸）——**项目属性，不是渲染档位** =====
// 同一个值决定三件事：① 生成提示词里给模型的版式尺寸 ② 预览 iframe 的画布 ③ 渲染入口注入的 data-resolution。
const canvas = ref<RenderCanvas>(normalizeCanvas(appState.project && appState.project.canvas));
const canvasGroups = computed<HfSelectGroup[]>(() => [{
  label: '',
  options: RENDER_CANVAS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
}]);
// 画布 ? 气泡：前半句随画布变，后半句固定（「改完要重新生成」那句在右侧设置分组里统一说一次）
const canvasNote = computed(() => '预览与成片都按「' + canvasLabel(canvas.value) + '」这块画布。');
const canvasHint = '换画布不会自动重排已有页面：版式是生成时按画布排的，模型若按横屏排过版，切到竖屏 / 方形会留下黑边或裁切。';
function syncCanvas(): void {
  canvas.value = normalizeCanvas(appState.project && appState.project.canvas);
}
async function onCanvasChange(): Promise<void> {
  const res = await window.projectTools.setCanvas(appState.currentName, canvas.value);
  if (!res || !res.ok) {
    toast((res as { message?: string })?.message || '保存画布失败');
    syncCanvas();
    return;
  }
  await refreshProject();
  syncCanvas();
  previewRef.value?.reload();   // 预览画布尺寸变了：重载 iframe，缩放比按新画布重算
}

// ===== 全局视觉风格（项目属性 content.style）=====
// 只影响 HTML 生成：主进程 buildStyleBlock() 无条件注入提示词；配音与字幕不读它。
const styleText = ref('');
function syncStyle(): void {
  styleText.value = (appState.project && appState.project.content && appState.project.content.style) || '';
}
// 失焦即落盘：project:save-content 是整份 content 覆盖，所以必须把现有 scenes 原样带回
async function onStyleChange(): Promise<void> {
  const cur = appState.project && appState.project.content;
  const scenes = (cur && Array.isArray(cur.scenes)) ? cur.scenes : [];
  const res = await window.projectTools.saveContent(appState.currentName, { style: styleText.value.trim(), scenes });
  if (!res || !res.ok) {
    toast((res as { message?: string })?.message || '保存视觉风格失败');
    syncStyle();
    return;
  }
  await refreshProject();
  syncStyle();
}

const promptPlaceholder = computed(() => (hasHtml.value
  ? '描述这次要改什么，例如：\n· 换成紫色霓虹配色，并把标题放大\n· 字幕出现得太快，节奏放慢一些'
  : '描述你想要的 HTML 效果，例如：\n· 深空科技风格的标题动画页，标题为“我的作品集”\n· 每条字幕间隔两秒，依次从下方上浮淡入'));

// meta 仍被 runAgent 用来判断附带的内容脚本场景数；usageHint 收进对话区标题右侧的 ? 气泡
const { meta, usageHint } = useProjectMeta();

// 预览子组件的对外契约只有 reload()（Agent 成功后按新的 HTML 重载预览副本）
const previewRef = ref<{ reload: () => void } | null>(null);

// ===== 生成 / 修改 =====
const agentRunning = ref(false);
async function runAgent(mode: 'generate' | 'modify'): Promise<void> {
  if (agentRunning.value) { toast('上一个请求还在处理中，请稍候'); return; }
  if (rendering.value) { toast('正在渲染视频，请等它结束再提交需求'); return; }
  const p = prompt.value.trim();
  if (!p) { toast('请先填写需求描述（下方提示词输入框）'); return; }
  agentRunning.value = true;
  // 任务 id：本页的进度只认它（见 preload 的 onTaskProgress 与 shared/types 的 HtmlProgressPayload）
  const taskId = newTaskId('html');
  thinkText.value = '';
  const off = window.projectTools.onTaskProgress(taskId, (info) => {
    if (!info) return;
    if (info.text) {
      status.value = String(info.text);
      statusClass.value = '';
    }
    thinkText.value = String(info.thinkText || '');
  });
  const sceneN = meta.value.sceneN;
  status.value = sceneN
    ? '将附带当前项目内容脚本（' + sceneN + ' 个场景），已提交给 Agent，处理中...'
    : (meta.value.missVisual
      ? '当前项目的内容脚本都缺「画面分镜」，附带不到提示词里，将仅按需求描述生成。已提交给 Agent，处理中...'
      : '当前项目无内容脚本，将仅按需求描述生成。已提交给 Agent，处理中...');
  statusClass.value = '';
  // 本次生成/修改所选素材：字幕 + 素材库里**勾选**的图片/视频（顺序 = 列表顺序）
  const materials = {
    subtitleProject: subSel.value,
    materialIds: ((appState.project && appState.project.materials) || []).filter((m) => m.selected).map((m) => m.id),
    taskId
  };
  try {
    const call = (mode === 'generate')
      ? window.projectTools.generateHtml(appState.currentName, p, materials)
      : window.projectTools.modifyHtml(appState.currentName, p, materials);
    const res = await call;
    if (res && res.ok) {
      await refreshProject();
      previewRef.value?.reload();
      status.value = (res.message || 'Agent 已更新 HTML') + (res.htmlPath ? '：' + res.htmlPath : '');
      statusClass.value = 'hf-ok';
      toast(mode === 'generate' ? 'HTML 已生成' : 'HTML 已修改');
    } else {
      const msg = (res && res.message) || '提交失败';
      status.value = msg;
      statusClass.value = 'hf-error';
      if (res && res.needConfig) {
        configPrompt.open(msg, res.needConfig, false, res.title);
      } else {
        toast(msg);
      }
      if (!appState.project?.htmlExists) previewRef.value?.reload();
    }
  } finally {
    off();
    agentRunning.value = false;
  }
}
function onGenerate(): void {
  if (rendering.value) { toast('正在渲染视频，请等它结束再提交需求'); return; }
  void runAgent('generate');
}
function onModify(): void {
  if (!appState.project?.htmlExists) { toast('还没有 HTML，先点「生成 HTML」'); return; }
  runAgent('modify');
}

// ===== 转视频（整个视频环节就这一个按钮，成品到「视频预览」页看）=====
const rendering = ref(false);
const qualityOptions = RENDER_QUALITY_OPTIONS;
const fpsOptions = RENDER_FPS_OPTIONS;
const quality = ref<RenderQuality>(FALLBACK_RENDER.quality);
const fps = ref<RenderFps>(FALLBACK_RENDER.fps);
const qualityGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: qualityOptions.map((o) => ({ value: o.value, label: o.label })) }]);
const fpsGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: fpsOptions.map((o) => ({ value: o.value, label: o.label })) }]);

const projectOverride = computed(() => ((appState.project && appState.project.render) || null));
const overridden = computed(() => isRenderOverridden(renderDefaults, projectOverride.value));
const optionNote = computed(() => (overridden.value ? '本项目自定义档位' : '跟随设置页默认：' + renderOptionsText(renderDefaults)));
const qualityHint = computed(() => {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === quality.value);
  return hit ? hit.hint + '；' : '';
});

function syncFromEffective(): void {
  const eff = effectiveRenderOptions();
  quality.value = eff.quality;
  fps.value = eff.fps;
}
async function onOptionChange(): Promise<void> {
  const res = await saveProjectRenderOverride({ quality: quality.value, fps: fps.value });
  if (!res.ok && res.message) toast(res.message);
}
async function onResetOptions(): Promise<void> {
  const res = await saveProjectRenderOverride(null);
  if (res.ok) syncFromEffective();
  else if (res.message) toast(res.message);
}

const renderModalVisible = ref(false);
function openRenderModal(): void {
  if (rendering.value) return;
  if (agentRunning.value) { toast('Agent 正在处理 HTML，请等它结束再转视频'); return; }
  const htmlPath = appState.project && appState.project.htmlPath;
  if (!htmlPath || !(appState.project && appState.project.htmlExists)) { toast('还没有 HTML，请先「生成 HTML」'); return; }
  renderModalVisible.value = true;
}
function closeRenderModal(): void {
  renderModalVisible.value = false;
}
function confirmRenderVideo(): void {
  renderModalVisible.value = false;
  void onRenderVideo();
}
function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && renderModalVisible.value) closeRenderModal();
}

async function onRenderVideo(skipEnvGuard = false): Promise<void> {
  if (rendering.value) return;
  if (agentRunning.value) { toast('Agent 正在处理 HTML，请等它结束再转视频'); return; }
  const htmlPath = appState.project && appState.project.htmlPath;
  if (!htmlPath || !(appState.project && appState.project.htmlExists)) { toast('还没有 HTML，请先「生成 HTML」'); return; }
  const options = { quality: quality.value, fps: fps.value, canvas: canvas.value };
  // 缺包守卫要跟主进程选的后端一致：两个 Rust 内核路径不需要 103MB 的 hyperframes 包
  if (!skipEnvGuard) {
    const packs: RuntimePackName[] = renderBackend.value === 'hyperframes'
      ? ['ffmpeg', 'hyperframes']
      : ['ffmpeg', 'vidrender'];
    const g = await envGate.guard(packs, '转成视频', () => { void onRenderVideo(true); });
    if (!g.ok) return;
  }
  status.value = '正在准备渲染...';
  statusClass.value = '';
  rendering.value = true;
  try {
    const res = await window.hfTools.renderVideo(htmlPath, options);
    resetRenderProgress();
    if (res.ok) {
      const secs = res.elapsedMs ? (res.elapsedMs / 1000).toFixed(1) + 's' : '—';
      status.value = '视频已生成（耗时 ' + secs + ' · ' + renderOptionsText(options) + '）：' + res.outputVideo;
      statusClass.value = 'hf-ok';
      await window.projectTools.saveVideo(appState.currentName, res.outputVideo);
      await refreshProject();
      toast('视频已生成，可到「视频预览」页查看');
    } else if (res.needPacks && res.needPacks.length) {
      status.value = res.message || '需要先下载运行环境';
      statusClass.value = 'hf-error';
      void envGate.guard(res.needPacks, '转成视频', () => { void onRenderVideo(true); });
    } else {
      status.value = (res as { message?: string }).message || '渲染失败';
      statusClass.value = 'hf-error';
      toast(status.value);
    }
  } catch (e) {
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
  resetRenderProgress();
  syncFromEffective();
  syncCanvas();
  syncStyle();
  document.addEventListener('keydown', onModalKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onModalKeydown);
});
</script>
