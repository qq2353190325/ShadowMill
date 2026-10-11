<template>
  <!-- 自绘标题栏（深空科技风格，可拖拽窗口） -->
  <header class="titlebar">
    <div class="titlebar-left">
      <svg class="titlebar-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>
      </svg>
      <span class="titlebar-title">我的应用</span>
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

  <div class="layout">
    <!-- 左侧菜单（文字菜单） -->
    <aside class="sidebar">
      <nav class="menu" id="menu">
        <div
          v-for="item in menuItems"
          :key="item.key"
          class="menu-item"
          :class="{ active: activeMenu === item.key }"
          :data-page="item.key"
          :title="item.title"
          @click="goPage(item.key)"
        >{{ item.label }}</div>
      </nav>
    </aside>

    <!-- 右侧内容区 -->
    <main class="content" id="content" ref="contentEl">
      <component :is="currentPage" :key="pageNavKey" />
    </main>
  </div>

  <!-- 轻提示（原 window.App.toast 的固定定位 div） -->
  <TransitionGroup tag="div" name="toast" class="toast-host">
    <div v-for="t in toasts" :key="t.id" class="toast-item">{{ t.msg }}</div>
  </TransitionGroup>
</template>

<script setup lang="ts">
// App.vue —— 应用外壳：标题栏 + 侧边菜单 + 页面容器 + ToastHost + 全局初始化
// （原 src/index.html 的 titlebar/sidebar 标记 + entry.js 的窗口控制/进度监听/启动逻辑）
import { onMounted, ref, watch } from 'vue'
import { activeMenu, appState, refreshProject, type PageKey } from './composables/useAppStore'
import { currentPage, goPage, pageNavKey } from './pages'
import { useToasts } from './composables/useToast'
import { initRenderProgress } from './composables/useRenderProgress'
import { loadRenderDefaults } from './composables/useRenderOptions'

const toasts = useToasts();
const contentEl = ref<HTMLElement | null>(null);
const isMaximized = ref(false);

const menuItems: { key: PageKey; label: string; title: string }[] = [
  { key: 'home', label: '首页', title: '首页' },
  { key: 'content', label: '内容脚本', title: '内容脚本' },
  { key: 'text-tts', label: '配音', title: '配音（文字生音频）' },
  { key: 'subtitle', label: '字幕生成', title: '字幕生成' },
  { key: 'html-gen', label: 'HTML生成', title: 'HTML生成' },
  { key: 'video-preview', label: '视频预览', title: '视频预览（转视频入口在 HTML生成页）' },
  { key: 'about', label: '关于', title: '关于' },
  { key: 'settings', label: '设置', title: '设置' }
];

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
    const saved = JSON.parse(localStorage.getItem('myapp.projectCtx') || 'null');
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
  void initApp();
});
</script>

<style scoped>
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
