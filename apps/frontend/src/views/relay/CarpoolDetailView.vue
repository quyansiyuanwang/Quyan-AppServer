<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
const route = useRoute()
const order = ref<any>()
const loading = ref(false)
const id = computed(() => String((route.params as { id: string }).id))
const load = async () => {
  loading.value = true
  try {
    order.value = (await carpoolService.detail(id.value)).data
  } finally {
    loading.value = false
  }
}
const save = async () => {
  await carpoolService.allocate(id.value, {
    members: order.value.members.map((m: any) => ({
      memberId: m.id,
      paymentRatio: Number(m.paymentRatio),
      quotaRatio: Number(m.quotaRatio),
    })),
  })
  ElMessage.success(i18ns.t('carpool.detail.ratiosUpdated'))
  await load()
}
const confirm = async () => {
  await carpoolService.confirm(id.value)
  ElMessage.success(i18ns.t('carpool.detail.balanceFrozen'))
  await load()
}
const invite = async () => {
  const r = await carpoolService.invite(id.value)
  const token = (r.data as { token: string }).token
  await navigator.clipboard.writeText(`${location.origin}/subscriptions/carpools/invite/${token}`)
  ElMessage.success(i18ns.t('carpool.detail.inviteCopied'))
}
const submit = async () => {
  await carpoolService.submit(id.value)
  ElMessage.success(i18ns.t('carpool.detail.departed'))
  await load()
}
onMounted(load)
</script>
<template>
  <section class="page" v-loading="loading" v-if="order">
    <div class="heading">
      <h1>{{ order.packageName }}</h1>
      <p>
        {{
          i18ns.t('carpool.detail.stateLine', {
            state: order.state,
            payment: order.paymentRatioTotal,
            quota: order.quotaRatioTotal,
          })
        }}
      </p>
    </div>
    <el-alert type="info" :closable="false" :title="i18ns.t('carpool.detail.confirmHint')" />
    <el-table :data="order.members">
      <el-table-column prop="username" :label="i18ns.t('carpool.common.colMembers')" />
      <el-table-column :label="i18ns.t('carpool.detail.colPaymentRatio')">
        <template #default="{ row }">
          <el-input-number
            v-model="row.paymentRatio"
            :min="0"
            :max="100"
            :disabled="order.state !== 'open'"
          />
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('carpool.detail.colQuotaRatio')">
        <template #default="{ row }">
          <el-input-number
            v-model="row.quotaRatio"
            :min="0"
            :max="100"
            :disabled="order.state !== 'open'"
          />
        </template>
      </el-table-column>
      <el-table-column prop="payableAmount" :label="i18ns.t('carpool.detail.colPayable')" />
      <el-table-column prop="reservedAmount" :label="i18ns.t('carpool.detail.colReserved')" />
      <el-table-column prop="state" :label="i18ns.t('carpool.detail.colConfirmState')" />
    </el-table>
    <div class="actions" v-if="order.state === 'open'">
      <el-button @click="invite">{{ i18ns.t('carpool.detail.copyInvite') }}</el-button>
      <el-button @click="save">{{ i18ns.t('carpool.detail.saveRatios') }}</el-button>
      <el-button type="success" @click="confirm">
        {{ i18ns.t('carpool.detail.confirmMine') }}
      </el-button>
      <el-button
        type="primary"
        :disabled="
          !order.allConfirmed || order.paymentRatioTotal !== 100 || order.quotaRatioTotal !== 100
        "
        @click="submit"
      >
        {{ i18ns.t('carpool.detail.depart') }}
      </el-button>
    </div>
    <el-descriptions
      v-if="order.state === 'fulfilled'"
      :title="i18ns.t('carpool.detail.delivered')"
      :column="1"
    >
      <el-descriptions-item :label="i18ns.t('carpool.detail.sharedChannel')">
        {{ order.relayChannelId }}
      </el-descriptions-item>
    </el-descriptions>
  </section>
</template>
