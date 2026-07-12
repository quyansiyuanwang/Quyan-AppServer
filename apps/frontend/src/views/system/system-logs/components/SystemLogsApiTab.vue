<script setup lang="ts">
import { computed } from 'vue'
import { useSystemLogsContext } from '../context'

const state = useSystemLogsContext()

const i18ns = state.i18ns
const isDesktop = state.isDesktop
const apiLoading = state.apiLoading
const apiStatsLoading = state.apiStatsLoading
const filters = state.filters
const dateRange = state.dateRange
const logs = state.logs
const expandedRows = state.expandedRows
const requestSizeSourceCache = state.requestSizeSourceCache
const responseHeadersCache = state.responseHeadersCache
const requestHeadersCache = state.requestHeadersCache
const responseLoading = state.responseLoading
const responseCache = state.responseCache
const currentPage = state.currentPage
const pageSize = state.pageSize
const total = state.total
const apiSummaryCards = state.apiSummaryCards
const apiDailyTrendOption = state.apiDailyTrendOption
const apiMethodPieOption = state.apiMethodPieOption
const apiStatusBarOption = state.apiStatusBarOption
const apiPathBarOption = state.apiPathBarOption

const pageSizes = computed(() => [10, 20, 50, 100])
</script>

<template>
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
            @change="state.handleFilterChange"
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
            @change="state.handleFilterChange"
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
            @change="state.handleFilterChange"
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
            @change="state.handleFilterChange"
          />
        </el-form-item>

        <el-form-item :label="i18ns.t('SystemLogs.requestId')">
          <el-input
            v-model="filters.requestID"
            :placeholder="i18ns.t('SystemLogs.filterByRequestId')"
            clearable
            style="width: 100%; max-width: 200px"
            @change="state.handleFilterChange"
          />
        </el-form-item>

        <el-form-item :label="i18ns.t('SystemLogs.ipAddress')">
          <el-input
            v-model="filters.ip"
            :placeholder="i18ns.t('SystemLogs.filterByIp')"
            clearable
            style="width: 100%; max-width: 200px"
            @change="state.handleFilterChange"
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
            @change="state.handleDateRangeChange"
          />
        </el-form-item>

        <el-form-item>
          <el-button @click="state.clearFilters">
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
            <state.AsyncVChart class="chart" autoresize :option="apiDailyTrendOption" />
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="10">
          <el-card class="chart-card" shadow="never">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('SystemLogs.methodDistribution') }}</span>
              </div>
            </template>
            <state.AsyncVChart class="chart" autoresize :option="apiMethodPieOption" />
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="16" class="chart-grid">
        <el-col :xs="24" :lg="12">
          <el-card class="chart-card" shadow="never">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('SystemLogs.statusDistribution') }}</span>
              </div>
            </template>
            <state.AsyncVChart class="chart" autoresize :option="apiStatusBarOption" />
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="12">
          <el-card class="chart-card" shadow="never">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('SystemLogs.pathDistribution') }}</span>
              </div>
            </template>
            <state.AsyncVChart class="chart" autoresize :option="apiPathBarOption" />
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
        @expand-change="state.handleExpandChange"
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
                  <span>{{ state.getRequestSizeSourceLabel(requestSizeSourceCache[row.id]) }}</span>
                </div>
                <div class="expand-item compact-item">
                  <strong>{{ i18ns.t('SystemLogs.responseSize') }}:</strong>
                  <span>{{ state.getResponseSizeDisplay(row.id, row.responseSizeFormatted) }}</span>
                </div>
              </div>

              <div class="expand-item">
                <strong>{{ i18ns.t('SystemLogs.queryParams') }}:</strong>
                <pre>{{ state.formatJson(row.queryParams) }}</pre>
              </div>

              <div class="expand-item">
                <strong>{{ i18ns.t('SystemLogs.bodyParams') }}:</strong>
                <pre>{{ state.formatJson(row.bodyParams) }}</pre>
              </div>

              <div class="expand-item">
                <strong>{{ i18ns.t('SystemLogs.requestHeaders') }}:</strong>
                <pre>{{ state.formatJson(requestHeadersCache[row.id]) }}</pre>
              </div>

              <div class="expand-item">
                <strong>{{ i18ns.t('SystemLogs.responseHeaders') }}:</strong>
                <pre>{{ state.formatJson(responseHeadersCache[row.id]) }}</pre>
              </div>

              <div class="expand-item">
                <strong>{{ i18ns.t('SystemLogs.response') }}:</strong>
                <div v-if="responseLoading[row.id]" v-loading="true" style="min-height: 40px" />
                <pre v-else-if="responseCache[row.id] !== undefined">{{
                  state.formatJson(responseCache[row.id])
                }}</pre>
                <el-text v-else type="info">{{ i18ns.t('SystemLogs.responseNotLoaded') }}</el-text>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="i18ns.t('SystemLogs.timestamp')" width="180">
          <template #default="{ row }">
            {{ state.formatTimestamp(row.createTime) }}
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
            <span v-else class="truncate-text" :title="row.username">{{ row.username }}</span>
          </template>
        </el-table-column>

        <el-table-column
          :label="i18ns.t('SystemLogs.method')"
          width="100"
          class-name="hide-on-mobile"
        >
          <template #default="{ row }">
            <el-tag
              :type="state.getMethodType(row.method)"
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
            <span>{{ state.getResponseSizeDisplay(row.id, row.responseSizeFormatted) }}</span>
          </template>
        </el-table-column>

        <el-table-column :label="i18ns.t('SystemLogs.statusCode')" width="100">
          <template #default="{ row }">
            <el-tag
              :type="state.getStatusType(row.statusCode)"
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
        :page-sizes="pageSizes"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="state.handleSizeChange"
        @current-change="state.handlePageChange"
        style="margin-top: 20px; justify-content: center"
      />
    </template>

    <template v-else>
      <el-skeleton :loading="apiLoading" :rows="5" animated>
        <div v-if="logs.length" class="log-card-list">
          <el-card v-for="row in logs" :key="row.id" class="log-card mobile-card" shadow="never">
            <div class="log-head">
              <el-tag
                :type="state.getMethodType(row.method)"
                size="small"
                effect="dark"
                class="method-tag"
              >
                {{ row.method }}
              </el-tag>
              <el-tag
                :type="state.getStatusType(row.statusCode)"
                size="small"
                effect="light"
                class="status-code-tag"
              >
                {{ row.statusCode }}
              </el-tag>
            </div>
            <div class="log-meta">
              <div>
                {{ i18ns.t('SystemLogs.timestamp') }}: {{ state.formatTimestamp(row.createTime) }}
              </div>
              <div>{{ i18ns.t('SystemLogs.path') }}: {{ row.path }}</div>
              <div>
                {{ i18ns.t('SystemLogs.requestSize') }}: {{ row.requestSizeFormatted || '-' }}
              </div>
              <div>
                {{ i18ns.t('SystemLogs.responseSize') }}:
                {{ state.getResponseSizeDisplay(row.id, row.responseSizeFormatted) }}
              </div>
              <div>
                {{ i18ns.t('SystemLogs.userId') }}:
                {{ row.userID || i18ns.t('SystemLogs.anonymous') }}
              </div>
              <div>{{ i18ns.t('SystemLogs.username') }}: {{ row.username || '-' }}</div>
              <div>{{ i18ns.t('SystemLogs.ipAddress') }}: {{ row.ipAddress || '-' }}</div>
              <div>{{ i18ns.t('SystemLogs.requestId') }}: {{ row.requestID || '-' }}</div>
            </div>

            <el-collapse class="log-details" accordion @change="state.ensureLogDetailLoaded(row)">
              <el-collapse-item :title="i18ns.t('SystemLogs.response')" :name="`sys-log-${row.id}`">
                <div class="expand-item compact-item">
                  <strong>{{ i18ns.t('SystemLogs.requestSizeSource') }}:</strong>
                  <span>{{ state.getRequestSizeSourceLabel(requestSizeSourceCache[row.id]) }}</span>
                </div>
                <div class="expand-item compact-item">
                  <strong>{{ i18ns.t('SystemLogs.responseSize') }}:</strong>
                  <span>{{ state.getResponseSizeDisplay(row.id, row.responseSizeFormatted) }}</span>
                </div>
                <div class="expand-item">
                  <strong>{{ i18ns.t('SystemLogs.queryParams') }}:</strong>
                  <pre>{{ state.formatJson(row.queryParams) }}</pre>
                </div>
                <div class="expand-item">
                  <strong>{{ i18ns.t('SystemLogs.bodyParams') }}:</strong>
                  <pre>{{ state.formatJson(row.bodyParams) }}</pre>
                </div>
                <div class="expand-item">
                  <strong>{{ i18ns.t('SystemLogs.requestHeaders') }}:</strong>
                  <pre>{{ state.formatJson(requestHeadersCache[row.id]) }}</pre>
                </div>
                <div class="expand-item">
                  <strong>{{ i18ns.t('SystemLogs.responseHeaders') }}:</strong>
                  <pre>{{ state.formatJson(responseHeadersCache[row.id]) }}</pre>
                </div>
                <div class="expand-item">
                  <strong>{{ i18ns.t('SystemLogs.response') }}:</strong>
                  <div v-if="responseLoading[row.id]" v-loading="true" style="min-height: 40px" />
                  <pre v-else-if="responseCache[row.id] !== undefined">{{
                    state.formatJson(responseCache[row.id])
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
        :page-sizes="pageSizes"
        :total="total"
        layout="prev, pager, next"
        @size-change="state.handleSizeChange"
        @current-change="state.handlePageChange"
        class="pager-wrap"
      />
    </template>
  </div>
</template>
