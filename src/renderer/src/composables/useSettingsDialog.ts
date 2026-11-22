// composables/useSettingsDialog.ts —— 设置弹窗的单例开关（模块级 ref）
//
// 设置已从「独立页面」改为「全局模态弹窗」（见 components/SettingsDialog.vue）：
//   · 设置不是页面（pages 注册表里已没有 settings），入口在用户浮窗，点它只开弹窗、不切页；
//   · 「去设置」类入口（配置类错误的 [去设置]、配音页 / 字幕页的「去设置」）仍统一走
//     goPage('settings')——pages/index.ts 的 goPage 对 'settings' 直接转到 openSettings()，
//     所以这些调用点一行都不用改，只是落点从"切页"变成"开弹窗"。
// 分类落点仍由 useNavIntent.requestSettingsSection 传递（弹窗内的 SettingsPage 挂载时消费），
// 本文件只管「弹窗开没开」，不掺分类逻辑，避免两套状态互相打架。
import { ref } from 'vue'

const visible = ref(false)

/** 打开设置弹窗（已打开时无副作用；停在哪一类由导航意图 / 上次记忆决定，见 SettingsPage/helpers.ts） */
export function openSettings(): void {
  visible.value = true
}

/** 关闭设置弹窗 */
export function closeSettings(): void {
  visible.value = false
}

/** 组件内用法：`const { visible, open, close } = useSettingsDialog()` */
export function useSettingsDialog() {
  return { visible, open: openSettings, close: closeSettings }
}
