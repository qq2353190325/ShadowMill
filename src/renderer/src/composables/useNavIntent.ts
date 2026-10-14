// composables/useNavIntent.ts —— 跨页面「导航意图」信号（模块级 reactive 单例）
// 有些按钮不只是「切到某页」，还要求目标页停在某个分类上：例「音色管理」的「API Key 设置」
// 必须落到设置页的「语音服务」，否则用户到了设置页还要自己找一遍要填的 Key 在哪。
// 用法与「同页 Tab 切换」那类信号一致：源页置位 → 目标页消费并复位。
// （历史上 pages/TextTtsPage/helpers.ts 的 voiceTabRequest 就是这套路，已随「管理音色」按钮一起删除。）
// 可靠性来自 goPage 每次都递增 pageNavKey 强制目标页重挂载，所以「置位 → 目标页 onMounted 消费」
// 是主路径；目标页 watch 只是兜底（该页已在挂载状态时也能响应，不必依赖重挂载）。
import { ref } from 'vue'

// 设置页分类：唯一来源。SettingsPage 的左侧导航与这里共用同一份枚举，避免两处漂移。
export type SettingsSectionKey = 'model' | 'voice' | 'render' | 'update' | 'whisper'
export const SETTINGS_SECTIONS: SettingsSectionKey[] = ['model', 'voice', 'render', 'update', 'whisper']

const settingsSectionRequest = ref<SettingsSectionKey | null>(null)

/** 请求「进入设置页并停在某个分类」（调用后自行 goPage('settings')） */
export function requestSettingsSection(section: SettingsSectionKey): void {
  settingsSectionRequest.value = section
}

/** 目标页消费：读取并复位。没有待处理请求时返回 null */
export function consumeSettingsSection(): SettingsSectionKey | null {
  const v = settingsSectionRequest.value
  settingsSectionRequest.value = null
  return v
}

/** 给目标页 watch 用的引用（watch 里仍需调 consumeSettingsSection 复位） */
export function useSettingsSectionRequest() {
  return settingsSectionRequest
}
