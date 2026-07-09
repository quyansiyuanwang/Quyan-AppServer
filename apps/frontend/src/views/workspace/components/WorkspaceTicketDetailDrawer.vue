<template>
  <el-drawer v-model="drawerVisible" :title="drawerTitle" :size="drawerSize">
    <div v-loading="detailLoading" class="detail-drawer">
      <template v-if="selectedDetail">
        <div class="detail-header-tags">
          <el-tag :type="getTypeTagType(selectedDetail.type)" effect="light">{{
            getTypeLabel(selectedDetail.type)
          }}</el-tag>
          <el-tag :type="getStatusTagType(selectedDetail.workflowStatus)" effect="light">{{
            getStatusLabel(selectedDetail.workflowStatus)
          }}</el-tag>
          <el-tag :type="getPriorityTagType(selectedDetail.priority)" effect="light">{{
            getPriorityLabel(selectedDetail.priority)
          }}</el-tag>
        </div>

        <el-descriptions :column="isDesktop ? 2 : 1" border class="detail-descriptions">
          <el-descriptions-item :label="i18ns.t('ticket.submitter')">{{
            selectedDetail.username || selectedDetail.userId
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('ticket.assignee')">{{
            selectedDetail.assigneeUsername || i18ns.t('ticket.unassigned')
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('ticket.createTime')">{{
            formatDateTime(selectedDetail.createTime)
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('ticket.updateTime')">{{
            formatDateTime(selectedDetail.updateTime)
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('ticket.lastReplyAt')">{{
            formatDateTime(selectedDetail.lastReplyAt)
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('ticket.sourcePage')"
            ><span class="wrap-text">{{ selectedDetail.sourcePage || '-' }}</span></el-descriptions-item
          >
          <el-descriptions-item class-name="description-cell" :label="i18ns.t('ticket.description')"
            ><div class="wrap-text">{{ selectedDetail.description }}</div></el-descriptions-item
          >
          <el-descriptions-item
            class-name="description-cell"
            :label="i18ns.t('ticket.reproduceSteps')"
            ><div class="wrap-text">{{ selectedDetail.reproduceSteps || '-' }}</div></el-descriptions-item
          >
          <el-descriptions-item class-name="description-cell" :label="i18ns.t('ticket.contactInfo')"
            ><div class="wrap-text">{{ selectedDetail.contactInfo || '-' }}</div></el-descriptions-item
          >
        </el-descriptions>

        <div class="detail-toolbar">
          <el-button @click="$emit('reload')">{{ i18ns.t('refresh') }}</el-button>
          <el-button
            v-if="canUpdateTickets && !isTerminalStatus(selectedDetail.workflowStatus)"
            type="primary"
            plain
            @click="$emit('startEdit')"
          >
            {{ i18ns.t('ticket.fillCurrentDetail') }}
          </el-button>
        </div>

        <el-alert
          :title="i18ns.t('ticket.publicRepliesOnly')"
          type="info"
          show-icon
          :closable="false"
          class="section-alert"
        />

        <el-card v-if="canCommentOnDetail" shadow="never" class="comment-editor-card">
          <template #header>
            <div class="card-header-block">
              <div class="card-title">{{ i18ns.t('ticket.replyTitle') }}</div>
              <div class="card-description">{{ i18ns.t('ticket.replyDescription') }}</div>
            </div>
          </template>
          <el-input
            v-model="commentDraftProxy"
            type="textarea"
            :rows="4"
            :maxlength="5000"
            show-word-limit
            :placeholder="i18ns.t('ticket.commentPlaceholder')"
          />
          <div class="form-actions">
            <el-button @click="commentDraftProxy = ''">{{ i18ns.t('reset') }}</el-button>
            <el-button type="primary" :loading="commentSubmitting" @click="$emit('submitComment')">{{
              i18ns.t('ticket.postReply')
            }}</el-button>
          </div>
        </el-card>

        <div class="timeline-section">
          <div class="timeline-section__title">{{ i18ns.t('ticket.comments') }}</div>
          <el-empty
            v-if="!selectedDetail.comments.length"
            :description="i18ns.t('ticket.emptyComments')"
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import type {
  TicketDetailDto,
  TicketPriority,
  TicketType,
  TicketWorkflowStatus,
} from '@/client/types.gen'

const props = defineProps<{
  modelValue: boolean
  detailLoading: boolean
  selectedDetail: TicketDetailDto | null
  drawerTitle: string
  drawerSize: string
  isDesktop: boolean
  canUpdateTickets: boolean
  canCommentOnDetail: boolean
  commentSubmitting: boolean
  commentDraft: string
  getTypeLabel: (type: TicketType) => string
  getStatusLabel: (status: TicketWorkflowStatus) => string
  getPriorityLabel: (priority: TicketPriority) => string
  getTypeTagType: (type: TicketType) => string
  getStatusTagType: (status: TicketWorkflowStatus) => string
  getPriorityTagType: (priority: TicketPriority) => string
  isTerminalStatus: (status?: TicketWorkflowStatus) => boolean
  formatDateTime: (value?: string | null) => string
}>()

const emit = defineEmits<{
  reload: []
  startEdit: []
  submitComment: []
  'update:modelValue': [value: boolean]
  'update:commentDraft': [value: string]
}>()

const drawerVisible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const commentDraftProxy = computed({
  get: () => props.commentDraft,
  set: (value: string) => emit('update:commentDraft', value),
})
</script>

<style scoped>
.detail-drawer,
.timeline-section {
  display: grid;
  gap: 18px;
}

.detail-header-tags,
.detail-toolbar,
.form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.card-header-block {
  display: grid;
  gap: 4px;
}

.card-title,
.timeline-item-title,
.timeline-section__title {
  font-weight: 600;
}

.card-description {
  color: var(--el-text-color-secondary);
}

.section-alert {
  margin-bottom: 16px;
}

.comment-editor-card {
  border-radius: 16px;
}

.wrap-text,
.timeline-item-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}
</style>