<template>
  <div class="card hgen-panel">
    <div class="panel-title"><span class="dot"></span>语音服务（按厂家配置）</div>
    <div class="hgen-tip">每个厂家一把 API Key；模型与音色都在厂家的目录里，**系统音色与合成模型是固定绑定**（当前厂家：系统音色用 <code>{{ vendorSystemModel }}</code>）。API Key 只保存在本电脑。</div>
    <div class="hgen-row">
      <label class="sel-label">厂家</label>
      <HfSelect v-model="vProvider" :groups="vendorGroups" @change="syncVoiceForm" />
    </div>
    <div class="hgen-row">
      <label class="sel-label">API Key</label>
      <input v-model="vApiKey" type="password" class="hgen-input" style="flex:1" :placeholder="vendorKeyHint" />
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" @click="onSaveVoice">保存该厂家配置</button>
    </div>
    <div class="hf-status" :class="vStatusClass">{{ vStatus }}</div>
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/components/VoiceSection.vue —— 设置页「语音服务（按厂家配置）」区块
// 数据来自 voice:list-models 回带的 providers（厂家目录：label / Key 提示 / 出厂默认模型 / 模型 / 音色），
// 配置来自 settings.json 的 voice 段（active + 各厂家已保存的 apiKey）。
// **这里只有 API Key**：模型与音色的对应关系是固定的（写在厂家目录里），没有「厂家默认模型」这种全局设置。
import { computed, onMounted, ref } from 'vue'
import type { VoiceProviderView } from '../types'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'

const voiceProviders = ref<VoiceProviderView[]>([]);
const vProvider = ref('');                 // 当前编辑的厂家 key
const vApiKey = ref('');
const vStatus = ref('');
const vStatusClass = ref('');
// 各厂家已保存的配置（切厂家时用来回填表单，不丢另一家已填的 Key）
const vSaved = ref<Record<string, { apiKey: string }>>({});

const currentVendor = computed<VoiceProviderView | null>(
  () => voiceProviders.value.find((p) => p.key === vProvider.value) || voiceProviders.value[0] || null
);
const vendorGroups = computed<HfSelectGroup[]>(() => [{
  label: '',
  options: voiceProviders.value.map((p) => ({ value: p.key, label: p.label }))
}]);
const vendorKeyHint = computed(() => (currentVendor.value && currentVendor.value.apiKeyHint) || 'sk-...');
// 该厂家系统音色固定使用的合成模型（目录里的出厂默认）——只作说明展示
const vendorSystemModel = computed(() => (currentVendor.value && currentVendor.value.defaultModel) || '');

function syncVoiceForm(): void {
  const key = (currentVendor.value && currentVendor.value.key) || '';
  vApiKey.value = (vSaved.value[key] && vSaved.value[key].apiKey) || '';
}

function setVStatus(text: string, kind: string): void {
  vStatus.value = text || '';
  vStatusClass.value = kind;
}

async function onSaveVoice(): Promise<void> {
  const vendor = currentVendor.value;
  if (!vendor) { setVStatus('厂家目录未加载，请重开本页', 'hf-error'); return; }
  const apiKey = vApiKey.value.trim();
  const res = await window.voiceTools.saveConfig({ provider: vendor.key, config: { apiKey: apiKey } });
  if (res && res.ok) {
    vSaved.value = Object.assign({}, vSaved.value, { [vendor.key]: { apiKey: apiKey } });
    setVStatus('「' + vendor.label + '」的 API Key 已保存，可在「音色管理」「文字生音频」中使用', 'hf-ok');
  } else {
    setVStatus((res as { message?: string })?.message || '保存失败', 'hf-error');
  }
}

onMounted(async () => {
  // 厂家目录 + 各厂家已保存配置
  const mm = await window.voiceTools.listModels().catch(() => null);
  voiceProviders.value = ((mm && mm.providers) || []) as VoiceProviderView[];
  try {
    const s = await window.settingsTools.get();
    const v = (s && s.voice) || {};
    vSaved.value = (v.providers || {}) as Record<string, { apiKey: string }>;
    vProvider.value = String(v.active || '') || ((voiceProviders.value[0] && voiceProviders.value[0].key) || '');
  } catch (e) {
    setVStatus('读取语音服务配置失败', 'hf-error');
  }
  syncVoiceForm();
});
</script>
