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

// ===== 自定义模型（HTML 生成 Agent）的 Base URL / 模型预设 =====
// 「常见取值」的快捷方式，不是白名单：模型名会被服务商下线或改名，所以界面必须保留「自定义」手填。
// 来源（核对 2026-10，改表时把日期一起更新）：
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//   https://help.aliyun.com/zh/model-studio/models
//   https://docs.bigmodel.cn/cn/guide/start/model-overview
//   https://platform.minimax.cn/docs/guides/text-generation
// 约定：baseUrl 一律不带结尾斜杠；models 只是常用档位，可能不全或过时。
export interface ProviderPreset {
  key: string
  label: string
  baseUrls: string[]
  models: string[]
}

export const MODEL_PROVIDERS: ProviderPreset[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrls: ['https://api.deepseek.com'],
    models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  {
    key: 'bailian',
    label: '阿里云百炼',
    baseUrls: ['https://dashscope.aliyuncs.com/compatible-mode/v1'],
    models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash']
  },
  {
    key: 'zhipu',
    label: '智谱 GLM',
    baseUrls: ['https://open.bigmodel.cn/api/paas/v4'],
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2', 'glm-5.1', 'glm-5']
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    baseUrls: ['https://api.minimax.cn/v1'],
    models: [
      'MiniMax-M3.1-Flash-Preview', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2'
    ]
  }
];
