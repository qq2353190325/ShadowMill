// src/renderer/src/main.ts —— Vue 应用入口（Phase 1 骨架；Phase 5 移植 App.init 启动流程）
import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'

createApp(App).mount('#app')

// 首屏已挂载：淡出并移除 index.html 里的启动画面。
// 该画面由 HTML 直接渲染（不依赖 JS），用来填掉「窗口已出现、Vue 还没挂载」那段空背景；
// mount 是同步的，此刻外壳已在 DOM 中，直接淡出不会出现中间空档。
const bootSplash = document.getElementById('boot-splash')
if (bootSplash) {
  bootSplash.classList.add('boot-done')
  window.setTimeout(() => bootSplash.remove(), 300)
}
