<template>
  <div ref="triggerEl" class="hf-sel" :class="{ open, disabled: props.disabled }" :style="props.style" :title="props.title">
    <button
      type="button"
      class="hf-sel-trigger"
      :disabled="props.disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="hf-sel-text" :class="{ ph: displayText === '' }">{{ displayText || props.placeholder }}</span>
      <span class="hf-sel-caret" aria-hidden="true"></span>
    </button>

    <!-- 弹层 Teleport 到 body：卡片/弹窗的 overflow:hidden 不会把它裁掉；坐标用 fixed 实时算 -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="listEl"
        class="hf-sel-menu"
        :style="menuStyle"
        role="listbox"
        tabindex="-1"
        @mousedown.prevent
        @keydown="onMenuKeydown"
      >
        <template v-if="groups.length">
          <div v-for="g in groups" :key="g.label" class="hf-sel-group">
            <div v-if="g.label" class="hf-sel-group-label">{{ g.label }}</div>
            <div
              v-for="o in g.options"
              :key="String(o.value)"
              class="hf-sel-opt"
              :class="{ on: o.value === props.modelValue, dis: !!o.disabled, active: indexOf(o) === activeIndex }"
              :title="o.title || o.label"
              @click="pick(o)"
            >
              <span class="hf-sel-opt-text">{{ o.label }}</span>
              <span class="hf-sel-tick" aria-hidden="true"></span>
            </div>
          </div>
        </template>
        <div v-else class="hf-sel-empty">{{ props.emptyText }}</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// components/HfSelect.vue —— 全局自定义下拉（替代原生 <select>）
// 为什么自绘：原生 <option> 弹层由系统绘制，只受浏览器限制，无法用 CSS 控制行高/间距/圆角/配色，
// 深色科技主题下「选项贴在一起、选中态看不出」的问题改不动。这里用 button + Teleport 弹层换成可控的列表。
// 与原生 <select> 对齐的语义：v-model、disabled、title、空值占位、optgroup 分组、@change 仅在用户选择时触发
// （程序化改值不触发，等价于原生 v-model 赋值不发 change —— SynthSection 的「自定义目录…」取消回退依赖这一点）。
// 宽度/布局交给父组件：默认 flex:1 撑满行内剩余空间（同原 .hgen-select 的 style="flex:1"），
// 需要固定宽度就传 style（如 StepBar 的项目切换器 style="width:210px;flex:none"）。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface HfSelectOption {
  value: string
  label: string
  disabled?: boolean
  title?: string
}
export interface HfSelectGroup {
  label: string
  options: HfSelectOption[]
}

const props = withDefaults(defineProps<{
  modelValue: string
  groups: HfSelectGroup[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  title?: string
  style?: string | Record<string, string>
}>(), {
  placeholder: '请选择…',
  emptyText: '（暂无可选项）',
  disabled: false,
  title: '',
  style: 'flex:1'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const allOptions = computed<HfSelectOption[]>(() => props.groups.flatMap((g) => g.options));

const current = computed<HfSelectOption | null>(
  () => allOptions.value.find((o) => o.value === props.modelValue) || null
);
const displayText = computed<string>(() => (current.value ? current.value.label : ''));

// ===== 弹层定位（fixed + 实时测量：不依赖任何祖先的 overflow/定位） =====
const win = (): Window | null => (typeof window === 'undefined' ? null : window);
const menuStyle = ref<Record<string, string>>({});

function placeMenu(): void {
  const el = triggerEl.value;
  const w = win();
  if (!el || !w) return;
  const r = el.getBoundingClientRect();
  const width = Math.max(r.width, 220);
  const left = Math.min(Math.max(8, r.left), Math.max(8, w.innerWidth - width - 8));
  const gap = 6;
  // 弹层理想高度：首帧还没渲染时按选项行高估算，渲染出来后再用实测值
  const idealH = listEl.value
    ? listEl.value.scrollHeight + 12
    : Math.min(allOptions.value.length * 34 + 12, 300);
  const below = w.innerHeight - r.bottom - gap - 8;
  const above = r.top - gap - 8;
  const flip = below < idealH && above > below;
  const room = Math.max(120, flip ? above : below);
  const height = Math.min(idealH, room);
  const top = flip
    ? Math.max(8, r.top - gap - height)
    : Math.min(r.bottom + gap, Math.max(8, w.innerHeight - height - 8));
  menuStyle.value = { left: left + 'px', top: top + 'px', width: width + 'px', maxHeight: height + 'px' };
}

function onReposition(): void { if (open.value) placeMenu(); }

function bindGlobal(): void {
  const w = win();
  if (!w) return;
  // capture 阶段监听滚动：任意祖先容器（.content / 弹窗 body）滚动都能收到
  w.addEventListener('scroll', onReposition, true);
  w.addEventListener('resize', onReposition);
}
function unbindGlobal(): void {
  const w = win();
  if (!w) return;
  w.removeEventListener('scroll', onReposition, true);
  w.removeEventListener('resize', onReposition);
}

async function openMenu(): Promise<void> {
  if (props.disabled || open.value) return;
  open.value = true;
  const w = win();
  if (w) w.document.addEventListener('mousedown', onOutside, true);
  bindGlobal();
  await nextTick();
  placeMenu();
  listEl.value?.focus();
}

function closeMenu(focusTrigger = false): void {
  if (!open.value) return;
  open.value = false;
  const w = win();
  if (w) w.document.removeEventListener('mousedown', onOutside, true);
  unbindGlobal();
  if (focusTrigger) triggerEl.value?.querySelector('button')?.focus();
}

function toggle(): void { open.value ? closeMenu() : void openMenu(); }

function onOutside(e: MouseEvent): void {
  const t = e.target as Node | null;
  if (!t) return;
  if (triggerEl.value?.contains(t)) return;
  if (listEl.value?.contains(t)) return;
  closeMenu();
}

// ===== 选择 =====
function pick(o: HfSelectOption): void {
  if (o.disabled) return;
  closeMenu(true);
  if (o.value === props.modelValue) return;
  emit('update:modelValue', o.value);
  emit('change', o.value);
}

// ===== 键盘导航（原生 select 的等价操作） =====
const activeIndex = ref(-1);
// 模板里按「扁平下标」判断键盘高亮行：分组渲染时每个 option 在自己的组内，需要换算回全局下标
const indexOf = (o: HfSelectOption): number => allOptions.value.indexOf(o);

watch(open, (v) => {
  if (!v) return;
  const i = allOptions.value.findIndex((o) => o.value === props.modelValue && !o.disabled);
  activeIndex.value = i >= 0 ? i : allOptions.value.findIndex((o) => !o.disabled);
});

function highlight(i: number): void {
  const list = listEl.value;
  if (!list) return;
  const el = list.querySelectorAll<HTMLElement>('.hf-sel-opt')[i];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function move(delta: number): void {
  const n = allOptions.value.length;
  if (!n) return;
  let i = activeIndex.value;
  for (let k = 0; k < n; k++) {
    i = (i + delta + n) % n;
    if (!allOptions.value[i].disabled) break;
  }
  activeIndex.value = i;
  highlight(i);
}

function commitActive(): void {
  const o = allOptions.value[activeIndex.value];
  if (o && !o.disabled) pick(o);
}

function onMenuKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
  if (e.key === 'Enter') { e.preventDefault(); commitActive(); return; }
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
  if (e.key === 'Tab') closeMenu();
}

function onTriggerKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    void openMenu();
  }
}

// 选项变化（父组件异步填充下拉数据）时，若正开着则重新测高
watch(() => props.groups, () => { if (open.value) void nextTick(placeMenu) }, { deep: false });

onBeforeUnmount(() => {
  const w = win();
  if (w) {
    w.document.removeEventListener('mousedown', onOutside, true);
    w.removeEventListener('scroll', onReposition, true);
    w.removeEventListener('resize', onReposition);
  }
});
</script>

<style scoped>
/* 触发器：与既有表单控件视觉一致（深底 + 半透明主色描边 + 8px 圆角），右侧加自绘箭头 */
.hf-sel {
  position: relative;
  min-width: 0;
  font-size: 13px;
}

.hf-sel-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  font: inherit;
  text-align: left;
  color: var(--color-primary);
  background: #0A1120;
  border: 1px solid rgba(0, 212, 255, 0.4);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.hf-sel-trigger:hover:not(:disabled) {
  border-color: rgba(0, 212, 255, 0.7);
  background: rgba(0, 212, 255, 0.06);
}
.hf-sel.open .hf-sel-trigger {
  border-color: var(--color-primary);
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.25);
}
.hf-sel-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hf-sel-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.hf-sel-text.ph { color: var(--text-secondary); }

.hf-sel-caret {
  flex: none;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  opacity: 0.75;
  transition: transform 0.2s ease;
}
.hf-sel.open .hf-sel-caret { transform: rotate(180deg); }
</style>

<style>
/* 弹层是 Teleport 到 body 的，scoped 属性虽在但样式统一放全局更便于核对；选择器统一 hf-sel 前缀 */
.hf-sel-menu {
  position: fixed;
  z-index: 9500; /* 高于 .hf-modal-mask(9000)：弹窗里的下拉也要能盖住弹窗 */
  padding: 6px;
  overflow-y: auto;
  background: rgba(11, 18, 32, 0.98);
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55), 0 0 20px rgba(0, 212, 255, 0.15);
  outline: none;
  animation: hfSelIn 0.14s ease;
}
@keyframes hfSelIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.hf-sel-group + .hf-sel-group { margin-top: 6px; }

.hf-sel-group-label {
  padding: 6px 10px 4px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-secondary);
  opacity: 0.85;
}

/* 每个选项独立成行 + 行间距，解决原生下拉「贴在一起」的问题 */
.hf-sel-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 7px 10px;
  margin-bottom: 2px;
  border-radius: 7px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  word-break: break-all;
}
.hf-sel-opt:last-child { margin-bottom: 0; }
.hf-sel-opt:hover { background: rgba(0, 212, 255, 0.12); }
.hf-sel-opt.on {
  background: linear-gradient(90deg, rgba(0, 212, 255, 0.25) 0%, rgba(0, 212, 255, 0) 100%);
  color: var(--color-primary);
  font-weight: 600;
}
.hf-sel-opt.dis { opacity: 0.4; cursor: not-allowed; }
.hf-sel-opt.dis:hover { background: transparent; }

.hf-sel-opt-text { flex: 1; min-width: 0; }

/* 选中勾：自绘（原生 option 里的勾无法控制） */
.hf-sel-tick {
  flex: none;
  width: 12px;
  height: 7px;
  border-left: 2px solid var(--color-primary);
  border-bottom: 2px solid var(--color-primary);
  transform: rotate(-45deg) translateY(-1px);
  opacity: 0;
}
.hf-sel-opt.on .hf-sel-tick { opacity: 1; }

.hf-sel-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
