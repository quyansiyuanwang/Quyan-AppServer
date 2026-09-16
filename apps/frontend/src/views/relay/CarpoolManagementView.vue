<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  } finally {
    loading.value = false
  }
}
const search = async () => {
  page.value = 1
  await load()
}
const openDetail = async (id: string) => {
  detail.value = (await carpoolService.adminDetail(id)).data as CarpoolOrderDto
  drawerVisible.value = true
}
const accept = async (order: CarpoolOrderDto) => {
  await ElMessageBox.confirm(
    i18ns.t('carpool.manage.acceptConfirm'),
    i18ns.t('carpool.common.confirmTitle'),
  )
  await carpoolService.accept(order.id)
  ElMessage.success(i18ns.t('carpool.manage.accepted'))
  await load()
  if (detail.value?.id === order.id) await openDetail(order.id)
}
const loadChannels = async () => {
  if (!detail.value) return
  const result = await carpoolService.deliveryChannels(
    channelPage.value,
    10,
    channelKeyword.value || undefined,
    detail.value.id,
  )
  const data = result.data as CarpoolDeliveryChannelListResponse
  channels.value = data.records
  channelTotal.value = data.total
}
const openFulfill = async (order: CarpoolOrderDto) => {
  detail.value = order
  selectedChannelId.value = ''
  channelKeyword.value = ''
  channelPage.value = 1
  await loadChannels()
  fulfillmentVisible.value = true
}
const fulfill = async () => {
  if (!detail.value || !selectedChannelId.value)
    return ElMessage.warning(i18ns.t('carpool.manage.channelRequired'))
  await ElMessageBox.confirm(
    i18ns.t('carpool.manage.fulfillConfirm'),
    i18ns.t('carpool.common.confirmTitle'),
    { type: 'warning' },
  )
  await carpoolService.fulfill(detail.value.id, { relayChannelId: selectedChannelId.value })
  fulfillmentVisible.value = false
  ElMessage.success(i18ns.t('carpool.manage.delivered'))
  await load()
  if (drawerVisible.value) await openDetail(detail.value.id)
}
const fail = async (order: CarpoolOrderDto) => {
  const prompt = await ElMessageBox.prompt(
    i18ns.t('carpool.manage.reasonHint'),
    i18ns.t('carpool.manage.failConfirm'),
    {
      inputPattern: /\S+/,
      inputErrorMessage: i18ns.t('carpool.manage.reasonRequired'),
      confirmButtonText: i18ns.t('carpool.manage.fail'),
    },
  )
  await carpoolService.fail(order.id, { reason: prompt.value.trim() })
  ElMessage.success(i18ns.t('carpool.manage.refunded'))
  await load()
  if (detail.value?.id === order.id) await openDetail(order.id)
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
      width="520px"
      ><p>{{ i18ns.t('carpool.manage.deliveryHint') }}</p>
      <el-input
        v-model="channelKeyword"
        clearable
        :placeholder="i18ns.t('carpool.manage.channelSearch')"
        @input="
          () => {
            channelPage = 1
            loadChannels()
          }
        "
      /><el-radio-group v-model="selectedChannelId" class="channel-list"
        ><el-radio v-for="channel in channels" :key="channel.id" :value="channel.id"
          >{{ channel.name }} · {{ channel.channelType }}</el-radio
        ></el-radio-group
      ><el-empty
        v-if="!channels.length"
        :description="i18ns.t('carpool.manage.noChannels')"
      /><el-pagination
        v-if="channelTotal > 10"
        v-model:current-page="channelPage"
        :page-size="10"
        layout="prev,pager,next"
        :total="channelTotal"
        @current-change="loadChannels"
      />
      <p v-if="selectedChannel" class="selected">
        {{ i18ns.t('carpool.manage.selectedChannel', { name: selectedChannel.name }) }}
      </p>
      <template #footer
        ><el-button @click="fulfillmentVisible = false">{{
          i18ns.t('carpool.common.cancel')
        }}</el-button
        ><el-button type="primary" :disabled="!selectedChannelId" @click="fulfill">{{
          i18ns.t('carpool.manage.fulfill')
        }}</el-button></template
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
