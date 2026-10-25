// src/main/cast/inject.ts
// 把「共享绘制助手 + 项目角色」注入到**模型写的单文件 index.html** 里。
//
// 为什么需要注入：章节模式的骨架由应用生成，直接写 script 标签就行；而单文件模式的 HTML 是模型
// 一次吐出来的，应用只能事后往里塞 —— 这正是"角色属于素材、与单文件/章节化无关"的落地方式：
// 不管页面是哪种形态，被勾选的角色都必须能 `window.__cast["hero"](x, y, u, { ctx })` 调用到。
//
// 三条规则：
//   ① **顺序**：core.js 在前、各角色在后；整组插在「模型自己的第一个 <script> 之前」——
//      script 是同步执行的，角色定义必须先于使用（否则模型页面里的调用会 undefined）；
//   ② **幂等**：注入的标签带 data-myv-* 标记，重写前先整组剥掉，反复生成/修改不会叠加；
//   ③ **兜底**：页面里一个 <script> 都没有（极端情况）就插到 </head> 前，再没有就插到文档最前。
// 本文件是纯函数（只做字符串变换），方便离线断言。
const CORE_MARK = 'data-myv-core'
const CAST_MARK = 'data-myv-cast'

const esc = (s: string): string => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 剥掉上一次注入的整组标签（含它们之间的空白）
export function stripInjectedCast(html: string): string {
  let out = String(html || '')
  out = out.replace(new RegExp('<script\\b[^>]*\\b' + CORE_MARK + '\\b[^>]*>\\s*</script>\\s*', 'gi'), '')
  out = out.replace(new RegExp('<script\\b[^>]*\\b' + CAST_MARK + '\\b[^>]*>\\s*</script>\\s*', 'gi'), '')
  return out
}

// 注入：relPaths = 要注入的角色文件（项目内相对路径，如 cast/hero.js，按角色表顺序）
// 返回注入后的 HTML；relPaths 为空时只注入 core.js（页面里没有角色也要有 MC.* 助手可用）。
export function injectCastTags(html: string, relPaths: string[], opts?: { withCore?: boolean }): string {
  const src = stripInjectedCast(html)
  const withCore = !opts || opts.withCore !== false
  const paths = (relPaths || []).filter((p) => /^cast\/[a-z][a-z0-9_]{0,23}\.js$/i.test(String(p || '')))
  const tags: string[] = []
  if (withCore) tags.push('<script ' + CORE_MARK + ' src="./core.js"></script>')
  for (const p of paths) {
    const id = p.replace(/^cast\//i, '').replace(/\.js$/i, '')
    tags.push('<script ' + CAST_MARK + '="' + id + '" src="./' + p + '"></script>')
  }
  if (!tags.length) return src
  const block = tags.join('\n')
  // ① 插在第一个 <script 之前（保持"定义先于使用"）
  const at = src.search(/<script\b/i)
  if (at >= 0) return src.slice(0, at) + block + '\n' + src.slice(at)
  // ② 没有 script：退到 </head> 前
  const headEnd = src.search(/<\/head\s*>/i)
  if (headEnd >= 0) return src.slice(0, headEnd) + block + '\n' + src.slice(headEnd)
  // ③ 连 head 都没有：放最前（浏览器仍会按顺序执行）
  return block + '\n' + src
}

// 页面里是否已经引了 core.js（预览/导出据此判断要不要同步/内联）
export function referencesCore(html: string): boolean {
  return new RegExp('src\\s*=\\s*["\'](?:\\.\\/)?' + esc('core.js') + '["\']', 'i').test(String(html || ''))
}
