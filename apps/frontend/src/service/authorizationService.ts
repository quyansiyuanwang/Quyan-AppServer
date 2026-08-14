import { TypedSessionStorage } from '@/utils/typedSessionStorage'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { useRequestStore, getAccessToken } from '@/stores/request'
import StorageKey from '@/constant/storagekey'
import router from '@/router'
import { CustomCode } from '@/constant/custom-code'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import type { AuthData, PolicyConsentRequiredData, UserDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { ensureCaptchaTrust } from '@/service/captchaDialogService'
import { getLoginRoute } from '@/utils/auth-routes'
import { sessionCoordinator } from '@/service/sessionCoordinator'
import { replaceDocument } from '@/service/navigationService'
import { cache } from '@/utils/common'
import { createAuthControllerApi } from '@/client/services/auth-controller.gen'

const getAuthControllerApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

interface RegisterRequest {
  username: string
  password: string
  nickname?: string
  email: string
  verificationCode: string
  agreedToLegalPolicies: boolean
}

interface ResetPasswordRequest {
  username: string
  email: string
  verificationCode: string
  newPassword: string
}

interface TwoFactorChallengeData {
  requiresTwoFactor: true
  challengeToken: string
  expiresIn: number
}

interface AuthTokenData {
  access_token: string
  refresh_token?: string
}

interface PendingTwoFactorChallenge {
  challengeToken: string
  redirect?: string
  authEntry?: 'login' | 'register'
  createdAt: number
}

interface PendingPolicyConsentChallenge {
  challengeToken: string
  redirect?: string
  createdAt: number
}

interface CompleteLoginOptions {
  preserveRefreshTokenIfMissing?: boolean
  clearPendingTwoFactorChallenge?: boolean
}

interface ServiceResultLike {
  code?: number
  message?: string
}

export class AuthorizationService {
  private static instance: AuthorizationService | null = null
  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new AuthorizationService()
    }
    return this.instance
  }

  private isCaptchaFailureError(source: unknown): boolean {
    const message =
      source instanceof Error
        ? source.message
        : typeof source === 'object' && source && 'message' in source
          ? String((source as { message?: unknown }).message || '')
          : ''

    if (!message) return false
    const normalized = message.toLowerCase()
    return (
      normalized.includes('captcha') || message.includes('人机验证') || message.includes('验证码')
    )
  }

  private isCaptchaFailureResult(source: unknown): boolean {
    if (!source || typeof source !== 'object') return false

    const result = source as ServiceResultLike
    if (result.code !== CustomCode.VALIDATION_FAILED) return false
    return this.isCaptchaFailureError(result)
  }

  private async withCaptchaFallback<T>(
    action: string,
    execute: (captchaToken: string | undefined) => Promise<T>,
    onCaptchaStart?: () => void,
    onCaptchaEnd?: () => void,
  ): Promise<T> {
    try {
      const result = await execute(undefined)

      if ((result as ServiceResultLike | undefined)?.code === CustomCode.CAPTCHA_TRUST_REQUIRED) {
        await this.requestCaptchaTrust(action, onCaptchaStart, onCaptchaEnd)
        return await execute(undefined)
      }

      return result
    } catch (error) {
      const serviceError = toServiceError(error)
      if (serviceError.code === CustomCode.CAPTCHA_TRUST_REQUIRED) {
        await this.requestCaptchaTrust(action, onCaptchaStart, onCaptchaEnd)
        return await execute(undefined)
      }

      throw error
    }
  }

  private async requestCaptchaTrust(
    action: string,
    onCaptchaStart?: () => void,
    onCaptchaEnd?: () => void,
  ): Promise<void> {
    const progressStore = useTopLoadingProgressStore()

    try {
      if (onCaptchaStart) onCaptchaStart()
      await progressStore.wrapTask(ensureCaptchaTrust(action))
    } finally {
      if (onCaptchaEnd) onCaptchaEnd()
    }
  }

  async login(
    username: string,
    password: string,
    agreedToLegalPolicies: boolean,
    onCaptchaStart?: () => void,
    onCaptchaEnd?: () => void,
  ) {
    if (!agreedToLegalPolicies) {
      throw toServiceError(
        {
          code: CustomCode.VALIDATION_FAILED,
          message: 'Please agree to the latest legal policies first',
        },
        'Please agree to the latest legal policies first',
      )
    }

    const result = await this.withCaptchaFallback(
      'login',
      async (_captchaToken) =>
        await getAuthControllerApi().login({
          body: {
            username,
            password,
            agreedToLegalPolicies: true,
          },
        }),
      onCaptchaStart,
      onCaptchaEnd,
    )

    if (result.code === CustomCode.OK && this.isAuthPayload(result.data)) {
      this.completeLogin(result.data)
    }

    return result
  }

  isTwoFactorChallengePayload(data: unknown): data is TwoFactorChallengeData {
    return (
      !!data &&
      typeof data === 'object' &&
      'requiresTwoFactor' in data &&
      (data as { requiresTwoFactor?: unknown }).requiresTwoFactor === true &&
      'challengeToken' in data
    )
  }

  isPolicyConsentPayload(data: unknown): data is PolicyConsentRequiredData {
    return (
      !!data &&
      typeof data === 'object' &&
      'requiresPolicyConsent' in data &&
      (data as { requiresPolicyConsent?: unknown }).requiresPolicyConsent === true &&
      'challengeToken' in data
    )
  }

  isAuthPayload(data: unknown): data is AuthTokenData {
    return !!data && typeof data === 'object' && 'access_token' in data
  }

  completeLogin(
    authData: { access_token: string; refresh_token?: string; user?: Partial<UserDto> },
    options: CompleteLoginOptions = {},
  ) {
    const { clearPendingTwoFactorChallenge = true } = options

    if (clearPendingTwoFactorChallenge) {
      this.clearPendingTwoFactorChallenge()
    }

    sessionCoordinator.completeLogin(authData)
  }

  async reloadAuthStoresAfterLogin(userData?: Partial<UserDto>) {
    await sessionCoordinator.hydrateUserAndPermissions(userData)
  }

  setPendingTwoFactorChallenge(
    challengeToken: string,
    redirect?: string,
    authEntry?: 'login' | 'register',
  ) {
    if (!challengeToken) return

    const payload: PendingTwoFactorChallenge = {
      challengeToken,
      redirect,
      authEntry,
      createdAt: Date.now(),
    }

    TypedSessionStorage.setItem(
      StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE,
      JSON.stringify(payload),
    )
  }

  getPendingTwoFactorChallenge(): PendingTwoFactorChallenge | null {
    const raw = TypedSessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as PendingTwoFactorChallenge
      if (!parsed?.challengeToken || typeof parsed.challengeToken !== 'string') {
        this.clearPendingTwoFactorChallenge()
        return null
      }
      return parsed
    } catch {
      this.clearPendingTwoFactorChallenge()
      return null
    }
  }

  clearPendingTwoFactorChallenge() {
    TypedSessionStorage.removeItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)
  }

  setPendingPolicyConsentChallenge(challengeToken: string, redirect?: string) {
    if (!challengeToken) return

    const payload: PendingPolicyConsentChallenge = {
      challengeToken,
      redirect,
      createdAt: Date.now(),
    }

    TypedSessionStorage.setItem(
      StorageKey.Auth.PENDING_POLICY_CONSENT_CHALLENGE,
      JSON.stringify(payload),
    )
  }

  getPendingPolicyConsentChallenge(): PendingPolicyConsentChallenge | null {
    const raw = TypedSessionStorage.getItem(StorageKey.Auth.PENDING_POLICY_CONSENT_CHALLENGE)
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as PendingPolicyConsentChallenge
      if (!parsed?.challengeToken || typeof parsed.challengeToken !== 'string') {
        this.clearPendingPolicyConsentChallenge()
        return null
      }
      return parsed
    } catch {
      this.clearPendingPolicyConsentChallenge()
      return null
    }
  }

  clearPendingPolicyConsentChallenge() {
    TypedSessionStorage.removeItem(StorageKey.Auth.PENDING_POLICY_CONSENT_CHALLENGE)
  }

  async refreshToken(_refreshToken?: string) {
    const token = await sessionCoordinator.refresh()
    return token ? { access_token: token } : undefined
  }

  async verifyToken(token: string): Promise<boolean> {
    try {
      const result = await getAuthControllerApi().verify({
        body: {
          access_token: token,
        },
      })

      return result?.code === CustomCode.OK
    } catch (error) {
      console.error('Failed to verify token:', error)
      return false
    }
  }

  async promiseGetAccessToken(): Promise<string> {
    const token = AuthorizationService.getAccessToken()
    if (token && (await this.verifyToken(token))) {
      return token!
    } else {
      const refreshResult = await this.refreshToken()
      if (refreshResult?.access_token) {
        return refreshResult.access_token
      } else {
        throw toServiceError(undefined, 'Unable to refresh access token')
      }
    }
  }

  async logout(redirectPath?: string) {
    await sessionCoordinator.logout()
    useImpersonationStore().clearSession()
    this.clearPendingTwoFactorChallenge()
    this.clearPendingPolicyConsentChallenge()

    // Business profiles do not register a local /login route. Continue to
    // the central identity app after local cleanup; the auth app owns the
    // login UI for every non-identity hostname.
    const { isKnownSiteProfile, resolveCurrentSiteProfile } = await import('@/config/site-registry')
    const currentProfile = resolveCurrentSiteProfile()
    if (isKnownSiteProfile(currentProfile) && currentProfile.id !== 'identity') {
      const { getCentralLoginFallbackUrl, redirectToCentralLogin } = await import(
        '@/service/centralLoginService'
      )
      try {
        await redirectToCentralLogin(redirectPath)
      } catch (error) {
        console.warn('Central login redirect failed after logout:', error)
        replaceDocument(getCentralLoginFallbackUrl(currentProfile))
      }
      return
    }

    // Identity profile keeps the in-app login route and its relative return.
    await router.push(getLoginRoute(redirectPath))
  }

  static getAccessToken(): string | null {
    return getAccessToken()
  }

  async bootstrapSession(): Promise<string | null> {
    return sessionCoordinator.ensureSession()
  }

  async sendRegisterVerificationCode(
    email: string,
    onCaptchaStart?: () => void,
    onCaptchaEnd?: () => void,
  ) {
    const result = await this.withCaptchaFallback(
      'send_verification_code',
      async (_captchaToken) =>
        await getAuthControllerApi().sendRegisterVerificationCode({
          body: {
            email,
          },
        }),
      onCaptchaStart,
      onCaptchaEnd,
    )
    if (result.code === CustomCode.OK) return true

    throw toServiceError(result)
  }

  async sendPasswordResetCode(
    username: string,
    email: string,
    onCaptchaStart?: () => void,
    onCaptchaEnd?: () => void,
  ) {
    const result = await this.withCaptchaFallback(
      'send_password_reset_code',
      async (_captchaToken) =>
        await getAuthControllerApi().sendPasswordResetCode({
          body: {
            username,
            email,
          },
        }),
      onCaptchaStart,
      onCaptchaEnd,
    )

    if (result.code === CustomCode.OK) return true

    throw toServiceError(result)
  }

  async resetPassword(
    data: ResetPasswordRequest,
    onCaptchaStart?: () => void,
    onCaptchaEnd?: () => void,
  ) {
    const result = await this.withCaptchaFallback(
      'reset_password',
      async (_captchaToken) =>
        await getAuthControllerApi().resetPassword({
          body: {
            ...data,
          },
        }),
      onCaptchaStart,
      onCaptchaEnd,
    )

    if (result.code === CustomCode.OK) return true

    throw toServiceError(result)
  }

  async register(data: RegisterRequest, onCaptchaStart?: () => void, onCaptchaEnd?: () => void) {
    if (!data.agreedToLegalPolicies) {
      throw toServiceError(
        {
          code: CustomCode.VALIDATION_FAILED,
          message: 'Please agree to the latest legal policies first',
        },
        'Please agree to the latest legal policies first',
      )
    }

    const result = await this.withCaptchaFallback(
      'register',
      async (_captchaToken) =>
        await getAuthControllerApi().register({
          body: {
            ...data,
            agreedToLegalPolicies: true,
          },
        }),
      onCaptchaStart,
      onCaptchaEnd,
    )
    return result
  }

  async acceptPolicyConsent(challengeToken: string): Promise<AuthData> {
    const result = await getAuthControllerApi().acceptPolicyConsent({
      body: {
        challengeToken,
        agreedToLegalPolicies: true,
      },
    })

    if (result.code === CustomCode.OK && result.data && this.isAuthPayload(result.data)) {
      this.completeLogin(result.data)
      return result.data as AuthData
    }

    throw toServiceError(result, 'Failed to accept legal policies')
  }
}

export const authorizationService = AuthorizationService.getInstance()
