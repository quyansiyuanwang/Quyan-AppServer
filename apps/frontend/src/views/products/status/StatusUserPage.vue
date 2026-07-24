<template><ProductConsoleShell product="status" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default="{ instance, canManage }"><StatusMonitorPanel :instance="instance" :can-manage="canManage" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import StatusMonitorPanel from './StatusMonitorPanel.vue'
import { PRODUCT_COPY } from '@/views/products/developer-product-ui'
const copy = PRODUCT_COPY.status
defineOptions({ name: 'StatusUserPage' })
</script>
