# src/main/updater.ts（已迁走，见目录级文档）

> **这个源文件已经不存在了。** 原 600 行的单文件 `src/main/updater.ts` 已 `git mv` 成 `src/main/updater/index.ts`，并拆成同名目录下的 4 个文件；**现状文档是目录级的一篇**。

## 现在的结构

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/main/updater/index.ts` | 104 | **统一出口**：`register(ctx)` 装配 7 个 `update:*` 频道 + 3 秒启动静默检查 + 5 秒迟到清缓存；具名导出原样挂在 index 上 |
| `src/main/updater/base.ts` | 270 | 运行态单例（`updater` / `flags` / `state`）、日志与小工具、`humanError()`、进度推送、事件绑定与懒加载 |
| `src/main/updater/actions.ts` | 139 | 对外动作：`notReady()` / 更新源覆盖 / `checkNow()` / `downloadUpdate()` / `cancelDownload()` |
| `src/main/updater/install.ts` | 145 | `finalizePendingUpdate()` / `installNow()` / `busy` 推导（`bindBusyTracking()`，其中 `project:html-progress` 按活动 `taskId` 集合判忙）/ `quitForUpdate()` |

依赖方向单向：`index.ts → install.ts → actions.ts → base.ts`（`base.ts` 不 import 任何同目录模块）。调用方与对外接口未变——`src/main/index.ts` 仍是 `import * as updater from './updater'`，只用 `register(ctx)` 与 `quitForUpdate()`。

## 文档去哪了

**→ [main/updater.md](./updater.md)**（目录级一篇，覆盖上面 4 个文件）

那篇里保留了原先写作的全部实质内容：职责清单、对外导出表、`register()` 的频道装配、更新源优先级（阿里云 OSS 的四点注意事项）、检查 → 下载 → 安装流程与两条「无事件不算成功」的守卫、忙碌态判定表、打开日志目录的流程与出现时机、状态文案对照表、`humanError()` 的分层与映射表、依赖与协作，以及 §6 的发版清单（五类七个文件 + `npm run release` 自检）。

**保留本文件只为一件事：旧链接不会 404。** 它名下的「600 行单文件」描述已整体作废，不要再把它当现状阅读。
