<script setup lang="ts">
import { i18ns } from '@/locales'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
const canOpenSwagger = state.canOpenSwagger
const openingSwaggerDocs = state.openingSwaggerDocs
const openSwaggerDocs = state.openSwaggerDocs
const t = i18ns.t
</script>

<template>
  <div class="card-header toolbar-row">
    <span>{{ t('nav.apiDocumentation') }}</span>
    <div class="card-header-actions">
      <el-tag type="info" size="small">{{ t('apiDoc.version') }}</el-tag>
      <el-button
        v-if="canOpenSwagger"
        type="primary"
        plain
        size="small"
        :loading="openingSwaggerDocs"
        @click="openSwaggerDocs"
      >
        {{ t('apiDoc.openSwaggerDocs') }}
      </el-button>
    </div>
  </div>
</template>
