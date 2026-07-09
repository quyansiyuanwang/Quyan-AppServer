<template>
  <div class="filters-container">
    <el-form :inline="true" :model="filters" class="toolbar-row">
      <el-form-item :label="i18ns.t('BusinessLogs.operationType')">
        <el-select
          :model-value="filters.operationType"
          :placeholder="i18ns.t('BusinessLogs.filterByType')"
          clearable
          :style="isDesktop ? { width: '240px' } : { width: '100%' }"
          @update:model-value="updateFilter('operationType', $event)"
          @change="$emit('filterChange')"
        >
          <el-option
            v-for="option in businessLogFilterOptions.operationTypes"
            :key="option"
            :label="option"
            :value="option"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="i18ns.t('BusinessLogs.operationCategory')">
        <el-select
          :model-value="filters.operationCategory"
          :placeholder="i18ns.t('BusinessLogs.filterByCategory')"
          clearable
          :style="isDesktop ? { width: '220px' } : { width: '100%' }"
          @update:model-value="updateFilter('operationCategory', $event)"
          @change="$emit('filterChange')"
        >
          <el-option
            v-for="option in businessLogFilterOptions.operationCategories"
            :key="option"
            :label="option"
            :value="option"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="i18ns.t('BusinessLogs.actor')">
        <el-input
          :model-value="filters.actor"
          :placeholder="i18ns.t('BusinessLogs.filterByActor')"
          clearable
          style="width: 100%; max-width: 200px"
          @update:model-value="updateFilter('actor', $event)"
          @change="$emit('filterChange')"
        />
      </el-form-item>

      <el-form-item :label="i18ns.t('BusinessLogs.target')">
        <el-input
          :model-value="filters.target"
          :placeholder="i18ns.t('BusinessLogs.filterByTarget')"
          clearable
          style="width: 100%; max-width: 200px"
          @update:model-value="updateFilter('target', $event)"
          @change="$emit('filterChange')"
        />
      </el-form-item>

      <el-form-item :label="i18ns.t('BusinessLogs.status')">
        <el-select
          :model-value="filters.success"
          :placeholder="i18ns.t('BusinessLogs.filterByStatus')"
          clearable
          :style="isDesktop ? { width: '160px' } : { width: '100%' }"
          @update:model-value="updateFilter('success', $event)"
          @change="$emit('filterChange')"
        >
          <el-option :label="i18ns.t('BusinessLogs.success')" :value="true" />
          <el-option :label="i18ns.t('BusinessLogs.failed')" :value="false" />
        </el-select>
      </el-form-item>

      <el-form-item :label="i18ns.t('BusinessLogs.ipAddress')">
        <el-input
          :model-value="filters.ip"
          :placeholder="i18ns.t('BusinessLogs.filterByIp')"
          clearable
          style="width: 100%; max-width: 200px"
          @update:model-value="updateFilter('ip', $event)"
          @change="$emit('filterChange')"
        />
      </el-form-item>

      <el-form-item :label="i18ns.t('BusinessLogs.dateRange')">
        <el-date-picker
          :model-value="dateRange"
          type="datetimerange"
          :start-placeholder="i18ns.t('BusinessLogs.startDate')"
          :end-placeholder="i18ns.t('BusinessLogs.endDate')"
          :unlink-panels="true"
          :style="{ width: '100%', maxWidth: isDesktop ? '360px' : '100%' }"
          @update:model-value="$emit('update:dateRange', $event)"
          @change="$emit('dateRangeChange', $event)"
        />
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type {
  BusinessLogDateRange,
  BusinessLogFilterOptionsResponse,
  BusinessLogFilters,
} from '../types'

const props = defineProps<{
  isDesktop: boolean
  filters: BusinessLogFilters
  dateRange: BusinessLogDateRange
  businessLogFilterOptions: BusinessLogFilterOptionsResponse
}>()

const emit = defineEmits<{
  filterChange: []
  dateRangeChange: [value: BusinessLogDateRange]
  'update:filters': [value: BusinessLogFilters]
  'update:dateRange': [value: BusinessLogDateRange]
}>()

function updateFilter<K extends keyof BusinessLogFilters>(key: K, value: BusinessLogFilters[K]) {
  emit('update:filters', {
    ...props.filters,
    [key]: value,
  })
}
</script>

<style scoped>
.filters-container {
  margin-bottom: 20px;
  padding: 15px;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
}

@media (max-width: 768px) {
  .filters-container {
    padding: 10px;
  }
}

@media (max-width: 480px) {
  .filters-container :deep(.el-form--inline) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .filters-container :deep(.el-form-item) {
    margin-right: 0;
    margin-bottom: 12px;
    width: 100%;
  }

  .filters-container :deep(.el-form-item__content),
  .filters-container :deep(.el-select),
  .filters-container :deep(.el-input) {
    width: 100% !important;
  }
}
</style>
