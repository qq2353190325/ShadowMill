<template>
  <div>
    <StepBar :page="'video-preview'" />
    <div class="card hf-page" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>{{ appState.isBuiltin ? '内置示例预览（只读）' : '视频预览' }}</div>

      <!-- 我的项目：本页只做预览，转视频入口在「HTML生成」页 -->
      <div v-if="!appState.isBuiltin" class="hf-toolbar">
        <span class="hf-file">{{ videoPath ? escTxt(videoPath) : '尚无视频产物' }}</span>
        <button class="hf-btn" :disabled="!videoPath" title="重新读取当前项目的视频产物" @click="onReload">重新加载</button>
      </div>

      <!-- 内置示例（只读）：没有「HTML生成」流程，故保留试渲染入口与档位 -->
      <template v-else>
        <div class="hf-toolbar">
          <span class="hf-file">{{ htmlPath ? escTxt(htmlPath) : '未找到示例 HTML' }}</span>
          <button class="hf-btn" :disabled="!htmlPath" @click="loadBuiltinPreview">重新加载预览</button>
          <button class="hf-btn hf-btn-primary" :disabled="!htmlPath || rendering" @click="onRender">HyperFrames 试渲染</button>
        </div>
        <div class="hf-toolbar">
          <!-- 渲染档位：内置示例只读，档位仅本次生效（不写入项目） -->
          <label class="sel-label">质量</label>
          <select v-model="quality" class="hf-select" :disabled="rendering">
            <option v-for="o in qualityOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <label class="sel-label">帧率</label>
          <select v-model="fps" class="hf-select" :disabled="rendering">
            <option v-for="o in fpsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <span class="hf-file">本次档位：{{ renderOptionsText({ quality, fps }) }}（只读示例，不落盘）</span>
        </div>
        <div class="hf-tip">{{ qualityHint }}</div>
      </template>

      <div class="hf-status" :class="statusClass">{{ statusText }}</div>

      <!-- 内置示例：未试渲染时显示示例 HTML 预览（外壳提供播放条与等比缩放） -->
      <iframe
        v-if="appState.isBuiltin && frameSrc && !videoVisible"
        :src="frameSrc"
        class="hf-frame"
        sandbox="allow-scripts allow-same-origin"
      ></iframe>

      <!-- 视频产物：我的项目进入页面自动加载；内置示例试渲染后出现 -->
      <div class="hf-video-wrap" v-show="videoVisible">
        <video :src="videoSrc" class="hf-video" controls></video>
        <div class="hf-video-actions">
          <button class="hf-btn" @click="onShowFolder">在文件夹中显示</button>
        </div>
      </div>

      <div class="hf-tip">{{ tipText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/VideoPreviewPage/index.vue —— 视频预览页（页面键 video-preview）
// 「转视频」按钮与渲染档位（质量/帧率）已并入「HTML生成」页（那里才拿得到 HTML 生成流程的上下文）；
// 本页职责只剩预览：我的项目自动加载 project.videoPath 指向的成品 MP4；内置示例为只读项目、
// 没有 HTML 生成流程可去，故保留示例 HTML 预览 + 试渲染入口（档位仅本次生效，不写项目）。
// 渲染过程的状态显示沿用全局 renderProgress.text（[Render:trace] 解析结果），挂载时复位避免残留旧文案。
import { computed, nextTick, onMounted, ref } from 'vue'
import type { RenderFps, RenderQuality } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { escTxt } from '@renderer/utils/escape'
import { renderProgress, resetRenderProgress } from '@renderer/composables/useRenderProgress'
import { FALLBACK_RENDER, RENDER_FPS_OPTIONS, RENDER_QUALITY_OPTIONS, renderOptionsText } from '@renderer/utils/render'
import { effectiveRenderOptions } from '@renderer/composables/useRenderOptions'
import StepBar from '@renderer/components/StepBar.vue'

const videoPath = ref<string | null>(null); // 成品 MP4 绝对路径（我的项目来自 project.videoPath）
const videoSrc = ref('');
const videoVisible = ref(false);
const frameSrc = ref('');       // 内置示例的 HTML 预览地址
const htmlPath = ref('');       // 内置示例的 index.html 绝对路径
const rendering = ref(false);
const localStatus = ref('');
const statusClass = ref('');

// 渲染中：全局 trace 解析文案优先；无则显示本页状态
const statusText = computed(() => renderProgress.text || localStatus.value);

const tipText = computed(() => (appState.isBuiltin
  ? '内置示例为只读：可在此预览示例效果并试渲染；要生成自己的作品，请先在顶部「工作项目」切换到「我的项目」。'
  : '视频由「HTML生成」页的「转视频」按钮（及那里的质量 / 帧率档位）渲染；渲染完成后回到本页即可预览最新成品。'));

// ===== 渲染档位（仅内置示例试渲染使用；我的项目在「HTML生成」页设置）=====
const qualityOptions = RENDER_QUALITY_OPTIONS;
const fpsOptions = RENDER_FPS_OPTIONS;
const quality = ref<RenderQuality>(FALLBACK_RENDER.quality);
const fps = ref<RenderFps>(FALLBACK_RENDER.fps);
const qualityHint = computed(() => {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === quality.value);
  return hit ? hit.hint : '';
});

function fileUrl(p: string): string {
  return 'file:///' + encodeURI(String(p).replace(/\\/g, '/'));
}

// 我的项目：进入页面即加载当前项目成品；无成品时给出「去 HTML生成页转视频」的引导
function syncProjectVideo(): void {
  const p = appState.project;
  if (p && p.videoExists && p.videoPath) {
    videoPath.value = p.videoPath;
    videoSrc.value = fileUrl(p.videoPath);
    videoVisible.value = true;
    localStatus.value = '已加载当前项目视频成品';
    statusClass.value = 'hf-ok';
    return;
  }
  videoPath.value = null;
  videoSrc.value = '';
  videoVisible.value = false;
  localStatus.value = (p && p.htmlExists)
    ? '该项目还没有视频成品：请到「HTML生成」页点「转视频」渲染。'
    : '该项目还没有 HTML：请先到「HTML生成」页生成 HTML，再点「转视频」。';
  statusClass.value = '';
}

async function onReload(): Promise<void> {
  await refreshProject();
  videoSrc.value = '';   // 先卸下旧源，强制 <video> 重新读盘（同一路径下重新渲染也能刷新）
  await nextTick();
  syncProjectVideo();
  toast(videoVisible.value ? '已重新加载视频成品' : '该项目暂无视频成品');
}

function onShowFolder(): void {
  if (videoPath.value) window.hfTools.showInFolder(videoPath.value);
}

// ===== 内置示例：HTML 预览 + 试渲染 =====
async function loadBuiltinPreview(): Promise<void> {
  const p = htmlPath.value;
  if (!p) { localStatus.value = '未找到示例 HTML'; statusClass.value = 'hf-error'; return; }
  let src: string | null = null;
  try {
    // 优先经"预览外壳"加载：外壳在目标 HTML 同目录、内部使用本地 hyperframes-player
    // 组件，提供播放条（controls）与等比缩放，避免直接落地 iframe 导致无进度条、内容被裁剪。
    if (window.hfTools && typeof window.hfTools.previewShell === 'function') {
      const res = await window.hfTools.previewShell(p);
      if (res && res.ok && res.shellPath) src = fileUrl(res.shellPath);
    }
  } catch (e) { src = null; }
  frameSrc.value = src || fileUrl(p);
  videoVisible.value = false;   // 重新加载预览 = 回到示例 HTML 预览（试渲染结果可再点「试渲染」查看）
  localStatus.value = '已加载示例预览';
  statusClass.value = 'hf-ok';
}

async function onRender(): Promise<void> {
  const p = htmlPath.value;
  if (!p) { toast('未找到示例 HTML'); return; }
  if (rendering.value) return;
  const options = { quality: quality.value, fps: fps.value };
  localStatus.value = '试渲染中，请稍候（' + renderOptionsText(options) + '，约 30 秒）...';
  statusClass.value = '';
  rendering.value = true;
  try {
    const res = await window.hfTools.renderVideo(p, options);
    resetRenderProgress(); // 用本地完成/失败文案覆盖全局 trace 残留
    if (res.ok) {
      videoPath.value = res.outputVideo;
      videoSrc.value = fileUrl(res.outputVideo);
      videoVisible.value = true;
      localStatus.value = '试渲染完成（' + renderOptionsText(options) + '）：' + res.outputVideo;
      statusClass.value = 'hf-ok';
    } else {
      localStatus.value = (res as { message?: string }).message || '渲染失败';
      statusClass.value = 'hf-error';
    }
  } catch (e) {
    resetRenderProgress();
    localStatus.value = '试渲染失败：' + (((e as Error) && (e as Error).message) || String(e));
    statusClass.value = 'hf-error';
  } finally {
    rendering.value = false;
  }
}

onMounted(() => {
  resetRenderProgress();
  if (appState.isBuiltin) {
    // 内置示例：档位取全局默认（只读项目没有项目级覆盖），并自动载入示例 HTML 预览
    const eff = effectiveRenderOptions();
    quality.value = eff.quality;
    fps.value = eff.fps;
    htmlPath.value = (appState.project && appState.project.htmlPath) || '';
    if (htmlPath.value) loadBuiltinPreview();
    else { localStatus.value = '未找到示例 HTML'; statusClass.value = 'hf-error'; }
    return;
  }
  syncProjectVideo();
});
</script>
