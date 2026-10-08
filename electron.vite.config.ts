// electron.vite.config.ts —— 三端构建配置
// main/preload：externalizeDepsPlugin 保持 openai/opencc-js 等依赖为运行时 require（不内联进 bundle）
// renderer：base './' 使产物资源用相对路径（loadFile(file://) 可加载）；@renderer/@shared 别名
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    base: './',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue()]
  }
})
