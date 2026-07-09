<template>
  <div class="remote-terminal-page">
    <el-row :gutter="20">
      <RemoteTerminalSidebar />
      <RemoteTerminalWorkspace />
    </el-row>
    <RemoteTerminalDialogs />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import RemoteTerminalDialogs from './remote-terminal/components/RemoteTerminalDialogs.vue'
import RemoteTerminalSidebar from './remote-terminal/components/RemoteTerminalSidebar.vue'
import RemoteTerminalWorkspace from './remote-terminal/components/RemoteTerminalWorkspace.vue'
import { remoteTerminalManagementContextKey } from './remote-terminal/context'
import { useRemoteTerminalManagement } from './remote-terminal/useRemoteTerminalManagement'
import './remote-terminal/remote-terminal.scss'

const state = useRemoteTerminalManagement()

provide(remoteTerminalManagementContextKey, state)
</script>
