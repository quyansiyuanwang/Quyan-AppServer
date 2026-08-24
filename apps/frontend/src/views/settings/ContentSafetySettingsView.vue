<template>
  <AccountProfileLayout>
    <div class="content-safety-user" v-loading="loading">
      <div class="page-header">
        <h1 class="page-title">{{ i18ns.t('contentSafety.title') }}</h1>
        <el-button type="primary" :loading="saving" @click="saveConfig">{{
          i18ns.t('save')
        }}</el-button>
      </div>
      <el-alert type="info" :closable="false" class="mb-4">{{
        i18ns.t('contentSafety.userDescription')
      }}</el-alert>
      <el-collapse v-model="sections" class="content-safety-user__collapse">
        <el-collapse-item name="policy">
          <template #title
            ><span class="collapse-title">{{ i18ns.t('contentSafety.policy') }}</span></template
          >
          <ContentSafetyPolicyFields v-model:model="policy" />
          <div class="content-safety-user__actions">
            <el-button @click="resetConfig">{{
              i18ns.t('contentSafety.resetInheritance')
            }}</el-button>
          </div>
        </el-collapse-item>
        <el-collapse-item name="rules">
          <template #title
            ><span class="collapse-title">{{ i18ns.t('contentSafety.rules') }}</span></template
          >
          <div class="content-safety-user__toolbar">
            <el-button type="primary" @click="openRule()">{{
              i18ns.t('contentSafety.addRule')
            }}</el-button>
            <el-button @click="chooseCsv">{{ i18ns.t('contentSafety.importCsv') }}</el-button>
            <input ref="csvInput" type="file" accept=".csv,text/csv" hidden @change="importCsv" />
          </div>
          <el-table :data="rules" border size="small">
            <el-table-column prop="name" :label="i18ns.t('contentSafety.name')" />
            <el-table-column prop="type" :label="i18ns.t('contentSafety.type')" />
            <el-table-column prop="direction" :label="i18ns.t('contentSafety.direction')" />
            <el-table-column prop="action" :label="i18ns.t('contentSafety.action')" />
            <el-table-column :label="i18ns.t('contentSafety.enabled')" width="100"
              ><template #default="{ row }"
                ><el-switch v-model="row.enabled" @change="toggleRule(row)" /></template
            ></el-table-column>
            <el-table-column width="130"
              ><template #default="{ row }"
                ><el-button link :disabled="!row.canEdit" @click="openRule(row)">{{
                  i18ns.t('contentSafety.edit')
                }}</el-button
                ><el-button
                  link
                  type="danger"
                  :disabled="!row.canEdit"
                  @click="removeRule(row.id)"
                  >{{ i18ns.t('delete') }}</el-button
                ></template
              ></el-table-column
            >
          </el-table>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="total"
            layout="prev, pager, next, sizes"
            @current-change="loadRules"
            @size-change="loadRules"
          />
        </el-collapse-item>
      </el-collapse>
    </div>
    <el-dialog
      v-model="ruleDialog"
      :title="editingId ? i18ns.t('contentSafety.edit') : i18ns.t('contentSafety.addRule')"
      width="520px"
    >
      <el-form label-position="top"
        ><el-form-item :label="i18ns.t('contentSafety.name')"
          ><el-input v-model="rule.name" /></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.type')"
          ><el-select v-model="rule.type"
            ><el-option value="literal" label="literal" /><el-option
              value="regex"
              label="regex" /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.pattern')"
          ><el-input v-model="rule.pattern" type="textarea" /></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.direction')"
          ><el-select v-model="rule.direction"
            ><el-option value="request" label="request" /><el-option
              value="response"
              label="response" /><el-option value="both" label="both" /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.action')"
          ><el-select v-model="rule.action"
            ><el-option
              value="unreachable"
              :label="i18ns.t('contentSafety.unreachable')" /><el-option
              value="blackhole"
              :label="i18ns.t('contentSafety.blackhole')" /><el-option
              value="allow"
              :label="i18ns.t('contentSafety.allow')" /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('contentSafety.priority')"
          ><el-input-number v-model="rule.priority" :min="0" :max="100000" /></el-form-item
      ></el-form>
      <template #footer
        ><el-button @click="ruleDialog = false">{{ i18ns.t('cancel') }}</el-button
        ><el-button type="primary" @click="saveRule">{{ i18ns.t('save') }}</el-button></template
      >
    </el-dialog>
  </AccountProfileLayout>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
import ContentSafetyPolicyFields from '@/components/content-safety/ContentSafetyPolicyFields.vue'
import { i18ns } from '@/locales'
import { useRequestStore } from '@/stores/request'
import { createContentSafetyControllerApi } from '@/client/services/content-safety-controller.gen'
const api = () => createContentSafetyControllerApi(useRequestStore().getAxios())
const unwrap = (v: any) => v?.data?.data ?? v?.data ?? v
const loading = ref(false),
  saving = ref(false),
  sections = ref(['policy', 'rules']),
  csvInput = ref<HTMLInputElement | null>(null)
const rules = ref<any[]>([]),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  ruleDialog = ref(false),
  editingId = ref<string | null>(null)
const policy = reactive<any>({
  requestEnabled: true,
  requestAction: 'unreachable',
  requestAiEnabled: false,
  responseEnabled: true,
  responseAction: 'unreachable',
  responseAiEnabled: false,
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
const loadRules = async () => {
  const r = unwrap(
    await api().listUserRules({ params: { page: page.value, pageSize: pageSize.value } }),
  )
  rules.value = r?.rules ?? []
  total.value = r?.total ?? 0
}
const load = async () => {
  loading.value = true
  try {
    Object.assign(policy, unwrap(await api().getUserConfig()))
    await loadRules()
  } finally {
    loading.value = false
  }
}
const saveConfig = async () => {
  saving.value = true
  try {
    await api().updateUserConfig({ body: policy })
    ElMessage.success(i18ns.t('success'))
  } finally {
    saving.value = false
  }
}
const resetConfig = async () => {
  Object.keys(policy).forEach((key) => {
    policy[key] = key.endsWith('Action') ? null : null
  })
  await saveConfig()
}
const chooseCsv = () => csvInput.value?.click()
const importCsv = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await api().importUserCsv({ body: { csv: await file.text() } })
  input.value = ''
  await loadRules()
}
const openRule = (row?: any) => {
  editingId.value = row?.id ?? null
  Object.assign(
    rule,
    row ?? {
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
  if (editingId.value) await api().updateUserRule({ path: { id: editingId.value }, body: rule })
  else await api().createUserRule({ body: rule })
  ruleDialog.value = false
  await loadRules()
}
const removeRule = async (id: string) => {
  await ElMessageBox.confirm(i18ns.t('contentSafety.confirmDelete'))
  await api().deleteUserRule({ path: { id }, params: {} })
  await loadRules()
}
const toggleRule = async (row: any) => {
  if (row.canEdit) {
    await api().updateUserRule({
      path: { id: row.id },
      body: {
        name: row.name,
        type: row.type,
        pattern: row.pattern,
        direction: row.direction,
        action: row.action,
        enabled: row.enabled,
        priority: row.priority,
      },
    })
  } else {
    await api().updateRuleOverride({ body: { ruleId: row.id, enabled: row.enabled } })
  }
  await loadRules()
}
onMounted(() => void load())
</script>

<style scoped>
.content-safety-user {
  width: 100%;
  min-width: 0;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.content-safety-user__collapse {
  border: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.content-safety-user__collapse :deep(.el-collapse-item) {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  overflow: hidden;
}
.content-safety-user__collapse :deep(.el-collapse-item__header) {
  padding: 0 16px;
  border-bottom: 1px solid transparent;
}
.content-safety-user__collapse :deep(.el-collapse-item.is-active .el-collapse-item__header) {
  border-bottom-color: var(--el-border-color-lighter);
}
.content-safety-user__collapse :deep(.el-collapse-item__content) {
  padding: 16px;
}
.collapse-title {
  font-size: 16px;
  font-weight: 600;
}
.content-safety-user__toolbar,
.content-safety-user__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.content-safety-user__actions {
  margin-top: 12px;
  margin-bottom: 0;
}
</style>
