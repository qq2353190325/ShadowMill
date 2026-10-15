// pages/SettingsPage/constants.ts —— 设置页局部常量
// 这里只放页面局部常量。共享的那些各有各的家，不要在本文件再抄一份：
// 厂家预设表 MODEL_PROVIDERS 与分类记忆键 STORAGE_KEY_SETTINGS_SECTION 在 @renderer/constants，
// 分类枚举 SETTINGS_SECTIONS 在 @renderer/composables/useNavIntent（导航与跨页意图共用那一份）。
import { STORAGE_KEY_SETTINGS_SECTION } from '@renderer/constants'
import { SETTINGS_SECTIONS, type SettingsSectionKey } from '@renderer/composables/useNavIntent'

// Base URL / 模型 ID 下拉里「自定义…（手动填写）」的哨兵值：
// 选中它只切到手填输入框、**不动当前值**（常见诉求是"在现有地址上改一改"）。
export const CUSTOM_VALUE = '__custom__'

// 分类记忆的 localStorage 键（下次进设置页回到上次的分类）
export const SETTINGS_SECTION_KEY = STORAGE_KEY_SETTINGS_SECTION

// 左侧导航项：顺序 = 显示顺序（与 SETTINGS_SECTIONS 的声明顺序一致），键即 SETTINGS_SECTION_KEY。
// 设置分类的**真源**是 useNavIntent.ts（跨页导航意图与这里共用一份），所以这里的 key 一律从它派生，
// 将来加分类时漏改本文件只会是「新分类没有导航按钮」，不会变成两套枚举。
export interface SettingsNavItem {
  key: SettingsSectionKey
  label: string
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { key: 'model', label: '模型配置' },
  { key: 'voice', label: '语音服务' },
  { key: 'render', label: '渲染档位' },
  { key: 'whisper', label: '语音识别模型' },
  { key: 'update', label: '应用更新' }
]

// 分类 key 次序的唯一数组（页面在「上次分类 / 导航意图是否合法」两处校验都用它）
export const SETTINGS_SECTION_KEYS: SettingsSectionKey[] = SETTINGS_SECTIONS
