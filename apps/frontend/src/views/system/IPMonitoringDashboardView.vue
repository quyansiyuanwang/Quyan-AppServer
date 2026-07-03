<template>
  <div class="ip-monitor-view">
    <div v-show="isDesktop" class="desktop-page">
      <div class="ip-management">
        <el-tabs type="border-card">
          <!-- Tab 1: 监控概览 -->
          <el-tab-pane :label="i18ns.t('ipMonitoring.title')">
            <div v-loading="loading">
              <el-card class="section">
                <template #header>{{ i18ns.t('ipMonitoring.queryTitle') }}</template>
                <el-row :gutter="12" align="middle">
                  <el-col :span="10">
                    <el-input
                      v-model="queryIp"
                      :placeholder="i18ns.t('ipMonitoring.queryPlaceholder')"
                      clearable
                      @keyup.enter="handleQueryIpStatus"
                    />
                  </el-col>
                  <el-col :span="4">
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
                <div v-if="queryResult" style="margin-top: 12px">
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
                  <!-- Decay time estimates -->
                  <div
                    v-if="decayEstimates(queryResult) || trendEstimate"
                    style="margin-top: 10px; font-size: 13px; color: var(--el-text-color-secondary)"
                  >
                    <template v-if="decayEstimates(queryResult)">
                      <div>
                        预计归零：{{ decayEstimates(queryResult)!.zeroTime }}（假设无新错误）
                      </div>
                      <div v-for="t in decayEstimates(queryResult)!.times" :key="t.label">
                        预计衰减至 {{ t.label }} 以下：{{ t.time }}
                      </div>
                    </template>
                    <div v-if="trendEstimate" style="color: var(--el-color-warning)">
                      以当前趋势，预计 {{ trendEstimate.time }} 后达到 {{ trendEstimate.level }}
                    </div>
                  </div>
                  <!-- Error breakdown -->
                  <div style="margin-top: 14px">
                    <div
                      style="
                        font-size: 13px;
                        font-weight: 600;
                        margin-bottom: 8px;
                        color: var(--el-text-color-primary);
                      "
                    >
                      {{ i18ns.t('ipMonitoring.errorBreakdown') }}
                    </div>
                    <div
                      v-if="!queryResult.errorBreakdown || queryResult.errorBreakdown.length === 0"
                      style="
                        font-size: 12px;
                        color: var(--el-text-color-placeholder);
                        padding: 8px 0;
                      "
                    >
                      {{ i18ns.t('ipMonitoring.errorBreakdownEmpty') }}
                    </div>
                    <el-table
                      v-else
                      :data="queryResult.errorBreakdown"
                      size="small"
                      style="width: 100%"
                    >
                      <el-table-column :label="i18ns.t('ipMonitoring.errorType')" min-width="200">
                        <template #default="{ row }">
                          <el-tag
                            :type="getBreakdownTagType(row)"
                            size="small"
                            style="margin-right: 6px"
                          >
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
                          <div style="display: flex; align-items: center; gap: 6px">
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
                            <span style="font-size: 12px; white-space: nowrap"
                              >{{ row.percentage }}%</span
                            >
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
                            :style="{
                              color:
                                row.weight >= 5
                                  ? 'var(--el-color-danger)'
                                  : row.weight >= 2
                                    ? 'var(--el-color-warning)'
                                    : 'var(--el-text-color-regular)',
                              fontWeight: '600',
                              fontSize: '13px',
                            }"
                          >
                            +{{ row.weight.toFixed(2) }}
                          </span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                  <!-- Segmented progress bar -->
                  <div class="seg-bar-wrap" style="margin-top: 14px">
                    <div class="seg-bar">
                      <div
                        class="seg seg-green"
                        :style="{
                          width:
                            (queryResult.thresholds.level1 / queryResult.thresholds.level3) * 100 +
                            '%',
                        }"
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
                            Math.min(
                              100,
                              (queryResult.errorWeight / queryResult.thresholds.level3) * 100,
                            ) + '%',
                        }"
                      />
                      <div
                        class="seg-cursor"
                        :style="{
                          left:
                            Math.min(
                              100,
                              (queryResult.errorWeight / queryResult.thresholds.level3) * 100,
                            ) + '%',
                        }"
                      />
                    </div>
                    <div class="seg-labels">
                      <span
                        :style="{
                          left:
                            (queryResult.thresholds.level1 / queryResult.thresholds.level3) * 100 +
                            '%',
                        }"
                        >L1: {{ queryResult.thresholds.level1 }}</span
                      >
                      <span
                        :style="{
                          left:
                            (queryResult.thresholds.level2 / queryResult.thresholds.level3) * 100 +
                            '%',
                        }"
                        >L2: {{ queryResult.thresholds.level2 }}</span
                      >
                      <span style="right: 0">L3: {{ queryResult.thresholds.level3 }}</span>
                    </div>
                  </div>
                  <!-- Action buttons -->
                  <div
                    style="
                      margin-top: 12px;
                      display: flex;
                      gap: 8px;
                      align-items: center;
                      flex-wrap: wrap;
                    "
                  >
                    <template v-if="showAdjust">
                      <el-input-number
                        v-model="adjustWeight"
                        :min="0"
                        :max="queryResult.thresholds.level3 * 2"
                        size="small"
                        :style="isDesktop ? { width: '130px' } : { width: '100%' }"
                      />
                      <el-button
                        type="primary"
                        size="small"
                        :loading="actionLoading"
                        @click="handleSetWeight"
                      >
                        {{ i18ns.t('confirm') }}
                      </el-button>
                    </template>
                  </div>
                </div>
              </el-card>

              <div class="overview-toolbar">
                <el-button :icon="Refresh" @click="loadDashboard">
                  {{ i18ns.t('ipMonitoring.refresh') }}
                </el-button>
              </div>

              <div v-if="dashboardData">
                <el-row :gutter="20" class="stats-cards">
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.totalBans')"
                        :value="dashboardData.activeBans.total" /></el-card
                  ></el-col>
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.level1Bans')"
                        :value="dashboardData.activeBans.byLevel.level1" /></el-card
                  ></el-col>
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.level2Bans')"
                        :value="dashboardData.activeBans.byLevel.level2" /></el-card
                  ></el-col>
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.level3Bans')"
                        :value="dashboardData.activeBans.byLevel.level3" /></el-card
                  ></el-col>
                </el-row>

                <el-card class="section">
                  <template #header>{{ i18ns.t('ipMonitoring.topBannedIPs') }}</template>
                  <div class="top-banned-table-wrap">
                    <el-table
                      :data="dashboardData.topBannedIPs"
                      stripe
                      class="top-banned-table"
                      style="width: 100%"
                    >
                      <el-table-column
                        prop="ipAddress"
                        :label="i18ns.t('ipMonitoring.ipAddress')"
                        class-name="top-banned-ip-col"
                        show-overflow-tooltip
                      />
                      <el-table-column prop="banCount" :label="i18ns.t('ipMonitoring.banCount')" />
                      <el-table-column :label="i18ns.t('ipMonitoring.lastBanTime')">
                        <template #default="{ row }">{{
                          new Date(row.lastBanTime).toLocaleString()
                        }}</template>
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

          <!-- Tab 2: 黑名单管理 -->
          <el-tab-pane :label="i18ns.t('ipBlacklist.title')">
            <div class="tab-header">
              <div class="search-bar">
                <el-input
                  v-model="searchIP"
                  :placeholder="i18ns.t('ipBlacklist.searchPlaceholder')"
                  clearable
                  :style="isDesktop ? { width: '300px' } : { width: '100%' }"
                  @clear="handleSearch"
                  @keyup.enter="handleSearch"
                >
                  <template #append><el-button :icon="Search" @click="handleSearch" /></template>
                </el-input>
              </div>
              <div>
                <PermissionWrapper :require="[Permission.IP_BLACKLIST_CREATE]">
                  <el-button type="primary" :icon="Plus" @click="handleCreate">{{
                    i18ns.t('ipBlacklist.banIP')
                  }}</el-button>
                </PermissionWrapper>
                <el-button :icon="Refresh" @click="loadBlacklist">{{
                  i18ns.t('refresh')
                }}</el-button>
              </div>
            </div>

            <el-table
              v-loading="blLoading"
              :data="blacklistData"
              stripe
              border
              class="ip-blacklist-table"
            >
              <el-table-column
                prop="ipAddress"
                :label="i18ns.t('ipBlacklist.ipAddress')"
                min-width="150"
              />
              <el-table-column :label="i18ns.t('ipBlacklist.banType')" min-width="100">
                <template #default="{ row }">
                  <el-tag :type="row.bannedBy ? 'info' : 'warning'">
                    {{ row.bannedBy ? i18ns.t('ipBlacklist.manual') : i18ns.t('ipBlacklist.auto') }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column
                prop="banLevel"
                :label="i18ns.t('ipBlacklist.banLevel')"
                min-width="100"
              >
                <template #default="{ row }">
                  <el-tag v-if="row.banLevel > 0" :type="getBanLevelType(row.banLevel)"
                    >Level {{ row.banLevel }}</el-tag
                  >
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
                  <span :class="{ 'expired-text': isExpired(row.expireTime) }">{{
                    formatExpireTime(row.expireTime)
                  }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ipBlacklist.createTime')" min-width="180">
                <template #default="{ row }">{{
                  new Date(row.createTime).toLocaleString()
                }}</template>
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
                      <el-button type="primary" size="small" @click="handleEdit(row)">{{
                        i18ns.t('edit')
                      }}</el-button>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.IP_BLACKLIST_DELETE]" mode="disabled">
                      <el-button type="danger" size="small" @click="handleUnbanRow(row)">{{
                        i18ns.t('ipBlacklist.unban')
                      }}</el-button>
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
                @size-change="
                  () => {
                    pagination.page = 1
                    loadBlacklist()
                  }
                "
                @current-change="loadBlacklist"
              />
            </div>
          </el-tab-pane>

          <!-- Tab 3: 白名单管理 -->
          <el-tab-pane :label="i18ns.t('ipWhitelist.title')">
            <div class="tab-header">
              <div />
              <div>
                <PermissionWrapper :require="[Permission.IP_WHITELIST_CREATE]">
                  <el-button type="primary" :icon="Plus" @click="wlDialogVisible = true">
                    {{ i18ns.t('ipWhitelist.addIP') }}
                  </el-button>
                </PermissionWrapper>
                <el-button :icon="Refresh" @click="loadWhitelist">{{
                  i18ns.t('refresh')
                }}</el-button>
              </div>
            </div>

            <el-table v-loading="wlLoading" :data="wlData" stripe border class="ip-whitelist-table">
              <el-table-column
                prop="ipAddress"
                :label="i18ns.t('ipWhitelist.ipAddress')"
                min-width="150"
              />
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
                  <span :class="{ 'expired-text': isWlExpired(row.expiresAt) }">
                    {{ formatWlExpiry(row.expiresAt) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('ipWhitelist.createTime')"
                min-width="180"
                class-name="hide-on-mobile"
              >
                <template #default="{ row }">{{
                  new Date(row.createTime).toLocaleString()
                }}</template>
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
                @size-change="
                  () => {
                    wlPagination.page = 1
                    loadWhitelist()
                  }
                "
                @current-change="loadWhitelist"
              />
            </div>
          </el-tab-pane>
        </el-tabs>

        <!-- Whitelist Add Dialog -->
        <el-dialog
          v-model="wlDialogVisible"
          :title="i18ns.t('ipWhitelist.addTitle')"
          width="480px"
          :close-on-click-modal="false"
          @closed="
            () => {
              wlForm.ipAddress = ''
              wlForm.reason = ''
              wlForm.expiresAt = null
              wlFormRef?.resetFields()
            }
          "
        >
          <el-form ref="wlFormRef" :model="wlForm" :rules="wlFormRules" label-width="90px">
            <el-form-item :label="i18ns.t('ipWhitelist.ipAddress')" prop="ipAddress">
              <el-input
                v-model="wlForm.ipAddress"
                :placeholder="i18ns.t('ipWhitelist.ipPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('ipWhitelist.reason')">
              <el-input
                v-model="wlForm.reason"
                :placeholder="i18ns.t('ipWhitelist.reasonPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('ipWhitelist.expiresAt')">
              <el-date-picker
                v-model="wlForm.expiresAt"
                type="datetime"
                :placeholder="i18ns.t('ipWhitelist.expiresAtPlaceholder')"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="wlDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
            <el-button type="primary" :loading="wlSubmitting" @click="handleWlSubmit">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-dialog>
        <el-dialog
          v-model="dialogVisible"
          :title="isEdit ? i18ns.t('ipBlacklist.editTitle') : i18ns.t('ipBlacklist.createTitle')"
          width="500px"
          :close-on-click-modal="false"
          @closed="resetForm"
        >
          <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
            <el-form-item v-if="!isEdit" :label="i18ns.t('ipBlacklist.ipAddress')" prop="ipAddress">
              <el-input
                v-model="formData.ipAddress"
                :placeholder="i18ns.t('ipBlacklist.ipPlaceholder')"
              />
            </el-form-item>
            <el-form-item v-if="!isEdit" :label="i18ns.t('ipBlacklist.duration')" prop="duration">
              <el-select v-model="formData.duration" style="width: 100%">
                <el-option :label="i18ns.t('ipBlacklist.duration1Hour')" :value="3600" />
                <el-option :label="i18ns.t('ipBlacklist.duration24Hours')" :value="86400" />
                <el-option :label="i18ns.t('ipBlacklist.duration7Days')" :value="604800" />
                <el-option :label="i18ns.t('ipBlacklist.durationPermanent')" :value="-1" />
              </el-select>
            </el-form-item>
            <el-form-item :label="i18ns.t('ipBlacklist.reason')" prop="banReason">
              <el-input
                v-model="formData.banReason"
                type="textarea"
                :rows="4"
                :placeholder="i18ns.t('ipBlacklist.reasonPlaceholder')"
              />
            </el-form-item>
            <el-form-item
              v-if="isEdit"
              :label="i18ns.t('ipBlacklist.expireTime')"
              prop="expireTime"
            >
              <el-date-picker
                v-model="formData.expireTime"
                type="datetime"
                :placeholder="i18ns.t('ipBlacklist.selectExpireTime')"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
            <el-button type="primary" :loading="submitting" @click="handleSubmit">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-dialog>
      </div>
    </div>
    <div v-show="!isDesktop" class="mobile-page ip-monitor-mobile-adapter">
      <div class="ip-management">
        <el-tabs type="border-card">
          <!-- Tab 1: 监控概览 -->
          <el-tab-pane :label="i18ns.t('ipMonitoring.title')">
            <div v-loading="loading">
              <div class="tab-header">
                <el-button @click="loadDashboard">{{ i18ns.t('ipMonitoring.refresh') }}</el-button>
              </div>

              <el-card class="section">
                <template #header>{{ i18ns.t('ipMonitoring.queryTitle') }}</template>
                <el-row :gutter="12" align="middle">
                  <el-col :span="10">
                    <el-input
                      v-model="queryIp"
                      :placeholder="i18ns.t('ipMonitoring.queryPlaceholder')"
                      clearable
                      @keyup.enter="handleQueryIpStatus"
                    />
                  </el-col>
                  <el-col :span="4">
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
                <div v-if="queryResult" style="margin-top: 12px">
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
                  <!-- Decay time estimates -->
                  <div
                    v-if="decayEstimates(queryResult) || trendEstimate"
                    style="margin-top: 10px; font-size: 13px; color: var(--el-text-color-secondary)"
                  >
                    <template v-if="decayEstimates(queryResult)">
                      <div>
                        预计归零：{{ decayEstimates(queryResult)!.zeroTime }}（假设无新错误）
                      </div>
                      <div v-for="t in decayEstimates(queryResult)!.times" :key="t.label">
                        预计衰减至 {{ t.label }} 以下：{{ t.time }}
                      </div>
                    </template>
                    <div v-if="trendEstimate" style="color: var(--el-color-warning)">
                      以当前趋势，预计 {{ trendEstimate.time }} 后达到 {{ trendEstimate.level }}
                    </div>
                  </div>
                  <!-- Error breakdown -->
                  <div style="margin-top: 14px">
                    <div
                      style="
                        font-size: 13px;
                        font-weight: 600;
                        margin-bottom: 8px;
                        color: var(--el-text-color-primary);
                      "
                    >
                      {{ i18ns.t('ipMonitoring.errorBreakdown') }}
                    </div>
                    <div
                      v-if="!queryResult.errorBreakdown || queryResult.errorBreakdown.length === 0"
                      style="
                        font-size: 12px;
                        color: var(--el-text-color-placeholder);
                        padding: 8px 0;
                      "
                    >
                      {{ i18ns.t('ipMonitoring.errorBreakdownEmpty') }}
                    </div>
                    <el-table
                      v-else
                      :data="queryResult.errorBreakdown"
                      size="small"
                      style="width: 100%"
                    >
                      <el-table-column :label="i18ns.t('ipMonitoring.errorType')" min-width="200">
                        <template #default="{ row }">
                          <el-tag
                            :type="getBreakdownTagType(row)"
                            size="small"
                            style="margin-right: 6px"
                          >
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
                          <div style="display: flex; align-items: center; gap: 6px">
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
                            <span style="font-size: 12px; white-space: nowrap"
                              >{{ row.percentage }}%</span
                            >
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
                            :style="{
                              color:
                                row.weight >= 5
                                  ? 'var(--el-color-danger)'
                                  : row.weight >= 2
                                    ? 'var(--el-color-warning)'
                                    : 'var(--el-text-color-regular)',
                              fontWeight: '600',
                              fontSize: '13px',
                            }"
                          >
                            +{{ row.weight.toFixed(2) }}
                          </span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                  <!-- Segmented progress bar -->
                  <div class="seg-bar-wrap" style="margin-top: 14px">
                    <div class="seg-bar">
                      <div
                        class="seg seg-green"
                        :style="{
                          width:
                            (queryResult.thresholds.level1 / queryResult.thresholds.level3) * 100 +
                            '%',
                        }"
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
                            Math.min(
                              100,
                              (queryResult.errorWeight / queryResult.thresholds.level3) * 100,
                            ) + '%',
                        }"
                      />
                      <div
                        class="seg-cursor"
                        :style="{
                          left:
                            Math.min(
                              100,
                              (queryResult.errorWeight / queryResult.thresholds.level3) * 100,
                            ) + '%',
                        }"
                      />
                    </div>
                    <div class="seg-labels">
                      <span
                        :style="{
                          left:
                            (queryResult.thresholds.level1 / queryResult.thresholds.level3) * 100 +
                            '%',
                        }"
                        >L1: {{ queryResult.thresholds.level1 }}</span
                      >
                      <span
                        :style="{
                          left:
                            (queryResult.thresholds.level2 / queryResult.thresholds.level3) * 100 +
                            '%',
                        }"
                        >L2: {{ queryResult.thresholds.level2 }}</span
                      >
                      <span style="right: 0">L3: {{ queryResult.thresholds.level3 }}</span>
                    </div>
                  </div>
                  <!-- Action buttons -->
                  <div
                    style="
                      margin-top: 12px;
                      display: flex;
                      gap: 8px;
                      align-items: center;
                      flex-wrap: wrap;
                    "
                  >
                    <template v-if="showAdjust">
                      <el-input-number
                        v-model="adjustWeight"
                        :min="0"
                        :max="queryResult.thresholds.level3 * 2"
                        size="small"
                        :style="isDesktop ? { width: '130px' } : { width: '100%' }"
                      />
                      <el-button
                        type="primary"
                        size="small"
                        :loading="actionLoading"
                        @click="handleSetWeight"
                      >
                        {{ i18ns.t('confirm') }}
                      </el-button>
                    </template>
                  </div>
                </div>
              </el-card>

              <div v-if="dashboardData">
                <el-row :gutter="20" class="stats-cards">
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.totalBans')"
                        :value="dashboardData.activeBans.total" /></el-card
                  ></el-col>
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.level1Bans')"
                        :value="dashboardData.activeBans.byLevel.level1" /></el-card
                  ></el-col>
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.level2Bans')"
                        :value="dashboardData.activeBans.byLevel.level2" /></el-card
                  ></el-col>
                  <el-col :xs="24" :sm="12" :span="6"
                    ><el-card class="stats-card"
                      ><el-statistic
                        :title="i18ns.t('ipMonitoring.level3Bans')"
                        :value="dashboardData.activeBans.byLevel.level3" /></el-card
                  ></el-col>
                </el-row>

                <el-card class="section">
                  <template #header>{{ i18ns.t('ipMonitoring.topBannedIPs') }}</template>
                  <div class="top-banned-table-wrap">
                    <el-table
                      :data="dashboardData.topBannedIPs"
                      stripe
                      class="top-banned-table"
                      style="width: 100%"
                    >
                      <el-table-column
                        prop="ipAddress"
                        :label="i18ns.t('ipMonitoring.ipAddress')"
                        class-name="top-banned-ip-col"
                        show-overflow-tooltip
                      />
                      <el-table-column prop="banCount" :label="i18ns.t('ipMonitoring.banCount')" />
                      <el-table-column :label="i18ns.t('ipMonitoring.lastBanTime')">
                        <template #default="{ row }">{{
                          new Date(row.lastBanTime).toLocaleString()
                        }}</template>
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

          <!-- Tab 2: 黑名单管理 -->
          <el-tab-pane :label="i18ns.t('ipBlacklist.title')">
            <div class="tab-header">
              <div class="search-bar">
                <el-input
                  v-model="searchIP"
                  :placeholder="i18ns.t('ipBlacklist.searchPlaceholder')"
                  clearable
                  :style="isDesktop ? { width: '300px' } : { width: '100%' }"
                  @clear="handleSearch"
                  @keyup.enter="handleSearch"
                >
                  <template #append><el-button :icon="Search" @click="handleSearch" /></template>
                </el-input>
              </div>
              <div>
                <PermissionWrapper :require="[Permission.IP_BLACKLIST_CREATE]">
                  <el-button type="primary" :icon="Plus" @click="handleCreate">{{
                    i18ns.t('ipBlacklist.banIP')
                  }}</el-button>
                </PermissionWrapper>
                <el-button :icon="Refresh" @click="loadBlacklist">{{
                  i18ns.t('refresh')
                }}</el-button>
              </div>
            </div>

            <el-table
              v-loading="blLoading"
              :data="blacklistData"
              stripe
              border
              class="ip-blacklist-table"
            >
              <el-table-column
                prop="ipAddress"
                :label="i18ns.t('ipBlacklist.ipAddress')"
                min-width="150"
              />
              <el-table-column :label="i18ns.t('ipBlacklist.banType')" min-width="100">
                <template #default="{ row }">
                  <el-tag :type="row.bannedBy ? 'info' : 'warning'">
                    {{ row.bannedBy ? i18ns.t('ipBlacklist.manual') : i18ns.t('ipBlacklist.auto') }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column
                prop="banLevel"
                :label="i18ns.t('ipBlacklist.banLevel')"
                min-width="100"
              >
                <template #default="{ row }">
                  <el-tag v-if="row.banLevel > 0" :type="getBanLevelType(row.banLevel)"
                    >Level {{ row.banLevel }}</el-tag
                  >
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
                  <span :class="{ 'expired-text': isExpired(row.expireTime) }">{{
                    formatExpireTime(row.expireTime)
                  }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ipBlacklist.createTime')" min-width="180">
                <template #default="{ row }">{{
                  new Date(row.createTime).toLocaleString()
                }}</template>
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
                      <el-button type="primary" size="small" @click="handleEdit(row)">{{
                        i18ns.t('edit')
                      }}</el-button>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.IP_BLACKLIST_DELETE]" mode="disabled">
                      <el-button type="danger" size="small" @click="handleUnbanRow(row)">{{
                        i18ns.t('ipBlacklist.unban')
                      }}</el-button>
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
                @size-change="
                  () => {
                    pagination.page = 1
                    loadBlacklist()
                  }
                "
                @current-change="loadBlacklist"
              />
            </div>
          </el-tab-pane>

          <!-- Tab 3: 白名单管理 -->
          <el-tab-pane :label="i18ns.t('ipWhitelist.title')">
            <div class="tab-header">
              <div />
              <div>
                <PermissionWrapper :require="[Permission.IP_WHITELIST_CREATE]">
                  <el-button type="primary" :icon="Plus" @click="wlDialogVisible = true">
                    {{ i18ns.t('ipWhitelist.addIP') }}
                  </el-button>
                </PermissionWrapper>
                <el-button :icon="Refresh" @click="loadWhitelist">{{
                  i18ns.t('refresh')
                }}</el-button>
              </div>
            </div>

            <el-table v-loading="wlLoading" :data="wlData" stripe border class="ip-whitelist-table">
              <el-table-column
                prop="ipAddress"
                :label="i18ns.t('ipWhitelist.ipAddress')"
                min-width="150"
              />
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
                  <span :class="{ 'expired-text': isWlExpired(row.expiresAt) }">
                    {{ formatWlExpiry(row.expiresAt) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('ipWhitelist.createTime')"
                min-width="180"
                class-name="hide-on-mobile"
              >
                <template #default="{ row }">{{
                  new Date(row.createTime).toLocaleString()
                }}</template>
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
                @size-change="
                  () => {
                    wlPagination.page = 1
                    loadWhitelist()
                  }
                "
                @current-change="loadWhitelist"
              />
            </div>
          </el-tab-pane>
        </el-tabs>

        <!-- Whitelist Add Dialog -->
        <el-dialog
          v-model="wlDialogVisible"
          :title="i18ns.t('ipWhitelist.addTitle')"
          width="480px"
          :close-on-click-modal="false"
          @closed="
            () => {
              wlForm.ipAddress = ''
              wlForm.reason = ''
              wlForm.expiresAt = null
              wlFormRef?.resetFields()
            }
          "
        >
          <el-form ref="wlFormRef" :model="wlForm" :rules="wlFormRules" label-width="90px">
            <el-form-item :label="i18ns.t('ipWhitelist.ipAddress')" prop="ipAddress">
              <el-input
                v-model="wlForm.ipAddress"
                :placeholder="i18ns.t('ipWhitelist.ipPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('ipWhitelist.reason')">
              <el-input
                v-model="wlForm.reason"
                :placeholder="i18ns.t('ipWhitelist.reasonPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('ipWhitelist.expiresAt')">
              <el-date-picker
                v-model="wlForm.expiresAt"
                type="datetime"
                :placeholder="i18ns.t('ipWhitelist.expiresAtPlaceholder')"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="wlDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
            <el-button type="primary" :loading="wlSubmitting" @click="handleWlSubmit">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-dialog>
        <el-dialog
          v-model="dialogVisible"
          :title="isEdit ? i18ns.t('ipBlacklist.editTitle') : i18ns.t('ipBlacklist.createTitle')"
          width="500px"
          :close-on-click-modal="false"
          @closed="resetForm"
        >
          <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
            <el-form-item v-if="!isEdit" :label="i18ns.t('ipBlacklist.ipAddress')" prop="ipAddress">
              <el-input
                v-model="formData.ipAddress"
                :placeholder="i18ns.t('ipBlacklist.ipPlaceholder')"
              />
            </el-form-item>
            <el-form-item v-if="!isEdit" :label="i18ns.t('ipBlacklist.duration')" prop="duration">
              <el-select v-model="formData.duration" style="width: 100%">
                <el-option :label="i18ns.t('ipBlacklist.duration1Hour')" :value="3600" />
                <el-option :label="i18ns.t('ipBlacklist.duration24Hours')" :value="86400" />
                <el-option :label="i18ns.t('ipBlacklist.duration7Days')" :value="604800" />
                <el-option :label="i18ns.t('ipBlacklist.durationPermanent')" :value="-1" />
              </el-select>
            </el-form-item>
            <el-form-item :label="i18ns.t('ipBlacklist.reason')" prop="banReason">
              <el-input
                v-model="formData.banReason"
                type="textarea"
                :rows="4"
                :placeholder="i18ns.t('ipBlacklist.reasonPlaceholder')"
              />
            </el-form-item>
            <el-form-item
              v-if="isEdit"
              :label="i18ns.t('ipBlacklist.expireTime')"
              prop="expireTime"
            >
              <el-date-picker
                v-model="formData.expireTime"
                type="datetime"
                :placeholder="i18ns.t('ipBlacklist.selectExpireTime')"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
            <el-button type="primary" :loading="submitting" @click="handleSubmit">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-dialog>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { ipMonitoringService } from '@/service/ipMonitoringService'
import { ipBlacklistService } from '@/service/ipBlacklistService'
import { ipWhitelistService } from '@/service/ipWhitelistService'
import { ElMessageBox } from 'element-plus'
import { message } from '@/utils/message'
import type { FormInstance, FormRules } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'
import systemService from '@/service/systemService'
import { normalizeIp } from '@/utils/ipaddr'
import type { IpErrorStatusResponse } from '@/client/types.gen'

interface DashboardData {
  activeBans: {
    total: number
    byLevel: { level1: number; level2: number; level3: number }
    byType: { auto: number; manual: number }
    recentBans: any[]
  }
  recentActivity: {
    last24Hours: number
    last7Days: number
    timeline: Array<{ date: string; count: number }>
  }
  topBannedIPs: Array<{
    ipAddress: string
    banCount: number
    lastBanTime: string
    currentStatus: 'banned' | 'unbanned'
  }>
}

interface IPBlacklistItem {
  id: string
  ipAddress: string
  expireTime: string
  banLevel: number
  banReason: string
  bannedBy?: string | null
  errorCount: number
  metadata?: any
  status: number
  createTime: string
  updateTime: string
}

// --- Dashboard ---
const loading = ref(false)
const dashboardData = ref<DashboardData | null>(null)
let refreshTimer: number | null = null

const queryIp = ref('')
const queryLoading = ref(false)
const adjustWeight = ref(0)
const showAdjust = ref(false)
const actionLoading = ref(false)
const queryResult = ref<IpErrorStatusResponse | null>(null)

const weightHistory = ref<Array<{ weight: number; time: number; ip: string }>>([])

const handleQueryIpStatus = async () => {
  if (!queryIp.value.trim()) return
  queryLoading.value = true
  queryResult.value = null
  try {
    queryResult.value = await ipMonitoringService.getIpErrorStatus(queryIp.value.trim())
    if (queryResult.value) {
      const { ipAddress, errorWeight } = queryResult.value
      if (weightHistory.value.length && weightHistory.value[0]?.ip !== ipAddress)
        weightHistory.value = []
      weightHistory.value.push({ weight: errorWeight, time: Date.now(), ip: ipAddress })
      if (weightHistory.value.length > 10) weightHistory.value.shift()
    }
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipMonitoring.queryFailed'))
  } finally {
    queryLoading.value = false
  }
}

const handleResetWeight = async () => {
  if (!queryResult.value) return
  actionLoading.value = true
  try {
    await ipMonitoringService.resetIpErrorWeight(queryResult.value.ipAddress)
    message.success(i18ns.t('ipMonitoring.weightReset'))
    queryResult.value = await ipMonitoringService.getIpErrorStatus(queryResult.value.ipAddress)
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipMonitoring.operationFailed'))
  } finally {
    actionLoading.value = false
  }
}

const handleSetWeight = async () => {
  if (!queryResult.value) return
  actionLoading.value = true
  try {
    await ipMonitoringService.setIpErrorWeight(queryResult.value.ipAddress, adjustWeight.value)
    message.success(i18ns.t('ipMonitoring.weightAdjusted'))
    showAdjust.value = false
    queryResult.value = await ipMonitoringService.getIpErrorStatus(queryResult.value.ipAddress)
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipMonitoring.operationFailed'))
  } finally {
    actionLoading.value = false
  }
}

const levelTagType = (level: number) => {
  if (level === 3) return 'danger'
  if (level === 2) return 'warning'
  if (level === 1) return ''
  return 'success'
}

const nextThreshold = (result: typeof queryResult.value) => {
  if (!result) return null
  if (result.currentLevel === 0)
    return {
      label: 'Level 1',
      gap: parseFloat((result.thresholds.level1 - result.errorWeight).toFixed(2)),
    }
  if (result.currentLevel === 1)
    return {
      label: 'Level 2',
      gap: parseFloat((result.thresholds.level2 - result.errorWeight).toFixed(2)),
    }
  if (result.currentLevel === 2)
    return {
      label: 'Level 3',
      gap: parseFloat((result.thresholds.level3 - result.errorWeight).toFixed(2)),
    }
  return null
}

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${Math.ceil(minutes)} 分钟`
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} 小时`
  return `${(minutes / 1440).toFixed(1)} 天`
}

const decayEstimates = (result: typeof queryResult.value) => {
  if (!result || result.errorWeight <= 0) return null
  const { enabled, decayRate, minThreshold, interval } = result.decayConfig
  if (!enabled || decayRate <= 0) return null

  const factor = 1 - decayRate / 100
  if (factor <= 0) return { zeroTime: formatMinutes(interval) }

  // n intervals until weight < minThreshold
  const n = Math.ceil(Math.log(minThreshold / result.errorWeight) / Math.log(factor))
  if (n <= 0) return { zeroTime: formatMinutes(interval) }
  const zeroTime = formatMinutes(n * interval)

  // time to reach each threshold from current weight (only if below threshold)
  const times: { label: string; time: string }[] = []
  const thresholds = [
    { label: 'Level 3', val: result.thresholds.level3 },
    { label: 'Level 2', val: result.thresholds.level2 },
    { label: 'Level 1', val: result.thresholds.level1 },
  ]
  for (const t of thresholds) {
    if (result.errorWeight < t.val) continue // already below, skip
    // w * factor^n < t  =>  n = ceil(log(t/w) / log(factor))
    const nT = Math.ceil(Math.log(t.val / result.errorWeight) / Math.log(factor))
    times.push({ label: t.label, time: formatMinutes(nT * interval) })
  }

  return { zeroTime, times }
}

const HTTP_STATUS_LABELS: Record<string, string> = {
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not Found',
  '422': 'Unprocessable Entity',
  '429': 'Too Many Requests',
  '500': 'Internal Server Error',
}

const formatBreakdownLabel = (item: {
  type: 'status' | 'custom'
  code: string
  description?: string
}) => {
  if (item.type === 'status') {
    const desc = item.description || HTTP_STATUS_LABELS[item.code]
    return desc ? `HTTP ${item.code} ${desc}` : `HTTP ${item.code}`
  }
  return `${i18ns.t('ipMonitoring.customLabel')} ${item.code}`
}

const getBreakdownTagType = (item: { type: 'status' | 'custom'; code: string }) => {
  if (item.type === 'custom') return 'warning'
  const n = parseInt(item.code, 10)
  if (n >= 500) return 'danger'
  if (n >= 400) return ''
  return 'info'
}

const trendEstimate = computed(() => {
  if (!queryResult.value || weightHistory.value.length < 2) return null
  const last = weightHistory.value[weightHistory.value.length - 1]!
  const prev = weightHistory.value[weightHistory.value.length - 2]!
  const dt = (last.time - prev.time) / 60000
  if (dt < 0.05) return null
  const rate = (last.weight - prev.weight) / dt
  if (rate <= 0) return null
  const next = nextThreshold(queryResult.value)
  if (!next || next.gap <= 0) return null
  return { level: next.label, time: formatMinutes(next.gap / rate) }
})

const loadDashboard = async () => {
  loading.value = true
  try {
    dashboardData.value = await ipMonitoringService.getDashboard()
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipMonitoring.loadFailed'))
  } finally {
    loading.value = false
  }
}

// --- Blacklist Management ---
const blacklistData = ref<IPBlacklistItem[]>([])
const blLoading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const searchIP = ref('')
const currentEditIP = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const formData = reactive({
  ipAddress: '',
  duration: 3600,
  banReason: '',
  expireTime: null as Date | null,
})
const formRef = ref<FormInstance>()

const formRules: FormRules = {
  ipAddress: [
    { required: true, message: i18ns.t('ipBlacklist.ipRequired'), trigger: 'blur' },
    {
      pattern: /^(\d{1,3}\.){3}\d{1,3}$/,
      message: i18ns.t('ipBlacklist.ipInvalid'),
      trigger: 'blur',
    },
  ],
  duration: [
    { required: true, message: i18ns.t('ipBlacklist.durationRequired'), trigger: 'change' },
  ],
  banReason: [{ max: 500, message: i18ns.t('ipBlacklist.reasonTooLong'), trigger: 'blur' }],
}

const loadBlacklist = async () => {
  blLoading.value = true
  try {
    const result = await ipBlacklistService.getAll(
      pagination.pageSize,
      (pagination.page - 1) * pagination.pageSize,
    )
    blacklistData.value = result.blacklists
    pagination.total = result.total
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipBlacklist.loadFailed'))
  } finally {
    blLoading.value = false
  }
}

const handleCreate = () => {
  isEdit.value = false
  dialogVisible.value = true
}

const handleEdit = (row: IPBlacklistItem) => {
  isEdit.value = true
  currentEditIP.value = row.ipAddress
  formData.banReason = row.banReason || ''
  formData.expireTime = new Date(row.expireTime)
  dialogVisible.value = true
}

const handleUnbanRow = async (row: IPBlacklistItem) => {
  await ElMessageBox.confirm(
    i18ns.t('ipBlacklist.unbanConfirm', { ip: row.ipAddress }),
    i18ns.t('warning'),
    {
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'warning',
    },
  )
  await ipBlacklistService.delete(row.ipAddress)
  message.success(i18ns.t('ipBlacklist.unbanSuccess'))
  await loadBlacklist()
}

const handleSubmit = async () => {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
    submitting.value = true
    if (isEdit.value) {
      await ipBlacklistService.update(currentEditIP.value, {
        banReason: formData.banReason,
        expireTime: formData.expireTime?.toISOString(),
      })
      message.success(i18ns.t('ipBlacklist.updateSuccess'))
    } else {
      await ipBlacklistService.create({
        ipAddress: formData.ipAddress,
        duration: formData.duration,
        reason: formData.banReason,
      })
      message.success(i18ns.t('ipBlacklist.createSuccess'))
    }
    dialogVisible.value = false
    await loadBlacklist()
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipBlacklist.submitFailed'))
  } finally {
    submitting.value = false
  }
}

const resetForm = () => {
  formData.ipAddress = ''
  formData.duration = 3600
  formData.banReason = ''
  formData.expireTime = null
  currentEditIP.value = ''
  formRef.value?.resetFields()
}

const handleSearch = () => {
  if (searchIP.value) {
    blacklistData.value = blacklistData.value.filter((item) =>
      item.ipAddress.includes(searchIP.value),
    )
  } else {
    loadBlacklist()
  }
}

const getBanLevelType = (level: number) =>
  level === 1 ? 'warning' : level >= 2 ? 'danger' : 'info'
const isExpired = (t: string) => new Date(t) < new Date()
const formatExpireTime = (t: string) =>
  new Date(t).getFullYear() >= 2099
    ? i18ns.t('ipBlacklist.permanent')
    : new Date(t).toLocaleString()

// --- Whitelist Management ---
interface IPWhitelistItem {
  id: string
  ipAddress: string
  reason?: string
  addedBy?: string
  expiresAt?: string
  createTime: string
}

const wlData = ref<IPWhitelistItem[]>([])
const wlLoading = ref(false)
const wlDialogVisible = ref(false)
const wlSubmitting = ref(false)
const wlPagination = reactive({ page: 1, pageSize: 20, total: 0 })
const wlFormRef = ref<FormInstance>()
const wlForm = reactive({ ipAddress: '', reason: '', expiresAt: null as Date | null })

const wlFormRules: FormRules = {
  ipAddress: [
    { required: true, message: i18ns.t('ipWhitelist.ipRequired'), trigger: 'blur' },
    {
      pattern: /^(\d{1,3}\.){3}\d{1,3}$/,
      message: i18ns.t('ipWhitelist.ipInvalid'),
      trigger: 'blur',
    },
  ],
}

const loadWhitelist = async () => {
  wlLoading.value = true
  try {
    const result = await ipWhitelistService.getAll(
      wlPagination.pageSize,
      (wlPagination.page - 1) * wlPagination.pageSize,
    )
    wlData.value = result.whitelists
    wlPagination.total = result.total
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipWhitelist.loadFailed'))
  } finally {
    wlLoading.value = false
  }
}

const handleWlSubmit = async () => {
  if (!wlFormRef.value) return
  try {
    await wlFormRef.value.validate()
    wlSubmitting.value = true
    await ipWhitelistService.add({
      ipAddress: wlForm.ipAddress,
      reason: wlForm.reason || undefined,
      expiresAt: wlForm.expiresAt?.toISOString(),
    })
    message.success(i18ns.t('ipWhitelist.addSuccess'))
    wlDialogVisible.value = false
    wlForm.ipAddress = ''
    wlForm.reason = ''
    wlForm.expiresAt = null
    await loadWhitelist()
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipWhitelist.submitFailed'))
  } finally {
    wlSubmitting.value = false
  }
}

const handleWlRemove = async (row: IPWhitelistItem) => {
  await ElMessageBox.confirm(
    i18ns.t('ipWhitelist.removeConfirm', { ip: row.ipAddress }),
    i18ns.t('warning'),
    { confirmButtonText: i18ns.t('confirm'), cancelButtonText: i18ns.t('cancel'), type: 'warning' },
  )
  try {
    await ipWhitelistService.remove(row.ipAddress)
    message.success(i18ns.t('ipWhitelist.removeSuccess'))
    await loadWhitelist()
  } catch (error: any) {
    message.error(error.message || i18ns.t('ipWhitelist.removeFailed'))
  }
}

const isWlExpired = (t?: string) => !!t && new Date(t) < new Date()
const formatWlExpiry = (t?: string) => {
  if (!t) return i18ns.t('ipWhitelist.permanent')
  return isWlExpired(t)
    ? `${i18ns.t('ipWhitelist.expired')} (${new Date(t).toLocaleString()})`
    : new Date(t).toLocaleString()
}

onMounted(() => {
  loadDashboard()
  loadBlacklist()
  loadWhitelist()
  refreshTimer = window.setInterval(loadDashboard, 30000)
  systemService
    .getClientIp()
    .then((ip) => {
      if (ip) queryIp.value = normalizeIp(ip)
    })
    .catch(() => {})
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

const { isDesktop } = usePageDevice()

if (!isDesktop.value) {
  useMobileTableCardLabels('.ip-monitor-mobile-adapter')
}
</script>

<style scoped>
.ip-management {
  margin: 0 auto;
  padding: 20px;
}
@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
}
@media (max-width: 480px) {
  .stats-cards .el-col {
    margin-bottom: 12px;
  }
  .stats-cards .el-col:last-child {
    margin-bottom: 0;
  }
}
.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.search-bar {
  display: flex;
  align-items: center;
}
.overview-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 14px;
}
.stats-cards {
  margin-bottom: 20px;
}

.desktop-page .ip-management :deep(.stats-cards) {
  max-width: 100%;
}

.desktop-page .ip-management :deep(.stats-card) {
  height: 100%;
  border-radius: 10px;
}

.desktop-page .ip-management :deep(.stats-card .el-card__body) {
  min-height: 86px;
  display: flex;
  align-items: center;
  padding: 14px 16px;
}

.desktop-page .ip-management :deep(.stats-card .el-statistic) {
  width: 100%;
}

.desktop-page .ip-management :deep(.stats-card .el-statistic__head) {
  min-height: 34px;
  line-height: 1.35;
  margin-bottom: 6px;
  font-size: 12px;
}

.desktop-page .ip-management :deep(.stats-card .el-statistic__content) {
  font-weight: 700;
}
.pct-bar-bg {
  flex: 1;
  height: 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  overflow: hidden;
  min-width: 60px;
}
.pct-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.pct-danger {
  background: var(--el-color-danger);
}
.pct-warning {
  background: var(--el-color-warning);
}
.pct-normal {
  background: var(--el-color-primary);
}
.section {
  margin-bottom: 20px;
}

.desktop-page .ip-management :deep(.section) {
  max-width: 100%;
}

.top-banned-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.ip-management :deep(.top-banned-table),
.ip-management :deep(.top-banned-table .el-table__inner-wrapper),
.ip-management :deep(.top-banned-table .el-table__body-wrapper),
.ip-management :deep(.top-banned-table .el-scrollbar__view),
.ip-management :deep(.top-banned-table .el-table__header),
.ip-management :deep(.top-banned-table .el-table__body) {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

.ip-management :deep(.ip-blacklist-table),
.ip-management :deep(.ip-blacklist-table .el-table__inner-wrapper),
.ip-management :deep(.ip-blacklist-table .el-table__body-wrapper),
.ip-management :deep(.ip-blacklist-table .el-scrollbar__view),
.ip-management :deep(.ip-blacklist-table .el-table__header),
.ip-management :deep(.ip-blacklist-table .el-table__body),
.ip-management :deep(.ip-whitelist-table),
.ip-management :deep(.ip-whitelist-table .el-table__inner-wrapper),
.ip-management :deep(.ip-whitelist-table .el-table__body-wrapper),
.ip-management :deep(.ip-whitelist-table .el-scrollbar__view),
.ip-management :deep(.ip-whitelist-table .el-table__header),
.ip-management :deep(.ip-whitelist-table .el-table__body) {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

.ip-management :deep(.el-card.section) {
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
}

.ip-management :deep(.el-card.section .el-card__header) {
  font-weight: 600;
  padding: 12px 16px;
}

.ip-management :deep(.el-card.section .el-card__body) {
  padding: 14px 16px;
}

.ip-management :deep(.tab-header .el-button),
.ip-management :deep(.section .el-button) {
  min-height: 36px;
  border-radius: 8px;
}

.ip-management :deep(.tab-header .el-button + .el-button),
.ip-management :deep(.section .el-button + .el-button) {
  margin-left: 8px !important;
}

.ip-management :deep(.tab-header > div:last-child) {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ip-management :deep(.el-tabs--border-card) {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  overflow: hidden;
}

.ip-management :deep(.el-tabs--border-card > .el-tabs__content) {
  padding: 16px;
}

.desktop-page .ip-management :deep(.el-descriptions) {
  max-width: 100%;
}

.ip-management :deep(.el-card.section) {
  border-radius: 10px;
}

.desktop-page .ip-management :deep(.action-group) {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
}

.desktop-page .ip-management :deep(.action-group .el-button) {
  margin-left: 0 !important;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
.expired-text {
  color: #909399;
  text-decoration: line-through;
}
.seg-bar-wrap {
  user-select: none;
}
.seg-bar {
  position: relative;
  display: flex;
  height: 24px;
  border-radius: 4px;
  overflow: visible;
  margin-top: 12px;
}
.seg {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
  font-weight: 700;
  overflow: hidden;
}
.seg-green {
  background: #67c23a;
}
.seg-passed {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: rgba(180, 180, 180, 0.8);
  pointer-events: none;
  z-index: 1;
}
.seg-yellow {
  background: #e6a23c;
}
.seg-red {
  background: #f56c6c;
}
.seg-cursor {
  position: absolute;
  top: -14px;
  transform: translateX(-50%);
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.seg-cursor::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 10px solid #303133;
}
.seg-cursor::after {
  content: '';
  width: 2px;
  height: 38px;
  background: rgba(48, 49, 51, 0.7);
}
.seg-labels {
  position: relative;
  height: 18px;
  margin-top: 2px;
  font-size: 11px;
  color: #606266;
}
.seg-labels span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
</style>

<style>
.el-tabs__content .el-tab-pane {
  animation: tab-fade-in 0.2s ease;
}
@keyframes tab-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

<style scoped>
.ip-monitor-mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.ip-monitor-mobile-adapter :deep(.el-tabs--border-card > .el-tabs__content) {
  padding: 10px 8px;
}

.ip-monitor-mobile-adapter :deep(.el-card.section) {
  margin-bottom: 10px;
  border-radius: 10px;
}

.ip-monitor-mobile-adapter :deep(.hide-on-mobile),
.ip-monitor-mobile-adapter :deep(.el-table__header-wrapper),
.ip-monitor-mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
.ip-monitor-mobile-adapter :deep(.el-table__body colgroup),
.ip-monitor-mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.ip-monitor-mobile-adapter :deep(.el-tabs__nav-wrap) {
  overflow-x: auto;
}

.ip-monitor-mobile-adapter :deep(.el-form--inline),
.ip-monitor-mobile-adapter :deep(.tab-header),
.ip-monitor-mobile-adapter :deep(.search-bar) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.ip-monitor-mobile-adapter :deep(.el-row) {
  row-gap: 8px;
}

.ip-monitor-mobile-adapter :deep(.stats-cards.el-row) {
  margin-left: 0 !important;
  margin-right: 0 !important;
}

.ip-monitor-mobile-adapter :deep(.stats-cards > .el-col) {
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin-bottom: 8px;
}

.ip-monitor-mobile-adapter :deep(.stats-card) {
  width: 100%;
  border-radius: 10px;
}

.ip-monitor-mobile-adapter :deep(.stats-card .el-card__body) {
  min-height: 74px;
  display: flex;
  align-items: center;
  padding: 12px 14px;
}

.ip-monitor-mobile-adapter :deep(.stats-card .el-statistic) {
  width: 100%;
}

.ip-monitor-mobile-adapter :deep(.stats-card .el-statistic__head) {
  line-height: 1.35;
  margin-bottom: 4px;
  font-size: 12px;
}

.ip-monitor-mobile-adapter :deep(.el-col) {
  width: 100% !important;
  max-width: 100% !important;
  flex: 0 0 100% !important;
}

.ip-monitor-mobile-adapter :deep(.el-input),
.ip-monitor-mobile-adapter :deep(.el-select),
.ip-monitor-mobile-adapter :deep(.el-date-editor),
.ip-monitor-mobile-adapter :deep(.el-input-number),
.ip-monitor-mobile-adapter :deep(.el-textarea),
.ip-monitor-mobile-adapter :deep(.el-button) {
  width: 100%;
  max-width: 100% !important;
}

.ip-monitor-mobile-adapter :deep(.tab-header > div) {
  width: 100%;
}

.ip-monitor-mobile-adapter :deep(.tab-header .el-button),
.ip-monitor-mobile-adapter :deep(.section .el-button) {
  min-height: 38px;
  border-radius: 8px;
}

.ip-monitor-mobile-adapter :deep(.tab-header .el-button + .el-button),
.ip-monitor-mobile-adapter :deep(.section .el-button + .el-button) {
  margin-left: 0 !important;
}

.ip-monitor-mobile-adapter :deep(.el-table__inner-wrapper),
.ip-monitor-mobile-adapter :deep(.el-table__body-wrapper),
.ip-monitor-mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.ip-monitor-mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.ip-monitor-mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  overflow-x: hidden !important;
}

.ip-monitor-mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-y: visible !important;
  padding: 4px 0 10px;
}

.ip-monitor-mobile-adapter :deep(.top-banned-table .el-table__body-wrapper) {
  padding: 0;
}

.ip-monitor-mobile-adapter :deep(.top-banned-table .el-table__header),
.ip-monitor-mobile-adapter :deep(.top-banned-table .el-table__body) {
  width: 100% !important;
  max-width: 100% !important;
}

.ip-monitor-mobile-adapter :deep(.ip-blacklist-table .el-table__header),
.ip-monitor-mobile-adapter :deep(.ip-blacklist-table .el-table__body),
.ip-monitor-mobile-adapter :deep(.ip-whitelist-table .el-table__header),
.ip-monitor-mobile-adapter :deep(.ip-whitelist-table .el-table__body) {
  width: 100% !important;
  max-width: 100% !important;
}

.ip-monitor-mobile-adapter :deep(.top-banned-table .cell) {
  white-space: normal;
  word-break: break-word;
}

.ip-monitor-mobile-adapter :deep(.top-banned-table td.top-banned-ip-col .cell) {
  width: 100%;
  max-width: none !important;
  white-space: nowrap !important;
  word-break: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}

.ip-monitor-mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ip-monitor-mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.ip-monitor-mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 5px 0;
}

.ip-monitor-mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.ip-monitor-mobile-adapter :deep(.action-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ip-monitor-mobile-adapter :deep(.action-group .el-button) {
  min-height: 34px;
  padding: 0 12px;
}

.ip-monitor-mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.ip-monitor-mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.ip-monitor-mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
