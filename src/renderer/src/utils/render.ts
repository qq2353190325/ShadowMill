// utils/render.ts —— 视频渲染档位的选项表与纯函数（无状态，不依赖 Vue）
// 档位只有两项（普通用户）：质量 quality（draft|standard|high）、帧率 fps（24|30）。
// 优先级约定：项目级覆盖 > 全局默认（settings.json 的 render）> 内置默认（standard / 30）；
// 覆盖里缺省的字段跟随上一级，不被默认值顶掉。
import type { RenderFps, RenderOptions, RenderOverride, RenderQuality } from '@shared/types'

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
