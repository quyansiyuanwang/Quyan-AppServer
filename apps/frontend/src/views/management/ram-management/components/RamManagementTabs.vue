<template>
  <el-tabs v-model="activeTab" class="ram-tabs">
    <RamManagementUsersTab />
    <RamManagementRolesTab />
    <RamManagementBindingsTab />
    <RamManagementSessionsTab />
    <RamManagementPoliciesTab />
    <RamManagementAuthorizationTab />
  </el-tabs>
</template>

<script setup lang="ts">
import RamManagementAuthorizationTab from './RamManagementAuthorizationTab.vue'
import RamManagementBindingsTab from './RamManagementBindingsTab.vue'
import RamManagementPoliciesTab from './RamManagementPoliciesTab.vue'
import RamManagementRolesTab from './RamManagementRolesTab.vue'
import RamManagementSessionsTab from './RamManagementSessionsTab.vue'
import RamManagementUsersTab from './RamManagementUsersTab.vue'
import { useRamManagementContext } from '../context'

const { activeTab } = useRamManagementContext()
</script>
