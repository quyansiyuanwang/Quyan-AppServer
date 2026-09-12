<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
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
  ElMessage.success('比例已更新，成员需重新确认')
  await load()
}
const confirm = async () => {
  await carpoolService.confirm(id.value)
  ElMessage.success('已按个人应付金额冻结余额')
  await load()
}
const invite = async () => {
  const r = await carpoolService.invite(id.value)
  await navigator.clipboard.writeText(
    `${location.origin}/subscriptions/carpools/invite/${r.data.token}`,
  )
  ElMessage.success('邀请链接已复制')
}
const submit = async () => {
  await carpoolService.submit(id.value)
  ElMessage.success('已发车，等待管理员购买上游套餐')
  await load()
}
onMounted(load)
</script>
<template>
  <section class="page" v-loading="loading" v-if="order">
    <div class="heading">
      <h1>{{ order.packageName }}</h1>
      <p>
        状态：{{ order.state }} · 付款比例 {{ order.paymentRatioTotal }}% · 额度比例
        {{ order.quotaRatioTotal }}%
      </p>
    </div>
    <el-alert
      type="info"
      :closable="false"
      title="确认时只冻结你的个人应付金额；比例修改后需要重新确认。"
    /><el-table :data="order.members"
      ><el-table-column prop="username" label="成员" /><el-table-column label="付款比例"
        ><template #default="{ row }"
          ><el-input-number
            v-model="row.paymentRatio"
            :min="0"
            :max="100"
            :disabled="order.state !== 'open'" /></template></el-table-column
      ><el-table-column label="额度比例"
        ><template #default="{ row }"
          ><el-input-number
            v-model="row.quotaRatio"
            :min="0"
            :max="100"
            :disabled="order.state !== 'open'" /></template></el-table-column
      ><el-table-column prop="payableAmount" label="个人应付" /><el-table-column
        prop="reservedAmount"
        label="已冻结" /><el-table-column prop="state" label="确认状态"
    /></el-table>
    <div class="actions" v-if="order.state === 'open'">
      <el-button @click="invite">复制邀请链接</el-button
      ><el-button @click="save">保存比例</el-button
      ><el-button type="success" @click="confirm">确认我的比例</el-button
      ><el-button
        type="primary"
        :disabled="
          !order.allConfirmed || order.paymentRatioTotal !== 100 || order.quotaRatioTotal !== 100
        "
        @click="submit"
        >发车</el-button
      >
    </div>
    <el-descriptions v-if="order.state === 'fulfilled'" title="资源已交付" :column="1"
      ><el-descriptions-item label="共享渠道">{{
        order.relayChannelId
      }}</el-descriptions-item></el-descriptions
    >
  </section>
</template>
