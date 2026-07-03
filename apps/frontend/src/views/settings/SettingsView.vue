<template>
  <div class="settings-view-root">
    <div v-if="isDesktop" class="desktop-page">
      <div class="settings-container">
        <div class="page-header">
          <h1 class="page-title">{{ i18ns.t('SettingsView.title') }}</h1>
        </div>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.profileTitle') }}</h3>
          <el-form :model="profileForm" label-width="18%">
            <el-form-item :label="i18ns.t('username')">
              <el-input :value="userInfoStore.userInfo.username" disabled />
            </el-form-item>

            <el-form-item :label="i18ns.t('SettingsView.nameLabel')">
              <div class="inline-row w-full">
                <el-input
                  v-model="profileForm.name"
                  :placeholder="i18ns.t('SettingsView.namePlaceholder')"
                  :disabled="!canUpdateProfile"
                  clearable
                />
                <el-button
                  class="action-btn"
                  type="primary"
                  :disabled="!canUpdateProfile"
                  :loading="profileSaving"
                  @click="handleUpdateProfile"
                >
                  {{ i18ns.t('save') }}
                </el-button>
              </div>
            </el-form-item>

            <el-form-item :label="i18ns.t('SettingsView.emailLabel')">
              <div class="w-full">
                <div class="email-current">
                  {{ i18ns.t('SettingsView.currentEmail') }}:
                  <el-tag v-if="userInfoStore.userInfo.email" type="info">
                    {{ userInfoStore.userInfo.email }}
                  </el-tag>
                  <el-tag v-else type="warning">{{ i18ns.t('SettingsView.noEmail') }}</el-tag>
                </div>

                <div class="stack">
                  <div class="email-row">
                    <el-input
                      v-model="emailForm.newEmail"
                      :placeholder="i18ns.t('SettingsView.emailPlaceholder')"
                      :disabled="!canUpdateEmail"
                      type="email"
                      class="email-input"
                    />
                    <el-button
                      class="action-btn email-btn"
                      :disabled="!canUpdateEmail || !emailForm.newEmail || codeCooldown > 0"
                      :loading="sendingCode"
                      @click="handleSendEmailCode"
                    >
                      {{
                        codeCooldown > 0
                          ? i18ns.t('SettingsView.resendAfter', { seconds: codeCooldown })
                          : i18ns.t('SettingsView.sendCode')
                      }}
                    </el-button>
                  </div>

                  <div class="email-row">
                    <el-input
                      v-model="emailForm.verificationCode"
                      :placeholder="i18ns.t('SettingsView.verificationCode')"
                      :disabled="!canUpdateEmail"
                      maxlength="6"
                      class="email-input"
                    />
                    <el-button
                      class="action-btn email-btn"
                      type="primary"
                      :disabled="
                        !canUpdateEmail || !emailForm.newEmail || !emailForm.verificationCode
                      "
                      :loading="emailChanging"
                      @click="handleChangeEmail"
                    >
                      {{ i18ns.t('SettingsView.changeEmail') }}
                    </el-button>
                  </div>
                </div>
              </div>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.passwordTitle') }}</h3>
          <PermissionWrapper :require="Permission.USER_CHANGE_SELF_PASSWORD" mode="disabled">
            <el-form :model="passwordForm" label-width="18%">
              <el-form-item :label="i18ns.t('newPassword')">
                <el-input v-model="passwordForm.new_password" type="password" />
              </el-form-item>
              <el-form-item :label="i18ns.t('confirmPassword')">
                <el-input v-model="passwordForm.confirm_password" type="password" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="changePassword">{{
                  i18ns.t('changePassword')
                }}</el-button>
              </el-form-item>
            </el-form>
          </PermissionWrapper>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</h3>
          <div class="prefs-actions">
            <el-button @click="toggleDark">
              <el-icon><component :is="iconRef" /></el-icon>
              <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
            </el-button>
            <LanguageSwitcher />
          </div>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.clearCacheTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.clearCacheDesc') }}</p>
          <div class="prefs-actions">
            <el-button type="warning" @click="handleClearLocalStorage">
              {{ i18ns.t('SettingsView.clearLocalStorageButton') }}
            </el-button>
            <el-button type="warning" @click="handleClearSessionDB">
              {{ i18ns.t('SettingsView.clearSessionDBButton') }}
            </el-button>
            <el-button type="danger" @click="handleClearAllCache">
              {{ i18ns.t('SettingsView.clearAllButton') }}
            </el-button>
          </div>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('accesskey.management') }}</h3>
          <p class="section-desc">{{ i18ns.t('accesskey.description') }}</p>
          <PermissionWrapper :require="Permission.ACCESSKEY_READ" mode="disabled">
            <el-button type="primary" @click="showAccessKeyDrawer = true">
              {{ i18ns.t('accesskey.manage') }}
            </el-button>
          </PermissionWrapper>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('passkey.management') }}</h3>
          <p class="section-desc">{{ i18ns.t('passkey.description') }}</p>
          <el-button type="primary" @click="showPasskeyDrawer = true">
            {{ i18ns.t('passkey.manage') }}
          </el-button>
        </el-card>

        <el-card class="section-card page-card twofa-card">
          <h3>{{ i18ns.t('twoFactor.title') }}</h3>
          <p class="section-desc">
            {{
              i18ns.or_t(twoFactorState.enabled, 'twoFactor.enabledDesc', 'twoFactor.disabledDesc')
            }}
          </p>
          <div class="stack twofa-content">
            <div class="twofa-status-row">
              <el-tag :type="twoFactorState.enabled ? 'success' : 'info'" size="small">
                {{ i18ns.or_t(twoFactorState.enabled, 'twoFactor.enabled', 'twoFactor.disabled') }}
              </el-tag>
            </div>

            <div v-if="!twoFactorState.enabled" class="inline-row twofa-action-row">
              <el-button
                type="primary"
                :loading="twoFactorLoading"
                @click="handleBeginTwoFactorSetup"
                :style="{ width: 'min-content' }"
              >
                {{ i18ns.t('twoFactor.enableNow') }}
              </el-button>
            </div>

            <template v-else>
              <div class="twofa-policy-row">
                <el-switch
                  v-model="twoFactorState.passkeyRequired"
                  :loading="twoFactorPolicySaving"
                  :active-text="i18ns.t('twoFactor.passkeyRequireOn')"
                  :inactive-text="i18ns.t('twoFactor.passkeyRequireOff')"
                  @change="handleTogglePasskeyTwoFactorPolicy"
                />
              </div>

              <TrustedDeviceEntryView @manage="showTrustedDevicesDrawer = true" />

              <el-button
                class="twofa-danger-btn"
                type="danger"
                :loading="twoFactorLoading"
                @click="handleGoDisableTwoFactor"
              >
                {{ i18ns.t('twoFactor.disableNow') }}
              </el-button>
            </template>
          </div>
        </el-card>

        <el-drawer v-model="showPasskeyDrawer" :title="i18ns.t('passkey.management')" size="60%">
          <PasskeyManagement />
        </el-drawer>
      </div>
    </div>
    <div v-else class="mobile-page">
      <div class="settings-mobile">
        <h1 class="page-title">{{ i18ns.t('SettingsView.title') }}</h1>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.profileTitle') }}</h3>
          <el-form :model="profileForm" label-position="top">
            <el-form-item :label="i18ns.t('username')">
              <el-input :value="userInfoStore.userInfo.username" disabled />
            </el-form-item>

            <el-form-item :label="i18ns.t('SettingsView.nameLabel')">
              <el-input
                v-model="profileForm.name"
                :placeholder="i18ns.t('SettingsView.namePlaceholder')"
                :disabled="!canUpdateProfile"
                clearable
              />
              <el-button
                class="mt-12"
                type="primary"
                :disabled="!canUpdateProfile"
                :loading="profileSaving"
                @click="handleUpdateProfile"
              >
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>

            <el-form-item :label="i18ns.t('SettingsView.emailLabel')">
              <div class="email-current">
                {{ i18ns.t('SettingsView.currentEmail') }}:
                <el-tag v-if="userInfoStore.userInfo.email" type="info">
                  {{ userInfoStore.userInfo.email }}
                </el-tag>
                <el-tag v-else type="warning">{{ i18ns.t('SettingsView.noEmail') }}</el-tag>
              </div>

              <div class="stack email-stack">
                <el-input
                  v-model="emailForm.newEmail"
                  :placeholder="i18ns.t('SettingsView.emailPlaceholder')"
                  :disabled="!canUpdateEmail"
                  type="email"
                  class="w-full"
                />
                <el-button
                  class="w-full"
                  :disabled="!canUpdateEmail || !emailForm.newEmail || codeCooldown > 0"
                  :loading="sendingCode"
                  @click="handleSendEmailCode"
                >
                  {{
                    codeCooldown > 0
                      ? i18ns.t('SettingsView.resendAfter', { seconds: codeCooldown })
                      : i18ns.t('SettingsView.sendCode')
                  }}
                </el-button>

                <el-input
                  v-model="emailForm.verificationCode"
                  :placeholder="i18ns.t('SettingsView.verificationCode')"
                  :disabled="!canUpdateEmail"
                  maxlength="6"
                  class="w-full"
                />
                <el-button
                  class="w-full"
                  type="primary"
                  :disabled="!canUpdateEmail || !emailForm.newEmail || !emailForm.verificationCode"
                  :loading="emailChanging"
                  @click="handleChangeEmail"
                >
                  {{ i18ns.t('SettingsView.changeEmail') }}
                </el-button>
              </div>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.passwordTitle') }}</h3>
          <PermissionWrapper :require="Permission.USER_CHANGE_SELF_PASSWORD" mode="disabled">
            <el-form :model="passwordForm" label-position="top">
              <el-form-item :label="i18ns.t('newPassword')">
                <el-input v-model="passwordForm.new_password" type="password" />
              </el-form-item>
              <el-form-item :label="i18ns.t('confirmPassword')">
                <el-input v-model="passwordForm.confirm_password" type="password" />
              </el-form-item>
              <el-form-item>
                <el-button class="w-full" type="primary" @click="changePassword">{{
                  i18ns.t('changePassword')
                }}</el-button>
              </el-form-item>
            </el-form>
          </PermissionWrapper>
        </el-card>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</h3>
          <div class="stack">
            <el-button class="w-full" @click="toggleDark">
              <el-icon><component :is="iconRef" /></el-icon>
              <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
            </el-button>
            <div class="w-full lang-wrap">
              <LanguageSwitcher />
            </div>
          </div>
        </el-card>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.clearCacheTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.clearCacheDesc') }}</p>
          <div class="stack">
            <el-button class="w-full" type="warning" @click="handleClearLocalStorage">
              {{ i18ns.t('SettingsView.clearLocalStorageButton') }}
            </el-button>
            <el-button class="w-full" type="warning" @click="handleClearSessionDB">
              {{ i18ns.t('SettingsView.clearSessionDBButton') }}
            </el-button>
            <el-button class="w-full" type="danger" @click="handleClearAllCache">
              {{ i18ns.t('SettingsView.clearAllButton') }}
            </el-button>
          </div>
        </el-card>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('accesskey.management') }}</h3>
          <p class="section-desc">{{ i18ns.t('accesskey.description') }}</p>
          <PermissionWrapper :require="Permission.ACCESSKEY_READ" mode="disabled">
            <el-button class="w-full" type="primary" @click="showAccessKeyDrawer = true">
              {{ i18ns.t('accesskey.manage') }}
            </el-button>
          </PermissionWrapper>
        </el-card>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('passkey.management') }}</h3>
          <p class="section-desc">{{ i18ns.t('passkey.description') }}</p>
          <el-button class="w-full" type="primary" @click="showPasskeyDrawer = true">
            {{ i18ns.t('passkey.manage') }}
          </el-button>
        </el-card>

        <el-card class="section-card mobile-card twofa-card">
          <h3>{{ i18ns.t('twoFactor.title') }}</h3>
          <p class="section-desc">
            {{
              twoFactorState.enabled
                ? i18ns.t('twoFactor.enabledDesc')
                : i18ns.t('twoFactor.disabledDesc')
            }}
          </p>
          <div class="stack twofa-content">
            <div class="twofa-status-row">
              <el-tag :type="twoFactorState.enabled ? 'success' : 'info'" size="small">
                {{
                  twoFactorState.enabled
                    ? i18ns.t('twoFactor.enabled')
                    : i18ns.t('twoFactor.disabled')
                }}
              </el-tag>
            </div>

            <el-button
              v-if="!twoFactorState.enabled"
              class="w-full twofa-primary-btn"
              type="primary"
              :loading="twoFactorLoading"
              @click="handleBeginTwoFactorSetup"
            >
              {{ i18ns.t('twoFactor.enableNow') }}
            </el-button>

            <template v-else>
              <div class="twofa-policy-row">
                <el-switch
                  v-model="twoFactorState.passkeyRequired"
                  :loading="twoFactorPolicySaving"
                  :active-text="i18ns.t('twoFactor.passkeyRequireOn')"
                  :inactive-text="i18ns.t('twoFactor.passkeyRequireOff')"
                  @change="handleTogglePasskeyTwoFactorPolicy"
                />
              </div>

              <TrustedDeviceEntryView @manage="showTrustedDevicesDrawer = true" />

              <el-button
                class="w-full twofa-danger-btn"
                type="danger"
                :loading="twoFactorLoading"
                @click="handleGoDisableTwoFactor"
              >
                {{ i18ns.t('twoFactor.disableNow') }}
              </el-button>
            </template>
          </div>
        </el-card>

        <el-drawer
          v-model="showPasskeyDrawer"
          :title="i18ns.t('passkey.management')"
          size="100%"
          direction="btt"
        >
          <PasskeyManagement />
        </el-drawer>
      </div>
    </div>

    <el-drawer
      v-model="showAccessKeyDrawer"
      :title="i18ns.t('accesskey.management')"
      :size="isDesktop ? '70%' : '100%'"
      :direction="isDesktop ? 'rtl' : 'btt'"
      destroy-on-close
    >
      <AccessKeyManagementView />
    </el-drawer>

    <el-drawer
      v-model="showTrustedDevicesDrawer"
      :title="i18ns.t('twoFactor.trustedDevicesTitle')"
      :size="isDesktop ? '60%' : '100%'"
      :direction="isDesktop ? 'rtl' : 'btt'"
      destroy-on-close
    >
      <TrustedDeviceManagement />
    </el-drawer>

    <el-dialog
      v-model="showTwoFactorSetupDialog"
      :title="i18ns.t('twoFactor.setupTitle')"
      :width="isDesktop ? '520px' : '96%'"
    >
      <el-skeleton :loading="twoFactorSetupLoading" :rows="6" animated>
        <div v-if="twoFactorSetupData" class="stack">
          <p class="section-desc">{{ i18ns.t('twoFactor.scanHint') }}</p>
          <img :src="twoFactorSetupData.qrCodeDataUrl" class="twofa-qr" alt="2FA QR" />

          <el-input :model-value="twoFactorSetupData.secret" readonly>
            <template #append>
              <el-button @click="handleCopyTwoFactorSecret">{{ i18ns.t('copy') }}</el-button>
            </template>
          </el-input>

          <el-input
            v-model="twoFactorSetupCode"
            maxlength="6"
            :placeholder="i18ns.t('twoFactor.codePlaceholder')"
          />
        </div>
      </el-skeleton>
      <template #footer>
        <el-button @click="showTwoFactorSetupDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button
          type="primary"
          :loading="twoFactorConfirming"
          :disabled="!twoFactorSetupData"
          @click="handleConfirmTwoFactorSetup"
        >
          {{ i18ns.t('confirm') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showTwoFactorRecoveryDialog"
      :title="i18ns.t('twoFactor.recoveryCodesTitle')"
      :width="isDesktop ? '560px' : '96%'"
      @close="handleCloseTwoFactorRecoveryDialog"
    >
      <p class="section-desc">{{ i18ns.t('twoFactor.recoveryCodesHint') }}</p>
      <div class="twofa-recovery-list">
        <el-tag v-for="code in twoFactorRecoveryCodes" :key="code" class="twofa-recovery-item">
          {{ code }}
        </el-tag>
      </div>
      <template #footer>
        <el-button @click="showTwoFactorRecoveryDialog = false">{{ i18ns.t('close') }}</el-button>
        <el-button type="primary" @click="handleCopyRecoveryCodes">{{ i18ns.t('copy') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import AccessKeyManagementView from './AccessKeyManagementView.vue'
import PasskeyManagement from './PasskeyManagementView.vue'
import TrustedDeviceManagement from './TrustedDeviceManagementView.vue'
import TrustedDeviceEntryView from './TrustedDeviceEntryView.vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import { authorizationService } from '@/service/authorizationService'
import { Notification } from '@/utils/notification'
import { userService } from '@/service/userService'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { sessionDB, STORE_NAMES } from '@/utils/sessionDB'
import { usePermissionStore } from '@/stores/permissionStore'

const router = useRouter()
import { Permission } from '@/constant/permission'
import { twoFactorManagementService } from '@/service/twoFactor/twoFactorManagementService'
import { CustomCode } from '@/constant/custom-code'
import { validateTwoFactorCode } from '@/utils/validation'

const themeToggleStore = useThemeToggleStore()
const isDark = themeToggleStore.useIsDark()
const toggleDark = () => themeToggleStore.toggleTheme()
const iconRef = computed(() => (isDark.value ? Sunny : Moon))

const passwordForm = ref({ new_password: '', confirm_password: '' })
const profileForm = ref({ name: '' })
const emailForm = ref({ newEmail: '', verificationCode: '' })
const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()

const canUpdateProfile = computed(() =>
  permissionStore.hasPermission(Permission.USER_UPDATE_SELF_PROFILE),
)
const canUpdateEmail = computed(() =>
  permissionStore.hasPermission(Permission.USER_UPDATE_SELF_EMAIL),
)

const showAccessKeyDrawer = ref(false)
const showPasskeyDrawer = ref(false)
const showTrustedDevicesDrawer = ref(false)
const profileSaving = ref(false)
const sendingCode = ref(false)
const emailChanging = ref(false)
const codeCooldown = ref(0)
const twoFactorLoading = ref(false)
const twoFactorSetupLoading = ref(false)
const twoFactorConfirming = ref(false)
const twoFactorPolicySaving = ref(false)

const twoFactorState = ref({
  enabled: false,
  passkeyRequired: false,
  hasRecoveryCodes: false,
})

const showTwoFactorSetupDialog = ref(false)
const showTwoFactorRecoveryDialog = ref(false)
const pendingTwoFactorReloginPrompt = ref(false)

const twoFactorSetupData = ref<null | {
  setupToken: string
  qrCodeDataUrl: string
  otpauthUrl: string
  secret: string
  expiresIn: number
}>(null)
const twoFactorSetupCode = ref('')
const twoFactorRecoveryCodes = ref<string[]>([])

let cooldownTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  if (Object.values(userInfoStore.userInfo).some((value) => value === '')) {
    await userInfoStore.fetchUserInfo()
  }
  profileForm.value.name = userInfoStore.userInfo.name || ''
  await loadTwoFactorStatus()
})

onUnmounted(() => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
})

const handleUpdateProfile = async () => {
  try {
    profileSaving.value = true
    const result = await userService.updateProfile({ name: profileForm.value.name || undefined })
    userInfoStore.setName(result.name ?? null)
    ElMessage.success(i18ns.t('SettingsView.profileUpdateSuccess'))
  } catch (err: any) {
    ElMessage.error(err?.message || i18ns.t('message.error.modifyFailed'))
  } finally {
    profileSaving.value = false
  }
}

const startCooldown = () => {
  codeCooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)

  cooldownTimer = setInterval(() => {
    codeCooldown.value--
    if (codeCooldown.value <= 0) {
      if (cooldownTimer) clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

const handleSendEmailCode = async () => {
  if (!emailForm.value.newEmail) return

  try {
    sendingCode.value = true
    await userService.sendEmailChangeCode(emailForm.value.newEmail)
    ElMessage.success(i18ns.t('SettingsView.codeSent'))
    startCooldown()
  } catch (err: any) {
    ElMessage.error(err?.message || i18ns.t('message.error.modifyFailed'))
  } finally {
    sendingCode.value = false
  }
}

const handleChangeEmail = async () => {
  if (!emailForm.value.newEmail || !emailForm.value.verificationCode) return

  try {
    emailChanging.value = true
    await userService.changeEmail(emailForm.value.newEmail, emailForm.value.verificationCode)
    ElMessage.success(i18ns.t('SettingsView.emailChangeSuccess'))
    userInfoStore.setEmail(emailForm.value.newEmail)
    emailForm.value = { newEmail: '', verificationCode: '' }
  } catch (err: any) {
    ElMessage.error(err?.message || i18ns.t('message.error.modifyFailed'))
  } finally {
    emailChanging.value = false
  }
}

const changePassword = async () => {
  if (
    !passwordForm.value.new_password ||
    passwordForm.value.new_password !== passwordForm.value.confirm_password
  ) {
    ElMessage.error(i18ns.t('message.error.passwordsDoNotMatch'))
    return
  }

  try {
    await userService.changePassword({
      userId: userInfoStore.userInfo.id,
      newPassword: passwordForm.value.new_password,
    })
    ElMessage.success(i18ns.t('message.information.editSuccess'))
    passwordForm.value.new_password = ''
    passwordForm.value.confirm_password = ''
    Notification.notify(
      i18ns.t('message.warning.sessionExpired'),
      i18ns.t('SettingsView.passwordChangeNotification'),
      'info',
    )
    authorizationService.logout()
  } catch (err) {
    if ((err as any)?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    console.error(err)
    ElMessage.error(i18ns.t('message.error.modifyFailed'))
  }
}

const formatStorageSize = (size: number) => {
  const sizeInKB = (size / 1024).toFixed(2)
  const sizeInMB = (size / 1024 / 1024).toFixed(2)
  return size > 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`
}

const getLocalStorageSize = () => {
  let localStorageSize = 0

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key) continue

    const value = localStorage.getItem(key) ?? ''
    localStorageSize += key.length + value.length
  }

  return localStorageSize * 2
}

const getSessionDBSize = async () => {
  try {
    let dbSize = 0

    for (const storeName of Object.values(STORE_NAMES)) {
      const records = await sessionDB.getAll<unknown>(storeName)
      dbSize += new Blob([JSON.stringify(records)]).size
    }

    return dbSize
  } catch {
    return 0
  }
}

const reloadAfterCacheClear = () => {
  setTimeout(() => {
    window.location.reload()
  }, 1500)
}

const handleClearLocalStorage = async () => {
  try {
    const localStorageSize = getLocalStorageSize()
    const displaySize = formatStorageSize(localStorageSize)

    await ElMessageBox.confirm(
      `${i18ns.t('SettingsView.clearLocalStorageWarning')} (${displaySize})`,
      i18ns.t('SettingsView.clearLocalStorageTitle'),
      { type: 'warning', confirmButtonClass: 'el-button--danger' },
    )

    localStorage.clear()
    ElMessage.success(`${i18ns.t('SettingsView.clearLocalStorageSuccess')} (${displaySize})`)
    reloadAfterCacheClear()
  } catch {
    // user cancelled
  }
}

const handleClearSessionDB = async () => {
  try {
    const dbSize = await getSessionDBSize()
    const displaySize = formatStorageSize(dbSize)

    await ElMessageBox.confirm(
      `${i18ns.t('SettingsView.clearSessionDBWarning')} (${displaySize})`,
      i18ns.t('SettingsView.clearSessionDBTitle'),
      { type: 'warning' },
    )

    await sessionDB.deleteDB()
    ElMessage.success(`${i18ns.t('SettingsView.clearSessionDBSuccess')} (${displaySize})`)
  } catch {
    // user cancelled
  }
}

const handleClearAllCache = async () => {
  try {
    const localStorageSize = getLocalStorageSize()
    const dbSize = await getSessionDBSize()
    const totalSize = localStorageSize + dbSize
    const displaySize = formatStorageSize(totalSize)

    await ElMessageBox.confirm(
      `${i18ns.t('SettingsView.clearAllWarning')} (${displaySize})`,
      i18ns.t('SettingsView.clearAllTitle'),
      { type: 'warning', confirmButtonClass: 'el-button--danger' },
    )

    localStorage.clear()
    await sessionDB.deleteDB()
    ElMessage.success(`${i18ns.t('SettingsView.clearAllSuccess')} (${displaySize})`)
    reloadAfterCacheClear()
  } catch {
    // user cancelled
  }
}

const loadTwoFactorStatus = async () => {
  try {
    twoFactorLoading.value = true
    const status = await twoFactorManagementService.getStatus()
    twoFactorState.value = {
      enabled: status.enabled,
      passkeyRequired: status.passkeyRequired,
      hasRecoveryCodes: status.hasRecoveryCodes,
    }
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('twoFactor.loadFailed'))
  } finally {
    twoFactorLoading.value = false
  }
}

const promptReloginAfterTwoFactorChange = async () => {
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
  } catch {
    // User chose to stay on current page.
  }
}

const handleBeginTwoFactorSetup = async () => {
  try {
    twoFactorSetupLoading.value = true
    showTwoFactorSetupDialog.value = true
    const setupData = await twoFactorManagementService.beginSetup()
    twoFactorSetupData.value = setupData
    twoFactorSetupCode.value = ''
  } catch (error: any) {
    showTwoFactorSetupDialog.value = false
    ElMessage.error(error?.message || i18ns.t('twoFactor.setupFailed'))
  } finally {
    twoFactorSetupLoading.value = false
  }
}

const handleConfirmTwoFactorSetup = async () => {
  const setupData = twoFactorSetupData.value
  if (!setupData) return

  const code = twoFactorSetupCode.value.trim()
  if (!code) {
    ElMessage.warning(i18ns.t('twoFactor.codeRequired'))
    return
  }

  if (!validateTwoFactorCode(code)) {
    ElMessage.warning(i18ns.t('twoFactor.codeFormatInvalid'))
    return
  }

  try {
    twoFactorConfirming.value = true
    const result = await twoFactorManagementService.confirmSetup(setupData.setupToken, code)
    twoFactorState.value = {
      enabled: result.enabled,
      passkeyRequired: result.passkeyRequired,
      hasRecoveryCodes: result.recoveryCodes.length > 0,
    }

    twoFactorRecoveryCodes.value = result.recoveryCodes
    pendingTwoFactorReloginPrompt.value = true
    showTwoFactorSetupDialog.value = false
    showTwoFactorRecoveryDialog.value = true
    ElMessage.success(i18ns.t('twoFactor.setupSuccess'))
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('twoFactor.setupFailed'))
  } finally {
    twoFactorConfirming.value = false
  }
}

const handleTogglePasskeyTwoFactorPolicy = async (nextValue: string | number | boolean) => {
  const nextPolicy = Boolean(nextValue)
  const prevPolicy = !nextPolicy
  try {
    twoFactorPolicySaving.value = true
    const result = await twoFactorManagementService.updatePasskeyPolicy(nextPolicy)
    twoFactorState.value.passkeyRequired = result.passkeyRequired
    ElMessage.success(i18ns.t('twoFactor.policySaved'))
    await promptReloginAfterTwoFactorChange()
  } catch (error: any) {
    twoFactorState.value.passkeyRequired = prevPolicy
    ElMessage.error(error?.message || i18ns.t('twoFactor.saveFailed'))
  } finally {
    twoFactorPolicySaving.value = false
  }
}

const handleGoDisableTwoFactor = () => {
  router.push({
    name: 'authVerification',
    query: {
      purpose: 'disable2fa',
      method: 'code',
      redirect: '/settings',
    },
  })
}

const handleCloseTwoFactorRecoveryDialog = () => {
  if (!pendingTwoFactorReloginPrompt.value) return
  pendingTwoFactorReloginPrompt.value = false
  void promptReloginAfterTwoFactorChange()
}

const handleCopyTwoFactorSecret = async () => {
  const secret = twoFactorSetupData.value?.secret
  if (!secret) return

  try {
    await navigator.clipboard.writeText(secret)
    ElMessage.success(i18ns.t('copySuccess'))
  } catch {
    ElMessage.error(i18ns.t('copyFailed'))
  }
}

const handleCopyRecoveryCodes = async () => {
  try {
    const text = twoFactorRecoveryCodes.value.join('\n')
    await navigator.clipboard.writeText(text)
    ElMessage.success(i18ns.t('copySuccess'))
  } catch {
    ElMessage.error(i18ns.t('copyFailed'))
  }
}

const { isDesktop } = usePageDevice()
</script>

<style scoped lang="scss">
.settings-container {
  max-width: 61.8vw;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-card {
  margin-top: 16px;
}

h3 {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-desc {
  margin-bottom: 16px;
  color: var(--el-text-color-secondary);
}

.w-full {
  width: 100%;
}

.grow {
  flex: 1;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.inline-row {
  display: flex;
  align-items: stretch;
  gap: 12px;
  width: 100%;
}

.action-btn {
  width: 148px;
  flex-shrink: 0;
}

.email-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 148px;
  gap: 12px;
  width: 100%;
}

.email-input {
  min-width: 0;
  width: 100%;
}

.email-btn {
  justify-self: stretch;
}

.email-current {
  margin-bottom: 8px;
  color: #606266;
  font-size: 14px;
}

.prefs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.prefs-actions .el-button,
.prefs-actions :deep(.el-dropdown) {
  min-width: 140px;
}

.twofa-card {
  border: 1px solid var(--el-border-color-lighter);
}

.twofa-content {
  gap: 12px;
  padding: 2px 0 4px;
}

.twofa-status-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.twofa-status-row :deep(.el-tag) {
  font-weight: 600;
  letter-spacing: 0.2px;
  padding: 0 12px;
}

.twofa-policy-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  border: 1px dashed var(--el-border-color);
  padding: 12px 14px;
  background: var(--el-fill-color-lighter);
  width: fit-content;
}

.twofa-policy-row :deep(.el-switch) {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.twofa-policy-row :deep(.el-switch__label) {
  white-space: normal;
  line-height: 1.35;
}

.twofa-action-row :deep(.el-button),
.twofa-danger-btn {
  min-width: 168px;
  width: fit-content;
}

@media (max-width: 768px) {
  .settings-container {
    max-width: 100%;
    padding: 0 4px;
  }
}
</style>

<style scoped lang="scss">
.settings-mobile {
  padding: 4px;
}

.page-title {
  margin: 4px 0 16px;
  font-size: 22px;
  font-weight: 600;
}

.section-card {
  margin-top: 12px;
}

h3 {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
}

.section-desc {
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.email-current {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.w-full {
  width: 100%;
}

.mt-12 {
  margin-top: 12px;
}

.lang-wrap :deep(.el-dropdown),
.lang-wrap :deep(.el-dropdown .el-button) {
  width: 100%;
}

.email-stack :deep(.el-input),
.email-stack :deep(.el-input__wrapper),
.email-stack :deep(.el-button) {
  width: 100%;
}

.email-stack > * {
  width: 100%;
}

.twofa-qr {
  width: 220px;
  max-width: 100%;
  margin: 0 auto;
  border: 1px solid var(--el-border-color-lighter);
}

.twofa-recovery-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.twofa-recovery-item {
  justify-content: center;
}

.twofa-content {
  gap: 10px;
}

.twofa-policy-row {
  padding: 10px 12px;
}

.twofa-policy-row :deep(.el-switch) {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
}

.twofa-policy-row :deep(.el-switch__label) {
  max-width: 44%;
  font-size: 12px;
}

.twofa-action-row,
.twofa-primary-btn,
.twofa-danger-btn {
  width: fit-content;
}

.twofa-action-row :deep(.el-button),
.twofa-primary-btn,
.twofa-danger-btn {
  width: fit-content;
  min-height: 36px;
  min-width: 0;
  margin-left: 0 !important;
}

@media (max-width: 768px) {
  .twofa-recovery-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
