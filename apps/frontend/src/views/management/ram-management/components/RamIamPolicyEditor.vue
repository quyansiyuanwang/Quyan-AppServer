<template>
  <div class="iam-policy-editor">
    <el-alert
      :title="i18ns.t('RamManagement.iamManagementHint')"
      type="info"
      :closable="false"
      show-icon
    />
    <div class="editor-mode-row">
      <el-button
        data-test="json-mode"
        :disabled="submitting || (policyEditorMode === 'visual' && !visualPolicyValid)"
        @click="policyEditorMode = 'json'"
        >{{ i18ns.t('RamManagement.visualJsonMode') }}</el-button
      >
      <el-button
        data-test="visual-mode"
        :disabled="submitting || switchingEditor || policyEditorMode === 'visual'"
        :loading="switchingEditor"
        @click="openVisualEditor"
        >{{ i18ns.t('RamManagement.visualMode') }}</el-button
      >
    </div>
    <RamIamVisualPolicyBuilder
      v-if="policyEditorMode === 'visual'"
      :document="visualDocument"
      :account-owner-id="iamAccountOwnerId ?? ''"
      :disabled="submitting"
      @document="applyVisualDocument"
      @validity="visualPolicyValid = $event"
    />
    <el-select
      v-if="canReadPolicies && policyEditorMode === 'json'"
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
      v-if="policyEditorMode === 'json'"
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
      <el-button
        data-test="validate-policy"
        :loading="validatingPolicy"
        :disabled="submitting"
        @click="validatePolicyDocument"
      >
        {{ i18ns.t('RamManagement.validatePolicy') }}
      </el-button>
      <el-button :disabled="submitting || validatingPolicy" @click="formatDocument">{{
        i18ns.t('RamManagement.formatPolicy')
      }}</el-button>
      <el-button
        v-if="canReadPolicies"
        :loading="schemaDownloading"
        :disabled="submitting"
        @click="downloadSchema"
        >{{ i18ns.t('RamManagement.downloadPolicySchema') }}</el-button
      >
      <el-tag v-if="policyValidation" type="success">{{
        i18ns.t('RamManagement.policyValid')
      }}</el-tag>
    </div>
    <RamIamPolicyDiagnostics :diagnostics="policyDiagnostics" @select="focusDiagnostic" />
    <el-alert
      v-if="schemaDownloadFailed"
      :title="i18ns.t('RamManagement.policySchemaFailed')"
      type="error"
      :closable="false"
    />
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
import type { IamPolicyDocument, IamDiagnostic } from '@quyan/shared'
import RamIamVisualPolicyBuilder from './RamIamVisualPolicyBuilder.vue'
import { importVisualPolicy } from '../iam-visual-policy'
import RamIamPolicyDiagnostics from './RamIamPolicyDiagnostics.vue'
import { ramService } from '@/service/ramService'
import { iamDiagnosticOffset, insertIamAction } from '../useIamPolicyTools'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  iamAccountOwnerId,
  policyEditorMode,
  visualPolicyValid,
  iamActions,
  iamActionsLoading,
  iamActionsFailed,
  loadIamActions,
  canReadPolicies,
  policyDocumentText,
  policyValidation,
  policyDiagnostics,
  policyValidationFailed,
  validatingPolicy,
  hasPolicyDeny,
  validatePolicyDocument,
  getValidatedPolicyDocument,
  submitting,
} = useRamManagementContext()
const documentInput = ref<InputInstance>()
const visualDocument = ref<IamPolicyDocument>()
const switchingEditor = ref(false)
const openVisualEditor = async () => {
  switchingEditor.value = true
  try {
    const document = policyDocumentText.value.trim()
      ? await getValidatedPolicyDocument()
      : undefined
    if (policyDocumentText.value.trim() && !document) return
    if (document) importVisualPolicy(document)
    visualDocument.value = document
    visualPolicyValid.value = false
    policyEditorMode.value = 'visual'
  } catch {
    policyValidationFailed.value = true
  } finally {
    switchingEditor.value = false
  }
}
const applyVisualDocument = (document: IamPolicyDocument) => {
  policyDocumentText.value = JSON.stringify(document, null, 2)
}

const schemaDownloading = ref(false)
const schemaDownloadFailed = ref(false)
const focusDiagnostic = async (diagnostic: IamDiagnostic) => {
  policyEditorMode.value = 'json'
  await nextTick()
  const textarea = documentInput.value?.textarea
  if (!textarea) return
  const offset = iamDiagnosticOffset(policyDocumentText.value, diagnostic.line, diagnostic.column)
  textarea.focus()
  textarea.setSelectionRange(offset, offset)
}
const formatDocument = async () => {
  const document = await getValidatedPolicyDocument()
  if (document) policyDocumentText.value = JSON.stringify(document, null, 2)
}
const downloadSchema = async () => {
  schemaDownloading.value = true
  schemaDownloadFailed.value = false
  let url: string | undefined
  try {
    const schema = await ramService.getPolicySchema()
    url = URL.createObjectURL(
      new Blob([JSON.stringify(schema, null, 2)], { type: 'application/schema+json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'quyan-identity-policy.schema.json'
    link.click()
  } catch {
    schemaDownloadFailed.value = true
  } finally {
    if (url) URL.revokeObjectURL(url)
    schemaDownloading.value = false
  }
}
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
.editor-mode-row,
.validation-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
