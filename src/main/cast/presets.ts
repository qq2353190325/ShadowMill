// src/main/cast/presets.ts
// 「角色」页 · 动作示范 · **内置动作**（公共动作里的第一批）。
//
// 这里只有数据，没有逻辑（存取 / 校验 / 拼页在 actions.ts 与 demo.ts）。
// 一条动作 = 「时间 → 角色动画参数」的曲线：key 是时间点（秒），o 是这个时刻的参数。
// 参数含义与方向按角色端的实际实现写（角色库里的代码是 `ctx.translate(x + dx*u, y + dy*u)` 之类）：
//   · dy 正 = 下移（跳起来是负）/ dx 正 = 右移；
//   · aL / aR 正 = 手臂向外抬起（0 = 自然下垂）；
//   · rot 弧度、正 = 顺时针（绕脚底转）/ sq 正 = 拉长变窄、负 = 压矮变宽；
//   · walk 摆腿相位（1 = 一个完整步）/ blink 0..1 眨眼 / eyes 表情。
// **只管写用得上的参数**：没写的参数由角色端取它自己的默认值（尤其 mouth——显式给 normal 会把
// 「笑眼配平嘴」，见 shared/constants.ts 里 CAST_ACTION_PARAMS 的注释）。
// 内置动作只读：界面上「另存为」会复制成一条用户动作再改（改预设会影响所有角色）。
import type { CastActionDef } from '../../shared/types'

export const PRESET_ACTIONS: CastActionDef[] = [
  {
    // 最常用的"活着"：轻微上下 + 手臂微摆。时长 4 秒是为了配得上角色端常写的呼吸节奏
    id: 'breathe', name: '站立呼吸', duration: 4, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { dy: 0, aL: 0, aR: 0 } },
      { t: 2, o: { dy: -0.04, aL: 0.04, aR: -0.04 } },
      { t: 4, o: { dy: 0, aL: 0, aR: 0 } }
    ]
  },
  {
    // 眨眼单独一条：只动 o.blink，其他参数一概不碰——想验"这个角色到底听不听得懂 blink"就用它
    id: 'blink', name: '眨眼', duration: 3.8, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { blink: 0 } },
      { t: 3.3, o: { blink: 0 } },
      { t: 3.45, o: { blink: 1 } },
      { t: 3.6, o: { blink: 0 } }
    ]
  },
  {
    // 挥手：右臂抬到侧上方来回摆三次再放下（aL 不动，另一只手自然垂着）
    id: 'wave', name: '挥手', duration: 1.8, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { aR: 0, rot: 0 } },
      { t: 0.25, o: { aR: 1.5, rot: 0.03 } },
      { t: 0.55, o: { aR: 1.15, rot: 0.03 } },
      { t: 0.85, o: { aR: 1.5, rot: 0.03 } },
      { t: 1.15, o: { aR: 1.15, rot: 0.03 } },
      { t: 1.45, o: { aR: 1.5, rot: 0.03 } },
      { t: 1.8, o: { aR: 0, rot: 0 } }
    ]
  },
  {
    // 双手举起：两只手一起抬，脸配笑眼（mouth 不写，让角色自己按 eyes 定嘴型）
    id: 'bothup', name: '双手举起', duration: 1.6, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { aL: 0, aR: 0 } },
      { t: 0.35, o: { aL: 1.5, aR: 1.5, eyes: 'happy' } },
      { t: 0.8, o: { aL: 1.75, aR: 1.75, eyes: 'happy', sq: 0.03 } },
      { t: 1.25, o: { aL: 1.5, aR: 1.5, eyes: 'happy' } },
      { t: 1.6, o: { aL: 0, aR: 0 } }
    ]
  },
  {
    // 走路：walk 0→2（两整步）配合前后摆臂与轻微上下起伏；循环回到 0 时相位正好接上
    id: 'walk', name: '走路', duration: 2, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { walk: 0, aL: 0.25, aR: -0.25, dy: 0 } },
      { t: 0.5, o: { walk: 0.5, aL: 0, aR: 0, dy: -0.03 } },
      { t: 1, o: { walk: 1, aL: -0.25, aR: 0.25, dy: 0 } },
      { t: 1.5, o: { walk: 1.5, aL: 0, aR: 0, dy: -0.03 } },
      { t: 2, o: { walk: 2, aL: 0.25, aR: -0.25, dy: 0 } }
    ]
  },
  {
    // 跑步：同样的 walk 相位但更快、摆臂更大，身体前倾（rot）+ 起伏更深 + 轻微拉长
    id: 'run', name: '跑步', duration: 0.9, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { walk: 0, aL: 0.7, aR: -0.7, dy: 0, rot: 0.12, sq: 0.03 } },
      { t: 0.225, o: { walk: 0.5, aL: 0, aR: 0, dy: -0.12, rot: 0.12, sq: 0.03 } },
      { t: 0.45, o: { walk: 1, aL: -0.7, aR: 0.7, dy: 0, rot: 0.12, sq: 0.03 } },
      { t: 0.675, o: { walk: 1.5, aL: 0, aR: 0, dy: -0.12, rot: 0.12, sq: 0.03 } },
      { t: 0.9, o: { walk: 2, aL: 0.7, aR: -0.7, dy: 0, rot: 0.12, sq: 0.03 } }
    ]
  },
  {
    // 跳一下：先蹲（sq 负 + 下移）蓄力 → 腾空（dy 负 + 拉长 + 抬手）→ 落地缓冲 → 站直。演一遍停住
    id: 'jump', name: '跳一下', duration: 1.2, loop: false, from: 'preset',
    keys: [
      { t: 0, o: { dy: 0, sq: 0, aL: 0, aR: 0 } },
      { t: 0.15, o: { dy: 0.12, sq: -0.18, aL: -0.2, aR: -0.2 } },
      { t: 0.45, o: { dy: -0.9, sq: 0.15, aL: 1.2, aR: 1.2 } },
      { t: 0.8, o: { dy: 0, sq: -0.12, aL: 0.3, aR: 0.3 } },
      { t: 1.2, o: { dy: 0, sq: 0, aL: 0, aR: 0 } }
    ]
  },
  {
    // 左右摇摆：整身绕脚底转 + 平移，最像"跟着音乐晃"的那一条
    id: 'sway', name: '左右摇摆', duration: 2, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { rot: 0, dx: 0 } },
      { t: 0.5, o: { rot: 0.16, dx: 0.18 } },
      { t: 1, o: { rot: 0, dx: 0 } },
      { t: 1.5, o: { rot: -0.16, dx: -0.18 } },
      { t: 2, o: { rot: 0, dx: 0 } }
    ]
  },
  {
    // 蹲下：压矮（sq 负）+ 下移 + 手臂外撑保持平衡
    id: 'crouch', name: '蹲下', duration: 2, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { sq: 0, dy: 0, aL: 0, aR: 0 } },
      { t: 0.5, o: { sq: -0.35, dy: 0.55, aL: 0.3, aR: 0.3 } },
      { t: 1.5, o: { sq: -0.35, dy: 0.55, aL: 0.3, aR: 0.3 } },
      { t: 2, o: { sq: 0, dy: 0, aL: 0, aR: 0 } }
    ]
  },
  {
    // 开心：笑眼 + 轻轻弹跳 + 双手微抬
    id: 'happy', name: '开心', duration: 1.6, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { eyes: 'happy', dy: 0, sq: 0, aL: 0.2, aR: 0.2 } },
      { t: 0.4, o: { eyes: 'happy', dy: -0.1, sq: 0.05, aL: 0.9, aR: 0.9 } },
      { t: 0.8, o: { eyes: 'happy', dy: 0, sq: 0, aL: 0.2, aR: 0.2 } },
      { t: 1.2, o: { eyes: 'happy', dy: -0.1, sq: 0.05, aL: 0.9, aR: 0.9 } },
      { t: 1.6, o: { eyes: 'happy', dy: 0, sq: 0, aL: 0.2, aR: 0.2 } }
    ]
  },
  {
    // 生气：怒眼 + 原地小幅左右抖（dx 快来回）+ 手臂内收
    id: 'angry', name: '生气', duration: 1.2, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { eyes: 'angry', dx: 0, aL: -0.15, aR: -0.15 } },
      { t: 0.15, o: { eyes: 'angry', dx: -0.06, aL: -0.15, aR: -0.15 } },
      { t: 0.3, o: { eyes: 'angry', dx: 0.06, aL: -0.15, aR: -0.15 } },
      { t: 0.45, o: { eyes: 'angry', dx: -0.06, aL: -0.15, aR: -0.15 } },
      { t: 0.6, o: { eyes: 'angry', dx: 0.06, aL: -0.15, aR: -0.15 } },
      { t: 0.75, o: { eyes: 'angry', dx: -0.06, aL: -0.15, aR: -0.15 } },
      { t: 0.9, o: { eyes: 'angry', dx: 0.06, aL: -0.15, aR: -0.15 } },
      { t: 1.2, o: { eyes: 'angry', dx: 0, aL: -0.15, aR: -0.15 } }
    ]
  },
  {
    // 惊讶：瞪眼（surprise 在角色端会放大瞳孔）+ 上身一挺（sq 正、上移）+ 双手抬起
    id: 'surprise', name: '惊讶', duration: 1.4, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { eyes: 'normal', sq: 0, dy: 0, aL: 0, aR: 0 } },
      { t: 0.18, o: { eyes: 'surprise', sq: 0.12, dy: -0.14, aL: 0.55, aR: 0.55 } },
      { t: 0.9, o: { eyes: 'surprise', sq: 0.12, dy: -0.14, aL: 0.55, aR: 0.55 } },
      { t: 1.4, o: { eyes: 'normal', sq: 0, dy: 0, aL: 0, aR: 0 } }
    ]
  },
  {
    // 说话：只动嘴型（happy / normal 交替 ≈ 张嘴闭嘴），身体保持不动
    id: 'talk', name: '说话', duration: 1.6, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { mouth: 'happy' } },
      { t: 0.2, o: { mouth: 'normal' } },
      { t: 0.4, o: { mouth: 'happy' } },
      { t: 0.62, o: { mouth: 'normal' } },
      { t: 0.85, o: { mouth: 'happy' } },
      { t: 1.1, o: { mouth: 'normal' } },
      { t: 1.35, o: { mouth: 'happy' } },
      { t: 1.6, o: { mouth: 'normal' } }
    ]
  },
  {
    // 垂头丧气：难过脸 + 压矮一点 + 微微下移 + 手臂内收（"垮下来"的观感）
    id: 'slump', name: '垂头丧气', duration: 2.6, loop: true, from: 'preset',
    keys: [
      { t: 0, o: { eyes: 'sad', sq: -0.12, dy: 0.1, aL: -0.22, aR: -0.22, rot: 0.02 } },
      { t: 1.3, o: { eyes: 'sad', sq: -0.16, dy: 0.14, aL: -0.22, aR: -0.22, rot: 0.02 } },
      { t: 2.6, o: { eyes: 'sad', sq: -0.12, dy: 0.1, aL: -0.22, aR: -0.22, rot: 0.02 } }
    ]
  }
]
