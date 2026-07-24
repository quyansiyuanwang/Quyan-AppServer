<template><ProductConsoleShell product="short_link" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default="{ instance, canManage }"><ShortLinkPanel :instance="instance" :can-manage="canManage" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import ShortLinkPanel from './ShortLinkPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
const copy = productCopy('short_link')
defineOptions({ name: 'ShortLinkUserPage' })
</script>
