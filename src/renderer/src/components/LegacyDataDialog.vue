<template>
  <!-- components/LegacyDataDialog.vue —— 「发现旧版本数据」弹窗（应用内，沿用科技主题弹窗体系） -->
  <div class="hf-modal-mask" v-show="visible" @click.self="later">
    <div class="hf-modal" style="width:min(560px,92vw)">
      <div class="hf-modal-head">
        <span class="hf-modal-title">发现旧版本数据</span>
        <button class="hf-modal-close" title="稍后再说" :disabled="busy" @click="later">×</button>
      </div>

      <div class="hf-modal-body">
        <div class="panel-title-sm" style="margin-top:0">旧数据目录</div>
        <div class="path-line">{{ info ? info.dir : '' }}</div>
        <div class="hgen-tip">其中包含：{{ entryText || '—' }}</div>

        <div class="panel-title-sm">要怎么处理？</div>
        <ul class="opt-list">
          <li><b>迁移过来</b>：把上面的内容移动到当前数据目录；两边都有的文件保留当前这一份，<b>不会覆盖</b>。</li>
          <li><b>删除旧数据</b>：永久删除整个旧目录，<span class="danger-text">不可恢复</span>。</li>
          <li><b>稍后再说</b>：本次不处理，下次启动会再问一次。</li>
        </ul>
      </div>

      <div class="hf-modal-foot">
        <button class="hf-btn" :disabled="busy" @click="later">稍后再说</button>
        <button class="hf-btn danger" :disabled="busy" @click="doDelete">删除旧数据</button>
        <button class="hf-btn hf-btn-primary" :disabled="busy" @click="doMigrate">{{ busy ? '处理中…' : '迁移过来' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 交互约定：点遮罩 / × / 稍后再说 = 都不处理（下次启动再问，写一条日志）。
// 迁移成功后顺手 refreshProject()，项目列表立刻出现，不用让用户重开应用。
import { refreshProject } from '@renderer/composables/useAppStore'
import { toast } from '@renderer/composables/useToast'
import { useLegacyData } from '@renderer/composables/useLegacyData'

const { info, visible, busy, entryText, resolve } = useLegacyData();

async function later(): Promise<void> {
  if (busy.value) return;
  await resolve('later');
}

async function doMigrate(): Promise<void> {
  if (busy.value) return;
  const r = await resolve('migrate');
  if (!r) { toast('迁移失败：主进程无响应'); return; }
  // 部分成功也可能已经带过来一些项目，所以成败都刷一次列表
  await refreshProject();
  if (r.ok) {
    toast('已迁移 ' + (r.moved || 0) + ' 项' + (r.skipped ? '，保留当前目录里已有的 ' + r.skipped + ' 项' : ''));
  } else {
    toast(r.message || '迁移未完成，旧目录已保留');
  }
}

async function doDelete(): Promise<void> {
  if (busy.value) return;
  const r = await resolve('delete');
  if (!r || !r.ok) { toast((r && r.message) || '删除失败'); return; }
  toast('旧数据目录已删除');
}
</script>

<style scoped>
/* 路径：等宽字体 + 主色，长路径要能断行 */
.path-line {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  color: var(--color-primary);
  word-break: break-all;
  padding: 6px 10px;
  border-radius: var(--radius-btn);
  background: rgba(0, 212, 255, .08);
  border: 1px solid rgba(0, 212, 255, .25);
}
.opt-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-primary);
}
.opt-list b {
  color: var(--color-primary);
  font-weight: 600;
}
.danger-text {
  color: var(--color-danger);
}
/* 危险动作：复用次要按钮骨架，只换描边与 hover 光色（含 hover 重写，避免被 .hf-btn:hover 顶掉） */
.hf-btn.danger {
  color: var(--color-danger);
  border-color: rgba(255, 77, 109, .55);
}
.hf-btn.danger:hover:not(:disabled) {
  background: rgba(255, 77, 109, .16);
  box-shadow: 0 0 8px rgba(255, 77, 109, .45);
}
</style>
