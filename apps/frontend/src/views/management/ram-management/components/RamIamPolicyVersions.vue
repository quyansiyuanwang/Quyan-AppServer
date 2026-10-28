<template>
  <el-drawer
    v-model="iamVersionsVisible"
    :title="i18ns.t('RamManagement.iamVersionHistory')"
    size="780px"
    :close-on-click-modal="!iamVersionRestoring"
    :close-on-press-escape="!iamVersionRestoring"
    :show-close="!iamVersionRestoring"
    @closed="resetIamPolicyVersions"
  >
    <p>{{ iamVersionPolicy?.name }}</p>
    <el-alert
      :title="i18ns.t('RamManagement.iamVersionHistoryHint')"
      type="info"
      :closable="false"
    />
    <el-button
      class="history-refresh"
      :disabled="iamVersionRestoring || iamVersionsLoading"
      @click="loadIamPolicyVersions"
    >
      {{ i18ns.t('refresh') }}
    </el-button>
    <el-alert
      v-if="iamVersionsFailed"
      :title="i18ns.t('RamManagement.iamVersionsFailed')"
      type="error"
      :closable="false"
    />
    <el-alert
      v-if="iamVersionRestoreFailed"
      :title="i18ns.t('RamManagement.iamRestoreFailed')"
      type="error"
      :closable="false"
    />
    <el-table v-loading="iamVersionsLoading" :data="iamVersions" border>
      <el-table-column
        prop="version"
        :label="i18ns.t('RamManagement.iamVersionNumber')"
        width="90"
      />
      <el-table-column :label="i18ns.t('RamManagement.iamDefaultVersion')" width="100">
        <template #default="{ row }"
          ><el-tag v-if="row.isDefault">{{
            i18ns.t('RamManagement.iamDefaultVersion')
          }}</el-tag></template
        >
      </el-table-column>
      <el-table-column
        prop="createTime"
        :label="i18ns.t('RamManagement.iamVersionCreatedAt')"
        min-width="180"
      />
      <el-table-column
        prop="createdBy"
        :label="i18ns.t('RamManagement.iamVersionCreatedBy')"
        min-width="160"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('actions')" width="160">
        <template #default="{ row }">
          <el-button link @click="iamVersionPreview = row">{{
            i18ns.t('RamManagement.iamViewDocument')
          }}</el-button>
          <el-button
            v-if="canUpdatePolicies && iamVersionPolicy?.type === 'custom' && !row.isDefault"
            link
            type="warning"
            :disabled="iamVersionRestoring || iamVersionsLoading || !iamDefaultDocumentHash"
            @click="restoreIamPolicyVersion(row)"
          >
            {{ i18ns.t('RamManagement.iamRestoreVersion') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      class="history-pagination"
      :current-page="iamVersionPage"
      :page-size="iamVersionPageSize"
      :total="iamVersionTotal"
      :page-sizes="[20, 50, 100]"
      :disabled="iamVersionRestoring || iamVersionsLoading"
      layout="total, sizes, prev, pager, next"
      @update:current-page="changeIamVersionPage"
      @update:page-size="changeIamVersionPageSize"
    />
    <section v-if="iamVersionPreview" class="history-document">
      <h3>{{ i18ns.t('RamManagement.iamVersionNumber') }} {{ iamVersionPreview.version }}</h3>
      <pre>{{ JSON.stringify(iamVersionPreview.document, null, 2) }}</pre>
    </section>
  </el-drawer>
</template>
<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'
const {
  canUpdatePolicies,
  iamVersionsVisible,
  iamVersionPolicy,
  iamVersions,
  iamVersionPage,
  iamVersionPageSize,
  iamVersionTotal,
  iamVersionsLoading,
  iamVersionsFailed,
  iamVersionRestoring,
  iamVersionRestoreFailed,
  iamVersionPreview,
  iamDefaultDocumentHash,
  loadIamPolicyVersions,
  resetIamPolicyVersions,
  changeIamVersionPage,
  changeIamVersionPageSize,
  restoreIamPolicyVersion,
} = useRamManagementContext()
</script>
<style scoped>
.history-refresh,
.history-pagination {
  margin: 16px 0;
}
.history-document pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
