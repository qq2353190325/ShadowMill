// src/main/agent/chatLog.ts
// 「内容脚本对话记录」的磁盘读写：
//   projects/<项目名>/chat/index.json            索引：谁说了什么、对应哪一版（**不含 scenes**）
//   projects/<项目名>/chat/versions/<id>.json    每版脚本的完整副本（展开 / 应用时才读）
//
// 定位：与 content.json 同性质的项目产物（**不进 project.json**，也不参与 scanProjects）。
// 只回答一个问题「怎么安全地读写这份记录」——不认识提示词、不注册 IPC、不碰模型。
// 依赖：node:fs / node:path / shared 的 Scene、ScriptChatIndex、ScriptChatRoundMeta。
import fs from 'node:fs'
import path from 'node:path'
import type { Scene, ScriptChatIndex, ScriptChatRoundMeta } from '../../shared/types'

// 索引最多保留多少轮（超出丢最旧，并把对应版本副本一起删掉）
export const MAX_CHAT_ROUNDS = 100;
// 单版里最多保留多少场景（与生成侧同一上限，防脏数据把文件撑大）
const MAX_SCENES = 30;
// versionId 只允许这些字符（它会被拼进文件名，必须挡住路径穿越）
const VERSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function chatDirOf(projectDir: string): string {
  return path.join(projectDir, 'chat');
}
export function chatIndexPathOf(projectDir: string): string {
  return path.join(chatDirOf(projectDir), 'index.json');
}
function versionsDirOf(projectDir: string): string {
  return path.join(chatDirOf(projectDir), 'versions');
}
function versionPathOf(projectDir: string, versionId: string): string {
  return path.join(versionsDirOf(projectDir), versionId + '.json');
}

export function isValidVersionId(versionId: unknown): versionId is string {
  return typeof versionId === 'string' && VERSION_ID_RE.test(versionId);
}

// 新版本 id：v-<36 进制时间戳>-<4 位随机>（排序友好、可读、足够唯一）
export function newVersionId(): string {
  return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// 场景规范化（读写共用）：只保留四个字段、补 id、截到上限
export function normalizeScenes(raw: unknown): Scene[] {
  const list = Array.isArray(raw) ? raw : [];
  const now = Date.now().toString(36);
  const out: Scene[] = [];
  for (const item of list) {
    if (out.length >= MAX_SCENES) break;
    const o = (item && typeof item === 'object' && !Array.isArray(item)) ? item as Record<string, unknown> : null;
    if (!o) continue;
    const durRaw = o.durHint;
    out.push({
      id: (typeof o.id === 'string' && o.id) ? o.id : 'scene-' + now + '-v' + out.length,
      narration: typeof o.narration === 'string' ? o.narration : '',
      visual: typeof o.visual === 'string' ? o.visual : '',
      durHint: (durRaw === undefined || durRaw === null) ? '' : String(durRaw)
    });
  }
  return out;
}

function normalizeRoundMeta(raw: unknown, i: number): ScriptChatRoundMeta | null {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : null;
  if (!o) return null;
  const versionId = typeof o.versionId === 'string' ? o.versionId.trim() : '';
  if (!isValidVersionId(versionId)) return null;
  return {
    id: (typeof o.id === 'string' && o.id) ? o.id : 'round-' + Date.now().toString(36) + '-' + i,
    request: typeof o.request === 'string' ? o.request : '',
    versionId,
    totalChars: (typeof o.totalChars === 'number' && isFinite(o.totalChars) && o.totalChars >= 0)
      ? Math.round(o.totalChars) : 0,
    sceneCount: (typeof o.sceneCount === 'number' && isFinite(o.sceneCount) && o.sceneCount >= 0)
      ? Math.round(o.sceneCount) : 0,
    ts: (typeof o.ts === 'number' && isFinite(o.ts)) ? o.ts : Date.now()
  };
}

// 读索引：文件不存在 / 损坏 → 空索引；索引里指向"版本文件已不存在"的条目会被丢掉
export function readChatIndex(projectDir: string): ScriptChatIndex {
  let rounds: ScriptChatRoundMeta[] = [];
  let activeVersionId = '';
  try {
    const p = chatIndexPathOf(projectDir);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(raw && raw.rounds) ? raw.rounds : [];
      rounds = list.map(normalizeRoundMeta).filter((r: ScriptChatRoundMeta | null): r is ScriptChatRoundMeta => !!r);
      if (typeof raw.activeVersionId === 'string' && isValidVersionId(raw.activeVersionId)) {
        activeVersionId = raw.activeVersionId;
      }
    }
  } catch (e) {
    rounds = [];
    activeVersionId = '';
  }
  // 丢掉版本副本已经不在的条目（例如手工删了 versions 目录）
  const alive = rounds.filter((r) => fs.existsSync(versionPathOf(projectDir, r.versionId)));
  if (!alive.some((r) => r.versionId === activeVersionId)) activeVersionId = '';
  return { rounds: alive.slice(-MAX_CHAT_ROUNDS), activeVersionId };
}

// 写索引（只写元数据），并把不再被引用的版本副本删掉（含超出上限的那些）
export function writeChatIndex(projectDir: string, index: ScriptChatIndex): void {
  const rounds = (Array.isArray(index.rounds) ? index.rounds : []).slice(-MAX_CHAT_ROUNDS);
  const activeVersionId = isValidVersionId(index.activeVersionId) ? index.activeVersionId : '';
  fs.mkdirSync(chatDirOf(projectDir), { recursive: true });
  fs.writeFileSync(chatIndexPathOf(projectDir), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), activeVersionId, rounds }, null, 2), 'utf8');
  pruneVersions(projectDir, new Set(rounds.map((r) => r.versionId)));
}

// 删除 versions/ 下不被索引引用的文件（清空的兜底在 clearChat；这里只做增量清理）
function pruneVersions(projectDir: string, keep: Set<string>): void {
  const dir = versionsDirOf(projectDir);
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    if (keep.has(id)) continue;
    try { fs.unlinkSync(path.join(dir, name)); } catch (e) { /* ignore */ }
  }
}

// 写一版脚本副本；返回实际落盘的场景（已规范化）
export function writeVersion(projectDir: string, versionId: string, scenes: unknown): Scene[] {
  if (!isValidVersionId(versionId)) throw new Error('非法的版本 id');
  const normalized = normalizeScenes(scenes);
  if (!normalized.length) throw new Error('这一版没有可用场景');
  fs.mkdirSync(versionsDirOf(projectDir), { recursive: true });
  fs.writeFileSync(versionPathOf(projectDir, versionId), JSON.stringify({
    versionId,
    createdAt: new Date().toISOString(),
    scenes: normalized
  }, null, 2), 'utf8');
  return normalized;
}

// 读一版脚本副本；不存在 / 损坏 → null
export function readVersion(projectDir: string, versionId: string): Scene[] | null {
  if (!isValidVersionId(versionId)) return null;
  try {
    const p = versionPathOf(projectDir, versionId);
    if (!fs.existsSync(p)) return null;
    const scenes = normalizeScenes(JSON.parse(fs.readFileSync(p, 'utf8')).scenes);
    return scenes.length ? scenes : null;
  } catch (e) {
    return null;
  }
}

// 清空：删索引 + 整个 versions 目录（不动 content.json）
export function clearChat(projectDir: string): void {
  try { fs.rmSync(chatDirOf(projectDir), { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
