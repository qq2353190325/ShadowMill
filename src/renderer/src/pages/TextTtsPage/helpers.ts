// pages/TextTtsPage/helpers.ts —— 文字生音频页共享工具（原 window.__tts 命名空间）
// requireCfg / cfgSaveDir / 音色下拉加载（listAll 优先，回退组装）/ 结果卡可见标记 / 「管理音色」Tab 信号。
import { ref } from 'vue'
// goPage 已不再直接调用：未配置 Key 时改为弹配置类弹窗（由用户在框里决定去不去设置页），
// 仍保留 useNavIntent 的「跳到某个设置分类」能力（useConfigPrompt 内部使用）。
import { useConfigPrompt } from '@renderer/composables/useConfigPrompt'

// 音色下拉的选项类型。字段名是 `value`（不是 `voiceId`）：全局下拉组件 HfSelect 只认 `value` / `label`，
// 因此这里的结构刻意与 `HfSelectOption` 对齐（结构兼容即可，无需再套一层 computed 转换）。
export interface VoiceOption {
  value: string
  label: string
  model: string
}
export interface VoiceOptionGroup {
  label: string
  options: VoiceOption[]
}

// 三张卡共用的「当前 Tab」：本页三个 Tab 是 v-show 切换的，组件不会重新挂载，
// 所以各卡 watch 它、在轮到自己显示时重拉一次自己的列表（否则在「音色管理」里新建的音色，
// 切回「文字生音频」时下拉里还是进页面时那份旧列表）。
export const activeTtsTab = ref<'synth' | 'align' | 'voice'>('synth');

export const cfgSaveDir = ref('');
export const voiceGroups = ref<VoiceOptionGroup[]>([]);
// 当前厂家的系统合成模型（= 厂家目录里的出厂默认，如 qwen3-tts-flash）：系统音色固定用它，
// 界面只把它当说明展示（「厂家默认模型」这个用户可改的设置已废弃）。
export const modelTag = ref('qwen3-tts-flash');
export const ttsResultShown = ref(false);

// ===== 当前厂家的 Key 是否就绪 =====
// 没填对应厂家的 Key 时，选了音色/模型也一定失败（合成与克隆都会以「未配置 …的 API Key」打回），
// 所以界面上直接禁用「音色 / 模型」下拉并说明原因，比让人选完再报错友好。
export const voiceKeyReady = ref(false);
export const activeProviderLabel = ref('');

// ===== 语音配置的唯一读取入口 =====
// 配置形状只有这一个地方知道：主进程回的是 `{ ok, active, providers, saveDir }`，
// 「当前厂家的 Key」= `providers[active].apiKey`。
// **别再在别处自己拼这个形状**——VoiceSection 里原来有一份拷贝还在读旧字段 `c.apiKey`
// （早已不存在 ⇒ 永远判成"未配置 Key" ⇒ 点「选择音频文件」就跳设置页），就是漏改的后果。
export interface ActiveVoiceCfg { ok: boolean; provider: string; apiKey: string; saveDir: string }
export async function readActiveCfg(): Promise<ActiveVoiceCfg | null> {
  const c = await window.voiceTools.getConfig().catch(() => null);
  if (!c || !c.ok) return null;
  const provider = String((c as { active?: string }).active || 'qwen');
  const cfg = (((c as { providers?: Record<string, { apiKey?: string }> }).providers) || {})[provider] || {};
  return {
    ok: true,
    provider,
    apiKey: String(cfg.apiKey || ''),
    saveDir: String((c as { saveDir?: string }).saveDir || '').trim()
  };
}

// 进页面时算一次：页面在 goPage 时强制重挂载，所以「去设置页存完 Key 再回来」会自动重算。
export async function refreshVoiceKeyState(): Promise<void> {
  const [c, mm] = await Promise.all([
    readActiveCfg(),
    window.voiceTools.listModels().catch(() => null)
  ]);
  const active = (c && c.provider) || '';
  const providers = ((mm as { providers?: { key: string; label: string; defaultModel?: string }[] } | null)?.providers) || [];
  const hit = providers.find((p) => p.key === active);
  activeProviderLabel.value = (hit && hit.label) || active || '';
  if (hit && hit.defaultModel) modelTag.value = hit.defaultModel;
  voiceKeyReady.value = !!(c && c.apiKey);
}

// 切 Tab 信号（voiceTabRequest / requestVoiceTab）已随合成卡片的「管理音色」按钮一起删除：
// 现在切「音色管理」Tab 只有本页 Tab 按钮一个入口，不需要跨组件信号。

export function setCfgSaveDir(v: string): void {
  cfgSaveDir.value = v;
}

// 语音配置按厂家存：`active` 是当前厂家，取该厂家的 API Key 与全局保存目录。
// 未配置 Key 时**弹配置类弹窗**（说明原因 + [去设置] / [取消]）而不是直接把用户从本页拽到设置页——
// 旧的 goPage('settings') 会让人「页面莫名其妙跳走了」。弹窗判定仍由渲染层给分类（这里是本地校验，
// 不是主进程错误），jump=true 保持「确认后就去设置」的旧效率。
export async function requireCfg(onError: (text: string, kind: string) => void): Promise<{ ok: boolean; apiKey?: string; saveDir?: string; provider?: string } | null> {
  const configPrompt = useConfigPrompt();
  const c = await readActiveCfg();
  if (!c) {
    voiceKeyReady.value = false;
    onError('读取语音配置失败，请到「设置」-「语音服务」检查', 'hf-error');
    configPrompt.open('读取语音配置失败，请到「设置 → 语音服务」检查', 'voice', true);
    return null;
  }
  if (!c.apiKey) {
    voiceKeyReady.value = false;
    if (!activeProviderLabel.value) activeProviderLabel.value = c.provider;
    onError('尚未配置「' + (activeProviderLabel.value || c.provider) + '」的语音 API Key，请先到「设置」-「语音服务」填写并保存', 'hf-error');
    configPrompt.open('尚未配置「' + (activeProviderLabel.value || c.provider) + '」的语音 API Key，请先到「设置 → 语音服务」填写并保存', 'voice', true);
    return null;
  }
  voiceKeyReady.value = true;
  cfgSaveDir.value = c.saveDir;
  return { ok: true, apiKey: c.apiKey, saveDir: cfgSaveDir.value, provider: c.provider };
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
    value: v.voice,
    label: pName('system:' + v.voice, v.desc) + ' — ' + v.voice + '（' + pModel('system:' + v.voice, v.model || '') + '）',
    model: pModel('system:' + v.voice, v.model || '')
  }));
  const customOpts: VoiceOption[] = (res && res.ok && Array.isArray(res.voices))
    ? res.voices.map((v: any) => ({
      value: v.voice,
      label: pName('custom:' + v.voice, v.voice) + '（' + pModel('custom:' + v.voice, v.target_model || '') + '）',
      model: pModel('custom:' + v.voice, v.target_model || '')
    }))
    : [];
  voiceGroups.value = [
    { label: '系统音色（内置）', options: sysOpts.length ? sysOpts : [{ value: '', label: '（系统音色加载失败）', model: '' }] },
    { label: '自定义音色（我的克隆）', options: customOpts.length ? customOpts : [{ value: '', label: (res && res.message) || '拉取自定义音色失败', model: '' }] }
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
    const o: VoiceOption = { value: it.voiceId || '', label: '', model: it.model || '' };
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
    const o = g.options.find((x) => x.value === voiceId);
    if (o) return o.model;
  }
  return '';
}

// 首个可选音色（加载完成后选中第一项，与原 sel.selectedIndex = 0 语义一致）
export function firstVoiceId(): string {
  for (const g of voiceGroups.value) {
    if (g.options.length && g.options[0].value) return g.options[0].value;
  }
  return '';
}
