<template>
  <!-- 左下角用户区：头像 + 姓名；点它向上弹浮窗菜单（「设置」+ 登录状态项） -->
  <div ref="rootEl" class="user-area">
    <button
      type="button"
      class="user-trigger"
      :class="{ open, 'is-offline': !isLoggedIn }"
      :aria-expanded="open"
      :title="triggerTitle"
      @click="toggle"
    >
      <!-- 有头像图就用图；没有（当前就属于这种）落回首字头像：取姓名首字，渐变底 + 深色字 -->
      <img v-if="avatarUrl" class="user-avatar" :src="avatarUrl" :alt="displayName" />
      <span v-else class="user-avatar user-avatar-text">{{ avatarText }}</span>
      <span class="user-name">{{ displayName }}</span>
    </button>

    <Transition name="user-pop">
      <div v-if="open" class="user-pop" role="menu">
        <!-- 第一项固定是「设置」：点了打开设置弹窗（不再切页） -->
        <button type="button" class="user-pop-item" role="menuitem" @click="goSettings">设置</button>
        <!-- 第二项是登录状态项：文案与动作都随登录态切换（未登录 → 登录；已登录 → 退出登录） -->
        <button
          type="button"
          class="user-pop-item"
          role="menuitem"
          :title="isLoggedIn ? '退出当前账号' : '登录 / 注册（仅邮箱）'"
          @click="onAuthClick"
        >
          {{ isLoggedIn ? '退出登录' : '登录' }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// components/UserArea.vue —— 侧栏左下角的用户信息区（头像 + 姓名 + 点击浮窗菜单）
// 与侧栏菜单的分工：菜单是「去哪一页」，用户区是「关于我 / 应用本身」的入口，
// 所以它在视觉上压到侧栏底部（.menu 是 flex:1，本区 flex:none），浮窗朝上开，不挤占菜单高度。
//
// 设置入口为什么走 goPage('settings')：设置已改为模态弹窗（components/SettingsDialog.vue），
// goPage 见 'settings' 只开弹窗、不切页（见 pages/index.ts），这里与侧栏「设置」项是同一条路。
//
// 登录态：账号服务在主进程（src/main/account/），渲染层只读展示字段（isLoggedIn / authUserName /
// authUserEmail）与调 logout()，令牌不出主进程。未登录时本机功能照常可用。
// 状态在三处体现：用户区姓名（未登录「未登录」/ 已登录「昵称或邮箱 @ 前的用户名」）、首字头像、
// 浮窗第二项的文案（未登录「登录」→ 打开登录/注册弹窗 AuthDialog；已登录「退出登录」）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { goPage } from '@renderer/pages'
import { toast } from '@renderer/composables/useToast'
import { authUserEmail, authUserName, isLoggedIn, logout } from '@renderer/composables/useAuth'
import { openAuth } from '@renderer/composables/useAuthDialog'

// 头像：暂无头像上传入口，先留空走首字头像；将来接了用户资料，把它换成响应式状态即可
const avatarUrl = '';

// 展示名随登录态变化：已登录用账号名（兜底「用户」），未登录显式说明「未登录」
const displayName = computed(() => (isLoggedIn.value ? authUserName.value : '未登录'));

// 首字头像：展示名首字（未登录「未」；已登录取邮箱 @ 前用户名的首字母）。取首字即可，不必区分大小写
const avatarText = computed(() => displayName.value.trim().slice(0, 1) || '用');

// 悬停提示补一句状态，避免只看姓名时对「未登录」这行字理解成昵称
const triggerTitle = computed(() =>
  isLoggedIn.value ? `已登录：${authUserEmail.value || authUserName.value}` : '未登录（点开后可登录 / 注册）'
);

const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);

function toggle(): void { open.value = !open.value; }
function close(): void { open.value = false; }

/** 点「设置」：先收起浮窗，再打开设置弹窗（弹窗是模态层，留着浮窗会显得两层叠在一起） */
function goSettings(): void {
  close();
  void goPage('settings');
}

/** 点登录状态项：未登录 → 打开登录/注册弹窗（components/AuthDialog.vue）；
 *  已登录 → 退出（退出要通知主进程撤销服务端会话，所以是异步的；界面立即切回未登录） */
function onAuthClick(): void {
  close();
  if (isLoggedIn.value) {
    void logout();
    toast('已退出登录');
    return;
  }
  openAuth('login');
}

// 点外部关闭：用 pointerdown（比 click 早），这样点在别处的按钮上时先收起菜单、再由那按钮处理点击，
// 不会出现「菜单还盖在上面」的错乱；点在用户区内部则交给自己的 click 处理（含开合与菜单项）。
function onDocPointerDown(e: PointerEvent): void {
  if (!open.value) return;
  const el = rootEl.value;
  if (el && e.target instanceof Node && el.contains(e.target)) return;
  close();
}

// Esc 收起浮窗（设置弹窗自己的 Esc 由 SettingsDialog 处理：它只在 mask 层数 =1 时关自己）
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
