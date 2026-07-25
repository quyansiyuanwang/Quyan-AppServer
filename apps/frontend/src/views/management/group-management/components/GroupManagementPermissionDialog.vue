<template>
  <el-dialog
    v-model="permDialogVisible"
    :title="i18ns.t('GroupManagement.editPermissions')"
    :width="isDesktop ? '760px' : '96%'"
    :close-on-click-modal="false"
    @closed="resetPermissionDialog"
  >
    <el-alert
      :title="i18ns.t('GroupManagement.permissionAssignmentHint')"
      type="info"
      :closable="false"
      show-icon
      class="perm-dialog-hint"
    />
    <div class="perm-dialog-toolbar">
      <div class="perm-stats">
        <span class="perm-stat-selected">{{ selectedPermissions.length }}</span>
        <span class="perm-stat-sep">/</span>
        <span class="perm-stat-total">{{ ALL_PERMISSIONS.length }}</span>
        <span v-if="isDesktop" class="perm-stat-label">{{
          i18ns.t('GroupManagement.permSelected')
        }}</span>
      </div>
    </div>

    <div class="group-permission-tree">
      <PermissionTreeSelector
        v-model="selectedPermissions"
        :data="permissionTree"
        :is-permission-disabled="isPermissionDisabled"
        :search-placeholder="i18ns.t('PermissionSelector.searchPlaceholder')"
        :empty-text="i18ns.t('PermissionSelector.noMatchingPermissions')"
        filterable
      />
    </div>

    <template #footer>
      <el-button @click="permDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="primary"
        :loading="permSaving"
        :disabled="!canSavePermissions"
        @click="handleSavePermissions"
      >
        {{ i18ns.t('save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import PermissionTreeSelector from '@/components/permission/PermissionTreeSelector.vue'
import { i18ns } from '@/locales'
import { useGroupManagementContext } from '../context'

const {
  isDesktop,
  permDialogVisible,
  permSaving,
  selectedPermissions,
  canSavePermissions,
  isPermissionDisabled,
  permissionTree,
  handleSavePermissions,
  resetPermissionDialog,
  ALL_PERMISSIONS,
} = useGroupManagementContext()
</script>
