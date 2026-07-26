<template>
  <ProductConsoleShell
    product="secret"
    :title="copy.name"
    :description="copy.description"
    :actions="copy.actions"
    ><template #default="{ instance, hasPermission }"
      ><SecretPanel :instance="instance" :has-permission="hasPermission" /></template
  ></ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import SecretPanel from './SecretPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
const copy = productCopy('secret')
defineOptions({ name: 'SecretUserPage' })
</script>
