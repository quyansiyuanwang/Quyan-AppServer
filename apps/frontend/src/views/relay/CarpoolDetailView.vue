<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusRuntime'
import { useRoute } from 'vue-router'
import type { CarpoolMemberDto, CarpoolOrderDto } from '@/client/types.gen'
import CarpoolStateTag from '@/components/carpool/CarpoolStateTag.vue'
import CarpoolWorkflow from '@/components/carpool/CarpoolWorkflow.vue'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import {
  carpoolEventLabel,
  carpoolNextStep,
  deadlineText,
  formatCarpoolDate,
  formatCarpoolMoney,
  formatCarpoolQuota,
} from './carpool'

const route = useRoute()
const order = ref<CarpoolOrderDto>()
const loading = ref(false)
const loadFailed = ref(false)
const actionLoading = ref(false)
let loadVersion = 0
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
  const orderId = id.value
  const version = ++loadVersion
  loading.value = true
  loadFailed.value = false
  try {
    const response = await carpoolService.detail(orderId)
    if (version === loadVersion) order.value = response.data as CarpoolOrderDto
  } catch (error) {
    if (version === loadVersion) {
      loadFailed.value = true
      showRequestErrorNotice(error, i18ns.t('carpool.common.loadFailed'))
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}
const runAction = async (action: () => Promise<unknown>, success: string) => {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await action()
    ElMessage.success(success)
    await load()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    actionLoading.value = false
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
  if (!order.value || actionLoading.value) return
  if (mode === 'custom') {
    try {
      await ElMessageBox.confirm(
        i18ns.t('carpool.detail.customModeWarning'),
        i18ns.t('carpool.common.confirmTitle'),
        { type: 'warning' },
      )
      if (order.value) order.value.allocationMode = mode
    } catch (error) {
      if (error !== 'cancel' && error !== 'close')
        showRequestErrorNotice(error, i18ns.t('operationFailed'))
    }
    return
  }
  const orderId = id.value
  await runAction(
    () => carpoolService.allocate(orderId, { allocationMode: 'equal' }),
    i18ns.t('carpool.detail.ratiosUpdated'),
  )
}
const save = async () => {
  if (!canSaveAllocation.value) return ElMessage.warning(i18ns.t('carpool.detail.ratioInvalid'))
  const orderId = id.value
  const payload = allocationPayload()
  await runAction(
    () => carpoolService.allocate(orderId, payload),
    i18ns.t('carpool.detail.ratiosUpdated'),
  )
}
const confirmShare = async () => {
  const orderId = id.value
  await runAction(() => carpoolService.confirm(orderId), i18ns.t('carpool.detail.balanceFrozen'))
}
const createInvite = async () => {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    const result = await carpoolService.invite(id.value, inviteHours.value)
    const token = (result.data as { token: string }).token
    const link = `${location.origin}/subscriptions/carpools/invite/${token}`
    let copied = false
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(link)
      copied = true
    } catch {
      try {
        await ElMessageBox.alert(
          i18ns.t('carpool.detail.inviteCopyFallbackMessage', { link }),
          i18ns.t('carpool.detail.inviteCopyFallbackTitle'),
          { confirmButtonText: i18ns.t('common.confirm') },
        )
      } catch (error) {
        if (error !== 'cancel' && error !== 'close') throw error
      }
    }
    inviteDialogVisible.value = false
    if (copied) ElMessage.success(i18ns.t('carpool.detail.inviteCopied'))
    else ElMessage.warning(i18ns.t('carpool.detail.inviteCopyManual'))
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    actionLoading.value = false
  }
}
const runConfirm = async (title: string, action: () => Promise<unknown>, success: string) => {
  if (actionLoading.value) return
  const orderId = id.value
  try {
    await ElMessageBox.confirm(title, i18ns.t('carpool.common.confirmTitle'), { type: 'warning' })
  } catch (error) {
    if (error !== 'cancel' && error !== 'close')
      showRequestErrorNotice(error, i18ns.t('operationFailed'))
    return
  }
  if (orderId === id.value) await runAction(action, success)
}
const memberLabel = (member: CarpoolMemberDto) =>
  ({
    pending: i18ns.t('carpool.member.pending'),
    confirmed: i18ns.t('carpool.member.confirmed'),
    left: i18ns.t('carpool.member.left'),
    delivered: i18ns.t('carpool.member.delivered'),
  })[member.state] ?? member.state
const orderNextStep = computed(() => (order.value ? carpoolNextStep(order.value) : ''))
watch(
  id,
  () => {
    order.value = undefined
    inviteDialogVisible.value = false
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <section v-loading="loading" class="page detail-page">
    <el-result
      v-if="loadFailed && !order"
      icon="error"
      :title="i18ns.t('carpool.common.loadFailed')"
      ><template #extra
        ><el-button @click="load">{{ i18ns.t('carpool.common.retry') }}</el-button></template
      ></el-result
    >
    <el-skeleton v-else-if="!order" :rows="6" animated />
    <template v-if="order">
      <header class="detail-header">
        <div>
          <h1>{{ order.packageName }}</h1>
          <p>{{ i18ns.t('carpool.detail.orderId', { id: order.id }) }}</p>
        </div>
        <CarpoolStateTag :state="order.state" />
      </header>
      <el-card class="next-action-card" shadow="never"
        ><p class="eyebrow">{{ i18ns.t('carpool.view.nextAction') }}</p>
        <h2>{{ orderNextStep }}</h2>

        <div class="actions" :class="{ 'is-busy': actionLoading }">
          <el-button
            v-if="order.viewerActions?.canInvite"
            :disabled="actionLoading"
            @click="inviteDialogVisible = true"
            >{{ i18ns.t('carpool.detail.copyInvite') }}</el-button
          >
          <el-button
            v-if="order.viewerActions?.canConfirm"
            :loading="actionLoading"
            type="success"
            @click="confirmShare"
            >{{ i18ns.t('carpool.detail.confirmMine') }}</el-button
          >
          <el-button
            v-if="order.viewerActions?.canLeave"
            :disabled="actionLoading"
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
            :disabled="actionLoading"
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
              :disabled="!order.viewerActions?.canSubmit || actionLoading"
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
      </el-card>
      <CarpoolWorkflow :order="order" />
      <el-alert
        v-if="order.failureReason"
        type="error"
        :closable="false"
        :title="i18ns.t('carpool.detail.failureReason', { reason: order.failureReason })"
      />
      <el-card shadow="never">
        <div class="overview-grid">
          <div>
            <strong>{{ i18ns.t('carpool.common.validity') }}</strong>
            <p>{{ i18ns.t('carpool.common.days', { days: order.validityDays }) }}</p>
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
        <el-table class="desktop-members" :data="order.members">
          <el-table-column
            prop="username"
            :label="i18ns.t('carpool.common.colMembers')"
            min-width="130"
            ><template #default="{ row }"
              ><strong>{{ row.username }}</strong
              ><small
                >{{ row.role === 'owner' ? i18ns.t('carpool.member.owner') + ' · ' : ''
                }}{{ memberLabel(row) }}</small
              ></template
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
        <div class="mobile-members">
          <article v-for="member in order.members" :key="member.id" class="member-card">
            <header>
              <strong>{{ member.username }}</strong
              ><span
                >{{ member.role === 'owner' ? i18ns.t('carpool.member.owner') + ' · ' : ''
                }}{{ memberLabel(member) }}</span
              >
            </header>
            <dl>
              <div>
                <dt>{{ i18ns.t('carpool.detail.colPaymentRatio') }}</dt>
                <dd>
                  <el-input-number
                    v-if="
                      order.allocationMode === 'custom' &&
                      order.viewerActions?.canAllocate &&
                      member.state !== 'left'
                    "
                    v-model="member.paymentRatio"
                    :min="0"
                    :max="100"
                    :precision="4"
                    :disabled="actionLoading"
                  /><span v-else>{{ member.paymentRatio }}%</span>
                </dd>
              </div>
              <div>
                <dt>{{ i18ns.t('carpool.detail.colQuotaRatio') }}</dt>
                <dd>
                  <el-input-number
                    v-if="
                      order.allocationMode === 'custom' &&
                      order.viewerActions?.canAllocate &&
                      member.state !== 'left'
                    "
                    v-model="member.quotaRatio"
                    :min="0"
                    :max="100"
                    :precision="4"
                    :disabled="actionLoading"
                  /><span v-else>{{ member.quotaRatio }}%</span>
                </dd>
              </div>
              <div>
                <dt>{{ i18ns.t('carpool.detail.colPayable') }}</dt>
                <dd>{{ formatCarpoolMoney(member.payableAmount) }}</dd>
              </div>
              <div>
                <dt>{{ i18ns.t('carpool.detail.colReserved') }}</dt>
                <dd>{{ formatCarpoolMoney(member.reservedAmount) }}</dd>
              </div>
              <div>
                <dt>{{ i18ns.t('carpool.detail.colQuota') }}</dt>
                <dd>{{ formatCarpoolQuota(member.finalQuota, order.quotaUnit) }}</dd>
              </div>
              <div>
                <dt>{{ i18ns.t('carpool.detail.colConfirmState') }}</dt>
                <dd>{{ formatCarpoolDate(member.confirmedAt) }}</dd>
              </div>
            </dl>
          </article>
        </div>
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

      <el-card v-if="order.state === 'fulfilled'" class="delivery-card" shadow="never">
        <template #header>{{ i18ns.t('carpool.detail.deliveryAccess') }}</template>
        <el-descriptions v-if="order.state === 'fulfilled'" :column="1" border
          ><el-descriptions-item :label="i18ns.t('carpool.detail.sharedChannel')">{{
            order.relayChannelName || i18ns.t('carpool.detail.deliveredSecurely')
          }}</el-descriptions-item
          ><el-descriptions-item :label="i18ns.t('carpool.detail.deliveryAccess')">{{
            i18ns.t('carpool.detail.deliveryAccessHint')
          }}</el-descriptions-item></el-descriptions
        >
        <div class="actions">
          <router-link :to="{ name: 'myMonthlyPasses' }">{{
            i18ns.t('carpool.detail.monthlyPassLink')
          }}</router-link
          ><router-link :to="{ name: 'relayTokenManagement' }">{{
            i18ns.t('carpool.detail.relayTokenLink')
          }}</router-link>
        </div>
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
        width="min(420px, 94vw)"
        ><p>{{ i18ns.t('carpool.detail.inviteHint') }}</p>
        <el-form-item :label="i18ns.t('carpool.detail.inviteValidity')"
          ><el-select v-model="inviteHours"
            ><el-option
              :value="1"
              :label="i18ns.t('carpool.common.hours', { hours: 1 })" /><el-option
              :value="24"
              :label="i18ns.t('carpool.common.hours', { hours: 24 })" /><el-option
              :value="72"
              :label="i18ns.t('carpool.common.hours', { hours: 72 })" /></el-select></el-form-item
        ><template #footer
          ><el-button @click="inviteDialogVisible = false">{{
            i18ns.t('carpool.common.cancel')
          }}</el-button
          ><el-button type="primary" :loading="actionLoading" @click="createInvite">{{
            i18ns.t('carpool.detail.copyInvite')
          }}</el-button></template
        ></el-dialog
      >
    </template>
  </section>
</template>

<style scoped>
.detail-page {
  display: grid;
  gap: 18px;
}
.next-action-card {
  border-left: 4px solid var(--el-color-primary);
  background: linear-gradient(110deg, var(--el-color-primary-light-9), var(--el-bg-color));
}
.next-action-card h2 {
  margin: 6px 0 16px;
  font-size: clamp(22px, 3vw, 30px);
}
.eyebrow {
  margin: 0;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.detail-header p {
  overflow-wrap: anywhere;
}
.mobile-members {
  display: none;
}
.member-card {
  padding: 16px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.member-card header {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  flex-wrap: wrap;
}
.member-card header span,
.member-card dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.member-card dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 0;
}
.member-card dd {
  margin: 4px 0 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.member-card :deep(.el-input-number) {
  width: 100%;
}
.actions,
.ratio-summary {
  flex-wrap: wrap;
}
.actions :deep(.el-button) {
  margin-left: 0;
}
@media (max-width: 640px) {
  .mobile-members {
    display: block;
  }
  .desktop-members {
    display: none;
  }
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
.actions {
  justify-content: flex-start;
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
