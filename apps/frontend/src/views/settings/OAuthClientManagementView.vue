<template>
  <div
    :class="[
      'oauth-client-management-view',
      isDesktop ? 'desktop-page page-shell' : 'oauth-client-mobile mobile-page',
    ]"
  >
    <el-card :class="['oauth-scope-reference', isDesktop ? 'page-card' : 'mobile-card']">
      <template #header>
        <div class="card-header">
          <span>{{ i18ns.t('oauthClient.scopeReferenceTitle') }}</span>
        </div>
      </template>

      <p class="text-secondary oauth-scope-reference__intro">
        {{ i18ns.t('oauthClient.scopeReferenceDescription') }}
      </p>

      <div class="oauth-scope-reference__table-wrapper">
        <el-table :data="scopeReferenceRows" size="small">
          <el-table-column prop="scope" :label="i18ns.t('oauthClient.scopeColumn')" min-width="140">
            <template #default="{ row }">
              <code>{{ row.scope }}</code>
            </template>
          </el-table-column>
          <el-table-column
            prop="description"
            :label="i18ns.t('oauthClient.scopeDescriptionColumn')"
            min-width="220"
          />
          <el-table-column
            prop="access"
            :label="i18ns.t('oauthClient.scopeAccessColumn')"
            min-width="260"
          />
          <el-table-column
            prop="notes"
            :label="i18ns.t('oauthClient.scopeNotesColumn')"
            min-width="220"
          />
        </el-table>
      </div>
    </el-card>

    <div v-if="isDesktop" class="oauth-client-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('oauthClient.management') }}</span>
            <div class="button-group">
              <el-button :icon="Refresh" :loading="loading" @click="loadClients">
                {{ i18ns.t('refresh') }}
              </el-button>
              <el-button type="primary" @click="openCreateDialog">
                {{ i18ns.t('oauthClient.create') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="clients">
          <el-table-column prop="name" :label="i18ns.t('oauthClient.name')" min-width="180" />
          <el-table-column :label="i18ns.t('oauthClient.reviewStatus')" width="140">
            <template #default="{ row }">
              <div class="review-status-cell">
                <el-tag :type="getReviewStatusTagType(row.reviewStatus)" effect="light">
                  {{ getReviewStatusLabel(row.reviewStatus) }}
                </el-tag>
                <div v-if="row.reviewComment" class="review-status-cell__comment text-secondary">
                  {{ i18ns.t('oauthClient.reviewComment') }}: {{ row.reviewComment }}
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="clientId"
            :label="i18ns.t('oauthClient.clientId')"
            min-width="220"
          />
          <el-table-column prop="clientType" :label="i18ns.t('oauthClient.clientType')" width="120">
            <template #default="{ row }">
              {{ getClientTypeLabel(row.clientType) }}
            </template>
          </el-table-column>
          <el-table-column
            :label="i18ns.t('oauthClient.redirectUris')"
            min-width="260"
            class-name="oauth-client-table__redirect-column"
          >
            <template #default="{ row }">
              <div class="stack compact-list">
                <div v-for="uri in row.redirectUris.slice(0, 2)" :key="uri" class="mono small-text">
                  {{ uri }}
                </div>
                <div v-if="row.redirectUris.length > 2" class="small-text text-secondary">
                  {{ i18ns.t('oauthClient.moreItems', { count: row.redirectUris.length - 2 }) }}
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="clientSecretPreview"
            :label="i18ns.t('oauthClient.secret')"
            width="180"
          >
            <template #default="{ row }">
              {{ row.clientSecretPreview || i18ns.t('oauthClient.noSecret') }}
            </template>
          </el-table-column>
          <el-table-column prop="lastUsedAt" :label="i18ns.t('oauthClient.lastUsed')" width="180">
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
                  {{ i18ns.t('oauthClient.submitReview') }}
                </el-button>
                <el-button
                  v-if="row.hasClientSecret"
                  link
                  type="warning"
                  @click="handleRegenerateSecret(row)"
                >
                  {{ i18ns.t('oauthClient.regenerateSecret') }}
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

    <div v-else class="oauth-client-management">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('oauthClient.management') }}</span>
            <div class="button-group">
              <el-button :icon="Refresh" :loading="loading" @click="loadClients">
                {{ i18ns.t('refresh') }}
              </el-button>
              <el-button type="primary" @click="openCreateDialog">
                {{ i18ns.t('oauthClient.create') }}
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
              <div class="meta">
                <div>
                  {{ i18ns.t('oauthClient.redirectUriCount') }}: {{ row.redirectUris.length }}
                </div>
                <div>{{ i18ns.t('oauthClient.scopeCount') }}: {{ row.scopes.length }}</div>
                <div>
                  {{ i18ns.t('oauthClient.lastUsed') }}:
                  {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '-' }}
                </div>
                <div v-if="row.submittedAt">
                  {{ i18ns.t('oauthClient.submittedAt') }}:
                  {{ new Date(row.submittedAt).toLocaleString() }}
                </div>
                <div v-if="row.reviewComment">
                  {{ i18ns.t('oauthClient.reviewComment') }}: {{ row.reviewComment }}
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
                  {{ i18ns.t('oauthClient.submitReview') }}
                </el-button>
                <el-button
                  v-if="row.hasClientSecret"
                  link
                  type="warning"
                  @click="handleRegenerateSecret(row)"
                >
                  {{ i18ns.t('oauthClient.regenerateSecret') }}
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
      :title="isEditing ? i18ns.t('oauthClient.edit') : i18ns.t('oauthClient.create')"
      :width="isDesktop ? '50%' : '96%'"
      class="oauth-client-form-dialog"
    >
      <el-form
        :model="form"
        :label-width="isDesktop ? '160px' : undefined"
        :label-position="isDesktop ? 'right' : 'top'"
        class="oauth-client-form"
      >
        <div class="oauth-client-form__section">
          <div class="oauth-client-form__section-title">{{ i18ns.t('oauthClient.name') }}</div>
          <div class="oauth-client-form__grid oauth-client-form__grid--basic">
            <el-form-item :label="i18ns.t('oauthClient.name')">
              <el-input v-model="form.name" :placeholder="i18ns.t('oauthClient.namePlaceholder')" />
            </el-form-item>
            <el-form-item :label="i18ns.t('oauthClient.clientType')">
              <el-radio-group v-model="form.clientType" :disabled="isEditing">
                <el-radio value="confidential">{{
                  i18ns.t('oauthClient.type.confidential')
                }}</el-radio>
                <el-radio value="public">{{ i18ns.t('oauthClient.type.public') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              :label="i18ns.t('oauthClient.description')"
              class="oauth-client-form__span-full"
            >
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="6"
                :placeholder="i18ns.t('oauthClient.descriptionPlaceholder')"
              />
            </el-form-item>
          </div>
        </div>

        <div class="oauth-client-form__section">
          <div class="oauth-client-form__section-title">
            {{ i18ns.t('oauthClient.redirectUris') }}
          </div>
          <div class="oauth-client-form__section-desc text-secondary">
            {{ i18ns.t('oauthClient.redirectUrisHint') }}
          </div>
          <el-form-item class="oauth-client-form__block-item oauth-client-form__block-item--plain">
            <div class="oauth-redirect-table">
              <div class="oauth-redirect-table__header">
                <span>{{ i18ns.t('oauthClient.redirectUriListTitle') }}</span>
                <el-button type="primary" link @click="addRedirectUriRow">
                  + {{ i18ns.t('oauthClient.addRedirectUri') }}
                </el-button>
              </div>
              <div class="oauth-redirect-table__body">
                <div
                  v-for="(uri, index) in form.redirectUris"
                  :key="index"
                  class="oauth-redirect-table__row"
                >
                  <div class="oauth-redirect-table__index">{{ index + 1 }}</div>
                  <el-input
                    v-model="form.redirectUris[index]"
                    class="oauth-redirect-table__input"
                    :placeholder="i18ns.t('oauthClient.redirectUrisPlaceholder')"
                  />
                  <el-button
                    type="danger"
                    link
                    class="oauth-redirect-table__remove"
                    @click="removeRedirectUriRow(index)"
                  >
                    {{ i18ns.t('delete') }}
                  </el-button>
                </div>
                <div
                  v-if="!form.redirectUris.length"
                  class="oauth-redirect-table__empty text-secondary"
                >
                  {{ i18ns.t('oauthClient.redirectUrisEmpty') }}
                </div>
              </div>
            </div>
          </el-form-item>
        </div>

        <div class="oauth-client-form__section">
          <div class="oauth-client-form__section-title">{{ i18ns.t('oauthClient.scopes') }}</div>
          <el-form-item
            :label="i18ns.t('oauthClient.scopes')"
            class="oauth-client-form__block-item"
          >
            <div class="oauth-scope-selector">
              <el-checkbox-group v-model="form.scopes" class="oauth-scope-selector__grid">
                <el-checkbox
                  v-for="scope in scopeOptions"
                  :key="scope.value"
                  :value="scope.value"
                  border
                  :class="[
                    'oauth-scope-selector__item',
                    { 'oauth-scope-selector__item--warning': scope.sensitive },
                  ]"
                >
                  <div class="oauth-scope-selector__content">
                    <div class="oauth-scope-selector__label-row">
                      <code>{{ scope.value }}</code>
                      <span class="oauth-scope-selector__title">{{ scope.label }}</span>
                    </div>
                    <div class="small-text text-secondary">{{ scope.description }}</div>
                    <el-alert
                      v-if="scope.sensitive"
                      type="warning"
                      :closable="false"
                      show-icon
                      class="oauth-scope-selector__warning"
                    >
                      {{ i18ns.t('oauthClient.scopeSensitiveHint') }}
                    </el-alert>
                  </div>
                </el-checkbox>
              </el-checkbox-group>
              <div class="small-text text-secondary oauth-scope-selector__hint">
                {{ i18ns.t('oauthClient.scopePickerHint') }}
              </div>
            </div>
          </el-form-item>
        </div>

        <div class="oauth-client-form__section">
          <div class="oauth-client-form__section-title">
            {{ i18ns.t('oauthClient.homepageUrl') }}
          </div>
          <div class="oauth-client-form__grid">
            <el-form-item :label="i18ns.t('oauthClient.homepageUrl')">
              <el-input
                v-model="form.homepageUrl"
                :placeholder="i18ns.t('oauthClient.urlPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('oauthClient.logoUrl')">
              <el-input
                v-model="form.logoUrl"
                :placeholder="i18ns.t('oauthClient.urlPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('oauthClient.policyUrl')">
              <el-input
                v-model="form.policyUrl"
                :placeholder="i18ns.t('oauthClient.urlPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('oauthClient.tosUrl')">
              <el-input
                v-model="form.tosUrl"
                :placeholder="i18ns.t('oauthClient.urlPlaceholder')"
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
      :title="i18ns.t('oauthClient.secretDialogTitle')"
      :width="isDesktop ? '640px' : '96%'"
    >
      <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
        {{ i18ns.t('oauthClient.secretWarning') }}
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
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { useI18n } from 'vue-i18n'
import { usePageDevice } from '@/composables/usePageDevice'
import { OAuthClientService } from '@/service/oauthClientService'
import type {
  CreateOAuthClientDto,
  OAuthClientDto,
  OAuthClientReviewStatus,
  UpdateOAuthClientDto,
} from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'

const { isDesktop } = usePageDevice()
const { t } = useI18n()
const oauthClientService = OAuthClientService.getInstance()

const clients = ref<OAuthClientDto[]>([])
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
  redirectUris: [] as string[],
  scopes: ['profile'],
  homepageUrl: '',
  logoUrl: '',
  policyUrl: '',
  tosUrl: '',
})

const form = ref(createEmptyForm())

const getReviewStatusLabel = (status: OAuthClientReviewStatus) =>
  i18ns.t(`oauthClient.reviewStatuses.${status}`)

const getReviewStatusTagType = (status: OAuthClientReviewStatus) => {
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

const canSubmitReview = (status: OAuthClientReviewStatus) =>
  status === 'draft' || status === 'rejected'

const getClientTypeLabel = (clientType: OAuthClientDto['clientType']) =>
  clientType === 'public'
    ? i18ns.t('oauthClient.type.public')
    : i18ns.t('oauthClient.type.confidential')

const scopeOptions = computed(() => [
  {
    value: 'profile',
    label: i18ns.t('oauthClient.scopeOptionTitles.profile'),
    description: i18ns.t('oauthClient.scopeDescriptions.profile'),
  },
  {
    value: 'email',
    label: i18ns.t('oauthClient.scopeOptionTitles.email'),
    description: i18ns.t('oauthClient.scopeDescriptions.email'),
    sensitive: true,
  },
  {
    value: 'notification',
    label: i18ns.t('oauthClient.scopeOptionTitles.notification'),
    description: i18ns.t('oauthClient.scopeDescriptions.notification'),
  },
  {
    value: 'oauth_client',
    label: i18ns.t('oauthClient.scopeOptionTitles.oauthClient'),
    description: i18ns.t('oauthClient.scopeDescriptions.oauthClient'),
    sensitive: true,
  },
  {
    value: 'accesskey',
    label: i18ns.t('oauthClient.scopeOptionTitles.accesskey'),
    description: i18ns.t('oauthClient.scopeDescriptions.accesskey'),
    sensitive: true,
  },
  {
    value: 'passkey',
    label: i18ns.t('oauthClient.scopeOptionTitles.passkey'),
    description: i18ns.t('oauthClient.scopeDescriptions.passkey'),
    sensitive: true,
  },
  {
    value: 'two_factor',
    label: i18ns.t('oauthClient.scopeOptionTitles.twoFactor'),
    description: i18ns.t('oauthClient.scopeDescriptions.twoFactor'),
    sensitive: true,
  },
])

const scopeReferenceRows = computed(() => [
  {
    scope: 'profile',
    description: i18ns.t('oauthClient.scopeDescriptions.profile'),
    access: i18ns.t('oauthClient.scopeAccess.profile'),
    notes: i18ns.t('oauthClient.scopeNotes.profile'),
  },
  {
    scope: 'email',
    description: i18ns.t('oauthClient.scopeDescriptions.email'),
    access: i18ns.t('oauthClient.scopeAccess.email'),
    notes: i18ns.t('oauthClient.scopeNotes.email'),
  },
  {
    scope: 'notification',
    description: i18ns.t('oauthClient.scopeDescriptions.notification'),
    access: i18ns.t('oauthClient.scopeAccess.notification'),
    notes: i18ns.t('oauthClient.scopeNotes.notification'),
  },
  {
    scope: 'oauth_client',
    description: i18ns.t('oauthClient.scopeDescriptions.oauthClient'),
    access: i18ns.t('oauthClient.scopeAccess.oauthClient'),
    notes: i18ns.t('oauthClient.scopeNotes.oauthClient'),
  },
  {
    scope: 'accesskey',
    description: i18ns.t('oauthClient.scopeDescriptions.accesskey'),
    access: i18ns.t('oauthClient.scopeAccess.accesskey'),
    notes: i18ns.t('oauthClient.scopeNotes.accesskey'),
  },
  {
    scope: 'passkey',
    description: i18ns.t('oauthClient.scopeDescriptions.passkey'),
    access: i18ns.t('oauthClient.scopeAccess.passkey'),
    notes: i18ns.t('oauthClient.scopeNotes.passkey'),
  },
  {
    scope: 'two_factor',
    description: i18ns.t('oauthClient.scopeDescriptions.twoFactor'),
    access: i18ns.t('oauthClient.scopeAccess.twoFactor'),
    notes: i18ns.t('oauthClient.scopeNotes.twoFactor'),
  },
])

const normalizeStringArray = (value: string[]) => value.map((item) => item.trim()).filter(Boolean)

const normalizeOptionalString = (value: string) => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const loadClients = async () => {
  loading.value = true
  try {
    const res = await oauthClientService.getOAuthClients()
    clients.value = res.data
  } catch (error) {
    ElMessage.error(t('oauthClient.loadFailed'))
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
  showFormDialog.value = true
}

const openEditDialog = (row: OAuthClientDto) => {
  isEditing.value = true
  editingId.value = row.id
  form.value = {
    name: row.name,
    description: row.description || '',
    clientType: row.clientType,
    redirectUris: [...row.redirectUris],
    scopes: [...(row.scopes || [])],
    homepageUrl: row.homepageUrl || '',
    logoUrl: row.logoUrl || '',
    policyUrl: row.policyUrl || '',
    tosUrl: row.tosUrl || '',
  }
  showFormDialog.value = true
}

const addRedirectUriRow = () => {
  form.value.redirectUris.push('')
}

const removeRedirectUriRow = (index: number) => {
  form.value.redirectUris.splice(index, 1)
}

const buildCreatePayload = (): CreateOAuthClientDto => ({
  name: form.value.name.trim(),
  description: form.value.description.trim() || undefined,
  clientType: form.value.clientType,
  redirectUris: normalizeStringArray(form.value.redirectUris),
  scopes: [...form.value.scopes],
  homepageUrl: form.value.homepageUrl.trim() || undefined,
  logoUrl: form.value.logoUrl.trim() || undefined,
  policyUrl: form.value.policyUrl.trim() || undefined,
  tosUrl: form.value.tosUrl.trim() || undefined,
})

const buildUpdatePayload = (): UpdateOAuthClientDto => ({
  name: form.value.name.trim() || undefined,
  description: normalizeOptionalString(form.value.description),
  clientType: form.value.clientType,
  redirectUris: normalizeStringArray(form.value.redirectUris),
  scopes: [...form.value.scopes],
  homepageUrl: normalizeOptionalString(form.value.homepageUrl),
  logoUrl: normalizeOptionalString(form.value.logoUrl),
  policyUrl: normalizeOptionalString(form.value.policyUrl),
  tosUrl: normalizeOptionalString(form.value.tosUrl),
})

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    ElMessage.warning(t('oauthClient.nameRequired'))
    return
  }

  if (!normalizeStringArray(form.value.redirectUris).length) {
    ElMessage.warning(t('oauthClient.redirectUrisRequired'))
    return
  }

  if (!form.value.scopes.length) {
    ElMessage.warning(t('oauthClient.scopesRequired'))
    return
  }

  try {
    submitting.value = true
    if (isEditing.value) {
      await oauthClientService.updateOAuthClient(editingId.value, buildUpdatePayload())
      ElMessage.success(t('updateSuccess'))
    } else {
      const res = await oauthClientService.createOAuthClient(buildCreatePayload())
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
    ElMessage.error(t(isEditing.value ? 'oauthClient.updateFailed' : 'oauthClient.createFailed'))
    throw error
  } finally {
    submitting.value = false
  }
}

const handleRegenerateSecret = async (row: OAuthClientDto) => {
  try {
    await ElMessageBox.confirm(
      t('oauthClient.regenerateSecretConfirm', { name: row.name }),
      t('oauthClient.regenerateSecret'),
      { type: 'warning' },
    )
    const res = await oauthClientService.regenerateSecret(row.id)
    createdSecret.value = res?.data?.clientSecret || ''
    showSecretDialog.value = true
    ElMessage.success(t('oauthClient.regenerateSecretSuccess'))
    await loadClients()
  } catch (error: any) {
    if (error === 'cancel' || error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    ElMessage.error(t('oauthClient.regenerateSecretFailed'))
  }
}

const handleDelete = async (row: OAuthClientDto) => {
  try {
    await ElMessageBox.confirm(
      t('oauthClient.confirmDelete', { name: row.name }),
      t('confirmDialog.warning'),
      { type: 'warning' },
    )
    await oauthClientService.deleteOAuthClient(row.id)
    ElMessage.success(t('deleteSuccess'))
    await loadClients()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('oauthClient.deleteFailed'))
    }
  }
}

const handleSubmitReview = async (row: OAuthClientDto) => {
  try {
    await ElMessageBox.confirm(
      t('oauthClient.submitReviewConfirm', { name: row.name }),
      t('confirmDialog.warning'),
      { type: 'warning' },
    )
    await oauthClientService.submitReview(row.id)
    ElMessage.success(t('oauthClient.submitReviewSuccess'))
    await loadClients()
  } catch (error: any) {
    if (error === 'cancel' || error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
    ElMessage.error(t('oauthClient.submitReviewFailed'))
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
.oauth-client-management-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
}

.oauth-client-management {
  width: 100%;
  min-width: 0;
}

.oauth-scope-reference {
  width: 100%;
  min-width: 0;
}

.oauth-scope-reference__intro {
  margin: 0 0 12px;
}

.oauth-scope-reference__table-wrapper {
  overflow-x: auto;
}

.oauth-scope-reference code {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

.oauth-scope-selector {
  width: 100%;
}

.oauth-client-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.oauth-client-form__section {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-fill-color-light);
}

.oauth-client-form__section-title {
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.oauth-client-form__section-desc {
  margin: -4px 0 12px;
  font-size: 13px;
  line-height: 1.5;
}

.oauth-client-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.oauth-client-form__grid--basic {
  align-items: start;
}

.oauth-client-form__span-full {
  grid-column: 1 / -1;
}

.oauth-client-form__block-item {
  margin-bottom: 0;
}

.oauth-client-form__block-item--plain :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.oauth-client-form__section :deep(.el-form-item) {
  margin-bottom: 0;
}

.oauth-redirect-table {
  width: 100%;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.oauth-redirect-table__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
}

.oauth-redirect-table__body {
  display: flex;
  flex-direction: column;
}

.oauth-redirect-table__row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.oauth-redirect-table__row:first-child {
  border-top: none;
}

.oauth-redirect-table__index {
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

.oauth-redirect-table__input {
  width: 100%;
}

.oauth-redirect-table__remove {
  justify-self: end;
}

.oauth-redirect-table__empty {
  padding: 16px 14px;
  font-size: 13px;
}

.oauth-scope-selector__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.oauth-scope-selector__item {
  margin-right: 0;
  height: auto;
  padding: 12px 14px;
  align-items: flex-start;
  white-space: normal;
}

.oauth-scope-selector__item :deep(.el-checkbox__input) {
  margin-top: 2px;
}

.oauth-scope-selector__item :deep(.el-checkbox__label) {
  display: block;
  width: 100%;
  padding-left: 10px;
  line-height: 1.5;
  white-space: normal;
}

.oauth-scope-selector__item--warning {
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}

.oauth-scope-selector__content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.oauth-scope-selector__label-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.oauth-scope-selector__title {
  font-weight: 600;
}

.oauth-scope-selector__hint {
  margin-top: 10px;
}

.oauth-scope-selector__warning {
  margin-top: 4px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.review-status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.review-status-cell__comment {
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
  word-break: break-word;
}

.button-group,
.row-actions,
.mobile-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  border: 1px solid var(--el-border-color-lighter);
}

.name-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.name {
  font-weight: 600;
}

.status-row {
  margin-top: 8px;
}

.meta,
.compact-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.oauth-client-management-view :deep(.oauth-client-table__redirect-column .cell) {
  display: flex;
  align-items: flex-start;
  min-height: 100%;
}

.oauth-client-management-view :deep(.oauth-client-table__redirect-column .compact-list) {
  margin-top: 0;
}

.oauth-client-management-view :deep(.el-table) {
  width: 100%;
}

.oauth-client-management-view :deep(.el-table .cell) {
  word-break: break-word;
}

.mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
  word-break: break-all;
}

.small-text {
  font-size: 12px;
}

.text-secondary {
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .oauth-client-form__section {
    padding: 12px;
    border-radius: 12px;
  }

  .oauth-client-form__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .oauth-redirect-table__row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .oauth-redirect-table__index {
    width: 28px;
    height: 28px;
  }

  .oauth-redirect-table__remove {
    justify-self: start;
  }

  .button-group {
    width: 100%;
  }

  .button-group .el-button {
    flex: 1;
  }

  .mobile-actions {
    margin-top: 8px;
  }
}
</style>
