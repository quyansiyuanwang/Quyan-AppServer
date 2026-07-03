<template>
  <div class="sm-root">
    <!-- Google Fonts loaded inline via @import in style -->

    <!-- ───── DESKTOP ───── -->
    <div v-if="isDesktop" class="sm-desktop">
      <!-- LEFT PANEL -->
      <aside class="sm-sidebar">
        <header class="sm-sidebar-head">
          <div class="sm-logo-row">
            <span class="sm-logo-icon">&#x276F;_</span>
            <span class="sm-logo-text">{{ i18ns.t('scriptManager.title') }}</span>
          </div>
          <div class="sm-head-actions">
            <PermissionWrapper :require="[Permission.SCRIPT_CREATE]">
              <button class="sm-btn sm-btn-primary" @click="handleCreate">
                <span class="sm-btn-icon">+</span>{{ i18ns.t('scriptManager.create') }}
              </button>
            </PermissionWrapper>
            <button
              class="sm-btn sm-btn-ghost sm-btn-icon-only"
              @click="loadScripts"
              :class="{ 'sm-spin': loading }"
            >
              ↻
            </button>
          </div>
        </header>

        <section class="sm-security-panel" role="note" :aria-label="i18ns.t('warning')">
          <div class="sm-security-title">⚠ {{ i18ns.t('scriptManager.securityTitle') }}</div>
          <ul class="sm-security-list">
            <li v-for="item in securityNoticeItems" :key="item">{{ item }}</li>
          </ul>
          <div class="sm-security-ack">
            <el-checkbox v-model="runSafetyConfirmed">
              {{ i18ns.t('scriptManager.acknowledgeLabel') }}
            </el-checkbox>
            <div class="sm-security-ack-hint">
              {{ i18ns.t('scriptManager.acknowledgeHint') }}
            </div>
          </div>
        </section>

        <!-- Bulk toolbar -->
        <div class="sm-bulk-bar">
          <span
            class="sm-checkbox sm-select-all-cb"
            :class="{
              'sm-checkbox-on': allSelected,
              'sm-checkbox-indeterminate': someSelected,
            }"
            :title="
              allSelected
                ? i18ns.t('scriptManager.deselectAll')
                : i18ns.t('scriptManager.selectAll')
            "
            @click.stop="toggleSelectAll"
          >
            <span v-if="allSelected" class="sm-check-mark">✓</span>
            <span v-else-if="someSelected" class="sm-check-mark">−</span>
          </span>
          <span class="sm-bulk-hint">
            {{
              selectedIds.size
                ? i18ns.tf('scriptManager.selectedCount', { n: selectedIds.size })
                : i18ns.t('scriptManager.selectHint')
            }}
          </span>
          <button
            v-if="selectedIds.size > 0"
            class="sm-btn sm-btn-ghost sm-btn-xs"
            @click="clearSelection"
          >
            {{ i18ns.t('scriptManager.clearSelection') }}
          </button>
          <div class="sm-bulk-actions">
            <button
              class="sm-btn sm-btn-run"
              :disabled="selectedIds.size === 0 || !runSafetyConfirmed"
              @click="runSelected"
            >
              ▶ {{ i18ns.t('scriptManager.runSelected') }}
            </button>
            <button v-if="hasRunning" class="sm-btn sm-btn-danger" @click="terminateAll">
              ■ {{ i18ns.t('scriptManager.terminateAll') }}
            </button>
            <button v-if="executions.length > 0" class="sm-btn sm-btn-ghost" @click="clearResults">
              {{ i18ns.t('scriptManager.clearResults') }}
            </button>
          </div>
        </div>

        <!-- Script list -->
        <div v-if="loading && scriptList.length === 0" class="sm-list-loading">
          <span class="sm-spinner"></span> Loading…
        </div>
        <div v-else class="sm-list">
          <div
            v-for="script in paginatedList"
            :key="script.id"
            class="sm-row"
            :class="{ 'sm-row-selected': selectedIds.has(script.id) }"
            @click="toggleSelect(script, $event)"
          >
            <span class="sm-row-check">
              <span class="sm-checkbox" :class="{ 'sm-checkbox-on': selectedIds.has(script.id) }">
                <span v-if="selectedIds.has(script.id)" class="sm-check-mark">✓</span>
              </span>
            </span>
            <div class="sm-row-body">
              <span class="sm-row-name">{{ script.name }}</span>
              <span v-if="script.description" class="sm-row-desc">{{ script.description }}</span>
              <span v-if="hasNetworkRisk(script)" class="sm-row-risk">
                ⚠
                {{
                  i18ns.tf('scriptManager.networkRiskDetail', {
                    apis: getDetectedApisText(script),
                  })
                }}
              </span>
            </div>
            <div class="sm-row-actions" @click.stop>
              <button
                class="sm-action-btn sm-action-run"
                :disabled="!runSafetyConfirmed"
                @click="runSingle(script)"
                :title="
                  runSafetyConfirmed
                    ? i18ns.t('scriptManager.run')
                    : i18ns.t('scriptManager.acknowledgeHint')
                "
              >
                ▶
              </button>
              <PermissionWrapper :require="[Permission.SCRIPT_CREATE]" mode="disabled">
                <button class="sm-action-btn" @click="handleEdit(script)" title="Edit">✎</button>
              </PermissionWrapper>
              <button class="sm-action-btn" @click="handleHistory(script)" title="History">
                ⧗
              </button>
              <PermissionWrapper :require="[Permission.SCRIPT_DELETE]" mode="disabled">
                <button
                  class="sm-action-btn sm-action-del"
                  @click="handleDelete(script)"
                  title="Delete"
                >
                  ✕
                </button>
              </PermissionWrapper>
            </div>
          </div>
          <div v-if="!loading && scriptList.length === 0" class="sm-empty">
            <span class="sm-empty-icon">&#x276F;</span> No scripts yet
          </div>
        </div>
        <div v-if="scriptList.length > pageSize" class="sm-pagination">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :total="scriptList.length"
            layout="prev, pager, next"
            small
            hide-on-single-page
          />
        </div>
      </aside>

      <!-- RIGHT: execution console -->
      <main class="sm-console">
        <header class="sm-console-head">
          <div class="sm-console-title">
            <span class="sm-console-label">{{ i18ns.t('scriptManager.results') }}</span>
          </div>
          <div v-if="hasRunning" class="sm-running-badge">
            <span class="sm-dot-pulse"></span> {{ i18ns.t('scriptManager.running') }}
          </div>
        </header>

        <div v-if="executions.length === 0" class="sm-console-empty">
          <div class="sm-empty-terminal">
            <div class="sm-terminal-prompt">$ <span class="sm-cursor-blink">_</span></div>
            <div class="sm-terminal-hint">{{ i18ns.t('scriptManager.noResults') }}</div>
          </div>
        </div>

        <div v-else class="sm-exec-list">
          <TransitionGroup name="sm-exec-fade">
            <div
              v-for="exec in executions"
              :key="exec.id"
              class="sm-exec-card"
              :class="`sm-exec-${exec.status}`"
            >
              <div class="sm-exec-head">
                <span class="sm-exec-status-dot" :class="`sm-dot-${exec.status}`"></span>
                <span class="sm-exec-name">{{ exec.scriptName }}</span>
                <span class="sm-exec-meta">
                  <span class="sm-exec-badge" :class="`sm-badge-${exec.status}`">
                    {{ statusLabel(exec.status) }}
                  </span>
                  <span v-if="exec.durationMs !== undefined" class="sm-exec-ms">
                    {{ exec.durationMs }}ms
                  </span>
                </span>
                <button
                  v-if="exec.status === 'running'"
                  class="sm-exec-kill"
                  @click="terminateOne(exec)"
                >
                  ■ {{ i18ns.t('scriptManager.terminate') }}
                </button>
              </div>
              <pre
                class="sm-exec-output">{{ exec.output || i18ns.t('scriptManager.noOutput') }}<span v-if="exec.status === 'running'" class="sm-cursor-blink"> _</span></pre>
            </div>
          </TransitionGroup>
        </div>
      </main>
    </div>

    <!-- ───── MOBILE ───── -->
    <div v-else class="sm-mobile">
      <div class="sm-mobile-head">
        <span class="sm-logo-row">
          <span class="sm-logo-icon">&#x276F;_</span>
          <span class="sm-logo-text">{{ i18ns.t('scriptManager.title') }}</span>
        </span>
        <PermissionWrapper :require="[Permission.SCRIPT_CREATE]">
          <button class="sm-btn sm-btn-primary" @click="handleCreate">
            + {{ i18ns.t('scriptManager.create') }}
          </button>
        </PermissionWrapper>
      </div>

      <section class="sm-security-panel" role="note" :aria-label="i18ns.t('warning')">
        <div class="sm-security-title">⚠ {{ i18ns.t('scriptManager.securityTitle') }}</div>
        <ul class="sm-security-list">
          <li v-for="item in securityNoticeItems" :key="item">{{ item }}</li>
        </ul>
        <div class="sm-security-ack">
          <el-checkbox v-model="runSafetyConfirmed">
            {{ i18ns.t('scriptManager.acknowledgeLabel') }}
          </el-checkbox>
          <div class="sm-security-ack-hint">
            {{ i18ns.t('scriptManager.acknowledgeHint') }}
          </div>
        </div>
      </section>

      <div class="sm-mobile-list">
        <div v-for="script in scriptList" :key="script.id" class="sm-mobile-card">
          <div class="sm-mobile-card-name">{{ script.name }}</div>
          <div v-if="script.description" class="sm-mobile-card-desc">{{ script.description }}</div>
          <div v-if="hasNetworkRisk(script)" class="sm-mobile-card-risk">
            ⚠
            {{ i18ns.tf('scriptManager.networkRiskDetail', { apis: getDetectedApisText(script) }) }}
          </div>
          <div class="sm-mobile-card-actions">
            <button
              class="sm-btn sm-btn-run"
              :disabled="!runSafetyConfirmed"
              @click="runSingle(script)"
            >
              ▶ {{ i18ns.t('scriptManager.run') }}
            </button>
            <button class="sm-btn sm-btn-ghost" @click="handleHistory(script)">
              {{ i18ns.t('scriptManager.history') }}
            </button>
            <PermissionWrapper :require="[Permission.SCRIPT_CREATE]" mode="disabled">
              <button class="sm-btn sm-btn-ghost" @click="handleEdit(script)">
                {{ i18ns.t('edit') }}
              </button>
            </PermissionWrapper>
            <PermissionWrapper :require="[Permission.SCRIPT_DELETE]" mode="disabled">
              <button class="sm-btn sm-btn-danger" @click="handleDelete(script)">
                {{ i18ns.t('delete') }}
              </button>
            </PermissionWrapper>
          </div>
        </div>
      </div>

      <div v-if="executions.length > 0" class="sm-mobile-results">
        <div class="sm-mobile-results-title">{{ i18ns.t('scriptManager.results') }}</div>
        <div
          v-for="exec in executions"
          :key="exec.id"
          class="sm-exec-card"
          :class="`sm-exec-${exec.status}`"
        >
          <div class="sm-exec-head">
            <span class="sm-exec-status-dot" :class="`sm-dot-${exec.status}`"></span>
            <span class="sm-exec-name">{{ exec.scriptName }}</span>
            <span class="sm-exec-badge" :class="`sm-badge-${exec.status}`">{{
              statusLabel(exec.status)
            }}</span>
            <button
              v-if="exec.status === 'running'"
              class="sm-exec-kill"
              @click="terminateOne(exec)"
            >
              ■
            </button>
          </div>
          <pre class="sm-exec-output">{{ exec.output || i18ns.t('scriptManager.noOutput') }}</pre>
        </div>
      </div>
    </div>

    <!-- ───── Create / Edit Dialog ───── -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="700px"
      :close-on-click-modal="false"
      class="sm-dialog"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="80px">
        <el-form-item :label="i18ns.t('scriptManager.name')" prop="name">
          <el-input v-model="formData.name" />
        </el-form-item>
        <el-form-item :label="i18ns.t('scriptManager.description')">
          <el-input v-model="formData.description" type="textarea" :rows="2" />
        </el-form-item>
        <div class="sm-editor-warning">
          <span class="sm-editor-warning-icon">⚠</span>
          <span>{{ i18ns.t('scriptManager.editorWarning') }}</span>
        </div>
        <el-form-item :label="i18ns.t('scriptManager.content')" prop="content">
          <el-input
            v-model="formData.content"
            type="textarea"
            :rows="14"
            :placeholder="i18ns.t('scriptManager.contentPlaceholder')"
            style="font-size: 13px"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">{{
          i18ns.t('save')
        }}</el-button>
      </template>
    </el-dialog>

    <!-- ───── History Dialog ───── -->
    <el-dialog
      v-model="historyDialogVisible"
      :title="i18ns.t('scriptManager.historyTitle') + ': ' + historyScriptName"
      width="800px"
      :close-on-click-modal="false"
      class="sm-dialog"
    >
      <el-table v-loading="historyLoading" :data="historyList" stripe border>
        <el-table-column :label="i18ns.t('scriptManager.executedAt')" min-width="180">
          <template #default="{ row }">
            {{ new Date(row.createTime).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('scriptManager.duration')" width="120" prop="durationMs" />
        <el-table-column :label="i18ns.t('scriptManager.output')" min-width="300">
          <template #default="{ row }">
            <el-tooltip :content="row.output" placement="top" :show-after="300">
              <span class="sm-history-preview">
                {{ row.output || i18ns.t('scriptManager.noOutput') }}
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!historyLoading && historyList.length === 0" class="sm-no-history">
        {{ i18ns.t('scriptManager.noHistory') }}
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { i18ns } from '@/locales'
import { useIsDesktopStore } from '@/stores/isDesktopStore'
import { Permission } from '@/constant/permission'
import { userScriptService } from '@/service/userScriptService'
import { userScriptExecutionService } from '@/service/userScriptExecutionService'
import { useScriptSelection } from '@/composables/useScriptSelection'

interface UserScript {
  id: string
  userId: string
  name: string
  description?: string
  content: string
  createTime: string
  updateTime: string
}

interface UserScriptExecution {
  id: string
  scriptId?: string
  scriptName: string
  output: string
  durationMs: number
  createTime: string
}

type ExecStatus = 'running' | 'done' | 'error' | 'terminated'

interface ExecRecord {
  id: string
  scriptId: string
  scriptName: string
  status: ExecStatus
  output: string
  startTime: number
  durationMs?: number
  worker?: Worker
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

const executions = ref<ExecRecord[]>([])
const hasRunning = computed(() => executions.value.some((e) => e.status === 'running'))

// Create / Edit dialog
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const formData = ref({ name: '', description: '', content: '' })
const formRules = {
  name: [{ required: true, message: i18ns.t('scriptManager.name'), trigger: 'blur' }],
  content: [{ required: true, message: i18ns.t('scriptManager.content'), trigger: 'blur' }],
}
const dialogTitle = computed(() =>
  isEdit.value ? i18ns.t('scriptManager.edit') : i18ns.t('scriptManager.create'),
)

// History dialog
const historyDialogVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref<UserScriptExecution[]>([])
const historyScriptName = ref('')
const runSafetyConfirmed = ref(false)
const securityNoticeItems = computed(() => [
  i18ns.t('scriptManager.securityNoticeUntrusted'),
  i18ns.t('scriptManager.securityNoticePublicNetwork'),
  i18ns.t('scriptManager.securityNoticeSensitive'),
  i18ns.t('scriptManager.securityNoticeDoubleConfirm'),
])

const NETWORK_API_RULES = [
  { label: 'fetch()', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bWebSocket\b/ },
  { label: 'navigator.sendBeacon()', pattern: /\bnavigator\s*\.\s*sendBeacon\s*\(/ },
  {
    label: 'axios',
    pattern: /\baxios\b(?:\s*\(|\s*\.(?:get|post|put|delete|patch|request))/,
  },
] as const

// ─── helpers ───────────────────────────────────────────────────────────────

function statusLabel(status: ExecStatus) {
  const map: Record<ExecStatus, string> = {
    running: i18ns.t('scriptManager.status.running'),
    done: i18ns.t('scriptManager.status.done'),
    error: i18ns.t('scriptManager.status.error'),
    terminated: i18ns.t('scriptManager.status.terminated'),
  }
  return map[status]
}

function makeExecId() {
  return Math.random().toString(36).slice(2)
}

function getDetectedApis(script: UserScript): string[] {
  return NETWORK_API_RULES.filter((rule) => rule.pattern.test(script.content)).map(
    (rule) => rule.label,
  )
}

function getDetectedApisText(script: UserScript): string {
  return getDetectedApis(script).join(', ')
}

function hasNetworkRisk(script: UserScript): boolean {
  return getDetectedApis(script).length > 0
}

async function confirmBeforeRun(count: number) {
  await ElMessageBox.confirm(
    i18ns.tf('scriptManager.runConfirmMessage', { n: count }),
    i18ns.t('scriptManager.runConfirmTitle'),
    {
      confirmButtonText: i18ns.t('scriptManager.confirmRun'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'warning',
    },
  )
}

async function confirmNetworkRisk(scripts: UserScript[]) {
  const riskyScripts = scripts
    .map((script) => ({ scriptName: script.name, apis: getDetectedApis(script) }))
    .filter((item) => item.apis.length > 0)

  if (riskyScripts.length === 0) return

  const lines = [
    i18ns.t('scriptManager.networkRiskIntro'),
    ...riskyScripts.map((item) => `• ${item.scriptName}: ${item.apis.join(', ')}`),
    '',
    i18ns.t('scriptManager.networkRiskPublicNetwork'),
  ]

  await ElMessageBox.confirm(lines.join('\n'), i18ns.t('scriptManager.networkRiskTitle'), {
    confirmButtonText: i18ns.t('scriptManager.confirmHighRiskRun'),
    cancelButtonText: i18ns.t('cancel'),
    type: 'error',
  })
}

async function ensureRunAllowed(scripts: UserScript[]) {
  if (!runSafetyConfirmed.value) {
    ElMessage.warning(i18ns.t('scriptManager.reviewRequired'))
    return false
  }

  try {
    await confirmBeforeRun(scripts.length)
    await confirmNetworkRisk(scripts)
    return true
  } catch {
    return false
  }
}

// ─── data loading ──────────────────────────────────────────────────────────

async function loadScripts() {
  loading.value = true
  try {
    scriptList.value = await userScriptService.getScripts()
    resetPage()
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

// ─── execution ─────────────────────────────────────────────────────────────

function spawnWorker(script: UserScript) {
  const execId = makeExecId()
  const record: ExecRecord = {
    id: execId,
    scriptId: script.id,
    scriptName: script.name,
    status: 'running',
    output: '',
    startTime: Date.now(),
  }
  executions.value.unshift(record)

  const worker = new Worker(new URL('@/workers/script-runner.worker.ts', import.meta.url), {
    type: 'module',
  })
  record.worker = worker

  worker.onmessage = async (e: MessageEvent) => {
    const rec = executions.value.find((r) => r.id === execId)
    if (!rec) return
    if (e.data.type === 'log') {
      rec.output += (rec.output ? '\n' : '') + e.data.text
    } else if (e.data.type === 'done') {
      rec.durationMs = Date.now() - rec.startTime
      rec.status = e.data.hasError ? 'error' : 'done'
      rec.worker = undefined
      worker.terminate()
      await userScriptExecutionService
        .saveExecution({
          scriptId: script.id,
          scriptName: script.name,
          contentSnapshot: script.content,
          output: (e.data.logs as string[]).join('\n'),
          durationMs: rec.durationMs,
        })
        .catch(() => {})
    }
  }

  worker.onerror = (e: ErrorEvent) => {
    const rec = executions.value.find((r) => r.id === execId)
    if (!rec) return
    rec.output += (rec.output ? '\n' : '') + '[worker error] ' + e.message
    rec.status = 'error'
    rec.durationMs = Date.now() - rec.startTime
    rec.worker = undefined
    worker.terminate()
  }

  worker.postMessage({ code: script.content })
}

async function runSingle(script: UserScript) {
  if (!(await ensureRunAllowed([script]))) return
  spawnWorker(script)
}

async function runSelected() {
  if (selectedIds.value.size === 0) return
  const toRun = scriptList.value.filter((s) => selectedIds.value.has(s.id))
  if (!(await ensureRunAllowed(toRun))) return
  for (const script of toRun) spawnWorker(script)
}

function terminateOne(exec: ExecRecord) {
  if (exec.worker) {
    exec.worker.terminate()
    exec.worker = undefined
  }
  exec.status = 'terminated'
  exec.durationMs = Date.now() - exec.startTime
  exec.output += (exec.output ? '\n' : '') + '[terminated]'
}

function terminateAll() {
  executions.value.filter((e) => e.status === 'running').forEach(terminateOne)
}

function clearResults() {
  terminateAll()
  executions.value = []
}

// ─── create / edit / delete ────────────────────────────────────────────────

function resetForm() {
  formData.value = { name: '', description: '', content: '' }
  isEdit.value = false
  editingId.value = null
  formRef.value?.clearValidate()
}

function handleCreate() {
  resetForm()
  dialogVisible.value = true
}

function handleEdit(row: UserScript) {
  resetForm()
  isEdit.value = true
  editingId.value = row.id
  formData.value = { name: row.name, description: row.description ?? '', content: row.content }
  dialogVisible.value = true
}

async function handleSave() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
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
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: UserScript) {
  await ElMessageBox.confirm(i18ns.t('scriptManager.deleteConfirm'), i18ns.t('confirm'), {
    confirmButtonText: i18ns.t('delete'),
    cancelButtonText: i18ns.t('cancel'),
    type: 'warning',
  })
  try {
    await userScriptService.deleteScript(row.id)
    ElMessage.success(i18ns.t('scriptManager.deleteSuccess'))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => id !== row.id))
    await loadScripts()
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

// ─── history ───────────────────────────────────────────────────────────────

async function handleHistory(row: UserScript) {
  historyScriptName.value = row.name
  historyList.value = []
  historyDialogVisible.value = true
  historyLoading.value = true
  try {
    historyList.value = await userScriptExecutionService.listByScript(row.id)
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    historyLoading.value = false
  }
}

// ─── lifecycle ─────────────────────────────────────────────────────────────

onMounted(() => {
  loadScripts()
})

onUnmounted(() => {
  executions.value
    .filter((e) => e.status === 'running')
    .forEach((e) => {
      e.worker?.terminate()
    })
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

/* ── root ── */
.sm-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}

/* ── desktop layout ── */
.sm-desktop {
  display: flex;
  height: 100%;
  min-height: 0;
  gap: 0;
}

/* ── sidebar ── */
.sm-sidebar {
  flex: 0 0 40%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.sm-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  gap: 10px;
}

.sm-logo-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sm-logo-icon {
  font-weight: 700;
  font-size: 15px;
  color: #e8a020;
  letter-spacing: -1px;
}

.sm-logo-text {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--el-text-color-primary);
}

.sm-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sm-security-panel {
  margin: 12px 16px 0;
  padding: 12px 14px;
  border: 1px solid rgba(248, 81, 73, 0.5);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(248, 81, 73, 0.14), rgba(248, 81, 73, 0.08));
  box-shadow: inset 0 0 0 1px rgba(248, 81, 73, 0.08);
}

.sm-security-title {
  font-size: 14px;
  font-weight: 700;
  color: #f85149;
  letter-spacing: 0.04em;
}

.sm-security-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}

.sm-security-list li::marker {
  color: #f85149;
}

.sm-security-ack {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(248, 81, 73, 0.4);
}

.sm-security-ack-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

:deep(.sm-security-ack .el-checkbox) {
  align-items: flex-start;
}

:deep(.sm-security-ack .el-checkbox__label) {
  white-space: normal;
  line-height: 1.6;
  color: var(--el-text-color-primary);
}

/* ── buttons ── */
.sm-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 3px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    opacity 0.15s;
  white-space: nowrap;
  line-height: 1;
}

.sm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sm-btn-primary {
  background: #e8a020;
  border-color: #e8a020;
  color: #0a0c10;
}

.sm-btn-primary:not(:disabled):hover {
  background: #f0b030;
  border-color: #f0b030;
}

.sm-btn-run {
  background: transparent;
  border-color: #3fb950;
  color: #3fb950;
}

.sm-btn-run:not(:disabled):hover {
  background: rgba(63, 185, 80, 0.12);
}

.sm-btn-danger {
  background: transparent;
  border-color: #f85149;
  color: #f85149;
}

.sm-btn-danger:not(:disabled):hover {
  background: rgba(248, 81, 73, 0.12);
}

.sm-btn-ghost {
  background: transparent;
  border-color: var(--el-border-color);
  color: var(--el-text-color-secondary);
}

.sm-btn-ghost:not(:disabled):hover {
  border-color: var(--el-text-color-secondary);
  color: var(--el-text-color-primary);
}

.sm-btn-icon-only {
  padding: 5px 8px;
  font-size: 16px;
  line-height: 1;
}

.sm-btn-icon {
  font-size: 15px;
  font-weight: 400;
}

@keyframes sm-spin-anim {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.sm-spin {
  animation: sm-spin-anim 0.6s linear infinite;
  display: inline-block;
}

.sm-btn-xs {
  padding: 2px 8px;
  font-size: 11px;
}

.sm-editor-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(232, 160, 32, 0.4);
  background: rgba(232, 160, 32, 0.08);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}

.sm-editor-warning-icon {
  flex-shrink: 0;
  color: #e8a020;
}

.sm-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sm-action-btn:disabled:hover {
  background: transparent;
  border-color: transparent;
  color: var(--el-text-color-secondary);
}

.sm-checkbox-indeterminate {
  background: rgba(232, 160, 32, 0.3);
  border-color: #e8a020;
}

.sm-select-all-cb {
  cursor: pointer;
  flex-shrink: 0;
}

/* ── bulk toolbar ── */
.sm-bulk-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  background: var(--el-fill-color-extra-light);
}

.sm-bulk-hint {
  flex: 1;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.sm-bulk-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* ── script list ── */
.sm-list {
  flex: 1;
  overflow-y: auto;
}

.sm-list-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.sm-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--el-border-color);
  border-top-color: #e8a020;
  border-radius: 50%;
  animation: sm-spin-anim 0.7s linear infinite;
}

.sm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
  user-select: none;
}

.sm-row:hover {
  background: var(--el-fill-color-light);
}

.sm-row-selected {
  background: rgba(232, 160, 32, 0.07);
  border-left: 3px solid #e8a020;
  padding-left: 11px;
}

.sm-row-selected:hover {
  background: rgba(232, 160, 32, 0.12);
}

.sm-row-check {
  flex-shrink: 0;
}

.sm-checkbox {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color 0.12s,
    background 0.12s;
}

.sm-checkbox-on {
  background: #e8a020;
  border-color: #e8a020;
}

.sm-check-mark {
  font-size: 10px;
  font-weight: 700;
  color: #0a0c10;
  line-height: 1;
}

.sm-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sm-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-row-desc {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-row-risk {
  font-size: 11px;
  color: #f85149;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-row-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.sm-row:hover .sm-row-actions {
  opacity: 1;
}

.sm-action-btn {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
  padding: 0;
}

.sm-action-btn:hover {
  background: var(--el-fill-color);
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}

.sm-action-run:hover {
  color: #3fb950;
  border-color: rgba(63, 185, 80, 0.4);
  background: rgba(63, 185, 80, 0.08);
}

.sm-action-del:hover {
  color: #f85149;
  border-color: rgba(248, 81, 73, 0.4);
  background: rgba(248, 81, 73, 0.08);
}

.sm-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sm-empty-icon {
  font-size: 24px;
  color: #e8a020;
  opacity: 0.4;
}

/* ── console (right panel) ── */
.sm-console {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}

.sm-console-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  background: var(--el-fill-color-light);
}

.sm-console-title {
  display: flex;
  align-items: center;
  gap: 7px;
}

/* macOS traffic lights */
.sm-traffic-red,
.sm-traffic-yellow,
.sm-traffic-green {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sm-traffic-red {
  background: #ff5f56;
}
.sm-traffic-yellow {
  background: #ffbd2e;
}
.sm-traffic-green {
  background: #27c93f;
}

@keyframes sm-traffic-pulse-anim {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(39, 201, 63, 0.5);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(39, 201, 63, 0);
  }
}
.sm-traffic-pulse {
  animation: sm-traffic-pulse-anim 1.2s ease infinite;
}

.sm-console-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}

.sm-running-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: #e3b341;
  letter-spacing: 0.03em;
}

@keyframes sm-dot-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}
.sm-dot-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e3b341;
  display: inline-block;
  animation: sm-dot-blink 1s ease infinite;
}

/* console empty state */
.sm-console-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sm-empty-terminal {
  text-align: center;
}

.sm-terminal-prompt {
  font-size: 18px;
  font-weight: 500;
  color: #3fb950;
  margin-bottom: 10px;
}

.sm-terminal-hint {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  letter-spacing: 0.03em;
}

/* ── execution cards ── */
.sm-exec-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sm-exec-card {
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  flex-shrink: 0;
  transition: border-color 0.2s;
}

.sm-exec-running {
  border-color: #e3b341;
  box-shadow: 0 0 0 1px rgba(227, 179, 65, 0.15);
}

.sm-exec-done {
  border-color: #27c93f;
}

.sm-exec-error {
  border-color: #f85149;
}

.sm-exec-terminated {
  border-color: #30363d;
  opacity: 0.7;
}

.sm-exec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}

.sm-exec-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sm-dot-running {
  background: #e3b341;
  animation: sm-dot-blink 0.9s ease infinite;
}

.sm-dot-done {
  background: #27c93f;
}
.sm-dot-error {
  background: #f85149;
}
.sm-dot-terminated {
  background: #4a5568;
}

.sm-exec-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-exec-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.sm-exec-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid transparent;
}

.sm-badge-running {
  color: #e3b341;
  border-color: rgba(227, 179, 65, 0.4);
  background: rgba(227, 179, 65, 0.1);
}
.sm-badge-done {
  color: #27c93f;
  border-color: rgba(39, 201, 63, 0.4);
  background: rgba(39, 201, 63, 0.1);
}
.sm-badge-error {
  color: #f85149;
  border-color: rgba(248, 81, 73, 0.4);
  background: rgba(248, 81, 73, 0.1);
}
.sm-badge-terminated {
  color: #8b949e;
  border-color: rgba(139, 148, 158, 0.4);
  background: rgba(139, 148, 158, 0.08);
}

.sm-exec-ms {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.sm-exec-kill {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid rgba(248, 81, 73, 0.5);
  background: rgba(248, 81, 73, 0.1);
  color: #f85149;
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}

.sm-exec-kill:hover {
  background: rgba(248, 81, 73, 0.2);
}

.sm-exec-output {
  margin: 0;
  padding: 10px 14px;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

/* blinking cursor in output */
@keyframes sm-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
.sm-cursor-blink {
  animation: sm-cursor-blink 1s step-end infinite;
  color: #e8a020;
  font-weight: 700;
}

/* ── exec card transition ── */
.sm-exec-fade-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.sm-exec-fade-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── mobile ── */
.sm-mobile {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sm-mobile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sm-mobile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-mobile-card {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px 14px;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sm-mobile-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.sm-mobile-card-desc {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.sm-mobile-card-risk {
  font-size: 12px;
  color: #f85149;
  line-height: 1.5;
}

.sm-mobile-card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sm-mobile-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-mobile-results-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
}

/* ── history dialog ── */
.sm-history-preview {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  cursor: default;
  color: var(--el-text-color-regular);
}

.sm-no-history {
  text-align: center;
  color: var(--el-text-color-placeholder);
  padding: 24px 0;
  font-size: 13px;
}

/* ── pagination ── */
.sm-pagination {
  flex-shrink: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  justify-content: center;
}

/* ── dark mode: restore terminal aesthetic ── */
:global(html.dark) .sm-console {
  background: #0d0f14;
  color: #c9d1d9;
}

:global(html.dark) .sm-console-head {
  background: #161b22;
  border-bottom-color: #21262d;
}

:global(html.dark) .sm-exec-card {
  border-color: #21262d;
}

:global(html.dark) .sm-exec-head {
  background: #161b22;
  border-bottom-color: #21262d;
}

:global(html.dark) .sm-exec-name {
  color: #e6edf3;
}

:global(html.dark) .sm-exec-ms {
  color: #4a5568;
}

:global(html.dark) .sm-console-label {
  color: #8b949e;
}

:global(html.dark) .sm-terminal-hint {
  color: #4a5568;
}
</style>
