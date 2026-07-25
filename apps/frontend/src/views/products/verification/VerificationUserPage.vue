<template>
  <ProductConsoleShell
    product="verification"
    :title="copy.name"
    :description="copy.description"
    :actions="copy.actions"
  >
    <template #default>
      <ProductUsagePanel
        product="verification"
        :title="t('productUsage.verificationTitle')"
        :description="t('productUsage.verificationDescription')"
      />
      <VerificationTestPanel />
    </template>
  </ProductConsoleShell>
</template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import ProductUsagePanel from '@/views/products/components/ProductUsagePanel.vue'
import VerificationTestPanel from './VerificationTestPanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
import { i18ns } from '@/locales'
const { t } = i18ns
const copy = productCopy('verification')
defineOptions({ name: 'VerificationUserPage' })
</script>
