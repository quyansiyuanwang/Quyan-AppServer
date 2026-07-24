<template><ProductConsoleShell product="ip_geolocation" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default><ProductUsagePanel product="ip_geolocation" :title="t('productUsage.ipTitle')" :description="t('productUsage.ipDescription')" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import ProductUsagePanel from '@/views/products/components/ProductUsagePanel.vue'
import { productCopy } from '@/views/products/developer-product-ui'
import { i18ns } from '@/locales'
const { t } = i18ns
const copy = productCopy('ip_geolocation')
defineOptions({ name: 'IpGeolocationUserPage' })
</script>
