<template>
  <div>
    <StepBar :page="'video-gen'" />
    <div class="card hf-page" style="margin-top:16px">
      <div class="hf-toolbar">
        <button class="hf-btn" @click="onOpen">选择 HTML 文件</button>
        <span class="hf-file">{{ hfHtmlPath ? escTxt(hfHtmlPath) : '未选择文件' }}</span>
        <button class="hf-btn hf-btn-primary" :disabled="!hfHtmlPath || rendering" @click="onRender">HyperFrames 转视频</button>
      </div>
      <div class="hf-status" :class="statusClass">{{ statusText }}</div>
      <iframe :src="frameSrc" class="hf-frame" sandbox="allow-scripts allow-same-origin"></iframe>
      <div class="hf-video-wrap" v-show="videoVisible">
        <video ref="videoEl" :src="videoSrc" class="hf-video" controls></video>
        <div class="hf-video-actions">
          <button class="hf-btn" @click="onShowFolder">在文件夹中显示</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/VideoPage.vue —— 视频生成页（原 pages/video/{template,index}.js 移植）
// 渲染过程的状态显示：全局 renderProgress.text（原 entry.js 解析 [Render:trace] 行写入 #hf-status）
// 与本页本地状态合并展示；页面挂载时复位（resetRenderProgress），避免残留旧渲染文案。
import { computed, onMounted, ref } from 'vue'
import { appState, refreshProject } from '../composables/useAppStore'
import { toast } from '../composables/useToast'
import { escTxt } from '../utils/escape'
import { renderProgress, resetRenderProgress } from '../composables/renderProgress'
import StepBar from '../components/StepBar.vue'

// 当前预览的 HTML 路径与最近渲染出的视频（页面级共享状态）
const hfHtmlPath = ref<string | null>(null);
const lastVideoPath = ref<string | null>(null);
const frameSrc = ref('');
const videoSrc = ref('');
const videoVisible = ref(false);
const videoEl = ref<HTMLVideoElement | null>(null);
const rendering = ref(false);
const localStatus = ref('');
const statusClass = ref('');

// 渲染中：全局 trace 解析文案优先；无则显示本页状态
const statusText = computed(() => renderProgress.text || localStatus.value);

async function setHtml(p: string): Promise<void> {
  hfHtmlPath.value = p;
  let src: string | null = null;
  try {
    // 优先经"预览外壳"加载：外壳在目标 HTML 同目录、内部使用本地 hyperframes-player
    // 组件，提供播放条（controls）与等比缩放，避免直接落地 iframe 导致无进度条、内容被裁剪。
    if (window.hfTools && typeof window.hfTools.previewShell === 'function') {
      const res = await window.hfTools.previewShell(p);
      if (res && res.ok && res.shellPath) {
        src = 'file:///' + encodeURI(res.shellPath.replace(/\\/g, '/'));
      }
    }
  } catch (e) { src = null; }
  frameSrc.value = src || ('file:///' + encodeURI(p.replace(/\\/g, '/')));
  localStatus.value = '已加载预览';
  statusClass.value = 'hf-ok';
}

async function onOpen(): Promise<void> {
  const p = await window.hfTools.openHtml();
  if (p) setHtml(p);
}

function onShowFolder(): void {
  if (lastVideoPath.value) window.hfTools.showInFolder(lastVideoPath.value);
}

async function onRender(): Promise<void> {
  const p = hfHtmlPath.value;
  if (!p) return;
  localStatus.value = '渲染中，请稍候（约 30 秒）...';
  statusClass.value = '';
  rendering.value = true;
  const res = await window.hfTools.renderVideo(p);
  rendering.value = false;
  if (res.ok) {
    lastVideoPath.value = res.outputVideo;
    renderProgress.text = ''; // 本地完成文案覆盖全局 trace 残留
    localStatus.value = '渲染完成：' + res.outputVideo;
    statusClass.value = 'hf-ok';
    // 回写视频产物到当前项目（我的项目）
    if (!appState.isBuiltin) {
      await window.projectTools.saveVideo(appState.currentName, res.outputVideo);
      await refreshProject();
    }
    videoSrc.value = 'file:///' + encodeURI(res.outputVideo.replace(/\\/g, '/'));
    videoVisible.value = true;
  } else {
    renderProgress.text = '';
    localStatus.value = (res as { message?: string }).message || '渲染失败';
    statusClass.value = 'hf-error';
  }
}

onMounted(() => {
  // 进入页面即复位状态（对应原 initHfPage 的清空与置位逻辑）
  hfHtmlPath.value = null;
  lastVideoPath.value = null;
  localStatus.value = '';
  statusClass.value = '';
  frameSrc.value = '';
  videoSrc.value = '';
  videoVisible.value = false;
  resetRenderProgress();

  // 联动“已生成”状态：未生成 HTML 时给出引导提示，但仍保留手动预览能力
  if (!appState.project?.htmlExists) {
    localStatus.value = '该项目尚未生成 HTML，请先在「HTML 生成」页生成；也可以点击“选择 HTML 文件”手动预览。';
  }

  // 当前项目已有 HTML → 自动加载预览
  if (appState.project?.htmlExists && appState.project.htmlPath) {
    setHtml(appState.project.htmlPath);
  }
});
</script>
