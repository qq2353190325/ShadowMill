<template>
  <div>
    <StepBar :page="'video-preview'" />
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>视频预览</div>

      <div class="hf-toolbar">
        <span class="hf-file">{{ videoPath ? videoPath : '尚无视频产物' }}</span>
        <button class="hf-btn" :disabled="!videoPath" title="重新读取当前项目的视频产物" @click="onReload">重新加载</button>
      </div>

      <div class="hf-status" :class="statusClass">{{ statusText }}</div>

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
// 「转视频」按钮与渲染档位（质量/帧率）在「HTML生成」页（那里才拿得到 HTML 生成流程的上下文）；
// 本页职责只剩预览：进入页面自动加载 project.videoPath 指向的成品 MP4，无成品时给出引导文案。
// 渲染过程的状态显示沿用全局 renderProgress.text（[Render:trace] 解析结果），挂载时复位避免残留旧文案。
import { computed, nextTick, onMounted, ref } from 'vue'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { renderProgress, resetRenderProgress } from '@renderer/composables/useRenderProgress'
import StepBar from '@renderer/components/StepBar.vue'

const videoPath = ref<string | null>(null); // 成品 MP4 绝对路径（来自 project.videoPath）
const videoSrc = ref('');
const videoVisible = ref(false);
const localStatus = ref('');
const statusClass = ref('');

// 渲染中：全局 trace 解析文案优先；无则显示本页状态
const statusText = computed(() => renderProgress.text || localStatus.value);

const tipText = computed(() => '视频由「HTML生成」页的「转视频」按钮（及那里的质量 / 帧率档位）渲染；渲染完成后回到本页即可预览最新成品。');

function fileUrl(p: string): string {
  return 'file:///' + encodeURI(String(p).replace(/\\/g, '/'));
}

// 进入页面即加载当前项目成品；无成品时给出「去 HTML生成页转视频」的引导
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

onMounted(() => {
  resetRenderProgress();
  syncProjectVideo();
});
</script>
