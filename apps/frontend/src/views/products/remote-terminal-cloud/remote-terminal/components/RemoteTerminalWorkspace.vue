<template>
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
                >{{ i18ns.t('remoteTerminal.sessionId') }}: {{ tab.activeSessionId || '—' }}</span
              >
              <span>
                {{ i18ns.t('remoteTerminal.openLocationShort') }}:
                {{ formatWorkingDirectoryLabel(tab.workingDirectory) }}
              </span>
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
                <el-check-tag :checked="modifierLocks.alt" @change="setModifierLock('alt', $event)">
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
                    <span class="shortcut-button-preview">{{ omitStr(command.command, 20) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </el-col>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalManagementContext } from '../context'

const state = useRemoteTerminalManagementContext()

const {
  FullScreen,
  Link,
  Plus,
  addTerminalTab,
  clearModifierLocks,
  copySessionLink,
  currentDeviceLabel,
  currentSocketConnected,
  currentTab,
  formatWorkingDirectoryLabel,
  getShortcutDisplayLabel,
  getTabTitle,
  isFullscreen,
  modifierLocks,
  omitStr,
  openQuickCommandDialog,
  openShortcutDialog,
  quickCommands,
  removeTerminalTab,
  restoreDefaultShortcuts,
  sendQuickCommand,
  sendShortcutToCurrentTerminal,
  setModifierLock,
  setTerminalContainerRef,
  setTerminalHostRef,
  shortcutButtons,
  tabs,
  toggleFullscreen,
} = state

const activeTabId = computed({
  get: () => state.activeTabId.value,
  set: (value) => {
    state.activeTabId.value = value
  },
})
</script>
