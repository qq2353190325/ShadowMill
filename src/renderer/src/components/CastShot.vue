<template>
  <!-- 角色预览：角色不是图片，而是 <id>.js 里的绘制函数，所以这里只能「让代码真跑一遍」。
       跑代码的是 iframe 自己的文档（主进程拼好的 cast-preview/<id>.html），
       不碰渲染层的 CSP 与主世界；单击事件一律穿透到父级卡片（.cast-shot-frame 有 pointer-events:none）。 -->
  <div class="cast-shot" :class="{ big }">
    <iframe
      v-if="src"
      :src="src"
      class="cast-shot-frame"
      sandbox="allow-scripts allow-same-origin"
      :title="'角色预览：' + (title || id)"
    ></iframe>
    <span v-else class="cast-shot-note" :title="err || '正在生成预览…'">{{ err ? '无法预览' : '…' }}</span>
  </div>
</template>

<script setup lang="ts">
// components/CastShot.vue —— 角色静态预览（缩略图与大图共用）
// 两处在用：「角色」页的卡片墙 / 新建与改画法的弹窗，以及「HTML生成」页的角色勾选区
// （所以放在公共组件目录，不留在某一个页面目录下——跨页面互相 import 会让人分不清谁依赖谁）。
// 角色只有全局一份（<userData>/cast-library/），**与项目无关**：预览页落 <userData>/cast-preview/，
// 由 hgpreview 的 `?user=1` 白名单放行（见 main/cast/preview.ts 与 main/index.ts 的 USER_PREVIEW_DIRS）。
// 尺寸由外层 CSS 决定（.cast-shot / .cast-shot.big）；本组件只负责「取预览页地址 + 载入 iframe」。
// epoch 由父级在角色被重画后 +1：文件被覆盖后 iframe 必须重新载入（地址一变就会重载）。
import { ref, watch } from 'vue'
import { userFileUrl } from '@renderer/utils/url'

const props = defineProps<{
  // 角色 id（同时是文件名词干）
  id: string
  // 高几 u：只决定预览里画多大
  units: number
  title?: string
  // 角色声明的随包库（主进程据此在预览页里提示「水彩角色只画得出 Canvas 2D 部分」）
  uses?: string[]
  epoch?: number
  big?: boolean
}>()

const src = ref('')
const err = ref('')
// 并发保护：同一个组件先后发起的两次请求，只让最后一次落地（否则会闪回旧角色的预览）
let seq = 0

async function load(): Promise<void> {
  const mine = ++seq
  src.value = ''
  err.value = ''
  if (!props.id) return
  const res = await window.castTools.preview(props.id, {
    units: props.units,
    title: props.title,
    uses: props.uses || []
  }).catch(() => null)
  if (mine !== seq) return
  if (!res || !res.ok) {
    err.value = (res as { message?: string } | null)?.message || '预览生成失败'
    return
  }
  // 预览页每次都是重写的，但 iframe 的地址不变就不会重载 ⇒ 附上 epoch 强制换地址（服务端本身 no-store）
  // **必须用 `&` 续接**：userFileUrl 已经带了 `?user=1`，再写 `?e=` 会让查询串变成 `user=1?e=0`，
  // 主进程 `searchParams.get('user') === '1'` 判假 ⇒ 掉进"项目名 = cast-preview"的分支 ⇒ 404（iframe 显示 Not Found）
  src.value = userFileUrl(res.rel) + '&e=' + (props.epoch || 0)
}

watch(() => [props.id, props.units, props.epoch], load, { immediate: true })
</script>
