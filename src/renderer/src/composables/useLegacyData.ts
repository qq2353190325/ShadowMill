// composables/useLegacyData.ts —— 历史数据目录（品牌/目录改名留下的老数据）
// 背景：userData 目录名跟随 package.json 的 name。改名后老数据仍留在旧目录里（如 %APPDATA%\my-app），
// 用户打开应用会以为"项目全没了"。主进程负责扫描 + 归属证明 + 执行（见 src/main/index.ts），
// 这里只做两件事：外壳挂载时问一次「有没有」，以及把用户在 LegacyDataDialog 里的选择回传。
//
// 为什么显式时机交给渲染层：外壳挂载时首屏已经渲染完，弹窗不会糊在还空着的界面上，
// 因此主进程侧不需要任何"等首屏画完"的延迟（早先用原生对话框时靠 setTimeout 1.5s 顶，已去掉）。
import { computed, ref } from 'vue'
import type { LegacyDataInfo, LegacyResolveAction, LegacyResolveResult } from '@shared/types'

// 模块级单例：外壳初始化一次，弹窗组件共享同一份状态（与 useRuntime / useAppStore 同思路）
const info = ref<LegacyDataInfo | null>(null)
const visible = ref(false)
const busy = ref(false)
let bound = false

// 主进程给的是目录/文件名，界面上要讲人话
const ENTRY_LABEL: Record<string, string> = {
  projects: '项目',
  whisper: '识别模型',
  voice: '音色数据',
  'tts-output': '配音输出',
  'html-agent': '生成记录',
  'settings.json': '设置'
}

// 外壳 onMounted 调用一次：有旧数据就弹窗，没有就什么都不做（常态）
export function initLegacyData(): void {
  if (bound) return
  bound = true
  void window.legacyTools.status()
    .then((d) => { if (d && d.dir) { info.value = d; visible.value = true } })
    .catch(() => { /* 主进程未就绪：不打扰用户 */ })
}

export function useLegacyData() {
  // 「项目、识别模型、音色数据、配音输出、生成记录、设置（8 个项目）」
  const entryText = computed(() => {
    const d = info.value
    if (!d) return ''
    const names = d.entries.map((e) => ENTRY_LABEL[e] || e).join('、')
    return names + (d.projects > 0 ? '（' + d.projects + ' 个项目）' : '')
  })
  // 回传选择；无论成败都先收起弹窗，结果由调用方 toast 告知（用户不必盯着一个卡住的框）
  async function resolve(action: LegacyResolveAction): Promise<LegacyResolveResult | null> {
    if (busy.value) return null
    busy.value = true
    try {
      const r = await window.legacyTools.resolve(action)
      visible.value = false
      return r || null
    } catch (e) {
      visible.value = false
      return null
    } finally {
      busy.value = false
    }
  }
  return { info, visible, busy, entryText, resolve }
}
