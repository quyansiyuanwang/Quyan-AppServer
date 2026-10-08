<template>
  <el-drawer
    :model-value="!!role"
    :title="i18ns.t('RamManagement.trustEditorTitle')"
    size="720px"
    @update:model-value="handleVisibility"
  >
    <template v-if="role">
      <p>
        {{ role.name }} <code>{{ role.id }}</code>
      </p>
      <el-alert :title="i18ns.t('RamManagement.trustEditorHint')" type="info" :closable="false" />
      <RamIamPolicyAiDraft
        policy-kind="trust"
        :document-text="text"
        :disabled="saving"
        @apply="text = $event"
      />
      <el-input
        ref="input"
        v-model="text"
        data-test="trust-text"
        type="textarea"
        :rows="16"
        :disabled="saving"
        spellcheck="false"
        :aria-label="i18ns.t('RamManagement.iamDocument')"
      />
      <div class="trust-toolbar">
        <el-button
          data-test="trust-validate"
          :loading="validating"
          :disabled="saving"
          @click="validate"
          >{{ i18ns.t('RamManagement.validatePolicy') }}</el-button
        >
        <el-button
          data-test="trust-schema"
          :disabled="saving || downloading"
          :loading="downloading"
          @click="downloadSchema"
          >{{ i18ns.t('RamManagement.downloadPolicySchema') }}</el-button
        >
      </div>
      <RamIamPolicyDiagnostics :diagnostics="diagnostics" @select="focusDiagnostic" />
      <el-alert
        v-if="failed"
        :title="i18ns.t('RamManagement.trustEditorFailed')"
        type="error"
        :closable="false"
      />
      <el-tag v-if="validatedDocument" type="success">{{
        i18ns.t('RamManagement.policyValid')
      }}</el-tag>
    </template>
    <template #footer
      ><el-button
        data-test="trust-publish"
        :disabled="!role || saving || validating || !text.trim()"
        :loading="saving"
        @click="publish"
        >{{ i18ns.t('RamManagement.trustEditorPublish') }}</el-button
      ></template
    >
  </el-drawer>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { InputInstance } from 'element-plus/es'
import type { IamDiagnostic, IamTrustPolicyDocument } from '@quyan/shared'
import type { RamRoleDto } from '@/client/types.gen'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { iamDiagnosticOffset } from '../useIamPolicyTools'
import RamIamPolicyDiagnostics from './RamIamPolicyDiagnostics.vue'
import RamIamPolicyAiDraft from './RamIamPolicyAiDraft.vue'
const props = defineProps<{ role: RamRoleDto | null }>()
const emit = defineEmits<{ close: []; saved: [role: RamRoleDto] }>()
const text = ref('')
const diagnostics = shallowRef<IamDiagnostic[]>([])
const validatedDocument = shallowRef<IamTrustPolicyDocument>()
const validating = ref(false),
  saving = ref(false),
  downloading = ref(false),
  failed = ref(false)
const input = ref<InputInstance>()
const handleVisibility = (visible: boolean) => {
  if (!visible && !saving.value) emit('close')
}
let revision = 0,
  sequence = 0
watch(
  text,
  () => {
    revision++
    diagnostics.value = []
    validatedDocument.value = undefined
    failed.value = false
  },
  { flush: 'sync' },
)
watch(
  () => props.role,
  (role) => {
    sequence++
    text.value = role?.trustPolicy ? JSON.stringify(role.trustPolicy, null, 2) : ''
    diagnostics.value = []
    validatedDocument.value = undefined
    failed.value = false
    validating.value = false
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  sequence++
})
const validate = async () => {
  if (!props.role) return undefined
  const ticket = ++sequence,
    version = revision,
    id = props.role.id
  validating.value = true
  failed.value = false
  diagnostics.value = []
  validatedDocument.value = undefined
  try {
    const result = await ramService.diagnosePolicy(text.value, 'trust')
    if (ticket !== sequence || revision !== version || props.role?.id !== id) return undefined
    diagnostics.value = result.diagnostics
    if (!result.valid || !result.document) return undefined
    const statements = Array.isArray(result.document.Statement)
      ? result.document.Statement
      : [result.document.Statement]
    if (!statements.length || statements.some((statement) => !('Principal' in statement))) {
      failed.value = true
      return undefined
    }
    validatedDocument.value = result.document as IamTrustPolicyDocument
    return validatedDocument.value
  } catch {
    if (ticket === sequence) failed.value = true
    return undefined
  } finally {
    if (ticket === sequence) validating.value = false
  }
}
const publish = async () => {
  if (!props.role || saving.value || validating.value) return
  const id = props.role.id,
    hash = props.role.trustPolicyHash
  const document = await validate()
  if (!document || props.role?.id !== id) return
  const version = revision
  try {
    await ElMessageBox.confirm(
      i18ns.t('RamManagement.trustEditorConfirm'),
      i18ns.t('RamManagement.trustEditorPublish'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  if (saving.value || props.role?.id !== id || revision !== version) return
  saving.value = true
  try {
    const updated = await ramService.setRoleTrustPolicy(id, {
      document,
      ...(hash ? { expectedDocumentHash: hash } : {}),
    })
    emit('saved', updated)
    emit('close')
  } catch (error) {
    failed.value = true
    showRequestErrorNotice(error, i18ns.t('RamManagement.trustEditorFailed'))
  } finally {
    saving.value = false
  }
}
const focusDiagnostic = async (diagnostic: IamDiagnostic) => {
  await nextTick()
  const textarea = input.value?.textarea
  if (!textarea) return
  const offset = iamDiagnosticOffset(text.value, diagnostic.line, diagnostic.column)
  textarea.focus()
  textarea.setSelectionRange(offset, offset)
}
const downloadSchema = async () => {
  downloading.value = true
  let url: string | undefined
  try {
    const schema = await ramService.getPolicySchema('trust')
    url = URL.createObjectURL(
      new Blob([JSON.stringify(schema, null, 2)], { type: 'application/schema+json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'quyan-trust-policy.schema.json'
    link.click()
  } catch {
    failed.value = true
  } finally {
    if (url) URL.revokeObjectURL(url)
    downloading.value = false
  }
}
</script>
<style scoped>
.trust-toolbar {
  display: flex;
  gap: 12px;
  margin: 12px 0;
}
:deep(textarea) {
  font-family: monospace;
}
code {
  overflow-wrap: anywhere;
}
</style>
