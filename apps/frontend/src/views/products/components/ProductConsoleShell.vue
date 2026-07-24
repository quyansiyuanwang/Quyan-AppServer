<template>
  <main :class="['product-console', isDesktop ? 'desktop-page' : 'mobile-page']">
    <header class="page-header">
      <div>
        <p class="eyebrow">{{ product }}</p>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <div class="header-actions">
        <el-button
          :icon="Refresh"
          circle
          :aria-label="t('productConsole.refresh')"
          :loading="loading"
          @click="load"
        />
        <el-button text @click="openDocumentation">{{
          t('productConsole.documentation')
        }}</el-button>
        <el-button v-if="canManage" type="primary" :icon="Plus" @click="openInstanceDialog">{{
          t('productConsole.createInstance')
        }}</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false"
      ><template #default
        ><el-button link type="primary" @click="load">{{
          t('productFeedback.retry')
        }}</el-button></template
      ></el-alert
    >
    <section class="quota-summary" v-loading="loading">
      <span>{{ t('productConsole.instanceCount') }}</span
      ><strong>{{ instances.length }} / {{ config?.defaultInstanceLimit ?? '-' }}</strong
      ><span>{{ t('productConsole.dailyQuota') }}</span
      ><strong>{{ config?.overagePrice === 0 ? '∞' : (config?.defaultDailyQuota ?? '-') }}</strong>
    </section>
    <section class="instances-panel" v-loading="loading">
      <div class="section-title">
        <div>
          <h2>{{ t('productConsole.instances') }}</h2>
          <p>{{ t('productConsole.instancesDescription') }}</p>
        </div>
      </div>
      <el-empty
        v-if="!instances.length && !loading"
        :description="t('productConsole.emptyInstances')"
      />
      <el-table v-else :data="instances"
        ><el-table-column
          prop="name"
          :label="t('productConsole.instanceName')"
          min-width="180"
        /><el-table-column prop="slug" :label="t('productConsole.instanceSlug')" min-width="160"
          ><template #default="{ row }"
            ><code>{{ row.slug }}</code></template
          ></el-table-column
        ><el-table-column :label="t('productConsole.status')" width="110"
          ><template #default="{ row }"
            ><el-tag :type="row.enabled ? 'success' : 'info'">{{
              row.enabled ? t('productConsole.enabled') : t('productConsole.disabled')
            }}</el-tag></template
          ></el-table-column
        ><el-table-column :label="t('productConsole.actions')" width="110" fixed="right"
          ><template #default="{ row }"
            ><el-button link type="primary" @click="openDrawer(row)">{{
              canManage ? t('productConsole.manage') : t('productConsole.view')
            }}</el-button></template
          ></el-table-column
        ></el-table
      >
    </section>

    <el-drawer
      v-model="drawerOpen"
      direction="rtl"
      size="min(66vw, 100%)"
      :title="selectedInstance?.name || t('productConsole.instanceManagement')"
      destroy-on-close
      @closed="clearSelection"
    >
      <template v-if="selectedInstance">
        <section class="drawer-section instance-details">
          <div>
            <span>{{ t('productConsole.instanceSlug') }}</span
            ><code>{{ selectedInstance.slug }}</code>
          </div>
          <el-tag :type="selectedInstance.enabled ? 'success' : 'info'">{{
            selectedInstance.enabled ? t('productConsole.enabled') : t('productConsole.disabled')
          }}</el-tag>
          <div v-if="canManage" class="instance-controls">
            <el-button
              :loading="instanceActionLoading"
              :type="selectedInstance.enabled ? 'warning' : 'primary'"
              @click="setEnabled(selectedInstance)"
              >{{
                selectedInstance.enabled
                  ? t('productConsole.disableInstance')
                  : t('productConsole.restoreInstance')
              }}</el-button
            ><el-button
              :loading="instanceActionLoading"
              type="danger"
              plain
              @click="removeInstance(selectedInstance)"
              >{{ t('productConsole.deleteInstance') }}</el-button
            >
          </div>
        </section>
        <section v-if="canManage" class="drawer-section" v-loading="keysLoading">
          <el-alert v-if="keysError" type="error" :title="keysError" :closable="false"
            ><template #default
              ><el-button link type="primary" @click="loadKeys">{{
                t('productFeedback.retry')
              }}</el-button></template
            ></el-alert
          >
          <div class="section-title">
            <div>
              <h2>{{ t('productConsole.apiKeys') }}</h2>
              <p>{{ t('productConsole.apiKeysDescription') }}</p>
            </div>
            <el-button type="primary" :icon="Key" @click="openKeyDialog">{{
              t('productConsole.createKey')
            }}</el-button>
          </div>
          <el-table :data="keys" size="small"
            ><el-table-column
              prop="name"
              :label="t('productConsole.keyName')"
              min-width="130"
            /><el-table-column
              prop="keyPrefix"
              :label="t('productConsole.keyPrefix')"
              min-width="120"
              ><template #default="{ row }"
                ><code>{{ row.keyPrefix }}...</code></template
              ></el-table-column
            ><el-table-column :label="t('productConsole.keyActions')" min-width="180"
              ><template #default="{ row }"
                ><el-tag
                  v-for="action in row.actions"
                  :key="action"
                  class="action-tag"
                  size="small"
                  >{{ productActionLabel(action) }}</el-tag
                ></template
              ></el-table-column
            ><el-table-column :label="t('productConsole.expiresAt')" min-width="150"
              ><template #default="{ row }">{{
                formatDate(row.expiresAt)
              }}</template></el-table-column
            ><el-table-column :label="t('productConsole.actions')" width="80" fixed="right"
              ><template #default="{ row }"
                ><el-button
                  link
                  type="danger"
                  :loading="keyActionLoading"
                  @click="revokeKey(row.id)"
                  >{{ t('productConsole.revoke') }}</el-button
                ></template
              ></el-table-column
            ></el-table
          ><el-empty
            v-if="!keys.length && !keysLoading"
            :description="t('productConsole.emptyKeys')"
            :image-size="76"
          />
        </section>
        <section class="drawer-section resource-section">
          <slot
            :instance="selectedInstance"
            :reload="load"
            :can-manage="canManage"
            :has-permission="hasPermission"
          />
        </section>
      </template>
    </el-drawer>

    <el-dialog
      v-model="instanceDialog"
      :title="t('productConsole.createInstance')"
      width="440px"
      destroy-on-close
      ><el-alert
        v-if="instanceFormError"
        type="error"
        :title="instanceFormError"
        :closable="false"
      /><el-form label-position="top"
        ><el-form-item :label="t('productConsole.instanceName')"
          ><el-input v-model="instanceForm.name" /></el-form-item
        ><el-form-item :label="t('productConsole.instanceSlug')"
          ><el-input
            v-model="instanceForm.slug"
            placeholder="lowercase-slug" /></el-form-item></el-form
      ><template #footer
        ><el-button @click="instanceDialog = false">{{ t('cancel') }}</el-button
        ><el-button type="primary" :loading="instanceSubmitting" @click="createInstance">{{
          t('create')
        }}</el-button></template
      ></el-dialog
    >
    <el-dialog
      v-model="keyDialog"
      :title="t('productConsole.createKey')"
      width="520px"
      destroy-on-close
    >
      <el-alert v-if="keyFormError" type="error" :title="keyFormError" :closable="false" />
      <el-form label-position="top">
        <el-form-item :label="t('productConsole.keyName')"
          ><el-input v-model="keyForm.name"
        /></el-form-item>
        <el-form-item
          :label="
            canDelegateKeySubject
              ? t('productConsole.keySubject')
              : t('productConsole.keyCurrentSubject')
          "
        >
          <el-select
            v-if="canDelegateKeySubject"
            v-model="keyForm.subjectUserId"
            filterable
            style="width: 100%"
            @change="syncKeyActions"
          >
            <el-option
              v-for="subject in subjects"
              :key="subject.id"
              :value="subject.id"
              :label="userLabel(subject)"
            />
          </el-select>
          <el-input
            v-else
            :model-value="selectedSubject ? userLabel(selectedSubject) : ''"
            disabled
          />
          <p class="field-hint">{{ t('productConsole.keySubjectHint') }}</p>
        </el-form-item>
        <el-form-item :label="t('productConsole.keyActions')">
          <el-checkbox-group v-model="keyForm.actions">
            <el-checkbox v-for="action in availableKeyActions" :key="action" :value="action">{{
              productActionLabel(action)
            }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item :label="t('productConsole.expiresAtOptional')"
          ><el-date-picker v-model="keyForm.expiresAt" type="datetime" style="width: 100%"
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="keyDialog = false">{{ t('cancel') }}</el-button
        ><el-button type="primary" :loading="keySubmitting" @click="createKey">{{
          t('create')
        }}</el-button></template
      >
    </el-dialog>
    <el-dialog
      v-model="createdKeyDialog"
      :title="t('productConsole.saveKeyTitle')"
      width="560px"
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :before-close="() => undefined"
    >
      <el-input :model-value="createdKey" readonly>
        <template #append
          ><el-button
            :icon="DocumentCopy"
            :aria-label="t('productConsole.copyKey')"
            @click="copyCreatedKey"
            >{{ t('productConsole.copyKey') }}</el-button
          ></template
        >
      </el-input>
      <template #footer
        ><el-button type="primary" @click="clearCreatedKey">{{
          t('productConsole.savedKey')
        }}</el-button></template
      >
    </el-dialog>
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentCopy, Key, Plus, Refresh } from '@element-plus/icons-vue'
import type {
  DeveloperProductCode,
  DeveloperProductInstanceDto,
  DeveloperProductSubjectDto,
} from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  DEVELOPER_PRODUCT_NAVIGATION,
  developerProductUserRoute,
} from '@/constant/developer-product-navigation'
import { i18ns } from '@/locales'
import { resolveDocsUrl } from '@/config/docs'
import { getErrorMessage } from '@/utils/error-utils'
import { copyTextWithFallback } from '@/utils/clipboard'
import { productActionLabel } from '@/views/products/developer-product-ui'
import { usePageDevice } from '@/composables/usePageDevice'
const props = defineProps<{
  product: DeveloperProductCode
  title: string
  description: string
  actions: string[]
}>()
const { t } = i18ns
const { isDesktop } = usePageDevice()
const permissionStore = usePermissionStore()
const loading = ref(false),
  keysLoading = ref(false),
  instanceSubmitting = ref(false),
  keySubmitting = ref(false),
  instanceActionLoading = ref(false),
  keyActionLoading = ref(false),
  error = ref(''),
  keysError = ref(''),
  instanceFormError = ref(''),
  keyFormError = ref('')
const instances = ref<DeveloperProductInstanceDto[]>([]),
  selectedInstance = ref<DeveloperProductInstanceDto>(),
  drawerOpen = ref(false),
  keys = ref<Awaited<ReturnType<typeof developerProductService.listKeys>>>([]),
  subjects = ref<DeveloperProductSubjectDto[]>([]),
  config = ref<Awaited<ReturnType<typeof developerProductService.listConfigs>>[number]>(),
  instanceDialog = ref(false),
  keyDialog = ref(false),
  createdKeyDialog = ref(false),
  createdKey = ref(''),
  instanceForm = ref({ name: '', slug: '' }),
  keyForm = ref({
    name: '',
    subjectUserId: '',
    actions: [] as string[],
    expiresAt: null as Date | null,
  })
let loadSequence = 0,
  keyLoadSequence = 0
const definition = computed(() =>
  DEVELOPER_PRODUCT_NAVIGATION.find((item) => item.code === props.product),
)
const managePermission = computed(() => {
  const permissions = definition.value?.permissions || []
  return permissions[permissions.length - 1]
})
const canManage = computed(() =>
  Boolean(managePermission.value && permissionStore.hasPermission(managePermission.value)),
)
const hasPermission = (permission: string) => permissionStore.hasPermission(permission)
const userLabel = (subject: DeveloperProductSubjectDto) => subject.displayName || subject.username
const selectedSubject = computed(() =>
  subjects.value.find((subject) => subject.id === keyForm.value.subjectUserId),
)
const availableKeyActions = computed(() => selectedSubject.value?.allowedActions || [])
const canDelegateKeySubject = computed(() => subjects.value.length > 1)
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : t('productConsole.neverExpires')
const resetKeyForm = () => {
  keyForm.value = { name: '', subjectUserId: '', actions: [], expiresAt: null }
  keyFormError.value = ''
}
const syncKeyActions = () => {
  const allowed = new Set(availableKeyActions.value)
  keyForm.value.actions = keyForm.value.actions.filter((action) => allowed.has(action))
}
const clearSelection = () => {
  selectedInstance.value = undefined
  keys.value = []
  keysError.value = ''
  resetKeyForm()
  keyLoadSequence += 1
}
const openDrawer = (instance: DeveloperProductInstanceDto) => {
  selectedInstance.value = instance
  keys.value = []
  keysError.value = ''
  drawerOpen.value = true
  void loadKeys()
}
const openDocumentation = () =>
  window.open(
    resolveDocsUrl(developerProductUserRoute(props.product), i18ns.locale),
    '_blank',
    'noopener,noreferrer',
  )
const openInstanceDialog = () => {
  instanceForm.value = { name: '', slug: '' }
  instanceFormError.value = ''
  instanceDialog.value = true
}
const openKeyDialog = () => {
  resetKeyForm()
  const [subject] = subjects.value
  if (subjects.value.length === 1 && subject) keyForm.value.subjectUserId = subject.id
  keyDialog.value = true
}
const loadKeys = async () => {
  if (!selectedInstance.value || !canManage.value) return
  const instanceId = selectedInstance.value.id,
    sequence = ++keyLoadSequence
  keysLoading.value = true
  keysError.value = ''
  try {
    const nextKeys = await developerProductService.listKeys(props.product, instanceId)
    if (sequence === keyLoadSequence && selectedInstance.value?.id === instanceId)
      keys.value = nextKeys
  } catch (cause) {
    if (sequence === keyLoadSequence) {
      keysError.value = getErrorMessage(cause, t('productFeedback.loadFailed'))
      ElMessage.error(keysError.value)
    }
  } finally {
    if (sequence === keyLoadSequence) keysLoading.value = false
  }
}
const load = async () => {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const [configs, nextInstances, nextSubjects] = await Promise.all([
      developerProductService.catalog(),
      developerProductService.listInstances(props.product),
      canManage.value ? developerProductService.listSubjects(props.product) : Promise.resolve([]),
    ])
    if (sequence !== loadSequence) return
    config.value = configs.find((item) => item.code === props.product)?.config
    instances.value = nextInstances
    subjects.value = nextSubjects
    if (keyForm.value.subjectUserId) syncKeyActions()
    if (selectedInstance.value) {
      selectedInstance.value = nextInstances.find((item) => item.id === selectedInstance.value?.id)
      if (!selectedInstance.value) drawerOpen.value = false
    }
    await loadKeys()
  } catch (cause) {
    if (sequence === loadSequence) {
      error.value = getErrorMessage(cause, t('productConsole.loadError'))
      ElMessage.error(error.value)
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
const createInstance = async () => {
  if (instanceSubmitting.value) return
  if (!instanceForm.value.name.trim() || !instanceForm.value.slug.trim()) {
    instanceFormError.value = t('required')
    return
  }
  instanceSubmitting.value = true
  instanceFormError.value = ''
  try {
    const instance = await developerProductService.createInstance(props.product, {
      name: instanceForm.value.name.trim(),
      slug: instanceForm.value.slug.trim(),
    })
    instanceDialog.value = false
    await load()
    openDrawer(instance)
    ElMessage.success(t('productConsole.instanceCreated'))
  } catch (cause) {
    instanceFormError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(instanceFormError.value)
  } finally {
    instanceSubmitting.value = false
  }
}
const createKey = async () => {
  if (!selectedInstance.value || keySubmitting.value) return
  if (!keyForm.value.name.trim() || !keyForm.value.subjectUserId || !keyForm.value.actions.length) {
    keyFormError.value = t('required')
    return
  }
  keySubmitting.value = true
  keyFormError.value = ''
  try {
    const result = await developerProductService.createKey(
      props.product,
      selectedInstance.value.id,
      {
        ...keyForm.value,
        name: keyForm.value.name.trim(),
        expiresAt: keyForm.value.expiresAt?.toISOString(),
      },
    )
    await loadKeys()
    keyDialog.value = false
    createdKey.value = result.key || ''
    createdKeyDialog.value = Boolean(createdKey.value)
  } catch (cause) {
    keyFormError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(keyFormError.value)
  } finally {
    keySubmitting.value = false
  }
}
const copyCreatedKey = async () => {
  if (!createdKey.value) return
  if (await copyTextWithFallback(createdKey.value)) ElMessage.success(t('productConsole.keyCopied'))
  else ElMessage.error(t('message.error.copyFailed'))
}
const clearCreatedKey = () => {
  createdKey.value = ''
  createdKeyDialog.value = false
}
const revokeKey = async (keyId: string) => {
  if (!selectedInstance.value || keyActionLoading.value) return
  try {
    await ElMessageBox.confirm(
      t('productConsole.revokeKeyConfirm'),
      t('productConsole.revokeKeyTitle'),
      { type: 'warning' },
    )
    keyActionLoading.value = true
    await developerProductService.revokeKey(props.product, selectedInstance.value.id, keyId)
    await loadKeys()
    ElMessage.success(t('productConsole.keyRevoked'))
  } catch (cause) {
    if (cause !== 'cancel')
      ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    keyActionLoading.value = false
  }
}
const setEnabled = async (instance: DeveloperProductInstanceDto) => {
  if (instanceActionLoading.value) return
  instanceActionLoading.value = true
  try {
    await developerProductService.updateInstance(props.product, instance.id, !instance.enabled)
    await load()
    ElMessage.success(
      instance.enabled
        ? t('productConsole.instanceDisabled')
        : t('productConsole.instanceRestored'),
    )
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    instanceActionLoading.value = false
  }
}
const removeInstance = async (instance: DeveloperProductInstanceDto) => {
  if (instanceActionLoading.value) return
  try {
    await ElMessageBox.confirm(
      t('productConsole.deleteInstanceConfirm', { name: instance.name }),
      t('productConsole.deleteInstanceTitle'),
      { type: 'warning', confirmButtonText: t('productConsole.deleteInstance') },
    )
    instanceActionLoading.value = true
    await developerProductService.deleteInstance(props.product, instance.id)
    drawerOpen.value = false
    await load()
    ElMessage.success(t('productConsole.instanceDeleted'))
  } catch (cause) {
    if (cause !== 'cancel')
      ElMessage.error(getErrorMessage(cause, t('productFeedback.operationFailed')))
  } finally {
    instanceActionLoading.value = false
  }
}
watch(
  () => props.product,
  () => {
    clearSelection()
    void load()
  },
)
onMounted(load)
</script>
<style scoped lang="scss">
.product-console {
  width: 100%;
  min-width: 0;
  min-height: 100%;
  box-sizing: border-box;
  padding: 28px;
}
.page-header,
.header-actions,
.section-title,
.instance-details {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.page-header {
  margin-bottom: 20px;
}
.page-header h1 {
  margin: 4px 0 8px;
  font-size: 28px;
}
.page-header p,
.instances-panel p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.eyebrow {
  font: 700 12px monospace;
  color: var(--el-color-primary);
  letter-spacing: 0;
}
.quota-summary {
  display: grid;
  grid-template-columns: max-content 1fr max-content 1fr;
  gap: 10px 16px;
  max-width: 480px;
  padding: 14px 0 20px;
}
.quota-summary span {
  color: var(--el-text-color-secondary);
}
.quota-summary strong {
  font-variant-numeric: tabular-nums;
}
.instances-panel {
  border-top: 1px solid var(--el-border-color-light);
  padding-top: 20px;
}
.section-title {
  margin-bottom: 16px;
}
.section-title h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.drawer-section {
  padding: 0 0 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.drawer-section:last-child {
  border-bottom: 0;
}
.instance-details {
  align-items: center;
  flex-wrap: wrap;
}
.instance-details > div:first-child {
  display: grid;
  gap: 4px;
}
.instance-details span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.instance-controls {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.resource-section {
  min-height: 180px;
}
.field-hint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.action-tag {
  margin: 0 4px 4px 0;
}
@media (max-width: 768px) {
  .product-console {
    padding: 16px;
  }
  .page-header {
    flex-direction: column;
  }
  .header-actions {
    width: 100%;
    flex-wrap: wrap;
  }
  .page-header h1 {
    font-size: 22px;
  }
  .quota-summary {
    grid-template-columns: max-content 1fr;
  }
  .instance-controls {
    width: 100%;
    margin-left: 0;
  }
}
</style>
