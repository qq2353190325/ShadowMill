// composables/useToast.ts —— 轻提示（原 window.App.toast；样式移植为 .toast-item，由 App.vue 渲染）
import { ref } from 'vue'

export interface ToastItem {
  id: number
  msg: string
}

const toasts = ref<ToastItem[]>([])
let seq = 0

export function toast(msg: string): void {
  const id = ++seq
  toasts.value.push({ id, msg })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 2800)
}

export function useToasts(): typeof toasts {
  return toasts
}
