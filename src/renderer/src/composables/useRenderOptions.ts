// composables/useRenderOptions.ts —— 视频渲染档位：全局默认（settings.json）载入 + 项目级覆盖写入
// 生效档位 = 全局默认 ⊕ 当前项目覆盖（项目覆盖优先，缺省项跟随全局默认）。
// 全局默认在 App.vue 启动时经 loadRenderDefaults() 载入一次；页面读 renderDefaults / effectiveRenderOptions()。
import { reactive } from 'vue'
import type { RenderOptions, RenderOverride } from '@shared/types'
import { FALLBACK_RENDER, pickRenderOverride, resolveRenderOptions } from '@renderer/utils/render'
import { appState } from '@renderer/composables/useAppStore'

// 全局默认档位（模块级 reactive 单例，与 appState 同一模式）
export const renderDefaults = reactive<RenderOptions>(Object.assign({}, FALLBACK_RENDER));

// 读取 settings.json 的 render 段（失败/缺省则沿用内置默认 standard / 30）
export async function loadRenderDefaults(): Promise<void> {
  try {
    const s = await window.settingsTools.get();
    Object.assign(renderDefaults, resolveRenderOptions(s && s.render));
  } catch (e) { /* 读取失败：沿用内置默认，不打断启动 */ }
}

// 当前生效档位：无项目时不看覆盖
export function effectiveRenderOptions(): RenderOptions {
  const override = appState.project && appState.project.render;
  return resolveRenderOptions(renderDefaults, override);
}

// 保存全局默认（设置页）
export async function saveRenderDefaults(next: RenderOptions): Promise<{ ok: boolean; message?: string }> {
  const res = await window.settingsTools.saveRender(next);
  if (res && res.ok) Object.assign(renderDefaults, resolveRenderOptions(res.settings.render));
  return { ok: !!(res && res.ok), message: (res as { message?: string })?.message };
}

// 保存项目级覆盖（视频页档位变化时调用）；render 传 null 表示清除覆盖、回到跟随全局默认
export async function saveProjectRenderOverride(render: RenderOverride | null): Promise<{ ok: boolean; message?: string }> {
  if (!appState.currentName) return { ok: true }; // 无当前项目：档位选择只在本次会话生效
  const res = await window.projectTools.setRender(appState.currentName, render);
  if (res && res.ok && appState.project) {
    appState.project.render = pickRenderOverride(res.project && res.project.render);
  }
  return { ok: !!(res && res.ok), message: (res as { message?: string })?.message };
}
