# 04 · 目录架构：`src/renderer/`（渲染层）

> Vue 3 + TypeScript 的界面层，共 33 个文件（外壳 1 + 入口 3 + **渲染层常量 1** + 样式 1 + 通用组件 3（`StepBar.vue` / `NewProjectDialog.vue` / `HfSelect.vue`） + 基础设施 8 + 页面 9（一页一目录，入口统一 `index.vue`） + 页面子组件 4 + 页面助手 2 + 注册表 1 + 设计规范 1）。刻意**不引入** vue-router 与 pinia：导航是一个注册表 + `goPage()` 函数，全局状态是模块级 `reactive` 单例。所有系统能力都经 `window.*`（preload 桥）访问。

---

## 1. 文件清单

```
src/renderer/
├─ index.html                    # 103 行  HTML 宿主：#app + 启动画面（内联样式，不等 JS）+ CSP meta + 模块入口；品牌文案用 %APP_*% 占位、构建期注入
├─ agents.md                     # 139 行   科技主题（Cyber UI / 深空科技）设计规范正文（自 pages/ 上提到 renderer/ 层）
└─ src/
   ├─ main.ts                    #  15 行   createApp + 挂载 + 导入全局 CSS + 启动画面淡出移除
   ├─ App.vue                    # 外壳：标题栏（文案取 @shared/constants 的 APP_NAME）+ 侧栏菜单 + 页面容器 + Toast + 启动流程
   ├─ env.d.ts                   #   8 行   .vue 等模块类型补丁
   ├─ constants.ts               #  14 行   渲染层公共常量：localStorage 键名前缀 + 两个持久化键（不跟随品牌名，改前缀必须补迁移）
   ├─ assets/
   │  └─ main.css                # 全局设计系统（深空科技主题，行数随迭代增长）
   ├─ components/
   │  ├─ StepBar.vue             #  90 行   五节点链路状态条 + 工作项目切换器（新建入口改为弹窗）
   │  ├─ NewProjectDialog.vue    #  83 行   新建项目弹窗（创建 + 刷新 + 切换，成功后 emit created）
   │  └─ HfSelect.vue            # 378 行   全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 select
   ├─ composables/
   │  ├─ useAppStore.ts          # 107 行   全局项目状态单例（appState / has* / refreshProject；含项目级渲染档位覆盖）；上下文键取 @renderer/constants
   │  ├─ useToast.ts             #  22 行   轻提示
   │  ├─ useRenderProgress.ts    #  92 行   HyperFrames 渲染进度解析（长阶段中文名 + 内部微阶段不上屏）
   │  └─ useRenderOptions.ts     #  41 行   渲染档位：全局默认载入 / 生效档位 / 项目级覆盖写入
   ├─ utils/
   │  ├─ escape.ts               #   4 行   escTxt 文本转义
   │  ├─ rate.ts                 #  21 行   语速控件（0.5~2.0）
   │  ├─ time.ts                 #  15 行   fmtTime / fmtTimeMs
   │  └─ render.ts               #  55 行   渲染档位选项表与纯函数（pickRenderOverride / resolveRenderOptions …）
   └─ pages/                     # 一个页面一个文件夹，入口统一 index.vue
      ├─ index.ts                #  40 行   页面注册表 + goPage 路由（归属「公共方法与工具」一篇）
      ├─ HomePage/
      │  └─ index.vue            #  86 行   首页（hero 角标与主标题均取 @shared/constants + 参数行 + 流水线 + 我的项目卡片）
      ├─ AboutPage/
      │  └─ index.vue            #  18 行   关于（静态）
      ├─ ContentPage/
      │  └─ index.vue            # 106 行   内容脚本
      ├─ TextTtsPage/
      │  ├─ index.vue            #  43 行   配音页外壳（三个 Tab：文字生音频 / 字幕配音 / 音色管理）
      │  ├─ SynthSection.vue     # 360 行   文字生音频卡
      │  ├─ AlignSection.vue     # 293 行   字幕配音（逐句对齐）卡
      │  ├─ VoiceSection.vue     # 320 行   音色管理卡组（创建克隆音色 / 我的音色 / 音色映射；原独立页 SoundCopyPage 并入本 Tab）
      │  └─ helpers.ts           # 129 行   配音助手（音色载入/分组/校验、「管理音色」Tab 信号）
      ├─ SubtitlePage/
      │  ├─ index.vue            # 253 行   字幕条目编辑
      │  ├─ TranscribeSection.vue# 350 行   转录弹窗
      │  └─ helpers.ts           # 165 行   字幕助手（估时、条目类型等）
      ├─ HtmlGenPage/
      │  └─ index.vue            # 644 行   HTML 生成 / 修改（「生成 HTML」与「按需求修改」两个并列按钮，**每个动作按钮内部各带一个 `?`**（悬浮只显示该动作自己的说明；动作行末尾不再有独立 `?`）；生成点一次即执行、无二次确认，按需求修改在无 HTML 时禁用；字幕 / 视频素材选配：视频只有一个入口，可选项目现有素材或当场导入）+ 背景音频选定 + 预览 + 转视频（含渲染档位）
      ├─ VideoPreviewPage/
      │  └─ index.vue            #  88 行   视频预览（纯预览：成品播放 / 定位；「转视频」与渲染档位在 HTML生成页）
      └─ SettingsPage/
         ├─ index.vue            # 510 行   设置（左侧分类导航：自定义模型 / 千问语音 / 渲染默认档位 / 应用更新 / 语音识别模型；分类记忆键取 @renderer/constants）
         └─ WhisperSection.vue   # 274 行   语音识别模型管理区块
```

> **行数口径**：与 [README](./README.md) §4 一致，用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）；**不要**用 `(Get-Content $f).Count`（PS 5.1 读 LF 行尾会少算）或 `([regex]::Matches($text,"`n")).Count + 1`（以换行结尾会多算 1）。
>
> **文件计数**：`index.html`(1) + `agents.md`(1) + `src/` 下 31 个（`main.ts` / `App.vue` / `env.d.ts` / `constants.ts` / `assets/main.css` / `components` 3 / `composables` 4 / `utils` 4 / `pages` 17）= **33**。

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
  await refreshProject()      // 先刷新项目状态，再换页
  currentPage.value = pages[key]
  pageNavKey.value++          // 递增 key 强制重挂载
}
```

三个设计要点：

1. **`goPage` 有「先刷新项目再渲染」的副作用**，因此保留函数式导航而不是声明式路由。
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

---

## 4. 组件分层

| 层 | 成员 | 说明 |
|---|---|---|
| 外壳 | `App.vue` | 自绘标题栏（hidden titleBarStyle，经 `windowControls`；标题文案取 `APP_NAME`）、侧栏菜单、`<component :is>` 页面容器、Toast 宿主、启动流程 |
| 通用组件 | `components/StepBar.vue` 、`components/NewProjectDialog.vue` 、`components/HfSelect.vue` | `StepBar` props `page: PageKey`；第一行五节点链路（点击跳转），第二行「工作项目」下拉（只有我的项目）+ 「新建项目」（只置 `newVisible = true`，弹窗承担创建）+ 「打开目录」。`NewProjectDialog` props `{ visible: boolean }`、emits `update:visible` / `created`，内部闭环 `create → refreshProject → switchProject`。`HfSelect` 是全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 `select`。**旧版 `[data-slot]` 注入机制与 StepBar 第二行的行内输入框均已废弃**，各页面在模板顶部放 `<StepBar :page="'xxx'"/>` 即等效 |
| 页面 | `pages/<PageName>/index.vue`（9 个，一个页面一个文件夹） | 一页一目录，`onMounted` 拉取当前项目数据 |
| 页面子组件 | `SettingsPage/WhisperSection.vue`、`SubtitlePage/TranscribeSection.vue`、`TextTtsPage/SynthSection.vue`、`TextTtsPage/AlignSection.vue` | 由所属页面承载（与入口 `index.vue` 同目录）；原 `window.__settings` / `window.__sub` / ctx 共享做法改为 props / `ref` 显式调用 |
| 页面助手 | `SubtitlePage/helpers.ts`、`TextTtsPage/helpers.ts` | 模块级共享纯逻辑与类型（估时、音色分组/解析/校验），被同目录的多个组件复用 |
| 基础设施与常量 | `composables/*`、`utils/*`、`constants.ts` | 全局状态、Toast、渲染进度、渲染档位、语速、转义、时间；`constants.ts` 只放渲染层自己的约定（当前为 `localStorage` 键名），品牌文案在共享层 |

---

## 5. 页面 ↔ 主进程域对照

| 页面 | 主要交互 | 涉及的主进程域（preload 命名空间） |
|---|---|---|
| HomePage | 项目列表与进度标记、切换项目、跳转各节点（**新建入口已从首页移到顶部「工作项目」栏的弹窗**） | `projectTools` |
| AboutPage | 纯静态 | — |
| ContentPage | 编辑并保存内容脚本（style + scenes） | `projectTools` |
| TextTtsPage | 壳：Tab 切换三个子卡（文字生音频 / 字幕配音 / 音色管理） | — |
| ├ SynthSection | 音色/模型选择、文字合成、试听、设为背景音频、已生成音频列表 | `voiceTools`、`projectTools` |
| ├ AlignSection | 逐句对齐（模式 A/B）、进度与取消、结果写回字幕与音频 | `voiceTools`、`projectTools` |
| └ VoiceSection | 创建克隆音色、云端/系统音色列表、本地显示名与绑定模型（原独立页 `SoundCopyPage`） | `voiceTools` |
| SubtitlePage | 字幕条目编辑、SRT 写入方式、复制、导出、由脚本旁白生成、保存 | `projectTools` |
| └ TranscribeSection | 选音频与语言、转录、进度、结果替换/追加 | `whisperTools` |
| HtmlGenPage | 提示词生成/修改 HTML（**两个并列按钮**：「生成 HTML」/「按需求修改」，区别由**每个动作按钮内部各自的 `?`** 悬浮说明承载（一个动作一个，只讲自己那个动作；动作行末尾不再有独立 `?`）；「按需求修改」在无 HTML 时禁用，「生成 HTML」点一次即执行、无二次确认；主进程两个频道各自独立未合并）、素材选配（字幕 / 视频素材）、**背景音频选定**（音轨由主进程注入 HTML，不经 Agent）、预览、下载、AI 思考过程、**转视频（点按钮先开「渲染档位」弹窗，确认后渲染）** | `projectTools`（`onHtmlProgress`、`setAudio` / `clearAudio`、`extractVideoAudio`、`saveVideo`、`setRender`）、`hfTools`（`renderVideo`）、`voiceTools`（`listGenerated`，仅填充音频下拉）、全局 `renderProgress` / `renderDefaults` |
| VideoPreviewPage | 纯预览：播放 / 定位当前项目成品 MP4（`<video class="hf-video" controls>`），无成品时给引导文案；**不再发起渲染** | `projectTools`（经 `refreshProject`）、`hfTools`（`showInFolder`）、全局 `renderProgress` |
| SettingsPage | 自定义模型（含测试连接）、千问语音配置、渲染默认档位、**应用更新**（版本显示 / 检查 / 下载 / 取消 / 重启安装 / 更新源与启动检查开关 / 跳过版本） | `settingsTools`、`voiceTools`、`updateTools` |
| └ WhisperSection | 识别模型下载/删除/设为当前、自定义模型管理、占用统计 | `whisperTools` |

> 具体方法名与参数见 [files/renderer/](./files/renderer/) 下的页面 / 组件 / 公共方法 / 文件级文档（每页一篇，页面自己的子组件与助手并入该篇）；频道 ↔ 命名空间总表见 [01-架构总览 §3.3](./01-架构总览.md)。

---

## 6. 样式策略

- **全局设计系统**：`assets/main.css`（1523 行）承载根变量、标题栏、布局、菜单、卡片、按钮、表单、表格、`step-bar` 以及各页面专有样式（按源码注释可划分为约 33 个样式节，含新增的首页项目卡片 `.proj-*`、首页 hero 参数行 `.hero-sub` 与设置页左侧导航 `.settings-*`）；由 `main.ts` 全局导入。视觉规范（配色、辉光、字号、间距、圆角）写在 `src/renderer/agents.md`（科技主题设计规范，已随渲染层代码上提到 `renderer/` 层；根目录 `agents.md` 只是指向它的指针）。
- **组件补充**：经核查，全部 `.vue` 中**只有 `App.vue` 带 `<style scoped>`**（Toast 宿主 `.toast-host` / `.toast-item`），其余页面/组件不含样式块，完全依赖 `main.css` 的类名。新增样式时优先在 `main.css` 内按节追加，保持设计系统集中。**唯一例外是启动画面**（`index.html` 的内联 `<style>`）：`main.css` 要等 Vue 挂载才由 JS 注入，启动画面必须自包含，因此它不引用任何 CSS 变量。
- 主题通过 CSS 变量（`--bg-primary`、`--color-primary`、`--text-secondary`、`--glow-*`、`--radius-*` 等）切换，若要加亮色模式只需在 `:root[data-theme="light"]` 覆盖变量。

---

## 7. 注意事项

1. **不要引入 vue-router / pinia**：现有 `goPage` 的「先 refreshProject 再渲染」副作用与 `pageNavKey` 重挂载语义是刻意保留的旧行为等价物，替换会引入回归风险。
2. **进度订阅不要在页面外注册多次**：preload 是单订阅语义（重复注册只替换回调），在 `onMounted` 注册一次即可；全局渲染进度只在 `App.vue` 注册一次。
3. **文档级监听要成对**：`HtmlGenPage` 的 `message` 监听、`TranscribeSection` 的 ESC 监听都改为 `onMounted` / `onBeforeUnmount` 成对注册，不要再用模块级 once-guard。
4. **项目只有「我的项目」一种形态**：项目都是 `userData/projects/<项目名>/` 下的普通目录，各页面不需要只读守卫；`has*` computed 一律只看当前项目产物字段。
5. **CSP 禁止运行时模板编译**：SFC 全部预编译，不要使用 `Vue.compile` / 字符串模板。
6. **唯一的同步 IPC 在设置页**：`updateTools.version()` 是 `sendSync`（首屏立刻显示当前版本号），调用点只在 `SettingsPage` 的 `onMounted` 里、且包在 `try` 中；新增页面不要模仿这个做法，异步接口足够。
7. **两类字符串归属不同，别放错层**：要显示的**品牌文案**（应用名 / 英文名 / 口号）取 `@shared/constants`（三端共用，可随品牌改）；**`localStorage` 键名**取 `@renderer/constants`（**故意不跟随品牌改名**，改了会让老用户丢「上次项目 / 设置页分类」记忆，必须补「读旧键 → 写新键」迁移）。页面里不要写裸字面量。

---

## 8. 相关文档

- 说明文档：[files/renderer/](./files/renderer/)（每页一篇 / `assets.md`、`components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇 / `index.html.md`、`main.ts.md`、`constants.ts.md`、`App.vue.md`、`env.d.ts.md` 文件级各一篇）
- 共享层（品牌文案与 IPC 契约）：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 桥接层与命名空间：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 状态与数据流全景：[01-架构总览.md](./01-架构总览.md) 第 4 节
