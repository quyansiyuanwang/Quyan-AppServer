<template>
  <ProductConsoleShell
    product="short_link"
    :title="copy.name"
    :description="copy.description"
    :actions="copy.actions"
    ><template #default="{ instance, hasPermission }"
      ><ShortLinkPanel :instance="instance" :has-permission="hasPermission" /></template
  ></ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import ShortLinkPanel from './ShortLinkPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
const copy = productCopy('short_link')
defineOptions({ name: 'ShortLinkUserPage' })
</script>
