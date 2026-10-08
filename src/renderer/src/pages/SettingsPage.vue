<template>
  <div>
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>自定义模型（OpenAI 兼容）</div>
      <div class="hgen-tip">配置用于「HTML 生成 / 修改」的自定义模型 Agent。填写 Base URL、模型 ID 与 API Key 并开启后，HTML 生成页即使用该模型工作。API Key 仅保存在本机 userData/settings.json。</div>
      <div class="hgen-row">
        <label class="sel-label">Base URL</label>
        <input v-model="baseUrl" class="hgen-input" style="flex:1" placeholder="https://api.openai.com/v1（需以 /v1 结尾，按服务商实际提供）" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">模型 ID</label>
        <input v-model="modelId" class="hgen-input" style="flex:1" placeholder="如 gpt-4o-mini / deepseek-chat" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">API Key</label>
        <input v-model="apiKey" type="password" class="hgen-input" style="flex:1" placeholder="sk-..." />
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
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>千问语音（音色管理 & 文字生音频）</div>
      <div class="hgen-tip">配置千问AI平台 API Key 与目标语音合成模型，供「音色管理」和「文字生音频」使用。API Key 仅保存在本机 userData/settings.json。创建音色时的 target_model 必须与合成模型一致。</div>
      <div class="hgen-row">
        <label class="sel-label">API Key</label>
        <input v-model="vApiKey" type="password" class="hgen-input" style="flex:1" placeholder="sk-...（DASHSCOPE_API_KEY）" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">目标模型</label>
        <select v-model="vModel" class="hgen-select" style="flex:1">
          <option v-for="m in voiceModels" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveVoice">保存千问语音配置</button>
      </div>
      <div class="hf-status" :class="vStatusClass">{{ vStatus }}</div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>语音识别模型（whisper.cpp 字幕转录）</div>
      <div class="hgen-tip">供字幕页「从音频生成字幕」在本机离线识别使用（不消耗 API 额度）。模型按「id ↔ 文件名」一一枚举登记：只识别登记在枚举内的文件名，枚举外的文件视为未知模型。模型文件不随应用打包，首次使用需在此下载（下载源为 HuggingFace 国内镜像 hf-mirror.com，规避 GitHub 直链超时）。点「设为当前使用」后，字幕转录弹窗即使用该档位；其他 ggml 模型可用「添加自定义模型」起名登记。</div>
      <WhisperSection />
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage.vue —— 设置页（原 pages/settings/{template,index}.js 移植）
// 自定义模型 + 千问语音配置；语音识别模型区块为子组件 WhisperSection（原 window.__settings.initWhisper）。
import { onMounted, ref } from 'vue'
import WhisperSection from './settings/WhisperSection.vue'

// ===== 自定义模型（OpenAI 兼容） =====
const baseUrl = ref('');
const modelId = ref('');
const apiKey = ref('');
const enabled = ref(false);
const status = ref('');
const statusClass = ref('');

function setStatus(text: string, kind: string): void {
  status.value = text || '';
  statusClass.value = kind;
}

function collectCustomModel(): { baseUrl: string; modelId: string; apiKey: string; enabled: boolean } {
  return {
    baseUrl: baseUrl.value.trim(),
    modelId: modelId.value.trim(),
    apiKey: apiKey.value.trim(),
    enabled: enabled.value
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
  setStatus(res && res.ok ? (res.message || '连接成功') : ((res as { message?: string })?.message || '测试失败'), res && res.ok ? 'hf-ok' : 'hf-error');
}

// ===== 千问语音配置 =====
interface VoiceModelView { id: string; label: string; isDefault?: boolean }
const vApiKey = ref('');
const vModel = ref('');
const voiceModels = ref<VoiceModelView[]>([]);
const vStatus = ref('');
const vStatusClass = ref('');

function setVStatus(text: string, kind: string): void {
  vStatus.value = text || '';
  vStatusClass.value = kind;
}

async function onSaveVoice(): Promise<void> {
  const res = await window.voiceTools.saveConfig({ apiKey: vApiKey.value.trim(), targetModel: vModel.value });
  setVStatus(res && res.ok ? '千问语音配置已保存，可在「音色管理」「文字生音频」中使用' : ((res as { message?: string })?.message || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
}

onMounted(async () => {
  // 载入当前配置
  try {
    const s = await window.settingsTools.get();
    const m = (s && s.customModel) || {};
    baseUrl.value = m.baseUrl || '';
    modelId.value = m.modelId || '';
    apiKey.value = m.apiKey || '';
    enabled.value = !!m.enabled;
  } catch (e) {
    setStatus('读取配置失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : e), 'hf-error');
  }
  // 动态填充候选模型表（语音复刻 + 系统音色合成）
  const mm = await window.voiceTools.listModels().catch(() => ({ ok: false, models: [] } as any));
  voiceModels.value = ((mm && mm.models) || []) as VoiceModelView[];
  try {
    const s = await window.settingsTools.get();
    const v = (s && s.voiceTTS) || {};
    vApiKey.value = v.apiKey || '';
    if (v.targetModel && voiceModels.value.some((m) => m.id === v.targetModel)) {
      vModel.value = v.targetModel;
    } else if (voiceModels.value.length) {
      const def = voiceModels.value.find((m) => m.isDefault);
      vModel.value = (def || voiceModels.value[0]).id;
    }
  } catch (e) {
    setVStatus('读取千问语音配置失败', 'hf-error');
  }
});
</script>
