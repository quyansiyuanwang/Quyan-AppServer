<template>
  <el-dialog
    v-model="visible"
    :title="props.isEditing ? i18ns.t('oauthClient.edit') : i18ns.t('oauthClient.create')"
    :width="props.isDesktop ? '50%' : '96%'"
    class="oauth-client-form-dialog"
  >
    <el-form
      :model="form"
      :label-width="props.isDesktop ? '160px' : undefined"
      :label-position="props.isDesktop ? 'right' : 'top'"
      class="oauth-client-form"
    >
      <div class="oauth-client-form__section">
        <div class="oauth-client-form__section-title">{{ i18ns.t('oauthClient.name') }}</div>
        <div class="oauth-client-form__grid oauth-client-form__grid--basic">
          <el-form-item :label="i18ns.t('oauthClient.name')">
            <el-input v-model="form.name" :placeholder="i18ns.t('oauthClient.namePlaceholder')" />
          </el-form-item>
          <el-form-item :label="i18ns.t('oauthClient.clientType')">
            <el-radio-group v-model="form.clientType" :disabled="props.isEditing">
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
              <el-button type="primary" link @click="emit('add-redirect-uri')">
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
                  @click="emit('remove-redirect-uri', index)"
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
        <el-form-item :label="i18ns.t('oauthClient.scopes')" class="oauth-client-form__block-item">
          <div class="oauth-scope-selector">
            <el-checkbox-group v-model="form.scopes" class="oauth-scope-selector__grid">
              <el-checkbox
                v-for="scope in props.scopeOptions"
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
            <el-input v-model="form.logoUrl" :placeholder="i18ns.t('oauthClient.urlPlaceholder')" />
          </el-form-item>
          <el-form-item :label="i18ns.t('oauthClient.policyUrl')">
            <el-input
              v-model="form.policyUrl"
              :placeholder="i18ns.t('oauthClient.urlPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('oauthClient.tosUrl')">
            <el-input v-model="form.tosUrl" :placeholder="i18ns.t('oauthClient.urlPlaceholder')" />
          </el-form-item>
        </div>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="props.submitting" @click="emit('submit')">
        {{ i18ns.t('confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'

interface OAuthClientFormState {
  name: string
  description: string
  clientType: 'confidential' | 'public'
  redirectUris: string[]
  scopes: string[]
  homepageUrl: string
  logoUrl: string
  policyUrl: string
  tosUrl: string
}

interface ScopeOption {
  value: string
  label: string
  description: string
  sensitive?: boolean
}

const visible = defineModel<boolean>({ required: true })
const form = defineModel<OAuthClientFormState>('form', { required: true })

const props = defineProps<{
  isEditing: boolean
  isDesktop: boolean
  submitting: boolean
  scopeOptions: ScopeOption[]
}>()

const emit = defineEmits<{
  (e: 'add-redirect-uri'): void
  (e: 'remove-redirect-uri', index: number): void
  (e: 'submit'): void
}>()
</script>

<style scoped>
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

.oauth-scope-selector {
  width: 100%;
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
}
</style>
