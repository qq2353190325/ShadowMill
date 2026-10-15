<template>
  <div class="hgen-block">
    <div class="panel-head">
      <div class="panel-title-sm" style="margin:0">
        项目素材
        <span class="mat-count">勾选的会随需求一起交给 Agent</span>
      </div>
      <div class="panel-head-actions">
        <span class="mat-count" :title="'图片 + 视频合计上限 ' + MAX_MATERIALS + ' 个'">{{ mats.length }} / {{ MAX_MATERIALS }}</span>
      </div>
    </div>

    <!-- 图片组：缩略图网格，勾选框与移除键叠在卡片两角 -->
    <div class="panel-title" style="margin:0;letter-spacing:1px"><span class="dot dot-img"></span>图片 · {{ images.length }} 张</div>
    <div class="mat-grid">
      <div v-for="m in images" :key="m.id" class="mat-card" :class="{ off: !m.selected }">
        <button
          class="mat-check"
          :class="{ on: m.selected }"
          :disabled="busy"
          :title="m.selected ? '本次生成会带上这张图片（点击取消）' : '本次生成不带这张图片（点击选中）'"
          @click="onToggle(m)"
        >{{ m.selected ? '✓' : '' }}</button>
        <button class="hf-btn hf-btn-danger mat-del" :disabled="busy" title="从素材列表移除（项目内的文件保留）" @click="onRemove(m)">移除</button>
        <div class="mat-thumb"><img :src="thumbUrl(m.file)" :alt="m.label" /></div>
        <div class="mat-meta">
          <div class="mat-name" :title="m.label">{{ m.label }}</div>
          <div class="mat-path" :title="m.file">{{ m.file }}</div>
        </div>
      </div>
      <button class="mat-add" :disabled="busy" title="选择本地图片导入项目（可多选）" @click="onAdd('image')"><i>＋</i>添加图片…</button>
    </div>

    <!-- 视频组 -->
    <div class="panel-title" style="margin:16px 0 0;letter-spacing:1px"><span class="dot"></span>视频 · {{ videos.length }} 个</div>
    <div class="mat-grid">
      <div v-for="m in videos" :key="m.id" class="mat-card" :class="{ off: !m.selected }">
        <button
          class="mat-check"
          :class="{ on: m.selected }"
          :disabled="busy"
          :title="m.selected ? '本次生成会带上这个视频（点击取消）' : '本次生成不带这个视频（点击选中）'"
          @click="onToggle(m)"
        >{{ m.selected ? '✓' : '' }}</button>
        <button class="hf-btn hf-btn-danger mat-del" :disabled="busy" title="从素材列表移除（项目内的文件保留）" @click="onRemove(m)">移除</button>
        <div class="mat-thumb"><span class="mat-play">▶</span></div>
        <div class="mat-meta">
          <div class="mat-name" :title="m.label">{{ m.label }}</div>
          <div class="mat-path" :title="m.file">{{ m.file }}</div>
        </div>
      </div>
      <button class="mat-add" :disabled="busy" title="选择本地视频导入项目" @click="onAdd('video')"><i>＋</i>添加视频…</button>
      <!-- 提取原声为背景音频：入口临时下线（多视频下「提哪一条」要按素材 id 重做，主进程 handler 仍读
           历史字段 project.videoMaterial 且一行未改）。恢复时把下面这行按钮放进本组的 .panel-head-actions：
           <button class="hf-btn" :disabled="!videos.length" title="把视频里的声音提取出来，作为背景音频" @click="onExtractAudio()">{{ extractText }}</button> -->
    </div>

    <div class="hgen-tip">
      勾选的素材会随需求一起交给 Agent：图片按 <code>images/文件名</code>、视频按 <code>video/文件名</code> 的相对路径写进页面。
      上限 {{ MAX_MATERIALS }} 个（图片 + 视频合计），支持 {{ extText }}；「移除」只把素材从列表里摘掉，<b>项目目录里的文件会保留</b>。
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/HtmlGenPage/MaterialsSection.vue —— 「项目素材」区块（图片 / 视频素材库）
// 自包含：不接 props、不 emit —— 素材状态就是 appState.project.materials（模块级 reactive 单例），
// 每次落盘后调 refreshProject() 刷新，页面上的计数、生成时的取材都自动跟着变。
// 增删改一律经主进程（复制入库 + 规范化 + 上限校验），本组件不直接碰文件系统。
import { computed, ref } from 'vue'
import { IMAGE_MATERIAL_EXTS, MAX_MATERIALS, VIDEO_MATERIAL_EXTS } from '@shared/constants'
import type { ProjectMaterial, ProjectMaterialKind } from '@shared/types'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { previewUrl } from '@renderer/utils/url'

// 一轮写操作未结束时禁用全部按钮：避免并发「读-改-写」把列表互相冲掉
const busy = ref(false);
const mats = computed<ProjectMaterial[]>(() => (appState.project && appState.project.materials) || []);
const images = computed(() => mats.value.filter((m) => m.kind === 'image'));
const videos = computed(() => mats.value.filter((m) => m.kind === 'video'));
const extText = IMAGE_MATERIAL_EXTS.join('/') + ' 与 ' + VIDEO_MATERIAL_EXTS.join('/');

// 缩略图走 hgpreview:// 协议（只允许读项目目录内的文件），拼装统一走 utils/url.ts
function thumbUrl(file: string): string {
  return previewUrl(appState.currentName, file);
}

// 交给 IPC 的必须是**普通对象**：mats 来自 reactive 单例，元素是 Proxy，直接传会在结构化克隆时抛
// DataCloneError（历史事故见 CHANGELOG #11「下载运行环境点了毫无反应」），所以这里显式铺平成新对象。
function plainList(list: ProjectMaterial[]): ProjectMaterial[] {
  return list.map((m) => ({ id: m.id, kind: m.kind, file: m.file, label: m.label, selected: m.selected, addedAt: m.addedAt }));
}

// 整份列表回写（移除与勾选共用一条通道）；成功即刷新全局状态，失败把原因说出来
async function save(list: ProjectMaterial[], tip: string): Promise<boolean> {
  busy.value = true;
  const res = await window.projectTools.saveMaterials(appState.currentName, plainList(list)).catch(() => null);
  busy.value = false;
  if (!res || !res.ok) {
    toast((res as { message?: string } | null)?.message || '保存素材失败');
    return false;
  }
  await refreshProject();
  if (tip) toast(tip);
  return true;
}

async function onToggle(m: ProjectMaterial): Promise<void> {
  if (busy.value) return;
  const next = mats.value.map((x) => (x.id === m.id ? { ...x, selected: !x.selected } : x));
  await save(next, (m.selected ? '已取消参与生成：' : '已设为参与生成：') + m.label);
}

async function onRemove(m: ProjectMaterial): Promise<void> {
  if (busy.value) return;
  await save(mats.value.filter((x) => x.id !== m.id), '已移除素材：' + m.label + '（项目内文件保留）');
}

// 选文件 → 复制入库 → 登记（新素材默认参与生成，落在所属分组末尾）
async function onAdd(kind: ProjectMaterialKind): Promise<void> {
  if (busy.value) return;
  const paths = await window.projectTools.pickMedia(kind).catch(() => [] as string[]);
  if (!paths || !paths.length) return;
  busy.value = true;
  const res = await window.projectTools.addMaterials(appState.currentName, paths).catch(() => null);
  busy.value = false;
  if (!res || !res.ok) {
    toast((res as { message?: string } | null)?.message || '添加素材失败');
    return;
  }
  await refreshProject();
  // 主进程在「部分成功」（有文件被跳过）时会带回 message，优先用它
  const msg = (res as { message?: string }).message;
  toast(msg || ('已添加' + (kind === 'image' ? '图片' : '视频') + '素材 ×' + paths.length));
}

// ===== 提取视频原声为背景音频（入口临时下线，恢复时取消注释本段，并把上面模板注释里的按钮放回视频组）=====
// 多素材化后「提哪一条视频」需要按素材 id 重做（主进程 handler 仍读历史字段 project.videoMaterial）；
// 本轮按用户决定只隐藏界面入口：IPC 频道、preload 方法与主进程 handler 一行未改。
// import { useEnvGate } from '@renderer/composables/useEnvGate'
// const envGate = useEnvGate();
// const extractText = ref('提取原声为背景音频');
// async function onExtractAudio(skipEnvGuard = false): Promise<void> {
//   if (!videos.value.length) { toast('还没有视频素材：点「添加视频…」导入'); return; }
//   // 提取音轨要 ffmpeg 包（不随安装包）：缺则先问用户；点「继续」回到这里时不再弹框
//   if (!skipEnvGuard) {
//     const g = await envGate.guard(['ffmpeg'], '提取视频原声', () => { void onExtractAudio(true); });
//     if (!g.ok) return;
//   }
//   extractText.value = '提取中…';
//   const res = await window.projectTools.extractVideoAudio(appState.currentName).catch(() => null);
//   extractText.value = '提取原声为背景音频';
//   if (!res || !res.ok) {
//     const fail = res as { message?: string; needPacks?: ('ffmpeg' | 'hyperframes')[] } | null;
//     if (fail && fail.needPacks && fail.needPacks.length) {
//       toast(fail.message || '需要先下载运行环境');
//       void envGate.guard(fail.needPacks, '提取视频原声', () => { void onExtractAudio(true); });
//       return;
//     }
//     toast((fail && fail.message) || '提取失败');
//     return;
//   }
//   await refreshProject();
//   toast('已提取原声并设为背景音频：' + res.audioFile);
// }
</script>
