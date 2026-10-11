// pages/TextTtsPage/helpers.ts —— 文字生音频页共享工具（原 window.__tts 命名空间）
// requireCfg / cfgSaveDir / 音色下拉加载（listAll 优先，回退组装）/ 结果卡可见标记。
import { ref } from 'vue'
import { goPage } from '@renderer/pages'

export interface VoiceOption {
  voiceId: string
  label: string
  model: string
}
export interface VoiceOptionGroup {
  label: string
  options: VoiceOption[]
}

export const cfgSaveDir = ref('');
export const voiceGroups = ref<VoiceOptionGroup[]>([]);
export const modelTag = ref('qwen-audio-3.0-tts-flash');
export const ttsResultShown = ref(false);

export function setCfgSaveDir(v: string): void {
  cfgSaveDir.value = v;
}

export async function requireCfg(onError: (text: string, kind: string) => void): Promise<{ ok: boolean; apiKey?: string; targetModel?: string; saveDir?: string } | null> {
  const c = await window.voiceTools.getConfig().catch(() => null);
  if (!c || !c.ok || !c.apiKey) {
    onError('尚未配置千问语音 API Key，请先到「设置」-「千问语音」填写', 'hf-error');
    goPage('settings');
    return null;
  }
  modelTag.value = c.targetModel || 'qwen-audio-3.0-tts-flash';
  cfgSaveDir.value = String((c as { saveDir?: string }).saveDir || '').trim();
  return c;
}

// 原组装逻辑（voice:list-all 不可用时的回退路径：listSystemVoices + list 组装）
async function loadVoicesFallback(onStatus: (text: string, kind: string) => void): Promise<void> {
  onStatus('加载音色列表…', '');
  const sys = await window.voiceTools.listSystemVoices().catch(() => ({ ok: false, message: '调用失败' } as any));
  const res = await window.voiceTools.list().catch(() => ({ ok: false, message: '调用失败' } as any));
  const profRes = await window.voiceTools.getProfiles().catch(() => ({ ok: false } as any));
  const profiles = (profRes && profRes.ok && profRes.profiles) || {};
  const pName = (key: string, fallback: string) => { const p = profiles[key]; return (p && p.name) || fallback; };
  const pModel = (key: string, fallback: string) => { const p = profiles[key]; return (p && p.targetModel) || fallback; };

  const sysList = (sys && sys.ok && sys.voices) || [];
  const sysOpts: VoiceOption[] = sysList.map((v: any) => ({
    voiceId: v.voice,
    label: pName('system:' + v.voice, v.desc) + ' — ' + v.voice + '（' + pModel('system:' + v.voice, v.model || '') + '）',
    model: pModel('system:' + v.voice, v.model || '')
  }));
  const customOpts: VoiceOption[] = (res && res.ok && Array.isArray(res.voices))
    ? res.voices.map((v: any) => ({
      voiceId: v.voice,
      label: pName('custom:' + v.voice, v.voice) + '（' + pModel('custom:' + v.voice, v.target_model || '') + '）',
      model: pModel('custom:' + v.voice, v.target_model || '')
    }))
    : [];
  voiceGroups.value = [
    { label: '系统音色（内置）', options: sysOpts.length ? sysOpts : [{ voiceId: '', label: '（系统音色加载失败）', model: '' }] },
    { label: '自定义音色（我的克隆）', options: customOpts.length ? customOpts : [{ voiceId: '', label: (res && res.message) || '拉取自定义音色失败', model: '' }] }
  ];
  const parts: string[] = [];
  if (sysOpts.length) parts.push('系统音色 ' + sysOpts.length + ' 个');
  if (customOpts.length) parts.push('自定义音色 ' + customOpts.length + ' 个');
  onStatus(parts.length ? '已加载：' + parts.join('，') + '。选中音色将使用其绑定的模型合成。' : '音色列表为空', 'hf-ok');
}

// 统一音色下拉加载（主合成卡与对齐卡共用）：优先 voice:list-all（合并系统/克隆 + 已解析 model），失败或无数据回退原组装
export async function loadVoices(onStatus: (text: string, kind: string) => void): Promise<void> {
  onStatus('加载音色列表…', '');
  const all = await window.voiceTools.listAll().catch(() => ({ ok: false, message: '调用失败' } as any));
  const items = (all && all.ok && Array.isArray(all.voices)) ? all.voices : [];
  if (!items.length) {
    await loadVoicesFallback(onStatus);
    return;
  }
  const sysOpts: VoiceOption[] = [];
  const customOpts: VoiceOption[] = [];
  items.forEach((it: any) => {
    const o: VoiceOption = { voiceId: it.voiceId || '', label: '', model: it.model || '' };
    if (it.type === 'custom') {
      o.label = it.name + '（' + (it.model || '') + '）';
      customOpts.push(o);
    } else {
      o.label = it.name + ' — ' + it.voiceId + '（' + (it.model || '') + '）';
      sysOpts.push(o);
    }
  });
  voiceGroups.value = [
    { label: '系统音色（内置）', options: sysOpts },
    { label: '自定义音色（我的克隆）', options: customOpts }
  ].filter((g) => g.options.length);
  const parts: string[] = [];
  if (sysOpts.length) parts.push('系统音色 ' + sysOpts.length + ' 个');
  if (customOpts.length) parts.push('自定义音色 ' + customOpts.length + ' 个');
  onStatus(parts.length ? '已加载：' + parts.join('，') + '。选中音色将使用其绑定的模型合成。' : '音色列表为空', 'hf-ok');
}

// 选中音色绑定的模型（无绑定返回 ''，由调用方回落全局默认）
export function voiceModelOf(voiceId: string): string {
  for (const g of voiceGroups.value) {
    const o = g.options.find((x) => x.voiceId === voiceId);
    if (o) return o.model;
  }
  return '';
}

// 首个可选音色（加载完成后选中第一项，与原 sel.selectedIndex = 0 语义一致）
export function firstVoiceId(): string {
  for (const g of voiceGroups.value) {
    if (g.options.length && g.options[0].voiceId) return g.options[0].voiceId;
  }
  return '';
}
