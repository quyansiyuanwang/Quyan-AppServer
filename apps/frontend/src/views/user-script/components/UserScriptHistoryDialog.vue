<template>
  <el-dialog
    :model-value="visible"
    :title="i18ns.t('scriptManager.historyTitle') + ': ' + historyScriptName"
    width="800px"
    :close-on-click-modal="false"
    class="sm-dialog"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-table v-loading="loading" :data="historyList" stripe border>
      <el-table-column :label="i18ns.t('scriptManager.executedAt')" min-width="180">
        <template #default="{ row }">
          {{ new Date(row.createTime).toLocaleString() }}
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('scriptManager.duration')" width="120" prop="durationMs" />
      <el-table-column :label="i18ns.t('scriptManager.output')" min-width="300">
        <template #default="{ row }">
          <el-tooltip :content="row.output" placement="top" :show-after="300">
            <span class="sm-history-preview">{{
              row.output || i18ns.t('scriptManager.noOutput')
            }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && historyList.length === 0" class="sm-no-history">
      {{ i18ns.t('scriptManager.noHistory') }}
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type { UserScriptExecution } from '../types'

defineProps<{
  visible: boolean
  loading: boolean
  historyList: UserScriptExecution[]
  historyScriptName: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<style scoped>
.sm-history-preview {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  cursor: default;
  color: var(--el-text-color-regular);
}

.sm-no-history {
  text-align: center;
  color: var(--el-text-color-placeholder);
  padding: 24px 0;
  font-size: 13px;
}
</style>
