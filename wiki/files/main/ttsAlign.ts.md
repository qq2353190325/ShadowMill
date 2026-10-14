# src/main/ttsAlign.ts

> 字幕配音逐句对齐：逐句 TTS 合成、量时长、按模式重建时间轴并装配整轨。

- **所在目录**：src/main/
- **类型**：主进程业务模块（字幕配音逐句对齐）
- **规模**：338 行
- **对外导出**：
  - `interface AlignSeg`（对齐段描述，类型导出）
  - `fmtTime(sec)`、`planModeA(...)`、`planModeB(...)`、`buildTrack(...)`、`register(ctx?)`
- **模块级常量**：`MAX_RATE = 1.15`（atempo 加速上限）、`EPS = 0.05`（槽位判定容差，秒）、`SR = 24000`（统一采样率）、`MIN_SLOT = 0.1`（模式 B 单调化最小名义槽位，秒）
- **模块级状态**：`alignRunning`（一次仅允许一个对齐任务）、`alignCancelled`（取消标志，句间检查）

## 1. 作用与职责

本模块负责「字幕已生成、但要让它和配音严格对上」这一环。给定一份字幕文本与一个音色，它：

1. 逐句调用 TTS 合成，把每句结果统一转成 24kHz 单声道 `pcm_s16le` WAV，并用 ffprobe 量出实测时长；
2. 按所选模式把「实测时长」与「字幕时间戳」二选一作为基准，重建整条时间轴（`planModeA` / `planModeB`）；
3. 用「静音补齐 + concat 流拷贝」把逐句 WAV 拼成一条完整音轨（`buildTrack`），并做整轨时长终验；
4. 通过 IPC 向渲染层回推进度，并返回重排后的字幕文本、成品音频路径与逐句明细。

两种模式的定位差异（源码头部注释的原文语义）：

| 模式 | 载荷值 | 基准 | 结果 |
| --- | --- | --- | --- |
| 模式 A：音频驱动（重排字幕） | `audio-driven` | 以每句**实测时长**重建时间线 | 字幕时间被重排，音频原样拼接 |
| 模式 B：时间轴驱动（修正音频） | `timeline-driven` | 以**字幕时间戳**为槽位摆放配音 | 字幕时间为准，句间补静音，必要时加速或顺延 |

注意：`mode` 的解析是白名单式——只有传入字符串严格等于 `'timeline-driven'` 才走模式 B，其余一切取值（含缺省、非法值）都落到 `audio-driven`。

## 2. 数据结构

### 2.1 `AlignSeg`（导出接口，`planModeA` / `planModeB` 的输出元素）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `index` | `number` | 句序号，从 0 开始 |
| `text` | `string` | 该句字幕文本 |
| `subtitleStart` | `number` | 该句在**新**字幕时间线上的起点（秒） |
| `audioStart` | `number` | 该句音频在整轨中的起点（秒）。当前两种模式都取 `= subtitleStart` |
| `audioDur` | `number` | 该句音频实际时长（秒）。模式 B 中若发生 atempo，则为变速**重测后**的时长 |
| `status` | `'ok' \| 'accelerated' \| 'pushed'` | `ok` 正常；`accelerated` 已加速后放得下；`pushed` 顶格加速仍放不下、顺延了后续 |
| `rate` | `number` | 实际使用的 atempo 倍率（未变速时为 `1`） |
| `delta` | `number` | `pushed` 时的溢出量（秒），即顺延后续句子的平移量；否则为 `0` |
| `wavPath` | `string` | 该句最终采用的 WAV 绝对路径（变速后指向 `seg/xxxx_v.wav`） |

### 2.2 `AlignProgressPayload`（进度载荷，来自 `src/shared/types.ts` ⑧ 节）

本文件**不再自行声明进度接口**（原先的本地 `AlignProgressInfo` 已删除），模块内一律使用共享层的 `AlignProgressPayload`（`synthSentence` 的 `send` 回调与 `register` 内的 `send` 都用它标注）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `stage` | `AlignProgressStage`（`'synth' \| 'assemble' \| 'done' \| 'error'`） | 阶段标识。主进程实际发送：`synth` / `assemble` / `done` / `error` |
| `index` | `number?` | 当前句序号（0 基） |
| `total` | `number?` | 总句数 |
| `percent` | `number?` | 百分比（逐句合成阶段为 `round(i*100/total)`，`done` 为 `100`） |
| `message` | `string` | 面向界面的中文提示文案 |

### 2.3 IPC 返回值结构

成功：`{ ok: true, mode, subtitleText, audioPath, totalDur, details }`（即 `IpcResult<VoiceAlignResult>` 的成功分支，`VoiceAlignResult` 定义在共享层）

| 字段 | 说明 |
| --- | --- |
| `mode` | 实际生效的模式（`audio-driven` / `timeline-driven`） |
| `subtitleText` | 重排后的字幕文本，每行 `[mm:ss] 文本`（由 `fmtTime` 生成） |
| `audioPath` | 装配完成的整轨 WAV 绝对路径 |
| `totalDur` | 整轨实测总时长（秒） |
| `details` | 逐句明细数组，字段为 `index/text/subtitleStart/audioStart/audioDur/status/rate/delta/segPath`（`segPath` 即 `AlignSeg.wavPath`） |

失败：`{ ok: false, message }`；取消：`{ ok: false, canceled: true, message }`。

## 3. 内部实现函数

| 名称 | 说明 |
| --- | --- |
| `fmtTime(sec)` | 秒 → `[分:秒]` 字符串。先 `Math.max(0, Math.round(Number(sec) || 0))`（四舍五入到秒），再对分、秒各 `padStart(2,'0')`；与 subtitle.js 的 `fmtTime` 口径一致 |
| `pad4(i)` | 序号 → 4 位零填充字符串，用于临时文件名排序稳定 |
| `segPath(taskDir, i, v?)` | 段文件路径：`<taskDir>/seg/0000.wav`；`v` 为真时追加 `_v` 后缀（`0000_v.wav`，atempo 变速产物） |
| `win2posix(p)` | Windows 路径 → concat 列表可用形式：反斜杠转正斜杠，整体用单引号包裹，内部单引号转义为 `'\''` |
| `runProc(exe, args)` | ffmpeg/ffprobe 的 spawn 样板（同 whisper.js）：`windowsHide: true`，累积 stdout/stderr，`close` 且 `code === 0` 才 resolve；`error` 事件转「无法启动 <exe>」，非 0 退出码转「<exe> 退出码 N：<stderr 末 300 字符>」 |
| `probeDur(file)` | 调 `BUILTIN_RESOURCES.ffprobe`，用 `-show_entries format=duration -of default=noprint_wrappers=1:nokey=1` 取时长并 `parseFloat`；非有限值或负数则抛「无法读取音频时长」 |
| `toWav(src, out)` | 转 24kHz 单声道 `pcm_s16le` WAV（`-vn -ar 24000 -ac 1`），目的是避开 mp3 头尾 padding 造成的时间漂移 |
| `tempoTo(wav, out, rate)` | `-af atempo=<rate>` 变速输出，仍为 24k 单声道 WAV；源码注释强调变速后**必须重新 probeDur**（帧粒度下有毫秒级偏差） |
| `genSilence(dur, out)` | 用 `-f lavfi -i anullsrc=r=24000:cl=mono -t <dur>` 生成精确时长静音 WAV |
| `synthSentence(...)` | 逐句合成三连：入口先查 `alignCancelled`（取消则抛带 `canceled = true` 的 Error）→ 推送 `stage:'synth'` 进度 → `synthOne(text, voiceId, useModel)` 拿到 `{ buf, ext }` → 写 `raw/0000.<ext>` → `toWav` 生成 `seg/0000.wav` → `probeDur` 量时长。源码注释说明：量时长极快，**不单独推进度**，避免界面闪现「量取第 N 句…」 |
| `planModeA(taskDir, lines, durs, gap, offset)` | 模式 A 规划（同步、纯计算）。首句起点取 `offset`（首句原时间戳，保留锚点）；其后每句停顿 `g = max(gap, (lines[i].time - lines[i-1].time) - durs[i-1])`，即优先按字幕原有时间间隔推算停顿，间隔放不下时回落到最小停顿 `gap`。所有段 `status:'ok'`、`rate:1`、`delta:0`，`audioStart = subtitleStart`。返回 `{ segs, times }` |
| `planModeB(taskDir, lines, durs)` | 模式 B 规划（异步，含 atempo）。先做 Step 0 单调化：乱序时间戳规整为相邻至少 `MIN_SLOT` 槽位；再前向单遍：槽位 `slot = times[i+1] - times[i]`（末句为 `Infinity`，不加速、不自发顺延）。`dur > slot + EPS` 时按 `need = dur/slot`、`target = min(need, MAX_RATE)` 做 atempo 并重测时长；若已放得下标 `accelerated`，否则标 `pushed`、`delta = dur - slot`，并把 `times[i+1..]` 全部平移 `delta`（后续槽位差不变，故不会产生新溢出，多句连续超时自然累加） |
| `buildTrack(taskDir, segs, outPath)` | 装配整轨：逐段与游标 `cursor` 求差得静音长度（算法保证 ≥ 0，无重叠），差值 `> 0.02s` 时生成 `sil/0000.wav` 并写入列表；随后写入该段自身。列表写 `concat.txt`，用 `-f concat -safe 0 -i <list> -c copy` 流拷贝输出（所有段同格式，零重编码），最后 `probeDur` 返回整轨实测时长 |
| `cleanupOldTasks(keepDir)` | 清理 `userData/voice` 下匹配 `/^align-/` 的历史任务目录，保留本次 `keepDir`；`readdirSync` 失败直接返回，`rmSync(..., { recursive: true, force: true })` 失败静默忽略 |
| `register(ctx?)` | 注册三个 IPC：`voice:align-cancel`（`ipcMain.on`，置取消标志）、`voice:synth-aligned`（`ipcMain.handle`，主流程）；进度经 `event.sender.send(voice:align-progress)` 回推 |

## 4. IPC 频道一览

| 频道名 | 方向 / 注册方式 | 参数载荷 | 返回结果 | 行为说明 |
| --- | --- | --- | --- | --- |
| `voice:synth-aligned` | 渲染 → 主，`ipcMain.handle`（invoke） | `VoiceAlignPayload`（`{ subtitleText, voice, mode?, gapSec?, voiceModel?, projectName? }`，handler 形参写作 `payload?: VoiceAlignPayload`） | 成功 `{ ok: true, mode, subtitleText, audioPath, totalDur, details }`；失败 `{ ok: false, message, needPacks? }`（缺 ffmpeg 运行环境包时带 `needPacks: ['ffmpeg']`）；取消 `{ ok: false, canceled: true, message }` | 逐句合成 + 对齐 + 装配整轨的主入口 |
| `voice:align-cancel` | 渲染 → 主，`ipcMain.on`（send） | 无 | 无（不返回） | 仅把 `alignCancelled` 置 `true`；主进程在句间检查并中断 |
| `voice:align-progress` | 主 → 渲染，`event.sender.send` | `AlignProgressPayload`（`stage/index?/total?/percent?/message`，定义在 `shared/types.ts`） | 无 | 逐句合成与装配阶段的进度回推；发送前校验 `event.sender` 存在且未 `isDestroyed()` |

`voice:synth-aligned` 的入口校验与取值规则（按源码顺序）：

1. **缺包校验（最先做）**：`const lack = runtime.missingPacks(['ffmpeg'])`，非空立刻返回 `{ ok: false, needPacks: lack, message: '逐句对齐需要先下载运行环境（' + runtime.packSizeText(lack) + '）' }`——**不下载、不阻塞**，由渲染层（`useEnvGate`）弹「下载运行环境」确认框，用户点「继续」再重发本次操作（见 `docs/runtime-pack-split.md` §5.2）；
2. `alignRunning` 为真 → 直接返回 `{ ok: false, message: '已有对齐任务进行中，请稍候' }`；
3. `ffmpeg` / `ffprobe` 任一取不到（`BUILTIN_RESOURCES.ffmpeg` / `ffprobe` 为空串，即 **ffmpeg 运行环境包**未就绪）→ 返回缺 ffmpeg 的提示（正常情况下第 1 步已经拦下）；
4. `subtitleText` trim 后为空 → `'字幕为空，请先在字幕页生成或填写字幕'`；
5. `voice` trim 后为空 → `'请先选择（或创建）音色'`；
6. `gapSec` 非有限数时取默认 `0.5`，再夹到 `[0, 10]`（仅模式 A 使用）；
7. `parseSubtitle(subtitleText)` 结果为空 → 同第 4 条提示；
8. 合成模型 `useModel = payload.voiceModel || resolveVoiceModel(voiceId, ctx)`（音色绑定模型优先，否则按音色解析，含全局默认兜底）。

## 5. 关键流程

### 5.1 公共前置

1. 通过入口校验后，创建任务目录 `taskDir = <userData>/voice/align-<Date.now()>`，并在其下建立 `raw`（TTS 原始输出）、`seg`（统一格式分段，供试听/拼装）、`sil`（句间静音）三个子目录。
2. 调用 `cleanupOldTasks(taskDir)` 清掉历史 `align-*` 目录。
3. 置 `alignRunning = true`、`alignCancelled = false`，进入 `try/finally`（`finally` 中复位 `alignRunning = false`）。

### 5.2 逐句合成（TTS → 转 wav → 量时长）

- 首句前推送 `{ stage: 'synth', index: 0, total, percent: 0, message: '开始逐句合成（N 句）…' }`。
- 循环每句：先查 `alignCancelled`（是则返回取消结果，文案含已完成句数）；再调 `synthSentence`，成功后把时长追加到 `durs`。
- 单句异常处理：若异常带 `canceled` 标记视为取消返回；否则截取该句文本前 10 个字符，返回 `'第 N 句（xxxx…）合成失败：' + voiceFriendlyError(e, '合成语音失败')`。（`voiceFriendlyError` 自 2026-10 起只是 `src/shared/errors.ts` 的 `friendlyError()` 薄包装，返回形如 `合成语音失败：<人话>（<原始报文首行>）`；**本文件的 import 未改动**。）

### 5.3 模式 A：音频驱动（重排字幕）

1. 以 `lines[0].time` 作为 `offset` 锚点调用 `planModeA(taskDir, lines, durs, gap, lines[0].time)`，避免破坏既有时间轴对齐。
2. 每句与其前一句的停顿 `g = max(gap, 字幕原间隔 - 前一句实测时长)`：例如下句原时间 6 秒、本句只读 3 秒 → 停顿 3 秒；间隔放不下（或字幕无时间线、时间为估时）时回落到 `gap`。
3. `subtitleStart = 前一段 subtitleStart + 前一段 audioDur + g`；`audioStart = subtitleStart`，音频不做任何变速，全部 `status: 'ok'`。
4. `times` 即各段 `subtitleStart` 序列，用于重排后的字幕文本。

### 5.4 模式 B：时间轴驱动（修正音频）

1. 取字幕原始时间 `times = lines.map(l => l.time)`。
2. **Step 0 单调化**：从第 2 句起，若 `times[i] < times[i-1] + MIN_SLOT` 则抬到 `times[i-1] + MIN_SLOT`，保证每句至少 0.1 秒名义槽位。
3. 前向单遍：槽位 `slot` = 下一句时间 − 本句时间（末句 `Infinity`）。
4. 若 `dur > slot + EPS`：`need = dur/slot`，`target = min(need, MAX_RATE)`，调 `tempoTo` 生成 `seg/xxxx_v.wav` 并**重测时长**，`rate = target`。
   - 重测后 `dur <= slot + EPS` → `status = 'accelerated'`；
   - 仍溢出（含加速后毫秒级残余）→ `status = 'pushed'`，`delta = dur - slot`，把 `times[i+1..]` 同步平移 `delta`（顺延后续句子并平移后续字幕时间）。
5. 每段 `audioStart = subtitleStart = times[i]`；返回 `{ segs, times }`。

### 5.5 装配整轨与终验

1. 推送 `{ stage: 'assemble', ... , message: '对齐时间轴并装配音轨…' }`。
2. 输出文件名：`projectName` 先过滤 `[\\/:*?"<>|]` 为 `_` 并截断到 40 字符，空则用 `aligned`，最终 `<safeName>_aligned_<Date.now()>.wav`，落在 `taskDir` 内。
3. `buildTrack` 生成静音段 + `concat.txt` + `-c copy` 拼接，返回整轨实测时长 `totalDur`。
4. **终验**：期望时长 `expected = 末段.audioStart + 末段.audioDur`，若 `|totalDur - expected| > 0.3` 秒则返回 `'音轨装配时长校验失败（期望 Xs，实际 Ys）'`。源码注释说明：静音按帧粒度取整会累积毫秒级漂移，270s 级整轨常见 0.1~0.2s 偏差，而真缺失段落会差出数秒，故 0.3s 阈值不影响异常防护。
5. 推送 `{ stage: 'done', percent: 100, message: '对齐完成：N 句 · 总时长 mm:ss' }`，返回成功结构；`details` 由 `segs` 映射而来。

### 5.6 临时任务目录与清理策略

| 路径 | 内容 |
| --- | --- |
| `<userData>/voice/align-<时间戳>/` | 单次任务根目录 |
| `raw/0000.<ext>` | TTS 原始输出（扩展名由 `synthOne` 返回的 `ext` 决定） |
| `seg/0000.wav`、`seg/0000_v.wav` | 统一格式分段；`_v` 为 atempo 变速产物 |
| `sil/0000.wav` | 句间静音 |
| `concat.txt` | concat 列表（`file '<正斜杠路径>'`） |
| `<safeName>_aligned_<时间戳>.wav` | 最终整轨成品 |

清理策略：每次任务开始时调用 `cleanupOldTasks`，删除 `userData/voice` 下所有 `align-` 前缀且不等于本次 `taskDir` 的目录，因此**只保留最近一次**任务目录，成品音频也位于其中（渲染层据 `audioPath` 播放并可选写回项目）。

### 5.7 取消机制

- `voice:align-cancel` 只置 `alignCancelled = true`，不做进程级强杀。
- 检查点有两处：主循环每次迭代开头，以及 `synthSentence` 入口。
- 取消表现：立即（不等待当前句完成后继续）返回 `{ ok: false, canceled: true, message: '已取消（已完成 i/N 句）' }`；`finally` 仍会复位 `alignRunning`，且临时目录不会被清理（`cleanupOldTasks` 下次任务时才清），已完成的分段 WAV 保留在 `seg/` 中。
- 由于检查点在句间，正在进行的 HTTP 合成请求不会被中断，取消的响应延迟取决于当前句的合成耗时。

### 5.8 ffmpeg / ffprobe 调用方式

- 可执行文件一律取自 `BUILTIN_RESOURCES.ffmpeg` / `BUILTIN_RESOURCES.ffprobe`——分包后它们指向 **ffmpeg 运行环境包**解出的 `<userData>/runtime/ffmpeg/ffmpeg/bin/ffmpeg.exe` / `ffprobe.exe`（该包未就绪时为空串），入口处先做存在性检查、并对「缺包」单独返回 `needPacks`。
- 所有调用走同一个 `runProc`：`spawn(exe, args, { windowsHide: true })`，参数以数组形式传入（不拼 shell 字符串），凭 `close` 事件与退出码判定成败；ffmpeg 统一带 `-hide_banner -loglevel error -y`。

## 6. 依赖与协作

### 6.1 导入

| 来源 | 导入物 | 用途 |
| --- | --- | --- |
| `electron` | `app`、`ipcMain` | 取 `userData/voice` 路径；注册 IPC |
| `node:path` / `node:fs` | `path`、`fs` | 路径拼接、目录创建、写文件、清理 |
| `node:child_process` | `spawn` | 调用 ffmpeg / ffprobe |
| `./voice` | `synthOne`、`resolveVoiceModel`、`voiceFriendlyError` | 单句 TTS 合成、按音色解析模型、错误转中文文案（`voiceFriendlyError` 的实现本轮改为 `src/shared/errors.ts` 的 `friendlyError` 薄包装，**导出名与这里的 import 都没变**） |
| `./projects` | `parseSubtitle`、`type SubtitleLine` | 把字幕文本解析成带 `time/end` 的行数组 |
| `./hfEnv` | `BUILTIN_RESOURCES` | ffmpeg / ffprobe 路径（来自 ffmpeg 运行环境包） |
| `../shared/ipc` | `IPC` | 频道名常量（`IPC.Voice.SynthAligned` / `AlignCancel` / `AlignProgress`） |
| `../shared/types` | `type RegisterCtx`、`type AlignProgressPayload`、`type VoiceAlignPayload` | `register` 与 `resolveVoiceModel` 的上下文参数类型、进度载荷、`voice:synth-aligned` 载荷（三者此前分别为本地接口 / 内联字面量） |

### 6.2 被谁使用

- `src/main/index.ts`：`import * as ttsAlign from './ttsAlign'`，并在主进程注册阶段调用 `ttsAlign.register(ctx)`。其头部注释记录依赖链为 `settings ← htmlAgent ← projects ← voice ← ttsAlign`，且声明无环。
- `src/preload/index.ts`：暴露 `window.voiceTools.synthAligned(payload)`、`cancelAlign()`、`onAlignProgress(cb)`，其中进度订阅为**单订阅**实现（重复注册只替换回调，避免页面切换叠加监听）；频道名取自 `IPC.Voice.*`。
- `src/renderer/src/pages/TextTtsPage/AlignSection.vue`：字幕配音页 UI。单选「重排字幕（音频驱动）/ 修正音频（时间轴驱动）」、最小停顿输入（`min=0 max=10 step=0.1`），结果用 `details` 渲染逐句行，并可「写入当前项目」（`saveSubtitle` + `setAudio`）。

## 7. 注意事项与实现要点

- **Windows 路径处理**：临时目录、输出路径全部用 `path.join` 拼接；仅 concat 列表需要 `win2posix` 转换（正斜杠 + 单引号包裹 + `'\''` 转义），因为 ffmpeg 的 concat demuxer 对反斜杠与引号敏感。concat 调用必须带 `-safe 0` 才允许绝对路径。
- **spawn 参数**：所有 ffmpeg/ffprobe 参数以数组传递，不做 shell 拼接，避免含空格/引号/中文的路径被拆词；`windowsHide: true` 防止 Windows 上闪出控制台窗口。音频相关数值统一 `String()` 后传入。
- **ffmpeg 不再随安装包**：逐句对齐整条链路（试听分段、句间静音、`concat` 装配、时长终验）都依赖 ffmpeg / ffprobe，它们属于 ffmpeg 运行环境包（**包实测 42.6 MB**，解包 179.9 MB；2026-10-14），首次用到时由用户确认后下载并解到 `<userData>/runtime/ffmpeg/`。因此入口第一步就是 `runtime.missingPacks(['ffmpeg'])` 纯校验：缺包只回 `needPacks`，界面弹确认框；**取消下载 = 取消这次对齐**（主进程不下载、不排队、不留半截状态）。
- **统一音频格式**：所有分段、静音、变速产物均为 24kHz 单声道 `pcm_s16le`。这正是 `buildTrack` 能用 `-c copy` 零重编码拼接的前提；`SR = 24000` 与 Qwen-Audio-TTS 原生采样率一致。
- **atempo 后必须重测**：`tempoTo` 在帧粒度下会引入毫秒级偏差，因此模式 B 变速后必须再 `probeDur`，`status`/`delta` 判定都基于重测值；`EPS = 0.05` 用于吸收该误差。
- **加速上限与顺延**：单句最多加速到 `MAX_RATE = 1.15`，超出部分不硬压，而是顺延后续句子并同步平移后续字幕时间；末句无槽位（`Infinity`），永不加速、也不自发顺延。
- **并发控制**：`alignRunning` 是模块级布尔量，进程内一次只允许一个对齐任务，第二个请求立即被拒；但取消与运行并非互斥锁保护，取消只是「置标志 + 句间检查」的软中断。
- **进度回推**：发送前检查 `event.sender && !event.sender.isDestroyed()`，避免窗口已销毁时报错。主进程实际只发送 `synth` / `assemble` / `done` / `error` 四种 `stage`；量取时长阶段刻意不推进度。渲染层若额外判断了其它 `stage`，主进程不会发出。本模块的进度载荷类型 `AlignProgressPayload` 与 handler 载荷 `VoiceAlignPayload` 均取自 `src/shared/types.ts`（原先本地声明的 `AlignProgressInfo` 已删除）。
- **失败清理**：单句合成失败或整轨校验失败时直接 `return` 失败结构，**不做**任务目录删除；目录靠下次任务的 `cleanupOldTasks` 回收。整轨成品保留在 `taskDir` 中，可被渲染层直接播放；若任务被取消，本次 `taskDir` 会在下次任务启动时被清掉。
- **模型与文案**：合成模型优先取 `payload.voiceModel`，其次 `resolveVoiceModel(voiceId, ctx)`；错误统一经 `voiceFriendlyError` 转为可读中文（内部委托 `shared/errors.friendlyError`，并把排障详情以 `（…）` 追加在文案后），失败时截取前 10 个字符标识是哪一句出错。
- **字幕产出格式**：返回的 `subtitleText` 使用 `fmtTime` 的**秒级精度** `[mm:ss] 文本`；而渲染层写回项目时会用 `details` 的毫秒精度起止（`subtitleStart` ~ `subtitleStart + audioDur`）重新生成 `[开始-结束] 文本`，以保证与成片音轨严格一致。
