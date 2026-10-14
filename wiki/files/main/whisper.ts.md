# src/main/whisper.ts

> whisper.cpp 本地字幕转录 + 模型档位管理。

- **所在目录**：src/main/
- **类型**：主进程业务模块（whisper.cpp 转录 + 模型管理）
- **规模**：729 行
- **对外导出**：`WHISPER_MODELS`、`WHISPER_LANGS`、`MODEL_BASE_URL`、`modelsDir`、`resolveCliPath`、`allModels`、`findModel`、`resolveModelFile`、`unknownModelFiles`、`register`，以及从 `./vad` 复用的 `readWavSamples`、`toVadSamples`、`vadTrimSegments`

## 1. 作用与职责

本模块把 whisper.cpp 的本地命令行（`whisper-cli.exe`）包成一组 Electron IPC 能力：模型档位的「枚举 / 下载 / 删除 / 设为当前」，自定义模型的「增 / 改 / 删」，以及从音频文件到项目字幕文本的完整转录流程。

| 职责 | 实现位置 |
|------|----------|
| 维护内置模型档位枚举与语言选项 | `WHISPER_MODELS`、`WHISPER_LANGS` |
| 统一「内置 + 自定义」的模型视图结构 | `WhisperMeta`、`allModels`、`customToMeta` |
| 定位 `whisper-cli.exe`（**随安装包**优先，旧布局与开发态兜底） | `resolveCliPath` |
| 模型文件下载（国内镜像、`\.part` 边下边写、原子 rename） | `httpGetFollow`、`downloadFile`、`whisper:download` |
| 转录前音频预处理（不受支持格式经 ffmpeg 转 16kHz 单声道 wav） | `prepareAudio`、`WHISPER_AUDIO_EXTS` |
| 调 whisper-cli 并解析 `-oj` 输出的 JSON | `runCli`、`parseWhisperJson` |
| 繁体转简体（惰性加载 opencc-js，失败降级） | `loadT2s` |
| 段尾静音裁剪（能量 VAD） | `toVadSamples` + `vadTrimSegments` |
| 全部 `whisper:*` IPC 注册与进度回推 | `register`、`emit` |

模块**不直接写项目字幕文件**：转录结果返回给渲染层弹窗，由用户选择「替换现有 / 追加到末尾」后，再统一走 `project:save-subtitle` 落盘。

## 2. 内置模型档位枚举（`WHISPER_MODELS`）

枚举规则：**id ↔ 文件名严格一一对应登记**，只认各自登记的文件名，不做前缀或模糊归属推断，因此 `base` 与 `base-q5_1` 是两个相互独立的档位；枚举外的文件名一律视为「未知模型」，可由用户添加为自定义模型。

| id | 文件名（`file`） | 体积（`sizeMB`） | 速度（`speed`） | 说明（`desc`） |
|----|------------------|------------------|-----------------|----------------|
| `tiny-q8_0` | `ggml-tiny-q8_0.bin` | 43.5 | 最快 | 极小体积量化模型（q8_0），速度最快，适合快速出稿、长音频粗剪与低配机器 |
| `base` | `ggml-base.bin` | 148 | 快 | 多语言基础模型（未量化），识别质量优于 tiny 档，适合日常转录 |
| `base-q5_1` | `ggml-base-q5_1.bin` | 59.7 | 快 | base 的 q5_1 量化版，体积约为 base 的四成，质量接近，适合常规字幕生成 |
| `small-q8_0` | `ggml-small-q8_0.bin` | 264 | 较慢 | small 的 q8_0 量化版，中文识别准确率明显提升，长音频推荐 |

- 档位数量：**4**（`sizeMB` 为近似值，十进制 MB；精确值以下载源 `Content-Length` 为准）。
- 下载源常量：`MODEL_BASE_URL = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/'`，即 HuggingFace 官方仓库的国内镜像，规避 GitHub 直链超时。内置档位 URL 由 `MODEL_BASE_URL + file` 拼出。
- 未知模型统一提示前缀：`UNKNOWN_MODEL_MSG = '未知模型：'`。

### 2.1 语言选项（`WHISPER_LANGS`）

| id | label | 传递给 whisper-cli 的 `-l` | 是否繁转简 |
|----|-------|---------------------------|-----------|
| `auto` | 自动检测 | 不传（whisper 自行检测） | 检测结果 `language === 'zh'` 时转换 |
| `zh` | 中文（简体） | `zh` | 是 |
| `zh-hant` | 中文（繁体） | `zh`（whisper 无繁体语言码） | 否，保留原样 |
| `en` | English | `en` | 否 |

### 2.2 其它模块级常量

| 常量 | 值 | 用途 |
|------|----|------|
| `UNKNOWN_MODEL_MSG` | `'未知模型：'` | id 不在枚举内（内置与自定义都没有该 id）时的统一提示前缀 |
| `WHISPER_AUDIO_EXTS` | `['wav', 'flac', 'mp3', 'ogg']` | whisper-cli 自带解码器支持的扩展名，命中则原样直传 |
| `MODEL_BASE_URL` | `'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/'` | 内置档位与自定义档位缺省下载源 |

## 3. 内部实现函数

| 名称 | 签名要点 | 说明 |
|------|----------|------|
| `modelsDir()` | `() => string` | 模型目录：`path.join(app.getPath('userData'), 'whisper', 'models')` |
| `resolveCliPath()` | `() => string` | 依次探测 **`process.resourcesPath/whisper/whisper-cli.exe`（优先——whisper 现在随安装包，走 `package.json` 的 `extraResources`）** → `BUILTIN_RESOURCES.root/whisper/whisper-cli.exe`（旧版整体运行环境目录 / dev 的兜底） → `app.getAppPath()/resources/whisper/whisper-cli.exe`（开发态），取第一个存在的文件；都不存在时返回第一个候选路径（供 UI 提示用户放置）。顺序刻意把 `process.resourcesPath` 放在最前：运行环境包解到 `userData/runtime/<包名>/` 之后，`BUILTIN_RESOURCES.root` 指向的那个根里**没有** `whisper/` |
| `listModelBins()` | `() => { name; path; bytes }[]` | 扫描模型目录，只收集匹配 `/^ggml-.*\.bin$/i`、非 `\.part`、且 `bytes > 0` 的文件；目录不可读时返回 `[]` |
| `customModels()` | `() => WhisperCustomModel[]` | 读 `settings.getWhisperCustomModels()`（持久化在 settings.json 的 `whisper.customModels`） |
| `customToMeta(c)` | `(c: WhisperCustomModel) => WhisperMeta` | 自定义条目 → 统一结构：`label` 取 `c.name || c.id`，`speed` 为空串，`desc` 缺省为 `'用户自定义模型'`，`url` 缺省为 `MODEL_BASE_URL + c.file` |
| `allModels()` | `() => WhisperMeta[]` | 内置枚举（补 `url`、`custom: false`）在前，自定义条目在后，`concat` 成完整清单 |
| `findModel(id)` | `(id: string) => WhisperMeta \| null` | 按 id 精确查找；空 id 或未命中返回 `null`（表示「未知模型」） |
| `validateModelFile(file)` | `(file: string) => string` | 自定义模型文件名校验，返回错误文案或空串：必填、不得含 `\` `/` 或 `..`、须匹配 `/^ggml-[\w.\-]+\.bin$/i` |
| `modelIdFromFile(file)` | `(file: string) => string` | 由文件名派生 id：去掉 `ggml-` 前缀与 `.bin` 后缀，如 `ggml-base-q5_1.bin → base-q5_1` |
| `fileInEnum(file)` | `(file: string) => boolean` | 文件名（小写比较）是否已被内置或自定义档位占用 |
| `resolveModelFile(id)` | `(id: string) => { name; path; bytes } \| null` | **精确解析**：只认该档位登记的 `file`，`statSync` 失败、非普通文件或 `size <= 0` 时返回 `null` |
| `unknownModelFiles()` | `() => string[]` | 模型目录中文件名不在枚举内的 `.bin` 列表（提示用户可「添加自定义模型」纳入管理） |
| `modelFilePath(id)` | `(id: string) => string` | 模型文件绝对路径，未命中返回空串；当前模块内无调用点，为预留工具函数 |
| `httpGetFollow(url, redirects)` | `(url: string, redirects: number) => Promise<IncomingMessage>` | 支持重定向的 GET：3xx 且有 `location` 时最多跟随 5 跳，非 200 直接 reject；请求头带 `User-Agent: APP_USER_AGENT`（常量来自 `src/shared/constants.ts`，值即 `'ShadowMill/1.0'`，不再写字面量） |
| `downloadFile(url, destPath, onProgress?)` | `(…) => Promise<number>` | 流式写盘：`createWriteStream(destPath)` 边收边写，返回累计字节数；进度节流见 5.1 |
| `runCli(cliPath, modelPath, audioPath, outPrefix, language, emit, id)` | `(…) => Promise<string>` | spawn `whisper-cli`：`-m 模型 -f 音频 -oj -of 前缀 --no-prints -pp`（`language` 非空且非 `auto` 时追加 `-l 语言`）；解析 stderr 进度行回推 `transcribing`；成功时 resolve 过滤掉进度行后的 stderr 尾部，非 0 退出码 reject |
| `parseWhisperJson(jsonPath)` | `(jsonPath: string) => { lang; segs } \| null` | 解析 `-oj` 输出的 JSON，兼容新版（顶层 `transcription` 数组，时间在 `offsets.from/to` 毫秒）与旧版（`transcription.segments`、`start/end` 秒）及兜底顶层 `segments`；语言取 `raw.result.language`；文件缺失或解析失败返回 `null`，识别为空时 `segs` 为 `[]` |
| `fmtTs(sec)` | `(sec: number) => string` | 秒 → `[分:秒]`（两位补齐，向下取整），项目字幕格式 |
| `fmtTsMs(sec)` | `(sec: number) => string` | 秒 → `[分:秒.毫秒]`（3 位毫秒，向下取整到毫秒），字幕落盘的毫秒精度格式 |
| `toVadSamples(src)` | `(src: string) => Promise<Int16Array \| null>` | 取 16k 单声道 PCM 样本：原文件已是该格式直接 `readWavSamples` 读；否则用内置 ffmpeg 转 `userData/whisper/vad_<时间戳>.wav` 再读；失败返回 `null` |
| `cleanupTmp(p)` | `(p: string) => void` | 静默删除临时文件（不存在或删除失败都忽略） |
| `prepareAudio(audioPath, onConvert?)` | `(…) => Promise<{ path; tmp }>` | 受支持格式原样直传（`tmp: false`）；其余格式经 ffmpeg 转 `userData/whisper/conv_<时间戳>.wav`（`tmp: true`）；ffmpeg 缺失或转换失败（含退出码 0 但产物为空）时 reject |
| `loadT2s()` | `() => ((t: string) => string) \| null` | 惰性 `require('opencc-js')` 并创建 `OpenCC.Converter({ from: 'tw', to: 'cn' })`，结果缓存；依赖缺失或异常时置 `t2sFailed` 并返回 `null`（降级为不转换） |

模块内的两个模块级缓存：`t2sConverter`（转换器实例）与 `t2sFailed`（失败标记，避免重复尝试 require）。

## 4. IPC 频道一览

`register(ctx?: RegisterCtx)` 通过 `ctx.getWindow` 拿到主窗口用于进度推送；`emit` 在窗口存在且未销毁时 `webContents.send(IPC.Whisper.Progress, payload)`。所有 `ipcMain.handle` 频道均返回 `{ ok, ... }` 形式的结果对象（`whisper:pick-audio` 例外，直接返回路径或 `null`）。

handler 的载荷类型全部取自 `src/shared/types.ts` ⑤ 节（本文件**不再自行声明任何 payload / progress 接口**）：`download` / `delete` / `set-current` / `remove-model` 标注 `Partial<WhisperIdPayload>`，`add-model` / `update-model` 标注 `WhisperAddModelPayload` / `WhisperUpdateModelPayload`，`open-dir` 标注 `WhisperOpenDirPayload`，`project-audio` 标注 `Partial<WhisperProjectAudioPayload>`，`transcribe` 标注 `WhisperTranscribePayload`；进度载荷 `WhisperProgressPayload` 同样来自共享层（`runCli` 的 `emit` 回调与 `register` 内的 `emit` 都用它标注）。

| 频道名 | 参数载荷 | 返回结果 | 行为说明 |
|--------|----------|----------|----------|
| `whisper:status` | 无 | `{ ok, cli: { exists, path }, modelsDir, langs, models[], unknownFiles[], usedBytes, currentModelId }` | 确保模型目录存在（`mkdirSync recursive`）；按枚举登记文件名逐个 `resolveModelFile` 得出 `downloaded` / `localBytes`，聚合出 `usedBytes`；`isCurrent` 与 `settings.getWhisperModel()` 比较 |
| `whisper:download` | `{ id }` | `{ ok, id, sizeBytes }` 或 `{ ok: false, message }` | 未知 id 直接拒绝；`downloading` 互斥（一次只允许一个任务）；本地已存在则直接返回「无需重复下载」；先写 `<file>.part`，成功后 `renameSync` 为最终文件；失败删 `.part` 并 emit `error` |
| `whisper:delete` | `{ id }` | `{ ok, id, removed }` / `{ ok: false, message }` | 删除该档位登记的模型文件；转录进行中（`transcribing`）时拒绝，避免删掉正在使用的模型 |
| `whisper:set-current` | `{ id }` | `{ ok, id }` / `{ ok: false, message }` | 仅允许已下载的档位；转录中拒绝切换；成功写 `settings.saveWhisperModel(id)` |
| `whisper:add-model` | `{ name, file, url, desc, sizeMB }` | `{ ok, id, message }` / `{ ok: false, message }` | 校验名称必填、文件名合法（`validateModelFile`）、id 可从文件名解析、id 与文件名都未被占用；通过后 `saveWhisperCustomModels` 追加条目 |
| `whisper:update-model` | `{ id, name, url, desc, sizeMB }` | `{ ok, id, message }` / `{ ok: false, message }` | 只允许编辑自定义模型（内置模型拒绝）；`file` 与 `id` 固定不变，仅按需更新 `name` / `url` / `sizeMB` / `desc`（空值保留原值） |
| `whisper:remove-model` | `{ id }` | `{ ok, id, message }` / `{ ok: false, message }` | 仅移除枚举条目，**不删除**本地模型文件；转录中拒绝；若被移除的 id 正是当前使用档位，则把当前档位清空（`saveWhisperModel('')`） |
| `whisper:open-dir` | `{ which }`（缺省 `'models'`） | `{ ok, path }` / `{ ok: false, message }` | `which === 'cli'` 时打开 `whisper-cli.exe` 所在目录，否则打开模型目录；先 `mkdirSync` 再 `shell.openPath`，并 `await` 判断返回的错误串 |
| `whisper:pick-audio` | 无 | `string`（选中文件绝对路径）或 `null` | 弹系统文件选择框，过滤器扩展名为 `mp3 / wav / m4a / flac / ogg / aac / mp4`；取消或未选返回 `null`；无窗口时也返回 `null` |
| `whisper:project-audio` | `{ name }` | `{ ok, path, name }` / `{ ok: false, message }` | 读项目 `audioFile`（`projects.ensureProject` + `projects.projectDir`），相对路径拼成绝对路径并检查存在性，供「使用项目音频」入口 |
| `whisper:transcribe` | `{ id, audioPath, language }` | `{ ok, id, text, subtitleText, segments, model }` / `{ ok: false, message }` | 完整转录链路，见 5.3；`id` 缺省取 `settings.getWhisperModel()`，`language` 缺省 `'auto'`；`transcribing` 互斥 |
| `whisper:progress`（推送，非 invoke） | — | 载荷 `WhisperProgressPayload`：`{ id?, stage, percent?, receivedBytes?, totalBytes?, message }` | 主进程 → 渲染进程单向推送；`stage` 取值 `downloading` / `loading` / `transcribing` / `done` / `error` |

## 5. 关键流程

### 5.1 模型下载（`whisper:download`）

1. 用 `findModel(id)` 校验档位，未命中返回 `未知模型：<id>`；若 `downloading` 已为 `true`，返回「已有模型下载任务进行中，请稍候」。
2. `mkdirSync(modelsDir(), { recursive: true })`，确定 `finalPath = modelsDir()/<meta.file>` 与 `partPath = finalPath + '.part'`。
3. 若 `resolveModelFile(id)` 已有非空文件，直接返回成功且提示「本地已有模型文件 <name>，无需重复下载」。
4. 置 `downloading = true`，emit `{ stage: 'downloading', percent: 0, message: '开始下载 <label>…' }`；URL 取 `meta.url || (MODEL_BASE_URL + meta.file)`（**国内镜像**优先）。
5. `httpGetFollow(url, 5)` 跟随最多 5 跳重定向后拿到 200 响应；`downloadFile` 创建写流**边下边写 `.part`**，`content-length` 作为总大小计算百分比；进度**节流**：距上次推送超过 200ms 或已收满时才 emit，百分比封顶 100（无 `Content-Length` 时为 0）。
6. 下载结束后 `fs.statSync(partPath).size` 作为真实体积，再 `fs.renameSync(partPath, finalPath)` 做**原子 rename**（同目录内改名，避免出现半成品 `.bin`）。
7. emit `{ stage: 'done', percent: 100, receivedBytes: sizeBytes, totalBytes: received, message: '<label> 下载完成' }` 并返回 `{ ok: true, id, sizeBytes }`。
8. 任一步抛错：删除残留 `.part`，emit `{ stage: 'error', message: '下载失败：…' }`，返回 `{ ok: false, message }`；`finally` 中复位 `downloading = false`。

### 5.2 模型「id ↔ 文件名」严格对应与未登记文件处理

1. `allModels()` 把内置枚举与自定义条目合成统一清单，每条都带唯一 `file`。
2. 所有本地文件判定都走 `resolveModelFile(id)`：**只查该 id 登记的那一个文件名**，不做前缀匹配，因此下载了 `ggml-base.bin` 不会让 `base-q5_1` 显示为已下载。
3. `customToMeta` 支持自定义档位使用任意 `ggml-*.bin` 文件名；`modelIdFromFile` 从文件名派生 id，`fileInEnum` 保证同一文件名不被两个档位重复登记。
4. 目录中未被任何档位登记的文件由 `unknownModelFiles()` 汇总，随 `whisper:status` 返回，UI 据此提示用户「添加自定义模型」纳入管理。
5. 移除自定义档位只删枚举条目，本地文件保留，可再次登记复用。

### 5.3 字幕转录全流程（`whisper:transcribe`）

1. 前置校验：`id` 存在 → `audioPath` 存在 → `findModel(id)` 命中 → `resolveCliPath()` 文件存在 → `resolveModelFile(id)` 已下载 → `transcribing` 未被占用。
2. 生成输出前缀 `outPrefix = userData/whisper/out_<时间戳>`，JSON 路径为 `outPrefix + '.json'`；置 `transcribing = true`。
3. **音频预处理** `prepareAudio`：扩展名在 `WHISPER_AUDIO_EXTS`（`wav / flac / mp3 / ogg`）内则原样直传；否则 emit `{ stage: 'loading', message: '正在提取音频（ffmpeg 转换为 16kHz WAV）…' }`，用 ffmpeg（`BUILTIN_RESOURCES.ffmpeg`，来自 **ffmpeg 运行环境包**）以 `-vn -ac 1 -ar 16000 -c:a pcm_s16le` 转为临时 wav。临时路径记录到 `tmpAudio` 以便收尾清理。**这条路径是唯一依赖 ffmpeg 的环节**：ffmpeg 包未安装时抛内部的 `FfmpegNeededError`（自带 `needPacks = ['ffmpeg']` 标记），不再默默等待下载。
4. emit `{ stage: 'loading', message: '正在加载模型（<label>）…' }`，并做语言归一：`zh-hant` 一律按 `zh` 传给 whisper-cli（是否繁转简在后续步骤处理）。
5. **spawn whisper-cli** `runCli`：参数 `-m 模型 -f 音频 -oj -of 前缀 --no-prints -pp`，非 `auto` 语言追加 `-l`；`--no-prints` 抑制横幅，`-pp` 让进度输出到 stderr；等待进程 `close`。
6. **解析 JSON** `parseWhisperJson(jsonPath)`：兼容新版 `transcription` 段落数组（`offsets.from/to` 毫秒）与旧版 `segments`（`start/end` 秒）与兜底顶层 `segments`，过滤空文本后得到 `segs`；解析结果 `null` 时区分两种情况——JSON 文件不存在（whisper-cli 读取/解码失败但退出码为 0，附 stderr 尾部）与文件存在但无文本（可能音频过短或无人声）。
7. **繁转简**：当语言为 `zh`，或语言为 `auto` 且 whisper 检测语言为 `zh` 时，`loadT2s()` 惰性加载 opencc-js，逐段转换；转换器不可用时保留原文，单段转换异常也保留该段原文。
8. **段尾静音裁剪（VAD）**：`toVadSamples(prepared.path)` 取 16k 单声道样本后调用 `vadTrimSegments(samples, 16000, segs)`，把每段 `end` 收敛到实际语音结束；整段裁剪失败仅静默跳过，不影响转录结果。
9. **组装结果**：`text` 为各段文本按 `\n` 拼接；`subtitleText` 为每段 `[MM:SS.mmm-MM:SS.mmm] 文本`（起止相同或逆序时省略后半段），使用 `fmtTsMs`；随后 emit `{ stage: 'done', message: '转录完成：<段数> 条字幕' }`，返回 `{ ok: true, id, text, subtitleText, segments, model }`。
10. `finally`：复位 `transcribing`，`cleanupTmp(tmpAudio)` 删除转换出的临时音频，并删除本次的 JSON 结果文件。
11. **失败分支带 `needPacks`**：`catch` 里先 emit `{ stage: 'error', message }`，再检查错误上是否带 `needPacks` 标记——是则返回 `{ ok: false, message: msg + '（约 ' + runtime.packSizeText(['ffmpeg']) + '）', needPacks: ['ffmpeg'] }`（界面据此弹「下载运行环境」确认框），否则返回 `{ ok: false, message: msg }`。**转录入口不再 `await runtime.ensureRuntime()`**：whisper 随安装包，装完即可转录；只有「非 wav/flac/mp3/ogg 要转码」才需要 ffmpeg。

### 5.4 两阶段进度回推（`whisper:progress`）

| 阶段 | `stage` | 触发点 | 载荷要点 |
|------|---------|--------|----------|
| 提取音频 | `loading` | ffmpeg 转换开始前（`prepareAudio` 的 `onConvert`） | `message: '正在提取音频（ffmpeg 转换为 16kHz WAV）…'` |
| 加载模型 | `loading` | spawn 之前 | `message: '正在加载模型（<label>）…'`，UI 显示为不确定进度条 |
| 转录中 | `transcribing` | `runCli` 从 stderr 尾部 300 字符内匹配 `/progress\s*=\s*(\d{1,3})\s*%/g` 得到百分比 | `percent` + `message: '转录中 <pct>%'`；百分比单调递增，仅在与上次不同时推送 |
| 完成 | `done` | 下载成功 / 转录成功 | `percent: 100`（下载）或字幕条数提示（转录） |
| 失败 | `error` | 下载异常 / 转录 catch 分支 | `message` 为可直接展示的错误文本 |

下载阶段的 `stage` 为 `downloading`（含 `percent` / `receivedBytes` / `totalBytes`），与转录的 `loading` / `transcribing` 共用同一推送频道，渲染层按 `stage` 分流 UI。

## 6. 依赖与协作

**本模块 import：**

| 来源 | 引入内容 | 用途 |
|------|----------|------|
| `electron` | `app`、`ipcMain`、`dialog`、`shell` | 路径（userData）、IPC 注册、文件选择框、打开目录 |
| `node:path` / `node:fs` / `node:https` / `node:child_process` | 默认导入 | 路径拼接、文件与流操作、镜像下载、spawn ffmpeg 与 whisper-cli |
| `./projects` | `ensureProject`、`projectDir`、类型 `Project` | `whisper:project-audio` 解析项目音频绝对路径 |
| `./settings` | `getWhisperModel`、`saveWhisperModel`、`getWhisperCustomModels`、`saveWhisperCustomModels` | 当前档位与自定义模型条目的持久化 |
| `./hfEnv` | `BUILTIN_RESOURCES`（用 `BUILTIN_RESOURCES.ffmpeg`——分包后指向 **ffmpeg 运行环境包**解出的目录 `<userData>/runtime/ffmpeg/ffmpeg/bin/ffmpeg.exe`，未就绪时为空串；`resolveCliPath()` 另用 `BUILTIN_RESOURCES.root` 作旧布局兜底） | 音频格式转换与 VAD 取样 |
| `./vad` | `readWavSamples`、`vadTrimSegments`、类型 `VadSegment` | WAV 采样读取与静音裁剪（纯函数） |
| `../shared/ipc` | `IPC` | `IPC.Whisper.*` 频道常量 |
| `../shared/constants` | `APP_USER_AGENT` | 出网下载请求的 `User-Agent`（原为字面量 `'ShadowMill/1.0'`）；常量定义在 `src/shared/constants.ts`，由 `APP_NAME_EN` 派生 |
| `../shared/types` | 类型 `RegisterCtx`、`WhisperCustomModel` 与全部载荷类型 `WhisperIdPayload`、`WhisperAddModelPayload`、`WhisperUpdateModelPayload`、`WhisperOpenDirPayload`、`WhisperProjectAudioPayload`、`WhisperTranscribePayload`、`WhisperProgressPayload` | `register(ctx)` 上下文、自定义模型条目结构、各 handler 载荷与进度推送载荷（进度类型原先在本文件本地声明，现已上移共享层） |
| `opencc-js`（运行时 `require`） | `OpenCC.Converter({ from: 'tw', to: 'cn' })` | 繁体转简体；惰性加载，被 `externalizeDepsPlugin` 保留为运行时依赖 |

**调用方：**

| 调用方 | 使用方式 |
|--------|----------|
| `src/main/index.ts` | `import * as whisper from './whisper'`，在启动流程中调用 `whisper.register(ctx)` |
| `src/preload/index.ts` | 暴露 `window.whisperTools`：`status` / `download` / `delete` / `setCurrent` / `addModel` / `updateModel` / `removeModel` / `openDir` / `pickAudio` / `projectAudio` / `transcribe`，并用 `onProgress` 订阅 `whisper:progress` |
| `src/renderer/src/pages/SettingsPage/WhisperSection.vue` | 设置页「语音识别模型」区块：模型列表、下载/删除/设为当前、自定义模型增删改、打开模型目录、进度条 |
| `src/renderer/src/pages/SubtitlePage/TranscribeSection.vue` | 字幕页转录弹窗：选择音频 / 使用项目音频、语言选择、调用 `transcribe`、按 `stage` 渲染进度 |
| `src/renderer/src/pages/TextTtsPage/AlignSection.vue` | 复用同一进度条样式与 `whisper:progress` 回推做文本对齐 |

**opencc-js 的懒加载语义**：模块顶层不 `import`，只在首次需要繁转简时执行 `require('opencc-js')`；成功则把 `OpenCC.Converter(...)` 缓存进 `t2sConverter` 复用，失败则把 `t2sFailed` 置为 `true` 且此后直接返回 `null`。因此**缺少该依赖不会影响应用启动与其余功能**，只是繁体文本保持原样。

## 7. 注意事项与实现要点

- **模型不打包进应用**：`.bin` 模型由用户按需下载到 `userData/whisper/models/`；**whisper-cli 随安装包**（`package.json` 的 `extraResources` 把 `resources/whisper` 映射到安装目录的 `whisper/`，故打包后位于 `process.resourcesPath/whisper/`，开发期位于项目 `resources/whisper/`）。ffmpeg **不再随安装包**——它属于 ffmpeg 运行环境包，首次用到转码时下载并解到 `<userData>/runtime/ffmpeg/`（`BUILTIN_RESOURCES.ffmpeg` 会指向那里）。缺少 cli 时转录直接返回可读提示，不抛异常。
- **缺 ffmpeg 走「回 `needPacks`」而不是等待**：`prepareAudio` 只在需要转码时检查 ffmpeg，缺失即抛 `FfmpegNeededError`（`needPacks = ['ffmpeg']`）；转录的 `catch` 把它转成 `{ ok: false, needPacks: ['ffmpeg'], message: '…（约 <packSizeText(['ffmpeg'])>）' }`，由渲染层（`useEnvGate`）问用户是否下载，**不阻塞、不静默下载**。这也是本文件与 `runtime.ts` 唯一的关系（只用 `runtime.packSizeText()` 组文案，不再调 `ensureRuntime()`）。
- **临时文件与清理**：`conv_*.wav`（转码结果）、`vad_*.wav`（VAD 取样）、`out_*.json`（whisper 输出）全部落在 `userData/whisper/`；转码与 JSON 由 `transcribe` 的 `finally` 清理，VAD 临时文件在 `toVadSamples` 内 `finally cleanupTmp`，删除失败一律静默忽略，不会污染业务结果。
- **`.part` 与原子性**：下载过程写在 `<file>.part`，`listModelBins` 与 `resolveModelFile` 都不会把 `.part` 或 0 字节文件当作可用模型，因此下载中途关掉应用不会留下「看似已下载」的坏档。
- **一次一个任务**：`downloading` / `transcribing` 两个闭包变量做互斥（进程内单实例语义），转录期间禁止删除模型、切换当前档位与移除自定义模型。
- **编码与文本**：JSON 以 `utf8` 读取；stderr 累计后只保留最后 8 行且剔除进度行作为诊断信息，即使退出码为 0 也会把该尾部返回给调用方，用于解释「退出码 0 但未产出 JSON」的解码失败场景。
- **whisper-cli 的格式限制**：自带解码器只支持 `flac / mp3 / ogg / wav`；`mp4 / m4a / aac / mov` 等直接喂入会解码失败，且该版本仍以退出码 0 结束而不报错——这正是需要 `prepareAudio` 预转码并区分「无 JSON」与「识别为空」的原因。
- **语言选项语义**：`zh-hant` 与 `zh` 共用 `-l zh`（whisper 无繁体语言码），差异只在是否做繁→简转换；`auto` 则依据解析出的 `result.language === 'zh'` 决定是否转换。
- **Windows 路径与进程**：所有 spawn 都带 `windowsHide: true` 避免控制台闪窗；`shell.openPath` 必须 `await` 后判断返回值（成功为空串，失败为错误信息）。
- **失败与容错策略**：VAD 裁剪、繁转简转换、单段文本转换、临时文件删除全部「失败即降级」，不阻断转录主流程；下载重定向超过 5 跳、HTTP 非 200、非 0 退出码则分别给出明确的中文错误信息。
- **未使用/预留代码**：`modelFilePath(id)` 与 `fmtTs(sec)` 当前模块内无调用点（`fmtTsMs` 才是字幕实际使用的格式），保留为工具函数，改动前建议先确认外部是否有动态引用。
- **类型全部来自 `shared/types.ts`**：本地已无 `WhisperProgressPayload` 等接口声明，`whisper:progress` 的线上字段（`id?` / `stage` / `percent?` / `receivedBytes?` / `totalBytes?` / `message`）只在共享层定义一处；改字段名会同时触发主进程与 preload 两侧编译报错。
