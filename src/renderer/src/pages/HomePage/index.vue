<template>
  <div>
    <section class="hero">
      <span class="hero-tag">影坊 · SHADOWMILL</span>
      <h1>一站式音视频创作流水线</h1>
      <p>以“项目”为单位贯通：内容脚本 → 配音 → 字幕 → HTML → 视频，一键生成。</p>
      <p class="hero-sub">CYBER UI · 深空科技 视觉主题 · 语音识别与视频渲染均在本机完成</p>
    </section>
    <div class="flow-pipeline" id="home-flow">
      <template v-for="(n, i) in flowDefs" :key="n.page">
        <div class="flow-node" :class="{ 'flow-done': n.done }" :data-page="n.page" style="cursor:pointer" @click="goPage(n.page)">
          <span class="flow-node-index">{{ n.idx }}</span><h3>{{ n.t }}</h3><p>{{ n.d }}</p>
          <span v-if="n.done" class="flow-badge">已完成</span>
        </div>
        <i v-if="i < flowDefs.length - 1" class="flow-arrow">→</i>
      </template>
    </div>
    <div class="metric-grid">
      <div class="metric-card"><div class="metric-value">5+</div><div class="metric-label">支持音频格式</div></div>
      <div class="metric-card"><div class="metric-value">1080P</div><div class="metric-label">导出分辨率</div></div>
      <div class="metric-card"><div class="metric-value">5</div><div class="metric-label">项目链路节点</div></div>
      <div class="metric-card"><div class="metric-value">MP4</div><div class="metric-label">视频输出格式</div></div>
    </div>

    <!-- 我的项目：只做“选择 / 打开”，新建入口统一在顶部「工作项目」栏（首页不允许新建） -->
    <div class="card hgen-panel" style="margin-top:var(--space-5)">
      <div class="panel-title"><span class="dot"></span>我的项目</div>
      <div v-if="appState.myProjects.length" class="proj-grid">
        <div
          v-for="p in appState.myProjects"
          :key="p.name"
          class="proj-card"
          :title="'打开项目 ' + p.name"
          @click="openMy(p.name)"
        >
          <b class="proj-card-name">{{ p.name }}</b>
          <div class="proj-card-meta">
            <span :class="{ on: p.hasHtml }">HTML{{ p.hasHtml ? '✓' : '—' }}</span>
            <span :class="{ on: p.hasVideo }">视频{{ p.hasVideo ? '✓' : '—' }}</span>
            <span :class="{ on: p.hasSubtitle }">字幕{{ p.hasSubtitle ? '✓' : '—' }}</span>
          </div>
          <div class="proj-card-time">{{ p.updatedAt ? '更新于 ' + fmtTime(p.updatedAt) : '' }}</div>
        </div>
      </div>
      <div v-else class="empty-hint">暂无项目。点顶部「工作项目」栏的「新建项目」创建一个。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HomePage/index.vue —— 首页（hero + 动态流水线 + 我的项目入口）
// 原 JS 版 home 模块 {template,index}.js 移植；原 init 的 DOM 注入改为响应式 v-for。
// 内置示例项目已下线（含其快捷入口块）；新建项目入口统一收在顶部 StepBar 的弹窗，首页只选择/打开项目。
import { computed } from 'vue'
import {
  appState, hasAudio, hasContent, hasHtml, hasSubtitle, hasVideo,
  switchProject, type PageKey
} from '@renderer/composables/useAppStore'
import { goPage } from '@renderer/pages'

// 首页：动态流水线（反映当前项目状态，可点击跳转）
const flowDefs = computed(() => [
  { idx: '01', t: '内容脚本', d: '编写旁白与画面分镜，定义全局风格', page: 'content' as PageKey, done: hasContent.value },
  { idx: '02', t: '配音', d: '由脚本旁白合成为自然语音', page: 'text-tts' as PageKey, done: hasAudio.value },
  { idx: '03', t: '字幕', d: '由旁白派生对齐的同步字幕', page: 'subtitle' as PageKey, done: hasSubtitle.value },
  { idx: '04', t: 'HTML生成', d: '由脚本整体生成精美的 HTML 动画', page: 'html-gen' as PageKey, done: hasHtml.value },
  { idx: '05', t: '视频预览', d: '查看 / 定位导出的视频成品（转视频在 HTML生成页）', page: 'video-preview' as PageKey, done: hasVideo.value }
]);

// 列表项时间：形如 2026-02-07 15:04（只截到分钟，避免卡片换行）
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

async function openMy(name: string): Promise<void> {
  await switchProject(name);
  await goPage('html-gen');
}
</script>
