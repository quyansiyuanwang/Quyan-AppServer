import { NICKNAME_PATTERN, USERNAME_PATTERN } from '@/constant/pattern'
import StorageKey from '@/constant/storagekey'
import { CustomCode } from '@/constant/custom-code'
import { i18ns } from '@/locales'
import router from '@/router'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import { md5 } from '@/utils/encryption'
import { Notification } from '@/utils/notification'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import {
  getForgotPasswordRoute,
  getLoginRoute,
  getQrApprovalRoute,
  getRegisterRoute,
  getSafeAuthRedirect,
  isQrApprovalRedirect,
} from '@/utils/auth-routes'
import { usePageDevice } from '@/composables/usePageDevice'
import type {
  AuthData,
  CreateQrLoginSessionResponse,
  LegalPolicyType,
  PolicyConsentRequiredData,
  PublicLegalPolicyDto,
  QrLoginSessionStatusResponse,
  TwoFactorRequiredData,
  PublicSocialAuthConfigDto,
} from '@/client/types.gen'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { socialAuthService } from '@/service/socialAuthService'
import type { SSEStream } from '@/service/streaming/sse'
import { getAccessToken } from '@/stores/request'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

type LegalPolicyConsentCache = {
  username: string
  signature: string
  savedAt: number
}

export type LoginForm = {
  username: string
  password: string
  agreedToLegalPolicies: boolean
}

export type RegisterForm = {
  username: string
  nickname: string
  email: string
  password: string
  confirmPassword: string
  verificationCode: string
  agreedToLegalPolicies: boolean
}

type ExternalAuthProvider = 'github' | 'wechat-open' | 'wechat-web'
type QrLoginStatus = 'pending' | 'scanned' | 'approved' | 'rejected' | 'expired' | 'consumed'

export function useLoginOrRegister() {
  const formRef = ref<FormInstance>()
  const usernameInputRef = ref()
  const passwordInputRef = ref()
  const waterMarkTextStore = useWaterMarkTextStore()
  const route = useRoute()
  const registrationEnabled = ref<boolean | null>(null)
  const registrationStatusReady = ref(false)
  const publicSocialAuthConfig = ref<PublicSocialAuthConfigDto | null>(null)
  const captchaWarmupRunning = ref(false)
  const codeCooldown = ref(0)
  const loading = ref(false)
  const passkeyLoading = ref(false)
  const captchaVerifying = ref(false)
  const externalAuthLoading = ref<string | null>(null)
  const qrLoginSession = ref<CreateQrLoginSessionResponse | null>(null)
  const qrLoginStatus = ref<QrLoginStatus | null>(null)
  const qrLoginScannedUser = ref<{ username?: string; email?: string | null } | null>(null)
  const qrLoginBusy = ref(false)
  const qrPolling = ref(false)
  let publicSocialAuthPromise: Promise<PublicSocialAuthConfigDto | null> | null = null
  let qrStatusStream: SSEStream | null = null
  let autoScannedQrSessionId: string | null = null

  const ensurePublicSocialAuthConfig = async (): Promise<PublicSocialAuthConfigDto | null> => {
    if (publicSocialAuthConfig.value !== null) {
      return publicSocialAuthConfig.value
    }

    if (!publicSocialAuthPromise) {
      publicSocialAuthPromise = loadConfigService()
        .then(({ configService }) => configService.getPublicSocialAuthConfig())
        .then((config) => {
          publicSocialAuthConfig.value = config
          return config
        })
        .catch((error) => {
          console.error('Failed to load public social auth config:', error)
          publicSocialAuthConfig.value = null
          return null
        })
        .finally(() => {
          publicSocialAuthPromise = null
        })
    }

    return publicSocialAuthPromise
  }

  const policyDialogVisible = ref(false)
  const policyDialogLoading = ref(false)
  const policyDialogSubmitting = ref(false)
  const policyDialogRequireConfirmation = ref(false)
  const policyConsentChecked = ref(false)
  const policyConsentChallengeToken = ref('')
  const policyActiveTab = ref<LegalPolicyType>('terms_of_service')
  const legalPolicies = ref<PublicLegalPolicyDto[]>([])
  const mode = ref<'login' | 'register'>('login')
  const { isDesktop } = usePageDevice()

  const loadCaptchaDialogService = () => import('@/service/captchaDialogService')
  const loadConfigService = () => import('@/service/configService')
  const loadLegalPolicyService = () => import('@/service/legalPolicyService')
  const loadPasskeyService = () => import('@/service/passkeyService')
  const loadAuthorizationService = () => import('@/service/authorizationService')

  let cooldownTimer: ReturnType<typeof setInterval> | null = null
  let qrPollingTimer: ReturnType<typeof setTimeout> | null = null
  let passkeyLibPromise: Promise<typeof import('@simplewebauthn/browser')> | null = null
  let registrationStatusPromise: Promise<boolean> | null = null

  const loginForm = reactive<LoginForm>({
    username: '',
    password: '',
    agreedToLegalPolicies: false,
  })

  const registerForm = reactive<RegisterForm>({
    username: '',
    nickname: '',
    email: '',
    password: '',
    confirmPassword: '',
    verificationCode: '',
    agreedToLegalPolicies: false,
  })

  const loginRules: FormRules = {
    username: [{ required: true, message: i18ns.t('placeholder.enterUsername'), trigger: 'blur' }],
    password: [{ required: true, message: i18ns.t('placeholder.enterPassword'), trigger: 'blur' }],
    agreedToLegalPolicies: [
      {
        validator: (_, value, callback) => {
          if (value) callback()
          else callback(new Error(i18ns.t('loginOrRegisterPage.agreementRequired')))
        },
        trigger: 'change',
      },
    ],
  }

  const registerRules: FormRules = {
    username: [
      { required: true, message: i18ns.t('placeholder.enterUsername'), trigger: 'blur' },
      {
        pattern: USERNAME_PATTERN,
        message: i18ns.t('message.error.invalidUsernameInRegister'),
        trigger: 'blur',
      },
    ],
    nickname: [
      { required: true, message: i18ns.t('placeholder.enterNickname'), trigger: 'blur' },
      {
        pattern: NICKNAME_PATTERN,
        message: i18ns.t('message.error.invalidNickname'),
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
    password: [{ required: true, message: i18ns.t('placeholder.enterPassword'), trigger: 'blur' }],
    confirmPassword: [
      { required: true, message: i18ns.t('placeholder.enterConfirmPassword'), trigger: 'blur' },
      {
        validator: (_, value, callback) => {
          if (!value) {
            callback(new Error(i18ns.t('placeholder.enterConfirmPassword')))
          } else if (value !== registerForm.password) {
            callback(new Error(i18ns.t('message.error.passwordsDoNotMatch')))
          } else {
            callback()
          }
        },
        trigger: ['blur', 'change'],
      },
    ],
    verificationCode: [
      {
        required: true,
        message: i18ns.t('loginOrRegisterPage.enterVerificationCode'),
        trigger: 'blur',
      },
      { len: 6, message: i18ns.t('loginOrRegisterPage.enterVerificationCode'), trigger: 'blur' },
    ],
    agreedToLegalPolicies: [
      {
        validator: (_, value, callback) => {
          if (value) callback()
          else callback(new Error(i18ns.t('loginOrRegisterPage.agreementRequired')))
        },
        trigger: 'change',
      },
    ],
  }

  const isLogin = computed(() => mode.value === 'login')
  const currentForm = computed<LoginForm | RegisterForm>(() =>
    isLogin.value ? loginForm : registerForm,
  )
  const currentRules = computed<FormRules>(() => (isLogin.value ? loginRules : registerRules))
  const submitDisabled = computed(() => captchaVerifying.value)
  const passkeySupported =
    typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
  const mobileFieldDisabled = computed(() => !isDesktop.value && captchaWarmupRunning.value)

  const policyMap = computed(() => {
    const map = new Map<LegalPolicyType, PublicLegalPolicyDto>()
    legalPolicies.value.forEach((policy) => map.set(policy.policyType, policy))
    return map
  })

  const currentPolicySignature = computed(() =>
    [...legalPolicies.value]
      .sort((left, right) => left.policyType.localeCompare(right.policyType))
      .map((policy) => `${policy.policyType}:${policy.id}:${policy.version}:${policy.updateTime}`)
      .join('|'),
  )

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

  const getLegalPolicyConsentCache = (): LegalPolicyConsentCache | null => {
    try {
      const cache = TypedLocalStorage.get<LegalPolicyConsentCache>(
        StorageKey.Auth.LEGAL_POLICY_CONSENT,
      )
      if (!cache || typeof cache !== 'object') return null
      if (typeof cache.username !== 'string' || typeof cache.signature !== 'string') return null
      return cache
    } catch {
      return null
    }
  }

  const syncLoginPolicyConsentFromCache = () => {
    const username = loginForm.username.trim()
    const signature = currentPolicySignature.value

    if (!username || !signature) {
      loginForm.agreedToLegalPolicies = false
      return
    }

    const cache = getLegalPolicyConsentCache()
    loginForm.agreedToLegalPolicies = cache?.username === username && cache.signature === signature
  }

  const persistLegalPolicyConsentCache = (username?: string | null) => {
    const normalizedUsername = username?.trim()
    const signature = currentPolicySignature.value

    if (!normalizedUsername || !signature) return

    TypedLocalStorage.set(StorageKey.Auth.LEGAL_POLICY_CONSENT, {
      username: normalizedUsername,
      signature,
      savedAt: Date.now(),
    } satisfies LegalPolicyConsentCache)

    if (loginForm.username.trim() === normalizedUsername) {
      loginForm.agreedToLegalPolicies = true
    }
  }

  const loadPasskeyStartAuthentication = async () => {
    if (!passkeyLibPromise) passkeyLibPromise = import('@simplewebauthn/browser')
    const module = await passkeyLibPromise
    return module.startAuthentication
  }

  const ensureRegistrationEnabled = async () => {
    if (registrationEnabled.value !== null) {
      registrationStatusReady.value = true
      return registrationEnabled.value
    }

    if (!registrationStatusPromise) {
      registrationStatusPromise = loadConfigService()
        .then(({ configService }) => configService.getRegistrationStatus())
        .then((enabled) => {
          registrationEnabled.value = enabled
          registrationStatusReady.value = true
          return enabled
        })
        .catch((error) => {
          console.error('Failed to load registration status:', error)
          registrationEnabled.value = false
          registrationStatusReady.value = true
          return false
        })
        .finally(() => {
          registrationStatusPromise = null
        })
    }

    return registrationStatusPromise
  }

  const getSafeRedirect = (): string | undefined => {
    return getSafeAuthRedirect(route.query.redirect, {
      blockedExactPaths: ['/login', '/register', '/forgot-password'],
      blockedPrefixes: ['/auth/verify'],
    })
  }

  const getQrApprovalSessionId = (): string | undefined => {
    if (
      route.path === '/auth/qr-approve' &&
      typeof route.query.sessionId === 'string' &&
      route.query.sessionId.trim()
    ) {
      return route.query.sessionId.trim()
    }

    const redirect = getSafeRedirect()
    if (!isQrApprovalRedirect(redirect)) return undefined

    try {
      const parsed = new URL(redirect, window.location.origin)
      const sessionId = parsed.searchParams.get('sessionId')?.trim()
      return sessionId || undefined
    } catch {
      return undefined
    }
  }

  const buildPostLoginRoute = () => {
    const qrApprovalSessionId = getQrApprovalSessionId()
    if (qrApprovalSessionId) return getQrApprovalRoute(qrApprovalSessionId, getSafeRedirect())

    const redirect = getSafeRedirect()
    return redirect ? redirect : '/'
  }

  const getQrSessionIdFromRoute = (): string | undefined => {
    return typeof route.query.qrSession === 'string' && route.query.qrSession.trim()
      ? route.query.qrSession.trim()
      : undefined
  }

  const getChallengeRedirect = (): string | undefined => getSafeRedirect()

  const clearQrPollingTimer = () => {
    if (qrPollingTimer) {
      clearTimeout(qrPollingTimer)
      qrPollingTimer = null
    }
  }

  const stopQrStatusStream = () => {
    qrStatusStream?.abort()
    qrStatusStream = null
  }

  const resetQrSessionState = () => {
    clearQrPollingTimer()
    stopQrStatusStream()
    qrPolling.value = false
    qrLoginBusy.value = false
    qrLoginSession.value = null
    qrLoginStatus.value = null
    qrLoginScannedUser.value = null
  }

  const getQrStatusText = (status: QrLoginStatus | null): string => {
    switch (status) {
      case 'pending':
        return 'Pending'
      case 'scanned':
        return 'Scanned'
      case 'approved':
        return 'Approved'
      case 'rejected':
        return 'Rejected'
      case 'expired':
        return i18ns.t('message.warning.sessionExpired')
      case 'consumed':
        return 'Consumed'
      default:
        return ''
    }
  }

  const loadLegalPolicies = async () => {
    policyDialogLoading.value = true
    try {
      const { legalPolicyService } = await loadLegalPolicyService()
      legalPolicies.value = await legalPolicyService.getCurrentPolicies()
      if (!policyMap.value.get(policyActiveTab.value)) {
        const firstPolicy = legalPolicies.value[0]
        if (firstPolicy) policyActiveTab.value = firstPolicy.policyType
      }
    } catch (error) {
      legalPolicies.value = []
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as Error).message)
          : i18ns.t('loginOrRegisterPage.legalPolicyLoadFailed')
      Notification.notify(i18ns.t('error'), message, 'error')
    } finally {
      policyDialogLoading.value = false
    }
  }

  const openLegalPolicyDialog = async (
    policyType: LegalPolicyType,
    requireConfirmation = false,
  ) => {
    policyActiveTab.value = policyType
    policyDialogRequireConfirmation.value = requireConfirmation
    if (!requireConfirmation) {
      policyConsentChecked.value = registerForm.agreedToLegalPolicies
      policyConsentChallengeToken.value = ''
    }
    policyDialogVisible.value = true
    await loadLegalPolicies()
  }

  const openPolicyConsentDialog = async (challengeTokenValue: string) => {
    policyConsentChallengeToken.value = challengeTokenValue
    policyConsentChecked.value = false
    await openLegalPolicyDialog('terms_of_service', true)
  }

  const clearPendingPolicyConsent = () => {
    policyConsentChallengeToken.value = ''
    policyDialogRequireConfirmation.value = false
  }

  const redirectAfterSuccessfulLogin = async (userData?: Record<string, any>) => {
    const { authorizationService } = await loadAuthorizationService()
    await authorizationService.reloadAuthStoresAfterLogin(userData)

    Notification.notify(
      i18ns.t('information'),
      i18ns.t('message.information.loginSuccess'),
      'success',
    )

    await router.push(buildPostLoginRoute())
  }

  const clearQrSessionQuery = async () => {
    if (!getQrSessionIdFromRoute()) return

    const nextQuery = { ...route.query }
    delete nextQuery.qrSession
    await router.replace({ name: 'login', query: nextQuery })
  }

  const finishQrAuth = async (
    auth: AuthData | TwoFactorRequiredData | PolicyConsentRequiredData,
  ) => {
    const { authorizationService } = await loadAuthorizationService()

    if (authorizationService.isTwoFactorChallengePayload(auth)) {
      const redirect = getChallengeRedirect()
      authorizationService.setPendingTwoFactorChallenge(auth.challengeToken, redirect, 'login')
      await router.replace({
        name: 'authVerification',
        query: {
          method: 'code',
          authEntry: 'login',
          ...(redirect ? { redirect } : {}),
        },
      })
      return
    }

    if (authorizationService.isPolicyConsentPayload(auth)) {
      await openPolicyConsentDialog(auth.challengeToken)
      return
    }

    authorizationService.completeLogin(auth)
    await redirectAfterSuccessfulLogin(auth.user)
  }

  const handleQrStatusResponse = async (
    sessionId: string,
    status: QrLoginSessionStatusResponse,
  ) => {
    qrLoginStatus.value = status.status
    qrLoginScannedUser.value = status.user
      ? {
          username: status.user.username,
          email: status.user.email,
        }
      : null

    if (status.status === 'approved' && status.auth) {
      qrPolling.value = false
      clearQrPollingTimer()
      stopQrStatusStream()
      await finishQrAuth(status.auth)
      await socialAuthService.consumeQrLoginSession(sessionId).catch((error) => {
        console.warn('Failed to consume QR login session:', error)
      })
      return
    }

    if (
      status.status === 'rejected' ||
      status.status === 'expired' ||
      status.status === 'consumed'
    ) {
      qrPolling.value = false
      clearQrPollingTimer()
      stopQrStatusStream()
      return
    }

    qrPolling.value = status.status === 'pending' || status.status === 'scanned'
  }

  const pollQrLoginStatus = async (sessionId: string, delayMs = 0) => {
    clearQrPollingTimer()
    qrPollingTimer = setTimeout(async () => {
      try {
        const status = await socialAuthService.getQrLoginStatus(sessionId)
        await handleQrStatusResponse(sessionId, status)

        if (status.status === 'pending' || status.status === 'scanned') {
          const intervalSeconds = qrLoginSession.value?.pollIntervalSeconds ?? 3
          await pollQrLoginStatus(sessionId, intervalSeconds * 1000)
        }
      } catch (error: any) {
        if (error?.code === CustomCode.QR_LOGIN_SESSION_EXPIRED) {
          qrLoginStatus.value = 'expired'
        }
        qrPolling.value = false
      }
    }, delayMs)
  }

  const startQrPolling = async (sessionId: string, pollIntervalSeconds = 0) => {
    stopQrStatusStream()
    clearQrPollingTimer()
    qrPolling.value = true

    let fallbackStarted = false
    const startPollingFallback = () => {
      if (fallbackStarted) return
      fallbackStarted = true
      void pollQrLoginStatus(sessionId, Math.max(0, pollIntervalSeconds * 1000))
    }

    qrStatusStream = socialAuthService.streamQrLoginStatus(sessionId, {
      onMessage: (data) => {
        if (!data || typeof data !== 'object' || !('status' in data)) return
        void handleQrStatusResponse(sessionId, data as QrLoginSessionStatusResponse)
      },
      onError: () => {
        startPollingFallback()
      },
      onDone: () => {
        if (qrLoginStatus.value === 'pending' || qrLoginStatus.value === 'scanned') {
          startPollingFallback()
        }
      },
    })
  }

  const restoreQrSessionFromRoute = async () => {
    const sessionId = getQrSessionIdFromRoute()
    if (!sessionId) {
      resetQrSessionState()
      return
    }

    qrLoginSession.value = {
      sessionId,
      qrCodeDataUrl:
        qrLoginSession.value?.sessionId === sessionId ? qrLoginSession.value.qrCodeDataUrl : '',
      expiresIn: qrLoginSession.value?.sessionId === sessionId ? qrLoginSession.value.expiresIn : 0,
      pollIntervalSeconds:
        qrLoginSession.value?.sessionId === sessionId
          ? qrLoginSession.value.pollIntervalSeconds
          : 3,
    }
    if (!qrLoginStatus.value) qrLoginStatus.value = 'pending'
    await startQrPolling(sessionId)

    if (
      !isDesktop.value &&
      route.path !== '/auth/qr-approve' &&
      getAccessToken() &&
      autoScannedQrSessionId !== sessionId
    ) {
      autoScannedQrSessionId = sessionId
      void handleQrScan(true)
    }
  }

  const createAndTrackQrLoginSession = async () => {
    const session = await socialAuthService.createQrLoginSession()
    qrLoginSession.value = session
    qrLoginStatus.value = 'pending'
    qrLoginScannedUser.value = null
    await router.push({
      name: 'login',
      query: {
        ...(getSafeRedirect() ? { redirect: getSafeRedirect() } : {}),
        qrSession: session.sessionId,
      },
    })
    await startQrPolling(session.sessionId, session.pollIntervalSeconds)
  }

  const handleQrScan = async (silent = false) => {
    const sessionId = getQrSessionIdFromRoute()
    if (!sessionId) return

    qrLoginBusy.value = true
    try {
      const status = await socialAuthService.scanQrLogin(sessionId)
      await handleQrStatusResponse(sessionId, status)
    } catch (error: any) {
      if (!silent) {
        Notification.notify(i18ns.t('error'), error?.message || i18ns.t('operationFailed'), 'error')
      }
    } finally {
      qrLoginBusy.value = false
    }
  }

  const handleQrConfirm = async (approve: boolean) => {
    const sessionId = getQrSessionIdFromRoute()
    if (!sessionId) return

    qrLoginBusy.value = true
    try {
      const status = await socialAuthService.confirmQrLogin(sessionId, approve)
      await handleQrStatusResponse(sessionId, status)
      if (!approve) {
        await clearQrSessionQuery()
      }
    } catch (error: any) {
      Notification.notify(i18ns.t('error'), error?.message || i18ns.t('operationFailed'), 'error')
    } finally {
      qrLoginBusy.value = false
    }
  }

  const confirmPolicyConsentAndContinue = async () => {
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
      const { authorizationService } = await loadAuthorizationService()
      const authData = await authorizationService.acceptPolicyConsent(
        policyConsentChallengeToken.value,
      )
      persistLegalPolicyConsentCache(authData.user?.username ?? loginForm.username)
      policyDialogVisible.value = false
      policyDialogRequireConfirmation.value = false
      policyConsentChallengeToken.value = ''
      await redirectAfterSuccessfulLogin(authData.user)
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

  const acceptPendingPolicyConsentInline = async () => {
    if (!loginForm.agreedToLegalPolicies) {
      Notification.notify(
        i18ns.t('warning'),
        i18ns.t('loginOrRegisterPage.loginConsentPendingHint'),
        'warning',
      )
      return false
    }

    if (!policyConsentChallengeToken.value) {
      Notification.notify(i18ns.t('error'), i18ns.t('message.error.loginFailed'), 'error')
      return false
    }

    loading.value = true
    try {
      const { authorizationService } = await loadAuthorizationService()
      const authData = await authorizationService.acceptPolicyConsent(
        policyConsentChallengeToken.value,
      )
      persistLegalPolicyConsentCache(authData.user?.username ?? loginForm.username)
      clearPendingPolicyConsent()
      await redirectAfterSuccessfulLogin(authData.user)
      return true
    } catch (error: any) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as Error).message)
          : i18ns.t('message.error.loginFailed')
      Notification.notify(i18ns.t('error'), message, 'error')
      return false
    } finally {
      loading.value = false
    }
  }

  const handleLogin = async () => {
    const { authorizationService } = await loadAuthorizationService()
    const loginRes = await authorizationService.login(
      currentForm.value.username,
      md5(currentForm.value.password),
      loginForm.agreedToLegalPolicies,
      () => {
        captchaVerifying.value = true
      },
      () => {
        captchaVerifying.value = false
      },
    )

    if (
      loginRes.code === CustomCode.OK &&
      authorizationService.isTwoFactorChallengePayload(loginRes.data)
    ) {
      const redirect = getChallengeRedirect()
      authorizationService.setPendingTwoFactorChallenge(
        loginRes.data.challengeToken,
        redirect,
        'login',
      )
      void router.push({
        name: 'authVerification',
        query: {
          method: 'code',
          authEntry: 'login',
          ...(redirect ? { redirect } : {}),
        },
      })
      return
    }

    if (authorizationService.isPolicyConsentPayload(loginRes.data)) {
      policyConsentChallengeToken.value = loginRes.data.challengeToken
      if (loginForm.agreedToLegalPolicies) {
        await acceptPendingPolicyConsentInline()
        return
      }

      Notification.notify(
        i18ns.t('warning'),
        i18ns.t('loginOrRegisterPage.loginConsentPendingHint'),
        'warning',
      )
      return
    }

    clearPendingPolicyConsent()

    if (loginRes.code === CustomCode.OK && authorizationService.isAuthPayload(loginRes.data)) {
      persistLegalPolicyConsentCache(loginRes.data.user?.username ?? loginForm.username)
      await redirectAfterSuccessfulLogin(loginRes.data.user)
    } else if (loginRes.code === CustomCode.LOGIN_AUTH_FAILED) {
      Notification.notify(
        i18ns.t('information'),
        i18ns.t('message.error.invalidCredentials'),
        'error',
      )
    } else if (loginRes.code === CustomCode.ACCOUNT_DISABLED) {
      Notification.notify(i18ns.t('information'), i18ns.t('message.error.accountDisabled'), 'error')
    } else if (
      loginRes.message?.toLowerCase?.().includes('captcha') ||
      loginRes.message?.includes('人机验证')
    ) {
      Notification.notify(
        i18ns.t('error'),
        loginRes.message || i18ns.t('loginOrRegisterPage.captchaFailedFallback'),
        'error',
      )
    }
  }

  const handleRegister = async () => {
    const { authorizationService } = await loadAuthorizationService()
    const result = await authorizationService.register(
      {
        username: registerForm.username,
        password: md5(registerForm.password),
        nickname: registerForm.nickname || undefined,
        email: registerForm.email,
        verificationCode: registerForm.verificationCode,
        agreedToLegalPolicies: registerForm.agreedToLegalPolicies,
      },
      () => {
        captchaVerifying.value = true
      },
      () => {
        captchaVerifying.value = false
      },
    )
    if (
      result.code === CustomCode.OK &&
      authorizationService.isTwoFactorChallengePayload(result.data)
    ) {
      const redirect = getChallengeRedirect()
      authorizationService.setPendingTwoFactorChallenge(
        result.data.challengeToken,
        redirect,
        'register',
      )
      void router.push({
        name: 'authVerification',
        query: {
          method: 'code',
          authEntry: 'register',
          ...(redirect ? { redirect } : {}),
        },
      })
    } else if (result.code === CustomCode.OK) {
      persistLegalPolicyConsentCache(registerForm.username)
      Notification.notify(
        i18ns.t('information'),
        i18ns.t('message.information.registerSuccess'),
        'success',
      )
      setTimeout(toggleMode, 500)
    } else if (result.code === CustomCode.REGISTRATION_DISABLED) {
      Notification.notify(i18ns.t('error'), i18ns.t('message.error.registrationDisabled'), 'error')
    } else if (result.code === CustomCode.VERIFICATION_CODE_INVALID) {
      Notification.notify(
        i18ns.t('error'),
        i18ns.t('message.error.verificationCodeInvalid'),
        'error',
      )
    } else if (result.code === CustomCode.EMAIL_LIMIT_REACHED) {
      Notification.notify(i18ns.t('error'), i18ns.t('message.error.emailLimitReached'), 'error')
    } else if (
      result.message?.toLowerCase?.().includes('captcha') ||
      result.message?.includes('人机验证')
    ) {
      Notification.notify(
        i18ns.t('error'),
        result.message || i18ns.t('loginOrRegisterPage.captchaFailedFallback'),
        'error',
      )
    } else {
      Notification.notify(
        i18ns.t('error'),
        result.message || i18ns.t('message.error.registerFailed'),
        'error',
      )
    }
  }

  const handleSubmit = async () => {
    if (!formRef.value) return

    if (isLogin.value && policyConsentChallengeToken.value) {
      await acceptPendingPolicyConsentInline()
      return
    }

    loading.value = true

    try {
      const isValid = await formRef.value.validate().catch(() => {
        Notification.notify(
          i18ns.t('error'),
          i18ns.t('message.error.formValidationFailed'),
          'error',
        )
        return false
      })
      if (!isValid) return

      if (isLogin.value) await handleLogin()
      else await handleRegister()
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as Error).message)
          : String(error ?? i18ns.t('unknownError'))

      Notification.notify(
        i18ns.t('error'),
        `${i18ns.t('loginOrRegisterPage.requestFailed')}：${message || i18ns.t('tryAgainLater')}`,
        'error',
      )
      console.error('Login/Register error:', error)
    } finally {
      loading.value = false
    }
  }

  const handleUsernameEnter = () => {
    if (isLogin.value) {
      if (currentForm.value.username && currentForm.value.password) {
        void handleSubmit()
      }
    } else {
      void handleSubmit()
    }

    if (!currentForm.value.password) passwordInputRef.value?.focus()
  }

  const handlePasswordEnter = () => {
    if (isLogin.value) {
      if (currentForm.value.username && currentForm.value.password) {
        void handleSubmit()
      }
    } else {
      void handleSubmit()
    }
  }

  const clearUsernameValidationCache = () => {}

  const clearLoginForm = () => {
    loginForm.username = ''
    loginForm.password = ''
    loginForm.agreedToLegalPolicies = false
    clearPendingPolicyConsent()
  }

  const clearRegisterForm = () => {
    registerForm.username = ''
    registerForm.password = ''
    registerForm.confirmPassword = ''
    registerForm.nickname = ''
    registerForm.email = ''
    registerForm.verificationCode = ''
    registerForm.agreedToLegalPolicies = false
    clearUsernameValidationCache()
  }

  const handleSendCode = async () => {
    const email = registerForm.email
    if (!email) return

    try {
      const { authorizationService } = await loadAuthorizationService()
      await authorizationService.sendRegisterVerificationCode(
        email,
        () => {
          captchaVerifying.value = true
        },
        () => {
          captchaVerifying.value = false
        },
      )
      Notification.notify(
        i18ns.t('information'),
        i18ns.t('loginOrRegisterPage.codeSent'),
        'success',
      )
      codeCooldown.value = 60
      if (cooldownTimer) clearInterval(cooldownTimer)
      cooldownTimer = setInterval(() => {
        codeCooldown.value--
        if (codeCooldown.value <= 0 && cooldownTimer) {
          clearInterval(cooldownTimer)
          cooldownTimer = null
        }
      }, 1000)
    } catch (error: any) {
      const errorData = error?.response?.data || error?.data || {}
      const errorCode = errorData.code
      const errorMessage = errorData.message
      const retryAfter = errorData.data?.retryAfter

      if (errorCode === CustomCode.TOO_MANY_REQUESTS) {
        const minutes = Math.ceil(retryAfter / 60)
        const message = retryAfter
          ? `${errorMessage}${i18ns.t('loginOrRegisterPage.retryAfterMinutes', { minutes })}`
          : errorMessage || i18ns.t('loginOrRegisterPage.tooManyRequestsFallback')
        Notification.notify(i18ns.t('error'), message, 'error')
      } else if (errorCode === CustomCode.SMTP_NOT_CONFIGURED) {
        Notification.notify(i18ns.t('error'), i18ns.t('message.error.smtpNotConfigured'), 'error')
      } else if (
        errorMessage?.toLowerCase?.().includes('captcha') ||
        errorMessage?.includes('人机验证')
      ) {
        Notification.notify(
          i18ns.t('error'),
          errorMessage || i18ns.t('loginOrRegisterPage.captchaFailedFallback'),
          'error',
        )
      } else {
        Notification.notify(
          i18ns.t('error'),
          errorMessage || i18ns.t('message.error.smtpNotConfigured'),
          'error',
        )
      }
    }
  }

  const handleReset = () => {
    if (isLogin.value) clearLoginForm()
    else clearRegisterForm()
    if (!formRef.value) return
    formRef.value.resetFields()
  }

  const toggleMode = async () => {
    const nextMode = isLogin.value ? 'register' : 'login'

    if (nextMode === 'register') {
      const enabled = await ensureRegistrationEnabled()
      if (!enabled) {
        Notification.notify(
          i18ns.t('error'),
          i18ns.t('message.error.registrationDisabled'),
          'error',
        )
        return
      }
    }

    if (formRef.value) {
      formRef.value.resetFields()
      formRef.value.clearValidate()
    }

    if (nextMode === 'login') clearLoginForm()
    else clearRegisterForm()

    mode.value = nextMode
    const redirect = getSafeRedirect()
    void router.replace(
      nextMode === 'register' ? getRegisterRoute(redirect) : getLoginRoute(redirect),
    )
    clearUsernameValidationCache()
    clearPendingPolicyConsent()
  }

  const handleForgotPassword = () => {
    void router.push(getForgotPasswordRoute(getSafeRedirect()))
  }

  const handlePasskeyLogin = async () => {
    if (!loginForm.agreedToLegalPolicies) {
      Notification.notify(
        i18ns.t('warning'),
        i18ns.t('loginOrRegisterPage.agreementRequired'),
        'warning',
      )
      return
    }

    if (!passkeySupported) {
      Notification.notify(i18ns.t('error'), i18ns.t('passkey.notSupported'), 'warning')
      return
    }

    passkeyLoading.value = true

    try {
      const { authorizationService } = await loadAuthorizationService()
      const startAuthentication = await loadPasskeyStartAuthentication()
      const { passkeyService } = await loadPasskeyService()
      const { options, sessionId } = await passkeyService.getAuthOptions()
      const authResponse = await startAuthentication({ optionsJSON: options as any })
      const result = await passkeyService.verifyAuth(sessionId, authResponse)

      if (passkeyService.isTwoFactorChallengePayload(result)) {
        const redirect = getChallengeRedirect()
        authorizationService.setPendingTwoFactorChallenge(result.challengeToken, redirect, 'login')

        Notification.notify(
          i18ns.t('information'),
          i18ns.t('twoFactor.passkeyNeedSecondFactor'),
          'warning',
        )

        await router.push({
          name: 'authVerification',
          query: {
            method: 'code',
            authEntry: 'login',
            ...(redirect ? { redirect } : {}),
          },
        })
        return
      }

      if (authorizationService.isPolicyConsentPayload(result)) {
        await openPolicyConsentDialog(result.challengeToken)
        return
      }

      authorizationService.clearPendingTwoFactorChallenge()
      await redirectAfterSuccessfulLogin()
    } catch (error: any) {
      if (error?.name !== 'NotAllowedError') {
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as Error).message)
            : i18ns.t('passkey.loginFailed')

        Notification.notify(i18ns.t('error'), message, 'error')
        console.error('Passkey login failed:', error)
      }
    } finally {
      passkeyLoading.value = false
    }
  }

  const handleExternalAuthLogin = async (provider: ExternalAuthProvider) => {
    externalAuthLoading.value = provider
    try {
      const redirect = getChallengeRedirect()
      const { authorizeUrl } = await socialAuthService.startExternalAuth(
        provider,
        'login',
        redirect,
      )
      window.location.href = authorizeUrl
    } catch (error) {
      Notification.notify(
        i18ns.t('error'),
        (error instanceof Error && error.message) || i18ns.t('message.error.loginFailed'),
        'error',
      )
    } finally {
      externalAuthLoading.value = null
    }
  }

  const handleQrLogin = async () => {
    externalAuthLoading.value = 'qr'
    try {
      await createAndTrackQrLoginSession()
      Notification.notify(
        i18ns.t('information'),
        i18ns.t('message.information.createSuccess'),
        'success',
      )
    } catch (error) {
      Notification.notify(
        i18ns.t('error'),
        (error instanceof Error && error.message) || i18ns.t('message.error.loginFailed'),
        'error',
      )
    } finally {
      externalAuthLoading.value = null
    }
  }

  const closePolicyDialog = () => {
    policyDialogVisible.value = false
  }

  onMounted(async () => {
    waterMarkTextStore.setText('AppSystem')
    const initialModeFromQuery = typeof route.query.mode === 'string' ? route.query.mode : 'login'
    mode.value =
      route.path === '/register' || initialModeFromQuery === 'register' ? 'register' : 'login'

    const scheduleIdleTask = (callback: () => void, timeout = 3000) => {
      const idleWindow = window as IdleWindow
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(callback, { timeout })
        return
      }
      setTimeout(callback, Math.min(timeout, 1200))
    }

    scheduleIdleTask(() => {
      captchaWarmupRunning.value = true
      void loadCaptchaDialogService()
        .then(({ warmupCaptchaTrust }) =>
          warmupCaptchaTrust(mode.value === 'register' ? 'register' : 'login'),
        )
        .finally(() => {
          captchaWarmupRunning.value = false
        })
    }, 0)

    if (mode.value === 'login') {
      scheduleIdleTask(() => {
        void ensureRegistrationEnabled()
      }, 2500)

      scheduleIdleTask(() => {
        void ensurePublicSocialAuthConfig()
      }, 3000)
    }

    if (mode.value === 'register') {
      scheduleIdleTask(() => {
        void ensureRegistrationEnabled().then((enabled) => {
          if (enabled) return

          mode.value = 'login'
          clearRegisterForm()
          void router.replace(getLoginRoute(getSafeRedirect()))
        })
      }, 2000)
    }

    await restoreQrSessionFromRoute()
  })

  onBeforeUnmount(() => {
    if (cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
    clearQrPollingTimer()
    stopQrStatusStream()
  })

  watch(
    () => [loginForm.username, loginForm.password],
    () => {
      clearPendingPolicyConsent()
    },
  )

  watch(
    () => [loginForm.username, currentPolicySignature.value],
    () => {
      if (policyConsentChallengeToken.value) return
      syncLoginPolicyConsentFromCache()
    },
    { immediate: true },
  )

  watch(
    () => route.query.qrSession,
    () => {
      void restoreQrSessionFromRoute()
    },
  )

  return {
    captchaVerifying,
    captchaWarmupRunning,
    closePolicyDialog,
    codeCooldown,
    confirmPolicyConsentAndContinue,
    currentForm,
    currentRules,
    currentPolicySignature,
    formRef,
    getQrSessionIdFromRoute,
    getQrStatusText,
    handleForgotPassword,
    handleExternalAuthLogin,
    handleQrConfirm,
    handleQrLogin,
    handleQrScan,
    handlePasswordEnter,
    handlePasskeyLogin,
    handleReset,
    handleSendCode,
    handleSubmit,
    handleUsernameEnter,
    isDesktop,
    isLogin,
    legalPolicies,
    loading,
    externalAuthLoading,
    loginForm,
    mobileFieldDisabled,
    mode,
    openLegalPolicyDialog,
    passkeyLoading,
    passkeySupported,
    publicSocialAuthConfig,
    ensurePublicSocialAuthConfig,
    passwordInputRef,
    policyActiveTab,
    policyConsentChecked,
    policyDialogLoading,
    policyDialogRequireConfirmation,
    policyDialogSubmitting,
    policyDialogVisible,
    policyTabs,
    qrLoginBusy,
    qrLoginScannedUser,
    qrLoginSession,
    qrLoginStatus,
    qrPolling,
    registerForm,
    registrationEnabled,
    registrationStatusReady,
    submitDisabled,
    toggleMode,
    usernameInputRef,
  }
}

export type LoginOrRegisterState = ReturnType<typeof useLoginOrRegister>
