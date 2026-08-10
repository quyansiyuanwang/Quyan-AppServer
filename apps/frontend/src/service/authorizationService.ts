import { TypedSessionStorage } from '@/utils/typedSessionStorage'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import {
  useRequestStore,
  saveTokenExpiration,
  clearTokenExpiration,
  setAccessToken,
  getAccessToken,
  clearAccessToken,
  isTokenExpired,
} from '@/stores/request'
import StorageKey from '@/constant/storagekey'
import { authEventBus, customCodeBus } from '@/stores/globalInstance'
import router from '@/router'
import { CustomCode } from '@/constant/custom-code'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import type { AuthData, PolicyConsentRequiredData, UserDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import {
  getUserIdFromToken,
  setCurrentStorageScopeForUserId,
  syncCurrentStorageScopeFromToken,
  resetCurrentStorageScope,
} from '@/utils/storageScope'
import { ReplaySigningService } from '@/service/replaySigningService'
import { ensureCaptchaTrust } from '@/service/captchaDialogService'
import { getLoginRoute } from '@/utils/auth-routes'
import { heartbeatService } from '@/service/heartbeatService'
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

interface ClearAuthStateOptions {
  clearRefreshToken?: boolean
  clearImpersonationArtifacts?: boolean
}

interface ServiceResultLike {
  code?: number
  message?: string
}

export class AuthorizationService {
  private static instance: AuthorizationService | null = null
  private logoutPromise: Promise<void> | null = null
  private bootstrapPromise: Promise<string | null> | null = null

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

  private clearStoredRefreshToken() {
    TypedLocalStorage.removeItem(StorageKey.Auth.REFRESH_TOKEN)
    clearTokenExpiration(true)
  }

  private clearImpersonationArtifacts() {
    useImpersonationStore().clearSession()
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE)
  }

  private applyAuthenticatedTokens(
    authData: { access_token: string; refresh_token?: string; user?: Partial<UserDto> },
    options: CompleteLoginOptions = {},
  ) {
    const { preserveRefreshTokenIfMissing = false } = options

    clearTokenExpiration()

    setAccessToken(authData.access_token)

    const normalizedRefreshToken = authData.refresh_token?.trim()
    if (normalizedRefreshToken) {
      clearTokenExpiration(true)
      TypedLocalStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, normalizedRefreshToken)
      saveTokenExpiration(normalizedRefreshToken, true)
    } else if (!preserveRefreshTokenIfMissing) {
      this.clearStoredRefreshToken()
    }
  }

  completeLogin(
    authData: { access_token: string; refresh_token?: string; user?: Partial<UserDto> },
    options: CompleteLoginOptions = {},
  ) {
    const { clearPendingTwoFactorChallenge = true } = options

    if (clearPendingTwoFactorChallenge) {
      this.clearPendingTwoFactorChallenge()
    }

    this.applyAuthenticatedTokens(authData, options)

    const userIdFromToken = getUserIdFromToken(authData.access_token)
    if (userIdFromToken) {
      setCurrentStorageScopeForUserId(userIdFromToken)
    } else {
      setCurrentStorageScopeForUserId((authData as { user?: Partial<UserDto> }).user?.id)
    }

    void ReplaySigningService.getInstance()
      .refreshSigningMaterial()
      .catch((error) => {
        console.warn('Failed to refresh replay signing session after login:', error)
      })

    authEventBus.emit('USER_LOGGED_IN', {
      userId: getUserIdFromToken(authData.access_token) || authData.user?.id || null,
    })

    void heartbeatService.start().catch((error) => {
      console.warn('Failed to start heartbeat service after login:', error)
    })
  }

  async reloadAuthStoresAfterLogin(userData?: Partial<UserDto>) {
    const userInfoStore = useUserInfoStore()
    const permissionStore = usePermissionStore()

    userInfoStore.clear()
    permissionStore.clearCurrentUserPermissions()

    if (userData) {
      setCurrentStorageScopeForUserId(userData.id)
      userInfoStore.setUserInfo(userData)
    }

    try {
      await userInfoStore.fetchUserInfo()
      setCurrentStorageScopeForUserId(userInfoStore.userInfo.id)
    } catch (error) {
      console.error('Failed to refresh user info after login:', error)
    }

    try {
      await permissionStore.init()
    } catch (error) {
      console.error('Failed to refresh permissions after login:', error)
    }
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

  async refreshToken(refresh_token?: string) {
    const impersonationStore = useImpersonationStore()

    const clearAuthState = (options: ClearAuthStateOptions = {}) => {
      const { clearRefreshToken = true, clearImpersonationArtifacts = true } = options

      clearAccessToken()
      clearTokenExpiration()
      if (clearRefreshToken) {
        this.clearStoredRefreshToken()
      }
      if (clearImpersonationArtifacts) {
        this.clearImpersonationArtifacts()
      }
      this.clearPendingTwoFactorChallenge()
      ReplaySigningService.getInstance().clearSigningMaterial()
      heartbeatService.stop()
    }

    if (impersonationStore.isImpersonating) {
      const error = new Error('Impersonation access token cannot be refreshed')
      clearAuthState({ clearRefreshToken: false, clearImpersonationArtifacts: false })
      authEventBus.emit('ACCESS_TOKEN_REFRESH_FAILED', error)
      throw error
    }

    try {
      const normalizedRefreshToken =
        refresh_token?.trim() || AuthorizationService.getRefreshToken()?.trim()
      const refreshBody = normalizedRefreshToken
        ? { refresh_token: normalizedRefreshToken }
        : undefined

      const res = await getAuthControllerApi().refresh(
        { body: (refreshBody ?? {}) as any },
        { retry: false, requestWrapper: async (x: any) => x },
      )

      if (res.code === CustomCode.OK && res.data?.access_token) {
        setAccessToken(res.data.access_token)
        saveTokenExpiration(res.data.access_token)
        if (res.data.refresh_token) {
          TypedLocalStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, res.data.refresh_token)
          saveTokenExpiration(res.data.refresh_token, true)
        }
        syncCurrentStorageScopeFromToken(res.data.access_token)
        await ReplaySigningService.getInstance().refreshSigningMaterial()
        authEventBus.emit('ACCESS_TOKEN_REFRESHED', res.data.access_token)
      } else if (res.code === CustomCode.AUTH_FAILED) {
        clearAuthState()
        authEventBus.emit('ACCESS_TOKEN_REFRESH_FAILED', new Error('Token refresh failed'))
      } else if (res.code === CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE) {
        clearAuthState()
        customCodeBus.emit('TOKEN_EXPIRED_DUE_TO_UPDATE')
        authEventBus.emit(
          'ACCESS_TOKEN_REFRESH_FAILED',
          new Error('Token expired due to account update'),
        )
      } else {
        clearAuthState()
        authEventBus.emit(
          'ACCESS_TOKEN_REFRESH_FAILED',
          new Error('Token refresh returned unexpected response'),
        )
      }

      return res.data
    } catch (error) {
      clearAuthState()
      authEventBus.emit(
        'ACCESS_TOKEN_REFRESH_FAILED',
        error instanceof Error ? error : new Error('Token refresh failed unexpectedly'),
      )
      throw error
    }
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
    if (this.logoutPromise) return this.logoutPromise

    this.logoutPromise = (async () => {
      const accessToken = AuthorizationService.getAccessToken()

      try {
        if (accessToken)
          await getAuthControllerApi().logout(
            {
              body: { access_token: accessToken },
            },
            { retry: false, requestWrapper: async (x: any) => x },
          )
      } catch (error) {
        console.warn('Logout request failed, continue local logout flow:', error)
      }

      clearAccessToken()
      this.clearStoredRefreshToken()
      this.clearImpersonationArtifacts()
      AuthorizationService.getInstance().clearPendingTwoFactorChallenge()
      AuthorizationService.getInstance().clearPendingPolicyConsentChallenge()
      ReplaySigningService.getInstance().clearSigningMaterial()
      heartbeatService.stop()
      authEventBus.emit('USER_LOGGED_OUT')
      resetCurrentStorageScope()

      // Business profiles do not register a local /login route. Continue to
      // the central identity app after local cleanup; the auth app owns the
      // login UI for every non-identity hostname.
      const { isKnownSiteProfile, resolveCurrentSiteProfile } = await import(
        '@/config/site-registry'
      )
      const currentProfile = resolveCurrentSiteProfile()
      if (isKnownSiteProfile(currentProfile) && currentProfile.id !== 'identity') {
        const { getCentralLoginFallbackUrl, redirectToCentralLogin } = await import(
          '@/service/centralLoginService'
        )
        try {
          await redirectToCentralLogin(redirectPath)
        } catch (error) {
          console.warn('Central login redirect failed after logout:', error)
          window.location.replace(getCentralLoginFallbackUrl(currentProfile))
        }
        return
      }

      // Identity profile keeps the in-app login route and its relative return.
      await router.push(getLoginRoute(redirectPath))
    })().finally(() => {
      this.logoutPromise = null
    })

    return this.logoutPromise
  }

  static getAccessToken(): string | null {
    return getAccessToken()
  }

  static getRefreshToken(): string | null {
    return TypedLocalStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)
  }

  async bootstrapSession(force = false): Promise<string | null> {
    if (!force) {
      const accessToken = AuthorizationService.getAccessToken()
      if (accessToken && !isTokenExpired({ bufferSeconds: 2 })) {
        void heartbeatService.start().catch((error) => {
          console.warn('Failed to start heartbeat service during bootstrap:', error)
        })
        return accessToken
      }
    }

    if (!this.bootstrapPromise) {
      this.bootstrapPromise = (async () => {
        try {
          const result = await this.refreshToken()
          if (result?.access_token) {
            void heartbeatService.start().catch((error) => {
              console.warn('Failed to start heartbeat service after bootstrap refresh:', error)
            })
          }
          return result?.access_token ?? null
        } catch {
          return null
        } finally {
          this.bootstrapPromise = null
        }
      })()
    }

    return this.bootstrapPromise
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
