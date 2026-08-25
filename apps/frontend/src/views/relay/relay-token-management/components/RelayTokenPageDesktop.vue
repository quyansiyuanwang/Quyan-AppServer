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
                  <PermissionWrapper :require="[Permission.RELAY_TOKEN_UPDATE]">
                    <el-dropdown-item command="content-safety-apply">
                      {{ i18ns.t('relay.batchApplyContentSafety') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="content-safety-clear">
                      {{ i18ns.t('relay.batchClearContentSafety') }}
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
            <el-popover placement="bottom-end" :width="340" trigger="click">
              <template #reference>
                <el-button plain class="token-column-settings-trigger">
                  {{ i18ns.t('relay.columnSettings') }}
                </el-button>
              </template>
              <div class="token-column-settings">
                <div class="token-column-settings__header">
                  <div>
                    <div class="token-column-settings__title">
                      {{ i18ns.t('relay.columnSettingsTitle') }}
                    </div>
                    <div class="token-column-settings__hint">
                      {{ i18ns.t('relay.columnSettingsHint') }}
                    </div>
                  </div>
                  <el-button text @click="state.resetTokenColumnSettings">
                    {{ i18ns.t('relay.columnSettingsReset') }}
                  </el-button>
                </div>
                <div class="token-column-settings__list">
                  <div
                    v-for="(columnKey, index) in tokenColumnOrder"
                    :key="columnKey"
                    class="token-column-settings__item"
                  >
                    <el-checkbox
                      :model-value="tokenColumnVisibility[columnKey]"
                      @change="
                        (value: string | number | boolean) =>
                          state.setTokenColumnVisibility(columnKey, Boolean(value))
                      "
                    >
                      {{ getTokenColumnLabel(columnKey) }}
                    </el-checkbox>
                    <div class="token-column-settings__sort-actions">
                      <el-button
                        text
                        circle
                        size="small"
                        :disabled="index === 0"
                        :title="i18ns.t('relay.columnSettingsMoveUp')"
                        @click="state.moveTokenColumn(columnKey, -1)"
                      >
                        ↑
                      </el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        :disabled="index === tokenColumnOrder.length - 1"
                        :title="i18ns.t('relay.columnSettingsMoveDown')"
                        @click="state.moveTokenColumn(columnKey, 1)"
                      >
                        ↓
                      </el-button>
                    </div>
                  </div>
                </div>
              </div>
            </el-popover>
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
        :key="visibleTokenColumns.join('|')"
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
          v-for="columnKey in visibleTokenColumns"
          :key="'token-column-' + columnKey"
          :label="getTokenColumnLabel(columnKey)"
          :min-width="getTokenColumnMinWidth(columnKey)"
          :align="getTokenColumnAlign(columnKey)"
          :class-name="columnKey === 'name' ? 'token-name-column' : undefined"
        >
          <template #default="{ row }">
            <template v-if="columnKey === 'name'">
              <span class="token-name">{{ row.name || i18ns.t('relay.unnamedToken') }}</span>
            </template>
            <template v-else-if="columnKey === 'token'">
              <div class="token-cell">
                <el-link type="primary" class="token-link" @click="state.copyToken(row.token)">
                  {{ row.token.substring(0, 12) }}...{{ row.token.slice(-4) }}
                </el-link>
              </div>
            </template>
            <template v-else-if="columnKey === 'routing'">
              <el-tooltip placement="top" effect="light" :show-after="180">
                <template #content>
                  <div>{{ state.formatChannelSummary(row) }}</div>
                  <div>{{ state.formatMobileChannelMeta(row) }}</div>
                </template>
                <div class="channel-config-list">
                  <el-tag
                    v-if="row.hasInvalidOrderedChannels"
                    size="small"
                    type="warning"
                    effect="plain"
                  >
                    {{ i18ns.t('relay.invalidOrderedAutomaticPool') }}
                  </el-tag>
                  <template v-else-if="state.isAutomaticPoolToken(row)">
                    <el-tag size="small" type="success" effect="plain">
                      {{ state.getAutomaticProxyPoolChannelName(row) }}
                    </el-tag>
                    <div class="summary-line channel-config-meta">
                      {{ i18ns.t('relay.routingModeAutomaticPool') }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      v-if="state.getSortedChannelConfigs(row).length"
                      class="channel-config-list"
                    >
                      <div
                        v-for="config in state.getVisibleChannelConfigs(row)"
                        :key="row.id + '-' + config.channelId + '-' + config.priority"
                        class="channel-config-item"
                      >
                        <el-tag
                          size="small"
                          :type="config.priority === 0 ? 'success' : 'info'"
                          effect="plain"
                        >
                          {{
                            '#' +
                            (config.priority + 1) +
                            ' ' +
                            (config.channelName || state.getChannelName(config.channelId))
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
                  </template>
                </div>
              </el-tooltip>
            </template>
            <template v-else-if="columnKey === 'stats'">
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
            <template v-else-if="columnKey === 'expires'">
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
            <template v-else-if="columnKey === 'quota'">
              <div class="quota-usage-cell">
                <div class="quota-usage-line">
                  <span
                    class="quota-text"
                    :class="{
                      'quota-text--danger': state.getTokenQuotaSnapshot(row).isQuotaExceeded,
                    }"
                  >
                    {{ i18ns.t('relay.usedQuota') }}:
                    {{ state.formatQuotaAmount(state.getTokenQuotaSnapshot(row).usedQuota) }}
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
                  <span v-if="state.getTokenQuotaSnapshot(row).quotaUsagePercent != null">{{
                    state.formatQuotaPercent(state.getTokenQuotaSnapshot(row).quotaUsagePercent)
                  }}</span>
                </div>
                <el-progress
                  v-if="state.getTokenQuotaSnapshot(row).quotaUsagePercent != null"
                  :percentage="
                    state.getQuotaProgressPercentage(
                      state.getTokenQuotaSnapshot(row).quotaUsagePercent,
                    )
                  "
                  :status="
                    state.getQuotaProgressStatus(state.getTokenQuotaSnapshot(row).quotaUsagePercent)
                  "
                  :stroke-width="8"
                  :show-text="false"
                  class="quota-progress"
                />
                <div v-if="state.getRelayTokenQuotaWindows(row).length" class="quota-window-list">
                  <div
                    v-for="(
                      quotaWindow, quotaWindowIndex
                    ) in state.getPrimaryRelayTokenQuotaWindows(row)"
                    :key="row.id + '-quota-window-' + quotaWindowIndex"
                    class="quota-window-inline"
                    :class="{ 'quota-window-inline--danger': quotaWindow.isQuotaExceeded }"
                  >
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
                </div>
              </div>
            </template>
            <template v-else-if="columnKey === 'status'">
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
            <template v-else-if="columnKey === 'id'">
              <span class="token-column-truncate" :title="row.id">{{ row.id }}</span>
            </template>
            <template v-else-if="columnKey === 'owner'">
              <span class="token-column-truncate">{{ row.ownerName || row.username || '-' }}</span>
            </template>
            <template v-else-if="columnKey === 'balance'">
              {{ state.formatQuotaAmount(row.balance || 0) }}
            </template>
            <template v-else-if="columnKey === 'createdAt'">
              {{ state.formatDateTime(row.createTime) }}
            </template>
            <template v-else-if="columnKey === 'lastUsedAt'">
              {{
                row.lastUsedAt ? state.formatDateTime(row.lastUsedAt) : i18ns.t('relay.neverUsed')
              }}
            </template>
            <template v-else-if="columnKey === 'allowedModels'">
              <span class="token-column-truncate" :title="row.allowedModels || undefined">{{
                row.allowedModels || i18ns.t('relay.allModels')
              }}</span>
            </template>
            <template v-else-if="columnKey === 'ipWhitelist'">
              <span class="token-column-truncate" :title="row.ipWhitelist || undefined">{{
                row.ipWhitelist || '-'
              }}</span>
            </template>
            <template v-else-if="columnKey === 'modelMapping'">
              <span class="token-column-truncate">{{ state.formatModelMapping(row) }}</span>
            </template>
            <template v-else-if="columnKey === 'requestFormats'">
              <span class="token-column-truncate">{{
                state.formatRequestFormatTransforms(row)
              }}</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column
          v-if="false"
          prop="name"
          :label="i18ns.t('relay.tokenName')"
          min-width="100"
          class-name="token-name-column"
        >
          <template #default="{ row }">
            <span class="token-name">{{ row.name || i18ns.t('relay.unnamedToken') }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="false" :label="i18ns.t('relay.token')" min-width="180">
          <template #default="{ row }">
            <div class="token-cell">
              <el-link type="primary" class="token-link" @click="state.copyToken(row.token)">
                {{ row.token.substring(0, 12) }}...{{ row.token.slice(-4) }}
              </el-link>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="false" :label="i18ns.t('relay.routingMode')" min-width="180">
          <template #default="{ row }">
            <el-tooltip
              v-if="state.isAutomaticPoolToken(row)"
              placement="top"
              effect="light"
              :show-after="180"
            >
              <template #content>
                {{ i18ns.t('relay.automaticProxyPoolChannel') }}:
                {{ state.getAutomaticProxyPoolChannelName(row) }}
              </template>
              <div class="channel-config-list">
                <el-tag size="small" type="success" effect="plain">
                  {{ state.getAutomaticProxyPoolChannelName(row) }}
                </el-tag>
                <div class="summary-line channel-config-meta">
                  {{ i18ns.t('relay.routingModeAutomaticPool') }}
                </div>
              </div>
            </el-tooltip>
            <el-tooltip v-else placement="top" effect="light" :show-after="180">
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
                    <div v-if="row.failoverConfig?.maxAcceptedChannelMultiplier != null">
                      {{ i18ns.t('relay.maxAcceptedChannelMultiplier') }}:
                      {{ row.failoverConfig.maxAcceptedChannelMultiplier }}x
                    </div>
                  </div>
                </div>
              </template>
              <div class="channel-config-list">
                <el-tag
                  v-if="row.hasInvalidOrderedChannels"
                  size="small"
                  type="warning"
                  effect="plain"
                >
                  {{ i18ns.t('relay.invalidOrderedAutomaticPool') }}
                </el-tag>
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
          v-if="false"
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
        <el-table-column v-if="false" :label="i18ns.t('relay.expiresAt')" align="center">
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
        <el-table-column
          v-if="false"
          :label="i18ns.t('relay.quotaUsage')"
          min-width="220"
          align="center"
        >
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
        <el-table-column v-if="false" :label="i18ns.t('status')" width="90" align="center">
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
                      v-for="(format, index) in state.getCcswitchLaunchFormats(row)"
                      :key="`desktop-ccswitch-${row.id}-${format}`"
                      :command="`launch-ccswitch-${format}`"
                      :divided="index === 0"
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
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import { useRelayTokenManagementContext } from '../context'
import type { RelayTokenColumnKey } from '../useRelayTokenManagement'

const state = useRelayTokenManagementContext()

const tokenColumnLabelKeys: Record<RelayTokenColumnKey, I18nENAvailableKeys> = {
  name: 'relay.tokenName',
  token: 'relay.token',
  routing: 'relay.routingMode',
  stats: 'relay.tokenStatsColumn',
  expires: 'relay.expiresAt',
  quota: 'relay.quotaUsage',
  status: 'status',
  id: 'relay.tokenIdColumn',
  owner: 'relay.ownerColumn',
  balance: 'relay.balanceColumn',
  createdAt: 'relay.createdAtColumn',
  lastUsedAt: 'relay.lastUsedAtColumn',
  allowedModels: 'relay.allowedModelsColumn',
  ipWhitelist: 'relay.ipWhitelistColumn',
  modelMapping: 'relay.modelMappingColumn',
  requestFormats: 'relay.requestFormatsColumn',
}

const getTokenColumnLabel = (columnKey: RelayTokenColumnKey) =>
  i18ns.t(tokenColumnLabelKeys[columnKey])

const tokenColumnMinWidths: Record<RelayTokenColumnKey, number> = {
  name: 120,
  token: 180,
  routing: 180,
  stats: 150,
  expires: 150,
  quota: 220,
  status: 90,
  id: 180,
  owner: 140,
  balance: 110,
  createdAt: 160,
  lastUsedAt: 160,
  allowedModels: 180,
  ipWhitelist: 160,
  modelMapping: 180,
  requestFormats: 210,
}

const getTokenColumnMinWidth = (columnKey: RelayTokenColumnKey) => tokenColumnMinWidths[columnKey]

const getTokenColumnAlign = (columnKey: RelayTokenColumnKey) =>
  ['stats', 'expires', 'quota', 'status', 'balance', 'createdAt', 'lastUsedAt'].includes(columnKey)
    ? 'center'
    : undefined

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
  tokenColumnOrder,
  tokenColumnVisibility,
  visibleTokenColumns,
  tokens,
  canManageAllTokens,
  paginationTotal,
  showPagination,
} = state
</script>
