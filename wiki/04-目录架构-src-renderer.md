# 04 · 目录架构：`src/renderer/`（渲染层）

> Vue 3 + TypeScript 的界面层，共 **49** 个文件（`index.html` 1 + 设计规范 `agents.md` 1 + `src/` 下 47：外壳 `App.vue` 1 + 入口 `main.ts` / `env.d.ts` 2 + 渲染层常量 1 + 样式 1 + 通用组件 4（`StepBar.vue` / `NewProjectDialog.vue` / `HfSelect.vue` / `LegacyDataDialog.vue`） + composables 9 + utils 4 + 页面 25（一页一目录，入口统一 `index.vue`，含注册表 `pages/index.ts`；**`HtmlGenPage/` 本轮由 1 个文件变 3 个**；设置页那一目录 = 外壳 + 3 个页面级 `.ts` + `components/` 下 5 个区块组件））。刻意**不引入** vue-router 与 pinia：导航是一个注册表 + `goPage()` 函数，全局状态是模块级 `reactive` 单例。所有系统能力都经 `window.*`（preload 桥）访问。

---

## 1. 文件清单

```
src/renderer/
├─ index.html                    # 103 行  HTML 宿主：#app + 启动画面（内联样式，不等 JS）+ CSP meta + 模块入口；品牌文案用 %APP_*% 占位、构建期注入
├─ agents.md                     # 174 行   科技主题（Cyber UI / 深空科技）设计规范正文（自 pages/ 上提到 renderer/ 层）
└─ src/
   ├─ main.ts                    #  15 行   createApp + 挂载 + 导入全局 CSS + 启动画面淡出移除
   ├─ App.vue                    # 327 行   外壳：标题栏（文案取 @shared/constants 的 APP_NAME）+ 运行环境横幅（下载中 / 缺包 / 失败三态）+ 运行环境确认框（内联 `.hf-modal`）+ **配置类错误弹窗宿主**（`useConfigPrompt`，[去设置] / [取消]）+ 侧栏菜单 + 页面容器 + 旧数据弹窗宿主 + Toast + 启动流程（initRenderProgress → initRuntime → initEnvGate → initLegacyData → initApp）
   ├─ env.d.ts                   #   8 行   .vue 等模块类型补丁
   ├─ constants.ts               #  59 行   渲染层公共常量：localStorage 键名前缀 + 两个持久化键（不跟随品牌名，改前缀必须补迁移）
   ├─ assets/
   │  └─ main.css                # 1796 行  全局设计系统（深空科技主题；本轮末尾新增「HTML生成页：项目素材库」一节）
   ├─ components/
   │  ├─ StepBar.vue             #  90 行   五节点链路状态条 + 工作项目切换器（新建入口改为弹窗）
   │  ├─ NewProjectDialog.vue    #  83 行   新建项目弹窗（创建 + 刷新 + 切换，成功后 emit created）
   │  ├─ HfSelect.vue            # 382 行   全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 select
   │  └─ LegacyDataDialog.vue    # 102 行   「发现旧版本数据」应用内弹窗（迁移 / 删除 / 稍后；无 props / emits，状态取自 useLegacyData）
   ├─ composables/
   │  ├─ useAppStore.ts          # 108 行   全局项目状态单例（appState / has* / refreshProject；`ProjectState.materials` 取代旧的 `videoMaterial`；含项目级渲染档位覆盖）；上下文键取 @renderer/constants
   │  ├─ useToast.ts             #  22 行   轻提示
   │  ├─ useRenderProgress.ts    #  92 行   HyperFrames 渲染进度解析（长阶段中文名 + 内部微阶段不上屏；渲染中由 `HtmlGenPage/PreviewSection.vue` 展示）
   │  ├─ useRuntime.ts           #  90 行   运行环境（分包）状态单例（runtime:progress 订阅 + runtime:status 首帧补齐；busy / failed / missing / hasMissing / ready / cancelable / missingText + prepare(packs?) / cancel()）
   │  ├─ useEnvGate.ts           # 159 行   「需要下载运行环境」确认框单例（guard → confirmDownload / cancelDownload / continueAction；三态 confirm / downloading / ready，装好后按钮变「继续」、**不自动续做**；进度经 `watch(useRuntime().runtime)` 消费，全渲染层只有 useRuntime.ts 一处 onProgress 注册）
   │  ├─ useConfigPrompt.ts      #  86 行   配置类错误弹窗单例（`open(msg, target, jump?, title?)` / `fromResult(res, jump?)` / `go()` / `close()`；只有 [去设置] / [取消]，分类来自主进程 `needConfig`；**余额 / 欠费不弹窗**）
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
      │  ├─ index.vue            #  37 行   配音页外壳（三个 Tab：文字生音频 / 字幕配音 / 音色管理；Tab 值用 helpers 的 `activeTtsTab`）
      │  ├─ SynthSection.vue     # 378 行   文字生音频卡（音色/模型下拉受「Key 已配置」门控；**切回本 Tab 自动重拉音色**；合成失败时 `configPrompt.fromResult(res)` 弹「去设置」）
      │  ├─ AlignSection.vue     # 333 行   字幕配音（逐句对齐）卡（音色同样门控 + 未就绪时的「API Key 设置」按钮；**缺 ffmpeg 运行环境包时经 `useEnvGate` 弹确认框**）
      │  ├─ VoiceSection.vue     # 526 行   音色管理卡组（创建克隆音色弹窗——**`Teleport` 弹窗 2 处**；我的音色列表 4 列、不显示音色 ID、行尾「删云端」动作；音色映射；模型下拉按厂家分组；**切回本 Tab 自动重拉列表**）
      │  └─ helpers.ts           # 182 行   配音助手（三卡共用的 `activeTtsTab`、配置形状唯一读取入口 `readActiveCfg`、Key 就绪状态、音色载入/分组）
      ├─ SubtitlePage/
      │  ├─ index.vue            # 253 行   字幕条目编辑
      │  ├─ TranscribeSection.vue# 365 行   转录弹窗（**缺 ffmpeg 运行环境包时经 `useEnvGate` 弹确认框**，`doTranscribe(skipEnvGuard)`）
      │  └─ helpers.ts           # 165 行   字幕助手（估时、条目类型等）
      ├─ HtmlGenPage/             # **本轮由「单文件」拆成三个文件（一个文件一件事）**
      │  ├─ index.vue            # 373 行   页面入口：StepBar + 项目状态卡（`.proj-meta`，含「素材」格）+ 字幕素材下拉 + `<MaterialsSection />` + 需求描述 + 四个动作按钮（生成 HTML / 按需求修改 / 下载 HTML / 转视频）+ `<PreviewSection />` + 转视频弹窗；生成流程只把 `{ subtitleProject, materialIds }` 交给主进程
      │  ├─ MaterialsSection.vue # 167 行   「项目素材」区块：图片 / 视频两堵 `.mat-grid` 卡片墙（勾选 / 移除 / 添加），**无 props、无 emits**，状态就是 `appState.project.materials`；末尾有一段被注释下线的「提取原声为背景音频」实现
      │  └─ PreviewSection.vue   # 331 行   「预览」卡片：背景音频选定 + 试听与语速 + 状态行 + AI 思考过程 + iframe 预览副本 + 播放控制条（暂停 / 重播 / 拖动 seek）；**props `{ status, statusClass, thinkText, rendering }` + `defineExpose({ reload })`**
      ├─ VideoPreviewPage/
      │  └─ index.vue            # 142 行   视频预览（纯预览：可选任意「有视频成品」的项目播放 / 定位；**切换只换本页播放内容、不改工作项目**；「转视频」与渲染档位在 HTML生成页）
      └─ SettingsPage/            # 一页一目录：外壳 + 页面级 .ts + components/ 下的区块组件
         ├─ index.vue            #  66 行   设置页外壳（左侧 5 类平级导航 + 右侧按分类挂载；分类记忆 + 跨页意图消费）
         ├─ types.ts             #  12 行   页面类型出口（re-export `VoiceProviderView`；`UpdateCheckReply = IpcResult<UpdateCheckResult>`）
         ├─ constants.ts         #  32 行   页面级常量（CUSTOM_VALUE / SETTINGS_SECTION_KEY / SETTINGS_NAV_ITEMS 五项 / SETTINGS_SECTION_KEYS）
         ├─ helpers.ts           #  56 行   分类状态（activeSection 与 updateStage 两个模块级 ref + 分类记忆与跨页意图消费）
         └─ components/
            ├─ ModelSection.vue  # 162 行   「模型配置」区块（自定义模型：Base URL / 模型 ID 预设联动 + API Key / 启用 / 保存 / 测试连接）
            ├─ VoiceSection.vue  #  85 行   「语音服务」区块（按厂家：厂家下拉 + API Key）
            ├─ RenderSection.vue #  74 行   「渲染档位」区块（视频渲染默认质量 / 帧率）
            ├─ WhisperSection.vue# 274 行   「语音识别模型」区块（whisper.cpp 模型管理；模板根节点为普通 `<div>`，卡片外壳由外壳 `index.vue` 的 `.card.hgen-panel` 分支提供）
            └─ UpdateSection.vue # 385 行   「应用更新」区块（含跳过版本 / 恢复提示版本、运行环境一行三态、自定义更新源弹窗）
```

> **行数口径**：与 [README](./README.md) §4 一致，用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）；**不要**用 `(Get-Content $f).Count`。
>
> **文件计数**：`index.html`(1) + `agents.md`(1) + `src/` 下 **47** 个（`main.ts` / `App.vue` / `env.d.ts` / `constants.ts` / `assets/main.css` / `components` 4 / `composables` 9 / `utils` 4 / `pages` **25**）= **49**。页面数由 23 增到 25，是因为 `HtmlGenPage/` 拆出了 `MaterialsSection.vue` 与 `PreviewSection.vue`（`HtmlGenPage.md` 一篇文档现在覆盖这 3 个文件）。

---

## 2. 启动与导航

### 2.1 启动链路

```
index.html（CSP meta + <div id="app"> + <div id="boot-splash"> 启动画面；品牌文案占位符由 electron.vite.config.ts 构建期注入）
  → 启动画面先上屏（纯 HTML/CSS，不等 JS）
  → main.ts：createApp(App).mount('#app') + import './assets/main.css'
     → mount 之后：#boot-splash 加 .boot-done 淡出，300ms 后 remove()
     → App.vue onMounted：
        ① window.windowControls.onMaximizedChange(v => isMaximized = v)
        ② initRenderProgress()                    # 全局订阅 video:progress（单订阅语义）
        ③ initApp()：
             localStorage[STORAGE_KEY_PROJECT_CTX]（值 'myapp.projectCtx'） → appState.currentName
             → Promise.all([refreshProject(), loadRenderDefaults()])
```

- 当前项目上下文用 `localStorage` 持久化：键名集中在 `src/renderer/src/constants.ts` 的 `STORAGE_KEY_PROJECT_CTX`（值即 `'myapp.projectCtx'`，只存 `{ name }`），prod 下 `loadFile(file://)` 同源，故重启自动延续。**前缀 `'myapp.'` 故意不跟随品牌名**——键名就是用户数据的地址，改名会丢「上次项目 / 设置页分类」记忆。
- **品牌文案只有一处来源**：`src/shared/constants.ts`。`App.vue` 标题栏与 `HomePage` 直接 `import`；`index.html` 写占位符，由 `brandHtmlPlugin()` 构建期替换。**素材白名单与上限（`MAX_MATERIALS` / `IMAGE_MATERIAL_EXTS` / `VIDEO_MATERIAL_EXTS`）也在这一层**，主进程校验与渲染层提示共用同一份（见 [05-目录架构-src-shared §4](./05-目录架构-src-shared.md)）。
- **启动画面是首屏体验的一部分**：窗口由主进程立即显示（`backgroundColor: '#0B1220'` 与画面同色）。详见 [index.html](./files/renderer/index.html.md) §2.3。
- 渲染进度是**全局单例**（`useRenderProgress.ts`），在 `App.vue` 只订阅一次；**展示点在本轮发生了变化**：渲染进行中由 `HtmlGenPage/PreviewSection.vue` 的 `statusDisplay` 显示 trace 文案（`rendering && renderProgress.text` 时接管状态行），而**复位调用点有三处**——`HtmlGenPage/index.vue` 的 `onMounted` 与 `onRenderVideo` 结束（含异常分支）、`VideoPreviewPage/index.vue` 的 `onMounted`。
- 渲染默认档位也是全局单例（`useRenderOptions.ts` 的 `renderDefaults`），由 `App.vue` 启动时与 `refreshProject()` 并行调用 `loadRenderDefaults()` 读入。

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

1. **`goPage` 有「先刷新项目再渲染」的副作用**：刷新失败**也照切页**，只把原因 `toast` + `console.error` 说出来。
2. **`pageNavKey` 作为 `<component :is>` 的 `key`**：递增 key 强制重挂载，恢复「每次进入页面重新加载当前项目」的语义（素材库、预览 iframe 也因此每次都重建）。
3. **组件对象用 `shallowRef`**：避免 Vue 深度代理组件定义。

### 2.3 页面 key 与入口

| PageKey | 组件 | 侧栏菜单 | 说明 |
|---|---|---|---|
| `home` | `HomePage/index.vue` | ✅ 首页 | 启动默认页 |
| `content` | `ContentPage/index.vue` | ✅ 内容脚本 | 流水线起点（内容源） |
| `text-tts` | `TextTtsPage/index.vue` | ✅ 配音 | 内含三个 Tab：文字生音频 / 字幕配音 / 音色管理（原独立页 `SoundCopyPage` 已并入） |
| `subtitle` | `SubtitlePage/index.vue` | ✅ 字幕生成 | 含转录弹窗子组件 |
| `html-gen` | `HtmlGenPage/index.vue`（+ `MaterialsSection.vue` / `PreviewSection.vue`） | ✅ HTML生成 | **本轮拆成三个文件**：入口只剩状态卡 / 字幕下拉 / 需求描述 / 四个动作按钮 / 转视频弹窗；**项目素材库（多图片 + 多视频，勾选参与生成）在 `MaterialsSection.vue`**；背景音频、状态行、AI 思考过程与预览播放控制在 `PreviewSection.vue`。**转视频入口与渲染档位仍在此页** |
| `video-preview` | `VideoPreviewPage/index.vue` | ✅ 视频预览 | 流水线终点：**可选项目预览**——默认当前工作项目，下拉另列「有视频成品」的项目；**切换只换本页播放的成品，不改 `appState.currentName`**；渲染由 HTML生成页发起并回写 `videoPath` |
| `about` | `AboutPage/index.vue` | ✅ 关于 | 静态页 |
| `settings` | `SettingsPage/index.vue` | ✅ 设置 | 外壳只决定「显示哪一类」，正文分布在 `SettingsPage/components/` 的 5 个区块组件里 |

> 侧栏菜单项在 `App.vue` 中以 `menuItems` 数组声明（8 项），页面切换后由 `watch(currentPage)` 把 `content` 容器滚动复位。注册表 8 项与菜单 8 项**完全一致**。

---

## 3. 状态与通信约定

| 关注点 | 做法 | 位置 |
|---|---|---|
| 全局项目状态 | 模块级 `reactive` 单例 `appState`（`currentName` / `project` / `myProjects`）；`appState.project` 的 `ProjectState` 含 **`materials: ProjectMaterial[]`**（取代旧的 `videoMaterial: string`） | `composables/useAppStore.ts` |
| 链路状态 | 5 个 `computed`：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo`，一律只看当前项目自身的产物字段 | 同上 |
| 项目切换 | `switchProject(name)`：写 `appState.currentName` → `saveProjectCtx()` → `refreshProject()` | 同上 |
| 持久化键名 | 上次项目 `STORAGE_KEY_PROJECT_CTX`、设置页分类 `STORAGE_KEY_SETTINGS_SECTION`，都由 `STORAGE_PREFIX` 派生 | `constants.ts`（见 §4） |
| 品牌文案与素材规则 | 中文名 / 英文名 / 口号 + **素材上限与扩展名白名单**一律取共享层常量 | `@shared/constants` |
| 后端调用 | 一律 `window.<命名空间>.<方法>()`，结果按 `IpcResult`（`ok` / `message` / `canceled`）分支处理 | 各页面 |
| 进度推送 | 在 `onMounted` 调用 `onXxxProgress(cb)` 注册（preload 为单订阅，切页自动替换回调） | 各页面 / `App.vue` |
| 提示反馈 | `toast(msg)`（2800ms 自动消失，`App.vue` 用 `TransitionGroup` 渲染） | 全局 |
| 文本输出 | 需拼接 HTML 的场景一律用 `escTxt()` 转义 | `utils/escape.ts` |
| 时间格式 / 播放语速 | `fmtTime` / `fmtTimeMs`；`applyRate` / `stepRate`（仅改 `playbackRate`） | `utils/time.ts` / `utils/rate.ts` |
| 渲染档位 | 项目覆盖 > 全局默认 > 内置默认（`standard` / `30`）；缺省字段逐级继承 | `composables/useRenderOptions.ts` + `utils/render.ts` |
| 运行环境状态 | 模块级 `ref` 单例 `runtime`：`initRuntime()` 先订阅 `runtime:progress` 再查一次 `runtime:status` 补齐首帧；`prepare()` 的包名数组走 `toRaw(list).slice()` | `composables/useRuntime.ts` |
| 运行环境确认框 | 模块级单例：`guard(need, actionName, cont?)` 缺包才弹框并记下续做闭包；装好后 `continueAction()` 先关框再用原参数重发（**不自动续做**） | `composables/useEnvGate.ts` + `App.vue` 内联确认框 |
| 配置类错误弹窗 | 模块级单例：`open(msg, target, jump?, title?)` / `fromResult(res, jump?)`；主按钮固定「去设置」，**不显示「查看详情」**、**余额 / 欠费不弹窗** | `composables/useConfigPrompt.ts` + `App.vue` 内联弹窗宿主 |
| 旧数据提示 | 模块级单例 `info` / `visible` / `busy`：`initLegacyData()` 问一次 `legacy:status`；`resolve(action)` 回传 `legacy:resolve` | `composables/useLegacyData.ts` + `components/LegacyDataDialog.vue` |
| 跨页导航意图 | 模块级 `ref` 单例 `settingsSectionRequest`：源页置位 → 目标页读取并复位 | `composables/useNavIntent.ts` |
| **项目素材库** | **状态真源 = `appState.project.materials`（不复制本地列表）；增删勾选都经 `projectTools.pickMedia / addMaterials / saveMaterials`，每次落盘后 `refreshProject()`**；提交 IPC 前必须把 reactive 元素铺平成普通对象（`plainList()`，否则结构化克隆抛 `DataCloneError`） | `pages/HtmlGenPage/MaterialsSection.vue` |

---

## 4. 组件分层

| 层 | 成员 | 说明 |
|---|---|---|
| 外壳 | `App.vue` | 自绘标题栏、运行环境横幅（三态）、**内联的「下载运行环境」确认框**、**内联的「配置类错误」弹窗**、侧栏菜单、`<component :is>` 页面容器、旧数据弹窗宿主、Toast 宿主、启动流程 |
| 通用组件 | `components/StepBar.vue`、`NewProjectDialog.vue`、`HfSelect.vue`、`LegacyDataDialog.vue` | `StepBar` props `page: PageKey`；`NewProjectDialog` 内部闭环 `create → refreshProject → switchProject`；`HfSelect` 全局自绘下拉（**本轮调用点分布变化：`HtmlGenPage/index.vue` 3 处 + `HtmlGenPage/PreviewSection.vue` 1 处 + `VideoPreviewPage/index.vue` 1 处，全库仍是 20 个实例 / 11 个文件**，见 [components.md](./files/renderer/src/components.md) §5.10）；`LegacyDataDialog` 无 props / 无 emits |
| 页面 | `pages/<PageName>/index.vue`（8 个，一个页面一个文件夹） | 一页一目录，`onMounted` 拉取当前项目数据 |
| 页面子组件 | `SettingsPage/components/{ModelSection,VoiceSection,RenderSection,WhisperSection,UpdateSection}.vue`、`SubtitlePage/TranscribeSection.vue`、`TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue`、**`HtmlGenPage/{MaterialsSection,PreviewSection}.vue`** | 由所属页面承载（与入口 `index.vue` 同目录，或同目录下的 `components/` 子目录）；**`HtmlGenPage` 的两个子组件本轮新增**：`MaterialsSection` 契约是「无 props / 无 emits」（状态取自 `appState`），`PreviewSection` 契约是「4 个 props + `defineExpose({ reload })`」（状态由父页传入） |
| 页面助手 | `SubtitlePage/helpers.ts`、`TextTtsPage/helpers.ts` | 模块级共享纯逻辑与类型，被同目录的多个组件复用 |
| 基础设施与常量 | `composables/*`（9 个）、`utils/*`、`constants.ts` | 全局状态、Toast、渲染进度、运行环境状态与确认框、配置类错误弹窗、旧数据提示、渲染档位、语速、转义、时间；`constants.ts` 只放渲染层自己的约定（`localStorage` 键名），品牌文案与素材规则在共享层 |

---

## 5. 页面 ↔ 主进程域对照

| 页面 | 主要交互 | 涉及的主进程域（preload 命名空间） |
|---|---|---|
| HomePage | 项目列表与进度标记、切换项目、跳转各节点 | `projectTools` |
| AboutPage | 纯静态 | — |
| ContentPage | 编辑并保存内容脚本（style + scenes） | `projectTools` |
| TextTtsPage | 壳：Tab 切换三个子卡 | — |
| ├ SynthSection | 音色/模型选择、文字合成、试听、设为背景音频、已生成音频列表；**合成失败且为配置类时弹「去设置」** | `voiceTools`、`projectTools`、`useConfigPrompt` |
| ├ AlignSection | 逐句对齐（模式 A/B）、进度与取消、结果写回；**失败分支先判配置类弹窗、再判缺 ffmpeg 包** | `voiceTools`、`projectTools`、`useEnvGate`、`useConfigPrompt` |
| └ VoiceSection | 创建克隆音色（`Teleport` 弹窗）、云端/系统音色列表、本地显示名与绑定模型 | `voiceTools`、`useConfigPrompt` |
| SubtitlePage | 字幕条目编辑、SRT 写入方式、复制、导出、由脚本旁白生成、保存 | `projectTools` |
| └ TranscribeSection | 选音频与语言、转录、进度、结果替换/追加 | `whisperTools` |
| **HtmlGenPage（3 个文件）** | **入口**：提示词生成/修改 HTML（两个并列按钮、各带行内 `?`；「生成 HTML」点一次即执行、无二次确认）、**字幕素材下拉**、需求描述、四个动作按钮、**转视频（先开「渲染档位」弹窗）**、**失败分支 `res.needConfig` → `configPrompt.open(...)` 且不叠 toast**；**`MaterialsSection`**：素材库增删勾选（`pickMedia` / `addMaterials` / `saveMaterials`）；**`PreviewSection`**：背景音频选定（`pickAudio` / `setAudio` / `clearAudio`，音轨由主进程注入 HTML，不经 Agent）、预览副本（`previewHtml`）、状态行与 AI 思考过程（父页 props 传入） | `projectTools`（`generateHtml` / `modifyHtml` / `downloadHtml` / `previewHtml` / **`pickMedia` / `addMaterials` / `saveMaterials`** / `pickAudio` / `setAudio` / `clearAudio` / **`extractVideoAudio`（保留但当前无界面入口）** / `saveVideo` / `setRender` / `onHtmlProgress`）、`hfTools`（`renderVideo`）、`voiceTools`（`listGenerated`，仅填充音频下拉）、全局 `renderProgress` / `renderDefaults`、`useEnvGate`、`useConfigPrompt` |
| VideoPreviewPage | **可选项目**的成品预览：默认当前工作项目，下拉另列 `hasVideo` 的项目；播放 / 定位成品 MP4（`<video class="hf-video" controls>`）；「重新加载」始终可用（重读清单 + 所选项目被删/改名时回落当前项目）；空态按「没 HTML」/「没视频成品」分文案。**不发起渲染，也不切工作项目**；数据来自 `project:list` 的 `hasVideo` / `hasHtml` 与 `project:load` 的 `videoPath`（**无新增频道**） | `projectTools`（经 `refreshProject` 与 `load`）、`hfTools`（`showInFolder`）、全局 `renderProgress` |
| SettingsPage | 外壳 5 类导航 + 5 个区块组件（自定义模型 / 语音服务 / 渲染默认档位 / 应用更新 / 语音识别模型）；`ModelSection.vue` 的 `onTest()` 刻意不弹配置类弹窗 | `settingsTools`（含 `pickRuntimePack`）、`voiceTools`、`updateTools`、`runtimeTools`、`whisperTools` |

> 具体方法名与参数见 [files/renderer/](./files/renderer/) 下的文档（**`HtmlGenPage.md` 一篇覆盖该目录的 3 个文件**）；频道 ↔ 命名空间总表见 [01-架构总览 §3.3](./01-架构总览.md)。

---

## 6. 样式策略

- **全局设计系统**：`assets/main.css`（**1796 行**，本轮由 1676 → 1796）承载根变量、标题栏、布局、菜单、卡片、按钮、表单、表格、`step-bar` 以及各页面专有样式（按源码注释可划分为约 35 个样式节，**本轮末尾新增「HTML生成页：项目素材库（图片 / 视频卡片墙）」一节**：`.mat-grid` / `.mat-card`(+`.off`) / `.mat-thumb`(+`.mat-play`) / `.mat-meta` / `.mat-name` / `.mat-path` / `.mat-check`(+`.on`) / `.mat-del` / `.mat-add` / `.mat-count` / `.panel-title .dot.dot-img`，使用方只有 `HtmlGenPage/MaterialsSection.vue`）；由 `main.ts` 全局导入。其中 `html, body` 另设**全局基准字号 `font-size: 14px`**。视觉规范写在 `src/renderer/agents.md`（根目录 `agents.md` 只是指针；列表面板结构约定见该文件 §5.6）。
- **组件补充**：经核查，全部 `.vue` 中带 `<style>` 块的只有 **3 个文件、4 段**——`App.vue`（`<style scoped>`，Toast 宿主）、`components/HfSelect.vue`（`<style scoped>` 触发器 + **不带 `scoped`** 的弹层，因为弹层 Teleport 到 `body`）、`components/LegacyDataDialog.vue`（`<style scoped>`，`.path-line` / `.opt-list` / `.danger-text` / `.hf-btn.danger`）；其余页面与组件（含**本轮新增的两个 HtmlGenPage 子组件**）不含样式块，完全依赖 `main.css` 的类名 + 模板行内 `style`。**唯一例外是启动画面**（`index.html` 的内联 `<style>`），它必须自包含。
- 主题通过 CSS 变量切换；若要加亮色模式只需在 `:root[data-theme="light"]` 覆盖变量。

---

## 7. 注意事项

1. **不要引入 vue-router / pinia**：`goPage` 的「先 refreshProject 再渲染」副作用与 `pageNavKey` 重挂载语义是刻意保留的旧行为等价物。
2. **进度订阅不要在页面外注册多次**：preload 是单订阅语义，在 `onMounted` 注册一次即可；全局渲染进度只在 `App.vue` 注册一次。**`runtime:progress` 全渲染层只有 `useRuntime.ts` 一处注册**（`useEnvGate` 改为 `watch` 消费同一份状态）。
3. **文档级监听要成对**：`HtmlGenPage/PreviewSection.vue` 的 `message` / `resize` 监听（含 `seekAckTimer`）与 `TranscribeSection` 的 ESC 监听都改为 `onMounted` / `onBeforeUnmount` 成对注册；`HtmlGenPage/index.vue` 现在只剩 `document` 级的弹窗 ESC（`onModalKeydown`）。
4. **项目只有「我的项目」一种形态**：项目都是 `userData/projects/<项目名>/` 下的普通目录，各页面不需要只读守卫。
5. **CSP 禁止运行时模板编译**：SFC 全部预编译，不要使用 `Vue.compile` / 字符串模板。**CSP 的 `img-src` 本轮新增 `hgpreview:`**（素材缩略图经该协议取，见 [index.html.md](./files/renderer/index.html.md) §2.1）。
6. **唯一的同步 IPC 在设置页**：`updateTools.version()` 是 `sendSync`，调用点只在 `SettingsPage/components/UpdateSection.vue` 的 `onMounted` 里且包在 `try` 中。
7. **两类字符串归属不同，别放错层**：品牌文案与素材白名单取 `@shared/constants`；`localStorage` 键名取 `@renderer/constants`（**故意不跟随品牌改名**）。
8. **改代码前先看更新日志、改完必记一条**：与根 `AGENTS.md` 关键约定 3、4 一致。
9. **素材列表要过结构化克隆**：`appState.project.materials` 的元素是 Vue `Proxy`，直接 `invoke` 会抛 `DataCloneError`；写素材的代码必须先铺平成普通对象（`MaterialsSection.vue` 的 `plainList()` 就是为此存在，取不到任何性能收益也别省）。

---

## 8. 相关文档

- 说明文档：[files/renderer/](./files/renderer/)（每页一篇 / `assets.md`、`components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇 / 其余文件级各一篇）
- 共享层（品牌文案、素材规则与 IPC 契约）：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 桥接层与命名空间：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 状态与数据流全景：[01-架构总览.md](./01-架构总览.md) 第 4 节
