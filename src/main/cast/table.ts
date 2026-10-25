// src/main/cast/table.ts
// 角色库（PDoomVideo 式「共享的绘制函数层」）：一章一个 JS 文件解决的是时间切分，
// 而角色要解决的是**同一副长相在多章之间保持一致**——章节是互相隔离的 IIFE，作用域不共享，
// 所以角色必须由骨架在章节脚本之前引入（与参考项目把 clawd.js / cast.js 放在 ch/*.js 之前同理）。
//
// 本文件只做：解析角色表 / 解析角色文件块 / 校验 / 读项目里的角色副本 / 给提示词用的大纲文案。
// 不调模型、不 import projects/（分工同 chapters.ts）；**不写**角色代码（真源在全局角色库，见 library.ts）。
import path from 'node:path'
import fs from 'node:fs'
import { parseFileBlocksWith } from '../chapters'
import type { ProjectCastMember } from '../../shared/types'

const CAST_DIR = 'cast'
// 角色 id 是**可读 slug**（不是序号）：角色是命名实体，「改这个角色」要能叫出名字。
// 限制在 1–24 位小写字母数字下划线、且以字母开头 —— 直接当文件名用，不允许出现路径分隔符。
const ID_RE = /^[a-z][a-z0-9_]{0,23}$/
const FILE_RE = /^cast\/([a-z][a-z0-9_]{0,23})\.js$/
// 单个角色的代码上限（按行数粗校验）：角色是"一个人"，画到两三千行就不是它能承担的粒度了
const MAX_CAST_LINES = 1200

export function castRelPath(id: string): string {
  return CAST_DIR + '/' + id + '.js'
}

export function isCastPath(rel: string): boolean {
  return FILE_RE.test(String(rel || ''))
}

// ===== 角色表的解析（两种入口：规划回复里的 cast 数组、修改时的新 CAST 块）=====
const USES_WHITELIST = ['p5', 'p5.brush']

function normalizeMember(raw: unknown): { member?: ProjectCastMember; error?: string } {
  const it = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const id = String(it.id === undefined || it.id === null ? '' : it.id).trim().toLowerCase()
  if (!ID_RE.test(id)) return { error: '角色 id 不合法（要求小写字母开头的 slug，如 hero / researcher）：' + String(it.id) }
  const name = typeof it.name === 'string' ? it.name.trim().slice(0, 40) : ''
  const desc = typeof it.desc === 'string' ? it.desc.trim().slice(0, 200) : ''
  // units：角色高度等于几个单位 u。默认 8（与参考项目的主角同量级），非法值落回默认。
  const rawUnits = Number(it.units)
  const units = isFinite(rawUnits) && rawUnits >= 1 && rawUnits <= 30 ? Math.round(rawUnits * 10) / 10 : 8
  // uses：角色自己画的时候要用哪些随包库（水彩角色要 p5 + p5.brush）。骨架取「章节 uses ∪ 角色 uses」，
  // 否则只有角色用到 p5、没有任何章声明 p5 时，骨架不会引入 p5，角色一调用就崩。
  const useSet = new Set<string>()
  for (const u of (Array.isArray(it.uses) ? it.uses : [])) {
    const n = String(u === undefined || u === null ? '' : u).trim().toLowerCase()
    if (USES_WHITELIST.indexOf(n) >= 0) useSet.add(n)
  }
  if (useSet.has('p5.brush')) useSet.add('p5')
  const uses = USES_WHITELIST.filter((u) => useSet.has(u))
  // selected：是否参与本次生成（与素材勾选同语义）。缺省 true —— 老数据/新建都算参与。
  const selected = it.selected === false ? false : true
  return { member: { id, name: name || id, desc, units, selected, ...(uses.length ? { uses } : {}) } }
}

// 参与本次生成的角色（注入页面 / 写进骨架 / 进提示词，都只认勾选过的）。
// selected === false 才算不参与：undefined 当参与（老数据）。
export function selectedMembers(list: ProjectCastMember[] | undefined): ProjectCastMember[] {
  return (list || []).filter((m) => m && m.id && m.selected !== false)
}

export function normalizeCastList(raw: unknown): { cast: ProjectCastMember[]; error?: string } {
  if (raw === undefined || raw === null) return { cast: [] }
  if (!Array.isArray(raw)) return { cast: [], error: 'cast 必须是数组' }
  if (raw.length > 12) return { cast: [], error: '角色过多（' + raw.length + ' 个），一支片子里请控制在 12 个以内' }
  const out: ProjectCastMember[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const r = normalizeMember(raw[i])
    if (r.error) return { cast: [], error: '第 ' + (i + 1) + ' 个角色：' + r.error }
    const m = r.member as ProjectCastMember
    if (seen.has(m.id)) return { cast: [], error: '角色 id 重复：' + m.id }
    seen.add(m.id)
    out.push(m)
  }
  return { cast: out }
}

const TABLE_BLOCK_RE = /<<<CAST>>>([\s\S]*?)<<<END\s*CAST>>>/i
// 规划调用是**一次出两块**（chapters + cast 在同一个 JSON 里，整体裹在 PLAN 标记里），
// 所以这里也要认 PLAN 块——否则从规划回复里读不到角色表。
const TABLE_PLAN_RE = /<<<PLAN>>>([\s\S]*?)<<<END\s*PLAN>>>/i
const TABLE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i

// 从回复里读角色表（认 CAST 块 / PLAN 块 / ```json 围栏 / 裸 JSON 四种写法，都要求里面是个带 cast 数组的对象）。
// **生成流程已经不再使用它**：角色改为「项目素材」（手动新建 / 全局库导入，见 projects/ 的 NewCast 与
// library.ts），规划调用也不再产角色表。保留它是为了两条退路：① 将来允许模型在改稿里「顺手交一份角色表」；
// ② 离线断言与人工排查要能解析历史回复。改动它时注意别把校验规则（normalizeCastList）写松。
export function parseCastTable(reply: string): { cast: ProjectCastMember[] | null; error?: string } {
  const text = String(reply || '')
  const candidates: string[] = []
  const block = text.match(TABLE_BLOCK_RE)
  if (block) candidates.push(block[1])
  const planBlock = text.match(TABLE_PLAN_RE)
  if (planBlock) candidates.push(planBlock[1])
  const fence = text.match(TABLE_FENCE_RE)
  if (fence) candidates.push(fence[1])
  candidates.push(text)
  for (const c of candidates) {
    let json: Record<string, unknown> | null = null
    try {
      const v = JSON.parse(String(c || '').trim())
      if (v && typeof v === 'object' && !Array.isArray(v)) json = v as Record<string, unknown>
    } catch (e) { json = null }
    if (!json || !('cast' in json)) continue
    const n = normalizeCastList(json.cast)
    return n.error ? { cast: null, error: n.error } : { cast: n.cast }
  }
  return { cast: null }
}

// ===== 角色文件块的解析 =====
// 与章节共用同一套 `<<<FILE path>>> … <<<END FILE>>>` 标记，只是认可的路径是 cast/<id>.js。
export function parseCastFiles(reply: string, fallbackId?: string): { files: { path: string; code: string }[]; badPaths: string[] } {
  return parseFileBlocksWith(reply, isCastPath, fallbackId ? castRelPath(fallbackId) : undefined)
}

// 真的 HTML 形状才拒：闭合标签（`</div>` / `</script`）与常见多字母标签名。
// ⚠ 以前这里写的是 `/<`（出现一个小于号就算），于是 `side < 0`、`i < 3` 这类比较全被误判成
// 「出现了 HTML 标签」——现网实测踩过一次（模型写的角色代码里有 4 处 `side < 0`，直接判失败）。
// 比较运算的 `<` 后面跟的是数字/空格/变量名，不会形成 `</xxx>` 或 `<(div|span|…)\b` 这种形状。
const HTML_TAG_RE = /<\/[a-z][a-z0-9-]*\s*>|<!doctype|<(?:html|head|body|div|span|script|style|canvas|svg|img|video|audio|button|input|table|ul|ol|li)\b/i

// 角色代码的硬校验（写盘前）：必须是"往 __cast 上挂一个函数"，别的形式章节用不了。
export function validateCastCode(code: string): string | null {
  const c = String(code || '')
  if (!c.trim()) return '角色代码是空的'
  if (!/__cast/.test(c)) return '角色代码没有登记到 window.__cast 上：需要 window.__cast["hero"] = function (x, y, u, o) { … }'
  if (!/function\s*\(|=>/.test(c)) return '角色代码里没有可调用的绘制函数'
  if (HTML_TAG_RE.test(c)) {
    // 角色是纯绘制代码，出现标签基本就是模型把 HTML 混进来了（</script 会截断页面）
    return '角色代码里出现了 HTML 标签（角色文件只能是 JS）'
  }
  if (/repeat\s*:\s*(?:-1|Infinity)\b/i.test(c.replace(/\s+/g, ' '))) {
    return '角色代码里有无限循环（repeat: -1）：角色本身不该带时间轴，动画请写在章节里'
  }
  if (c.split('\n').length > MAX_CAST_LINES) return '角色代码过长（超过 ' + MAX_CAST_LINES + ' 行），请拆成更简单的画法'
  return null
}

// ===== 读项目里的角色副本 =====
// 项目里的 <项目>/cast/<id>.js 是**产物副本**（由 library.ts 的 syncProjectCast 从全局角色库同步），
// 所以这里只有"读"，**没有写**：角色代码的真源是库，「改画法」走 cast:recreate。
export function readCastCode(dir: string, cast: ProjectCastMember[]): { id: string; name: string; code: string }[] {
  return cast.map((m) => {
    let code = ''
    try {
      const p = path.join(dir, CAST_DIR, m.id + '.js')
      if (fs.existsSync(p)) code = fs.readFileSync(p, 'utf8')
    } catch (e) { /* ignore */ }
    return { id: m.id, name: m.name, code }
  })
}

// 提示词用的角色表（逐章生成与修改都带上；只有元数据，没有源码）
export function castOutlineText(cast: ProjectCastMember[]): string {
  if (!cast.length) return '本片没有共享角色（画面里不要出现固定角色，或由各章自己画一次性的路人）'
  return cast.map((m, i) => '- ' + m.id + '（' + m.name + '，高 ' + m.units + 'u）：' + (m.desc || '（未描述）')).join('\n')
}
