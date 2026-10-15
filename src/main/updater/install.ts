// src/main/updater/install.ts —— 退出并安装、下载缓存清理、忙碌状态推导
// 依赖方向：index → install → actions → base，本文件 import ./actions 的 checkNow 等动作与 ./base 的状态。
import { app, dialog, ipcMain } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { IPC } from '../../shared/ipc'
import { state, flags, ensureUpdater, appVersion, writeLog, msg, send } from './base'
import { notReady } from './actions'

// ===== 下载缓存（与 electron-updater 的 cacheDir 完全一致：ElectronAppAdapter.getAppCacheDir + app-update.yml）=====
// 用途只有一个：安装成功后清掉 pending/ 里那份重复的安装包（约 275 MB）；
// cacheDir/installer.exe 必须保留 —— 它是 electron-updater 下次差分下载的旧文件基线。
function updaterCacheDir(): string {
  const home = os.homedir()
  const base = process.platform === 'win32'
    ? (process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local'))
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches')
      : (process.env['XDG_CACHE_HOME'] || path.join(home, '.cache'))
  let dirName = app.getName() + '-updater'
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const m = /^\s*updaterCacheDirName:\s*(\S+)\s*$/m.exec(yml)
    if (m && m[1]) dirName = m[1]
  } catch (e) { /* 非安装版 / 文件缺失：落回 <name>-updater */ }
  return path.join(base, dirName)
}

// 安装是否真的生效，只能等下次启动比较版本号：installNow() 退出前落标记，
// 新进程版本与标记一致 ⇒ 装上了 ⇒ 清掉 pending/（那份安装包已在 cacheDir 里留了基线，重复的没必要留）
function installMarkerPath(): string {
  return path.join(app.getPath('userData'), 'update-installing.json')
}

export function finalizePendingUpdate(): void {
  let recorded = ''
  try {
    const raw = JSON.parse(fs.readFileSync(installMarkerPath(), 'utf8'))
    recorded = raw && typeof raw.version === 'string' ? raw.version : ''
  } catch (e) {
    return // 没有标记 = 本次启动与更新安装无关，什么都不做
  }
  try { fs.rmSync(installMarkerPath(), { force: true }) } catch (e) { /* ignore */ }
  const now = appVersion()
  if (!recorded || recorded !== now) {
    writeLog('install marker 版本 ' + (recorded || '(空)') + ' ≠ 当前 ' + now + '（未装上或已回退），保留下载缓存')
    return
  }
  try {
    const dir = path.join(updaterCacheDir(), 'pending')
    let cleaned = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      try {
        fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true })
        cleaned++
      } catch (e) { /* 单个失败不影响其余 */ }
    }
    if (cleaned) writeLog('安装成功（' + now + '），已清理下载缓存 pending/ 共 ' + cleaned + ' 项')
  } catch (e) { /* pending 目录不存在：正常情况 */ }
}

// 退出并安装。先置 quitForUpdate 标志（主进程 index.ts 的 window-all-closed 据此不再抢着 app.quit()），
// 再给用户一句明确的预期：安装期间应用目录会被清空重建，快捷方式会短暂失效。
export async function installNow(): Promise<any> {
  const u = ensureUpdater()
  if (!u) return notReady()
  if (!state.downloaded) return { ok: false, message: '更新尚未下载完成' }
  if (flags.busy) return { ok: false, message: '当前有任务正在进行（转录 / 渲染 / 配音），请等任务结束后再重启安装' }

  // 实测：一次更新要 90~120 秒（旧版整体卸载 + 约 1GB 安装内容解压/复制）。
  // 这段预期必须提前说清楚 —— 否则用户看到的是「应用莫名消失很久，点快捷方式说文件不存在」。
  const win = flags.getWindow ? flags.getWindow() : null
  const options = {
    type: 'info' as const,
    buttons: ['立即重启安装', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: '重启并安装更新',
    message: '重启并安装 ' + (state.version || '新版本') + '？',
    detail: [
      '安装期间应用会关闭约 1~2 分钟（新旧版本文件整体替换），完成后会自动重新打开。',
      '',
      '・期间桌面 / 开始菜单快捷方式会暂时失效，点击会提示「文件不存在或已被移动」，属正常现象，请勿重复点击；',
      '・若弹出系统权限（UAC）窗口，请点「是」，否则更新不会开始。'
    ].join('\n')
  }
  try {
    const res = (win && !win.isDestroyed())
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    if (res.response !== 0) {
      send('quitAndInstall cancelled by user')
      return { ok: true, message: '已取消安装，可稍后再点「立即重启安装」' }
    }
  } catch (e) {
    // 对话框失败不阻断安装（照旧往下走）
  }

  try {
    fs.writeFileSync(installMarkerPath(), JSON.stringify({ version: state.version || '', at: new Date().toISOString() }), 'utf8')
  } catch (e) { /* 标记写不了不影响安装，只是下次不会清缓存 */ }

  flags.quitFlag = true
  state.message = '正在退出并安装更新…'
  send('quitAndInstall ' + state.version)
  setTimeout(() => {
    try {
      u.quitAndInstall(true, true)
    } catch (e) {
      flags.quitFlag = false
      state.stage = 'error'
      state.error = '启动安装程序失败，请重新下载安装包后手动安装'
      state.detail = 'quitAndInstall 失败：' + msg(e)
      state.message = state.error
      send('quitAndInstall failed ' + msg(e))
    }
  }, 300)
  return { ok: true }
}

// ===== 忙碌状态：4 路进度通道的起止自动推导（不改动 whisper / video / ttsAlign / projects 模块）=====
export function bindBusyTracking(): void {
  // 开始即忙
  ipcMain.on(IPC.Whisper.Progress, (_e, d: any) => { flags.busy = !!(d && (d.stage === 'downloading' || d.stage === 'loading' || d.stage === 'transcribing')) })
  ipcMain.on(IPC.Video.Progress, () => { flags.busy = true })
  ipcMain.on(IPC.Voice.AlignProgress, (_e, d: any) => { flags.busy = !!(d && (d.stage === 'synth' || d.stage === 'assemble')) })
  ipcMain.on(IPC.Project.HtmlProgress, (_e, d: any) => { flags.busy = !!(d && d.stage !== 'done') })
}

// 供 register() 与主进程 index.ts 读的两个只读出口
export const isBusy = (): boolean => flags.busy
export const quitForUpdate = (): boolean => flags.quitFlag
