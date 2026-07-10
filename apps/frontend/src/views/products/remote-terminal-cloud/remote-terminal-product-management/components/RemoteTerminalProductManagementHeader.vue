<script setup lang="ts">
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
</script>

<template>
  <div class="header-row">
    <div>
      <div class="title">{{ $t('remoteTerminalProduct.title') }}</div>
      <div class="subtitle">{{ $t('remoteTerminalProduct.subtitle') }}</div>
    </div>
    <el-button :loading="state.loading" @click="state.refreshAll">
      {{ $t('common.refresh') }}
    </el-button>
  </div>
</template>
