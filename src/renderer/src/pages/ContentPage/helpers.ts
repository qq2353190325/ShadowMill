// pages/ContentPage/helpers.ts —— 内容脚本页的共享状态与逻辑
// 为什么用模块级 ref：本页有两个 Tab（场景编辑 / AI 创作），它们必须看到**同一份 scenes**
// （AI 生成后要立刻写进编辑器、下一轮又要以编辑器内容为上下文）。沿用 TextTtsPage / SubtitlePage
// 的 helpers 约定：模块级单例 + 页面挂载时 loadScenes() 复位。
//
// **自动保存**（2026-10）：编辑即落盘，没有「保存到项目」按钮。
//   · 防抖 600ms（打字停下才写），写入前立刻抓一份快照（项目名 + 内容）——
//     这样即使随后切项目、切页，也不会把旧项目的内容写到新项目里；
//   · 串行：写盘期间又有改动，就排队再写一次（避免旧内容覆盖新内容）；
//   · 失败不静默：saveState = 'error' + saveError，界面显示重试；
//   · 成功后 `refreshProject()`（不 await），首页节点 / 字幕页 / HTML 生成据此看到最新。
import { ref, watch } from 'vue'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import type { Scene, ScriptChatRoundMeta } from '@shared/types'

// 场景列表（编辑器与 AI 面板共用）
export const scenes = ref<Scene[]>([])
// 「还没落盘」标记：仅用于界面提示（自动保存成功后立刻复位）
export const dirty = ref(false)

// 自动保存状态：idle（刚加载）/ saving / saved / error
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export const saveState = ref<SaveState>('idle')
export const lastSavedAt = ref('')
export const saveError = ref('')

// 对话记录的轮次元数据统一用共享类型 ScriptChatRoundMeta（持久化在 projects/<名>/chat/index.json）

const SAVE_DEBOUNCE_MS = 600;

interface SaveSnapshot {
  name: string;
  content: { style: string; scenes: Scene[] };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let queued: SaveSnapshot | null = null;
// loadScenes 期间不触发自动保存（否则一进页面就写一次）
let ready = false;

function newSceneId(): string {
  return 'scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function emptyScene(): Scene {
  return { id: newSceneId(), narration: '', visual: '', durHint: '' };
}

// 立刻抓一份快照（项目名 + 内容都在这一刻定住，之后切项目也不会串）
function snapshot(): SaveSnapshot {
  return {
    name: appState.currentName,
    content: {
      // project:save-content 是整份 content 覆盖：style 必须把项目里已落盘的值原样带回
      // （风格编辑入口在「HTML生成」页，这里不带就等于把它清掉）
      style: (appState.project && appState.project.content && appState.project.content.style) || '',
      scenes: scenes.value.map((s) => ({ id: s.id, narration: s.narration, visual: s.visual, durHint: s.durHint }))
    }
  };
}

async function writeSnapshot(snap: SaveSnapshot): Promise<boolean> {
  saveState.value = 'saving';
  try {
    const res = await window.projectTools.saveContent(snap.name, snap.content);
    if (!res || !res.ok) {
      saveState.value = 'error';
      saveError.value = (res as { message?: string })?.message || '保存失败';
      return false;
    }
    saveState.value = 'saved';
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    saveError.value = '';
    dirty.value = false;
    // 不 await：保存已经成功了，刷新只是让首页节点 / 其它页看到最新
    void refreshProject();
    return true;
  } catch (e) {
    saveState.value = 'error';
    saveError.value = (e as Error)?.message || '保存失败';
    return false;
  }
}

// 把待写快照立刻写掉（防抖计时器也会走到这里）；返回是否成功
export async function flushSave(): Promise<boolean> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (saving) {
    // 正在写：把最新快照留在队列里，由正在进行的循环收尾时再写
    if (!queued) queued = snapshot();
    return false;
  }
  const first = queued || snapshot();
  queued = null;
  saving = true;
  try {
    let ok = await writeSnapshot(first);
    while (queued) {
      const next = queued;
      queued = null;
      ok = await writeSnapshot(next);
    }
    return ok;
  } finally {
    saving = false;
  }
}

// 编辑变更 → 抓快照 + 重置防抖计时
export function scheduleSave(): void {
  queued = snapshot();
  dirty.value = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flushSave(); }, SAVE_DEBOUNCE_MS);
}

// 卸载时用：**只有确实有待写快照才写**。不能在卸载时凭空 snapshot()——
// 切项目时 appState.currentName 已经是新项目，而 scenes 还是旧项目的，会写串。
export function flushPending(): void {
  if (!queued) return;
  void flushSave();
}

// 从当前项目加载内容脚本（原有 load 逻辑：逐字段类型守卫，空则补一个空场景）
export function loadScenes(): void {
  ready = false;
  const content = (appState.project && appState.project.content) || { style: '', scenes: [] };
  scenes.value = (Array.isArray(content.scenes) ? content.scenes : []).map((s) => {
    const item = (s && typeof s === 'object') ? s as Record<string, unknown> : {};
    return {
      id: (typeof item.id === 'string' && item.id.trim()) ? item.id.trim() : newSceneId(),
      narration: typeof item.narration === 'string' ? item.narration : '',
      visual: typeof item.visual === 'string' ? item.visual : '',
      durHint: (item.durHint === undefined || item.durHint === null) ? '' : String(item.durHint)
    };
  });
  if (!scenes.value.length) scenes.value.push(emptyScene());
  dirty.value = false;
  saveState.value = 'idle';
  lastSavedAt.value = '';
  saveError.value = '';
  ready = true;
}

// 深监听：v-model 直接改场景字段也会触发自动保存
watch(scenes, () => {
  if (!ready) return;
  scheduleSave();
}, { deep: true });

export function addScene(): void {
  scenes.value.push(emptyScene());
}

export function removeScene(i: number): void {
  scenes.value.splice(i, 1);
  if (!scenes.value.length) scenes.value.push(emptyScene());
}

export function moveScene(i: number, delta: number): void {
  const j = i + delta;
  if (j < 0 || j >= scenes.value.length) return;
  const t = scenes.value[i];
  scenes.value[i] = scenes.value[j];
  scenes.value[j] = t;
}

// AI 生成结果写回编辑器（整份替换；空数组兜底成一个空场景）——写回后由 watch 自动保存
export function applyScenes(next: Scene[]): void {
  const list = (Array.isArray(next) ? next : []).filter((s) => s && typeof s === 'object');
  scenes.value = list.length ? list.map((s) => ({
    id: s.id || newSceneId(),
    narration: String(s.narration || ''),
    visual: String(s.visual || ''),
    durHint: (s.durHint === undefined || s.durHint === null) ? '' : String(s.durHint)
  })) : [emptyScene()];
  dirty.value = true;
}

// ===== 对话记录（projects/<名>/chat/：index.json + versions/<id>.json）=====
// 渲染层只管「什么时候读 / 什么时候追加一版 / 什么时候应用」，路径与规范化都在主进程（agent/chatLog.ts）。
// **IPC 载荷必须是普通对象**：Vue 的响应式 Proxy 无法被结构化克隆（这是上一版记录写不进去的根因），
// 所以下面所有发出去的 scenes 都先做一次纯对象映射。
export const chatError = ref('');

function plainScenes(list: Scene[]): Scene[] {
  return list.map((s) => ({ id: s.id, narration: s.narration, visual: s.visual, durHint: s.durHint }));
}

export interface ChatIndexState {
  rounds: ScriptChatRoundMeta[];
  activeVersionId: string;
}

export async function loadChatIndex(): Promise<ChatIndexState> {
  try {
    const res = await window.scriptTools.loadChat(appState.currentName);
    if (res && res.ok && Array.isArray(res.rounds)) {
      chatError.value = '';
      return { rounds: res.rounds, activeVersionId: res.activeVersionId || '' };
    }
    chatError.value = (res && res.message) || '读取对话记录失败';
    return { rounds: [], activeVersionId: '' };
  } catch (e) {
    chatError.value = (e as Error)?.message || '读取对话记录失败';
    return { rounds: [], activeVersionId: '' };
  }
}

// 追加一版：主进程写 versions/<versionId>.json 并更新索引，返回 versionId（失败返回空串）
export async function appendChatRound(
  meta: { id: string; request: string; totalChars: number; ts: number },
  scenes: Scene[]
): Promise<string> {
  try {
    const res = await window.scriptTools.appendRound({
      name: appState.currentName,
      round: { ...meta },
      scenes: plainScenes(scenes)
    });
    if (res && res.ok && res.versionId) {
      chatError.value = '';
      return res.versionId;
    }
    chatError.value = (res && res.message) || '保存对话记录失败';
    return '';
  } catch (e) {
    chatError.value = (e as Error)?.message || '保存对话记录失败';
    return '';
  }
}

// 读某一版（展开预览 / 应用前取内容）；读不到返回 null
export async function readChatVersion(versionId: string): Promise<Scene[] | null> {
  try {
    const res = await window.scriptTools.readVersion(appState.currentName, versionId);
    if (res && res.ok && Array.isArray(res.scenes)) return res.scenes;
    chatError.value = (res && res.message) || '读取这一版失败';
    return null;
  } catch (e) {
    chatError.value = (e as Error)?.message || '读取这一版失败';
    return null;
  }
}

// 把某一版记为「当前应用」（应用旧版时调用；落盘内容仍由自动保存负责）
export async function setActiveChatVersion(versionId: string): Promise<boolean> {
  try {
    const res = await window.scriptTools.setActiveVersion(appState.currentName, versionId);
    if (res && res.ok) { chatError.value = ''; return true; }
    chatError.value = (res && res.message) || '更新对话记录失败';
    return false;
  } catch (e) {
    chatError.value = (e as Error)?.message || '更新对话记录失败';
    return false;
  }
}

// 清空：删索引与全部版本副本（不动编辑器里的场景）
export async function clearChatRecords(): Promise<boolean> {
  try {
    const res = await window.scriptTools.clearChat(appState.currentName);
    if (res && res.ok) { chatError.value = ''; return true; }
    chatError.value = (res && res.message) || '清空对话记录失败';
    return false;
  } catch (e) {
    chatError.value = (e as Error)?.message || '清空对话记录失败';
    return false;
  }
}
