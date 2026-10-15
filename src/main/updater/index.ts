// src/main/updater/index.ts
// 应用自更新（electron-updater + electron-builder generic provider）—— 本目录的统一出口。
// 提供：register(ctx) 装配（update:check / update:download / update:cancel / update:install IPC + update:progress 回推）
//       checkNow / downloadUpdate / cancelDownload / installNow / isBusy / quitForUpdate
// 依赖：app / ipcMain / electron-updater（作为 dependencies 随包发布，不内联）+ settings.ts（读 updater.feedUrl）
//
// 子模块（依赖单向：本文件 → install → actions → base，base 不 import 任何同级模块，故不会成环）：
//   base.ts    运行态单例、日志与小工具、humanError 文案映射、进度推送、electron-updater 事件绑定与懒加载
//   actions.ts 对外动作：检查 / 下载 / 取消（含更新源覆盖与两条「无事件不许报成功」的纪律）
//   install.ts 退出并安装、下载缓存清理、忙碌状态推导
//
// 三条设计约定：
// ① 更新源优先级：settings.json 的 updater.feedUrl（非空即覆盖）> 打包时 resources/app-update.yml 的 publish 地址。
//    前者供测试源 / 内网源切换，后者由 package.json 的 build.publish 在 npm run dist 时生成。
// ② 下载由用户显式触发（autoDownload = false）：安装包近百 MB，不在后台偷流量。
//    安装同样只由用户显式触发（autoInstallOnAppQuit = false）：NSIS 的更新是「整体卸载旧版 → 解压复制新包」，
//    实测一次约 97 秒，期间应用不存在、桌面快捷方式指向空路径（点击报「文件不存在或已被移动」）。
//    这种长时间不可用必须由用户点确认后发生，不能因为「用户只是关了个窗」就在背后静默开始。
// ③ 安装前检查「本机任务是否在跑」：whisper 转录 / HyperFrames 渲染 / 逐句对齐期间重启会丢进度，
//    故忙碌时拒绝安装并回明确文案（忙状态由 4 路进度通道的起止自动推导，无需其它模块配合）。
// ④ electron-updater 一律**懒加载**（base.ensureUpdater）：启动路径不 require 它，首屏不为更新模块买单。
// ⑤ 错误文案分两层：message 说人话给终端用户，detail 存原始报错给排障（见 base.humanError）。
// ⑥ 安装成功后清一次下载缓存：pending/ 那份与 cacheDir/installer.exe 重复（各约 275 MB），
//    是否装上只能等下次启动用版本号验证，故退出前落 update-installing.json 标记（见 install.ts）。
// ⑦ **检查必须「有事件才算成功」**：electron-updater 的 checkForUpdates() 有两种「一个字的事件都不发」的
//    静默放弃——① 未打包且未 forceDevUpdateConfig 时 isUpdaterActive() 为假，直接 `return null`；
//    ② 已有一次检查在飞时复用同一个 Promise，也不再发事件。这两种情况若照样按成功回带，主进程自己
//    写下的临时文案「正在检查更新…」就会被当成终态送到界面——卡片永远停在那句话上，看起来像卡死。
//    所以 actions.checkNow() 在报成功之前必判一次「state.stage 是否还停在 checking」（见该函数注释）。
import { app, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../../shared/ipc'
import type { RegisterCtx } from '../../shared/types'
import { getUpdaterSettings } from '../settings'
import { flags, ensureUpdater, writeLog, payload, errText, logPath, appVersion, getUpdaterLoadError } from './base'
import { checkNow, downloadUpdate, cancelDownload } from './actions'
import { installNow, finalizePendingUpdate, bindBusyTracking, isBusy, quitForUpdate } from './install'

function register(ctx: RegisterCtx): void {
  flags.getWindow = ctx && ctx.getWindow ? ctx.getWindow : null

  // 这里刻意**不**加载 electron-updater：装配阶段只挂 IPC 与忙碌推导（都是极轻的操作），
  // 真正的 require 推迟到 base.ensureUpdater()——即启动静默检查（3s 后）或用户手动点检查时。
  bindBusyTracking()

  ipcMain.handle(IPC.Update.Check, () => checkNow('manual'))
  ipcMain.handle(IPC.Update.Download, () => downloadUpdate())
  ipcMain.handle(IPC.Update.Cancel, () => cancelDownload())
  ipcMain.handle(IPC.Update.Install, () => installNow())
  // 同步版本号：设置页首屏要立刻显示，避免走 async 再等一轮渲染
  ipcMain.on(IPC.Update.Version, (event) => { event.returnValue = appVersion() })
  // 取当前状态：状态活在主进程（跨页面挂载持续存在），设置页挂载时用它补齐一次。
  // 这是「启动静默检查失败」唯一能被渲染层看见的路径——那次失败发生在设置页订阅进度之前。
  ipcMain.handle(IPC.Update.Status, () => payload())
  // 打开日志：更新失败时用户 / 维护者拿到原始报错的唯一出口。
  // 刻意不进 ensureUpdater——electron-updater 加载失败恰恰是最需要看日志的场景。
  ipcMain.handle(IPC.Update.OpenLog, () => {
    const p = logPath()
    try {
      if (fs.existsSync(p)) shell.showItemInFolder(p)        // 有日志：在文件管理器里选中它
      else void shell.openPath(app.getPath('userData'))      // 还没写过日志：至少把目录打开
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, message: '打开日志目录失败', detail: errText(e) }
    }
  })

  // 启动静默检查一次：延迟 3s 让窗口首屏先出来；autoCheck 关闭或非安装版（无 app-update.yml）则跳过
  setTimeout(() => {
    if (flags.checkedOnce) return
    flags.checkedOnce = true
    const cfg = getUpdaterSettings()
    if (!cfg.autoCheck) { writeLog('startup check skipped: autoCheck=false'); return }
    // dev 下 electron-vite 未打包，没有 app-update.yml：要么配 dev-app-update.yml + forceDevUpdateConfig，要么跳过
    if (!app.isPackaged && !fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'))) {
      writeLog('startup check skipped: dev 环境未提供 dev-app-update.yml')
      return
    }
    const u = ensureUpdater()
    if (!u) return
    // dev 下的 forceDevUpdateConfig 由 ensureUpdater() 统一设置（上面的提前 return 已保证 dev 必有该文件）
    void checkNow('startup')
  }, 3000)

  // 上次退出是去装更新了吗？是的话这次启动顺手清掉下载缓存里的重复安装包（约 275 MB）。
  // 延迟 5s：别和首屏、启动检查抢时间；清缓存失败也只是少腾点磁盘，不影响任何功能。
  setTimeout(() => { finalizePendingUpdate() }, 5000)
}

export {
  register,
  checkNow,
  downloadUpdate,
  cancelDownload,
  installNow,
  isBusy,
  quitForUpdate
}

// `updaterLoadError` 早前按字符串导出，拆分后改为取值函数（`() => string`）：它是懒加载那一刻才写入的，
// 按值导出在跨文件拆分后只会交出初始快照（永远是 ''），读的人再也看不到真正的失败原因。
// 本仓库内没有调用方（只有本模块自己写日志用），故直接改签名而不再保留旧的字符串导出。
export { getUpdaterLoadError as updaterLoadError } from './base'
