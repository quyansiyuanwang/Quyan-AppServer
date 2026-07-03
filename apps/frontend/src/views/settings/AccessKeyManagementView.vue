<template>
  <div class="accesskey-management-view">
    <div v-if="isDesktop" class="accesskey-management desktop-page">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('accesskey.management') }}</span>
            <div class="button-group">
              <el-button :icon="Refresh" :loading="loading" @click="loadAccessKeys">
                {{ i18ns.t('refresh') }}
              </el-button>
              <el-button type="primary" @click="openCreateDialog">
                {{ i18ns.t('accesskey.create') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="accessKeys">
          <el-table-column prop="name" :label="i18ns.t('accesskey.name')" />
          <el-table-column prop="key" :label="i18ns.t('accesskey.key')" width="200" />
          <el-table-column
            prop="requestCount"
            :label="i18ns.t('accesskey.requestCount')"
            width="120"
          />
          <el-table-column prop="lastUsedAt" :label="i18ns.t('accesskey.lastUsed')" width="180">
            <template #default="{ row }">
              {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="expiresAt" :label="i18ns.t('accesskey.expiresAt')" width="180">
            <template #default="{ row }">
              {{
                row.expiresAt
                  ? new Date(row.expiresAt).toLocaleString()
                  : i18ns.t('accesskey.neverExpires')
              }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="100">
            <template #default="{ row }">
              <el-button link type="danger" @click="handleDelete(row)">{{
                i18ns.t('delete')
              }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <div v-else class="accesskey-mobile mobile-page">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('accesskey.management') }}</span>
            <div class="button-group">
              <el-button :icon="Refresh" :loading="loading" @click="loadAccessKeys">
                {{ i18ns.t('refresh') }}
              </el-button>
              <el-button type="primary" @click="openCreateDialog">
                {{ i18ns.t('accesskey.create') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-skeleton :loading="loading" animated :rows="4">
          <div v-if="accessKeys.length" class="list">
            <el-card
              v-for="row in accessKeys"
              :key="row.id"
              class="item mobile-card"
              shadow="never"
            >
              <div class="name">{{ row.name || '-' }}</div>
              <div class="key">{{ row.key }}</div>
              <div class="meta">
                <div>{{ i18ns.t('accesskey.requestCount') }}: {{ row.requestCount || 0 }}</div>
                <div>
                  {{ i18ns.t('accesskey.lastUsed') }}:
                  {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '-' }}
                </div>
                <div>
                  {{ i18ns.t('accesskey.expiresAt') }}:
                  {{
                    row.expiresAt
                      ? new Date(row.expiresAt).toLocaleString()
                      : i18ns.t('accesskey.neverExpires')
                  }}
                </div>
              </div>
              <el-button class="delete-btn" link type="danger" @click="handleDelete(row)">
                {{ i18ns.t('delete') }}
              </el-button>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>
      </el-card>
    </div>

    <el-dialog
      v-model="showCreateDialog"
      :title="i18ns.t('accesskey.create')"
      :width="isDesktop ? '500px' : '92%'"
    >
      <el-form
        :model="createForm"
        :label-width="isDesktop ? '140px' : undefined"
        :label-position="isDesktop ? 'right' : 'top'"
      >
        <el-form-item :label="i18ns.t('accesskey.name')">
          <el-input v-model="createForm.name" />
        </el-form-item>
        <el-form-item :label="i18ns.t('accesskey.expiresAt')">
          <el-date-picker
            v-model="createForm.expiresAt"
            type="datetime"
            :style="{ width: isDesktop ? undefined : '100%' }"
          />
        </el-form-item>
        <TwoFactorGuardedVerificationField
          v-model="createForm.verificationCode"
          :is-two-factor-enabled="isTwoFactorEnabled"
          :is-desktop="isDesktop"
          :countdown="countdown"
          guard-hint-key="accesskey.twoFactorGuardHint"
          @send-code="sendCode"
        />
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" @click="handleCreate">{{ i18ns.t('confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showKeyDialog"
      :close-on-click-modal="false"
      :title="i18ns.t('accesskey.createSuccess')"
      :width="isDesktop ? '600px' : '92%'"
    >
      <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
        {{ i18ns.t('accesskey.keyWarning') }}
      </el-alert>
      <el-input v-if="isDesktop" v-model="createdKey" readonly>
        <template #append>
          <el-button type="primary" @click="copyCreatedKey">{{
            i18ns.t('accesskey.copy')
          }}</el-button>
        </template>
      </el-input>
      <el-input v-else v-model="createdKey" readonly type="textarea" :rows="3" />
      <template #footer>
        <el-button v-if="!isDesktop" @click="copyCreatedKey">{{
          i18ns.t('accesskey.copy')
        }}</el-button>
        <el-button type="primary" @click="showKeyDialog = false">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { twoFactorManagementService } from '@/service/twoFactor/twoFactorManagementService'
import { CustomCode } from '@/constant/custom-code'

const { isDesktop } = usePageDevice()

import { onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AccessKeyService } from '@/service/accesskeyService'
import { useI18n } from 'vue-i18n'
import type { AccessKeyDto } from '@/client/types.gen'
import TwoFactorGuardedVerificationField from '@/components/auth/TwoFactorGuardedVerificationField.vue'

const { t } = useI18n()
const accessKeys = ref<AccessKeyDto[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const showKeyDialog = ref(false)
const createdKey = ref('')
const countdown = ref(0)
const isTwoFactorEnabled = ref(false)
const createForm = ref({ name: '', expiresAt: null as Date | null, verificationCode: '' })
const accesskeyService = AccessKeyService.getInstance()

let timer: ReturnType<typeof setInterval> | null = null

const stopTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

const loadAccessKeys = async () => {
  loading.value = true
  try {
    const res = await accesskeyService.getAccessKeys()
    accessKeys.value = res.data
  } catch (error) {
    ElMessage.error(t('accesskey.loadFailed'))
    throw error
  } finally {
    loading.value = false
  }
}

const loadTwoFactorStatus = async () => {
  try {
    const status = await twoFactorManagementService.getStatus()
    isTwoFactorEnabled.value = status.enabled
    if (status.enabled) {
      createForm.value.verificationCode = ''
      countdown.value = 0
      stopTimer()
    }
  } catch {
    isTwoFactorEnabled.value = false
  }
}

const openCreateDialog = async () => {
  showCreateDialog.value = true
  await loadTwoFactorStatus()
}

const sendCode = async () => {
  if (isTwoFactorEnabled.value) {
    ElMessage.info(t('accesskey.twoFactorGuardHint'))
    return
  }

  try {
    await accesskeyService.sendVerificationCode()
    ElMessage.success(t('loginOrRegisterPage.codeSent'))
    countdown.value = 60
    stopTimer()
    timer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        countdown.value = 0
        stopTimer()
      }
    }, 1000)
  } catch (error) {
    ElMessage.error(t('loginOrRegisterPage.requestFailed'))
    throw error
  }
}

const handleCreate = async () => {
  if (!isTwoFactorEnabled.value && !createForm.value.verificationCode.trim()) {
    ElMessage.error(t('loginOrRegisterPage.enterVerificationCode'))
    return
  }

  try {
    const res = await accesskeyService.createAccessKey({
      name: createForm.value.name,
      expiresAt: createForm.value.expiresAt?.toISOString(),
      verificationCode: isTwoFactorEnabled.value
        ? undefined
        : createForm.value.verificationCode.trim(),
    })
    const key = res?.data?.key
    if (!key || typeof key !== 'string') throw new Error('AccessKey creation returned empty key')

    createdKey.value = key
    showCreateDialog.value = false
    showKeyDialog.value = true
    createForm.value = { name: '', expiresAt: null, verificationCode: '' }
    loadAccessKeys()
  } catch (error: any) {
    if (error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    ElMessage.error(t('accesskey.createFailed'))
    throw error
  }
}

const handleDelete = async (row: AccessKeyDto) => {
  try {
    await ElMessageBox.confirm(t('accesskey.confirmDelete'), t('confirmDialog.warning'), {
      type: 'warning',
    })
    await accesskeyService.deleteAccessKey(row.id)
    ElMessage.success(t('accesskey.deleteSuccess'))
    loadAccessKeys()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('accesskey.deleteFailed'))
    }
  }
}

const copyCreatedKey = () => {
  navigator.clipboard.writeText(createdKey.value)
  ElMessage.success(t('accesskey.copySuccess'))
}

onMounted(() => {
  void loadAccessKeys()
  void loadTwoFactorStatus()
})

onUnmounted(() => {
  stopTimer()
})

watch(showCreateDialog, (visible) => {
  if (!visible) return
  void loadTwoFactorStatus()
})
</script>

<style scoped>
.accesskey-mobile {
  padding: 8px 6px 16px;
}

.accesskey-mobile .card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.accesskey-mobile .button-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.accesskey-mobile .list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.accesskey-mobile .item {
  border: 1px solid var(--el-border-color-lighter);
}

.accesskey-mobile .name {
  font-weight: 600;
}

.accesskey-mobile .key {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

.accesskey-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.accesskey-mobile .delete-btn {
  margin-top: 8px;
  padding-left: 0;
}

@media (max-width: 768px) {
  .accesskey-mobile .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .accesskey-mobile .button-group {
    width: 100%;
  }

  .accesskey-mobile .button-group .el-button {
    flex: 1;
  }

  .accesskey-mobile :deep(.el-dialog) {
    width: 96% !important;
    max-width: 96% !important;
    margin-top: 3vh !important;
  }

  .accesskey-mobile :deep(.el-dialog__body) {
    max-height: 72vh;
    overflow: auto;
    padding: 12px 14px;
  }

  .accesskey-mobile :deep(.el-dialog__footer .el-button) {
    min-height: 36px;
  }
}
</style>
