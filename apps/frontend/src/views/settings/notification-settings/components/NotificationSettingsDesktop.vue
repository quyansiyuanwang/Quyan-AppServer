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
  <div class="notification-settings-page desktop-page">
    <el-card class="page-card section-card">
      <template #header>
        <div class="card-header">
          <span>{{ i18ns.t('NotificationSettingsView.preferenceSection') }}</span>
          <el-button type="primary" :loading="savingPrefs" @click="savePreferences">
            {{ i18ns.t('NotificationSettingsView.savePreferences') }}
          </el-button>
        </div>
      </template>

      <el-form v-loading="loadingPrefs" :model="prefForm" label-width="160px" class="pref-form">
        <el-form-item :label="i18ns.t('NotificationSettingsView.emailLabel')">
          <div class="email-field-wrap">
            <div class="email-input-row">
              <el-input
                v-model="prefForm.notificationEmail"
                :placeholder="i18ns.t('NotificationSettingsView.emailPlaceholder')"
                clearable
                style="max-width: 360px"
              />
              <el-button
                :loading="testingEmail"
                :disabled="!prefForm.notificationEmail"
                @click="handleTestEmail"
              >
                {{ i18ns.t('NotificationSettingsView.emailTest') }}
              </el-button>
            </div>
            <span
              v-if="emailTestResult !== null"
              :class="emailTestResult ? 'test-ok' : 'test-fail'"
              style="display: block; margin-top: 4px"
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
          <div class="cooldown-duration-picker" style="display: inline-flex; align-items: center; gap: 8px;">
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
        </el-form-item>

        <el-form-item :label="i18ns.t('NotificationSettingsView.subscribedEventsLabel')">
          <div class="events-table-wrap">
            <div class="events-table-toolbar">
              <el-button size="small" @click="selectAllEvents">
                {{ i18ns.t('NotificationSettingsView.selectAll') }}
              </el-button>
              <el-button size="small" @click="clearAllEvents">
                {{ i18ns.t('NotificationSettingsView.clearAll') }}
              </el-button>
            </div>
            <el-table
              v-loading="loadingEvents"
              :data="eventList"
              :show-header="true"
              size="small"
              class="events-table"
              max-height="280"
            >
              <el-table-column width="52">
                <template #default="{ row }">
                  <el-checkbox v-model="subscribedSet[row.value]" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('NotificationSettingsView.eventName')">
                <template #default="{ row }">
                  <span :class="{ 'text-muted': !subscribedSet[row.value] }">
                    {{ getEventDisplayLabel(row.value) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('NotificationSettingsView.eventThreshold')"
                width="240"
              >
                <template #default="{ row }">
                  <template v-if="row.hasThreshold">
                    <el-input-number
                      v-model="prefForm.thresholds[row.value]"
                      :min="0"
                      :precision="2"
                      :disabled="!subscribedSet[row.value]"
                      size="small"
                      style="width: 130px"
                    />
                    <span class="threshold-unit">{{ getThresholdUnitLabel(row.value) }}</span>
                  </template>
                  <span v-else class="text-muted">—</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="page-card section-card">
      <template #header>
        <div class="card-header">
          <span>{{ i18ns.t('NotificationSettingsView.webhookSection') }}</span>
          <el-button type="primary" :icon="Plus" @click="openWebhookDialog(null)">
            {{ i18ns.t('NotificationSettingsView.webhookAdd') }}
          </el-button>
        </div>
      </template>

      <el-table v-loading="loadingWebhooks" :data="webhooks">
        <el-table-column prop="name" :label="i18ns.t('NotificationSettingsView.webhookName')" />
        <el-table-column
          prop="url"
          :label="i18ns.t('NotificationSettingsView.webhookUrl')"
          show-overflow-tooltip
        />
        <el-table-column :label="i18ns.t('NotificationSettingsView.webhookFormat')" width="130">
          <template #default="{ row }">
            {{ formatLabel(row.format) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('NotificationSettingsView.webhookEnabled')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
              {{ row.enabled ? i18ns.t('NotificationSettingsView.webhookEnabled') : '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="200">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleTestWebhook(row)">
              {{ i18ns.t('NotificationSettingsView.webhookTest') }}
            </el-button>
            <el-button link type="primary" @click="openWebhookDialog(row)">
              {{ i18ns.t('NotificationSettingsView.webhookEdit') }}
            </el-button>
            <el-button link type="danger" @click="handleDeleteWebhook(row)">
              {{ i18ns.t('NotificationSettingsView.webhookDelete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="page-card section-card">
      <template #header>
        <div class="card-header inbox-card-header">
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
          <div class="section-actions">
            <el-switch
              v-model="inboxUnreadOnly"
              :active-text="i18ns.t('NotificationSettingsView.unreadOnly')"
              @change="onInboxFilterChange"
            />
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
      </template>

      <el-table v-loading="loadingInbox" :data="inboxItems">
        <el-table-column width="110">
          <template #default="{ row }">
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
            <div v-if="row.isRead && row.readSource" class="read-source-hint">
              {{
                row.readSource === 'pixel'
                  ? i18ns.t('NotificationSettingsView.readSourcePixel')
                  : i18ns.t('NotificationSettingsView.readSourceManual')
              }}
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('NotificationSettingsView.logEvent')" width="180">
          <template #default="{ row }">
            {{ eventLabel(row.eventType) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="title"
          :label="i18ns.t('NotificationSettingsView.inboxTitle')"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column
          prop="content"
          :label="i18ns.t('NotificationSettingsView.inboxContent')"
          min-width="320"
          show-overflow-tooltip
        />
        <el-table-column :label="i18ns.t('NotificationSettingsView.logTime')" width="180">
          <template #default="{ row }">
            {{ new Date(row.createTime).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="row.isRead"
              :loading="markingInboxReadSingleId === row.id"
              @click="markInboxItemRead(row.id)"
            >
              {{ i18ns.t('NotificationSettingsView.markRead') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="inboxTotal === 0 && !loadingInbox" class="empty-hint">
        {{ i18ns.t('NotificationSettingsView.noInbox') }}
      </div>

      <el-pagination
        v-if="inboxTotal > 0"
        class="pagination"
        background
        layout="prev, pager, next"
        :total="inboxTotal"
        :page-size="inboxPageSize"
        :current-page="inboxPage"
        @current-change="onInboxPageChange"
      />
    </el-card>

    <el-card class="page-card section-card">
      <template #header>
        <div class="card-header">
          <span>{{ i18ns.t('NotificationSettingsView.logsSection') }}</span>
          <el-button :icon="Refresh" :loading="loadingLogs" @click="loadLogs">
            {{ i18ns.t('refresh') }}
          </el-button>
        </div>
      </template>

      <el-table v-loading="loadingLogs" :data="logs">
        <el-table-column :label="i18ns.t('NotificationSettingsView.logEvent')" width="180">
          <template #default="{ row }">
            {{ eventLabel(row.eventType) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="title"
          :label="i18ns.t('NotificationSettingsView.logTitle')"
          show-overflow-tooltip
        />
        <el-table-column :label="i18ns.t('NotificationSettingsView.logChannel')" width="100">
          <template #default="{ row }">
            {{
              row.channel === 'email'
                ? i18ns.t('NotificationSettingsView.channelEmail')
                : i18ns.t('NotificationSettingsView.channelWebhook')
            }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('NotificationSettingsView.logStatus')" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.deliveryStatus)" size="small">
              {{ statusLabel(row.deliveryStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('NotificationSettingsView.logTime')" width="180">
          <template #default="{ row }">
            {{ new Date(row.createTime).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column
          :label="i18ns.t('NotificationSettingsView.logError')"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ row.errorMessage ?? '-' }}
          </template>
        </el-table-column>
      </el-table>

      <div v-if="logTotal === 0 && !loadingLogs" class="empty-hint">
        {{ i18ns.t('NotificationSettingsView.noLogs') }}
      </div>

      <el-pagination
        v-if="logTotal > 0"
        class="pagination"
        background
        layout="prev, pager, next"
        :total="logTotal"
        :page-size="logPageSize"
        :current-page="logPage"
        @current-change="onLogPageChange"
      />
    </el-card>
  </div>
</template>
