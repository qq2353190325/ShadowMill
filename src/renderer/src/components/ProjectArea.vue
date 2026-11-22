<template>
  <!-- components/ProjectArea.vue —— 侧栏三模块之「项目区」（菜单下面、登录上面）
       DeepSeek 客户端式：标题行右侧一个 ＋ 新建项目，下面一条可滚动的项目列表，
       当前项目高亮；「打开目录」只在当前项右侧露出一个小按钮，不再单独占一行。
       点任意项目 = 切换 + 重进当前页（等价原 StepBar 第二行下拉的 @change）。 -->
  <section class="project-area">
    <div class="side-section-title">
      项目
      <button class="project-add" title="新建我的项目" @click="newVisible = true">＋</button>
    </div>
    <div class="project-list">
      <div
        v-for="p in appState.myProjects"
        :key="p.name"
        class="project-item"
        :class="{ active: p.name === appState.currentName }"
        :title="'切换到项目 ' + p.name"
        @click="onSelect(p.name)"
      >
        <span class="project-item-name">{{ p.name }}</span>
        <button
          v-if="p.name === appState.currentName"
          class="project-open"
          title="打开当前项目所在目录"
          @click.stop="openFolder"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6h6l2 2h10v11H3z" /></svg>
        </button>
      </div>
      <div v-if="!appState.myProjects.length" class="project-empty">暂无项目，点上方「新建项目」创建一个</div>
    </div>
    <NewProjectDialog v-model:visible="newVisible" @created="onCreated" />
  </section>
</template>

<script setup lang="ts">
// 切换后重进当前页：activeMenu 始终等于当前页（goPage('settings') 只开弹窗、不改它），
// 所以用它替代原 StepBar 的 props.page，切完项目照样刷新页面数据（与 pages/index.ts 的 pageNavKey 配合）。
import { ref } from 'vue'
import { activeMenu, appState, switchProject } from '@renderer/composables/useAppStore'
import { goPage } from '@renderer/pages'
import NewProjectDialog from '@renderer/components/NewProjectDialog.vue'

const newVisible = ref(false);

async function onSelect(name: string): Promise<void> {
  if (!name || name === appState.currentName) return;
  await switchProject(name);
  await goPage(activeMenu.value);
}

// NewProjectDialog 已完成「创建 + 切换」；这里只需重进当前页刷新页面数据
async function onCreated(): Promise<void> {
  await goPage(activeMenu.value);
}

function openFolder(): void {
  window.projectTools.openFolder(appState.currentName);
}
</script>
