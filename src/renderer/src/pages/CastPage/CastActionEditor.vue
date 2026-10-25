<template>
  <!-- 新建 / 编辑一条关键帧动作（动作示范弹窗里的「新建动作…」）：
       动作 = 「时间 → 动画参数」的曲线，每行一个时间点，每列一个参数；播放时相邻两行之间平滑过渡。
       内置动作（from = 'preset'）不能改，打开时会变成"另存为新动作"（id 置空、名字加个后缀）。 -->
  <div v-if="open" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal" style="width:min(1080px,96vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">{{ isEdit ? '改动作：' + draft.name : '新建动作' }}</span>
        <button class="hf-modal-close" title="关闭" @click="close">×</button>
      </div>

      <div class="hf-modal-body">
        <div class="hgen-row" style="gap:12px;flex-wrap:wrap">
          <label class="sel-label" style="flex:none;width:56px">名称</label>
          <input v-model="draft.name" class="hgen-input" style="width:180px" :maxlength="NAME_MAX" placeholder="如：挥手" />
          <label class="sel-label" style="flex:none;margin-left:8px">时长</label>
          <input
            class="hgen-input"
            type="number"
            style="width:96px"
            :min="DURATION.min"
            :max="DURATION.max"
            step="0.1"
            :value="draft.duration"
            @input="onDuration($event)"
          />
          <span class="ch-sub" style="margin-left:0">秒</span>
          <label class="ch-sub" style="margin-left:8px;display:flex;align-items:center;gap:6px">
            <input v-model="draft.loop" type="checkbox" />
            循环播放
          </label>
          <!-- 作用范围只在**新建**时可选：已有动作改到另一个范围会留下一条重复（同一条既在公共又在专属） -->
          <label v-if="!isEdit && scope !== 'own'" class="ch-sub" style="margin-left:8px;display:flex;align-items:center;gap:6px">
            <input v-model="onlyThis" type="checkbox" />
            只给这个角色
          </label>
        </div>

        <!-- 关键帧表：一行一个时间点。参数清单来自 shared/constants.ts 的 CAST_ACTION_PARAMS（与主进程同一份） -->
        <div class="cast-act-table">
          <div class="cast-act-tr head">
            <span class="cast-act-th">时间(s)</span>
            <span v-for="p in PARAMS" :key="p.key" class="cast-act-th" :title="p.label">{{ p.label }}</span>
            <span class="cast-act-th"></span>
          </div>
          <div v-for="(row, i) in rows" :key="i" class="cast-act-tr">
            <input
              class="cast-act-cell"
              type="number"
              min="0"
              :max="draft.duration"
              step="0.05"
              :value="row.t"
              @input="onTime(row, $event)"
            />
            <template v-for="p in PARAMS" :key="p.key">
              <input
                v-if="p.type === 'number'"
                class="cast-act-cell"
                type="number"
                :min="p.min"
                :max="p.max"
                :step="p.step"
                :value="row.o[p.key]"
                @input="onNum(row, p.key, $event)"
              />
              <select v-else class="cast-act-cell" :value="String(row.o[p.key] == null ? 'auto' : row.o[p.key])" @change="onEnum(row, p.key, $event)">
                <option v-for="op in p.options" :key="op" :value="op">{{ op === 'auto' ? '自动' : op }}</option>
              </select>
            </template>
            <button class="cast-act-del" :disabled="rows.length <= 2" title="删掉这一帧（至少要留两帧）" @click="removeRow(i)">×</button>
          </div>
        </div>

        <div class="hgen-row" style="margin-bottom:0">
          <button class="hf-btn" @click="addRow">添加关键帧</button>
          <button class="hf-btn" title="把这一条另存成一份新的（内置动作本身不会被改）" @click="duplicate">另存为副本</button>
          <span class="ch-sub" style="margin-left:0">mouth 选「自动」= 不传这个参数，让角色按表情自己定嘴型</span>
        </div>

        <div v-if="errorText" class="hf-status hf-error">{{ errorText }}</div>
      </div>

      <div class="hf-modal-foot">
        <button class="hf-btn" @click="close">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="busy || !canSave" @click="onSave">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/CastPage/CastActionEditor.vue —— 关键帧动作的编辑器（只改数据，不调模型）。
// 动作存在哪由 scope 决定：shared = 公共动作（所有角色都能演），own = 只给当前这个角色。
// 参数清单**不在这里另写一份**：shared/constants.ts 的 CAST_ACTION_PARAMS 同时供界面（本表）
// 与主进程落盘校验用，两边口径必须一致（方向与范围见那份常量的注释）。
import { computed, reactive, ref, watch } from 'vue'
import type { CastActionDef, CastActionKey, CastActionScope } from '@shared/types'
import {
  CAST_ACTION_DURATION, CAST_ACTION_NAME_MAX, CAST_ACTION_PARAMS
} from '@shared/constants'
import { toast } from '@renderer/composables/useToast'

const props = defineProps<{
  open: boolean
  // 当前角色（专属动作要它）
  castId: string
  // 要编辑的动作（null = 新建）
  action?: CastActionDef | null
  // 新建时默认存哪：shared 公共 / own 只给这个角色
  scope: CastActionScope
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', action: CastActionDef, scope: CastActionScope): void
}>()

const PARAMS = CAST_ACTION_PARAMS
const NAME_MAX = CAST_ACTION_NAME_MAX
const DURATION = CAST_ACTION_DURATION

// 一行关键帧：t + 参数。数字参数在新建行时就把默认值填上（缺省 0，与角色端"没传 = 0"一致）；
// eyes 默认 normal；**mouth 故意不填** —— 不传它，角色才会按 eyes 自己定嘴型。
interface KeyRow {
  t: number
  o: Record<string, number | string>
}
function blankRow(t: number): KeyRow {
  const o: Record<string, number | string> = {}
  for (const p of PARAMS) {
    if (p.type === 'number') o[p.key] = p.def || 0
    else if (p.key === 'eyes') o[p.key] = 'normal'
  }
  return { t, o }
}

const draft = reactive({ name: '', duration: 2, loop: true })
const rows = ref<KeyRow[]>([])
const onlyThis = ref(false)
const busy = ref(false)
const errorText = ref('')
// 正在编辑的动作 id（内置动作另存为时置空 = 新建）
const editId = ref('')
const isEdit = computed(() => !!editId.value)
const scope = computed<CastActionScope>(() => (props.scope === 'own' || onlyThis.value ? 'own' : 'shared'))
const canSave = computed(() => !!draft.name.trim() && rows.value.length >= 2 && draft.duration > 0)

// 打开时灌入：新建给两帧（0 与结尾），编辑则把已有动作摊到表里
watch(() => [props.open, props.action && props.action.id], () => {
  if (!props.open) return
  errorText.value = ''
  busy.value = false
  onlyThis.value = props.scope === 'own'
  const a = props.action
  if (!a) {
    editId.value = ''
    draft.name = ''
    draft.duration = 2
    draft.loop = true
    rows.value = [blankRow(0), blankRow(2)]
    return
  }
  editId.value = a.from === 'preset' ? '' : a.id
  draft.name = a.from === 'preset' ? a.name + ' 副本' : a.name
  draft.duration = a.duration
  draft.loop = a.loop
  const src = Array.isArray(a.keys) ? a.keys : []
  rows.value = (src.length ? src : [{ t: 0, o: {} }, { t: a.duration, o: {} }]).map((k: CastActionKey) => {
    const row = blankRow(k.t)
    for (const p of PARAMS) {
      if (!(p.key in (k.o || {}))) continue
      const v = (k.o || {})[p.key]
      row.o[p.key] = p.type === 'number' ? Number(v) || 0 : String(v)
    }
    return row
  })
}, { immediate: true })

function close(): void {
  if (busy.value) return
  emit('close')
}

function onDuration(ev: Event): void {
  const n = Number((ev.target as HTMLInputElement).value)
  if (!isFinite(n)) return
  draft.duration = Math.min(DURATION.max, Math.max(DURATION.min, n))
}

function onTime(row: KeyRow, ev: Event): void {
  const n = Number((ev.target as HTMLInputElement).value)
  row.t = isFinite(n) ? Math.min(draft.duration, Math.max(0, n)) : 0
}

function onNum(row: KeyRow, key: string, ev: Event): void {
  const n = Number((ev.target as HTMLInputElement).value)
  row.o[key] = isFinite(n) ? n : 0
}

function onEnum(row: KeyRow, key: string, ev: Event): void {
  const v = (ev.target as HTMLSelectElement).value
  // 'auto' = 不传这个参数（落盘时主进程会丢掉它）
  if (v === 'auto') delete row.o[key]
  else row.o[key] = v
}

function addRow(): void {
  // 新帧默认插在最后一帧前面一点（比时长略短），时间点常要手调，但总比叠在 0 上强
  const last = rows.value[rows.value.length - 1]
  const t = last ? Math.max(0, (last.t + draft.duration) / 2) : 0
  rows.value.push(blankRow(Math.round(t * 100) / 100))
}

function removeRow(i: number): void {
  if (rows.value.length <= 2) return
  rows.value.splice(i, 1)
}

// 另存为副本：清掉 id 走"新建"，名字加后缀，其余原样（改内置动作就用它）
function duplicate(): void {
  editId.value = ''
  if (!/副本/.test(draft.name)) draft.name = (draft.name || '动作') + ' 副本'
}

async function onSave(): Promise<void> {
  if (busy.value || !canSave.value) return
  busy.value = true
  errorText.value = ''
  const keys: CastActionKey[] = rows.value
    .map((r) => ({ t: Number(r.t) || 0, o: { ...r.o } }))
    .sort((a, b) => a.t - b.t)
  const action: CastActionDef = {
    id: editId.value,
    name: draft.name.trim(),
    duration: Number(draft.duration) || 2,
    loop: draft.loop,
    keys,
    from: 'user'
  }
  const res = await window.castTools.saveAction({
    castId: props.castId,
    scope: scope.value,
    action
  }).catch(() => null)
  busy.value = false
  if (!res || !res.ok) {
    errorText.value = (res as { message?: string } | null)?.message || '保存失败（主进程没有返回原因）'
    return
  }
  toast('已保存动作：' + res.action.name)
  emit('saved', res.action, scope.value)
  emit('close')
}
</script>
