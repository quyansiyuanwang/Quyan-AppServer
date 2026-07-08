<template>
  <div class="relay-token-management-view">
    <div v-if="isDesktop" class="desktop-page">
      <el-card class="relay-token-management page-card relay-token-shell">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="page-title">{{ i18ns.t('relay.tokenManagement') }}</span>
            <div class="button-group">
              <el-text v-if="selectedTokenIds.length" class="selected-token-summary">
                {{ i18ns.t('relay.selectedTokens', { count: selectedTokenIds.length }) }}
              </el-text>
              <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                <el-button plain @click="openTokenImportDialog">
                  {{ i18ns.t('relay.importTokens') }}
                </el-button>
              </PermissionWrapper>
              <el-dropdown
                trigger="click"
                :disabled="!selectedTokenIds.length"
                @command="
                  (command: string | number | object) => handleBatchTokenCommand(String(command))
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
              <el-button :icon="Refresh" :loading="loadingTokens" @click="refreshTokens">
                {{ i18ns.t('refresh') }}
              </el-button>
              <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                <el-button type="primary" @click="openCreateDialog">
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
            :remote-method="handleTargetUserSearch"
            @change="handleTargetUserChange"
            @clear="handleTargetUserChange"
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
            @clear="handleSearch"
            @keyup.enter="handleSearch"
          />
          <el-input
            v-model="searchTokenKeyword"
            clearable
            class="token-filter-input"
            :placeholder="i18ns.t('relay.searchTokenPlaceholder')"
            @clear="handleSearch"
            @keyup.enter="handleSearch"
          />
          <div class="token-filter-actions">
            <el-button type="primary" :loading="loadingTokens" @click="handleSearch">
              {{ i18ns.t('relay.searchAction') }}
            </el-button>
            <el-button :loading="loadingTokens" @click="toggleShowAll">
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
          @selection-change="handleTokenSelectionChange"
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
                <el-link type="primary" class="token-link" @click="copyToken(row.token)">
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
                    <div v-if="getSortedChannelConfigs(row).length" class="channel-config-list">
                      <div
                        v-for="config in getSortedChannelConfigs(row)"
                        :key="`tooltip-${row.id}-${config.channelId}-${config.priority}`"
                        class="channel-config-item"
                      >
                        <el-tag
                          size="small"
                          :type="config.priority === 0 ? 'success' : 'info'"
                          effect="plain"
                        >
                          {{
                            `#${config.priority + 1} ${config.channelName || getChannelName(config.channelId)}`
                          }}
                        </el-tag>
                        <span class="channel-success-rate">{{
                          formatSuccessRate(config.successRate)
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
                        {{ formatRetryStatusCodes(row.failoverConfig?.retryStatusCodes || []) }}
                      </div>
                    </div>
                  </div>
                </template>
                <div class="channel-config-list">
                  <div v-if="getSortedChannelConfigs(row).length" class="channel-config-list">
                    <div
                      v-for="config in getVisibleChannelConfigs(row)"
                      :key="`${row.id}-${config.channelId}-${config.priority}`"
                      class="channel-config-item"
                    >
                      <el-tag
                        size="small"
                        :type="config.priority === 0 ? 'success' : 'info'"
                        effect="plain"
                      >
                        {{
                          `#${config.priority + 1} ${config.channelName || getChannelName(config.channelId)}`
                        }}
                      </el-tag>
                      <span class="channel-success-rate">{{
                        formatSuccessRate(config.successRate)
                      }}</span>
                    </div>
                    <el-tag
                      v-if="getHiddenChannelConfigCount(row) > 0"
                      size="small"
                      type="info"
                      effect="plain"
                      class="channel-config-more"
                    >
                      {{ i18ns.t('nav.more') }} {{ getHiddenChannelConfigCount(row) }}
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
                    <div class="summary-line">{{ formatCompactFailoverSummary(row) }}</div>
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
                  <span class="stat-summary__value">{{ formatNumber(row.totalTokens || 0) }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('relay.expiresAt')" align="center">
            <template #default="{ row }">
              <div class="expire-cell">
                <el-icon v-if="row.expiresAt" class="time-icon"><Clock /></el-icon>
                <span v-if="row.expiresAt" class="datetime-text">{{
                  formatDateTime(row.expiresAt)
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
                v-for="(quota, quotaIndex) in [getTokenQuotaSnapshot(row)]"
                :key="quotaIndex"
              >
                <div class="quota-usage-cell">
                  <div class="quota-usage-line">
                    <span
                      class="quota-text"
                      :class="{ 'quota-text--danger': quota.isQuotaExceeded }"
                    >
                      {{ i18ns.t('relay.usedQuota') }}:
                      {{ formatQuotaAmount(quota.usedQuota) }}
                    </span>
                    <span class="quota-limit-text">
                      /
                      {{
                        row.quotaLimit != null
                          ? formatQuotaAmount(row.quotaLimit)
                          : i18ns.t('relay.unlimited')
                      }}
                    </span>
                  </div>
                  <div class="quota-meta">
                    <span v-if="quota.quotaUsagePercent != null">
                      {{ formatQuotaPercent(quota.quotaUsagePercent) }}
                    </span>
                  </div>
                  <el-progress
                    v-if="quota.quotaUsagePercent != null"
                    :percentage="getQuotaProgressPercentage(quota.quotaUsagePercent)"
                    :status="getQuotaProgressStatus(quota.quotaUsagePercent)"
                    :stroke-width="8"
                    :show-text="false"
                    class="quota-progress"
                  />
                  <div v-if="getRelayTokenQuotaWindows(row).length" class="quota-window-list">
                    <template
                      v-for="(quotaWindow, quotaWindowIndex) in getPrimaryRelayTokenQuotaWindows(
                        row,
                      )"
                      :key="`${row.id}-quota-window-${quotaWindowIndex}`"
                    >
                      <div
                        class="quota-window-inline"
                        :class="{ 'quota-window-inline--danger': quotaWindow.isQuotaExceeded }"
                      >
                        <el-progress
                          v-if="quotaWindow.quotaUsagePercent != null"
                          :percentage="getQuotaProgressPercentage(quotaWindow.quotaUsagePercent)"
                          :status="getQuotaProgressStatus(quotaWindow.quotaUsagePercent)"
                          :stroke-width="6"
                          :show-text="false"
                          class="quota-window-inline__progress"
                        />
                        <span class="quota-window-inline__summary">
                          {{ formatQuotaWindowCompactSummary(quotaWindow) }}
                        </span>
                        <el-button
                          v-if="getRemainingRelayTokenQuotaWindowCount(row) > 0"
                          text
                          class="quota-window-inline__more"
                          @click="openQuotaWindowDetailDialog(row)"
                        >
                          {{ i18ns.t('nav.more') }}
                          {{ getRemainingRelayTokenQuotaWindowCount(row) }}
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
                >{{ i18ns.t('relay.enabled') }}</el-tag
              >
              <el-tag v-else size="small" type="info" effect="dark">{{
                i18ns.t('relay.disabled')
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="340" fixed="right" align="center">
            <template #default="{ row }">
              <div class="action-buttons">
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                  <el-button size="small" type="primary" plain @click="openEditDialog(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                  <el-button
                    size="small"
                    :type="row.status === MANAGED_STATUS.ENABLED ? 'warning' : 'success'"
                    plain
                    @click="handleToggleStatus(row)"
                  >
                    {{
                      row.status === MANAGED_STATUS.ENABLED
                        ? i18ns.t('relay.disable')
                        : i18ns.t('relay.enable')
                    }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_DELETE]">
                  <el-button size="small" type="danger" plain @click="handleDelete(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </PermissionWrapper>
                <el-dropdown
                  trigger="click"
                  @command="
                    (command: string | number | object) => handleMoreCommand(String(command), row)
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
                        v-for="format in getTokenSupportedFormats(row)"
                        :key="`desktop-ccswitch-${row.id}-${format}`"
                        :command="`launch-ccswitch-${format}`"
                        divided
                      >
                        {{ getCcswitchLaunchLabel(format) }}
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
            @current-change="handleCurrentPageChange"
            @size-change="handlePageSizeChange"
          />
        </div>

        <el-drawer
          v-model="showEditDialog"
          :title="editMode === 'create' ? i18ns.t('relay.createToken') : i18ns.t('relay.editToken')"
          direction="rtl"
          size="min(1120px, calc(100vw - 64px))"
          class="relay-token-dialog relay-token-edit-dialog relay-token-edit-dialog--desktop"
        >
          <el-form :model="editForm" label-width="124px" class="relay-token-edit-form">
            <el-collapse v-model="editDialogSectionNames" class="relay-token-edit-sections">
              <el-collapse-item name="basic">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.basicSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-grid">
                  <el-form-item :label="i18ns.t('relay.tokenName')">
                    <el-input
                      v-model="editForm.name"
                      :placeholder="i18ns.t('relay.tokenNamePlaceholder')"
                    />
                  </el-form-item>
                  <PermissionWrapper
                    :any-require="[
                      Permission.RELAY_TOKEN_CUSTOM_KEY,
                      Permission.RELAY_TOKEN_CUSTOM_KEY_FREE,
                    ]"
                  >
                    <el-form-item>
                      <template #label>
                        <span class="form-label-with-help">
                          <span>{{ i18ns.t('relay.customKey') }}</span>
                          <el-tooltip placement="top">
                            <template #content>
                              <div class="help-tooltip-content">
                                {{ i18ns.t('relay.customKeyHint') }}
                              </div>
                            </template>
                            <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                          </el-tooltip>
                        </span>
                      </template>
                      <el-input
                        v-model="editForm.token"
                        :placeholder="i18ns.t('relay.customKeyPlaceholder')"
                      />
                    </el-form-item>
                  </PermissionWrapper>
                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.expiresAt') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.expiresAtHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-date-picker
                      v-model="editForm.expiresAt"
                      type="datetime"
                      :placeholder="i18ns.t('accesskey.neverExpires')"
                      style="width: 100%"
                    />
                  </el-form-item>
                </div>
              </el-collapse-item>

              <el-collapse-item name="channelFailover">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.channelFailoverSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-grid">
                  <el-form-item required class="form-item-span-2">
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.orderedChannels') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.channelOrderHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <div ref="desktopChannelListRef" class="channel-config-editor">
                      <div class="channel-config-toolbar">
                        <div class="channel-config-toolbar__actions">
                          <el-button plain @click="handleCopyTokenChannelConfigs">
                            {{ i18ns.t('copy') }}
                          </el-button>
                          <el-button plain @click="handleExportTokenChannelConfigs">
                            {{ i18ns.t('relay.exportChannels') }}
                          </el-button>
                          <el-button plain @click="openTokenChannelImportDialog">
                            {{ i18ns.t('relay.importChannels') }}
                          </el-button>
                          <el-button
                            plain
                            type="danger"
                            :disabled="!hasSelectedChannelConfigs"
                            @click="handleBatchRemoveTokenChannelConfigs"
                          >
                            {{ i18ns.t('relay.tokenChannelBatchRemove') }}
                          </el-button>
                        </div>
                      </div>
                      <div
                        v-for="(config, index) in editForm.channelConfigs"
                        :key="config.tempKey"
                        class="channel-config-row"
                        :data-index="index"
                      >
                        <div class="channel-config-drag-handle">
                          <el-icon><Rank /></el-icon>
                        </div>
                        <div class="channel-config-checkbox">
                          <el-checkbox
                            v-model="selectedChannelConfigKeys"
                            :value="config.tempKey"
                          />
                        </div>
                        <div class="channel-config-order">
                          {{ index === 0 ? i18ns.t('relay.primaryChannel') : `#${index + 1}` }}
                        </div>
                        <el-select
                          v-model="config.channelId"
                          :placeholder="i18ns.t('relay.channel')"
                          class="channel-config-select"
                          filterable
                        >
                          <el-option
                            v-for="ch in getAvailableChannelOptions(config.channelId)"
                            :key="ch.id"
                            :label="getChannelOptionLabel(ch)"
                            :value="ch.id"
                          />
                        </el-select>
                        <div class="channel-config-actions">
                          <el-tooltip :content="i18ns.t('delete')" placement="top">
                            <el-button
                              plain
                              circle
                              size="small"
                              type="danger"
                              :icon="Delete"
                              :disabled="editForm.channelConfigs.length === 1"
                              @click="removeChannelConfig(index)"
                            />
                          </el-tooltip>
                        </div>
                      </div>
                      <el-button
                        plain
                        type="primary"
                        :disabled="channels.length === editForm.channelConfigs.length"
                        @click="addChannelConfig"
                      >
                        {{ i18ns.t('relay.addChannel') }}
                      </el-button>
                    </div>
                    <el-alert
                      v-if="showUnavailableChannelWarning"
                      class="channel-warning-alert"
                      type="warning"
                      :closable="false"
                      :title="i18ns.t('relay.unavailableChannelsWarningTitle')"
                      :description="unavailableChannelWarningText"
                    />
                  </el-form-item>

                  <el-form-item class="form-item-span-2">
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.failoverSettings') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.failoverOverviewHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <div
                      class="failover-config-editor"
                      :class="{ 'is-disabled': !editForm.failoverConfig.enabled }"
                    >
                      <div class="failover-overview">
                        <div class="failover-overview__content">
                          <div class="failover-overview__headline">
                            <span class="failover-overview__status">{{
                              editForm.failoverConfig.enabled
                                ? i18ns.t('relay.failoverEnabled')
                                : i18ns.t('relay.failoverDisabled')
                            }}</span>
                            <el-tooltip placement="top">
                              <template #content>
                                <div class="help-tooltip-content">
                                  {{ i18ns.t('relay.failoverOverviewHelp') }}
                                </div>
                              </template>
                              <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                            </el-tooltip>
                          </div>
                        </div>
                        <el-switch v-model="editForm.failoverConfig.enabled" />
                      </div>

                      <div class="failover-metric-grid">
                        <div class="failover-metric-card">
                          <div class="failover-metric-card__header">
                            <span class="failover-metric-card__title form-label-with-help">
                              <span>{{ i18ns.t('relay.failoverThreshold') }}</span>
                              <el-tooltip placement="top">
                                <template #content>
                                  <div class="help-tooltip-content">
                                    {{ i18ns.t('relay.failoverThresholdHelp') }}
                                  </div>
                                </template>
                                <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                              </el-tooltip>
                            </span>
                          </div>
                          <el-input-number
                            v-model="editForm.failoverConfig.failoverThreshold"
                            :min="0"
                            :max="32"
                            class="failover-input"
                          />
                        </div>

                        <div class="failover-metric-card">
                          <div class="failover-metric-card__header">
                            <span class="failover-metric-card__title form-label-with-help">
                              <span>{{ i18ns.t('relay.maxRetries') }}</span>
                              <el-tooltip placement="top">
                                <template #content>
                                  <div class="help-tooltip-content">
                                    {{ i18ns.t('relay.maxRetriesHelp') }}
                                  </div>
                                </template>
                                <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                              </el-tooltip>
                            </span>
                          </div>
                          <el-input-number
                            v-model="editForm.failoverConfig.maxRetries"
                            :min="0"
                            :max="10"
                            class="failover-input"
                          />
                        </div>

                        <div class="failover-metric-card">
                          <div class="failover-metric-card__header">
                            <span class="failover-metric-card__title form-label-with-help">
                              <span>{{ i18ns.t('relay.failbackCooldownMinutes') }}</span>
                              <el-tooltip placement="top">
                                <template #content>
                                  <div class="help-tooltip-content">
                                    {{ i18ns.t('relay.failbackCooldownMinutesHelp') }}
                                  </div>
                                </template>
                                <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                              </el-tooltip>
                            </span>
                          </div>
                          <el-input-number
                            v-model="editForm.failoverConfig.failbackCooldownMinutes"
                            :min="0"
                            :max="10080"
                            class="failover-input"
                          />
                        </div>
                      </div>

                      <div class="failover-rule-block">
                        <div class="failover-rule-block__header">
                          <span class="failover-rule-block__title form-label-with-help">
                            <span>{{ i18ns.t('relay.retryStatusCodes') }}</span>
                            <el-tooltip placement="top">
                              <template #content>
                                <div class="help-tooltip-content">
                                  <div>{{ i18ns.t('relay.retryStatusCodesHelpIntro') }}</div>
                                  <div>{{ i18ns.t('relay.retryStatusCodesHelpExamples') }}</div>
                                </div>
                              </template>
                              <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                            </el-tooltip>
                          </span>
                        </div>
                        <el-select
                          v-model="editForm.failoverConfig.retryStatusCodes"
                          multiple
                          allow-create
                          filterable
                          default-first-option
                          class="failover-status-select"
                          :label="i18ns.t('relay.retryStatusCodes')"
                          :placeholder="i18ns.t('relay.retryStatusCodesPlaceholder')"
                        >
                          <el-option
                            v-for="code in retryStatusCodeOptions"
                            :key="code"
                            :label="formatRetryStatusCodeOptionLabel(code)"
                            :value="code"
                          />
                        </el-select>
                      </div>
                    </div>
                    <el-alert
                      v-if="showMaxRetriesRiskWarning"
                      class="failover-risk-alert"
                      type="warning"
                      :closable="false"
                      :title="i18ns.t('warning')"
                      :description="maxRetriesRiskWarningText"
                    />
                  </el-form-item>
                </div>
              </el-collapse-item>

              <el-collapse-item name="quota">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.quotaSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-grid">
                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.quotaLimit') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.quotaLimitHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-input-number
                      v-model="editForm.quotaLimit"
                      :min="undefined"
                      :max="99999999.99"
                      :precision="2"
                      :placeholder="i18ns.t('relay.unlimited')"
                      style="width: 100%"
                      @blur="editForm.quotaLimit = normalizeQuotaLimitInput(editForm.quotaLimit)"
                    />
                  </el-form-item>

                  <el-form-item class="form-item-span-2">
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.quotaWindows') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.quotaWindowsHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <div class="quota-window-editor">
                      <div class="quota-window-editor__header">
                        <div class="quota-window-editor__header-content">
                          <div class="quota-window-editor__title">
                            {{ i18ns.t('relay.quotaWindows') }}
                          </div>
                          <div class="quota-window-editor__summary">
                            {{
                              !editForm.quotaWindowsEnabled
                                ? i18ns.t('relay.quotaWindowsDisabled')
                                : editForm.quotaWindows.length
                                  ? `${editForm.quotaWindows.length} / ${MAX_QUOTA_WINDOWS}`
                                  : i18ns.t('relay.quotaWindowsEmpty')
                            }}
                          </div>
                        </div>
                        <div class="quota-window-editor__header-actions">
                          <div class="quota-window-editor__toggle">
                            <span class="quota-window-editor__toggle-label">
                              {{ i18ns.t('relay.quotaWindowsToggle') }}
                            </span>
                            <el-switch
                              :model-value="editForm.quotaWindowsEnabled"
                              :disabled="saving"
                              @change="handleQuotaWindowsToggleChange"
                            />
                          </div>
                          <el-button
                            plain
                            type="primary"
                            :disabled="
                              !editForm.quotaWindowsEnabled ||
                              editForm.quotaWindows.length >= MAX_QUOTA_WINDOWS
                            "
                            @click="addQuotaWindow"
                          >
                            {{ i18ns.t('relay.addQuotaWindow') }}
                          </el-button>
                        </div>
                      </div>

                      <div
                        v-if="editForm.quotaWindowsEnabled && editForm.quotaWindows.length"
                        class="quota-window-editor__list"
                      >
                        <div
                          v-for="(quotaWindow, index) in editForm.quotaWindows"
                          :key="`desktop-quota-window-${index}`"
                          class="quota-window-editor__item"
                        >
                          <div class="quota-window-editor__item-head">
                            <div class="quota-window-editor__item-heading">
                              <span class="quota-window-editor__item-title">
                                {{ i18ns.t('relay.quotaWindowRuleTitle', { index: index + 1 }) }}
                              </span>
                            </div>
                            <el-button
                              link
                              type="danger"
                              :disabled="saving"
                              @click="removeQuotaWindow(index)"
                            >
                              {{ i18ns.t('relay.removeQuotaWindow') }}
                            </el-button>
                          </div>
                          <div class="quota-window-editor__fields">
                            <div class="quota-window-editor__field">
                              <label class="quota-window-editor__field-label">{{
                                i18ns.t('relay.quotaWindowUnit')
                              }}</label>
                              <el-select
                                v-model="quotaWindow.quotaUnit"
                                @change="handleQuotaWindowUnitChange(quotaWindow)"
                              >
                                <el-option
                                  :label="i18ns.t('relay.quotaWindowUnitAmount')"
                                  value="amount"
                                />
                                <el-option
                                  :label="i18ns.t('relay.quotaWindowUnitRequest')"
                                  value="request"
                                />
                                <el-option
                                  :label="i18ns.t('relay.quotaWindowUnitToken')"
                                  value="token"
                                />
                              </el-select>
                            </div>
                            <div class="quota-window-editor__field">
                              <label class="quota-window-editor__field-label">{{
                                i18ns.t('relay.quotaWindowLimit')
                              }}</label>
                              <el-input-number
                                :key="`desktop-quota-limit-${index}-${quotaWindow.quotaUnit}`"
                                v-model="quotaWindow.quotaLimit"
                                :min="getQuotaMin(quotaWindow.quotaUnit)"
                                :max="getQuotaMax(quotaWindow.quotaUnit)"
                                :precision="getQuotaPrecision(quotaWindow.quotaUnit)"
                                :step="getQuotaStep(quotaWindow.quotaUnit)"
                              />
                            </div>
                            <div
                              class="quota-window-editor__field quota-window-editor__field--span-2"
                            >
                              <label class="quota-window-editor__field-label">{{
                                i18ns.t('monthlyPass.quotaWindowHours')
                              }}</label>
                              <div class="quota-window-duration-card">
                                <div class="quota-window-picker-row">
                                  <div class="quota-window-picker quota-window-picker--desktop">
                                    <div class="quota-window-picker__segment">
                                      <el-input-number
                                        v-model="quotaWindow.months"
                                        :min="0"
                                        :max="MAX_QUOTA_WINDOW_MONTHS"
                                        :step="1"
                                        :precision="0"
                                        class="quota-window-input"
                                        @change="applyQuotaWindowParts(quotaWindow)"
                                      />
                                      <span class="quota-window-unit">{{
                                        i18ns.t('monthlyPass.monthsUnit')
                                      }}</span>
                                    </div>
                                    <div class="quota-window-picker__segment">
                                      <el-input-number
                                        v-model="quotaWindow.days"
                                        :min="0"
                                        :max="MAX_QUOTA_WINDOW_DAYS"
                                        :step="1"
                                        :precision="0"
                                        class="quota-window-input"
                                        @change="applyQuotaWindowParts(quotaWindow)"
                                      />
                                      <span class="quota-window-unit">{{
                                        i18ns.t('monthlyPass.daysUnit')
                                      }}</span>
                                    </div>
                                    <div class="quota-window-picker__segment">
                                      <el-input-number
                                        v-model="quotaWindow.hours"
                                        :min="0"
                                        :max="MAX_QUOTA_WINDOW_HOUR_PART"
                                        :step="1"
                                        :precision="0"
                                        class="quota-window-input"
                                        @change="applyQuotaWindowParts(quotaWindow)"
                                      />
                                      <span class="quota-window-unit">{{
                                        i18ns.t('monthlyPass.hoursUnit')
                                      }}</span>
                                    </div>
                                    <div class="quota-window-picker__segment">
                                      <el-input-number
                                        v-model="quotaWindow.minutes"
                                        :min="0"
                                        :max="MAX_QUOTA_WINDOW_MINUTE_PART"
                                        :step="1"
                                        :precision="0"
                                        class="quota-window-input"
                                        @change="applyQuotaWindowParts(quotaWindow)"
                                      />
                                      <span class="quota-window-unit">{{
                                        i18ns.t('monthlyPass.minutesUnit')
                                      }}</span>
                                    </div>
                                  </div>
                                  <div
                                    class="quota-window-value quota-window-value--desktop"
                                    role="button"
                                    tabindex="0"
                                    @click="toggleQuotaWindowPreviewMode(quotaWindow, index)"
                                    @keydown.enter="
                                      toggleQuotaWindowPreviewMode(quotaWindow, index)
                                    "
                                    @keydown.space.prevent="
                                      toggleQuotaWindowPreviewMode(quotaWindow, index)
                                    "
                                  >
                                    {{ formatQuotaWindowPreview(quotaWindow, index) }}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <el-alert
                        v-else-if="!editForm.quotaWindowsEnabled"
                        type="info"
                        :closable="false"
                        :title="i18ns.t('relay.quotaWindowsDisabled')"
                        :description="i18ns.t('relay.quotaWindowsToggleHelp')"
                      />
                      <el-empty
                        v-else
                        :description="i18ns.t('relay.quotaWindowsEmpty')"
                        :image-size="92"
                      />
                    </div>
                  </el-form-item>
                </div>
              </el-collapse-item>

              <el-collapse-item name="advanced">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.advancedSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-grid">
                  <el-form-item class="form-item-span-2">
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.ipWhitelist') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.ipWhitelistHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-input-tag
                      v-model="editForm.ipWhitelist"
                      class="ip-whitelist-tag-input"
                      :placeholder="i18ns.t('relay.ipWhitelistPlaceholder')"
                      :aria-label="i18ns.t('relay.ipWhitelist')"
                    />
                  </el-form-item>
                  <el-form-item class="form-item-span-2">
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.allowedModels') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.allowedModelsHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-select
                      v-model="editForm.allowedModelIdsList"
                      multiple
                      filterable
                      :placeholder="i18ns.t('relay.selectModels')"
                      style="width: 100%"
                      :loading="loadingModels"
                    >
                      <el-option
                        v-for="modelId in filteredModelIds"
                        :key="modelId"
                        :label="getModelIdDisplayLabel(modelId)"
                        :value="modelId"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item class="form-item-span-2" :label="i18ns.t('relay.modelMapping')">
                    <div class="flex flex-col gap-1 w-full">
                      <ModelMappingEditor
                        v-model="editForm.modelMapping"
                        :available-models="channelFilteredModelNames"
                      />
                      <span class="text-[#909399] text-xs">{{
                        i18ns.t('relay.tokenModelMappingHelp')
                      }}</span>
                    </div>
                  </el-form-item>
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-form>
          <template #footer>
            <el-button @click="showEditDialog = false">{{ i18ns.t('cancel') }}</el-button>
            <el-button type="primary" :loading="saving" @click="handleSave">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-drawer>
      </el-card>
    </div>
    <div v-else class="mobile-page">
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
                  <el-button plain @click="openTokenImportDialog">
                    {{ i18ns.t('relay.importTokens') }}
                  </el-button>
                </PermissionWrapper>
                <el-button plain :disabled="!tokens.length" @click="handleSelectAllVisibleTokens">
                  {{ i18ns.t('relay.selectAllTokens') }}
                </el-button>
                <el-button plain :disabled="!selectedTokenIds.length" @click="clearTokenSelection">
                  {{ i18ns.t('relay.clearTokenSelection') }}
                </el-button>
                <el-button :icon="Refresh" :loading="loadingTokens" @click="refreshTokens">
                  {{ i18ns.t('refresh') }}
                </el-button>
                <PermissionWrapper :require="[Permission.RELAY_TOKEN_CREATE]">
                  <el-button type="primary" @click="openCreateDialog">{{
                    i18ns.t('relay.createToken')
                  }}</el-button>
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
              :remote-method="handleTargetUserSearch"
              @change="handleTargetUserChange"
              @clear="handleTargetUserChange"
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
              @clear="handleSearch"
              @keyup.enter="handleSearch"
            />
            <el-input
              v-model="searchTokenKeyword"
              clearable
              class="token-filter-input"
              :placeholder="i18ns.t('relay.searchTokenPlaceholder')"
              @clear="handleSearch"
              @keyup.enter="handleSearch"
            />
            <div class="token-filter-actions token-filter-actions--mobile">
              <el-button type="primary" :loading="loadingTokens" @click="handleSearch">
                {{ i18ns.t('relay.searchAction') }}
              </el-button>
              <el-button :loading="loadingTokens" @click="toggleShowAll">
                {{ i18ns.t(showAllMode ? 'relay.pagedDisplay' : 'relay.showAll') }}
              </el-button>
            </div>
          </div>

          <div v-if="selectedTokenIds.length" class="token-mobile-batch-actions">
            <el-dropdown
              trigger="click"
              @command="
                (command: string | number | object) => handleBatchTokenCommand(String(command))
              "
            >
              <el-button size="small" plain>
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
                      handleMobileTokenSelectionChange(row.id, Boolean(value))
                  "
                />
              </div>
              <div class="token-mobile-card__header">
                <div class="token-mobile-title">
                  {{ row.name || i18ns.t('relay.unnamedToken') }}
                </div>
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
                      @click="copyToken(row.token)"
                    >
                      {{ maskToken(row.token, 10, 8) }}
                    </el-link>
                  </div>
                </div>
                <div class="token-mobile-field">
                  <span class="label">{{ i18ns.t('relay.orderedChannels') }}</span>
                  <span class="value">{{ formatChannelSummary(row) }}</span>
                  <span class="hint">{{ formatMobileChannelMeta(row) }}</span>
                </div>
                <div class="token-mobile-field">
                  <span class="label"
                    >{{ i18ns.t('relay.requestCount') }} / {{ i18ns.t('relay.totalTokens') }}</span
                  >
                  <span class="value">{{ formatTokenStatsSummary(row) }}</span>
                </div>
                <div class="token-mobile-field">
                  <span class="label">{{ i18ns.t('relay.expiresAt') }}</span>
                  <span class="value">{{
                    row.expiresAt ? formatDateTime(row.expiresAt) : i18ns.t('relay.neverExpire')
                  }}</span>
                </div>
                <div class="token-mobile-field full token-mobile-field--quota">
                  <span class="label">{{ i18ns.t('relay.quotaUsage') }}</span>
                  <template
                    v-for="(quota, quotaIndex) in [getTokenQuotaSnapshot(row)]"
                    :key="quotaIndex"
                  >
                    <div class="token-mobile-quota">
                      <div class="token-mobile-quota__primary">
                        <span
                          class="quota-text"
                          :class="{
                            'quota-text--danger': quota.isQuotaExceeded,
                          }"
                        >
                          {{ i18ns.t('relay.usedQuota') }}:
                          {{ formatQuotaAmount(quota.usedQuota) }}
                        </span>
                        <span class="quota-limit-text">
                          /
                          {{
                            row.quotaLimit != null
                              ? formatQuotaAmount(row.quotaLimit)
                              : i18ns.t('relay.unlimited')
                          }}
                        </span>
                      </div>
                      <div class="token-mobile-quota__secondary">
                        <span>
                          {{ i18ns.t('relay.remainingQuota') }}:
                          {{ formatRemainingQuota(quota) }}
                        </span>
                        <span v-if="quota.quotaUsagePercent != null">
                          {{ formatQuotaPercent(quota.quotaUsagePercent) }}
                        </span>
                      </div>
                      <el-progress
                        v-if="quota.quotaUsagePercent != null"
                        :percentage="getQuotaProgressPercentage(quota.quotaUsagePercent)"
                        :status="getQuotaProgressStatus(quota.quotaUsagePercent)"
                        :stroke-width="8"
                        :show-text="false"
                        class="quota-progress"
                      />
                      <div
                        v-if="getRelayTokenQuotaWindows(row).length"
                        class="quota-window-list quota-window-list--mobile"
                      >
                        <span class="quota-window-list__label">
                          {{ i18ns.t('relay.quotaWindows') }}:
                        </span>
                        <template
                          v-for="(
                            quotaWindow, quotaWindowIndex
                          ) in getPrimaryRelayTokenQuotaWindows(row)"
                          :key="`${row.id}-mobile-quota-window-${quotaWindowIndex}`"
                        >
                          <div
                            class="quota-window-inline quota-window-inline--mobile"
                            :class="{
                              'quota-window-inline--danger': quotaWindow.isQuotaExceeded,
                            }"
                          >
                            <el-progress
                              v-if="quotaWindow.quotaUsagePercent != null"
                              :percentage="
                                getQuotaProgressPercentage(quotaWindow.quotaUsagePercent)
                              "
                              :status="getQuotaProgressStatus(quotaWindow.quotaUsagePercent)"
                              :stroke-width="6"
                              :show-text="false"
                              class="quota-window-inline__progress"
                            />
                            <span class="quota-window-inline__summary">
                              {{ formatQuotaWindowCompactSummary(quotaWindow) }}
                            </span>
                            <el-button
                              v-if="getRemainingRelayTokenQuotaWindowCount(row) > 0"
                              text
                              class="quota-window-inline__more"
                              @click="openQuotaWindowDetailDialog(row)"
                            >
                              {{ i18ns.t('nav.more') }}
                              {{ getRemainingRelayTokenQuotaWindowCount(row) }}
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
                    <el-button size="small" type="primary" plain @click="openEditDialog(row)">{{
                      i18ns.t('edit')
                    }}</el-button>
                  </PermissionWrapper>
                </div>
                <div class="token-mobile-action-item">
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                    <el-button size="small" plain @click="openSwitchLogsDialog(row)">{{
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
                      @click="handleToggleStatus(row)"
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
                    <el-button size="small" type="danger" plain @click="handleDelete(row)">{{
                      i18ns.t('delete')
                    }}</el-button>
                  </PermissionWrapper>
                </div>
                <div class="token-mobile-action-item">
                  <el-dropdown
                    trigger="click"
                    @command="
                      (command: string | number | object) => handleMoreCommand(String(command), row)
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
                          v-for="format in getTokenSupportedFormats(row)"
                          :key="`mobile-ccswitch-${row.id}-${format}`"
                          :command="`launch-ccswitch-${format}`"
                          divided
                        >
                          {{ getCcswitchLaunchLabel(format) }}
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
              @current-change="handleCurrentPageChange"
              @size-change="handlePageSizeChange"
            />
          </div>
        </el-card>

        <el-drawer
          v-model="showEditDialog"
          :title="editMode === 'create' ? i18ns.t('relay.createToken') : i18ns.t('relay.editToken')"
          direction="btt"
          size="100%"
          class="relay-token-dialog relay-token-edit-dialog relay-token-edit-dialog--mobile"
        >
          <el-form :model="editForm" label-position="top">
            <el-collapse v-model="editDialogSectionNames" class="relay-token-edit-sections">
              <el-collapse-item name="basic">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.basicSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-stack relay-token-edit-section-stack--mobile">
                  <el-form-item :label="i18ns.t('relay.tokenName')">
                    <el-input
                      v-model="editForm.name"
                      :placeholder="i18ns.t('relay.tokenNamePlaceholder')"
                    />
                  </el-form-item>
                  <PermissionWrapper
                    :any-require="[
                      Permission.RELAY_TOKEN_CUSTOM_KEY,
                      Permission.RELAY_TOKEN_CUSTOM_KEY_FREE,
                    ]"
                  >
                    <el-form-item>
                      <template #label>
                        <span class="form-label-with-help">
                          <span>{{ i18ns.t('relay.customKey') }}</span>
                          <el-tooltip placement="top">
                            <template #content>
                              <div class="help-tooltip-content">
                                {{ i18ns.t('relay.customKeyHint') }}
                              </div>
                            </template>
                            <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                          </el-tooltip>
                        </span>
                      </template>
                      <el-input
                        v-model="editForm.token"
                        :placeholder="i18ns.t('relay.customKeyPlaceholder')"
                      />
                    </el-form-item>
                  </PermissionWrapper>
                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.expiresAt') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.expiresAtHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-date-picker
                      v-model="editForm.expiresAt"
                      type="datetime"
                      :placeholder="i18ns.t('accesskey.neverExpires')"
                      style="width: 100%"
                    />
                  </el-form-item>
                </div>
              </el-collapse-item>

              <el-collapse-item name="channelFailover">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.channelFailoverSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-stack relay-token-edit-section-stack--mobile">
                  <el-form-item required>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.orderedChannels') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.channelOrderHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <div
                      ref="mobileChannelListRef"
                      class="channel-config-editor mobile-channel-config-editor"
                    >
                      <div class="channel-config-toolbar channel-config-toolbar--mobile">
                        <div class="channel-config-toolbar__summary">
                          {{
                            i18ns.t('relay.tokenChannelSelectedConfigs', {
                              count: selectedChannelConfigs.length,
                            })
                          }}
                        </div>
                        <div
                          class="channel-config-toolbar__actions channel-config-toolbar__actions--mobile"
                        >
                          <el-button link type="primary" @click="toggleAllChannelConfigSelections">
                            {{
                              isAllChannelConfigsSelected
                                ? i18ns.t('relay.clearChannelSelection')
                                : i18ns.t('relay.selectAllChannels')
                            }}
                          </el-button>
                          <el-select
                            v-model="tokenChannelBatchAddIds"
                            multiple
                            collapse-tags
                            collapse-tags-tooltip
                            filterable
                            class="channel-config-toolbar__batch-select"
                            :placeholder="i18ns.t('relay.tokenChannelSelectChannelsPlaceholder')"
                          >
                            <el-option
                              v-for="channel in tokenChannelBatchAddOptions"
                              :key="channel.id"
                              :label="
                                getChannelOptionLabel({
                                  id: channel.id,
                                  name: channel.name,
                                  multiplier: channel.multiplier,
                                })
                              "
                              :value="channel.id"
                            />
                          </el-select>
                          <el-button plain type="primary" @click="handleBatchAddTokenChannels">
                            {{ i18ns.t('relay.tokenChannelBatchAdd') }}
                          </el-button>
                          <el-button plain @click="handleCopyTokenChannelConfigs">
                            {{ i18ns.t('copy') }}
                          </el-button>
                          <el-button plain @click="handleExportTokenChannelConfigs">
                            {{ i18ns.t('relay.exportChannels') }}
                          </el-button>
                          <el-button plain @click="openTokenChannelImportDialog">
                            {{ i18ns.t('relay.importChannels') }}
                          </el-button>
                          <el-button
                            plain
                            type="danger"
                            :disabled="!hasSelectedChannelConfigs"
                            @click="handleBatchRemoveTokenChannelConfigs"
                          >
                            {{ i18ns.t('relay.tokenChannelBatchRemove') }}
                          </el-button>
                        </div>
                      </div>
                      <div
                        v-for="(config, index) in editForm.channelConfigs"
                        :key="config.tempKey"
                        class="channel-config-row mobile-channel-config-row"
                        :data-index="index"
                      >
                        <div class="channel-config-drag-handle">
                          <el-icon><Rank /></el-icon>
                        </div>
                        <div class="channel-config-checkbox">
                          <el-checkbox
                            v-model="selectedChannelConfigKeys"
                            :value="config.tempKey"
                          />
                        </div>
                        <div class="channel-config-order">
                          {{ index === 0 ? i18ns.t('relay.primaryChannel') : `#${index + 1}` }}
                        </div>
                        <el-select
                          v-model="config.channelId"
                          :placeholder="i18ns.t('relay.channel')"
                          class="channel-config-select"
                          filterable
                        >
                          <el-option
                            v-for="ch in getAvailableChannelOptions(config.channelId)"
                            :key="ch.id"
                            :label="getChannelOptionLabel(ch)"
                            :value="ch.id"
                          />
                        </el-select>
                        <div class="channel-config-actions mobile-channel-config-actions">
                          <el-tooltip :content="i18ns.t('delete')" placement="top">
                            <el-button
                              plain
                              circle
                              size="small"
                              type="danger"
                              :icon="Delete"
                              :disabled="editForm.channelConfigs.length === 1"
                              @click="removeChannelConfig(index)"
                            />
                          </el-tooltip>
                        </div>
                      </div>
                      <el-button
                        plain
                        type="primary"
                        :disabled="channels.length === editForm.channelConfigs.length"
                        @click="addChannelConfig"
                      >
                        {{ i18ns.t('relay.addChannel') }}
                      </el-button>
                    </div>
                    <el-alert
                      v-if="showUnavailableChannelWarning"
                      class="channel-warning-alert"
                      type="warning"
                      :closable="false"
                      :title="i18ns.t('relay.unavailableChannelsWarningTitle')"
                      :description="unavailableChannelWarningText"
                    />
                  </el-form-item>

                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.failoverSettings') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.failoverOverviewHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <div
                      class="failover-config-editor mobile-failover-config-editor"
                      :class="{ 'is-disabled': !editForm.failoverConfig.enabled }"
                    >
                      <div class="failover-overview">
                        <div class="failover-overview__content">
                          <div class="failover-overview__headline">
                            <span class="failover-overview__status">{{
                              editForm.failoverConfig.enabled
                                ? i18ns.t('relay.failoverEnabled')
                                : i18ns.t('relay.failoverDisabled')
                            }}</span>
                            <el-tooltip placement="top">
                              <template #content>
                                <div class="help-tooltip-content">
                                  {{ i18ns.t('relay.failoverOverviewHelp') }}
                                </div>
                              </template>
                              <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                            </el-tooltip>
                          </div>
                        </div>
                        <el-switch v-model="editForm.failoverConfig.enabled" />
                      </div>

                      <div class="failover-metric-grid">
                        <div class="failover-metric-card">
                          <div class="failover-metric-card__header">
                            <span class="failover-metric-card__title form-label-with-help">
                              <span>{{ i18ns.t('relay.failoverThreshold') }}</span>
                              <el-tooltip placement="top">
                                <template #content>
                                  <div class="help-tooltip-content">
                                    {{ i18ns.t('relay.failoverThresholdHelp') }}
                                  </div>
                                </template>
                                <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                              </el-tooltip>
                            </span>
                          </div>
                          <el-input-number
                            v-model="editForm.failoverConfig.failoverThreshold"
                            :min="0"
                            :max="32"
                            class="failover-input"
                          />
                        </div>

                        <div class="failover-metric-card">
                          <div class="failover-metric-card__header">
                            <span class="failover-metric-card__title form-label-with-help">
                              <span>{{ i18ns.t('relay.maxRetries') }}</span>
                              <el-tooltip placement="top">
                                <template #content>
                                  <div class="help-tooltip-content">
                                    {{ i18ns.t('relay.maxRetriesHelp') }}
                                  </div>
                                </template>
                                <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                              </el-tooltip>
                            </span>
                          </div>
                          <el-input-number
                            v-model="editForm.failoverConfig.maxRetries"
                            :min="0"
                            :max="10"
                            class="failover-input"
                          />
                        </div>

                        <div class="failover-metric-card">
                          <div class="failover-metric-card__header">
                            <span class="failover-metric-card__title form-label-with-help">
                              <span>{{ i18ns.t('relay.failbackCooldownMinutes') }}</span>
                              <el-tooltip placement="top">
                                <template #content>
                                  <div class="help-tooltip-content">
                                    {{ i18ns.t('relay.failbackCooldownMinutesHelp') }}
                                  </div>
                                </template>
                                <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                              </el-tooltip>
                            </span>
                          </div>
                          <el-input-number
                            v-model="editForm.failoverConfig.failbackCooldownMinutes"
                            :min="0"
                            :max="10080"
                            class="failover-input"
                          />
                        </div>
                      </div>

                      <div class="failover-rule-block">
                        <div class="failover-rule-block__header">
                          <span class="failover-rule-block__title form-label-with-help">
                            <span>{{ i18ns.t('relay.retryStatusCodes') }}</span>
                            <el-tooltip placement="top">
                              <template #content>
                                <div class="help-tooltip-content">
                                  <div>{{ i18ns.t('relay.retryStatusCodesHelpMobile') }}</div>
                                  <div>{{ i18ns.t('relay.retryStatusCodesHelpExamples') }}</div>
                                </div>
                              </template>
                              <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                            </el-tooltip>
                          </span>
                        </div>
                        <el-select
                          v-model="editForm.failoverConfig.retryStatusCodes"
                          multiple
                          allow-create
                          filterable
                          default-first-option
                          class="failover-status-select"
                          :placeholder="i18ns.t('relay.retryStatusCodesPlaceholder')"
                        >
                          <el-option
                            v-for="code in retryStatusCodeOptions"
                            :key="code"
                            :label="formatRetryStatusCodeOptionLabel(code)"
                            :value="code"
                          />
                        </el-select>
                      </div>
                    </div>
                    <el-alert
                      v-if="showMaxRetriesRiskWarning"
                      class="failover-risk-alert"
                      type="warning"
                      :closable="false"
                      :title="i18ns.t('warning')"
                      :description="maxRetriesRiskWarningText"
                    />
                  </el-form-item>
                </div>
              </el-collapse-item>

              <el-collapse-item name="quota">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.quotaSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-stack relay-token-edit-section-stack--mobile">
                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.quotaLimit') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.quotaLimitHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-input-number
                      v-model="editForm.quotaLimit"
                      :min="undefined"
                      :max="99999999.99"
                      :precision="2"
                      :placeholder="i18ns.t('relay.unlimited')"
                      style="width: 100%"
                      @blur="editForm.quotaLimit = normalizeQuotaLimitInput(editForm.quotaLimit)"
                    />
                  </el-form-item>

                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.quotaWindows') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.quotaWindowsHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <div class="quota-window-editor quota-window-editor--mobile">
                      <div class="quota-window-editor__header quota-window-editor__header--mobile">
                        <div class="quota-window-editor__header-content">
                          <div class="quota-window-editor__title">
                            {{ i18ns.t('relay.quotaWindows') }}
                          </div>
                          <div class="quota-window-editor__summary">
                            {{
                              !editForm.quotaWindowsEnabled
                                ? i18ns.t('relay.quotaWindowsDisabled')
                                : editForm.quotaWindows.length
                                  ? `${editForm.quotaWindows.length} / ${MAX_QUOTA_WINDOWS}`
                                  : i18ns.t('relay.quotaWindowsEmpty')
                            }}
                          </div>
                        </div>
                        <div class="quota-window-editor__header-actions">
                          <div class="quota-window-editor__toggle">
                            <span class="quota-window-editor__toggle-label">
                              {{ i18ns.t('relay.quotaWindowsToggle') }}
                            </span>
                            <el-switch
                              :model-value="editForm.quotaWindowsEnabled"
                              :disabled="saving"
                              @change="handleQuotaWindowsToggleChange"
                            />
                          </div>
                          <el-button
                            plain
                            type="primary"
                            size="small"
                            :disabled="
                              !editForm.quotaWindowsEnabled ||
                              editForm.quotaWindows.length >= MAX_QUOTA_WINDOWS
                            "
                            @click="addQuotaWindow"
                          >
                            {{ i18ns.t('relay.addQuotaWindow') }}
                          </el-button>
                        </div>
                      </div>

                      <div
                        v-if="editForm.quotaWindowsEnabled && editForm.quotaWindows.length"
                        class="quota-window-editor__list"
                      >
                        <div
                          v-for="(quotaWindow, index) in editForm.quotaWindows"
                          :key="`mobile-quota-window-${index}`"
                          class="quota-window-editor__item quota-window-editor__item--mobile"
                        >
                          <div class="quota-window-editor__item-head">
                            <div class="quota-window-editor__item-heading">
                              <span class="quota-window-editor__item-title">
                                {{ i18ns.t('relay.quotaWindowRuleTitle', { index: index + 1 }) }}
                              </span>
                              <span
                                class="quota-window-editor__item-meta"
                                role="button"
                                tabindex="0"
                                @click="toggleQuotaWindowPreviewMode(quotaWindow, index)"
                                @keydown.enter="toggleQuotaWindowPreviewMode(quotaWindow, index)"
                                @keydown.space.prevent="
                                  toggleQuotaWindowPreviewMode(quotaWindow, index)
                                "
                              >
                                {{ formatQuotaWindowPreview(quotaWindow, index) }}
                              </span>
                            </div>
                            <el-button
                              link
                              type="danger"
                              size="small"
                              :disabled="saving"
                              @click="removeQuotaWindow(index)"
                            >
                              {{ i18ns.t('relay.removeQuotaWindow') }}
                            </el-button>
                          </div>
                          <div
                            class="quota-window-editor__fields quota-window-editor__fields--mobile"
                          >
                            <div class="quota-window-editor__field">
                              <label class="quota-window-editor__field-label">{{
                                i18ns.t('relay.quotaWindowUnit')
                              }}</label>
                              <el-select
                                v-model="quotaWindow.quotaUnit"
                                @change="handleQuotaWindowUnitChange(quotaWindow)"
                              >
                                <el-option
                                  :label="i18ns.t('relay.quotaWindowUnitAmount')"
                                  value="amount"
                                />
                                <el-option
                                  :label="i18ns.t('relay.quotaWindowUnitRequest')"
                                  value="request"
                                />
                                <el-option
                                  :label="i18ns.t('relay.quotaWindowUnitToken')"
                                  value="token"
                                />
                              </el-select>
                            </div>
                            <div class="quota-window-editor__field">
                              <label class="quota-window-editor__field-label">{{
                                i18ns.t('relay.quotaWindowLimit')
                              }}</label>
                              <el-input-number
                                :key="`mobile-quota-limit-${index}-${quotaWindow.quotaUnit}`"
                                v-model="quotaWindow.quotaLimit"
                                :min="getQuotaMin(quotaWindow.quotaUnit)"
                                :max="getQuotaMax(quotaWindow.quotaUnit)"
                                :precision="getQuotaPrecision(quotaWindow.quotaUnit)"
                                :step="getQuotaStep(quotaWindow.quotaUnit)"
                                style="width: 100%"
                              />
                            </div>
                            <div class="quota-window-editor__field">
                              <label class="quota-window-editor__field-label">{{
                                i18ns.t('monthlyPass.quotaWindowHours')
                              }}</label>
                              <div
                                class="quota-window-duration-card quota-window-duration-card--mobile"
                              >
                                <div class="quota-window-picker quota-window-picker--mobile">
                                  <div class="quota-window-picker__segment">
                                    <el-input-number
                                      v-model="quotaWindow.months"
                                      :min="0"
                                      :max="MAX_QUOTA_WINDOW_MONTHS"
                                      :step="1"
                                      :precision="0"
                                      class="quota-window-input"
                                      @change="applyQuotaWindowParts(quotaWindow)"
                                    />
                                    <span class="quota-window-unit">{{
                                      i18ns.t('monthlyPass.monthsUnit')
                                    }}</span>
                                  </div>
                                  <div class="quota-window-picker__segment">
                                    <el-input-number
                                      v-model="quotaWindow.days"
                                      :min="0"
                                      :max="MAX_QUOTA_WINDOW_DAYS"
                                      :step="1"
                                      :precision="0"
                                      class="quota-window-input"
                                      @change="applyQuotaWindowParts(quotaWindow)"
                                    />
                                    <span class="quota-window-unit">{{
                                      i18ns.t('monthlyPass.daysUnit')
                                    }}</span>
                                  </div>
                                  <div class="quota-window-picker__segment">
                                    <el-input-number
                                      v-model="quotaWindow.hours"
                                      :min="0"
                                      :max="MAX_QUOTA_WINDOW_HOUR_PART"
                                      :step="1"
                                      :precision="0"
                                      class="quota-window-input"
                                      @change="applyQuotaWindowParts(quotaWindow)"
                                    />
                                    <span class="quota-window-unit">{{
                                      i18ns.t('monthlyPass.hoursUnit')
                                    }}</span>
                                  </div>
                                  <div class="quota-window-picker__segment">
                                    <el-input-number
                                      v-model="quotaWindow.minutes"
                                      :min="0"
                                      :max="MAX_QUOTA_WINDOW_MINUTE_PART"
                                      :step="1"
                                      :precision="0"
                                      class="quota-window-input"
                                      @change="applyQuotaWindowParts(quotaWindow)"
                                    />
                                    <span class="quota-window-unit">{{
                                      i18ns.t('monthlyPass.minutesUnit')
                                    }}</span>
                                  </div>
                                </div>
                                <div
                                  class="quota-window-value quota-window-value--mobile"
                                  role="button"
                                  tabindex="0"
                                  @click="toggleQuotaWindowPreviewMode(quotaWindow, index)"
                                  @keydown.enter="toggleQuotaWindowPreviewMode(quotaWindow, index)"
                                  @keydown.space.prevent="
                                    toggleQuotaWindowPreviewMode(quotaWindow, index)
                                  "
                                >
                                  {{ formatQuotaWindowPreview(quotaWindow, index) }}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <el-alert
                        v-else-if="!editForm.quotaWindowsEnabled"
                        type="info"
                        :closable="false"
                        :title="i18ns.t('relay.quotaWindowsDisabled')"
                        :description="i18ns.t('relay.quotaWindowsToggleHelp')"
                      />
                      <el-empty
                        v-else
                        :description="i18ns.t('relay.quotaWindowsEmpty')"
                        :image-size="84"
                      />
                    </div>
                  </el-form-item>
                </div>
              </el-collapse-item>

              <el-collapse-item name="advanced">
                <template #title>
                  <span class="relay-token-edit-sections__title">
                    {{ i18ns.t('relay.advancedSettings') }}
                  </span>
                </template>
                <div class="relay-token-edit-section-stack relay-token-edit-section-stack--mobile">
                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.ipWhitelist') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.ipWhitelistHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-input-tag
                      v-model="editForm.ipWhitelist"
                      class="ip-whitelist-tag-input"
                      :placeholder="i18ns.t('relay.ipWhitelistPlaceholder')"
                      :aria-label="i18ns.t('relay.ipWhitelist')"
                    />
                  </el-form-item>
                  <el-form-item>
                    <template #label>
                      <span class="form-label-with-help">
                        <span>{{ i18ns.t('relay.allowedModels') }}</span>
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="help-tooltip-content">
                              {{ i18ns.t('relay.allowedModelsHelp') }}
                            </div>
                          </template>
                          <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                        </el-tooltip>
                      </span>
                    </template>
                    <el-select
                      v-model="editForm.allowedModelIdsList"
                      multiple
                      filterable
                      :placeholder="i18ns.t('relay.selectModels')"
                      style="width: 100%"
                      :loading="loadingModels"
                    >
                      <el-option
                        v-for="modelId in filteredModelIds"
                        :key="modelId"
                        :label="getModelIdDisplayLabel(modelId)"
                        :value="modelId"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="i18ns.t('relay.modelMapping')">
                    <div class="flex flex-col gap-1 w-full">
                      <ModelMappingEditor
                        v-model="editForm.modelMapping"
                        :available-models="channelFilteredModelNames"
                      />
                      <span class="text-[#909399] text-xs">{{
                        i18ns.t('relay.tokenModelMappingHelp')
                      }}</span>
                    </div>
                  </el-form-item>
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-form>
          <template #footer>
            <el-button @click="showEditDialog = false">{{ i18ns.t('cancel') }}</el-button>
            <el-button type="primary" :loading="saving" @click="handleSave">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-drawer>
      </div>
    </div>

    <el-dialog
      v-model="showTokenImportDialog"
      :title="i18ns.t('relay.tokenImportDialogTitle')"
      width="min(680px, calc(100vw - 32px))"
      append-to-body
      class="relay-token-dialog"
    >
      <el-input
        v-model="tokenImportText"
        type="textarea"
        :rows="12"
        :placeholder="i18ns.t('relay.tokenImportPlaceholder')"
      />
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showTokenImportDialog = false">
            {{ i18ns.t('cancel') }}
          </el-button>
          <el-button type="primary" @click="handleImportTokens">
            {{ i18ns.t('relay.importTokens') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showTokenChannelImportDialog"
      :title="i18ns.t('relay.tokenChannelImportDialogTitle')"
      width="min(680px, calc(100vw - 32px))"
      append-to-body
      class="relay-token-dialog"
    >
      <el-input
        v-model="tokenChannelImportText"
        type="textarea"
        :rows="12"
        :placeholder="i18ns.t('relay.tokenChannelImportPlaceholder')"
      />
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showTokenChannelImportDialog = false">
            {{ i18ns.t('cancel') }}
          </el-button>
          <el-button type="primary" @click="handleImportTokenChannelConfigs">
            {{ i18ns.t('relay.importChannels') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showSwitchLogDialog"
      :title="i18ns.t('relay.switchLogsTitle', { token: currentSwitchLogTokenName })"
      :width="isDesktop ? '78%' : '92%'"
      class="relay-token-dialog switch-log-dialog"
    >
      <div class="switch-log-toolbar">
        <el-button :loading="loadingSwitchLogs" @click="loadSwitchLogs()">{{
          i18ns.t('refresh')
        }}</el-button>
      </div>
      <el-table v-if="switchLogs.length" :data="switchLogs" border stripe max-height="420">
        <el-table-column prop="createTime" :label="i18ns.t('relay.createTime')" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.createTime) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.fromChannel')" min-width="120">
          <template #default="{ row }">
            {{ row.fromChannelName || getChannelName(row.fromChannelId) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.toChannel')" min-width="120">
          <template #default="{ row }">
            {{ row.toChannelName || getChannelName(row.toChannelId) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="triggerStatusCode"
          :label="i18ns.t('relay.statusCode')"
          width="100"
        />
        <el-table-column prop="attemptNumber" :label="i18ns.t('relay.attemptNumber')" width="100" />
        <el-table-column prop="method" :label="i18ns.t('relay.method')" width="90" />
        <el-table-column
          prop="requestPath"
          :label="i18ns.t('relay.path')"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          prop="modelName"
          :label="i18ns.t('relay.modelName')"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          prop="triggerError"
          :label="i18ns.t('relay.triggerError')"
          min-width="180"
          show-overflow-tooltip
        />
      </el-table>
      <el-empty v-else :description="i18ns.t('relay.noSwitchLogs')" />
    </el-dialog>

    <BalanceScriptDialogV2
      v-model="showBalanceScriptDialog"
      :token="currentBalanceScriptToken"
      @switch-to-v1="switchToV1BalanceScriptDialog"
    />

    <BalanceScriptDialogV1
      v-model="showV1BalanceScriptDialog"
      :token="currentV1BalanceScriptToken"
    />

    <el-drawer
      v-model="showQuotaWindowDetailDialog"
      :title="quotaWindowDetailDialogTitle"
      :direction="isDesktop ? 'rtl' : 'btt'"
      :size="isDesktop ? '440px' : '78%'"
      class="relay-token-dialog quota-window-detail-drawer"
    >
      <div class="quota-window-detail-drawer__body">
        <div v-if="currentQuotaWindowDetailToken" class="quota-window-detail-drawer__token">
          <span class="meta-label">{{ i18ns.t('relay.tokenName') }}</span>
          <span class="quota-window-detail-drawer__token-name">
            {{ currentQuotaWindowDetailToken.name || i18ns.t('relay.unnamedToken') }}
          </span>
        </div>

        <div class="quota-window-detail-drawer__list">
          <div
            v-for="(quotaWindow, quotaWindowIndex) in currentQuotaWindowDetailWindows"
            :key="`quota-window-detail-${quotaWindow.id || quotaWindowIndex}`"
            class="quota-window-usage-item"
          >
            <div class="quota-window-usage-item__header">
              <span class="quota-window-chip">
                {{ formatQuotaWindowRule(quotaWindow) }}
              </span>
              <span
                v-if="quotaWindow.quotaUsagePercent != null"
                class="quota-window-usage-item__percent"
                :class="{ 'quota-window-usage-item__percent--danger': quotaWindow.isQuotaExceeded }"
              >
                {{ formatQuotaPercent(quotaWindow.quotaUsagePercent) }}
              </span>
            </div>
            <el-progress
              v-if="quotaWindow.quotaUsagePercent != null"
              :percentage="getQuotaProgressPercentage(quotaWindow.quotaUsagePercent)"
              :status="getQuotaProgressStatus(quotaWindow.quotaUsagePercent)"
              :stroke-width="6"
              :show-text="false"
              class="quota-window-usage-item__progress"
            />
            <div
              class="quota-window-usage-item__summary"
              :class="{ 'quota-window-usage-item__summary--danger': quotaWindow.isQuotaExceeded }"
            >
              {{ formatQuotaWindowCompactSummary(quotaWindow) }}
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { Clock, Delete, Rank, Refresh } from '@element-plus/icons-vue'
import { Permission } from '@/constant/permission'
import { MANAGED_STATUS } from '@/constant/status'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import ModelMappingEditor from '@/components/relay/ModelMappingEditor.vue'
import BalanceScriptDialogV1 from '@/components/relay/BalanceScriptDialogV1.vue'
import BalanceScriptDialogV2 from '@/components/relay/BalanceScriptDialogV2.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { relayTokenService } from '@/service/relayTokenService'
import { relayChannelService } from '@/service/relayChannelService'
import { userService } from '@/service/userService'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { useFloatingOverlayVisibility } from '@/composables/useFloatingOverlayVisibility'
import Sortable from 'sortablejs'
import { resolveRelayAiBaseUrl } from '@/constant/strings'
import { copyTextWithFallback } from '@/utils/clipboard'
import { normalizeRelayFormats, type RelayFormat } from '@/utils/relay-formats'
import type {
  ImportRelayTokensResponse,
  RelayChannelDto,
  RelayChannelSwitchLogDto,
  RelayTokenImportItemDto,
  RelayTokenChannelConfigDto,
  RelayTokenDto,
  RelayTokenQuotaWindowDto,
  UserDto,
} from '@/client/types.gen'

type EditableChannelConfig = {
  tempKey: string
  channelId: string
  priority: number
}

type EditableFailoverConfig = {
  enabled: boolean
  maxRetries: number
  retryStatusCodes: string[]
  failoverThreshold: number
  failbackCooldownMinutes: number
}

type ChannelOption = {
  id: string
  name: string
  multiplier: number | string
  unavailable?: boolean
}

type CcswitchApp = 'claude' | 'codex' | 'gemini'

type TokenQuotaSnapshot = {
  usedQuota: number
  remainingQuota?: number
  quotaUsagePercent?: number
  isQuotaExceeded: boolean
}

type QuotaUnit = 'amount' | 'request' | 'token'

type RelayTokenQuotaWindowLike = Pick<
  RelayTokenQuotaWindowDto,
  'quotaLimit' | 'quotaUnit' | 'quotaWindowHours'
> & {
  id?: string
  usedQuota?: number
  remainingQuota?: number
  quotaUsagePercent?: number
  isQuotaExceeded?: boolean
}

type RelayTokenWithQuotaWindows = RelayTokenDto & {
  quotaWindows?: RelayTokenQuotaWindowLike[]
}

type EditableQuotaWindow = RelayTokenQuotaWindowLike & {
  id?: string
  months: number
  days: number
  hours: number
  minutes: number
}

const DEFAULT_RETRY_STATUS_CODES = ['4xx', '5xx']
const DEFAULT_QUOTA_WINDOW_HOURS = 24
const QUOTA_WINDOW_PREVIEW_CYCLE = ['hour', 'actual', 'day', 'week', 'month'] as const
const MAX_AMOUNT_QUOTA = 999999.9999
const MAX_INTEGER_QUOTA = 999999
const MAX_QUOTA_WINDOW_HOURS = 24 * 30 * 12
const MAX_QUOTA_WINDOW_MONTHS = 12
const MAX_QUOTA_WINDOW_DAYS = 29
const MAX_QUOTA_WINDOW_HOUR_PART = 23
const MAX_QUOTA_WINDOW_MINUTE_PART = 59
const MAX_QUOTA_WINDOWS = 20

const EXACT_HTTP_STATUS_RULE_REGEX = /^[1-5]\d{2}$/
const WILDCARD_HTTP_STATUS_RULE_REGEX = /^[0-9x*]{3}$/i
const REGEX_FLAGS_REGEX = /^[imsu]*$/
const HTTP_STATUS_CODES = Array.from({ length: 500 }, (_, index) => index + 100)

const parseRegexRule = (rule: string): RegExp | null => {
  if (!rule.startsWith('/')) return null

  const lastSlashIndex = rule.lastIndexOf('/')
  if (lastSlashIndex <= 0) return null

  const pattern = rule.slice(1, lastSlashIndex)
  const flags = rule.slice(lastSlashIndex + 1)
  if (!pattern || !REGEX_FLAGS_REGEX.test(flags)) return null

  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

const matchesWildcardStatusRule = (statusCode: number, rule: string) => {
  const statusText = String(statusCode)
  if (statusText.length !== 3 || rule.length !== 3) return false

  return rule.split('').every((char, index) => {
    if (char === 'x' || char === '*') return true
    return statusText[index] === char
  })
}

const isValidRetryStatusRule = (rule: string) => {
  if (EXACT_HTTP_STATUS_RULE_REGEX.test(rule)) return true

  if (WILDCARD_HTTP_STATUS_RULE_REGEX.test(rule) && /[x*]/i.test(rule)) {
    return HTTP_STATUS_CODES.some((statusCode) => matchesWildcardStatusRule(statusCode, rule))
  }

  const regex = parseRegexRule(rule)
  if (!regex) return false

  return HTTP_STATUS_CODES.some((statusCode) => {
    regex.lastIndex = 0
    return regex.test(String(statusCode))
  })
}

const createDefaultFailoverConfig = (): EditableFailoverConfig => ({
  enabled: false,
  maxRetries: 1,
  retryStatusCodes: [...DEFAULT_RETRY_STATUS_CODES],
  failoverThreshold: 0,
  failbackCooldownMinutes: 0,
})

let channelConfigKeySeed = 0

const createEmptyChannelConfig = (priority: number, channelId = ''): EditableChannelConfig => ({
  tempKey: `token-channel-config-${channelConfigKeySeed++}`,
  channelId,
  priority,
})

const round4 = (value: number) => Math.round(value * 10000) / 10000

const normalizeQuotaUnit = (value?: string): QuotaUnit => {
  if (value === 'request' || value === 'token') return value
  return 'amount'
}

const isIntegerQuotaUnit = (value?: string): boolean => {
  const unit = normalizeQuotaUnit(value)
  return unit === 'request' || unit === 'token'
}

const getQuotaMax = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? MAX_INTEGER_QUOTA : MAX_AMOUNT_QUOTA
}

const getQuotaMin = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const getQuotaPrecision = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 0 : 4
}

const getQuotaStep = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const normalizeQuotaForSubmit = (value: number, unit?: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return numeric
  if (isIntegerQuotaUnit(unit)) return Math.floor(numeric)
  return round4(numeric)
}

const normalizeQuotaForUnitSwitch = (value: number, unit?: string): number => {
  const normalized = normalizeQuotaForSubmit(value, unit)
  if (!Number.isFinite(normalized)) return normalized

  const clamped = Math.min(getQuotaMax(unit), Math.max(getQuotaMin(unit), normalized))
  return isIntegerQuotaUnit(unit) ? Math.floor(clamped) : round4(clamped)
}

const normalizeQuotaWindowHours = (value?: number): number | undefined => {
  if (value == null) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return undefined
  return Math.min(Math.round(numeric * 10000) / 10000, MAX_QUOTA_WINDOW_HOURS)
}

const clampNonNegativeInteger = (value: unknown, max: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.min(Math.floor(numeric), max)
}

const splitQuotaWindowParts = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (normalized == null) {
    return {
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    }
  }

  const totalMinutes = Math.round(normalized * 60)
  const minutesPerMonth = 30 * 24 * 60
  const minutesPerDay = 24 * 60
  const months = Math.floor(totalMinutes / minutesPerMonth)
  const afterMonths = totalMinutes % minutesPerMonth
  const days = Math.floor(afterMonths / minutesPerDay)
  const afterDays = afterMonths % minutesPerDay

  return {
    months,
    days,
    hours: Math.floor(afterDays / 60),
    minutes: afterDays % 60,
  }
}

const combineQuotaWindowParts = (
  monthsValue: unknown,
  daysValue: unknown,
  hoursValue: unknown,
  minutesValue: unknown,
): number | undefined => {
  const months = clampNonNegativeInteger(monthsValue, MAX_QUOTA_WINDOW_MONTHS)
  const days = clampNonNegativeInteger(daysValue, MAX_QUOTA_WINDOW_DAYS)
  const hours = clampNonNegativeInteger(hoursValue, MAX_QUOTA_WINDOW_HOUR_PART)
  const minutes = clampNonNegativeInteger(minutesValue, MAX_QUOTA_WINDOW_MINUTE_PART)
  const totalHours = months * 30 * 24 + days * 24 + hours + minutes / 60
  return normalizeQuotaWindowHours(totalHours)
}

const createEditableQuotaWindow = (
  input?: Partial<RelayTokenQuotaWindowLike>,
): EditableQuotaWindow => {
  const quotaUnit = normalizeQuotaUnit(input?.quotaUnit)
  const normalizedQuotaWindowHours =
    normalizeQuotaWindowHours(input?.quotaWindowHours) ?? DEFAULT_QUOTA_WINDOW_HOURS
  const { months, days, hours, minutes } = splitQuotaWindowParts(normalizedQuotaWindowHours)
  const initialQuotaLimit =
    input?.quotaLimit != null && Number.isFinite(Number(input.quotaLimit))
      ? Number(input.quotaLimit)
      : getQuotaMin(quotaUnit)

  return {
    id: input?.id,
    quotaLimit: normalizeQuotaForUnitSwitch(initialQuotaLimit, quotaUnit),
    quotaUnit,
    quotaWindowHours: normalizedQuotaWindowHours,
    months,
    days,
    hours,
    minutes,
  }
}

const { isDesktop } = usePageDevice()
const { setHidden: setFloatingOverlayHidden, reset: resetFloatingOverlayHidden } =
  useFloatingOverlayVisibility()
const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()

const serverTokens = ref<RelayTokenDto[]>([])
const allTokensCache = ref<RelayTokenDto[] | null>(null)
const userOptions = ref<Array<Pick<UserDto, 'id' | 'username' | 'name'>>>([])
const userOptionsLoading = ref(false)
const selectedTargetUserId = ref('')
const tokenTableRef = ref<TableInstance>()
const channels = ref<RelayChannelDto[]>([])
const availableModels = ref<string[]>([])
const availableModelIds = ref<string[]>([])
const modelIdToModelNameMap = ref<Map<string, string>>(new Map())
const modelIdToModelNamesMap = ref<Map<string, string[]>>(new Map())
const quotaWindowPreviewModes = ref<Record<string, number>>({})
const loadingTokens = ref(false)
const showEditDialog = ref(false)
const saving = ref(false)
const loadingModels = ref(false)
const editMode = ref<'create' | 'edit'>('create')
const currentEditId = ref('')
const DEFAULT_EDIT_DIALOG_SECTIONS = ['basic', 'channelFailover', 'quota']
const editDialogSectionNames = ref<string[]>([...DEFAULT_EDIT_DIALOG_SECTIONS])
const showSwitchLogDialog = ref(false)
const loadingSwitchLogs = ref(false)
const currentSwitchLogTokenId = ref('')
const currentSwitchLogTokenName = ref('')
const switchLogs = ref<RelayChannelSwitchLogDto[]>([])
const showBalanceScriptDialog = ref(false)
const currentBalanceScriptToken = ref<RelayTokenDto | null>(null)
const showV1BalanceScriptDialog = ref(false)
const currentV1BalanceScriptToken = ref<RelayTokenDto | null>(null)
const showQuotaWindowDetailDialog = ref(false)
const currentQuotaWindowDetailToken = ref<RelayTokenDto | null>(null)
const retryStatusCodeOptions = DEFAULT_RETRY_STATUS_CODES
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const pageSizeOptions = [10, 20, 50, 100]
const searchKeyword = ref('')
const searchTokenKeyword = ref('')
const activeSearchKeyword = ref('')
const activeSearchTokenKeyword = ref('')
const showAllMode = ref(false)
const selectedTokenIds = ref<string[]>([])
const showTokenImportDialog = ref(false)
const tokenImportText = ref('')

const canManageAllTokens = computed(() =>
  permissionStore.hasPermission(Permission.RELAY_TOKEN_MANAGE_OTHERS_READ),
)

const currentTargetUserId = computed(() => {
  const normalized = selectedTargetUserId.value.trim()
  return normalized || userInfoStore.userInfo.id || ''
})

const currentTargetUserIdForRequest = computed(() => {
  const currentUserId = userInfoStore.userInfo.id || ''
  return currentTargetUserId.value && currentTargetUserId.value !== currentUserId
    ? currentTargetUserId.value
    : undefined
})

const normalizeSearchText = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()

const normalizedSearchKeyword = computed(() => normalizeSearchText(activeSearchKeyword.value))
const normalizedSearchTokenKeyword = computed(() =>
  normalizeSearchText(activeSearchTokenKeyword.value),
)

const hasSearchFilters = computed(
  () => Boolean(normalizedSearchKeyword.value) || Boolean(normalizedSearchTokenKeyword.value),
)

const isLocalTokenMode = computed(() => showAllMode.value || hasSearchFilters.value)

const filteredAllTokens = computed(() => {
  const keyword = normalizedSearchKeyword.value
  const tokenKeyword = normalizedSearchTokenKeyword.value

  return (allTokensCache.value || []).filter((row) => {
    const matchesKeyword =
      !keyword ||
      [row.name, row.id, row.channelName, row.allowedModels]
        .map((item) => normalizeSearchText(item))
        .some((item) => item.includes(keyword))

    const matchesToken = !tokenKeyword || normalizeSearchText(row.token).includes(tokenKeyword)

    return matchesKeyword && matchesToken
  })
})

const paginationTotal = computed(() =>
  isLocalTokenMode.value ? filteredAllTokens.value.length : total.value,
)

const showPagination = computed(() => !showAllMode.value && paginationTotal.value > 0)

const tokens = computed<RelayTokenDto[]>(() => {
  if (!isLocalTokenMode.value) return serverTokens.value
  if (showAllMode.value) return filteredAllTokens.value

  const start = (currentPage.value - 1) * pageSize.value
  return filteredAllTokens.value.slice(start, start + pageSize.value)
})

const selectedTokenIdSet = computed(() => new Set(selectedTokenIds.value))

const selectedTokens = computed(() => {
  const tokenMap = new Map<string, RelayTokenDto>()

  for (const token of serverTokens.value) tokenMap.set(token.id, token)
  for (const token of allTokensCache.value || []) tokenMap.set(token.id, token)
  for (const token of tokens.value) tokenMap.set(token.id, token)

  return selectedTokenIds.value
    .map((id) => tokenMap.get(id))
    .filter((token): token is RelayTokenDto => Boolean(token))
})

const desktopChannelListRef = ref<HTMLElement | null>(null)
const mobileChannelListRef = ref<HTMLElement | null>(null)
let desktopSortable: Sortable | null = null
let mobileSortable: Sortable | null = null

const createEmptyEditForm = () => ({
  name: '',
  token: '',
  channelId: '' as string,
  expiresAt: null as Date | null,
  quotaLimit: null as number | null,
  originalQuotaWindowsEnabled: false,
  quotaWindowsEnabled: false,
  quotaWindows: [] as EditableQuotaWindow[],
  allowedModels: '',
  ipWhitelist: [] as string[],
  allowedModelIdsList: [] as string[],
  channelConfigs: [createEmptyChannelConfig(0)] as EditableChannelConfig[],
  failoverConfig: createDefaultFailoverConfig() as EditableFailoverConfig,
  modelMapping: {} as Record<string, string>,
})

const editForm = ref({
  ...createEmptyEditForm(),
})

const channelNameMap = computed(
  () => new Map(channels.value.map((channel) => [channel.id, channel.name])),
)

const activeChannelIdSet = computed(() => new Set(channels.value.map((channel) => channel.id)))

const selectedChannelConfigKeys = ref<string[]>([])
const tokenChannelBatchAddIds = ref<string[]>([])
const showTokenChannelImportDialog = ref(false)
const tokenChannelImportText = ref('')

const selectedChannelConfigKeySet = computed(() => new Set(selectedChannelConfigKeys.value))

const selectedChannelConfigs = computed(() =>
  editForm.value.channelConfigs.filter((config) =>
    selectedChannelConfigKeySet.value.has(config.tempKey),
  ),
)

const hasSelectedChannelConfigs = computed(() => selectedChannelConfigs.value.length > 0)

const isAllChannelConfigsSelected = computed(
  () =>
    editForm.value.channelConfigs.length > 0 &&
    selectedChannelConfigKeys.value.length === editForm.value.channelConfigs.length,
)

const tokenChannelBatchAddOptions = computed(() => {
  const selectedIds = new Set(
    editForm.value.channelConfigs.map((config) => config.channelId.trim()).filter(Boolean),
  )

  return channels.value.filter((channel) => !selectedIds.has(channel.id))
})

const unavailableChannelConfigs = computed(() =>
  editForm.value.channelConfigs
    .map((config, index) => ({
      channelId: config.channelId.trim(),
      priority: index,
    }))
    .filter((config) => config.channelId && !activeChannelIdSet.value.has(config.channelId)),
)

const showUnavailableChannelWarning = computed(
  () => editMode.value === 'edit' && unavailableChannelConfigs.value.length > 0,
)

const unavailableChannelWarningText = computed(() =>
  i18ns.t('relay.unavailableChannelsWarningDesc', {
    channels: unavailableChannelConfigs.value
      .map((config) =>
        i18ns.t('relay.unavailableChannelSummaryItem', {
          order: config.priority + 1,
          channelId: config.channelId,
        }),
      )
      .join('；'),
  }),
)

const normalizeChannelConfigs = (configs: EditableChannelConfig[]) =>
  configs.map((config, index) => ({
    ...config,
    priority: index,
  }))

const syncSelectedChannelConfigKeys = () => {
  const validKeys = new Set(editForm.value.channelConfigs.map((config) => config.tempKey))
  selectedChannelConfigKeys.value = selectedChannelConfigKeys.value.filter((key) =>
    validKeys.has(key),
  )
}

const syncTokenChannelBatchAddIds = () => {
  const availableIds = new Set(tokenChannelBatchAddOptions.value.map((channel) => channel.id))
  tokenChannelBatchAddIds.value = tokenChannelBatchAddIds.value.filter((id) => availableIds.has(id))
}

const replaceChannelConfigs = (configs: EditableChannelConfig[]) => {
  const normalizedConfigs = normalizeChannelConfigs(configs)
  editForm.value.channelConfigs = normalizedConfigs.length
    ? normalizedConfigs
    : [createEmptyChannelConfig(0)]
  syncSelectedChannelConfigKeys()
  syncTokenChannelBatchAddIds()
}

const resetTokenChannelEditorState = () => {
  selectedChannelConfigKeys.value = []
  tokenChannelBatchAddIds.value = []
  showTokenChannelImportDialog.value = false
  tokenChannelImportText.value = ''
}

const toggleAllChannelConfigSelections = () => {
  if (isAllChannelConfigsSelected.value) {
    selectedChannelConfigKeys.value = []
    return
  }

  selectedChannelConfigKeys.value = editForm.value.channelConfigs.map((config) => config.tempKey)
}

const buildTokenChannelExportItems = () => {
  const seen = new Set<string>()

  return editForm.value.channelConfigs.map((config, index) => {
    const channelId = config.channelId.trim()

    if (!channelId) {
      throw new Error(i18ns.t('relay.channelRequired'))
    }

    if (seen.has(channelId)) {
      throw new Error(i18ns.t('relay.duplicateChannels'))
    }

    seen.add(channelId)

    return {
      channelId,
      priority: index,
      channelName: channelNameMap.value.get(channelId) || channelId,
    }
  })
}

const buildTokenChannelExportContent = () => JSON.stringify(buildTokenChannelExportItems(), null, 2)

const downloadJsonFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

const parseImportedTokenChannelConfigs = (rawContent: string): EditableChannelConfig[] => {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawContent)
  } catch {
    throw new Error(i18ns.t('relay.tokenChannelImportFormatError'))
  }

  if (!Array.isArray(parsed)) {
    throw new Error(i18ns.t('relay.tokenChannelImportFormatError'))
  }

  const seen = new Set<string>()

  return parsed.map((item, index) => {
    const channelId =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object'
          ? String((item as { channelId?: unknown }).channelId ?? '').trim()
          : ''

    if (!channelId) {
      throw new Error(i18ns.t('relay.tokenChannelImportFormatError'))
    }

    if (seen.has(channelId)) {
      throw new Error(i18ns.t('relay.duplicateChannels'))
    }

    seen.add(channelId)
    return createEmptyChannelConfig(index, channelId)
  })
}

const handleCopyTokenChannelConfigs = async () => {
  try {
    const copied = await copyTextWithFallback(buildTokenChannelExportContent())
    if (!copied) {
      throw new Error(i18ns.t('copyFailed'))
    }

    ElMessage.success(i18ns.t('copySuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('copyFailed'))
  }
}

const handleExportTokenChannelConfigs = () => {
  try {
    const fileSuffix = currentEditId.value || editMode.value
    downloadJsonFile(
      `relay-token-channel-configs-${fileSuffix}.json`,
      buildTokenChannelExportContent(),
    )
    ElMessage.success(i18ns.t('relay.tokenChannelExportSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const openTokenChannelImportDialog = () => {
  tokenChannelImportText.value = ''
  showTokenChannelImportDialog.value = true
}

const handleImportTokenChannelConfigs = () => {
  try {
    replaceChannelConfigs(parseImportedTokenChannelConfigs(tokenChannelImportText.value))
    tokenChannelImportText.value = ''
    showTokenChannelImportDialog.value = false
    ElMessage.success(i18ns.t('relay.tokenChannelImportSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.tokenChannelImportFormatError'))
  }
}

const handleBatchAddTokenChannels = () => {
  if (!tokenChannelBatchAddIds.value.length) {
    ElMessage.warning(i18ns.t('relay.tokenChannelSelectChannelsFirst'))
    return
  }

  const existingConfigs = editForm.value.channelConfigs.filter((config) => config.channelId.trim())
  const existingIds = new Set(existingConfigs.map((config) => config.channelId.trim()))
  const additions = tokenChannelBatchAddIds.value
    .filter((channelId) => !existingIds.has(channelId))
    .map((channelId, index) => createEmptyChannelConfig(existingConfigs.length + index, channelId))

  replaceChannelConfigs([...existingConfigs, ...additions])
  tokenChannelBatchAddIds.value = []
}

const handleBatchRemoveTokenChannelConfigs = () => {
  if (!hasSelectedChannelConfigs.value) {
    ElMessage.warning(i18ns.t('relay.tokenChannelSelectConfigsFirst'))
    return
  }

  replaceChannelConfigs(
    editForm.value.channelConfigs.filter(
      (config) => !selectedChannelConfigKeySet.value.has(config.tempKey),
    ),
  )
}

const filteredModelIds = computed(() => {
  // Get all selected channel IDs from channelConfigs
  const selectedChannelIds = editForm.value.channelConfigs
    .map((config) => config.channelId)
    .filter((id) => id)

  if (selectedChannelIds.length === 0) return availableModelIds.value

  // If failover is not enabled, only use the first channel
  const channelIdsToCheck = editForm.value.failoverConfig.enabled
    ? selectedChannelIds
    : [selectedChannelIds[0]]

  // Collect allowed model names from selected channels
  const allAllowedModelNames = new Set<string>()
  let hasUnrestrictedChannel = false
  let hasResolvedSelectedChannel = false

  for (const channelId of channelIdsToCheck) {
    const selectedChannel = channels.value.find((ch) => ch.id === channelId)
    if (!selectedChannel) continue
    hasResolvedSelectedChannel = true

    if (!selectedChannel.allowedModels) {
      // If channel has no restrictions, mark it and return all models later
      hasUnrestrictedChannel = true
      break
    }

    try {
      const parsedAllowedModels = JSON.parse(selectedChannel.allowedModels)
      if (!Array.isArray(parsedAllowedModels)) {
        // If parsing fails, treat as unrestricted
        hasUnrestrictedChannel = true
        break
      }

      for (const rawEntry of parsedAllowedModels) {
        const normalizedEntry = String(rawEntry || '').trim()
        if (normalizedEntry) allAllowedModelNames.add(normalizedEntry)
      }
    } catch {
      // If parsing fails, treat as unrestricted
      hasUnrestrictedChannel = true
      break
    }
  }

  // If any channel is unrestricted, return all available model IDs
  if (hasUnrestrictedChannel) {
    return availableModelIds.value
  }

  if (!hasResolvedSelectedChannel) {
    return availableModelIds.value
  }

  // Build a reverse map: model name -> model IDs
  const modelNameToIds = new Map<string, Set<string>>()
  for (const [modelId, modelNames] of modelIdToModelNamesMap.value.entries()) {
    for (const modelName of modelNames) {
      if (!modelNameToIds.has(modelName)) {
        modelNameToIds.set(modelName, new Set())
      }
      modelNameToIds.get(modelName)!.add(modelId)
    }
  }

  // Also handle cases where modelId === modelName
  for (const modelId of availableModelIds.value) {
    if (!modelIdToModelNamesMap.value.has(modelId)) {
      // Verify this modelId actually exists in the available models
      if (availableModels.value.includes(modelId)) {
        // This modelId has no separate model names, so modelId === modelName
        if (!modelNameToIds.has(modelId)) {
          modelNameToIds.set(modelId, new Set())
        }
        modelNameToIds.get(modelId)!.add(modelId)
      }
    }
  }

  // Collect all model IDs that have at least one allowed model name
  const allowedModelIdsSet = new Set<string>()
  for (const modelName of allAllowedModelNames) {
    const modelIds = modelNameToIds.get(modelName)
    if (modelIds) {
      modelIds.forEach((id) => allowedModelIdsSet.add(id))
    }
  }

  return Array.from(allowedModelIdsSet)
})

// 从有序渠道的"允许的模型"中提取模型名称并集，供 ModelMappingEditor 下拉使用
const channelFilteredModelNames = computed(() => {
  const selectedChannelIds = editForm.value.channelConfigs
    .map((config) => config.channelId)
    .filter((id) => id)

  if (selectedChannelIds.length === 0) return availableModels.value

  const channelIdsToCheck = editForm.value.failoverConfig.enabled
    ? selectedChannelIds
    : [selectedChannelIds[0]]

  const allModelNames = new Set<string>()
  let hasUnrestrictedChannel = false
  let hasResolvedSelectedChannel = false

  for (const channelId of channelIdsToCheck) {
    const selectedChannel = channels.value.find((ch) => ch.id === channelId)
    if (!selectedChannel) continue
    hasResolvedSelectedChannel = true

    if (!selectedChannel.allowedModels) {
      hasUnrestrictedChannel = true
      break
    }

    try {
      const parsedAllowedModels = JSON.parse(selectedChannel.allowedModels)
      if (!Array.isArray(parsedAllowedModels)) {
        hasUnrestrictedChannel = true
        break
      }

      for (const rawEntry of parsedAllowedModels) {
        const normalizedEntry = String(rawEntry || '').trim()
        if (normalizedEntry) allModelNames.add(normalizedEntry)
      }
    } catch {
      hasUnrestrictedChannel = true
      break
    }
  }

  if (hasUnrestrictedChannel || !hasResolvedSelectedChannel) {
    return availableModels.value
  }

  return Array.from(allModelNames)
})

const requiredRetrySlots = computed(() => Math.max(0, editForm.value.channelConfigs.length - 1))

const showMaxRetriesRiskWarning = computed(
  () =>
    editForm.value.failoverConfig.enabled &&
    editForm.value.channelConfigs.length > 1 &&
    editForm.value.failoverConfig.maxRetries < requiredRetrySlots.value,
)

const maxRetriesRiskWarningText = computed(() =>
  i18ns.t('relay.maxRetriesRiskWarning', {
    configured: editForm.value.failoverConfig.maxRetries,
    recommended: requiredRetrySlots.value,
    totalChannels: editForm.value.channelConfigs.length,
  }),
)

// Get display label for model ID
const getModelIdDisplayLabel = (modelId: string): string => {
  // const modelNames = modelIdToModelNamesMap.value.get(modelId)
  // if (modelNames && (modelNames.length > 0 && !(modelNames.length === 1 && modelNames[0] === modelId))) {
  //   return `${modelId} (${modelNames.join(', ')})`
  // }
  return modelId
}

watch(
  () => editForm.value.channelConfigs.map((config) => config.channelId),
  () => {
    editForm.value.channelId = editForm.value.channelConfigs[0]?.channelId || ''
    syncTokenChannelBatchAddIds()
    if (!editForm.value.allowedModelIdsList.length) return
    const validModelIds = new Set(filteredModelIds.value)
    editForm.value.allowedModelIdsList = editForm.value.allowedModelIdsList.filter((modelId) =>
      validModelIds.has(modelId),
    )
  },
  { deep: true },
)

// Watch failover enabled status to filter models accordingly
watch(
  () => editForm.value.failoverConfig.enabled,
  () => {
    if (!editForm.value.allowedModelIdsList.length) return
    const validModelIds = new Set(filteredModelIds.value)
    editForm.value.allowedModelIdsList = editForm.value.allowedModelIdsList.filter((modelId) =>
      validModelIds.has(modelId),
    )
  },
)

// Initialize/destroy Sortable when edit dialog opens/closes
watch(showEditDialog, (isOpen) => {
  setFloatingOverlayHidden(isOpen)
  if (isOpen) {
    // Wait for next tick to ensure DOM is rendered
    setTimeout(() => {
      initSortable()
    }, 100)
  } else {
    resetTokenChannelEditorState()
    destroySortable()
  }
})

onBeforeUnmount(() => {
  resetFloatingOverlayHidden()
})

const initSortable = () => {
  // Desktop sortable
  if (desktopChannelListRef.value) {
    desktopSortable = new Sortable(desktopChannelListRef.value, {
      animation: 150,
      handle: '.channel-config-drag-handle',
      draggable: '.channel-config-row',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: (evt) => {
        const fromIndex = parseInt(evt.item.dataset.index ?? '-1', 10)
        const toRows = Array.from(evt.to.querySelectorAll(':scope > .channel-config-row'))
        const toIndex = toRows.indexOf(evt.item)
        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          const configs = [...editForm.value.channelConfigs]
          const [moved] = configs.splice(fromIndex, 1)
          configs.splice(toIndex, 0, moved!)
          editForm.value.channelConfigs = configs.map((config, index) => ({
            ...config,
            priority: index,
          }))
        }
      },
    })
  }

  // Mobile sortable
  if (mobileChannelListRef.value) {
    mobileSortable = new Sortable(mobileChannelListRef.value, {
      animation: 150,
      handle: '.channel-config-drag-handle',
      draggable: '.channel-config-row',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: (evt) => {
        const fromIndex = parseInt(evt.item.dataset.index ?? '-1', 10)
        const toRows = Array.from(evt.to.querySelectorAll(':scope > .channel-config-row'))
        const toIndex = toRows.indexOf(evt.item)
        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          const configs = [...editForm.value.channelConfigs]
          const [moved] = configs.splice(fromIndex, 1)
          configs.splice(toIndex, 0, moved!)
          editForm.value.channelConfigs = configs.map((config, index) => ({
            ...config,
            priority: index,
          }))
        }
      },
    })
  }
}

const destroySortable = () => {
  if (desktopSortable) {
    desktopSortable.destroy()
    desktopSortable = null
  }
  if (mobileSortable) {
    mobileSortable.destroy()
    mobileSortable = null
  }
}

const invalidateAllTokensCache = () => {
  allTokensCache.value = null
}

const ensureUserOption = (userId?: string, username?: string | null, name?: string | null) => {
  if (!userId) return
  if (userOptions.value.some((item) => item.id === userId)) return

  userOptions.value = [
    {
      id: userId,
      username: username || userId,
      name: name || null,
    },
    ...userOptions.value,
  ]
}

const loadUserOptions = async (keyword?: string) => {
  if (!canManageAllTokens.value) return

  userOptionsLoading.value = true
  try {
    const result = await userService.getAllUsers({
      page: 1,
      pageSize: 100,
      keyword: keyword?.trim() || undefined,
    })
    const users = Array.isArray(result?.users) ? result.users : []
    userOptions.value = users
      .map((item: UserDto) => ({
        id: item.id,
        username: item.username || item.id,
        name: item.name || null,
      }))
      .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username))

    ensureUserOption(
      userInfoStore.userInfo.id,
      userInfoStore.userInfo.username,
      userInfoStore.userInfo.name,
    )
  } catch (_error) {
    userOptions.value = []
  } finally {
    userOptionsLoading.value = false
  }
}

const handleTargetUserSearch = (query: string) => {
  void loadUserOptions(query)
}

const handleTargetUserChange = () => {
  currentPage.value = 1
  clearTokenSelection()
  invalidateAllTokensCache()
  void loadTokens({ forceAllReload: true })
}

const syncSelectedTokenIds = () => {
  const availableIds = new Set<string>()
  for (const token of serverTokens.value) availableIds.add(token.id)
  for (const token of allTokensCache.value || []) availableIds.add(token.id)
  for (const token of tokens.value) availableIds.add(token.id)

  selectedTokenIds.value = selectedTokenIds.value.filter((id) => availableIds.has(id))
}

const loadAllTokens = async (force = false) => {
  if (allTokensCache.value && !force) return allTokensCache.value

  const mergedTokens: RelayTokenDto[] = []
  const batchSize = 100
  let nextPage = 1
  let expectedTotal = 0

  while (true) {
    const result = await relayTokenService.getRelayTokens({
      page: nextPage,
      pageSize: batchSize,
      targetUserId: currentTargetUserIdForRequest.value,
    })

    const items = result.items || []
    mergedTokens.push(...items)
    expectedTotal = result.total || mergedTokens.length

    if (!items.length || mergedTokens.length >= expectedTotal) break
    nextPage += 1
  }

  allTokensCache.value = mergedTokens
  return mergedTokens
}

const loadTokens = async (options?: { forceAllReload?: boolean }) => {
  loadingTokens.value = true
  try {
    if (isLocalTokenMode.value) {
      await loadAllTokens(options?.forceAllReload)

      const maxPage = Math.max(1, Math.ceil(filteredAllTokens.value.length / pageSize.value))
      if (showAllMode.value) {
        currentPage.value = 1
      } else if (currentPage.value > maxPage) {
        currentPage.value = maxPage
      }

      total.value = filteredAllTokens.value.length
      serverTokens.value = []
      syncSelectedTokenIds()
      return
    }

    const result = await relayTokenService.getRelayTokens({
      page: currentPage.value,
      pageSize: pageSize.value,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    const relayTokens = result.items || []

    currentPage.value = result.page || currentPage.value
    pageSize.value = result.pageSize || pageSize.value
    total.value = result.total || 0
    serverTokens.value = relayTokens
    syncSelectedTokenIds()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  } finally {
    loadingTokens.value = false
  }
}

const refreshTokens = () => {
  void loadTokens({ forceAllReload: true })
}

const handleTokenSelectionChange = (rows: RelayTokenDto[]) => {
  selectedTokenIds.value = rows.map((row) => row.id)
}

const handleMobileTokenSelectionChange = (id: string, checked: boolean | string | number) => {
  if (checked) {
    if (!selectedTokenIdSet.value.has(id)) {
      selectedTokenIds.value = [...selectedTokenIds.value, id]
    }
    return
  }

  selectedTokenIds.value = selectedTokenIds.value.filter((item) => item !== id)
}

const handleSelectAllVisibleTokens = () => {
  selectedTokenIds.value = tokens.value.map((token) => token.id)

  if (isDesktop.value) {
    tokenTableRef.value?.clearSelection()
    tokens.value.forEach((token) => tokenTableRef.value?.toggleRowSelection(token, true))
  }
}

const clearTokenSelection = () => {
  selectedTokenIds.value = []
  tokenTableRef.value?.clearSelection()
}

const ensureSelectedTokenIds = () => {
  syncSelectedTokenIds()

  if (!selectedTokenIds.value.length) {
    ElMessage.warning(i18ns.t('relay.selectTokensFirst'))
    return null
  }

  return [...selectedTokenIds.value]
}

const buildRelayTokenExportItems = (tokensToExport: RelayTokenDto[]): RelayTokenImportItemDto[] =>
  tokensToExport.map((token) => ({
    name: token.name || null,
    expiresAt: token.expiresAt || null,
    quotaLimit: token.quotaLimit ?? null,
    allowedModels: token.allowedModels || null,
    ipWhitelist: token.ipWhitelist || null,
    status: token.status,
    channelConfigs: (token.channelConfigs || []).map((config) => ({
      channelId: config.channelId,
      priority: config.priority,
    })),
    failoverConfig: token.failoverConfig
      ? {
          enabled: Boolean(token.failoverConfig.enabled),
          maxRetries: token.failoverConfig.maxRetries ?? 0,
          retryStatusCodes: token.failoverConfig.retryStatusCodes || [],
          failoverThreshold: token.failoverConfig.failoverThreshold ?? 0,
          failbackCooldownMinutes: token.failoverConfig.failbackCooldownMinutes ?? 0,
        }
      : undefined,
  }))

const downloadRelayTokenExport = (items: RelayTokenImportItemDto[], fileSuffix = 'batch') => {
  downloadJsonFile(`relay-tokens-${fileSuffix}.json`, JSON.stringify(items, null, 2))
}

const copyRelayTokenExportItems = async (items: RelayTokenImportItemDto[]) => {
  try {
    const copied = await copyTextWithFallback(JSON.stringify(items, null, 2))

    if (!copied) {
      throw new Error(i18ns.t('copyFailed'))
    }

    ElMessage.success(i18ns.t('copySuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('copyFailed'))
  }
}

const handleCopySingleTokenJson = async (row: RelayTokenDto) => {
  try {
    const result = await relayTokenService.exportTokens({
      ids: [row.id],
      targetUserId: currentTargetUserIdForRequest.value,
    })
    await copyRelayTokenExportItems(result.tokens || buildRelayTokenExportItems([row]))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const openTokenImportDialog = () => {
  tokenImportText.value = ''
  showTokenImportDialog.value = true
}

const handleExportSingleToken = async (row: RelayTokenDto) => {
  try {
    const result = await relayTokenService.exportTokens({
      ids: [row.id],
      targetUserId: currentTargetUserIdForRequest.value,
    })
    downloadRelayTokenExport(result.tokens || buildRelayTokenExportItems([row]), row.id)
    ElMessage.success(i18ns.t('relay.tokenExportSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const handleBatchExportTokens = async () => {
  const ids = ensureSelectedTokenIds()
  if (!ids) return

  try {
    const result = await relayTokenService.exportTokens({
      ids,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    downloadRelayTokenExport(result.tokens || buildRelayTokenExportItems(selectedTokens.value))
    ElMessage.success(i18ns.t('relay.tokenExportSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const handleBatchCopyTokenValues = async () => {
  const ids = ensureSelectedTokenIds()
  if (!ids) return

  const selectedRows = selectedTokens.value.filter((token) => ids.includes(token.id))
  if (!selectedRows.length) {
    ElMessage.warning(i18ns.t('relay.selectTokensFirst'))
    return
  }

  await copyToken(selectedRows.map((token) => token.token).join('\n'))
}

const handleBatchCopyTokenJson = async () => {
  const ids = ensureSelectedTokenIds()
  if (!ids) return

  try {
    const result = await relayTokenService.exportTokens({
      ids,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    await copyRelayTokenExportItems(
      result.tokens || buildRelayTokenExportItems(selectedTokens.value),
    )
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const handleDuplicateSingleToken = async (row: RelayTokenDto) => {
  try {
    await relayTokenService.duplicateToken(row.id, {
      targetUserId: currentTargetUserIdForRequest.value,
    })
    invalidateAllTokensCache()
    ElMessage.success(i18ns.t('relay.tokenDuplicateSuccess'))
    await loadTokens({ forceAllReload: true })
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const handleBatchDuplicateTokens = async () => {
  const ids = ensureSelectedTokenIds()
  if (!ids) return
  const count = ids.length

  try {
    await relayTokenService.batchDuplicateTokens({
      ids,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    invalidateAllTokensCache()
    clearTokenSelection()
    ElMessage.success(i18ns.t('relay.tokenBatchDuplicateSuccess', { count }))
    await loadTokens({ forceAllReload: true })
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const handleBatchSetTokenStatus = async (enabled: boolean) => {
  const ids = ensureSelectedTokenIds()
  if (!ids) return
  const count = ids.length

  try {
    await relayTokenService.batchSetTokenStatus({
      ids,
      enabled,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    invalidateAllTokensCache()
    clearTokenSelection()
    ElMessage.success(
      i18ns.t('relay.tokenBatchStatusSuccess', {
        count,
        action: enabled ? i18ns.t('relay.enable') : i18ns.t('relay.disable'),
      }),
    )
    await loadTokens({ forceAllReload: true })
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const handleBatchDeleteTokens = async () => {
  const ids = ensureSelectedTokenIds()
  if (!ids) return
  const count = ids.length

  try {
    await ElMessageBox.confirm(i18ns.t('relay.confirmBatchDeleteTokens'), i18ns.t('warning'), {
      type: 'warning',
    })
    await relayTokenService.batchDeleteTokens({
      ids,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    invalidateAllTokensCache()
    clearTokenSelection()
    ElMessage.success(i18ns.t('relay.tokenBatchDeleteSuccess', { count }))
    await loadTokens({ forceAllReload: true })
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }
}

const handleBatchTokenCommand = async (command: string) => {
  switch (command) {
    case 'copy-json':
      await handleBatchCopyTokenJson()
      break
    case 'copy-token-value':
      await handleBatchCopyTokenValues()
      break
    case 'export':
      await handleBatchExportTokens()
      break
    case 'duplicate':
      await handleBatchDuplicateTokens()
      break
    case 'enable':
      await handleBatchSetTokenStatus(true)
      break
    case 'disable':
      await handleBatchSetTokenStatus(false)
      break
    case 'delete':
      await handleBatchDeleteTokens()
      break
    default:
      break
  }
}

const parseImportedTokens = (rawContent: string): RelayTokenImportItemDto[] => {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawContent)
  } catch {
    throw new Error(i18ns.t('relay.tokenImportFormatError'))
  }

  const imported =
    parsed && typeof parsed === 'object' && 'tokens' in (parsed as Record<string, unknown>)
      ? (parsed as { tokens?: unknown }).tokens
      : parsed

  if (!Array.isArray(imported)) {
    throw new Error(i18ns.t('relay.tokenImportFormatError'))
  }

  return imported as RelayTokenImportItemDto[]
}

const handleImportTokens = async () => {
  try {
    const importItems = parseImportedTokens(tokenImportText.value)
    const result: ImportRelayTokensResponse = await relayTokenService.importTokens({
      tokens: importItems,
      targetUserId: currentTargetUserIdForRequest.value,
    })
    tokenImportText.value = ''
    showTokenImportDialog.value = false
    invalidateAllTokensCache()
    clearTokenSelection()
    ElMessage.success(
      i18ns.t('relay.tokenImportSuccess', {
        count: result.created ?? result.total ?? importItems.length,
      }),
    )
    await loadTokens({ forceAllReload: true })
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.tokenImportFormatError'))
  }
}

const handleSearch = () => {
  activeSearchKeyword.value = searchKeyword.value
  activeSearchTokenKeyword.value = searchTokenKeyword.value
  currentPage.value = 1
  void loadTokens()
}

const toggleShowAll = () => {
  showAllMode.value = !showAllMode.value
  currentPage.value = 1
  void loadTokens()
}

const handleCurrentPageChange = (page: number) => {
  currentPage.value = page
  void loadTokens()
}

const handlePageSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  void loadTokens()
}

const loadChannels = async () => {
  channels.value = await relayChannelService.listChannels()
}

const loadAvailableModels = async () => {
  loadingModels.value = true
  try {
    const modelsMap = await relayTokenService.getAvailableModels()
    availableModels.value = modelsMap.modelNames
    availableModelIds.value = modelsMap.modelIds || []
    modelIdToModelNameMap.value = new Map(Object.entries(modelsMap.modelIdToModelNameMap))
    modelIdToModelNamesMap.value = new Map(Object.entries(modelsMap.modelIdToModelNamesMap || {}))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    throw error
  } finally {
    loadingModels.value = false
  }
}

const openCreateDialog = () => {
  editMode.value = 'create'
  editForm.value = createEmptyEditForm()
  resetTokenChannelEditorState()
  editDialogSectionNames.value = [...DEFAULT_EDIT_DIALOG_SECTIONS]
  showEditDialog.value = true
}

const openEditDialog = (row: RelayTokenDto) => {
  editMode.value = 'edit'
  currentEditId.value = row.id
  editDialogSectionNames.value = [...DEFAULT_EDIT_DIALOG_SECTIONS]

  // allowedModels stores model IDs directly
  const modelIdsList = row.allowedModels
    ? row.allowedModels
        .split(',')
        .map((m: string) => m.trim())
        .filter(Boolean)
    : []

  const channelConfigs = getSortedChannelConfigs(row).length
    ? getSortedChannelConfigs(row).map((config, index) =>
        createEmptyChannelConfig(index, config.channelId),
      )
    : [createEmptyChannelConfig(0, row.channelId || '')]

  const quotaWindows = getRelayTokenQuotaWindows(row).map((quotaWindow) =>
    createEditableQuotaWindow(quotaWindow),
  )

  editForm.value = {
    name: row.name || '',
    token: '',
    channelId: channelConfigs[0]?.channelId || '',
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    quotaLimit: row.quotaLimit ?? null,
    originalQuotaWindowsEnabled: quotaWindows.length > 0,
    quotaWindowsEnabled: quotaWindows.length > 0,
    quotaWindows,
    allowedModels: row.allowedModels || '',
    ipWhitelist: splitIpWhitelistInput(row.ipWhitelist),
    allowedModelIdsList: modelIdsList,
    channelConfigs,
    failoverConfig: {
      enabled: row.failoverConfig?.enabled ?? false,
      maxRetries: row.failoverConfig?.maxRetries ?? 0,
      retryStatusCodes: row.failoverConfig?.retryStatusCodes?.length
        ? [...row.failoverConfig.retryStatusCodes]
        : [...DEFAULT_RETRY_STATUS_CODES],
      failoverThreshold: row.failoverConfig?.failoverThreshold ?? 0,
      failbackCooldownMinutes: row.failoverConfig?.failbackCooldownMinutes ?? 0,
    },
    modelMapping: (row.modelMapping as Record<string, string>) || {},
  }

  showEditDialog.value = true
}

const getAvailableChannelOptions = (currentChannelId: string): ChannelOption[] => {
  const selectedChannelIds = new Set(
    editForm.value.channelConfigs
      .map((config) => config.channelId)
      .filter((channelId) => channelId && channelId !== currentChannelId),
  )

  const options: ChannelOption[] = channels.value
    .filter((channel) => !selectedChannelIds.has(channel.id) || channel.id === currentChannelId)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      multiplier: channel.multiplier,
    }))

  if (currentChannelId && !activeChannelIdSet.value.has(currentChannelId)) {
    options.unshift({
      id: currentChannelId,
      name: i18ns.t('relay.unavailableChannelOptionLabel'),
      multiplier: 0,
      unavailable: true,
    })
  }

  return options
}

const getChannelOptionLabel = (channel: ChannelOption) =>
  channel.unavailable
    ? i18ns.t('relay.unavailableChannelOptionLabelWithId', {
        channelId: channel.id,
      })
    : `${channel.name} (${channel.multiplier}x)`

const addChannelConfig = () => {
  if (editForm.value.channelConfigs.length >= channels.value.length) return
  editForm.value.channelConfigs.push(createEmptyChannelConfig(editForm.value.channelConfigs.length))
  syncTokenChannelBatchAddIds()
}

const removeChannelConfig = (index: number) => {
  if (editForm.value.channelConfigs.length === 1) {
    replaceChannelConfigs([])
    return
  }

  replaceChannelConfigs(
    editForm.value.channelConfigs.filter((_, currentIndex) => currentIndex !== index),
  )
}

const applyQuotaWindowParts = (quotaWindow: EditableQuotaWindow) => {
  const normalized =
    combineQuotaWindowParts(
      quotaWindow.months,
      quotaWindow.days,
      quotaWindow.hours,
      quotaWindow.minutes,
    ) ?? DEFAULT_QUOTA_WINDOW_HOURS
  quotaWindow.quotaWindowHours = normalized
  const { months, days, hours, minutes } = splitQuotaWindowParts(normalized)
  quotaWindow.months = months
  quotaWindow.days = days
  quotaWindow.hours = hours
  quotaWindow.minutes = minutes
}

const handleQuotaWindowUnitChange = (quotaWindow: EditableQuotaWindow) => {
  quotaWindow.quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit)
  quotaWindow.quotaLimit = normalizeQuotaForUnitSwitch(
    quotaWindow.quotaLimit ?? getQuotaMin(quotaWindow.quotaUnit),
    quotaWindow.quotaUnit,
  )
}

const addQuotaWindow = () => {
  if (editForm.value.quotaWindows.length >= MAX_QUOTA_WINDOWS) return
  editForm.value.quotaWindows.push(createEditableQuotaWindow())
}

const handleQuotaWindowsToggleChange = (value: string | number | boolean) => {
  const enabled = Boolean(value)
  editForm.value.quotaWindowsEnabled = enabled

  if (enabled && !editForm.value.quotaWindows.length) {
    editForm.value.quotaWindows.push(createEditableQuotaWindow())
  }
}

const removeQuotaWindow = (index: number) => {
  const targetQuotaWindow = editForm.value.quotaWindows[index]
  if (targetQuotaWindow) {
    const key = getQuotaWindowPreviewKey(targetQuotaWindow, index)
    delete quotaWindowPreviewModes.value[key]
  }
  editForm.value.quotaWindows.splice(index, 1)
}

const normalizeQuotaWindowsPayload = () => {
  if (!editForm.value.quotaWindowsEnabled || !editForm.value.quotaWindows.length) return []

  const seen = new Set<string>()

  return editForm.value.quotaWindows.map((quotaWindow, index) => {
    const quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit)
    const rawQuotaLimit = Number(quotaWindow.quotaLimit)

    if (!Number.isFinite(rawQuotaLimit)) {
      throw new Error(i18ns.t('relay.quotaWindowLimitRequired', { index: index + 1 }))
    }

    const normalizedQuotaLimit = normalizeQuotaForSubmit(rawQuotaLimit, quotaUnit)
    if (
      normalizedQuotaLimit < getQuotaMin(quotaUnit) ||
      normalizedQuotaLimit > getQuotaMax(quotaUnit)
    ) {
      throw new Error(i18ns.t('relay.quotaWindowLimitOutOfRange', { index: index + 1 }))
    }

    const quotaWindowHours =
      combineQuotaWindowParts(
        quotaWindow.months,
        quotaWindow.days,
        quotaWindow.hours,
        quotaWindow.minutes,
      ) ?? quotaWindow.quotaWindowHours
    const normalizedQuotaWindowHours = normalizeQuotaWindowHours(quotaWindowHours)

    if (normalizedQuotaWindowHours == null) {
      throw new Error(i18ns.t('relay.quotaWindowHoursRequired', { index: index + 1 }))
    }

    const uniqueKey = `${quotaUnit}:${normalizedQuotaWindowHours}`
    if (seen.has(uniqueKey)) {
      throw new Error(i18ns.t('relay.quotaWindowDuplicate'))
    }
    seen.add(uniqueKey)

    quotaWindow.quotaLimit = normalizedQuotaLimit
    quotaWindow.quotaUnit = quotaUnit
    quotaWindow.quotaWindowHours = normalizedQuotaWindowHours
    const { months, days, hours, minutes } = splitQuotaWindowParts(normalizedQuotaWindowHours)
    quotaWindow.months = months
    quotaWindow.days = days
    quotaWindow.hours = hours
    quotaWindow.minutes = minutes

    return {
      quotaLimit: normalizedQuotaLimit,
      quotaUnit,
      quotaWindowHours: normalizedQuotaWindowHours,
    }
  })
}

const buildChannelConfigsPayload = () => {
  const trimmedConfigs = editForm.value.channelConfigs.map((config, index) => ({
    channelId: (config.channelId ?? '').trim(),
    priority: index,
  }))

  if (trimmedConfigs.some((config) => !config.channelId)) {
    throw new Error(i18ns.t('relay.channelRequired'))
  }

  const uniqueIds = new Set(trimmedConfigs.map((config) => config.channelId))
  if (uniqueIds.size !== trimmedConfigs.length) {
    throw new Error(i18ns.t('relay.duplicateChannels'))
  }

  const unavailableChannelIds = trimmedConfigs
    .map((config) => config.channelId)
    .filter((channelId) => !activeChannelIdSet.value.has(channelId))

  if (unavailableChannelIds.length) {
    throw new Error(
      i18ns.t('relay.unavailableChannelsSaveError', {
        channels: unavailableChannelIds
          .map((channelId, index) =>
            i18ns.t('relay.unavailableChannelSummaryItem', {
              order: index + 1,
              channelId,
            }),
          )
          .join('；'),
      }),
    )
  }

  return trimmedConfigs
}

const normalizeRetryStatusCodes = (codes: Array<string | number>) => {
  const normalizedCodes: string[] = []
  const seen = new Set<string>()

  for (const rawCode of codes) {
    const rawRule = String(rawCode ?? '').trim()
    if (!rawRule) continue

    const normalizedRule = parseRegexRule(rawRule) ? rawRule : rawRule.toLowerCase()
    if (!isValidRetryStatusRule(normalizedRule)) {
      throw new Error(i18ns.t('relay.invalidRetryStatusRule', { rule: rawRule }))
    }

    if (seen.has(normalizedRule)) continue
    seen.add(normalizedRule)
    normalizedCodes.push(normalizedRule)
  }

  return normalizedCodes
}

const splitIpWhitelistInput = (value?: string | null) => {
  return String(value || '')
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const normalizeIpWhitelistEntries = (values: Array<string | number>) => {
  const entries = values.map((item) => String(item || '').trim()).filter(Boolean)

  return Array.from(new Set(entries))
}

const normalizeIpWhitelistInput = (values: Array<string | number>) => {
  const entries = normalizeIpWhitelistEntries(values)
  return entries.length ? entries.join('\n') : ''
}

const normalizeQuotaLimitInput = (value: number | null | undefined): number | null => {
  if (value == null) return null

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  return round4(numeric)
}

const normalizeOptionalDateForSubmit = (
  value: Date | null | undefined,
): string | null | undefined => {
  if (!value) return undefined

  const timestamp = value.getTime()
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null

  return value.toISOString()
}

const handleSave = async () => {
  saving.value = true
  try {
    const channelConfigs = buildChannelConfigsPayload()
    const quotaWindows = normalizeQuotaWindowsPayload()

    const allowedModelsStr = editForm.value.allowedModelIdsList.join(',')
    const normalizedName = editForm.value.name.trim()
    editForm.value.ipWhitelist = normalizeIpWhitelistEntries(editForm.value.ipWhitelist)
    const ipWhitelist = normalizeIpWhitelistInput(editForm.value.ipWhitelist)
    const normalizedExpiresAt = normalizeOptionalDateForSubmit(editForm.value.expiresAt)

    const failoverConfig = {
      enabled: editForm.value.failoverConfig.enabled,
      maxRetries: editForm.value.failoverConfig.maxRetries,
      retryStatusCodes: normalizeRetryStatusCodes(editForm.value.failoverConfig.retryStatusCodes),
      failoverThreshold: editForm.value.failoverConfig.failoverThreshold,
      failbackCooldownMinutes: editForm.value.failoverConfig.failbackCooldownMinutes,
    }

    const shouldIncludeQuotaWindowsForUpdate =
      editMode.value === 'create' ||
      editForm.value.originalQuotaWindowsEnabled ||
      editForm.value.quotaWindowsEnabled

    if (editMode.value === 'create') {
      const modelMapping =
        editForm.value.modelMapping && Object.keys(editForm.value.modelMapping).length > 0
          ? editForm.value.modelMapping
          : undefined

      const data = {
        name: normalizedName || undefined,
        token: editForm.value.token.trim() || undefined,
        channelId: channelConfigs[0]?.channelId,
        channelConfigs,
        failoverConfig,
        expiresAt: normalizedExpiresAt ?? undefined,
        quotaLimit: editForm.value.quotaLimit ?? undefined,
        quotaWindows,
        allowedModels: allowedModelsStr || undefined,
        ipWhitelist,
        modelMapping,
        targetUserId: currentTargetUserIdForRequest.value,
      }
      await relayTokenService.createRelayToken(data)
      currentPage.value = 1
      invalidateAllTokensCache()
      ElMessage.success(i18ns.t('relay.createSuccess'))
    } else {
      const modelMapping =
        editForm.value.modelMapping && Object.keys(editForm.value.modelMapping).length > 0
          ? editForm.value.modelMapping
          : null

      const data = {
        name: normalizedName || null,
        token: editForm.value.token.trim() || undefined,
        channelId: channelConfigs[0]?.channelId,
        channelConfigs,
        failoverConfig,
        expiresAt: normalizedExpiresAt ?? null,
        quotaLimit: editForm.value.quotaLimit == null ? null : editForm.value.quotaLimit,
        ...(shouldIncludeQuotaWindowsForUpdate ? { quotaWindows } : {}),
        allowedModels: allowedModelsStr || null,
        ipWhitelist: ipWhitelist || null,
        modelMapping,
        targetUserId: currentTargetUserIdForRequest.value,
      }
      await relayTokenService.updateToken(currentEditId.value, data)
      invalidateAllTokensCache()

      ElMessage.success(i18ns.t('relay.updateSuccess'))
    }

    showEditDialog.value = false
    loadTokens()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.createFailed'))
  } finally {
    saving.value = false
  }
}

const handleToggleStatus = async (row: RelayTokenDto) => {
  try {
    const action =
      row.status === MANAGED_STATUS.ENABLED
        ? i18ns.t('relay.disableToken')
        : i18ns.t('relay.enableToken')
    await ElMessageBox.confirm(
      i18ns.t('relay.confirmToggleStatus', { action }),
      i18ns.t('warning'),
      {
        type: 'warning',
      },
    )
    await relayTokenService.toggleTokenStatus(row.id, currentTargetUserIdForRequest.value)
    invalidateAllTokensCache()
    ElMessage.success(i18ns.t('success'))
    loadTokens()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }
}

const copyToken = async (token: string) => {
  try {
    const copied = await copyTextWithFallback(token)

    if (!copied) {
      throw new Error(i18ns.t('copyFailed'))
    }

    ElMessage.success(i18ns.t('copySuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('copyFailed'))
  }
}

const handleRefreshToken = async (row: RelayTokenDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('relay.confirmRefreshToken'), i18ns.t('warning'), {
      type: 'warning',
    })

    const refreshedToken = await relayTokenService.refreshRelayToken(
      row.id,
      currentTargetUserIdForRequest.value,
    )
    invalidateAllTokensCache()

    try {
      await navigator.clipboard.writeText(refreshedToken.token)
      ElMessage.success(i18ns.t('relay.refreshTokenSuccessAndCopied'))
    } catch {
      ElMessage.success(i18ns.t('relay.refreshTokenSuccess'))
    }

    await loadTokens({ forceAllReload: true })
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('relay.refreshTokenFailed'))
    }
  }
}

const getAIEndpointUrl = () =>
  resolveRelayAiBaseUrl(
    import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
    import.meta.env.VITE_AI_PROXY_URL,
  )

const RELAY_FORMAT_TO_CCSWITCH_APP: Record<RelayFormat, CcswitchApp> = {
  anthropic: 'claude',
  openai: 'codex',
  gemini: 'gemini',
}

const getTokenSupportedFormats = (row: RelayTokenDto): RelayFormat[] => {
  const configuredFormats = new Set<RelayFormat>()
  const channelIds = new Set<string>()

  for (const config of getSortedChannelConfigs(row)) {
    if (config.channelId) channelIds.add(config.channelId)
  }

  if (row.channelId) channelIds.add(row.channelId)

  for (const channelId of channelIds) {
    const channel = channels.value.find((item) => item.id === channelId)
    if (!channel) continue

    for (const format of normalizeRelayFormats(channel.allowedFormats)) {
      configuredFormats.add(format)
    }
  }

  return configuredFormats.size > 0 ? Array.from(configuredFormats) : ['anthropic']
}

const getCcswitchLaunchLabel = (format: RelayFormat) => {
  switch (format) {
    case 'openai':
      return i18ns.t('relay.launchGptToCcswitch')
    case 'gemini':
      return i18ns.t('relay.launchGeminiToCcswitch')
    case 'anthropic':
    default:
      return i18ns.t('relay.launchClaudeToCcswitch')
  }
}

const buildCcswitchImportUri = (row: RelayTokenDto, format: RelayFormat) => {
  const base_endpoint = getAIEndpointUrl()
  const name = row.name?.trim() || `${i18ns.t('relay.unnamedToken')} ${maskToken(row.token, 6, 4)}`

  let endpoint: string
  if (format === 'anthropic') {
    endpoint = `${base_endpoint}`
  } else if (format === 'openai') {
    endpoint = `${base_endpoint}/v1`
  } else if (format === 'gemini') {
    endpoint = `${base_endpoint}/v1beta`
  } else {
    throw new Error(i18ns.t('relay.unsupportedFormat', { format }))
  }

  const searchParams = new URLSearchParams({
    resource: 'provider',
    app: RELAY_FORMAT_TO_CCSWITCH_APP[format],
    name,
    endpoint,
    apiKey: row.token,
    homepage: endpoint,
    enabled: 'true',
  })

  return `ccswitch://v1/import?${searchParams.toString()}`
}

const openBalanceScriptDialog = (row: RelayTokenDto) => {
  currentBalanceScriptToken.value = row
  showBalanceScriptDialog.value = true
}

const switchToV1BalanceScriptDialog = () => {
  if (currentBalanceScriptToken.value) {
    currentV1BalanceScriptToken.value = currentBalanceScriptToken.value
  }
  showBalanceScriptDialog.value = false
  showV1BalanceScriptDialog.value = true
}

const handleLaunchToCcswitch = async (row: RelayTokenDto, format: RelayFormat) => {
  try {
    const endpoint = getAIEndpointUrl()
    if (!endpoint) {
      ElMessage.error(i18ns.t('relay.launchToCcswitchMissingEndpoint'))
      return
    }

    const importUri = buildCcswitchImportUri(row, format)
    window.location.href = importUri
    ElMessage.info(i18ns.t('relay.launchToCcswitchSuccess'))
  } catch {
    ElMessage.error(i18ns.t('relay.launchToCcswitchFailed'))
  }
}

const handleExportToCcswitch = async (row: RelayTokenDto) => {
  openBalanceScriptDialog(row)
}

const handleMoreCommand = async (command: string, row: RelayTokenDto) => {
  if (command.startsWith('launch-ccswitch-')) {
    const format = command.replace('launch-ccswitch-', '') as RelayFormat
    if (format === 'anthropic' || format === 'openai' || format === 'gemini') {
      await handleLaunchToCcswitch(row, format)
    }
  } else if (command === 'duplicate') {
    await handleDuplicateSingleToken(row)
  } else if (command === 'export') {
    await handleExportSingleToken(row)
  } else if (command === 'copy-token-value') {
    await copyToken(row.token)
  } else if (command === 'copy-json') {
    await handleCopySingleTokenJson(row)
  } else if (command === 'export-ccswitch') {
    await handleExportToCcswitch(row)
  } else if (command === 'refresh-token') {
    await handleRefreshToken(row)
  } else if (command === 'open-switch-logs') {
    await openSwitchLogsDialog(row)
  }
}

const maskToken = (token: string, start = 10, end = 8) => {
  const normalized = String(token || '')
  if (normalized.length <= start + end) return normalized
  return `${normalized.slice(0, start)}...${normalized.slice(-end)}`
}

const getSortedChannelConfigs = (row: RelayTokenDto): RelayTokenChannelConfigDto[] =>
  [...(row.channelConfigs || [])].sort((a, b) => a.priority - b.priority)

const getRelayTokenQuotaWindows = (row: RelayTokenDto): RelayTokenQuotaWindowLike[] => {
  const quotaWindows = (row as RelayTokenWithQuotaWindows).quotaWindows
  return Array.isArray(quotaWindows) ? quotaWindows : []
}

const sortQuotaWindowsForDisplay = (quotaWindows: RelayTokenQuotaWindowLike[]) => {
  return [...quotaWindows].sort((left, right) => {
    const rightPercent =
      right.quotaUsagePercent != null && Number.isFinite(Number(right.quotaUsagePercent))
        ? Number(right.quotaUsagePercent)
        : -1
    const leftPercent =
      left.quotaUsagePercent != null && Number.isFinite(Number(left.quotaUsagePercent))
        ? Number(left.quotaUsagePercent)
        : -1

    if (rightPercent !== leftPercent) {
      return rightPercent - leftPercent
    }

    const leftHours = normalizeQuotaWindowHours(left.quotaWindowHours) ?? Number.POSITIVE_INFINITY
    const rightHours = normalizeQuotaWindowHours(right.quotaWindowHours) ?? Number.POSITIVE_INFINITY

    if (leftHours !== rightHours) {
      return leftHours - rightHours
    }

    return Number(right.usedQuota || 0) - Number(left.usedQuota || 0)
  })
}

const getSortedRelayTokenQuotaWindows = (row: RelayTokenDto) =>
  sortQuotaWindowsForDisplay(getRelayTokenQuotaWindows(row))

const getPrimaryRelayTokenQuotaWindows = (row: RelayTokenDto) =>
  getSortedRelayTokenQuotaWindows(row).slice(0, 1)

const getRemainingRelayTokenQuotaWindowCount = (row: RelayTokenDto) =>
  Math.max(getSortedRelayTokenQuotaWindows(row).length - 1, 0)

const MAX_VISIBLE_CHANNEL_CONFIGS = 2

const getVisibleChannelConfigs = (row: RelayTokenDto) =>
  getSortedChannelConfigs(row).slice(0, MAX_VISIBLE_CHANNEL_CONFIGS)

const getHiddenChannelConfigCount = (row: RelayTokenDto) =>
  Math.max(getSortedChannelConfigs(row).length - MAX_VISIBLE_CHANNEL_CONFIGS, 0)

const currentQuotaWindowDetailWindows = computed(() =>
  currentQuotaWindowDetailToken.value
    ? getSortedRelayTokenQuotaWindows(currentQuotaWindowDetailToken.value)
    : [],
)

const quotaWindowDetailDialogTitle = computed(() => {
  if (!currentQuotaWindowDetailToken.value) return i18ns.t('relay.quotaWindows')

  return `${i18ns.t('relay.quotaWindows')} · ${currentQuotaWindowDetailToken.value.name || i18ns.t('relay.unnamedToken')}`
})

const openQuotaWindowDetailDialog = (row: RelayTokenDto) => {
  currentQuotaWindowDetailToken.value = row
  showQuotaWindowDetailDialog.value = true
}

const getChannelName = (channelId: string) => channelNameMap.value.get(channelId) || channelId

const getTokenQuotaSnapshot = (row: RelayTokenDto): TokenQuotaSnapshot => {
  const usedQuota = Number(row.usedQuota || 0)
  const quotaLimit = row.quotaLimit
  const remainingQuota = quotaLimit != null ? Math.max(quotaLimit - usedQuota, 0) : undefined
  const quotaUsagePercent =
    quotaLimit && quotaLimit > 0 ? (usedQuota / quotaLimit) * 100 : undefined

  return {
    usedQuota,
    remainingQuota,
    quotaUsagePercent,
    isQuotaExceeded: quotaLimit != null ? usedQuota >= quotaLimit : false,
  }
}

const formatSuccessRate = (value: number) => `${(Number(value || 0) * 100).toFixed(1)}%`

const formatRetryStatusCodes = (codes: Array<string | number>) =>
  codes && codes.length
    ? normalizeRetryStatusCodes(codes)
        .map((code) => formatRetryStatusCodeOptionLabel(code))
        .join(', ')
    : '-'

const formatRetryStatusCodeOptionLabel = (code: string) => {
  switch (code) {
    case '4xx':
      return i18ns.t('relay.retryStatusCodeLabel4xx')
    case '5xx':
      return i18ns.t('relay.retryStatusCodeLabel5xx')
    case '401':
      return i18ns.t('relay.retryStatusCodeLabel401')
    case '403':
      return i18ns.t('relay.retryStatusCodeLabel403')
    case '405':
      return i18ns.t('relay.retryStatusCodeLabel405')
    case '429':
      return i18ns.t('relay.retryStatusCodeLabel429')
    case '500':
      return i18ns.t('relay.retryStatusCodeLabel500')
    case '502':
      return i18ns.t('relay.retryStatusCodeLabel502')
    case '503':
      return i18ns.t('relay.retryStatusCodeLabel503')
    case '504':
      return i18ns.t('relay.retryStatusCodeLabel504')
    default:
      return code.startsWith('/')
        ? i18ns.t('relay.retryStatusCodeLabelRegex', { rule: code })
        : i18ns.t('relay.retryStatusCodeLabelFallback', { code: String(code) })
  }
}

const formatChannelSummary = (row: RelayTokenDto) => {
  const configs = getSortedChannelConfigs(row)
  if (!configs.length) return '-'
  const visibleText = getVisibleChannelConfigs(row)
    .map(
      (config) =>
        `#${config.priority + 1} ${config.channelName || getChannelName(config.channelId)}`,
    )
    .join(' · ')

  const hiddenCount = getHiddenChannelConfigCount(row)
  return hiddenCount > 0 ? `${visibleText} · ${i18ns.t('nav.more')} ${hiddenCount}` : visibleText
}

const formatTokenStatsSummary = (row: RelayTokenDto) => {
  return `${row.requestCount || 0} / ${formatNumber(row.totalTokens || 0)}`
}

const formatCompactFailoverSummary = (row: RelayTokenDto) => {
  if (!row.failoverConfig?.enabled) return `${i18ns.t('relay.maxRetries')}: 0`
  const retryCodes = normalizeRetryStatusCodes(row.failoverConfig.retryStatusCodes || [])
  const threshold = row.failoverConfig.failoverThreshold ?? 0
  const failbackCooldownMinutes = Math.max(0, row.failoverConfig.failbackCooldownMinutes ?? 0)
  const cooldownText = failbackCooldownMinutes
    ? ` · ${i18ns.t('relay.failbackCooldownCompact', { minutes: failbackCooldownMinutes })}`
    : ''
  return `${i18ns.t('relay.maxRetries')}: ${row.failoverConfig.maxRetries} · ${i18ns.t('relay.failoverThreshold')}: ${threshold} · ${retryCodes.length}${i18ns.t('relay.statusCode')}${cooldownText}`
}

const formatMobileChannelMeta = (row: RelayTokenDto) => {
  const failoverText = formatCompactFailoverSummary(row)
  return row.failoverConfig?.enabled
    ? `${i18ns.t('relay.failoverEnabled')} · ${failoverText}`
    : `${i18ns.t('relay.failoverDisabled')} · ${failoverText}`
}

const loadSwitchLogs = async (tokenId: string = currentSwitchLogTokenId.value) => {
  if (!tokenId) return
  loadingSwitchLogs.value = true
  try {
    const result = await relayTokenService.getTokenSwitchLogs(
      tokenId,
      50,
      currentTargetUserIdForRequest.value,
    )
    switchLogs.value = result.logs || []
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  } finally {
    loadingSwitchLogs.value = false
  }
}

const openSwitchLogsDialog = async (row: RelayTokenDto) => {
  currentSwitchLogTokenId.value = row.id
  currentSwitchLogTokenName.value = row.name || row.token.slice(0, 12)
  switchLogs.value = []
  showSwitchLogDialog.value = true
  await loadSwitchLogs(row.id)
}

const formatDateTime = (date: Date | string) => {
  const d = new Date(date)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatNumber = (num: number) => num.toLocaleString('zh-CN')

const formatQuotaWindowUnit = (value?: string) => {
  const unit = normalizeQuotaUnit(value)
  if (unit === 'request') return i18ns.t('relay.quotaWindowUnitRequest')
  if (unit === 'token') return i18ns.t('relay.quotaWindowUnitToken')
  return i18ns.t('relay.quotaWindowUnitAmount')
}

const formatQuotaWindowDurationPart = (value: number, unitLabel: string) => {
  if (value === 1) return unitLabel
  return `${value}${unitLabel}`
}

const formatQuotaWindowHours = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (normalized == null) return i18ns.t('relay.unlimited')

  const { months, days, hours, minutes } = splitQuotaWindowParts(normalized)
  const parts = [
    months > 0 ? formatQuotaWindowDurationPart(months, i18ns.t('monthlyPass.monthsUnit')) : '',
    days > 0 ? formatQuotaWindowDurationPart(days, i18ns.t('monthlyPass.daysUnit')) : '',
    hours > 0 ? formatQuotaWindowDurationPart(hours, i18ns.t('monthlyPass.hoursUnit')) : '',
    minutes > 0 || normalized === 0
      ? formatQuotaWindowDurationPart(minutes, i18ns.t('monthlyPass.minutesUnit'))
      : '',
  ].filter(Boolean)

  return parts.join(' ')
}

type QuotaWindowPreviewMode = (typeof QUOTA_WINDOW_PREVIEW_CYCLE)[number]

const getQuotaWindowPreviewKey = (quotaWindow: RelayTokenQuotaWindowLike, index: number) =>
  quotaWindow.id || `draft-${index}`

const getQuotaWindowPreviewMode = (
  quotaWindow: RelayTokenQuotaWindowLike,
  index: number,
): QuotaWindowPreviewMode => {
  const key = getQuotaWindowPreviewKey(quotaWindow, index)
  const modeIndex = quotaWindowPreviewModes.value[key] ?? 0
  return QUOTA_WINDOW_PREVIEW_CYCLE[modeIndex] ?? 'hour'
}

const toggleQuotaWindowPreviewMode = (quotaWindow: RelayTokenQuotaWindowLike, index: number) => {
  const key = getQuotaWindowPreviewKey(quotaWindow, index)
  const current = quotaWindowPreviewModes.value[key] ?? 0
  quotaWindowPreviewModes.value[key] = (current + 1) % QUOTA_WINDOW_PREVIEW_CYCLE.length
}

const formatQuotaWindowPeriodLabel = (hours: number, mode: QuotaWindowPreviewMode) => {
  switch (mode) {
    case 'hour':
      return i18ns.t('monthlyPass.hoursUnit')
    case 'actual':
      return formatQuotaWindowHours(hours)
    case 'day':
      return i18ns.t('monthlyPass.daysUnit')
    case 'week':
      return `7${i18ns.t('monthlyPass.daysUnit')}`
    case 'month':
      return i18ns.t('monthlyPass.monthsUnit')
    default:
      return formatQuotaWindowHours(hours)
  }
}

const formatQuotaWindowPreviewValue = (
  value: number,
  unit: string | undefined,
  divisor: number,
): string => {
  const normalizedValue = divisor > 0 ? value / divisor : 0
  if (isIntegerQuotaUnit(unit)) {
    return `${Math.round(normalizedValue)} ${formatQuotaWindowUnit(unit)}`
  }

  return `${round4(normalizedValue).toFixed(4)} ${i18ns.t('balance.yuan')}`
}

const formatQuotaWindowPreview = (quotaWindow: RelayTokenQuotaWindowLike, index: number) => {
  const normalizedHours = normalizeQuotaWindowHours(quotaWindow.quotaWindowHours)
  const normalizedLimit = Number(quotaWindow.quotaLimit)

  if (normalizedHours == null || !Number.isFinite(normalizedLimit)) {
    return formatQuotaWindowHours(quotaWindow.quotaWindowHours)
  }

  const mode = getQuotaWindowPreviewMode(quotaWindow, index)
  const periodHours =
    mode === 'hour'
      ? 1
      : mode === 'actual'
        ? normalizedHours
        : mode === 'day'
          ? 24
          : mode === 'week'
            ? 24 * 7
            : 24 * 30

  const divisor = normalizedHours > 0 ? normalizedHours / periodHours : 1

  return `${formatQuotaWindowPreviewValue(normalizedLimit, quotaWindow.quotaUnit, divisor)} / ${formatQuotaWindowPeriodLabel(normalizedHours, mode)}`
}

const formatQuotaWindowLimit = (value?: number | null, unit?: string) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  if (isIntegerQuotaUnit(unit)) return `${Math.floor(numeric)} ${formatQuotaWindowUnit(unit)}`
  return `${numeric.toFixed(4)} ${i18ns.t('balance.yuan')}`
}

const formatQuotaWindowValue = (value?: number | null, unit?: string) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'

  if (isIntegerQuotaUnit(unit)) {
    return `${Math.floor(Math.max(0, numeric)).toLocaleString('zh-CN')} ${formatQuotaWindowUnit(unit)}`
  }

  return `${Math.max(0, numeric).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })} ${i18ns.t('balance.yuan')}`
}

const formatQuotaWindowRule = (quotaWindow: RelayTokenQuotaWindowLike) => {
  return `${formatQuotaWindowLimit(quotaWindow.quotaLimit, quotaWindow.quotaUnit)} / ${formatQuotaWindowHours(quotaWindow.quotaWindowHours)}`
}

const formatQuotaWindowCompactSummary = (quotaWindow: RelayTokenQuotaWindowLike) => {
  return `${formatQuotaWindowValue(quotaWindow.usedQuota, quotaWindow.quotaUnit)} / ${formatQuotaWindowValue(quotaWindow.quotaLimit, quotaWindow.quotaUnit)} / ${formatQuotaWindowHours(quotaWindow.quotaWindowHours)}`
}

const formatQuotaAmount = (value?: number | null) =>
  `${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${i18ns.t('balance.yuan')}`

const formatRemainingQuota = (summary?: TokenQuotaSnapshot) =>
  summary?.remainingQuota != null
    ? formatQuotaAmount(summary.remainingQuota)
    : i18ns.t('relay.unlimited')

const formatQuotaPercent = (value?: number | null) => `${Number(value || 0).toFixed(1)}%`

const getQuotaProgressPercentage = (value?: number | null) =>
  Math.min(Math.max(Number(value || 0), 0), 100)

const getQuotaProgressStatus = (value?: number | null): 'success' | 'warning' | 'exception' => {
  const normalizedValue = Number(value || 0)
  if (normalizedValue >= 90) return 'exception'
  if (normalizedValue >= 70) return 'warning'
  return 'success'
}

const handleDelete = async (row: RelayTokenDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('relay.confirmDelete'), i18ns.t('warning'), {
      type: 'warning',
    })
    await relayTokenService.deleteRelayToken(row.id, currentTargetUserIdForRequest.value)
    invalidateAllTokensCache()
    ElMessage.success(i18ns.t('relay.deleteSuccess'))
    loadTokens()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('relay.deleteFailed'))
    }
  }
}

onMounted(() => {
  selectedTargetUserId.value = userInfoStore.userInfo.id || ''
  loadTokens()
  loadChannels()
  loadAvailableModels()
  void loadUserOptions()
})

watch(
  () => userInfoStore.userInfo.id,
  (userId) => {
    if (!userId) return
    if (!selectedTargetUserId.value) {
      selectedTargetUserId.value = userId
    }
    ensureUserOption(userId, userInfoStore.userInfo.username, userInfoStore.userInfo.name)
  },
  { immediate: true },
)
</script>

<style scoped lang="scss">
.relay-token-shell {
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color-overlay);
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.relay-token-shell:hover {
  border-color: var(--el-border-color);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.channel-warning-alert {
  margin-top: 12px;
}

.relay-token-management .card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.button-group {
  display: flex;
  gap: 10px;
  align-items: center;
}

.token-filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.token-filter-input {
  flex: 1 1 220px;
  min-width: 180px;
}

.token-filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.meta-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.token-table {
  width: 100%;
}

.token-table :deep(.token-table-header .cell) {
  text-align: center;
  justify-content: center;
}

.token-name {
  display: block;
  font-weight: 600;
  line-height: 1.4;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.token-table :deep(.token-name-column .cell) {
  white-space: normal;
  line-height: 1.4;
}

.token-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.token-pill {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(64, 158, 255, 0.08);
  color: var(--el-color-primary-dark-2);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.expire-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.datetime-text,
.stat-text {
  font-size: 13px;
}

.quota-text {
  font-weight: 600;
  color: var(--el-color-success);
}

.quota-text--danger {
  color: var(--el-color-danger);
}

.quota-limit-text {
  color: var(--el-text-color-secondary);
}

.quota-usage-cell,
.token-mobile-quota {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quota-usage-line,
.token-mobile-quota__primary,
.token-mobile-quota__secondary,
.quota-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}

.token-mobile-quota__primary,
.token-mobile-quota__secondary {
  justify-content: flex-start;
}

.quota-progress {
  width: 100%;
}

.token-mobile-field--quota {
  align-items: stretch;
}

.action-buttons {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
}

.action-buttons :deep(.el-button) {
  margin-left: 0 !important;
}

.action-buttons :deep(.el-dropdown) {
  display: inline-flex;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.pagination-wrapper :deep(.el-pagination) {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.form-label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.help-tooltip-trigger {
  color: var(--el-text-color-secondary);
  cursor: help;
  font-size: 14px;
  flex-shrink: 0;
}

.help-tooltip-trigger:hover {
  color: var(--el-color-primary);
}

.help-tooltip-content {
  max-width: 320px;
  font-size: 12px;
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
}

.relay-token-edit-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
}

.relay-token-edit-form .form-item-span-2 {
  grid-column: 1 / -1;
}

.relay-token-edit-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.relay-token-edit-form :deep(.el-form-item__content) {
  min-width: 0;
}

.relay-token-edit-form :deep(.el-input),
.relay-token-edit-form :deep(.el-input-number),
.relay-token-edit-form :deep(.el-select),
.relay-token-edit-form :deep(.el-date-editor) {
  width: 100%;
}

.relay-token-edit-dialog--desktop :deep(.el-drawer) {
  max-width: min(1120px, calc(100vw - 64px));
  border-radius: 22px 0 0 22px;
  overflow: hidden;
  border-left: 1px solid var(--el-border-color-light);
  box-shadow: -28px 0 80px rgba(15, 23, 42, 0.18);
}

.relay-token-edit-dialog--desktop :deep(.el-drawer__header) {
  padding: 20px 24px 16px;
  margin-bottom: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-fill-color-light) 72%, transparent),
    color-mix(in srgb, var(--el-bg-color-overlay) 96%, transparent)
  );
}

.relay-token-edit-dialog--desktop :deep(.el-drawer__title) {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.relay-token-edit-dialog--desktop :deep(.el-drawer__body) {
  padding: 22px 24px 16px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.relay-token-edit-dialog--desktop :deep(.el-drawer__footer) {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-fill-color-light) 44%, transparent);
}

.relay-token-edit-dialog--desktop :deep(.el-drawer__footer .el-button) {
  min-width: 108px;
}

.failover-risk-alert {
  margin-top: 10px;
}

.quota-window-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  align-items: center;
}

.quota-window-list--mobile {
  margin-top: 10px;
}

.quota-window-list__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.quota-window-inline {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-fill-color-light) 52%, transparent);
}

.quota-window-inline--mobile {
  width: 100%;
}

.quota-window-inline--danger {
  border-color: color-mix(in srgb, var(--el-color-danger) 35%, var(--el-border-color-lighter));
}

.quota-window-inline__progress {
  flex: 0 0 68px;
  min-width: 68px;
}

.quota-window-inline__summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.quota-window-inline--danger .quota-window-inline__summary {
  color: var(--el-color-danger);
}

.quota-window-inline__more {
  padding: 0;
  flex-shrink: 0;
  font-size: 12px;
}

.quota-window-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.6;
}

.quota-window-usage-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-fill-color-light) 44%, transparent);
}

.quota-window-usage-item--mobile {
  padding: 10px;
}

.quota-window-usage-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.quota-window-usage-item__percent {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.quota-window-usage-item__percent--danger {
  color: var(--el-color-danger);
}

.quota-window-usage-item__summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.quota-window-usage-item__summary--danger {
  color: var(--el-color-danger);
}

.quota-window-usage-item__progress {
  margin-top: 2px;
}

.quota-window-detail-drawer__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.quota-window-detail-drawer__token {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quota-window-detail-drawer__token-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.quota-window-detail-drawer__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.relay-token-edit-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
}

.relay-token-edit-sections :deep(.el-collapse) {
  border-top: none;
  border-bottom: none;
}

.relay-token-edit-sections :deep(.el-collapse-item) {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--el-bg-color-overlay) 94%, transparent);
}

.relay-token-edit-sections :deep(.el-collapse-item__header) {
  min-height: 54px;
  padding: 0 18px;
  border-bottom: none;
  background: color-mix(in srgb, var(--el-fill-color-light) 62%, transparent);
}

.relay-token-edit-sections :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.relay-token-edit-sections :deep(.el-collapse-item__content) {
  padding: 18px;
}

.relay-token-edit-sections__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.relay-token-edit-section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 16px;
}

.relay-token-edit-section-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ip-whitelist-tag-input {
  width: 100%;
}

.ip-whitelist-tag-input :deep(.el-input-tag__wrapper) {
  min-height: 80px;
  align-items: baseline;
  padding-top: 8px;
  padding-bottom: 8px;
}

.relay-token-edit-section-stack :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.quota-window-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-fill-color-blank);
}

.quota-window-editor--mobile {
  padding: 12px;
}

.quota-window-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.quota-window-editor__header-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.quota-window-editor__header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.quota-window-editor__header--mobile {
  flex-direction: column;
  align-items: stretch;
}

.quota-window-editor__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.quota-window-editor__toggle-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.quota-window-editor__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.quota-window-editor__summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.quota-window-editor__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.quota-window-editor__item {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-bg-color-page) 86%, transparent);
}

.quota-window-editor__item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.quota-window-editor__item-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.quota-window-editor__item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.quota-window-editor__item-meta {
  font-size: 12px;
  color: var(--el-color-primary);
  cursor: pointer;
}

.quota-window-editor__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.quota-window-editor__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.quota-window-editor__field--span-2 {
  grid-column: 1 / -1;
}

.quota-window-editor__field-label {
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.quota-window-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.quota-window-duration-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px dashed var(--el-border-color);
  background: color-mix(in srgb, var(--el-fill-color-light) 72%, transparent);
}

.quota-window-duration-card--mobile {
  padding: 10px;
}

.quota-window-picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.quota-window-picker {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.quota-window-picker__segment {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.quota-window-picker--desktop {
  flex: 1;
}

.quota-window-picker--mobile {
  width: 100%;
  justify-content: space-between;
}

.quota-window-input {
  width: 120px;
}

.quota-window-unit {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.quota-window-value {
  font-size: 12px;
  color: var(--el-color-primary);
  white-space: nowrap;
  cursor: pointer;
}

.quota-window-value--desktop {
  flex-shrink: 0;
}

.quota-window-value--mobile {
  white-space: normal;
}

.channel-config-list,
.failover-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.channel-config-meta {
  gap: 4px;
}

.channel-tooltip-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 320px;
}

.failover-summary-compact {
  cursor: default;
}

.failover-tooltip-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 280px;
  line-height: 1.5;
}

.channel-config-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.channel-success-rate,
.summary-line {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.channel-config-more {
  align-self: flex-start;
}

.stat-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.stat-summary__item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}

.stat-summary__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stat-summary__value {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.channel-config-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-fill-color-light) 68%, transparent),
    color-mix(in srgb, var(--el-bg-color-overlay) 98%, transparent)
  );
}

.channel-config-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.channel-config-toolbar--mobile {
  align-items: stretch;
}

.channel-config-toolbar__summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.channel-config-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.channel-config-toolbar__actions--mobile {
  justify-content: flex-start;
}

.channel-config-toolbar__batch-select {
  min-width: min(320px, 100%);
  flex: 1 1 260px;
}

.channel-config-row {
  display: grid;
  grid-template-columns: 32px 28px 72px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  transition: background-color 0.2s;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--el-bg-color-overlay) 90%, transparent);
}

.channel-config-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: var(--el-text-color-secondary);
  font-size: 16px;
  user-select: none;
}

.channel-config-drag-handle:active {
  cursor: grabbing;
}

.channel-config-drag-handle:hover {
  color: var(--el-text-color-primary);
}

.channel-config-order {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.channel-config-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
}

.channel-config-select {
  width: 100%;
}

.channel-config-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
  white-space: nowrap;
}

.channel-config-actions :deep(.el-button) {
  margin-left: 0 !important;
}

/* Sortable drag states */
.sortable-ghost {
  opacity: 0.4;
  background: var(--el-fill-color-light);
}

.sortable-chosen {
  background: color-mix(in srgb, var(--el-color-primary-light-9) 58%, var(--el-bg-color-overlay));
  border-color: color-mix(in srgb, var(--el-color-primary-light-5) 65%, transparent);
}

.sortable-drag {
  opacity: 1;
  background: var(--el-bg-color);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.failover-config-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-fill-color-light) 68%, transparent),
    color-mix(in srgb, var(--el-bg-color-overlay) 98%, transparent)
  );
}

.failover-config-editor.is-disabled {
  opacity: 0.9;
}

.failover-overview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 2px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.failover-overview__content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.failover-overview__headline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.failover-overview__status {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.failover-metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.failover-metric-card,
.failover-rule-block {
  border-radius: 14px;
  border: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 92%, transparent);
}

.failover-metric-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.failover-metric-card__header,
.failover-rule-block__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.failover-metric-card__title,
.failover-rule-block__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.failover-rule-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.failover-switch-text,
.failover-input-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.failover-input {
  width: 100%;
}

.failover-status-select {
  width: 100%;
}

.switch-log-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
/* 弃用下拉项 */
.deprecated-tag {
  margin-left: 4px;
  vertical-align: middle;
  font-size: 10px;
}
</style>

<style scoped>
.relay-token-mobile {
  padding: 10px 6px 18px;
}

.relay-token-mobile :deep(.el-card__header) {
  padding: 12px 14px;
}

.relay-token-mobile :deep(.el-card__body) {
  padding: 12px;
}

.relay-token-mobile .card-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.relay-token-mobile .button-group {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.relay-token-mobile .button-group .el-button {
  width: 100%;
  margin-left: 0 !important;
}

.relay-token-mobile .token-filter-bar {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.relay-token-mobile .token-filter-actions,
.relay-token-mobile .token-filter-actions--mobile {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.relay-token-mobile .token-filter-actions .el-button,
.relay-token-mobile .token-filter-actions--mobile .el-button {
  width: 100%;
  margin-left: 0 !important;
}

.token-mobile-action-item :deep(.el-dropdown),
.token-mobile-action-item :deep(.el-dropdown .el-button) {
  width: 100%;
}

.relay-token-mobile .token-list {
  gap: 10px;
}

.relay-token-mobile .pagination-wrapper {
  justify-content: center;
  margin-top: 14px;
}

.relay-token-mobile .pagination-wrapper :deep(.el-pagination) {
  justify-content: center;
}

.relay-token-mobile .token-mobile-card {
  border: 1px solid var(--el-border-color-light);
}

.relay-token-mobile .token-mobile-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.relay-token-mobile .token-mobile-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.relay-token-mobile .token-link-mobile {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  align-self: flex-start;
  max-width: 100%;
  width: 100%;
  min-height: 24px;
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  word-break: break-all;
}

.relay-token-mobile .token-mobile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.relay-token-mobile .token-mobile-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.relay-token-mobile .token-mobile-field.full {
  grid-column: 1 / -1;
}

.relay-token-mobile .token-mobile-field .label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.relay-token-mobile .token-mobile-field .value {
  color: var(--el-text-color-primary);
  font-size: 13px;
  word-break: break-word;
  line-height: 1.5;
}

.relay-token-mobile .token-mobile-token-content {
  display: flex;
  align-items: flex-start;
  min-width: 0;
}

.relay-token-mobile .token-mobile-token-content .token-link-mobile {
  flex: 1;
}

.relay-token-mobile .token-mobile-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.relay-token-mobile .token-mobile-action-item {
  min-width: 0;
}

.relay-token-mobile .token-mobile-action-item:empty {
  display: none;
}

.relay-token-mobile .token-mobile-action-item :deep(.el-button) {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-left: 0 !important;
  min-height: 38px;
  border-radius: 8px;
}

.relay-token-mobile .mobile-channel-config-row {
  display: grid;
  grid-template-columns: 32px 28px 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-fill-color-light) 88%, transparent);
}

.relay-token-mobile .mobile-channel-config-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.relay-token-mobile .mobile-channel-config-actions :deep(.el-button) {
  min-width: 0;
  margin-left: 0 !important;
}

.relay-token-mobile .mobile-channel-config-row .channel-config-order,
.relay-token-mobile .mobile-channel-config-row .channel-config-select {
  min-width: 0;
}

.relay-token-mobile .mobile-failover-config-editor {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-fill-color-light) 88%, transparent);
}

.relay-token-mobile .relay-token-edit-section-stack--mobile {
  gap: 12px;
}

.relay-token-mobile .quota-window-editor__item--mobile {
  padding: 12px;
}

.relay-token-mobile .quota-window-editor__fields--mobile {
  grid-template-columns: 1fr;
}

.relay-token-mobile .quota-window-picker--mobile {
  flex-direction: column;
  align-items: stretch;
}

.relay-token-mobile .quota-window-picker__segment {
  width: 100%;
  justify-content: space-between;
}

.relay-token-mobile .quota-window-input {
  flex: 1;
  width: auto;
}

.relay-token-mobile .quota-window-value--mobile {
  margin-top: 0;
}

.relay-token-mobile .summary-panel {
  margin-bottom: 16px;
}

.relay-token-mobile :deep(.el-drawer) {
  width: 100% !important;
  max-width: 100% !important;
  height: 100% !important;
  border-radius: 20px 20px 0 0;
  overflow: hidden;
  border-top: 1px solid var(--el-border-color);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-bg-color-overlay) 92%, transparent),
    color-mix(in srgb, var(--el-bg-color) 96%, transparent)
  );
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
}

.relay-token-mobile :deep(.el-drawer__header),
.relay-token-mobile :deep(.el-drawer__body),
.relay-token-mobile :deep(.el-drawer__footer) {
  background: transparent;
}

.relay-token-mobile :deep(.el-drawer__header) {
  margin-bottom: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.relay-token-mobile :deep(.el-drawer__footer) {
  border-top: 1px solid var(--el-border-color-lighter);
}

.relay-token-mobile :deep(.el-drawer__body) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 12px;
}

.relay-token-mobile :deep(.el-form-item__content) {
  min-width: 0;
}

.relay-token-mobile :deep(.el-drawer__footer) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.relay-token-mobile :deep(.el-drawer__footer .el-button) {
  width: 100%;
  margin-left: 0 !important;
}

.relay-token-mobile :deep(.el-date-editor),
.relay-token-mobile :deep(.el-select),
.relay-token-mobile :deep(.el-input),
.relay-token-mobile :deep(.el-input-number) {
  width: 100% !important;
}

/* touch-friendly button spacing */
.relay-token-mobile :deep(.el-table .el-button),
.relay-token-mobile :deep(.el-drawer .el-button),
.relay-token-mobile :deep(.el-card .el-button) {
  min-height: 36px;
  border-radius: 8px;
}

.relay-token-mobile :deep(.el-table .el-button + .el-button),
.relay-token-mobile :deep(.el-drawer__footer .el-button + .el-button),
.relay-token-mobile :deep(.el-card .el-button + .el-button) {
  margin-left: 8px !important;
}

.relay-token-mobile :deep(.el-button.is-link) {
  min-width: 34px;
  min-height: 34px;
  padding: 6px !important;
}

.relay-token-mobile :deep(.el-button.is-circle),
.relay-token-mobile :deep(.el-button.is-round) {
  min-width: 36px;
  min-height: 36px;
}

.switch-log-dialog :deep(.el-dialog) {
  max-width: min(860px, calc(100vw - 24px));
}

.switch-log-dialog :deep(.el-dialog__body) {
  overflow-x: auto;
}

@media (max-width: 768px) {
  .relay-token-edit-form {
    display: block;
  }

  .relay-token-edit-sections :deep(.el-collapse-item__header) {
    padding: 0 14px;
  }

  .relay-token-edit-sections :deep(.el-collapse-item__content) {
    padding: 14px;
  }

  .relay-token-edit-section-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .quota-window-editor__grid {
    grid-template-columns: 1fr;
  }

  .quota-window-editor__fields {
    grid-template-columns: 1fr;
  }

  .quota-window-picker-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .quota-window-input {
    width: 100%;
    min-width: 120px;
  }

  .quota-window-picker,
  .quota-window-picker__segment {
    width: 100%;
  }

  .quota-window-picker__segment {
    justify-content: space-between;
  }

  .quota-window-value--desktop {
    width: 100%;
    white-space: normal;
  }

  .failover-overview,
  .relay-token-mobile .mobile-failover-config-editor .failover-overview {
    align-items: flex-start;
    flex-direction: column;
  }

  .failover-metric-grid {
    grid-template-columns: 1fr;
  }

  .relay-token-mobile {
    padding-inline: 2px;
  }

  .relay-token-mobile .item-head {
    flex-direction: column;
  }

  .relay-token-mobile .mobile-channel-config-row {
    grid-template-columns: 32px minmax(0, 1fr) auto;
    grid-template-areas:
      'drag order actions'
      'drag select actions';
    gap: 8px;
  }

  .relay-token-mobile .mobile-channel-config-row .channel-config-drag-handle {
    grid-area: drag;
    align-self: stretch;
  }

  .relay-token-mobile .mobile-channel-config-row .channel-config-order {
    grid-area: order;
  }

  .relay-token-mobile .mobile-channel-config-row .channel-config-select {
    grid-area: select;
    width: 100%;
  }

  .relay-token-mobile .mobile-channel-config-row .mobile-channel-config-actions {
    grid-area: actions;
    align-self: center;
  }

  .relay-token-mobile .button-group,
  .relay-token-mobile .token-filter-actions,
  .relay-token-mobile .token-filter-actions--mobile,
  .relay-token-mobile :deep(.el-drawer__footer) {
    grid-template-columns: 1fr;
  }
}
</style>
