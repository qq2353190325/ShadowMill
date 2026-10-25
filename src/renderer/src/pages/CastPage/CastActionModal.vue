<template>
  <!-- 动作示范（「角色」页 · 双击卡片 / 右上「…」菜单）：左边是这个角色**会动**的大图，右边是动作列表。
       动作 = 「时间 → 角色动画参数」的曲线（见 shared/types.ts 的 CastActionDef）：
         · 公共动作：内置 14 条 + 用户自建的，所有角色都能演（关键帧，不调模型）；
         · 本角色专属：AI 读这个角色的源码后生成的（能用到它自己的参数，如尾巴 / 四只脚）。
       这里不改角色本身：要改画法走底部的「改画法…」（复用「角色」页原有的那个弹窗）。 -->
  <div v-if="open" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal" style="width:min(1000px,96vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">动作示范：{{ member?.name || '' }}</span>
        <button class="hf-modal-close" title="关闭" @click="close">×</button>
      </div>

      <div class="hf-modal-body">
        <div v-if="loading" class="hf-status">正在读这个角色的动作…</div>
        <div v-else class="cast-act">
          <!-- 左：会动的大图 -->
          <div class="cast-act-left">
            <CastDemoShot
              :id="member ? member.id : ''"
              :units="member ? member.units : 8"
              :title="member ? member.name : ''"
              :uses="member ? member.uses : []"
              :action-id="current"
              :epoch="demoEpoch"
            />
            <div class="cast-act-now">
              <span class="cast-act-now-name">{{ currentName || '（还没有动作）' }}</span>
              <span class="ch-sub" style="margin-left:0">{{ currentMeta }}</span>
            </div>
            <div class="hgen-tip" style="margin-top:6px">
              动作只驱动角色代码里认得的动画参数（摆臂 / 摆腿 / 表情 / 眨眼 / 位移 / 旋转 / 挤压）；
              老角色没实现的那一项就不会动——那不是坏了，是这个角色当年没写。
            </div>
          </div>

          <!-- 右：动作列表 -->
          <div class="cast-act-right">
            <div class="panel-head">
              <div class="panel-title-sm" style="margin:0">
                公共动作
                <span class="ch-sub">{{ shared.length }} 条 · 所有角色都能演</span>
              </div>
              <div class="panel-head-actions">
                <button class="hf-btn" title="用关键帧表拼一条新动作（不调模型），可只给这个角色" @click="openEditor(null)">新建动作…</button>
              </div>
            </div>
            <div class="cast-act-list">
              <button
                v-for="a in shared"
                :key="a.id"
                class="cast-act-item"
                :class="{ on: a.id === current }"
                :title="itemTitle(a)"
                @click="pick(a)"
              >
                <span class="cast-act-item-name">{{ a.name }}</span>
                <span v-if="a.from === 'preset'" class="cast-act-tag">内置</span>
                <span class="cast-act-item-meta">{{ a.duration }}s{{ a.loop ? ' · 循环' : ' · 一次' }}</span>
                <span v-if="a.from !== 'preset'" class="cast-act-item-acts">
                  <span class="cast-act-link" title="在关键帧表里改这条动作" @click.stop="openEditor(a)">改</span>
                  <span class="cast-act-link danger" title="删掉这条公共动作" @click.stop="onRemove(a, 'shared')">删</span>
                </span>
              </button>
            </div>

            <div class="panel-head">
              <div class="panel-title-sm" style="margin:0">
                本角色专属
                <span class="ch-sub">{{ own.length }} 条 · 只有它能用</span>
              </div>
              <div class="panel-head-actions">
                <button
                  class="hf-btn"
                  :disabled="aiBusy"
                  title="把角色源码发给模型，让它给这个角色编一条专属动作（会用到它自己的参数）"
                  @click="aiOpen = !aiOpen"
                >AI 生成…</button>
              </div>
            </div>

            <!-- AI 生成面板：一句话 + 时长 + 是否循环，一次模型调用 -->
            <div v-if="aiOpen" class="cast-act-ai">
              <textarea
                v-model="aiRequest"
                class="hgen-subtitle"
                style="min-height:56px"
                spellcheck="false"
                placeholder="要什么动作，例如：四脚交替跑起来，尾巴左右甩；或：举起双手欢呼，眼睛笑成弯的"
                :disabled="aiBusy"
              ></textarea>
              <div class="hgen-row" style="margin:8px 0 0">
                <label class="sel-label" style="flex:none">时长</label>
                <input v-model.number="aiDuration" class="hgen-input" type="number" style="width:88px" min="0.3" max="30" step="0.1" :disabled="aiBusy" />
                <span class="ch-sub" style="margin-left:0">秒</span>
                <label class="ch-sub" style="margin-left:8px;display:flex;align-items:center;gap:6px">
                  <input v-model="aiLoop" type="checkbox" :disabled="aiBusy" />
                  循环
                </label>
                <button class="hf-btn hf-btn-primary" style="margin-left:auto" :disabled="aiBusy || !aiRequest.trim()" @click="onGenerate">
                  {{ aiBusy ? '正在编动作…' : '生成' }}
                </button>
              </div>
              <div v-if="aiBusy || aiError" class="hf-status" :class="{ 'hf-error': !!aiError }">
                <template v-if="aiError">
                  <div>{{ aiError }}</div>
                  <div class="hgen-tip" style="margin-top:6px">
                    完整调用记录（含模型的原始回复）：<code>userData/html-agent/cast-action.jsonl</code>
                  </div>
                </template>
                <template v-else>{{ aiStatus || '正在读这个角色的代码，编一条动作…' }}</template>
              </div>
            </div>

            <div v-if="own.length" class="cast-act-list">
              <button
                v-for="a in own"
                :key="a.id"
                class="cast-act-item"
                :class="{ on: a.id === current }"
                :title="itemTitle(a)"
                @click="pick(a)"
              >
                <span class="cast-act-item-name">{{ a.name }}</span>
                <span class="cast-act-tag ai">{{ a.from === 'ai' ? 'AI' : '自建' }}</span>
                <span class="cast-act-item-meta">{{ a.duration }}s{{ a.loop ? ' · 循环' : ' · 一次' }}</span>
                <span class="cast-act-item-acts">
                  <span class="cast-act-link danger" title="删掉这条专属动作" @click.stop="onRemove(a, 'own')">删</span>
                </span>
              </button>
            </div>
            <div v-else class="hgen-tip" style="margin-top:0">
              还没有专属动作。公共动作调不动的部位（比如猫的尾巴、四只脚），用上面的「AI 生成…」让它读这个角色的代码后专门编一条。
            </div>

            <div v-if="listError" class="hf-status hf-error">{{ listError }}</div>
          </div>
        </div>
      </div>

      <div class="hf-modal-foot">
        <button class="hf-btn" :disabled="!member" title="去改这个角色的画法（会打开「角色」页原有的改画法弹窗）" @click="onRecreate">
          改画法…
        </button>
        <button class="hf-btn hf-btn-primary" @click="close">关闭</button>
      </div>
    </div>
  </div>

  <!-- 关键帧表编辑器：新建 / 改一条动作（只动数据，不调模型） -->
  <CastActionEditor
    :open="editorOpen"
    :cast-id="member ? member.id : ''"
    :action="editorAction"
    :scope="editorScope"
    @close="editorOpen = false"
    @saved="onSaved"
  />
</template>

<script setup lang="ts">
// pages/CastPage/CastActionModal.vue —— 「角色」页 · 动作示范（双击卡片 / 「…」菜单 · 动作示范…）。
// 三件事：① 演一条动作给用户看（会动的示范页，CastDemoShot 负责 iframe）；② 管动作列表（公共 + 专属）；
// ③ 把「新建关键帧动作 / AI 生成专属动作 / 改画法」接到各自入口上。
// 为什么动作不进正片：这一版只做**示范**，生成的 HTML 里角色动画仍由章节按 t 自己算（用户已确认）。
import { computed, ref, watch } from 'vue'
import type { CastActionDef, CastActionScope, CastLibraryMember, HtmlProgressPayload } from '@shared/types'
import { CAST_ACTION_DURATION } from '@shared/constants'
import { toast } from '@renderer/composables/useToast'
import { newTaskId } from '@renderer/utils/taskId'
import CastDemoShot from './CastDemoShot.vue'
import CastActionEditor from './CastActionEditor.vue'

const props = defineProps<{ open: boolean; member?: CastLibraryMember | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'recreate', m: CastLibraryMember): void }>()

const shared = ref<CastActionDef[]>([])
const own = ref<CastActionDef[]>([])
const current = ref('')
const loading = ref(false)
const listError = ref('')
// 示范页里嵌的是**当时的**动作表：动作增删 / 角色重画后 +1 让它重新载入（换动作只换 #hash，不动它）
const demoEpoch = ref(0)

const currentName = computed(() => {
  const a = findAction(current.value)
  return a ? a.name : ''
})
const currentMeta = computed(() => {
  const a = findAction(current.value)
  if (!a) return ''
  return a.duration + 's · ' + (a.loop ? '循环' : '演一遍') + (a.from === 'ai' ? ' · AI 生成' : '')
})

function findAction(id: string): CastActionDef | null {
  return shared.value.find((a) => a.id === id) || own.value.find((a) => a.id === id) || null
}

async function load(): Promise<void> {
  const id = props.member ? props.member.id : ''
  if (!id) return
  loading.value = true
  listError.value = ''
  const res = await window.castTools.listActions(id).catch(() => null)
  loading.value = false
  if (!res || !res.ok) {
    shared.value = []
    own.value = []
    listError.value = (res as { message?: string } | null)?.message || '读取动作失败'
    return
  }
  shared.value = res.shared || []
  own.value = res.own || []
  // 当前这条还在就留着；不在了（被删 / 第一次打开）就落到第一条可用动作
  if (!findAction(current.value)) {
    current.value = (shared.value[0] || own.value[0] || { id: '' }).id
  }
}

watch(() => [props.open, props.member && props.member.id], () => {
  if (!props.open) return
  aiOpen.value = false
  aiError.value = ''
  aiStatus.value = ''
  aiRequest.value = ''
  aiDuration.value = 2
  aiLoop.value = true
  current.value = ''
  void load()
}, { immediate: true })

function close(): void {
  if (aiBusy.value) return
  emit('close')
}

function pick(a: CastActionDef): void {
  current.value = a.id
}

function itemTitle(a: CastActionDef): string {
  return a.name + '（' + a.duration + ' 秒' + (a.loop ? '，循环' : '，演一遍') + '）'
}

// ===== 关键帧编辑器 =====
const editorOpen = ref(false)
const editorAction = ref<CastActionDef | null>(null)
const editorScope = ref<CastActionScope>('shared')

function openEditor(a: CastActionDef | null): void {
  // 编辑一条已有动作时沿用它的作用范围：公共的改公共，专属的改专属
  editorScope.value = a && own.value.some((x) => x.id === a.id) ? 'own' : 'shared'
  editorAction.value = a
  editorOpen.value = true
}

// 编辑器保存成功：重读列表 → 演这一条（示范页要重新拼，因为动作表变了）
async function onSaved(action: CastActionDef, _scope: CastActionScope): Promise<void> {
  await load()
  current.value = action.id
  demoEpoch.value++
}

async function onRemove(a: CastActionDef, scope: CastActionScope): Promise<void> {
  if (!window.confirm('删掉动作「' + a.name + '」？' + (scope === 'own' ? '\n\n这是这个角色的专属动作，删了就没了。' : '\n\n这是公共动作，所有角色都会少这一条（内置动作删不掉）。'))) return
  const res = await window.castTools.removeAction({
    castId: props.member ? props.member.id : '',
    scope,
    actionId: a.id
  }).catch(() => null)
  toast(res && res.ok ? '已删除动作：' + a.name : ((res as { message?: string } | null)?.message || '删除失败'))
  if (res && res.ok) {
    await load()
    demoEpoch.value++
  }
}

// ===== AI 生成专属动作（唯一一条会调模型的路径）=====
const aiOpen = ref(false)
const aiRequest = ref('')
const aiDuration = ref(2)
const aiLoop = ref(true)
const aiBusy = ref(false)
const aiStatus = ref('')
const aiError = ref('')

async function onGenerate(): Promise<void> {
  const id = props.member ? props.member.id : ''
  const request = aiRequest.value.trim()
  if (!id || !request || aiBusy.value) return
  aiBusy.value = true
  aiError.value = ''
  aiStatus.value = ''
  // 自己的任务 id：先订阅、再调用（主进程每条进度都带回这个 id，见 preload 的 onTaskProgress）
  const taskId = newTaskId('act')
  const off = window.castTools.onTaskProgress(taskId, (info: HtmlProgressPayload) => {
    if (info && info.text) aiStatus.value = String(info.text)
  })
  const dur = Number(aiDuration.value) || 2
  const res = await window.castTools.generateAction({
    castId: id,
    taskId,
    request,
    duration: Math.min(CAST_ACTION_DURATION.max, Math.max(CAST_ACTION_DURATION.min, dur)),
    loop: aiLoop.value,
    name: request.slice(0, 8)
  }).catch(() => null)
  off()
  aiBusy.value = false
  if (!res || !res.ok) {
    aiError.value = (res as { message?: string } | null)?.message || '生成动作失败（主进程没有返回原因）'
    return
  }
  await load()
  current.value = res.action.id
  demoEpoch.value++
  aiRequest.value = ''
  aiOpen.value = false
  toast('已生成专属动作：' + res.action.name)
}

function onRecreate(): void {
  if (!props.member) return
  emit('recreate', props.member)
}
</script>
