<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, Refresh, Switch } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { BalanceGiftCodeDto, BalanceTransferConfigDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { balanceTransferService } from '@/service/balanceTransferService'

const emit = defineEmits<{ changed: [] }>()
const userInfoStore = useUserInfoStore()
const loading = ref(false)
const submitting = ref(false)
const config = ref<BalanceTransferConfigDto | null>(null)
const giftDialogVisible = ref(false)
const transferDialogVisible = ref(false)
const giftAmount = ref<number | undefined>()
const giftExpiry = ref<string | undefined>()
const recipientUsername = ref('')
const transferAmount = ref<number | undefined>()
const transferDescription = ref('')
const giftCodes = ref<BalanceGiftCodeDto[]>([])
const giftCodePagination = ref({ page: 1, pageSize: 20, total: 0 })
const giftCodeStateLabels = {
  active: i18ns.t('balance.giftCodeState.active'),
  redeemed: i18ns.t('balance.giftCodeState.redeemed'),
  cancelled: i18ns.t('balance.giftCodeState.cancelled'),
} as const
const getGiftCodeStateLabel = (state: string) =>
  giftCodeStateLabels[state as keyof typeof giftCodeStateLabels] || state

const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000
const giftFee = computed(() =>
  round4((Number(giftAmount.value || 0) * Number(config.value?.giftCodeFeePercent || 0)) / 100),
)
const transferFee = computed(() =>
  round4(
    (Number(transferAmount.value || 0) * Number(config.value?.directTransferFeePercent || 0)) / 100,
  ),
)
const giftCancellationFeeRefund = computed(() =>
  round4((giftFee.value * Number(config.value?.giftCodeCancelFeeRefundPercent || 0)) / 100),
)
const giftCancellationRefund = computed(() =>
  round4(Number(giftAmount.value || 0) + giftCancellationFeeRefund.value),
)

async function load(page = giftCodePagination.value.page) {
  giftCodePagination.value.page = Math.max(1, page)
  loading.value = true
  try {
    const [nextConfig, list] = await Promise.all([
      balanceTransferService.getConfig(),
      balanceTransferService.listGiftCodes(
        giftCodePagination.value.page,
        giftCodePagination.value.pageSize,
      ),
    ])
    config.value = nextConfig
    giftCodes.value = list.records
    giftCodePagination.value.total = list.total
    giftCodePagination.value.page = list.page
    giftCodePagination.value.pageSize = list.pageSize
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('balance.loadFailed'))
  } finally {
    loading.value = false
  }
}

const refresh = () => load(giftCodePagination.value.page)
const handleGiftCodePageChange = (page: number) => load(page)
const handleGiftCodePageSizeChange = (pageSize: number) => {
  giftCodePagination.value.pageSize = pageSize
  return load(1)
}

async function createGiftCode() {
  if (!giftAmount.value || giftAmount.value <= 0) return
  submitting.value = true
  try {
    const result = await balanceTransferService.createGiftCode({
      amount: giftAmount.value,
      expiresAt: giftExpiry.value,
    })
    userInfoStore.setUserInfo({
      balance: round4(Number(userInfoStore.userInfo.balance || 0) - result.totalDebit),
    })
    giftAmount.value = undefined
    giftExpiry.value = undefined
    giftDialogVisible.value = false
    await load(1)
    ElMessage.success(i18ns.t('balance.giftCodeCreated'))
    emit('changed')
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('balance.transferFailed'))
  } finally {
    submitting.value = false
  }
}

async function createTransfer() {
  if (!transferAmount.value || transferAmount.value <= 0 || !recipientUsername.value.trim()) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('balance.transferIrreversible'),
      i18ns.t('balance.transfer'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )
  } catch {
    return
  }
  submitting.value = true
  try {
    const result = await balanceTransferService.createTransfer({
      recipientUsername: recipientUsername.value.trim(),
      amount: transferAmount.value,
      description: transferDescription.value.trim() || undefined,
    })
    userInfoStore.setUserInfo({ balance: result.balance })
    recipientUsername.value = ''
    transferAmount.value = undefined
    transferDescription.value = ''
    transferDialogVisible.value = false
    ElMessage.success(i18ns.t('balance.transferSuccess'))
    emit('changed')
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('balance.transferFailed'))
  } finally {
    submitting.value = false
  }
}

async function cancelGiftCode(code: BalanceGiftCodeDto) {
  try {
    await ElMessageBox.confirm(
      i18ns.t('balance.cancelGiftCodeConfirm'),
      i18ns.t('balance.cancelGiftCode'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )
    const result = await balanceTransferService.cancelGiftCode(code.id)
    code.state = 'cancelled'
    code.cancelledAt = new Date().toISOString()
    code.refundedAmount = result.refundedAmount
    userInfoStore.setUserInfo({ balance: result.balance })
    ElMessage.success(i18ns.t('balance.giftCodeCancelled'))
    emit('changed')
  } catch (error: any) {
    if (error === 'cancel') return
    ElMessage.error(error.message || i18ns.t('balance.transferFailed'))
  }
}

async function copyCode(code: string) {
  await navigator.clipboard.writeText(code)
  ElMessage.success(i18ns.t('copySuccess'))
}

const formatNumber = (value: number) => Number(value || 0).toFixed(4)
const formatPercent = (value: number) =>
  `${Number(value || 0)
    .toFixed(4)
    .replace(/\.?0+$/, '')}%`
const openGiftDialog = () => {
  giftDialogVisible.value = true
}
const openTransferDialog = () => {
  transferDialogVisible.value = true
}
onMounted(load)
</script>

<template>
  <section class="balance-transfer-panel" v-loading="loading">
    <div class="balance-transfer-panel__heading">
      <div>
        <h2>{{ i18ns.t('balance.transferOut') }}</h2>
        <p>{{ i18ns.t('balance.transferOutHint') }}</p>
      </div>
      <div class="balance-transfer-panel__actions">
        <el-button
          v-if="config?.giftCodeEnabled"
          type="primary"
          :icon="Plus"
          @click="openGiftDialog"
        >
          {{ i18ns.t('balance.createGiftCode') }}
        </el-button>
        <el-button v-if="config?.directTransferEnabled" :icon="Switch" @click="openTransferDialog">
          {{ i18ns.t('balance.directTransfer') }}
        </el-button>
        <el-button :icon="Refresh" circle @click="refresh" />
      </div>
    </div>

    <div class="balance-transfer-panel__codes">
      <h3>{{ i18ns.t('balance.myGiftCodes') }}</h3>
      <el-table :data="giftCodes" size="small" empty-text="-">
        <el-table-column prop="code" :label="i18ns.t('redemption.code')" min-width="210">
          <template #default="{ row }">
            <el-link type="primary" @click="copyCode(row.code)">{{ row.code }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="amount" :label="i18ns.t('balance.receivedAmount')" width="120" />
        <el-table-column prop="feeAmount" :label="i18ns.t('balance.fee')" width="110" />
        <el-table-column :label="i18ns.t('balance.status')" width="110">
          <template #default="{ row }">{{ getGiftCodeStateLabel(row.state) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="100">
          <template #default="{ row }">
            <el-button
              v-if="row.state === 'active'"
              type="danger"
              link
              @click="cancelGiftCode(row)"
            >
              {{ i18ns.t('cancel') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="giftCodePagination.page"
        v-model:page-size="giftCodePagination.pageSize"
        :total="giftCodePagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @current-change="handleGiftCodePageChange"
        @size-change="handleGiftCodePageSizeChange"
      />
    </div>

    <el-dialog
      v-model="giftDialogVisible"
      :title="i18ns.t('balance.createGiftCode')"
      width="min(560px, 92vw)"
    >
      <el-form
        label-position="top"
        class="balance-transfer-dialog__form"
        @submit.prevent="createGiftCode"
      >
        <div class="balance-transfer-dialog__grid">
          <el-form-item :label="i18ns.t('balance.receivedAmount')">
            <el-input-number
              v-model="giftAmount"
              :min="0.01"
              :precision="4"
              :step="0.0001"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('redemption.expiresAt')">
            <el-date-picker
              v-model="giftExpiry"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              clearable
            />
          </el-form-item>
        </div>
        <div class="balance-transfer-dialog__summary">
          <div class="balance-transfer-dialog__summary-row">
            <span>{{ i18ns.t('balance.feeRate') }}</span>
            <strong>{{ formatPercent(config?.giftCodeFeePercent || 0) }}</strong>
          </div>
          <div class="balance-transfer-dialog__summary-row">
            <span>{{ i18ns.t('balance.fee') }}</span>
            <strong>{{ formatNumber(giftFee) }}</strong>
          </div>
          <div
            class="balance-transfer-dialog__summary-row balance-transfer-dialog__summary-row--total"
          >
            <span>{{ i18ns.t('balance.totalDebit') }}</span>
            <strong>{{ formatNumber(Number(giftAmount || 0) + giftFee) }}</strong>
          </div>
          <div class="balance-transfer-dialog__summary-row">
            <span>{{ i18ns.t('balance.cancelFeeRefundRate') }}</span>
            <strong>{{ formatPercent(config?.giftCodeCancelFeeRefundPercent || 0) }}</strong>
          </div>
          <div class="balance-transfer-dialog__summary-row">
            <span>{{ i18ns.t('balance.cancelFeeRefund') }}</span>
            <strong>{{ formatNumber(giftCancellationFeeRefund) }}</strong>
          </div>
          <div
            class="balance-transfer-dialog__summary-row balance-transfer-dialog__summary-row--total"
          >
            <span>{{ i18ns.t('balance.estimatedCancelRefund') }}</span>
            <strong>{{ formatNumber(giftCancellationRefund) }}</strong>
          </div>
          <p class="balance-transfer-dialog__summary-hint">
            {{ i18ns.t('balance.giftCodeRateSnapshotHint') }}
          </p>
        </div>
        <div class="balance-transfer-dialog__footer">
          <el-button @click="giftDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :icon="Plus" :loading="submitting" native-type="submit">{{
            i18ns.t('balance.createGiftCode')
          }}</el-button>
        </div>
      </el-form>
    </el-dialog>

    <el-dialog
      v-model="transferDialogVisible"
      :title="i18ns.t('balance.directTransfer')"
      width="min(620px, 92vw)"
    >
      <el-form
        label-position="top"
        class="balance-transfer-dialog__form"
        @submit.prevent="createTransfer"
      >
        <div class="balance-transfer-dialog__grid">
          <el-form-item :label="i18ns.t('balance.recipientUsername')">
            <el-input v-model="recipientUsername" autocomplete="off" />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.receivedAmount')">
            <el-input-number
              v-model="transferAmount"
              :min="0.01"
              :precision="4"
              :step="0.0001"
              controls-position="right"
            />
          </el-form-item>
        </div>
        <el-form-item :label="i18ns.t('balance.transferNote')">
          <el-input v-model="transferDescription" maxlength="500" show-word-limit />
        </el-form-item>
        <div class="balance-transfer-dialog__summary">
          <div class="balance-transfer-dialog__summary-row">
            <span>{{ i18ns.t('balance.feeRate') }}</span>
            <strong>{{ formatPercent(config?.directTransferFeePercent || 0) }}</strong>
          </div>
          <div class="balance-transfer-dialog__summary-row">
            <span>{{ i18ns.t('balance.fee') }}</span>
            <strong>{{ formatNumber(transferFee) }}</strong>
          </div>
          <div
            class="balance-transfer-dialog__summary-row balance-transfer-dialog__summary-row--total"
          >
            <span>{{ i18ns.t('balance.totalDebit') }}</span>
            <strong>{{ formatNumber(Number(transferAmount || 0) + transferFee) }}</strong>
          </div>
          <p class="balance-transfer-dialog__summary-hint">
            {{ i18ns.t('balance.transferIrreversibleHint') }}
          </p>
        </div>
        <div class="balance-transfer-dialog__footer">
          <el-button @click="transferDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :icon="Switch" :loading="submitting" native-type="submit">{{
            i18ns.t('balance.directTransfer')
          }}</el-button>
        </div>
      </el-form>
    </el-dialog>
  </section>
</template>

<style scoped>
.balance-transfer-panel {
  padding: 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  margin-bottom: 20px;
}
.balance-transfer-panel__heading {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: start;
}
.balance-transfer-panel__heading h2,
.balance-transfer-panel__heading h3 {
  margin: 0;
  font-size: 16px;
}
.balance-transfer-panel__heading p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.balance-transfer-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.balance-transfer-panel__codes {
  margin-top: 18px;
}
.balance-transfer-panel__codes h3 {
  margin-bottom: 10px;
}
.balance-transfer-dialog__form {
  padding-top: 2px;
}
.balance-transfer-dialog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.balance-transfer-dialog__grid :deep(.el-form-item) {
  min-width: 0;
}
.balance-transfer-dialog__grid :deep(.el-input-number),
.balance-transfer-dialog__grid :deep(.el-date-editor) {
  width: 100%;
}
.balance-transfer-dialog__summary {
  display: grid;
  gap: 6px 16px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.balance-transfer-dialog__summary-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}
.balance-transfer-dialog__summary-row strong {
  color: var(--el-text-color-primary);
}
.balance-transfer-dialog__summary-row--total {
  padding-top: 4px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.balance-transfer-dialog__summary-hint {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.balance-transfer-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
@media (max-width: 768px) {
  .balance-transfer-panel {
    padding: 14px;
  }
  .balance-transfer-panel__actions {
    width: 100%;
    justify-content: flex-start;
  }
  .balance-transfer-dialog__grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .balance-transfer-dialog__summary {
    gap: 8px;
  }
  .balance-transfer-dialog__footer > .el-button {
    flex: 1;
  }
  .balance-transfer-panel__actions > .el-button:not(.is-circle) {
    flex: 1 1 148px;
  }
  .balance-transfer-panel__actions > .el-button.is-circle {
    flex: 0 0 auto;
  }
  .balance-transfer-panel__codes :deep(.el-table) {
    font-size: 12px;
  }
  .balance-transfer-panel__codes :deep(.el-table__cell) {
    padding: 8px 0;
  }
  .balance-transfer-panel__codes :deep(.el-pagination) {
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .balance-transfer-dialog__footer {
    width: 100%;
  }
}
</style>
