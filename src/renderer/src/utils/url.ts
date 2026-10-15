// utils/url.ts —— 路径 → URL 的拼装（无状态纯函数；按 AGENTS.md 第 8 条放在 utils/）
//
// 为什么要有这个文件：同一件事（把文件路径变成可播放 / 可展示的 URL）以前散在 **7 个地方**、
// 用了三套写法，而且每套都有各自的坑：
//   · 5 处音频试听用 `'file:///' + encodeURI(path)`——dev 下渲染页是 http:// 源，Chromium 直接拒绝
//     读 file://（见 CHANGELOG #25），这些功能在 dev 里一直是哑的；
//   · `encodeURI` **不编码 `#` 与 `?`** ⇒ 路径里带 `#` 的文件名会被当成 fragment，指向错文件；
//   · 3 处 hgpreview 里，两处用整串 `encodeURIComponent(file)`（斜杠被编成 `%2F`），一处用逐段编码。
// 现在统一成"**逐段 encodeURIComponent、斜杠保持原样**"——与主进程 hgpreview 处理器的口径严格对应
// （它按 `new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent)` 逐段解）。
//
// 本文件**不提供 file:// 拼装**：渲染层已全部改走 hgpreview://，留着导出的 fileUrl 只会诱导误用。

/** 把相对路径按 `/` 切段后逐段编码（斜杠保持原样，`.` / `..` 会被编掉） */
function encodeRelPath(rel: string): string {
  return String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

// `hgpreview://tts/...` 能读的 userData 子目录白名单——**必须与 main/index.ts 的 TTS_PREVIEW_DIRS 一致**
// （那边是真正的安全边界，这里是渲染层用来把绝对路径换算成相对路径的前缀识别；两处都要改才算加了一类产物）
const TTS_DIRS = ['tts-output', 'voice']

/**
 * 项目内相对路径 → `hgpreview://p/<项目名>/<相对路径>`（应用自己的只读文件协议，见 main/index.ts）。
 * `bust=true` 时附一个时间戳查询串——预览副本每次都会重写，不加它会命中缓存看到旧的。
 */
export function previewUrl(projectName: string, rel: string, bust = false): string {
  const base = 'hgpreview://p/' + encodeURIComponent(String(projectName || '')) + '/' + encodeRelPath(rel)
  return bust ? base + '?v=' + Date.now() : base
}

/**
 * 项目**外**的语音产物（TTS 合成结果 / 生成记录 / 逐句对齐）→ `hgpreview://<任意>/<相对路径>?tts=1`。
 * **为什么用查询标记而不是 `hgpreview://tts/...`**：主进程按 `new URL(url).pathname` 取段，
 * 而 `hgpreview://tts/voice/x.wav` 里的 `tts` 在 **host 位**、`pathname` 只有 `/voice/x.wav`
 * ⇒ 会被当成"项目名 = voice"去找项目目录，直接 404（这是 2026-10 实现时踩到的坑）。
 * 用 `?tts=1` 走查询串，与 `?v=<时间戳>` 一样不影响 pathname，路由判定不含糊。
 *
 * 白名单在**主进程**（只允许读 userData 下的 `tts-output` 与 `voice`，见 main/index.ts 的 TTS_PREVIEW_DIRS）；
 * 这里只负责从绝对路径里认出该目录、取它之后的相对路径——对齐产物是多级的
 * （`voice/align-<时间戳>/raw/0000.wav`），只取最后两段会拼错。
 * 认不出来（用户在别处自定义了保存目录）就返回空串，调用方据此不给试听入口——**不猜**。
 */
export function ttsUrl(absPath: string): string {
  const parts = String(absPath || '').replace(/\\/g, '/').split('/').filter(Boolean)
  for (let i = parts.length - 2; i >= 0; i--) {
    if (TTS_DIRS.indexOf(parts[i]) >= 0) {
      return 'hgpreview://tts/' + encodeRelPath(parts.slice(i).join('/')) + '?tts=1'
    }
  }
  return ''
}
