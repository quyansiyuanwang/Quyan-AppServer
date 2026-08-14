<template>
  <div v-if="isDesktop" class="passkey-management desktop-page page-shell">
    <el-card class="page-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span>{{ i18ns.t('passkey.management') }}</span>
          <div class="button-group">
            <el-button :icon="Refresh" :loading="loading" @click="loadCredentials">
              {{ i18ns.t('refresh') }}
            </el-button>
            <el-button
              v-if="allowRegistration && passkeySupported"
              type="primary"
              :loading="registering"
              @click="handleRegister"
            >
              {{ i18ns.t('passkey.register') }}
            </el-button>
            <el-button
              v-else-if="!allowRegistration"
              type="primary"
              @click="emit('requestRegistration')"
            >
              {{ i18ns.t('passkey.register') }}
            </el-button>
            <el-tag v-else-if="allowRegistration" type="info">{{
              i18ns.t('passkey.notSupported')
            }}</el-tag>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="credentials">
        <el-table-column prop="name" :label="i18ns.t('passkey.name')">
          <template #default="{ row }">
            {{ row.name || i18ns.t('passkey.unnamed') }}
          </template>
        </el-table-column>
        <el-table-column prop="deviceType" :label="i18ns.t('passkey.deviceType')" width="140">
          <template #default="{ row }">{{ row.deviceType || '-' }}</template>
        </el-table-column>
        <el-table-column prop="backedUp" :label="i18ns.t('passkey.backedUp')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.backedUp ? 'success' : 'info'" size="small">
              {{ row.backedUp ? i18ns.t('passkey.yes') : i18ns.t('passkey.no') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" :label="i18ns.t('passkey.createdAt')" width="180">
          <template #default="{ row }">
            {{ row.createdAt ? new Date(row.createdAt).toLocaleString() : '-' }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="100">
          <template #default="{ row }">
            <el-button link type="danger" @click="handleDelete(row.credentialId)">
              {{ i18ns.t('delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>

  <div v-else class="passkey-mobile mobile-page">
    <el-card class="mobile-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span>{{ i18ns.t('passkey.management') }}</span>
          <div class="button-group">
            <el-button :icon="Refresh" :loading="loading" @click="loadCredentials">
              {{ i18ns.t('refresh') }}
            </el-button>
            <el-button
              v-if="allowRegistration && passkeySupported"
              type="primary"
              :loading="registering"
              @click="handleRegister"
            >
              {{ i18ns.t('passkey.register') }}
            </el-button>
            <el-button
              v-else-if="!allowRegistration"
              type="primary"
              @click="emit('requestRegistration')"
            >
              {{ i18ns.t('passkey.register') }}
            </el-button>
            <el-tag v-else-if="allowRegistration" type="info">{{
              i18ns.t('passkey.notSupported')
            }}</el-tag>
          </div>
        </div>
      </template>

      <el-skeleton :loading="loading" :rows="4" animated>
        <div v-if="credentials.length" class="list">
          <el-card
            v-for="row in credentials"
            :key="row.credentialId"
            class="item mobile-card"
            shadow="never"
          >
            <div class="row-top">
              <div class="name">{{ row.name || i18ns.t('passkey.unnamed') }}</div>
              <el-tag :type="row.backedUp ? 'success' : 'info'" size="small">
                {{ row.backedUp ? i18ns.t('passkey.yes') : i18ns.t('passkey.no') }}
              </el-tag>
            </div>

            <div class="meta">
              <div>{{ i18ns.t('passkey.deviceType') }}: {{ row.deviceType || '-' }}</div>
              <div>
                {{ i18ns.t('passkey.createdAt') }}:
                {{ row.createdAt ? new Date(row.createdAt).toLocaleString() : '-' }}
              </div>
            </div>

            <el-button
              class="delete-btn"
              link
              type="danger"
              @click="handleDelete(row.credentialId)"
            >
              {{ i18ns.t('delete') }}
            </el-button>
          </el-card>
        </div>
        <el-empty v-else />
      </el-skeleton>
    </el-card>
  </div>

  <el-dialog
    v-model="showNameDialog"
    :title="i18ns.t('passkey.nameYourKey')"
    :width="isDesktop ? '400px' : '92%'"
  >
    <el-input v-model="newKeyName" :placeholder="i18ns.t('passkey.namePlaceholder')" />
    <template #footer>
      <el-button @click="showNameDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="registering" @click="confirmRegister">
        {{ i18ns.t('confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { passkeyService } from '@/service/passkeyService'
import type { PasskeyCredentialItem, RecordStringAny } from '@/client/types.gen'
import { useRoute } from 'vue-router'
import { completeCentralLogin } from '@/service/centralLoginService'

const { isDesktop } = usePageDevice()
const { allowRegistration = true } = defineProps<{ allowRegistration?: boolean }>()
const emit = defineEmits<{ requestRegistration: [] }>()
const route = useRoute()

const loading = ref(false)
const registering = ref(false)
const credentials = ref<PasskeyCredentialItem[]>([])
const showNameDialog = ref(false)
const newKeyName = ref('')
const pendingOptions = ref<(PublicKeyCredentialCreationOptionsJSON & RecordStringAny) | null>(null)

const passkeySupported = computed(
  () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function',
)

async function loadCredentials() {
  loading.value = true
  try {
    credentials.value = await passkeyService.listCredentials()
  } catch (e) {
    ElMessage.error(i18ns.t('unknownError'))
    throw e
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  registering.value = true
  try {
    pendingOptions.value =
      (await passkeyService.getRegistrationOptions()) as PublicKeyCredentialCreationOptionsJSON &
        RecordStringAny
  } catch {
    ElMessage.error(i18ns.t('unknownError'))
    registering.value = false
    return
  } finally {
    registering.value = false
  }

  showNameDialog.value = true
  newKeyName.value = ''
}

async function confirmRegister() {
  if (!pendingOptions.value) {
    ElMessage.error(i18ns.t('unknownError'))
    return
  }

  registering.value = true
  try {
    const regResponse = await startRegistration({
      optionsJSON: pendingOptions.value,
    })
    await passkeyService.verifyRegistration(regResponse, newKeyName.value || undefined)

    ElMessage.success(i18ns.t('passkey.registerSuccess'))
    showNameDialog.value = false
    if (await completeCentralLogin(route.query.flowId)) return
    await loadCredentials()
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      ElMessage.warning(i18ns.t('passkey.cancelled'))
    } else {
      ElMessage.error(err?.message || i18ns.t('unknownError'))
    }
    throw err
  } finally {
    registering.value = false
  }
}

async function handleDelete(credentialId: string) {
  try {
    await ElMessageBox.confirm(i18ns.t('passkey.deleteConfirm'), i18ns.t('confirmDialog.delete'), {
      type: 'warning',
    })
    await passkeyService.deleteCredential(credentialId)
    ElMessage.success(i18ns.t('message.information.deleteSuccess'))
    await loadCredentials()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(i18ns.t('unknownError'))
    }
  }
}

onMounted(loadCredentials)
</script>

<style scoped>
.passkey-management {
  width: 100%;
  min-width: 0;
}

.passkey-mobile {
  padding: 8px 6px 16px;
}

.passkey-mobile .card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.passkey-mobile .button-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.passkey-mobile .list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.passkey-mobile .item {
  border: 1px solid var(--el-border-color-lighter);
}

.passkey-mobile .row-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.passkey-mobile .name {
  font-weight: 600;
}

.passkey-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.passkey-mobile .delete-btn {
  margin-top: 8px;
  padding-left: 0;
}

@media (max-width: 768px) {
  .passkey-mobile .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .passkey-mobile .button-group {
    width: 100%;
  }

  .passkey-mobile .button-group .el-button {
    flex: 1;
  }

  .passkey-mobile :deep(.el-dialog) {
    width: 96% !important;
    max-width: 96% !important;
    margin-top: 3vh !important;
  }

  .passkey-mobile :deep(.el-dialog__body) {
    max-height: 72vh;
    overflow: auto;
    padding: 12px 14px;
  }

  .passkey-mobile :deep(.el-dialog__footer .el-button) {
    min-height: 36px;
  }
}
</style>
