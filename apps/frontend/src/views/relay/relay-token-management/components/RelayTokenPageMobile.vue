<template>
  <div class="mobile-page">
    <div class="relay-token-mobile">
      <el-card class="mobile-card relay-token-shell">
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
              <el-button
                plain
                :disabled="!tokens.length"
                @click="state.handleSelectAllVisibleTokens"
              >
                {{ i18ns.t('relay.selectAllTokens') }}
              </el-button>
              <el-button
                plain
                :disabled="!selectedTokenIds.length"
                @click="state.clearTokenSelection"
              >
                {{ i18ns.t('relay.clearTokenSelection') }}
              </el-button>
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

        <div class="token-filter-bar token-filter-bar--mobile">
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
          <div class="token-filter-actions token-filter-actions--mobile">
            <el-button type="primary" :loading="loadingTokens" @click="state.handleSearch">
              {{ i18ns.t('relay.searchAction') }}
            </el-button>
            <el-button :loading="loadingTokens" @click="state.toggleShowAll">
              {{ i18ns.t(showAllMode ? 'relay.pagedDisplay' : 'relay.showAll') }}
            </el-button>
          </div>
        </div>

        <div v-if="selectedTokenIds.length" class="token-mobile-batch-actions">
          <el-dropdown
            trigger="click"
            @command="
              (command: string | number | object) => state.handleBatchTokenCommand(String(command))
            "
          >
            <el-button size="small" plain>
              {{ i18ns.t('nav.more') }}
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                  <el-dropdown-item command="enable">{{
                    i18ns.t('relay.batchEnableTokens')
                  }}</el-dropdown-item>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                  <el-dropdown-item command="disable">{{
                    i18ns.t('relay.batchDisableTokens')
                  }}</el-dropdown-item>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                  <el-dropdown-item command="export" divided>{{
                    i18ns.t('relay.batchExportTokens')
                  }}</el-dropdown-item>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                  <el-dropdown-item command="duplicate">{{
                    i18ns.t('relay.batchDuplicateTokens')
                  }}</el-dropdown-item>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                  <el-dropdown-item command="copy-token-value" divided>{{
                    i18ns.t('relay.copyTokenValue')
                  }}</el-dropdown-item>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                  <el-dropdown-item command="copy-json">{{
                    i18ns.t('relay.copyTokenJson')
                  }}</el-dropdown-item>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_DELETE]">
                  <el-dropdown-item command="delete" divided>{{
                    i18ns.t('relay.batchDeleteTokens')
                  }}</el-dropdown-item>
                </PermissionWrapper>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <div v-if="tokens.length" class="mobile-card-list token-list">
          <el-card
            v-for="row in tokens"
            :key="row.id"
            class="token-mobile-card mobile-card"
            shadow="never"
          >
            <div class="token-mobile-card__selection">
              <el-checkbox
                :model-value="selectedTokenIdSet.has(row.id)"
                @change="
                  (value: string | number | boolean) =>
                    state.handleMobileTokenSelectionChange(row.id, Boolean(value))
                "
              />
            </div>
            <div class="token-mobile-card__header">
              <div class="token-mobile-title">{{ row.name || i18ns.t('relay.unnamedToken') }}</div>
              <el-tag v-if="row.status === MANAGED_STATUS.ENABLED" size="small" type="success">{{
                i18ns.t('relay.enabled')
              }}</el-tag>
              <el-tag v-else size="small" type="info">{{ i18ns.t('relay.disabled') }}</el-tag>
            </div>

            <div class="token-mobile-grid">
              <div class="token-mobile-field full token-mobile-token-row">
                <span class="label">{{ i18ns.t('relay.token') }}</span>
                <div class="token-mobile-token-content">
                  <el-link
                    type="primary"
                    class="token-link token-link-mobile"
                    @click="state.copyToken(row.token)"
                  >
                    {{ state.maskToken(row.token, 10, 8) }}
                  </el-link>
                </div>
              </div>
              <div class="token-mobile-field">
                <span class="label">{{ i18ns.t('relay.orderedChannels') }}</span>
                <span class="value">{{ state.formatChannelSummary(row) }}</span>
                <span class="hint">{{ state.formatMobileChannelMeta(row) }}</span>
              </div>
              <div class="token-mobile-field">
                <span class="label"
                  >{{ i18ns.t('relay.requestCount') }} / {{ i18ns.t('relay.totalTokens') }}</span
                >
                <span class="value">{{ state.formatTokenStatsSummary(row) }}</span>
              </div>
              <div class="token-mobile-field">
                <span class="label">{{ i18ns.t('relay.expiresAt') }}</span>
                <span class="value">{{
                  row.expiresAt ? state.formatDateTime(row.expiresAt) : i18ns.t('relay.neverExpire')
                }}</span>
              </div>
              <div class="token-mobile-field full token-mobile-field--quota">
                <span class="label">{{ i18ns.t('relay.quotaUsage') }}</span>
                <template
                  v-for="(quota, quotaIndex) in [state.getTokenQuotaSnapshot(row)]"
                  :key="quotaIndex"
                >
                  <div class="token-mobile-quota">
                    <div class="token-mobile-quota__primary">
                      <span
                        class="quota-text"
                        :class="{ 'quota-text--danger': quota.isQuotaExceeded }"
                      >
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
                    <div class="token-mobile-quota__secondary">
                      <span
                        >{{ i18ns.t('relay.remainingQuota') }}:
                        {{ state.formatRemainingQuota(quota) }}</span
                      >
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
                    <div
                      v-if="state.getRelayTokenQuotaWindows(row).length"
                      class="quota-window-list quota-window-list--mobile"
                    >
                      <span class="quota-window-list__label"
                        >{{ i18ns.t('relay.quotaWindows') }}:</span
                      >
                      <template
                        v-for="(
                          quotaWindow, quotaWindowIndex
                        ) in state.getPrimaryRelayTokenQuotaWindows(row)"
                        :key="`${row.id}-mobile-quota-window-${quotaWindowIndex}`"
                      >
                        <div
                          class="quota-window-inline quota-window-inline--mobile"
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
                          <span class="quota-window-inline__summary">{{
                            state.formatQuotaWindowCompactSummary(quotaWindow)
                          }}</span>
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
              </div>
            </div>

            <div class="token-mobile-actions">
              <div class="token-mobile-action-item">
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                  <el-button size="small" type="primary" plain @click="state.openEditDialog(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                </PermissionWrapper>
              </div>
              <div class="token-mobile-action-item">
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                  <el-button size="small" plain @click="state.openSwitchLogsDialog(row)">{{
                    i18ns.t('relay.switchLogs')
                  }}</el-button>
                </PermissionWrapper>
              </div>
              <div class="token-mobile-action-item">
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
              </div>
              <div class="token-mobile-action-item">
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_DELETE]">
                  <el-button size="small" type="danger" plain @click="state.handleDelete(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </PermissionWrapper>
              </div>
              <div class="token-mobile-action-item">
                <el-dropdown
                  trigger="click"
                  @command="
                    (command: string | number | object) =>
                      state.handleMoreCommand(String(command), row)
                  "
                >
                  <el-button size="small" plain>{{ i18ns.t('nav.more') }}</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                        <el-dropdown-item command="refresh-token">{{
                          i18ns.t('relay.refreshToken')
                        }}</el-dropdown-item>
                      </PermissionWrapper>
                      <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                        <el-dropdown-item command="open-switch-logs">{{
                          i18ns.t('relay.switchLogs')
                        }}</el-dropdown-item>
                      </PermissionWrapper>
                      <el-dropdown-item command="copy-token-value" divided>{{
                        i18ns.t('relay.copyTokenValue')
                      }}</el-dropdown-item>
                      <el-dropdown-item command="copy-json">{{
                        i18ns.t('relay.copyTokenJson')
                      }}</el-dropdown-item>
                      <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                        <el-dropdown-item command="duplicate" divided>{{
                          i18ns.t('relay.cloneToken')
                        }}</el-dropdown-item>
                      </PermissionWrapper>
                      <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
                        <el-dropdown-item command="export">{{
                          i18ns.t('relay.exportTokens')
                        }}</el-dropdown-item>
                      </PermissionWrapper>
                      <el-dropdown-item command="export-ccswitch">{{
                        i18ns.t('relay.exportToCcswitch')
                      }}</el-dropdown-item>
                      <el-dropdown-item
                        v-for="format in state.getTokenSupportedFormats(row)"
                        :key="`mobile-ccswitch-${row.id}-${format}`"
                        :command="`launch-ccswitch-${format}`"
                        divided
                      >
                        {{ state.getCcswitchLaunchLabel(format) }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </el-card>
        </div>
        <el-empty v-else />

        <div v-if="showPagination" class="pagination-wrapper pagination-wrapper--mobile">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :background="true"
            :disabled="loadingTokens"
            :page-sizes="pageSizeOptions"
            :small="true"
            :total="paginationTotal"
            layout="total, prev, pager, next"
            @current-change="state.handleCurrentPageChange"
            @size-change="state.handlePageSizeChange"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { Permission } from '@/constant/permission'
import { MANAGED_STATUS } from '@/constant/status'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { i18ns } from '@/locales'
import { useRelayTokenManagementContext } from '../context'

const state = useRelayTokenManagementContext()

const {
  tokens,
  selectedTokenIds,
  selectedTokenIdSet,
  showPagination,
  userOptionsLoading,
  userOptions,
  canManageAllTokens,
  selectedTargetUserId,
  searchKeyword,
  searchTokenKeyword,
  loadingTokens,
  showAllMode,
  currentPage,
  pageSize,
  pageSizeOptions,
  paginationTotal,
} = state
</script>
