<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusRuntime'
import { useRoute } from 'vue-router'
import type { CarpoolMemberDto, CarpoolOrderDto } from '@/client/types.gen'
import CarpoolStateTag from '@/components/carpool/CarpoolStateTag.vue'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import {
  carpoolEventLabel,
  deadlineText,
  formatCarpoolDate,
  formatCarpoolMoney,
  formatCarpoolQuota,
} from './carpool'

const route = useRoute()
const order = ref<CarpoolOrderDto>()
const loading = ref(false)
const inviteHours = ref(24)
const inviteDialogVisible = ref(false)
const id = computed(() => String((route.params as { id: string }).id))
const activeMembers = computed(
  () => order.value?.members.filter((member) => member.state !== 'left') ?? [],
)
const paymentTotal = computed(() =>
  activeMembers.value.reduce((total, member) => total + Number(member.paymentRatio), 0),
)
const quotaTotal = computed(() =>
  activeMembers.value.reduce((total, member) => total + Number(member.quotaRatio), 0),
)
const canSaveAllocation = computed(() => paymentTotal.value === 100 && quotaTotal.value === 100)
const load = async () => {
  loading.value = true
  try {
    order.value = (await carpoolService.detail(id.value)).data as CarpoolOrderDto
  } finally {
    loading.value = false
  }
}
const allocationPayload = () => {
  const allocationMode = order.value?.allocationMode ?? 'equal'
  if (allocationMode === 'equal') return { allocationMode }
  return {
    allocationMode,
    members: activeMembers.value.map((member) => ({
      memberId: member.id,
      paymentRatio: Number(member.paymentRatio),
      quotaRatio: Number(member.quotaRatio),
    })),
  }
}
const setMode = async (mode: 'equal' | 'custom') => {
  if (!order.value) return
  if (mode === 'custom') {
    await ElMessageBox.confirm(
      i18ns.t('carpool.detail.customModeWarning'),
      i18ns.t('carpool.common.confirmTitle'),
      { type: 'warning' },
    )
  }
  order.value.allocationMode = mode
  if (mode === 'equal') {
    await carpoolService.allocate(id.value, allocationPayload())
    ElMessage.success(i18ns.t('carpool.detail.ratiosUpdated'))
    await load()
  }
}
const save = async () => {
  if (!canSaveAllocation.value) return ElMessage.warning(i18ns.t('carpool.detail.ratioInvalid'))
  await carpoolService.allocate(id.value, allocationPayload())
  ElMessage.success(i18ns.t('carpool.detail.ratiosUpdated'))
  await load()
}
const confirmShare = async () => {
  await carpoolService.confirm(id.value)
  ElMessage.success(i18ns.t('carpool.detail.balanceFrozen'))
  await load()
}
const createInvite = async () => {
  const result = await carpoolService.invite(id.value, inviteHours.value)
  const token = (result.data as { token: string }).token
  const link = `${location.origin}/subscriptions/carpools/invite/${token}`
  let copied = false
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(link)
    copied = true
  } catch {
    await ElMessageBox.alert(
      i18ns.t('carpool.detail.inviteCopyFallbackMessage', { link }),
      i18ns.t('carpool.detail.inviteCopyFallbackTitle'),
      { confirmButtonText: i18ns.t('common.confirm') },
    )
  }
  inviteDialogVisible.value = false
  if (copied) ElMessage.success(i18ns.t('carpool.detail.inviteCopied'))
  else ElMessage.warning(i18ns.t('carpool.detail.inviteCopyManual'))
}
const runConfirm = async (title: string, action: () => Promise<unknown>, success: string) => {
  await ElMessageBox.confirm(title, i18ns.t('carpool.common.confirmTitle'), { type: 'warning' })
  await action()
  ElMessage.success(success)
  await load()
}
const memberLabel = (member: CarpoolMemberDto) =>
  member.role === 'owner'
    ? i18ns.t('carpool.member.owner')
    : ({
        pending: i18ns.t('carpool.member.pending'),
        confirmed: i18ns.t('carpool.member.confirmed'),
        left: i18ns.t('carpool.member.left'),
        delivered: i18ns.t('carpool.member.delivered'),
      }[member.state] ?? member.state)
const orderNextStep = computed(() => {
  if (!order.value) return ''
  if (order.value.viewerActions?.reason) return order.value.viewerActions.reason
  if (order.value.state === 'open')
    return order.value.allConfirmed
      ? i18ns.t('carpool.next.submit')
      : i18ns.t('carpool.next.waiting')
  if (order.value.state === 'submitted') return i18ns.t('carpool.next.operatorReview')
  if (order.value.state === 'accepted') return i18ns.t('carpool.next.operatorDelivery')
  if (order.value.state === 'fulfilled') return i18ns.t('carpool.next.done')
  if (order.value.state === 'failed') return i18ns.t('carpool.next.failed')
  return i18ns.t('carpool.next.closed')
})
onMounted(() => void load())
</script>

<template>
  <section v-loading="loading" class="page detail-page" v-if="order">
    <header class="detail-header">
      <div>
        <h1>{{ order.packageName }}</h1>
        <p>{{ i18ns.t('carpool.detail.orderId', { id: order.id }) }}</p>
      </div>
      <CarpoolStateTag :state="order.state" />
    </header>
    <el-alert
      v-if="order.failureReason"
      type="error"
      :closable="false"
      :title="i18ns.t('carpool.detail.failureReason', { reason: order.failureReason })"
    />
    <el-card shadow="never">
      <div class="overview-grid">
        <div>
          <strong>{{ i18ns.t('carpool.common.nextStep') }}</strong>
          <p>
            {{ orderNextStep }}
          </p>
        </div>
        <div>
          <strong>{{ i18ns.t('carpool.common.deadline') }}</strong>
          <p>
            {{ deadlineText(order.formationDeadlineAt)
            }}<small>{{ formatCarpoolDate(order.formationDeadlineAt) }}</small>
          </p>
        </div>
        <div>
          <strong>{{ i18ns.t('carpool.common.quota') }}</strong>
          <p>{{ formatCarpoolQuota(order.totalQuota, order.quotaUnit) }}</p>
        </div>
        <div>
          <strong>{{ i18ns.t('carpool.detail.funds') }}</strong>
          <p>
            {{
              i18ns.t('carpool.detail.fundsSummary', {
                reserved: formatCarpoolMoney(
                  order.members.reduce((sum, member) => sum + member.reservedAmount, 0),
                ),
                total: formatCarpoolMoney(order.salePrice),
              })
            }}
          </p>
        </div>
      </div>
    </el-card>
    <el-steps
      :active="['open', 'submitted', 'accepted', 'fulfilled'].indexOf(order.state) + 1"
      finish-status="success"
      align-center
    >
      <el-step :title="i18ns.t('carpool.timeline.open')" /><el-step
        :title="i18ns.t('carpool.timeline.submitted')"
      /><el-step :title="i18ns.t('carpool.timeline.accepted')" /><el-step
        :title="i18ns.t('carpool.timeline.fulfilled')"
      />
    </el-steps>

    <el-card shadow="never"
      ><template #header
        ><div class="card-title">
          <span>{{ i18ns.t('carpool.detail.membersTitle') }}</span
          ><span>{{ activeMembers.length }} / {{ order.maxMembers }}</span>
        </div></template
      >
      <el-alert
        v-if="order.state === 'open'"
        type="info"
        :closable="false"
        :title="i18ns.t('carpool.detail.confirmHint')"
      />
      <div v-if="order.viewerActions?.canAllocate" class="allocation-mode">
        <span>{{ i18ns.t('carpool.detail.allocationMode') }}</span
        ><el-radio-group :model-value="order.allocationMode" @change="setMode"
          ><el-radio-button value="equal">{{ i18ns.t('carpool.detail.equal') }}</el-radio-button
          ><el-radio-button value="custom">{{
            i18ns.t('carpool.detail.custom')
          }}</el-radio-button></el-radio-group
        >
      </div>
      <el-table :data="order.members">
        <el-table-column
          prop="username"
          :label="i18ns.t('carpool.common.colMembers')"
          min-width="130"
          ><template #default="{ row }"
            ><strong>{{ row.username }}</strong
            ><small>{{ memberLabel(row) }}</small></template
          ></el-table-column
        >
        <el-table-column :label="i18ns.t('carpool.detail.colPaymentRatio')" min-width="140"
          ><template #default="{ row }"
            ><el-input-number
              v-if="
                order.allocationMode === 'custom' &&
                order.viewerActions?.canAllocate &&
                row.state !== 'left'
              "
              v-model="row.paymentRatio"
              :min="0"
              :max="100"
              :precision="4"
            /><span v-else>{{ row.paymentRatio }}%</span></template
          ></el-table-column
        >
        <el-table-column :label="i18ns.t('carpool.detail.colQuotaRatio')" min-width="140"
          ><template #default="{ row }"
            ><el-input-number
              v-if="
                order.allocationMode === 'custom' &&
                order.viewerActions?.canAllocate &&
                row.state !== 'left'
              "
              v-model="row.quotaRatio"
              :min="0"
              :max="100"
              :precision="4"
            /><span v-else>{{ row.quotaRatio }}%</span></template
          ></el-table-column
        >
        <el-table-column :label="i18ns.t('carpool.detail.colPayable')"
          ><template #default="{ row }">{{
            formatCarpoolMoney(row.payableAmount)
          }}</template></el-table-column
        >
        <el-table-column :label="i18ns.t('carpool.detail.colQuota')"
          ><template #default="{ row }">{{
            formatCarpoolQuota(row.finalQuota, order.quotaUnit)
          }}</template></el-table-column
        >
        <el-table-column :label="i18ns.t('carpool.detail.colReserved')"
          ><template #default="{ row }">{{
            formatCarpoolMoney(row.reservedAmount)
          }}</template></el-table-column
        >
        <el-table-column :label="i18ns.t('carpool.detail.colConfirmState')"
          ><template #default="{ row }">{{
            formatCarpoolDate(row.confirmedAt)
          }}</template></el-table-column
        >
      </el-table>
      <div
        v-if="order.allocationMode === 'custom' && order.viewerActions?.canAllocate"
        class="ratio-summary"
      >
        <span>{{
          i18ns.t('carpool.detail.ratioTotal', { payment: paymentTotal, quota: quotaTotal })
        }}</span
        ><el-button :disabled="!canSaveAllocation" @click="save">{{
          i18ns.t('carpool.detail.saveRatios')
        }}</el-button>
      </div>
    </el-card>

    <el-card shadow="never"
      ><template #header>{{ i18ns.t('carpool.detail.actionsTitle') }}</template>
      <p v-if="order.viewerActions?.reason" class="muted">{{ order.viewerActions.reason }}</p>
      <div class="actions">
        <el-button v-if="order.viewerActions?.canInvite" @click="inviteDialogVisible = true">{{
          i18ns.t('carpool.detail.copyInvite')
        }}</el-button>
        <el-button v-if="order.viewerActions?.canConfirm" type="success" @click="confirmShare">{{
          i18ns.t('carpool.detail.confirmMine')
        }}</el-button>
        <el-button
          v-if="order.viewerActions?.canLeave"
          type="warning"
          @click="
            runConfirm(
              i18ns.t('carpool.detail.leaveConfirm'),
              () => carpoolService.leave(id),
              i18ns.t('carpool.detail.left'),
            )
          "
          >{{ i18ns.t('carpool.detail.leave') }}</el-button
        >
        <el-button
          v-if="order.viewerActions?.canCancel"
          type="danger"
          @click="
            runConfirm(
              i18ns.t('carpool.detail.cancelConfirm'),
              () => carpoolService.cancel(id),
              i18ns.t('carpool.detail.cancelled'),
            )
          "
          >{{ i18ns.t('carpool.detail.cancel') }}</el-button
        >
        <el-tooltip
          v-if="order.state === 'open'"
          :disabled="Boolean(order.viewerActions?.canSubmit)"
          :content="i18ns.t('carpool.detail.submitBlocked')"
          ><el-button
            v-if="order.viewerActions?.canSubmit || order.viewerActions?.canInvite"
            type="primary"
            :disabled="!order.viewerActions?.canSubmit"
            @click="
              runConfirm(
                i18ns.t('carpool.detail.submitConfirm'),
                () => carpoolService.submit(id),
                i18ns.t('carpool.detail.departed'),
              )
            "
            >{{ i18ns.t('carpool.detail.depart') }}</el-button
          ></el-tooltip
        >
      </div>
      <el-descriptions v-if="order.state === 'fulfilled'" :column="1" border
        ><el-descriptions-item :label="i18ns.t('carpool.detail.sharedChannel')">{{
          order.relayChannelName || i18ns.t('carpool.detail.deliveredSecurely')
        }}</el-descriptions-item
        ><el-descriptions-item :label="i18ns.t('carpool.detail.deliveryAccess')">{{
          i18ns.t('carpool.detail.deliveryAccessHint')
        }}</el-descriptions-item></el-descriptions
      >
    </el-card>
    <el-card shadow="never"
      ><template #header>{{ i18ns.t('carpool.detail.timelineTitle') }}</template
      ><el-timeline
        ><el-timeline-item
          v-for="event in order.events"
          :key="event.id"
          :timestamp="formatCarpoolDate(event.createTime)"
          >{{ carpoolEventLabel(event.type) }}</el-timeline-item
        ></el-timeline
      ></el-card
    >

    <el-dialog
      v-model="inviteDialogVisible"
      :title="i18ns.t('carpool.detail.inviteTitle')"
      width="420px"
      ><p>{{ i18ns.t('carpool.detail.inviteHint') }}</p>
      <el-form-item :label="i18ns.t('carpool.detail.inviteValidity')"
        ><el-select v-model="inviteHours"
          ><el-option :value="1" :label="i18ns.t('carpool.common.hours', { hours: 1 })" /><el-option
            :value="24"
            :label="i18ns.t('carpool.common.hours', { hours: 24 })" /><el-option
            :value="72"
            :label="i18ns.t('carpool.common.hours', { hours: 72 })" /></el-select></el-form-item
      ><template #footer
        ><el-button @click="inviteDialogVisible = false">{{
          i18ns.t('carpool.common.cancel')
        }}</el-button
        ><el-button type="primary" @click="createInvite">{{
          i18ns.t('carpool.detail.copyInvite')
        }}</el-button></template
      ></el-dialog
    >
  </section>
</template>

<style scoped>
.detail-page {
  display: grid;
  gap: 18px;
}
.detail-header,
.card-title,
.allocation-mode,
.ratio-summary,
.actions {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
}
.overview-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.overview-grid p {
  margin: 6px 0 0;
}
.ratio-summary,
.actions {
  margin-top: 16px;
}
.muted,
small {
  color: var(--el-text-color-secondary);
}
small {
  display: block;
}
@media (max-width: 800px) {
  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .detail-header,
  .allocation-mode {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
