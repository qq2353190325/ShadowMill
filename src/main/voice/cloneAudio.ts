// src/main/voice/cloneAudio.ts
// 克隆参考音频的准备（本地文件 → 前 15 秒 / 24kHz / 单声道 wav）。
//
// 为什么要先在本地裁：create_voice 只用参考音频的前 max_prompt_audio_length 秒（3~30，默认 10），
// 整段上传毫无意义，还会把 base64 请求体撑大（15 秒 24k 单声道 wav ≈ 700KB，比原文件直传小一个量级）。
// 端点：POST /services/audio/tts/customization，input.url —— **既收公网 URL，也收 data: 音频 URI**
// （官方文档只写了「要求公网可访问的 URL」；2026-10-14 实测 data URI 同样返回 200 并成功合成，
//  所以本地文件不必再先传到公网）。
//
// 依赖：electron(app 的 temp 目录) / hfEnv（随包 ffmpeg、ffprobe）。不注册 IPC。
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { BUILTIN_RESOURCES } from '../hfEnv'

const CLONE_SR = 24000;   // 与 Qwen-Audio-TTS 原生采样率一致
const CLONE_SECONDS = 15; // 截取的参考音频时长（官方推荐 10~20 秒清晰人声）
const CLONE_PREFIX_MAX = 10; // input.prefix 仅允许数字/英文字母且不超过 10 字符

// ffmpeg / ffprobe 调用样板（同 whisper.ts / ttsAlign.ts：windowsHide + Promise，不引第三方依赖）
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
async function probeDuration(file: string): Promise<number> {
  const out = await runProc(BUILTIN_RESOURCES.ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file
  ]);
  const d = parseFloat(String(out).trim());
  if (!isFinite(d) || d < 0) throw new Error('无法读取音频时长：' + file);
  return d;
}

// 本地音频 → 参考样本 wav（截前 CLONE_SECONDS 秒、单声道、24kHz、pcm_s16le）。
// 返回的临时文件由调用方在 finally 里删除；时长不足 3 秒直接报错（服务端要求 3~30 秒）。
async function makeCloneSample(src: string): Promise<string> {
  const ffmpeg = BUILTIN_RESOURCES.ffmpeg;
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(BUILTIN_RESOURCES.ffprobe)) {
    throw new Error('未找到内置 ffmpeg/ffprobe（运行环境包可能还没解包完成），无法裁取参考音频');
  }
  const dur = await probeDuration(src);
  if (dur < 3) {
    throw new Error('参考音频太短（' + dur.toFixed(1) + ' 秒）：声音复刻要求 3~30 秒的清晰人声');
  }
  const out = path.join(app.getPath('temp'), 'shadowmill-clone-' + Date.now() + '.wav');
  await runProc(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-vn', '-t', String(CLONE_SECONDS), '-ac', '1', '-ar', String(CLONE_SR), '-c:a', 'pcm_s16le', out
  ]);
  return out;
}

// 错误对象 → 消息串（多处 catch 共用）
function errMsg(e: unknown): string {
  return (e as Error) && (e as Error).message ? (e as Error).message : String(e);
}

export { CLONE_SECONDS, CLONE_PREFIX_MAX, makeCloneSample, errMsg };
