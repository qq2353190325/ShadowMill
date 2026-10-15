<template>
  <div class="card hgen-panel">
    <div class="panel-title"><span class="dot"></span>应用更新</div>
    <div class="hgen-row">
      <label class="sel-label">当前版本</label>
      <span class="hf-file" style="flex:1">{{ updateVersion || '—' }}</span>
    </div>
    <div class="hgen-actions">
      <button class="hf-btn hf-btn-primary" :disabled="updateBusy" @click="onCheckUpdate">检查更新</button>
      <button class="hf-btn" @click="openFeedDialog">自定义更新源</button>
      <button class="hf-btn" title="看看各版本都改了什么（内容来自随安装包的 CHANGELOG.md）" @click="changelogVisible = true">查看更新日志</button>
      <button v-if="updateStage === 'available' || updateStage === 'skipped'" class="hf-btn" @click="onDownloadUpdate">下载更新</button>
      <button v-if="updateStage === 'downloading'" class="hf-btn" @click="onCancelUpdate">取消下载</button>
      <button v-if="updateStage === 'downloaded'" class="hf-btn hf-btn-primary" @click="onInstallUpdate">立即重启安装</button>
    </div>
    <div class="hf-status" :class="updateStatusClass">{{ updateMessage }}</div>
    <!-- 排障出口：latest.yml / 存储桶 / HTTP 状态这类信息只在「详情」里展开，用户文案本身保持人话。
         入口**平时不出现**——没出错时把用户送进日志目录，他看到的是自己读不懂的文件，
         只会以为哪里坏了；只在更新出错（检查 / 下载 / 安装失败）时才露出来。
         启动静默检查的失败同样能显示：那次失败发生在本页订阅进度之前，
         本组件挂载时用 updateTools.status() 找主进程要一次当前状态（见 onMounted） -->
    <div v-if="updateDetail || updateLogVisible" class="hgen-actions" style="margin-top:0">
      <button v-if="updateDetail" class="hf-btn" @click="showUpdateDetail = !showUpdateDetail">{{ showUpdateDetail ? '收起详情' : '查看详情' }}</button>
      <button v-if="updateLogVisible" class="hf-btn" @click="onOpenUpdateLog">打开日志目录</button>
    </div>
    <div v-if="updateDetail && showUpdateDetail" class="hf-detail">{{ updateDetail }}</div>
    <!-- 「跳过版本 / 恢复提示版本」是**更新动作**，必须排在下面「运行环境（分包）」那几行**之前**：
         它俩属于「应用更新」的分支操作，掉到「下载运行环境」下面会被读成运行环境的操作（用户反馈过） -->
    <div v-if="updateStage === 'available'" class="hgen-actions" style="margin-top:8px">
      <button class="hf-btn" @click="onSkipVersion(true)">跳过版本 {{ updateNewVersion }}</button>
    </div>
    <div v-else-if="updateStage === 'skipped'" class="hgen-actions" style="margin-top:8px">
      <button class="hf-btn" @click="onSkipVersion(false)">恢复提示版本 {{ updateNewVersion }}</button>
    </div>
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

    <!-- 自定义更新源弹窗：保存 / 重置均即时落盘（settings.json 的 updater 段）。
         必须 Teleport 到 body —— `.card` 上有 backdrop-filter，它会让 position:fixed 相对**卡片**定位，
         蒙层只盖住卡片、弹窗按卡片居中（卡片高于窗口或被滚动时弹窗就跑到窗口外）。
         同一坑见 VoiceSection 的克隆音色弹窗与 ChangelogDialog -->
    <Teleport to="body">
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
    </Teleport>

    <!-- 更新日志弹窗：数据来自随包的 CHANGELOG.md（update:changelog），打开即取一次、关掉即销毁 -->
    <ChangelogDialog v-if="changelogVisible" @close="changelogVisible = false" />
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/components/UpdateSection.vue —— 设置页「应用更新」区块（含运行环境 + 自定义更新源弹窗）
// 全部更新状态由主进程 update:progress 通道驱动：这里只是订阅方 + 触发方（检查 / 下载 / 重启安装）。
// `updateStage` 在 ../helpers 里（模块级 ref）：左侧导航项「应用更新」的红点要读同一个值。
// 文案不在这一层拼：available / skipped / none / error 的句子统一由主进程 updater.ts 产出
// （两处各拼一套会互相覆盖，同一状态两句话在打架）。这里只渲染 message，
// 并把 detail（排障详情）收进可折叠的「查看详情」。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { UpdateProgressPayload } from '@shared/types'
import { useRuntime } from '@renderer/composables/useRuntime'
import type { UpdateCheckReply } from '../types'
import { updateStage } from '../helpers'
import ChangelogDialog from './ChangelogDialog.vue'

const updateVersion = ref('');
// 待安装的目标版本（payload/回执里的 version）：只给「跳过版本 / 恢复提示版本」用，
// 与「当前版本」（updateVersion）严格分开——见 applyUpdateProgress 的注释
const updateNewVersion = ref('');
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
// 「更新日志」弹窗开关（内容与解析都在子组件里，这里只管显隐）
const changelogVisible = ref(false);

// ===== 运行环境（分包 ffmpeg / hyperframes；whisper 随安装包）=====
// 模块级单例，外壳横幅与本组件读同一份（见 composables/useRuntime.ts、docs/runtime-pack-split.md）
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
  // 「跳过版本 x / 恢复提示版本 x」用的是它：与「当前版本」混用会把当前版本写进
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
  // 应用更新：版本号走同步接口首屏即显示；订阅进度通道（单订阅，重复进本页只替换回调）
  try {
    updateVersion.value = window.updateTools.version() || '';
  } catch (e) {
    updateMessage.value = '读取版本号失败';
    updateStatusClass.value = 'hf-error';
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
