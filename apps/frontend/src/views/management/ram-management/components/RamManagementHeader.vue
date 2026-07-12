<template>
  <div class="card-header toolbar-row">
    <span class="card-title">{{ i18ns.t('RamManagement.title') }}</span>
    <div class="header-actions">
      <el-button :icon="Refresh" @click="loadAll">{{ i18ns.t('refresh') }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const { Refresh, loadAll } = useRamManagementContext()
</script>
