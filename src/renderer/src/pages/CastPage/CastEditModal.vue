<template>
  <!-- 新建角色 / 改画法：两种模式共用一个弹窗（字段只差一个"本次改动"）。
       画成功后**弹窗不关**，直接在这里显示这个角色的大图预览（角色是画出来的，不给预览就得靠猜） -->
  <div v-if="open" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal" style="width:min(620px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">{{ isCreate ? '新建角色' : '改画法：' + (member?.name || '') }}</span>
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
                : '已覆盖角色库里的这份代码。所有用到它的项目，下次生成 / 改稿时自动用新的画法。' }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="hf-modal-body">
        <!-- 改画法：先看现在的样子，再写"要改成什么样" -->
        <div v-if="!isCreate && member" class="cast-done" style="margin-bottom:12px">
          <CastShot :id="member.id" :units="member.units" :title="member.name" :uses="member.uses" big />
          <div class="cast-done-info">
            <div class="cast-name" :title="member.name">{{ member.name }}</div>
            <div class="cast-desc" style="white-space:normal">{{ member.desc || '（未描述）' }}</div>
            <div class="cast-style" v-if="member.style">画风：{{ member.style }}</div>
            <div class="cast-done-meta">高 {{ member.units }}u · id <code>{{ member.id }}</code></div>
            <div class="hgen-tip" style="margin-top:8px">改画法只换"怎么画"，id 与身高不变——项目里引用它的章节不会因此认不出人。</div>
          </div>
        </div>

        <template v-if="isCreate">
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:56px">角色名</label>
            <input v-model="draft.title" class="hgen-input" style="flex:1" placeholder="如：主角 / 研究员 / 猫（英文名会当 id）" />
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
            <span class="ch-sub" style="margin-left:0">u（主角 8、配角 6 这样，多角色比例靠它对齐）</span>
          </div>
          <div class="hgen-row" style="margin-bottom:0">
            <label class="sel-label" style="flex:none;width:56px">笔刷</label>
            <label class="ch-sub" style="margin-left:0;display:flex;align-items:center;gap:6px">
              <input v-model="draft.watercolor" type="checkbox" />
              用水彩笔刷（p5.brush；不勾则用 Canvas 2D 平涂）
            </label>
          </div>
        </template>

        <!-- 画风：角色自带（角色是全局资产，跟项目无关，所以不再借项目的「全局视觉风格」） -->
        <div class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">画风（可选）</div>
          <textarea
            v-model="draft.style"
            class="hgen-subtitle"
            style="min-height:56px"
            spellcheck="false"
            :placeholder="isCreate
              ? '这个角色的画风，例如：水彩绘本、米白底色 + 暖橙点缀、粗墨线勾边（留空 = 让模型自己定一套）'
              : '不改画风就留空；填了会连同新画法一起记进角色库'"
          ></textarea>
        </div>

        <!-- 改画法：这次要改什么（必填） -->
        <div v-if="!isCreate" class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">这次要怎么改</div>
          <textarea
            v-model="draft.request"
            class="hgen-subtitle"
            style="min-height:74px"
            spellcheck="false"
            placeholder="例如：头发改成短卷发、把实验袍换成深蓝卫衣，其余不变"
          ></textarea>
        </div>

        <!-- 画角色的过程与失败原因就放在弹窗里：页面那条状态条在弹窗**后面**，看不见。
             进度走**本弹窗自己的 taskId**（见 preload 的 onTaskProgress）：与「生成 HTML」并行时各订阅各的。
             文案里的「已思考 N 字符」来自 payload 的 thinkChars（精确值），
             **不要**改用 thinkText.length——那是主进程 slice(-20000) 截过的尾部片段，会恒定卡在 20000。 -->
        <div v-if="busy || errorText" class="hf-status" :class="{ 'hf-error': !!errorText }">
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
        <template v-else>
          <button class="hf-btn" @click="close">取消</button>
          <button class="hf-btn hf-btn-primary" :disabled="busy || !canSubmit" @click="onSubmit">
            {{ busy ? (isCreate ? '正在画…' : '正在改…') : (isCreate ? '画这个角色' : '按这个要求改') }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/CastPage/CastEditModal.vue —— 「角色」页的两个动作：新建角色（cast:create）与改画法（cast:recreate）。
// 两者都是"调一次模型画一份 cast/<id>.js"，落点都是**全局角色库**（与项目无关），区别只有：
//   新建 = 从设定画一个新的；改画法 = 在库里这份现有代码上按用户要求重画、覆盖同一份。
// 状态机与旧的新建弹窗一致：① 填表单（或写改动要求）② 成功后留窗看大图；失败原因常驻在弹窗里。
import { computed, reactive, ref, watch } from 'vue'
import type { CastLibraryMember, CastResult } from '@shared/types'
import { toast } from '@renderer/composables/useToast'
import { newTaskId } from '@renderer/utils/taskId'
import CastShot from '@renderer/components/CastShot.vue'

const props = defineProps<{ open: boolean; mode: 'create' | 'recreate'; member?: CastLibraryMember | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed', m: CastResult['member']): void }>()

const isCreate = computed(() => props.mode === 'create')
const draft = reactive({ title: '', desc: '', style: '', units: 8, watercolor: false, request: '' })
const busy = ref(false)
// 本弹窗自己的进度文案：按 taskId 订阅（与「生成 HTML」那一路完全隔离）
const status = ref('')
// 失败原因常驻在弹窗里：只发一条 2.8 秒的 toast，用户看不到就等于没有反馈
const errorText = ref('')
const done = ref<CastLibraryMember | null>(null)
// 画成功后文件刚写盘，必须换地址让 iframe 重新载入
const epoch = ref(0)
const canSubmit = computed(() => isCreate.value
  ? !!(draft.title.trim() || draft.desc.trim())
  : !!draft.request.trim())

// 每次打开都重置：新建从空白表单开始，改画法带上这个角色当前的信息
watch(() => [props.open, props.mode, props.member && props.member.id], () => {
  if (!props.open) return
  done.value = null
  errorText.value = ''
  status.value = ''
  const m = props.member
  draft.title = isCreate.value ? '' : String(m && m.name || '')
  draft.desc = isCreate.value ? '' : String(m && m.desc || '')
  draft.style = isCreate.value ? '' : String(m && m.style || '')
  draft.units = isCreate.value ? 8 : Number(m && m.units) || 8
  draft.watercolor = !isCreate.value && !!(m && m.uses && m.uses.indexOf('p5') >= 0)
  draft.request = ''
}, { immediate: true })

function close(): void {
  if (busy.value) return
  emit('close')
}

// 「再画一个」：回到空白表单（上一个角色已经落库，列表里也会有）
function again(): void {
  done.value = null
  errorText.value = ''
  status.value = ''
  draft.title = ''
  draft.desc = ''
  draft.style = ''
  draft.units = 8
  draft.watercolor = false
}

async function onSubmit(): Promise<void> {
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
  const res = isCreate.value
    ? await window.castTools.create({
      taskId,
      title: draft.title.trim(),
      desc: draft.desc.trim(),
      style: draft.style.trim(),
      units: Number(draft.units) || 8,
      watercolor: draft.watercolor
    }).catch(() => null)
    : await window.castTools.recreate(String(props.member && props.member.id || ''), draft.request.trim(), taskId).catch(() => null)
  off()
  busy.value = false
  if (!res || !res.ok) {
    errorText.value = (res as { message?: string } | null)?.message || (isCreate.value ? '新建角色失败（主进程没有返回原因）' : '改画法失败（主进程没有返回原因）')
    return
  }
  // 改画法时如果同时填了画风，顺手把它记进角色库（不调模型，只改元数据）
  let member = res.member
  if (!isCreate.value && draft.style.trim() && props.member && draft.style.trim() !== String(props.member.style || '')) {
    const meta = await window.castTools.saveMeta({ id: member.id, style: draft.style.trim() }).catch(() => null)
    if (meta && meta.ok) member = meta.member
    else toast('画风没保存成功（画法已更新）')
  }
  done.value = member
  epoch.value++
  emit('changed', member)
}
</script>
