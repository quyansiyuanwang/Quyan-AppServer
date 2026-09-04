<template>
  <ProductConsoleShell product="json_endpoint" :title="copy.name" :description="copy.description" :actions="copy.actions">
    <template #default="{ instance, hasPermission }">
      <JsonEndpointPanel :instance="instance" :has-permission="hasPermission" />
    </template>
  </ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import JsonEndpointPanel from './JsonEndpointPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'

const copy = productCopy('json_endpoint')
defineOptions({ name: 'JsonEndpointUserPage' })
</script>
