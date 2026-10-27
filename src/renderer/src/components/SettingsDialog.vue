<template>
  <!-- 设置弹窗：设置不再是独立页面，唯一容器就是这里。
       外壳复用全局 .hf-modal 系列样式（与「需要下载运行环境」「配置类错误」两框同一范式），
       只把宽度/高度调宽（.settings-modal，见 main.css），内容就是原 SettingsPage 本体——
       左侧 5 类分类导航 + 右侧区块组件，一行逻辑都没有搬动。 -->
  <div v-if="visible" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal settings-modal">
      <div class="hf-modal-head">
        <span class="hf-modal-title">设置</span>
        <button class="hf-modal-close" title="关闭（Esc）" @click="close">×</button>
      </div>
      <div class="hf-modal-body settings-modal-body">
        <!-- 每次打开重新挂载：各区块在自己的 onMounted 里读配置（与原「每次进设置页都重挂载」一致），
             关闭即卸载，不会在后台白跑 IPC -->
        <SettingsPage />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// components/SettingsDialog.vue —— 设置弹窗外壳（全局单例，挂在 App.vue 根部）
// 与 SettingsPage/index.vue 的分工：本文件只负责「弹窗什么时候出现、怎么关」，
// 分类导航与各配置区块仍全在 SettingsPage 里（保持原有设置项与逻辑不变）。
import { onBeforeUnmount, onMounted } from 'vue'
import SettingsPage from '@renderer/pages/SettingsPage/index.vue'
import { useSettingsDialog } from '@renderer/composables/useSettingsDialog'

const { visible, close } = useSettingsDialog()

// Esc 关闭：只关最上层。设置弹窗内部还会开子弹窗（更新日志 / 自定义更新源），
// 它们各自也监听 Esc——这里若发现页面里还有第二层 mask，就把 Esc 让给那层，
// 免得一次 Esc 连关两层（用户只想关日志，结果设置也一起没了）。
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !visible.value) return;
  // 已被内层处理过（如 HfSelect 下拉用 Esc 收起并 preventDefault）：这次 Esc 不再是"关设置"
  if (e.defaultPrevented) return;
  if (document.querySelectorAll('.hf-modal-mask').length > 1) return;
  close();
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>
