<template>
  <div class="auth-center-client-management-view">
    <el-card class="auth-center-reference page-card">
      <template #header>
        <div class="card-header">
          <span>{{ i18ns.t('authCenterClient.referenceTitle') }}</span>
        </div>
      </template>

      <p class="text-secondary auth-center-reference__intro">
        {{ i18ns.t('authCenterClient.referenceDescription') }}
      </p>

      <div class="auth-center-reference__table-wrapper">
        <el-table :data="grantTypeRows" size="small">
          <el-table-column
            prop="grantType"
            :label="i18ns.t('authCenterClient.grantTypeColumn')"
            min-width="180"
          >
            <template #default="{ row }">
              <code>{{ row.grantType }}</code>
            </template>
          </el-table-column>
          <el-table-column
            prop="description"
            :label="i18ns.t('authCenterClient.grantDescriptionColumn')"
            min-width="240"
          />
          <el-table-column
            prop="tokenBehavior"
            :label="i18ns.t('authCenterClient.tokenBehaviorColumn')"
            min-width="240"
          />
          <el-table-column
            prop="notes"
            :label="i18ns.t('authCenterClient.notesColumn')"
            min-width="220"
          />
        </el-table>
      </div>
    </el-card>

    <div v-if="isDesktop" class="desktop-page">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('authCenterClient.management') }}</span>
            <div class="button-group">
              <el-button :icon="Refresh" :loading="loading" @click="loadClients">
                {{ i18ns.t('refresh') }}
              </el-button>
              <el-button type="primary" @click="openCreateDialog">
                {{ i18ns.t('authCenterClient.create') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="clients">
          <el-table-column prop="name" :label="i18ns.t('authCenterClient.name')" min-width="180" />
          <el-table-column :label="i18ns.t('authCenterClient.reviewStatus')" width="140">
            <template #default="{ row }">
              <div class="review-status-cell">
                <el-tag :type="getReviewStatusTagType(row.reviewStatus)" effect="light">
                  {{ getReviewStatusLabel(row.reviewStatus) }}
                </el-tag>
                <div v-if="row.reviewComment" class="review-status-cell__comment text-secondary">
                  {{ i18ns.t('authCenterClient.reviewComment') }}: {{ row.reviewComment }}
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="clientId"
            :label="i18ns.t('authCenterClient.clientId')"
            min-width="220"
          />
          <el-table-column
            prop="clientType"
            :label="i18ns.t('authCenterClient.clientType')"
            width="130"
          >
            <template #default="{ row }">
              {{ getClientTypeLabel(row.clientType) }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('authCenterClient.grantTypes')" min-width="220">
            <template #default="{ row }">
              <div class="stack compact-list">
                <el-tag
                  v-for="grantType in row.grantTypes"
                  :key="grantType"
                  size="small"
                  effect="plain"
                >
                  {{ getGrantTypeLabel(grantType) }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('authCenterClient.tokenLifetime')" width="220">
            <template #default="{ row }">
              <div class="stack compact-list small-text">
                <div>
                  {{ i18ns.t('authCenterClient.accessTokenLifetime') }}:
                  {{ formatLifetime(row.accessTokenLifetime) }}
                </div>
                <div>
                  {{ i18ns.t('authCenterClient.refreshTokenLifetime') }}:
                  {{ formatLifetime(row.refreshTokenLifetime) }}
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            :label="i18ns.t('authCenterClient.redirectUris')"
            min-width="240"
            class-name="auth-center-client-table__redirect-column"
          >
            <template #default="{ row }">
              <div class="stack compact-list">
                <div v-for="uri in row.redirectUris.slice(0, 2)" :key="uri" class="mono small-text">
                  {{ uri }}
                </div>
                <div v-if="row.redirectUris.length > 2" class="small-text text-secondary">
                  {{
                    i18ns.t('authCenterClient.moreItems', { count: row.redirectUris.length - 2 })
                  }}
                </div>
                <div v-if="!row.redirectUris.length" class="small-text text-secondary">-</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="clientSecretPreview"
            :label="i18ns.t('authCenterClient.secret')"
            width="180"
          >
            <template #default="{ row }">
              {{ row.clientSecretPreview || i18ns.t('authCenterClient.noSecret') }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('authCenterClient.pkceRequired')" width="130">
            <template #default="{ row }">
              <el-tag size="small" :type="row.isPkceRequired ? 'success' : 'info'">
                {{ row.isPkceRequired ? i18ns.t('yes') : i18ns.t('no') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            prop="lastUsedAt"
            :label="i18ns.t('authCenterClient.lastUsed')"
            width="180"
          >
            <template #default="{ row }">
              {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="320" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button link type="primary" @click="openEditDialog(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
                <el-button
                  v-if="canSubmitReview(row.reviewStatus)"
                  link
                  type="success"
                  @click="handleSubmitReview(row)"
                >
                  {{ i18ns.t('authCenterClient.submitReview') }}
                </el-button>
                <el-button
                  v-if="row.hasClientSecret"
                  link
                  type="warning"
                  @click="handleRegenerateSecret(row)"
                >
                  {{ i18ns.t('authCenterClient.regenerateSecret') }}
                </el-button>
                <el-button link type="danger" @click="handleDelete(row)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <div v-else class="mobile-page">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('authCenterClient.management') }}</span>
            <div class="button-group">
              <el-button :icon="Refresh" :loading="loading" @click="loadClients">
                {{ i18ns.t('refresh') }}
              </el-button>
              <el-button type="primary" @click="openCreateDialog">
                {{ i18ns.t('authCenterClient.create') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-skeleton :loading="loading" animated :rows="4">
          <div v-if="clients.length" class="list">
            <el-card v-for="row in clients" :key="row.id" class="item mobile-card" shadow="never">
              <div class="name-row">
                <div class="name">{{ row.name }}</div>
                <el-tag size="small">{{ getClientTypeLabel(row.clientType) }}</el-tag>
              </div>
              <div class="status-row">
                <el-tag
                  size="small"
                  :type="getReviewStatusTagType(row.reviewStatus)"
                  effect="light"
                >
                  {{ getReviewStatusLabel(row.reviewStatus) }}
                </el-tag>
              </div>
              <div class="mono small-text">{{ row.clientId }}</div>
              <div class="stack compact-list mobile-tags">
                <el-tag
                  v-for="grantType in row.grantTypes"
                  :key="grantType"
                  size="small"
                  effect="plain"
                >
                  {{ getGrantTypeLabel(grantType) }}
                </el-tag>
              </div>
              <div class="meta">
                <div>
                  {{ i18ns.t('authCenterClient.redirectUriCount') }}: {{ row.redirectUris.length }}
                </div>
                <div>{{ i18ns.t('authCenterClient.scopeCount') }}: {{ row.scopes.length }}</div>
                <div>
                  {{ i18ns.t('authCenterClient.accessTokenLifetime') }}:
                  {{ formatLifetime(row.accessTokenLifetime) }}
                </div>
                <div>
                  {{ i18ns.t('authCenterClient.refreshTokenLifetime') }}:
                  {{ formatLifetime(row.refreshTokenLifetime) }}
                </div>
                <div>
                  {{ i18ns.t('authCenterClient.pkceRequired') }}:
                  {{ row.isPkceRequired ? i18ns.t('yes') : i18ns.t('no') }}
                </div>
                <div>
                  {{ i18ns.t('authCenterClient.lastUsed') }}:
                  {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '-' }}
                </div>
                <div v-if="row.submittedAt">
                  {{ i18ns.t('authCenterClient.submittedAt') }}:
                  {{ new Date(row.submittedAt).toLocaleString() }}
                </div>
                <div v-if="row.reviewComment">
                  {{ i18ns.t('authCenterClient.reviewComment') }}: {{ row.reviewComment }}
                </div>
              </div>
              <div class="mobile-actions">
                <el-button link type="primary" @click="openEditDialog(row)">{{
                  i18ns.t('edit')
                }}</el-button>
                <el-button
                  v-if="canSubmitReview(row.reviewStatus)"
                  link
                  type="success"
                  @click="handleSubmitReview(row)"
                >
                  {{ i18ns.t('authCenterClient.submitReview') }}
                </el-button>
                <el-button
                  v-if="row.hasClientSecret"
                  link
                  type="warning"
                  @click="handleRegenerateSecret(row)"
                >
                  {{ i18ns.t('authCenterClient.regenerateSecret') }}
                </el-button>
                <el-button link type="danger" @click="handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </div>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>
      </el-card>
    </div>

    <el-dialog
      v-model="showFormDialog"
      :title="isEditing ? i18ns.t('authCenterClient.edit') : i18ns.t('authCenterClient.create')"
      :width="isDesktop ? '58%' : '96%'"
      class="auth-center-client-form-dialog"
    >
      <el-form
        :model="form"
        :label-width="isDesktop ? '170px' : undefined"
        :label-position="isDesktop ? 'right' : 'top'"
        class="auth-center-client-form"
      >
        <div class="auth-center-client-form__section">
          <div class="auth-center-client-form__section-title">
            {{ i18ns.t('authCenterClient.basicInfo') }}
          </div>
          <div class="auth-center-client-form__grid auth-center-client-form__grid--basic">
            <el-form-item :label="i18ns.t('authCenterClient.name')">
              <el-input
                v-model="form.name"
                :placeholder="i18ns.t('authCenterClient.namePlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('authCenterClient.clientType')">
              <el-radio-group v-model="form.clientType">
                <el-radio value="confidential">{{
                  i18ns.t('authCenterClient.type.confidential')
                }}</el-radio>
                <el-radio value="public">{{ i18ns.t('authCenterClient.type.public') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              :label="i18ns.t('authCenterClient.description')"
              class="auth-center-client-form__span-full"
            >
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="5"
                :placeholder="i18ns.t('authCenterClient.descriptionPlaceholder')"
              />
            </el-form-item>
          </div>
        </div>

        <div class="auth-center-client-form__section">
          <div class="auth-center-client-form__section-title">
            {{ i18ns.t('authCenterClient.grantTypes') }}
          </div>
          <div class="auth-center-client-form__section-desc text-secondary">
            {{ i18ns.t('authCenterClient.grantTypesHint') }}
          </div>
          <el-form-item class="auth-center-client-form__block-item">
            <el-checkbox-group v-model="form.grantTypes" class="grant-type-grid">
              <el-checkbox
                v-for="option in grantTypeOptions"
                :key="option.value"
                :value="option.value"
                :disabled="option.disabled"
                border
                class="grant-type-card"
              >
                <div class="grant-type-card__content">
                  <div class="grant-type-card__label-row">
                    <code>{{ option.value }}</code>
                    <span class="grant-type-card__title">{{ option.label }}</span>
                  </div>
                  <div class="small-text text-secondary">{{ option.description }}</div>
                  <div v-if="option.note" class="small-text text-secondary grant-type-card__note">
                    {{ option.note }}
                  </div>
                </div>
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </div>

        <div class="auth-center-client-form__section">
          <div class="auth-center-client-form__section-title">
            {{ i18ns.t('authCenterClient.redirectUris') }}
          </div>
          <div class="auth-center-client-form__section-desc text-secondary">
            {{ i18ns.t('authCenterClient.redirectUrisHint') }}
          </div>
          <el-form-item
            class="auth-center-client-form__block-item auth-center-client-form__block-item--plain"
          >
            <div class="redirect-table">
              <div class="redirect-table__header">
                <span>{{ i18ns.t('authCenterClient.redirectUriListTitle') }}</span>
                <el-button type="primary" link @click="addRedirectUriRow">
                  + {{ i18ns.t('authCenterClient.addRedirectUri') }}
                </el-button>
              </div>
              <div class="redirect-table__body">
                <div
                  v-for="(uri, index) in form.redirectUris"
                  :key="index"
                  class="redirect-table__row"
                >
                  <div class="redirect-table__index">{{ index + 1 }}</div>
                  <el-input
                    v-model="form.redirectUris[index]"
                    class="redirect-table__input"
                    :placeholder="i18ns.t('authCenterClient.redirectUrisPlaceholder')"
                  />
                  <el-button
                    type="danger"
                    link
                    class="redirect-table__remove"
                    @click="removeRedirectUriRow(index)"
                  >
                    {{ i18ns.t('delete') }}
                  </el-button>
                </div>
                <div v-if="!form.redirectUris.length" class="redirect-table__empty text-secondary">
                  {{ i18ns.t('authCenterClient.redirectUrisEmpty') }}
                </div>
              </div>
            </div>
          </el-form-item>
        </div>

        <div class="auth-center-client-form__section">
          <div class="auth-center-client-form__section-title">
            {{ i18ns.t('authCenterClient.tokenSettings') }}
          </div>
          <div class="auth-center-client-form__grid">
            <el-form-item :label="i18ns.t('authCenterClient.accessTokenLifetime')">
              <el-input-number
                v-model="form.accessTokenLifetime"
                :min="60"
                :max="86400"
                :step="60"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('authCenterClient.refreshTokenLifetime')">
              <el-input-number
                v-model="form.refreshTokenLifetime"
                :min="300"
                :max="31536000"
                :step="300"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('authCenterClient.pkceRequired')">
              <el-switch v-model="form.isPkceRequired" :disabled="isPkceLocked" />
            </el-form-item>
            <div
              class="small-text text-secondary auth-center-client-form__hint-card auth-center-client-form__span-full"
            >
              {{ i18ns.t('authCenterClient.tokenSettingsHint') }}
            </div>
          </div>
        </div>

        <div class="auth-center-client-form__section">
          <div class="auth-center-client-form__section-title">
            {{ i18ns.t('authCenterClient.scopes') }}
          </div>
          <el-form-item
            class="auth-center-client-form__block-item auth-center-client-form__block-item--plain"
          >
            <div class="auth-center-scope-selector">
              <el-checkbox-group v-model="form.scopes" class="auth-center-scope-selector__grid">
                <el-checkbox
                  v-for="option in scopeOptions"
                  :key="option.value"
                  :value="option.value"
                  border
                  class="auth-center-scope-selector__item"
                >
                  <div class="auth-center-scope-selector__content">
                    <div class="auth-center-scope-selector__label-row">
                      <code>{{ option.value }}</code>
                      <span class="auth-center-scope-selector__title">{{ option.label }}</span>
                    </div>
                    <div class="small-text text-secondary">{{ option.description }}</div>
                  </div>
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>
          <div class="small-text text-secondary auth-center-client-form__section-desc">
            {{ i18ns.t('authCenterClient.scopePickerHint') }}
          </div>
        </div>

        <div class="auth-center-client-form__section">
          <div class="auth-center-client-form__section-title">
            {{ i18ns.t('authCenterClient.integrationMetadata') }}
          </div>
          <div class="auth-center-client-form__grid">
            <el-form-item :label="i18ns.t('authCenterClient.homepageUrl')">
              <el-input
                v-model="form.homepageUrl"
                :placeholder="i18ns.t('authCenterClient.urlPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('authCenterClient.logoUrl')">
              <el-input
                v-model="form.logoUrl"
                :placeholder="i18ns.t('authCenterClient.urlPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('authCenterClient.policyUrl')">
              <el-input
                v-model="form.policyUrl"
                :placeholder="i18ns.t('authCenterClient.urlPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('authCenterClient.tosUrl')">
              <el-input
                v-model="form.tosUrl"
                :placeholder="i18ns.t('authCenterClient.urlPlaceholder')"
              />
            </el-form-item>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showFormDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ i18ns.t('confirm') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showSecretDialog"
      :close-on-click-modal="false"
      :title="i18ns.t('authCenterClient.secretDialogTitle')"
      :width="isDesktop ? '640px' : '96%'"
    >
      <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
        {{ i18ns.t('authCenterClient.secretWarning') }}
      </el-alert>
      <el-input v-if="isDesktop" v-model="createdSecret" readonly>
        <template #append>
          <el-button type="primary" @click="copyCreatedSecret">{{ i18ns.t('copy') }}</el-button>
        </template>
      </el-input>
      <el-input v-else v-model="createdSecret" readonly type="textarea" :rows="3" />
      <template #footer>
        <el-button v-if="!isDesktop" @click="copyCreatedSecret">{{ i18ns.t('copy') }}</el-button>
        <el-button type="primary" @click="showSecretDialog = false">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { useI18n } from 'vue-i18n'
import { usePageDevice } from '@/composables/usePageDevice'
import { AuthCenterClientService } from '@/service/authCenterClientService'
import type {
  AuthCenterClientDto,
  AuthCenterClientReviewStatus,
  AuthCenterGrantType,
  CreateAuthCenterClientDto,
  UpdateAuthCenterClientDto,
} from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'

const { isDesktop } = usePageDevice()
const { t } = useI18n()
const authCenterClientService = AuthCenterClientService.getInstance()

const clients = ref<AuthCenterClientDto[]>([])
const loading = ref(false)
const submitting = ref(false)
const showFormDialog = ref(false)
const showSecretDialog = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const createdSecret = ref('')

const createEmptyForm = () => ({
  name: '',
  description: '',
  clientType: 'confidential' as 'confidential' | 'public',
  grantTypes: [
    'authorization_code',
    'refresh_token',
    'client_credentials',
  ] as AuthCenterGrantType[],
  redirectUris: [] as string[],
  scopes: ['profile'],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 2592000,
  homepageUrl: '',
  logoUrl: '',
  policyUrl: '',
  tosUrl: '',
})

const form = ref(createEmptyForm())

const isPkceLocked = computed(
  () => form.value.clientType === 'public' && form.value.grantTypes.includes('authorization_code'),
)

const grantTypeOptions = computed(() => [
  {
    value: 'authorization_code' as const,
    label: i18ns.t('authCenterClient.grantTypeLabels.authorization_code'),
    description: i18ns.t('authCenterClient.grantTypeDescriptions.authorization_code'),
    note: i18ns.t('authCenterClient.grantTypeNotes.authorization_code'),
    disabled: false,
  },
  {
    value: 'refresh_token' as const,
    label: i18ns.t('authCenterClient.grantTypeLabels.refresh_token'),
    description: i18ns.t('authCenterClient.grantTypeDescriptions.refresh_token'),
    note: i18ns.t('authCenterClient.grantTypeNotes.refresh_token'),
    disabled: false,
  },
  {
    value: 'client_credentials' as const,
    label: i18ns.t('authCenterClient.grantTypeLabels.client_credentials'),
    description: i18ns.t('authCenterClient.grantTypeDescriptions.client_credentials'),
    note: i18ns.t('authCenterClient.grantTypeNotes.client_credentials'),
    disabled: form.value.clientType === 'public',
  },
])

const scopeOptions = computed(() => [
  {
    value: 'profile',
    label: i18ns.t('authCenterClient.scopeOptionTitles.profile'),
    description: i18ns.t('authCenterClient.scopeDescriptions.profile'),
  },
])

const grantTypeRows = computed(() =>
  grantTypeOptions.value.map((item) => ({
    grantType: item.value,
    description: item.description,
    tokenBehavior: i18ns.t(`authCenterClient.tokenBehavior.${item.value}`),
    notes: item.note,
  })),
)

const getReviewStatusLabel = (status: AuthCenterClientReviewStatus) =>
  i18ns.t(`authCenterClient.reviewStatuses.${status}`)

const getReviewStatusTagType = (status: AuthCenterClientReviewStatus) => {
  switch (status) {
    case 'approved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'info'
  }
}

const canSubmitReview = (status: AuthCenterClientReviewStatus) =>
  status === 'draft' || status === 'rejected'

const getClientTypeLabel = (clientType: AuthCenterClientDto['clientType']) =>
  clientType === 'public'
    ? i18ns.t('authCenterClient.type.public')
    : i18ns.t('authCenterClient.type.confidential')

const getGrantTypeLabel = (grantType: AuthCenterGrantType) =>
  i18ns.t(`authCenterClient.grantTypeLabels.${grantType}`)

const normalizeStringArray = (value: string[]) => value.map((item) => item.trim()).filter(Boolean)

const normalizeOptionalString = (value: string) => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const formatLifetime = (seconds: number) => `${seconds}s`

const syncClientTypeRules = () => {
  if (form.value.clientType === 'public') {
    const filteredGrantTypes = form.value.grantTypes.filter((item) => item !== 'client_credentials')
    if (filteredGrantTypes.length !== form.value.grantTypes.length) {
      form.value.grantTypes = filteredGrantTypes
    }
  }

  if (
    form.value.clientType === 'public' &&
    form.value.grantTypes.includes('authorization_code') &&
    !form.value.isPkceRequired
  ) {
    form.value.isPkceRequired = true
  }
}

watch(
  () => [form.value.clientType, [...form.value.grantTypes].sort().join(',')],
  () => {
    syncClientTypeRules()
  },
)

const loadClients = async () => {
  loading.value = true
  try {
    const res = await authCenterClientService.getAuthCenterClients()
    clients.value = res.data
  } catch (error) {
    ElMessage.error(t('authCenterClient.loadFailed'))
    throw error
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  form.value = createEmptyForm()
  editingId.value = ''
  isEditing.value = false
}

const openCreateDialog = () => {
  resetForm()
  addRedirectUriRow()
  syncClientTypeRules()
  showFormDialog.value = true
}

const openEditDialog = (row: AuthCenterClientDto) => {
  isEditing.value = true
  editingId.value = row.id
  form.value = {
    name: row.name,
    description: row.description || '',
    clientType: row.clientType,
    grantTypes: [...row.grantTypes],
    redirectUris: [...row.redirectUris],
    scopes: [...(row.scopes || [])],
    isPkceRequired: row.isPkceRequired,
    accessTokenLifetime: row.accessTokenLifetime,
    refreshTokenLifetime: row.refreshTokenLifetime,
    homepageUrl: row.homepageUrl || '',
    logoUrl: row.logoUrl || '',
    policyUrl: row.policyUrl || '',
    tosUrl: row.tosUrl || '',
  }
  syncClientTypeRules()
  showFormDialog.value = true
}

const addRedirectUriRow = () => {
  form.value.redirectUris.push('')
}

const removeRedirectUriRow = (index: number) => {
  form.value.redirectUris.splice(index, 1)
}

const buildCreatePayload = (): CreateAuthCenterClientDto => ({
  name: form.value.name.trim(),
  description: form.value.description.trim() || undefined,
  clientType: form.value.clientType,
  grantTypes: [...form.value.grantTypes],
  redirectUris: normalizeStringArray(form.value.redirectUris),
  scopes: [...form.value.scopes],
  isPkceRequired: form.value.isPkceRequired,
  accessTokenLifetime: form.value.accessTokenLifetime,
  refreshTokenLifetime: form.value.refreshTokenLifetime,
  homepageUrl: form.value.homepageUrl.trim() || undefined,
  logoUrl: form.value.logoUrl.trim() || undefined,
  policyUrl: form.value.policyUrl.trim() || undefined,
  tosUrl: form.value.tosUrl.trim() || undefined,
})

const buildUpdatePayload = (): UpdateAuthCenterClientDto => ({
  name: form.value.name.trim() || undefined,
  description: normalizeOptionalString(form.value.description),
  clientType: form.value.clientType,
  grantTypes: [...form.value.grantTypes],
  redirectUris: normalizeStringArray(form.value.redirectUris),
  scopes: [...form.value.scopes],
  isPkceRequired: form.value.isPkceRequired,
  accessTokenLifetime: form.value.accessTokenLifetime,
  refreshTokenLifetime: form.value.refreshTokenLifetime,
  homepageUrl: normalizeOptionalString(form.value.homepageUrl),
  logoUrl: normalizeOptionalString(form.value.logoUrl),
  policyUrl: normalizeOptionalString(form.value.policyUrl),
  tosUrl: normalizeOptionalString(form.value.tosUrl),
})

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    ElMessage.warning(t('authCenterClient.nameRequired'))
    return
  }

  if (!form.value.grantTypes.length) {
    ElMessage.warning(t('authCenterClient.grantTypesRequired'))
    return
  }

  if (!form.value.scopes.length) {
    ElMessage.warning(t('authCenterClient.scopesRequired'))
    return
  }

  if (
    form.value.grantTypes.includes('refresh_token') &&
    !form.value.grantTypes.includes('authorization_code')
  ) {
    ElMessage.warning(t('authCenterClient.refreshRequiresAuthorizationCode'))
    return
  }

  if (
    form.value.grantTypes.includes('authorization_code') &&
    !normalizeStringArray(form.value.redirectUris).length
  ) {
    ElMessage.warning(t('authCenterClient.redirectUrisRequired'))
    return
  }

  if (form.value.clientType === 'public' && form.value.grantTypes.includes('client_credentials')) {
    ElMessage.warning(t('authCenterClient.publicClientCredentialsNotAllowed'))
    return
  }

  if (form.value.refreshTokenLifetime < form.value.accessTokenLifetime) {
    ElMessage.warning(t('authCenterClient.refreshLifetimeTooShort'))
    return
  }

  try {
    submitting.value = true
    if (isEditing.value) {
      await authCenterClientService.updateAuthCenterClient(editingId.value, buildUpdatePayload())
      ElMessage.success(t('updateSuccess'))
    } else {
      const res = await authCenterClientService.createAuthCenterClient(buildCreatePayload())
      const secret = res?.data?.clientSecret
      if (secret) {
        createdSecret.value = secret
        showSecretDialog.value = true
      }
      ElMessage.success(t('createSuccess'))
    }
    showFormDialog.value = false
    resetForm()
    await loadClients()
  } catch (error: any) {
    if (error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    ElMessage.error(
      t(isEditing.value ? 'authCenterClient.updateFailed' : 'authCenterClient.createFailed'),
    )
    throw error
  } finally {
    submitting.value = false
  }
}

const handleRegenerateSecret = async (row: AuthCenterClientDto) => {
  try {
    await ElMessageBox.confirm(
      t('authCenterClient.regenerateSecretConfirm', { name: row.name }),
      t('authCenterClient.regenerateSecret'),
      { type: 'warning' },
    )
    const res = await authCenterClientService.regenerateSecret(row.id)
    createdSecret.value = res?.data?.clientSecret || ''
    showSecretDialog.value = true
    ElMessage.success(t('authCenterClient.regenerateSecretSuccess'))
    await loadClients()
  } catch (error: any) {
    if (error === 'cancel' || error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    ElMessage.error(t('authCenterClient.regenerateSecretFailed'))
  }
}

const handleDelete = async (row: AuthCenterClientDto) => {
  try {
    await ElMessageBox.confirm(
      t('authCenterClient.confirmDelete', { name: row.name }),
      t('confirmDialog.warning'),
      { type: 'warning' },
    )
    await authCenterClientService.deleteAuthCenterClient(row.id)
    ElMessage.success(t('deleteSuccess'))
    await loadClients()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('authCenterClient.deleteFailed'))
    }
  }
}

const handleSubmitReview = async (row: AuthCenterClientDto) => {
  try {
    await ElMessageBox.confirm(
      t('authCenterClient.submitReviewConfirm', { name: row.name }),
      t('confirmDialog.warning'),
      { type: 'warning' },
    )
    await authCenterClientService.submitReview(row.id)
    ElMessage.success(t('authCenterClient.submitReviewSuccess'))
    await loadClients()
  } catch (error: any) {
    if (error === 'cancel' || error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    ElMessage.error(t('authCenterClient.submitReviewFailed'))
  }
}

const copyCreatedSecret = async () => {
  try {
    await navigator.clipboard.writeText(createdSecret.value)
    ElMessage.success(t('copySuccess'))
  } catch {
    ElMessage.error(t('copyFailed'))
  }
}

onMounted(() => {
  void loadClients()
})
</script>

<style scoped>
.auth-center-reference {
  margin-bottom: 16px;
}

.auth-center-reference__intro {
  margin: 0 0 12px;
}

.auth-center-reference__table-wrapper {
  overflow-x: auto;
}

.auth-center-reference code,
.grant-type-card code {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

.auth-center-client-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-center-client-form__section {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-fill-color-light);
}

.auth-center-client-form__section-title {
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.auth-center-client-form__section-desc {
  margin: -4px 0 12px;
  font-size: 13px;
  line-height: 1.5;
}

.auth-center-client-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.auth-center-client-form__grid--basic {
  align-items: start;
}

.auth-center-client-form__span-full {
  grid-column: 1 / -1;
}

.auth-center-client-form__block-item {
  margin-bottom: 0;
}

.auth-center-client-form__block-item--plain :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.auth-center-client-form__section :deep(.el-form-item) {
  margin-bottom: 0;
}

.auth-center-client-form__hint-card {
  padding: 12px;
  border-radius: 12px;
  background: var(--el-bg-color);
  line-height: 1.5;
}

.grant-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  width: 100%;
}

.grant-type-card {
  align-items: flex-start;
  height: 100%;
  margin-right: 0;
  padding: 12px 14px;
  white-space: normal;
}

.grant-type-card :deep(.el-checkbox__input) {
  margin-top: 2px;
}

.grant-type-card :deep(.el-checkbox__label) {
  display: block;
  width: 100%;
  padding-left: 10px;
  line-height: 1.5;
  white-space: normal;
}

.grant-type-card__content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.grant-type-card__label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.grant-type-card__title {
  font-weight: 600;
}

.grant-type-card__note {
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.auth-center-scope-selector {
  width: 100%;
}

.auth-center-scope-selector__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.auth-center-scope-selector__item {
  margin-right: 0;
  height: auto;
  padding: 12px 14px;
  align-items: flex-start;
  white-space: normal;
}

.auth-center-scope-selector__item :deep(.el-checkbox__input) {
  margin-top: 2px;
}

.auth-center-scope-selector__item :deep(.el-checkbox__label) {
  display: block;
  width: 100%;
  padding-left: 10px;
  line-height: 1.5;
  white-space: normal;
}

.auth-center-scope-selector__content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.auth-center-scope-selector__label-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.auth-center-scope-selector__title {
  font-weight: 600;
}

.redirect-table {
  width: 100%;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.redirect-table__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
}

.redirect-table__body {
  display: flex;
  flex-direction: column;
}

.redirect-table__row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.redirect-table__row:first-child {
  border-top: none;
}

.redirect-table__index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 700;
}

.redirect-table__input {
  width: 100%;
}

.redirect-table__remove {
  justify-self: end;
}

.redirect-table__empty {
  padding: 16px 14px;
  font-size: 13px;
}

.row-actions,
.mobile-actions,
.mobile-tags,
.stack {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.review-status-cell,
.compact-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-status-cell__comment,
.small-text {
  font-size: 12px;
}

.mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

@media (max-width: 768px) {
  .auth-center-client-form__grid {
    grid-template-columns: 1fr;
  }

  .redirect-table__row {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .redirect-table__remove {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
