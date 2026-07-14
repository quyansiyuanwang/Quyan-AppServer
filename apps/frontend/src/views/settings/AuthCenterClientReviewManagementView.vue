<template>
  <div class="auth-center-client-review-view desktop-page page-shell">
    <el-card class="page-card">
      <template #header>
        <div class="card-header toolbar-row">
          <div>
            <div class="card-title">{{ i18ns.t('authCenterClient.reviewManagement') }}</div>
            <div class="text-secondary header-desc">
              {{ i18ns.t('authCenterClient.reviewDescription') }}
            </div>
          </div>
          <el-button :icon="Refresh" :loading="loading" @click="loadReviewItems">
            {{ i18ns.t('refresh') }}
          </el-button>
        </div>
      </template>

      <div class="review-filter-row">
        <el-input
          v-model="filters.keyword"
          :placeholder="i18ns.t('authCenterClient.keywordPlaceholder')"
          clearable
          class="filter-input"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="filters.reviewStatus"
          clearable
          class="filter-select"
          @change="handleSearch"
        >
          <el-option :label="i18ns.t('authCenterClient.allStatuses')" value="" />
          <el-option
            v-for="status in reviewStatusOptions"
            :key="status"
            :label="getReviewStatusLabel(status)"
            :value="status"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">{{ i18ns.t('search') }}</el-button>
      </div>

      <el-table v-loading="loading" :data="items">
        <el-table-column prop="name" :label="i18ns.t('authCenterClient.name')" min-width="180" />
        <el-table-column :label="i18ns.t('authCenterClient.reviewStatus')" width="140">
          <template #default="{ row }">
            <div class="status-cell">
              <el-tag :type="getReviewStatusTagType(row.reviewStatus)" effect="light">
                {{ getReviewStatusLabel(row.reviewStatus) }}
              </el-tag>
              <el-button link type="danger" class="status-cell__delete" @click="handleDelete(row)">
                {{ i18ns.t('delete') }}
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          prop="ownerUsername"
          :label="i18ns.t('authCenterClient.ownerUsername')"
          width="140"
        />
        <el-table-column
          prop="clientId"
          :label="i18ns.t('authCenterClient.clientId')"
          min-width="220"
        />
        <el-table-column :label="i18ns.t('authCenterClient.clientType')" width="130">
          <template #default="{ row }">
            {{ getClientTypeLabel(row.clientType) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('authCenterClient.grantTypes')" min-width="220">
          <template #default="{ row }">
            <div class="stack compact-list">
              <el-tag
                v-for="grantType in row.grantTypes"
                :key="grantType"
                size="small"
                effect="plain"
              >
                {{ getGrantTypeLabel(grantType) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('authCenterClient.redirectUris')" min-width="240">
          <template #default="{ row }">
            <div class="stack compact-list">
              <div v-for="uri in row.redirectUris.slice(0, 2)" :key="uri" class="mono small-text">
                {{ uri }}
              </div>
              <div v-if="row.redirectUris.length > 2" class="small-text text-secondary">
                {{ i18ns.t('authCenterClient.moreItems', { count: row.redirectUris.length - 2 }) }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('authCenterClient.submittedAt')" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.submittedAt) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('authCenterClient.reviewedAt')" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.reviewedAt) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="260" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="danger" @click="handleDelete(row)">
                {{ i18ns.t('delete') }}
              </el-button>
              <el-button
                v-if="row.reviewStatus === 'pending'"
                link
                type="success"
                @click="openReviewDialog(row, 'approved')"
              >
                {{ i18ns.t('authCenterClient.approve') }}
              </el-button>
              <el-button
                v-if="row.reviewStatus === 'pending'"
                link
                type="danger"
                @click="openReviewDialog(row, 'rejected')"
              >
                {{ i18ns.t('authCenterClient.reject') }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!loading && !items.length"
        :description="i18ns.t('authCenterClient.noReviewItems')"
      />

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadReviewItems"
          @size-change="handlePageSizeChange"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="showReviewDialog"
      :title="i18ns.t('authCenterClient.reviewDialogTitle')"
      width="520px"
    >
      <el-form label-position="top">
        <el-form-item :label="i18ns.t('authCenterClient.reviewDecision')">
          <el-tag v-if="pendingDecision" :type="getReviewStatusTagType(pendingDecision)">
            {{ getReviewStatusLabel(pendingDecision) }}
          </el-tag>
        </el-form-item>
        <el-form-item :label="i18ns.t('authCenterClient.reviewComment')">
          <el-input
            v-model="reviewComment"
            type="textarea"
            :rows="5"
            :placeholder="i18ns.t('authCenterClient.emptyReviewComment')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showReviewDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submitReviewDecision">
          {{ i18ns.t('confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { i18ns } from '@/locales'
import { AuthCenterClientService } from '@/service/authCenterClientService'
import type {
  AuthCenterClientReviewListItemDto,
  AuthCenterClientReviewStatus,
  AuthCenterGrantType,
  ReviewAuthCenterClientDto,
} from '@/client/types.gen'

const authCenterClientService = AuthCenterClientService.getInstance()
const { t } = useI18n()

const loading = ref(false)
const submitting = ref(false)
const items = ref<AuthCenterClientReviewListItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filters = ref({
  keyword: '',
  reviewStatus: '' as '' | AuthCenterClientReviewStatus,
})

const showReviewDialog = ref(false)
const reviewComment = ref('')
const selectedItem = ref<AuthCenterClientReviewListItemDto | null>(null)
const pendingDecision = ref<ReviewAuthCenterClientDto['reviewStatus'] | null>(null)

const reviewStatusOptions = computed<AuthCenterClientReviewStatus[]>(() => [
  'draft',
  'pending',
  'approved',
  'rejected',
])

const getReviewStatusLabel = (status: AuthCenterClientReviewStatus) =>
  i18ns.t(`authCenterClient.reviewStatuses.${status}`)

const getReviewStatusTagType = (status: AuthCenterClientReviewStatus) => {
  switch (status) {
    case 'approved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'info'
  }
}

const getClientTypeLabel = (clientType: 'confidential' | 'public') =>
  clientType === 'public'
    ? i18ns.t('authCenterClient.type.public')
    : i18ns.t('authCenterClient.type.confidential')

const getGrantTypeLabel = (grantType: AuthCenterGrantType) =>
  i18ns.t(`authCenterClient.grantTypeLabels.${grantType}`)

const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : '-')

const loadReviewItems = async () => {
  loading.value = true
  try {
    const res = await authCenterClientService.listClientsForReview({
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.value.keyword.trim() || undefined,
      reviewStatus: filters.value.reviewStatus || undefined,
    })
    items.value = res.data.items
    total.value = res.data.total
  } catch (error) {
    ElMessage.error(t('authCenterClient.loadReviewFailed'))
    throw error
  } finally {
    loading.value = false
  }
}

const handleSearch = async () => {
  page.value = 1
  await loadReviewItems()
}

const handlePageSizeChange = async () => {
  page.value = 1
  await loadReviewItems()
}

const openReviewDialog = (
  row: AuthCenterClientReviewListItemDto,
  decision: ReviewAuthCenterClientDto['reviewStatus'],
) => {
  selectedItem.value = row
  pendingDecision.value = decision
  reviewComment.value = row.reviewComment || ''
  showReviewDialog.value = true
}

const submitReviewDecision = async () => {
  if (!selectedItem.value || !pendingDecision.value) return
  try {
    submitting.value = true
    await authCenterClientService.reviewClient(selectedItem.value.id, {
      reviewStatus: pendingDecision.value,
      reviewComment: reviewComment.value.trim() || undefined,
    })
    ElMessage.success(t('authCenterClient.reviewSuccess'))
    showReviewDialog.value = false
    selectedItem.value = null
    pendingDecision.value = null
    reviewComment.value = ''
    await loadReviewItems()
  } catch {
    ElMessage.error(t('authCenterClient.reviewFailed'))
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (row: AuthCenterClientReviewListItemDto) => {
  try {
    await ElMessageBox.confirm(
      t('authCenterClient.confirmDelete', { name: row.name }),
      t('confirmDialog.warning'),
      { type: 'warning' },
    )
    await authCenterClientService.deleteClientForReview(row.id)
    ElMessage.success(t('deleteSuccess'))
    await loadReviewItems()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('authCenterClient.deleteFailed'))
    }
  }
}

onMounted(() => {
  void loadReviewItems()
})
</script>

<style scoped>
.header-desc {
  margin-top: 6px;
  font-size: 13px;
}

.review-filter-row {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 180px auto;
  gap: 12px;
  margin-bottom: 16px;
}

.filter-input {
  min-width: 240px;
}

.filter-select {
  width: 180px;
}

@media (max-width: 767px) {
  .review-filter-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .filter-input,
  .filter-select {
    width: 100%;
    min-width: 0;
  }
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.status-cell__delete {
  padding: 0;
  min-height: auto;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.compact-list {
  line-height: 1.4;
}

.mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}
</style>
