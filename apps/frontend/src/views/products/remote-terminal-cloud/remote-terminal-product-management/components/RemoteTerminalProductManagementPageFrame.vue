<template>
  <div class="page-wrap">
    <el-card class="page-card management-card">
      <template #header>
        <RemoteTerminalProductManagementHeader />
      </template>

      <el-empty
        v-if="!canAccessSection"
        class="permission-empty"
        :description="t('common.noPermission')"
      />
      <slot v-else />
    </el-card>

    <RemoteTerminalProductManagementDialogs />
  </div>
</template>

<script setup lang="ts">
import { computed, provide } from 'vue'
import RemoteTerminalProductManagementDialogs from './RemoteTerminalProductManagementDialogs.vue'
import RemoteTerminalProductManagementHeader from './RemoteTerminalProductManagementHeader.vue'
import { remoteTerminalProductManagementContextKey } from '../context'
import {
  useRemoteTerminalProductManagement,
  type RemoteTerminalProductManagementSection,
} from '../useRemoteTerminalProductManagement'
import { i18ns } from '@/locales'
import '../remote-terminal-product-management.scss'

const props = defineProps<{ section: RemoteTerminalProductManagementSection }>()
const t = i18ns.t
const state = useRemoteTerminalProductManagement(props.section)

const canAccessSection = computed(() => {
  if (props.section === 'templates') return state.canReadTemplate.value
  if (props.section === 'entitlements') return state.canReadAssignment.value
  return state.canReadDevice.value
})

provide(remoteTerminalProductManagementContextKey, state)
</script>
