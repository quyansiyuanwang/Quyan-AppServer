<template>
  <main class="content-safety" v-loading="loading">
    <header class="content-safety__header">
      <div>
        <h2>{{ i18ns.t('contentSafety.title') }}</h2>
        <p>{{ i18ns.t('contentSafety.description') }}</p>
      </div>
      <el-button type="primary" :loading="saving" @click="saveConfig">{{
        i18ns.t('save')
      }}</el-button>
    </header>
    <el-alert
      v-if="form.requestAiEnabled || form.responseAiEnabled"
      type="warning"
      :closable="false"
      show-icon
    >
      {{ i18ns.t('contentSafety.aiCostWarning') }}
    </el-alert>
    <el-divider content-position="left">{{ i18ns.t('contentSafety.request') }}</el-divider>
    <el-form label-position="top" class="content-safety__form">
      <el-form-item :label="i18ns.t('contentSafety.enabled')"
        ><el-switch v-model="form.requestEnabled"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.action')"
        ><el-select v-model="form.requestAction"
          ><el-option value="unreachable" :label="i18ns.t('contentSafety.unreachable')" /><el-option
            value="blackhole"
            :label="i18ns.t('contentSafety.blackhole')" /><el-option
            value="allow"
            :label="i18ns.t('contentSafety.allow')" /></el-select
      ></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.aiEnabled')"
        ><el-switch v-model="form.requestAiEnabled"
      /></el-form-item>
    </el-form>
    <el-divider content-position="left">{{ i18ns.t('contentSafety.response') }}</el-divider>
    <el-form label-position="top" class="content-safety__form">
      <el-form-item :label="i18ns.t('contentSafety.enabled')"
        ><el-switch v-model="form.responseEnabled"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.action')"
        ><el-select v-model="form.responseAction"
          ><el-option value="unreachable" :label="i18ns.t('contentSafety.unreachable')" /><el-option
            value="blackhole"
            :label="i18ns.t('contentSafety.blackhole')" /><el-option
            value="allow"
            :label="i18ns.t('contentSafety.allow')" /></el-select
      ></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.aiEnabled')"
        ><el-switch v-model="form.responseAiEnabled"
      /></el-form-item>
    </el-form>
    <el-divider content-position="left">{{ i18ns.t('contentSafety.aiChannel') }}</el-divider>
    <el-form label-position="top" class="content-safety__form">
      <el-form-item :label="i18ns.t('contentSafety.url')"
        ><el-input v-model="form.aiUpstreamUrl"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.model')"
        ><el-input v-model="form.aiModel"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.format')"
        ><el-select v-model="form.aiRequestFormat"
          ><el-option value="openai-chat-completions" label="OpenAI" /><el-option
            value="anthropic"
            label="Anthropic" /><el-option value="gemini" label="Gemini" /></el-select
      ></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.apiKey')"
        ><el-input
          v-model="apiKey"
          type="password"
          show-password
          :placeholder="form.aiApiKeyConfigured ? i18ns.t('contentSafety.configured') : ''"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.inputPrice')"
        ><el-input-number v-model="form.aiInputPricePerMillion" :min="0" :precision="6"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.outputPrice')"
        ><el-input-number v-model="form.aiOutputPricePerMillion" :min="0" :precision="6"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.timeoutMs')"
        ><el-input-number v-model="form.aiTimeoutMs" :min="1000" :max="30000"
      /></el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.maxTextLength')"
        ><el-input-number v-model="form.aiMaxTextLength" :min="1000" :max="100000"
      /></el-form-item>
    </el-form>
    <div class="content-safety__rules">
      <div class="content-safety__rule-header">
        <h3>{{ i18ns.t('contentSafety.rules') }}</h3>
        <div class="content-safety__rule-actions">
          <el-button @click="downloadCsv">{{ i18ns.t('contentSafety.downloadCsv') }}</el-button
          ><el-button @click="chooseCsv">{{ i18ns.t('contentSafety.importCsv') }}</el-button
          ><input
            ref="csvInput"
            class="content-safety__file-input"
            type="file"
            accept=".csv,text/csv"
            @change="importCsv"
          /><el-button @click="importDefaults">{{
            i18ns.t('contentSafety.importDefaults')
          }}</el-button
          ><el-button type="primary" @click="openRule()">{{
            i18ns.t('contentSafety.addRule')
          }}</el-button>
        </div>
      </div>
      <el-table :data="rules" border
        ><el-table-column prop="name" :label="i18ns.t('contentSafety.name')" /><el-table-column
          prop="type"
          :label="i18ns.t('contentSafety.type')"
        /><el-table-column
          prop="direction"
          :label="i18ns.t('contentSafety.direction')"
        /><el-table-column prop="action" :label="i18ns.t('contentSafety.action')" /><el-table-column
          prop="priority"
          :label="i18ns.t('contentSafety.priority')"
        /><el-table-column
          prop="enabled"
          :label="i18ns.t('contentSafety.enabled')"
        /><el-table-column width="150"
          ><template #default="{ row }"
            ><el-button link @click="openRule(row)">{{ i18ns.t('contentSafety.edit') }}</el-button
            ><el-button link type="danger" @click="removeRule(row.id)">{{
              i18ns.t('delete')
            }}</el-button></template
          ></el-table-column
        ></el-table
      >
    </div>
    <div class="content-safety__rules">
      <div class="content-safety__rule-header">
        <h3>{{ i18ns.t('contentSafety.incidents') }}</h3>
      </div>
      <el-table :data="incidents" border
        ><el-table-column
          prop="createTime"
          :label="i18ns.t('contentSafety.time')" /><el-table-column
          prop="direction"
          :label="i18ns.t('contentSafety.direction')" /><el-table-column
          prop="action"
          :label="i18ns.t('contentSafety.action')" /><el-table-column
          prop="source"
          :label="i18ns.t('contentSafety.source')" /><el-table-column
          prop="model"
          :label="i18ns.t('contentSafety.model')" /><el-table-column
          prop="auditTotalTokens"
          :label="i18ns.t('contentSafety.auditTokens')" /><el-table-column
          prop="blocked"
          :label="i18ns.t('contentSafety.blocked')"
      /></el-table>
      <el-pagination
        v-model:current-page="incidentPage"
        v-model:page-size="incidentPageSize"
        :total="incidentTotal"
        layout="prev, pager, next, sizes"
        @current-change="loadIncidents"
        @size-change="loadIncidents"
      />
    </div>
    <el-dialog
      v-model="ruleDialog"
      :title="editingRuleId ? i18ns.t('contentSafety.edit') : i18ns.t('contentSafety.addRule')"
      width="520px"
      ><el-form label-position="top"
        ><el-form-item :label="i18ns.t('contentSafety.name')"
          ><el-input v-model="rule.name" /></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.type')"
          ><el-select v-model="rule.type"
            ><el-option value="literal" label="literal" /><el-option
              value="regex"
              label="regex" /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.pattern')"
          ><el-input v-model="rule.pattern" type="textarea" /></el-form-item
        ><el-form-item
          v-if="rule.type === 'regex'"
          :label="i18ns.t('contentSafety.regexValidation')"
          ><span :class="regexValid ? 'is-valid' : 'is-invalid'">{{
            regexValid ? 'OK' : i18ns.t('contentSafety.invalidRegex')
          }}</span></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.direction')"
          ><el-select v-model="rule.direction"
            ><el-option value="request" label="request" /><el-option
              value="response"
              label="response" /><el-option value="both" label="both" /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.action')"
          ><el-select v-model="rule.action"
            ><el-option value="unreachable" label="unreachable" /><el-option
              value="blackhole"
              label="blackhole" /><el-option
              value="allow"
              label="allow" /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.priority')"
          ><el-input-number v-model="rule.priority" :min="0" :max="100000" /></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.enabled')"
          ><el-switch v-model="rule.enabled" /></el-form-item></el-form
      ><template #footer
        ><el-button @click="ruleDialog = false">{{ i18ns.t('cancel') }}</el-button
        ><el-button type="primary" :disabled="!regexValid" @click="saveRule">{{
          i18ns.t('save')
        }}</el-button></template
      ></el-dialog
    >
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { useRequestStore } from '@/stores/request'
import { createContentSafetyControllerApi } from '@/client/services/content-safety-controller.gen'
const api = () => createContentSafetyControllerApi(useRequestStore().getAxios())
const loading = ref(false),
  saving = ref(false),
  apiKey = ref(''),
  ruleDialog = ref(false),
  csvInput = ref<HTMLInputElement | null>(null)
const rules = ref<any[]>([]),
  incidents = ref<any[]>([]),
  incidentPage = ref(1),
  incidentPageSize = ref(20),
  incidentTotal = ref(0),
  editingRuleId = ref<string | null>(null)
const form = reactive<any>({
  requestEnabled: true,
  requestAction: 'unreachable',
  requestAiEnabled: false,
  responseEnabled: true,
  responseAction: 'unreachable',
  responseAiEnabled: false,
  aiUpstreamUrl: '',
  aiApiKeyConfigured: false,
  aiModel: '',
  aiRequestFormat: 'openai-chat-completions',
  aiTimeoutMs: 5000,
  aiInputPricePerMillion: 0,
  aiOutputPricePerMillion: 0,
  aiMaxTextLength: 16000,
})
const rule = reactive<any>({
  name: '',
  type: 'literal',
  pattern: '',
  direction: 'both',
  action: 'unreachable',
  enabled: true,
  priority: 100,
})
const regexValid = computed(() => {
  if (rule.type !== 'regex') return true
  try {
    const re = new RegExp(rule.pattern, 'iu')
    return rule.pattern.length >= 2 && !re.test('')
  } catch {
    return false
  }
})
const unwrap = (value: any) => value?.data?.data ?? value?.data ?? value
const loadIncidents = async () => {
  const result = unwrap(
    await api().listIncidents({
      params: { page: incidentPage.value, pageSize: incidentPageSize.value },
    }),
  )
  incidents.value = result?.incidents ?? []
  incidentTotal.value = result?.total ?? 0
}
const load = async () => {
  loading.value = true
  try {
    Object.assign(form, unwrap(await api().getConfig()))
    const result = unwrap(await api().listRules({ params: { page: 1, pageSize: 100 } }))
    rules.value = result?.rules ?? []
    await loadIncidents()
  } finally {
    loading.value = false
  }
}
const saveConfig = async () => {
  if (
    (form.requestAiEnabled || form.responseAiEnabled) &&
    !(await ElMessageBox.confirm(
      i18ns.t('contentSafety.aiCostWarning'),
      i18ns.t('contentSafety.confirmAi'),
      { type: 'warning' },
    ).catch(() => false))
  )
    return
  saving.value = true
  try {
    Object.assign(
      form,
      unwrap(await api().updateConfig({ body: { ...form, aiApiKey: apiKey.value || undefined } })),
    )
    apiKey.value = ''
    ElMessage.success(i18ns.t('success'))
  } finally {
    saving.value = false
  }
}
const importDefaults = async () => {
  await api().importDefaults({})
  await load()
}
const chooseCsv = () => csvInput.value?.click()
const downloadCsv = () => {
  const link = document.createElement('a')
  link.href = '/content-safety-basic.csv'
  link.download = 'content-safety-basic.csv'
  link.click()
}
const importCsv = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const result = unwrap(await api().importCsv({ body: { csv: await file.text() } }))
    ElMessage.success(
      `${i18ns.t('contentSafety.imported')}: ${result?.imported ?? 0}, ${i18ns.t('contentSafety.skipped')}: ${result?.skipped ?? 0}`,
    )
    if (result?.errors?.length)
      ElMessage.warning(`${i18ns.t('contentSafety.importErrors')}: ${result.errors.length}`)
    await load()
  } finally {
    input.value = ''
  }
}
const openRule = (row?: any) => {
  editingRuleId.value = row?.id ?? null
  Object.assign(
    rule,
    row
      ? { ...row }
      : {
          name: '',
          type: 'literal',
          pattern: '',
          direction: 'both',
          action: 'unreachable',
          enabled: true,
          priority: 100,
        },
  )
  ruleDialog.value = true
}
const saveRule = async () => {
  if (editingRuleId.value) await api().updateRule({ path: { id: editingRuleId.value }, body: rule })
  else await api().createRule({ body: rule })
  ruleDialog.value = false
  await load()
}
const removeRule = async (id: string) => {
  await ElMessageBox.confirm(i18ns.t('contentSafety.confirmDelete'))
  await api().deleteRule({ path: { id } })
  await load()
}
onMounted(() => void load())
</script>
<style scoped>
.content-safety {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}
.content-safety__header,
.content-safety__rule-header {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}
.content-safety__header p {
  color: var(--el-text-color-secondary);
}
.content-safety__form {
  max-width: 700px;
}
.content-safety__rules {
  margin-top: 24px;
}
.content-safety__rule-header {
  justify-content: flex-start;
  margin-bottom: 12px;
}
.content-safety__rule-header h3 {
  margin-right: auto;
}
.content-safety__rule-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.content-safety__file-input {
  display: none;
}
.is-valid {
  color: var(--el-color-success);
}
.is-invalid {
  color: var(--el-color-danger);
}
</style>
