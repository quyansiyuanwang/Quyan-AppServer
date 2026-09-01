<template>
  <div class="content-safety-policy-fields">
    <div class="content-safety-policy-fields__table-wrap">
      <el-table :data="policyRows" border size="small" class="content-safety-policy-fields__table">
        <el-table-column prop="direction" :label="i18ns.t('contentSafety.direction')" width="150">
          <template #default="{ row }">
            <span class="direction-label">{{ row.direction }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('contentSafety.action')" min-width="420">
          <template #default="{ row }">
            <el-radio-group
              :model-value="getMode(row)"
              size="small"
              @update:model-value="setMode(row, $event)"
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
              <el-radio-button label="disabled">
                {{ i18ns.t('contentSafety.disabled') }}
              </el-radio-button>
              <el-radio-button v-if="allowInherit" label="inherit">
                {{ i18ns.t('contentSafety.inherit') }}
              </el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column min-width="300">
          <template #header>
            <span class="label-with-help">
              {{ i18ns.t('contentSafety.maxAction') }}
              <el-tooltip :content="i18ns.t('contentSafety.maxActionHelp')" placement="top">
                <el-icon><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <el-radio-group v-model="localModel[row.maxActionKey]" size="small">
              <el-radio-button v-if="allowInherit" :label="null">{{
                i18ns.t('contentSafety.inherit')
              }}</el-radio-button>
              <el-radio-button label="unreachable">{{
                i18ns.t('contentSafety.unreachable')
              }}</el-radio-button>
              <el-radio-button label="blackhole">{{
                i18ns.t('contentSafety.blackhole')
              }}</el-radio-button>
              <el-radio-button label="allow">{{ i18ns.t('contentSafety.allow') }}</el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('contentSafety.aiAction')" min-width="300">
          <template #default="{ row }">
            <el-radio-group v-model="localModel[row.aiActionKey]" size="small">
              <el-radio-button label="unreachable">{{
                i18ns.t('contentSafety.unreachable')
              }}</el-radio-button>
              <el-radio-button label="blackhole">{{
                i18ns.t('contentSafety.blackhole')
              }}</el-radio-button>
              <el-radio-button label="allow">{{ i18ns.t('contentSafety.allow') }}</el-radio-button>
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
import { QuestionFilled } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import type { ContentSafetyAction } from '@appserver/shared'

interface PolicyModel {
  [key: string]: boolean | null | ContentSafetyAction
  requestEnabled: boolean | null
  requestAction: ContentSafetyAction | null
  requestMaxAction: ContentSafetyAction | null
  requestAiEnabled: boolean | null
  requestAiAction: ContentSafetyAction | null
  responseEnabled: boolean | null
  responseAction: ContentSafetyAction | null
  responseMaxAction: ContentSafetyAction | null
  responseAiEnabled: boolean | null
  responseAiAction: ContentSafetyAction | null
}

const props = withDefaults(
  defineProps<{
    model: PolicyModel
    allowInherit?: boolean
  }>(),
  { allowInherit: false },
)
const emit = defineEmits<{
  'update:model': [value: PolicyModel]
  'ai-toggle': [key: 'requestAiEnabled' | 'responseAiEnabled']
}>()
const localModel = computed({
  get: () => props.model,
  set: (value) => emit('update:model', value),
})

type PolicyRow = (typeof policyRows)[number]
type PolicyMode = ContentSafetyAction | 'disabled' | 'inherit'

const getMode = (row: PolicyRow): PolicyMode => {
  const enabled = localModel.value[row.enabledKey]
  const action = localModel.value[row.actionKey]
  if (enabled === false) return 'disabled'
  if (enabled === null && action === null && props.allowInherit) return 'inherit'
  return action ?? 'unreachable'
}

const setMode = (row: PolicyRow, value: string | number | boolean | undefined) => {
  const mode = String(value) as PolicyMode
  if (mode === 'disabled') {
    localModel.value[row.enabledKey] = false
    return
  }
  if (mode === 'inherit' && props.allowInherit) {
    localModel.value[row.enabledKey] = null
    localModel.value[row.actionKey] = null
    return
  }
  if (mode !== 'unreachable' && mode !== 'blackhole' && mode !== 'allow') return
  localModel.value[row.enabledKey] = true
  localModel.value[row.actionKey] = mode
}

const policyRows: Array<{
  direction: string
  enabledKey: 'requestEnabled' | 'responseEnabled'
  actionKey: 'requestAction' | 'responseAction'
  maxActionKey: 'requestMaxAction' | 'responseMaxAction'
  aiKey: 'requestAiEnabled' | 'responseAiEnabled'
  aiActionKey: 'requestAiAction' | 'responseAiAction'
}> = [
  {
    direction: i18ns.t('contentSafety.request'),
    enabledKey: 'requestEnabled',
    actionKey: 'requestAction',
    maxActionKey: 'requestMaxAction',
    aiKey: 'requestAiEnabled',
    aiActionKey: 'requestAiAction',
  },
  {
    direction: i18ns.t('contentSafety.response'),
    enabledKey: 'responseEnabled',
    actionKey: 'responseAction',
    maxActionKey: 'responseMaxAction',
    aiKey: 'responseAiEnabled',
    aiActionKey: 'responseAiAction',
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
.label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.label-with-help .el-icon {
  color: var(--el-text-color-secondary);
  cursor: help;
}
</style>
