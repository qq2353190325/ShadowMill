// src/main/editRoute.ts
// 「按需求修改」的第一段：**只发大纲 + 用户的话**，让模型报「这次要改哪几个文件」；
// 第二段（projects.applyChapterEdit）才去读那几份源码发给它改。
//
// 为什么要分两段：章节模式的源码总量 = 章节数 × 单章 30–70 KB + 角色 × 10–20 KB，
// 5 章的长片一次全发就是 200 KB 以上，很容易撞模型的上下文上限；分两段后模型只看到
// 它自己点名的那一两份源码，用户说「把第 3 章改慢点」时就只发第 3 章。
// 代价是多一次调用（路由调用输出很短、很便宜）。
//
// 本文件只做解析与校验：不调模型、不读文件（读文件由 projects.ts 做）。
export interface EditTargets {
  // 要改的项目内相对路径（pages/cNN.js 或 cast/<id>.js），已过滤成 allowed 里的合法项
  paths: string[]
  // 是否要改结构（增删章节 / 增删角色 / 改时长）—— 是的话第二段要求模型先交新表
  restructure: boolean
  reason: string
}

const ROUTE_BLOCK_RE = /<<<ROUTE>>>([\s\S]*?)<<<END\s*ROUTE>>>/i
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i
// 一次最多让它点名几个文件：再多说明需求本身该拆开提，硬着头皮全发等于没路由
const MAX_TARGETS = 6

function tryJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(String(text || '').trim())
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch (e) { return null }
}

// 解析路由回复。allowed = 当前项目里**存在**的文件（章节 + 角色），路由结果只保留其中的合法项。
// 返回 route=null 且带 error 时，调用方应回退成「发全部源码」（老行为），保证修改不会因为路由失败而做不了。
export function parseRouteReply(reply: string, allowed: string[]): { route: EditTargets | null; error?: string } {
  const text = String(reply || '')
  const candidates: string[] = []
  const block = text.match(ROUTE_BLOCK_RE)
  if (block) candidates.push(block[1])
  const fence = text.match(FENCE_RE)
  if (fence) candidates.push(fence[1])
  candidates.push(text)
  let json: Record<string, unknown> | null = null
  for (const c of candidates) { json = tryJson(c); if (json) break }
  if (!json) return { route: null, error: '路由回复里找不到可解析的 JSON' }
  const allowSet = new Set(allowed)
  const rawTargets = Array.isArray(json.targets) ? json.targets : []
  const paths: string[] = []
  for (const t of rawTargets) {
    const rel = String(t === undefined || t === null ? '' : t).trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    // 允许模型写成 "c03" / "第 3 章" 这类模糊表达吗？不允许——路由阶段就要求给准确路径，
    // 给错的直接跳过（宁可回退成发全部，也不要猜错文件去改）。
    if (!allowSet.has(rel)) continue
    if (paths.indexOf(rel) < 0) paths.push(rel)
    if (paths.length >= MAX_TARGETS) break
  }
  const restructure = json.restructure === true
  if (!paths.length && !restructure) {
    return { route: null, error: '路由结果里没有任何合法目标文件（可能是模型给的路径与大纲不一致）' }
  }
  return {
    route: {
      paths,
      restructure,
      reason: typeof json.reason === 'string' ? json.reason.trim().slice(0, 200) : ''
    }
  }
}
