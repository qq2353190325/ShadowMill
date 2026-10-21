<template>
  <div>
    <StepBar :page="'content'" />
    <!-- 两个 Tab 常驻可见：默认「场景编辑」（= 原来的页面），「AI 创作」是对话式生成/修改 -->
    <div class="hf-tabs">
      <button class="hf-tab" :class="{ active: tab === 'edit' }" @click="tab = 'edit'">场景编辑</button>
      <button class="hf-tab" :class="{ active: tab === 'chat' }" @click="tab = 'chat'">AI 创作</button>
    </div>
    <!-- v-show 而非 v-if：切 Tab 不销毁组件，输入框草稿与展开状态都保留 -->
    <div v-show="tab === 'edit'">
      <SceneEditor />
    </div>
    <div v-show="tab === 'chat'">
      <AiChatPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/ContentPage/index.vue —— 内容脚本页外壳：StepBar + 两个 Tab（场景编辑 / AI 创作）。
// 场景状态与保存逻辑在 ./helpers（模块级单例，两个 Tab 共享同一份 scenes）；本文件只是外壳。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import StepBar from '@renderer/components/StepBar.vue'
import { loadScenes, flushPending } from './helpers'
import SceneEditor from './SceneEditor.vue'
import AiChatPanel from './AiChatPanel.vue'

// 默认场景编辑：空项目也停在这里（用户可以先自己填；AI 是右侧常驻 Tab，不是默认路径）
const tab = ref<'edit' | 'chat'>('edit');

// 进入页面即从当前项目加载（goPage 会重建页面组件，这里每次都会重新拉一次）
onMounted(loadScenes);
// 离开页面时把还在防抖里的改动写掉（只写"确有快照"的，避免切项目时写串）
onBeforeUnmount(flushPending);
</script>
