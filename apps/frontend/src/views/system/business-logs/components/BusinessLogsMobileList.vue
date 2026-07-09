<template>
  <div class="mobile-list-section">
    <el-skeleton :loading="loading" :rows="5" animated>
      <div v-if="logs.length" class="log-card-list">
        <el-card v-for="row in logs" :key="row.id" class="log-card mobile-card" shadow="never">
          <div class="log-head">
            <el-tag size="small">{{ row.operationType }}</el-tag>
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? i18ns.t('BusinessLogs.success') : i18ns.t('BusinessLogs.failed') }}
            </el-tag>
          </div>

          <div class="log-meta">
            <div>{{ i18ns.t('BusinessLogs.timestamp') }}: {{ formatTimestamp(row.createTime) }}</div>
            <div>
              {{ i18ns.t('BusinessLogs.operationCategory') }}: {{ row.operationCategory || '-' }}
            </div>
            <div>{{ i18ns.t('BusinessLogs.actor') }}: {{ row.actorUsername || i18ns.t('BusinessLogs.system') }}</div>
            <div>{{ i18ns.t('BusinessLogs.target') }}: {{ formatTarget(row) }}</div>
            <div>{{ i18ns.t('BusinessLogs.ipAddress') }}: {{ row.ipAddress || '-' }}</div>
            <div>{{ i18ns.t('BusinessLogs.description') }}: {{ row.description || '-' }}</div>
          </div>

          <el-collapse class="log-details" accordion>
            <el-collapse-item :title="i18ns.t('BusinessLogs.changes')" :name="`biz-log-${row.id}`">
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
                <el-alert type="error" :closable="false">{{ row.errorMessage }}</el-alert>
              </div>
              <div v-if="row.requestId" class="expand-item">
                <strong>{{ i18ns.t('BusinessLogs.requestId') }}:</strong>
                <span>{{ row.requestId }}</span>
              </div>
              <div class="expand-item">
                <strong>{{ i18ns.t('BusinessLogs.userAgent') }}:</strong>
                <span>{{ row.userAgent || '-' }}</span>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-card>
      </div>
      <el-empty v-else />
    </el-skeleton>

    <el-pagination
      :current-page="currentPage"
      :page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]"
      :total="total"
      layout="prev, pager, next"
      class="pager-wrap"
      @update:current-page="$emit('pageChange', $event)"
      @update:page-size="$emit('sizeChange', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type { BusinessLogDto } from '../types'

defineProps<{
  logs: BusinessLogDto[]
  loading: boolean
  currentPage: number
  pageSize: number
  total: number
  formatTimestamp: (timestamp: string) => string
  formatTarget: (row: BusinessLogDto) => string
  formatJson: (data: unknown) => string
}>()

defineEmits<{
  pageChange: [page: number]
  sizeChange: [size: number]
}>()
</script>

<style scoped>
.log-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-card {
  border: 1px solid var(--el-border-color-lighter);
}

.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.log-meta {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.log-details {
  margin-top: 6px;
}

.log-details :deep(.el-collapse-item__header) {
  min-height: 34px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 0 8px;
  background: var(--el-fill-color-light);
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

.pager-wrap {
  margin-top: 12px;
}
</style>
