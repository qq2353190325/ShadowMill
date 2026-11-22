<template>
  <!-- 自绘标题栏（深空科技风格，可拖拽窗口） -->
  <header class="titlebar">
    <div class="titlebar-left">
      <svg class="titlebar-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>
      </svg>
      <span class="titlebar-title">{{ APP_NAME }}</span>
    </div>
    <div class="titlebar-controls">
      <button class="win-btn" title="最小化" @click="winMinimize">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M4 8.5h8"/>
        </svg>
      </button>
      <button class="win-btn" :title="isMaximized ? '还原' : '最大化'" @click="winToggleMaximize">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect v-show="!isMaximized" x="3.5" y="3.5" width="9" height="9" rx="1"/>
          <g v-show="isMaximized">
            <rect x="4" y="6" width="7.5" height="7.5" rx="1"/>
            <rect x="6.5" y="3.5" width="7.5" height="7.5" rx="1" fill="#0B1220"/>
          </g>
        </svg>
      </button>
      <button class="win-btn win-close" title="关闭" @click="winClose">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- 运行环境横幅（ffmpeg / hyperframes 分包，见 docs/runtime-pack-split.md）：
       安装包里不再带这两个包，用到时由用户确认下载。这里显示三类状态：
       ① 正在下载 / 解包（带进度与取消）② 缺包（带「下载」）③ 失败（带「重试」+ 详情） -->
  <div v-if="runtimeVisible" class="runtime-banner" :class="{ 'is-error': runtimeFailed }">
    <span class="runtime-banner-text">{{ runtimeState.message || runtimeMissingText }}</span>
    <span v-if="runtimeBusy" class="runtime-banner-bar"><i :style="{ width: runtimeState.percent + '%' }"></i></span>
    <button v-if="runtimeCancellable" class="runtime-banner-btn" @click="cancelRuntime">取消</button>
    <button v-else-if="runtimeFailed" class="runtime-banner-btn" @click="retryRuntime">重试</button>
    <button v-else-if="runtimeHasMissing" class="runtime-banner-btn" @click="downloadRuntime">下载运行环境</button>
  </div>

  <div class="layout">
    <!-- 左侧栏三模块：① 菜单（首页置顶 + 五节点 + 角色）② 滚动项目列表 ③ 登录。
         .menu 是 flex:1 吃掉剩余高度并自己滚，另两块 flex:none 固定，窗口再矮也不会把登录顶出视口。 -->
    <aside class="sidebar">
      <nav class="menu" id="menu">
        <!-- 一个合并的菜单块：首页在最上，接着五节点（01–05 序号 + 完成点），角色跟在 05 后面。
             「设置」不是页面、也不在菜单里：入口在左下角用户浮窗；goPage('settings') 仍供各处「去设置」调用。 -->
        <div
          v-for="item in menuItems"
          :key="item.key"
          class="menu-item"
          :class="{ active: activeMenu === item.key }"
          :data-page="item.key"
          :title="item.title"
          @click="goPage(item.key)"
        >
          <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path :d="item.icon" /></svg>
          <span v-if="item.idx" class="menu-idx">{{ item.idx }}</span>
          <span class="menu-label">{{ item.label }}</span>
          <span v-if="item.pipeline" class="menu-dot" :class="{ on: doneMap[item.key] }"></span>
        </div>
      </nav>

      <ProjectArea />
      <UserArea />
    </aside>

    <!-- 右侧内容区 -->
    <main class="content" id="content" ref="contentEl">
      <component :is="currentPage" :key="pageNavKey" />
    </main>
  </div>

  <!-- 历史数据目录（品牌/目录改名留下的老数据）：有就由这个应用内弹窗问「迁移 / 删除 / 稍后」 -->
  <LegacyDataDialog />

  <!-- 设置弹窗（全局单例）：设置是模态弹窗，入口在左下角用户浮窗，各处「去设置」也都开它 -->
  <SettingsDialog />

  <!-- 登录 / 注册弹窗（全局单例）：左下角用户浮窗的「登录」打开它 -->
  <AuthDialog />

  <!-- 运行环境缺包时的统一确认框（任何功能触发 → 下载 → 继续），全局只此一处 -->
  <div v-if="gate.visible.value" class="hf-modal-mask" @click.self="gate.close()">
    <div class="hf-modal" style="width:min(480px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">需要下载运行环境</span>
        <button class="hf-modal-close" title="关闭" @click="gate.close()">×</button>
      </div>
      <div class="hf-modal-body">
        <div class="env-gate-line">
          「{{ gate.title.value }}」需要以下运行环境（不随安装包发布，只在用到时下载）：
        </div>
        <div class="env-gate-packs">
          <div v-for="p in gate.packLines.value" :key="p.name" class="env-gate-pack">
            <div class="env-gate-pack-line">{{ p.label }}</div>
            <div v-if="p.note" class="env-gate-pack-note">{{ p.note }}</div>
          </div>
        </div>

        <template v-if="gate.phase.value === 'downloading'">
          <div class="runtime-banner-bar" style="width:100%"><i :style="{ width: gate.percent.value + '%' }"></i></div>
          <div class="hf-status" style="margin-top:8px">{{ gate.message.value || '正在下载…' }}</div>
        </template>
        <div v-else-if="gate.readyNow.value" class="hf-status">
          运行环境已就绪。点「继续」接着做刚才那件事，或关闭本框稍后自己再点。
        </div>
        <div v-else-if="gate.message.value" class="hf-status">{{ gate.message.value }}</div>
        <div v-if="gate.detail.value" class="hf-detail">{{ gate.detail.value }}</div>

        <div class="hgen-actions" style="margin-top:12px">
          <template v-if="gate.phase.value === 'downloading'">
            <button class="hf-btn" @click="gate.cancelDownload()">取消下载</button>
          </template>
          <template v-else-if="gate.readyNow.value">
            <button class="hf-btn hf-btn-primary" @click="gate.continueAction()">继续</button>
            <button class="hf-btn" @click="gate.close()">关闭</button>
          </template>
          <template v-else>
            <button class="hf-btn hf-btn-primary" @click="gate.confirmDownload()">下载运行环境</button>
            <button class="hf-btn" @click="gate.close()">取消</button>
          </template>
        </div>
        <div class="hgen-tip" style="margin-bottom:0">
          取消＝不下载，这次操作也随之作废（不会留下半截状态，也不会在后台偷偷下载）。
        </div>
      </div>
    </div>
  </div>

  <!-- 配置类错误的统一弹窗（缺 Key / Key 无效 / 配置不完整 / Base URL 填错 / 未启用）。
       与上面的运行环境框同一范式：全局单例、两个按钮（[去设置] / [取消]）。
       刻意**不显示「查看详情」**——配置类错误的原始报文对用户没有可操作性，详情仍落日志。
       余额 / 欠费类**不进这里**：去设置修不了余额，它走内嵌状态行（文案说明去厂家控制台充值）。 -->
  <div v-if="configPrompt.visible.value" class="hf-modal-mask" @click.self="configPrompt.close()">
    <div class="hf-modal" style="width:min(520px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">{{ configPrompt.title.value }}</span>
        <button class="hf-modal-close" title="关闭" @click="configPrompt.close()">×</button>
      </div>
      <div class="hf-modal-body">
        <div class="hf-status hf-error" style="margin:0">{{ configPrompt.message.value }}</div>
        <div class="hgen-tip" style="margin:10px 0 0">
          点「去设置」前往修改配置；点「取消」放弃本次操作，可以稍后再来。
        </div>
        <div class="hgen-actions" style="margin-top:12px">
          <button class="hf-btn hf-btn-primary" @click="configPrompt.go()">去设置</button>
          <button class="hf-btn" @click="configPrompt.close()">取消</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 轻提示（原 window.App.toast 的固定定位 div） -->
  <TransitionGroup tag="div" name="toast" class="toast-host">
    <div v-for="t in toasts" :key="t.id" class="toast-item">{{ t.msg }}</div>
  </TransitionGroup>
</template>

<script setup lang="ts">
// App.vue —— 应用外壳：标题栏 + 侧边菜单 + 页面容器 + ToastHost + 全局初始化
// （原 src/index.html 的 titlebar/sidebar 标记 + entry.js 的窗口控制/进度监听/启动逻辑）
import { computed, onMounted, ref, watch } from 'vue'
import { APP_NAME } from '@shared/constants'
import { STORAGE_KEY_PROJECT_CTX } from '@renderer/constants'
import { activeMenu, appState, hasAudio, hasContent, hasHtml, hasSubtitle, hasVideo, refreshProject, type PageKey } from './composables/useAppStore'
import { currentPage, goPage, pageNavKey } from './pages'
import { useToasts } from './composables/useToast'
import { initRenderProgress } from './composables/useRenderProgress'
import { loadRenderDefaults } from './composables/useRenderOptions'
import { initRuntime, useRuntime } from './composables/useRuntime'
import { initEnvGate, useEnvGate } from './composables/useEnvGate'
import { useConfigPrompt } from './composables/useConfigPrompt'
import { initLegacyData } from './composables/useLegacyData'
import { restore } from './composables/useAuth'
import LegacyDataDialog from './components/LegacyDataDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import AuthDialog from './components/AuthDialog.vue'
import UserArea from './components/UserArea.vue'
import ProjectArea from './components/ProjectArea.vue'

const toasts = useToasts();
const contentEl = ref<HTMLElement | null>(null);
const isMaximized = ref(false);
// 运行环境横幅：正在下载 / 缺包 / 失败时出现（已就绪时保持界面干净）
const {
  runtime: runtimeState, busy: runtimeBusy, failed: runtimeFailed, hasMissing: runtimeHasMissing,
  cancelable: runtimeCancellable, missingText: runtimeMissingText, prepare: prepareRuntime, cancel: cancelRuntime
} = useRuntime();
const runtimeVisible = computed(() => runtimeBusy.value || runtimeFailed.value || runtimeHasMissing.value);
// 运行环境缺包的统一确认框（各功能页经 useEnvGate().guard 触发）
const gate = useEnvGate();
// 配置类错误的统一弹窗（各功能页拿到主进程 res.needConfig 后经 configPrompt.open 触发）
const configPrompt = useConfigPrompt();
function retryRuntime(): void { void prepareRuntime(); }
function downloadRuntime(): void { void prepareRuntime(); }
type MenuItem = { key: PageKey; label: string; title: string; icon: string; idx?: string; pipeline?: boolean };
// 一个合并的菜单块：首页置顶，接着 5 项创作流水线（序号 + 完成小圆点），角色跟在 05 后面。
// icon 是 24×24 viewBox 的 SVG path，直接内联渲染，不引图标库；
// 「关于」已收进设置弹窗，「设置」入口在用户浮窗（goPage('settings') 仍供各处「去设置」调用），两者都不在菜单里。
const menuItems: MenuItem[] = [
  { key: 'home', label: '首页', title: '首页', icon: 'M3 11l9-8 9 8 M5 10v10h14V10 M10 20v-6h4v6' },
  { key: 'content', idx: '01', label: '内容脚本', title: '内容脚本', icon: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 12h7 M10 16h5', pipeline: true },
  { key: 'text-tts', idx: '02', label: '配音', title: '配音（文字生音频）', icon: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6', pipeline: true },
  { key: 'subtitle', idx: '03', label: '字幕生成', title: '字幕生成', icon: 'M3 5h18v14H3z M7 10h4 M7 14h10', pipeline: true },
  { key: 'html-gen', idx: '04', label: 'HTML生成', title: 'HTML生成', icon: 'M9 8l-4 4 4 4 M15 8l4 4-4 4 M13 5l-2 14', pipeline: true },
  { key: 'video-preview', idx: '05', label: '视频预览', title: '视频预览（转视频入口在 HTML生成页）', icon: 'M3 5h18v14H3z M10 9l5 3-5 3z', pipeline: true },
  { key: 'cast', label: '角色', title: '角色（全局角色库：新建 / 修改，创作时勾选本片用哪几个）', icon: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 21a8 8 0 0 1 16 0' }
];
// 完成态只在这里解析成布尔：模板里顶层 computed 会自动 unwrap，索引访问拿到的是值而不是 ComputedRef
const doneMap = computed<Record<string, boolean>>(() => ({
  content: hasContent.value,
  'text-tts': hasAudio.value,
  subtitle: hasSubtitle.value,
  'html-gen': hasHtml.value,
  'video-preview': hasVideo.value
}));

// 页面切换后滚动复位（对应原 goPage 的 content.scrollTop = 0）
watch(currentPage, () => {
  if (contentEl.value) contentEl.value.scrollTop = 0;
});

// ===== 窗口控制（模板作用域无 window 全局，经包装函数调用 preload 桥） =====
function winMinimize(): void { window.windowControls.minimize(); }
function winToggleMaximize(): void { window.windowControls.toggleMaximize(); }
function winClose(): void { window.windowControls.close(); }

// ===== 启动：恢复上次项目上下文 → 刷新项目 → 进入首页（原 App.init） =====
async function initApp(): Promise<void> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECT_CTX) || 'null');
    if (saved && saved.name) {
      appState.currentName = saved.name;
    }
  } catch (e) { /* ignore */ }
  // 项目列表与渲染默认档位并行载入（档位读取失败不影响启动，落回内置默认）
  await Promise.all([refreshProject(), loadRenderDefaults()]);
  // 这里刻意**不再**调 goPage('home')：首页本就是初始页（pages.currentPage 初值 + activeMenu 初值都是 home），
  // 再走一遍 goPage 只会白白多跑一轮 refreshProject（项目列表 + 项目详情两次 IPC）并递增 pageNavKey
  // 把已经挂好的首页整页重挂一次。首页内容由上面的 refreshProject 直接驱动渲染。
}

onMounted(() => {
  window.windowControls.onMaximizedChange((v: boolean) => { isMaximized.value = v; });
  initRenderProgress();
  initRuntime();
  initEnvGate();
  initLegacyData();
  // 登录态校验：异步问一次账号服务（/me），不阻塞首屏；断网时保留上次的展示态（离线可用）。
  // 未登录时它直接返回，不做任何请求。
  void restore();
  void initApp();
});
</script>

<style scoped>
/* 运行环境横幅（标题栏之下、内容区之上的一条窄带；flex 子项，不遮挡页面） */
.runtime-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 16px;
  font-size: 12px;
  color: var(--text-primary);
  background: linear-gradient(90deg, rgba(0, 212, 255, .12) 0%, rgba(139, 92, 246, .10) 100%);
  border-bottom: 1px solid rgba(0, 212, 255, .25);
  box-shadow: var(--glow-card);
}
.runtime-banner.is-error {
  background: linear-gradient(90deg, rgba(255, 77, 109, .14) 0%, rgba(255, 176, 32, .10) 100%);
  border-bottom-color: rgba(255, 77, 109, .35);
}
.runtime-banner-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 进度条：与渲染进度同语言的细条 */
.runtime-banner-bar {
  flex: none;
  width: 160px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, .12);
  overflow: hidden;
}
.runtime-banner-bar > i {
  display: block;
  height: 100%;
  background: linear-gradient(135deg, #00D4FF 0%, #8B5CF6 100%);
  box-shadow: var(--glow-primary);
  transition: width .2s ease;
}
.runtime-banner-btn {
  flex: none;
  padding: 3px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition: background .2s ease, box-shadow .2s ease;
}
.runtime-banner-btn:hover {
  background: rgba(0, 212, 255, .16);
  box-shadow: var(--glow-primary);
}

/* 「需要下载运行环境」确认框：包清单逐行（13px 主色）+ 每包说明（12px 雾蓝） */
.env-gate-line {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.7;
}
.env-gate-packs {
  margin: 8px 0 4px;
}
.env-gate-pack + .env-gate-pack {
  margin-top: 8px;
}
.env-gate-pack-line {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  line-height: 1.4;
}
.env-gate-pack-note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* 轻提示（样式自原 app.js toast 内联样式移植） */
.toast-host {
  position: fixed;
  left: 0;
  bottom: 0;
  width: 100%;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 9999;
}
.toast-item {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 13px;
  color: #E6F1FF;
  background: rgba(11, 18, 32, .95);
  border: 1px solid rgba(0, 212, 255, .5);
  box-shadow: 0 0 18px rgba(0, 212, 255, .35);
  max-width: 70vw;
  pointer-events: auto;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
