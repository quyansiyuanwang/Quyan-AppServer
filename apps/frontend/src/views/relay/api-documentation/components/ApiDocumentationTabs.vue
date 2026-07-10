<script setup lang="ts">
import ApiDocumentationEndpointsTab from './ApiDocumentationEndpointsTab.vue'
import ApiDocumentationPricingTab from './ApiDocumentationPricingTab.vue'
import ApiDocumentationTutorialTab from './ApiDocumentationTutorialTab.vue'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
</script>

<template>
  <el-tabs v-model="state.activeTabName" @tab-change="state.handleTabChange">
    <el-tab-pane :label="$t('apiDoc.endpoints')" name="endpoints">
      <ApiDocumentationEndpointsTab />
    </el-tab-pane>

    <el-tab-pane :label="$t('apiDoc.pricing')" name="pricing" lazy>
      <ApiDocumentationPricingTab />
    </el-tab-pane>

    <el-tab-pane :label="$t('apiDoc.tutorial')" name="tutorial">
      <ApiDocumentationTutorialTab />
    </el-tab-pane>
  </el-tabs>
</template>
