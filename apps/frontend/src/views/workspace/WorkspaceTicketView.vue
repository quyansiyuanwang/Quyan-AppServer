<template>
  <AccountProfileLayout class="workspace-ticket-view page-shell">
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
      <WorkspaceTicketFormCard
        v-if="canShowForm"
        ref="ticketFormRef"
        :is-editing="isEditing"
        :editing-locked="editingLocked"
        :ticket-submitting="ticketSubmitting"
        :ticket-form="ticketForm"
        :ticket-form-rules="ticketFormRules"
        :ticket-type-options="ticketTypeOptions"
        :get-type-label="getTypeLabel"
        @reset="resetTicketForm"
        @cancel-edit="cancelEditing"
        @submit="submitTicketForm"
        @update:ticket-form="Object.assign(ticketForm, $event)"
      />

      <WorkspaceTicketListCard
        v-if="canReadTickets"
        :is-desktop="isDesktop"
        :list-loading="listLoading"
        :ticket-list="ticketList"
        :filters="filters"
        :pagination="pagination"
        :can-update-tickets="canUpdateTickets"
        :ticket-type-options="ticketTypeOptions"
        :workflow-status-options="workflowStatusOptions"
        :get-type-label="getTypeLabel"
        :get-status-label="getStatusLabel"
        :get-priority-label="getPriorityLabel"
        :get-type-tag-type="getTypeTagType"
        :get-status-tag-type="getStatusTagType"
        :get-priority-tag-type="getPriorityTagType"
        :is-terminal-status="isTerminalStatus"
        :format-date-time="formatDateTime"
        @refresh="loadMyTickets"
        @search="handleSearch"
        @reset-filters="resetFilters"
        @open-detail="openTicketDetail"
        @edit="startEditingByRow"
        @page-size-change="handlePageSizeChange"
        @update:filters="Object.assign(filters, $event)"
        @update:pagination="Object.assign(pagination, $event)"
      />

      <el-card v-if="!canShowForm && !canReadTickets" class="page-card" shadow="never">
        <el-empty :description="i18ns.t('permissionText.noPermissions')" />
      </el-card>
    </div>

    <el-skeleton v-else animated :rows="8" class="ticket-skeleton" />

    <WorkspaceTicketDetailDrawer
      v-model="detailVisible"
      v-model:comment-draft="commentDraft"
      :detail-loading="detailLoading"
      :selected-detail="selectedDetail"
      :drawer-title="drawerTitle"
      :drawer-size="drawerSize"
      :is-desktop="isDesktop"
      :can-update-tickets="canUpdateTickets"
      :can-comment-on-detail="canCommentOnDetail"
      :comment-submitting="commentSubmitting"
      :get-type-label="getTypeLabel"
      :get-status-label="getStatusLabel"
      :get-priority-label="getPriorityLabel"
      :get-type-tag-type="getTypeTagType"
      :get-status-tag-type="getStatusTagType"
      :get-priority-tag-type="getPriorityTagType"
      :is-terminal-status="isTerminalStatus"
      :format-date-time="formatDateTime"
      @reload="reloadCurrentDetail"
      @start-edit="startEditingFromDetail"
      @submit-comment="submitComment"
    />
  </AccountProfileLayout>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import type { FormRules } from 'element-plus'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
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
import WorkspaceTicketDetailDrawer from './components/WorkspaceTicketDetailDrawer.vue'
import WorkspaceTicketFormCard from './components/WorkspaceTicketFormCard.vue'
import WorkspaceTicketListCard from './components/WorkspaceTicketListCard.vue'
import type {
  CreateTicketDto,
  TicketDetailDto,
  TicketListItemDto,
  TicketPriority,
  TicketType,
  TicketWorkflowStatus,
  UpdateMyTicketDto,
} from '@/client/types.gen'
import type { TicketFiltersModel, TicketFormModel } from './types'

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
const workflowStatusOptions: TicketWorkflowStatus[] = [
  'pending',
  'processing',
  'accepted',
  'rejected',
  'completed',
]

type TicketFormCardExposed = {
  validate: () => Promise<boolean>
  clearValidate: () => void
}

const ticketFormRef = ref<TicketFormCardExposed>()
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
const filters = reactive<TicketFiltersModel>({
  keyword: '',
  workflowStatus: '' as '' | TicketWorkflowStatus,
  type: '' as '' | TicketType,
})
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })

const isLoggedIn = computed(() => userInfoStore.isLoggedIn())
const isEmbeddedPage = computed(() => String(route.query.embed ?? '') === '1')
const canSubmitTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_SUBMIT))
const canReadTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_SELF_READ))
const canUpdateTickets = computed(() =>
  permissionStore.hasPermission(Permission.TICKET_SELF_UPDATE),
)
const canCommentTickets = computed(() => permissionStore.hasPermission(Permission.TICKET_COMMENT))
const canShowForm = computed(
  () => canSubmitTickets.value || (isEditing.value && canUpdateTickets.value),
)
const isEditing = computed(() => Boolean(editingId.value))
const editingLocked = computed(
  () => Boolean(selectedDetail.value) && isTerminalStatus(selectedDetail.value!.workflowStatus),
)
const canCommentOnDetail = computed(
  () =>
    Boolean(selectedDetail.value) &&
    canCommentTickets.value &&
    !isTerminalStatus(selectedDetail.value!.workflowStatus),
)
const drawerTitle = computed(
  () => selectedDetail.value?.title || i18ns.t('ticket.detailSectionTitle'),
)
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
    const valid = await ticketFormRef.value.validate()
    if (!valid) return
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
    ElMessage.error(
      getErrorMessage(
        error,
        i18ns.t(isEditing.value ? 'ticket.updateFailed' : 'ticket.submitFailed'),
      ),
    )
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
  gap: 18px;
}

.page-card {
  border-radius: 18px;
}

.card-description,
.table-subtitle {
  color: var(--el-text-color-secondary);
}

.card-title,
.card-description {
  margin: 0;
}

.ticket-layout {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(360px, 0.92fr) minmax(0, 1.48fr);
  align-items: start;
  width: 100%;
  min-width: 0;
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

@media (max-width: 1200px) {
  .ticket-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
