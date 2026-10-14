// composables/useRuntime.ts —— 运行环境包状态（主进程解包/下载进度 → 外壳横幅 + 设置页）
// 背景：ffmpeg / hyperframes / whisper 约 632MB 不再随安装包展开，而是安装时带一个 7z、
// 首次启动由主进程解到 userData（见 src/main/runtime.ts，文档 wiki/files/main/runtime.ts.md）。
// 解包期间应用可用，但转录 / 转视频 / 逐句对齐会等它完成，所以要有可见的进度与失败重试入口。
import { computed, ref } from 'vue'
import type { RuntimeProgressPayload } from '@shared/types'

// 模块级单例：外壳初始化一次，所有页面共享同一份状态（与 useAppStore 同思路）
const runtime = ref<RuntimeProgressPayload>({
  stage: 'idle',
  percent: 0,
  id: '',
  message: '',
  source: '',
  bytes: 0,
  unpackedBytes: 0,
  files: 0
})
let bound = false

// 外壳挂载时调用一次：首帧用 runtime:status 补齐，之后由 runtime:progress 推送驱动
export function initRuntime(): void {
  if (bound) return
  bound = true
  window.runtimeTools.onProgress((d: RuntimeProgressPayload) => { runtime.value = d })
  void window.runtimeTools.status()
    .then((d: RuntimeProgressPayload) => { if (d && d.stage) runtime.value = d })
    .catch(() => { /* 主进程未就绪：保持 idle，不打扰用户 */ })
}

export function useRuntime() {
  const busy = computed(() => runtime.value.stage === 'checking' || runtime.value.stage === 'downloading' || runtime.value.stage === 'extracting')
  const failed = computed(() => runtime.value.stage === 'failed')
  // 失败后重试（幂等：主进程并发调用共享同一次执行）
  async function retry(): Promise<void> {
    try {
      await window.runtimeTools.prepare()
    } catch (e) { /* 成败由 runtime:progress 回填，这里只触发 */ }
  }
  // 只暴露「要用到的三件事」：状态、是否忙、是否失败（外壳横幅与设置页都只显示这两种态）；
  // 「已就绪」是常态、不再有任何界面展示它，故不再提供 ready / sizeText（避免死代码）
  return { runtime, busy, failed, retry }
}
