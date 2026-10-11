<template>
  <div>
    <StepBar :page="'text-tts'" />
    <div class="hf-tabs">
      <button type="button" class="hf-tab" :class="{ active: activeTab === 'synth' }" data-tab="synth" @click="activeTab = 'synth'">文字生音频（TTS 合成）</button>
      <button type="button" class="hf-tab" :class="{ active: activeTab === 'align' }" data-tab="align" @click="activeTab = 'align'">字幕配音（逐句对齐）</button>
      <button type="button" class="hf-tab" :class="{ active: activeTab === 'voice' }" data-tab="voice" @click="activeTab = 'voice'">音色管理（克隆 / 改名 / 绑模型）</button>
    </div>
    <SynthSection v-show="activeTab === 'synth'" />
    <AlignSection v-show="activeTab === 'align'" />
    <VoiceSection v-show="activeTab === 'voice'" />
  </div>
</template>

<script setup lang="ts">
// pages/TextTtsPage/index.vue —— 配音页共享壳（原 JS 版 textTts 模块 index.js 移植）
// Tab 切换 + 三卡组件（SynthSection / AlignSection / VoiceSection）：原独立「音色管理」页已并入第三个 Tab。
// 共享工具在同目录 helpers.ts。
import { onMounted, ref, watch } from 'vue'
import { ttsResultShown, voiceTabRequest } from './helpers'
import StepBar from '@renderer/components/StepBar.vue'
import SynthSection from './SynthSection.vue'
import AlignSection from './AlignSection.vue'
import VoiceSection from './VoiceSection.vue'

const activeTab = ref<'synth' | 'align' | 'voice'>('synth');

function goVoiceTab(): void {
  activeTab.value = 'voice';
  voiceTabRequest.value = false; // 消费掉信号，避免下次进本页误落在音色管理 Tab
  document.getElementById('content')?.scrollTo({ top: 0 });
}

// 「管理音色」按钮（合成卡片内）通过 helpers 的布尔信号请求切 Tab
watch(voiceTabRequest, (v) => { if (v) goVoiceTab(); });

onMounted(() => {
  // 进入页面重置结果卡标记（原 init 闭包内的 resultShown = false）
  ttsResultShown.value = false;
  // 从别的页面经「管理音色」跳进来时，信号先于挂载置位 → 直接落在音色管理 Tab
  if (voiceTabRequest.value) goVoiceTab();
});
</script>
