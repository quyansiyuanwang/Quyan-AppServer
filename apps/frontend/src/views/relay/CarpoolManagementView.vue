<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CustomCode } from '@/constant/custom-code'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusRuntime'
import type {
  CarpoolDeliveryChannelDto,
  CarpoolDeliveryChannelListResponse,
  CarpoolOrderDto,
} from '@/client/types.gen'
import CarpoolStateTag from '@/components/carpool/CarpoolStateTag.vue'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import {
  carpoolEventLabel,
  carpoolStates,
  formatCarpoolDate,
  formatCarpoolMoney,
  formatCarpoolQuota,
} from './carpool'

const orders = ref<CarpoolOrderDto[]>([])
const stateLabel = (value: string) =>
  ({
    open: i18ns.t('carpool.state.open'),
    submitted: i18ns.t('carpool.state.submitted'),
    accepted: i18ns.t('carpool.state.accepted'),
    fulfilled: i18ns.t('carpool.state.fulfilled'),
    failed: i18ns.t('carpool.state.failed'),
    cancelled: i18ns.t('carpool.state.cancelled'),
    expired: i18ns.t('carpool.state.expired'),
  })[value] ?? value

const total = ref(0)
const stateCounts = ref<Record<string, number>>({})
const page = ref(1)
const pageSize = 20
const keyword = ref('')
const state = ref<string>()
const loading = ref(false)
const detail = ref<CarpoolOrderDto>()
const drawerVisible = ref(false)
const fulfillmentVisible = ref(false)
const channelKeyword = ref('')
const channels = ref<CarpoolDeliveryChannelDto[]>([])
const channelTotal = ref(0)
const channelPage = ref(1)
const selectedChannelId = ref('')
const fulfillmentOrderId = ref('')
const fulfillmentLoading = ref(false)
const fulfillmentOrder = ref<CarpoolOrderDto>()
const channelLoading = ref(false)
let fulfillmentVersion = 0
let channelRequestVersion = 0
const selectedChannel = computed(() =>
  channels.value.find((channel) => channel.id === selectedChannelId.value),
)
const load = async () => {
  loading.value = true
  try {
    const result = await carpoolService.admin(
      page.value,
      pageSize,
      state.value,
      keyword.value || undefined,
    )
    const data = result.data as {
      total: number
      records: CarpoolOrderDto[]
      stateCounts?: Record<string, number>
    }
    orders.value = data.records
    total.value = data.total
    stateCounts.value = data.stateCounts ?? {}
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('carpool.common.loadFailed'))
  } finally {
    loading.value = false
  }
}
const search = async () => {
  page.value = 1
  await load()
}
const openDetail = async (id: string) => {
  try {
    detail.value = (await carpoolService.adminDetail(id)).data as CarpoolOrderDto
    drawerVisible.value = true
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('carpool.common.loadFailed'))
  }
}
const isMessageBoxCancel = (error: unknown) => error === 'cancel' || error === 'close'
const isNotFound = (error: unknown) => {
  const source = error as {
    code?: number
    status?: number
    response?: { status?: number; data?: { code?: number } }
  } | null
  return (
    source?.response?.status === 404 ||
    source?.status === 404 ||
    source?.code === CustomCode.NOT_FOUND ||
    source?.response?.data?.code === CustomCode.NOT_FOUND
  )
}
const resetFulfillment = () => {
  fulfillmentVersion++
  channelRequestVersion++
  fulfillmentVisible.value = false
  fulfillmentOrderId.value = ''
  fulfillmentOrder.value = undefined
  selectedChannelId.value = ''
  channels.value = []
  channelTotal.value = 0
  channelLoading.value = false
}
const orderChanged = async () => {
  resetFulfillment()
  ElMessage.warning(i18ns.t('carpool.manage.orderChanged'))
  await load()
}
const handleFulfillmentError = async (error: unknown, orderId: string, orderLookup = false) => {
  // A channel 404 is not an order 404. Recheck the order before choosing the notice.
  let changed = orderLookup && isNotFound(error)
  if (!orderLookup) {
    try {
      const current = (await carpoolService.adminDetail(orderId)).data as CarpoolOrderDto
      changed = current.id !== orderId || current.state !== 'accepted'
    } catch (lookupError) {
      changed = isNotFound(lookupError)
    }
  }
  if (changed) return orderChanged()
  resetFulfillment()
  showRequestErrorNotice(error, i18ns.t('carpool.manage.operationFailed'))
  await load()
}
const accept = async (order: CarpoolOrderDto) => {
  try {
    await ElMessageBox.confirm(
      i18ns.t('carpool.manage.acceptConfirm'),
      i18ns.t('carpool.common.confirmTitle'),
    )
  } catch (error) {
    if (!isMessageBoxCancel(error))
      showRequestErrorNotice(error, i18ns.t('carpool.manage.operationFailed'))
    return
  }
  try {
    await carpoolService.accept(order.id)
    ElMessage.success(i18ns.t('carpool.manage.accepted'))
    await load()
    if (drawerVisible.value && detail.value?.id === order.id) await openDetail(order.id)
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('carpool.manage.operationFailed'))
  }
}
const loadChannels = async (orderId: string, version = fulfillmentVersion) => {
  if (!orderId) return
  const requestVersion = ++channelRequestVersion
  channelLoading.value = true
  try {
    const result = await carpoolService.deliveryChannels(
      channelPage.value,
      10,
      channelKeyword.value || undefined,
      orderId,
    )
    if (version !== fulfillmentVersion || requestVersion !== channelRequestVersion) return
    const data = result.data as CarpoolDeliveryChannelListResponse
    channels.value = data.records
    channelTotal.value = data.total
  } catch (error) {
    if (version === fulfillmentVersion && requestVersion === channelRequestVersion) throw error
  } finally {
    if (requestVersion === channelRequestVersion) channelLoading.value = false
  }
}
const safeLoadChannels = async () => {
  const orderId = fulfillmentOrderId.value
  const version = fulfillmentVersion
  try {
    await loadChannels(orderId, version)
  } catch (error) {
    if (version === fulfillmentVersion) await handleFulfillmentError(error, orderId)
  }
}
const openFulfill = async (order: CarpoolOrderDto) => {
  if (fulfillmentLoading.value) return
  resetFulfillment()
  const version = fulfillmentVersion
  const orderId = order.id.trim()
  fulfillmentOrderId.value = orderId
  channelKeyword.value = ''
  channelPage.value = 1
  let orderLookup = true
  try {
    const latest = (await carpoolService.adminDetail(orderId)).data as CarpoolOrderDto
    if (version !== fulfillmentVersion) return
    if (latest.id !== orderId || latest.state !== 'accepted') return await orderChanged()
    fulfillmentOrder.value = latest
    fulfillmentVisible.value = true
    orderLookup = false
    await loadChannels(orderId, version)
  } catch (error) {
    if (version === fulfillmentVersion) await handleFulfillmentError(error, orderId, orderLookup)
  }
}
const fulfill = async () => {
  if (fulfillmentLoading.value || channelLoading.value) return
  const orderId = fulfillmentOrderId.value
  const relayChannelId = selectedChannelId.value
  const version = fulfillmentVersion
  if (!orderId || !relayChannelId)
    return ElMessage.warning(i18ns.t('carpool.manage.channelRequired'))
  fulfillmentLoading.value = true
  try {
    try {
      await ElMessageBox.confirm(
        i18ns.t('carpool.manage.fulfillConfirm'),
        i18ns.t('carpool.common.confirmTitle'),
        { type: 'warning' },
      )
    } catch (error) {
      if (!isMessageBoxCancel(error))
        showRequestErrorNotice(error, i18ns.t('carpool.manage.operationFailed'))
      return
    }
    if (version !== fulfillmentVersion) return
    try {
      await carpoolService.fulfill(orderId, { relayChannelId })
    } catch (error) {
      if (version === fulfillmentVersion) await handleFulfillmentError(error, orderId)
      return
    }
    if (version === fulfillmentVersion) resetFulfillment()
    ElMessage.success(i18ns.t('carpool.manage.delivered'))
    // Delivery succeeded. Refresh errors must never be presented as delivery failure.
    await load()
    if (drawerVisible.value && detail.value?.id === orderId) await openDetail(orderId)
  } finally {
    fulfillmentLoading.value = false
  }
}
const fail = async (order: CarpoolOrderDto) => {
  let reason: string
  try {
    const prompt = await ElMessageBox.prompt(
      i18ns.t('carpool.manage.reasonHint'),
      i18ns.t('carpool.manage.failConfirm'),
      {
        inputPattern: /\S+/,
        inputErrorMessage: i18ns.t('carpool.manage.reasonRequired'),
        confirmButtonText: i18ns.t('carpool.manage.fail'),
      },
    )
    reason = prompt.value.trim()
  } catch (error) {
    if (!isMessageBoxCancel(error))
      showRequestErrorNotice(error, i18ns.t('carpool.manage.operationFailed'))
    return
  }
  try {
    await carpoolService.fail(order.id, { reason })
    ElMessage.success(i18ns.t('carpool.manage.refunded'))
    await load()
    if (drawerVisible.value && detail.value?.id === order.id) await openDetail(order.id)
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('carpool.manage.operationFailed'))
  }
}
const countByState = (target: string) => stateCounts.value[target] ?? 0
onMounted(() => void load())
</script>

<template>
  <section class="page manage-page">
    <header class="heading">
      <h1>{{ i18ns.t('carpool.manage.title') }}</h1>
      <p>{{ i18ns.t('carpool.manage.subtitle') }}</p>
    </header>
    <div class="stats">
      <el-card
        ><strong>{{ countByState('submitted') }}</strong
        ><span>{{ i18ns.t('carpool.state.submitted') }}</span></el-card
      ><el-card
        ><strong>{{ countByState('accepted') }}</strong
        ><span>{{ i18ns.t('carpool.state.accepted') }}</span></el-card
      ><el-card
        ><strong>{{ countByState('failed') }}</strong
        ><span>{{ i18ns.t('carpool.state.failed') }}</span></el-card
      >
    </div>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        clearable
        :placeholder="i18ns.t('carpool.common.searchOrders')"
        @keyup.enter="search"
      /><el-select
        v-model="state"
        clearable
        :placeholder="i18ns.t('carpool.common.allStates')"
        @change="search"
        ><el-option
          v-for="item in carpoolStates"
          :key="item"
          :value="item"
          :label="stateLabel(item)" /></el-select
      ><el-button @click="search">{{ i18ns.t('carpool.common.searchButton') }}</el-button>
    </div>
    <el-table v-loading="loading" :data="orders"
      ><el-table-column
        prop="packageName"
        :label="i18ns.t('carpool.common.colPackage')"
        min-width="160"
      /><el-table-column :label="i18ns.t('carpool.common.colMembers')"
        ><template #default="{ row }"
          >{{ row.activeMemberCount }}/{{ row.maxMembers }}</template
        ></el-table-column
      ><el-table-column :label="i18ns.t('carpool.common.colState')"
        ><template #default="{ row }"
          ><CarpoolStateTag :state="row.state" /></template></el-table-column
      ><el-table-column :label="i18ns.t('carpool.common.colActions')" width="250"
        ><template #default="{ row }"
          ><el-button link @click="openDetail(row.id)">{{
            i18ns.t('carpool.manage.detail')
          }}</el-button
          ><el-button v-if="row.state === 'submitted'" type="primary" link @click="accept(row)">{{
            i18ns.t('carpool.manage.accept')
          }}</el-button
          ><el-button
            v-if="row.state === 'accepted'"
            type="success"
            link
            @click="openFulfill(row)"
            >{{ i18ns.t('carpool.manage.fulfill') }}</el-button
          ><el-button
            v-if="['submitted', 'accepted'].includes(row.state)"
            type="danger"
            link
            @click="fail(row)"
            >{{ i18ns.t('carpool.manage.fail') }}</el-button
          ></template
        ></el-table-column
      ></el-table
    >
    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      layout="prev,pager,next"
      :total="total"
      @current-change="load"
    />
    <el-drawer v-model="drawerVisible" size="620px" :title="detail?.packageName"
      ><template v-if="detail"
        ><el-descriptions :column="2" border
          ><el-descriptions-item :label="i18ns.t('carpool.common.colState')"
            ><CarpoolStateTag :state="detail.state" /></el-descriptions-item
          ><el-descriptions-item :label="i18ns.t('carpool.common.deadline')">{{
            formatCarpoolDate(detail.formationDeadlineAt)
          }}</el-descriptions-item
          ><el-descriptions-item :label="i18ns.t('carpool.common.quota')">{{
            formatCarpoolQuota(detail.totalQuota, detail.quotaUnit)
          }}</el-descriptions-item
          ><el-descriptions-item :label="i18ns.t('carpool.detail.funds')">{{
            formatCarpoolMoney(detail.salePrice)
          }}</el-descriptions-item
          ><el-descriptions-item
            v-if="detail.failureReason"
            :label="i18ns.t('carpool.manage.failureReason')"
            :span="2"
            >{{ detail.failureReason }}</el-descriptions-item
          ></el-descriptions
        >
        <h3>{{ i18ns.t('carpool.detail.membersTitle') }}</h3>
        <el-table :data="detail.members"
          ><el-table-column
            prop="username"
            :label="i18ns.t('carpool.common.colMembers')"
          /><el-table-column
            prop="state"
            :label="i18ns.t('carpool.common.colState')"
          /><el-table-column :label="i18ns.t('carpool.detail.colPayable')"
            ><template #default="{ row }">{{
              formatCarpoolMoney(row.payableAmount)
            }}</template></el-table-column
          ><el-table-column :label="i18ns.t('carpool.detail.colReserved')"
            ><template #default="{ row }">{{
              formatCarpoolMoney(row.reservedAmount)
            }}</template></el-table-column
          ></el-table
        >
        <h3>{{ i18ns.t('carpool.detail.timelineTitle') }}</h3>
        <el-timeline
          ><el-timeline-item
            v-for="event in detail.events"
            :key="event.id"
            :timestamp="formatCarpoolDate(event.createTime)"
            >{{ carpoolEventLabel(event.type) }}</el-timeline-item
          ></el-timeline
        ></template
      ></el-drawer
    >
    <el-dialog
      v-model="fulfillmentVisible"
      :title="i18ns.t('carpool.manage.fulfillTitle')"
      width="min(520px, 94vw)"
      :close-on-click-modal="!fulfillmentLoading"
      :close-on-press-escape="!fulfillmentLoading"
      :show-close="!fulfillmentLoading"
      @close="resetFulfillment"
      ><h3>{{ fulfillmentOrder?.packageName }}</h3>
      <p>{{ i18ns.t('carpool.manage.deliveryHint') }}</p>
      <el-input
        v-model="channelKeyword"
        clearable
        :placeholder="i18ns.t('carpool.manage.channelSearch')"
        @input="
          () => {
            channelPage = 1
            safeLoadChannels()
          }
        "
      /><el-radio-group v-model="selectedChannelId" class="channel-list" v-loading="channelLoading"
        ><el-radio v-for="channel in channels" :key="channel.id" :value="channel.id"
          >{{ channel.name }} · {{ channel.channelType }}</el-radio
        ></el-radio-group
      ><el-empty
        v-if="!channelLoading && !channels.length"
        :description="i18ns.t('carpool.manage.noChannels')"
      /><el-pagination
        v-if="channelTotal > 10"
        v-model:current-page="channelPage"
        :page-size="10"
        layout="prev,pager,next"
        :total="channelTotal"
        @current-change="safeLoadChannels"
      />
      <p v-if="selectedChannel" class="selected">
        {{ i18ns.t('carpool.manage.selectedChannel', { name: selectedChannel.name }) }}
      </p>
      <template #footer
        ><el-button :disabled="fulfillmentLoading" @click="resetFulfillment">{{
          i18ns.t('carpool.common.cancel')
        }}</el-button
        ><el-button
          type="primary"
          :loading="fulfillmentLoading"
          :disabled="!selectedChannelId || channelLoading"
          @click="fulfill"
          >{{ i18ns.t('carpool.manage.fulfill') }}</el-button
        ></template
      ></el-dialog
    >
  </section>
</template>
<style scoped>
.manage-page {
  display: grid;
  gap: 16px;
}
.toolbar {
  display: flex;
  gap: 12px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.stats strong,
.stats span {
  display: block;
}
.stats strong {
  font-size: 26px;
}
.channel-list {
  display: grid;
  gap: 10px;
  margin: 16px 0;
}
.selected {
  color: var(--el-color-primary);
}
@media (max-width: 700px) {
  .toolbar {
    flex-direction: column;
  }
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>
