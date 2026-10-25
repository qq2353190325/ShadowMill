<template>
  <!-- 角色动作示范：这里跑的是主进程拼好的「会动的那一页」（cast-preview/<id>.demo.html），
       沙箱只给 allow-scripts（与静态预览 CastShot 同一套），角色代码与动作脚本都在 iframe 自己的文档里跑。
       换动作**不重载**页面：只改 URL 的 #hash（同文档导航，frame 里监听 hashchange 换动作），
       所以一次落盘能演完所有动作；只有角色重画 / 动作增删（epoch 变化）才重设整个地址。 -->
  <div class="cast-demo-shot">
    <iframe
      v-if="src"
      :src="src"
      class="cast-demo-frame"
      sandbox="allow-scripts allow-same-origin"
      :title="'动作示范：' + (title || id)"
    ></iframe>
    <span v-else class="cast-shot-note" :title="err || '正在生成示范页…'">{{ err ? '无法示范' : '…' }}</span>
  </div>
</template>

<script setup lang="ts">
// pages/CastPage/CastDemoShot.vue —— 「角色」页 · 动作示范弹窗里那张**会动**的图。
// 与 components/CastShot.vue（静态一帧）的分工：那个回答"这个角色长什么样"，这个回答"它动起来什么样"。
// 尺寸由外层 CSS 决定；本组件只负责取示范页地址、按 actionId 换 #hash、以及 epoch 变化时重载。
import { ref, watch } from 'vue'
import { userFileUrl } from '@renderer/utils/url'

const props = defineProps<{
  // 角色 id（同时是文件名词干）
  id: string
  // 高几 u：只决定示范里画多大
  units: number
  title?: string
  // 角色声明的随包库（主进程据此在页里提示「水彩角色只画得出 Canvas 2D 部分」）
  uses?: string[]
  // 演哪一条动作（写进 URL 的 #hash；换它不重新加载文档）
  actionId?: string
  // 角色重画 / 动作增删后 +1：地址变了才会重新载入示范页（页面里嵌的是当时的动作表）
  epoch?: number
}>()

const src = ref('')
const err = ref('')
// 不含 hash 的地址前缀："userFileUrl(rel) + &e=<epoch>"；换动作时直接拼 hash
let base = ''
// 并发保护：同一个组件先后发起的两次请求，只让最后一次落地
let seq = 0

function hashOf(actionId?: string): string {
  return actionId ? '#' + encodeURIComponent(actionId) : ''
}

async function load(): Promise<void> {
  const mine = ++seq
  src.value = ''
  err.value = ''
  base = ''
  if (!props.id) return
  const res = await window.castTools.demo(props.id, {
    units: props.units,
    title: props.title,
    uses: props.uses || []
  }).catch(() => null)
  if (mine !== seq) return
  if (!res || !res.ok) {
    err.value = (res as { message?: string } | null)?.message || '示范页生成失败'
    return
  }
  // **必须用 `&` 续接**：userFileUrl 已经带了 `?user=1`，再写 `?e=` 会让查询串变成 `user=1?e=0` ⇒ 404
  // （与 CastShot.vue 里同一个坑，见那条注释）
  base = userFileUrl(res.rel) + '&e=' + (props.epoch || 0)
  src.value = base + hashOf(props.actionId)
}

watch(() => props.actionId, (id) => {
  // 只换 hash：iframe 不会重载，页面自己听 hashchange 换动作（角色代码与动作表都不用重新拼）
  if (base) src.value = base + hashOf(id)
})

watch(() => [props.id, props.units, props.epoch], load, { immediate: true })
</script>
