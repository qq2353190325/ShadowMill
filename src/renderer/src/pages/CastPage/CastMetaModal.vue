<template>
  <!-- 改信息：只改元数据（名字 / 描述 / 画风 / 身高 / 是否水彩），**不调模型**、不动绘制代码。
       因为项目里的角色元数据是回库读的，改完所有引用它的项目立刻跟着变（不需要重新生成）。 -->
  <div v-if="open" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal" style="width:min(560px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">改信息：{{ member?.name || '' }}</span>
        <button class="hf-modal-close" title="关闭" @click="close">×</button>
      </div>
      <div class="hf-modal-body">
        <div class="cast-done" style="margin-bottom:12px">
          <CastShot :id="member ? member.id : ''" :units="draft.units" :title="draft.name" :uses="draft.watercolor ? ['p5', 'p5.brush'] : []" :epoch="epoch" big />
          <div class="cast-done-info">
            <div class="cast-done-meta">id <code>{{ member?.id || '' }}</code>（id 与代码文件不会因改名而变化）</div>
            <div class="hgen-tip" style="margin-top:8px">
              改身高只影响"默认画多大"（章节里按 u 换算），不会重画代码；改名字 / 描述后，
              下次生成或改稿时模型看到的就是新值。
            </div>
          </div>
        </div>

        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:56px">角色名</label>
          <input v-model="draft.name" class="hgen-input" style="flex:1" placeholder="界面上显示的名字" />
        </div>
        <div class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">外形描述</div>
          <textarea v-model="draft.desc" class="hgen-subtitle" style="min-height:64px" spellcheck="false" placeholder="外观 / 配色 / 关键特征（进提示词）"></textarea>
        </div>
        <div class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">画风（可选）</div>
          <textarea v-model="draft.style" class="hgen-subtitle" style="min-height:52px" spellcheck="false" placeholder="这个角色的画风说明（改画法时用；留空 = 没指定）"></textarea>
        </div>
        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:56px">身高</label>
          <input v-model.number="draft.units" class="hgen-input" type="number" min="1" max="30" step="0.5" style="width:96px" />
          <span class="ch-sub" style="margin-left:0">u</span>
        </div>
        <div class="hgen-row" style="margin-bottom:0">
          <label class="sel-label" style="flex:none;width:56px">笔刷</label>
          <label class="ch-sub" style="margin-left:0;display:flex;align-items:center;gap:6px">
            <input v-model="draft.watercolor" type="checkbox" />
            用水彩笔刷（p5.brush）
          </label>
        </div>

        <div v-if="errorText" class="hf-status hf-error">{{ errorText }}</div>
      </div>
      <div class="hf-modal-foot">
        <button class="hf-btn" @click="close">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="busy || !draft.name.trim()" @click="onSave">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/CastPage/CastMetaModal.vue —— 「改信息」（cast:save-meta）：只改元数据，不调模型。
import { reactive, ref, watch } from 'vue'
import type { CastLibraryMember, CastResult } from '@shared/types'
import { toast } from '@renderer/composables/useToast'
import CastShot from '@renderer/components/CastShot.vue'

const props = defineProps<{ open: boolean; member?: CastLibraryMember | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed', m: CastResult['member']): void }>()

const draft = reactive({ name: '', desc: '', style: '', units: 8, watercolor: false })
const busy = ref(false)
const errorText = ref('')
const epoch = ref(0)

watch(() => [props.open, props.member && props.member.id], () => {
  if (!props.open) return
  const m = props.member
  errorText.value = ''
  draft.name = String(m && m.name || '')
  draft.desc = String(m && m.desc || '')
  draft.style = String(m && m.style || '')
  draft.units = Number(m && m.units) || 8
  draft.watercolor = !!(m && m.uses && m.uses.indexOf('p5') >= 0)
}, { immediate: true })

function close(): void {
  if (busy.value) return
  emit('close')
}

async function onSave(): Promise<void> {
  if (busy.value) return
  const id = String(props.member && props.member.id || '')
  if (!id) return
  busy.value = true
  errorText.value = ''
  const res = await window.castTools.saveMeta({
    id,
    name: draft.name.trim(),
    desc: draft.desc.trim(),
    style: draft.style.trim(),
    units: Number(draft.units) || 8,
    watercolor: draft.watercolor
  }).catch(() => null)
  busy.value = false
  if (!res || !res.ok) {
    errorText.value = (res as { message?: string } | null)?.message || '保存失败（主进程没有返回原因）'
    return
  }
  // 身高 / 是否水彩会影响预览里画多大，换一次地址重载
  epoch.value++
  emit('changed', res.member)
  toast('已保存：' + res.member.name)
  emit('close')
}
</script>
