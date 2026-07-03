<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="json-endpoint-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('jsonEndpoint.management') }}</span>
            <div>
              <PermissionWrapper :require="[Permission.JSON_ENDPOINT_CREATE]">
                <el-button type="primary" @click="handleCreate" :icon="Plus">
                  {{ i18ns.t('jsonEndpoint.create') }}
                </el-button>
              </PermissionWrapper>
              <el-button @click="loadEndpoints" :icon="Refresh">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="endpointList" stripe border>
          <el-table-column prop="name" :label="i18ns.t('jsonEndpoint.name')" min-width="120" />
          <el-table-column
            prop="slug"
            :label="i18ns.t('jsonEndpoint.slug')"
            min-width="120"
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="description"
            :label="i18ns.t('jsonEndpoint.description')"
            min-width="150"
            class-name="hide-on-mobile"
          />
          <el-table-column :label="i18ns.t('jsonEndpoint.access')" min-width="100">
            <template #default="{ row }">
              <el-tag :type="row.isPublic ? 'success' : 'warning'">
                {{
                  row.isPublic ? i18ns.t('jsonEndpoint.public') : i18ns.t('jsonEndpoint.protected')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            prop="accessCount"
            :label="i18ns.t('jsonEndpoint.accessCount')"
            min-width="100"
            class-name="hide-on-mobile"
          />
          <el-table-column
            :label="i18ns.t('jsonEndpoint.url')"
            min-width="200"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <div class="url-cell">
                <span class="url-text">{{ getEndpointUrl(row.slug) }}</span>
                <el-button
                  link
                  type="primary"
                  :icon="CopyDocument"
                  @click="copyUrl(getEndpointUrl(row.slug))"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" fixed="right" width="240">
            <template #default="{ row }">
              <PermissionWrapper :require="[Permission.JSON_ENDPOINT_UPDATE]" mode="disabled">
                <el-button link type="primary" @click="handleEdit(row)">{{
                  i18ns.t('edit')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.JSON_ENDPOINT_READ]" mode="disabled">
                <el-button link type="primary" @click="handleViewJson(row)">
                  {{ i18ns.t('jsonEndpoint.viewJson') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.JSON_ENDPOINT_DELETE]" mode="disabled">
                <el-button link type="danger" @click="handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </PermissionWrapper>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Create/Edit Dialog -->
      <el-dialog
        v-model="dialogVisible"
        :title="isEdit ? i18ns.t('jsonEndpoint.edit') : i18ns.t('jsonEndpoint.create')"
        width="600px"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px">
          <el-form-item :label="i18ns.t('jsonEndpoint.name')" prop="name">
            <el-input v-model="formData.name" />
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.slug')" prop="slug">
            <el-input v-model="formData.slug" :disabled="isEdit" />
            <template #extra>
              <span class="form-hint">{{ i18ns.t('jsonEndpoint.slugHint') }}</span>
            </template>
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.description')" prop="description">
            <el-input v-model="formData.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.isPublic')" prop="isPublic">
            <el-switch v-model="formData.isPublic" />
            <template #extra>
              <span class="form-hint">
                {{
                  formData.isPublic
                    ? i18ns.t('jsonEndpoint.publicHint')
                    : i18ns.t('jsonEndpoint.protectedHint')
                }}
              </span>
            </template>
          </el-form-item>
          <el-form-item
            v-if="!formData.isPublic"
            :label="i18ns.t('jsonEndpoint.password')"
            prop="password"
          >
            <el-input
              v-model="formData.password"
              type="password"
              show-password
              :placeholder="
                isEdit
                  ? i18ns.t('jsonEndpoint.passwordPlaceholder')
                  : i18ns.t('jsonEndpoint.enterPassword')
              "
            />
            <template #extra>
              <span class="form-hint">{{ i18ns.t('jsonEndpoint.passwordHint') }}</span>
            </template>
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.jsonContent')" prop="jsonContent">
            <JsonEditor v-model="formData.jsonContent" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            {{ i18ns.t('confirm') }}
          </el-button>
        </template>
      </el-dialog>

      <!-- View JSON Dialog -->
      <el-dialog
        v-model="jsonDialogVisible"
        :title="i18ns.t('jsonEndpoint.viewJson')"
        width="600px"
      >
        <pre class="json-viewer">{{ formattedJson }}</pre>
        <template #footer>
          <el-button @click="jsonDialogVisible = false">{{ i18ns.t('close') }}</el-button>
          <el-button type="primary" @click="copyJson">
            {{ i18ns.t('jsonEndpoint.copyJson') }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
  <div v-else class="mobile-page">
    <div class="json-endpoint-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('jsonEndpoint.management') }}</span>
            <div class="header-actions">
              <PermissionWrapper :require="[Permission.JSON_ENDPOINT_CREATE]">
                <el-button type="primary" :icon="Plus" @click="handleCreate">
                  {{ i18ns.t('jsonEndpoint.create') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="loadEndpoints">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="endpointList.length" class="endpoint-list">
            <el-card
              v-for="row in endpointList"
              :key="row.id"
              class="endpoint-item mobile-card"
              shadow="never"
            >
              <div class="item-header">
                <div>
                  <div class="name">{{ row.name }}</div>
                  <div class="slug">/{{ row.slug }}</div>
                </div>
                <el-tag :type="row.isPublic ? 'success' : 'warning'" size="small">
                  {{
                    row.isPublic
                      ? i18ns.t('jsonEndpoint.public')
                      : i18ns.t('jsonEndpoint.protected')
                  }}
                </el-tag>
              </div>

              <div class="meta">
                <div>{{ i18ns.t('jsonEndpoint.description') }}: {{ row.description || '-' }}</div>
                <div>{{ i18ns.t('jsonEndpoint.accessCount') }}: {{ row.accessCount ?? 0 }}</div>
                <div class="url-row">
                  <span>{{ i18ns.t('jsonEndpoint.url') }}:</span>
                  <el-link type="primary" @click="copyUrl(getEndpointUrl(row.slug))">{{
                    getEndpointUrl(row.slug)
                  }}</el-link>
                </div>
              </div>

              <div class="actions">
                <PermissionWrapper :require="[Permission.JSON_ENDPOINT_UPDATE]" mode="disabled">
                  <el-button plain size="small" type="primary" @click="handleEdit(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.JSON_ENDPOINT_READ]" mode="disabled">
                  <el-button plain size="small" @click="handleViewJson(row)">{{
                    i18ns.t('jsonEndpoint.viewJson')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.JSON_ENDPOINT_DELETE]" mode="disabled">
                  <el-button plain size="small" type="danger" @click="handleDelete(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </PermissionWrapper>
              </div>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>
      </el-card>

      <el-dialog
        v-model="dialogVisible"
        :title="isEdit ? i18ns.t('jsonEndpoint.edit') : i18ns.t('jsonEndpoint.create')"
        width="96%"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-position="top">
          <el-form-item :label="i18ns.t('jsonEndpoint.name')" prop="name">
            <el-input v-model="formData.name" />
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.slug')" prop="slug">
            <el-input v-model="formData.slug" :disabled="isEdit" />
            <template #extra>
              <span class="form-hint">{{ i18ns.t('jsonEndpoint.slugHint') }}</span>
            </template>
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.description')" prop="description">
            <el-input v-model="formData.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.isPublic')" prop="isPublic">
            <el-switch v-model="formData.isPublic" />
          </el-form-item>
          <el-form-item
            v-if="!formData.isPublic"
            :label="i18ns.t('jsonEndpoint.password')"
            prop="password"
          >
            <el-input
              v-model="formData.password"
              type="password"
              show-password
              :placeholder="
                isEdit
                  ? i18ns.t('jsonEndpoint.passwordPlaceholder')
                  : i18ns.t('jsonEndpoint.enterPassword')
              "
            />
            <template #extra>
              <span class="form-hint">{{ i18ns.t('jsonEndpoint.passwordHint') }}</span>
            </template>
          </el-form-item>
          <el-form-item :label="i18ns.t('jsonEndpoint.jsonContent')" prop="jsonContent">
            <JsonEditor v-model="formData.jsonContent" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="jsonDialogVisible" :title="i18ns.t('jsonEndpoint.viewJson')" width="96%">
        <pre class="json-viewer">{{ formattedJson }}</pre>
        <template #footer>
          <el-button @click="jsonDialogVisible = false">{{ i18ns.t('close') }}</el-button>
          <el-button type="primary" @click="copyJson">{{
            i18ns.t('jsonEndpoint.copyJson')
          }}</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, reactive, onMounted } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { Plus, Refresh, CopyDocument } from '@element-plus/icons-vue'
import { jsonEndpointService } from '@/service/jsonEndpointService'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import JsonEditor from '@/components/editor/JsonEditor.vue'
import { Permission } from '@/constant/permission'

interface EndpointItem {
  id: string
  name: string
  slug: string
  description?: string
  jsonContent: any
  apiKey?: string
  isPublic: boolean
  accessCount: number
  lastAccessAt?: string
}

const endpointList = ref<EndpointItem[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const editingEndpointId = ref('')
const formRef = ref<FormInstance>()

const jsonDialogVisible = ref(false)
const formattedJson = ref('')

const formData = reactive({
  name: '',
  slug: '',
  description: '',
  jsonContent: {} as any,
  isPublic: true,
  password: '',
})

const formRules: FormRules = {
  name: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  slug: [
    { required: true, message: i18ns.t('required'), trigger: 'blur' },
    { pattern: /^[a-z0-9-_]+$/, message: i18ns.t('jsonEndpoint.slugHint'), trigger: 'blur' },
  ],
  jsonContent: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
}

const getEndpointUrl = (slug: string) => `${import.meta.env.VITE_BACKEND_URL}/json/${slug}`

const copyUrl = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success(i18ns.t('copySuccess'))
  } catch {
    ElMessage.error(i18ns.t('copyFailed'))
  }
}

const copyJson = async () => {
  try {
    await navigator.clipboard.writeText(formattedJson.value)
    ElMessage.success(i18ns.t('copySuccess'))
  } catch {
    ElMessage.error(i18ns.t('copyFailed'))
  }
}

const loadEndpoints = async () => {
  loading.value = true
  try {
    endpointList.value = await jsonEndpointService.getEndpoints()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('loadFailed'))
  } finally {
    loading.value = false
  }
}

const handleCreate = () => {
  isEdit.value = false
  dialogVisible.value = true
}

const handleEdit = (row: EndpointItem) => {
  isEdit.value = true
  editingEndpointId.value = row.id
  formData.name = row.name
  formData.slug = row.slug
  formData.description = row.description || ''
  formData.jsonContent = row.jsonContent
  formData.isPublic = row.isPublic
  formData.password = ''
  dialogVisible.value = true
}

const handleViewJson = (row: EndpointItem) => {
  formattedJson.value = JSON.stringify(row.jsonContent, null, 2)
  jsonDialogVisible.value = true
}

const handleDelete = async (row: EndpointItem) => {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), {
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'warning',
    })
    await jsonEndpointService.deleteEndpoint(row.id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await loadEndpoints()
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.message || i18ns.t('deleteFailed'))
  }
}

const handleSubmit = async () => {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  submitting.value = true
  try {
    if (isEdit.value) {
      const updateData: any = {
        name: formData.name,
        description: formData.description || undefined,
        jsonContent: formData.jsonContent,
        isPublic: formData.isPublic,
      }
      if (formData.password) updateData.password = formData.password
      await jsonEndpointService.updateEndpoint(editingEndpointId.value, updateData)
      ElMessage.success(i18ns.t('updateSuccess'))
    } else {
      await jsonEndpointService.createEndpoint({
        name: formData.name,
        slug: formData.slug,
        description: formData.description || undefined,
        jsonContent: formData.jsonContent,
        isPublic: formData.isPublic,
        password: formData.isPublic ? undefined : formData.password,
      })
      ElMessage.success(i18ns.t('createSuccess'))
    }
    dialogVisible.value = false
    await loadEndpoints()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  } finally {
    submitting.value = false
  }
}

const resetForm = () => {
  formData.name = ''
  formData.slug = ''
  formData.description = ''
  formData.jsonContent = {}
  formData.isPublic = true
  formData.password = ''
  editingEndpointId.value = ''
  formRef.value?.resetFields()
}

onMounted(() => {
  loadEndpoints()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
}

.url-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.url-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 12px;
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.json-viewer {
  background: var(--el-fill-color-light);
  padding: 16px;
  border-radius: 4px;
  max-height: 400px;
  overflow: auto;
  font-family: monospace;
  font-size: 12px;
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
}
</style>

<style scoped>
.json-endpoint-mobile {
  padding: 8px;
}

.json-endpoint-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.json-endpoint-mobile .card-title {
  font-size: 17px;
  font-weight: 600;
}

.json-endpoint-mobile .header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.json-endpoint-mobile .header-actions .el-button {
  flex: 1;
  min-height: 36px;
  margin-left: 0 !important;
}

.json-endpoint-mobile .endpoint-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.json-endpoint-mobile .endpoint-item {
  border: 1px solid var(--el-border-color-lighter);
}

.json-endpoint-mobile .item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.json-endpoint-mobile .name {
  font-weight: 600;
}

.json-endpoint-mobile .slug,
.json-endpoint-mobile .meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.json-endpoint-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.json-endpoint-mobile .url-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.json-endpoint-mobile .url-row :deep(.el-link) {
  word-break: break-all;
}

.json-endpoint-mobile .actions {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.json-endpoint-mobile .actions .el-button {
  width: 100%;
  min-height: 34px;
  margin-left: 0 !important;
}

@media (max-width: 420px) {
  .json-endpoint-mobile .actions {
    grid-template-columns: 1fr;
  }
}

.json-endpoint-mobile .form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.json-endpoint-mobile .json-viewer {
  background: var(--el-fill-color-light);
  padding: 12px;
  border-radius: 6px;
  max-height: 60vh;
  overflow: auto;
  font-family: monospace;
  font-size: 12px;
}

/* mobile dialog polish */
.json-endpoint-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.json-endpoint-mobile :deep(.el-dialog__header) {
  padding: 14px 14px 8px;
}

.json-endpoint-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.json-endpoint-mobile :deep(.el-dialog__footer) {
  padding: 8px 14px 14px;
}

.json-endpoint-mobile :deep(.el-dialog__footer .el-button) {
  min-height: 36px;
}

.json-endpoint-mobile :deep(.el-dialog__footer .el-button + .el-button) {
  margin-left: 8px !important;
}
</style>
