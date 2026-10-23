<template>
  <div v-if="chapters.length" class="hgen-block">
    <div class="panel-head">
      <div class="panel-title-sm" style="margin:0">
        章节
        <span class="ch-sub">{{ chapters.length }} 章 · 共 {{ fmtTime(total) }}</span>
      </div>
      <div class="panel-head-actions">
        <span class="ch-sub" title="骨架 index.html 由应用生成，章节代码在 pages/ 下">章节模式</span>
      </div>
    </div>

    <!-- 只读列表：每行 = 一章（序号 / 标题 / 起止 / 时长 / 文件）。「改这一章」只把范围填进
         上方需求描述，真正的修改仍走「按需求修改」——不给每章造一套独立入口，避免两条修改链。 -->
    <div class="ch-list">
      <div v-for="(c, i) in chapters" :key="c.id" class="ch-row">
        <span class="ch-idx">{{ i + 1 }}</span>
        <span class="ch-title" :title="c.summary || c.title">{{ c.title }}</span>
        <span class="ch-time">{{ fmtTime(offsets[i]) }}–{{ fmtTime(offsets[i] + c.duration) }}</span>
        <span class="ch-dur">{{ c.duration.toFixed(1) }}s</span>
        <span class="ch-file" :title="'本章代码文件'">{{ relPath(c.id) }}</span>
        <button class="hf-btn ch-pick" :title="'把「只改第 ' + (i + 1) + ' 章」填进需求描述，再点「按需求修改」'" @click="onPick(i)">改这一章</button>
      </div>
    </div>

    <div class="hgen-tip">
      章节由「生成 HTML」时按叙事段落自动切分（一章 4–8 场）；每章的时间都从 0 开始，整片的起点由应用装配。
      点「改这一章」会把范围填进需求描述，再点「按需求修改」只改这一章，其余章节保持不动。
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/ChapterSection.vue —— 「章节」只读列表（章节化长片 / W3）
// 自包含：章节清单就是 appState.project.chapters（project.json 的索引字段），落盘后由页面 refreshProject 刷新。
// 唯一的对外交互是「改这一章」→ 把范围写回需求描述（v-model:prompt），不自己调用修改接口：
// 修改链只有「按需求修改」一条，进度、失败分类、预览重载都复用那一条，不在这里另起一份。
import { computed } from 'vue'
import type { ProjectChapter } from '@shared/types'
import { appState } from '@renderer/composables/useAppStore'
import { fmtTime } from '@renderer/utils/time'

// prompt 是 v-model:prompt 的接收端：本组件只写不读（读它没有意义，需求描述由父页维护）
defineProps<{ prompt?: string }>()
const emit = defineEmits<{ (e: 'update:prompt', v: string): void }>()

const chapters = computed<ProjectChapter[]>(() => (appState.project && appState.project.chapters) || [])

// 起始秒数（与主进程 chapters.chapterOffsets 同一算法：第 1 章 0，之后逐章累加）
const offsets = computed<number[]>(() => {
  const out: number[] = []
  let at = 0
  for (const c of chapters.value) {
    out.push(at)
    at += Number(c.duration) || 0
  }
  return out
})
const total = computed(() => chapters.value.reduce((s, c) => s + (Number(c.duration) || 0), 0))

function relPath(id: string): string {
  return 'pages/' + id + '.js'
}

// 「只改第 N 章」：把范围与文件名写进需求描述，用户接着补「怎么改」
function onPick(i: number): void {
  const c = chapters.value[i]
  if (!c) return
  emit('update:prompt', '只改第 ' + (i + 1) + ' 章（' + relPath(c.id) + '）：\n')
}
</script>
