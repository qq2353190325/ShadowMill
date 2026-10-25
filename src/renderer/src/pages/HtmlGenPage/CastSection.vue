<template>
  <div class="hgen-block">
    <div class="panel-head">
      <div class="panel-title-sm" style="margin:0">
        角色
        <span class="ch-sub">本片勾选 {{ pickedCount }} / {{ members.length }} 个 · 生成时由应用注入页面</span>
      </div>
      <div class="panel-head-actions">
        <button class="hf-btn" title="去「角色」页新建 / 改画法 / 删除（角色是全局的，跟项目无关）" @click="goCastPage">
          管理角色
        </button>
      </div>
    </div>

    <!-- 卡片墙：与「角色」页同一套版式（人物在上、名字在下），这里是**勾选**语义：
         勾上 = 本片用到它（生成时从全局角色库复制进 <项目>/cast/ 并注入页面），取消 = 后续生成不再带它。
         新建 / 改画法 / 删除都在「角色」页——这里只管"本片用哪几个"（用户明确要求 HTML 这边不许增改角色）。 -->
    <div v-if="members.length" class="mat-grid cast-mat-grid">
      <div v-for="m in members" :key="m.id" class="mat-card cast-mat" :class="{ off: !isPicked(m.id) }">
        <button
          class="mat-check"
          :class="{ on: isPicked(m.id) }"
          :disabled="busy || !!m.missing"
          :title="m.missing ? '角色库里这份代码缺失，去「角色」页看看' : (isPicked(m.id) ? '本片用到这个角色（点击取消）' : '本片不用这个角色（点击加入）')"
          @click="onToggle(m)"
        >{{ isPicked(m.id) ? '✓' : '' }}</button>
        <div class="cast-thumb">
          <CastShot :id="m.id" :units="m.units" :title="m.name" :uses="m.uses" :epoch="epochs[m.id] || 0" />
        </div>
        <div class="mat-meta">
          <div class="mat-name" :title="m.name + (m.desc ? '：' + m.desc : '')">{{ m.name }}</div>
        </div>
        <span v-if="m.missing" class="cast-card-missing">文件缺失</span>
      </div>
    </div>
    <div v-else class="hgen-tip" style="margin-top:0">
      全局角色库还是空的：去「角色」页点「新建角色」让 AI 画一个（角色是全局的，建一次所有项目都能用）。
    </div>

    <div class="hgen-tip">
      勾上 = 本片用到它：生成 / 改稿时应用把这份共享绘制代码注入页面，模型只能<b>调用</b>
      （<code>window.__cast["id"](x, y, u, &#123; ctx: ctx2d &#125;)</code>），不许在页面里重画。
      角色的新建与画法都在「角色」页管理——这里是只读的勾选，改不了角色的长相。
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/CastSection.vue —— 「HTML生成」页 · 角色（**只勾选，不增改**）
// 角色只有全局一份（<userData>/cast-library/，见 main/cast/library.ts），所以这里列出**库里全部角色**，
// 勾上 = 本片用到它：主进程把勾中的复制进 <项目>/cast/ 并注入页面（预览 / 渲染只认项目目录内的文件）。
// 新建 / 改画法 / 改信息 / 删除都在「角色」页（cast:* 频道）。用户明确要求 HTML 这边不许新增和修改角色，
// 所以这里没有「新建角色」「存为全局」「改这个角色」，也不再把需求描述写进 prompt。
import { computed, onMounted, reactive, ref } from 'vue'
import type { CastLibraryMember, ProjectCastSelection } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { goPage } from '@renderer/pages'
import CastShot from '@renderer/components/CastShot.vue'

const members = ref<CastLibraryMember[]>([])
const busy = ref(false)
// 预览版本号：项目切过来时刷新一次（角色文件可能刚被「角色」页改过）
const epochs = reactive<Record<string, number>>({})

// 本片用了哪几个（project.cast 是主进程按 id 从库补全的完整成员；selected === false 视为不用）
const picked = computed<Set<string>>(() => {
  const set = new Set<string>()
  const list = (appState.project && appState.project.cast) || []
  for (const m of list) if (m.selected !== false) set.add(m.id)
  return set
})
const pickedCount = computed(() => members.value.filter((m) => picked.value.has(m.id)).length)

function isPicked(id: string): boolean {
  return picked.value.has(id)
}

async function load(): Promise<void> {
  const res = await window.castTools.list().catch(() => null)
  if (!res || !res.ok) {
    members.value = []
    toast((res as { message?: string } | null)?.message || '读取全局角色库失败')
    return
  }
  members.value = res.members || []
}

onMounted(async () => {
  await load()
  // 每次进这一页都让预览重载一次：用户可能刚在「角色」页改过某个角色的画法
  for (const m of members.value) epochs[m.id] = (epochs[m.id] || 0) + 1
})

function goCastPage(): void {
  void goPage('cast')
}

// 勾选 / 取消：整份列表回写（主进程按 id 从库补全元数据、同步项目副本、并按当前产物形态重刷页面）
async function onToggle(m: CastLibraryMember): Promise<void> {
  if (busy.value || m.missing) return
  busy.value = true
  const next: ProjectCastSelection[] = []
  for (const id of picked.value) {
    if (id !== m.id) next.push({ id })
  }
  if (!picked.value.has(m.id)) next.push({ id: m.id })
  const res = await window.projectTools.saveCast(appState.currentName, next).catch(() => null)
  busy.value = false
  if (!res || !res.ok) {
    toast((res as { message?: string } | null)?.message || '保存本片角色失败')
    return
  }
  await refreshProject()
  epochs[m.id] = (epochs[m.id] || 0) + 1
  toast((picked.value.has(m.id) ? '本片会用到：' : '本片不再用：') + m.name)
}
</script>
