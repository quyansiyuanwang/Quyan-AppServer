<template>
  <div class="workspace-ticket-view page-shell">
    <el-card v-if="!isLoggedIn" class="page-card login-card" shadow="never">
      <template #header>
        <div class="card-header-block">
          <div class="card-title">{{ i18ns.t('ticket.loginRequiredTitle') }}</div>
          <div class="card-description">{{ i18ns.t('ticket.loginRequiredDescription') }}</div>
        </div>
      </template>
      <el-button type="primary" @click="goToLogin">{{ i18ns.t('ticket.loginAction') }}</el-button>
    </el-card>

    <div v-else-if="permissionReady" class="ticket-layout">
      <el-card v-if="canShowForm" class="page-card ticket-card ticket-card--form" shadow="never">
        <template #header>
          <div class="card-header-block">
            <div class="card-title">
              {{ isEditing ? i18ns.t('ticket.updateSectionTitle') : i18ns.t('ticket.submitSectionTitle') }}
            </div>
            <div class="card-description">
              {{ isEditing ? i18ns.t('ticket.updateSectionDescription') : i18ns.t('ticket.submitSectionDescription') }}
            </div>
          </div>
        </template>

        <el-alert
          v-if="isEditing && editingLocked"
          :title="i18ns.t('ticket.terminalLocked')"
          type="warning"
          show-icon
          :closable="false"
          class="section-alert"
        />

        <el-form ref="ticketFormRef" :model="ticketForm" :rules="ticketFormRules" label-position="top">
          <div class="form-grid">
            <el-form-item :label="i18ns.t('ticket.type')" prop="type">
              <el-select v-model="ticketForm.type">
                <el-option v-for="type in ticketTypeOptions" :key="type" :label="getTypeLabel(type)" :value="type" />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('ticket.contactInfo')" prop="contactInfo">
              <el-input
                v-model="ticketForm.contactInfo"
                :maxlength="200"
                :placeholder="i18ns.t('ticket.contactInfoPlaceholder')"
                clearable
              />
            </el-form-item>

            <el-form-item class="form-grid__full" :label="i18ns.t('ticket.title')" prop="title">
              <el-input v-model="ticketForm.title" :maxlength="200" :placeholder="i18ns.t('ticket.titlePlaceholder')" clearable />
            </el-form-item>

            <el-form-item class="form-grid__full" :label="i18ns.t('ticket.description')" prop="description">
              <el-input
                v-model="ticketForm.description"
                type="textarea"
                :rows="5"
                :maxlength="5000"
                show-word-limit
                :placeholder="i18ns.t('ticket.descriptionPlaceholder')"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('ticket.sourcePage')" prop="sourcePage">
              <el-input v-model="ticketForm.sourcePage" :maxlength="500" :placeholder="i18ns.t('ticket.sourcePagePlaceholder')" clearable />
            </el-form-item>

            <el-form-item class="form-grid__full" :label="i18ns.t('ticket.reproduceSteps')" prop="reproduceSteps">
              <el-input
                v-model="ticketForm.reproduceSteps"
                type="textarea"
                :rows="4"
                :maxlength="5000"
                show-word-limit
                :placeholder="i18ns.t('ticket.reproduceStepsPlaceholder')"
              />
            </el-form-item>
          </div>

          <div class="form-actions">
            <el-button @click="resetTicketForm">{{ i18ns.t('reset') }}</el-button>
            <el-button v-if="isEditing" @click="cancelEditing">{{ i18ns.t('ticket.cancelEdit') }}</el-button>
            <el-button type="primary" :loading="ticketSubmitting" :disabled="isEditing && editingLocked" @click="submitTicketForm">
              {{ isEditing ? i18ns.t('ticket.saveUpdate') : i18ns.t('ticket.submitAction') }}
            </el-button>
          </div>
        </el-form>
      </el-card>

      <el-card v-if="canReadTickets" class="page-card ticket-card ticket-card--list" shadow="never">
        <template #header>
          <div class="card-header-row">
            <div class="card-header-block">
              <div class="card-title">{{ i18ns.t('ticket.listSectionTitle') }}</div>
              <div class="card-description">{{ i18ns.t('ticket.listSectionDescription') }}</div>
            </div>
            <el-button :loading="listLoading" @click="loadMyTickets">{{ i18ns.t('refresh') }}</el-button>
          </div>
        </template>

        <div class="list-card-shell">
          <div class="filter-row">
            <el-input v-model="filters.keyword" :placeholder="i18ns.t('ticket.keywordPlaceholder')" clearable @keyup.enter="handleSearch" @clear="handleSearch" />
            <el-select v-model="filters.workflowStatus" clearable @change="handleSearch">
              <el-option :label="i18ns.t('ticket.allStatuses')" value="" />
              <el-option v-for="status in workflowStatusOptions" :key="status" :label="getStatusLabel(status)" :value="status" />
            </el-select>
            <el-select v-model="filters.type" clearable @change="handleSearch">
              <el-option :label="i18ns.t('ticket.allTypes')" value="" />
              <el-option v-for="type in ticketTypeOptions" :key="type" :label="getTypeLabel(type)" :value="type" />
            </el-select>
            <div class="filter-actions">
              <el-button type="primary" @click="handleSearch">{{ i18ns.t('search') }}</el-button>
              <el-button @click="resetFilters">{{ i18ns.t('reset') }}</el-button>
            </div>
          </div>

          <div class="list-card-content">
            <el-table v-if="isDesktop" v-loading="listLoading" :data="ticketList" class="ticket-table">
              <el-table-column prop="title" :label="i18ns.t('ticket.title')" min-width="220">
                <template #default="{ row }">
                  <div class="table-title">{{ row.title }}</div>
                  <div class="table-subtitle">{{ formatDateTime(row.createTime) }}</div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ticket.type')" width="120">
                <template #default="{ row }">
                  <el-tag :type="getTypeTagType(row.type)" effect="light">{{ getTypeLabel(row.type) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ticket.workflowStatus')" width="140">
                <template #default="{ row }">
                  <el-tag :type="getStatusTagType(row.workflowStatus)" effect="light">{{ getStatusLabel(row.workflowStatus) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ticket.priority')" width="120">
                <template #default="{ row }">
                  <el-tag :type="getPriorityTagType(row.priority)" effect="light">{{ getPriorityLabel(row.priority) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ticket.lastReplyAt')" width="180">
                <template #default="{ row }">{{ formatDateTime(row.lastReplyAt) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="190" fixed="right">
                <template #default="{ row }">
                  <div class="row-actions">
                    <el-button link type="primary" @click="openTicketDetail(row.id)">{{ i18ns.t('ticket.viewDetail') }}</el-button>
                    <el-button v-if="canUpdateTickets && !isTerminalStatus(row.workflowStatus)" link @click="startEditingByRow(row.id)">{{ i18ns.t('edit') }}</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>

            <div v-else class="mobile-card-list" v-loading="listLoading">
              <el-empty v-if="!ticketList.length && !listLoading" :description="i18ns.t('ticket.emptyState')" />
              <el-card v-for="item in ticketList" :key="item.id" class="mobile-ticket-card" shadow="never">
                <div class="mobile-ticket-card__header">
                  <div>
                    <div class="mobile-ticket-card__title">{{ item.title }}</div>
                    <div class="table-subtitle">{{ formatDateTime(item.createTime) }}</div>
                  </div>
                  <el-tag :type="getStatusTagType(item.workflowStatus)" effect="light">{{ getStatusLabel(item.workflowStatus) }}</el-tag>
                </div>
                <div class="mobile-ticket-card__meta">
                  <el-tag :type="getTypeTagType(item.type)" effect="light">{{ getTypeLabel(item.type) }}</el-tag>
                  <el-tag :type="getPriorityTagType(item.priority)" effect="light">{{ getPriorityLabel(item.priority) }}</el-tag>
                </div>
                <div class="mobile-ticket-card__actions">
                  <el-button type="primary" plain @click="openTicketDetail(item.id)">{{ i18ns.t('ticket.viewDetail') }}</el-button>
                  <el-button v-if="canUpdateTickets && !isTerminalStatus(item.workflowStatus)" @click="startEditingByRow(item.id)">{{ i18ns.t('edit') }}</el-button>
                </div>
              </el-card>
            </div>

            <el-empty v-if="isDesktop && !listLoading && !ticketList.length" :description="i18ns.t('ticket.emptyState')" />
          </div>

          <div class="pagination-wrapper">
            <el-pagination
              v-model:current-page="pagination.page"
              v-model:page-size="pagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="pagination.total"
              layout="total, sizes, prev, pager, next"
              @current-change="loadMyTickets"
              @size-change="handlePageSizeChange"
            />
          </div>
        </div>
      </el-card>

      <el-card v-if="!canShowForm && !canReadTickets" class="page-card" shadow="never">
        <el-empty :description="i18ns.t('permissionText.noPermissions')" />
      </el-card>
    </div>

    <el-skeleton v-else animated :rows="8" class="ticket-skeleton" />

    <el-drawer v-model="detailVisible" :title="drawerTitle" :size="drawerSize">
      <div v-loading="detailLoading" class="detail-drawer">
        <template v-if="selectedDetail">
          <div class="detail-header-tags">
            <el-tag :type="getTypeTagType(selectedDetail.type)" effect="light">{{ getTypeLabel(selectedDetail.type) }}</el-tag>
            <el-tag :type="getStatusTagType(selectedDetail.workflowStatus)" effect="light">{{ getStatusLabel(selectedDetail.workflowStatus) }}</el-tag>
            <el-tag :type="getPriorityTagType(selectedDetail.priority)" effect="light">{{ getPriorityLabel(selectedDetail.priority) }}</el-tag>
          </div>

          <el-descriptions :column="isDesktop ? 2 : 1" border class="detail-descriptions">
            <el-descriptions-item :label="i18ns.t('ticket.submitter')">{{ selectedDetail.username || selectedDetail.userId }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ticket.assignee')">{{ selectedDetail.assigneeUsername || i18ns.t('ticket.unassigned') }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ticket.createTime')">{{ formatDateTime(selectedDetail.createTime) }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ticket.updateTime')">{{ formatDateTime(selectedDetail.updateTime) }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ticket.lastReplyAt')">{{ formatDateTime(selectedDetail.lastReplyAt) }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ticket.sourcePage')"><span class="wrap-text">{{ selectedDetail.sourcePage || '-' }}</span></el-descriptions-item>
            <el-descriptions-item class-name="description-cell" :label="i18ns.t('ticket.description')"><div class="wrap-text">{{ selectedDetail.description }}</div></el-descriptions-item>
            <el-descriptions-item class-name="description-cell" :label="i18ns.t('ticket.reproduceSteps')"><div class="wrap-text">{{ selectedDetail.reproduceSteps || '-' }}</div></el-descriptions-item>
            <el-descriptions-item class-name="description-cell" :label="i18ns.t('ticket.contactInfo')"><div class="wrap-text">{{ selectedDetail.contactInfo || '-' }}</div></el-descriptions-item>
          </el-descriptions>

          <div class="detail-toolbar">
            <el-button @click="reloadCurrentDetail">{{ i18ns.t('refresh') }}</el-button>
            <el-button v-if="canUpdateTickets && !isTerminalStatus(selectedDetail.workflowStatus)" type="primary" plain @click="startEditingFromDetail">
              {{ i18ns.t('ticket.fillCurrentDetail') }}
            </el-button>
          </div>

          <el-alert :title="i18ns.t('ticket.publicRepliesOnly')" type="info" show-icon :closable="false" class="section-alert" />

          <el-card v-if="canCommentOnDetail" shadow="never" class="comment-editor-card">
            <template #header>
              <div class="card-header-block">
                <div class="card-title">{{ i18ns.t('ticket.replyTitle') }}</div>
                <div class="card-description">{{ i18ns.t('ticket.replyDescription') }}</div>
              </div>
            </template>
            <el-input v-model="commentDraft" type="textarea" :rows="4" :maxlength="5000" show-word-limit :placeholder="i18ns.t('ticket.commentPlaceholder')" />
            <div class="form-actions">
              <el-button @click="commentDraft = ''">{{ i18ns.t('reset') }}</el-button>
              <el-button type="primary" :loading="commentSubmitting" @click="submitComment">{{ i18ns.t('ticket.postReply') }}</el-button>
            </div>
          </el-card>

          <div class="timeline-section">
            <div class="timeline-section__title">{{ i18ns.t('ticket.comments') }}</div>
            <el-empty v-if="!selectedDetail.comments.length" :description="i18ns.t('ticket.emptyComments')" />
            <el-timeline v-else>
              <el-timeline-item v-for="comment in selectedDetail.comments" :key="comment.id" :timestamp="formatDateTime(comment.createTime)" type="primary">
                <div class="timeline-item-title">{{ comment.authorUsername || comment.authorUserId }}</div>
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
import { ticketService } from '@/service/ticketService'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { getErrorMessage } from '@/utils/error-utils'
import { getLoginRoute } from '@/utils/auth-routes'
import { usePageDevice } from '@/composables/usePageDevice'
import { useFloatingWorkspaceStore } from '@/stores/floatingWorkspaceStore'
import router from '@/router'
import type {
  CreateTicketDto,
  TicketDetailDto,
  TicketListItemDto,
  TicketPriority,
  TicketType,
  TicketWorkflowStatus,
  UpdateMyTicketDto,
} from '@/client/types.gen'

type TicketFormModel = {
  type: TicketType
  title: string
  description: string
  sourcePage: string
  reproduceSteps: string
  contactInfo: string
}

const createDefaultTicketForm = (): TicketFormModel => ({
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

const ticketTypeOptions: TicketType[] = ['suggestion', 'bug', 'other']
const workflowStatusOptions: TicketWorkflowStatus[] = ['pending', 'processing', 'accepted', 'rejected', 'completed']

const ticketFormRef = ref<FormInstance>()
const permissionReady = ref(false)
const ticketSubmitting = ref(false)
const listLoading = ref(false)
const detailLoading = ref(false)
const commentSubmitting = ref(false)
const ticketList = ref<TicketListItemDto[]>([])
const selectedDetail = ref<TicketDetailDto | null>(null)
const detailVisible = ref(false)
const editingId = ref<string | null>(null)
const commentDraft = ref('')

const ticketForm = reactive<TicketFormModel>(createDefaultTicketForm())
const filters = reactive({
  keyword: '',
  workflowStatus: '' as '' | TicketWorkflowStatus,
  type: '' as '' | TicketType,
})
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })

const isLoggedIn = computed(() => userInfoStore.isLoggedIn())
const isEmbeddedPage = computed(() => String(route.query.embed ?? '') === '1')
const canSubmitTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_SUBMIT))
const canReadTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_SELF_READ))
const canUpdateTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_SELF_UPDATE))
const canCommentTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_COMMENT))
const canShowForm = computed(() => canSubmitTickets.value || (isEditing.value && canUpdateTickets.value))
const isEditing = computed(() => Boolean(editingId.value))
const editingLocked = computed(() => Boolean(selectedDetail.value) && isTerminalStatus(selectedDetail.value!.workflowStatus))
const canCommentOnDetail = computed(() => Boolean(selectedDetail.value) && canCommentTickets.value && !isTerminalStatus(selectedDetail.value!.workflowStatus))
const drawerTitle = computed(() => selectedDetail.value?.title || i18ns.t('ticket.detailSectionTitle'))
const drawerSize = computed(() => (isDesktop.value ? '56%' : '92%'))

const ticketFormRules: FormRules<TicketFormModel> = {
  type: [{ required: true, message: i18ns.t('required'), trigger: 'change' }],
  title: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  description: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
}

function isTerminalStatus(status?: TicketWorkflowStatus) {
  return status === 'rejected' || status === 'completed'
}

function getTypeLabel(type: TicketType) {
  return i18ns.t(`ticket.types.${type}`)
}

function getStatusLabel(status: TicketWorkflowStatus) {
  return i18ns.t(`ticket.statuses.${status}`)
}

function getPriorityLabel(priority: TicketPriority) {
  return i18ns.t(`ticket.priorities.${priority}`)
}

function getTypeTagType(type: TicketType) {
  switch (type) {
    case 'suggestion':
      return 'primary'
    case 'bug':
      return 'danger'
    default:
      return 'info'
  }
}

function getStatusTagType(status: TicketWorkflowStatus) {
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

function getPriorityTagType(priority: TicketPriority) {
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

function resetTicketForm() {
  Object.assign(ticketForm, createDefaultTicketForm())
  void nextTick(() => ticketFormRef.value?.clearValidate())
}

function applyDetailToForm(detail: TicketDetailDto) {
  ticketForm.type = detail.type
  ticketForm.title = detail.title
  ticketForm.description = detail.description
  ticketForm.sourcePage = detail.sourcePage || ''
  ticketForm.reproduceSteps = detail.reproduceSteps || ''
  ticketForm.contactInfo = detail.contactInfo || ''
}

function buildCreatePayload(): CreateTicketDto {
  return {
    type: ticketForm.type,
    title: ticketForm.title.trim(),
    description: ticketForm.description.trim(),
    sourcePage: normalizeOptionalCreateField(ticketForm.sourcePage),
    reproduceSteps: normalizeOptionalCreateField(ticketForm.reproduceSteps),
    contactInfo: normalizeOptionalCreateField(ticketForm.contactInfo),
  }
}

function buildUpdatePayload(): UpdateMyTicketDto {
  return {
    type: ticketForm.type,
    title: ticketForm.title.trim(),
    description: ticketForm.description.trim(),
    sourcePage: normalizeOptionalUpdateField(ticketForm.sourcePage),
    reproduceSteps: normalizeOptionalUpdateField(ticketForm.reproduceSteps),
    contactInfo: normalizeOptionalUpdateField(ticketForm.contactInfo),
  }
}

async function loadMyTickets() {
  if (!canReadTickets.value) return

  listLoading.value = true
  try {
    const result = await ticketService.listMyTickets({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filters.keyword.trim() || undefined,
      workflowStatus: filters.workflowStatus || undefined,
      type: filters.type || undefined,
    })
    ticketList.value = result.data.items
    pagination.total = result.data.total
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('ticket.loadListFailed')))
  } finally {
    listLoading.value = false
  }
}

async function loadTicketDetail(id: string) {
  detailLoading.value = true
  try {
    const result = await ticketService.getMyTicketDetail(id)
    selectedDetail.value = result.data
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('ticket.loadDetailFailed')))
  } finally {
    detailLoading.value = false
  }
}

async function openTicketDetail(id: string) {
  detailVisible.value = true
  await loadTicketDetail(id)
}

async function reloadCurrentDetail() {
  if (!selectedDetail.value) return
  await loadTicketDetail(selectedDetail.value.id)
  await loadMyTickets()
}

async function submitTicketForm() {
  if (!ticketFormRef.value) return

  try {
    await ticketFormRef.value.validate()
    ticketSubmitting.value = true

    if (editingId.value) {
      const result = await ticketService.updateMyTicket(editingId.value, buildUpdatePayload())
      selectedDetail.value = result.data
      ElMessage.success(i18ns.t('message.information.saveSuccess'))
      await loadMyTickets()
      if (detailVisible.value) {
        await loadTicketDetail(editingId.value)
      }
    } else {
      const result = await ticketService.createTicket(buildCreatePayload())
      ElMessage.success(i18ns.t('message.information.createSuccess'))
      resetTicketForm()
      pagination.page = 1
      await loadMyTickets()
      if (result.data?.id) {
        await openTicketDetail(result.data.id)
      }
    }

    cancelEditing()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t(isEditing.value ? 'ticket.updateFailed' : 'ticket.submitFailed')))
  } finally {
    ticketSubmitting.value = false
  }
}

function cancelEditing() {
  editingId.value = null
  resetTicketForm()
}

async function startEditingByRow(id: string) {
  try {
    const result = await ticketService.getMyTicketDetail(id)
    editingId.value = id
    selectedDetail.value = result.data
    applyDetailToForm(result.data)
    await nextTick()
    ticketFormRef.value?.clearValidate()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('ticket.loadDetailFailed')))
  }
}

function startEditingFromDetail() {
  if (!selectedDetail.value) return
  editingId.value = selectedDetail.value.id
  applyDetailToForm(selectedDetail.value)
  void nextTick(() => ticketFormRef.value?.clearValidate())
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
    await ticketService.addMyComment(selectedDetail.value.id, { content })
    commentDraft.value = ''
    ElMessage.success(i18ns.t('message.information.saveSuccess'))
    await loadTicketDetail(selectedDetail.value.id)
    await loadMyTickets()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('ticket.commentFailed')))
  } finally {
    commentSubmitting.value = false
  }
}

async function handleSearch() {
  pagination.page = 1
  await loadMyTickets()
}

function resetFilters() {
  filters.keyword = ''
  filters.workflowStatus = ''
  filters.type = ''
  void handleSearch()
}

async function handlePageSizeChange() {
  pagination.page = 1
  await loadMyTickets()
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

  if (canReadTickets.value) {
    await loadMyTickets()
  }
}

onMounted(() => {
  void initPage()
})
</script>

<style scoped>
.workspace-ticket-view {
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

.ticket-layout {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(360px, 0.92fr) minmax(0, 1.48fr);
  align-items: start;
  height: 95vh;
  min-height: 0;
}

.ticket-card {
  overflow: hidden;
}

.ticket-card--form {
  position: sticky;
  top: 0;
}

.ticket-card--form :deep(.el-card__body),
.ticket-card--list :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ticket-card--form :deep(.el-card__body) {
  gap: 16px;
}

.ticket-card--list {
  height: 100%;
}

.ticket-card--list :deep(.el-card__body) {
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
.row-actions,
.detail-header-tags,
.detail-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) repeat(2, minmax(130px, 170px)) auto;
  gap: 12px;
}

.table-title,
.timeline-item-title,
.mobile-ticket-card__title {
  font-weight: 600;
}

.mobile-card-list,
.detail-drawer,
.timeline-section {
  display: grid;
  gap: 18px;
}

.mobile-ticket-card,
.comment-editor-card {
  border-radius: 16px;
}

.mobile-ticket-card__header,
.mobile-ticket-card__meta,
.mobile-ticket-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.wrap-text,
.timeline-item-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

@media (max-width: 1200px) {
  .ticket-layout {
    grid-template-columns: 1fr;
    height: auto;
  }

  .filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ticket-card--form {
    position: static;
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