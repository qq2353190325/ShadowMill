<template>
  <div class="ct-round">
    <div class="ct-user">{{ round.request }}</div>
    <div class="ct-card">
      <div class="ct-card-head">
        <span class="ct-version">第 {{ index + 1 }} 版</span>
        <span class="ct-meta">{{ sceneCount }} 个场景 · {{ round.totalChars }} 字 · 约 {{ fmtTime(Math.round(round.totalChars / charsPerSecond)) }}</span>
        <span v-if="current" class="ct-badge">当前</span>
        <span class="ct-actions">
          <button class="hf-btn ct-mini" @click="$emit('toggle')">{{ expanded ? '收起' : '展开' }}</button>
          <button v-if="!current" class="hf-btn ct-mini" :disabled="applying" @click="$emit('apply')">{{ applying ? '应用中…' : '应用此版本' }}</button>
        </span>
      </div>
      <div v-if="expanded" class="ct-scene-list">
        <div v-if="!scenes" class="ct-loading">正在读取这一版…</div>
        <template v-else>
          <div v-for="(s, si) in scenes" :key="s.id" class="ct-scene">
            <div class="ct-scene-title">场景 {{ si + 1 }}</div>
            <div class="ct-line"><span class="ct-label">旁白</span>{{ s.narration }}</div>
            <div v-if="s.visual" class="ct-line"><span class="ct-label">画面</span>{{ s.visual }}</div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/ContentPage/ScriptRoundCard.vue —— AI 创作里的一轮结果卡片。
// 索引里只有元数据（ScriptChatRoundMeta），完整场景由父组件按需读取后通过 scenes 传进来（懒加载）。
import { computed } from 'vue'
import { fmtTime } from '@renderer/utils/time'
import type { Scene, ScriptChatRoundMeta } from '@shared/types'

const props = defineProps<{
  round: ScriptChatRoundMeta
  index: number
  // 是否就是当前已应用到编辑器的那一版
  current: boolean
  expanded: boolean
  // 展开时才由父组件传入（null = 正在读 / 还没读）
  scenes: Scene[] | null
  // 估算时长用的字/秒口径（父组件传入 @shared/constants 的 EST_CHARS_PER_SEC，仅用于显示）
  charsPerSecond: number
  applying: boolean
}>();

defineEmits<{
  toggle: []
  apply: []
}>();

const sceneCount = computed(() => props.round.sceneCount || (props.scenes ? props.scenes.length : 0));
</script>

<style scoped>
.ct-round {
  margin-bottom: 14px;
}
.ct-user {
  margin-left: auto;
  max-width: 78%;
  width: fit-content;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 212, 255, 0.18);
  background: rgba(0, 212, 255, 0.06);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.ct-card {
  margin-top: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(0, 212, 255, 0.15);
  background: rgba(0, 212, 255, 0.03);
}
.ct-card-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.ct-version {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 600;
}
.ct-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--color-success);
  border: 1px solid rgba(0, 229, 160, 0.45);
}
.ct-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.ct-mini {
  font-size: 12px;
  padding: 4px 10px;
}
.ct-scene-list {
  margin-top: 10px;
  border-top: 1px solid rgba(0, 212, 255, 0.08);
  padding-top: 10px;
}
.ct-loading {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 0;
}
.ct-scene {
  padding: 6px 0 6px 10px;
  border-left: 2px solid rgba(0, 212, 255, 0.35);
  margin-bottom: 8px;
}
.ct-scene-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.ct-line {
  font-size: 13px;
  line-height: 1.7;
}
.ct-label {
  display: inline-block;
  min-width: 32px;
  color: var(--text-secondary);
  font-size: 12px;
  margin-right: 6px;
}
</style>
