<template><ProductConsoleShell product="ip_geolocation" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default><ProductUsagePanel product="ip_geolocation" title="定位调用" description="查询公网 IP 时按产品额度计量；保留地址和非法 IP 不会调用供应商或计费。" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import ProductUsagePanel from '@/views/products/components/ProductUsagePanel.vue'
import { PRODUCT_COPY } from '@/views/products/developer-product-ui'
const copy = PRODUCT_COPY.ip_geolocation
defineOptions({ name: 'IpGeolocationUserPage' })
</script>
