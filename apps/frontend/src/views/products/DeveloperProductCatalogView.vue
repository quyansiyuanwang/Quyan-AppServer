<template>
  <main class="product-catalog desktop-page">
    <header class="catalog-header">
      <div>
        <p class="eyebrow">Developer platform</p>
        <h1>产品目录</h1>
        <p>每项服务拥有独立实例、API Key、RAM 授权和调用配额。</p>
      </div>
      <el-button :icon="Refresh" circle aria-label="刷新产品目录" @click="load" />
    </header>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <section v-loading="loading" class="catalog-grid">
      <article v-for="product in products" :key="product.code" class="product-card">
        <div class="product-card__top">
          <div>
            <p class="product-code">{{ product.code }}</p>
            <h2>{{ productName(product.code) }}</h2>
          </div>
          <el-tag :type="productState(product.code).type">
            {{ productState(product.code).label }}
          </el-tag>
        </div>
        <p>{{ PRODUCT_COPY[product.code].description }}</p>
        <dl>
          <div>
            <dt>API</dt>
            <dd>{{ product.supportsExternalApi ? product.apiPath : '管理型服务' }}</dd>
          </div>
          <div>
            <dt>额度</dt>
            <dd>
              {{ product.config?.defaultDailyQuota ?? 0 }}
              / 日
            </dd>
          </div>
        </dl>
        <div class="card-actions">
          <el-button
            type="primary"
            plain
            :disabled="!hasProductAccess(product.code)"
            @click="router.push({ name: userRoute(product.code) } as any)"
            >进入产品</el-button
          >
          <el-dropdown v-if="canManage || canConfigure" trigger="click">
            <el-button :icon="MoreFilled" circle aria-label="产品管理操作" />
            <template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item
                  v-if="canManage"
                  @click="router.push({ name: managementRoute(product.code) } as any)"
                  >运营管理</el-dropdown-item
                ><el-dropdown-item
                  v-if="canConfigure"
                  @click="router.push({ name: configRoute(product.code) } as any)"
                  >产品配置</el-dropdown-item
                ></el-dropdown-menu
              ></template
            >
          </el-dropdown>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MoreFilled, Refresh } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import type { DeveloperProductCode } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { DEVELOPER_PRODUCT_NAVIGATION } from '@/constant/developer-product-navigation'
import {
  PRODUCT_COPY,
  configRoute,
  managementRoute,
  productName,
  userRoute,
} from './developer-product-ui'

const router = useRouter()
const permissionStore = usePermissionStore()
const canManage = computed(() =>
  permissionStore.hasPermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE),
)
const canConfigure = computed(() =>
  permissionStore.hasPermission(Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE),
)
const loading = ref(false)
const error = ref('')
const products = ref<Awaited<ReturnType<typeof developerProductService.catalog>>>([])
const hasProductAccess = (productCode: DeveloperProductCode) => {
  const definition = DEVELOPER_PRODUCT_NAVIGATION.find((item) => item.code === productCode)
  return definition ? permissionStore.hasAnyPermission(...definition.permissions) : false
}
const productState = (productCode: DeveloperProductCode) => {
  const product = products.value.find((item) => item.code === productCode)
  if (!hasProductAccess(productCode)) return { type: 'info' as const, label: '无权限' }
  if (!product?.config?.enabled) return { type: 'warning' as const, label: '服务停用' }
  return { type: 'success' as const, label: '可访问' }
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    products.value = await developerProductService.catalog()
  } catch {
    error.value = '产品目录暂时无法加载，请刷新后重试。'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped lang="scss">
.product-catalog {
  width: 100%;
  min-width: 0;
  min-height: 100%;
  box-sizing: border-box;
  padding: 28px;
}
.catalog-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: start;
  margin-bottom: 24px;
}
.catalog-header h1 {
  margin: 4px 0 8px;
  font-size: 28px;
}
.catalog-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.eyebrow,
.product-code {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(275px, 1fr));
  gap: 16px;
  min-height: 260px;
}
.product-card {
  border: 1px solid var(--el-border-color-light);
  border-top: 3px solid var(--el-color-primary);
  border-radius: 6px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--el-bg-color);
}
.card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.product-card__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.product-card h2 {
  margin: 2px 0 0;
  font-size: 18px;
}
.product-card p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
dl {
  margin: 0;
  display: grid;
  gap: 7px;
}
dl div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .product-catalog {
    padding: 16px;
  }
  .catalog-header {
    align-items: center;
  }
  .catalog-header h1 {
    font-size: 22px;
  }
}
</style>
