<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="server-config server-config-desktop" v-loading="loading">
      <el-collapse v-model="activeNames">
        <!-- Registration Settings -->
        <el-collapse-item name="registration">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.registrationTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.allowFreeRegistration')">
              <el-switch v-model="regEnabled" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.allowFreeRegistrationHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.maxAccountsPerEmail')">
              <el-input-number v-model="maxAccountsPerEmail" :min="1" :max="100" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.maxAccountsPerEmailHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.defaultGroup')">
              <el-select v-model="defaultGroupUsername" style="width: 100%; max-width: 200px">
                <el-option
                  v-for="g in groups"
                  :key="g.id"
                  :label="g.name || g.username"
                  :value="g.username"
                />
              </el-select>
              <span class="form-help">{{ i18ns.t('ServerConfigView.defaultGroupHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.verificationCodeExpiry')">
              <el-input-number v-model="codeExpiry" :min="60" :max="3600" :step="60" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.verificationCodeExpiryHelp')
              }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingReg" @click="saveRegistration">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="billing">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.billingTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.rechargeRatio')">
              <el-input-number
                v-model="rechargeRatio"
                :min="0.0001"
                :max="1000000"
                :step="1"
                :precision="4"
              />
              <span class="form-help">{{ i18ns.t('ServerConfigView.rechargeRatioHelp') }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingBilling" @click="saveBilling">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="heartbeat">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.heartbeatTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.heartbeatIntervalSeconds')">
              <el-input-number v-model="heartbeatIntervalSeconds" :min="5" :max="3600" :step="5" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.heartbeatIntervalHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.heartbeatTimeoutSeconds')">
              <el-input-number v-model="heartbeatTimeoutSeconds" :min="10" :max="86400" :step="5" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.heartbeatTimeoutHelp') }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingHeartbeat" @click="saveHeartbeat">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="remoteTerminalUnbind">
          <template #title>
            <span class="collapse-title">{{
              i18ns.t('ServerConfigView.remoteTerminalUnbindTitle')
            }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.remoteTerminalUnbindMaxCount')">
              <el-input-number v-model="remoteTerminalUnbindMaxCount" :min="0" :max="1000" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.remoteTerminalUnbindMaxCountHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.remoteTerminalUnbindWindowHours')">
              <el-input-number v-model="remoteTerminalUnbindWindowHours" :min="1" :max="8760" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.remoteTerminalUnbindWindowHoursHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.remoteTerminalRebindCooldownMinutes')">
              <el-input-number
                v-model="remoteTerminalRebindCooldownMinutes"
                :min="0"
                :max="525600"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.remoteTerminalRebindCooldownMinutesHelp')
              }}</span>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="savingRemoteTerminalUnbind"
                @click="saveRemoteTerminalUnbind"
              >
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="notification">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.notificationTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.notificationDefaultSubscribedEvents')">
              <div class="notification-events-field">
                <div class="notification-events-toolbar">
                  <el-button size="small" @click="selectAllNotificationDefaultEvents">
                    {{ i18ns.t('ServerConfigView.notificationSelectAll') }}
                  </el-button>
                  <el-button size="small" @click="clearAllNotificationDefaultEvents">
                    {{ i18ns.t('ServerConfigView.notificationClearAll') }}
                  </el-button>
                </div>
                <el-checkbox-group v-model="notificationDefaultSubscribedEvents">
                  <div class="notification-event-grid">
                    <label
                      v-for="event in notificationEventOptions"
                      :key="event.value"
                      class="notification-event-option"
                    >
                      <el-checkbox :value="event.value">{{ event.label }}</el-checkbox>
                      <span class="form-help form-help--inline">{{ event.value }}</span>
                    </label>
                  </div>
                </el-checkbox-group>
                <span class="form-help">{{
                  i18ns.t('ServerConfigView.notificationDefaultSubscribedEventsHelp')
                }}</span>
              </div>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.notificationDefaultThresholds')">
              <div class="notification-thresholds-field">
                <div
                  v-for="event in notificationThresholdEventOptions"
                  :key="event.value"
                  class="notification-threshold-item"
                >
                  <span class="notification-threshold-item__label">{{ event.label }}</span>
                  <div class="notification-threshold-item__control">
                    <el-input-number
                      v-model="notificationDefaultThresholds[event.value]"
                      :min="0"
                      :precision="2"
                    />
                    <span v-if="event.thresholdUnit" class="form-help form-help--inline">
                      {{ event.thresholdUnit }}
                    </span>
                  </div>
                </div>
                <span class="form-help">{{
                  i18ns.t('ServerConfigView.notificationDefaultThresholdsHelp')
                }}</span>
              </div>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentRules')">
              <div class="notification-assignment-field">
                <div
                  v-for="(rule, index) in feedbackAssignmentRules"
                  :key="`desktop-rule-${index}`"
                  class="assignment-rule-card"
                >
                  <div class="assignment-rule-card__header">
                    <span>{{ i18ns.t('ServerConfigView.notificationAssignmentRuleTitle', { index: index + 1 }) }}</span>
                    <el-button link type="danger" @click="removeFeedbackAssignmentRule(index)">
                      {{ i18ns.t('delete') }}
                    </el-button>
                  </div>
                  <div class="assignment-rule-grid">
                    <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentType')">
                      <el-select v-model="rule.type" clearable>
                        <el-option
                          v-for="type in feedbackTypeOptions"
                          :key="type"
                          :label="getFeedbackTypeLabel(type)"
                          :value="type"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentPriority')">
                      <el-select v-model="rule.priority" clearable>
                        <el-option
                          v-for="priority in feedbackPriorityOptions"
                          :key="priority"
                          :label="getFeedbackPriorityLabel(priority)"
                          :value="priority"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item
                      class="assignment-rule-grid__full"
                      :label="i18ns.t('ServerConfigView.notificationAssignmentUsers')"
                    >
                      <el-select
                        v-model="rule.assigneeUserIds"
                        multiple
                        filterable
                        remote
                        clearable
                        reserve-keyword
                        :remote-method="handleAssignmentUserSearch"
                        :loading="assignmentUserOptionsLoading"
                        @visible-change="handleAssignmentUserSelectVisible"
                      >
                        <el-option
                          v-for="user in assignmentUserOptions"
                          :key="user.id"
                          :label="user.username"
                          :value="user.id"
                        />
                      </el-select>
                      <span class="form-help">{{
                        i18ns.t('ServerConfigView.notificationAssignmentUsersHelp')
                      }}</span>
                    </el-form-item>
                  </div>
                </div>
                <el-button size="small" @click="addFeedbackAssignmentRule">
                  + {{ i18ns.t('ServerConfigView.notificationAddAssignmentRule') }}
                </el-button>
                <span class="form-help">{{
                  i18ns.t('ServerConfigView.notificationAssignmentRulesHelp')
                }}</span>
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingNotification" @click="saveNotification">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="captcha">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.captchaTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.captchaMode')">
              <el-tag :type="captchaProvider === 'none' ? 'info' : 'success'">
                {{
                  captchaProvider === 'none'
                    ? i18ns.t('ServerConfigView.captchaDisabledMode')
                    : i18ns.t('ServerConfigView.captchaEnabledMode')
                }}
              </el-tag>
              <span class="form-help">{{ i18ns.t('ServerConfigView.captchaModeHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaProvider')">
              <div class="provider-card-group">
                <button
                  v-for="option in captchaProviderOptions"
                  :key="option.value"
                  type="button"
                  class="provider-card"
                  :class="{ 'provider-card--active': captchaProvider === option.value }"
                  @click="captchaProvider = option.value"
                >
                  <span class="provider-card__title">{{ option.label }}</span>
                  <span class="provider-card__desc">{{ option.description }}</span>
                </button>
              </div>
              <span class="form-help">{{ i18ns.t('ServerConfigView.captchaProviderHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaFallbackProvider')">
              <div class="provider-card-group">
                <button
                  v-for="option in captchaFallbackOptions"
                  :key="option.value"
                  type="button"
                  class="provider-card provider-card--small"
                  :class="{
                    'provider-card--active': captchaFallbackProvider === option.value,
                    'provider-card--disabled': option.disabled,
                  }"
                  :disabled="option.disabled"
                  @click="captchaFallbackProvider = option.value"
                >
                  <span class="provider-card__title">{{ option.label }}</span>
                  <span class="provider-card__desc">{{ option.description }}</span>
                </button>
              </div>
              <span class="form-help">{{
                i18ns.t('ServerConfigView.captchaFallbackProviderHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaMinScore')">
              <el-input-number
                v-model="captchaMinScore"
                :min="0"
                :max="1"
                :step="0.1"
                :precision="1"
                :disabled="!isRecaptchaScoreActive"
              />
              <span class="form-help" :class="{ 'form-help--active': isRecaptchaScoreActive }">
                {{
                  isRecaptchaScoreActive
                    ? i18ns.t('ServerConfigView.captchaMinScoreRecaptchaHint')
                    : i18ns.t('ServerConfigView.captchaMinScoreTurnstileHint')
                }}
              </span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaTrustWindowMinutes')">
              <el-input-number v-model="captchaTrustWindowMinutes" :min="0" :max="1440" :step="5" />
              <span class="form-help">
                {{ i18ns.t('ServerConfigView.captchaTrustWindowMinutesHelp') }}
              </span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingCaptcha" @click="saveCaptcha">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- SMTP Settings -->
        <el-collapse-item name="smtp">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.smtpTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.smtpHost')">
              <el-input v-model="smtpHost" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpPort')">
              <el-input-number v-model="smtpPort" :min="1" :max="65535" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpSecure')">
              <el-switch v-model="smtpSecure" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpUser')">
              <el-input v-model="smtpUser" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpPassword')">
              <el-input
                v-model="smtpPassword"
                type="password"
                show-password
                style="width: 100%; max-width: 300px"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpSenderName')">
              <el-input v-model="smtpSenderName" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpSenderEmail')">
              <el-input v-model="smtpSenderEmail" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingSmtp" @click="saveSmtp">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- Error Decay Settings -->
        <el-collapse-item name="errorDecay">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.errorDecayTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayEnabled')">
              <el-switch v-model="errorDecayEnabled" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.errorDecayEnabledHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayRate')">
              <el-input-number
                v-model="errorDecayRate"
                :min="0.1"
                :max="100"
                :step="0.1"
                :precision="1"
              />
              <span class="form-help">{{ i18ns.t('ServerConfigView.errorDecayRateHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayMinThreshold')">
              <el-input-number
                v-model="errorDecayMinThreshold"
                :min="0.01"
                :max="10"
                :step="0.01"
                :precision="2"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.errorDecayMinThresholdHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayInterval')">
              <el-input-number v-model="errorDecayInterval" :min="1" :max="60" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.errorDecayIntervalHelp')
              }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingErrorDecay" @click="saveErrorDecay">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- Error Weights Settings -->
        <el-collapse-item name="errorWeights">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.errorWeightsTitle') }}</span>
          </template>
          <el-alert type="info" :closable="false" style="margin-bottom: 20px">
            <template #title>
              {{ i18ns.t('ServerConfigView.errorWeightsHelp') }}
            </template>
          </el-alert>
          <el-form label-width="200px" label-position="right">
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.statusCodeWeights')
            }}</el-divider>
            <el-table :data="statusCodeWeights" border style="margin-bottom: 8px">
              <el-table-column :label="i18ns.t('ServerConfigView.statusCode')">
                <template #default="{ row }">
                  <el-input v-model="row.code" size="small" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ServerConfigView.weight')">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.weight"
                    :min="0"
                    :max="10"
                    :step="0.1"
                    :precision="1"
                    size="small"
                  />
                </template>
              </el-table-column>
              <el-table-column width="70">
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    link
                    size="small"
                    @click="statusCodeWeights.splice($index, 1)"
                    >{{ i18ns.t('delete') }}</el-button
                  >
                </template>
              </el-table-column>
            </el-table>
            <el-button
              size="small"
              style="margin-bottom: 20px"
              @click="statusCodeWeights.push({ code: '', weight: 1, description: '' })"
              >+ {{ i18ns.t('ServerConfigView.addRow') }}</el-button
            >
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.customCodeWeights')
            }}</el-divider>
            <el-table :data="customCodeWeights" border style="margin-bottom: 8px">
              <el-table-column :label="i18ns.t('ServerConfigView.customCode')">
                <template #default="{ row }">
                  <el-input v-model="row.code" size="small" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ServerConfigView.weight')">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.weight"
                    :min="0"
                    :max="10"
                    :step="0.1"
                    :precision="1"
                    size="small"
                  />
                </template>
              </el-table-column>
              <el-table-column width="70">
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    link
                    size="small"
                    @click="customCodeWeights.splice($index, 1)"
                    >{{ i18ns.t('delete') }}</el-button
                  >
                </template>
              </el-table-column>
            </el-table>
            <el-button
              size="small"
              style="margin-bottom: 20px"
              @click="customCodeWeights.push({ code: '', weight: 1, description: '' })"
              >+ {{ i18ns.t('ServerConfigView.addRow') }}</el-button
            >
            <el-form-item>
              <el-button type="primary" :loading="savingErrorWeights" @click="saveErrorWeights">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- IP Ban Settings -->
        <el-collapse-item name="ipBan">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.ipBanTitle') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.ipBanEnabled')">
              <el-switch v-model="ipBanEnabled" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.ipBanEnabledHelp') }}</span>
            </el-form-item>
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.level1')
            }}</el-divider>
            <el-form-item :label="i18ns.t('ServerConfigView.level1Threshold')">
              <el-input-number v-model="level1Threshold" :min="1" :max="1000" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.level1Duration')">
              <el-input-number v-model="level1Duration" :min="60" :max="86400" :step="60" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.durationHelp') }}</span>
            </el-form-item>
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.level2')
            }}</el-divider>
            <el-form-item :label="i18ns.t('ServerConfigView.level2Threshold')">
              <el-input-number v-model="level2Threshold" :min="1" :max="1000" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.level2Duration')">
              <el-input-number v-model="level2Duration" :min="60" :max="604800" :step="3600" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.durationHelp') }}</span>
            </el-form-item>
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.level3')
            }}</el-divider>
            <el-form-item :label="i18ns.t('ServerConfigView.level3Threshold')">
              <el-input-number v-model="level3Threshold" :min="1" :max="1000" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.level3Duration')">
              <el-select v-model="level3Duration" style="width: 100%; max-width: 200px">
                <el-option :label="i18ns.t('ServerConfigView.duration1Hour')" :value="3600" />
                <el-option :label="i18ns.t('ServerConfigView.duration24Hours')" :value="86400" />
                <el-option :label="i18ns.t('ServerConfigView.duration7Days')" :value="604800" />
                <el-option :label="i18ns.t('ServerConfigView.durationPermanent')" :value="-1" />
              </el-select>
              <span class="form-help">{{ i18ns.t('ServerConfigView.level3DurationHelp') }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingIpBan" @click="saveIpBan">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
  <div v-else class="mobile-page server-config-mobile-adapter">
    <div class="server-config server-config-mobile" v-loading="loading">
      <el-collapse v-model="activeNames">
        <!-- Registration Settings -->
        <el-collapse-item name="registration">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.registrationTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.allowFreeRegistration')">
              <el-switch v-model="regEnabled" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.allowFreeRegistrationHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.maxAccountsPerEmail')">
              <el-input-number v-model="maxAccountsPerEmail" :min="1" :max="100" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.maxAccountsPerEmailHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.defaultGroup')">
              <el-select v-model="defaultGroupUsername" style="width: 100%; max-width: 200px">
                <el-option
                  v-for="g in groups"
                  :key="g.id"
                  :label="g.name || g.username"
                  :value="g.username"
                />
              </el-select>
              <span class="form-help">{{ i18ns.t('ServerConfigView.defaultGroupHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.verificationCodeExpiry')">
              <el-input-number v-model="codeExpiry" :min="60" :max="3600" :step="60" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.verificationCodeExpiryHelp')
              }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingReg" @click="saveRegistration">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="billing">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.billingTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.rechargeRatio')">
              <el-input-number
                v-model="rechargeRatio"
                :min="0.0001"
                :max="1000000"
                :step="1"
                :precision="4"
              />
              <span class="form-help">{{ i18ns.t('ServerConfigView.rechargeRatioHelp') }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingBilling" @click="saveBilling">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="heartbeat">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.heartbeatTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.heartbeatIntervalSeconds')">
              <el-input-number v-model="heartbeatIntervalSeconds" :min="5" :max="3600" :step="5" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.heartbeatIntervalHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.heartbeatTimeoutSeconds')">
              <el-input-number v-model="heartbeatTimeoutSeconds" :min="10" :max="86400" :step="5" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.heartbeatTimeoutHelp') }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingHeartbeat" @click="saveHeartbeat">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="remoteTerminalUnbind">
          <template #title>
            <span class="collapse-title">{{
              i18ns.t('ServerConfigView.remoteTerminalUnbindTitle')
            }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.remoteTerminalUnbindMaxCount')">
              <el-input-number v-model="remoteTerminalUnbindMaxCount" :min="0" :max="1000" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.remoteTerminalUnbindMaxCountHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.remoteTerminalUnbindWindowHours')">
              <el-input-number v-model="remoteTerminalUnbindWindowHours" :min="1" :max="8760" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.remoteTerminalUnbindWindowHoursHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.remoteTerminalRebindCooldownMinutes')">
              <el-input-number
                v-model="remoteTerminalRebindCooldownMinutes"
                :min="0"
                :max="525600"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.remoteTerminalRebindCooldownMinutesHelp')
              }}</span>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="savingRemoteTerminalUnbind"
                @click="saveRemoteTerminalUnbind"
              >
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="notification">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.notificationTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.notificationDefaultSubscribedEvents')">
              <div class="notification-events-field notification-events-field--mobile">
                <div class="notification-events-toolbar">
                  <el-button size="small" @click="selectAllNotificationDefaultEvents">
                    {{ i18ns.t('ServerConfigView.notificationSelectAll') }}
                  </el-button>
                  <el-button size="small" @click="clearAllNotificationDefaultEvents">
                    {{ i18ns.t('ServerConfigView.notificationClearAll') }}
                  </el-button>
                </div>
                <el-checkbox-group v-model="notificationDefaultSubscribedEvents">
                  <div class="notification-event-grid notification-event-grid--mobile">
                    <label
                      v-for="event in notificationEventOptions"
                      :key="event.value"
                      class="notification-event-option"
                    >
                      <el-checkbox :value="event.value">{{ event.label }}</el-checkbox>
                      <span class="form-help form-help--inline">{{ event.value }}</span>
                    </label>
                  </div>
                </el-checkbox-group>
                <span class="form-help">{{
                  i18ns.t('ServerConfigView.notificationDefaultSubscribedEventsHelp')
                }}</span>
              </div>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.notificationDefaultThresholds')">
              <div class="notification-thresholds-field notification-thresholds-field--mobile">
                <div
                  v-for="event in notificationThresholdEventOptions"
                  :key="event.value"
                  class="notification-threshold-item"
                >
                  <span class="notification-threshold-item__label">{{ event.label }}</span>
                  <div class="notification-threshold-item__control">
                    <el-input-number
                      v-model="notificationDefaultThresholds[event.value]"
                      :min="0"
                      :precision="2"
                    />
                    <span v-if="event.thresholdUnit" class="form-help form-help--inline">
                      {{ event.thresholdUnit }}
                    </span>
                  </div>
                </div>
                <span class="form-help">{{
                  i18ns.t('ServerConfigView.notificationDefaultThresholdsHelp')
                }}</span>
              </div>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentRules')">
              <div class="notification-assignment-field notification-assignment-field--mobile">
                <div
                  v-for="(rule, index) in feedbackAssignmentRules"
                  :key="`mobile-rule-${index}`"
                  class="assignment-rule-card"
                >
                  <div class="assignment-rule-card__header">
                    <span>{{ i18ns.t('ServerConfigView.notificationAssignmentRuleTitle', { index: index + 1 }) }}</span>
                    <el-button link type="danger" @click="removeFeedbackAssignmentRule(index)">
                      {{ i18ns.t('delete') }}
                    </el-button>
                  </div>
                  <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentType')">
                    <el-select v-model="rule.type" clearable>
                      <el-option
                        v-for="type in feedbackTypeOptions"
                        :key="type"
                        :label="getFeedbackTypeLabel(type)"
                        :value="type"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentPriority')">
                    <el-select v-model="rule.priority" clearable>
                      <el-option
                        v-for="priority in feedbackPriorityOptions"
                        :key="priority"
                        :label="getFeedbackPriorityLabel(priority)"
                        :value="priority"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="i18ns.t('ServerConfigView.notificationAssignmentUsers')">
                    <el-select
                      v-model="rule.assigneeUserIds"
                      multiple
                      filterable
                      remote
                      clearable
                      reserve-keyword
                      :remote-method="handleAssignmentUserSearch"
                      :loading="assignmentUserOptionsLoading"
                      @visible-change="handleAssignmentUserSelectVisible"
                    >
                      <el-option
                        v-for="user in assignmentUserOptions"
                        :key="user.id"
                        :label="user.username"
                        :value="user.id"
                      />
                    </el-select>
                    <span class="form-help">{{
                      i18ns.t('ServerConfigView.notificationAssignmentUsersHelp')
                    }}</span>
                  </el-form-item>
                </div>
                <el-button size="small" @click="addFeedbackAssignmentRule">
                  + {{ i18ns.t('ServerConfigView.notificationAddAssignmentRule') }}
                </el-button>
                <span class="form-help">{{
                  i18ns.t('ServerConfigView.notificationAssignmentRulesHelp')
                }}</span>
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingNotification" @click="saveNotification">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="captcha">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.captchaTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.captchaMode')">
              <el-tag :type="captchaProvider === 'none' ? 'info' : 'success'">
                {{
                  captchaProvider === 'none'
                    ? i18ns.t('ServerConfigView.captchaDisabledMode')
                    : i18ns.t('ServerConfigView.captchaEnabledMode')
                }}
              </el-tag>
              <span class="form-help">{{ i18ns.t('ServerConfigView.captchaModeHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaProvider')">
              <div class="provider-card-group provider-card-group--mobile">
                <button
                  v-for="option in captchaProviderOptions"
                  :key="option.value"
                  type="button"
                  class="provider-card"
                  :class="{ 'provider-card--active': captchaProvider === option.value }"
                  @click="captchaProvider = option.value"
                >
                  <span class="provider-card__title">{{ option.label }}</span>
                  <span class="provider-card__desc">{{ option.description }}</span>
                </button>
              </div>
              <span class="form-help">{{ i18ns.t('ServerConfigView.captchaProviderHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaFallbackProvider')">
              <div class="provider-card-group provider-card-group--mobile">
                <button
                  v-for="option in captchaFallbackOptions"
                  :key="option.value"
                  type="button"
                  class="provider-card provider-card--small"
                  :class="{
                    'provider-card--active': captchaFallbackProvider === option.value,
                    'provider-card--disabled': option.disabled,
                  }"
                  :disabled="option.disabled"
                  @click="captchaFallbackProvider = option.value"
                >
                  <span class="provider-card__title">{{ option.label }}</span>
                  <span class="provider-card__desc">{{ option.description }}</span>
                </button>
              </div>
              <span class="form-help">{{
                i18ns.t('ServerConfigView.captchaFallbackProviderHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaMinScore')">
              <el-input-number
                v-model="captchaMinScore"
                :min="0"
                :max="1"
                :step="0.1"
                :precision="1"
                :disabled="!isRecaptchaScoreActive"
              />
              <span class="form-help" :class="{ 'form-help--active': isRecaptchaScoreActive }">
                {{
                  isRecaptchaScoreActive
                    ? i18ns.t('ServerConfigView.captchaMinScoreRecaptchaHint')
                    : i18ns.t('ServerConfigView.captchaMinScoreTurnstileHint')
                }}
              </span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.captchaTrustWindowMinutes')">
              <el-input-number v-model="captchaTrustWindowMinutes" :min="0" :max="1440" :step="5" />
              <span class="form-help">
                {{ i18ns.t('ServerConfigView.captchaTrustWindowMinutesHelp') }}
              </span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingCaptcha" @click="saveCaptcha">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- SMTP Settings -->
        <el-collapse-item name="smtp">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.smtpTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.smtpHost')">
              <el-input v-model="smtpHost" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpPort')">
              <el-input-number v-model="smtpPort" :min="1" :max="65535" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpSecure')">
              <el-switch v-model="smtpSecure" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpUser')">
              <el-input v-model="smtpUser" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpPassword')">
              <el-input
                v-model="smtpPassword"
                type="password"
                show-password
                style="width: 100%; max-width: 300px"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpSenderName')">
              <el-input v-model="smtpSenderName" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.smtpSenderEmail')">
              <el-input v-model="smtpSenderEmail" style="width: 100%; max-width: 300px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingSmtp" @click="saveSmtp">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- Error Decay Settings -->
        <el-collapse-item name="errorDecay">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.errorDecayTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayEnabled')">
              <el-switch v-model="errorDecayEnabled" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.errorDecayEnabledHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayRate')">
              <el-input-number
                v-model="errorDecayRate"
                :min="0.1"
                :max="100"
                :step="0.1"
                :precision="1"
              />
              <span class="form-help">{{ i18ns.t('ServerConfigView.errorDecayRateHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayMinThreshold')">
              <el-input-number
                v-model="errorDecayMinThreshold"
                :min="0.01"
                :max="10"
                :step="0.01"
                :precision="2"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.errorDecayMinThresholdHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.errorDecayInterval')">
              <el-input-number v-model="errorDecayInterval" :min="1" :max="60" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.errorDecayIntervalHelp')
              }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingErrorDecay" @click="saveErrorDecay">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- Error Weights Settings -->
        <el-collapse-item name="errorWeights">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.errorWeightsTitle') }}</span>
          </template>
          <el-alert type="info" :closable="false" style="margin-bottom: 20px">
            <template #title>
              {{ i18ns.t('ServerConfigView.errorWeightsHelp') }}
            </template>
          </el-alert>
          <el-form label-position="top">
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.statusCodeWeights')
            }}</el-divider>
            <el-table :data="statusCodeWeights" border style="margin-bottom: 8px">
              <el-table-column :label="i18ns.t('ServerConfigView.statusCode')">
                <template #default="{ row }">
                  <el-input v-model="row.code" size="small" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ServerConfigView.weight')">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.weight"
                    :min="0"
                    :max="10"
                    :step="0.1"
                    :precision="1"
                    size="small"
                  />
                </template>
              </el-table-column>
              <el-table-column width="70">
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    link
                    size="small"
                    @click="statusCodeWeights.splice($index, 1)"
                    >{{ i18ns.t('delete') }}</el-button
                  >
                </template>
              </el-table-column>
            </el-table>
            <el-button
              size="small"
              style="margin-bottom: 20px"
              @click="statusCodeWeights.push({ code: '', weight: 1, description: '' })"
              >+ {{ i18ns.t('ServerConfigView.addRow') }}</el-button
            >
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.customCodeWeights')
            }}</el-divider>
            <el-table :data="customCodeWeights" border style="margin-bottom: 8px">
              <el-table-column :label="i18ns.t('ServerConfigView.customCode')">
                <template #default="{ row }">
                  <el-input v-model="row.code" size="small" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('ServerConfigView.weight')">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.weight"
                    :min="0"
                    :max="10"
                    :step="0.1"
                    :precision="1"
                    size="small"
                  />
                </template>
              </el-table-column>
              <el-table-column width="70">
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    link
                    size="small"
                    @click="customCodeWeights.splice($index, 1)"
                    >{{ i18ns.t('delete') }}</el-button
                  >
                </template>
              </el-table-column>
            </el-table>
            <el-button
              size="small"
              style="margin-bottom: 20px"
              @click="customCodeWeights.push({ code: '', weight: 1, description: '' })"
              >+ {{ i18ns.t('ServerConfigView.addRow') }}</el-button
            >
            <el-form-item>
              <el-button type="primary" :loading="savingErrorWeights" @click="saveErrorWeights">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- IP Ban Settings -->
        <el-collapse-item name="ipBan">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.ipBanTitle') }}</span>
          </template>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('ServerConfigView.ipBanEnabled')">
              <el-switch v-model="ipBanEnabled" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.ipBanEnabledHelp') }}</span>
            </el-form-item>
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.level1')
            }}</el-divider>
            <el-form-item :label="i18ns.t('ServerConfigView.level1Threshold')">
              <el-input-number v-model="level1Threshold" :min="1" :max="1000" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.level1Duration')">
              <el-input-number v-model="level1Duration" :min="60" :max="86400" :step="60" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.durationHelp') }}</span>
            </el-form-item>
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.level2')
            }}</el-divider>
            <el-form-item :label="i18ns.t('ServerConfigView.level2Threshold')">
              <el-input-number v-model="level2Threshold" :min="1" :max="1000" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.level2Duration')">
              <el-input-number v-model="level2Duration" :min="60" :max="604800" :step="3600" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.durationHelp') }}</span>
            </el-form-item>
            <el-divider content-position="left">{{
              i18ns.t('ServerConfigView.level3')
            }}</el-divider>
            <el-form-item :label="i18ns.t('ServerConfigView.level3Threshold')">
              <el-input-number v-model="level3Threshold" :min="1" :max="1000" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.level3Duration')">
              <el-select v-model="level3Duration" style="width: 100%; max-width: 200px">
                <el-option :label="i18ns.t('ServerConfigView.duration1Hour')" :value="3600" />
                <el-option :label="i18ns.t('ServerConfigView.duration24Hours')" :value="86400" />
                <el-option :label="i18ns.t('ServerConfigView.duration7Days')" :value="604800" />
                <el-option :label="i18ns.t('ServerConfigView.durationPermanent')" :value="-1" />
              </el-select>
              <span class="form-help">{{ i18ns.t('ServerConfigView.level3DurationHelp') }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingIpBan" @click="saveIpBan">
                {{ i18ns.t('save') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, ref, onMounted, watch, type Ref } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { configService } from '@/service/configService'
import { groupService } from '@/service/groupService'
import { NotificationService } from '@/service/notificationService'
import { userService } from '@/service/userService'
import type {
  CaptchaProviderDto,
  FeedbackAssignmentRuleDto,
  FeedbackPriority,
  FeedbackType,
  NotificationEventInfoDto,
} from '@/client/types.gen'

type Tags =
  | 'registration'
  | 'billing'
  | 'heartbeat'
  | 'remoteTerminalUnbind'
  | 'notification'
  | 'captcha'
  | 'modelRate'
  | 'smtp'
  | 'errorDecay'
  | 'errorWeights'
  | 'ipBan'

const loading = ref(false)
const activeNames: Ref<Tags[]> = ref([])

// Registration
const savingReg = ref(false)
const regEnabled = ref(false)
const maxAccountsPerEmail = ref(3)
const defaultGroupUsername = ref('user')
const codeExpiry = ref(300)
const groups = ref<any[]>([])

// Billing
const savingBilling = ref(false)
const rechargeRatio = ref(100)

// Heartbeat
const savingHeartbeat = ref(false)
const heartbeatIntervalSeconds = ref(30)
const heartbeatTimeoutSeconds = ref(90)

// Remote terminal unbind
const savingRemoteTerminalUnbind = ref(false)
const remoteTerminalUnbindMaxCount = ref(0)
const remoteTerminalUnbindWindowHours = ref(24)
const remoteTerminalRebindCooldownMinutes = ref(0)

// Notification
const savingNotification = ref(false)
const notificationDefaultSubscribedEvents = ref<string[]>([])
const notificationDefaultThresholds = ref<Record<string, number>>({})
const notificationEventOptions = ref<NotificationEventInfoDto[]>([])
const feedbackAssignmentRules = ref<FeedbackAssignmentRuleDto[]>([])
const assignmentUserOptions = ref<{ id: string; username: string }[]>([])
const assignmentUserOptionsLoading = ref(false)

// Captcha
const savingCaptcha = ref(false)
const captchaProvider = ref<CaptchaProviderDto>('none')
const captchaFallbackProvider = ref<CaptchaProviderDto>('none')
const captchaMinScore = ref(0.5)
const captchaTrustWindowMinutes = ref(30)

// SMTP
const savingSmtp = ref(false)
const smtpHost = ref('')
const smtpPort = ref(465)
const smtpSecure = ref(true)
const smtpUser = ref('')
const smtpPassword = ref('')
const smtpSenderName = ref('AppSystem')
const smtpSenderEmail = ref('')

// Error Decay
const savingErrorDecay = ref(false)
const errorDecayEnabled = ref(false)
const errorDecayRate = ref(5)
const errorDecayMinThreshold = ref(0.1)
const errorDecayInterval = ref(1)

// Error Weights
const savingErrorWeights = ref(false)
const statusCodeWeights = ref([
  { code: '400', weight: 1, description: 'Bad Request' },
  { code: '401', weight: 2, description: 'Unauthorized' },
  { code: '403', weight: 2, description: 'Forbidden' },
  { code: '429', weight: 5, description: 'Too Many Requests' },
  { code: '500', weight: 3, description: 'Internal Server Error' },
])
const customCodeWeights = ref([{ code: '1001', weight: 1, description: 'Custom Error' }])

// IP Ban
const savingIpBan = ref(false)
const ipBanEnabled = ref(false)
const level1Threshold = ref(10)
const level1Duration = ref(3600)
const level2Threshold = ref(20)
const level2Duration = ref(86400)
const level3Threshold = ref(50)
const level3Duration = ref(-1)

// Loaded flags
const registrationLoaded = ref(false)
const billingLoaded = ref(false)
const heartbeatLoaded = ref(false)
const remoteTerminalUnbindLoaded = ref(false)
const notificationLoaded = ref(false)
const captchaLoaded = ref(false)
const smtpLoaded = ref(false)
const errorDecayLoaded = ref(false)
const errorWeightsLoaded = ref(false)
const ipBanLoaded = ref(false)

const isRecaptchaScoreActive = computed(
  () => captchaProvider.value === 'recaptcha' || captchaFallbackProvider.value === 'recaptcha',
)

const captchaProviderOptions = computed(() => [
  {
    value: 'none' as CaptchaProviderDto,
    label: 'none',
    description: i18ns.t('ServerConfigView.captchaProviderNoneDesc'),
  },
  {
    value: 'recaptcha' as CaptchaProviderDto,
    label: 'reCAPTCHA',
    description: i18ns.t('ServerConfigView.captchaProviderRecaptchaDesc'),
  },
  {
    value: 'turnstile' as CaptchaProviderDto,
    label: 'Turnstile',
    description: i18ns.t('ServerConfigView.captchaProviderTurnstileDesc'),
  },
])

const captchaFallbackOptions = computed(() =>
  captchaProviderOptions.value.map((option) => ({
    ...option,
    disabled: option.value !== 'none' && option.value === captchaProvider.value,
  })),
)

const notificationService = NotificationService.getInstance()
const feedbackTypeOptions: FeedbackType[] = ['suggestion', 'bug', 'other']
const feedbackPriorityOptions: FeedbackPriority[] = ['low', 'medium', 'high', 'urgent']

const notificationThresholdEventOptions = computed(() =>
  notificationEventOptions.value.filter((event) => event.hasThreshold),
)

const normalizeNotificationThresholds = (
  thresholds: Record<string, number>,
  events: NotificationEventInfoDto[],
) => {
  const thresholdEvents = events.filter((event) => event.hasThreshold)
  const normalized: Record<string, number> = {}

  thresholdEvents.forEach((event) => {
    const value = thresholds[event.value]
    normalized[event.value] =
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  })

  return normalized
}

const selectAllNotificationDefaultEvents = () => {
  notificationDefaultSubscribedEvents.value = notificationEventOptions.value.map(
    (event) => event.value,
  )
}

const clearAllNotificationDefaultEvents = () => {
  notificationDefaultSubscribedEvents.value = []
}

const createEmptyFeedbackAssignmentRule = (): FeedbackAssignmentRuleDto => ({
  type: undefined,
  priority: undefined,
  assigneeUserIds: [],
})

const addFeedbackAssignmentRule = () => {
  feedbackAssignmentRules.value = [...feedbackAssignmentRules.value, createEmptyFeedbackAssignmentRule()]
}

const removeFeedbackAssignmentRule = (index: number) => {
  feedbackAssignmentRules.value = feedbackAssignmentRules.value.filter((_, itemIndex) => itemIndex !== index)
}

const ensureAssignmentUserOption = (userId?: string, username?: string | null) => {
  if (!userId) return
  if (assignmentUserOptions.value.some((item) => item.id === userId)) return
  assignmentUserOptions.value = [{ id: userId, username: username || userId }, ...assignmentUserOptions.value]
}

const loadAssignmentUserOptions = async (keyword?: string) => {
  assignmentUserOptionsLoading.value = true
  try {
    const result = await userService.getAllUsers({
      page: 1,
      pageSize: 50,
      keyword: keyword?.trim() || undefined,
    })
    const users = Array.isArray(result?.users) ? result.users : []
    assignmentUserOptions.value = users.map((item) => ({
      id: item.id,
      username: item.username || item.id,
    }))
  } catch {
    assignmentUserOptions.value = []
  } finally {
    assignmentUserOptionsLoading.value = false
  }
}

const handleAssignmentUserSearch = (query: string) => {
  void loadAssignmentUserOptions(query)
}

const handleAssignmentUserSelectVisible = (visible: boolean) => {
  if (visible && !assignmentUserOptions.value.length) {
    void loadAssignmentUserOptions()
  }
}

const getFeedbackTypeLabel = (type: FeedbackType) => i18ns.t(`feedback.types.${type}`)

const getFeedbackPriorityLabel = (priority: FeedbackPriority) =>
  i18ns.t(`feedback.priorities.${priority}`)

const loadRegistrationConfig = async () => {
  if (registrationLoaded.value) return
  try {
    const [regConfig, groupData] = await Promise.all([
      configService.getRegistrationConfig(),
      groupService.getAllGroups(),
    ])
    regEnabled.value = regConfig.enabled
    maxAccountsPerEmail.value = regConfig.maxAccountsPerEmail
    defaultGroupUsername.value = regConfig.defaultGroupUsername
    codeExpiry.value = regConfig.verificationCodeExpiry
    groups.value = Array.isArray(groupData) ? groupData : groupData.groups
    registrationLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadBillingConfig = async () => {
  if (billingLoaded.value) return
  try {
    const billingConfig = await configService.getBillingConfig()
    rechargeRatio.value = billingConfig.rechargeRatio
    billingLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadHeartbeatConfig = async () => {
  if (heartbeatLoaded.value) return
  try {
    const heartbeatConfig = await configService.getHeartbeatConfig()
    heartbeatIntervalSeconds.value = heartbeatConfig.intervalSeconds
    heartbeatTimeoutSeconds.value = heartbeatConfig.timeoutSeconds
    heartbeatLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadRemoteTerminalUnbindConfig = async () => {
  if (remoteTerminalUnbindLoaded.value) return
  try {
    const remoteTerminalUnbindConfig = await configService.getRemoteTerminalUnbindConfig()
    remoteTerminalUnbindMaxCount.value = remoteTerminalUnbindConfig.maxCount
    remoteTerminalUnbindWindowHours.value = remoteTerminalUnbindConfig.windowHours
    remoteTerminalRebindCooldownMinutes.value = remoteTerminalUnbindConfig.rebindCooldownMinutes
    remoteTerminalUnbindLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadNotificationConfig = async () => {
  if (notificationLoaded.value) return
  try {
    const [notificationConfig, eventResult] = await Promise.all([
      configService.getNotificationConfig(),
      notificationService.getEventList(),
    ])
    const events = Array.isArray(eventResult.data)
      ? (eventResult.data as NotificationEventInfoDto[])
      : []
    notificationEventOptions.value = events
    notificationDefaultSubscribedEvents.value = notificationConfig.defaultSubscribedEvents.filter(
      (event) => events.some((item: NotificationEventInfoDto) => item.value === event),
    )
    notificationDefaultThresholds.value = normalizeNotificationThresholds(
      notificationConfig.defaultThresholds,
      events,
    )
    feedbackAssignmentRules.value = Array.isArray(notificationConfig.feedbackAssignmentRules)
      ? notificationConfig.feedbackAssignmentRules.map((rule) => ({
          type: rule.type || undefined,
          priority: rule.priority || undefined,
          assigneeUserIds: Array.isArray(rule.assigneeUserIds) ? [...rule.assigneeUserIds] : [],
        }))
      : []
    feedbackAssignmentRules.value.forEach((rule) => {
      rule.assigneeUserIds.forEach((userId) => ensureAssignmentUserOption(userId))
    })
    notificationLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadCaptchaConfig = async () => {
  if (captchaLoaded.value) return
  try {
    const captchaConfig = await configService.getCaptchaConfig()
    captchaProvider.value = captchaConfig.provider
    captchaFallbackProvider.value = captchaConfig.fallbackProvider
    captchaMinScore.value = captchaConfig.minScore
    captchaTrustWindowMinutes.value = captchaConfig.trustWindowMinutes
    captchaLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadSmtpConfig = async () => {
  if (smtpLoaded.value) return
  try {
    const smtpConfig = await configService.getSmtpConfig()
    smtpHost.value = smtpConfig.host
    smtpPort.value = smtpConfig.port
    smtpSecure.value = smtpConfig.secure
    smtpUser.value = smtpConfig.user
    smtpPassword.value = smtpConfig.password
    smtpSenderName.value = smtpConfig.senderName
    smtpSenderEmail.value = smtpConfig.senderEmail
    smtpLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadErrorDecayConfig = async () => {
  if (errorDecayLoaded.value) return
  try {
    const configs = await configService.getConfigs([
      'ipBan.errorDecayEnabled',
      'ipBan.errorDecayRate',
      'ipBan.errorDecayMinThreshold',
      'ipBan.errorDecayInterval',
    ])
    errorDecayEnabled.value = configs['ipBan.errorDecayEnabled'] === 'true'
    errorDecayRate.value = parseFloat(configs['ipBan.errorDecayRate'] || '5')
    errorDecayMinThreshold.value = parseFloat(configs['ipBan.errorDecayMinThreshold'] || '0.1')
    errorDecayInterval.value = parseInt(configs['ipBan.errorDecayInterval'] || '1', 10)
    errorDecayLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadErrorWeightsConfig = async () => {
  if (errorWeightsLoaded.value) return
  try {
    const configs = await configService.getConfigs(['ipBan.errorWeights'])
    const errorWeightsJson = configs['ipBan.errorWeights']
    if (errorWeightsJson) {
      try {
        const weights = JSON.parse(errorWeightsJson)
        if (weights.statusCodeWeights) {
          statusCodeWeights.value = Object.entries(weights.statusCodeWeights).map(
            ([code, weight]) => ({ code, weight: weight as number, description: '' }),
          )
        }
        if (weights.customCodeWeights) {
          customCodeWeights.value = Object.entries(weights.customCodeWeights).map(
            ([code, weight]) => ({ code, weight: weight as number, description: '' }),
          )
        }
      } catch {}
    }
    errorWeightsLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadIpBanConfig = async () => {
  if (ipBanLoaded.value) return
  try {
    const ipBanConfig = await configService.getIpBanConfig()
    ipBanEnabled.value = ipBanConfig.enabled
    level1Threshold.value = ipBanConfig.level1Threshold
    level1Duration.value = ipBanConfig.level1Duration
    level2Threshold.value = ipBanConfig.level2Threshold
    level2Duration.value = ipBanConfig.level2Duration
    level3Threshold.value = ipBanConfig.level3Threshold
    level3Duration.value = ipBanConfig.level3Duration
    ipBanLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const saveRegistration = async () => {
  savingReg.value = true
  try {
    await configService.setRegistrationConfig({
      enabled: regEnabled.value,
      maxAccountsPerEmail: maxAccountsPerEmail.value,
      defaultGroupUsername: defaultGroupUsername.value,
      verificationCodeExpiry: codeExpiry.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingReg.value = false
  }
}

const saveBilling = async () => {
  savingBilling.value = true
  try {
    await configService.setBillingConfig({
      rechargeRatio: rechargeRatio.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingBilling.value = false
  }
}

const saveHeartbeat = async () => {
  savingHeartbeat.value = true
  try {
    await configService.setHeartbeatConfig({
      intervalSeconds: heartbeatIntervalSeconds.value,
      timeoutSeconds: heartbeatTimeoutSeconds.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingHeartbeat.value = false
  }
}

const saveRemoteTerminalUnbind = async () => {
  savingRemoteTerminalUnbind.value = true
  try {
    await configService.setRemoteTerminalUnbindConfig({
      maxCount: remoteTerminalUnbindMaxCount.value,
      windowHours: remoteTerminalUnbindWindowHours.value,
      rebindCooldownMinutes: remoteTerminalRebindCooldownMinutes.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingRemoteTerminalUnbind.value = false
  }
}

const saveNotification = async () => {
  savingNotification.value = true
  try {
    const normalizedRules = feedbackAssignmentRules.value
      .map((rule) => ({
        type: rule.type || undefined,
        priority: rule.priority || undefined,
        assigneeUserIds: rule.assigneeUserIds.filter((item) => item && item.trim().length > 0),
      }))
      .filter((rule) => rule.assigneeUserIds.length > 0 && (rule.type || rule.priority))

    await configService.setNotificationConfig({
      defaultSubscribedEvents: notificationDefaultSubscribedEvents.value,
      defaultThresholds: notificationDefaultThresholds.value,
      feedbackAssignmentRules: normalizedRules,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingNotification.value = false
  }
}

const saveCaptcha = async () => {
  if (captchaProvider.value === 'none' && captchaFallbackProvider.value !== 'none') {
    ElMessage.warning(i18ns.t('ServerConfigView.captchaProviderRequired'))
    return
  }

  if (captchaProvider.value !== 'none' && captchaFallbackProvider.value === captchaProvider.value) {
    ElMessage.warning(i18ns.t('ServerConfigView.captchaFallbackDistinct'))
    return
  }

  savingCaptcha.value = true
  try {
    await configService.setCaptchaConfig({
      provider: captchaProvider.value,
      fallbackProvider: captchaFallbackProvider.value,
      minScore: captchaMinScore.value,
      trustWindowMinutes: captchaTrustWindowMinutes.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingCaptcha.value = false
  }
}

watch(captchaProvider, (provider) => {
  if (provider === 'none') {
    captchaFallbackProvider.value = 'none'
    return
  }

  if (captchaFallbackProvider.value === provider) {
    captchaFallbackProvider.value = 'none'
  }
})

const saveSmtp = async () => {
  savingSmtp.value = true
  try {
    await configService.setSmtpConfig({
      host: smtpHost.value,
      port: smtpPort.value,
      secure: smtpSecure.value,
      user: smtpUser.value,
      password: smtpPassword.value,
      senderName: smtpSenderName.value,
      senderEmail: smtpSenderEmail.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingSmtp.value = false
  }
}

const saveErrorDecay = async () => {
  savingErrorDecay.value = true
  try {
    await configService.setConfigs({
      'ipBan.errorDecayEnabled': String(errorDecayEnabled.value),
      'ipBan.errorDecayRate': String(errorDecayRate.value),
      'ipBan.errorDecayMinThreshold': String(errorDecayMinThreshold.value),
      'ipBan.errorDecayInterval': String(errorDecayInterval.value),
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingErrorDecay.value = false
  }
}

const saveErrorWeights = async () => {
  savingErrorWeights.value = true
  try {
    const weights = {
      statusCodeWeights: Object.fromEntries(
        statusCodeWeights.value.map((item) => [item.code, item.weight]),
      ),
      customCodeWeights: Object.fromEntries(
        customCodeWeights.value.map((item) => [item.code, item.weight]),
      ),
    }
    await configService.setConfigs({
      'ipBan.errorWeights': JSON.stringify(weights),
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingErrorWeights.value = false
  }
}

const saveIpBan = async () => {
  savingIpBan.value = true
  try {
    await configService.setIpBanConfig({
      enabled: ipBanEnabled.value,
      level1Threshold: level1Threshold.value,
      level1Duration: level1Duration.value,
      level2Threshold: level2Threshold.value,
      level2Duration: level2Duration.value,
      level3Threshold: level3Threshold.value,
      level3Duration: level3Duration.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingIpBan.value = false
  }
}

watch(activeNames, (newNames) => {
  if (newNames.includes('registration')) loadRegistrationConfig()
  if (newNames.includes('billing')) loadBillingConfig()
  if (newNames.includes('heartbeat')) loadHeartbeatConfig()
  if (newNames.includes('remoteTerminalUnbind')) loadRemoteTerminalUnbindConfig()
  if (newNames.includes('notification')) loadNotificationConfig()
  if (newNames.includes('captcha')) loadCaptchaConfig()
  if (newNames.includes('smtp')) loadSmtpConfig()
  if (newNames.includes('errorDecay')) loadErrorDecayConfig()
  if (newNames.includes('errorWeights')) loadErrorWeightsConfig()
  if (newNames.includes('ipBan')) loadIpBanConfig()
})

onMounted(() => {
  // Load default opened panel
  if (activeNames.value.includes('registration')) loadRegistrationConfig()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.server-config {
  width: 100%;
}

.server-config-desktop {
  max-width: 1240px;
  margin: 0 auto;
  padding: 20px;
}

.server-config-mobile {
  padding: 6px 2px 12px;
}

.server-config :deep(.el-collapse) {
  border: none;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-config :deep(.el-collapse-item) {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.server-config :deep(.el-collapse-item__header) {
  min-height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid transparent;
  background: transparent;
}

.server-config :deep(.el-collapse-item.is-active .el-collapse-item__header) {
  border-bottom-color: var(--el-border-color-lighter);
}

.server-config :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.server-config :deep(.el-collapse-item__content) {
  padding: 8px 16px 16px;
}

.server-config :deep(.el-form-item) {
  margin-bottom: 16px;
}

.server-config :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.server-config-desktop :deep(.el-form-item__label) {
  font-weight: 500;
}

.server-config-desktop :deep(.el-input),
.server-config-desktop :deep(.el-select),
.server-config-desktop :deep(.el-date-editor),
.server-config-desktop :deep(.el-input-number) {
  max-width: 360px;
}

.collapse-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.form-help {
  display: block;
  margin-top: 6px;
  margin-left: 0;
  max-width: 680px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.form-help--inline {
  margin-top: 4px;
}

.form-help--active {
  color: var(--el-color-primary);
  font-weight: 500;
}

.notification-events-field {
  width: 100%;
}

.notification-events-field--mobile {
  width: 100%;
}

.notification-thresholds-field {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
}

.notification-thresholds-field--mobile {
  max-width: 100%;
}

.notification-assignment-field {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
}

.notification-assignment-field--mobile {
  max-width: 100%;
}

.assignment-rule-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  padding: 12px;
}

.assignment-rule-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.assignment-rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.assignment-rule-grid__full {
  grid-column: 1 / -1;
}

.notification-threshold-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.notification-threshold-item__label {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.notification-threshold-item__control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notification-events-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.notification-event-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  max-width: 760px;
}

.notification-event-grid--mobile {
  grid-template-columns: 1fr;
}

.notification-event-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.provider-card-group {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  max-width: 720px;
}

.provider-card-group--mobile {
  grid-template-columns: 1fr;
}

.provider-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-bg-color);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}

.provider-card--small {
  min-height: 88px;
}

.provider-card:hover {
  border-color: var(--el-color-primary-light-5);
}

.provider-card--active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset;
}

.provider-card--disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.provider-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.provider-card__desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}

.model-tags-container {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background-color: var(--el-fill-color-blank);
  min-height: 40px;
  max-width: 600px;
}

.server-config :deep(.el-button) {
  min-height: 36px;
}

.server-config-desktop :deep(.el-form-item .el-button[type='primary']) {
  min-width: 112px;
}

@media (max-width: 768px) {
  .server-config :deep(.el-collapse-item__header) {
    min-height: 48px;
    padding: 0 12px;
  }

  .server-config :deep(.el-collapse-item__content) {
    padding: 6px 12px 12px;
  }

  .notification-event-grid {
    grid-template-columns: 1fr;
  }

  .notification-threshold-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .notification-threshold-item__control {
    width: 100%;
  }

  .assignment-rule-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
.server-config-mobile-adapter {
  padding: 8px 6px 16px;
}

.server-config-mobile-adapter :deep(.hide-on-mobile) {
  display: none !important;
}

.server-config-mobile-adapter :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 12px;
}

.server-config-mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  width: 100% !important;
  line-height: 1.4;
  padding: 0 0 6px;
  font-weight: 600;
}

.server-config-mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
  width: 100%;
}

.server-config-mobile-adapter :deep(.el-input),
.server-config-mobile-adapter :deep(.el-select),
.server-config-mobile-adapter :deep(.el-date-editor),
.server-config-mobile-adapter :deep(.el-input-number),
.server-config-mobile-adapter :deep(.el-textarea),
.server-config-mobile-adapter :deep(.el-button) {
  width: 100%;
  max-width: 100% !important;
}

.server-config-mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.server-config-mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.server-config-mobile-adapter :deep(.el-form) {
  display: block;
}

.server-config-mobile-adapter :deep(.el-table) {
  font-size: 12px;
}

.server-config-mobile-adapter :deep(.el-table .el-input),
.server-config-mobile-adapter :deep(.el-table .el-input-number) {
  width: 100% !important;
}

.server-config-mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-x: auto;
}

.server-config-mobile-adapter :deep(.el-divider__text) {
  font-size: 12px;
  font-weight: 600;
}
</style>
