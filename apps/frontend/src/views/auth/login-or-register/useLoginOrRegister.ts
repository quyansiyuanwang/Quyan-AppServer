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
  getRegisterRoute,
  getSafeAuthRedirect,
} from '@/utils/auth-routes'
import { usePageDevice } from '@/composables/usePageDevice'
import type { LegalPolicyType, PublicLegalPolicyDto } from '@/client/types.gen'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

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

export function useLoginOrRegister() {
  const formRef = ref<FormInstance>()
  const usernameInputRef = ref()
  const passwordInputRef = ref()
  const waterMarkTextStore = useWaterMarkTextStore()
  const route = useRoute()
  const registrationEnabled = ref<boolean | null>(null)
  const captchaWarmupRunning = ref(false)
  const codeCooldown = ref(0)
  const loading = ref(false)
  const passkeyLoading = ref(false)
  const captchaVerifying = ref(false)
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
      return registrationEnabled.value
    }

    if (!registrationStatusPromise) {
      registrationStatusPromise = loadConfigService()
        .then(({ configService }) => configService.getRegistrationStatus())
        .then((enabled) => {
          registrationEnabled.value = enabled
          return enabled
        })
        .catch((error) => {
          console.error('Failed to load registration status:', error)
          registrationEnabled.value = false
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

    const redirect = getSafeRedirect()
    if (redirect) {
      await router.push(redirect)
    } else {
      await router.push({ name: 'home' })
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
      const redirect = getSafeRedirect()
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
      const redirect = getSafeRedirect()
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
        const redirect = getSafeRedirect()
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
    }, 5000)

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
  })

  onBeforeUnmount(() => {
    if (cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
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
    handleForgotPassword,
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
    loginForm,
    mobileFieldDisabled,
    mode,
    openLegalPolicyDialog,
    passkeyLoading,
    passkeySupported,
    passwordInputRef,
    policyActiveTab,
    policyConsentChecked,
    policyDialogLoading,
    policyDialogRequireConfirmation,
    policyDialogSubmitting,
    policyDialogVisible,
    policyTabs,
    registerForm,
    registrationEnabled,
    submitDisabled,
    toggleMode,
    usernameInputRef,
  }
}

export type LoginOrRegisterState = ReturnType<typeof useLoginOrRegister>
