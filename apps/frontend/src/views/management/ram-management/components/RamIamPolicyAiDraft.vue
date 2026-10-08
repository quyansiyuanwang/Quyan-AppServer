<template>
  <details class="ai-draft">
    <summary>{{ i18ns.t('RamManagement.aiDraftTitle') }}</summary>
    <el-alert :title="i18ns.t('RamManagement.aiDraftHint')" type="info" :closable="false" />
    <el-form label-position="top">
      <el-form-item :label="i18ns.t('RamManagement.aiDraftInstruction')">
        <el-input
          v-model="instruction"
          data-test="ai-instruction"
          type="textarea"
          :rows="3"
          :maxlength="limits.instructionCharacters"
          :disabled="disabled"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.aiDraftModel')">
        <el-input
          v-model="model"
          data-test="ai-model"
          :maxlength="limits.modelCharacters"
          :disabled="disabled"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.aiDraftTokenId')">
        <el-input
          v-model="relayTokenId"
          data-test="ai-token-id"
          :maxlength="limits.tokenIdCharacters"
          :disabled="disabled"
        />
      </el-form-item>
      <el-checkbox
        v-model="includeCurrentDocument"
        data-test="ai-include-current"
        :disabled="disabled"
        >{{ i18ns.t('RamManagement.aiDraftIncludeCurrent') }}</el-checkbox
      >
      <el-button
        data-test="ai-generate"
        :disabled="!canGenerate"
        :loading="loading"
        @click="generate"
        >{{ i18ns.t('RamManagement.aiDraftGenerate') }}</el-button
      >
    </el-form>
    <el-alert
      v-if="failed"
      data-test="ai-failed"
      :title="i18ns.t('RamManagement.aiDraftFailed')"
      type="error"
      :closable="false"
    />
    <div v-if="result" data-test="ai-result">
      <p>
        {{ i18ns.t('RamManagement.aiDraftRisk') }}:
        {{ i18ns.t(riskKeys[result.riskLevel]) }}
      </p>
      <p>
        {{ i18ns.t('RamManagement.aiDraftDelegation') }}:
        {{ i18ns.t(delegationKeys[result.delegation]) }}
      </p>
      <ul v-if="result.explanation.length">
        <li v-for="(item, index) in result.explanation" :key="index">{{ item }}</li>
      </ul>
      <template v-if="result.missingInformation.length">
        <p>{{ i18ns.t('RamManagement.aiDraftMissingInformation') }}</p>
        <ul>
          <li v-for="(item, index) in result.missingInformation" :key="index">{{ item }}</li>
        </ul>
      </template>
      <RamIamPolicyDiagnostics :diagnostics="result.diagnostics" />
      <pre v-if="result.document" data-test="ai-document">{{
        JSON.stringify(result.document, null, 2)
      }}</pre>
      <el-button data-test="ai-apply" :disabled="!canApply" @click="apply">{{
        i18ns.t('RamManagement.aiDraftApply')
      }}</el-button>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  IAM_POLICY_DRAFT_INPUT_LIMITS as limits,
  type IamPolicyDraftKind,
  type IamPolicyDraftResponse,
} from '@quyan/shared'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import RamIamPolicyDiagnostics from './RamIamPolicyDiagnostics.vue'

const props = withDefaults(
  defineProps<{ documentText: string; disabled?: boolean; policyKind?: IamPolicyDraftKind }>(),
  { disabled: false, policyKind: 'identity' },
)
const emit = defineEmits<{ apply: [documentText: string] }>()
const riskKeys = {
  low: 'RamManagement.aiRisk.low',
  medium: 'RamManagement.aiRisk.medium',
  high: 'RamManagement.aiRisk.high',
} as const
const delegationKeys = {
  'not-evaluated': 'RamManagement.aiDelegation.not-evaluated',
  allowed: 'RamManagement.aiDelegation.allowed',
  denied: 'RamManagement.aiDelegation.denied',
} as const
const instruction = ref('')
const model = ref('')
const relayTokenId = ref('')
const includeCurrentDocument = ref(false)
const loading = ref(false)
const failed = ref(false)
const result = ref<IamPolicyDraftResponse>()
let sequence = 0
const invalidate = () => {
  sequence++
  result.value = undefined
  failed.value = false
  loading.value = false
}
watch(
  [
    instruction,
    model,
    relayTokenId,
    includeCurrentDocument,
    () => props.documentText,
    () => props.policyKind,
  ],
  invalidate,
  { flush: 'sync' },
)
onBeforeUnmount(invalidate)
const canGenerate = computed(
  () =>
    !props.disabled &&
    !loading.value &&
    instruction.value.trim().length > 0 &&
    model.value.trim().length > 0 &&
    relayTokenId.value.trim().length > 0 &&
    instruction.value.length <= limits.instructionCharacters &&
    model.value.length <= limits.modelCharacters &&
    relayTokenId.value.length <= limits.tokenIdCharacters &&
    (!includeCurrentDocument.value || props.documentText.length <= limits.inputCharacters),
)
const canApply = computed(
  () =>
    !props.disabled &&
    !loading.value &&
    !!result.value?.document &&
    !result.value.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
)
const generate = async () => {
  if (!canGenerate.value) return
  const ticket = ++sequence
  loading.value = true
  failed.value = false
  result.value = undefined
  try {
    const response = await ramService.generatePolicyDraft({
      instruction: instruction.value.trim(),
      model: model.value.trim(),
      relayTokenId: relayTokenId.value.trim(),
      policyKind: props.policyKind,
      ...(includeCurrentDocument.value ? { currentDocumentText: props.documentText } : {}),
    })
    if (ticket === sequence) result.value = response
  } catch {
    if (ticket === sequence) failed.value = true
  } finally {
    if (ticket === sequence) loading.value = false
  }
}
const apply = () => {
  if (canApply.value && result.value?.document)
    emit('apply', JSON.stringify(result.value.document, null, 2))
}
</script>

<style scoped>
.ai-draft {
  display: grid;
  gap: 12px;
}
.ai-draft summary {
  cursor: pointer;
  margin-bottom: 12px;
}
.ai-draft pre {
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
