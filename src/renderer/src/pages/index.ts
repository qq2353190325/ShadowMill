// pages/index.ts —— 页面注册表 + 路由（原 window.App.pages + goPage）
// 无 vue-router：保留注册表模式（goPage = 菜单高亮 → refreshProject → 切换当前组件）。
// 组件对象不 reactive 化（shallowRef），避免 Vue 代理组件定义。
import { ref, shallowRef, type Component } from 'vue'
import { activeMenu, refreshProject, type PageKey } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import HomePage from './HomePage/index.vue'
import AboutPage from './AboutPage/index.vue'
import ContentPage from './ContentPage/index.vue'
import TextTtsPage from './TextTtsPage/index.vue'
import SubtitlePage from './SubtitlePage/index.vue'
import HtmlGenPage from './HtmlGenPage/index.vue'
import VideoPreviewPage from './VideoPreviewPage/index.vue'
import SettingsPage from './SettingsPage/index.vue'

// 音色管理不再是独立页：已并入 TextTtsPage 的第三个 Tab（原 SoundCopyPage 下线）
export const pages: Record<PageKey, Component> = {
  home: HomePage,
  about: AboutPage,
  content: ContentPage,
  'text-tts': TextTtsPage,
  subtitle: SubtitlePage,
  'html-gen': HtmlGenPage,
  'video-preview': VideoPreviewPage,
  settings: SettingsPage
};

export const currentPage = shallowRef<Component>(pages.home);

// 页面导航序号：作为 <component :is> 的 key。旧版每次 goPage 都重建页面 DOM、重跑页面 init；
// Vue 复用同一组件实例时不会重挂载，导致同页切换项目后页面数据/预览残留（旧项目状态）。
// 每次导航递增 key 强制重挂载，恢复旧语义（各页面 onMounted 重新加载当前项目数据）。
export const pageNavKey = ref(0);

export async function goPage(key: PageKey): Promise<void> {
  activeMenu.value = key;
  // 刷新项目上下文失败**不能连导航一起拖住**：旧写法是「先 await refreshProject() 再切页」，
  // 一旦它抛错（IPC 拒绝 / 某处 TypeError）就永远停在「侧栏菜单亮了、页面没换」的半截状态，
  // 而未处理的 Promise 拒绝只进 devtools，界面上一点提示都没有——用户只能看到"点不动"。
  // 现在：失败照切页，并把原因说出来（toast + console）。
  try {
    await refreshProject();
  } catch (e) {
    const msg = (e && (e as { message?: string }).message) || String(e);
    console.error('[goPage] 刷新项目上下文失败（不影响本次切页）：', e);
    toast('项目信息刷新失败：' + msg);
  }
  currentPage.value = pages[key];
  pageNavKey.value++;
  // 滚动复位由 App.vue watch(currentPage) 处理（对应原 goPage 的 content.scrollTop = 0）
}
