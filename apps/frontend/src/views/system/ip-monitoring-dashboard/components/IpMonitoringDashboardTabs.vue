<template>
  <div class="ip-management" :class="{ 'ip-monitor-mobile-adapter': !isDesktop }">
    <el-tabs type="border-card">
      <el-tab-pane :label="i18ns.t('ipMonitoring.title')">
        <div v-loading="loading">
          <div class="tab-header overview-toolbar">
            <div />
            <el-button :icon="Refresh" @click="loadDashboard">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>

          <el-card class="section">
            <template #header>{{ i18ns.t('ipMonitoring.queryTitle') }}</template>
            <el-row :gutter="12" align="middle">
              <el-col :xs="24" :sm="16" :md="10">
                <el-input
                  v-model="queryIp"
                  :placeholder="i18ns.t('ipMonitoring.queryPlaceholder')"
                  clearable
                  @keyup.enter="handleQueryIpStatus"
                />
              </el-col>
              <el-col :xs="24" :sm="8" :md="4">
                <el-button type="primary" :loading="queryLoading" @click="handleQueryIpStatus">
                  {{ i18ns.t('ipMonitoring.query') }}
                </el-button>
              </el-col>
              <PermissionWrapper :require="[Permission.IP_BLACKLIST_UPDATE]">
                <el-button type="danger" :loading="actionLoading" @click="handleResetWeight">
                  {{ i18ns.t('ipMonitoring.resetWeight') }}
                </el-button>
                <el-button type="warning" @click="showAdjust = !showAdjust">
                  {{ i18ns.t('ipMonitoring.adjustWeight') }}
                </el-button>
              </PermissionWrapper>
            </el-row>
            <div v-if="queryResult" class="query-result-block">
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item :label="i18ns.t('ipMonitoring.ipAddress')">
                  {{ queryResult.ipAddress }}
                </el-descriptions-item>
                <el-descriptions-item :label="i18ns.t('ipMonitoring.banStatus')">
                  <el-tag :type="queryResult.isBanned ? 'danger' : 'success'">
                    {{
                      queryResult.isBanned
                        ? i18ns.t('ipMonitoring.banned')
                        : i18ns.t('ipMonitoring.normal')
                    }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item :label="i18ns.t('ipMonitoring.errorWeight')">
                  {{ queryResult.errorWeight }}
                </el-descriptions-item>
                <el-descriptions-item :label="i18ns.t('ipMonitoring.currentLevel')">
                  <el-tag :type="levelTagType(queryResult.currentLevel)">
                    {{
                      queryResult.currentLevel === 0
                        ? i18ns.t('ipMonitoring.normal')
                        : `Level ${queryResult.currentLevel}`
                    }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item :label="i18ns.t('ipMonitoring.thresholds')">
                  {{ queryResult.thresholds.level1 }} / {{ queryResult.thresholds.level2 }} /
                  {{ queryResult.thresholds.level3 }}
                </el-descriptions-item>
                <el-descriptions-item :label="i18ns.t('ipMonitoring.nextLevel')">
                  <span v-if="nextThreshold(queryResult)">
                    {{
                      i18ns.t('ipMonitoring.gapToLevel', {
                        gap: nextThreshold(queryResult)!.gap,
                        level: nextThreshold(queryResult)!.label,
                      })
                    }}
                  </span>
                  <span v-else>{{ i18ns.t('ipMonitoring.maxLevel') }}</span>
                </el-descriptions-item>
              </el-descriptions>

              <div v-if="decayEstimates(queryResult) || trendEstimate" class="decay-estimates">
                <template v-if="decayEstimates(queryResult)">
                  <div>
                    预计归零：{{ decayEstimates(queryResult)!.zeroTime }}（假设无新错误）
                  </div>
                  <div v-for="item in decayEstimates(queryResult)!.times" :key="item.label">
                    预计衰减至 {{ item.label }} 以下：{{ item.time }}
                  </div>
                </template>
                <div v-if="trendEstimate" class="trend-estimate">
                  以当前趋势，预计 {{ trendEstimate.time }} 后达到 {{ trendEstimate.level }}
                </div>
              </div>

              <div class="error-breakdown-section">
                <div class="error-breakdown-title">
                  {{ i18ns.t('ipMonitoring.errorBreakdown') }}
                </div>
                <div v-if="!queryResult.errorBreakdown || queryResult.errorBreakdown.length === 0" class="error-breakdown-empty">
                  {{ i18ns.t('ipMonitoring.errorBreakdownEmpty') }}
                </div>
                <el-table v-else :data="queryResult.errorBreakdown" size="small" style="width: 100%">
                  <el-table-column :label="i18ns.t('ipMonitoring.errorType')" min-width="200">
                    <template #default="{ row }">
                      <el-tag :type="getBreakdownTagType(row)" size="small" class="breakdown-tag">
                        {{
                          row.type === 'custom'
                            ? i18ns.t('ipMonitoring.customLabel')
                            : i18ns.t('ipMonitoring.httpLabel')
                        }}
                      </el-tag>
                      {{ formatBreakdownLabel(row) }}
                    </template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('ipMonitoring.percentage')" min-width="140">
                    <template #default="{ row }">
                      <div class="breakdown-percentage-row">
                        <div class="pct-bar-bg">
                          <div
                            class="pct-bar-fill"
                            :class="{
                              'pct-danger': row.weight >= 5,
                              'pct-warning': row.weight >= 2 && row.weight < 5,
                              'pct-normal': row.weight < 2,
                            }"
                            :style="{ width: row.percentage + '%' }"
                          />
                        </div>
                        <span class="breakdown-percentage-text">{{ row.percentage }}%</span>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ipMonitoring.weightContribution')"
                    width="90"
                    align="right"
                  >
                    <template #default="{ row }">
                      <span
                        class="weight-contribution"
                        :class="{
                          'weight-contribution-danger': row.weight >= 5,
                          'weight-contribution-warning': row.weight >= 2 && row.weight < 5,
                        }"
                      >
                        +{{ row.weight.toFixed(2) }}
                      </span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <div class="seg-bar-wrap progress-wrap">
                <div class="seg-bar">
                  <div
                    class="seg seg-green"
                    :style="{ width: (queryResult.thresholds.level1 / queryResult.thresholds.level3) * 100 + '%' }"
                  >
                    L1
                  </div>
                  <div
                    class="seg seg-yellow"
                    :style="{
                      width:
                        ((queryResult.thresholds.level2 - queryResult.thresholds.level1) /
                          queryResult.thresholds.level3) *
                          100 +
                        '%',
                    }"
                  >
                    L2
                  </div>
                  <div
                    class="seg seg-red"
                    :style="{
                      width:
                        ((queryResult.thresholds.level3 - queryResult.thresholds.level2) /
                          queryResult.thresholds.level3) *
                          100 +
                        '%',
                    }"
                  >
                    L3
                  </div>
                  <div
                    class="seg-passed"
                    :style="{
                      width:
                        Math.min(100, (queryResult.errorWeight / queryResult.thresholds.level3) * 100) +
                        '%',
                    }"
                  />
                  <div
                    class="seg-cursor"
                    :style="{
                      left:
                        Math.min(100, (queryResult.errorWeight / queryResult.thresholds.level3) * 100) +
                        '%',
                    }"
                  />
                </div>
                <div class="seg-labels">
                  <span
                    :style="{ left: (queryResult.thresholds.level1 / queryResult.thresholds.level3) * 100 + '%' }"
                  >
                    L1: {{ queryResult.thresholds.level1 }}
                  </span>
                  <span
                    :style="{ left: (queryResult.thresholds.level2 / queryResult.thresholds.level3) * 100 + '%' }"
                  >
                    L2: {{ queryResult.thresholds.level2 }}
                  </span>
                  <span class="seg-label-right">L3: {{ queryResult.thresholds.level3 }}</span>
                </div>
              </div>

              <div class="adjust-actions-row">
                <template v-if="showAdjust">
                  <el-input-number
                    v-model="adjustWeight"
                    :min="0"
                    :max="queryResult.thresholds.level3 * 2"
                    size="small"
                    class="adjust-weight-input"
                  />
                  <el-button type="primary" size="small" :loading="actionLoading" @click="handleSetWeight">
                    {{ i18ns.t('confirm') }}
                  </el-button>
                </template>
              </div>
            </div>
          </el-card>

          <div v-if="dashboardData">
            <el-row :gutter="20" class="stats-cards">
              <el-col :xs="24" :sm="12" :lg="6">
                <el-card class="stats-card">
                  <el-statistic :title="i18ns.t('ipMonitoring.totalBans')" :value="dashboardData.activeBans.total" />
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :lg="6">
                <el-card class="stats-card">
                  <el-statistic :title="i18ns.t('ipMonitoring.level1Bans')" :value="dashboardData.activeBans.byLevel.level1" />
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :lg="6">
                <el-card class="stats-card">
                  <el-statistic :title="i18ns.t('ipMonitoring.level2Bans')" :value="dashboardData.activeBans.byLevel.level2" />
                </el-card>
              </el-col>
              <el-col :xs="24" :sm="12" :lg="6">
                <el-card class="stats-card">
                  <el-statistic :title="i18ns.t('ipMonitoring.level3Bans')" :value="dashboardData.activeBans.byLevel.level3" />
                </el-card>
              </el-col>
            </el-row>

            <el-card class="section">
              <template #header>{{ i18ns.t('ipMonitoring.topBannedIPs') }}</template>
              <div class="top-banned-table-wrap">
                <el-table :data="dashboardData.topBannedIPs" stripe class="top-banned-table" style="width: 100%">
                  <el-table-column
                    prop="ipAddress"
                    :label="i18ns.t('ipMonitoring.ipAddress')"
                    class-name="top-banned-ip-col"
                    show-overflow-tooltip
                  />
                  <el-table-column prop="banCount" :label="i18ns.t('ipMonitoring.banCount')" />
                  <el-table-column :label="i18ns.t('ipMonitoring.lastBanTime')">
                    <template #default="{ row }">{{ new Date(row.lastBanTime).toLocaleString() }}</template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('ipMonitoring.status')">
                    <template #default="{ row }">
                      <el-tag :type="row.currentStatus === 'banned' ? 'danger' : 'success'">
                        {{
                          row.currentStatus === 'banned'
                            ? i18ns.t('ipMonitoring.banned')
                            : i18ns.t('ipMonitoring.unbanned')
                        }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </el-card>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="i18ns.t('ipBlacklist.title')">
        <div class="tab-header">
          <div class="search-bar">
            <el-input
              v-model="searchIP"
              :placeholder="i18ns.t('ipBlacklist.searchPlaceholder')"
              clearable
              class="search-input"
              @clear="handleSearch"
              @keyup.enter="handleSearch"
            >
              <template #append><el-button :icon="Search" @click="handleSearch" /></template>
            </el-input>
          </div>
          <div class="tab-actions">
            <PermissionWrapper :require="[Permission.IP_BLACKLIST_CREATE]">
              <el-button type="primary" :icon="Plus" @click="handleCreate">
                {{ i18ns.t('ipBlacklist.banIP') }}
              </el-button>
            </PermissionWrapper>
            <el-button :icon="Refresh" @click="loadBlacklist">{{ i18ns.t('refresh') }}</el-button>
          </div>
        </div>

        <el-table v-loading="blLoading" :data="blacklistData" stripe border class="ip-blacklist-table">
          <el-table-column prop="ipAddress" :label="i18ns.t('ipBlacklist.ipAddress')" min-width="150" />
          <el-table-column :label="i18ns.t('ipBlacklist.banType')" min-width="100">
            <template #default="{ row }">
              <el-tag :type="row.bannedBy ? 'info' : 'warning'">
                {{ row.bannedBy ? i18ns.t('ipBlacklist.manual') : i18ns.t('ipBlacklist.auto') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="banLevel" :label="i18ns.t('ipBlacklist.banLevel')" min-width="100">
            <template #default="{ row }">
              <el-tag v-if="row.banLevel > 0" :type="getBanLevelType(row.banLevel)">
                Level {{ row.banLevel }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="banReason"
            :label="i18ns.t('ipBlacklist.reason')"
            min-width="200"
            show-overflow-tooltip
          />
          <el-table-column :label="i18ns.t('ipBlacklist.expireTime')" min-width="180">
            <template #default="{ row }">
              <span :class="{ 'expired-text': isExpired(row.expireTime) }">{{ formatExpireTime(row.expireTime) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('ipBlacklist.createTime')" min-width="180">
            <template #default="{ row }">{{ new Date(row.createTime).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column
            :label="i18ns.t('actions')"
            :fixed="isDesktop ? 'right' : undefined"
            :width="isDesktop ? 160 : undefined"
            class-name="action-col"
          >
            <template #default="{ row }">
              <div class="action-group">
                <PermissionWrapper :require="[Permission.IP_BLACKLIST_UPDATE]" mode="disabled">
                  <el-button type="primary" size="small" @click="handleEdit(row)">
                    {{ i18ns.t('edit') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.IP_BLACKLIST_DELETE]" mode="disabled">
                  <el-button type="danger" size="small" @click="handleUnbanRow(row)">
                    {{ i18ns.t('ipBlacklist.unban') }}
                  </el-button>
                </PermissionWrapper>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="pagination.total"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleBlacklistPageSizeChange"
            @current-change="loadBlacklist"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane :label="i18ns.t('ipWhitelist.title')">
        <div class="tab-header">
          <div />
          <div class="tab-actions">
            <PermissionWrapper :require="[Permission.IP_WHITELIST_CREATE]">
              <el-button type="primary" :icon="Plus" @click="wlDialogVisible = true">
                {{ i18ns.t('ipWhitelist.addIP') }}
              </el-button>
            </PermissionWrapper>
            <el-button :icon="Refresh" @click="loadWhitelist">{{ i18ns.t('refresh') }}</el-button>
          </div>
        </div>

        <el-table v-loading="wlLoading" :data="wlData" stripe border class="ip-whitelist-table">
          <el-table-column prop="ipAddress" :label="i18ns.t('ipWhitelist.ipAddress')" min-width="150" />
          <el-table-column
            prop="reason"
            :label="i18ns.t('ipWhitelist.reason')"
            min-width="200"
            show-overflow-tooltip
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="addedBy"
            :label="i18ns.t('ipWhitelist.addedBy')"
            min-width="120"
            class-name="hide-on-mobile"
          />
          <el-table-column :label="i18ns.t('ipWhitelist.expiresAt')" min-width="180">
            <template #default="{ row }">
              <span :class="{ 'expired-text': isWlExpired(row.expiresAt) }">{{ formatWlExpiry(row.expiresAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            :label="i18ns.t('ipWhitelist.createTime')"
            min-width="180"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">{{ new Date(row.createTime).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column
            :label="i18ns.t('actions')"
            :fixed="isDesktop ? 'right' : undefined"
            :width="isDesktop ? 100 : undefined"
            class-name="action-col"
          >
            <template #default="{ row }">
              <div class="action-group">
                <PermissionWrapper :require="[Permission.IP_WHITELIST_DELETE]" mode="disabled">
                  <el-button type="danger" size="small" @click="handleWlRemove(row)">
                    {{ i18ns.t('ipWhitelist.remove') }}
                  </el-button>
                </PermissionWrapper>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="wlPagination.page"
            v-model:page-size="wlPagination.pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="wlPagination.total"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleWhitelistPageSizeChange"
            @current-change="loadWhitelist"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import { useIpMonitoringDashboardContext } from '../context'

const state = useIpMonitoringDashboardContext()

const {
  actionLoading,
  adjustWeight,
  blacklistData,
  blLoading,
  dashboardData,
  decayEstimates,
  formatBreakdownLabel,
  formatExpireTime,
  formatWlExpiry,
  getBanLevelType,
  getBreakdownTagType,
  handleCreate,
  handleEdit,
  handleQueryIpStatus,
  handleResetWeight,
  handleSearch,
  handleSetWeight,
  handleUnbanRow,
  handleWlRemove,
  isDesktop,
  isExpired,
  isWlExpired,
  levelTagType,
  loadBlacklist,
  loadDashboard,
  loadWhitelist,
  loading,
  nextThreshold,
  pagination,
  queryIp,
  queryLoading,
  queryResult,
  searchIP,
  showAdjust,
  trendEstimate,
  wlData,
  wlDialogVisible,
  wlLoading,
  wlPagination,
} = state

const handleBlacklistPageSizeChange = () => {
  pagination.page = 1
  loadBlacklist()
}

const handleWhitelistPageSizeChange = () => {
  wlPagination.page = 1
  loadWhitelist()
}
</script>
