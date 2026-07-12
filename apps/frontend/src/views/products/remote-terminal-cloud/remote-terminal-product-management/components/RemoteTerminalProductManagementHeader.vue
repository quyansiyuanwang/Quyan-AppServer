<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t
const loading = state.loading
const refreshAll = state.refreshAll
</script>

<template>
  <div class="header-row">
    <div>
      <div class="title">{{ t('remoteTerminalProduct.title') }}</div>
      <div class="subtitle">{{ t('remoteTerminalProduct.subtitle') }}</div>
    </div>
    <el-button :loading="loading" @click="refreshAll">
      {{ t('common.refresh') }}
    </el-button>
  </div>
</template>
