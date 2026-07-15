<template>
  <div class="api-key-management-view">
    <div v-if="isDesktop" class="desktop-page">
      <el-card class="page-card">
        <template #header>
          <div class="toolbar">
            <span>{{ i18ns.t('ojSubmitter.apiKeyManagement') }}</span>
            <el-button type="primary" @click="showCreateDialog = true">
              {{ i18ns.t('ojSubmitter.createAPIKey') }}
            </el-button>
          </div>
        </template>

        <el-table v-loading="loading" :data="apiKeys" style="width: 100%">
          <el-table-column prop="name" :label="i18ns.t('ojSubmitter.apiKeyName')" min-width="160" />
          <el-table-column prop="key" :label="i18ns.t('ojSubmitter.apiKey')" min-width="220">
            <template #default="{ row }">
              <span class="key-preview">{{ truncateKey(row.key) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ojSubmitter.channelName')" min-width="150">
            <template #default="{ row }">
              <el-tag v-if="row.channelName" size="small" type="info" effect="plain">
                {{ row.channelName }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="requestCount"
            :label="i18ns.t('ojSubmitter.requestCount')"
            width="110"
          />
          <el-table-column
            prop="totalTokens"
            :label="i18ns.t('ojSubmitter.totalTokens')"
            width="120"
          />
          <el-table-column :label="i18ns.t('ojSubmitter.lastUsed')" width="180">
            <template #default="{ row }">
              {{ formatDate(row.lastUsedAt) }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ojSubmitter.expiresAt')" width="180">
            <template #default="{ row }">
              {{ formatExpiry(row.expiresAt) }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="220" fixed="right">
            <template #default="{ row }">
              <div class="table-actions">
                <el-button size="small" @click="copyKey(row.key)">
                  {{ i18ns.t('ojSubmitter.copyKey') }}
                </el-button>
                <el-button size="small" @click="handleEdit(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
                <el-button size="small" type="danger" @click="handleDelete(row)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <div v-else class="mobile-page">
      <el-card class="page-card">
        <template #header>
          <div class="mobile-toolbar">
            <span>{{ i18ns.t('ojSubmitter.apiKeyManagement') }}</span>
            <el-button type="primary" @click="showCreateDialog = true">
              {{ i18ns.t('ojSubmitter.createAPIKey') }}
            </el-button>
          </div>
        </template>

        <el-skeleton :loading="loading" :rows="4" animated>
          <div v-if="apiKeys.length" class="mobile-list">
            <el-card v-for="row in apiKeys" :key="row.id" class="mobile-item" shadow="never">
              <div class="mobile-item__header">
                <div class="mobile-item__title">{{ row.name || '-' }}</div>
                <el-button link type="primary" @click="copyKey(row.key)">
                  {{ i18ns.t('ojSubmitter.copyKey') }}
                </el-button>
              </div>

              <div class="mobile-item__key">{{ row.key }}</div>

              <div v-if="row.channelName" class="mobile-item__meta">
                {{ i18ns.t('ojSubmitter.channelName') }}: {{ row.channelName }}
              </div>
              <div class="mobile-item__meta">
                {{ i18ns.t('ojSubmitter.requestCount') }}: {{ row.requestCount || 0 }}
              </div>
              <div class="mobile-item__meta">
                {{ i18ns.t('ojSubmitter.totalTokens') }}: {{ row.totalTokens || 0 }}
              </div>
              <div class="mobile-item__meta">
                {{ i18ns.t('ojSubmitter.lastUsed') }}: {{ formatDate(row.lastUsedAt) }}
              </div>
              <div class="mobile-item__meta">
                {{ i18ns.t('ojSubmitter.expiresAt') }}: {{ formatExpiry(row.expiresAt) }}
              </div>

              <div class="mobile-item__actions">
                <el-button size="small" @click="handleEdit(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
                <el-button size="small" type="danger" @click="handleDelete(row)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>
      </el-card>
    </div>

    <el-dialog
      v-model="showCreateDialog"
      :title="i18ns.t('ojSubmitter.createAPIKey')"
      :width="isDesktop ? '520px' : '96%'"
      @closed="resetCreateForm"
    >
      <el-form :model="form" :label-position="isDesktop ? 'right' : 'top'" label-width="110px">
        <el-form-item :label="i18ns.t('ojSubmitter.apiKeyName')">
          <el-input v-model="form.name" :placeholder="i18ns.t('ojSubmitter.apiKeyName')" />
        </el-form-item>
        <el-form-item :label="i18ns.t('ojSubmitter.expiresAt')">
          <el-date-picker v-model="form.expiresAt" type="datetime" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="i18ns.t('ojSubmitter.channel')">
          <el-select
            v-model="form.channelId"
            clearable
            style="width: 100%"
            :placeholder="i18ns.t('ojSubmitter.selectChannel')"
          >
            <el-option :label="i18ns.t('ojSubmitter.defaultChannel')" value="" />
            <el-option
              v-for="channel in channels"
              :key="channel.id"
              :label="channel.name"
              :value="channel.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">
          {{ i18ns.t('confirm') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showEditDialog"
      :title="i18ns.t('ojSubmitter.editAPIKey')"
      :width="isDesktop ? '520px' : '96%'"
      @closed="resetEditForm"
    >
      <el-form :model="editForm" :label-position="isDesktop ? 'right' : 'top'" label-width="110px">
        <el-form-item :label="i18ns.t('ojSubmitter.apiKeyName')">
          <el-input v-model="editForm.name" :placeholder="i18ns.t('ojSubmitter.apiKeyName')" />
        </el-form-item>
        <el-form-item :label="i18ns.t('ojSubmitter.expiresAt')">
          <el-date-picker v-model="editForm.expiresAt" type="datetime" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="i18ns.t('ojSubmitter.channel')">
          <el-select
            v-model="editForm.channelId"
            clearable
            style="width: 100%"
            :placeholder="i18ns.t('ojSubmitter.selectChannel')"
          >
            <el-option :label="i18ns.t('ojSubmitter.defaultChannel')" value="" />
            <el-option
              v-for="channel in channels"
              :key="channel.id"
              :label="channel.name"
              :value="channel.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="updating" @click="handleUpdate">
          {{ i18ns.t('confirm') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showNewKeyDialog"
      :title="i18ns.t('ojSubmitter.createSuccess')"
      :width="isDesktop ? '560px' : '96%'"
      :close-on-press-escape="false"
      :close-on-click-modal="false"
    >
      <el-alert type="warning" :title="i18ns.t('warning')" :closable="false" show-icon>
        {{ i18ns.t('ojSubmitter.keyWarning') }}
      </el-alert>
      <el-input class="new-key-input" :model-value="newKey" readonly>
        <template #append>
          <el-button @click="copyKey(newKey)">{{ i18ns.t('ojSubmitter.copyKey') }}</el-button>
        </template>
      </el-input>
      <template #footer>
        <el-button type="primary" @click="showNewKeyDialog = false">
          {{ i18ns.t('confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import type { OjapiKeyDto, RelayChannelOptionDto } from '@/client/types.gen'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { OJAPIKeyService } from '@/service/ojAPIKeyService'
import { relayChannelService } from '@/service/relayChannelService'

const { isDesktop } = usePageDevice()

const ojAPIKeyService = OJAPIKeyService.getInstance()
const apiKeys = ref<OjapiKeyDto[]>([])
const channels = ref<RelayChannelOptionDto[]>([])
const loading = ref(false)
const creating = ref(false)
const updating = ref(false)
const showCreateDialog = ref(false)
const showEditDialog = ref(false)
const showNewKeyDialog = ref(false)
const newKey = ref('')
const editingId = ref('')

const form = ref({
  name: '',
  expiresAt: null as Date | null,
  channelId: '' as string | undefined,
})

const editForm = ref({
  name: '',
  expiresAt: null as Date | null,
  channelId: '' as string | undefined,
})

const resetCreateForm = () => {
  form.value = {
    name: '',
    expiresAt: null,
    channelId: '',
  }
}

const resetEditForm = () => {
  editForm.value = {
    name: '',
    expiresAt: null,
    channelId: '',
  }
  editingId.value = ''
}

const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : '-')

const formatExpiry = (value?: string) =>
  value ? new Date(value).toLocaleString() : i18ns.t('ojSubmitter.neverExpires')

const truncateKey = (key: string) => (key.length > 24 ? `${key.slice(0, 24)}...` : key)

const loadAPIKeys = async () => {
  loading.value = true
  try {
    apiKeys.value = await ojAPIKeyService.listAPIKeys()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ojSubmitter.loadFailed'))
  } finally {
    loading.value = false
  }
}

const loadChannels = async () => {
  try {
    channels.value = await relayChannelService.listChannelOptions()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ojSubmitter.loadFailed'))
  }
}

const handleCreate = async () => {
  creating.value = true
  try {
    const created = await ojAPIKeyService.createAPIKey({
      name: form.value.name || undefined,
      expiresAt: form.value.expiresAt?.toISOString(),
      channelId: form.value.channelId || undefined,
    })
    newKey.value = created.key
    showCreateDialog.value = false
    showNewKeyDialog.value = true
    resetCreateForm()
    await loadAPIKeys()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ojSubmitter.createFailed'))
  } finally {
    creating.value = false
  }
}

const handleEdit = (row: OjapiKeyDto) => {
  editingId.value = row.id
  editForm.value = {
    name: row.name || '',
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    channelId: row.channelId || '',
  }
  showEditDialog.value = true
}

const handleUpdate = async () => {
  if (!editingId.value) return

  updating.value = true
  try {
    await ojAPIKeyService.updateAPIKey(editingId.value, {
      name: editForm.value.name || undefined,
      expiresAt: editForm.value.expiresAt ? editForm.value.expiresAt.toISOString() : null,
      channelId: editForm.value.channelId || null,
    })
    ElMessage.success(i18ns.t('ojSubmitter.updateSuccess'))
    showEditDialog.value = false
    resetEditForm()
    await loadAPIKeys()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ojSubmitter.updateFailed'))
  } finally {
    updating.value = false
  }
}

const handleDelete = async (row: OjapiKeyDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('ojSubmitter.confirmDeleteKey'), i18ns.t('warning'), {
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'warning',
    })
    await ojAPIKeyService.deleteAPIKey(row.id)
    ElMessage.success(i18ns.t('ojSubmitter.deleteSuccess'))
    await loadAPIKeys()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('ojSubmitter.deleteFailed'))
    }
  }
}

const copyKey = async (key: string) => {
  await navigator.clipboard.writeText(key)
  ElMessage.success(i18ns.t('copySuccess'))
}

onMounted(() => {
  loadAPIKeys()
  loadChannels()
})

// Reload data when component is activated (for keep-alive)
onActivated(() => {
  loadAPIKeys()
})
</script>

<style scoped>
.desktop-page,
.mobile-page {
  padding: 16px;
}

.page-card {
  width: 100%;
}

.toolbar,
.mobile-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.table-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.key-preview {
  font-family: ui-monospace, SFMono-Regular, Monaco, Consolas, 'Liberation Mono', monospace;
}

.new-key-input {
  margin-top: 16px;
}

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-item {
  border: 1px solid var(--el-border-color-lighter);
}

.mobile-item__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.mobile-item__title {
  font-weight: 600;
}

.mobile-item__key {
  margin-top: 8px;
  font-family: ui-monospace, SFMono-Regular, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
  color: var(--el-text-color-secondary);
}

.mobile-item__meta {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.mobile-item__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }

  .desktop-page,
  .mobile-page {
    padding: 8px;
  }

  .mobile-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .mobile-item__actions .el-button {
    flex: 1;
  }
}
</style>
