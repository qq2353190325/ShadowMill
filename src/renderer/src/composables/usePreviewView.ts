// composables/usePreviewView.ts —— 预览的「视角 / 画布」共享状态（模块级单例，与 useAppStore 同一惯例）
//
// 为什么单独成文件：右侧栏的「预览」分组里有视角比例下拉、背景音频等控件，而画面在左侧的
// PreviewSection.vue。控件和画面分家后，viewMode / pageDeclared 必须两边读到同一份值——
// 用 props/emit 来回转发会让「画布一变就自动归位」这条联动散在两个组件里，故收成一份共享状态。
// 约定：只有 PreviewSection 写 pageDeclared（载入预览副本时），只有 PreviewControls 与 PreviewSection
// 读 viewMode；换项目 / 切页回来时由 PreviewSection 在 onMounted 清掉 pageDeclared 的残留。
import { computed, ref } from 'vue'
import type { RenderCanvas } from '@shared/types'
import { appState } from '@renderer/composables/useAppStore'
import { canvasSize, normalizeCanvas } from '@renderer/utils/render'

// 页面自己声明的画布（<html data-resolution>，由 project:preview-html 带回；'' = 老页面没声明）
export const pageDeclared = ref<RenderCanvas | ''>('');
// 项目画布（缺省横屏）——项目属性，生成提示词 / 预览 / 成片三处共用
export const projectCanvas = computed<RenderCanvas>(() => normalizeCanvas(appState.project && appState.project.canvas));
// 页面天然的比例（= 页面声明的画布；无声明时取项目画布）：它就是「视角」的默认值，此时不留黑边
export const pageMode = computed<RenderCanvas>(() => pageDeclared.value || projectCanvas.value);
// 当前视角比例：右侧栏下拉与预览几何共用这一份
export const viewMode = ref<RenderCanvas>(pageMode.value);
export const viewBox = computed(() => canvasSize(viewMode.value));
export const pageBox = computed(() => canvasSize(pageDeclared.value || projectCanvas.value));

// 背景音频变更后要重载预览 iframe 才听得到新音轨：PreviewSection 挂载时注册一次钩子，
// 右侧栏控件只管喊一声，不必认识 PreviewSection（避免跨组件 ref 传递）。
let reloadHook: (() => void | Promise<void>) | null = null;
export function setPreviewReloadHook(fn: (() => void | Promise<void>) | null): void {
  reloadHook = fn;
}
export function requestPreviewReload(): void | Promise<void> {
  return reloadHook?.();
}
