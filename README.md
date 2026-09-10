---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_11e67e5aad1211f18874525400287e28
    ReservedCode1: bNBJvrMciW6vcF/UCDE2a6pxesXTdw656Ngo7BHmouSS565NIbACYye/zr9R7d2Wg+Sxd7EpqNKHItu7aJ7CI+sYO3LwfKf55ySVQ6Rch2Jwa9nISkTjkGR+3mZgDzjAQlDxpvOuH5ZMXWammMfv7BLBu6RtCFz+NTUpTRvwkR//WtO35f0LmE3FvYI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_11e67e5aad1211f18874525400287e28
    ReservedCode2: bNBJvrMciW6vcF/UCDE2a6pxesXTdw656Ngo7BHmouSS565NIbACYye/zr9R7d2Wg+Sxd7EpqNKHItu7aJ7CI+sYO3LwfKf55ySVQ6Rch2Jwa9nISkTjkGR+3mZgDzjAQlDxpvOuH5ZMXWammMfv7BLBu6RtCFz+NTUpTRvwkR//WtO35f0LmE3FvYI=
---

# 我的（My）—— 一站式音视频创作流水线

一个基于 Electron 的桌面应用，以「项目」为粒度，把 **声音复制 → 文字生音频 → 文字转字幕 → 字幕生成 HTML → 转成视频** 五个创作节点串联成一条完整流水线。

---

## 一、项目功能

- **项目化管理**：所有创作围绕一个「项目」实体进行，每个项目对应一个目录，统一存放字幕、HTML、音频、视频产物；内置示例项目放在 `video-projects`（只读）。
- **文字转字幕**：编辑字幕文本，每行一条，支持两种格式：
  - 纯文本行：自动按语速估算时长；
  - `[分:秒] 文本`：指定时间轴（如 `[00:05] 大家好`），转视频后精确对齐。
- **字幕生成 HTML（Agent 接口）**：把字幕渲染成精美的 HTML 动画页面。生成与修改均通过**对话框**提交需求，由 **Agent 接口**完成，应用侧不内置模板。
- **HTML 预览**：项目内 HTML 用 iframe 实时预览，所见即所得。
- **背景音频**：可选为本项目配置一首背景音乐，Agent 生成 HTML 时会注入为音轨（在索引 `audio/` 下），预览即可听，转视频时自动混入声音。
- **下载 HTML**：一键把项目当前的 `index.html` 导出到本地任意位置。
- **转成视频**：复用项目内 HTML，调用 HyperFrames CLI 在后台渲染为 MP4，渲染完成后直接在页面内播放，并支持「在文件夹中显示」定位产物。
- **链路状态条**：顶部 step-bar 实时显示五个节点（声音复制 → 文字生音频 → 文字转字幕 → 字幕生成 HTML → 转成视频）的完成进度，已完成节点自动点亮，点击可跳转对应页面。

---

## 二、主要实现

### 2.1 技术栈与架构

- **Electron + 原生前端**（HTML / CSS / JS），无第三方 UI 框架。
- 主进程 `main.js`：窗口管理、IPC 服务、文件读写、HyperFrames 转视频调度。
- 预加载脚本 `preload.js`：通过 `contextBridge` 安全暴露 API：
  - `projectTools` —— 项目化流水线（list / load / saveSubtitle / generateHtml / modifyHtml / downloadHtml / readHtml / saveHtml / pickAudio / setAudio / clearAudio / openFolder / delete / saveVideo）。
  - `hfTools` —— HTML 预览与 HyperFrames 转视频（openHtml / renderVideo / showInFolder / onProgress）。
  - `windowControls` —— 自绘标题栏的窗口控制。
- 渲染进程 `renderer.js`：页面路由与交互；`renderer.css` 承担深空科技风格视觉。

### 2.2 项目目录结构

```
userData/projects/<项目名>/
├── project.json        # 项目元数据（标题、字幕、音频引用、产物路径等）
├── subtitle.txt        # 字幕文本
├── index.html          # Agent 生成的 HTML composition
└── audio/              # 背景音频副本（可选）
```

内置示例项目位于 `E:\my\video-projects`（只读展示）。

### 2.3 关键技术点

- **转视频**：主进程解析出 Node.js 真实绝对路径（应对 nvm shim / WindowsApps alias 下 `spawn('node')` 不稳定问题），以绝对路径 spawn 运行 `hyperframes.mjs render`；同时把 WinGet 安装的 `Gyan.FFmpeg` 的 bin 目录注入渲染进程的 `env.PATH`，保证 FFmpeg 可用。
- **HTML 合规校验**：转视频前校验 HTML 是 HyperFrames 合规的 composition —— 需同时包含 `data-composition-id` 与 GSAP `__timelines` 结构。
- **CSP 与安全**：iframe 预览使用 `sandbox="allow-scripts allow-same-origin"`；字幕文本一律用 `textContent` 写入，防注入。

---

## 三、流水线流程

```
① 声音复制  →  ② 文字生音频  →  ③ 文字转字幕  →  ④ 字幕生成 HTML  →  ⑤ 转成视频
    (导入/复制声音副本)   (文字合成语音)   (语音对齐生成字幕)      (渲染动画页面)     (导出 MP4)
```

1. **声音复制**：导入音频并在项目中留档（可选节点）。
2. **文字生音频**：输入文字合成自然语音（可选节点）。
3. **文字转字幕**：在「字幕生成」页编辑字幕（纯文本自动估时，或 `[分:秒]` 精确定时），保存后点亮「字幕」节点。
4. **字幕生成 HTML**：在「HTML 生成」页打开对话框，描述想要的效果，提交给 Agent；Agent 生成/修改 HTML 写回项目并刷新预览；如需背景音乐，先选好音频再让 Agent 带上音轨。满意后可「下载 HTML」。
5. **转成视频**：在「HTML 预览 / 视频生成」页一键转换，复用项目内 HTML 后台渲染，完成后内嵌播放并显示产物文件位置。

整个链路围绕同一个「项目」实体共享状态，各页面顶部 step-bar 实时反映进度，避免了「选 HTML 文件」这类割裂操作。

---

## 四、HTML 由 Agent 接口实现（重要说明）

- **生成**：HTML 不再由应用内置模板生成。在「HTML 生成」页点击 **生成 HTML**，弹出对话框，录入需求描述后提交给 Agent；Agent 产出符合规范（含 `data-composition-id` 与 GSAP `__timelines`）的 HTML，写回项目 `index.html`，应用刷新预览并点亮链路节点。
- **修改**：点击 **修改 HTML**，对话框基于当前项目 HTML 提出修改诉求，Agent 改造后覆盖项目 `index.html` 并刷新预览。不需要源码兜底编辑，应用不内置生成逻辑。
- **应用侧职责**：仅负责 UI（对话框 / 预览 / 链路状态）、文件落盘、下载导出与转视频调度；生成与修改的具体魔法由 Agent 完成。
- **接口桩**：主进程保留 `project:generate-html` 与 `project:modify-html` 的对接点，收到 `{ name, prompt }` 后调用 Agent，Agent 回写 HTML 后应用侧更新 `htmlPath`、置空失效的 `videoPath`。Agent 尚未接入时，界面会提示「Agent 接口未接入」。

---

## 五、当前进度

### 已完成

- **项目化流水线骨架**：五个节点（声音复制 → 文字生音频 → 文字转字幕 → 字幕生成 HTML → 转成视频）全链路贯通，链路状态条 step-bar 实时反馈。
- **文字转字幕**：字幕文本编辑/保存就绪，支持纯文本自动估时与 `[分:秒]` 精确定时。
- **HTML 生成改造为 Agent 接口**：移除内置 `buildSubtitleComposition` 模板；`generate-html` 改为 Agent 桩，新增 `modify-html` 与 `download-html` 桩；html-gen 页改为「对话框（生成/修改）+ 下载 + 预览」，移除源码 textarea 工作台；preload.js 新增 `modifyHtml` / `downloadHtml`，renderer.css 补齐对话框样式；各文件通过 `node --check` 语法校验。
- **转成视频**：集成 HyperFrames CLI（Node 绝对路径 + FFmpeg PATH 注入），后台渲染 MP4，页面内嵌播放 + 显示产物位置。
- **README 与 git 仓库**：README.md 说明文档生成；`git init` 已初始化（master 分支），尚未首次提交。

### 待办 / 占位

- **Agent 接口未接入**：`project:generate-html` / `project:modify-html` 当前为桩，界面提示「Agent 接口未接入」，实际 HTML 生成/修改待后端 Agent 对接后生效。
- **节点 ①② 为占位页**：声音复制、文字生音频两节点当前为开发中占位，未提供完整功能。
- **内置示例待替换**：`video-projects` 内置示例项目当前为构建期虚构数据，后续替换为真实可用的演示工程。
- **首次提交**：仓库已初始化但尚无首次 commit，README 稳定后可提交基线版本。

---

## 六、运行

```bash
cd E:\my
npm install        # 首次安装 Electron 等依赖
npm start          # 启动应用（或用 electron .
```

> 转视频依赖：Node.js >= 22（HyperFrames CLI）、HyperFrames CLI（`hyperframes.mjs`，可用环境变量 `HYPERFRAMES_CLI` 指定路径）、FFmpeg（WinGet 安装 `Gyan.FFmpeg`）。
*（内容由AI生成，仅供参考）*
