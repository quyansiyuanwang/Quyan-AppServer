<template>
  <main class="product-management desktop-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">PRODUCT OPERATIONS</p>
        <h1>{{ productName(product) }} 运营管理</h1>
        <p>查看账号实例、用量、扣费和调用审计。产品访问由 RAM 权限实时控制。</p>
      </div>
      <el-button :icon="Refresh" circle aria-label="刷新" @click="load" />
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false">
      <template #default
        ><el-button link type="primary" @click="load">{{
          t('productFeedback.retry')
        }}</el-button></template
      >
    </el-alert>
    <section class="admin-summary">
      <div>
        <span>账户产品记录</span><strong>{{ accounts.length }}</strong>
      </div>
      <div>
        <span>实例上限合计</span
        ><strong>{{ accounts.reduce((sum, item) => sum + item.instanceLimit, 0) }}</strong>
      </div>
      <div>
        <span>默认实例上限</span><strong>{{ config?.defaultInstanceLimit ?? '-' }}</strong>
      </div>
    </section>
    <section class="management-panel" v-loading="loading">
      <div class="section-title">
        <div>
          <h2>账号产品记录</h2>
          <p>记录只用于实例上限、额度、扣费和审计，不授予或撤销产品权限。</p>
        </div>
      </div>
      <el-table :data="accounts">
        <el-table-column prop="accountOwnerId" label="主账号 ID" min-width="220" />
        <el-table-column label="免费额度" width="130"
          ><template #default="{ row }"
            >{{ row.dailyFreeQuota ?? config?.defaultDailyQuota ?? 0 }} / 日</template
          ></el-table-column
        >
        <el-table-column prop="instanceLimit" label="实例上限" width="110" />
      </el-table>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { DeveloperProductCode, DeveloperProductAccountDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { productName } from './developer-product-ui'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'

const props = defineProps<{ product: DeveloperProductCode }>()
const { t } = i18ns
const product = computed(() => props.product)
const loading = ref(false)
const error = ref('')
const accounts = ref<DeveloperProductAccountDto[]>([])
const config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>()
const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const [nextAccounts, configs] = await Promise.all([
      developerProductService.listAccounts(product.value),
      developerProductService.listConfigs(),
    ])
    accounts.value = nextAccounts
    config.value = configs.find((item) => item.productCode === product.value)
  } catch (cause) {
    error.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}
watch(product, load)
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
.page-header,
.section-title {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}
.page-header {
  margin-bottom: 24px;
}
.page-header h1 {
  font-size: 28px;
  margin: 4px 0 8px;
}
.page-header p,
.section-title p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.eyebrow {
  color: var(--el-color-primary);
  font: 700 12px monospace;
  letter-spacing: 0;
}
.admin-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.admin-summary div {
  padding: 16px 20px;
  border-right: 1px solid var(--el-border-color-light);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.admin-summary div:last-child {
  border: 0;
}
.admin-summary span {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.admin-summary strong {
  font-size: 24px;
}
.management-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 20px;
  margin-top: 16px;
  background: var(--el-bg-color);
}
.section-title {
  margin-bottom: 16px;
}
.form-note {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
@media (max-width: 720px) {
  .product-management {
    padding: 16px;
  }
  .page-header h1 {
    font-size: 22px;
  }
  .admin-summary {
    grid-template-columns: 1fr;
  }
  .admin-summary div {
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-light);
  }
}
</style>
