// pages/ContentPage/castPick.ts —— 「AI 创作」里本次会话已选的角色（全局角色库成员）。
// 为什么单独一个模块：面板组件的 setup 状态每次挂载都会重建，而这份选择要**跨 Tab / 跨页面切换**保留
// （用户从「内容脚本」跳到「配音」再回来，不该重挑一遍）。所以放模块级单例，与 helpers.ts 的 scenes 同一套理由。
// 只活在这一个会话里：不落盘、不写项目——选中的角色只进提示词，见 shared 的 ScriptCastRef 说明。
import { ref } from 'vue'
import type { ScriptCastRef } from '@shared/types'

// 存的是「成员快照」（id / 名字 / 描述 / 身高）：库里改过不会自动跟随，下次打开弹窗重选即刷新。
export const pickedCast = ref<ScriptCastRef[]>([])
