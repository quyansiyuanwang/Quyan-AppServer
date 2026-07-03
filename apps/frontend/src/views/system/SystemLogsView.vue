<template>
  <div :class="['system-logs-page', { 'system-logs-mobile-adapter': !isDesktop }]">
    <div class="system-logs-container">
      <el-card class="logs-card page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('SystemLogs.title') }}</span>
            <el-button
              type="primary"
              :icon="Refresh"
              @click="handleRefresh"
              :loading="activeLoading"
            >
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <el-tabs
          v-if="canViewAnyLogs"
          v-model="activeTab"
          class="logs-tabs"
          @tab-change="handleTabChange"
        >
          <el-tab-pane v-if="canViewApiLogs" :label="i18ns.t('SystemLogs.apiLogsTab')" name="api">
            <div v-loading="apiLoading">
              <div class="filters-container">
                <el-form :inline="true" :model="filters" class="toolbar-row">
                  <el-form-item :label="i18ns.t('SystemLogs.method')">
                    <el-select
                      v-model="filters.method"
                      class="multi-filter-select"
                      :placeholder="i18ns.t('SystemLogs.filterByMethod')"
                      clearable
                      multiple
                      collapse-tags
                      collapse-tags-tooltip
                      :max-collapse-tags="2"
                      :style="isDesktop ? { width: '220px' } : { width: '100%' }"
                      @change="handleFilterChange"
                    >
                      <el-option label="GET" value="GET" />
                      <el-option label="POST" value="POST" />
                      <el-option label="PUT" value="PUT" />
                      <el-option label="DELETE" value="DELETE" />
                      <el-option label="PATCH" value="PATCH" />
                    </el-select>
                  </el-form-item>

                  <el-form-item :label="i18ns.t('SystemLogs.path')">
                    <el-input
                      v-model="filters.path"
                      :placeholder="i18ns.t('SystemLogs.filterByPath')"
                      clearable
                      style="width: 100%; max-width: 200px"
                      @change="handleFilterChange"
                    />
                  </el-form-item>

                  <el-form-item :label="i18ns.t('SystemLogs.statusCode')">
                    <el-select
                      v-model="filters.statusCode"
                      class="multi-filter-select"
                      :placeholder="i18ns.t('SystemLogs.filterByStatus')"
                      clearable
                      multiple
                      collapse-tags
                      collapse-tags-tooltip
                      :max-collapse-tags="2"
                      :style="isDesktop ? { width: '260px' } : { width: '100%' }"
                      @change="handleFilterChange"
                    >
                      <el-option label="200 (OK)" :value="200" />
                      <el-option label="201 (Created)" :value="201" />
                      <el-option label="204 (No Content)" :value="204" />
                      <el-option label="301 (Moved Permanently)" :value="301" />
                      <el-option label="302 (Found)" :value="302" />
                      <el-option label="304 (Not Modified)" :value="304" />
                      <el-option label="307 (Temporary Redirect)" :value="307" />
                      <el-option label="308 (Permanent Redirect)" :value="308" />
                      <el-option label="400 (Bad Request)" :value="400" />
                      <el-option label="401 (Unauthorized)" :value="401" />
                      <el-option label="403 (Forbidden)" :value="403" />
                      <el-option label="404 (Not Found)" :value="404" />
                      <el-option label="405 (Method Not Allowed)" :value="405" />
                      <el-option label="409 (Conflict)" :value="409" />
                      <el-option label="422 (Unprocessable Entity)" :value="422" />
                      <el-option label="429 (Too Many Requests)" :value="429" />
                      <el-option label="500 (Internal Server Error)" :value="500" />
                      <el-option label="502 (Bad Gateway)" :value="502" />
                      <el-option label="503 (Service Unavailable)" :value="503" />
                      <el-option label="504 (Gateway Timeout)" :value="504" />
                    </el-select>
                  </el-form-item>

                  <el-form-item :label="i18ns.t('SystemLogs.user')">
                    <el-input
                      v-model="filters.user"
                      :placeholder="i18ns.t('SystemLogs.filterByUser')"
                      clearable
                      style="width: 100%; max-width: 200px"
                      @change="handleFilterChange"
                    />
                  </el-form-item>

                  <el-form-item :label="i18ns.t('SystemLogs.requestId')">
                    <el-input
                      v-model="filters.requestID"
                      :placeholder="i18ns.t('SystemLogs.filterByRequestId')"
                      clearable
                      style="width: 100%; max-width: 200px"
                      @change="handleFilterChange"
                    />
                  </el-form-item>

                  <el-form-item :label="i18ns.t('SystemLogs.ipAddress')">
                    <el-input
                      v-model="filters.ip"
                      :placeholder="i18ns.t('SystemLogs.filterByIp')"
                      clearable
                      style="width: 100%; max-width: 200px"
                      @change="handleFilterChange"
                    />
                  </el-form-item>

                  <el-form-item :label="i18ns.t('SystemLogs.dateRange')">
                    <el-date-picker
                      v-model="dateRange"
                      type="datetimerange"
                      :start-placeholder="i18ns.t('SystemLogs.startDate')"
                      :end-placeholder="i18ns.t('SystemLogs.endDate')"
                      :unlink-panels="true"
                      popper-class="mobile-datetime-range-popper"
                      style="width: 100%; max-width: 100%"
                      @change="handleDateRangeChange"
                    />
                  </el-form-item>

                  <el-form-item>
                    <el-button @click="clearFilters">
                      {{ i18ns.t('SystemLogs.clearFilters') }}
                    </el-button>
                  </el-form-item>
                </el-form>
              </div>

              <div class="stats-section" v-loading="apiStatsLoading">
                <el-row :gutter="16" class="summary-grid">
                  <el-col v-for="item in apiSummaryCards" :key="item.key" :xs="24" :sm="12" :lg="6">
                    <el-card class="summary-card" shadow="hover">
                      <div class="summary-label">{{ item.label }}</div>
                      <div class="summary-value">{{ item.value }}</div>
                      <div class="summary-hint">{{ item.hint }}</div>
                    </el-card>
                  </el-col>
                </el-row>

                <el-row :gutter="16" class="chart-grid">
                  <el-col :xs="24" :lg="14">
                    <el-card class="chart-card" shadow="never">
                      <template #header>
                        <div class="card-header">
                          <span class="card-title">{{ i18ns.t('SystemLogs.dailyTrend') }}</span>
                        </div>
                      </template>
                      <AsyncVChart class="chart" autoresize :option="apiDailyTrendOption" />
                    </el-card>
                  </el-col>
                  <el-col :xs="24" :lg="10">
                    <el-card class="chart-card" shadow="never">
                      <template #header>
                        <div class="card-header">
                          <span class="card-title">{{
                            i18ns.t('SystemLogs.methodDistribution')
                          }}</span>
                        </div>
                      </template>
                      <AsyncVChart class="chart" autoresize :option="apiMethodPieOption" />
                    </el-card>
                  </el-col>
                </el-row>

                <el-row :gutter="16" class="chart-grid">
                  <el-col :xs="24" :lg="12">
                    <el-card class="chart-card" shadow="never">
                      <template #header>
                        <div class="card-header">
                          <span class="card-title">{{
                            i18ns.t('SystemLogs.statusDistribution')
                          }}</span>
                        </div>
                      </template>
                      <AsyncVChart class="chart" autoresize :option="apiStatusBarOption" />
                    </el-card>
                  </el-col>
                  <el-col :xs="24" :lg="12">
                    <el-card class="chart-card" shadow="never">
                      <template #header>
                        <div class="card-header">
                          <span class="card-title">{{
                            i18ns.t('SystemLogs.pathDistribution')
                          }}</span>
                        </div>
                      </template>
                      <AsyncVChart class="chart" autoresize :option="apiPathBarOption" />
                    </el-card>
                  </el-col>
                </el-row>
              </div>

              <template v-if="isDesktop">
                <el-table
                  :data="logs"
                  style="width: 100%"
                  :expand-row-keys="expandedRows"
                  row-key="id"
                  @expand-change="handleExpandChange"
                >
                  <el-table-column type="expand">
                    <template #default="{ row }">
                      <div class="expand-content">
                        <div class="expand-grid">
                          <div class="expand-item compact-item">
                            <strong>{{ i18ns.t('SystemLogs.requestId') }}:</strong>
                            <span>{{ row.requestID }}</span>
                          </div>
                          <div class="expand-item compact-item">
                            <strong>{{ i18ns.t('SystemLogs.requestSize') }}:</strong>
                            <span>{{ row.requestSizeFormatted || '-' }}</span>
                          </div>
                          <div class="expand-item compact-item">
                            <strong>{{ i18ns.t('SystemLogs.requestSizeSource') }}:</strong>
                            <span>{{
                              getRequestSizeSourceLabel(requestSizeSourceCache[row.id])
                            }}</span>
                          </div>
                          <div class="expand-item compact-item">
                            <strong>{{ i18ns.t('SystemLogs.responseSize') }}:</strong>
                            <span>{{
                              getResponseSizeDisplay(row.id, row.responseSizeFormatted)
                            }}</span>
                          </div>
                        </div>

                        <div class="expand-item">
                          <strong>{{ i18ns.t('SystemLogs.queryParams') }}:</strong>
                          <pre>{{ formatJson(row.queryParams) }}</pre>
                        </div>

                        <div class="expand-item">
                          <strong>{{ i18ns.t('SystemLogs.bodyParams') }}:</strong>
                          <pre>{{ formatJson(row.bodyParams) }}</pre>
                        </div>

                        <div class="expand-item">
                          <strong>{{ i18ns.t('SystemLogs.requestHeaders') }}:</strong>
                          <pre>{{ formatJson(requestHeadersCache[row.id]) }}</pre>
                        </div>

                        <div class="expand-item">
                          <strong>{{ i18ns.t('SystemLogs.responseHeaders') }}:</strong>
                          <pre>{{ formatJson(responseHeadersCache[row.id]) }}</pre>
                        </div>

                        <div class="expand-item">
                          <strong>{{ i18ns.t('SystemLogs.response') }}:</strong>
                          <div
                            v-if="responseLoading[row.id]"
                            v-loading="true"
                            style="min-height: 40px"
                          />
                          <pre v-else-if="responseCache[row.id] !== undefined">{{
                            formatJson(responseCache[row.id])
                          }}</pre>
                          <el-text v-else type="info">{{
                            i18ns.t('SystemLogs.responseNotLoaded')
                          }}</el-text>
                        </div>
                      </div>
                    </template>
                  </el-table-column>

                  <el-table-column :label="i18ns.t('SystemLogs.timestamp')" width="180">
                    <template #default="{ row }">
                      {{ formatTimestamp(row.createTime) }}
                    </template>
                  </el-table-column>

                  <el-table-column
                    :label="i18ns.t('SystemLogs.userId')"
                    width="140"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row }">
                      <el-tag v-if="row.userID === null" type="info" size="small">
                        {{ i18ns.t('SystemLogs.anonymous') }}
                      </el-tag>
                      <span v-else class="truncate-text" :title="row.userID">{{ row.userID }}</span>
                    </template>
                  </el-table-column>

                  <el-table-column
                    :label="i18ns.t('SystemLogs.username')"
                    width="110"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row }">
                      <el-tag v-if="row.username === null" type="info" size="small">-</el-tag>
                      <span v-else class="truncate-text" :title="row.username">{{
                        row.username
                      }}</span>
                    </template>
                  </el-table-column>

                  <el-table-column
                    :label="i18ns.t('SystemLogs.method')"
                    width="100"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row }">
                      <el-tag
                        :type="getMethodType(row.method)"
                        size="small"
                        effect="dark"
                        class="method-tag"
                      >
                        {{ row.method }}
                      </el-tag>
                    </template>
                  </el-table-column>

                  <el-table-column :label="i18ns.t('SystemLogs.path')" min-width="220">
                    <template #default="{ row }">
                      {{ row.path }}
                    </template>
                  </el-table-column>

                  <el-table-column :label="i18ns.t('SystemLogs.requestSize')" width="120">
                    <template #default="{ row }">
                      <span>{{ row.requestSizeFormatted || '-' }}</span>
                    </template>
                  </el-table-column>

                  <el-table-column :label="i18ns.t('SystemLogs.responseSize')" width="120">
                    <template #default="{ row }">
                      <span>{{ getResponseSizeDisplay(row.id, row.responseSizeFormatted) }}</span>
                    </template>
                  </el-table-column>

                  <el-table-column :label="i18ns.t('SystemLogs.statusCode')" width="100">
                    <template #default="{ row }">
                      <el-tag
                        :type="getStatusType(row.statusCode)"
                        size="small"
                        effect="light"
                        class="status-code-tag"
                      >
                        {{ row.statusCode }}
                      </el-tag>
                    </template>
                  </el-table-column>

                  <el-table-column
                    :label="i18ns.t('SystemLogs.ipAddress')"
                    width="150"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row }">
                      {{ row.ipAddress }}
                    </template>
                  </el-table-column>
                </el-table>

                <el-pagination
                  v-model:current-page="currentPage"
                  v-model:page-size="pageSize"
                  :page-sizes="[10, 20, 50, 100]"
                  :total="total"
                  layout="total, sizes, prev, pager, next, jumper"
                  @size-change="handleSizeChange"
                  @current-change="handlePageChange"
                  style="margin-top: 20px; justify-content: center"
                />
              </template>

              <template v-else>
                <el-skeleton :loading="apiLoading" :rows="5" animated>
                  <div v-if="logs.length" class="log-card-list">
                    <el-card
                      v-for="row in logs"
                      :key="row.id"
                      class="log-card mobile-card"
                      shadow="never"
                    >
                      <div class="log-head">
                        <el-tag
                          :type="getMethodType(row.method)"
                          size="small"
                          effect="dark"
                          class="method-tag"
                        >
                          {{ row.method }}
                        </el-tag>
                        <el-tag
                          :type="getStatusType(row.statusCode)"
                          size="small"
                          effect="light"
                          class="status-code-tag"
                        >
                          {{ row.statusCode }}
                        </el-tag>
                      </div>
                      <div class="log-meta">
                        <div>
                          {{ i18ns.t('SystemLogs.timestamp') }}:
                          {{ formatTimestamp(row.createTime) }}
                        </div>
                        <div>{{ i18ns.t('SystemLogs.path') }}: {{ row.path }}</div>
                        <div>
                          {{ i18ns.t('SystemLogs.requestSize') }}:
                          {{ row.requestSizeFormatted || '-' }}
                        </div>
                        <div>
                          {{ i18ns.t('SystemLogs.responseSize') }}:
                          {{ getResponseSizeDisplay(row.id, row.responseSizeFormatted) }}
                        </div>
                        <div>
                          {{ i18ns.t('SystemLogs.userId') }}:
                          {{ row.userID || i18ns.t('SystemLogs.anonymous') }}
                        </div>
                        <div>{{ i18ns.t('SystemLogs.username') }}: {{ row.username || '-' }}</div>
                        <div>{{ i18ns.t('SystemLogs.ipAddress') }}: {{ row.ipAddress || '-' }}</div>
                        <div>{{ i18ns.t('SystemLogs.requestId') }}: {{ row.requestID || '-' }}</div>
                      </div>

                      <el-collapse
                        class="log-details"
                        accordion
                        @change="ensureLogDetailLoaded(row)"
                      >
                        <el-collapse-item
                          :title="i18ns.t('SystemLogs.response')"
                          :name="`sys-log-${row.id}`"
                        >
                          <div class="expand-item compact-item">
                            <strong>{{ i18ns.t('SystemLogs.requestSizeSource') }}:</strong>
                            <span>{{
                              getRequestSizeSourceLabel(requestSizeSourceCache[row.id])
                            }}</span>
                          </div>
                          <div class="expand-item compact-item">
                            <strong>{{ i18ns.t('SystemLogs.responseSize') }}:</strong>
                            <span>{{
                              getResponseSizeDisplay(row.id, row.responseSizeFormatted)
                            }}</span>
                          </div>
                          <div class="expand-item">
                            <strong>{{ i18ns.t('SystemLogs.queryParams') }}:</strong>
                            <pre>{{ formatJson(row.queryParams) }}</pre>
                          </div>
                          <div class="expand-item">
                            <strong>{{ i18ns.t('SystemLogs.bodyParams') }}:</strong>
                            <pre>{{ formatJson(row.bodyParams) }}</pre>
                          </div>
                          <div class="expand-item">
                            <strong>{{ i18ns.t('SystemLogs.requestHeaders') }}:</strong>
                            <pre>{{ formatJson(requestHeadersCache[row.id]) }}</pre>
                          </div>
                          <div class="expand-item">
                            <strong>{{ i18ns.t('SystemLogs.responseHeaders') }}:</strong>
                            <pre>{{ formatJson(responseHeadersCache[row.id]) }}</pre>
                          </div>
                          <div class="expand-item">
                            <strong>{{ i18ns.t('SystemLogs.response') }}:</strong>
                            <div
                              v-if="responseLoading[row.id]"
                              v-loading="true"
                              style="min-height: 40px"
                            />
                            <pre v-else-if="responseCache[row.id] !== undefined">{{
                              formatJson(responseCache[row.id])
                            }}</pre>
                            <el-text v-else type="info">{{
                              i18ns.t('SystemLogs.responseNotLoaded')
                            }}</el-text>
                          </div>
                        </el-collapse-item>
                      </el-collapse>
                    </el-card>
                  </div>
                  <el-empty v-else />
                </el-skeleton>

                <el-pagination
                  v-model:current-page="currentPage"
                  v-model:page-size="pageSize"
                  :page-sizes="[10, 20, 50, 100]"
                  :total="total"
                  layout="prev, pager, next"
                  @size-change="handleSizeChange"
                  @current-change="handlePageChange"
                  class="pager-wrap"
                />
              </template>
            </div>
          </el-tab-pane>

          <el-tab-pane
            v-if="canViewServerLogs"
            :label="i18ns.t('SystemLogs.serverLogsTab')"
            name="server"
          >
            <div class="server-toolbar filters-container">
              <el-form :inline="true" class="toolbar-row">
                <el-form-item :label="i18ns.t('SystemLogs.serverLogType')">
                  <el-select
                    v-model="serverLogType"
                    style="width: 180px"
                    @change="handleServerLogTypeChange"
                  >
                    <el-option :label="i18ns.t('SystemLogs.combinedLog')" value="combined" />
                    <el-option :label="i18ns.t('SystemLogs.errorLog')" value="error" />
                  </el-select>
                </el-form-item>

                <el-form-item :label="i18ns.t('SystemLogs.latestLines')">
                  <el-input-number
                    v-model="serverLines"
                    :min="1"
                    :max="2000"
                    :step="50"
                    @change="handleServerContentParamsChange"
                  />
                </el-form-item>

                <el-form-item :label="i18ns.t('SystemLogs.search')">
                  <el-input
                    v-model="serverSearch"
                    clearable
                    :placeholder="i18ns.t('SystemLogs.searchPlaceholder')"
                    style="width: 260px"
                    @keyup.enter="loadSelectedServerLogContent"
                  />
                </el-form-item>

                <el-form-item>
                  <el-button @click="loadSelectedServerLogContent" :loading="serverContentLoading">
                    {{ i18ns.t('SystemLogs.loadContent') }}
                  </el-button>
                </el-form-item>

                <el-form-item>
                  <el-button @click="loadServerLogFiles" :loading="serverFilesLoading">
                    {{ i18ns.t('SystemLogs.refreshFiles') }}
                  </el-button>
                </el-form-item>
              </el-form>
            </div>

            <div class="server-logs-layout">
              <div class="server-files-panel" v-loading="serverFilesLoading">
                <div class="panel-title-row">
                  <span class="panel-title">{{ i18ns.t('SystemLogs.serverLogFiles') }}</span>
                  <el-tag size="small" type="info">{{ serverLogFiles.length }}</el-tag>
                </div>

                <div v-if="serverLogFiles.length" class="server-file-list">
                  <button
                    v-for="file in serverLogFiles"
                    :key="file.name"
                    type="button"
                    class="server-file-item"
                    :class="{ active: file.name === selectedServerLogFileName }"
                    @click="selectServerLogFile(file.name)"
                  >
                    <div class="server-file-main">
                      <span class="server-file-name">{{ file.name }}</span>
                      <el-tag size="small" :type="file.type === 'error' ? 'danger' : 'success'">
                        {{
                          file.type === 'error'
                            ? i18ns.t('SystemLogs.errorLog')
                            : i18ns.t('SystemLogs.combinedLog')
                        }}
                      </el-tag>
                    </div>
                    <div class="server-file-meta">
                      <span>{{ formatTimestamp(file.modifiedTime) }}</span>
                      <span>{{ formatBytes(file.sizeBytes) }}</span>
                    </div>
                  </button>
                </div>
                <el-empty v-else :description="i18ns.t('SystemLogs.noServerLogFiles')" />
              </div>

              <div class="server-content-panel" v-loading="serverContentLoading">
                <template v-if="serverLogContent">
                  <div class="panel-title-row panel-title-row-wrap">
                    <span class="panel-title">{{ i18ns.t('SystemLogs.serverLogContent') }}</span>
                    <div class="server-content-tags">
                      <el-tag
                        size="small"
                        :type="serverLogContent.file.type === 'error' ? 'danger' : 'success'"
                      >
                        {{
                          serverLogContent.file.type === 'error'
                            ? i18ns.t('SystemLogs.errorLog')
                            : i18ns.t('SystemLogs.combinedLog')
                        }}
                      </el-tag>
                      <el-tag size="small" type="info">{{
                        formatBytes(serverLogContent.file.sizeBytes)
                      }}</el-tag>
                      <el-tag v-if="serverLogContent.file.compressed" size="small" type="warning">
                        gzip
                      </el-tag>
                    </div>
                  </div>

                  <div class="server-content-meta">
                    <div>
                      <strong>{{ i18ns.t('SystemLogs.fileName') }}:</strong>
                      {{ serverLogContent.file.name }}
                    </div>
                    <div>
                      <strong>{{ i18ns.t('SystemLogs.modifiedTime') }}:</strong>
                      {{ formatTimestamp(serverLogContent.file.modifiedTime) }}
                    </div>
                    <div>
                      <strong>{{ i18ns.t('SystemLogs.totalLines') }}:</strong>
                      {{ serverLogContent.totalLineCount }}
                    </div>
                    <div>
                      <strong>{{ i18ns.t('SystemLogs.matchedLines') }}:</strong>
                      {{ serverLogContent.matchedLineCount }}
                    </div>
                    <div>
                      <strong>{{ i18ns.t('SystemLogs.returnedLines') }}:</strong>
                      {{ serverLogContent.returnedLines }}
                    </div>
                    <div v-if="serverLogContent.search">
                      <strong>{{ i18ns.t('SystemLogs.search') }}:</strong>
                      {{ serverLogContent.search }}
                    </div>
                  </div>

                  <el-alert
                    v-if="serverLogContent.truncated"
                    type="info"
                    :closable="false"
                    class="server-log-alert"
                  >
                    {{ i18ns.t('SystemLogs.truncatedHint') }}
                  </el-alert>

                  <pre class="server-log-pre">{{ serverLogContent.content || '' }}</pre>
                </template>

                <el-empty
                  v-else
                  :description="
                    selectedServerLogFileName
                      ? i18ns.t('SystemLogs.noServerLogContent')
                      : i18ns.t('SystemLogs.noServerLogSelected')
                  "
                />
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>

        <el-empty v-else :description="i18ns.t('permissionText.noPermissions')" />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import type {
  ServerLogContentDto,
  ServerLogFileInfoDto,
  ServerLogType,
  SystemLogServiceDto,
} from '@/client/types.gen'
import { usePageDevice } from '@/composables/usePageDevice'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import systemService from '@/service/systemService'
import { usePermissionStore } from '@/stores/permissionStore'
import { AsyncVChart } from '@/utils/asyncChart'

interface SystemLogStatsSummary {
  totalRequests: number
  successRequests: number
  redirectRequests: number
  clientErrorRequests: number
  serverErrorRequests: number
  uniqueUsers: number
  anonymousRequests: number
  uniqueIPs: number
}

interface SystemLogStatsDaily {
  date: string
  totalRequests: number
  successRequests: number
  clientErrorRequests: number
  serverErrorRequests: number
}

interface StatsBreakdownItem {
  key: string
  label: string
  count: number
  share: number
}

interface StatsDailyBreakdownItem {
  date: string
  key: string
  label: string
  count: number
}

interface SystemLogStats {
  range: {
    startDate: string
    endDate: string
    days: number
  }
  summary: SystemLogStatsSummary
  daily: SystemLogStatsDaily[]
  byMethod: StatsBreakdownItem[]
  byStatusCode: StatsBreakdownItem[]
  byPath: StatsBreakdownItem[]
  methodDailyDistribution: StatsDailyBreakdownItem[]
  statusDailyDistribution: StatsDailyBreakdownItem[]
  generatedAt: string
}

const emptyApiStats = (): SystemLogStats => ({
  range: {
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    days: 1,
  },
  summary: {
    totalRequests: 0,
    successRequests: 0,
    redirectRequests: 0,
    clientErrorRequests: 0,
    serverErrorRequests: 0,
    uniqueUsers: 0,
    anonymousRequests: 0,
    uniqueIPs: 0,
  },
  daily: [],
  byMethod: [],
  byStatusCode: [],
  byPath: [],
  methodDailyDistribution: [],
  statusDailyDistribution: [],
  generatedAt: new Date().toISOString(),
})

const { isDesktop } = usePageDevice()
const permissionStore = usePermissionStore()

const activeTab = ref<'api' | 'server'>('api')

const apiLoading = ref(false)
const apiStatsLoading = ref(false)
const logs = ref<SystemLogServiceDto[]>([])
const apiStats = ref<SystemLogStats>(emptyApiStats())
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const expandedRows = ref<string[]>([])
const dateRange = ref<[Date, Date] | null>(null)
const responseCache = ref<Record<string, unknown>>({})
const responseLoading = ref<Record<string, boolean>>({})
const requestHeadersCache = ref<Record<string, unknown>>({})
const responseHeadersCache = ref<Record<string, unknown>>({})
const requestSizeSourceCache = ref<Record<string, string | null>>({})
const responseSizeFormattedCache = ref<Record<string, string | null>>({})

const serverFilesLoading = ref(false)
const serverContentLoading = ref(false)
const serverLogType = ref<ServerLogType>('combined')
const serverLogFiles = ref<ServerLogFileInfoDto[]>([])
const selectedServerLogFileName = ref<string>('')
const serverLogContent = ref<ServerLogContentDto | null>(null)
const serverLines = ref(200)
const serverSearch = ref('')

const filters = ref({
  method: [] as string[],
  path: undefined as string | undefined,
  statusCode: [] as number[],
  user: undefined as string | undefined,
  requestID: undefined as string | undefined,
  ip: undefined as string | undefined,
  startDate: undefined as string | undefined,
  endDate: undefined as string | undefined,
})

const activeLoading = computed(() =>
  activeTab.value === 'api'
    ? apiLoading.value
    : serverFilesLoading.value || serverContentLoading.value,
)

const canViewApiLogs = computed(() =>
  permissionStore.hasAnyPermission(Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ),
)

const canViewServerLogs = computed(() =>
  permissionStore.hasPermission(Permission.SYSTEM_SERVER_LOG_READ),
)

const canViewAnyLogs = computed(() => canViewApiLogs.value || canViewServerLogs.value)

const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString()

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '-'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

const formatNumber = (value: number) => new Intl.NumberFormat().format(value)

const apiSummaryCards = computed(() => [
  {
    key: 'totalRequests',
    label: i18ns.t('SystemLogs.totalRequests'),
    value: formatNumber(apiStats.value.summary.totalRequests),
    hint: `${i18ns.t('SystemLogs.uniqueUsers')}: ${formatNumber(apiStats.value.summary.uniqueUsers)}`,
  },
  {
    key: 'successRequests',
    label: i18ns.t('SystemLogs.successRequests'),
    value: formatNumber(apiStats.value.summary.successRequests),
    hint: `${i18ns.t('SystemLogs.redirectRequests')}: ${formatNumber(apiStats.value.summary.redirectRequests)}`,
  },
  {
    key: 'clientErrorRequests',
    label: i18ns.t('SystemLogs.clientErrors'),
    value: formatNumber(apiStats.value.summary.clientErrorRequests),
    hint: `${i18ns.t('SystemLogs.serverErrors')}: ${formatNumber(apiStats.value.summary.serverErrorRequests)}`,
  },
  {
    key: 'uniqueIPs',
    label: i18ns.t('SystemLogs.uniqueIps'),
    value: formatNumber(apiStats.value.summary.uniqueIPs),
    hint: `${i18ns.t('SystemLogs.anonymousRequests')}: ${formatNumber(apiStats.value.summary.anonymousRequests)}`,
  },
])

const apiDailyTrendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { left: 36, right: 16, top: 24, bottom: 42 },
  xAxis: {
    type: 'category',
    data: apiStats.value.daily.map((item) => item.date),
  },
  yAxis: { type: 'value' },
  series: [
    {
      name: i18ns.t('SystemLogs.totalRequests'),
      type: 'line',
      smooth: true,
      data: apiStats.value.daily.map((item) => item.totalRequests),
    },
    {
      name: i18ns.t('SystemLogs.clientErrors'),
      type: 'line',
      smooth: true,
      data: apiStats.value.daily.map((item) => item.clientErrorRequests),
    },
    {
      name: i18ns.t('SystemLogs.serverErrors'),
      type: 'line',
      smooth: true,
      data: apiStats.value.daily.map((item) => item.serverErrorRequests),
    },
  ],
}))

const apiMethodPieOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params: { name: string; value: number }) =>
      `${params.name}: ${formatNumber(params.value)}`,
  },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['35%', '70%'],
      data: apiStats.value.byMethod.map((item) => ({
        name: item.label,
        value: item.count,
      })),
    },
  ],
}))

const apiStatusBarOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
  },
  grid: { left: 36, right: 16, top: 24, bottom: 60 },
  xAxis: {
    type: 'category',
    axisLabel: { rotate: 30 },
    data: apiStats.value.byStatusCode.map((item) => item.label),
  },
  yAxis: { type: 'value' },
  series: [
    {
      type: 'bar',
      data: apiStats.value.byStatusCode.map((item) => item.count),
    },
  ],
}))

const apiPathBarOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
  },
  grid: { left: 120, right: 24, top: 24, bottom: 20 },
  xAxis: { type: 'value' },
  yAxis: {
    type: 'category',
    data: [...apiStats.value.byPath].reverse().map((item) => item.label),
  },
  series: [
    {
      type: 'bar',
      data: [...apiStats.value.byPath].reverse().map((item) => item.count),
      label: {
        show: true,
        position: 'right',
        formatter: ({ value }: { value: number }) => formatNumber(value),
      },
    },
  ],
}))

const maskSensitiveData = (obj: any): any => {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    if (obj.match(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/)) {
      return '***TOKEN_MASKED***'
    }
    return obj
  }

  if (Array.isArray(obj)) return obj.map(maskSensitiveData)

  if (typeof obj === 'object') {
    const masked: any = {}
    const sensitiveKeys = [
      'password',
      'token',
      'access_token',
      'refresh_token',
      'accessToken',
      'refreshToken',
      'secret',
      'apiKey',
      'api_key',
      'authorization',
    ]

    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
      const lowerKey = key.toLowerCase()
      masked[key] = sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))
        ? '***MASKED***'
        : maskSensitiveData(obj[key])
    }

    return masked
  }

  return obj
}

const formatJson = (data: unknown) => {
  if (data === null || data === undefined) return 'null'

  try {
    let parsed = data
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data)
      } catch {
        parsed = data
      }
    }

    return JSON.stringify(maskSensitiveData(parsed), null, 2)
  } catch {
    return String(data)
  }
}

const getMethodType = (method: string) => {
  const methodMap: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'info'> = {
    GET: 'success',
    POST: 'primary',
    PUT: 'warning',
    DELETE: 'danger',
    PATCH: 'warning',
    OPTIONS: 'info',
    HEAD: 'info',
  }
  return methodMap[method] || 'info'
}

const getStatusType = (statusCode: number) => {
  if (statusCode >= 200 && statusCode < 300) return 'success'
  if (statusCode >= 300 && statusCode < 400) return 'info'
  if (statusCode >= 400 && statusCode < 500) return 'warning'
  if (statusCode >= 500) return 'danger'
  return 'info'
}

const getRequestSizeSourceLabel = (source: string | null | undefined) => {
  if (source === 'content-length') return i18ns.t('SystemLogs.requestSizeFromContentLength')
  if (source === 'body-estimate') return i18ns.t('SystemLogs.requestSizeFromBodyEstimate')
  if (source === 'empty-body') return i18ns.t('SystemLogs.requestSizeEmptyBody')
  return '-'
}

const getResponseSizeDisplay = (rowId: string, fallback?: string | null) => {
  return responseSizeFormattedCache.value[rowId] ?? fallback ?? '-'
}

const fetchLogDetail = async (rowId: string) => {
  if (responseCache.value[rowId] !== undefined || responseLoading.value[rowId]) return

  responseLoading.value[rowId] = true
  try {
    const detail = await systemService.getSystemLogDetail(rowId)
    responseCache.value[rowId] = detail.response
    requestHeadersCache.value[rowId] = detail.requestHeaders
    responseHeadersCache.value[rowId] = detail.responseHeaders
    requestSizeSourceCache.value[rowId] = detail.requestSizeSource
    responseSizeFormattedCache.value[rowId] = detail.responseSizeFormatted
  } catch (error) {
    console.error('Failed to load log detail:', error)
    responseCache.value[rowId] = null
    requestHeadersCache.value[rowId] = null
    responseHeadersCache.value[rowId] = null
    requestSizeSourceCache.value[rowId] = null
    responseSizeFormattedCache.value[rowId] = null
  } finally {
    responseLoading.value[rowId] = false
  }
}

const handleExpandChange = async (
  row: SystemLogServiceDto,
  expandedRowsData: SystemLogServiceDto[],
) => {
  if (expandedRowsData.length > 0) {
    expandedRows.value = [row.id]
    await fetchLogDetail(row.id)
  } else {
    expandedRows.value = []
  }
}

const ensureLogDetailLoaded = async (row: SystemLogServiceDto) => {
  await fetchLogDetail(row.id)
}

const loadLogs = async () => {
  if (!canViewApiLogs.value) {
    logs.value = []
    total.value = 0
    return
  }

  apiLoading.value = true
  expandedRows.value = []
  responseCache.value = {}
  responseLoading.value = {}
  requestHeadersCache.value = {}
  responseHeadersCache.value = {}
  requestSizeSourceCache.value = {}
  responseSizeFormattedCache.value = {}

  try {
    const data = await systemService.getSystemLogs(currentPage.value, pageSize.value, {
      method: filters.value.method.length > 0 ? filters.value.method : undefined,
      path: filters.value.path || undefined,
      statusCode: filters.value.statusCode.length > 0 ? filters.value.statusCode : undefined,
      user: filters.value.user || undefined,
      requestID: filters.value.requestID || undefined,
      ip: filters.value.ip || undefined,
      startDate: filters.value.startDate || undefined,
      endDate: filters.value.endDate || undefined,
    })

    logs.value = data.logs
    total.value = data.total
  } catch (error) {
    ElMessage.error(i18ns.t('SystemLogs.loadFailed'))
    console.error('Failed to load system logs:', error)
  } finally {
    apiLoading.value = false
  }
}

const loadApiStats = async () => {
  if (!canViewApiLogs.value) {
    apiStats.value = emptyApiStats()
    return
  }

  apiStatsLoading.value = true
  try {
    apiStats.value = (await systemService.getSystemLogStats(
      {
        method: filters.value.method.length > 0 ? filters.value.method : undefined,
        path: filters.value.path || undefined,
        statusCode: filters.value.statusCode.length > 0 ? filters.value.statusCode : undefined,
        user: filters.value.user || undefined,
        requestID: filters.value.requestID || undefined,
        ip: filters.value.ip || undefined,
        startDate: filters.value.startDate || undefined,
        endDate: filters.value.endDate || undefined,
      },
      true,
    )) as SystemLogStats
  } catch (error) {
    ElMessage.error(i18ns.t('SystemLogs.loadStatsFailed'))
    console.error('Failed to load system log stats:', error)
  } finally {
    apiStatsLoading.value = false
  }
}

const loadServerLogFiles = async () => {
  if (!canViewServerLogs.value) {
    serverLogFiles.value = []
    selectedServerLogFileName.value = ''
    serverLogContent.value = null
    return
  }

  serverFilesLoading.value = true
  try {
    const data = await systemService.getServerLogFiles(serverLogType.value)
    serverLogFiles.value = data.files

    if (data.files.length === 0) {
      selectedServerLogFileName.value = ''
      serverLogContent.value = null
      return
    }

    const firstFile = data.files[0]
    if (!firstFile) {
      selectedServerLogFileName.value = ''
      serverLogContent.value = null
      return
    }

    const targetFileName = data.files.some((file) => file.name === selectedServerLogFileName.value)
      ? selectedServerLogFileName.value
      : firstFile.name

    selectedServerLogFileName.value = targetFileName
    await loadServerLogContent(targetFileName)
  } catch (error) {
    ElMessage.error(i18ns.t('SystemLogs.loadServerLogFilesFailed'))
    console.error('Failed to load server log files:', error)
  } finally {
    serverFilesLoading.value = false
  }
}

const loadServerLogContent = async (fileName?: string) => {
  if (!canViewServerLogs.value) {
    serverLogContent.value = null
    return
  }

  const targetFileName = fileName || selectedServerLogFileName.value
  if (!targetFileName) {
    serverLogContent.value = null
    return
  }

  serverContentLoading.value = true
  try {
    const data = await systemService.getServerLogContent(
      targetFileName,
      serverLines.value,
      serverSearch.value.trim() || undefined,
    )
    selectedServerLogFileName.value = targetFileName
    serverLogContent.value = data
  } catch (error) {
    ElMessage.error(i18ns.t('SystemLogs.loadServerLogContentFailed'))
    console.error('Failed to load server log content:', error)
  } finally {
    serverContentLoading.value = false
  }
}

const loadSelectedServerLogContent = async () => {
  await loadServerLogContent(selectedServerLogFileName.value)
}

const selectServerLogFile = async (fileName: string) => {
  if (fileName === selectedServerLogFileName.value && serverLogContent.value) return
  await loadServerLogContent(fileName)
}

const handleFilterChange = () => {
  currentPage.value = 1
  void Promise.all([loadLogs(), loadApiStats()])
}

const handleDateRangeChange = (value: [Date, Date] | null) => {
  if (value) {
    filters.value.startDate = value[0].toISOString()
    filters.value.endDate = value[1].toISOString()
  } else {
    filters.value.startDate = undefined
    filters.value.endDate = undefined
  }
  handleFilterChange()
}

const clearFilters = () => {
  filters.value = {
    method: [],
    path: undefined,
    statusCode: [],
    user: undefined,
    requestID: undefined,
    ip: undefined,
    startDate: undefined,
    endDate: undefined,
  }
  dateRange.value = null
  handleFilterChange()
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  loadLogs()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  loadLogs()
}

const handleServerLogTypeChange = async () => {
  selectedServerLogFileName.value = ''
  serverLogContent.value = null
  await loadServerLogFiles()
}

const handleServerContentParamsChange = async () => {
  if (selectedServerLogFileName.value) {
    await loadServerLogContent(selectedServerLogFileName.value)
  }
}

const handleRefresh = async () => {
  if (activeTab.value === 'api') {
    await Promise.all([loadLogs(), loadApiStats()])
    return
  }

  await loadServerLogFiles()
}

const handleTabChange = async (name: string | number) => {
  if (name === 'server' && serverLogFiles.value.length === 0 && !serverFilesLoading.value) {
    await loadServerLogFiles()
  }
}

const normalizeActiveTab = () => {
  if (activeTab.value === 'api' && !canViewApiLogs.value && canViewServerLogs.value) {
    activeTab.value = 'server'
    return
  }

  if (activeTab.value === 'server' && !canViewServerLogs.value && canViewApiLogs.value) {
    activeTab.value = 'api'
  }
}

onMounted(async () => {
  normalizeActiveTab()

  const tasks: Promise<unknown>[] = []
  if (canViewApiLogs.value) tasks.push(loadLogs(), loadApiStats())
  if (canViewServerLogs.value) tasks.push(loadServerLogFiles())

  await Promise.all(tasks)
})
</script>

<style scoped>
.system-logs-container {
  padding: 20px;
}

.logs-card {
  border-radius: 8px;
}

.card-header,
.panel-title-row,
.server-file-main,
.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title,
.panel-title {
  font-size: 18px;
  font-weight: 600;
}

.panel-title {
  font-size: 15px;
}

.panel-title-row-wrap {
  flex-wrap: wrap;
  gap: 8px;
}

.filters-container {
  margin-bottom: 20px;
  padding: 15px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.stats-section {
  margin-bottom: 20px;
}

.summary-grid,
.chart-grid {
  margin-bottom: 16px;
}

.summary-card,
.chart-card {
  border-radius: 10px;
}

.summary-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.summary-value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
}

.summary-hint {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.chart {
  height: 320px;
}

.filters-container :deep(.multi-filter-select) {
  width: 100%;
}

.filters-container :deep(.multi-filter-select .el-select__wrapper) {
  width: 100%;
  min-height: 34px;
}

.filters-container :deep(.multi-filter-select .el-select__selection),
.filters-container :deep(.multi-filter-select .el-select__selection .el-select__selected-item) {
  max-width: 100%;
}

.filters-container :deep(.multi-filter-select .el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.method-tag,
.status-code-tag {
  width: 64px;
  display: inline-flex;
  justify-content: center;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.truncate-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-content {
  padding: 10px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.expand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.expand-item {
  margin-bottom: 8px;
}

.compact-item {
  margin-bottom: 0;
}

.expand-item:last-child {
  margin-bottom: 0;
}

.expand-item strong {
  display: block;
  margin-bottom: 3px;
  color: #606266;
  line-height: 1.25;
}

.expand-item pre,
.server-log-pre {
  background-color: #fff;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-card {
  border: 1px solid var(--el-border-color-lighter);
}

.log-meta {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.log-details {
  margin-top: 6px;
}

.log-details :deep(.el-collapse-item__header) {
  min-height: 34px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 0 8px;
  background: var(--el-fill-color-light);
}

.server-logs-layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 16px;
}

.server-files-panel,
.server-content-panel {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 14px;
  background: var(--el-bg-color);
  min-height: 420px;
}

.server-file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.server-file-item {
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 10px 12px;
  text-align: left;
  background: var(--el-fill-color-blank);
  cursor: pointer;
  transition: all 0.2s ease;
}

.server-file-item:hover,
.server-file-item.active {
  border-color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 8%, var(--el-fill-color-blank));
}

.server-file-name {
  font-weight: 600;
  word-break: break-all;
}

.server-file-meta,
.server-content-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.server-content-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.server-log-alert {
  margin: 12px 0;
}

.server-log-pre {
  margin-top: 12px;
  max-height: 65vh;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.pager-wrap {
  margin-top: 12px;
}

html.dark .filters-container,
html.dark .expand-content {
  background-color: #1a1a1a;
}

html.dark .expand-item strong {
  color: #e5e7eb;
}

html.dark .expand-item pre,
html.dark .server-log-pre,
html.dark .server-files-panel,
html.dark .server-content-panel {
  background-color: #262626;
  border-color: #404040;
  color: #e5e7eb;
}

@media (max-width: 1024px) {
  .server-logs-layout {
    grid-template-columns: 1fr;
  }

  .server-files-panel,
  .server-content-panel {
    min-height: auto;
  }
}

@media (max-width: 768px) {
  .system-logs-container {
    padding: 10px;
  }

  .filters-container {
    padding: 10px;
  }

  :deep(.hide-on-mobile),
  .system-logs-mobile-adapter :deep(.el-table__header-wrapper),
  .system-logs-mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
  .system-logs-mobile-adapter :deep(.el-table__body colgroup),
  .system-logs-mobile-adapter :deep(.el-table__header colgroup) {
    display: none !important;
  }
}

@media (max-width: 480px) {
  .system-logs-mobile-adapter {
    padding: 8px 6px 16px;
    overflow-x: hidden;
  }

  .system-logs-mobile-adapter :deep(.el-form--inline) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .system-logs-mobile-adapter :deep(.el-form-item) {
    margin-right: 0;
    margin-bottom: 10px;
  }

  .system-logs-mobile-adapter :deep(.el-form-item__label) {
    float: none;
    display: block;
    text-align: left;
    padding: 0 0 6px;
  }

  .system-logs-mobile-adapter :deep(.el-form-item__content) {
    margin-left: 0 !important;
  }

  .system-logs-mobile-adapter :deep(.el-input),
  .system-logs-mobile-adapter :deep(.el-select),
  .system-logs-mobile-adapter :deep(.el-date-editor),
  .system-logs-mobile-adapter :deep(.el-input-number),
  .system-logs-mobile-adapter :deep(.el-textarea),
  .system-logs-mobile-adapter :deep(.el-button) {
    width: 100%;
  }

  .system-logs-mobile-adapter :deep(.el-pagination) {
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
  }
}

:global(.mobile-datetime-range-popper .el-picker-panel__body-wrapper) {
  display: flex;
  flex-direction: column;
}

:global(.mobile-datetime-range-popper .el-date-range-picker__content) {
  width: 100%;
}

:global(.mobile-datetime-range-popper .el-date-range-picker__content.is-left) {
  border-right: 0;
}
</style>
