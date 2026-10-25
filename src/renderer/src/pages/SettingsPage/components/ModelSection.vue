<template>
  <div class="card hgen-panel">
    <div class="panel-title"><span class="dot"></span>自定义模型</div>
    <div class="hgen-tip">配置「HTML 生成 / 修改」使用的模型服务。只支持 OpenAI 格式的端点，Anthropic 格式暂不支持。Base URL 与模型 ID 可从常见服务商直接选，也可手填自己的服务地址；填好 API Key 并勾选「启用」后，HTML 生成页就用这个模型工作。API Key 只保存在本电脑。「思考强度」控制模型是否先思考再答：思考内容同样按输出计费（推理模型里它常占输出的大头），脚本这类结构化任务可以调到「不思考」省钱，生成 / 修改长代码页面建议保持「高」。</div>
    <div class="hgen-row">
      <label class="sel-label">Base URL</label>
      <HfSelect
        v-if="!baseUrlCustom"
        :model-value="baseUrl"
        :groups="baseUrlGroups"
        @change="onBaseUrlPick"
      />
      <template v-else>
        <input v-model="baseUrl" class="hgen-input" style="flex:1" placeholder="https://…/v1（OpenAI 兼容，需含版本段）" />
        <button class="hf-btn" style="flex:none" @click="baseUrlCustom = false">从列表选</button>
      </template>
    </div>
    <div class="hgen-row">
      <label class="sel-label">模型 ID</label>
      <HfSelect
        v-if="!modelCustom"
        :model-value="modelId"
        :groups="modelGroups"
        @change="onModelPick"
      />
      <template v-else>
        <input v-model="modelId" class="hgen-input" style="flex:1" placeholder="如 deepseek-flash / qwen3.8-max" />
        <button class="hf-btn" style="flex:none" @click="modelCustom = false">从列表选</button>
      </template>
    </div>
    <div class="hgen-row">
      <label class="sel-label">API Key</label>
      <input v-model="apiKey" type="password" class="hgen-input" style="flex:1" placeholder="sk-..." />
    </div>
    <div class="hgen-row">
      <label class="sel-label">思考强度</label>
      <HfSelect :model-value="reasoningEffort" :groups="effortGroups" @change="onEffortPick" />
    </div>
    <div class="hgen-row">
      <label class="sel-label">启用</label>
      <label class="hgen-check"><input v-model="enabled" type="checkbox" /> 使用自定义模型生成 / 修改 HTML</label>
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" @click="onSave">保存配置</button>
      <button class="hf-btn" @click="onTest">测试连接</button>
    </div>
    <div class="hf-status" :class="statusClass">{{ status }}</div>
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/components/ModelSection.vue —— 设置页「模型配置」区块（自定义模型，OpenAI 兼容）
// 挂载时读一次 settings.json 的 customModel 段，保存 / 测试连接都只写这一张卡片的状态行。
import { computed, onMounted, ref } from 'vue'
import { MODEL_PROVIDERS } from '@renderer/constants'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import { CUSTOM_VALUE } from '../constants'
import type { ReasoningEffort } from '@shared/types'

const baseUrl = ref('');
const modelId = ref('');
const apiKey = ref('');
const enabled = ref(false);
// 思考强度：原样作为 reasoning_effort 下发（取值口径同 DeepSeek）。思考内容也按输出 token 计费，
// 所以「不思考」是省钱档；默认 high 与接口默认一致。
const reasoningEffort = ref<ReasoningEffort>('high');
const status = ref('');
const statusClass = ref('');

// Base URL / 模型 ID 的下拉预设（表在 @renderer/constants 的 MODEL_PROVIDERS）。
// 「自定义」是个哨兵值（CUSTOM_VALUE，见 ../constants）：选中它只切到手填输入框、**不动当前值**。
// 这里刻意用 :model-value + @change 而不是 v-model —— 用 v-model 时哨兵值会先写进 baseUrl，
// 用户接着点「保存配置」就会把 '__custom__' 存进 settings.json。
const baseUrlCustom = ref(false);
const modelCustom = ref(false);

// 当前 baseUrl 命中哪个服务商预设（模型列表跟着它联动）
const currentProvider = computed(() => MODEL_PROVIDERS.find((p) => p.baseUrls.includes(baseUrl.value)) || null);

const baseUrlGroups = computed<HfSelectGroup[]>(() => {
  const groups: HfSelectGroup[] = MODEL_PROVIDERS.map((p) => ({
    label: p.label,
    // 选项文字就是 URL 本身：Base URL 没有需要额外解释的地方，加了反而是噪音
    options: p.baseUrls.map((u) => ({ value: u, label: u }))
  }));
  // 已保存的地址不在预设里（自建网关 / 中转站）：补一条「当前配置」，否则下拉显示空占位，看着像配置丢了
  if (baseUrl.value && !MODEL_PROVIDERS.some((p) => p.baseUrls.includes(baseUrl.value))) {
    groups.push({ label: '当前配置', options: [{ value: baseUrl.value, label: baseUrl.value, title: '你当前保存的值' }] });
  }
  groups.push({ label: '', options: [{ value: CUSTOM_VALUE, label: '自定义…（手动填写）' }] });
  return groups;
});

// 模型列表跟随 Base URL：命中预设才列出该家的模型；没命中就只给「自定义」——
// 免得列一堆跟当前端点配不上的名字诱导用户选错（选错就是运行期 404 model not found）
const modelGroups = computed<HfSelectGroup[]>(() => {
  const groups: HfSelectGroup[] = [];
  const p = currentProvider.value;
  if (p) groups.push({ label: p.label, options: p.models.map((m) => ({ value: m, label: m })) });
  if (modelId.value && !(p && p.models.includes(modelId.value))) {
    groups.push({ label: '当前配置', options: [{ value: modelId.value, label: modelId.value, title: '你当前保存的值' }] });
  }
  groups.push({ label: '', options: [{ value: CUSTOM_VALUE, label: '自定义…（手动填写）' }] });
  return groups;
});

function onBaseUrlPick(v: string): void {
  if (v === CUSTOM_VALUE) { baseUrlCustom.value = true; return; }
  baseUrl.value = v;
  baseUrlCustom.value = false;
  // 换了服务商：已填的模型名若不属于新家，切到手填态（值保留，便于改名而不是从头输）
  if (modelId.value && !(currentProvider.value && currentProvider.value.models.includes(modelId.value))) {
    modelCustom.value = true;
  }
}

function onModelPick(v: string): void {
  if (v === CUSTOM_VALUE) { modelCustom.value = true; return; }
  modelId.value = v;
  modelCustom.value = false;
}

// 思考强度下拉：四个档位直接对应接口的 reasoning_effort，说明写在 title 里（不占界面常驻文字）
const effortGroups: HfSelectGroup[] = [{
  label: '',
  options: [
    { value: 'none', label: '不思考（最省）', title: '不产生思考内容，reasoning 不计费；适合脚本这类结构化任务，生成长代码页面质量会下降' },
    { value: 'low', label: '低', title: '思考得少一些，费用低于默认' },
    { value: 'high', label: '高（默认）', title: '接口默认强度' },
    { value: 'max', label: '最高', title: '思考额度更大，费用最高' }
  ]
}];

function onEffortPick(v: string): void {
  reasoningEffort.value = v as ReasoningEffort;
}

function setStatus(text: string, kind: string): void {
  status.value = text || '';
  statusClass.value = kind;
}

function collectCustomModel(): { baseUrl: string; modelId: string; apiKey: string; enabled: boolean; reasoningEffort: ReasoningEffort } {
  return {
    baseUrl: baseUrl.value.trim(),
    modelId: modelId.value.trim(),
    apiKey: apiKey.value.trim(),
    enabled: enabled.value,
    reasoningEffort: reasoningEffort.value
  };
}

async function onSave(): Promise<void> {
  const customModel = collectCustomModel();
  if (!customModel.baseUrl || !customModel.modelId || !customModel.apiKey) {
    setStatus('配置不完整：Base URL / Model ID / API Key 均需填写', 'hf-error');
    return;
  }
  const res = await window.settingsTools.save(customModel);
  setStatus(res && res.ok ? '配置已保存，可开始使用自定义模型生成 HTML' : ((res as { message?: string })?.message || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
}

async function onTest(): Promise<void> {
  setStatus('正在测试连接...', '');
  const res = await window.settingsTools.test(collectCustomModel());
  // 刻意**不弹配置类弹窗**：这个按钮本身就在设置页上、失败文案就显示在它旁边，
  // 再弹一个「去设置」框是让用户从原地跳到原地。主进程照常回 needConfig（供别的入口用），这里只显示状态。
  setStatus(res && res.ok ? (res.message || '连接成功') : ((res as { message?: string })?.message || '测试失败'), res && res.ok ? 'hf-ok' : 'hf-error');
}

onMounted(async () => {
  try {
    const s = await window.settingsTools.get();
    const m = (s && s.customModel) || {};
    baseUrl.value = m.baseUrl || '';
    modelId.value = m.modelId || '';
    apiKey.value = m.apiKey || '';
    enabled.value = !!m.enabled;
    // 老配置没有这个字段：主进程读设置时已落回 high，这里兜一层免得下拉显示空占位
    reasoningEffort.value = (m.reasoningEffort as ReasoningEffort) || 'high';
    // 已保存的值不在预设里 ⇒ 默认进手填态。不这么做下拉会显示空占位，用户看到的是"我配的地址/模型没了"
    baseUrlCustom.value = !!baseUrl.value && !MODEL_PROVIDERS.some((p) => p.baseUrls.includes(baseUrl.value));
    modelCustom.value = !!modelId.value && !(currentProvider.value && currentProvider.value.models.includes(modelId.value));
  } catch (e) {
    setStatus('读取配置失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : e), 'hf-error');
  }
});
</script>
