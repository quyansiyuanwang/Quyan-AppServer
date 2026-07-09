<template>
  <div class="desktop-table-section">
    <el-table
      :data="logs"
      style="width: 100%"
      :expand-row-keys="expandedRows"
      row-key="id"
      @expand-change="handleExpandChange"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="expand-content">
            <div v-if="row.changes" class="expand-item">
              <strong>{{ i18ns.t('BusinessLogs.changes') }}:</strong>
              <pre>{{ formatJson(row.changes) }}</pre>
            </div>

            <div v-if="row.metadata" class="expand-item">
              <strong>{{ i18ns.t('BusinessLogs.metadata') }}:</strong>
              <pre>{{ formatJson(row.metadata) }}</pre>
            </div>

            <div v-if="row.errorMessage" class="expand-item">
              <strong>{{ i18ns.t('BusinessLogs.errorMessage') }}:</strong>
              <el-alert type="error" :closable="false">
                {{ row.errorMessage }}
              </el-alert>
            </div>

            <div v-if="row.requestId" class="expand-item">
              <strong>{{ i18ns.t('BusinessLogs.requestId') }}:</strong>
              <span>{{ row.requestId }}</span>
            </div>

            <div class="expand-item">
              <strong>{{ i18ns.t('BusinessLogs.ipAddress') }}:</strong>
              <span>{{ row.ipAddress }}</span>
            </div>

            <div v-if="row.userAgent" class="expand-item">
              <strong>{{ i18ns.t('BusinessLogs.userAgent') }}:</strong>
              <span>{{ row.userAgent }}</span>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column :label="i18ns.t('BusinessLogs.timestamp')" width="180">
        <template #default="{ row }">
          {{ formatTimestamp(row.createTime) }}
        </template>
      </el-table-column>

      <el-table-column
        :label="i18ns.t('BusinessLogs.operationType')"
        width="180"
        class-name="hide-on-mobile"
      >
        <template #default="{ row }">
          <el-tag size="small">
            {{ row.operationType }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        :label="i18ns.t('BusinessLogs.operationCategory')"
        width="150"
        class-name="hide-on-mobile"
      >
        <template #default="{ row }">
          <el-tag :type="getCategoryType(row.operationCategory)" size="small">
            {{ row.operationCategory }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        :label="i18ns.t('BusinessLogs.actor')"
        width="150"
        class-name="hide-on-mobile"
      >
        <template #default="{ row }">
          <el-tag v-if="row.actorUsername === null" type="info" size="small">
            {{ i18ns.t('BusinessLogs.system') }}
          </el-tag>
          <span v-else>{{ row.actorUsername }}</span>
        </template>
      </el-table-column>

      <el-table-column
        :label="i18ns.t('BusinessLogs.target')"
        width="200"
        class-name="hide-on-mobile"
      >
        <template #default="{ row }">
          <div v-if="row.targetUserId || row.targetUsername">
            <div v-if="row.targetUsername">{{ row.targetUsername }}</div>
            <div v-if="row.targetUserId" class="target-id">ID: {{ row.targetUserId }}</div>
          </div>
          <div v-else-if="row.targetResourceId">
            {{ row.targetResourceType }}: {{ row.targetResourceId }}
          </div>
          <el-tag v-else type="info" size="small">-</el-tag>
        </template>
      </el-table-column>

      <el-table-column :label="i18ns.t('BusinessLogs.description')" min-width="300">
        <template #default="{ row }">
          {{ row.description }}
        </template>
      </el-table-column>

      <el-table-column :label="i18ns.t('BusinessLogs.status')" width="100">
        <template #default="{ row }">
          <el-tag :type="row.success ? 'success' : 'danger'" size="small">
            {{ row.success ? i18ns.t('BusinessLogs.success') : i18ns.t('BusinessLogs.failed') }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        :label="i18ns.t('BusinessLogs.ipAddress')"
        width="150"
        class-name="hide-on-mobile"
      >
        <template #default="{ row }">
          {{ row.ipAddress }}
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      :current-page="currentPage"
      :page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]"
      :total="total"
      layout="total, sizes, prev, pager, next, jumper"
      class="pagination"
      @update:current-page="$emit('pageChange', $event)"
      @update:page-size="$emit('sizeChange', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type { BusinessLogDto, CategoryTagType } from '../types'

defineProps<{
  logs: BusinessLogDto[]
  expandedRows: string[]
  currentPage: number
  pageSize: number
  total: number
  formatTimestamp: (timestamp: string) => string
  formatJson: (data: unknown) => string
  getCategoryType: (category: string) => CategoryTagType
}>()

const emit = defineEmits<{
  expandChange: [row: BusinessLogDto, expandedRowsData: BusinessLogDto[]]
  pageChange: [page: number]
  sizeChange: [size: number]
}>()

function handleExpandChange(row: BusinessLogDto, expandedRowsData: BusinessLogDto[]) {
  emit('expandChange', row, expandedRowsData)
}
</script>

<style scoped>
.pagination {
  margin-top: 20px;
  justify-content: center;
}

.target-id {
  font-size: 12px;
  color: #909399;
}

.expand-content {
  padding: 8px 10px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.expand-item {
  margin-bottom: 6px;
}

.expand-item:last-child {
  margin-bottom: 0;
}

.expand-item strong {
  display: block;
  margin-bottom: 3px;
  color: #606266;
  line-height: 1.25;
}

.expand-item pre {
  background-color: #fff;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.35;
  margin: 0;
}

html.dark .expand-content {
  background-color: #1a1a1a;
}

html.dark .expand-item strong {
  color: #e5e7eb;
}

html.dark .expand-item pre {
  background-color: #262626;
  border-color: #404040;
  color: #e5e7eb;
}
</style>
