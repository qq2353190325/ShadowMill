<template>
  <!-- pages/HtmlGenPage/WorkbenchSide.vue —— 右侧栏：前四块手风琴 + 「其他」常驻平铺
       图片 / 视频 / 背景音频 / 角色 一次只展开一个（默认全收起，点已展开的收回去）；
       「其他」不分折叠、内容一直可见。整条栏仍可收起成 28px 竖条，主区由父页占满。 -->
  <aside class="hgen-side" :class="{ 'is-collapsed': props.collapsed }">
    <button v-if="props.collapsed" class="hgen-side-rail" title="展开右侧面板" @click="emit('update:collapsed', false)">
      <span>«</span>
      <span class="hgen-side-rail-text">展开面板</span>
    </button>

    <template v-else>
      <div class="hgen-side-top">
        <span class="hgen-side-top-label">面板</span>
        <button class="hf-btn hgen-side-collapse" title="收起右侧面板" @click="emit('update:collapsed', true)">»</button>
      </div>
      <div class="hgen-side-groups">
        <section
          v-for="g in accordionGroups"
          :key="g.key"
          class="hgen-side-group"
          :class="{ open: activeGroup === g.key }"
        >
          <button class="hgen-side-head" :title="activeGroup === g.key ? '收起这一块' : '展开这一块'" @click="toggle(g.key)">
            <span class="hgen-side-arrow">{{ activeGroup === g.key ? '▾' : '▸' }}</span>{{ g.label }}
          </button>
          <div v-if="activeGroup === g.key" class="hgen-side-body">
            <MaterialsSection v-if="g.key === 'image'" kind="image" />
            <MaterialsSection v-else-if="g.key === 'video'" kind="video" />
            <PreviewControls v-else-if="g.key === 'audio'" part="audio" />
            <CastSection v-else />
          </div>
        </section>

        <!-- 「其他」不参与手风琴：静态标题 + 内容常驻可见 -->
        <section class="hgen-side-group">
          <div class="hgen-side-head-static">其他</div>
          <div class="hgen-side-body"><slot name="other" /></div>
        </section>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import MaterialsSection from './MaterialsSection.vue'
import PreviewControls from './PreviewControls.vue'
import CastSection from './CastSection.vue'

const props = defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', v: boolean): void }>();

// 前四块手风琴：一次只展开一块，默认全收起；点已展开的那块则收回去
const accordionGroups = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '背景音频' },
  { key: 'cast', label: '角色' }
];
const activeGroup = ref('');
function toggle(k: string): void {
  activeGroup.value = activeGroup.value === k ? '' : k;
}
</script>
