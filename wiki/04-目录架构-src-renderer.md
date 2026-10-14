# 04 · 目录架构：`src/renderer/`（渲染层）

> Vue 3 + TypeScript 的界面层，共 39 个文件（`index.html` 1 + 设计规范 `agents.md` 1 + `src/` 下 37：外壳 `App.vue` 1 + 入口 `main.ts` / `env.d.ts` 2 + **渲染层常量 1** + 样式 1 + 通用组件 4（`StepBar.vue` / `NewProjectDialog.vue` / `HfSelect.vue` / `LegacyDataDialog.vue`） + composables 8 + utils 4 + 页面 16（一页一目录，入口统一 `index.vue`，含注册表 `pages/index.ts`））。刻意**不引入** vue-router 与 pinia：导航是一个注册表 + `goPage()` 函数，全局状态是模块级 `reactive` 单例。所有系统能力都经 `window.*`（preload 桥）访问。

---

## 1. 文件清单

```
src/renderer/
├─ index.html                    # 103 行  HTML 宿主：#app + 启动画面（内联样式，不等 JS）+ CSP meta + 模块入口；品牌文案用 %APP_*% 占位、构建期注入
├─ agents.md                     # 174 行   科技主题（Cyber UI / 深空科技）设计规范正文（自 pages/ 上提到 renderer/ 层）
└─ src/
   ├─ main.ts                    #  15 行   createApp + 挂载 + 导入全局 CSS + 启动画面淡出移除
   ├─ App.vue                    # 301 行   外壳：标题栏（文案取 @shared/constants 的 APP_NAME）+ 运行环境横幅（下载中 / 缺包 / 失败三态）+ 运行环境确认框（内联 `.hf-modal`）+ 侧栏菜单 + 页面容器 + 旧数据弹窗宿主 + Toast + 启动流程（initRenderProgress → initRuntime → initEnvGate → initLegacyData → initApp）
   ├─ env.d.ts                   #   8 行   .vue 等模块类型补丁
   ├─ constants.ts               #  59 行   渲染层公共常量：localStorage 键名前缀 + 两个持久化键（不跟随品牌名，改前缀必须补迁移）
   ├─ assets/
   │  └─ main.css                # 全局设计系统（深空科技主题，行数随迭代增长）
   ├─ components/
   │  ├─ StepBar.vue             #  90 行   五节点链路状态条 + 工作项目切换器（新建入口改为弹窗）
   │  ├─ NewProjectDialog.vue    #  83 行   新建项目弹窗（创建 + 刷新 + 切换，成功后 emit created）
   │  ├─ HfSelect.vue            # 382 行   全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 select
   │  └─ LegacyDataDialog.vue    # 102 行   「发现旧版本数据」应用内弹窗（迁移 / 删除 / 稍后；无 props / emits，状态取自 useLegacyData）
   ├─ composables/
   │  ├─ useAppStore.ts          # 107 行   全局项目状态单例（appState / has* / refreshProject；含项目级渲染档位覆盖）；上下文键取 @renderer/constants
   │  ├─ useToast.ts             #  22 行   轻提示
   │  ├─ useRenderProgress.ts    #  92 行   HyperFrames 渲染进度解析（长阶段中文名 + 内部微阶段不上屏）
   │  ├─ useRuntime.ts           #  70 行   运行环境（分包）状态单例（runtime:progress 订阅 + runtime:status 首帧补齐；busy / failed / missing / hasMissing / ready / cancelable / missingText + prepare(packs?) / cancel()）
   │  ├─ useEnvGate.ts           # 158 行   「需要下载运行环境」确认框单例（guard → confirmDownload / cancelDownload / continueAction；三态 confirm / downloading / ready，装好后按钮变「继续」、**不自动续做**；进度经 `watch(useRuntime().runtime)` 消费，全渲染层只有 useRuntime.ts 一处 onProgress 注册）
   │  ├─ useLegacyData.ts        #  60 行   旧数据提示单例（legacy:status 问一次 → 弹窗；resolve(action) 回传 legacy:resolve，条目名转中文）
   │  ├─ useNavIntent.ts         #  31 行   跨页「导航意图」信号单例（requestSettingsSection / consumeSettingsSection；设置页 5 个分类枚举的唯一来源 SETTINGS_SECTIONS）
   │  └─ useRenderOptions.ts     #  41 行   渲染档位：全局默认载入 / 生效档位 / 项目级覆盖写入
   ├─ utils/
   │  ├─ escape.ts               #   4 行   escTxt 文本转义
   │  ├─ rate.ts                 #  21 行   语速控件（0.5~2.0）
   │  ├─ time.ts                 #  15 行   fmtTime / fmtTimeMs
   │  └─ render.ts               #  55 行   渲染档位选项表与纯函数（pickRenderOverride / resolveRenderOptions …）
   └─ pages/                     # 一个页面一个文件夹，入口统一 index.vue
      ├─ index.ts                #  51 行   页面注册表 + goPage 路由（刷新失败照切页 + toast；归属「公共方法与工具」一篇）
      ├─ HomePage/
      │  └─ index.vue            #  86 行   首页（hero 角标与主标题均取 @shared/constants + 参数行 + 流水线 + 我的项目卡片）
      ├─ AboutPage/
      │  └─ index.vue            #  18 行   关于（静态）
      ├─ ContentPage/
      │  └─ index.vue            # 106 行   内容脚本
      ├─ TextTtsPage/
      │  ├─ index.vue            #  37 行   配音页外壳（三个 Tab：文字生音频 / 字幕配音 / 音色管理；**Tab 值用 helpers 的 `activeTtsTab`**，切 Tab 只有本页按钮一个入口）
      │  ├─ SynthSection.vue     # 373 行   文字生音频卡（音色/模型下拉受「Key 已配置」门控；**切回本 Tab 自动重拉音色**）
      │  ├─ AlignSection.vue     # 328 行   字幕配音（逐句对齐）卡（音色同样门控 + 未就绪时的「API Key 设置」按钮；切回本 Tab 自动重拉音色；**缺 ffmpeg 运行环境包时经 `useEnvGate` 弹确认框**，`startAlign(skipEnvGuard)`）
      │  ├─ VoiceSection.vue     # 520 行   音色管理卡组（创建克隆音色弹窗——Qwen-Audio-TTS 系列的本地文件 / 公网 URL **二选一、填了 URL 以 URL 为准**，提交名**统一 10 位**（模块级 `CLONE_PREFIX_MAX`，原 10 / 16 分流已删）；弹窗说明只剩 `qwen-audio-3.0-tts-flash` 一条并提醒审核期间合成会失败；我的音色列表（**4 列、不显示音色 ID、行尾「删云端」动作**，**审核状态非 OK 时在第 3 列追加「（审核中 / 审核未通过）」**）/ 音色映射（**系统音色的合成模型固定不可改**）；**模型下拉按厂家分组**；创建弹窗的模型受 Key 门控；卡内 `requireCfg` 走 helpers 的 `readActiveCfg`；**切回本 Tab 自动重拉列表**；原独立页 SoundCopyPage 并入本 Tab）
      │  └─ helpers.ts           # 177 行   配音助手（**三卡共用的 `activeTtsTab`**、**配置形状的唯一读取入口 `readActiveCfg`**、**Key 就绪状态** `voiceKeyReady` / `activeProviderLabel` / `refreshVoiceKeyState`、音色载入/分组；切 Tab 信号已删除）
      ├─ SubtitlePage/
      │  ├─ index.vue            # 253 行   字幕条目编辑
      │  ├─ TranscribeSection.vue# 365 行   转录弹窗（**缺 ffmpeg 运行环境包时经 `useEnvGate` 弹确认框**，`doTranscribe(skipEnvGuard)`）
      │  └─ helpers.ts           # 165 行   字幕助手（估时、条目类型等）
      ├─ HtmlGenPage/
      │  └─ index.vue            # 741 行   HTML 生成 / 修改（「生成 HTML」与「按需求修改」两个并列按钮，**每个动作按钮内部各带一个 `?`**（悬浮只显示该动作自己的说明；动作行末尾不再有独立 `?`）；生成点一次即执行、无二次确认，按需求修改在无 HTML 时禁用；字幕 / 视频素材选配：视频只有一个入口，可选项目现有素材或当场导入）+ 背景音频选定 + 预览 + 转视频（含渲染档位；**转视频 / 提取视频原声缺包时经 `useEnvGate` 弹确认框**，`onRenderVideo(skipEnvGuard)` / `onExtractAudio(skipEnvGuard)`）
      ├─ VideoPreviewPage/
      │  └─ index.vue            #  88 行   视频预览（纯预览：成品播放 / 定位；「转视频」与渲染档位在 HTML生成页）
      └─ SettingsPage/
         ├─ index.vue            # 742 行   设置（左侧分类导航：自定义模型 / **语音服务（按厂家，只有 API Key）** / 渲染默认档位 / 应用更新 / 语音识别模型；运行环境一行三态 + 「下载运行环境」「取消下载」「从本地文件安装…」；分类记忆键取 @renderer/constants，分类枚举取 @renderer/composables/useNavIntent）
         └─ WhisperSection.vue   # 274 行   语音识别模型管理区块
```

> **行数口径**：与 [README](./README.md) §4 一致，用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）；**不要**用 `(Get-Content $f).Count`（PS 5.1 读 LF 行尾会少算）或 `([regex]::Matches($text,"`n")).Count + 1`（以换行结尾会多算 1）。
>
> **文件计数**：`index.html`(1) + `agents.md`(1) + `src/` 下 37 个（`main.ts` / `App.vue` / `env.d.ts` / `constants.ts` / `assets/main.css` / `components` 4 / `composables` 8 / `utils` 4 / `pages` 16）= **39**。

---

## 2. 启动与导航

### 2.1 启动链路

```
index.html（CSP meta + <div id="app"> + <div id="boot-splash"> 启动画面；品牌文案占位符 %APP_NAME% / %APP_NAME_EN% / %APP_SLOGAN_SHORT% 由 electron.vite.config.ts 构建期注入）
  → 启动画面先上屏（纯 HTML/CSS，不等 JS）：logo + 标题 + 扫描条 + 「正在启动…」
  → main.ts：createApp(App).mount('#app') + import './assets/main.css'
     → mount 之后：#boot-splash 加 .boot-done 淡出，300ms 后 remove()
     → App.vue onMounted：
        ① window.windowControls.onMaximizedChange(v => isMaximized = v)
        ② initRenderProgress()                    # 全局订阅 video:progress（单订阅语义）
        ③ initApp()：
             localStorage[STORAGE_KEY_PROJECT_CTX]（值 'myapp.projectCtx'） → appState.currentName
             → Promise.all([refreshProject(), loadRenderDefaults()])
                                                    # 项目列表（project:list + project:load）
                                                    # + 渲染默认档位（settings.json 的 render 段）
                                                    # （首页已是初始页，不再调 goPage('home')）
```

- 当前项目上下文用 `localStorage` 持久化：键名集中在 `src/renderer/src/constants.ts` 的 `STORAGE_KEY_PROJECT_CTX`（值即 `'myapp.projectCtx'`，只存 `{ name }`；历史值里可能残留的 `builtin` 字段被忽略），prod 下 `loadFile(file://)` 同源，故重启自动延续。**前缀 `'myapp.'` 故意不跟随品牌名**——键名就是用户数据的地址，改名会丢「上次项目 / 设置页分类」记忆，要改必须补迁移。
- **品牌文案只有一处来源**：`src/shared/constants.ts`。`App.vue` 标题栏与 `HomePage` 直接 `import`；`index.html` 是静态标记、无法 `import` TS 常量，因此写 `%APP_NAME%` / `%APP_NAME_EN%` / `%APP_SLOGAN_SHORT%`，由 `electron.vite.config.ts` 的 `brandHtmlPlugin()`（`transformIndexHtml`，`order: 'pre'`）在 dev/build 期替换。
- **启动画面是首屏体验的一部分**：窗口由主进程立即显示（`backgroundColor: '#0B1220'` 与画面同色），页面首帧即可见启动画面，因此「窗口已出现 → Vue 挂载出内容」之间不再是一片空背景。详见 [index.html](./files/renderer/index.html.md) §2.2。
- 渲染进度是**全局单例**（`useRenderProgress.ts`），在 `App.vue` 只订阅一次；发起渲染的 `HtmlGenPage` 与预览侧的 `VideoPreviewPage` 挂载时都调用 `resetRenderProgress()` 复位。
- 渲染默认档位也是全局单例（`useRenderOptions.ts` 的 `renderDefaults`），由 `App.vue` 启动时与 `refreshProject()` 并行调用 `loadRenderDefaults()` 读入 `settings.json` 的 `render` 段。

### 2.2 导航（无 router）

```ts
// pages/index.ts
export const pages: Record<PageKey, Component> = { home, about, content, 'text-tts': TextTtsPage, subtitle, 'html-gen': HtmlGenPage, 'video-preview': VideoPreviewPage, settings }
export const currentPage = shallowRef<Component>(pages.home)
export const pageNavKey = ref(0)

export async function goPage(key: PageKey) {
  activeMenu.value = key
  try {
    await refreshProject()          // 刷新项目上下文（两次 IPC）
  } catch (e) {                     // 刷新失败不能拖住导航
    toast('项目信息刷新失败：' + msg)
  }
  currentPage.value = pages[key]    // 无论刷新成败都换页
  pageNavKey.value++                // 递增 key 强制重挂载
}
```

三个设计要点：

1. **`goPage` 有「先刷新项目再渲染」的副作用**：刷新失败**也照切页**，只把原因 `toast` + `console.error` 说出来（旧写法是把 `refreshProject()` 的异常抛给调用方，界面会停在「菜单亮了、页面没换」的半截状态），因此保留函数式导航而不是声明式路由。
2. **`pageNavKey` 作为 `<component :is>` 的 `key`**：Vue 复用同组件实例时不会重跑 `onMounted`，会导致「同页切换项目后页面数据/预览残留旧项目状态」。递增 key 强制重挂载，恢复「每次进入页面重新加载当前项目」的旧语义。
3. **组件对象用 `shallowRef`**：避免 Vue 深度代理组件定义。

### 2.3 页面 key 与入口

| PageKey | 组件 | 侧栏菜单 | 说明 |
|---|---|---|---|
| `home` | `HomePage/index.vue` | ✅ 首页 | 启动默认页 |
| `content` | `ContentPage/index.vue` | ✅ 内容脚本 | 流水线起点（内容源） |
| `text-tts` | `TextTtsPage/index.vue` | ✅ 配音 | 内含三个 Tab：文字生音频 / 字幕配音 / 音色管理（原独立页 `SoundCopyPage` 已并入） |
| `subtitle` | `SubtitlePage/index.vue` | ✅ 字幕生成 | 含转录弹窗子组件 |
| `html-gen` | `HtmlGenPage/index.vue` | ✅ HTML生成 | 最复杂页面；**转视频入口与渲染档位在此**；背景音频在「预览」卡片里选定（音轨由主进程写进 HTML） |
| `video-preview` | `VideoPreviewPage/index.vue` | ✅ 视频预览 | 流水线终点：纯预览页，成品播放 / 定位（渲染由 HTML生成页发起并回写 `videoPath`） |
| `about` | `AboutPage/index.vue` | ✅ 关于 | 静态页 |
| `settings` | `SettingsPage/index.vue` | ✅ 设置 | 含 WhisperSection 子组件；**应用更新入口在此**（检查 / 下载 / 重启安装 + 更新源配置） |

> 侧栏菜单项在 `App.vue` 中以 `menuItems` 数组声明（8 项），点击调用 `goPage(item.key)`；页面切换后由 `watch(currentPage)` 把 `content` 容器滚动复位。注册表 8 项与菜单 8 项**完全一致**：原 `sound-copy`（音色管理）已并入配音页 Tab 并删除页面键，`StepBar` 的「配音」节点也只需判 `isPage('text-tts')`。

---

## 3. 状态与通信约定

| 关注点 | 做法 | 位置 |
|---|---|---|
| 全局项目状态 | 模块级 `reactive` 单例 `appState`（`currentName` / `project` / `myProjects`） | `composables/useAppStore.ts` |
| 链路状态 | 5 个 `computed`：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo`，一律只看当前项目自身的产物字段；`hasHtml` 额外要求 `htmlExists && htmlPath` 同时成立 | 同上 |
| 项目切换 | `switchProject(name)`：写 `appState.currentName` → `saveProjectCtx()` → `refreshProject()` | 同上 |
| 持久化键名 | 上次项目 `STORAGE_KEY_PROJECT_CTX`、设置页分类 `STORAGE_KEY_SETTINGS_SECTION`，都由 `STORAGE_PREFIX` 派生 | `constants.ts`（见 §4） |
| 品牌文案 | 中文名 / 英文名 / 口号一律取共享层常量，页面内不再写裸字面量 | `@shared/constants`（见 [05-目录架构-src-shared §4](./05-目录架构-src-shared.md)） |
| 后端调用 | 一律 `window.<命名空间>.<方法>()`，结果按 `IpcResult`（`ok` / `message` / `canceled`）分支处理 | 各页面 |
| 进度推送 | 在 `onMounted` 调用 `onXxxProgress(cb)` 注册（preload 为单订阅，切页自动替换回调） | 各页面 / `App.vue` |
| 提示反馈 | `toast(msg)`（`useToast.ts`，2800ms 自动消失，`App.vue` 用 `TransitionGroup` 渲染） | 全局 |
| 文本输出 | 需拼接 HTML 的场景一律用 `escTxt()` 转义；其余用插值 / `textContent` | `utils/escape.ts` |
| 时间格式 | `fmtTime`（`[分:秒]`）/ `fmtTimeMs`（`[分:秒.毫秒]`），字幕与配音对齐共用 | `utils/time.ts` |
| 播放语速 | `applyRate` / `stepRate`，仅改 `playbackRate`，不动磁盘音频 | `utils/rate.ts` |
| 渲染档位 | 项目覆盖（`project.json` 的 `render`）> 全局默认（`settings.json` 的 `render`）> 内置默认（`standard` / `30`）；缺省字段逐级继承 | `composables/useRenderOptions.ts` + `utils/render.ts` |
| 运行环境状态 | 模块级 `ref` 单例 `runtime`（`RuntimeProgressPayload`，字段 `phase` / `pack` / `percent` / `packs` / `missing` / `status` / …）：`initRuntime()` 先订阅 `runtime:progress` 再查一次 `runtime:status` 补齐首帧；派生 `busy` / `failed` / `missing` / `hasMissing` / `ready` / `cancelable` / `missingText` 与 `prepare(packs?)` / `cancel()`（旧的 `retry` / `sizeText` / `stage` 已删） | `composables/useRuntime.ts`（`App.vue` 的横幅、设置页的运行环境一行） |
| 运行环境确认框 | 模块级单例（`visible` / `packs` / `title` / `phase: 'confirm' \| 'downloading' \| 'ready'` / `percent` / `readyNow` / `message` / `detail` / `onContinue`）：`guard(need, actionName, cont?)` 缺包才弹框并记下续做闭包；装好后 `continueAction()` 先关框再用原参数重发（**不自动续做**） | `composables/useEnvGate.ts` + `App.vue` 内联的 `.hf-modal` 确认框；功能页（HtmlGenPage / TranscribeSection / AlignSection）调用 |
| 旧数据提示 | 模块级单例 `info` / `visible` / `busy`：`initLegacyData()` 问一次 `legacy:status`，有结果就弹应用内弹窗；`resolve(action)` 回传 `legacy:resolve`（**无论成败都先收起弹窗**，结果由调用方 toast） | `composables/useLegacyData.ts` + `components/LegacyDataDialog.vue` |
| 跨页导航意图 | 模块级 `ref` 单例 `settingsSectionRequest`：源页 `requestSettingsSection(section)` 置位 → 目标页 `consumeSettingsSection()` 读取并复位（`onMounted` 主路径 + `watch` 兜底），用于「带着分类跳进设置页」（配音页「API Key 设置」→ 设置页「语音服务」）；设置页 5 个分类枚举的唯一来源 | `composables/useNavIntent.ts` |

---

## 4. 组件分层

| 层 | 成员 | 说明 |
|---|---|---|
| 外壳 | `App.vue` | 自绘标题栏（hidden titleBarStyle，经 `windowControls`；标题文案取 `APP_NAME`）、运行环境横幅（三态：下载中 + 取消 / 缺包 + 下载运行环境 / 失败 + 重试）、**内联的「下载运行环境」确认框**（`.hf-modal-mask` + `.hf-modal`，scoped 样式 `.env-gate-line` / `.env-gate-packs`）、侧栏菜单、`<component :is>` 页面容器、旧数据弹窗宿主（`<LegacyDataDialog />`）、Toast 宿主、启动流程（`onMounted` 依次 `initRenderProgress` → `initRuntime` → `initEnvGate` → `initLegacyData` → `initApp`） |
| 通用组件 | `components/StepBar.vue` 、`components/NewProjectDialog.vue` 、`components/HfSelect.vue` 、`components/LegacyDataDialog.vue` | `StepBar` props `page: PageKey`；第一行五节点链路（点击跳转），第二行「工作项目」下拉（只有我的项目）+ 「新建项目」（只置 `newVisible = true`，弹窗承担创建）+ 「打开目录」。`NewProjectDialog` props `{ visible: boolean }`、emits `update:visible` / `created`，内部闭环 `create → refreshProject → switchProject`。`HfSelect` 是全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 `select`。`LegacyDataDialog` **无 props / 无 emits**，显隐与文案全来自 `useLegacyData()` 单例（迁移 / 删除 / 稍后三选一，复用 `.hf-modal` 体系）。**旧版 `[data-slot]` 注入机制与 StepBar 第二行的行内输入框均已废弃**，各页面在模板顶部放 `<StepBar :page="'xxx'"/>` 即等效 |
| 页面 | `pages/<PageName>/index.vue`（8 个，一个页面一个文件夹） | 一页一目录，`onMounted` 拉取当前项目数据 |
| 页面子组件 | `SettingsPage/WhisperSection.vue`、`SubtitlePage/TranscribeSection.vue`、`TextTtsPage/SynthSection.vue`、`TextTtsPage/AlignSection.vue` | 由所属页面承载（与入口 `index.vue` 同目录）；原 `window.__settings` / `window.__sub` / ctx 共享做法改为 props / `ref` 显式调用 |
| 页面助手 | `SubtitlePage/helpers.ts`、`TextTtsPage/helpers.ts` | 模块级共享纯逻辑与类型（估时、音色分组/解析/校验），被同目录的多个组件复用 |
| 基础设施与常量 | `composables/*`（8 个）、`utils/*`、`constants.ts` | 全局状态、Toast、渲染进度、运行环境状态（`useRuntime`）与运行环境确认框（`useEnvGate`）、旧数据提示、渲染档位、语速、转义、时间；`constants.ts` 只放渲染层自己的约定（当前为 `localStorage` 键名），品牌文案在共享层 |

---

## 5. 页面 ↔ 主进程域对照

| 页面 | 主要交互 | 涉及的主进程域（preload 命名空间） |
|---|---|---|
| HomePage | 项目列表与进度标记、切换项目、跳转各节点（**新建入口已从首页移到顶部「工作项目」栏的弹窗**） | `projectTools` |
| AboutPage | 纯静态 | — |
| ContentPage | 编辑并保存内容脚本（style + scenes） | `projectTools` |
| TextTtsPage | 壳：Tab 切换三个子卡（文字生音频 / 字幕配音 / 音色管理） | — |
| ├ SynthSection | 音色/模型选择（**模型按厂家分组**）、文字合成、试听、设为背景音频、已生成音频列表 | `voiceTools`、`projectTools` |
| ├ AlignSection | 逐句对齐（模式 A/B）、进度与取消、结果写回字幕与音频 | `voiceTools`、`projectTools` |
| └ VoiceSection | 创建克隆音色（`Teleport` 弹窗）、云端/系统音色列表（**按厂家**）、本地显示名与绑定模型（原独立页 `SoundCopyPage`） | `voiceTools` |
| SubtitlePage | 字幕条目编辑、SRT 写入方式、复制、导出、由脚本旁白生成、保存 | `projectTools` |
| └ TranscribeSection | 选音频与语言、转录、进度、结果替换/追加 | `whisperTools` |
| HtmlGenPage | 提示词生成/修改 HTML（**两个并列按钮**：「生成 HTML」/「按需求修改」，区别由**每个动作按钮内部各自的 `?`** 悬浮说明承载（一个动作一个，只讲自己那个动作；动作行末尾不再有独立 `?`）；「按需求修改」在无 HTML 时禁用，「生成 HTML」点一次即执行、无二次确认；主进程两个频道各自独立未合并）、素材选配（字幕 / 视频素材）、**背景音频选定**（音轨由主进程注入 HTML，不经 Agent）、预览、下载、AI 思考过程、**转视频（点按钮先开「渲染档位」弹窗，确认后渲染）** | `projectTools`（`onHtmlProgress`、`setAudio` / `clearAudio`、`extractVideoAudio`、`saveVideo`、`setRender`）、`hfTools`（`renderVideo`）、`voiceTools`（`listGenerated`，仅填充音频下拉）、全局 `renderProgress` / `renderDefaults` |
| VideoPreviewPage | 纯预览：播放 / 定位当前项目成品 MP4（`<video class="hf-video" controls>`），无成品时给引导文案；**不再发起渲染** | `projectTools`（经 `refreshProject`）、`hfTools`（`showInFolder`）、全局 `renderProgress` |
| SettingsPage | 自定义模型（含测试连接）、**语音服务配置（按厂家：厂家下拉 + API Key；模型与音色由厂家目录固定）**、渲染默认档位、**应用更新**（版本显示 / 检查 / 下载 / 取消 / 重启安装 / 更新源与启动检查开关 / 跳过版本（**按钮标签与写入 `skippedVersion` 都用目标版本 `updateNewVersion`**，与只作「当前版本」显示的 `updateVersion` 分开）/ 「查看详情 · 收起详情」折叠排障详情 / **仅更新出错时才出现的「打开日志目录」**（`updateLogVisible = updateStage === 'error' \|\| updateStatusClass === 'hf-error'`）/ 挂载时用 `updateTools.status()` 补齐主进程状态）、**运行环境一行三态**（下载中 / 缺包 / 失败 + 「下载运行环境」「取消下载」+ 仅缺包时出现的「从本地文件安装…」+ `runtimeNotice` 反馈） | `settingsTools`（含 `pickRuntimePack`）、`voiceTools`（`listModels` 取厂家目录 / `saveConfig` 按厂家保存 apiKey）、`updateTools`、`runtimeTools`（经 `useRuntime`） |
| └ WhisperSection | 识别模型下载/删除/设为当前、自定义模型管理、占用统计 | `whisperTools` |

> 具体方法名与参数见 [files/renderer/](./files/renderer/) 下的页面 / 组件 / 公共方法 / 文件级文档（每页一篇，页面自己的子组件与助手并入该篇）；频道 ↔ 命名空间总表见 [01-架构总览 §3.3](./01-架构总览.md)。

---

## 6. 样式策略

- **全局设计系统**：`assets/main.css`（1674 行）承载根变量、标题栏、布局、菜单、卡片、按钮、表单、表格、`step-bar` 以及各页面专有样式（按源码注释可划分为约 34 个样式节，含首页项目卡片 `.proj-*`、首页 hero 参数行 `.hero-sub`、设置页左侧导航 `.settings-*`、排障详情块 `.hf-detail`、配音页「我的音色」列表 `.panel-head*` / `.voice-list*` / `.voice-*`（含危险按钮 `.hf-btn-danger` 与行尾动作列 `.voice-actions`）与可拖动跳转的预览进度条 `.hg-prev-*`）；由 `main.ts` 全局导入。其中 `html, body` 另设**全局基准字号 `font-size: 14px`**（设计规范「正文」档，改动前未设、未显式声明字号的文字会落到 Chromium 默认 16px）。视觉规范（配色、辉光、字号、间距、圆角）写在 `src/renderer/agents.md`（科技主题设计规范，已随渲染层代码上提到 `renderer/` 层；根目录 `agents.md` 只是指向它的指针；列表面板的结构约定见该文件 §5.6）。
- **组件补充**：经核查，全部 `.vue` 中**只有 `App.vue` 带 `<style scoped>`**（Toast 宿主 `.toast-host` / `.toast-item`），其余页面/组件不含样式块，完全依赖 `main.css` 的类名。新增样式时优先在 `main.css` 内按节追加，保持设计系统集中。**唯一例外是启动画面**（`index.html` 的内联 `<style>`）：`main.css` 要等 Vue 挂载才由 JS 注入，启动画面必须自包含，因此它不引用任何 CSS 变量。
- 主题通过 CSS 变量（`--bg-primary`、`--color-primary`、`--text-secondary`、`--glow-*`、`--radius-*` 等）切换，若要加亮色模式只需在 `:root[data-theme="light"]` 覆盖变量。

---

## 7. 注意事项

1. **不要引入 vue-router / pinia**：现有 `goPage` 的「先 refreshProject 再渲染」副作用与 `pageNavKey` 重挂载语义是刻意保留的旧行为等价物，替换会引入回归风险。
2. **进度订阅不要在页面外注册多次**：preload 是单订阅语义（重复注册只替换回调），在 `onMounted` 注册一次即可；全局渲染进度只在 `App.vue` 注册一次。**`runtime:progress` 全渲染层只有 `useRuntime.ts` 一处注册**：`useEnvGate` 曾自己调 `onProgress`，后注册的回调会顶掉 `useRuntime` 的订阅、使外壳横幅与设置页停在首帧 `status()` 快照上；现已改为 `initEnvGate()` 内 `watch(() => useRuntime().runtime.value, applyProgress, { deep: true })` —— 确认框与横幅/设置页读同一份状态，实时且只有一个订阅者。
3. **文档级监听要成对**：`HtmlGenPage` 的 `message` 监听、`TranscribeSection` 的 ESC 监听都改为 `onMounted` / `onBeforeUnmount` 成对注册，不要再用模块级 once-guard。
4. **项目只有「我的项目」一种形态**：项目都是 `userData/projects/<项目名>/` 下的普通目录，各页面不需要只读守卫；`has*` computed 一律只看当前项目产物字段。
5. **CSP 禁止运行时模板编译**：SFC 全部预编译，不要使用 `Vue.compile` / 字符串模板。
6. **唯一的同步 IPC 在设置页**：`updateTools.version()` 是 `sendSync`（首屏立刻显示当前版本号），调用点只在 `SettingsPage` 的 `onMounted` 里、且包在 `try` 中；新增页面不要模仿这个做法，异步接口足够。
7. **两类字符串归属不同，别放错层**：要显示的**品牌文案**（应用名 / 英文名 / 口号）取 `@shared/constants`（三端共用，可随品牌改）；**`localStorage` 键名**取 `@renderer/constants`（**故意不跟随品牌改名**，改了会让老用户丢「上次项目 / 设置页分类」记忆，必须补「读旧键 → 写新键」迁移）。页面里不要写裸字面量。
8. **改代码前先看更新日志、改完必记一条**：动渲染层任何源码前，先看根目录 `CHANGELOG.md` 的**当前版本区块**（这一版已经改了什么，避免重复实现、避免与已写下的决定打架），改完必须在该区块**追加或更新一条**记录（`[标签]` + 影响范围 + 验证方式）；同一功能在本版内改到第 2 次的，在最新那一条标 `[完整版]`。与根 `agents.md` 关键约定 3、4 一致。

---

## 8. 相关文档

- 说明文档：[files/renderer/](./files/renderer/)（每页一篇 / `assets.md`、`components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇 / `index.html.md`、`main.ts.md`、`constants.ts.md`、`App.vue.md`、`env.d.ts.md` 文件级各一篇）
- 共享层（品牌文案与 IPC 契约）：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 桥接层与命名空间：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 状态与数据流全景：[01-架构总览.md](./01-架构总览.md) 第 4 节
