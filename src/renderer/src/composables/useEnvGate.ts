// composables/useEnvGate.ts —— 运行环境缺包时的统一「确认下载 → 进度 → 继续」弹窗
//
// 为什么要它：ffmpeg / hyperframes 已从安装包移出（见 docs/runtime-pack-split.md）。任何用到它们的功能
// 在动手前先校验，缺包时**不下载、不阻塞**，而是把 needPacks 交给这里弹一个确认框：
//   [下载运行环境] [取消]
//     ├─ 取消 ⇒ 不产生任何下载，发起该操作的那次动作也就此作废（什么都不发生）
//     └─ 下载 ⇒ 框内原地显示进度与「取消」；装好后按钮变 [继续]，**点它才重发原来的操作**
//               （刻意不自动续做：用户不会遇到「我忘了点过什么，它自己开始跑」）
// 续做所需的动作只活在这个框里（onContinue 闭包），故主进程不需要记「待续做」，也不存在成环问题。
//
// 用法（页面里）：
//   const r = await envGate.guard(missing, '转成视频')
//   if (!r.ok) return                       // 缺包已弹框（或用户取消），本次操作到此为止
//   …真正干活…
// 并在收到主进程返回的 needPacks 时调用 envGate.guard：
//   if (res.needPacks?.length) { const g = await envGate.guard(res.needPacks, '转成视频'); if (!g.ok) return; …重发… }
import { computed, ref, watch } from 'vue'
import type { RuntimePackName, RuntimeProgressPayload } from '@shared/types'
import { useRuntime } from './useRuntime'

export interface EnvGateResult {
  /** true = 包已就绪，可以继续原操作；false = 缺包且需用户确认（框已弹出）或用户取消 */
  ok: boolean
  /** 已弹框时为 true：调用方直接返回，等用户点「继续」后由 onContinue 重发 */
  pending: boolean
}

// ===== 模块级单例：全局只有一个「下载运行环境」弹窗 =====
const visible = ref(false)
const packs = ref<RuntimePackName[]>([])
const title = ref('')
const phase = ref<'confirm' | 'downloading' | 'ready'>('confirm')
const percent = ref(0)
const readyNow = ref(false)
const message = ref('')
const detail = ref('')
let onContinue: (() => void) | null = null

const LABEL: Record<RuntimePackName, string> = {
  ffmpeg: '音视频处理（ffmpeg）',
  hyperframes: '视频渲染引擎（HyperFrames）'
}

// 体积按经验值提示（真实值以主进程清单为准，准备过程中会回推）。
// 两个都是 2026-10-14 的实测值：ffmpeg 42.6 MB、hyperframes 103.1 MB；合计约 146 MB，
// 与单包时代的 runtime.7z（147.4 MB）基本持平（实测 145.7 MB）。源码常量 PACK_DEFS.hint 同此口径。
const HINT_MB: Record<RuntimePackName, number> = { ffmpeg: 43, hyperframes: 105 }

export function initEnvGate(): void {
  // 进度来源：**不再自己订阅 runtime:progress**。
  // preload 的进度通道是单订阅语义（重复注册只替换回调，见 src/preload/index.ts），
  // 若这里也调用 once onProgress，后注册者会顶掉 useRuntime 的订阅 ⇒ 外壳横幅与设置页
  // 会停在首帧 status() 的快照上、不再刷新。故改为 watch useRuntime 的状态（同一份薄包装）：
  // 仍然只有一个订阅者，且确认框照样实时。
  const rt = useRuntime()
  watch(() => rt.runtime.value, (d) => {
    if (!d || !visible.value) return
    applyProgress(d)
  }, { deep: true })
}

// 把主进程推来的状态映射到确认框的三态（confirm / downloading / ready）
function applyProgress(d: RuntimeProgressPayload): void {
  if (d.phase === 'downloading' || d.phase === 'checking' || d.phase === 'extracting') {
    phase.value = 'downloading'
    percent.value = d.percent || 0
    message.value = d.message || ''
    detail.value = ''
  } else if (d.phase === 'ready') {
    const lack = d.missing || []
    if (lack.length) {
      // 还有包没装上（例如用户只下了其中一个）：回到确认态，让用户决定下一个
      phase.value = 'confirm'
      packs.value = lack
    } else {
      phase.value = 'ready'
      readyNow.value = true
      percent.value = 100
      message.value = ''
    }
  } else if (d.phase === 'cancelled') {
    phase.value = 'confirm'
    percent.value = 0
    message.value = d.message || '已取消下载'
  } else if (d.phase === 'error') {
    phase.value = 'confirm'
    percent.value = 0
    message.value = d.message || '下载失败'
    detail.value = d.detail || ''
  }
}

function labelText(list: RuntimePackName[]): string {
  return list.map((n) => LABEL[n] + '（约 ' + HINT_MB[n] + ' MB）').join('、')
}
const sizeText = computed(() => labelText(packs.value))

export function useEnvGate() {
  const rt = useRuntime()

  /**
   * 校验运行环境；缺包就弹确认框（并把 onContinue 记下来等用户点「继续」）。
   * @param need       这次操作需要的包
   * @param actionName 动作名（写进标题，如「转成视频」）
   * @param cont       用户点「继续」时要重发的动作；不传则只装环境、不续做
   */
  async function guard(need: RuntimePackName[], actionName: string, cont?: () => void): Promise<EnvGateResult> {
    const want = need && need.length ? need : ['ffmpeg', 'hyperframes']
    const lack = rt.missing.value.filter((n) => want.indexOf(n) >= 0)
    if (!lack.length) return { ok: true, pending: false }
    packs.value = lack
    title.value = actionName
    onContinue = cont || null
    phase.value = 'confirm'
    percent.value = 0
    readyNow.value = false
    message.value = ''
    detail.value = ''
    visible.value = true
    return { ok: false, pending: true }
  }

  // 确认框里的「下载运行环境」
  async function confirmDownload(): Promise<void> {
    if (phase.value === 'downloading') return
    phase.value = 'downloading'
    percent.value = 0
    message.value = '正在准备下载…'
    detail.value = ''
    // 真正的进度 / 终态由 runtime:progress 驱动（含取消与失败），这里只需要结果
    await rt.prepare(packs.value)
  }

  // 进度中的「取消」：中断下载 / 解包；不留半截状态，框回到可再次下载的确认态
  async function cancelDownload(): Promise<void> {
    await rt.cancel()
  }

  // 装好后的「继续」：用原参数重发那一次操作
  function continueAction(): void {
    const fn = onContinue
    close()
    if (fn) fn()
  }

  function close(): void {
    visible.value = false
    onContinue = null
    readyNow.value = false
    detail.value = ''
    message.value = ''
  }

  return {
    visible, packs, title, phase, percent, readyNow, message, detail,
    sizeText, labelText,
    guard, confirmDownload, cancelDownload, continueAction, close
  }
}
