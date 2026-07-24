<template><ProductConsoleShell product="kv" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default="{ instance, canManage }"><KvEntriesPanel :instance="instance" :can-manage="canManage" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import KvEntriesPanel from './KvEntriesPanel.vue'
import { PRODUCT_COPY } from '@/views/products/developer-product-ui'
const copy = PRODUCT_COPY.kv
defineOptions({ name: 'KvUserPage' })
</script>
