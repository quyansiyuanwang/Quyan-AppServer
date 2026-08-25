<template>
  <section class="content-safety-management" v-loading="loading">
    <el-collapse v-model="sections">
      <el-collapse-item name="policy">
        <template #title
          ><span class="collapse-title">{{ i18ns.t('contentSafety.policy') }}</span></template
        >
        <ContentSafetyPolicyFields v-model:model="form" @ai-toggle="confirmAiToggle" />
        <el-form label-position="right" label-width="190px">
          <el-form-item :label="i18ns.t('contentSafety.url')"
            ><el-input v-model="form.aiUpstreamUrl"
          /></el-form-item>
          <el-form-item :label="i18ns.t('contentSafety.model')"
            ><el-input v-model="form.aiModel"
          /></el-form-item>
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
          <el-form-item :label="i18ns.t('contentSafety.format')"
            ><el-radio-group v-model="form.aiRequestFormat" size="small">
              <el-radio-button label="openai-chat-completions">OpenAI</el-radio-button>
              <el-radio-button label="anthropic">Anthropic</el-radio-button>
              <el-radio-button label="gemini">Gemini</el-radio-button>
            </el-radio-group></el-form-item
          >
          <el-form-item :label="i18ns.t('contentSafety.timeoutMs')"
            ><el-input-number v-model="form.aiTimeoutMs" :min="1000" :max="30000" :step="500"
          /></el-form-item>
          <el-form-item :label="i18ns.t('contentSafety.maxTextLength')"
            ><el-input-number v-model="form.aiMaxTextLength" :min="1000" :max="100000" :step="1000"
          /></el-form-item>
        </el-form>
        <el-button type="primary" :loading="saving" @click="save">{{ i18ns.t('save') }}</el-button>
      </el-collapse-item>
      <el-collapse-item name="rules">
        <template #title
          ><span class="collapse-title">{{ i18ns.t('contentSafety.rules') }}</span></template
        >
        <div class="toolbar">
          <el-button size="small" type="primary" @click="openRule()">{{
            i18ns.t('contentSafety.addRule')
          }}</el-button
          ><el-button size="small" @click="importDefaults">{{
            i18ns.t('contentSafety.importDefaults')
          }}</el-button
          ><el-button size="small" @click="chooseCsv">{{
            i18ns.t('contentSafety.importCsv')
          }}</el-button
          ><input ref="csvInput" hidden type="file" accept=".csv,text/csv" @change="importCsv" />
          <el-button size="small" @click="exportPolicy('json')">{{
            i18ns.t('contentSafety.exportJson')
          }}</el-button>
          <el-button size="small" @click="exportPolicy('csv')">{{
            i18ns.t('contentSafety.exportCsv')
          }}</el-button>
          <el-button v-if="selectedRules.length" size="small" @click="openBatchDialog">{{
            i18ns.t('contentSafety.batchEdit')
          }}</el-button>
          <el-button
            v-if="selectedRules.length"
            size="small"
            type="success"
            @click="batchSetEnabled(true)"
            >{{ i18ns.t('contentSafety.batchEnable') }}</el-button
          >
          <el-button
            v-if="selectedRules.length"
            size="small"
            type="warning"
            @click="batchSetEnabled(false)"
            >{{ i18ns.t('contentSafety.batchDisable') }}</el-button
          >
        </div>
        <el-table :data="rules" border size="small" @selection-change="selectedRules = $event"
          ><el-table-column type="selection" width="42" /><el-table-column
            prop="name"
            :label="i18ns.t('contentSafety.name')"
          /><el-table-column prop="type" :label="i18ns.t('contentSafety.type')" /><el-table-column
            prop="direction"
            :label="i18ns.t('contentSafety.direction')"
          /><el-table-column
            prop="action"
            :label="i18ns.t('contentSafety.action')"
          /><el-table-column
            prop="priority"
            :label="i18ns.t('contentSafety.priority')"
            width="90"
          /><el-table-column :label="i18ns.t('contentSafety.enabled')" width="100"
            ><template #default="{ row }"
              ><el-switch
                v-model="row.enabled"
                @change="toggleRule(row)" /></template></el-table-column
          ><el-table-column width="150"
            ><template #default="{ row }"
              ><el-button link @click="openRule(row)">{{ i18ns.t('contentSafety.edit') }}</el-button
              ><el-button link type="danger" @click="removeRule(row.id)">{{
                i18ns.t('delete')
              }}</el-button></template
            ></el-table-column
          ></el-table
        >
        <el-pagination
          v-model:current-page="rulePage"
          v-model:page-size="rulePageSize"
          :total="ruleTotal"
          layout="prev, pager, next, sizes"
          @current-change="loadRules"
          @size-change="loadRules"
        />
      </el-collapse-item>
      <el-collapse-item name="incidents">
        <template #title
          ><span class="collapse-title">{{ i18ns.t('contentSafety.incidents') }}</span></template
        >
        <el-table :data="incidents" border size="small"
          ><el-table-column
            prop="createTime"
            :label="i18ns.t('contentSafety.time')" /><el-table-column
            prop="direction"
            :label="i18ns.t('contentSafety.direction')" /><el-table-column
            prop="action"
            :label="i18ns.t('contentSafety.action')" /><el-table-column
            prop="source"
            :label="i18ns.t('contentSafety.source')" /><el-table-column
            prop="rule.name"
            :label="i18ns.t('contentSafety.triggerRule')"
            min-width="150" /><el-table-column
            prop="rule.type"
            :label="i18ns.t('contentSafety.type')"
            width="90" /><el-table-column
            prop="requestId"
            :label="i18ns.t('contentSafety.requestId')"
            min-width="150" /><el-table-column
            prop="relayTokenId"
            :label="i18ns.t('contentSafety.tokenId')"
            min-width="150" /><el-table-column
            prop="channelId"
            :label="i18ns.t('contentSafety.channelId')"
            min-width="130" /><el-table-column
            :label="i18ns.t('contentSafety.matchedContext')"
            min-width="360"
            ><template #default="{ row }"
              ><span
                class="matched-context"
                v-html="formatMatchedContext(row)" /></template></el-table-column
          ><el-table-column
            prop="auditTotalTokens"
            :label="i18ns.t('contentSafety.auditTokens')" /><el-table-column
            prop="blocked"
            :label="i18ns.t('contentSafety.blocked')"
        /></el-table>
        <div class="incident-filter">
          <el-input
            v-model="incidentUserId"
            clearable
            :placeholder="i18ns.t('contentSafety.userIdFilter')"
            @keyup.enter="loadIncidents"
          />
          <el-button @click="loadIncidents">{{ i18ns.t('contentSafety.filter') }}</el-button>
        </div>
        <el-pagination
          v-model:current-page="incidentPage"
          v-model:page-size="incidentPageSize"
          :total="incidentTotal"
          layout="prev, pager, next, sizes"
          @current-change="loadIncidents"
          @size-change="loadIncidents"
        />
      </el-collapse-item>
    </el-collapse>
  </section>
  <el-dialog
    v-model="ruleDialog"
    :title="editingId ? i18ns.t('contentSafety.edit') : i18ns.t('contentSafety.addRule')"
    width="520px"
  >
    <el-form label-position="top"
      ><el-form-item :label="i18ns.t('contentSafety.name')"
        ><el-input v-model="rule.name" /></el-form-item
      ><el-form-item :label="i18ns.t('contentSafety.type')"
        ><el-radio-group v-model="rule.type" size="small"
          ><el-radio-button label="literal">literal</el-radio-button
          ><el-radio-button label="regex">regex</el-radio-button></el-radio-group
        ></el-form-item
      ><el-form-item :label="i18ns.t('contentSafety.pattern')"
        ><el-input v-model="rule.pattern" type="textarea" /></el-form-item
      ><el-form-item :label="i18ns.t('contentSafety.direction')"
        ><el-radio-group v-model="rule.direction" size="small"
          ><el-radio-button label="request">{{ i18ns.t('contentSafety.request') }}</el-radio-button
          ><el-radio-button label="response">{{
            i18ns.t('contentSafety.response')
          }}</el-radio-button
          ><el-radio-button label="both">{{
            i18ns.t('contentSafety.both')
          }}</el-radio-button></el-radio-group
        ></el-form-item
      ><el-form-item :label="i18ns.t('contentSafety.action')"
        ><el-radio-group v-model="rule.action" size="small"
          ><el-radio-button label="unreachable">{{
            i18ns.t('contentSafety.unreachable')
          }}</el-radio-button
          ><el-radio-button label="blackhole">{{
            i18ns.t('contentSafety.blackhole')
          }}</el-radio-button
          ><el-radio-button label="allow">{{
            i18ns.t('contentSafety.allow')
          }}</el-radio-button></el-radio-group
        ></el-form-item
      ><el-form-item :label="i18ns.t('contentSafety.priority')"
        ><el-input-number v-model="rule.priority" :min="0" :max="100000" /></el-form-item
      ><el-form-item :label="i18ns.t('contentSafety.enabled')"
        ><el-switch v-model="rule.enabled" /></el-form-item
    ></el-form>
    <template #footer
      ><el-button @click="ruleDialog = false">{{ i18ns.t('cancel') }}</el-button
      ><el-button type="primary" @click="saveRule">{{ i18ns.t('save') }}</el-button></template
    >
  </el-dialog>
  <el-dialog v-model="batchDialog" :title="i18ns.t('contentSafety.batchEdit')" width="520px">
    <el-alert
      :title="i18ns.t('contentSafety.selectedCount', { count: selectedRules.length })"
      type="info"
      :closable="false"
    />
    <el-form label-position="top" class="batch-form">
      <el-form-item>
        <template #label
          ><el-checkbox v-model="batchFields.action">{{
            i18ns.t('contentSafety.action')
          }}</el-checkbox></template
        >
        <el-radio-group v-model="batchChanges.action" :disabled="!batchFields.action">
          <el-radio-button label="unreachable">{{
            i18ns.t('contentSafety.unreachable')
          }}</el-radio-button>
          <el-radio-button label="blackhole">{{
            i18ns.t('contentSafety.blackhole')
          }}</el-radio-button>
          <el-radio-button label="allow">{{ i18ns.t('contentSafety.allow') }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item>
        <template #label
          ><el-checkbox v-model="batchFields.direction">{{
            i18ns.t('contentSafety.direction')
          }}</el-checkbox></template
        >
        <el-radio-group v-model="batchChanges.direction" :disabled="!batchFields.direction">
          <el-radio-button label="request">{{ i18ns.t('contentSafety.request') }}</el-radio-button>
          <el-radio-button label="response">{{
            i18ns.t('contentSafety.response')
          }}</el-radio-button>
          <el-radio-button label="both">{{ i18ns.t('contentSafety.both') }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item>
        <template #label
          ><el-checkbox v-model="batchFields.priority">{{
            i18ns.t('contentSafety.priority')
          }}</el-checkbox></template
        >
        <el-input-number
          v-model="batchChanges.priority"
          :disabled="!batchFields.priority"
          :min="0"
          :max="100000"
        />
      </el-form-item>
    </el-form>
    <template #footer
      ><el-button @click="batchDialog = false">{{ i18ns.t('cancel') }}</el-button
      ><el-button type="primary" @click="saveBatch">{{ i18ns.t('save') }}</el-button></template
    >
  </el-dialog>
  <el-dialog v-model="importDialog" :title="i18ns.t('contentSafety.importPreview')" width="760px">
    <el-alert v-if="importPreview" type="info" :closable="false">
      {{ i18ns.t('contentSafety.createCount', { count: importPreview.imported }) }} ·
      {{ i18ns.t('contentSafety.updateCount', { count: importPreview.updated ?? 0 }) }} ·
      {{ i18ns.t('contentSafety.skipCount', { count: importPreview.skipped ?? 0 }) }}
    </el-alert>
    <el-checkbox v-model="overwriteExisting" class="import-overwrite">{{
      i18ns.t('contentSafety.overwriteExisting')
    }}</el-checkbox>
    <el-table
      v-if="importPreview"
      :data="importPreview.operations ?? []"
      border
      size="small"
      max-height="360"
    >
      <el-table-column prop="row" label="#" width="60" /><el-table-column
        prop="operation"
        :label="i18ns.t('contentSafety.action')"
        width="100"
      /><el-table-column prop="name" :label="i18ns.t('contentSafety.name')" /><el-table-column
        prop="pattern"
        :label="i18ns.t('contentSafety.pattern')"
      />
    </el-table>
    <template #footer
      ><el-button @click="importDialog = false">{{ i18ns.t('cancel') }}</el-button
      ><el-button
        type="primary"
        :disabled="Boolean(importPreview?.errors?.length)"
        @click="applyImport"
        >{{ i18ns.t('confirm') }}</el-button
      ></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { useRequestStore } from '@/stores/request'
import { createContentSafetyControllerApi } from '@/client/services/content-safety-controller.gen'
import ContentSafetyPolicyFields from './ContentSafetyPolicyFields.vue'
const api = () => createContentSafetyControllerApi(useRequestStore().getAxios())
const unwrap = (v: any) => v?.data?.data ?? v?.data ?? v
const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const formatMatchedContext = (incident: any) => {
  const context = incident.matchContext || incident.matchText || ''
  if (!context || !incident.matchText)
    return `<span class="matched-context__empty">${escapeHtml(i18ns.t('noData'))}</span>`
  let match: RegExpExecArray | null = null
  try {
    const pattern = incident.rule?.pattern || incident.matchText
    const source = incident.rule?.type === 'regex' ? pattern : escapeRegExp(pattern)
    const expression = new RegExp(source, 'iu')
    const candidate = expression.exec(context)
    if (candidate?.[0]) match = candidate
  } catch {
    // Fall back to the exact bounded match below.
  }
  const start = match?.index ?? context.indexOf(incident.matchText)
  const matchedText = match?.[0] || incident.matchText
  if (start < 0) return escapeHtml(context)
  return `${escapeHtml(context.slice(0, start))}<mark>${escapeHtml(matchedText)}</mark>${escapeHtml(context.slice(start + matchedText.length))}`
}
const loading = ref(false),
  saving = ref(false),
  apiKey = ref(''),
  sections = ref<string[]>([])
const csvInput = ref<HTMLInputElement | null>(null),
  rules = ref<any[]>([]),
  incidents = ref<any[]>([])
const ruleDialog = ref(false),
  editingId = ref<string | null>(null)
const rule = reactive<any>({
  name: '',
  type: 'literal',
  pattern: '',
  direction: 'both',
  action: 'unreachable',
  enabled: true,
  priority: 100,
})
const rulePage = ref(1),
  rulePageSize = ref(20),
  ruleTotal = ref(0),
  incidentPage = ref(1),
  incidentPageSize = ref(20),
  incidentTotal = ref(0),
  incidentUserId = ref('')
const selectedRules = ref<any[]>([])
const batchDialog = ref(false)
const batchFields = reactive({ action: false, direction: false, priority: false })
const batchChanges = reactive<any>({ action: 'unreachable', direction: 'both', priority: 100 })
const importDialog = ref(false)
const overwriteExisting = ref(false)
const importCsvText = ref('')
const importPreview = ref<any>(null)
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
const loadRules = async () => {
  const r = unwrap(
    await api().listRules({ params: { page: rulePage.value, pageSize: rulePageSize.value } }),
  )
  rules.value = r?.rules ?? []
  ruleTotal.value = r?.total ?? 0
}
const loadIncidents = async () => {
  const r = unwrap(
    await api().listIncidents({
      params: {
        page: incidentPage.value,
        pageSize: incidentPageSize.value,
        userId: incidentUserId.value || undefined,
      },
    }),
  )
  incidents.value = r?.incidents ?? []
  incidentTotal.value = r?.total ?? 0
}
const load = async () => {
  loading.value = true
  try {
    Object.assign(form, unwrap(await api().getConfig()))
    await Promise.all([loadRules(), loadIncidents()])
  } finally {
    loading.value = false
  }
}
const save = async () => {
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
const confirmAiToggle = async (key: 'requestAiEnabled' | 'responseAiEnabled') => {
  if (!form[key]) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('contentSafety.aiCostWarning'),
      i18ns.t('contentSafety.confirmAi'),
      { type: 'warning' },
    )
  } catch {
    form[key] = false
  }
}
const importDefaults = async () => {
  await api().importDefaults({})
  await loadRules()
}
const chooseCsv = () => csvInput.value?.click()
const importCsv = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importCsvText.value = await file.text()
  importPreview.value = unwrap(
    await api().importCsv({ body: { csv: importCsvText.value, mode: 'preview' } }),
  )
  importDialog.value = true
  input.value = ''
}
const applyImport = async () => {
  await api().importCsv({
    body: { csv: importCsvText.value, mode: 'apply', overwrite: overwriteExisting.value },
  })
  importDialog.value = false
  importPreview.value = null
  await loadRules()
}
const exportPolicy = async (format: 'json' | 'csv') => {
  const result = unwrap(await api().exportRules({ body: { format } }))
  const blob = new Blob([result.content], {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = result.filename
  link.click()
  URL.revokeObjectURL(link.href)
}
const openBatchDialog = () => {
  batchFields.action = false
  batchFields.direction = false
  batchFields.priority = false
  batchDialog.value = true
}
const batchSetEnabled = async (enabled: boolean) => {
  await api().batchUpdateRules({
    body: { ids: selectedRules.value.map((row) => row.id), changes: { enabled } },
  })
  selectedRules.value = []
  await loadRules()
}
const saveBatch = async () => {
  const changes: any = {}
  if (batchFields.action) changes.action = batchChanges.action
  if (batchFields.direction) changes.direction = batchChanges.direction
  if (batchFields.priority) changes.priority = batchChanges.priority
  if (!Object.keys(changes).length) return
  await api().batchUpdateRules({ body: { ids: selectedRules.value.map((row) => row.id), changes } })
  batchDialog.value = false
  selectedRules.value = []
  await loadRules()
}
const openRule = (row?: any) => {
  editingId.value = row?.id ?? null
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
  if (editingId.value) await api().updateRule({ path: { id: editingId.value }, body: rule })
  else await api().createRule({ body: rule })
  ruleDialog.value = false
  await loadRules()
}
const removeRule = async (id: string) => {
  await ElMessageBox.confirm(i18ns.t('contentSafety.confirmDelete'))
  await api().deleteRule({ path: { id } })
  await loadRules()
}
const toggleRule = async (row: any) => {
  await api().updateRule({ path: { id: row.id }, body: { ...row, enabled: row.enabled } })
  await loadRules()
}
onMounted(() => void load())
</script>
<style scoped>
.content-safety-management {
  width: 100%;
}
.content-safety-management :deep(.el-collapse) {
  border: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.content-safety-management :deep(.el-collapse-item) {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  overflow: hidden;
}
.content-safety-management :deep(.el-collapse-item__header) {
  padding: 0 16px;
  border-bottom-color: transparent;
}
.content-safety-management :deep(.el-collapse-item__content) {
  padding: 16px;
}
.collapse-title {
  font-size: 16px;
  font-weight: 600;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.matched-context {
  display: block;
  overflow: hidden;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
}
.matched-context :deep(mark) {
  padding: 1px 3px;
  border-radius: 3px;
  background: var(--el-color-warning-light-5);
  color: var(--el-text-color-primary);
  font-weight: 700;
}
.matched-context__empty {
  color: var(--el-text-color-secondary);
}
</style>
