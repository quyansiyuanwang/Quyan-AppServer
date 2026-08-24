<template>
  <div class="content-safety-policy-fields">
    <div class="content-safety-policy-fields__table-wrap">
      <el-table :data="policyRows" border size="small" class="content-safety-policy-fields__table">
        <el-table-column prop="direction" :label="i18ns.t('contentSafety.direction')" width="150">
          <template #default="{ row }">
            <span class="direction-label">{{ row.direction }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('contentSafety.enabled')" width="110" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="localModel[row.enabledKey]" />
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('contentSafety.action')" min-width="330">
          <template #default="{ row }">
            <el-radio-group
              v-model="localModel[row.actionKey]"
              :disabled="!localModel[row.enabledKey]"
              size="small"
            >
              <el-radio-button label="unreachable">
                {{ i18ns.t('contentSafety.unreachable') }}
              </el-radio-button>
              <el-radio-button label="blackhole">
                {{ i18ns.t('contentSafety.blackhole') }}
              </el-radio-button>
              <el-radio-button label="allow">
                {{ i18ns.t('contentSafety.allow') }}
              </el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('contentSafety.aiEnabled')" width="120" align="center">
          <template #default="{ row }">
            <el-checkbox
              v-model="localModel[row.aiKey]"
              :disabled="!localModel[row.enabledKey]"
              @change="emit('ai-toggle', row.aiKey)"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-alert
      v-if="localModel.requestAiEnabled || localModel.responseAiEnabled"
      type="warning"
      :closable="false"
      show-icon
    >
      {{ i18ns.t('contentSafety.aiCostWarning') }}
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import type { ContentSafetyAction } from '@appserver/shared'

interface PolicyModel {
  [key: string]: boolean | ContentSafetyAction
  requestEnabled: boolean
  requestAction: ContentSafetyAction
  requestAiEnabled: boolean
  responseEnabled: boolean
  responseAction: ContentSafetyAction
  responseAiEnabled: boolean
}

const props = defineProps<{ model: PolicyModel }>()
const emit = defineEmits<{
  'update:model': [value: PolicyModel]
  'ai-toggle': [key: 'requestAiEnabled' | 'responseAiEnabled']
}>()
const localModel = computed({
  get: () => props.model,
  set: (value) => emit('update:model', value),
})

const policyRows: Array<{
  direction: string
  enabledKey: 'requestEnabled' | 'responseEnabled'
  actionKey: 'requestAction' | 'responseAction'
  aiKey: 'requestAiEnabled' | 'responseAiEnabled'
}> = [
  {
    direction: i18ns.t('contentSafety.request'),
    enabledKey: 'requestEnabled',
    actionKey: 'requestAction',
    aiKey: 'requestAiEnabled',
  },
  {
    direction: i18ns.t('contentSafety.response'),
    enabledKey: 'responseEnabled',
    actionKey: 'responseAction',
    aiKey: 'responseAiEnabled',
  },
] as const
</script>

<style scoped>
.content-safety-policy-fields__table-wrap {
  width: 100%;
  overflow-x: auto;
}
.content-safety-policy-fields__table {
  min-width: 720px;
}
.direction-label {
  font-weight: 600;
}
</style>
