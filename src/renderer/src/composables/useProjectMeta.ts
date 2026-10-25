// composables/useProjectMeta.ts —— 「HTML生成」页顶部那条项目状态（以及标题右侧的「用法」气泡）的派生逻辑。
//
// 为什么单独成文件：它只是**读 appState.project 算出一份展示用快照**，与生成/渲染流程毫无耦合；
// 页面本身已经很长（还带着预览、素材、角色、章节四块），把这段纯派生搬出来页面才留得住「一件事」。
// 口径必须与主进程一致（buildContentBlock）：「画面分镜非空」才算一场——旁白可以为空（静音段）。
import { computed } from 'vue'
import { appState, hasHtml } from '@renderer/composables/useAppStore'

export function useProjectMeta() {
  // 项目状态条（原 renderMeta）：素材一栏同时反映字幕 / 背景音频 / 素材库勾选情况
  const meta = computed(() => {
    const p = appState.project
    const c = (p && p.content) || { scenes: [] as { narration?: string; visual?: string }[] }
    // 有内容的场景（旁白或画面分镜非空）：「两个字段都空」的空壳不算——loadScenes 会给空项目补一个空场景。
    const filled = (Array.isArray(c.scenes) ? c.scenes : [])
      .filter((s) => s && (String(s.narration || '').trim() || String(s.visual || '').trim()))
    // 场景数口径与主进程 buildContentBlock 一致：**画面分镜非空**才算一场（旁白可以为空 = 静音段）。
    // 早先只数旁白非空，静音段被漏掉，这个格子写的「N 个场景（生成时自动附带）」就与实际附带的对不上。
    const sceneN = filled.filter((s) => String(s.visual || '').trim()).length
    // 「写了旁白、但一场都没填画面分镜」是真会发生的情形（画面才是附带门槛）：这时报「无内容脚本」会
    // 让人以为自己的脚本白写了，得单独说清楚缺什么。
    const missVisual = filled.length > 0 && sceneN === 0
    const mats = (p && p.materials) || []
    const images = mats.filter((m) => m.kind === 'image').length
    const videos = mats.filter((m) => m.kind === 'video').length
    const picked = mats.filter((m) => m.selected).length
    const subCount = (p && p.subtitleCount) || 0
    const parts: string[] = []
    if (subCount) parts.push('字幕 ' + subCount + ' 条')
    if (p && p.audioFile) parts.push('已配背景音频')
    if (mats.length) parts.push('素材 ' + mats.length + ' 个（图片 ' + images + ' · 视频 ' + videos + '，参与生成 ' + picked + '）')
    return {
      hasH: hasHtml.value,
      sceneN,
      missVisual,
      subCount,
      matN: mats.length,
      matText: parts.length ? parts.join(' · ') : '无素材（可先到「字幕生成」页添加字幕，或在上方「项目素材」里添加图片 / 视频）'
    }
  })

  // 「用法」说明（原 .proj-meta 的第 4 个状态格）：操作引导不是项目数据，现挂在标题右侧的 ? 气泡里
  const usageHint = computed(() => (meta.value.hasH
    ? '填写需求后点「按需求修改」（在当前页面上改）；想整页重来点「生成 HTML」（会直接覆盖当前页面，点一次即执行），也可「下载 HTML」备份。'
    : '在「项目素材」里选好素材（可多张图片 / 多个视频，勾选决定这次用哪些），再填写需求描述点「生成 HTML」；背景音频在下方「预览」里选定。'))

  return { meta, usageHint }
}
