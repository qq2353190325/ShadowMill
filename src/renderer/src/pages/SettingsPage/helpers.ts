// pages/SettingsPage/helpers.ts —— 设置页外壳与各区块共用的分类状态（仿 TextTtsPage/helpers.ts）
// 设置分类（左侧导航 → 右侧内容）有 5 类平级：model / voice / render / whisper / update。
// 枚举与「跨页导航意图」共用同一份（composables/useNavIntent.ts），这里只管「当前停在哪一类」。
// activeSection 是**模块级 ref**（不是 index.vue 的局部 ref）：导航项「应用更新」上的红点
// （updateStage === 'available'）由 UpdateSection 写、index.vue 读，两边都要拿到同一份状态。
// 选择记忆在 localStorage（键名见 constants.ts），下次进设置页回到上次的分类。
import { ref, watch } from 'vue'
import type { UpdateStage } from '@shared/types'
import {
  consumeSettingsSection,
  useSettingsSectionRequest,
  type SettingsSectionKey
} from '@renderer/composables/useNavIntent'
import { SETTINGS_SECTION_KEYS, SETTINGS_SECTION_KEY } from './constants'

export const activeSection = ref<SettingsSectionKey>(readActiveSection())

/** 记下用户选的分类（隐私模式等 storage 不可用时静默忽略） */
export function persistActiveSection(v: SettingsSectionKey): void {
  try {
    localStorage.setItem(SETTINGS_SECTION_KEY, v)
  } catch (e) { /* 隐私模式等场景静默忽略 */ }
}

// 上次所在的分类：没存过 / 存的值已不在枚举内（分类被删或改名）一律回落到第一类
function readActiveSection(): SettingsSectionKey {
  try {
    const v = localStorage.getItem(SETTINGS_SECTION_KEY) as SettingsSectionKey | null
    return v && SETTINGS_SECTION_KEYS.indexOf(v) >= 0 ? v : 'model'
  } catch (e) {
    return 'model'
  }
}

/** 落到指定分类（不在枚举内的请求忽略） */
export function applySection(want: SettingsSectionKey | null): void {
  if (want && SETTINGS_SECTION_KEYS.indexOf(want) >= 0 && want !== activeSection.value) {
    activeSection.value = want
  }
}

// 别的页面点「API Key 设置」之类会带着「落到语音服务」的意图跳进来：先消费意图，
// 优先级高于 localStorage 里的上次分类（用户这次点的是"去配语音"，不是"回到上次看的那一页"）。
export function applySectionIntent(): void {
  applySection(consumeSettingsSection())
}

// 兜底：本页已在挂载状态时（不经 goPage 重挂载）也能响应
export function watchSectionIntent(): void {
  watch(useSettingsSectionRequest(), () => applySectionIntent())
}

// ===== 应用更新：导航红点状态（导航项要读，UpdateSection 要写）=====
// 只放**导航红点需要的那一个字段**：其余更新状态（message / detail / 目标版本…）都留在
// UpdateSection 内部，不往这里搬——搬进来会变成「设置页所有状态的公共池」，就没人知道谁负责谁了。
export const updateStage = ref<UpdateStage>('idle')
