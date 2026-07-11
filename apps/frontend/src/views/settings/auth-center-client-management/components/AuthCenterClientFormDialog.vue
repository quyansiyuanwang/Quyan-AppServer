<template>
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
              <el-radio value="confidential">
                {{ i18ns.t('authCenterClient.type.confidential') }}
              </el-radio>
              <el-radio value="public">
                {{ i18ns.t('authCenterClient.type.public') }}
              </el-radio>
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
            <el-input-number v-model="form.accessTokenLifetime" :min="60" :max="86400" :step="60" />
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
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useAuthCenterClientManagementContext } from '../context'

const {
  isDesktop,
  submitting,
  showFormDialog,
  isEditing,
  form,
  isPkceLocked,
  grantTypeOptions,
  scopeOptions,
  addRedirectUriRow,
  removeRedirectUriRow,
  handleSubmit,
} = useAuthCenterClientManagementContext()
</script>
