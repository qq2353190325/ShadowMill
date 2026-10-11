<template>
  <div>
    <StepBar :page="'content'" />
    <div class="card hgen-panel">
      <div class="panel-title"><span class="dot"></span>内容脚本 · 全局视觉风格</div>
      <div class="hgen-row">
        <label class="sel-label" style="flex:none;width:auto">风格</label>
        <input v-model="style" class="hgen-input" style="flex:1" placeholder="全局视觉风格描述，将作用于后续配音 / 字幕 / HTML 生成的整体观感，如：深空科技 Cyber 风、霓虹紫渐变、粒子背景" />
      </div>
      <div class="hgen-tip">描述整支视频的视觉基调。留空 = 未指定，后续节点将按各自提示生成。</div>
    </div>
    <div class="card hgen-panel" style="margin-top:16px">
      <div class="panel-title"><span class="dot"></span>场景分镜（旁白 + 画面分镜 + 时长提示）</div>
      <div v-if="!scenes.length" class="empty-hint">暂无场景。点击「添加场景」开始编写内容脚本。</div>
      <template v-else>
        <div
          v-for="(s, i) in scenes"
          :key="s.id"
          class="hgen-block ct-scene"
          style="border:1px solid rgba(0,212,255,.15);border-radius:10px;padding:14px 16px;margin-top:12px;background:rgba(0,212,255,.03);"
        >
          <div class="panel-title-sm">场景 #{{ i + 1 }}</div>
          <div class="hgen-row"><label class="sel-label" style="flex:none;width:auto">旁白</label>
            <textarea v-model="s.narration" class="hgen-subtitle" spellcheck="false" style="height:84px" placeholder="该场景的旁白/配音文本，字幕将据此生成…"></textarea></div>
          <div class="hgen-row"><label class="sel-label" style="flex:none;width:auto">画面分镜</label>
            <textarea v-model="s.visual" class="hgen-subtitle" spellcheck="false" style="height:64px" placeholder="描述该场景呈现的画面，如：深空背景，标题从上方浮入…"></textarea></div>
          <div class="hgen-row">
            <label class="sel-label" style="flex:none;width:auto">时长提示(秒)</label>
            <input v-model="s.durHint" class="hgen-input" style="flex:none;width:110px" placeholder="可空" />
            <button class="hf-btn" style="padding:6px 12px;font-size:12px" :disabled="i === 0" @click="move(i, -1)">上移</button>
            <button class="hf-btn" style="padding:6px 12px;font-size:12px" :disabled="i === scenes.length - 1" @click="move(i, 1)">下移</button>
            <button class="hf-btn" style="padding:6px 12px;font-size:12px;color:#ff5470;border-color:rgba(255,84,112,.5)" @click="remove(i)">删除</button>
          </div>
        </div>
      </template>
      <div class="hgen-actions">
        <button class="hf-btn" @click="add">添加场景</button>
        <button class="hf-btn hf-btn-primary" @click="save">保存到项目</button>
      </div>
      <div class="hgen-tip">场景按顺序播放：<code>旁白</code> 将作为配音文本、并派生字幕；<code>画面分镜</code> 描述该场景对应的视觉画面（供 HTML 生成引用）；<code>时长提示</code>（秒）可空。保存后项目链路「内容脚本」节点自动点亮。已有项目无内容脚本时默认展示一个空场景。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// pages/ContentPage/index.vue —— 内容脚本页（原 JS 版 content 模块 {template,index}.js 移植）
// v-model 直接绑定场景对象，替代原 innerHTML + collect() 手工收集；StepBar 响应式刷新替代 renderStepBar 重调。
import { onMounted, ref } from 'vue'
import { appState, refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import StepBar from '@renderer/components/StepBar.vue'

interface Scene {
  id: string
  narration: string
  visual: string
  durHint: string
}

const style = ref('');
const scenes = ref<Scene[]>([]);

function emptyScene(): Scene {
  return { id: 'scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), narration: '', visual: '', durHint: '' };
}

function load(): void {
  const content = (appState.project && appState.project.content) || { style: '', scenes: [] };
  style.value = content.style || '';
  scenes.value = (Array.isArray(content.scenes) ? content.scenes : []).map((s) => {
    const item = (s && typeof s === 'object') ? s as Record<string, unknown> : {};
    return {
      id: (typeof item.id === 'string' && item.id.trim()) ? item.id.trim() : ('scene-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)),
      narration: typeof item.narration === 'string' ? item.narration : '',
      visual: typeof item.visual === 'string' ? item.visual : '',
      durHint: (item.durHint === undefined || item.durHint === null) ? '' : String(item.durHint)
    };
  });
  if (!scenes.value.length) scenes.value.push(emptyScene());
}

onMounted(load);

function add(): void {
  scenes.value.push(emptyScene());
}
function remove(i: number): void {
  scenes.value.splice(i, 1);
  if (!scenes.value.length) scenes.value.push(emptyScene());
}
function move(i: number, delta: number): void {
  const j = i + delta;
  if (j < 0 || j >= scenes.value.length) return;
  const t = scenes.value[i];
  scenes.value[i] = scenes.value[j];
  scenes.value[j] = t;
}

async function save(): Promise<void> {
  const content = { style: style.value.trim(), scenes: scenes.value.map((s) => ({ id: s.id, narration: s.narration, visual: s.visual, durHint: s.durHint })) };
  const res = await window.projectTools.saveContent(appState.currentName, content);
  if (!res || !res.ok) { toast((res as { message?: string })?.message || '保存失败'); return; }
  await refreshProject();
  toast('内容脚本已保存：' + scenes.value.length + ' 个场景' + (content.style ? '，风格「' + content.style + '」' : ''));
}
</script>
