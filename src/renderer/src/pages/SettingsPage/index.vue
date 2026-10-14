<template>
  <div class="settings-layout">
    <!-- 设置分类导航：5 类平级，右侧只渲染当前分类（下方区块用 v-if，未选中的不挂载） -->
    <nav class="settings-nav">
      <button type="button" class="settings-nav-item" :class="{ active: activeSection === 'model' }" @click="activeSection = 'model'">模型配置</button>
      <button type="button" class="settings-nav-item" :class="{ active: activeSection === 'voice' }" @click="activeSection = 'voice'">语音服务</button>
      <button type="button" class="settings-nav-item" :class="{ active: activeSection === 'render' }" @click="activeSection = 'render'">渲染档位</button>
    
      <button type="button" class="settings-nav-item" :class="{ active: activeSection === 'whisper' }" @click="activeSection = 'whisper'">语音识别模型</button>
        <button type="button" class="settings-nav-item" :class="{ active: activeSection === 'update' }" @click="activeSection = 'update'">
        应用更新<span v-if="updateStage === 'available'" class="settings-nav-dot"></span>
      </button>
    </nav>

    <div class="settings-content">
      <div v-if="activeSection === 'model'" class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>自定义模型</div>
      <div class="hgen-tip">配置「HTML 生成 / 修改」使用的模型服务。只支持 OpenAI 格式的端点，Anthropic 格式暂不支持。Base URL 与模型 ID 可从常见服务商直接选，也可手填自己的服务地址；填好 API Key 并勾选「启用」后，HTML 生成页就用这个模型工作。API Key 只保存在本电脑。</div>
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
        <label class="sel-label">启用</label>
        <label class="hgen-check"><input v-model="enabled" type="checkbox" /> 使用自定义模型生成 / 修改 HTML</label>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSave">保存配置</button>
        <button class="hf-btn" @click="onTest">测试连接</button>
      </div>
      <div class="hf-status" :class="statusClass">{{ status }}</div>
    </div>
    <div v-if="activeSection === 'voice'" class="card hgen-panel">
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
    <div v-if="activeSection === 'render'" class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>视频渲染默认档位</div>
      <div class="hgen-tip">「HTML生成」页点「转视频」时的默认档位，普通使用只需在这两项中选择。单个项目可在「HTML生成」页的「渲染档位」单独覆盖（项目覆盖优先于这里的默认）。质量 draft 编码最快但文字边缘可能有压缩痕迹，仅用于快速确认内容；降低帧率不会缩短成片时长，只是采样更稀、渲染更快。</div>
      <div class="hgen-row">
        <label class="sel-label">质量</label>
        <HfSelect v-model="rQuality" :groups="qualityGroups" />
      </div>
      <div class="hgen-row">
        <label class="sel-label">帧率</label>
        <HfSelect v-model="rFps" :groups="fpsGroups" />
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" @click="onSaveRender">保存渲染默认档位</button>
      </div>
      <div class="hf-status" :class="rStatusClass">{{ rStatus }}</div>
      <div class="hgen-tip" style="margin-top:8px">{{ qualityHint }}</div>
    </div>
    <div v-if="activeSection === 'whisper'" class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>语音识别模型（whisper.cpp 字幕转录）</div>
      <div class="hgen-tip">供字幕页「从音频生成字幕」在本机离线识别使用（不消耗 API 额度）。模型按「id ↔ 文件名」一一枚举登记：只识别登记在枚举内的文件名，枚举外的文件视为未知模型。模型文件不随应用打包，首次使用需在此下载（下载源为 HuggingFace 国内镜像 hf-mirror.com，规避 GitHub 直链超时）。点「设为当前使用」后，字幕转录弹窗即使用该档位；其他 ggml 模型可用「添加自定义模型」起名登记。</div>
      <WhisperSection />
    </div>
    <div v-if="activeSection === 'update'" class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>应用更新</div>
      <div class="hgen-row">
        <label class="sel-label">当前版本</label>
        <span class="hf-file" style="flex:1">{{ updateVersion || '—' }}</span>
      </div>
      <div class="hgen-actions">
        <button class="hf-btn hf-btn-primary" :disabled="updateBusy" @click="onCheckUpdate">检查更新</button>
        <button class="hf-btn" @click="openFeedDialog">自定义更新源</button>
        <button v-if="updateStage === 'available' || updateStage === 'skipped'" class="hf-btn" @click="onDownloadUpdate">下载更新</button>
        <button v-if="updateStage === 'downloading'" class="hf-btn" @click="onCancelUpdate">取消下载</button>
        <button v-if="updateStage === 'downloaded'" class="hf-btn hf-btn-primary" @click="onInstallUpdate">立即重启安装</button>
      </div>
      <div class="hf-status" :class="updateStatusClass">{{ updateMessage }}</div>
      <!-- 排障出口：latest.yml / 存储桶 / HTTP 状态这类信息只在「详情」里展开，用户文案本身保持人话。
           入口**平时不出现**——没出错时把用户送进日志目录，他看到的是自己读不懂的文件，
           只会以为哪里坏了；只在更新出错（检查 / 下载 / 安装失败）时才露出来。
           启动静默检查的失败同样能显示：那次失败发生在设置页订阅进度之前，
           本页挂载时用 updateTools.status() 找主进程要一次当前状态（见 onMounted） -->
      <div v-if="updateDetail || updateLogVisible" class="hgen-actions" style="margin-top:0">
        <button v-if="updateDetail" class="hf-btn" @click="showUpdateDetail = !showUpdateDetail">{{ showUpdateDetail ? '收起详情' : '查看详情' }}</button>
        <button v-if="updateLogVisible" class="hf-btn" @click="onOpenUpdateLog">打开日志目录</button>
      </div>
      <div v-if="updateDetail && showUpdateDetail" class="hf-detail">{{ updateDetail }}</div>
      <!-- 运行环境（分包）：ffmpeg / hyperframes 不随安装包，用到时下载（whisper 随包，无需下载）。
           只在「下载中 / 缺包 / 失败」时占一行；就绪是常态，不显示（外壳顶部横幅同此口径） -->
      <div v-if="runtimeBusy || runtimeFailed || runtimeHasMissing" class="hf-status" :class="runtimeStatusClass">{{ runtimeStatusText }}</div>
      <div v-if="runtimeFailed || runtimeHasMissing" class="hgen-actions" style="margin-top:0">
        <button class="hf-btn hf-btn-primary" :disabled="runtimeBusy" @click="onPrepareRuntime">
          {{ runtimeHasMissing ? '下载运行环境' : '重试' }}
        </button>
        <button v-if="runtimeCancellable" class="hf-btn" @click="cancelRuntime">取消下载</button>
        <button v-if="runtimeMissing.length" class="hf-btn" @click="onPickLocalPack">从本地文件安装…</button>
      </div>
      <div v-if="runtimeNotice" class="hf-detail">{{ runtimeNotice }}</div>
      <!-- 保存 / 重置的反馈独立成行：与检查更新共行会被随后的进度文案盖掉，看起来像「没保存」-->
      <div v-if="updaterStatus" class="hf-status" :class="updaterStatusClass">{{ updaterStatus }}</div>
      <div v-if="updateStage === 'available'" class="hgen-actions" style="margin-top:8px">
        <button class="hf-btn" @click="onSkipVersion(true)">跳过版本 {{ updateNewVersion }}</button>
      </div>
      <div v-else-if="updateStage === 'skipped'" class="hgen-actions" style="margin-top:8px">
        <button class="hf-btn" @click="onSkipVersion(false)">恢复提示版本 {{ updateNewVersion }}</button>
      </div>
    </div>

    <!-- 自定义更新源弹窗：保存 / 重置均即时落盘（settings.json 的 updater 段）-->
    <div class="hf-modal-mask" v-show="feedDialogVisible" @click.self="closeFeedDialog">
      <div class="hf-modal" style="width:min(520px,92vw)">
        <div class="hf-modal-head">
          <span class="hf-modal-title">自定义更新源</span>
          <button class="hf-modal-close" title="关闭" @click="closeFeedDialog">×</button>
        </div>
        <div class="hf-modal-body">
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:56px">更新源</label>
            <input v-model="feedDraft" class="hgen-input" style="flex:1" placeholder="如 https://my-bucket.oss-cn-beijing.aliyuncs.com/shadowmill/" />
          </div>
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:56px">启动检查</label>
            <label class="hgen-check"><input v-model="autoCheckDraft" type="checkbox" /> 启动后静默检查一次更新</label>
          </div>
          <div class="hgen-tip" style="margin-bottom:0">留空即重置为应用内置的更新地址。地址需指向存放 <b>latest.yml</b> 的目录，并以 <b>/</b> 结尾。</div>
        </div>
        <div class="hf-modal-foot">
          <button class="hf-btn" @click="onResetFeed">重置</button>
          <button class="hf-btn" @click="closeFeedDialog">取消</button>
          <button class="hf-btn hf-btn-primary" @click="onSaveFeed">保存</button>
        </div>
      </div>
    </div>
    </div><!-- /settings-content -->
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/index.vue —— 设置页（原 JS 版 settings 模块 {template,index}.js 移植）
// 自定义模型 + 语音服务（按厂家）+ 视频渲染默认档位；语音识别模型区块为子组件 WhisperSection（原 window.__settings.initWhisper）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RenderFps, RenderQuality, UpdateProgressPayload, UpdateStage } from '@shared/types'
import { MODEL_PROVIDERS, STORAGE_KEY_SETTINGS_SECTION } from '@renderer/constants'
import {
  consumeSettingsSection,
  useSettingsSectionRequest,
  SETTINGS_SECTIONS,
  type SettingsSectionKey
} from '@renderer/composables/useNavIntent'
import {
  FALLBACK_RENDER,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITY_OPTIONS,
  renderQualityLabel
} from '@renderer/utils/render'
import { saveRenderDefaults } from '@renderer/composables/useRenderOptions'
import { useRuntime } from '@renderer/composables/useRuntime'
import HfSelect, { type HfSelectGroup } from '@renderer/components/HfSelect.vue'
import WhisperSection from './WhisperSection.vue'

// ===== 自定义模型（OpenAI 兼容） =====
const baseUrl = ref('');
const modelId = ref('');
const apiKey = ref('');
const enabled = ref(false);
const status = ref('');
const statusClass = ref('');

// Base URL / 模型 ID 的下拉预设（表在 @renderer/constants 的 MODEL_PROVIDERS）。
// 「自定义」是个哨兵值：选中它只切到手填输入框、**不动当前值**（常见诉求是"在现有地址上改一改"）。
// 这里刻意用 :model-value + @change 而不是 v-model —— 用 v-model 时哨兵值会先写进 baseUrl，
// 用户接着点「保存配置」就会把 '__custom__' 存进 settings.json。
const CUSTOM_VALUE = '__custom__';
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

// ===== 设置分类（左侧导航 → 右侧内容）=====
// 5 类平级：模型配置 / 语音服务 / 渲染档位 / 应用更新 / 语音识别模型。
// 枚举与「跨页导航意图」共用同一份（composables/useNavIntent.ts），避免两处漂移。
// 选择记忆在 localStorage（键名见 @renderer/constants 的 STORAGE_KEY_SETTINGS_SECTION），下次进设置页回到上次的分类。
type SettingsSection = SettingsSectionKey;
const SETTINGS_SECTION_KEY = STORAGE_KEY_SETTINGS_SECTION;
const SECTIONS = SETTINGS_SECTIONS;
function readSection(): SettingsSection {
  try {
    const v = localStorage.getItem(SETTINGS_SECTION_KEY) as SettingsSection | null;
    return v && SECTIONS.indexOf(v) >= 0 ? v : 'model';
  } catch (e) {
    return 'model';
  }
}
const activeSection = ref<SettingsSection>(readSection());
watch(activeSection, (v) => {
  try {
    localStorage.setItem(SETTINGS_SECTION_KEY, v);
  } catch (e) { /* 隐私模式等场景静默忽略 */ }
});

// 别的页面点「API Key 设置」之类会带着「落到语音服务」的意图跳进来：先消费意图，
// 优先级高于 localStorage 里的上次分类（用户这次点的是"去配语音"，不是"回到上次看的那一页"）。
function applySectionIntent(): void {
  const want = consumeSettingsSection();
  if (want && SECTIONS.indexOf(want) >= 0 && want !== activeSection.value) activeSection.value = want;
}
// 兜底：本页已在挂载状态时（不经 goPage 重挂载）也能响应
watch(useSettingsSectionRequest(), () => applySectionIntent());

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

// ===== 语音服务（按厂家）=====
// 数据来自 voice:list-models 回带的 providers（厂家目录：label / Key 提示 / 出厂默认模型 / 模型 / 音色），
// 配置来自 voice:get-config（active + 各厂家已保存的 apiKey）。
// **这里只有 API Key**：模型与音色的对应关系是固定的（写在厂家目录里），没有「厂家默认模型」这种全局设置。
interface VoiceModelView { id: string; label: string; role?: string; input?: string; group?: string; isDefault?: boolean }
interface VoiceProviderView { key: string; label: string; apiKeyHint: string; defaultModel: string; models: VoiceModelView[] }
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

// ===== 视频渲染默认档位（全局默认；项目级覆盖在「HTML生成」页的「渲染档位」单独设置）=====
// 普通用户只有两项：质量（draft / standard / high）与帧率（24 / 30）。
const qualityOptions = RENDER_QUALITY_OPTIONS;
const fpsOptions = RENDER_FPS_OPTIONS;
// HfSelect 选项（原为 <option v-for>）
const qualityGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: qualityOptions.map((o) => ({ value: o.value, label: o.label })) }]);
const fpsGroups = computed<HfSelectGroup[]>(() => [{ label: '', options: fpsOptions.map((o) => ({ value: o.value, label: o.label })) }]);
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
// **文案不在这一层拼**：available / skipped / none / error 的句子统一由主进程 updater.ts 产出
// （早前渲染层也拼一套，与事件推送的文案互相覆盖，同一状态两句话在打架）。这里只渲染 message，
// 并把 detail（排障详情）收进可折叠的「查看详情」。
interface UpdateCheckReply {
  ok: boolean
  state?: 'none' | 'available' | 'skipped'
  version?: string
  currentVersion?: string
  message?: string
  detail?: string
}

const updateVersion = ref('');
// 待安装的目标版本（payload/回执里的 version）：只给「跳过版本 / 恢复提示版本」用，
// 与「当前版本」（updateVersion）严格分开——见 applyUpdateProgress 的注释
const updateNewVersion = ref('');
const updateStage = ref<UpdateStage>('idle');
const updateMessage = ref('');
const updateStatusClass = ref('');
// 排障详情（HTTP 状态 / AccessDenied 原文等）+ 其折叠开关；仅在出错时出现
const updateDetail = ref('');
const showUpdateDetail = ref(false);
// 「打开日志目录」只在更新确实出错时才出现：平时把用户送进日志目录没有意义（他也看不懂），
// 出错时它是拿到原始报错的唯一出口（人话文案在 message，原始报错在 detail / updater.log）
const updateLogVisible = computed(() => updateStage.value === 'error' || updateStatusClass.value === 'hf-error');
// 有网络动作在跑时禁用重复点击（检查中的重复点击是最常见的误操作）
const updateBusy = computed(() => updateStage.value === 'checking' || updateStage.value === 'downloading');
// 已保存的更新设置（回填自 settings.json，也是卡片文案的来源）
const feedUrl = ref('');
const autoCheck = ref(true);
const updaterStatus = ref('');
const updaterStatusClass = ref('');
// 自定义更新源弹窗：draft 为编辑中的副本，只有点「保存」才落盘，取消不影响已存值
const feedDialogVisible = ref(false);
const feedDraft = ref('');
const autoCheckDraft = ref(true);

// ===== 运行环境（分包 ffmpeg / hyperframes；whisper 随安装包）=====
// 模块级单例，外壳横幅与本页读同一份（见 composables/useRuntime.ts、docs/runtime-pack-split.md）
const {
  runtime: runtimeState, busy: runtimeBusy, failed: runtimeFailed, hasMissing: runtimeHasMissing,
  cancelable: runtimeCancellable, missing: runtimeMissing, missingText: runtimeMissingText,
  prepare: prepareRuntime, cancel: cancelRuntime
} = useRuntime();
// 状态行：下载中 / 解包中 / 缺包 / 失败 各一句人话；就绪是常态，不显示（免占位）
const runtimeStatusText = computed(() => {
  if (runtimeBusy.value) return runtimeState.value.message || '正在准备运行环境…';
  if (runtimeFailed.value) return runtimeState.value.message || '运行环境准备失败';
  if (runtimeHasMissing.value) return '运行环境需要下载：' + runtimeMissingText.value;
  return '';
});
const runtimeStatusClass = computed(() => (runtimeFailed.value ? 'hf-error' : ''));
// 「从本地文件安装」的即时反馈（导入成功 / 失败），与主进程推来的状态分开显示
const runtimeNotice = ref('');
function setRuntimeNotice(msg: string): void { runtimeNotice.value = msg; }

async function onPrepareRuntime(): Promise<void> {
  await prepareRuntime();
}

// 「从本地文件安装…」：选一个 <pack>.7z 导入（离线 / 内网机器访问不到更新源时的兜底），
// 导入成功后立刻走同一条解包路径。只在缺包 / 失败时这个按钮才出现（见模板）。
async function onPickLocalPack(): Promise<void> {
  try {
    const r = await window.settingsTools.pickRuntimePack();
    if (!r || !r.ok) {
      if (!(r && (r as { canceled?: boolean }).canceled)) setRuntimeNotice((r && r.message) || '导入失败');
      return;
    }
    setRuntimeNotice((r.message as string) || '已导入本地运行环境包，正在解包…');
    await prepareRuntime();
  } catch (e) {
    setRuntimeNotice('导入失败：' + ((e as Error).message || String(e)));
  }
}

function openFeedDialog(): void {
  feedDraft.value = feedUrl.value;
  autoCheckDraft.value = autoCheck.value;
  feedDialogVisible.value = true;
}

function closeFeedDialog(): void {
  feedDialogVisible.value = false;
}

// 弹窗 ESC 关闭（与 TranscribeSection 的成对注册惯例一致）
function onFeedDialogKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && feedDialogVisible.value) closeFeedDialog();
}

function applyUpdateProgress(d: UpdateProgressPayload): void {
  if (!d) return;
  updateStage.value = d.stage;
  if (d.currentVersion) updateVersion.value = d.currentVersion;
  // 目标版本（payload.version = 待安装的那个版本）：与「当前版本」必须分开存——
  // 「跳过版本 x / 恢复提示版本 x」用的是它，以前误用 updateVersion（当前版本）会把当前版本写进
  // settings.json 的 skippedVersion，而主进程比的是目标版本，于是「跳过」永远不生效
  updateNewVersion.value = d.version || '';
  updateMessage.value = d.message || '';
  updateDetail.value = d.detail || '';
  // 离开 error 态就收起详情面板，避免旧报错一直挂在卡片上
  if (!updateDetail.value) showUpdateDetail.value = false;
  updateStatusClass.value = d.stage === 'error'
    ? 'hf-error'
    : (d.stage === 'downloaded' || d.stage === 'available' ? 'hf-ok' : '');
}

function setUpdaterStatus(text: string, kind: string): void {
  updaterStatus.value = text || '';
  updaterStatusClass.value = kind;
}

// 保存更新源：写入 settings.json 的 updater 段后关闭弹窗（反馈留在卡片的状态行上）
async function onSaveFeed(): Promise<void> {
  try {
    const res = await window.settingsTools.saveUpdater({
      feedUrl: feedDraft.value.trim(),
      autoCheck: autoCheckDraft.value
    });
    if (res && res.ok) {
      feedUrl.value = feedDraft.value.trim();
      autoCheck.value = autoCheckDraft.value;
      const s = (res as { settings?: { updater?: { feedUrl?: string } } }).settings;
      if (s && s.updater && typeof s.updater.feedUrl === 'string') feedUrl.value = s.updater.feedUrl;
      setUpdaterStatus('更新源已保存', 'hf-ok');
      feedDialogVisible.value = false;
    } else {
      setUpdaterStatus((res as { message?: string })?.message || '保存失败', 'hf-error');
    }
  } catch (e) {
    setUpdaterStatus('保存失败：' + ((e as Error)?.message || String(e)), 'hf-error');
  }
}

// 重置：清空更新源回到「内置地址」，同时清掉跳过的版本，让所有版本重新可提示
async function onResetFeed(): Promise<void> {
  try {
    const res = await window.settingsTools.saveUpdater({ feedUrl: '', skippedVersion: '' });
    if (res && res.ok) {
      feedUrl.value = '';
      feedDraft.value = '';
      setUpdaterStatus('已重置为内置更新源', 'hf-ok');
    } else {
      setUpdaterStatus((res as { message?: string })?.message || '重置失败', 'hf-error');
    }
  } catch (e) {
    setUpdaterStatus('重置失败：' + ((e as Error)?.message || String(e)), 'hf-error');
  }
}

// 更新动作的统一异常兜底：IPC 一旦 reject（handler 抛错、频道未注册等），
// 不加 try/catch 就会让界面「点了没反应」——必须落到状态行上。
// 人话进 updateMessage，原始异常进 updateDetail（可折叠 / 可交给提供者）
function handleUpdateError(what: string, e: unknown): void {
  const detail = (e as Error)?.message || String(e);
  if (what === '安装') {
    updateMessage.value = '启动安装程序失败，请重新下载安装包后手动安装';
    updateStatusClass.value = 'hf-error';
  } else {
    updateStage.value = 'error';
    updateMessage.value = what + '失败，请稍后重试';
    updateStatusClass.value = 'hf-error';
  }
  updateDetail.value = detail;
}

async function onCheckUpdate(): Promise<void> {
  updateStage.value = 'checking';
  updateMessage.value = '正在检查更新…';
  updateDetail.value = '';
  showUpdateDetail.value = false;
  updateStatusClass.value = '';
  let res: UpdateCheckReply;
  try {
    res = (await window.updateTools.check()) as UpdateCheckReply;
  } catch (e) {
    handleUpdateError('检查更新', e);
    return;
  }
  if (!res || !res.ok) {
    updateStage.value = 'error';
    updateMessage.value = (res && res.message) || '检查更新失败，请稍后重试';
    updateDetail.value = (res && res.detail) || '';
    updateStatusClass.value = 'hf-error';
    return;
  }
  updateStage.value = res.state || 'none';
  if (res.currentVersion) updateVersion.value = res.currentVersion;
  // 目标版本同样以 IPC 回执为准（事件可能早于本次 invoke 返回，这里保证「跳过版本」标签不为空）
  updateNewVersion.value = res.version || updateNewVersion.value;
  // 文案由主进程产出（含 available / skipped / none 三种），这里只做极端兜底
  updateMessage.value = res.message || '检查完成';
  updateDetail.value = res.detail || '';
  updateStatusClass.value = res.state === 'available' ? 'hf-ok' : '';
}

// 打开 updater.log 所在目录：更新失败时把原始报错交给提供者的正规出口
async function onOpenUpdateLog(): Promise<void> {
  try {
    const res = await window.updateTools.openLog();
    if (res && !res.ok) {
      setUpdaterStatus(res.message || '打开日志目录失败', 'hf-error');
    }
  } catch (e) {
    setUpdaterStatus('打开日志目录失败', 'hf-error');
  }
}

async function onDownloadUpdate(): Promise<void> {
  try {
    const res = await window.updateTools.download();
    if (!res || !res.ok) {
      updateStage.value = 'error';
      updateMessage.value = (res && res.message) || '下载失败，请稍后重试';
      updateDetail.value = (res && res.detail) || '';
      updateStatusClass.value = 'hf-error';
    }
  } catch (e) {
    handleUpdateError('下载', e);
  }
}

async function onCancelUpdate(): Promise<void> {
  try {
    const res = await window.updateTools.cancel();
    if (res && !res.ok) {
      updateMessage.value = res.message || '取消下载失败，请重试';
      updateDetail.value = res.detail || '';
      updateStatusClass.value = 'hf-error';
    }
  } catch (e) {
    handleUpdateError('取消下载', e);
  }
}

async function onInstallUpdate(): Promise<void> {
  try {
    const res = await window.updateTools.install();
    // 成功时主进程会退出并运行安装器，这里只处理被拒绝的情况（如本机有转录 / 渲染任务在跑）；
    // 另一种 ok 但有话要说的情况是「用户在确认弹窗里点了取消」——那时要把这句话显示出来
    if (!res || !res.ok) {
      updateMessage.value = (res && res.message) || '安装失败，请稍后重试';
      updateDetail.value = (res && res.detail) || '';
      updateStatusClass.value = 'hf-error';
    } else if (res.message) {
      updateMessage.value = res.message;
      updateDetail.value = '';
      updateStatusClass.value = '';
    }
  } catch (e) {
    handleUpdateError('安装', e);
  }
}

// 撤销「跳过该版本」：清掉 settings.json 里的 skippedVersion，让新版本重新提示
// 写进去的必须是**目标版本**（updateNewVersion）：主进程是拿 available 的那个版本号与 skippedVersion
// 比较的（见 updater.ts 的 update-available 分支），写当前版本永远不会命中
async function onSkipVersion(skip: boolean): Promise<void> {
  try {
    const res = await window.settingsTools.saveUpdater({ skippedVersion: skip ? updateNewVersion.value : '' });
    if (res && res.ok) {
      updateDetail.value = '';
      updateMessage.value = skip ? ('已跳过版本 ' + updateNewVersion.value) : ('已恢复提示版本 ' + updateNewVersion.value);
      updateStatusClass.value = '';
    } else {
      updateMessage.value = (res as { message?: string })?.message || '操作失败';
      updateStatusClass.value = 'hf-error';
    }
  } catch (e) {
    handleUpdateError(skip ? '跳过版本' : '恢复提示', e);
  }
}

onMounted(async () => {
  // 先落实「带意图跳进来」的分类（例：音色管理 → API Key 设置 → 语音服务），再载入配置
  applySectionIntent();
  // 载入当前配置
  try {
    const s = await window.settingsTools.get();
    const m = (s && s.customModel) || {};
    baseUrl.value = m.baseUrl || '';
    modelId.value = m.modelId || '';
    apiKey.value = m.apiKey || '';
    enabled.value = !!m.enabled;
    // 已保存的值不在预设里 ⇒ 默认进手填态。不这么做下拉会显示空占位，用户看到的是"我配的地址/模型没了"
    baseUrlCustom.value = !!baseUrl.value && !MODEL_PROVIDERS.some((p) => p.baseUrls.includes(baseUrl.value));
    modelCustom.value = !!modelId.value && !(currentProvider.value && currentProvider.value.models.includes(modelId.value));
  } catch (e) {
    setStatus('读取配置失败：' + ((e as Error) && (e as Error).message ? (e as Error).message : e), 'hf-error');
  }
  // 语音服务（按厂家）：厂家目录 + 各厂家已保存配置
  const mm = await window.voiceTools.listModels().catch(() => ({ ok: false, models: [], providers: [] } as any));
  voiceProviders.value = ((mm && mm.providers) || []) as VoiceProviderView[];
  try {
    const s = await window.settingsTools.get();
    const v = ((s as unknown as { voice?: { active?: string; providers?: Record<string, { apiKey: string }> } }).voice) || {};
    vSaved.value = (v.providers || {}) as Record<string, { apiKey: string }>;
    vProvider.value = String(v.active || '') || ((voiceProviders.value[0] && voiceProviders.value[0].key) || '');
  } catch (e) {
    setVStatus('读取语音服务配置失败', 'hf-error');
  }
  syncVoiceForm();
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
  // 订阅之后再补齐一次主进程状态：启动静默检查（3s）早于本页订阅，不补这一次，
  // 那次失败就只剩「尚未检查更新」——连带它的「查看详情 / 打开日志目录」一起看不到
  try {
    const st = await window.updateTools.status();
    if (st && st.stage && st.stage !== 'idle') applyUpdateProgress(st);
  } catch (e) { /* 主进程未就绪：保持 idle，不打扰用户 */ }
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
  window.addEventListener('keydown', onFeedDialogKey);
});

// 与 onMounted 成对注册，避免离开设置页后监听器残留（项目既有惯例）
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFeedDialogKey);
});
</script>
