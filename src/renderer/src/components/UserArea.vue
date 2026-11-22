<template>
  <!-- components/UserArea.vue —— 侧栏三模块之「登录」（压在侧栏底部）
       未登录：直接给一枚「登录 / 注册」按钮，一眼看出登录态，不用点开浮窗才知道登没登；
       已登录：头像 + 名字，点它向上弹浮窗（设置 / 退出登录）。
       登录态字段只读主进程账号域透出的展示态，令牌不出主进程；未登录时本机功能照常可用。 -->
  <div ref="rootEl" class="user-area">
    <button
      v-if="!isLoggedIn"
      type="button"
      class="hf-btn hf-btn-primary user-login-btn"
      title="登录 / 注册（仅邮箱）"
      @click="onLogin"
    >登录 / 注册</button>

    <template v-else>
      <button
        type="button"
        class="user-trigger"
        :class="{ open }"
        :aria-expanded="open"
        :title="triggerTitle"
        @click="toggle"
      >
        <img v-if="avatarUrl" class="user-avatar" :src="avatarUrl" :alt="displayName" />
        <span v-else class="user-avatar user-avatar-text">{{ avatarText }}</span>
        <span class="user-name">{{ displayName }}</span>
      </button>

      <Transition name="user-pop">
        <div v-if="open" class="user-pop" role="menu">
          <button type="button" class="user-pop-item" role="menuitem" @click="goSettings">设置</button>
          <button type="button" class="user-pop-item" role="menuitem" title="退出当前账号" @click="onLogout">退出登录</button>
        </div>
      </Transition>
    </template>
  </div>
</template>

<script setup lang="ts">
// 与侧栏菜单的分工：菜单是「去哪一页」，项目区是「当前做哪个项目」，本区是「关于我 / 应用本身」。
// 设置入口走 goPage('settings')：设置已改为模态弹窗，goPage 见它只开弹窗、不切页（见 pages/index.ts）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { goPage } from '@renderer/pages'
import { toast } from '@renderer/composables/useToast'
import { authUserEmail, authUserName, isLoggedIn, logout } from '@renderer/composables/useAuth'
import { openAuth } from '@renderer/composables/useAuthDialog'

// 头像：暂无头像上传入口，先留空走首字头像；将来接了用户资料，把它换成响应式状态即可
const avatarUrl = '';

const displayName = computed(() => (isLoggedIn.value ? authUserName.value : '未登录'));
const avatarText = computed(() => displayName.value.trim().slice(0, 1) || '用');
const triggerTitle = computed(() =>
  isLoggedIn.value ? `已登录：${authUserEmail.value || authUserName.value}` : '未登录（点开后可登录 / 注册）'
);

const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);

function toggle(): void { open.value = !open.value; }
function close(): void { open.value = false; }

function onLogin(): void { openAuth('login'); }

/** 退出要通知主进程撤销服务端会话，所以是异步的；界面立即切回未登录（按钮变回「登录 / 注册」） */
function onLogout(): void {
  close();
  void logout();
  toast('已退出登录');
}

function goSettings(): void {
  close();
  void goPage('settings');
}

// 点外部关闭：用 pointerdown（比 click 早），这样点在别处的按钮上时先收起菜单、再由那按钮处理点击
function onDocPointerDown(e: PointerEvent): void {
  if (!open.value) return;
  const el = rootEl.value;
  if (el && e.target instanceof Node && el.contains(e.target)) return;
  close();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) close();
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>
