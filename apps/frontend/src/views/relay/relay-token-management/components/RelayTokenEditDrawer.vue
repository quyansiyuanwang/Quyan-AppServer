<template>
  <el-drawer
    v-model="showEditDialog"
    :title="editMode === 'create' ? i18ns.t('relay.createToken') : i18ns.t('relay.editToken')"
    :direction="isDesktop ? 'rtl' : 'btt'"
    :size="isDesktop ? 'min(1120px, calc(100vw - 64px))' : '100%'"
    class="relay-token-dialog relay-token-edit-dialog"
    :class="isDesktop ? 'relay-token-edit-dialog--desktop' : 'relay-token-edit-dialog--mobile'"
  >
    <div :class="isDesktop ? '' : 'relay-token-mobile'">
      <el-form
        :model="editForm"
        :label-width="isDesktop ? '124px' : undefined"
        :label-position="isDesktop ? 'right' : 'top'"
        :class="isDesktop ? 'relay-token-edit-form' : ''"
      >
        <el-collapse v-model="editDialogSectionNames" class="relay-token-edit-sections">
          <el-collapse-item name="basic">
            <template #title>
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('relay.basicSettings')
              }}</span>
            </template>
            <div
              :class="
                isDesktop
                  ? 'relay-token-edit-section-grid'
                  : 'relay-token-edit-section-stack relay-token-edit-section-stack--mobile'
              "
            >
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
                        <div class="help-tooltip-content">{{ i18ns.t('relay.expiresAtHelp') }}</div>
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
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('relay.channelFailoverSettings')
              }}</span>
            </template>
            <div
              :class="
                isDesktop
                  ? 'relay-token-edit-section-grid'
                  : 'relay-token-edit-section-stack relay-token-edit-section-stack--mobile'
              "
            >
              <el-form-item required :class="isDesktop ? 'form-item-span-2' : undefined">
                <template #label>{{ i18ns.t('relay.routingMode') }}</template>
                <el-radio-group v-model="editForm.routingMode">
                  <el-radio value="ordered">{{ i18ns.t('relay.routingModeOrdered') }}</el-radio>
                  <el-radio value="automatic-pool">{{
                    i18ns.t('relay.routingModeAutomaticPool')
                  }}</el-radio>
                </el-radio-group>
              </el-form-item>

              <el-form-item
                v-if="editForm.routingMode === 'automatic-pool'"
                required
                :class="isDesktop ? 'form-item-span-2' : undefined"
              >
                <template #label>{{ i18ns.t('relay.automaticProxyPoolChannel') }}</template>
                <el-select
                  v-model="editForm.automaticProxyPoolChannelId"
                  filterable
                  style="width: 100%"
                  :placeholder="i18ns.t('relay.automaticProxyPoolChannelPlaceholder')"
                >
                  <el-option
                    v-for="channel in automaticProxyPoolChannelOptions"
                    :key="channel.id"
                    :label="state.getChannelOptionLabel(channel)"
                    :value="channel.id"
                  />
                </el-select>
              </el-form-item>

              <el-form-item
                v-if="editForm.routingMode === 'automatic-pool'"
                :class="isDesktop ? 'form-item-span-2' : undefined"
              >
                <template #label>
                  <span class="form-label-with-help">
                    <span>{{ i18ns.t('relay.blockedAutomaticPoolChannels') }}</span>
                    <el-tooltip placement="top">
                      <template #content>
                        <div class="help-tooltip-content">
                          {{ i18ns.t('relay.blockedAutomaticPoolChannelsHelp') }}
                        </div>
                      </template>
                      <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </span>
                </template>
                <el-select
                  v-model="editForm.blockedAutomaticProxyPoolChannelIds"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  filterable
                  style="width: 100%"
                  class="blocked-automatic-pool-channel-select"
                  :disabled="!editForm.automaticProxyPoolChannelId"
                  :placeholder="i18ns.t('relay.blockedAutomaticPoolChannelsPlaceholder')"
                >
                  <el-option
                    v-for="member in selectedAutomaticProxyPoolMemberOptions"
                    :key="member.id"
                    :label="member.name"
                    :value="member.id"
                    :disabled="!member.enabled"
                  />
                </el-select>
              </el-form-item>

              <el-form-item
                v-if="editForm.routingMode === 'automatic-pool'"
                :class="isDesktop ? 'form-item-span-2' : undefined"
              >
                <template #label>
                  <span class="form-label-with-help">
                    <span>{{ i18ns.t('relay.maxAcceptedChannelMultiplier') }}</span>
                    <el-tooltip placement="top">
                      <template #content>
                        <div class="help-tooltip-content">
                          {{ i18ns.t('relay.maxAcceptedChannelMultiplierHelp') }}
                        </div>
                      </template>
                      <el-icon class="help-tooltip-trigger"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </span>
                </template>
                <el-input-number
                  v-model="editForm.failoverConfig.maxAcceptedChannelMultiplier"
                  :min="0.01"
                  :max="100"
                  :step="0.000001"
                  :precision="6"
                  clearable
                  controls-position="right"
                  style="width: 100%"
                />
              </el-form-item>

              <el-form-item
                v-if="editForm.routingMode === 'ordered'"
                required
                :class="isDesktop ? 'form-item-span-2' : undefined"
              >
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
                  :ref="setChannelListRef"
                  class="channel-config-editor"
                  :class="isDesktop ? '' : 'mobile-channel-config-editor'"
                >
                  <div
                    class="channel-config-toolbar"
                    :class="isDesktop ? '' : 'channel-config-toolbar--mobile'"
                  >
                    <div class="channel-config-toolbar__summary">
                      {{
                        i18ns.t('relay.tokenChannelSelectedConfigs', {
                          count: selectedChannelConfigs.length,
                        })
                      }}
                    </div>
                    <div class="channel-config-toolbar__selection-actions">
                      <el-button
                        link
                        type="primary"
                        @click="state.toggleAllChannelConfigSelections"
                      >
                        {{
                          isAllChannelConfigsSelected
                            ? i18ns.t('relay.clearChannelSelection')
                            : i18ns.t('relay.selectAllChannels')
                        }}
                      </el-button>
                    </div>
                  </div>

                  <div class="channel-config-toolbar__actions">
                    <el-button
                      plain
                      type="primary"
                      :icon="Plus"
                      :disabled="channelLimitReached"
                      class="channel-config-toolbar__batch-add-button"
                      @click="openTokenChannelBatchAddDialog"
                    >
                      {{ i18ns.t('relay.tokenChannelBatchAdd') }}
                    </el-button>
                    <el-button plain @click="state.handleCopyTokenChannelConfigs">{{
                      i18ns.t('copy')
                    }}</el-button>
                    <el-button plain @click="state.handleExportTokenChannelConfigs">{{
                      i18ns.t('relay.exportChannels')
                    }}</el-button>
                    <el-button plain @click="state.openTokenChannelImportDialog">{{
                      i18ns.t('relay.importChannels')
                    }}</el-button>
                    <el-button
                      plain
                      type="danger"
                      :disabled="!state.hasSelectedChannelConfigs"
                      @click="state.handleBatchRemoveTokenChannelConfigs"
                    >
                      {{ i18ns.t('relay.tokenChannelBatchRemove') }}
                    </el-button>
                  </div>

                  <el-checkbox-group
                    v-model="selectedChannelConfigKeys"
                    class="channel-config-checkbox-group"
                  >
                    <div
                      v-for="(config, index) in editForm.channelConfigs"
                      :key="config.tempKey"
                      class="channel-config-row"
                      :class="isDesktop ? '' : 'mobile-channel-config-row'"
                      :data-index="index"
                    >
                      <div class="channel-config-drag-handle">
                        <el-icon><Rank /></el-icon>
                      </div>
                      <div class="channel-config-checkbox">
                        <el-checkbox :value="config.tempKey" />
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
                          v-for="ch in state.getAvailableChannelOptions(config.channelId)"
                          :key="ch.id"
                          :label="state.getChannelOptionLabel(ch)"
                          :value="ch.id"
                        />
                      </el-select>
                      <div
                        class="channel-config-actions"
                        :class="isDesktop ? '' : 'mobile-channel-config-actions'"
                      >
                        <el-tooltip :content="i18ns.t('delete')" placement="top">
                          <el-button
                            plain
                            circle
                            size="small"
                            type="danger"
                            :icon="Delete"
                            :disabled="editForm.channelConfigs.length === 1"
                            @click="state.removeChannelConfig(index)"
                          />
                        </el-tooltip>
                      </div>
                    </div>
                  </el-checkbox-group>
                  <el-button
                    plain
                    type="primary"
                    :disabled="channelLimitReached"
                    @click="state.addChannelConfig"
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

              <el-form-item
                v-if="editForm.routingMode === 'ordered'"
                :class="isDesktop ? 'form-item-span-2' : undefined"
              >
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
                  :class="[
                    { 'is-disabled': !editForm.failoverConfig.enabled },
                    isDesktop ? '' : 'mobile-failover-config-editor',
                  ]"
                >
                  <div class="failover-overview">
                    <div class="failover-overview__content">
                      <div class="failover-overview__headline">
                        <span class="failover-overview__status">
                          {{
                            editForm.failoverConfig.enabled
                              ? i18ns.t('relay.failoverEnabled')
                              : i18ns.t('relay.failoverDisabled')
                          }}
                        </span>
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
                        :max="100"
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
                        :max="100"
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
                        :max="525600"
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
                              <div>
                                {{
                                  i18ns.t(
                                    isDesktop
                                      ? 'relay.retryStatusCodesHelpIntro'
                                      : 'relay.retryStatusCodesHelpMobile',
                                  )
                                }}
                              </div>
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
                        v-for="code in state.retryStatusCodeOptions"
                        :key="code"
                        :label="state.formatRetryStatusCodeOptionLabel(code)"
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
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('relay.quotaSettings')
              }}</span>
            </template>
            <div
              :class="
                isDesktop
                  ? 'relay-token-edit-section-grid'
                  : 'relay-token-edit-section-stack relay-token-edit-section-stack--mobile'
              "
            >
              <el-form-item :class="isDesktop ? '' : undefined">
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
                  @blur="editForm.quotaLimit = state.normalizeQuotaLimitInput(editForm.quotaLimit)"
                />
              </el-form-item>

              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
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
                <div
                  class="quota-window-editor"
                  :class="isDesktop ? '' : 'quota-window-editor--mobile'"
                >
                  <div
                    class="quota-window-editor__header"
                    :class="isDesktop ? '' : 'quota-window-editor__header--mobile'"
                  >
                    <div class="quota-window-editor__header-content">
                      <div class="quota-window-editor__title">
                        {{ i18ns.t('relay.quotaWindows') }}
                      </div>
                      <div class="quota-window-editor__summary">
                        {{
                          !editForm.quotaWindowsEnabled
                            ? i18ns.t('relay.quotaWindowsDisabled')
                            : editForm.quotaWindows.length
                              ? `${editForm.quotaWindows.length} / ${state.MAX_QUOTA_WINDOWS}`
                              : i18ns.t('relay.quotaWindowsEmpty')
                        }}
                      </div>
                    </div>
                    <div class="quota-window-editor__header-actions">
                      <div class="quota-window-editor__toggle">
                        <span class="quota-window-editor__toggle-label">{{
                          i18ns.t('relay.quotaWindowsToggle')
                        }}</span>
                        <el-switch
                          :model-value="editForm.quotaWindowsEnabled"
                          :disabled="saving"
                          @update:model-value="state.handleQuotaWindowsToggleChange"
                        />
                      </div>
                      <el-button
                        plain
                        type="primary"
                        :size="isDesktop ? undefined : 'small'"
                        :disabled="
                          saving ||
                          !editForm.quotaWindowsEnabled ||
                          editForm.quotaWindows.length >= state.MAX_QUOTA_WINDOWS
                        "
                        @click="state.addQuotaWindow"
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
                      :key="`${isDesktop ? 'desktop' : 'mobile'}-quota-window-${index}`"
                      class="quota-window-editor__item"
                      :class="isDesktop ? '' : 'quota-window-editor__item--mobile'"
                    >
                      <div class="quota-window-editor__item-head">
                        <div class="quota-window-editor__item-heading">
                          <span class="quota-window-editor__item-title">{{
                            i18ns.t('relay.quotaWindowRuleTitle', { index: index + 1 })
                          }}</span>
                          <span
                            v-if="!isDesktop"
                            class="quota-window-editor__item-meta"
                            role="button"
                            tabindex="0"
                            @click="state.toggleQuotaWindowPreviewMode(quotaWindow, index)"
                            @keydown.enter="state.toggleQuotaWindowPreviewMode(quotaWindow, index)"
                            @keydown.space.prevent="
                              state.toggleQuotaWindowPreviewMode(quotaWindow, index)
                            "
                          >
                            {{ state.formatQuotaWindowPreview(quotaWindow, index) }}
                          </span>
                        </div>
                      </div>
                      <div
                        class="quota-window-editor__fields"
                        :class="{ 'quota-window-editor__fields--mobile': !isDesktop }"
                      >
                        <div class="quota-window-editor__field">
                          <label class="quota-window-editor__field-label">{{
                            i18ns.t('relay.quotaWindowUnit')
                          }}</label>
                          <el-select
                            v-model="quotaWindow.quotaUnit"
                            @change="state.handleQuotaWindowUnitChange(quotaWindow)"
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
                            :key="`${isDesktop ? 'desktop' : 'mobile'}-quota-limit-${index}-${quotaWindow.quotaUnit}`"
                            v-model="quotaWindow.quotaLimit"
                            :min="state.getQuotaMin(quotaWindow.quotaUnit)"
                            :max="state.getQuotaMax(quotaWindow.quotaUnit)"
                            :precision="state.getQuotaPrecision(quotaWindow.quotaUnit)"
                            :step="state.getQuotaStep(quotaWindow.quotaUnit)"
                            :style="isDesktop ? undefined : 'width: 100%'"
                          />
                        </div>
                        <div
                          class="quota-window-editor__field"
                          :class="isDesktop ? 'quota-window-editor__field--span-2' : undefined"
                        >
                          <label class="quota-window-editor__field-label">{{
                            i18ns.t('monthlyPass.quotaWindowHours')
                          }}</label>
                          <div
                            class="quota-window-duration-card"
                            :class="isDesktop ? '' : 'quota-window-duration-card--mobile'"
                          >
                            <div
                              class="quota-window-picker-row"
                              :class="isDesktop ? '' : 'quota-window-picker-row--mobile'"
                            >
                              <div
                                class="quota-window-picker"
                                :class="
                                  isDesktop
                                    ? 'quota-window-picker--desktop'
                                    : 'quota-window-picker--mobile'
                                "
                              >
                                <div class="quota-window-picker__segment">
                                  <el-input-number
                                    v-model="quotaWindow.months"
                                    :min="0"
                                    :max="state.MAX_QUOTA_WINDOW_MONTHS"
                                    :step="1"
                                    :precision="0"
                                    class="quota-window-input"
                                    @change="state.applyQuotaWindowParts(quotaWindow)"
                                  />
                                  <span class="quota-window-unit">{{
                                    i18ns.t('monthlyPass.monthsUnit')
                                  }}</span>
                                </div>
                                <div class="quota-window-picker__segment">
                                  <el-input-number
                                    v-model="quotaWindow.days"
                                    :min="0"
                                    :max="state.MAX_QUOTA_WINDOW_DAYS"
                                    :step="1"
                                    :precision="0"
                                    class="quota-window-input"
                                    @change="state.applyQuotaWindowParts(quotaWindow)"
                                  />
                                  <span class="quota-window-unit">{{
                                    i18ns.t('monthlyPass.daysUnit')
                                  }}</span>
                                </div>
                                <div class="quota-window-picker__segment">
                                  <el-input-number
                                    v-model="quotaWindow.hours"
                                    :min="0"
                                    :max="state.MAX_QUOTA_WINDOW_HOUR_PART"
                                    :step="1"
                                    :precision="0"
                                    class="quota-window-input"
                                    @change="state.applyQuotaWindowParts(quotaWindow)"
                                  />
                                  <span class="quota-window-unit">{{
                                    i18ns.t('monthlyPass.hoursUnit')
                                  }}</span>
                                </div>
                                <div class="quota-window-picker__segment">
                                  <el-input-number
                                    v-model="quotaWindow.minutes"
                                    :min="0"
                                    :max="state.MAX_QUOTA_WINDOW_MINUTE_PART"
                                    :step="1"
                                    :precision="0"
                                    class="quota-window-input"
                                    @change="state.applyQuotaWindowParts(quotaWindow)"
                                  />
                                  <span class="quota-window-unit">{{
                                    i18ns.t('monthlyPass.minutesUnit')
                                  }}</span>
                                </div>
                              </div>
                              <div
                                class="quota-window-value"
                                :class="
                                  isDesktop
                                    ? 'quota-window-value--desktop'
                                    : 'quota-window-value--mobile'
                                "
                                role="button"
                                tabindex="0"
                                @click="state.toggleQuotaWindowPreviewMode(quotaWindow, index)"
                                @keydown.enter="
                                  state.toggleQuotaWindowPreviewMode(quotaWindow, index)
                                "
                                @keydown.space.prevent="
                                  state.toggleQuotaWindowPreviewMode(quotaWindow, index)
                                "
                              >
                                {{ state.formatQuotaWindowPreview(quotaWindow, index) }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <el-button
                        link
                        type="danger"
                        :size="isDesktop ? undefined : 'small'"
                        :disabled="saving"
                        @click="state.removeQuotaWindow(index)"
                      >
                        {{ i18ns.t('relay.removeQuotaWindow') }}
                      </el-button>
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
                    :image-size="isDesktop ? 92 : 84"
                  />
                </div>
              </el-form-item>
            </div>
          </el-collapse-item>

          <el-collapse-item name="requestFormatTransforms">
            <template #title>
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('relay.requestFormatTransforms')
              }}</span>
            </template>
            <div
              :class="
                isDesktop ? 'relay-token-edit-section-grid' : 'relay-token-edit-section-stack'
              "
            >
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
                <el-alert
                  type="warning"
                  :closable="false"
                  :title="i18ns.t('relay.requestFormatTransformsRiskTitle')"
                  :description="i18ns.t('relay.requestFormatTransformsRisk')"
                  show-icon
                />
              </el-form-item>
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
                <template #label>{{ i18ns.t('relay.requestFormatTransforms') }}</template>
                <div class="relay-format-transform-list">
                  <div
                    v-for="(rule, index) in editForm.requestFormatTransforms"
                    :key="`${rule.sourceFormat}-${index}`"
                    class="relay-format-transform-card"
                  >
                    <div
                      class="relay-format-transform-column relay-format-transform-column--source"
                    >
                      <div class="relay-format-transform-column__heading">
                        <span>{{ i18ns.t('relay.sourceFormat') }}</span>
                        <span class="relay-format-transform-column__hint">1</span>
                      </div>
                      <button
                        v-for="format in requestFormatOptions"
                        :key="format.value"
                        type="button"
                        class="relay-format-transform-node"
                        :class="{
                          'relay-format-transform-node--selected':
                            rule.sourceFormat === format.value,
                        }"
                        :disabled="
                          format.value === rule.targetFormat ||
                          editForm.requestFormatTransforms.some(
                            (item, itemIndex) =>
                              itemIndex !== index && item.sourceFormat === format.value,
                          )
                        "
                        :aria-pressed="rule.sourceFormat === format.value"
                        :aria-label="`${i18ns.t('relay.sourceFormat')}: ${format.label}`"
                        :title="
                          format.value === rule.targetFormat
                            ? i18ns.t('relay.requestFormatTransformSameFormatDisabled')
                            : undefined
                        "
                        @click="state.selectRequestFormatTransformSource(rule, format.value)"
                      >
                        <span>{{ format.label }}</span>
                        <span
                          v-if="rule.sourceFormat === format.value"
                          class="relay-format-transform-node__check"
                          >✓</span
                        >
                      </button>
                    </div>
                    <div class="relay-format-transform-connector" aria-hidden="true">
                      <span class="relay-format-transform-connector__line" />
                      <span class="relay-format-transform-connector__arrow">→</span>
                      <span class="relay-format-transform-connector__line" />
                      <span class="relay-format-transform-connector__label">
                        {{ i18ns.t('relay.transformTo') }}
                      </span>
                    </div>
                    <div
                      class="relay-format-transform-column relay-format-transform-column--target"
                    >
                      <div class="relay-format-transform-column__heading">
                        <span>{{ i18ns.t('relay.targetFormat') }}</span>
                        <span class="relay-format-transform-column__hint">2</span>
                      </div>
                      <button
                        v-for="format in requestFormatOptions"
                        :key="format.value"
                        type="button"
                        class="relay-format-transform-node"
                        :class="{
                          'relay-format-transform-node--selected':
                            rule.targetFormat === format.value,
                        }"
                        :disabled="format.value === rule.sourceFormat"
                        :aria-pressed="rule.targetFormat === format.value"
                        :aria-label="`${i18ns.t('relay.targetFormat')}: ${format.label}`"
                        :title="
                          format.value === rule.sourceFormat
                            ? i18ns.t('relay.requestFormatTransformSameFormatDisabled')
                            : undefined
                        "
                        @click="state.selectRequestFormatTransformTarget(rule, format.value)"
                      >
                        <span>{{ format.label }}</span>
                        <span
                          v-if="rule.targetFormat === format.value"
                          class="relay-format-transform-node__check"
                          >✓</span
                        >
                      </button>
                    </div>
                    <el-tooltip :content="i18ns.t('delete')">
                      <el-button
                        text
                        type="danger"
                        :icon="Delete"
                        class="relay-format-transform-card__delete"
                        @click="state.removeRequestFormatTransform(index)"
                      />
                    </el-tooltip>
                  </div>
                  <el-button
                    plain
                    :icon="Plus"
                    :disabled="
                      editForm.requestFormatTransforms.length >= MAX_REQUEST_FORMAT_TRANSFORMS
                    "
                    @click="state.addRequestFormatTransform"
                    >{{ i18ns.t('relay.addRequestFormatTransform') }}</el-button
                  >
                </div>
              </el-form-item>
            </div>
          </el-collapse-item>

          <el-collapse-item name="anthropicNormalizer">
            <template #title>
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('relay.anthropicNormalizer')
              }}</span>
            </template>
            <div
              :class="
                isDesktop ? 'relay-token-edit-section-grid' : 'relay-token-edit-section-stack'
              "
            >
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
                <el-switch
                  v-model="editForm.normalizerConfig.enabled"
                  :active-text="i18ns.t('relay.anthropicNormalizerEnabled')"
                />
              </el-form-item>
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
                <el-alert
                  type="info"
                  :closable="false"
                  :title="i18ns.t('relay.anthropicNormalizerHelp')"
                />
              </el-form-item>
              <el-form-item :label="i18ns.t('relay.thinkingSignatureNormalizer')">
                <el-switch
                  v-model="editForm.normalizerConfig.thinkingSignature"
                  :disabled="!editForm.normalizerConfig.enabled"
                />
              </el-form-item>
              <el-form-item :label="i18ns.t('relay.thinkingBudgetNormalizer')">
                <el-switch
                  v-model="editForm.normalizerConfig.thinkingBudget"
                  :disabled="!editForm.normalizerConfig.enabled"
                />
              </el-form-item>
              <el-form-item :label="i18ns.t('relay.unsupportedImageNormalizer')">
                <el-switch
                  v-model="editForm.normalizerConfig.unsupportedImage"
                  :disabled="!editForm.normalizerConfig.enabled"
                />
              </el-form-item>
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
                <template #label>{{ i18ns.t('relay.textOnlyModelIds') }}</template>
                <el-select
                  v-model="editForm.normalizerConfig.textOnlyModelIds"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  tag-type="info"
                  :placeholder="i18ns.t('relay.textOnlyModelIdsPlaceholder')"
                  :disabled="
                    !editForm.normalizerConfig.enabled ||
                    !editForm.normalizerConfig.unsupportedImage
                  "
                />
              </el-form-item>
            </div>
          </el-collapse-item>

          <el-collapse-item name="contentSafety">
            <template #title>
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('contentSafety.policy')
              }}</span>
            </template>
            <div
              :class="
                isDesktop
                  ? 'relay-token-edit-section-grid'
                  : 'relay-token-edit-section-stack relay-token-edit-section-stack--mobile'
              "
            >
              <el-alert
                :title="i18ns.t('contentSafety.tokenOverrideHelp')"
                type="info"
                :closable="false"
                :class="isDesktop ? 'form-item-span-2' : undefined"
              />
              <el-form-item :label="i18ns.t('contentSafety.requestEnabled')">
                <el-select
                  v-model="editForm.contentSafetyConfig.requestEnabled"
                  clearable
                  style="width: 100%"
                >
                  <el-option :value="null" :label="i18ns.t('contentSafety.inherit')" /><el-option
                    :value="true"
                    :label="i18ns.t('contentSafety.enabled')"
                  /><el-option :value="false" :label="i18ns.t('contentSafety.disabled')" />
                </el-select>
              </el-form-item>
              <el-form-item :label="i18ns.t('contentSafety.requestAction')"
                ><el-select
                  v-model="editForm.contentSafetyConfig.requestAction"
                  clearable
                  style="width: 100%"
                  ><el-option :value="null" :label="i18ns.t('contentSafety.inherit')" /><el-option
                    value="unreachable"
                    :label="i18ns.t('contentSafety.unreachable')" /><el-option
                    value="blackhole"
                    :label="i18ns.t('contentSafety.blackhole')" /><el-option
                    value="allow"
                    :label="i18ns.t('contentSafety.allow')" /></el-select
              ></el-form-item>
              <el-form-item :label="i18ns.t('contentSafety.responseEnabled')"
                ><el-select
                  v-model="editForm.contentSafetyConfig.responseEnabled"
                  clearable
                  style="width: 100%"
                  ><el-option :value="null" :label="i18ns.t('contentSafety.inherit')" /><el-option
                    :value="true"
                    :label="i18ns.t('contentSafety.enabled')" /><el-option
                    :value="false"
                    :label="i18ns.t('contentSafety.disabled')" /></el-select
              ></el-form-item>
              <el-form-item :label="i18ns.t('contentSafety.responseAction')"
                ><el-select
                  v-model="editForm.contentSafetyConfig.responseAction"
                  clearable
                  style="width: 100%"
                  ><el-option :value="null" :label="i18ns.t('contentSafety.inherit')" /><el-option
                    value="unreachable"
                    :label="i18ns.t('contentSafety.unreachable')" /><el-option
                    value="blackhole"
                    :label="i18ns.t('contentSafety.blackhole')" /><el-option
                    value="allow"
                    :label="i18ns.t('contentSafety.allow')" /></el-select
              ></el-form-item>
              <el-form-item :label="i18ns.t('contentSafety.requestAiEnabled')"
                ><el-select
                  v-model="editForm.contentSafetyConfig.requestAiEnabled"
                  clearable
                  style="width: 100%"
                  ><el-option :value="null" :label="i18ns.t('contentSafety.inherit')" /><el-option
                    :value="true"
                    :label="i18ns.t('contentSafety.enabled')" /><el-option
                    :value="false"
                    :label="i18ns.t('contentSafety.disabled')" /></el-select
              ></el-form-item>
              <el-form-item :label="i18ns.t('contentSafety.responseAiEnabled')"
                ><el-select
                  v-model="editForm.contentSafetyConfig.responseAiEnabled"
                  clearable
                  style="width: 100%"
                  ><el-option :value="null" :label="i18ns.t('contentSafety.inherit')" /><el-option
                    :value="true"
                    :label="i18ns.t('contentSafety.enabled')" /><el-option
                    :value="false"
                    :label="i18ns.t('contentSafety.disabled')" /></el-select
              ></el-form-item>
            </div>
          </el-collapse-item>

          <el-collapse-item name="advanced">
            <template #title>
              <span class="relay-token-edit-sections__title">{{
                i18ns.t('relay.advancedSettings')
              }}</span>
            </template>
            <div
              :class="
                isDesktop
                  ? 'relay-token-edit-section-grid'
                  : 'relay-token-edit-section-stack relay-token-edit-section-stack--mobile'
              "
            >
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
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
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
                <template #label>{{ i18ns.t('relay.v1PathMode') }}</template>
                <el-radio-group v-model="editForm.normalizerConfig.v1PathMode">
                  <el-radio value="off">{{ i18ns.t('relay.v1PathModeOff') }}</el-radio>
                  <el-radio value="auto">{{ i18ns.t('relay.v1PathModeAuto') }}</el-radio>
                  <el-radio value="always">{{ i18ns.t('relay.v1PathModeAlways') }}</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item :class="isDesktop ? 'form-item-span-2' : undefined">
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
                >
                  <el-option
                    v-for="modelId in filteredModelIds"
                    :key="modelId"
                    :label="state.getModelIdDisplayLabel(modelId)"
                    :value="modelId"
                  />
                </el-select>
              </el-form-item>
              <el-form-item
                :class="isDesktop ? 'form-item-span-2' : undefined"
                :label="i18ns.t('relay.modelMapping')"
              >
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
    </div>
    <template #footer>
      <el-button @click="showEditDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="state.handleSave">{{
        i18ns.t('confirm')
      }}</el-button>
    </template>
  </el-drawer>

  <el-dialog
    v-model="showTokenChannelBatchAddDialog"
    :title="i18ns.t('relay.tokenChannelBatchAdd')"
    :width="isDesktop ? '520px' : 'calc(100% - 24px)'"
    append-to-body
    class="token-channel-batch-add-dialog"
    @closed="resetTokenChannelBatchAddSelection"
  >
    <el-form label-position="top">
      <el-form-item :label="i18ns.t('relay.tokenChannelBatchAdd')">
        <el-select
          v-model="tokenChannelBatchAddIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          style="width: 100%"
          :placeholder="i18ns.t('relay.tokenChannelSelectChannelsPlaceholder')"
        >
          <el-option
            v-for="channel in tokenChannelBatchAddOptions"
            :key="channel.id"
            :label="
              state.getChannelOptionLabel({
                id: channel.id,
                name: channel.name,
                multiplier: channel.multiplier,
              })
            "
            :value="channel.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showTokenChannelBatchAddDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="primary"
        :disabled="tokenChannelBatchAddIds.length === 0"
        @click="confirmTokenChannelBatchAdd"
      >
        {{ i18ns.t('relay.tokenChannelBatchAdd') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Delete, Plus, QuestionFilled, Rank } from '@element-plus/icons-vue'
import { computed, ref, unref, type ComponentPublicInstance } from 'vue'
import { Permission } from '@/constant/permission'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import ModelMappingEditor from '@/components/relay/ModelMappingEditor.vue'
import { i18ns } from '@/locales'
import { useRelayTokenManagementContext } from '../context'

const state = useRelayTokenManagementContext()

const {
  showEditDialog,
  editMode,
  isDesktop,
  editForm,
  editDialogSectionNames,
  selectedChannelConfigKeys,
  tokenChannelBatchAddIds,
  isAllChannelConfigsSelected,
  selectedChannelConfigs,
  tokenChannelBatchAddOptions,
  filteredModelIds,
  channelFilteredModelNames,
  saving,
  showUnavailableChannelWarning,
  unavailableChannelWarningText,
  showMaxRetriesRiskWarning,
  maxRetriesRiskWarningText,
  automaticProxyPoolChannelOptions,
  selectedAutomaticProxyPoolMemberOptions,
  MAX_REQUEST_FORMAT_TRANSFORMS,
} = state

const requestFormatOptions = [
  { value: 'openai-chat-completions', label: i18ns.t('relay.formatOpenAIChatCompletions') },
  { value: 'openai-responses', label: i18ns.t('relay.formatOpenAIResponses') },
  { value: 'anthropic', label: i18ns.t('relay.formatAnthropic') },
] as const

const setChannelListRef = (element: Element | ComponentPublicInstance | null) => {
  const target = element instanceof HTMLElement ? element : null
  if (unref(isDesktop)) {
    state.desktopChannelListRef.value = target
    return
  }

  state.mobileChannelListRef.value = target
}

const channelLimitReached = computed(() => tokenChannelBatchAddOptions.value.length === 0)
const showTokenChannelBatchAddDialog = ref(false)
const resetTokenChannelBatchAddSelection = () => {
  tokenChannelBatchAddIds.value = []
}

const openTokenChannelBatchAddDialog = () => {
  resetTokenChannelBatchAddSelection()
  showTokenChannelBatchAddDialog.value = true
}

const confirmTokenChannelBatchAdd = () => {
  if (tokenChannelBatchAddIds.value.length === 0) return
  state.handleBatchAddTokenChannels()
  showTokenChannelBatchAddDialog.value = false
}
</script>

<style scoped>
.relay-token-base-url {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  margin: 0 0 12px;
  padding: 0 4px 10px;
  color: var(--el-text-color-regular);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.relay-token-base-url code {
  min-width: 0;
  overflow: hidden;
  color: var(--el-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relay-format-transform-list {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.relay-format-transform-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px minmax(0, 1fr) 32px;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
}

.relay-format-transform-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.relay-format-transform-column__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--el-text-color-regular);
  font-size: 12px;
  font-weight: 600;
}

.relay-format-transform-column__hint {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11px;
}

.relay-format-transform-node {
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.relay-format-transform-node:hover:not(:disabled) {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.relay-format-transform-node:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.relay-format-transform-node--selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7);
}

.relay-format-transform-node:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.relay-format-transform-node__check {
  flex: 0 0 auto;
  font-weight: 700;
}

.relay-format-transform-connector {
  position: relative;
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--el-color-primary);
}

.relay-format-transform-connector__line {
  width: 12px;
  height: 1px;
  background: var(--el-color-primary-light-5);
}

.relay-format-transform-connector__arrow {
  font-size: 20px;
  line-height: 1;
}

.relay-format-transform-connector__label {
  position: absolute;
  top: calc(50% + 16px);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.relay-format-transform-card__delete {
  align-self: flex-start;
}

@media (max-width: 640px) {
  .relay-format-transform-card {
    grid-template-columns: minmax(0, 1fr) 32px;
  }

  .relay-format-transform-column--source {
    grid-column: 1;
  }

  .relay-format-transform-column--target {
    grid-column: 1;
    grid-row: 3;
  }

  .relay-format-transform-connector {
    grid-column: 1;
    grid-row: 2;
    min-height: 28px;
    transform: rotate(90deg);
  }

  .relay-format-transform-connector__label {
    display: none;
  }

  .relay-format-transform-card__delete {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
