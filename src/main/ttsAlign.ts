// src/main/ttsAlign.ts
// 字幕配音（逐句对齐）：逐句 TTS 合成 → ffprobe 量时长 → 按模式对齐时间轴 → ffmpeg 装配整轨
// 两种模式：
//   audio-driven（重排字幕）：以实测每句时长重建字幕时间线，句间停顿按字幕原有时间间隔推算（放不下时用最小停顿），音频原样拼接
//   timeline-driven（修正音频）：保持字幕时间，每句配音摆放到其字幕时间戳（句间补静音）；
//     超时先 atempo 加速（上限 MAX_RATE），仍超则顺延后续句子并同步平移后续字幕时间
// 提供：planModeA / planModeB / buildTrack + voice:synth-aligned / voice:align-cancel IPC
// 依赖：voice(synthOne / resolveVoiceModel / voiceFriendlyError) / projects(parseSubtitle) /
//       hfEnv(BUILTIN_RESOURCES.ffmpeg / ffprobe) / runtime(确保运行环境包已解包) / electron(app / ipcMain)
import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { synthOne, resolveVoiceModel, voiceFriendlyError } from './voice'
import { parseSubtitle, type SubtitleLine } from './projects'
import { BUILTIN_RESOURCES } from './hfEnv'
import * as runtime from './runtime'
import { IPC } from '../shared/ipc'
import type { AlignProgressPayload, RegisterCtx, VoiceAlignPayload } from '../shared/types'

const MAX_RATE = 1.15; // atempo 加速上限（超过则顺延后续）
const EPS = 0.05;      // 槽位判定容差（秒，吸收 atempo 帧粒度误差）
const SR = 24000;      // 统一采样率（与 Qwen-Audio-TTS 原生一致）
const MIN_SLOT = 0.1;  // 模式 B 单调化时相邻句最小名义槽位（秒）

let alignRunning = false;  // 防抖：一次仅允许一个对齐任务
let alignCancelled = false; // 取消标志（句间检查）

// 对齐段描述（planModeA / planModeB 输出）
export interface AlignSeg {
  index: number
  text: string
  subtitleStart: number
  audioStart: number
  audioDur: number
  status: 'ok' | 'accelerated' | 'pushed'
  rate: number
  delta: number
  wavPath: string
}

// 进度载荷类型统一取自 shared/types.ts 的 AlignProgressPayload（stage: synth | assemble | done | error）

// 秒 → [分:秒]（与 subtitle.js fmtTime 一致：四舍五入到秒）
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// 序号 → 4 位零填充
function pad4(i: number): string {
  return String(i).padStart(4, '0');
}

// 段文件路径（seg/ 子目录；v 后缀 = atempo 变速后的文件）
function segPath(taskDir: string, i: number, v?: boolean): string {
  return path.join(taskDir, 'seg', pad4(i) + (v ? '_v' : '') + '.wav');
}

// Windows 路径 → concat 列表可用的单引号包裹路径（反斜杠转正斜杠，单引号转义）
function win2posix(p: string): string {
  return "'" + String(p).replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
}

// ===== ffmpeg / ffprobe 工具（spawn 样板同 whisper.js：windowsHide + Promise） =====
function runProc(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new Error('无法启动 ' + path.basename(exe) + '：' + err.message)));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(path.basename(exe) + ' 退出码 ' + code + (stderr.trim() ? '：' + stderr.trim().slice(-300) : '')));
    });
  });
}

// ffprobe 量音频时长（秒，float）；失败 reject
async function probeDur(file: string): Promise<number> {
  const out = await runProc(BUILTIN_RESOURCES.ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file
  ]);
  const d = parseFloat(String(out).trim());
  if (!isFinite(d) || d < 0) throw new Error('无法读取音频时长：' + file);
  return d;
}

// 音频 → 24kHz 单声道 pcm_s16le wav（统一格式，避开 mp3 头尾 padding 造成的时间漂移）
async function toWav(src: string, out: string): Promise<void> {
  await runProc(BUILTIN_RESOURCES.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_s16le', out
  ]);
}

// atempo 变速（输出仍 24k 单声道 wav；变速后必须重新 probeDur——帧粒度下时长有毫秒级偏差）
async function tempoTo(wav: string, out: string, rate: number): Promise<void> {
  await runProc(BUILTIN_RESOURCES.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-af', 'atempo=' + rate, '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_s16le', out
  ]);
}

// 生成精确时长静音 wav
async function genSilence(dur: number, out: string): Promise<void> {
  await runProc(BUILTIN_RESOURCES.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=' + SR + ':cl=mono', '-t', String(dur), '-c:a', 'pcm_s16le', out
  ]);
}

// ===== 逐句合成：TTS → 转 wav → 量时长 =====
async function synthSentence(taskDir: string, line: SubtitleLine, i: number, total: number, voiceId: string, useModel: string, send: (info: AlignProgressPayload) => void): Promise<{ wavPath: string; dur: number }> {
  if (alignCancelled) { const e = new Error('已取消') as Error & { canceled?: boolean }; e.canceled = true; throw e; }
  send({ stage: 'synth', index: i, total, percent: Math.round((i * 100) / total), message: '合成第 ' + (i + 1) + '/' + total + ' 句…' });
  const { buf, ext } = await synthOne(line.text, voiceId, useModel);
  const rawPath = path.join(taskDir, 'raw', pad4(i) + '.' + ext);
  fs.writeFileSync(rawPath, buf);
  const wavPath = segPath(taskDir, i);
  await toWav(rawPath, wavPath);
  // 量取时长极快，不单独推送进度，避免界面上「量取第 N 句…」短暂闪现
  const dur = await probeDur(wavPath);
  return { wavPath, dur };
}

// ===== 模式 A：重排字幕（音频驱动）=====
// offset = 首句原时间戳（保留锚点，避免破坏既有时间轴对齐）
// 句间停顿优先按字幕原有时间间隔推算：下一句原时间戳 − 本句实测时长（例：下句 6 秒、本句读 3 秒 → 停顿 3 秒），
// 间隔放不下本句音频（或字幕无时间线、时间为估时）时回落到最小停顿 gap
function planModeA(taskDir: string, lines: SubtitleLine[], durs: number[], gap: number, offset: number): { segs: AlignSeg[]; times: number[] } {
  const segs: AlignSeg[] = [];
  for (let i = 0; i < lines.length; i++) {
    let g = gap;
    if (i > 0) g = Math.max(gap, (lines[i].time - lines[i - 1].time) - durs[i - 1]);
    const subtitleStart = i === 0 ? offset : segs[i - 1].subtitleStart + segs[i - 1].audioDur + g;
    segs.push({
      index: i, text: lines[i].text,
      subtitleStart, audioStart: subtitleStart, audioDur: durs[i],
      status: 'ok', rate: 1, delta: 0, wavPath: segPath(taskDir, i)
    });
  }
  return { segs, times: segs.map((s) => s.subtitleStart) };
}

// ===== 模式 B：修正音频（时间轴驱动）=====
// 前向单遍：shift 平移后续所有句子的起点，后续槽位差不变 → 不会产生新溢出；多句连续超时 shift 自然累加
async function planModeB(taskDir: string, lines: SubtitleLine[], durs: number[]): Promise<{ segs: AlignSeg[]; times: number[] }> {
  const times = lines.map((l) => l.time);
  // Step 0 单调化：乱序时间戳规整为每句至少 MIN_SLOT 名义槽位
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1] + MIN_SLOT) times[i] = times[i - 1] + MIN_SLOT;
  }
  const segs: AlignSeg[] = [];
  for (let i = 0; i < lines.length; i++) {
    let wavPath = segPath(taskDir, i);
    let dur = durs[i];
    let rate = 1;
    let status: AlignSeg['status'] = 'ok';
    let delta = 0;
    const slot = (i < lines.length - 1) ? (times[i + 1] - times[i]) : Infinity; // 末句无槽位：不加速、不自发顺延
    if (dur > slot + EPS) {
      const need = dur / slot;
      const target = Math.min(need, MAX_RATE);
      const vPath = segPath(taskDir, i, true);
      await tempoTo(wavPath, vPath, target);
      dur = await probeDur(vPath); // atempo 后必须重测
      wavPath = vPath;
      rate = target;
      if (dur <= slot + EPS) {
        status = 'accelerated';
      } else {
        // 顶格加速仍放不下（含加速后毫秒级残余溢出）：顺延后续并同步平移字幕时间
        status = 'pushed';
        delta = dur - slot;
        for (let j = i + 1; j < times.length; j++) times[j] += delta;
      }
    }
    segs.push({
      index: i, text: lines[i].text,
      subtitleStart: times[i], audioStart: times[i], audioDur: dur,
      status, rate, delta, wavPath
    });
  }
  return { segs, times };
}

// ===== 装配整轨：静音补齐 + concat 流拷贝（所有段同格式，零重编码）=====
async function buildTrack(taskDir: string, segs: AlignSeg[], outPath: string): Promise<number> {
  const list: string[] = [];
  let cursor = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const sil = s.audioStart - cursor; // 算法保证 ≥ 0（无重叠）
    if (sil > 0.02) {
      const silPath = path.join(taskDir, 'sil', pad4(i) + '.wav');
      await genSilence(sil, silPath);
      list.push('file ' + win2posix(silPath));
    }
    list.push('file ' + win2posix(s.wavPath));
    cursor = s.audioStart + s.audioDur;
  }
  const listPath = path.join(taskDir, 'concat.txt');
  fs.writeFileSync(listPath, list.join('\n'), 'utf8');
  await runProc(BUILTIN_RESOURCES.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath
  ]);
  return await probeDur(outPath);
}

// 清理历史对齐任务临时目录（仅保留本次 taskDir）
function cleanupOldTasks(keepDir: string): void {
  const base = path.join(app.getPath('userData'), 'voice');
  let names: string[] = [];
  try { names = fs.readdirSync(base); } catch (e) { return; }
  names.forEach((n) => {
    if (!/^align-/.test(n)) return;
    const p = path.join(base, n);
    if (p === keepDir) return;
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });
}

function register(ctx?: RegisterCtx): void {
  // 取消当前对齐任务（渲染层 send；主进程在句间检查并中断）
  ipcMain.on(IPC.Voice.AlignCancel, () => { alignCancelled = true; });

  // 逐句合成 + 对齐：payload { projectName, subtitleText, voice, voiceModel, mode, gapSec }
  ipcMain.handle(IPC.Voice.SynthAligned, async (event, payload?: VoiceAlignPayload) => {
    if (alignRunning) return { ok: false, message: '已有对齐任务进行中，请稍候' };
    // 运行环境（ffmpeg / ffprobe 共约 632MB）首次启动可能还在解包：等它就绪再判可执行文件
    const rt = await runtime.ensureRuntime();
    if (!rt.ok) return { ok: false, message: rt.message || '运行环境尚未准备好', detail: rt.detail };
    const ffmpeg = BUILTIN_RESOURCES.ffmpeg;
    const ffprobe = BUILTIN_RESOURCES.ffprobe;
    if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) {
      return { ok: false, message: '未找到内置 ffmpeg/ffprobe（resources/ffmpeg/bin）' };
    }
    const subtitleText = String((payload && payload.subtitleText) || '').trim();
    const voiceId = String((payload && payload.voice) || '').trim();
    const mode = (payload && payload.mode) === 'timeline-driven' ? 'timeline-driven' : 'audio-driven';
    if (!subtitleText) return { ok: false, message: '字幕为空，请先在字幕页生成或填写字幕' };
    if (!voiceId) return { ok: false, message: '请先选择（或创建）音色' };
    let gap = Number(payload && payload.gapSec);
    if (!isFinite(gap)) gap = 0.5;
    gap = Math.min(10, Math.max(0, gap));

    const lines = parseSubtitle(subtitleText);
    if (!lines.length) return { ok: false, message: '字幕为空，请先在字幕页生成或填写字幕' };
    // 合成模型：优先音色绑定模型，无则按音色解析（含全局默认兜底）
    const useModel = String((payload && payload.voiceModel) || '').trim() || resolveVoiceModel(voiceId, ctx);

    const send = (info: AlignProgressPayload) => {
      if (info && event.sender && !event.sender.isDestroyed()) event.sender.send(IPC.Voice.AlignProgress, info);
    };
    const base = path.join(app.getPath('userData'), 'voice');
    const taskDir = path.join(base, 'align-' + Date.now());
    fs.mkdirSync(taskDir, { recursive: true });
    // 按类型分子目录：raw = TTS 原始输出，seg = 统一格式分段（试听/拼装），sil = 句间静音
    ['raw', 'seg', 'sil'].forEach((d) => fs.mkdirSync(path.join(taskDir, d), { recursive: true }));
    cleanupOldTasks(taskDir);

    alignRunning = true;
    alignCancelled = false;
    try {
      send({ stage: 'synth', index: 0, total: lines.length, percent: 0, message: '开始逐句合成（' + lines.length + ' 句）…' });
      const durs: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (alignCancelled) {
          return { ok: false, canceled: true, message: '已取消（已完成 ' + i + '/' + lines.length + ' 句）' };
        }
        try {
          const r = await synthSentence(taskDir, lines[i], i, lines.length, voiceId, useModel, send);
          durs.push(r.dur);
        } catch (e) {
          if ((e as Error & { canceled?: boolean }) && (e as Error & { canceled?: boolean }).canceled) {
            return { ok: false, canceled: true, message: '已取消（已完成 ' + i + '/' + lines.length + ' 句）' };
          }
          const head = Array.from(String(lines[i].text)).slice(0, 10).join('');
          return { ok: false, message: '第 ' + (i + 1) + ' 句（' + head + '…）合成失败：' + voiceFriendlyError(e, '合成语音失败') };
        }
      }

      send({ stage: 'assemble', index: lines.length, total: lines.length, message: '对齐时间轴并装配音轨…' });
      let segs: AlignSeg[];
      let times: number[];
      if (mode === 'timeline-driven') {
        const r = await planModeB(taskDir, lines, durs);
        segs = r.segs; times = r.times;
      } else {
        const r = planModeA(taskDir, lines, durs, gap, lines[0].time); // 保留首句锚点
        segs = r.segs; times = r.times;
      }
      const projectName = String((payload && payload.projectName) || '').trim();
      const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'aligned';
      const outPath = path.join(taskDir, safeName + '_aligned_' + Date.now() + '.wav');
      const totalDur = await buildTrack(taskDir, segs, outPath);
      // 终验：整轨时长 ≈ 末句终点（±0.3s；装配由数百段静音+句子拼接，静音按帧粒度取整会累积毫秒级漂移，
      // 270s 级整轨常见 0.1~0.2s 偏差，真缺失段落会差出数秒，0.3s 不影响异常防护）
      const expected = segs.length ? segs[segs.length - 1].audioStart + segs[segs.length - 1].audioDur : 0;
      if (Math.abs(totalDur - expected) > 0.3) {
        return { ok: false, message: '音轨装配时长校验失败（期望 ' + expected.toFixed(2) + 's，实际 ' + totalDur.toFixed(2) + 's）' };
      }
      const details = segs.map((s) => ({
        index: s.index,
        text: s.text,
        subtitleStart: s.subtitleStart,
        audioStart: s.audioStart,
        audioDur: s.audioDur,
        status: s.status,
        rate: s.rate,
        delta: s.delta,
        segPath: s.wavPath
      }));
      send({ stage: 'done', index: lines.length, total: lines.length, percent: 100, message: '对齐完成：' + lines.length + ' 句 · 总时长 ' + fmtTime(totalDur) });
      return {
        ok: true, mode,
        subtitleText: times.map((t, i) => '[' + fmtTime(t) + '] ' + lines[i].text).join('\n'),
        audioPath: outPath, totalDur, details
      };
    } catch (e) {
      const msg = String(((e as Error) && (e as Error).message) || e);
      send({ stage: 'error', message: msg });
      return { ok: false, message: msg };
    } finally {
      alignRunning = false;
    }
  });
}

export {
  fmtTime,
  planModeA,
  planModeB,
  buildTrack,
  register
};
