<script setup lang="ts">
import { provide } from 'vue'
import GroupManagementDesktop from './group-management/components/GroupManagementDesktop.vue'
import GroupManagementFormDialog from './group-management/components/GroupManagementFormDialog.vue'
import GroupManagementMobile from './group-management/components/GroupManagementMobile.vue'
import GroupManagementPermissionDialog from './group-management/components/GroupManagementPermissionDialog.vue'
import { groupManagementContextKey } from './group-management/context'
import { useGroupManagement } from './group-management/useGroupManagement'
import './group-management/group-management.scss'

const state = useGroupManagement()

provide(groupManagementContextKey, state)
defineExpose(state)
</script>

<template>
  <GroupManagementDesktop v-if="state.isDesktop.value" />
  <GroupManagementMobile v-else />
  <GroupManagementFormDialog />
  <GroupManagementPermissionDialog />
</template>
