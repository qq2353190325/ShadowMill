// src/renderer/src/constants.ts —— 渲染层公共常量（跨页面/跨组件的字面量集中于此）
// 品牌文案（应用名、英文名、口号）在 @shared/constants —— 那是 main / preload / 渲染层三端共用的一份，
// 本文件只放渲染层自己的约定。

// ===== localStorage 键名 =====
// 前缀 'myapp.' 是首次上线时的 npm 包名，**故意不跟随品牌名（影坊 / shadowmill）变更**：
// prod 下页面走 file:// 同源，键名就是用户数据的地址，
// 改名会让「上次打开的项目」「设置页上次的分类」全部读不到（表现像记忆功能坏了）。
// 真要改前缀，必须同时补一段「读旧键 → 写新键」的迁移，不能只改常量。
export const STORAGE_PREFIX = 'myapp.';
// 上次打开的项目名：App.vue 启动时读，useAppStore.saveProjectCtx 写
export const STORAGE_KEY_PROJECT_CTX = STORAGE_PREFIX + 'projectCtx';
// 设置页上次停留的分类（SettingsPage 读写）
export const STORAGE_KEY_SETTINGS_SECTION = STORAGE_PREFIX + 'settingsSection';
