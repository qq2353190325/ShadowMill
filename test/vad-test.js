// test/vad-test.js —— whisper 起止静音裁剪（VAD）本地验证脚本
// 运行：node test/vad-test.js（不启动应用、无 UI，仅本地 ffmpeg + 算法验证）
// 用内置 ffmpeg 构造「静音 + 语音 + 静音」组合音频（语音为全幅正弦音，VAD 与真值均为纯能量判定，
// 正弦音与真实语音等效且边界精确可控），以 vad.ts 导出的 readWavSamples / vadTrimSegments
// 实测裁剪结果，与构造边界比对。测试自包含：无任何机器相关 fixture 依赖。
// vad.ts 为零依赖纯模块，经 Node 22+ 原生 type-stripping 直接动态 import，无需编译。
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

(async () => {
  // ===== 1. 加载 VAD 纯函数模块 =====
  const vad = await import('../src/main/vad.ts');

  // ===== 2. 工具 =====
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'vadtest-'));
  const FFMPEG = path.resolve(__dirname, '..', 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe');
  const SR = 24000; // 统一 24k 单声道 s16le

  function run(args) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y'].concat(args), { windowsHide: true });
    if (r.status !== 0) throw new Error('ffmpeg 失败：' + String(r.stderr).slice(-300));
  }

  function genSilence(sec, out) {
    run(['-f', 'lavfi', '-i', 'anullsrc=r=' + SR + ':cl=mono', '-t', String(sec), '-c:a', 'pcm_s16le', out]);
  }

  // 「语音」= 300Hz 全幅正弦（20ms 窗口均值 ≈20855，远超 VAD 阈值 200 与真值阈值 100；静音为 0）
  function genVoice(sec, out) {
    run(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=' + SR + ':duration=' + sec, '-c:a', 'pcm_s16le', out]);
  }

  // 拼接：所有素材同格式（24k 单声道 pcm_s16le），-c copy 无损
  function concatWavs(parts, out) {
    const list = path.join(tmpBase, 'concat-' + Math.random().toString(36).slice(2) + '.txt');
    fs.writeFileSync(list, parts.map((p) => "file '" + p.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
    run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  }

  // 段内实测语音边界：第一个/最后一个「20ms 窗口均值 > 100」的位置
  // （独立于 VAD 的 200 阈值与逐样本尖峰，稳定的参照真值）
  function segmentTruth(samples, rate, from, to) {
    const winN = Math.max(1, Math.round(rate * 0.02));
    const sWin = Math.max(0, Math.floor(from * rate / winN));
    const eWin = Math.min(Math.floor(samples.length / winN) - 1, Math.floor(to * rate / winN));
    let first = -1;
    let last = -1;
    for (let w = sWin; w <= eWin; w++) {
      let sum = 0;
      const off = w * winN;
      for (let j = 0; j < winN; j++) sum += Math.abs(samples[off + j]);
      if (sum / winN > 100) { first = w; break; }
    }
    for (let w = eWin; w >= sWin; w--) {
      let sum = 0;
      const off = w * winN;
      for (let j = 0; j < winN; j++) sum += Math.abs(samples[off + j]);
      if (sum / winN > 100) { last = w; break; }
    }
    if (first < 0) return null;
    return { start: (first * winN) / rate, end: ((last + 1) * winN) / rate };
  }

  const fmt = (s) => s.toFixed(2) + 's';

  // ===== 3. 测试用例（边界由构造可知；v:x = x 秒全幅正弦语音，sil:x = x 秒静音） =====
  // VAD 规则（vad.ts）：前导静音 ≥0.4s 起点前移到语音 -0.1s；尾随静音 ≥0.15s 终点前移到语音 +0.1s；
  // 新起点不早于上一段 end +0.05s，新终点不晚于下一段 start -0.05s；裁后段长不足 0.25s 放弃。
  // 断言按「trimStart / trimEnd」声明：
  //   trimStart=true → 输出 start ≈ 真值起点 - 0.1s（±0.04s）；否则必须等于输入 start
  //   trimEnd=true   → 输出 end   ≈ 真值终点 + 0.1s（±0.04s）；否则必须等于输入 end
  // （合成音频边界精确可知，容差仅覆盖 ffmpeg 采样取整；段边界须落在停顿中间，保证裁剪必然触发、断言非空转）
  const cases = [
    {
      name: '1 前导1.2s + 语音2.0s + 尾随1.5s（单段，前导尾随都裁）',
      parts: ['sil:1.2', 'v:2.0', 'sil:1.5'],
      segs: [{ start: 0, end: 4.7, trimStart: true, trimEnd: true }]
    },
    {
      name: '2 语音A 2.0s + 停顿0.9s + 语音B 1.5s + 尾随1.2s（两段，句间停顿两端裁出）',
      parts: ['v:2.0', 'sil:0.9', 'v:1.5', 'sil:1.2'],
      segs: [{ start: 0, end: 2.45, trimStart: false, trimEnd: true },
             { start: 2.45, end: 5.6, trimStart: true, trimEnd: true }]
    },
    {
      name: '3 前导0.8s + 语音A + 停顿0.3s + 语音B + 尾随0.4s',
      parts: ['sil:0.8', 'v:2.0', 'sil:0.3', 'v:1.2', 'sil:0.4'],
      segs: [{ start: 0, end: 3.0, trimStart: true, trimEnd: true },
             { start: 3.0, end: 4.7, trimStart: false, trimEnd: true }] // 停顿0.3s < 0.4s 起点门槛
    },
    {
      name: '4 连续语音4.0s + 尾随0.05s（尾随不足0.15s → 不裁剪）',
      parts: ['v:2.0', 'v:2.0', 'sil:0.05'],
      segs: [{ start: 0, end: 4.05, trimStart: false, trimEnd: false }]
    },
    {
      name: '5 前导0.2s（不足0.4s → 起点不裁）+ 语音2.0s + 尾随3.3s（终点裁）',
      parts: ['sil:0.2', 'v:2.0', 'sil:3.3'],
      segs: [{ start: 0, end: 5.5, trimStart: false, trimEnd: true }]
    },
    {
      name: '6 全静音段（无语音 → 保持原时间）',
      parts: ['sil:5'],
      segs: [{ start: 0.5, end: 4.5, trimStart: false, trimEnd: false }]
    }
  ];

  // ===== 4. 执行 =====
  console.log('= whisper VAD 起止裁剪验证（合成语音，构造边界）=\n');
  let passN = 0;
  let failN = 0;
  for (const c of cases) {
    const parts = c.parts.map((p) => {
      const [kind, val] = p.split(':');
      const f = path.join(tmpBase, kind + '-' + val + '-' + Math.random().toString(36).slice(2) + '.wav');
      if (kind === 'sil') genSilence(Number(val), f);
      else genVoice(Number(val), f);
      return f;
    });
    const wav = path.join(tmpBase, 'case-' + Math.random().toString(36).slice(2) + '.wav');
    concatWavs(parts, wav);
    const { samples, rate } = vad.readWavSamples(wav);
    const segs = c.segs.map((s) => ({ start: s.start, end: s.end, text: 'x' }));
    const out = vad.vadTrimSegments(samples, rate, segs);

    console.log('[' + c.name + ']（总长 ' + fmt(samples.length / rate) + '）');
    let caseOk = true;
    c.segs.forEach((inSeg, i) => {
      const got = out[i];
      const truth = segmentTruth(samples, rate, inSeg.start, inSeg.end);
      let startOk;
      let endOk;
      let startNote = '';
      let endNote = '';
      if (inSeg.trimStart) {
        startOk = truth && Math.abs(got.start - (truth.start - 0.1)) <= 0.04;
        startNote = '≈真值起点' + (truth ? fmt(truth.start) : '?') + '-0.1';
      } else {
        startOk = got.start === inSeg.start;
        startNote = '=输入 ' + fmt(inSeg.start);
      }
      if (inSeg.trimEnd) {
        endOk = truth && Math.abs(got.end - (truth.end + 0.1)) <= 0.04;
        endNote = '≈真值终点' + (truth ? fmt(truth.end) : '?') + '+0.1';
      } else {
        endOk = got.end === inSeg.end;
        endNote = '=输入 ' + fmt(inSeg.end);
      }
      if (!startOk || !endOk) caseOk = false;
      console.log('  段' + (i + 1) + ' 输入 ' + fmt(inSeg.start) + '~' + fmt(inSeg.end) +
        ' → 输出 ' + fmt(got.start) + '~' + fmt(got.end) +
        (truth ? '（真值语音 ' + fmt(truth.start) + '~' + fmt(truth.end) + '）' : '（段内无语音）') +
        '\n     起点 ' + (startOk ? '✓' : '✗') + ' ' + startNote + ' · 终点 ' + (endOk ? '✓' : '✗') + ' ' + endNote);
    });
    if (caseOk) passN++;
    else failN++;
    console.log('');
  }
  console.log('结果：' + passN + ' 通过 / ' + failN + ' 失败');
  process.exit(failN ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
