// src/main/castLibrary.ts
// **全局角色库**：跨项目复用同一份角色绘制代码（品牌吉祥物、系列片主角那一类）。
//
// 三层关系（别混）：
//   · 项目角色  projects/<名>/cast/<id>.js   —— 这部片子的角色，随项目走（生成物）
//   · 全局角色库 <userData>/cast-library/     —— 应用级的角色库，用户可备份 / 迁移（不是安装包内容）
//   · core.js   项目根 ./core.js             —— 共享绘制助手（应用内置，版本同步，见 coreLib.ts）
//
// 为什么全局库要落在 userData 而不是随包 vendor/：它是**用户资产**（自己攒的角色、能带走、能备份），
// vendor 是应用资源（升级时被覆盖）。两者混在一起，一次升级就会把用户攒的角色冲掉。
//
// 为什么「导入」是复制而不是引用：预览协议与渲染静态服务器都只认项目目录内的文件
// （见 coreLib.ts 头部的说明），项目外的文件页面读不到，所以只能在导入时复制进 cast/。
// 也正因如此**全局库改了不会自动改已导入的项目**：角色是内容不是基础设施，
// 用户很可能已经在项目里改过它 —— 要更新就再点一次「从全局库添加」（同名覆盖）。
//
// 本文件刻意不 import electron（保持可离线测试）：库根目录由调用方给（projects.ts 传 userData 下的路径）。
import path from 'node:path'
import fs from 'node:fs'
import type { ProjectCastMember } from '../shared/types'

const LIB_INDEX = 'index.json'
const ID_RE = /^[a-z][a-z0-9_]{0,23}$/

// root 传的是库根目录（<userData>/cast-library）；路径拼装由本模块负责，调用方只管传根。

function indexPath(root: string): string {
  return path.join(root, LIB_INDEX)
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
      if (!it || typeof it !== 'object') continue
      const id = String(it.id || '').trim().toLowerCase()
      if (!ID_RE.test(id)) continue
      // 索引里有、但文件不在的条目照样列出来：界面据此显示「文件缺失」，而不是静默消失
      members.push({
        id,
        name: typeof it.name === 'string' ? it.name : id,
        desc: typeof it.desc === 'string' ? it.desc : '',
        units: isFinite(Number(it.units)) && Number(it.units) > 0 ? Number(it.units) : 8,
        ...(Array.isArray(it.uses) && it.uses.length ? { uses: it.uses.map(String) } : {})
      })
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

// 某个全局角色文件是否真的在库里（界面 / 导入时校验）
export function libraryFileExists(root: string, id: string): boolean {
  try { return fs.existsSync(path.join(root, id + '.js')) } catch (e) { return false }
}

// 把项目里已有的角色「存为全局」：复制 cast/<id>.js 到库里 + 更新索引（同 id 覆盖）
export function promoteFromProject(root: string, projectDir: string, member: ProjectCastMember): { ok: boolean; message: string } {
  const id = String(member && member.id || '').trim().toLowerCase()
  if (!ID_RE.test(id)) return { ok: false, message: '角色 id 不合法：' + String(member && member.id) }
  const src = path.join(projectDir, 'cast', id + '.js')
  if (!fs.existsSync(src)) return { ok: false, message: '项目里找不到这个角色的文件：cast/' + id + '.js' }
  try {
    fs.mkdirSync(root, { recursive: true })
    fs.copyFileSync(src, path.join(root, id + '.js'))
    const cur = readLibrary(root).members.filter((m) => m.id !== id)
    cur.push({
      id,
      name: String(member.name || id),
      desc: String(member.desc || ''),
      units: isFinite(Number(member.units)) && Number(member.units) > 0 ? Number(member.units) : 8,
      ...(member.uses && member.uses.length ? { uses: member.uses.slice() } : {})
    })
    writeLibrary(root, cur)
    return { ok: true, message: '已存为全局角色：' + id }
  } catch (e) {
    return { ok: false, message: '存为全局角色失败：' + ((e as Error).message || String(e)) }
  }
}

// 把全局角色导入项目：复制进 <项目>/cast/，并返回合并后的角色表（同名以全局库的元数据为准，
// 文件直接覆盖——用户要的就是「用库里这份」）。existing = 项目当前的角色表。
export function importToProject(root: string, projectDir: string, ids: string[], existing: ProjectCastMember[]): { ok: boolean; message: string; cast: ProjectCastMember[] } {
  const lib = readLibrary(root)
  const next: ProjectCastMember[] = (existing || []).slice()
  const imported: string[] = []
  const missing: string[] = []
  try {
    fs.mkdirSync(path.join(projectDir, 'cast'), { recursive: true })
    for (const raw of ids || []) {
      const id = String(raw || '').trim().toLowerCase()
      if (!ID_RE.test(id)) continue
      const m = lib.members.find((x) => x.id === id)
      const src = path.join(root, id + '.js')
      if (!m || !fs.existsSync(src)) { missing.push(id); continue }
      fs.copyFileSync(src, path.join(projectDir, 'cast', id + '.js'))
      const at = next.findIndex((x) => x.id === id)
      if (at >= 0) next[at] = { ...m }
      else next.push({ ...m })
      imported.push(id)
    }
  } catch (e) {
    return { ok: false, message: '导入全局角色失败：' + ((e as Error).message || String(e)), cast: existing || [] }
  }
  if (!imported.length) {
    return { ok: false, message: '没有导入任何角色' + (missing.length ? '（库里找不到：' + missing.join('、') + '）' : ''), cast: existing || [] }
  }
  return {
    ok: true,
    message: '已导入 ' + imported.length + ' 个全局角色（' + imported.join('、') + '）'
      + (missing.length ? '；库里缺文件跳过：' + missing.join('、') : ''),
    cast: next
  }
}

// 从全局库删掉一个角色（只删库里的副本，不影响任何项目里已导入的那些）
export function removeFromLibrary(root: string, id: string): { ok: boolean; message: string } {
  const cid = String(id || '').trim().toLowerCase()
  if (!ID_RE.test(cid)) return { ok: false, message: '角色 id 不合法' }
  try {
    const p = path.join(root, cid + '.js')
    if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    writeLibrary(root, readLibrary(root).members.filter((m) => m.id !== cid))
    return { ok: true, message: '已从全局库移除：' + cid }
  } catch (e) {
    return { ok: false, message: '移除失败：' + ((e as Error).message || String(e)) }
  }
}
