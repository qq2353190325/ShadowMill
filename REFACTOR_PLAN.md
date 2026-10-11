# Vue3 + electron-vite + TypeScript 全面重构计划（MarvisStudio）

## Context

现状：Electron 31.7.7 应用，全项目 CJS 无打包器。渲染层为 vanilla JS（`src/index.html` 22 个 script 严格顺序加载 + `window.App` 外壳 + 9 页面注册表模式，约 3.5k 行 + 1341 行全局 CSS）；主进程 9 个 CJS 模块 + preload 8 个 contextBridge 命名空间；`loadFile` 直载源码。

目标：迁移到 electron-vite 5 + Vue 3 + **全面 TypeScript**（渲染层 SFC、主进程、preload 全转 TS），功能与 IPC 契约不变，打包体积不变（大头在 resources 二进制 726M，与前端无关）。用户已确认全面转 TS。

约束：不启动应用验证界面；验证靠静态检查（typecheck / build），界面由用户手动确认。

## 关键决策（已核实）

| 决策 | 理由 |
|---|---|
| electron-vite ^5 + vite ^7 + @vitejs/plugin-vue ^6 + vue ^3.5；**typescript 保留 ^7.0.2**（npm 当前稳定版，已装） | 版本实测兼容；TS7 与 vue-tsc 兼容性风险高 → **不引入 vue-tsc**，SFC 语法由 plugin-vue 构建兜底，typecheck 用 `tsc --noEmit` |
| **不加 `"type": "module"`** → main/preload 输出 CJS | Electron 31 sandboxed preload 必须 CJS，这是零配置最稳路径 |
| 不引入 vue-router/pinia：保留注册表 + `goPage()`；状态用模块级 `reactive` 单例 | goPage 有"先 refreshProject 再渲染"副作用，函数式更直观；全局仅一份项目上下文，单例足够 |
| `externalizeDepsPlugin()`（main/preload） | `openai`/`opencc-js` 保持运行时 require 语义，打包后经 files 白名单随 asar 携带 |
| CSS 整体搬移为全局 `assets/main.css`，不按页拆分 | 1341 行是已验证设计系统，拆分引入无收益回归风险；新组件按需 scoped |
| CSP 保留 meta，追加 `connect-src 'self' ws://localhost:5173`；严禁运行时模板编译 | dev HMR 需要 ws；SFC 全预编译则无需 'unsafe-eval' |
| localStorage key `myapp.projectCtx` 与结构不变 | prod 仍 loadFile(file://) 同源 → 用户项目上下文自动延续 |
| IPC 线上载荷格式**一个字节不改**；频道名上移 `src/shared/ipc.ts` 常量 | preload 8 命名空间约 60 方法是渲染层唯一依赖面 |

## 目标目录树

```
E:\my
├─ package.json                # main→out/main/index.js；files/scripts 重写
├─ electron.vite.config.ts     # 新增：main/preload externalize；renderer base:'./' + vue() + 别名 @renderer/@shared
├─ tsconfig.json               # solution 根（references）＋ tsconfig.{node,web,agent}.json
├─ video-projects/ resources/  # 完全不动（asar 根 / extraResources）
└─ src/
   ├─ main/                    # *.ts ×10：index.ts(入口) + vad.ts(新增) + 原 9 模块
   ├─ preload/index.ts + index.d.ts   # 8 命名空间逐字搬运 + Window 全局类型
   ├─ shared/{ipc.ts,types.ts}        # 频道常量 + 域类型（Settings/Project/进度载荷…）
   ├─ renderer/
   │  ├─ index.html            # 移入，body 只留 #app
   │  └─ src/
   │     ├─ main.ts / App.vue  # 标题栏+侧边栏+<component :is>+ToastHost+全局 progress 订阅
   │     ├─ assets/main.css    # ← 原 renderer.css 原样
   │     ├─ composables/{useAppStore,useToast,renderProgress,rate}.ts
   │     ├─ utils/{escape,time}.ts
   │     ├─ components/StepBar.vue
   │     └─ pages/  # 9 SFC + 4 子组件（WhisperSection/TranscribeSection/SynthSection/AlignSection）
   └─ agent/                   # 独立 ESM 实验，完全不动、不进构建图
```

删除清单（迁移完成时）：`src/main.js`、`src/preload.js`、`src/index.html`、`src/renderer.css`、`src/renderer/{app.js,entry.js}`、`src/renderer/pages/**` 全部（含 8 个死单体 `pages/*.js` + 现行 template/index 树）、`src/main/*.js` 9 个。

## 每阶段硬性完成标准（用户确认，不可跳过）

**全部修改完成后，每个 Phase 必须跑完静态门禁且全部通过，才允许进入下一 Phase：**

```
npm run typecheck            # 三项目 tsc --noEmit 全过
npx electron-vite build      # 三端构建成功
```

任一不通过 → 修复至通过为止，不得带着红门禁进入下一阶段。

## 分阶段实施

### Phase 0 — 基线清理（无行为变化）
1. 删 8 个死文件 `src/renderer/pages/{home,content,htmlGen,settings,soundCopy,subtitle,textTts,video}.js`（已确认零引用）。
2. `.gitignore` 追加 `out/`。
3. 检查：grep 无残留引用；提交基线。

### Phase 1 — 工具链脚手架（旧 app 仍可运行）
1. `npm i -D electron-vite@^5 vite@^7 @vitejs/plugin-vue@^6`；`npm i vue@^3.5`。
2. 写 `electron.vite.config.ts`（main/preload: externalizeDepsPlugin；renderer: base './' + vue() + 别名）。
3. tsconfig 布局：solution 根 references → `tsconfig.node.json`（electron.vite.config + src/main + src/preload + src/shared，types:["node"]）、`tsconfig.web.json`（src/renderer/src + preload/index.d.ts + src/shared，lib DOM）、`tsconfig.agent.json`（src/agent）。公共：strict、ESNext、Bundler、skipLibCheck。typecheck 脚本用 `tsc --noEmit -p xxx --composite false` 分别跑（不依赖 tsc -b，规避 TS7 composite 差异）。
4. 建 `src/shared/{ipc.ts,types.ts}`；最小骨架：renderer index.html + main.ts + 占位 App.vue；`src/main/index.ts` 临时占位（仅窗口生命周期 + `ELECTRON_RENDERER_URL` 分支 + preload 路径）。
5. scripts：`dev: electron-vite dev`、`build: electron-vite build`、`typecheck`（三项目）。
6. 门禁：typecheck 过；build 产出 out/ 三端；`node --check out/preload/index.js` 确认 CJS。旧 `npm start` 不受影响（main 字段未改）。

### Phase 2 — VAD 抽取（先于 whisper 转 TS）
1. 新建 `src/main/vad.ts`：从 `whisper.js` 逐字搬 `readWavSamples`/`vadTrimSegments`（`toVadSamples` 留 whisper，它依赖 hfEnv.ffmpeg+userData）。零依赖、只用类型标注（erasable-only）。
2. 检查：typecheck 过。

### Phase 3 — 主进程全量转 TS
顺序（叶子先行）：settings → hfEnv → systemVoices → htmlAgent → projects → voice → ttsAlign → video → whisper（内嵌 VAD 改 import vad.ts）→ index.ts（完整装配，替换占位）。每转完删对应 .js。

机械转换：`require → import`、`module.exports → export`；`register(ctx)` 保留并类型化；settings.ts 删 `requireOpenAI()` 改静态 `import OpenAI from 'openai'`（获 SDK 类型，fetch 兜底逻辑保留）；whisper.ts 懒加载改 `const OpenCC = require('opencc-js') as any`（保持懒加载语义）。IPC 契约上移 shared 常量/类型，载荷格式不变。大型模块（projects 708L、whisper 757L）允许针对性 any 保持 diff 机械。

**四处路径修复**：
1. `index.ts` preload → `path.join(__dirname,'../preload/index.js')`；加载分支 `ELECTRON_RENDERER_URL ? loadURL : loadFile('../renderer/index.html')`。
2. `hfEnv.ts` dev 资源根 → `app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(),'resources')`。
3. `hfEnv.ts` 删机器相关 `E:\my\node_modules\hyperframes` 回退。
4. `video.ts` 内置项目根 → `path.join(app.getAppPath(),'video-projects')`（dev=项目根，打包=asar 根，均命中）。whisper `resolveCliPath` 已用 getAppPath，不动。

检查：typecheck + build 通过。

### Phase 4 — preload 转 TS + Window 全局类型
1. `src/preload/index.ts`：8 命名空间 + 4 个单订阅标志逐字搬运，频道名引 `IPC.*`。
2. `src/preload/index.d.ts`：`declare global Window` 全量类型（被 tsconfig.web include，渲染层获得 IPC 类型）。
3. 删 `src/preload.js`。门禁：typecheck + build + `node --check out/preload/index.js` 无 ESM 残留。

### Phase 5 — renderer 骨架（壳+基础设施，9 页占位）
1. `main.css` ← renderer.css 原样；`main.ts`：createApp + initApp()（App.init 移植）。
2. `composables/useAppStore.ts`：`reactive` 单例（currentName/isBuiltin/project/myProjects/builtinProjects）+ refreshProject/switchProject/saveProjectCtx（key 不变）+ has* 改 computed + activeMenu ref —— 从 app.js 逐字移植。
3. `useToast.ts`（toasts ref + TransitionGroup）、`renderProgress.ts`（entry.js 的 HF 进度解析器移植，App.vue onMounted 全局订阅一次）、`rate.ts`、`utils/escape.ts`。
4. `StepBar.vue`：renderStepBar（app.js L124-225）组件化；`[data-slot]` 注入机制废弃（各页模板顶部放 `<StepBar/>`）。
5. `pages/index.ts`：9 键注册表 + `shallowRef<Component>` + `goPage(key)`（activeMenu → refreshProject → currentPage）。
6. `App.vue`：标题栏（含最大化图标切换 isMaximized）+ 侧边栏 v-for + `<component :is>` + ToastHost。
7. 门禁：typecheck + build。**用户验证点①**：`npm run dev` 窗口/标题栏/菜单切换/HMR 正常。

### Phase 6 — 逐页移植
顺序：home(+about) → content → htmlGen → settings(+WhisperSection) → soundCopy → textTts(+Synth+Align) → subtitle(+TranscribeSection) → video。

每页统一模式：template.js HTML → SFC `<template>` 逐字搬（id/class 保留）；init() → `<script setup lang="ts">` onMounted；模块级闭包变量 → ref/reactive；addEventListener → @事件/ref；innerHTML 拼接 → v-for/v-if；文档级监听成对化（htmlGen message 的 once-guard、transcribe ESC 重绑 guard 均删，改 onMounted/onBeforeUnmount）；进度订阅 onMounted 一次（preload 单订阅=切页替换，与现行为一致）；`window.__tts/__sub/__settings` 废弃改显式模块/props；subtitle 与 align 的重复时间格式化器合并到 `utils/time.ts`；escTxt 合并到 escape.ts；file:// 媒体路径写法原样保留。**两个 latent bug 随模块化自然修复**（home 缺 toast/refreshProject 解构、htmlGen 缺 applyRate/stepRate 解构）。

每步门禁：typecheck + build。全部完成后 **用户验证点②**：dev 全功能走查（8 页 + 五节点流水线 + 设置/whisper + 配音对齐 + 字幕转录 + HTML 预览 + 视频渲染进度）。

### Phase 7 — 打包收尾
1. package.json：`main: out/main/index.js`；files → `["out/**/*","video-projects/**/*","README.md","!node_modules/**/*","node_modules/openai/**/*","node_modules/opencc-js/**/*","!*.js.map"]`；extraResources/asar/win/nsis/镜像不动；scripts：`start: electron-vite preview`、`pack: npm run build && npx electron-builder --dir`、`dist: npm run build && npx electron-builder --win`。
2. 删全部旧渲染层文件（清单见上）。
3. 门禁：typecheck + build + `grep -rn "window\.App\|window\.__" src/` 零命中 + pack 成功 + `npx asar list` 确认 out/video-projects/openai/opencc-js 在位 + resources 四目录体积与迁移前一致（726M）。
4. **用户验证点③**：运行 `dist/win-unpacked/MarvisStudio.exe` —— 上次项目上下文保留、全流程可用。**验证点④（可选）**：`npm run dist` 安装包验证。

## 风险与缓解（要点）

- sandbox preload 转 ESM → 全项目不加 "type"；门禁含 CJS 输出检查
- CSP 阻断 HMR/运行时编译 → 追加 ws 白名单；SFC 全预编译，禁 Vue.compile
- TS7 composite/references 差异 → typecheck 走 `--composite false` 独立 -p；降级方案：三 tsconfig 完全独立
- 打包后 openai/opencc-js 丢失 → externalize + files 白名单 + asar list 校验
- video-projects 从 asar 读取 → files 保持其在 asar 根；写入仍在 userData（现逻辑）
- 中间态旧 app 不可运行（Phase 3-6）→ 计划内预期；用户手动验证集中在 Phase 5/6/7 末三个点

## 验证方式（汇总）

- 每阶段静态检查：`npm run typecheck` + `npx electron-vite build`
- Phase 7：asar list 产物结构核对 + resources 体积对比 + 旧引用 grep 清零
- 用户手动验证点：① Phase 5 末 dev 壳/HMR ② Phase 6 末 dev 全功能 ③ Phase 7 末打包 exe（+④ 可选安装包）
