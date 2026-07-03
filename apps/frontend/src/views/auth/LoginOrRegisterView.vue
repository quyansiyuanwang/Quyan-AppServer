<template>
  <div class="auth-view-root">
    <div v-if="isDesktop" class="desktop-page">
      <div name="resize" tag="main" class="login-page">
        <el-card key="card" class="login-card surface-card page-card" shadow="hover">
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
              <div :key="mode">
                <el-form-item :label="i18ns.t('username')" prop="username">
                  <el-input
                    ref="usernameInputRef"
                    v-model="currentForm.username"
                    :placeholder="i18ns.t('placeholder.enterUsername')"
                    autocomplete="username"
                    @keyup.enter="handleUsernameEnter"
                  />
                </el-form-item>
                <el-form-item :label="i18ns.t('nickname')" v-if="!isLogin" prop="nickname">
                  <el-input
                    v-model="(currentForm as RegisterForm).nickname"
                    :placeholder="i18ns.t('placeholder.enterNickname')"
                  />
                </el-form-item>
                <el-form-item :label="i18ns.t('email')" v-if="!isLogin" prop="email">
                  <el-input
                    v-model="(currentForm as RegisterForm).email"
                    :placeholder="i18ns.t('placeholder.enterEmail')"
                    autocomplete="email"
                  />
                </el-form-item>
                <el-form-item
                  :label="i18ns.t('loginOrRegisterPage.verificationCode')"
                  v-if="!isLogin"
                  prop="verificationCode"
                >
                  <div style="display: flex; gap: 8px; width: 100%">
                    <el-input
                      v-model="(currentForm as RegisterForm).verificationCode"
                      :placeholder="i18ns.t('loginOrRegisterPage.enterVerificationCode')"
                      maxlength="6"
                      style="flex: 1"
                    />
                    <el-button
                      :disabled="
                        codeCooldown > 0 || !(currentForm as RegisterForm).email || captchaVerifying
                      "
                      :loading="captchaVerifying || captchaWarmupRunning"
                      @click="handleSendCode"
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
                    @keyup.enter="handlePasswordEnter"
                  />
                </el-form-item>
                <el-form-item
                  :label="i18ns.t('confirmPassword')"
                  v-if="!isLogin"
                  prop="confirmPassword"
                >
                  <el-input
                    v-model="(currentForm as RegisterForm).confirmPassword"
                    type="password"
                    :placeholder="i18ns.t('placeholder.enterConfirmPassword')"
                    show-password
                    autocomplete="new-password"
                  />
                </el-form-item>
                <el-form-item v-if="isLogin" prop="agreedToLegalPolicies">
                  <div class="policy-inline-block">
                    <el-checkbox
                      v-model="(currentForm as LoginForm).agreedToLegalPolicies"
                      class="policy-consent-checkbox"
                    >
                      <span>{{ i18ns.t('loginOrRegisterPage.agreeToPoliciesOnLoginPrefix') }}</span>
                      <button
                        type="button"
                        class="policy-link-button"
                        @click.stop="openLegalPolicyDialog('terms_of_service')"
                      >
                        {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
                      </button>
                      <span>{{ i18ns.t('loginOrRegisterPage.and') }}</span>
                      <button
                        type="button"
                        class="policy-link-button"
                        @click.stop="openLegalPolicyDialog('privacy_policy')"
                      >
                        {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
                      </button>
                    </el-checkbox>
                  </div>
                </el-form-item>
                <el-form-item v-else prop="agreedToLegalPolicies">
                  <el-checkbox
                    v-model="(currentForm as RegisterForm).agreedToLegalPolicies"
                    class="policy-consent-checkbox"
                  >
                    <span>{{ i18ns.t('loginOrRegisterPage.agreeToPoliciesPrefix') }}</span>
                    <button
                      type="button"
                      class="policy-link-button"
                      @click.stop="openLegalPolicyDialog('terms_of_service')"
                    >
                      {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
                    </button>
                    <span>{{ i18ns.t('loginOrRegisterPage.and') }}</span>
                    <button
                      type="button"
                      class="policy-link-button"
                      @click.stop="openLegalPolicyDialog('privacy_policy')"
                    >
                      {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
                    </button>
                  </el-checkbox>
                </el-form-item>
                <el-form-item>
                  <div class="login-actions">
                    <el-button @click="handleReset">{{ i18ns.t('reset') }}</el-button>
                    <el-button
                      type="primary"
                      :loading="loading || captchaVerifying || captchaWarmupRunning"
                      :disabled="submitDisabled"
                      @click="handleSubmit"
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
              <el-button type="primary" link @click="toggleMode">
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
              <el-button type="primary" link @click="toggleMode">
                {{ i18ns.t('loginOrRegisterPage.goLogin') }}
              </el-button>
            </template>
          </div>
          <div v-if="isLogin" class="forgot-link">
            <el-button
              type="primary"
              link
              @click="router.push(getForgotPasswordRoute(getSafeRedirect()))"
            >
              {{ i18ns.t('loginOrRegisterPage.forgotPassword') }}
            </el-button>
          </div>
          <div v-if="isLogin && passkeySupported" class="passkey-section">
            <el-divider>{{ i18ns.t('loginOrRegisterPage.or') }}</el-divider>
            <el-button
              style="width: 100%"
              :loading="passkeyLoading || captchaWarmupRunning"
              @click="handlePasskeyLogin"
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
        <div class="icp-info">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
            浙ICP备2024124728号-1
          </a>
        </div>
      </div>
    </div>
    <div v-else class="mobile-page mobile-adapter">
      <div name="resize" tag="main" class="login-page">
        <el-card key="card" class="login-card surface-card mobile-card" shadow="hover">
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
              <div :key="mode">
                <el-form-item :label="i18ns.t('username')" prop="username">
                  <el-input
                    ref="usernameInputRef"
                    v-model="currentForm.username"
                    :placeholder="i18ns.t('placeholder.enterUsername')"
                    autocomplete="username"
                    :disabled="captchaWarmupRunning"
                    @keyup.enter="handleUsernameEnter"
                  />
                </el-form-item>
                <el-form-item :label="i18ns.t('nickname')" v-if="!isLogin" prop="nickname">
                  <el-input
                    v-model="(currentForm as RegisterForm).nickname"
                    :placeholder="i18ns.t('placeholder.enterNickname')"
                    :disabled="captchaWarmupRunning"
                  />
                </el-form-item>
                <el-form-item :label="i18ns.t('email')" v-if="!isLogin" prop="email">
                  <el-input
                    v-model="(currentForm as RegisterForm).email"
                    :placeholder="i18ns.t('placeholder.enterEmail')"
                    autocomplete="email"
                    :disabled="captchaWarmupRunning"
                  />
                </el-form-item>
                <el-form-item
                  :label="i18ns.t('loginOrRegisterPage.verificationCode')"
                  v-if="!isLogin"
                  prop="verificationCode"
                >
                  <div style="display: flex; gap: 8px; width: 100%">
                    <el-input
                      v-model="(currentForm as RegisterForm).verificationCode"
                      :placeholder="i18ns.t('loginOrRegisterPage.enterVerificationCode')"
                      maxlength="6"
                      :disabled="captchaWarmupRunning"
                      style="flex: 1"
                    />
                    <el-button
                      :disabled="
                        codeCooldown > 0 ||
                        !(currentForm as RegisterForm).email ||
                        captchaVerifying ||
                        captchaWarmupRunning
                      "
                      :loading="captchaVerifying || captchaWarmupRunning"
                      @click="handleSendCode"
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
                    :disabled="captchaWarmupRunning"
                    @keyup.enter="handlePasswordEnter"
                  />
                </el-form-item>
                <el-form-item
                  :label="i18ns.t('confirmPassword')"
                  v-if="!isLogin"
                  prop="confirmPassword"
                >
                  <el-input
                    v-model="(currentForm as RegisterForm).confirmPassword"
                    type="password"
                    :placeholder="i18ns.t('placeholder.enterConfirmPassword')"
                    show-password
                    autocomplete="new-password"
                    :disabled="captchaWarmupRunning"
                  />
                </el-form-item>
                <el-form-item v-if="isLogin" prop="agreedToLegalPolicies">
                  <div class="policy-inline-block">
                    <el-checkbox
                      v-model="(currentForm as LoginForm).agreedToLegalPolicies"
                      class="policy-consent-checkbox"
                      :disabled="captchaWarmupRunning"
                    >
                      <span>{{ i18ns.t('loginOrRegisterPage.agreeToPoliciesOnLoginPrefix') }}</span>
                      <button
                        type="button"
                        class="policy-link-button"
                        @click.stop="openLegalPolicyDialog('terms_of_service')"
                      >
                        {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
                      </button>
                      <span>{{ i18ns.t('loginOrRegisterPage.and') }}</span>
                      <button
                        type="button"
                        class="policy-link-button"
                        @click.stop="openLegalPolicyDialog('privacy_policy')"
                      >
                        {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
                      </button>
                    </el-checkbox>
                  </div>
                </el-form-item>
                <el-form-item v-else prop="agreedToLegalPolicies">
                  <el-checkbox
                    v-model="(currentForm as RegisterForm).agreedToLegalPolicies"
                    class="policy-consent-checkbox"
                    :disabled="captchaWarmupRunning"
                  >
                    <span>{{ i18ns.t('loginOrRegisterPage.agreeToPoliciesPrefix') }}</span>
                    <button
                      type="button"
                      class="policy-link-button"
                      @click.stop="openLegalPolicyDialog('terms_of_service')"
                    >
                      {{ i18ns.t('loginOrRegisterPage.termsOfService') }}
                    </button>
                    <span>{{ i18ns.t('loginOrRegisterPage.and') }}</span>
                    <button
                      type="button"
                      class="policy-link-button"
                      @click.stop="openLegalPolicyDialog('privacy_policy')"
                    >
                      {{ i18ns.t('loginOrRegisterPage.privacyPolicy') }}
                    </button>
                  </el-checkbox>
                </el-form-item>
                <el-form-item>
                  <div class="login-actions">
                    <el-button :disabled="captchaWarmupRunning" @click="handleReset">{{
                      i18ns.t('reset')
                    }}</el-button>
                    <el-button
                      type="primary"
                      :loading="loading || captchaVerifying || captchaWarmupRunning"
                      :disabled="submitDisabled"
                      @click="handleSubmit"
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
              <el-button type="primary" link :disabled="captchaWarmupRunning" @click="toggleMode">
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
              <el-button type="primary" link :disabled="captchaWarmupRunning" @click="toggleMode">
                {{ i18ns.t('loginOrRegisterPage.goLogin') }}
              </el-button>
            </template>
          </div>
          <div v-if="isLogin" class="forgot-link">
            <el-button
              type="primary"
              link
              :disabled="captchaWarmupRunning"
              @click="router.push(getForgotPasswordRoute(getSafeRedirect()))"
            >
              {{ i18ns.t('loginOrRegisterPage.forgotPassword') }}
            </el-button>
          </div>
          <div v-if="isLogin && passkeySupported" class="passkey-section">
            <el-divider>{{ i18ns.t('loginOrRegisterPage.or') }}</el-divider>
            <el-button
              style="width: 100%"
              :loading="passkeyLoading || captchaWarmupRunning"
              :disabled="captchaWarmupRunning"
              @click="handlePasskeyLogin"
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
        <div class="icp-info">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
            浙ICP备2024124728号-1
          </a>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="policyDialogVisible"
      :title="i18ns.t('loginOrRegisterPage.legalPolicyDialogTitle')"
      width="min(960px, calc(100vw - 32px))"
      destroy-on-close
    >
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
          <el-checkbox v-if="policyDialogRequireConfirmation" v-model="policyConsentChecked">
            {{ i18ns.t('loginOrRegisterPage.readAndAgree') }}
          </el-checkbox>
          <span v-else />
          <div class="policy-dialog-actions">
            <el-button @click="policyDialogVisible = false">{{ i18ns.t('close') }}</el-button>
            <el-button
              v-if="policyDialogRequireConfirmation"
              type="primary"
              :loading="policyDialogSubmitting"
              @click="confirmPolicyConsentAndContinue"
            >
              {{ i18ns.t('loginOrRegisterPage.consentConfirm') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { type FormInstance, type FormRules } from 'element-plus'
import { Notification } from '@/utils/notification'
import { NICKNAME_PATTERN, USERNAME_PATTERN } from '@/constant/pattern'
import StorageKey from '@/constant/storagekey'
import { authorizationService } from '@/service/authorizationService'
import { legalPolicyService } from '@/service/legalPolicyService'
import { passkeyService } from '@/service/passkeyService'
import { configService } from '@/service/configService'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import { i18ns } from '@/locales'
import router from '@/router'
import { md5 } from '@/utils/encryption'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { CustomCode } from '@/constant/custom-code'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import type { LegalPolicyType, PublicLegalPolicyDto } from '@/client/types.gen'
import { warmupCaptchaTrust } from '@/service/captchaDialogService'
import {
  getForgotPasswordRoute,
  getLoginRoute,
  getRegisterRoute,
  getSafeAuthRedirect,
} from '@/utils/auth-routes'

type LegalPolicyConsentCache = {
  username: string
  signature: string
  savedAt: number
}

type LoginForm = {
  username: string
  password: string
  agreedToLegalPolicies: boolean
}

type RegisterForm = {
  username: string
  nickname: string
  email: string
  password: string
  confirmPassword: string
  verificationCode: string
  agreedToLegalPolicies: boolean
}

const formRef = ref<FormInstance>()
const usernameInputRef = ref()
const passwordInputRef = ref()
const waterMarkTextStore = useWaterMarkTextStore()
const route = useRoute()
const registrationEnabled = ref(true)
const captchaWarmupRunning = ref(false)
const codeCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  waterMarkTextStore.setText('AppSystem')
  const initialModeFromQuery = typeof route.query.mode === 'string' ? route.query.mode : 'login'
  mode.value =
    route.path === '/register' || initialModeFromQuery === 'register' ? 'register' : 'login'
  captchaWarmupRunning.value = true
  void warmupCaptchaTrust(mode.value === 'register' ? 'register' : 'login').finally(() => {
    captchaWarmupRunning.value = false
  })
  try {
    registrationEnabled.value = await configService.getRegistrationStatus()
  } catch (error) {
    console.error('Failed to load registration status:', error)
    registrationEnabled.value = false
  }
})

onBeforeUnmount(() => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
})

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

const mode = ref<'login' | 'register'>('login')

const isLogin = computed(() => mode.value === 'login')

const currentForm = computed<LoginForm | RegisterForm>(() =>
  isLogin.value ? loginForm : registerForm,
)

const currentRules = computed<FormRules>(() => (isLogin.value ? loginRules : registerRules))

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

const submitDisabled = computed(() => captchaVerifying.value)

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

let passkeyLibPromise: Promise<typeof import('@simplewebauthn/browser')> | null = null

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

const getSafeRedirect = (): string | undefined => {
  return getSafeAuthRedirect(route.query.redirect, {
    blockedExactPaths: ['/login', '/register', '/forgot-password'],
    blockedPrefixes: ['/auth/verify'],
  })
}

const loadLegalPolicies = async () => {
  policyDialogLoading.value = true
  try {
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

const openLegalPolicyDialog = async (policyType: LegalPolicyType, requireConfirmation = false) => {
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
    router.push({
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
  const form = currentForm.value as RegisterForm
  const result = await authorizationService.register(
    {
      username: form.username,
      password: md5(form.password),
      nickname: form.nickname || undefined,
      email: form.email,
      verificationCode: form.verificationCode,
      agreedToLegalPolicies: form.agreedToLegalPolicies,
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
    router.push({
      name: 'authVerification',
      query: {
        method: 'code',
        authEntry: 'register',
        ...(redirect ? { redirect } : {}),
      },
    })
  } else if (result.code === CustomCode.OK) {
    persistLegalPolicyConsentCache(form.username)
    Notification.notify(
      i18ns.t('information'),
      i18ns.t('message.information.registerSuccess'),
      'success',
    )
    setTimeout(toggleMode, 500)
  } else if (result.code === CustomCode.REGISTRATION_DISABLED) {
    Notification.notify(i18ns.t('error'), i18ns.t('message.error.registrationDisabled'), 'error')
  } else if (result.code === CustomCode.VERIFICATION_CODE_INVALID) {
    Notification.notify(i18ns.t('error'), i18ns.t('message.error.verificationCodeInvalid'), 'error')
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
      Notification.notify(i18ns.t('error'), i18ns.t('message.error.formValidationFailed'), 'error')
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

// 处理用户名输入框回车
const handleUsernameEnter = () => {
  if (isLogin.value) {
    if (currentForm.value.username && currentForm.value.password) handleSubmit()
  } else handleSubmit()

  // 密码为空时，都跳转到密码框
  if (!currentForm.value.password) passwordInputRef.value?.focus()
}

// 处理密码输入框回车
const handlePasswordEnter = () => {
  if (isLogin.value) {
    // 登录模式：只有账号和密码都不为空时才提交
    if (currentForm.value.username && currentForm.value.password) {
      handleSubmit()
    }
  } else {
    // 注册模式：正常提交
    handleSubmit()
  }
}

const clearUsernameValidationCache = () => {}

const resetLoginForm = () => {
  loginForm.username = ''
  loginForm.password = ''
  loginForm.agreedToLegalPolicies = false
  clearPendingPolicyConsent()
}

const resetRegisterForm = () => {
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
    await authorizationService.sendRegisterVerificationCode(
      email,
      () => {
        captchaVerifying.value = true
      },
      () => {
        captchaVerifying.value = false
      },
    )
    Notification.notify(i18ns.t('information'), i18ns.t('loginOrRegisterPage.codeSent'), 'success')
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
    // 解析错误响应
    const errorData = error?.response?.data || error?.data || {}
    const errorCode = errorData.code
    const errorMessage = errorData.message
    const retryAfter = errorData.data?.retryAfter

    // 根据错误码显示不同的消息
    if (errorCode === CustomCode.TOO_MANY_REQUESTS) {
      // 429 频率限制错误
      const minutes = Math.ceil(retryAfter / 60)
      const message = retryAfter
        ? `${errorMessage}${i18ns.t('loginOrRegisterPage.retryAfterMinutes', { minutes })}`
        : errorMessage || i18ns.t('loginOrRegisterPage.tooManyRequestsFallback')
      Notification.notify(i18ns.t('error'), message, 'error')
    } else if (errorCode === CustomCode.SMTP_NOT_CONFIGURED) {
      // SMTP 未配置
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
      // 其他错误
      Notification.notify(
        i18ns.t('error'),
        errorMessage || i18ns.t('message.error.smtpNotConfigured'),
        'error',
      )
    }
  }
}

const handleReset = () => {
  if (isLogin.value) resetLoginForm()
  else resetRegisterForm()
  if (!formRef.value) return
  formRef.value.resetFields()
}

const toggleMode = () => {
  if (formRef.value) {
    formRef.value.resetFields()
    formRef.value.clearValidate()
  }
  const nextMode = isLogin.value ? 'register' : 'login'
  if (nextMode === 'login') resetLoginForm()
  else resetRegisterForm()
  mode.value = nextMode
  const redirect = getSafeRedirect()
  void router.replace(
    nextMode === 'register' ? getRegisterRoute(redirect) : getLoginRoute(redirect),
  )
  clearUsernameValidationCache()
  clearPendingPolicyConsent()
}

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

// Passkey login
const passkeySupported =
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'

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
    const startAuthentication = await loadPasskeyStartAuthentication()
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

const { isDesktop } = usePageDevice()

void loadLegalPolicies().catch((error) => {
  console.error('Failed to preload legal policies:', error)
})
</script>

<style scoped>
.auth-view-root,
.desktop-page,
.mobile-page {
  width: 100%;
  min-height: 100dvh;
}

.desktop-page,
.mobile-page {
  display: flex;
}

.login-page {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 100dvh;
  min-width: 0;
  padding: clamp(24px, 6vw, 48px) clamp(12px, 4vw, 48px);
  overflow-y: auto;
  overflow-x: visible;
  box-sizing: border-box;
  transition: padding 0.3s ease;
}

.login-card {
  width: 100%;
  max-width: clamp(320px, 50vw, 560px);
  margin: auto;
  padding: clamp(20px, 4vw, 32px) clamp(24px, 4.5vw, 40px);
  overflow: visible;
  transition:
    max-width 0.3s ease,
    padding 0.3s ease,
    background-color 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

.login-title {
  margin: 0 0 24px;
  text-align: center;
  font-size: 24px;
  font-weight: 600;
}

.login-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.toggle-tip {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  color: #606266;
  font-size: 14px;
}

.forgot-link {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}

.login-card :deep(.el-input),
.login-card :deep(.el-input__wrapper) {
  width: 100%;
}

.login-card :deep(.el-card__body) {
  overflow: visible;
}

.captcha-notice {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  text-align: center;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.captcha-notice a {
  color: var(--el-color-primary);
  text-decoration: none;
  transition: opacity 0.2s ease;
}
.captcha-notice a:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.policy-link-button {
  display: inline;
  padding: 0;
  margin: 0 4px;
  border: none;
  background: none;
  color: var(--el-color-primary);
  cursor: pointer;
  font: inherit;
}

.policy-link-button:hover {
  text-decoration: underline;
}

.policy-inline-block {
  width: 100%;
}

.policy-consent-checkbox {
  width: 100%;
  align-items: flex-start;
}

.policy-consent-checkbox :deep(.el-checkbox__label) {
  display: inline;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.policy-consent-checkbox :deep(.el-checkbox__input) {
  margin-top: 2px;
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

.icp-info {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  font-size: 12px;
  color: #909399;
  opacity: 0.6;
  transition: opacity 0.3s ease;
}

.icp-info:hover {
  opacity: 1;
}

.icp-info a {
  color: inherit;
  text-decoration: none;
  transition: color 0.3s ease;
}

.icp-info a:hover {
  color: #606266;
}

:global(.fade-slide-enter-active),
:global(.fade-slide-leave-active) {
  transition:
    opacity 0.24s ease,
    transform 0.24s ease;
}

:global(.fade-slide-enter-from),
:global(.fade-slide-leave-to) {
  opacity: 0;
  transform: translateY(12px);
}

:global(.fade-slide-enter-to),
:global(.fade-slide-leave-from) {
  opacity: 1;
  transform: translateY(0);
}

/* 移动端优化 */
@media (max-width: 768px) {
  .login-page {
    padding: 20px 16px;
  }

  .login-card {
    max-width: 100%;
    padding: 20px;
  }

  .login-title {
    font-size: 20px;
    margin-bottom: 20px;
  }

  .login-card :deep(.el-form-item__label) {
    font-size: 14px;
  }

  .toggle-tip {
    font-size: 13px;
    flex-wrap: wrap;
  }
}

@media (max-width: 480px) {
  .login-page {
    padding: 16px 12px;
  }

  .login-card {
    padding: 16px;
  }

  .login-title {
    font-size: 18px;
    margin-bottom: 16px;
  }

  .login-actions {
    gap: 8px;
    flex-direction: column;
  }

  .login-actions .el-button {
    flex: 1;
    font-size: 14px;
    width: 100%;
    margin-left: 0 !important;
    margin-bottom: 8px;
  }

  .login-card :deep(.el-form-item) {
    margin-bottom: 16px;
  }

  .login-card :deep(.el-form-item__label) {
    font-size: 13px;
    padding-bottom: 6px;
  }

  .toggle-tip {
    font-size: 12px;
    margin-top: 10px;
  }

  .icp-info {
    font-size: 10px;
    bottom: 8px;
  }
}
</style>

<style scoped>
.mobile-adapter {
  padding: 8px 6px 16px;
}

.mobile-adapter :deep(.hide-on-mobile) {
  display: none !important;
}

.mobile-adapter :deep(.el-form-item) {
  margin-right: 0 !important;
  margin-bottom: 10px;
}

.mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.mobile-adapter :deep(.el-input),
.mobile-adapter :deep(.el-button) {
  width: 100%;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-drawer) {
  max-height: 92vh;
}

.mobile-adapter :deep(.el-pagination) {
  justify-content: center;
}

.mobile-adapter :deep(.login-actions) {
  flex-direction: column;
  gap: 8px;
}

.mobile-adapter :deep(.login-actions .el-button) {
  margin-left: 0 !important;
}
</style>
