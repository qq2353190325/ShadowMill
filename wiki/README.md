# ShadowMill 项目 Wiki

> 本目录是对 `E:\my`（Electron + Vue 3 + electron-vite + TypeScript 的桌面应用「影坊 / ShadowMill」）的**源码知识库**：先给工程结构与目录架构，再给各文件/各页面的说明。
>
> 文档全部由阅读真实源码生成，未改动 `src/` 下任何代码。

---

## 一、阅读顺序

| # | 文档 | 内容 | 适合谁 |
|---|---|---|---|
| 0 | [00-项目结构](./00-项目结构.md) | 技术栈与版本、仓库顶层结构、`src/` 完整目录树、构建与打包、运行时数据目录、全局约定 | 第一次接触项目的人 |
| 1 | [01-架构总览](./01-架构总览.md) | 进程模型、启动时序、**IPC 契约全貌（81 个频道总表）**、以「项目」为中心的数据流、四条关键业务链路、主进程依赖图、安全边界 | 想理解整体设计的人 |
| 2 | [02-目录架构-src-main](./02-目录架构-src-main.md) | 主进程 13 个模块的职责、装配模式 `register(ctx)`、模块依赖图、各域要点 | 改主进程 / 加 IPC |
| 3 | [03-目录架构-src-preload](./03-目录架构-src-preload.md) | 桥接层：11 个命名空间、6 路进度通道的「单订阅」语义、类型来源与 CJS 约束 | 改接口 / 排查跨进程调用 |
| 4 | [04-目录架构-src-renderer](./04-目录架构-src-renderer.md) | Vue 渲染层：启动链路、无 router 的注册表导航、状态与通信约定、组件分层、页面↔主进程域对照、样式策略 | 改界面 / 加页面 |
| 5 | [05-目录架构-src-shared](./05-目录架构-src-shared.md) | 频道常量（10 组 81 个）、跨进程载荷类型、**应用级常量（品牌文案）**、消费方与编译期归属、维护约定 | 动契约前必读 |
| 6 | [06-目录架构-src-agent](./06-目录架构-src-agent.md) | 独立实验脚本：为什么不进构建图、5 个工具、工作区防护、运行方式 | 想跑 Agent 样例 |
| 7 | [files/](./files/) | **说明文档**（按下方 3.x 的粒度组织，`files/` 下共 **40** 篇；其中 `renderer/src/components.md` 一篇覆盖 `components/` 下的 `StepBar.vue`、`NewProjectDialog.vue`、`HfSelect.vue` 与 `LegacyDataDialog.vue` 四个组件） | 需要具体实现细节时查阅 |

---

## 二、项目一句话

五节点音视频创作流水线：**音色管理 → 文字生音频 → 文字转字幕 → 字幕生成 HTML（含转视频）→ 视频预览**，以「项目」为粒度组织产物；语音识别（whisper.cpp）与视频渲染（HyperFrames + FFmpeg）均在本机完成，HTML 动画由用户自配置的 OpenAI 兼容模型 Agent 流式生成。

---

## 三、说明文档索引

> **粒度约定**（与根目录 `AGENTS.md` 的规则 5 一致）：渲染层按「**每页一篇**（该页面自己的子组件与助手并入同一篇；代码侧对应 `src/renderer/src/pages/<PageName>/` 一页一目录、入口 `index.vue`）、**`assets.md` / `components.md` 目录级各一篇**、**`common.md` 公共方法与工具一篇**」组织；主进程、preload、shared、agent 与工程根配置按源文件逐篇。

### 3.1 `src/main/`（主进程，13 篇）

| 源文件 | 说明文档 |
|---|---|
| `src/main/index.ts` | [main/index.ts.md](./files/main/index.ts.md) |
| `src/main/hfEnv.ts` | [main/hfEnv.ts.md](./files/main/hfEnv.ts.md) |
| `src/main/settings.ts` | [main/settings.ts.md](./files/main/settings.ts.md) |
| `src/main/systemVoices.ts` | [main/systemVoices.ts.md](./files/main/systemVoices.ts.md) |
| `src/main/htmlAgent.ts` | [main/htmlAgent.ts.md](./files/main/htmlAgent.ts.md) |
| `src/main/projects.ts` | [main/projects.ts.md](./files/main/projects.ts.md) |
| `src/main/voice.ts` | [main/voice.ts.md](./files/main/voice.ts.md) |
| `src/main/ttsAlign.ts` | [main/ttsAlign.ts.md](./files/main/ttsAlign.ts.md) |
| `src/main/video.ts` | [main/video.ts.md](./files/main/video.ts.md) |
| `src/main/whisper.ts` | [main/whisper.ts.md](./files/main/whisper.ts.md) |
| `src/main/vad.ts` | [main/vad.ts.md](./files/main/vad.ts.md) |
| `src/main/updater.ts` | [main/updater.ts.md](./files/main/updater.ts.md) |
| `src/main/runtime.ts` | [main/runtime.ts.md](./files/main/runtime.ts.md) |

### 3.2 `src/preload/` 与 `src/shared/`（5 篇）

| 源文件 | 说明文档 |
|---|---|
| `src/preload/index.ts` | [preload/index.ts.md](./files/preload/index.ts.md) |
| `src/preload/index.d.ts` | [preload/index.d.ts.md](./files/preload/index.d.ts.md) |
| `src/shared/ipc.ts` | [shared/ipc.ts.md](./files/shared/ipc.ts.md) |
| `src/shared/types.ts` | [shared/types.ts.md](./files/shared/types.ts.md) |
| `src/shared/constants.ts`（应用级公共常量：品牌文案与请求标识） | [shared/constants.ts.md](./files/shared/constants.ts.md) |

### 3.3 `src/renderer/`（渲染层，17 篇）

| 覆盖的文件 | 说明文档 |
|---|---|
| `index.html` | [renderer/index.html.md](./files/renderer/index.html.md) |
| `src/main.ts` | [renderer/src/main.ts.md](./files/renderer/src/main.ts.md) |
| `src/env.d.ts` | [renderer/src/env.d.ts.md](./files/renderer/src/env.d.ts.md) |
| `src/constants.ts`（渲染层公共常量：`localStorage` 键名） | [renderer/src/constants.ts.md](./files/renderer/src/constants.ts.md) |
| `src/App.vue`（外壳） | [renderer/src/App.vue.md](./files/renderer/src/App.vue.md) |
| `src/assets/`（设计系统：`main.css`） | [renderer/src/assets.md](./files/renderer/src/assets.md) |
| `src/components/`（通用组件：`StepBar.vue`、`NewProjectDialog.vue`、`HfSelect.vue`、`LegacyDataDialog.vue`） | [renderer/src/components.md](./files/renderer/src/components.md) |
| **公共方法与工具**：`src/composables/{useAppStore,useToast,useRenderProgress,useRuntime,useLegacyData,useRenderOptions}.ts`、`src/utils/{escape,rate,time,render}.ts`、`src/pages/index.ts` | [renderer/src/common.md](./files/renderer/src/common.md) |
| `src/pages/HomePage/index.vue` | [renderer/src/pages/HomePage.md](./files/renderer/src/pages/HomePage.md) |
| `src/pages/AboutPage/index.vue` | [renderer/src/pages/AboutPage.md](./files/renderer/src/pages/AboutPage.md) |
| `src/pages/ContentPage/index.vue` | [renderer/src/pages/ContentPage.md](./files/renderer/src/pages/ContentPage.md) |
| `src/pages/TextTtsPage/`（入口 `index.vue` **+** `SynthSection.vue` / `AlignSection.vue` / `VoiceSection.vue` / `helpers.ts`） | [renderer/src/pages/TextTtsPage.md](./files/renderer/src/pages/TextTtsPage.md) |
| `src/pages/SubtitlePage/`（入口 `index.vue` **+** `TranscribeSection.vue` / `helpers.ts`） | [renderer/src/pages/SubtitlePage.md](./files/renderer/src/pages/SubtitlePage.md) |
| `src/pages/HtmlGenPage/index.vue` | [renderer/src/pages/HtmlGenPage.md](./files/renderer/src/pages/HtmlGenPage.md) |
| `src/pages/VideoPreviewPage/index.vue` | [renderer/src/pages/VideoPreviewPage.md](./files/renderer/src/pages/VideoPreviewPage.md) |
| `src/pages/SettingsPage/`（入口 `index.vue` **+** `WhisperSection.vue`） | [renderer/src/pages/SettingsPage.md](./files/renderer/src/pages/SettingsPage.md) |

> 页面按「**一个页面一个文件夹**」组织，入口统一为 `index.vue`，该页面自己的子组件与助手（如 `TextTtsPage/SynthSection.vue`、`SubtitlePage/helpers.ts`）并入同一篇说明文档；`src/renderer/src/pages/index.ts` 是**页面注册表**，不随页面目录拆分，归属上面的「**公共方法与工具**」一篇（[`common.md`](./files/renderer/src/common.md)）。
>
> `src/renderer/agents.md` 是**界面设计规范正文**（科技主题 / Cyber UI），属于规范文档而非源码说明，故不另建说明文档；根目录 [`agents.md`](../agents.md) 是指向它的项目入口。

### 3.4 `src/agent/`（独立实验脚本，2 篇）

| 源文件 | 说明文档 |
|---|---|
| `src/agent/index.ts` | [agent/index.ts.md](./files/agent/index.ts.md) |
| `src/agent/package.json` | [agent/package.json.md](./files/agent/package.json.md) |

### 3.5 工程根配置（4 篇）

| 文件 | 说明文档 |
|---|---|
| `package.json` | [root/package.json.md](./files/root/package.json.md) |
| `electron.vite.config.ts` | [root/electron.vite.config.ts.md](./files/root/electron.vite.config.ts.md) |
| `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` / `tsconfig.agent.json` | [root/tsconfig.md](./files/root/tsconfig.md) |
| `.gitignore` | [root/gitignore.md](./files/root/gitignore.md) |

> `README.md`、`REFACTOR_PLAN.md` 属于项目级说明文档，其内容不再二次转述，直接阅读原文件即可；项目入口（项目简介 + wiki 地址）与设计规范指针见根目录 [`agents.md`](../agents.md)，界面设计规范正文在 [`src/renderer/agents.md`](../src/renderer/agents.md)。

---

## 四、约定与说明

- **粒度**：渲染层按「每页一篇 / `assets.md` 与 `components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇」合并；其它目录逐文件成篇。新增文档请沿用此粒度，避免知识库再次膨胀。
- **不列行数**：源码行数随改动漂移，索引不再逐条标注；需要规模时看对应文档头部的「规模」，或直接看源文件。
- **行数口径**：一律用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）。**不要**用 `(Get-Content $f).Count`（PowerShell 5.1 读 LF 行尾文件会少算），也不要用 `([regex]::Matches($text,"`n")).Count + 1`（以换行结尾的文件会多算 1）。
- **代码与文档同构**：渲染层一个页面一个目录（`pages/<PageName>/`，入口 `index.vue`），wiki 对应一篇 `pages/<PageName>.md`；改目录结构时两处一起改。
- **精确性**：文档中的频道名、导出名、字段名与源码**逐字一致**；代码变更后请同步更新对应文档（改代码前先查本索引）。
- **两类字符串不要混层**：要显示的品牌文案（应用名 / 英文名 / 口号）取 `src/shared/constants.ts`；渲染层 `localStorage` 键名取 `src/renderer/src/constants.ts`，且**故意不跟随品牌改名**（改了会丢老用户记忆，必须补迁移）。
- **注意事项是观察记录**：文档里标注的「注意事项」包含撰写时发现的实现细节（未使用的导入、不会触发的分支、命名不一致的历史遗留等），不代表需要立即修改。
- 本知识库不替代 `README.md`（面向使用者）与 `REFACTOR_PLAN.md`（重构历史），三者互补。

---

## 五、快速定位

| 我想… | 看这里 |
|---|---|
| 知道某个 IPC 频道是谁实现的 | [01-架构总览 §3.3](./01-架构总览.md) → 落到 [02-目录架构-src-main](./02-目录架构-src-main.md) |
| 加一个新的跨进程接口 | [05-目录架构-src-shared §6](./05-目录架构-src-shared.md)（三处齐改清单） |
| 改应用名 / 英文名 / 口号 | [shared/constants.ts.md](./files/shared/constants.ts.md)（唯一来源 + 改品牌名完整清单） |
| 发新版本 / 排查「检查更新失败」 | [main/updater.ts.md](./files/main/updater.ts.md)（发版三件套与更新源） |
| 搞清楚「项目」在磁盘上长什么样 | [00-项目结构 §7](./00-项目结构.md) + [main/projects.ts.md](./files/main/projects.ts.md) |
| 明白 HTML 是怎么被 Agent 生成的 | [01-架构总览 §5.1](./01-架构总览.md) + [main/htmlAgent.ts.md](./files/main/htmlAgent.ts.md) |
| 查 whisper 模型档位与转录流程 | [main/whisper.ts.md](./files/main/whisper.ts.md) |
| 搞清 716MB 运行环境包怎么准备 / 解包 | [main/runtime.ts.md](./files/main/runtime.ts.md) + [01-架构总览 §3.3](./01-架构总览.md)（`runtime:*`） |
| 查旧数据弹窗 / `legacy:*` 契约 | [main/index.ts.md](./files/main/index.ts.md) §3.1 + [renderer/src/components.md](./files/renderer/src/components.md) §6 |
| 改界面 / 加页面 | [04-目录架构-src-renderer](./04-目录架构-src-renderer.md) → 对应页面文档（§3.3） |
| 找全局状态 / 提示 / 进度 / 渲染档位 / 语速 / 注册表 | [renderer/src/common.md](./files/renderer/src/common.md) |
| 查 localStorage 键名 / 为什么不能跟品牌改名 | [renderer/src/constants.ts.md](./files/renderer/src/constants.ts.md) |
| 看设计系统有哪些 CSS 变量与类 | [renderer/src/assets.md](./files/renderer/src/assets.md) |
| 改配色 / 字体 / 组件风格 | [界面设计规范](../src/renderer/agents.md) |
