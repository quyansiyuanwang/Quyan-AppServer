<template>
  <div :class="isDesktop ? 'desktop-page' : 'mobile-page'">
    <div class="json-endpoint-management">
      <el-card class="page-card">
        <template #header>
          <section class="card-header toolbar-row">
            <div class="json-endpoint-page__heading">
              <span class="page-title">{{ i18ns.t('jsonEndpoint.management') }}</span>
              <span class="meta-label">{{ endpointList.length }}</span>
            </div>
            <div class="json-endpoint-page__toolbar-actions">
              <el-select
                v-if="canManage"
                v-model="ownerFilter"
                clearable
                filterable
                :placeholder="i18ns.t('jsonEndpoint.owner')"
                @change="loadEndpoints"
              >
                <el-option
                  v-for="user in ownerOptions"
                  :key="user.id"
                  :label="user.username"
                  :value="user.id"
                />
              </el-select>
              <PermissionWrapper
                :any-require="[Permission.JSON_ENDPOINT_CREATE, Permission.JSON_ENDPOINT_MANAGE]"
              >
                <el-button type="primary" @click="handleCreate">
                  <el-icon><Plus /></el-icon>
                  {{ i18ns.t('jsonEndpoint.create') }}
                </el-button>
              </PermissionWrapper>
              <el-tooltip :content="i18ns.t('refresh')">
                <el-button circle @click="loadEndpoints">
                  <el-icon><Refresh /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </section>
        </template>

        <el-table
          v-if="isDesktop"
          v-loading="loading"
          :data="endpointList"
          class="json-endpoint-page__table"
        >
          <el-table-column prop="name" :label="i18ns.t('jsonEndpoint.name')" min-width="150" />
          <el-table-column
            v-if="canManage"
            prop="ownerUsername"
            :label="i18ns.t('jsonEndpoint.owner')"
            width="140"
          />
          <el-table-column prop="slug" :label="i18ns.t('jsonEndpoint.slug')" width="150" />
          <el-table-column :label="i18ns.t('jsonEndpoint.pathType')" width="110">
            <template #default="{ row }">
              <el-tag :type="row.isRootSlug ? 'warning' : 'info'" size="small">
                {{
                  row.isRootSlug
                    ? i18ns.t('jsonEndpoint.rootSlug')
                    : i18ns.t('jsonEndpoint.namespacedSlug')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('jsonEndpoint.url')" min-width="260">
            <template #default="{ row }">
              <div class="json-endpoint-page__url">
                <el-link type="primary" @click="openUrl(absoluteUrl(row.publicUrl))">
                  {{ absoluteUrl(row.publicUrl) }}
                </el-link>
                <el-tooltip :content="i18ns.t('copy')">
                  <el-button text circle @click="copyUrl(row.publicUrl)">
                    <el-icon><CopyDocument /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('jsonEndpoint.access')" width="100">
            <template #default="{ row }">
              <el-tag :type="row.isPublic ? 'success' : 'warning'" size="small">
                {{
                  row.isPublic ? i18ns.t('jsonEndpoint.public') : i18ns.t('jsonEndpoint.protected')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="120" fixed="right">
            <template #default="{ row }">
              <el-tooltip :content="i18ns.t('edit')">
                <el-button text circle @click="handleEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </el-button>
              </el-tooltip>
              <el-dropdown @command="handleRowCommand($event, row)">
                <el-button text circle>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="view">
                      {{ i18ns.t('jsonEndpoint.viewJson') }}
                    </el-dropdown-item>
                    <el-dropdown-item divided command="delete">
                      {{ i18ns.t('delete') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
        </el-table>

        <div v-else v-loading="loading" class="json-endpoint-page__mobile-list">
          <button
            v-for="row in endpointList"
            :key="row.id"
            type="button"
            class="json-endpoint-mobile-row"
            @click="handleEdit(row)"
          >
            <span>
              <strong>{{ row.name }}</strong>
              <small>{{ absoluteUrl(row.publicUrl) }}</small>
            </span>
            <el-tag :type="row.isRootSlug ? 'warning' : 'info'" size="small">{{
              row.isRootSlug
                ? i18ns.t('jsonEndpoint.rootSlug')
                : i18ns.t('jsonEndpoint.namespacedSlug')
            }}</el-tag>
            <el-icon><ArrowRight /></el-icon>
          </button>
          <el-empty v-if="!loading && !endpointList.length" />
        </div>
      </el-card>

      <el-drawer
        v-model="drawerVisible"
        :title="isEdit ? i18ns.t('jsonEndpoint.edit') : i18ns.t('jsonEndpoint.create')"
        :direction="isDesktop ? 'rtl' : 'btt'"
        :size="isDesktop ? 'min(68vw, calc(100vw - 64px))' : '100%'"
        :close-on-click-modal="false"
        class="json-endpoint-editor"
        :class="
          isDesktop ? 'json-endpoint-edit-dialog--desktop' : 'json-endpoint-edit-dialog--mobile'
        "
        @closed="resetForm"
      >
        <div :class="isDesktop ? '' : 'json-endpoint-mobile'">
          <el-form
            ref="formRef"
            :model="formData"
            :rules="formRules"
            :label-position="isDesktop ? 'right' : 'top'"
            :label-width="isDesktop ? '124px' : undefined"
            :class="isDesktop ? 'json-endpoint-edit-form' : ''"
          >
            <el-collapse v-model="editDrawerSections" class="json-endpoint-edit-sections">
              <el-collapse-item name="basic">
                <template #title
                  ><span class="json-endpoint-edit-sections__title">{{
                    i18ns.t('jsonEndpoint.basicSettings')
                  }}</span></template
                >
                <div
                  :class="
                    isDesktop
                      ? 'json-endpoint-edit-section-grid'
                      : 'json-endpoint-edit-section-stack'
                  "
                >
                  <el-form-item :label="i18ns.t('jsonEndpoint.name')" prop="name"
                    ><el-input v-model="formData.name"
                  /></el-form-item>
                  <el-form-item v-if="canManage && !isEdit" :label="i18ns.t('jsonEndpoint.owner')"
                    ><el-select v-model="formData.ownerUserId" filterable style="width: 100%"
                      ><el-option
                        v-for="user in ownerOptions"
                        :key="user.id"
                        :label="user.username"
                        :value="user.id" /></el-select
                  ></el-form-item>
                  <el-form-item :label="i18ns.t('jsonEndpoint.slug')" prop="slug"
                    ><el-input v-model="formData.slug" :disabled="isEdit" /><template #extra
                      ><span>{{ i18ns.t('jsonEndpoint.slugHint') }}</span></template
                    ></el-form-item
                  >
                  <el-form-item v-if="canRootSlug" :label="i18ns.t('jsonEndpoint.rootSlug')"
                    ><el-switch v-model="formData.isRootSlug" /><template #extra
                      ><span>{{ i18ns.t('jsonEndpoint.rootSlugHint') }}</span></template
                    ></el-form-item
                  >
                  <el-form-item :label="i18ns.t('jsonEndpoint.url')"
                    ><code class="json-endpoint-editor__url">{{ previewUrl }}</code></el-form-item
                  >
                  <el-form-item
                    :label="i18ns.t('jsonEndpoint.description')"
                    :class="isDesktop ? 'form-item-span-2' : undefined"
                    ><el-input v-model="formData.description" type="textarea" :rows="2"
                  /></el-form-item></div
              ></el-collapse-item>
              <el-collapse-item name="access"
                ><template #title
                  ><span class="json-endpoint-edit-sections__title">{{
                    i18ns.t('jsonEndpoint.access')
                  }}</span></template
                >
                <div
                  :class="
                    isDesktop
                      ? 'json-endpoint-edit-section-grid'
                      : 'json-endpoint-edit-section-stack'
                  "
                >
                  <el-form-item :label="i18ns.t('jsonEndpoint.isPublic')"
                    ><el-switch v-model="formData.isPublic"
                  /></el-form-item>
                  <el-form-item v-if="!formData.isPublic" :label="i18ns.t('jsonEndpoint.password')"
                    ><el-input
                      v-model="formData.password"
                      type="password"
                      show-password
                      :placeholder="
                        isEdit
                          ? i18ns.t('jsonEndpoint.passwordPlaceholder')
                          : i18ns.t('jsonEndpoint.enterPassword')
                      "
                  /></el-form-item></div
              ></el-collapse-item>
              <el-collapse-item name="content"
                ><template #title
                  ><span class="json-endpoint-edit-sections__title">{{
                    i18ns.t('jsonEndpoint.jsonContent')
                  }}</span></template
                >
                <JsonEditor v-model="formData.jsonContent" />
              </el-collapse-item>
            </el-collapse>
          </el-form>
        </div>
        <template #footer
          ><el-button @click="drawerVisible = false">{{ i18ns.t('cancel') }}</el-button
          ><el-button type="primary" :loading="submitting" @click="handleSubmit">{{
            i18ns.t('confirm')
          }}</el-button></template
        >
      </el-drawer>

      <el-dialog
        v-model="jsonDialogVisible"
        :title="i18ns.t('jsonEndpoint.viewJson')"
        :width="isDesktop ? '720px' : '94%'"
      >
        <pre class="json-endpoint-page__json">{{ formattedJson }}</pre>
        <template #footer
          ><el-button @click="jsonDialogVisible = false">{{ i18ns.t('close') }}</el-button
          ><el-button type="primary" @click="copyText(formattedJson)">{{
            i18ns.t('jsonEndpoint.copyJson')
          }}</el-button></template
        ></el-dialog
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ArrowRight,
  CopyDocument,
  EditPen,
  MoreFilled,
  Plus,
  Refresh,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { JsonEndpointDto } from '@/client/types.gen'
import JsonEditor from '@/components/editor/JsonEditor.vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import { jsonEndpointService } from '@/service/jsonEndpointService'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'

const { isDesktop } = usePageDevice()
const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()
const endpointList = ref<JsonEndpointDto[]>([])
const ownerOptions = ref<Array<{ id: string; username: string }>>([])
const ownerFilter = ref('')
const loading = ref(false)
const drawerVisible = ref(false)
const jsonDialogVisible = ref(false)
const formattedJson = ref('')
const isEdit = ref(false)
const submitting = ref(false)
const editingEndpointId = ref('')
const formRef = ref<FormInstance>()
const editDrawerSections = ref(['basic', 'access', 'content'])
const formData = reactive({
  name: '',
  slug: '',
  description: '',
  jsonContent: {} as unknown,
  isPublic: true,
  password: '',
  ownerUserId: '',
  isRootSlug: false,
})
const canManage = computed(() => permissionStore.hasPermission(Permission.JSON_ENDPOINT_MANAGE))
const canRootSlug = computed(() =>
  permissionStore.hasPermission(Permission.JSON_ENDPOINT_ROOT_SLUG),
)
const selectedOwner = computed(
  () =>
    ownerOptions.value.find((user) => user.id === formData.ownerUserId)?.username ||
    userInfoStore.userInfo.username,
)
const previewUrl = computed(() =>
  absoluteUrl(
    formData.isRootSlug
      ? `/v1/json/${formData.slug || 'slug'}`
      : `/v1/json/${selectedOwner.value || 'username'}/${formData.slug || 'slug'}`,
  ),
)
const formRules: FormRules = {
  name: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  slug: [
    { required: true, message: i18ns.t('required'), trigger: 'blur' },
    { pattern: /^[a-z0-9_-]+$/, message: i18ns.t('jsonEndpoint.slugHint'), trigger: 'blur' },
  ],
}
const absoluteUrl = (path: string) =>
  `${String(import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')}${path}`
const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(i18ns.t('copySuccess'))
  } catch {
    ElMessage.error(i18ns.t('copyFailed'))
  }
}
const copyUrl = (path: string) => copyText(absoluteUrl(path))
const openUrl = (url: string) => window.open(url, '_blank', 'noopener')
async function loadOwners() {
  if (!canManage.value) return
  ownerOptions.value = await jsonEndpointService.getOwnerOptions()
}
async function loadEndpoints() {
  loading.value = true
  try {
    endpointList.value = await jsonEndpointService.getEndpoints(ownerFilter.value || undefined)
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('loadFailed'))
  } finally {
    loading.value = false
  }
}
function handleCreate() {
  isEdit.value = false
  formData.ownerUserId = userInfoStore.userInfo.id
  drawerVisible.value = true
}
function handleEdit(row: JsonEndpointDto) {
  isEdit.value = true
  editingEndpointId.value = row.id
  Object.assign(formData, {
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    jsonContent: row.jsonContent,
    isPublic: row.isPublic,
    password: '',
    ownerUserId: row.userId,
    isRootSlug: row.isRootSlug,
  })
  drawerVisible.value = true
}
function handleViewJson(row: JsonEndpointDto) {
  formattedJson.value = JSON.stringify(row.jsonContent, null, 2)
  jsonDialogVisible.value = true
}
async function handleDelete(row: JsonEndpointDto) {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    await jsonEndpointService.deleteEndpoint(row.id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await loadEndpoints()
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.message || i18ns.t('deleteFailed'))
  }
}
function handleRowCommand(command: string, row: JsonEndpointDto) {
  if (command === 'view') handleViewJson(row)
  if (command === 'delete') void handleDelete(row)
}
async function handleSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    if (isEdit.value)
      await jsonEndpointService.updateEndpoint(editingEndpointId.value, {
        name: formData.name,
        description: formData.description || undefined,
        jsonContent: formData.jsonContent,
        isPublic: formData.isPublic,
        password: formData.password || undefined,
        isRootSlug: canRootSlug.value ? formData.isRootSlug : undefined,
      })
    else
      await jsonEndpointService.createEndpoint({
        name: formData.name,
        slug: formData.slug,
        description: formData.description || undefined,
        jsonContent: formData.jsonContent,
        isPublic: formData.isPublic,
        password: formData.isPublic ? undefined : formData.password,
        ownerUserId: canManage.value ? formData.ownerUserId : undefined,
        isRootSlug: canRootSlug.value ? formData.isRootSlug : undefined,
      })
    ElMessage.success(i18ns.t(isEdit.value ? 'updateSuccess' : 'createSuccess'))
    drawerVisible.value = false
    await loadEndpoints()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  } finally {
    submitting.value = false
  }
}
function resetForm() {
  Object.assign(formData, {
    name: '',
    slug: '',
    description: '',
    jsonContent: {},
    isPublic: true,
    password: '',
    ownerUserId: '',
    isRootSlug: false,
  })
  editingEndpointId.value = ''
  formRef.value?.resetFields()
}
onMounted(async () => {
  await Promise.all([loadOwners(), loadEndpoints()])
})
</script>

<style scoped>
.json-endpoint-management .card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.json-endpoint-page__heading,
.json-endpoint-page__toolbar-actions,
.json-endpoint-page__url {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.json-endpoint-page__toolbar-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.json-endpoint-page__toolbar-actions .el-select {
  width: 200px;
}

.json-endpoint-page__table {
  width: 100%;
}

.json-endpoint-page__url .el-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-endpoint-page__mobile-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.json-endpoint-mobile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 20px;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: color-mix(in srgb, var(--el-fill-color-light) 88%, transparent);
  color: var(--el-text-color-primary);
  text-align: left;
}

.json-endpoint-mobile-row span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.json-endpoint-mobile-row strong {
  font-size: 14px;
  font-weight: 600;
  word-break: break-word;
}

.json-endpoint-mobile-row small {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-endpoint-edit-form .el-form-item {
  margin-bottom: 18px;
}

.json-endpoint-edit-form .el-form-item__content {
  min-width: 0;
}

.json-endpoint-edit-form .el-input,
.json-endpoint-edit-form .el-select {
  width: 100%;
}

.json-endpoint-edit-dialog--desktop :deep(.el-drawer) {
  max-width: min(980px, calc(100vw - 64px));
  overflow: hidden;
  border-left: 1px solid var(--el-border-color-light);
  border-radius: 22px 0 0 22px;
  box-shadow: -28px 0 80px rgba(15, 23, 42, 0.18);
}

.json-endpoint-edit-dialog--desktop :deep(.el-drawer__header) {
  margin-bottom: 0;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-fill-color-light) 72%, transparent),
    color-mix(in srgb, var(--el-bg-color-overlay) 96%, transparent)
  );
}

.json-endpoint-edit-dialog--desktop :deep(.el-drawer__title) {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.json-endpoint-edit-dialog--desktop :deep(.el-drawer__body) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 24px 16px;
}

.json-endpoint-edit-dialog--desktop :deep(.el-drawer__footer) {
  display: flex !important;
  justify-content: flex-start !important;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-fill-color-light) 44%, transparent);
  text-align: left;
}

:deep(.json-endpoint-edit-dialog--desktop .el-drawer__footer) {
  display: flex !important;
  justify-content: flex-start !important;
  text-align: left;
}

.json-endpoint-edit-dialog--desktop :deep(.el-drawer__footer .el-button) {
  min-width: 108px;
}

.json-endpoint-edit-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}

.json-endpoint-edit-sections :deep(.el-collapse) {
  border-top: none;
  border-bottom: none;
}

.json-endpoint-edit-sections :deep(.el-collapse-item) {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  background: color-mix(in srgb, var(--el-bg-color-overlay) 94%, transparent);
}

.json-endpoint-edit-sections :deep(.el-collapse-item__header) {
  min-height: 54px;
  padding: 0 18px;
  border-bottom: none;
  background: color-mix(in srgb, var(--el-fill-color-light) 62%, transparent);
}

.json-endpoint-edit-sections :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.json-endpoint-edit-sections :deep(.el-collapse-item__content) {
  padding: 18px;
}

.json-endpoint-edit-sections__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.json-endpoint-edit-section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 16px;
}

.json-endpoint-edit-section-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-item-span-2 {
  grid-column: 1 / -1;
}

.json-endpoint-editor__url {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-endpoint-page__json {
  max-height: 60vh;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

@media (max-width: 768px) {
  .json-endpoint-management .card-header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .json-endpoint-page__toolbar-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }

  .json-endpoint-page__toolbar-actions .el-select,
  .json-endpoint-page__toolbar-actions .el-button:not(.is-circle) {
    width: 100%;
  }

  .json-endpoint-edit-dialog--mobile :deep(.el-drawer) {
    width: 100% !important;
    max-width: 100% !important;
    height: 100% !important;
    overflow: hidden;
    border-top: 1px solid var(--el-border-color);
    border-radius: 20px 20px 0 0;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--el-bg-color-overlay) 92%, transparent),
      color-mix(in srgb, var(--el-bg-color) 96%, transparent)
    );
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  }

  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__header),
  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__body),
  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__footer) {
    background: transparent;
  }

  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__header) {
    margin-bottom: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__body) {
    flex: 1;
    min-height: 0;
    padding: 14px 12px;
    overflow: auto;
  }

  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__footer) {
    display: flex !important;
    justify-content: flex-start !important;
    gap: 10px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  :deep(.json-endpoint-edit-dialog--mobile .el-drawer__footer) {
    display: flex !important;
    justify-content: flex-start !important;
    text-align: left;
  }

  .json-endpoint-edit-dialog--mobile :deep(.el-drawer__footer .el-button) {
    margin-left: 0 !important;
  }

  .json-endpoint-mobile .el-form-item__content {
    min-width: 0;
  }

  .json-endpoint-mobile .el-input,
  .json-endpoint-mobile .el-select {
    width: 100% !important;
  }

  .json-endpoint-edit-sections :deep(.el-collapse-item__header) {
    padding: 0 14px;
  }

  .json-endpoint-edit-sections :deep(.el-collapse-item__content) {
    padding: 14px;
  }

  .json-endpoint-edit-section-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .json-endpoint-edit-section-stack .el-form-item:last-child {
    margin-bottom: 0;
  }
}
</style>
