<template>
  <div>
    <StepBar :page="'video-preview'" />
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>视频预览</div>

      <div class="hf-toolbar">
        <span class="sel-label">预览项目</span>
        <!-- 只列「有视频成品」的项目：下拉里每一项都能直接播，不会选到空项目。
             切换只影响本页播放的内容，**不动工作项目**（appState.currentName 保持不变）。 -->
        <HfSelect
          v-model="selectedName"
          :groups="previewGroups"
          style="width:300px;flex:none"
          title="选择要预览哪个项目的视频成品（仅本页生效，不切换工作项目）"
          @change="onProjectChange"
        />
        <span class="hf-file" :title="videoPath || ''">{{ videoPath ? videoPath : '尚无视频产物' }}</span>
        <button class="hf-btn" :disabled="!videoPath" title="在文件夹中显示该视频成品" @click="onShowFolder">在文件夹中显示</button>
        <button class="hf-btn" title="重新读取项目列表与所选项目的视频产物" @click="onReload">重新加载</button>
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
// 职责只有预览：默认预览**当前工作项目**的成品 MP4，也可在下拉里选另一个「有视频成品」的项目来看
// （只换本页播放的内容，不切换工作项目——切项目会牵动其它页面的上下文，不该由一个预览动作顺手做掉）。
// 数据来源：项目清单用 project:list 的 ProjectMeta（hasVideo/hasHtml 已做过文件存在性判定），
// 成品路径用 project:load 的 videoPath；因此本页不需要新增任何 IPC 频道。
// 「转视频」按钮与渲染档位仍在「HTML生成」页（那里才拿得到 HTML 生成流程的上下文）。
// 渲染过程的状态显示沿用全局 renderProgress.text（[Render:trace] 解析结果），挂载时复位避免残留旧文案。
import { computed, nextTick, onMounted, ref } from 'vue'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { renderProgress, resetRenderProgress } from '@renderer/composables/useRenderProgress'
import StepBar from '@renderer/components/StepBar.vue'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'

const selectedName = ref(appState.currentName); // 本页预览哪个项目（默认 = 当前工作项目）
const videoPath = ref<string | null>(null);     // 所选项目的成品 MP4 绝对路径
const videoSrc = ref('');
const videoVisible = ref(false);
const localStatus = ref('');
const statusClass = ref('');

// 渲染中：全局 trace 解析文案优先；无则显示本页状态
const statusText = computed(() => renderProgress.text || localStatus.value);

const tipText = computed(() => '视频由「HTML生成」页的「转视频」按钮（及那里的质量 / 帧率档位）渲染；渲染完成后回到本页即可预览最新成品。下拉里只列出已经有视频成品的项目，选它只换本页播放的内容，不会切换工作项目。');

function fileUrl(p: string): string {
  return 'file:///' + encodeURI(String(p).replace(/\\/g, '/'));
}

function titleOf(name: string): string {
  const m = appState.myProjects.find((x) => x.name === name);
  if (m) return m.title || m.name;
  if (appState.project && appState.project.name === name) return appState.project.title || name;
  return name;
}
function hasVideoOf(name: string): boolean {
  const m = appState.myProjects.find((x) => x.name === name);
  return !!(m && m.hasVideo);
}

// 下拉选项：当前工作项目（始终在，作为本页默认视图）+ 其余**有视频成品**的项目
const previewGroups = computed<HfSelectGroup[]>(() => {
  const current = appState.currentName;
  return [{
    label: '',
    options: [
      { value: current, label: '当前项目 · ' + titleOf(current) + (hasVideoOf(current) ? '' : '（无视频成品）') },
      ...appState.myProjects
        .filter((m) => m.name !== current && m.hasVideo)
        .map((m) => ({ value: m.name, label: (m.title || m.name) + ' · 视频✓' }))
    ]
  }];
});

// 载入所选项目的成品：先卸下旧源（同一路径重新渲染后也能刷新），再按存在性判定播 / 给引导文案
async function loadSelected(): Promise<void> {
  videoSrc.value = '';
  videoVisible.value = false;
  videoPath.value = null;
  const name = selectedName.value;
  const entry = appState.myProjects.find((m) => m.name === name);
  const hasVideo = !!(entry && entry.hasVideo);
  const hasHtml = !!(entry && entry.hasHtml);
  const proj = (name === appState.currentName)
    ? appState.project
    : await window.projectTools.load(name).catch(() => null);
  const vp = (proj && proj.videoPath) || '';
  if (hasVideo && vp) {
    await nextTick();
    videoPath.value = vp;
    videoSrc.value = fileUrl(vp);
    videoVisible.value = true;
    localStatus.value = '已加载「' + titleOf(name) + '」的视频成品';
    statusClass.value = 'hf-ok';
    return;
  }
  localStatus.value = hasHtml
    ? '项目「' + titleOf(name) + '」还没有视频成品：把它切为工作项目，到「HTML生成」页点「转视频」渲染。'
    : '项目「' + titleOf(name) + '」还没有 HTML：把它切为工作项目，先到「HTML生成」页生成 HTML，再点「转视频」。';
  statusClass.value = '';
}

// 切换预览项目（HfSelect 的 @change 直接给新值）
async function onProjectChange(): Promise<void> {
  await loadSelected();
}

async function onReload(): Promise<void> {
  await refreshProject();
  // 所选项目可能已被删除 / 改名：回落到当前工作项目，避免停在一个不存在的项目上
  if (!appState.myProjects.some((m) => m.name === selectedName.value)) selectedName.value = appState.currentName;
  await loadSelected();
  toast(videoVisible.value ? '已重新加载视频成品' : '该项目暂无视频成品');
}

function onShowFolder(): void {
  if (videoPath.value) window.hfTools.showInFolder(videoPath.value);
}

onMounted(() => {
  resetRenderProgress();
  void loadSelected();
});
</script>
