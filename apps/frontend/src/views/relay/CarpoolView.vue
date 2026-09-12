<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import type { CarpoolOrderDto, CarpoolPackageTemplateDto } from '@/client/types.gen'
const router = useRouter()
const packages = ref<CarpoolPackageTemplateDto[]>([])
const orders = ref<CarpoolOrderDto[]>([])
const loading = ref(false)
const load = async () => {
  loading.value = true
  try {
    const [p, o] = await Promise.all([carpoolService.published(), carpoolService.mine()])
    packages.value = p.data as CarpoolPackageTemplateDto[]
    orders.value = (o.data as { records: CarpoolOrderDto[] }).records
  } finally {
    loading.value = false
  }
}
const create = async (packageTemplateId: string) => {
  const result = await carpoolService.create({ packageTemplateId })
  const orderId = (result.data as CarpoolOrderDto).id
  ElMessage.success(i18ns.t('carpool.view.created'))
  router.push({ name: 'carpoolDetail', params: { id: orderId } })
}
onMounted(load)
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>{{ i18ns.t('carpool.view.title') }}</h1>
      <p>{{ i18ns.t('carpool.view.subtitle') }}</p>
    </div>
    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="item in packages" :key="item.id" :xs="24" :md="8">
        <el-card>
          <h3>{{ item.name }}</h3>
          <p>{{ item.description }}</p>
          <p>
            {{
              i18ns.t('carpool.view.summary', {
                price: item.salePrice,
                quota: item.snapshotQuota,
                members: item.maxMembers,
              })
            }}
          </p>
          <el-button type="primary" @click="create(item.id)">
            {{ i18ns.t('carpool.view.initiate') }}
          </el-button>
        </el-card>
      </el-col>
    </el-row>
    <h2>{{ i18ns.t('carpool.view.myOrders') }}</h2>
    <el-table :data="orders">
      <el-table-column prop="packageName" :label="i18ns.t('carpool.common.colPackage')" />
      <el-table-column prop="state" :label="i18ns.t('carpool.common.colState')" />
      <el-table-column :label="i18ns.t('carpool.common.colActions')">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            @click="router.push({ name: 'carpoolDetail', params: { id: row.id } })"
          >
            {{ i18ns.t('carpool.view.viewDetail') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>
