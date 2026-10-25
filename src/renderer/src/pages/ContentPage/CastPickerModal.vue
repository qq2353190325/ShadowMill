<template>
  <!-- 全局角色库：这里只回答「写这一版稿子时，片子里有谁」，**不往项目里加任何东西**——
       角色只有全局一份，「HTML生成」页那边只是勾选本片用哪几个。
       版式与「角色」页同一套方格网格：挑角色看的是长相，所以每格先给一张 CastShot 预览。 -->
  <div v-if="open" class="hf-modal-mask" @click.self="close">
    <div class="hf-modal" style="width:min(760px,94vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">选择角色（写稿用）</span>
        <button class="hf-modal-close" title="关闭" @click="close">×</button>
      </div>
      <div class="hf-modal-body">
        <div v-if="!lib.length" class="hgen-tip" style="margin-top:0">
          全局角色库还是空的：先去「角色」页点「新建角色」画一个，这里才有得选。
        </div>
        <div v-else class="cast-grid">
          <div
            v-for="m in lib"
            :key="m.id"
            class="cast-card"
            :class="{ on: picked.indexOf(m.id) >= 0, off: !!m.missing }"
            role="button"
            :tabindex="m.missing ? -1 : 0"
            :title="(m.missing ? '文件缺失：' : '') + m.name + ' · ' + (m.desc || '（未描述）') + ' · 高 ' + m.units + 'u'"
            @click="toggle(m)"
            @keydown.enter.prevent="toggle(m)"
          >
            <CastShot
              :id="m.id"
              :units="m.units"
              :title="m.name"
              :uses="m.uses"
            />
            <div class="cast-card-meta">
              <span class="cast-card-name">{{ m.name }}</span>
              <span class="cast-card-sub">{{ m.units }}u</span>
            </div>
            <span v-if="picked.indexOf(m.id) >= 0" class="cast-card-tick">✓</span>
            <span v-if="m.missing" class="cast-card-missing">文件缺失</span>
          </div>
        </div>
        <div class="hgen-tip">
          选中的角色只写进这一版的<b>提示词</b>（名字 / 外观描述 / 身高），让 AI 按它们写旁白与画面分镜；
          <b>不会</b>把角色加进本项目——「HTML生成」页用哪些角色，由那一页的角色勾选决定。
        </div>
        <div v-if="full" class="hgen-tip">已选满 {{ MAX_CAST }} 个（一次最多 {{ MAX_CAST }} 个，再多也不会发给模型）。</div>
      </div>
      <div class="hf-modal-foot">
        <button class="hf-btn" @click="close">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="!lib.length || !picked.length" @click="confirm">确定（选中 {{ picked.length }} 个）</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/ContentPage/CastPickerModal.vue —— 「内容脚本」页 · AI 创作 · 选择角色
// 只读全局角色库（castTools.list）+ 预览（CastShot，走 userData 下的角色预览页），**不写任何文件**：
// 确定时把选中成员的快照（id / 名字 / 描述 / 身高）回传给面板，面板只在发送时把它塞进提示词。
// 缺文件的成员（库里有索引、缺 <id>.js）压暗不可选，与「角色」页同一口径。
import { computed, ref, watch } from 'vue'
import type { CastLibraryMember, ScriptCastRef } from '@shared/types'
import { toast } from '@renderer/composables/useToast'
import CastShot from '@renderer/components/CastShot.vue'

const props = defineProps<{
  open: boolean
  // 当前已选的 id（打开时回填勾选）
  selected: string[]
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', members: ScriptCastRef[]): void
}>()

const lib = ref<CastLibraryMember[]>([])
const picked = ref<string[]>([])
// 与 src/main/agent/script.ts 的 MAX_CAST 对齐：超过这个数，主进程会把多出来的角色丢掉。
// 界面先挡住，免得用户选了 25 个、实际只发出去 20 个却毫无提示。
const MAX_CAST = 20;
const full = computed(() => picked.value.length >= MAX_CAST);

// 每次打开都重新读库（用户可能刚在「角色」页建过 / 改过角色），并用当前选择回填勾选
watch(() => props.open, (open) => {
  if (!open) return
  picked.value = Array.isArray(props.selected) ? props.selected.slice() : []
  void loadLib()
}, { immediate: true })

async function loadLib(): Promise<void> {
  const res = await window.castTools.list().catch(() => null)
  if (!res || !res.ok) {
    lib.value = []
    toast((res as { message?: string } | null)?.message || '读取全局角色库失败')
    return
  }
  lib.value = res.members || []
}

function toggle(m: CastLibraryMember): void {
  if (m.missing) return
  const at = picked.value.indexOf(m.id)
  if (at >= 0) picked.value.splice(at, 1)
  else if (!full.value) picked.value.push(m.id)
}

function close(): void {
  emit('close')
}

// 确定：只回传还读得到的成员（库里被删掉的 id 自然消失，界面上不会留幽灵角色）
function confirm(): void {
  const byId = new Map(lib.value.filter((m) => !m.missing).map((m) => [m.id, m]))
  const members: ScriptCastRef[] = []
  for (const id of picked.value) {
    const m = byId.get(id)
    if (!m) continue
    members.push({ id: m.id, name: m.name, desc: m.desc || '', units: m.units });
  }
  emit('confirm', members)
  emit('close')
}
</script>
