// composables/useAuthDialog.ts —— 登录/注册弹窗的单例开关（模块级 ref）
//
// 与 useSettingsDialog 同一套写法：本文件只管「弹窗开没开、开在哪一栏」，
// 表单校验与账号调用全在 components/AuthDialog.vue + utils/localAccount.ts 里，避免两处状态打架。
// 入口：components/UserArea.vue 浮窗第二项「登录」（未登录时）。已登录时该项是「退出登录」，不开框。
import { ref } from 'vue'

/** 弹窗当前展示的栏位：登录 / 注册（注册仅邮箱，见 utils/localAccount.ts） */
export type AuthMode = 'login' | 'register'

const visible = ref(false)
const mode = ref<AuthMode>('login')

/** 打开登录/注册弹窗；不传 mode 就停在登录栏 */
export function openAuth(next: AuthMode = 'login'): void {
  mode.value = next
  visible.value = true
}

export function closeAuth(): void {
  visible.value = false
}

/** 组件内用法：`const { visible, mode, open, close } = useAuthDialog()` */
export function useAuthDialog() {
  return { visible, mode, open: openAuth, close: closeAuth }
}
