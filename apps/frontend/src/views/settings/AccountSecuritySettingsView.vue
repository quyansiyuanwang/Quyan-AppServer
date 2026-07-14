<template>
  <div class="settings-view-root">
    <div v-if="isDesktop" class="desktop-page">
      <div class="settings-container">
        <div class="page-header">
          <h1 class="page-title">{{ i18ns.t('nav.settingsSecurity') }}</h1>
        </div>

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

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.externalAccountsTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.externalAccountsDesc') }}</p>
          <div class="stack">
            <div
              v-for="item in externalIdentities"
              :key="item.id"
              class="inline-row"
              style="justify-content: space-between; gap: 12px"
            >
              <div>
                <strong>{{ item.provider }}</strong>
                <div class="section-desc">
                  {{ item.providerUsername || item.providerEmail || item.providerUserId }}
                </div>
              </div>
              <el-button
                type="danger"
                plain
                :loading="externalBindingProvider === item.provider"
                :disabled="externalBindingProvider !== null"
                @click="handleUnbindExternalIdentity(item.provider)"
              >
                {{ i18ns.t('common.delete') }}
              </el-button>
            </div>
            <div class="inline-row" style="gap: 8px; flex-wrap: wrap">
              <el-button
                v-if="publicSocialAuthConfig?.githubEnabled"
                :loading="externalBindingProvider === 'github'"
                :disabled="externalBindingProvider !== null"
                @click="handleBindExternalIdentity('github')"
              >
                GitHub
              </el-button>
              <el-button
                v-if="publicSocialAuthConfig?.wechatOpenEnabled"
                :loading="externalBindingProvider === 'wechat-open'"
                :disabled="externalBindingProvider !== null"
                @click="handleBindExternalIdentity('wechat-open')"
              >
                {{ i18ns.t('SettingsView.wechatOpenBind') }}
              </el-button>
              <el-button
                v-if="publicSocialAuthConfig?.wechatWebEnabled"
                :loading="externalBindingProvider === 'wechat-web'"
                :disabled="externalBindingProvider !== null"
                @click="handleBindExternalIdentity('wechat-web')"
              >
                {{ i18ns.t('SettingsView.wechatWebBind') }}
              </el-button>
            </div>
          </div>
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
        <h1 class="page-title">{{ i18ns.t('nav.settingsSecurity') }}</h1>

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

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.externalAccountsTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.externalAccountsDesc') }}</p>
          <div class="stack">
            <div v-for="item in externalIdentities" :key="item.id" class="stack" style="gap: 6px">
              <div>
                <strong>{{ item.provider }}</strong>
              </div>
              <div class="section-desc">
                {{ item.providerUsername || item.providerEmail || item.providerUserId }}
              </div>
              <el-button
                class="w-full"
                type="danger"
                plain
                :loading="externalBindingProvider === item.provider"
                :disabled="externalBindingProvider !== null"
                @click="handleUnbindExternalIdentity(item.provider)"
              >
                {{ i18ns.t('common.delete') }}
              </el-button>
            </div>
            <el-button
              v-if="publicSocialAuthConfig?.githubEnabled"
              class="w-full"
              :loading="externalBindingProvider === 'github'"
              :disabled="externalBindingProvider !== null"
              @click="handleBindExternalIdentity('github')"
            >
              GitHub
            </el-button>
            <el-button
              v-if="publicSocialAuthConfig?.wechatOpenEnabled"
              class="w-full"
              :loading="externalBindingProvider === 'wechat-open'"
              :disabled="externalBindingProvider !== null"
              @click="handleBindExternalIdentity('wechat-open')"
            >
              {{ i18ns.t('SettingsView.wechatOpenBind') }}
            </el-button>
            <el-button
              v-if="publicSocialAuthConfig?.wechatWebEnabled"
              class="w-full"
              :loading="externalBindingProvider === 'wechat-web'"
              :disabled="externalBindingProvider !== null"
              @click="handleBindExternalIdentity('wechat-web')"
            >
              {{ i18ns.t('SettingsView.wechatWebBind') }}
            </el-button>
          </div>
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
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import AccessKeyManagementView from './AccessKeyManagementView.vue'
import PasskeyManagement from './PasskeyManagementView.vue'
import TrustedDeviceManagement from './TrustedDeviceManagementView.vue'
import TrustedDeviceEntryView from './TrustedDeviceEntryView.vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { authorizationService } from '@/service/authorizationService'
import { Notification } from '@/utils/notification'
import { userService } from '@/service/userService'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { socialAuthService } from '@/service/socialAuthService'

const router = useRouter()
import { Permission } from '@/constant/permission'
import { twoFactorManagementService } from '@/service/twoFactor/twoFactorManagementService'
import { CustomCode } from '@/constant/custom-code'
import { validateTwoFactorCode } from '@/utils/validation'

const passwordForm = ref({ new_password: '', confirm_password: '' })
const userInfoStore = useUserInfoStore()
const route = useRoute()
const externalIdentities = ref<
  Array<{
    id: string
    provider: 'github' | 'wechat-open' | 'wechat-web'
    providerUserId: string
    providerUsername?: string | null
    providerEmail?: string | null
  }>
>([])
const externalBindingProvider = ref<'github' | 'wechat-open' | 'wechat-web' | null>(null)
const publicSocialAuthConfig = ref<{
  githubEnabled: boolean
  wechatOpenEnabled: boolean
  wechatWebEnabled: boolean
  qrLoginEnabled: boolean
} | null>(null)

const loadPublicSocialAuthConfig = async () => {
  try {
    const { configService } = await import('@/service/configService')
    publicSocialAuthConfig.value = await configService.getPublicSocialAuthConfig()
  } catch (error: any) {
    console.error('Failed to load public social auth config:', error)
  }
}

const showAccessKeyDrawer = ref(false)
const showPasskeyDrawer = ref(false)
const showTrustedDevicesDrawer = ref(false)
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

const loadExternalIdentities = async () => {
  try {
    externalIdentities.value = await socialAuthService.listExternalIdentities()
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('SettingsView.externalAccountsLoadFailed'))
  }
}

const clearBindQuery = async () => {
  const nextQuery = { ...route.query }
  delete nextQuery.bindProvider
  delete nextQuery.bindingToken
  await router.replace({
    name: 'settingsSecurity',
    query: nextQuery,
  })
}

const consumePendingExternalBinding = async () => {
  const bindProvider = typeof route.query.bindProvider === 'string' ? route.query.bindProvider : ''
  const bindingToken = typeof route.query.bindingToken === 'string' ? route.query.bindingToken : ''

  if (
    !bindingToken ||
    (bindProvider !== 'github' && bindProvider !== 'wechat-open' && bindProvider !== 'wechat-web')
  ) {
    return
  }

  externalBindingProvider.value = bindProvider
  try {
    await socialAuthService.bindExternalIdentity(bindProvider, bindingToken)
    ElMessage.success(i18ns.t('message.information.editSuccess'))
    await loadExternalIdentities()
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('SettingsView.externalAccountsBindFailed'))
  } finally {
    externalBindingProvider.value = null
    await clearBindQuery()
  }
}

const handleBindExternalIdentity = async (provider: 'github' | 'wechat-open' | 'wechat-web') => {
  externalBindingProvider.value = provider
  try {
    const redirect = `${window.location.origin}/auth/external/${provider}/callback`
    const { authorizeUrl } = await socialAuthService.startExternalAuth(provider, 'bind', redirect)
    window.location.href = authorizeUrl
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('SettingsView.externalAccountsBindFailed'))
  } finally {
    externalBindingProvider.value = null
  }
}

const handleUnbindExternalIdentity = async (provider: string) => {
  externalBindingProvider.value = provider as 'github' | 'wechat-open' | 'wechat-web'
  try {
    await socialAuthService.unbindExternalIdentity(provider as any)
    ElMessage.success(i18ns.t('SettingsView.externalAccountsUnbindSuccess'))
    await loadExternalIdentities()
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('SettingsView.externalAccountsUnbindFailed'))
  } finally {
    externalBindingProvider.value = null
  }
}

onMounted(async () => {
  await loadTwoFactorStatus()
  await loadExternalIdentities()
  await consumePendingExternalBinding()
  await loadPublicSocialAuthConfig()
})

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
      redirect: '/settings/security',
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
  width: 100%;
  min-width: 0;
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

.w-full {
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
