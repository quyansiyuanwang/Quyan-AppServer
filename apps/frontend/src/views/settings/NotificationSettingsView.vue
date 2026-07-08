<template>
  <div class="notification-settings-page-root">
    <div v-if="isDesktop" class="notification-settings-page desktop-page">
      <!-- Preferences Card -->
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
          <!-- Email -->
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

          <!-- Cooldown -->
          <el-form-item :label="i18ns.t('NotificationSettingsView.cooldownLabel')">
            <el-input-number
              v-model="prefForm.cooldownMinutes"
              :min="1"
              :max="10080"
              style="width: 160px"
            />
            <div class="form-help">{{ i18ns.t('NotificationSettingsView.cooldownHelp') }}</div>
          </el-form-item>

          <!-- Subscribed Events + Thresholds in one table -->
          <el-form-item :label="i18ns.t('NotificationSettingsView.subscribedEventsLabel')">
            <div class="events-table-wrap">
              <div class="events-table-toolbar">
                <el-button size="small" @click="selectAllEvents">{{
                  i18ns.t('NotificationSettingsView.selectAll')
                }}</el-button>
                <el-button size="small" @click="clearAllEvents">{{
                  i18ns.t('NotificationSettingsView.clearAll')
                }}</el-button>
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
                    <span :class="{ 'text-muted': !subscribedSet[row.value] }">{{
                      getEventDisplayLabel(row.value)
                    }}</span>
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

      <!-- Webhooks Card -->
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
          <el-table-column
            prop="format"
            :label="i18ns.t('NotificationSettingsView.webhookFormat')"
            width="130"
          >
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

      <!-- Notification Logs Card -->
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
              <el-tag :type="row.isRead ? 'info' : row.pixelOpened ? 'warning' : 'danger'" size="small">
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

    <div v-else class="mobile-page">
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
                      : emailTestResultError ||
                        i18ns.t('NotificationSettingsView.webhookTestFailed')
                  }}
                </span>
                <div class="form-help">{{ i18ns.t('NotificationSettingsView.emailHelp') }}</div>
              </div>
            </el-form-item>

            <el-form-item :label="i18ns.t('NotificationSettingsView.cooldownLabel')">
              <div class="mobile-stack">
                <el-input-number
                  v-model="prefForm.cooldownMinutes"
                  :min="1"
                  :max="10080"
                  class="mobile-input-number"
                />
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
                  <el-tag :type="row.isRead ? 'info' : row.pixelOpened ? 'warning' : 'danger'" size="small">
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

    <!-- Webhook Dialog -->
    <el-dialog
      v-model="webhookDialogVisible"
      :title="
        editingWebhook
          ? i18ns.t('NotificationSettingsView.webhookEdit')
          : i18ns.t('NotificationSettingsView.webhookAdd')
      "
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form :model="webhookForm" label-width="120px">
        <el-form-item :label="i18ns.t('NotificationSettingsView.webhookName')" required>
          <el-input
            v-model="webhookForm.name"
            :placeholder="i18ns.t('NotificationSettingsView.webhookNamePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('NotificationSettingsView.webhookUrl')" required>
          <el-input
            v-model="webhookForm.url"
            :placeholder="i18ns.t('NotificationSettingsView.webhookUrlPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('NotificationSettingsView.webhookFormat')">
          <el-select v-model="webhookForm.format" style="width: 100%">
            <el-option
              v-for="fmt in webhookFormats"
              :key="fmt.value"
              :label="fmt.label"
              :value="fmt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('NotificationSettingsView.webhookSecret')">
          <el-input
            v-model="webhookForm.secret"
            :placeholder="i18ns.t('NotificationSettingsView.webhookSecretPlaceholder')"
            show-password
            clearable
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('NotificationSettingsView.webhookEnabled')">
          <el-switch v-model="webhookForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <div class="dialog-footer-left">
            <el-button
              v-if="editingWebhook"
              :loading="testingWebhook"
              :icon="testResultIcon"
              @click="handleTestWebhookInDialog"
            >
              {{ i18ns.t('NotificationSettingsView.webhookTest') }}
            </el-button>
            <span v-if="testResult !== null" :class="testResult ? 'test-ok' : 'test-fail'">
              {{
                testResult
                  ? i18ns.t('NotificationSettingsView.webhookTestSuccess')
                  : testResultError || i18ns.t('NotificationSettingsView.webhookTestFailed')
              }}
            </span>
          </div>
          <div class="dialog-footer-right">
            <el-button @click="webhookDialogVisible = false">
              {{ i18ns.t('NotificationSettingsView.webhookCancel') }}
            </el-button>
            <el-button type="primary" :loading="savingWebhook" @click="submitWebhookDialog">
              {{ i18ns.t('NotificationSettingsView.webhookSave') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Refresh, CircleCheck, CircleClose } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { NotificationService } from '@/service/notificationService'
import { usePageDevice } from '@/composables/usePageDevice'
import {
  getNotificationEventLabel,
  getNotificationThresholdUnit,
} from '@/utils/notification-event-i18n'
import type {
  NotificationWebhookDto,
  NotificationEventInfoDto,
  NotificationLogDto,
  NotificationInboxItemDto,
} from '@/client/types.gen'

const service = NotificationService.getInstance()
const { isDesktop } = usePageDevice()

// ─── Preferences ────────────────────────────────────────────────────────────

const loadingPrefs = ref(false)
const savingPrefs = ref(false)
const testingEmail = ref(false)
const emailTestResult = ref<boolean | null>(null)
const emailTestResultError = ref<string>('')

const prefForm = reactive<{
  notificationEmail: string
  cooldownMinutes: number
  thresholds: Record<string, number>
}>({
  notificationEmail: '',
  cooldownMinutes: 60,
  thresholds: {},
})

// Map event value → checked boolean
const subscribedSet = reactive<Record<string, boolean>>({})

function selectAllEvents() {
  for (const ev of eventList.value) {
    subscribedSet[ev.value] = true
  }
}

function clearAllEvents() {
  for (const ev of eventList.value) {
    subscribedSet[ev.value] = false
  }
}

// ─── Events ─────────────────────────────────────────────────────────────────

const loadingEvents = ref(false)
const eventList = ref<NotificationEventInfoDto[]>([])

const thresholdEvents = computed(() =>
  eventList.value.filter((ev) => ev.hasThreshold && subscribedSet[ev.value]),
)

async function loadEventList() {
  loadingEvents.value = true
  try {
    const res = await service.getEventList()
    eventList.value = (res.data ?? []) as NotificationEventInfoDto[]
  } catch {
    // ignore
  } finally {
    loadingEvents.value = false
  }
}

// ─── Load preferences ────────────────────────────────────────────────────────

async function loadPreferences() {
  loadingPrefs.value = true
  try {
    const res = await service.getPreferences()
    const data = res.data
    prefForm.notificationEmail = data.notificationEmail ?? ''
    prefForm.cooldownMinutes = data.cooldownMinutes ?? 60
    prefForm.thresholds = { ...(data.thresholds ?? {}) }
    // Reset subscribed set
    for (const key of Object.keys(subscribedSet)) {
      subscribedSet[key] = false
    }
    for (const ev of (data.subscribedEvents ?? []) as string[]) {
      subscribedSet[ev] = true
    }
  } catch {
    // ignore
  } finally {
    loadingPrefs.value = false
  }
}

async function handleTestEmail() {
  testingEmail.value = true
  emailTestResult.value = null
  emailTestResultError.value = ''
  try {
    const res = await service.testEmail()
    emailTestResult.value = res.data?.success ?? false
    emailTestResultError.value = res.data?.error ?? ''
  } catch {
    emailTestResult.value = false
    emailTestResultError.value = i18ns.t('NotificationSettingsView.webhookTestFailed')
  } finally {
    testingEmail.value = false
  }
}

async function savePreferences() {
  savingPrefs.value = true
  try {
    const subscribedEvents = Object.entries(subscribedSet)
      .filter(([, checked]) => checked)
      .map(([key]) => key)

    // Only include thresholds for subscribed threshold events
    const thresholds: Record<string, number> = {}
    for (const ev of thresholdEvents.value) {
      const val = prefForm.thresholds[ev.value]
      if (val !== undefined) {
        thresholds[ev.value] = val
      }
    }

    await service.updatePreferences({
      notificationEmail: prefForm.notificationEmail || null,
      subscribedEvents,
      thresholds,
      cooldownMinutes: prefForm.cooldownMinutes,
    })
    ElMessage.success(i18ns.t('NotificationSettingsView.preferenceSaved'))
  } catch {
    // error handled by request interceptor
  } finally {
    savingPrefs.value = false
  }
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

const loadingWebhooks = ref(false)
const webhooks = ref<NotificationWebhookDto[]>([])

const webhookDialogVisible = ref(false)
const savingWebhook = ref(false)
const editingWebhook = ref<NotificationWebhookDto | null>(null)
const testingWebhook = ref(false)
const testResult = ref<boolean | null>(null)
const testResultError = ref<string>('')
const testResultIcon = computed(() => {
  if (testResult.value === true) return CircleCheck
  if (testResult.value === false) return CircleClose
  return undefined
})

const webhookForm = reactive({
  name: '',
  url: '',
  format: 'generic',
  secret: '',
  enabled: true,
})

const webhookFormats = computed(() => [
  { value: 'generic', label: i18ns.t('NotificationSettingsView.formats.generic') },
  { value: 'discord', label: i18ns.t('NotificationSettingsView.formats.discord') },
  { value: 'slack', label: i18ns.t('NotificationSettingsView.formats.slack') },
  { value: 'feishu', label: i18ns.t('NotificationSettingsView.formats.feishu') },
  { value: 'wechat_work', label: i18ns.t('NotificationSettingsView.formats.wechat_work') },
])

function formatLabel(fmt: string): string {
  const found = webhookFormats.value.find((f) => f.value === fmt)
  return found?.label ?? fmt
}

async function loadWebhooks() {
  loadingWebhooks.value = true
  try {
    const res = await service.listWebhooks()
    webhooks.value = (res.data ?? []) as NotificationWebhookDto[]
  } catch {
    // ignore
  } finally {
    loadingWebhooks.value = false
  }
}

function openWebhookDialog(row: NotificationWebhookDto | null) {
  editingWebhook.value = row
  testResult.value = null
  testResultError.value = ''
  if (row) {
    webhookForm.name = row.name
    webhookForm.url = row.url
    webhookForm.format = row.format
    webhookForm.secret = ''
    webhookForm.enabled = row.enabled
  } else {
    webhookForm.name = ''
    webhookForm.url = ''
    webhookForm.format = 'generic'
    webhookForm.secret = ''
    webhookForm.enabled = true
  }
  webhookDialogVisible.value = true
}

async function submitWebhookDialog() {
  if (!webhookForm.name.trim() || !webhookForm.url.trim()) return
  savingWebhook.value = true
  try {
    if (editingWebhook.value) {
      await service.updateWebhook(editingWebhook.value.id, {
        name: webhookForm.name,
        url: webhookForm.url,
        format: webhookForm.format,
        secret: webhookForm.secret || null,
        enabled: webhookForm.enabled,
      })
      ElMessage.success(i18ns.t('NotificationSettingsView.webhookUpdated'))
    } else {
      await service.createWebhook({
        name: webhookForm.name,
        url: webhookForm.url,
        format: webhookForm.format,
        secret: webhookForm.secret || null,
        enabled: webhookForm.enabled,
      })
      ElMessage.success(i18ns.t('NotificationSettingsView.webhookCreated'))
    }
    webhookDialogVisible.value = false
    await loadWebhooks()
  } catch {
    // error handled by request interceptor
  } finally {
    savingWebhook.value = false
  }
}

async function handleTestWebhook(row: NotificationWebhookDto) {
  try {
    const res = await service.testWebhook(row.id)
    if (res.data?.success) {
      ElMessage.success(i18ns.t('NotificationSettingsView.webhookTestSuccess'))
    } else {
      ElMessage.error(res.data?.error || i18ns.t('NotificationSettingsView.webhookTestFailed'))
    }
  } catch {
    ElMessage.error(i18ns.t('NotificationSettingsView.webhookTestFailed'))
  }
}

async function handleTestWebhookInDialog() {
  if (!editingWebhook.value) return
  testingWebhook.value = true
  testResult.value = null
  testResultError.value = ''
  try {
    const res = await service.testWebhook(editingWebhook.value.id)
    testResult.value = res.data?.success ?? false
    testResultError.value = res.data?.error ?? ''
  } catch {
    testResult.value = false
    testResultError.value = i18ns.t('NotificationSettingsView.webhookTestFailed')
  } finally {
    testingWebhook.value = false
  }
}

async function handleDeleteWebhook(row: NotificationWebhookDto) {
  try {
    await ElMessageBox.confirm(
      i18ns.t('NotificationSettingsView.confirmDeleteWebhook'),
      i18ns.t('confirm'),
      { type: 'warning' },
    )
    await service.deleteWebhook(row.id)
    ElMessage.success(i18ns.t('NotificationSettingsView.webhookDeleted'))
    await loadWebhooks()
  } catch {
    // cancelled or error
  }
}

// ─── Logs ────────────────────────────────────────────────────────────────────

const loadingLogs = ref(false)
const logs = ref<NotificationLogDto[]>([])
const logTotal = ref(0)
const logPage = ref(1)
const logPageSize = ref(20)

// ─── Inbox ───────────────────────────────────────────────────────────────────

const loadingInbox = ref(false)
const markingInboxRead = ref(false)
const markingInboxReadSingleId = ref<string>('')
const confirmingPixelRead = ref(false)
const inboxItems = ref<NotificationInboxItemDto[]>([])
const inboxTotal = ref(0)
const inboxUnreadCount = ref(0)
const inboxPixelOpenedUnreadCount = ref(0)
const inboxPage = ref(1)
const inboxPageSize = ref(20)
const inboxUnreadOnly = ref(false)

async function loadInbox() {
  loadingInbox.value = true
  try {
    const res = await service.getInbox(inboxPage.value, inboxPageSize.value, inboxUnreadOnly.value)
    inboxItems.value = (res.data?.items ?? []) as NotificationInboxItemDto[]
    inboxTotal.value = (res.data?.total ?? 0) as number
    inboxUnreadCount.value = (res.data?.unreadCount ?? 0) as number
    inboxPixelOpenedUnreadCount.value = (res.data?.pixelOpenedUnreadCount ?? 0) as number
  } catch {
    // ignore
  } finally {
    loadingInbox.value = false
  }
}

async function confirmPixelOpenedRead() {
  confirmingPixelRead.value = true
  try {
    const res = await service.confirmPixelOpenedRead()
    ElMessage.success(
      i18ns.t('NotificationSettingsView.confirmPixelReadSuccess', { count: res.data?.count ?? 0 }),
    )
    await loadInbox()
  } catch {
    // error handled by request interceptor
  } finally {
    confirmingPixelRead.value = false
  }
}

async function markInboxItemRead(id: string) {
  markingInboxReadSingleId.value = id
  try {
    await service.markInboxRead({ ids: [id] })
    await loadInbox()
  } catch {
    // error handled by request interceptor
  } finally {
    markingInboxReadSingleId.value = ''
  }
}

async function markAllInboxRead() {
  markingInboxRead.value = true
  try {
    await service.markInboxRead({ markAll: true })
    await loadInbox()
  } catch {
    // error handled by request interceptor
  } finally {
    markingInboxRead.value = false
  }
}

function onInboxPageChange(page: number) {
  inboxPage.value = page
  loadInbox()
}

function onInboxFilterChange() {
  inboxPage.value = 1
  loadInbox()
}

async function loadLogs() {
  loadingLogs.value = true
  try {
    const res = await service.getLogs(logPage.value, logPageSize.value)
    logs.value = (res.data?.logs ?? []) as NotificationLogDto[]
    logTotal.value = (res.data?.total ?? 0) as number
  } catch {
    // ignore
  } finally {
    loadingLogs.value = false
  }
}

function onLogPageChange(page: number) {
  logPage.value = page
  loadLogs()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eventLabel(eventType: string): string {
  return getNotificationEventLabel(eventType)
}

function getEventDisplayLabel(eventType: string): string {
  return getNotificationEventLabel(eventType)
}

function getThresholdUnitLabel(eventType: string): string {
  return getNotificationThresholdUnit(eventType)
}

function statusLabel(status: string): string {
  if (status === 'success') return i18ns.t('NotificationSettingsView.statusSuccess')
  if (status === 'failed') return i18ns.t('NotificationSettingsView.statusFailed')
  return i18ns.t('NotificationSettingsView.statusPending')
}

function statusTagType(status: string): 'success' | 'danger' | 'warning' {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  return 'warning'
}

// ─── Init ────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadEventList()
  await Promise.all([loadPreferences(), loadWebhooks(), loadInbox(), loadLogs()])
})
</script>

<style scoped>
.notification-settings-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  max-width: 80%;
  margin: 0 auto;
}

.section-card {
  width: 100%;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.section-header-with-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pref-form {
  padding-top: 8px;
}

.email-field-wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.email-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.email-test-result {
  min-height: 0;
  margin-top: 4px;
}

.form-help {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

.events-table-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
}

.events-table-toolbar {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.events-table {
  width: 100%;
  /* scrollable when events grow */
}

.text-muted {
  color: var(--el-text-color-placeholder);
}

.read-source-hint {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.threshold-unit {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.pagination {
  margin-top: 16px;
  justify-content: flex-end;
}

.empty-hint {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 24px 0;
  font-size: 14px;
}

.mobile-card-header-stack {
  align-items: flex-start;
}

.mobile-card-actions-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.mobile-inline-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mobile-inbox-list,
.mobile-log-list,
.mobile-webhook-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-inbox-item,
.mobile-log-item,
.mobile-webhook-item {
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  padding: 14px;
  background: var(--el-fill-color-extra-light);
}

.mobile-inbox-item.unread {
  border-color: var(--el-color-danger-light-5);
  background: var(--el-color-danger-light-9);
}

.mobile-inbox-top,
.mobile-log-top,
.mobile-webhook-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mobile-inbox-event,
.mobile-log-event,
.mobile-webhook-name {
  font-weight: 600;
}

.mobile-inbox-title,
.mobile-log-title {
  margin-top: 8px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.mobile-inbox-content,
.mobile-log-error,
.mobile-webhook-url {
  margin-top: 8px;
  color: var(--el-text-color-regular);
  word-break: break-word;
}

.mobile-inbox-meta,
.mobile-log-meta,
.mobile-webhook-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.dialog-footer-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.dialog-footer-right {
  display: flex;
  gap: 8px;
}

.test-ok {
  font-size: 13px;
  color: var(--el-color-success);
}

.test-fail {
  font-size: 13px;
  color: var(--el-color-danger);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-settings-mobile {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-card-header {
  gap: 8px;
}

.mobile-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.mobile-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.mobile-full-btn,
.mobile-input-number,
.mobile-stack :deep(.el-input),
.mobile-stack :deep(.el-input-number),
.mobile-stack :deep(.el-button) {
  width: 100%;
}

.mobile-events-wrap,
.mobile-event-list,
.mobile-webhook-list,
.mobile-log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-events-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mobile-event-item,
.mobile-webhook-item,
.mobile-log-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 12px;
  background: var(--el-bg-color-page);
}

.mobile-event-head,
.mobile-webhook-top,
.mobile-log-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mobile-event-head {
  justify-content: flex-start;
}

.mobile-event-copy {
  min-width: 0;
}

.mobile-event-name,
.mobile-webhook-name,
.mobile-log-event {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.mobile-event-key,
.mobile-webhook-format,
.mobile-log-meta {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.mobile-event-threshold {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color);
}

.mobile-event-threshold-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mobile-threshold-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mobile-threshold-row :deep(.el-input-number) {
  width: 140px;
}

.mobile-webhook-url,
.mobile-log-title,
.mobile-log-error {
  margin-top: 10px;
  word-break: break-word;
  line-height: 1.6;
}

.mobile-webhook-url {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mobile-webhook-actions {
  display: flex;
  gap: 4px 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.mobile-log-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mobile-log-error {
  color: var(--el-color-danger);
  font-size: 12px;
}

.mobile-pagination {
  margin-top: 14px;
  justify-content: center;
}

@media (max-width: 768px) {
  .notification-settings-page {
    max-width: 100%;
    padding: 12px;
  }

  .email-input-row {
    flex-direction: column;
    align-items: stretch;
  }

  .events-table-wrap {
    max-width: 100%;
  }

  .dialog-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .dialog-footer-left,
  .dialog-footer-right {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
