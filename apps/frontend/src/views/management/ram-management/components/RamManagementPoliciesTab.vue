<template>
  <section class="ram-section">
    <div v-if="canReadPolicies" class="section-toolbar">
      <div class="toolbar-left">
        <el-button v-if="canCreatePolicies" type="primary" :icon="Plus" @click="openPolicyDialog()">
          {{ i18ns.t('RamManagement.createPolicy') }}
        </el-button>
        <el-button @click="iamSimulationVisible = true">{{
          i18ns.t('RamManagement.simulatePolicy')
        }}</el-button>
        <el-button :icon="Refresh" @click="loadPolicies()">{{ i18ns.t('refresh') }}</el-button>
      </div>
      <el-input
        v-model="policySearch"
        :prefix-icon="Search"
        :placeholder="i18ns.t('RamManagement.pageSearchPlaceholder')"
        clearable
        style="width: 280px"
      />
    </div>

    <el-table
      v-if="canReadPolicies"
      v-loading="loading.policies"
      :data="filteredPolicies"
      border
      stripe
    >
      <el-table-column prop="name" :label="i18ns.t('RamManagement.policyName')" min-width="180" />
      <el-table-column
        prop="description"
        :label="i18ns.t('RamManagement.policyDescription')"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('RamManagement.policyType')" width="120">
        <template #default="{ row }">
          <el-tag round effect="plain">
            {{ row.type === 'custom' ? i18ns.t('RamManagement.customPolicy') : row.type }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('RamManagement.policyFormat')" width="160">
        <template #default="{ row }">
          <el-tag :type="row.document ? 'success' : 'info'">{{
            row.document
              ? i18ns.t('RamManagement.iamDocument')
              : i18ns.t('RamManagement.legacyPolicy')
          }}</el-tag>
          <span v-if="row.defaultVersion"> v{{ row.defaultVersion }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('RamManagement.permissionCount')" width="130">
        <template #default="{ row }">
          <el-tag v-if="!row.document" round type="info">{{ row.permissions?.length ?? 0 }}</el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="380">
        <template #default="{ row }">
          <el-button v-if="row.document" link @click="openIamPolicyVersions(row)">
            {{ i18ns.t('RamManagement.iamVersionHistory') }}
          </el-button>
          <el-button v-if="canReadPolicies" link type="info" @click="openPolicyAttachments(row)">
            {{ i18ns.t('RamManagement.policyAttachments') }}
          </el-button>
          <el-button
            v-if="canUpdatePolicies && row.type === 'custom'"
            link
            type="primary"
            @click="openPolicyDialog(row)"
          >
            {{ i18ns.t('edit') }}
          </el-button>
          <el-button
            v-if="canDeletePolicies && row.type === 'custom'"
            link
            type="danger"
            @click="deletePolicy(row)"
          >
            {{ i18ns.t('delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-alert
      v-if="canReadPolicies && policyPage.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <RamIamPageControls
      v-if="canReadPolicies"
      :page="policyPage.page.value"
      :page-size="policyPage.pageSize.value"
      :has-next="policyPage.hasNext.value"
      :loading="policyPage.loading.value"
      @previous="loadPolicies(policyPage.page.value - 1)"
      @next="loadPolicies(policyPage.page.value + 1)"
      @size="resizePoliciesPage"
    />
    <el-empty v-if="!canReadPolicies" :description="i18ns.t('message.error.forbidden')" />
  </section>
</template>

<script setup lang="ts">
import RamIamPageControls from './RamIamPageControls.vue'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  iamSimulationVisible,
  openIamPolicyVersions,
  canCreatePolicies,
  canDeletePolicies,
  canReadPolicies,
  canUpdatePolicies,
  deletePolicy,
  filteredPolicies,
  loading,
  loadPolicies,
  policyPage,
  resizePoliciesPage,
  openPolicyAttachments,
  openPolicyDialog,
  policySearch,
} = useRamManagementContext()
</script>
