<template>
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
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useAuthCenterClientManagementContext } from '../context'

const { grantTypeRows } = useAuthCenterClientManagementContext()
</script>
