/// <reference types="vite/client" />

// 让 tsc 识别 .vue 导入（无 vue-tsc，SFC 语法由 @vitejs/plugin-vue 构建期校验）
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
