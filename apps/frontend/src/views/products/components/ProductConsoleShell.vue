<template>
  <main class="product-console desktop-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">{{ product }}</p>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" circle aria-label="刷新" @click="load" />
        <el-button v-if="canManage" type="primary" :icon="Plus" @click="instanceDialog = true">新建实例</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
    <section class="overview-grid" v-loading="loading">
      <article class="surface">
        <h2>实例与额度</h2>
        <dl>
          <div><dt>实例数量</dt><dd>{{ instances.length }} / {{ config?.defaultInstanceLimit ?? '-' }}</dd></div>
          <div><dt>每日免费额度</dt><dd>{{ config?.defaultDailyQuota ?? '-' }}</dd></div>
        </dl>
      </article>
      <article class="surface">
        <h2>RAM 授权</h2>
        <p>产品权限决定控制台操作；每次 API 调用也会重新校验 Key 绑定主体的实时权限。</p>
        <div class="permission-list"><code v-for="action in actions" :key="action">{{ action }}</code></div>
        <el-button plain @click="router.push({ name: 'ramManagement', query: { product } })">配置 RAM 权限</el-button>
      </article>
    </section>

    <section class="surface instances" v-loading="loading">
      <div class="section-title"><div><h2>实例</h2><p>资源和 API Key 均按实例隔离。</p></div></div>
      <el-empty v-if="!instances.length && !loading" description="暂无实例" />
      <el-table v-else :data="instances" highlight-current-row @current-change="selectInstance">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="slug" label="标识" min-width="150"><template #default="{ row }"><code>{{ row.slug }}</code></template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column v-if="canManage" label="操作" width="180" fixed="right"><template #default="{ row }">
          <el-button link :type="row.enabled ? 'warning' : 'primary'" @click="setEnabled(row)">{{ row.enabled ? '停用' : '恢复' }}</el-button>
          <el-button link type="danger" @click="removeInstance(row)">删除</el-button>
        </template></el-table-column>
      </el-table>
    </section>

    <section v-if="selectedInstance" class="surface keys" v-loading="keysLoading">
      <div class="section-title"><div><h2>{{ selectedInstance.name }} 的 API Key</h2><p>明文只会在创建时展示一次。</p></div><el-button v-if="canManage" type="primary" :icon="Key" @click="keyDialog = true">创建 Key</el-button></div>
      <el-table :data="keys">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="keyPrefix" label="前缀" min-width="130"><template #default="{ row }"><code>{{ row.keyPrefix }}...</code></template></el-table-column>
        <el-table-column label="RAM 主体" min-width="150"><template #default="{ row }">{{ subjectLabel(row.subjectUserId) }}</template></el-table-column>
        <el-table-column label="动作" min-width="190"><template #default="{ row }"><el-tag v-for="action in row.actions" :key="action" size="small" class="action-tag">{{ action }}</el-tag></template></el-table-column>
        <el-table-column v-if="canManage" label="操作" width="80"><template #default="{ row }"><el-button link type="danger" @click="revokeKey(row.id)">撤销</el-button></template></el-table-column>
      </el-table>
    </section>

    <slot :instance="selectedInstance" :reload="load" :can-manage="canManage" />

    <el-dialog v-model="instanceDialog" title="新建产品实例" width="440px"><el-form label-position="top"><el-form-item label="实例名称"><el-input v-model="instanceForm.name" /></el-form-item><el-form-item label="实例标识"><el-input v-model="instanceForm.slug" placeholder="lowercase-slug" /></el-form-item></el-form><template #footer><el-button @click="instanceDialog = false">取消</el-button><el-button type="primary" :loading="submitting" @click="createInstance">创建</el-button></template></el-dialog>
    <el-dialog v-model="keyDialog" title="创建产品 API Key" width="520px"><el-form label-position="top"><el-form-item label="名称"><el-input v-model="keyForm.name" /></el-form-item><el-form-item label="绑定 RAM 主体"><el-select v-model="keyForm.subjectUserId" filterable style="width: 100%"><el-option v-for="subject in subjects" :key="subject.id" :value="subject.id" :label="userLabel(subject)" /></el-select></el-form-item><el-form-item label="允许动作"><el-checkbox-group v-model="keyForm.actions"><el-checkbox v-for="action in actions" :key="action" :value="action">{{ action }}</el-checkbox></el-checkbox-group></el-form-item></el-form><template #footer><el-button @click="keyDialog = false">取消</el-button><el-button type="primary" :loading="submitting" @click="createKey">创建</el-button></template></el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Plus, Refresh } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import type { DeveloperProductCode, DeveloperProductInstanceDto, DeveloperProductSubjectDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { usePermissionStore } from '@/stores/permissionStore'
import { DEVELOPER_PRODUCT_NAVIGATION } from '@/constant/developer-product-navigation'

const props = defineProps<{ product: DeveloperProductCode; title: string; description: string; actions: string[] }>()
const router = useRouter()
const permissionStore = usePermissionStore()
const loading = ref(false)
const keysLoading = ref(false)
const submitting = ref(false)
const error = ref('')
const instances = ref<DeveloperProductInstanceDto[]>([])
const selectedInstance = ref<DeveloperProductInstanceDto>()
const keys = ref<Awaited<ReturnType<typeof developerProductService.listKeys>>>([])
const subjects = ref<DeveloperProductSubjectDto[]>([])
const config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>()
const instanceDialog = ref(false)
const keyDialog = ref(false)
const instanceForm = ref({ name: '', slug: '' })
const keyForm = ref({ name: '', subjectUserId: '', actions: [] as string[] })
const definition = computed(() => DEVELOPER_PRODUCT_NAVIGATION.find((item) => item.code === props.product))
const canManage = computed(() => {
  const permissions = definition.value?.permissions || []
  const permission = permissions[permissions.length - 1]
  return Boolean(permission && permissionStore.hasPermission(permission))
})
const userLabel = (subject: DeveloperProductSubjectDto) => subject.displayName || subject.username
const subjectLabel = (id: string) => subjects.value.find((subject) => subject.id === id) ? userLabel(subjects.value.find((subject) => subject.id === id)!) : id
const loadKeys = async () => {
  if (!selectedInstance.value || !canManage.value) return
  keysLoading.value = true
  try { keys.value = await developerProductService.listKeys(props.product, selectedInstance.value.id) } finally { keysLoading.value = false }
}
const selectInstance = (instance?: DeveloperProductInstanceDto) => { selectedInstance.value = instance; void loadKeys() }
const load = async () => {
  loading.value = true; error.value = ''
  try {
    const [configs, nextInstances, nextSubjects] = await Promise.all([developerProductService.catalog(), developerProductService.listInstances(props.product), canManage.value ? developerProductService.listSubjects(props.product) : Promise.resolve([])])
    config.value = configs.find((item) => item.code === props.product)?.config
    instances.value = nextInstances
    subjects.value = nextSubjects
    selectedInstance.value = nextInstances.find((item) => item.id === selectedInstance.value?.id) || nextInstances[0]
    await loadKeys()
  } catch { error.value = '控制台数据暂时无法加载，请刷新后重试。' } finally { loading.value = false }
}
const createInstance = async () => { submitting.value = true; try { const instance = await developerProductService.createInstance(props.product, instanceForm.value); instanceDialog.value = false; instanceForm.value = { name: '', slug: '' }; selectedInstance.value = instance; await load(); ElMessage.success('实例已创建') } finally { submitting.value = false } }
const createKey = async () => { if (!selectedInstance.value) return; submitting.value = true; try { const result = await developerProductService.createKey(props.product, selectedInstance.value.id, keyForm.value); keyDialog.value = false; keyForm.value = { name: '', subjectUserId: '', actions: [] }; await loadKeys(); await ElMessageBox.alert(result.key || '', '请立即保存 API Key', { confirmButtonText: '我已保存' }) } finally { submitting.value = false } }
const revokeKey = async (keyId: string) => { if (!selectedInstance.value) return; await ElMessageBox.confirm('撤销后该 Key 不能恢复。', '撤销 API Key', { type: 'warning' }); await developerProductService.revokeKey(props.product, selectedInstance.value.id, keyId); await loadKeys(); ElMessage.success('API Key 已撤销') }
const setEnabled = async (instance: DeveloperProductInstanceDto) => { await developerProductService.updateInstance(props.product, instance.id, !instance.enabled); await load(); ElMessage.success(instance.enabled ? '实例已停用' : '实例已恢复') }
const removeInstance = async (instance: DeveloperProductInstanceDto) => { await ElMessageBox.confirm(`删除“${instance.name}”会永久删除该实例的 API Key、资源和历史数据。`, '永久删除实例', { type: 'warning', confirmButtonText: '永久删除' }); await developerProductService.deleteInstance(props.product, instance.id); if (selectedInstance.value?.id === instance.id) selectedInstance.value = undefined; await load(); ElMessage.success('实例已永久删除') }
watch(() => props.product, load)
onMounted(load)
</script>

<style scoped lang="scss">
.product-console { width: 100%; min-width: 0; min-height: 100%; box-sizing: border-box; padding: 28px; }
.page-header, .header-actions, .section-title { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.page-header { margin-bottom: 24px; }.page-header h1 { margin: 4px 0 8px; font-size: 28px; }.page-header p, .surface p { margin: 0; color: var(--el-text-color-secondary); line-height: 1.6; }.eyebrow { font: 700 12px monospace; color: var(--el-color-primary); letter-spacing: 0; }
.overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }.surface { margin-top: 16px; padding: 20px; border: 1px solid var(--el-border-color-light); border-radius: 6px; background: var(--el-bg-color); }.overview-grid .surface { margin-top: 0; }.surface h2 { margin: 0 0 8px; font-size: 17px; }.surface dl { display: grid; gap: 8px; margin: 14px 0; }.surface dl div { display: flex; justify-content: space-between; gap: 12px; }.surface dt { color: var(--el-text-color-secondary); }.surface dd { margin: 0; font-weight: 600; }.permission-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }.permission-list code { padding: 3px 6px; background: var(--el-fill-color-light); font-size: 12px; }.action-tag { margin: 2px; }.section-title { margin-bottom: 16px; }.section-title p { margin: 0; }
@media (max-width: 720px) { .product-console { padding: 16px; }.overview-grid { grid-template-columns: 1fr; }.page-header h1 { font-size: 22px; } }
</style>
