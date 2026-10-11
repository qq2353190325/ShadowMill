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
      <div class="panel-title"><span class="dot"></span>视频渲染默认档位</div>
      <div class="hgen-tip">「HTML生成」页点「转视频」时的默认档位，普通使用只需在这两项中选择。单个项目可在「HTML生成」页的「渲染档位」单独覆盖（项目覆盖优先于这里的默认）。质量 draft 编码最快但文字边缘可能有压缩痕迹，仅用于快速确认内容；降低帧率不会缩短成片时长，只是采样更稀、渲染更快。</div>
      <div class="hgen-row">
        <label class="sel-label">质量</label>
        <select v-model="rQuality" class="hgen-select" style="flex:1">
          <option v-for="o in qualityOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="hgen-row">
        <label class="sel-label">帧率</label>
        <select v-model="rFps" class="hgen-select" style="flex:1">
          <option v-for="o in fpsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveRender">保存渲染默认档位</button>
      </div>
      <div class="hf-status" :class="rStatusClass">{{ rStatus }}</div>
      <div class="hgen-tip" style="margin-top:8px">{{ qualityHint }}</div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>语音识别模型（whisper.cpp 字幕转录）</div>
      <div class="hgen-tip">供字幕页「从音频生成字幕」在本机离线识别使用（不消耗 API 额度）。模型按「id ↔ 文件名」一一枚举登记：只识别登记在枚举内的文件名，枚举外的文件视为未知模型。模型文件不随应用打包，首次使用需在此下载（下载源为 HuggingFace 国内镜像 hf-mirror.com，规避 GitHub 直链超时）。点「设为当前使用」后，字幕转录弹窗即使用该档位；其他 ggml 模型可用「添加自定义模型」起名登记。</div>
      <WhisperSection />
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>应用更新</div>
      <div class="hgen-tip">
        当前版本 <b>{{ updateVersion || '—' }}</b>。应用从你自建的更新源（静态服务器）检查新版本：检查与下载由你手动触发，安装包下载完成后点「立即重启安装」，或直接关闭应用时自动完成安装。
      </div>
      <div class="hgen-row">
        <label class="sel-label">更新源</label>
        <input v-model="feedUrl" class="hgen-input" style="flex:1" placeholder="留空 = 使用打包时内置的更新地址；如 http://192.168.1.10:8099/" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">启动检查</label>
        <label class="hgen-check"><input v-model="autoCheck" type="checkbox" /> 启动后静默检查一次更新（仅在设置页显示状态，不弹窗打扰）</label>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveUpdater">保存更新设置</button>
        <button class="hf-btn" :disabled="updateBusy" @click="onCheckUpdate">检查更新</button>
        <button v-if="updateStage === 'available' || updateStage === 'skipped'" class="hf-btn" @click="onDownloadUpdate">下载更新</button>
        <button v-if="updateStage === 'downloading'" class="hf-btn" @click="onCancelUpdate">取消下载</button>
        <button v-if="updateStage === 'downloaded'" class="hf-btn hf-btn-primary" @click="onInstallUpdate">立即重启安装</button>
      </div>
      <div class="hf-status" :class="updateStatusClass">{{ updateMessage }}</div>
      <div v-if="updateStage === 'available'" class="hgen-actions" style="margin-top:8px">
        <button class="hf-btn" @click="onSkipVersion(true)">跳过版本 {{ updateVersion }}</button>
      </div>
      <div v-else-if="updateStage === 'skipped'" class="hgen-actions" style="margin-top:8px">
        <button class="hf-btn" @click="onSkipVersion(false)">恢复提示版本 {{ updateVersion }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/index.vue —— 设置页（原 JS 版 settings 模块 {template,index}.js 移植）
// 自定义模型 + 千问语音配置 + 视频渲染默认档位；语音识别模型区块为子组件 WhisperSection（原 window.__settings.initWhisper）。
import { computed, onMounted, ref } from 'vue'
import type { RenderFps, RenderQuality, UpdateProgressPayload, UpdateStage } from '@shared/types'
import {
  FALLBACK_RENDER,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITY_OPTIONS,
  renderQualityLabel
} from '@renderer/utils/render'
import { saveRenderDefaults } from '@renderer/composables/useRenderOptions'
import WhisperSection from './WhisperSection.vue'

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

// ===== 视频渲染默认档位（全局默认；项目级覆盖在「HTML生成」页的「渲染档位」单独设置）=====
// 普通用户只有两项：质量（draft / standard / high）与帧率（24 / 30）。
const qualityOptions = RENDER_QUALITY_OPTIONS;
const fpsOptions = RENDER_FPS_OPTIONS;
const rQuality = ref<RenderQuality>(FALLBACK_RENDER.quality);
const rFps = ref<RenderFps>(FALLBACK_RENDER.fps);
const rStatus = ref('');
const rStatusClass = ref('');
// 当前所选质量的说明（快速预览会明确提示画质代价）
const qualityHint = computed(() => {
  const hit = RENDER_QUALITY_OPTIONS.find((o) => o.value === rQuality.value);
  return hit ? hit.hint : '';
});

function setRStatus(text: string, kind: string): void {
  rStatus.value = text || '';
  rStatusClass.value = kind;
}

async function onSaveRender(): Promise<void> {
  const res = await saveRenderDefaults({ quality: rQuality.value, fps: rFps.value });
  setRStatus(
    res.ok ? '渲染默认档位已保存：' + renderQualityLabel(rQuality.value) + ' · ' + rFps.value + 'fps' : (res.message || '保存失败'),
    res.ok ? 'hf-ok' : 'hf-error'
  );
}

// ===== 应用更新（electron-updater generic provider）=====
// 全部状态由主进程 update:progress 通道驱动：设置页只是订阅方 + 触发方（检查 / 下载 / 重启安装）。
// 进度事件在进入本页之前就发生过也没关系——onProgress 订阅后主进程下一次广播会把当前态带过来。
interface UpdateCheckReply {
  ok: boolean
  state?: 'none' | 'available' | 'skipped'
  version?: string
  currentVersion?: string
  message?: string
}

const updateVersion = ref('');
const updateStage = ref<UpdateStage>('idle');
const updateMessage = ref('');
const updateStatusClass = ref('');
// 有网络动作在跑时禁用重复点击（检查中的重复点击是最常见的误操作）
const updateBusy = computed(() => updateStage.value === 'checking' || updateStage.value === 'downloading');
const feedUrl = ref('');
const autoCheck = ref(true);
const updaterStatus = ref('');
const updaterStatusClass = ref('');

function applyUpdateProgress(d: UpdateProgressPayload): void {
  if (!d) return;
  updateStage.value = d.stage;
  if (d.currentVersion) updateVersion.value = d.currentVersion;
  updateMessage.value = d.message || '';
  updateStatusClass.value = d.stage === 'error'
    ? 'hf-error'
    : (d.stage === 'downloaded' || d.stage === 'available' ? 'hf-ok' : '');
}

function setUpdaterStatus(text: string, kind: string): void {
  updaterStatus.value = text || '';
  updaterStatusClass.value = kind;
}

async function onSaveUpdater(): Promise<void> {
  const res = await window.settingsTools.saveUpdater({
    feedUrl: feedUrl.value.trim(),
    autoCheck: autoCheck.value
  });
  setUpdaterStatus(res && res.ok ? '更新设置已保存（下次启动按新设置检查）' : ((res as { message?: string })?.message || '保存失败'), res && res.ok ? 'hf-ok' : 'hf-error');
}

async function onCheckUpdate(): Promise<void> {
  updateStage.value = 'checking';
  updateMessage.value = '正在检查更新…';
  updateStatusClass.value = '';
  const res = (await window.updateTools.check()) as UpdateCheckReply;
  if (!res || !res.ok) {
    updateStage.value = 'error';
    updateMessage.value = (res && res.message) || '检查更新失败';
    updateStatusClass.value = 'hf-error';
    return;
  }
  updateStage.value = res.state || 'none';
  if (res.currentVersion) updateVersion.value = res.currentVersion;
  updateMessage.value = res.state === 'available'
    ? ('发现新版本 ' + res.version + '，点「下载更新」获取安装包')
    : (res.state === 'skipped'
      ? ('版本 ' + res.version + ' 已跳过，如需安装请点「下载更新」')
      : ('当前已是最新版本（' + (res.currentVersion || updateVersion.value) + '）'));
  updateStatusClass.value = res.state === 'available' ? 'hf-ok' : '';
}

async function onDownloadUpdate(): Promise<void> {
  const res = await window.updateTools.download();
  if (!res || !res.ok) {
    updateStage.value = 'error';
    updateMessage.value = (res && res.message) || '下载失败';
    updateStatusClass.value = 'hf-error';
  }
}

async function onCancelUpdate(): Promise<void> {
  await window.updateTools.cancel();
}

async function onInstallUpdate(): Promise<void> {
  const res = await window.updateTools.install();
  // 成功时主进程会退出并运行安装器，这里只处理被拒绝的情况（如本机有转录 / 渲染任务在跑）
  if (!res || !res.ok) {
    updateMessage.value = (res && res.message) || '安装失败';
    updateStatusClass.value = 'hf-error';
  }
}

// 撤销「跳过该版本」：清掉 settings.json 里的 skippedVersion，让新版本重新提示
async function onSkipVersion(skip: boolean): Promise<void> {
  const res = await window.settingsTools.saveUpdater({ skippedVersion: skip ? updateVersion.value : '' });
  if (res && res.ok) {
    updateMessage.value = skip ? ('已跳过版本 ' + updateVersion.value) : ('已恢复提示版本 ' + updateVersion.value);
    updateStatusClass.value = '';
  }
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
  // 视频渲染默认档位（读取失败沿用内置默认 standard / 30）
  try {
    const s = await window.settingsTools.get();
    const r = (s && s.render) || FALLBACK_RENDER;
    if (RENDER_QUALITY_OPTIONS.some((o) => o.value === r.quality)) rQuality.value = r.quality;
    if (RENDER_FPS_OPTIONS.some((o) => o.value === r.fps)) rFps.value = r.fps;
  } catch (e) { /* ignore */ }

  // 应用更新：版本号走同步接口首屏即显示；订阅进度通道（单订阅，重复进本页只替换回调）
  try {
    updateVersion.value = window.updateTools.version() || '';
  } catch (e) {
    setStatus('读取版本号失败', 'hf-error');
  }
  window.updateTools.onProgress(applyUpdateProgress);
  if (!updateMessage.value) {
    updateMessage.value = updateStage.value === 'idle'
      ? '尚未检查更新'
      : (updateStatusClass.value === 'hf-error' ? '上次检查更新失败' : '');
  }
  try {
    const s = await window.settingsTools.get();
    const u = (s && s.updater) || {};
    feedUrl.value = u.feedUrl || '';
    autoCheck.value = u.autoCheck !== false;
  } catch (e) {
    setUpdaterStatus('读取更新设置失败', 'hf-error');
  }
});
</script>
