<template>
  <!-- 必须 Teleport 到 body：`.card` 上有 backdrop-filter（见 main.css 的 .card），
       它会让 position:fixed 相对**卡片**而不是视口 ⇒ 弹窗被卡片框住、顶部跑到窗口外。
       同一个坑见 VoiceSection 的克隆音色弹窗（那里也留了同样的注释）。 -->
  <Teleport to="body">
    <div class="hf-modal-mask" @click.self="emit('close')">
      <div class="hf-modal" style="width:min(720px,92vw)">
        <div class="hf-modal-head">
          <span class="hf-modal-title">更新日志</span>
          <button class="hf-modal-close" title="关闭" @click="emit('close')">×</button>
        </div>
        <div class="hf-modal-body">
          <div v-if="loading" class="hf-status">正在读取更新日志…</div>
          <template v-else-if="errorText">
            <div class="hf-status hf-error">{{ errorText }}</div>
            <div v-if="errorDetail" class="hf-detail">{{ errorDetail }}</div>
          </template>
          <template v-else>
            <!-- 最新一版：版本 + 时间一行，下面一行一条标题（最多 10 条，其余点按钮展开） -->
            <div class="cl-ver">
              <span>版本：{{ mainLabel }}</span>
              <span class="cl-date">时间：{{ mainDate || '—' }}</span>
            </div>
            <div class="cl-list">
              <div v-for="e in shownEntries" :key="e.no + '-' + e.date" class="cl-item">
                <span v-if="e.tag" class="cl-tag" :class="tagClass(e.tag)">{{ e.tag }}</span>
                <span class="cl-item-title">{{ e.title }}</span>
              </div>
            </div>
            <div v-if="main && main.entries.length > ENTRY_LIMIT" class="cl-more">
              <button class="hf-btn" @click="showAll = !showAll">
                {{ showAll ? '只看最近 ' + ENTRY_LIMIT + ' 条' : '展开全部 ' + main.entries.length + ' 条' }}
              </button>
            </div>

            <!-- 历史版本：默认整区折叠，展开后每版一行（点一行才列它的条目） -->
            <div v-if="history.length" class="cl-hist">
              <button class="cl-hist-head" @click="historyOpen = !historyOpen">
                <span class="cl-caret">{{ historyOpen ? '▾' : '▸' }}</span>
                <span class="cl-hist-name">历史版本（{{ history.length }}）</span>
              </button>
              <div v-show="historyOpen" class="cl-hist-body">
                <div v-for="b in history" :key="b.title" class="cl-hist-block">
                  <button class="cl-hist-ver" @click="toggleHist(b.title)">
                    <span class="cl-caret">{{ isHistOpen(b.title) ? '▾' : '▸' }}</span>
                    <span class="cl-hist-name">版本：{{ b.version || b.title }}</span>
                    <span class="cl-date">时间：{{ b.date || '—' }}</span>
                    <span class="cl-count">{{ b.entries.length }} 条</span>
                  </button>
                  <div v-show="isHistOpen(b.title)" class="cl-list">
                    <div v-for="e in b.entries" :key="e.no + '-' + e.date" class="cl-item">
                      <span v-if="e.tag" class="cl-tag" :class="tagClass(e.tag)">{{ e.tag }}</span>
                      <span class="cl-item-title">{{ e.title }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
        <div class="hf-modal-foot">
          <button class="hf-btn" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// pages/SettingsPage/components/ChangelogDialog.vue —— 设置页「应用更新」卡片的「更新日志」弹窗
// 数据来源：update:changelog（主进程读随安装包的 CHANGELOG.md 原文）；解析全在
// @renderer/utils/changelog（纯函数）。界面只要「版本 / 时间 / 每条一行标题」三样，
// 影响范围与验证不进界面（用户选择：简洁优先）。
// 用法：父组件用 v-if 挂载 —— 打开即取一次、关掉即销毁，不会留下陈旧内容。
// 蒙层 Teleport 到 <body>（见模板里的注释）：本组件挂在 `.card` 内部，而 .card 有 backdrop-filter，
// 不 Teleport 的话 fixed 会相对卡片定位。字号全在 .cl-* / .hf-modal-* 上显式写了，不受挂载点影响。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseChangelog, pickDefaultBlock, tagKind, type ChangelogBlock } from '@renderer/utils/changelog'

const emit = defineEmits<{ (e: 'close'): void }>()

// 最新一版最多先显示多少条：这份日志的「未发布」块会一直累积（实装时 30 条），不限制就又把弹窗顶满
const ENTRY_LIMIT = 10

const blocks = ref<ChangelogBlock[]>([])
const currentVersion = ref('');
const loading = ref(true);
const errorText = ref('');
const errorDetail = ref('');
const showAll = ref(false);
const historyOpen = ref(false);
// 历史版本里已展开的那些块（按标题记）
const histOpen = ref<string[]>([]);

const mainIndex = computed(() => pickDefaultBlock(blocks.value, currentVersion.value));
const main = computed<ChangelogBlock | null>(() => blocks.value[mainIndex.value] || null);
const history = computed(() => blocks.value.filter((b, i) => i !== mainIndex.value && b.entries.length > 0));
const mainLabel = computed(() => (main.value ? (main.value.version || main.value.title) : ''));
const mainDate = computed(() => (main.value ? main.value.date : ''));
const shownEntries = computed(() => {
  const list = main.value ? main.value.entries : [];
  return showAll.value ? list : list.slice(0, ENTRY_LIMIT);
});

const tagClass = (tag: string): string => {
  const k = tagKind(tag);
  return k ? 'cl-tag-' + k : '';
};
const isHistOpen = (title: string): boolean => histOpen.value.indexOf(title) >= 0;

function toggleHist(title: string): void {
  const at = histOpen.value.indexOf(title);
  if (at >= 0) histOpen.value.splice(at, 1);
  else histOpen.value.push(title);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  try { currentVersion.value = window.updateTools.version() || '' } catch (e) { currentVersion.value = '' }
  try {
    const res = await window.updateTools.changelog();
    if (!res || !res.ok) {
      errorText.value = (res && res.message) || '读取更新日志失败';
      errorDetail.value = (res && res.detail) || '';
      return;
    }
    blocks.value = parseChangelog(res.text || '');
    if (!blocks.value.length) { errorText.value = '更新日志里还没有记录'; return }
  } catch (e) {
    errorText.value = '读取更新日志失败';
    errorDetail.value = (e as Error)?.message || String(e);
  } finally {
    loading.value = false;
  }
});

// 与 onMounted 成对注册，避免关掉弹窗后监听器残留（项目既有惯例）
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});
</script>
