<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { useRouter } from 'vue-router'
import type { CarpoolOrderDto, CarpoolPackageTemplateDto } from '@/client/types.gen'
import CarpoolStateTag from '@/components/carpool/CarpoolStateTag.vue'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import {
  carpoolNextStep,
  deadlineText,
  formatCarpoolDate,
  formatCarpoolMoney,
  formatCarpoolQuota,
  carpoolStates,
} from './carpool'

const router = useRouter()
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

const packages = ref<CarpoolPackageTemplateDto[]>([])
const orders = ref<CarpoolOrderDto[]>([])
const packagePage = ref(1)
const orderPage = ref(1)
const packageTotal = ref(0)
const orderTotal = ref(0)
const pageSize = 12
const orderState = ref<string>()
const keyword = ref('')
const loadingPackages = ref(false)
const loadingOrders = ref(false)
const packagesFailed = ref(false)
const ordersFailed = ref(false)
const loadPackages = async () => {
  loadingPackages.value = true
  packagesFailed.value = false
  try {
    const response = await carpoolService.catalog(
      packagePage.value,
      pageSize,
      keyword.value || undefined,
    )
    const data = response.data as { total: number; records: CarpoolPackageTemplateDto[] }
    packages.value = data.records
    packageTotal.value = data.total
  } catch {
    packagesFailed.value = true
  } finally {
    loadingPackages.value = false
  }
}
const loadOrders = async () => {
  loadingOrders.value = true
  ordersFailed.value = false
  try {
    const response = await carpoolService.mine(
      orderPage.value,
      pageSize,
      orderState.value,
      keyword.value || undefined,
    )
    const data = response.data as { total: number; records: CarpoolOrderDto[] }
    orders.value = data.records
    orderTotal.value = data.total
  } catch {
    ordersFailed.value = true
  } finally {
    loadingOrders.value = false
  }
}
const search = async () => {
  packagePage.value = 1
  orderPage.value = 1
  await Promise.all([loadPackages(), loadOrders()])
}
const create = async (packageTemplateId: string) => {
  const result = await carpoolService.create({ packageTemplateId })
  const orderId = (result.data as CarpoolOrderDto).id
  ElMessage.success(i18ns.t('carpool.view.created'))
  await router.push({ name: 'carpoolDetail', params: { id: orderId } })
}
onMounted(() => void search())
</script>

<template>
  <section class="page carpool-page">
    <header class="heading">
      <h1>{{ i18ns.t('carpool.view.title') }}</h1>
      <p>{{ i18ns.t('carpool.view.subtitle') }}</p>
    </header>

    <div class="toolbar">
      <el-input
        v-model="keyword"
        clearable
        :placeholder="i18ns.t('carpool.common.search')"
        @keyup.enter="search"
      />
      <el-button :loading="loadingPackages || loadingOrders" @click="search">{{
        i18ns.t('carpool.common.searchButton')
      }}</el-button>
    </div>

    <h2>{{ i18ns.t('carpool.view.catalog') }}</h2>
    <el-skeleton v-if="loadingPackages" :rows="4" animated />
    <el-result
      v-else-if="packagesFailed"
      icon="error"
      :title="i18ns.t('carpool.common.loadFailed')"
    >
      <template #extra>
        <el-button @click="loadPackages">{{ i18ns.t('carpool.common.retry') }}</el-button>
      </template>
    </el-result>
    <el-empty v-else-if="!packages.length" :description="i18ns.t('carpool.common.emptyPackages')" />
    <el-row v-else :gutter="16">
      <el-col v-for="item in packages" :key="item.id" :xs="24" :sm="12" :lg="8">
        <el-card class="package-card" shadow="hover">
          <template #header
            ><strong>{{ item.name }}</strong></template
          >
          <p class="description">
            {{ item.description || i18ns.t('carpool.common.noDescription') }}
          </p>
          <el-descriptions :column="2" size="small">
            <el-descriptions-item :label="i18ns.t('carpool.common.quota')">{{
              formatCarpoolQuota(item.snapshotQuota, item.snapshotQuotaUnit)
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('carpool.common.validity')">{{
              i18ns.t('carpool.common.days', { days: item.snapshotValidityDays })
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('carpool.common.members')">{{
              i18ns.t('carpool.common.memberLimit', { count: item.maxMembers })
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('carpool.common.deadline')">{{
              i18ns.t('carpool.common.hours', { hours: item.formationDeadlineHours })
            }}</el-descriptions-item>
          </el-descriptions>
          <div class="package-footer">
            <span>{{
              i18ns.t('carpool.view.estimatedSeat', {
                price: formatCarpoolMoney(item.estimatedSeatPrice),
              })
            }}</span>
            <el-button type="primary" @click="create(item.id)">{{
              i18ns.t('carpool.view.initiate')
            }}</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-pagination
      v-if="packageTotal > pageSize"
      v-model:current-page="packagePage"
      :page-size="pageSize"
      layout="prev, pager, next"
      :total="packageTotal"
      @current-change="loadPackages"
    />

    <div class="order-heading">
      <h2>{{ i18ns.t('carpool.view.myOrders') }}</h2>
      <el-select
        v-model="orderState"
        clearable
        :placeholder="i18ns.t('carpool.common.allStates')"
        @change="search"
      >
        <el-option
          v-for="state in carpoolStates"
          :key="state"
          :label="stateLabel(state)"
          :value="state"
        />
      </el-select>
    </div>
    <el-skeleton v-if="loadingOrders" :rows="5" animated />
    <el-result v-else-if="ordersFailed" icon="error" :title="i18ns.t('carpool.common.loadFailed')">
      <template #extra>
        <el-button @click="loadOrders">{{ i18ns.t('carpool.common.retry') }}</el-button>
      </template>
    </el-result>
    <el-empty v-else-if="!orders.length" :description="i18ns.t('carpool.common.emptyOrders')" />
    <el-table
      v-else
      :data="orders"
      @row-click="
        (row: CarpoolOrderDto) => router.push({ name: 'carpoolDetail', params: { id: row.id } })
      "
    >
      <el-table-column
        prop="packageName"
        :label="i18ns.t('carpool.common.colPackage')"
        min-width="160"
      />
      <el-table-column :label="i18ns.t('carpool.common.progress')" min-width="160"
        ><template #default="{ row }"
          ><el-progress
            :percentage="Math.round((row.activeMemberCount / row.maxMembers) * 100)"
            :format="() => `${row.activeMemberCount}/${row.maxMembers}`" /></template
      ></el-table-column>
      <el-table-column :label="i18ns.t('carpool.common.colState')" width="110"
        ><template #default="{ row }"><CarpoolStateTag :state="row.state" /></template
      ></el-table-column>
      <el-table-column :label="i18ns.t('carpool.common.deadline')" min-width="155"
        ><template #default="{ row }"
          ><span>{{ deadlineText(row.formationDeadlineAt) }}</span
          ><small>{{ formatCarpoolDate(row.formationDeadlineAt) }}</small></template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('carpool.common.nextStep')" min-width="150"
        ><template #default="{ row }">{{ carpoolNextStep(row) }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('carpool.common.colActions')" width="100"
        ><template #default="{ row }"
          ><el-button
            type="primary"
            link
            @click.stop="router.push({ name: 'carpoolDetail', params: { id: row.id } })"
            >{{ i18ns.t('carpool.view.continue') }}</el-button
          ></template
        ></el-table-column
      >
    </el-table>
    <el-pagination
      v-if="orderTotal > pageSize"
      v-model:current-page="orderPage"
      :page-size="pageSize"
      layout="prev, pager, next"
      :total="orderTotal"
      @current-change="loadOrders"
    />
  </section>
</template>

<style scoped>
.carpool-page {
  display: grid;
  gap: 18px;
}
.toolbar,
.order-heading,
.package-footer {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.toolbar {
  max-width: 560px;
}
.package-card {
  height: 100%;
  margin-bottom: 16px;
}
.description {
  min-height: 40px;
  color: var(--el-text-color-secondary);
}
.package-footer {
  margin-top: 18px;
  font-weight: 600;
}
small {
  display: block;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
@media (max-width: 640px) {
  .toolbar,
  .order-heading,
  .package-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
