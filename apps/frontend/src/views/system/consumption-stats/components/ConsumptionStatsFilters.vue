<template>
  <el-card :class="['filter-card', { 'mobile-filter-card': !isDesktop }]" shadow="never">
    <template #header>
      <div class="card-header table-toolbar">
        <span class="card-title">{{ i18ns.t('ConsumptionStats.filtersTitle') }}</span>
        <div v-if="isDesktop" class="filter-header-actions">
          <el-button size="small" type="primary" :loading="loading" @click="$emit('apply')">
            {{ i18ns.t('ConsumptionStats.applyFilters') }}
          </el-button>
          <el-button size="small" @click="$emit('reset')">
            {{ i18ns.t('ConsumptionStats.clearAllFilters') }}
          </el-button>
        </div>
      </div>
    </template>

    <div :class="['filter-grid', { 'mobile-filter-grid': !isDesktop }]">
      <div class="filter-item">
        <div class="filter-label-row">
          <span class="filter-label">{{ i18ns.t('ConsumptionStats.userFilter') }}</span>
          <span class="filter-count">{{
            getSelectedSummary('userIds', stats.filterOptions.users.length)
          }}</span>
        </div>
        <FilterTableSelect
          :model-value="filterSelections.userIds"
          :options="stats.filterOptions.users"
          :placeholder="i18ns.t('ConsumptionStats.userFilterPlaceholder')"
          :search-placeholder="i18ns.t('ConsumptionStats.userRegexPlaceholder')"
          :column-label="i18ns.t('ConsumptionStats.user')"
          :popover-width="isDesktop ? 320 : 280"
          @update:model-value="updateSelection('userIds', $event)"
        />
      </div>

      <div class="filter-item">
        <div class="filter-label-row">
          <span class="filter-label">{{ i18ns.t('ConsumptionStats.modelFilter') }}</span>
          <span class="filter-count">{{
            getSelectedSummary('models', stats.filterOptions.models.length)
          }}</span>
        </div>
        <FilterTableSelect
          :model-value="filterSelections.models"
          :options="stats.filterOptions.models"
          :placeholder="i18ns.t('ConsumptionStats.modelFilterPlaceholder')"
          :search-placeholder="i18ns.t('ConsumptionStats.modelFilterPlaceholder')"
          :column-label="i18ns.t('ConsumptionStats.model')"
          :popover-width="isDesktop ? 320 : 280"
          @update:model-value="updateSelection('models', $event)"
        />
      </div>

      <div class="filter-item">
        <div class="filter-label-row">
          <span class="filter-label">{{ i18ns.t('ConsumptionStats.channelFilter') }}</span>
          <span class="filter-count">{{
            getSelectedSummary('channels', stats.filterOptions.channels.length)
          }}</span>
        </div>
        <FilterTableSelect
          :model-value="filterSelections.channels"
          :options="stats.filterOptions.channels"
          :placeholder="i18ns.t('ConsumptionStats.channelFilterPlaceholder')"
          :search-placeholder="i18ns.t('ConsumptionStats.channelFilterPlaceholder')"
          :column-label="i18ns.t('ConsumptionStats.channel')"
          :popover-width="isDesktop ? 320 : 280"
          @update:model-value="updateSelection('channels', $event)"
        />
      </div>

      <div class="filter-item">
        <div class="filter-label-row">
          <span class="filter-label">{{ i18ns.t('ConsumptionStats.relayTokenFilter') }}</span>
          <span class="filter-count">{{
            getSelectedSummary('relayTokenIds', stats.filterOptions.relayTokens.length)
          }}</span>
        </div>
        <FilterTableSelect
          :model-value="filterSelections.relayTokenIds"
          :options="stats.filterOptions.relayTokens"
          :placeholder="i18ns.t('ConsumptionStats.relayTokenFilterPlaceholder')"
          :search-placeholder="i18ns.t('ConsumptionStats.relayTokenFilterPlaceholder')"
          :column-label="i18ns.t('ConsumptionStats.relayToken')"
          :popover-width="isDesktop ? 320 : 280"
          @update:model-value="updateSelection('relayTokenIds', $event)"
        />
      </div>
    </div>

    <template v-if="isDesktop">
      <div class="filter-footer">
        <div v-if="activeFilterTags.length > 0" class="filter-tag-list">
          <el-tag v-for="item in activeFilterTags" :key="item.key" size="small" type="info">
            {{ item.label }}
          </el-tag>
        </div>
        <div v-else class="filter-hint">{{ i18ns.t('ConsumptionStats.noActiveFilters') }}</div>
      </div>
    </template>

    <div v-else class="mobile-filter-actions">
      <el-button type="primary" :loading="loading" @click="$emit('apply')">
        {{ i18ns.t('ConsumptionStats.applyFilters') }}
      </el-button>
      <el-button @click="$emit('reset')">{{
        i18ns.t('ConsumptionStats.clearAllFilters')
      }}</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import FilterTableSelect from '@/components/common/FilterTableSelect.vue'
import type {
  ConsumptionFilterSelections,
  ConsumptionStatsResponse,
  FilterSelectionKey,
} from '../types'

const props = defineProps<{
  activeFilterTags: Array<{ key: FilterSelectionKey; label: string }>
  filterSelections: ConsumptionFilterSelections
  getSelectedSummary: (key: FilterSelectionKey, total: number) => string
  isDesktop: boolean
  loading: boolean
  stats: ConsumptionStatsResponse
}>()

const emit = defineEmits<{
  (e: 'apply'): void
  (e: 'reset'): void
  (e: 'update:filterSelections', value: ConsumptionFilterSelections): void
}>()

const updateSelection = (key: FilterSelectionKey, value: string[]) => {
  emit('update:filterSelections', {
    ...props.filterSelections,
    [key]: value,
  })
}
</script>

<style scoped>
.filter-card {
  border-radius: 10px;
  width: 100%;
  min-width: 0;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
  min-width: 0;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.filter-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.filter-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.filter-count,
.filter-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.filter-header-actions,
.mobile-filter-actions,
.filter-tag-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-footer {
  margin-top: 12px;
}

.card-header,
.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
}

.mobile-filter-card {
}

.mobile-filter-grid {
  grid-template-columns: 1fr;
}

.mobile-filter-actions {
  margin-top: 12px;
}

@media (max-width: 768px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
