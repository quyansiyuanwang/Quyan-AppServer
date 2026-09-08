<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { carpoolService } from '@/service/carpoolService'
const orders = ref<any[]>([])
const channelId = ref('')
const load = async () => {
  orders.value = (await carpoolService.admin()).data.records
}
const accept = async (id: string) => {
  await carpoolService.accept(id)
  ElMessage.success('申请已接受')
  await load()
}
const fulfill = async (id: string) => {
  if (!channelId.value) return ElMessage.warning('请输入 Relay 渠道 ID')
  await carpoolService.fulfill(id, { relayChannelId: channelId.value })
  ElMessage.success('已生成成员令牌和月卡')
  await load()
}
const fail = async (id: string) => {
  await carpoolService.fail(id)
  ElMessage.success('已退款并关闭拼车')
  await load()
}
onMounted(load)
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>拼车申请</h1>
      <p>接受申请后线下购买上游套餐，再绑定已有 Relay 渠道完成交付。</p>
    </div>
    <el-input
      v-model="channelId"
      placeholder="交付时填写 Relay 渠道 ID"
      style="max-width: 360px; margin-bottom: 16px"
    /><el-table :data="orders"
      ><el-table-column prop="packageName" label="套餐" /><el-table-column
        prop="state"
        label="状态"
      /><el-table-column label="成员"
        ><template #default="{ row }"
          >{{ row.members.length }} / {{ row.maxMembers }}</template
        ></el-table-column
      ><el-table-column label="操作"
        ><template #default="{ row }"
          ><el-button v-if="row.state === 'submitted'" type="primary" link @click="accept(row.id)"
            >接受</el-button
          ><el-button v-if="row.state === 'accepted'" type="success" link @click="fulfill(row.id)"
            >完成购买并交付</el-button
          ><el-button
            v-if="['submitted', 'accepted'].includes(row.state)"
            type="danger"
            link
            @click="fail(row.id)"
            >失败退款</el-button
          ></template
        ></el-table-column
      ></el-table
    >
  </section>
</template>
