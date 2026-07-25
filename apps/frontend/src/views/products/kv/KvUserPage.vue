<template>
  <ProductConsoleShell
    product="kv"
    :title="copy.name"
    :description="copy.description"
    :actions="copy.actions"
    ><template #default="{ instance, hasPermission }"
      ><KvEntriesPanel :instance="instance" :has-permission="hasPermission" /></template
  ></ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import KvEntriesPanel from './KvEntriesPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
const copy = productCopy('kv')
defineOptions({ name: 'KvUserPage' })
</script>
