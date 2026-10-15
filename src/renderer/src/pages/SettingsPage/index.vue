<template>
  <div class="settings-layout">
    <!-- 设置分类导航：5 类平级，右侧只渲染当前分类（未选中的不挂载） -->
    <nav class="settings-nav">
      <button
        v-for="item in SETTINGS_NAV_ITEMS"
        :key="item.key"
        type="button"
        class="settings-nav-item"
        :class="{ active: activeSection === item.key }"
        @click="activeSection = item.key"
      >{{ item.label }}<span v-if="item.key === 'update' && updateStage === 'available'" class="settings-nav-dot"></span></button>
    </nav>

    <div class="settings-content">
      <!-- 每个分类一个区块组件（同目录 components/，一区块一文件）；切换分类 = 卸载旧区块、挂载新区块，
           所以各区块的配置在自己 onMounted 里读——没选中的分类不会白跑 IPC -->

      <!-- 语音识别模型：卡片外壳、标题与长说明由本页给（子组件本体只画模型网格与表单），
           所以这一类的挂载点写在这里，其余分类走下面的 component -->
      <div v-if="activeSection === 'whisper'" class="card hgen-panel">
        <div class="panel-title"><span class="dot"></span>语音识别模型（whisper.cpp 字幕转录）</div>
        <div class="hgen-tip">供字幕页「从音频生成字幕」在本机离线识别使用（不消耗 API 额度）。模型按「id ↔ 文件名」一一枚举登记：只识别登记在枚举内的文件名，枚举外的文件视为未知模型。模型文件不随应用打包，首次使用需在此下载（下载源为 HuggingFace 国内镜像 hf-mirror.com，规避 GitHub 直链超时）。点「设为当前使用」后，字幕转录弹窗即使用该档位；其他 ggml 模型可用「添加自定义模型」起名登记。</div>
        <WhisperSection />
      </div>
      <component :is="SECTION_COMPONENTS[activeSection]" v-else-if="activeSection !== 'whisper'" />
    </div><!-- /settings-content -->
  </div>
</template>

<script setup lang="ts">
// pages/SettingsPage/index.vue —— 设置页外壳（原 JS 版 settings 模块 {template,index}.js 移植）
// 5 类平级导航（模型配置 / 语音服务 / 渲染档位 / 语音识别模型 / 应用更新）+ 分类记忆 + 跨页导航意图；
// 各分类的正文都在 ./components/ 下的 Section 组件里，本文件只负责「显示哪一类」。
import { watch } from 'vue'
import {
  activeSection,
  applySectionIntent,
  persistActiveSection,
  updateStage,
  watchSectionIntent
} from './helpers'
import { SETTINGS_NAV_ITEMS } from './constants'
import ModelSection from './components/ModelSection.vue'
import VoiceSection from './components/VoiceSection.vue'
import RenderSection from './components/RenderSection.vue'
import WhisperSection from './components/WhisperSection.vue'
import UpdateSection from './components/UpdateSection.vue'

// 分类 key → 区块组件（`whisper` 不在表里：它由本页模板里那层卡片外壳包着挂载）。
// 用普通对象（编译器按静态属性直接解析，不会把组件定义 reactive 化）
const SECTION_COMPONENTS = {
  model: ModelSection,
  voice: VoiceSection,
  render: RenderSection,
  update: UpdateSection
} as const

// 分类记忆在 localStorage（键名见 ./constants），下次进设置页回到上次的分类
watch(activeSection, (v) => persistActiveSection(v));

// 先落实「带意图跳进来」的分类（例：音色管理 → API Key 设置 → 语音服务），再交由各组件的 onMounted 载入配置
applySectionIntent();
// 兜底：本页已在挂载状态时（不经 goPage 重挂载）也能响应
watchSectionIntent();
</script>
