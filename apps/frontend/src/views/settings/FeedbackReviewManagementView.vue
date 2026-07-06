<template>
  <div class="feedback-review-view page-shell">
    <el-card class="page-card" shadow="never">
      <template #header>
        <div class="card-header-row">
          <div class="card-header-block">
            <div class="card-title">{{ i18ns.t('feedback.reviewTitle') }}</div>
            <div class="card-description">{{ i18ns.t('feedback.reviewDescription') }}</div>
          </div>
          <div class="header-actions">
            <el-button v-if="canReviewUpdate" @click="openAssignmentDrawer">
              {{ i18ns.t('feedback.assignmentRulesAction') }}
            </el-button>
            <el-button :loading="listLoading" @click="loadReviewList">{{
              i18ns.t('refresh')
            }}</el-button>
          </div>
        </div>
      </template>

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
        <el-select v-model="filters.priority" clearable @change="handleSearch">
          <el-option :label="i18ns.t('feedback.allPriorities')" value="" />
          <el-option
            v-for="priority in priorityOptions"
            :key="priority"
            :label="getPriorityLabel(priority)"
            :value="priority"
          />
        </el-select>
        <el-select
          v-model="filters.assigneeUserId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="handleUserSearch"
          :loading="userOptionsLoading"
          @visible-change="handleUserSelectVisible"
          @change="handleSearch"
        >
          <el-option :label="i18ns.t('feedback.anyAssignee')" value="" />
          <el-option
            v-for="user in userOptions"
            :key="user.id"
            :label="user.username"
            :value="user.id"
          />
        </el-select>
        <div class="filter-actions">
          <el-button type="primary" @click="handleSearch">{{ i18ns.t('search') }}</el-button>
          <el-button @click="resetFilters">{{ i18ns.t('reset') }}</el-button>
        </div>
      </div>

      <el-table v-loading="listLoading" :data="items" class="feedback-table">
        <el-table-column prop="title" :label="i18ns.t('feedback.title')" min-width="220">
          <template #default="{ row }">
            <div class="table-title">{{ row.title }}</div>
            <div class="table-subtitle">
              {{ row.username || row.userId }} · {{ formatDateTime(row.createTime) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('feedback.type')" width="120">
          <template #default="{ row }">
            <el-tag :type="getTypeTagType(row.type)" effect="light">{{
              getTypeLabel(row.type)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('feedback.workflowStatus')" width="130">
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
        <el-table-column :label="i18ns.t('feedback.assignee')" width="150">
          <template #default="{ row }">
            {{ row.assigneeUsername || i18ns.t('feedback.unassigned') }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('feedback.lastReplyAt')" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.lastReplyAt) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="200" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="primary" @click="openDetail(row.id)">
                {{ i18ns.t('feedback.viewDetail') }}
              </el-button>
              <el-button v-if="canReviewUpdate" link type="danger" @click="handleDelete(row.id)">
                {{ i18ns.t('delete') }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!listLoading && !items.length"
        :description="i18ns.t('feedback.emptyState')"
      />

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadReviewList"
          @size-change="handlePageSizeChange"
        />
      </div>
    </el-card>

    <el-drawer v-model="detailVisible" :title="detailTitle" :size="drawerSize">
      <div v-loading="detailLoading" class="detail-drawer">
        <template v-if="detail">
          <div class="detail-header-tags">
            <el-tag :type="getTypeTagType(detail.type)" effect="light">{{
              getTypeLabel(detail.type)
            }}</el-tag>
            <el-tag :type="getStatusTagType(detail.workflowStatus)" effect="light">{{
              getStatusLabel(detail.workflowStatus)
            }}</el-tag>
            <el-tag :type="getPriorityTagType(detail.priority)" effect="light">{{
              getPriorityLabel(detail.priority)
            }}</el-tag>
          </div>

          <el-descriptions :column="isDesktop ? 2 : 1" border>
            <el-descriptions-item :label="i18ns.t('feedback.submitter')">
              {{ detail.username || detail.userId }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.assignee')">
              {{ detail.assigneeUsername || i18ns.t('feedback.unassigned') }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.createTime')">
              {{ formatDateTime(detail.createTime) }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.updateTime')">
              {{ formatDateTime(detail.updateTime) }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.lastReplyAt')">
              {{ formatDateTime(detail.lastReplyAt) }}
            </el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('feedback.contactInfo')">
              <span class="wrap-text">{{ detail.contactInfo || '-' }}</span>
            </el-descriptions-item>
            <el-descriptions-item
              class-name="description-cell"
              :label="i18ns.t('feedback.sourcePage')"
            >
              <div class="wrap-text">{{ detail.sourcePage || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item
              class-name="description-cell"
              :label="i18ns.t('feedback.description')"
            >
              <div class="wrap-text">{{ detail.description }}</div>
            </el-descriptions-item>
            <el-descriptions-item
              class-name="description-cell"
              :label="i18ns.t('feedback.reproduceSteps')"
            >
              <div class="wrap-text">{{ detail.reproduceSteps || '-' }}</div>
            </el-descriptions-item>
          </el-descriptions>

          <el-card v-if="canReviewUpdate" shadow="never" class="page-card review-panel">
            <template #header>
              <div class="card-header-block">
                <div class="card-title">{{ i18ns.t('feedback.reviewPanelTitle') }}</div>
                <div class="card-description">{{ i18ns.t('feedback.reviewPanelDescription') }}</div>
              </div>
            </template>

            <el-form label-position="top">
              <div class="form-grid">
                <el-form-item :label="i18ns.t('feedback.workflowStatus')">
                  <el-select v-model="reviewForm.workflowStatus" clearable>
                    <el-option
                      v-for="status in workflowStatusOptions"
                      :key="status"
                      :label="getStatusLabel(status)"
                      :value="status"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item :label="i18ns.t('feedback.priority')">
                  <el-select v-model="reviewForm.priority" clearable>
                    <el-option
                      v-for="priority in priorityOptions"
                      :key="priority"
                      :label="getPriorityLabel(priority)"
                      :value="priority"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item class="form-grid__full" :label="i18ns.t('feedback.assignee')">
                  <el-select
                    v-model="reviewForm.assigneeUserId"
                    filterable
                    remote
                    clearable
                    reserve-keyword
                    :remote-method="handleUserSearch"
                    :loading="userOptionsLoading"
                    @visible-change="handleUserSelectVisible"
                  >
                    <el-option :label="i18ns.t('feedback.unassigned')" value="" />
                    <el-option
                      v-for="user in userOptions"
                      :key="user.id"
                      :label="user.username"
                      :value="user.id"
                    />
                  </el-select>
                </el-form-item>
              </div>
              <div class="form-actions">
                <el-button @click="syncReviewFormFromDetail">{{ i18ns.t('reset') }}</el-button>
                <el-button type="primary" :loading="reviewSubmitting" @click="submitReviewUpdate">
                  {{ i18ns.t('feedback.saveReview') }}
                </el-button>
              </div>
            </el-form>
          </el-card>

          <el-card v-if="canReviewUpdate" shadow="never" class="page-card review-panel">
            <template #header>
              <div class="card-header-block">
                <div class="card-title">{{ i18ns.t('feedback.reviewReplyTitle') }}</div>
                <div class="card-description">{{ i18ns.t('feedback.reviewReplyDescription') }}</div>
              </div>
            </template>

            <el-form label-position="top">
              <el-form-item :label="i18ns.t('feedback.commentVisibility')">
                <el-radio-group v-model="commentForm.visibility">
                  <el-radio-button label="public">{{
                    i18ns.t('feedback.commentVisibilities.public')
                  }}</el-radio-button>
                  <el-radio-button label="internal">{{
                    i18ns.t('feedback.commentVisibilities.internal')
                  }}</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item :label="i18ns.t('feedback.commentContent')">
                <el-input
                  v-model="commentForm.content"
                  type="textarea"
                  :rows="4"
                  :maxlength="5000"
                  show-word-limit
                  :placeholder="i18ns.t('feedback.commentPlaceholder')"
                />
              </el-form-item>
              <div class="form-actions">
                <el-button @click="resetCommentForm">{{ i18ns.t('reset') }}</el-button>
                <el-button type="primary" :loading="commentSubmitting" @click="submitReviewComment">
                  {{ i18ns.t('feedback.postReply') }}
                </el-button>
              </div>
            </el-form>
          </el-card>

          <div class="timeline-section">
            <div class="timeline-section__title">{{ i18ns.t('feedback.comments') }}</div>
            <el-empty
              v-if="!detail.comments.length"
              :description="i18ns.t('feedback.emptyComments')"
            />
            <el-timeline v-else>
              <el-timeline-item
                v-for="comment in detail.comments"
                :key="comment.id"
                :timestamp="formatDateTime(comment.createTime)"
                :type="comment.visibility === 'internal' ? 'warning' : 'primary'"
              >
                <div class="timeline-item-head">
                  <div class="timeline-item-title">
                    {{ comment.authorUsername || comment.authorUserId }}
                  </div>
                  <el-tag
                    size="small"
                    effect="light"
                    :type="comment.visibility === 'internal' ? 'warning' : 'success'"
                  >
                    {{ i18ns.t(`feedback.commentVisibilities.${comment.visibility}`) }}
                  </el-tag>
                </div>
                <div class="timeline-item-content">{{ comment.content }}</div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </template>
      </div>
    </el-drawer>

    <el-drawer
      v-model="assignmentDrawerVisible"
      :title="i18ns.t('feedback.assignmentRulesTitle')"
      :size="assignmentDrawerSize"
    >
      <div v-loading="assignmentRulesLoading" class="detail-drawer">
        <el-alert
          :title="i18ns.t('feedback.assignmentRulesHelp')"
          type="info"
          show-icon
          :closable="false"
        />

        <div
          v-for="(rule, index) in assignmentRules"
          :key="`review-rule-${index}`"
          class="assignment-rule-card"
        >
          <div class="assignment-rule-card__header">
            <span>{{ i18ns.t('feedback.assignmentRuleTitle', { index: index + 1 }) }}</span>
            <el-button link type="danger" @click="removeAssignmentRule(index)">
              {{ i18ns.t('delete') }}
            </el-button>
          </div>
          <div class="form-grid">
            <el-form-item :label="i18ns.t('feedback.assignmentType')">
              <el-select v-model="rule.type" clearable>
                <el-option
                  v-for="type in feedbackTypeOptions"
                  :key="type"
                  :label="getTypeLabel(type)"
                  :value="type"
                />
              </el-select>
            </el-form-item>
            <el-form-item :label="i18ns.t('feedback.assignmentPriority')">
              <el-select v-model="rule.priority" clearable>
                <el-option
                  v-for="priority in priorityOptions"
                  :key="priority"
                  :label="getPriorityLabel(priority)"
                  :value="priority"
                />
              </el-select>
            </el-form-item>
            <el-form-item class="form-grid__full" :label="i18ns.t('feedback.assignmentUsers')">
              <el-select
                v-model="rule.assigneeUserIds"
                multiple
                filterable
                remote
                clearable
                reserve-keyword
                :remote-method="handleUserSearch"
                :loading="userOptionsLoading"
                @visible-change="handleUserSelectVisible"
              >
                <el-option
                  v-for="user in userOptions"
                  :key="user.id"
                  :label="user.username"
                  :value="user.id"
                />
              </el-select>
            </el-form-item>
          </div>
        </div>

        <div class="form-actions form-actions--space-between">
          <el-button @click="addAssignmentRule">
            + {{ i18ns.t('feedback.assignmentAddRule') }}
          </el-button>
          <div class="form-actions">
            <el-button @click="loadAssignmentRules">{{ i18ns.t('reset') }}</el-button>
            <el-button type="primary" :loading="assignmentRulesSaving" @click="saveAssignmentRules">
              {{ i18ns.t('save') }}
            </el-button>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { i18ns } from '@/locales'
import { feedbackService } from '@/service/feedbackService'
import { userService } from '@/service/userService'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { getErrorMessage } from '@/utils/error-utils'
import { usePageDevice } from '@/composables/usePageDevice'
import type {
  CreateFeedbackReviewCommentDto,
  FeedbackCommentVisibility,
  FeedbackDetailDto,
  FeedbackListItemDto,
  FeedbackPriority,
  FeedbackReviewAssignmentRuleDto,
  FeedbackType,
  FeedbackWorkflowStatus,
  ReviewFeedbackDto,
} from '@/client/types.gen'

interface UserOption {
  id: string
  username: string
}

const permissionStore = usePermissionStore()
const { isDesktop } = usePageDevice()

const feedbackTypeOptions: FeedbackType[] = ['suggestion', 'bug', 'other']
const workflowStatusOptions: FeedbackWorkflowStatus[] = [
  'pending',
  'processing',
  'accepted',
  'rejected',
  'completed',
]
const priorityOptions: FeedbackPriority[] = ['low', 'medium', 'high', 'urgent']

const listLoading = ref(false)
const detailLoading = ref(false)
const reviewSubmitting = ref(false)
const commentSubmitting = ref(false)
const detailVisible = ref(false)
const assignmentDrawerVisible = ref(false)
const assignmentRulesLoading = ref(false)
const assignmentRulesSaving = ref(false)
const items = ref<FeedbackListItemDto[]>([])
const detail = ref<FeedbackDetailDto | null>(null)
const userOptions = ref<UserOption[]>([])
const userOptionsLoading = ref(false)
const assignmentRules = ref<FeedbackReviewAssignmentRuleDto[]>([])

const filters = reactive({
  keyword: '',
  workflowStatus: '' as '' | FeedbackWorkflowStatus,
  type: '' as '' | FeedbackType,
  priority: '' as '' | FeedbackPriority,
  assigneeUserId: '',
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const reviewForm = reactive({
  workflowStatus: '' as '' | FeedbackWorkflowStatus,
  priority: '' as '' | FeedbackPriority,
  assigneeUserId: '',
})

const commentForm = reactive<CreateFeedbackReviewCommentDto>({
  visibility: 'public',
  content: '',
})

const canReviewUpdate = computed(() =>
  permissionStore.hasPermission(Permission.FEEDBACK_REVIEW_UPDATE),
)
const detailTitle = computed(() => detail.value?.title || i18ns.t('feedback.detailSectionTitle'))
const drawerSize = computed(() => (isDesktop.value ? '62%' : '96%'))
const assignmentDrawerSize = computed(() => (isDesktop.value ? '52%' : '96%'))

const createEmptyAssignmentRule = (): FeedbackReviewAssignmentRuleDto => ({
  type: undefined,
  priority: undefined,
  assigneeUserIds: [],
})

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

function ensureUserOption(userId?: string, username?: string | null) {
  if (!userId) return
  if (userOptions.value.some((item) => item.id === userId)) return
  userOptions.value = [{ id: userId, username: username || userId }, ...userOptions.value]
}

function addAssignmentRule() {
  assignmentRules.value = [...assignmentRules.value, createEmptyAssignmentRule()]
}

function removeAssignmentRule(index: number) {
  assignmentRules.value = assignmentRules.value.filter((_, itemIndex) => itemIndex !== index)
}

async function loadUserOptions(keyword?: string) {
  userOptionsLoading.value = true
  try {
    const result = await userService.getAllUsers({
      page: 1,
      pageSize: 50,
      keyword: keyword?.trim() || undefined,
    })
    const users = Array.isArray(result?.users) ? result.users : []
    userOptions.value = users.map((item) => ({
      id: item.id,
      username: item.username || item.id,
    }))
  } catch {
    userOptions.value = []
  } finally {
    userOptionsLoading.value = false
  }
}

function handleUserSearch(query: string) {
  void loadUserOptions(query)
}

function handleUserSelectVisible(visible: boolean) {
  if (visible && !userOptions.value.length) {
    void loadUserOptions()
  }
}

async function loadReviewList() {
  listLoading.value = true
  try {
    const result = await feedbackService.listReviewFeedback({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filters.keyword.trim() || undefined,
      workflowStatus: filters.workflowStatus || undefined,
      type: filters.type || undefined,
      priority: filters.priority || undefined,
      assigneeUserId: filters.assigneeUserId || undefined,
    })
    items.value = result.data.items
    pagination.total = result.data.total
    items.value.forEach((item) => ensureUserOption(item.assigneeUserId, item.assigneeUsername))
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.loadListFailed')))
  } finally {
    listLoading.value = false
  }
}

async function loadDetail(id: string) {
  detailLoading.value = true
  try {
    const result = await feedbackService.getReviewFeedbackDetail(id)
    detail.value = result.data
    ensureUserOption(result.data.assigneeUserId, result.data.assigneeUsername)
    syncReviewFormFromDetail()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.loadDetailFailed')))
  } finally {
    detailLoading.value = false
  }
}

async function openDetail(id: string) {
  detailVisible.value = true
  await loadDetail(id)
}

async function loadAssignmentRules() {
  assignmentRulesLoading.value = true
  try {
    const result = await feedbackService.getReviewAssignmentRules()
    assignmentRules.value = Array.isArray(result.rules)
      ? result.rules.map((rule: FeedbackReviewAssignmentRuleDto) => ({
          type: rule.type || undefined,
          priority: rule.priority || undefined,
          assigneeUserIds: Array.isArray(rule.assigneeUserIds) ? [...rule.assigneeUserIds] : [],
        }))
      : []
    assignmentRules.value.forEach((rule) => {
      rule.assigneeUserIds.forEach((userId) => ensureUserOption(userId))
    })
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.assignmentRulesLoadFailed')))
  } finally {
    assignmentRulesLoading.value = false
  }
}

async function openAssignmentDrawer() {
  assignmentDrawerVisible.value = true
  await loadAssignmentRules()
}

async function saveAssignmentRules() {
  assignmentRulesSaving.value = true
  try {
    const rules = assignmentRules.value
      .map((rule) => ({
        type: rule.type || undefined,
        priority: rule.priority || undefined,
        assigneeUserIds: Array.from(
          new Set(rule.assigneeUserIds.map((item) => item.trim()).filter((item) => item.length > 0)),
        ),
      }))
      .filter((rule) => rule.assigneeUserIds.length > 0 && (rule.type || rule.priority))

    const result = await feedbackService.setReviewAssignmentRules({ rules })
    assignmentRules.value = result.rules.map((rule: FeedbackReviewAssignmentRuleDto) => ({
      type: rule.type || undefined,
      priority: rule.priority || undefined,
      assigneeUserIds: [...rule.assigneeUserIds],
    }))
    ElMessage.success(i18ns.t('message.information.saveSuccess'))
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.assignmentRulesSaveFailed')))
  } finally {
    assignmentRulesSaving.value = false
  }
}

function syncReviewFormFromDetail() {
  reviewForm.workflowStatus = detail.value?.workflowStatus || ''
  reviewForm.priority = detail.value?.priority || ''
  reviewForm.assigneeUserId = detail.value?.assigneeUserId || ''
}

function resetCommentForm() {
  commentForm.visibility = 'public'
  commentForm.content = ''
}

async function submitReviewUpdate() {
  if (!detail.value) return

  const payload: ReviewFeedbackDto = {}
  if (reviewForm.workflowStatus) payload.workflowStatus = reviewForm.workflowStatus
  if (reviewForm.priority) payload.priority = reviewForm.priority
  payload.assigneeUserId = reviewForm.assigneeUserId.trim() || null

  reviewSubmitting.value = true
  try {
    const result = await feedbackService.reviewFeedback(detail.value.id, payload)
    detail.value = result.data
    ensureUserOption(result.data.assigneeUserId, result.data.assigneeUsername)
    syncReviewFormFromDetail()
    ElMessage.success(i18ns.t('message.information.saveSuccess'))
    await loadReviewList()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.reviewSaveFailed')))
  } finally {
    reviewSubmitting.value = false
  }
}

async function submitReviewComment() {
  if (!detail.value) return
  const content = commentForm.content.trim()
  if (!content) {
    ElMessage.error(i18ns.t('required'))
    return
  }

  commentSubmitting.value = true
  try {
    await feedbackService.addReviewComment(detail.value.id, {
      content,
      visibility: commentForm.visibility as FeedbackCommentVisibility,
    })
    resetCommentForm()
    ElMessage.success(i18ns.t('message.information.saveSuccess'))
    await loadDetail(detail.value.id)
    await loadReviewList()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('feedback.commentFailed')))
  } finally {
    commentSubmitting.value = false
  }
}

async function handleDelete(id: string) {
  try {
    await ElMessageBox.confirm(
      i18ns.t('feedback.deleteConfirm'),
      i18ns.t('confirmDialog.warning'),
      { type: 'warning' },
    )
    await feedbackService.deleteFeedback(id)
    ElMessage.success(i18ns.t('message.information.deleteSuccess'))
    if (detail.value?.id === id) {
      detailVisible.value = false
      detail.value = null
    }
    await loadReviewList()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, i18ns.t('feedback.deleteFailed')))
    }
  }
}

async function handleSearch() {
  pagination.page = 1
  await loadReviewList()
}

function resetFilters() {
  filters.keyword = ''
  filters.workflowStatus = ''
  filters.type = ''
  filters.priority = ''
  filters.assigneeUserId = ''
  void handleSearch()
}

async function handlePageSizeChange() {
  pagination.page = 1
  await loadReviewList()
}

onMounted(() => {
  void loadReviewList()
})
</script>

<style scoped>
.feedback-review-view {
  display: grid;
  gap: 18px;
}

.card-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.card-header-block {
  display: grid;
  gap: 4px;
}

.card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.card-description,
.table-subtitle {
  color: var(--el-text-color-secondary);
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(4, minmax(130px, 170px)) auto;
  gap: 12px;
  margin-bottom: 16px;
}

.filter-actions,
.row-actions,
.form-actions,
.detail-header-tags,
.timeline-item-head {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.form-grid__full {
  grid-column: 1 / -1;
}

.form-actions {
  justify-content: flex-end;
}

.table-title,
.timeline-item-title {
  font-weight: 600;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.detail-drawer,
.timeline-section {
  display: grid;
  gap: 18px;
}

.review-panel {
  border-radius: 16px;
}

.assignment-rule-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 16px;
  padding: 16px;
  display: grid;
  gap: 14px;
}

.assignment-rule-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-actions--space-between {
  justify-content: space-between;
}

.wrap-text,
.timeline-item-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

.timeline-item-head {
  align-items: center;
  justify-content: space-between;
}

@media (max-width: 1200px) {
  .filter-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .card-header-row {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-row,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .pagination-wrapper {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
