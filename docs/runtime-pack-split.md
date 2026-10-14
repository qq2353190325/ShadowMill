# 运行环境分包方案（ffmpeg / hyperframes 移出安装包）

> 状态：**设计文档（待实施）**。本文是这次改造的唯一清单来源，实现按本文逐条落地；落地情况回写 `CHANGELOG.md`。
> 最后更新：2026-10-14。涉及源码：`scripts/pack-runtime.mjs`、`src/main/runtime.ts`、`src/main/hfEnv.ts`、`src/main/whisper.ts`、`src/main/video.ts`、`src/main/projects.ts`、`src/main/ttsAlign.ts`、`src/main/updater.ts`、`src/shared/{ipc,types}.ts`、`src/preload/index.ts`、`src/renderer/**`、`package.json`。

---

## 1. 为什么改

### 1.1 现状（实测）

| 对象 | 体积 | 说明 |
|---|---|---|
| `resources/ffmpeg/` | 179.9 MB | FFmpeg 8 系列（`avcodec-63.dll` 112.8 MB 是最大单体） |
| `resources/hyperframes/` | 439.9 MB | 其中 `chrome/chrome-headless-shell` 268.6 MB、`node_modules` 171.3 MB |
| `resources/whisper/` | 12.5 MB（15 文件，gzip-9 后 4.4 MB） | `whisper-cli.exe` + 8 个 `ggml-cpu-*.dll` + `SDL2.dll` 等 |
| 合计 | **632.3 MB / 4916 文件** | 与 `build/runtime-pack/runtime.json` 的 `files` / `unpackedBytes` 一致 |
| 打包产物 | `runtime.7z` 147.4 MB（`bytes` 154,536,415） | 单一固实包 |
| NSIS 安装包 | 257.6 MB | 含 `runtime.7z`（压缩后约 90 MB）+ Electron 体 + `extraResources` |

### 1.2 问题

1. **安装包体积的大头（约 90 MB）来自用户可能根本用不到的功能**：只有「转成视频」需要 hyperframes，只有「转录 / 转码」需要 ffmpeg。
2. **「整体重装」与「差量更新」的边界不干净**：`runtime.7z` 每次发版即便内容没变也占安装包的重量；而它一变，客户端就要重下整包（哪怕只改了 hyperframes 里的一个文件）。
3. **whisper 只有 4.4 MB（压缩后），却因为「在运行时包里」而让转录功能也变成「首次要等下载」**——它本该装完即用。

### 1.3 目标

- 安装包只带**代码 + whisper**：装完即用（转录/配音/字幕/HTML 生成等本地功能全部可用，不需要联网下载）。
- **ffmpeg** 与 **hyperframes** 各自独立成包，首次用到时下载；两者**独立升级、独立校验**，互不牵连。
- 用户在任何环节都**能取消**：取消 = 不下载，且**发起该操作的动作也一并取消**（不留半途状态）。
- 每个消费点在做重活之前**先校验存在性**，缺就提示（含体积），而不是默默等下载。

---

## 2. 目标分包模型

| 包 | 内容 | 未压缩 | 预计 7z | 变化频率 | 依赖它的功能 |
|---|---|---|---|---|---|
| **（安装包本体）** | `out/` + `app.asar` + **`resources/whisper/`** | 0.7 + 24.7 + 12.5 MB | 约 4.4 MB（whisper 部分） | 每版都变（代码） | 全部本地功能 |
| **`ffmpeg`** | `ffmpeg/` | 179.9 MB | 约 55-60 MB | 中 | ① 渲染（hyperframes 通过 `HYPERFRAMES_FFMPEG_PATH` / PATH 调用）② 转录的格式转换与 VAD（`whisper.ts`）③ 逐句对齐、素材提取（`ttsAlign.ts` / `projects.ts` / `voice.ts`） |
| **`hyperframes`** | `hyperframes/` | 439.9 MB | 约 60-70 MB | 中 | 只渲染（`video.ts`） |

### 2.1 为什么这么分（关键决策依据）

- **ffmpeg 与 hyperframes 没有版本硬绑定**：hyperframes 0.8.33 的 `dist/cli.js`（`FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH"`、`FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH"`）只校验**注入的路径是否存在**（`assertConfiguredFfmpegBinariesExist()`），不校验版本。故两者可各自独立升级。
- **ffmpeg 被两条互不相关的线共用**（转录链 + 渲染链），因此不能挂在 hyperframes 名下，否则改渲染引擎会逼着转录功能重下包。
- **whisper 必须离线可用**：它是「文字转字幕」的唯一天然依赖，且只有 4.4 MB；放进安装包换来「装完即可转录」，性价比最高。
- **代价（要写在验收里）**：拆成两个 7z 会失去跨目录的固实压缩优势，两包字节之和预计比现在单包 147.4 MB **多 5~15 MB**。这是分包的固有代价，换来的是「以后只下变过的那一份」。

### 2.2 落地形态（磁盘布局）

```
<resources>/                                  ← 安装包（extraResources）
├─ whisper/                                   ← 随安装包，永远可用
├─ tools/7za.exe                              ← 解包器，随安装包（约 1 MB）
└─ app-update.yml

<userData>/runtime/                           ← 运行时包解包区（可被整体删除，删了只会触发重下）
├─ packs.json                                 ← 各包状态（见 §4.3）
├─ ffmpeg/        ── 解包结果（ffmpeg/bin/...）
│   └─ ok.json
├─ hyperframes/   ── 解包结果（hyperframes/node_modules/...）
│   └─ ok.json
└─ downloads/     ── 已下载的 .7z 缓存（可保留作下次复用）
```

**每个包解到自己的目录**，不再需要「复合 id」：换 ffmpeg 不影响 hyperframes 目录，两者互不触发重解。

---

## 3. 改动清单（按文件）

> 表格里的「行号」为动稿前的参考位置，实施时以内容为准。

### 3.1 `scripts/pack-runtime.mjs`（产包）

| # | 改动 | 说明 |
|---|---|---|
| 1 | 由「打一个包」改为「按包定义循环打」 | 包定义：`PACKS = [{ name:'ffmpeg', roots:['ffmpeg'] }, { name:'hyperframes', roots:['hyperframes'] }]` |
| 2 | `EXCLUDE_TOP` 由 `[]` 改为 `['whisper']` | whisper 不再进任何包（它随安装包） |
| 3 | 产物改名 | `build/runtime-pack/ffmpeg.7z` + `ffmpeg.json`、`hyperframes.7z` + `hyperframes.json`；旧的 `runtime.7z` / `runtime.json` 删除 |
| 4 | **修缓存指纹**（现在的隐患） | 现 `sourceKey = files + ':' + bytes + ':' + maxMtime` 只看整棵 `resources/` 树的统计量，`EXCLUDE_TOP` 变化时 key 不变 ⇒ 会误判「没变」而继续用旧包。改为按包计算、且把条目列表计入：`<包名>:<roots 排序后拼接>:<files>:<bytes>:<maxMtime>`，扫描范围限定在该包的子集 |
| 5 | 清单字段 | 每包独立：`id`（内容 sha512 前 12 位）/ `file` / `sha512` / `bytes` / `files` / `unpackedBytes` / `sourceKey` / `appVersion` / `createdAt`（字段名与 `RuntimeManifest` 保持一致） |
| 6 | 保留 | `-mx=9 -mmt=on -mtm/-mta/-mtc=off`（**内容相同 ⇒ 字节完全相同 ⇒ `id` 不变**，这是「不重复下载」的判定依据，不要动） |
| 7 | 日志 | 每包打印：打包目录、用时、`bytes`、`unpackedBytes`、`files`、`id` |
| 8 | 用法 | 支持 `--only <name>` 只重打某个包（本地调试用），`--force` 语义不变 |

### 3.2 `package.json`

| # | 改动 |
|---|---|
| 1 | `build.extraResources` 去掉 `{"from":"build/runtime-pack","to":"runtime-pack"}` |
| 2 | 新增 `{"from":"resources/whisper","to":"whisper"}` |
| 3 | 保留 `{"from":"build/tools","to":"tools"}`（7za，约 1 MB；解包器不能也靠下载） |
| 4 | 新增脚本 `"runtime:pack": "node scripts/pack-runtime.mjs"`（已有，语义变为「打全部包」） |
| 5 | 预期安装包：257.6 MB → **约 145-150 MB**（其中已含 `electronLanguages` 省下的约 38 MB） |
| 6 | 可选（推荐）：`"release": "node scripts/release.mjs"`，见 §8 |

### 3.3 `src/main/runtime.ts`（本轮改动最大）

| # | 改动 | 说明 |
|---|---|---|
| 1 | 引入包注册表 | `PACKS`：`{ name, need: ('transcribe'\|'render')[], title, approxBytes }`；`ffmpeg` 同时服务两种需求，`hyperframes` 只服务渲染 |
| 2 | 状态文件由「单指针」改为「多包状态」 | `<userData>/runtime/packs.json`：`{ packs: { ffmpeg: { id, files, unpackedBytes, at }, hyperframes: {...} }, legacy?: {...} }`（见 §4.3） |
| 3 | 每包独立标记与目录 | `<userData>/runtime/<packName>/ok.json` + 解包直落该目录 |
| 4 | `ensureRuntime(needs?)` 拆成三个函数 | ① `packsStatus()`：**纯探测**，不下载不阻塞（供消费点校验）② `ensurePacks(packs, opts)`：下载 + 解包（带进度与取消）③ `prepareInBackground()`：启动时的静默预下载（见 §5.3） |
| 5 | 下载 | `fetchRemotePack(pack)` 按包名 GET `<feed>/<pack>.json` 与 `<pack>.7z`；**新增 `Range` 断点续传**（`.part` 落盘 + 完成后复核 sha512 再改名），传输中断不清残片 |
| 6 | 取消 | 引入 `AbortController`/`aborted` 标志；`cancelPrepare()` 中断进行中的下载与 `7za` 子进程（`child.kill()`），并清掉 `.part` 与半解目录 |
| 7 | 解包器定位 | `resolveSevenZip()` 不变（`<resources>/tools/7za.exe`；dev 为 `build/tools/`） |
| 8 | 失败文案 | 现「既没有找到随安装包携带的 runtime-pack…」**必须重写**——安装包里以后永远没有这两个包，文案改成「需要联网下载（xx MB）+ 可重试」 |
| 9 | `localPackDir()` | 由「单包清单目录」改为「按包名解析」：`SHADOWMILL_RUNTIME_PACK` 语义保留（dev 自测：指向含 `<pack>.json` 的目录） |
| 10 | GC | 换包后清旧目录；`downloads/` 只保留**当前各包 id 对应的那一份**，其余删除 |
| 11 | 进度载荷 | `RuntimeProgressPayload` 增加 `pack`（当前包名）、`packs`（本次需要的包名）、`cancellable`、`percentOverall`；`stage` 增加 `cancelled` |

### 3.4 `src/main/hfEnv.ts`

| # | 改动 | 说明 |
|---|---|---|
| 1 | `resolveRoot()` 的语义变化 | 现在返回「一个包含 ffmpeg + hyperframes + whisper 的根」；分包后**单项资源各自解析**：`ffmpeg`/`ffprobe`/`ffmpegBin` 指向 `<userData>/runtime/ffmpeg/ffmpeg/bin`，`hfCli`/`hivePlayer`/`chromeShell` 指向 `<userData>/runtime/hyperframes/hyperframes/…`，`root` 仅作为兜底（dev / 旧布局） |
| 2 | 缓存失效 | `refreshBuiltinResources(root?)` 现在清一个全局缓存；改为按包失效（`refreshPack('ffmpeg')` / `refreshPack('hyperframes')`），或干脆每次读 `packs.json` + 进程内缓存两项 |
| 3 | 新增纯查询 | `packReady('ffmpeg'\|'hyperframes')`：只查 `ok.json` 与关键可执行文件是否存在，供消费点校验（不触发下载） |
| 4 | 不再引用 whisper | whisper 的路径解析搬回 `whisper.ts`（见 §3.5） |

### 3.5 `src/main/whisper.ts`

| # | 改动 | 说明 |
|---|---|---|
| 1 | **查找顺序调正**（重要） | 现在：`BUILTIN_RESOURCES.root/whisper` → `process.resourcesPath/whisper` → `app.getAppPath()/resources/whisper`。改为：**`process.resourcesPath/whisper` 优先** → `BUILTIN_RESOURCES.root/whisper`（兜底）→ dev 的 `app.getAppPath()/resources/whisper`。原因：whisper 现在随安装包（`extraResources`），而 `resolveRoot()` 指向的是某个运行时包目录，`<那个 root>/whisper/` 反而不存在 |
| 2 | 转录前的等待改为校验 | 现在 `await runtime.ensureRuntime()`（可能默默等下载）；改为 `packsStatus()` 校验，缺包则直接返回「需要先下载运行环境」，不再阻塞 |
| 3 | 报错文案 | 两处「打包后自动随应用携带」改为真实情况（whisper 随安装包 ⇒ 若无则安装包损坏，提示重装） |
| 4 | ffmpeg 依赖 | `vadTrim` / `convertToWav` 用到的 `BUILTIN_RESOURCES.ffmpeg` 走上表 §3.4 的新解析；缺 ffmpeg 时报「需要下载 ffmpeg 运行环境（约 60 MB）」，而不是「未找到内置 ffmpeg」 |

### 3.6 消费点（`video.ts` / `projects.ts` / `ttsAlign.ts` / `voice.ts`）

统一模式（四处同构）：

```ts
// 原来是：await runtime.ensureRuntime()   ← 可能静默等待下载
// 现在先纯校验，缺包立刻返回，让界面去问用户
const need = ['ffmpeg', 'hyperframes']            // video:render
const missing = runtime.packsStatus().missing(need)
if (missing.length) {
  return { ok: false, needPacks: missing,                       // 渲染层据此弹确认框
           message: '渲染需要先下载运行环境（' + runtime.packSizeText(missing) + '）' }
}
```

| 文件 | 位置 | 需要的包 |
|---|---|---|
| `video.ts` | `video:render` 入口 | `ffmpeg` + `hyperframes`（`HF_NEEDS`） |
| `projects.ts` | `project:extract-video-audio` | `ffmpeg` |
| `ttsAlign.ts` | 逐句对齐 / 合成对齐 | `ffmpeg` |
| `voice.ts` | 参考音频裁剪（ffmpeg / ffprobe） | `ffmpeg` |
| `whisper.ts` | `whisper:transcribe` | 无（whisper 随包）＋ 格式转换时 `ffmpeg` |

返回体在 `src/shared/types.ts` 各结果类型上加可选字段 `needPacks?: RuntimePackName[]`。

### 3.7 IPC / preload / 类型

| # | 改动 |
|---|---|
| 1 | `shared/ipc.ts`：`Runtime` 增加 `Cancel: 'runtime:cancel'`；`Runtime.Prepare` 载荷由「无参」改为 `packs?: RuntimePackName[]`（省略 = 全部） |
| 2 | `shared/types.ts`：新增 `RuntimePackName = 'ffmpeg' \| 'hyperframes'`；`RuntimeProgressPayload` 增字段（见 §3.3#11）；各业务结果类型加 `needPacks?` |
| 3 | `preload/index.ts`：`runtimeTools` 增加 `cancel()`；`prepare(packs?)` 透传 |
| 4 | 频道计数：`Runtime` 由 3 个（2 handle + 1 推送）变 4 个 ⇒ **`shared/ipc.ts` 的频道常量总数由 83 变 84**，wiki 里记录的频道数要同步 |

### 3.8 渲染层（`App.vue` 横幅 / `SettingsPage` / `useRuntime` / 各页面确认框）

见 §6。

### 3.9 发布脚本与文档

| # | 改动 |
|---|---|
| 1 | 新增 `scripts/release.mjs`：上传安装包 + `.exe.blockmap` + `latest.yml` + `ffmpeg.{7z,json}` + `hyperframes.{7z,json}`；按内容 id 命名上传（见 §8） |
| 2 | wiki：`02-目录架构-src-main.md`、`files/main/runtime.ts.md`、`files/main/hfEnv.ts.md`、`00-项目结构.md`、`01-架构总览.md`、`files/main/{video,whisper,projects,ttsAlign}.ts.md`、`files/renderer/src/{App.vue,common}.md` 按新模型整体重写（交给后台 subagent，一次读一次重写） |
| 3 | `CHANGELOG.md`：本次拆分的每步各记一条 |

---

## 4. 运行时状态模型

### 4.1 三个函数的分工

| 函数 | 是否阻塞 | 是否联网 | 用途 |
|---|---|---|---|
| `packsStatus()` | 否（同步探测） | 否 | 消费点校验、界面显示「已就绪 / 需下载」 |
| `ensurePacks(packs, { silent, signal })` | 是（带进度/取消） | 是 | 用户确认后真正下载 + 解包 |
| `prepareInBackground()` | 否（fire-and-forget） | 是 | 首次安装的**静默**预下载（见 §5.3） |

### 4.2 消费点的三态

```
查 packsStatus(need)
├─ 全部就绪           → 照常执行
├─ 缺失且可下载       → 返回 needPacks（不下载！）→ 界面确认（§6）
└─ 缺失且 feed 不可用 → 返回 needPacks + 明确原因（离线 / 未配置更新源）
```

### 4.3 `packs.json` 结构

```jsonc
{
  "version": 1,
  "packs": {
    "ffmpeg":      { "id": "r1a2b3c4d5e6f", "sha512": "…", "files": 9,   "unpackedBytes": 188692480, "at": "2026-10-14T…" },
    "hyperframes": { "id": "r9f8e7d6c5b4a", "sha512": "…", "files": 4907, "unpackedBytes": 461373440, "at": "2026-10-14T…" }
  },
  "legacy": { "id": "r71989f11fe2a", "root": "runtime/r71989f11fe2a", "at": "2026-…" }   // 见 §7
}
```

判定「某包已就绪」需同时满足：`packs[name].id` 存在 **且** `<userData>/runtime/<name>/ok.json` 存在 **且** 该包的关键文件存在（`ffmpeg`：`ffmpeg/bin/ffmpeg.exe` + `ffprobe.exe`；`hyperframes`：`hyperframes/node_modules/hyperframes/bin/hyperframes.mjs` + 找到 `chrome-headless-shell.exe`）。三者缺一即视为「未就绪」并触发重下。

---

## 5. 首次安装与下载流程

### 5.1 首次启动（安装包只带 whisper）

1. `register()` 装配后调用 `prepareInBackground()`。
2. 它先 `packsStatus()`：
   - 两包都缺 ⇒ 进入**静默下载**（默认策略，见 5.3），界面顶部横幅显示细进度条（可取消）；
   - 有包已就绪 ⇒ 只下缺的那个；
   - `feed` 不可达 ⇒ **不报错、不弹窗**，只把状态置为 `missing`（文案「运行环境需要联网下载」+ 重试按钮），不影响任何本地功能。
3. 用户此时可以正常使用：项目、音色、配音、转录、字幕、HTML 生成**全部可用**（whisper 随包、不再依赖下载）。

### 5.2 使用到缺失环境的功能（校验 → 提示 → 取消/继续）

以「转成视频」为例：

```
用户点「转成视频」
→ video:render 先 packsStatus(['ffmpeg','hyperframes'])
→ 缺包：立刻返回 { ok:false, needPacks:['ffmpeg','hyperframes'], message:'渲染需要先下载运行环境（约 130 MB）' }
→ 渲染层弹确认框： [立即下载并继续]  [取消]
├─ 取消  → 不下载、不发后续 IPC，操作终止（界面回到「未开始」）；横幅/设置页保留「需要下载」状态与重试入口
└─ 确认  → runtimeTools.prepare(['ffmpeg','hyperframes']) → 横幅显示下载/解包进度（可取消）
          → 两包就绪后：界面提示「运行环境已就绪，请重新点击『转成视频』」
             （也可选择自动重放一次原操作；默认**不自动重放**，避免用户已改变意图）
```

- **「用户可以取消，取消就是不下载，然后该操作也取消」** 的落点就是上面这条分支：取消**不产生任何下载**，**也不继续原操作**，且**不留下半截状态**（不写 `packs.json`、不留 `.part`、不留半解目录）。
- 下载途中按「取消」（横幅 / 设置页的取消按钮）等价于同一条路径：中断 + 清残片 + 状态回到 `missing`；原操作早已结束，不需要额外回滚。

### 5.3 静默下载的策略（可配置）

| 场景 | 行为 |
|---|---|
| 首次安装启动、`feed` 可达 | **静默后台下载两包**（横幅显示细进度，可取消） |
| dev 环境（`app.isPackaged === false`） | 不静默下载（走项目根 `resources/`，本来就是展开形态） |
| 用户设置里关掉「自动准备运行环境」 | 不静默下载，只在用到时按 §5.2 询问 |
| 更新源不可达 / 离线 | 不重试风暴：失败后进入 `missing`，仅在用户点重试或再次使用相关功能时重试 |

> 新增设置项建议放 `settings.json` 的 `runtime.autoPrepare`（默认 `true`），设置页文案：「启动后自动在后台准备运行环境（ffmpeg / hyperframes，约 130 MB）」。

### 5.4 下载与解包细节

- **断点续传**：下载写 `<pack>.7z.part`，用 `Range: bytes=<已有长度>-` 续；服务端返回 `206` 才续，返回 `200` 则从头覆盖。完成后复核 sha512（base64）再重命名为 `<pack>.7z` —— 与清单不符即删除并报错。
- **复用**：`downloads/<pack>-<id>.7z` 已存在且 sha512 相符 ⇒ 直接解包，不重复下载。
- **解包**：`7za x <pack>.7z -o<userData>/runtime/<name> -y -bsp1`（`-bsp1` 的百分比驱动进度）；解包完成后写 `<name>/ok.json`，再更新 `packs.json`（**先 ok.json 再指针**，与现在同序）。
- **取消**：`AbortController` 断 HTTP；`7za` 子进程 `kill()`；清理 `<name>/` 与 `.part`。
- **磁盘**：解包后 `downloads/` 里只保留当前各包 id 的那份；旧 id 的包与旧解包目录在 GC 里删。

---

## 6. 界面改动

| 位置 | 现状 | 改为 |
|---|---|---|
| 外壳顶部横幅（`App.vue` + `useRuntime.ts`） | 「正在准备运行环境 x%」+ 失败重试 | 增加：① **取消** 按钮（`stage ∈ {downloading, extracting}` 时）② `missing` 态文案「运行环境需要下载（约 130 MB）」+「立即下载」 |
| 设置页运行环境一行（`SettingsPage/index.vue`） | 只在「准备中 / 失败」时占一行 | 增加 `missing` 态（含各包体积与「下载」按钮）与「已就绪（ffmpeg / hyperframes / 各自版本）」的折叠详情；加「自动准备」开关 |
| 各功能页动作（`VideoPage` / `TextSubPage` / `ProjectsPage` 等） | 直接请求，失败后看报错 | 收到 `needPacks` ⇒ 弹确认框（体积 + 「本次需要下载什么」），`[立即下载并继续]` / `[取消]`；下载中显示进度、可取消 |
| 文案 | 「运行环境包（ffmpeg/node/hyperframes/whisper 约 716MB）」等 | 全部改为分项口径：「whisper 随安装包」「ffmpeg 约 60 MB」「hyperframes 约 65 MB」（具体数字以清单实测为准） |

设计规范遵循 `src/renderer/agents.md`（配色、字号刻度、按钮与卡片风格、弹窗样式），不新造视觉语言。

---

## 7. 老用户迁移（0.0.4 → 新版）

现状：老用户 `userData/runtime/<复合 id>/` 是**单体 `runtime.7z`** 解出来的，里面 ffmpeg / hyperframes / whisper 三者俱全，并有 `ok.json` + `current.json`。

处理策略（**目标是升级后不重下 147 MB**）：

1. 启动时 `packsStatus()` 发现两包都没就绪，但检测到 `current.json` + 旧 `ok.json` + 旧目录里 `ffmpeg/bin/ffmpeg.exe` 与 `hyperframes/node_modules/hyperframes/bin/hyperframes.mjs` 都在。
2. 于是把该目录登记为 `legacy`（写进 `packs.json` 的 `legacy` 字段），并将**两包都标记为「由 legacy 满足」**；界面文案：「沿用已安装的运行环境；下次更新时会自动切换到新版分项包」。
3. **什么时候真正切过去**：`ffmpeg` / `hyperframes` 的远端清单 id 与 legacy 内记录的包内容不同时（也就是这两个包真的有更新），才下载对应的那一包并解到 `runtime/<name>/`；此后相关功能走新目录。这样老用户只在「真的有新内容」时付一次下载，而不是升级即重下。
4. `legacy` 目录在两包都切换完成后删除（GC），并在 `packs.json` 里清掉该字段。
5. 若老用户手动删过 `userData/runtime/`，则等同全新安装（走 §5）。
6. `whisper` 从「运行时包里的 `<root>/whisper`」变为「`<resources>/whisper`」：新版安装包已带，故迁移不需要额外动作（旧目录里的那份会被 GC 一并删掉）。

---

## 8. 发布流程（不改则新装用户直接装不起来）

1. **新增 `scripts/release.mjs`**：一次 `npm run dist` 之后上传：
   - `ShadowMill Setup <version>.exe`
   - `ShadowMill Setup <version>.exe.blockmap`（**漏传 = 每次退回全量下载 145 MB+**）
   - `latest.yml`
   - `ffmpeg.7z` / `ffmpeg.json`、`hyperframes.7z` / `hyperframes.json`
2. **命名与去重（推荐）**：包按内容 id 命名上传（如 `ffmpeg-r1a2b3c4d5e6f.7z`），同时在更新源维护固定名 `ffmpeg.json` / `hyperframes.json`（指向当前版本的 id 文件名）。好处：内容不变 ⇒ 不重复上传，且**旧版本客户端也能取到与它清单匹配的那一份**。
3. **OSS 要求**：bucket 公共读（generic provider 匿名 GET）；**必须支持 Range**（断点续传与 electron-updater 差分包都依赖它）。
4. 上传目标目录现为 `publish.url`（`https://chaoming-zhaoling.oss-cn-beijing.aliyuncs.com/MarvisStudio/`），目录里已有 0.0.1~0.0.4 的历史文件，注意不要误删 `latest.yml`。
5. **发版自检（写进 release 脚本的输出）**：`latest.yml` 与安装包 sha512 一致、`.blockmap` 已上传、两个 `pack.json` 可匿名 GET、`Range` 请求返回 206。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 更新源不可达 / 离线 | 渲染与转录转码不可用 | 安装包带 whisper（转录主路径可用）；`missing` 态文案明确、可重试；提供「从本地文件安装运行环境」（选 `ffmpeg.7z` 即可）作为兜底入口 |
| OSS 不支持 Range | 断点续传失效、差分下载失效 | 发布脚本里实测 `Range` 并断言 206（§8.5） |
| 用户在半途退出/断电 | 半解目录、`.part` 残留 | 一律「完成后才写 `ok.json` / 改名」，启动时清理无 `ok.json` 的目录与过期 `.part` |
| 两包版本与代码不匹配 | 渲染报错或成片异常 | `packs.json` 记录各包 id；`Release` 时把「本版期望的包 id」写进 `latest.yml` 之外的 `runtime.json`（固定名，含两包 id），客户端发现清单里的 id 与本机不同即视为需要更新 |
| 磁盘占用（632 MB） | 用户抱怨 | GC 只留当前包；设置页显示占用体积与「清理运行环境」按钮（清理 = 删 `runtime/`，下次用到再下） |
| 拆包后总体积略增（+5~15 MB） | 首装下载量变大 | 已量化并接受；`hyperframes` 包剥离 ffmpeg 后预计 60-70 MB，比原方案（hf 含 ffmpeg）小 |

---

## 10. 实施顺序与验收

### 10.1 顺序

1. `pack-runtime.mjs` 改多包 + 修缓存指纹（顺手修 `EXCLUDE_TOP`）→ 本机重打一次，记录两包真实 `bytes`（**需要用户执行 `npm run runtime:pack`**）。
2. `package.json`：去 `runtime-pack`、加 `whisper` extraResource。
3. `runtime.ts`：包注册表 + `packs.json` + `packsStatus/ensurePacks/cancel` + 断点续传 + 文案。
4. `hfEnv.ts` 按包解析路径；`whisper.ts` 查找顺序调正、等待改校验。
5. 四个消费点改「先校验再返回 needPacks」；`shared/{ipc,types}.ts` + preload 同步。
6. 渲染层：横幅取消按钮 + `missing` 态、设置页分项状态与「自动准备」开关、各功能页确认框。
7. `scripts/release.mjs` + 发版自检。
8. `CHANGELOG.md` 逐条记录；wiki 交给后台 subagent 整体重写（一次读一次重写）。

### 10.2 验收清单

- [ ] `npm run typecheck` 退出码 0。
- [ ] `npm run runtime:pack` 产出两个 7z + 两个 json；重复执行第二次能命中缓存跳过。
- [ ] 安装包体积实测落到 145-150 MB 区间（**由用户跑 `npm run dist`**）。
- [ ] 全新安装（清空 `userData/runtime/`）后：首启静默下载两包、横幅可取消；取消后无 `.part`、无半解目录、`packs.json` 无记录。
- [ ] 断网首启：不报错弹窗，本地功能全可用；用「转成视频」时弹确认框，取消则不下载、操作终止。
- [ ] 下载中断（手动断网 / 关进程）后重启：能续传，最终 sha512 校验通过。
- [ ] 老用户升级：能沿用 legacy 目录、不重下 147 MB（用 `runtime.json` 里被改动的 id 模拟一次真更新，确认只下变的那一包）。
- [ ] 4 个消费点缺包时都返回 `needPacks` 且界面能弹确认框，取消后不产生任何网络请求。
- [ ] 两个包分别更新（只改 hyperframes 的某文件重打）⇒ 只下载 `hyperframes.7z`。
- [ ] `release.mjs` 上传后：`latest.yml` / `.blockmap` / 两份 `pack.json` 可匿名 GET，`Range` 返回 206。

---

## 11. 待定项（实施前确认）

1. **确认框按钮文案与是否自动重放原操作**：本文默认「不自动重放」，用户下载完再点一次（避免意图漂移）。
2. **静默下载是否默认开启**：本文默认开启（可设置里关）。
3. **是否提供「从本地 7z 安装运行环境」入口**：内网/离线机型的兜底，本文建议提供（成本很小：一个文件选择框 + 复用解包路径）。
4. **`hyperframes` 包是否包含 `chrome-headless-shell`**：本方案包含（否则渲染要现场下载浏览器，体积与不确定性更差）。
