<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AlipayOrderDto, AlipayRefundDto, PublicAlipayConfigDto } from '@/client/types.gen'
import { alipayService } from '@/service/alipayService'
import { i18ns } from '@/locales'
import { Permission } from '@quyan/shared'
import { usePermissionStore } from '@/stores/permissionStore'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { ElMessage } from '@/utils/elementPlusRuntime'
import {
  ALIPAY_POLL_POLICY,
  estimatedAlipayCredit,
  isAlipayAmountInRange,
  isAlipayCheckoutUrl,
  isAlipayPending,
  normalizeAlipayAmount,
} from '@/utils/alipay-payment'

const props = defineProps<{ management?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const route = useRoute()
const router = useRouter()
const permissions = usePermissionStore()
const config = ref<PublicAlipayConfigDto>()
const orders = ref<AlipayOrderDto[]>([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const userId = ref('')
const amount = ref('')
const checkoutAttempted = ref(false)
const loading = ref(false)
const submitting = ref(false)
const selectedOrder = ref<AlipayOrderDto>()
const refundAmount = ref('')
const refundReason = ref('')
const refundVisible = ref(false)
const refundRequestId = ref('')
const checkoutRequest = ref<{ amount: string; requestId: string }>()
const result = ref<AlipayOrderDto>()
const refundRecords = ref<AlipayRefundDto[]>([])
const refundPage = ref(1)
const refundTotal = ref(0)
const historyVisible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let pollAttempts = 0
const canRead = computed(
  () => !props.management || permissions.hasPermission(Permission.PAYMENT_READ),
)
const showPanel = computed(
  () => canRead.value && (props.management || config.value?.enabled === true),
)
const canRefund = computed(
  () => props.management && permissions.hasPermission(Permission.PAYMENT_REFUND),
)
const preview = computed(() =>
  estimatedAlipayCredit(amount.value, config.value?.rechargeRatio ?? '0'),
)
const amountError = computed(() => {
  if (!amount.value.trim()) return i18ns.t('alipay.amountRequired')
  if (!normalizeAlipayAmount(amount.value)) return i18ns.t('alipay.amountInvalid')
  if (
    config.value &&
    !isAlipayAmountInRange(amount.value, config.value.minAmount, config.value.maxAmount)
  )
    return i18ns.t('alipay.amountOutOfRange', {
      min: config.value.minAmount,
      max: config.value.maxAmount,
    })
  return ''
})
const states = [
  'pending',
  'paid',
  'closed',
  'refunding',
  'partially_refunded',
  'refunded',
  'processing',
  'succeeded',
  'failed',
] as const
const label = (state: string) => {
  const known = states.find((value) => value === state)
  return known ? i18ns.t(`alipay.states.${known}`) : state
}

async function load() {
  if (!showPanel.value) return
  loading.value = true
  try {
    const data = await alipayService.list(
      page.value,
      pageSize.value,
      props.management,
      userId.value.trim() || undefined,
    )
    orders.value = data.records
    total.value = data.total
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.loadFailed'))
  } finally {
    loading.value = false
  }
}
async function search() {
  page.value = 1
  await load()
}
async function selectResult(order: AlipayOrderDto) {
  if (timer) clearTimeout(timer)
  result.value = order
  pollAttempts = 0
  await refreshResult()
  schedulePoll()
}
async function checkout() {
  if (submitting.value) return
  checkoutAttempted.value = true
  const paymentAmount = normalizeAlipayAmount(amount.value)
  if (!config.value?.enabled || amountError.value || !paymentAmount) return
  submitting.value = true
  try {
    if (!checkoutRequest.value || checkoutRequest.value.amount !== paymentAmount)
      checkoutRequest.value = { amount: paymentAmount, requestId: crypto.randomUUID() }
    const data = await alipayService.create(checkoutRequest.value)
    if (data.paymentUrl && isAlipayCheckoutUrl(data.paymentUrl))
      window.location.assign(data.paymentUrl)
    else {
      result.value = data.order
      await load()
    }
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.paymentFailed'))
  } finally {
    submitting.value = false
  }
}
async function refreshResult() {
  if (!result.value) return
  try {
    result.value = await alipayService.refresh(result.value.id)
    await load()
    emit('changed')
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.loadFailed'))
  }
}
function schedulePoll() {
  if (
    disposed ||
    !result.value ||
    !isAlipayPending(result.value.state) ||
    pollAttempts >= ALIPAY_POLL_POLICY.maxAttempts
  )
    return
  timer = setTimeout(async () => {
    pollAttempts++
    if (document.visibilityState === 'visible') await refreshResult()
    schedulePoll()
  }, ALIPAY_POLL_POLICY.intervalMs)
}
function openRefund(order: AlipayOrderDto) {
  selectedOrder.value = order
  refundAmount.value = (Number(order.amount) - Number(order.refundedAmount)).toFixed(2)
  refundReason.value = ''
  refundRequestId.value = crypto.randomUUID()
  refundVisible.value = true
}
async function submitRefund() {
  if (!selectedOrder.value || submitting.value) return
  submitting.value = true
  try {
    await alipayService.refund(selectedOrder.value.id, {
      amount: refundAmount.value,
      reason: refundReason.value,
      requestId: refundRequestId.value,
    })
    refundVisible.value = false
    ElMessage.success(i18ns.t('alipay.refundSubmitted'))
    await load()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.refundFailed'))
  } finally {
    submitting.value = false
  }
}
async function refundHistory(order?: AlipayOrderDto) {
  if (order) {
    selectedOrder.value = order
    refundPage.value = 1
  }
  if (!selectedOrder.value) return
  try {
    const data = await alipayService.refunds(
      selectedOrder.value.id,
      refundPage.value,
      10,
      props.management,
    )
    refundRecords.value = data.records
    refundTotal.value = data.total
    historyVisible.value = true
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.loadFailed'))
  }
}
async function refreshRefund(id: string) {
  try {
    await alipayService.refreshRefund(id)
    await refundHistory()
    await load()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.loadFailed'))
  }
}
onMounted(async () => {
  if (!canRead.value) return
  try {
    if (!props.management) {
      config.value = await alipayService.publicConfig()
      const id = route.query.paymentOrder
      if (typeof id === 'string') {
        result.value = await alipayService.order(id)
        await router.replace({ query: { paymentOrder: id } })
        await refreshResult()
        schedulePoll()
      }
    }
    await load()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.loadFailed'))
  }
})
onBeforeUnmount(() => {
  disposed = true
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <el-card v-if="showPanel" class="page-card alipay-orders" v-loading="loading">
    <template #header>{{ i18ns.t(management ? 'alipay.management' : 'alipay.title') }}</template>
    <el-alert
      v-if="config?.sandbox"
      :title="i18ns.t('alipay.sandboxNotice')"
      type="warning"
      :closable="false"
    />
    <el-form v-if="!management && config?.enabled" inline @submit.prevent="checkout">
      <el-form-item
        :label="i18ns.t('alipay.amount')"
        :error="checkoutAttempted || amount ? amountError : ''"
        ><el-input
          v-model="amount"
          inputmode="decimal"
          :placeholder="`${config.minAmount}–${config.maxAmount}`"
      /></el-form-item>
      <el-form-item
        ><span>{{ i18ns.t('alipay.credit') }}: {{ preview }}</span></el-form-item
      >
      <el-form-item
        ><el-button type="primary" :loading="submitting" @click="checkout">{{
          i18ns.t('alipay.pay')
        }}</el-button></el-form-item
      >
    </el-form>
    <el-alert
      v-if="result"
      :title="`${i18ns.t('alipay.result')}: ${label(result.state)}`"
      :description="result.state === 'pending' ? i18ns.t('alipay.pendingHelp') : result.outTradeNo"
      type="info"
      :closable="false"
    />
    <el-button v-if="result" @click="refreshResult">{{ i18ns.t('refresh') }}</el-button>
    <el-form v-if="management" inline @submit.prevent="search">
      <el-form-item :label="i18ns.t('balance.userId')"
        ><el-input v-model="userId" clearable
      /></el-form-item>
      <el-button @click="search">{{ i18ns.t('search') }}</el-button>
    </el-form>
    <el-button @click="load">{{ i18ns.t('refresh') }}</el-button>
    <el-table :data="orders">
      <el-table-column prop="outTradeNo" :label="i18ns.t('alipay.order')" min-width="220" />
      <el-table-column
        v-if="management"
        prop="userId"
        :label="i18ns.t('balance.userId')"
        min-width="180"
      />
      <el-table-column prop="amount" :label="i18ns.t('alipay.amount')" min-width="110" />
      <el-table-column prop="creditAmount" :label="i18ns.t('alipay.credit')" min-width="120" />
      <el-table-column
        prop="refundedAmount"
        :label="i18ns.t('alipay.refundedAmount')"
        min-width="110"
      />
      <el-table-column :label="i18ns.t('alipay.state')" min-width="120"
        ><template #default="{ row }"
          >{{ label(row.state) }}
          <el-tag v-if="row.sandbox" type="warning">{{
            i18ns.t('alipay.sandbox')
          }}</el-tag></template
        ></el-table-column
      >
      <el-table-column prop="tradeNo" :label="i18ns.t('alipay.tradeNo')" min-width="210" />
      <el-table-column prop="createTime" :label="i18ns.t('alipay.createdAt')" min-width="180"
        ><template #default="{ row }">{{
          new Date(row.createTime).toLocaleString()
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('alipay.actions')" min-width="180"
        ><template #default="{ row }">
          <el-button link @click="refundHistory(row)">{{
            i18ns.t('alipay.refundHistory')
          }}</el-button>
          <el-button
            v-if="canRefund && ['paid', 'partially_refunded'].includes(row.state)"
            link
            type="danger"
            @click="openRefund(row)"
            >{{ i18ns.t('alipay.refund') }}</el-button
          >
          <el-button
            v-if="!management && row.state === 'pending'"
            link
            @click="selectResult(row)"
            >{{ i18ns.t('refresh') }}</el-button
          >
        </template></el-table-column
      >
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      @current-change="load"
      @size-change="search"
    />
    <el-dialog v-model="refundVisible" :title="i18ns.t('alipay.refund')" width="min(520px, 94vw)">
      <el-alert :title="i18ns.t('alipay.refundHelp')" type="warning" :closable="false" />
      <el-form label-position="top">
        <el-form-item :label="i18ns.t('alipay.amount')"
          ><el-input v-model="refundAmount" inputmode="decimal"
        /></el-form-item>
        <el-form-item :label="i18ns.t('alipay.reason')"
          ><el-input v-model="refundReason" type="textarea" :maxlength="200"
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button
          type="danger"
          :loading="submitting"
          :disabled="!refundReason.trim()"
          @click="submitRefund"
          >{{ i18ns.t('confirm') }}</el-button
        ></template
      >
    </el-dialog>
    <el-dialog
      v-model="historyVisible"
      :title="i18ns.t('alipay.refundHistory')"
      width="min(850px, 94vw)"
    >
      <el-table :data="refundRecords">
        <el-table-column prop="outRequestNo" :label="i18ns.t('alipay.order')" min-width="180" />
        <el-table-column prop="amount" :label="i18ns.t('alipay.amount')" />
        <el-table-column :label="i18ns.t('alipay.state')"
          ><template #default="{ row }">{{ label(row.state) }}</template></el-table-column
        >
        <el-table-column prop="failureCode" :label="i18ns.t('alipay.failureCode')" />
        <el-table-column v-if="canRefund" :label="i18ns.t('alipay.actions')"
          ><template #default="{ row }"
            ><el-button v-if="row.state === 'processing'" link @click="refreshRefund(row.id)">{{
              i18ns.t('refresh')
            }}</el-button></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        v-model:current-page="refundPage"
        :total="refundTotal"
        :page-size="10"
        layout="total, prev, pager, next"
        @current-change="refundHistory()"
      />
    </el-dialog>
  </el-card>
</template>

<style scoped>
.alipay-orders {
  margin-block: 20px;
}
.alipay-orders :deep(.el-alert),
.alipay-orders :deep(.el-form),
.alipay-orders :deep(.el-pagination) {
  margin-block: 12px;
}
.alipay-orders :deep(.el-pagination) {
  max-width: 100%;
  overflow-x: auto;
}
</style>
