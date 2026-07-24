<template>
  <main class="developer-product desktop-page">
    <header class="product-header">
      <div>
        <p class="eyebrow">{{ product }}</p>
        <h1>{{ productName(product) }}</h1>
        <p>{{ PRODUCT_COPY[product].description }}</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" circle aria-label="刷新" @click="load" />
        <el-button
          type="primary"
          :icon="Plus"
          :disabled="!entitlement?.enabled"
          @click="instanceDialog = true"
          >新建实例</el-button
        >
      </div>
    </header>

    <el-alert
      v-if="!entitlement?.enabled"
      title="该产品尚未分发给当前账号，请联系管理员开通。"
      type="info"
      show-icon
      :closable="false"
    />
    <el-alert v-else-if="error" :title="error" type="error" show-icon :closable="false" />

    <section v-loading="loading" class="product-grid">
      <article class="product-panel product-overview">
        <h2>产品授权</h2>
        <dl>
          <div>
            <dt>实例上限</dt>
            <dd>{{ instances.length }} / {{ entitlement?.instanceLimit ?? 0 }}</dd>
          </div>
          <div>
            <dt>每日免费额度</dt>
            <dd>{{ entitlement?.dailyFreeQuota ?? config?.defaultDailyQuota ?? 0 }}</dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>
              {{
                entitlement?.expiresAt
                  ? new Date(entitlement.expiresAt).toLocaleDateString()
                  : '长期有效'
              }}
            </dd>
          </div>
        </dl>
        <el-divider />
        <h3>RAM 授权</h3>
        <p class="hint">
          先在 RAM 为成员授予本产品权限，再创建绑定该主体的 API Key。实时权限变更会立即影响已有
          Key。
        </p>
        <div class="permission-template">
          <code v-for="action in PRODUCT_COPY[product].actions" :key="action">{{ action }}</code>
        </div>
        <el-button plain @click="openRam">配置 RAM 权限</el-button>
      </article>

      <article class="product-panel product-api">
        <h2>调用入口</h2>
        <template v-if="config && externalPath">
          <p>使用实例 API Key，通过 <code>Authorization: Bearer dpk_...</code> 调用。</p>
          <code class="endpoint">{{ externalPath }}</code>
        </template>
        <p v-else>该产品通过管理 API 和公开入口提供服务。创建实例后可管理相关资源。</p>
        <el-divider />
        <h3>独立管理</h3>
        <p class="hint">每个实例的资源、Key 和调用数据彼此隔离，额度在产品授权维度汇总。</p>
      </article>
    </section>

    <section class="product-panel instances-panel" v-loading="loading">
      <div class="section-title">
        <div>
          <h2>实例</h2>
          <p>选择实例后管理绑定的产品 API Key。</p>
        </div>
      </div>
      <el-empty v-if="!instances.length && !loading" description="暂无实例" />
      <el-table v-else :data="instances" highlight-current-row @current-change="selectInstance">
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="slug" label="标识" min-width="160"
          ><template #default="{ row }"
            ><code>{{ row.slug }}</code></template
          ></el-table-column
        >
        <el-table-column label="状态" width="100"
          ><template #default="{ row }"
            ><el-tag :type="row.enabled ? 'success' : 'info'">{{
              row.enabled ? '启用' : '停用'
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column label="创建时间" min-width="170"
          ><template #default="{ row }">{{
            new Date(row.createTime).toLocaleString()
          }}</template></el-table-column
        >
      </el-table>
    </section>

    <section v-if="selectedInstance" class="product-panel keys-panel" v-loading="keysLoading">
      <div class="section-title">
        <div>
          <h2>{{ selectedInstance.name }} 的 API Key</h2>
          <p>明文只会在创建时展示一次。</p>
        </div>
        <el-button type="primary" :icon="Key" @click="keyDialog = true">创建 Key</el-button>
      </div>
      <el-table :data="keys">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="keyPrefix" label="前缀" min-width="130"
          ><template #default="{ row }"
            ><code>{{ row.keyPrefix }}...</code></template
          ></el-table-column
        >
        <el-table-column label="RAM 主体" min-width="160"
          ><template #default="{ row }">{{
            subjectLabel(row.subjectUserId)
          }}</template></el-table-column
        >
        <el-table-column label="动作" min-width="220"
          ><template #default="{ row }"
            ><el-tag v-for="action in row.actions" :key="action" size="small" class="action-tag">{{
              action
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column label="操作" width="100"
          ><template #default="{ row }"
            ><el-button link type="danger" @click="revokeKey(row.id)">撤销</el-button></template
          ></el-table-column
        >
      </el-table>
    </section>
    <DeveloperProductResourcePanel :product="product" :instance="selectedInstance" />

    <el-dialog v-model="instanceDialog" title="新建产品实例" width="440px">
      <el-form label-position="top"
        ><el-form-item label="实例名称"><el-input v-model="instanceForm.name" /></el-form-item
        ><el-form-item label="实例标识"
          ><el-input v-model="instanceForm.slug" placeholder="lowercase-slug" /></el-form-item
      ></el-form>
      <template #footer
        ><el-button @click="instanceDialog = false">取消</el-button
        ><el-button type="primary" :loading="submitting" @click="createInstance"
          >创建</el-button
        ></template
      >
    </el-dialog>
    <el-dialog v-model="keyDialog" title="创建产品 API Key" width="520px">
      <el-form label-position="top"
        ><el-form-item label="名称"><el-input v-model="keyForm.name" /></el-form-item
        ><el-form-item label="绑定 RAM 主体"
          ><el-select v-model="keyForm.subjectUserId" filterable style="width: 100%"
            ><el-option
              v-for="user in subjects"
              :key="user.id"
              :value="user.id"
              :label="userLabel(user)" /></el-select></el-form-item
        ><el-form-item label="允许动作"
          ><el-checkbox-group v-model="keyForm.actions"
            ><el-checkbox
              v-for="action in PRODUCT_COPY[product].actions"
              :key="action"
              :value="action"
              >{{ action }}</el-checkbox
            ></el-checkbox-group
          ></el-form-item
        ></el-form
      >
      <template #footer
        ><el-button @click="keyDialog = false">取消</el-button
        ><el-button type="primary" :loading="submitting" @click="createKey"
          >创建</el-button
        ></template
      >
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Plus, Refresh } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import type {
  DeveloperProductCode,
  DeveloperProductInstanceDto,
  DeveloperProductSubjectDto,
} from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { PRODUCT_COPY, productName } from './developer-product-ui'
import DeveloperProductResourcePanel from './DeveloperProductResourcePanel.vue'

const props = defineProps<{ product: DeveloperProductCode }>()
const product = computed(() => props.product)
const router = useRouter()
const loading = ref(false)
const keysLoading = ref(false)
const submitting = ref(false)
const error = ref('')
const entitlement =
  ref<Awaited<ReturnType<typeof developerProductService.listOwnEntitlements>>[number]>()
const config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>()
const instances = ref<DeveloperProductInstanceDto[]>([])
const selectedInstance = ref<DeveloperProductInstanceDto>()
const keys = ref<Awaited<ReturnType<typeof developerProductService.listKeys>>>([])
const subjects = ref<DeveloperProductSubjectDto[]>([])
const instanceDialog = ref(false)
const keyDialog = ref(false)
const instanceForm = ref({ name: '', slug: '' })
const keyForm = ref({ name: '', subjectUserId: '', actions: [] as string[] })
const externalPaths: Partial<Record<DeveloperProductCode, string>> = {
  kv: 'GET | POST | DELETE /v1/products/kv/entries',
  verification: 'POST /v1/products/verification/send | verify',
  ip_geolocation: 'GET /v1/products/ip-geolocation/{ip}',
  push: 'POST /v1/products/push/send',
}
const externalPath = computed(() => externalPaths[product.value])
const userLabel = (user: DeveloperProductSubjectDto) => user.displayName || user.username
const subjectLabel = (id: string) =>
  subjects.value.find((user) => user.id === id)
    ? userLabel(subjects.value.find((user) => user.id === id)!)
    : id

const loadKeys = async () => {
  if (!selectedInstance.value) return
  keysLoading.value = true
  try {
    keys.value = await developerProductService.listKeys(product.value, selectedInstance.value.id)
  } finally {
    keysLoading.value = false
  }
}
const selectInstance = (instance?: DeveloperProductInstanceDto) => {
  selectedInstance.value = instance
  void loadKeys()
}
const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const [entitlements, configs, nextInstances, nextSubjects] = await Promise.all([
      developerProductService.listOwnEntitlements(),
      developerProductService.catalog(),
      developerProductService.listInstances(product.value),
      developerProductService.listSubjects(product.value),
    ])
    entitlement.value = entitlements.find((item) => item.productCode === product.value)
    config.value = configs.find((item) => item.code === product.value)?.config
    instances.value = nextInstances
    subjects.value = nextSubjects
    selectedInstance.value =
      nextInstances.find((item) => item.id === selectedInstance.value?.id) || nextInstances[0]
    await loadKeys()
  } catch {
    error.value = '产品数据暂时无法加载，请刷新后重试。'
  } finally {
    loading.value = false
  }
}
const createInstance = async () => {
  submitting.value = true
  try {
    const instance = await developerProductService.createInstance(product.value, instanceForm.value)
    instances.value.unshift(instance)
    selectedInstance.value = instance
    instanceForm.value = { name: '', slug: '' }
    instanceDialog.value = false
    ElMessage.success('实例已创建')
  } finally {
    submitting.value = false
  }
}
const createKey = async () => {
  if (!selectedInstance.value) return
  submitting.value = true
  try {
    const result = await developerProductService.createKey(
      product.value,
      selectedInstance.value.id,
      keyForm.value,
    )
    keyDialog.value = false
    keyForm.value = { name: '', subjectUserId: '', actions: [] }
    await loadKeys()
    await ElMessageBox.alert(result.key || '', '请立即保存 API Key', {
      confirmButtonText: '我已保存',
    })
  } finally {
    submitting.value = false
  }
}
const revokeKey = async (keyId: string) => {
  if (!selectedInstance.value) return
  await ElMessageBox.confirm('撤销后该 Key 不能恢复。', '撤销 API Key', { type: 'warning' })
  await developerProductService.revokeKey(product.value, selectedInstance.value.id, keyId)
  await loadKeys()
  ElMessage.success('API Key 已撤销')
}
const openRam = () => router.push({ name: 'ramManagement', query: { product: product.value } })
watch(product, load)
onMounted(load)
</script>

<style scoped lang="scss">
.developer-product {
  max-width: 1440px;
  margin: 0 auto;
  padding: 28px;
}
.product-header,
.section-title {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}
.product-header {
  margin-bottom: 24px;
}
.product-header h1 {
  margin: 4px 0 8px;
  font-size: 28px;
}
.product-header p,
.hint,
.section-title p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.eyebrow {
  font-family: monospace;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.product-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 16px 0;
}
.product-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
  padding: 20px;
  margin-top: 16px;
}
.product-grid .product-panel {
  margin-top: 0;
}
.product-panel h2 {
  font-size: 17px;
  margin: 0 0 10px;
}
.product-panel h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
dl {
  margin: 16px 0;
  display: grid;
  gap: 8px;
}
dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
  font-weight: 600;
}
.permission-template {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.permission-template code,
.endpoint {
  font-size: 12px;
  padding: 4px 6px;
  background: var(--el-fill-color-light);
  border-radius: 3px;
  overflow-wrap: anywhere;
}
.endpoint {
  display: block;
  margin: 12px 0;
}
.action-tag {
  margin: 2px;
}
.section-title {
  margin-bottom: 16px;
}
@media (max-width: 720px) {
  .developer-product {
    padding: 16px;
  }
  .product-header {
    align-items: center;
  }
  .product-header h1 {
    font-size: 22px;
  }
  .product-grid {
    grid-template-columns: 1fr;
  }
  .header-actions .el-button:not(.el-button--primary) {
    display: none;
  }
}
</style>
