<template>
  <ProductConsoleShell
    product="push"
    :title="copy.name"
    :description="copy.description"
    :actions="copy.actions"
    ><template #default="{ instance, hasPermission }"
      ><PushChannelsPanel :instance="instance" :has-permission="hasPermission" /></template
  ></ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import PushChannelsPanel from './PushChannelsPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
const copy = productCopy('push')
defineOptions({ name: 'PushUserPage' })
</script>
