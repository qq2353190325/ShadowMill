// src/preload/index.d.ts —— preload 暴露的 window.* 全局类型（渲染层 tsconfig.web 引入）
// 唯一真源是 src/shared/types.ts 的 PreloadApi：本文件只把它挂到 Window 上。
// preload/index.ts 的 8 个 contextBridge 对象同样按 PreloadApi['<命名空间>'] 标注，
// 因此「实现」与「渲染层看到的签名」由同一份契约约束，不会各自漂移。
import type { PreloadApi } from '../shared/types'

export {}

declare global {
  interface Window extends PreloadApi {}
}
