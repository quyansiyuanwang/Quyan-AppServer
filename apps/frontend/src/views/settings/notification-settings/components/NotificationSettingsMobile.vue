<script setup lang="ts">
import { useNotificationSettingsContext } from '../context'

const state = useNotificationSettingsContext()
const i18ns = state.i18ns
const savingPrefs = state.savingPrefs
const savePreferences = state.savePreferences
const loadingPrefs = state.loadingPrefs
const prefForm = state.prefForm
const testingEmail = state.testingEmail
const emailTestResult = state.emailTestResult
const emailTestResultError = state.emailTestResultError
const handleTestEmail = state.handleTestEmail
const cooldownDays = state.cooldownDays
const cooldownTime = state.cooldownTime
const dayOptions = state.dayOptions
const selectAllEvents = state.selectAllEvents
const clearAllEvents = state.clearAllEvents
const loadingEvents = state.loadingEvents
const eventList = state.eventList
const subscribedSet = state.subscribedSet
const getEventDisplayLabel = state.getEventDisplayLabel
const getThresholdUnitLabel = state.getThresholdUnitLabel
const loadingWebhooks = state.loadingWebhooks
const webhooks = state.webhooks
const openWebhookDialog = state.openWebhookDialog
const Plus = state.Plus
const formatLabel = state.formatLabel
const handleTestWebhook = state.handleTestWebhook
const handleDeleteWebhook = state.handleDeleteWebhook
const inboxUnreadCount = state.inboxUnreadCount
const inboxPixelOpenedUnreadCount = state.inboxPixelOpenedUnreadCount
const inboxUnreadOnly = state.inboxUnreadOnly
const onInboxFilterChange = state.onInboxFilterChange
const confirmingPixelRead = state.confirmingPixelRead
const confirmPixelOpenedRead = state.confirmPixelOpenedRead
const markingInboxRead = state.markingInboxRead
const markAllInboxRead = state.markAllInboxRead
const Refresh = state.Refresh
const loadingInbox = state.loadingInbox
const loadInbox = state.loadInbox
const inboxItems = state.inboxItems
const eventLabel = state.eventLabel
const markingInboxReadSingleId = state.markingInboxReadSingleId
const markInboxItemRead = state.markInboxItemRead
const inboxTotal = state.inboxTotal
const inboxPageSize = state.inboxPageSize
const inboxPage = state.inboxPage
const onInboxPageChange = state.onInboxPageChange
const loadingLogs = state.loadingLogs
const loadLogs = state.loadLogs
const logs = state.logs
const statusTagType = state.statusTagType
const statusLabel = state.statusLabel
const logTotal = state.logTotal
const logPageSize = state.logPageSize
const logPage = state.logPage
const onLogPageChange = state.onLogPageChange
</script>

<template>
  <div class="mobile-page">
    <div class="notification-settings-mobile">
      <h1 class="page-title">{{ i18ns.t('NotificationSettingsView.title') }}</h1>

      <el-card class="section-card mobile-card prefs-mobile-card">
        <template #header>
          <div class="card-header mobile-card-header">
            <span>{{ i18ns.t('NotificationSettingsView.preferenceSection') }}</span>
            <el-button type="primary" :loading="savingPrefs" @click="savePreferences">
              {{ i18ns.t('save') }}
            </el-button>
          </div>
        </template>

        <el-form
          v-loading="loadingPrefs"
          :model="prefForm"
          label-position="top"
          class="mobile-form"
        >
          <el-form-item :label="i18ns.t('NotificationSettingsView.emailLabel')">
            <div class="mobile-stack">
              <el-input
                v-model="prefForm.notificationEmail"
                :placeholder="i18ns.t('NotificationSettingsView.emailPlaceholder')"
                clearable
              />
              <el-button
                class="mobile-full-btn"
                :loading="testingEmail"
                :disabled="!prefForm.notificationEmail"
                @click="handleTestEmail"
              >
                {{ i18ns.t('NotificationSettingsView.emailTest') }}
              </el-button>
              <span
                v-if="emailTestResult !== null"
                :class="emailTestResult ? 'test-ok' : 'test-fail'"
              >
                {{
                  emailTestResult
                    ? i18ns.t('NotificationSettingsView.webhookTestSuccess')
                    : emailTestResultError || i18ns.t('NotificationSettingsView.webhookTestFailed')
                }}
              </span>
              <div class="form-help">{{ i18ns.t('NotificationSettingsView.emailHelp') }}</div>
            </div>
          </el-form-item>

          <el-form-item :label="i18ns.t('NotificationSettingsView.cooldownLabel')">
            <div class="mobile-stack">
              <div
                class="cooldown-duration-picker"
                style="display: inline-flex; align-items: center; gap: 8px"
              >
                <el-select v-model="cooldownDays" style="width: 100px">
                  <el-option
                    v-for="opt in dayOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <el-time-picker
                  v-model="cooldownTime"
                  format="HH:mm"
                  value-format="HH:mm"
                  style="width: 130px"
                />
              </div>
              <div class="form-help">{{ i18ns.t('NotificationSettingsView.cooldownHelp') }}</div>
            </div>
          </el-form-item>

          <el-form-item :label="i18ns.t('NotificationSettingsView.subscribedEventsLabel')">
            <div class="mobile-events-wrap">
              <div class="mobile-events-toolbar">
                <el-button size="small" @click="selectAllEvents">
                  {{ i18ns.t('NotificationSettingsView.selectAll') }}
                </el-button>
                <el-button size="small" @click="clearAllEvents">
                  {{ i18ns.t('NotificationSettingsView.clearAll') }}
                </el-button>
              </div>

              <div v-loading="loadingEvents" class="mobile-event-list">
                <div v-for="row in eventList" :key="row.value" class="mobile-event-item">
                  <div class="mobile-event-head">
                    <el-checkbox v-model="subscribedSet[row.value]" />
                    <div class="mobile-event-copy">
                      <div class="mobile-event-name">{{ getEventDisplayLabel(row.value) }}</div>
                      <div class="mobile-event-key">{{ row.value }}</div>
                    </div>
                  </div>

                  <div v-if="row.hasThreshold" class="mobile-event-threshold">
                    <span class="mobile-event-threshold-label">
                      {{ i18ns.t('NotificationSettingsView.eventThreshold') }}
                    </span>
                    <div class="mobile-threshold-row">
                      <el-input-number
                        v-model="prefForm.thresholds[row.value]"
                        :min="0"
                        :precision="2"
                        :disabled="!subscribedSet[row.value]"
                        size="small"
                      />
                      <span class="threshold-unit">{{ getThresholdUnitLabel(row.value) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card class="section-card mobile-card">
        <template #header>
          <div class="card-header mobile-card-header">
            <span>{{ i18ns.t('NotificationSettingsView.webhookSection') }}</span>
            <el-button type="primary" :icon="Plus" @click="openWebhookDialog(null)">
              {{ i18ns.t('create') }}
            </el-button>
          </div>
        </template>

        <div v-loading="loadingWebhooks" class="mobile-webhook-list">
          <template v-if="webhooks.length > 0">
            <div v-for="row in webhooks" :key="row.id" class="mobile-webhook-item">
              <div class="mobile-webhook-top">
                <div>
                  <div class="mobile-webhook-name">{{ row.name }}</div>
                  <div class="mobile-webhook-format">{{ formatLabel(row.format) }}</div>
                </div>
                <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                  {{ row.enabled ? i18ns.t('NotificationSettingsView.webhookEnabled') : '-' }}
                </el-tag>
              </div>

              <div class="mobile-webhook-url">{{ row.url }}</div>

              <div class="mobile-webhook-actions">
                <el-button text type="primary" @click="handleTestWebhook(row)">
                  {{ i18ns.t('NotificationSettingsView.webhookTest') }}
                </el-button>
                <el-button text type="primary" @click="openWebhookDialog(row)">
                  {{ i18ns.t('NotificationSettingsView.webhookEdit') }}
                </el-button>
                <el-button text type="danger" @click="handleDeleteWebhook(row)">
                  {{ i18ns.t('NotificationSettingsView.webhookDelete') }}
                </el-button>
              </div>
            </div>
          </template>
          <el-empty v-else :description="i18ns.t('NotificationSettingsView.noWebhooks')" />
        </div>
      </el-card>

      <el-card class="section-card mobile-card">
        <template #header>
          <div class="card-header mobile-card-header mobile-card-header-stack">
            <div class="section-header-with-meta">
              <span>{{ i18ns.t('NotificationSettingsView.inboxSection') }}</span>
              <el-tag v-if="inboxUnreadCount > 0" type="danger" size="small">
                {{ i18ns.t('NotificationSettingsView.unreadCount', { count: inboxUnreadCount }) }}
              </el-tag>
              <el-tag v-if="inboxPixelOpenedUnreadCount > 0" type="warning" size="small">
                {{
                  i18ns.t('NotificationSettingsView.pixelOpenedCount', {
                    count: inboxPixelOpenedUnreadCount,
                  })
                }}
              </el-tag>
            </div>
            <div class="mobile-card-actions-wrap">
              <el-switch
                v-model="inboxUnreadOnly"
                :active-text="i18ns.t('NotificationSettingsView.unreadOnly')"
                @change="onInboxFilterChange"
              />
              <div class="mobile-inline-actions">
                <el-button
                  :disabled="inboxPixelOpenedUnreadCount === 0"
                  :loading="confirmingPixelRead"
                  @click="confirmPixelOpenedRead"
                >
                  {{ i18ns.t('NotificationSettingsView.confirmPixelRead') }}
                </el-button>
                <el-button
                  :disabled="inboxUnreadCount === 0"
                  :loading="markingInboxRead"
                  @click="markAllInboxRead"
                >
                  {{ i18ns.t('NotificationSettingsView.markAllRead') }}
                </el-button>
                <el-button :icon="Refresh" :loading="loadingInbox" @click="loadInbox">
                  {{ i18ns.t('refresh') }}
                </el-button>
              </div>
            </div>
          </div>
        </template>

        <div v-loading="loadingInbox" class="mobile-inbox-list">
          <template v-if="inboxItems.length > 0">
            <div
              v-for="row in inboxItems"
              :key="row.id"
              class="mobile-inbox-item"
              :class="{ unread: !row.isRead }"
            >
              <div class="mobile-inbox-top">
                <div class="mobile-inbox-event">{{ eventLabel(row.eventType) }}</div>
                <el-tag
                  :type="row.isRead ? 'info' : row.pixelOpened ? 'warning' : 'danger'"
                  size="small"
                >
                  {{
                    row.isRead
                      ? i18ns.t('NotificationSettingsView.readStatusRead')
                      : row.pixelOpened
                        ? i18ns.t('NotificationSettingsView.readStatusPixelOpened')
                        : i18ns.t('NotificationSettingsView.readStatusUnread')
                  }}
                </el-tag>
              </div>
              <div class="mobile-inbox-title">{{ row.title }}</div>
              <div class="mobile-inbox-content">{{ row.content }}</div>
              <div v-if="row.isRead && row.readSource" class="read-source-hint">
                {{
                  row.readSource === 'pixel'
                    ? i18ns.t('NotificationSettingsView.readSourcePixel')
                    : i18ns.t('NotificationSettingsView.readSourceManual')
                }}
              </div>
              <div class="mobile-inbox-meta">
                <span>{{ new Date(row.createTime).toLocaleString() }}</span>
                <el-button
                  text
                  type="primary"
                  :disabled="row.isRead"
                  :loading="markingInboxReadSingleId === row.id"
                  @click="markInboxItemRead(row.id)"
                >
                  {{ i18ns.t('NotificationSettingsView.markRead') }}
                </el-button>
              </div>
            </div>
          </template>
          <el-empty v-else :description="i18ns.t('NotificationSettingsView.noInbox')" />
        </div>

        <el-pagination
          v-if="inboxTotal > 0"
          class="mobile-pagination"
          background
          layout="prev, pager, next"
          :total="inboxTotal"
          :page-size="inboxPageSize"
          :current-page="inboxPage"
          @current-change="onInboxPageChange"
        />
      </el-card>

      <el-card class="section-card mobile-card">
        <template #header>
          <div class="card-header mobile-card-header">
            <span>{{ i18ns.t('NotificationSettingsView.logsSection') }}</span>
            <el-button :icon="Refresh" :loading="loadingLogs" @click="loadLogs">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <div v-loading="loadingLogs" class="mobile-log-list">
          <template v-if="logs.length > 0">
            <div v-for="row in logs" :key="row.id" class="mobile-log-item">
              <div class="mobile-log-top">
                <div class="mobile-log-event">{{ eventLabel(row.eventType) }}</div>
                <el-tag :type="statusTagType(row.deliveryStatus)" size="small">
                  {{ statusLabel(row.deliveryStatus) }}
                </el-tag>
              </div>
              <div class="mobile-log-title">{{ row.title }}</div>
              <div class="mobile-log-meta">
                <span>
                  {{
                    row.channel === 'email'
                      ? i18ns.t('NotificationSettingsView.channelEmail')
                      : i18ns.t('NotificationSettingsView.channelWebhook')
                  }}
                </span>
                <span>{{ new Date(row.createTime).toLocaleString() }}</span>
              </div>
              <div v-if="row.errorMessage" class="mobile-log-error">{{ row.errorMessage }}</div>
            </div>
          </template>
          <el-empty v-else :description="i18ns.t('NotificationSettingsView.noLogs')" />
        </div>

        <el-pagination
          v-if="logTotal > 0"
          class="mobile-pagination"
          background
          layout="prev, pager, next"
          :total="logTotal"
          :page-size="logPageSize"
          :current-page="logPage"
          @current-change="onLogPageChange"
        />
      </el-card>
    </div>
  </div>
</template>
