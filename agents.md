# 影坊（ShadowMill）

> Electron 桌面应用：以「项目」为粒度的一站式音视频创作流水线。本文件是项目入口，含项目简介、wiki 地址、更新日志（CHANGELOG）规则与界面设计规范指针。

## 一、项目简介

应用把音视频创作拆成五个可独立执行的节点，围绕同一个「项目」串联成完整流水线：

```
① 音色管理   →   ② 文字生音频   →   ③ 文字转字幕   →   ④ 字幕生成 HTML   →   ⑤ 转成视频
（Qwen-TTS 克隆音色）（Qwen-TTS 合成语音）（whisper.cpp 本机转录 / 手写·脚本生成）（自定义模型 Agent 流式生成）（HyperFrames 渲染 MP4）
```

- **项目化管理**：每个「项目」对应 `userData/projects/<项目名>/` 一个目录，统一存放 `project.json`、`subtitle.txt`、`index.html`、`audio/`、`video/`。
- **本机完成重活**：语音识别（whisper.cpp）与视频渲染（HyperFrames + FFmpeg）均在本机 CPU 运行，不消耗 API 额度；HTML 动画页面由用户自配置的 OpenAI 兼容模型 Agent 流式生成/修改。
- **技术栈**：Electron 31 + Vue 3 + electron-vite 5 + TypeScript（全量 TS；main/preload 输出 CJS）；无 vue-router / pinia，导航用页面注册表 + `goPage()`，全局状态为模块级 `reactive` 单例。
- **源码分层**：`src/main`（主进程 13 个模块：`index` + 11 个业务模块 + `updater/` 目录）· `src/preload`（9 个命名空间的桥接层）· `src/renderer`（Vue 界面：外壳 / 8 页面 / 设计系统）· `src/shared`（IPC 频道常量与跨进程类型）· `src/agent`（独立实验脚本，不进构建图、不打包）。
- **运行**：`npm install` → `npm run dev`（开发）/ `npm run build`（构建）/ `npm run typecheck`（类型检查）；打包用 `npm run pack` 或 `npm run dist`。

## 二、wiki 地址

项目知识库位于 **`E:\my\wiki`**（**已纳入 git 跟踪**，随仓库一起提交）：

| 内容 | 地址 |
|---|---|
| 知识库索引（阅读顺序 + 逐文件文档总表） | [`wiki/README.md`](wiki/README.md) |
| 项目结构（技术栈、目录树、构建打包、运行时目录） | [`wiki/00-项目结构.md`](wiki/00-项目结构.md) |
| 架构总览（进程模型、IPC 契约 85 频道、数据流、安全边界） | [`wiki/01-架构总览.md`](wiki/01-架构总览.md) |
| 目录架构 · 主进程 | [`wiki/02-目录架构-src-main.md`](wiki/02-目录架构-src-main.md) |
| 目录架构 · 桥接层 | [`wiki/03-目录架构-src-preload.md`](wiki/03-目录架构-src-preload.md) |
| 目录架构 · 渲染层 | [`wiki/04-目录架构-src-renderer.md`](wiki/04-目录架构-src-renderer.md) |
| 目录架构 · 共享层 | [`wiki/05-目录架构-src-shared.md`](wiki/05-目录架构-src-shared.md) |
| 目录架构 · 独立 Agent 脚本 | [`wiki/06-目录架构-src-agent.md`](wiki/06-目录架构-src-agent.md) |
| 逐文件说明（按 `src/` 路径镜像归档） | `wiki/files/` |

其他项目级文档：`README.md`（面向使用者：功能、实现、流程、进度）、[`CHANGELOG.md`](CHANGELOG.md)（**更新日志：按版本记录每次修改**）、`REFACTOR_PLAN.md`（Vue3 + electron-vite + TS 重构计划与实施记录）。

## 三、更新日志（CHANGELOG.md）

**任何改动都要落在 [`CHANGELOG.md`](CHANGELOG.md) 里**——它是本工程唯一的变更记录（更新日志 = 修改日志 = 版本记录，三者是同一份文件，**不要另建第二份**）。规则：

1. **动手前先看**：动任何代码前，先看 `CHANGELOG.md` 最上面的当前版本区块——里面是**这个版本已经改了什么**。目的是避免重复实现、避免与已写下的决定打架，并据此决定「这次是追加一条，还是更新已有条目」。
2. **改完必记一条**：每次修改都在**当前版本区块**里追加一条（一次修改一行），写清 `[标签]` 类别、改动内容、影响范围（文件 / 页面 / 模块）、验证方式（如 `typecheck` 全绿、`npm run dev` 手测通过、未验证）。**没记日志 = 这次改动不算完成**；日志之外还要按约定改 wiki（见第五节关键约定 6）。
3. **改两次算完整版**：同一个功能在当前版本里改到 **2 条及以上**，在它**表格最上方的那一条**（最新一次修改）标 `[完整版]` 并注明累计次数（如 `×2`）；只改过 1 条、还在演进中的标 `[待续]`。版本区块末尾用一行汇总本版哪些功能已到完整版，发布时一眼可见。
4. **版本号只有一处**：`package.json` 的 `version`。`CHANGELOG.md` 按它记录，不自己发明版本号、不在别处另写版本表；发版时升 `version`，把该区块标题的「待发布」换成实际发布日期，并新开一个 `## 未发布（下一版本）` 之上的空区块。
5. **粒度**：一个版本一个区块（新版本区块在最上面，`## 未发布（下一版本）` 永远在最顶），区块内条目按时间顺序编号（`#1`、`#2`…，越靠后越新），**新条目插在该区块表格最上方**（最新改动一眼可见，读到底部即本版最早的改动）；`[标签]` 只从 `[新增] [修改] [修复] [重构] [优化] [文档] [工程]` 里选，跨类别的改动拆成多条。

## 四、界面设计规范

科技主题（Cyber UI / 深空科技：配色、字体与间距、组件风格、CSS 变量）正文随渲染层代码放置：

- 正文：[`src/renderer/agents.md`](src/renderer/agents.md)

约定：

1. 凡涉及 `src/renderer/` 下界面的改动（配色、字体、间距、圆角、组件风格、CSS 变量），一律以该文件为准。
2. 规范的落地实现是全局设计系统 `src/renderer/src/assets/main.css`；页面组件通过类名与 CSS 变量消费它。
3. 本文件只作入口与指针，不重复规范内容，避免两处漂移。

## 五、关键约定

1. **IPC 契约不改**：频道名集中在 `src/shared/ipc.ts`，载荷格式与 `src/preload/index.ts` 的 9 个命名空间方法一一对应；新增接口需主进程 `register()`、`shared/ipc.ts`、preload 三处齐改。
2. **preload 必须 CJS**：全工程不设 `"type": "module"`（仅 `src/agent/package.json` 单独声明 ESM）。
3. **改代码前先查 wiki 索引与更新日志**：动任何源码前，先看 `wiki/README.md` 的索引定位受影响的文档，再看 [`CHANGELOG.md`](CHANGELOG.md) 当前版本区块确认「这个版本已经改了什么」，再动手。
4. **更新日志必记一条**：改完（并通过 typecheck）后，在 [`CHANGELOG.md`](CHANGELOG.md) 的**当前版本区块**追加一条 `[标签]` 记录（影响范围 + 验证方式）；改到第 2 次的功能标 `[完整版]`，仍在一个版本内演进的标 `[待续]`——**详细规则见第三节「更新日志」**，漏记视同改动未完成。
5. **wiki 后台同步流程（必须照此走）**：代码改动**先落地并通过 typecheck**，wiki 一律交给**后台 subagent** 去改。主 agent 不亲自逐行改 wiki、不空等、**不要检查进度**（不反复 list/output 轮询）；派发时一次把任务说全，之后就继续干下一件事或直接答复，只在最后收一次结果。
   - **一次读、一次重写**：同一个文档只读一遍、只整篇重写一次，**禁止几十次小步 edit**（交叉引用散布在同名多行、行号遍布多文件时，逐处编辑是主要耗时来源）。
   - **任务里必须写死**：① 受影响的文件清单（含行数/结构变化）；② 依据的源码事实，**不许自己发明**；③ 不改任何源码、不新建文件；④ 写完回一份简短报告。
   - **主 agent 不主动查，子 agent 结束再检查**：运行期间不轮询（不看 `list_agents` / `job_output`、不盯中间产物）；等它**结束那一次**再抽查它报告里**可核对的断言**——行数（用 `[IO.File]::ReadAllLines`，别用 `Get-Content .Count`）、文档里的代码块是否与源码逐行一致、`git diff` 与残留字符串检索。**后台 agent 的报告不是证据**：已两次出现自述与事实不符（一次用 `write` 把 400 行文档截断成 11 行、一次声称类型代码块"与源码逐字一致"却在里面写了源码中不存在的注释）。
   - 主 agent 在代码改动收尾时留一份**给后台 agent 的简明变更清单**（新增/删除/改名的文件、页面键/注册表变化、新增组件与其契约），这就是派发任务的输入。
   - 为什么：wiki 同步是机械但量大的活（一次页面级重构能牵动数十个文档），逐行改的往返开销远大于重写；而后台 agent 独立核读源码时也更容易发现主 agent 的疏漏。
6. **wiki 文档粒度**：渲染层——**每个页面一篇**（该页面自己的子组件与助手并入同一篇，代码侧对应 `src/renderer/src/pages/<PageName>/` 一页一目录、入口 `index.vue`，代码与文档同构）、**目录级一篇**（`wiki/files/renderer/src/assets.md` 覆盖 `assets/`、`wiki/files/renderer/src/components.md` 覆盖 `components/`）、**公共方法与工具一篇**（`wiki/files/renderer/src/common.md`，覆盖 composables / utils / 页面注册表）；主进程、preload、shared 仍按源文件逐篇。
7. **跨目录导入用别名**：渲染层跨目录导入统一走 `@renderer/...`（如 `@renderer/composables/useAppStore`、`@renderer/utils/time`、`@renderer/components/StepBar.vue`、`@renderer/pages`）；仅同页面/同目录内部使用相对路径（`./Xxx.vue`）。
8. **`composables` 与 `utils` 的分界**：依赖 Vue 响应式 API（`ref`/`reactive`/`computed`/`watch`/生命周期）或有状态、带副作用（IPC 订阅、localStorage）的复用逻辑放 `src/renderer/src/composables/`，文件名以 **`use`** 开头（如 `useAppStore.ts`、`useToast.ts`、`useRenderProgress.ts`）；无状态纯函数放 `src/renderer/src/utils/`（如 `escape.ts`、`time.ts`、`rate.ts`）。
9. **文件行数：300 行考虑拆，500 行是硬上限**：
   - **超过 300 行**：就该**考虑**拆分，并按「一个文件一件事」找自然边界（IPC 装配 / 纯计算 / 外部进程调用 / 状态机 / 路径与文件操作…）——不是任务式地凑行数，而是让每个文件只回答一个问题。
   - **超过 500 行**：**不允许**。新增或改动任何文件后都要核一下（`[IO.File]::ReadAllLines($f).Count`），超了就必须拆或落到下面的例外。
   - **模块拆分的形态**：一个模块拆成多文件时，**建同名目录 + `index.ts` 作统一出口**（如 `src/main/updater/index.ts`），并把**具名导出原样挂在 `index.ts` 上**——全库大量使用 `import * as x from './x'` 这种聚合式导入，这样改完**调用方一行都不用动**。
   - **拆分的依赖方向必须单向**：共享状态放依赖最上游那个文件（如 `updater/base.ts`），其余文件都从它读写；**上游不许 import 下游**，否则会成环。拆开后跨文件共享的 `let` 状态一律收进一个 `state` / `flags` 对象或改成取值函数——**别按值导出**（跨文件后只会交出初始快照，读的人永远看到空值）。
   - **例外（可不拆，但必须在该文件头部注释写明理由）**——只有这 4 类：
     ① **纯类型与常量声明**：整文件都是 `interface` / `type` / 常量表，是跨进程或跨模块契约的唯一真源（如 `src/shared/types.ts`），拆开只会让「接口定义散落各处」；
     ② **单一且顺序敏感的装配清单**：如 `src/main/index.ts`（窗口 / 协议 / 菜单 / 生命周期与 `register()` 顺序），拆开会让「启动顺序」这一件事散掉；
     ③ **紧耦合的单一状态机**：若一个文件全部代码都围绕同一份状态、同一组事件回调展开，把它按行数强行切碎只会让「谁在什么时候改状态」散落各处——这种整体保留是可以的。判据是「切出来的每一块单独看都不成立」，而不是「行数刚好超线」。（`src/main/updater/` 就是按这条判据处理的：它拆到 `base` / `actions` / `install` / `index` 四个文件后每块都能独立读懂，所以拆了；若切完每块都缺一半上下文，就该整体保留。）
     ④ **拆分本身会引入混乱**：需要新增跨文件共享可变状态、或拆完会互相 import 成环时。
   - **现状待办（不追溯**，改到哪个文件顺手处理哪个）：`src/shared/types.ts`（例外①）、`src/renderer/src/pages/HtmlGenPage/index.vue`（751 行）、`src/renderer/src/pages/TextTtsPage/VoiceSection.vue`（526 行）三处超过硬上限；300~500 之间的还有若干，按「动到它时再拆」处理。

不要做需要等待的事情，比如打包，如果需要让我来

1. 请提问，不要臆测。如果某件事不清楚，请在动手写一行代码之前先问清楚。切勿对意图、架构或需求做出任何未加说明的默认假设。

2. 首选最简单的方案。始终实现能够正常工作的最简单方案，不要引入未经明确要求的抽象或灵活性，如果有更好的方法，提出来，不要擅自改动方案。

3. 不要改动无关的代码。如果某个文件或函数与当前任务无直接关联，即使你认为它可以改进，也请勿修改，先提出来。

4. 明确标注不确定性。如果你对某种方法或技术细节缺乏把握，请在继续之前坦诚说明。没有把握却假装自信，其危害往往比承认自身不足更大。

5. 修改前先确认计划。在动手改代码之前，先列出计划修改的文件清单及改动要点，等用户确认后再执行。避免未经同意就大范围改动。