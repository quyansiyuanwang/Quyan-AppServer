<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import type { LoginForm, RegisterForm } from '../useLoginOrRegister'
import { useLoginOrRegisterContext } from '../context'

const state = useLoginOrRegisterContext()
const isLogin = state.isLogin
const currentForm = state.currentForm
const currentRules = state.currentRules
const registrationEnabled = state.registrationEnabled
const captchaWarmupRunning = state.captchaWarmupRunning
const captchaVerifying = state.captchaVerifying
const codeCooldown = state.codeCooldown
const loading = state.loading
const passkeyLoading = state.passkeyLoading
const externalAuthLoading = state.externalAuthLoading
const passkeySupported = state.passkeySupported
const submitDisabled = state.submitDisabled
const mobileFieldDisabled = state.mobileFieldDisabled
const qrLoginSession = state.qrLoginSession
const qrLoginStatus = state.qrLoginStatus
const qrLoginScannedUser = state.qrLoginScannedUser
const qrLoginBusy = state.qrLoginBusy
const qrPolling = state.qrPolling
const publicSocialAuthConfig = state.publicSocialAuthConfig
const formDisabled = computed(() => (state.isDesktop.value ? false : mobileFieldDisabled.value))
const formRef = state.formRef
const usernameInputRef = state.usernameInputRef
const passwordInputRef = state.passwordInputRef

const loginForm = computed(() => state.loginForm)
const registerForm = computed(() => state.registerForm)
const agreedLoginForm = computed(() => state.loginForm as LoginForm)
const agreedRegisterForm = computed(() => state.registerForm as RegisterForm)
const registrationStatusReady = state.registrationStatusReady
const canShowRegisterEntry = computed(() => registrationEnabled.value !== false)
const sendCodeDisabled = computed(() => {
  if (state.isDesktop.value) {
    return codeCooldown.value > 0 || !state.registerForm.email || captchaVerifying.value
  }

  return (
    codeCooldown.value > 0 ||
    !state.registerForm.email ||
    captchaVerifying.value ||
    captchaWarmupRunning.value
  )
})
</script>

<template>
  <el-card
    key="card"
    :class="['login-card', 'surface-card', state.isDesktop.value ? 'page-card' : 'mobile-card']"
    shadow="hover"
  >
    <h1 class="login-title">
      {{ isLogin ? i18ns.t('login') : i18ns.t('register') }}
    </h1>
    <el-form
      ref="formRef"
      :model="currentForm"
      :rules="currentRules"
      status-icon
      :validate-on-rule-change="false"
      label-position="right"
      label-width="100px"
    >
      <Transition name="fade-slide" mode="out-in">
        <div :key="state.mode.value">
          <el-form-item :label="i18ns.t('username')" prop="username">
            <el-input
              ref="usernameInputRef"
              v-model="currentForm.username"
              :placeholder="i18ns.t('placeholder.enterUsername')"
              autocomplete="username"
              :disabled="formDisabled"
              @keyup.enter="state.handleUsernameEnter"
            />
          </el-form-item>
          <el-form-item v-if="!isLogin" :label="i18ns.t('nickname')" prop="nickname">
            <el-input
              v-model="agreedRegisterForm.nickname"
              :placeholder="i18ns.t('placeholder.enterNickname')"
              :disabled="formDisabled"
            />
          </el-form-item>
          <el-form-item v-if="!isLogin" :label="i18ns.t('email')" prop="email">
            <el-input
              v-model="agreedRegisterForm.email"
              :placeholder="i18ns.t('placeholder.enterEmail')"
              autocomplete="email"
              :disabled="formDisabled"
            />
          </el-form-item>
          <el-form-item
            v-if="!isLogin"
            :label="i18ns.t('loginOrRegisterPage.verificationCode')"
            prop="verificationCode"
          >
            <div
              :style="
                state.isDesktop.value
                  ? 'display: flex; gap: 8px; width: 100%'
                  : 'display: flex; flex-direction: column; gap: 8px; width: 100%'
              "
            >
              <el-input
                v-model="agreedRegisterForm.verificationCode"
                :placeholder="i18ns.t('loginOrRegisterPage.enterVerificationCode')"
                maxlength="6"
                :disabled="formDisabled"
                :style="state.isDesktop.value ? 'flex: 1' : 'width: 100%'"
              />
              <el-button
                :disabled="sendCodeDisabled"
                :loading="captchaVerifying || captchaWarmupRunning"
                @click="state.handleSendCode"
              >
                {{
                  captchaVerifying
                    ? i18ns.t('loginOrRegisterPage.verifyingCaptcha')
                    : codeCooldown > 0
                      ? i18ns.t('loginOrRegisterPage.resendIn', { seconds: codeCooldown })
                      : i18ns.t('loginOrRegisterPage.sendVerificationCode')
                }}
              </el-button>
            </div>
          </el-form-item>
          <el-form-item :label="i18ns.t('password')" prop="password">
            <el-input
              ref="passwordInputRef"
              v-model="currentForm.password"
              type="password"
              :placeholder="i18ns.t('placeholder.enterPassword')"
              show-password
              autocomplete="current-password"
              :disabled="formDisabled"
              @keyup.enter="state.handlePasswordEnter"
            />
          </el-form-item>
          <el-form-item v-if="!isLogin" :label="i18ns.t('confirmPassword')" prop="confirmPassword">
            <el-input
              v-model="agreedRegisterForm.confirmPassword"
              type="password"
              :placeholder="i18ns.t('placeholder.enterConfirmPassword')"
              show-password
              autocomplete="new-password"
              :disabled="formDisabled"
            />
          </el-form-item>
          <el-form-item prop="agreedToLegalPolicies">
            <div v-if="isLogin" class="policy-inline-block">
              <el-checkbox
                v-model="agreedLoginForm.agreedToLegalPolicies"
                class="policy-consent-checkbox"
                :disabled="formDisabled"
              >
                <span>{{ i18ns.t('loginOrRegisterPage.agreeToPoliciesOnLoginPrefix') }}</span>
                <button
                  type="button"
                  class="policy-link-button"
                  @click.stop="state.openLegalPolicyDialog('terms_of_service')"
                >
                  {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
                </button>
                <span>{{ i18ns.t('loginOrRegisterPage.and') }}</span>
                <button
                  type="button"
                  class="policy-link-button"
                  @click.stop="state.openLegalPolicyDialog('privacy_policy')"
                >
                  {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
                </button>
              </el-checkbox>
            </div>
            <el-checkbox
              v-else
              v-model="agreedRegisterForm.agreedToLegalPolicies"
              class="policy-consent-checkbox"
              :disabled="formDisabled"
            >
              <span>{{ i18ns.t('loginOrRegisterPage.agreeToPoliciesPrefix') }}</span>
              <button
                type="button"
                class="policy-link-button"
                @click.stop="state.openLegalPolicyDialog('terms_of_service')"
              >
                {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
              </button>
              <span>{{ i18ns.t('loginOrRegisterPage.and') }}</span>
              <button
                type="button"
                class="policy-link-button"
                @click.stop="state.openLegalPolicyDialog('privacy_policy')"
              >
                {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
              </button>
            </el-checkbox>
          </el-form-item>
          <el-form-item>
            <div class="login-actions">
              <el-button :disabled="formDisabled" @click="state.handleReset">
                {{ i18ns.t('reset') }}
              </el-button>
              <el-button
                type="primary"
                :loading="loading || captchaVerifying || captchaWarmupRunning"
                :disabled="submitDisabled"
                @click="state.handleSubmit"
              >
                {{
                  captchaVerifying || captchaWarmupRunning
                    ? i18ns.t('loginOrRegisterPage.verifyingCaptcha')
                    : i18ns.or_t(isLogin, 'login', 'register')
                }}
              </el-button>
            </div>
          </el-form-item>
        </div>
      </Transition>
    </el-form>
    <div class="toggle-tip">
      <template v-if="isLogin && !registrationStatusReady">
        <span class="toggle-tip__placeholder" aria-hidden="true"></span>
      </template>
      <template v-else-if="isLogin && canShowRegisterEntry">
        <span>{{ i18ns.t('loginOrRegisterPage.noAccount') }}</span>
        <el-button type="primary" link :disabled="formDisabled" @click="state.toggleMode">
          {{ i18ns.t('loginOrRegisterPage.goRegister') }}
        </el-button>
      </template>
      <template v-else-if="isLogin && registrationEnabled === false">
        <span style="color: var(--el-text-color-secondary); font-size: 13px">
          {{ i18ns.t('loginOrRegisterPage.registrationDisabled') }}
        </span>
      </template>
      <template v-else>
        <span>{{ i18ns.t('loginOrRegisterPage.haveAccount') }}</span>
        <el-button type="primary" link :disabled="formDisabled" @click="state.toggleMode">
          {{ i18ns.t('loginOrRegisterPage.goLogin') }}
        </el-button>
      </template>
    </div>
    <div v-if="isLogin" class="forgot-link">
      <el-button type="primary" link :disabled="formDisabled" @click="state.handleForgotPassword">
        {{ i18ns.t('loginOrRegisterPage.forgotPassword') }}
      </el-button>
    </div>
    <div v-if="isLogin && passkeySupported" class="passkey-section">
      <el-divider>{{ i18ns.t('loginOrRegisterPage.or') }}</el-divider>
      <el-button
        style="width: 100%"
        :loading="passkeyLoading || captchaWarmupRunning"
        :disabled="formDisabled"
        @click="state.handlePasskeyLogin"
      >
        {{ i18ns.t('passkey.loginWithPasskey') }}
      </el-button>
    </div>
    <div v-if="isLogin" class="social-auth-section">
      <el-divider>{{ i18ns.t('loginOrRegisterPage.socialLogin') }}</el-divider>
      <div class="social-auth-grid">
        <el-button
          v-if="publicSocialAuthConfig?.githubEnabled"
          :loading="externalAuthLoading === 'github'"
          @click="state.handleExternalAuthLogin('github')"
        >
          GitHub
        </el-button>
        <el-button
          v-if="publicSocialAuthConfig?.wechatOpenEnabled"
          :loading="externalAuthLoading === 'wechat-open'"
          @click="state.handleExternalAuthLogin('wechat-open')"
        >
          {{ i18ns.t('loginOrRegisterPage.wechatOpenLogin') }}
        </el-button>
        <el-button
          v-if="publicSocialAuthConfig?.wechatWebEnabled"
          :loading="externalAuthLoading === 'wechat-web'"
          @click="state.handleExternalAuthLogin('wechat-web')"
        >
          {{ i18ns.t('loginOrRegisterPage.wechatWebLogin') }}
        </el-button>
        <el-button
          v-if="publicSocialAuthConfig?.qrLoginEnabled"
          :loading="externalAuthLoading === 'qr'"
          @click="state.handleQrLogin"
        >
          {{ i18ns.t('loginOrRegisterPage.qrLogin') }}
        </el-button>
      </div>
      <div v-if="qrLoginSession" class="qr-login-panel">
        <div class="qr-login-panel__header">
          <div>
            <div class="qr-login-panel__title">{{ i18ns.t('loginOrRegisterPage.qrLogin') }}</div>
            <div class="qr-login-panel__status">{{ state.getQrStatusText(qrLoginStatus) }}</div>
          </div>
          <el-button
            link
            type="primary"
            :disabled="externalAuthLoading === 'qr'"
            @click="state.handleQrLogin"
          >
            {{ i18ns.t('refresh') }}
          </el-button>
        </div>

        <div v-if="qrLoginSession?.qrCodeDataUrl" class="qr-login-panel__body">
          <img :src="qrLoginSession.qrCodeDataUrl" alt="QR Login" class="qr-login-panel__image" />
          <p class="qr-login-panel__hint">
            {{
              qrPolling
                ? i18ns.t('message.information.loggingIn')
                : i18ns.t('loginOrRegisterPage.qrLogin')
            }}
          </p>
          <p v-if="qrLoginScannedUser" class="qr-login-panel__hint">
            {{ qrLoginScannedUser.username || qrLoginScannedUser.email }}
          </p>
        </div>
        <div v-else class="qr-login-panel__empty">
          {{ i18ns.t('refresh') }}
        </div>
      </div>
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
  </el-card>
</template>

<style scoped lang="scss">
.social-auth-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.qr-login-panel {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.qr-login-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.qr-login-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.qr-login-panel__status {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.qr-login-panel__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.qr-login-panel__image {
  width: min(220px, 100%);
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
}

.qr-login-panel__hint,
.qr-login-panel__empty {
  margin: 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.qr-login-panel__actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

@media (max-width: 480px) {
  .social-auth-grid,
  .qr-login-panel__actions {
    grid-template-columns: 1fr;
  }
}
</style>
