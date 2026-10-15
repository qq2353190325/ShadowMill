// utils/changelog.ts —— 随包 CHANGELOG.md 的极简解析（无状态纯函数，见 AGENTS.md 第 8 条）
// 数据来源：主进程 update:changelog（读 app.getAppPath()/CHANGELOG.md，随安装包内置的原文）。
// 界面只要三样东西：**版本 / 时间 / 每条一行标题**，所以这里只抽这三样——
// 影响范围与验证列不进界面（它们仍在 CHANGELOG.md 里，应用内不展示）。
// 为什么不引 markdown 渲染库：读进来的是纯文本，唯一要做的是把行内记号（`**` / 反引号 / 链接）
// 还原成可读文字，见 plainText()。
export interface ChangelogEntry {
  no: string
  date: string
  // `[标签]`（新增 / 修改 / 修复 / 重构 / 优化 / 文档 / 工程），抠不出来则为空串
  tag: string
  // 一行标题（已去掉行内 markdown 记号）
  title: string
}
export interface ChangelogBlock {
  title: string
  // 标题里的版本号（抓不到则为空串，如「未发布（下一版本）」）
  version: string
  // 版本日期：先取标题里的 yyyy-mm-dd，抓不到就用该块第一条（最新那条）的日期
  date: string
  entries: ChangelogEntry[]
}

// 单元格里的 `\|` 是**内容**而不是列分隔符（本文件第 20 条真的写了 `'image'\|'video'`），
// 先换成正文里不可能出现的占位符再按 `|` 切分，切完换回来。
const PIPE_TOKEN = '\u0001'
const PIPE_RE = new RegExp(PIPE_TOKEN, 'g')

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .replace(/\\\|/g, PIPE_TOKEN)
    .split('|')
    .map((c) => c.replace(PIPE_RE, '|').trim())
}

// 表头下的 `|---|---|` 分隔行（各版本列数不同，长度不固定）
const isSeparatorRow = (cells: string[]): boolean => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))

const VERSION_RE = /\d+\.\d+\.\d+/
const DATE_RE = /\d{4}-\d{2}-\d{2}/

// 行内记号还原成纯文字：`[文字](地址)` 只留文字，`**粗体**` 与反引号去掉。
// 界面是「一行标题」，不需要任何富文本，因此也不做 HTML 渲染（没有 v-html、没有逃逸问题）。
function plainText(s: string): string {
  return String(s == null ? '' : s)
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}

// 从「修改」列开头抠出 `[标签]`（标签只影响徽标配色，不参与任何判断）
export function splitEntryTag(change: string): { tag: string; text: string } {
  const src = String(change == null ? '' : change)
  const m = /^`?\[([^\]\n]{1,10})\]`?\s*/.exec(src)
  if (!m) return { tag: '', text: src }
  return { tag: m[1], text: src.slice(m[0].length) }
}

// 标签配色档位：成功 / 危险 / 警告 / 默认（与设计规范的语义色一一对应）
export function tagKind(tag: string): string {
  if (tag === '新增') return 'ok'
  if (tag === '修复') return 'err'
  if (tag === '优化') return 'warn'
  return ''
}

// 标题：先取第一段 `**…**`（这份日志的体例就是「`[标签]` **标题**：细节…」）；
// 没有粗体就取到第一个 `：` 之前，仍为空则整段——细节不截断，交给界面自然换行。
function entryTitle(change: string): string {
  const src = String(change == null ? '' : change)
  const bold = /\*\*([^*]+)\*\*/.exec(src)
  if (bold) return plainText(bold[1])
  const cut = plainText(src.split('：')[0])
  return cut || plainText(src)
}

// 解析：按 `## ` 切块；块内**按表头列名**取值（这份日志的表格有 5 列 / 4 列 / 3 列三套，
// 照固定下标取值必错），只读「#」与「日期」两列 + 从「修改」列抽标签与标题。
// 没有条目的块（如文首的「使用说明」）不进结果——它不是发布内容。
export function parseChangelog(text: string): ChangelogBlock[] {
  const blocks: ChangelogBlock[] = []
  let cur: ChangelogBlock | null = null
  let cols: string[] = []
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    const head = /^##\s+(.+)$/.exec(line)
    if (head) {
      const title = head[1].trim()
      cur = { title, version: (VERSION_RE.exec(title) || [''])[0], date: (DATE_RE.exec(title) || [''])[0], entries: [] }
      cols = []
      blocks.push(cur)
      continue
    }
    if (!cur || !line || !line.startsWith('|')) continue
    const cells = splitRow(line)
    if (isSeparatorRow(cells)) continue
    if (cells[0] === '#') { cols = cells; continue }   // 表头行（这份日志每个表格的首格都是 #）
    if (!cols.length) continue
    const pick = (name: string): string => {
      const i = cols.indexOf(name)
      return i >= 0 ? (cells[i] || '') : ''
    }
    const { tag, text } = splitEntryTag(pick('修改'))
    cur.entries.push({ no: pick('#') || (cells[0] || ''), date: pick('日期'), tag, title: entryTitle(text) })
  }
  // 版本日期回填：标题里没有日期时（「未发布（下一版本）」），用该块最新那条的日期
  for (const b of blocks) {
    if (!b.date && b.entries.length) b.date = b.entries[0].date
  }
  return blocks.filter((b) => b.entries.length > 0)
}

// 哪一块是「最新一版」：先要「与当前版本号同名」的块；发版前的工作都记在「未发布（下一版本）」里
// （该标题抓不到版本号），那时退化成第一个有条目的块——也就是文件里最上面的那一块。
export function pickDefaultBlock(blocks: ChangelogBlock[], currentVersion: string): number {
  const v = String(currentVersion || '').trim()
  if (v) {
    const hit = blocks.findIndex((b) => b.version === v)
    if (hit >= 0) return hit
  }
  return 0
}
