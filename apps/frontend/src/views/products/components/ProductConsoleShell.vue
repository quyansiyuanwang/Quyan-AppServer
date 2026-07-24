<template>
  <main class="product-console desktop-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">{{ product }}</p>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" circle :aria-label="t('productConsole.refresh')" @click="load" />
        <el-button text @click="openDocumentation">{{ t('productConsole.documentation') }}</el-button>
        <el-button v-if="canManage" type="primary" :icon="Plus" @click="instanceDialog = true">
          {{ t('productConsole.createInstance') }}
        </el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
    <section class="quota-summary" v-loading="loading">
      <span>{{ t('productConsole.instanceCount') }}</span>
      <strong>{{ instances.length }} / {{ config?.defaultInstanceLimit ?? '-' }}</strong>
      <span>{{ t('productConsole.dailyQuota') }}</span>
      <strong>{{ config?.defaultDailyQuota ?? '-' }}</strong>
    </section>

    <section class="instances-panel" v-loading="loading">
      <div class="section-title">
        <div>
          <h2>{{ t('productConsole.instances') }}</h2>
          <p>{{ t('productConsole.instancesDescription') }}</p>
        </div>
      </div>
      <el-empty v-if="!instances.length && !loading" :description="t('productConsole.emptyInstances')" />
      <el-table v-else :data="instances">
        <el-table-column prop="name" :label="t('productConsole.instanceName')" min-width="180" />
        <el-table-column prop="slug" :label="t('productConsole.instanceSlug')" min-width="160">
          <template #default="{ row }"><code>{{ row.slug }}</code></template>
        </el-table-column>
        <el-table-column :label="t('productConsole.status')" width="110">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">
              {{ row.enabled ? t('productConsole.enabled') : t('productConsole.disabled') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('productConsole.actions')" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDrawer(row)">
              {{ canManage ? t('productConsole.manage') : t('productConsole.view') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-drawer
      v-model="drawerOpen"
      direction="rtl"
      size="min(760px, 100%)"
      :title="selectedInstance?.name || t('productConsole.instanceManagement')"
      destroy-on-close
      @closed="clearSelection"
    >
      <template v-if="selectedInstance">
        <section class="drawer-section instance-details">
          <div>
            <span>{{ t('productConsole.instanceSlug') }}</span>
            <code>{{ selectedInstance.slug }}</code>
          </div>
          <el-tag :type="selectedInstance.enabled ? 'success' : 'info'">
            {{ selectedInstance.enabled ? t('productConsole.enabled') : t('productConsole.disabled') }}
          </el-tag>
          <div v-if="canManage" class="instance-controls">
            <el-button :type="selectedInstance.enabled ? 'warning' : 'primary'" @click="setEnabled(selectedInstance)">
              {{ selectedInstance.enabled ? t('productConsole.disableInstance') : t('productConsole.restoreInstance') }}
            </el-button>
            <el-button type="danger" plain @click="removeInstance(selectedInstance)">
              {{ t('productConsole.deleteInstance') }}
            </el-button>
          </div>
        </section>

        <section v-if="canManage" class="drawer-section" v-loading="keysLoading">
          <div class="section-title">
            <div>
              <h2>{{ t('productConsole.apiKeys') }}</h2>
              <p>{{ t('productConsole.apiKeysDescription') }}</p>
            </div>
            <el-button type="primary" :icon="Key" @click="keyDialog = true">
              {{ t('productConsole.createKey') }}
            </el-button>
          </div>
          <el-table :data="keys" size="small">
            <el-table-column prop="name" :label="t('productConsole.keyName')" min-width="130" />
            <el-table-column prop="keyPrefix" :label="t('productConsole.keyPrefix')" min-width="120">
              <template #default="{ row }"><code>{{ row.keyPrefix }}...</code></template>
            </el-table-column>
            <el-table-column :label="t('productConsole.expiresAt')" min-width="150">
              <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
            </el-table-column>
            <el-table-column :label="t('productConsole.actions')" width="80" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" @click="revokeKey(row.id)">{{ t('productConsole.revoke') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!keys.length && !keysLoading" :description="t('productConsole.emptyKeys')" :image-size="76" />
        </section>

        <section class="drawer-section resource-section">
          <slot :instance="selectedInstance" :reload="load" :can-manage="canManage" />
        </section>
      </template>
    </el-drawer>

    <el-dialog v-model="instanceDialog" :title="t('productConsole.createInstance')" width="440px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item :label="t('productConsole.instanceName')"><el-input v-model="instanceForm.name" /></el-form-item>
        <el-form-item :label="t('productConsole.instanceSlug')"><el-input v-model="instanceForm.slug" placeholder="lowercase-slug" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="instanceDialog = false">{{ t('cancel') }}</el-button><el-button type="primary" :loading="submitting" @click="createInstance">{{ t('create') }}</el-button></template>
    </el-dialog>
    <el-dialog v-model="keyDialog" :title="t('productConsole.createKey')" width="520px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item :label="t('productConsole.keyName')"><el-input v-model="keyForm.name" /></el-form-item>
        <el-form-item :label="t('productConsole.keySubject')"><el-select v-model="keyForm.subjectUserId" filterable style="width: 100%"><el-option v-for="subject in subjects" :key="subject.id" :value="subject.id" :label="userLabel(subject)" /></el-select></el-form-item>
        <el-form-item :label="t('productConsole.keyActions')"><el-checkbox-group v-model="keyForm.actions"><el-checkbox v-for="action in actions" :key="action" :value="action">{{ action }}</el-checkbox></el-checkbox-group></el-form-item>
        <el-form-item :label="t('productConsole.expiresAtOptional')"><el-date-picker v-model="keyForm.expiresAt" type="datetime" style="width: 100%" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="keyDialog = false">{{ t('cancel') }}</el-button><el-button type="primary" :loading="submitting" @click="createKey">{{ t('create') }}</el-button></template>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Plus, Refresh } from '@element-plus/icons-vue'
import type { DeveloperProductCode, DeveloperProductInstanceDto, DeveloperProductSubjectDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { usePermissionStore } from '@/stores/permissionStore'
import { DEVELOPER_PRODUCT_NAVIGATION, developerProductUserRoute } from '@/constant/developer-product-navigation'
import { i18ns } from '@/locales'
import { resolveDocsUrl } from '@/config/docs'

const props = defineProps<{ product: DeveloperProductCode; title: string; description: string; actions: string[] }>()
const { t } = i18ns
const permissionStore = usePermissionStore()
const loading = ref(false)
const keysLoading = ref(false)
const submitting = ref(false)
const error = ref('')
const instances = ref<DeveloperProductInstanceDto[]>([])
const selectedInstance = ref<DeveloperProductInstanceDto>()
const drawerOpen = ref(false)
const keys = ref<Awaited<ReturnType<typeof developerProductService.listKeys>>>([])
const subjects = ref<DeveloperProductSubjectDto[]>([])
const config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>()
const instanceDialog = ref(false)
const keyDialog = ref(false)
const instanceForm = ref({ name: '', slug: '' })
const keyForm = ref({ name: '', subjectUserId: '', actions: [] as string[], expiresAt: null as Date | null })
const definition = computed(() => DEVELOPER_PRODUCT_NAVIGATION.find((item) => item.code === props.product))
const canManage = computed(() => {
  const permissions = definition.value?.permissions || []
  const permission = permissions[permissions.length - 1]
  return Boolean(permission && permissionStore.hasPermission(permission))
})
const userLabel = (subject: DeveloperProductSubjectDto) => subject.displayName || subject.username
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : t('productConsole.neverExpires')
const clearSelection = () => { selectedInstance.value = undefined; keys.value = []; keyForm.value = { name: '', subjectUserId: '', actions: [], expiresAt: null } }
const openDrawer = (instance: DeveloperProductInstanceDto) => { selectedInstance.value = instance; drawerOpen.value = true; void loadKeys() }
const openDocumentation = () => window.open(resolveDocsUrl(developerProductUserRoute(props.product), i18ns.locale), '_blank', 'noopener,noreferrer')
const loadKeys = async () => {
  if (!selectedInstance.value || !canManage.value) return
  keysLoading.value = true
  try { keys.value = await developerProductService.listKeys(props.product, selectedInstance.value.id) } finally { keysLoading.value = false }
}
const load = async () => {
  loading.value = true; error.value = ''
  try {
    const [configs, nextInstances, nextSubjects] = await Promise.all([developerProductService.catalog(), developerProductService.listInstances(props.product), canManage.value ? developerProductService.listSubjects(props.product) : Promise.resolve([])])
    config.value = configs.find((item) => item.code === props.product)?.config
    instances.value = nextInstances; subjects.value = nextSubjects
    if (selectedInstance.value) selectedInstance.value = nextInstances.find((item) => item.id === selectedInstance.value?.id)
    await loadKeys()
  } catch { error.value = t('productConsole.loadError') } finally { loading.value = false }
}
const createInstance = async () => { submitting.value = true; try { const instance = await developerProductService.createInstance(props.product, instanceForm.value); instanceDialog.value = false; instanceForm.value = { name: '', slug: '' }; await load(); openDrawer(instance); ElMessage.success(t('productConsole.instanceCreated')) } finally { submitting.value = false } }
const createKey = async () => { if (!selectedInstance.value) return; submitting.value = true; try { const result = await developerProductService.createKey(props.product, selectedInstance.value.id, { ...keyForm.value, expiresAt: keyForm.value.expiresAt?.toISOString() }); keyDialog.value = false; keyForm.value = { name: '', subjectUserId: '', actions: [], expiresAt: null }; await loadKeys(); await ElMessageBox.alert(result.key || '', t('productConsole.saveKeyTitle'), { confirmButtonText: t('productConsole.savedKey') }) } finally { submitting.value = false } }
const revokeKey = async (keyId: string) => { if (!selectedInstance.value) return; await ElMessageBox.confirm(t('productConsole.revokeKeyConfirm'), t('productConsole.revokeKeyTitle'), { type: 'warning' }); await developerProductService.revokeKey(props.product, selectedInstance.value.id, keyId); await loadKeys(); ElMessage.success(t('productConsole.keyRevoked')) }
const setEnabled = async (instance: DeveloperProductInstanceDto) => { await developerProductService.updateInstance(props.product, instance.id, !instance.enabled); await load(); ElMessage.success(instance.enabled ? t('productConsole.instanceDisabled') : t('productConsole.instanceRestored')) }
const removeInstance = async (instance: DeveloperProductInstanceDto) => { await ElMessageBox.confirm(t('productConsole.deleteInstanceConfirm', { name: instance.name }), t('productConsole.deleteInstanceTitle'), { type: 'warning', confirmButtonText: t('productConsole.deleteInstance') }); await developerProductService.deleteInstance(props.product, instance.id); drawerOpen.value = false; await load(); ElMessage.success(t('productConsole.instanceDeleted')) }
watch(() => props.product, load)
onMounted(load)
</script>

<style scoped lang="scss">
.product-console { width: 100%; min-width: 0; min-height: 100%; box-sizing: border-box; padding: 28px; }
.page-header, .header-actions, .section-title, .instance-details { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.page-header { margin-bottom: 20px; }.page-header h1 { margin: 4px 0 8px; font-size: 28px; }.page-header p, .instances-panel p { margin: 0; color: var(--el-text-color-secondary); line-height: 1.6; }.eyebrow { font: 700 12px monospace; color: var(--el-color-primary); letter-spacing: 0; }
.quota-summary { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 10px 16px; max-width: 480px; padding: 14px 0 20px; }.quota-summary span { color: var(--el-text-color-secondary); }.quota-summary strong { font-variant-numeric: tabular-nums; }
.instances-panel { border-top: 1px solid var(--el-border-color-light); padding-top: 20px; }.section-title { margin-bottom: 16px; }.section-title h2 { margin: 0 0 6px; font-size: 17px; }
.drawer-section { padding: 0 0 24px; margin-bottom: 24px; border-bottom: 1px solid var(--el-border-color-light); }.drawer-section:last-child { border-bottom: 0; }.instance-details { align-items: center; flex-wrap: wrap; }.instance-details > div:first-child { display: grid; gap: 4px; }.instance-details span { color: var(--el-text-color-secondary); font-size: 13px; }.instance-controls { display: flex; gap: 8px; margin-left: auto; }.resource-section { min-height: 180px; }
@media (max-width: 720px) { .product-console { padding: 16px; }.page-header { flex-direction: column; }.header-actions { width: 100%; flex-wrap: wrap; }.page-header h1 { font-size: 22px; }.quota-summary { grid-template-columns: max-content 1fr; }.instance-controls { width: 100%; margin-left: 0; } }
</style>
