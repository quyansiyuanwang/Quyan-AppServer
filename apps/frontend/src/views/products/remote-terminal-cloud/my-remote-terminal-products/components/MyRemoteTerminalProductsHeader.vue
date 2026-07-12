<template>
  <div class="header-row">
    <div>
      <div class="title">{{ i18ns.t('remoteTerminalProduct.pageTitle') }}</div>
      <div class="subtitle">{{ i18ns.t('remoteTerminalProduct.pageDescription') }}</div>
    </div>
    <div class="header-actions">
      <el-tag type="success" effect="plain">
        {{ i18ns.t('remoteTerminalProduct.currentBalance') }}:
        {{ formatPrice(currentBalance, '曲') }}
      </el-tag>
      <el-button :loading="loading" @click="refreshAll">{{ i18ns.t('refresh') }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMyRemoteTerminalProductsContext } from '../context'

const { currentBalance, formatPrice, loading, refreshAll } = useMyRemoteTerminalProductsContext()
</script>
