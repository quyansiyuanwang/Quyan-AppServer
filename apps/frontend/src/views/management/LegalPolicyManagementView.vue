<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="legal-policy-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <div class="toolbar-left">
              <span class="card-title">{{ i18ns.t('legalPolicy.management') }}</span>
              <el-radio-group v-model="selectedType" size="small">
                <el-radio-button label="terms_of_service" value="terms_of_service">
                  {{ i18ns.t('legalPolicy.policyTypeTerms') }}
                </el-radio-button>
                <el-radio-button label="privacy_policy" value="privacy_policy">
                  {{ i18ns.t('legalPolicy.policyTypePrivacy') }}
                </el-radio-button>
              </el-radio-group>
            </div>
            <div>
              <PermissionWrapper :require="[Permission.LEGAL_POLICY_CREATE]">
                <el-button type="primary" :icon="Plus" @click="handleCreate">
                  {{ i18ns.t('legalPolicy.create') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="loadPolicies">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="filteredPolicies" stripe border>
          <el-table-column prop="title" :label="i18ns.t('legalPolicy.title')" min-width="220">
            <template #default="{ row }">
              <div class="title-cell">
                <span>{{ row.title }}</span>
                <el-tag v-if="row.isCurrent" size="small" type="success">
                  {{ i18ns.t('legalPolicy.currentPublished') }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="version" :label="i18ns.t('legalPolicy.version')" width="100" />
          <el-table-column :label="i18ns.t('legalPolicy.publishStatus')" width="120">
            <template #default="{ row }">
              <el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'" size="small">
                {{
                  row.publishStatus === 'published'
                    ? i18ns.t('legalPolicy.published')
                    : i18ns.t('legalPolicy.draft')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            prop="summary"
            :label="i18ns.t('legalPolicy.summary')"
            min-width="220"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <span class="summary-text">{{ row.summary || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="updatedByName"
            :label="i18ns.t('legalPolicy.updatedBy')"
            min-width="120"
            class-name="hide-on-mobile"
          />
          <el-table-column
            :label="i18ns.t('legalPolicy.updateTime')"
            min-width="180"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">{{ formatDate(row.updateTime) }}</template>
          </el-table-column>
          <el-table-column
            :label="i18ns.t('legalPolicy.publishedAt')"
            min-width="180"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">{{ formatDate(row.publishedAt) }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" fixed="right" width="220">
            <template #default="{ row }">
              <PermissionWrapper :require="[Permission.LEGAL_POLICY_UPDATE]" mode="disabled">
                <el-button link type="primary" @click="handleEdit(row)">{{
                  i18ns.t('edit')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.LEGAL_POLICY_PUBLISH]" mode="disabled">
                <el-button
                  v-if="row.publishStatus !== 'published'"
                  link
                  type="success"
                  @click="handlePublish(row)"
                >
                  {{ i18ns.t('legalPolicy.publish') }}
                </el-button>
                <el-button v-else link type="warning" @click="handleUnpublish(row)">
                  {{ i18ns.t('legalPolicy.unpublish') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.LEGAL_POLICY_DELETE]" mode="disabled">
                <el-button link type="danger" @click="handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </PermissionWrapper>
            </template>
          </el-table-column>
        </el-table>

        <el-empty
          v-if="!loading && filteredPolicies.length === 0"
          :description="i18ns.t('legalPolicy.noPolicies')"
        />
      </el-card>

      <el-dialog
        v-model="dialogVisible"
        :title="isEdit ? i18ns.t('legalPolicy.edit') : i18ns.t('legalPolicy.create')"
        width="86%"
        top="4vh"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="i18ns.t('legalPolicy.policyType')" prop="policyType">
                <el-select v-model="formData.policyType" :disabled="isEdit" style="width: 100%">
                  <el-option
                    :label="i18ns.t('legalPolicy.policyTypeTerms')"
                    value="terms_of_service"
                  />
                  <el-option
                    :label="i18ns.t('legalPolicy.policyTypePrivacy')"
                    value="privacy_policy"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="i18ns.t('legalPolicy.title')" prop="title">
                <el-input v-model="formData.title" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item :label="i18ns.t('legalPolicy.summary')" prop="summary">
            <el-input v-model="formData.summary" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="i18ns.t('legalPolicy.content')" prop="content">
            <div class="editor-container">
              <div class="editor-toolbar">
                <el-button
                  :type="splitView ? 'primary' : 'default'"
                  size="small"
                  @click="splitView = !splitView"
                >
                  {{
                    splitView ? i18ns.t('legalPolicy.singleView') : i18ns.t('legalPolicy.splitView')
                  }}
                </el-button>
              </div>
              <div class="editor-body split-mode">
                <div class="editor-left">
                  <el-input
                    ref="textareaRef"
                    v-model="formData.content"
                    type="textarea"
                    :rows="22"
                    :placeholder="i18ns.t('legalPolicy.contentPlaceholder')"
                    class="markdown-editor"
                  />
                </div>
                <div v-show="splitView" ref="previewPaneRef" class="editor-right preview-pane">
                  <MarkdownRenderer :content="formData.content" />
                </div>
              </div>
            </div>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="handleCancel">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            {{ i18ns.t('confirm') }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>

  <div v-else class="mobile-page">
    <div class="legal-policy-management-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('legalPolicy.management') }}</span>
            <el-radio-group v-model="selectedType" size="small" class="type-switch-mobile">
              <el-radio-button label="terms_of_service" value="terms_of_service"
                >TOS</el-radio-button
              >
              <el-radio-button label="privacy_policy" value="privacy_policy">PP</el-radio-button>
            </el-radio-group>
            <div class="header-actions">
              <PermissionWrapper :require="[Permission.LEGAL_POLICY_CREATE]">
                <el-button type="primary" :icon="Plus" @click="handleCreate">
                  {{ i18ns.t('legalPolicy.create') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="loadPolicies">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <el-skeleton :loading="loading" :rows="6" animated>
          <div v-if="filteredPolicies.length" class="policy-list">
            <el-card
              v-for="row in filteredPolicies"
              :key="row.id"
              class="policy-item mobile-card"
              shadow="never"
            >
              <div class="item-header">
                <div class="title-wrap">
                  <span class="title">{{ row.title }}</span>
                  <el-tag v-if="row.isCurrent" size="small" type="success">
                    {{ i18ns.t('legalPolicy.currentPublished') }}
                  </el-tag>
                </div>
                <el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'" size="small">
                  {{
                    row.publishStatus === 'published'
                      ? i18ns.t('legalPolicy.published')
                      : i18ns.t('legalPolicy.draft')
                  }}
                </el-tag>
              </div>

              <div class="meta">
                <div>{{ i18ns.t('legalPolicy.version') }}: v{{ row.version }}</div>
                <div>{{ i18ns.t('legalPolicy.summary') }}: {{ row.summary || '-' }}</div>
                <div>{{ i18ns.t('legalPolicy.updatedBy') }}: {{ row.updatedByName || '-' }}</div>
                <div>{{ i18ns.t('legalPolicy.updateTime') }}: {{ formatDate(row.updateTime) }}</div>
              </div>

              <div class="actions">
                <PermissionWrapper :require="[Permission.LEGAL_POLICY_UPDATE]" mode="disabled">
                  <el-button plain size="small" type="primary" @click="handleEdit(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.LEGAL_POLICY_PUBLISH]" mode="disabled">
                  <el-button
                    v-if="row.publishStatus !== 'published'"
                    plain
                    size="small"
                    type="success"
                    @click="handlePublish(row)"
                  >
                    {{ i18ns.t('legalPolicy.publish') }}
                  </el-button>
                  <el-button v-else plain size="small" type="warning" @click="handleUnpublish(row)">
                    {{ i18ns.t('legalPolicy.unpublish') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.LEGAL_POLICY_DELETE]" mode="disabled">
                  <el-button plain size="small" type="danger" @click="handleDelete(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </PermissionWrapper>
              </div>
            </el-card>
          </div>
          <el-empty v-else :description="i18ns.t('legalPolicy.noPolicies')" />
        </el-skeleton>
      </el-card>

      <el-dialog
        v-model="dialogVisible"
        :title="isEdit ? i18ns.t('legalPolicy.edit') : i18ns.t('legalPolicy.create')"
        width="96%"
        top="3vh"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-position="top">
          <el-form-item :label="i18ns.t('legalPolicy.policyType')" prop="policyType">
            <el-select v-model="formData.policyType" :disabled="isEdit" style="width: 100%">
              <el-option :label="i18ns.t('legalPolicy.policyTypeTerms')" value="terms_of_service" />
              <el-option :label="i18ns.t('legalPolicy.policyTypePrivacy')" value="privacy_policy" />
            </el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('legalPolicy.title')" prop="title">
            <el-input v-model="formData.title" />
          </el-form-item>
          <el-form-item :label="i18ns.t('legalPolicy.summary')" prop="summary">
            <el-input v-model="formData.summary" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="i18ns.t('legalPolicy.content')" prop="content">
            <div class="editor-container">
              <el-tabs v-model="editorTab" class="editor-tabs">
                <el-tab-pane :label="i18ns.t('edit')" name="edit">
                  <el-input
                    v-model="formData.content"
                    type="textarea"
                    :rows="18"
                    :placeholder="i18ns.t('legalPolicy.contentPlaceholder')"
                    class="markdown-editor"
                  />
                </el-tab-pane>
                <el-tab-pane :label="i18ns.t('legalPolicy.previewMode')" name="preview">
                  <div class="preview-pane mobile-preview-pane">
                    <MarkdownRenderer :content="formData.content" />
                  </div>
                </el-tab-pane>
              </el-tabs>
            </div>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="handleCancel">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            {{ i18ns.t('confirm') }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules, InputInstance } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { legalPolicyService } from '@/service/legalPolicyService'
import type { LegalPolicyListItemDto, LegalPolicyType } from '@/client/types.gen'
import { getErrorMessage } from '@/utils/error-utils'

const loading = ref(false)
const submitting = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref('')
const selectedType = ref<LegalPolicyType>('terms_of_service')
const splitView = ref(true)
const editorTab = ref('edit')
const policyList = ref<LegalPolicyListItemDto[]>([])
const formRef = ref<FormInstance>()
const textareaRef = ref<InputInstance>()
const previewPaneRef = ref<HTMLDivElement>()

const filteredPolicies = computed(() =>
  policyList.value.filter((item) => item.policyType === selectedType.value),
)

const formData = reactive({
  policyType: 'terms_of_service' as LegalPolicyType,
  title: '',
  summary: '',
  content: '',
})

let isSyncScrolling = false

function syncScrollFromEditor() {
  if (!splitView.value || isSyncScrolling || !previewPaneRef.value) return
  const ta = textareaRef.value?.ref as HTMLTextAreaElement | undefined
  if (!ta) return
  isSyncScrolling = true
  const pct = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight)
  const pr = previewPaneRef.value
  pr.scrollTop = pct * (pr.scrollHeight - pr.clientHeight)
  requestAnimationFrame(() => {
    isSyncScrolling = false
  })
}

function syncScrollFromPreview() {
  if (!splitView.value || isSyncScrolling || !previewPaneRef.value) return
  const ta = textareaRef.value?.ref as HTMLTextAreaElement | undefined
  if (!ta) return
  isSyncScrolling = true
  const pr = previewPaneRef.value
  const pct = pr.scrollTop / Math.max(1, pr.scrollHeight - pr.clientHeight)
  ta.scrollTop = pct * (ta.scrollHeight - ta.clientHeight)
  requestAnimationFrame(() => {
    isSyncScrolling = false
  })
}

async function bindSplitScrollListeners() {
  if (!splitView.value) return
  await nextTick()
  const ta = (textareaRef.value as any)?.ref as HTMLTextAreaElement | undefined
  ta?.addEventListener('scroll', syncScrollFromEditor, { passive: true })
  previewPaneRef.value?.addEventListener('scroll', syncScrollFromPreview, { passive: true })
}

function unbindSplitScrollListeners() {
  const ta = (textareaRef.value as any)?.ref as HTMLTextAreaElement | undefined
  ta?.removeEventListener('scroll', syncScrollFromEditor)
  previewPaneRef.value?.removeEventListener('scroll', syncScrollFromPreview)
}

watch(splitView, async (enabled) => {
  unbindSplitScrollListeners()
  if (enabled) {
    await bindSplitScrollListeners()
  }
})

watch(dialogVisible, async (visible) => {
  if (!visible) {
    unbindSplitScrollListeners()
    return
  }
  if (splitView.value) {
    await bindSplitScrollListeners()
  }
})

const formRules = reactive<FormRules>({
  policyType: [
    { required: true, message: () => i18ns.t('legalPolicy.policyTypeRequired'), trigger: 'change' },
  ],
  title: [{ required: true, message: () => i18ns.t('legalPolicy.titleRequired'), trigger: 'blur' }],
  content: [
    { required: true, message: () => i18ns.t('legalPolicy.contentRequired'), trigger: 'blur' },
  ],
})

function formatDate(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

async function loadPolicies() {
  loading.value = true
  try {
    policyList.value = await legalPolicyService.listPolicies()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('legalPolicy.listLoadFailed')))
  } finally {
    loading.value = false
  }
}

function handleCreate() {
  resetForm()
  isEdit.value = false
  editingId.value = ''
  formData.policyType = selectedType.value
  splitView.value = true
  editorTab.value = 'edit'
  dialogVisible.value = true
}

async function handleEdit(row: LegalPolicyListItemDto) {
  resetForm()
  isEdit.value = true
  editingId.value = row.id
  splitView.value = true
  editorTab.value = 'edit'
  dialogVisible.value = true

  try {
    const detail = await legalPolicyService.getPolicy(row.id)
    formData.policyType = detail.policyType
    formData.title = detail.title
    formData.summary = detail.summary || ''
    formData.content = detail.content
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('legalPolicy.detailLoadFailed')))
  }
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const data = {
      policyType: formData.policyType,
      title: formData.title,
      summary: formData.summary || undefined,
      content: formData.content,
    }

    if (isEdit.value) {
      await legalPolicyService.updatePolicy(editingId.value, {
        title: data.title,
        summary: data.summary,
        content: data.content,
      })
      ElMessage.success(i18ns.t('legalPolicy.updateSuccess'))
    } else {
      await legalPolicyService.createPolicy(data)
      ElMessage.success(i18ns.t('legalPolicy.createSuccess'))
    }

    dialogVisible.value = false
    await loadPolicies()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    submitting.value = false
  }
}

async function handlePublish(row: LegalPolicyListItemDto) {
  try {
    await ElMessageBox.confirm(i18ns.t('legalPolicy.publishConfirm'), i18ns.t('confirm'), {
      type: 'warning',
    })
    await legalPolicyService.publishPolicy(row.id)
    ElMessage.success(i18ns.t('legalPolicy.publishSuccess'))
    await loadPolicies()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    }
  }
}

async function handleUnpublish(row: LegalPolicyListItemDto) {
  try {
    await ElMessageBox.confirm(i18ns.t('legalPolicy.unpublishConfirm'), i18ns.t('confirm'), {
      type: 'warning',
    })
    await legalPolicyService.unpublishPolicy(row.id)
    ElMessage.success(i18ns.t('legalPolicy.unpublishSuccess'))
    await loadPolicies()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    }
  }
}

async function handleDelete(row: LegalPolicyListItemDto) {
  try {
    await ElMessageBox.confirm(i18ns.t('legalPolicy.deleteConfirm'), i18ns.t('confirm'), {
      type: 'warning',
    })
    await legalPolicyService.deletePolicy(row.id)
    ElMessage.success(i18ns.t('legalPolicy.deleteSuccess'))
    await loadPolicies()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    }
  }
}

function handleCancel() {
  dialogVisible.value = false
}

function resetForm() {
  formData.policyType = selectedType.value
  formData.title = ''
  formData.summary = ''
  formData.content = ''
  formRef.value?.resetFields()
}

onMounted(() => {
  loadPolicies()
})

onBeforeUnmount(() => {
  unbindSplitScrollListeners()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.legal-policy-management {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
}

.title-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-text {
  display: inline-block;
  max-width: 100%;
  color: var(--el-text-color-secondary);
}

.editor-container {
  width: 100%;
}

.editor-toolbar {
  margin-bottom: 4px;
  display: flex;
  justify-content: flex-end;
}

.editor-body.split-mode {
  display: flex;
  gap: 12px;
}

.editor-left {
  flex: 1;
  min-width: 0;
}

.editor-left :deep(.el-textarea__inner) {
  height: 520px;
  resize: none;
}

.editor-right {
  flex: 1;
  min-width: 0;
}

.markdown-editor :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
}

.preview-pane {
  height: 520px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-bg-color);
}

.preview-pane::-webkit-scrollbar {
  width: 4px;
}

.preview-pane::-webkit-scrollbar-track {
  background: transparent;
}

.preview-pane::-webkit-scrollbar-thumb {
  background: var(--el-border-color);
  border-radius: 4px;
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
}
</style>

<style scoped>
.legal-policy-management-mobile {
  padding: 8px;
}

.legal-policy-management-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legal-policy-management-mobile .card-title {
  font-size: 17px;
  font-weight: 600;
}

.type-switch-mobile {
  align-self: flex-start;
}

.legal-policy-management-mobile .header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.legal-policy-management-mobile .header-actions .el-button {
  flex: 1;
  min-height: 36px;
  margin-left: 0 !important;
}

.legal-policy-management-mobile .policy-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legal-policy-management-mobile .policy-item {
  border: 1px solid var(--el-border-color-lighter);
}

.legal-policy-management-mobile .item-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.legal-policy-management-mobile .title-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
  flex-wrap: wrap;
}

.legal-policy-management-mobile .title {
  font-weight: 600;
  word-break: break-word;
}

.legal-policy-management-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.legal-policy-management-mobile .actions {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.legal-policy-management-mobile .actions .el-button {
  width: 100%;
  min-height: 34px;
  margin-left: 0 !important;
}

@media (max-width: 420px) {
  .legal-policy-management-mobile .actions {
    grid-template-columns: 1fr;
  }
}

.mobile-preview-pane {
  max-height: 48vh;
  height: auto;
}

.legal-policy-management-mobile .markdown-editor :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.legal-policy-management-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.legal-policy-management-mobile :deep(.el-dialog__header) {
  padding: 14px 14px 8px;
}

.legal-policy-management-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.legal-policy-management-mobile :deep(.el-dialog__footer) {
  padding: 8px 14px 14px;
}
</style>
