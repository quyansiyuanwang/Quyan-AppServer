<template>
  <div class="desktop-page">
    <el-card class="relay-token-management page-card relay-token-shell">
      <template #header>
        <div class="card-header toolbar-row">
          <span class="page-title">{{ i18ns.t('relay.tokenManagement') }}</span>
          <div class="button-group">
            <el-text v-if="selectedTokenIds.length" class="selected-token-summary">
              {{ i18ns.t('relay.selectedTokens', { count: selectedTokenIds.length }) }}
            </el-text>
            <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
              <el-button plain @click="state.openTokenImportDialog">
                {{ i18ns.t('relay.importTokens') }}
              </el-button>
            </PermissionWrapper>
            <el-dropdown
              trigger="click"
              :disabled="!selectedTokenIds.length"
              @command="
                (command: string | number | object) =>
                  state.handleBatchTokenCommand(String(command))
              "
            >
              <el-button plain :disabled="!selectedTokenIds.length">
                {{ i18ns.t('nav.more') }}
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                    <el-dropdown-item command="enable">
                      {{ i18ns.t('relay.batchEnableTokens') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                    <el-dropdown-item command="disable">
                      {{ i18ns.t('relay.batchDisableTokens') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                    <el-dropdown-item command="export" divided>
                      {{ i18ns.t('relay.batchExportTokens') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                    <el-dropdown-item command="duplicate">
                      {{ i18ns.t('relay.batchDuplicateTokens') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                    <el-dropdown-item command="copy-token-value" divided>
                      {{ i18ns.t('relay.copyTokenValue') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                    <el-dropdown-item command="copy-json">
                      {{ i18ns.t('relay.copyTokenJson') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_DELETE]">
                    <el-dropdown-item command="delete" divided>
                      {{ i18ns.t('relay.batchDeleteTokens') }}
                    </el-dropdown-item>
                  </PermissionWrapper>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button :icon="Refresh" :loading="loadingTokens" @click="state.refreshTokens">
              {{ i18ns.t('refresh') }}
            </el-button>
            <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
              <el-button type="primary" @click="state.openCreateDialog">
                {{ i18ns.t('relay.createToken') }}
              </el-button>
            </PermissionWrapper>
          </div>
        </div>
      </template>

      <div class="token-filter-bar">
        <el-select
          v-if="canManageAllTokens"
          v-model="selectedTargetUserId"
          filterable
          remote
          clearable
          reserve-keyword
          class="token-filter-input"
          :loading="userOptionsLoading"
          :placeholder="i18ns.t('username')"
          :remote-method="state.handleTargetUserSearch"
          @change="state.handleTargetUserChange"
          @clear="state.handleTargetUserChange"
        >
          <el-option
            v-for="user in userOptions"
            :key="user.id"
            :label="user.name ? `${user.name} (${user.username})` : user.username"
            :value="user.id"
          />
        </el-select>
        <el-input
          v-model="searchKeyword"
          clearable
          class="token-filter-input"
          :placeholder="i18ns.t('relay.searchKeywordPlaceholder')"
          @clear="state.handleSearch"
          @keyup.enter="state.handleSearch"
        />
        <el-input
          v-model="searchTokenKeyword"
          clearable
          class="token-filter-input"
          :placeholder="i18ns.t('relay.searchTokenPlaceholder')"
          @clear="state.handleSearch"
          @keyup.enter="state.handleSearch"
        />
        <div class="token-filter-actions">
          <el-button type="primary" :loading="loadingTokens" @click="state.handleSearch">
            {{ i18ns.t('relay.searchAction') }}
          </el-button>
          <el-button :loading="loadingTokens" @click="state.toggleShowAll">
            {{ i18ns.t(showAllMode ? 'relay.pagedDisplay' : 'relay.showAll') }}
          </el-button>
        </div>
      </div>

      <el-table
        ref="tokenTableRef"
        v-loading="loadingTokens"
        :data="tokens"
        row-key="id"
        border
        stripe
        class="token-table"
        header-cell-class-name="token-table-header"
        @selection-change="state.handleTokenSelectionChange"
      >
        <el-table-column type="selection" width="48" align="center" reserve-selection />
        <el-table-column
          prop="name"
          :label="i18ns.t('relay.tokenName')"
          min-width="100"
          class-name="token-name-column"
        >
          <template #default="{ row }">
            <span class="token-name">{{ row.name || i18ns.t('relay.unnamedToken') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.token')" min-width="180">
          <template #default="{ row }">
            <div class="token-cell">
              <el-link type="primary" class="token-link" @click="state.copyToken(row.token)">
                {{ row.token.substring(0, 12) }}...{{ row.token.slice(-4) }}
              </el-link>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.orderedChannels')" min-width="180">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="180">
              <template #content>
                <div class="channel-tooltip-content">
                  <div v-if="state.getSortedChannelConfigs(row).length" class="channel-config-list">
                    <div
                      v-for="config in state.getSortedChannelConfigs(row)"
                      :key="`tooltip-${row.id}-${config.channelId}-${config.priority}`"
                      class="channel-config-item"
                    >
                      <el-tag
                        size="small"
                        :type="config.priority === 0 ? 'success' : 'info'"
                        effect="plain"
                      >
                        {{
                          `#${config.priority + 1} ${config.channelName || state.getChannelName(config.channelId)}`
                        }}
                      </el-tag>
                      <span class="channel-success-rate">{{
                        state.formatSuccessRate(config.successRate)
                      }}</span>
                    </div>
                  </div>
                  <div v-else>{{ i18ns.t('relay.noChannel') }}</div>

                  <div class="failover-tooltip-content">
                    <div>
                      {{
                        row.failoverConfig?.enabled
                          ? i18ns.t('relay.failoverEnabled')
                          : i18ns.t('relay.failoverDisabled')
                      }}
                    </div>
                    <div>
                      {{ i18ns.t('relay.maxRetries') }}: {{ row.failoverConfig?.maxRetries ?? 0 }}
                    </div>
                    <div>
                      {{ i18ns.t('relay.failoverThreshold') }}:
                      {{ row.failoverConfig?.failoverThreshold ?? 0 }}
                    </div>
                    <div>
                      {{ i18ns.t('relay.failbackCooldownMinutes') }}:
                      {{ row.failoverConfig?.failbackCooldownMinutes ?? 0 }}
                    </div>
                    <div>
                      {{ i18ns.t('relay.retryStatusCodes') }}:
                      {{ state.formatRetryStatusCodes(row.failoverConfig?.retryStatusCodes || []) }}
                    </div>
                  </div>
                </div>
              </template>
              <div class="channel-config-list">
                <div v-if="state.getSortedChannelConfigs(row).length" class="channel-config-list">
                  <div
                    v-for="config in state.getVisibleChannelConfigs(row)"
                    :key="`${row.id}-${config.channelId}-${config.priority}`"
                    class="channel-config-item"
                  >
                    <el-tag
                      size="small"
                      :type="config.priority === 0 ? 'success' : 'info'"
                      effect="plain"
                    >
                      {{
                        `#${config.priority + 1} ${config.channelName || state.getChannelName(config.channelId)}`
                      }}
                    </el-tag>
                    <span class="channel-success-rate">{{
                      state.formatSuccessRate(config.successRate)
                    }}</span>
                  </div>
                  <el-tag
                    v-if="state.getHiddenChannelConfigCount(row) > 0"
                    size="small"
                    type="info"
                    effect="plain"
                    class="channel-config-more"
                  >
                    {{ i18ns.t('nav.more') }} {{ state.getHiddenChannelConfigCount(row) }}
                  </el-tag>
                </div>
                <span v-else class="stat-text">{{ i18ns.t('relay.noChannel') }}</span>

                <div class="failover-summary failover-summary-compact channel-config-meta">
                  <el-tag
                    size="small"
                    :type="row.failoverConfig?.enabled ? 'success' : 'info'"
                    effect="plain"
                  >
                    {{
                      row.failoverConfig?.enabled
                        ? i18ns.t('relay.failoverEnabled')
                        : i18ns.t('relay.failoverDisabled')
                    }}
                  </el-tag>
                  <div class="summary-line">{{ state.formatCompactFailoverSummary(row) }}</div>
                </div>
              </div>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column
          :label="`${i18ns.t('relay.requestCount')} / ${i18ns.t('relay.totalTokens')}`"
          min-width="150"
          align="center"
        >
          <template #default="{ row }">
            <div class="stat-summary">
              <div class="stat-summary__item">
                <span class="stat-summary__label">{{ i18ns.t('relay.requestCount') }}</span>
                <span class="stat-summary__value">{{ row.requestCount || 0 }}</span>
              </div>
              <div class="stat-summary__item">
                <span class="stat-summary__label">{{ i18ns.t('relay.totalTokens') }}</span>
                <span class="stat-summary__value">{{
                  state.formatNumber(row.totalTokens || 0)
                }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.expiresAt')" align="center">
          <template #default="{ row }">
            <div class="expire-cell">
              <el-icon v-if="row.expiresAt" class="time-icon"><Clock /></el-icon>
              <span v-if="row.expiresAt" class="datetime-text">{{
                state.formatDateTime(row.expiresAt)
              }}</span>
              <el-tag v-else size="small" type="success" effect="plain">{{
                i18ns.t('relay.neverExpire')
              }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.quotaUsage')" min-width="220" align="center">
          <template #default="{ row }">
            <template
              v-for="(quota, quotaIndex) in [state.getTokenQuotaSnapshot(row)]"
              :key="quotaIndex"
            >
              <div class="quota-usage-cell">
                <div class="quota-usage-line">
                  <span class="quota-text" :class="{ 'quota-text--danger': quota.isQuotaExceeded }">
                    {{ i18ns.t('relay.usedQuota') }}:
                    {{ state.formatQuotaAmount(quota.usedQuota) }}
                  </span>
                  <span class="quota-limit-text">
                    /
                    {{
                      row.quotaLimit != null
                        ? state.formatQuotaAmount(row.quotaLimit)
                        : i18ns.t('relay.unlimited')
                    }}
                  </span>
                </div>
                <div class="quota-meta">
                  <span v-if="quota.quotaUsagePercent != null">{{
                    state.formatQuotaPercent(quota.quotaUsagePercent)
                  }}</span>
                </div>
                <el-progress
                  v-if="quota.quotaUsagePercent != null"
                  :percentage="state.getQuotaProgressPercentage(quota.quotaUsagePercent)"
                  :status="state.getQuotaProgressStatus(quota.quotaUsagePercent)"
                  :stroke-width="8"
                  :show-text="false"
                  class="quota-progress"
                />
                <div v-if="state.getRelayTokenQuotaWindows(row).length" class="quota-window-list">
                  <template
                    v-for="(
                      quotaWindow, quotaWindowIndex
                    ) in state.getPrimaryRelayTokenQuotaWindows(row)"
                    :key="`${row.id}-quota-window-${quotaWindowIndex}`"
                  >
                    <div
                      class="quota-window-inline"
                      :class="{ 'quota-window-inline--danger': quotaWindow.isQuotaExceeded }"
                    >
                      <el-progress
                        v-if="quotaWindow.quotaUsagePercent != null"
                        :percentage="
                          state.getQuotaProgressPercentage(quotaWindow.quotaUsagePercent)
                        "
                        :status="state.getQuotaProgressStatus(quotaWindow.quotaUsagePercent)"
                        :stroke-width="6"
                        :show-text="false"
                        class="quota-window-inline__progress"
                      />
                      <span class="quota-window-inline__summary">
                        {{ state.formatQuotaWindowCompactSummary(quotaWindow) }}
                      </span>
                      <el-button
                        v-if="state.getRemainingRelayTokenQuotaWindowCount(row) > 0"
                        text
                        class="quota-window-inline__more"
                        @click="state.openQuotaWindowDetailDialog(row)"
                      >
                        {{ i18ns.t('nav.more') }}
                        {{ state.getRemainingRelayTokenQuotaWindowCount(row) }}
                      </el-button>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('status')" width="90" align="center">
          <template #default="{ row }">
            <el-tag
              v-if="row.status === MANAGED_STATUS.ENABLED"
              size="small"
              type="success"
              effect="dark"
            >
              {{ i18ns.t('relay.enabled') }}
            </el-tag>
            <el-tag v-else size="small" type="info" effect="dark">{{
              i18ns.t('relay.disabled')
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="340" fixed="right" align="center">
          <template #default="{ row }">
            <div class="action-buttons">
              <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                <el-button size="small" type="primary" plain @click="state.openEditDialog(row)">{{
                  i18ns.t('edit')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                <el-button
                  size="small"
                  :type="row.status === MANAGED_STATUS.ENABLED ? 'warning' : 'success'"
                  plain
                  @click="state.handleToggleStatus(row)"
                >
                  {{
                    row.status === MANAGED_STATUS.ENABLED
                      ? i18ns.t('relay.disable')
                      : i18ns.t('relay.enable')
                  }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_TOKEN_DELETE]">
                <el-button size="small" type="danger" plain @click="state.handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </PermissionWrapper>
              <el-dropdown
                trigger="click"
                @command="
                  (command: string | number | object) =>
                    state.handleMoreCommand(String(command), row)
                "
              >
                <el-button size="small" plain>
                  {{ i18ns.t('nav.more') }}
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                      <el-dropdown-item command="refresh-token">
                        {{ i18ns.t('relay.refreshToken') }}
                      </el-dropdown-item>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                      <el-dropdown-item command="open-switch-logs">
                        {{ i18ns.t('relay.switchLogs') }}
                      </el-dropdown-item>
                    </PermissionWrapper>
                    <el-dropdown-item command="copy-token-value" divided>
                      {{ i18ns.t('relay.copyTokenValue') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="copy-json">
                      {{ i18ns.t('relay.copyTokenJson') }}
                    </el-dropdown-item>
                    <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                      <el-dropdown-item command="duplicate" divided>
                        {{ i18ns.t('relay.cloneToken') }}
                      </el-dropdown-item>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                      <el-dropdown-item command="export">
                        {{ i18ns.t('relay.exportTokens') }}
                      </el-dropdown-item>
                    </PermissionWrapper>
                    <el-dropdown-item command="export-ccswitch">
                      {{ i18ns.t('relay.exportToCcswitch') }}
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-for="format in state.getTokenSupportedFormats(row)"
                      :key="`desktop-ccswitch-${row.id}-${format}`"
                      :command="`launch-ccswitch-${format}`"
                      divided
                    >
                      {{ state.getCcswitchLaunchLabel(format) }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="showPagination" class="pagination-wrapper">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :background="true"
          :disabled="loadingTokens"
          :page-sizes="pageSizeOptions"
          :total="paginationTotal"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="state.handleCurrentPageChange"
          @size-change="state.handlePageSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { Clock, Refresh } from '@element-plus/icons-vue'
import { Permission } from '@/constant/permission'
import { MANAGED_STATUS } from '@/constant/status'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { i18ns } from '@/locales'
import { useRelayTokenManagementContext } from '../context'

const state = useRelayTokenManagementContext()

const {
  tokenTableRef,
  userOptions,
  userOptionsLoading,
  selectedTargetUserId,
  loadingTokens,
  currentPage,
  pageSize,
  pageSizeOptions,
  searchKeyword,
  searchTokenKeyword,
  showAllMode,
  selectedTokenIds,
  tokens,
  canManageAllTokens,
  paginationTotal,
  showPagination,
} = state
</script>
