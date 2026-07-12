<template>
  <div class="sm-root">
    <UserScriptDesktopLayout
      v-if="isDesktop"
      :loading="loading"
      :script-list="scriptList"
      :paginated-list="paginatedList"
      :selected-ids="selectedIds"
      :all-selected="allSelected"
      :some-selected="someSelected"
      :run-safety-confirmed="runSafetyConfirmed"
      :security-notice-items="securityNoticeItems"
      :executions="executions"
      :has-running="hasRunning"
      :current-page="currentPage"
      :page-size="pageSize"
      :has-network-risk="hasNetworkRisk"
      :get-detected-apis-text="getDetectedApisText"
      :status-label="statusLabel"
      @create="handleCreate"
      @refresh="loadScripts"
      @toggle-select-all="toggleSelectAll"
      @clear-selection="clearSelection"
      @run-selected="handleRunSelected"
      @terminate-all="terminateAll"
      @clear-results="clearResults"
      @toggle-select="toggleSelect"
      @run-single="runSingle"
      @edit="handleEdit"
      @history="handleHistory"
      @delete="handleDelete"
      @terminate-one="terminateOne"
      @update:run-safety-confirmed="runSafetyConfirmed = $event"
      @update:current-page="currentPage = $event"
    />

    <UserScriptMobileLayout
      v-else
      :script-list="scriptList"
      :run-safety-confirmed="runSafetyConfirmed"
      :security-notice-items="securityNoticeItems"
      :executions="executions"
      :has-network-risk="hasNetworkRisk"
      :get-detected-apis-text="getDetectedApisText"
      :status-label="statusLabel"
      @create="handleCreate"
      @run-single="runSingle"
      @history="handleHistory"
      @edit="handleEdit"
      @delete="handleDelete"
      @terminate-one="terminateOne"
      @update:run-safety-confirmed="runSafetyConfirmed = $event"
    />

    <UserScriptEditorDialog
      ref="editorDialogRef"
      :visible="dialogVisible"
      :title="dialogTitle"
      :saving="saving"
      :form-data="formData"
      :form-rules="formRules"
      @save="handleSave"
      @closed="resetForm"
      @update:form-data="formData = $event"
      @update:visible="dialogVisible = $event"
    />

    <UserScriptHistoryDialog
      :visible="historyDialogVisible"
      :loading="historyLoading"
      :history-list="historyList"
      :history-script-name="historyScriptName"
      @update:visible="historyDialogVisible = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import { useScriptSelection } from '@/composables/useScriptSelection'
import { userScriptExecutionService } from '@/service/userScriptExecutionService'
import { userScriptService } from '@/service/userScriptService'
import { useIsDesktopStore } from '@/stores/isDesktopStore'
import UserScriptDesktopLayout from './components/UserScriptDesktopLayout.vue'
import UserScriptEditorDialog from './components/UserScriptEditorDialog.vue'
import UserScriptHistoryDialog from './components/UserScriptHistoryDialog.vue'
import UserScriptMobileLayout from './components/UserScriptMobileLayout.vue'
import { useUserScriptExecutions } from './composables/useUserScriptExecutions'
import type { ScriptFormData, UserScript, UserScriptExecution } from './types'

type EditorDialogExpose = {
  validate: () => Promise<boolean>
  clearValidate: () => void
}

const isDesktop = useIsDesktopStore().useIsDesktop()

const loading = ref(false)
const saving = ref(false)
const scriptList = ref<UserScript[]>([])

const {
  selectedIds,
  currentPage,
  pageSize,
  paginatedList,
  allSelected,
  someSelected,
  toggleSelect,
  toggleSelectAll,
  clearSelection,
  resetPage,
} = useScriptSelection(() => scriptList.value)

const {
  executions,
  runSafetyConfirmed,
  hasRunning,
  securityNoticeItems,
  statusLabel,
  getDetectedApisText,
  hasNetworkRisk,
  runSingle,
  runMany,
  terminateOne,
  terminateAll,
  clearResults,
} = useUserScriptExecutions()

const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref<string | null>(null)
const editorDialogRef = ref<EditorDialogExpose | null>(null)
const formData = ref<ScriptFormData>({ name: '', description: '', content: '' })
const formRules: FormRules<ScriptFormData> = {
  name: [{ required: true, message: i18ns.t('scriptManager.name'), trigger: 'blur' }],
  content: [{ required: true, message: i18ns.t('scriptManager.content'), trigger: 'blur' }],
}
const dialogTitle = computed(() =>
  isEdit.value ? i18ns.t('scriptManager.edit') : i18ns.t('scriptManager.create'),
)

const historyDialogVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref<UserScriptExecution[]>([])
const historyScriptName = ref('')

async function loadScripts() {
  loading.value = true
  try {
    scriptList.value = await userScriptService.getScripts()
    resetPage()
  } catch (error: unknown) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formData.value = { name: '', description: '', content: '' }
  isEdit.value = false
  editingId.value = null
  editorDialogRef.value?.clearValidate()
}

function handleCreate() {
  resetForm()
  dialogVisible.value = true
}

function handleEdit(row: UserScript) {
  resetForm()
  isEdit.value = true
  editingId.value = row.id
  formData.value = {
    name: row.name,
    description: row.description ?? '',
    content: row.content,
  }
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await editorDialogRef.value?.validate()
  if (!valid) return

  saving.value = true
  try {
    if (isEdit.value && editingId.value) {
      await userScriptService.updateScript(editingId.value, {
        name: formData.value.name,
        description: formData.value.description || undefined,
        content: formData.value.content,
      })
      ElMessage.success(i18ns.t('scriptManager.updateSuccess'))
    } else {
      await userScriptService.createScript({
        name: formData.value.name,
        description: formData.value.description || undefined,
        content: formData.value.content,
      })
      ElMessage.success(i18ns.t('scriptManager.createSuccess'))
    }

    dialogVisible.value = false
    await loadScripts()
  } catch (error: unknown) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: UserScript) {
  try {
    await ElMessageBox.confirm(i18ns.t('scriptManager.deleteConfirm'), i18ns.t('confirm'), {
      confirmButtonText: i18ns.t('delete'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'warning',
    })
  } catch {
    return
  }

  try {
    await userScriptService.deleteScript(row.id)
    ElMessage.success(i18ns.t('scriptManager.deleteSuccess'))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => id !== row.id))
    await loadScripts()
  } catch (error: unknown) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  }
}

async function handleHistory(row: UserScript) {
  historyScriptName.value = row.name
  historyList.value = []
  historyDialogVisible.value = true
  historyLoading.value = true

  try {
    historyList.value = await userScriptExecutionService.listByScript(row.id)
  } catch (error: unknown) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    historyLoading.value = false
  }
}

async function handleRunSelected() {
  if (selectedIds.value.size === 0) return
  const selectedScripts = scriptList.value.filter((script) => selectedIds.value.has(script.id))
  await runMany(selectedScripts)
}

onMounted(() => {
  loadScripts()
})
</script>

<style scoped>
.sm-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}
</style>
