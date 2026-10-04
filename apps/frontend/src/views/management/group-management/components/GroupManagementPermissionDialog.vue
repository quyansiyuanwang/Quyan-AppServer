<template>
  <PermissionEditorDialog
    v-model="permDialogVisible"
    v-model:permissions="selectedPermissions"
    :title="i18ns.t('GroupManagement.editPermissions')"
    :data="permissionTree"
    :hint="i18ns.t('GroupManagement.permissionAssignmentHint')"
    :total-label="i18ns.t('GroupManagement.permSelected')"
    :search-placeholder="i18ns.t('PermissionSelector.searchPlaceholder')"
    :empty-text="i18ns.t('PermissionSelector.noMatchingPermissions')"
    :width="isDesktop ? '760px' : '96%'"
    :is-permission-disabled="isPermissionDisabled"
    :save-disabled="!canSavePermissions"
    :saving="permSaving"
    :cancel-text="i18ns.t('cancel')"
    :save-text="i18ns.t('save')"
    @closed="resetPermissionDialog"
    @save="handleSavePermissions"
  />
</template>

<script setup lang="ts">
import PermissionEditorDialog from '@/components/permission/PermissionEditorDialog.vue'
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
} = useGroupManagementContext()
</script>
