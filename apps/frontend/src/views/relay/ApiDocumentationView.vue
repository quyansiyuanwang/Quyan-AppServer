<script setup lang="ts">
import { provide } from 'vue'
import ApiDocumentationHeader from './api-documentation/components/ApiDocumentationHeader.vue'
import ApiDocumentationTabs from './api-documentation/components/ApiDocumentationTabs.vue'
import { apiDocumentationContextKey } from './api-documentation/context'
import { useApiDocumentation } from './api-documentation/useApiDocumentation'
import './api-documentation/api-documentation.scss'

const state = useApiDocumentation()

provide(apiDocumentationContextKey, state)
</script>

<template>
  <div :class="['api-doc-container', { 'mobile-adapter': !state.isDesktop }]">
    <el-card shadow="never">
      <template #header>
        <ApiDocumentationHeader />
      </template>

      <ApiDocumentationTabs />
    </el-card>
  </div>
</template>
