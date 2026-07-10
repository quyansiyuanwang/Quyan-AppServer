<template>
  <div class="page-wrap">
    <el-card class="page-card management-card">
      <template #header>
        <RemoteTerminalProductManagementHeader />
      </template>

      <RemoteTerminalProductManagementTabs />
    </el-card>

    <RemoteTerminalProductManagementDialogs />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import RemoteTerminalProductManagementDialogs from './remote-terminal-product-management/components/RemoteTerminalProductManagementDialogs.vue'
import RemoteTerminalProductManagementHeader from './remote-terminal-product-management/components/RemoteTerminalProductManagementHeader.vue'
import RemoteTerminalProductManagementTabs from './remote-terminal-product-management/components/RemoteTerminalProductManagementTabs.vue'
import { remoteTerminalProductManagementContextKey } from './remote-terminal-product-management/context'
import { useRemoteTerminalProductManagement } from './remote-terminal-product-management/useRemoteTerminalProductManagement'
import './remote-terminal-product-management/remote-terminal-product-management.scss'

const state = useRemoteTerminalProductManagement()

provide(remoteTerminalProductManagementContextKey, state)
</script>
