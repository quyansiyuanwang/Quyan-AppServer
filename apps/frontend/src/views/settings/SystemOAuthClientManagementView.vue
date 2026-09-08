<template>
  <div class="system-oauth-management-view page-shell desktop-page">
    <el-card class="page-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span>{{ t('systemOAuth.title') }}</span>
          <el-button type="primary" @click="openCreateDialog">
            <el-icon><Plus /></el-icon>
            {{ t('systemOAuth.create') }}
          </el-button>
        </div>
      </template>

      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        <template #title>
          {{ t('systemOAuth.description') }}
        </template>
      </el-alert>

      <el-table :data="systemClients" v-loading="loading">
        <el-table-column prop="clientId" label="Client ID" min-width="150">
          <template #default="{ row }">
            <code>{{ row.clientId }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="t('systemOAuth.name')" min-width="150" />
        <el-table-column prop="clientType" :label="t('systemOAuth.type')" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.clientType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reviewStatus" :label="t('systemOAuth.status.label')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.reviewStatus === 'approved' ? 'success' : 'warning'" size="small">
              {{ statusLabel(row.reviewStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="isPkceRequired" label="PKCE" width="80">
          <template #default="{ row }">
            <el-icon v-if="row.isPkceRequired" color="green"><Check /></el-icon>
            <el-icon v-else color="gray"><Close /></el-icon>
          </template>
        </el-table-column>
        <el-table-column :label="t('systemOAuth.actions')" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewClient(row)">{{
              t('systemOAuth.view')
            }}</el-button>
            <el-button link type="primary" size="small" @click="editClient(row)">{{
              t('systemOAuth.edit')
            }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="t('systemOAuth.dialog.createTitle')"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-form-item label="Client ID" prop="clientId">
          <el-input
            v-model="form.clientId"
            :placeholder="t('systemOAuth.clientIdPlaceholder')"
            :disabled="isEditing"
          />
          <div class="form-tip">{{ t('systemOAuth.immutable') }}</div>
        </el-form-item>

        <el-form-item :label="t('systemOAuth.name')" prop="name">
          <el-input v-model="form.name" :placeholder="t('systemOAuth.namePlaceholder')" />
        </el-form-item>

        <el-form-item :label="t('systemOAuth.descriptionLabel')" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            :placeholder="t('systemOAuth.descriptionPlaceholder')"
          />
        </el-form-item>

        <el-form-item :label="t('systemOAuth.type')" prop="clientType">
          <el-select v-model="form.clientType" :disabled="isEditing">
            <el-option :label="t('systemOAuth.clientType.public')" value="public" />
            <el-option :label="t('systemOAuth.clientType.confidential')" value="confidential" />
          </el-select>
          <div class="form-tip">{{ t('systemOAuth.clientType.tip') }}</div>
        </el-form-item>

        <el-form-item :label="t('systemOAuth.redirectUris')" prop="redirectUris">
          <el-select
            v-model="form.redirectUris"
            multiple
            allow-create
            filterable
            default-first-option
            :placeholder="t('systemOAuth.redirectUrisPlaceholder')"
            style="width: 100%"
            :disabled="isEditing"
          >
          </el-select>
          <div class="form-tip">{{ t('systemOAuth.redirectUrisTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('systemOAuth.scopes')" prop="scopes">
          <OAuthScopeTreeSelector v-model="form.scopes" :scopes="scopeCatalog" />
        </el-form-item>

        <el-form-item label="PKCE" prop="isPkceRequired">
          <el-switch v-model="form.isPkceRequired" :disabled="isEditing" />
          <div class="form-tip">{{ t('systemOAuth.pkceTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('systemOAuth.accessTokenLifetime')">
          <el-input-number v-model="form.accessTokenLifetime" :min="300" :max="86400" />
          <span style="margin-left: 8px">{{ t('systemOAuth.lifetime.accessDefault') }}</span>
        </el-form-item>

        <el-form-item :label="t('systemOAuth.refreshTokenLifetime')">
          <el-input-number v-model="form.refreshTokenLifetime" :min="3600" :max="2592000" />
          <span style="margin-left: 8px">{{ t('systemOAuth.lifetime.refreshDefault') }}</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">{{ t('systemOAuth.cancel') }}</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ isEditing ? t('systemOAuth.save') : t('systemOAuth.create') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 查看对话框 -->
    <el-dialog v-model="showViewDialog" :title="t('systemOAuth.dialog.viewTitle')" width="600px">
      <el-descriptions :column="1" border v-if="selectedClient">
        <el-descriptions-item label="Client ID">
          <code>{{ selectedClient.clientId }}</code>
        </el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.name')">{{
          selectedClient.name
        }}</el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.descriptionLabel')">{{
          selectedClient.description
        }}</el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.type')">{{
          selectedClient.clientType
        }}</el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.status.label')">
          <el-tag :type="selectedClient.reviewStatus === 'approved' ? 'success' : 'warning'">
            {{ statusLabel(selectedClient.reviewStatus) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="PKCE">
          {{ selectedClient.isPkceRequired ? t('systemOAuth.enabled') : t('systemOAuth.disabled') }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.redirectUris')">
          <div v-for="uri in parseJsonArray(selectedClient.redirectUris)" :key="uri">
            <code>{{ uri }}</code>
          </div>
        </el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.scopes')">
          <el-tag
            v-for="scope in parseJsonArray(selectedClient.scopes)"
            :key="scope"
            size="small"
            style="margin: 2px"
          >
            {{ scope }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item :label="t('systemOAuth.systemClient')">
          <el-icon v-if="(selectedClient as any).isSystemClient" color="green"><Check /></el-icon>
          <el-icon v-else color="gray"><Close /></el-icon>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Check, Close } from '@element-plus/icons-vue'
import { OAuthClientService } from '@/service/oauthClientService'
import type { OAuthClientDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import OAuthScopeTreeSelector, {
  type OAuthScopeOption,
} from '@/components/oauth/OAuthScopeTreeSelector.vue'

type LocaleKey = Parameters<typeof i18ns.t>[0]
const t = (key: LocaleKey, params?: Record<string, unknown>) => i18ns.t(key, params)
const statusLabel = (status: string) => t(`systemOAuth.status.${status}` as LocaleKey)
const scopeCatalog = ref<OAuthScopeOption[]>([])

const oauthClientService = OAuthClientService.getInstance()

const loading = ref(false)
const submitting = ref(false)
const showCreateDialog = ref(false)
const showViewDialog = ref(false)
const isEditing = ref(false)
const systemClients = ref<OAuthClientDto[]>([])
const selectedClient = ref<OAuthClientDto | null>(null)
const formRef = ref()

const form = reactive({
  clientId: '',
  name: '',
  description: '',
  clientType: 'public' as 'public' | 'confidential',
  redirectUris: [] as string[],
  scopes: [] as string[],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 604800,
})

const rules = {
  clientId: [{ required: true, message: t('systemOAuth.validation.clientId'), trigger: 'blur' }],
  name: [{ required: true, message: t('systemOAuth.validation.name'), trigger: 'blur' }],
  clientType: [
    { required: true, message: t('systemOAuth.validation.clientType'), trigger: 'change' },
  ],
  redirectUris: [
    { required: true, message: t('systemOAuth.validation.redirectUris'), trigger: 'change' },
  ],
  scopes: [{ required: true, message: t('systemOAuth.validation.scopes'), trigger: 'change' }],
}

function resetForm() {
  isEditing.value = false
  selectedClient.value = null
  Object.assign(form, {
    clientId: '',
    name: '',
    description: '',
    clientType: 'public',
    redirectUris: [],
    scopes: [],
    isPkceRequired: true,
    accessTokenLifetime: 3600,
    refreshTokenLifetime: 604800,
  })
}

function openCreateDialog() {
  resetForm()
  showCreateDialog.value = true
}

async function loadSystemClients() {
  loading.value = true
  try {
    const response = await oauthClientService.listSystemClients()
    systemClients.value = response.data || []
  } catch (error: any) {
    ElMessage.error(error.message || t('systemOAuth.messages.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  await formRef.value.validate()
  submitting.value = true
  try {
    const payload: any = {
      clientId: form.clientId,
      name: form.name,
      description: form.description,
      clientType: form.clientType,
      redirectUris: form.redirectUris,
      scopes: form.scopes,
      accessTokenLifetime: form.accessTokenLifetime,
      refreshTokenLifetime: form.refreshTokenLifetime,
    }

    if (isEditing.value) {
      await oauthClientService.updateSystemClient(selectedClient.value!.id, payload)
      ElMessage.success(t('systemOAuth.messages.updated'))
    } else {
      payload.isSystemClient = true // 仅创建时标记为系统客户端
      await oauthClientService.createSystemClient(payload)
      ElMessage.success(t('systemOAuth.messages.created'))
    }

    showCreateDialog.value = false
    await loadSystemClients()
  } catch (error: any) {
    ElMessage.error(error.message || t('systemOAuth.messages.operationFailed'))
  } finally {
    submitting.value = false
  }
}

function viewClient(client: OAuthClientDto) {
  selectedClient.value = client
  showViewDialog.value = true
}

function editClient(client: OAuthClientDto) {
  selectedClient.value = client
  isEditing.value = true
  Object.assign(form, {
    clientId: client.clientId,
    name: client.name,
    description: client.description,
    clientType: client.clientType,
    redirectUris: parseJsonArray(client.redirectUris),
    scopes: parseJsonArray(client.scopes),
    isPkceRequired: client.isPkceRequired,
    accessTokenLifetime: client.accessTokenLifetime,
    refreshTokenLifetime: client.refreshTokenLifetime,
  })
  showCreateDialog.value = true
}

function parseJsonArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value
  try {
    return JSON.parse(value as string)
  } catch {
    return []
  }
}

onMounted(() => {
  void Promise.all([loadSystemClients(), loadScopeCatalog()])
})

async function loadScopeCatalog() {
  const response = await oauthClientService.getOAuthScopes()
  scopeCatalog.value = (response as { scopes: OAuthScopeOption[] }).scopes
}
</script>

<style scoped lang="scss">
.system-oauth-management-view {
  .toolbar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .form-tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-top: 4px;
  }
}
</style>
