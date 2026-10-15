// utils/render.ts —— 视频渲染档位的选项表与纯函数（无状态，不依赖 Vue）
// 档位只有两项（普通用户）：质量 quality（draft|standard|high）、帧率 fps（24|30）。
// 优先级约定：项目级覆盖 > 全局默认（settings.json 的 render）> 内置默认（standard / 30）；
// 覆盖里缺省的字段跟随上一级，不被默认值顶掉。
//
// 另外这里放**成片画布**（RenderCanvas）：它**不是渲染档位**、不走上面那套层级——它是项目属性
// （project.json 的 canvas，只在「HTML生成」页的「画布」下拉里选），缺省即 DEFAULT_CANVAS。
// 取值与尺寸取自 @shared/constants（唯一真源，与 HyperFrames CLI 的画布预设对齐）。
import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, RENDER_CANVASES } from '@shared/constants'
import type { RenderCanvas, RenderFps, RenderOptions, RenderOverride, RenderQuality } from '@shared/types'

// 质量三档：draft 编码最快但文字边缘可能有压缩痕迹，只适合「快速看结构」
export const RENDER_QUALITY_OPTIONS: { value: RenderQuality; label: string; hint: string }[] = [
  { value: 'draft', label: '快速预览', hint: '编码最快、画质较低；仅用于快速确认内容与节奏' },
  { value: 'standard', label: '标准', hint: '默认档位，画质与耗时均衡' },
  { value: 'high', label: '高画质', hint: '编码最慢，文字最清晰；适合最终交付' }
]

// 帧率两档：降帧率不会缩短时长，只是采样更稀（省时间的是总帧数）
export const RENDER_FPS_OPTIONS: { value: RenderFps; label: string }[] = [
  { value: 30, label: '30（标准）' },
  { value: 24, label: '24（省资源）' }
]

export const RENDER_QUALITY_VALUES: RenderQuality[] = ['draft', 'standard', 'high']
export const RENDER_FPS_VALUES: RenderFps[] = [24, 30]
export const FALLBACK_RENDER: RenderOptions = { quality: 'standard', fps: 30 }

// 覆盖规范化：只保留合法字段，未给/非法一律丢弃（缺省即继承上一级）
export function pickRenderOverride(raw: unknown): RenderOverride {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: RenderOverride = {};
  if (RENDER_QUALITY_VALUES.indexOf(src.quality as RenderQuality) >= 0) out.quality = src.quality as RenderQuality;
  if (RENDER_FPS_VALUES.indexOf(Number(src.fps) as RenderFps) >= 0) out.fps = Number(src.fps) as RenderFps;
  return out;
}

// 有效档位 = 基准（全局默认） ⊕ 覆盖（项目级）
export function resolveRenderOptions(base: unknown, override?: unknown): RenderOptions {
  const b = Object.assign({}, FALLBACK_RENDER, pickRenderOverride(base));
  const o = pickRenderOverride(override);
  return { quality: o.quality || b.quality, fps: o.fps || b.fps };
}

// 覆盖是否真的改变了生效档位（用于 UI 标注「本项目自定义」与显示「恢复默认」）
export function isRenderOverridden(defaults: RenderOptions, override?: unknown): boolean {
  const o = pickRenderOverride(override);
  return (o.quality !== undefined && o.quality !== defaults.quality)
    || (o.fps !== undefined && o.fps !== defaults.fps);
}

export function renderQualityLabel(quality: RenderQuality): string {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === quality);
  return hit ? hit.label : String(quality);
}

// 档位摘要文案，如「标准 · 30fps」
export function renderOptionsText(options: RenderOptions): string {
  return renderQualityLabel(options.quality) + ' · ' + options.fps + 'fps';
}

// ===== 成片画布（项目属性，不是渲染档位）=====
// 下拉选项：值 + 「横屏 16:9（1920×1080）」这样的文案（明文都取自 shared/constants，避免与提示词说法漂移）
export const RENDER_CANVAS_OPTIONS: { value: RenderCanvas; label: string }[] = RENDER_CANVASES.map((c) => ({
  value: c,
  label: CANVAS_LABELS[c] + '（' + CANVAS_SIZES[c].width + '×' + CANVAS_SIZES[c].height + '）'
}))

export function canvasLabel(canvas: RenderCanvas): string {
  return CANVAS_LABELS[canvas] || String(canvas)
}

// 画布像素（= composition 尺寸 = 成片尺寸）：预览 iframe 与缩放比都按它算
export function canvasSize(canvas: RenderCanvas): { width: number; height: number } {
  return CANVAS_SIZES[canvas] || CANVAS_SIZES[DEFAULT_CANVAS]
}

// 项目里的画布值可能是脏数据（手改过 project.json / 更早的记录）：非法一律落回 DEFAULT_CANVAS
export function normalizeCanvas(raw: unknown): RenderCanvas {
  return RENDER_CANVASES.indexOf(raw as RenderCanvas) >= 0 ? raw as RenderCanvas : DEFAULT_CANVAS
}
