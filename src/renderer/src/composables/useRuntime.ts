// composables/useRuntime.ts —— 运行环境（分包 ffmpeg / hyperframes）状态 → 外壳横幅 + 设置页
// 背景：ffmpeg(180MB) 与 hyperframes(440MB) 已从安装包移出、各自成一个包，**用到相关功能时按需下载**
// （whisper 随安装包，不需要下载）。所以这里要能表达三件事：正在下 / 缺哪些包 / 失败原因。
// 状态由主进程 runtime:progress 推送 + 首次用 runtime:status 补齐（见 src/main/runtime.ts、
// 方案见 docs/runtime-pack-split.md）。
import { computed, ref } from 'vue'
import type { RuntimePackName, RuntimeProgressPayload } from '@shared/types'

// 模块级单例：外壳初始化一次，所有页面共享同一份状态（与 useAppStore 同思路）
const runtime = ref<RuntimeProgressPayload>({
  phase: 'idle',
  pack: null,
  percent: 0,
  packs: [],
  missing: [],
  status: { ffmpeg: 'unknown', hyperframes: 'unknown' },
  message: '',
  source: '',
  bytes: 0,
  unpackedBytes: 0,
  files: 0,
  cancellable: false
})
let bound = false

// 外壳挂载时调用一次：首帧用 runtime:status 补齐，之后由 runtime:progress 推送驱动
export function initRuntime(): void {
  if (bound) return
  bound = true
  window.runtimeTools.onProgress((d: RuntimeProgressPayload) => { runtime.value = d })
  void window.runtimeTools.status()
    .then((d: RuntimeProgressPayload) => { if (d && d.phase) runtime.value = d })
    .catch(() => { /* 主进程未就绪：保持 idle，不打扰用户 */ })
}

const PACK_LABEL: Record<RuntimePackName, string> = {
  ffmpeg: '音视频处理（ffmpeg）',
  hyperframes: '视频渲染引擎（HyperFrames）'
}

export function useRuntime() {
  // 「忙」＝正在取清单 / 下载 / 解包：横幅此时显示进度条与取消按钮
  const busy = computed(() => runtime.value.phase === 'checking' ||
    runtime.value.phase === 'downloading' || runtime.value.phase === 'extracting')
  const failed = computed(() => runtime.value.phase === 'error')
  // 缺包（首次安装的常态）：此时不自动下载，等用户在某处确认后再下
  const missing = computed<RuntimePackName[]>(() => runtime.value.missing || [])
  const hasMissing = computed(() => missing.value.length > 0)
  // 就绪＝没有缺包、也没有在跑；已就绪时界面保持干净（不常驻一句「已就绪」）
  const ready = computed(() => !busy.value && !failed.value && !hasMissing.value)
  const cancelable = computed(() => runtime.value.cancellable)

  const missingText = computed(() => missing.value.map((n) => PACK_LABEL[n]).join('、'))

  // 主动准备指定包（省略 = 全部缺的）：用户确认下载 / 失败后重试
  async function prepare(packs?: RuntimePackName[]): Promise<boolean> {
    try {
      const r = await window.runtimeTools.prepare(packs && packs.length ? packs : missing.value)
      return !!(r && r.ok)
    } catch (e) {
      return false
    }
  }
  // 取消正在进行的下载 / 解包：取消 = 不下载，且不留半截状态
  async function cancel(): Promise<void> {
    try { await window.runtimeTools.cancel() } catch (e) { /* 成败由进度回填 */ }
  }

  return { runtime, busy, failed, missing, hasMissing, ready, cancelable, missingText, prepare, cancel }
}
