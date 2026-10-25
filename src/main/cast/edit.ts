// src/main/cast/edit.ts
// 改稿提示词里的**角色块**（只读）：告诉模型页面里已经有哪些角色可以调用。
//
// 为什么只剩"只读"这一层：角色只有全局一份（见 library.ts），**改画法走「角色」页**
// （cast:recreate 调一次模型重画库里那份），不再由「生成 HTML / 按需求修改」顺手改——
// 用户明确要求"HTML 那边不允许新增和修改角色"。所以改稿只发角色表，不发角色源码、也不收角色文件块。
//
// 本文件只做纯字符串处理：不调模型、不读盘、不 import projects/（分工与 table.ts 一致）。
import { castRelPath } from './table'
import type { ProjectCastMember } from '../../shared/types'

// 把「角色文件块」与残留的 FILE 标记从回复里剥掉，只留可能存在的 HTML 部分。
// 为什么还要剥：提示词已经说明不许交角色文件块，但模型仍可能顺手裹一个进来；
// 不剥的话那些标记会跟着 HTML 一起落进 index.html（页面上看得见）。
export function stripCastFileBlocks(reply: string): string {
  return String(reply || '')
    .replace(/<<<FILE\s+cast\/[a-z][a-z0-9_]{0,23}\.js>>>[\s\S]*?<<<END\s*FILE>>>/gi, '')
    .replace(/<<<(?:END\s+)?FILE\b[^>]*>>>/gi, '')
}

// 【项目角色】块（改稿用，只读）：角色表 + 调用方式 + 三条硬要求。
// 与章节模式（buildChapterPrompt 里那段）口径一致：**必须沿用、不许重画**；
// 差别只在单文件模式要额外说清"角色文件不归你改"（它只可能被要求调整页面里的调用）。
export function buildCastTableBlock(list: ProjectCastMember[]): string {
  const all = list || []
  if (!all.length) {
    return '\n【项目角色】本项目还没有角色（不要写 window.__cast 的调用，也不要新建角色文件）。';
  }
  const table = all.map((m) => '- ' + castRelPath(m.id) + '（' + m.name + '，高 ' + m.units + 'u）：'
    + (m.desc || '未描述')
    + (m.selected === false ? '〔本次未勾选：不注入页面〕' : '')).join('\n');
  return [
    '\n【项目角色】本片用到 ' + all.length + ' 个**全局角色**（角色只有全局一份，由应用注入页面）。',
    '页面里 window.__cast["id"] 可用：',
    table,
    '\n【角色调用方式】window.__cast["id"](x, y, u, { ctx: ctx2d, … })：(x, y) 是脚底中点，u 是 1 个单位的像素数',
    '（角色高 N u ⇒ 想让它占画面高度的 1/3，就把 u 设成 画面高/3/N）。',
    '**光传 ctx，角色就是一张不会动的立绘**：它读 o 里的动画参数（o.walk 摆腿相位 / o.aL、o.aR 摆臂角度 / o.eyes、o.mouth 表情 /',
    ' o.blink 眨眼 / o.dy、o.dx 位移 / o.rot 旋转 / o.sq 挤压）。页面里已有的调用**保留并沿用原来的动画参数**，',
    '新写 / 改写的调用要按 t 算出呼吸、眨眼与摆臂（参数必须由 t 直接算，seek 后要能重现），确实要静止的镜头才只传 ctx。',
    '\n【硬要求】',
    '① **沿用，不许重画**：页面里已有的 window.__cast[...] 调用不许删，也不许在这份 HTML 里改成自己内联画一遍——',
    '   角色只有这一份绘制代码，重画就等于把用户的角色丢掉了；',
    '② **角色文件不归你改**：不要交 cast/*.js 文件块，也不要新造角色（角色的新建 / 改画法在应用的「角色」页做）；',
    '   需要"这个角色换个样子"时，请让用户去「角色」页改它，你只负责页面怎么用它。'
  ].join('\n');
}
