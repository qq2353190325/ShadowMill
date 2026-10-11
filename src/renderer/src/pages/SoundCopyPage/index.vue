<template>
  <div>
    <StepBar :page="'sound-copy'" />
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>音色管理 · 创建克隆音色</div>
      <div class="hgen-tip">选择目标模型并上传/粘贴人声音频，即可创建克隆音色。创建时选定的模型会绑定到该音色，后续用该音色合成时自动沿用同一模型（创建计费 0.01 元/个）：<br/>· Qwen-Audio-TTS（qwen-audio-3.0-tts-flash）：粘贴一段 10~20 秒清晰人声的<b>可公开访问音频 URL</b>（该模型克隆不接受本地文件直传）；<br/>· qwen3-tts-vc-* 系列：上传本地音频文件（.wav / .mp3 / .m4a，Base64 后需小于 10 MB）。</div>
      <div class="hgen-row">
        <label class="sel-label">显示名称</label>
        <input v-model="vcName" class="hgen-input" style="flex:1" placeholder="给音色起个名字，支持中文，如：旁白" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">目标模型</label>
        <select v-model="vcModel" class="hgen-select" style="flex:1" @change="applyInputMode(vcModel)">
          <option v-for="m in cloneModels" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>
      <div class="hgen-row" v-show="!urlMode">
        <button class="hf-btn" @click="onPick">选择音频文件</button>
        <span class="hf-file">{{ audioPath ? escTxt(audioPath) : '未选择文件' }}</span>
      </div>
      <div class="hgen-row" v-show="urlMode">
        <label class="sel-label">音频 URL</label>
        <input v-model="vcUrl" class="hgen-input" style="flex:1" placeholder="https://...（可公开访问的音频文件地址，如 .wav / .mp3 / .m4a）" />
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onCreate">创建音色</button>
        <button class="hf-btn" @click="goPage('settings')">API Key 设置</button>
      </div>
      <div class="hf-status" :class="statusClass">{{ status }}</div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>我的音色</div>
      <div class="hf-status" :class="listStatusClass">{{ listStatus }}</div>
      <div v-if="!voiceList.length" class="hgen-tip">暂无音色。可在上方「创建克隆音色」区创建，或到「配音」页使用内置系统音色。</div>
      <template v-else>
        <div style="display:grid;grid-template-columns:1.5fr 1.2fr 1fr;gap:8px 12px;font-size:12px;color:var(--text-secondary);padding:6px 2px;"><span>显示名称</span><span>音色 ID（合成模型）</span><span>创建时间 / 参数</span></div>
        <div v-for="it in voiceList" :key="it.key" style="display:grid;grid-template-columns:1.5fr 1.2fr 1fr;gap:8px 12px;align-items:center;padding:6px 2px;border-top:1px solid rgba(0,212,255,.08);word-break:break-all;">
          <span style="color:var(--color-primary)">{{ escTxt(it.name) }} <span style="color:var(--text-secondary)">[{{ it.type === 'system' ? '系统' : '克隆' }}]</span></span>
          <button class="hf-btn" style="padding:2px 8px;font-size:12px;justify-self:start" @click="editVoice(it.key)">{{ escTxt(it.voice) }}（{{ escTxt(it.targetModel) }}）</button>
          <span style="color:var(--text-secondary)">{{ escTxt(it.extra) }}</span>
        </div>
      </template>
      <div class="hgen-actions">
        <button class="hf-btn" @click="loadAll(false)">刷新音色列表</button>
      </div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>音色映射管理</div>
      <div class="hgen-tip">为任意音色（系统音色 / 克隆音色）设置本地中文显示名与合成模型。显示名与模型仅保存在本机 settings.json；系统音色不传中文名时使用默认描述，不选模型时使用该音色默认合成模型。</div>
      <div class="hgen-row">
        <label class="sel-label">音色</label>
        <select ref="mapVoiceEl" v-model="mapVoice" class="hgen-select" style="flex:1" @change="syncMapForm">
          <option v-for="o in mapOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="hgen-row">
        <label class="sel-label">显示名称</label>
        <input v-model="mapName" class="hgen-input" style="flex:1" placeholder="中文显示名，留空则使用默认（系统音色用内置描述，克隆音色用其 ID）" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">合成模型</label>
        <select v-model="mapModel" class="hgen-select" style="flex:1">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveMap">保存映射</button>
        <button class="hf-btn" @click="onClearMap">解除映射</button>
      </div>
      <div class="hf-status" :class="mapStatusClass">{{ mapStatus }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/SoundCopyPage/index.vue —— 音色管理页（原 JS 版 soundCopy 模块 {template,index}.js 移植）
// 状态缓存（models/sysVoices/cloudVoices/profiles）改为 ref；下拉由 v-for 响应式填充。
import { computed, onMounted, ref } from 'vue'
import { goPage } from '@renderer/pages'
import { toast } from '@renderer/composables/useToast'
import { escTxt } from '@renderer/utils/escape'
import StepBar from '@renderer/components/StepBar.vue'

// 克隆提交名称必须是 1~16 位 ASCII（数字/字母/下划线）；中文名仅保存为本地「显示名称」
const toAsciiName = (raw: string): string => String(raw || '').trim().replace(/[^A-Za-z0-9_]/g, '');
const genAsciiName = (raw: string): string => {
  let n = toAsciiName(raw);
  if (!n) n = 'myvoice' + Date.now().toString().slice(-8);
  if (n.length > 16) n = n.slice(0, 16);
  return n;
};

// ===== 状态缓存 =====
interface ModelView { id: string; label: string; role?: string; input?: string; isDefault?: boolean }
interface SysVoiceView { voice: string; desc: string; langs: string; series: string[]; model: string }
interface CloudVoiceView { voice: string; target_model?: string; gmt_create?: string }
interface ProfileView { key: string; name: string; voice: string; targetModel: string; type: string }

const models = ref<ModelView[]>([]);
const cloneModels = computed(() => models.value.filter((m) => m.role === 'clone'));
const sysVoices = ref<SysVoiceView[]>([]);
const cloudVoices = ref<CloudVoiceView[]>([]);
const profiles = ref<Record<string, ProfileView>>({});

// ===== 创建克隆音色 =====
const vcName = ref('');
const vcModel = ref('');
const vcUrl = ref('');
const audioPath = ref<string | null>(null);
const status = ref('');
const statusClass = ref('');
const listStatus = ref('');
const listStatusClass = ref('');
const mapStatus = ref('');
const mapStatusClass = ref('');

const urlMode = ref(false);
function applyInputMode(m: string): void {
  urlMode.value = /^qwen-audio-.*-tts/i.test(String(m || ''));
}
const getCfg = async (): Promise<{ ok: boolean; apiKey?: string; targetModel?: string } | null> => {
  try {
    const c = await window.voiceTools.getConfig();
    return c && c.ok ? c : null;
  } catch (e) { return null; }
};
const requireCfg = async (): Promise<{ ok: boolean; apiKey?: string; targetModel?: string } | null> => {
  const c = await getCfg();
  if (!c || !c.apiKey) {
    status.value = '尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写';
    statusClass.value = 'hf-error';
    goPage('settings');
    return null;
  }
  return c;
};

async function onPick(): Promise<void> {
  const c = await requireCfg(); if (!c) return;
  const p = await window.voiceTools.pickAudio();
  if (p) audioPath.value = p;
}

async function onCreate(): Promise<void> {
  const c = await requireCfg(); if (!c) return;
  const name = vcName.value.trim();
  if (!name) { status.value = '请填写显示名称'; statusClass.value = 'hf-error'; return; }
  const targetModel = vcModel.value;
  applyInputMode(targetModel);
  if (urlMode.value) {
    const u = vcUrl.value.trim();
    if (!u) { status.value = '请填写可公开访问的音频文件地址（URL）'; statusClass.value = 'hf-error'; return; }
    status.value = '正在使用音频 URL 创建音色（约几秒）…';
    statusClass.value = '';
    const res = await window.voiceTools.create(u, genAsciiName(name), targetModel);
    if (res && res.ok) {
      await window.voiceTools.saveProfile({ key: 'custom:' + res.voice, name: name, voice: res.voice, targetModel: targetModel, type: 'custom' });
      status.value = '音色创建成功，已绑定中文名「' + name + '」与模型「' + targetModel + '」' + (res.fallbackMode ? '（降级模式：' + escTxt(res.fallbackReason || '') + '）' : '');
      statusClass.value = 'hf-ok';
      loadAll(true);
    } else {
      status.value = (res as { message?: string })?.message || '创建失败';
      statusClass.value = 'hf-error';
    }
    return;
  }
  if (!audioPath.value) { status.value = '请先选择音频文件'; statusClass.value = 'hf-error'; return; }
  status.value = '正在上传音频并创建音色（约几秒）…';
  statusClass.value = '';
  const res = await window.voiceTools.create(audioPath.value, genAsciiName(name), targetModel);
  if (res && res.ok) {
    await window.voiceTools.saveProfile({ key: 'custom:' + res.voice, name: name, voice: res.voice, targetModel: targetModel, type: 'custom' });
    status.value = '音色创建成功，已绑定中文名「' + name + '」与模型「' + targetModel + '」' + (res.fallbackMode ? '（降级模式：' + escTxt(res.fallbackReason || '') + '）' : '');
    statusClass.value = 'hf-ok';
    loadAll(true);
  } else {
    status.value = (res as { message?: string })?.message || '创建失败';
    statusClass.value = 'hf-error';
  }
}

// ===== 我的音色列表（合并系统音色 + 克隆音色，带中文显示名） =====
const voiceList = computed(() => {
  const all: { key: string; name: string; voice: string; targetModel: string; type: string; extra: string }[] = [];
  sysVoices.value.forEach((v) => {
    const key = 'system:' + v.voice;
    const prof = profiles.value[key];
    all.push({
      key: key,
      name: (prof && prof.name) || v.desc,
      voice: v.voice,
      targetModel: (prof && prof.targetModel) || v.model || '',
      type: 'system',
      extra: '系统音色'
    });
  });
  cloudVoices.value.forEach((v) => {
    const key = 'custom:' + v.voice;
    const prof = profiles.value[key];
    all.push({
      key: key,
      name: (prof && prof.name) || v.voice,
      voice: v.voice,
      targetModel: (prof && prof.targetModel) || v.target_model || '',
      type: 'custom',
      extra: v.gmt_create || ''
    });
  });
  return all;
});

async function loadAll(silent: boolean): Promise<void> {
  if (!silent) { listStatus.value = '拉取音色与映射…'; listStatusClass.value = ''; }
  const [sysRes, cloudRes, profRes] = await Promise.all([
    window.voiceTools.listSystemVoices().catch(() => ({ ok: false } as any)),
    window.voiceTools.list().catch(() => ({ ok: false } as any)),
    window.voiceTools.getProfiles().catch(() => ({ ok: false } as any))
  ]);
  sysVoices.value = (sysRes && sysRes.ok && sysRes.voices) || [];
  cloudVoices.value = (cloudRes && cloudRes.ok && cloudRes.voices) || [];
  profiles.value = (profRes && profRes.ok && profRes.profiles) || {};
  if (mapOptions.value.length && !mapVoice.value) {
    mapVoice.value = mapOptions.value[0].value;
  }
  syncMapForm();
  listStatus.value = '系统音色 ' + sysVoices.value.length + ' 个 · 克隆音色 ' + cloudVoices.value.length + ' 个';
  listStatusClass.value = 'hf-ok';
}

// ===== 映射管理 =====
const mapVoiceEl = ref<HTMLSelectElement | null>(null);
const mapVoice = ref('');
const mapName = ref('');
const mapModel = ref('');

const mapOptions = computed(() => {
  const opts: { value: string; label: string; type: string; voice: string; model: string }[] = [];
  sysVoices.value.forEach((v) => {
    opts.push({ value: 'system:' + v.voice, label: '[系统] ' + v.desc + '（' + v.voice + '）', type: 'system', voice: v.voice, model: v.model || '' });
  });
  cloudVoices.value.forEach((v) => {
    opts.push({ value: 'custom:' + v.voice, label: '[克隆] ' + v.voice, type: 'custom', voice: v.voice, model: v.target_model || '' });
  });
  return opts;
});

function syncMapForm(): void {
  const key = mapVoice.value;
  const prof = profiles.value[key];
  const opt = mapOptions.value.find((o) => o.value === key);
  const defModel = opt ? opt.model : '';
  mapName.value = prof ? prof.name : '';
  mapModel.value = prof ? prof.targetModel : defModel;
}

function editVoice(key: string): void {
  mapVoice.value = key;
  syncMapForm();
  mapVoiceEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function onSaveMap(): Promise<void> {
  const key = mapVoice.value;
  if (!key) { mapStatus.value = '请先选择要管理的音色'; mapStatusClass.value = 'hf-error'; return; }
  const opt = mapOptions.value.find((o) => o.value === key);
  if (!opt) return;
  const voice = opt.voice;
  const type = opt.type === 'system' ? 'system' : 'custom';
  const targetModel = mapModel.value;
  const name = mapName.value.trim();
  const res = await window.voiceTools.saveProfile({ key: key, name: (name || undefined) as any, voice: voice, targetModel: targetModel, type: type });
  if (res && res.ok) {
    profiles.value = res.profiles || {};
    mapStatus.value = '映射已保存' + (name ? '：' + name : '');
    mapStatusClass.value = 'hf-ok';
  } else {
    mapStatus.value = (res as { message?: string })?.message || '保存失败';
    mapStatusClass.value = 'hf-error';
  }
}

async function onClearMap(): Promise<void> {
  const key = mapVoice.value;
  if (!key) { mapStatus.value = '请先选择要解除映射的音色'; mapStatusClass.value = 'hf-error'; return; }
  const res = await window.voiceTools.deleteProfile(key);
  if (res && res.ok) {
    profiles.value = res.profiles || {};
    mapStatus.value = '已解除该音色的本地映射（云端克隆音色本身未删除）';
    mapStatusClass.value = 'hf-ok';
  } else {
    mapStatus.value = (res as { message?: string })?.message || '解除失败';
    mapStatusClass.value = 'hf-error';
  }
}

onMounted(async () => {
  const [cc, mm] = await Promise.all([
    window.voiceTools.getConfig().catch(() => null),
    window.voiceTools.listModels().catch(() => ({ ok: false, models: [] } as any))
  ]);
  models.value = ((mm && mm.models) || []) as ModelView[];
  const cfg = cc && cc.ok ? cc : { targetModel: 'qwen-audio-3.0-tts-flash' };
  vcModel.value = cfg.targetModel || 'qwen-audio-3.0-tts-flash';
  mapModel.value = cfg.targetModel || '';
  applyInputMode(vcModel.value);
  loadAll(true);
});
</script>
