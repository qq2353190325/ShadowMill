// pages/SubtitlePage/helpers.ts —— 字幕页纯函数（原 JS 版 subtitle 模块 index.js 的工具段移植）
// fmtTime / fmtTimeMs 已合并至 utils/time.ts（与 TextTtsPage 的 align 卡共用）。
import { fmtTimeMs } from '@renderer/utils/time'

export interface SubtitleItem {
  start: number
  end: number | null
  text: string
}

// 无时间戳行的估时规则（与主进程 parseSubtitle 保持一致：max(2.4, 1.6 + 字数 * 0.15)）
export function estDur(text: string): number {
  const t = String(text || '');
  return Math.max(2.4, 1.6 + t.length * 0.15);
}

// 时间输入解析：支持 分:秒 / 分:秒.毫秒 / 纯秒数；失败返回 null
export function parseTime(str: string): number | null {
  const t = String(str == null ? '' : str).trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (m) return (+m[1]) * 60 + (+m[2]) + (m[3] !== undefined ? (+m[3]) / Math.pow(10, m[3].length) : 0);
  m = t.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]);
  return null;
}

// 秒 → [分:秒.毫秒] 输入显示用（去尾零，如 00:17.9）
export function fmtTimeTrim(sec: number): string {
  const t = Math.max(0, Number(sec) || 0);
  const s = Math.floor(t);
  let ms = Math.round((t - s) * 1000);
  if (ms >= 1000) {
    ms = 0;
    return String(Math.floor((s + 1) / 60)).padStart(2, '0') + ':' + String((s + 1) % 60).padStart(2, '0');
  }
  const base = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  return base + (ms ? '.' + String(ms).replace(/0+$/, '') : '');
}

// 缺失的结束时间由下一行起始时间推导；末条按时长估算（已有真实结束时间的行不覆盖）
export function fillEnds(list: SubtitleItem[]): SubtitleItem[] {
  list.forEach((it, i) => {
    const start = Number(it.start) || 0;
    if (isFinite(Number(it.end)) && Number(it.end) > start) return;
    const next = list[i + 1];
    const end = next ? Number(next.start) || 0 : start + estDur(it.text);
    it.end = end > start ? end : start + estDur(it.text);
  });
  return list;
}

// 解析项目字幕文本 → 条目数组（支持 [分:秒] / [分:秒-分:秒]（秒可带小数=毫秒精度）与纯文本行）
export function parseSubtitleText(text: string): SubtitleItem[] {
  // 小数部分按位数解释：.9 = 0.9s、.900 = 0.9s（3 位=毫秒），与落盘 fmtTimeMs 对齐
  const frac = (digits: string | undefined) => (digits === undefined ? 0 : (+digits) / Math.pow(10, digits.length));
  const lines = String(text == null ? '' : text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const list: SubtitleItem[] = [];
  let autoT = 0.4;
  lines.forEach((line) => {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?(?:\s*-\s*(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?)?\]\s*(.*)$/);
    let txt = line;
    let time: number | null = null;
    let end: number | null = null;
    if (m) {
      txt = m[7].trim();
      time = (+m[1]) * 60 + (+m[2]) + frac(m[3]);
      if (m[4] !== undefined) {
        const e = (+m[4]) * 60 + (+m[5]) + frac(m[6]);
        if (e > time) end = e;
      }
    }
    if (!txt) return;
    if (time === null) {
      time = autoT;
      autoT += estDur(txt);
    }
    list.push({ start: time, end, text: txt });
  });
  return fillEnds(list);
}

// 条目数组 → 项目字幕文本（[开始-结束] 毫秒精度；结束时间按真实值写入，供 HTML 生成严格按窗口显示）
export function serializeItems(list: SubtitleItem[]): string {
  return list
    .filter((it) => String(it.text || '').trim())
    .map((it) => {
      const txt = String(it.text).replace(/\s+/g, ' ').trim();
      if (it.start === null || it.start === undefined || !isFinite(Number(it.start))) return txt;
      const s = Number(it.start);
      const e = Number(it.end);
      return '[' + fmtTimeMs(s) + (isFinite(e) && e > s ? '-' + fmtTimeMs(e) : '') + '] ' + txt;
    })
    .join('\n');
}

// 条目 → 纯文本（每行一条，无时间线，供「复制字幕」使用）
export function plainText(list: SubtitleItem[]): string {
  return list
    .filter((it) => String(it.text || '').trim())
    .map((it) => String(it.text).replace(/\s+/g, ' ').trim())
    .join('\n');
}

// 秒 → SRT 时间戳（时:分:秒,毫秒）
export function fmtSrt(sec: number): string {
  const t = Math.max(0, Number(sec) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor(t / 60) % 60;
  const s = Math.floor(t) % 60;
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
}

// 条目 → SRT 文本（序号 / 时间轴 / 文本，块间空行）
export function itemsToSrt(list: SubtitleItem[]): string {
  return list
    .filter((it) => String(it.text || '').trim())
    .map((it, i) => {
      const start = Number(it.start) || 0;
      let end = Number(it.end);
      if (!isFinite(end) || end <= start) end = start + estDur(String(it.text || ''));
      return (i + 1) + '\n' + fmtSrt(start) + ' --> ' + fmtSrt(end) + '\n' + String(it.text).replace(/\s+/g, ' ').trim();
    })
    .join('\n\n');
}

// SRT 文本 → 条目：按空行分块解析 序号/时间轴/文本；
// 块内带时间轴 → 其后各行合并为该条文本；块内无时间轴 → 纯文本兜底，每行一条自动估时
export function parseSrtText(text: string): SubtitleItem[] {
  const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const list: SubtitleItem[] = [];
  let autoT = 0.4;
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1; // 跳过序号行
    let start: number | null = null;
    let end: number | null = null;
    const tm = i < lines.length ? lines[i].match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/) : null;
    if (tm) {
      start = (+tm[1]) * 3600 + (+tm[2]) * 60 + (+tm[3]) + (+tm[4]) / 1000;
      end = (+tm[5]) * 3600 + (+tm[6]) * 60 + (+tm[7]) + (+tm[8]) / 1000;
      i += 1;
      const txt = lines.slice(i).join(' ').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      if (!isFinite(end) || end <= start) end = start + estDur(txt);
      autoT = Math.max(autoT, end);
      list.push({ start, end, text: txt });
    } else {
      // 纯文本兜底：无时间轴的块，每行一条字幕，自动估时
      for (const ln of lines.slice(i)) {
        const txt = ln.replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        const s = autoT;
        const e = s + estDur(txt);
        autoT = e;
        list.push({ start: s, end: e, text: txt });
      }
    }
  }
  // 注意：不经过 fillEnds——每条块的结束时间已显式给出或已估时，fillEnds 会按下一条起始覆盖显式结束时间
  return list;
}
