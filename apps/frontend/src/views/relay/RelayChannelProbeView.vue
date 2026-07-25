<template>
  <main class="channel-probe-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('relay.channelProbeTitle') }}</h1>
        <p>{{ i18ns.t('relay.channelProbeDescription') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadOverview">{{ i18ns.t('refresh') }}</el-button>
    </header>

    <el-alert type="info" :closable="false" show-icon class="mb-4" :title="i18ns.t('relay.channelProbeQueueNotice')" />
    <el-alert v-if="pageError" type="error" :closable="false" show-icon class="mb-4">
      <template #default><span>{{ pageError }}</span><el-button link type="primary" @click="loadOverview">{{ i18ns.t('reload') }}</el-button></template>
    </el-alert>

    <section class="probe-toolbar">
      <el-button v-if="canAdjust" type="success" plain :disabled="selectedRuns.length === 0" :loading="applying" @click="confirmApply(selectedRuns)">{{ i18ns.t('relay.channelProbeBatchApply') }}</el-button>
    </section>
    <el-table v-loading="loading" :data="items" row-key="channelId" class="w-full" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" :selectable="canSelectRun" />
      <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="180" />
      <el-table-column :label="i18ns.t('status')" width="108"><template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled') }}</el-tag></template></el-table-column>
      <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="120" align="right"><template #default="{ row }">{{ row.multiplier }}x</template></el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeConfigured')" width="126"><template #default="{ row }"><el-tag size="small" :type="row.profile ? 'success' : 'info'">{{ row.profile ? i18ns.t('yes') : i18ns.t('no') }}</el-tag></template></el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeLatest')" min-width="132"><template #default="{ row }">{{ row.latestRun ? statusLabel(row.latestRun.status) : '-' }}</template></el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" width="145" align="right"><template #default="{ row }">{{ row.latestRun?.suggestedMultiplier == null ? '-' : `${row.latestRun.suggestedMultiplier}x` }}</template></el-table-column>
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="220"><template #default="{ row }">
        <el-button link type="primary" @click="openDrawer(row)">{{ i18ns.t('relay.channelProbeManage') }}</el-button>
        <el-button v-if="canExecute" link type="primary" :disabled="!row.profile || !row.enabled" :loading="runningId === row.channelId" @click="run(row)">{{ i18ns.t('relay.channelProbeRun') }}</el-button>
        <el-button v-if="canAdjust" link type="success" :disabled="!isApplicable(row.latestRun)" @click="confirmApply([row.latestRun!.id])">{{ i18ns.t('relay.channelProbeApply') }}</el-button>
      </template></el-table-column>
      <template #empty><el-empty :description="i18ns.t('relay.channelProbeNoStandalone')" :image-size="88" /></template>
    </el-table>

    <el-drawer v-model="drawerOpen" :title="selected?.channelName" direction="rtl" size="min(760px, 100vw)" destroy-on-close @closed="resetDrawer">
      <el-tabs v-model="tab">
        <el-tab-pane :label="i18ns.t('relay.channelProbeProfile')" name="profile">
          <el-form label-position="top" class="profile-form" @submit.prevent="saveProfile">
            <div class="form-grid">
              <el-form-item :label="i18ns.t('productConsole.enabled')"><el-switch v-model="form.enabled" :disabled="!canExecute" /></el-form-item>
              <el-form-item :label="i18ns.t('relay.channelProbeFormat')"><el-select v-model="form.probeFormat" :disabled="!canExecute"><el-option value="openai" label="OpenAI" /><el-option value="anthropic" label="Anthropic" /><el-option value="gemini" label="Gemini" /></el-select></el-form-item>
              <el-form-item :label="i18ns.t('relay.channelProbeModel')"><el-input v-model.trim="form.probeModel" :disabled="!canExecute" /></el-form-item>
              <el-form-item :label="i18ns.t('relay.channelProbeDistribution')"><el-input-number v-model="form.distributionMultiplier" :min="0.000001" :max="1000" :precision="6" :disabled="!canExecute" /></el-form-item>
              <el-form-item :label="i18ns.t('relay.channelProbeUpstreamCurrency')"><el-input v-model.trim="form.upstreamCurrency" maxlength="12" :disabled="!canExecute" /></el-form-item>
              <el-form-item :label="i18ns.t('relay.channelProbeLocalCurrency')"><el-input v-model.trim="form.localCurrency" maxlength="12" :disabled="!canExecute" /></el-form-item>
            </div>
            <el-form-item :label="i18ns.t('relay.channelProbePayload')"><el-input v-model="payloadText" type="textarea" :rows="5" :disabled="!canExecute" :placeholder="i18ns.t('relay.channelProbePayloadHelp')" /></el-form-item>

            <div class="section-heading"><strong>{{ i18ns.t('relay.channelProbeWorkflow') }}</strong><span>{{ i18ns.t('relay.channelProbeWorkflowHelp') }}</span><el-button v-if="canExecute" link type="primary" :disabled="workflowSteps.length >= 3" @click="addWorkflowStep">{{ i18ns.t('relay.channelProbeAddStep') }}</el-button></div>
            <el-empty v-if="workflowSteps.length === 0" :description="i18ns.t('relay.channelProbeWorkflowEmpty')" :image-size="56" />
            <section v-for="(step, index) in workflowSteps" :key="step.id" class="workflow-step">
              <div class="step-header"><strong>{{ i18ns.t('relay.channelProbeWorkflowStep', { index: index + 1 }) }}</strong><el-button v-if="canExecute" link type="danger" :disabled="workflowSteps.length === 1" @click="removeWorkflowStep(index)">{{ i18ns.t('delete') }}</el-button></div>
              <div class="form-grid">
                <el-form-item :label="i18ns.t('relay.channelProbeStepName')"><el-input v-model.trim="step.name" :disabled="!canExecute" /></el-form-item>
                <el-form-item :label="i18ns.t('relay.channelProbeMethod')"><el-select v-model="step.method" :disabled="!canExecute"><el-option value="GET" label="GET" /><el-option value="POST" label="POST" /></el-select></el-form-item>
              </div>
              <el-form-item :label="i18ns.t('relay.channelProbeUrl')"><el-input v-model.trim="step.url" :disabled="!canExecute" placeholder="https://api.example.com/balance" /></el-form-item>
              <div class="json-grid">
                <el-form-item :label="i18ns.t('relay.channelProbeHeaders')"><el-input v-model="step.headersText" type="textarea" :rows="3" :disabled="!canExecute" placeholder='{"Authorization":"Bearer {{token}}"}' /></el-form-item>
                <el-form-item :label="i18ns.t('relay.channelProbeQuery')"><el-input v-model="step.queryText" type="textarea" :rows="3" :disabled="!canExecute" placeholder='{"page":"1"}' /></el-form-item>
                <el-form-item :label="i18ns.t('relay.channelProbeBody')"><el-input v-model="step.bodyText" type="textarea" :rows="3" :disabled="!canExecute" placeholder='{"grant_type":"refresh_token"}' /></el-form-item>
                <el-form-item :label="i18ns.t('relay.channelProbeExtract')"><el-input v-model="step.extractText" type="textarea" :rows="3" :disabled="!canExecute" placeholder='{"token":"data.access_token"}' /></el-form-item>
              </div>
              <el-form-item :label="i18ns.t('relay.channelProbeBalancePath')"><el-input v-model.trim="step.balancePath" :disabled="!canExecute" placeholder="data.balance" /></el-form-item>
            </section>

            <div class="section-heading"><strong>{{ i18ns.t('relay.channelProbeCredentials') }}</strong><span>{{ i18ns.t('relay.channelProbeCredentialsHelp') }}</span><el-button v-if="canExecute" link type="primary" @click="addCredential">{{ i18ns.t('relay.channelProbeAddCredential') }}</el-button></div>
            <el-alert v-if="credentialNames.length" type="info" :closable="false" class="mb-3" :title="i18ns.t('relay.channelProbeSavedCredentials', { names: credentialNames.join(', ') })" />
            <div v-for="(credential, index) in credentials" :key="credential.id" class="credential-row"><el-input v-model.trim="credential.name" :disabled="!canExecute" :placeholder="i18ns.t('relay.channelProbeCredentialName')" /><el-input v-model="credential.value" type="password" show-password :disabled="!canExecute" :placeholder="i18ns.t('relay.channelProbeCredentialValue')" /><el-button v-if="canExecute" :icon="Delete" circle plain type="danger" @click="credentials.splice(index, 1)" /></div>
            <el-button v-if="canExecute" native-type="submit" type="primary" :loading="saving">{{ i18ns.t('save') }}</el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane :label="i18ns.t('relay.channelProbeRuns')" name="runs">
          <div class="runs-toolbar"><el-button :loading="runsLoading" @click="loadRuns">{{ i18ns.t('refresh') }}</el-button><el-button v-if="canExecute" type="primary" :disabled="!selected?.profile" :loading="runningId === selected?.channelId" @click="selected && run(selected)">{{ i18ns.t('relay.channelProbeRun') }}</el-button></div>
          <el-empty v-if="!runsLoading && runs.length === 0" :description="i18ns.t('relay.channelProbeNoRuns')" :image-size="64" />
          <section v-for="runItem in runs" :key="runItem.id" class="run-card">
            <div class="run-title"><el-tag :type="statusType(runItem.status)">{{ statusLabel(runItem.status) }}</el-tag><span>{{ formatDate(runItem.createTime) }}</span><el-button v-if="canAdjust && isApplicable(runItem)" link type="success" @click="confirmApply([runItem.id])">{{ i18ns.t('relay.channelProbeApply') }}</el-button></div>
            <el-descriptions :column="2" border size="small"><el-descriptions-item :label="i18ns.t('relay.channelProbeBalanceBefore')">{{ formatNumber(runItem.upstreamBalanceBefore) }}</el-descriptions-item><el-descriptions-item :label="i18ns.t('relay.channelProbeBalanceAfter')">{{ formatNumber(runItem.upstreamBalanceAfter) }}</el-descriptions-item><el-descriptions-item :label="i18ns.t('relay.channelProbeUpstreamDelta')">{{ formatNumber(runItem.upstreamBalanceDelta) }}</el-descriptions-item><el-descriptions-item :label="i18ns.t('relay.channelProbeBaseCost')">{{ formatNumber(runItem.baseLocalCost) }}</el-descriptions-item><el-descriptions-item :label="i18ns.t('relay.channelProbeTokens')">{{ runItem.totalTokens ?? '-' }}</el-descriptions-item><el-descriptions-item :label="i18ns.t('relay.channelProbeSuggestion')">{{ runItem.suggestedMultiplier == null ? '-' : `${runItem.suggestedMultiplier}x` }}</el-descriptions-item></el-descriptions>
            <p v-if="runItem.suggestedMultiplier != null" class="formula">{{ i18ns.t('relay.channelProbeFormula', { delta: formatNumber(runItem.upstreamBalanceDelta), distribution: runItem.distributionMultiplier, base: formatNumber(runItem.baseLocalCost), suggested: runItem.suggestedMultiplier }) }}</p>
            <el-alert v-if="runItem.errorMessage" type="error" :closable="false" :title="runItem.errorMessage" class="mt-2" />
          </section>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Delete, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { getErrorMessage } from '@/utils/error-utils'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import type { RelayChannelProbeFormat, RelayChannelProbeOverviewItemDto, RelayChannelProbeRunDto, RelayChannelProbeWorkflowStepDto } from '@/client/types.gen'

interface WorkflowFormStep { id: string; name: string; method: 'GET' | 'POST'; url: string; headersText: string; queryText: string; bodyText: string; extractText: string; balancePath: string }
interface CredentialFormRow { id: string; name: string; value: string }
interface ProbeForm { enabled: boolean; probeFormat: RelayChannelProbeFormat; probeModel: string; distributionMultiplier: number; upstreamCurrency: string; localCurrency: string }
const permissionStore = usePermissionStore()
const canExecute = computed(() => permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE))
const canAdjust = computed(() => permissionStore.hasPermission(Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST))
const loading = ref(false); const saving = ref(false); const applying = ref(false); const runsLoading = ref(false); const runningId = ref(''); const pageError = ref('')
const items = ref<RelayChannelProbeOverviewItemDto[]>([]); const selected = ref<RelayChannelProbeOverviewItemDto | null>(null); const drawerOpen = ref(false); const tab = ref('profile'); const runs = ref<RelayChannelProbeRunDto[]>([]); const selectedRuns = ref<string[]>([])
const form = ref<ProbeForm>(emptyForm()); const payloadText = ref('{}'); const workflowSteps = ref<WorkflowFormStep[]>([]); const credentials = ref<CredentialFormRow[]>([]); const credentialNames = ref<string[]>([])
let overviewRequest = 0; let runsRequest = 0; let pollTimer: ReturnType<typeof setInterval> | undefined

function emptyForm(): ProbeForm { return { enabled: true, probeFormat: 'openai', probeModel: '', distributionMultiplier: 1, upstreamCurrency: 'CNY', localCurrency: 'CNY' } }
function makeStep(): WorkflowFormStep { return { id: crypto.randomUUID(), name: 'balance', method: 'GET', url: '', headersText: '{}', queryText: '{}', bodyText: '{}', extractText: '{}', balancePath: 'balance' } }
function addWorkflowStep() { if (workflowSteps.value.length < 3) workflowSteps.value.push(makeStep()) }
function removeWorkflowStep(index: number) { workflowSteps.value.splice(index, 1) }
function addCredential() { credentials.value.push({ id: crypto.randomUUID(), name: '', value: '' }) }
function statusLabel(status: string) { return ({ queued: i18ns.t('relay.channelProbeStatusQueued'), running: i18ns.t('relay.channelProbeStatusRunning'), succeeded: i18ns.t('relay.channelProbeStatusSucceeded'), failed: i18ns.t('relay.channelProbeStatusFailed'), timed_out: i18ns.t('relay.channelProbeStatusTimedOut'), cancelled: i18ns.t('relay.channelProbeStatusCancelled') } as Record<string, string>)[status] || status }
function statusType(status: string): 'info' | 'warning' | 'success' | 'danger' { return status === 'succeeded' ? 'success' : status === 'failed' || status === 'timed_out' ? 'danger' : status === 'running' ? 'warning' : 'info' }
function formatDate(value?: string | Date) { return value ? new Date(value).toLocaleString() : '-' }
function formatNumber(value?: number) { return value == null ? '-' : Number(value).toFixed(6).replace(/\.?0+$/, '') }
function isApplicable(run?: RelayChannelProbeRunDto) { return Boolean(run && run.status === 'succeeded' && run.suggestedMultiplier != null && !run.appliedAt) }
function canSelectRun(row: RelayChannelProbeOverviewItemDto) { return Boolean(canAdjust.value && isApplicable(row.latestRun)) }
function onSelectionChange(rows: RelayChannelProbeOverviewItemDto[]) { selectedRuns.value = rows.flatMap((row) => row.latestRun ? [row.latestRun.id] : []) }
function parseObject(value: string, label: string): Record<string, unknown> { try { const parsed: unknown = JSON.parse(value || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed as Record<string, unknown> } catch { throw new Error(`${label}: ${i18ns.t('relay.channelProbeInvalidJson')}`) } }
function formWorkflow(): RelayChannelProbeWorkflowStepDto[] { const balanceCount = workflowSteps.value.filter((step) => step.balancePath.trim()).length; if (workflowSteps.value.length < 1 || balanceCount !== 1) throw new Error(i18ns.t('relay.channelProbeBalancePathRequired')); return workflowSteps.value.map((step) => { if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(step.name) || !step.url.trim()) throw new Error(i18ns.t('relay.channelProbeInvalidStep')); return { name: step.name, method: step.method, url: step.url, headers: parseObject(step.headersText, i18ns.t('relay.channelProbeHeaders')) as Record<string, string>, query: parseObject(step.queryText, i18ns.t('relay.channelProbeQuery')) as Record<string, string>, body: parseObject(step.bodyText, i18ns.t('relay.channelProbeBody')), extract: parseObject(step.extractText, i18ns.t('relay.channelProbeExtract')) as Record<string, string>, ...(step.balancePath.trim() ? { balancePath: step.balancePath.trim() } : {}) } }) }
async function loadOverview() { const requestId = ++overviewRequest; loading.value = true; pageError.value = ''; try { const result = await relayChannelProbeService.listOverview(); if (requestId === overviewRequest) items.value = result } catch (error) { if (requestId === overviewRequest) { pageError.value = getErrorMessage(error, i18ns.t('operationFailed')); ElMessage.error(pageError.value) } } finally { if (requestId === overviewRequest) loading.value = false } }
async function openDrawer(row: RelayChannelProbeOverviewItemDto) { selected.value = row; drawerOpen.value = true; tab.value = 'profile'; const profile = row.profile; form.value = profile ? { enabled: profile.enabled, probeFormat: profile.probeFormat, probeModel: profile.probeModel, distributionMultiplier: profile.distributionMultiplier, upstreamCurrency: profile.upstreamCurrency, localCurrency: profile.localCurrency } : emptyForm(); payloadText.value = JSON.stringify(profile?.probePayload ?? {}, null, 2); workflowSteps.value = (profile?.workflow ?? [makeStep()]).map(toWorkflowForm); credentialNames.value = profile?.credentialNames ?? []; credentials.value = []; await loadRuns(); startPolling() }
function toWorkflowForm(step: RelayChannelProbeWorkflowStepDto): WorkflowFormStep { return { id: crypto.randomUUID(), name: step.name, method: step.method, url: step.url, headersText: JSON.stringify(step.headers ?? {}, null, 2), queryText: JSON.stringify(step.query ?? {}, null, 2), bodyText: JSON.stringify(step.body ?? {}, null, 2), extractText: JSON.stringify(step.extract ?? {}, null, 2), balancePath: step.balancePath ?? '' } }
function resetDrawer() { selected.value = null; runs.value = []; credentials.value = []; stopPolling() }
async function loadRuns() { if (!selected.value) return; const requestId = ++runsRequest; runsLoading.value = true; try { const result = await relayChannelProbeService.listRuns(selected.value.channelId); if (requestId === runsRequest) runs.value = result.items } catch (error) { if (requestId === runsRequest) ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed'))) } finally { if (requestId === runsRequest) runsLoading.value = false } }
async function saveProfile() { if (!selected.value || saving.value) return; if (!form.value.probeModel.trim()) return ElMessage.warning(i18ns.t('relay.channelProbeModelRequired')); const credentialMap = credentials.value.reduce<Record<string, string>>((result, row) => { if (row.name.trim() && row.value) result[row.name.trim()] = row.value; return result }, {}); if (credentials.value.some((row) => Boolean(row.name.trim()) !== Boolean(row.value))) return ElMessage.warning(i18ns.t('relay.channelProbeCredentialIncomplete')); saving.value = true; try { await relayChannelProbeService.saveProfile(selected.value.channelId, { ...form.value, upstreamCurrency: form.value.upstreamCurrency.toUpperCase(), localCurrency: form.value.localCurrency.toUpperCase(), probePayload: parseObject(payloadText.value, i18ns.t('relay.channelProbePayload')), workflow: formWorkflow(), ...(Object.keys(credentialMap).length ? { credentials: credentialMap } : {}) }); ElMessage.success(i18ns.t('success')); await loadOverview(); const updated = items.value.find((item) => item.channelId === selected.value?.channelId); if (updated) await openDrawer(updated) } catch (error) { ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed'))) } finally { saving.value = false } }
async function run(row: RelayChannelProbeOverviewItemDto) { if (runningId.value) return; runningId.value = row.channelId; try { await relayChannelProbeService.createRun(row.channelId); ElMessage.success(i18ns.t('relay.channelProbeQueued')); await Promise.all([loadOverview(), selected.value?.channelId === row.channelId ? loadRuns() : Promise.resolve()]); startPolling() } catch (error) { ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed'))) } finally { runningId.value = '' } }
async function confirmApply(runIds: string[]) { if (!runIds.length || applying.value) return; try { await ElMessageBox.confirm(i18ns.t('relay.channelProbeApplyConfirm', { count: runIds.length }), i18ns.t('warning'), { type: 'warning', confirmButtonText: i18ns.t('confirm'), cancelButtonText: i18ns.t('cancel') }) } catch { return } applying.value = true; try { const result = await relayChannelProbeService.applyRuns({ runIds }); if (result.applied) ElMessage.success(i18ns.t('relay.channelProbeApplied', { count: result.applied })); if (result.rejected.length) ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；')); selectedRuns.value = []; await Promise.all([loadOverview(), loadRuns()]) } catch (error) { ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed'))) } finally { applying.value = false } }
function startPolling() { stopPolling(); pollTimer = setInterval(() => { if (runs.value.some((run) => run.status === 'queued' || run.status === 'running')) { void loadRuns(); void loadOverview() } }, 3000) }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = undefined }
onMounted(loadOverview); onBeforeUnmount(stopPolling)
</script>

<style scoped>
.channel-probe-page { width: 100%; min-height: 100%; padding: 20px 24px; box-sizing: border-box; }
.page-header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:18px; }.page-header h1 { margin:0; font-size:22px; }.page-header p { margin:6px 0 0; color:var(--el-text-color-secondary); }.probe-toolbar { min-height:32px; display:flex; justify-content:flex-end; margin:0 0 12px; }.form-grid, .json-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0 14px; }.section-heading { display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center; margin:22px 0 10px; }.section-heading span { color:var(--el-text-color-secondary); font-size:12px; }.workflow-step, .run-card { border:1px solid var(--el-border-color-lighter); padding:14px; margin-bottom:12px; border-radius:4px; }.step-header, .run-title, .runs-toolbar { display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:12px; }.run-title span { color:var(--el-text-color-secondary); font-size:12px; margin-right:auto; }.credential-row { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1.5fr) auto; gap:8px; margin-bottom:8px; }.formula { margin:10px 0 0; color:var(--el-text-color-secondary); font-size:12px; word-break:break-word; }
@media (max-width: 768px) { .channel-probe-page { padding:16px; }.page-header { flex-direction:column; }.form-grid, .json-grid { grid-template-columns:1fr; }.section-heading { grid-template-columns:1fr; }.credential-row { grid-template-columns:1fr auto; }.credential-row :deep(.el-input:nth-child(2)) { grid-column:1 / -1; grid-row:2; } }
</style>
