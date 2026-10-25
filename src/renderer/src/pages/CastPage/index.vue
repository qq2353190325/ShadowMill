<template>
  <div>
    <div class="hgen-block">
      <div class="panel-head">
        <div class="panel-title-sm" style="margin:0">
          角色
          <span class="ch-sub">{{ members.length }} 个 · 全局共用，与项目无关</span>
        </div>
        <div class="panel-head-actions">
          <button class="hf-btn hf-btn-primary" :disabled="busy" title="调一次模型画一个新角色，存进全局角色库" @click="openCreate">
            新建角色
          </button>
        </div>
      </div>

      <!-- 卡片墙：与「HTML生成」页的角色区同一套版式（人物在上、名字在下、动作在右上「…」菜单），
           区别是这里管的是**库里的角色本身**（新建 / 改画法 / 改信息 / 删除），不是"本片用哪些" -->
      <div v-if="members.length" class="cast-grid page">
        <div
          v-for="m in members"
          :key="m.id"
          class="cast-card static"
          :class="{ off: !!m.missing }"
          :title="'双击看它的动作示范（名字：' + m.name + '）'"
          @dblclick.stop="openActions(m)"
        >
          <!-- 「…」与菜单都不参与双击：双击是"看动作示范"的手势，在它们上面双击只做它们自己的事 -->
          <button class="hf-btn cast-more" :disabled="busy" :title="'更多操作：' + m.name" @click.stop="toggleMenu(m.id)" @dblclick.stop="toggleMenu(m.id)">…</button>
          <CastShot :id="m.id" :units="m.units" :title="m.name" :uses="m.uses" :epoch="epochs[m.id] || 0" />
          <div class="cast-card-meta">
            <span class="cast-card-name" :title="m.name">{{ m.name }}</span>
            <span class="cast-card-sub">{{ m.units }}u</span>
          </div>
          <span v-if="m.missing" class="cast-card-missing">文件缺失</span>
          <!-- 动作菜单：从「…」下方展开；点菜单以外的任何地方会收起（见 menuFor 的 watch） -->
          <div v-if="menuFor === m.id" class="cast-menu" @click.stop @dblclick.stop="closeMenu">
            <button class="cast-menu-item" :disabled="busy || !!m.missing" title="看这个角色动起来的样子：公共动作随便挑，也能给它编专属动作" @click="act(m, 'actions')">动作示范…</button>
            <button class="cast-menu-item" :disabled="busy || !!m.missing" title="调一次模型，在这个角色现有的代码上按你说的重画（覆盖库里的那份）" @click="act(m, 'recreate')">改画法…</button>
            <button class="cast-menu-item" title="改名字 / 描述 / 画风 / 身高 / 是否水彩（不调模型）" @click="act(m, 'meta')">改信息…</button>
            <button class="cast-menu-item" title="把角色 id 复制到剪贴板（id 就是页面里 window.__cast 的键）" @click="act(m, 'copy')">复制 id</button>
            <button class="cast-menu-item danger" :disabled="busy" title="从全局角色库删除（删了就没了；用到它的项目下次生成时会把它的副本收走）" @click="act(m, 'remove')">删除</button>
          </div>
        </div>
      </div>
      <div v-else class="hgen-tip" style="margin-top:0">
        还没有角色。点右上「新建角色」让 AI 画一个——角色是<b>全局的</b>，建一次，所有项目都能勾着用。
      </div>

      <div class="hgen-tip">
        卡片上画的就是这个角色<b>真跑一遍绘制代码</b>得到的样子（静态一帧）。<b>双击卡片</b>（或右上「…」→「动作示范…」）
        可以看它动起来：抬手、走路、跳、表情都是角色代码里那组动画参数（摆臂 / 摆腿 / 眨眼 / 位移…），
        动作与角色代码分开存，所以换动作不用重画角色。
        一个角色 = 一份共享绘制代码（<code>cast/&lt;id&gt;.js</code>，页面里由 <code>window.__cast["id"]</code> 调用），
        所以同一角色在任何一章都由同一份代码画出来，长相不会各章一个样。
        在这里新建 / 改画法 / 删除都只动<b>全局角色库</b>；「本片用哪几个」在「HTML生成」页勾选。
      </div>
    </div>

    <!-- 三个弹窗各管一件事：动作示范（看它动）/ 新建与改画法（调模型）/ 改信息（不调模型） -->
    <CastActionModal
      :open="actionsOpen"
      :member="active"
      @close="actionsOpen = false"
      @recreate="onRecreate"
    />
    <CastEditModal
      :open="editOpen"
      :mode="editMode"
      :member="active"
      @close="editOpen = false"
      @changed="onChanged"
    />
    <CastMetaModal
      :open="metaOpen"
      :member="active"
      @close="metaOpen = false"
      @changed="onChanged"
    />
  </div>
</template>

<script setup lang="ts">
// pages/CastPage/index.vue —— 「角色」页：全局角色库的管理界面（与项目无关）。
// 角色只有全局一份（<userData>/cast-library/）：新建 / 改画法 / 改信息 / 删除都在这里，
// 「HTML生成」页的角色区只负责"本片用哪几个"的勾选（见 HtmlGenPage/CastSection.vue），
// 生成时由主进程把勾中的从库复制进 <项目>/cast/（预览与渲染只认项目目录内的文件）。
// 数据全部走 castTools（cast:* 频道）；任务进度按 taskId 订阅（与「生成 HTML」互不干扰）。
// 另外：**双击卡片**（或「…」菜单 · 动作示范…）打开「动作示范」，看这个角色动起来（CastActionModal）。
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { CastLibraryMember, CastResult } from '@shared/types'
import { toast } from '@renderer/composables/useToast'
import CastShot from '@renderer/components/CastShot.vue'
import CastActionModal from './CastActionModal.vue'
import CastEditModal from './CastEditModal.vue'
import CastMetaModal from './CastMetaModal.vue'

const members = ref<CastLibraryMember[]>([])
const busy = ref(false)
// 每个角色各自的预览版本号：它被重画 / 改身高之后，那个 iframe 必须换地址重新载入
const epochs = reactive<Record<string, number>>({})

async function load(): Promise<void> {
  const res = await window.castTools.list().catch(() => null)
  if (!res || !res.ok) {
    members.value = []
    toast((res as { message?: string } | null)?.message || '读取角色库失败')
    return
  }
  members.value = res.members || []
}

onMounted(load)

// ===== 卡片右上角「…」菜单（一次只开一个）=====
// 点菜单外面收起：打开时挂一个 document 监听、收起时摘掉（不常驻，也不必给整页加遮罩）。
const menuFor = ref('')
watch(menuFor, (id) => {
  document.removeEventListener('click', closeMenu)
  if (id) document.addEventListener('click', closeMenu)
})
onBeforeUnmount(() => document.removeEventListener('click', closeMenu))
function closeMenu(): void {
  menuFor.value = ''
}
function toggleMenu(id: string): void {
  menuFor.value = menuFor.value === id ? '' : id
}

const active = ref<CastLibraryMember | null>(null)
const editOpen = ref(false)
const editMode = ref<'create' | 'recreate'>('create')
const metaOpen = ref(false)
const actionsOpen = ref(false)

function act(m: CastLibraryMember, kind: 'actions' | 'recreate' | 'meta' | 'copy' | 'remove'): void {
  closeMenu()
  active.value = m
  if (kind === 'actions') { actionsOpen.value = true; return }
  if (kind === 'recreate') { editMode.value = 'recreate'; editOpen.value = true; return }
  if (kind === 'meta') { metaOpen.value = true; return }
  if (kind === 'copy') { void onCopyId(m); return }
  void onRemove(m)
}

// 双击卡片：直接看动作示范（「…」菜单里也有同一项，双击不好发现时用它）
function openActions(m: CastLibraryMember): void {
  closeMenu()
  // 文件缺失（库里有索引、<id>.js 不在）就没代码可演：不给开，免得弹一个空示范
  if (m.missing) return
  active.value = m
  actionsOpen.value = true
}

// 动作示范弹窗里的「改画法…」：先收起示范弹窗，再打开原有的改画法弹窗（不叠两层弹窗）
function onRecreate(m: CastLibraryMember): void {
  actionsOpen.value = false
  active.value = m
  editMode.value = 'recreate'
  editOpen.value = true
}

async function onCopyId(m: CastLibraryMember): Promise<void> {
  const ok = await window.appTools.copyText('cast/' + m.id + '.js').catch(() => false)
  toast(ok ? '已复制：cast/' + m.id + '.js' : '复制失败')
}

async function onRemove(m: CastLibraryMember): Promise<void> {
  if (busy.value) return
  const ok = window.confirm('从全局角色库删除「' + m.name + '」（id ' + m.id + '）？\n\n'
    + '删了就没了：用到它的项目下次生成时会把它的副本一起收走，页面里的 window.__cast["' + m.id + '"] 将不再可用。')
  if (!ok) return
  busy.value = true
  const res = await window.castTools.remove(m.id).catch(() => null)
  busy.value = false
  toast((res && res.ok ? (res.message || '已删除') : ((res as { message?: string } | null)?.message || '删除失败')))
  await load()
}

function openCreate(): void {
  active.value = null
  editMode.value = 'create'
  editOpen.value = true
}

// 弹窗里改过角色（新建 / 改画法 / 改信息）：列表重读，预览按 id 换地址重载
async function onChanged(m: CastResult['member']): Promise<void> {
  epochs[m.id] = (epochs[m.id] || 0) + 1
  await load()
}
</script>
