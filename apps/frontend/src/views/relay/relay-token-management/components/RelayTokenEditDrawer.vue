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
                      <el-checkbox v-model="selectedChannelConfigKeys" :value="config.tempKey" />
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
                <div class="flex flex-col gap-2 w-full">
                  <div
                    v-for="(rule, index) in editForm.requestFormatTransforms"
                    :key="`${rule.sourceFormat}-${index}`"
                    class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_32px] gap-2 items-center"
                  >
                    <el-select
                      v-model="rule.sourceFormat"
                      :aria-label="i18ns.t('relay.sourceFormat')"
                    >
                      <el-option
                        v-for="format in requestFormatOptions"
                        :key="format.value"
                        :label="format.label"
                        :value="format.value"
                        :disabled="
                          editForm.requestFormatTransforms.some(
                            (item, itemIndex) =>
                              itemIndex !== index && item.sourceFormat === format.value,
                          )
                        "
                      />
                    </el-select>
                    <span class="text-center text-[#909399]">{{
                      i18ns.t('relay.transformTo')
                    }}</span>
                    <el-select
                      v-model="rule.targetFormat"
                      :aria-label="i18ns.t('relay.targetFormat')"
                    >
                      <el-option
                        v-for="format in requestFormatOptions"
                        :key="format.value"
                        :label="format.label"
                        :value="format.value"
                        :disabled="format.value === rule.sourceFormat"
                      />
                    </el-select>
                    <el-tooltip :content="i18ns.t('delete')">
                      <el-button
                        text
                        type="danger"
                        :icon="Delete"
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
  { value: 'openai-chat-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' },
]

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
</style>
