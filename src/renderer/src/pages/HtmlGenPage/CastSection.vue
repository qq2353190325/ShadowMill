<template>
  <div class="hgen-block">
    <div class="panel-head">
      <div class="panel-title-sm" style="margin:0">
        角色
        <span class="ch-sub">{{ list.length }} 个 · 勾选的会随需求一起注入页面</span>
      </div>
      <div class="panel-head-actions">
        <button class="hf-btn" :disabled="busy" title="从全局角色库挑角色导入本项目（复制进 cast/，之后归本项目）" @click="openShelf">
          从全局库添加
        </button>
        <button class="hf-btn hf-btn-primary" :disabled="busy" title="调一次模型画一个新角色（与「生成 HTML」无关，随时可加）" @click="openCreate">
          新建角色
        </button>
      </div>
    </div>

    <!-- 一行一个角色：勾选 = 参与本次生成（与素材同一套语义）。
         勾选状态整份回写（project:save-cast），主进程据此把页面里的注入同步掉。 -->
    <div v-if="list.length" class="cast-list">
      <div v-for="(m, i) in list" :key="m.id" class="cast-row" :class="{ off: m.selected === false }">
        <button
          class="mat-check"
          :class="{ on: m.selected !== false }"
          :disabled="busy"
          :title="m.selected === false ? '本次不注入这个角色（点击恢复）' : '本次会注入这个角色（点击取消）'"
          @click="onToggle(m)"
        >{{ m.selected === false ? '' : '✓' }}</button>
        <span class="cast-name" :title="m.name">{{ m.name }}</span>
        <span class="cast-desc" :title="m.desc">{{ m.desc || '（未描述）' }}</span>
        <span class="cast-units">{{ m.units }}u</span>
        <span class="cast-file" :title="'角色代码文件'">{{ relPath(m.id) }}</span>
        <span class="cast-actions">
          <button class="hf-btn ch-pick" :disabled="busy" title="把这个角色存进全局角色库（其他项目可导入）" @click="onPromote(m)">存为全局</button>
          <button class="hf-btn ch-pick" :title="'把「只改角色 ' + m.id + '」填进需求描述，再点「按需求修改」'" @click="onPick(i)">改这个角色</button>
          <button class="hf-btn hf-btn-danger ch-pick" :disabled="busy" title="从本项目移除（cast/<id>.js 一起删；全局库里那份不受影响）" @click="onRemove(m)">移除</button>
        </span>
      </div>
    </div>
    <div v-else class="hgen-tip" style="margin-top:0">
      本项目还没有角色。点右上「新建角色」让 AI 画一个，或「从全局库添加」导入现成的
      {{ libCount ? '（全局库里已有 ' + libCount + ' 个）' : '（全局库还是空的：先在别的项目里点「存为全局」）' }}。
      角色与「单文件 / 章节化」无关，两种形态都会被注入。
    </div>

    <div class="hgen-tip">
      角色是**跨片共用的一份绘制代码**（<code>cast/&lt;id&gt;.js</code>，页面里由 <code>window.__cast["id"]</code> 调用），
      所以同一角色在任何一章都由同一份代码画出来，长相不会各章一个样。「高几 u」是身高比例，改它会让整片里这个人的大小一起变。
    </div>
  </div>

  <!-- 全局角色库：勾选后导入本项目（复制进 cast/） -->
  <div v-if="shelfOpen" class="hf-modal-mask" @click.self="closeShelf">
    <div class="hf-modal" style="width:min(560px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">从全局角色库添加</span>
        <button class="hf-modal-close" title="关闭" @click="closeShelf">×</button>
      </div>
      <div class="hf-modal-body">
        <div v-if="!lib.length" class="hgen-tip" style="margin-top:0">
          全局库还是空的：先在角色列表里点「存为全局」，把某个角色放进全局库，其他项目就能导入它。
        </div>
        <label v-for="m in lib" :key="m.id" class="lib-row" :class="{ off: m.missing }">
          <input v-model="picked" type="checkbox" :value="m.id" :disabled="!!m.missing" />
          <span class="cast-name" :title="m.name">{{ m.name }}</span>
          <span class="cast-desc" :title="m.desc">{{ m.desc || '（未描述）' }}</span>
          <span class="cast-units">{{ m.units }}u</span>
          <span v-if="m.missing" class="lib-missing">文件缺失</span>
        </label>
        <div class="hgen-tip">导入 = 把库里那份**复制**进本项目的 <code>cast/</code>，之后它归本项目管；全局库再改不会影响已导入的项目，要更新就再导入一次。</div>
      </div>
      <div class="hf-modal-foot">
        <button class="hf-btn" @click="closeShelf">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="busy || !picked.length" @click="onImport">导入 {{ picked.length }} 个</button>
      </div>
    </div>
  </div>

  <!-- 新建角色：一次模型调用，与「生成 HTML」完全无关 -->
  <div v-if="createOpen" class="hf-modal-mask" @click.self="closeCreate">
    <div class="hf-modal" style="width:min(520px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">新建角色</span>
        <button class="hf-modal-close" title="关闭" @click="closeCreate">×</button>
      </div>
      <div class="hf-modal-body">
        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:56px">角色名</label>
          <input v-model="draft.title" class="hgen-input" style="flex:1" placeholder="如：主角 / 研究员 / 猫" />
        </div>
        <div class="hgen-block" style="margin-bottom:0">
          <div class="panel-title-sm">外形描述</div>
          <textarea
            v-model="draft.desc"
            class="hgen-subtitle"
            style="min-height:74px"
            spellcheck="false"
            placeholder="外观 / 配色 / 关键特征，例如：戴圆眼镜的小人，米白实验袍，墨线勾边，头发乱"
          ></textarea>
        </div>
        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:56px">身高</label>
          <input v-model.number="draft.units" class="hgen-input" type="number" min="1" max="30" step="0.5" style="width:96px" />
          <span class="ch-sub" style="margin-left:0">u（主角 8、配角 6 这样，多角色比例靠它对齐）</span>
        </div>
        <div class="hgen-row" style="margin-bottom:0">
          <label class="sel-label" style="flex:none;width:56px">笔刷</label>
          <label class="ch-sub" style="margin-left:0;display:flex;align-items:center;gap:6px">
            <input v-model="draft.watercolor" type="checkbox" />
            用水彩笔刷（p5.brush；不勾则用 Canvas 2D 平涂）
          </label>
        </div>

        <!-- 画角色的过程与失败原因就放在弹窗里：页面那条状态条在弹窗**后面**，看不见；
             而 onHtmlProgress 在 preload 里是单订阅（重复注册只替换回调），本组件不能再订一遍，
             所以由父页把 status / thinkText 传下来 -->
        <div v-if="busy || createError" class="hf-status" :class="{ 'hf-error': !!createError }">
          <template v-if="createError">
            <div>{{ createError }}</div>
            <div class="hgen-tip" style="margin-top:6px">
              完整调用记录（含模型的原始回复）：<code>userData/html-agent/cast.jsonl</code>
            </div>
          </template>
          <template v-else>
            <div>正在画角色…{{ thinkText ? '（模型思考中，已收到 ' + thinkText.length + ' 字）' : '' }}</div>
            <div v-if="status">{{ status }}</div>
          </template>
        </div>
      </div>
      <div class="hf-modal-foot">
        <button class="hf-btn" @click="closeCreate">取消</button>
        <button class="hf-btn hf-btn-primary" :disabled="busy || !canCreate" @click="onCreate">
          {{ busy ? '正在画…' : '画这个角色' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/CastSection.vue —— 「项目素材 · 角色」
// 角色是**项目资产**，与「单文件 / 章节化」无关：勾选参与本次生成 → 生成时由应用注入页面
// （单文件模式注入 index.html、章节模式写进骨架），模型只负责调用 window.__cast[...]。
// 角色代码来源有两条，都不经过「生成 HTML」：① 手动「新建角色」（一次模型调用）② 从全局角色库导入。
import { computed, onMounted, ref } from 'vue'
import type { CastLibraryMember, ProjectCastMember } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'

// prompt 是 v-model:prompt 的接收端：本组件只写不读（需求描述由父页维护）；
// status / thinkText 是父页那份「HTML 生成进度」的只读投影——弹窗里的进度与失败原因靠它显示
// （onHtmlProgress 是单订阅，本组件自己再订一次会把父页那条顶掉）
defineProps<{ prompt?: string; status?: string; thinkText?: string }>()
const emit = defineEmits<{ (e: 'update:prompt', v: string): void }>()

const list = computed<ProjectCastMember[]>(() => (appState.project && appState.project.cast) || [])
const busy = ref(false)
const libCount = ref(0)

// 全局库里的角色数只用于空态提示（不参与显示条件——这块**常显**，因为它是素材的一部分）
onMounted(async () => {
  const res = await window.projectTools.listCastLibrary().catch(() => null)
  if (res && res.ok) libCount.value = (res.members || []).length
})

// ===== 勾选参与本次生成 / 移除（整份列表回写） =====
async function saveAll(next: ProjectCastMember[], tip: string): Promise<void> {
  busy.value = true
  // 交给 IPC 的必须是普通对象（appState 里是 reactive Proxy，结构化克隆会抛 DataCloneError）
  const plain = next.map((m) => ({ id: m.id, name: m.name, desc: m.desc, units: m.units, ...(m.uses ? { uses: m.uses } : {}), selected: m.selected !== false }))
  const res = await window.projectTools.saveCast(appState.currentName, plain).catch(() => null)
  busy.value = false
  if (!res || !res.ok) {
    toast((res as { message?: string } | null)?.message || '保存角色表失败')
    return
  }
  await refreshProject()
  if (tip) toast(tip)
}

async function onToggle(m: ProjectCastMember): Promise<void> {
  if (busy.value) return
  const next = list.value.map((x) => (x.id === m.id ? { ...x, selected: x.selected === false } : x))
  await saveAll(next, (m.selected === false ? '本次会注入：' : '本次不注入：') + m.name)
}

async function onRemove(m: ProjectCastMember): Promise<void> {
  if (busy.value) return
  await saveAll(list.value.filter((x) => x.id !== m.id), '已移除角色：' + m.name + '（全局库里那份保留）')
}

// ===== 全局角色库 =====
const shelfOpen = ref(false)
const lib = ref<CastLibraryMember[]>([])
const picked = ref<string[]>([])

async function openShelf(): Promise<void> {
  shelfOpen.value = true
  picked.value = []
  const res = await window.projectTools.listCastLibrary().catch(() => null)
  if (!res || !res.ok) {
    lib.value = []
    toast((res as { message?: string } | null)?.message || '读取全局角色库失败')
    return
  }
  lib.value = res.members || []
  libCount.value = lib.value.length
}
function closeShelf(): void {
  shelfOpen.value = false
  picked.value = []
}

async function onImport(): Promise<void> {
  if (busy.value || !picked.value.length) return
  busy.value = true
  const res = await window.projectTools.importCast(appState.currentName, picked.value.slice()).catch(() => null)
  busy.value = false
  if (!res || !res.ok) {
    toast((res as { message?: string } | null)?.message || '导入失败')
    return
  }
  await refreshProject()
  toast(res.message || '已导入')
  closeShelf()
}

async function onPromote(m: ProjectCastMember): Promise<void> {
  if (busy.value) return
  busy.value = true
  const res = await window.projectTools.promoteCast(appState.currentName, m.id).catch(() => null)
  busy.value = false
  toast((res && res.ok ? (res.message || '已存为全局角色') : ((res as { message?: string } | null)?.message || '存为全局失败')))
}

// ===== 新建角色（一次模型调用，与生成 HTML 无关） =====
const createOpen = ref(false)
const draft = ref({ title: '', desc: '', units: 8, watercolor: false })
// 失败原因常驻在弹窗里：原来只发一条 2.8 秒的 toast，用户看不到就等于没有反馈
// （现网实测：校验的假阳性把一次成功的生成判成失败，用户只看到按钮变回原样）
const createError = ref('')
const canCreate = computed(() => !!(draft.value.title.trim() || draft.value.desc.trim()))

function openCreate(): void {
  createOpen.value = true
  createError.value = ''
  draft.value = { title: '', desc: '', units: 8, watercolor: false }
}
function closeCreate(): void {
  createOpen.value = false
  createError.value = ''
}

async function onCreate(): Promise<void> {
  if (busy.value || !canCreate.value) return
  busy.value = true
  createError.value = ''
  const res = await window.projectTools.newCast(appState.currentName, {
    title: draft.value.title.trim(),
    desc: draft.value.desc.trim(),
    units: Number(draft.value.units) || 8,
    watercolor: draft.value.watercolor
  }).catch(() => null)
  busy.value = false
  if (!res || !res.ok) {
    createError.value = (res as { message?: string } | null)?.message || '新建角色失败（主进程没有返回原因，看 userData/html-agent/cast.jsonl）'
    return
  }
  await refreshProject()
  // 已生成过页面的项目，新角色要等下一次「生成 HTML」才会真的出现在画面里
  const hasPage = !!(appState.project && appState.project.htmlExists)
  toast('已新建角色：' + res.member.name + (hasPage ? '（重新「生成 HTML」后才会画进页面）' : ''))
  closeCreate()
}

function relPath(id: string): string {
  return 'cast/' + id + '.js'
}

// 「只改角色 X」：把 id 与文件名写进需求描述，用户接着补「怎么改」
function onPick(i: number): void {
  const m = list.value[i]
  if (!m) return
  emit('update:prompt', '只改角色 ' + m.id + '（' + relPath(m.id) + '）：\n')
}
</script>
