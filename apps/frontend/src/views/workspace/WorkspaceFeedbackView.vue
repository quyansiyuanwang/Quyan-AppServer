<template>
  <div class="workspace-feedback-view page-shell">
    <el-card v-if="!isLoggedIn" class="page-card login-card" shadow="never">
      <template #header>
        <div class="card-header-block">
          <div class="card-title">{{ i18ns.t('feedback.loginRequiredTitle') }}</div>
          <div class="card-description">{{ i18ns.t('feedback.loginRequiredDescription') }}</div>
        </div>
      </template>
      <el-button type="primary" @click="goToLogin">{{ i18ns.t('feedback.loginAction') }}</el-button>
    </el-card>

    <div v-else-if="permissionReady" class="feedback-layout">
      <el-card
        v-if="canShowForm"
        class="page-card feedback-card feedback-card--form"
        shadow="never"
      >
        <template #header>
          <div class="card-header-block">
            <div class="card-title">
              {{
                isEditing
                  ? i18ns.t('feedback.updateSectionTitle')
                  : i18ns.t('feedback.submitSectionTitle')
              }}
            </div>
            <div class="card-description">
              {{
                isEditing
                  ? i18ns.t('feedback.updateSectionDescription')
                  : i18ns.t('feedback.submitSectionDescription')
              }}
            </div>
          </div>
        </template>

        <el-alert
          v-if="isEditing && editingLocked"
          :title="i18ns.t('feedback.terminalLocked')"
          type="warning"
          show-icon
          :closable="false"
          class="section-alert"
        />

        <el-form
          ref="feedbackFormRef"
          :model="feedbackForm"
          :rules="feedbackFormRules"
          label-position="top"
        >
          <div class="form-grid">
            <el-form-item :label="i18ns.t('feedback.type')" prop="type">
              <el-select v-model="feedbackForm.type">
                <el-option
                  v-for="type in feedbackTypeOptions"
                  :key="type"
                  :label="getTypeLabel(type)"
                  :value="type"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('feedback.contactInfo')" prop="contactInfo">
              <el-input
                v-model="feedbackForm.contactInfo"
                :maxlength="200"
                :placeholder="i18ns.t('feedback.contactInfoPlaceholder')"
                clearable
              />
            </el-form-item>

            <el-form-item class="form-grid__full" :label="i18ns.t('feedback.title')" prop="title">
              <el-input
                v-model="feedbackForm.title"
                :maxlength="200"
                :placeholder="i18ns.t('feedback.titlePlaceholder')"
                clearable
              />
            </el-form-item>

            <el-form-item
              class="form-grid__full"
              :label="i18ns.t('feedback.description')"
              prop="description"
            >
              <el-input
                v-model="feedbackForm.description"
                type="textarea"
                :rows="5"
                :maxlength="5000"
                show-word-limit
                :placeholder="i18ns.t('feedback.descriptionPlaceholder')"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('feedback.sourcePage')" prop="sourcePage">
              <el-input
                v-model="feedbackForm.sourcePage"
                :maxlength="500"
                :placeholder="i18ns.t('feedback.sourcePagePlaceholder')"
                clearable
              />
            </el-form-item>

            <el-form-item
              class="form-grid__full"
              :label="i18ns.t('feedback.reproduceSteps')"
              prop="reproduceSteps"
            >
              <el-input
                v-model="feedbackForm.reproduceSteps"
                type="textarea"
                :rows="4"
                :maxlength="5000"
                show-word-limit
                :placeholder="i18ns.t('feedback.reproduceStepsPlaceholder')"
              />
            </el-form-item>
          </div>

          <div class="form-actions">
            <el-button @click="resetFeedbackForm">{{ i18ns.t('reset') }}</el-button>
            <el-button v-if="isEditing" @click="cancelEditing">{{
              i18ns.t('feedback.cancelEdit')
            }}</el-button>
            <el-button
              type="primary"
              :loading="feedbackSubmitting"
              :disabled="isEditing && editingLocked"
              @click="submitFeedbackForm"
            >
              {{ isEditing ? i18ns.t('feedback.saveUpdate') : i18ns.t('feedback.submitAction') }}
            </el-button>
          </div>
        </el-form>
      </el-card>

      <el-card
        v-if="canReadFeedback"
        class="page-card feedback-card feedback-card--list"
        shadow="never"
      >
        <template #header>
          <div class="card-header-row">
            <div class="card-header-block">
              <div class="card-title">{{ i18ns.t('feedback.listSectionTitle') }}</div>
              <div class="card-description">{{ i18ns.t('feedback.listSectionDescription') }}</div>
            </div>
            <el-button :loading="listLoading" @click="loadMyFeedbackList">{{
              i18ns.t('refresh')
            }}</el-button>
          </div>
        </template>

        <div class="list-card-shell">
          <div class="filter-row">
            <el-input
              v-model="filters.keyword"
              :placeholder="i18ns.t('feedback.keywordPlaceholder')"
              clearable
              @keyup.enter="handleSearch"
              @clear="handleSearch"
            />
            <el-select v-model="filters.workflowStatus" clearable @change="handleSearch">
              <el-option :label="i18ns.t('feedback.allStatuses')" value="" />
              <el-option
                v-for="status in workflowStatusOptions"
                :key="status"
                :label="getStatusLabel(status)"
                :value="status"
              />
            </el-select>
            <el-select v-model="filters.type" clearable @change="handleSearch">
              <el-option :label="i18ns.t('feedback.allTypes')" value="" />
              <el-option
                v-for="type in feedbackTypeOptions"
                :key="type"
                :label="getTypeLabel(type)"
                :value="type"
              />
            </el-select>
            <div class="filter-actions">
              <el-button type="primary" @click="handleSearch">{{ i18ns.t('search') }}</el-button>
              <el-button @click="resetFilters">{{ i18ns.t('reset') }}</el-button>
            </div>
          </div>

          <div class="list-card-content">
            <el-table
              v-if="isDesktop"
              v-loading="listLoading"
              :data="feedbackList"
              class="feedback-table"
            >
              <el-table-column prop="title" :label="i18ns.t('feedback.title')" min-width="220">
                <template #default="{ row }">
                  <div class="table-title">{{ row.title }}</div>
                  <div class="table-subtitle">{{ formatDateTime(row.createTime) }}</div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('feedback.type')" width="120">
                <template #default="{ row }">
                  <el-tag :type="getTypeTagType(row.type)" effect="light">{{
                    getTypeLabel(row.type)
                  }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('feedback.workflowStatus')" width="140">
                <template #default="{ row }">
                  <el-tag :type="getStatusTagType(row.workflowStatus)" effect="light">
                    {{ getStatusLabel(row.workflowStatus) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('feedback.priority')" width="120">
                <template #default="{ row }">
                  <el-tag :type="getPriorityTagType(row.priority)" effect="light">
                    {{ getPriorityLabel(row.priority) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('feedback.lastReplyAt')" width="180">
                <template #default="{ row }">
                  {{ formatDateTime(row.lastReplyAt) }}
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="190" fixed="right">
                <template #default="{ row }">
                  <div class="row-actions">
                    <el-button link type="primary" @click="openFeedbackDetail(row.id)">
                      {{ i18ns.t('feedback.viewDetail') }}
                    </el-button>
                    <el-button
                      v-if="canUpdateFeedback && !isTerminalStatus(row.workflowStatus)"
                      link
                      @click="startEditingByRow(row.id)"
                    >
                      {{ i18ns.t('edit') }}
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>

            <div v-else class="mobile-card-list" v-loading="listLoading">
              <el-empty
                v-if="!feedbackList.length && !listLoading"
                :description="i18ns.t('feedback.emptyState')"
              />
              <el-card
                v-for="item in feedbackList"
                :key="item.id"
                class="mobile-feedback-card"
                shadow="never"
              >
                <div class="mobile-feedback-card__header">
                  <div>
                    <div class="mobile-feedback-card__title">{{ item.title }}</div>
                    <div class="table-subtitle">{{ formatDateTime(item.createTime) }}</div>
                  </div>
                  <el-tag :type="getStatusTagType(item.workflowStatus)" effect="light">
                    {{ getStatusLabel(item.workflowStatus) }}
                  </el-tag>
                </div>
                <div class="mobile-feedback-card__meta">
                  <el-tag :type="getTypeTagType(item.type)" effect="light">{{
                    getTypeLabel(item.type)
                  }}</el-tag>
                  <el-tag :type="getPriorityTagType(item.priority)" effect="light">
                    {{ getPriorityLabel(item.priority) }}
                  </el-tag>
                </div>
                <div class="mobile-feedback-card__actions">
                  <el-button type="primary" plain @click="openFeedbackDetail(item.id)">
                    {{ i18ns.t('feedback.viewDetail') }}
                  </el-button>
                  <el-button
                    v-if="canUpdateFeedback && !isTerminalStatus(item.workflowStatus)"
                    @click="startEditingByRow(item.id)"
                  >
                    {{ i18ns.t('edit') }}
                  </el-button>
                </div>
              </el-card>
            </div>

            <el-empty
              v-if="isDesktop && !listLoading && !feedbackList.length"
              :description="i18ns.t('feedback.emptyState')"
            />
          </div>

          <div class="pagination-wrapper">
            <el-pagination
              v-model:current-page="pagination.page"
              v-model:page-size="pagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="pagination.total"
              layout="total, sizes, prev, pager, next"
              @current-change="loadMyFeedbackList"
              @size-change="handlePageSizeChange"
            />
          </div>
        </div>
      </el-card>

      <el-card v-if="!canShowForm && !canReadFeedback" class="page-card" shadow="never">
        <el-empty :description="i18ns.t('permissionText.noPermissions')" />
      </el-card>
    </div>

    <el-skeleton v-else animated :rows="8" class="feedback-skeleton" />

    <el-drawer v-model="detailVisible" :title="drawerTitle" :size="drawerSize">
      <div v-loading="detailLoading" class="detail-drawer">
        <template v-if="selectedDetail">
          <div class="detail-header-tags">
            <el-tag :type="getTypeTagType(selectedDetail.type)" effect="light">{{
              getTypeLabel(selectedDetail.type)
            }}</el-tag>
            <el-tag :type="getStatusTagType(selectedDetail.workflowStatus)" effect="light">
              {{ getStatusLabel(selectedDetail.workflowStatus) }}
            </el-tag>
            <el-tag :type="getPriorityTagType(selectedDetail.priority)" effect="light">
              {{ getPriorityLabel(selectedDetail.priority) }}
            </el-tag>
          </div>

          <el-descriptions :column="isDesktop ? 2 : 1" border class="detail-descriptions">
            <el-descriptions-item :label="i18ns.t('feedback.submitter')">
              {{ selectedDetail.username || selectedDetail.userId }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.assignee')">
              {{ selectedDetail.assigneeUsername || i18ns.t('feedback.unassigned') }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.createTime')">
              {{ formatDateTime(selectedDetail.createTime) }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.updateTime')">
              {{ formatDateTime(selectedDetail.updateTime) }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.lastReplyAt')">
              {{ formatDateTime(selectedDetail.lastReplyAt) }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.sourcePage')">
              <span class="wrap-text">{{ selectedDetail.sourcePage || '-' }}</span>
            </el-descriptions-item>
            <el-descriptions-item
              class-name="description-cell"
              :label="i18ns.t('feedback.description')"
            >
              <div class="wrap-text">{{ selectedDetail.description }}</div>
            </el-descriptions-item>
            <el-descriptions-item
              class-name="description-cell"
              :label="i18ns.t('feedback.reproduceSteps')"
            >
              <div class="wrap-text">{{ selectedDetail.reproduceSteps || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item
              class-name="description-cell"
              :label="i18ns.t('feedback.contactInfo')"
            >
              <div class="wrap-text">{{ selectedDetail.contactInfo || '-' }}</div>
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-toolbar">
            <el-button @click="reloadCurrentDetail">{{ i18ns.t('refresh') }}</el-button>
            <el-button
              v-if="canUpdateFeedback && !isTerminalStatus(selectedDetail.workflowStatus)"
              type="primary"
              plain
              @click="startEditingFromDetail"
            >
              {{ i18ns.t('feedback.fillCurrentDetail') }}
            </el-button>
          </div>

          <el-alert
            :title="i18ns.t('feedback.publicRepliesOnly')"
            type="info"
            show-icon
            :closable="false"
            class="section-alert"
          />

          <el-card v-if="canCommentOnDetail" shadow="never" class="comment-editor-card">
            <template #header>
              <div class="card-header-block">
                <div class="card-title">{{ i18ns.t('feedback.replyTitle') }}</div>
                <div class="card-description">{{ i18ns.t('feedback.replyDescription') }}</div>
              </div>
            </template>
            <el-input
              v-model="commentDraft"
              type="textarea"
              :rows="4"
              :maxlength="5000"
              show-word-limit
              :placeholder="i18ns.t('feedback.commentPlaceholder')"
            />
            <div class="form-actions">
              <el-button @click="commentDraft = ''">{{ i18ns.t('reset') }}</el-button>
              <el-button type="primary" :loading="commentSubmitting" @click="submitComment">
                {{ i18ns.t('feedback.postReply') }}
              </el-button>
            </div>
          </el-card>

          <div class="timeline-section">
            <div class="timeline-section__title">{{ i18ns.t('feedback.comments') }}</div>
            <el-empty
              v-if="!selectedDetail.comments.length"
              :description="i18ns.t('feedback.emptyComments')"
            />
            <el-timeline v-else>
              <el-timeline-item
                v-for="comment in selectedDetail.comments"
                :key="comment.id"
                :timestamp="formatDateTime(comment.createTime)"
                type="primary"
              >
                <div class="timeline-item-title">
                  {{ comment.authorUsername || comment.authorUserId }}
                </div>
                <div class="timeline-item-content">{{ comment.content }}</div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { i18ns } from '@/locales'
import { feedbackService } from '@/service/feedbackService'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { getErrorMessage } from '@/utils/error-utils'
import { getLoginRoute } from '@/utils/auth-routes'
import { usePageDevice } from '@/composables/usePageDevice'
import { useFloatingWorkspaceStore } from '@/stores/floatingWorkspaceStore'
import router from '@/router'
import type {
  CreateFeedbackDto,
  FeedbackDetailDto,
  FeedbackListItemDto,
  FeedbackPriority,
  FeedbackType,
  FeedbackWorkflowStatus,
  UpdateMyFeedbackDto,
} from '@/client/types.gen'

type FeedbackFormModel = {
  type: FeedbackType
  title: string
  description: string
  sourcePage: string
  reproduceSteps: string
  contactInfo: string
}

const createDefaultFeedbackForm = (): FeedbackFormModel => ({
  type: 'suggestion',
  title: '',
  description: '',
  sourcePage: '',
  reproduceSteps: '',
  contactInfo: '',
})

const route = useRoute()
const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()
const floatingWorkspaceStore = useFloatingWorkspaceStore()
const { isDesktop } = usePageDevice()

const feedbackTypeOptions: FeedbackType[] = ['suggestion', 'bug', 'other']
const workflowStatusOptions: FeedbackWorkflowStatus[] = [
  'pending',
  'processing',
  'accepted',
  'rejected',
  'completed',
]

const feedbackFormRef = ref<FormInstance>()
const permissionReady = ref(false)
const feedbackSubmitting = ref(false)
const listLoading = ref(false)
const detailLoading = ref(false)
const commentSubmitting = ref(false)
const feedbackList = ref<FeedbackListItemDto[]>([])
const selectedDetail = ref<FeedbackDetailDto | null>(null)
const detailVisible = ref(false)
const editingId = ref<string | null>(null)
const commentDraft = ref('')

const feedbackForm = reactive<FeedbackFormModel>(createDefaultFeedbackForm())
const filters = reactive({
  keyword: '',
  workflowStatus: '' as '' | FeedbackWorkflowStatus,
  type: '' as '' | FeedbackType,
})
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
})

const isLoggedIn = computed(() => userInfoStore.isLoggedIn())
const isEmbeddedPage = computed(() => String(route.query.embed ?? '') === '1')
const canSubmitFeedback = computed(() => permissionStore.hasPermission(Permission.FEEDBACK_SUBMIT))
const canReadFeedback = computed(() => permissionStore.hasPermission(Permission.FEEDBACK_SELF_READ))
const canUpdateFeedback = computed(() =>
  permissionStore.hasPermission(Permission.FEEDBACK_SELF_UPDATE),
)
const canCommentFeedback = computed(() =>
  permissionStore.hasPermission(Permission.FEEDBACK_COMMENT),
)
const canShowForm = computed(
  () => canSubmitFeedback.value || (isEditing.value && canUpdateFeedback.value),
)
const isEditing = computed(() => Boolean(editingId.value))
const editingLocked = computed(
  () => Boolean(selectedDetail.value) && isTerminalStatus(selectedDetail.value!.workflowStatus),
)
const canCommentOnDetail = computed(
  () =>
    Boolean(selectedDetail.value) &&
    canCommentFeedback.value &&
    !isTerminalStatus(selectedDetail.value!.workflowStatus),
)
const drawerTitle = computed(
  () => selectedDetail.value?.title || i18ns.t('feedback.detailSectionTitle'),
)
const drawerSize = computed(() => (isDesktop.value ? '56%' : '92%'))

const feedbackFormRules: FormRules<FeedbackFormModel> = {
  type: [{ required: true, message: i18ns.t('required'), trigger: 'change' }],
  title: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  description: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
}

function isTerminalStatus(status?: FeedbackWorkflowStatus) {
  return status === 'rejected' || status === 'completed'
}

function getTypeLabel(type: FeedbackType) {
  return i18ns.t(`feedback.types.${type}`)
}

function getStatusLabel(status: FeedbackWorkflowStatus) {
  return i18ns.t(`feedback.statuses.${status}`)
}

function getPriorityLabel(priority: FeedbackPriority) {
  return i18ns.t(`feedback.priorities.${priority}`)
}

function getTypeTagType(type: FeedbackType) {
  switch (type) {
    case 'suggestion':
      return 'primary'
    case 'bug':
      return 'danger'
    default:
      return 'info'
  }
}

function getStatusTagType(status: FeedbackWorkflowStatus) {
  switch (status) {
    case 'processing':
      return 'warning'
    case 'accepted':
    case 'completed':
      return 'success'
    case 'rejected':
      return 'danger'
    default:
      return 'info'
  }
}

function getPriorityTagType(priority: FeedbackPriority) {
  switch (priority) {
    case 'urgent':
    case 'high':
      return 'danger'
    case 'medium':
      return 'warning'
    default:
      return 'info'
  }
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-'
}

function normalizeOptionalCreateField(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeOptionalUpdateField(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

function resetFeedbackForm() {
  Object.assign(feedbackForm, createDefaultFeedbackForm())
  void nextTick(() => feedbackFormRef.value?.clearValidate())
}

function applyDetailToForm(detail: FeedbackDetailDto) {
  feedbackForm.type = detail.type
  feedbackForm.title = detail.title
  feedbackForm.description = detail.description
  feedbackForm.sourcePage = detail.sourcePage || ''
  feedbackForm.reproduceSteps = detail.reproduceSteps || ''
  feedbackForm.contactInfo = detail.contactInfo || ''
}

function buildCreatePayload(): CreateFeedbackDto {
  return {
    type: feedbackForm.type,
    title: feedbackForm.title.trim(),
    description: feedbackForm.description.trim(),
    sourcePage: normalizeOptionalCreateField(feedbackForm.sourcePage),
    reproduceSteps: normalizeOptionalCreateField(feedbackForm.reproduceSteps),
    contactInfo: normalizeOptionalCreateField(feedbackForm.contactInfo),
  }
}

function buildUpdatePayload(): UpdateMyFeedbackDto {
  return {
    type: feedbackForm.type,
    title: feedbackForm.title.trim(),
    description: feedbackForm.description.trim(),
    sourcePage: normalizeOptionalUpdateField(feedbackForm.sourcePage),
    reproduceSteps: normalizeOptionalUpdateField(feedbackForm.reproduceSteps),
    contactInfo: normalizeOptionalUpdateField(feedbackForm.contactInfo),
  }
}

async function loadMyFeedbackList() {
  if (!canReadFeedback.value) return

  listLoading.value = true
  try {
    const result = await feedbackService.listMyFeedback({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filters.keyword.trim() || undefined,
      workflowStatus: filters.workflowStatus || undefined,
      type: filters.type || undefined,
    })
    feedbackList.value = result.data.items
    pagination.total = result.data.total
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.loadListFailed')))
  } finally {
    listLoading.value = false
  }
}

async function loadFeedbackDetail(id: string) {
  detailLoading.value = true
  try {
    const result = await feedbackService.getMyFeedbackDetail(id)
    selectedDetail.value = result.data
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.loadDetailFailed')))
  } finally {
    detailLoading.value = false
  }
}

async function openFeedbackDetail(id: string) {
  detailVisible.value = true
  await loadFeedbackDetail(id)
}

async function reloadCurrentDetail() {
  if (!selectedDetail.value) return
  await loadFeedbackDetail(selectedDetail.value.id)
  await loadMyFeedbackList()
}

async function submitFeedbackForm() {
  if (!feedbackFormRef.value) return

  try {
    await feedbackFormRef.value.validate()
    feedbackSubmitting.value = true

    if (editingId.value) {
      const result = await feedbackService.updateMyFeedback(editingId.value, buildUpdatePayload())
      selectedDetail.value = result.data
      ElMessage.success(i18ns.t('message.information.saveSuccess'))
      await loadMyFeedbackList()
      if (detailVisible.value) {
        await loadFeedbackDetail(editingId.value)
      }
    } else {
      const result = await feedbackService.createFeedback(buildCreatePayload())
      ElMessage.success(i18ns.t('message.information.createSuccess'))
      resetFeedbackForm()
      pagination.page = 1
      await loadMyFeedbackList()
      if (result.data?.id) {
        await openFeedbackDetail(result.data.id)
      }
    }

    cancelEditing()
  } catch (error) {
    ElMessage.error(
      getErrorMessage(
        error,
        i18ns.t(isEditing.value ? 'feedback.updateFailed' : 'feedback.submitFailed'),
      ),
    )
  } finally {
    feedbackSubmitting.value = false
  }
}

function cancelEditing() {
  editingId.value = null
  resetFeedbackForm()
}

async function startEditingByRow(id: string) {
  try {
    const result = await feedbackService.getMyFeedbackDetail(id)
    editingId.value = id
    selectedDetail.value = result.data
    applyDetailToForm(result.data)
    await nextTick()
    feedbackFormRef.value?.clearValidate()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.loadDetailFailed')))
  }
}

function startEditingFromDetail() {
  if (!selectedDetail.value) return
  editingId.value = selectedDetail.value.id
  applyDetailToForm(selectedDetail.value)
  void nextTick(() => feedbackFormRef.value?.clearValidate())
}

async function submitComment() {
  if (!selectedDetail.value) return

  const content = commentDraft.value.trim()
  if (!content) {
    ElMessage.error(i18ns.t('required'))
    return
  }

  commentSubmitting.value = true
  try {
    await feedbackService.addMyComment(selectedDetail.value.id, { content })
    commentDraft.value = ''
    ElMessage.success(i18ns.t('message.information.saveSuccess'))
    await loadFeedbackDetail(selectedDetail.value.id)
    await loadMyFeedbackList()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.commentFailed')))
  } finally {
    commentSubmitting.value = false
  }
}

async function handleSearch() {
  pagination.page = 1
  await loadMyFeedbackList()
}

function resetFilters() {
  filters.keyword = ''
  filters.workflowStatus = ''
  filters.type = ''
  void handleSearch()
}

async function handlePageSizeChange() {
  pagination.page = 1
  await loadMyFeedbackList()
}

function goToLogin() {
  if (isEmbeddedPage.value && typeof window !== 'undefined') {
    floatingWorkspaceStore.hide()
    const loginRoute = router.resolve(getLoginRoute('/workspace/suggestions'))
    const topWindow = window.top && window.top !== window ? window.top : window
    topWindow.location.assign(loginRoute.href)
    return
  }

  void router.push(getLoginRoute(route.fullPath))
}

async function initPage() {
  if (!isLoggedIn.value) {
    permissionReady.value = true
    return
  }

  try {
    await permissionStore.untilReady()
  } finally {
    permissionReady.value = true
  }

  if (canReadFeedback.value) {
    await loadMyFeedbackList()
  }
}

onMounted(() => {
  void initPage()
})
</script>

<style scoped>
.workspace-feedback-view {
  display: grid;
  gap: 18px;
}

.hero-card,
.page-card {
  border-radius: 18px;
  height: 100%;
}

.hero-card {
  display: grid;
  gap: 12px;
  padding: 24px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-bg-color) 98%, transparent),
    var(--el-fill-color-blank)
  );
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
}

.hero-card__eyebrow,
.card-description,
.table-subtitle {
  color: var(--el-text-color-secondary);
}

.hero-card__eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero-card h1,
.hero-card p,
.card-title,
.card-description {
  margin: 0;
}

.hero-card h1 {
  font-size: clamp(28px, 3vw, 36px);
}

.hero-card p {
  max-width: 780px;
  line-height: 1.7;
}

.hero-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feedback-layout {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(360px, 0.92fr) minmax(0, 1.48fr);
  align-items: start;
  height: 95vh;
  min-height: 0;
}

.feedback-card {
  overflow: hidden;
}

.feedback-card--form {
  position: sticky;
  top: 0;
}

.feedback-card--form :deep(.el-card__body),
.feedback-card--list :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.feedback-card--form :deep(.el-card__body) {
  gap: 16px;
}

.feedback-card--list {
  height: 100%;
}

.feedback-card--list :deep(.el-card__body) {
  height: 100%;
}

.list-card-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 16px;
}

.list-card-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.card-header-block {
  display: grid;
  gap: 4px;
}

.card-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
}

.section-alert {
  margin-bottom: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.form-grid__full {
  grid-column: 1 / -1;
}

.form-actions,
.filter-actions,
.detail-toolbar,
.mobile-feedback-card__actions,
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.form-actions {
  margin-top: 8px;
  justify-content: flex-end;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) repeat(2, minmax(140px, 180px)) auto;
  gap: 12px;
  margin-bottom: 16px;
}

.table-title {
  font-weight: 600;
}

.mobile-card-list {
  display: grid;
  gap: 12px;
}

.mobile-feedback-card {
  border-radius: 16px;
}

.mobile-feedback-card__header,
.mobile-feedback-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mobile-feedback-card__header {
  margin-bottom: 10px;
}

.mobile-feedback-card__title {
  font-size: 15px;
  font-weight: 600;
}

.mobile-feedback-card__meta {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.detail-drawer {
  display: grid;
  gap: 18px;
}

.detail-header-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-toolbar {
  justify-content: flex-end;
}

.wrap-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

.comment-editor-card,
.detail-descriptions {
  border-radius: 16px;
}

.timeline-section {
  display: grid;
  gap: 12px;
}

.timeline-section__title,
.timeline-item-title {
  font-weight: 600;
}

.timeline-item-content {
  margin-top: 6px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.feedback-skeleton {
  padding: 24px;
  border-radius: 18px;
  background: var(--el-bg-color);
}

@media (max-width: 1100px) {
  .feedback-layout {
    grid-template-columns: 1fr;
    height: auto;
  }

  .feedback-card--form {
    position: static;
  }

  .feedback-card--list {
    height: auto;
  }

  .list-card-content {
    overflow: visible;
    padding-right: 0;
  }
}

@media (max-width: 768px) {
  .hero-card,
  .page-card {
    border-radius: 16px;
  }

  .filter-row,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .card-header-row {
    flex-direction: column;
    align-items: stretch;
  }

  .pagination-wrapper {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
