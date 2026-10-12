# src/renderer/src/constants.ts

> 渲染层公共常量：`localStorage` 键名前缀与两个持久化键的唯一定义处，以及自定义模型（HTML 生成 Agent）的 Base URL / 模型预设表

- **所在目录**：`src/renderer/src/`
- **类型**：渲染层常量 + 类型（纯字面量、常量派生与一条预设表，无 import、无副作用）
- **规模**：59 行
- **对外导出**：`STORAGE_PREFIX`、`STORAGE_KEY_PROJECT_CTX`、`STORAGE_KEY_SETTINGS_SECTION`（3 个字符串常量）、`interface ProviderPreset`、`MODEL_PROVIDERS: ProviderPreset[]`（4 条服务商预设：DeepSeek / 阿里云百炼 / 智谱 GLM / MiniMax）

## 1. 作用与职责

本文件集中渲染层自己的约定，两类：

1. **`localStorage` 键名**（原有）。此前 `'myapp.projectCtx'` 在 `App.vue` 与 `useAppStore.ts` 两处各写一遍字面量、`'myapp.settingsSection'` 写在 `SettingsPage/index.vue` 里，「同一个键散落多处」没有任何编译期提示。
2. **自定义模型的服务商预设**（`MODEL_PROVIDERS`）。设置页「自定义模型」的 Base URL / 模型 ID 由手填输入框改为下拉预设（保留手填兜底），**预设表放这里**——它是跨文件的字面量，且将来别的入口（如首次配置向导）也可能复用；设置页只负责把表渲染成 `HfSelect` 的分组选项（见 [pages/SettingsPage.md](./pages/SettingsPage.md) §2.2 / §2.3）。

它与 `@shared/constants` 的分工（源码头部注释写明）：

| 文件 | 放什么 | 谁消费 |
|---|---|---|
| `src/shared/constants.ts` | 品牌文案（应用名 / 英文名 / 口号）、出网 User-Agent | main + preload + 渲染层 + 构建配置 |
| **本文件** | **渲染层自己的约定**（`localStorage` 键名 + 服务商预设表） | 仅渲染层 |

**品牌文案不放这里**：它是三端共用的一份，已在 `@shared/constants`，本文件只放「渲染层独有」的东西。

## 2. 导出常量（`localStorage` 键名）

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

## 3. 服务商预设（`ProviderPreset` / `MODEL_PROVIDERS`）

### 3.1 类型

```ts
export interface ProviderPreset {
  key: string
  label: string
  baseUrls: string[]
  models: string[]
}
```

`baseUrls` 是**纯 URL 字符串数组**：`HfSelect` 的选项 `label` 直接取 URL 本身，设置页把它整条映射成选项（见 [pages/SettingsPage.md](./pages/SettingsPage.md) §2.2.1）。早前的 `{ url; note; disabled? }` 对象与「Anthropic 灰项」已一并删除，理由见 §3.3 最后两条。

> `HfSelect` 组件**本身仍然支持** `HfSelectOption.disabled`（不可点选的选项行，[components.md](./components.md)），只是本表不再用它——组件能力与预设表的设计取舍是两件事。

### 3.2 四条预设（源码直录）

| `key` | `label` | `baseUrls` | `models` |
|---|---|---|---|
| `deepseek` | `DeepSeek` | `https://api.deepseek.com`（单条） | `deepseek-flash`、`deepseek-v4-pro` |
| `bailian` | `阿里云百炼` | `https://dashscope.aliyuncs.com/compatible-mode/v1`（单条） | `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash` |
| `zhipu` | `智谱 GLM` | `https://open.bigmodel.cn/api/paas/v4`（单条；官方写法带结尾斜杠，本表**刻意不带**，见 §3.3） | `glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.2`、`glm-5.1`、`glm-5` |
| `minimax` | `MiniMax` | `https://api.minimax.cn/v1`（单条） | `MiniMax-M3.1-Flash-Preview`、`MiniMax-M3`、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`、`MiniMax-M2.5`、`MiniMax-M2.5-highspeed`、`MiniMax-M2.1`、`MiniMax-M2.1-highspeed`、`MiniMax-M2` |

四条预设的 `baseUrls` 现在**都是只有一个元素的字符串数组**，没有任何补充说明字段——选项文字就是 URL 本身。

### 3.3 这张表**不是白名单**（源码注释的核心约定）

- **只是「常见取值」的快捷方式**：模型名会被服务商下线或改名（例：DeepSeek 已下线 `deepseek-v4-flash` 等旧名，只保留 `deepseek-flash` / `deepseek-v4-pro`），所以**界面上必须保留「自定义」手填**；本表过时也不会把用户锁死，只是少几个快捷项。
- **只列有依据的名字**：能查到官方原文的才列，查不到的（如百炼上的第三方模型署名规则）不列，交给「自定义」手填——**写错就是运行期 404 model not found**。**例外要如实标注**：智谱的 `glm-5.2` / `glm-5.1` / `glm-5` 是**推断**的（见下条），不假装确定。因此 `models` 是「常用档位」而非「全部可用模型」。
- **注释记录了来源与核对时间**（2026-10 核对）：DeepSeek `https://api-docs.deepseek.com/zh-cn/quick_start/pricing`、阿里云百炼 `https://help.aliyun.com/zh/model-studio/models`、智谱 `https://docs.bigmodel.cn/cn/guide/start/model-overview`、MiniMax `https://platform.minimax.cn/docs/guides/text-generation`。维护本表时应同步更新这些来源与核对时间。**抓取提示**：智谱与 MiniMax 的文档站都提供 `.md` 版本（在页面 URL 后加 `.md`），没有侧边栏导航、代码块不会被截断，比抓 HTML 页可靠得多（HTML 页的代码块曾连续 6 次落在截断处之后）。
- **智谱：编码来源 + 两处注意**。编码有官方原文的是 `glm-5.3`（迁移页 checklist「更新模型编码为 `glm-5.3`」、示例 `model="glm-5.3"`）与 `glm-5.3-flash` / `glm-5.3-flashx`（Flash 页原文「Model Code：`glm-5.3-flash/glm-5.3-flashx`」）；`glm-5.2` / `glm-5.1` / `glm-5` 不在当前「推荐模型」表里，编码是**推断**的（未在官方文档中查到），要用「测试连接」或控制台核对。① 智谱**强制开启思考**（`thinking.type` 只支持 `enabled`、不支持禁用），但流式仍回传 `delta.reasoning_content` / `delta.content`，与 `htmlAgent` 的解析字段一致，所以能直接跑；② **智谱的 base URL 已确认为** `https://open.bigmodel.cn/api/paas/v4/`（官方写法**带结尾斜杠**，由使用者核对后提供）；本表**刻意存成不带结尾斜杠**——本项目两条消费路径最终都是「baseUrl + `/chat/completions`」，带斜杠会拼出双斜杠 `.../v4//chat/completions`（服务端会不会拒绝未验证，但没必要冒这个险），不带斜杠则两条路都拼得干净。**「不存结尾斜杠」这条约定适用于将来新增的每一家**：接口文档给的是带斜杠写法时照此去掉再存。
- **MiniMax：9 个编码全部照抄官方原文，且大小写敏感**（`MiniMax-M2.7-highspeed`，不是 `minimax-m2.7-hs` 之类），官方 OpenAI 兼容 base_url 就是 `https://api.minimax.cn/v1`（其 curl 示例为 `.../v1/chat/completions`，与本项目「baseUrl + `/chat/completions`」拼法一致）。三处注意：① 官方注明 **`MiniMax-M3.1-Flash-Preview` 暂时仅通过 M Plan 和 MiniMax Code 提供**——普通按量付费 API Key 可能调不通，**这不是编码写错了**；② 官方同时给出 Anthropic 兼容端点 `https://api.minimax.cn/anthropic` 并且**推荐**那条，本应用不支持，因此**不列入本表**（理由见本节最后两条；官方首推它这一点正是需要留意的地方——使用者若照官方文档抄了那条，应用用不了）；③ MiniMax **同样不支持关闭思考**（传 `thinking:{"type":"disabled"}` 或 `effort:"none"` 返回 400），但思考内容也走 `reasoning_content`，与 `htmlAgent` 的解析字段一致。
- **只列 OpenAI 格式的端点**：本应用**只实现了 OpenAI 格式**，所以表里只放该家的 OpenAI 兼容 base URL，**Anthropic 格式的端点一条都不列**（DeepSeek 与 MiniMax 都有、MiniMax 官方还首推它）。理由：这不是「漏了」——卡片提示已经写明「只支持 OpenAI 格式的端点，Anthropic 格式暂不支持」，再在下拉里列两个灰项属于**同一句话说两遍**（用户此前对「OpenAI 兼容模式」重复出现的同类反馈，见 [pages/SettingsPage.md](./pages/SettingsPage.md) §5.24）；只显示能用的端点，**每家的下拉就只有一条、没有可纠结的选项**。
- **Base URL 每家用一条官方写法**：DeepSeek 的 OpenAI 格式同时接受带与不带 `/v1` 两种拼法，属**同一格式的写法差异**，所以**只列一条、不并列**（并列会让用户以为要在两条里挑一条"更对的"）；百炼兼容模式的 `/v1` 则是它路径的**固定组成部分**、不是可选项，照原样保留。既然没有 `note` 字段，设置页就把 URL 本身当选项文字（不再拼接任何说明），见 [pages/SettingsPage.md](./pages/SettingsPage.md) §2.2.1。

## 4. 为什么前缀故意不跟随品牌名

这是本文件**最重要的约定**（源码注释原文要点）：

- 前缀 `'myapp.'` 是首次上线时的 npm 包名，与现在的品牌名「影坊 / ShadowMill」**故意不一致**。
- 原因：**prod 下页面走 `file://` 同源，`localStorage` 的键名就是用户数据的地址**。
- 因此把前缀改成 `'shadowmill.'` 之类的「看起来更对」的值，会让老用户的「上次打开的项目」「设置页上次的分类」**全部读不到**——现象是「记忆功能坏了」，而代码本身没有任何报错。

**改前缀必须补迁移**：真要改，必须同时加一段「读旧键 → 写新键」的迁移（读 `'myapp.projectCtx'` 回填后写入新键），不能只改这里的常量或只改某处字面量。这与 `src/main/index.ts` 处理 `userData` 的方式是同一类问题的两种表现：userData 目录名跟随 `package.json` 的 `name`，改名后靠启动时的「归属证明 + 用户确认式迁移」把老目录内容搬过来（那里同样要**手动登记旧目录名** `LEGACY_DIR_NAMES`）——两者都是「地址一旦变化，必须有认领 / 迁移机制，否则等于静默丢用户数据」（见 [main/index.ts.md](../../main/index.ts.md) §3.1）。

## 5. 依赖与协作

| 方向 | 对象 | 说明 |
|---|---|---|
| 依赖 | 无 | 零 import、零副作用，是纯常量 / 纯数据模块 |
| 被 import | `src/renderer/src/App.vue` | `STORAGE_KEY_PROJECT_CTX`（`import { … } from '@renderer/constants'`） |
| 被 import | `src/renderer/src/composables/useAppStore.ts` | `STORAGE_KEY_PROJECT_CTX`（`saveProjectCtx()` 写入） |
| 被 import | `src/renderer/src/pages/SettingsPage/index.vue` | `STORAGE_KEY_SETTINGS_SECTION`（赋给页面内 `SETTINGS_SECTION_KEY` 后读写）+ `MODEL_PROVIDERS`（构建 Base URL / 模型 ID 两个下拉的分组选项） |
| 类型归属 | `tsconfig.web.json` | 本文件在渲染层源码根，由渲染层子工程编译 |
| 别名 | `@renderer/*` → `src/renderer/src` | 跨目录导入统一走别名（与项目约定一致）；同目录内部才用相对路径 |

## 6. 注意事项与实现要点

- **键名不可漂移**：`'myapp.projectCtx'` 是既有用户的持久化地址，改动会丢上下文记忆；本文件只是把「唯一真源」收到一处，**不是**授权改名的入口。
- **改前缀需要迁移，不是改常量**：如上节所述，只改常量等于静默丢数据。
- **`MODEL_PROVIDERS` 不是白名单、也不是校验依据**：设置页不用它校验用户输入，只用它生成快捷选项；用户手填的任意 Base URL / 模型名都必须能保存与使用（否则自建网关 / 中转站 / 未收录服务商全被锁死）。
- **预设表可以过时，但不能写错**：`models` 里每加一个名字都要能对着上节的两个官方来源核对；拿不准就不加。表过时的表现只是「少一个快捷项」，写错的表现是用户按提示选完却在运行期 `404 model not found`。
- **不用「格式 / 协议」标注，也不列不支持的端点**：`baseUrls` 里只有 URL 字符串、没有任何标注字段——格式（= API 协议）决定这条路能不能走通，而本应用只支持 OpenAI 格式，列出来的每一条都必然是能用的；**不要引入「OpenAI 兼容模式」这类无信息量的标签**（判据见 [pages/SettingsPage.md](./pages/SettingsPage.md) §5.24），也不要为了「告知存在」而把不支持的端点列成灰项（提示已经在卡片文字里写过了）。新增条目时先确认「官方给的 OpenAI 兼容 base URL 是什么」，只加这一条；带结尾斜杠的照 §3.3 的约定去掉再存。
- **纯常量、零开销**：打包器会把常量内联进引用处，运行时没有额外的模块求值成本。
- **不要在这里放品牌文案**：品牌文案在三端共用的 `src/shared/constants.ts`；本文件承担「渲染层独有约定」，避免同一份字符串出现两处来源。
- **新增渲染层常量时**：能派生的就派生（如本文件的两个键都基于 `STORAGE_PREFIX`），并在此处补一行说明与消费方，保持「一处定义」的性质。
