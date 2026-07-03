<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="user-online-monitor page-shell">
      <el-card class="page-card" v-loading="loading">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('UserOnlineMonitor.title') }}</span>
            <el-button :icon="Refresh" type="primary" @click="loadOverview">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <el-row :gutter="16" class="stats-row">
          <el-col :span="6"
            ><el-card shadow="never" class="stats-card"
              ><el-statistic
                :title="i18ns.t('UserOnlineMonitor.onlineUsers')"
                :value="stats.onlineUsers" /></el-card
          ></el-col>
          <el-col :span="6"
            ><el-card shadow="never" class="stats-card"
              ><el-statistic
                :title="i18ns.t('UserOnlineMonitor.offlineUsers')"
                :value="stats.offlineUsers" /></el-card
          ></el-col>
          <el-col :span="6"
            ><el-card shadow="never" class="stats-card"
              ><el-statistic
                :title="i18ns.t('UserOnlineMonitor.activeSessions')"
                :value="stats.activeSessions" /></el-card
          ></el-col>
          <el-col :span="6"
            ><el-card shadow="never" class="stats-card"
              ><el-statistic
                :title="i18ns.t('UserOnlineMonitor.avgDuration')"
                :value="formatDuration(stats.averageDurationSeconds)" /></el-card
          ></el-col>
        </el-row>

        <el-form :inline="true" :model="filters" class="toolbar-row filters-row">
          <el-form-item :label="i18ns.t('UserOnlineMonitor.keyword')">
            <el-input
              v-model="filters.keyword"
              :placeholder="i18ns.t('UserOnlineMonitor.keywordPlaceholder')"
              clearable
              @change="handleFilterChange"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('UserOnlineMonitor.statusFilter')">
            <el-select
              v-model="filters.status"
              clearable
              style="width: 160px"
              @change="handleFilterChange"
            >
              <el-option :label="i18ns.t('UserOnlineMonitor.online')" value="online" />
              <el-option :label="i18ns.t('UserOnlineMonitor.offline')" value="offline" />
            </el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('UserOnlineMonitor.ipAddress')">
            <el-input
              v-model="filters.ipAddress"
              :placeholder="i18ns.t('UserOnlineMonitor.ipPlaceholder')"
              clearable
              @change="handleFilterChange"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('UserOnlineMonitor.locationFilter')">
            <el-input
              v-model="filters.location"
              :placeholder="i18ns.t('UserOnlineMonitor.locationPlaceholder')"
              clearable
              @change="handleFilterChange"
            />
          </el-form-item>
        </el-form>

        <el-table :data="items" border stripe>
          <el-table-column
            prop="username"
            :label="i18ns.t('UserOnlineMonitor.username')"
            min-width="140"
          />
          <el-table-column prop="name" :label="i18ns.t('UserOnlineMonitor.name')" min-width="140" />
          <el-table-column :label="i18ns.t('UserOnlineMonitor.statusLabel')" min-width="100">
            <template #default="{ row }">
              <el-tag :type="row.isOnline ? 'success' : 'info'">
                {{
                  row.isOnline
                    ? i18ns.t('UserOnlineMonitor.online')
                    : i18ns.t('UserOnlineMonitor.offline')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            prop="ipAddress"
            :label="i18ns.t('UserOnlineMonitor.ipAddress')"
            min-width="140"
          />
          <el-table-column
            prop="location"
            :label="i18ns.t('UserOnlineMonitor.location')"
            min-width="160"
          />
          <el-table-column :label="i18ns.t('UserOnlineMonitor.startedAt')" min-width="180"
            ><template #default="{ row }">{{
              formatDateTime(row.startedAt)
            }}</template></el-table-column
          >
          <el-table-column :label="i18ns.t('UserOnlineMonitor.lastHeartbeatAt')" min-width="180"
            ><template #default="{ row }">{{
              formatDateTime(row.lastHeartbeatAt)
            }}</template></el-table-column
          >
          <el-table-column :label="i18ns.t('UserOnlineMonitor.endedAt')" min-width="180"
            ><template #default="{ row }">{{
              formatDateTime(row.endedAt)
            }}</template></el-table-column
          >
          <el-table-column :label="i18ns.t('UserOnlineMonitor.duration')" min-width="120"
            ><template #default="{ row }">{{
              formatDuration(row.durationSeconds)
            }}</template></el-table-column
          >
          <el-table-column :label="i18ns.t('actions')" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row.userId)">
                {{ i18ns.t('UserOnlineMonitor.viewDetail') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrapper desktop-pagination">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[2, 10, 20, 50, 100]"
            :total="total"
            layout="total, sizes, prev, pager, next, jumper"
            @current-change="handlePageChange"
            @size-change="handlePageSizeChange"
          />
        </div>
      </el-card>

      <el-drawer
        v-model="detailVisible"
        :title="selectedDetail?.username || i18ns.t('UserOnlineMonitor.detailTitle')"
        size="50%"
      >
        <div v-loading="detailLoading" class="detail-drawer">
          <template v-if="selectedDetail">
            <el-row :gutter="12" class="stats-row">
              <el-col :span="8"
                ><el-card shadow="never" class="stats-card"
                  ><el-statistic
                    :title="i18ns.t('UserOnlineMonitor.currentSessionCount')"
                    :value="selectedDetail.currentSessionCount" /></el-card
              ></el-col>
              <el-col :span="8"
                ><el-card shadow="never" class="stats-card"
                  ><el-statistic
                    :title="i18ns.t('UserOnlineMonitor.totalSessions')"
                    :value="selectedDetail.totalSessions" /></el-card
              ></el-col>
              <el-col :span="8"
                ><el-card shadow="never" class="stats-card"
                  ><el-statistic
                    :title="i18ns.t('UserOnlineMonitor.totalDuration')"
                    :value="formatDuration(selectedDetail.totalDurationSeconds)" /></el-card
              ></el-col>
            </el-row>

            <el-descriptions :column="1" border>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.statusLabel')">{{
                selectedDetail.isOnline
                  ? i18ns.t('UserOnlineMonitor.online')
                  : i18ns.t('UserOnlineMonitor.offline')
              }}</el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.latestIpAddress')">{{
                selectedDetail.latestIpAddress || '-'
              }}</el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.latestLocation')">{{
                selectedDetail.latestLocation || '-'
              }}</el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.latestUserAgent')">
                <div class="user-agent-text">{{ selectedDetail.latestUserAgent || '-' }}</div>
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.latestStartedAt')">{{
                formatDateTime(selectedDetail.latestStartedAt)
              }}</el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.latestHeartbeatAt')">{{
                formatDateTime(selectedDetail.latestHeartbeatAt)
              }}</el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('UserOnlineMonitor.latestEndedAt')">{{
                formatDateTime(selectedDetail.latestEndedAt)
              }}</el-descriptions-item>
            </el-descriptions>

            <div class="detail-toolbar">
              <el-date-picker
                v-model="detailDateRange"
                type="datetimerange"
                :start-placeholder="i18ns.t('UserOnlineMonitor.startDate')"
                :end-placeholder="i18ns.t('UserOnlineMonitor.endDate')"
                :unlink-panels="true"
                @change="handleDetailDateRangeChange"
              />
              <el-button
                type="danger"
                :disabled="!selectedDetail.isOnline"
                @click="handleForceOfflineUser"
              >
                {{ i18ns.t('UserOnlineMonitor.forceOfflineUser') }}
              </el-button>
              <el-dropdown @command="handleExportCommand">
                <el-button>
                  {{ i18ns.t('UserOnlineMonitor.export') }}
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="csv">{{
                      i18ns.t('UserOnlineMonitor.exportCsv')
                    }}</el-dropdown-item>
                    <el-dropdown-item command="json">{{
                      i18ns.t('UserOnlineMonitor.exportJson')
                    }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <div class="timeline-group-section">
              <div class="timeline-header">
                {{ i18ns.t('UserOnlineMonitor.currentOnlineSessions') }}
              </div>
              <div v-if="onlineTimelineItems.length" class="timeline-card-list">
                <el-card
                  v-for="item in onlineTimelineItems"
                  :key="item.sessionId"
                  shadow="never"
                  class="timeline-card"
                >
                  <div class="timeline-item-title">
                    {{ formatDateTime(item.startedAt) }} ·
                    {{ formatDuration(item.durationSeconds) }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.ipAddress') }}: {{ item.ipAddress }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.location') }}: {{ item.location || '-' }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.userAgent') }}: {{ item.userAgent || '-' }}
                  </div>
                  <div class="timeline-item-actions">
                    <el-button
                      type="danger"
                      link
                      @click="handleForceOfflineSession(item.sessionId)"
                    >
                      {{ i18ns.t('UserOnlineMonitor.forceOfflineSession') }}
                    </el-button>
                  </div>
                </el-card>
              </div>
              <el-empty v-else :description="i18ns.t('UserOnlineMonitor.noOnlineSessions')" />
            </div>

            <div class="timeline-section">
              <div class="timeline-header">{{ i18ns.t('UserOnlineMonitor.timelineTitle') }}</div>
              <el-timeline>
                <el-timeline-item
                  v-for="item in offlineTimelineItems"
                  :key="item.sessionId"
                  :timestamp="formatDateTime(item.startedAt)"
                  type="info"
                >
                  <div class="timeline-item-title">
                    {{ formatDuration(item.durationSeconds) }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.ipAddress') }}: {{ item.ipAddress }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.location') }}: {{ item.location || '-' }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.userAgent') }}: {{ item.userAgent || '-' }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.lastHeartbeatAt') }}:
                    {{ formatDateTime(item.lastHeartbeatAt) }}
                  </div>
                  <div class="timeline-item-meta">
                    {{ i18ns.t('UserOnlineMonitor.endedAt') }}: {{ formatDateTime(item.endedAt) }}
                  </div>
                </el-timeline-item>
              </el-timeline>

              <div class="pagination-wrapper detail-pagination">
                <el-pagination
                  v-model:current-page="timelinePage"
                  v-model:page-size="timelinePageSize"
                  :page-sizes="[10, 20, 50]"
                  :total="timelineTotal"
                  layout="total, sizes, prev, pager, next"
                  @current-change="handleTimelinePageChange"
                  @size-change="handleTimelinePageSizeChange"
                />
              </div>
            </div>
          </template>
        </div>
      </el-drawer>
    </div>
  </div>
  <div v-else class="mobile-page user-online-monitor-mobile-adapter">
    <div class="user-online-monitor page-shell">
      <el-card class="mobile-card" v-loading="loading">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('UserOnlineMonitor.title') }}</span>
            <el-button :icon="Refresh" type="primary" @click="loadOverview">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <div class="mobile-stats-grid">
          <el-card shadow="never" class="stats-card"
            ><el-statistic
              :title="i18ns.t('UserOnlineMonitor.onlineUsers')"
              :value="stats.onlineUsers"
          /></el-card>
          <el-card shadow="never" class="stats-card"
            ><el-statistic
              :title="i18ns.t('UserOnlineMonitor.activeSessions')"
              :value="stats.activeSessions"
          /></el-card>
        </div>

        <el-form :model="filters" label-position="top">
          <el-form-item :label="i18ns.t('UserOnlineMonitor.keyword')">
            <el-input
              v-model="filters.keyword"
              :placeholder="i18ns.t('UserOnlineMonitor.keywordPlaceholder')"
              clearable
              @change="handleFilterChange"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('UserOnlineMonitor.statusFilter')">
            <el-select v-model="filters.status" clearable @change="handleFilterChange">
              <el-option :label="i18ns.t('UserOnlineMonitor.online')" value="online" />
              <el-option :label="i18ns.t('UserOnlineMonitor.offline')" value="offline" />
            </el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('UserOnlineMonitor.ipAddress')">
            <el-input
              v-model="filters.ipAddress"
              :placeholder="i18ns.t('UserOnlineMonitor.ipPlaceholder')"
              clearable
              @change="handleFilterChange"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('UserOnlineMonitor.locationFilter')">
            <el-input
              v-model="filters.location"
              :placeholder="i18ns.t('UserOnlineMonitor.locationPlaceholder')"
              clearable
              @change="handleFilterChange"
            />
          </el-form-item>
        </el-form>

        <div v-if="items.length" class="session-card-list">
          <el-card
            v-for="item in items"
            :key="item.sessionId"
            class="session-card mobile-card"
            shadow="never"
          >
            <div class="session-card__header">
              <div>
                <div class="session-card__title">{{ item.username }}</div>
                <div class="session-card__subtitle">{{ item.name || '-' }}</div>
              </div>
              <el-tag :type="item.isOnline ? 'success' : 'info'">{{
                item.isOnline
                  ? i18ns.t('UserOnlineMonitor.online')
                  : i18ns.t('UserOnlineMonitor.offline')
              }}</el-tag>
            </div>
            <div class="session-card__meta">
              <div>{{ i18ns.t('UserOnlineMonitor.ipAddress') }}: {{ item.ipAddress }}</div>
              <div>{{ i18ns.t('UserOnlineMonitor.location') }}: {{ item.location || '-' }}</div>
              <div>
                {{ i18ns.t('UserOnlineMonitor.lastHeartbeatAt') }}:
                {{ formatDateTime(item.lastHeartbeatAt) }}
              </div>
              <div>
                {{ i18ns.t('UserOnlineMonitor.endedAt') }}: {{ formatDateTime(item.endedAt) }}
              </div>
              <div>
                {{ i18ns.t('UserOnlineMonitor.duration') }}:
                {{ formatDuration(item.durationSeconds) }}
              </div>
            </div>
            <div class="session-card__actions">
              <el-button link type="primary" @click="openDetail(item.userId)">
                {{ i18ns.t('UserOnlineMonitor.viewDetail') }}
              </el-button>
            </div>
          </el-card>
        </div>
        <el-empty v-else />

        <div class="pagination-wrapper mobile-pagination">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="total"
            layout="total, prev, pager, next"
            @current-change="handlePageChange"
            @size-change="handlePageSizeChange"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import systemService from '@/service/systemService'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { authorizationService } from '@/service/authorizationService'
import router from '@/router'
import { usePageDevice } from '@/composables/usePageDevice'
import { usePagination } from '@/composables/usePagination'
import { i18ns } from '@/locales'
import { formatDateTime, formatDuration } from '@/utils/timeUtils'
import { isRequestCanceled } from '@/utils/error-utils'
import type {
  UserOnlineMonitorDetailDto,
  UserOnlineMonitorOverviewItemDto,
  UserOnlineMonitorStatsDto,
  UserOnlineMonitorTimelineItemDto,
} from '@/client/types.gen'

const { isDesktop } = usePageDevice()
const userInfoStore = useUserInfoStore()
const items = ref<UserOnlineMonitorOverviewItemDto[]>([])
const selectedDetail = ref<UserOnlineMonitorDetailDto | null>(null)
const timelineItems = ref<UserOnlineMonitorTimelineItemDto[]>([])
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailDateRange = ref<[Date, Date] | null>(null)
const timelinePage = ref(1)
const timelinePageSize = ref(10)
const timelineTotal = ref(0)
const stats = reactive<UserOnlineMonitorStatsDto>({
  onlineUsers: 0,
  offlineUsers: 0,
  activeSessions: 0,
  averageDurationSeconds: 0,
})
const filters = reactive({
  keyword: '',
  status: '' as '' | 'online' | 'offline',
  ipAddress: '',
  location: '',
})

const {
  loading,
  page: currentPage,
  pageSize,
  total,
  resetToFirstPage,
  setPage,
  setPageSize,
  applyResult,
  beginRequest,
  isRequestCurrent,
  finalizeRequest,
} = usePagination({
  initialPage: 1,
  initialPageSize: 20,
  bounds: {
    pageSizeMax: 100,
    pageSizeDefault: 20,
  },
})

const loadOverview = async () => {
  const requestContext = beginRequest()

  try {
    const data = await systemService.getUserOnlineMonitorOverview(
      currentPage.value,
      pageSize.value,
      {
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
        ipAddress: filters.ipAddress || undefined,
        location: filters.location || undefined,
      },
      requestContext.signal,
    )

    if (!isRequestCurrent(requestContext.requestId)) return

    items.value = data.items
    stats.onlineUsers = data.stats.onlineUsers
    stats.offlineUsers = data.stats.offlineUsers
    stats.activeSessions = data.stats.activeSessions
    stats.averageDurationSeconds = data.stats.averageDurationSeconds
    applyResult(data)
  } catch (error) {
    if (!isRequestCurrent(requestContext.requestId) || isRequestCanceled(error)) return

    ElMessage.error(i18ns.t('UserOnlineMonitor.loadFailed'))
    console.error('Failed to load online monitor overview:', error)
  } finally {
    if (!isRequestCurrent(requestContext.requestId)) return
    finalizeRequest(requestContext)
  }
}

const handleFilterChange = () => {
  resetToFirstPage()
  loadOverview()
}

const handlePageChange = (page: number) => {
  setPage(page)
  loadOverview()
}

const handlePageSizeChange = (size: number) => {
  setPageSize(size)
  resetToFirstPage()
  loadOverview()
}

const onlineTimelineItems = computed(() => timelineItems.value.filter((item) => item.isOnline))
const offlineTimelineItems = computed(() => timelineItems.value.filter((item) => !item.isOnline))

const loadTimeline = async (userId: string) => {
  const timeline = await systemService.getUserOnlineMonitorTimeline(
    userId,
    timelinePage.value,
    timelinePageSize.value,
    {
      startDate: detailDateRange.value?.[0]?.toISOString(),
      endDate: detailDateRange.value?.[1]?.toISOString(),
    },
  )
  timelineItems.value = timeline.items
  timelineTotal.value = timeline.total
}

const openDetail = async (userId: string) => {
  detailVisible.value = true
  detailLoading.value = true
  try {
    timelinePage.value = 1
    const [detail, timeline] = await Promise.all([
      systemService.getUserOnlineMonitorDetail(userId),
      systemService.getUserOnlineMonitorTimeline(
        userId,
        timelinePage.value,
        timelinePageSize.value,
      ),
    ])
    selectedDetail.value = detail
    timelineItems.value = timeline.items
    timelineTotal.value = timeline.total
  } catch (error) {
    ElMessage.error(i18ns.t('UserOnlineMonitor.loadDetailFailed'))
    console.error('Failed to load online monitor detail:', error)
  } finally {
    detailLoading.value = false
  }
}

const handleDetailDateRangeChange = async () => {
  if (!selectedDetail.value) return
  timelinePage.value = 1
  detailLoading.value = true
  try {
    await loadTimeline(selectedDetail.value.userId)
  } catch (_err) {
    ElMessage.error(i18ns.t('UserOnlineMonitor.loadDetailFailed'))
  } finally {
    detailLoading.value = false
  }
}

const handleTimelinePageChange = async (page: number) => {
  if (!selectedDetail.value) return
  timelinePage.value = page
  detailLoading.value = true
  try {
    await loadTimeline(selectedDetail.value.userId)
  } finally {
    detailLoading.value = false
  }
}

const handleTimelinePageSizeChange = async (size: number) => {
  if (!selectedDetail.value) return
  timelinePageSize.value = size
  timelinePage.value = 1
  detailLoading.value = true
  try {
    await loadTimeline(selectedDetail.value.userId)
  } finally {
    detailLoading.value = false
  }
}

const handleForceOfflineSession = async (sessionId: string) => {
  await ElMessageBox.confirm(
    i18ns.t('UserOnlineMonitor.forceOfflineSessionConfirm'),
    i18ns.t('warning'),
    { type: 'warning' },
  )
  const response = await systemService.forceOfflineSession(sessionId)
  ElMessage.success(i18ns.t('UserOnlineMonitor.forceOfflineSuccess'))

  if ((response as any)?.currentSessionAffected) {
    void authorizationService.logout(router.currentRoute.value?.fullPath)
    return
  }

  if (selectedDetail.value) {
    await openDetail(selectedDetail.value.userId)
    await loadOverview()
  }
}

const handleForceOfflineUser = async () => {
  if (!selectedDetail.value) return
  const targetUserId = selectedDetail.value.userId
  await ElMessageBox.confirm(
    i18ns.t('UserOnlineMonitor.forceOfflineUserConfirm', {
      username: selectedDetail.value.username,
    }),
    i18ns.t('warning'),
    { type: 'warning' },
  )
  await systemService.forceOfflineUser(targetUserId)
  ElMessage.success(i18ns.t('UserOnlineMonitor.forceOfflineSuccess'))

  if (targetUserId === userInfoStore.userInfo.id) {
    void authorizationService.logout(router.currentRoute.value?.fullPath)
    return
  }

  await openDetail(targetUserId)
  await loadOverview()
}

const buildExportRowsFromItems = (sourceItems: UserOnlineMonitorTimelineItemDto[]) => {
  return sourceItems.map((item) => ({
    sessionId: item.sessionId,
    authSessionId: item.authSessionId,
    startedAt: item.startedAt,
    lastHeartbeatAt: item.lastHeartbeatAt,
    endedAt: item.endedAt || '',
    durationSeconds: item.durationSeconds,
    duration: formatDuration(item.durationSeconds),
    ipAddress: item.ipAddress,
    location: item.location || '',
    userAgent: item.userAgent || '',
    isOnline: item.isOnline,
  }))
}

const fetchAllTimelineRows = async () => {
  if (!selectedDetail.value) return []

  const pageSizeForExport = 100
  const firstPage = await systemService.getUserOnlineMonitorTimeline(
    selectedDetail.value.userId,
    1,
    pageSizeForExport,
    {
      startDate: detailDateRange.value?.[0]?.toISOString(),
      endDate: detailDateRange.value?.[1]?.toISOString(),
    },
  )

  const totalPages = Math.max(1, Math.ceil(firstPage.total / pageSizeForExport))
  if (totalPages === 1) return firstPage.items

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      systemService.getUserOnlineMonitorTimeline(
        selectedDetail.value!.userId,
        index + 2,
        pageSizeForExport,
        {
          startDate: detailDateRange.value?.[0]?.toISOString(),
          endDate: detailDateRange.value?.[1]?.toISOString(),
        },
      ),
    ),
  )

  return [firstPage.items, ...remainingPages.map((page: typeof firstPage) => page.items)].flat()
}
const downloadFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const exportTimelineAsJson = async () => {
  if (!selectedDetail.value) return
  const allItems = await fetchAllTimelineRows()
  const payload = {
    user: selectedDetail.value,
    timeline: buildExportRowsFromItems(allItems),
    range: {
      startDate: detailDateRange.value?.[0]?.toISOString(),
      endDate: detailDateRange.value?.[1]?.toISOString(),
    },
    exportedAt: new Date().toISOString(),
  }
  downloadFile(
    `user-online-monitor-${selectedDetail.value.username || selectedDetail.value.userId}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8',
  )
}

const toCsvValue = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`

const exportTimelineAsCsv = async () => {
  if (!selectedDetail.value) return
  const allItems = await fetchAllTimelineRows()
  const rows = buildExportRowsFromItems(allItems)
  const headers = [
    'sessionId',
    'authSessionId',
    'startedAt',
    'lastHeartbeatAt',
    'endedAt',
    'durationSeconds',
    'duration',
    'ipAddress',
    'location',
    'userAgent',
    'isOnline',
  ]
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => toCsvValue(row[header as keyof typeof row])).join(','),
    ),
  ].join('\n')

  downloadFile(
    `user-online-monitor-${selectedDetail.value.username || selectedDetail.value.userId}.csv`,
    `\uFEFF${csv}`,
    'text/csv;charset=utf-8',
  )
}

const handleExportCommand = async (command: string) => {
  if (command === 'csv') {
    await exportTimelineAsCsv()
    return
  }
  await exportTimelineAsJson()
}

onMounted(() => {
  void loadOverview()
})
</script>

<style scoped>
.page-shell {
  padding: 20px;
}

.stats-row {
  margin-bottom: 20px;
}

.stats-card {
  border-radius: 12px;
}

.filters-row {
  margin-bottom: 16px;
}

.pagination-wrapper {
  margin-top: 20px;
}

.mobile-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.session-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.session-card__title {
  font-size: 15px;
  font-weight: 600;
}

.session-card__subtitle,
.session-card__meta {
  color: var(--el-text-color-secondary);
}

.session-card__meta {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.session-card__actions {
  margin-top: 8px;
}

.detail-drawer {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.timeline-group-section {
  margin-top: 16px;
}

.timeline-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline-card {
  border-radius: 10px;
}

.timeline-item-actions {
  margin-top: 6px;
}

.detail-pagination {
  margin-top: 16px;
}

.timeline-section {
  margin-top: 16px;
}

.timeline-header {
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 600;
}

.timeline-item-title {
  font-weight: 600;
}

.timeline-item-meta {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.user-agent-text {
  white-space: normal;
  word-break: break-all;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .page-shell {
    padding: 8px 6px 16px;
  }
}
</style>
