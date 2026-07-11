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
const passkeySupported = state.passkeySupported
const submitDisabled = state.submitDisabled
const mobileFieldDisabled = state.mobileFieldDisabled
const formDisabled = computed(() => (state.isDesktop.value ? false : mobileFieldDisabled.value))
const formRef = state.formRef
const usernameInputRef = state.usernameInputRef
const passwordInputRef = state.passwordInputRef

const loginForm = computed(() => state.loginForm)
const registerForm = computed(() => state.registerForm)
const agreedLoginForm = computed(() => state.loginForm as LoginForm)
const agreedRegisterForm = computed(() => state.registerForm as RegisterForm)
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
      <template v-if="isLogin && registrationEnabled">
        <span>{{ i18ns.t('loginOrRegisterPage.noAccount') }}</span>
        <el-button type="primary" link :disabled="formDisabled" @click="state.toggleMode">
          {{ i18ns.t('loginOrRegisterPage.goRegister') }}
        </el-button>
      </template>
      <template v-else-if="isLogin && !registrationEnabled">
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
