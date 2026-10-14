<template>
  <div>
    <StepBar :page="'text-tts'" />
    <div class="hf-tabs">
      <button type="button" class="hf-tab" :class="{ active: activeTtsTab === 'synth' }" data-tab="synth" @click="activeTtsTab = 'synth'">文字生音频（TTS 合成）</button>
      <button type="button" class="hf-tab" :class="{ active: activeTtsTab === 'align' }" data-tab="align" @click="activeTtsTab = 'align'">字幕配音（逐句对齐）</button>
      <button type="button" class="hf-tab" :class="{ active: activeTtsTab === 'voice' }" data-tab="voice" @click="activeTtsTab = 'voice'">音色管理（克隆 / 改名 / 绑模型）</button>
    </div>
    <SynthSection v-show="activeTtsTab === 'synth'" />
    <AlignSection v-show="activeTtsTab === 'align'" />
    <VoiceSection v-show="activeTtsTab === 'voice'" />
  </div>
</template>

<script setup lang="ts">
// pages/TextTtsPage/index.vue —— 配音页共享壳（原 JS 版 textTts 模块 index.js 移植）
// Tab 切换 + 三卡组件（SynthSection / AlignSection / VoiceSection）：原独立「音色管理」页已并入第三个 Tab。
// 共享工具在同目录 helpers.ts（含三卡共用的 currentTab `activeTtsTab`——三卡据此在轮到自己显示时重拉列表）。
// 切 Tab 只有本页 Tab 按钮这一个入口：合成卡里的「管理音色」按钮已删除（连带 helpers 的切 Tab 信号一起清理），
// 因此这里不再需要 watch 信号 → 落 Tab 的那套机制。
import { onMounted } from 'vue'
import { activeTtsTab, ttsResultShown } from './helpers'
import StepBar from '@renderer/components/StepBar.vue'
import SynthSection from './SynthSection.vue'
import AlignSection from './AlignSection.vue'
import VoiceSection from './VoiceSection.vue'

// 进入页面就把 Tab 复位到第一个：activeTtsTab 是模块级共享 ref（三卡都要 watch 它），
// 不复位会停在上次离开时那个 Tab。放在 setup 顶层而不是 onMounted ——
// 子卡先于父组件挂载，若等父 onMounted 再改，已挂载的卡会白白多触发一次「切 Tab 刷新」。
activeTtsTab.value = 'synth';

onMounted(() => {
  // 进入页面重置结果卡标记（原 init 闭包内的 resultShown = false）
  ttsResultShown.value = false;
});
</script>
