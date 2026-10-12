# src/renderer/src/constants.ts

> 渲染层公共常量：`localStorage` 键名前缀与两个持久化键的唯一定义处

- **所在目录**：`src/renderer/src/`
- **类型**：渲染层常量（纯字面量与常量派生，无 import、无副作用）
- **规模**：14 行
- **对外导出**：`STORAGE_PREFIX`、`STORAGE_KEY_PROJECT_CTX`、`STORAGE_KEY_SETTINGS_SECTION`（3 个字符串常量）

## 1. 作用与职责

本文件集中渲染层自己的约定——当前只有一类：**`localStorage` 键名**。此前 `'myapp.projectCtx'` 在 `App.vue` 与 `useAppStore.ts` 两处各写一遍字面量、`'myapp.settingsSection'` 写在 `SettingsPage/index.vue` 里，「同一个键散落多处」没有任何编译期提示。

它与 `@shared/constants` 的分工（源码头部注释写明）：

| 文件 | 放什么 | 谁消费 |
|---|---|---|
| `src/shared/constants.ts` | 品牌文案（应用名 / 英文名 / 口号）、出网 User-Agent | main + preload + 渲染层 + 构建配置 |
| **本文件** | **渲染层自己的约定**（当前为 `localStorage` 键名） | 仅渲染层 |

**品牌文案不放这里**：它是三端共用的一份，已在 `@shared/constants`，本文件只放「渲染层独有」的东西。

## 2. 导出常量

| 常量 | 值 | 用途与消费方 |
|---|---|---|
| `STORAGE_PREFIX` | `'myapp.'` | 两个键的公共前缀（源码说明：这是首次上线时的 npm 包名） |
| `STORAGE_KEY_PROJECT_CTX` | `STORAGE_PREFIX + 'projectCtx'`（即 `'myapp.projectCtx'`） | 上次打开的项目名。`useAppStore.saveProjectCtx()` 写、`App.vue` 的 `initApp()` 启动时读 |
| `STORAGE_KEY_SETTINGS_SECTION` | `STORAGE_PREFIX + 'settingsSection'`（即 `'myapp.settingsSection'`） | 设置页上次停留的分类。`SettingsPage/index.vue` 用 `readSection()` 读（经页面内别名 `SETTINGS_SECTION_KEY`），并用 `watch(activeSection)` 写 |

### 2.1 值的推导关系

两个键都是 `STORAGE_PREFIX + '<名>'` 的**派生常量**，不是独立字面量：前缀只有一个定义处，因此 `'myapp.'` 不会在两个键上写得不一致。

### 2.2 两个键的读写语义

| 键 | 值形态 | 写入方 | 读取方 | 容错 |
|---|---|---|---|---|
| `STORAGE_KEY_PROJECT_CTX` | `JSON.stringify({ name })`（**只存项目名**；历史值里可能残留的 `builtin` 字段被忽略） | `useAppStore.saveProjectCtx()`（`switchProject()` 内调用） | `App.vue` 的 `initApp()`：`JSON.parse(localStorage.getItem(键) \|\| 'null')`，取到 `saved.name` 才回填 `appState.currentName` | 整段包在 `try/catch` 中，脏数据 / 非 JSON 静默忽略 |
| `STORAGE_KEY_SETTINGS_SECTION` | 设置分类字符串：`'model'` / `'voice'` / `'render'` / `'update'` / `'whisper'` | `SettingsPage/index.vue` 的 `watch(activeSection, v => localStorage.setItem(键, v))` | 同页 `readSection()`：值必须落在 `SECTIONS` 白名单内，否则回退 `'model'` | 读与写各自 `try/catch`（注释说明「隐私模式等场景静默忽略」） |

## 3. 为什么前缀故意不跟随品牌名

这是本文件**最重要的约定**（源码注释原文要点）：

- 前缀 `'myapp.'` 是首次上线时的 npm 包名，与现在的品牌名「影坊 / ShadowMill」**故意不一致**。
- 原因：**prod 下页面走 `file://` 同源，`localStorage` 的键名就是用户数据的地址**。
- 因此把前缀改成 `'shadowmill.'` 之类的「看起来更对」的值，会让老用户的「上次打开的项目」「设置页上次的分类」**全部读不到**——现象是「记忆功能坏了」，而代码本身没有任何报错。

**改前缀必须补迁移**：真要改，必须同时加一段「读旧键 → 写新键」的迁移（读 `'myapp.projectCtx'` 回填后写入新键），不能只改这里的常量或只改某处字面量。这与 `src/main/index.ts` 迁移 `userData` 目录（`my-app` → `shadowmill`）是同一类问题的两种表现。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
|---|---|---|
| 依赖 | 无 | 零 import、零副作用，是纯常量模块 |
| 被 import | `src/renderer/src/App.vue` | `STORAGE_KEY_PROJECT_CTX`（`import { … } from '@renderer/constants'`） |
| 被 import | `src/renderer/src/composables/useAppStore.ts` | `STORAGE_KEY_PROJECT_CTX`（`saveProjectCtx()` 写入） |
| 被 import | `src/renderer/src/pages/SettingsPage/index.vue` | `STORAGE_KEY_SETTINGS_SECTION`（赋给页面内 `SETTINGS_SECTION_KEY` 后读写） |
| 类型归属 | `tsconfig.web.json` | 本文件在渲染层源码根，由渲染层子工程编译 |
| 别名 | `@renderer/*` → `src/renderer/src` | 跨目录导入统一走别名（与项目约定一致）；同目录内部才用相对路径 |

## 5. 注意事项与实现要点

- **键名不可漂移**：`'myapp.projectCtx'` 是既有用户的持久化地址，改动会丢上下文记忆；本文件只是把「唯一真源」收到一处，**不是**授权改名的入口。
- **改前缀需要迁移，不是改常量**：如上节所述，只改常量等于静默丢数据。
- **纯常量、零开销**：打包器会把常量内联进引用处，运行时没有额外的模块求值成本。
- **不要在这里放品牌文案**：品牌文案在三端共用的 `src/shared/constants.ts`；本文件承担「渲染层独有约定」，避免同一份字符串出现两处来源。
- **新增渲染层常量时**：能派生的就派生（如本文件的两个键都基于 `STORAGE_PREFIX`），并在此处补一行说明与消费方，保持「一处定义」的性质。
