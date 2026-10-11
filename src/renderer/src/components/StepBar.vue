<template>
  <div class="project-bar" data-roled="1">
    <!-- 第一行：五节点流水线（内容脚本 → 配音 → 字幕 → HTML → 视频预览；转视频动作在 HTML 节点页内） -->
    <div class="project-bar-row">
      <div class="step-chain">
        <span class="step-node clickable" :class="[isPage('content') ? 'active-now' : '', contentDone ? 'done' : '']" @click="goPage('content')"><span class="step-dot"></span>内容脚本</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('text-tts') ? 'active-now' : '', audioDone ? 'done' : '']" @click="goPage('text-tts')"><span class="step-dot"></span>配音</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('subtitle') ? 'active-now' : '', subDone ? 'done' : '']" @click="goPage('subtitle')"><span class="step-dot"></span>字幕</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('html-gen') ? 'active-now' : '', htmlDone ? 'done' : '']" @click="goPage('html-gen')"><span class="step-dot"></span>HTML</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('video-preview') ? 'active-now' : '', videoDone ? 'done' : '']" @click="goPage('video-preview')"><span class="step-dot"></span>视频预览</span>
      </div>
    </div>
    <!-- 第二行：工作项目切换 / 新建（弹窗） / 打开目录 -->
    <div class="project-bar-row">
      <span class="sel-label" style="font-size:12px;color:var(--text-secondary);letter-spacing:1px;flex:none">工作项目</span>
      <HfSelect
        v-model="selValue"
        :groups="projectGroups"
        style="width:210px;flex:none"
        placeholder="暂无项目，请先「新建项目」"
        title="切换工作项目"
        @change="onSelect"
      />
      <button class="hf-btn" title="新建我的项目" style="padding:4px 10px;font-size:12px;flex:none" @click="newVisible = true">新建项目</button>
      <button class="hf-btn" title="打开当前项目所在目录" style="padding:4px 10px;font-size:12px;flex:none" @click="openFolder">打开目录</button>
    </div>
    <!-- 新建项目弹窗：输入名称 → 确认即创建并切换（创建成功后重进当前页刷新状态） -->
    <NewProjectDialog v-model:visible="newVisible" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
// components/StepBar.vue —— 项目链路状态条（原 window.App.renderStepBar 组件化）
// 原 [data-slot] 注入机制废弃：各页面模板顶部放置 <StepBar :page="..."/> 即等效。
// 新建项目改由 NewProjectDialog 弹窗承担（原「点按钮展开行内输入框」已废弃）。
import { computed, ref } from 'vue'
import {
  appState, hasAudio, hasContent, hasHtml, hasSubtitle, hasVideo,
  switchProject, type PageKey
} from '@renderer/composables/useAppStore'
import { goPage } from '@renderer/pages'
import NewProjectDialog from '@renderer/components/NewProjectDialog.vue'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'

const props = defineProps<{ page: PageKey }>()

const isPage = (pg: string): boolean => props.page === pg;
const contentDone = hasContent;
const audioDone = hasAudio;
const subDone = hasSubtitle;
const htmlDone = hasHtml;
const videoDone = hasVideo;

// —— 工作项目切换器（所有节点页共用的全局入口）：填充 / 切换 / 新建 / 打开目录 ——
// 下拉值是项目名（已无内置示例分组，不再需要 'my:' / 'builtin:' 前缀）
const projectGroups = computed<HfSelectGroup[]>(() => [{
  label: '',
  options: appState.myProjects.map((mp) => ({
    value: mp.name,
    label: mp.name + (mp.hasHtml ? ' · HTML✓' : '') + (mp.hasVideo ? ' · 视频✓' : '')
  }))
}]);

const selValue = computed({
  get: () => appState.currentName,
  set: () => { /* 切换经 @change 统一处理 */ }
});

const newVisible = ref(false);

async function onSelect(name: string): Promise<void> {
  // HfSelect 的 @change 直接给新值（原生 select 要读 event.target.value；selValue 是 no-op setter，不能靠它）
  if (!name) return;
  await switchProject(name);
  await goPage(props.page); // 切换后重进当前页，刷新全部状态
}

// 弹窗已完成「创建 + 切换」；这里只需重进当前页刷新页面数据
async function onCreated(): Promise<void> {
  await goPage(props.page);
}

function openFolder(): void {
  window.projectTools.openFolder(appState.currentName);
}
</script>
