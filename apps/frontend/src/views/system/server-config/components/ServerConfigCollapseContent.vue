<template>
  <el-collapse v-model="activeNames">
    <el-collapse-item name="registration">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.registrationTitle') }}</span>
      </template>
      <el-form :label-width="labelWidth" :label-position="labelPosition">
        <el-form-item :label="i18ns.t('ServerConfigView.allowFreeRegistration')">
          <el-switch v-model="regEnabled" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.allowFreeRegistrationHelp') }}</span>
        </el-form-item>
        <el-form-item :label="i18ns.t('ServerConfigView.maxAccountsPerEmail')">
          <el-input-number v-model="maxAccountsPerEmail" :min="1" :max="100" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.maxAccountsPerEmailHelp') }}</span>
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
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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
          <el-input-number v-model="remoteTerminalRebindCooldownMinutes" :min="0" :max="525600" />
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
      <el-form :label-width="labelWidth" :label-position="labelPosition">
        <el-form-item :label="i18ns.t('ServerConfigView.notificationDefaultSubscribedEvents')">
          <div
            :class="[
              'notification-events-field',
              !isDesktop && 'notification-events-field--mobile',
            ]"
          >
            <div class="notification-events-toolbar">
              <el-button size="small" @click="selectAllNotificationDefaultEvents">
                {{ i18ns.t('ServerConfigView.notificationSelectAll') }}
              </el-button>
              <el-button size="small" @click="clearAllNotificationDefaultEvents">
                {{ i18ns.t('ServerConfigView.notificationClearAll') }}
              </el-button>
            </div>
            <el-checkbox-group v-model="notificationDefaultSubscribedEvents">
              <div
                :class="[
                  'notification-event-grid',
                  !isDesktop && 'notification-event-grid--mobile',
                ]"
              >
                <label
                  v-for="event in notificationEventOptions"
                  :key="event.value"
                  class="notification-event-option"
                >
                  <el-checkbox :value="event.value">{{
                    getEventDisplayLabel(event.value)
                  }}</el-checkbox>
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
          <div
            :class="[
              'notification-thresholds-field',
              !isDesktop && 'notification-thresholds-field--mobile',
            ]"
          >
            <div
              v-for="event in notificationThresholdEventOptions"
              :key="event.value"
              class="notification-threshold-item"
            >
              <span class="notification-threshold-item__label">{{
                getEventDisplayLabel(event.value)
              }}</span>
              <div class="notification-threshold-item__control">
                <el-input-number
                  v-model="notificationDefaultThresholds[event.value]"
                  :min="0"
                  :precision="2"
                />
                <span v-if="getThresholdUnitLabel(event.value)" class="form-help form-help--inline">
                  {{ getThresholdUnitLabel(event.value) }}
                </span>
              </div>
            </div>
            <span class="form-help">{{
              i18ns.t('ServerConfigView.notificationDefaultThresholdsHelp')
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
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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
          <div :class="['provider-card-group', !isDesktop && 'provider-card-group--mobile']">
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
          <div :class="['provider-card-group', !isDesktop && 'provider-card-group--mobile']">
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
          <span class="form-help">{{
            i18ns.t('ServerConfigView.captchaTrustWindowMinutesHelp')
          }}</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingCaptcha" @click="saveCaptcha">
            {{ i18ns.t('save') }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-collapse-item>

    <el-collapse-item name="smtp">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.smtpTitle') }}</span>
      </template>
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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

    <el-collapse-item name="site">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.siteTitle') }}</span>
      </template>
      <el-form :label-width="labelWidth" :label-position="labelPosition">
        <el-form-item :label="i18ns.t('ServerConfigView.backendPublicUrl')">
          <el-input v-model="siteBackendPublicUrl" style="width: 100%; max-width: 300px" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.backendPublicUrlHelp') }}</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingSite" @click="saveSite">
            {{ i18ns.t('save') }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-collapse-item>

    <el-collapse-item name="errorDecay">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.errorDecayTitle') }}</span>
      </template>
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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
          <span class="form-help">{{ i18ns.t('ServerConfigView.errorDecayIntervalHelp') }}</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingErrorDecay" @click="saveErrorDecay">
            {{ i18ns.t('save') }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-collapse-item>

    <el-collapse-item name="errorWeights">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.errorWeightsTitle') }}</span>
      </template>
      <el-alert type="info" :closable="false" style="margin-bottom: 20px">
        <template #title>
          {{ i18ns.t('ServerConfigView.errorWeightsHelp') }}
        </template>
      </el-alert>
      <el-form :label-width="labelWidth" :label-position="labelPosition">
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
              >
                {{ i18ns.t('delete') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button
          size="small"
          style="margin-bottom: 20px"
          @click="statusCodeWeights.push({ code: '', weight: 1, description: '' })"
        >
          + {{ i18ns.t('ServerConfigView.addRow') }}
        </el-button>
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
              >
                {{ i18ns.t('delete') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button
          size="small"
          style="margin-bottom: 20px"
          @click="customCodeWeights.push({ code: '', weight: 1, description: '' })"
        >
          + {{ i18ns.t('ServerConfigView.addRow') }}
        </el-button>
        <el-form-item>
          <el-button type="primary" :loading="savingErrorWeights" @click="saveErrorWeights">
            {{ i18ns.t('save') }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-collapse-item>

    <el-collapse-item name="socialAuth">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.socialAuthTitle') }}</span>
      </template>
      <!-- Frontend Base URL -->
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthFrontendBaseUrl') }}
        </div>
        <div class="config-form-item__control">
          <el-input
            v-model="socAuthFrontendBaseUrl"
            placeholder="https://example.com"
            style="max-width: 400px"
          />
          <span class="form-help">{{
            i18ns.t('ServerConfigView.socAuthFrontendBaseUrlHelp')
          }}</span>
        </div>
      </div>

      <el-divider>{{ i18ns.t('ServerConfigView.socAuthQrLoginEnabled') }}</el-divider>
      <div class="config-form-item">
        <div class="config-form-item__label">{{ i18ns.t('ServerConfigView.socAuthQrLoginEnabled') }}</div>
        <div class="config-form-item__control">
          <el-switch v-model="socAuthQrLoginEnabled" />
          <span class="form-help">{{
            i18ns.t('ServerConfigView.socAuthQrLoginEnabledHelp')
          }}</span>
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthStateTtlSeconds') }}
        </div>
        <div class="config-form-item__control">
          <el-input-number v-model="socAuthStateTtlSeconds" :min="30" :max="86400" :step="30" />
          <span class="form-help">{{
            i18ns.t('ServerConfigView.socAuthStateTtlSecondsHelp')
          }}</span>
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthQrLoginTtlSeconds') }}
        </div>
        <div class="config-form-item__control">
          <el-input-number
            v-model="socAuthQrLoginTtlSeconds"
            :min="30"
            :max="86400"
            :step="30"
          />
          <span class="form-help">{{
            i18ns.t('ServerConfigView.socAuthQrLoginTtlSecondsHelp')
          }}</span>
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthQrLoginPollIntervalSeconds') }}
        </div>
        <div class="config-form-item__control">
          <el-input-number
            v-model="socAuthQrLoginPollIntervalSeconds"
            :min="1"
            :max="30"
            :step="1"
          />
          <span class="form-help">{{
            i18ns.t('ServerConfigView.socAuthQrLoginPollIntervalSecondsHelp')
          }}</span>
        </div>
      </div>

      <el-divider>{{ i18ns.t('ServerConfigView.socAuthGithubEnabled') }}</el-divider>
      <div class="config-form-item">
        <div class="config-form-item__label">{{ i18ns.t('ServerConfigView.socAuthGithubEnabled') }}</div>
        <div class="config-form-item__control">
          <el-switch v-model="socAuthGithubEnabled" />
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthGithubClientId') }}
        </div>
        <div class="config-form-item__control">
          <el-input v-model="socAuthGithubClientId" style="max-width: 400px" />
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthGithubClientSecret') }}
        </div>
        <div class="config-form-item__control">
          <el-input
            v-model="socAuthGithubClientSecret"
            type="password"
            show-password
            style="max-width: 400px"
          />
        </div>
      </div>

      <el-divider>{{ i18ns.t('ServerConfigView.socAuthWechatOpenEnabled') }}</el-divider>
      <div class="config-form-item">
        <div class="config-form-item__label">{{ i18ns.t('ServerConfigView.socAuthWechatOpenEnabled') }}</div>
        <div class="config-form-item__control">
          <el-switch v-model="socAuthWechatOpenEnabled" />
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthWechatOpenAppId') }}
        </div>
        <div class="config-form-item__control">
          <el-input v-model="socAuthWechatOpenAppId" style="max-width: 400px" />
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthWechatOpenAppSecret') }}
        </div>
        <div class="config-form-item__control">
          <el-input
            v-model="socAuthWechatOpenAppSecret"
            type="password"
            show-password
            style="max-width: 400px"
          />
        </div>
      </div>

      <el-divider>{{ i18ns.t('ServerConfigView.socAuthWechatWebEnabled') }}</el-divider>
      <div class="config-form-item">
        <div class="config-form-item__label">{{ i18ns.t('ServerConfigView.socAuthWechatWebEnabled') }}</div>
        <div class="config-form-item__control">
          <el-switch v-model="socAuthWechatWebEnabled" />
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthWechatWebAppId') }}
        </div>
        <div class="config-form-item__control">
          <el-input v-model="socAuthWechatWebAppId" style="max-width: 400px" />
        </div>
      </div>
      <div class="config-form-item">
        <div class="config-form-item__label">
          {{ i18ns.t('ServerConfigView.socAuthWechatWebAppSecret') }}
        </div>
        <div class="config-form-item__control">
          <el-input
            v-model="socAuthWechatWebAppSecret"
            type="password"
            show-password
            style="max-width: 400px"
          />
        </div>
      </div>

      <el-form-item>
        <el-button type="primary" :loading="savingSocialAuth" @click="saveSocialAuth">
          {{ i18ns.t('save') }}
        </el-button>
      </el-form-item>
    </el-collapse-item>

    <el-collapse-item name="ipBan">
      <template #title>
        <span class="collapse-title">{{ i18ns.t('ServerConfigView.ipBanTitle') }}</span>
      </template>
      <el-form :label-width="labelWidth" :label-position="labelPosition">
        <el-form-item :label="i18ns.t('ServerConfigView.ipBanEnabled')">
          <el-switch v-model="ipBanEnabled" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.ipBanEnabledHelp') }}</span>
        </el-form-item>
        <el-divider content-position="left">{{ i18ns.t('ServerConfigView.level1') }}</el-divider>
        <el-form-item :label="i18ns.t('ServerConfigView.level1Threshold')">
          <el-input-number v-model="level1Threshold" :min="1" :max="1000" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
        </el-form-item>
        <el-form-item :label="i18ns.t('ServerConfigView.level1Duration')">
          <el-input-number v-model="level1Duration" :min="60" :max="86400" :step="60" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.durationHelp') }}</span>
        </el-form-item>
        <el-divider content-position="left">{{ i18ns.t('ServerConfigView.level2') }}</el-divider>
        <el-form-item :label="i18ns.t('ServerConfigView.level2Threshold')">
          <el-input-number v-model="level2Threshold" :min="1" :max="1000" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.thresholdHelp') }}</span>
        </el-form-item>
        <el-form-item :label="i18ns.t('ServerConfigView.level2Duration')">
          <el-input-number v-model="level2Duration" :min="60" :max="604800" :step="3600" />
          <span class="form-help">{{ i18ns.t('ServerConfigView.durationHelp') }}</span>
        </el-form-item>
        <el-divider content-position="left">{{ i18ns.t('ServerConfigView.level3') }}</el-divider>
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
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { i18ns } from '@/locales'
import { serverConfigContextKey } from '../context'

const props = defineProps<{
  isDesktop: boolean
}>()

const context = inject(serverConfigContextKey)

if (!context) {
  throw new Error('ServerConfig context is missing')
}

const labelPosition = computed(() => (props.isDesktop ? 'right' : 'top'))
const labelWidth = computed(() => (props.isDesktop ? '200px' : undefined))

const {
  activeNames,
  savingReg,
  regEnabled,
  maxAccountsPerEmail,
  defaultGroupUsername,
  codeExpiry,
  groups,
  saveRegistration,
  savingBilling,
  rechargeRatio,
  saveBilling,
  savingHeartbeat,
  heartbeatIntervalSeconds,
  heartbeatTimeoutSeconds,
  saveHeartbeat,
  savingRemoteTerminalUnbind,
  remoteTerminalUnbindMaxCount,
  remoteTerminalUnbindWindowHours,
  remoteTerminalRebindCooldownMinutes,
  saveRemoteTerminalUnbind,
  savingNotification,
  notificationDefaultSubscribedEvents,
  notificationDefaultThresholds,
  notificationEventOptions,
  notificationThresholdEventOptions,
  getEventDisplayLabel,
  getThresholdUnitLabel,
  selectAllNotificationDefaultEvents,
  clearAllNotificationDefaultEvents,
  saveNotification,
  savingCaptcha,
  captchaProvider,
  captchaFallbackProvider,
  captchaMinScore,
  captchaTrustWindowMinutes,
  isRecaptchaScoreActive,
  captchaProviderOptions,
  captchaFallbackOptions,
  saveCaptcha,
  savingSmtp,
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPassword,
  smtpSenderName,
  smtpSenderEmail,
  saveSmtp,
  savingSite,
  siteBackendPublicUrl,
  saveSite,
  savingSocialAuth,
  socAuthFrontendBaseUrl,
  socAuthQrLoginEnabled,
  socAuthStateTtlSeconds,
  socAuthQrLoginTtlSeconds,
  socAuthQrLoginPollIntervalSeconds,
  socAuthGithubEnabled,
  socAuthGithubClientId,
  socAuthGithubClientSecret,
  socAuthWechatOpenEnabled,
  socAuthWechatOpenAppId,
  socAuthWechatOpenAppSecret,
  socAuthWechatWebEnabled,
  socAuthWechatWebAppId,
  socAuthWechatWebAppSecret,
  saveSocialAuth,
  savingErrorDecay,
  errorDecayEnabled,
  errorDecayRate,
  errorDecayMinThreshold,
  errorDecayInterval,
  saveErrorDecay,
  savingErrorWeights,
  statusCodeWeights,
  customCodeWeights,
  saveErrorWeights,
  savingIpBan,
  ipBanEnabled,
  level1Threshold,
  level1Duration,
  level2Threshold,
  level2Duration,
  level3Threshold,
  level3Duration,
  saveIpBan,
} = context
</script>

<style scoped src="../server-config.css"></style>
