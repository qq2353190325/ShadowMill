<template>
  <!-- 登录 / 注册弹窗（全局单例，挂在 App.vue 根部）。
       外壳复用全局 .hf-modal 系列（与设置弹窗同一范式），尺寸走 .auth-modal（见 main.css）。
       注册需要「邮箱 + 邮箱验证码 + 密码 + 确认密码」；账号校验在账号服务（demo 后端），
       渲染层只做纯前端校验，请求与令牌都在主进程（见 src/main/account/）。 -->
  <!-- 刻意不响应遮罩点击：登录 / 注册填到一半点到空白处就关闭会丢输入。
       关闭入口只有右上角「×」和 Esc（见脚本里的 onKeydown）。 -->
  <div v-if="visible" class="hf-modal-mask">
    <div class="hf-modal auth-modal">
      <div class="hf-modal-head">
        <span class="hf-modal-title">{{ isRegister ? '注册账号' : '登录' }}</span>
        <button class="hf-modal-close" title="关闭（Esc）" @click="close">×</button>
      </div>

      <div class="hf-modal-body auth-body">
        <!-- 栏位切换：登录 / 注册。注册只有邮箱一种方式，所以不做第三方入口 -->
        <div class="auth-tabs" role="tablist">
          <button
            type="button"
            class="auth-tab"
            :class="{ active: mode === 'login' }"
            role="tab"
            :aria-selected="mode === 'login'"
            @click="switchMode('login')"
          >登录</button>
          <button
            type="button"
            class="auth-tab"
            :class="{ active: mode === 'register' }"
            role="tab"
            :aria-selected="mode === 'register'"
            @click="switchMode('register')"
          >注册</button>
        </div>

        <!-- 用 form 包一层：回车即提交，避免给每个输入框单独绑 keydown -->
        <form class="auth-form" novalidate @submit.prevent="submit">
          <div class="auth-field">
            <label class="auth-label" for="auth-email">邮箱</label>
            <input
              id="auth-email"
              ref="emailEl"
              v-model="email"
              class="hgen-input auth-input"
              type="email"
              autocomplete="username"
              spellcheck="false"
              placeholder="name@example.com"
              :disabled="busy"
              @blur="touched.email = true"
            />
            <span v-if="showEmailError" class="auth-hint is-error">{{ emailError }}</span>
          </div>

          <!-- 邮箱验证码（仅注册）：点「发送验证码」由后端发信，冷却时间用后端返回值 -->
          <div v-if="isRegister" class="auth-field">
            <label class="auth-label" for="auth-code">邮箱验证码</label>
            <div class="auth-code">
              <input
                id="auth-code"
                v-model="code"
                class="hgen-input auth-input"
                inputmode="numeric"
                maxlength="12"
                autocomplete="one-time-code"
                placeholder="6 位数字"
                :disabled="busy"
                @blur="touched.code = true"
              />
              <button
                type="button"
                class="auth-code-send"
                :disabled="sending || cooldown > 0 || busy"
                @click="onSendCode"
              >{{ cooldown > 0 ? `${cooldown} 秒后重发` : '发送验证码' }}</button>
            </div>
            <span v-if="showCodeError" class="auth-hint is-error">{{ codeError }}</span>
            <!-- 开发模式：后端把验证码回显在响应里（仅未打包时主进程才会透传），省得去翻控制台 -->
            <span v-if="devCode" class="auth-devcode">开发模式验证码：{{ devCode }}</span>
            <span v-else-if="codeSent" class="auth-hint">验证码已发送，请查收邮箱（5 分钟内有效）</span>
          </div>

          <div class="auth-field">
            <label class="auth-label" for="auth-password">密码</label>
            <div class="auth-pwd">
              <input
                id="auth-password"
                v-model="password"
                class="hgen-input auth-input"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="isRegister ? 'new-password' : 'current-password'"
                :placeholder="isRegister ? `至少 ${PASSWORD_MIN} 位` : '请输入密码'"
                :disabled="busy"
                @blur="touched.password = true"
              />
              <button
                type="button"
                class="auth-eye"
                :title="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >{{ showPassword ? '隐藏' : '显示' }}</button>
            </div>

            <!-- 强度提示只在注册时给（登录时密码已经定好了，提示没有意义） -->
            <div v-if="isRegister && password" class="auth-strength">
              <i class="auth-strength-track"><b :class="strength.level" :style="{ width: strengthPercent }"></b></i>
              <span class="auth-strength-text">
                强度：{{ strength.label }}
                <em v-if="strength.tip">（{{ strength.tip }}）</em>
              </span>
            </div>
            <span v-if="showPasswordError" class="auth-hint is-error">{{ passwordError }}</span>
          </div>

          <div v-if="isRegister" class="auth-field">
            <label class="auth-label" for="auth-confirm">确认密码</label>
            <input
              id="auth-confirm"
              v-model="confirmPassword"
              class="hgen-input auth-input"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="再输入一次密码"
              :disabled="busy"
              @blur="touched.confirm = true"
            />
            <span v-if="showConfirmError" class="auth-hint is-error">{{ confirmError }}</span>
          </div>

          <!-- 提交级错误：来自账号服务（邮箱已注册 / 账号不存在 / 验证码错误 / 网络不通） -->
          <div v-if="formError" class="auth-error">{{ formError }}</div>

          <button class="auth-submit" type="submit" :disabled="busy">
            {{ busy ? '处理中…' : isRegister ? '注册并登录' : '登录' }}
          </button>
        </form>

        <!-- 如实说明边界：登录是真实服务端校验；未登录也不影响本机功能 -->
        <p class="auth-note">
          登录后可使用云端能力；<b>未登录也能正常使用本机的全部创作功能</b>。
          注册需要邮箱验证码，请先点「发送验证码」。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// components/AuthDialog.vue —— 登录 / 注册弹窗
// 分工：
//   · 本文件 = 表单交互与前端校验（邮箱格式、验证码位数、密码长度/强度、确认密码一致性、发送冷却）；
//   · utils/localAccount.ts = 纯校验函数 + accountApi（转发到主进程 IPC）；
//   · composables/useAuth.ts = 登录态展示字段（localStorage 只存昵称/邮箱/过期时间，不存令牌）；
//   · composables/useAuthDialog.ts = 开关与当前栏位。
// 校验时机：字段失焦（touched）或点提交后才提示，不在用户刚输入时就报错，避免"边打字边红"。
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { toast } from '@renderer/composables/useToast'
import { useAuthDialog } from '@renderer/composables/useAuthDialog'
import { signIn } from '@renderer/composables/useAuth'
import {
  accountApi,
  passwordStrength,
  validateEmail,
  validatePassword
} from '@renderer/utils/localAccount'

const PASSWORD_MIN = 8

const { visible, mode, close } = useAuthDialog()

const isRegister = computed(() => mode.value === 'register')

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const showPassword = ref(false)
const busy = ref(false)
/** 验证码发送中（按钮转「发送中…」，避免连点） */
const sending = ref(false)
/** 重发冷却剩余秒数：以后端返回的 resendAfterSeconds 为准，不写死 60 */
const cooldown = ref(0)
/** 本次是否已成功发过一次（显示"已发送，请查收邮箱"） */
const codeSent = ref(false)
/** 开发模式下后端回显的验证码（仅未打包的应用才会拿到） */
const devCode = ref('')
/** 点过提交后，把所有错误一次性亮出来（含没失焦过的字段） */
const submitted = ref(false)
/** 接口层错误（邮箱已注册 / 验证码错误 / 网络不通 / 服务端异常） */
const formError = ref('')
const touched = reactive({ email: false, password: false, confirm: false, code: false })
const emailEl = ref<HTMLInputElement | null>(null)

// 倒计时定时器：关闭弹窗 / 卸载时清掉，避免后台空转
let cooldownTimer: ReturnType<typeof setInterval> | null = null

// ===== 校验结果 =====
const emailError = computed(() => validateEmail(email.value))
// 登录栏密码只要求非空（不套注册的长度规则，避免老账号被前端挡下）；注册栏按长度/空白校验
const passwordError = computed(() =>
  isRegister.value ? validatePassword(password.value) : password.value ? null : '请输入密码'
)
const confirmError = computed(() => {
  if (!isRegister.value) return null
  if (!confirmPassword.value) return '请再输入一次密码'
  if (confirmPassword.value !== password.value) return '两次输入的密码不一致'
  return null
})
// 验证码：注册必填，4~12 位数字（与后端 RegisterRequest 的校验规则一致）
const codeError = computed(() => {
  if (!isRegister.value) return null
  const value = code.value.trim()
  if (!value) return '请输入邮箱验证码'
  if (!/^\d{4,12}$/.test(value)) return '验证码为 4~12 位数字'
  return null
})
const strength = computed(() => passwordStrength(password.value))
const strengthPercent = computed(() => `${Math.min(100, (strength.value.score / 4) * 100)}%`)

// 失焦即校验（空值也提示）：输入过程中不报错，避免"边打字边红"；点提交时一次性亮出来。
// 邮箱校验不再依赖「非空」这个前置条件——空着离开输入框也应该告诉用户「请输入邮箱」。
const showEmailError = computed(() => (touched.email || submitted.value) && !!emailError.value)
const showPasswordError = computed(
  () => (touched.password || submitted.value) && !!password.value && !!passwordError.value
)
const showConfirmError = computed(
  () => (touched.confirm || submitted.value) && !!confirmPassword.value && !!confirmError.value
)
const showCodeError = computed(
  () => (touched.code || submitted.value) && !!code.value.trim() && !!codeError.value
)

// ===== 交互 =====
function resetForm(): void {
  email.value = ''
  password.value = ''
  confirmPassword.value = ''
  code.value = ''
  showPassword.value = false
  busy.value = false
  sending.value = false
  codeSent.value = false
  devCode.value = ''
  submitted.value = false
  formError.value = ''
  touched.email = false
  touched.password = false
  touched.confirm = false
  touched.code = false
  stopCooldown()
}

function stopCooldown(): void {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
  cooldown.value = 0
}

/** 关闭：清空表单与倒计时，避免下次打开还留着上次输入的密码 */
function handleClose(): void {
  resetForm()
  close()
}

/** 切栏：保留邮箱（用户常在"没注册→去注册"之间来回），清掉密码、验证码与错误 */
function switchMode(next: 'login' | 'register'): void {
  if (mode.value === next) return
  mode.value = next
  password.value = ''
  confirmPassword.value = ''
  code.value = ''
  codeSent.value = false
  devCode.value = ''
  formError.value = ''
  submitted.value = false
  touched.password = false
  touched.confirm = false
  touched.code = false
  stopCooldown()
}

/** 发送验证码：冷却时间用后端返回值（两端策略一改就不会漂） */
async function onSendCode(): Promise<void> {
  if (sending.value || cooldown.value > 0 || busy.value) return
  formError.value = ''
  // 邮箱格式只在输入框下方内联提示（见 showEmailError），不在底部再报一次大块红字；
  // 这里把 touched 打开，等于「点发送」也触发一次失焦级校验。
  touched.email = true
  if (validateEmail(email.value)) return

  sending.value = true
  const result = await accountApi.sendCode(email.value)
  sending.value = false

  if (!result.ok) {
    formError.value = result.message
    return
  }
  codeSent.value = true
  devCode.value = result.devCode || ''
  const seconds = Math.max(1, Math.round(result.resendAfterSeconds || 60))
  cooldown.value = seconds
  stopCooldown()
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) stopCooldown()
  }, 1000)
  toast('验证码已发送')
}

async function submit(): Promise<void> {
  if (busy.value) return
  submitted.value = true
  formError.value = ''
  if (emailError.value || passwordError.value || confirmError.value || codeError.value) return

  busy.value = true
  const result = isRegister.value
    ? await accountApi.register({ email: email.value, password: password.value, code: code.value.trim() })
    : await accountApi.login({ email: email.value, password: password.value })
  busy.value = false

  if (!result.ok) {
    // 邮箱已注册 / 验证码错误 / 密码错误 / 网络不通：文案来自主进程的错误码映射
    formError.value = result.message
    return
  }

  signIn(result.session)
  toast(isRegister.value ? `注册成功，已登录 ${result.session.user.nickname || result.session.user.email}` : `已登录 ${result.session.user.nickname || result.session.user.email}`)
  handleClose()
}

// 改任何字段就清掉上一次的接口错误（重复注册 / 验证码错误），否则用户改了仍看到旧报错
watch([email, password, confirmPassword, code], () => {
  if (formError.value) formError.value = ''
})

// 每次打开：重置表单 + 聚焦邮箱（键盘用户不必自己点一下）
watch(visible, (open) => {
  if (!open) return
  resetForm()
  void nextTick(() => {
    emailEl.value?.focus()
  })
})

// Esc 关闭：与 SettingsDialog 同规则——只有当前没有第二层 mask 时才关自己
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !visible.value) return
  if (e.defaultPrevented) return
  if (document.querySelectorAll('.hf-modal-mask').length > 1) return
  handleClose()
}
document.addEventListener('keydown', onKeydown)
// 组件常驻（App 根部），随应用卸载；这里显式清一次监听与定时器，避免热更新重复绑定
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  stopCooldown()
})
</script>
