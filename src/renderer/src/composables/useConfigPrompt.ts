// composables/useConfigPrompt.ts —— 「配置类」错误的统一弹窗（模块级 reactive 单例）
//
// 为什么要有它：缺 API Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用 这几类错误，
// 只躺在状态行里太弱——用户看一眼不知道去哪修，还得自己翻到设置页找对应填框。
// 判定**不在渲染层做**（不用正则猜文案）：主进程 friendlyError() 单点判出 needConfig 分类随 IPC 返回
// （见 src/shared/errors.ts 与 docs/error-mapping.md §11.1），渲染层只管弹框。
//
// 与 useEnvGate 是同一套范式（全局单例 + 两个按钮 + 取消即作废），区别：
//   · 本框**不驱动流程**（不像 needPacks 要续做），只是一个「去哪修」的分流入口；
//   · **不显示「查看详情」**（排障详情仍落日志）：配置类错误的原始报文对用户没有可操作性，
//     多一个折叠区会让「点哪个按钮」这个唯一决策变模糊；
//   · **只有 `[去设置]` / `[取消]`**：曾经有过「去充值」（余额类外链到厂家充值页），已按用户要求整条摘除——
//     余额 / 欠费类去设置也修不好，改为走内嵌状态行（文案说明去厂家控制台充值），因此 `ConfigTarget`
//     里也没有 'billing'。
//
// 用法（页面里）：拿到主进程失败分支后
//   if (res.needConfig) configPrompt.fromResult(res)
import { ref } from 'vue'
import type { ConfigTarget } from '@shared/types'
import { goPage } from '@renderer/pages'
import { requestSettingsSection, type SettingsSectionKey } from './useNavIntent'

// 'billing' 已不再是合法分类（见文件头），故这里只有 model / voice 两种落点
const SECTION_OF: Record<ConfigTarget, SettingsSectionKey> = {
  model: 'model',
  voice: 'voice'
}

const visible = ref(false)
const title = ref('')
const message = ref('')
const target = ref<ConfigTarget>('model')
// 音频合成是逐句后台进行的，出错位置可能不在当前页；只对「明显在配音页发起」的那些动作自动跳设置，
// 其余一律由用户点「去设置」决定（不把用户从当前页拽走）
let autoJump = false

// 兜底标题（主进程没给标题时用）
const FALLBACK_TITLE: Record<ConfigTarget, string> = {
  model: '需要设置自定义模型',
  voice: '需要设置语音服务'
}

export function useConfigPrompt() {
  /**
   * 打开配置类弹窗。只有两个按钮：`[去设置]` / `[取消]`。
   * @param msg   主进程给的人话文案（已含动作前缀）
   * @param t     目标设置分类（主进程判定，渲染层不做正则猜测）
   * @param jump  是否立即跳到设置页（默认 false，由用户点按钮决定）
   * @param ttl   标题（主进程给；不传则用兜底标题）
   */
  function open(msg: string, t: ConfigTarget, jump?: boolean, ttl?: string): void {
    message.value = String(msg || '')
    target.value = t === 'voice' ? 'voice' : 'model'
    title.value = String(ttl || FALLBACK_TITLE[target.value] || '需要先完成设置')
    autoJump = !!jump
    visible.value = true
    if (autoJump) go()
  }

  // 主按钮：跳到设置页的对应分类（本功能只修配置，不涉及外链 / 充值）
  function go(): void {
    requestSettingsSection(SECTION_OF[target.value] || 'model')
    close()
    void goPage('settings')
  }

  function close(): void {
    visible.value = false
    autoJump = false
  }

  /**
   * 便捷入口：拿主进程返回的失败分支，若带 needConfig 就弹框。
   * @param res  IPC 返回（失败分支才可能带 needConfig）
   * @param jump 是否立即跳设置页（配音页的「没配 Key」用它保持旧的「直接去设置」行为，但先说明原因）
   * @returns 是否弹了框（调用方据此决定要不要再 toast，避免弹窗 + toast 重复打扰）
   */
  function fromResult(res: unknown, jump?: boolean): boolean {
    const r = res as { message?: string; needConfig?: ConfigTarget; title?: string } | null
    if (!r || !r.needConfig) return false
    open(r.message || '', r.needConfig, jump, r.title)
    return true
  }

  return { visible, title, message, target, open, fromResult, go, close }
}
