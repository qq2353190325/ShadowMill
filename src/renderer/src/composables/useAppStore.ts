// composables/useAppStore.ts —— 全局项目状态（原 window.App 的 AppState + refreshProject/switchProject/saveProjectCtx）
// 模块级 reactive 单例；localStorage key 'myapp.projectCtx' 与结构不变（prod file:// 同源，上下文自动延续）。
import { computed, reactive, ref } from 'vue'
import type { ProjectMeta, RenderOverride } from '@shared/types'
import { pickRenderOverride } from '@renderer/utils/render'

// ===== 页面键（与菜单 data-page 一致）======
// 视频环节的页面键是 video-preview（页名「视频预览」）：转视频动作已并入「HTML生成」页，本页只做预览。
export type PageKey = 'home' | 'about' | 'content' | 'text-tts' | 'subtitle' | 'html-gen' | 'video-preview' | 'sound-copy' | 'settings'

// ===== 项目状态结构（与主进程 project.json 字段对应） =====
export interface ProjectState {
  name: string
  title: string
  subtitle: string
  htmlPath: string
  videoPath: string
  audioFile: string
  videoMaterial: string
  htmlExists: boolean
  videoExists: boolean
  subtitleCount: number
  content: { style: string; scenes: { id: string; narration: string; visual: string; durHint: string }[] }
  // 视频渲染档位的项目级覆盖（字段缺省 = 跟随全局默认；见 composables/useRenderOptions.ts）
  render?: RenderOverride
}
export interface BuiltinProject {
  name: string
  title: string
  htmlPath: string
  htmlExists: boolean
  videoExists: boolean
  subtitle: string
}
// project:list 的条目结构来自跨进程契约（shared/types.ts），此处只做再导出，避免两处漂移
export type { ProjectMeta };

export const appState = reactive({
  currentName: 'demo-project',
  isBuiltin: false,
  project: null as ProjectState | null, // 当前项目详情
  myProjects: [] as ProjectMeta[],      // 我的项目列表
  builtinProjects: [] as BuiltinProject[] // 内置示例项目
});

export const activeMenu = ref<PageKey>('home');

// ===== 链路状态判定（原 has* 函数 → computed） =====
export const hasSubtitle = computed(() => {
  const p = appState.project;
  return !appState.isBuiltin && !!(p && p.subtitle);
});
// 仅当存在真实 HTML 路径且非内置示例时才视为“已生成”：内置示例的 HTML 属于只读示例资源，不算用户生成产物
export const hasHtml = computed(() => {
  const p = appState.project;
  return !appState.isBuiltin && !!(p && p.htmlExists && p.htmlPath);
});
export const hasVideo = computed(() => {
  const p = appState.project;
  return !!(p && p.videoExists);
});
// 内容脚本是否具备：非内置且存在至少一条场景（向后兼容：无 content 字段视为空）
export const hasContent = computed(() => {
  const p = appState.project;
  return !appState.isBuiltin && !!(p && p.content && Array.isArray(p.content.scenes) && p.content.scenes.length);
});
// 配音是否具备（本阶段近似判断）：项目内已有背景音频/生成语音即视为已产出声，后续可按实际配音产物细化
export const hasAudio = computed(() => {
  const p = appState.project;
  return !appState.isBuiltin && !!(p && p.audioFile);
});

export function saveProjectCtx(): void {
  localStorage.setItem('myapp.projectCtx', JSON.stringify({ name: appState.currentName, builtin: appState.isBuiltin }));
}

export async function refreshProject(): Promise<void> {
  const [projs, built] = await Promise.all([
    window.projectTools.list().catch(() => []),
    window.hfTools.listProjects().catch(() => [])
  ]);
  appState.myProjects = projs;
  appState.builtinProjects = built.map((b) => ({
    name: b.name,
    title: b.name,
    htmlPath: b.html,
    htmlExists: !!b.html, // 存在性来源显式化：主进程 list 已按 index.html 是否存在过滤；b.html 为空时绝不标 true
    videoExists: false,
    subtitle: ''
  }));

  if (appState.isBuiltin) {
    const entry = appState.builtinProjects.find((b) => b.name === appState.currentName);
    if (!entry) {
      appState.currentName = (appState.myProjects[0] && appState.myProjects[0].name) || 'demo-project';
      appState.isBuiltin = false;
      saveProjectCtx();
    } else {
      appState.project = Object.assign({}, entry) as ProjectState;
      return;
    }
  }

  let entry = appState.myProjects.find((p) => p.name === appState.currentName);
  if (!entry) {
    appState.currentName = (appState.myProjects[0] && appState.myProjects[0].name) || 'demo-project';
    entry = appState.myProjects.find((p) => p.name === appState.currentName);
  }
  const loaded = await window.projectTools.load(appState.currentName);
  // 主进程仅在项目名为空（currentName === ''）时返回 null；正常路径恒返回 Project。
  // 历史实现在这里会直接解引用 null（运行时报错），此处显式兜底为「无当前项目」，由页面走空态。
  if (!loaded) {
    appState.project = null;
    return;
  }
  appState.project = {
    name: loaded.name,
    title: loaded.title || '字幕动画',
    subtitle: loaded.subtitle || '',
    htmlPath: loaded.htmlPath || '',
    videoPath: loaded.videoPath || '',
    audioFile: loaded.audioFile || '',
    videoMaterial: loaded.videoMaterial || '',
    htmlExists: !!(entry && entry.hasHtml),
    videoExists: !!(entry && entry.hasVideo),
    subtitleCount: loaded.subtitleCount || 0,
    content: loaded.content || { style: '', scenes: [] },
    // 渲染档位覆盖：只保留合法字段，脏数据/缺省一律归为空覆盖（= 跟随全局默认）
    render: pickRenderOverride(loaded.render)
  };
}

export async function switchProject(name: string, isBuiltin: boolean): Promise<void> {
  appState.currentName = name;
  appState.isBuiltin = isBuiltin;
  saveProjectCtx();
  await refreshProject();
}
