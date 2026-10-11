# 影坊（ShadowMill）

> Electron 桌面应用：以「项目」为粒度的一站式音视频创作流水线。本文件是项目入口，含项目简介、wiki 地址与界面设计规范指针。

## 一、项目简介

应用把音视频创作拆成五个可独立执行的节点，围绕同一个「项目」串联成完整流水线：

```
① 音色管理   →   ② 文字生音频   →   ③ 文字转字幕   →   ④ 字幕生成 HTML   →   ⑤ 转成视频
（Qwen-TTS 克隆音色）（Qwen-TTS 合成语音）（whisper.cpp 本机转录 / 手写·脚本生成）（自定义模型 Agent 流式生成）（HyperFrames 渲染 MP4）
```

- **项目化管理**：每个「项目」对应 `userData/projects/<项目名>/` 一个目录，统一存放 `project.json`、`subtitle.txt`、`index.html`、`audio/`、`video/`。
- **本机完成重活**：语音识别（whisper.cpp）与视频渲染（HyperFrames + FFmpeg）均在本机 CPU 运行，不消耗 API 额度；HTML 动画页面由用户自配置的 OpenAI 兼容模型 Agent 流式生成/修改。
- **技术栈**：Electron 31 + Vue 3 + electron-vite 5 + TypeScript（全量 TS；main/preload 输出 CJS）；无 vue-router / pinia，导航用页面注册表 + `goPage()`，全局状态为模块级 `reactive` 单例。
- **源码分层**：`src/main`（主进程 12 个模块）· `src/preload`（9 个命名空间的桥接层）· `src/renderer`（Vue 界面：外壳 / 8 页面 / 设计系统）· `src/shared`（IPC 频道常量与跨进程类型）· `src/agent`（独立实验脚本，不进构建图、不打包）。
- **运行**：`npm install` → `npm run dev`（开发）/ `npm run build`（构建）/ `npm run typecheck`（类型检查）；打包用 `npm run pack` 或 `npm run dist`。

## 二、wiki 地址

项目知识库位于 **`E:\my\wiki`**（**已纳入 git 跟踪**，随仓库一起提交）：

| 内容 | 地址 |
|---|---|
| 知识库索引（阅读顺序 + 逐文件文档总表） | [`wiki/README.md`](wiki/README.md) |
| 项目结构（技术栈、目录树、构建打包、运行时目录） | [`wiki/00-项目结构.md`](wiki/00-项目结构.md) |
| 架构总览（进程模型、IPC 契约 75 频道、数据流、安全边界） | [`wiki/01-架构总览.md`](wiki/01-架构总览.md) |
| 目录架构 · 主进程 | [`wiki/02-目录架构-src-main.md`](wiki/02-目录架构-src-main.md) |
| 目录架构 · 桥接层 | [`wiki/03-目录架构-src-preload.md`](wiki/03-目录架构-src-preload.md) |
| 目录架构 · 渲染层 | [`wiki/04-目录架构-src-renderer.md`](wiki/04-目录架构-src-renderer.md) |
| 目录架构 · 共享层 | [`wiki/05-目录架构-src-shared.md`](wiki/05-目录架构-src-shared.md) |
| 目录架构 · 独立 Agent 脚本 | [`wiki/06-目录架构-src-agent.md`](wiki/06-目录架构-src-agent.md) |
| 逐文件说明（按 `src/` 路径镜像归档） | `wiki/files/` |

其他项目级文档：`README.md`（面向使用者：功能、实现、流程、进度）、`REFACTOR_PLAN.md`（Vue3 + electron-vite + TS 重构计划与实施记录）。

## 三、界面设计规范

科技主题（Cyber UI / 深空科技：配色、字体与间距、组件风格、CSS 变量）正文随渲染层代码放置：

- 正文：[`src/renderer/agents.md`](src/renderer/agents.md)

约定：

1. 凡涉及 `src/renderer/` 下界面的改动（配色、字体、间距、圆角、组件风格、CSS 变量），一律以该文件为准。
2. 规范的落地实现是全局设计系统 `src/renderer/src/assets/main.css`；页面组件通过类名与 CSS 变量消费它。
3. 本文件只作入口与指针，不重复规范内容，避免两处漂移。

## 四、关键约定

1. **IPC 契约不改**：频道名集中在 `src/shared/ipc.ts`，载荷格式与 `src/preload/index.ts` 的 9 个命名空间方法一一对应；新增接口需主进程 `register()`、`shared/ipc.ts`、preload 三处齐改。
2. **preload 必须 CJS**：全工程不设 `"type": "module"`（仅 `src/agent/package.json` 单独声明 ESM）。
3. **改代码前先查 wiki 索引**：动任何源码前，先看 `wiki/README.md` 的索引定位受影响的文档，再动手。
4. **wiki 后台同步流程（必须照此走）**：代码改动**先落地并通过 typecheck**，wiki 一律交给**后台 subagent** 去改。主 agent 不亲自逐行改 wiki、不空等、**不要检查进度**（不反复 list/output 轮询）；派发时一次把任务说全，之后就继续干下一件事或直接答复，只在最后收一次结果。
   - **一次读、一次重写**：同一个文档只读一遍、只整篇重写一次，**禁止几十次小步 edit**（交叉引用散布在同名多行、行号遍布多文件时，逐处编辑是主要耗时来源）。
   - **任务里必须写死**：① 受影响的文件清单（含行数/结构变化）；② 依据的源码事实，**不许自己发明**；③ 不改任何源码、不新建文件；④ 写完回一份简短报告。
   - 主 agent 在代码改动收尾时留一份**给后台 agent 的简明变更清单**（新增/删除/改名的文件、页面键/注册表变化、新增组件与其契约），这就是派发任务的输入。
   - 为什么：wiki 同步是机械但量大的活（一次页面级重构能牵动数十个文档），逐行改的往返开销远大于重写；而后台 agent 独立核读源码时也更容易发现主 agent 的疏漏。
5. **wiki 文档粒度**：渲染层——**每个页面一篇**（该页面自己的子组件与助手并入同一篇，代码侧对应 `src/renderer/src/pages/<PageName>/` 一页一目录、入口 `index.vue`，代码与文档同构）、**目录级一篇**（`wiki/files/renderer/src/assets.md` 覆盖 `assets/`、`wiki/files/renderer/src/components.md` 覆盖 `components/`）、**公共方法与工具一篇**（`wiki/files/renderer/src/common.md`，覆盖 composables / utils / 页面注册表）；主进程、preload、shared 仍按源文件逐篇。
6. **跨目录导入用别名**：渲染层跨目录导入统一走 `@renderer/...`（如 `@renderer/composables/useAppStore`、`@renderer/utils/time`、`@renderer/components/StepBar.vue`、`@renderer/pages`）；仅同页面/同目录内部使用相对路径（`./Xxx.vue`）。
7. **`composables` 与 `utils` 的分界**：依赖 Vue 响应式 API（`ref`/`reactive`/`computed`/`watch`/生命周期）或有状态、带副作用（IPC 订阅、localStorage）的复用逻辑放 `src/renderer/src/composables/`，文件名以 **`use`** 开头（如 `useAppStore.ts`、`useToast.ts`、`useRenderProgress.ts`）；无状态纯函数放 `src/renderer/src/utils/`（如 `escape.ts`、`time.ts`、`rate.ts`）。

不要做需要等待的事情，比如打包，如果需要让我来