# ShadowMill 项目 Wiki

> 本目录是对本仓库（Electron + Vue 3 + electron-vite + TypeScript 的桌面应用「影坊 / ShadowMill」）的**源码知识库**：先给工程结构与目录架构，再给各文件/各页面的说明。
>
> 文档全部由阅读真实源码生成，未改动 `src/` 下任何代码。

---

## 一、阅读顺序

| # | 文档 | 内容 | 适合谁 |
|---|---|---|---|
| 0 | [00-项目结构](./00-项目结构.md) | 技术栈与版本、仓库顶层结构（含 `scripts/demo-vidrender.cjs`、`resources/bin/`、`test/fixtures/vidrender/`）、`src/` 完整目录树、构建与打包、运行时数据目录（**ffmpeg / hyperframes / vidrender 三包 + whisper 随包**）、全局约定 | 第一次接触项目的人 |
| 1 | [01-架构总览](./01-架构总览.md) | 进程模型、启动时序、**IPC 契约全貌（111 个频道总表 + 账号 / 可选登录）**、以「项目」为中心的数据流、关键业务链路（含内容脚本 Agent、对话记录与账号）、主进程依赖图、安全边界 | 想理解整体设计的人 |
| 2 | [02-目录架构-src-main](./02-目录架构-src-main.md) | 主进程（**59** 个 `.ts` 源文件 = 根目录 9 个单文件 + `account/` 目录 **3** 个文件 + `cast/` 目录 **9** 个文件 + `voice/` 目录 10 个文件 + `projects/` 目录 **16** 个文件 + `agent/` 目录 **8** 个文件 + `updater/` 目录 4 个文件）的职责、装配模式 `register(ctx)`、模块依赖图、各域要点 | 改主进程 / 加 IPC |
| 3 | [03-目录架构-src-preload](./03-目录架构-src-preload.md) | 桥接层：**14** 个命名空间、7 路进度通道的转发（`project:html-progress` **一条频道 + 按任务 id 分发**，`projectTools.onTaskProgress` 与 `castTools.onTaskProgress` **共用同一张订阅表**；其余 5 路单槽，`video:progress` 无包装）、类型来源与 CJS 约束 | 改接口 / 排查跨进程调用 |
| 4 | [04-目录架构-src-renderer](./04-目录架构-src-renderer.md) | Vue 渲染层：启动链路（含登录态 `restore()`）、无 router 的注册表导航、状态与通信约定、组件分层、页面↔主进程域对照、样式策略 | 改界面 / 加页面 |
| 5 | [05-目录架构-src-shared](./05-目录架构-src-shared.md) | 频道常量（**13 组 111 个**）、跨进程载荷类型（含**账号契约**）、**错误文案映射（`errors.ts`）**、**应用级常量（品牌文案 / 画布 / 估时 / 动作参数表）**、消费方与编译期归属、维护约定 | 动契约前必读 |
| 6 | [06-目录架构-src-agent](./06-目录架构-src-agent.md) | 独立实验脚本：为什么不进构建图、5 个工具、工作区防护、运行方式 | 想跑 Agent 样例 |
| 7 | [files/](./files/) | **说明文档**（按下方 3.x 的粒度组织，`files/` 下共 **46** 篇；其中 `renderer/src/components.md` 一篇覆盖 `components/` 下的通用组件与样式宿主，`main/updater.md` 一篇覆盖 `src/main/updater/` 下的 `index.ts` / `base.ts` / `actions.ts` / `install.ts` 四个文件，`main/agent.md` 一篇覆盖 `src/main/agent/` 下的文件，`main/projects.md` 一篇覆盖 `src/main/projects/` 下的文件，`main/cast.md` 一篇覆盖 `src/main/cast/` 下的九个文件，`main/voice.md` 一篇覆盖 `src/main/voice/` 下的十个文件，**`main/account.md` 一篇覆盖 `src/main/account/` 下的 `api.ts` / `store.ts` / `index.ts` 三个文件**） | 需要具体实现细节时查阅 |

---

## 二、项目一句话

五节点音视频创作流水线：**音色管理 → 文字生音频 → 文字转字幕 → 字幕生成 HTML（含转视频）→ 视频预览**，以「项目」为粒度组织产物；语音识别（whisper.cpp）与视频渲染（HyperFrames + FFmpeg）均在本机完成，HTML 动画与**内容脚本（场景分镜）**都由用户自配置的 OpenAI 兼容模型 Agent 生成 / 修改（前者流式产出 HTML，后者对话式产出结构化场景 JSON）。**账号是可选的外围能力**：未登录时全部本机功能照常可用，登录后可服务云端能力（令牌只存主进程的 `safeStorage`）。

---

## 三、说明文档索引

> **粒度约定**（与根目录 `AGENTS.md` 的规则 6 一致）：渲染层按「**每页一篇**（该页面自己的子组件与助手并入同一篇；代码侧对应 `src/renderer/src/pages/<PageName>/` 一页一目录、入口 `index.vue`）、**`assets.md` / `components.md` 目录级各一篇**、**`common.md` 公共方法与工具一篇**」组织；主进程、preload、shared、agent 与工程根配置按源文件逐篇——**例外**是主进程里按「同名目录 + `index.ts` 统一出口」拆成的模块，各按**目录级一篇**说明：`src/main/updater/`（4 个文件：`index.ts` / `base.ts` / `actions.ts` / `install.ts`）→ [main/updater.md](./files/main/updater.md)（旧名 [main/updater.ts.md](./files/main/updater.ts.md) 只留过渡指针）、`src/main/agent/`（**8** 个文件：`chat.ts` / `chatLog.ts` / `html.ts` / `constants.ts` / `htmlEdit.ts` / `script.ts` / `castAction.ts` / `index.ts`）→ [main/agent.md](./files/main/agent.md)、`src/main/projects/`（**16** 个文件：`index.ts` / `paths.ts` / `store.ts` / `materials.ts` / `prompts.ts` / `bgm.ts` / `previewScript.ts` / `progress.ts` / `htmlWrite.ts` / `chaptersFlow.ts` / `register.ts` + `ipc/{project,html,media,cast,castActions}.ts`）→ [main/projects.md](./files/main/projects.md)、`src/main/cast/`（**9** 个文件：`index.ts` / `table.ts` / `edit.ts` / `inject.ts` / `library.ts` / `preview.ts` / `presets.ts` / `actions.ts` / `demo.ts`）→ [main/cast.md](./files/main/cast.md)、`src/main/voice/`（10 个文件：`catalog.ts` / `systemVoices.ts` / `api.ts` / `cloneAudio.ts` / `vad.ts` / `ttsAlign.ts` / `ipc/{voices,tts}.ts` / `register.ts` / `index.ts`）→ [main/voice.md](./files/main/voice.md)、**`src/main/account/`（3 个文件：`api.ts` / `store.ts` / `index.ts`）→ [main/account.md](./files/main/account.md)**。

### 3.1 `src/main/`（主进程，16 篇：9 个顶层单文件各一篇 + `account/` / `cast/` / `voice/` / `projects/` / `agent/` / `updater/` 六个目录各一篇 + 旧名过渡指针一篇）

| 源文件 | 说明文档 |
|---|---|
| `src/main/index.ts` | [main/index.ts.md](./files/main/index.ts.md) |
| `src/main/hfEnv.ts` | [main/hfEnv.ts.md](./files/main/hfEnv.ts.md) |
| `src/main/settings.ts` | [main/settings.ts.md](./files/main/settings.ts.md) |
| **`src/main/account/`（`api.ts` 221 行 / `store.ts` 96 行 / `index.ts` 76 行，目录级一篇：账号后端 HTTP 客户端 + 令牌 safeStorage 持久化 + 5 条 `account:*` 频道）** | **[main/account.md](./files/main/account.md)** |
| `src/main/agent/`（`index.ts` 21 行 / `chat.ts` 265 行 / `chatLog.ts` 155 行 / `html.ts` 229 行 / `constants.ts` 368 行 / `htmlEdit.ts` 52 行 / `script.ts` 342 行 / `castAction.ts` 44 行，目录级一篇） | [main/agent.md](./files/main/agent.md) |
| `src/main/projects/`（16 个文件，目录级一篇：项目生命周期 + 素材库 + HTML 生成 / 修改 + 角色库与动作示范的 IPC） | [main/projects.md](./files/main/projects.md) |
| `src/main/chapters.ts`（章节化长片的纯逻辑：解析 / 校验 / 读写 `pages/cNN.js` / 装配骨架 / 导出内联） | [main/chapters.ts.md](./files/main/chapters.ts.md) |
| `src/main/cast/`（**目录级一篇，9 个文件**：全局角色库、角色表 / 注入 / 预览、内置动作、动作库、会动的示范页） | [main/cast.md](./files/main/cast.md) |
| `src/main/editRoute.ts`（**「按需求修改」第一段的纯逻辑：解析改稿路由回复、白名单过滤、失败回退**） | [main/editRoute.ts.md](./files/main/editRoute.ts.md) |
| `src/main/coreLib.ts`（**共享绘制助手 `core.js` 的版本同步：读 `CORE_VERSION` / 按版本覆盖进项目 / 导出内联**） | [main/coreLib.ts.md](./files/main/coreLib.ts.md) |
| `src/main/voice/`（**目录级一篇，10 个文件**：按厂家的音色目录与内置系统音色表、接口层、克隆参考音频裁剪、能量 VAD、字幕逐句对齐） | [main/voice.md](./files/main/voice.md) |
| `src/main/video.ts` | [main/video.ts.md](./files/main/video.ts.md) |
| `src/main/whisper.ts` | [main/whisper.ts.md](./files/main/whisper.ts.md) |
| `src/main/updater/`（`index.ts` / `base.ts` / `actions.ts` / `install.ts` 四个文件，目录级一篇） | [main/updater.md](./files/main/updater.md) |
| `src/main/runtime.ts`（运行环境三包：`ffmpeg` / `hyperframes` / `vidrender`，后者仅 demo 显式下载、不进产品默认缺包提示） | [main/runtime.ts.md](./files/main/runtime.ts.md) |

### 3.2 `src/preload/` 与 `src/shared/`（6 篇）

| 源文件 | 说明文档 |
|---|---|
| `src/preload/index.ts` | [preload/index.ts.md](./files/preload/index.ts.md) |
| `src/preload/index.d.ts` | [preload/index.d.ts.md](./files/preload/index.d.ts.md) |
| `src/shared/ipc.ts` | [shared/ipc.ts.md](./files/shared/ipc.ts.md) |
| `src/shared/types.ts` | [shared/types.ts.md](./files/shared/types.ts.md) |
| `src/shared/errors.ts`（全应用错误文案映射：`friendlyError` / `configTargetOf` / `configTitle`） | [shared/errors.ts.md](./files/shared/errors.ts.md) |
| `src/shared/constants.ts`（应用级公共常量：品牌文案、请求标识、成片画布尺寸、素材规则、估时语速、动作参数表） | [shared/constants.ts.md](./files/shared/constants.ts.md) |

### 3.3 `src/renderer/`（渲染层，17 篇）

| 覆盖的文件 | 说明文档 |
|---|---|
| `index.html` | [renderer/index.html.md](./files/renderer/index.html.md) |
| `src/main.ts` | [renderer/src/main.ts.md](./files/renderer/src/main.ts.md) |
| `src/env.d.ts` | [renderer/src/env.d.ts.md](./files/renderer/src/env.d.ts.md) |
| `src/constants.ts`（渲染层公共常量：`localStorage` 键名——含**登录态 `STORAGE_KEY_AUTH`（只存展示字段、不含令牌）** + 服务商预设表 `MODEL_PROVIDERS`） | [renderer/src/constants.ts.md](./files/renderer/src/constants.ts.md) |
| `src/App.vue`（外壳；含 `<UserArea />` / `<SettingsDialog />` / `<AuthDialog />` 与 `onMounted` 的 `restore()`） | [renderer/src/App.vue.md](./files/renderer/src/App.vue.md) |
| `src/assets/`（设计系统：`main.css`，含账号弹窗的 `.auth-*`） | [renderer/src/assets.md](./files/renderer/src/assets.md) |
| `src/components/`（通用组件：`StepBar.vue`、`NewProjectDialog.vue`、`HfSelect.vue`、`CastShot.vue`、`LegacyDataDialog.vue`、**`SettingsDialog.vue`（设置弹窗外壳）**、**`UserArea.vue`（左下角用户区）**、**`AuthDialog.vue`（登录 / 注册弹窗）**） | [renderer/src/components.md](./files/renderer/src/components.md) |
| **公共方法与工具**：`src/composables/{useAppStore,useToast,useRenderProgress,useRuntime,useEnvGate,useConfigPrompt,useLegacyData,useNavIntent,useRenderOptions,useProjectMeta,useSettingsDialog,useAuth,useAuthDialog}.ts`、`src/utils/{escape,rate,time,render,url,changelog,taskId,localAccount}.ts`、`src/pages/index.ts` | [renderer/src/common.md](./files/renderer/src/common.md) |
| `src/pages/HomePage/index.vue` | [renderer/src/pages/HomePage.md](./files/renderer/src/pages/HomePage.md) |
| `src/pages/AboutPage/index.vue` | [renderer/src/pages/AboutPage.md](./files/renderer/src/pages/AboutPage.md) |
| `src/pages/ContentPage/`（入口 `index.vue` + `SceneEditor.vue` / `AiChatPanel.vue` / `CastPickerModal.vue` / `ScriptRoundCard.vue` / `helpers.ts` / `castPick.ts`；两个 Tab：场景编辑（编辑即自动保存）/ AI 创作（对话记录按项目持久化）） | [renderer/src/pages/ContentPage.md](./files/renderer/src/pages/ContentPage.md) |
| `src/pages/TextTtsPage/`（入口 `index.vue` + `SynthSection.vue` / `AlignSection.vue` / `VoiceSection.vue` / `helpers.ts`） | [renderer/src/pages/TextTtsPage.md](./files/renderer/src/pages/TextTtsPage.md) |
| `src/pages/SubtitlePage/`（入口 `index.vue` + `TranscribeSection.vue` / `helpers.ts`） | [renderer/src/pages/SubtitlePage.md](./files/renderer/src/pages/SubtitlePage.md) |
| `src/pages/HtmlGenPage/`（入口 `index.vue` + `CastSection.vue`（只勾选本片用哪几个角色）/ `MaterialsSection.vue` / `ChapterSection.vue` / `PreviewSection.vue`；角色库的两个弹窗已删除，新建与修改搬到「角色」页） | [renderer/src/pages/HtmlGenPage.md](./files/renderer/src/pages/HtmlGenPage.md) |
| `src/pages/CastPage/`（入口 `index.vue` + `CastEditModal.vue`（新建 / 修改同一个弹窗）/ `CastActionModal.vue`（动作示范）/ `CastActionEditor.vue`（关键帧表）/ `CastDemoShot.vue`（会动的 iframe）；侧栏「角色」= 全局角色库，与项目无关） | [renderer/src/pages/CastPage.md](./files/renderer/src/pages/CastPage.md) |
| `src/pages/SettingsPage/`（入口 `index.vue` + `types.ts` / `constants.ts` / `helpers.ts` + `components/` 下的 6 个区块组件；**页面本身由 `components/SettingsDialog.vue` 以模态弹窗承载**） | [renderer/src/pages/SettingsPage.md](./files/renderer/src/pages/SettingsPage.md) |

> 页面按「**一个页面一个文件夹**」组织，入口统一为 `index.vue`，该页面自己的子组件与助手并入同一篇说明文档；`src/renderer/src/pages/index.ts` 是**页面注册表**，不随页面目录拆分，归属上面的「**公共方法与工具**」一篇（[`common.md`](./files/renderer/src/common.md)）。
>
> `src/renderer/agents.md` 是**界面设计规范正文**（科技主题 / Cyber UI），属于规范文档而非源码说明，故不另建说明文档；根目录 [`agents.md`](../agents.md) 是指向它的项目入口。

### 3.4 `src/agent/`（独立实验脚本，2 篇）

| 源文件 | 说明文档 |
|---|---|
| `src/agent/index.ts` | [agent/index.ts.md](./files/agent/index.ts.md) |
| `src/agent/package.json` | [agent/package.json.md](./files/agent/package.json.md) |

### 3.5 工程根配置（5 篇）

| 文件 | 说明文档 |
|---|---|
| `package.json` | [root/package.json.md](./files/root/package.json.md) |
| `CHANGELOG.md` | [root/changelog.md](./files/root/changelog.md) |
| `electron.vite.config.ts` | [root/electron.vite.config.ts.md](./files/root/electron.vite.config.ts.md) |
| `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` / `tsconfig.agent.json` | [root/tsconfig.md](./files/root/tsconfig.md) |
| `.gitignore` | [root/gitignore.md](./files/root/gitignore.md) |

> **工程脚本与测试素材的归属**：本知识库没有 `files/scripts/`、`files/test/` 目录；根目录 `scripts/`（`pack-runtime.mjs` 运行环境打包 / `release.mjs` 发版 / **`demo-vidrender.cjs` 小内核联调**）与 `test/fixtures/vidrender/`（`index.html` + `clip.mp4`，只服务 demo）不在逐文件说明范围内。打包脚本与 `extraResources` 见 [00-项目结构 §5 / §6](./00-项目结构.md) 与 [root/package.json.md](./files/root/package.json.md)，三包语义见 [main/runtime.ts.md](./files/main/runtime.ts.md)，demo / fixture 的来龙去脉记在根目录 [`../CHANGELOG.md`](../CHANGELOG.md) 的 **#119 / #120**。
>
> `CHANGELOG.md` 是**唯一**的变更记录（更新日志 = 修改日志 = 版本记录，同一份文件），写入规则见根目录 [`agents.md`](../agents.md) 第三节与关键约定的第 3、4 条；`README.md`、`REFACTOR_PLAN.md` 属于项目级说明文档，其内容不再二次转述，直接阅读原文件即可；项目入口（项目简介 + wiki 地址）与设计规范指针见根目录 [`agents.md`](../agents.md)，界面设计规范正文在 [`src/renderer/agents.md`](../src/renderer/agents.md)。

---

## 四、约定与说明

- **粒度**：渲染层按「每页一篇 / `assets.md` 与 `components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇」合并；其它目录逐文件成篇（**例外**：主进程的 `account/`、`cast/`、`voice/`、`updater/`、`agent/`、`projects/` 都是「一个模块拆成同名目录的多文件」，各按目录级一篇——[main/account.md](./files/main/account.md)（3 个文件）、[main/cast.md](./files/main/cast.md)（9 个文件）、[main/voice.md](./files/main/voice.md)（10 个文件）、[main/updater.md](./files/main/updater.md)（旧名 [main/updater.ts.md](./files/main/updater.ts.md) 保留为过渡指针）、[main/agent.md](./files/main/agent.md)（8 个文件）、[main/projects.md](./files/main/projects.md)（16 个文件））。新增文档请沿用此粒度（单文件一篇 / 同名目录模块一篇），避免知识库再次膨胀。
- **不列行数**：源码行数随改动漂移，索引不再逐条标注；需要规模时看对应文档头部的「规模」，或直接看源文件。
- **行数口径**：一律用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）。**不要**用 `(Get-Content $f).Count`（PowerShell 5.1 读 LF 行尾文件会少算），也不要用 `([regex]::Matches($text,"`n")).Count + 1`（以换行结尾的文件会多算 1）。
- **代码与文档同构**：渲染层一个页面一个目录（`pages/<PageName>/`，入口 `index.vue`），wiki 对应一篇 `pages/<PageName>.md`；改目录结构时两处一起改。
- **精确性**：文档中的频道名、导出名、字段名与源码**逐字一致**；代码变更后请同步更新对应文档（改代码前先查本索引）。
- **更新日志必走一遍**：改任何代码前先看根目录 [`CHANGELOG.md`](../CHANGELOG.md) 的**当前版本区块**（这一版已经改了什么），改完必须在该区块**追加或更新一条**记录（影响范围 + 验证方式）；同一功能在本版内改到第 2 次的，在**最新那一条**标 `[完整版]`。细则见根目录 [`agents.md`](../agents.md) 第三节与关键约定 3、4。
- **两类字符串不要混层**：要显示的品牌文案（应用名 / 英文名 / 口号）取 `src/shared/constants.ts`；渲染层 `localStorage` 键名取 `src/renderer/src/constants.ts`，且**故意不跟随品牌改名**（改了会丢老用户记忆，必须补迁移）。
- **错误文案只有一处映射表**：外部服务与本机文件系统报错的「英文原文 → 人话」一律走 `src/shared/errors.ts` 的 `friendlyError()`，不要在模块里另写正则链；配置类错误的分类（`needConfig`）由主进程单点判定、渲染层只消费（见 [shared/errors.ts.md](./files/shared/errors.ts.md)）。**账号是例外**：它用后端业务码同名的 `AccountErrorCode`（14 个），文案由 `src/main/account/api.ts` 的 `FALLBACK_MESSAGE` 兜底。
- **账号三条不变量**：未登录可用 / 令牌不出主进程 / 断网保留登录态——见 [01-架构总览 §3.5](./01-架构总览.md) 与 [main/account.md](./files/main/account.md)。
- **注意事项是观察记录**：文档里标注的「注意事项」包含撰写时发现的实现细节（未使用的导入、不会触发的分支、命名不一致的历史遗留等），不代表需要立即修改。
- 本知识库不替代 `README.md`（面向使用者）与 `REFACTOR_PLAN.md`（重构历史），三者互补。

---

## 五、快速定位

| 我想… | 看这里 |
|---|---|
| 知道某个 IPC 频道是谁实现的 | [01-架构总览 §3.3](./01-架构总览.md) → 落到 [02-目录架构-src-main](./02-目录架构-src-main.md) |
| 加一个新的跨进程接口 | [05-目录架构-src-shared §6](./05-目录架构-src-shared.md)（三处齐改清单） |
| **搞懂登录 / 令牌存在哪 / 为什么不能放渲染层** | [01-架构总览 §3.5](./01-架构总览.md) + [main/account.md](./files/main/account.md)（HTTP / safeStorage / 5 条频道）+ [common.md](./files/renderer/src/common.md)（`useAuth` / `localAccount`）+ [components.md](./files/renderer/src/components.md)（`AuthDialog` / `UserArea`）+ `docs/account-integration.md` |
| 改应用名 / 英文名 / 口号 | [shared/constants.ts.md](./files/shared/constants.ts.md)（唯一来源 + 改品牌名完整清单） |
| 查「英文报错怎么变成人话」/ 为什么这个错误会弹「去设置」 | [shared/errors.ts.md](./files/shared/errors.ts.md)（十档映射 + `needConfig` 分类）+ [renderer/src/common.md](./files/renderer/src/common.md)（`useConfigPrompt`） |
| 发新版本 / 排查「检查更新失败」 | [main/updater.md](./files/main/updater.md)（发版上传清单：安装包 + `.blockmap` + `latest.yml` + 两个运行环境包，以及 `npm run release` 自检） |
| 某个版本改了什么 / 记一次修改 | [root/changelog.md](./files/root/changelog.md) + 根目录 [`../CHANGELOG.md`](../CHANGELOG.md) |
| 搞清楚「项目」在磁盘上长什么样 | [00-项目结构 §7](./00-项目结构.md) + [main/projects.md](./files/main/projects.md)（`store.ts` / `paths.ts` / `index.ts` 顶部） |
| 明白 HTML 是怎么被 Agent 生成的 | [01-架构总览 §5.1](./01-架构总览.md) + [main/agent.md](./files/main/agent.md)（`html.ts` 薄封装 + `chat.ts` 传输层） |
| 明白「章节模式 / 角色」是怎么落盘的 | [main/chapters.ts.md](./files/main/chapters.ts.md)（章节 + 骨架）+ [main/cast.md](./files/main/cast.md)（全局角色库与项目副本同步）+ [main/projects.md](./files/main/projects.md)（`store.ts` 的 cast 补全）+ [main/agent.md](./files/main/agent.md)（提示词） |
| 明白「角色预览」是怎么画出来的 | [main/cast.md](./files/main/cast.md)（`preview.ts`）+ [renderer/src/components.md](./files/renderer/src/components.md)（`CastShot` 契约）+ [renderer/src/pages/CastPage.md](./files/renderer/src/pages/CastPage.md) |
| 明白「角色动作示范」是怎么动起来的 / 动作存在哪 | [main/cast.md](./files/main/cast.md)（`presets.ts` 内置 14 条 + `actions.ts` 动作库 + `demo.ts` 示范页）+ [renderer/src/pages/CastPage.md](./files/renderer/src/pages/CastPage.md) |
| 明白「按需求修改」为什么先路由再发源码 | [main/editRoute.ts.md](./files/main/editRoute.ts.md) + [main/projects.md](./files/main/projects.md)（`chaptersFlow.ts` 的 `applyChapterEdit`） |
| 明白「进度怎么按 `taskId` 分给谁」 | [03-目录架构-src-preload §4](./03-目录架构-src-preload.md)（`onTaskProgress` + `Map` 分发）+ [files/preload/index.ts.md](./files/preload/index.ts.md) §3.2 + [renderer/src/common.md](./files/renderer/src/common.md) §10.1.2（`newTaskId`） |
| 明白「AI 创作」怎么改内容脚本 / 对话记录存在哪 | [01-架构总览 §5.5](./01-架构总览.md) + [main/agent.md](./files/main/agent.md)（`script.ts` + `chatLog.ts`）+ [renderer/src/pages/ContentPage.md](./files/renderer/src/pages/ContentPage.md) |
| 查 whisper 模型档位与转录流程 | [main/whisper.ts.md](./files/main/whisper.ts.md) |
| 搞清 ffmpeg / hyperframes / vidrender 三包怎么按需下载与解包（vidrender 仅 demo 显式下载，不进产品默认缺包提示） | [main/runtime.ts.md](./files/main/runtime.ts.md) + [01-架构总览 §3.3](./01-架构总览.md)（`runtime:*`） |
| 跑 / 改小内核联调 demo 与它的测试合成 | [00-项目结构 §5](./00-项目结构.md)（`demo:vidrender`）与根目录 [`../CHANGELOG.md`](../CHANGELOG.md) #119；脚本本体 `scripts/demo-vidrender.cjs`、素材 `test/fixtures/vidrender/`、二进制 `resources/bin/vidrender-encode.exe`（均不建独立 wiki 篇） |
| 搞清「缺运行环境」时界面怎么问用户 / 怎么续做 | [renderer/src/common.md](./files/renderer/src/common.md) §4（`useRuntime` / `useEnvGate`） |
| 查旧数据弹窗 / `legacy:*` 契约 | [main/index.ts.md](./files/main/index.ts.md) §3.1 + [renderer/src/components.md](./files/renderer/src/components.md) §6 |
| 改界面 / 加页面 | [04-目录架构-src-renderer](./04-目录架构-src-renderer.md) → 对应页面文档（§3.3） |
| 找全局状态 / 提示 / 进度 / 渲染档位 / 语速 / 注册表 / 登录态 | [renderer/src/common.md](./files/renderer/src/common.md) |
| 查 localStorage 键名 / 为什么不能跟品牌改名 | [renderer/src/constants.ts.md](./files/renderer/src/constants.ts.md) |
| 看设计系统有哪些 CSS 变量与类 | [renderer/src/assets.md](./files/renderer/src/assets.md) |
| 改配色 / 字体 / 组件风格 | [界面设计规范](../src/renderer/agents.md) |
