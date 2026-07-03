<template>
  <div
    class="forgot-password-page"
    :class="{
      'forgot-password-page--mobile': !isDesktop,
      'forgot-password-page--dark': isDark,
    }"
  >
    <div class="forgot-password-background" />

    <main class="forgot-password-shell surface-card">
      <header class="shell-header">
        <h1>{{ i18ns.t('forgotPasswordPage.title') }}</h1>
        <p>{{ i18ns.t('forgotPasswordPage.subtitle') }}</p>
      </header>

      <el-alert
        class="account-hint"
        :title="i18ns.t('forgotPasswordPage.accountHint')"
        type="info"
        :closable="false"
        show-icon
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        status-icon
        :validate-on-rule-change="false"
        @submit.prevent
      >
        <el-form-item :label="i18ns.t('username')" prop="username">
          <el-input
            v-model="form.username"
            :placeholder="i18ns.t('placeholder.enterUsername')"
            autocomplete="username"
            maxlength="30"
            @keyup.enter="handleSendCode"
          />
        </el-form-item>

        <el-form-item :label="i18ns.t('email')" prop="email">
          <el-input
            v-model="form.email"
            :placeholder="i18ns.t('placeholder.enterEmail')"
            autocomplete="email"
            maxlength="200"
            @keyup.enter="handleSendCode"
          />
        </el-form-item>

        <el-form-item
          :label="i18ns.t('loginOrRegisterPage.verificationCode')"
          prop="verificationCode"
        >
          <div class="code-row">
            <SegmentedCodeInput
              v-model="form.verificationCode"
              class="code-input"
              :length="6"
              :disabled="submitLoading"
              :aria-label="i18ns.t('loginOrRegisterPage.enterVerificationCode')"
              @enter="handleSubmit"
            />
            <el-button
              class="send-code-button"
              :disabled="sendCodeDisabled"
              :loading="sendCodeLoading || captchaWarmupRunning"
              @click="handleSendCode"
            >
              {{ sendCodeButtonText }}
            </el-button>
          </div>
        </el-form-item>

        <el-form-item :label="i18ns.t('newPassword')" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            :placeholder="i18ns.t('placeholder.enterPassword')"
            autocomplete="new-password"
            show-password
            maxlength="50"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-form-item :label="i18ns.t('confirmPassword')" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            :placeholder="i18ns.t('placeholder.enterConfirmPassword')"
            autocomplete="new-password"
            show-password
            maxlength="50"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <p class="password-hint">
          {{ i18ns.t('forgotPasswordPage.passwordLengthHint') }}
        </p>

        <div class="form-actions">
          <div class="form-actions-right">
            <el-button @click="handleReset">{{ i18ns.t('reset') }}</el-button>
            <el-button
              type="primary"
              :loading="submitLoading || captchaWarmupRunning"
              @click="handleSubmit"
            >
              {{ submitButtonText }}
            </el-button>
          </div>
        </div>
      </el-form>

      <div class="footer-link">
        <span>{{ i18ns.t('forgotPasswordPage.rememberedPassword') }}</span>
        <el-button type="primary" link @click="handleBackToLogin">
          {{ i18ns.t('forgotPasswordPage.backToLogin') }}
        </el-button>
      </div>

      <div class="captcha-notice">
        {{ i18ns.t('loginOrRegisterPage.captchaNotice') }}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">
          {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
        </a>
        {{ i18ns.t('loginOrRegisterPage.and') }}
        <a href="https://policies.google.com/terms" target="_blank" rel="noopener">
          {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
        </a>
        {{ i18ns.t('loginOrRegisterPage.apply') }}
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import SegmentedCodeInput from '@/components/auth/SegmentedCodeInput.vue'
import { USERNAME_PATTERN } from '@/constant/pattern'
import { CustomCode } from '@/constant/custom-code'
import { i18ns } from '@/locales'
import router from '@/router'
import { authorizationService } from '@/service/authorizationService'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import { md5 } from '@/utils/encryption'
import { Notification } from '@/utils/notification'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { type FormInstance, type FormRules } from 'element-plus'
import { usePageDevice } from '@/composables/usePageDevice'
import { warmupCaptchaTrust } from '@/service/captchaDialogService'
import { getLoginRoute, getSafeAuthRedirect } from '@/utils/auth-routes'

const route = useRoute()
const { isDesktop } = usePageDevice()
const themeToggleStore = useThemeToggleStore()
const isDark = themeToggleStore.useIsDark()
const waterMarkTextStore = useWaterMarkTextStore()
const formRef = ref<FormInstance>()
const sendCodeLoading = ref(false)
const submitLoading = ref(false)
const captchaVerifying = ref(false)
const captchaWarmupRunning = ref(false)
const codeCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

const form = reactive({
  username: '',
  email: '',
  verificationCode: '',
  newPassword: '',
  confirmPassword: '',
})

const rules: FormRules = {
  username: [
    { required: true, message: i18ns.t('placeholder.enterUsername'), trigger: 'blur' },
    {
      pattern: USERNAME_PATTERN,
      message: i18ns.t('message.error.invalidUsernameInRegister'),
      trigger: 'blur',
    },
  ],
  email: [
    { required: true, message: i18ns.t('placeholder.enterEmail'), trigger: 'blur' },
    {
      type: 'email',
      message: i18ns.t('message.error.invalidEmail'),
      trigger: ['blur', 'change'],
    },
  ],
  verificationCode: [
    {
      required: true,
      message: i18ns.t('loginOrRegisterPage.enterVerificationCode'),
      trigger: 'blur',
    },
    {
      len: 6,
      message: i18ns.t('loginOrRegisterPage.enterVerificationCode'),
      trigger: ['blur', 'change'],
    },
  ],
  newPassword: [
    { required: true, message: i18ns.t('placeholder.enterPassword'), trigger: 'blur' },
    {
      min: 6,
      max: 50,
      message: i18ns.t('forgotPasswordPage.passwordLengthHint'),
      trigger: ['blur', 'change'],
    },
  ],
  confirmPassword: [
    { required: true, message: i18ns.t('placeholder.enterConfirmPassword'), trigger: 'blur' },
    {
      validator: (_, value, callback) => {
        if (!value) {
          callback(new Error(i18ns.t('placeholder.enterConfirmPassword')))
        } else if (value !== form.newPassword) {
          callback(new Error(i18ns.t('message.error.passwordsDoNotMatch')))
        } else {
          callback()
        }
      },
      trigger: ['blur', 'change'],
    },
  ],
}

const sendCodeDisabled = computed(
  () =>
    sendCodeLoading.value ||
    submitLoading.value ||
    codeCooldown.value > 0 ||
    !form.username.trim() ||
    !form.email.trim(),
)

const sendCodeButtonText = computed(() => {
  if (sendCodeLoading.value && captchaVerifying.value) {
    return i18ns.t('loginOrRegisterPage.verifyingCaptcha')
  }

  if (codeCooldown.value > 0) {
    return i18ns.t('loginOrRegisterPage.resendIn', { seconds: codeCooldown.value })
  }

  return i18ns.t('loginOrRegisterPage.sendVerificationCode')
})

const submitButtonText = computed(() => {
  if (submitLoading.value && captchaVerifying.value) {
    return i18ns.t('loginOrRegisterPage.verifyingCaptcha')
  }

  return i18ns.t('forgotPasswordPage.submit')
})

const clearCooldown = () => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
  codeCooldown.value = 0
}

const startCooldown = () => {
  clearCooldown()
  codeCooldown.value = 60
  cooldownTimer = setInterval(() => {
    codeCooldown.value -= 1
    if (codeCooldown.value <= 0) {
      clearCooldown()
    }
  }, 1000)
}

const getSafeRedirect = (): string | undefined => {
  return getSafeAuthRedirect(route.query.redirect, {
    blockedExactPaths: ['/login', '/forgot-password'],
    blockedPrefixes: ['/auth/verify'],
  })
}

const getLoginTarget = () => {
  const redirect = getSafeRedirect()
  return getLoginRoute(redirect)
}

const handleBackToLogin = () => {
  void router.push(getLoginTarget())
}

const getErrorMeta = (error: unknown) => {
  const responseData =
    error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { data?: any } }).response?.data
      : undefined

  const code =
    responseData?.code ??
    (error && typeof error === 'object' && 'code' in error
      ? (error as { code?: number }).code
      : undefined)

  const message =
    typeof responseData?.message === 'string'
      ? responseData.message
      : error instanceof Error
        ? error.message
        : ''

  const retryAfter =
    typeof responseData?.data?.retryAfter === 'number' ? responseData.data.retryAfter : undefined

  return { code, message, retryAfter }
}

const isUsernameEmailMismatch = (message?: string) =>
  !!message &&
  (message.includes('用户名与邮箱不匹配') ||
    message.toLowerCase().includes('username') ||
    message.toLowerCase().includes('email'))

const notifyRequestError = (error: unknown, fallbackMessage: string) => {
  const { code, message, retryAfter } = getErrorMeta(error)

  if (code === CustomCode.TOO_MANY_REQUESTS) {
    const minutes = retryAfter ? Math.ceil(retryAfter / 60) : undefined
    const detail = minutes
      ? `${message || i18ns.t('loginOrRegisterPage.tooManyRequestsFallback')}${i18ns.t('loginOrRegisterPage.retryAfterMinutes', { minutes })}`
      : message || i18ns.t('loginOrRegisterPage.tooManyRequestsFallback')
    Notification.notify(i18ns.t('error'), detail, 'error')
    return
  }

  if (code === CustomCode.SMTP_NOT_CONFIGURED) {
    Notification.notify(i18ns.t('error'), i18ns.t('message.error.smtpNotConfigured'), 'error')
    return
  }

  if (code === CustomCode.VERIFICATION_CODE_INVALID) {
    Notification.notify(i18ns.t('error'), i18ns.t('message.error.verificationCodeInvalid'), 'error')
    return
  }

  if (code === CustomCode.ACCOUNT_DISABLED) {
    Notification.notify(i18ns.t('error'), i18ns.t('message.error.accountDisabled'), 'error')
    return
  }

  if (isUsernameEmailMismatch(message)) {
    Notification.notify(
      i18ns.t('error'),
      i18ns.t('forgotPasswordPage.usernameEmailMismatch'),
      'error',
    )
    return
  }

  if (message?.toLowerCase?.().includes('captcha') || message?.includes('人机验证')) {
    Notification.notify(
      i18ns.t('error'),
      message || i18ns.t('loginOrRegisterPage.captchaFailedFallback'),
      'error',
    )
    return
  }

  Notification.notify(i18ns.t('error'), message || fallbackMessage, 'error')
}

const handleSendCode = async () => {
  if (!formRef.value || sendCodeDisabled.value) return

  sendCodeLoading.value = true
  try {
    const valid = await formRef.value
      .validateField(['username', 'email'])
      .then(() => true)
      .catch(() => false)

    if (!valid) {
      Notification.notify(i18ns.t('error'), i18ns.t('message.error.formValidationFailed'), 'error')
      return
    }

    await authorizationService.sendPasswordResetCode(
      form.username.trim(),
      form.email.trim(),
      () => {
        captchaVerifying.value = true
      },
      () => {
        captchaVerifying.value = false
      },
    )

    Notification.notify(i18ns.t('information'), i18ns.t('forgotPasswordPage.codeSent'), 'success')
    startCooldown()
  } catch (error) {
    notifyRequestError(error, i18ns.t('loginOrRegisterPage.requestFailed'))
  } finally {
    sendCodeLoading.value = false
    captchaVerifying.value = false
  }
}

const handleSubmit = async () => {
  if (!formRef.value || submitLoading.value) return

  submitLoading.value = true
  try {
    form.verificationCode = form.verificationCode.replace(/\D/g, '').slice(0, 6)

    const valid = await formRef.value.validate().catch(() => {
      Notification.notify(i18ns.t('error'), i18ns.t('message.error.formValidationFailed'), 'error')
      return false
    })

    if (!valid) return

    await authorizationService.resetPassword(
      {
        username: form.username.trim(),
        email: form.email.trim(),
        verificationCode: form.verificationCode,
        newPassword: md5(form.newPassword),
      },
      () => {
        captchaVerifying.value = true
      },
      () => {
        captchaVerifying.value = false
      },
    )

    Notification.notify(
      i18ns.t('information'),
      i18ns.t('forgotPasswordPage.resetSuccess'),
      'success',
    )
    handleReset()
    await router.push(getLoginTarget())
  } catch (error) {
    notifyRequestError(error, i18ns.t('operationFailed'))
  } finally {
    submitLoading.value = false
    captchaVerifying.value = false
  }
}

const handleReset = () => {
  form.username = ''
  form.email = ''
  form.verificationCode = ''
  form.newPassword = ''
  form.confirmPassword = ''
  formRef.value?.resetFields()
  formRef.value?.clearValidate()
}

onMounted(() => {
  waterMarkTextStore.setText('AppSystem')
  captchaWarmupRunning.value = true
  void warmupCaptchaTrust('reset_password').finally(() => {
    captchaWarmupRunning.value = false
  })
})

onBeforeUnmount(() => {
  clearCooldown()
})
</script>

<style scoped>
.forgot-password-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(24px, 5vw, 48px) 16px;
  box-sizing: border-box;
  overflow-x: visible;
  overflow-y: auto;
  --forgot-page-bg-top: rgba(255, 255, 255, 0.96);
  --forgot-page-bg-bottom: rgba(248, 250, 252, 0.92);
  --forgot-page-accent-primary: rgba(64, 158, 255, 0.16);
  --forgot-page-accent-secondary: rgba(103, 194, 58, 0.14);
  --forgot-shell-bg: var(--surface-card-bg);
  --forgot-shell-border: var(--surface-card-border);
  --forgot-shell-shadow: var(--surface-card-shadow);
}

.forgot-password-page--dark {
  --forgot-page-bg-top: rgba(13, 17, 23, 0.96);
  --forgot-page-bg-bottom: rgba(22, 28, 36, 0.94);
  --forgot-page-accent-primary: rgba(64, 158, 255, 0.18);
  --forgot-page-accent-secondary: rgba(103, 194, 58, 0.12);
}

.forgot-password-background {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top left, var(--forgot-page-accent-primary), transparent 34%),
    radial-gradient(circle at bottom right, var(--forgot-page-accent-secondary), transparent 30%),
    linear-gradient(180deg, var(--forgot-page-bg-top), var(--forgot-page-bg-bottom));
  pointer-events: none;
}

.forgot-password-shell {
  position: relative;
  width: min(100%, 560px);
  padding: clamp(12px, 4vw, 36px);
  overflow: visible;
  border-radius: 12px;
  background: var(--forgot-shell-bg);
  border: 1px solid var(--forgot-shell-border);
  box-shadow: var(--forgot-shell-shadow);
  backdrop-filter: blur(14px);
}

.auth-warmup-banner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 14px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(64, 158, 255, 0.08);
  color: var(--el-color-primary);
  font-size: 12px;
  line-height: 1;
}

.auth-warmup-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: auth-warmup-pulse 1s ease-in-out infinite;
}

@keyframes auth-warmup-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.shell-header {
  margin-bottom: 20px;
  text-align: center;
}

.shell-header h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 32px);
  line-height: 1.2;
  color: var(--color-heading);
}

.shell-header p {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.account-hint {
  margin-bottom: 20px;
  border-radius: 12px;
}

.code-row {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.code-input {
  flex: 1;
  min-width: 0;
}

.send-code-button {
  min-width: 136px;
}

.password-hint {
  margin: -6px 0 18px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.form-actions {
  justify-content: space-between;
  align-items: right;
  gap: 12px;
  margin-top: 4px;
}

.form-actions-right {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.footer-link {
  margin-top: 18px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.recaptcha-notice {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
  text-align: center;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.recaptcha-notice a {
  color: var(--el-color-primary);
  text-decoration: none;
}

.recaptcha-notice a:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .forgot-password-shell {
    width: min(100%, 100%);
    border-radius: 20px;
    padding: 22px 18px;
  }

  .code-row {
    flex-direction: column;
    align-items: stretch;
  }

  .send-code-button {
    width: 100%;
    min-width: 0;
  }

  .form-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .form-actions-right {
    width: 100%;
    flex-direction: column;
  }

  .form-actions-right .el-button,
  .form-actions > .el-button {
    width: 100%;
    margin-left: 0 !important;
  }
}

@media (max-width: 480px) {
  .forgot-password-page {
    padding: 18px 10px;
  }

  .forgot-password-shell {
    padding: 18px 14px;
    border-radius: 18px;
  }

  .footer-link {
    flex-wrap: wrap;
  }
}
</style>
