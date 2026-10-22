<template>
  <div class="card hgen-panel">
    <div class="panel-title"><span class="dot"></span>场景分镜（旁白 + 画面分镜 + 时长提示）</div>
    <div v-if="!scenes.length" class="empty-hint">暂无场景。点「添加场景」自己写；也可以切到「AI 创作」让 AI 写一版。</div>
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
          <textarea v-model="s.visual" class="hgen-subtitle ct-visual" spellcheck="false" placeholder="描述该场景呈现的画面，如：深空背景，标题从上方浮入…"></textarea></div>
        <div class="hgen-row">
          <label class="sel-label" style="flex:none;width:auto">时长提示(秒)</label>
          <input v-model="s.durHint" class="hgen-input" style="flex:none;width:110px" placeholder="可空" />
          <button class="hf-btn" style="padding:6px 12px;font-size:12px" :disabled="i === 0" @click="moveScene(i, -1)">上移</button>
          <button class="hf-btn" style="padding:6px 12px;font-size:12px" :disabled="i === scenes.length - 1" @click="moveScene(i, 1)">下移</button>
          <button class="hf-btn" style="padding:6px 12px;font-size:12px;color:#ff5470;border-color:rgba(255,84,112,.5)" @click="removeScene(i)">删除</button>
        </div>
      </div>
    </template>
    <div class="hgen-actions">
      <button class="hf-btn" @click="addScene">添加场景</button>
      <!-- 没有「保存到项目」按钮：编辑即自动保存（防抖 600ms），这里只显示保存状态 -->
      <span class="ct-save" :class="'is-' + saveState">{{ saveText }}</span>
      <button v-if="saveState === 'error'" class="hf-btn" @click="flushSave">重试</button>
    </div>
    <div class="hgen-tip">场景按顺序播放：<code>旁白</code> 将作为配音文本、并派生字幕；<code>画面分镜</code> 描述该场景对应的视觉画面（供 HTML 生成引用）；<code>时长提示</code>（秒）可空。改动会自动保存到项目，无需手动保存。</div>
  </div>
</template>

<script setup lang="ts">
// pages/ContentPage/SceneEditor.vue —— 「场景编辑」Tab：原内容脚本页的场景卡。
// **编辑即自动保存**（防抖 + 串行 + 失败可重试都在 ./helpers 里），本文件只管渲染与状态展示。
import { computed } from 'vue'
import { scenes, saveState, lastSavedAt, saveError, addScene, removeScene, moveScene, flushSave } from './helpers'

const saveText = computed(() => {
  if (saveState.value === 'saving') return '保存中…';
  if (saveState.value === 'error') return '保存失败：' + (saveError.value || '未知原因');
  if (saveState.value === 'saved') return '已自动保存 ' + lastSavedAt.value;
  return '编辑即自动保存';
});
</script>

<style scoped>
/* 画面分镜输入框：跟着内容自动长高，默认两行字的高度，长到 260px 后内部滚动。
   高度交给 field-sizing: content，因此必须 height: auto 把 .hgen-subtitle 的固定 260px 压回去；
   用户手动拖拽会重新变成一个固定高度、自动长高随之失效，故关掉 resize（有 max-height 兜底）。
   兜底：若哪天 field-sizing 不生效，textarea 退回 HTML 默认的 rows=2 —— 恰好也是两行。 */
.ct-visual {
  height: auto;
  field-sizing: content;
  min-height: calc(2 * 1.7em + 30px); /* 两行文字（line-height 1.7）+ 上下内边距 28px + 上下描边 2px */
  max-height: 260px;
  resize: none;
}
.ct-save {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
  align-self: center;
}
.ct-save.is-saved {
  color: var(--color-success);
}
.ct-save.is-error {
  color: var(--color-danger);
}
</style>
