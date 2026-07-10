<template>
  <div class="desktop-page">
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
                {{ i18ns.t('authCenterClient.moreItems', { count: row.redirectUris.length - 2 }) }}
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
        <el-table-column prop="lastUsedAt" :label="i18ns.t('authCenterClient.lastUsed')" width="180">
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
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useAuthCenterClientManagementContext } from '../context'

const {
  clients,
  loading,
  getReviewStatusLabel,
  getReviewStatusTagType,
  canSubmitReview,
  getClientTypeLabel,
  getGrantTypeLabel,
  formatLifetime,
  loadClients,
  openCreateDialog,
  openEditDialog,
  handleSubmitReview,
  handleRegenerateSecret,
  handleDelete,
} = useAuthCenterClientManagementContext()
</script>
