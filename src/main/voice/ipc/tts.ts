// src/main/voice/ipc/tts.ts
// voice:* 里「真的去调接口」的两条频道：创建克隆音色（voice:create）与文字合成并落盘（voice:synth）。
// 其余配置 / 列表类频道在 ipc/voices.ts。
//
// 依赖：../api（厂家解析、错误文案、synthOne）/ ../cloneAudio（本地参考音频裁剪）/ ../projects（落盘目录与 project.json 回写）。
import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as projects from '../../projects'
import {
  providerFor,
  getVoiceApiError,
  voiceNoKeyFail,
  parseJsonLike,
  voiceFriendlyError,
  synthOne,
  resolveTtsDir,
  nowStamp,
  isAudioTtsModel
} from '../api'
import { CLONE_PREFIX_MAX, CLONE_SECONDS, makeCloneSample, errMsg } from '../cloneAudio'
import { IPC } from '../../../shared/ipc'
import type { VoiceCreatePayload, VoiceSynthPayload } from '../../../shared/types'

// 本域的注册入口：register.ts 按固定顺序调用它（每个频道只注册一次）。
export function registerTtsIpc(): void {
  // 创建克隆音色：model=<厂家的克隆模型>（千问为 voice-enrollment）+ action=create_voice
  // 音频位置（payload.audioPath）支持三种形态：本地绝对路径、http(s)/oss 远程地址、data:audio/... URI。
  //   · 远程地址与 data URI 直接放进 input.url 透传；
  //   · 本地文件先经 ffmpeg 裁成前 15 秒 24k 单声道 wav，再转 base64 data URI 放进 input.url
  //     （实测 data URI 被接受；文档写的是「公网可访问的 URL」，但并非硬校验，所以不必先传到公网）。
  ipcMain.handle(IPC.Voice.Create, async (_event, payload?: VoiceCreatePayload) => {
    const audioPath = String((payload && payload.audioPath) || '').trim();
    // 目标模型决定这次克隆走哪个厂家（模型属于哪家就用哪家的 Key 与端点）；
    // 没给模型时用当前厂家的默认合成模型。
    const active = providerFor();
    const useModel = String((payload && payload.targetModel) || '').trim() || active.defaultModel;
    const prov = providerFor(undefined, useModel);
    const noKey = getVoiceApiError(prov.def, prov.apiKey);
    if (noKey) return voiceNoKeyFail(noKey);
    // 只有 Qwen-Audio-TTS 系列能作复刻目标模型（vc 那条线已彻底移除，见 catalog 注释）。
    // 系统音色模型（如 qwen3-tts-flash）走不到这里：界面只列 role=clone 的模型，这里再兜一道。
    if (!isAudioTtsModel(useModel)) {
      return { ok: false, message: '模型「' + useModel + '」不支持音色复刻：请把「目标模型」选成 qwen-audio-* 系列（如 qwen-audio-3.0-tts-flash）' };
    }
    if (!audioPath) return { ok: false, message: '请先选择本地音频文件，或粘贴可公开访问的音频 URL' };
    // 远程地址（http/https/oss）与 data URI 都不落本地，直接用
    const isRemoteUrl = /^(https?|oss):\/\//i.test(audioPath);
    const isDataUri = /^data:audio\//i.test(audioPath);
    // input.prefix 仅允许数字/字母/下划线且不超过 CLONE_PREFIX_MAX 个字符
    const preferredName = String((payload && payload.preferredName) || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!preferredName || preferredName.length > CLONE_PREFIX_MAX) {
      return { ok: false, message: '音色名称需 1~' + CLONE_PREFIX_MAX + ' 个字符，仅限数字、字母、下划线' };
    }
    let localSample = '';
    try {
      // input.url：远程地址原样用；本地文件裁 15 秒后转 data URI
      let urlToSend = audioPath;
      if (!isRemoteUrl && !isDataUri) {
        if (!fs.existsSync(audioPath)) return { ok: false, message: '音频文件不存在：' + audioPath };
        try {
          localSample = await makeCloneSample(audioPath);
          urlToSend = 'data:audio/wav;base64,' + fs.readFileSync(localSample).toString('base64');
        } catch (e) {
          return { ok: false, message: '准备参考音频失败：' + errMsg(e) };
        }
      }
      const input = {
        action: 'create_voice',
        target_model: useModel,
        prefix: preferredName,
        url: urlToSend,
        // 文档参数：语种提示（默认 zh）与参考音频最大时长（3~30 秒，默认 10；这里与本地裁剪的 15 秒一致）
        language_hints: ['zh'],
        max_prompt_audio_length: CLONE_SECONDS
      };
      const resp = await fetch(prov.def.apiBase + '/services/audio/tts/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + prov.apiKey },
        body: JSON.stringify({ model: prov.def.enrollModel, input })
      });
      const raw = await resp.text();
      const json = parseJsonLike(raw);
      if (!resp.ok) {
        const code = (json && json.code) || '';
        // 音频类报错单独提示（样本不合规是最常见的原因：太短、无人声、格式不对）
        if (/audio/i.test(code + ' ' + ((json && json.message) || ''))) {
          return {
            ok: false,
            message: '创建音色失败（服务端不接受这段参考音频）：HTTP ' + resp.status
              + ((json && json.message) ? '：' + json.message : '')
              + '。请换一段 3~30 秒、清晰无噪音的人声（本地文件会自动截取前 ' + CLONE_SECONDS + ' 秒）。'
          };
        }
        throw new Error('HTTP ' + resp.status + ((json && json.message) ? '：' + json.message : ''));
      }
      const out = (json && json.output) || {};
      // 严格按文档口径解析创建返回体：只有 output.voice_id（+ usage.count / request_id，不用）。
      // 不再读 output.target_model / fallback_mode / fallback_reason —— 这三个字段文档没有、实测也从未返回过。
      const voice = out.voice_id;
      if (!voice) throw new Error('接口未返回音色 ID（output.voice_id）');
      return {
        ok: true,
        voice: voice,
        // 回执里的模型取「本次请求发的目标模型」（创建返回体不带 target_model）
        targetModel: useModel
      };
    } catch (e) {
      return { ok: false, message: voiceFriendlyError(e, '创建音色失败') };
    } finally {
      // 本地裁出来的参考样本（15 秒 wav）用完即删，别在用户临时目录里留垃圾
      if (localSample) { try { fs.unlinkSync(localSample); } catch (e) { /* 删不掉不影响主流程 */ } }
    }
  });

  // 文字合成语音并保存（两个系列都是「接口 → output.audio.url → 二次下载」，见 synthOne）
  ipcMain.handle(IPC.Voice.Synth, async (_event, payload?: VoiceSynthPayload) => {
    const text = String((payload && payload.text) || '').trim();
    const voice = String((payload && payload.voice) || '').trim();
    if (!text) return { ok: false, message: '合成文本为空' };
    if (!voice) return { ok: false, message: '请先选择（或创建）音色' };
    // 合成使用的模型：优先取「当前音色绑定/选定的模型」，无则回落当前厂家的默认合成模型；
    // 用哪家的 Key 由这个模型决定（synthOne 内部按模型选厂家）。
    const active = providerFor(voice);
    const useModel = String((payload && payload.targetModel) || '').trim() || active.defaultModel;
    const prov = providerFor(voice, useModel);
    const noKey = getVoiceApiError(prov.def, prov.apiKey);
    if (noKey) return voiceNoKeyFail(noKey);
    try {
      const { buf, ext } = await synthOne(text, voice, useModel);

      const projectName = String((payload && payload.projectName) || '').trim();
      const saveDir = String((payload && payload.saveDir) || '').trim();
      const defaultOut = !!(payload && payload.defaultOut);
      // 保存位置三选一（前端显式传入，不再回落持久化 saveDir，避免「保存到项目」被静默忽略）：
      // 自定义目录 > 音频输出目录 > 所选项目 audio/
      const destDir = saveDir
        ? resolveTtsDir('', saveDir)
        : defaultOut
          ? path.join(app.getPath('userData'), 'tts-output')
          : resolveTtsDir(projectName, '');
      fs.mkdirSync(destDir, { recursive: true });
      // 文件名：自定义 audioName（可选）优先；缺省用「时间_前五个字_音色id」
      const NAME_BAD = /[\\/:*?"<>|]/g;
      const customName = String((payload && payload.audioName) || '').trim().replace(NAME_BAD, ' ').replace(/\s+/g, ' ').trim();
      const stamp = nowStamp();
      const short = String(voice).replace(/[^a-zA-Z0-9_]/g, '').slice(-12) || 'voice';
      let base;
      if (customName) {
        base = customName;
      } else {
        const head = Array.from(text).slice(0, 5).join('').replace(NAME_BAD, '').trim() || 'tts';
        base = stamp + '_' + head + '_' + short;
      }
      const saveName = base + '.' + ext;
      const savePath = path.join(destDir, saveName);
      fs.writeFileSync(savePath, buf);

      // 落盘位置回执：仅实际写入项目 audio/ 时才回写 project.json 并返回项目名，
      // 存到自定义目录 / 音频输出目录时不再冒充「已保存到项目」
      let savedTo = saveDir ? 'custom' : defaultOut ? 'output' : 'default';
      let targetName = projectName || '';
      const projectsRoot = projects.projectsRoot();
      if (!saveDir && !defaultOut && projectName) {
        const projDir = path.join(projectsRoot, projectName);
        const pf = path.join(projDir, 'project.json');
        if (fs.existsSync(pf)) {
          try {
            const proj = JSON.parse(fs.readFileSync(pf, 'utf8'));
            proj.ttsAudio = path.join('audio', path.basename(savePath));
            fs.writeFileSync(pf, JSON.stringify(proj, null, 2), 'utf8');
          } catch (e) { /* 不阻断主流程 */ }
        }
        savedTo = 'project';
      } else if (!saveDir && !defaultOut) {
        const projs = projects.scanProjects();
        if (projs && projs.length) { targetName = projs[0].name; savedTo = 'project'; }
        else savedTo = 'output';
      }

      return { ok: true, savePath: savePath, projectName: targetName, savedTo: savedTo, size: buf.length };
    } catch (e) {
      return { ok: false, message: voiceFriendlyError(e, '合成语音失败') };
    }
  });
}
