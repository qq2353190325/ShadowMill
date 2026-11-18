# 04 · 目录架构：`src/renderer/`（渲染层）

> Vue 3 + TypeScript 的界面层，共 **75** 个文件（`index.html` 1 + 设计规范 `agents.md` 1 + `src/` 下 **73**：外壳 `App.vue` 1 + 入口 `main.ts` / `env.d.ts` 2 + 渲染层常量 1 + 样式 1 + 通用组件 **8**（`StepBar.vue` / `NewProjectDialog.vue` / `HfSelect.vue` / `CastShot.vue` / `LegacyDataDialog.vue` / **`SettingsDialog.vue`** / **`UserArea.vue`** / **`AuthDialog.vue`**） + composables **13** + utils **8** + 页面 **39**（一页一目录，入口统一 `index.vue`，含注册表 `pages/index.ts`；设置已从页面改为**全局模态弹窗**，由 `SettingsDialog.vue` 承载 `SettingsPage`）。刻意**不引入** vue-router 与 pinia：导航是一个注册表 + `goPage()` 函数，全局状态是模块级 `reactive` 单例。所有系统能力都经 `window.*`（preload 桥）访问。

> **本次同步范围**：账号（可选登录）在渲染层新增 5 个文件（`composables/useAuth.ts`、`composables/useAuthDialog.ts`、`utils/localAccount.ts`、`components/AuthDialog.vue`、`components/UserArea.vue`），并把先前未收录的两个设置弹窗文件（`SettingsDialog.vue` / `useSettingsDialog.ts`）补进清单；全表行数按当前源码实测（`[IO.File]::ReadAllLines`）。**页面级描述（§5 的 HtmlGenPage / CastPage 细节、`main.css` 的样式节历史）仍是更早快照**，与当前源码的出入见各节提示，留给下一次全量同步。

---

## 1. 文件清单

```
src/renderer/
├─ index.html                    # 107 行  HTML 宿主：#app + 启动画面（内联样式，不等 JS）+ CSP meta + 模块入口；品牌文案用 %APP_*% 占位、构建期注入
├─ agents.md                     # 193 行  科技主题（Cyber UI / 深空科技）设计规范正文（§5.7 项目属性行 = 标签 + 控件 + `?`）
└─ src/
   ├─ main.ts                    #  15 行   createApp + 挂载 + 导入全局 CSS + 启动画面淡出移除
   ├─ App.vue                    # 350 行   外壳：标题栏（文案取 @shared/constants 的 APP_NAME）+ 运行环境横幅（下载中 / 缺包 / 失败三态）+ 运行环境确认框（内联 `.hf-modal`）+ **配置类错误弹窗宿主**（`useConfigPrompt`）+ 侧栏菜单 + 页面容器 + 旧数据弹窗宿主 + Toast + **左下角用户区 `<UserArea />`** + **`<SettingsDialog />`** + **`<AuthDialog />`** + 启动流程（initRenderProgress → initRuntime → initEnvGate → initLegacyData → **void restore()** → initApp）
   ├─ env.d.ts                   #   8 行   .vue 等模块类型补丁
   ├─ constants.ts               #  62 行   渲染层公共常量：localStorage 键名前缀 + 三个持久化键（`projectCtx` / `settingsSection` / **`auth`**；**只存展示字段、不含令牌**）+ 自定义模型 Base URL / 模型预设表（`MODEL_PROVIDERS`）；不跟随品牌名
   ├─ assets/
   │  └─ main.css                # 2701 行  全局设计系统（深空科技主题；含素材库 / 章节列表 / 角色卡片墙 / 角色预览 / 全局角色库方格 / 新建角色成功 / **登录与注册弹窗（`.auth-*`，含 `.auth-code` / `.auth-code-send` / `.auth-devcode`）** 等样式节）
   ├─ components/
   │  ├─ StepBar.vue             #  90 行   五节点链路状态条 + 工作项目切换器（新建入口改为弹窗）
   │  ├─ NewProjectDialog.vue    #  83 行   新建项目弹窗（创建 + 刷新 + 切换，成功后 emit created）
   │  ├─ HfSelect.vue            # 382 行   全局自绘下拉（Teleport 弹层 + 分组 + 键盘导航），替代原生 select
   │  ├─ CastShot.vue            #  77 行   **角色静态预览（公共组件）**：props `id` / `units` / `title?` / `uses?` / `epoch?` / `big?`；watch → `castTools.preview()` → `iframe[src] = userFileUrl(res.rel) + '&e=' + epoch`。**交给 IPC 的 `uses` 必须是普通数组**（`toRaw(...).slice()`）
   │  ├─ LegacyDataDialog.vue    # 102 行   「发现旧版本数据」应用内弹窗（迁移 / 删除 / 稍后；状态取自 useLegacyData）
   │  ├─ SettingsDialog.vue      #  43 行   **设置弹窗外壳（全局单例，挂在 App.vue 根部）**：`.hf-modal` 承载 `SettingsPage`；每次打开重新挂载（各区块在 `onMounted` 读配置），Esc 只关最上层（内层弹窗优先）
   │  ├─ UserArea.vue            # 115 行   **左下角用户区**：头像 + 姓名；点开向上弹浮窗（「设置」+ 登录状态项）。未登录 → 「登录」打开 `AuthDialog`；已登录 → 「退出登录」调 `useAuth.logout()`（异步，先通知主进程撤销服务端会话）
   │  └─ AuthDialog.vue          # 364 行   **登录 / 注册弹窗（全局单例）**：登录栏（邮箱 + 密码 + 显示/隐藏密码）与注册栏（邮箱 + **邮箱验证码行** + 密码 + 强度条 + 确认密码）；注册栏的验证码行 = 输入框 +「获取验证码」按钮 + **倒计时** + **开发模式 `devCode` 回显**；`switchMode` / `resetForm` 会清验证码与倒计时；提交走 `accountApi.register({ email, password, code })`
   ├─ composables/
   │  ├─ useAppStore.ts          # 123 行   全局项目状态单例（appState / has* / refreshProject；`ProjectState.materials` / `canvas`）；上下文键取 @renderer/constants
   │  ├─ useToast.ts             #  22 行   轻提示
   │  ├─ useRenderProgress.ts    # 159 行   HyperFrames 渲染进度解析（长阶段中文名 + 内部微阶段不上屏）
   │  ├─ useRuntime.ts           #  91 行   运行环境（分包 **ffmpeg / hyperframes / vidrender**）状态单例（runtime:progress 订阅 + runtime:status 首帧补齐；busy / failed / missing / prepare / cancel）；初始 status 多一个 `vidrender: 'unknown'`，`PACK_LABEL` 加「Rust 编码内核（vidrender-encode，联调 demo 用）」
   │  ├─ useEnvGate.ts           # 162 行   「需要下载运行环境」确认框单例（guard → confirmDownload / cancelDownload / continueAction；三态）；`LABEL` 同三包文案，`HINT_MB` 加 `vidrender: 1`（仅显式指定时才下载，产品默认不提示）
   │  ├─ useConfigPrompt.ts      #  87 行   配置类错误弹窗单例（`open` / `fromResult` / `go` / `close`；只有 [去设置] / [取消]）
   │  ├─ useLegacyData.ts        #  60 行   旧数据提示单例（legacy:status 问一次 → 弹窗；resolve(action) 回传）
   │  ├─ useNavIntent.ts         #  31 行   跨页「导航意图」信号单例（requestSettingsSection / consumeSettingsSection；SETTINGS_SECTIONS）
   │  ├─ useProjectMeta.ts       #  48 行   「HTML生成」页项目状态条 + 标题右侧「用法」气泡的派生（只读 appState，不碰 IPC）
   │  ├─ useRenderOptions.ts     #  41 行   渲染档位：全局默认载入 / 生效档位 / 项目级覆盖写入
   │  ├─ **useAuth.ts**          # 125 行   **登录态的渲染层镜像**：模块级 `reactive` 单例 `authState`（`loggedIn` / `userName` / `email` / `expiresAt`），**只存展示字段、不存令牌**；`signIn(session)`（后端昵称，空则邮箱 @ 前部分）、`restore()`（启动问 `accountTools.me()`，**只在 `UNAUTHORIZED` 清态，网络错误保留**）、`logout()`（**异步**：先 `accountTools.logout()` 再清本地）
   │  ├─ **useAuthDialog.ts**    #  27 行   **登录 / 注册弹窗的单例开关**（模块级 `visible` / `mode` + `openAuth` / `closeAuth`；与 `useSettingsDialog` 同一套写法，只管弹窗开没开）
   │  └─ useSettingsDialog.ts    #  27 行   设置弹窗的单例开关（设置已从页面改为全局模态弹窗；`goPage('settings')` 直接转到 `openSettings()`）
   ├─ utils/
   │  ├─ escape.ts               #   4 行   escTxt 文本转义
   │  ├─ taskId.ts               #  13 行   **`newTaskId(prefix)`**：任务 id = `前缀-时间戳36进制-序号-4位随机`，用于「先订阅、再调用」
   │  ├─ rate.ts                 #  21 行   语速控件（0.5~2.0）
   │  ├─ time.ts                 #  15 行   fmtTime / fmtTimeMs
   │  ├─ render.ts               #  81 行   渲染档位选项表与纯函数 + 成片画布四导出（RENDER_CANVAS_OPTIONS / canvasLabel / canvasSize / normalizeCanvas）
   │  ├─ url.ts                  #  65 行   路径 → URL：previewUrl（项目内 → `hgpreview://p/…`）/ userPathUrl（项目外产物 → `hgpreview://user/…?user=1`）/ userFileUrl（相对 userData 的路径）；逐段 encodeURIComponent
   │  ├─ changelog.ts            # 124 行   随包 `CHANGELOG.md` 原文的解析（全部无状态纯函数、零依赖）
   │  └─ **localAccount.ts**     # 111 行   **账号的渲染层半边：纯校验 + IPC 转发**。保留 `normalizeEmail` / `validateEmail` / `validatePassword` / `passwordStrength` / `emailUserName`；`accountApi` 三个方法（`sendCode` / `register` / `login`）只做参数归一化后转发 `window.accountTools.*`。**本地账号表、djb2 摘要、`readAccounts` / `writeAccounts` 已全部删除**
   └─ pages/                     # 一个页面一个文件夹，入口统一 index.vue
      ├─ index.ts                #  68 行   页面注册表（8 个组件页）+ goPage 路由（`settings` 不再切页、只 `openSettings()`；刷新失败照切页 + toast）
      ├─ HomePage/index.vue      #  86 行   首页（hero 角标与主标题均取 @shared/constants + 参数行 + 流水线 + 我的项目卡片）
      ├─ AboutPage/index.vue     #  18 行   关于（静态）
      ├─ ContentPage/            # 7 个文件（两个 Tab + 选角色弹窗 + 会话内角色选择）
      │  ├─ index.vue            #  35 行   外壳：StepBar + `.hf-tabs` 两个 Tab（默认「场景编辑」），`v-show` 挂载 `SceneEditor` / `AiChatPanel`
      │  ├─ SceneEditor.vue      #  74 行   「场景编辑」Tab：场景卡（旁白 / 画面分镜 / 时长提示 + 增删排序）+ 一行自动保存状态
      │  ├─ AiChatPanel.vue      # 455 行   「AI 创作」Tab：需求输入、场景数 / 目标时长、**「角色」按钮 +「本片角色」chips**、流式状态行、思考过程折叠、`ScriptRoundCard` 列表；调 `scriptTools.generate`（载荷带 `cast`），进度走 `scriptTools.onProgress`
      │  ├─ ScriptRoundCard.vue  # 139 行   单轮结果卡（版本 / 场景数 / 字数 / 估算时长 / 展开预览 / 应用此版本）
      │  ├─ CastPickerModal.vue  # 122 行   **「选择角色（写稿用）」弹窗**：打开即 `castTools.list()` 读全局库，`CastShot` 出预览，`MAX_CAST = 20`，`confirm()` 只回传不缺文件的成员快照（不写任何文件）
      │  ├─ castPick.ts          #   9 行   本次会话已选的角色（模块级 `ref`，**不落盘**，跨 Tab / 跨页面保留）
      │  └─ helpers.ts           # 271 行   模块级共享状态 `scenes` / `dirty` + 自动保存调度 + 对话记录读写
      ├─ TextTtsPage/
      │  ├─ index.vue            #  37 行   配音页外壳（三个 Tab：文字生音频 / 字幕配音 / 音色管理）
      │  ├─ SynthSection.vue     # 404 行   文字生音频卡
      │  ├─ AlignSection.vue     # 339 行   字幕配音（逐句对齐）卡
      │  ├─ VoiceSection.vue     # 526 行   音色管理卡组
      │  └─ helpers.ts           # 182 行   配音助手（activeTtsTab / readActiveCfg / Key 就绪状态 / 音色载入分组）
      ├─ SubtitlePage/
      │  ├─ index.vue            # 256 行   字幕条目编辑（估时按 `EST_CHARS_PER_SEC` 推算）
      │  ├─ TranscribeSection.vue# 365 行   转录弹窗
      │  └─ helpers.ts           # 165 行   字幕助手（估时、条目类型等）
      ├─ HtmlGenPage/            # **5 个文件**（角色库的两个弹窗已删除，角色区只做勾选）
      │  ├─ index.vue            # 477 行   页面入口：项目状态卡 + 字幕 / 画布下拉 + 全局视觉风格 + `<MaterialsSection />` → `<CastSection />` → `<ChapterSection />` + 需求描述 + 四个动作按钮 + `<PreviewSection />` + 转视频弹窗
      │  ├─ MaterialsSection.vue # 167 行   「项目素材」区块（图片 / 视频卡片墙；无 props / 无 emits）
      │  ├─ CastSection.vue      # 118 行   **「角色」区块（常显）**：卡片墙只做**勾选**（`projectTools.saveCast`）+「管理角色」跳转 `goPage('cast')`；缩略图走 `CastShot`；`castTools.list()` 只用来补展示信息
      │  ├─ ChapterSection.vue   #  71 行   只读章节列表（点「改这一章」把范围写进需求描述）
      │  └─ PreviewSection.vue   # 470 行   背景音频 / 状态行 / AI 思考过程 / iframe 预览与播放控制
      ├─ CastPage/               # 5 个文件（全局角色库，「角色」页）
      │  ├─ index.vue            # 180 行   卡片墙 + 双击看动作示范 + 「…」菜单（动作示范… / 修改角色… / 复制 id / 删除）
      │  ├─ CastEditModal.vue    # 319 行   「新建 / 修改角色」同一个弹窗（`mode: 'create' | 'edit'`；保存只改元数据、按这个要求重画才调模型）
      │  ├─ CastActionModal.vue  # 375 行   动作示范弹窗（会动的大图 + 公共动作 / 专属动作列表 + AI 生成面板）
      │  ├─ CastActionEditor.vue # 262 行   关键帧表编辑器（一行一个时间点、一列一个参数）
      │  └─ CastDemoShot.vue     #  85 行   会动的示范 iframe（`castTools.demo` → `userFileUrl(rel) + '&e=' + epoch + '#' + actionId`）
      ├─ VideoPreviewPage/index.vue # 149 行  视频预览（纯预览：可选任意「有视频成品」的项目播放 / 定位）
      └─ SettingsPage/            # 一页一目录：外壳 + 页面级 .ts + components/ 下的区块组件（挂在 SettingsDialog 里）
         ├─ index.vue            #  69 行   设置页外壳（左侧 5 类平级导航 + 右侧按分类挂载）
         ├─ types.ts             #  12 行   页面类型出口
         ├─ constants.ts         #  32 行   页面级常量（CUSTOM_VALUE / SETTINGS_SECTION_KEY / SETTINGS_NAV_ITEMS / SETTINGS_SECTION_KEYS）
         ├─ helpers.ts           #  56 行   分类状态（activeSection 与 updateStage + 分类记忆与跨页意图消费）
         └─ components/
            ├─ ModelSection.vue  # 188 行   「模型配置」区块
            ├─ VoiceSection.vue  #  85 行   「语音服务」区块
            ├─ RenderSection.vue #  74 行   「渲染档位」区块
            ├─ WhisperSection.vue# 274 行   「语音识别模型」区块
            ├─ UpdateSection.vue # 397 行   「应用更新」区块
            └─ ChangelogDialog.vue # 145 行 「更新日志」弹窗
```

> **行数口径**：与 [README](./README.md) §4 一致，用 `[IO.File]::ReadAllLines($f).Count`（等价于阅读工具显示的 total 行数）；**不要**用 `(Get-Content $f).Count`。
>
> **文件计数**：`index.html`(1) + `agents.md`(1) + `src/` 下 **73** 个（`main.ts` / `App.vue` / `env.d.ts` / `constants.ts` / `assets/main.css` / `components` **8** / `composables` **13** / `utils` **8** / `pages` **39**）= **75**。页面文件数 39 = 注册表 1 + 8 个页面目录（`HomePage` 1 / `AboutPage` 1 / `ContentPage` 7 / `TextTtsPage` 5 / `SubtitlePage` 3 / `HtmlGenPage` 5 / `CastPage` 5 / `VideoPreviewPage` 1 / `SettingsPage` 10）共 38。**注意两处结构变化**：① `SettingsPage` 不再是路由页，改由 `components/SettingsDialog.vue` 以模态弹窗承载（`pages/index.ts` 的注册表刻意没有 `settings`）；② `HtmlGenPage` 的角色库弹窗（`CastLibraryModal.vue` / `CastCreateModal.vue`）已删除，新建 / 修改角色只在「角色」页做，本页只勾选——**§5 里仍保留的旧描述以本节与文末附录为准**。

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
        ③ initRuntime() / initEnvGate() / initLegacyData()
        ④ void restore()                          # 账号：已登录才问一次 account:me；未登录直接返回；
         │                                          #   断网 / 5xx 保留展示态，只有 UNAUTHORIZED 清态
        ⑤ initApp()：
             localStorage[STORAGE_KEY_PROJECT_CTX]（值 'myapp.projectCtx'） → appState.currentName
             → Promise.all([refreshProject(), loadRenderDefaults()])
```

- 当前项目上下文用 `localStorage` 持久化：键名集中在 `src/renderer/src/constants.ts` 的 `STORAGE_KEY_PROJECT_CTX`（值即 `'myapp.projectCtx'`，只存 `{ name }`）。**前缀 `'myapp.'` 故意不跟随品牌名**。
- **登录态同样只存展示字段**：`STORAGE_KEY_AUTH`（`'myapp.auth'`）存 `{ loggedIn, userName, email, expiresAt }` 的 JSON，**不含令牌**——令牌只存在主进程的 `safeStorage` 里（见 [main/account.md](./files/main/account.md)）。localStorage 读失败 / 脏数据一律退回未登录，不让启动路径抛错。
- **品牌文案只有一处来源**：`src/shared/constants.ts`。`App.vue` 标题栏与 `HomePage` 直接 `import`；`index.html` 写占位符，由 `brandHtmlPlugin()` 构建期替换。
- 渲染进度是**全局单例**（`useRenderProgress.ts`），在 `App.vue` 只订阅一次；展示点在 `HtmlGenPage/PreviewSection.vue`。
- 渲染默认档位也是全局单例（`useRenderOptions.ts` 的 `renderDefaults`），由 `App.vue` 启动时与 `refreshProject()` 并行调用 `loadRenderDefaults()` 读入。

### 2.2 导航（无 router）

```ts
// pages/index.ts
export type PageComponentKey = Exclude<PageKey, 'settings'>
export const pages: Record<PageComponentKey, Component> = {
  home: HomePage, about: AboutPage, content: ContentPage, 'text-tts': TextTtsPage,
  subtitle: SubtitlePage, 'html-gen': HtmlGenPage, cast: CastPage, 'video-preview': VideoPreviewPage
}
export const currentPage = shallowRef<Component>(pages.home)
export const pageNavKey = ref(0)

export async function goPage(key: PageKey) {
  // 设置已改为模态弹窗：这里只打开弹窗、直接返回——不切页、不动 activeMenu、不刷新项目
  if (key === 'settings') { openSettings(); return }
  closeSettings()                    // 真正切页时顺手收起设置弹窗
  activeMenu.value = key
  try { await refreshProject() } catch (e) { toast('项目信息刷新失败：' + msg) }  // 刷新失败照切页
  currentPage.value = pages[key]
  pageNavKey.value++                 // 递增 key 强制重挂载
}
```

三个设计要点：

1. **`goPage('settings')` 是唯一的「不切页」分支**：历史调用点（配置类错误的 [去设置]、配音页 / 字幕页的「去设置」）一行不用改——分类意图仍由 `useNavIntent.requestSettingsSection` 传递，弹窗内的 `SettingsPage` 挂载时消费。
2. **`pageNavKey` 作为 `<component :is>` 的 `key`**：递增 key 强制重挂载，恢复「每次进入页面重新加载当前项目」的语义。
3. **组件对象用 `shallowRef`**：避免 Vue 深度代理组件定义。

### 2.3 页面 key 与入口

| PageKey | 组件 | 侧栏菜单 | 说明 |
|---|---|---|---|
| `home` | `HomePage/index.vue` | ✅ 首页 | 启动默认页 |
| `content` | `ContentPage/`（入口 `index.vue` + `SceneEditor.vue` / `AiChatPanel.vue` / `CastPickerModal.vue` / `ScriptRoundCard.vue` / `helpers.ts` / `castPick.ts`） | ✅ 内容脚本 | 流水线起点。两个 Tab：场景编辑（默认，编辑即自动保存）/ AI 创作（对话式生成，结果写回编辑器；对话记录 = 索引 + 每版副本）。**「AI 创作」的角色选择只作提示词上下文**：`CastPickerModal` 只读全局库（`castTools.list`），选中项存 `castPick.ts` 的模块级 `pickedCast`（不落盘、跨 Tab 保留），发送时整份进 `scriptTools.generate` 的 `cast` |
| `text-tts` | `TextTtsPage/index.vue` | ✅ 配音 | 内含三个 Tab：文字生音频 / 字幕配音 / 音色管理 |
| `subtitle` | `SubtitlePage/index.vue` | ✅ 字幕生成 | 含转录弹窗子组件 |
| `html-gen` | `HtmlGenPage/index.vue`（+ `CastSection.vue` / `MaterialsSection.vue` / `ChapterSection.vue` / `PreviewSection.vue`） | ✅ HTML生成 | **一页 5 个文件**：入口只剩状态卡 + 字幕 / 画布下拉 + 全局视觉风格 + 需求描述 + 四个动作按钮 + 转视频弹窗；素材三块按顺序 `<MaterialsSection />` → `<CastSection />`（**角色区现在只勾选 + 「管理角色」跳转**）→ `<ChapterSection />`。**转视频入口与渲染档位仍在此页** |
| `cast` | `CastPage/`（`index.vue` + `CastEditModal.vue` + `CastActionModal.vue` + `CastActionEditor.vue` + `CastDemoShot.vue`） | ✅ 角色 | **全局角色库**（与项目无关）：卡片墙、新建 / 修改角色、动作示范（双击卡片或「…」菜单） |
| `video-preview` | `VideoPreviewPage/index.vue` | ✅ 视频预览 | 流水线终点：纯预览（可选项目播放 / 定位），渲染由 HTML生成页发起 |
| `about` | `AboutPage/index.vue` | ✅ 关于 | 静态页 |
| `settings` | **`components/SettingsDialog.vue`（不是路由页）** | ✅ 设置 | 点菜单 / `goPage('settings')` 只打开全局模态弹窗；正文仍是 `SettingsPage/`（外壳 + 3 个页面级 `.ts` + `components/` 下 6 个区块组件，后 4 项为更新日志弹窗等） |

> 侧栏菜单项在 `App.vue` 中以 `menuItems` 数组声明（**9 项**：首页 / 内容脚本 / 配音 / 字幕生成 / HTML生成 / 角色 / 视频预览 / 关于 / 设置），页面切换后由 `watch(currentPage)` 把 `content` 容器滚动复位。注册表 8 项 + 设置弹窗 1 项 = 菜单 9 项。

---

## 3. 状态与通信约定

| 关注点 | 做法 | 位置 |
|---|---|---|
| 全局项目状态 | 模块级 `reactive` 单例 `appState`（`currentName` / `project` / `myProjects`）；`ProjectState` 含 `materials` 与 `canvas` | `composables/useAppStore.ts` |
| 链路状态 | 5 个 `computed`：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo` | 同上 |
| 项目切换 | `switchProject(name)`：写 `appState.currentName` → `saveProjectCtx()` → `refreshProject()` | 同上 |
| 持久化键名 | 上次项目 `STORAGE_KEY_PROJECT_CTX`、设置页分类 `STORAGE_KEY_SETTINGS_SECTION`、**登录态 `STORAGE_KEY_AUTH`**，都由 `STORAGE_PREFIX` 派生 | `constants.ts`（见 §1） |
| 品牌文案与素材规则 | 中文名 / 英文名 / 口号 + 素材上限与扩展名白名单一律取共享层常量 | `@shared/constants` |
| 后端调用 | 一律 `window.<命名空间>.<方法>()`，结果按 `IpcResult`（`ok` / `message` / `canceled`）分支处理；**账号按 `AccountResult`（`code` + `message`）分支** | 各页面 |
| **登录态（本次新增）** | **模块级 `reactive` 单例 `authState`（只存展示字段）**：`signIn(session)` 用后端昵称（空则邮箱 @ 前部分，再空兜「用户」）；`restore()` 启动问 `/me`，**只在 `UNAUTHORIZED` 清态**（网络错误 / 5xx 保留，离线可用）；`logout()` **异步**（先 `accountTools.logout()` 撤销服务端，再清本地；主进程异常也切回未登录）；持久化到 `localStorage['myapp.auth']`，**不含令牌** | `composables/useAuth.ts` + `components/UserArea.vue` + `components/AuthDialog.vue` |
| **登录 / 注册弹窗** | 模块级单例开关（`visible` / `mode`），`UserArea` 的「登录」直接 `openAuth('login')`；表单校验与账号调用全在 `AuthDialog.vue` + `utils/localAccount.ts`，避免两处状态打架 | `composables/useAuthDialog.ts` |
| 进度推送 | **一条频道 + 按任务 id 分发**：`projectTools.onTaskProgress(taskId, cb)` 返回退订函数，调用方自己生成 id（`utils/taskId.ts`）并先订阅再调用；其余进度频道仍是单订阅 | 各页面 / `App.vue` |
| 提示反馈 | `toast(msg)`（2800ms 自动消失，`App.vue` 用 `TransitionGroup` 渲染） | 全局 |
| 文本输出 | 需拼接 HTML 的场景一律用 `escTxt()` 转义 | `utils/escape.ts` |
| 路径 → URL | 渲染层一律不拼 `file://`：项目内资源经 `previewUrl()`、项目外产物经 `userPathUrl()` / `userFileUrl()`（`hgpreview://user/…?user=1`；认不出白名单目录返回空串 ⇒ 不给试听入口） | `utils/url.ts` |
| 渲染档位 | 项目覆盖 > 全局默认 > 内置默认（`standard` / `30`） | `composables/useRenderOptions.ts` + `utils/render.ts` |
| 成片画布 | **项目属性，不是渲染档位**：三档 `landscape` / `portrait` / `square`，只在「HTML生成」页选一次，落 `project.json` 的 `canvas` | `pages/HtmlGenPage/index.vue` + `utils/render.ts` / `useAppStore.ts` |
| 运行环境状态 / 确认框 | 模块级单例；`initRuntime()` 先订阅再查一次；`useEnvGate` 只在缺包时弹框并记下续做闭包。**三包文案一致**：`vidrender` 标签「Rust 编码内核（vidrender-encode，联调 demo 用）」、体积提示 1 MB；产品默认缺包口径仍是 ffmpeg + hyperframes（`PRODUCT_PACKS`），vidrender 只有显式指定才会下载 | `composables/useRuntime.ts` / `useEnvGate.ts` |
| 配置类错误弹窗 | 模块级单例：主按钮固定「去设置」、**不显示「查看详情」**、余额 / 欠费不弹窗 | `composables/useConfigPrompt.ts` + `App.vue` 宿主 |
| 旧数据提示 | 模块级单例：`initLegacyData()` 问一次 `legacy:status`；`resolve(action)` 回传 | `composables/useLegacyData.ts` + `components/LegacyDataDialog.vue` |
| 跨页导航意图 | 模块级 `ref` 单例：源页置位 → 目标页读取并复位（设置弹窗的分类落点也走它） | `composables/useNavIntent.ts` |
| 设置弹窗 | 模块级 `ref` 单例：`openSettings()` / `closeSettings()`；`goPage('settings')` 只开弹窗不切页，切页时顺手关掉 | `composables/useSettingsDialog.ts` + `components/SettingsDialog.vue` |
| 项目素材库 | 状态真源 = `appState.project.materials`；增删勾选都经 `projectTools.pickMedia / addMaterials / saveMaterials`，每次落盘后 `refreshProject()` | `pages/HtmlGenPage/MaterialsSection.vue` |
| 角色预览 | 只读、不落项目状态：`CastShot.vue` 调 `window.castTools.preview(id, { units, title, uses })` → 用回执的 `rel` 拼 `hgpreview://…?user=1` 交给 iframe；`uses` 必须是普通数组 | `components/CastShot.vue` |
| 角色选择（写稿用） | 只进提示词、零写入：`CastPickerModal` 读全局库、`confirm()` 只回传不缺文件的成员快照；选择落 `castPick.ts` 的模块级 `pickedCast`（不落盘） | `pages/ContentPage/CastPickerModal.vue` + `castPick.ts` + `AiChatPanel.vue` |

---

## 4. 组件分层

| 层 | 成员 | 说明 |
|---|---|---|
| 外壳 | `App.vue` | 自绘标题栏、运行环境横幅（三态）、内联的「下载运行环境」确认框、内联的「配置类错误」弹窗、侧栏菜单、`<component :is>` 页面容器、旧数据弹窗宿主、Toast 宿主、**`<UserArea />`（左下角用户区）**、**`<SettingsDialog />`**、**`<AuthDialog />`**、启动流程 |
| 通用组件 | `components/StepBar.vue`、`NewProjectDialog.vue`、`HfSelect.vue`、`CastShot.vue`、`LegacyDataDialog.vue`、**`SettingsDialog.vue`**、**`UserArea.vue`**、**`AuthDialog.vue`**（**8 个**） | `StepBar` props `page: PageKey`；`NewProjectDialog` 内部闭环 `create → refreshProject → switchProject`；`HfSelect` 全局自绘下拉；`CastShot` 是角色静态预览（8 个 props、无 emits）；**`SettingsDialog` 只负责「设置弹窗什么时候出现、怎么关」，正文是 `SettingsPage`**；**`UserArea` 是左下角用户区（登录 / 退出登录的唯一入口）**；**`AuthDialog` 是登录 / 注册弹窗（含验证码行与开发模式回显）**；`LegacyDataDialog` 无 props / 无 emits |
| 页面 | `pages/<PageName>/index.vue`（8 个组件页 + **设置弹窗**） | 一页一目录，`onMounted` 拉取当前项目数据；`settings` 不是页面，由 `SettingsDialog` 承载 |
| 页面子组件 | `SettingsPage/components/{ModelSection,VoiceSection,RenderSection,WhisperSection,UpdateSection,ChangelogDialog}.vue`、`SubtitlePage/TranscribeSection.vue`、`TextTtsPage/{SynthSection,AlignSection,VoiceSection}.vue`、`HtmlGenPage/{CastSection,ChapterSection,MaterialsSection,PreviewSection}.vue`、`CastPage/{CastEditModal,CastActionModal,CastActionEditor,CastDemoShot}.vue`、`ContentPage/{SceneEditor,AiChatPanel,CastPickerModal,ScriptRoundCard}.vue` | 由所属页面承载；`HtmlGenPage` 的四个子组件：`MaterialsSection` 无 props / 无 emits，`PreviewSection` 5 个 props + `defineExpose({ reload })`，`ChapterSection` 只读章节列表，**`CastSection` 只做勾选 + 「管理角色」跳转**（角色库弹窗已删除） |
| 页面助手 | `SubtitlePage/helpers.ts`、`TextTtsPage/helpers.ts`、`ContentPage/helpers.ts`、`ContentPage/castPick.ts`、`SettingsPage/helpers.ts` | 模块级共享纯逻辑与类型，被同目录的多个组件复用 |
| 基础设施与常量 | `composables/*`（**13 个**）、`utils/*`（**8 个**）、`constants.ts` | 全局状态、Toast、渲染进度、运行环境状态与确认框、配置类错误弹窗、旧数据提示、渲染档位、项目状态条派生、**登录态镜像 / 登录弹窗 / 设置弹窗**、语速、转义、任务 id、时间、路径 → URL、随包 CHANGELOG 解析、**账号纯校验与转发**；`constants.ts` 只放渲染层自己的约定（`localStorage` 键名 + 模型预设表） |

---

## 5. 页面 ↔ 主进程域对照

| 页面 | 主要交互 | 涉及的主进程域（preload 命名空间） |
|---|---|---|
| HomePage | 项目列表与进度标记、切换项目、跳转各节点 | `projectTools` |
| AboutPage | 纯静态 | — |
| ContentPage（7 个文件） | 两个 Tab（场景编辑 / AI 创作）；场景编辑即自动保存；AI 创作调 `scriptTools.generate`（载荷带 `cast`）+ `scriptTools.onProgress`；对话记录经 `scriptTools.loadChat / appendRound / readVersion / setActiveVersion / clearChat`；角色选择弹窗只读全局库 | `projectTools`（`saveContent` / `load`）、**`castTools.list`（经 `CastPickerModal`）**、**`scriptTools`** |
| TextTtsPage | 三个子卡：文字合成 / 逐句对齐 / 音色管理 | `voiceTools`、`projectTools`、`useEnvGate`、`useConfigPrompt` |
| SubtitlePage | 字幕条目编辑、SRT 导出、由脚本旁白生成、保存；转录弹窗 | `projectTools`、`whisperTools` |
| HtmlGenPage（5 个文件） | 生成 / 修改 HTML、下载、预览、素材库、**角色区只勾选（`saveCast`）+「管理角色」跳转**、转视频、背景音频；**账号无交互** | `projectTools`（`generateHtml` / `modifyHtml` / `downloadHtml` / `previewHtml` / `pickMedia` / `addMaterials` / `saveMaterials` / `pickAudio` / `setAudio` / `clearAudio` / `saveVideo` / `setRender` / `setCanvas` / `saveCast` / `onTaskProgress`）、`hfTools`（`renderVideo`）、`voiceTools`（`listGenerated`）、`castTools.preview`（经 `CastShot`）、`useEnvGate`、`useConfigPrompt` |
| CastPage（5 个文件） | 全局角色库：列库 / 新建 / 修改（保存元数据 / 按这个要求重画）/ 删除 / 静态预览 / 动作示范（列 / 存 / 删 / AI 生成 / 示范页） | `castTools`（`list` / `create` / `recreate` / `saveMeta` / `remove` / `preview` / `listActions` / `saveAction` / `removeAction` / `generateAction` / `demo` / `onTaskProgress`）、`projectTools`（`onTaskProgress` 共用的任务进度） |
| VideoPreviewPage | 可选项目成品预览、在文件夹中显示；不发起渲染、不切工作项目 | `projectTools`（经 `refreshProject` 与 `load`）、`hfTools`（`showInFolder`） |
| **全局 · 用户区 / 登录弹窗（本次新增）** | 左下角 `UserArea`：登录态展示（姓名 / 邮箱 / 首字头像）+ 浮窗第二项（未登录「登录」→ `AuthDialog`；已登录「退出登录」→ `logout()`）；`AuthDialog`：登录 / 注册（邮箱验证码 + 倒计时 + 开发模式回显）、注册成功即登录 | **`accountTools`**（`sendCode` / `register` / `login` / `me` / `logout`）；**只回展示字段，令牌不出主进程** |
| **全局 · 设置弹窗** | 5 类配置（模型 / 语音 / 渲染 / 语音识别 / 应用更新）；`ModelSection` 的「测试连接」刻意不弹配置类弹窗 | `settingsTools`（含 `pickRuntimePack`）、`voiceTools`、`updateTools`、`runtimeTools`、`whisperTools` |

> 具体方法名与参数见 [files/renderer/](./files/renderer/) 下的文档（`HtmlGenPage.md` / `CastPage.md` 等仍是更早快照，见 §0/文末附录）；频道 ↔ 命名空间总表见 [01-架构总览 §3.3](./01-架构总览.md)。

---

## 6. 样式策略

- **全局设计系统**：`assets/main.css`（**当前实测 2701 行**）承载根变量、标题栏、布局、菜单、卡片、按钮、表单、表格、`step-bar` 以及各页面专有样式；由 `main.ts` 全局导入。其中 `html, body` 另设**全局基准字号 `font-size: 14px`**。视觉规范写在 `src/renderer/agents.md`。
- **本次账号相关新增的样式节**：登录 / 注册弹窗的 `.auth-*`（`.auth-modal` / `.auth-body` / `.auth-tabs` / `.auth-tab` / `.auth-form` / `.auth-field` / `.auth-label` / `.auth-input` / `.auth-pwd` / `.auth-eye` / **`.auth-code`（验证码输入框 + 发送按钮同一行）** / **`.auth-code-send`（发送按钮，带 disabled 态）** / **`.auth-devcode`（开发模式验证码回显）** / `.auth-strength*` / `.auth-hint` / `.auth-error` / `.auth-submit` / `.auth-note`），使用方只有 `components/AuthDialog.vue`。用户区的样式在 `.user-area*` 一族（`UserArea.vue`）。
- **组件补充**：带 `<style>` 块的 `.vue` 仍是少数（`App.vue`、`components/HfSelect.vue`、`components/LegacyDataDialog.vue`、`ContentPage/` 的三个组件等）；**`AuthDialog.vue` / `UserArea.vue` / `SettingsDialog.vue` / `CastShot.vue` 不含样式块**，完全依赖 `main.css` 的类名（`.auth-*` / `.user-*` / `.settings-modal*`）。**唯一例外是启动画面**（`index.html` 的内联 `<style>`）。
- 主题通过 CSS 变量切换；若要加亮色模式只需在 `:root[data-theme="light"]` 覆盖变量。

---

## 7. 注意事项

1. **不要引入 vue-router / pinia**：`goPage` 的「先 refreshProject 再渲染」副作用与 `pageNavKey` 重挂载语义是刻意保留的旧行为等价物；**设置已不是页面**（`goPage('settings')` 只开弹窗），注册表里刻意没有 `settings`。
2. **别把进度订阅简化成「页面里注册一次」**：`project:html-progress` 是**一条频道 + 按 `taskId` 分发**（`onTaskProgress(taskId, cb)` 返回退订函数，调用方在 `finally` 里 `off()`）；其余进度频道仍是单订阅语义。全局渲染进度只在 `App.vue` 注册一次；`runtime:progress` 全渲染层只有 `useRuntime.ts` 一处注册。
3. **登录态只存展示字段**：`useAuth` 的 `authState` 里**没有 token**，也**不要加**——令牌在主进程 `safeStorage`。`restore()` 只在 `UNAUTHORIZED` 清态，网络错误保留（离线可用）；`logout()` 是异步的（先撤销服务端会话），调用点要 `void logout()`。
4. **未登录不得 gate 任何功能**：不要因为 `isLoggedIn === false` 就禁用生成 / 转录 / 配音 / 转视频；账号只服务云端能力。
5. **文档级监听要成对**：`AuthDialog.vue` / `SettingsDialog.vue` 的 `keydown` 监听与 `AuthDialog` 的倒计时定时器都在 `onBeforeUnmount` 清理；`HtmlGenPage/PreviewSection.vue` 的 `message` / `resize` 监听同样成对。
6. **项目只有「我的项目」一种形态**：项目都是 `userData/projects/<项目名>/` 下的普通目录，各页面不需要只读守卫。
7. **CSP 禁止运行时模板编译**：SFC 全部预编译，不要使用 `Vue.compile` / 字符串模板；`img-src` / `media-src` / `frame-src` 放行 `hgpreview:`。
8. **唯一的同步 IPC 在设置页**：`updateTools.version()` 是 `sendSync`，调用点只在 `SettingsPage/components/UpdateSection.vue` 的 `onMounted` 且包在 `try` 中。
9. **两类字符串归属不同**：品牌文案与素材白名单取 `@shared/constants`；`localStorage` 键名取 `@renderer/constants`（**故意不跟随品牌改名**）。
10. **改代码前先看更新日志、改完必记一条**：与根 `AGENTS.md` 关键约定 3、4 一致。
11. **素材列表要过结构化克隆**：`appState.project.materials` 的元素是 Vue `Proxy`，直接 `invoke` 会抛 `DataCloneError`；写素材的代码必须先铺平成普通对象（`plainList()`）。
12. **渲染层不再拼 `file://`**：路径 → URL 只有 `utils/url.ts` 的三个出口（`previewUrl()` / `userPathUrl()` / `userFileUrl()`），都**逐段 `encodeURIComponent`**；`userPathUrl()` 认不出白名单目录时返回**空串**。
13. **预览的「时长不可信」是一条只读回执**：主进程注入脚本把超长时长降级为 `{ dur: 0, unknown: true }`，`PreviewSection.vue` 只映射成 `prevDurUnknown`（`--:--` + 一行说明），**不新增 IPC 频道**。
14. **vidrender 只是第三包文案，不是新的产品交互**：`useRuntime` 的初始 `status` 与 `PACK_LABEL`、`useEnvGate` 的 `LABEL` / `HINT_MB` 都补了 `vidrender`（1 MB，标注「联调 demo 用 / 只有显式指定时才下载」）；主进程的 `PRODUCT_PACKS` 已把它排除出默认缺包提示，因此界面不会主动提示下载它，`video.ts` 链路也未改。

---

## 8. 相关文档

- 说明文档：[files/renderer/](./files/renderer/)（每页一篇 / `assets.md`、`components.md` 目录级各一篇 / `common.md` 公共方法与工具一篇 / 其余文件级各一篇）
- 共享层（品牌文案、素材规则与 IPC 契约）：[05-目录架构-src-shared.md](./05-目录架构-src-shared.md)
- 桥接层与命名空间：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 账号域（主进程）：[main/account.md](./files/main/account.md)
- 状态与数据流全景：[01-架构总览.md](./01-架构总览.md) 第 4 节

## 附录 · 角色、设置与账号的现状（与上文冲突时以本节为准）

- **页面 8 个组件页 + 1 个设置弹窗**：注册表 `pages/index.ts`（68 行）里 `pages` = `home / about / content / text-tts / subtitle / html-gen / cast / video-preview`，`PageComponentKey = Exclude<PageKey, 'settings'>`；`cast: CastPage` 插在 `'html-gen'` 与 `'video-preview'` 之间；设置由 `components/SettingsDialog.vue`（43 行）承载，`goPage('settings')` 直接 `openSettings()` 并返回。`App.vue`（350 行）的菜单数组 9 项（含 `{ key: 'cast', label: '角色' }` 与 `{ key: 'settings', label: '设置' }`）。
- **页面目录** `src/renderer/src/pages/CastPage/`（**5 个文件 / 合计 1221 行**）：`index.vue` 180 / `CastEditModal.vue` 319 / `CastActionModal.vue` 375 / `CastActionEditor.vue` 262 / `CastDemoShot.vue` 85。`CastMetaModal.vue`（旧「改信息」弹窗）已删除，职责并入 `CastEditModal.vue`。
- **账号（本次新增）**：`composables/useAuth.ts`（125 行，登录态镜像 + `restore()` + 异步 `logout()`）、`composables/useAuthDialog.ts`（27 行，弹窗单例）、`utils/localAccount.ts`（111 行，纯校验 + `accountApi` 转发）、`components/AuthDialog.vue`（364 行，登录 / 注册 + 验证码行 + 倒计时 + 开发模式 `devCode` 回显）、`components/UserArea.vue`（115 行，用户区 · 登录 / 退出）。`constants.ts`（62 行）删掉 `STORAGE_KEY_ACCOUNTS`、新增 `STORAGE_KEY_AUTH`（**只存展示字段、不含令牌**）；`App.vue` 的 `onMounted` 新增 `void restore()` 并挂 `<AuthDialog />`；`assets/main.css`（2701 行）新增 `.auth-code` / `.auth-code-send` / `.auth-devcode` 等验证码行样式。**未登录时全部本机功能照常可用**。
- **`pages/HtmlGenPage/`**：现为 **5 个文件**（`index.vue` 477 / `CastSection.vue` 118 / `ChapterSection.vue` 71 / `MaterialsSection.vue` 167 / `PreviewSection.vue` 470）；**`CastCreateModal.vue` 与 `CastLibraryModal.vue` 已删除**，`CastSection.vue` 只剩勾选 + 「管理角色」跳转（正文 §5 里提到的 `listCastLibrary` / `importCast` / `newCast` / `promoteCast` 均已不存在，现行方法名见 §1 与 01 的频道总表）。
- **`components/CastShot.vue`（77 行）**：props `id / units / title? / uses? / epoch? / big?`，内部调 `window.castTools.preview(id, { units, title, uses })` → `userFileUrl(res.rel) + '&e=' + epoch`；`uses` 必须是普通数组。`CastDemoShot.vue`（85 行）同理。
- **`utils/url.ts`（65 行）**：`previewUrl` / `userPathUrl` / `userFileUrl`；白名单常量 `USER_DIRS = ['tts-output','voice','cast-preview']`。
- **`assets/main.css`（2701 行）**：角色 / 素材 / 章节 / 账号各节的现状见 [assets.md](./files/renderer/src/assets.md)（该篇也是更早快照，行数已变）。
