<template>
  <div class="card hgen-panel">
    <div class="panel-title"><span class="dot"></span>AI 创作（对话式生成 / 修改脚本）</div>
    <div class="hgen-tip">AI 读的是「场景编辑」里当前的内容：空就从零写，有就按你的要求改。结果写进编辑器并**自动保存**；每版脚本都会存一份副本，切页回来还能展开或重新应用。</div>

    <!-- 本轮上下文提示（用户曾反馈「AI 创作好像跟我已有的脚本没关系」）：把「这次到底带了哪几场脚本」
         显式写出来。计数口径 = 主进程 buildScriptPrompt 实际发送的那批（旁白或画面分镜非空，上限 30 场）。 -->
    <div class="hgen-tip">{{ contextHint }}</div>

    <div ref="listEl" class="ct-list">
      <div v-if="!rounds.length" class="ct-empty">
        <div class="ct-empty-title">写一句主题，让 AI 写第一版脚本</div>
        <div class="ct-examples">
          <button v-for="ex in EXAMPLES" :key="ex" class="hf-btn ct-example" @click="request = ex">{{ ex }}</button>
        </div>
      </div>

      <div v-else class="ct-log-bar">
        <span class="ct-log-text">对话记录 {{ rounds.length }} 轮（存在项目里的 chat/ 目录）</span>
        <button class="hf-btn ct-mini" @click="clearChat">清空对话</button>
      </div>

      <div v-if="chatError" class="ct-log-error">
        对话记录出错：{{ chatError }}
        <button class="hf-btn ct-mini" @click="chatError = ''">知道了</button>
      </div>

      <!-- 一轮一条结果卡：展开 / 应用时才按 versionId 去读那一版的副本（懒加载） -->
      <ScriptRoundCard
        v-for="(r, ri) in rounds"
        :key="r.id"
        :round="r"
        :index="ri"
        :current="r.versionId === activeVersionId"
        :expanded="expanded === ri"
        :scenes="expanded === ri ? expandedScenes : null"
        :applying="applyingId === r.versionId"
        :chars-per-second="EST_CHARS_PER_SEC"
        @toggle="toggle(ri)"
        @apply="applyVersion(ri)"
      />

      <div v-if="busy" class="ct-progress">
        <div class="hf-status">{{ status }}</div>
        <button v-if="thinkText" class="hf-btn ct-mini" @click="thinkOpen = !thinkOpen">{{ thinkOpen ? '收起思考过程' : '查看思考过程' }}</button>
        <pre v-if="thinkOpen && thinkText" class="ct-think">{{ thinkText }}</pre>
      </div>

      <div v-if="errorMsg" class="ct-error">
        <div class="hf-status hf-error">{{ errorMsg }}</div>
        <button v-if="errorRaw" class="hf-btn ct-mini" @click="rawOpen = !rawOpen">{{ rawOpen ? '收起原文' : '查看模型原文' }}</button>
        <pre v-if="rawOpen && errorRaw" class="ct-raw">{{ errorRaw }}</pre>
      </div>
    </div>

    <div class="ct-input-row">
      <textarea
        v-model="request"
        class="hgen-subtitle ct-input"
        spellcheck="false"
        :disabled="busy"
        placeholder="写主题或对脚本的要求，例如：60 秒讲清什么是大模型幻觉 / 第 3 场改成对话口吻"
        @keydown.ctrl.enter="send"
      ></textarea>
      <button class="hf-btn hf-btn-primary ct-send" :disabled="busy || !request.trim()" @click="send">{{ busy ? '生成中…' : '发送' }}</button>
    </div>
    <div class="ct-params">
      <label class="sel-label">场景数</label>
      <input v-model="sceneCount" class="hgen-input ct-num" :disabled="busy" placeholder="自动" />
      <label class="sel-label">目标时长(秒)</label>
      <input v-model="targetSeconds" class="hgen-input ct-num" :disabled="busy" placeholder="不限" />
      <span class="ct-hint">Ctrl+Enter 发送</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/ContentPage/AiChatPanel.vue —— 「AI 创作」Tab：对话式生成/修改内容脚本。
// 模型调用在主进程（script:*）；结果写进编辑器后由 helpers 自动保存。
// 对话记录：索引（用户原话 + 版本 id）常驻，每版脚本副本按需读取（chat/index.json + chat/versions/*.json）。
import { computed, nextTick, onMounted, ref } from 'vue'
import { appState } from '@renderer/composables/useAppStore'
import { useConfigPrompt } from '@renderer/composables/useConfigPrompt'
import { toast } from '@renderer/composables/useToast'
// 「估算时长」的字/秒口径与字幕估时同一份（@shared/constants），别在这里另写一个常数
import { EST_CHARS_PER_SEC } from '@shared/constants'
import type { Scene, ScriptChatRoundMeta } from '@shared/types'
import {
  scenes,
  applyScenes,
  chatError,
  loadChatIndex,
  appendChatRound,
  readChatVersion,
  setActiveChatVersion,
  clearChatRecords
} from './helpers'
import ScriptRoundCard from './ScriptRoundCard.vue'

const EXAMPLES = ['60 秒讲清什么是大模型幻觉', '3 分钟产品介绍，口吻克制', '把一段技术文档讲成人话，90 秒'];

const configPrompt = useConfigPrompt();
const rounds = ref<ScriptChatRoundMeta[]>([]);
const activeVersionId = ref('');
const request = ref('');
const sceneCount = ref('');
const targetSeconds = ref('');
const busy = ref(false);
const status = ref('');
const thinkText = ref('');
const thinkOpen = ref(false);
const errorMsg = ref('');
const errorRaw = ref('');
const rawOpen = ref(false);
// 展开的轮次下标 + 它对应的场景（懒加载；null = 正在读）
const expanded = ref(-1);
const expandedScenes = ref<Scene[] | null>(null);
// 正在应用的那一版（按钮显示"应用中…"）
const applyingId = ref('');
const listEl = ref<HTMLElement | null>(null);
// 已读过的版本副本，避免反复读盘
const versionCache = new Map<string, Scene[]>();

const hasRounds = computed(() => rounds.value.length > 0);

// 本轮实际会随提示词发出去的场景数：与主进程 script.ts 的 buildScriptPrompt 同一口径
// （**旁白或画面分镜非空**即发送，`MAX_SCENES` 全场截断）。不数 scenes.length——「两个都空」的空场景
// 不会被发送，算进去数字会虚高。
// 与 HTML 页那个「内容脚本 N 个场景」（画面分镜非空）口径**故意不同**：这个数说的是「发给 AI 的上下文」，
// 宁可多带（只有旁白的场景也是用户写的内容，不能悄悄丢），不能少报。
const MAX_SCENES = 30; // 与 src/main/agent/script.ts 的 MAX_SCENES 对齐
const contextHint = computed(() => {
  const sent = scenes.value.filter((s) => String(s.narration || '').trim() || String(s.visual || '').trim());
  const n = Math.min(sent.length, MAX_SCENES);
  if (!n) return '当前脚本为空：本轮将从零写一版。';
  return '本轮将附带当前脚本 ' + n + ' 个场景'
    + (sent.length > MAX_SCENES ? '（每轮最多发送 ' + MAX_SCENES + ' 个，其余不发送）' : '');
});

function numOf(v: string): number | undefined {
  const n = Number(String(v || '').trim());
  return isFinite(n) && n > 0 ? n : undefined;
}

function scrollToBottom(): void {
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function ensureVersion(versionId: string): Promise<Scene[] | null> {
  const hit = versionCache.get(versionId);
  if (hit) return hit;
  const loaded = await readChatVersion(versionId);
  if (loaded) versionCache.set(versionId, loaded);
  return loaded;
}

async function toggle(i: number): Promise<void> {
  if (expanded.value === i) {
    expanded.value = -1;
    expandedScenes.value = null;
    return;
  }
  expanded.value = i;
  expandedScenes.value = null;
  const r = rounds.value[i];
  if (!r) return;
  const list = await ensureVersion(r.versionId);
  // 读取期间用户可能又点了别的行
  if (expanded.value === i) expandedScenes.value = list;
}

// 「应用此版本」：读该版 → 写进编辑器（自动保存）→ 把它记为当前版本
async function applyVersion(i: number): Promise<void> {
  const r = rounds.value[i];
  if (!r || applyingId.value) return;
  applyingId.value = r.versionId;
  try {
    const list = await ensureVersion(r.versionId);
    if (!list) { toast('这一版读不到了'); return; }
    applyScenes(list.map((s) => ({ ...s })));
    activeVersionId.value = r.versionId;
    await setActiveChatVersion(r.versionId);
    toast('已应用第 ' + (i + 1) + ' 版（自动保存）');
  } finally {
    applyingId.value = '';
  }
}

async function clearChat(): Promise<void> {
  if (!hasRounds.value) return;
  if (!window.confirm('清空对话记录？会删除所有版本副本，但不影响编辑器里的场景。')) return;
  const ok = await clearChatRecords();
  if (!ok) { toast('清空失败：' + (chatError.value || '未知原因')); return; }
  rounds.value = [];
  activeVersionId.value = '';
  expanded.value = -1;
  expandedScenes.value = null;
  versionCache.clear();
  toast('对话记录已清空');
}

async function send(): Promise<void> {
  if (busy.value) return;
  const text = request.value.trim();
  if (!text) { toast('请先写下要写什么'); return; }
  busy.value = true;
  status.value = '正在连接模型…';
  thinkText.value = '';
  thinkOpen.value = false;
  errorMsg.value = '';
  errorRaw.value = '';
  rawOpen.value = false;
  try {
    const res = await window.scriptTools.generate({
      name: appState.currentName,
      request: text,
      // 上下文 = 编辑器当前内容（AI 面板与编辑器共用同一份 scenes）
      scenes: scenes.value.map((s) => ({ ...s })),
      sceneCount: numOf(sceneCount.value),
      targetSeconds: numOf(targetSeconds.value)
    });
    if (!res || !res.ok) {
      const msg = (res && res.message) || '生成失败';
      errorMsg.value = msg;
      errorRaw.value = (res && typeof res.raw === 'string') ? res.raw : '';
      status.value = '';
      // 配置类（Key 无效 / 未启用 / 配置不完整）：主进程判好分类 → 弹「去设置」；其余 toast 提示一次
      if (!configPrompt.fromResult(res)) toast(msg);
      return;
    }
    // 先写进编辑器（自动保存），再记录这一版（主进程写 versions/<id>.json + 更新索引）
    applyScenes(res.scenes);
    request.value = '';
    const meta = {
      id: 'round-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      request: text,
      totalChars: res.totalChars,
      ts: Date.now()
    };
    const versionId = await appendChatRound(meta, res.scenes);
    if (!versionId) {
      toast('生成成功，但对话记录保存失败：' + (chatError.value || '未知原因'));
    } else {
      rounds.value.push({ ...meta, versionId, sceneCount: res.scenes.length });
      activeVersionId.value = versionId;
      versionCache.set(versionId, res.scenes.map((s) => ({ ...s })));
      toast('已生成 ' + res.scenes.length + ' 个场景（自动保存）');
    }
    await nextTick();
    scrollToBottom();
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  // 单订阅（preload 保证重复注册只替换回调）：进度只在本面板可见时更新状态行
  window.scriptTools.onProgress((p) => {
    if (!busy.value) return;
    status.value = p.text || '';
    if (p.thinkText) thinkText.value = p.thinkText;
  });
  // 恢复本项目的对话记录索引（没有就是空；失败会写进 chatError 并在面板上显示）
  const state = await loadChatIndex();
  rounds.value = state.rounds;
  activeVersionId.value = state.activeVersionId;
  if (rounds.value.length) {
    await nextTick();
    scrollToBottom();
  }
});
</script>

<style scoped>
.ct-list {
  max-height: calc(100vh - 420px);
  min-height: 200px;
  overflow-y: auto;
  padding-right: 4px;
  margin-top: 8px;
}
.ct-empty {
  padding: 18px 4px;
  color: var(--text-secondary);
}
.ct-empty-title {
  font-size: 13px;
  margin-bottom: 10px;
}
.ct-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ct-example {
  font-size: 12px;
  padding: 6px 10px;
}
.ct-log-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
.ct-log-bar .ct-log-text {
  margin-right: auto;
}
.ct-log-error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-danger);
}
.ct-log-error .hf-btn {
  margin-left: 8px;
}
.ct-mini {
  font-size: 12px;
  padding: 4px 10px;
}
.ct-progress,
.ct-error {
  margin: 8px 0;
}
.ct-think,
.ct-raw {
  margin: 8px 0 0;
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.ct-input-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
  margin-top: 10px;
}
.ct-input {
  flex: 1;
  height: 84px;
  resize: vertical;
  font-size: 13px;
}
.ct-send {
  width: 96px;
  flex: none;
}
.ct-params {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.ct-num {
  width: 88px;
  flex: none;
}
.ct-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
