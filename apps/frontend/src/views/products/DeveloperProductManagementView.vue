<template>
  <main class="product-management desktop-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">PRODUCT OPERATIONS</p>
        <h1>{{ productName(product) }} {{ t('productOperations.titleSuffix') }}</h1>
        <p>{{ t('productOperations.description') }}</p>
      </div>
      <el-button
        :icon="Refresh"
        circle
        :aria-label="t('productConsole.refresh')"
        :loading="loading"
        @click="load"
      />
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"
      ><template #default
        ><el-button link type="primary" @click="load">{{
          t('productFeedback.retry')
        }}</el-button></template
      ></el-alert
    >

    <section class="management-panel" v-loading="loading">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          clearable
          :placeholder="t('productOperations.searchPlaceholder')"
          @keyup.enter="search"
          ><template #append><el-button :icon="Search" @click="search" /></template
        ></el-input>
      </div>
      <el-table :data="accounts">
        <el-table-column :label="t('productOperations.user')" min-width="220"
          ><template #default="{ row }"
            ><div class="user-cell">
              <strong>{{ row.displayName || row.username }}</strong
              ><span v-if="row.displayName">{{ row.username }}</span>
            </div></template
          ></el-table-column
        >
        <el-table-column
          :label="t('productOperations.userId')"
          min-width="180"
          show-overflow-tooltip
          ><template #default="{ row }"
            ><code>{{ row.userId }}</code></template
          ></el-table-column
        >
        <el-table-column :label="t('productOperations.quota')" width="160"
          ><template #default="{ row }">{{
            row.account?.dailyFreeQuota ?? t('productOperations.useDefaultQuota')
          }}</template></el-table-column
        >
        <el-table-column :label="t('productResources.overage')" width="130"
          ><template #default="{ row }"
            ><el-tag :type="row.account?.overageEnabled ? 'success' : 'info'">{{
              row.account?.overageEnabled
                ? t('productResources.enabledOverage')
                : t('productResources.disabledOverage')
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column :label="t('productOperations.instanceLimit')" width="120"
          ><template #default="{ row }">{{
            row.account?.instanceLimit ?? config?.defaultInstanceLimit ?? '-'
          }}</template></el-table-column
        >
        <el-table-column :label="t('productConsole.actions')" width="120" fixed="right"
          ><template #default="{ row }"
            ><el-button link type="primary" @click="openUser(row)">{{
              t('productOperations.manageUser')
            }}</el-button></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        v-if="total > pageSize"
        class="pagination"
        background
        layout="prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="changePage"
      />
    </section>

    <el-drawer
      v-model="drawerOpen"
      direction="rtl"
      size="min(720px, 100%)"
      :title="
        selected
          ? `${selected.displayName || selected.username}`
          : t('productOperations.manageUser')
      "
      destroy-on-close
      @closed="clearSelected"
    >
      <template v-if="selected">
        <section class="drawer-section identity">
          <strong>{{ selected.username }}</strong
          ><code>{{ selected.userId }}</code>
        </section>
        <section class="drawer-section" v-loading="detailLoading">
          <h2>{{ t('productOperations.accountSettings') }}</h2>
          <el-alert v-if="detailError" type="error" :title="detailError" :closable="false"
            ><template #default
              ><el-button link @click="loadDetails">{{
                t('productFeedback.retry')
              }}</el-button></template
            ></el-alert
          >
          <el-form label-position="top">
            <el-form-item :label="t('productOperations.quota')"
              ><el-checkbox v-model="useDefaultQuota">{{
                t('productOperations.useDefaultQuota')
              }}</el-checkbox
              ><el-input-number
                v-model="form.dailyFreeQuota"
                :min="0"
                :max="10000000"
                :disabled="useDefaultQuota"
            /></el-form-item>
            <el-form-item :label="t('productResources.overage')"
              ><el-switch
                v-model="form.overageEnabled"
                :active-text="t('productOperations.overageEnabled')"
            /></el-form-item>
            <el-form-item :label="t('productOperations.instanceLimit')"
              ><el-input-number v-model="form.instanceLimit" :min="1" :max="1000"
            /></el-form-item>
          </el-form>
          <el-button type="primary" :loading="saving" @click="save">{{ t('save') }}</el-button>
        </section>
        <section v-if="selected.account" class="drawer-section">
          <h2>{{ t('productOperations.instances') }}</h2>
          <el-table :data="instances" size="small"
            ><el-table-column
              prop="name"
              :label="t('productConsole.instanceName')"
              min-width="140"
            /><el-table-column
              prop="slug"
              :label="t('productConsole.instanceSlug')"
              min-width="140"
            /><el-table-column :label="t('productConsole.status')" width="100"
              ><template #default="{ row }"
                ><el-tag :type="row.enabled ? 'success' : 'info'">{{
                  row.enabled ? t('productConsole.enabled') : t('productConsole.disabled')
                }}</el-tag></template
              ></el-table-column
            ></el-table
          >
          <el-empty
            v-if="!instances.length && !detailLoading"
            :description="t('productConsole.emptyInstances')"
            :image-size="60"
          />
        </section>
        <section v-if="selected.account" class="drawer-section">
          <h2>{{ t('productOperations.usage') }}</h2>
          <div v-if="usage" class="usage">
            <div>
              <span>{{ t('productResources.todayRequests') }}</span
              ><strong>{{ usage.requestCount }}</strong>
            </div>
            <div>
              <span>{{ t('productResources.remainingQuota') }}</span
              ><strong>{{ usage.remainingFree }}</strong>
            </div>
          </div>
        </section>
        <section v-if="selected.account" class="drawer-section">
          <h2>{{ t('productOperations.audit') }}</h2>
          <el-table :data="logs" size="small"
            ><el-table-column
              prop="action"
              :label="t('productResources.actions')"
              min-width="140"
            /><el-table-column :label="t('productResources.result')" width="90"
              ><template #default="{ row }"
                ><el-tag :type="row.success ? 'success' : 'danger'">{{
                  row.success ? t('productResources.success') : t('productResources.failed')
                }}</el-tag></template
              ></el-table-column
            ><el-table-column :label="t('productResources.time')" min-width="160"
              ><template #default="{ row }">{{
                new Date(row.createTime).toLocaleString()
              }}</template></el-table-column
            ></el-table
          >
          <el-empty
            v-if="!logs.length && !detailLoading"
            :description="t('productResources.auditEmpty')"
            :image-size="60"
          />
        </section>
      </template>
    </el-drawer>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import type {
  DeveloperProductCallLogDto,
  DeveloperProductCode,
  DeveloperProductInstanceDto,
  DeveloperProductManagedAccountDto,
  DeveloperProductUsageDto,
} from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { productName } from './developer-product-ui'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'

const props = defineProps<{ product: DeveloperProductCode }>()
const { t } = i18ns
const product = computed(() => props.product)
const loading = ref(false)
const saving = ref(false)
const detailLoading = ref(false)
const error = ref('')
const detailError = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = 20
const total = ref(0)
const accounts = ref<DeveloperProductManagedAccountDto[]>([])
const selected = ref<DeveloperProductManagedAccountDto>()
const drawerOpen = ref(false)
const config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>()
const instances = ref<DeveloperProductInstanceDto[]>([])
const usage = ref<DeveloperProductUsageDto>()
const logs = ref<DeveloperProductCallLogDto[]>([])
const useDefaultQuota = ref(true)
const form = ref({ dailyFreeQuota: 0, overageEnabled: false, instanceLimit: 1 })
let loadSequence = 0
let detailSequence = 0

const applySelectedForm = () => {
  const account = selected.value?.account
  useDefaultQuota.value = account?.dailyFreeQuota === undefined
  form.value = {
    dailyFreeQuota: account?.dailyFreeQuota ?? config.value?.defaultDailyQuota ?? 0,
    overageEnabled: account?.overageEnabled ?? false,
    instanceLimit: account?.instanceLimit ?? config.value?.defaultInstanceLimit ?? 1,
  }
}
const load = async () => {
  const current = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const [result, configs] = await Promise.all([
      developerProductService.listManagedAccounts(product.value, {
        page: page.value,
        pageSize,
        keyword: keyword.value || undefined,
      }),
      developerProductService.listConfigs(),
    ])
    if (current !== loadSequence) return
    accounts.value = result.records
    total.value = result.total
    config.value = configs.find((item) => item.productCode === product.value)
    if (selected.value)
      selected.value = accounts.value.find((item) => item.userId === selected.value?.userId)
  } catch (cause) {
    if (current === loadSequence) {
      error.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
      ElMessage.error(error.value)
    }
  } finally {
    if (current === loadSequence) loading.value = false
  }
}
const loadDetails = async () => {
  if (!selected.value) return
  applySelectedForm()
  if (!selected.value.account) {
    instances.value = []
    usage.value = undefined
    logs.value = []
    return
  }
  const userId = selected.value.userId
  const current = ++detailSequence
  detailLoading.value = true
  detailError.value = ''
  try {
    const [nextInstances, nextUsage, nextLogs] = await Promise.all([
      developerProductService.listManagedInstances(product.value, userId),
      developerProductService.getManagedUsage(product.value, userId),
      developerProductService.listManagedCallLogs(product.value, userId),
    ])
    if (current !== detailSequence || selected.value?.userId !== userId) return
    instances.value = nextInstances
    usage.value = nextUsage
    logs.value = nextLogs
  } catch (cause) {
    if (current === detailSequence) {
      detailError.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
      ElMessage.error(detailError.value)
    }
  } finally {
    if (current === detailSequence) detailLoading.value = false
  }
}
const openUser = (row: DeveloperProductManagedAccountDto) => {
  selected.value = row
  drawerOpen.value = true
  void loadDetails()
}
const clearSelected = () => {
  selected.value = undefined
  instances.value = []
  usage.value = undefined
  logs.value = []
  detailError.value = ''
  detailSequence += 1
}
const save = async () => {
  if (!selected.value || saving.value) return
  saving.value = true
  try {
    const updated = await developerProductService.updateManagedAccount(
      product.value,
      selected.value.userId,
      {
        dailyFreeQuota: useDefaultQuota.value ? null : form.value.dailyFreeQuota,
        overageEnabled: form.value.overageEnabled,
        instanceLimit: form.value.instanceLimit,
      },
    )
    selected.value = updated
    const index = accounts.value.findIndex((item) => item.userId === updated.userId)
    if (index >= 0) accounts.value.splice(index, 1, updated)
    await loadDetails()
    ElMessage.success(t('productOperations.saveSuccess'))
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    saving.value = false
  }
}
const search = () => {
  page.value = 1
  void load()
}
const changePage = (value: number) => {
  page.value = value
  void load()
}
watch(product, () => {
  page.value = 1
  clearSelected()
  void load()
})
onMounted(load)
</script>

<style scoped lang="scss">
.product-management {
  width: 100%;
  min-width: 0;
  min-height: 100%;
  box-sizing: border-box;
  padding: 28px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 24px;
}
.page-header h1 {
  font-size: 28px;
  margin: 4px 0 8px;
}
.page-header p,
.toolbar,
.user-cell span {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.eyebrow {
  color: var(--el-color-primary);
  font: 700 12px monospace;
  letter-spacing: 0;
}
.management-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 20px;
  background: var(--el-bg-color);
}
.toolbar {
  max-width: 420px;
  margin-bottom: 16px;
}
.pagination {
  justify-content: flex-end;
  margin-top: 16px;
}
.user-cell {
  display: grid;
  gap: 3px;
}
.drawer-section {
  padding: 0 0 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.drawer-section h2 {
  margin: 0 0 16px;
  font-size: 17px;
}
.drawer-section:last-child {
  border-bottom: 0;
}
.identity {
  display: grid;
  gap: 5px;
}
.identity code,
.user-cell span {
  font-size: 12px;
}
.usage {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--el-border-color-light);
}
.usage div {
  display: grid;
  gap: 5px;
  padding: 14px;
}
.usage span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.usage strong {
  font-size: 20px;
}
@media (max-width: 720px) {
  .product-management {
    padding: 16px;
  }
  .page-header {
    flex-direction: column;
  }
  .page-header h1 {
    font-size: 22px;
  }
}
</style>
