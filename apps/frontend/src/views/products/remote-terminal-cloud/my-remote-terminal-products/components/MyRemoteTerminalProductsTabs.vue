<template>
  <div v-if="!canView" class="permission-empty">
    <el-empty :description="i18ns.t('remoteTerminalProduct.noPermission')" />
  </div>

  <template v-else>
    <el-alert
      :title="i18ns.t('remoteTerminalProduct.userGuideTitle')"
      :description="i18ns.t('remoteTerminalProduct.userGuideDescription')"
      type="info"
      :closable="false"
      show-icon
    />

    <el-tabs class="section-tabs">
      <MyRemoteTerminalPublishedPlansTab />
      <MyRemoteTerminalEntitlementsTab />
      <MyRemoteTerminalDevicesTab />
    </el-tabs>
  </template>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMyRemoteTerminalProductsContext } from '../context'
import MyRemoteTerminalDevicesTab from './MyRemoteTerminalDevicesTab.vue'
import MyRemoteTerminalEntitlementsTab from './MyRemoteTerminalEntitlementsTab.vue'
import MyRemoteTerminalPublishedPlansTab from './MyRemoteTerminalPublishedPlansTab.vue'

const { canView } = useMyRemoteTerminalProductsContext()
</script>
