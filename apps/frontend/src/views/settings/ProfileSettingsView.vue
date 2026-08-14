<template>
  <div class="settings-view-root">
    <AccountProfileLayout>
      <div v-if="isDesktop" class="desktop-page">
        <div class="page-header">
          <h1 class="page-title">{{ i18ns.t('SettingsView.profileTitle') }}</h1>
        </div>

        <el-card class="section-card page-card">
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
      </div>
      <div v-else class="mobile-page">
        <div class="settings-mobile">
          <h1 class="page-title">{{ i18ns.t('SettingsView.profileTitle') }}</h1>

          <el-card class="section-card mobile-card">
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
                    :disabled="
                      !canUpdateEmail || !emailForm.newEmail || !emailForm.verificationCode
                    "
                    :loading="emailChanging"
                    @click="handleChangeEmail"
                  >
                    {{ i18ns.t('SettingsView.changeEmail') }}
                  </el-button>
                </div>
              </el-form-item>
            </el-form>
          </el-card>
        </div>
      </div>
    </AccountProfileLayout>
  </div>
</template>

<script setup lang="ts">
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { userService } from '@/service/userService'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { Permission } from '@/constant/permission'

const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()

const canUpdateProfile = computed(() =>
  permissionStore.hasPermission(Permission.USER_UPDATE_SELF_PROFILE),
)
const canUpdateEmail = computed(() =>
  permissionStore.hasPermission(Permission.USER_UPDATE_SELF_EMAIL),
)

const profileForm = ref({ name: '' })
const emailForm = ref({ newEmail: '', verificationCode: '' })

const profileSaving = ref(false)
const sendingCode = ref(false)
const emailChanging = ref(false)
const codeCooldown = ref(0)

let cooldownTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  if (Object.values(userInfoStore.userInfo).some((value) => value === '')) {
    await userInfoStore.fetchUserInfo()
  }
  profileForm.value.name = userInfoStore.userInfo.name || ''
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

const { isDesktop } = usePageDevice()
</script>

<style scoped lang="scss">
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
  margin-top: 0;
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

@media (max-width: 768px) {
  .settings-view-root :deep(.account-profile-page) {
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
  margin-top: 0;
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

.email-stack :deep(.el-input),
.email-stack :deep(.el-input__wrapper),
.email-stack :deep(.el-button) {
  width: 100%;
}

.email-stack > * {
  width: 100%;
}
</style>
