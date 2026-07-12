<template>
  <div class="mobile-page auth-center-client-mobile">
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
              <el-tag size="small" :type="getReviewStatusTagType(row.reviewStatus)" effect="light">
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
          </el-card>
        </div>
        <el-empty v-else />
      </el-skeleton>
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
