<template><ProductConsoleShell product="push" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default="{ instance, canManage }"><PushChannelsPanel :instance="instance" :can-manage="canManage" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import PushChannelsPanel from './PushChannelsPanel.vue'
import { PRODUCT_COPY } from '@/views/products/developer-product-ui'
const copy = PRODUCT_COPY.push
defineOptions({ name: 'PushUserPage' })
</script>
