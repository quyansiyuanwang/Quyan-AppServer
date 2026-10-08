<template>
  <div class="iam-policy-editor">
    <el-alert
      :title="i18ns.t('RamManagement.iamManagementHint')"
      type="info"
      :closable="false"
      show-icon
    />
    <el-input
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
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  policyDocumentText,
  policyValidation,
  policyValidationFailed,
  validatingPolicy,
  hasPolicyDeny,
  validatePolicyDocument,
  submitting,
} = useRamManagementContext()
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
