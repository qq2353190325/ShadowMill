// src/renderer/src/main.ts —— Vue 应用入口（Phase 1 骨架；Phase 5 移植 App.init 启动流程）
import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'

createApp(App).mount('#app')
