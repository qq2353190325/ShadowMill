<template>
  <!-- 动作示范（「角色」页 · 双击卡片 / 右上「…」菜单）：左边是这个角色**会动**的大图，右边是动作列表。
       动作 = 「时间 → 角色动画参数」的曲线（见 shared/types.ts 的 CastActionDef）：
         · 公共动作：内置 14 条 + 用户自建的，所有角色都能演（关键帧，不调模型）；
         · 本角色专属：AI 读这个角色的源码后生成的（能用到它自己的参数，如尾巴 / 四只脚），或建的时候勾了「只给这个角色」。
       两类动作都能**再改**（列表里每条都有「改」）：关键帧 -> 关键帧表，AI 动作 -> 带上现有脚本再问一次模型、覆盖同一条。
       这里不改角色本身：要改名字 / 描述 / 画风 / 身高或让它重画，走底部的「修改角色…」。 -->
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
                  :title="aiEdit ? '收起这个面板（这条动作不会被改）' : '把角色源码发给模型，让它给这个角色编一条专属动作（会用到它自己的参数）'"
                  @click="toggleAi"
                >{{ aiOpen ? '收起' : 'AI 生成…' }}</button>
              </div>
            </div>

            <!-- AI 生成面板：一句话 + 时长 + 是否循环，一次模型调用。
                 编辑一条 AI 动作时（列表里的「改」）同一个面板复用：标题换成"正在改这条"，
                 请求写的是"要改成什么样"，主进程会把这条现有脚本一起发过去、改完覆盖同一条。 -->
            <div v-if="aiOpen" class="cast-act-ai">
              <div v-if="aiEdit" class="hgen-tip" style="margin:0 0 6px">
                正在改这条动作：<b>{{ aiEdit.name }}</b>——带上它现在的脚本再问一次模型，改完<i>覆盖同一条</i>（不新增）。
              </div>
              <textarea
                v-model="aiRequest"
                class="hgen-subtitle"
                style="min-height:56px"
                spellcheck="false"
                :placeholder="aiEdit
                  ? '要改成什么样，例如：手再抬高一点、加个转身，其余不变'
                  : '要什么动作，例如：四脚交替跑起来，尾巴左右甩；或：举起双手欢呼，眼睛笑成弯的'"
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
                  {{ aiBusy ? '正在编动作…' : (aiEdit ? '按这个要求改' : '生成') }}
                </button>
              </div>
              <div v-if="aiBusy || aiError" class="hf-status" :class="{ 'hf-error': !!aiError }">
                <template v-if="aiError">
                  <div>{{ aiError }}</div>
                  <div class="hgen-tip" style="margin-top:6px">
                    完整调用记录（含模型的原始回复）：<code>userData/html-agent/cast-action.jsonl</code>
                  </div>
                </template>
                <template v-else>{{ aiStatus || (aiEdit ? '正在按你的要求改这条动作…' : '正在读这个角色的代码，编一条动作…') }}</template>
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
                  <span class="cast-act-link" :title="a.code ? '让 AI 在它现在的脚本上按你的新要求再改一次（覆盖同一条，不新增）' : '在关键帧表里改这条动作'" @click.stop="onEditOwn(a)">改</span>
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
        <button class="hf-btn" :disabled="!member" title="打开「修改角色」弹窗：改名字 / 描述 / 画风 / 身高，或者让它按你的要求重画" @click="onEditCast">
          修改角色…
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
// ③ 把「新建关键帧动作 / AI 生成专属动作 / 改一条已保存的动作 / 修改角色」接到各自入口上。
// **二次修改**（用户要求）：「本角色专属」里每条动作都有「改」——关键帧动作进关键帧表，
// AI 生成的动作（存的是脚本 code）回到 AI 面板、带上现有脚本再让模型改一次，覆盖同一条。
// 为什么动作不进正片：这一版只做**示范**，生成的 HTML 里角色动画仍由章节按 t 自己算（用户已确认）。
import { computed, ref, watch } from 'vue'
import type { CastActionDef, CastActionScope, CastLibraryMember, HtmlProgressPayload } from '@shared/types'
import { CAST_ACTION_DURATION } from '@shared/constants'
import { toast } from '@renderer/composables/useToast'
import { newTaskId } from '@renderer/utils/taskId'
import CastDemoShot from './CastDemoShot.vue'
import CastActionEditor from './CastActionEditor.vue'

const props = defineProps<{ open: boolean; member?: CastLibraryMember | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'edit', m: CastLibraryMember): void }>()

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
  aiEdit.value = null
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

// ===== AI 生成 / 二次修改专属动作（唯一一条会调模型的路径）=====
const aiOpen = ref(false)
// 正在改的那条 AI 动作（null = 新建一条）：决定提示文案、按钮文案，以及落盘时覆盖哪一条
const aiEdit = ref<CastActionDef | null>(null)
const aiRequest = ref('')
const aiDuration = ref(2)
const aiLoop = ref(true)
const aiBusy = ref(false)
const aiStatus = ref('')
const aiError = ref('')

// 面板开关：收起时一并退出"改这条"，下次点「AI 生成…」就是新建一条
function toggleAi(): void {
  if (aiOpen.value) {
    aiOpen.value = false
    aiEdit.value = null
    return
  }
  aiError.value = ''
  aiStatus.value = ''
  aiRequest.value = ''
  aiDuration.value = 2
  aiLoop.value = true
  aiEdit.value = null
  aiOpen.value = true
}

// 专属动作的「改」：关键帧动作进关键帧表；AI 动作回 AI 面板——带上它现在的脚本改一次，
// 改完**覆盖同一条**（id / 名字 / 来源都不变，只有脚本 + 时长 / 循环按这次入参）。
function onEditOwn(a: CastActionDef): void {
  if (a.code) {
    aiError.value = ''
    aiStatus.value = ''
    aiRequest.value = ''
    aiDuration.value = a.duration
    aiLoop.value = a.loop
    aiEdit.value = a
    aiOpen.value = true
    return
  }
  openEditor(a)
}

async function onGenerate(): Promise<void> {
  const id = props.member ? props.member.id : ''
  const request = aiRequest.value.trim()
  if (!id || !request || aiBusy.value) return
  const editing = aiEdit.value
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
    // 给了 actionId = 改这条已有动作（主进程覆盖同一条，名字与"AI"来源沿用）
    ...(editing ? { actionId: editing.id, name: editing.name } : { name: request.slice(0, 8) }),
    duration: Math.min(CAST_ACTION_DURATION.max, Math.max(CAST_ACTION_DURATION.min, dur)),
    loop: aiLoop.value
  }).catch(() => null)
  off()
  aiBusy.value = false
  if (!res || !res.ok) {
    aiError.value = (res as { message?: string } | null)?.message || (editing ? '改动作失败（主进程没有返回原因）' : '生成动作失败（主进程没有返回原因）')
    return
  }
  await load()
  current.value = res.action.id
  demoEpoch.value++
  aiRequest.value = ''
  aiEdit.value = null
  aiOpen.value = false
  toast((editing ? '已改动作：' : '已生成专属动作：') + res.action.name)
}

function onEditCast(): void {
  if (!props.member) return
  emit('edit', props.member)
}
</script>
