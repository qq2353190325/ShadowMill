// src/main/voice/vad.ts —— 能量 VAD 起止静音裁剪（纯函数、零依赖，供 whisper 转录与 test/vad-test.js 共用）
// 原实现自 src/main/whisper.js 逐字抽取（Phase 3 转 TS 后 whisper.ts 改从这里 import）。
// 约束：本模块只允许 erasable-only 语法（无 enum/namespace/参数属性），
// 以便 Node 22+ 原生 type-stripping 直接运行（test/vad-test.js 动态 import）。
import fs from 'node:fs'

export interface VadWav {
  rate: number
  channels: number
  samples: Int16Array
}

export interface VadSegment {
  start: number
  end: number
  text?: string
}

// 读取 WAV 的 16bit PCM 样本（最小解析 fmt/data 两个 chunk；格式不符返回 null）
export function readWavSamples(p: string): VadWav | null {
  let buf: Buffer
  try {
    buf = fs.readFileSync(p)
  } catch (e) {
    return null
  }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  const channels = buf.readUInt16LE(22)
  const rate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  if (bits !== 16) return null
  let off = 12
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const sz = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      dataOff = off + 8
      dataLen = Math.min(sz, buf.length - dataOff)
      break
    }
    off += 8 + sz + (sz & 1)
  }
  if (dataOff < 0) return null
  const n = Math.floor(dataLen / 2)
  const samples = new Int16Array(n)
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(dataOff + i * 2)
  return { rate, channels, samples }
}

// 能量 VAD 裁剪：20ms 窗口 RMS；噪声底取 10% 分位，阈值 = max(噪声底×3, 绝对兜底)。
// 起止双向裁剪：start 前导静音 ≥0.4s 才前移，end 尾随静音 ≥0.15s 才前移；
// 新起点不早于上一段 end + 0.05s，新终点不晚于下一段 start - 0.05s；
// 裁后段长不足 0.25s 或全段无有效语音时放弃（保持原时间）。
// 有背景音乐等无静音场景不生效（保持原时间），失败也静默跳过不阻断转录。
export function vadTrimSegments(samples: Int16Array, rate: number, segs: VadSegment[]): VadSegment[] {
  const winN = Math.max(1, Math.round(rate * 0.02))
  const nWin = Math.floor(samples.length / winN)
  if (nWin < 2 || !segs.length) return segs
  const rms = new Float64Array(nWin)
  for (let i = 0; i < nWin; i++) {
    let sum = 0
    const off = i * winN
    for (let j = 0; j < winN; j++) sum += Math.abs(samples[off + j])
    rms[i] = sum / winN
  }
  const sorted = Array.from(rms).sort((a, b) => a - b)
  const noiseFloor = sorted[Math.max(0, Math.floor(sorted.length * 0.1) - 1)] || 0
  const thr = Math.max(noiseFloor * 3, 200) // 200 ≈ -44dBFS 均值幅度，绝对兜底
  const tailSilWin = Math.ceil((0.15 * rate) / winN) // 尾随静音最少 0.15s
  const leadSilWin = Math.ceil((0.4 * rate) / winN) // 前导静音最少 0.4s
  const padSec = 0.1 // 提前量 / 尾垫
  const minDur = 0.25

  return segs.map((s, i) => {
    const start = Math.max(0, Number(s.start) || 0)
    const end = Math.max(start, Number(s.end) || 0)
    const sWin = Math.floor((start * rate) / winN)
    const eWin = Math.min(nWin - 1, Math.ceil((end * rate) / winN))
    if (eWin - sWin < 2) return s // 段过短，无裁剪意义

    // 段内第一个 / 最后一个高于阈值的窗口（起点终点共用）
    let firstVoice = -1
    for (let w = sWin; w <= eWin; w++) {
      if (rms[w] > thr) {
        firstVoice = w
        break
      }
    }
    let lastVoice = -1
    for (let w = eWin; w >= sWin; w--) {
      if (rms[w] > thr) {
        lastVoice = w
        break
      }
    }
    if (firstVoice < 0 || lastVoice < 0) return s // 全段低能量：维持原时间

    // 起点裁剪：段首连续静音 ≥0.4s 时前移到语音开始 - 0.1s 提前量
    let newStart = start
    if (firstVoice - sWin >= leadSilWin) {
      newStart = (firstVoice * winN) / rate - padSec
      const prevEnd = i > 0 ? Number(segs[i - 1].end) || 0 : 0
      newStart = Math.min(end - minDur, Math.max(newStart, start, prevEnd + 0.05))
    }

    // 终点裁剪：段尾连续静音 ≥0.15s 时前移到语音结束 + 0.1s 尾垫
    let newEnd = end
    if (eWin - lastVoice >= tailSilWin) {
      newEnd = ((lastVoice + 1) * winN) / rate + padSec
      newEnd = Math.min(newEnd, end)
      const nextStart = segs[i + 1] ? Number(segs[i + 1].start) : Infinity
      newEnd = Math.min(newEnd, isFinite(nextStart) ? nextStart - 0.05 : Infinity)
    }
    if (newEnd - newStart < minDur) return s // 裁后过短：放弃本次裁剪
    if (newStart === start && newEnd === end) return s
    s.start = newStart
    s.end = newEnd
    return s
  })
}
