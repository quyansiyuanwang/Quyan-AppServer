<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CopyDocument, Plus, Refresh, Switch } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { BalanceGiftCodeDto, BalanceTransferConfigDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { balanceTransferService } from '@/service/balanceTransferService'

const emit = defineEmits<{ changed: [] }>()
const userInfoStore = useUserInfoStore()
const loading = ref(false)
const submitting = ref(false)
const mode = ref<'gift' | 'transfer'>('gift')
const config = ref<BalanceTransferConfigDto | null>(null)
const giftAmount = ref<number | undefined>()
const giftExpiry = ref<string | undefined>()
const recipientUsername = ref('')
const transferAmount = ref<number | undefined>()
const transferDescription = ref('')
const giftCodes = ref<BalanceGiftCodeDto[]>([])
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

async function load() {
  loading.value = true
  try {
    const [nextConfig, list] = await Promise.all([
      balanceTransferService.getConfig(),
      balanceTransferService.listGiftCodes(),
    ])
    config.value = nextConfig
    giftCodes.value = list.records
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('balance.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function createGiftCode() {
  if (!giftAmount.value || giftAmount.value <= 0) return
  submitting.value = true
  try {
    const result = await balanceTransferService.createGiftCode({
      amount: giftAmount.value,
      expiresAt: giftExpiry.value,
    })
    giftCodes.value.unshift(result)
    userInfoStore.setUserInfo({
      balance: round4(Number(userInfoStore.userInfo.balance || 0) - result.totalDebit),
    })
    giftAmount.value = undefined
    giftExpiry.value = undefined
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
onMounted(load)
</script>

<template>
  <section class="balance-transfer-panel" v-loading="loading">
    <div class="balance-transfer-panel__heading">
      <div>
        <h2>{{ i18ns.t('balance.transferOut') }}</h2>
        <p>{{ i18ns.t('balance.transferOutHint') }}</p>
      </div>
      <el-button :icon="Refresh" circle @click="load" />
    </div>

    <el-tabs v-model="mode" class="balance-transfer-panel__tabs">
      <el-tab-pane v-if="config?.giftCodeEnabled" :label="i18ns.t('balance.giftCode')" name="gift">
        <el-form
          label-position="top"
          class="balance-transfer-panel__form"
          @submit.prevent="createGiftCode"
        >
          <el-form-item :label="i18ns.t('balance.receivedAmount')">
            <el-input-number
              v-model="giftAmount"
              :min="0.01"
              :precision="4"
              :step="1"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('redemption.expiresAt')">
            <el-date-picker
              v-model="giftExpiry"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
              clearable
            />
          </el-form-item>
          <div class="balance-transfer-panel__preview">
            <span>{{ i18ns.t('balance.fee') }} {{ formatNumber(giftFee) }}</span>
            <strong
              >{{ i18ns.t('balance.totalDebit') }}
              {{ formatNumber(Number(giftAmount || 0) + giftFee) }}</strong
            >
          </div>
          <el-button type="primary" :icon="Plus" :loading="submitting" native-type="submit">
            {{ i18ns.t('balance.createGiftCode') }}
          </el-button>
        </el-form>
      </el-tab-pane>

      <el-tab-pane
        v-if="config?.directTransferEnabled"
        :label="i18ns.t('balance.directTransfer')"
        name="transfer"
      >
        <el-form
          label-position="top"
          class="balance-transfer-panel__form"
          @submit.prevent="createTransfer"
        >
          <el-form-item :label="i18ns.t('balance.recipientUsername')">
            <el-input v-model="recipientUsername" autocomplete="off" />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.receivedAmount')">
            <el-input-number
              v-model="transferAmount"
              :min="0.01"
              :precision="4"
              :step="1"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.transferNote')">
            <el-input v-model="transferDescription" maxlength="500" show-word-limit />
          </el-form-item>
          <div class="balance-transfer-panel__preview">
            <span>{{ i18ns.t('balance.fee') }} {{ formatNumber(transferFee) }}</span>
            <strong
              >{{ i18ns.t('balance.totalDebit') }}
              {{ formatNumber(Number(transferAmount || 0) + transferFee) }}</strong
            >
          </div>
          <el-button type="primary" :icon="Switch" :loading="submitting" native-type="submit">
            {{ i18ns.t('balance.directTransfer') }}
          </el-button>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <div class="balance-transfer-panel__codes">
      <h3>{{ i18ns.t('balance.myGiftCodes') }}</h3>
      <el-table :data="giftCodes" size="small" empty-text="-">
        <el-table-column prop="code" :label="i18ns.t('redemption.code')" min-width="210">
          <template #default="{ row }">
            <el-button text :icon="CopyDocument" @click="copyCode(row.code)">{{
              row.code
            }}</el-button>
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
    </div>
  </section>
</template>

<style scoped>
.balance-transfer-panel {
  padding: 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.balance-transfer-panel__heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
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
.balance-transfer-panel__tabs {
  margin-top: 14px;
}
.balance-transfer-panel__form {
  max-width: 520px;
}
.balance-transfer-panel__preview {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: -4px 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.balance-transfer-panel__preview strong {
  color: var(--el-text-color-primary);
}
.balance-transfer-panel__codes {
  margin-top: 18px;
}
.balance-transfer-panel__codes h3 {
  margin-bottom: 10px;
}
@media (max-width: 768px) {
  .balance-transfer-panel {
    padding: 14px;
  }
}
</style>
