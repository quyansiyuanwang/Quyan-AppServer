<template><ProductConsoleShell product="verification" :title="copy.name" :description="copy.description" :actions="copy.actions"><template #default><ProductUsagePanel product="verification" title="验证码调用" description="通过实例 API Key 调用邮件或已启用的短信通道；这里展示真实的用量与验证审计。" /></template></ProductConsoleShell></template>

<script setup lang="ts">
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'
import ProductUsagePanel from '@/views/products/components/ProductUsagePanel.vue'
import { PRODUCT_COPY } from '@/views/products/developer-product-ui'
const copy = PRODUCT_COPY.verification
defineOptions({ name: 'VerificationUserPage' })
</script>
