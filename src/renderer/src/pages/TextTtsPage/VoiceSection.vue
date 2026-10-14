<template>
  <div>
    <div class="card hgen-panel">
      <div class="panel-head">
        <div class="panel-title"><span class="dot"></span>我的音色</div>
        <div class="panel-head-actions">
          <button class="hf-btn hf-btn-primary" @click="openCreate">创建克隆音色</button>
          <button class="hf-btn" :disabled="listBusy" @click="loadAll(false)">{{ listBusy ? '刷新中…' : '刷新音色列表' }}</button>
        </div>
      </div>
      <div class="hf-status" :class="listStatusClass">{{ listStatus }}</div>
      <div v-if="!voiceList.length" class="hgen-tip">暂无音色。可点右上「创建克隆音色」新建，或到「文字生音频」标签页使用内置系统音色。</div>
      <template v-else>
        <div class="voice-list">
          <div class="voice-list-head">
            <span>显示名称</span><span>合成模型</span><span>语种 / 创建时间</span><span></span>
          </div>
          <div class="voice-list-body">
            <div
              v-for="it in voiceList"
              :key="it.key"
              class="voice-list-row"
              :class="{ on: it.key === mapVoice }"
              title="点这一行 → 载入下方「音色映射管理」，可改显示名与绑定模型"
              @click="editVoice(it.key)"
            >
              <span class="voice-name">
                <span class="voice-name-text">{{ escTxt(it.name) }}</span>
                <b class="voice-tag" :class="it.type === 'system' ? 'sys' : 'clone'">{{ it.type === 'system' ? '系统' : '克隆' }}</b>
              </span>
              <span class="voice-model" :title="escTxt(it.targetModel)">{{ escTxt(it.targetModel) }}</span>
              <span class="voice-extra" :title="escTxt(it.extra)">{{ escTxt(it.extra) }}</span>
              <span class="voice-actions">
                <!-- 只有云端克隆音色能删（系统音色是内置的）；@click.stop 免得连带触发整行的"载入映射" -->
                <button
                  v-if="it.type === 'custom'"
                  class="hf-btn hf-btn-danger"
                  style="padding:2px 8px;font-size:12px"
                  title="从云端删除这个克隆音色（不可撤销）"
                  @click.stop="askDeleteCloud(it)"
                >删云端</button>
              </span>
            </div>
          </div>
        </div>
        <div class="hgen-tip">点任意一行会把它载入下方「音色映射管理」，可改中文显示名、换绑合成模型；显示名与绑定只存在本机 settings.json（不传云端）。</div>
      </template>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>音色映射管理</div>
      <div class="hgen-tip">为任意音色（系统音色 / 克隆音色）设置本地中文显示名；显示名与模型只保存在本机 settings.json。<b>系统音色与合成模型是固定绑定</b>（由厂家目录决定，不可改），所以系统音色这一行只能改名；克隆音色可以另外绑一个该厂家的模型。</div>
      <div class="hgen-row">
        <label class="sel-label">音色</label>
        <HfSelect ref="mapVoiceEl" v-model="mapVoice" :groups="mapGroups" @change="syncMapForm" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">显示名称</label>
        <input v-model="mapName" class="hgen-input" style="flex:1" placeholder="中文显示名，留空则使用默认（系统音色用内置描述，克隆音色用其 ID）" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">合成模型</label>
        <HfSelect v-model="mapModel" :groups="modelGroups" :disabled="mapIsSystem" :title="mapIsSystem ? '系统音色的合成模型由厂家目录固定，不可改（只能改显示名）' : ''" />
      </div>
      <div class="hgen-tip" v-if="mapIsSystem" style="margin-top:0">系统音色固定使用「{{ mapFixedModel }}」合成，无需也无法改绑；这里保存的只是中文显示名。</div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveMap">保存映射</button>
        <button class="hf-btn" @click="onClearMap">解除映射</button>
      </div>
      <div class="hf-status" :class="mapStatusClass">{{ mapStatus }}</div>
    </div>

    <!-- 创建克隆音色：弹窗。必须 Teleport 到 body —— .card 上有 backdrop-filter，
         它会让 fixed 定位相对卡片而不是视口（蒙层会被卡片裁住）。HfSelect 弹层 z-index 9500 > 蒙层 9000，仍是浮在上面的。 -->
    <Teleport to="body">
      <div v-if="createOpen" class="hf-modal-mask" @click.self="closeCreate">
        <div class="hf-modal" style="width:min(680px,94vw)">
          <div class="hf-modal-head">
            <span class="hf-modal-title">创建克隆音色</span>
            <button class="hf-modal-close" title="关闭" @click="closeCreate">×</button>
          </div>
          <div class="hf-modal-body">
            <div class="hgen-tip" style="margin-top:0">选目标模型并上传/粘贴人声音频即可创建克隆音色；创建时选定的模型会绑定到该音色，后续用该音色合成时沿用同一模型。<br/>· <b>qwen-audio-3.0-tts-flash</b>：<b>本地文件与公网 URL 都支持</b>——选本地文件会自动用 ffmpeg 截取前 15 秒、转 24kHz 单声道后直传（无需先传到公网）；也可以粘贴 <b>可公开访问的音频 URL</b>，两者都填时以 URL 为准。<br/>注意：参考音频需 <b>3~30 秒清晰人声</b>（推荐 10~20 秒）；音色创建后要过云端审核（列表里非「OK」会标注「审核中 / 审核未通过」），审核期间合成会失败。</div>
            <div class="hgen-row">
              <label class="sel-label">显示名称</label>
              <input v-model="vcName" class="hgen-input" style="flex:1" placeholder="给音色起个名字，支持中文，如：旁白" />
            </div>
            <div class="hgen-row">
              <label class="sel-label">目标模型</label>
              <HfSelect v-model="vcModel" :groups="cloneModelGroups" :disabled="!voiceKeyReady" :title="voiceKeyReady ? '' : '先在「设置」-「语音服务」填好该厂家的 API Key，才能选择模型'" @change="applyInputMode" />
            </div>
            <div class="hgen-tip" v-if="!voiceKeyReady" style="margin-top:0">还没配置「{{ activeProviderLabel || '当前厂家' }}」的 API Key：先在「设置 → 语音服务」填好并保存，才能创建克隆音色。</div>
            <div class="hgen-row">
              <button class="hf-btn" @click="onPick">选择音频文件</button>
              <span class="hf-file">{{ audioPath ? escTxt(audioPath) : '未选择文件' }}</span>
            </div>
            <div class="hgen-row" v-show="urlMode">
              <label class="sel-label">或音频 URL</label>
              <input v-model="vcUrl" class="hgen-input" style="flex:1" placeholder="可选：https://...（公网可访问的音频地址；填了就优先用它，留空则用上面的本地文件）" />
            </div>
            <div class="hf-status" :class="statusClass">{{ status }}</div>
          </div>
          <div class="hf-modal-foot">
            <button class="hf-btn" style="margin-right:auto" @click="goSettingsVoice">API Key 设置</button>
            <button class="hf-btn" @click="closeCreate">取消</button>
            <button class="hf-btn hf-btn-primary" :disabled="createBusy" @click="onCreate">{{ createBusy ? '创建中…' : '创建音色' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- 删除云端克隆音色：确认弹窗（不可撤销，所以必须点一下才动手） -->
    <Teleport to="body">
      <div v-if="deleteTarget" class="hf-modal-mask" @click.self="closeDeleteCloud">
        <div class="hf-modal" style="width:min(520px,92vw)">
          <div class="hf-modal-head">
            <span class="hf-modal-title">删除云端音色</span>
            <button class="hf-modal-close" title="关闭" @click="closeDeleteCloud">×</button>
          </div>
          <div class="hf-modal-body">
            <div class="hgen-tip" style="margin-top:0">将从云端（{{ activeProviderLabel || '当前厂家' }}）永久删除这个克隆音色，<b>不可撤销</b>；该音色的本地显示名与映射会一并清除（已在项目里生成的音频不受影响）。</div>
            <div class="hgen-row">
              <span class="sel-label" style="flex:none;width:auto">显示名称</span>
              <span class="hf-file" style="flex:1">{{ escTxt(deleteTarget.name) }}</span>
            </div>
            <div class="hgen-row" style="margin-bottom:0">
              <span class="sel-label" style="flex:none;width:auto">创建时间</span>
              <span class="hf-file" style="flex:1">{{ escTxt(deleteTarget.extra || '（未知）') }}</span>
            </div>
          </div>
          <div class="hf-modal-foot">
            <button class="hf-btn" @click="closeDeleteCloud">取消</button>
            <button class="hf-btn hf-btn-danger" :disabled="deleteBusy" @click="onDeleteCloud">{{ deleteBusy ? '删除中…' : '确认删除' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// pages/TextTtsPage/VoiceSection.vue —— 音色管理卡组（原「音色管理」独立页 SoundCopyPage/index.vue 并入配音页第三个 Tab）
// 状态缓存（models/sysVoices/cloudVoices/profiles）为 ref；下拉统一走全局 HfSelect。
import { computed, onMounted, ref, watch } from 'vue'
import { goPage } from '@renderer/pages'
import { toast } from '@renderer/composables/useToast'
import { useConfigPrompt } from '@renderer/composables/useConfigPrompt'
import { escTxt } from '@renderer/utils/escape'
import { requestSettingsSection } from '@renderer/composables/useNavIntent'
import { activeProviderLabel, activeTtsTab, readActiveCfg, refreshVoiceKeyState, voiceKeyReady } from './helpers'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'

// 复刻的 input.prefix 只允许数字/字母/下划线且不超过 10 个字符（与主进程 voice.ts 的 CLONE_PREFIX_MAX 一致）；
// 中文名仅保存为本地「显示名称」
const CLONE_PREFIX_MAX = 10;
const toAsciiName = (raw: string): string => String(raw || '').trim().replace(/[^A-Za-z0-9_]/g, '');
const genAsciiName = (raw: string, max = CLONE_PREFIX_MAX): string => {
  let n = toAsciiName(raw);
  if (!n) n = 'myvoice' + Date.now().toString().slice(-8);
  if (n.length > max) n = n.slice(0, max);
  return n;
};
// 云端音色状态转中文：创建后要过审核，非 OK 时必须在列表里说出来（否则「看得见音色、一合成就报错」很难排查）
const voiceStatusText = (s: string): string =>
  s === 'DEPLOYING' ? '审核中' : s === 'UNDEPLOYED' ? '审核未通过' : String(s || '');

// ===== 状态缓存 =====
interface ModelView { id: string; label: string; role?: string; input?: string; group?: string; isDefault?: boolean }
interface SysVoiceView { voice: string; desc: string; langs: string; series: string[]; model: string; provider?: string; providerLabel?: string }
interface CloudVoiceView { voice: string; voice_id?: string; target_model?: string; gmt_create?: string; status?: string }
interface ProfileView { key: string; name: string; voice: string; targetModel: string; type: string }
// 厂家目录（voice:list-models 回带）：模型与音色都挂在厂家下面，下拉按厂家分组
interface ProviderView { key: string; label: string; apiKeyHint: string; defaultModel: string; models: ModelView[]; voices?: SysVoiceView[] }

const providers = ref<ProviderView[]>([]);
const models = ref<ModelView[]>([]);           // 平铺全量（旧主进程 / 兜底用）
const sysVoices = ref<SysVoiceView[]>([]);
const cloudVoices = ref<CloudVoiceView[]>([]);
const profiles = ref<Record<string, ProfileView>>({});

// 下拉数据（HfSelect 的 groups 结构）：**按厂家分组**，同一厂家内部再按模型自带的 group 细分。
// 只有一个厂家时组名形如「千问（阿里云百炼）· 语音复刻（克隆音色合成）」；接第二家时天然分开。
function buildModelGroups(onlyClone: boolean): HfSelectGroup[] {
  const groups: HfSelectGroup[] = [];
  const push = (providerLabel: string, list: ModelView[]) => {
    const byGroup: Record<string, ModelView[]> = {};
    list.forEach((m) => { const g = m.group || '其它模型'; (byGroup[g] = byGroup[g] || []).push(m); });
    Object.keys(byGroup).forEach((g) => {
      groups.push({
        label: providerLabel ? providerLabel + ' · ' + g : g,
        options: byGroup[g].map((m) => ({ value: m.id, label: m.label }))
      });
    });
  };
  if (providers.value.length) {
    providers.value.forEach((p) => {
      const list = (p.models || []).filter((m) => !onlyClone || m.role === 'clone');
      if (list.length) push(p.label, list);
    });
    return groups;
  }
  // 兜底：拿不到厂家目录（旧主进程）时退回平铺
  const flat = models.value.filter((m) => !onlyClone || m.role === 'clone');
  if (flat.length) push('', flat);
  return groups;
}
const modelGroups = computed<HfSelectGroup[]>(() => buildModelGroups(false));
const cloneModelGroups = computed<HfSelectGroup[]>(() => buildModelGroups(true));

// ===== 创建克隆音色（弹窗）=====
const vcName = ref('');
const vcModel = ref('');
const vcUrl = ref('');
const audioPath = ref<string | null>(null);
const status = ref('');
const statusClass = ref('');
// 配置类错误弹窗（Key 无效 / 余额不足 / 未配置…）
const configPrompt = useConfigPrompt();
const listStatus = ref('');
const listStatusClass = ref('');
const listBusy = ref(false);
// 弹窗开关 + 创建中标记（创建计费 0.01 元/个，双击会建两个）
const createOpen = ref(false);
const createBusy = ref(false);

function openCreate(): void { createOpen.value = true; }
function closeCreate(): void { createOpen.value = false; }

// 「API Key 设置」：不只切页，还要让设置页落在「语音服务」分类（否则用户到了设置页还得自己找 Key 在哪）
function goSettingsVoice(): void {
  closeCreate();
  requestSettingsSection('voice');
  goPage('settings');
}
const mapStatus = ref('');
const mapStatusClass = ref('');

// 目标模型是否属于 Qwen-Audio-TTS 系列（这类模型除本地文件外**还**接受公网音频 URL，所以多显示一个 URL 输入框）
const urlMode = ref(false);
function applyInputMode(m: string): void {
  urlMode.value = /^qwen-audio-.*-tts/i.test(String(m || ''));
}
// 本卡的配置校验：复用 helpers 的 readActiveCfg（配置形状只在那一个地方解析），
// 失败时把提示写进弹窗状态行并跳到「设置」-「语音服务」（与弹窗里的「API Key 设置」同一路径）。
// 历史上这里有一份自己解析 `c.apiKey` 的拷贝，语音配置改成按厂家存之后没跟着改，
// 结果**永远**判成"未配置 Key"——点「选择音频文件」或「创建音色」都会直接跳走。
const requireCfg = async (): Promise<{ ok: boolean; apiKey: string } | null> => {
  const c = await readActiveCfg();
  if (!c || !c.apiKey) {
    status.value = '尚未配置' + (activeProviderLabel.value ? '「' + activeProviderLabel.value + '」的' : '') + '语音 API Key，请先到「设置」-「语音服务」填写';
    statusClass.value = 'hf-error';
    requestSettingsSection('voice');
    goPage('settings');
    return null;
  }
  return { ok: true, apiKey: c.apiKey };
};

async function onPick(): Promise<void> {
  const c = await requireCfg(); if (!c) return;
  const p = await window.voiceTools.pickAudio();
  if (p) audioPath.value = p;
}

async function onCreate(): Promise<void> {
  if (createBusy.value) return; // 防连点：创建计费 0.01 元/个，双击会建出两个音色
  createBusy.value = true;
  try {
    const c = await requireCfg(); if (!c) return;
    const name = vcName.value.trim();
    if (!name) { status.value = '请填写显示名称'; statusClass.value = 'hf-error'; return; }
    const targetModel = vcModel.value;
    applyInputMode(targetModel);
    // 音频来源：Qwen-Audio-TTS 系列「本地文件 / 公网 URL」二选一（填了 URL 就以 URL 为准），
    // 其余模型只认本地文件。主进程按这个字符串的形态（路径 / URL / data URI）自行分流。
    const remote = urlMode.value ? vcUrl.value.trim() : '';
    const source = remote || audioPath.value || '';
    if (!source) {
      status.value = urlMode.value ? '请先选择本地音频文件，或粘贴可公开访问的音频 URL' : '请先选择音频文件';
      statusClass.value = 'hf-error';
      return;
    }
    status.value = (remote ? '正在使用音频 URL 创建音色' : '正在处理本地音频并创建音色') + '（约几秒）…';
    statusClass.value = '';
    const res = await window.voiceTools.create(source, genAsciiName(name), targetModel);
    if (res && res.ok) {
      await window.voiceTools.saveProfile({ key: 'custom:' + res.voice, name: name, voice: res.voice, targetModel: targetModel, type: 'custom' });
      status.value = '音色创建成功，已绑定中文名「' + name + '」与模型「' + targetModel + '」';
      statusClass.value = 'hf-ok';
      loadAll(true);
      closeCreate(); // 建完收起弹窗：新音色已经出现在下面的列表里
    } else {
      // 配置类（Key 无效 / 未配置…）：弹「去设置」，状态行照旧显示原因
      configPrompt.fromResult(res);
      status.value = (res as { message?: string })?.message || '创建失败';
      statusClass.value = 'hf-error';
    }
  } finally {
    createBusy.value = false;
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
      // 系统音色的「系统/克隆」已由名字旁的徽标表达，这一列改放特色语种（更有信息量）
      extra: v.langs || '系统音色'
    });
  });
  cloudVoices.value.forEach((v) => {
    const key = 'custom:' + v.voice;
    const prof = profiles.value[key];
    all.push({
      key: key,
      // 列表不显示音色 ID：没起过名字的克隆音色用中文兜底（靠右侧「创建时间」列区分是哪一条）
      name: (prof && prof.name) || '未命名克隆音色',
      voice: v.voice,
      targetModel: (prof && prof.targetModel) || v.target_model || '',
      type: 'custom',
      // 主进程已把两系列列表接口的字段统一（voice / voice_id / target_model 都补齐）；
      // 审核状态非 OK 时（DEPLOYING / UNDEPLOYED）一并显示——音色建出来了但还不能用，得让人看出区别
      extra: (v.gmt_create || '') + (v.status && v.status !== 'OK' ? '（' + voiceStatusText(v.status) + '）' : '')
    });
  });
  return all;
});

async function loadAll(silent: boolean): Promise<void> {
  if (listBusy.value) return; // 刷新按钮防连点：并发两次会互相盖掉状态行
  listBusy.value = true;
  if (!silent) { listStatus.value = '拉取音色与映射…'; listStatusClass.value = ''; }
  try {
    const fail = (e: unknown): any => ({ ok: false, message: String((e && (e as { message?: string }).message) || '调用失败') });
    const [sysRes, cloudRes, profRes] = await Promise.all([
      window.voiceTools.listSystemVoices().catch(fail),
      window.voiceTools.list().catch(fail),
      window.voiceTools.getProfiles().catch(fail)
    ]);
    sysVoices.value = (sysRes && sysRes.ok && sysRes.voices) || [];
    cloudVoices.value = (cloudRes && cloudRes.ok && cloudRes.voices) || [];
    profiles.value = (profRes && profRes.ok && profRes.profiles) || {};
    if (mapOptions.value.length && !mapVoice.value) {
      mapVoice.value = mapOptions.value[0].value;
    }
    syncMapForm();
    // 拉取失败必须显式说出来。以前不分成败一律报「克隆音色 0 个」+ 绿灯，于是
    // 「云端这次没拉到」和「本地映射丢了」在界面上长得一模一样，用户只能得出「我创建的音色全没了」。
    const bad: string[] = [];
    if (!cloudRes || cloudRes.ok !== true) bad.push('克隆音色拉取失败（' + String((cloudRes as { message?: string } | undefined)?.message || '未知原因') + '）');
    if (!profRes || profRes.ok !== true) bad.push('本地音色映射读取失败（' + String((profRes as { message?: string } | undefined)?.message || '未知原因') + '）');
    if (bad.length) {
      listStatus.value = '系统音色 ' + sysVoices.value.length + ' 个 · ' + bad.join('；');
      listStatusClass.value = 'hf-error';
      return;
    }
    listStatus.value = '系统音色 ' + sysVoices.value.length + ' 个 · 克隆音色 ' + cloudVoices.value.length + ' 个';
    listStatusClass.value = 'hf-ok';
  } finally {
    listBusy.value = false;
  }
}

// ===== 映射管理 =====
const mapVoiceEl = ref<InstanceType<typeof HfSelect> | null>(null);
const mapVoice = ref('');
const mapName = ref('');
const mapModel = ref('');

const mapOptions = computed(() => {
  const opts: { value: string; label: string; type: string; voice: string; model: string }[] = [];
  sysVoices.value.forEach((v) => {
    // 标签只用中文描述（不露音色 ID）；重名的情况靠「系统音色」分组本身区分
    opts.push({ value: 'system:' + v.voice, label: v.desc, type: 'system', voice: v.voice, model: v.model || '' });
  });
  cloudVoices.value.forEach((v) => {
    const key = 'custom:' + v.voice;
    const prof = profiles.value[key];
    // 没起名字的克隆音色用「未命名克隆音色 · 创建时间」区分，不露 ID
    const when = String(v.gmt_create || '').slice(5, 16);
    const label = (prof && prof.name) || (when ? '未命名克隆音色 · ' + when : '未命名克隆音色');
    opts.push({ value: key, label: label, type: 'custom', voice: v.voice, model: v.target_model || '' });
  });
  return opts;
});

// 按「系统 / 克隆」分组展示（原为单个平铺列表，标签里带 [系统] / [克隆] 前缀）
const mapGroups = computed<HfSelectGroup[]>(() => {
  const system = mapOptions.value.filter((o) => o.type === 'system').map((o) => ({ value: o.value, label: o.label }));
  const custom = mapOptions.value.filter((o) => o.type === 'custom').map((o) => ({ value: o.value, label: o.label }));
  return [
    { label: '系统音色（内置）', options: system },
    { label: '自定义音色（我的克隆）', options: custom }
  ].filter((g) => g.options.length);
});

// 系统音色与模型是固定绑定：选中系统音色时，合成模型不可改，显示该音色固定的模型
const mapIsSystem = computed(() => mapVoice.value.indexOf('system:') === 0);
const mapFixedModel = computed(() => {
  const key = mapVoice.value;
  const hit = sysVoices.value.find((v) => 'system:' + v.voice === key);
  return hit ? hit.model : '';
});

function syncMapForm(): void {
  const key = mapVoice.value;
  const prof = profiles.value[key];
  const opt = mapOptions.value.find((o) => o.value === key);
  const defModel = opt ? opt.model : '';
  mapName.value = prof ? prof.name : '';
  // 系统音色：模型固定（厂家目录），忽略本地映射里可能残留的旧绑定；克隆音色：仍按映射/默认
  mapModel.value = key.indexOf('system:') === 0 ? defModel : (prof ? prof.targetModel : defModel);
}

function editVoice(key: string): void {
  mapVoice.value = key;
  syncMapForm();
  // HfSelect 是单根元素组件：模板 ref 拿到组件实例，$el 即根 DOM，可滚到视口中央
  const el = (mapVoiceEl.value as unknown as { $el?: HTMLElement } | null)?.$el;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

// ===== 删除云端克隆音色（不可撤销；先弹确认）=====
interface DeleteTarget { key: string; name: string; voice: string; extra: string }
const deleteTarget = ref<DeleteTarget | null>(null);
const deleteBusy = ref(false);

function askDeleteCloud(it: { key: string; name: string; voice: string; extra: string }): void {
  deleteTarget.value = { key: it.key, name: it.name, voice: it.voice, extra: it.extra };
}
function closeDeleteCloud(): void {
  if (deleteBusy.value) return; // 删除中不让关，免得看不到结果
  deleteTarget.value = null;
}
async function onDeleteCloud(): Promise<void> {
  const t = deleteTarget.value;
  if (!t) return;
  deleteBusy.value = true;
  try {
    const res = await window.voiceTools.deleteCloudVoice(t.voice);
    if (res && res.ok) {
      profiles.value = (res.profiles || {}) as Record<string, ProfileView>;
      // 删掉的正好是映射卡里选中的那个 ⇒ 先清空，交给 loadAll 重新落到首项
      if (mapVoice.value === t.key) mapVoice.value = '';
      deleteTarget.value = null;
      toast('已删除云端音色「' + t.name + '」');
      await loadAll(true);
    } else {
      deleteTarget.value = null;
      configPrompt.fromResult(res);
      listStatus.value = (res as { message?: string })?.message || '删除失败';
      listStatusClass.value = 'hf-error';
    }
  } finally {
    deleteBusy.value = false;
  }
}

onMounted(async () => {
  // 先算「当前厂家 Key 是否就绪」：没就绪时克隆弹窗里的模型下拉禁用并给出提示
  void refreshVoiceKeyState();
  const [cc, mm] = await Promise.all([
    window.voiceTools.getConfig().catch(() => null),
    window.voiceTools.listModels().catch(() => ({ ok: false, models: [], providers: [] } as any))
  ]);
  providers.value = ((mm && mm.providers) || []) as ProviderView[];
  models.value = ((mm && mm.models) || []) as ModelView[];
  // 默认目标模型 = 当前厂家目录里的**克隆模型**（没有全局「默认模型」了；系统音色由目录固定绑定）
  const active = String((cc as { active?: string } | null)?.active || '') || (providers.value[0] && providers.value[0].key) || '';
  const vendor = providers.value.find((p) => p.key === active) || providers.value[0] || null;
  const cloneModel = ((vendor && vendor.models) || []).find((m) => m.role === 'clone');
  const defModel = (cloneModel && cloneModel.id) || (vendor && vendor.defaultModel) || 'qwen3-tts-flash';
  vcModel.value = defModel;
  mapModel.value = defModel;
  applyInputMode(vcModel.value);
  loadAll(true);
});

// 切回本 Tab 时重拉（理由同另两张卡：v-show 切换不重新挂载；
// 本卡的列表 = 系统音色 + 云端克隆音色 + 本地映射，用户在别处改过就要重算）
watch(activeTtsTab, (t) => {
  if (t !== 'voice') return;
  void refreshVoiceKeyState();
  void loadAll(true);
});
</script>
