---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_d763063cac6511f1b128525400f8a581
    ReservedCode1: 8beldf/mbIl319yH5JC9UrVgLbt/g0zZEKylTBBO9Ra4Ss1PZSuir0z50g9yrzERYGsTfa1/OlcxrWAKizNq14d2t79UjbakNfaktHm5bAhej79SLshPbrsUOTz/WQG+xuBvHYXn3PPrYUqwRnhEJ965OlzltJyS+Zp+g2+XpiuecD/EKymv7tlCUBg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_d763063cac6511f1b128525400f8a581
    ReservedCode2: 8beldf/mbIl319yH5JC9UrVgLbt/g0zZEKylTBBO9Ra4Ss1PZSuir0z50g9yrzERYGsTfa1/OlcxrWAKizNq14d2t79UjbakNfaktHm5bAhej79SLshPbrsUOTz/WQG+xuBvHYXn3PPrYUqwRnhEJ965OlzltJyS+Zp+g2+XpiuecD/EKymv7tlCUBg=
---



# walk-video-render

把一段「2D 插画人物行走动画」从 HTML + GSAP 时间线渲染成本地 MP4 的全链路总结。目标产物固定为 1920×1080 / 30fps / H.264 的 MP4，可在无云渲染的情况下于本机完成。

## 一、适用场景

- 需要生成用于宣传片、动效演示、短视频的插画风格人物动画
- 人物动作以「行走循环（walk cycle）」为主，侧面 / 正面均可
- 要求本地渲染出 MP4，不依赖云端渲染服务

## 二、本地渲染环境要求（硬性）

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 22 | hyperframes 硬性要求，v20 会被拒绝；用 nvm 管理版本 |
| FFmpeg | 任意新版（9.0.1 已验证） | 负责视频编码，默认不在 PATH，必须手动注入 |
| 无头浏览器 | Chrome Headless Shell / 系统 Chromium | hyperframes 自动探测，本机实测走 Edge 内核可渲染 |
| hyperframes CLI | 0.8.33 | 渲染引擎，可直接复用其他项目已装好的 bin |

### 环境关键路径（本机实测）

- Node 22：`nvm use 22.23.2`（安装于 `%LOCALAPPDATA%\nvm\nodejs`）
- FFmpeg bin（WinGet 安装，不在 PATH）：
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin`
  （含 ffmpeg.exe / ffprobe.exe / ffplay.exe）
- hyperframes CLI（复用）：`<某已装项目>\node_modules\.bin\hyperframes.cmd`
  对应入口 JS：`<某已装项目>\node_modules\hyperframes\bin\hyperframes.mjs`

## 三、渲染命令与输出规格

```powershell
# 1. Node 版本切换
nvm use 22.23.2

# 2. 注入 FFmpeg bin 到当前会话 PATH（关键！否则报 FFmpeg/FFprobe not found）
$ffBin = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin"
$env:PATH = "$ffBin;" + $env:PATH

# 3. 进入视频项目目录并渲染
cd <视频项目目录>
& <某已装项目>\node_modules\.bin\hyperframes.cmd render -o output.mp4
```

输出规格：1920×1080 / 30fps / H.264 MP4；5 秒 150 帧约 29 秒渲染完成，产物约 750 KB。

### 推荐：后台渲染 + 轮询（避免会话中断）

在自动化执行环境里直跑渲染可能因 shell 会话结束导致子进程被回收、渲染中断（表现为卡在 `Browser: cache` 后无进展）。推荐用 `Start-Process` 后台化：

```powershell
$env:PATH = "$ffBin;" + $env:PATH
Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c `"<hyperframes.cmd 路径>`" render -o output.mp4 > render.log 2>&1" `
  -WorkingDirectory <视频项目目录> -WindowStyle Hidden

# 之后轮询判断完成：node 进程退出 / output.mp4 LastWriteTime 更新
```

渲染结束时 CLI 会询问「How likely are you to recommend HyperFrames?」，后台方式直接跳过即可，不影响产物。

## 四、动画项目结构（index.html 关键约定）

- 根容器：`<div id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5">`
- 场景：`<div class="scene" data-start="0" data-duration="5">`，内含全画幅 `<svg id="art" viewBox="0 0 1920 1080">`
- 时间线：`window.__timelines["main"] = gsap.timeline({ paused: true })`，动画全部挂在这个 tl 上
- 图层面板致动画顺序：海面/天空 → 太阳 → 云 → 地面 → 路面虚线 → 树木 → 人物 → 标题块

## 五、人物行走动画创作要点（重点）

### 1. 人物坐标系约定
- 建立一个锚层 `#char`，局部坐标原点 = 髋部中心（y=0），脚底约 y=120
- 每个肢体作为一个独立 `<g>`，`transform="translate(枢轴x,枢轴y)"`，肢体形状从枢轴向下方延伸
- GSAP 旋转时用 `svgOrigin: "0 0"`，保证绕 SVG 锚点旋转，杜绝「手臂/腿脱离身体」

### 2. 行走循环（侧面、面朝右、从左往右走）
- **整体位移**：`tl.to("#charwrap", { x: 180 → 1780, duration: 4.0, ease: "none" }, 0.6)`，全程匀速
- **上下起伏**：`#char` y 方向 `y: -7`，`sine.inOut` + `yoyo`，一步一落
- **双腿交替**：前腿与后腿相位差半个步幅（0.9s 一步，后腿延迟 0.45s 起步）
- **双臂摆摆**：手臂与同侧腿反相（contra-lateral gait），手臂与对侧腿同相
- **背景视差**：云 / 树 / 标线整体 `x: -960` 匀速左移（与人前进方向相反），周期取各元素平铺间距的整数倍保证无缝循环

### 3. 常见修型点
- 手臂/腿脱离 → 未用 svgOrigin 对准枢轴；修复锚点后重渲染即可
- 行走姿态违和 → 先明确朝向（面朝哪边）+ 旋转肢体相位对齐

## 六、踩坑记录（重点复看）

| 现象 | 根因 | 解法 |
| --- | --- | --- |
| `FFmpeg not found` / `FFprobe not found` | WinGet 装完未写 PATH | 渲染前 `$env:PATH = ffmpegBin + $env:PATH` |
| 渲染无输出 / 卡在 `Browser: cache` | shell 会话回收了 CLI 子进程 | 改用 `Start-Process` 后台跑 + 轮询产物 |
| `.cmd` 管道输出为空 | 输出捕获问题 | 重定向到日志文件再读 |
| 产物没更新（时间戳不变） | 渲染实际未跑完 | 先确认 node 进程存活，再等或重跑 |
| 老病号进程堆积 | 多次中断遗留无头浏览器孤儿进程 | 用 `Get-CimInstance Win32_Process` 查命令行，只清带 headless/渲染标识的进程 |

## 七、交付规范（用户偏好）

- **不做冗长自测**：用户明确「不需要你测试 / 验证 / 检查，生成视频给我看」，渲染完直接交付 mp4，不要自行截图逐帧验证
- 交付时给出产物路径 + 规格（时长 / 分辨率 / 大小 / 耗时）即可

## 八、产物参考（本次已产出）

- 5 秒单场景行走：`output\walk-video\output.mp4`（39.6s 手动渲染 / 29.4s 后台渲染）
- 25 秒宣传片（多场景 + 转场）：`output\person-video\output.mp4`
*（内容由AI生成，仅供参考）*
