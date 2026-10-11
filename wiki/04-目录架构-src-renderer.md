# 04 · 目录架构：`src/renderer/`（渲染层）

> Vue 3 + TypeScript 的界面层，共 31 个文件（外壳 1 + 入口 3 + 样式 1 + 通用组件 1 + 基础设施 8 + 页面 9（一页一目录，入口统一 `index.vue`） + 页面子组件 4 + 页面助手 2 + 注册表 1 + 设计规范 1）。刻意**不引入** vue-router 与 pinia：导航是一个注册表 + `goPage()` 函数，全局状态是模块级 `reactive` 单例。所有系统能力都经 `window.*`（preload 桥）访问。

---

## 1. 文件清单

```
src/renderer/
├─ index.html                    # 12 行   HTML 宿主：#app + CSP meta + 模块入口
├─ agents.md                     # 125 行   科技主题（Cyber UI / 深空科技）设计规范正文（自 pages/ 上提到 renderer/ 层）
└─ src/
   ├─ main.ts                    #   6 行   createApp + 挂载 + 导入全局 CSS
   ├─ App.vue                    # 154 行   外壳：标题栏 + 侧栏菜单 + 页面容器 + Toast + 启动流程
   ├─ env.d.ts                   #   8 行   .vue 等模块类型补丁
   ├─ assets/
   │  └─ main.css                # 1363 行   全局设计系统（深空科技主题）
   ├─ components/
   │  └─ StepBar.vue             # 104 行   五节点链路状态条 + 工作项目切换器
   ├─ composables/
   │  ├─ useAppStore.ts          # 138 行   全局项目状态单例（appState / has* / refreshProject；含项目级渲染档位覆盖）
   │  ├─ useToast.ts             #  22 行   轻提示
   │  ├─ useRenderProgress.ts    #  56 行   HyperFrames 渲染进度解析（含阶段中文名表）
   │  └─ useRenderOptions.ts     #  41 行   渲染档位：全局默认载入 / 生效档位 / 项目级覆盖写入
   ├─ utils/
   │  ├─ escape.ts               #   4 行   escTxt 文本转义
   │  ├─ rate.ts                 #  21 行   语速控件（0.5~2.0）
   │  ├─ time.ts                 #  15 行   fmtTime / fmtTimeMs
   │  └─ render.ts               #  55 行   渲染档位选项表与纯函数（pickRenderOverride / resolveRenderOptions …）
   └─ pages/                     # 一个页面一个文件夹，入口统一 index.vue
      ├─ index.ts                #  41 行   页面注册表 + goPage 路由（归属「公共方法与工具」一篇）
      ├─ HomePage/
      │  └─ index.vue            # 121 行   首页（hero + 流水线 + 项目卡片）
      ├─ AboutPage/
      │  └─ index.vue            #  18 行   关于（静态）
      ├─ ContentPage/
      │  └─ index.vue            # 110 行   内容脚本
      ├─ TextTtsPage/
      │  ├─ index.vue            #  28 行   配音页外壳（Tab）
      │  ├─ SynthSection.vue     # 357 行   文字生音频卡
      │  ├─ AlignSection.vue     # 291 行   字幕配音（逐句对齐）卡
      │  └─ helpers.ts           # 116 行   配音助手（音色载入/分组/校验）
      ├─ SubtitlePage/
      │  ├─ index.vue            # 259 行   字幕条目编辑
      │  ├─ TranscribeSection.vue# 345 行   转录弹窗
      │  └─ helpers.ts           # 165 行   字幕助手（估时、条目类型等）
      ├─ HtmlGenPage/
      │  └─ index.vue            # 586 行   HTML 生成 / 修改 + 预览 + 转视频（含渲染档位）
      ├─ VideoPreviewPage/
      │  └─ index.vue            # 199 行   视频预览（成品播放 / 定位；内置示例预览 + 试渲染）
      ├─ SoundCopyPage/
      │  └─ index.vue            # 308 行   音色管理
      └─ SettingsPage/
         ├─ index.vue            # 208 行   设置（含渲染默认档位）
         └─ WhisperSection.vue   # 274 行   语音识别模型管理区块
```

---

## 2. 启动与导航

### 2.1 启动链路

```
index.html（CSP meta + <div id="app">）
  → main.ts：createApp(App).mount('#app') + import './assets/main.css'
     → App.vue onMounted：
        ① window.windowControls.onMaximizedChange(v => isMaximized = v)
        ② initRenderProgress()                    # 全局订阅 video:progress（单订阅语义）
        ③ initApp()：
             localStorage['myapp.projectCtx'] → appState.currentName / isBuiltin
             → Promise.all([refreshProject(), loadRenderDefaults()])
                                                    # 项目列表（project:list + video:list-projects + project:load）
                                                    # + 渲染默认档位（settings.json 的 render 段）
             → goPage('home')
```

- 当前项目上下文用 `localStorage` 持久化（key `'myapp.projectCtx'`，结构 `{ name, builtin }`）；prod 下 `loadFile(file://)` 同源，故重启自动延续。
- 渲染进度是**全局单例**（`useRenderProgress.ts`），在 `App.vue` 只订阅一次；发起渲染的 `HtmlGenPage` 与预览侧的 `VideoPreviewPage` 挂载时都调用 `resetRenderProgress()` 复位。
- 渲染默认档位也是全局单例（`useRenderOptions.ts` 的 `renderDefaults`），由 `App.vue` 启动时与 `refreshProject()` 并行调用 `loadRenderDefaults()` 读入 `settings.json` 的 `render` 段。

### 2.2 导航（无 router）

```ts
// pages/index.ts
export const pages: Record<PageKey, Component> = { home, about, content, 'text-tts', subtitle, 'html-gen', 'video-preview', 'sound-copy', settings }
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
| `text-tts` | `TextTtsPage/index.vue` | ✅ 配音 | 内含「合成 / 对齐」两卡 |
| `sound-copy` | `SoundCopyPage/index.vue` | ✖ | 音色管理，由其它页面（配音页）跳转进入；在 StepBar 中与 `text-tts` 同属「配音」节点 |
| `subtitle` | `SubtitlePage/index.vue` | ✅ 字幕生成 | 含转录弹窗子组件 |
| `html-gen` | `HtmlGenPage/index.vue` | ✅ HTML生成 | 最复杂页面；**转视频入口与渲染档位在此** |
| `video-preview` | `VideoPreviewPage/index.vue` | ✅ 视频预览 | 流水线终点：成品播放 / 定位（内置示例可预览 + 试渲染） |
| `about` | `AboutPage/index.vue` | ✅ 关于 | 静态页 |
| `settings` | `SettingsPage/index.vue` | ✅ 设置 | 含 WhisperSection 子组件 |

> 侧栏菜单项在 `App.vue` 中以 `menuItems` 数组声明（8 项，不含 `sound-copy`），点击调用 `goPage(item.key)`；页面切换后由 `watch(currentPage)` 把 `content` 容器滚动复位。

---

## 3. 状态与通信约定

| 关注点 | 做法 | 位置 |
|---|---|---|
| 全局项目状态 | 模块级 `reactive` 单例 `appState`（`currentName` / `isBuiltin` / `project` / `myProjects` / `builtinProjects`） | `composables/useAppStore.ts` |
| 链路状态 | 5 个 `computed`：`hasContent` / `hasAudio` / `hasSubtitle` / `hasHtml` / `hasVideo`，其中前 4 个要求 `!isBuiltin`（内置示例不算「已生成」），`hasVideo` 只看 `videoExists`（内置映射里恒为 `false`） | 同上 |
| 项目切换 | `switchProject(name, isBuiltin)`：写 `appState` → `saveProjectCtx()` → `refreshProject()` | 同上 |
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
| 外壳 | `App.vue` | 自绘标题栏（hidden titleBarStyle，经 `windowControls`）、侧栏菜单、`<component :is>` 页面容器、Toast 宿主、启动流程 |
| 通用组件 | `components/StepBar.vue` | props `page: PageKey`；第一行五节点链路（点击跳转），第二行「工作项目」切换器 + 新建项目 + 打开目录。**旧版 `[data-slot]` 注入机制已废弃**，各页面在模板顶部放 `<StepBar :page="'xxx'"/>` 即等效 |
| 页面 | `pages/<PageName>/index.vue`（9 个，一个页面一个文件夹） | 一页一目录，`onMounted` 拉取当前项目数据 |
| 页面子组件 | `SettingsPage/WhisperSection.vue`、`SubtitlePage/TranscribeSection.vue`、`TextTtsPage/SynthSection.vue`、`TextTtsPage/AlignSection.vue` | 由所属页面承载（与入口 `index.vue` 同目录）；原 `window.__settings` / `window.__sub` / ctx 共享做法改为 props / `ref` 显式调用 |
| 页面助手 | `SubtitlePage/helpers.ts`、`TextTtsPage/helpers.ts` | 模块级共享纯逻辑与类型（估时、音色分组/解析/校验），被同目录的多个组件复用 |
| 基础设施 | `composables/*`、`utils/*` | 全局状态、Toast、渲染进度、渲染档位、语速、转义、时间 |

---

## 5. 页面 ↔ 主进程域对照

| 页面 | 主要交互 | 涉及的主进程域（preload 命名空间） |
|---|---|---|
| HomePage | 项目列表与进度标记、新建/切换项目、跳转各节点 | `projectTools`、`hfTools` |
| AboutPage | 纯静态 | — |
| ContentPage | 编辑并保存内容脚本（style + scenes） | `projectTools` |
| TextTtsPage | 壳：Tab 切换两个子卡 | — |
| ├ SynthSection | 音色/模型选择、文字合成、试听、设为背景音频、已生成音频列表 | `voiceTools`、`projectTools` |
| └ AlignSection | 逐句对齐（模式 A/B）、进度与取消、结果写回字幕与音频 | `voiceTools`、`projectTools` |
| SubtitlePage | 字幕条目编辑、SRT 写入方式、复制、导出、由脚本旁白生成、保存 | `projectTools` |
| └ TranscribeSection | 选音频与语言、转录、进度、结果替换/追加 | `whisperTools` |
| HtmlGenPage | 提示词生成/修改 HTML、预览、下载、AI 思考过程、**转视频（含档位）** | `projectTools`（`onHtmlProgress`、`saveVideo`、`setRender`）、`hfTools`（`renderVideo`）、全局 `renderProgress` / `renderDefaults` |
| VideoPreviewPage | 播放 / 定位项目成品 MP4；内置示例的 HTML 预览与试渲染 | `projectTools`、`hfTools`（`previewShell` / `renderVideo` / `showInFolder`）、全局 `renderProgress` |
| SoundCopyPage | 创建克隆音色、云端/系统音色列表、本地显示名与绑定模型 | `voiceTools` |
| SettingsPage | 自定义模型（含测试连接）、千问语音配置 | `settingsTools`、`voiceTools` |
| └ WhisperSection | 识别模型下载/删除/设为当前、自定义模型管理、占用统计 | `whisperTools` |

> 具体方法名与参数见 [files/renderer/](./files/renderer/) 下的页面 / 组件 / 公共方法文档（每页一篇，页面自己的子组件与助手并入该篇）；频道 ↔ 命名空间总表见 [01-架构总览 §3.3](./01-架构总览.md)。

---

## 6. 样式策略

- **全局设计系统**：`assets/main.css`（1363 行）承载根变量、标题栏、布局、菜单、卡片、按钮、表单、表格、`step-bar` 以及各页面专有样式（按源码注释可划分为约 30 个样式节）；由 `main.ts` 全局导入。视觉规范（配色、辉光、字号、间距、圆角）写在 `src/renderer/agents.md`（科技主题设计规范，已随渲染层代码上提到 `renderer/` 层；根目录 `agents.md` 只是指向它的指针）。
- **组件补充**：经核查，全部 `.vue` 中**只有 `App.vue` 带 `<style scoped>`**（Toast 宿主 `.toast-host` / `.toast-item`），其余页面/组件不含样式块，完全依赖 `main.css` 的类名。新增样式时优先在 `main.css` 内按节追加，保持设计系统集中。
- 主题通过 CSS 变量（`--bg-primary`、`--color-primary`、`--text-secondary`、`--glow-*`、`--radius-*` 等）切换，若要加亮色模式只需在 `:root[data-theme="light"]` 覆盖变量。

---

## 7. 注意事项

1. **不要引入 vue-router / pinia**：现有 `goPage` 的「先 refreshProject 再渲染」副作用与 `pageNavKey` 重挂载语义是刻意保留的旧行为等价物，替换会引入回归风险。
2. **进度订阅不要在页面外注册多次**：preload 是单订阅语义（重复注册只替换回调），在 `onMounted` 注册一次即可；全局渲染进度只在 `App.vue` 注册一次。
3. **文档级监听要成对**：`HtmlGenPage` 的 `message` 监听、`TranscribeSection` 的 ESC 监听都改为 `onMounted` / `onBeforeUnmount` 成对注册，不要再用模块级 once-guard。
4. **内置示例只读**：所有编辑型操作前都要判 `appState.isBuiltin` 并提示用户切换到「我的项目」；`has*` computed 对内置示例恒为 false。
5. **CSP 禁止运行时模板编译**：SFC 全部预编译，不要使用 `Vue.compile` / 字符串模板。

---

## 8. 相关文档

- 说明文档：[files/renderer/](./files/renderer/)（每页一篇 / 组件一篇 / 公共方法与工具一篇）
- 桥接层与命名空间：[03-目录架构-src-preload.md](./03-目录架构-src-preload.md)
- 状态与数据流全景：[01-架构总览.md](./01-架构总览.md) 第 4 节
