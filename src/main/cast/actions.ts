// src/main/cast/actions.ts
// **角色动作库**：动作 = 「时间 → 角色动画参数」的曲线（见 shared/types.ts 的 CastActionDef）。
//
// 为什么动作与角色代码分开存：角色是**纯绘制函数**（`window.__cast[id](x, y, u, o)`），它只认
// o 里那几项动画参数（walk / aL / aR / eyes / mouth / blink / dy / dx / rot / sq，契约见
// main/agent/html.ts 的 HTML_CAST_SYSTEM）。所以「让它动起来」不需要改角色代码——只要按时间
// 算出这组参数就能演一遍，这也正是章节在正片里做的事。
//
// 三层关系（别混）：
//   · 内置动作  presets.ts 的 PRESET_ACTIONS —— 写死在代码里的数据，**只读**（界面上「另存为」复制一份再改）；
//   · 公共动作  <userData>/cast-library/actions.json 的 shared —— 用户自建、所有角色都能演；
//   · 专属动作  同一份 actions.json 的 byCast[<角色id>] —— AI 读角色源码后生成（能用到角色自己的参数，
//     比如猫的尾巴），或用户建的时候勾了「只给这个角色」。
// 与角色库同目录、同样是**用户资产**（可备份、可迁移）；删角色时它的专属动作一并清掉（见 library.ts）。
//
// 本文件刻意不 import electron（保持可离线测试）：库根目录由调用方给（projects/ 传 userData 下的路径）。
import path from 'node:path'
import fs from 'node:fs'
import type { CastActionDef, CastActionKey, CastActionListResult, CastActionScope } from '../../shared/types'
import {
  CAST_ACTION_DURATION, CAST_ACTION_MAX_PER_SCOPE, CAST_ACTION_NAME_MAX, CAST_ACTION_PARAMS
} from '../../shared/constants'
import { PRESET_ACTIONS } from './presets'

const ACTIONS_FILE = 'actions.json'
// 动作 id 是**可读 slug**：当文件名以外的键用（写进页面的动作表），不允许出现路径分隔符 / 引号
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/
// AI 生成的动作脚本上限（行数）：一段"返回参数对象"的纯函数，几十行足够；超过基本是模型跑偏了
const MAX_ACTION_CODE_LINES = 60

// actions.json 的形状：shared = 公共动作，byCast = 每个角色的专属动作
interface ActionStore {
  shared: CastActionDef[]
  byCast: Record<string, CastActionDef[]>
}

function actionsPath(root: string): string {
  return path.join(root, ACTIONS_FILE)
}

// ===== 规范化与校验 =====
function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// 一个关键帧：t 截到 [0, duration]，o 只留下参数表里的键（数字夹到范围、枚举查白名单、'auto' 丢弃）
function normalizeKey(raw: unknown, duration: number): CastActionKey | null {
  const it = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {}
  const t = Number(it.t)
  if (!isFinite(t)) return null
  const src = (it.o && typeof it.o === 'object' && !Array.isArray(it.o)) ? it.o as Record<string, unknown> : {}
  const o: Record<string, number | string> = {}
  for (const p of CAST_ACTION_PARAMS) {
    if (!(p.key in src)) continue
    const v = src[p.key]
    if (p.type === 'number') {
      const n = Number(v)
      if (!isFinite(n)) continue
      // 没写 min/max 就是"不限"（当前只有 dy..blink 这些数字参数，都写了范围）
      o[p.key] = clampNum(n, p.min === undefined ? -1e6 : p.min, p.max === undefined ? 1e6 : p.max)
    } else {
      const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase()
      // 'auto' = 不传这个参数（见 constants 里 mouth 的说明），落盘时直接丢掉
      if (s === 'auto') continue
      if (p.options && p.options.indexOf(s) >= 0) o[p.key] = s
    }
  }
  return { t: clampNum(t, 0, duration), o }
}

// 把一条动作（来自界面 / 磁盘 / 模型）收敛成合法形状；不合法回 null（调用方给用户一句人话）
export function normalizeActionDef(raw: unknown): CastActionDef | null {
  const it = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {}
  const id = String(it.id === undefined || it.id === null ? '' : it.id).trim().toLowerCase()
  if (!ID_RE.test(id)) return null
  const rawDur = Number(it.duration)
  const duration = isFinite(rawDur)
    ? Math.round(clampNum(rawDur, CAST_ACTION_DURATION.min, CAST_ACTION_DURATION.max) * 100) / 100
    : 0
  if (!duration) return null
  const name = (typeof it.name === 'string' ? it.name.trim() : '').slice(0, CAST_ACTION_NAME_MAX) || id
  const loop = it.loop !== false
  const from = it.from === 'preset' || it.from === 'ai' ? it.from : 'user'
  const code = typeof it.code === 'string' ? it.code.trim() : ''
  if (code) {
    // 代码动作：与关键帧二选一，且要过静态白名单（真正的执行发生在沙箱 iframe 里，见 demo.ts）
    const bad = validateActionCode(code)
    if (bad) return null
    return { id, name, duration, loop, code, from: from === 'preset' ? 'ai' : from }
  }
  const rawKeys = Array.isArray(it.keys) ? it.keys : []
  const keys: CastActionKey[] = []
  for (const k of rawKeys) {
    const n = normalizeKey(k, duration)
    if (n) keys.push(n)
  }
  // 至少两个关键帧才叫"曲线"：一个点只会得到一张静止的画
  if (keys.length < 2) return null
  keys.sort((a, b) => a.t - b.t)
  return { id, name, duration, loop, keys, from }
}

// AI 生成的动作脚本的**静态**白名单：它会被原样嵌进示范页在沙箱 iframe 里跑（与角色代码同一风险面），
// 所以先把明显越界的东西挡在外面——真正的隔离靠 iframe 的 sandbox，这里的报错是为了给用户一句人话。
const CODE_BANNED_RE = /\b(window|document|globalThis|self|top|parent|require|process|eval|Function|fetch|XMLHttpRequest|localStorage|sessionStorage|importScripts|alert|__cast|setTimeout|setInterval|requestAnimationFrame)\b/
const HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*\s*\/?>/i

export function validateActionCode(code: string): string | null {
  const c = String(code || '').trim()
  if (!c) return '动作脚本是空的'
  if (!/\bfunction\b|=>/.test(c)) return '动作脚本必须是一个函数：function (t) { return { … } }'
  if (!/\breturn\b/.test(c)) return '动作脚本必须有 return（返回这一刻的动画参数对象）'
  if (CODE_BANNED_RE.test(c)) return '动作脚本里出现了不该有的东西（window / document / 定时器 / 随机以外的东西），只能返回参数对象'
  if (/\bwhile\s*\(|\bfor\s*\(/.test(c)) return '动作脚本里不要写循环：它只是把 t 换算成参数，用表达式就够了'
  if (/Math\s*\.\s*random/.test(c)) return '动作脚本里不要用 Math.random（每次都不一样，演示就无法重现），要用抖动请用确定性的 sin/cos'
  if (HTML_TAG_RE.test(c)) return '动作脚本里出现了 HTML 标签（动作只能是 JS 函数）'
  if (c.split('\n').length > MAX_ACTION_CODE_LINES) return '动作脚本过长（超过 ' + MAX_ACTION_CODE_LINES + ' 行），请拆成更简单的动作'
  return null
}

// 从模型回复里取出动作脚本：认 <<<ACTION>>> 标记，退而求其次认 ```js 围栏与裸函数
export function parseCastActionReply(reply: string): string | null {
  const text = String(reply || '')
  const tagged = text.match(/<<<\s*ACTION\s*>>>([\s\S]*?)<<<\s*END\s*ACTION\s*>>>/i)
  if (tagged && tagged[1].trim()) return tagged[1].trim()
  const fence = text.match(/```(?:js|javascript|ts)?\s*([\s\S]*?)```/i)
  if (fence && fence[1].trim()) return fence[1].trim()
  const t = text.trim()
  if (/^(function\b|\(|\w+\s*=>)/.test(t)) return t
  return null
}

// ===== 读写 =====
function emptyStore(): ActionStore {
  return { shared: [], byCast: {} }
}

// 读动作库（文件缺失 / 损坏都当空库，不抛；脏条目逐个丢掉）
export function readActions(root: string): ActionStore {
  const out = emptyStore()
  try {
    const p = actionsPath(root)
    if (!fs.existsSync(p)) return out
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
    const sharedRaw = raw && raw.shared
    const shared: unknown[] = Array.isArray(sharedRaw) ? sharedRaw : []
    for (const it of shared) {
      const a = normalizeActionDef(it)
      if (a && a.from !== 'preset') out.shared.push(a)
    }
    const byCastRaw = raw && raw.byCast
    const byCast = (byCastRaw && typeof byCastRaw === 'object' && !Array.isArray(byCastRaw))
      ? byCastRaw as Record<string, unknown>
      : {}
    for (const id of Object.keys(byCast)) {
      if (!ID_RE.test(id)) continue
      const list = Array.isArray(byCast[id]) ? byCast[id] as unknown[] : []
      const got: CastActionDef[] = []
      for (const it of list) {
        const a = normalizeActionDef(it)
        if (a) got.push(a)
      }
      if (got.length) out.byCast[id] = got
    }
  } catch (e) {
    return out
  }
  return out
}

function writeActions(root: string, store: ActionStore): void {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(actionsPath(root), JSON.stringify(store, null, 2), 'utf8')
}

// 某个角色能演的全部动作：内置（只读）→ 用户自建的公共动作 → 这个角色的专属动作
export function listActionsFor(root: string, castId: string): CastActionListResult {
  const store = readActions(root)
  const id = String(castId || '').trim().toLowerCase()
  return {
    shared: [...PRESET_ACTIONS, ...store.shared],
    own: (id && store.byCast[id]) ? store.byCast[id] : []
  }
}

// 下一个可用的动作 id（用户建新动作时用；内置动作的 id 也要避开，否则列表里会出现两条同名 id）
export function nextActionId(taken: string[]): string {
  const used = new Set<string>(taken)
  for (const p of PRESET_ACTIONS) used.add(p.id)
  let n = 1
  let id = 'act' + n
  while (used.has(id)) { n++; id = 'act' + n }
  return id
}

// 新建 / 覆盖一条动作。scope = shared 写公共库，own 写 byCast[castId]。
// id 已存在就**就地替换**（保持列表顺序，与角色库同一套习惯）；不存在则追加，超上限时拒绝。
export function upsertAction(
  root: string,
  scope: CastActionScope,
  castId: string,
  action: CastActionDef
): { ok: boolean; message: string; action?: CastActionDef } {
  const def = normalizeActionDef(action)
  if (!def) return { ok: false, message: '动作不合法：需要名称、时长，以及至少两个关键帧（或一段动作脚本）' }
  const cid = String(castId || '').trim().toLowerCase()
  if (scope === 'own' && !ID_RE.test(cid)) return { ok: false, message: '缺少角色 id，动作不知道该存给谁' }
  const store = readActions(root)
  const list = scope === 'shared' ? store.shared : (store.byCast[cid] || [])
  const at = list.findIndex((a) => a.id === def.id)
  if (at >= 0) list[at] = def
  else {
    if (list.length >= CAST_ACTION_MAX_PER_SCOPE) {
      return { ok: false, message: '动作太多了（同一处最多 ' + CAST_ACTION_MAX_PER_SCOPE + ' 条），先删掉几条' }
    }
    list.push(def)
  }
  if (scope === 'shared') store.shared = list
  else store.byCast[cid] = list
  try {
    writeActions(root, store)
    return { ok: true, message: '', action: def }
  } catch (e) {
    return { ok: false, message: '动作没存下来：' + ((e as Error).message || String(e)) }
  }
}

// 删一条动作（scope = own 时要 castId）
export function removeAction(root: string, scope: CastActionScope, castId: string, actionId: string): { ok: boolean; message: string } {
  const aid = String(actionId || '').trim().toLowerCase()
  const cid = String(castId || '').trim().toLowerCase()
  const store = readActions(root)
  const list = scope === 'shared' ? store.shared : (store.byCast[cid] || [])
  const at = list.findIndex((a) => a.id === aid)
  if (at < 0) return { ok: false, message: '没有这条动作：' + aid }
  list.splice(at, 1)
  if (scope === 'shared') store.shared = list
  else if (list.length) store.byCast[cid] = list
  else delete store.byCast[cid]
  try {
    writeActions(root, store)
    return { ok: true, message: '已删除动作：' + aid }
  } catch (e) {
    return { ok: false, message: '删除动作失败：' + ((e as Error).message || String(e)) }
  }
}

// 删角色时连带清掉它的专属动作（library.removeFromLibrary 调）：动作是跟着角色走的，
// 角色没了就没人能演它——留着只会在 actions.json 里堆垃圾。
export function removeActionsOfCast(root: string, castId: string): void {
  const cid = String(castId || '').trim().toLowerCase()
  const store = readActions(root)
  if (!store.byCast[cid]) return
  delete store.byCast[cid]
  try { writeActions(root, store) } catch (e) { /* 清理失败不阻断删除角色 */ }
}
