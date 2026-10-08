<template>
  <div class="iam-page-controls">
    <el-button
      data-test="page-previous"
      :disabled="loading || page <= 1"
      @click="$emit('previous')"
      >{{ i18ns.t('RamManagement.scopedPrevious') }}</el-button
    >
    <span>{{ i18ns.t('RamManagement.scopedPage', { page }) }}</span>
    <el-button
      data-test="page-next"
      :disabled="loading || !hasNext || page >= limits.maxPage"
      @click="$emit('next')"
      >{{ i18ns.t('RamManagement.scopedNext') }}</el-button
    >
    <el-select
      :model-value="pageSize"
      :disabled="loading"
      :aria-label="i18ns.t('RamManagement.scopedPageSize')"
      @change="$emit('size', Number($event))"
    >
      <el-option v-for="size in sizes" :key="size" :value="size" :label="String(size)" />
    </el-select>
  </div>
</template>
<script setup lang="ts">
import { IAM_MANAGEMENT_PAGINATION as limits } from '@quyan/shared'
import { i18ns } from '@/locales'
defineProps<{ page: number; pageSize: number; hasNext: boolean; loading: boolean }>()
defineEmits<{ previous: []; next: []; size: [value: number] }>()
const sizes = [
  ...new Set([Math.floor(limits.defaultPageSize / 2), limits.defaultPageSize, limits.maxPageSize]),
]
</script>
<style scoped>
.iam-page-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.iam-page-controls .el-select {
  width: 100px;
}
</style>
