<template>
  <main class="product-management desktop-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">PRODUCT DISTRIBUTION</p>
        <h1>{{ productName(product) }} 管理</h1>
        <p>向主账号分发或紧急停用本产品授权。所有实例和 API Key 都会实时受此授权约束。</p>
      </div>
      <el-button :icon="Refresh" circle aria-label="刷新" @click="load" />
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <section class="admin-summary">
      <div>
        <span>已分发账号</span
        ><strong>{{ entitlements.filter((item) => item.enabled).length }}</strong>
      </div>
      <div>
        <span>已停用授权</span
        ><strong>{{ entitlements.filter((item) => !item.enabled).length }}</strong>
      </div>
      <div>
        <span>默认实例上限</span><strong>{{ config?.defaultInstanceLimit ?? '-' }}</strong>
      </div>
    </section>
    <section class="management-panel" v-loading="loading">
      <div class="section-title">
        <div>
          <h2>账号授权</h2>
          <p>首次分发会自动创建不可删除的产品所有者策略，账号拥有者可继续通过 RAM 最小化授权。</p>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreate">分发产品</el-button>
      </div>
      <el-table :data="entitlements">
        <el-table-column prop="accountOwnerId" label="主账号 ID" min-width="220" />
        <el-table-column label="状态" width="100"
          ><template #default="{ row }"
            ><el-tag :type="row.enabled ? 'success' : 'danger'">{{
              row.enabled ? '启用' : '停用'
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column label="免费额度" width="130"
          ><template #default="{ row }"
            >{{ row.dailyFreeQuota ?? config?.defaultDailyQuota ?? 0 }} / 日</template
          ></el-table-column
        >
        <el-table-column prop="instanceLimit" label="实例上限" width="110" />
        <el-table-column label="有效期" min-width="180"
          ><template #default="{ row }">{{
            row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '长期有效'
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="150"
          ><template #default="{ row }"
            ><el-button link @click="openEdit(row)">编辑</el-button
            ><el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">{{
              row.enabled ? '停用' : '启用'
            }}</el-button></template
          ></el-table-column
        >
      </el-table>
    </section>
    <el-dialog v-model="dialog" :title="editing ? '编辑产品授权' : '分发产品'" width="520px">
      <el-form label-position="top">
        <el-form-item label="主账号 ID"
          ><el-input v-model="form.accountOwnerId" :disabled="Boolean(editing)"
        /></el-form-item>
        <el-form-item label="每日免费额度"
          ><el-input-number v-model="form.dailyFreeQuota" :min="0" :max="10000000" /><span
            class="form-note"
            >留空使用产品默认额度</span
          ></el-form-item
        >
        <el-form-item label="实例上限"
          ><el-input-number v-model="form.instanceLimit" :min="1" :max="1000"
        /></el-form-item>
        <el-form-item label="超额扣费"><el-switch v-model="form.overageEnabled" /></el-form-item>
        <el-form-item label="到期时间"
          ><el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            clearable
            style="width: 100%"
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="dialog = false">取消</el-button
        ><el-button type="primary" :loading="submitting" @click="save">保存</el-button></template
      >
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import type { DeveloperProductCode, DeveloperProductEntitlementDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { productName } from './developer-product-ui'

const props = defineProps<{ product: DeveloperProductCode }>()
const product = computed(() => props.product)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const dialog = ref(false)
const editing = ref<DeveloperProductEntitlementDto>()
const entitlements = ref<DeveloperProductEntitlementDto[]>([])
const config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>()
const form = ref({
  accountOwnerId: '',
  dailyFreeQuota: undefined as number | undefined,
  overageEnabled: false,
  instanceLimit: 1,
  expiresAt: undefined as string | undefined,
})
const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const [nextEntitlements, configs] = await Promise.all([
      developerProductService.listEntitlements(product.value),
      developerProductService.listConfigs(),
    ])
    entitlements.value = nextEntitlements
    config.value = configs.find((item) => item.productCode === product.value)
    if (!editing.value) form.value.instanceLimit = config.value?.defaultInstanceLimit ?? 1
  } catch {
    error.value = '产品授权记录暂时无法加载。'
  } finally {
    loading.value = false
  }
}
const openCreate = () => {
  editing.value = undefined
  form.value = {
    accountOwnerId: '',
    dailyFreeQuota: undefined,
    overageEnabled: false,
    instanceLimit: config.value?.defaultInstanceLimit ?? 1,
    expiresAt: undefined,
  }
  dialog.value = true
}
const openEdit = (item: DeveloperProductEntitlementDto) => {
  editing.value = item
  form.value = {
    accountOwnerId: item.accountOwnerId,
    dailyFreeQuota: item.dailyFreeQuota,
    overageEnabled: item.overageEnabled,
    instanceLimit: item.instanceLimit,
    expiresAt: item.expiresAt,
  }
  dialog.value = true
}
const save = async () => {
  submitting.value = true
  try {
    await developerProductService.upsertEntitlement(product.value, {
      ...form.value,
      enabled: editing.value?.enabled ?? true,
    })
    dialog.value = false
    await load()
    ElMessage.success('产品授权已保存')
  } finally {
    submitting.value = false
  }
}
const toggle = async (item: DeveloperProductEntitlementDto) => {
  await developerProductService.upsertEntitlement(product.value, {
    accountOwnerId: item.accountOwnerId,
    enabled: !item.enabled,
    dailyFreeQuota: item.dailyFreeQuota,
    overageEnabled: item.overageEnabled,
    instanceLimit: item.instanceLimit,
    expiresAt: item.expiresAt,
  })
  await load()
  ElMessage.success(item.enabled ? '授权已停用' : '授权已启用')
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
