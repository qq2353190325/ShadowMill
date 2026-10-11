<template>
  <div class="project-bar" data-roled="1">
    <!-- 第一行：五节点流水线（内容脚本 → 配音 → 字幕 → HTML → 视频） -->
    <div class="project-bar-row">
      <div class="step-chain">
        <span class="step-node clickable" :class="[isPage('content') ? 'active-now' : '', contentDone ? 'done' : '']" @click="goPage('content')"><span class="step-dot"></span>内容脚本</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[(isPage('text-tts') || isPage('sound-copy')) ? 'active-now' : '', audioDone ? 'done' : '']" @click="goPage('text-tts')"><span class="step-dot"></span>配音</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('subtitle') ? 'active-now' : '', subDone ? 'done' : '']" @click="goPage('subtitle')"><span class="step-dot"></span>字幕</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('html-gen') ? 'active-now' : '', htmlDone ? 'done' : '']" @click="goPage('html-gen')"><span class="step-dot"></span>HTML</span>
        <span class="step-arrow">→</span>
        <span class="step-node clickable" :class="[isPage('video-gen') ? 'active-now' : '', videoDone ? 'done' : '']" @click="goPage('video-gen')"><span class="step-dot"></span>视频</span>
      </div>
    </div>
    <!-- 第二行：工作项目切换 / 新建 / 打开目录 -->
    <div class="project-bar-row">
      <span class="sel-label" style="font-size:12px;color:var(--text-secondary);letter-spacing:1px;flex:none">工作项目</span>
      <select v-model="selValue" class="hf-select" style="width:210px;flex:none" title="切换工作项目（我的项目 / 内置示例只读）" @change="onSelect">
        <optgroup label="我的项目">
          <option v-for="mp in appState.myProjects" :key="mp.name" :value="'my:' + mp.name">{{ mp.name }}{{ mp.hasHtml ? ' · HTML✓' : '' }}{{ mp.hasVideo ? ' · 视频✓' : '' }}</option>
        </optgroup>
        <optgroup label="内置示例">
          <option v-for="b in appState.builtinProjects" :key="b.name" :value="'builtin:' + b.name">{{ b.name }} · 内置</option>
        </optgroup>
      </select>
      <input v-show="showNewInput" ref="newNameEl" v-model="newName" class="hgen-input" placeholder="新项目名" style="flex:none;width:140px" @keydown.enter="createProject" />
      <button class="hf-btn" title="新建我的项目" style="padding:4px 10px;font-size:12px;flex:none" @click="toggleNew">新建项目</button>
      <button class="hf-btn" title="打开当前项目所在目录" style="padding:4px 10px;font-size:12px;flex:none" @click="openFolder">打开目录</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// components/StepBar.vue —— 项目链路状态条（原 window.App.renderStepBar 组件化）
// 原 [data-slot] 注入机制废弃：各页面模板顶部放置 <StepBar :page="..."/> 即等效。
import { computed, nextTick, ref } from 'vue'
import {
  appState, hasAudio, hasContent, hasHtml, hasSubtitle, hasVideo,
  refreshProject, switchProject, type PageKey
} from '@renderer/composables/useAppStore'
import { goPage } from '@renderer/pages'
import { toast } from '@renderer/composables/useToast'

const props = defineProps<{ page: PageKey }>()

const isPage = (pg: string): boolean => props.page === pg;
const contentDone = hasContent;
const audioDone = hasAudio;
const subDone = hasSubtitle;
const htmlDone = hasHtml;
const videoDone = hasVideo;

// —— 工作项目切换器（所有节点页共用的全局入口）：填充 / 切换 / 新建 / 打开目录 ——
const selValue = computed({
  get: () => (appState.isBuiltin ? 'builtin:' : 'my:') + appState.currentName,
  set: () => { /* 切换经 @change 统一处理 */ }
});

const showNewInput = ref(false);
const newName = ref('');
const newNameEl = ref<HTMLInputElement | null>(null);

async function onSelect(e: Event): Promise<void> {
  // 必须读 select 元素自身的新值：selValue 是 setter 为 no-op 的 computed，@change 时其值仍是旧项目
  const v = (e.target as HTMLSelectElement).value;
  if (!v) return;
  const isBuiltin = v.startsWith('builtin:');
  const name = v.slice(isBuiltin ? 8 : 3);
  await switchProject(name, isBuiltin);
  await goPage(props.page); // 切换后重进当前页，刷新全部状态
}

async function toggleNew(): Promise<void> {
  showNewInput.value = !showNewInput.value;
  if (showNewInput.value) {
    await nextTick();
    newNameEl.value?.focus();
  }
}

async function createProject(): Promise<void> {
  const nm = newName.value.trim();
  if (!nm) { toast('请输入项目名'); newNameEl.value?.focus(); return; }
  const res = await window.projectTools.create(nm);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '创建失败'); return; }
  newName.value = '';
  showNewInput.value = false;
  await refreshProject();
  await switchProject(nm, false);
  await goPage(props.page);
  toast('已创建并切换到项目「' + nm + '」');
}

function openFolder(): void {
  if (appState.isBuiltin) {
    if (appState.project && appState.project.htmlPath) window.projectTools.openFolderOf(appState.project.htmlPath);
    else toast('内置示例项目为只读；可在「工作项目」切换到「我的项目」');
    return;
  }
  window.projectTools.openFolder(appState.currentName);
}
</script>
