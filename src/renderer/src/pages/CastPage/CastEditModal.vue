<template>
  <!-- 新建角色 / 修改角色：两种模式共用一个弹窗。
       新建 = 从设定画一个新的；修改 = 改库里的信息（名字 / 描述 / 身高 / 笔刷，不调模型，点「保存」立刻生效）
       + 想重画时再写「这次要怎么改」，点「按这个要求重画」调一次模型、覆盖库里这份代码。
       画风只出现在「重画」这一段：点重画时先把表单（含画风）存进库、再调模型，所以这次重画用的就是新画风
       （旧实现是重画完才存画风，填了这次不生效——用户问过"改画风是什么东西"，这里改成一次到位）。
       画成功后**弹窗不关**，直接在这里显示这个角色的大图预览（角色是画出来的，不给预览就得靠猜） -->
  <div v-if="open" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal" style="width:min(620px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">{{ isCreate ? '新建角色' : '修改角色：' + (member?.name || '') }}</span>
        <button class="hf-modal-close" title="关闭" @click="close">×</button>
      </div>

      <!-- 画成功：留在弹窗里看结果 -->
      <div v-if="done" class="hf-modal-body">
        <div class="cast-done">
          <CastShot :id="done.id" :units="done.units" :title="done.name" :uses="done.uses" :epoch="epoch" big />
          <div class="cast-done-info">
            <div class="cast-name" :title="done.name">{{ done.name }}</div>
            <div class="cast-desc" style="white-space:normal">{{ done.desc || '（未描述）' }}</div>
            <div class="cast-style" v-if="done.style">画风：{{ done.style }}</div>
            <div class="cast-done-meta">高 {{ done.units }}u · id <code>{{ done.id }}</code></div>
            <div class="hgen-tip" style="margin-top:8px">
              {{ isCreate
                ? '已存进全局角色库。去「HTML生成」页勾上它，重新生成后才会画进页面。'
                : '已按你的要求重画，覆盖了角色库里的这份代码。所有用到它的项目，下次生成 / 改稿时自动用新的画法。' }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="hf-modal-body">
        <!-- 修改角色：先看现在的样子，再改信息 / 写重画要求 -->
        <div v-if="!isCreate && member" class="cast-done" style="margin-bottom:12px">
          <CastShot :id="member.id" :units="draft.units" :title="draft.name" :uses="draft.watercolor ? ['p5', 'p5.brush'] : []" big />
          <div class="cast-done-info">
            <div class="cast-name" :title="member.name">{{ member.name }}</div>
            <div class="cast-desc" style="white-space:normal">{{ member.desc || '（未描述）' }}</div>
            <div class="cast-style" v-if="member.style">画风：{{ member.style }}</div>
            <div class="cast-done-meta">id <code>{{ member.id }}</code>（id 与代码文件不会因改名而变化）</div>
            <div class="hgen-tip" style="margin-top:8px">
              改名字 / 描述 / 身高 / 笔刷只动库里的信息、不动绘制代码；要换长相，用下面的「这次要怎么改」。
            </div>
          </div>
        </div>

        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:56px">角色名</label>
          <input
            v-model="draft.name"
            class="hgen-input"
            style="flex:1"
            :placeholder="isCreate ? '如：主角 / 研究员 / 猫（英文名会当 id）' : '界面上显示的名字'"
          />
        </div>
        <div class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">外形描述</div>
          <textarea
            v-model="draft.desc"
            class="hgen-subtitle"
            style="min-height:74px"
            spellcheck="false"
            placeholder="外观 / 配色 / 关键特征，例如：戴圆眼镜的小人，米白实验袍，墨线勾边，头发乱"
          ></textarea>
        </div>
        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:56px">身高</label>
          <input v-model.number="draft.units" class="hgen-input" type="number" min="1" max="30" step="0.5" style="width:96px" />
          <span class="ch-sub" style="margin-left:0">{{ isCreate ? 'u（主角 8、配角 6 这样，多角色比例靠它对齐）' : 'u（只影响默认画多大，不重画代码）' }}</span>
        </div>
        <div class="hgen-row" :style="isCreate ? 'margin-bottom:0' : ''">
          <label class="sel-label" style="flex:none;width:56px">笔刷</label>
          <label class="ch-sub" style="margin-left:0;display:flex;align-items:center;gap:6px">
            <input v-model="draft.watercolor" type="checkbox" />
            用水彩笔刷（p5.brush{{ isCreate ? '；不勾则用 Canvas 2D 平涂' : '' }}）
          </label>
        </div>

        <!-- 新建：画风是"这一次画"的设定（跟创建请求一起发给模型） -->
        <div v-if="isCreate" class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">画风（可选）</div>
          <textarea
            v-model="draft.style"
            class="hgen-subtitle"
            style="min-height:56px"
            spellcheck="false"
            placeholder="这个角色的画风，例如：水彩绘本、米白底色 + 暖橙点缀、粗墨线勾边（留空 = 让模型自己定一套）"
          ></textarea>
        </div>

        <!-- 修改：重画区。填了「这次要怎么改」才会调模型；只改上面的信息就不用管这里 -->
        <template v-else>
          <div class="hgen-block" style="margin-bottom:0">
            <div class="panel-title-sm">重画（可选，会调一次模型）</div>
            <div class="hgen-tip" style="margin:0 0 8px">
              想把长相换掉时填下面两项：填了「这次要怎么改」才重画；只改上面的信息就别填。
            </div>
          </div>
          <div class="hgen-block" style="margin-bottom:0">
            <div class="panel-title-sm">画风（重画时按它画，也会记进角色库）</div>
            <textarea
              v-model="draft.style"
              class="hgen-subtitle"
              style="min-height:52px"
              spellcheck="false"
              placeholder="例如：水彩绘本、米白底色 + 暖橙点缀、粗墨线勾边（留空 = 沿用库里现有的画风）"
            ></textarea>
          </div>
          <div class="hgen-block" style="margin-bottom:0">
            <div class="panel-title-sm">这次要怎么改</div>
            <textarea
              v-model="draft.request"
              class="hgen-subtitle"
              style="min-height:74px"
              spellcheck="false"
              placeholder="例如：补一套侧面视图（读 o.face：0 正面 / 1 侧面，正面保持不变）；或：头发改成短卷发，其余不变"
            ></textarea>
          </div>
        </template>

        <!-- 进度与失败原因就放在弹窗里：页面那条状态条在弹窗**后面**，看不见。
             进度走**本弹窗自己的 taskId**（见 preload 的 onTaskProgress）：与「生成 HTML」并行时各订阅各的。
             文案里的「已思考 N 字符」来自 payload 的 thinkChars（精确值），**不要**改用 thinkText.length
             ——那是主进程 slice(-20000) 截过的尾部片段，会恒定卡在 20000。 -->
        <div v-if="busy || metaBusy || errorText" class="hf-status" :class="{ 'hf-error': !!errorText }">
          <template v-if="errorText">
            <div>{{ errorText }}</div>
            <div class="hgen-tip" style="margin-top:6px">
              完整调用记录（含模型的原始回复）：<code>userData/html-agent/cast.jsonl</code>
            </div>
          </template>
          <template v-else>
            <div>{{ status || (isCreate ? '正在画角色…' : '正在改这个角色…') }}</div>
          </template>
        </div>
      </div>

      <div class="hf-modal-foot">
        <template v-if="done">
          <button v-if="isCreate" class="hf-btn" :disabled="busy" @click="again">再画一个</button>
          <button class="hf-btn hf-btn-primary" @click="close">完成</button>
        </template>
        <template v-else-if="isCreate">
          <button class="hf-btn" @click="close">取消</button>
          <button class="hf-btn hf-btn-primary" :disabled="busy || !canSubmit" @click="onCreate">
            {{ busy ? '正在画…' : '画这个角色' }}
          </button>
        </template>
        <template v-else>
          <button class="hf-btn" @click="close">取消</button>
          <button class="hf-btn" :disabled="busy || metaBusy || !canSave" title="只保存名字 / 描述 / 画风 / 身高 / 笔刷，不调模型" @click="onSaveMeta">
            {{ metaBusy ? '保存中…' : '保存' }}
          </button>
          <button class="hf-btn hf-btn-primary" :disabled="busy || metaBusy || !canRedraw" title="先保存上面这些信息（含画风），再让模型按「这次要怎么改」重画一遍" @click="onRedraw">
            {{ busy ? '正在改…' : '按这个要求重画' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/CastPage/CastEditModal.vue —— 「角色」页的新建与修改（cast:create / cast:save-meta / cast:recreate）。
// 两条动作各管一件事：
//   · 保存   = cast:save-meta：只改库里的元数据（名字 / 描述 / 画风 / 身高 / 是否水彩），不调模型、不动代码；
//   · 重画   = 先 cast:save-meta（把画风与其它字段落进库）再 cast:recreate：在库里这份代码上按「这次要怎么改」重画、覆盖同一份。
// 为什么先保存再重画：重画读的是**库里的**元数据（buildCastEditPrompt 用 member.style），
// 先落库才能保证「这次填的画风这次就生效」，也保证 id / 身高不变（项目里引用它的章节不会认不出人）。
// 状态机：① 填表单 ②（重画时）成功后留窗看大图；失败原因常驻在弹窗里。
import { computed, reactive, ref, watch } from 'vue'
import type { CastLibraryMember, CastResult, CastSaveMetaPayload } from '@shared/types'
import { toast } from '@renderer/composables/useToast'
import { newTaskId } from '@renderer/utils/taskId'
import CastShot from '@renderer/components/CastShot.vue'

const props = defineProps<{ open: boolean; mode: 'create' | 'edit'; member?: CastLibraryMember | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed', m: CastResult['member']): void }>()

const isCreate = computed(() => props.mode === 'create')
const draft = reactive({ name: '', desc: '', style: '', units: 8, watercolor: false, request: '' })
// busy = 模型调用中（新建 / 重画）；metaBusy = 只存信息中。分开是为了按钮文案不互相串
const busy = ref(false)
const metaBusy = ref(false)
// 本弹窗自己的进度文案：按 taskId 订阅（与「生成 HTML」那一路完全隔离）
const status = ref('')
// 失败原因常驻在弹窗里：只发一条 2.8 秒的 toast，用户看不到就等于没有反馈
const errorText = ref('')
const done = ref<CastLibraryMember | null>(null)
// 画成功后文件刚写盘，必须换地址让 iframe 重新载入
const epoch = ref(0)

const canSubmit = computed(() => isCreate.value && !!(draft.name.trim() || draft.desc.trim()))
const canSave = computed(() => !isCreate.value && !!draft.name.trim())
const canRedraw = computed(() => !isCreate.value && !!draft.name.trim() && !!draft.request.trim())

// 每次打开都重置：新建从空白表单开始，修改则带上这个角色当前的信息
watch(() => [props.open, props.mode, props.member && props.member.id], () => {
  if (!props.open) return
  done.value = null
  errorText.value = ''
  status.value = ''
  busy.value = false
  metaBusy.value = false
  const m = props.member
  draft.name = isCreate.value ? '' : String(m && m.name || '')
  draft.desc = isCreate.value ? '' : String(m && m.desc || '')
  draft.style = isCreate.value ? '' : String(m && m.style || '')
  draft.units = isCreate.value ? 8 : Number(m && m.units) || 8
  draft.watercolor = !isCreate.value && !!(m && m.uses && m.uses.indexOf('p5') >= 0)
  draft.request = ''
}, { immediate: true })

function close(): void {
  if (busy.value || metaBusy.value) return
  emit('close')
}

// 「再画一个」：回到空白表单（上一个角色已经落库，列表里也会有）
function again(): void {
  done.value = null
  errorText.value = ''
  status.value = ''
  draft.name = ''
  draft.desc = ''
  draft.style = ''
  draft.units = 8
  draft.watercolor = false
}

// 新建 / 只存信息 / 重画都从这一份表单取值：口径只有一处，三处调用不会各填一套
function metaPayload(): CastSaveMetaPayload {
  return {
    id: String(props.member && props.member.id || ''),
    name: draft.name.trim(),
    desc: draft.desc.trim(),
    style: draft.style.trim(),
    units: Number(draft.units) || 8,
    watercolor: draft.watercolor
  }
}

async function onCreate(): Promise<void> {
  if (busy.value || !canSubmit.value) return
  busy.value = true
  errorText.value = ''
  status.value = ''
  // 自己的任务 id：先订阅、再调用（主进程每条进度都带回这个 id，见 preload 的 onTaskProgress）
  const taskId = newTaskId('cast')
  const off = window.castTools.onTaskProgress(taskId, (info) => {
    if (!info) return
    if (info.text) status.value = String(info.text)
  })
  const res = await window.castTools.create({
    taskId,
    title: draft.name.trim(),
    desc: draft.desc.trim(),
    style: draft.style.trim(),
    units: Number(draft.units) || 8,
    watercolor: draft.watercolor
  }).catch(() => null)
  off()
  busy.value = false
  if (!res || !res.ok) {
    errorText.value = (res as { message?: string } | null)?.message || '新建角色失败（主进程没有返回原因）'
    return
  }
  done.value = res.member
  epoch.value++
  emit('changed', res.member)
}

// 只存信息：不调模型，改完立刻生效（项目里的角色元数据是回库读的）
async function onSaveMeta(): Promise<void> {
  if (busy.value || metaBusy.value || !canSave.value) return
  metaBusy.value = true
  errorText.value = ''
  const res = await window.castTools.saveMeta(metaPayload()).catch(() => null)
  metaBusy.value = false
  if (!res || !res.ok) {
    errorText.value = (res as { message?: string } | null)?.message || '保存失败（主进程没有返回原因）'
    return
  }
  toast('已保存：' + res.member.name)
  emit('changed', res.member)
  emit('close')
}

async function onRedraw(): Promise<void> {
  if (busy.value || metaBusy.value || !canRedraw.value) return
  busy.value = true
  errorText.value = ''
  status.value = ''
  // ① 先把表单（尤其画风）落进库：重画读的是库里的元数据，这一步保证"这次填的画风这次生效"
  const meta = await window.castTools.saveMeta(metaPayload()).catch(() => null)
  if (!meta || !meta.ok) {
    busy.value = false
    errorText.value = (meta as { message?: string } | null)?.message || '先把角色信息写进库时失败，重画没有开始'
    return
  }
  // ② 再让模型在库里那份代码上重画（覆盖同一份，id / 身高不变）
  const taskId = newTaskId('cast')
  const off = window.castTools.onTaskProgress(taskId, (info) => {
    if (!info) return
    if (info.text) status.value = String(info.text)
  })
  const res = await window.castTools.recreate(String(meta.member.id), draft.request.trim(), taskId).catch(() => null)
  off()
  busy.value = false
  if (!res || !res.ok) {
    errorText.value = (res as { message?: string } | null)?.message || '重画失败（主进程没有返回原因）'
    return
  }
  done.value = res.member
  epoch.value++
  emit('changed', res.member)
}
</script>
