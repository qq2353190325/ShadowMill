<template>
  <!-- components/NewProjectDialog.vue —— 「新建项目」弹窗（StepBar 与其它入口共用） -->
  <div class="hf-modal-mask" v-show="visible" @click.self="close">
    <div class="hf-modal" style="width:min(460px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">新建项目</span>
        <button class="hf-modal-close" title="关闭" @click="close">×</button>
      </div>
      <div class="hf-modal-body">
        <div class="panel-title-sm" style="margin-top:0">项目名称</div>
        <input
          ref="nameEl"
          v-model="name"
          class="hgen-input"
          style="width:100%"
          placeholder="例如：产品介绍短片"
          @keydown.enter="submit"
        />
        <div class="hgen-tip">确认后立即创建并切换到新项目；项目数据保存在本机（一个项目一个目录）。</div>
      </div>
      <div class="hf-modal-foot">
        <button class="hf-btn" :disabled="busy" @click="close">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="busy" @click="submit">{{ busy ? '创建中…' : '创建并切换' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 交互约定：打开即聚焦输入框；Enter = 确认；Esc / 点遮罩 / 取消 = 关闭。
// 创建流程在本组件内闭环（create → refreshProject → switchProject），父组件只需监听 created 决定跳哪一页。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { refreshProject, switchProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'created', name: string): void
}>();

const name = ref('');
const busy = ref(false);
const nameEl = ref<HTMLInputElement | null>(null);

// 每次打开：清空上一次输入并聚焦（避免残留旧名字被误提交）
watch(() => props.visible, async (open) => {
  if (!open) return;
  name.value = '';
  await nextTick();
  nameEl.value?.focus();
});

function close(): void {
  if (busy.value) return; // 创建中不允许关闭，避免状态错乱
  emit('update:visible', false);
}

async function submit(): Promise<void> {
  if (busy.value) return;
  const nm = name.value.trim();
  if (!nm) { toast('请输入项目名'); nameEl.value?.focus(); return; }
  busy.value = true;
  try {
    const res = await window.projectTools.create(nm);
    if (!res || !res.ok) { toast((res as { message?: string })?.message || '创建失败'); return; }
    await refreshProject();      // 列表里出现新项目
    await switchProject(nm);     // 写入上下文并加载详情
    emit('update:visible', false);
    emit('created', nm);
    toast('已创建并切换到项目「' + nm + '」');
  } finally {
    busy.value = false;
  }
}

// Esc 关闭（仅在弹窗打开时响应；页面里其它弹窗各自管理自己的键盘监听）
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) close();
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>
