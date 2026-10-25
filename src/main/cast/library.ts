// src/main/cast/library.ts
// **全局角色库**：角色只有这一份（跨项目复用：品牌吉祥物、系列片主角那一类）。
//
// 三层关系（别混）：
//   · 全局角色库 <userData>/cast-library/  —— 角色的**唯一真源**：index.json 存元数据、<id>.js 存绘制代码；
//     同目录还有动作库 actions.json（公共动作 + 每个角色的专属动作，见 actions.ts）。
//     它是**用户资产**（可备份、可迁移、不是安装包内容），落 userData 而不是 vendor/ 正是因为升级不该冲掉它。
//   · 项目里的 <项目>/cast/<id>.js          —— **产物副本**：生成 / 预览 / 渲染只认项目目录内的文件
//     （hgpreview:// 协议与 HyperFrames 的静态服务器都只放行项目目录），所以用到哪个角色就把库里那份**复制**进去。
//     副本由 syncProjectCast() 统一维护，界面上不出现"导入 / 存为全局"这类动作。
//   · core.js <项目>/core.js                —— 共享绘制助手（应用内置，版本同步，见 coreLib.ts）。
//
// 项目只记「本片用了哪几个角色」（project.cast = [{ id, selected }]），元数据一律从库读 ——
// 所以库里改名 / 改身高，所有项目立刻跟着变（旧实现是每个项目各存一份快照，改不动也同步不了）。
//
// 本文件刻意不 import electron（保持可离线测试）：库根目录由调用方给（projects/ 传 userData 下的路径）。
import path from 'node:path'
import fs from 'node:fs'
import type { ProjectCastMember } from '../../shared/types'
import { removeActionsOfCast } from './actions'

const LIB_INDEX = 'index.json'
// 角色 id 是**可读 slug**（不是序号）：角色是命名实体，「改这个角色」要能叫出名字。
// 限制在 1–24 位小写字母数字下划线、且以字母开头 —— 直接当文件名用，不允许出现路径分隔符。
const ID_RE = /^[a-z][a-z0-9_]{0,23}$/

// root 传的是库根目录（<userData>/cast-library）；路径拼装由本模块负责，调用方只管传根。

function indexPath(root: string): string {
  return path.join(root, LIB_INDEX)
}

function memberFile(root: string, id: string): string {
  return path.join(root, id + '.js')
}

// uses 只认 'p5' / 'p5.brush'，与 table.ts 的 USES_WHITELIST 同口径（角色声明了 p5.brush 就补上 p5）
const USES_WHITELIST = ['p5', 'p5.brush']
function normalizeUses(raw: unknown): string[] {
  const set = new Set<string>()
  for (const u of (Array.isArray(raw) ? raw : [])) {
    const n = String(u === undefined || u === null ? '' : u).trim().toLowerCase()
    if (USES_WHITELIST.indexOf(n) >= 0) set.add(n)
  }
  if (set.has('p5.brush')) set.add('p5')
  return USES_WHITELIST.filter((u) => set.has(u))
}

function normalizeUnits(raw: unknown): number {
  const n = Number(raw)
  return isFinite(n) && n >= 1 && n <= 30 ? Math.round(n * 10) / 10 : 8
}

// 索引里的一条 → 成员（脏数据一律落回合法值；id 不合法的条目直接丢掉）
function normalizeMember(raw: unknown): ProjectCastMember | null {
  const it = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {}
  const id = String(it.id === undefined || it.id === null ? '' : it.id).trim().toLowerCase()
  if (!ID_RE.test(id)) return null
  const name = typeof it.name === 'string' ? it.name.trim().slice(0, 40) : ''
  const desc = typeof it.desc === 'string' ? it.desc.trim().slice(0, 400) : ''
  const style = typeof it.style === 'string' ? it.style.trim().slice(0, 600) : ''
  const uses = normalizeUses(it.uses)
  return {
    id,
    name: name || id,
    desc,
    units: normalizeUnits(it.units),
    ...(style ? { style } : {}),
    ...(uses.length ? { uses } : {})
  }
}

// 读全局库索引（文件缺失 / 损坏都当空库，不抛）
export function readLibrary(root: string): { members: ProjectCastMember[]; error?: string } {
  try {
    const p = indexPath(root)
    if (!fs.existsSync(p)) return { members: [] }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.members) ? raw.members : [])
    const members: ProjectCastMember[] = []
    for (const it of list) {
      // 索引里有、但文件不在的条目照样列出来：界面据此显示「文件缺失」，而不是静默消失
      const m = normalizeMember(it)
      if (m) members.push(m)
    }
    return { members }
  } catch (e) {
    return { members: [], error: '全局角色库索引读取失败：' + ((e as Error).message || String(e)) }
  }
}

function writeLibrary(root: string, members: ProjectCastMember[]): void {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(indexPath(root), JSON.stringify({ members }, null, 2), 'utf8')
}

// 某个全局角色文件是否真的在库里（界面 / 生成时校验）
export function libraryFileExists(root: string, id: string): boolean {
  try { return fs.existsSync(memberFile(root, String(id || '').toLowerCase())) } catch (e) { return false }
}

// 读一个角色的绘制代码（不存在 / 读失败都回空串，调用方自己判空）
export function readMemberCode(root: string, id: string): string {
  try {
    const cid = String(id || '').trim().toLowerCase()
    if (!ID_RE.test(cid)) return ''
    const p = memberFile(root, cid)
    if (!fs.existsSync(p)) return ''
    return fs.readFileSync(p, 'utf8')
  } catch (e) {
    return ''
  }
}

// 写一个角色的绘制代码（覆盖；不建索引 —— 索引由 upsertMember 维护）
export function writeMemberCode(root: string, id: string, code: string): { ok: boolean; message: string } {
  const cid = String(id || '').trim().toLowerCase()
  if (!ID_RE.test(cid)) return { ok: false, message: '角色 id 不合法：' + String(id) }
  try {
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(memberFile(root, cid), String(code || '').trim() + '\n', 'utf8')
    return { ok: true, message: '' }
  } catch (e) {
    return { ok: false, message: '写入角色代码失败：' + ((e as Error).message || String(e)) }
  }
}

// 新建 / 覆盖一条库成员：写索引（同 id 覆盖）＋ 可选写代码文件。
// 这是「新建角色」「改画法」与「从项目搬进库」的公共落盘点。
export function upsertMember(root: string, member: ProjectCastMember, code?: string): { ok: boolean; message: string } {
  const m = normalizeMember(member)
  if (!m) return { ok: false, message: '角色 id 不合法：' + String(member && member.id) }
  try {
    fs.mkdirSync(root, { recursive: true })
    if (code !== undefined) {
      const w = writeMemberCode(root, m.id, code)
      if (!w.ok) return w
    } else if (!fs.existsSync(memberFile(root, m.id))) {
      return { ok: false, message: '库里找不到这个角色的代码：' + m.id + '.js' }
    }
    // 保持原顺序（同 id 就地替换），新成员追加在末尾 —— 列表顺序对用户是稳定的
    const cur = readLibrary(root).members
    const at = cur.findIndex((x) => x.id === m.id)
    if (at >= 0) cur[at] = m
    else cur.push(m)
    writeLibrary(root, cur)
    return { ok: true, message: '' }
  } catch (e) {
    return { ok: false, message: (code !== undefined ? '写角色失败：' : '更新角色失败：') + ((e as Error).message || String(e)) }
  }
}

// 只改元数据（名字 / 描述 / 画风 / 身高 / 是否水彩），不碰代码文件
export function updateMemberMeta(root: string, id: string, patch: {
  name?: string
  desc?: string
  style?: string
  units?: number
  watercolor?: boolean
}): { ok: boolean; message: string; member?: ProjectCastMember } {
  const cid = String(id || '').trim().toLowerCase()
  if (!ID_RE.test(cid)) return { ok: false, message: '角色 id 不合法：' + String(id) }
  const lib = readLibrary(root)
  if (lib.error) return { ok: false, message: lib.error }
  const cur = lib.members.find((m) => m.id === cid)
  if (!cur) return { ok: false, message: '全局角色库里没有这个角色：' + cid }
  const next: ProjectCastMember = { ...cur }
  if (typeof patch.name === 'string') next.name = patch.name.trim().slice(0, 40) || cid
  if (typeof patch.desc === 'string') next.desc = patch.desc.trim().slice(0, 400)
  if (typeof patch.style === 'string') next.style = patch.style.trim().slice(0, 600)
  if (patch.units !== undefined) next.units = normalizeUnits(patch.units)
  if (patch.watercolor !== undefined) {
    const uses = patch.watercolor ? ['p5', 'p5.brush'] : []
    if (uses.length) next.uses = uses
    else delete next.uses
  }
  if (!next.style) delete next.style
  const w = upsertMember(root, next)
  if (!w.ok) return w
  return { ok: true, message: '', member: next }
}

// 把「本片用到哪几个角色」同步成项目里的副本目录 <项目>/cast/：
//   · 勾选的：从库复制（覆盖）进 cast/，保证生成 / 预览 / 渲染读得到；
//   · 取消勾选的：删掉它的副本（**只删库里认得的 id**——项目里若还留着库里没有的旧文件，
//     先不动它们，免得"库还没收进来就先删了副本"）。
// 调用时机：写盘前（生成 / 改稿 / 写骨架 / 角色勾选变化后重刷页面），见 projects/htmlWrite.ts。
export function syncProjectCast(root: string, projectDirPath: string, ids: string[]): { copied: string[]; removed: string[]; missing: string[] } {
  const lib = readLibrary(root)
  const libIds = new Set(lib.members.map((m) => m.id))
  const want = new Set<string>()
  for (const raw of (ids || [])) {
    const id = String(raw || '').trim().toLowerCase()
    if (ID_RE.test(id) && libIds.has(id)) want.add(id)
  }
  const copied: string[] = []
  const removed: string[] = []
  const missing: string[] = []
  const castDir = path.join(projectDirPath, 'cast')
  try { fs.mkdirSync(castDir, { recursive: true }) } catch (e) { return { copied, removed, missing: Array.from(want) } }
  for (const id of want) {
    const src = memberFile(root, id)
    if (!fs.existsSync(src)) { missing.push(id); continue }
    try { fs.copyFileSync(src, path.join(castDir, id + '.js')); copied.push(id) } catch (e) { missing.push(id) }
  }
  let names: string[] = []
  try { names = fs.readdirSync(castDir) } catch (e) { names = [] }
  for (const f of names) {
    const hit = /^([a-z][a-z0-9_]{0,23})\.js$/.exec(f)
    if (!hit) continue
    const id = hit[1]
    if (want.has(id) || !libIds.has(id)) continue
    try { fs.rmSync(path.join(castDir, f), { force: true }); removed.push(id) } catch (e) { /* ignore */ }
  }
  return { copied, removed, missing }
}

// 从全局库删掉一个角色（只删库里那份；已经同步到项目里的副本由下一次 syncProjectCast 收走）
// 它的**专属动作**（actions.json 的 byCast[<id>]，见 actions.ts）一并清掉：角色没了就没人演得了它们。
export function removeFromLibrary(root: string, id: string): { ok: boolean; message: string } {
  const cid = String(id || '').trim().toLowerCase()
  if (!ID_RE.test(cid)) return { ok: false, message: '角色 id 不合法' }
  try {
    const p = memberFile(root, cid)
    if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    writeLibrary(root, readLibrary(root).members.filter((m) => m.id !== cid))
    removeActionsOfCast(root, cid)
    return { ok: true, message: '已从角色库移除：' + cid }
  } catch (e) {
    return { ok: false, message: '移除失败：' + ((e as Error).message || String(e)) }
  }
}

// 下一个可用的 id（新建角色时标题里取不到英文 slug 就用它：cast2 / cast3 …）
export function nextAutoId(root: string, taken: string[] = []): string {
  const libIds = new Set(readLibrary(root).members.map((m) => m.id))
  let n = 1
  let id = 'cast' + n
  while (libIds.has(id) || taken.indexOf(id) >= 0) { n++; id = 'cast' + n }
  return id
}
