# src/main/vad.ts

> 零依赖纯函数：WAV 采样读取与 Whisper 字幕段的能量 VAD 静音裁剪

- **所在目录**：src/main/
- **类型**：纯函数工具模块（零依赖，无 IPC、无副作用）
- **规模**：122 行
- **对外导出**：接口 `VadWav`、`VadSegment`，函数 `readWavSamples`、`vadTrimSegments`

## 1. 作用与职责

- **WAV 读取**：`readWavSamples` 从磁盘读 WAV，提取 16bit PCM 样本为 `Int16Array`，并给出采样率与声道数；格式不符时返回 `null`。
- **静音裁剪**：`vadTrimSegments` 基于 20ms 窗口能量做 VAD，把每条字幕段的起点/终点向真实语音边界收敛，去掉前导与尾随静音。
- **共用实现**：原实现自 `src/main/whisper.js` 逐字抽取而来，转 TS 后由 `src/main/whisper.ts` import 复用。
- **可运行约束**：本模块只允许 erasable-only 语法（无 `enum` / `namespace` / 参数属性）。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `VadWav` | `interface` | 字段 `rate: number`、`channels: number`、`samples: Int16Array` |
| `VadSegment` | `interface` | 字段 `start: number`、`end: number`、`text?: string`（可选） |
| `readWavSamples(p)` | `(p: string) => VadWav \| null` | 读文件并解析为 `VadWav`；读失败或格式不符返回 `null` |
| `vadTrimSegments(samples, rate, segs)` | `(samples: Int16Array, rate: number, segs: VadSegment[]) => VadSegment[]` | 就地调整段的 `start` / `end` 并返回段数组；不满足裁剪条件时原样返回 |

模块级 `import` 仅一行：`import fs from 'node:fs'`。

## 3. 关键流程 / 算法

### 3.1 `readWavSamples` 解析流程与支持范围

1. `fs.readFileSync(p)`；抛异常（文件不存在、无权限等）直接 `return null`。
2. 头部校验：`buf.length < 44`，或 `buf.toString('ascii', 0, 4) !== 'RIFF'`，或 `buf.toString('ascii', 8, 12) !== 'WAVE'` → `null`。
3. 读取 `fmt` 字段（按标准 WAV 头部固定偏移）：`channels = readUInt16LE(22)`、`rate = readUInt32LE(24)`、`bits = readUInt16LE(34)`。
4. 位深校验：`bits !== 16` → `null`（**仅支持 16bit PCM**）。
5. chunk 遍历定位 `data`：`off` 从 `12` 起，每次读 `id = ascii(off, off+4)`、`sz = readUInt32LE(off+4)`；`id === 'data'` 时记 `dataOff = off + 8`、`dataLen = Math.min(sz, buf.length - dataOff)` 并 `break`；否则 `off += 8 + sz + (sz & 1)`——`sz & 1` 即 RIFF 规定的**奇数长度补 1 字节对齐**。
6. 循环条件为 `off + 8 <= buf.length`；未找到 `data`（`dataOff < 0`）→ `null`。
7. 样本拷贝：`n = Math.floor(dataLen / 2)`，新建 `Int16Array(n)`，逐样本 `buf.readInt16LE(dataOff + i * 2)`。
8. 返回 `{ rate, channels, samples }`。

**支持范围与局限**

| 维度 | 实情 |
| --- | --- |
| 容器 | 仅 `RIFF....WAVE`，且总长 ≥ 44 字节 |
| 编码 | 仅 16bit PCM；`bits !== 16`（含 float32、8bit、24bit、32bit）一律返回 `null` |
| 采样数据类型 | 有符号小端 16 位整数，装入 `Int16Array` |
| 声道 | 读取 `channels` 但**不做去交织**，`samples` 是原始交错样本 |
| 解析深度 | 只找 `fmt` 的固定偏移与 `data` chunk，不校验 `audioFormat` 字段、不解析 `LIST`/`fact` 等其它 chunk 语义（仅在遍历时按尺寸跳过） |
| 越界保护 | `dataLen` 截到文件尾，样本数向下取整，避免 `readInt16LE` 越界 |

### 3.2 `vadTrimSegments` 算法参数

常量在函数开头一次性算出（`winN`、`tailSilWin`、`leadSilWin` 依赖 `rate`）：

| 参数 | 取值 | 含义 |
| --- | --- | --- |
| `winN` | `Math.max(1, Math.round(rate * 0.02))` | 20ms 分析窗口样本数 |
| `nWin` | `Math.floor(samples.length / winN)` | 完整窗口数 |
| `rms[i]` | 窗口内 `Math.abs` 之和 / `winN` | 平均绝对幅度（实现为平均幅值，非平方根均方） |
| `noiseFloor` | `sorted[Math.max(0, Math.floor(sorted.length * 0.1) - 1)] \|\| 0` | 幅度谱的 10% 分位噪声底 |
| `thr` | `Math.max(noiseFloor * 3, 200)` | 判定阈值；`200` ≈ -44dBFS 均值幅度，绝对兜底 |
| `tailSilWin` | `Math.ceil((0.15 * rate) / winN)` | 尾随静音最少 0.15s 对应的窗口数 |
| `leadSilWin` | `Math.ceil((0.4 * rate) / winN)` | 前导静音最少 0.4s 对应的窗口数 |
| `padSec` | `0.1` | 起点提前量 / 终点尾垫（秒） |
| `minDur` | `0.25` | 裁剪后允许的最短段长（秒） |

### 3.3 `vadTrimSegments` 处理步骤

1. 早退：`nWin < 2` 或 `segs.length === 0` → 直接返回入参 `segs`。
2. 逐窗口算 `rms`；把 `rms` 拷成普通数组并升序排序，得到 `noiseFloor`，进而得到 `thr`。
3. `segs.map((s, i) => ...)` 逐段处理（`i` 用于取相邻段）：
   1. 归一化：`start = Math.max(0, Number(s.start) || 0)`、`end = Math.max(start, Number(s.end) || 0)`（同时容忍非法/非数字输入）。
   2. 映射到窗口区间：`sWin = Math.floor((start * rate) / winN)`、`eWin = Math.min(nWin - 1, Math.ceil((end * rate) / winN))`。
   3. 段过短（`eWin - sWin < 2`）→ 原样返回该段。
   4. 双向扫描找段内第一个 / 最后一个 `rms[w] > thr` 的窗口，得 `firstVoice`、`lastVoice`。
   5. 任一为 `-1`（全段低能量，如整段无语音）→ 原样返回。
   6. **起点裁剪**：仅当 `firstVoice - sWin >= leadSilWin`（段首连续静音 ≥ 0.4s）才前移 `newStart = (firstVoice * winN) / rate - padSec`；随后夹紧：
      `newStart = Math.min(end - minDur, Math.max(newStart, start, prevEnd + 0.05))`，其中 `prevEnd` 为上一段的 `end`（`i > 0`；否则 0）。即：不早于原起点、不早于上一段 end + 0.05s、且至少留出 `minDur`。
   7. **终点裁剪**：仅当 `eWin - lastVoice >= tailSilWin`（段尾连续静音 ≥ 0.15s）才把 `newEnd = ((lastVoice + 1) * winN) / rate + padSec` 前移；随后 `newEnd = Math.min(newEnd, end)`，再夹紧到下一段 `start - 0.05s`（无下一段时 `nextStart = Infinity`，用 `isFinite` 判断，不限）。
   8. 裁后过短（`newEnd - newStart < minDur`）→ 放弃本次裁剪，原样返回。
   9. `newStart === start && newEnd === end`（无变化）→ 原样返回。
   10. 否则写回 `s.start = newStart`、`s.end = newEnd` 并返回 `s`（**就地修改原段对象**）。
4. `map` 返回新数组，但元素仍是原段对象（未裁剪的段返回原引用）。

## 4. 依赖与协作

**import**

| 来源 | 引入内容 |
| --- | --- |
| `node:fs` | `fs`（仅 `readFileSync`） |

除此之外零依赖：不 import Electron、不访问 `app.getPath`、不做 IPC。

**被谁引用**

| 引用方 | 用法 |
| --- | --- |
| `src/main/whisper.ts` | `import { readWavSamples, vadTrimSegments, type VadSegment } from './vad'`；在 `toVadSamples` 中优先对源文件直接调用 `readWavSamples`，失败则用 `BUILTIN_RESOURCES.ffmpeg` 转出临时 WAV（落在 `userData/whisper/vad_<时间戳>.wav`）再读；转录收尾处以固定采样率调用 `vadTrimSegments(vadSamples, 16000, segs)`，失败静默跳过不阻断转录 |

## 5. 注意事项与实现要点

- **时间单位为秒**：`VadSegment.start` / `end` 与算法常量（`padSec`、`minDur`、0.15、0.4、0.05）均为秒；`rate` 为采样率（Hz）。`whisper.ts` 侧固定按 16000 调用，因此传入的采样率必须与实际 WAV 一致。
- **阈值语义**：`thr = max(noiseFloor * 3, 200)` 是**窗口平均绝对幅度**，不是 dB；`200` 对应约 -44dBFS。有背景音乐、持续噪声或高底噪录音时，“段首/段尾静音不足阈值”导致裁剪整体不生效（保持原时间）——这是设计上的保守行为，不是 bug。
- **双向都要求“足够长的静音”**：前导需 ≥ 0.4s、尾随需 ≥ 0.15s，阈值不对称是有意为之；两个门槛任一不满足就完全不动该侧。
- **不越界、不重叠**：新起点被 `prevEnd + 0.05` 限制、新终点被 `nextStart - 0.05` 限制，保证相邻段之间至少留 0.05s 间隔；同时新起点不会早于原 `start`、新终点不会晚于原 `end`（只做“收敛”，不放大）。
- **失败即原样返回**：段过短、全段低能量、裁后不足 `minDur`、无变化，四种情况都返回原段，绝不抛异常；因此调用方可以无条件应用返回值。
- **就地修改**：命中裁剪时 `s.start` / `s.end` 被直接写回原对象，传入的 `segs` 元素会被改动；需要保留原始时间的调用方必须先深拷贝。
- **返回数组可能与入参同一引用**：`nWin < 2` 或 `segs` 为空时返回的就是入参数组本身。
- **`bits !== 16` 即拒绝**：`readWavSamples` 不做任何重采样或位深转换，其它位深/float 格式统一返回 `null`，由调用方通过 ffmpeg 预转换规避。
- **头部偏移假设**：`channels` / `rate` / `bits` 直接读固定偏移 22 / 24 / 34，隐含“`fmt ` 是第一个 chunk 且为标准 16 字节 PCM 头”；非标准布局的 WAV 即使 `data` 能被找到，读出的 `rate` / `channels` 也可能不正确。
- **语法受限**：新增代码必须保持 erasable-only（不得引入 `enum`、`namespace`、构造函数参数属性）。
- **多声道未去交织**：`samples` 为交错样本，若直接对多声道数据做能量统计，等效于把各声道合并统计（本模块正是按此方式使用）。
