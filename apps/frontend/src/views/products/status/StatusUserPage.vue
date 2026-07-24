<template>
  <ProductConsoleShell
    product="status"
    :title="copy.name"
    :description="copy.description"
    :actions="copy.actions"
    ><template #default="{ instance, hasPermission }"
      ><StatusMonitorPanel :instance="instance" :has-permission="hasPermission" /></template
  ></ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import StatusMonitorPanel from './StatusMonitorPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
const copy = productCopy('status')
defineOptions({ name: 'StatusUserPage' })
</script>
