<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import type { CarpoolOrderDto } from '@/client/types.gen'
const orders = ref<CarpoolOrderDto[]>([])
const channelId = ref('')
const load = async () => {
  orders.value = ((await carpoolService.admin()).data as { records: CarpoolOrderDto[] }).records
}
const accept = async (id: string) => {
  await carpoolService.accept(id)
  ElMessage.success(i18ns.t('carpool.manage.accepted'))
  await load()
}
const fulfill = async (id: string) => {
  if (!channelId.value) return ElMessage.warning(i18ns.t('carpool.manage.channelRequired'))
  await carpoolService.fulfill(id, { relayChannelId: channelId.value })
  ElMessage.success(i18ns.t('carpool.manage.delivered'))
  await load()
}
const fail = async (id: string) => {
  await carpoolService.fail(id)
  ElMessage.success(i18ns.t('carpool.manage.refunded'))
  await load()
}
onMounted(load)
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>{{ i18ns.t('carpool.manage.title') }}</h1>
      <p>{{ i18ns.t('carpool.manage.subtitle') }}</p>
    </div>
    <el-input
      v-model="channelId"
      :placeholder="i18ns.t('carpool.manage.channelPlaceholder')"
      style="max-width: 360px; margin-bottom: 16px"
    />
    <el-table :data="orders">
      <el-table-column prop="packageName" :label="i18ns.t('carpool.common.colPackage')" />
      <el-table-column prop="state" :label="i18ns.t('carpool.common.colState')" />
      <el-table-column :label="i18ns.t('carpool.common.colMembers')">
        <template #default="{ row }">{{ row.members.length }} / {{ row.maxMembers }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('carpool.common.colActions')">
        <template #default="{ row }">
          <el-button v-if="row.state === 'submitted'" type="primary" link @click="accept(row.id)">
            {{ i18ns.t('carpool.manage.accept') }}
          </el-button>
          <el-button v-if="row.state === 'accepted'" type="success" link @click="fulfill(row.id)">
            {{ i18ns.t('carpool.manage.fulfill') }}
          </el-button>
          <el-button
            v-if="['submitted', 'accepted'].includes(row.state)"
            type="danger"
            link
            @click="fail(row.id)"
          >
            {{ i18ns.t('carpool.manage.fail') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>
