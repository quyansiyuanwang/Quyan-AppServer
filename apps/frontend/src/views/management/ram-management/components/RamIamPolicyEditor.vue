<template>
  <div class="iam-policy-editor">
    <el-alert
      :title="i18ns.t('RamManagement.iamManagementHint')"
      type="info"
      :closable="false"
      show-icon
    />
    <el-select
      v-if="canReadPolicies"
      :model-value="''"
      filterable
      :loading="iamActionsLoading"
      :disabled="submitting || iamActionsLoading"
      :placeholder="i18ns.t('RamManagement.insertIamAction')"
      @change="insertSelectedAction"
    >
      <el-option v-for="action in iamActions" :key="action" :value="action" :label="action" />
    </el-select>
    <el-alert
      v-if="iamActionsFailed"
      :title="i18ns.t('RamManagement.iamActionsFailed')"
      type="warning"
      :closable="false"
    />
    <el-button v-if="iamActionsFailed" :disabled="iamActionsLoading" @click="loadIamActions">
      {{ i18ns.t('RamManagement.reloadIamActions') }}
    </el-button>
    <p>{{ i18ns.t('RamManagement.iamResourceHint') }}</p>
    <el-input
      ref="documentInput"
      v-model="policyDocumentText"
      type="textarea"
      :rows="16"
      :disabled="submitting"
      :placeholder="i18ns.t('RamManagement.iamDocumentPlaceholder')"
      :aria-label="i18ns.t('RamManagement.iamDocument')"
      spellcheck="false"
    />
    <div class="validation-row">
      <el-button :loading="validatingPolicy" :disabled="submitting" @click="validatePolicyDocument">
        {{ i18ns.t('RamManagement.validatePolicy') }}
      </el-button>
      <el-tag v-if="policyValidation" type="success">{{
        i18ns.t('RamManagement.policyValid')
      }}</el-tag>
    </div>
    <el-alert
      v-if="policyValidationFailed"
      :title="i18ns.t('RamManagement.policyValidationFailed')"
      type="error"
      :closable="false"
      show-icon
    />
    <el-alert
      v-if="hasPolicyDeny"
      :title="i18ns.t('RamManagement.iamDenyWarning')"
      type="warning"
      :closable="false"
      show-icon
    />
    <el-alert
      v-if="policyValidation?.broadWildcard"
      :title="i18ns.t('RamManagement.iamWildcardWarning')"
      type="warning"
      :closable="false"
      show-icon
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import type { InputInstance } from 'element-plus/es'
import { insertIamAction } from '../useIamPolicyTools'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  iamActions,
  iamActionsLoading,
  iamActionsFailed,
  loadIamActions,
  canReadPolicies,
  policyDocumentText,
  policyValidation,
  policyValidationFailed,
  validatingPolicy,
  hasPolicyDeny,
  validatePolicyDocument,
  submitting,
} = useRamManagementContext()
const documentInput = ref<InputInstance>()
onMounted(() => {
  if (canReadPolicies.value) void loadIamActions()
})
const insertSelectedAction = async (action: string) => {
  const textarea = documentInput.value?.textarea
  if (!textarea || !iamActions.value.includes(action)) return
  const result = insertIamAction(
    policyDocumentText.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    action,
  )
  if (!result) return
  policyDocumentText.value = result.text
  await nextTick()
  textarea.focus()
  textarea.setSelectionRange(result.cursor, result.cursor)
}
</script>

<style scoped>
.iam-policy-editor {
  display: grid;
  gap: 12px;
  width: 100%;
}
.iam-policy-editor :deep(textarea) {
  font-family: monospace;
}
.validation-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
