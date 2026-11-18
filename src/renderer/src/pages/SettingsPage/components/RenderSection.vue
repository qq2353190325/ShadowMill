<template>
  <div class="card hgen-panel">
    <div class="panel-title"><span class="dot"></span>视频渲染默认档位</div>
    <div class="hgen-tip">「HTML生成」页点「转视频」时的默认档位。单个项目可在「HTML生成」页的「渲染档位」单独覆盖质量 / 帧率（项目覆盖优先于这里的默认）。质量 draft 编码最快但文字边缘可能有压缩痕迹，仅用于快速确认内容；降低帧率不会缩短成片时长，只是采样更稀、渲染更快。渲染引擎默认 HyperFrames（稳定）；Rust 小内核是新路径，适合 A/B 对比，复杂合成与长片仍在验证中。</div>
    <div class="hgen-row">
      <label class="sel-label">质量</label>
      <HfSelect v-model="rQuality" :groups="qualityGroups" />
    </div>
    <div class="hgen-row">
      <label class="sel-label">帧率</label>
      <HfSelect v-model="rFps" :groups="fpsGroups" />
    </div>
    <div class="hgen-row">
      <label class="sel-label">渲染引擎</label>
      <HfSelect v-model="rBackend" :groups="backendGroups" />
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" @click="onSaveRender">保存渲染默认档位</button>
    </div>
    <div class="hf-status" :class="rStatusClass">{{ rStatus }}</div>
    <div class="hgen-tip" style="margin-top:8px">{{ qualityHint }}</div>
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/components/RenderSection.vue —— 设置页「渲染档位」区块
// 全局默认写 settings.json 的 render 段（经 composables/useRenderOptions.saveRenderDefaults）；
// 项目级覆盖在「HTML生成」页单独设置，优先级更高。
import { computed, onMounted, ref } from 'vue'
import type { RenderBackend, RenderFps, RenderQuality } from '@shared/types'
import {
  FALLBACK_RENDER,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITY_OPTIONS,
  renderQualityLabel
} from '@renderer/utils/render'
import { saveRenderDefaults } from '@renderer/composables/useRenderOptions'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'

// 普通用户只有两项：质量（draft / standard / high）与帧率（24 / 30）。
const qualityOptions = RENDER_QUALITY_OPTIONS;
const fpsOptions = RENDER_FPS_OPTIONS;
// HfSelect 选项（原为 <option v-for>）
const qualityGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: qualityOptions.map((o) => ({ value: o.value, label: o.label })) }]);
const fpsGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: fpsOptions.map((o) => ({ value: o.value, label: o.label })) }]);
const backendGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: [
  { value: 'hyperframes', label: 'HyperFrames（稳定，默认）' },
  { value: 'vidrender', label: 'Rust 小内核（实验）' }
] }]);
const rQuality = ref<RenderQuality>(FALLBACK_RENDER.quality);
const rFps = ref<RenderFps>(FALLBACK_RENDER.fps);
const rBackend = ref<RenderBackend>('hyperframes');
const rStatus = ref('');
const rStatusClass = ref('');
// 当前所选质量的说明（快速预览会明确提示画质代价）
const qualityHint = computed(() => {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === rQuality.value);
  return hit ? hit.hint : '';
});

function setRStatus(text: string, kind: string): void {
  rStatus.value = text || '';
  rStatusClass.value = kind;
}

async function onSaveRender(): Promise<void> {
  const res = await saveRenderDefaults({ quality: rQuality.value, fps: rFps.value }, rBackend.value);
  setRStatus(
    res.ok ? '渲染默认档位已保存：' + renderQualityLabel(rQuality.value) + ' · ' + rFps.value + 'fps · ' +
      (rBackend.value === 'vidrender' ? 'Rust 小内核' : 'HyperFrames') : (res.message || '保存失败'),
    res.ok ? 'hf-ok' : 'hf-error'
  );
}

onMounted(async () => {
  // 读取失败沿用内置默认 standard / 30
  try {
    const s = await window.settingsTools.get();
    const r = (s && s.render) || FALLBACK_RENDER;
    if (RENDER_QUALITY_OPTIONS.some((o) => o.value === r.quality)) rQuality.value = r.quality;
    if (RENDER_FPS_OPTIONS.some((o) => o.value === r.fps)) rFps.value = r.fps;
    if (s && s.renderBackend === 'vidrender') rBackend.value = 'vidrender';
  } catch (e) { /* ignore */ }
});
</script>
