<template>
  <div class="verify-page" :class="{ 'verify-page--mobile': !isDesktop }">
    <div class="verify-background" />

    <main class="verify-shell surface-card">
      <header v-if="!isDisableTwoFactorFlow" class="verify-header">
        <h1>
          {{
            isDisableTwoFactorFlow
              ? i18ns.t('twoFactor.disableTitle')
              : i18ns.t('twoFactor.verifyIdentityTitle')
          }}
        </h1>
        <p>
          {{
            isDisableTwoFactorFlow
              ? i18ns.t('twoFactor.disableHint')
              : i18ns.t('twoFactor.verifyIdentityDesc')
          }}
        </p>
      </header>

      <div v-if="!isDisableTwoFactorFlow" class="method-switcher">
        <button
          type="button"
          class="method-btn"
          :class="{ 'method-btn--active': activeMethod === 'code' }"
          @click="activeMethod = 'code'"
        >
          {{ i18ns.t('twoFactor.methodAuthenticator') }}
        </button>
        <button
          type="button"
          class="method-btn"
          :class="{ 'method-btn--active': activeMethod === 'email' }"
          @click="activeMethod = 'email'"
        >
          {{ i18ns.t('twoFactor.methodEmail') }}
        </button>
      </div>

      <TwoFactorChallengeCard
        v-if="isDisableTwoFactorFlow || activeMethod === 'code'"
        :code="code"
        :recovery-code="recoveryCode"
        :use-recovery-code="useRecoveryCode"
        :submitting="challengeSubmitting"
        :challenge-ready="challengeReady"
        :mode="isDisableTwoFactorFlow ? 'disable' : 'login'"
        @update:code="code = $event"
        @update:recovery-code="recoveryCode = $event"
        @update:use-recovery-code="useRecoveryCode = $event"
        @submit="handleSubmitChallenge"
      />

      <section v-else-if="activeMethod === 'email'" class="method-panel">
        <p class="method-hint" id="email-method-hint">
          {{ i18ns.t('twoFactor.emailMethodHint') }}
        </p>

        <div class="email-code-row">
          <SegmentedCodeInput
            v-model="emailCode"
            :length="6"
            :autofocus="activeMethod === 'email'"
            :disabled="!hasChallenge || challengeSubmitting"
            :aria-label="i18ns.t('twoFactor.emailCodePlaceholder')"
            :aria-describedby="'email-method-hint'"
            @keyup.enter="handleEmailCodeEnter"
          />
          <el-button
            :loading="emailCodeSending"
            :disabled="!hasChallenge || emailCodeCooldown > 0"
            @click="handleSendEmailCode"
          >
            {{
              emailCodeCooldown > 0
                ? i18ns.t('loginOrRegisterPage.resendIn', { seconds: emailCodeCooldown })
                : i18ns.t('twoFactor.sendEmailCode')
            }}
          </el-button>
        </div>

        <p v-if="maskedEmail" class="email-target-hint">
          {{ i18ns.t('twoFactor.emailCodeSentTo', { email: maskedEmail }) }}
        </p>

        <el-button
          type="primary"
          class="method-action-btn"
          :loading="challengeSubmitting"
          :disabled="!hasChallenge"
          @click="handleSubmitEmailCode"
        >
          {{ i18ns.t('twoFactor.submitEmailCode') }}
        </el-button>

        <p v-if="!hasChallenge" class="email-empty-hint">
          {{ i18ns.t('twoFactor.challengeMissingHint') }}
        </p>
      </section>

      <div class="verify-actions">
        <el-button link type="primary" @click="handleGoBack">
          {{
            isDisableTwoFactorFlow || isStepUpFlow
              ? i18ns.t('back')
              : i18ns.t('twoFactor.backToLogin')
          }}
        </el-button>
      </div>

      <el-dialog
        v-model="policyDialogVisible"
        :title="i18ns.t('loginOrRegisterPage.legalPolicyDialogTitle')"
        width="min(960px, calc(100vw - 32px))"
        destroy-on-close
      >
        <p class="policy-dialog-description">
          {{ policyDialogDescription }}
        </p>

        <el-skeleton :loading="policyDialogLoading" animated :rows="10">
          <template #default>
            <div v-if="policyTabs.some((item) => item.policy)" class="policy-dialog-content">
              <el-tabs v-model="policyActiveTab" stretch>
                <el-tab-pane
                  v-for="item in policyTabs"
                  :key="item.name"
                  :name="item.name"
                  :label="item.label"
                >
                  <template v-if="item.policy">
                    <div class="policy-meta">
                      <span>
                        {{
                          i18ns.t('loginOrRegisterPage.policyVersion', {
                            version: item.policy.version,
                          })
                        }}
                      </span>
                    </div>
                    <MarkdownRenderer :content="item.policy.content" />
                  </template>
                  <el-empty
                    v-else
                    :description="i18ns.t('loginOrRegisterPage.noPublishedPolicies')"
                  />
                </el-tab-pane>
              </el-tabs>
            </div>
            <el-empty v-else :description="i18ns.t('loginOrRegisterPage.noPublishedPolicies')" />
          </template>
        </el-skeleton>

        <template #footer>
          <div class="policy-dialog-footer">
            <el-checkbox v-model="policyConsentChecked">
              {{ i18ns.t('loginOrRegisterPage.readAndAgree') }}
            </el-checkbox>
            <div class="policy-dialog-actions">
              <el-button @click="policyDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
              <el-button
                type="primary"
                :loading="policyDialogSubmitting"
                @click="finalizeLoginAfterPolicyConsent"
              >
                {{ i18ns.t('loginOrRegisterPage.consentConfirm') }}
              </el-button>
            </div>
          </div>
        </template>
      </el-dialog>
    </main>
  </div>
</template>

<script setup lang="ts">
import { TypedSessionStorage } from '@/utils/typedSessionStorage'
import StorageKey from '@/constant/storagekey'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import { Notification } from '@/utils/notification'
import { authorizationService } from '@/service/authorizationService'
import { legalPolicyService } from '@/service/legalPolicyService'
import { twoFactorAuthService } from '@/service/twoFactor/twoFactorAuthService'
import { twoFactorManagementService } from '@/service/twoFactor/twoFactorManagementService'
import { usePageDevice } from '@/composables/usePageDevice'
import { ensureCaptchaTrust } from '@/service/captchaDialogService'
import { CustomCode } from '@/constant/custom-code'
import { validateTwoFactorCode } from '@/utils/validation'
import { useRequestStore } from '@/stores/request'
import { waitForCookie } from '@/utils/cookie'
import type { LegalPolicyType, PublicLegalPolicyDto } from '@/client/types.gen'
import { getLoginRoute, getRegisterRoute } from '@/utils/auth-routes'
import { getSafeAuthRedirect } from '@/utils/auth-routes'

const TwoFactorChallengeCard = defineAsyncComponent(
  () => import('@/components/auth/TwoFactorChallengeCard.vue'),
)
const SegmentedCodeInput = defineAsyncComponent(
  () => import('@/components/auth/SegmentedCodeInput.vue'),
)
const MarkdownRenderer = defineAsyncComponent(
  () => import('@/components/common/MarkdownRenderer.vue'),
)

const route = useRoute()
const router = useRouter()
const { isDesktop } = usePageDevice()

type VerifyMethod = 'code' | 'email'
type VerifyPurpose = 'login' | 'disable2fa' | 'stepup'

const verifyPurpose = ref<VerifyPurpose>('login')
const activeMethod = ref<VerifyMethod>('code')

const code = ref('')
const recoveryCode = ref('')
const useRecoveryCode = ref(false)
const emailCode = ref('')
const maskedEmail = ref('')
const challengeToken = ref('')

const challengeSubmitting = ref(false)
const emailCodeSending = ref(false)
const emailCodeCooldown = ref(0)
const redirectPath = ref<string | undefined>(undefined)
const authEntry = ref<'login' | 'register'>('login')
let emailCodeCooldownTimer: ReturnType<typeof setInterval> | null = null

const isDisableTwoFactorFlow = computed(() => verifyPurpose.value === 'disable2fa')
const isStepUpFlow = computed(() => verifyPurpose.value === 'stepup')

const hasChallenge = computed(() => Boolean(challengeToken.value))

const challengeReady = computed(() => isDisableTwoFactorFlow.value || hasChallenge.value)

const policyDialogVisible = ref(false)
const policyDialogLoading = ref(false)
const policyDialogSubmitting = ref(false)
const policyConsentChecked = ref(false)
const policyConsentChallengeToken = ref('')
const policyActiveTab = ref<LegalPolicyType>('terms_of_service')
const legalPolicies = ref<PublicLegalPolicyDto[]>([])

const policyMap = computed(() => {
  const map = new Map<LegalPolicyType, PublicLegalPolicyDto>()
  legalPolicies.value.forEach((policy) => map.set(policy.policyType, policy))
  return map
})

const policyTabs = computed(() => [
  {
    name: 'terms_of_service' as const,
    label: i18ns.t('loginOrRegisterPage.termsOfService'),
    policy: policyMap.value.get('terms_of_service'),
  },
  {
    name: 'privacy_policy' as const,
    label: i18ns.t('loginOrRegisterPage.privacyPolicy'),
    policy: policyMap.value.get('privacy_policy'),
  },
])

const policyDialogDescription = computed(() =>
  i18ns.t('loginOrRegisterPage.consentDialogDescription'),
)

const clearEmailCodeCooldown = () => {
  if (emailCodeCooldownTimer) {
    clearInterval(emailCodeCooldownTimer)
    emailCodeCooldownTimer = null
  }
  emailCodeCooldown.value = 0
}

const startEmailCodeCooldown = () => {
  clearEmailCodeCooldown()
  emailCodeCooldown.value = 60
  emailCodeCooldownTimer = setInterval(() => {
    emailCodeCooldown.value -= 1
    if (emailCodeCooldown.value <= 0) {
      clearEmailCodeCooldown()
    }
  }, 1000)
}

const getSafeDisableRedirect = (): string => {
  return (
    getSafeAuthRedirect(redirectPath.value, {
      blockedExactPaths: ['/login', '/register', '/forgot-password'],
      blockedPrefixes: ['/auth/verify'],
    }) || '/settings/security'
  )
}

const getSafeStepUpRedirect = (): string => {
  return (
    getSafeAuthRedirect(redirectPath.value, {
      blockedExactPaths: ['/login', '/register', '/forgot-password'],
      blockedPrefixes: ['/auth/verify'],
    }) || '/home'
  )
}

const completeAndRedirect = async (userData?: Record<string, any>) => {
  await authorizationService.reloadAuthStoresAfterLogin(userData)

  // 重试所有待 2FA 验证的请求（如果有的话）
  const requestStore = useRequestStore()
  try {
    const retryResults = await requestStore.retryPendingTwoFactorRequests()
    if (retryResults.length > 0) {
      console.log(`[2FA] Successfully retried ${retryResults.length} pending request(s)`)
    }
  } catch (error) {
    console.error('[2FA] Failed to retry pending requests:', error)
    // 即使重试失败也继续，因为 2FA 验证已经成功了
  }

  Notification.notify(
    i18ns.t('information'),
    i18ns.t('message.information.loginSuccess'),
    'success',
  )

  const redirect = getSafeRedirect()
  if (redirect) {
    router.push(redirect)
  } else {
    router.push({ name: 'home' })
  }
}

const getSafeRedirect = (): string | undefined =>
  getSafeAuthRedirect(route.query.redirect, {
    blockedExactPaths: ['/login', '/register', '/forgot-password'],
    blockedPrefixes: ['/auth/verify'],
  })

const loadLegalPolicies = async () => {
  policyDialogLoading.value = true
  try {
    legalPolicies.value = await legalPolicyService.getCurrentPolicies()
    if (!policyMap.value.get(policyActiveTab.value)) {
      const firstPolicy = legalPolicies.value[0]
      if (firstPolicy) policyActiveTab.value = firstPolicy.policyType
    }
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as Error).message)
        : i18ns.t('loginOrRegisterPage.legalPolicyLoadFailed')
    Notification.notify(i18ns.t('error'), message, 'error')
  } finally {
    policyDialogLoading.value = false
  }
}

const openPolicyConsentDialog = async (challengeTokenValue: string) => {
  policyConsentChallengeToken.value = challengeTokenValue
  policyConsentChecked.value = false
  policyDialogVisible.value = true
  await loadLegalPolicies()
}

const finalizeLoginAfterPolicyConsent = async () => {
  if (!policyConsentChecked.value) {
    Notification.notify(
      i18ns.t('warning'),
      i18ns.t('loginOrRegisterPage.agreementRequired'),
      'warning',
    )
    return
  }

  if (!policyConsentChallengeToken.value) {
    Notification.notify(i18ns.t('error'), i18ns.t('message.error.loginFailed'), 'error')
    return
  }

  policyDialogSubmitting.value = true
  try {
    const authData = await authorizationService.acceptPolicyConsent(
      policyConsentChallengeToken.value,
    )
    authorizationService.clearPendingTwoFactorChallenge()
    policyDialogVisible.value = false
    policyConsentChallengeToken.value = ''
    challengeToken.value = ''
    code.value = ''
    recoveryCode.value = ''
    emailCode.value = ''
    useRecoveryCode.value = false
    await completeAndRedirect(authData.user)
  } catch (error: any) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as Error).message)
        : i18ns.t('message.error.loginFailed')

    Notification.notify(i18ns.t('error'), message, 'error')
  } finally {
    policyDialogSubmitting.value = false
  }
}

const promptReloginAfterTwoFactorChange = async (): Promise<boolean> => {
  try {
    await ElMessageBox.confirm(
      i18ns.t('twoFactor.reloginConfirmMessage'),
      i18ns.t('twoFactor.reloginConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )

    await authorizationService.logout()
    return true
  } catch {
    return false
  }
}

const handleSubmitChallenge = async () => {
  if (!challengeReady.value) {
    ElMessage.warning(i18ns.t('twoFactor.challengeMissing'))
    return
  }

  const normalizedCode = code.value.trim()
  const normalizedRecoveryCode = recoveryCode.value.trim().toUpperCase()

  if (!normalizedCode && !normalizedRecoveryCode) {
    ElMessage.warning(
      i18ns.t(
        isDisableTwoFactorFlow.value
          ? 'twoFactor.disableCodeRequired'
          : 'twoFactor.loginCodeRequired',
      ),
    )
    return
  }

  if (normalizedCode && normalizedRecoveryCode) {
    ElMessage.warning(
      i18ns.t(
        isDisableTwoFactorFlow.value
          ? 'twoFactor.disableInputExclusive'
          : 'twoFactor.loginInputExclusive',
      ),
    )
    return
  }

  if (normalizedCode && !validateTwoFactorCode(normalizedCode)) {
    ElMessage.warning(i18ns.t('twoFactor.codeFormatInvalid'))
    return
  }

  if (normalizedRecoveryCode && !validateTwoFactorCode(normalizedRecoveryCode, true)) {
    ElMessage.warning(i18ns.t('twoFactor.recoveryCodeFormatInvalid'))
    return
  }

  challengeSubmitting.value = true

  try {
    if (isDisableTwoFactorFlow.value) {
      await twoFactorManagementService.disable({
        code: normalizedCode || undefined,
        recoveryCode: normalizedRecoveryCode || undefined,
      })

      code.value = ''
      recoveryCode.value = ''
      useRecoveryCode.value = false
      Notification.notify(i18ns.t('information'), i18ns.t('twoFactor.disableSuccess'), 'success')

      const hasReloggedIn = await promptReloginAfterTwoFactorChange()
      if (!hasReloggedIn) {
        router.push(getSafeDisableRedirect())
      }
      return
    }

    // 处理 stepup 2FA 验证
    if (isStepUpFlow.value) {
      console.log('[2FA Stepup] Starting verification')

      // Stepup 验证：验证 2FA 代码
      const authData = await twoFactorAuthService.verifyLoginChallenge({
        challengeToken: challengeToken.value,
        code: normalizedCode || undefined,
        recoveryCode: normalizedRecoveryCode || undefined,
      })

      if (authorizationService.isPolicyConsentPayload(authData)) {
        await openPolicyConsentDialog(authData.challengeToken)
        return
      }

      console.log('[2FA Stepup] Verification successful, updating token')

      authorizationService.completeLogin(authData, {
        preserveRefreshTokenIfMissing: true,
        clearPendingTwoFactorChallenge: false,
      })
      console.log('[2FA Stepup] Auth tokens updated')

      // 保存一次性令牌（用于高危接口的单次重试）
      if ((authData as any).oneTimeToken) {
        TypedSessionStorage.setItem(StorageKey.Auth.ONE_TIME_TOKEN, (authData as any).oneTimeToken)
        console.log('[2FA Stepup] One-time token saved')
      }

      // 清除状态
      authorizationService.clearPendingTwoFactorChallenge()
      challengeToken.value = ''
      code.value = ''
      recoveryCode.value = ''
      useRecoveryCode.value = false

      console.log('[2FA Stepup] Waiting for two_factor_trusted_device cookie...')

      // 等待浏览器设置 two_factor_trusted_device Cookie（最多等待 3 秒）
      const cookieSet = await waitForCookie('two_factor_trusted_device', 3000, 50)

      if (!cookieSet) {
        console.warn('[2FA Stepup] two_factor_trusted_device cookie not detected, retrying anyway')
      }

      console.log('[2FA Stepup] Calling retryPendingTwoFactorRequests...')

      // 重试所有待处理的请求
      const requestStore = useRequestStore()
      try {
        const results = await requestStore.retryPendingTwoFactorRequests()
        console.log('[2FA Stepup] Retry completed, results:', results)
      } catch (error) {
        console.error('[2FA Stepup] Failed to retry pending requests:', error)
      }

      // 显示成功提示
      Notification.notify(
        i18ns.t('information'),
        i18ns.t('twoFactor.verificationSuccess'),
        'success',
      )

      // 返回上一页或跳转到安全的重定向地址
      const redirect = getSafeRedirect()
      if (redirect) {
        console.log('[2FA Stepup] Redirecting to:', redirect)
        router.push(redirect)
      } else {
        console.log('[2FA Stepup] Going back')
        router.back()
      }
      return
    }

    // 处理登录 2FA 验证
    const authData = await twoFactorAuthService.verifyLoginChallenge({
      challengeToken: challengeToken.value,
      code: normalizedCode || undefined,
      recoveryCode: normalizedRecoveryCode || undefined,
    })

    if (authorizationService.isPolicyConsentPayload(authData)) {
      await openPolicyConsentDialog(authData.challengeToken)
      return
    }

    authorizationService.completeLogin(authData)
    authorizationService.clearPendingTwoFactorChallenge()
    challengeToken.value = ''
    code.value = ''
    recoveryCode.value = ''
    useRecoveryCode.value = false
    await completeAndRedirect(authData.user)
  } catch (error: any) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as Error).message)
        : i18ns.t('twoFactor.loginFailed')

    Notification.notify(i18ns.t('error'), message, 'error')
  } finally {
    challengeSubmitting.value = false
  }
}

const handleSendEmailCode = async () => {
  if (!challengeToken.value) {
    ElMessage.warning(i18ns.t('twoFactor.challengeMissing'))
    return
  }

  emailCodeSending.value = true
  try {
    const execute = () => twoFactorAuthService.sendLoginEmailCode(challengeToken.value)

    let result
    try {
      result = await execute()
    } catch (error) {
      const serviceError = error instanceof Error ? (error as Error & { code?: number }) : null
      if (serviceError?.code === CustomCode.CAPTCHA_TRUST_REQUIRED) {
        await ensureCaptchaTrust('send_2fa_email_code')
        result = await execute()
      } else {
        throw error
      }
    }
    maskedEmail.value = result.maskedEmail || ''

    Notification.notify(
      i18ns.t('information'),
      maskedEmail.value
        ? i18ns.t('twoFactor.emailCodeSentTo', { email: maskedEmail.value })
        : i18ns.t('twoFactor.emailCodeSent'),
      'success',
    )

    startEmailCodeCooldown()
  } catch (error: any) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as Error).message)
        : i18ns.t('twoFactor.emailCodeSendFailed')

    Notification.notify(i18ns.t('error'), message, 'error')
  } finally {
    emailCodeSending.value = false
  }
}

// 处理邮箱验证码输入框回车
const handleEmailCodeEnter = () => {
  // 如果已经输入完成6位验证码，则提交
  if (emailCode.value.trim().length === 6) {
    handleSubmitEmailCode()
  } else if (emailCodeCooldown.value === 0 && !maskedEmail.value) {
    // 如果从未发送过邮件（cooldown为0且没有maskedEmail），则发送邮件
    handleSendEmailCode()
  }
}

const handleSubmitEmailCode = async () => {
  if (!challengeToken.value) {
    ElMessage.warning(i18ns.t('twoFactor.challengeMissing'))
    return
  }

  const normalizedEmailCode = emailCode.value.trim()
  if (!normalizedEmailCode) {
    ElMessage.warning(i18ns.t('twoFactor.emailCodeRequired'))
    return
  }

  if (!validateTwoFactorCode(normalizedEmailCode)) {
    ElMessage.warning(i18ns.t('twoFactor.emailCodeFormatInvalid'))
    return
  }

  challengeSubmitting.value = true
  try {
    const authData = await twoFactorAuthService.verifyLoginChallenge({
      challengeToken: challengeToken.value,
      emailCode: normalizedEmailCode,
    })

    if (authorizationService.isPolicyConsentPayload(authData)) {
      await openPolicyConsentDialog(authData.challengeToken)
      return
    }

    authorizationService.completeLogin(authData)
    authorizationService.clearPendingTwoFactorChallenge()
    challengeToken.value = ''
    emailCode.value = ''
    code.value = ''
    recoveryCode.value = ''
    useRecoveryCode.value = false
    await completeAndRedirect(authData.user)
  } catch (error: any) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as Error).message)
        : i18ns.t('twoFactor.emailCodeVerifyFailed')

    Notification.notify(i18ns.t('error'), message, 'error')
  } finally {
    challengeSubmitting.value = false
  }
}

const handleGoBack = () => {
  if (isDisableTwoFactorFlow.value) {
    router.push(getSafeDisableRedirect())
    return
  }

  if (isStepUpFlow.value) {
    authorizationService.clearPendingTwoFactorChallenge()
    router.push(getSafeStepUpRedirect())
    return
  }

  authorizationService.clearPendingTwoFactorChallenge()
  const redirect = getSafeRedirect()
  router.push(authEntry.value === 'register' ? getRegisterRoute(redirect) : getLoginRoute(redirect))
}

onMounted(() => {
  const queryPurpose = typeof route.query.purpose === 'string' ? route.query.purpose : ''
  const queryMethod = typeof route.query.method === 'string' ? route.query.method : ''
  const queryRedirect = typeof route.query.redirect === 'string' ? route.query.redirect : undefined
  const queryAuthEntry =
    typeof route.query.authEntry === 'string' ? route.query.authEntry : undefined
  const pendingChallenge = authorizationService.getPendingTwoFactorChallenge()

  redirectPath.value = queryRedirect || pendingChallenge?.redirect
  authEntry.value =
    queryAuthEntry === 'register' || pendingChallenge?.authEntry === 'register'
      ? 'register'
      : 'login'

  if (queryPurpose === 'disable2fa') {
    verifyPurpose.value = 'disable2fa'
    activeMethod.value = 'code'
    challengeToken.value = ''
    code.value = ''
    recoveryCode.value = ''
    emailCode.value = ''
    maskedEmail.value = ''
    useRecoveryCode.value = false
    return
  }

  if (queryPurpose === 'stepup') {
    verifyPurpose.value = 'stepup'
  }

  if (pendingChallenge?.challengeToken) {
    challengeToken.value = pendingChallenge.challengeToken
  }

  if (queryMethod === 'code') {
    activeMethod.value = 'code'
    return
  }

  if (queryMethod === 'email') {
    activeMethod.value = 'email'
    return
  }

  activeMethod.value = 'code'
})

onBeforeUnmount(() => {
  clearEmailCodeCooldown()

  if (emailCodeCooldownTimer) {
    clearInterval(emailCodeCooldownTimer)
    emailCodeCooldownTimer = null
  }
})
</script>

<style scoped>
.verify-page {
  --verify-bg: var(--color-background);
  --verify-bg-soft: var(--color-background-soft);
  --verify-bg-mute: var(--color-background-mute);
  --verify-border: var(--surface-card-border);
  --verify-control-border: var(--surface-control-border);
  --verify-control-border-active: var(--surface-control-border-active);
  --verify-text: var(--color-heading);
  --verify-muted: var(--el-text-color-secondary);
  min-height: 100vh;
  width: 100%;
  padding: 40px 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 10% 12%, var(--verify-bg-soft), transparent 38%),
    linear-gradient(180deg, var(--verify-bg-mute), var(--verify-bg));
}

.verify-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(90deg, var(--verify-control-border) 1px, transparent 1px),
    linear-gradient(var(--verify-control-border) 1px, transparent 1px);
  background-size: 20px 20px;
  opacity: 0.26;
  mask-image: radial-gradient(circle at center, #000 40%, transparent 78%);
}

.verify-shell {
  width: min(100%, 520px);
  border-radius: 18px;
  border: 1px solid var(--verify-border);
  background: var(--surface-card-bg);
  box-shadow: var(--surface-card-shadow);
  padding: 28px;
  position: relative;
  z-index: 1;
  backdrop-filter: blur(var(--surface-card-blur));
}

.verify-header h1 {
  margin: 0;
  color: var(--verify-text);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.verify-header p {
  margin: 10px 0 0;
  color: var(--verify-muted);
  font-size: 14px;
  line-height: 1.6;
}

.method-switcher {
  margin: 20px 0;
  border: 1px solid var(--verify-control-border);
  border-radius: 12px;
  padding: 4px;
  background: var(--verify-bg-mute);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}

.method-btn {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--verify-muted);
  font-size: 13px;
  font-weight: 600;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.method-btn--active {
  background: var(--surface-control-bg);
  color: var(--verify-text);
  border-color: var(--verify-control-border-active);
}

.method-panel {
  border: 1px solid var(--verify-control-border);
  border-radius: 14px;
  background: var(--surface-control-bg);
  padding: 20px;
}

.method-hint {
  margin: 0 0 16px;
  color: var(--verify-muted);
  line-height: 1.6;
  font-size: 13px;
}

.method-action-btn {
  width: 100%;
}

.email-code-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.email-target-hint {
  margin: 0 0 12px;
  color: var(--verify-muted);
  font-size: 13px;
}

.email-empty-hint {
  margin: 12px 0 0;
  color: var(--el-color-danger);
  font-size: 12px;
}

.verify-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.policy-dialog-description {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.policy-dialog-content {
  max-height: min(65vh, 720px);
  overflow: auto;
}

.policy-meta {
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.policy-dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.policy-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 768px) {
  .verify-page {
    padding: 22px 12px;
    align-items: flex-start;
  }

  .verify-shell {
    border-radius: 14px;
    padding: 20px 16px;
  }

  .verify-header h1 {
    font-size: 24px;
  }

  .verify-header p {
    font-size: 13px;
  }

  .method-switcher {
    grid-template-columns: 1fr;
  }

  .email-code-row {
    gap: 10px;
  }
}
</style>
