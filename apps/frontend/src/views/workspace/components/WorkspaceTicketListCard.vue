<template>
  <el-card class="page-card ticket-card ticket-card--list" shadow="never">
    <template #header>
      <div class="card-header-row">
        <div class="card-header-block">
          <div class="card-title">{{ i18ns.t('ticket.listSectionTitle') }}</div>
          <div class="card-description">{{ i18ns.t('ticket.listSectionDescription') }}</div>
        </div>
        <el-button :loading="listLoading" @click="$emit('refresh')">{{
          i18ns.t('refresh')
        }}</el-button>
      </div>
    </template>

    <div class="list-card-shell">
      <div class="filter-row">
        <el-input
          :model-value="filters.keyword"
          :placeholder="i18ns.t('ticket.keywordPlaceholder')"
          clearable
          @update:model-value="updateFilter('keyword', $event)"
          @keyup.enter="$emit('search')"
          @clear="$emit('search')"
        />
        <el-select
          :model-value="filters.workflowStatus"
          clearable
          @update:model-value="updateFilter('workflowStatus', $event)"
          @change="$emit('search')"
        >
          <el-option :label="i18ns.t('ticket.allStatuses')" value="" />
          <el-option
            v-for="status in workflowStatusOptions"
            :key="status"
            :label="getStatusLabel(status)"
            :value="status"
          />
        </el-select>
        <el-select
          :model-value="filters.type"
          clearable
          @update:model-value="updateFilter('type', $event)"
          @change="$emit('search')"
        >
          <el-option :label="i18ns.t('ticket.allTypes')" value="" />
          <el-option
            v-for="type in ticketTypeOptions"
            :key="type"
            :label="getTypeLabel(type)"
            :value="type"
          />
        </el-select>
        <div class="filter-actions">
          <el-button type="primary" @click="$emit('search')">{{ i18ns.t('search') }}</el-button>
          <el-button @click="$emit('resetFilters')">{{ i18ns.t('reset') }}</el-button>
        </div>
      </div>

      <div class="list-card-content">
        <el-table v-if="isDesktop" v-loading="listLoading" :data="ticketList" class="ticket-table">
          <el-table-column prop="title" :label="i18ns.t('ticket.title')" min-width="220">
            <template #default="{ row }">
              <div class="table-title">{{ row.title }}</div>
              <div class="table-subtitle">{{ formatDateTime(row.createTime) }}</div>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ticket.type')" width="120">
            <template #default="{ row }">
              <el-tag :type="getTypeTagType(row.type)" effect="light">{{
                getTypeLabel(row.type)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ticket.workflowStatus')" width="140">
            <template #default="{ row }">
              <el-tag :type="getStatusTagType(row.workflowStatus)" effect="light">{{
                getStatusLabel(row.workflowStatus)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ticket.priority')" width="120">
            <template #default="{ row }">
              <el-tag :type="getPriorityTagType(row.priority)" effect="light">{{
                getPriorityLabel(row.priority)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ticket.lastReplyAt')" width="180">
            <template #default="{ row }">{{ formatDateTime(row.lastReplyAt) }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="190" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button link type="primary" @click="$emit('openDetail', row.id)">{{
                  i18ns.t('ticket.viewDetail')
                }}</el-button>
                <el-button
                  v-if="canUpdateTickets && !isTerminalStatus(row.workflowStatus)"
                  link
                  @click="$emit('edit', row.id)"
                  >{{ i18ns.t('edit') }}</el-button
                >
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div v-else v-loading="listLoading" class="mobile-card-list">
          <el-empty
            v-if="!ticketList.length && !listLoading"
            :description="i18ns.t('ticket.emptyState')"
          />
          <el-card
            v-for="item in ticketList"
            :key="item.id"
            class="mobile-ticket-card"
            shadow="never"
          >
            <div class="mobile-ticket-card__header">
              <div>
                <div class="mobile-ticket-card__title">{{ item.title }}</div>
                <div class="table-subtitle">{{ formatDateTime(item.createTime) }}</div>
              </div>
              <el-tag :type="getStatusTagType(item.workflowStatus)" effect="light">{{
                getStatusLabel(item.workflowStatus)
              }}</el-tag>
            </div>
            <div class="mobile-ticket-card__meta">
              <el-tag :type="getTypeTagType(item.type)" effect="light">{{
                getTypeLabel(item.type)
              }}</el-tag>
              <el-tag :type="getPriorityTagType(item.priority)" effect="light">{{
                getPriorityLabel(item.priority)
              }}</el-tag>
            </div>
            <div class="mobile-ticket-card__actions">
              <el-button type="primary" plain @click="$emit('openDetail', item.id)">{{
                i18ns.t('ticket.viewDetail')
              }}</el-button>
              <el-button
                v-if="canUpdateTickets && !isTerminalStatus(item.workflowStatus)"
                @click="$emit('edit', item.id)"
                >{{ i18ns.t('edit') }}</el-button
              >
            </div>
          </el-card>
        </div>

        <el-empty
          v-if="isDesktop && !listLoading && !ticketList.length"
          :description="i18ns.t('ticket.emptyState')"
        />
      </div>

      <div class="pagination-wrapper">
        <el-pagination
          :current-page="pagination.page"
          :page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next"
          @update:current-page="handleCurrentPageUpdate"
          @update:page-size="handlePageSizeUpdate"
          @current-change="$emit('refresh')"
          @size-change="$emit('pageSizeChange')"
        />
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type {
  TicketListItemDto,
  TicketPriority,
  TicketType,
  TicketWorkflowStatus,
} from '@/client/types.gen'
import type { TicketFiltersModel, TicketPaginationModel } from '../types'

const props = defineProps<{
  isDesktop: boolean
  listLoading: boolean
  ticketList: TicketListItemDto[]
  filters: TicketFiltersModel
  pagination: TicketPaginationModel
  canUpdateTickets: boolean
  ticketTypeOptions: TicketType[]
  workflowStatusOptions: TicketWorkflowStatus[]
  getTypeLabel: (type: TicketType) => string
  getStatusLabel: (status: TicketWorkflowStatus) => string
  getPriorityLabel: (priority: TicketPriority) => string
  getTypeTagType: (type: TicketType) => string
  getStatusTagType: (status: TicketWorkflowStatus) => string
  getPriorityTagType: (priority: TicketPriority) => string
  isTerminalStatus: (status?: TicketWorkflowStatus) => boolean
  formatDateTime: (value?: string | null) => string
}>()

const emit = defineEmits<{
  refresh: []
  search: []
  resetFilters: []
  openDetail: [id: string]
  edit: [id: string]
  pageSizeChange: []
  'update:filters': [value: TicketFiltersModel]
  'update:pagination': [value: TicketPaginationModel]
}>()

function updateFilter<K extends keyof TicketFiltersModel>(key: K, value: TicketFiltersModel[K]) {
  emit('update:filters', {
    ...props.filters,
    [key]: value,
  })
}

function updatePagination<K extends keyof TicketPaginationModel>(
  key: K,
  value: TicketPaginationModel[K],
) {
  emit('update:pagination', {
    ...props.pagination,
    [key]: value,
  })
}

function handleCurrentPageUpdate(value: number) {
  updatePagination('page', value)
}

function handlePageSizeUpdate(value: number) {
  updatePagination('pageSize', value)
}
</script>

<style scoped>
.page-card {
  border-radius: 18px;
  height: 100%;
}

.ticket-card {
  overflow: hidden;
}

.ticket-card--list {
  height: 100%;
}

.ticket-card--list :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.list-card-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 16px;
}

.list-card-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.card-header-block {
  display: grid;
  gap: 4px;
}

.card-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.card-title,
.table-title,
.mobile-ticket-card__title {
  font-size: 18px;
  font-weight: 600;
}

.card-description,
.table-subtitle {
  color: var(--el-text-color-secondary);
}

.filter-actions,
.row-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) repeat(2, minmax(130px, 170px)) auto;
  gap: 12px;
}

.mobile-card-list {
  display: grid;
  gap: 18px;
}

.mobile-ticket-card {
  border-radius: 16px;
}

.mobile-ticket-card__header,
.mobile-ticket-card__meta,
.mobile-ticket-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

@media (max-width: 1200px) {
  .filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .card-header-row {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-row {
    grid-template-columns: 1fr;
  }

  .pagination-wrapper {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
