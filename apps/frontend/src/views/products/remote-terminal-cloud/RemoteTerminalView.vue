<template>
  <div class="remote-terminal-page">
    <el-row :gutter="20">
      <el-col :xs="24" :lg="8" :xl="7">
        <el-card shadow="never" class="page-card sidebar-card">
          <template #header>
            <div class="page-header toolbar-row">
              <div class="header-left">
                <el-icon :size="24" class="header-icon">
                  <Monitor />
                </el-icon>
                <div>
                  <h1 class="page-title">{{ i18ns.t('nav.remoteTerminal') }}</h1>
                  <p class="page-subtitle">{{ i18ns.t('remoteTerminal.description') }}</p>
                </div>
              </div>
              <el-button :icon="Refresh" :loading="loading" @click="refreshAll">
                {{ i18ns.t('refresh') }}
              </el-button>
            </div>
          </template>

          <el-alert
            v-if="errorMessage"
            :title="errorMessage"
            type="error"
            :closable="false"
            show-icon
            class="section-block"
          />

          <div class="section-block">
            <div class="section-label">{{ i18ns.t('remoteTerminal.devices') }}</div>
            <el-empty
              v-if="!loading && devices.length === 0"
              :description="i18ns.t('remoteTerminal.noDevices')"
              :image-size="96"
            />

            <div v-else class="device-list">
              <button
                v-for="device in devices"
                :key="device.deviceId"
                type="button"
                class="device-card"
                :class="{ active: currentTab?.deviceId === device.deviceId }"
                @click="selectDeviceForCurrentTab(device.deviceId)"
              >
                <div class="device-card-top">
                  <div>
                    <div class="device-name">{{ device.hostname }}</div>
                    <div class="device-meta">{{ device.platform }} · {{ device.arch }}</div>
                  </div>
                  <el-tag :type="device.online ? 'success' : 'info'" round size="small">
                    {{
                      device.online
                        ? i18ns.t('remoteTerminal.online')
                        : i18ns.t('remoteTerminal.offline')
                    }}
                  </el-tag>
                </div>
                <div class="device-time">
                  {{ i18ns.t('remoteTerminal.lastSeenAt') }}:
                  {{ formatDateTime(device.lastSeenAt) }}
                </div>
              </button>
            </div>
          </div>

          <div class="action-panel">
            <div class="quota-panel">
              <div class="quota-grid">
                <div class="quota-card">
                  <div class="quota-card-label">{{ i18ns.t('remoteTerminal.terminalQuota') }}</div>
                  <div class="quota-card-value">
                    {{ usageSummary.activeSessionCount }}/{{ usageSummary.totalTerminalLimit }}
                  </div>
                </div>
                <div class="quota-card">
                  <div class="quota-card-label">{{ i18ns.t('remoteTerminal.deviceQuota') }}</div>
                  <div class="quota-card-value">
                    {{ usageSummary.activeDeviceCount }}/{{ usageSummary.totalDeviceLimit }}
                  </div>
                </div>
              </div>
              <div v-if="connectBlockedReason" class="quota-warning">
                {{ connectBlockedReason }}
              </div>
            </div>
            <div class="action-row action-row-top">
              <el-select
                v-model="currentShellType"
                class="shell-select"
                :disabled="
                  !currentSelectedDevice ||
                  availableShellOptions.length === 0 ||
                  currentSessionConnecting
                "
              >
                <el-option
                  v-for="shellType in availableShellOptions"
                  :key="shellType"
                  :label="getShellTypeLabel(shellType)"
                  :value="shellType"
                />
              </el-select>
            </div>
            <div class="action-row action-row-bottom">
              <el-button
                type="primary"
                class="action-button"
                :disabled="
                  !currentSelectedOnlineDeviceId || currentSessionConnecting || connectBlocked
                "
                :loading="currentSessionConnecting"
                @click="connectCurrentTerminal"
              >
                {{ i18ns.t('remoteTerminal.connect') }}
              </el-button>
              <el-button
                :icon="RefreshRight"
                class="action-button"
                :disabled="!currentCanReconnect || currentSessionConnecting"
                @click="reconnectCurrentTerminal"
              >
                {{ i18ns.t('remoteTerminal.reconnect') }}
              </el-button>
              <el-button
                class="action-button"
                :disabled="!currentSocketConnected"
                @click="disconnectCurrentTerminal()"
              >
                {{ i18ns.t('remoteTerminal.disconnect') }}
              </el-button>
            </div>
          </div>

          <div class="section-block working-directory-panel">
            <div class="section-label section-label-row">
              <span>{{ i18ns.t('remoteTerminal.openLocation') }}</span>
              <el-tag v-if="defaultWorkingDirectory" size="small" type="info" round>
                {{ i18ns.t('remoteTerminal.locationRememberedTag') }}
              </el-tag>
            </div>
            <div class="working-directory-value">
              {{ currentWorkingDirectoryDisplay }}
            </div>
            <div class="working-directory-hint">
              {{ i18ns.t('remoteTerminal.openLocationHint') }}
            </div>
            <div class="action-row working-directory-actions">
              <el-button class="action-button" @click="openWorkingDirectoryDialog">
                {{ i18ns.t('remoteTerminal.changeOpenLocation') }}
              </el-button>
              <el-button class="action-button" @click="resetRememberedWorkingDirectory">
                {{ i18ns.t('remoteTerminal.resetLocationMemory') }}
              </el-button>
            </div>
          </div>

          <div
            v-if="currentSelectedDevice && availableShellOptions.length === 0"
            class="section-hint"
          >
            {{ i18ns.t('remoteTerminal.shellTypeUnavailable') }}
          </div>

          <div class="section-block status-panel">
            <div class="section-label">{{ i18ns.t('status') }}</div>
            <div class="status-text">{{ currentDisplayStatusText }}</div>
            <div v-if="currentRetryCountdownSeconds !== null" class="retry-hint">
              {{ i18ns.t('remoteTerminal.retryHint') }}
            </div>
          </div>

          <div class="section-block retry-policy-panel">
            <div class="retry-policy-header">
              <div class="section-label retry-policy-title">
                {{ i18ns.t('remoteTerminal.retryPolicy') }}
              </div>
              <el-button
                text
                type="warning"
                :disabled="!currentAutoReconnectPending"
                @click="cancelCurrentAutoReconnect"
              >
                {{ i18ns.t('remoteTerminal.cancelRetry') }}
              </el-button>
            </div>
            <div class="retry-policy-grid">
              <label class="retry-policy-item">
                <span class="retry-policy-label">{{
                  i18ns.t('remoteTerminal.retryMaxAttempts')
                }}</span>
                <el-input-number v-model="currentRetryMaxAttempts" :min="1" :max="10" />
              </label>
              <label class="retry-policy-item">
                <span class="retry-policy-label">{{
                  i18ns.t('remoteTerminal.retryDelaySeconds')
                }}</span>
                <el-input-number v-model="currentRetryDelaySeconds" :min="1" :max="60" />
              </label>
            </div>
          </div>

          <div class="section-block">
            <div class="section-label">{{ i18ns.t('remoteTerminal.recentSessions') }}</div>
            <el-table :data="paginatedSessions" size="small" stripe>
              <el-table-column
                prop="deviceId"
                :label="i18ns.t('remoteTerminal.deviceId')"
                min-width="120"
              />
              <el-table-column prop="status" :label="i18ns.t('status')" width="110" />
              <el-table-column :label="i18ns.t('remoteTerminal.createdAt')" min-width="160">
                <template #default="scope">
                  {{ formatDateTime(scope.row.createdAt) }}
                </template>
              </el-table-column>
            </el-table>
            <div v-if="sortedSessions.length > sessionPageSize" class="sessions-pagination">
              <el-pagination
                size="small"
                background
                layout="prev, pager, next"
                :current-page="sessionPage"
                :page-size="sessionPageSize"
                :total="sortedSessions.length"
                @current-change="handleSessionPageChange"
              />
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="16" :xl="17">
        <el-card shadow="never" class="page-card terminal-card">
          <template #header>
            <div class="terminal-header">
              <div>
                <div class="terminal-title">{{ i18ns.t('remoteTerminal.consoleTitle') }}</div>
                <div class="terminal-subtitle">{{ currentDeviceLabel }}</div>
              </div>
              <div class="terminal-actions">
                <el-tag :type="currentSocketConnected ? 'success' : 'info'" round>
                  {{
                    currentSocketConnected
                      ? i18ns.t('remoteTerminal.connected')
                      : i18ns.t('remoteTerminal.disconnected')
                  }}
                </el-tag>
                <el-tag
                  v-if="currentSocketConnected && currentTab"
                  :type="
                    currentTab.rttMs === null
                      ? 'danger'
                      : currentTab.rttMs > 300
                        ? 'warning'
                        : 'success'
                  "
                  round
                >
                  {{
                    currentTab.rttMs === null
                      ? i18ns.t('remoteTerminal.networkPoor')
                      : currentTab.rttMs > 300
                        ? `${i18ns.t('remoteTerminal.networkWeak')} ${currentTab.rttMs}ms`
                        : `${i18ns.t('remoteTerminal.networkGood')} ${currentTab.rttMs}ms`
                  }}
                </el-tag>
                <el-button :icon="Plus" text @click="addTerminalTab()">
                  {{ i18ns.t('remoteTerminal.newTab') }}
                </el-button>
                <el-button :icon="Link" text @click="copySessionLink">
                  {{ i18ns.t('remoteTerminal.copyLink') }}
                </el-button>
                <el-button :icon="FullScreen" text @click="toggleFullscreen">
                  {{
                    isFullscreen
                      ? i18ns.t('remoteTerminal.exitFullscreen')
                      : i18ns.t('remoteTerminal.fullscreen')
                  }}
                </el-button>
              </div>
            </div>
          </template>

          <el-tabs
            v-model="activeTabId"
            type="card"
            class="terminal-tabs"
            @tab-remove="removeTerminalTab"
          >
            <el-tab-pane
              v-for="(tab, index) in tabs"
              :key="tab.tabId"
              :name="tab.tabId"
              :label="getTabTitle(tab, index)"
              :closable="tabs.length > 1"
            >
              <div
                :ref="(el) => setTerminalContainerRef(tab.tabId, el as HTMLDivElement | null)"
                class="terminal-container"
                :class="{ fullscreen: isFullscreen && activeTabId === tab.tabId }"
              >
                <div class="session-meta">
                  <span
                    >{{ i18ns.t('remoteTerminal.sessionId') }}:
                    {{ tab.activeSessionId || '—' }}</span
                  >
                  <span
                    >{{ i18ns.t('remoteTerminal.openLocationShort') }}:
                    {{ formatWorkingDirectoryLabel(tab.workingDirectory) }}</span
                  >
                  <span>{{ i18ns.t('remoteTerminal.linkHint') }}</span>
                </div>
                <div
                  :ref="(el) => setTerminalHostRef(tab.tabId, el as HTMLDivElement | null)"
                  class="terminal-host"
                />
                <div class="shortcut-panel">
                  <div class="shortcut-panel-header">
                    <div>
                      <div class="section-label shortcut-panel-title">
                        {{ i18ns.t('remoteTerminal.shortcuts') }}
                      </div>
                      <div class="shortcut-panel-hint">
                        {{ i18ns.t('remoteTerminal.shortcutsHint') }}
                      </div>
                    </div>
                    <div class="shortcut-panel-actions">
                      <el-button text @click="openQuickCommandDialog()">
                        {{ i18ns.t('remoteTerminal.manageQuickCommands') }}
                      </el-button>
                      <el-button text @click="openShortcutDialog()">
                        {{ i18ns.t('remoteTerminal.manageShortcuts') }}
                      </el-button>
                      <el-button text @click="restoreDefaultShortcuts">
                        {{ i18ns.t('remoteTerminal.resetShortcuts') }}
                      </el-button>
                    </div>
                  </div>

                  <div class="modifier-locks">
                    <el-check-tag
                      :checked="modifierLocks.ctrl"
                      @change="setModifierLock('ctrl', $event)"
                    >
                      Ctrl
                    </el-check-tag>
                    <el-check-tag
                      :checked="modifierLocks.alt"
                      @change="setModifierLock('alt', $event)"
                    >
                      Alt
                    </el-check-tag>
                    <el-check-tag
                      :checked="modifierLocks.shift"
                      @change="setModifierLock('shift', $event)"
                    >
                      Shift
                    </el-check-tag>
                    <el-check-tag
                      :checked="modifierLocks.meta"
                      @change="setModifierLock('meta', $event)"
                    >
                      Meta
                    </el-check-tag>
                    <el-button text class="modifier-clear" @click="clearModifierLocks">
                      {{ i18ns.t('remoteTerminal.clearModifiers') }}
                    </el-button>
                  </div>

                  <div class="shortcut-grid">
                    <button
                      v-for="shortcut in shortcutButtons"
                      :key="shortcut.id"
                      type="button"
                      class="shortcut-button"
                      size="small"
                      :disabled="!currentSocketConnected"
                      @click="sendShortcutToCurrentTerminal(shortcut)"
                    >
                      <span class="shortcut-button-label">
                        {{ getShortcutDisplayLabel(shortcut) }}
                      </span>
                    </button>
                  </div>
                  <div class="quick-command-panel">
                    <div class="section-label shortcut-panel-title">
                      {{ i18ns.t('remoteTerminal.quickCommands') }}
                    </div>
                    <div v-if="quickCommands.length === 0" class="shortcut-panel-hint">
                      {{ i18ns.t('remoteTerminal.noQuickCommands') }}
                    </div>
                    <div v-else class="quick-command-grid">
                      <button
                        v-for="command in quickCommands"
                        :key="command.id"
                        type="button"
                        class="shortcut-button quick-command-button"
                        :disabled="!currentSocketConnected"
                        @click="sendQuickCommand(command)"
                      >
                        <span class="shortcut-button-label">{{ command.label }}</span>
                        <span class="shortcut-button-preview">{{
                          omitStr(command.command, 20)
                        }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog
      v-model="workingDirectoryDialogVisible"
      :title="i18ns.t('remoteTerminal.changeOpenLocation')"
      width="520px"
    >
      <el-form label-position="top">
        <el-form-item :label="i18ns.t('remoteTerminal.openLocation')">
          <el-tree-select
            :key="directoryTreeRenderKey"
            v-model="workingDirectoryDraft"
            class="directory-tree-select"
            :placeholder="i18ns.t('remoteTerminal.openLocationPlaceholder')"
            clearable
            check-strictly
            filterable
            lazy
            :cache-data="directoryTreeCacheData"
            :disabled="!currentSelectedOnlineDeviceId"
            :load="loadRemoteDirectoryTree"
            :props="directoryTreeProps"
          />
        </el-form-item>
        <div class="directory-browser-toolbar">
          <el-button
            :disabled="!currentSelectedOnlineDeviceId || directoryBrowserLoading"
            @click="browseRemoteDirectory(workingDirectoryDraft || undefined)"
          >
            {{ i18ns.t('remoteTerminal.browseCurrentDirectory') }}
          </el-button>
          <el-button
            :disabled="
              !currentSelectedOnlineDeviceId ||
              directoryBrowserLoading ||
              !directoryBrowser.parentPath
            "
            @click="browseRemoteDirectory(directoryBrowser.parentPath)"
          >
            {{ i18ns.t('remoteTerminal.goParentDirectory') }}
          </el-button>
          <el-button
            :disabled="!currentSelectedOnlineDeviceId || directoryBrowserLoading"
            @click="browseRemoteDirectory()"
          >
            {{ i18ns.t('remoteTerminal.browseRootDirectory') }}
          </el-button>
        </div>
        <div class="dialog-hint directory-browser-current">
          {{ i18ns.t('remoteTerminal.currentRemoteDirectory') }}:
          {{ directoryBrowser.currentPath || i18ns.t('remoteTerminal.remoteDirectoryRoot') }}
        </div>
        <div v-if="directoryBrowserLoading" class="directory-browser-empty">
          {{ i18ns.t('remoteTerminal.loadingDirectories') }}
        </div>
        <div class="dialog-hint">{{ i18ns.t('remoteTerminal.openLocationDialogHint') }}</div>
      </el-form>
      <template #footer>
        <el-button @click="workingDirectoryDialogVisible = false">{{ i18ns.t('close') }}</el-button>
        <el-button @click="clearWorkingDirectoryDraft">
          {{ i18ns.t('remoteTerminal.clearOpenLocation') }}
        </el-button>
        <el-button type="primary" @click="saveWorkingDirectoryDraft">
          {{ i18ns.t('remoteTerminal.applyOpenLocation') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="shortcutDialogVisible"
      :title="i18ns.t('remoteTerminal.manageShortcuts')"
      width="720px"
    >
      <div class="shortcut-manager">
        <div class="shortcut-manager-list">
          <div class="shortcut-manager-title">
            {{ i18ns.t('remoteTerminal.customShortcuts') }}
          </div>
          <el-empty
            v-if="customShortcuts.length === 0"
            :description="i18ns.t('remoteTerminal.noCustomShortcuts')"
            :image-size="88"
          />
          <div v-else class="custom-shortcut-list">
            <div v-for="shortcut in customShortcuts" :key="shortcut.id" class="custom-shortcut-row">
              <div class="custom-shortcut-content">
                <div class="custom-shortcut-name">{{ getShortcutDisplayLabel(shortcut) }}</div>
                <div class="custom-shortcut-meta">{{ describeShortcut(shortcut) }}</div>
              </div>
              <div class="custom-shortcut-actions">
                <el-button text @click="openShortcutDialog(shortcut)">
                  {{ i18ns.t('remoteTerminal.editShortcut') }}
                </el-button>
                <el-button text type="danger" @click="deleteShortcut(shortcut.id)">
                  {{ i18ns.t('remoteTerminal.deleteShortcut') }}
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="shortcut-manager-editor">
          <div class="shortcut-manager-title">
            {{
              shortcutEditMode === 'create'
                ? i18ns.t('remoteTerminal.addShortcut')
                : i18ns.t('remoteTerminal.editShortcut')
            }}
          </div>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('remoteTerminal.shortcutLabel')">
              <el-input
                v-model="shortcutDraft.label"
                :placeholder="i18ns.t('remoteTerminal.shortcutLabelPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('remoteTerminal.shortcutType')">
              <el-radio-group v-model="shortcutDraft.kind">
                <el-radio-button label="key">
                  {{ i18ns.t('remoteTerminal.shortcutTypeKey') }}
                </el-radio-button>
                <el-radio-button label="sequence">
                  {{ i18ns.t('remoteTerminal.shortcutTypeSequence') }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
            <template v-if="shortcutDraft.kind === 'key'">
              <el-form-item :label="i18ns.t('remoteTerminal.shortcutKey')">
                <div class="shortcut-key-editor">
                  <el-input
                    v-model="shortcutDraft.key"
                    :placeholder="i18ns.t('remoteTerminal.shortcutKeyPlaceholder')"
                  />
                  <el-button
                    :type="isShortcutCaptureActive ? 'danger' : 'primary'"
                    plain
                    @click="toggleShortcutCapture"
                  >
                    {{
                      isShortcutCaptureActive
                        ? i18ns.t('remoteTerminal.stopShortcutCapture')
                        : i18ns.t('remoteTerminal.captureShortcutKey')
                    }}
                  </el-button>
                </div>
              </el-form-item>
              <el-form-item :label="i18ns.t('remoteTerminal.shortcutModifiers')">
                <el-checkbox-group v-model="shortcutDraft.modifiers">
                  <el-checkbox label="ctrl">Ctrl</el-checkbox>
                  <el-checkbox label="alt">Alt</el-checkbox>
                  <el-checkbox label="shift">Shift</el-checkbox>
                  <el-checkbox label="meta">Meta</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <div class="dialog-hint">
                {{
                  isShortcutCaptureActive
                    ? i18ns.t('remoteTerminal.shortcutCaptureListeningHint')
                    : i18ns.t('remoteTerminal.shortcutCaptureHint')
                }}
              </div>
            </template>
            <template v-else>
              <el-form-item :label="i18ns.t('remoteTerminal.shortcutSequence')">
                <el-input
                  v-model="shortcutDraft.sequenceText"
                  type="textarea"
                  :rows="4"
                  :placeholder="i18ns.t('remoteTerminal.shortcutSequencePlaceholder')"
                />
              </el-form-item>
            </template>
            <div class="dialog-hint">{{ i18ns.t('remoteTerminal.shortcutEditorHint') }}</div>
            <div class="shortcut-editor-actions">
              <el-button @click="resetShortcutDraft">{{
                i18ns.t('remoteTerminal.clearShortcutDraft')
              }}</el-button>
              <el-button type="primary" @click="saveShortcutDraft">
                {{
                  shortcutEditMode === 'create'
                    ? i18ns.t('remoteTerminal.addShortcut')
                    : i18ns.t('remoteTerminal.saveShortcut')
                }}
              </el-button>
            </div>
          </el-form>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="quickCommandDialogVisible"
      :title="i18ns.t('remoteTerminal.manageQuickCommands')"
      :width="!useIsDesktopStore().useIsDesktop() ? '90%' : '1145px'"
    >
      <div class="shortcut-manager">
        <div class="shortcut-manager-list">
          <div class="shortcut-manager-title">
            {{ i18ns.t('remoteTerminal.quickCommands') }}
          </div>
          <el-empty
            v-if="quickCommands.length === 0"
            :description="i18ns.t('remoteTerminal.noQuickCommands')"
            :image-size="88"
          />
          <div v-else class="custom-shortcut-list">
            <div v-for="command in quickCommands" :key="command.id" class="custom-shortcut-row">
              <div class="custom-shortcut-content">
                <div class="custom-shortcut-name">{{ command.label }}</div>
                <div class="custom-shortcut-meta">{{ command.command }}</div>
              </div>
              <div class="custom-shortcut-actions">
                <el-button text @click="openQuickCommandDialog(command)">
                  {{ i18ns.t('remoteTerminal.editQuickCommand') }}
                </el-button>
                <el-button text @click="sendQuickCommand(command)">
                  {{ i18ns.t('remoteTerminal.sendQuickCommand') }}
                </el-button>
                <el-button text type="danger" @click="deleteQuickCommand(command.id)">
                  {{ i18ns.t('remoteTerminal.deleteQuickCommand') }}
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="shortcut-manager-editor">
          <div class="shortcut-manager-title">
            {{
              quickCommandEditMode === 'create'
                ? i18ns.t('remoteTerminal.addQuickCommand')
                : i18ns.t('remoteTerminal.editQuickCommand')
            }}
          </div>
          <el-form label-position="top">
            <el-form-item :label="i18ns.t('remoteTerminal.quickCommandLabel')">
              <el-input
                v-model="quickCommandDraft.label"
                :placeholder="i18ns.t('remoteTerminal.quickCommandLabelPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('remoteTerminal.quickCommandContent')">
              <el-input
                v-model="quickCommandDraft.command"
                type="textarea"
                :rows="5"
                :placeholder="i18ns.t('remoteTerminal.quickCommandPlaceholder')"
              />
            </el-form-item>
            <div class="dialog-hint">{{ i18ns.t('remoteTerminal.quickCommandHint') }}</div>
            <div class="shortcut-editor-actions">
              <el-button @click="resetQuickCommandDraft">
                {{ i18ns.t('remoteTerminal.clearQuickCommandDraft') }}
              </el-button>
              <el-button type="primary" @click="saveQuickCommandDraft">
                {{
                  quickCommandEditMode === 'create'
                    ? i18ns.t('remoteTerminal.addQuickCommand')
                    : i18ns.t('remoteTerminal.saveQuickCommand')
                }}
              </el-button>
            </div>
          </el-form>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { FullScreen, Link, Monitor, Plus, Refresh, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { i18ns } from '@/locales'
import type {
  RemoteTerminalAgentPreferencesDto,
  RemoteTerminalDirectoryBrowseDto,
  RemoteTerminalDeviceDto,
  RemoteTerminalSessionSummaryDto,
  RemoteTerminalShellType,
  RemoteTerminalShortcutDto,
  RemoteTerminalUsageSummaryDto,
  UpdateRemoteTerminalAgentPreferencesRequest,
} from '@/client/types.gen'
import { remoteTerminalService } from '@/service/remoteTerminalService'
import { getErrorMessage } from '@/utils/error-utils'
import {
  buildTerminalSequenceFromShortcut,
  defaultRemoteTerminalModifierLocks,
  formatKeyCombo,
  getDefaultRemoteTerminalShortcuts,
  getShortcutDisplayLabel,
  sanitizeRemoteTerminalShortcuts,
  type RemoteTerminalModifierLocks,
  type RemoteTerminalShortcut,
  type RemoteTerminalShortcutModifier,
} from '@/utils/remoteTerminalShortcuts'
import { useIsDesktopStore } from '@/stores/isDesktopStore'
import { omitStr } from '@/utils/common'

type RemoteTerminalSocketMessage =
  | { type: 'browser-connected'; sessionId: string }
  | { type: 'session-ready'; sessionId: string }
  | { type: 'session-output'; sessionId: string; data: string }
  | { type: 'session-exit'; sessionId: string; exitCode: number | null }
  | { type: 'session-error'; sessionId: string; message: string }
  | { type: 'browser-pong'; ts: number }

type TerminalTabState = {
  tabId: string
  title: string
  deviceId: string
  shellType: RemoteTerminalShellType
  workingDirectory: string
  activeSessionId: string | null
  lastConnectedDeviceId: string
  socket: WebSocket | null
  socketConnected: boolean
  sessionConnecting: boolean
  statusText: string
  retryCountdownSeconds: number | null
  retryAttempt: number
  retryMaxAttempts: number
  retryDelaySeconds: number
  autoReconnectPending: boolean
  terminal: Terminal | null
  fitAddon: FitAddon | null
  resizeObserver: ResizeObserver | null
  retryCountdownTimer: number | null
  retryStartTimer: number | null
  localEchoBuffer: string
  pendingRemoteEchoLine: string | null
  pendingEchoChars: string
  pendingLocalClear: boolean
  isSessionReady: boolean
  hasSessionExited: boolean
  rttMs: number | null
  pingTimer: number | null
  lastPongAt: number | null
}

type TerminalInputModeSnapshot = {
  isAlternateBuffer: boolean
  isApplicationCursorKeys: boolean
  isBracketedPasteMode: boolean
  isFocusReportingMode: boolean
}

type QuickCommand = {
  id: string
  label: string
  command: string
}

type AgentPreferenceState = {
  defaultWorkingDirectory: string
  shortcuts: RemoteTerminalShortcut[]
  quickCommands: QuickCommand[]
}

type RemoteTerminalDirectoryTreeOption = {
  value: string
  label: string
  path: string
  isLeaf: boolean
}

type RemoteTerminalDirectoryTreeNode = {
  level: number
  isLeaf?: boolean
  data?: RemoteTerminalDirectoryTreeOption
}

type RemoteTerminalDirectoryTreeResolve = (data: RemoteTerminalDirectoryTreeOption[]) => void

const loading = ref(false)
const errorMessage = ref('')
const devices = ref<RemoteTerminalDeviceDto[]>([])
const sessions = ref<RemoteTerminalSessionSummaryDto[]>([])
const usageSummary = reactive<RemoteTerminalUsageSummaryDto>({
  activeSessionCount: 0,
  totalTerminalLimit: 0,
  remainingTerminalCount: 0,
  activeDeviceCount: 0,
  totalDeviceLimit: 0,
  remainingDeviceCount: 0,
  terminalQuotaReached: false,
  deviceQuotaReached: false,
})
const sessionPage = ref(1)
const tabs = ref<TerminalTabState[]>([])
const activeTabId = ref('')
const isFullscreen = ref(false)
const defaultWorkingDirectory = ref('')
const shortcutButtons = ref<RemoteTerminalShortcut[]>(getDefaultRemoteTerminalShortcuts())
const modifierLocks = reactive<RemoteTerminalModifierLocks>(defaultRemoteTerminalModifierLocks())
const workingDirectoryDialogVisible = ref(false)
const workingDirectoryDraft = ref('')
const directoryTreeRenderKey = ref(0)
const shortcutDialogVisible = ref(false)
const quickCommandDialogVisible = ref(false)
const shortcutEditMode = ref<'create' | 'edit'>('create')
const editingShortcutId = ref('')
const quickCommandEditMode = ref<'create' | 'edit'>('create')
const editingQuickCommandId = ref('')
const isShortcutCaptureActive = ref(false)
const quickCommands = ref<QuickCommand[]>([])
const directoryBrowserLoading = ref(false)
const preferenceLoading = ref(false)
const directoryTreeCacheData = ref<RemoteTerminalDirectoryTreeOption[]>([])
const directoryBrowser = reactive<RemoteTerminalDirectoryBrowseDto>({
  currentPath: '',
  parentPath: undefined,
  items: [],
})
const directoryTreeProps = {
  label: 'label',
  children: 'children',
  isLeaf: 'isLeaf',
} as const
const shortcutDraft = reactive({
  label: '',
  kind: 'key' as RemoteTerminalShortcut['kind'],
  key: '',
  modifiers: [] as RemoteTerminalShortcutModifier[],
  sequenceText: '',
})
const quickCommandDraft = reactive({
  label: '',
  command: '',
})

const route = useRoute()

const intentionalCloseSockets = new WeakSet<WebSocket>()
const terminalHostRefs = new Map<string, HTMLDivElement>()
const terminalContainerRefs = new Map<string, HTMLDivElement>()
const agentPreferenceCache = new Map<string, AgentPreferenceState>()
let tabSequence = 0
const sessionPageSize = 5

function normalizeWorkingDirectory(value: string | null | undefined) {
  return value?.trim() ?? ''
}

function getDirectoryNodeLabel(path: string) {
  const normalized = normalizeWorkingDirectory(path).replace(/[\\/]+$/, '')
  if (!normalized) {
    return i18ns.t('remoteTerminal.remoteDirectoryRoot')
  }

  const segments = normalized.split(/[/\\]+/).filter(Boolean)
  if (segments.length === 0) {
    return normalized
  }

  return segments[segments.length - 1] || normalized
}

function upsertDirectoryTreeCacheData(nodes: RemoteTerminalDirectoryTreeOption[]) {
  if (nodes.length === 0) {
    return
  }

  const cacheMap = new Map(directoryTreeCacheData.value.map((item) => [item.value, item]))
  for (const node of nodes) {
    cacheMap.set(node.value, node)
  }
  directoryTreeCacheData.value = [...cacheMap.values()]
}

function createDirectoryTreeOption(
  path: string,
  label = getDirectoryNodeLabel(path),
  isLeaf = false,
): RemoteTerminalDirectoryTreeOption {
  return {
    value: path,
    label,
    path,
    isLeaf,
  }
}

function mapBrowseItemsToTreeOptions(
  items: RemoteTerminalDirectoryBrowseDto['items'],
): RemoteTerminalDirectoryTreeOption[] {
  return items.map((item) => createDirectoryTreeOption(item.path, item.name, false))
}

function resetDirectoryTree(forceSelectedPath?: string) {
  directoryTreeRenderKey.value += 1
  directoryTreeCacheData.value = []

  const normalized = normalizeWorkingDirectory(forceSelectedPath)
  if (normalized) {
    upsertDirectoryTreeCacheData([createDirectoryTreeOption(normalized)])
  }
}

function formatWorkingDirectoryLabel(value: string | null | undefined) {
  const normalized = normalizeWorkingDirectory(value)
  return normalized || i18ns.t('remoteTerminal.systemDefaultLocation')
}

function sanitizeQuickCommands(value: unknown): QuickCommand[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const candidate = item as Partial<QuickCommand>
      const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
      const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
      const command = typeof candidate.command === 'string' ? candidate.command : ''
      if (!id || !label || !command.trim()) {
        return null
      }

      return {
        id,
        label,
        command,
      }
    })
    .filter((item): item is QuickCommand => Boolean(item))
}

function cloneShortcut(shortcut: RemoteTerminalShortcut): RemoteTerminalShortcut {
  return {
    ...shortcut,
    sequence: [...shortcut.sequence],
    modifiers: shortcut.modifiers ? [...shortcut.modifiers] : undefined,
  }
}

function cloneQuickCommand(command: QuickCommand): QuickCommand {
  return {
    ...command,
  }
}

function cloneAgentPreferenceState(state: AgentPreferenceState): AgentPreferenceState {
  return {
    defaultWorkingDirectory: state.defaultWorkingDirectory,
    shortcuts: state.shortcuts.map(cloneShortcut),
    quickCommands: state.quickCommands.map(cloneQuickCommand),
  }
}

function createDefaultAgentPreferenceState(): AgentPreferenceState {
  return {
    defaultWorkingDirectory: '',
    shortcuts: getDefaultRemoteTerminalShortcuts(),
    quickCommands: [],
  }
}

function normalizePreferenceShortcuts(value: unknown) {
  const sanitized = sanitizeRemoteTerminalShortcuts(value)
  return sanitized.length > 0 ? sanitized : getDefaultRemoteTerminalShortcuts()
}

function normalizeAgentPreferences(
  payload?: Partial<RemoteTerminalAgentPreferencesDto> | null,
): AgentPreferenceState {
  return {
    defaultWorkingDirectory: normalizeWorkingDirectory(payload?.defaultWorkingDirectory),
    shortcuts: normalizePreferenceShortcuts(payload?.shortcuts),
    quickCommands: sanitizeQuickCommands(payload?.quickCommands),
  }
}

function applyAgentPreferenceState(state: AgentPreferenceState) {
  const cloned = cloneAgentPreferenceState(state)
  defaultWorkingDirectory.value = cloned.defaultWorkingDirectory
  shortcutButtons.value = cloned.shortcuts
  quickCommands.value = cloned.quickCommands

  if (currentTab.value) {
    currentTab.value.workingDirectory = cloned.defaultWorkingDirectory
  }
}

function updateAgentPreferenceCache(deviceId: string, state: AgentPreferenceState) {
  agentPreferenceCache.set(deviceId, cloneAgentPreferenceState(state))
}

function getCurrentPreferenceDeviceId() {
  return currentTab.value?.deviceId ?? ''
}

async function loadAgentPreferencesForDevice(deviceId: string, options?: { silent?: boolean }) {
  if (!deviceId) {
    applyAgentPreferenceState(createDefaultAgentPreferenceState())
    return
  }

  const cached = agentPreferenceCache.get(deviceId)
  if (cached) {
    applyAgentPreferenceState(cached)
  } else {
    applyAgentPreferenceState(createDefaultAgentPreferenceState())
  }

  const device = getDeviceById(deviceId)
  if (!device?.online) {
    return
  }

  preferenceLoading.value = true
  try {
    const result = await remoteTerminalService.getAgentPreferences(deviceId)
    const normalized = normalizeAgentPreferences(result)
    updateAgentPreferenceCache(deviceId, normalized)

    if (getCurrentPreferenceDeviceId() === deviceId) {
      applyAgentPreferenceState(normalized)
    }
  } catch (error) {
    if (!options?.silent) {
      ElMessage.error(getErrorMessage(error, i18ns.t('remoteTerminal.loadFailed')))
    }
  } finally {
    preferenceLoading.value = false
  }
}

function buildAgentPreferencesPayload(
  deviceId: string,
  state: AgentPreferenceState,
): UpdateRemoteTerminalAgentPreferencesRequest {
  return {
    deviceId,
    defaultWorkingDirectory: state.defaultWorkingDirectory || null,
    shortcuts: state.shortcuts.map((shortcut) => ({
      ...shortcut,
      sequence: [...shortcut.sequence],
      modifiers: shortcut.modifiers ? [...shortcut.modifiers] : undefined,
    })) as RemoteTerminalShortcutDto[],
    quickCommands: state.quickCommands.map((command) => ({
      ...command,
    })),
  }
}

async function persistAgentPreferencesForCurrentDevice(
  nextState: AgentPreferenceState,
  successMessage?: string,
) {
  const deviceId = getCurrentPreferenceDeviceId()
  if (!deviceId) {
    ElMessage.warning(i18ns.t('remoteTerminal.noDeviceSelected'))
    return false
  }

  const device = getDeviceById(deviceId)
  if (!device?.online) {
    ElMessage.warning(i18ns.t('remoteTerminal.selectOnlineDevice'))
    return false
  }

  try {
    const result = await remoteTerminalService.updateAgentPreferences(
      buildAgentPreferencesPayload(deviceId, nextState),
    )
    const normalized = normalizeAgentPreferences(result)
    updateAgentPreferenceCache(deviceId, normalized)

    if (getCurrentPreferenceDeviceId() === deviceId) {
      applyAgentPreferenceState(normalized)
    }

    if (successMessage) {
      ElMessage.success(successMessage)
    }

    return true
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('remoteTerminal.loadFailed')))
    return false
  }
}

function decodeShortcutSequenceText(value: string) {
  return value
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\e/g, '\u001b')
}

const createTabId = () => `terminal-tab-${Date.now()}-${++tabSequence}`

const createTerminalTab = (
  seed?: Partial<Pick<TerminalTabState, 'deviceId' | 'shellType' | 'title' | 'workingDirectory'>>,
): TerminalTabState => ({
  tabId: createTabId(),
  title: seed?.title ?? '',
  deviceId: seed?.deviceId ?? '',
  shellType: seed?.shellType ?? 'system-default',
  workingDirectory: seed?.workingDirectory ?? defaultWorkingDirectory.value,
  activeSessionId: null,
  lastConnectedDeviceId: '',
  socket: null,
  socketConnected: false,
  sessionConnecting: false,
  statusText: i18ns.t('remoteTerminal.idle'),
  retryCountdownSeconds: null,
  retryAttempt: 0,
  retryMaxAttempts: 3,
  retryDelaySeconds: 5,
  autoReconnectPending: false,
  terminal: null,
  fitAddon: null,
  resizeObserver: null,
  retryCountdownTimer: null,
  retryStartTimer: null,
  localEchoBuffer: '',
  pendingRemoteEchoLine: null,
  pendingEchoChars: '',
  pendingLocalClear: false,
  isSessionReady: false,
  hasSessionExited: false,
  rttMs: null,
  pingTimer: null,
  lastPongAt: null,
})

const currentTab = computed(() => tabs.value.find((tab) => tab.tabId === activeTabId.value) ?? null)

const currentWorkingDirectory = computed<string>({
  get: () => currentTab.value?.workingDirectory ?? '',
  set: (value) => {
    if (currentTab.value) {
      currentTab.value.workingDirectory = normalizeWorkingDirectory(value)
    }
  },
})

const currentWorkingDirectoryDisplay = computed(() =>
  formatWorkingDirectoryLabel(currentWorkingDirectory.value),
)

const customShortcuts = computed(() => shortcutButtons.value.filter((shortcut) => !shortcut.preset))

const shortcutCaptureModifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta'])

const getDeviceById = (deviceId: string) =>
  devices.value.find((device) => device.deviceId === deviceId) ?? null

const currentSelectedDevice = computed(() =>
  currentTab.value ? getDeviceById(currentTab.value.deviceId) : null,
)

const currentSelectedOnlineDeviceId = computed(() =>
  currentSelectedDevice.value?.online ? currentSelectedDevice.value.deviceId : '',
)

const currentSessionConnecting = computed(() => currentTab.value?.sessionConnecting ?? false)
const currentSocketConnected = computed(() => currentTab.value?.socketConnected ?? false)
const currentRetryCountdownSeconds = computed(() => currentTab.value?.retryCountdownSeconds ?? null)
const currentAutoReconnectPending = computed(() => currentTab.value?.autoReconnectPending ?? false)

const currentCanReconnect = computed(() => {
  if (!currentTab.value) {
    return false
  }

  return Boolean(currentSelectedOnlineDeviceId.value || currentTab.value.lastConnectedDeviceId)
})

const connectBlocked = computed(() => usageSummary.terminalQuotaReached)

const connectBlockedReason = computed(() => {
  if (usageSummary.totalTerminalLimit <= 0) {
    return i18ns.t('remoteTerminal.noTerminalQuota')
  }

  if (usageSummary.terminalQuotaReached) {
    return i18ns.t('remoteTerminal.terminalQuotaReachedHint', {
      used: usageSummary.activeSessionCount,
      limit: usageSummary.totalTerminalLimit,
    })
  }

  return ''
})

const availableShellOptions = computed<RemoteTerminalShellType[]>(
  () => currentSelectedDevice.value?.availableShells ?? [],
)

const currentShellType = computed<RemoteTerminalShellType>({
  get: () => currentTab.value?.shellType ?? 'system-default',
  set: (value) => {
    if (currentTab.value) {
      currentTab.value.shellType = value
    }
  },
})

const describeShortcut = (shortcut: RemoteTerminalShortcut) => {
  if (shortcut.kind === 'key') {
    return formatKeyCombo(shortcut.key ?? '', shortcut.modifiers ?? [])
  }

  return shortcut.sequence.map((item) => JSON.stringify(item)).join(' · ')
}

const setModifierLock = (modifier: RemoteTerminalShortcutModifier, checked: boolean) => {
  modifierLocks[modifier] = checked
}

const clearModifierLocks = () => {
  Object.assign(modifierLocks, defaultRemoteTerminalModifierLocks())
}

const openWorkingDirectoryDialog = () => {
  workingDirectoryDraft.value = currentWorkingDirectory.value
  workingDirectoryDialogVisible.value = true
  resetDirectoryTree(currentWorkingDirectory.value)

  if (currentSelectedOnlineDeviceId.value) {
    void browseRemoteDirectory(currentWorkingDirectory.value || undefined)
  } else {
    applyDirectoryBrowseResult({
      currentPath: '',
      parentPath: undefined,
      items: [],
    })
  }
}

const clearWorkingDirectoryDraft = () => {
  workingDirectoryDraft.value = ''
}

const applyDirectoryBrowseResult = (payload: RemoteTerminalDirectoryBrowseDto) => {
  directoryBrowser.currentPath = payload.currentPath
  directoryBrowser.parentPath = payload.parentPath
  directoryBrowser.items = payload.items
  upsertDirectoryTreeCacheData(mapBrowseItemsToTreeOptions(payload.items))

  const currentPath = normalizeWorkingDirectory(payload.currentPath)
  if (currentPath) {
    upsertDirectoryTreeCacheData([
      createDirectoryTreeOption(
        currentPath,
        getDirectoryNodeLabel(currentPath),
        payload.items.length === 0,
      ),
    ])
  }
}

const browseRemoteDirectory = async (targetPath?: string) => {
  if (!currentSelectedOnlineDeviceId.value) {
    ElMessage.warning(i18ns.t('remoteTerminal.selectOnlineDevice'))
    return
  }

  directoryBrowserLoading.value = true
  try {
    const result = await remoteTerminalService.browseDirectories(
      currentSelectedOnlineDeviceId.value,
      targetPath,
    )
    applyDirectoryBrowseResult(result)

    const normalizedTargetPath = normalizeWorkingDirectory(targetPath)
    if (normalizedTargetPath) {
      workingDirectoryDraft.value = normalizedTargetPath
      upsertDirectoryTreeCacheData([createDirectoryTreeOption(normalizedTargetPath)])
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('remoteTerminal.browseDirectoriesFailed')))
  } finally {
    directoryBrowserLoading.value = false
  }
}

const loadRemoteDirectoryTree = async (
  node: RemoteTerminalDirectoryTreeNode,
  resolve: RemoteTerminalDirectoryTreeResolve,
) => {
  if (!currentSelectedOnlineDeviceId.value) {
    resolve([])
    return
  }

  if (node.isLeaf) {
    resolve([])
    return
  }

  directoryBrowserLoading.value = true
  try {
    const targetPath = node.level === 0 ? undefined : node.data?.path
    const result = await remoteTerminalService.browseDirectories(
      currentSelectedOnlineDeviceId.value,
      targetPath,
    )
    applyDirectoryBrowseResult(result)
    const treeOptions = mapBrowseItemsToTreeOptions(result.items)

    if (node.data?.path) {
      upsertDirectoryTreeCacheData([
        createDirectoryTreeOption(node.data.path, node.data.label, treeOptions.length === 0),
      ])
    }

    resolve(treeOptions)
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('remoteTerminal.browseDirectoriesFailed')))
    resolve([])
  } finally {
    directoryBrowserLoading.value = false
  }
}

const saveWorkingDirectoryDraft = async () => {
  const nextWorkingDirectory = normalizeWorkingDirectory(workingDirectoryDraft.value)
  const saved = await persistAgentPreferencesForCurrentDevice(
    {
      defaultWorkingDirectory: nextWorkingDirectory,
      shortcuts: shortcutButtons.value.map(cloneShortcut),
      quickCommands: quickCommands.value.map(cloneQuickCommand),
    },
    i18ns.t('remoteTerminal.locationRemembered'),
  )

  if (!saved) {
    return
  }

  currentWorkingDirectory.value = nextWorkingDirectory
  workingDirectoryDialogVisible.value = false
}

const resetRememberedWorkingDirectory = async () => {
  const saved = await persistAgentPreferencesForCurrentDevice(
    {
      defaultWorkingDirectory: '',
      shortcuts: shortcutButtons.value.map(cloneShortcut),
      quickCommands: quickCommands.value.map(cloneQuickCommand),
    },
    i18ns.t('remoteTerminal.locationMemoryCleared'),
  )

  if (!saved) {
    return
  }

  currentWorkingDirectory.value = ''
}

const resetShortcutDraft = () => {
  isShortcutCaptureActive.value = false
  shortcutEditMode.value = 'create'
  editingShortcutId.value = ''
  shortcutDraft.label = ''
  shortcutDraft.kind = 'key'
  shortcutDraft.key = ''
  shortcutDraft.modifiers = []
  shortcutDraft.sequenceText = ''
}

const resetQuickCommandDraft = () => {
  quickCommandEditMode.value = 'create'
  editingQuickCommandId.value = ''
  quickCommandDraft.label = ''
  quickCommandDraft.command = ''
}

const openShortcutDialog = (shortcut?: RemoteTerminalShortcut) => {
  shortcutDialogVisible.value = true

  if (!shortcut) {
    resetShortcutDraft()
    return
  }

  shortcutEditMode.value = 'edit'
  editingShortcutId.value = shortcut.id
  shortcutDraft.label = shortcut.label
  shortcutDraft.kind = shortcut.kind
  shortcutDraft.key = shortcut.key ?? ''
  shortcutDraft.modifiers = [...(shortcut.modifiers ?? [])]
  shortcutDraft.sequenceText = shortcut.sequence.join('\n')
}

const openQuickCommandDialog = (command?: QuickCommand) => {
  quickCommandDialogVisible.value = true

  if (!command) {
    resetQuickCommandDraft()
    return
  }

  quickCommandEditMode.value = 'edit'
  editingQuickCommandId.value = command.id
  quickCommandDraft.label = command.label
  quickCommandDraft.command = command.command
}

const normalizeCapturedShortcutKey = (key: string) => {
  if (key === ' ') {
    return 'Space'
  }

  if (key === 'Esc') {
    return 'Escape'
  }

  if (key.length === 1) {
    return key.toLowerCase()
  }

  return key
}

const stopShortcutCapture = () => {
  isShortcutCaptureActive.value = false
}

const applyCapturedShortcut = (event: KeyboardEvent) => {
  const key = normalizeCapturedShortcutKey(event.key)
  if (!key || shortcutCaptureModifierKeys.has(key)) {
    return false
  }

  shortcutDraft.kind = 'key'
  shortcutDraft.key = key
  shortcutDraft.modifiers = [
    ...(event.ctrlKey ? ['ctrl'] : []),
    ...(event.altKey ? ['alt'] : []),
    ...(event.shiftKey ? ['shift'] : []),
    ...(event.metaKey ? ['meta'] : []),
  ] as RemoteTerminalShortcutModifier[]

  if (!shortcutDraft.label.trim()) {
    shortcutDraft.label = formatKeyCombo(shortcutDraft.key, shortcutDraft.modifiers)
  }

  return true
}

const handleShortcutCaptureKeydown = (event: KeyboardEvent) => {
  if (!isShortcutCaptureActive.value) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (applyCapturedShortcut(event)) {
    stopShortcutCapture()
  }
}

const toggleShortcutCapture = () => {
  isShortcutCaptureActive.value = !isShortcutCaptureActive.value
}

const saveShortcutDraft = async () => {
  const label = shortcutDraft.label.trim()
  const nextId = editingShortcutId.value || `custom-${Date.now()}`

  let nextShortcut: RemoteTerminalShortcut | null = null

  if (shortcutDraft.kind === 'key') {
    const key = shortcutDraft.key.trim()
    if (!key) {
      ElMessage.warning(i18ns.t('remoteTerminal.shortcutKeyRequired'))
      return
    }

    nextShortcut = {
      id: nextId,
      label: label || formatKeyCombo(key, shortcutDraft.modifiers),
      kind: 'key',
      key,
      modifiers: [...shortcutDraft.modifiers],
      sequence: [],
    }
  } else {
    const sequence = shortcutDraft.sequenceText
      .split(/\r?\n/)
      .map((item) => decodeShortcutSequenceText(item))
      .filter((item) => item.length > 0)

    if (sequence.length === 0) {
      ElMessage.warning(i18ns.t('remoteTerminal.shortcutSequenceRequired'))
      return
    }

    nextShortcut = {
      id: nextId,
      label: label || i18ns.t('remoteTerminal.customShortcutFallbackLabel'),
      kind: 'sequence',
      sequence,
    }
  }

  const baseShortcuts = shortcutButtons.value.filter((shortcut) => shortcut.id !== nextId)
  const saved = await persistAgentPreferencesForCurrentDevice({
    defaultWorkingDirectory: defaultWorkingDirectory.value,
    shortcuts: [...baseShortcuts, nextShortcut],
    quickCommands: quickCommands.value.map(cloneQuickCommand),
  })

  if (!saved) {
    return
  }

  resetShortcutDraft()
}

const saveQuickCommandDraft = async () => {
  const label = quickCommandDraft.label.trim()
  const command = quickCommandDraft.command
  if (!label) {
    ElMessage.warning(i18ns.t('remoteTerminal.quickCommandLabelRequired'))
    return
  }

  if (!command.trim()) {
    ElMessage.warning(i18ns.t('remoteTerminal.quickCommandRequired'))
    return
  }

  const nextId = editingQuickCommandId.value || `quick-command-${Date.now()}`
  const nextCommand: QuickCommand = {
    id: nextId,
    label,
    command,
  }

  const baseCommands = quickCommands.value.filter((item) => item.id !== nextId)
  const saved = await persistAgentPreferencesForCurrentDevice({
    defaultWorkingDirectory: defaultWorkingDirectory.value,
    shortcuts: shortcutButtons.value.map(cloneShortcut),
    quickCommands: [...baseCommands, nextCommand],
  })

  if (!saved) {
    return
  }

  resetQuickCommandDraft()
}

const deleteShortcut = async (shortcutId: string) => {
  const saved = await persistAgentPreferencesForCurrentDevice({
    defaultWorkingDirectory: defaultWorkingDirectory.value,
    shortcuts: shortcutButtons.value.filter((shortcut) => shortcut.id !== shortcutId),
    quickCommands: quickCommands.value.map(cloneQuickCommand),
  })

  if (!saved) {
    return
  }

  if (editingShortcutId.value === shortcutId) {
    resetShortcutDraft()
  }
}

const deleteQuickCommand = async (commandId: string) => {
  const saved = await persistAgentPreferencesForCurrentDevice({
    defaultWorkingDirectory: defaultWorkingDirectory.value,
    shortcuts: shortcutButtons.value.map(cloneShortcut),
    quickCommands: quickCommands.value.filter((command) => command.id !== commandId),
  })

  if (!saved) {
    return
  }

  if (editingQuickCommandId.value === commandId) {
    resetQuickCommandDraft()
  }
}

const restoreDefaultShortcuts = async () => {
  const saved = await persistAgentPreferencesForCurrentDevice({
    defaultWorkingDirectory: defaultWorkingDirectory.value,
    shortcuts: getDefaultRemoteTerminalShortcuts(),
    quickCommands: quickCommands.value.map(cloneQuickCommand),
  })

  if (!saved) {
    return
  }

  resetShortcutDraft()
  clearModifierLocks()
  ElMessage.success(i18ns.t('remoteTerminal.shortcutsReset'))
}

const sendShortcutToCurrentTerminal = (shortcut: RemoteTerminalShortcut) => {
  if (!currentTab.value || !currentSocketConnected.value) {
    ElMessage.warning(i18ns.t('remoteTerminal.pasteWhileDisconnected'))
    return
  }

  const sequences = buildTerminalSequenceFromShortcut(shortcut, modifierLocks)
  if (sequences.length === 0) {
    ElMessage.warning(i18ns.t('remoteTerminal.shortcutSequenceInvalid'))
    return
  }

  for (const sequence of sequences) {
    sendTerminalInput(currentTab.value, sequence)
  }

  currentTab.value.terminal?.focus()
}

const sendQuickCommand = (command: QuickCommand) => {
  if (!currentTab.value || !currentSocketConnected.value) {
    ElMessage.warning(i18ns.t('remoteTerminal.pasteWhileDisconnected'))
    return
  }

  const text = /\r|\n$/.test(command.command) ? command.command : `${command.command}\r`
  sendTerminalInput(currentTab.value, text)
  currentTab.value.terminal?.focus()
}

const currentRetryMaxAttempts = computed<number>({
  get: () => currentTab.value?.retryMaxAttempts ?? 3,
  set: (value) => {
    if (currentTab.value) {
      currentTab.value.retryMaxAttempts = value
    }
  },
})

const currentRetryDelaySeconds = computed<number>({
  get: () => currentTab.value?.retryDelaySeconds ?? 5,
  set: (value) => {
    if (currentTab.value) {
      currentTab.value.retryDelaySeconds = value
    }
  },
})

const currentDeviceLabel = computed(() => {
  if (!currentSelectedDevice.value) {
    return i18ns.t('remoteTerminal.noDeviceSelected')
  }

  return `${currentSelectedDevice.value.hostname} · ${currentSelectedDevice.value.platform} · ${currentSelectedDevice.value.arch}`
})

const currentDisplayStatusText = computed(() => {
  if (!currentTab.value) {
    return i18ns.t('remoteTerminal.idle')
  }

  if (currentTab.value.retryCountdownSeconds !== null) {
    return i18ns.t('remoteTerminal.retryCountdown', {
      attempt: currentTab.value.retryAttempt + 1,
      max: currentTab.value.retryMaxAttempts,
      seconds: currentTab.value.retryCountdownSeconds,
    })
  }

  return currentTab.value.statusText
})

const sortedSessions = computed(() =>
  [...sessions.value].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  ),
)

const paginatedSessions = computed(() => {
  const startIndex = (sessionPage.value - 1) * sessionPageSize
  return sortedSessions.value.slice(startIndex, startIndex + sessionPageSize)
})

const chooseDefaultShellType = (
  device: RemoteTerminalDeviceDto | null,
): RemoteTerminalShellType => {
  const availableShells = device?.availableShells ?? []
  if (availableShells.length === 0) {
    return 'system-default'
  }

  if (availableShells.includes('system-default')) {
    return 'system-default'
  }

  return availableShells[0] ?? 'system-default'
}

const getShellTypeLabel = (shellType: RemoteTerminalShellType) =>
  i18ns.t(`remoteTerminal.shellTypes.${shellType}` as never)

const normalizeTerminalOutput = (data: string) => data.replace(/\r?\n/g, '\r\n')

const sendTerminalInput = (tab: TerminalTabState, data: string) => {
  if (!tab.socket || tab.socket.readyState !== WebSocket.OPEN || !tab.activeSessionId) {
    return false
  }

  syncLocalEchoModeState(tab)
  echoTerminalInput(tab, data)

  tab.socket.send(
    JSON.stringify({
      type: 'session-input',
      sessionId: tab.activeSessionId,
      data,
    }),
  )

  return true
}

const stripLocalEchoEscapeSequences = (data: string) =>
  data
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[NOOP]/g, '')
    .replace(/\u001b./g, '')

const shouldUseLocalEcho = (tab: TerminalTabState) =>
  getDeviceById(tab.deviceId)?.platform === 'windows'

const getTerminalInputModeSnapshot = (tab: TerminalTabState): TerminalInputModeSnapshot => {
  const terminal = tab.terminal
  if (!terminal) {
    return {
      isAlternateBuffer: false,
      isApplicationCursorKeys: false,
      isBracketedPasteMode: false,
      isFocusReportingMode: false,
    }
  }

  return {
    isAlternateBuffer: terminal.buffer.active.type === 'alternate',
    isApplicationCursorKeys: terminal.modes.applicationCursorKeysMode,
    isBracketedPasteMode: terminal.modes.bracketedPasteMode,
    isFocusReportingMode: terminal.modes.sendFocusMode,
  }
}

const isInteractiveTerminalProgramActive = (tab: TerminalTabState) => {
  const snapshot = getTerminalInputModeSnapshot(tab)
  return (
    snapshot.isAlternateBuffer ||
    snapshot.isApplicationCursorKeys ||
    snapshot.isBracketedPasteMode ||
    snapshot.isFocusReportingMode
  )
}

const canUseLocalEchoForCurrentInput = (tab: TerminalTabState) =>
  shouldUseLocalEcho(tab) && !isInteractiveTerminalProgramActive(tab)

const resetLocalEchoState = (tab: TerminalTabState) => {
  tab.localEchoBuffer = ''
  tab.pendingRemoteEchoLine = null
  tab.pendingEchoChars = ''
  tab.pendingLocalClear = false
}

const echoTerminalInput = (tab: TerminalTabState, data: string) => {
  if (!tab.terminal || !canUseLocalEchoForCurrentInput(tab)) {
    return
  }

  for (const char of stripLocalEchoEscapeSequences(data)) {
    if (char === '\u0003') {
      resetLocalEchoState(tab)
      tab.terminal.write('^C')
      continue
    }

    if (char === '\r' || char === '\n') {
      const submittedLine = tab.localEchoBuffer.trim()
      tab.pendingRemoteEchoLine = tab.localEchoBuffer
      tab.localEchoBuffer = ''

      if (/^(cls|clear)$/i.test(submittedLine)) {
        tab.pendingLocalClear = true
        tab.terminal.clear()
      }

      tab.terminal.write('\r\n')
      continue
    }

    if (char === '\u007f' || char === '\b') {
      if (tab.localEchoBuffer.length > 0) {
        tab.localEchoBuffer = tab.localEchoBuffer.slice(0, -1)
        tab.terminal.write('\b \b')
      }
      continue
    }

    if (char === '\u001b') {
      continue
    }

    if (char === '\t' || (char >= ' ' && char !== '\u007f')) {
      tab.localEchoBuffer += char
      tab.pendingEchoChars += char
      tab.terminal.write(char)
    }
  }
}

const consumeRemoteEcho = (tab: TerminalTabState, data: string) => {
  let nextData = data

  if (canUseLocalEchoForCurrentInput(tab) && tab.pendingRemoteEchoLine) {
    const echoedLine = tab.pendingRemoteEchoLine
    const candidates = [echoedLine, `${echoedLine}\r\n`, `${echoedLine}\n`]

    for (const candidate of candidates) {
      if (!candidate) {
        continue
      }

      if (nextData.startsWith(candidate)) {
        tab.pendingRemoteEchoLine = null
        nextData = nextData.slice(candidate.length)
        break
      }
    }
  }

  // Consume per-character remote echo: strip chars the remote reflects back for
  // what was already locally echoed (common with Windows cmd/powershell).
  if (canUseLocalEchoForCurrentInput(tab) && tab.pendingEchoChars) {
    let i = 0
    while (
      i < nextData.length &&
      tab.pendingEchoChars.length > 0 &&
      nextData[i] === tab.pendingEchoChars[0]
    ) {
      tab.pendingEchoChars = tab.pendingEchoChars.slice(1)
      i++
    }
    nextData = nextData.slice(i)
  }

  if (canUseLocalEchoForCurrentInput(tab) && tab.pendingLocalClear) {
    nextData = nextData.replace(/^(\r\n|\n|\r)+/, '')
    tab.pendingLocalClear = false
  }

  return nextData
}

const syncLocalEchoModeState = (tab: TerminalTabState) => {
  if (!shouldUseLocalEcho(tab)) {
    resetLocalEchoState(tab)
    return
  }

  if (isInteractiveTerminalProgramActive(tab)) {
    resetLocalEchoState(tab)
  }
}

const clearRetryTimers = (tab: TerminalTabState, resetAttempt = false) => {
  if (tab.retryCountdownTimer !== null) {
    window.clearInterval(tab.retryCountdownTimer)
    tab.retryCountdownTimer = null
  }

  if (tab.retryStartTimer !== null) {
    window.clearTimeout(tab.retryStartTimer)
    tab.retryStartTimer = null
  }

  tab.retryCountdownSeconds = null
  tab.autoReconnectPending = false

  if (resetAttempt) {
    tab.retryAttempt = 0
  }
}

const clearRetryCountdownTimer = (tab: TerminalTabState) => {
  if (tab.retryCountdownTimer !== null) {
    window.clearInterval(tab.retryCountdownTimer)
    tab.retryCountdownTimer = null
  }
}

const getDefaultDeviceId = (deviceItems = devices.value) => {
  const defaultDevice = deviceItems.find((item) => item.online) ?? deviceItems[0]
  return defaultDevice?.deviceId ?? ''
}

const ensureTabSelectionValid = (tab: TerminalTabState, preferredDeviceId = '') => {
  const preferredAvailable =
    preferredDeviceId && devices.value.some((item) => item.deviceId === preferredDeviceId)
  if (!tab.deviceId) {
    tab.deviceId = preferredAvailable ? preferredDeviceId : getDefaultDeviceId()
  }

  if (tab.deviceId && !devices.value.some((item) => item.deviceId === tab.deviceId)) {
    tab.deviceId = preferredAvailable ? preferredDeviceId : getDefaultDeviceId()
  }

  const device = getDeviceById(tab.deviceId)
  if (!device?.availableShells.includes(tab.shellType)) {
    tab.shellType = chooseDefaultShellType(device)
  }
}

const addTerminalTab = (
  seed?: Partial<Pick<TerminalTabState, 'deviceId' | 'shellType' | 'title'>>,
) => {
  const nextTab = createTerminalTab({
    deviceId: seed?.deviceId ?? currentTab.value?.deviceId ?? getDefaultDeviceId(),
    shellType: seed?.shellType ?? currentTab.value?.shellType ?? 'system-default',
    title: seed?.title,
  })
  ensureTabSelectionValid(nextTab)
  tabs.value.push(nextTab)
  activeTabId.value = nextTab.tabId
  nextTick(() => {
    void ensureTerminal(nextTab)
  })
}

const ensureAtLeastOneTab = () => {
  if (tabs.value.length === 0) {
    addTerminalTab()
    return
  }

  if (!tabs.value.some((tab) => tab.tabId === activeTabId.value)) {
    activeTabId.value = tabs.value[0]?.tabId ?? ''
  }
}

const setTerminalHostRef = (tabId: string, element: HTMLDivElement | null) => {
  if (element) {
    terminalHostRefs.set(tabId, element)
    return
  }

  terminalHostRefs.delete(tabId)
}

const setTerminalContainerRef = (tabId: string, element: HTMLDivElement | null) => {
  if (element) {
    terminalContainerRefs.set(tabId, element)
    return
  }

  terminalContainerRefs.delete(tabId)
}

const handleTerminalContextMenu = async (event: MouseEvent, tab: TerminalTabState) => {
  event.preventDefault()

  const selection = tab.terminal?.getSelection() ?? ''
  if (selection) {
    try {
      await navigator.clipboard.writeText(selection)
      tab.terminal?.clearSelection()
    } catch {
      ElMessage.error(i18ns.t('copyFailed'))
    }
    return
  }

  try {
    const clipboardText = await navigator.clipboard.readText()
    if (!clipboardText) {
      return
    }

    if (!sendTerminalInput(tab, clipboardText)) {
      ElMessage.warning(i18ns.t('remoteTerminal.pasteWhileDisconnected'))
      return
    }

    tab.terminal?.focus()
  } catch {
    ElMessage.error(i18ns.t('operationFailed'))
  }
}

const fitTerminal = (tab: TerminalTabState | null) => {
  if (!tab?.fitAddon) {
    return
  }

  const host = terminalHostRefs.get(tab.tabId)
  if (!host || host.offsetParent === null) {
    return
  }

  tab.fitAddon.fit()
}

const ensureTerminal = async (tab: TerminalTabState) => {
  await nextTick()
  const terminalHost = terminalHostRefs.get(tab.tabId)
  if (!terminalHost || tab.terminal) {
    return
  }

  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'Consolas, Menlo, Monaco, monospace',
    fontSize: 14,
    theme: {
      background: '#0b1220',
      foreground: '#dbe4ff',
    },
  })
  const fitAddon = new FitAddon()

  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost)
  tab.terminal = terminal
  tab.fitAddon = fitAddon
  terminal.buffer.onBufferChange(() => {
    syncLocalEchoModeState(tab)
  })
  fitTerminal(tab)
  terminal.writeln(i18ns.t('remoteTerminal.welcome'))
  terminal.writeln(i18ns.t('remoteTerminal.welcomeHint'))

  terminal.onData((data: string) => {
    sendTerminalInput(tab, data)
  })

  terminalHost.addEventListener('contextmenu', (event) => {
    void handleTerminalContextMenu(event, tab)
  })

  tab.resizeObserver = new ResizeObserver(() => {
    const host = terminalHostRefs.get(tab.tabId)
    if (!host || host.offsetParent === null) {
      return
    }

    fitTerminal(tab)

    if (
      !tab.socket ||
      tab.socket.readyState !== WebSocket.OPEN ||
      !tab.activeSessionId ||
      !tab.terminal
    ) {
      return
    }

    tab.socket.send(
      JSON.stringify({
        type: 'session-resize',
        sessionId: tab.activeSessionId,
        cols: tab.terminal.cols,
        rows: tab.terminal.rows,
      }),
    )
  })

  tab.resizeObserver.observe(terminalHost)
}

const getTabTitle = (tab: TerminalTabState, index: number) => {
  if (tab.title) {
    return tab.title
  }

  const device = getDeviceById(tab.deviceId)
  if (device) {
    return `${device.hostname} · ${getShellTypeLabel(tab.shellType)}`
  }

  return i18ns.t('remoteTerminal.terminalTab', { index: index + 1 })
}

const selectDeviceForCurrentTab = (deviceId: string) => {
  if (!currentTab.value) {
    return
  }

  currentTab.value.deviceId = deviceId
  ensureTabSelectionValid(currentTab.value)
}

const buildShareUrl = () => {
  const tab = currentTab.value
  const url = new URL(window.location.href)
  const reconnectDeviceId = tab
    ? currentSelectedOnlineDeviceId.value || tab.lastConnectedDeviceId || tab.deviceId
    : ''

  if (reconnectDeviceId) {
    url.searchParams.set('deviceId', reconnectDeviceId)
    url.searchParams.set('autoConnect', '1')
  }

  if (tab?.activeSessionId) {
    url.searchParams.set('sessionId', tab.activeSessionId)
  } else {
    url.searchParams.delete('sessionId')
  }

  return url.toString()
}

const copySessionLink = async () => {
  try {
    await navigator.clipboard.writeText(buildShareUrl())
    ElMessage.success(i18ns.t('remoteTerminal.linkCopied'))
  } catch {
    ElMessage.error(i18ns.t('remoteTerminal.linkCopyFailed'))
  }
}

const handleFullscreenChange = () => {
  isFullscreen.value = Boolean(document.fullscreenElement)
  nextTick(() => fitTerminal(currentTab.value))
}

const toggleFullscreen = async () => {
  const container = currentTab.value ? terminalContainerRefs.get(currentTab.value.tabId) : null
  if (!container) {
    return
  }

  try {
    if (document.fullscreenElement === container) {
      await document.exitFullscreen()
    } else {
      await container.requestFullscreen()
    }
  } catch {
    ElMessage.error(i18ns.t('remoteTerminal.fullscreenFailed'))
  }
}

const scheduleAutoReconnect = (tab: TerminalTabState) => {
  const reconnectTarget = tab.deviceId || tab.lastConnectedDeviceId
  if (!reconnectTarget) {
    tab.statusText = i18ns.t('remoteTerminal.disconnected')
    return
  }

  if (tab.retryAttempt >= tab.retryMaxAttempts) {
    clearRetryTimers(tab)
    tab.statusText = i18ns.t('remoteTerminal.retryStopped')
    tab.terminal?.writeln(`\r\n${i18ns.t('remoteTerminal.retryStoppedBanner')}`)
    return
  }

  clearRetryTimers(tab)
  tab.retryCountdownSeconds = tab.retryDelaySeconds
  tab.autoReconnectPending = true
  tab.statusText = i18ns.t('remoteTerminal.retryScheduled')
  tab.terminal?.writeln(
    `\r\n${i18ns.t('remoteTerminal.retryScheduledBanner', {
      attempt: tab.retryAttempt + 1,
      max: tab.retryMaxAttempts,
      seconds: tab.retryDelaySeconds,
    })}`,
  )

  tab.retryCountdownTimer = window.setInterval(() => {
    if (tab.retryCountdownSeconds === null) {
      return
    }

    if (tab.retryCountdownSeconds <= 1) {
      tab.retryCountdownSeconds = 0
      clearRetryCountdownTimer(tab)
      return
    }

    tab.retryCountdownSeconds -= 1
  }, 1000)

  tab.retryStartTimer = window.setTimeout(() => {
    clearRetryTimers(tab)
    void performAutoReconnect(tab)
  }, tab.retryDelaySeconds * 1000)
}

const performAutoReconnect = async (tab: TerminalTabState) => {
  const reconnectTarget = tab.deviceId || tab.lastConnectedDeviceId
  if (!reconnectTarget) {
    tab.statusText = i18ns.t('remoteTerminal.disconnected')
    return
  }

  tab.retryAttempt += 1
  tab.deviceId = reconnectTarget
  tab.statusText = i18ns.t('remoteTerminal.retryingNow', {
    attempt: tab.retryAttempt,
    max: tab.retryMaxAttempts,
  })
  tab.terminal?.writeln(
    `\r\n${i18ns.t('remoteTerminal.retryingBanner', {
      attempt: tab.retryAttempt,
      max: tab.retryMaxAttempts,
    })}`,
  )

  await refreshAll()

  const device = getDeviceById(reconnectTarget)
  if (!device?.online) {
    tab.statusText = i18ns.t('remoteTerminal.retryDeviceOffline')
    scheduleAutoReconnect(tab)
    return
  }

  const connected = await connectTerminal(tab, { isAutoReconnect: true })
  if (!connected) {
    scheduleAutoReconnect(tab)
  }
}

const cancelAutoReconnect = (tab: TerminalTabState) => {
  if (!tab.autoReconnectPending) {
    return
  }

  clearRetryTimers(tab, true)
  tab.statusText = i18ns.t('remoteTerminal.retryCancelled')
  tab.terminal?.writeln(`\r\n${i18ns.t('remoteTerminal.retryCancelledBanner')}`)
}

const cancelCurrentAutoReconnect = () => {
  if (currentTab.value) {
    cancelAutoReconnect(currentTab.value)
  }
}

const PING_INTERVAL_MS = 5000
const PING_TIMEOUT_MS = 15000
const PING_EMA_ALPHA = 0.3

const stopPingLoop = (tab: TerminalTabState) => {
  if (tab.pingTimer !== null) {
    window.clearInterval(tab.pingTimer)
    tab.pingTimer = null
  }
}

const startPingLoop = (tab: TerminalTabState) => {
  stopPingLoop(tab)
  tab.pingTimer = window.setInterval(() => {
    if (!tab.socket || tab.socket.readyState !== WebSocket.OPEN || !tab.activeSessionId) return
    const now = Date.now()
    if (tab.lastPongAt !== null && now - tab.lastPongAt > PING_TIMEOUT_MS) {
      tab.rttMs = null
    }
    tab.socket.send(JSON.stringify({ type: 'browser-ping', ts: now }))
  }, PING_INTERVAL_MS)
}

const disconnectTerminal = (tab: TerminalTabState, sendStop = true, intentional = true) => {
  const currentSocket = tab.socket
  const currentSessionId = tab.activeSessionId

  clearRetryTimers(tab, true)
  resetLocalEchoState(tab)

  if (
    sendStop &&
    currentSocket &&
    currentSocket.readyState === WebSocket.OPEN &&
    currentSessionId
  ) {
    currentSocket.send(
      JSON.stringify({
        type: 'session-stop',
        sessionId: currentSessionId,
      }),
    )
  }

  if (intentional && currentSocket) {
    intentionalCloseSockets.add(currentSocket)
  }

  currentSocket?.close()
  tab.socket = null
  tab.socketConnected = false
  tab.activeSessionId = null
  tab.isSessionReady = false
  tab.hasSessionExited = false
  tab.statusText = i18ns.t('remoteTerminal.disconnected')
  stopPingLoop(tab)
}

const disposeTerminalTab = (tab: TerminalTabState) => {
  disconnectTerminal(tab, false, true)
  tab.resizeObserver?.disconnect()
  tab.resizeObserver = null
  tab.terminal?.dispose()
  tab.terminal = null
  tab.fitAddon = null
  terminalHostRefs.delete(tab.tabId)
  terminalContainerRefs.delete(tab.tabId)
}

const connectTerminal = async (tab: TerminalTabState, options?: { isAutoReconnect?: boolean }) => {
  const reconnectTarget = options?.isAutoReconnect ? tab.lastConnectedDeviceId || tab.deviceId : ''
  if (options?.isAutoReconnect && reconnectTarget) {
    tab.deviceId = reconnectTarget
  }

  const selectedDevice = getDeviceById(tab.deviceId)
  if (!selectedDevice?.online) {
    ElMessage.warning(i18ns.t('remoteTerminal.selectOnlineDevice'))
    return false
  }

  tab.sessionConnecting = true
  errorMessage.value = ''
  clearRetryTimers(tab, false)

  try {
    await ensureTerminal(tab)

    const session = await remoteTerminalService.createSession({
      deviceId: selectedDevice.deviceId,
      mode: 'shell',
      shellType: tab.shellType,
      workingDirectory: normalizeWorkingDirectory(tab.workingDirectory) || undefined,
    })

    disconnectTerminal(tab, false, true)
    resetLocalEchoState(tab)
    tab.activeSessionId = session.sessionId
    tab.lastConnectedDeviceId = session.deviceId
    tab.statusText = i18ns.t('remoteTerminal.connectingStatus')
    tab.isSessionReady = false
    tab.hasSessionExited = false
    tab.terminal?.clear()
    tab.terminal?.writeln(i18ns.t('remoteTerminal.connectingBanner'))

    const ws = new WebSocket(session.websocketUrl)
    tab.socket = ws
    tab.socketConnected = false

    let wsSessionReady = false

    ws.onopen = () => {
      if (tab.socket === ws) {
        tab.socketConnected = true
      }
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as RemoteTerminalSocketMessage

      if (message.type === 'browser-connected') {
        tab.statusText = i18ns.t('remoteTerminal.browserConnected')
        return
      }

      if (message.type === 'browser-pong') {
        const rtt = Date.now() - message.ts
        tab.lastPongAt = Date.now()
        tab.rttMs =
          tab.rttMs === null
            ? rtt
            : Math.round(tab.rttMs * (1 - PING_EMA_ALPHA) + rtt * PING_EMA_ALPHA)
        return
      }

      if (message.type === 'session-ready') {
        wsSessionReady = true
        tab.isSessionReady = true
        clearRetryTimers(tab, true)
        resetLocalEchoState(tab)
        tab.statusText = i18ns.t('remoteTerminal.ready')

        if (tab.terminal && tab.socket === ws) {
          fitTerminal(tab)
          ws.send(
            JSON.stringify({
              type: 'session-resize',
              sessionId: message.sessionId,
              cols: tab.terminal.cols,
              rows: tab.terminal.rows,
            }),
          )
        }

        startPingLoop(tab)

        nextTick(() => {
          tab.terminal?.focus()
          // Force cursor repaint after clear()/reconnect — xterm.js cursor blink
          // animation can get stuck invisible after a reconnect cycle.
          tab.terminal?.write('')
        })
        return
      }

      if (message.type === 'session-output') {
        tab.terminal?.write(normalizeTerminalOutput(consumeRemoteEcho(tab, message.data)))
        return
      }

      if (message.type === 'session-exit') {
        tab.hasSessionExited = true
        resetLocalEchoState(tab)
        tab.statusText = i18ns.t('remoteTerminal.exited')
        tab.terminal?.writeln(
          `\r\n[${i18ns.t('remoteTerminal.sessionExited')}: ${message.exitCode ?? 'null'}]`,
        )
        return
      }

      resetLocalEchoState(tab)
      tab.statusText = i18ns.t('remoteTerminal.errorStatus')
      tab.terminal?.writeln(`\r\n[${i18ns.t('error')}] ${message.message}`)
    }

    ws.onclose = () => {
      const closedIntentionally = intentionalCloseSockets.has(ws)
      const isActiveSocket = tab.socket === ws
      if (isActiveSocket) {
        tab.socket = null
        tab.socketConnected = false
        if (tab.activeSessionId === session.sessionId) {
          tab.activeSessionId = null
        }
        resetLocalEchoState(tab)
        tab.statusText = i18ns.t('remoteTerminal.disconnected')
      }

      // Only the active socket triggers reconnect; stale sockets from replaced
      // sessions must never re-enter the reconnect loop.
      if (
        isActiveSocket &&
        !closedIntentionally &&
        (wsSessionReady || tab.socketConnected) &&
        !tab.hasSessionExited
      ) {
        scheduleAutoReconnect(tab)
      }
    }

    ws.onerror = () => {
      tab.socketConnected = false
      tab.statusText = i18ns.t('remoteTerminal.errorStatus')
    }

    return true
  } catch (error) {
    errorMessage.value = getErrorMessage(error, i18ns.t('remoteTerminal.connectFailed'))
    if (!options?.isAutoReconnect) {
      ElMessage.error(errorMessage.value)
    }
    return false
  } finally {
    tab.sessionConnecting = false
  }
}

const connectCurrentTerminal = async () => {
  if (!currentTab.value) {
    return
  }

  if (connectBlocked.value) {
    ElMessage.warning(connectBlockedReason.value || i18ns.t('remoteTerminal.noTerminalQuota'))
    return
  }

  await connectTerminal(currentTab.value)
}

const disconnectCurrentTerminal = (sendStop = true) => {
  if (!currentTab.value) {
    return
  }

  disconnectTerminal(currentTab.value, sendStop, true)
}

const reconnectCurrentTerminal = async () => {
  if (!currentTab.value) {
    return
  }

  // if (connectBlocked.value) {
  //   ElMessage.warning(connectBlockedReason.value || i18ns.t('remoteTerminal.noTerminalQuota'))
  //   return
  // }

  const reconnectTarget =
    currentSelectedOnlineDeviceId.value || currentTab.value.lastConnectedDeviceId
  if (!reconnectTarget) {
    ElMessage.warning(i18ns.t('remoteTerminal.selectOnlineDevice'))
    return
  }

  currentTab.value.deviceId = reconnectTarget
  disconnectTerminal(currentTab.value, true, true)
  await connectTerminal(currentTab.value)
}

const removeTerminalTab = (tabId: string | number) => {
  const normalizedTabId = String(tabId)
  const tabIndex = tabs.value.findIndex((item) => item.tabId === normalizedTabId)
  if (tabIndex < 0) {
    return
  }

  const [tab] = tabs.value.splice(tabIndex, 1)
  if (!tab) {
    return
  }

  disposeTerminalTab(tab)

  if (tabs.value.length === 0) {
    addTerminalTab()
    return
  }

  if (activeTabId.value === normalizedTabId) {
    const nextTab = tabs.value[tabIndex] ?? tabs.value[tabIndex - 1] ?? tabs.value[0]
    activeTabId.value = nextTab?.tabId ?? ''
  }
}

const handleSessionPageChange = (page: number) => {
  sessionPage.value = page
}

const refreshAll = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    await remoteTerminalService.probeDevices().catch(() => undefined)
    const [deviceItems, sessionItems, usage] = await Promise.all([
      remoteTerminalService.listDevices(),
      remoteTerminalService.listSessions(),
      remoteTerminalService.getUsageSummary(),
    ])
    devices.value = deviceItems
    sessions.value = sessionItems
    Object.assign(usageSummary, usage)

    ensureAtLeastOneTab()

    const routeDeviceId = typeof route.query.deviceId === 'string' ? route.query.deviceId : ''
    for (const tab of tabs.value) {
      ensureTabSelectionValid(tab, routeDeviceId)
    }

    await loadAgentPreferencesForDevice(getCurrentPreferenceDeviceId(), { silent: true })
  } catch (error) {
    errorMessage.value = getErrorMessage(error, i18ns.t('remoteTerminal.loadFailed'))
  } finally {
    loading.value = false
  }
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

onMounted(async () => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  ensureAtLeastOneTab()
  await refreshAll()

  if (currentTab.value) {
    await ensureTerminal(currentTab.value)
  }

  if (route.query.autoConnect === '1' && currentTab.value && currentSelectedOnlineDeviceId.value) {
    await connectTerminal(currentTab.value)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  window.removeEventListener('keydown', handleShortcutCaptureKeydown, true)
  for (const tab of tabs.value) {
    disposeTerminalTab(tab)
  }
})

watch(
  () => isShortcutCaptureActive.value,
  (active) => {
    if (active) {
      window.addEventListener('keydown', handleShortcutCaptureKeydown, true)
      return
    }

    window.removeEventListener('keydown', handleShortcutCaptureKeydown, true)
  },
)

watch(
  () => shortcutDialogVisible.value,
  (visible) => {
    if (!visible) {
      stopShortcutCapture()
    }
  },
)

watch(
  () => [activeTabId.value, currentTab.value?.deviceId] as const,
  async () => {
    ensureAtLeastOneTab()

    if (currentTab.value) {
      ensureTabSelectionValid(currentTab.value)
      await loadAgentPreferencesForDevice(currentTab.value.deviceId, { silent: true })
      await ensureTerminal(currentTab.value)
      nextTick(() => {
        fitTerminal(currentTab.value)
        if (currentTab.value?.socketConnected) {
          currentTab.value.terminal?.focus()
          currentTab.value.terminal?.write('')
          // Consistency sync: resend resize after tab switch so agent pty stays in sync
          const tab = currentTab.value
          if (
            tab.isSessionReady &&
            tab.socket?.readyState === WebSocket.OPEN &&
            tab.activeSessionId &&
            tab.terminal
          ) {
            tab.socket.send(
              JSON.stringify({
                type: 'session-resize',
                sessionId: tab.activeSessionId,
                cols: tab.terminal.cols,
                rows: tab.terminal.rows,
              }),
            )
          }
        }
      })
    }
  },
)

watch(
  () => sortedSessions.value.length,
  (length) => {
    const maxPage = Math.max(1, Math.ceil(length / sessionPageSize))
    if (sessionPage.value > maxPage) {
      sessionPage.value = maxPage
    }
  },
)

watch(
  () => currentSelectedOnlineDeviceId.value,
  (deviceId) => {
    if (!workingDirectoryDialogVisible.value) {
      return
    }

    if (!deviceId) {
      resetDirectoryTree()
      applyDirectoryBrowseResult({
        currentPath: '',
        parentPath: undefined,
        items: [],
      })
      return
    }

    resetDirectoryTree(workingDirectoryDraft.value)
    void browseRemoteDirectory(workingDirectoryDraft.value || undefined)
  },
)
</script>

<style scoped>
.remote-terminal-page {
  padding: 20px;
}

.page-card {
  border-radius: 10px;
}

.sidebar-card,
.terminal-card {
  height: calc(100vh - 120px);
}

.sidebar-card :deep(.el-card__body),
.terminal-card :deep(.el-card__body) {
  height: calc(100% - 56px);
}

.page-header,
.terminal-header,
.header-left,
.device-card-top,
.action-row,
.terminal-actions,
.session-meta {
  display: flex;
  align-items: center;
}

.page-header,
.terminal-header,
.device-card-top {
  justify-content: space-between;
}

.header-left {
  gap: 12px;
}

.terminal-actions {
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.header-icon {
  color: var(--el-color-primary);
}

.page-title,
.terminal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-subtitle,
.terminal-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.section-block {
  margin-top: 16px;
}

.section-label {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.section-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-color-warning);
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
}

.device-card {
  width: 100%;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.device-card:hover,
.device-card.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 8px 24px rgba(64, 158, 255, 0.12);
}

.device-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.device-meta,
.device-time,
.status-text {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.device-time {
  margin-top: 8px;
}

.action-row {
  gap: 12px;
  flex-wrap: wrap;
}

.working-directory-panel,
.shortcut-panel,
.quota-panel {
  padding: 14px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.quota-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.quota-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.quick-command-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.quota-card {
  padding: 12px;
  border-radius: 10px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
}

.quota-card-label,
.quota-card-hint,
.quota-warning,
.directory-browser-path,
.directory-browser-empty,
.directory-browser-current {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.quota-card-value {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.quota-warning {
  color: var(--el-color-warning);
}

.working-directory-value {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.working-directory-hint,
.dialog-hint,
.shortcut-panel-hint,
.custom-shortcut-meta,
.shortcut-button-preview {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.working-directory-actions {
  margin-top: 12px;
}

.action-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 18px;
}

.action-row-top {
  flex-wrap: nowrap;
}

.action-row-bottom {
  gap: 10px;
}

.action-button {
  min-width: 0;
}

.shell-select {
  min-width: 220px;
  flex: 1;
}

.status-panel {
  padding: 14px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.terminal-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.terminal-tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
}

.terminal-tabs :deep(.el-tabs__content) {
  flex: 1 1 auto;
  height: calc(100% - 44px);
  min-height: 0;
  overflow: auto;
}

.terminal-tabs :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.terminal-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  padding-right: 4px;
  overflow: auto;
  overflow-y: auto;
  overflow-x: auto;
  overscroll-behavior: contain;
}

.terminal-container.fullscreen {
  padding: 20px;
  background: #08101d;
}

.session-meta {
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.shortcut-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 0 0 auto;
  min-height: fit-content;
}

.shortcut-panel-header,
.custom-shortcut-row,
.shortcut-editor-actions,
.custom-shortcut-actions,
.shortcut-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.shortcut-panel-header,
.shortcut-panel-actions {
  flex-wrap: wrap;
}

.shortcut-panel-title,
.shortcut-manager-title,
.custom-shortcut-name {
  margin-bottom: 0;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.modifier-locks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.shortcut-key-editor {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.shortcut-key-editor :deep(.el-input) {
  flex: 1 1 220px;
}

.modifier-clear {
  margin-left: auto;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.shortcut-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 14px;
  padding: 4px 5px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 5px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  text-align: left;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.shortcut-button:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  box-shadow: 0 8px 20px rgba(64, 158, 255, 0.12);
  transform: translateY(-1px);
}

.shortcut-button:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.shortcut-button-label {
  font-size: 13px;
  font-weight: 600;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-button-preview {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-command-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.quick-command-button {
  min-height: 72px;
}

.directory-browser-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.directory-tree-select {
  width: 100%;
}

.directory-browser-list {
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.directory-browser-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.directory-browser-item:last-child {
  border-bottom: 0;
}

.directory-browser-item:hover {
  background: var(--el-fill-color-light);
}

.directory-browser-name,
.quota-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.directory-browser-path {
  word-break: break-all;
}

.directory-browser-empty {
  padding: 24px 12px;
  text-align: center;
}

.shortcut-manager {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 2fr);
  gap: 20px;
}

.shortcut-manager-list,
.shortcut-manager-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.custom-shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.custom-shortcut-row {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.custom-shortcut-content {
  min-width: 0;
}

.retry-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-color-warning);
}

.retry-policy-panel {
  padding: 14px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.retry-policy-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.retry-policy-title {
  margin-bottom: 0;
}

.retry-policy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.retry-policy-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.retry-policy-label,
.retry-policy-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sessions-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.terminal-host {
  width: 100%;
  flex: 1 1 auto;
  min-height: 320px;
  min-width: 0;
  max-width: 100%;
  overflow: auto;
  border-radius: 10px;
  background: #0b1220;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-sizing: border-box;
}

.terminal-host :deep(.xterm) {
  min-width: 100%;
  height: 100%;
  min-height: 100%;
  padding: 8px 10px 12px;
  box-sizing: border-box;
}

.terminal-host :deep(.xterm-viewport) {
  overflow: auto !important;
}

.terminal-host :deep(.xterm-screen) {
  border-radius: 10px;
}

@media (max-width: 1199px) {
  .sidebar-card,
  .terminal-card {
    height: auto;
  }

  .sidebar-card :deep(.el-card__body),
  .terminal-card :deep(.el-card__body) {
    height: auto;
  }

  .terminal-host {
    min-height: 420px;
  }

  .retry-policy-grid {
    grid-template-columns: 1fr;
  }

  .quota-grid,
  .quick-command-grid {
    grid-template-columns: 1fr;
  }

  .retry-policy-header,
  .session-meta,
  .terminal-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .shortcut-manager {
    grid-template-columns: 1fr;
  }

  .shell-select {
    min-width: 100%;
  }
}

@media (max-width: 767px) {
  .remote-terminal-page {
    padding: 12px;
  }

  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .action-panel {
    gap: 10px;
  }

  .action-row-bottom,
  .terminal-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .action-button,
  .terminal-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
    justify-content: center;
  }

  .action-row-bottom > :last-child,
  .terminal-actions > :last-child {
    grid-column: 1 / -1;
  }

  .device-list {
    max-height: 240px;
  }

  .terminal-tabs :deep(.el-tabs__nav-wrap) {
    overflow-x: auto;
  }

  .terminal-host {
    min-height: 320px;
  }

  .terminal-host :deep(.xterm) {
    padding: 6px 6px 10px;
  }

  .sessions-pagination {
    justify-content: center;
  }

  .working-directory-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .directory-browser-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .shortcut-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .quick-command-grid {
    grid-template-columns: 1fr;
  }

  .shortcut-panel-header,
  .custom-shortcut-row,
  .shortcut-editor-actions,
  .custom-shortcut-actions,
  .shortcut-panel-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .shortcut-panel-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
    justify-content: flex-start;
  }
}
</style>
