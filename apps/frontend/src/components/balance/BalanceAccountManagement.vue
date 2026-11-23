<template>
  <div class="account-management page-shell" v-loading="loading">
    <el-card>
      <template #header
        ><div class="heading">
          <div>
            <h2>{{ t('overdraft.title') }}</h2>
            <p>{{ t('overdraft.subtitle') }}</p>
          </div>
          <el-button @click="load">{{ t('refresh') }}</el-button>
        </div></template
      >
      <el-tabs v-model="tab">
        <el-tab-pane :label="t('overdraft.accounts')" name="accounts">
          <div class="toolbar">
            <el-input
              v-model="filter"
              clearable
              :placeholder="t('balance.enterUserId')"
              @keyup.enter="search"
            />
            <el-button type="primary" @click="search">{{ t('search') }}</el-button>
            <el-button v-if="canOverdraft" @click="openBatch()"
              >{{ t('overdraft.batch') }} ({{ selectedUsers.length }})</el-button
            >
          </div>
          <el-alert v-if="error" :title="error" type="error" :closable="false" />
          <el-table
            ref="accountTable"
            :data="records"
            row-key="userId"
            @selection-change="selectionChanged"
          >
            <el-table-column
              v-if="canOverdraft"
              type="selection"
              :reserve-selection="true"
              width="45"
            />
            <el-table-column prop="username" :label="t('username')" min-width="130"
              ><template #default="{ row }"
                ><strong>{{ row.username }}</strong>
                <div class="user-id">{{ row.userId }}</div></template
              ></el-table-column
            >
            <el-table-column
              v-for="field in accountFields"
              :key="field"
              :label="fieldLabel(field)"
              min-width="130"
              align="right"
              class-name="amount-cell"
              ><template #default="{ row }">{{ money(row[field]) }}</template></el-table-column
            >
            <el-table-column
              :label="t('overdraft.limit')"
              min-width="125"
              align="right"
              class-name="amount-cell"
              ><template #default="{ row }"
                ><span :class="{ failure: row.calculationError }">{{
                  row.calculationError ? t('overdraft.calculationError') : money(row.overdraftLimit)
                }}</span></template
              ></el-table-column
            >
            <el-table-column
              :label="t('overdraft.used')"
              min-width="115"
              align="right"
              class-name="amount-cell"
              ><template #default="{ row }">{{
                money(row.usedOverdraft)
              }}</template></el-table-column
            >
            <el-table-column
              :label="t('overdraft.remaining')"
              min-width="115"
              align="right"
              class-name="amount-cell"
              ><template #default="{ row }">{{
                money(row.remainingOverdraft)
              }}</template></el-table-column
            >
            <el-table-column :label="t('overdraft.source')" min-width="150"
              ><template #default="{ row }"
                ><el-tag :type="row.ruleInherited ? 'info' : 'primary'">{{
                  row.ruleInherited ? t('overdraft.inherit') : t('overdraft.override')
                }}</el-tag></template
              ></el-table-column
            >
            <el-table-column :label="t('actions')" min-width="235" fixed="right"
              ><template #default="{ row }">
                <el-button v-if="canAdjust" size="small" @click="openAdjustment(row)">{{
                  t('overdraft.adjust')
                }}</el-button>
                <el-button v-if="canOverdraft" size="small" @click="openBatch(row)">{{
                  t('overdraft.configure')
                }}</el-button>
                <el-button v-if="canRecharge" size="small" @click="openRecharge(row)">{{
                  t('balance.adjustBalance')
                }}</el-button>
                <el-button v-if="canHistory" size="small" @click="openHistory(row)">{{
                  t('balance.viewHistory')
                }}</el-button>
              </template></el-table-column
            >
          </el-table>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="total"
            :page-sizes="[20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            @current-change="load"
            @size-change="search"
          />
        </el-tab-pane>
        <el-tab-pane :label="t('overdraft.defaults')" name="defaults">
          <el-alert :title="t('overdraft.defaultsHint')" type="info" :closable="false" />
          <div class="default-form">
            <OverdraftRuleEditor v-model="defaultRule" :disabled="!canOverdraft" />
            <el-form label-position="top"
              ><el-form-item :label="t('overdraft.categories')"
                ><el-checkbox-group v-model="defaultCategories" :disabled="!canOverdraft"
                  ><el-checkbox
                    v-for="category in BALANCE_OVERDRAFT_CATEGORIES"
                    :key="category"
                    :value="category"
                    >{{ categoryLabel(category) }}</el-checkbox
                  ></el-checkbox-group
                ></el-form-item
              ></el-form
            >
            <el-alert :title="t('overdraft.boundaryHint')" :closable="false" type="warning" />
            <el-button v-if="canOverdraft" type="primary" :loading="saving" @click="saveDefaults">{{
              t('overdraft.saveDefaults')
            }}</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
    <AlipayOrdersPanel management />
    <el-dialog
      v-model="batchVisible"
      :title="t('overdraft.batch')"
      width="min(900px, 96vw)"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item :label="t('overdraft.batchUsernames')">
          <el-input-tag
            v-model="batchUsernames"
            :placeholder="t('overdraft.usernamePlaceholder')"
            :aria-label="t('overdraft.batchUsernames')"
            :delimiter="/[\s,;，；]+/"
            save-on-blur
            clearable
            data-testid="batch-usernames"
          />
        </el-form-item>
      </el-form>
      <p class="batch-hint">{{ t('overdraft.pasteHint') }}</p>
      <p>
        {{
          t('overdraft.targetCount', {
            count: batchUsernames.length,
            max: BALANCE_MANAGEMENT_POLICY.batchSize,
          })
        }}
      </p>
      <el-form label-position="top">
        <el-form-item :label="t('overdraft.ruleAction')"
          ><el-radio-group v-model="ruleAction"
            ><el-radio-button value="keep">{{ t('overdraft.keep') }}</el-radio-button
            ><el-radio-button value="override">{{ t('overdraft.override') }}</el-radio-button
            ><el-radio-button value="inherit">{{
              t('overdraft.inherit')
            }}</el-radio-button></el-radio-group
          ></el-form-item
        >
      </el-form>
      <OverdraftRuleEditor v-if="ruleAction === 'override'" v-model="batchRule" />
      <el-form label-position="top"
        ><el-form-item :label="t('overdraft.categoryAction')"
          ><el-radio-group v-model="categoryAction"
            ><el-radio-button value="keep">{{ t('overdraft.keep') }}</el-radio-button
            ><el-radio-button value="override">{{ t('overdraft.override') }}</el-radio-button
            ><el-radio-button value="inherit">{{
              t('overdraft.inherit')
            }}</el-radio-button></el-radio-group
          ></el-form-item
        >
        <el-checkbox-group v-if="categoryAction === 'override'" v-model="batchCategories"
          ><el-checkbox
            v-for="category in BALANCE_OVERDRAFT_CATEGORIES"
            :key="category"
            :value="category"
            >{{ categoryLabel(category) }}</el-checkbox
          ></el-checkbox-group
        >
      </el-form>
      <el-table v-if="previewRows.length" :data="previewRows" max-height="300"
        ><el-table-column prop="username" :label="t('username')" /><el-table-column
          prop="totalRecharged"
          :label="t('overdraft.totalRecharged')" /><el-table-column
          prop="overdraftLimit"
          :label="t('overdraft.limit')" /><el-table-column
          prop="remainingOverdraft"
          :label="t('overdraft.remaining')"
      /></el-table>
      <template #footer
        ><el-button @click="batchVisible = false">{{ t('cancel') }}</el-button
        ><el-button :loading="saving" @click="preview">{{ t('overdraft.preview') }}</el-button
        ><el-button
          type="primary"
          :disabled="!previewRows.length"
          :loading="saving"
          @click="saveBatch"
          >{{ t('confirm') }}</el-button
        ></template
      >
    </el-dialog>
    <el-dialog
      v-model="adjustVisible"
      :title="t('overdraft.adjust')"
      width="min(650px, 96vw)"
      :close-on-click-modal="false"
    >
      <p>{{ adjustingRow?.username }} · {{ adjustingRow?.userId }}</p>
      <div v-for="field in accountFields" :key="field" class="adjust-field">
        <el-checkbox v-model="adjustments[field].enabled"
          >{{ fieldLabel(field) }} ({{ money(adjustingRow?.[field] ?? 0) }})</el-checkbox
        >
        <div v-if="adjustments[field].enabled" class="toolbar">
          <el-select v-model="adjustments[field].mode"
            ><el-option value="delta" :label="t('overdraft.delta')" /><el-option
              value="set"
              :label="t('overdraft.set')" /></el-select
          ><el-input-number
            v-model="adjustments[field].value"
            :precision="4"
            :min="-BALANCE_MANAGEMENT_POLICY.maximumAmount"
            :max="BALANCE_MANAGEMENT_POLICY.maximumAmount"
          />
        </div>
      </div>
      <el-input
        v-model="reason"
        type="textarea"
        :maxlength="500"
        :placeholder="t('overdraft.reason')"
      />
      <el-alert :title="t('overdraft.adjustHint')" type="info" :closable="false" />
      <el-table v-if="adjustmentPreview" :data="adjustmentPreviewRows"
        ><el-table-column prop="label" :label="t('overdraft.type')" /><el-table-column
          prop="before"
          :label="t('overdraft.before')" /><el-table-column
          prop="after"
          :label="t('overdraft.after')"
      /></el-table>
      <el-alert
        v-if="adjustmentPreview?.after.calculationError"
        :title="t('overdraft.calculationError')"
        type="warning"
        :closable="false"
      />
      <template #footer
        ><el-button @click="adjustVisible = false">{{ t('cancel') }}</el-button
        ><el-button :loading="saving" @click="previewAdjustment">{{
          t('overdraft.preview')
        }}</el-button
        ><el-button
          type="primary"
          :disabled="!adjustmentPreview"
          :loading="saving"
          @click="saveAdjustment"
          >{{ t('confirm') }}</el-button
        ></template
      >
    </el-dialog>
    <el-dialog
      v-model="rechargeVisible"
      :title="t('balance.adjustBalance')"
      width="min(500px, 96vw)"
      ><el-form label-position="top"
        ><el-form-item :label="t('balance.amount')"
          ><el-input-number
            v-model="rechargeAmount"
            :precision="4"
            :min="-100000"
            :max="100000" /></el-form-item
        ><el-form-item :label="t('balance.countAsStatistics')"
          ><el-switch v-model="rechargeStatistics" /></el-form-item
        ><el-input
          v-model="rechargeReason"
          type="textarea"
          :maxlength="500"
          :placeholder="t('overdraft.reason')" /></el-form
      ><template #footer
        ><el-button type="primary" :loading="saving" @click="saveRecharge">{{
          t('confirm')
        }}</el-button></template
      ></el-dialog
    >
    <el-dialog
      v-model="historyVisible"
      :title="t('balance.transactionHistory')"
      width="min(1000px, 96vw)"
      ><el-table :data="history" v-loading="historyLoading"
        ><el-table-column
          prop="createTime"
          :label="t('balance.updateTime')"
          min-width="180" /><el-table-column
          prop="type"
          :label="t('overdraft.type')" /><el-table-column
          prop="amount"
          :label="t('balance.amount')" /><el-table-column
          prop="balanceAfter"
          :label="t('balance.resultBalance')" /><el-table-column
          prop="description"
          :label="t('balance.description')"
          min-width="220" /></el-table
      ><el-pagination
        v-model:current-page="historyPage"
        :page-size="20"
        :total="historyTotal"
        layout="total, prev, pager, next"
        @current-change="loadHistory"
    /></el-dialog>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  BALANCE_MANAGEMENT_POLICY,
  BALANCE_OVERDRAFT_CATEGORIES,
  DEFAULT_BALANCE_OVERDRAFT_RULE,
  Permission,
  type BalanceOverdraftCategory,
  type BalanceOverdraftRule,
} from '@quyan/shared'
import type {
  AdjustBalanceAccountRequest,
  BalanceAdjustmentPreviewDto,
  BalanceTransactionResponse,
  ManagedBalanceAccountDto,
  PreviewOverdraftRequest,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { usePermissionStore } from '@/stores/permissionStore'
import { balanceManagementService as service } from '@/service/balanceManagementService'
import { balanceTransactionService } from '@/service/balanceTransactionService'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { getErrorMessage } from '@/utils/error-utils'
import OverdraftRuleEditor from './OverdraftRuleEditor.vue'
import AlipayOrdersPanel from './AlipayOrdersPanel.vue'
const t = i18ns.t
const permissions = usePermissionStore()
const canOverdraft = computed(() => permissions.hasPermission(Permission.BALANCE_OVERDRAFT_MANAGE))
const canAdjust = computed(() => permissions.hasPermission(Permission.BALANCE_ACCOUNT_ADJUST))
const canRecharge = computed(() => permissions.hasPermission(Permission.BALANCE_RECHARGE))
const canHistory = computed(() => permissions.hasPermission(Permission.BALANCE_READ))
const accountFields = ['balance', 'totalRecharged', 'totalUsed'] as const
type Field = (typeof accountFields)[number]
const fieldLabel = (field: Field) =>
  field === 'balance' ? t('balance.currentBalance') : t(`overdraft.${field}`)
const categoryLabel = (category: BalanceOverdraftCategory) => t(`overdraft.category.${category}`)
const money = (value: number) => value.toFixed(4)
const tab = ref('accounts'),
  loading = ref(false),
  saving = ref(false),
  error = ref(''),
  filter = ref('')
const records = ref<ManagedBalanceAccountDto[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(20)
const defaultRule = ref<BalanceOverdraftRule>({ ...DEFAULT_BALANCE_OVERDRAFT_RULE }),
  defaultCategories = ref<BalanceOverdraftCategory[]>([]),
  defaultVersion = ref(0)
const selectedUsers = ref<ManagedBalanceAccountDto[]>([])
const accountTable = ref<{ clearSelection(): void }>()
async function run(task: () => Promise<void>) {
  saving.value = true
  try {
    await task()
  } catch (err) {
    ElMessage.error(getErrorMessage(err, t('overdraft.failed')))
  } finally {
    saving.value = false
  }
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [list, defaults] = await Promise.all([
      service.list({
        page: page.value,
        pageSize: pageSize.value,
        userId: filter.value.trim() || undefined,
      }),
      service.defaults(),
    ])
    if (!list || !defaults) throw new Error(t('overdraft.failed'))
    records.value = list.records
    total.value = list.total
    defaultRule.value = defaults.rule
    defaultCategories.value = defaults.categories
    defaultVersion.value = defaults.version
  } catch (err) {
    records.value = []
    total.value = 0
    error.value = getErrorMessage(err, t('overdraft.failed'))
  } finally {
    loading.value = false
  }
}
function search() {
  page.value = 1
  void load()
}
function selectionChanged(rows: ManagedBalanceAccountDto[]) {
  selectedUsers.value = rows
}
async function saveDefaults() {
  await run(async () => {
    await service.saveDefaults({
      rule: defaultRule.value,
      categories: defaultCategories.value,
      version: defaultVersion.value,
    })
    ElMessage.success(t('overdraft.saved'))
    await load()
  })
}
const batchVisible = ref(false),
  batchNames = ref<string[]>([]),
  ruleAction = ref<'keep' | 'inherit' | 'override'>('override'),
  categoryAction = ref<'keep' | 'inherit' | 'override'>('keep')
const batchRule = ref<BalanceOverdraftRule>({ ...DEFAULT_BALANCE_OVERDRAFT_RULE }),
  batchCategories = ref<BalanceOverdraftCategory[]>([]),
  previewRows = ref<ManagedBalanceAccountDto[]>([])
const batchUsernames = computed({
  get: () => batchNames.value,
  set: (values: string[] | undefined) => {
    const names = [
      ...new Map(
        (values ?? [])
          .flatMap((value) => value.split(/[\s,;，；]+/))
          .filter(Boolean)
          .map((name) => [name.toLowerCase(), name]),
      ).values(),
    ]
    if (names.length > BALANCE_MANAGEMENT_POLICY.batchSize) {
      ElMessage.error(t('overdraft.invalidBatch'))
      return
    }
    batchNames.value = names
  },
})
function openBatch(row?: ManagedBalanceAccountDto) {
  batchNames.value = (row ? [row] : selectedUsers.value).map((user) => user.username)
  batchRule.value = { ...(row?.rule ?? defaultRule.value) }
  batchCategories.value = [...(row?.categories ?? defaultCategories.value)]
  ruleAction.value = 'override'
  categoryAction.value = 'keep'
  previewRows.value = []
  batchVisible.value = true
}
function previewBody(): PreviewOverdraftRequest {
  return {
    usernames: batchUsernames.value,
    ...(ruleAction.value === 'keep'
      ? {}
      : { rule: ruleAction.value === 'inherit' ? null : batchRule.value }),
    ...(categoryAction.value === 'keep'
      ? {}
      : { categories: categoryAction.value === 'inherit' ? null : batchCategories.value }),
  }
}
let batchRevision = 0
watch(
  [batchNames, batchRule, batchCategories, ruleAction, categoryAction, batchVisible],
  () => {
    batchRevision++
    previewRows.value = []
  },
  { deep: true, flush: 'sync' },
)
async function preview() {
  await run(async () => {
    if (
      !batchUsernames.value.length ||
      batchUsernames.value.length > BALANCE_MANAGEMENT_POLICY.batchSize ||
      (ruleAction.value === 'keep' && categoryAction.value === 'keep')
    )
      throw new Error(t('overdraft.invalidBatch'))
    const revision = batchRevision
    previewRows.value = []
    const rows = (await service.preview(previewBody())) ?? []
    if (revision !== batchRevision) return
    if (rows.length !== batchUsernames.value.length) throw new Error(t('overdraft.failed'))
    previewRows.value = rows
  })
}
async function saveBatch() {
  await run(async () => {
    const first = previewRows.value[0]
    if (!first) return
    const body = previewBody()
    await service.saveUsers({
      targets: previewRows.value.map((row) => ({ userId: row.userId, version: row.version })),
      defaultVersion: first.defaultVersion,
      ...(body.rule === undefined ? {} : { rule: body.rule }),
      ...(body.categories === undefined ? {} : { categories: body.categories }),
    })
    batchVisible.value = false
    accountTable.value?.clearSelection()
    selectedUsers.value = []
    ElMessage.success(t('overdraft.saved'))
    await load()
  })
}
const adjustVisible = ref(false),
  adjustingRow = ref<ManagedBalanceAccountDto>(),
  reason = ref(''),
  operationId = ref('')
const adjustments = reactive<
  Record<Field, { enabled: boolean; mode: 'delta' | 'set'; value: number }>
>({
  balance: { enabled: false, mode: 'delta', value: 0 },
  totalRecharged: { enabled: false, mode: 'delta', value: 0 },
  totalUsed: { enabled: false, mode: 'delta', value: 0 },
})
const adjustmentPreview = ref<BalanceAdjustmentPreviewDto>()
let adjustmentRevision = 0
const adjustmentPreviewRows = computed(() => {
  const result = adjustmentPreview.value
  if (!result) return []
  return ([...accountFields, 'overdraftLimit', 'remainingOverdraft'] as const).map((field) => ({
    label:
      field === 'overdraftLimit'
        ? t('overdraft.limit')
        : field === 'remainingOverdraft'
          ? t('overdraft.remaining')
          : fieldLabel(field as Field),
    before: money(result.before[field]),
    after: money(result.after[field]),
  }))
})
watch(
  [adjustments, reason, adjustingRow, adjustVisible],
  () => {
    adjustmentRevision++
    adjustmentPreview.value = undefined
    operationId.value = crypto.randomUUID()
  },
  { deep: true, flush: 'sync' },
)
function openAdjustment(row: ManagedBalanceAccountDto) {
  adjustingRow.value = row
  reason.value = ''
  for (const field of accountFields)
    Object.assign(adjustments[field], { enabled: false, mode: 'delta', value: 0 })
  adjustVisible.value = true
}
function adjustmentBody(): AdjustBalanceAccountRequest {
  const row = adjustingRow.value
  if (!row || !reason.value.trim()) throw new Error(t('overdraft.reason'))
  const body: AdjustBalanceAccountRequest = {
    userId: row.userId,
    operationId: operationId.value,
    reason: reason.value.trim(),
  }
  for (const field of accountFields) {
    const change = adjustments[field]
    if (change.enabled)
      body[field] = {
        mode: change.mode,
        value: change.value,
        ...(change.mode === 'set' ? { expected: row[field] } : {}),
      }
  }
  return body
}
async function previewAdjustment() {
  await run(async () => {
    const revision = adjustmentRevision
    const result = await service.previewAdjustment(adjustmentBody())
    if (revision === adjustmentRevision) adjustmentPreview.value = result
  })
}
async function saveAdjustment() {
  await run(async () => {
    if (!adjustmentPreview.value) return
    await service.adjust(adjustmentBody())
    adjustVisible.value = false
    ElMessage.success(t('overdraft.saved'))
    await load()
  })
}
const rechargeVisible = ref(false),
  rechargeUserId = ref(''),
  rechargeAmount = ref(0),
  rechargeStatistics = ref(true),
  rechargeReason = ref('')
function openRecharge(row: ManagedBalanceAccountDto) {
  rechargeUserId.value = row.userId
  rechargeAmount.value = 0
  rechargeStatistics.value = true
  rechargeReason.value = ''
  rechargeVisible.value = true
}
async function saveRecharge() {
  await run(async () => {
    if (!rechargeAmount.value) throw new Error(t('balance.adjustAmountZero'))
    await balanceTransactionService.recharge({
      userId: rechargeUserId.value,
      amount: rechargeAmount.value,
      description: rechargeReason.value,
      countAsStatistics: rechargeStatistics.value,
    })
    rechargeVisible.value = false
    ElMessage.success(t('overdraft.saved'))
    await load()
  })
}
const historyVisible = ref(false),
  historyLoading = ref(false),
  history = ref<BalanceTransactionResponse[]>([]),
  historyPage = ref(1),
  historyTotal = ref(0),
  historyUserId = ref('')
function openHistory(row: ManagedBalanceAccountDto) {
  historyUserId.value = row.userId
  historyPage.value = 1
  historyVisible.value = true
  void loadHistory()
}
async function loadHistory() {
  historyLoading.value = true
  try {
    const response = await balanceTransactionService.getAllTransactions({
      userId: historyUserId.value,
      limit: 20,
      offset: (historyPage.value - 1) * 20,
    })
    history.value = response.data?.records ?? []
    historyTotal.value = response.data?.total ?? 0
  } catch (err) {
    history.value = []
    ElMessage.error(getErrorMessage(err, t('overdraft.failed')))
  } finally {
    historyLoading.value = false
  }
}
onMounted(load)
</script>
<style scoped>
.account-management {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 20px;
}
.heading,
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.heading {
  justify-content: space-between;
}
.heading h2 {
  margin: 0;
  font-size: 20px;
}
.heading p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}
.toolbar {
  margin: 14px 0;
}
.toolbar > .el-input {
  max-width: 340px;
}
.toolbar > .el-select {
  max-width: 220px;
}
.user-id {
  margin-top: 5px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.batch-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.account-management :deep(.amount-cell) {
  font-variant-numeric: tabular-nums;
}
.default-form {
  max-width: 700px;
  margin-top: 24px;
}
.default-form > .el-button {
  margin-top: 20px;
}
.el-pagination {
  margin-top: 20px;
  flex-wrap: wrap;
}
.adjust-field {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.failure {
  color: var(--el-color-danger);
}
.el-alert {
  margin: 12px 0;
}
@media (max-width: 600px) {
  .heading {
    align-items: flex-start;
  }
  .toolbar > .el-input {
    max-width: none;
  }
  .account-management {
    padding: 8px;
  }
}
</style>
