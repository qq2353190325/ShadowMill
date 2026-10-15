// pages/SettingsPage/types.ts —— 设置页类型出口（本页局部类型 + 从共享层的按需 re-export）
// 这里**不重定义** @shared/types 已有的类型：VoiceProviderView 直接转出共享层的定义，
// UpdateCheckReply 由 IpcResult<UpdateCheckResult> 组合出来——同一个类型只允许有一份定义。
// <script setup> 内不能 export（编译器不允许），所以页面内跨组件共用的类型一律放这个普通 .ts。
import type { IpcResult, UpdateCheckResult } from '@shared/types'

// 厂家目录条目（厂家 key / 名称 / Key 提示 / 出厂默认模型 / 模型 / 音色）：
// 真源在 src/shared/types.ts，这里只做转出，供本页组件 import type 使用。
export type { VoiceProviderView } from '@shared/types'

// update:check 的回执：{ ok } 与 UpdateCheckResult 的交叉类型（真源 @shared/types 的 IpcResult）
export type UpdateCheckReply = IpcResult<UpdateCheckResult>
