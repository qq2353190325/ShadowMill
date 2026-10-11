// electron.vite.config.ts —— 三端构建配置
// main/preload：externalizeDepsPlugin 保持 openai/opencc-js 等依赖为运行时 require（不内联进 bundle）
// renderer：base './' 使产物资源用相对路径（loadFile(file://) 可加载）；@renderer/@shared 别名
// dev 专属：strictPort 固定 5173（冲突即报错，避免 Vite 偷偷换端口后 Electron 仍指向 5173 而白屏）；
//          cspDevWsPlugin 按环境注入 CSP 的 connect-src ws 源（dev 用实际 dev server 地址，prod 原样输出）。
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// 开发期 HMR 的 WebSocket 源按实际 dev server 地址注入 CSP。
// 背景：CSP 是静态 meta，而 dev server 端口由 electron-vite/Vite 决定；把 ws://localhost:5173 写死会在
// 端口漂移时静默拦掉 HMR。此处仅在 dev 的 transformIndexHtml 阶段读 server.resolvedUrls 替换（build 不变）。
function cspDevWsPlugin(): Plugin {
  return {
    name: 'dsh:csp-dev-ws',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const devUrl = ctx.server?.resolvedUrls?.local?.[0]
        if (!devUrl) return html
        // host 可能是 IPv6（如 http://[::1]:5173/），用 URL 解析而非字符串截取；ws 无加密分支，故直接换协议
        const wsOrigin = new URL(devUrl).origin.replace(/^http/, 'ws')
        return html.replace(
          /(connect-src[^;"]*)/,
          (_m, group: string) => (group.includes(wsOrigin) ? group : group + ' ' + wsOrigin)
        )
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    base: './',
    // dev server 固定 127.0.0.1:5173 且端口被占时直接失败：宁可响亮报错，也不要偷偷换到 5174
    // 而让 Electron 仍去加载 localhost:5173（表现为白屏 + ERR_EMPTY_RESPONSE）
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue(), cspDevWsPlugin()]
  }
})
