<template>
  <div class="visual-policy-builder">
    <el-alert :title="i18ns.t('RamManagement.visualDraftHint')" type="info" :closable="false" />
    <div v-for="(row, index) in rows" :key="row.id" class="statement-card">
      <div class="statement-header">
        <strong>{{ i18ns.t('RamManagement.visualStatement') }} {{ index + 1 }}</strong>
        <el-button :disabled="disabled" @click="duplicateStatement(index)">{{
          i18ns.t('RamManagement.visualDuplicate')
        }}</el-button>
        <el-button :disabled="disabled || rows.length === 1" @click="rows.splice(index, 1)">{{
          i18ns.t('RamManagement.visualRemoveStatement')
        }}</el-button>
      </div>
      <RamIamVisualStatement
        v-model:statement="row.statement"
        :account-owner-id="accountOwnerId"
        :disabled="disabled"
      />
    </div>
    <el-button
      data-test="add-statement"
      :disabled="disabled"
      @click="rows.push({ id: nextId++, statement: newVisualStatement() })"
      >{{ i18ns.t('RamManagement.visualAddStatement') }}</el-button
    >
    <el-alert
      v-if="!valid"
      :title="i18ns.t('RamManagement.visualIncomplete')"
      type="warning"
      :closable="false"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { IamPolicyDocument } from '@quyan/shared'
import {
  exportVisualPolicy,
  importVisualPolicy,
  newVisualStatement,
  serializeVisualPolicyDraft,
} from '../iam-visual-policy'
import RamIamVisualStatement from './RamIamVisualStatement.vue'
import { i18ns } from '@/locales'
const props = defineProps<{
  document?: IamPolicyDocument
  accountOwnerId: string
  disabled: boolean
}>()
const emit = defineEmits<{
  document: [document: IamPolicyDocument]
  draft: [text: string]
  validity: [valid: boolean]
}>()
let nextId = 0
const rows = ref(
  (props.document ? importVisualPolicy(props.document) : [newVisualStatement()]).map(
    (statement) => ({ id: nextId++, statement }),
  ),
)
const valid = ref(false)
const duplicateStatement = (index: number) => {
  const source = rows.value[index]
  if (source)
    rows.value.splice(index + 1, 0, {
      id: nextId++,
      statement: JSON.parse(JSON.stringify(source.statement)),
    })
}
watch(
  rows,
  () => {
    emit('draft', serializeVisualPolicyDraft(rows.value.map((row) => row.statement)))
    try {
      const document = exportVisualPolicy(rows.value.map((row) => row.statement))
      valid.value = true
      emit('validity', true)
      emit('document', document)
    } catch {
      valid.value = false
      emit('validity', false)
    }
  },
  { deep: true, immediate: true },
)
</script>
<style scoped>
.visual-policy-builder {
  display: grid;
  gap: 16px;
}
.statement-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
}
.statement-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.statement-header strong {
  margin-right: auto;
}
</style>
