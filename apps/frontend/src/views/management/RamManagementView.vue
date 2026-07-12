<template>
  <div class="ram-management desktop-page">
    <el-card class="page-card">
      <template #header>
        <RamManagementHeader />
      </template>

      <RamManagementTabs />
    </el-card>

    <RamManagementDialogs />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import RamManagementDialogs from './ram-management/components/RamManagementDialogs.vue'
import RamManagementHeader from './ram-management/components/RamManagementHeader.vue'
import RamManagementTabs from './ram-management/components/RamManagementTabs.vue'
import { ramManagementContextKey } from './ram-management/context'
import { useRamManagement } from './ram-management/useRamManagement'
import './ram-management/ram-management.scss'

const state = useRamManagement()

provide(ramManagementContextKey, state)
</script>
