<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { carpoolService } from '@/service/carpoolService'
const router = useRouter()
const packages = ref<any[]>([])
const orders = ref<any[]>([])
const loading = ref(false)
const load = async () => {
  loading.value = true
  try {
    const [p, o] = await Promise.all([carpoolService.published(), carpoolService.mine()])
    packages.value = p.data
    orders.value = o.data.records
  } finally {
    loading.value = false
  }
}
const create = async (packageTemplateId: string) => {
  const result = await carpoolService.create({ packageTemplateId })
  ElMessage.success('拼车已创建')
  router.push({ name: 'carpoolDetail', params: { id: result.data.id } })
}
onMounted(load)
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>拼车套餐</h1>
      <p>先加入，确认自己分配到的付款比例后，仅冻结个人应付金额。</p>
    </div>
    <el-row :gutter="16" v-loading="loading"
      ><el-col v-for="item in packages" :key="item.id" :xs="24" :md="8"
        ><el-card
          ><h3>{{ item.name }}</h3>
          <p>{{ item.description }}</p>
          <p>
            售价 {{ item.salePrice }} · 总额度 {{ item.snapshotQuota }} · 最多
            {{ item.maxMembers }} 人
          </p>
          <el-button type="primary" @click="create(item.id)">发起拼车</el-button></el-card
        ></el-col
      ></el-row
    >
    <h2>我的拼车</h2>
    <el-table :data="orders"
      ><el-table-column prop="packageName" label="套餐" /><el-table-column
        prop="state"
        label="状态"
      /><el-table-column label="操作"
        ><template #default="{ row }"
          ><el-button
            link
            type="primary"
            @click="router.push({ name: 'carpoolDetail', params: { id: row.id } })"
            >查看</el-button
          ></template
        ></el-table-column
      ></el-table
    >
  </section>
</template>
