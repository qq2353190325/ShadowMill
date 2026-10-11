<template>
  <div>
    <StepBar :page="'text-tts'" />
    <div class="hf-tabs">
      <button type="button" class="hf-tab" :class="{ active: activeTab === 'synth' }" data-tab="synth" @click="activeTab = 'synth'">文字生音频（TTS 合成）</button>
      <button type="button" class="hf-tab" :class="{ active: activeTab === 'align' }" data-tab="align" @click="activeTab = 'align'">字幕配音（逐句对齐）</button>
    </div>
    <SynthSection v-show="activeTab === 'synth'" />
    <AlignSection v-show="activeTab === 'align'" />
  </div>
</template>

<script setup lang="ts">
// pages/TextTtsPage/index.vue —— 文字生音频页共享壳（原 JS 版 textTts 模块 index.js 移植）
// Tab 切换 + 两卡组件（SynthSection / AlignSection）；共享工具在同目录 helpers.ts。
import { onMounted, ref } from 'vue'
import { ttsResultShown } from './helpers'
import StepBar from '@renderer/components/StepBar.vue'
import SynthSection from './SynthSection.vue'
import AlignSection from './AlignSection.vue'

const activeTab = ref<'synth' | 'align'>('synth');

onMounted(() => {
  // 进入页面重置结果卡标记（原 init 闭包内的 resultShown = false）
  ttsResultShown.value = false;
});
</script>
