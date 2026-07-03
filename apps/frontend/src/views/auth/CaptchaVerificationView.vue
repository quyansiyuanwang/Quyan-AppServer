<template>
  <div class="captcha-verify-page">
    <main class="captcha-verify-shell surface-card">
      <h1>{{ i18ns.t('loginOrRegisterPage.turnstileCardTitle') }}</h1>
      <p class="captcha-verify-desc">{{ i18ns.t('loginOrRegisterPage.captchaDialogPrompt') }}</p>
      <el-alert
        v-if="errorMessage"
        class="captcha-verify-alert"
        :title="i18ns.t('error')"
        :description="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />
      <div
        class="captcha-verify-widget"
        :class="{ 'captcha-verify-widget--loading': widgetLoading }"
      >
        <div v-if="widgetLoading" class="captcha-verify-loading">
          <span class="captcha-verify-spinner" />
          <span class="captcha-verify-loading-text">{{
            i18ns.t('loginOrRegisterPage.verifyingCaptcha')
          }}</span>
        </div>
        <div ref="captchaMountRef" class="captcha-verify-widget-host" />
      </div>
      <div class="captcha-verify-actions">
        <el-button :disabled="submitting" @click="handleBack">{{ i18ns.t('back') }}</el-button>
        <el-button v-if="errorMessage" type="primary" :loading="submitting" @click="handleConfirm">
          {{ i18ns.t('refresh') }}
        </el-button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import router from '@/router'
import { i18ns } from '@/locales'
import { captchaTrustService } from '@/service/captchaTrustService'
import {
  getCaptchaToken,
  mountVisibleTurnstile,
  setVisibleTurnstileSuccessHandler,
  unmountVisibleTurnstile,
} from '@/utils/captcha'
import { Notification } from '@/utils/notification'

const route = useRoute()
const submitting = ref(false)
const widgetLoading = ref(true)
const captchaMountRef = ref<HTMLElement | null>(null)
const errorMessage = ref('')

const action = computed(() => {
  const raw = route.query.action
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'login'
})

const redirect = computed(() => {
  const raw = route.query.redirect
  return typeof raw === 'string' && raw.startsWith('/') ? raw : '/login'
})

const handleBack = () => {
  void router.replace(redirect.value)
}

const handleConfirm = async () => {
  submitting.value = true
  errorMessage.value = ''
  try {
    const token = await getCaptchaToken(action.value, 'turnstile')
    if (!token) throw new Error(i18ns.t('loginOrRegisterPage.captchaUnavailable'))

    await captchaTrustService.verifyAndTrust(token, action.value, 'turnstile')
    void router.replace(redirect.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : i18ns.t('operationFailed')
    errorMessage.value = `${message} ${i18ns.t('tryAgainLater')}`
    Notification.notify(i18ns.t('error'), message, 'error')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    await nextTick()
    if (!captchaMountRef.value) return
    setVisibleTurnstileSuccessHandler(() => {
      if (submitting.value) return
      void handleConfirm()
    })
    await mountVisibleTurnstile(captchaMountRef.value, action.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : i18ns.t('operationFailed')
    errorMessage.value = `${message} ${i18ns.t('tryAgainLater')}`
  } finally {
    widgetLoading.value = false
  }
})

onBeforeUnmount(() => {
  setVisibleTurnstileSuccessHandler(null)
  unmountVisibleTurnstile()
})
</script>

<style scoped>
.captcha-verify-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}

.captcha-verify-shell {
  width: min(100%, 420px);
  padding: 24px;
}

.captcha-verify-desc {
  margin: 12px 0 16px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.captcha-verify-alert {
  margin-bottom: 16px;
}

.captcha-verify-widget {
  position: relative;
  min-height: 70px;
  overflow: visible;
}

.captcha-verify-widget--loading {
  min-height: 120px;
}

.captcha-verify-widget-host {
  min-height: 70px;
}

.captcha-verify-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 120px;
  color: var(--el-text-color-secondary);
}

.captcha-verify-spinner {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 3px solid rgba(64, 158, 255, 0.18);
  border-top-color: var(--el-color-primary);
  animation: captcha-verify-spin 0.8s linear infinite;
}

.captcha-verify-loading-text {
  font-size: 14px;
}

@keyframes captcha-verify-spin {
  to {
    transform: rotate(360deg);
  }
}

.captcha-verify-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 18px;
}
</style>
