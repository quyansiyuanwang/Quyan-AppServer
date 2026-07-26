<template>
  <div v-if="isDesktop" class="desktop-page page-shell">
    <div class="article-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('article.management') }}</span>
            <div>
              <PermissionWrapper :require="[Permission.ARTICLE_CREATE]">
                <el-button type="primary" @click="handleCreate" :icon="Plus">
                  {{ i18ns.t('article.create') }}
                </el-button>
              </PermissionWrapper>
              <el-button @click="loadArticles" :icon="Refresh">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <el-table
          ref="tableRef"
          v-loading="loading"
          :data="articleList"
          :row-key="'id'"
          stripe
          border
        >
          <el-table-column width="48" align="center" class-name="drag-col">
            <template #header>
              <span class="drag-handle-icon">⠿</span>
            </template>
            <template #default>
              <span class="drag-handle">⠿</span>
            </template>
          </el-table-column>
          <el-table-column prop="title" :label="i18ns.t('article.title')" min-width="180">
            <template #default="{ row }">
              <el-icon
                v-if="row.isDefault"
                style="color: var(--el-color-warning); margin-right: 4px; vertical-align: middle"
                ><StarFilled
              /></el-icon>
              {{ row.title }}
            </template>
          </el-table-column>
          <el-table-column
            prop="slug"
            :label="i18ns.t('article.slug')"
            min-width="120"
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="category"
            :label="i18ns.t('article.category')"
            min-width="100"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <template v-if="row.category">
                <el-tag
                  v-for="cat in row.category.split(',')"
                  :key="cat"
                  size="small"
                  style="margin-right: 4px"
                  >{{ cat.trim() }}</el-tag
                >
              </template>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('article.publishStatus')" min-width="100">
            <template #default="{ row }">
              <el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'" size="small">
                {{
                  row.publishStatus === 'published'
                    ? i18ns.t('article.published')
                    : i18ns.t('article.draft')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            prop="authorName"
            :label="i18ns.t('article.author')"
            min-width="100"
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="viewCount"
            :label="i18ns.t('article.viewCount')"
            min-width="80"
            class-name="hide-on-mobile"
          />
          <el-table-column
            :label="i18ns.t('article.createTime')"
            min-width="160"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              {{ formatDate(row.createTime) }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" fixed="right" width="280">
            <template #default="{ row }">
              <PermissionWrapper :require="[Permission.ARTICLE_UPDATE]" mode="disabled">
                <el-button link type="primary" @click="handleEdit(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.ARTICLE_UPDATE]" mode="disabled">
                <el-button
                  v-if="!row.isDefault && row.publishStatus === 'published'"
                  link
                  type="warning"
                  :icon="Star"
                  @click="handleSetDefault(row)"
                >
                  {{ i18ns.t('article.setDefault') }}
                </el-button>
                <el-button
                  v-else-if="row.isDefault"
                  link
                  type="info"
                  :icon="StarFilled"
                  @click="handleClearDefault()"
                >
                  {{ i18ns.t('article.clearDefault') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.ARTICLE_PUBLISH]" mode="disabled">
                <el-button
                  v-if="row.publishStatus !== 'published'"
                  link
                  type="success"
                  @click="handlePublish(row)"
                >
                  {{ i18ns.t('article.publish') }}
                </el-button>
                <el-button v-else link type="warning" @click="handleUnpublish(row)">
                  {{ i18ns.t('article.unpublish') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.ARTICLE_DELETE]" mode="disabled">
                <el-button link type="danger" @click="handleDelete(row)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </PermissionWrapper>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Create/Edit Dialog -->
      <el-dialog
        v-model="dialogVisible"
        :title="isEdit ? i18ns.t('article.edit') : i18ns.t('article.create')"
        width="80%"
        top="5vh"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="i18ns.t('article.title')" prop="title">
                <el-input v-model="formData.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="i18ns.t('article.slug')" prop="slug">
                <el-input v-model="formData.slug" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="i18ns.t('article.category')" prop="categories">
                <el-input-tag
                  v-model="formData.categories"
                  :placeholder="i18ns.t('article.addCategory')"
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="i18ns.t('article.isPublic')" prop="isPublic">
                <el-switch v-model="formData.isPublic" />
                <template #extra>
                  <span class="form-hint">{{ i18ns.t('article.isPublicHint') }}</span>
                </template>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="20">
            <el-col :span="24">
              <el-form-item :label="i18ns.t('article.requirePermission')" prop="requirePermissions">
                <el-select
                  v-model="formData.requirePermissions"
                  multiple
                  filterable
                  clearable
                  :disabled="formData.isPublic"
                  :placeholder="i18ns.t('article.requirePermissionHint')"
                  style="width: 100%"
                >
                  <el-option
                    v-for="perm in allPermissions"
                    :key="perm"
                    :label="permissionOptionLabel(perm)"
                    :value="perm"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item :label="i18ns.t('article.summary')" prop="summary">
            <el-input v-model="formData.summary" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="i18ns.t('article.content')" prop="content">
            <div class="editor-container">
              <div class="editor-toolbar">
                <el-button
                  :type="splitView ? 'primary' : 'default'"
                  size="small"
                  @click="splitView = !splitView"
                >
                  {{ splitView ? i18ns.t('article.singleView') : i18ns.t('article.splitView') }}
                </el-button>
              </div>
              <!-- Single view: tabbed editor / preview -->
              <template v-if="!splitView">
                <el-tabs v-model="editorTab" class="editor-tabs">
                  <el-tab-pane :label="i18ns.t('edit')" name="edit">
                    <el-input
                      ref="textareaRef"
                      v-model="formData.content"
                      type="textarea"
                      :rows="20"
                      :placeholder="i18ns.t('article.contentPlaceholder')"
                      class="markdown-editor"
                    />
                  </el-tab-pane>
                  <el-tab-pane :label="i18ns.t('article.previewMode')" name="preview">
                    <div class="preview-pane">
                      <MarkdownRenderer :content="formData.content" />
                    </div>
                  </el-tab-pane>
                </el-tabs>
              </template>
              <!-- Split view: side by side with sync scroll -->
              <div v-else class="editor-body split-mode">
                <div class="editor-left">
                  <el-input
                    ref="textareaRef"
                    v-model="formData.content"
                    type="textarea"
                    :rows="20"
                    :placeholder="i18ns.t('article.contentPlaceholder')"
                    class="markdown-editor"
                  />
                </div>
                <div ref="previewPaneRef" class="editor-right preview-pane">
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
    <div class="article-management-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('article.management') }}</span>
            <div class="header-actions">
              <PermissionWrapper :require="[Permission.ARTICLE_CREATE]">
                <el-button type="primary" :icon="Plus" @click="handleCreate">
                  {{ i18ns.t('article.create') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="loadArticles">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <el-skeleton :loading="loading" :rows="6" animated>
          <div v-if="articleList.length" class="article-list">
            <el-card
              v-for="row in articleList"
              :key="row.id"
              class="article-item mobile-card"
              shadow="never"
            >
              <div class="item-header">
                <div class="title-wrap">
                  <el-icon v-if="row.isDefault" class="default-icon"><StarFilled /></el-icon>
                  <span class="title">{{ row.title }}</span>
                </div>
                <el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'" size="small">
                  {{
                    row.publishStatus === 'published'
                      ? i18ns.t('article.published')
                      : i18ns.t('article.draft')
                  }}
                </el-tag>
              </div>

              <div class="meta">
                <div>{{ i18ns.t('article.slug') }}: {{ row.slug }}</div>
                <div>{{ i18ns.t('article.category') }}: {{ row.category || '-' }}</div>
                <div>{{ i18ns.t('article.author') }}: {{ row.authorName || '-' }}</div>
                <div>{{ i18ns.t('article.viewCount') }}: {{ row.viewCount ?? 0 }}</div>
                <div>{{ i18ns.t('article.createTime') }}: {{ formatDate(row.createTime) }}</div>
              </div>

              <div class="actions">
                <PermissionWrapper :require="[Permission.ARTICLE_UPDATE]" mode="disabled">
                  <el-button plain size="small" type="primary" @click="handleEdit(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.ARTICLE_PUBLISH]" mode="disabled">
                  <el-button
                    v-if="row.publishStatus !== 'published'"
                    plain
                    size="small"
                    type="success"
                    @click="handlePublish(row)"
                  >
                    {{ i18ns.t('article.publish') }}
                  </el-button>
                  <el-button v-else plain size="small" type="warning" @click="handleUnpublish(row)">
                    {{ i18ns.t('article.unpublish') }}
                  </el-button>
                </PermissionWrapper>
              </div>

              <div class="actions actions-second">
                <PermissionWrapper :require="[Permission.ARTICLE_UPDATE]" mode="disabled">
                  <el-button
                    v-if="!row.isDefault && row.publishStatus === 'published'"
                    plain
                    size="small"
                    type="warning"
                    @click="handleSetDefault(row)"
                  >
                    {{ i18ns.t('article.setDefault') }}
                  </el-button>
                  <el-button
                    v-else-if="row.isDefault"
                    plain
                    size="small"
                    @click="handleClearDefault"
                  >
                    {{ i18ns.t('article.clearDefault') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.ARTICLE_DELETE]" mode="disabled">
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
        :title="isEdit ? i18ns.t('article.edit') : i18ns.t('article.create')"
        width="96%"
        top="3vh"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-position="top">
          <el-form-item :label="i18ns.t('article.title')" prop="title">
            <el-input v-model="formData.title" />
          </el-form-item>
          <el-form-item :label="i18ns.t('article.slug')" prop="slug">
            <el-input v-model="formData.slug" />
          </el-form-item>
          <el-form-item :label="i18ns.t('article.category')" prop="categories">
            <el-input-tag
              v-model="formData.categories"
              :placeholder="i18ns.t('article.addCategory')"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('article.isPublic')" prop="isPublic">
            <el-switch v-model="formData.isPublic" />
            <template #extra>
              <span class="form-hint">{{ i18ns.t('article.isPublicHint') }}</span>
            </template>
          </el-form-item>
          <el-form-item :label="i18ns.t('article.requirePermission')" prop="requirePermissions">
            <el-select
              v-model="formData.requirePermissions"
              multiple
              filterable
              clearable
              :disabled="formData.isPublic"
              :placeholder="i18ns.t('article.requirePermissionHint')"
              style="width: 100%"
            >
              <el-option
                v-for="perm in allPermissions"
                :key="perm"
                :label="permissionOptionLabel(perm)"
                :value="perm"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('article.summary')" prop="summary">
            <el-input v-model="formData.summary" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="i18ns.t('article.content')" prop="content">
            <div class="editor-container">
              <el-tabs v-model="editorTab" class="editor-tabs">
                <el-tab-pane :label="i18ns.t('edit')" name="edit">
                  <el-input
                    v-model="formData.content"
                    type="textarea"
                    :rows="18"
                    :placeholder="i18ns.t('article.contentPlaceholder')"
                    class="markdown-editor"
                  />
                </el-tab-pane>
                <el-tab-pane :label="i18ns.t('article.previewMode')" name="preview">
                  <div class="preview-pane">
                    <MarkdownRenderer :content="formData.content" />
                  </div>
                </el-tab-pane>
              </el-tabs>
            </div>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="handleCancel">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, reactive, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules, InputInstance } from 'element-plus'
import { Plus, Refresh, Star, StarFilled } from '@element-plus/icons-vue'
import Sortable from 'sortablejs'
import { i18ns } from '@/locales'
import { Permission, ALL_PERMISSIONS, getPermissionLabel } from '@/constant/permission'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { articleService } from '@/service/articleService'
import type { ArticleListItemDto } from '@/client/types.gen'

const loading = ref(false)
const submitting = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref('')
const splitView = ref(false)
const editorTab = ref('edit')
const articleList = ref<ArticleListItemDto[]>([])
const formRef = ref<FormInstance>()
const textareaRef = ref<InputInstance>()
const previewPaneRef = ref<HTMLDivElement>()
const tableRef = ref<any>()
const allPermissions = ALL_PERMISSIONS
const permissionOptionLabel = (permission: Permission) =>
  `${getPermissionLabel(permission, i18ns.locale)} (${permission})`
let sortableInstance: Sortable | null = null

function initSortable() {
  if (!tableRef.value) return
  const tbody = tableRef.value.$el?.querySelector('.el-table__body-wrapper tbody')
  if (!tbody) return
  sortableInstance?.destroy()
  sortableInstance = Sortable.create(tbody, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    onEnd: async ({ newIndex, oldIndex }) => {
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      // Mutate the array in-place so Vue does a key-based diff instead of full re-render
      const [moved] = articleList.value.splice(oldIndex, 1)
      articleList.value.splice(newIndex, 0, moved!)
      articleList.value.forEach((item, idx) => {
        item.sortOrder = idx
      })
      await nextTick()
      initSortable()
      try {
        await articleService.reorderArticles(
          articleList.value.map(({ id, sortOrder }) => ({ id, sortOrder })),
        )
        ElMessage.success(i18ns.t('article.reorderSuccess'))
      } catch (e: any) {
        ElMessage.error(e.message || 'Failed to reorder')
        await loadArticles()
      }
    },
  })
}

const formData = reactive({
  title: '',
  slug: '',
  categories: [] as string[],
  summary: '',
  content: '',
  isPublic: false,
  requirePermissions: [] as string[],
})

watch(
  () => formData.isPublic,
  (isPublic) => {
    if (isPublic) {
      formData.requirePermissions = []
    }
  },
)

// Sync scroll between editor and preview in split view
let isSyncScrolling = false

function syncScrollFromEditor() {
  if (isSyncScrolling || !previewPaneRef.value) return
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
  if (isSyncScrolling || !previewPaneRef.value) return
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

watch(splitView, async (val) => {
  if (!val) return
  await nextTick()
  const ta = (textareaRef.value as any)?.ref as HTMLTextAreaElement | undefined
  if (ta) ta.addEventListener('scroll', syncScrollFromEditor, { passive: true })
  if (previewPaneRef.value) {
    previewPaneRef.value.addEventListener('scroll', syncScrollFromPreview, { passive: true })
  }
})

const formRules = reactive<FormRules>({
  title: [{ required: true, message: () => i18ns.t('article.titleRequired'), trigger: 'blur' }],
  slug: [{ required: true, message: () => i18ns.t('article.slugRequired'), trigger: 'blur' }],
  content: [{ required: true, message: () => i18ns.t('article.contentRequired'), trigger: 'blur' }],
})

function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

async function loadArticles() {
  loading.value = true
  try {
    articleList.value = await articleService.listArticles()
    await nextTick()
    initSortable()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to load articles')
  } finally {
    loading.value = false
  }
}

function handleCreate() {
  isEdit.value = false
  editingId.value = ''
  splitView.value = false
  handleReset()
  dialogVisible.value = true
}

function handleReset() {
  resetForm()
  editorTab.value = 'edit'
}

function handleCancel() {
  dialogVisible.value = false
  handleReset()
}

async function handleEdit(row: ArticleListItemDto) {
  handleReset()
  isEdit.value = true
  editingId.value = row.id
  splitView.value = false
  dialogVisible.value = true
  try {
    const article = await articleService.getArticle(row.id)
    formData.title = article.title
    formData.slug = article.slug
    formData.categories = article.category
      ? article.category
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : []
    formData.summary = article.summary || ''
    formData.content = article.content
    formData.isPublic = article.isPublic
    formData.requirePermissions = article.requirePermission
      ? article.requirePermission
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : []
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to load article')
  }
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const data = {
      title: formData.title,
      slug: formData.slug,
      category: formData.categories.length > 0 ? formData.categories.join(',') : undefined,
      summary: formData.summary || undefined,
      content: formData.content,
      isPublic: formData.isPublic,
      requirePermission: formData.isPublic
        ? undefined
        : formData.requirePermissions.length > 0
          ? formData.requirePermissions.join(',')
          : undefined,
    }
    if (isEdit.value) {
      await articleService.updateArticle(editingId.value, data)
      ElMessage.success(i18ns.t('article.updateSuccess'))
    } else {
      await articleService.createArticle(data as any)
      ElMessage.success(i18ns.t('article.createSuccess'))
    }
    dialogVisible.value = false
    editorTab.value = 'edit'
    await loadArticles()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to save article')
  } finally {
    submitting.value = false
    handleReset()
  }
}

async function handleSetDefault(row: ArticleListItemDto) {
  try {
    await articleService.setDefaultArticle(row.id)
    ElMessage.success(i18ns.t('article.setDefaultSuccess'))
    await loadArticles()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to set default')
  }
}

async function handleClearDefault() {
  try {
    await articleService.clearDefaultArticle()
    ElMessage.success(i18ns.t('article.clearDefaultSuccess'))
    await loadArticles()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to clear default')
  }
}

async function handlePublish(row: ArticleListItemDto) {
  try {
    await articleService.publishArticle(row.id)
    ElMessage.success(i18ns.t('article.publishSuccess'))
    await loadArticles()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to publish')
  }
}

async function handleUnpublish(row: ArticleListItemDto) {
  try {
    await articleService.unpublishArticle(row.id)
    ElMessage.success(i18ns.t('article.unpublishSuccess'))
    await loadArticles()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to unpublish')
  }
}

async function handleDelete(row: ArticleListItemDto) {
  try {
    await ElMessageBox.confirm(i18ns.t('article.deleteConfirm'), i18ns.t('confirm'), {
      type: 'warning',
    })
    await articleService.deleteArticle(row.id)
    ElMessage.success(i18ns.t('article.deleteSuccess'))
    await loadArticles()
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || 'Failed to delete')
    }
  }
}

function resetForm() {
  formData.title = ''
  formData.slug = ''
  formData.categories = []
  formData.summary = ''
  formData.content = ''
  formData.isPublic = false
  formData.requirePermissions = []
  formRef.value?.resetFields()
}

onMounted(() => {
  loadArticles()
})

onBeforeUnmount(() => {
  sortableInstance?.destroy()
  sortableInstance = null
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.article-management {
  width: 100%;
  min-width: 0;
}

.article-management :deep(.el-table__header),
.article-management :deep(.el-table__body) {
  width: 100% !important;
  table-layout: fixed;
}

.article-management :deep(.el-table__inner-wrapper),
.article-management :deep(.el-table__body-wrapper) {
  width: 100%;
}

.article-management :deep(.el-table .cell) {
  word-break: break-word;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
}

.text-muted {
  color: var(--el-text-color-placeholder);
}

.editor-container {
  width: 100%;
}

.editor-toolbar {
  margin-bottom: 4px;
  display: flex;
  justify-content: flex-end;
}

.editor-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

.editor-body.split-mode {
  display: flex;
  gap: 12px;
}

.editor-body.split-mode .editor-left {
  flex: 1;
  min-width: 0;
}

.editor-body.split-mode .editor-left :deep(.el-textarea__inner) {
  height: 475px;
  resize: none;
}

.editor-body.split-mode .editor-right {
  flex: 1;
  min-width: 0;
}

.markdown-editor :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
}

.preview-pane {
  height: 475px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-bg-color);
  scrollbar-width: thin;
  scrollbar-color: var(--el-border-color) transparent;
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

.preview-pane::-webkit-scrollbar-thumb:hover {
  background: var(--el-border-color-darker);
}

.drag-handle {
  cursor: grab;
  color: var(--el-text-color-placeholder);
  font-size: 16px;
  user-select: none;
  display: inline-block;
  padding: 0 4px;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle-icon {
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}

:deep(.sortable-ghost) {
  opacity: 0.4;
  background: var(--el-color-primary-light-9);
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
}
</style>

<style scoped>
.article-management-mobile {
  padding: 8px;
}

.article-management-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.article-management-mobile .card-title {
  font-size: 17px;
  font-weight: 600;
}

.article-management-mobile .header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.article-management-mobile .header-actions .el-button {
  flex: 1;
  min-height: 36px;
  margin-left: 0 !important;
}

.article-management-mobile .article-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.article-management-mobile .article-item {
  border: 1px solid var(--el-border-color-lighter);
}

.article-management-mobile .item-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.article-management-mobile .title-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
}

.article-management-mobile .default-icon {
  color: var(--el-color-warning);
}

.article-management-mobile .title {
  font-weight: 600;
  word-break: break-word;
}

.article-management-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.article-management-mobile .actions {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.article-management-mobile .actions .el-button {
  width: 100%;
  min-height: 34px;
  margin-left: 0 !important;
}

@media (max-width: 420px) {
  .article-management-mobile .actions {
    grid-template-columns: 1fr;
  }
}

.article-management-mobile .editor-container {
  width: 100%;
}

.article-management-mobile .preview-pane {
  max-height: 48vh;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.article-management-mobile .markdown-editor :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
}

/* mobile dialog polish */
.article-management-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.article-management-mobile :deep(.el-dialog__header) {
  padding: 14px 14px 8px;
}

.article-management-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.article-management-mobile :deep(.el-dialog__footer) {
  padding: 8px 14px 14px;
}

.article-management-mobile :deep(.el-dialog__footer .el-button) {
  min-height: 36px;
}

.article-management-mobile :deep(.el-dialog__footer .el-button + .el-button) {
  margin-left: 8px !important;
}
</style>
