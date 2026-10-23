// composables/useAppStore.ts —— 全局项目状态（原 window.App 的 AppState + refreshProject/switchProject/saveProjectCtx）
// 模块级 reactive 单例；localStorage 键名见 @renderer/constants（STORAGE_KEY_PROJECT_CTX，
// 结构不变，prod file:// 同源，上下文自动延续）。
import { computed, reactive, ref } from 'vue'
import type { ProjectCastMember, ProjectChapter, ProjectMaterial, ProjectMeta, RenderCanvas, RenderOverride } from '@shared/types'
import { STORAGE_KEY_PROJECT_CTX } from '@renderer/constants'
import { normalizeCanvas, pickRenderOverride } from '@renderer/utils/render'

// ===== 页面键（与菜单 data-page 一致）======
// 视频环节的页面键是 video-preview（页名「视频预览」）：转视频动作已并入「HTML生成」页，本页只做预览。
// 原「音色管理」独立页（sound-copy）已并入「配音」页的第三个 Tab，页面键随之下线。
export type PageKey = 'home' | 'about' | 'content' | 'text-tts' | 'subtitle' | 'html-gen' | 'video-preview' | 'settings'

// ===== 项目状态结构（与主进程 project.json 字段对应） =====
export interface ProjectState {
  name: string
  title: string
  subtitle: string
  htmlPath: string
  videoPath: string
  audioFile: string
  // 项目素材库（图片 / 视频）：HTML 生成时勾选参与，结构见 @shared/types 的 ProjectMaterial
  materials: ProjectMaterial[]
  // 项目角色（角色即项目素材，与单文件 / 章节化无关）：索引字段，代码在 <项目>/cast/<id>.js
  cast: ProjectCastMember[]
  // 章节化清单（章节模式下才有）：索引字段，代码在 <项目>/pages/cNN.js
  chapters: ProjectChapter[]
  htmlExists: boolean
  videoExists: boolean
  subtitleCount: number
  content: { style: string; scenes: { id: string; narration: string; visual: string; durHint: string }[] }
  // 视频渲染档位的项目级覆盖（字段缺省 = 跟随全局默认；见 composables/useRenderOptions.ts）
  render?: RenderOverride
  // 成片画布方向（项目属性，缺省 = DEFAULT_CANVAS 横屏）：生成提示词 / 预览画布 / 渲染注入三处共用
  canvas: RenderCanvas
}
// project:list 的条目结构来自跨进程契约（shared/types.ts），此处只做再导出，避免两处漂移
export type { ProjectMeta };

export const appState = reactive({
  currentName: 'demo-project',
  project: null as ProjectState | null, // 当前项目详情
  myProjects: [] as ProjectMeta[]       // 我的项目列表（项目选择器 / 首页项目卡片）
});

export const activeMenu = ref<PageKey>('home');

// ===== 链路状态判定（原 has* 函数 → computed） =====
export const hasSubtitle = computed(() => {
  const p = appState.project;
  return !!(p && p.subtitle);
});
// 仅当存在真实 HTML 路径时才视为“已生成”：避免只有路径、文件已被删除时误判
export const hasHtml = computed(() => {
  const p = appState.project;
  return !!(p && p.htmlExists && p.htmlPath);
});
export const hasVideo = computed(() => {
  const p = appState.project;
  return !!(p && p.videoExists);
});
// 内容脚本是否具备：存在至少一条场景（向后兼容：无 content 字段视为空）
export const hasContent = computed(() => {
  const p = appState.project;
  return !!(p && p.content && Array.isArray(p.content.scenes) && p.content.scenes.length);
});
// 配音是否具备（本阶段近似判断）：项目内已有背景音频/生成语音即视为已产出声，后续可按实际配音产物细化
export const hasAudio = computed(() => {
  const p = appState.project;
  return !!(p && p.audioFile);
});

export function saveProjectCtx(): void {
  localStorage.setItem(STORAGE_KEY_PROJECT_CTX, JSON.stringify({ name: appState.currentName }));
}

export async function refreshProject(): Promise<void> {
  const projs = await window.projectTools.list().catch(() => []);
  appState.myProjects = projs;

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
    materials: Array.isArray(loaded.materials) ? loaded.materials : [],
    // 角色与章节是**索引字段**（主进程 project.json 里有就带回来）：不拷这两个，
    // 「HTML生成」页的角色列表与章节列表会永远显示 0 个 / 空 —— 主进程写了盘、界面也不认
    cast: Array.isArray(loaded.cast) ? loaded.cast : [],
    chapters: Array.isArray(loaded.chapters) ? loaded.chapters : [],
    htmlExists: !!(entry && entry.hasHtml),
    videoExists: !!(entry && entry.hasVideo),
    subtitleCount: loaded.subtitleCount || 0,
    content: loaded.content || { style: '', scenes: [] },
    // 渲染档位覆盖：只保留合法字段，脏数据/缺省一律归为空覆盖（= 跟随全局默认）
    render: pickRenderOverride(loaded.render),
    // 成片画布：脏数据/缺省一律落 DEFAULT_CANVAS（预览与渲染都按它，必须是合法值）
    canvas: normalizeCanvas(loaded.canvas)
  };
}

export async function switchProject(name: string): Promise<void> {
  appState.currentName = name;
  saveProjectCtx();
  await refreshProject();
}
