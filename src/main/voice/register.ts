// src/main/voice/register.ts
// 本目录的 IPC 装配：只按固定顺序调两个域的注册函数，不写任何业务逻辑。
import type { RegisterCtx } from '../../shared/types'
import { registerVoicesIpc } from './ipc/voices'
import { registerTtsIpc } from './ipc/tts'

// 频道注册顺序与拆分前一致（配置 / 目录 / 音色管理 → 克隆 / 合成）；每个频道只注册一次。
// 注意：两条合成链路（voice:create / voice:synth）的**执行顺序**由界面点击决定，与注册顺序无关。
export function register(ctx?: RegisterCtx): void {
  registerVoicesIpc(ctx)
  registerTtsIpc()
}
