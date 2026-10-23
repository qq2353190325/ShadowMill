// src/main/coreLib.ts
// 「共享绘制助手」core.js 的版本同步：应用里有一份真源（vendor/shadowmill/core.js），
// 每个项目里有它的一份副本（项目根 ./core.js），骨架按 `./core.js` 引入。
//
// 为什么项目里必须有一份物理副本（而不是让页面直接引用全局路径）：
//   · 预览走 hgpreview:// 自定义协议，只放行「项目目录内」（见 main/index.ts 的 resolveHgPreviewPath）；
//   · 渲染走 HyperFrames CLI 的静态服务器，root 只有「编译产物目录 + 项目目录」两级。
//   项目外的路径在这两条链路上都读不到，所以只能在用到之前把文件复制进项目。
//
// 同步策略（2026-10-23 定）：**按版本号覆盖**。core.js 里写着 CORE_VERSION，
// 项目里记一份 .core-version；只有两者不一致才覆盖，并把 from→to 记进 userData/core-lib.log。
// 好处：应用升级后所有项目在下一次生成 / 预览 / 渲染时自动吃到新助手，同时日志里能查
// 「这条片子用的是哪个版本」。
//
// 本文件刻意不 import electron（保持可离线测试）：真源路径由调用方给（hfEnv.coreSource()），
// 本文件只做「读版本 / 比对 / 复制」。
import path from 'node:path'
import fs from 'node:fs'

// 项目内的文件名（骨架里的引用是 ./core.js）
export const CORE_FILE = 'core.js'
// 项目内记录的版本文件名（隐藏文件，避免与用户自己的文件混淆）
export const CORE_VERSION_FILE = '.core-version'

// 从源码里读 CORE_VERSION（`var CORE_VERSION = '1';`）：读不到返回 ''（调用方据此跳过同步，不乱覆盖）
export function parseCoreVersion(code: string): string {
  const m = String(code || '').match(/CORE_VERSION\s*=\s*['"]([0-9A-Za-z._-]+)['"]/)
  return m ? m[1] : ''
}

// 项目里记录的版本（没有文件 / 读不出 → ''）
export function readProjectCoreVersion(dir: string): string {
  try {
    const p = path.join(dir, CORE_VERSION_FILE)
    if (!fs.existsSync(p)) return ''
    return fs.readFileSync(p, 'utf8').trim()
  } catch (e) { return '' }
}

// 把真源同步进项目目录。返回 { copied, from, to }：
//   copied=false 表示版本已一致、什么都没做（幂等，预览/渲染每次调用都安全）。
export function syncCoreTo(dir: string, srcPath: string): { copied: boolean; from: string; to: string; error?: string } {
  const from = readProjectCoreVersion(dir)
  let code = ''
  try {
    if (!srcPath || !fs.existsSync(srcPath)) return { copied: false, from, to: from, error: '内置 core.js 不存在：' + String(srcPath) }
    code = fs.readFileSync(srcPath, 'utf8')
  } catch (e) {
    return { copied: false, from, to: from, error: '读内置 core.js 失败：' + ((e as Error).message || String(e)) }
  }
  const to = parseCoreVersion(code)
  if (!to) return { copied: false, from, to: from, error: '内置 core.js 里没有 CORE_VERSION' }
  // 版本相同且文件还在 → 什么都不做
  if (from === to && fs.existsSync(path.join(dir, CORE_FILE))) return { copied: false, from, to }
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, CORE_FILE), code, 'utf8')
    fs.writeFileSync(path.join(dir, CORE_VERSION_FILE), to + '\n', 'utf8')
    return { copied: true, from, to }
  } catch (e) {
    return { copied: false, from, to, error: '写项目 core.js 失败：' + ((e as Error).message || String(e)) }
  }
}

// 导出单文件时的内联来源：读项目里那份（导出物哪怕在别的机器上打开也要能跑）
export function readProjectCore(dir: string): string {
  try {
    const p = path.join(dir, CORE_FILE)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  } catch (e) { return '' }
}
