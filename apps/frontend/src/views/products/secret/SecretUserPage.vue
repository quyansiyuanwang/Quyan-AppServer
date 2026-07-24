<template><ProductConsoleShell product="secret" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default="{ instance, canManage }"><SecretPanel :instance="instance" :can-manage="canManage" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import SecretPanel from './SecretPanel.vue'
import { PRODUCT_COPY } from '@/views/products/developer-product-ui'
const copy = PRODUCT_COPY.secret
defineOptions({ name: 'SecretUserPage' })
</script>
