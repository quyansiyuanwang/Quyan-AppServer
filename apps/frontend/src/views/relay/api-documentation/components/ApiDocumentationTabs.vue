<script setup lang="ts">
import ApiDocumentationEndpointsTab from './ApiDocumentationEndpointsTab.vue'
import ApiDocumentationPricingTab from './ApiDocumentationPricingTab.vue'
import ApiDocumentationTutorialTab from './ApiDocumentationTutorialTab.vue'
import { i18ns } from '@/locales'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
const activeTabName = state.activeTabName
const handleTabChange = state.handleTabChange
const t = i18ns.t as (key: string, params?: Record<string, unknown>) => string
</script>

<template>
  <el-tabs v-model="activeTabName" @tab-change="handleTabChange">
    <el-tab-pane :label="t('apiDoc.endpoints')" name="endpoints">
      <ApiDocumentationEndpointsTab />
    </el-tab-pane>

    <el-tab-pane :label="t('apiDoc.pricing')" name="pricing" lazy>
      <ApiDocumentationPricingTab />
    </el-tab-pane>

    <el-tab-pane :label="t('apiDoc.tutorial')" name="tutorial">
      <ApiDocumentationTutorialTab />
    </el-tab-pane>
  </el-tabs>
</template>
