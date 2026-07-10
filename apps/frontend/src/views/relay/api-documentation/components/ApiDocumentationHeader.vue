<script setup lang="ts">
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
</script>

<template>
  <div class="card-header toolbar-row">
    <span>{{ $t('nav.apiDocumentation') }}</span>
    <div class="card-header-actions">
      <el-tag type="info" size="small">{{ $t('apiDoc.version') }}</el-tag>
      <el-button
        v-if="state.canOpenSwagger"
        type="primary"
        plain
        size="small"
        :loading="state.openingSwaggerDocs"
        @click="state.openSwaggerDocs"
      >
        {{ $t('apiDoc.openSwaggerDocs') }}
      </el-button>
    </div>
  </div>
</template>
